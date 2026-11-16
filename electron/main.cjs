// Desktop shell. Serves the built game from inside the app over a private app:// origin, with
// no network access, no Node in the page and navigation locked to the game itself.
const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://cordite';
const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test'));
const SMOKE_DIR = smokeArg ? path.resolve(smokeArg.split('=')[1] || 'smoke') : null;
const qualityArg = process.argv.find((a) => a.startsWith('--smoke-quality='));
const SMOKE_QUALITY = qualityArg && /^(low|medium|high|ultra)$/.test(qualityArg.split('=')[1]) ? qualityArg.split('=')[1] : null;
const chapterArg = process.argv.find((a) => a.startsWith('--smoke-chapter='));
const SMOKE_CHAPTER = chapterArg ? Math.min(6, Math.max(1, parseInt(chapterArg.split('=')[1], 10) || 1)) : 1;

if (SMOKE_DIR) {
  // Tests keep their saves and settings to themselves instead of touching the player's profile.
  app.setPath('userData', path.join(SMOKE_DIR, 'profile'));
  // Build servers have no GPU. `--software-gl` lets the smoke test run WebGL on the CPU rasteriser;
  // it is never set for players.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  if (process.argv.includes('--software-gl')) {
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

function createWindow() {
  // CORDITE_WINDOW=WIDTHxHEIGHT overrides the starting size (used when profiling memory).
  const size = /^(\d+)x(\d+)$/.exec(process.env.CORDITE_WINDOW || '');
  const win = new BrowserWindow({
    width: size ? Number(size[1]) : 1440,
    height: size ? Number(size[2]) : 810,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#05070a',
    show: false,
    autoHideMenuBar: true,
    title: 'Cordite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/** Boots the game, plays a few seconds of chapter one, saves screenshots and exits. */
async function smokeTest(win) {
  const errors = [];
  const result = { ok: false, errors };
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3 && !/manifest|favicon/i.test(message)) errors.push(message);
  });
  const run = (js) => win.webContents.executeJavaScript(js, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => fs.writeFileSync(path.join(SMOKE_DIR, name), (await win.webContents.capturePage()).toPNG());
  try {
    fs.mkdirSync(SMOKE_DIR, { recursive: true });
    for (let i = 0; i < 120 && !(await run('!!(window.__cordite && window.__cordite.game.chapter)')); i++) await sleep(500);
    await sleep(1500);
    result.menu = JSON.parse(await run('JSON.stringify(window.__cordite.state())'));
    result.version = await run('window.__cordite.version');
    result.weapons = await run('window.__cordite.weapons.length');
    result.chapters = await run('window.__cordite.chapters.length');
    await shot('menu.png');
    if (process.env.CORDITE_SMOKE_CSS) await win.webContents.insertCSS(process.env.CORDITE_SMOKE_CSS);
    if (SMOKE_QUALITY) await run(`window.__cordite.store.set('quality', '${SMOKE_QUALITY}'); window.__cordite.engine.applyQuality(); true`);
    result.quality = await run('window.__cordite.store.settings.quality');
    result.pixels = await run('(() => { const c = document.getElementById("gl"); return c.width + "x" + c.height; })()');
    await run(`window.__cordite.god(true); window.__cordite.start(${SMOKE_CHAPTER}).then(() => true)`);
    await sleep(8000);
    result.game = JSON.parse(await run('JSON.stringify(window.__cordite.state())'));
    await shot('game.png');
    // Memory while playing: every process the app owns (window, GPU, helpers), plus the game's own heap.
    const metrics = app.getAppMetrics();
    result.memoryMB = {
      total: Math.round(metrics.reduce((n, m) => n + m.memory.workingSetSize, 0) / 1024),
      processes: metrics.map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}`),
      gameHeap: await run('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null'),
    };
    await run('window.__cordite.god(false)');
    result.ok = result.game.state === 'playing' && result.game.enemies > 0 && result.chapters === 6 && errors.length === 0;
  } catch (err) {
    errors.push(String(err && err.stack ? err.stack : err));
  }
  try {
    fs.writeFileSync(path.join(SMOKE_DIR, 'result.json'), JSON.stringify(result, null, 2));
  } catch {
    /* nowhere to write */
  }
  console.log(`SMOKE ${result.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(result)}`);
  app.exit(result.ok ? 0 : 1);
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // macOS keeps a minimal menu so Cmd+Q / Cmd+H work; other platforms have none.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'windowMenu' }]) : null);
  ipcMain.on('cordite:quit', () => app.quit());
  ipcMain.on('cordite:fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.setFullScreen(!w.isFullScreen());
  });
  const win = createWindow();
  if (SMOKE_DIR) win.webContents.once('did-finish-load', () => void smokeTest(win));
});

app.on('window-all-closed', () => app.quit());
