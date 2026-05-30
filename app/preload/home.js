/**
 * Circle to Lens — Home window preload.
 *
 * Exposes a sandboxed `window.c2lHome` bridge:
 *   - getMeta()              → { version, hotkey, packaged, platform }
 *   - getSettings()          → current persisted settings
 *   - capture()              → trigger the lasso right now
 *   - openSettings()         → open the Settings window
 *   - setStartWithWindows(b) → toggle auto-launch on Windows login
 *   - setShowHomeOnStartup(b)
 *   - checkShortcut()        → true if Start-menu .lnk is present
 *   - recreateShortcut()     → force re-create the .lnk
 *   - close()                → close this Home window
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { HOME, SETTINGS } = require("../shared/ipc-channels");

contextBridge.exposeInMainWorld("c2lHome", {
  getMeta() {
    return ipcRenderer.invoke(HOME.GET_META);
  },
  getSettings() {
    return ipcRenderer.invoke(SETTINGS.READ);
  },
  capture() {
    ipcRenderer.send(HOME.CAPTURE);
  },
  openSettings() {
    ipcRenderer.send(HOME.OPEN_SETTINGS);
  },
  setStartWithWindows(enabled) {
    return ipcRenderer.invoke(HOME.SET_AUTOSTART, !!enabled);
  },
  setShowHomeOnStartup(enabled) {
    return ipcRenderer.invoke(HOME.SET_SHOW_HOME_ON_STARTUP, !!enabled);
  },
  checkShortcut() {
    return ipcRenderer.invoke(HOME.CHECK_SHORTCUT);
  },
  recreateShortcut() {
    return ipcRenderer.invoke(HOME.RECREATE_SHORTCUT);
  },
  close() {
    ipcRenderer.send(HOME.CLOSE);
  },
});
