const { randomBytes } = require("node:crypto");
const { savedConversationUrl } = require("./saved-conversations.cjs");

const REVIEW_MESSAGE = "The previous ChatGPT turn needs review. Open Browser in Maria, inspect the saved chat, then choose I reviewed this chat before sending a new message in the original Codex task. The interrupted prompt has not been resent.";

function turnReviewRequiredError() {
  const error = new Error(REVIEW_MESSAGE);
  error.code = "previous_turn_needs_attention";
  return error;
}

function retainTurnForReview(host, tab) {
  if (tab.interactionMode !== "automatic" || !tab.conversationKey) return false;
  const saved = host.savedConversations?.get(tab.conversationKey);
  if (saved?.status !== "in-flight") return false;
  tab.recoveryId ??= randomBytes(24).toString("base64url");
  tab.status = tab.status === "aborted" ? "aborted" : "error";
  tab.loading = false;
  tab.initializingSurface = false;
  tab.lastHeartbeatAt = Date.now();
  host.syncPowerSaveBlocker?.();
  host.publishState?.(host.snapshot());
  host.writeDescriptor();
  return true;
}

async function bounded(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Restoring an uncertain submission is inspection only: this function never leases it for Send.
async function openSavedTurnForReview(host, traceId, helperPid, conversationKey, connectorIdentity, saved) {
  if (!saved.url || saved.connectorIdentity !== (connectorIdentity || "")) return;
  host.pendingTurnReviews ??= new Map();
  const pending = host.pendingTurnReviews.get(conversationKey);
  if (pending) return pending;
  const operation = (async () => {
    let tab = [...host.turnTabs.values()].find(candidate => candidate.conversationKey === conversationKey
      && candidate.connectorIdentity === connectorIdentity && candidate.interactionMode === "automatic"
      && ["error", "aborted"].includes(candidate.status));
    if (!tab) {
      tab = await host.createTurnTab(traceId, helperPid, conversationKey, connectorIdentity);
      try {
        tab.initializingSurface = true;
        await bounded(tab.view.webContents.loadURL(saved.url), 60_000, "Opening the saved ChatGPT conversation for review timed out");
        if (savedConversationUrl(tab.view.webContents.getURL()) !== saved.url) {
          throw new Error("ChatGPT did not restore the exact saved conversation. Sign in again and retry.");
        }
        await host.markTurnTabSurface(tab);
        if (host.turnTabs.get(tab.id) !== tab || host.savedConversations.get(conversationKey) !== saved
          || savedConversationUrl(tab.view.webContents.getURL()) !== saved.url) {
          throw new Error("The saved conversation changed while opening it for review");
        }
        tab.connectorBound = saved.connectorBound === true;
        tab.submissionActivated = true;
        tab.bootstrapReady = true;
        tab.message = REVIEW_MESSAGE;
        retainTurnForReview(host, tab);
      } catch (error) {
        host.removeTurnTab(tab, false);
        throw error;
      }
    } else {
      retainTurnForReview(host, tab);
    }
    host.selectedTabId = tab.id;
    host.syncViewVisibility();
    host.publishState?.(host.snapshot());
  })();
  host.pendingTurnReviews.set(conversationKey, operation);
  try { await operation; }
  finally { if (host.pendingTurnReviews.get(conversationKey) === operation) host.pendingTurnReviews.delete(conversationKey); }
}

const REVIEW_STATE_SCRIPT = `(() => {
  const visible = element => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return element.isConnected && bounds.width > 0 && bounds.height > 0
      && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };
  const composer = Array.from(document.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], textarea'))
    .find(element => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true"
      && (element.isContentEditable || element.tagName === "TEXTAREA"));
  const busy = Array.from(document.querySelectorAll('[data-testid="stop-button"], [data-is-streaming="true"], [aria-busy="true"], [role="dialog"], [role="alertdialog"]'))
    .some(visible);
  return { ready: document.readyState !== "loading" && Boolean(composer), idle: !busy,
    draft: Boolean(composer && (composer.value ?? composer.textContent ?? "").trim()) };
})()`;

function confirmTurnReviewed(host, tabId, recoveryId) {
  if (typeof recoveryId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(recoveryId)) {
    return Promise.reject(new Error("This review action is no longer current"));
  }
  const tab = host.turnTabs.get(tabId);
  if (tab?.reviewOperation?.recoveryId === recoveryId) return tab.reviewOperation.promise;
  const promise = (async () => {
    host.assertWebTransportAvailable?.();
    host.accessGate?.assertAvailable();
    const gateRevision = host.accessGate?.revision;
    const saved = tab?.conversationKey && host.savedConversations?.get(tab.conversationKey);
    const validate = () => {
      if (!tab || host.turnTabs.get(tabId) !== tab || tab.recoveryId !== recoveryId
        || tab.interactionMode !== "automatic" || !["error", "aborted"].includes(tab.status)
        || host.selectedTabId !== tabId || host.visible !== true || host.surfaceActive !== true
        || !saved?.url || saved.status !== "in-flight" || host.savedConversations.get(tab.conversationKey) !== saved
        || saved.connectorIdentity !== (tab.connectorIdentity || "") || tab.view.webContents.isDestroyed()
        || savedConversationUrl(tab.view.webContents.getURL()) !== saved.url
        || [...host.turnTabs.values()].some(other => other !== tab && other.conversationKey === tab.conversationKey && other.status === "running")) {
        throw new Error("The saved chat changed or is not open for review. Inspect it in Browser before continuing.");
      }
      host.assertWebTransportAvailable?.();
      host.accessGate?.assertAvailable();
      if (host.accessGate?.revision !== gateRevision) throw new Error("Web access changed during review. Review the chat again.");
    };
    validate();
    const state = await bounded(tab.view.webContents.executeJavaScript(REVIEW_STATE_SCRIPT), 10_000, "The saved chat did not respond to the review check");
    validate();
    if (state?.ready !== true || state.idle !== true || state.draft !== false) {
      throw new Error("The saved chat is still working, has a draft, or needs attention. Finish reviewing it before continuing.");
    }
    // This acknowledges uncertainty, not completion. The next request verifies the connector again.
    host.savedConversations.set(tab.conversationKey, { ...saved, status: "ready", connectorBound: false, reviewedInterruption: true });
    tab.reviewedTraceId = tab.traceId;
    tab.recoveryId = undefined;
    tab.submissionActivated = false;
    tab.connectorBound = false;
    tab.status = "ready";
    tab.message = "Chat reviewed. Send a new message in the original Codex task to continue.";
    tab.lastHeartbeatAt = Date.now();
    host.logger.info("browser.interrupted_turn_reviewed", { tabId, traceId: tab.traceId });
    host.publishState?.(host.snapshot());
    host.writeDescriptor();
    return host.snapshot();
  })();
  if (tab) {
    tab.reviewOperation = { recoveryId, promise };
    void promise.finally(() => { if (tab.reviewOperation?.promise === promise) tab.reviewOperation = undefined; }).catch(() => {});
  }
  return promise;
}

module.exports = { confirmTurnReviewed, openSavedTurnForReview, retainTurnForReview, turnReviewRequiredError };
