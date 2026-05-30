/**
 * Circle to Lens — system notification helper.
 *
 * Trivial wrapper, but pulled out so every service that needs a
 * toast doesn't have to handle the `new Notification()` ctor
 * throwing on locked-down systems.
 */

"use strict";

const { Notification } = require("electron");

/**
 * Show a silent toast notification. Never throws — failures from
 * locked-down systems (group-policy disabled, no notification
 * provider) are swallowed.
 */
function notify(title, body) {
  try {
    new Notification({ title, body, silent: true }).show();
  } catch (_) {
    /* notifications can fail on locked-down systems — ignore */
  }
}

module.exports = { notify };
