/**
 * Circle to Lens — auto-launch on Windows login service.
 *
 * Thin wrapper around `app.setLoginItemSettings` that passes the
 * correct `path` / `args` for both dev (electron.exe + app-dir)
 * and packaged (installed exe) runs, so signing up for autostart
 * works in both.
 */

"use strict";

const { app } = require("electron");

/**
 * Mirror the persisted `startWithWindows` flag into the OS login
 * setting. Never throws — failures are logged.
 *
 * @param {boolean} enabled
 */
function apply(enabled) {
  if (process.platform !== "win32") return;
  try {
    const opts = { openAtLogin: !!enabled };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [app.getAppPath()];
    }
    app.setLoginItemSettings(opts);
  } catch (err) {
    console.warn("[auto-launch] apply failed:", err?.message || err);
  }
}

module.exports = { apply };
