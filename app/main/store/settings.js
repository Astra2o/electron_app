/**
 * Circle to Lens — tiny JSON settings store.
 *
 * Settings live at `<userData>/settings.json`. Reads are synchronous
 * (called once at boot and again whenever the user opens the
 * settings window), and writes happen on every change from the
 * settings UI.
 *
 * The DEFAULTS object is also the *shape* of the document —
 * everything else in the app reads through `read()`, which merges
 * saved values over these defaults, so adding a new setting never
 * breaks an old config file.
 *
 * `sanitize()` clamps every field so the rest of the app can trust
 * the shape without re-validating.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const { DEFAULT_HOTKEY } = require("../../shared/constants");

const DEFAULTS = Object.freeze({
  /* ------------------------------------------------------------------ */
  /*  Lens drawing                                                       */
  /* ------------------------------------------------------------------ */

  /** "rgb" | "classic" | "neon" | "ink" — see overlay.js PENCIL_STYLES. */
  pencilStyle: "rgb",

  /**
   * If true, on pointer-up the freehand lasso snaps to its
   * bounding-box rectangle and the area outside the rectangle gets
   * darkened — the classic snipping-tool look. The captured crop is
   * the rectangle.
   */
  convertToRect: true,

  /* ------------------------------------------------------------------ */
  /*  Lens result presentation                                           */
  /* ------------------------------------------------------------------ */

  /** "tab" | "window" — where to open the Lens result. */
  openMode: "window",

  /** For window mode: side of the screen to dock to. */
  windowPosition: "right", // "left" | "center" | "right"

  /** For window mode: width as a percentage of the primary display. */
  windowWidthPct: 35,

  /** For window mode: height as a percentage of the primary display. */
  windowHeightPct: 100,

  /* ------------------------------------------------------------------ */
  /*  App lifecycle                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Set to true after the Home window has been shown automatically
   * once. Kept around in case future first-run onboarding ever needs
   * to distinguish "first ever" from "every time".
   */
  firstRunComplete: false,

  /**
   * Pop the Home window every time the app launches. ON by default
   * so a fresh install always has a visible surface ("hey, the app
   * is running") instead of just an easily-missed tray icon.
   */
  showHomeOnStartup: true,

  /**
   * Auto-launch on Windows login. Backed by `app.setLoginItemSettings`.
   * Defaulted ON so a fresh install becomes "install once, forget".
   */
  startWithWindows: true,

  /**
   * Global hotkey accelerator string (Electron `globalShortcut`
   * format). Must include at least one modifier (Ctrl / Alt / Shift
   * / Super) plus one key. Examples: "Alt+Shift+S",
   * "CommandOrControl+Shift+L".
   */
  hotkey: DEFAULT_HOTKEY,

  /* ------------------------------------------------------------------ */
  /*  Action menu (overlay quick-actions toolbar)                        */
  /* ------------------------------------------------------------------ */

  /**
   * Show the floating action menu (Lens / Translate / Select text /
   * Copy) on the overlay. Users who only ever use Lens can flip
   * this off for a totally clean overlay.
   */
  showActionMenu: true,

  /**
   * Where the action menu docks on the overlay. Mirrors the way the
   * Windows taskbar can be aligned to any edge of the screen.
   *   "top"    — horizontal strip near the top
   *   "bottom" — horizontal strip near the bottom
   *   "left"   — vertical strip on the left
   *   "right"  — vertical strip on the right
   */
  menuPosition: "top",

  /**
   * Default action that is pre-selected when the overlay opens.
   *   "lens"      — Google Lens visual search (draws lasso)
   *   "translate" — no-draw: full-screen OCR + in-place translation
   *   "ocr"       — no-draw: full-screen OCR + selectable text
   *   "copy"      — no-draw: full-screen OCR + selectable text +
   *                 quick-copy toolbar
   */
  defaultAction: "lens",

  /**
   * Target language for "Translate" action. Two-letter ISO 639-1
   * code (e.g. "en", "hi", "es"). Source language is auto-detected.
   *
   * Defaults to English on first run; thereafter persisted whenever
   * the user picks a different language from the in-overlay picker.
   */
  translateTo: "en",
});

/** @returns {string} absolute path to the on-disk settings file */
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

function sanitize(s) {
  const validPencils = ["rgb", "classic", "neon", "ink"];
  const validModes = ["tab", "window"];
  const validPos = ["left", "center", "right"];
  const validMenuPos = ["top", "bottom", "left", "right"];
  const validActions = ["lens", "translate", "ocr", "copy"];
  const validLangs = [
    "en", "hi", "es", "fr", "de", "it", "pt", "ru",
    "ja", "ko", "zh", "ar", "bn", "ta", "te", "mr", "gu", "ur",
  ];

  return {
    pencilStyle:     validPencils.includes(s.pencilStyle) ? s.pencilStyle : "rgb",
    convertToRect:   !!s.convertToRect,
    openMode:        validModes.includes(s.openMode) ? s.openMode : "window",
    windowPosition:  validPos.includes(s.windowPosition) ? s.windowPosition : "right",
    windowWidthPct:  clamp(num(s.windowWidthPct, 35), 20, 100),
    windowHeightPct: clamp(num(s.windowHeightPct, 100), 20, 100),

    firstRunComplete:  !!s.firstRunComplete,
    showHomeOnStartup: s.showHomeOnStartup === undefined ? true : !!s.showHomeOnStartup,
    startWithWindows:  s.startWithWindows  === undefined ? true : !!s.startWithWindows,
    hotkey:            validHotkey(s.hotkey) || DEFAULT_HOTKEY,

    showActionMenu: s.showActionMenu === undefined ? true : !!s.showActionMenu,
    menuPosition:   validMenuPos.includes(s.menuPosition) ? s.menuPosition : "top",
    defaultAction:  validActions.includes(s.defaultAction) ? s.defaultAction : "lens",
    translateTo:    validLangs.includes(s.translateTo) ? s.translateTo : "en",
  };
}

/**
 * Accept an accelerator string if it has at least one modifier
 * (Ctrl / Alt / Shift / Super / Cmd / CommandOrControl) joined to a
 * key by "+". Not a full Electron parser — just rejects obvious
 * garbage so the registration call can still surface real problems.
 */
function validHotkey(s) {
  if (typeof s !== "string") return null;
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  const knownMods = [
    "ctrl", "control", "alt", "option", "shift", "super",
    "meta", "cmd", "command", "commandorcontrol", "cmdorctrl",
  ];
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
