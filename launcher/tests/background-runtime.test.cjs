const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const { RuntimeSupervisor } = require("../electron/runtime-supervisor.cjs");

test("native transport survives its UI parent exiting and a new UI adopts the same PID", { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-background-test-"));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const config = { mode: "browser-only", releaseVersion: "test", host: "127.0.0.1", port, controlToken: "fixture" };
  const daemonCode = `
    const http=require('node:http'); let accepting=true,connected=true;
    const server=http.createServer((req,res)=>{
      console.log('daemon log after UI exit');
      if(req.url==='/admin/browser-detach')connected=false;
      if(req.url==='/admin/resume'){connected=true;accepting=true;}
      if(req.url==='/admin/drain')accepting=false;
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({status:'ok',service:'codex-chatgpt-web',version:'test',mode:'browser-only',pid:process.pid,background_capable:true,browser_connected:connected,accepting_turns:accepting,active_browser_turns:0,active_http_turns:0}));
      if(req.url==='/admin/shutdown')server.close(()=>process.exit(0));
    });server.listen(${port},'127.0.0.1');`;
  const modulePath = require.resolve("../electron/runtime-supervisor.cjs");
  const parent = `
    const {RuntimeSupervisor}=require(${JSON.stringify(modulePath)});
    const fs=require('node:fs'); const config=${JSON.stringify(config)};
    const s=new RuntimeSupervisor({app:{getVersion:()=> 'test'},coreHome:${JSON.stringify(root)},browserDescriptorPath:${JSON.stringify(path.join(root,"browser.json"))},logger:{info(){},warn(){},error(){}}});
    s.readConfig=()=>config;
    (async()=>{s.spawnChild('daemon',{executable:process.execPath,args:['-e',${JSON.stringify(daemonCode)}],cwd:${JSON.stringify(root)}});
    await s.waitForProxy(config);const outcome=await s.leaveNativeTransportRunning();
    fs.writeFileSync(${JSON.stringify(path.join(root,"ready.json"))},JSON.stringify(outcome));})().catch(e=>{console.error(e);process.exit(1)});`;
  let supervisor;
  let pid;
  try {
    const result = spawnSync(process.execPath, ["-e", parent], { timeout: 10000, encoding: "utf8" });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    const ready = JSON.parse(fs.readFileSync(path.join(root, "ready.json"), "utf8"));
    pid = ready.daemonPid;
    assert.equal(ready.status, "background");
    const before = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
    assert.equal(before.pid, pid);
    assert.equal(before.browser_connected, false);
    supervisor = new RuntimeSupervisor({
      app: { getVersion: () => "test" }, coreHome: root,
      browserDescriptorPath: path.join(root, "browser.json"),
      logger: { info() {}, warn() {}, error() {} },
      runtimeInvocationFactory() { throw new Error("Adoption must not start another daemon"); },
    });
    supervisor.readConfig = () => config;
    const adopted = await supervisor.startIfConfigured();
    assert.equal(adopted.status, "ready");
    assert.equal(adopted.daemonPid, pid);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).browser_connected, true);
    await supervisor.stopForSetup();
    pid = undefined;
  } finally {
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
    supervisor?.daemon?.release?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("active Web work stays in the background instead of being cancelled on quit", async () => {
  let detached = false;
  const fixture = {
    launcherProfile: "production", daemon: { pid: 123 }, readConfig: () => ({}),
    proxyHealthPayload: async () => ({ background_capable: true, active_browser_turns: 1 }),
    proxyHealth: async () => true,
    control: async () => { detached = true; },
  };
  assert.deepEqual(await RuntimeSupervisor.prototype.leaveNativeTransportRunning.call(fixture), { status: "browser-busy" });
  assert.equal(detached, false);
});
