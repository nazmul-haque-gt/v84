'use strict';
// What the app:// protocol serves, and the security headers it adds. No Electron import (testable in Node).
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip',
  '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.traineddata': 'application/octet-stream'
};

// Everything the page needs is bundled, so scripts/fonts/workers load only from the app itself.
// Network access is limited to Google's Gemini API (Translate/AI), pictures in pasted comments, and the two
// Google web fonts final.html has always asked for (cosmetic; the app falls back to system fonts offline).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob: https://generativelanguage.googleapis.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
].join('; ');

// Resolves a request path inside rootDir; returns null if it would escape it.
function resolveInside(rootDir, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch (_) { return null; }
  if (p === '/' || p === '') p = '/final.html';
  if (p.indexOf('\0') >= 0) return null;
  const root = path.normalize(rootDir);
  const full = path.normalize(path.join(root, p.replace(/^[\\/]+/, '')));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

module.exports = { MIME, CSP, resolveInside, mimeFor };
