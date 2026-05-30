/**
 * Circle to Lens — SVG → PNG icon renderer.
 *
 * Electron's `nativeImage` doesn't load SVG files for tray icons on
 * Windows. We work around it by spinning up a hidden BrowserWindow,
 * drawing the SVG into a canvas, and reading the canvas back as PNG
 * bytes — exactly what `nativeImage.createFromBuffer()` wants.
 *
 * Only one render call happens per app launch (size = 256). All
 * the smaller sizes the tray needs are derived via
 * `nativeImage.resize()`, which is cheap and stays crisp because
 * we're scaling DOWN from a vector source.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, nativeImage } = require("electron");

// The canonical brand SVG. Lives under the home renderer because
// the Home window also displays it; we just re-use it for the tray.
const SVG_PATH = path.resolve(
  __dirname,
  "..", "..", "renderer", "home", "icon.svg",
);

/** @type {Electron.NativeImage | null} */
let cachedHi = null;

/**
 * Returns a 256×256 NativeImage of the brand icon. Resolves to a
 * procedurally-built fallback NativeImage if rendering fails (we
 * never want a missing icon to take down the tray).
 */
async function getAppIcon() {
  if (cachedHi) return cachedHi;
  try {
    const buf = await renderSvgToPngBuffer(256);
    cachedHi = nativeImage.createFromBuffer(buf);
    return cachedHi;
  } catch (err) {
    console.warn(
      "[icon] SVG render failed, falling back to empty image:",
      err?.message || err,
    );
    cachedHi = nativeImage.createEmpty();
    return cachedHi;
  }
}

/**
 * Render the on-disk brand SVG into a PNG buffer of the given
 * square size. Hidden BrowserWindow approach — no native deps, no
 * external converter, works on Windows where nativeImage refuses
 * SVG.
 *
 * @param {number} size  pixel size of the resulting square PNG
 * @returns {Promise<Buffer>}
 */
function renderSvgToPngBuffer(size) {
  return new Promise((resolve, reject) => {
    let svg;
    try {
      svg = fs.readFileSync(SVG_PATH, "utf8");
    } catch (e) {
      reject(new Error(`Couldn't read icon.svg: ${e.message}`));
      return;
    }
    const svgB64 = Buffer.from(svg, "utf8").toString("base64");

    const win = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let settled = false;
    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch (_) {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(buf);
    };

    const timer = setTimeout(
      () => finish(new Error("icon render timed out")),
      15_000,
    );

    win.webContents.once("did-finish-load", async () => {
      try {
        const script = `
          new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
              try {
                var c = document.createElement('canvas');
                c.width = ${size};
                c.height = ${size};
                var ctx = c.getContext('2d');
                ctx.clearRect(0, 0, ${size}, ${size});
                ctx.drawImage(img, 0, 0, ${size}, ${size});
                resolve(c.toDataURL('image/png'));
              } catch (e) {
                reject(new Error('canvas draw failed: ' + (e && e.message || e)));
              }
            };
            img.onerror = function () {
              reject(new Error('SVG image load failed'));
            };
            img.src = 'data:image/svg+xml;base64,${svgB64}';
          })
        `;
        const dataUrl = await win.webContents.executeJavaScript(script, true);
        const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || "");
        if (!m) {
          finish(new Error("renderer returned a malformed PNG data URL"));
          return;
        }
        const buf = Buffer.from(m[1], "base64");
        const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (buf.length < SIG.length || !buf.slice(0, SIG.length).equals(SIG)) {
          finish(new Error("decoded buffer is not a valid PNG"));
          return;
        }
        finish(null, buf);
      } catch (e) {
        finish(e);
      }
    });

    win.loadURL("about:blank").catch((e) => finish(e));
  });
}

module.exports = { getAppIcon, renderSvgToPngBuffer };
