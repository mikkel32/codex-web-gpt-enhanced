import { randomBytes } from "node:crypto";
import { getConfigDir, providerConfig, type AppConfig } from "./config";
import { ChatGptBrowserWorker, closeChatGptBrowserWorkers, type BrowserTurn } from "./adapters/chatgpt-web/browser-worker";
import { RemoteTurnBroker, type TurnBrokerOwner } from "./adapters/chatgpt-web/turn-broker";
import { nativeContextPrompt } from "./adapters/chatgpt-web/native-context";
import type { ChatGptWebCapabilities } from "./adapters/chatgpt-web/model";

const nonce = () => randomBytes(16).toString("hex");
export const CONNECTION_VERIFICATION_TIMEOUT_MS = 180_000;

/** Tests the remote path with disposable evidence and one inert native operation.
 * No shell, repository, external accounts, or user task is exposed to this turn. */
export async function verifyConnectionRoundTrip({ broker, run, cwd, signal, capabilities = { localToolsEnabled: true, solAvailable: true, proAvailable: true } }: {
  broker: TurnBrokerOwner;
  run: (turn: BrowserTurn) => Promise<string>;
  cwd: string;
  signal?: AbortSignal;
  capabilities?: ChatGptWebCapabilities;
}): Promise<{ ok: true; traceId: string; scope: string[] }> {
  const traceId = `connection_${nonce()}`;
  const core = nonce(), evidence = nonce(), tool = nonce();
  const wireName = `maria_connection_probe_${nonce().slice(0, 8)}`;
  const evidenceName = `codex-evidence-${nonce().slice(0, 16)}.txt`;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("Connection verification timed out; no task was replayed")), CONNECTION_VERIFICATION_TIMEOUT_MS);
  let token: string | undefined;
  let consume: Promise<void> | undefined;
  let calls = 0;
  try {
    controller.signal.throwIfAborted();
    console.info(`[chatgpt-web] connection verification started trace=${traceId}`);
    if (!broker.setContextFiles) throw new Error("Runtime lacks required context delivery support");
    token = await broker.register({ cwd, roots: [cwd], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false },
      tools: [{ name: wireName, description: "Return a disposable connection proof. This verification-only operation reads no files and has no side effects.",
        parameters: { type: "object", properties: {}, additionalProperties: false } }],
    }, CONNECTION_VERIFICATION_TIMEOUT_MS + 15_000, traceId);
    const boundToken = token;
    const files = [
      { name: "codex-context-1-of-2.json", text: JSON.stringify({ padding: " ".repeat(12_100), core }), required: true as const },
      { name: "codex-context-2-of-2.json", text: JSON.stringify({ task: "Read core, search for connection_evidence, discover and call the inert native connection probe using codex_tool_inventory and codex_tool_call. Return only JSON with core, evidence and tool values from their actual results." }), required: true as const },
      { name: evidenceName, text: `connection_evidence=${evidence}`, required: false, kind: "evidence" as const },
    ];
    await broker.setContextFiles(token, files, { requireReceipts: true, optionalTokenBudget: 1000 });
    const prepared = nativeContextPrompt({ text: "", images: [], conversationState: "fresh", multipart: {
      parts: [files[0]!.text, files[1]!.text],
      commit: `This is an isolated connection check. Pass turn_token ${token} unchanged to every Codex Native call. Follow the task in the required records; perform no other work. Return exactly the three requested JSON values after all tool results settle.`,
    } }, files);
    consume = (async () => {
      while (!controller.signal.aborted) {
        const batch = await broker.nextToolBatch(boundToken, controller.signal);
        for (const request of batch) {
          if (request.wireName !== wireName || request.freeform || Object.keys(request.arguments ?? {}).length || ++calls > 3) {
            throw new Error("Connection verification received an unexpected native operation");
          }
          await broker.completeTool(boundToken, request.callId, { content: [{ type: "text", text: JSON.stringify({ tool }) }] });
        }
      }
    })();
    // Reject the browser turn too if the owner loop fails, without leaving an unhandled promise.
    void consume.catch(error => { if (!controller.signal.aborted) controller.abort(error); });
    const answer = await run({ traceId, modelId: capabilities.solAvailable ? "gpt-5.6-sol" : "gpt-5.6-luna",
      reasoning: capabilities.solAvailable ? capabilities.proAvailable ? "xhigh" : "high" : "medium",
      capabilities,
      prepare: async () => ({ ...prepared, release: () => {} }), abortSignal: controller.signal,
      onTextDelta: () => {},
      completionFence: {
        begin: async () => broker.beginCompletionFence(boundToken),
        commit: async revision => broker.commitCompletionFence(boundToken, revision),
      },
    });
    controller.signal.throwIfAborted();
    const normalized = answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
    let result;
    try { result = JSON.parse(normalized); } catch { throw new Error("Connection verification did not return the requested proof"); }
    if (!result || typeof result !== "object" || Object.keys(result).length !== 3
      || result.core !== core || result.evidence !== evidence || result.tool !== tool || !calls) {
      throw new Error("Connection verification proof did not match this runtime");
    }
    const revision = await broker.beginCompletionFence(token);
    if (revision === undefined || !await broker.commitCompletionFence(token, revision)) throw new Error("Connection verification context or native calls remain incomplete");
    return { ok: true, traceId, scope: ["required-context-receipts", "evidence-retrieval", "native-tool-round-trip"] };
  } catch (error) {
    throw new Error(`Connection verification ${traceId}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
    if (token) await broker.revoke(token);
    await consume?.catch(() => {});
  }
}

export async function verifyConfiguredConnection(config: AppConfig) {
  if (config.mode !== "full" || config.browserInteractionMode !== "automatic") throw new Error("Automatic connection verification requires automatic Full mode");
  const broker = new RemoteTurnBroker(config.brokerSocketPath);
  await broker.assertCompatible();
  const worker = ChatGptBrowserWorker.forProvider(providerConfig(config));
  try { return await verifyConnectionRoundTrip({ broker, run: turn => worker.run(turn), cwd: getConfigDir(),
    capabilities: { localToolsEnabled: true, solAvailable: config.solAvailable, proAvailable: config.proAvailable } }); }
  finally { await closeChatGptBrowserWorkers(); }
}
