'use strict';
/*
 * PDF Editor - Electron main process.
 * Replaces serve.ps1 + launch.vbs + the PDFEditor.exe launcher:
 *   - serves the app files over the app:// scheme (a real, constant origin, so localStorage and
 *     fetch()/workers/WebAssembly for OCR behave like they did under http://127.0.0.1)
 *   - native Open / Save As dialogs, and writing the PDF back into the file it was opened from
 *   - single instance: a second launch hands its PDF to the running window (new tab) and raises it
 *   - the image downloader for pasted figures, and "open attachment with the default program"
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, session, Menu, nativeImage, nativeTheme } = require('electron');

const fileio = require('./lib/fileio');
const { fetchImage, fetchPageImage } = require('./lib/imageProxy');
const { filesFromArgv } = require('./lib/args');
const { CSP, resolveInside, mimeFor } = require('./lib/appfiles');
const { createRecent } = require('./lib/recent');

const APP_NAME = 'PDF Editor';
const APP_USER_MODEL_ID = 'PDFEditor.App';        // same taskbar identity the old launcher stamped on the window
const SCHEME = 'app';
const ORIGIN = SCHEME + '://pdfeditor';
const APP_DIR = path.join(__dirname, 'app');
const LAUNCH_ARGV = process.argv.slice();
const SELFTEST = LAUNCH_ARGV.includes('--selftest');

// ---- must all happen before the app is ready -------------------------------------------------
// Fixed data folder, independent of the package name, so settings are never orphaned by a rename.
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
// The old shortcuts started Edge with these so "Scan text" keeps running while another window is in front.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

// ---- tiny log (userData/main.log, capped) ----------------------------------------------------
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'main.log');
    try { if (fs.statSync(f).size > 512 * 1024) fs.writeFileSync(f, ''); } catch (_) { /* no file yet */ }
    fs.appendFileSync(f, new Date().toISOString() + '  ' + msg + '\n');
  } catch (_) { /* logging must never break the app */ }
}

// ---- state -----------------------------------------------------------------------------------
let win = null;
let rendererReady = false;
const pendingPdfs = [];          // paths waiting for the window to be ready
let pendingSettings = null;      // settings file waiting for the window to be ready
const granted = new Set();       // PDFs the user chose (dialog / Open with / drop): the only ones the page may read or write
let lastDir = null;
let recent = null;              // recently opened PDFs (created once userData is known, see whenReady)
const remember = (p) => { try { if (recent) recent.add(p); } catch (_) { /* never break opening */ } };

const norm = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));
function grant(p) { if (fileio.isPdfPath(p)) { granted.add(norm(p)); return true; } return false; }
function isGranted(p) { return fileio.isPdfPath(p) && granted.has(norm(p)); }

// ---- single instance -------------------------------------------------------------------------
// A second launch never opens a second window: it hands its PDF to the running one (see 'second-instance').
const gotLock = SELFTEST || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else if (!SELFTEST) {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const { pdfs, settings } = filesFromArgv(argv, workingDirectory, false);
    log('second-instance: ' + JSON.stringify(pdfs));
    queueOrSend(pdfs, settings);
    bringToFront();
  });
}

function bringToFront() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  // Windows only lets the foreground app raise a window; this is the usual way to make the raise stick.
  win.setAlwaysOnTop(true);
  win.focus();
  win.moveTop();
  win.setAlwaysOnTop(false);
}

function queueOrSend(pdfs, settings) {
  pdfs.forEach(grant);
  pdfs.forEach(remember);
  if (settings) pendingSettings = settings;
  pdfs.forEach((p) => pendingPdfs.push(p));
  if (win && !win.isDestroyed() && rendererReady) flush();   // otherwise flush() runs when the page reports it is ready
}

// Sends each queued file to the page, which opens it as a new tab (or switches to its tab if it is already open).
function flush() {
  if (!win || win.isDestroyed()) return;
  while (pendingPdfs.length) {
    const p = pendingPdfs.shift();
    win.webContents.send('open-pdf', { path: p, name: path.basename(p) });
  }
  if (pendingSettings) { const f = pendingSettings; pendingSettings = null; importSettingsFile(f); }
}

