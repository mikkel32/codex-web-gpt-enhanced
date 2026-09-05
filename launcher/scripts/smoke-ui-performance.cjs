// Production renderer stress and interaction checks, with an optional baseline build.
const { chromium } = require('playwright-core');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function serve(root){const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root)){res.writeHead(403).end();return;}try{res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`})));}
function fixture(options){
 const listeners={};window.testListeners=listeners;window.testCalls=0;
 const state={version:1,language:'en',onboardingComplete:true,autoStart:true,keepRunningOnClose:true,showBrowserDuringTurns:true,browserInteractionMode:'automatic',experimentalBiggerContext:options?.biggerContext!==false,zeroRiskProEnabled:false,sidebarOpen:true,sidebarWidth:252,coreSetupComplete:true,codexCatalogVerified:true,mcpSetupComplete:true,mcpGuideStep:0,sessionRefreshReminderAt:null};
 const b={status:'ready',message:'Ready',url:'',title:'ChatGPT',authenticated:true,visible:false,surfaceActive:false,loading:false,canGoBack:false,canGoForward:false,zoomFactor:1,activeTabId:'main',maxTabs:5,tabs:[]};
 const snapshot={profile:'production',profilePaths:{coreHome:'test',codexHome:'test',userData:'test'},state,browser:b,connectorName:'Codex Native2',connectorNames:{automatic:'Codex Native2',manual:'Codex Zero Risk'},mcpCredentialsConfigured:true,logs:[],urls:{github:'https://github.com/mikkel32/codex-web-gpt-enhanced',connectors:'',tunnels:'',keys:''},platform:'darwin',packaged:true,version:'5.5.0',smokePassed:true,operation:null,update:{status:'up-to-date',latestVersion:'5.5.0'}};
 window.testBrowser=b;
 window.codexWebLauncher=new Proxy({snapshot:async()=>snapshot,logs:async()=>[],connectionStatus:async()=>{window.testCalls++;return {nativeAvailable:true,browserConnected:true,activeBrowserTurns:0,recoveryAvailable:true};},setBrowserSurfaceActive:async()=>b,setBrowserBounds:async()=>true,copyNativeCodexCommand:async()=>true}, {get(t,k){if(k in t)return t[k];if(String(k).startsWith('on'))return listener=>{(listeners[k]??=new Set()).add(listener);return()=>listeners[k].delete(listener);};return async()=>state;}});
}
(async()=>{const browser=await chromium.launch({channel:'chromium',headless:true});const results=[];
try{for(const [name,root] of [...(process.env.MARIA_BASELINE_RENDERER ? [['before',path.resolve(process.env.MARIA_BASELINE_RENDERER)]] : []), ['after',path.resolve(__dirname,'../dist')]]){
 const {server,url}=await serve(root);
 try{for(const width of name==='after'?[1180,700]:[1180]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addInitScript(fixture,{biggerContext:name==='before'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.getByRole('button',{name:'Open ChatGPT',exact:true}).waitFor();await page.waitForTimeout(900);
  if(name==='after')await page.screenshot({path:`${require('node:os').tmpdir()}/maria-moonlight-${width}.png`});
  const idle=await page.evaluate(()=>({animations:document.getAnimations().filter(x=>x.playState==='running').length,logSubscribers:window.testListeners.onLog?.size??0,connectionCalls:window.testCalls,overflow:document.documentElement.scrollWidth>innerWidth}));
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));const start=await metrics();
  await page.evaluate(async()=>{for(let n=0;n<800;n++){for(const cb of window.testListeners.onLog??[])cb({at:new Date().toISOString(),level:'info',event:'runtime.progress',detail:{text:'progress '+n}});for(const cb of window.testListeners.onBrowserState??[])cb({...window.testBrowser});await new Promise(r=>setTimeout(r,2));}});
  const end=await metrics();
  if(width<820)await page.getByRole('button',{name:'Show sidebar',exact:true}).click();await page.getByRole('button',{name:'Activity',exact:true}).click();await page.locator('.activity-table').waitFor({state:'visible'});await page.waitForFunction(()=>window.testListeners.onLog?.size===1);
  await page.evaluate(()=>{for(let n=0;n<500;n++)for(const cb of window.testListeners.onLog??[])cb({at:new Date().toISOString(),level:'info',event:'runtime.progress',detail:{text:'visible '+n}});});await page.waitForTimeout(200);
  const rows=await page.locator('.activity-row').count();
  if(name==='after'&&(idle.logSubscribers!==0||idle.animations!==0||rows!==300||idle.overflow||errors.length))throw Error(JSON.stringify({idle,rows,errors}));
  results.push({name,width,idle,rows,scriptMs:Math.round((end.ScriptDuration-start.ScriptDuration)*1000),taskMs:Math.round((end.TaskDuration-start.TaskDuration)*1000),errors});
  if(width<820)await page.getByRole('button',{name:'Show sidebar',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Launcher settings',exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.surface-transition')].every(e=>Number(getComputedStyle(e).opacity)>.999));if(name==='after')await page.screenshot({path:`${require('node:os').tmpdir()}/maria-settings-${width}.png`});
  if(name==='after') {
   if(width<820)await page.getByRole('button',{name:'Show sidebar',exact:true}).click();
   await page.getByRole('button',{name:'Overview',exact:true}).click();await page.locator('.moon-home').waitFor({state:'visible'});
   await page.clock.install();await page.waitForTimeout(50);
   const calls=await page.evaluate(()=>window.testCalls);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   await page.clock.fastForward(60000);
   if(await page.evaluate(()=>window.testCalls)!==calls)throw Error('Hidden overview continued polling');
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(20);
   if(await page.evaluate(()=>window.testCalls)!==calls+1)throw Error('Visible overview did not reconnect once');
  }
  if(name==='after') {
   await page.evaluate(()=>{
    window.testResumeCalls=0;
    window.codexWebLauncher.resumeWebAccess=async()=>{window.testResumeCalls++;const b={...window.testBrowser,webAccess:{status:'ready'}};for(const cb of window.testListeners.onBrowserState??[])cb(b);return b;};
    const webAccess={status:'paused',reason:'rate-limit',detectedAt:new Date().toISOString(),retryAt:new Date(Date.now()+60000).toISOString(),incidents:1,canResume:false};
    for(const cb of window.testListeners.onBrowserState??[])cb({...window.testBrowser,webAccess});
   });
   await page.clock.fastForward(50);
   await page.getByText('Giving ChatGPT a moment',{exact:true}).waitFor();
   if(await page.getByRole('button',{name:'Waiting for cooldown',exact:true}).isEnabled())throw Error('Resume was enabled before cooldown');
   await page.screenshot({path:`${require('node:os').tmpdir()}/maria-paused-${width}.png`});
   await page.clock.fastForward(61000);
   await page.getByRole('button',{name:'Resume WebGPT',exact:true}).click();await page.clock.fastForward(30);
   if(await page.locator('.web-access-notice').count()!==0||await page.evaluate(()=>window.testResumeCalls)!==1)throw Error('Explicit resume did not clear the notice exactly once');
  }
  await context.close();
 }}finally{await new Promise(r=>server.close(r));}
}console.log(JSON.stringify(results,null,2));fs.writeFileSync(path.join(require('node:os').tmpdir(),'maria-ui-performance.json'),JSON.stringify(results,null,2));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
