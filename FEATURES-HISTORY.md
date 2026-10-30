**Fixed: opening a PDF (or the same PDF again) from Windows now brings the PDF Editor window to the front.** If the window was behind other windows or minimized, it is restored and shown on top, with the file in its own tab (or switched to, if it was already open). Local server is now version 11; reinstall once to update.

**New: the open comment's pin is highlighted.** While a comment is open in the editor, its pin turns gold with a white-and-dark ring so you can see which comment it is; when the comment is closed the pin goes back to its normal colour.

**Fixed: tabs are independent again.** A comment editor left open on one PDF no longer follows you into another tab (it used to stay on screen when you opened a new PDF, and then Save worked on the wrong file or got stuck). Switching, opening or closing tabs now closes a comment that has no unsaved changes; a comment with unsaved changes keeps you on its tab until you press Save.

**Comments: Save only appears when there is something to save, and unsaved changes block closing.** The Save button in the comment editor is hidden until you change the text, formatting, a picture or the pin colour (and goes away again after Save, or if you undo back to the original). While a comment has unsaved changes it cannot be closed (X, Cancel, Esc) or replaced by opening another comment, and the PDF's tab and the window cannot be closed; you are told to press Save first.

**New: drag tabs to change their order.** Press on a tab and drag it left or right; the other tabs make room and the new order is kept. A plain click still switches tabs.

**Fixed: the window now opens maximized** (filling the screen except the taskbar) instead of a smaller window. Reinstall to update the shortcut launcher.

**Fixed: the comment size box no longer jumps back after you change the size of selected text.** After a size change the box showed the size of the surrounding paragraph instead of the selected text, so pressing the size up arrow again kept re-applying the same small step (for example 12, then back to 11, then 12). It now shows the size of the selected text.

**Fixed: pasting into a comment no longer brings the source's background and text colour.** Text copied from a web page, AI chat or Word used to arrive with white (or shaded) boxes behind it and, from dark sites, near-white letters. Pasted text now takes the comment's own look. Backgrounds you added yourself in the comment are left alone.

**Fixed: a new comment pin now appears exactly where you click.** The pin's pointed corner (bottom-left) sits on the clicked spot, matching the tip of the comment cursor, instead of being centred above it. Dragging a pin follows the same corner.

**Fixed: selecting text no longer grabs the line above or below.** Starting a drag slightly above/below a line, or drifting a little up/down while dragging along it, now keeps the selection on that one line (and going past the end of a line just selects to its end). Move the pointer clearly onto another line (about one line height away) and that line is selected as before. Double-click, triple-click, Shift+click and touch are unchanged.

