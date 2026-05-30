/**
 * Circle to Lens — single source of truth for IPC channel names.
 *
 * Both the main-process handlers AND the preload bridges import
 * these constants, so a typo can't get one half of the wire silently
 * out of sync with the other (which is how IPC bugs usually start).
 *
 * Naming convention: `<window>:<verb>` — `home:capture`, `overlay:ocr`,
 * `settings:write`. Keeps the channel list grep-able by window name
 * in big projects.
 */

"use strict";

const HOME = Object.freeze({
  GET_META:                 "home:get-meta",
  CAPTURE:                  "home:capture",
  OPEN_SETTINGS:            "home:open-settings",
  SET_AUTOSTART:            "home:set-autostart",
  SET_SHOW_HOME_ON_STARTUP: "home:set-show-home-on-startup",
  CHECK_SHORTCUT:           "home:check-shortcut",
  RECREATE_SHORTCUT:        "home:recreate-shortcut",
  CLOSE:                    "home:close",
});

const SETTINGS = Object.freeze({
  READ:  "settings:read",
  WRITE: "settings:write",
  CLOSE: "settings:close",
});

const OVERLAY = Object.freeze({
  INIT:                 "overlay:init",
  SUBMIT:               "overlay:submit",
  CANCEL:               "overlay:cancel",
  OCR:                  "overlay:ocr",
  OCR_FULLSCREEN:       "overlay:ocr-fullscreen",
  TRANSLATE:            "overlay:translate",
  TRANSLATE_BATCH:      "overlay:translate-batch",
  SET_TRANSLATE_TARGET: "overlay:set-translate-target",
  COPY_TEXT:            "overlay:copy-text",
});

module.exports = { HOME, SETTINGS, OVERLAY };
