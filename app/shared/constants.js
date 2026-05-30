/**
 * Circle to Lens — cross-module constants.
 *
 * These values are part of the app's *identity* and should never
 * change without coordinated updates (e.g. the AppUserModelID is
 * referenced by Windows for taskbar grouping + notifications; the
 * shortcut name shows up in Start Menu search).
 */

"use strict";

/** Windows AppUserModelID. Stable across versions. */
const APP_USER_MODEL_ID = "com.circletools.lens";

/** Display name used in tray tooltips, notifications, etc. */
const PRODUCT_NAME = "Circle to Lens";

/** Default global hotkey if settings.json doesn't exist yet. */
const DEFAULT_HOTKEY = "Alt+Shift+S";

/**
 * OCR language list passed to tesseract.js. `eng+hin` covers the
 * primary user (Hindi + English mixed text on screen). Each extra
 * language adds a ~5-15 MB trained-data file under
 * app/resources/tessdata/ and a small accuracy/speed hit.
 */
const OCR_LANGS = "eng+hin";

module.exports = {
  APP_USER_MODEL_ID,
  PRODUCT_NAME,
  DEFAULT_HOTKEY,
  OCR_LANGS,
};
