const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { BrowserAccessGate, retryAfterTime } = require('../electron/browser-access.cjs');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { BrowserControlServer } = require('../electron/control-server.cjs');

test('Retry-After supports seconds and dates without shortening server cooldowns', () => {
  const now = Date.parse('2026-09-05T10:00:00Z');
  assert.equal(retryAfterTime('120', now), now + 120000);
  assert.equal(retryAfterTime('Sat, 05 Sep 2026 10:05:00 GMT', now), now + 300000);
  assert.equal(retryAfterTime('garbage', now), null);
  const gate = new BrowserAccessGate({now:()=>now});
  gate.pause('rate-limit', '3600');gate.pause('rate-limit', '10');
  assert.equal(Date.parse(gate.snapshot().retryAt), now + 3600000);
  assert.equal(gate.snapshot().incidents, 1);
  assert.throws(()=>gate.resume(), /cooldown has not ended/);
});

test('paused access survives restart and never clears itself when the timer ends', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'maria-access-'));
  try {
    const filePath=path.join(root,'pause.json');let now=Date.now();
    new BrowserAccessGate({filePath,now:()=>now}).pause('rate-limit','60');
    now+=61000;const restored=new BrowserAccessGate({filePath,now:()=>now});
    assert.equal(restored.snapshot().canResume,true);
    assert.throws(()=>restored.assertAvailable(), /sending is paused/);
    restored.resume();assert.equal(restored.snapshot().status,'ready');
    assert.equal(fs.existsSync(filePath),false);
    restored.pause('verification');
    if(process.platform!=='win32')assert.equal(fs.statSync(filePath).mode&0o777,0o600);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(filePath))).sort(),['detectedAt','incidents','reason','retryAt','version']);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('a new rate-limit signal after a short cooldown establishes another wait', () => {
  let now=Date.parse('2026-09-05T10:00:00Z');
  const gate=new BrowserAccessGate({now:()=>now});
  gate.pause('rate-limit','10');now+=11000;gate.pause('rate-limit');
  assert.equal(Date.parse(gate.snapshot().retryAt),now+60000);
  assert.throws(()=>gate.resume(),/cooldown has not ended/);
});

test('one profile spaces sends deterministically and rejects cancelled reservations', async () => {
  let now=0;const sends=[];
  const gate=new BrowserAccessGate({now:()=>now,wait:async ms=>{now+=ms;}});
  await Promise.all(Array.from({length:5},()=>gate.beforeSend().then(()=>sends.push(now))));
  assert.deepEqual(sends,[0,2000,4000,6000,8000]);
  await assert.rejects(gate.beforeSend(()=>false),/pending Web send was stopped/);
});

test('pause and user resume invalidate already queued sends instead of replaying them', async () => {
  let release;let now=0;
  const gate=new BrowserAccessGate({now:()=>now,wait:()=>new Promise(r=>{release=r;})});
  await gate.beforeSend();const queued=gate.beforeSend();await Promise.resolve();
  gate.pause('verification');gate.resume();now=2000;release();
  await assert.rejects(queued,/pending Web send was stopped/);
});

test('challenge and cooldown signals are limited to owned ChatGPT surfaces', () => {
  const gate=new BrowserAccessGate();const writes=[];
  const host=Object.assign(Object.create(BrowserHost.prototype),{
    accessGate:gate,turnTabs:new Map([['turn',{id:'turn',view:{webContents:{id:9,isDestroyed:()=>false}}}]]),
    view:{webContents:{id:7,isDestroyed:()=>false}},logger:{warn:(...args)=>writes.push(args)},
  });
  assert.equal(host.handleChatGptBackendResponse({webContentsId:99,url:'https://chatgpt.com/backend-api/me',statusCode:429}),false);
  assert.equal(host.handleChatGptBackendResponse({webContentsId:9,url:'https://example.com/backend-api/me',statusCode:429}),false);
  assert.equal(gate.snapshot().status,'ready');
  assert.equal(host.handleChatGptBackendResponse({webContentsId:9,url:'https://chatgpt.com/c/123456789',statusCode:403,responseHeaders:{'cf-mitigated':['challenge']}}),true);
  assert.equal(gate.snapshot().reason,'verification');
  host.handleChatGptBackendResponse({webContentsId:9,url:'https://chatgpt.com/backend-api/me',statusCode:200});
  assert.equal(gate.snapshot().status,'paused');
  assert.equal(host.accessReviewTabId,'turn');
  assert.equal(writes.length,1);
});

test('authenticated control requests return a terminal pause before browser allocation', async () => {
  const gate=new BrowserAccessGate();gate.pause('verification');let allocations=0;
  const host={browserInteractionMode:()=> 'automatic',beginTurn:()=>{gate.assertAvailable();allocations++;}};
  const server=await new BrowserControlServer({logger:{info(){},warn(){}},getBrowserHost:()=>host,getPreferences:()=>({})}).start();
  try {
    const d=server.descriptor();const response=await fetch(d.endpoint+'/v1/turn/start',{method:'POST',headers:{authorization:'Bearer '+d.token,'content-type':'application/json'},body:JSON.stringify({traceId:'trace_blocked',helperPid:process.pid})});
    assert.equal(response.status,409);assert.equal((await response.json()).code,'browser_access_paused');assert.equal(allocations,0);
  } finally {await server.close();}
});

test('duplicate Send admission calls share one pacing slot', async () => {
  let release;let admissions=0;
  const tab={id:'one-tab',traceId:'trace_one_send',helperPid:10,status:'running',interactionMode:'automatic'};
  const host=Object.assign(Object.create(BrowserHost.prototype),{turnTabs:new Map([[tab.id,tab]]),accessGate:{beforeSend:()=>{admissions++;return new Promise(r=>{release=r;});}}});
  const attempts=Array.from({length:8},()=>host.rememberConversationSubmission(tab.traceId,10));
  assert.equal(admissions,1);assert.equal(tab.submissionActivated,undefined);
  release();await Promise.all(attempts);
  assert.equal(tab.submissionActivated,true);assert.equal(tab.sendAdmission,null);
});