// ---- settings migration (from the old Edge version) -------------------------------------------
async function importSettingsFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = data && data.items;
    if (!items || typeof items !== 'object') throw new Error('this is not a PDF Editor settings file');
    const keys = Object.keys(items).filter((k) => typeof items[k] === 'string' && k.length <= 300);
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Import', 'Cancel'], defaultId: 0, cancelId: 1, title: APP_NAME,
      message: 'Import ' + keys.length + ' saved setting' + (keys.length === 1 ? '' : 's') + ' from ' + path.basename(file) + '?',
      detail: 'This brings your toolbar, highlight, comment and AI settings over from the old Edge version. Settings with the same name are replaced.'
    });
    if (r.response !== 0) return;
    const obj = {}; keys.forEach((k) => { obj[k] = items[k]; });
    await win.webContents.executeJavaScript('(function(o){try{Object.keys(o).forEach(function(k){localStorage.setItem(k,o[k]);});return true;}catch(e){return false;}})(' + JSON.stringify(obj) + ')');
    win.webContents.reload();
  } catch (e) {
    log('settings import failed: ' + e.message);
    dialog.showMessageBox(win, { type: 'error', title: APP_NAME, message: 'Could not import the settings file.', detail: String(e.message || e) });
  }
}

// ---- window ----------------------------------------------------------------------------------
function iconPath() {
  let p = path.join(APP_DIR, 'icon.ico');
  const unpacked = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  if (unpacked !== p && fs.existsSync(unpacked)) p = unpacked;
  return p;
}

// Initial colours of the title-bar buttons (the page refines them once it has loaded).
function TB_COLORS() {
  const dark = !!(nativeTheme && nativeTheme.shouldUseDarkColors);
  return dark ? { color: '#10141B', symbol: '#E9EDF5' } : { color: '#E4E8EF', symbol: '#1b2230' };
}

function createWindow() {
  rendererReady = false;
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 640, minHeight: 420,
    show: false,
    title: APP_NAME,
    backgroundColor: '#ffffff',
    icon: nativeImage.createFromPath(iconPath()),
    autoHideMenuBar: true,
    // Chrome-style: no separate title bar. The tab strip of the page sits in that space; Windows still draws the
    // minimise / maximise / close buttons on top of it (colours follow the page's light/dark theme, see set-titlebar-colors).
    ...(process.platform !== 'darwin' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: TB_COLORS().color, symbolColor: TB_COLORS().symbol, height: 40 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: true
    }
  });
  Menu.setApplicationMenu(null);
  win.maximize();                                   // the window opens maximized (fills the work area, taskbar stays visible)
  win.once('ready-to-show', () => { if (!SELFTEST) win.show(); });
  win.on('closed', () => { win = null; rendererReady = false; });
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  win.webContents.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(APP_NAME); });   // window title stays "PDF Editor"

  // A page that cancels beforeunload (unsaved changes) would otherwise silently refuse to close.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, noLink: true, title: APP_NAME,
      message: 'You have unsaved changes.',
      detail: 'If you leave now they will be lost. Choose Stay, then press Save.'
    });
    if (choice === 0) event.preventDefault();         // preventDefault here = go ahead and close
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN + '/')) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });

  // Edit menu for text boxes (comment editor, AI settings) and Copy for selected text - only shown when the page
  // did not handle the right-click itself (the page's own menus call preventDefault, which suppresses this).
  win.webContents.on('context-menu', (_e, params) => {
    const tpl = [];
    if (params.isEditable) {
      (params.dictionarySuggestions || []).slice(0, 5).forEach((s) => tpl.push({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
      if (params.misspelledWord) tpl.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      if (tpl.length) tpl.push({ type: 'separator' });
      tpl.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      tpl.push({ role: 'copy' });
    }
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
  });

  // Keyboard: browser-style reload, zoom and developer tools (the old Edge app window had these).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const k = input.key;
    if (input.key === 'F12' || (ctrl && input.shift && (k === 'I' || k === 'i'))) { win.webContents.toggleDevTools(); event.preventDefault(); return; }
    if (k === 'F5' || (ctrl && !input.shift && (k === 'r' || k === 'R'))) { win.webContents.reload(); event.preventDefault(); return; }
    if (ctrl && !input.alt) {
      const z = win.webContents.getZoomLevel();
      if (k === '=' || k === '+') { win.webContents.setZoomLevel(Math.min(z + 0.5, 4)); event.preventDefault(); }
      else if (k === '-' || k === '_') { win.webContents.setZoomLevel(Math.max(z - 0.5, -3)); event.preventDefault(); }
      else if (k === '0') { win.webContents.setZoomLevel(0); event.preventDefault(); }
    }
  });

  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone: ' + JSON.stringify(d)));
  win.loadURL(ORIGIN + '/final.html');
}

