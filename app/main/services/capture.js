/**
 * Circle to Lens — screen capture service.
 *
 * Wraps Electron's `desktopCapturer` so the rest of the app gets a
 * clean `{ dataUrl, display }` payload without caring about
 * scale-factor maths or finding the right source for a multi-
 * monitor setup.
 */

"use strict";

const { desktopCapturer, screen } = require("electron");

/**
 * Capture the display the cursor is currently on. Returns the
 * PNG as a data URL plus the display's geometry — both needed by
 * the overlay so it can size itself to cover exactly that monitor
 * and convert OCR image-pixel bboxes back to CSS pixels.
 *
 * @returns {Promise<{ dataUrl: string, display: {
 *   id: number, x: number, y: number,
 *   width: number, height: number, scaleFactor: number,
 * } }>}
 */
async function captureCursorDisplay() {
  const { x, y } = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint({ x, y });
  const sf = display.scaleFactor || 1;
  const w = Math.round(display.size.width * sf);
  const h = Math.round(display.size.height * sf);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: w, height: h },
  });

  const wanted = String(display.id);
  const src = sources.find((s) => s.display_id === wanted) || sources[0];
  if (!src) throw new Error("No screen source available");

  return {
    dataUrl: src.thumbnail.toDataURL(),
    display: {
      id: display.id,
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.size.width,
      height: display.size.height,
      scaleFactor: sf,
    },
  };
}

module.exports = { captureCursorDisplay };
