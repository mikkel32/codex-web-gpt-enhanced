import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";
import { ChatGptBrowserWorker, ChatGptCompletionTracker, ChatGptResponsePollDelay, ChatGptStoppedThinkingTracker } from "../src/adapters/chatgpt-web/browser-worker";

/** Exercises the shipped DOM reader in an isolated Electron page; never contacts ChatGPT. */
export async function verifyResponseStateFixture(page: Page): Promise<void> {
  const worker = ChatGptBrowserWorker.forProvider({
    adapter: "chatgpt-web", baseUrl: "browser://offline-response-state-fixture",
    chatgptWeb: { localToolsEnabled: false, storageStatePath: "/tmp/unused-response-state-fixture.json" },
  }) as unknown as {
    responseDomSnapshot(locator: Locator, cache: Record<string, unknown>): Promise<{
      responsePresent: boolean; stoppedThinkingVisible: boolean; visibleText: string;
      completionActionVisible: boolean;
    }>;
  };
  const fixtures: Array<[string, boolean]> = [
    ['<button>Stopped thinking</button>', true],
    ['<button>Stoppede med at tænke</button>', true],
    ['<div role="status">Tænkning stoppet</div>', true],
    ['<button aria-label="Stopped thinking"><span>icon</span></button>', true],
    ['<div class="markdown"><p>Stopped thinking</p></div>', false],
    ['<div class="markdown"><pre><code>Stopped thinking</code></pre></div>', false],
    ['<div class="markdown"><button aria-label="Stopped thinking">example</button></div>', false],
    ['<div data-streaming-response-status><div class="markdown"><p>Stopped thinking</p></div></div>', false],
    ['<blockquote><button>Stopped thinking</button></blockquote>', false],
    ['<div style="display:none"><button>Stopped thinking</button></div>', false],
    ['<div aria-hidden="true"><button>Stopped thinking</button></div>', false],
    ['<button>Stopped thinking about the first approach</button>', false],
  ];
  for (const [html, expected] of fixtures) {
    await page.setContent(`<article id="response">${html}</article>`);
    const state = await worker.responseDomSnapshot(page.locator("#response"), {});
    assert.equal(state.stoppedThinkingVisible, expected, html);
  }
  await page.setContent('<article id="response"><button>Stopped thinking</button><div class="markdown"><p>Final answer</p></div><button data-testid="copy-turn-action-button" aria-label="Copy response">Copy</button></article>');
  const snapshot = await worker.responseDomSnapshot(page.locator("#response"), {});
  assert.equal(snapshot.visibleText, "Final answer");
  assert.equal(snapshot.completionActionVisible, true);
  const completion = new ChatGptCompletionTracker();
  const finalState = { responsePresent: true, running: false, currentText: snapshot.visibleText, completionActionVisible: true };
  assert.equal(completion.update(finalState, 0), false);
  assert.equal(completion.update(finalState, 2_000), true, "A final answer can complete despite an earlier stopped label");

  const stopped = new ChatGptStoppedThinkingTracker();
  for (let now = 0; now <= 60_000; now += 1_000) {
    assert.equal(stopped.update({ visible: snapshot.stoppedThinkingVisible, responsePresent: true,
      running: true, progressKey: "unchanged", externalProgressLive: false }, now), false,
    "A stale stop label must not interrupt active generation");
  }
  const delay = new ChatGptResponsePollDelay();
  let elapsed = 0, observations = 0;
  while (elapsed < 30_000) { elapsed += delay.update("quiet"); observations++; }
  assert(observations <= 33, "Quiet turns must not poll at four checks per second");
  assert.equal(delay.update("new-text-or-tool-progress"), 250);

  // Large answers must keep their cached projection and ignore quoted stop text.
  await page.setContent(`<article id="response"><div class="markdown">${'<p>Example output with many rendered words.</p>'.repeat(4_000)}<pre><code>Stopped thinking</code></pre></div></article>`);
  const cache: Record<string, unknown> = {};
  let state = await worker.responseDomSnapshot(page.locator("#response"), cache);
  assert.equal(state.stoppedThinkingVisible, false);
  const start = performance.now();
  for (let index = 0; index < 20; index++) state = await worker.responseDomSnapshot(page.locator("#response"), cache);
  assert.equal(cache.fullScans, 1);
  assert.equal(cache.cacheHits, 20);
  assert(state.visibleText.length > 100_000);
  console.log(`RESPONSE_STATE_ELECTRON_OK cases=${fixtures.length} stale-label-running final-answer-wins large-answer-cache=20/20 quiet-observations=${observations}/30s cachedReadMs=${Math.round(performance.now() - start)}`);
}
