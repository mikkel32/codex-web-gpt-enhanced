const api = globalThis.browser || globalThis.chrome;
const code = document.getElementById("code");
const button = document.getElementById("connect");
const status = document.getElementById("status");
if (location.hash) {
  code.value = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
}

function portableCookie(cookie) {
  return {
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
    secure: cookie.secure, httpOnly: cookie.httpOnly,
    sameSite: ({ strict: "Strict", lax: "Lax", no_restriction: "None", unspecified: "Lax" })[cookie.sameSite] || "Lax",
    expires: cookie.expirationDate ?? -1,
  };
}

button.addEventListener("click", async () => {
  const match = /^maria1:(\d{1,5}):([a-f0-9]{64})$/.exec(code.value.trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
    status.textContent = "Copy a fresh connection code from Maria first."; return;
  }
  const endpoint = `http://127.0.0.1:${match[1]}`;
  const headers = { authorization: `Bearer ${match[2]}`, "content-type": "application/json" };
  button.disabled = true; code.disabled = true;
  try {
    if (!api?.cookies?.getAll) throw new Error("Enable the Maria connector's website access, or use Chrome or Edge to connect this login.");
    status.textContent = "Reading this browser's ChatGPT sign-in…";
    const groups = await Promise.all([
      api.cookies.getAll({ domain: "chatgpt.com" }), api.cookies.getAll({ domain: "auth.openai.com" }),
    ]);
    const cookies = groups.flat().filter(cookie => !cookie.partitionKey
      && /^(\.?chatgpt\.com|\.?auth\.openai\.com)$/.test(cookie.domain)).map(portableCookie);
    for (const group of groups) group.length = 0;
    if (!cookies.length) throw new Error("No ChatGPT sign-in was found. Sign in at chatgpt.com in this browser, then try again.");
    const response = await fetch(`${endpoint}/session`, {
      method: "POST", headers, body: JSON.stringify({ version: 1, cookies }), credentials: "omit",
    });
    cookies.length = 0;
    const submitted = await response.json();
    if (!response.ok) throw new Error(submitted.error || "Maria did not accept this connection");
    status.textContent = "Verifying your sign-in inside Maria… Finish any browser confirmation there.";
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const check = await fetch(`${endpoint}/status`, { headers, credentials: "omit", cache: "no-store" });
      const result = await check.json();
      if (!check.ok) throw new Error(result.error || "Connection expired");
      if (result.phase === "connected") {
        code.value = ""; status.textContent = "Connected. Return to Maria — your ChatGPT session is ready."; return;
      }
      if (result.phase === "error") throw new Error(result.message || "Sign-in could not be verified");
    }
    throw new Error("Verification took too long. Check Maria for the connection status.");
  } catch (error) {
    status.textContent = error instanceof TypeError ? "Maria is not reachable. Open Maria and create a new connection code." : error.message;
  } finally { button.disabled = false; code.disabled = false; }
});
