'use strict';
// Replacement for serve.ps1's image proxy route: downloads a picture that lives on another website
// (a browser page may not read it because of CORS; this process can, like Word does when you paste
// web content). Same rules as before: http(s) only, public addresses only (checked on every redirect
// hop AND at connect time), max 6 redirects, 15 s timeouts, must be image/*, max 15 MB.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_HOPS = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Many sites refuse a browser-like request but serve the link-preview tags to a preview bot: used as a second try.
const BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function isPrivateAddress(addr) {
  if (!addr) return true;
  let a = addr;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);        // IPv4-mapped IPv6
  if (m) a = m[1];
  if (net.isIPv4(a)) {
    const p = a.split('.').map(Number);
    if (p[0] === 10 || p[0] === 0 || p[0] === 127) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;                             // multicast / reserved
    return false;
  }
  if (net.isIPv6(a)) {
    const l = a.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (/^fe[89ab]/.test(l)) return true;                     // link-local
    if (/^fe[c-f]/.test(l)) return true;                      // site-local
    if (/^f[cd]/.test(l)) return true;                        // unique local
    return false;
  }
  return true;
}

// Used as the `lookup` option, so the address that is actually connected to is the one that was checked.
function makeLookup(allowPrivate) {
  return function (hostname, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, Object.assign({}, options, { all: true }), function (err, addrs) {
      if (err) return cb(err);
      if (!addrs || !addrs.length) return cb(new Error('no address'));
      if (!allowPrivate) {
        for (const a of addrs) { if (isPrivateAddress(a.address)) return cb(new Error('address not allowed')); }
      }
      if (options && options.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

function getOnce(url, allowPrivate, accept, ua) {
  return new Promise(function (resolve, reject) {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      lookup: makeLookup(allowPrivate),
      timeout: 15000,
      headers: {
        'User-Agent': ua || UA,
        'Accept': accept || 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': url.protocol + '//' + url.host + '/'
      }
    }, resolve);
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// Shared downloader. opts: allowPrivate (tests only), accept (Accept header), ua (User-Agent), isOk(contentType) -> bool,
// notOkMessage, maxBytes, truncate (true: stop reading at maxBytes and keep what came, instead of failing).
// Returns { type, bytes, finalUrl }. Throws Error(reason) on any failure.
async function fetchRemote(target, opts) {
  opts = opts || {};
  const allowPrivate = !!opts.allowPrivate;   // only the tests turn this on
  const maxBytes = opts.maxBytes || MAX_BYTES;
  if (typeof target !== 'string' || !target || target.length > 4000) throw new Error('no url');
  let url;
  try { url = new URL(target); } catch (_) { throw new Error('bad url'); }
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('address not allowed');
    const bare = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(bare) && isPrivateAddress(bare)) throw new Error('address not allowed');
    const res = await getOnce(url, allowPrivate, opts.accept, opts.ua);
    const code = res.statusCode;
    if (code >= 300 && code < 400) {
      res.resume();
      const loc = res.headers.location;
      if (!loc) throw new Error('redirect without location');
      try { url = new URL(loc, url); } catch (_) { throw new Error('bad redirect'); }
      continue;
    }
    if (code !== 200) { res.resume(); throw new Error('remote status ' + code); }
    const ctype = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (opts.isOk && !opts.isOk(ctype)) { res.resume(); throw new Error(opts.notOkMessage || 'unexpected content type'); }
    const len = parseInt(res.headers['content-length'] || '0', 10);
    if (len > maxBytes && !opts.truncate) { res.resume(); throw new Error('image too large'); }
    const chunks = []; let total = 0; let tooBig = false;
    await new Promise(function (resolve, reject) {
      res.setTimeout(15000, function () { res.destroy(new Error('timeout')); });
      res.on('data', function (c) {
        total += c.length;
        if (total > maxBytes) {
          if (opts.truncate) { chunks.push(c); resolve(); res.destroy(); return; }
          tooBig = true; reject(new Error('image too large')); res.destroy(); return;
        }
        chunks.push(c);
      });
      res.on('end', resolve);
      res.on('error', function (e) { if (opts.truncate && total > 0) return resolve(); reject(tooBig ? new Error('image too large') : e); });
      res.on('aborted', function () { if (opts.truncate && total > 0) return resolve(); reject(tooBig ? new Error('image too large') : new Error('aborted')); });
    });
    return { type: ctype, bytes: Buffer.concat(chunks), finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

// Returns { type, bytes }. Throws Error(reason) on any failure.
async function fetchImage(target, opts) {
  const r = await fetchRemote(target, Object.assign({}, opts, {
    isOk: function (t) { return t.startsWith('image/'); }, notOkMessage: 'not an image'
  }));
  return { type: r.type, bytes: r.bytes };
}

// ---- picture of a web PAGE -------------------------------------------------------------------
// AI chats put the *page address* of a picture's source on the clipboard (the picture itself is not
// copied). Like a link preview, we open that page and use its preview picture (og:image / twitter:image).
function decodeEntities(v) {
  return String(v).replace(/&(amp|quot|#39|#x27|lt|gt);/gi, function (m, k) {
    return ({ amp: '&', quot: '"', '#39': "'", '#x27': "'", lt: '<', gt: '>' })[k.toLowerCase()];
  });
}
function attrsOf(tag) {
  const out = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g; let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]));
  return out;
}
// Returns the list of candidate picture addresses found in the HTML, best first: the page's own preview picture
// (og:image / twitter:image), then its touch icon, then ordinary pictures in the page, then the small site icon.
function findPreviewImages(html, baseUrl) {
  const best = { 'og:image:secure_url': 1, 'og:image': 2, 'og:image:url': 3, 'twitter:image': 4, 'twitter:image:src': 5 };
  const found = [];
  const add = function (rank, val) {
    if (!val) return;
    let u; try { u = new URL(String(val).trim(), baseUrl); } catch (_) { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    found.push({ rank, href: u.href });
  };
  const tags = String(html).match(/<(meta|link)\b[^>]*>/gi) || [];
  for (const t of tags) {
    const a = attrsOf(t);
    if (/^<meta/i.test(t)) {
      const key = String(a.property || a.name || '').toLowerCase();
      if (best[key]) add(best[key], a.content);
    } else {
      const rel = String(a.rel || '').toLowerCase();
      if (/(^|\s)image_src(\s|$)/.test(rel)) add(6, a.href);
      else if (/apple-touch-icon/.test(rel)) add(7, a.href);
      else if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) add(9, a.href);
    }
  }
  // ordinary pictures in the page (first few, skipping tracking pixels, sprites, SVG and inline data)
  const imgs = String(html).match(/<img\b[^>]*>/gi) || [];
  let taken = 0;
  for (const t of imgs) {
    if (taken >= 4) break;
    const a = attrsOf(t);
    const src = a.src || a['data-src'] || '';
    if (!src || /^data:/i.test(src) || /\.svg(\?|#|$)/i.test(src) || /pixel|spacer|1x1|blank|sprite|tracking|beacon|avatar/i.test(src)) continue;
    if ((+a.width > 0 && +a.width < 80) || (+a.height > 0 && +a.height < 80)) continue;
    add(8, src); taken++;
  }
  found.sort(function (x, y) { return x.rank - y.rank; });
  const seen = new Set();
  return found.map(function (f) { return f.href; }).filter(function (h) { return seen.has(h) ? false : (seen.add(h), true); });
}
async function fetchPageImageOnce(target, opts, ua) {
  const page = await fetchRemote(target, Object.assign({}, opts, {
    ua,
    accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5',
    isOk: function (t) { return t === 'text/html' || t === 'application/xhtml+xml' || t.startsWith('image/'); },
    notOkMessage: 'not a web page',
    maxBytes: 1500000, truncate: true
  }));
  // the address was a picture after all (no .png/.jpg ending): download it whole
  if (page.type.startsWith('image/')) return fetchImage(page.finalUrl, Object.assign({}, opts, { ua }));
  const cands = findPreviewImages(page.bytes.toString('utf8'), page.finalUrl).slice(0, 8);
  if (!cands.length) throw new Error('page has no picture');
  let lastErr = null;
  for (const c of cands) {
    try { return await fetchImage(c, Object.assign({}, opts, { ua })); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('page has no picture');
}
// Returns { type, bytes }. Throws Error(reason) when the page has no usable picture.
// A site that refuses the first try (blocked, error status, no tags for a browser) gets a second try as a link-preview bot.
async function fetchPageImage(target, opts) {
  let firstErr;
  try { return await fetchPageImageOnce(target, opts, UA); } catch (e) { firstErr = e; }
  if (/not allowed|bad url|no url|timeout|too many redirects/.test(String(firstErr && firstErr.message))) throw firstErr;
  try { return await fetchPageImageOnce(target, opts, BOT_UA); } catch (_) { throw firstErr; }
}

module.exports = { fetchImage, fetchPageImage, findPreviewImages, isPrivateAddress };
