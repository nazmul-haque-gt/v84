/* Run inside the app window by `npm run selftest` (PDF Editor.exe --selftest). Checks that the bundled libraries,
 * the app:// origin and offline OCR really work on this PC. Returns { ok, checks:[{name,pass,detail}] }. */
(async function () {
  var res = { ok: true, checks: [] };
  function add(name, pass, detail) { res.checks.push({ name: name, pass: !!pass, detail: detail || '' }); if (!pass) res.ok = false; }
  var N = window.pdfEditorNative;
  add('desktop bridge present', !!N && typeof window.showOpenFilePicker === 'function');
  add('page origin is app://pdfeditor', location.origin === 'app://pdfeditor', location.origin);
  await window.__waitFor(function () { return window.pdfjsLib && window.PDFLib && window.Tesseract; }, 8000);
  add('pdf.js loaded from the app (not a CDN)', !!window.pdfjsLib && window.__pdfWorkerLocal === true, window.pdfjsLib ? 'version ' + window.pdfjsLib.version : 'missing');
  add('pdf-lib loaded', !!window.PDFLib);
  add('tesseract.js loaded', !!window.Tesseract);
  try {
    localStorage.setItem('__selftest', '1');
    add('localStorage works', localStorage.getItem('__selftest') === '1');
    localStorage.removeItem('__selftest');
  } catch (e) { add('localStorage works', false, String(e)); }

  try {
    var doc = await window.PDFLib.PDFDocument.create();
    var pg0 = doc.addPage([300, 200]);
    pg0.drawText('Hello', { x: 20, y: 100, size: 48 });
    var bytes = await doc.save();
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    var pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    var pg = await pdf.getPage(1);
    var vp = pg.getViewport({ scale: 1 });
    var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    var d = ctx.getImageData(0, 0, cv.width, cv.height).data, dark = 0;
    for (var i = 0; i < d.length; i += 4) { if (d[i] < 128) dark++; }
    add('a PDF can be made (pdf-lib) and drawn (pdf.js)', dark > 200, 'dark pixels: ' + dark);
  } catch (e) { add('a PDF can be made (pdf-lib) and drawn (pdf.js)', false, String((e && e.message) || e)); }

  try {
    var oc = document.createElement('canvas'); oc.width = 900; oc.height = 220;
    var octx = oc.getContext('2d'); octx.fillStyle = '#fff'; octx.fillRect(0, 0, 900, 220);
    octx.fillStyle = '#000'; octx.font = 'bold 96px Arial, Helvetica, sans-serif'; octx.fillText('Hello OCR 2026', 30, 150);
    var w = await window.Tesseract.createWorker('eng', 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', location.href).href, corePath: new URL('vendor/tesseract-core/', location.href).href, langPath: new URL('vendor/tessdata/', location.href).href, gzip: true
    });
    var r = await w.recognize(oc);
    await w.terminate();
    var t = String((r && r.data && r.data.text) || '').trim();
    add('OCR (Scan text) works offline', /hello/i.test(t) && /ocr/i.test(t), JSON.stringify(t));
  } catch (e) { add('OCR (Scan text) works offline', false, String((e && e.message) || e)); }

  try {
    await N.fetchImage('http://127.0.0.1:1/x.png');
    add('image downloader refuses local addresses', false, 'it did not refuse');
  } catch (e) { add('image downloader refuses local addresses', /not allowed/i.test(String(e && e.message)), String(e && e.message)); }

  return res;
})()
