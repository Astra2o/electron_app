/**
 * Circle to Lens — Lens upload helper.
 *
 * Why this design: Google Lens binds every uploaded image to the
 * cookies of the session that uploaded it. So if we POST from
 * Electron's session and then hand the resulting `/search?vsrid=…`
 * URL to the user's default browser, that browser hits Lens with a
 * different cookie jar, doesn't match the uploader, and Lens shows:
 *
 *   "Image not found — The image that you're searching with is not
 *    associated with your account. Re-upload the image and try again."
 *
 * Solution: do the upload *from the user's default browser itself*.
 *
 *   1) Write a self-contained temp HTML file that embeds the cropped
 *      PNG as a base64 data URL.
 *   2) The HTML's inline script reconstructs the PNG into a Blob,
 *      builds a real <form method="POST" enctype="multipart/form-data"
 *      action="https://lens.google.com/v3/upload">, attaches the
 *      Blob via DataTransfer → input.files, and calls form.submit().
 *   3) We open that file:
 *        - In "tab" mode: shell.openExternal → default browser, new tab.
 *        - In "window" mode: spawn Chrome (or Edge) in `--app=URL`
 *          mode with `--window-position=X,Y --window-size=W,H` so
 *          the result lands in a clean docked window at the size
 *          and position the user chose.
 *      Either way the form POSTs from the user's *real* browser
 *      session, so Lens binds the upload to the user's actual
 *      Google cookies and the result page renders normally.
 */

"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { shell, screen } = require("electron");

const TEMP_DIR = path.join(os.tmpdir(), "circle-to-lens");
const TEMP_LIFETIME_MS = 2 * 60_000;

/**
 * @typedef {Object} OpenSettings
 * @property {"tab"|"window"} openMode
 * @property {"left"|"center"|"right"} windowPosition
 * @property {number} windowWidthPct   20..100
 * @property {number} windowHeightPct  20..100
 */

/**
 * @param {string} imageDataUrl  PNG data URL from overlay.js
 * @param {OpenSettings} [settings]
 * @returns {Promise<{ok: true, file: string, mode: string}>}
 */
async function submitToLens(imageDataUrl, settings) {
  if (!imageDataUrl || !/^data:image\//i.test(imageDataUrl)) {
    throw new Error("Invalid image data URL");
  }

  await fs.mkdir(TEMP_DIR, { recursive: true });

  // Best-effort sweep of leftover stubs from previous runs.
  fs.readdir(TEMP_DIR)
    .then((files) =>
      Promise.all(
        files.map((f) =>
          fs.unlink(path.join(TEMP_DIR, f)).catch(() => undefined),
        ),
      ),
    )
    .catch(() => undefined);

  const mode = settings?.openMode || "tab";
  const dims = mode === "window" ? computeWindowDimensions(settings) : null;

  const file = path.join(TEMP_DIR, `lens-${Date.now()}.html`);
  await fs.writeFile(file, buildAutoSubmitHtml(imageDataUrl, dims), "utf8");

  const fileUrl = pathToFileURL(file).href;
  console.log("[lens] opening", fileUrl, "(mode:", mode + ")", dims || "");

  if (mode === "window" && (await tryOpenInNewBrowserWindow(fileUrl, dims))) {
    // Spawned the browser with positioning flags successfully.
  } else {
    // Tab mode, or window mode with no compatible browser found —
    // fall back to the OS's default URL handler.
    const openErr = await shell.openExternal(fileUrl);
    if (openErr) {
      throw new Error(`Could not open default browser: ${openErr}`);
    }
  }

  setTimeout(() => {
    fs.unlink(file).catch(() => undefined);
  }, TEMP_LIFETIME_MS);

  return { ok: true, file, mode };
}

/**
 * Pixel rect for the docked window, based on the persisted settings
 * and the primary display's work area (excludes the taskbar).
 *
 * @param {OpenSettings} settings
 * @returns {{x:number, y:number, w:number, h:number}}
 */
function computeWindowDimensions(settings) {
  const primary = screen.getPrimaryDisplay();
  const sw = primary.workArea.width;
  const sh = primary.workArea.height;
  const ox = primary.workArea.x;
  const oy = primary.workArea.y;

  const wPct = clamp(Number(settings?.windowWidthPct) || 35, 20, 100);
  const hPct = clamp(Number(settings?.windowHeightPct) || 100, 20, 100);
  const w = Math.round((sw * wPct) / 100);
  const h = Math.round((sh * hPct) / 100);

  let x;
  switch (settings?.windowPosition) {
    case "left":
      x = ox;
      break;
    case "center":
      x = ox + Math.round((sw - w) / 2);
      break;
    case "right":
    default:
      x = ox + (sw - w);
      break;
  }
  const y = hPct === 100 ? oy : oy + Math.round((sh - h) / 2);
  return { x, y, w, h };
}

/* -------------------------------------------------------------------------- */
/*  New-window mode: spawn Chrome/Edge with positioning flags                 */
/* -------------------------------------------------------------------------- */

/**
 * Returns true if we successfully launched a positioned new window.
 * False if no compatible browser (Chrome/Edge) was found, so the
 * caller can fall back to shell.openExternal.
 *
 * IMPORTANT: when Chrome (or Edge) is already running, `--new-window`
 * + `--window-size` + `--window-position` flags are IGNORED — the
 * new window inherits the size of whichever window was last open in
 * that profile. Fix: `--app=URL`. This opens a borderless "app
 * mode" window which:
 *   1) ALWAYS honors --window-size / --window-position, even when
 *      Chrome is already running,
 *   2) still uses the user's default profile + cookies (so the Lens
 *      result page renders correctly), and
 *   3) has no tabs / URL bar clutter — which is what people actually
 *      want when docking a Lens result panel to the side.
 */
