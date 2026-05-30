/**
 * Circle to Lens — settings window preload.
 *
 * Exposes a tiny `window.c2lSettings` bridge:
 *   - read()        → current settings object
 *   - write(patch)  → merge patch into stored settings, returns merged
 *   - close()       → close the settings window
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { SETTINGS } = require("../shared/ipc-channels");

contextBridge.exposeInMainWorld("c2lSettings", {
  read() {
    return ipcRenderer.invoke(SETTINGS.READ);
  },
  write(patch) {
    return ipcRenderer.invoke(SETTINGS.WRITE, patch);
  },
  close() {
    ipcRenderer.send(SETTINGS.CLOSE);
  },
});
