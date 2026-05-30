/**
 * Circle to Lens — system tray service.
 *
 * Builds the tray icon + context menu and exposes a `refreshMenu()`
 * call the hotkey/settings layers use whenever the displayed combo
 * needs to update.
 *
 * The tray icon is rasterised from the brand SVG at boot (see
 * `icon-renderer.js`). If that render fails for any reason we fall
 * back to a procedurally-drawn 32×32 RGB-gradient lens so the user
 * still sees a brand mark in the tray, not an empty square.
 */

"use strict";

const { app, Menu, Tray, nativeImage } = require("electron");

const { PRODUCT_NAME } = require("../../shared/constants");

/** @type {Tray | null} */
let _tray = null;
let _icon = null;
let _handlers = {
  onLeftClick: () => {},
  onDoubleClick: () => {},
  onOpenHome: () => {},
  onOpenSettings: () => {},
  getHotkey: () => "Alt+Shift+S",
};

/**
 * @param {Electron.NativeImage|null} brandIcon
 * @param {{
 *   onLeftClick: () => void,
 *   onDoubleClick: () => void,
 *   onOpenHome: () => void,
 *   onOpenSettings: () => void,
 *   getHotkey: () => string,
 * }} handlers
 */
function build(brandIcon, handlers) {
  _handlers = { ..._handlers, ...handlers };

  if (brandIcon && !brandIcon.isEmpty()) {
    _icon = brandIcon.resize({ width: 32, height: 32, quality: "best" });
  } else {
    _icon = makeFallbackIcon();
  }
  _tray = new Tray(_icon);

  if (process.platform === "win32") {
    try { _tray.setTitle(PRODUCT_NAME); } catch (_) { /* no-op */ }
  }
  refreshMenu();

  _tray.on("click", _handlers.onLeftClick);
  _tray.on("double-click", _handlers.onDoubleClick);
}

/** Rebuilds the context menu so the hotkey label stays current. */
function refreshMenu() {
  if (!_tray) return;
  const hk = _handlers.getHotkey();
  _tray.setToolTip(
    `${PRODUCT_NAME} — ${hk}\nClick to open · Right-click for menu`,
  );
  _tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Capture now  (${hk})`, click: _handlers.onDoubleClick },
      { type: "separator" },
      { label: `Open ${PRODUCT_NAME}…`, click: _handlers.onOpenHome },
      { label: "Settings…", click: _handlers.onOpenSettings },
      { type: "separator" },
      { label: `Quit ${PRODUCT_NAME}`, click: () => app.exit(0) },
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/*  Procedural fallback icon                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds a 32×32 tray icon at runtime: a vivid RGB-gradient ring
 * with a white inner core and a magnifying-glass "tail". Used only
 * when the SVG render came back empty.
 */
function makeFallbackIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4); // RGBA

  const cx = 13;
  const cy = 13;
  const rOuter = 11;
  const rInner = 7;
  const rCore = 4;

  // Magnifying-glass handle: a short white line from (20, 20) → (28, 28).
  const handle = { x1: 20, y1: 20, x2: 28, y2: 28, w: 2.6 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r = 0, g = 0, b = 0, a = 0;

      if (dist <= rOuter) {
        if (dist <= rCore) {
          r = 255; g = 255; b = 255; a = 255;
        } else if (dist <= rInner) {
          r = 250; g = 250; b = 255; a = 230;
        } else {
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
          const [hr, hg, hb] = hsl2rgb(angle, 1, 0.55);
          r = hr; g = hg; b = hb; a = 255;
        }
      } else {
        const d = distToSegment(x + 0.5, y + 0.5, handle);
        if (d <= handle.w / 2) {
          r = 255; g = 255; b = 255; a = 255;
        } else if (d <= handle.w / 2 + 0.8) {
          const t = (handle.w / 2 + 0.8 - d) / 0.8;
          r = 255; g = 255; b = 255; a = Math.round(255 * t);
        }
      }

      buf[idx + 0] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }

  return nativeImage.createFromBuffer(buf, {
    width: size,
    height: size,
    scaleFactor: 1,
  });
}

function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function distToSegment(px, py, seg) {
  const { x1, y1, x2, y2 } = seg;
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)),
  );
  const sx = x1 + t * dx, sy = y1 + t * dy;
  return Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
}

module.exports = { build, refreshMenu };
