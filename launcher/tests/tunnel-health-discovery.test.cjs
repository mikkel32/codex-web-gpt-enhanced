const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RuntimeSupervisor } = require("../electron/runtime-supervisor.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-health-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tunnelId = `tunnel_${"a".repeat(32)}`;
  const urlFile = path.join(root, "health.url");
  const profilePath = path.join(root, "owned.yaml");
  const config = { tunnel: { alias: "owned", profileName: "owned", profileDir: root, tunnelId, binaryPath: path.join(root, "tunnel-client") } };
  const profile = { control_plane: { tunnel_id: tunnelId, api_key: "file:/not-read-by-discovery" }, health: { url_file: urlFile } };
  fs.writeFileSync(profilePath, JSON.stringify(profile));
  fs.writeFileSync(urlFile, "http://127.0.0.1:43127/healthz\n");
  const supervisor = new RuntimeSupervisor({ app: { getVersion: () => "0.2.0", isPackaged: false },
    logger: { info() {}, warn() {}, error() {} }, sourceRoot: root, coreHome: root,
    browserDescriptorPath: path.join(root, "launcher.json") });
  supervisor.runTunnelCommand = async () => ({ code: 0, output: JSON.stringify({ entries: [
    { alias: "owned", runtime_state: "ready", live_runtime: { found: false } },
  ] }) });
  supervisor.probeTunnelMcpTransport = async () => ({ observed: true, ok: true, fatal: false, detail: "verified" });
  return { supervisor, config, urlFile, profilePath, profile };
}

test("ready managed runtime discovers health when optional admin inventory is absent", async t => {
  const f = fixture(t);
  await f.supervisor.waitForTunnelMcpTransport(f.config, 50);
  assert.equal(f.supervisor.tunnelHealthBaseUrl, "http://127.0.0.1:43127");
});

test("profile health fallback refuses other tunnels, remote URLs and oversized files", async t => {
  const f = fixture(t);
  f.profile.control_plane.tunnel_id = `tunnel_${"b".repeat(32)}`;
  fs.writeFileSync(f.profilePath, JSON.stringify(f.profile));
  await assert.rejects(f.supervisor.discoverTunnelHealthBaseUrl(f.config), /no verified loopback endpoint/);
  f.profile.control_plane.tunnel_id = f.config.tunnel.tunnelId;
  fs.writeFileSync(f.profilePath, JSON.stringify(f.profile));
  fs.writeFileSync(f.urlFile, "https://example.com/healthz");
  await assert.rejects(f.supervisor.discoverTunnelHealthBaseUrl(f.config), /no verified loopback endpoint/);
  fs.writeFileSync(f.urlFile, "x".repeat(4097));
  await assert.rejects(f.supervisor.discoverTunnelHealthBaseUrl(f.config), /no verified loopback endpoint/);
});

test("stopped inventory does not resurrect a stale health URL", async t => {
  const f = fixture(t);
  f.supervisor.runTunnelCommand = async () => ({ code: 0, output: JSON.stringify({ entries: [
    { alias: "owned", runtime_state: "stopped", live_runtime: { found: false } },
  ] }) });
  await assert.rejects(f.supervisor.discoverTunnelHealthBaseUrl(f.config), /no verified loopback endpoint/);
});

test("health discovery shares the bounded MCP readiness retry deadline", async t => {
  const f = fixture(t);
  let probes = 0;
  f.supervisor.discoverTunnelHealthBaseUrl = async () => {
    probes += 1;
    if (probes === 1) throw new Error("URL file not ready yet");
    f.supervisor.tunnelHealthBaseUrl = "http://127.0.0.1:43127";
  };
  await f.supervisor.waitForTunnelMcpTransport(f.config, 1200);
  assert.equal(probes, 2);
});