**New: tabs.** Every PDF you open now gets its own tab in the same window, and the "PDF Editor" name above the toolbar is gone (the window title now shows the open file's name).
- Each tab keeps its own edits, undo history, unsaved-changes marker (a dot before the name), page, zoom and scroll position. Click a tab to switch; click its x (or middle-click the tab) to close it; the + at the end opens another PDF in a new tab.
- Opening a PDF that is already open just switches to its tab. Closing a tab with unsaved changes asks first, and closing the window warns if any tab has unsaved changes.
- With many PDFs open the tabs squeeze together (the current tab always stays readable, hover any tab to see its full name) and the strip scrolls sideways once they cannot shrink further.
- **Windows "Open with" / double-click:** if the app is already open, the PDF opens as a new tab in that window instead of starting a second one. (Local server is now version 6, launch.vbs replaces the old one automatically.)
- Switching tabs is not possible while "Scan text" is running or a comment editor is open; stop the scan or close the comment first.

**New: Save only when there is something to save, and a Lock.**
- **Save PDF is greyed out until you change something.** Opening a PDF, saving, or undoing back to the saved state all turn it off again (Ctrl+S then just says "No changes to save"). Ctrl+Shift+S (Save As) still always works.
- **Lock** (new padlock button, or press **L**): while locked nothing can be changed. The editing tools, Scan text, Undo/Redo, moving or deleting pins, highlights and text boxes, and editing or deleting comments and attachments are all switched off. You can still read, scroll, zoom, select/copy/translate text, open comments and attachments, and Save changes you already made. Unlock the same way.
- **Right-click** anywhere on the page now has **Lock editing / Unlock editing**. When locked, the menu shows only Translate, Copy and Unlock.

**Highlight: "None" color, size percentage and default size.** The highlight colors (toolbar and right-click menu) now end with a "None" swatch (a circle with a red slash). With None, selecting text or dragging over it takes the highlight off instead of adding one: on selected text only the covered part is cut out; a freehand drag removes every highlight it touches. Right-click a highlight or selected highlighted text and choose None to remove it. Everything is one Undo step. The Highlight size slider now shows its percentage (60% to 180%), and "Set as default" next to it remembers the current size for every time the app opens.

**Right-click menu on the page now works with the tools.** Right-click an empty spot (or plain page text) with no tool, the Highlight tool or the Draw tool on: pick a Highlight colour to switch the Highlight tool on with that colour, or a Draw colour to switch the Draw tool on with that pen colour. The menu also has a "Free-draw on OCR text" switch (same setting as the checkbox in the Highlight toolbar; turning it on also selects the Highlight tool). Double right-click on an empty spot still turns the active tool off.

**Fixed: pen drawings now show up again when you reopen a saved PDF.** Drawings were saved into the PDF correctly (other readers showed them), but this editor never read them back in. They are now loaded as editable pen strokes, so you can still erase them. Erased drawings stay erased, and saving again does not double them.

**Fixed: a comment keeps its font, size and bold when you delete all its text and type again.** Before, clearing the whole comment removed the formatting and the new text came back at the editor's default size. The comment's look is now remembered and applied to the new text.

**Cursors now follow your chosen color.** With the Highlight tool on a part that has no scanned text, the round brush cursor is drawn in the highlight color you selected (it used to always be yellow). With the Draw tool, the pencil is filled with the selected pen color. The Comment tool's bubble cursor is now blue instead of yellow.

**Fixed: Save now works when the PDF was opened with Windows "Open with" (or as the default PDF app).** Ctrl+S / Save PDF writes straight back into the original file, with no Save As needed. The browser has no write access to a file opened that way, so the app's small local server (now version 5) does the write for it: the server gives the page a random one-time key when it hands over the file, and only that key can write, and only to that one file. The PDF is written to a temporary file first and swapped in, so a failure never leaves a half-written file. If the file is open in Acrobat (locked) you get a Retry button; if the server was restarted, Save falls back to Save As so nothing is lost. Ctrl+Shift+S still always does Save As.

**Fixed: Scan text results are now kept inside the PDF.** After you run Scan text, press Save PDF (Ctrl+S) and the recognised text is stored in the file itself, so it is back when you reopen the PDF, even on another PC or after the file was renamed. Previously it was only remembered in this browser under the file's name and size, and Save changes the size, so the scan was lost. Scanning now also marks the document as having unsaved changes.

**Fixed: Scan text stopped when another window was in front.** The browser stops animation frames for a covered window and the page-drawing step was waiting on them. The scan now draws pages without them, and the shortcut starts Edge with background throttling turned off.

**Fixed: right-click highlight colors on non-OCR areas.** Highlights drawn over scanned/image-only parts of a PDF (freehand highlights) can now be right-clicked to change their color, with the same Change highlight color menu as normal highlights. Right-clicking an empty spot on a page (no tool active) now also shows the color swatches, which set the color used for your next highlights.

**New: Text tool.** Click **Text** in the toolbar (or press **T**), click anywhere on the page and type. While the tool is on (or a text box is selected) the toolbar shows **font** (Sans-serif / Serif / Monospace), **size** (pt, type any number or pick a preset), **bold / italic** and **color** (six quick colors plus a full color picker). Each text box can have its own color and size: click a box to select it and change the options, or change the options first for the next box. Drag the small move handle above a box to reposition it, click the x to delete it, Ctrl+Z / Ctrl+Shift+Z work as usual. Text is saved into the PDF as a real text annotation (other PDF readers show it), and when you reopen the saved PDF here the boxes come back editable. Text the PDF's built-in fonts cannot show (for example Bengali) is saved as a sharp picture of the text so it still appears correctly.

**Fixed: pictures in comments can now be cropped, moved and resized.** Click a picture in the comment editor and a small toolbar appears: **Move** (or just drag the picture itself; a blue marker shows where it will land), **Crop** (opens a crop window: drag the box, its corners or edges, then Crop), **-/+** and a corner handle to resize, **Left / Center / Right / Inline** to position it (left/right wrap the text around it), **Cut** (then Ctrl+V where it should go) and **Delete**. Every change has an Undo button in the message that appears. Sizes and positions are kept when you save the comment. Also: Undo now redraws pen strokes correctly.

**Fix:** when the vendor/ folder is missing (for example when final.html is opened on its own or as a hosted page), the PDF reader, export library and OCR now correctly fall back to their online copies, and the app waits up to 15 seconds for them instead of failing right away.

# PDF Editor — one-click installer (.exe)

## What's new in this build
**Pasted figures now survive Save (works like pasting into Word):** when you paste AI-generated text, its figures are downloaded by the app's local server (the same way Word fetches web pictures) and embedded in the comment, right after the paste and again on Save. No screenshot and no manual adding. The server was updated for this (version 4), and launch.vbs replaces the old one automatically. If a figure cannot be downloaded, its web link is kept instead.

**Images in comments:** the comment editor now accepts pictures. Use the new image button in the comment toolbar, paste an image (Ctrl+V, e.g. a screenshot), or drag an image file into the comment. Large pictures are scaled down (longest side 900 px) so comments stay small. Images are saved with the comment in this browser and inside the PDF's hidden data, so they come back when you reopen the saved PDF here. Other PDF readers show only a "[image]" marker in the comment text.

**Copy keeps formatting:** the copy icon under the translation (and under each chat reply) now copies the response with its formatting (bold, italics, headings, lists, tables), so it pastes into Word, Google Docs or email looking the same. Pasting into a plain-text box gives clean text without ** or # marks.

**Right-click on selected text** now shows highlight colors instead of the
"AI settings..." entry (AI settings is still available from the gear button in
the toolbar). Select text and right-click, then pick a color to highlight it.
If the selected text is already highlighted, the menu says "Change highlight
color" and picking a color recolors just the selected part. Undo works for both.

**Comment editor** no longer closes when you click Save; it stays open so you can keep editing. Close it with Cancel, the X, or Esc.

**Right-click directly on a highlight** (no selection needed) shows the same menu: Translate (translates the highlighted text) and the colors, which recolor that whole highlight.

**Translate popup** now has: a chat box at the bottom (ask the AI follow-up questions; it remembers the translated text and the conversation), a **pin** button in its header (when on, the popup stays open while you click around the PDF and no longer dims the page; click the X to close it), and you can **drag it by its header** to move it anywhere. The pin setting is remembered.

**Model picker** in AI settings: a long built-in list of Gemini model names (2.x, 1.5, 1.0, previews, "-latest" aliases, Gemma), an "Other" option to type any model name, and a **Load all models from Google** button that fetches the models your API key can actually use and adds them to the list.

**Translate popup, round 2:** it can now be **resized** (drag any edge or corner; size is remembered), and the panel icon in its header **attaches it to the right side** of the window where it behaves like the comment panel (drag its left edge to change the width; click the icon again to detach). It has the same **font, font size (presets or exact pt) and background color** options as comments (the "Aa" button shows/hides them), and a **Model** picker at the top so you can switch Gemini models right there; the refresh button translates the same text again with the chosen model.

**Cursors:** choosing the Draw tool shows a pencil cursor, and the Comment tool shows a comment-bubble cursor (its tip is where the comment pin lands).

**Double right-click to leave a tool:** while Highlight, Draw, Comment, Attach or Erase is on, double right-click an empty spot of the PDF (no text under the cursor) to turn the tool off. Nothing you already did is undone. While a tool is on, a single right-click on an empty spot no longer opens the browser menu.

**Copy** was added to the right-click menu, right below Translate. It copies the selected text (or the text under the highlight you right-clicked).

**Copy in the translate popup:** every AI response (the translation, and each chat reply) has a small copy icon underneath it that copies just that response (the icon shows a check mark when done).

**Refresh button** (circular arrow, next to Open PDF): re-reads the PDF from disk and rebuilds the pages, keeping your edits, zoom and scroll position. This needs the file to have been opened with Open PDF in a browser that supports it (Chrome/Edge); otherwise it just redraws the pages.

**Move pins:** drag a comment pin or attachment pin to move it within its page (works with no tool on, or with the Comment/Attach tool). A plain click still opens it. Undo works.

## Earlier in this build
`final.html` now saves straight back into the file you opened when you
press **Ctrl+S** or click **Save PDF**, instead of always downloading a new
copy. Use **Ctrl+Shift+S** (or Shift-click **Save PDF**) for the old
"save as a new file" behavior. This works for files opened via the **Open**
button or dragged in; it needs a Chromium browser (which is what this
installer's shortcuts launch — Edge in app mode — so it works out of the
box).

## Build the .exe (takes a few seconds, no downloads for this step)

Windows already includes a tool called **IExpress** that packages files into
a self-installing `.exe`. To build `PDFEditorSetup.exe`:

1. Unzip this into a folder, e.g. `C:\PDFEditorInstaller\`.
2. Open Command Prompt (or PowerShell) **in that folder**.
3. Run:
   ```
   iexpress /N build-installer.sed
   ```
4. That creates `PDFEditorSetup.exe` right there in the same folder.

## What the installer does when someone double-clicks it

- Extracts itself to a temp folder and runs `install.bat` automatically.
- Copies `final.html`, `icon.ico`, `download-vendor-files.ps1`, `serve.ps1`,
  and `launch.vbs` to `%LOCALAPPDATA%\PDFEditor`.
- **Downloads the offline PDF/OCR engine files** into
  `%LOCALAPPDATA%\PDFEditor\vendor\` — this is the one moment the install
  needs internet. After this, the app never needs to reach a CDN for
  rendering PDFs, exporting PDFs, or running OCR ("Scan text") on images —
  everything runs from the local `vendor` folder. If there's no internet
  during install, installation still finishes; the app falls back to
  loading pdf.js/pdf-lib from the internet when online, and OCR shows a
  clear message telling you to run `download-vendor-files.ps1` later.
- Creates a **Start Menu shortcut** and a **Desktop shortcut**, both named
  "PDF Editor", opening the app in its own window via Edge's app mode
  (`msedge.exe --app=...`) — no address bar, no tabs.

## Why OCR needed internet before, and doesn't now

The OCR ("Scan text") feature is powered by Tesseract.js, which by default
fetches its recognition engine (WebAssembly) and language data (~3-11 MB)
from a CDN the first time it runs. `final.html` now points those lookups at
a local `vendor/` folder instead, so once `download-vendor-files.ps1` has
run (automatically during install, or manually later), OCR runs completely
offline, same as the rest of the app.

## What still needs internet

Only the **"Translate selection" AI feature**, since that calls Google's
Gemini API directly — there's no way around that, translation has to reach
a translation model somewhere. Everything else (viewing, highlighting,
commenting, drawing, OCR, exporting) works with no connection at all once
`vendor/` is populated.

## Adding another OCR language later

Open `download-vendor-files.ps1` in `%LOCALAPPDATA%\PDFEditor` — the
bottom of the file has a two-line example for adding a language (download
its `.traineddata.gz`, then change `OCR_LANG` in `final.html`).

## A note on SmartScreen

Because `PDFEditorSetup.exe` isn't digitally signed (that requires a paid
code-signing certificate), Windows may show a blue "Windows protected your
PC" warning the first time it's run. Click **More info** -> **Run anyway**.
Normal for any small unsigned installer.

## "Open with", default apps, and pinning to the taskbar

The installer now also:

- Compiles a small, genuine native `PDFEditor.exe` on the spot, using the
  C# compiler built into every Windows 10/11 install (part of .NET
  Framework - no separate download, no admin rights). It replaces an
  earlier approach that used IExpress to fake a `.exe`; Explorer's shell
  sometimes treats IExpress output as an installer package rather than an
  ordinary app, which is why "Pin to taskbar" and "Open with" could behave
  inconsistently. A plainly-compiled `.exe` doesn't have that problem. The
  Start Menu, Desktop, taskbar pin, and "Open with" registration all point
  at this same `.exe`, which is what makes it behave like any other
  installed app everywhere rather than only some of the time. If the
  compiler step fails for some reason, the installer falls back to the
  old wscript-based shortcuts and says so.
- Registers PDF Editor (per-user, no admin needed) so it shows up in a PDF
  file's right-click **Open with**, and in **Settings > Default apps** if you
  want to set it as your default PDF viewer. It also tells Explorer right
  away that file associations changed, so PDF Editor shows up in "Open
  with" immediately - no sign-out/sign-in required.

One caveat: a PDF opened this way (via "Open with", or as the set default)
doesn't come with a writable handle to that file the way one opened through
PDF Editor's own **Open** button or drag-and-drop does. **Ctrl+S** on such a
file downloads a new copy instead of saving back into the original in place;
use **Ctrl+Shift+S** either way if that's what you want anyway, or reopen the
file through **Open** inside the app to get in-place saving back.

## Uninstalling

Run `uninstall.bat` (included in the zip) — it removes the shortcuts and
everything under `%LOCALAPPDATA%\PDFEditor`, vendor folder included.

## v71
Comment names: a Name box in the comment toolbar (hidden with the toolbar arrow); hovering a comment pin shows its name above it; names are saved inside the PDF too.
