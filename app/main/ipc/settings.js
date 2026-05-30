/**
 * Circle to Lens — Settings-window IPC channels.
 *
 * read/write/close. The hotkey-rebind dance lives here too because
 * it's the settings UI that triggers it: on a failed registration
 * we roll the persisted value back to whatever was active before so
 * the on-disk state always matches what the OS actually has.
 */

"use strict";

const { ipcMain } = require("electron");

const settingsStore = require("../store/settings");
const hotkey = require("../services/hotkey");
const settingsWindow = require("../windows/settings");
const { SETTINGS } = require("../../shared/ipc-channels");

function register() {
  ipcMain.handle(SETTINGS.READ, () => settingsStore.read());

  ipcMain.handle(SETTINGS.WRITE, (_e, patch) => {
    const before = settingsStore.read();
    const merged = settingsStore.write(patch || {});

    // Hotkey change → try to re-register live. If registration
    // fails (combo taken by another app), roll the persisted value
    // back so on-disk + in-memory + OS-registered all agree.
    if (
      patch &&
      Object.prototype.hasOwnProperty.call(patch, "hotkey")
    ) {
      const requested = merged.hotkey;
      if (requested && requested !== before.hotkey) {
        const ok = hotkey.apply(requested);
        if (!ok) {
          const reverted = settingsStore.write({ hotkey: before.hotkey });
          // Make sure SOMETHING is registered.
          hotkey.apply(before.hotkey);
          return {
            ...reverted,
            hotkeyError:
              `Could not register “${requested}” — that combo may be taken by another app.`,
          };
        }
      }
    }
    return merged;
  });

  ipcMain.on(SETTINGS.CLOSE, () => settingsWindow.close());
}

module.exports = { register };
