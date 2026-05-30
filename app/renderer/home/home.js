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

  /* ---------- wire critical navigation FIRST ---------- */
  // Doing this BEFORE any await guarantees that even if the data
  // fetching below throws, the user can still close the window or
  // open settings — i.e. they're never stuck on a "dead" Home page.

  if (els.capture) {
    els.capture.addEventListener("click", () => c2l.capture());
  }
  if (els.openSettings) {
    els.openSettings.addEventListener("click", () => c2l.openSettings());
  }
  for (const a of els.linkSettings || []) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      c2l.openSettings();
    });
  }
  if (els.done) {
    els.done.addEventListener("click", () => c2l.close());
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") c2l.close();
  });

  /* ---------- populate (best-effort) ---------- */

  let meta = {};
  let settings = {};
  try {
    meta = await c2l.getMeta();
    if (els.version) els.version.textContent = meta.version || "0.0.0";
  } catch (err) {
    console.error("[home] getMeta failed:", err);
  }
  try {
    settings = await c2l.getSettings();
    if (els.startWithWindows)
      els.startWithWindows.checked = !!settings.startWithWindows;
    if (els.showHomeOnStartup)
      els.showHomeOnStartup.checked = settings.showHomeOnStartup !== false;
    paintHotkey(settings.hotkey || meta.hotkey || "Alt+Shift+S");
  } catch (err) {
    console.error("[home] getSettings failed:", err);
  }

  try {
    await refreshShortcutStatus();
  } catch (err) {
    console.error("[home] refreshShortcutStatus failed:", err);
  }

  /* ---------- wire toggles + recreate ---------- */

  if (els.startWithWindows) {
    els.startWithWindows.addEventListener("change", async () => {
      const next = els.startWithWindows.checked;
      const ok = await c2l.setStartWithWindows(next);
      if (!ok) {
        els.startWithWindows.checked = !next;
      }
    });
  }

  if (els.showHomeOnStartup) {
    els.showHomeOnStartup.addEventListener("change", () => {
      c2l.setShowHomeOnStartup(els.showHomeOnStartup.checked);
    });
  }

  if (els.recreateShortcut) {
    els.recreateShortcut.addEventListener("click", async () => {
      if (els.searchableStatus) {
        els.searchableStatus.textContent = "Recreating shortcut…";
        els.searchableStatus.className = "row-sub";
      }
      const ok = await c2l.recreateShortcut();
      await refreshShortcutStatus(ok);
    });
  }

  /* ---------- helpers ---------- */

  /**
   * Renders the current hotkey as a row of <kbd> chips in both the
   * hero paragraph and the "Press the hotkey" step.
   */
  function paintHotkey(accel) {
    const parts = (accel || "Alt+Shift+S").split("+").map((p) => p.trim());
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

  async function refreshShortcutStatus(forcedOk) {
    const present =
      forcedOk === undefined ? await c2l.checkShortcut() : !!forcedOk;
    if (present) {
      els.searchableStatus.textContent =
        "Shortcut installed — search “Circle to Lens” in the Start menu.";
      els.searchableStatus.className = "row-sub ok";
    } else {
      els.searchableStatus.textContent =
        "Couldn't find a Start menu shortcut. Click Recreate to add one.";
      els.searchableStatus.className = "row-sub err";
    }
  }
})();
