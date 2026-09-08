import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { ChatGptBrowserWorker, type ChatGptConnectorActivationSnapshot } from "../src/adapters/chatgpt-web/browser-worker";

/** Exercise production selection in the isolated, offline Electron smoke browser. */
export async function verifyConnectorActivationFixture(page: Page): Promise<void> {
  await page.setContent(`<!doctype html><html><body>
    <button>Personalized</button>
    <div id="prompt-textarea" contenteditable="true" style="width:400px;min-height:40px"></div>
    <div data-testid="prompt-textarea" contenteditable="true" style="display:none"></div>
    <div class="__menu-item" tabindex="0" data-highlighted="" hidden><span>Codex Native2</span></div>
    <script>
      window.connectorActivations = 0;
      const row = document.querySelector('.__menu-item');
      function bind(editor) {
        editor.addEventListener('input', () => { row.hidden = editor.textContent !== '@codex'; });
        editor.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || row.hidden) return;
          event.preventDefault();
          window.connectorActivations++;
          row.hidden = true;
          const replacement = editor.cloneNode(false);
          if (window.connectorActivations > 1) {
            replacement.innerHTML = '<span data-id="plugin:fixture" data-keyword="Codex Native2">Codex Native2</span>';
          }
          editor.replaceWith(replacement);
          bind(replacement);
        });
      }
      bind(document.querySelector('#prompt-textarea'));
    </script></body></html>`);
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Native2" },
  }) as {
    selectConnector(page: Page, capture: (checkpoint: string) => Promise<void>): Promise<unknown>;
    connectorActivationSnapshot(page: Page): Promise<ChatGptConnectorActivationSnapshot>;
    captureSubmissionBaseline(page: Page, retained: boolean): Promise<{ initialResponseTurnIdentities: string[] }>;
  };
  const before = await worker.connectorActivationSnapshot(page);
  assert.deepEqual(before.composerTexts, [""]);
  assert.equal(before.connectorCount, 0);
  const checkpoints: string[] = [];
  await worker.selectConnector(page, async checkpoint => { checkpoints.push(checkpoint); });
  assert.equal(await page.evaluate(() => (window as unknown as { connectorActivations: number }).connectorActivations), 2);
  assert.equal(checkpoints.filter(value => value === "connector-activation-empty-retry").length, 1);
  const after = await worker.connectorActivationSnapshot(page);
  assert.equal(after.connectorCount, 1);
  assert.deepEqual(after.turns, []);
  assert.equal(after.generating, false);
  assert.equal(after.documentEpoch, before.documentEpoch);
  await page.setContent(`<!doctype html><html><body>
    <div id="prompt-textarea" contenteditable="true" style="width:400px;min-height:40px"></div>
    <script>setTimeout(() => {
      const answer = document.createElement('article');
      answer.setAttribute('data-testid','conversation-turn-1');
      answer.setAttribute('data-message-author-role','assistant');
      answer.innerHTML = '<div data-message-author-role="assistant">Existing answer</div>';
      document.body.append(answer);
    }, 150);</script></body></html>`);
  const baseline = await worker.captureSubmissionBaseline(page, true);
  assert.deepEqual(baseline.initialResponseTurnIdentities, ["conversation-turn-1"]);
  console.log("CONNECTOR_ELECTRON_ACTIVATION_OK consumed-mention replacement-composer bounded-pre-send-recovery");
}
