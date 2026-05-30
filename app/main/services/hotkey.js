/**
 * Circle to Lens — global hotkey service.
 *
 * Owns the single currently-registered accelerator. Other modules
 * read the active combo via `current()` (e.g. tray tooltip / IPC
 * meta).
 *
 * The action that fires when the hotkey is pressed (= activate the
 * lasso overlay) is injected by the caller at boot, so this module
 * has zero dependencies on the overlay subsystem.
 */

"use strict";

const { globalShortcut } = require("electron");

const { DEFAULT_HOTKEY } = require("../../shared/constants");

let _current = DEFAULT_HOTKEY;
let _action = () => {};
/** Optional `(newAccel) => void` invoked after every successful registration. */
let _onChange = null;

/**
 * @param {() => void} action  Called every time the hotkey fires.
 * @param {(accel: string) => void} [onChange]
 */
function init(action, onChange) {
  if (typeof action !== "function") {
    throw new Error("hotkey.init requires an action function");
  }
  _action = action;
  _onChange = typeof onChange === "function" ? onChange : null;
}

/** @returns {string} the currently-registered accelerator */
function current() {
  return _current;
}

/**
 * Try to register `accel` as the global hotkey. On success, updates
 * the in-memory current combo and notifies the onChange listener.
 *
 * @param {string} accel
 * @returns {boolean} true if registration succeeded
 */
function apply(accel) {
  if (!accel) return false;
  // Unregister whatever we had before so we don't leak stale bindings
  // when the user cycles through combos in the Settings window.
  try {
    globalShortcut.unregisterAll();
  } catch (_) {
    /* no-op */
  }
  const ok = globalShortcut.register(accel, _action);
  if (ok) {
    _current = accel;
    console.log(`[hotkey] Global hotkey now: ${_current}`);
    if (_onChange) {
      try { _onChange(_current); } catch (_) { /* ignore */ }
    }
  } else {
    console.warn(`[hotkey] Failed to register ${accel}`);
  }
  return ok;
}

/** Convenience: apply the default combo. Called on boot. */
function registerInitial(initial) {
  _current = initial || DEFAULT_HOTKEY;
  return apply(_current);
}

/** Release the hotkey on app shutdown. */
function dispose() {
  try { globalShortcut.unregisterAll(); } catch (_) { /* no-op */ }
}

module.exports = { init, apply, current, registerInitial, dispose };
