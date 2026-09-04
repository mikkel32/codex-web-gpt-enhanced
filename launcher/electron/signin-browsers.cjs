const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CONNECTOR_ID = "oadediebidckmhndgoamkdkcdebkcjbe";

function signInBrowsers({ platform = process.platform, environment = process.env, exists = fs.existsSync } = {}) {
  const candidates = platform === "darwin" ? {
    chrome: ["/Applications/Google Chrome.app"],
    edge: ["/Applications/Microsoft Edge.app"],
    safari: ["/Applications/Safari.app", "/System/Applications/Safari.app"],
  } : platform === "win32" ? {
    chrome: [environment.PROGRAMFILES, environment["PROGRAMFILES(X86)"], environment.LOCALAPPDATA].filter(Boolean).map(base => path.win32.join(base, "Google", "Chrome", "Application", "chrome.exe")),
    edge: [environment["PROGRAMFILES(X86)"], environment.PROGRAMFILES].filter(Boolean).map(base => path.win32.join(base, "Microsoft", "Edge", "Application", "msedge.exe")),
    safari: [],
  } : {
    chrome: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
    edge: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"], safari: [],
  };
  return Object.entries(candidates).map(([id, paths]) => ({
    id, name: ({ chrome: "Google Chrome", edge: "Microsoft Edge", safari: "Safari" })[id],
    executable: paths.find(candidate => exists(candidate)) || null,
  }));
}

function browserSignInInvocation(browser, action, code, platform = process.platform, extensionId = CONNECTOR_ID) {
  if (!browser?.executable || !["chrome", "edge", "safari"].includes(browser.id)) throw new Error("This browser is not installed");
  let url;
  if (action === "setup") url = browser.id === "edge" ? "edge://extensions" : browser.id === "chrome" ? "chrome://extensions" : "https://chatgpt.com/";
  else if (action === "connect") {
    if (!/^maria1:\d{1,5}:[a-f0-9]{64}$/.test(code || "")) throw new Error("Create a fresh browser connection in Maria");
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Browser connector identity is invalid");
    url = browser.id === "safari" ? "https://chatgpt.com/" : `chrome-extension://${extensionId}/connect.html#${encodeURIComponent(code)}`;
  } else throw new Error("Unknown browser sign-in action");
  return platform === "darwin" ? { executable: "/usr/bin/open", args: ["-a", browser.executable, url] }
    : { executable: browser.executable, args: [url] };
}

function openSignInBrowser(browser, action, code, extensionId = CONNECTOR_ID) {
  const invocation = browserSignInInvocation(browser, action, code, process.platform, extensionId);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, { detached: true, windowsHide: true, stdio: "ignore" });
    child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(true); });
  });
}

module.exports = { CONNECTOR_ID, signInBrowsers, browserSignInInvocation, openSignInBrowser };
