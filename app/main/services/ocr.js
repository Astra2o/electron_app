/**
 * Circle to Lens — OCR service (tesseract.js wrapper).
 *
 * Three things to get right that the old root-level `main.js`
 * was getting wrong:
 *
 *   1) **Persistent worker.** `tesseract.recognize(...)` (top-level
 *      convenience API) creates a brand-new worker on EVERY call
 *      in v6+, which means a new WebAssembly instance + a fresh
 *      lookup of trained data every single time. The user reported
 *      "every time it says it's downloading 16 MB" — that's the
 *      symptom. We fix it by `createWorker()`ing exactly once,
 *      caching the promise, and reusing the same worker for every
 *      recognise call until the app exits.
 *
 *   2) **Local trained data.** tesseract.js by default fetches the
 *      `.traineddata` (or `.traineddata.gz`) files from a remote
 *      CDN. Each language is ~5-15 MB and the download blocks the
 *      first recognise. We ship `eng.traineddata` + `hin.traineddata`
 *      inside the app bundle (under `app/resources/tessdata/`) and
 *      seed them into a stable on-disk cache the first time we
 *      need them, then point tesseract at that cache with
 *      `cacheMethod: "readOnly"` so it never tries the network.
 *
 *   3) **Explicit `blocks` output.** tesseract.js v6 made the
 *      rich `data.blocks` array OPT-IN — calling `recognize()`
 *      without `{ blocks: true }` in the third arg returns an empty
 *      blocks array. The old code iterated `data.blocks` and got
 *      nothing back, which is why the overlay was showing "no text
 *      found on screen" even on text-heavy pages. We always request
 *      `{ blocks: true, text: true }` here.
 *
 * Worker lifetime is the entire app lifetime; we deliberately don't
 * `worker.terminate()` because spinning it back up costs ~1-2 s and
 * we'd rather pay nothing on subsequent captures.
 */

"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { app } = require("electron");

const { OCR_LANGS } = require("../../shared/constants");

/**
 * Where the bundled `.traineddata` files live, dev OR packaged.
 *   - Dev:      app/resources/tessdata/<lang>.traineddata
 *   - Packaged: process.resourcesPath/tessdata/<lang>.traineddata
 *               (electron-builder copies them via `extraResources`
 *                — see package.json > build.extraResources)
 */
function getBundledTessdataDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "tessdata");
  }
  // __dirname = .../app/main/services
  return path.resolve(__dirname, "..", "..", "resources", "tessdata");
}

/**
 * Where tesseract.js looks for `.traineddata` (its "cache" dir).
 * We seed this from the bundle on first use so packaged installs
 * never touch the network — and so dev runs from the per-user
 * userData directory keep using the same cached copies across
 * restarts. (We can't point tesseract at the asar-packed bundle
 * directly because tesseract.js v6 uses fs to read these files
 * synchronously inside a worker, which doesn't traverse asar.)
 */
function getUserTessdataDir() {
  return path.join(app.getPath("userData"), "tessdata");
}

/**
 * Copy `<bundle>/<lang>.traineddata` into the per-user cache dir
 * for every language we plan to load. No-op if the file is already
 * present (which is the steady state after the very first OCR call
 * on a given install).
 *
 * Returns the user cache dir so the caller can pass it as
 * `cachePath` to createWorker.
 */
async function ensureLangFilesInCache() {
  const cacheDir = getUserTessdataDir();
  await fsp.mkdir(cacheDir, { recursive: true });

  const bundleDir = getBundledTessdataDir();
  for (const lang of OCR_LANGS.split("+")) {
    const filename = `${lang}.traineddata`;
    const dst = path.join(cacheDir, filename);
    const src = path.join(bundleDir, filename);

    // Re-seed whenever the bundled file's size differs from what's
    // already in cache. This is how we ship traineddata upgrades
    // (e.g. tessdata_fast → tessdata_best) without forcing users to
    // wipe their userData by hand. Hash check would be more robust
    // but size is enough — Tesseract trained-data files of the same
    // model variant are byte-identical, different variants differ
    // by megabytes.
    let needsSeed = true;
    try {
      const [bundleSt, cacheSt] = await Promise.all([
        fsp.stat(src),
        fsp.stat(dst),
      ]);
      if (cacheSt.size > 0 && cacheSt.size === bundleSt.size) {
        needsSeed = false;
      }
    } catch (_) {
      /* either bundle or cache missing — fall through to copy attempt */
    }
    if (!needsSeed) continue;

    try {
      await fsp.copyFile(src, dst);
      console.log(`[ocr] seeded ${filename} (${cacheDir})`);
    } catch (err) {
      // If the bundle file is missing (e.g. dev forgot to commit it),
      // log loudly but don't throw — tesseract will fall back to
      // downloading from its CDN on the next createWorker call.
      console.warn(
        `[ocr] could not seed ${filename} from ${src}; tesseract may try to download:`,
        err?.message || err,
      );
    }
  }
  return cacheDir;
}

/** Cached worker promise — created once, reused for every OCR call. */
let _workerPromise = null;

/**
 * Lazily build and return the shared tesseract worker. Heavy
 * imports + WebAssembly init only happen the first time an OCR
 * action is actually invoked, so Lens-only users never pay for
 * tesseract.js loading.
 */
