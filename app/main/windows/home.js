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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.resolve(__dirname, "..", "..", "preload", "home.js"),
    },
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
