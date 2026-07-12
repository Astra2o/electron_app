/**
 * Circle to Lens — Home renderer.
 *
 * Boots up showing app metadata + a couple of quick toggles. The
 * heavier configuration lives in the dedicated Settings window — this
 * one is just the welcome / how-to landing.
 */

(async () => {
  const c2l = window.c2lHome;
  if (!c2l) {
    console.error("[home] preload bridge missing");
    return;
  }

  const els = {
    version: document.getElementById("version"),
    capture: document.getElementById("capture"),
    openSettings: document.getElementById("open-settings"),
    linkSettings: document.querySelectorAll(".link-settings"),
    showHomeOnStartup: document.getElementById("showHomeOnStartup"),
    startWithWindows: document.getElementById("startWithWindows"),
    searchableStatus: document.getElementById("searchable-status"),
    recreateShortcut: document.getElementById("recreate-shortcut"),
    done: document.getElementById("done"),
  };

  /* ---------- populate ---------- */

  const meta = await c2l.getMeta();
  els.version.textContent = meta.version || "0.0.0";

  const settings = await c2l.getSettings();
  els.startWithWindows.checked = !!settings.startWithWindows;
  els.showHomeOnStartup.checked = settings.showHomeOnStartup !== false;
  paintHotkey(settings.hotkey || meta.hotkey || "Alt+Shift+S");
  applyPlatformCopy(meta.platform);

  await refreshShortcutStatus();

  /* ---------- wire ---------- */

  els.capture.addEventListener("click", () => c2l.capture());
  els.openSettings.addEventListener("click", () => c2l.openSettings());
  for (const a of els.linkSettings) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      c2l.openSettings();
    });
  }

  els.startWithWindows.addEventListener("change", async () => {
    const next = els.startWithWindows.checked;
    const ok = await c2l.setStartWithWindows(next);
    if (!ok) {
      els.startWithWindows.checked = !next;
    }
  });

  els.showHomeOnStartup.addEventListener("change", () => {
    c2l.setShowHomeOnStartup(els.showHomeOnStartup.checked);
  });

  els.recreateShortcut.addEventListener("click", async () => {
    els.searchableStatus.textContent = "Recreating shortcut…";
    els.searchableStatus.className = "row-sub";
    const ok = await c2l.recreateShortcut();
    await refreshShortcutStatus(ok);
  });

  els.done.addEventListener("click", () => c2l.close());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") c2l.close();
  });

  /* ---------- helpers ---------- */

  /**
   * Renders the current hotkey as a row of <kbd> chips in both the
   * hero paragraph and the "Press the hotkey" step.
   */
  function paintHotkey(accel) {
    const display = formatHotkeyForDisplay(accel || "Alt+Shift+S");
    const parts = display.split("+").map((p) => p.trim());
    const hero = document.getElementById("hotkey-chips");
    const step = document.getElementById("hotkey-chips-step");
    const chips = parts
      .map((p, i) => {
        const sep = i > 0 ? '<span class="plus">+</span>' : "";
        return `${sep}<kbd>${escapeHtml(p)}</kbd>`;
      })
      .join("");
    if (hero) hero.innerHTML = chips;
    if (step) step.innerHTML = chips;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatHotkeyForDisplay(accel) {
    if (platform !== "darwin") return accel;
    return accel
      .replace(/CommandOrControl/g, "⌘")
      .replace(/Command/g, "⌘")
      .replace(/Control/g, "⌃")
      .replace(/Alt/g, "⌥")
      .replace(/Shift/g, "⇧");
  }

  let platform = "win32";

  function applyPlatformCopy(p) {
    platform = p || "win32";
    const heroP = document.querySelector(".hero-copy > p");
    if (heroP && platform === "darwin") {
      heroP.innerHTML =
        'Press <span id="hotkey-chips"></span> anywhere on your Mac, draw a circle around anything, and search it with Google Lens — straight to your default browser.';
      paintHotkey(settings.hotkey || meta.hotkey || "Alt+Shift+S");
    }
    const autostartTitle = document.querySelector(
      "#startWithWindows + div .row-title",
    );
    if (autostartTitle && platform === "darwin") {
      autostartTitle.textContent = "Start at login";
    }
    const autostartSub = document.querySelector(
      "#startWithWindows + div .row-sub",
    );
    if (autostartSub && platform === "darwin") {
      autostartSub.textContent =
        "Launch Circle to Lens automatically when you sign in. The app stays in your menu bar, ready for the hotkey.";
    }
    const shortcutTitle = document.querySelector("#searchable-row .row-title");
    if (shortcutTitle && platform === "darwin") {
      shortcutTitle.textContent = "Desktop shortcut + cheat sheet";
    }
    const footerHint = document.querySelector(".footer-hint");
    if (footerHint && platform === "darwin") {
      footerHint.textContent =
        "Click the menu bar icon for more options at any time.";
    }
    const stepP = document.querySelector(".step p");
    if (stepP && platform === "darwin") {
      stepP.innerHTML =
        '<span id="hotkey-chips-step"></span> from <em>any</em> app. Circle to Lens stays in your menu bar. Change the combo in <a href="#" class="link-settings">Settings</a>.';
      paintHotkey(settings.hotkey || meta.hotkey || "Alt+Shift+S");
    }
  }

  async function refreshShortcutStatus(forcedOk) {
    const present =
      forcedOk === undefined ? await c2l.checkShortcut() : !!forcedOk;
    if (present) {
      els.searchableStatus.textContent =
        platform === "darwin"
          ? "Desktop alias + shortcuts guide installed on your Desktop."
          : "Shortcut installed — search “Circle to Lens” in the Start menu.";
      els.searchableStatus.className = "row-sub ok";
    } else {
      els.searchableStatus.textContent =
        platform === "darwin"
          ? "Desktop shortcut missing. Click Recreate to add it."
          : "Couldn't find a Start menu shortcut. Click Recreate to add one.";
      els.searchableStatus.className = "row-sub err";
    }
  }
})();
