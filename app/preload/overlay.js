/**
 * Circle to Lens — preload bridge for the overlay renderer.
 *
 * Exposes a tiny, sandboxed API to the overlay page so it can:
 *   - Receive the captured screen image + display metadata + the
 *     user's persisted settings from main.
 *   - Submit the cropped selection back to main (Lens action).
 *   - Run OCR / translation / batch translation.
 *   - Persist the user's last-selected target language.
 *   - Write to the system clipboard.
 *   - Close itself (Esc).
 *
 * Everything else (Node, fs, etc.) stays out of the renderer.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { OVERLAY } = require("../shared/ipc-channels");

contextBridge.exposeInMainWorld("lens", {
  /**
   * Subscribe to the initial payload from main:
   *   { dataUrl, display, settings }
   * Returns an unsubscribe function.
   */
  onInit(callback) {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(OVERLAY.INIT, listener);
    return () => ipcRenderer.removeListener(OVERLAY.INIT, listener);
  },

  /** Submit a cropped PNG for Lens upload. */
  submit(imageDataUrl) {
    return ipcRenderer.invoke(OVERLAY.SUBMIT, { imageDataUrl });
  },

  /** Close the overlay without submitting. */
  cancel() {
    ipcRenderer.send(OVERLAY.CANCEL);
  },

  /** OCR a cropped PNG to text. */
  ocr(imageDataUrl) {
    return ipcRenderer.invoke(OVERLAY.OCR, { imageDataUrl });
  },

  /**
   * Full-screen OCR returning lines with image-pixel bboxes.
   * Resolves to { ok: true, text, lines } or { ok: false, error }.
   */
  ocrFullscreen(imageDataUrl) {
    return ipcRenderer.invoke(OVERLAY.OCR_FULLSCREEN, { imageDataUrl });
  },

  /** Translate one string. */
  translate(text, target) {
    return ipcRenderer.invoke(OVERLAY.TRANSLATE, { text, target });
  },

  /** Translate many strings in parallel. */
  translateBatch(texts, target) {
    return ipcRenderer.invoke(OVERLAY.TRANSLATE_BATCH, { texts, target });
  },

  /** Persist a target-language pick without translating right now. */
  setTranslateTarget(target) {
    return ipcRenderer.invoke(OVERLAY.SET_TRANSLATE_TARGET, target);
  },

  /** Copy a string to the system clipboard. */
  copyText(text) {
    return ipcRenderer.invoke(OVERLAY.COPY_TEXT, { text });
  },
});
