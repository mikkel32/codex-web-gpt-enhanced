const { app, BrowserWindow, webContents } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { installErrorReporting } = require("../electron/error-reporting-app.cjs");
const { installPageInspection } = require("../electron/page-inspection.cjs");
const { formatIncidentEmail } = require("../electron/error-report-email.cjs");
const { DEFAULT_REPORT_RECIPIENT } = require("../electron/error-report-store.cjs");

const home = process.env.MARIA_REPORT_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw new Error("An isolated test home is required");
app.setPath("userData", path.join(home, "electron"));
app.setAppLogsPath(path.join(home, "logs"));
app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const deadline = Date.now() + 10_000; while (!await check()) { if (Date.now() > deadline) throw new Error("Report UI fixture timed out"); await delay(25); } }

app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await parent.loadURL("data:text/html,<p>Owned launcher fixture</p>");
  let credentials; const delivered = []; let time = Date.now();
  // All email is intercepted inside this fixture. No Google account or network is used.
  const sender = { configured: () => Boolean(credentials), account: () => credentials.account,
    save: (account, password) => { credentials = { account, password }; }, forget: () => { credentials = undefined; },
    send: async report => { delivered.push(report); return { accepted: true }; } };
  const api = installErrorReporting({ app, launcherWindow: parent, coreHome: home, senderFactory: () => sender, now: () => time });
  let items;
  const disposeMenu = installPageInspection(parent.webContents, { ownerWindow: parent, menuApi: {
    buildFromTemplate: value => { items = value; return { popup() {}, closePopup() {} }; },
  } });
  parent.webContents.emit("context-menu", { preventDefault() {} }, { x: 1, y: 1, editFlags: {} });
  const entry = items.find(item => item.label === "Automatic error reports…"); assert(entry); entry.click();
  await until(() => webContents.getAllWebContents().some(contents => contents.getURL().endsWith("error-report-settings.html")));
  const page = webContents.getAllWebContents().find(contents => contents.getURL().endsWith("error-report-settings.html"));
  await until(() => page.executeJavaScript('document.getElementById("reports")?.textContent.includes("No reports")'));
  assert.equal(api.snapshot().enabled, false);
  assert.equal(await page.executeJavaScript('document.getElementById("recipient").value'), DEFAULT_REPORT_RECIPIENT);
  await page.executeJavaScript('document.getElementById("enabled").checked=true; document.getElementById("includeResponses").checked=true; document.getElementById("settings").requestSubmit();');
  await until(() => api.snapshot().enabled);
  assert.equal(api.snapshot().senderConfigured, false);
  assert.equal(api.snapshot().deliveryReady, false);
  await until(() => page.executeJavaScript('document.getElementById("deliveryStatus").textContent.includes("Action required")'));
  assert.equal(await page.executeJavaScript('document.getElementById("test").disabled'), true);
  assert.equal(delivered.length, 0);
  await page.executeJavaScript('document.getElementById("sender").value="editing@gmail.com"; document.getElementById("password").value="unsaved-input"; request({ action: "status" }, false)');
  assert.equal(await page.executeJavaScript('document.getElementById("sender").value'), "editing@gmail.com");
  assert.equal(await page.executeJavaScript('document.getElementById("password").value'), "unsaved-input");
  await page.executeJavaScript(`document.getElementById("recipient").value="owner@example.com";
    document.getElementById("sender").value="sender@gmail.com";
    document.getElementById("password").value="abcdefghijklmnop";
    document.getElementById("enabled").checked=true;
    document.getElementById("includeResponses").checked=true;
    document.getElementById("settings").requestSubmit();`);
  await until(() => page.executeJavaScript('document.getElementById("status").textContent === "Settings saved."'));
  assert.equal(api.snapshot().enabled, true);
  assert.equal(await page.executeJavaScript('document.getElementById("password").value'), "");
  assert.equal(await page.executeJavaScript('document.getElementById("test").disabled'), false);
  assert.equal(JSON.stringify(api.snapshot()).includes("abcdefghijklmnop"), false);
  api.capture({ source: "launcher", traceId: "ui-report-test", code: "fixture_failure", error: "Controlled failure for preview",
    webResponse: 'Recorded Web answer. <img src=x onerror="window.bad=true">', codexResponse: "Recorded Codex response.",
    agentDetails: { operation: "Read the API module", expected: "Module contents", actual: "Tool unavailable", completedWork: "Earlier tests passed", remainingWork: "Inspect the module", hypothesis: "A catalog mismatch is possible; unverified" } });
  await page.executeJavaScript('document.getElementById("refresh").click()');
  await until(() => page.executeJavaScript('document.querySelectorAll("article").length === 1'));
  await page.executeJavaScript('document.querySelector("article button").click()');
  await until(() => page.executeJavaScript('document.getElementById("preview").textContent.includes("Recorded Web answer")'));
  assert.equal(await page.executeJavaScript("window.bad === true"), false);
  assert.equal(await page.executeJavaScript("document.querySelectorAll('img').length"), 0);
  await page.executeJavaScript('document.querySelectorAll("article button")[1].click()');
  await until(() => page.executeJavaScript('document.getElementById("preview").textContent.includes("ATTEMPTED OPERATION")'));
  assert.equal(await page.executeJavaScript("window.bad === true"), false);
  const window = BrowserWindow.fromWebContents(page);
  for (const width of [760, 560]) {
    window.setSize(width, 850); await delay(150);
    assert.equal(await page.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false);
    if (process.env.MARIA_REPORT_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.MARIA_REPORT_SCREENSHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.MARIA_REPORT_SCREENSHOT_DIR, `error-reports-${width}.png`), (await page.capturePage()).toPNG());
    }
  }
  time += 30_001; await api.flush(); assert.equal(delivered.length, 1);
  assert.equal(delivered[0].recipient, "owner@example.com");
  await until(() => page.executeJavaScript('document.querySelector("article strong").textContent.includes("sent")'));

  const message = formatIncidentEmail(delivered[0]);
  const mailWindow = new BrowserWindow({ show: false, width: 760, height: 1040,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "mail-preview-fixture" } });
  const mailPage = mailWindow.webContents;
  mailPage.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  await mailWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(message.html)}`);
  assert.equal(await mailPage.executeJavaScript('document.querySelector("h1").textContent'), "An issue needs attention");
  assert.equal(await mailPage.executeJavaScript("document.querySelectorAll('script,img,iframe').length"), 0);
  assert.equal(await mailPage.executeJavaScript("window.bad === true"), false);
  for (const width of [760, 390]) {
    mailWindow.setSize(width, 1040); await delay(150);
    assert.equal(await mailPage.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false);
    if (process.env.MARIA_REPORT_SCREENSHOT_DIR) {
      fs.writeFileSync(path.join(process.env.MARIA_REPORT_SCREENSHOT_DIR, `incident-email-${width}.png`), (await mailPage.capturePage()).toPNG());
      fs.writeFileSync(path.join(process.env.MARIA_REPORT_SCREENSHOT_DIR, "incident-email.html"), message.html);
    }
  }
  mailWindow.destroy();
  await page.executeJavaScript('document.getElementById("deliveryMethod").value="gmail"; document.getElementById("deliveryMethod").dispatchEvent(new Event("change")); document.getElementById("settings").requestSubmit()');
  await until(() => api.snapshot().deliveryMethod === "gmail");
  assert.equal(await page.executeJavaScript('document.getElementById("password").closest("label").hidden'), true);
  assert(api.snapshot().deliveryStatus.includes("No app password"));

  await api.flush(); assert.equal(delivered.length, 1);
  await page.executeJavaScript('document.getElementById("forget").click()');
  await until(() => !api.snapshot().senderConfigured);
  assert.equal(api.snapshot().enabled, false);
  disposeMenu(); api.dispose(); parent.destroy();
  console.log("ERROR_REPORTING_ELECTRON_OK default-recipient capture-without-sender detailed-email-preview escaped-html widths=760,560,390 password-cleared one-fixture-delivery disabled-cleanly no-live-email");
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
