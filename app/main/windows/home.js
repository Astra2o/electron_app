/**
 * Circle to Lens — Home window factory.
 *
 * The Home window is the app's "is this thing on?" surface. Opens
 * automatically on launch (unless the user disabled it), and
 * surfaces the hotkey, quick toggles for autostart, and a button
 * that triggers an immediate capture.
 *
 * Single-instance: re-calling `open()` while the window is alive
 * just focuses it.
 */

"use strict";

const path = require("node:path");
const { BrowserWindow } = require("electron");

const { PRODUCT_NAME } = require("../../shared/constants");

/** @type {BrowserWindow | null} */
let _win = null;

/**
 * @param {Electron.NativeImage|null} appIcon
 * @returns {BrowserWindow}
 */
function open(appIcon) {
  if (_win && !_win.isDestroyed()) {
    _win.show();
    _win.focus();
    return _win;
  }
  _win = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 520,
    minHeight: 600,
    title: PRODUCT_NAME,
    icon: appIcon || undefined,
    backgroundColor: "#0c0d12",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // We deliberately disable the sandbox because our preloads
      // `require("../shared/ipc-channels")` for channel-name
      // constants. Electron's sandbox only permits requiring a tiny
      // built-in whitelist (electron, events, timers, url) — relative
      // requires silently fail with "module not found", leaving the
      // contextBridge unexposed and every button inert.
      //
      // Since Electron 20+ sandbox defaults to TRUE, so it must be
      // explicitly set to false, not just omitted.
      //
      // Context isolation + `nodeIntegration: false` is still the
      // modern security baseline; we never load remote content so the
      // sandbox is overkill here.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.resolve(__dirname, "..", "..", "preload", "home.js"),
    },
  });
  _win.webContents.on(
    "did-fail-load",
    (_e, errCode, errDesc, url, isMainFrame) => {
      console.error(
        "[home-window] did-fail-load:",
        { errCode, errDesc, url, isMainFrame },
      );
    },
  );
  _win.webContents.on("preload-error", (_e, file, error) => {
    console.error("[home-window] preload-error:", file, error);
  });
  _win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[home-window] render-process-gone:", details);
  });

  _win.loadFile(
    path.resolve(__dirname, "..", "..", "renderer", "home", "index.html"),
  );
  _win.once("ready-to-show", () => {
    _win.show();
    _win.focus();
  });
  _win.on("closed", () => {
    _win = null;
  });
  return _win;
}

function hide() {
  if (_win && !_win.isDestroyed()) _win.hide();
}

function close() {
  if (_win && !_win.isDestroyed()) _win.close();
}

function isOpen() {
  return !!(_win && !_win.isDestroyed());
}

module.exports = { open, hide, close, isOpen };
