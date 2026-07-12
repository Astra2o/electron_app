/**
 * Circle to Lens — Electron main process (Windows).
 *
 * What this process does:
 *
 *   1. Sets a stable AppUserModelID so Windows treats Circle to Lens
 *      as a proper app (Start menu, taskbar grouping, notifications).
 *   2. Registers a global hotkey (default: Alt+Shift+S) that works
 *      anywhere on Windows — even when the app has no visible window.
 *   3. On first launch, opens the Home window (welcome / how-to /
 *      quick toggles). Subsequent launches stay silent in the tray
 *      unless the user opens Home/Settings from the tray menu.
 *   4. Drops a `.lnk` shortcut into the per-user Start Menu so the
 *      app is searchable from the Windows search bar.
 *   5. When the hotkey fires: captures the screen, opens a
 *      transparent lasso overlay, crops the user's selection, and
 *      hands the PNG to lens.js → submitToLens, which writes an
 *      auto-submitting HTML stub to a temp file and opens it in the
 *      user's default browser (new tab or sized/positioned new
 *      window, per settings). The browser does the actual upload,
 *      so the result page renders against the user's real Google
 *      session.
 */

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  screen,
  Menu,
  Tray,
  nativeImage,
  Notification,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { submitToLens } = require("./lens");
const settingsStore = require("./settings-store");
const startMenuShortcut = require("./start-menu-shortcut");
const macShortcuts = require("./mac-shortcuts");
const { getAppIcon } = require("./icon-renderer");

/**
 * Brand icon (256×256) used for the tray, every BrowserWindow's
 * title-bar / taskbar / Alt+Tab thumbnail. Filled in once at startup
 * by `getAppIcon()` which rasterises `home/icon.svg`.
 *
 * @type {Electron.NativeImage | null}
 */
let APP_ICON = null;

const APP_USER_MODEL_ID = "com.circletools.lens";

/** Currently-registered global hotkey. Updated whenever the user
 *  changes it in Settings (and reverted to the previous value if the
 *  new combo can't be registered). */
let HOTKEY = "Alt+Shift+S";

/** @type {BrowserWindow | null} */
let overlayWin = null;
/** @type {BrowserWindow | null} */
let settingsWin = null;
/** @type {BrowserWindow | null} */
let homeWin = null;
/** @type {Tray | null} */
let tray = null;

// Identify ourselves to Windows before any UI exists so notifications
// + taskbar grouping carry the right app identity.
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
    // Another instance tried to launch — bring up the home window so
    // the user sees something instead of "nothing happened".
    openHome();
  });
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  const initialSettings = settingsStore.read();
  HOTKEY = initialSettings.hotkey || "Alt+Shift+S";

  // Rasterise the brand SVG once. Failures here are non-fatal —
  // getAppIcon() resolves to an empty image and we'll show the
  // procedural fallback in buildTray().
  APP_ICON = await getAppIcon();

  registerShortcut();
  buildTray();
  buildAppMenu();

  // Best-effort: keep OS launch shortcuts up to date (idempotent).
  startMenuShortcut.ensure().catch((e) =>
    console.warn("[main] shortcut ensure rejected:", e?.message || e),
  );
  macShortcuts.ensure({ hotkey: HOTKEY }).catch((e) =>
    console.warn("[main] mac shortcut ensure rejected:", e?.message || e),
  );

  const s = initialSettings;

  // Mirror the persisted autostart flag into the actual OS login
  // setting — useful if the user toggled it on, then uninstalled and
  // reinstalled.
  applyAutoStart(s.startWithWindows);

  // Show Home on launch by default. The user can switch this off from
  // Home itself, but having a visible window on start removes the
  // "did the app even launch?" confusion (tray icons get hidden in
  // the overflow on Windows 11 by default).
  if (s.showHomeOnStartup || !s.firstRunComplete) {
    setTimeout(openHome, 400);
  } else {
    // No window — surface a one-shot notification so the user knows
    // we're alive in the tray.
    notify(
      "Circle to Lens is running",
      `Press ${HOTKEY} anywhere to capture. Click the menu bar icon for more options.`,
    );
  }

  if (!s.firstRunComplete) {
    settingsStore.write({ firstRunComplete: true });
  }
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

/* -------------------------------------------------------------------------- */
/*  Global hotkey                                                             */
/* -------------------------------------------------------------------------- */

