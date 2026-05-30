/**
 * Circle to Lens — overlay IPC channels.
 *
 * Every channel the overlay renderer can invoke or send lives
 * here:
 *
 *   submit            crop  →  Lens upload
 *   cancel            close the overlay
 *   ocr               crop  →  text
 *   ocr-fullscreen    whole screen  →  { text, lines: [{ text, bbox }] }
 *   translate         text  →  translated text + provider info
 *   translate-batch   text[]  →  translated text[]
 *   set-translate-target   persist user's language pick
 *   copy-text         text  →  system clipboard
 */

"use strict";

const { ipcMain, clipboard } = require("electron");

const settingsStore = require("../store/settings");
const { ocrImage, ocrFullscreen } = require("../services/ocr");
const { translateText, translateBatch } = require("../services/translator");
const { submitToLens } = require("../services/lens-uploader");
const { notify } = require("../services/notifier");
const overlayWindow = require("../windows/overlay");
const { OVERLAY } = require("../../shared/ipc-channels");

function register() {
  /* -------- Lens submit ----------------------------------------- */
  ipcMain.handle(OVERLAY.SUBMIT, async (_e, payload) => {
    const { imageDataUrl } = payload || {};
    if (!imageDataUrl) return { ok: false, error: "no image" };
    overlayWindow.close();
    const settings = settingsStore.read();
    try {
      const { file, mode } = await submitToLens(imageDataUrl, settings);
      console.log("[ipc/overlay] handed off via", file, "(mode:", mode + ")");
      notify(
        "Opening Google Lens",
        mode === "window"
          ? "Result is opening in a docked browser window."
          : "Result is opening in your default browser tab.",
      );
      return { ok: true };
    } catch (err) {
      console.error("[ipc/overlay] submitToLens failed:", {
        message: err?.message,
        code: err?.code,
      });
      notify("Lens search failed", err?.message || String(err));
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /* -------- Esc / cancel --------------------------------------- */
  ipcMain.on(OVERLAY.CANCEL, () => overlayWindow.close());

  /* -------- OCR (cropped) -------------------------------------- */
  ipcMain.handle(OVERLAY.OCR, async (_e, payload) => {
    const { imageDataUrl } = payload || {};
    try {
      const text = await ocrImage(imageDataUrl);
      return { ok: true, text };
    } catch (err) {
      console.error("[ipc/overlay] OCR failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /* -------- OCR (full-screen, with bboxes) --------------------- */
  ipcMain.handle(OVERLAY.OCR_FULLSCREEN, async (_e, payload) => {
    const { imageDataUrl } = payload || {};
    try {
      const result = await ocrFullscreen(imageDataUrl);
      return { ok: true, ...result };
    } catch (err) {
      console.error("[ipc/overlay] OCR-fullscreen failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /* -------- Translate (single) --------------------------------- */
  ipcMain.handle(OVERLAY.TRANSLATE, async (_e, payload) => {
    const { text, target } = payload || {};
    try {
      const result = await translateText(text, target);
      if (target) settingsStore.write({ translateTo: target });
      return { ok: true, ...result };
    } catch (err) {
      console.error("[ipc/overlay] translate failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /* -------- Translate (batch, parallel) ------------------------ */
  ipcMain.handle(OVERLAY.TRANSLATE_BATCH, async (_e, payload) => {
    const { texts, target } = payload || {};
    try {
      const result = await translateBatch(texts, target);
      if (target) settingsStore.write({ translateTo: target });
      return { ok: true, ...result };
    } catch (err) {
      console.error("[ipc/overlay] translate-batch failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /* -------- Persist language pick (no translate yet) ----------- */
  ipcMain.handle(OVERLAY.SET_TRANSLATE_TARGET, (_e, target) => {
    try {
      if (typeof target === "string" && target) {
        const merged = settingsStore.write({ translateTo: target });
        return { ok: true, translateTo: merged.translateTo };
      }
      return { ok: false, error: "invalid target" };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /* -------- Copy to system clipboard --------------------------- */
  ipcMain.handle(OVERLAY.COPY_TEXT, (_e, payload) => {
    const text = payload?.text;
    if (typeof text !== "string" || !text) {
      return { ok: false, error: "no text" };
    }
    try {
      clipboard.writeText(text);
      return { ok: true, length: text.length };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

module.exports = { register };
