/**
 * Circle to Lens — tiny JSON settings store.
 *
 * Settings live at `<userData>/settings.json`. Reads are synchronous
 * (called once at boot and again whenever the user opens the settings
 * window), and writes happen on every change from the settings UI.
 *
 * The defaults here are also the *shape* of the document — everything
 * else in the app reads through `read()`, which merges saved values
 * over these defaults, so adding a new setting never breaks an old
 * config file.
 */

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = Object.freeze({
  /** "rgb" | "classic" | "neon" | "ink" — see overlay.js PENCIL_STYLES. */
  pencilStyle: "rgb",

  /**
   * If true, on pointer-up the freehand lasso snaps to its bounding-box
   * rectangle and the area outside the rectangle gets darkened — the
   * classic snipping-tool look. The captured crop is the rectangle.
   */
  convertToRect: true,

  /** "tab" | "window" — where to open the Lens result. */
  openMode: "window",

  /** For window mode: side of the screen to dock to. */
  windowPosition: "right", // "left" | "center" | "right"

  /** For window mode: width as a percentage of the primary display. */
  windowWidthPct: 35,

  /** For window mode: height as a percentage of the primary display. */
  windowHeightPct: 100,

  /**
   * First-run housekeeping: set to true after the Home window has been
   * shown automatically once. Kept around in case future first-run
   * onboarding ever needs to distinguish "first ever" from "every time".
   */
  firstRunComplete: false,

  /**
   * Pop the Home window every time the app launches. ON by default so
   * the user always has a visible surface ("hey, the app is running")
   * instead of just an easily-missed tray icon. Users can switch this
   * off from Home itself.
   */
  showHomeOnStartup: true,

  /**
   * Auto-launch on Windows login. Backed by app.setLoginItemSettings.
   * Defaulted ON so that a fresh install becomes "install once, forget"
   * — the very first time the app starts (typically right after the
   * installer finishes), main.js mirrors this value into the registry
   * via applyAutoStart(true), and every subsequent Windows boot brings
   * the tray + global hotkey up without user intervention.
   *
   * Existing installs are unaffected: settings.json on disk already
   * carries whatever value the user previously chose, and sanitize()
   * preserves it. The new default only kicks in when there is no
   * settings.json yet.
   */
  startWithWindows: true,

  /**
   * Global hotkey accelerator string (Electron globalShortcut format).
   * Must include at least one modifier (Ctrl / Alt / Shift / Super)
   * plus one key. Examples: "Alt+Shift+S", "CommandOrControl+Shift+L".
   */
  hotkey: "Alt+Shift+S",
});

function file() {
  return path.join(app.getPath("userData"), "settings.json");
}

/** @returns {typeof DEFAULTS} */
function read() {
  try {
    const raw = fs.readFileSync(file(), "utf8");
    const parsed = JSON.parse(raw);
    return sanitize({ ...DEFAULTS, ...parsed });
  } catch (_) {
    return { ...DEFAULTS };
  }
}

/** @param {Partial<typeof DEFAULTS>} patch */
function write(patch) {
  const merged = sanitize({ ...read(), ...patch });
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(merged, null, 2), "utf8");
  } catch (err) {
    console.warn("[settings] failed to persist:", err?.message || err);
  }
  return merged;
}

/**
 * Clamp/whitelist every field. Doing this in one place means the rest
 * of the app can trust the shape without re-validating.
 */
function sanitize(s) {
  const validPencils = ["rgb", "classic", "neon", "ink"];
  const validModes = ["tab", "window"];
  const validPos = ["left", "center", "right"];

  return {
    pencilStyle: validPencils.includes(s.pencilStyle) ? s.pencilStyle : "rgb",
    convertToRect: !!s.convertToRect,
    openMode: validModes.includes(s.openMode) ? s.openMode : "tab",
    windowPosition: validPos.includes(s.windowPosition)
      ? s.windowPosition
      : "right",
    windowWidthPct: clamp(num(s.windowWidthPct, 35), 20, 100),
    windowHeightPct: clamp(num(s.windowHeightPct, 100), 20, 100),
    firstRunComplete: !!s.firstRunComplete,
    showHomeOnStartup:
      s.showHomeOnStartup === undefined ? true : !!s.showHomeOnStartup,
    startWithWindows: !!s.startWithWindows,
    hotkey: validHotkey(s.hotkey) || "Alt+Shift+S",
  };
}

/**
 * Accept an accelerator string if it has at least one modifier
 * (Ctrl / Alt / Shift / Super / Cmd / CommandOrControl) joined to a
 * key by "+". This isn't a full Electron parser — it just rejects
 * obvious garbage so the registration call can still surface real
 * problems (e.g. already-taken combos).
 */
function validHotkey(s) {
  if (typeof s !== "string") return null;
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  const knownMods = ["ctrl", "control", "alt", "option", "shift", "super",
                     "meta", "cmd", "command", "commandorcontrol", "cmdorctrl"];
  if (!mods.every((m) => knownMods.includes(m))) return null;
  return parts.join("+");
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

module.exports = { read, write, DEFAULTS };
