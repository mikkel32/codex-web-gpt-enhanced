// Credential-free renderer acceptance. Build first; use MARIA_CHROMIUM_EXECUTABLE_PATH for a local browser.
const { chromium, _electron: electron } = require('playwright-core');
const { pathToFileURL } = require('node:url');
const { tmpdir } = require('node:os');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
function fixture({ language = 'en', firstRun = false, manual = false, development = false, offline = false, onboarding = false, recovering = false } = {}) {
  const listeners = {};
  const state = { version: 1, language, onboardingComplete: !onboarding, browserInteractionMode: manual ? 'manual' : 'automatic',
    autoStart: true, keepRunningOnClose: true, showBrowserDuringTurns: true, experimentalBiggerContext: true,
    zeroRiskProEnabled: false, sidebarOpen: true, sidebarWidth: 252, coreSetupComplete: !firstRun,
    codexCatalogVerified: !firstRun, mcpSetupComplete: !firstRun, mcpRuntimeInstalled: !firstRun,
    mcpGuideStep: 0, sessionRefreshReminderAt: null };
  const browser = { status: firstRun ? 'signed-out' : 'ready', message: 'Ready', url: '', title: 'ChatGPT', authenticated: !firstRun,
    visible: false, surfaceActive: false, loading: false, canGoBack: false, canGoForward: false, zoomFactor: 1,
    activeTabId: 'home', maxTabs: 5, tabs: [], webAccess: { status: 'ready' } };
  const snapshot = { state, browser, profile: development ? 'development' : 'production', profilePaths: {
    coreHome: '/fixture/core', codexHome: '/fixture/codex-config', userData: '/fixture/launcher' },
    connectorName: manual ? 'Codex Zero Risk' : 'Codex Native2', connectorNames: { automatic: 'Codex Native2', manual: 'Codex Zero Risk' },
    mcpCredentialsConfigured: !firstRun, logs: [], urls: { github: 'https://github.com/mikkel32/codex-web-gpt-enhanced', connectors: '', keys: '', tunnels: '' },
    version: 'fixture', platform: 'darwin', packaged: true, operation: null, update: { status: 'up-to-date' } };
  window.testConnectionStatus = { nativeAvailable: !offline && !recovering, browserConnected: true,
    activeBrowserTurns: 0, phase: recovering ? 'recovering' : offline ? 'offline' : 'online' };
  window.testSnapshot = snapshot; window.testListeners = listeners; window.testDoctorCalls = 0; window.testMutations = 0;
  window.codexWebLauncher = new Proxy({ snapshot: async () => snapshot, logs: async () => [],
    connectionStatus: async () => window.testConnectionStatus,
    doctor: async () => { window.testDoctorCalls++; await new Promise(resolve => setTimeout(resolve, 150)); return { ok: true, checks: [
      { id: 'local', status: 'ok', message: 'Fixture local runtime checked' },
      { id: 'connector', status: 'warning', message: 'ChatGPT attachment is not verified by local checks' } ] }; },
    setupCore: async () => { window.testMutations++; return { ok: true }; }, setupMcp: async () => { window.testMutations++; return { ok: true }; },
    copyNativeCodexCommand: async () => true, setBrowserSurfaceActive: async () => browser, setBrowserBounds: async () => true,
    selectBrowserTab: async () => browser,
  }, { get(target, key) { if (key in target) return target[key]; if (String(key).startsWith('on')) return callback => {
    (listeners[key] ??= new Set()).add(callback); return () => listeners[key].delete(callback);
  }; return async () => state; } });
}
async function main() {
  const root = path.resolve(__dirname, '../dist'), output = process.env.MARIA_UI_OUTPUT;
  if (output) fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, electronScratch; const results = [];
  const pageUrl = process.env.MARIA_UI_ELECTRON ? pathToFileURL(path.join(root, 'index.html')).href
    : `http://127.0.0.1:${server.address().port}`;
  try {
    if (process.env.MARIA_UI_ELECTRON) {
      electronScratch = fs.mkdtempSync(path.join(tmpdir(), 'maria-ui-fixture-'));
      const entry = path.join(electronScratch, 'main.cjs');
      fs.writeFileSync(entry, `const { app, BrowserWindow } = require('electron');
        let window; app.whenReady().then(() => { window = new BrowserWindow({ width: 1180, height: 1000,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }); window.loadURL('about:blank'); });`);
      const apps = new Set();
      browser = {
        async newContext(options) {
          const app = await electron.launch({ executablePath: require('electron'), // Root-only Linux test containers cannot start Chromium's OS sandbox.
            // This flag belongs to the disposable test app, never the production launcher.
            args: [...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []), entry],
            env: { ...process.env } });
          apps.add(app);
          const context = app.context(), page = await app.firstWindow({ timeout: 20000 });
          console.log('Electron fixture started');
          await page.setViewportSize(options.viewport);
          await page.emulateMedia({ reducedMotion: options.reducedMotion });
          return { addInitScript: (...args) => context.addInitScript(...args), newPage: async () => page,
            close: async () => { await app.close(); apps.delete(app); } };
        },
        async close() { await Promise.all([...apps].map(app => app.close())); },
      };
    } else {
      browser = await chromium.launch({ headless: true, ...(process.env.MARIA_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.MARIA_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chromium' }) });
    }
    for (const width of [1180, 700, 500]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: width === 1180 ? 'no-preference' : 'reduce' });
      await context.addInitScript(fixture, {});
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pageUrl); console.log('Opened fixture page');
      await page.getByRole('button', { name: 'Open ChatGPT', exact: true }).waitFor(); await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0, 'overview should settle when idle');
      assert.equal(await page.evaluate(() => window.testListeners.onLog?.size ?? 0), 0, 'overview must not subscribe to raw logs');
      assert.equal(await page.evaluate(() => window.testMutations), 0, 'setup must require user intent');
      if (output) await page.screenshot({ path: path.join(output, `workspace-${width}.png`) });
      await page.locator('.connection-diagnostics > summary').click();
      await page.getByLabel('Explain a connector error', { exact: true }).fill('MCP error -32602: Tool read not found');
      await page.getByText('The connector’s tools do not match', { exact: true }).waitFor();
      await page.getByLabel('Explain a connector error', { exact: true }).fill('Unknown root "/Users". Approved roots: /codex');
      await page.getByText('This is not the connected workspace', { exact: true }).waitFor();
      await page.getByLabel('Explain a connector error', { exact: true }).fill('');
      const automaticChecks = await page.evaluate(() => window.testDoctorCalls);
      assert.equal(automaticChecks, 1, 'returning-user inspection runs once without installing');
      await page.getByRole('button', { name: 'Run local checks', exact: true }).click();
      await page.getByText('Local checks passed', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.testDoctorCalls), automaticChecks + 1, 'one click performs one additional local check');
      await page.getByText('ChatGPT attachment is not verified by local checks', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.testMutations), 0);
      if (output) await page.screenshot({ path: path.join(output, `diagnostics-${width}.png`) });
      for (const [index, label, selector] of [[3, 'Connection', '.setup-list'], [4, 'Local tools', '.wizard-stepper'],
        [5, 'Activity', '.activity-table'], [8, 'Settings', '.studio-settings-section:visible'],
        [6, 'Help', '.guided-help'], [7, 'Updates', '.maria-updates'], [2, 'ChatGPT', '.browser-surface']]) {
        // The new shell keeps advanced pages reachable through its declared keyboard routes.
        await page.keyboard.press(`Meta+${index}`); await page.locator(selector).first().waitFor();
        await page.waitForTimeout(width === 1180 ? 1000 : 150);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} overflows at ${width}`);
        if (output && ['Settings', 'Connection', 'Local tools'].includes(label)) await page.screenshot({ path: path.join(output, `${label.replace(/[^a-z]/gi, '-').toLowerCase()}-${width}.png`) });
      }
      assert.deepEqual(errors, []); console.log('Passed viewport', width); results.push({ width, surfaces: 8, errors }); await context.close();
    }
    // No IPC state/browser/operation event: only the shared monitor observes recovery.
    for (const pause of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 700, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(fixture, { recovering: true });
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message)); await page.goto(pageUrl);
      await page.locator('.guided-setup.is-idle').waitFor();
      await page.locator('.guided-setup').getByRole('button', { name: 'Check connection', exact: true }).click();
      await page.locator('.automatic-setup.is-busy').waitFor();
      const checksBeforeRecovery = await page.evaluate(() => window.testDoctorCalls);
      if (pause) await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.evaluate(() => { window.testConnectionStatus = { ...window.testConnectionStatus, nativeAvailable: true, phase: 'online' }; });
      if (pause) {
        await page.waitForTimeout(3500); await page.locator('.automatic-setup.is-paused').waitFor();
        assert.equal(await page.evaluate(() => window.testDoctorCalls), checksBeforeRecovery);
      } else {
        await page.locator('.automatic-setup.is-ready').waitFor();
        assert.equal(await page.evaluate(() => window.testDoctorCalls), checksBeforeRecovery + 1);
      }
      assert.equal(await page.evaluate(() => window.testMutations), 0); assert.deepEqual(errors, []);
      results.push({ recoveryWithoutEvents: true, pause, errors }); await context.close();
    }
    for (const options of [{ firstRun: true }, { firstRun: true, manual: true }, { development: true }, { offline: true }, { language: 'ja' }, { language: 'zh-CN' }, { onboarding: true }]) {
      const context = await browser.newContext({ viewport: { width: 700, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(fixture, options);
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message)); await page.goto(pageUrl); console.log('Opened fixture page');
      await page.locator(options.onboarding ? '.guided-welcome' : '.studio-home').waitFor(); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => window.testMutations), 0);
      if (options.offline) {
        const connection = page.locator('.guided-health-row').first();
        assert.equal(await connection.locator('small').innerText(), 'Not connected');
        assert.equal(await connection.locator('i.is-ready').count(), 0);
      }
      if (output) await page.screenshot({ path: path.join(output, `state-${Object.entries(options).map(([k,v]) => `${k}-${v}`).join('-')}.png`) });
      assert.deepEqual(errors, []); results.push({ options, errors }); await context.close();
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    if (electronScratch) fs.rmSync(electronScratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
