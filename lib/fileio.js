'use strict';
// File access used by the main process. Kept free of any Electron import so it
// can be tested with plain Node.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAX_PDF_BYTES = 600 * 1024 * 1024;     // same ceiling serve.ps1 used for uploads

function isPdfPath(p) {
  return typeof p === 'string' && /\.pdf$/i.test(p) && path.isAbsolute(p);
}

function looksLikePdf(buf) {
  return !!buf && buf.length >= 8 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d; // "%PDF-"
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new Error('bad data');
}

function codeErr(code, msg) { const e = new Error(msg); e.code = code; return e; }

// Reads a PDF without locking it (Node opens files with full sharing on Windows, so a
// PDF that Acrobat has open can still be read - same as serve.ps1's FileShare.ReadWrite).
async function readPdf(p) {
  if (!isPdfPath(p)) throw codeErr('EBADPATH', 'not a PDF path');
  const st = await fsp.stat(p);
  if (!st.isFile()) throw codeErr('EBADPATH', 'not a file');
  if (st.size > MAX_PDF_BYTES) throw codeErr('ETOOBIG', 'file too large');
  const buf = await fsp.readFile(p);
  return { bytes: buf, name: path.basename(p), lastModified: Math.floor(st.mtimeMs) };
}

// Writes bytes over `target` through a temp file in the same folder, then swaps it in,
// so a failure never leaves a half-written PDF behind (same approach as serve.ps1's File.Replace).
async function writePdfAtomic(target, bytes) {
  if (!isPdfPath(target)) throw codeErr('EBADPATH', 'not a PDF path');
  const buf = toBuffer(bytes);
  if (!looksLikePdf(buf)) throw codeErr('ENOTPDF', 'Not a PDF');
  if (buf.length > MAX_PDF_BYTES) throw codeErr('ETOOBIG', 'file too large');
  const dir = path.dirname(target);
  const tmp = path.join(dir, '.' + path.basename(target) + '.' + crypto.randomBytes(4).toString('hex') + '.tmp');
  let fh = null;
  try {
    fh = await fsp.open(tmp, 'wx');
    await fh.writeFile(buf);
    await fh.sync();
    await fh.close(); fh = null;
    await fsp.rename(tmp, target);        // replaces an existing file; fails (EPERM/EBUSY) if another program holds it
  } catch (e) {
    if (fh) { try { await fh.close(); } catch (_) { /* ignore */ } }
    try { await fsp.unlink(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

// Attachments are written to a fresh temp folder and then opened with whatever program Windows
// associates with the type (what /__open did). Types that run code when opened are refused
// (a hardening over serve.ps1, which would have launched anything).
const BLOCKED_EXT = /\.(exe|com|scr|pif|bat|cmd|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|appx|msix|gadget|inf|url|application)$/i;

function safeAttachmentName(name) {
  let n = path.basename(String(name || 'attachment').replace(/\\/g, '/'));
  n = n.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return n || 'attachment';
}

async function writeAttachmentToTemp(tmpRoot, name, bytes) {
  const n = safeAttachmentName(name);
  if (BLOCKED_EXT.test(n)) throw codeErr('EBLOCKED', 'files of this type are not opened from here (' + path.extname(n) + ')');
  const buf = toBuffer(bytes);
  if (buf.length === 0) throw new Error('empty file');
  if (buf.length > 64 * 1024 * 1024) throw new Error('file too large');
  const dir = path.join(tmpRoot, 'PDFEditorOpen', crypto.randomBytes(16).toString('hex'));
  await fsp.mkdir(dir, { recursive: true });
  const full = path.join(dir, n);
  await fsp.writeFile(full, buf);
  return full;
}

module.exports = { isPdfPath, looksLikePdf, readPdf, writePdfAtomic, writeAttachmentToTemp, safeAttachmentName, BLOCKED_EXT, MAX_PDF_BYTES };
