import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { compactRequest, responseRequest } from "../src/server";

test("native responses and compaction remain independent of manual mode, browser, and tunnel", async () => {
  for (const handler of [responseRequest, compactRequest]) {
    const config = defaultConfig("full");
    config.browserInteractionMode = "manual";
    config.experimentalBiggerContext = true; // Invalid Web configuration must not gate native work.
    config.tunnel = undefined;
    let calls = 0;
    const response = await handler(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-6-astra", input: [], stream: false }),
    }), config, () => { throw new Error("Native requests must never create a browser adapter"); }, {
      fetchUpstream: async req => {
        calls += 1;
        expect(req.url).toBe(`https://chatgpt.com/backend-api/codex/responses${handler === compactRequest ? "/compact" : ""}`);
        expect((await req.json() as { model: string }).model).toBe("gpt-6-astra");
        return Response.json({ output: [], id: "native-result" });
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ output: [], id: "native-result" });
    expect(calls).toBe(1);
  }
});

test("native failures keep the backend status and are never retried as browser requests", async () => {
  let calls = 0;
  const response = await responseRequest(new Request("http://localhost/v1/responses", {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-6-astra", input: [] }),
  }), defaultConfig("full"), () => { throw new Error("Unexpected browser fallback"); }, {
    fetchUpstream: async () => { calls += 1; return new Response("rate limited", { status: 429 }); },
  });
  expect(response.status).toBe(429);
  expect(calls).toBe(1);
});