function registerShortcut() {
  const ok = applyHotkey(HOTKEY);
  if (!ok) {
    notify(
      "Hotkey unavailable",
      `${HOTKEY} is already taken by another app. Circle to Lens will only work via the tray menu — change the combo in Settings.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Tray icon                                                                 */
/* -------------------------------------------------------------------------- */

function buildTray() {
  // Prefer the SVG-rendered brand icon; fall back to the procedural
  // 32×32 RGB lens if the SVG render came back empty for some reason.
  let icon;
  if (APP_ICON && !APP_ICON.isEmpty()) {
    icon = APP_ICON.resize({ width: 32, height: 32, quality: "best" });
  } else {
    icon = makeTrayIcon();
  }
  tray = new Tray(icon);
  // Windows 11 shows this title when the user hovers / searches.
  if (process.platform === "win32") {
    try {
      tray.setTitle("Circle to Lens");
    } catch (_) {
      /* setTitle is a no-op on Windows but won't throw */
    }
  }
  refreshTrayMenu();
  // Left-click opens the home window — more discoverable than firing
  // a capture, which can surprise users.
  tray.on("click", openHome);
  // Double-click is the fast-path power user shortcut.
  tray.on("double-click", activateLasso);
}

/**
 * Rebuilds the tray context menu using the *current* HOTKEY value.
 * Called on boot and again any time the user changes the hotkey in
 * Settings, so the menu label always matches the active combo.
 */
function refreshTrayMenu() {
  if (!tray) return;
  const trayHint =
    process.platform === "darwin"
      ? "Click to open · Right-click for menu"
      : "Click to open · Right-click for menu";
  tray.setToolTip(`Circle to Lens — ${HOTKEY}\n${trayHint}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Capture now  (${HOTKEY})`, click: activateLasso },
      { type: "separator" },
      { label: "Open Circle to Lens…", click: openHome },
      { label: "Settings…", click: openSettings },
      { type: "separator" },
      { label: "Quit Circle to Lens", click: () => app.exit(0) },
    ]),
  );
}

/**
 * macOS application menu with standard shortcuts (⌘Q, ⌘,, etc.).
 */
function buildAppMenu() {
  if (process.platform !== "darwin") return;
  refreshAppMenu();
}

function refreshAppMenu() {
  if (process.platform !== "darwin") return;
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Capture Now",
          accelerator: HOTKEY,
          click: activateLasso,
        },
        { label: "Open Home", click: openHome },
        {
          label: "Settings…",
          accelerator: "Command+,",
          click: openSettings,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Capture",
      submenu: [
        {
          label: "Capture Now",
          accelerator: HOTKEY,
          click: activateLasso,
        },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "Command+,",
          click: openSettings,
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Builds a 32×32 tray icon at runtime: a vivid RGB-gradient ring with
 * a white inner core and a magnifying-glass "tail". 32 px reads MUCH
 * better than 16 px on modern HiDPI Windows 11 taskbars; the colorful
 * conic gradient is unmistakeable in the overflow tray.
 *
 * We render via OffscreenCanvas-style pixel writes in pure JS so no
 * external asset / asar lookup is needed (the icon survives any
 * packaging path).
 */
function makeTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4); // RGBA

  // Lens-disc geometry
  const cx = 13;
  const cy = 13;
  const rOuter = 11;
  const rInner = 7;
  const rCore = 4;

  // Magnifying-glass handle: a short white line from (20, 20) → (29, 29).
  const handle = { x1: 20, y1: 20, x2: 28, y2: 28, w: 2.6 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r = 0, g = 0, b = 0, a = 0;

      if (dist <= rOuter) {
        if (dist <= rCore) {
          // Bright white core (the "lens glass")
          r = 255; g = 255; b = 255; a = 255;
        } else if (dist <= rInner) {
          // Soft inner highlight
          r = 250; g = 250; b = 255; a = 230;
        } else {
          // RGB ring — hue from angle
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
          const [hr, hg, hb] = hsl2rgb(angle, 1, 0.55);
          r = hr; g = hg; b = hb; a = 255;
        }
      } else {
        // Handle
        const d = distToSegment(x + 0.5, y + 0.5, handle);
        if (d <= handle.w / 2) {
          r = 255; g = 255; b = 255; a = 255;
        } else if (d <= handle.w / 2 + 0.8) {
          const t = (handle.w / 2 + 0.8 - d) / 0.8;
          r = 255; g = 255; b = 255; a = Math.round(255 * t);
        }
      }

      buf[idx + 0] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }

  return nativeImage.createFromBuffer(buf, {
    width: size,
    height: size,
    scaleFactor: 1,
  });
}

function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function distToSegment(px, py, seg) {
  const { x1, y1, x2, y2 } = seg;
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const sx = x1 + t * dx, sy = y1 + t * dy;
  return Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
}

/* -------------------------------------------------------------------------- */
/*  Home window                                                               */
/* -------------------------------------------------------------------------- */

function openHome() {
  if (homeWin && !homeWin.isDestroyed()) {
    homeWin.show();
    homeWin.focus();
    return;
  }
  homeWin = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 520,
    minHeight: 600,
    title: "Circle to Lens",
    icon: APP_ICON || undefined,
    backgroundColor: "#0c0d12",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "home", "preload.js"),
    },
  });
  homeWin.loadFile(path.join(__dirname, "home", "index.html"));
  homeWin.once("ready-to-show", () => {
    homeWin.show();
    homeWin.focus();
  });
  homeWin.on("closed", () => {
    homeWin = null;
  });
}

ipcMain.handle("home:get-meta", () => ({
  version: app.getVersion(),
  hotkey: HOTKEY,
  packaged: app.isPackaged,
  platform: process.platform,
}));

ipcMain.on("home:capture", () => {
  // Hide home so the lasso is unobstructed, but keep it alive — the
  // user almost certainly wants to come back to it.
  if (homeWin && !homeWin.isDestroyed()) homeWin.hide();
  activateLasso();
});

ipcMain.on("home:open-settings", () => {
  openSettings();
});

ipcMain.handle("home:set-autostart", (_e, enabled) => {
  try {
    settingsStore.write({ startWithWindows: !!enabled });
    applyAutoStart(!!enabled);
    return true;
  } catch (err) {
    console.warn("[home] set-autostart failed:", err?.message || err);
    return false;
  }
});

ipcMain.handle("home:set-show-home-on-startup", (_e, enabled) => {
  try {
    settingsStore.write({ showHomeOnStartup: !!enabled });
    return true;
  } catch (err) {
    console.warn("[home] set-show-home-on-startup failed:", err?.message || err);
    return false;
  }
});

ipcMain.handle("home:check-shortcut", () => {
  if (process.platform === "darwin") {
    return macShortcuts.check();
  }
  if (process.platform !== "win32") return false;
  const appdata = process.env.APPDATA || "";
  if (!appdata) return false;
  const lnk = path.join(
    appdata,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Circle to Lens.lnk",
  );
  try {
    return fs.existsSync(lnk);
  } catch (_) {
    return false;
  }
});

ipcMain.handle("home:recreate-shortcut", async () => {
  try {
    if (process.platform === "darwin") {
      const result = await macShortcuts.ensure({ force: true, hotkey: HOTKEY });
      return !!result || macShortcuts.check();
    }
    const result = await startMenuShortcut.ensure();
    return !!result;
  } catch (err) {
    console.warn("[home] recreate-shortcut failed:", err?.message || err);
    return false;
  }
});

ipcMain.on("home:close", () => {
  if (homeWin && !homeWin.isDestroyed()) homeWin.close();
});

/* -------------------------------------------------------------------------- */
/*  Settings window                                                           */
/* -------------------------------------------------------------------------- */

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    title: "Circle to Lens — Settings",
    icon: APP_ICON || undefined,
    backgroundColor: "#0c0d12",
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "settings", "preload.js"),
    },
  });
  settingsWin.loadFile(path.join(__dirname, "settings", "index.html"));
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

ipcMain.handle("settings:read", () => settingsStore.read());
ipcMain.handle("settings:write", (_e, patch) => {
  const before = settingsStore.read();
  const merged = settingsStore.write(patch || {});

  // If the hotkey changed, try to re-register on the spot. On
  // failure, roll the persisted value back so the UI shows the
  // currently-active combo and the captured one in the input clears.
  if (patch && Object.prototype.hasOwnProperty.call(patch, "hotkey")) {
    const requested = merged.hotkey;
    if (requested && requested !== before.hotkey) {
      const ok = applyHotkey(requested);
      if (!ok) {
        const reverted = settingsStore.write({ hotkey: before.hotkey });
        applyHotkey(before.hotkey); // make sure something is registered
        return {
          ...reverted,
          hotkeyError: `Could not register “${requested}” — that combo may be taken by another app.`,
        };
      }
    }
  }
  return merged;
});
ipcMain.on("settings:close", () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

/**
 * Try to register `accel` as the global hotkey. On success, updates
 * the module-level HOTKEY constant and refreshes the tray label so
 * the menu shows the new combo immediately.
 *
 * @returns {boolean} true if registration succeeded
 */
function applyHotkey(accel) {
  if (!accel) return false;
  // Unregister whatever we had before so we don't leak stale bindings
  // when the user cycles through combos in the Settings window.
  try {
    globalShortcut.unregisterAll();
  } catch (_) {
    /* no-op */
  }
  const ok = globalShortcut.register(accel, activateLasso);
  if (ok) {
    HOTKEY = accel;
    refreshTrayMenu();
    refreshAppMenu();
    macShortcuts.ensure({ hotkey: HOTKEY, force: true }).catch(() => undefined);
    console.log(`[main] Global hotkey now: ${HOTKEY}`);
  } else {
    console.warn(`[main] Failed to register hotkey ${accel}`);
  }
  return ok;
}

/* -------------------------------------------------------------------------- */
/*  Auto-launch on Windows login                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mirror the persisted `startWithWindows` flag into Electron's
 * `setLoginItemSettings`. We pass `path` + `args` explicitly so dev
 * runs (where the launcher is electron.exe + the app dir) also work.
 */
function applyAutoStart(enabled) {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  try {
    const opts = { openAtLogin: !!enabled };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [app.getAppPath()];
    }
    if (process.platform === "darwin") {
      opts.openAsHidden = true;
    }
    app.setLoginItemSettings(opts);
  } catch (err) {
    console.warn("[main] applyAutoStart failed:", err?.message || err);
  }
}

/* -------------------------------------------------------------------------- */
/*  Lasso activation                                                          */
/* -------------------------------------------------------------------------- */

async function activateLasso() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.focus();
    return;
  }
  try {
    const captured = await captureScreen();
    openOverlay(captured);
  } catch (err) {
    console.error("[main] activateLasso failed:", err);
    notify("Circle to Lens", "Couldn't capture the screen: " + (err?.message || err));
  }
}

async function captureScreen() {
  const { x, y } = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint({ x, y });
  const sf = display.scaleFactor || 1;
  const w = Math.round(display.size.width * sf);
  const h = Math.round(display.size.height * sf);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: w, height: h },
  });

  const wanted = String(display.id);
  const src = sources.find((s) => s.display_id === wanted) || sources[0];
  if (!src) throw new Error("No screen source available");

  return {
    dataUrl: src.thumbnail.toDataURL(),
    display: {
      id: display.id,
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.size.width,
      height: display.size.height,
      scaleFactor: sf,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Overlay window                                                            */
/* -------------------------------------------------------------------------- */

function openOverlay({ dataUrl, display }) {
  overlayWin = new BrowserWindow({
    x: display.x,
    y: display.y,
    width: display.width,
    height: display.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  overlayWin.setIgnoreMouseEvents(false);
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWin.loadFile(path.join(__dirname, "overlay", "index.html"));

  overlayWin.once("ready-to-show", () => {
    overlayWin.show();
    overlayWin.focus();
    const settings = settingsStore.read();
    overlayWin.webContents.send("overlay:init", { dataUrl, display, settings });
  });

  overlayWin.on("closed", () => {
    overlayWin = null;
  });

  setTimeout(() => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
  }, 60_000);
}

/* -------------------------------------------------------------------------- */
/*  IPC: receive cropped image, hand off to default browser                   */
/* -------------------------------------------------------------------------- */

ipcMain.handle("overlay:submit", async (_e, payload) => {
  const { imageDataUrl } = payload || {};
  if (!imageDataUrl) return { ok: false, error: "no image" };

  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();

  const settings = settingsStore.read();

  try {
    const { file, mode } = await submitToLens(imageDataUrl, settings);
    console.log("[main] handed off via", file, "(mode:", mode + ")");
    notify(
      "Opening Google Lens",
      mode === "window"
        ? "Result is opening in a docked browser window."
        : "Result is opening in your default browser tab.",
    );
    return { ok: true };
  } catch (err) {
    console.error("[main] submitToLens failed:", {
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
    notify("Lens search failed", err?.message || String(err));
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.on("overlay:cancel", () => {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function notify(title, body) {
  try {
    new Notification({ title, body, silent: true }).show();
  } catch (_) {
    /* notifications can fail on locked-down systems — ignore */
  }
}
