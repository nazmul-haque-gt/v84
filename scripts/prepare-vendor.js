'use strict';
/*
 * Copies the offline libraries out of node_modules into app/vendor, using exactly the folder layout
 * final.html expects (the same layout download-vendor-files.ps1 used to create):
 *   vendor/pdfjs/pdf.min.js, pdf.worker.min.js          (pdf.js 3.11.174)
 *   vendor/pdflib/pdf-lib.min.js                         (pdf-lib 1.17.1)
 *   vendor/tesseract/tesseract.min.js, worker.min.js     (tesseract.js 5.1.1)
 *   vendor/tesseract-core/<4 variants .wasm.js + .wasm>  (tesseract.js-core 5.1.1)
 *   vendor/tessdata/eng.traineddata.gz                   (@tesseract.js-data/eng 1.0.0, 4.0.0_best_int)
 * Runs after `npm install` (postinstall). `--check` only verifies and exits non-zero if anything is missing.
 * Another OCR language: npm i -D @tesseract.js-data/ben, add a line to PLAN below, change OCR_LANG in app/final.html.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'app', 'vendor');
const CHECK_ONLY = process.argv.includes('--check');

function findFile(dir, name, prefer) {
  const hits = [];
  (function walk(d, depth) {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f, depth + 1); }
      else if (e.name === name) hits.push(f);
    }
  })(dir, 0);
  if (!hits.length) return null;
  if (prefer) { const p = hits.find((h) => h.includes(prefer)); if (p) return p; }
  return hits[0];
}

const core = ['tesseract-core.wasm.js', 'tesseract-core.wasm', 'tesseract-core-simd.wasm.js', 'tesseract-core-simd.wasm',
  'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm'];

// [package dir, file name, preferred path fragment, destination under app/vendor, required?]
const PLAN = [
  ['pdfjs-dist', 'pdf.min.js', path.join('build', 'pdf.min.js'), 'pdfjs/pdf.min.js', true],
  ['pdfjs-dist', 'pdf.worker.min.js', path.join('build', 'pdf.worker.min.js'), 'pdfjs/pdf.worker.min.js', true],
  ['pdf-lib', 'pdf-lib.min.js', path.join('dist', 'pdf-lib.min.js'), 'pdflib/pdf-lib.min.js', true],
  ['tesseract.js', 'tesseract.min.js', path.join('dist', 'tesseract.min.js'), 'tesseract/tesseract.min.js', true],
  ['tesseract.js', 'worker.min.js', path.join('dist', 'worker.min.js'), 'tesseract/worker.min.js', true],
  ['@tesseract.js-data/eng', 'eng.traineddata.gz', '4.0.0_best_int', 'tessdata/eng.traineddata.gz', true]
].concat(core.map((f) => ['tesseract.js-core', f, null, 'tesseract-core/' + f, true]));

let problems = 0;
for (const [pkg, file, prefer, dest, required] of PLAN) {
  const out = path.join(VENDOR, dest);
  if (CHECK_ONLY) {
    let ok = false; try { ok = fs.statSync(out).size > 1000; } catch (_) { ok = false; }
    if (!ok) { console.error('MISSING or empty: app/vendor/' + dest); problems++; }
    continue;
  }
  const src = findFile(path.join(NM, pkg), file, prefer);
  if (!src) { console.error('NOT FOUND in node_modules/' + pkg + ': ' + file); if (required) problems++; continue; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(src, out);
}

if (!problems) {
  // Sanity: the exact versions the app was written against.
  const chk = (rel, needle) => { try { return fs.readFileSync(path.join(VENDOR, rel), 'utf8').includes(needle); } catch (_) { return false; } };
  if (!chk('pdfjs/pdf.min.js', '3.11.174')) { console.error('app/vendor/pdfjs/pdf.min.js is not pdf.js 3.11.174 - the app needs that exact version (v4+ is not compatible).'); problems++; }
}

if (problems) {
  console.error('\nvendor files are incomplete (' + problems + ' problem' + (problems === 1 ? '' : 's') + '). Run "npm install" with an internet connection, then "npm run vendor".');
  process.exit(1);
}
console.log(CHECK_ONLY ? 'vendor files OK' : 'vendor files copied to app/vendor');
