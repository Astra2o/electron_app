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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.resolve(__dirname, "..", "..", "preload", "settings.js"),
    },
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
