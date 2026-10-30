'use strict';
// Works out which files a launch (first start, "Open with", or a second launch) is asking for.
const fs = require('fs');
const path = require('path');

// `argv` is process.argv from the (first or second) instance. In a packaged app the files start at index 1;
// when started with `electron .` (development) they start at index 2.
function filesFromArgv(argv, cwd, isDefaultApp) {
  const rest = argv.slice(isDefaultApp ? 2 : 1);
  const pdfs = [];
  let settings = null;
  for (const a of rest) {
    if (!a || a.startsWith('--') || a === '.') continue;
    let full;
    try { full = path.resolve(cwd || process.cwd(), a); } catch (_) { continue; }
    let ok = false;
    try { ok = fs.statSync(full).isFile(); } catch (_) { ok = false; }
    if (!ok) continue;
    if (/\.pdf$/i.test(full)) { if (!pdfs.includes(full)) pdfs.push(full); }
    else if (/^pdfeditor-settings.*\.json$/i.test(path.basename(full))) settings = full;
  }
  return { pdfs, settings };
}

module.exports = { filesFromArgv };
