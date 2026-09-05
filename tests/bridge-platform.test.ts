import { expect, spyOn, test } from "bun:test";
import { bridgeToResponsesSSE } from "../src/bridge";
import type { AdapterEvent } from "../src/types";

async function* completedEvents(chunks = 1): AsyncGenerator<AdapterEvent> {
  for (let index = 0; index < chunks; index++) {
    yield { type: "text_delta", text: `chunk-${index}:` + "x".repeat(2_048) };
  }
  yield { type: "done", endTurn: true };
}

function responseStream(platform: NodeJS.Platform, chunks = 1): ReadableStream<Uint8Array> {
  return bridgeToResponsesSSE(
    completedEvents(chunks),
    "chatgpt-web/test",
    undefined,
    undefined,
    undefined,
    undefined,
    2_000,
    { streamPlatform: platform },
  );
}

test("Responses SSE completes through the Windows push stream", async () => {
  const body = await new Response(responseStream("win32")).text();

  expect(body).toContain("event: response.completed");
  expect(body).toEndWith("data: [DONE]\n\n");
});

test("Darwin SSE remains decodable through Bun.serve under sustained chunking", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(responseStream("darwin", 64), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/responses`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(body).toContain("chunk-63:");
    expect(body).toContain("event: response.completed");
    expect(body).toEndWith("data: [DONE]\n\n");
  } finally {
    await server.stop(true);
  }
});

test("Windows backpressure parks without polling timers and cancellation releases the parked producer", async () => {
  let entered = 0, cleaned = 0, cancelled = 0;
  async function* source(): AsyncGenerator<AdapterEvent> {
    entered++;
    try { yield { type: "text_delta", text: "not consumed" }; }
    finally { cleaned++; }
  }
  const timers = spyOn(globalThis, "setTimeout");
  const stream = bridgeToResponsesSSE(source(), "test", undefined, undefined, undefined,
    () => { cancelled++; }, 2000, { streamPlatform: "win32" });
  try {
    await Bun.sleep(60);
    expect(entered).toBe(0);
    expect(timers.mock.calls.filter(call => call[1] === 5)).toHaveLength(0);
    await stream.cancel();
    await Bun.sleep(0);
    expect(cancelled).toBe(1);
    expect(cleaned).toBe(1);
  } finally {
    timers.mockRestore();
    await stream.cancel();
  }
});

for (const platform of ["win32", "darwin"] as const) {
  test(`${platform} keeps heartbeat buffering bounded while a reader pauses`, async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    async function* source(): AsyncGenerator<AdapterEvent> {
      await held;
      yield { type: "text_delta", text: "complete answer" };
      yield { type: "done", endTurn: true };
    }
    const stream = bridgeToResponsesSSE(source(), "test", undefined, undefined, undefined,
      undefined, 2, { streamPlatform: platform });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let body = decoder.decode((await reader.read()).value);
    await Bun.sleep(50);
    release();
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      body += decoder.decode(item.value);
    }
    expect((body.match(/event: response\.heartbeat/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(body).toContain("complete answer");
    expect(body).toContain("event: response.completed");
    expect(body).toEndWith("data: [DONE]\n\n");
  });
}

test("Windows synchronous demand notifications stream correctly through Bun.serve", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response(responseStream("win32", 128)) });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/stream`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "", reads = 0;
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      body += decoder.decode(item.value, { stream: true });
      if (++reads % 3 === 0) await Bun.sleep(1);
    }
    for (let index = 0; index < 128; index++) expect(body).toContain(`chunk-${index}:`);
    const deltas = body.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)))
      .filter(event => event.type === "response.output_text.delta");
    expect(deltas).toHaveLength(128);
    for (let index = 0; index < 128; index++) expect(deltas[index].delta).toBe(`chunk-${index}:` + "x".repeat(2048));
    expect(body.match(/event: response\.completed/g)).toHaveLength(1);
    expect(body).toEndWith("data: [DONE]\n\n");
  } finally { await server.stop(true); }
});

test("a Windows HTTP disconnect cancels the producer without a teardown rejection", async () => {
  let cancelled = 0, cleaned = 0;
  async function* source(): AsyncGenerator<AdapterEvent> {
    try {
      while (!cancelled) {
        await Bun.sleep(2);
        yield { type: "text_delta", text: "x".repeat(8192) };
      }
    } finally { cleaned++; }
  }
  const server = Bun.serve({ port: 0, fetch: () => new Response(bridgeToResponsesSSE(
    source(), "test", undefined, undefined, undefined, () => { cancelled++; },
    2000, { streamPlatform: "win32" },
  )) });
  const abort = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/stream`, { signal: abort.signal });
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    await reader.cancel().catch(() => {});
    const deadline = Date.now() + 2000;
    while (!cleaned && Date.now() < deadline) await Bun.sleep(10);
    expect(cancelled).toBe(1);
    expect(cleaned).toBe(1);
  } finally { abort.abort(); await server.stop(true); }
});