// ---- IPC (only the app's own page may call these) ----------------------------------------------
function fromApp(event) {
  try { return event.senderFrame && event.senderFrame.url.startsWith(ORIGIN + '/'); } catch (_) { return false; }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromApp(event)) throw new Error('not allowed');
    try { return await fn(event, ...args); }
    catch (e) { log(channel + ' failed: ' + (e && e.stack || e)); throw new Error((e && e.code ? e.code + ': ' : '') + (e && e.message || String(e))); }
  });
}

handle('renderer-ready', () => { rendererReady = true; flush(); return true; });

// The page tells us the colours of its tab strip so the window buttons drawn over it match (light / dark theme).
const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9\s,./%]+\))$/i;
handle('set-titlebar-colors', (_e, color, symbolColor) => {
  if (!win || typeof win.setTitleBarOverlay !== 'function') return false;
  if (!CSS_COLOR.test(String(color)) || !CSS_COLOR.test(String(symbolColor))) return false;
  try { win.setTitleBarOverlay({ color: String(color), symbolColor: String(symbolColor), height: 40 }); return true; }
  catch (e) { log('setTitleBarOverlay failed: ' + e.message); return false; }
});

handle('pick-open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open PDF', properties: ['openFile'], defaultPath: lastDir || undefined,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  lastDir = path.dirname(p);
  if (!grant(p)) throw new Error('Choose a PDF file.');
  remember(p);
  return { path: p, name: path.basename(p) };
});