async function tryOpenInNewBrowserWindow(url, dims) {
  const exe = findBrowserExecutable();
  if (!exe) {
    console.warn(
      "[lens] new-window mode requested but Chrome/Edge not found; falling back to default browser",
    );
    return false;
  }

  const { x, y, w, h } = dims;
  const args = [
    `--app=${url}`,
    `--window-size=${w},${h}`,
    `--window-position=${x},${y}`,
  ];

  console.log("[lens] spawning", exe, args.join(" "));
  try {
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.on("error", (err) => {
      console.warn("[lens] browser spawn errored:", err?.message || err);
    });
    child.unref();
    return true;
  } catch (err) {
    console.warn("[lens] could not spawn", exe, err?.message || err);
    return false;
  }
}

/**
 * Tries common install locations for Chrome (preferred), Edge, and
 * Brave. Returns the absolute path of the first one that exists, or
 * null.
 */
function findBrowserExecutable() {
  const env = process.env;
  const pf = env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = env["LOCALAPPDATA"] || "";

  const candidates = [
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    local && path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(pf86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) return c;
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/* -------------------------------------------------------------------------- */
/*  Auto-submit HTML stub                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds a small standalone HTML page that auto-submits the embedded
 * image to Lens. Embedding via data URL means the HTML is one
 * self-contained file the browser can open without any additional
 * assets.
 *
 * If `dims` is provided (window mode), the page calls window.moveTo +
 * resizeTo BEFORE submitting the form. This is the actual mechanism
 * that enforces the user's docked-window size/position — Chrome's
 * `--window-size` / `--window-position` CLI flags are unreliable
 * when an existing Chrome instance handles the spawn, but the JS
 * calls work every time because `--app=URL` windows are "trusted"
 * and DOM resize/move APIs are not gated on them.
 *
 * @param {string} imageDataUrl
 * @param {{x:number,y:number,w:number,h:number}|null} dims
 */
function buildAutoSubmitHtml(imageDataUrl, dims) {
  const dataUrlJs = JSON.stringify(imageDataUrl);
  const dimsJs = dims ? JSON.stringify(dims) : "null";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Circle to Lens — searching…</title>
  <style>
    :root { color-scheme: dark light; }
    html, body {
      height: 100%;
      margin: 0;
      font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 30% 20%, #1a1d29 0%, #0a0b10 70%);
      color: #e6e8ee;
      display: flex; align-items: center; justify-content: center;
    }
    .card {
      max-width: 460px;
      padding: 36px 32px;
      text-align: center;
      border-radius: 18px;
      background: rgba(255,255,255,0.04);
      backdrop-filter: blur(20px);
      box-shadow: 0 24px 80px rgba(0,0,0,0.5);
    }
    h1 { margin: 6px 0 8px; font-size: 20px; font-weight: 600; }
    p  { margin: 6px 0 0; color: #9aa1b3; font-size: 13px; }
    .spinner {
      width: 56px; height: 56px;
      margin: 4px auto 18px;
      border-radius: 50%;
      background: conic-gradient(
        from 0deg,
        #ff2d55 0%, #ff9500 16%, #ffcc00 32%,
        #34c759 50%, #5ac8fa 66%, #af52de 82%, #ff2d55 100%
      );
      -webkit-mask: radial-gradient(circle, transparent 55%, black 56%);
      mask:         radial-gradient(circle, transparent 55%, black 56%);
      animation: spin 1.4s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .manual {
      margin-top: 18px;
      padding: 8px 16px;
      font: inherit;
      color: inherit;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      cursor: pointer;
    }
    .manual:hover { background: rgba(255,255,255,0.12); }
    .err { color: #ff6b6b; margin-top: 12px; font-size: 13px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Searching with Google Lens</h1>
    <p>Uploading your selection in this browser so the result is tied to your account.</p>
    <button class="manual" id="manual" type="button" hidden>Start search</button>
    <div class="err" id="err"></div>
  </div>
  <script>
    (function () {
      var submitted = false;
      var dims = ${dimsJs};

      function snapWindow() {
        if (!dims) return;
        try {
          window.moveTo(dims.x, dims.y);
          window.resizeTo(dims.w, dims.h);
        } catch (e) {
          console.warn("[c2l] snap failed:", e);
        }
      }

      async function submit() {
        if (submitted) return;
        submitted = true;
        try {
          var dataUrl = ${dataUrlJs};
          var blob = await (await fetch(dataUrl)).blob();
          var file = new File([blob], "circle-selection.png", {
            type: blob.type || "image/png",
          });

          var form = document.createElement("form");
          form.method = "POST";
          form.action =
            "https://lens.google.com/v3/upload" +
            "?hl=en&re=df&stcs=" + Date.now() +
            "&vpw=" + (window.innerWidth || 1280) +
            "&vph=" + (window.innerHeight || 800) +
            "&ep=gsbubb";
          form.enctype = "multipart/form-data";
          form.acceptCharset = "UTF-8";

          var input = document.createElement("input");
          input.type = "file";
          input.name = "encoded_image";
          form.appendChild(input);
          document.body.appendChild(form);

          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;

          form.submit();
        } catch (e) {
          submitted = false;
          document.getElementById("err").textContent =
            "Couldn't start Lens search: " + (e && e.message || e);
          document.getElementById("manual").hidden = false;
        }
      }

      document.getElementById("manual").addEventListener("click", submit);

      snapWindow();
      requestAnimationFrame(function () {
        snapWindow();
        setTimeout(function () {
          snapWindow();
          submit();
        }, 60);
      });
    })();
  </script>
</body>
</html>`;
}

module.exports = { submitToLens };
