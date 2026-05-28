/**
 * Circle to Lens — settings window preload.
 *
 * Exposes a tiny `window.c2lSettings` bridge:
 *   - read()        → current settings object
 *   - write(patch)  → merge patch into stored settings, returns merged
 *   - close()       → close the settings window
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("c2lSettings", {
  read() {
    return ipcRenderer.invoke("settings:read");
  },
  write(patch) {
    return ipcRenderer.invoke("settings:write", patch);
  },
  close() {
    ipcRenderer.send("settings:close");
  },
});
