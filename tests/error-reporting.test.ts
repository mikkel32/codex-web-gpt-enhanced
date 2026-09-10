import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createResponseErrorCapture, captureIncident } from "../src/error-reporting";
import type { CodexParsedRequest } from "../src/types";
import { responseRequest } from "../src/server";
import { defaultConfig } from "../src/config";
import type { ProviderAdapter } from "../src/adapters/base";
const { ErrorReportStore } = require("../launcher/electron/error-report-store.cjs");

async function withHome(action: (store: any) => void | Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "maria-runtime-report-")); const old = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try { await action(new ErrorReportStore(home)); }
  finally { if (old === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = old; rmSync(home, { recursive: true, force: true }); }
}
const parsed: CodexParsedRequest = { modelId: "fixture-model", stream: true, options: {}, context: { systemPrompt: ["do-not-export-system"], messages: [
  { role: "user", content: "do-not-export-prompt", timestamp: 0 },
  { role: "toolResult", toolCallId: "call1", toolName: "fixture", isError: true, content: "Exact tool error", timestamp: 0 },
] }, _rawBody: { client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_fixture", turn_id: "turn_fixture" }) } } };

test("runtime captures actual emitted text without prompts or reasoning and correlates browser evidence", () => withHome(store => {
  store.configure({ enabled: true, recipient: "owner@example.com", includeResponses: true });
  const capture = createResponseErrorCapture(parsed, "trace_fixture");
  capture.record({ type: "text_delta", text: "Exact **answer**\n" });
  capture.record({ type: "thinking_delta", thinking: "do-not-export-reasoning" });
  capture.record({ type: "redacted_thinking", data: "do-not-export-opaque" });
  captureIncident({ source: "web-runtime", traceId: "trace_fixture", error: "Stream failed", webResponse: "Browser Markdown" });
  capture.record({ type: "error", message: "Stream failed", code: "fixture_error" });
  const report = store.records()[0];
  expect(store.records()).toHaveLength(1);
  expect(report.responses.codex.text).toBe("Exact **answer**\n");
  expect(report.responses.web.text).toBe("Browser Markdown");
  const text = JSON.stringify(report);
  for (const blocked of ["do-not-export-system", "do-not-export-prompt", "do-not-export-reasoning", "do-not-export-opaque"]) expect(text).not.toContain(blocked);
}));

test("successful and cancelled responses do not generate email incidents", () => withHome(store => {
  store.configure({ enabled: true, recipient: "owner@example.com", includeResponses: true });
  const capture = createResponseErrorCapture(parsed, "trace_fixture");
  capture.record({ type: "text_delta", text: "Success" }); capture.record({ type: "done", endTurn: true });
  capture.record({ type: "error", message: "Closed", code: "client_cancelled" });
  expect(store.records()).toHaveLength(0);
}));

test("reporting disabled or an invalid reporting configuration cannot break the runtime", () => withHome(store => {
  expect(() => createResponseErrorCapture(parsed).record({ type: "error", message: "Unreported" })).not.toThrow();
  expect(store.records()).toHaveLength(0);
}));

test("an actual Responses error is captured without changing its streamed outcome", () => withHome(async store => {
  store.configure({ enabled: true, recipient: "owner@example.com", includeResponses: true });
  const config = defaultConfig("browser-only"); config.proAvailable = true;
  const request = new Request("http://localhost/v1/responses", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "chatgpt-web/astra-pro", stream: true,
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_reporting", turn_id: "turn_reporting" }) },
      input: [{ type: "message", role: "user", content: "Fixture task", internal_chat_message_metadata_passthrough: { turn_id: "turn_reporting" } }],
    }) });
  const adapter = { runTurn: async (_parsed: unknown, _incoming: unknown, emit: (event: any) => void) => {
    emit({ type: "text_delta", text: "Recorded outgoing response" });
    emit({ type: "error", message: "Synthetic adapter failure", code: "fixture_failure", retryable: false });
  } } as unknown as ProviderAdapter;
  const response = await responseRequest(request, config, () => adapter);
  const text = await response.text();
  expect(text).toContain("Synthetic adapter failure");
  const reports = store.records(); expect(reports).toHaveLength(1);
  expect(reports[0].responses.codex.text).toBe("Recorded outgoing response");
}));
