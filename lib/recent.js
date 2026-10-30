'use strict';
// "Recently opened PDFs": a small list of real file paths kept in a JSON file in the app's data folder.
// No Electron import, so it can be tested with plain Node.
const fs = require('fs');
const path = require('path');

const MAX_RECENT = 12;
const sameKey = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));

function createRecent(file, max) {
  const limit = max || MAX_RECENT;
  let items = null;     // [{ path, openedAt }], newest first

  function load() {
    if (items) return items;
    items = [];
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const seen = new Set();
      for (const it of (data && Array.isArray(data.items) ? data.items : [])) {
        if (!it || typeof it.path !== 'string' || !path.isAbsolute(it.path) || !/\.pdf$/i.test(it.path)) continue;
        const k = sameKey(it.path); if (seen.has(k)) continue; seen.add(k);
        items.push({ path: it.path, openedAt: Number(it.openedAt) || 0 });
      }
      items = items.slice(0, limit);
    } catch (_) { /* no file yet, or unreadable: start empty */ }
    return items;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (_) { /* a list that cannot be saved must never break opening a PDF */ }
  }

  return {
    list() { return load().slice(); },
    has(p) { const k = sameKey(p); return load().some((i) => sameKey(i.path) === k); },
    add(p, now) {
      if (typeof p !== 'string' || !path.isAbsolute(p) || !/\.pdf$/i.test(p)) return false;
      const k = sameKey(p);
      items = [{ path: p, openedAt: now || Date.now() }].concat(load().filter((i) => sameKey(i.path) !== k)).slice(0, limit);
      save(); return true;
    },
    remove(p) { const k = sameKey(p); const n = load().length; items = load().filter((i) => sameKey(i.path) !== k); if (items.length !== n) save(); return items.length !== n; },
    clear() { items = []; save(); }
  };
}

module.exports = { createRecent, MAX_RECENT };
