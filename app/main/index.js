/**
 * Circle to Lens — main process entry point.
 *
 * Stays small on purpose: imports each service / window / IPC
 * module, wires them together, and runs the lifecycle hooks.
 *
 * Module layout (under app/main):
 *
 *   index.js              ← this file: lifecycle + wiring
 *   store/settings.js     ← JSON settings persistence
 *   windows/{home,settings,overlay}.js
 *                         ← BrowserWindow factories, one per window
 *   services/
 *     ocr.js              ← tesseract worker + structured OCR
 *     translator.js       ← Google + MyMemory + batch
 *     lens-uploader.js    ← cropped PNG → Lens via user's browser
 *     capture.js          ← desktopCapturer wrap
 *     hotkey.js           ← global shortcut register / re-register
 *     tray.js             ← tray icon + context menu
 *     notifier.js         ← system notification helper
 *     auto-launch.js      ← Windows login-item toggle
 *     icon-renderer.js    ← SVG → PNG for tray + dock
 *     start-menu-shortcut.js
 *                         ← .lnk in Start Menu Programs folder
 *   ipc/
 *     index.js            ← register every channel
 *     home.js
 *     settings.js
 *     overlay.js
 *
 * shared/
 *   constants.js          ← AUMID, PRODUCT_NAME, DEFAULT_HOTKEY, …
 *   ipc-channels.js       ← single source of truth for channel names
 */

"use strict";

const { app } = require("electron");

const { APP_USER_MODEL_ID } = require("../shared/constants");

const settingsStore = require("./store/settings");
const homeWindow = require("./windows/home");
const settingsWindow = require("./windows/settings");
const overlayWindow = require("./windows/overlay");

const tray = require("./services/tray");
const hotkey = require("./services/hotkey");
const autoLaunch = require("./services/auto-launch");
const startMenuShortcut = require("./services/start-menu-shortcut");
const { getAppIcon } = require("./services/icon-renderer");
const { captureCursorDisplay } = require("./services/capture");
const { notify } = require("./services/notifier");
const ocr = require("./services/ocr");
const ipc = require("./ipc");

/** Brand icon (256×256) — used by tray + every BrowserWindow. */
let APP_ICON = null;

/* -------------------------------------------------------------------------- */
/*  Identity (must run before any UI)                                          */
/* -------------------------------------------------------------------------- */

if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

/* -------------------------------------------------------------------------- */
/*  Single instance lock                                                       */
/* -------------------------------------------------------------------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Another instance tried to launch — bring up the home window
    // so the user sees something instead of "nothing happened".
    homeWindow.open(APP_ICON);
  });
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  const initialSettings = settingsStore.read();

  // Rasterise the brand SVG once. Failures here are non-fatal —
  // getAppIcon() resolves to an empty image and we'll show the
  // procedural fallback inside the tray service.
  APP_ICON = await getAppIcon();

  // Hotkey first so the tray menu shows the right combo from the
  // very first paint.
  hotkey.init(activateOverlay, () => tray.refreshMenu());
  const ok = hotkey.registerInitial(initialSettings.hotkey);
  if (!ok) {
    notify(
      "Hotkey unavailable",
      `${initialSettings.hotkey} is already taken by another app. ` +
        `Circle to Lens will only work via the tray menu — change ` +
        `the combo in Settings.`,
    );
  }

  // Tray. Pulls the live hotkey through a getter so refreshMenu()
  // doesn't need any new arguments.
  tray.build(APP_ICON, {
    onLeftClick:    () => homeWindow.open(APP_ICON),
    onDoubleClick:  activateOverlay,
    onOpenHome:     () => homeWindow.open(APP_ICON),
    onOpenSettings: () => settingsWindow.open(APP_ICON),
    getHotkey:      () => hotkey.current(),
  });

  // IPC handlers — single registration call.
  ipc.register({ onCapture: activateOverlay });

  // Best-effort: keep the Start menu shortcut up to date
  // (idempotent via a stamp file, so this is ~0 ms on subsequent
  // launches).
  startMenuShortcut.ensure().catch((e) =>
    console.warn("[main] shortcut ensure rejected:", e?.message || e),
  );

  // Mirror persisted autostart into the actual OS login setting.
  autoLaunch.apply(initialSettings.startWithWindows);

  // Show Home on launch by default. The user can switch this off
  // from Home itself, but having a visible window on start removes
  // the "did the app even launch?" confusion (tray icons get hidden
  // in the overflow on Windows 11 by default).
  if (initialSettings.showHomeOnStartup || !initialSettings.firstRunComplete) {
    setTimeout(() => homeWindow.open(APP_ICON), 400);
  } else {
    notify(
      "Circle to Lens is running",
      `Press ${hotkey.current()} anywhere on Windows to capture. ` +
        `Right-click the tray icon for more options.`,
    );
  }

  if (!initialSettings.firstRunComplete) {
    settingsStore.write({ firstRunComplete: true });
  }
});

app.on("window-all-closed", (e) => {
  // We're a tray app — closing every window must NOT quit us.
  e.preventDefault();
});

app.on("will-quit", () => {
  hotkey.dispose();
  // Cleanly terminate the OCR worker if it was ever started.
  ocr.shutdown().catch(() => undefined);
});

/* -------------------------------------------------------------------------- */
/*  Hotkey / tray action: pop the lasso overlay                                */
/* -------------------------------------------------------------------------- */

async function activateOverlay() {
  if (overlayWindow.isOpen()) {
    overlayWindow.focus();
    return;
  }
  try {
    const captured = await captureCursorDisplay();
    overlayWindow.open(captured);
  } catch (err) {
    console.error("[main] activateOverlay failed:", err);
    notify(
      "Circle to Lens",
      "Couldn't capture the screen: " + (err?.message || err),
    );
  }
}
