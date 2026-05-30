/**
 * Circle to Lens — IPC barrel.
 *
 * `index.js` registers every IPC handler in the right order so the
 * entry point only has to call `ipc.register({...})` once.
 */

"use strict";

const home = require("./home");
const settings = require("./settings");
const overlay = require("./overlay");

/**
 * @param {{ onCapture: () => void }} ctx
 */
function register(ctx) {
  home.register(ctx);
  settings.register();
  overlay.register();
}

module.exports = { register };
