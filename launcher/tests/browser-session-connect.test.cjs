const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserSessionConnect, validatedBrowserState } = require("../electron/browser-session-connect.cjs");

const origin = "chrome-extension://oadediebidckmhndgoamkdkcdebkcjbe";
const cookie = { domain: ".chatgpt.com", name: "session", value: "test-session", path: "/", secure: true, httpOnly: true, sameSite: "Lax", expires: -1 };
function address(flow) { const [, port, token] = flow.code.split(":"); return { base: `http://127.0.0.1:${port}`, headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" } }; }

test("browser sign-in accepts one scoped session and reports success only after verification", async () => {
  let finish; let imported;
  const verified = new Promise(resolve => { finish = resolve; });
  const server = new BrowserSessionConnect({ importSession: async transfer => { imported = structuredClone(transfer.storageState); return verified; } });
  try {
    const flow = await server.begin("chrome"); const { base, headers } = address(flow);
    const payload = { version: 1, cookies: [cookie, { ...cookie, domain: ".google.com" }, { ...cookie, domain: "chatgpt.com.attacker.test" }] };
    assert.equal((await fetch(base + "/session", { method: "POST", headers, body: JSON.stringify(payload) })).status, 202);
    assert.equal(server.snapshot().phase, "verifying");
    assert.equal(imported.cookies.length, 1);
    assert.equal((await fetch(base + "/session", { method: "POST", headers, body: JSON.stringify(payload) })).status, 409);
    await assert.rejects(server.begin("edge"), /still being verified/);
    finish({ authenticated: true }); await new Promise(resolve => setImmediate(resolve));
    const status = await (await fetch(base + "/status", { headers })).json();
    assert.equal(status.phase, "connected");
    assert.equal(JSON.stringify(status).includes(cookie.value), false);
    assert.equal("code" in status, false);
    const { origin: _origin, ...withoutOrigin } = headers;
    assert.equal((await fetch(base + "/status", { headers: withoutOrigin })).status, 200);
    assert.equal((await fetch(base + "/session", { method: "POST", headers: withoutOrigin, body: JSON.stringify(payload) })).status, 403);
  } finally { finish?.({ authenticated: true }); await server.close(); }
});

test("remote websites, wrong codes, expired flows, and cross-origin replay cannot import a session", async () => {
  let now = 1000; let imports = 0;
  const server = new BrowserSessionConnect({ now: () => now, importSession: async () => { imports++; return { authenticated: true }; } });
  try {
    const flow = await server.begin("edge"); const { base, headers } = address(flow);
    const body = JSON.stringify({ version: 1, cookies: [cookie] });
    assert.equal((await fetch(base + "/session", { method: "POST", headers: { ...headers, origin: "https://attacker.test" }, body })).status, 403);
    assert.equal((await fetch(base + "/session", { method: "POST", headers: { ...headers, authorization: "Bearer invalid" }, body })).status, 401);
    now += 5 * 60_000;
    assert.equal((await fetch(base + "/session", { method: "POST", headers, body })).status, 410);
    assert.equal(imports, 0);
  } finally { await server.close(); }
});

test("an unverified session is never presented as signed in", async () => {
  const server = new BrowserSessionConnect({ importSession: async () => ({ authenticated: false }) });
  try {
    const { base, headers } = address(await server.begin("safari"));
    await fetch(base + "/session", { method: "POST", headers, body: JSON.stringify({ version: 1, cookies: [cookie] }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(server.snapshot().phase, "error");
    assert.match(server.snapshot().message, /could not verify/);
  } finally { await server.close(); }
});

test("browser data rejects malformed cookies and discards unrelated origins and local storage", () => {
  assert.throws(() => validatedBrowserState({ version: 1, cookies: [{ ...cookie, httpOnly: "yes" }] }), /security attributes/);
  assert.throws(() => validatedBrowserState({ version: 1, cookies: [{ ...cookie, domain: ".example.com" }] }), /no ChatGPT/);
  assert.deepEqual(validatedBrowserState({ version: 1, cookies: [cookie], origins: [{ origin: "https://example.com", localStorage: [{ name: "secret", value: "private" }] }] }).origins, []);
});
