/**
 * Circle to Lens — Home window preload.
 *
 * Exposes a sandboxed `window.c2lHome` bridge:
 *   - getMeta()              → { version, hotkey }
 *   - getSettings()          → current persisted settings
 *   - capture()              → trigger the lasso right now
 *   - openSettings()         → open the Settings window
 *   - setStartWithWindows(b) → toggle auto-launch on Windows login
 *   - checkShortcut()        → true if Start-menu .lnk is present
 *   - recreateShortcut()     → force re-create the .lnk
 *   - close()                → close this Home window
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("c2lHome", {
  getMeta() {
    return ipcRenderer.invoke("home:get-meta");
  },
  getSettings() {
    return ipcRenderer.invoke("settings:read");
  },
  capture() {
    ipcRenderer.send("home:capture");
  },
  openSettings() {
    ipcRenderer.send("home:open-settings");
  },
  setStartWithWindows(enabled) {
    return ipcRenderer.invoke("home:set-autostart", !!enabled);
  },
  setShowHomeOnStartup(enabled) {
    return ipcRenderer.invoke("home:set-show-home-on-startup", !!enabled);
  },
  checkShortcut() {
    return ipcRenderer.invoke("home:check-shortcut");
  },
  recreateShortcut() {
    return ipcRenderer.invoke("home:recreate-shortcut");
  },
  close() {
    ipcRenderer.send("home:close");
  },
});
