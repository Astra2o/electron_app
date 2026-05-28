/**
 * Circle to Lens — preload bridge for the overlay renderer.
 *
 * Exposes a tiny, sandboxed API to the overlay page so it can:
 *   - Receive the captured screen image + display metadata + the
 *     user's persisted settings from main.
 *   - Submit the cropped selection back to main (which runs the upload).
 *   - Cancel the overlay (Esc).
 *
 * Everything else (Node, fs, etc.) stays out of the renderer.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lens", {
  /**
   * Subscribe to the initial payload from main:
   *   { dataUrl, display: { id, x, y, width, height, scaleFactor },
   *     settings: { pencilStyle, convertToRect, openMode, ... } }
   *
   * Returns an unsubscribe function.
   */
  onInit(callback) {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("overlay:init", listener);
    return () => ipcRenderer.removeListener("overlay:init", listener);
  },

  /**
   * Submit a cropped PNG (base64 data URL) for Lens upload.
   * Resolves to { ok, url? , error? }.
   */
  submit(imageDataUrl) {
    return ipcRenderer.invoke("overlay:submit", { imageDataUrl });
  },

  /** Close the overlay without submitting. */
  cancel() {
    ipcRenderer.send("overlay:cancel");
  },
});
