'use strict';
/* Browser-level test harness. What is real and what is not:
 *   REAL:    final.html + electron-bridge.js exactly as shipped, served with the shipped CSP header; the shipped
 *            main.js (its IPC handlers, file permission rules, single-instance and open-file logic) and lib/*.
 *   REPLACED: Electron itself (mock module: dialogs are scripted, windows are fake), the contextBridge/IPC hop
 *            (calls go Playwright -> Node, bytes as base64), the custom app:// scheme (plain http://127.0.0.1 here).
 *   PDF engine: if app/vendor/pdfjs holds the real pdf.js 3.11.174 (after `npm install`) it is used; otherwise the
 *            pdfjs-dist 5.x found on this machine is wrapped to look like the v3 API (test-only shim).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const Module = require('module');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..', '..');
const { CSP, mimeFor } = require(path.join(ROOT, 'lib', 'appfiles'));

function findPlaywright() {
  const tries = ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright'];
  for (const t of tries) { try { return require(t); } catch (_) { /* next */ } }
  throw new Error('playwright not found (npm i -D playwright)');
}

function find(globalRoots, rel) {
  for (const r of globalRoots) { const p = path.join(r, rel); if (fs.existsSync(p)) return p; }
  return null;
}

// ---- a minimal fake "electron" ---------------------------------------------------------------
function makeElectron(tmp) {
  const handlers = {};
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setAppUserModelId() {}, userData: null,
    getPath(n) { return n === 'appData' ? path.join(tmp, 'appdata') : (n === 'userData' ? app.userData : tmp); },
    setPath(n, v) { if (n === 'userData') app.userData = v; },
    commandLine: { appendSwitch() {} }, requestSingleInstanceLock() { return true; }, whenReady() { return Promise.resolve(); },
    quit() { app.quitCalled = true; }, exit() {}
  });
  const sink = { forward: null };
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); this.minimized = false; this.calls = [];
      const wc = (this.webContents = new EventEmitter());
      wc.send = (ch, p) => { if (sink.forward) sink.forward(ch, p); };
      wc.getZoomLevel = () => 0; wc.setZoomLevel = () => {}; wc.toggleDevTools = () => {}; wc.reload = () => {};
      wc.setWindowOpenHandler = () => {}; wc.executeJavaScript = async () => true; wc.session = {}; wc.replaceMisspelling = () => {};
      this.loadURL = () => {};
    }
    maximize() {} isMinimized() { return false; } restore() {} isVisible() { return true; } show() {}
    setAlwaysOnTop() {} focus() { this.calls.push('focus'); } moveTop() {} isDestroyed() { return false; } setTitle() {}
  }
  const dialog = {
    openResult: { canceled: true, filePaths: [] }, saveResult: { canceled: true }, msgSync: 0, msgResponse: 0,
    showOpenDialog: async () => dialog.openResult, showSaveDialog: async () => dialog.saveResult,
    showMessageBoxSync: () => dialog.msgSync, showMessageBox: async () => ({ response: dialog.msgResponse })
  };
  const shell = { opened: [], external: [], openPath: async (p) => { shell.opened.push(p); return ''; }, openExternal: (u) => shell.external.push(u) };
  const mod = {
    app, BrowserWindow, dialog, shell,
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({ popup() {} }) },
    nativeImage: { createFromPath: (p) => ({ path: p }) }
  };
  return { app, dialog, shell, handlers, mod, sink };
}

function loadRealMain(el, argv, opts) {
  const origLoad = Module._load;
  const proxyPath = require.resolve(path.join(ROOT, 'lib', 'imageProxy'));
  Module._load = function (request) {
    if (request === 'electron') return el.mod;
    return origLoad.apply(this, arguments);
  };
  const saved = process.argv; process.argv = argv;
  delete require.cache[require.resolve(path.join(ROOT, 'main.js'))];
  if (opts && opts.allowPrivateImages) {     // the test image server is on loopback, which the real downloader refuses
    const real = require(proxyPath);
    require.cache[proxyPath].exports = Object.assign({}, real, { fetchImage: (u) => real.fetchImage(u, { allowPrivate: true }), fetchPageImage: (u) => real.fetchPageImage(u, { allowPrivate: true }) });
  }
  try { require(path.join(ROOT, 'main.js')); } finally { Module._load = origLoad; process.argv = saved; }
}

