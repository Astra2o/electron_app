/**
 * Circle to Lens — Overlay window factory.
 *
 * The full-screen transparent lasso overlay. Sized to exactly cover
 * the display the cursor is on, then bumped into "simple
 * fullscreen" mode so the Windows taskbar slides under us (otherwise
 * the taskbar renders ABOVE `alwaysOnTop: "screen-saver"` on
 * Win11 and the user sees both the captured-screenshot taskbar
 * pixels AND the live taskbar side-by-side).
 *
 * The overlay is single-shot: it self-destructs on submit / Esc, or
 * after the safety timeout below.
 */

"use strict";

const path = require("node:path");
const { BrowserWindow } = require("electron");

const settingsStore = require("../store/settings");
const { OVERLAY } = require("../../shared/ipc-channels");

/** Auto-close timeout — if the user wanders away from a half-drawn
 *  capture, the window self-destructs in 60 s. */
const SAFETY_TIMEOUT_MS = 60_000;

/** @type {BrowserWindow | null} */
let _win = null;

/**
 * Opens the overlay for a freshly-captured screen.
 *
 * @param {{
 *   dataUrl: string,
 *   display: { id: number, x: number, y: number, width: number, height: number, scaleFactor: number },
 * }} captured
 * @returns {BrowserWindow}
 */
function open({ dataUrl, display }) {
  // If somehow an overlay is already up, focus + bail.
  if (_win && !_win.isDestroyed()) {
    _win.focus();
    return _win;
  }

  _win = new BrowserWindow({
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
    // Needs to be true so `setSimpleFullScreen()` below is allowed
    // to flip the window into simple-fullscreen mode and push the
    // Windows taskbar out of the way.
    fullscreenable: true,
    // macOS no-op equivalent of the setSimpleFullScreen call we
    // make after ready-to-show on Windows — keeps behaviour
    // parallel across platforms if this ever ships to Mac.
    simpleFullscreen: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.resolve(__dirname, "..", "..", "preload", "overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  _win.setIgnoreMouseEvents(false);
  _win.setAlwaysOnTop(true, "screen-saver");
  _win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  _win.loadFile(
    path.resolve(__dirname, "..", "..", "renderer", "overlay", "index.html"),
  );

  _win.once("ready-to-show", () => {
    _win.show();
    _win.focus();

    // Hide the Windows taskbar while the lasso is up. See big
    // comment at top of file for why this is needed even though
    // the overlay geometry already covers display.bounds.
    try {
      _win.setSimpleFullScreen(true);
    } catch (err) {
      console.warn(
        "[overlay] setSimpleFullScreen failed:",
        err?.message || err,
      );
    }

    const settings = settingsStore.read();
    _win.webContents.send(OVERLAY.INIT, { dataUrl, display, settings });
  });

  _win.on("closed", () => {
    _win = null;
  });

  setTimeout(() => {
    if (_win && !_win.isDestroyed()) _win.close();
  }, SAFETY_TIMEOUT_MS);

  return _win;
}

function close() {
  if (_win && !_win.isDestroyed()) _win.close();
}

function isOpen() {
  return !!(_win && !_win.isDestroyed());
}

function focus() {
  if (_win && !_win.isDestroyed()) _win.focus();
}

module.exports = { open, close, isOpen, focus };
