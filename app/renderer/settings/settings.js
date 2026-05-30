/**
 * Circle to Lens — settings renderer.
 *
 * Reads the persisted settings on load, populates the form, and
 * writes any change back to main immediately (auto-save). A small
 * "Saved" flash in the footer confirms the round-trip.
 */

(async () => {
  const bridge = window.c2lSettings;
  if (!bridge) {
    console.error("[settings] preload missing");
    return;
  }

  const els = {
    hotkeyInput: document.getElementById("hotkey-input"),
    hotkeyDisplay: document.getElementById("hotkey-display"),
    hotkeyReset: document.getElementById("hotkey-reset"),
    hotkeyMsg: document.getElementById("hotkey-msg"),
    pencilStyle: document.querySelectorAll('input[name="pencilStyle"]'),
    convertToRect: document.getElementById("convertToRect"),
    openMode: document.querySelectorAll('input[name="openMode"]'),
    windowOpts: document.getElementById("window-opts"),
    windowPosition: document.querySelectorAll('input[name="windowPosition"]'),
    widthPct: document.getElementById("widthPct"),
    widthOut: document.getElementById("widthOut"),
    heightPct: document.getElementById("heightPct"),
    heightOut: document.getElementById("heightOut"),
    framePreview: document.getElementById("frame-preview"),
    showActionMenu: document.getElementById("showActionMenu"),
    actionMenuOpts: document.getElementById("action-menu-opts"),
    defaultAction: document.querySelectorAll('input[name="defaultAction"]'),
    menuPosition: document.querySelectorAll('input[name="menuPosition"]'),
    menuAlign: document.querySelectorAll('input[name="menuAlign"]'),
    menuAlignHint: document.getElementById("menu-align-hint"),
    menuAlignStartLabel: document.querySelector('[data-align-label="start"]'),
    menuAlignEndLabel: document.querySelector('[data-align-label="end"]'),
    menuStripPreview: document.getElementById("menu-strip-preview"),
    saveStatus: document.getElementById("save-status"),
    close: document.getElementById("close"),
  };

  /** @type {ReturnType<typeof initialSnapshot>} */
  let state = await bridge.read();
  paint(state);

  /* ------------- handlers ------------- */

  setupHotkeyCapture();

  for (const r of els.pencilStyle) {
    r.addEventListener("change", () => {
      state = update({ pencilStyle: r.value });
    });
  }

  els.convertToRect.addEventListener("change", () => {
    state = update({ convertToRect: els.convertToRect.checked });
  });

  for (const r of els.openMode) {
    r.addEventListener("change", () => {
      state = update({ openMode: r.value });
      paintWindowVisibility(state.openMode);
    });
  }

  for (const r of els.windowPosition) {
    r.addEventListener("change", () => {
      state = update({ windowPosition: r.value });
      paintPreview(state);
    });
  }

  els.widthPct.addEventListener("input", () => {
    const v = Number(els.widthPct.value);
    els.widthOut.textContent = v + "%";
    paintPreview({ ...state, windowWidthPct: v });
  });
  els.widthPct.addEventListener("change", () => {
    state = update({ windowWidthPct: Number(els.widthPct.value) });
  });

  els.heightPct.addEventListener("input", () => {
    const v = Number(els.heightPct.value);
    els.heightOut.textContent = v + "%";
    paintPreview({ ...state, windowHeightPct: v });
  });
  els.heightPct.addEventListener("change", () => {
    state = update({ windowHeightPct: Number(els.heightPct.value) });
  });

  els.showActionMenu.addEventListener("change", () => {
    state = update({ showActionMenu: els.showActionMenu.checked });
    paintActionMenuVisibility(state.showActionMenu);
  });

  for (const r of els.defaultAction) {
    r.addEventListener("change", () => {
      state = update({ defaultAction: r.value });
    });
  }

  for (const r of els.menuPosition) {
    r.addEventListener("change", () => {
      state = update({ menuPosition: r.value });
      paintMenuAlignLabels(state.menuPosition);
      paintMenuPreview(state.menuPosition, state.menuAlign);
    });
  }

  for (const r of els.menuAlign) {
    r.addEventListener("change", () => {
      state = update({ menuAlign: r.value });
      paintMenuPreview(state.menuPosition, state.menuAlign);
    });
  }

  els.close.addEventListener("click", () => bridge.close());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") bridge.close();
  });

  /* ------------- helpers ------------- */

  function update(patch) {
    bridge.write(patch).then(() => flashSaved());
    return { ...state, ...patch };
  }

  let flashTimer = 0;
  function flashSaved() {
    els.saveStatus.textContent = "Saved";
    els.saveStatus.classList.add("flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      els.saveStatus.textContent = "Saved automatically";
      els.saveStatus.classList.remove("flash");
    }, 1100);
  }

  function paint(s) {
    els.hotkeyDisplay.textContent = s.hotkey || "Alt+Shift+S";

    for (const r of els.pencilStyle) r.checked = r.value === s.pencilStyle;
    els.convertToRect.checked = !!s.convertToRect;
    for (const r of els.openMode) r.checked = r.value === s.openMode;
    for (const r of els.windowPosition)
      r.checked = r.value === s.windowPosition;

    els.widthPct.value = s.windowWidthPct;
    els.widthOut.textContent = s.windowWidthPct + "%";
    els.heightPct.value = s.windowHeightPct;
    els.heightOut.textContent = s.windowHeightPct + "%";

    els.showActionMenu.checked = s.showActionMenu !== false;
    for (const r of els.defaultAction)
      r.checked = r.value === (s.defaultAction || "lens");
    for (const r of els.menuPosition)
      r.checked = r.value === (s.menuPosition || "top");
    for (const r of els.menuAlign)
      r.checked = r.value === (s.menuAlign || "center");

    paintWindowVisibility(s.openMode);
    paintPreview(s);
    paintActionMenuVisibility(s.showActionMenu !== false);
    paintMenuAlignLabels(s.menuPosition || "top");
    paintMenuPreview(s.menuPosition || "top", s.menuAlign || "center");
  }

  /* ---------- hotkey capture ---------- */

  function setupHotkeyCapture() {
    let listening = false;

    function startListening() {
      if (listening) return;
      listening = true;
      els.hotkeyInput.classList.add("listening");
      els.hotkeyDisplay.textContent = "Press a combo…";
      setHotkeyMsg("");
    }

    function stopListening(committedAccel) {
      listening = false;
      els.hotkeyInput.classList.remove("listening");
      els.hotkeyDisplay.textContent = committedAccel || state.hotkey || "Alt+Shift+S";
    }

    els.hotkeyInput.addEventListener("click", startListening);
    els.hotkeyInput.addEventListener("focus", startListening);
    els.hotkeyInput.addEventListener("blur", () => {
      if (listening) stopListening(state.hotkey);
    });

    els.hotkeyReset.addEventListener("click", async () => {
      await commitHotkey("Alt+Shift+S");
      stopListening("Alt+Shift+S");
    });

    document.addEventListener("keydown", async (e) => {
      if (!listening) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        stopListening(state.hotkey);
        return;
      }

      const accel = eventToAccelerator(e);
      if (!accel) {
        // Pure modifier press — just preview the modifiers so the
        // user gets feedback they're being seen.
        const mods = collectModifiers(e);
        if (mods.length) els.hotkeyDisplay.textContent = mods.join("+") + "+…";
        return;
      }

      await commitHotkey(accel);
      stopListening(accel);
    });
  }

  async function commitHotkey(accel) {
    setHotkeyMsg("Applying…");
    const result = await bridge.write({ hotkey: accel });
    state = { ...state, ...result };
    // Main returns a hotkeyError property if registration failed.
    if (result.hotkeyError) {
      setHotkeyMsg(result.hotkeyError, "err");
    } else if (result.hotkey === accel) {
      setHotkeyMsg(`Set to ${accel}`, "ok");
      setTimeout(() => setHotkeyMsg(""), 2200);
      flashSaved();
    } else {
      setHotkeyMsg("Reverted — that combo couldn't be registered.", "err");
    }
  }

  function setHotkeyMsg(text, cls) {
    els.hotkeyMsg.textContent = text || "";
    els.hotkeyMsg.className = "hotkey-msg" + (cls ? " " + cls : "");
  }

  function collectModifiers(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    return parts;
  }

  /**
   * Convert a KeyboardEvent into an Electron accelerator string.
   * Returns null if the press is a pure modifier (Ctrl alone, etc.) —
   * caller should keep listening.
   */
  function eventToAccelerator(e) {
    const mods = collectModifiers(e);
    const key = e.key;
    const isModifier = ["Control", "Alt", "Shift", "Meta", "OS"].includes(key);
    if (isModifier) return null;
    if (mods.length === 0) return null; // need at least one modifier

    let accelKey;
    if (key === " ") accelKey = "Space";
    else if (key === "Escape") accelKey = "Escape";
    else if (key === "ArrowUp") accelKey = "Up";
    else if (key === "ArrowDown") accelKey = "Down";
    else if (key === "ArrowLeft") accelKey = "Left";
    else if (key === "ArrowRight") accelKey = "Right";
    else if (key === "Enter") accelKey = "Return";
    else if (/^F\d{1,2}$/.test(key)) accelKey = key;
    else if (key.length === 1) accelKey = key.toUpperCase();
    else accelKey = key;

    return [...mods, accelKey].join("+");
  }

  function paintWindowVisibility(openMode) {
    els.windowOpts.classList.toggle("show", openMode === "window");
  }

  function paintActionMenuVisibility(show) {
    if (!els.actionMenuOpts) return;
    els.actionMenuOpts.classList.toggle("show", !!show);
  }

  /**
   * Update the little "screen" mockup to show a docked strip of
   * dots where the action menu will appear on the overlay. Pure
   * visual feedback so users picking "Left" vs "Top" can see what
   * they're choosing without firing the hotkey. Reflects both
   * position (which edge) and align (where along that edge).
   */
  function paintMenuPreview(position, align) {
    const strip = els.menuStripPreview;
    if (!strip) return;
    strip.dataset.position = position || "top";
    strip.dataset.align = align || "center";
  }

  /**
   * The "start / center / end" choices need different verbal labels
   * depending on whether the docked axis is horizontal (top/bottom)
   * or vertical (left/right). Keeps the UI concrete:
   *   horizontal → Left / Center / Right
   *   vertical   → Top  / Center / Bottom
   */
  function paintMenuAlignLabels(position) {
    const isHorizontal = position === "top" || position === "bottom";
    if (els.menuAlignStartLabel) {
      els.menuAlignStartLabel.textContent = isHorizontal ? "Left" : "Top";
    }
    if (els.menuAlignEndLabel) {
      els.menuAlignEndLabel.textContent = isHorizontal ? "Right" : "Bottom";
    }
    if (els.menuAlignHint) {
      els.menuAlignHint.textContent = isHorizontal
        ? "Where along the horizontal edge the menu sits."
        : "Where along the vertical edge the menu sits.";
    }
  }

  /**
   * Update the little screen-mockup preview to match the chosen
   * position + size — this is the "live preview of the docked window"
   * caption in the UI.
   */
  function paintPreview(s) {
    const f = els.framePreview;
    const w = s.windowWidthPct + "%";
    const h = s.windowHeightPct + "%";
    f.style.width = w;
    f.style.height = h;
    // Vertical centering when not full height.
    f.style.top = s.windowHeightPct === 100 ? "0" : (100 - s.windowHeightPct) / 2 + "%";

    f.style.left = "auto";
    f.style.right = "auto";
    if (s.windowPosition === "left") {
      f.style.left = "0";
    } else if (s.windowPosition === "right") {
      f.style.right = "0";
    } else {
      f.style.left = (100 - s.windowWidthPct) / 2 + "%";
    }
  }
})();
