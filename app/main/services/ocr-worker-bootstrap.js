/**
 * Tesseract.js worker thread bootstrap.
 *
 * Why this exists:
 *
 *   Tesseract.js's Node worker (src/worker-script/node/getCore.js) uses
 *   the `wasm-feature-detect` package to decide which WebAssembly core
 *   to load:
 *
 *     - SIMD detected         → tesseract-core-simd-lstm (has DotProductSSE)
 *     - relaxedSIMD detected  → tesseract-core-relaxedsimd-lstm
 *     - neither               → tesseract-core-lstm    (no SIMD intrinsics)
 *
 *   The non-SIMD fallback is missing `tesseract::DotProductSSE(...)`,
 *   which the FLOAT-LSTM models in `tessdata` / `tessdata_best` need.
 *   Inside Electron's `worker_threads`, `wasm-feature-detect`
 *   sometimes returns false negatives — we've seen it pick the
 *   non-SIMD core even on modern Windows where SIMD is fully
 *   supported. The result is a hard runtime abort:
 *
 *       Aborted(missing function: _ZN9tesseract13DotProductSSEEPKfS1_i)
 *
 *   Modern Electron (Chromium) ships a Node/V8 that always supports
 *   WebAssembly SIMD, so the safe and correct fix is to pre-stub
 *   `wasm-feature-detect` in this worker's require cache BEFORE
 *   tesseract.js's worker-script gets a chance to import it. That
 *   forces it down the SIMD-LSTM branch, which loads
 *   `tesseract-core-simd-lstm` from `tesseract.js-core` (already
 *   bundled in node_modules — no extra install needed).
 */

"use strict";

const path = require("node:path");

try {
  // Resolve `wasm-feature-detect` the same way tesseract.js's
  // worker-script does (from the tesseract.js package directory),
  // and pre-populate this worker's require cache with a stub before
  // the real module ever loads.
  const tesseractEntry = require.resolve("tesseract.js");
  const wfdPath = require.resolve("wasm-feature-detect", {
    paths: [path.dirname(tesseractEntry)],
  });
  const stub = {
    exports: {
      simd: async () => true,
      relaxedSimd: async () => false,
      // Cover the rest of the wasm-feature-detect surface in case
      // future tesseract.js versions consult more flags. All return
      // false except simd so we get the SIMD-LSTM (non-relaxed)
      // core, which is the most broadly supported variant.
      bulkMemory: async () => false,
      exceptions: async () => false,
      memory64: async () => false,
      multiValue: async () => false,
      mutableGlobals: async () => false,
      referenceTypes: async () => false,
      saturatedFloatToInt: async () => false,
      signExtensions: async () => false,
      streamingCompilation: async () => false,
      tailCall: async () => false,
      threads: async () => false,
    },
    loaded: true,
    id: wfdPath,
    filename: wfdPath,
    children: [],
    paths: [],
  };
  require.cache[wfdPath] = stub;
} catch (err) {
  // If anything above fails (package layout changed, etc.) we still
  // load the real worker — tesseract.js will just fall through to
  // its native SIMD detection. Worst case we end up where we were
  // before this bootstrap existed.
  // eslint-disable-next-line no-console
  console.warn(
    "[ocr-worker-bootstrap] could not pre-stub wasm-feature-detect:",
    err && err.message ? err.message : err,
  );
}

// Hand control to the real tesseract.js Node worker-script.
require("tesseract.js/src/worker-script/node/index.js");
