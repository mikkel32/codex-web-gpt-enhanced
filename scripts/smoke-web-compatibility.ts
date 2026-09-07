import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";
import type { AdapterEvent } from "../src/types";

const codex = resolve(process.argv[2] ?? "/Applications/ChatGPT.app/Contents/Resources/codex");
const root = mkdtempSync(join(tmpdir(), "maria-web-compatibility-"));
// The only model responses in this test come from our loopback fixture.
process.env.CODEX_CHATGPT_WEB_HOME = join(root, "bridge");
const { responseRequest } = await import("../src/server");
const { bridgeToResponsesSSE } = await import("../src/bridge");
const { flushResponseState } = await import("../src/responses/state");
const bundled = spawnSync(codex, ["debug", "models", "--bundled"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
assert.equal(bundled.status, 0, bundled.stderr);
const config = defaultConfig("full");
config.proAvailable = true;
config.experimentalBiggerContext = true;
const catalog = augmentNativeModelCatalog(JSON.parse(bundled.stdout), config, { contextWindow: 1_000_000 });
const nativeModels = (catalog.models as Array<Record<string, unknown>>).filter(model => !String(model.slug).startsWith("chatgpt-web/"));
const nativeModel = nativeModels.find(model => model.slug === "gpt-6-astra") ?? nativeModels.find(model => model.slug === "gpt-5.6-sol");
assert(nativeModel, "Native preservation probe requires a bundled native model");
const nativeWindow = Math.floor(1_000_000 * Number(nativeModel.effective_context_window_percent ?? 95) / 100);

function windowsIn(path: string): number[] {
  const result: number[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...windowsIn(child));
    else if (entry.name.endsWith(".jsonl")) for (const line of readFileSync(child, "utf8").split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "event_msg" && event.payload?.type === "token_count"
        && typeof event.payload.info?.model_context_window === "number") result.push(event.payload.info.model_context_window);
    }
  }
  return result;
}

try {
  for (const scenario of [
    { name: "below-budget", model: "chatgpt-web/astra-pro", tokens: 280_000, compact: false, experimental: false },
    { name: "rollover", model: "chatgpt-web/astra-pro", tokens: 285_100, compact: true, experimental: false },
    // This is API-key fixture authentication, so this checks compatibility with the
    // configured flag, not activation of the account-gated Plus/Pro experiment.
    { name: "experimental-flag-configured", model: "chatgpt-web/astra-pro", tokens: 285_100, compact: true, experimental: true },
    { name: "native-preserved", model: String(nativeModel.slug), tokens: 10, compact: false, experimental: false },
  ]) {
    const home = join(root, scenario.name); mkdirSync(home);
    const catalogPath = join(home, "models.json"); writeFileSync(catalogPath, JSON.stringify(catalog));
    let ordinary = 0, compacted = 0, resumed = false;
    const native = !scenario.model.startsWith("chatgpt-web/");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models")) return Response.json(catalog);
      const adapter = { name: "offline-compatibility", async runTurn(parsed: Parameters<import("../src/adapters/base").ProviderAdapter["runTurn"]>[0], _incoming: unknown, emit: (event: AdapterEvent) => void) {
        if (parsed._compactionRequest) {
          compacted++;
          emit({ type: "text_delta", text: "COMPATIBILITY_CHECKPOINT_314159: keep this task and continue the validation.", phase: "final_answer" });
        } else if (ordinary++ === 0 && !native) {
          emit({ type: "tool_call_start", id: "compat_goal_read", name: "get_goal" });
          emit({ type: "tool_call_delta", arguments: "{}" }); emit({ type: "tool_call_end" });
          emit({ type: "done", stopReason: "tool_use", endTurn: false, usage: { inputTokens: scenario.tokens, outputTokens: 2, totalTokens: scenario.tokens + 2 } });
          return;
        } else {
          if (scenario.compact) {
            resumed = JSON.stringify(parsed.context.messages).includes("COMPATIBILITY_CHECKPOINT_314159");
            assert(resumed, "Compacted context did not survive the continuation");
          }
          emit({ type: "text_delta", text: "WEB_COMPATIBILITY_OK", phase: "final_answer" });
        }
        emit({ type: "done", stopReason: "stop", endTurn: true, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
      } };
      return responseRequest(request, config, () => adapter, { fetchUpstream: async () => {
        async function* events(): AsyncGenerator<AdapterEvent> {
          yield { type: "text_delta", text: "WEB_COMPATIBILITY_OK", phase: "final_answer" };
          yield { type: "done", stopReason: "stop", endTurn: true, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
        }
        return new Response(bridgeToResponsesSSE(events(), scenario.model), { headers: { "content-type": "text/event-stream" } });
      } });
    } });
    writeFileSync(join(home, "config.toml"), [
      `model=${JSON.stringify(scenario.model)}`, 'model_provider="fixture"',
      `model_catalog_json=${JSON.stringify(catalogPath)}`, "model_context_window=1000000", "model_auto_compact_token_limit=900000",
      '[model_providers.fixture]', 'name="OpenAI"', `base_url="http://127.0.0.1:${server.port}/v1"`,
      'wire_api="responses"', 'env_key="OPENAI_API_KEY"', "supports_websockets=false",
      "[features]", "plugins=false", "apps=false", "goals=true", "memories=false",
      `context_management.experimental_mode=${scenario.experimental}`,
    ].join("\n"));
    try {
      const child = Bun.spawn([codex, "exec", "--skip-git-repo-check", "--json", "Synthetic local compatibility check; do not perform other work."], {
        cwd: home, env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "offline-fixture-only" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill(), 30_000);
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); clearTimeout(timer);
      assert.equal(code, 0, `${scenario.name}: ${stderr.slice(-1500)} ${stdout.slice(-1500)}`);
      assert(stdout.includes("WEB_COMPATIBILITY_OK"));
      assert.equal(compacted, scenario.compact ? 1 : 0);
      if (scenario.compact) assert(resumed);
      const windows = windowsIn(home); assert(windows.length > 0);
      assert(windows.every(window => native ? window === nativeWindow : window <= 285_000), `${scenario.name}: windows=${windows}, native expected=${nativeWindow}`);
      console.log(`WEB_COMPATIBILITY_CASE_OK ${scenario.name} window=${windows[0]} compactions=${compacted}`);
    } finally { await server.stop(true); }
  }
  console.log("NATIVE_CODEX_WEB_COMPATIBILITY_OK");
} finally { flushResponseState(); rmSync(root, { recursive: true, force: true }); }
