/**
 * Circle to Lens — Settings window factory.
 *
 * Loads the settings renderer with the per-window preload bridge.
 * Single-instance like the Home window.
 */

"use strict";

const path = require("node:path");
const { BrowserWindow } = require("electron");

const { PRODUCT_NAME } = require("../../shared/constants");

/** @type {BrowserWindow | null} */
let _win = null;

function open(appIcon) {
  if (_win && !_win.isDestroyed()) {
    _win.show();
    _win.focus();
    return _win;
  }
  _win = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    title: `${PRODUCT_NAME} — Settings`,
    icon: appIcon || undefined,
    backgroundColor: "#0c0d12",
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      // See `home.js` for the rationale on `sandbox: false` — required
      // because our preloads require("../shared/ipc-channels"), which
      // the Electron sandbox blocks. Defaults to true in Electron 20+,
      // so it must be set explicitly.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.resolve(__dirname, "..", "..", "preload", "settings.js"),
    },
  });

  // Show on `ready-to-show`, but force-show after a short timeout
  // as a safety net in case that event never arrives (load / preload
  // failure). Better a blank window the user can see and close than a
  // ghost window stuck invisible.
  let shown = false;
  const showOnce = () => {
    if (shown) return;
    shown = true;
    try {
      _win.show();
      _win.focus();
      _win.moveTop();
    } catch (_) {}
  };
  _win.once("ready-to-show", showOnce);
  setTimeout(showOnce, 1500);

  // Surface load / preload failures to the main-process console so
  // a broken Settings window never fails silently.
  _win.webContents.on(
    "did-fail-load",
    (_e, errCode, errDesc, url, isMainFrame) => {
      console.error(
        "[settings-window] did-fail-load:",
        { errCode, errDesc, url, isMainFrame },
      );
    },
  );
  _win.webContents.on("preload-error", (_e, file, error) => {
    console.error("[settings-window] preload-error:", file, error);
  });
  _win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[settings-window] render-process-gone:", details);
  });

  _win.loadFile(
    path.resolve(__dirname, "..", "..", "renderer", "settings", "index.html"),
  );

  _win.on("closed", () => {
    _win = null;
  });
  return _win;
}

function close() {
  if (_win && !_win.isDestroyed()) _win.close();
}

module.exports = { open, close };
