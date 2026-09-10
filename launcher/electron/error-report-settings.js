"use strict";
const element = id => document.getElementById(id);
let busy = false;
let currentState;
function showStatus(text, failed = false) { element("status").textContent = text; element("status").classList.toggle("error", failed); }
function render(state, updateForm = true) {
  currentState = state;
  if (updateForm) {
    for (const key of ["recipient", "sender"]) element(key).value = state[key] || "";
    for (const key of ["enabled", "includeResponses"]) element(key).checked = state[key] === true;
  }
  element("test").disabled = !state.enabled || !state.senderConfigured;
  element("deliveryStatus").textContent = state.deliveryStatus || "";
  element("reports").replaceChildren();
  if (!state.reports.length) element("reports").textContent = "No reports recorded. Successful tasks do not create emails.";
  for (const report of state.reports) {
    const card = document.createElement("article"), heading = document.createElement("strong"), detail = document.createElement("p");
    heading.textContent = `${report.code || report.source} · ${report.state} · ${report.id.slice(0, 10)}`;
    detail.textContent = `${new Date(report.createdAt).toLocaleString()} · ${report.reason}${report.currentConsent ? "" : " · Held under earlier settings; will not send to a changed recipient."}`;
    card.append(heading, detail);
    for (const [action, label] of [["preview", "Preview report"], ["preview-email", "Preview email"], ["delete", "Delete"]]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.disabled = action === "delete" && report.state === "sending";
      button.onclick = () => request({ action, id: report.id }); card.append(button);
    }
    element("reports").append(card);
  }
  if (state.lastFailure) showStatus(state.lastFailure, true);
}
async function request(value) {
  if (busy) return; busy = true;
  const buttons = [...document.querySelectorAll("button")]; const disabled = buttons.map(button => button.disabled);
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await window.errorReporting.request(value);
    if (value.action === "preview" || value.action === "preview-email") {
      element("preview").hidden = false;
      element("preview").textContent = value.action === "preview-email" ? `${result.subject}\n\n${result.text}` : JSON.stringify(result, null, 2);
    }
    else { render(result); showStatus(value.action === "test" ? "Test email queued. Refresh to check its delivery status." : value.action === "save" ? "Settings saved." : result.lastFailure || ""); }
  } catch (error) { showStatus(error.message || "Reporting settings failed", true); }
  finally { buttons.forEach((button, index) => { if (button.isConnected) button.disabled = disabled[index]; });
    if (currentState) element("test").disabled = !currentState.enabled || !currentState.senderConfigured;
    element("password").value = ""; busy = false; }
}
element("settings").onsubmit = event => { event.preventDefault(); request({ action: "save", value: {
  recipient: element("recipient").value, sender: element("sender").value, password: element("password").value,
  enabled: element("enabled").checked, includeResponses: element("includeResponses").checked,
} }); };
for (const action of ["test", "forget"]) element(action).onclick = () => request({ action });
element("refresh").onclick = () => request({ action: "status" });
request({ action: "status" });
