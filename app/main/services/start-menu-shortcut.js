/**
 * Circle to Lens — Start-menu shortcut helper.
 *
 * Windows only. Drops a `Circle to Lens.lnk` into the per-user
 * Start Menu Programs folder so the app is searchable from the
 * Windows search bar (and findable in the Start menu list).
 *
 * We call `ensure()` on every app start so the shortcut auto-
 * updates if the user moves / rebuilds the app, but the operation
 * is debounced via a stamp file so we don't spend ~500 ms on
 * PowerShell every launch.
 *
 * Two modes:
 *
 *   - Packaged (`app.isPackaged`): TargetPath is the bundled .exe.
 *     The installer probably created the shortcut already, but we
 *     write our own anyway so the link survives portable installs.
 *
 *   - Dev (`npm start`): TargetPath is electron.exe and Arguments
 *     is the absolute path to the app directory so the same launch
 *     command Windows triggers also works.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { app } = require("electron");

const { PRODUCT_NAME } = require("../../shared/constants");

const SHORTCUT_NAME = `${PRODUCT_NAME}.lnk`;
const STAMP_NAME = "start-menu-shortcut.stamp";

function startMenuFolder() {
  const appdata =
    process.env.APPDATA ||
    path.join(os.homedir(), "AppData", "Roaming");
  return path.join(
    appdata,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
}

function stampPath() {
  return path.join(app.getPath("userData"), STAMP_NAME);
}

/**
 * Compute the "fingerprint" of the current install — exe + args +
 * version. If the on-disk stamp matches, we don't need to re-write
 * the shortcut.
 */
function fingerprint() {
  return JSON.stringify({
    exe: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
    version: app.getVersion(),
  });
}

/**
 * Idempotent: returns the .lnk path on success. If a current stamp
 * exists, skips PowerShell and returns immediately. Failures are
 * logged but never thrown — this is best-effort polish.
 */
async function ensure() {
  if (process.platform !== "win32") return null;

  try {
    const fp = fingerprint();
    let existing = "";
    try {
      existing = fs.readFileSync(stampPath(), "utf8");
    } catch (_) {
      /* no stamp yet — first run */
    }

    const lnk = path.join(startMenuFolder(), SHORTCUT_NAME);
    const lnkExists = fs.existsSync(lnk);
    if (existing === fp && lnkExists) {
      return lnk;
    }

    await writeShortcut(lnk);
    try {
      fs.mkdirSync(path.dirname(stampPath()), { recursive: true });
      fs.writeFileSync(stampPath(), fp, "utf8");
    } catch (e) {
      console.warn("[shortcut] could not write stamp:", e?.message || e);
    }
    return lnk;
  } catch (err) {
    console.warn("[shortcut] ensure failed:", err?.message || err);
    return null;
  }
}

/**
 * Writes the .lnk via WScript.Shell COM through powershell.exe.
 * Uses single-quoted PS strings everywhere to dodge escaping for
 * paths that contain spaces and ampersands.
 */
function writeShortcut(lnkPath) {
  const target = process.execPath;
  const workDir = path.dirname(target);
  const args = app.isPackaged ? "" : app.getAppPath();
  const description = "System-wide Circle-to-Lens for Windows";

  // PowerShell uses '' (doubled single quote) to escape a single
  // quote inside a single-quoted string. We pre-escape every path
  // that way.
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  const lines = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$s = $ws.CreateShortcut(${q(lnkPath)})`,
    `$s.TargetPath = ${q(target)}`,
    args ? `$s.Arguments = ${q(args)}` : "",
    `$s.WorkingDirectory = ${q(workDir)}`,
    `$s.IconLocation = ${q(target)}`,
    `$s.Description = ${q(description)}`,
    "$s.Save()",
  ].filter(Boolean);

  const psCmd = lines.join("; ");
  console.log("[shortcut] writing", lnkPath);

  try {
    fs.mkdirSync(path.dirname(lnkPath), { recursive: true });
  } catch (_) {
    /* ignore */
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle", "Hidden",
        "-Command", psCmd,
      ],
      { windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(lnkPath);
      else reject(new Error(`powershell exited ${code}: ${stderr.trim()}`));
    });
  });
}

function shortcutLnkPath() {
  return path.join(startMenuFolder(), SHORTCUT_NAME);
}

module.exports = { ensure, shortcutLnkPath };
