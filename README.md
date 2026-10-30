# PDF Editor (Electron edition)

The same `final.html` editor, now an independent desktop app with its **own bundled Chromium**. It does not use or
depend on Microsoft Edge, WebView2 or any local PowerShell server. Edge updates, or Edge being removed, cannot affect it.
(Feature history of the editor itself: `FEATURES-HISTORY.md`.)

## Build it on GitHub (no Node.js needed on your PC)

1. Create a new repository on github.com and upload / push everything in this folder (keep the hidden `.github` folder and `package-lock.json`). The workflow finds `package.json` by itself, so it also works if the files end up inside a sub-folder.
2. Open the **Actions** tab. The **Build Windows installer** workflow runs on every push to `main`, or press **Run workflow**.
3. When it finishes (about 5-8 minutes), open the run and download **PDFEditor-Windows** from *Artifacts*. It contains
   `PDFEditor-Setup-<version>.exe` (installer) and `PDFEditor-Portable-<version>.exe`.
4. For a proper download page: `git tag v1.1.0` then `git push --tags`. The workflow builds again and attaches both files to a
   **GitHub Release**, with the version number taken from the tag.

After you run the installer, **PDF Editor** appears when you right-click a PDF > *Open with* (and in Windows Settings > Default apps).
The workflow also installs the fresh installer on the build machine and checks that this registration exists.

## Build it (on your Windows PC)

1. Install **Node.js 20 LTS** (22 LTS also works) from nodejs.org. You need internet for this step only.
2. Open a terminal in this folder and run:

```
npm install
npm run dist
```

`npm install` downloads Electron, electron-builder and the offline libraries, and copies them into `app\vendor\`
(pdf.js 3.11.174, pdf-lib 1.17.1, tesseract.js 5.1.1 + core + English data: the same files `download-vendor-files.ps1` fetched).
`npm run dist` builds both Windows outputs into `dist\`:

* `PDFEditor-Setup-1.0.0.exe` - installer (per-user, no admin, Start Menu + Desktop shortcut, "Open with", uninstaller)
* `PDFEditor-Portable-1.0.0.exe` - single portable exe, nothing installed

Only one of them: `npm run dist:installer` or `npm run dist:portable`.

**Check it works before you rely on it:** `npm run selftest` starts the app hidden and checks the app:// origin, bundled
pdf.js / pdf-lib, **offline OCR** (it OCRs a generated image), localStorage and the image downloader's safety check.
It prints a pass/fail list and writes `%APPDATA%\PDF Editor\selftest-result.json`.
Other commands: `npm start` (run from source), `npm test` (unit tests), `npm run test:e2e` (browser tests, needs `npm i -D playwright`).

## Moving over from the Edge version (do this in this order)

1. Your **PDFs need nothing**: edits, comments, scan text and drawings are stored inside the PDFs.
2. Your **settings** (toolbar size, highlight size, pin/comment colours, Translate popup, **Gemini API key / model / prompt**) live in
   Edge's storage for `http://127.0.0.1:8743`; a new app cannot read that by itself. Before uninstalling the old version:
   copy `migration\export-old-settings.html` into `%LOCALAPPDATA%\PDFEditor\`, start the old PDF Editor once, open
   `http://127.0.0.1:8743/export-old-settings.html` in Edge, press the button -> `pdfeditor-settings.json` in Downloads.
3. Install the new app (it replaces the old "PDF Editor" shortcuts and the PDF "Open with" entry). Then **drag
   `pdfeditor-settings.json` onto the PDF Editor shortcut** (or its exe). It asks, imports, and reloads.
4. Remove the old version with its `uninstall.bat` (stops the old server, deletes `%LOCALAPPDATA%\PDFEditor`).

If you skip step 2/3 everything works; you just re-enter the settings once.

## Using it

* Double-click a PDF / right-click > Open with > PDF Editor. Make it the default in Windows Settings > Apps > Default apps
  (Windows decides the default; no installer can force it).
* **Ctrl+S writes back into the file that was opened** (double-click, Open with, Open button, drag-drop). Ctrl+Shift+S is Save As.
* Launching a second PDF while the app is open adds a **new tab** in the same window (or switches to it if already open)
  and raises the window, restoring it if minimized.
* Settings/data folder: `%APPDATA%\PDF Editor` (kept when you uninstall). Log: `main.log` there.
* Pin to taskbar works (taskbar identity `PDFEditor.App`, same as before).

## Folder map

`main.js` main process (replaces serve.ps1, launch.vbs, PDFEditor.exe launcher) / `preload.js` the small API given to the page /
`lib/` file I/O, image downloader, argv parsing, app:// rules / `app/` the web app (`final.html`, `electron-bridge.js`, icons, `vendor/`) /
`build/` icon + NSIS "Open with" registration / `scripts/` vendor copier + selftest / `test/` tests / `migration/` old-settings exporter.
