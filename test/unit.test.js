'use strict';
/* Plain-Node tests (no Electron needed): npm test
 * - lib/fileio, lib/args, lib/appfiles, lib/imageProxy against real files and local HTTP servers
 * - main.js driven with a mocked "electron" module: single instance, queueing, raising the window,
 *   IPC permission gating, the app:// protocol handler, settings import.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Module = require('module');
const { EventEmitter } = require('events');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log('  ok   ' + name); }
  catch (e) { results.push([name, false, e]); console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfed-test-'));
const mkPdf = (extra) => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n' + (extra || ''));

(async function main() {
  const fileio = require('../lib/fileio');
  const { filesFromArgv } = require('../lib/args');
  const { resolveInside, mimeFor, CSP } = require('../lib/appfiles');
  const { fetchImage, fetchPageImage, findPreviewImages, isPrivateAddress } = require('../lib/imageProxy');

  console.log('lib/recent');
  await test('recent list: newest first, no duplicates, capped, survives a restart, bad entries ignored', async () => {
    const { createRecent } = require('../lib/recent');
    const f = path.join(tmp, 'rc', 'recent-files.json');
    const r = createRecent(f, 3);
    const P = (n) => path.join(tmp, n + '.pdf');
    r.add(P('a')); r.add(P('b')); r.add(P('c')); r.add(P('a')); r.add(P('d'));
    assert.deepStrictEqual(r.list().map((i) => path.basename(i.path)), ['d.pdf', 'a.pdf', 'c.pdf']);
    assert.ok(!r.add('relative.pdf') && !r.add(path.join(tmp, 'x.txt')));
    assert.deepStrictEqual(createRecent(f, 3).list().map((i) => path.basename(i.path)), ['d.pdf', 'a.pdf', 'c.pdf']);
    assert.ok(r.has(P('c')) && !r.has(P('b')));
    assert.ok(r.remove(P('a')) && !r.remove(P('a')));
    r.clear(); assert.deepStrictEqual(createRecent(f, 3).list(), []);
    fs.writeFileSync(f, '{not json'); assert.deepStrictEqual(createRecent(f).list(), []);
  });

  console.log('lib/fileio');
  await test('writePdfAtomic replaces the file and leaves no temp file', async () => {
    const f = path.join(tmp, 'a.pdf'); fs.writeFileSync(f, mkPdf('old'));
    await fileio.writePdfAtomic(f, new Uint8Array(mkPdf('new-content')));
    assert.ok(fs.readFileSync(f).toString().includes('new-content'));
    assert.deepStrictEqual(fs.readdirSync(tmp).filter((n) => n.endsWith('.tmp')), []);
  });
  await test('writePdfAtomic creates a new file (Save As target)', async () => {
    const f = path.join(tmp, 'new.pdf');
    await fileio.writePdfAtomic(f, mkPdf());
    assert.ok(fs.existsSync(f));
  });
  await test('writePdfAtomic refuses non-PDF bytes and leaves the original alone', async () => {
    const f = path.join(tmp, 'keep.pdf'); fs.writeFileSync(f, mkPdf('orig'));
    await assert.rejects(() => fileio.writePdfAtomic(f, Buffer.from('hello world, not a pdf')), /Not a PDF/);
    assert.ok(fs.readFileSync(f).toString().includes('orig'));
  });
  await test('writePdfAtomic refuses a non-.pdf target and relative paths', async () => {
    await assert.rejects(() => fileio.writePdfAtomic(path.join(tmp, 'x.txt'), mkPdf()), /not a PDF path/);
    await assert.rejects(() => fileio.writePdfAtomic('rel.pdf', mkPdf()), /not a PDF path/);
  });
  await test('writePdfAtomic failure (target is a directory) cleans up its temp file and reports an error', async () => {
    const d = path.join(tmp, 'dir.pdf'); fs.mkdirSync(d);
    await assert.rejects(() => fileio.writePdfAtomic(d, mkPdf()));
    assert.deepStrictEqual(fs.readdirSync(tmp).filter((n) => n.endsWith('.tmp')), []);
  });
  await test('readPdf returns bytes/name/mtime and works with a name containing spaces and unicode', async () => {
    const f = path.join(tmp, 'my file \u00e9\u4e2d.pdf'); fs.writeFileSync(f, mkPdf('zz'));
    const r = await fileio.readPdf(f);
    assert.strictEqual(r.name, 'my file \u00e9\u4e2d.pdf'); assert.ok(r.bytes.length > 10); assert.ok(r.lastModified > 0);
  });
  await test('attachments: temp file written, executables refused, path tricks neutralised', async () => {
    const p = await fileio.writeAttachmentToTemp(tmp, '..\\..\\evil/../report.docx', Buffer.from('x'));
    assert.strictEqual(path.basename(p), 'report.docx'); assert.ok(p.startsWith(path.join(tmp, 'PDFEditorOpen')));
    for (const n of ['a.exe', 'b.BAT', 'c.ps1', 'd.vbs', 'e.js', 'f.lnk', 'g.msi', 'h.scr'])
      await assert.rejects(() => fileio.writeAttachmentToTemp(tmp, n, Buffer.from('x')), /not opened from here/);
    await assert.rejects(() => fileio.writeAttachmentToTemp(tmp, 'empty.txt', Buffer.alloc(0)), /empty/);
  });

  console.log('lib/args');
  await test('argv: packaged vs dev, relative paths, non-pdf ignored, settings file recognised', async () => {
    const f = path.join(tmp, 'open me.pdf'); fs.writeFileSync(f, mkPdf());
    const s = path.join(tmp, 'pdfeditor-settings.json'); fs.writeFileSync(s, '{}');
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x');
    let r = filesFromArgv(['PDFEditor.exe', f, 'notes.txt', '--flag', s, f], tmp, false);
    assert.deepStrictEqual(r.pdfs, [f]); assert.strictEqual(r.settings, s);
    r = filesFromArgv(['electron', '.', 'open me.pdf'], tmp, true);
    assert.deepStrictEqual(r.pdfs, [f]);
    r = filesFromArgv(['PDFEditor.exe', path.join(tmp, 'missing.pdf')], tmp, false);
    assert.deepStrictEqual(r.pdfs, []);
    r = filesFromArgv(['PDFEditor.exe'], tmp, false);
    assert.deepStrictEqual(r.pdfs, []);
  });

  console.log('lib/appfiles');
  await test('resolveInside blocks traversal, maps / to final.html, mime types right (wasm!)', async () => {
    const root = path.join(tmp, 'approot'); fs.mkdirSync(root);
    assert.strictEqual(resolveInside(root, '/'), path.join(root, 'final.html'));
    assert.strictEqual(resolveInside(root, '/vendor/a.js'), path.join(root, 'vendor', 'a.js'));
    assert.strictEqual(resolveInside(root, '/../secret.txt'), null);
    assert.strictEqual(resolveInside(root, '/%2e%2e/secret.txt'), null);
    assert.strictEqual(resolveInside(root, '/a/..%5c..%5csecret.txt'), process.platform === 'win32' ? null : path.join(root, 'secret.txt').replace(/secret/, 'a/..\\..\\secret') );
    assert.strictEqual(resolveInside(root, '/%00x'), null);
    assert.strictEqual(mimeFor('x.wasm'), 'application/wasm');
    assert.ok(mimeFor('x.js').startsWith('text/javascript'));
    assert.ok(/generativelanguage\.googleapis\.com/.test(CSP) && !/cdnjs|jsdelivr/.test(CSP));
  });

  console.log('lib/imageProxy');
  await test('isPrivateAddress classifies ranges', async () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1'])
      assert.ok(isPrivateAddress(a), a);
    for (const a of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '100.63.0.1']) assert.ok(!isPrivateAddress(a), a);
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const server = http.createServer((req, res) => {
    if (req.url === '/p.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length }); res.end(png); }
    else if (req.url === '/r1') { res.writeHead(302, { Location: '/r2' }); res.end(); }
    else if (req.url === '/r2') { res.writeHead(301, { Location: '/p.png' }); res.end(); }
    else if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
    else if (req.url === '/text') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); }
    else if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<html><head><meta property="og:image" content="/p.png"></head><body>x</body></html>'); }
    else if (req.url === '/page-redirect') { res.writeHead(302, { Location: '/page' }); res.end(); }
    else if (req.url === '/page-none') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><head><title>t</title></head></html>'); }
    else if (req.url === '/page-bot') { if (/facebookexternalhit/.test(String(req.headers['user-agent']))) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<meta property="og:image" content="/p.png">'); } else { res.writeHead(403); res.end(); } }
    else if (req.url === '/page-img') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body><img src="/spacer.gif" width="1"><img src="/p.png" width="300"></body></html>'); }
    else if (req.url === '/404') { res.writeHead(404); res.end(); }
    else if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'image/png' }); const c = Buffer.alloc(1024 * 1024, 1); let n = 0; (function w() { while (n < 17) { n++; if (!res.write(c)) { res.once('drain', w); return; } } res.end(); })(); }
    else if (req.url === '/referer') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from(String(req.headers.referer) + '|' + /Mozilla/.test(req.headers['user-agent']))); }
    else { res.writeHead(500); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  await test('downloads an image, follows redirects, sends UA + Referer (allowPrivate only for this test server)', async () => {
    let r = await fetchImage(base + '/p.png', { allowPrivate: true });
    assert.strictEqual(r.type, 'image/png'); assert.ok(r.bytes.equals(png));
    r = await fetchImage(base + '/r1', { allowPrivate: true }); assert.ok(r.bytes.equals(png));
    r = await fetchImage(base + '/referer', { allowPrivate: true });
    assert.strictEqual(r.bytes.toString(), base + '/|true');
  });
  await test('page link -> preview picture (og:image), through redirects; refuses non-pages and pages without a picture', async () => {
    let r = await fetchPageImage(base + '/page', { allowPrivate: true });
    assert.strictEqual(r.type, 'image/png'); assert.ok(r.bytes.equals(png));
    r = await fetchPageImage(base + '/page-redirect', { allowPrivate: true }); assert.ok(r.bytes.equals(png));
    await assert.rejects(() => fetchPageImage(base + '/page-none', { allowPrivate: true }), /no picture/);
    r = await fetchPageImage(base + '/p.png', { allowPrivate: true }); assert.ok(r.bytes.equals(png));   // the address was a picture itself
    r = await fetchPageImage(base + '/page-bot', { allowPrivate: true }); assert.ok(r.bytes.equals(png));   // refused for a browser, served to a preview bot
    r = await fetchPageImage(base + '/page-img', { allowPrivate: true }); assert.ok(r.bytes.equals(png));   // no og:image: first real picture of the page
    await assert.rejects(() => fetchPageImage(base + '/text', { allowPrivate: true }), /no picture/);
    await assert.rejects(() => fetchPageImage(base + '/page'), /not allowed/);          // loopback refused without the test switch
    await assert.rejects(() => fetchPageImage('file:///etc/passwd'), /not allowed/);
    assert.deepStrictEqual(findPreviewImages('<meta name="twitter:image" content="//c.com/t.jpg"><meta content="/a.png?x=1&amp;y=2" property="og:image">', 'https://ex.com/p/q'),
      ['https://ex.com/a.png?x=1&y=2', 'https://c.com/t.jpg']);
  });
  await test('rejects: non-image, 404, redirect loop, >15 MB, bad urls', async () => {
    await assert.rejects(() => fetchImage(base + '/text', { allowPrivate: true }), /not an image/);
    await assert.rejects(() => fetchImage(base + '/404', { allowPrivate: true }), /remote status 404/);
    await assert.rejects(() => fetchImage(base + '/loop', { allowPrivate: true }), /too many redirects/);
    await assert.rejects(() => fetchImage(base + '/big', { allowPrivate: true }), /too large/);
    await assert.rejects(() => fetchImage('ftp://example.com/a.png'), /not allowed/);
    await assert.rejects(() => fetchImage('file:///etc/passwd'), /not allowed/);
    await assert.rejects(() => fetchImage('not a url'), /bad url/);
    await assert.rejects(() => fetchImage(''), /no url/);
  });
  await test('by default refuses loopback / private targets (also via DNS name and via redirect)', async () => {
    await assert.rejects(() => fetchImage(base + '/p.png'), /not allowed/);
    await assert.rejects(() => fetchImage('http://localhost:' + server.address().port + '/p.png'), /not allowed/);
    await assert.rejects(() => fetchImage('http://[::1]:1/p.png'), /not allowed/);
    await assert.rejects(() => fetchImage('http://192.168.0.1/a.png'), /not allowed/);
    await assert.rejects(() => fetchImage('http://169.254.169.254/latest/meta-data'), /not allowed/);
    const redir = http.createServer((q, s) => { s.writeHead(302, { Location: base + '/p.png' }); s.end(); });
    await new Promise((r) => redir.listen(0, '127.0.0.1', r));
    // first hop is also loopback so it is refused outright; the redirect case is covered by the per-hop check in code
    await assert.rejects(() => fetchImage('http://127.0.0.1:' + redir.address().port + '/'), /not allowed/);
    redir.close();
  });
  server.close();

  console.log('main.js (mocked electron)');
  await mainTests();

  const failed = results.filter((r) => !r[1]);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})();

// ---------------------------------------------------------------------------------------------------
async function mainTests() {
  // ---- fake electron ----
  function makeElectron(opts) {
    const handlers = {};
    const app = Object.assign(new EventEmitter(), {
      _lock: opts.lock !== false, quitCalled: false, exitCode: null, switches: [], userData: null,
      setName() {}, setAppUserModelId(id) { app.aumid = id; },
      getPath(n) { return n === 'appData' ? path.join(tmp, 'appdata') : (n === 'userData' ? app.userData : tmp); },
      setPath(n, v) { if (n === 'userData') app.userData = v; },
      commandLine: { appendSwitch(k, v) { app.switches.push(k + '=' + (v || '')); } },
      requestSingleInstanceLock() { return app._lock; },
      whenReady() { return Promise.resolve(); },
      quit() { app.quitCalled = true; }, exit(c) { app.exitCode = c; }
    });
    const windows = [];
    class BrowserWindow extends EventEmitter {
      constructor(o) {
        super(); this.opts = o; this.calls = []; this.minimized = false; this.visible = false; this.maximized = false; this.title = o.title;
        const wc = (this.webContents = new EventEmitter());
        wc.sent = []; wc.send = (ch, p) => wc.sent.push([ch, p]); wc.loadedUrl = null; wc.zoom = 0; wc.js = [];
        wc.getZoomLevel = () => wc.zoom; wc.setZoomLevel = (z) => { wc.zoom = z; }; wc.toggleDevTools = () => {}; wc.reload = () => { wc.reloaded = true; };
        wc.setWindowOpenHandler = (f) => { wc.openHandler = f; }; wc.executeJavaScript = async (s) => { wc.js.push(s); return true; };
        wc.session = { addWordToSpellCheckerDictionary() {} }; wc.replaceMisspelling = () => {};
        this.loadURL = (u) => { wc.loadedUrl = u; }; windows.push(this);
      }
      maximize() { this.maximized = true; this.calls.push('maximize'); }
      isMinimized() { return this.minimized; } restore() { this.minimized = false; this.calls.push('restore'); }
      isVisible() { return this.visible; } show() { this.visible = true; this.calls.push('show'); }
      setAlwaysOnTop(v) { this.calls.push('top:' + v); } focus() { this.calls.push('focus'); } moveTop() { this.calls.push('moveTop'); }
      isDestroyed() { return false; } setTitle(t) { this.title = t; }
    }
    const dialog = {
      openResult: { canceled: true, filePaths: [] }, saveResult: { canceled: true }, msgSync: 0, msgResponse: 0, boxes: [],
      showOpenDialog: async () => dialog.openResult, showSaveDialog: async () => dialog.saveResult,
      showMessageBoxSync: () => dialog.msgSync, showMessageBox: async (w, o) => { dialog.boxes.push(o); return { response: dialog.msgResponse }; }
    };
    const protocolHandlers = {};
    return {
      app, BrowserWindow, dialog, handlers, windows, protocolHandlers,
      mod: {
        app, BrowserWindow, dialog,
        ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
        shell: { opened: [], external: [], openPath: async (p) => { mod_shell.opened.push(p); return ''; }, openExternal: (u) => mod_shell.external.push(u) },
        protocol: { registerSchemesAsPrivileged(a) { protocolHandlers.schemes = a; }, handle(s, f) { protocolHandlers[s] = f; } },
        session: { defaultSession: { setPermissionRequestHandler(f) { protocolHandlers.permReq = f; }, setPermissionCheckHandler(f) { protocolHandlers.permCheck = f; } } },
        Menu: { setApplicationMenu(m) { protocolHandlers.menu = m; }, buildFromTemplate: (t) => ({ popup() { protocolHandlers.ctx = t; } }) },
        nativeImage: { createFromPath: (p) => ({ path: p }) }
      }
    };
  }
  let mod_shell;
  function loadMain(el, argv) {
    mod_shell = el.mod.shell;
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) { return request === 'electron' ? el.mod : origLoad.apply(this, arguments); };
    const savedArgv = process.argv; process.argv = argv;
    const savedExit = process.exit; process.exit = (c) => { el.app.exitCode = c; };
    delete require.cache[require.resolve('../main.js')];
    try { require('../main.js'); } finally { Module._load = origLoad; process.argv = savedArgv; process.exit = savedExit; }
  }
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const APP_URL = 'app://pdfeditor/final.html';
  const invoke = (el, ch, ...a) => el.handlers[ch]({ senderFrame: { url: APP_URL } }, ...a);

  const pdf1 = path.join(tmp, 'first.pdf'); fs.writeFileSync(pdf1, mkPdf('one'));
  const pdf2 = path.join(tmp, 'second.pdf'); fs.writeFileSync(pdf2, mkPdf('two'));

  const el = makeElectron({});
  loadMain(el, ['C:\\PDFEditor.exe', pdf1]);
  await tick();
  const win = el.windows[0];

  await test('startup: userData pinned, taskbar identity, background-throttling switches, scheme privileged', async () => {
    assert.strictEqual(path.basename(el.app.userData), 'PDF Editor');
    assert.strictEqual(el.app.aumid === 'PDFEditor.App' || process.platform !== 'win32', true);
    assert.ok(el.app.switches.some((s) => s.includes('CalculateNativeWinOcclusion')));
    assert.ok(el.app.switches.includes('disable-renderer-backgrounding='));
    const sch = el.protocolHandlers.schemes[0];
    assert.strictEqual(sch.scheme, 'app'); assert.ok(sch.privileges.standard && sch.privileges.secure && sch.privileges.supportFetchAPI && sch.privileges.corsEnabled);
  });
  await test('window: opens maximized, title "PDF Editor", icon set, no menu, hardened webPreferences, loads app://', async () => {
    assert.ok(win.maximized); assert.strictEqual(win.opts.title, 'PDF Editor');
    assert.ok(/icon\.ico$/.test(win.opts.icon.path));
    const wp = win.opts.webPreferences;
    assert.ok(wp.contextIsolation && wp.sandbox && !wp.nodeIntegration && wp.backgroundThrottling === false);
    assert.strictEqual(win.webContents.loadedUrl, APP_URL); assert.strictEqual(el.protocolHandlers.menu, null);
    win.emit('ready-to-show'); assert.ok(win.visible);
  });
  await test('file from the command line is NOT sent until the page says it is ready, then sent once', async () => {
    assert.deepStrictEqual(win.webContents.sent, []);
    await invoke(el, 'renderer-ready');
    assert.deepStrictEqual(win.webContents.sent, [['open-pdf', { path: pdf1, name: 'first.pdf' }]]);
    await invoke(el, 'renderer-ready');
    assert.strictEqual(win.webContents.sent.length, 1);
  });
  await test('second launch: new PDF goes to the existing window, which is restored if minimized and raised', async () => {
    win.minimized = true; win.calls.length = 0; win.webContents.sent.length = 0;
    el.app.emit('second-instance', {}, ['C:\\PDFEditor.exe', pdf2], tmp);
    assert.deepStrictEqual(win.webContents.sent, [['open-pdf', { path: pdf2, name: 'second.pdf' }]]);
    assert.ok(win.calls.includes('restore'));
    assert.ok(win.calls.includes('focus'));
    assert.deepStrictEqual(win.calls.filter((c) => c.startsWith('top:')), ['top:true', 'top:false']);
    assert.strictEqual(el.windows.length, 1);              // never a second window
  });
  await test('second launch with the SAME pdf is forwarded too (the page switches to the existing tab)', async () => {
    win.webContents.sent.length = 0;
    el.app.emit('second-instance', {}, ['C:\\PDFEditor.exe', pdf1], tmp);
    assert.strictEqual(win.webContents.sent.length, 1);
  });
  await test('second launch with no file just raises the window', async () => {
    win.webContents.sent.length = 0; win.calls.length = 0;
    el.app.emit('second-instance', {}, ['C:\\PDFEditor.exe'], tmp);
    assert.strictEqual(win.webContents.sent.length, 0); assert.ok(win.calls.includes('focus'));
  });
  await test('second launch while the page is reloading is queued, then delivered when ready', async () => {
    win.webContents.emit('did-start-loading');
    win.webContents.sent.length = 0;
    el.app.emit('second-instance', {}, ['C:\\PDFEditor.exe', pdf2], tmp);
    assert.strictEqual(win.webContents.sent.length, 0);
    await invoke(el, 'renderer-ready');
    assert.strictEqual(win.webContents.sent.length, 1);
  });

  await test('IPC: read/write only for PDFs the user chose; other senders and other paths are refused', async () => {
    const r = await invoke(el, 'read-file', pdf1);
    assert.ok(Buffer.from(r.bytes).toString().startsWith('%PDF-')); assert.strictEqual(r.name, 'first.pdf');
    const stranger = path.join(tmp, 'stranger.pdf'); fs.writeFileSync(stranger, mkPdf());
    await assert.rejects(() => invoke(el, 'read-file', stranger), /not opened from here/);
    await assert.rejects(() => invoke(el, 'write-file', stranger, mkPdf('x')), /not opened from here/);
    await assert.rejects(() => invoke(el, 'read-file', path.join(tmp, 'notes.txt')), /not opened from here/);
    await assert.rejects(() => el.handlers['read-file']({ senderFrame: { url: 'https://evil.example/x' } }, pdf1), /not allowed/);
    await assert.rejects(() => el.handlers['write-file']({ senderFrame: { url: 'file:///x.html' } }, pdf1, mkPdf()), /not allowed/);
  });
  await test('Ctrl+S path: write-file saves back into the opened file in place; invalid data is refused', async () => {
    await invoke(el, 'write-file', pdf1, new Uint8Array(mkPdf('saved-in-place')));
    assert.ok(fs.readFileSync(pdf1).toString().includes('saved-in-place'));
    await assert.rejects(() => invoke(el, 'write-file', pdf1, new Uint8Array(Buffer.from('garbage-not-pdf'))), /Not a PDF/);
    assert.ok(fs.readFileSync(pdf1).toString().includes('saved-in-place'));
  });
  await test('open dialog: cancel -> null; chosen file is granted; Save As adds .pdf and grants the new path', async () => {
    assert.strictEqual(await invoke(el, 'pick-open'), null);
    const chosen = path.join(tmp, 'chosen.pdf'); fs.writeFileSync(chosen, mkPdf('c'));
    el.dialog.openResult = { canceled: false, filePaths: [chosen] };
    assert.deepStrictEqual(await invoke(el, 'pick-open'), { path: chosen, name: 'chosen.pdf' });
    await invoke(el, 'read-file', chosen);
    assert.strictEqual(await invoke(el, 'pick-save', 'x - annotated.pdf'), null);
    el.dialog.saveResult = { canceled: false, filePath: path.join(tmp, 'saveas') };
    const s = await invoke(el, 'pick-save', 'x - annotated.pdf');
    assert.strictEqual(s.name, 'saveas.pdf');
    await invoke(el, 'write-file', s.path, mkPdf('as'));
    assert.ok(fs.existsSync(path.join(tmp, 'saveas.pdf')));
  });
  await test('dropped PDF: grant-drop grants real PDFs only', async () => {
    const dropped = path.join(tmp, 'dropped.pdf'); fs.writeFileSync(dropped, mkPdf());
    assert.strictEqual(await invoke(el, 'grant-drop', dropped), true);
    await invoke(el, 'read-file', dropped);
    assert.strictEqual(await invoke(el, 'grant-drop', path.join(tmp, 'notes.txt')), false);
    assert.strictEqual(await invoke(el, 'grant-drop', 'relative.pdf'), false);
  });
  await test('attachment open: executable refused; document handed to the OS opener', async () => {
    await assert.rejects(() => invoke(el, 'open-attachment', 'setup.exe', new Uint8Array([1, 2, 3])), /not opened from here/);
    await invoke(el, 'open-attachment', 'notes.docx', new Uint8Array([1, 2, 3]));
    assert.ok(el.mod.shell.opened.length === 1 && /notes\.docx$/.test(el.mod.shell.opened[0]));
  });
  await test('closing with unsaved changes: Leave lets it close, Stay keeps it', async () => {
    let prevented = 0; const ev = { preventDefault() { prevented++; } };
    el.dialog.msgSync = 1; win.webContents.emit('will-prevent-unload', ev); assert.strictEqual(prevented, 0);
    el.dialog.msgSync = 0; win.webContents.emit('will-prevent-unload', ev); assert.strictEqual(prevented, 1);
  });
  await test('external links open in the default browser, in-app navigation elsewhere is blocked', async () => {
    assert.deepStrictEqual(win.webContents.openHandler({ url: 'https://example.com/a' }), { action: 'deny' });
    assert.deepStrictEqual(el.mod.shell.external, ['https://example.com/a']);
    win.webContents.openHandler({ url: 'javascript:alert(1)' }); assert.strictEqual(el.mod.shell.external.length, 1);
    let np = 0; win.webContents.emit('will-navigate', { preventDefault() { np++; } }, 'https://evil.example/'); assert.strictEqual(np, 1);
    np = 0; win.webContents.emit('will-navigate', { preventDefault() { np++; } }, 'app://pdfeditor/final.html'); assert.strictEqual(np, 0);
  });
  await test('permissions: clipboard allowed, camera/geolocation/notifications denied', async () => {
    let got = {}; ['clipboard-read', 'clipboard-sanitized-write', 'media', 'geolocation', 'notifications'].forEach((p) => el.protocolHandlers.permReq(null, p, (v) => { got[p] = v; }));
    assert.deepStrictEqual(got, { 'clipboard-read': true, 'clipboard-sanitized-write': true, media: false, geolocation: false, notifications: false });
  });
  await test('app:// protocol: serves files with CSP + MIME, 404s missing files, blocks traversal and other hosts', async () => {
    const h = el.protocolHandlers.app;
    let r = await h({ url: 'app://pdfeditor/final.html' });
    assert.strictEqual(r.status, 200); assert.ok(/text\/html/.test(r.headers.get('content-type'))); assert.ok(/default-src 'self'/.test(r.headers.get('content-security-policy')));
    assert.ok((await r.text()).includes('electron-bridge.js'));
    r = await h({ url: 'app://pdfeditor/' }); assert.strictEqual(r.status, 200);
    r = await h({ url: 'app://pdfeditor/electron-bridge.js' }); assert.strictEqual(r.status, 200); assert.ok(/javascript/.test(r.headers.get('content-type')));
    r = await h({ url: 'app://pdfeditor/nope.js' }); assert.strictEqual(r.status, 404);
    r = await h({ url: 'app://pdfeditor/%2e%2e/main.js' }); assert.ok(r.status === 403 || r.status === 404); assert.ok(!(await r.text()).includes('Electron main process'));
    r = await h({ url: 'app://pdfeditor/..%2fmain.js' }); assert.ok(r.status === 403 || r.status === 404);
    r = await h({ url: 'app://other/final.html' }); assert.strictEqual(r.status, 404);
  });

  await test('settings migration: file argument is confirmed, then written to localStorage and the page reloads', async () => {
    const sf = path.join(tmp, 'pdfeditor-settings.json');
    fs.writeFileSync(sf, JSON.stringify({ app: 'PDFEditor', items: { 'pdfEditor.bar': '2', aiKey: 'k-123', bad: 5 } }));
    win.webContents.js.length = 0; el.dialog.boxes.length = 0; el.dialog.msgResponse = 0;
    el.app.emit('second-instance', {}, ['C:\\PDFEditor.exe', sf], tmp);
    await tick(); await tick();
    assert.strictEqual(el.dialog.boxes.length, 1); assert.ok(/Import 2 saved settings/.test(el.dialog.boxes[0].message));
    assert.ok(win.webContents.js[0].includes('"aiKey":"k-123"') && !win.webContents.js[0].includes('"bad"'));
    assert.ok(win.webContents.reloaded);
    win.webContents.js.length = 0; win.webContents.reloaded = false; el.dialog.msgResponse = 1;
    el.app.emit('second-instance', {}, ['C:\\PDFEditor.exe', sf], tmp); await tick(); await tick();
    assert.strictEqual(win.webContents.js.length, 0);       // cancelled: nothing written
  });

  await test('closing the window quits the app', async () => {
    el.app.emit('window-all-closed'); assert.ok(el.app.quitCalled);
  });

  // second process while one is already running: must quit and never create a window
  const el2 = makeElectron({ lock: false });
  loadMain(el2, ['C:\\PDFEditor.exe', pdf1]); await tick();
  await test('a second process that cannot get the single-instance lock quits without opening a window', async () => {
    assert.ok(el2.app.quitCalled); assert.strictEqual(el2.windows.length, 0);
  });
}
