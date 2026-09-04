import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { HttpTurnCounter, responseRequest, startServer } from "../src/server";

test("a Web request still reading its body observes a concurrent UI detachment", async () => {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let detached = false;
  let started = false;
  const request = new Request("http://localhost/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" },
    body: new ReadableStream({ start(controller) { input = controller; } }),
  });
  const pending = responseRequest(request, defaultConfig("browser-only"), () => {
    started = true; throw new Error("Detached UI must not receive a prompt");
  }, { browserUnavailable: () => detached });
  detached = true;
  input.enqueue(new TextEncoder().encode('{"model":"chatgpt-web/high","input":[]}')); input.close();
  expect((await pending).status).toBe(503);
  expect(started).toBe(false);
});

test("pending Web streams remain classified until their HTTP owner settles", async () => {
  const turns = new HttpTurnCounter();
  const webAbort = new AbortController();
  const nativeAbort = new AbortController();
  const web = await turns.track(async (_signal, _identity, bindWeb) => {
    bindWeb(); return new Response(new ReadableStream());
  }, webAbort.signal);
  const native = await turns.track(async () => new Response(new ReadableStream()), nativeAbort.signal);
  expect(turns.count()).toBe(2);
  expect(turns.webCount()).toBe(1);
  const webCancelled = web.body!.cancel();
  webAbort.abort();
  await webCancelled;
  expect(turns.webCount()).toBe(0);
  expect(turns.count()).toBe(1);
  const nativeCancelled = native.body!.cancel();
  nativeAbort.abort();
  await nativeCancelled;
});

test("UI detachment preserves an in-flight native stream and future native requests", async () => {
  const config = { ...defaultConfig("browser-only"), port: 0 };
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const server = startServer(config, {
    fetchUpstream: async request => {
      const body = await request.json() as { stream?: boolean };
      if (!body.stream) return Response.json({ output: [], id: "native-after-quit" });
      return new Response(new ReadableStream({
        start(controller) { output = controller; controller.enqueue(encoder.encode("data: first\n\n")); },
      }), { headers: { "content-type": "text/event-stream" } });
    },
    adapterFactory: () => { throw new Error("Closed browser must not be started"); },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body: unknown) => fetch(url + path, {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const control = (action: string) => fetch(`${url}/admin/${action}`, {
    method: "POST", headers: { authorization: `Bearer ${config.controlToken}` },
  });
  try {
    const native = await post("/v1/responses", { model: "gpt-6-astra", input: [], stream: true });
    const reader = native.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("first");
    expect((await control("browser-detach")).status).toBe(200);
    const health = await (await fetch(`${url}/healthz`)).json() as Record<string, unknown>;
    expect(health).toMatchObject({ accepting_turns: true, browser_connected: false, active_http_turns: 1 });
    const unavailable = await post("/v1/responses", { model: "chatgpt-web/high", input: [] });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toContain("Open Maria WebGPT");
    for (const path of ["/v1/responses", "/v1/responses/compact"]) {
      const next = await post(path, { model: "gpt-6-astra", input: [], stream: false });
      expect(next.status).toBe(200);
      expect(await next.json()).toMatchObject({ id: "native-after-quit" });
    }
    output.enqueue(encoder.encode("data: last\n\ndata: [DONE]\n\n")); output.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("last");
    expect((await reader.read()).done).toBe(true);
    expect((await control("resume")).status).toBe(200);
    expect(await (await fetch(`${url}/healthz`)).json()).toMatchObject({ browser_connected: true });
  } finally { server.stop(true); }
});

test("browser detachment requires the private local control capability", async () => {
  const server = startServer({ ...defaultConfig("browser-only"), port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/admin/browser-detach`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json()).toMatchObject({ browser_connected: true });
  } finally { server.stop(true); }
});
