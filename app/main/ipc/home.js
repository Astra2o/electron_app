/**
 * Circle to Lens — Home-window IPC channels.
 *
 * Every channel the Home renderer can invoke or send. Most of these
 * delegate to the relevant service so this module stays glue-only.
 */

"use strict";

const fs = require("node:fs");
const { app, ipcMain } = require("electron");

const settingsStore = require("../store/settings");
const autoLaunch = require("../services/auto-launch");
const startMenuShortcut = require("../services/start-menu-shortcut");
const hotkey = require("../services/hotkey");
const homeWindow = require("../windows/home");
const settingsWindow = require("../windows/settings");
const { HOME } = require("../../shared/ipc-channels");

/**
 * @param {() => void} onCapture  fires when the Home renderer asks
 *                                 us to trigger a screen capture
 *                                 right now ("Capture" button).
 */
function register({ onCapture }) {
  ipcMain.handle(HOME.GET_META, () => ({
    version:  app.getVersion(),
    hotkey:   hotkey.current(),
    packaged: app.isPackaged,
    platform: process.platform,
  }));

  ipcMain.on(HOME.CAPTURE, () => {
    // Hide Home so the lasso is unobstructed, but keep it alive —
    // the user almost certainly wants to come back to it.
    homeWindow.hide();
    if (typeof onCapture === "function") onCapture();
  });

  ipcMain.on(HOME.OPEN_SETTINGS, () => {
    settingsWindow.open();
  });

  ipcMain.handle(HOME.SET_AUTOSTART, (_e, enabled) => {
    try {
      settingsStore.write({ startWithWindows: !!enabled });
      autoLaunch.apply(!!enabled);
      return true;
    } catch (err) {
      console.warn(
        "[ipc/home] set-autostart failed:",
        err?.message || err,
      );
      return false;
    }
  });

  ipcMain.handle(HOME.SET_SHOW_HOME_ON_STARTUP, (_e, enabled) => {
    try {
      settingsStore.write({ showHomeOnStartup: !!enabled });
      return true;
    } catch (err) {
      console.warn(
        "[ipc/home] set-show-home-on-startup failed:",
        err?.message || err,
      );
      return false;
    }
  });

  ipcMain.handle(HOME.CHECK_SHORTCUT, () => {
    if (process.platform !== "win32") return false;
    const lnk = startMenuShortcut.shortcutLnkPath();
    try {
      return fs.existsSync(lnk);
    } catch (_) {
      return false;
    }
  });

  ipcMain.handle(HOME.RECREATE_SHORTCUT, async () => {
    try {
      const result = await startMenuShortcut.ensure();
      return !!result;
    } catch (err) {
      console.warn(
        "[ipc/home] recreate-shortcut failed:",
        err?.message || err,
      );
      return false;
    }
  });

  ipcMain.on(HOME.CLOSE, () => homeWindow.close());
}

module.exports = { register };
