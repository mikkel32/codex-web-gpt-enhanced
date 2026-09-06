import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatGptWebExecutionNamespace } from "../src/adapters/chatgpt-web";
import { chatGptConversationKey, ChatGptConversationCursors } from "../src/adapters/chatgpt-web/conversation-key";
import { defaultConfig } from "../src/config";
import { flushResponseState } from "../src/responses/state";
import { responseRequest } from "../src/server";
import type { ProviderAdapter } from "../src/adapters/base";
import type { CodexProviderConfig } from "../src/types";

for (const stream of [false, true]) test(`Responses ${stream ? "SSE" : "JSON"} completion records the exact answer before a previous-id follow-up`, async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-answer-receipt-server-"));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  try {
    const config = { ...defaultConfig("full"), browserHost: "launcher" as const, browserHostDescriptorPath: join(root, "launcher.json") };
    let calls = 0;
    const factory = (provider: CodexProviderConfig): ProviderAdapter => ({ name: "receipt-fixture",
      async runTurn(parsed, _incoming, emit) {
        const namespace = chatGptWebExecutionNamespace(provider);
        const file = join(root, `conversation-cursors-${createHash("sha256").update(namespace).digest("hex").slice(0, 16)}.json`);
        const cursors = new ChatGptConversationCursors(file);
        const key = chatGptConversationKey(parsed, namespace)!;
        if (calls++) {
          const plan = cursors.resume(key, parsed);
          expect(plan.mode).toBe("delta");
          expect(plan.omitted).toBe(2);
          expect(plan.parsed.context.messages).toEqual(parsed.context.messages.slice(-1));
        }
        cursors.commit(key, parsed, "Exact Web answer");
        emit({ type: "text_delta", text: "Exact Web answer", phase: "final_answer" });
        emit({ type: "done", stopReason: "stop", endTurn: true });
      },
    });
    const send = async (turnId: string, previousId?: string): Promise<Record<string, unknown>> => {
      const response = await responseRequest(new Request("http://127.0.0.1/v1/responses", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "chatgpt-web/high", stream,
          ...(previousId ? { previous_response_id: previousId } : {}),
          client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_receipt", turn_id: turnId }) },
          input: [{ type: "message", role: "user", content: previousId ? "Continue" : "Begin",
            internal_chat_message_metadata_passthrough: { turn_id: turnId } }],
        }),
      }), config, factory);
      expect(response.status).toBe(200);
      if (!stream) return await response.json() as Record<string, unknown>;
      const body = await response.text();
      const completed = body.split("\n\n").find(block => block.startsWith("event: response.completed\n"));
      expect(completed).toBeDefined();
      return JSON.parse(completed!.split("\ndata: ")[1]!).response;
    };
    const first = await send("turn_receipt_first");
    expect(first.status).toBe("completed");
    const second = await send("turn_receipt_second", first.id as string);
    expect(second.status).toBe("completed");
    expect(calls).toBe(2);
  } finally {
    flushResponseState();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
