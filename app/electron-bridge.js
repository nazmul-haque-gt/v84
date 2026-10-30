/* PDF Editor desktop bridge (runs in the page, before the app).
 * Gives the app the same File System Access API it used in Edge - showOpenFilePicker, showSaveFilePicker and
 * dropped-file handles - but backed by the desktop app's native dialogs and by real file paths, so
 * Ctrl+S writes straight back into the file that was opened (double-click, Open with, Open, drop).
 * Does nothing when the page is opened outside the desktop app. */
(function () {
  'use strict';
  var N = window.pdfEditorNative;
  if (!N) return;

  function abortError() {
    try { return new DOMException('The user aborted a request.', 'AbortError'); }
    catch (e) { var er = new Error('The user aborted a request.'); er.name = 'AbortError'; return er; }
  }

  function makeHandle(p, name) {
    return {
      kind: 'file',
      name: name,
      __path: p,
      getFile: function () {
        return N.readFile(p).then(function (r) {
          return new File([r.bytes], r.name, { type: 'application/pdf', lastModified: r.lastModified });
        });
      },
      createWritable: function () {
        var parts = [];
        return Promise.resolve({
          write: function (d) {
            if (d && typeof d === 'object' && d.type === 'write' && 'data' in d) d = d.data;
            parts.push(d);
            return Promise.resolve();
          },
          close: function () {
            return new Blob(parts).arrayBuffer().then(function (ab) { return N.writeFile(p, new Uint8Array(ab)); }).then(function () { return undefined; });
          },
          abort: function () { parts = []; return Promise.resolve(); }
        });
      },
      queryPermission: function () { return Promise.resolve('granted'); },
      requestPermission: function () { return Promise.resolve('granted'); },
      isSameEntry: function (other) { return Promise.resolve(!!other && other.__path === p); }
    };
  }
  window.__pdfEditorMakeHandle = makeHandle;

  // Tabs live in the window's title bar (like a browser). The CSS for this is under html.desktop-titlebar.
  if (N.setTitleBarColors) {
    document.documentElement.classList.add('desktop-titlebar');
    var tbTimer = null;
    var syncTitleBar = function () {
      var tb = document.getElementById('tabbar');
      if (!tb || !document.body) return;
      try { N.setTitleBarColors(getComputedStyle(tb).backgroundColor, getComputedStyle(document.body).color).catch(function () {}); } catch (e) { /* ignore */ }
    };
    var queueSync = function () { clearTimeout(tbTimer); tbTimer = setTimeout(syncTitleBar, 60); };
    document.addEventListener('DOMContentLoaded', queueSync);
    window.addEventListener('load', queueSync);
    try { new MutationObserver(queueSync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] }); } catch (e) { /* ignore */ }
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queueSync); } catch (e) { /* ignore */ }
  }

  window.showOpenFilePicker = function () {
    return N.pickOpen().then(function (r) {
      if (!r) throw abortError();
      return [makeHandle(r.path, r.name)];
    });
  };

  window.showSaveFilePicker = function (opts) {
    return N.pickSave(opts && opts.suggestedName).then(function (r) {
      if (!r) throw abortError();
      return makeHandle(r.path, r.name);
    });
  };

  // A PDF dropped onto the window gets a handle for the real file, so it can be saved in place.
  try {
    DataTransferItem.prototype.getAsFileSystemHandle = function () {
      var f = this.getAsFile();            // must be read now, while the drop event is still being handled
      var p = f ? N.pathForFile(f) : '';
      if (!p || !/\.pdf$/i.test(p)) return Promise.resolve(null);
      return N.grantDrop(p).then(function (ok) { return ok ? makeHandle(p, f.name) : null; });
    };
  } catch (e) { /* the app then falls back to a handle-less File, as before */ }
})();
