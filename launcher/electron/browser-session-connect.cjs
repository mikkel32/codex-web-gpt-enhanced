const crypto = require("node:crypto");
const http = require("node:http");
const { validatePasskeyLoginState } = require("./passkey-login-state.cjs");

const MAX_BODY = 1024 * 1024;
const PAIRING_TTL = 5 * 60_000;

function extensionOrigin(value) {
  if (typeof value !== "string") return false;
  return /^chrome-extension:\/\/[a-p]{32}$/.test(value)
    || /^safari-web-extension:\/\/[a-zA-Z0-9-]{16,80}$/.test(value);
}

function secretMatches(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validatedBrowserState(body) {
  if (!body || body.version !== 1 || !Array.isArray(body.cookies)) throw new Error("Browser connector payload is invalid");
  // Browsers return no unrelated sites: also enforce that boundary on the receiver.
  const cookies = body.cookies.filter(cookie => cookie && typeof cookie.domain === "string"
    && /^(\.?chatgpt\.com|\.?auth\.openai\.com)$/.test(cookie.domain));
  const state = { cookies, origins: [] };
  validatePasskeyLoginState(state);
  return state;
}

class BrowserSessionConnect {
  constructor({ importSession, now = Date.now }) {
    this.importSession = importSession; this.now = now; this.current = null; this.server = null;
  }
  snapshot() {
    const flow = this.current;
    if (!flow) return { phase: "idle" };
    if (flow.phase === "waiting" && this.now() >= flow.expiresAt) flow.phase = "expired";
    return { phase: flow.phase, browser: flow.browser, expiresAt: flow.expiresAt, ...(flow.message ? { message: flow.message } : {}) };
  }
  async begin(browser) {
    if (!["chrome", "edge", "safari"].includes(browser)) throw new Error("Choose Chrome, Edge, or Safari");
    if (this.current?.phase === "verifying") throw new Error("The current browser session is still being verified");
    if (this.current) this.current.phase = "cancelled";
    await this.close();
    this.current = { browser, token: crypto.randomBytes(32).toString("hex"), expiresAt: this.now() + PAIRING_TTL, phase: "waiting", origin: null };
    this.server = http.createServer((request, response) => { void this.handle(request, response); });
    this.server.requestTimeout = 10_000;
    this.server.headersTimeout = 10_000;
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolve); });
    const port = this.server.address().port;
    this.current.port = port;
    return { ...this.snapshot(), code: `maria1:${port}:${this.current.token}` };
  }
  async handle(request, response) {
    const flow = this.current;
    const origin = request.headers.origin;
    // Chromium omits Origin on privileged extension GETs. Only a previously
    // bound extension may poll, and the same private token is still required.
    const originlessStatus = request.method === "GET" && request.url === "/status"
      && origin === undefined && extensionOrigin(flow?.origin);
    const json = (status, value) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
    if (!flow || (!extensionOrigin(origin) && !originlessStatus) || request.headers.host !== `127.0.0.1:${flow.port}`) return json(403, { error: "Browser connection was not authorized" });
    response.setHeader("access-control-allow-origin", origin || flow.origin);
    response.setHeader("vary", "Origin");
    if (request.method === "OPTIONS") {
      response.setHeader("access-control-allow-methods", "GET, POST");
      response.setHeader("access-control-allow-headers", "authorization, content-type");
      response.setHeader("access-control-allow-private-network", "true");
      return json(200, { ok: true });
    }
    if (!secretMatches(request.headers.authorization, `Bearer ${flow.token}`)
      || (origin && flow.origin && flow.origin !== origin)) return json(401, { error: "Connection code is invalid" });
    this.snapshot();
    if (flow.phase === "expired" || flow.phase === "cancelled") return json(410, { error: "Create a new connection code in Maria" });
    if (request.method === "GET" && request.url === "/status") return json(200, this.snapshot());
    if (request.method !== "POST" || request.url !== "/session") return json(404, { error: "Not found" });
    if (flow.phase !== "waiting") return json(409, { error: "This session has already been submitted" });
    if (!String(request.headers["content-type"] || "").startsWith("application/json")) return json(415, { error: "Expected JSON" });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) return json(413, { error: "Browser sign-in data is too large" });
        chunks.push(chunk);
      }
      if (this.current !== flow || flow.phase !== "waiting" || this.now() >= flow.expiresAt) return json(409, { error: "Start a new browser connection" });
      const state = validatedBrowserState(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      flow.phase = "verifying"; flow.origin = origin;
      json(202, { phase: "verifying" });
      try {
        const browser = await this.importSession({ storageState: state, cleanup: async () => {} });
        if (browser?.authenticated !== true) throw new Error("Maria could not verify this ChatGPT session. Sign in in the selected browser and reconnect.");
        flow.phase = "connected";
      } catch (error) {
        flow.phase = "error";
        flow.message = error instanceof Error ? error.message : "Browser session verification failed";
      } finally { state.cookies.length = 0; }
    } catch {
      if (!response.headersSent) json(400, { error: "The browser connector sent invalid sign-in data" });
    }
  }
  async cancel() {
    if (this.current?.phase === "verifying") throw new Error("Wait for session verification to finish");
    if (this.current) this.current.phase = "cancelled";
    await this.close();
    return this.snapshot();
  }
  async close() {
    const server = this.server; this.server = null;
    if (server) { server.closeIdleConnections?.(); await new Promise(resolve => server.close(resolve)); }
  }
}

module.exports = { BrowserSessionConnect, validatedBrowserState, extensionOrigin };
