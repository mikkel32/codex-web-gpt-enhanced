"use strict";
const element = id => document.getElementById(id);
let busy = false;
let currentState;
function showStatus(text, failed = false) { element("status").textContent = text; element("status").classList.toggle("error", failed); }
function updateMethod() {
  const connected = element("deliveryMethod").value === "gmail";
  element("sender").closest("label").hidden = connected;
  element("password").closest("label").hidden = connected;
  element("resume-gmail").hidden = !connected;
  element("smtpHint").hidden = connected;
}
function render(state, updateForm = true) {
  currentState = state;
  if (updateForm) {
    for (const key of ["recipient", "sender"]) element(key).value = state[key] || "";
    for (const key of ["enabled", "includeResponses"]) element(key).checked = state[key] === true;
    element("deliveryMethod").value = state.deliveryMethod || "smtp";
  }
  updateMethod();
  element("test").disabled = !state.deliveryReady;
  element("deliveryStatus").textContent = state.deliveryStatus || "";
  element("reports").replaceChildren();
  if (!state.reports.length) element("reports").textContent = "No reports recorded. Successful tasks do not create emails.";
  for (const report of state.reports) {
    const card = document.createElement("article"), heading = document.createElement("strong"), detail = document.createElement("p");
    heading.textContent = `${report.code || report.source} · ${report.state === "needs_sender" ? "Sender setup required" : report.state} · ${report.id.slice(0, 10)}`;
    detail.textContent = `${new Date(report.createdAt).toLocaleString()} · ${report.reason}${report.state === "pending" && report.nextAttemptAt ? ` · Next attempt: ${new Date(report.nextAttemptAt).toLocaleString()}` : ""}`;
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
async function request(value, updateForm = true) {
  if (busy) return; busy = true;
  const buttons = [...document.querySelectorAll("button")]; const disabled = buttons.map(button => button.disabled);
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await window.errorReporting.request(value);
    if (value.action === "preview" || value.action === "preview-email") {
      element("preview").hidden = false;
      element("preview").textContent = value.action === "preview-email" ? `${result.subject}\n\n${result.text}` : JSON.stringify(result, null, 2);
    }
    else { render(result, updateForm); showStatus(result.lastFailure || (value.action === "test" ? "Test email queued. Delivery status updates automatically." : value.action === "save" ? "Settings saved." : ""), Boolean(result.lastFailure)); }
  } catch (error) { showStatus(error.message || "Reporting settings failed", true); }
  finally { buttons.forEach((button, index) => { if (button.isConnected) button.disabled = disabled[index]; });
    if (currentState) element("test").disabled = !currentState.deliveryReady;
    if (["save", "forget"].includes(value.action)) element("password").value = "";
    busy = false; }
}
element("settings").onsubmit = event => { event.preventDefault(); request({ action: "save", value: {
  recipient: element("recipient").value, sender: element("sender").value, password: element("password").value,
  enabled: element("enabled").checked, includeResponses: element("includeResponses").checked,
  deliveryMethod: element("deliveryMethod").value,
} }); };
for (const action of ["test", "forget", "resume-gmail"]) element(action).onclick = () => request({ action });
element("deliveryMethod").onchange = updateMethod;
element("refresh").onclick = () => request({ action: "status" });
request({ action: "status" });
setInterval(() => { if (!document.hidden) void request({ action: "status" }, false); }, 3000);