handle('pick-save', async (_e, suggestedName) => {
  const base = path.basename(String(suggestedName || 'document.pdf')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'document.pdf';
  const r = await dialog.showSaveDialog(win, {
    title: 'Save PDF as', defaultPath: lastDir ? path.join(lastDir, base) : base,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return null;
  let p = r.filePath;
  if (!/\.pdf$/i.test(p)) p += '.pdf';
  lastDir = path.dirname(p);
  grant(p);
  remember(p);
  return { path: p, name: path.basename(p) };
});

handle('read-file', async (_e, p) => {
  if (!isGranted(p)) throw new Error('That file was not opened from here.');
  const r = await fileio.readPdf(p);
  return { bytes: r.bytes, name: r.name, lastModified: r.lastModified };
});

handle('write-file', async (_e, p, bytes) => {
  if (!isGranted(p)) throw new Error('That file was not opened from here.');
  await fileio.writePdfAtomic(p, bytes);
  return true;
});

// A file dropped onto the window: the page hands over the path Electron knows for that File.
handle('grant-drop', async (_e, p) => {
  if (!fileio.isPdfPath(p)) return false;
  const st = await fs.promises.stat(p);
  if (!st.isFile()) return false;
  const ok = grant(p);
  if (ok) remember(p);
  return ok;
});

// ---- recently opened PDFs (home screen) ---------------------------------------------------------
// The list holds paths the user opened before. A click hands the path back here; it is only granted if it is in
// that list, so the page cannot use this to reach any other file.
handle('recent-list', async () => {
  const out = [];
  for (const it of recent.list()) {
    let exists = false, size = 0;
    try { const st = await fs.promises.stat(it.path); exists = st.isFile(); size = st.size; } catch (_) { /* moved, deleted or drive not connected */ }
    out.push({ path: it.path, name: path.basename(it.path), dir: path.dirname(it.path), openedAt: it.openedAt, exists, size });
  }
  return out;
});
handle('recent-open', async (_e, p) => {
  if (typeof p !== 'string' || !recent.has(p)) throw new Error('That file is not in the recent list.');
  let st;
  try { st = await fs.promises.stat(p); } catch (_) { throw Object.assign(new Error('The file was moved, renamed or deleted.'), { code: 'ENOENT' }); }
  if (!st.isFile() || !grant(p)) throw new Error('Choose a PDF file.');
  remember(p);
  lastDir = path.dirname(p);
  return { path: p, name: path.basename(p) };
});
handle('recent-remove', (_e, p) => (typeof p === 'string' ? recent.remove(p) : false));
handle('recent-clear', () => { recent.clear(); return true; });

handle('fetch-image', async (_e, url) => {
  const r = await fetchImage(url);
  return { type: r.type, bytes: r.bytes };
});

handle('fetch-page-image', async (_e, url) => {
  const r = await fetchPageImage(url);
  return { type: r.type, bytes: r.bytes };
});

handle('open-attachment', async (_e, name, bytes) => {
  const full = await fileio.writeAttachmentToTemp(os.tmpdir(), name, bytes);
  const err = await shell.openPath(full);        // opens with the program Windows associates with the type
  if (err) throw new Error(err);
  return true;
});

// ---- startup ---------------------------------------------------------------------------------
if (gotLock) app.whenReady().then(() => {
  // app:// serves the bundled files
  protocol.handle(SCHEME, async (request) => {
    try {
      const u = new URL(request.url);
      if (u.host !== 'pdfeditor') return new Response('Not found', { status: 404 });
      const full = resolveInside(APP_DIR, u.pathname);
      if (!full) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(full);
      return new Response(data, { status: 200, headers: {
        'Content-Type': mimeFor(full),
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-cache'
      } });
    } catch (e) {
      return new Response('Not found: ' + request.url, { status: 404 });
    }
  });

  // Only the permissions the app really uses (copy with formatting, paste) are granted.
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  recent = createRecent(path.join(app.getPath('userData'), 'recent-files.json'));
  const { pdfs, settings } = filesFromArgv(LAUNCH_ARGV, process.cwd(), process.defaultApp);
  pdfs.forEach(grant);
  pdfs.forEach(remember);
  pdfs.forEach((p) => pendingPdfs.push(p));
  if (settings) pendingSettings = settings;
  log('start: ' + JSON.stringify(pdfs));
  createWindow();
  if (SELFTEST) runSelfTest();
});

app.on('window-all-closed', () => { app.quit(); });

// ---- self test: `PDF Editor.exe --selftest` (npm run selftest) ---------------------------------
async function runSelfTest() {
  const out = path.join(app.getPath('userData'), 'selftest-result.json');
  const finish = (res, code) => {
    try { fs.writeFileSync(out, JSON.stringify(res, null, 2)); } catch (_) { /* ignore */ }
    console.log(JSON.stringify(res, null, 2));
    app.exit(code);
  };
  const timer = setTimeout(() => finish({ ok: false, error: 'timed out after 120 s' }, 2), 120000);
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const src = fs.readFileSync(path.join(__dirname, 'scripts', 'selftest-page.js'), 'utf8');
      const res = await win.webContents.executeJavaScript(src, true);
      clearTimeout(timer);
      finish(res, res.ok ? 0 : 1);
    } catch (e) { clearTimeout(timer); finish({ ok: false, error: String(e && e.message || e) }, 2); }
  });
}
