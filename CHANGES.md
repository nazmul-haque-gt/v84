# v84: Double click moved to AI translate settings, smaller highlight cursor

* The **Double click** option (select / highlight the whole word) is now in **AI translate settings** (gear button). It is no longer in the Highlight options
  or the right-click menu. Same setting (`pdfEditor.dblClickWord`, on by default, kept as saved); it applies immediately when ticked.
* The Highlight tool's I-beam cursor is about 15% smaller (20x28 -> 17x24 px, hotspot moved to the new centre).
* **Page counter:** scrolled to the bottom of a 20-page PDF it showed 19 (the last page can't scroll up to the top of the viewer). At the very bottom it now shows the last page.
* **Links to pictures (comments)** - everything that kept a pasted link a link is fixed:
  * Links **inside a sentence** now get their picture too (on its own line at the end of that paragraph, so the sentence is not split). Bare `https://...`
    text and markdown `[title](url)` are turned into links first, so they are covered as well.
  * **No limit** on the number of links (it was 8 per paste). Downloads run 4 at a time; the same address twice is downloaded once.
  * **New button** in the comment toolbar (next to Insert image): *Links to pictures*. Works on a comment that is already there or saved, and skips links that
    already have a picture, so pressing it twice never doubles them. It says how many pictures it added.
  * **Pages without og:image** now fall back to the page's touch icon, then its first real pictures, then the small site icon.
  * **Sites that block the request** get a second try as a link-preview bot (many sites serve their preview tags to that). An address that turns out to be a
    picture itself (no .png/.jpg ending) is downloaded directly.
  * Still not possible: pages that need a login, and pages with no picture at all (the link just stays a link). Shown in the result message.
  * Tested here: 12 unit tests incl. new bot/fallback/direct-picture cases (34 pass); link logic in headless Chromium with a stubbed downloader
    (in-sentence, loose text, markdown, 12 links, failed link, same link twice, button twice on a saved-style comment). NOT tested with real websites or the built exe.
* Not run here: the browser (e2e) tests - they still find `#hlDblClickChk`, which kept its id. Script syntax checked only.

# v83: drag selects word by word (with the Double click option on)

* With **Double click** on, a normal press-and-drag over text now grows word by word: the first word you press on is selected whole, and the selection
  ends at the end (or start, when dragging backwards) of the word under the pointer. In the Highlight tool the dragged words become the highlight.
  Double-click, hold and drag already did this (v81/v82). With the option **off** a drag is letter-exact again (browser behaviour).
* Tested here (headless Chromium): plain drag from the middle of one word to the middle of the third selects the three whole words and highlights them;
  option off selects exact letters; double-click-hold-drag selects word by word. NOT tested with the real pdf.js 3.11 / your PDFs.

# v82: Double click fix (it started a brush stroke instead of taking the word)

* The Highlight tool starts its own freehand brush the moment the mouse goes down, unless the pointer is exactly on a text box; v81 only reacted
  to mouse events on an exact hit, so a double-click a little off the letters (or on scanned/OCR text with *Free-draw on OCR text* on) drew a stroke from the cursor.
* Now the double-click is recognised on pointer-down (two presses within 0.5 s and 8 px), before the brush and before the browser's own selection:
  the whole word is selected (and highlighted with the Highlight tool) when the click is on the text **or within about 3/4 of a line height of it**.
  With *Free-draw on OCR text* on, a double-click now takes the word; dragging still draws freehand.
* Not handled (left as before): rotated pages, clicks on pins / buttons / text boxes, touch.
* Tested here (headless Chromium): select tool, Highlight tool, click just off the letters, scanned-text + free-draw on, option off/on remembered.
  NOT tested with the real pdf.js 3.11 / your PDFs.

# v81: "Swap double / triple click" removed, new "Double click" option

* **Removed:** the *Swap double / triple click* checkbox (Highlight options), its right-click menu item and all its code (`swapSel`, `clickUnit`, `swapSelApply`).
  The old saved setting (`pdfEditor.swapDblTripleClick`) is simply ignored.
* **New: Double click** (checkbox in the Highlight options and the same item in the right-click menu on an empty spot of the page; remembered in
  `pdfEditor.dblClickWord`; **on by default**).
  On: double-click on text selects the **whole word** under the pointer, also when the PDF stores that word in several text pieces; with the Highlight tool
  the word is highlighted when you release the click; with no tool the word stays selected (to copy). Holding the second click and dragging extends by whole words.
  Clicking white space, a double-click while holding Shift/Ctrl/Alt, and triple-click keep the browser's normal behaviour. Off = browser behaviour for everything.
* Tested here (headless Chromium): word selected with the select tool, word highlighted with the Highlight tool (highlight width matches the word), option off/on remembered.
  NOT tested: dragging after the double-click, words split over several text pieces, scanned (OCR) pages.

# v80: pasted ChatGPT sources show their picture, not just a link

Pasting text from ChatGPT into a comment brought the picture block along only as links (the source's title, e.g. "Embryonic Stem Cell - About Stem Cells").
Those are links to web *pages*, not picture files, so the old "link -> picture" step (which needs an address ending in .png/.jpg or an OpenAI file address) skipped them.

- New: right after a paste, a page link that sits alone on its line (nothing else but a number) is opened by the desktop app, its preview picture
  (og:image / twitter:image / image_src) is downloaded and embedded above the link. The link stays below the picture as the source.
- If the page has no picture or cannot be reached, nothing changes (the link stays a link, no empty box).
- Links inside a sentence ("see <link> for more") are never touched; at most 8 per paste; only on paste, never at Save.
- Same safety rules as the existing downloader (http/https, public addresses only, checked on every redirect and at connect time, 6 redirects, 15 s;
  the page is read up to 1.5 MB, the picture up to 15 MB). New IPC `fetch-page-image` (main.js, preload.js, lib/imageProxy.js `fetchPageImage`).
- Tests: 34 unit (new: page -> og:image, redirects, refusals), 26 browser flows (new: pasted source links). NOT tested against a real ChatGPT clipboard
  (no internet here); if a paste still shows only links, F12 -> Console: `navigator.clipboard.read()` output of the text/html part would show what ChatGPT copied.

## Recent PDFs on the home screen
- When no PDF is open, the start screen now lists the PDFs you opened before (newest first, with folder and time). Click one to open it; Ctrl+S saves back into that same file.
- The list is stored in `recent-files.json` in the app's data folder (survives restarts), keeps 12 entries, and is filled by Open, Open with / double-click, drag and drop, second launches and Save As.
- Files that moved or were deleted show as "Not found"; each row has a remove button and there is "Clear list".
- Safety: the page can only open paths that are in this list (`recent-open`); other files still need the Open dialog, drop or Open with.
- New: `lib/recent.js`; IPC `recent-list/-open/-remove/-clear`; tests in `test/unit.test.js` and `test/e2e/e2e.test.js`.

# Update 1.5.0

* **New comment: cursor is in the text box at once.** After pinning a new comment the text cursor is placed inside the comment box (and kept there while the panel settles),
  so Ctrl+V / typing works immediately. Opening an already-saved comment no longer moves the cursor into the box.
* **Slightly slower page scrolling.** Mouse wheel / touchpad scrolling of the pages is about 30% slower, with a short glide for wheel notches. Change `WHEEL_SCROLL_FACTOR` (1 = normal) in `app/final.html`.

# Update 1.4.1

* **Highlight cursor.** The round colour circle that followed the pointer is gone. The cursor itself (a text I-beam) is now drawn in the selected highlight colour,
  with a dark outline and a white halo so it shows on light and dark pages. It changes as soon as another colour is picked (toolbar swatches or right-click menu).

# Update 1.4.0

* **Double-click and triple-click swapped in the Highlight tool.** Double-click now highlights the whole piece of text under the pointer (what triple-click used to do),
  triple-click highlights just the word (what double-click used to do); holding the last click and dragging keeps extending by that same unit.
  Switch: the **Swap double / triple click** checkbox in the Highlight options, or the same item in the right-click menu. Remembered; on by default, untick for the old behaviour.
  (`app/final.html`: `swapSel`, `clickUnit`, `swapSelApply`.) Checked with real pdf.js 3.11.174 in headless Chromium.

# Update 1.3.0

* **Rotate page button** (toolbar, next to the zoom buttons; shortcut **R**). Click = turn the current page 90\u00b0 clockwise; Shift+click (or Shift+R) = counter-clockwise;
  Alt+click = turn all pages. The whole page, with its notes, turns on screen, and on **Save** the turn is added to the page's own rotation, so every PDF viewer shows it.
  It is part of undo/redo and of the unsaved-changes state. A rotated page is view-only for adding/editing notes (rotate it back to 0\u00b0 first); existing notes still open.
  (`app/final.html`: `applyPageRotation`, `rotatePages`, export step in `buildExportedPdf`.)

# Update 1.2.2

* **Pasted image links become real pictures.** When a chat's copy button gives only the picture's *link* (an `<a>` link, a bare URL, or markdown `![alt](url)`),
  the comment box now turns it back into an image in the same spot in the text, downloads it through the desktop downloader and embeds it in the comment.
  If a link turns out not to be a picture, it is put back as a normal link. (`app/final.html`, `cmtLinksToImages` / `cmtRestoreFailedLinks`.)

# Update 1.2.1

* **Translate popup: hide arrow.** A new arrow (^) at the left of the popup's buttons hides all the options (Model row and the font / size / background row, plus the Aa button),
  leaving just the translated text and the chat box. Click it again (it points down while hidden) to bring them back. The choice is remembered.

# Update 1.2.0

* **Tabs in the title bar (like a browser).** The separate "PDF Editor" title strip is gone: the tab strip now sits in that space, and the Windows
  minimise / maximise / close buttons float at the right end, coloured to match the tab strip (they follow the light/dark theme). Empty space in the
  tab strip drags the window; double-click it to maximise / restore. Saves one row of screen height.
  (`main.js` titleBarStyle + titleBarOverlay, `set-titlebar-colors` IPC, `html.desktop-titlebar` CSS.)
  Checked with the real Electron 33 on a virtual screen: unit tests 32/32, tab strip and window buttons render in the title bar.

# Update 1.1.0

* `app/final.html` is now the v71 editor (v70 plus **comment names**: a Name box inside the comment toolbar, hidden by the toolbar arrow;
  hovering a pin shows its name above it; names are also stored inside the saved PDF). The desktop-app changes below were re-applied on top of it.
* **Fixed Scan text (OCR) in the desktop app:** the OCR worker was given relative file paths, which are invalid inside a worker started from a blob URL
  ("importScripts ... is invalid"). They are now absolute `app://` URLs (also in `scripts/selftest-page.js`). Found by running the real Electron `--selftest`.
* Added `package-lock.json` (real, resolved versions: electron 33.4.11, electron-builder 25.1.8) so GitHub builds are repeatable (`npm ci`).
* GitHub workflow: caches npm, runs the unit tests, builds installer + portable exe, installs the installer on the runner and checks the "Open with" registry entries,
  and on a `v*` tag publishes a GitHub Release.
* Verified here with the real Electron 33 under a virtual display: `npm test` (32 passed) and `npm run selftest` (9 of 9 checks, including offline OCR).
  The final Windows installer step (NSIS, needs Windows or Wine) could not run here; the workflow's Windows runner does it.

# What changed, and what is untested

## Replaced
| Old | New |
|---|---|
| serve.ps1 (local HTTP server, port 8743) | `main.js`: files served over the private `app://pdfeditor/` scheme (constant origin, so localStorage, fetch, workers and WebAssembly OCR work) |
| launch.vbs + PDFEditor.exe launcher + wscript | one Electron exe; single-instance lock; second launch -> new tab in the running window, window restored if minimized and raised |
| `/__openfile` + `/__savefile` + one-time keys | real file paths: native Open / Save As dialogs, Ctrl+S writes via temp file + rename into the original; only PDFs the user chose can be read/written |
| `/__poll`, `/__handoff`, `/__front` | Electron `second-instance` + IPC |
| `/__img` image proxy | `lib/imageProxy.js`: same rules (http/https, public addresses only, checked on every redirect and at connect time, 6 redirects, 15 s, image/* only, 15 MB) |
| `/__open` (open attachment) | IPC -> temp file -> `shell.openPath` |
| download-vendor-files.ps1 (CDN download at install) | npm packages copied into `app/vendor/` at build time; the installer contains everything |
| install.bat/ps1, uninstall.*, IExpress | electron-builder NSIS installer + portable exe; `build/installer.nsh` registers Open with / Default-apps capability exactly as install.ps1 did |
| Edge `--app` flags | window opens maximized; background throttling / occlusion switches kept so Scan text keeps running behind other windows |

## Changes inside final.html (only these, 5 places)
1. `<script src="electron-bridge.js">` added (gives the app the same `showOpenFilePicker` / `showSaveFilePicker` / drop-handle API it used in Edge, backed by native dialogs and real paths).
2. `isLocalServer()` now means "running in the desktop app" (shows Open instead of Download for attachments).
3. `openLocally()` (attachments) calls the desktop app instead of `/__open`.
4. Pasted-figure downloader calls the desktop app instead of `/__img`.
5. The "Open with" token/polling block is replaced by "desktop app hands over a file path".
Everything else is byte-for-byte unchanged. localStorage keys, the `name|size` tab key, and the PDF save format are untouched.

## Behaviour differences you may notice
* **Settings do not carry over automatically** (different browser profile). See the migration steps in README.
* Closing the window with unsaved changes shows a native "You have unsaved changes - Leave / Stay" box (Edge showed its own generic prompt).
* Attachments of program types (.exe .bat .cmd .ps1 .vbs .js .msi .scr .lnk .jar etc.) are no longer launched from "Open" (the old server would launch anything). Change `BLOCKED_EXT` in `lib/fileio.js` if you disagree.
* Direct fetches from the page are limited by a Content-Security-Policy to the app itself, Google's Gemini API and Google Fonts; remote pictures pasted into comments therefore always go through the desktop downloader.
* Right-click in text boxes shows an Edit menu with spelling suggestions (Electron has no default one). Ctrl+/- / Ctrl+0 browser zoom, F5/Ctrl+R reload and F12 dev tools are re-added.
* The UI fonts (Instrument Sans, Newsreader) are still requested from Google Fonts as before, with system-font fallback offline. Not a function dependency; to make it 100% offline, bundle those two fonts and edit the `<link>` on line 14 of `final.html`.

## Tested (here, Linux, headless Chromium + Node 22; `npm test`, `npm run test:e2e`)
* 32 unit tests: atomic write, refusal of non-PDF data, locked/failed write cleanup, argv parsing, path-traversal guard, MIME (wasm), image downloader (redirects, loops, size, non-image, private/loopback/link-local refusal), and the real `main.js` on a mocked Electron: single-instance lock, queueing until the page is ready, second launch -> new tab / same tab / restore+raise, IPC permission gating (other senders, un-chosen paths), Save As path, drop grant, attachment rules, unsaved-close dialog, permission handler, app:// responses + CSP, settings import.
* 19 browser flows with the shipped `final.html`, `electron-bridge.js`, CSP and `main.js`: open from command line, second launch (new tab, already-open tab), Open button, comment add -> dirty state -> Ctrl+S in place -> file re-checked with pikepdf and pypdf (valid, comment present) -> reopen shows the pin, unsaved-comment blocking (tab switch, tab close, Esc, window close), Ctrl+Shift+S then Ctrl+S goes to the new file and not the original, cancelled dialogs, tab drag reorder, drag-and-drop with in-place save, non-PDF drop, attachment open, pasted web figure embedded through the downloader, closing all tabs, no requests leaving the app, no CSP violations.

## NOT tested (could not be, in this sandbox: no Windows, no Electron binary, no internet)
* **Electron itself and electron-builder / NSIS**: nothing was built or launched. `package.json` build config, `build/installer.nsh`, the app:// scheme registration, preload/contextBridge (incl. `webUtils.getPathForFile` for drops and Uint8Array over IPC), `will-prevent-unload`, window maximize/raise (`setAlwaysOnTop` trick), taskbar identity/pinning, "Open with" registration, installer/uninstaller, portable exe. Package versions (`electron ^33.2.1`, `electron-builder ^25.1.8`, pinned libs) are from memory; no lock file was generated.
* **The shipped pdf.js 3.11.174, tesseract.js, OCR/Scan text, pdf rendering fidelity**: not available offline here. Browser tests used pdfjs-dist 5.x wrapped as a v3 stand-in. `npm run selftest` on your PC checks real pdf.js, pdf-lib and offline OCR in 10 s. Run it first.
* Real Windows file locking (Acrobat holding a file) - simulated only as a failed write; Windows rename-over-open-file semantics are untested.
* Translate/AI (needs your key + internet), highlight/draw/text-tool visuals, Lock - their code is unchanged and not re-verified.
* Drag/drop of an actual Explorer file (synthetic drop used), clipboard permissions in Electron, spell-check menu.

## Fix: drag area + real installer
- **No PDF open = no way to move the window.** The global `[hidden]{display:none!important}` hid the tab strip (which is the title bar)
  when no tabs were open. In the desktop app the strip is now always shown, so the empty area is a drag handle.
- **Installer only "opened the editor".** The NSIS installer was `oneClick` (silent, no wizard, launches the app when done), and the
  GitHub artifact also contained the Portable exe, which never installs. Now `oneClick: false` (setup wizard with install folder,
  shortcuts, "Run PDF Editor" checkbox), and the workflow publishes `PDFEditor-INSTALLER` and `PDFEditor-Portable-no-install` separately.

## Perf: zoom and page loading
- Zoom no longer re-lays-out every page with a forced reflow per page; the width is computed once and pen strokes / free highlights /
  text boxes are rebuilt only for pages near the screen (others on demand).
- Ctrl+wheel / pinch zoom is applied once per frame instead of once per wheel event (and small pinch steps no longer round to nothing).
- Pages that scroll far away cancel their pending render (so the page you stopped on is painted first) and, in PDFs of 9+ pages,
  free their bitmap to save memory.