// ---- static server for the app files (with the shipped CSP) -----------------------------------
async function startStatic(appDir, extra) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p === '/') p = '/final.html';
    let file = extra[p] || path.join(appDir, p);
    if (!extra[p] && !path.normalize(file).startsWith(path.normalize(appDir))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': mimeFor(file), 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }); res.end(d);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

async function start(opts) {
  const pw = findPlaywright();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfed-e2e-'));
  const globalRoots = ['/home/claude/.npm-global/lib/node_modules', path.join(ROOT, 'node_modules')];

  // libraries: real vendor files if present, otherwise stand-ins
  const appDir = path.join(tmp, 'app'); fs.cpSync(path.join(ROOT, 'app'), appDir, { recursive: true });
  // test-only: surface the real reason behind the app's generic "could not be read as a PDF" toast
  { const f = path.join(appDir, 'final.html'); let s = fs.readFileSync(f, 'utf8'); s = s.replace("else toast('That file could not be read as a PDF.');", "else { console.error('OPENFAIL ' + (e && e.stack || e)); toast('That file could not be read as a PDF.'); }"); fs.writeFileSync(f, s); }
  const extra = {}; let pdfEngine = 'real pdf.js 3.11.174';
  const realPdfjs = path.join(appDir, 'vendor', 'pdfjs', 'pdf.min.js');
  const realOk = fs.existsSync(realPdfjs) && fs.readFileSync(realPdfjs, 'utf8').includes('3.11.174');
  if (!realOk) {
    const pdfjs = find(globalRoots, 'pdfjs-dist/build/pdf.mjs'), worker = find(globalRoots, 'pdfjs-dist/build/pdf.worker.mjs');
    if (!pdfjs || !worker) throw new Error('no pdf.js available for the test');
    pdfEngine = 'pdfjs-dist 5.x wrapped as a v3 stand-in (NOT the shipped 3.11.174)';
    extra['/vendor/pdfjs/pdf.min.js'] = path.join(tmp, 'shim.js');
    fs.writeFileSync(extra['/vendor/pdfjs/pdf.min.js'],
      "import('/__shim/pdf.mjs').then(function(m){ var t=m.TextLayer; var o=Object.assign({},m); try{Object.defineProperty(m.GlobalWorkerOptions,'workerSrc',{get:function(){return '/__shim/worker-wrap.mjs';},set:function(){},configurable:true});}catch(e){} o.renderTextLayer=function(a){ var tl=new t({textContentSource:a.textContentSource,container:a.container,viewport:a.viewport}); return {promise:tl.render()}; }; window.pdfjsLib=o; });");
    extra['/__shim/pdf.mjs'] = pdfjs; extra['/vendor/pdfjs/pdf.worker.min.js'] = path.join(tmp, 'emptyworker.js'); fs.writeFileSync(extra['/vendor/pdfjs/pdf.worker.min.js'], '/* stand-in: the real v3 worker is a classic script */'); extra['/__shim/pdf.worker.mjs'] = worker; extra['/__shim/worker-wrap.mjs'] = path.join(tmp, 'worker-wrap.mjs'); fs.writeFileSync(extra['/__shim/worker-wrap.mjs'], "var P=function(C){ if(!C.prototype.getOrInsertComputed){ C.prototype.getOrInsertComputed=function(k,f){ if(this.has(k)) return this.get(k); var v=f(k); this.set(k,v); return v; }; C.prototype.getOrInsert=function(k,v){ if(this.has(k)) return this.get(k); this.set(k,v); return v; }; } }; P(Map); P(WeakMap); await import('/__shim/pdf.worker.mjs');");
  }
  if (!fs.existsSync(path.join(appDir, 'vendor', 'pdflib', 'pdf-lib.min.js'))) {
    const pl = find(globalRoots, 'pdf-lib/dist/pdf-lib.min.js'); if (!pl) throw new Error('pdf-lib not found');
    extra['/vendor/pdflib/pdf-lib.min.js'] = pl;
  }
  const { server, port } = await startStatic(appDir, extra);
  const base = 'http://127.0.0.1:' + port;

  // the real main.js, on a fake electron
  const el = makeElectron(tmp);
  loadRealMain(el, ['PDFEditor.exe'].concat(opts.argv || []), { allowPrivateImages: true });
  await new Promise((r) => setTimeout(r, 50));

  const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const outside = [];                                  // requests that left the app (must stay empty)
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    if (opts.allowHost && u.startsWith(opts.allowHost)) return route.continue();
    outside.push(u); return route.abort();
  });
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  const SENDER = { senderFrame: { url: 'app://pdfeditor/final.html' } };
  await page.exposeFunction('__ipc', async (channel, args) => {
    const a = (args || []).map((x) => (x && x.__b64 !== undefined ? Buffer.from(x.__b64, 'base64') : x));
    const r = await el.handlers[channel](SENDER, ...a);
    if (r && r.bytes) return Object.assign({}, r, { bytes: { __b64: Buffer.from(r.bytes).toString('base64') } });
    return r === undefined ? null : r;
  });
  await page.addInitScript(() => {
    [Map, WeakMap].forEach((C) => { if (!C.prototype.getOrInsertComputed) { C.prototype.getOrInsertComputed = function (k, f) { if (this.has(k)) return this.get(k); const v = f(k); this.set(k, v); return v; }; C.prototype.getOrInsert = function (k, v) { if (this.has(k)) return this.get(k); this.set(k, v); return v; }; } });
    const enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return { __b64: btoa(s) }; };
    const dec = (o) => Uint8Array.from(atob(o.__b64), (c) => c.charCodeAt(0));
    const call = (ch, args) => window.__ipc(ch, args).catch((e) => { throw new Error("Error invoking remote method '" + ch + "': Error: " + String(e.message || e).replace(/^.*Error: /, '')); });
    window.pdfEditorNative = {
      isDesktop: true,
      pickOpen: () => call('pick-open'), pickSave: (n) => call('pick-save', [n]),
      readFile: (p) => call('read-file', [p]).then((r) => ({ bytes: dec(r.bytes), name: r.name, lastModified: r.lastModified })),
      writeFile: (p, u8) => call('write-file', [p, enc(u8)]),
      grantDrop: (p) => call('grant-drop', [p]),
      pathForFile: (f) => f.__testPath || '',
      fetchImage: (u) => call('fetch-image', [u]).then((r) => ({ type: r.type, bytes: dec(r.bytes) })),
      fetchPageImage: (u) => call('fetch-page-image', [u]).then((r) => ({ type: r.type, bytes: dec(r.bytes) })),
      openAttachment: (n, u8) => call('open-attachment', [n, enc(u8)]),
      recentList: () => call('recent-list'), recentOpen: (p) => call('recent-open', [p]), recentRemove: (p) => call('recent-remove', [p]), recentClear: () => call('recent-clear'),
      onOpenPdf: (cb) => { window.__openCb = cb; },
      rendererReady: () => call('renderer-ready')
    };
  });
  el.sink.forward = (ch, p) => { if (ch === 'open-pdf') page.evaluate((info) => window.__openCb(info), p).catch(() => {}); };

  await page.goto(base + '/final.html');
  return {
    pw, tmp, el, page, base, outside, consoleErrors, pageErrors, pdfEngine,
    secondInstance: (files) => el.app.emit('second-instance', {}, ['PDFEditor.exe'].concat(files), tmp),
    async close() { await browser.close(); server.close(); }
  };
}

module.exports = { start };
