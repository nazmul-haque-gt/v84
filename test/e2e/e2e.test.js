'use strict';
/* End-to-end flows in headless Chromium: node test/e2e/e2e.test.js   (needs playwright + python3 with pikepdf/pypdf for checking saved files)
 * See harness.js for what is real and what is stand-in. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const h = require('./harness');

const FX = path.join(__dirname, '..', 'fixtures');
const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log('  ok   ' + name); }
  catch (e) { results.push([name, false]); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')); }
}

function pdfInfo(file) {          // strict re-open with two independent PDF libraries
  const py = `
import json,sys,pikepdf
from pypdf import PdfReader
f=sys.argv[1]
with pikepdf.open(f) as p: n=len(p.pages)
r=PdfReader(f); ann=[]
for pg in r.pages:
    for a in (pg.get('/Annots') or []):
        a=a.get_object(); ann.append({'subtype':str(a.get('/Subtype')),'contents':str(a.get('/Contents',''))})
print(json.dumps({'pages':n,'annots':ann}))`;
  return JSON.parse(execFileSync('python3', ['-c', py, file]).toString());
}

(async function main() {
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pdfed-files-'));
  const A = path.join(work, 'alpha.pdf'), B = path.join(work, 'beta document.pdf'), G = path.join(work, 'gamma.pdf');
  fs.copyFileSync(path.join(FX, 'alpha.pdf'), A); fs.copyFileSync(path.join(FX, 'beta document.pdf'), B); fs.copyFileSync(path.join(FX, 'gamma.pdf'), G);

  // a tiny image server on loopback for the pasted-figure test
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8Dwn4EIwDiqkL4KAG+aA/3tL0M1AAAAAElFTkSuQmCC', 'base64');
  const img = http.createServer((q, s) => {
    if (q.url === '/src-page') { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html><head><meta property="og:image" content="/fig.png"></head></html>'); return; }
    if (q.url === '/src-nopic') { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html><head></head></html>'); return; }
    s.writeHead(200, { 'Content-Type': 'image/png' }); s.end(png);
  });
  await new Promise((r) => img.listen(0, '127.0.0.1', r));
  const imgUrl = 'http://127.0.0.1:' + img.address().port + '/fig.png';

  const t = await h.start({ argv: [A] });
  const { page, el } = t;
  console.log('PDF engine in this run: ' + t.pdfEngine);
  const names = () => page.$$eval('#tabList .tab .tab-name', (e) => e.map((x) => x.textContent));
  const active = () => page.$eval('#tabList .tab.active .tab-name', (e) => e.textContent);
  const waitTabs = (n) => page.waitForFunction((n) => document.querySelectorAll('#tabList .tab').length === n, n, { timeout: 20000 });
  const saveEnabled = () => page.$eval('#exportBtn', (b) => !b.disabled);
  const savedDone = () => page.waitForFunction(() => { const b = document.getElementById('exportBtn'); return b.disabled && !/\u2026|\.\.\./.test(b.textContent); }, null, { timeout: 25000 }).then(() => page.waitForTimeout(250));
  const toastText = () => page.$eval('#toast', (e) => e.textContent);
  async function addComment(text, nthPage) {
    if ((await page.getAttribute('#cmtBtn', 'aria-pressed')) !== 'true') await page.click('#cmtBtn');
    await page.locator('.page-wrap').nth(nthPage || 0).scrollIntoViewIfNeeded();
    const box = await page.locator('.page-wrap').nth(nthPage || 0).boundingBox();
    await page.mouse.click(box.x + 150, Math.max(box.y, 0) + 220);
    await page.waitForSelector('#cmtPanel:not([hidden])');
    await page.click('#cmtEditor'); await page.keyboard.type(text);
    await page.waitForSelector('#cmtSave:not([hidden])');
    await page.click('#cmtSave');
    await page.waitForTimeout(400);
  }
  const closePanel = async () => { await page.keyboard.press('Escape'); await page.waitForSelector('#cmtPanel', { state: 'hidden' }); };

  await waitTabs(1);
  await page.waitForFunction(() => document.querySelectorAll('.page-wrap').length === 2, null, { timeout: 20000 });

  console.log('start-up and opening files');
  await test('file given on the command line opens as a tab; window title is "PDF Editor"; page is not dirty', async () => {
    assert.deepStrictEqual(await names(), ['alpha.pdf']);
    assert.strictEqual(await page.title(), 'PDF Editor');
    assert.strictEqual(await saveEnabled(), false);
  });
  await test('second launch with another PDF opens a NEW tab (name with a space) and shows it; still one window', async () => {
    t.secondInstance([B]); await waitTabs(2);
    assert.deepStrictEqual(await names(), ['alpha.pdf', 'beta document.pdf']);
    assert.strictEqual(await active(), 'beta document.pdf');
    await page.waitForFunction(() => document.querySelectorAll('.page-wrap').length === 3, null, { timeout: 20000 });
  });
  await test('second launch with a PDF that is already open switches to its tab, no duplicate tab', async () => {
    t.secondInstance([A]); await page.waitForFunction(() => document.querySelector('#tabList .tab.active .tab-name').textContent === 'alpha.pdf', null, { timeout: 10000 });
    assert.strictEqual((await names()).length, 2);
    assert.ok(/already open/i.test(await toastText()));
  });
  await test('Open button: native dialog result opens a tab; cancelling does nothing', async () => {
    await page.click('#openBtn'); await page.waitForTimeout(300); assert.strictEqual((await names()).length, 2);
    el.dialog.openResult = { canceled: false, filePaths: [G] };
    await page.click('#openBtn'); await waitTabs(3);
    assert.strictEqual(await active(), 'gamma.pdf');
    el.dialog.openResult = { canceled: true, filePaths: [] };
  });

  console.log('comments, dirty state and saving back into the original file');
  await test('on a fresh tab Save PDF is disabled; adding a comment enables it and shows the unsaved dot', async () => {
    await page.locator('#tabList .tab', { hasText: 'alpha.pdf' }).click();
    await page.waitForTimeout(500);
    assert.strictEqual(await saveEnabled(), false);
    await addComment('First comment on alpha');
    assert.strictEqual(await saveEnabled(), true);
    await closePanel();
    assert.ok(await page.$eval('#tabList .tab.active', (e) => /dirty|unsaved|modified/i.test(e.className + ' ' + e.innerHTML) || !!e.querySelector('.tab-dot')));
  });
  const beforeSave = fs.statSync(A).mtimeMs;
  await test('Ctrl+S writes straight back into the file that was opened from the command line', async () => {
    await page.keyboard.press('Control+s');
    await savedDone();
    assert.ok(fs.statSync(A).mtimeMs >= beforeSave);
    const info = pdfInfo(A);
    assert.strictEqual(info.pages, 2);
    assert.ok(info.annots.some((a) => /First comment on alpha/.test(a.contents)), JSON.stringify(info.annots));
    assert.deepStrictEqual(fs.readdirSync(work).filter((n) => n.endsWith('.tmp')), []);
    assert.strictEqual(await saveEnabled(), false);
    assert.ok(/Saved/.test(await toastText()));
  });
  await test('saved file is a normal PDF: re-opened by a second launch it shows the comment again (round trip)', async () => {
    // close alpha tab, reopen through a second launch
    await page.locator('#tabList .tab', { hasText: 'alpha.pdf' }).locator('.tab-x').click();
    await page.waitForTimeout(500); assert.ok(!(await names()).includes('alpha.pdf'));
    t.secondInstance([A]); await page.waitForFunction(() => /alpha\.pdf/.test(document.querySelector('#tabList .tab.active .tab-name').textContent), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.page-wrap').length >= 2, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    assert.ok((await page.locator('.pin, [class*="pin"]').count()) > 0, 'comment pin not restored');
  });
  await test('unsaved comment changes block switching tabs, closing the tab and Escape; Save releases them', async () => {
    // open the existing comment by clicking its pin, edit it
    await page.locator('.page-wrap .pin, .page-wrap [class*="pin"]').first().click({ force: true });
    await page.waitForSelector('#cmtPanel:not([hidden])');
    await page.click('#cmtEditor'); await page.keyboard.press('End'); await page.keyboard.type(' EDITED');
    await page.waitForSelector('#cmtSave:not([hidden])');
    const before = await active();
    await page.locator('#tabList .tab:not(.active)').first().click();
    await page.waitForTimeout(400);
    assert.strictEqual(await active(), before, 'tab switched while a comment had unsaved changes');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.ok(await page.$eval('#cmtPanel', (p) => !p.hidden), 'Esc closed a comment with unsaved changes');
    await page.locator('#tabList .tab.active .tab-x').click(); await page.waitForTimeout(300);
    assert.strictEqual(await active(), before, 'tab closed with unsaved comment changes');
    // beforeunload (window close) is cancelled while dirty
    assert.strictEqual(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
    await page.click('#cmtSave'); await page.waitForTimeout(400);
    await closePanel();
    await page.locator('#tabList .tab:not(.active)').first().click(); await page.waitForTimeout(300);
    assert.notStrictEqual(await active(), before);
  });
  await test('Ctrl+Shift+S is Save As: uses the native save dialog, writes the new file, later Ctrl+S goes to the NEW file', async () => {
    await page.locator('#tabList .tab', { hasText: 'alpha.pdf' }).click(); await page.waitForTimeout(500);
    const alphaBefore = fs.readFileSync(A);
    el.dialog.saveResult = { canceled: false, filePath: path.join(work, 'alpha copy') };
    await page.keyboard.press('Control+Shift+S');
    await page.waitForFunction(() => /alpha copy\.pdf/.test(document.querySelector('#tabList .tab.active .tab-name').textContent), null, { timeout: 20000 });
    const copy = path.join(work, 'alpha copy.pdf');
    assert.ok(pdfInfo(copy).annots.some((a) => /EDITED/.test(a.contents)));
    assert.ok(alphaBefore.equals(fs.readFileSync(A)), 'Save As must not touch the original');
    await addComment('after save as', 1); await closePanel();
    await page.keyboard.press('Control+s');
    await savedDone();
    assert.ok(pdfInfo(copy).annots.some((a) => /after save as/.test(a.contents)));
    assert.ok(alphaBefore.equals(fs.readFileSync(A)), 'Ctrl+S after Save As must write to the new file only');
    el.dialog.saveResult = { canceled: true };
  });
  await test('cancelling the Save As dialog leaves things as they were', async () => {
    await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(600);
    assert.ok(/alpha copy/.test(await active()));
  });
  await test('read-only / locked file: save fails with a Retry message and the original is untouched', async () => {
    t.secondInstance([G]); await page.waitForFunction(() => /gamma\.pdf/.test(document.querySelector('#tabList .tab.active .tab-name').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await addComment('gamma note'); await closePanel();
    const orig = fs.readFileSync(G);
    fs.chmodSync(work, 0o555);                          // folder not writable: the temp file cannot be created (stands in for a locked file)
    let skipped = false; if (process.getuid && process.getuid() === 0) skipped = true;   // root ignores permissions
    if (!skipped) {
      await page.keyboard.press('Control+s'); await page.waitForTimeout(1500);
      assert.ok(/Could not save/i.test(await toastText()), await toastText());
      assert.ok(orig.equals(fs.readFileSync(G)));
    }
    fs.chmodSync(work, 0o755);
    if (skipped) console.log('       (running as root: the permission-denied part was skipped)');
    await page.keyboard.press('Control+s');
    await savedDone();
    assert.ok(pdfInfo(G).annots.some((a) => /gamma note/.test(a.contents)));
  });

  console.log('tabs, drag and drop, attachments, pasted pictures');
  await test('dragging a tab to a new position changes the order', async () => {
    const before = await names();
    const tabs = page.locator('#tabList .tab');
    const a = await tabs.nth(0).boundingBox(), b = await tabs.nth(before.length - 1).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up(); await page.waitForTimeout(400);
    const after = await names();
    assert.notDeepStrictEqual(after, before); assert.deepStrictEqual([...after].sort(), [...before].sort());
    assert.strictEqual(after[after.length - 1], before[0]);
  });
  await test('a PDF dropped on the window opens in a tab with a real handle, so Ctrl+S saves in place', async () => {
    const D = path.join(work, 'dropped.pdf'); fs.copyFileSync(path.join(FX, 'gamma.pdf'), D);
    // vary the size so it is not mistaken for gamma.pdf's key
    fs.appendFileSync(D, '\n% padding\n');
    const b64 = fs.readFileSync(D).toString('base64');
    await page.evaluate(async ({ b64, p }) => {
      const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const f = new File([u8], 'dropped.pdf', { type: 'application/pdf' }); f.__testPath = p;
      const dt = new DataTransfer(); dt.items.add(f);
      document.getElementById('viewer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { b64, p: D });
    await page.waitForFunction(() => /dropped\.pdf/.test(document.querySelector('#tabList .tab.active .tab-name').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await addComment('dropped note'); await closePanel();
    await page.keyboard.press('Control+s');
    await savedDone();
    assert.ok(pdfInfo(D).annots.some((a) => /dropped note/.test(a.contents)));
  });
  await test('a non-PDF dropped on the window is refused politely', async () => {
    await page.evaluate(async () => {
      const f = new File([new Uint8Array([1, 2, 3])], 'x.txt', { type: 'text/plain' });
      const dt = new DataTransfer(); dt.items.add(f);
      document.getElementById('viewer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(400); assert.ok(/Choose a PDF/.test(await toastText()));
  });
  await test('attachment "Open": bytes go to the desktop app and are opened with the default program; .exe refused', async () => {
    const r = await page.evaluate(async () => {
      const N = window.pdfEditorNative; const out = {};
      try { await N.openAttachment('report.docx', new Uint8Array([80, 75, 3, 4])); out.docx = 'ok'; } catch (e) { out.docx = String(e.message); }
      try { await N.openAttachment('run.exe', new Uint8Array([77, 90])); out.exe = 'ok'; } catch (e) { out.exe = String(e.message); }
      return out;
    });
    assert.strictEqual(r.docx, 'ok'); assert.ok(/not opened from here/.test(r.exe), JSON.stringify(r));
    assert.ok(el.shell.opened.some((p) => /report\.docx$/.test(p)) && !el.shell.opened.some((p) => /\.exe$/.test(p)));
  });
  await test('Double click option: double-click selects the whole word (select tool) and highlights it (Highlight tool); the old swap option is gone', async () => {
    if (await page.$eval('#cmtPanel', (p) => !p.hidden).catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    assert.strictEqual(await page.$('#hlSwapClickChk'), null); assert.strictEqual(await page.$('#aiMenuSwapClick'), null);
    assert.ok(await page.$('#hlDblClickChk'));
    await page.waitForSelector('.page-wrap .text-layer span', { timeout: 15000 });
    await page.locator('.page-wrap').first().scrollIntoViewIfNeeded();
    // a word (4+ letters) somewhere on the first page: its on-screen box and text
    const findWord = (skip) => page.evaluate((skip) => {
      const spans = document.querySelectorAll('.page-wrap .text-layer span'); let seen = 0;
      for (const sp of spans) {
        const tn = sp.firstChild; if (!tn || tn.nodeType !== 3) continue;
        const re = /[A-Za-z]{4,}/g; let m;
        while ((m = re.exec(tn.nodeValue))) {
          const r = document.createRange(); r.setStart(tn, m.index); r.setEnd(tn, m.index + m[0].length);
          const b = r.getBoundingClientRect();
          if (b.width < 4 || b.top < 90 || b.bottom > innerHeight - 10) continue;
          if (seen++ < skip) continue;
          return { word: m[0], x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
        }
      }
      return null;
    }, skip);
    const hl = () => page.$$eval('.hl-rect', (e) => e.length);
    const dblOn = await page.$eval('#hlDblClickChk', (c) => c.checked); assert.strictEqual(dblOn, true);
    // select tool: whole word is selected
    for (const b of ['#cmtBtn', '#hlBtn']) if ((await page.getAttribute(b, 'aria-pressed')) === 'true') await page.click(b);   // plain select tool
    assert.strictEqual(await page.$eval('.stage', (e) => e.dataset.tool || 'none'), 'none');
    let w = await findWord(0); assert.ok(w, 'no word found on the page');
    await page.mouse.dblclick(w.x, w.y); await page.waitForTimeout(150);
    let sel = await page.evaluate(() => String(window.getSelection()));
    assert.strictEqual(sel.trim(), w.word, 'selected ' + JSON.stringify(sel) + ' wanted ' + w.word);
    await page.mouse.click(5, 5).catch(() => {});
    // highlight tool: the word is highlighted
    await page.click('#hlBtn'); const before = await hl();
    w = await findWord(1); assert.ok(w);
    await page.mouse.dblclick(w.x, w.y); await page.waitForTimeout(400);
    assert.ok((await hl()) > before, 'no highlight was created by the double-click');
    const rw = await page.evaluate(() => { const r = document.querySelectorAll('.hl-rect'); return r[r.length - 1].getBoundingClientRect().width; });
    assert.ok(Math.abs(rw - w.w) < Math.max(6, w.w * 0.25), 'highlight width ' + rw + ' vs word ' + w.w);
    // a double-click a little above/below the letters (between the text box and the next line) still takes the word - it must not start a brush stroke
    const b2 = await hl(); w = await findWord(2); assert.ok(w);
    await page.mouse.dblclick(w.x, w.y + w.h * 0.62); await page.waitForTimeout(400);
    assert.ok((await hl()) > b2, 'double-click just off the text did not highlight the word');
    // "Free-draw on OCR text" on and the word is scanned (OCR) text: a double-click still highlights the word
    await page.evaluate(() => { document.querySelectorAll('.page-wrap .text-layer span').forEach((x) => x.classList.add('ocr')); const c = document.getElementById('hlFreeOcrChk'); c.checked = true; c.dispatchEvent(new Event('change')); });
    const b3 = await hl(); w = await findWord(3); assert.ok(w);
    await page.mouse.dblclick(w.x, w.y); await page.waitForTimeout(400);
    assert.ok((await hl()) > b3, 'double-click on OCR text with free-draw on did not highlight the word');
    await page.evaluate(() => { document.querySelectorAll('.page-wrap .text-layer span.ocr').forEach((x) => x.classList.remove('ocr')); const c = document.getElementById('hlFreeOcrChk'); c.checked = false; c.dispatchEvent(new Event('change')); });
    // double-click, keep the second press held and drag to the right/next line: the selection grows word by word
    const findLine = () => page.evaluate(() => {
      const spans = [...document.querySelectorAll('.page-wrap .text-layer span')];
      for (const sp of spans) {
        const tn = sp.firstChild; if (!tn || tn.nodeType !== 3) continue;
        const m = /([A-Za-z]{3,})\s+([A-Za-z]{3,})\s+([A-Za-z]{3,})/.exec(tn.nodeValue); if (!m) continue;
        const rg = (a, b) => { const r = document.createRange(); r.setStart(tn, a); r.setEnd(tn, b); return r.getBoundingClientRect(); };
        const i1 = m.index, i2 = m.index + m[1].length + 1, i3 = i2 + m[2].length + 1;
        const b1 = rg(i1, i1 + m[1].length), b3 = rg(i3, i3 + m[3].length);
        if (b1.top < 90 || b1.bottom > innerHeight - 10) continue;
        return { w1: m[1], w2: m[2], w3: m[3], x1: b1.left + b1.width / 2, y: b1.top + b1.height / 2, x3: b3.left + b3.width * 0.3 };
      }
      return null;
    });
    const L = await findLine(); assert.ok(L, 'no 3-word run found: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.page-wrap .text-layer span')].slice(0, 12).map((x) => x.textContent))));
    const b4 = await hl();
    await page.mouse.move(L.x1, L.y); await page.mouse.down(); await page.mouse.up(); await page.mouse.down();
    await page.mouse.move(L.x3 - 10, L.y, { steps: 6 }); await page.mouse.move(L.x3, L.y, { steps: 3 });
    const selDuring = await page.evaluate(() => String(window.getSelection()));
    await page.mouse.up(); await page.waitForTimeout(400);
    console.log('DRAGSEL', JSON.stringify(selDuring), JSON.stringify([L.w1, L.w2, L.w3]));
    assert.strictEqual(selDuring.replace(/\s+/g, ' ').trim(), L.w1 + ' ' + L.w2 + ' ' + L.w3, 'during the drag the selection was ' + JSON.stringify(selDuring));
    assert.ok((await hl()) > b4, 'dragged double-click did not highlight');
    // a plain press-and-drag (no double-click) also grows word by word while the option is on, starting/ending in the middle of words
    await page.mouse.click(5, 5).catch(() => {}); await page.waitForTimeout(100);
    const L2 = await findLine(); assert.ok(L2);
    const b5 = await hl();
    await page.mouse.move(L2.x1, L2.y); await page.mouse.down();
    await page.mouse.move(L2.x1 + 12, L2.y, { steps: 4 }); await page.mouse.move(L2.x3, L2.y, { steps: 6 });
    const selPlain = await page.evaluate(() => String(window.getSelection()));
    await page.mouse.up(); await page.waitForTimeout(400);
    assert.strictEqual(selPlain.replace(/\s+/g, ' ').trim(), L2.w1 + ' ' + L2.w2 + ' ' + L2.w3, 'plain drag selected ' + JSON.stringify(selPlain));
    assert.ok((await hl()) > b5, 'plain drag did not highlight');
    // option off: the same drag is letter-exact again (browser behaviour), not whole words
    await page.evaluate(() => { const c = document.getElementById('hlDblClickChk'); c.checked = false; c.dispatchEvent(new Event('change')); });
    const L3 = await findLine(); assert.ok(L3);
    await page.mouse.move(L3.x1, L3.y); await page.mouse.down();
    await page.mouse.move(L3.x1 + 12, L3.y, { steps: 4 }); await page.mouse.move(L3.x3, L3.y, { steps: 6 });
    const selRaw = await page.evaluate(() => String(window.getSelection()));
    await page.mouse.up(); await page.waitForTimeout(400);
    assert.notStrictEqual(selRaw.replace(/\s+/g, ' ').trim(), L3.w1 + ' ' + L3.w2 + ' ' + L3.w3, 'with the option off the drag should not snap to words: ' + JSON.stringify(selRaw));
    await page.evaluate(() => { const c = document.getElementById('hlDblClickChk'); c.checked = true; c.dispatchEvent(new Event('change')); });
    // option off + remembered
    await page.evaluate(() => { const c = document.getElementById('hlDblClickChk'); c.checked = false; c.dispatchEvent(new Event('change')); });
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('pdfEditor.dblClickWord')), '0');
    await page.evaluate(() => { const c = document.getElementById('hlDblClickChk'); c.checked = true; c.dispatchEvent(new Event('change')); });
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('pdfEditor.dblClickWord')), '1');
    await page.click('#hlBtn');   // back to the select tool
    await page.keyboard.press('Control+z').catch(() => {}); await page.waitForTimeout(200);
  });
  await test('pasted web figure: the comment editor downloads it through the desktop app and embeds it (CSP blocks the direct fetch)', async () => {
    if (await page.$eval('#cmtPanel', (p) => !p.hidden)) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    if ((await page.getAttribute('#cmtBtn', 'aria-pressed')) !== 'true') await page.click('#cmtBtn');
    await page.locator('.page-wrap').first().scrollIntoViewIfNeeded();
    const box = await page.locator('.page-wrap').first().boundingBox();
    await page.mouse.click(box.x + 200, Math.max(box.y, 0) + 300);
    await page.waitForSelector('#cmtPanel:not([hidden])');
    await page.click('#cmtEditor');
    await page.evaluate((u) => {
      const ed = document.getElementById('cmtEditor');
      ed.innerHTML = '<p>figure: <img src="' + u + '"></p>';
      const dt = new DataTransfer(); dt.setData('text/html', ed.innerHTML); dt.setData('text/plain', 'figure:');
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, imgUrl);
    await page.waitForFunction(() => { const i = document.querySelector('#cmtEditor img'); return i && /^data:image\//.test(i.getAttribute('src')); }, null, { timeout: 15000 });
    await page.click('#cmtCancel').catch(() => {}); await page.keyboard.press('Escape');
  });
  await test('pasted source links from an AI chat (page links, no picture): the page picture is embedded above the link; a page without picture stays a plain link; links inside a sentence are left alone', async () => {
    if (await page.$eval('#cmtPanel', (p) => !p.hidden).catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    if ((await page.getAttribute('#cmtBtn', 'aria-pressed')) !== 'true') await page.click('#cmtBtn');
    await page.locator('.page-wrap').first().scrollIntoViewIfNeeded();
    const box = await page.locator('.page-wrap').first().boundingBox();
    await page.mouse.click(box.x + 220, Math.max(box.y, 0) + 340);
    await page.waitForSelector('#cmtPanel:not([hidden])');
    await page.click('#cmtEditor');
    const base = imgUrl.replace('/fig.png', '');
    await page.evaluate((b) => {
      const ed = document.getElementById('cmtEditor');
      ed.innerHTML = '<h2>Stem Cells</h2><div><a href="' + b + '/src-page">Embryonic Stem Cell</a><br><a href="' + b + '/src-nopic">No picture page</a></div><p>see <a href="' + b + '/src-page?inline=1">this page</a> for more</p><div>8</div>';
      const dt = new DataTransfer(); dt.setData('text/html', ed.innerHTML); dt.setData('text/plain', 'Stem Cells Embryonic Stem Cell No picture page');
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, base);
    await page.waitForFunction(() => { const i = document.querySelectorAll('#cmtEditor img'); return i.length === 1 && /^data:image\//.test(i[0].getAttribute('src')); }, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      imgs: document.querySelectorAll('#cmtEditor img').length,
      links: Array.prototype.map.call(document.querySelectorAll('#cmtEditor a'), (a) => a.textContent),
      imgBeforeFirstLink: (function () { const a = document.querySelector('#cmtEditor a'); return !!(a.previousSibling && a.previousSibling.previousSibling && a.previousSibling.previousSibling.nodeName === 'IMG'); })(),
      leftovers: document.querySelectorAll('#cmtEditor img[data-page-link]').length
    }));
    assert.strictEqual(r.imgs, 1, JSON.stringify(r));
    assert.deepStrictEqual(r.links, ['Embryonic Stem Cell', 'No picture page', 'this page'], JSON.stringify(r));
    assert.ok(r.imgBeforeFirstLink && r.leftovers === 0, JSON.stringify(r));
    await page.click('#cmtCancel').catch(() => {}); await page.keyboard.press('Escape');
  });
  await test('close buttons: closing a clean tab works; the last tab can be closed', async () => {
    await page.waitForTimeout(300);
    for (let i = 0; i < 8; i++) {
      const n = (await names()).length; if (!n) break;
      if (await page.$eval('#cmtPanel', (p) => !p.hidden).catch(() => false)) {
        if (await page.$eval('#cmtSave', (b) => !b.hidden)) { await page.click('#cmtSave'); await page.waitForTimeout(300); }   // unsaved comment edits must be saved before it can close
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      }
      const dirtyNow = await saveEnabled();
      if (dirtyNow) { await page.keyboard.press('Control+s'); await page.waitForTimeout(1200); }
      await page.locator('#tabList .tab.active .tab-x').click(); await page.waitForTimeout(250);
    }
    assert.strictEqual((await names()).length, 0);
  });

  console.log('recent PDFs on the home screen');
  const recentNames = () => page.$$eval('#recentList .recent-name', (e) => e.map((x) => x.textContent));
  await test('with no tab open the home screen lists earlier PDFs, newest first', async () => {
    await page.waitForSelector('#recent:not([hidden])');
    const rec = await recentNames();
    assert.ok(rec.includes('alpha.pdf') && rec.includes('gamma.pdf') && rec.includes('beta document.pdf'), JSON.stringify(rec));
    assert.ok(rec.indexOf('alpha.pdf') < rec.indexOf('beta document.pdf'), JSON.stringify(rec));   // alpha was re-opened more recently than beta
    assert.ok(await page.$eval('#recent', (e) => e.offsetParent !== null));
  });
  await test('clicking a recent PDF opens it; it has a real handle so Ctrl+S saves into that same file', async () => {
    await page.locator('#recentList .recent-item', { hasText: 'alpha.pdf' }).locator('.recent-open').click();
    await waitTabs(1); assert.strictEqual(await active(), 'alpha.pdf');
    assert.ok(!(await page.$eval('#recent', (e) => e.offsetParent !== null)));        // hidden while a tab is open
    await page.waitForFunction(() => document.querySelectorAll('.page-wrap').length >= 1, null, { timeout: 20000 });
    await addComment('via recent list'); await closePanel();
    assert.ok(await saveEnabled()); await page.keyboard.press('Control+s'); await savedDone();
    assert.ok(pdfInfo(A).annots.some((a) => /via recent list/.test(a.contents)));
  });
  await test('closing the last tab brings the list back with that file on top', async () => {
    await page.locator('#tabList .tab.active .tab-x').click();
    await page.waitForSelector('#recent:not([hidden])');
    assert.strictEqual((await recentNames())[0], 'alpha.pdf');
  });
  await test('a recent file that was deleted is marked not found, cannot be opened, and can be removed', async () => {
    const V = path.join(work, 'vanishing.pdf'); fs.copyFileSync(path.join(FX, 'alpha.pdf'), V);
    t.secondInstance([V]); await waitTabs(1);
    await page.locator('#tabList .tab.active .tab-x').click(); await page.waitForSelector('#recent:not([hidden])');
    assert.strictEqual((await recentNames())[0], 'vanishing.pdf');
    fs.unlinkSync(V);
    await page.reload(); await page.waitForSelector('#recent:not([hidden])');
    const row = page.locator('#recentList .recent-item', { hasText: 'vanishing.pdf' });
    assert.ok(/missing/.test(await row.getAttribute('class')));
    await row.locator('.recent-open').click();
    await page.waitForFunction(() => /Could not open vanishing\.pdf/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
    assert.strictEqual((await names()).length, 0);
    await page.locator('#recentList .recent-item', { hasText: 'vanishing.pdf' }).locator('.recent-x').click();
    await page.waitForFunction(() => !/vanishing/.test(document.getElementById('recentList').textContent), null, { timeout: 5000 });
  });
  await test('the list survives a restart of the page and the page cannot use it to open a file that was never opened', async () => {
    await page.reload(); await page.waitForSelector('#recent:not([hidden])');
    assert.ok((await recentNames()).includes('gamma.pdf'));
    const N = path.join(work, 'never-opened.pdf'); fs.copyFileSync(path.join(FX, 'alpha.pdf'), N);
    const r = await page.evaluate((p) => window.pdfEditorNative.recentOpen(p).then(() => 'opened', (e) => String(e.message)), N);
    assert.ok(/not in the recent list/.test(r), r);
    const r2 = await page.evaluate((p) => window.pdfEditorNative.readFile(p).then(() => 'read', (e) => String(e.message)), N);
    assert.ok(/not opened from here/.test(r2), r2);
  });
  await test('Clear list empties the list and hides it', async () => {
    await page.click('#recentClear'); await page.waitForSelector('#recent', { state: 'hidden' });
    await page.reload(); await page.waitForTimeout(500);
    assert.ok(!(await page.$eval('#recent', (e) => e.offsetParent !== null)));
  });

  console.log('whole-session checks');
  await test('no request ever left the app except the two Google font files; no script errors', async () => {
    // allowed: the two Google font files (as before), the CDN fallback for the OCR files that are absent in this sandbox (blocked by the CSP
    // anyway), and the pasted figure's own <img> in the comment editor (the downloader fetch itself went through the desktop app)
    const bad = t.outside.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u) && !/cdn\.jsdelivr\.net\/npm\/tesseract\.js/.test(u) && u !== imgUrl);
    assert.deepStrictEqual(bad, []);
    assert.deepStrictEqual(t.pageErrors, []);
  });
  await test('no Content-Security-Policy violations from the app itself (the only ones are the CDN fallback for the absent OCR vendor files in this sandbox)', async () => {
    const csp = t.consoleErrors.filter((m) => /Content Security Policy/.test(m) && !/tesseract\.js@5\.1\.1|cdnjs|fonts\./.test(m) && !m.includes(imgUrl));   // the direct fetch of the pasted figure IS refused by the CSP; the desktop downloader then fetched it
    assert.deepStrictEqual(csp, []);
  });

  await t.close(); img.close();
  const failed = results.filter((r) => !r[1]);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
