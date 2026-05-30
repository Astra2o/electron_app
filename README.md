# Circle to Lens — Desktop App

> **v0.2.0** · Windows-first, macOS build target included.

Press a global hotkey from **anywhere** on your desktop and do one of four
things to whatever's on screen, in-place:

1. **Lens search** — draw a freehand circle, release, and Google Lens opens
   in your real default browser with the cropped region uploaded against
   your actual Google session.
2. **Translate** — drag a rectangle over text, see the translation
   overlaid on the original lines with a **frosted-glass background**.
   Click any pill to peek the original.
3. **Select text** — drag a rectangle over text and select it like a PDF
   (invisible-but-selectable spans align with the screenshot beneath; the
   browser's ::selection paints the highlight).
4. **Copy text** — same as Select text with a one-click Copy toolbar.

Works on top of every app — browsers, games, PDFs, videos, file
explorer windows, anywhere. Designed primarily for Windows 10 / 11; the
build pipeline now also ships macOS DMG/ZIP targets for users who want
to try it on Apple Silicon or Intel Macs.

> Sibling project of the Chrome extension in `../chrome_extension/`.
> They're fully independent — pick whichever fits the workflow.

---

## What's new in 0.2.0

- **Industry-standard project layout.** Everything now lives under
  `app/` (main / preload / renderer / shared / resources). Old root-level
  monoliths (`main.js`, `lens.js`, `overlay/`, `settings/`, `home/`,
  `result/`) are gone.
- **In-place rect-mode OCR.** Translate / Select-text / Copy ask the user
  to drag a **rectangle** over the target text (Snipping-Tool style),
  then crop + OCR + render results scoped to that rectangle. Nothing
  spills onto the rest of the screen.
- **Frosted-glass translation overlays.** Translated text sits on a
  `backdrop-filter: blur(16px)` pill — semi-transparent, but the
  translation is always crisply readable thanks to text-shadow.
- **High-accuracy OCR.** Bundled `tessdata_best` (15 MB English + 12 MB
  Hindi) is loaded into a *persistent* Tesseract worker that's seeded
  from the app's read-only cache (no CDN download, ever). A `wasm-feature-detect`
  shim forces the SIMD-LSTM core inside Electron's `worker_threads`,
  which would otherwise fall back to the non-SIMD core and abort with
  `_ZN9tesseract13DotProductSSEEPKfS1_i`.
- **Smart preprocessing.** Small crops are upscaled (Lanczos-quality
  canvas resampling) before being sent to OCR so glyph height clears
  the ~30 px sweet spot.
- **Action-menu alignment.** Pick `start / center / end` along the
  docked axis (`left / center / right` for top/bottom, `top / center /
  bottom` for left/right) — same idea as Windows 11's "centred / left
  taskbar" toggle. The language picker tracks the menu's alignment.
- **Cursor polish.** Translate / Select-text / Copy use a `crosshair`
  cursor over empty drag-space, `pointer` over UI controls, and an
  I-beam (`text` cursor) over recognised text spans.

---

## Highlights

- **System-wide hotkey** — default `Alt + Shift + S`, fully customisable
  from the in-app Settings panel (click-and-press capture, instant
  re-registration, auto-revert if the combo is already taken).
- **4 pencil styles** — RGB-rainbow glow (animated), Classic white,
  Neon green, Indigo ink.
- **Snap-to-rectangle** for the Lens lasso, automatic rectangle drag
  for the OCR-bound modes (rect is the right interaction for those).
- **Open Lens in new tab or new docked window.** When "new window" is
  selected, choose left / center / right docking with custom width and
  height percentages. The Lens result opens in a clean Chrome `--app=URL`
  window at *exactly* the size you configured (the app uses both
  `--window-size` flags and in-page `window.moveTo` / `resizeTo` to
  defeat Chrome's "remember last window size" caching).
- **Result renders in your real browser session** — so the Lens upload
  is tied to your actual Google cookies, no "image not found / not
  associated with your account" errors.
- **Floating action menu** — quick-switch between Lens / Translate /
  Select text / Copy without leaving the overlay. Dockable to any
  edge and now alignable to start / center / end along that edge.
- **Language picker for Translate** — 18 languages, last selection
  remembered across sessions, instant re-translate from cached OCR
  when you change language without redrawing.
- **Home window** with onboarding, current hotkey, quick toggles for
  "Start with Windows" and "Open this window every time the app starts".
- **Start Menu integration** (Windows) — first launch drops a
  `Circle to Lens` shortcut into your per-user Start Menu Programs
  folder, so you can search for the app from the Windows search bar.
- **Tray icon** — vivid 32×32 RGB lens with a magnifying-glass tail,
  readable on both light and dark taskbars.

---

## Repo layout

```
electron_app/
├── package.json                    npm metadata + electron-builder config
├── README.md                       this file
├── scripts/
│   └── build-icon.js               renders SVG → icon.ico/.png/.icns
└── app/
    ├── main/                       Electron main process
    │   ├── index.js                lifecycle wiring + activateOverlay()
    │   ├── ipc/                    ipcMain handlers per window
    │   │   ├── index.js            registers home + settings + overlay
    │   │   ├── home.js
    │   │   ├── settings.js
    │   │   └── overlay.js          OCR / translate / lens IPC
    │   ├── services/
    │   │   ├── capture.js          desktopCapturer wrap
    │   │   ├── hotkey.js           globalShortcut register/apply
    │   │   ├── tray.js             tray icon + context menu
    │   │   ├── auto-launch.js      Windows / macOS login item
    │   │   ├── notifier.js         system toast wrapper
    │   │   ├── icon-renderer.js    SVG → PNG (used by build-icon)
    │   │   ├── start-menu-shortcut.js   Windows .lnk via PowerShell
    │   │   ├── ocr.js              persistent Tesseract worker
    │   │   ├── ocr-worker-bootstrap.js  worker_threads SIMD shim
    │   │   ├── translator.js       Google + MyMemory translate
    │   │   └── lens-uploader.js    builds Lens auto-submit HTML
    │   ├── store/
    │   │   └── settings.js         JSON settings persistence
    │   └── windows/                BrowserWindow factories
    │       ├── home.js
    │       ├── settings.js
    │       └── overlay.js
    ├── preload/                    contextBridge bridges
    │   ├── home.js
    │   ├── settings.js
    │   └── overlay.js
    ├── renderer/                   HTML/CSS/JS per window
    │   ├── home/
    │   ├── settings/
    │   └── overlay/                lasso + rect drag + selection/translate UI
    ├── resources/
    │   └── tessdata/               eng.traineddata + hin.traineddata (best)
    └── shared/
        ├── constants.js            DEFAULT_HOTKEY, OCR_LANGS, …
        └── ipc-channels.js         IPC channel name constants
```

---

## Quick start (development)

**Requirements**

- **Node.js 18+** (Electron 32 bundles modern fetch/FormData under the hood)
- **Windows 10 / 11** or **macOS 12+** (Apple Silicon or Intel)
- **Google Chrome** or **Edge** installed (only needed if you want the
  "new window" docking mode — tab mode works with any default browser)

**Install and run**

```bash
cd electron_app
npm install
npm start
```

`npm start` runs `electron .`. For debugging with the inspector use
`npm run dev` (boots with `--inspect=9229`).

On first launch:

1. The **Home window** opens (welcome + quick toggles).
2. The tray icon appears in the system tray. On Windows 11 it may land
   in the overflow (`^` arrow) area by default — drag it onto the main
   taskbar to keep it visible.
3. A **Start Menu shortcut** (Windows) or **/Applications entry**
   (macOS, via dmg install) makes the app searchable.
4. **OCR worker preload.** The first time you trigger an OCR action,
   tesseract.js seeds `eng.traineddata` + `hin.traineddata` into
   `%APPDATA%\circle-to-lens\tessdata\` (Windows) or
   `~/Library/Application Support/circle-to-lens/tessdata/` (macOS)
   from the bundled `app/resources/tessdata/` — no CDN download.

---

## Using it

1. Look at whatever you want to search / translate / read — anywhere
   on screen.
2. Press **`Alt + Shift + S`** (or whatever combo you configured).
3. The screen dims slightly; the floating action menu appears with
   Lens / Translate / Select text / Copy.
4. Pick an action (or use the default), then:
   - **Lens** → draw a free-form circle / lasso. On release the crop
     is sent to Google Lens via your default browser.
   - **Translate / Select text / Copy** → drag a rectangle around the
     text you care about. OCR runs on just that rectangle (so it's
     fast), and results render *inside* the rectangle.
5. **Translate** drops frosted-glass pills on top of every detected
   line — click any pill to peek the original.
6. **Select text / Copy** make the rect's text selectable like a PDF.
   A small floating toolbar with Copy + Translate appears next to your
   selection.

Press **`Esc`** while the overlay is open to cancel.

---

## Settings

Open via the tray icon (right-click → **Settings…**), or via the
*Customize…* button on the Home window.

| Section | Setting | Default |
|---|---|---|
| Capture hotkey | Click box, press any combo | `Alt + Shift + S` |
| Pencil style | `RGB glow` / `Classic` / `Neon` / `Ink` | RGB glow |
| After draw | Snap to rectangle (Lens lasso → bbox) | on |
| Action menu | Show on overlay | on |
| Action menu | Default action | Lens |
| Action menu | **Position** — top / bottom / left / right | top |
| Action menu | **Alignment** — start / center / end along the docked edge | center |
| Lens result | Open in `New tab` or `New window` | New tab |
| Window position | Left / Center / Right | Right |
| Window width | 20–100 % | 35 % |
| Window height | 20–100 % | 100 % |

The Home window also has:

- **Open this window every time the app starts** — on by default so
  it's obvious the app is running. Switch off for a silent tray-only
  experience (a launch notification still appears).
- **Start with Windows / Login items** — adds Circle to Lens to the
  user-level login items so it boots up with your session. On Windows
  this writes the Run-key registry entry on first launch; on macOS it
  uses `app.setLoginItemSettings`.

---

## How the upload pipeline works

| # | What happens | Where |
|---|---|---|
| 1 | User presses the hotkey | `app/main/services/hotkey.js` |
| 2 | Screen captured with `desktopCapturer` at native resolution of the display the cursor is on | `app/main/services/capture.js` |
| 3 | Frameless transparent always-on-top window opens covering that display | `app/main/windows/overlay.js` |
| 4 | Overlay receives the screenshot + display metadata + user settings via IPC | `app/preload/overlay.js` ↔ `app/renderer/overlay/overlay.js` |
| 5 | **Lens path:** user draws a freehand lasso; canvas renders the chosen pencil style; on mouse-up the polygon is closed (optionally snapped to bounding-box rect) and cropped at native resolution | `overlay.js` → `cropToPolygon()` |
| 6 | **OCR path:** user drags a rectangle; we upscale the crop to ≥ 1200 px shorter side (Lanczos resampling) and pipe it to the persistent Tesseract worker | `overlay.js` → `cropToPolygon({ upscaleForOcr: true })` → `app/main/services/ocr.js` |
| 7 | OCR returns text + line bboxes (in cropped-image px). The renderer converts those back to viewport CSS px via `rectCss.x + bbox.x0 / pxPerCssPx` and lays out either selectable spans (Select-text / Copy) or frosted-glass translation pills (Translate). | `overlay.js` → `bboxInRectToCss()` |
| 8 | **Lens path** writes a self-contained HTML stub to `%TEMP%\circle-to-lens\lens-<ts>.html`. The HTML contains the PNG as base64 + JS that reconstructs the blob, builds a `<form enctype="multipart/form-data" action="lens.google.com/v3/upload">` with the image bytes attached via `DataTransfer`, and `form.submit()`s. | `app/main/services/lens-uploader.js` |
| 9 | The temp HTML is opened in the user's default browser: **tab** mode uses `shell.openExternal`; **window** mode spawns `chrome.exe --app=URL --window-position=X,Y --window-size=W,H`. The HTML *also* calls `window.moveTo` / `resizeTo` before submitting, to defeat Chrome's "ignore size flags when an instance is already running" cache. | `lens-uploader.js` |
| 10 | The browser POSTs the image from its own session → Lens redirects to `/search?vsrid=…&udm=26` → result page renders normally because the viewing session **is** the uploading session. | Browser |

This architecture is intentionally hands-off: the Electron app **never**
holds onto cookies, never opens its own result window, never embeds a
WebView. The actual upload and viewing happen entirely inside the user's
real browser, which sidesteps Google's "this WebView may not be secure"
sign-in blocker and Lens's account-binding restrictions.

---

## Building a distributable

### Windows

```powershell
cd electron_app

# NSIS one-click installer (recommended for distribution)
npm run build:installer

# Portable .exe (no install required, just double-click)
npm run build:portable

# Both at once
npm run build
```

Output lands in `electron_app/dist/`.

The installer:

- Registers the app under the AppUserModelID `com.circletools.lens`
  (proper Start Menu / taskbar / notification grouping).
- Creates Start Menu and Desktop shortcuts.
- Bundles everything in `app/**/*` plus the bundled `tessdata` files,
  per `package.json > build.files` and `extraResources`.
- Excludes `node_modules`, `dist`, and OS clutter.

> Drop a real `.ico` at `build/icon.ico` for a polished install. Without
> it electron-builder falls back to the default Electron icon.

### macOS

> **You must build macOS binaries from macOS.** electron-builder cannot
> cross-build signed `.dmg` / `.app` bundles from Windows in any
> reliable way (the `winCodeSign` helper extracts macOS symlinks that
> Windows can't write back into the bundle without elevation, and even
> with that you can't produce a notarisable result without an Xcode
> command-line toolchain). Use a real Mac.

On a Mac with Node.js 18+ and Xcode CLT installed:

```bash
cd electron_app
npm install

# DMG + ZIP for both Apple Silicon (arm64) and Intel (x64)
npm run build:mac

# Just the DMG (the typical user-facing format)
npm run build:mac:dmg

# Just the ZIP (smaller, no installer chrome)
npm run build:mac:zip
```

Output lands in `electron_app/dist/`. The DMG opens a window with the
app icon on the left and an `/Applications` shortcut on the right —
drag-and-drop install, standard macOS pattern.



> Drop a real `.icns` at `build/icon.icns` for a polished install
> (the `scripts/build-icon.js` script renders both `.ico` and `.icns`
> from the same SVG source under `app/renderer/home/icon.svg`).

---

## Initialising as a standalone git repo



The included `.gitignore` already excludes `node_modules/`, `dist/`,
`out/`, `*.log`, and OS clutter, so the very first commit is clean.

---

## Privacy

- The app talks to **`lens.google.com`** (upload endpoint), **`www.google.com`**
  (result redirect), **`translate.googleapis.com`** (translation), and
  **`api.mymemory.translated.net`** (translation fallback). Nothing else.
- Lens uploads happen entirely in the user's default browser. The Electron
  process never owns Google session cookies.
- OCR runs **entirely on-device** via Tesseract.js / WebAssembly. No
  pixels leave the machine for text recognition.
- Captured pixels stay in memory until the moment they're written into
  the temp HTML stub (Lens) or sent to the local Tesseract worker (OCR).
  Temp HTML files are deleted two minutes after the upload starts.
- No analytics, no telemetry, no remote logging.

---


---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Alt+Shift+S` does nothing | Another app owns it. Open Settings, click the hotkey box, press a different combo. The change is applied instantly. |
| "Couldn't capture the screen" notification | Only on locked-down systems where screen recording is blocked (kiosks, some VDIs, fresh macOS where Screen Recording permission hasn't been granted to the app). On macOS: System Settings → Privacy & Security → Screen Recording → allow Circle to Lens. |
| Lens result page says "Image not found" | The upload happened from a different session than the one viewing. Make sure you didn't change default-browser mid-flight; close any private/incognito windows that intercepted the temp HTML. |
| New-window mode opens at full screen / last window size | Settings → Open in → **New window** should be selected. The app does both `--window-size` and `window.resizeTo` to win against Chrome's caching; if it still misbehaves, your Chrome may be installed in a non-standard path — check `[lens] spawning ...` in the terminal output. |
| Tray icon missing on Windows | Windows 11 hides non-system tray icons by default. Click the `^` arrow in the taskbar tray and drag the RGB lens icon onto the main taskbar (or Windows Settings → Personalization → Taskbar → Other system tray icons). |
| Start Menu search doesn't find the app | Open the Home window → "Searchable from the Windows search bar" row → **Recreate**. This re-runs the PowerShell shortcut writer. |
| OCR aborts with `_ZN9tesseract13DotProductSSEEPKfS1_i` | Old build — upgrade to ≥ 0.2.0. We bundle a worker bootstrap (`app/main/services/ocr-worker-bootstrap.js`) that forces tesseract.js to load the SIMD-LSTM core, avoiding the non-SIMD `tesseract-core-lstm` whose float-LSTM path is missing this intrinsic. |
| OCR finds "no text" inside a small rectangle | The rect was too tiny to clear Tesseract's ~30 px-tall glyph requirement even after the 1200-px-short-side upscale. Drag a slightly bigger rect, or zoom in within the source app. |

### Build error: `Cannot create symbolic link : A required privilege is not held by the client`

Windows-only electron-builder issue — its `winCodeSign` helper archive
contains macOS `.dylib` symlinks, and Windows refuses to extract them
unless one of these is true:

1. **Windows Developer Mode is enabled** (recommended — one-time toggle
   in `Settings → Privacy & Security → For developers → Developer Mode`), **or**
2. The build is run from an **elevated** (Administrator) shell.

After flipping Developer Mode on (or starting an admin PowerShell),
clear electron-builder's corrupted cache and retry:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache" -ErrorAction SilentlyContinue
cd electron_app
npm run build
```

If you're not planning to sign the binary (typical for personal use),
skip the signing helper entirely:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run build:portable
```

---

## License

MIT. Go wild.