function getWorker() {
  if (_workerPromise) return _workerPromise;
  _workerPromise = (async () => {
    // Require lazily so the ~3 MB tesseract.js module doesn't
    // load until somebody actually triggers an OCR action.
    const { createWorker, PSM, OEM } = require("tesseract.js");
    const cachePath = await ensureLangFilesInCache();
    console.log(`[ocr] booting tesseract worker (langs=${OCR_LANGS})`);
    // Our own worker bootstrap pre-stubs `wasm-feature-detect` so
    // tesseract.js loads the SIMD-LSTM core (which has the
    // DotProductSSE intrinsic needed by `tessdata` / `tessdata_best`
    // float models). Without this override Electron's worker_threads
    // hits a runtime abort:
    //   Aborted(missing function: _ZN9tesseract13DotProductSSEEPKfS1_i)
    const workerBootstrap = path.join(__dirname, "ocr-worker-bootstrap.js");
    // OEM.LSTM_ONLY (1) is what tessdata_best ships — it has no
    // legacy classifier weights, so any other OEM mode wastes time
    // attempting a fallback that can't load.
    const worker = await createWorker(OCR_LANGS, OEM.LSTM_ONLY, {
      workerPath: workerBootstrap,
      cachePath,
      cacheMethod: "readOnly",
      // Our bundled traineddata files are NOT gzipped. Setting
      // this to false makes tesseract.js load them as-is instead
      // of trying to gunzip first.
      gzip: false,
      logger: () => {},
      errorHandler: (err) =>
        console.warn("[ocr] tesseract error:", err?.message || err),
    });

    // Accuracy-tuning parameters. These are applied once per
    // worker lifetime so every recognise() call inherits them.
    await worker.setParameters({
      // PSM 6 = single uniform block of text. Our rect-mode flow
      // crops to a user-drawn rectangle which is almost always a
      // single block (paragraph, code snippet, button label, etc).
      // Default PSM 3 is "auto" but spends time looking for column
      // breaks that don't exist in a small crop.
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      // Tesseract uses DPI to pick the right scaling. Screen
      // captures rarely carry DPI metadata so we hint a sane
      // value — 300 is what tesseract's training corpus assumes.
      user_defined_dpi: "300",
      // Keep inter-word spaces in the output so multi-word lines
      // round-trip cleanly through translate.
      preserve_interword_spaces: "1",
    });

    console.log("[ocr] tesseract worker ready (oem=LSTM_ONLY, psm=SINGLE_BLOCK)");
    return worker;
  })().catch((err) => {
    // Reset the cache so the next call retries, instead of returning
    // a permanently-rejected promise.
    _workerPromise = null;
    throw err;
  });
  return _workerPromise;
}

/**
 * Recognise raw text (no structure) from a PNG data URL. Used by
 * the cropped "Translate" pipeline (selection-toolbar > Translate).
 *
 * @param {string} imageDataUrl
 * @returns {Promise<string>}
 */
async function ocrImage(imageDataUrl) {
  if (!imageDataUrl || !/^data:image\//i.test(imageDataUrl)) {
    throw new Error("Invalid image data");
  }
  const worker = await getWorker();
  // Critical: third arg explicitly asks for `text` AND `blocks`.
  // Default in v6+ is `{ text: true, blocks: false }` for cropped
  // single-call recognises; we want both so any caller can use the
  // same worker output shape.
  const { data } = await worker.recognize(
    imageDataUrl,
    {},
    { text: true, blocks: true },
  );
  return (data?.text || "").trim();
}

/**
 * Full-screen OCR returning structured lines with image-pixel
 * bounding boxes. Used by the no-draw "Select text" / "Translate
 * in place" modes — the renderer takes these bboxes, converts them
 * from image pixels to CSS pixels via the display scale factor,
 * and draws either invisible-but-selectable spans on top of the
 * screenshot OR translated overlays anchored to each line.
 *
 * @param {string} imageDataUrl  PNG data URL of the captured screen
 * @returns {Promise<{
 *   text: string,
 *   lines: Array<{ text: string, bbox: {x0:number,y0:number,x1:number,y1:number}, confidence: number }>,
 * }>}
 */
async function ocrFullscreen(imageDataUrl) {
  if (!imageDataUrl || !/^data:image\//i.test(imageDataUrl)) {
    throw new Error("Invalid image data");
  }
  const worker = await getWorker();
  const { data } = await worker.recognize(
    imageDataUrl,
    {},
    { text: true, blocks: true },
  );

  const lines = [];
  // tesseract.js v6/v7 nests structure as blocks -> paragraphs -> lines.
  if (Array.isArray(data?.blocks)) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          pushLine(lines, line);
        }
      }
    }
  }
  // Some builds expose `data.lines` at the top level too. Try that
  // as a fall-back if the blocks walk didn't yield anything.
  if (lines.length === 0 && Array.isArray(data?.lines)) {
    for (const line of data.lines) pushLine(lines, line);
  }

  return { text: (data?.text || "").trim(), lines };
}

function pushLine(out, line) {
  if (!line || !line.bbox) return;
  const text = (line.text || "").replace(/\s+\n\s*$/g, "").trim();
  if (!text) return;
  out.push({
    text,
    bbox: {
      x0: Math.round(line.bbox.x0),
      y0: Math.round(line.bbox.y0),
      x1: Math.round(line.bbox.x1),
      y1: Math.round(line.bbox.y1),
    },
    confidence: line.confidence || 0,
  });
}

/**
 * Terminate the shared worker. Wired into `app.on("will-quit", ...)`
 * so the worker process is cleaned up at shutdown — not strictly
 * required (Chromium kills child processes anyway) but tidy.
 */
async function shutdown() {
  if (!_workerPromise) return;
  try {
    const w = await _workerPromise;
    await w.terminate();
  } catch (err) {
    console.warn("[ocr] shutdown error:", err?.message || err);
  } finally {
    _workerPromise = null;
  }
}

module.exports = { ocrImage, ocrFullscreen, getWorker, shutdown };
