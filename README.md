# Circle to Lens — Windows Desktop App

Press a global hotkey from **anywhere** on Windows, draw a circle around
whatever you want to search, release — and Google Lens opens in your
own default browser with the cropped region uploaded against **your**
real Google session.

Works on top of every app — browsers, games, PDFs, videos, file
explorer windows, anywhere. Designed for Windows 10 / 11.

> Sibling project of the Chrome extension in `../chrome_extension/`.
> They're fully independent — pick whichever fits the workflow.

---

## Highlights

- **System-wide hotkey** — default `Alt + Shift + S`, fully customisable
  from the in-app Settings panel (click-and-press capture, instant
  re-registration, automatic revert if the combo is already taken).
- **4 pencil styles** — RGB-rainbow glow (animated), Classic white,
  Neon green, Indigo ink. Pick per personal preference.
- **Snap to rectangle** — after you release the lasso the freehand
  shape converts to a clean snipping-tool-style rectangle with the
  surrounding area dimmed.
- **Open Lens in new tab or new docked window** — when "new window"
  is selected, choose left / center / right docking with custom
  width/height percentages. Lens result opens in a clean Chrome app
  window at *exactly* the size and position you configured (the app
  uses Chrome's `--app=URL` mode plus in-page `window.moveTo` /
  `resizeTo` to defeat Chrome's "remember last window size" behavior).
- **Result renders in your real browser session** — so the Lens
  upload is tied to your actual Google account cookies, no
  "image not found / not associated with your account" errors.
- **Home window** with onboarding, current hotkey, quick toggles
  for "Start with Windows" and "Open this window every time the app
  starts".
- **Start Menu integration** — first launch drops a `Circle to Lens`
  shortcut into your per-user Start Menu Programs folder, so you can
  search the app from the Windows search bar.
- **Tray icon** — vivid 32×32 RGB lens with a magnifying-glass tail,
  readable on both light and dark taskbars.

---

## Repo layout

```
electron_app/
├── package.json              npm metadata + electron-builder config
├── main.js                   Main process: hotkey, capture, IPC, tray, windows
├── preload.js                Sandboxed bridge for the overlay renderer
├── lens.js                   Builds the auto-submit HTML stub, opens it in
│                             the default browser (tab) or via chrome --app
│                             (docked window)
├── settings-store.js         Tiny JSON settings persistence in userData
├── start-menu-shortcut.js    Writes the Start Menu .lnk via PowerShell
├── overlay/
│   ├── index.html            Transparent fullscreen lasso overlay
│   ├── overlay.css           Pencil / dim / hint / toast styling
│   └── overlay.js            Lasso drawing + crop + IPC submit
├── settings/
│   ├── index.html            Settings panel (hotkey, pencil, snap, etc.)
│   ├── settings.css
│   ├── settings.js
│   └── preload.js
└── home/
    ├── index.html            Welcome / how-to / quick toggles
    ├── home.css
    ├── home.js
    └── preload.js
```

---

## Quick start (development)

**Requirements**

- **Node.js 18+** (Electron 32 bundles modern fetch/FormData under the hood)
- **Windows 10 / 11**
- **Google Chrome** or **Edge** installed (only required if you want
  the "new window" docking mode — tab mode works with any default
  browser)

**Install and run**

```powershell
cd electron_app
npm install
npm start
```

On first launch:

1. The **Home window** opens (welcome + quick toggles).
2. The tray icon appears in the system tray. On Windows 11 it may
   land in the overflow (`^` arrow) area by default — drag it onto
   the main taskbar to keep it visible.
3. A **Start Menu shortcut** is created automatically. You can now
   search "Circle to Lens" from the Windows search bar.

---

## Using it

1. Look at whatever you want to search — anywhere on screen.
2. Press **`Alt + Shift + S`** (or whatever combo you configured).
3. The screen dims slightly with a hint chip near the top.
4. **Draw a circle / lasso** around the region you want.
5. **Release** the mouse. The selection either keeps its freehand
   shape or snaps to a clean rectangle (controlled by the
   *Snap to rectangle* toggle in Settings).
6. The cropped PNG is base64-embedded into a temp HTML stub which
   then opens in your **default browser** and auto-submits to
   `https://lens.google.com/v3/upload`. The browser follows Lens's
   302 to the result page — *in the same session*, so the image is
   bound to your real Google cookies and renders normally.

Press **`Esc`** while the overlay is open to cancel.

---

## Settings

Open via the tray icon (right-click → **Settings…**), or via the
*Customize…* button on the Home window.

| Section | Setting | Default |
|---|---|---|
| Capture hotkey | Click box, press any combo | `Alt + Shift + S` |
| Pencil style   | `RGB glow` / `Classic` / `Neon` / `Ink` | RGB glow |
| After draw     | Snap to rectangle (snipping-tool dim) | on |
| Open in        | `New tab` or `New window` | New tab |
| Window position | Left / Center / Right | Right |
| Window width    | 20–100 %                  | 35 % |
| Window height   | 20–100 %                  | 100 % |

The Home window also has:

- **Open this window every time the app starts** — on by default so
  it's obvious the app is running. Switch off for a silent
  tray-only experience (a launch notification still appears).
- **Start with Windows** — adds Circle to Lens to the user-level
  login items so it boots up with your session. **On by default after
  a fresh install** — the very first launch (typically the
  installer's "run after install" step) mirrors this into the registry,
  so subsequent reboots bring the tray + global hotkey up without any
  manual step. Toggle it off from Home if you'd rather start the app
  manually.

---

## How the upload pipeline works

| # | What happens | Where |
|---|---|---|
| 1 | User presses the hotkey | `main.js` → `globalShortcut` |
| 2 | Screen captured with `desktopCapturer` at native resolution of the display the cursor is on | `main.js` → `captureScreen()` |
| 3 | Frameless transparent always-on-top window opens covering that display | `main.js` → `openOverlay()` |
| 4 | Overlay receives the screenshot + display metadata + user settings via IPC | `preload.js` ↔ `overlay.js` |
| 5 | User draws a freehand lasso; canvas renders the pencil style chosen in Settings (RGB animated / classic / neon / ink) | `overlay.js` → `redraw()` |
| 6 | On mouse-up the polygon is closed — if *Snap to rectangle* is on, replaced with the bounding-box rectangle plus a snipping-tool dim layer | `overlay.js` → `polygonBoundingRect()` |
| 7 | The cropped PNG is sent to the main process | `overlay:submit` IPC |
| 8 | Main writes a self-contained HTML stub to `%TEMP%\circle-to-lens\lens-<ts>.html`. The HTML contains the PNG as a base64 data URL and JS that reconstructs the blob, builds a `<form enctype="multipart/form-data" action="lens.google.com/v3/upload">` with the image bytes attached via `DataTransfer`, and calls `form.submit()`. | `lens.js` → `buildAutoSubmitHtml()` |
| 9 | The temp HTML is opened in the user's default browser: **tab** mode uses `shell.openExternal`; **window** mode spawns `chrome.exe --app=URL --window-position=X,Y --window-size=W,H`. The HTML ALSO calls `window.moveTo` / `resizeTo` before submitting, to defeat Chrome's "ignore size flags when an instance is already running" behavior. | `lens.js` → `tryOpenInNewBrowserWindow()` |
| 10 | The browser POSTs the image from its own session → Lens redirects to `/search?vsrid=…&udm=26` → result page renders normally because the viewing session **is** the uploading session. | Browser |

This architecture is intentionally hands-off: the Electron app
**never** holds onto cookies, never opens its own result window,
never embeds a WebView. The actual upload and viewing happen
entirely inside the user's real browser, which sidesteps Google's
"this WebView may not be secure" sign-in blocker and Lens's
account-binding restrictions.

---

## Building a distributable

```powershell
cd electron_app

# NSIS one-click installer (recommended for distribution)
npm run build:installer

# Portable .exe (no install required, just double-click)
npm run build:portable

# Both
npm run build
```

Output lands in `electron_app/dist/`.

The installer:

- Registers the app under the AppUserModelID `com.circletools.lens`
  (proper Start Menu / taskbar / notification grouping).
- Creates Start Menu and Desktop shortcuts.
- Includes `electron_app/main.js`, `preload.js`, `lens.js`,
  `settings-store.js`, `start-menu-shortcut.js`, plus the
  `overlay/`, `settings/`, and `home/` folders (everything in the
  `build.files` array of `package.json`).
- Excludes `node_modules`, `dist`, `result/` (reserved), and the
  temp folders.

> For a polished build you should drop a real `.ico` at
> `electron_app/build/icon.ico` and add `"icon": "build/icon.ico"`
> under `build.win` in `package.json`. Without it electron-builder
> falls back to the default Electron icon.

---

## Initialising as a standalone git repo

This folder is meant to live on its own — independent from the
Chrome extension. From a fresh PowerShell:

```powershell
cd electron_app
git init
git add .
git commit -m "Initial commit: Circle to Lens v0.1.0"
git branch -M main
git remote add origin https://github.com/<you>/circle-to-lens.git
git push -u origin main
```

The included `.gitignore` already excludes `node_modules/`, `dist/`,
`out/`, `*.log`, and OS clutter, so the very first commit is clean.

---

## Privacy

- The app talks to **`lens.google.com`** (upload endpoint) and
  **`www.google.com`** (result redirect) via your default browser.
  Nothing else.
- The Electron process itself opens **no network connections** at
  all — the upload is performed entirely by the user's browser.
- Captured pixels stay in memory until the moment they're written
  into the temp HTML stub, which is deleted two minutes after the
  upload starts.
- No analytics, no telemetry, no remote logging.

---

## Differences from the Chrome extension

| Capability | `chrome_extension/` | `electron_app/` (this) |
|---|---|---|
| Works on **any** app/window (not just Chrome) | ❌ | ✅ |
| Captures inside Chrome web pages with DOM access | ✅ | ❌ |
| Routes to Gemini (text + image) | ✅ | ❌ — Lens only by design |
| Routes to Google Lens | ✅ | ✅ |
| Pencil style options | One | **Four** (configurable) |
| Snap-to-rectangle after lasso | ❌ | ✅ |
| Lens result session-binding fix | Side panel iframe | Default-browser hand-off |
| Customisable global hotkey | Via `chrome://extensions/shortcuts` | In-app Settings |
| Start-with-Windows | n/a | ✅ |
| Native installer | n/a | ✅ (electron-builder) |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Alt+Shift+S` does nothing | Another app owns it. Open Settings, click the hotkey box, press a different combo. The change is applied instantly. |
| "Couldn't capture the screen" notification | Only on locked-down systems where screen recording is blocked (kiosks, some VDIs). Run as your normal user. |
| Lens result page says "Image not found" | This means the upload happened from a different session than the one viewing. Make sure you didn't change default-browser mid-flight; close any private/incognito windows that intercepted the temp HTML. |
| New-window mode opens at full screen / last window size | Settings → Open in → **New window** should be selected. The app does both `--window-size` and `window.resizeTo` to win against Chrome's caching; if it still misbehaves, your Chrome may be installed in a non-standard path — check `[lens] spawning ...` in the terminal output. |
| Tray icon missing | Windows 11 hides non-system tray icons by default. Click the `^` arrow in the taskbar tray and drag the RGB lens icon onto the main taskbar (or use Windows Settings → Personalization → Taskbar → Other system tray icons). |
| Start Menu search doesn't find the app | Open the Home window → "Searchable from the Windows search bar" row → **Recreate**. This re-runs the PowerShell shortcut writer. |

### Build error: `Cannot create symbolic link : A required privilege is not held by the client`

This is a Windows-only `electron-builder` issue — its `winCodeSign`
helper archive contains macOS `.dylib` symlinks, and Windows refuses
to extract them unless one of these is true:

1. **Windows Developer Mode is enabled** (recommended — one-time
   toggle in `Settings → Privacy & Security → For developers →
   Developer Mode`), **or**
2. The build is run from an **elevated** (Administrator) shell.

After flipping Developer Mode on (or starting an admin PowerShell),
clear electron-builder's corrupted cache and retry:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache" -ErrorAction SilentlyContinue
cd electron_app
npm run build
```

If you're not planning to sign the binary (typical for personal
use), you can also skip the signing helper entirely:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run build:portable
```

---

## License

MIT. Go wild.
