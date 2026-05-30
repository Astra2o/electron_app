/**
 * Circle to Lens — build-time icon generator.
 *
 * Renders `home/icon.svg` into:
 *   - `build/icon.png` (512×512)  — used by electron-builder for
 *                                    Linux/Mac and as a generic
 *                                    fallback;
 *   - `build/icon.ico` (multi-size: 16/24/32/48/64/128/256) — used
 *                                    by electron-builder to stamp
 *                                    the packaged Windows .exe, and
 *                                    by the NSIS installer/uninstaller
 *                                    shortcuts.
 *
 * Windows really, *really* wants a `.ico` for the executable's
 * resource icon. A bare PNG silently falls back to the default
 * Electron logo on a lot of setups; the .ico path is what makes
 * Explorer / taskbar / Alt+Tab actually show our brand mark.
 *
 * Run via `npm run icon` (and automatically before the build scripts
 * thanks to `prebuild`).
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");
const { renderSvgToPngBuffer } = require("../app/main/services/icon-renderer");

const OUT_DIR = path.resolve(__dirname, "..", "build");
const OUT_PNG = path.join(OUT_DIR, "icon.png");
const OUT_ICO = path.join(OUT_DIR, "icon.ico");

/** Sizes baked into the .ico. 256 is the practical max Explorer uses. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Pack a list of PNG buffers into a single Windows .ico file.
 * Each `.ico` "image entry" stores raw PNG bytes (supported on
 * Windows Vista and newer, which covers our entire target).
 *
 * @param {Buffer[]} pngBuffers
 * @param {number[]} sizes  parallel array of square sizes in px
 * @returns {Buffer}
 */
function makeIco(pngBuffers, sizes) {
  if (pngBuffers.length !== sizes.length) {
    throw new Error("makeIco: pngBuffers and sizes length mismatch");
  }
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirSize = 16 * count;
  const dataStart = headerSize + dirSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(dirSize);
  let offset = dataStart;
  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const png = pngBuffers[i];
    // ICO encodes 256 as 0 in the single-byte width/height field.
    const dim = size >= 256 ? 0 : size;

    const base = i * 16;
    dir.writeUInt8(dim, base + 0); // width
    dir.writeUInt8(dim, base + 1); // height
    dir.writeUInt8(0, base + 2); // color palette count
    dir.writeUInt8(0, base + 3); // reserved
    dir.writeUInt16LE(1, base + 4); // color planes
    dir.writeUInt16LE(32, base + 6); // bits per pixel
    dir.writeUInt32LE(png.length, base + 8); // image data size
    dir.writeUInt32LE(offset, base + 12); // image data offset

    offset += png.length;
  }

  return Buffer.concat([header, dir, ...pngBuffers]);
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // One canonical 512×512 render. Smaller sizes for the .ico get
    // derived via nativeImage.resize() instead of re-rasterising the
    // SVG seven times — same crispness, far cheaper.
    const big = await renderSvgToPngBuffer(512);
    fs.writeFileSync(OUT_PNG, big);
    console.log(
      `[build-icon] wrote ${OUT_PNG} (${(big.length / 1024).toFixed(1)} KB, 512×512)`,
    );

    const source = nativeImage.createFromBuffer(big);
    if (source.isEmpty()) {
      throw new Error("rendered NativeImage is empty");
    }

    const pngs = ICO_SIZES.map((size) =>
      source
        .resize({ width: size, height: size, quality: "best" })
        .toPNG(),
    );

    // Quick sanity check on every chunk before we pack the .ico.
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    pngs.forEach((buf, i) => {
      if (
        buf.length < PNG_SIG.length ||
        !buf.slice(0, PNG_SIG.length).equals(PNG_SIG)
      ) {
        throw new Error(`size ${ICO_SIZES[i]} produced a malformed PNG`);
      }
    });

    const ico = makeIco(pngs, ICO_SIZES);
    fs.writeFileSync(OUT_ICO, ico);
    console.log(
      `[build-icon] wrote ${OUT_ICO} (${(ico.length / 1024).toFixed(1)} KB, sizes: ${ICO_SIZES.join("/")})`,
    );

    app.exit(0);
  } catch (err) {
    console.error("[build-icon] failed:", err?.stack || err?.message || err);
    app.exit(1);
  }
});
