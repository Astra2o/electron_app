/**
 * Circle to Lens — overlay renderer.
 *
 * Responsibilities:
 *   1. Receive the captured screen (data URL), display metadata, and
 *      user settings from main.
 *   2. Render the screenshot beneath a dim layer so the user has
 *      visual reference for what they're circling.
 *   3. Draw a freehand lasso path styled by the user's pencil
 *      preference (RGB glow, classic white, neon green, indigo ink).
 *   4. On mouse-up:
 *        - If "snap to rectangle" is enabled, replace the freehand
 *          polygon with its bounding-box rectangle, brighten the
 *          area inside the rectangle, and darken everything outside.
 *        - Otherwise, just close the polygon as before.
 *      Then crop the captured screen to that polygon/rectangle and
 *      send the cropped PNG to main, which uploads to Lens.
 */

(() => {
  const screenshotEl = document.getElementById("screenshot");
  const dimEl = document.getElementById("dim");
  const lasso = document.getElementById("lasso");
  const hint = document.getElementById("hint");
  const hintAction = document.getElementById("hint-action");
  const toast = document.getElementById("toast");
  const actionMenu = document.getElementById("action-menu");
  const langPicker = document.getElementById("lang-picker");
  const langButton = document.getElementById("lang-picker-button");
  const langList = document.getElementById("lang-picker-list");
  const langTargetName = document.getElementById("lang-target-name");
  const resultCard = document.getElementById("result-card");
  const resultClose = document.getElementById("result-close");
  const loadingStatus = document.getElementById("loading-status");
  const loadingSub = document.getElementById("loading-sub");
  const resultDetected = document.getElementById("result-detected");
  const resultTarget = document.getElementById("result-target");
  const resultTranslated = document.getElementById("result-translated");
  const resultOriginal = document.getElementById("result-original");
  const copyTranslatedBtn = document.getElementById("copy-translated");
  const copyOriginalBtn = document.getElementById("copy-original");
  const errorMessage = document.getElementById("error-message");
  const errorRetry = document.getElementById("error-retry");
  /* ----- New layers + UI for no-draw modes ----- */
  const textLayer = document.getElementById("text-layer");
  const translateLayer = document.getElementById("translate-layer");
  const ocrLoading = document.getElementById("ocr-loading");
  const ocrLoadingText = document.getElementById("ocr-loading-text");
  const selectionToolbar = document.getElementById("selection-toolbar");
  const selCopyBtn = document.getElementById("sel-copy");
  const selTranslateBtn = document.getElementById("sel-translate");
  const ctx = lasso.getContext("2d");

  /* ----------------------------------------------------------------------
   *  Languages — supported targets for the Translate picker. Emojis are
   *  cosmetic only; ISO 639-1 codes are what we send to the translate
   *  API. Keep in sync with settings-store.js → validLangs.
   * ---------------------------------------------------------------------- */
  const LANGUAGES = [
    { code: "en", name: "English",    emoji: "🇬🇧" },
    { code: "hi", name: "Hindi",      emoji: "🇮🇳" },
    { code: "es", name: "Spanish",    emoji: "🇪🇸" },
    { code: "fr", name: "French",     emoji: "🇫🇷" },
    { code: "de", name: "German",     emoji: "🇩🇪" },
    { code: "it", name: "Italian",    emoji: "🇮🇹" },
    { code: "pt", name: "Portuguese", emoji: "🇵🇹" },
    { code: "ru", name: "Russian",    emoji: "🇷🇺" },
    { code: "ja", name: "Japanese",   emoji: "🇯🇵" },
    { code: "ko", name: "Korean",     emoji: "🇰🇷" },
    { code: "zh", name: "Chinese",    emoji: "🇨🇳" },
    { code: "ar", name: "Arabic",     emoji: "🇸🇦" },
    { code: "bn", name: "Bengali",    emoji: "🇧🇩" },
    { code: "ta", name: "Tamil",      emoji: "🇮🇳" },
    { code: "te", name: "Telugu",     emoji: "🇮🇳" },
    { code: "mr", name: "Marathi",    emoji: "🇮🇳" },
    { code: "gu", name: "Gujarati",   emoji: "🇮🇳" },
    { code: "ur", name: "Urdu",       emoji: "🇵🇰" },
  ];

  function langName(code) {
    const l = LANGUAGES.find((x) => x.code === code);
    return l ? l.name : (code || "English");
  }

  /* ----------------------------------------------------------------------
   *  Action mode — which action runs when the user releases the lasso.
   *  Initialised from settings.defaultAction, mutated when the user
   *  clicks a different button in the floating action menu BEFORE
   *  drawing. Once drawing starts the menu hides and the mode is
   *  locked in for that capture.
   * ---------------------------------------------------------------------- */
  let currentAction = "lens";

  /** Human-readable verb shown in the hint chip for each mode. */
  const ACTION_VERBS = {
    lens:      "Draw around something to search with Lens",
    translate: "Drag a rectangle over text to translate it in place",
    ocr:       "Drag a rectangle over text — then select it like a PDF",
    copy:      "Drag a rectangle over text — then select & copy",
  };

  /** Current device pixel ratio for crisp rendering. */
  let dpr = window.devicePixelRatio || 1;

  /** Original screenshot kept as Image for cropping. */
  const screenImg = new Image();
  let screenshotReady = false;

  /**
   * Display metadata from main.
   * @type {{x:number,y:number,width:number,height:number,scaleFactor:number}}
   */
  let display = null;

  /** Pencil + behavior settings from main (filled in onInit). */
  let settings = {
    pencilStyle: "rgb",
    convertToRect: true,
    showActionMenu: true,
    menuPosition: "top",
    menuAlign: "center",
    defaultAction: "lens",
    translateTo: "en",
  };

  /** Currently-chosen target language for Translate. Sourced from
   *  settings.translateTo on init and mutated by the picker. The
   *  main process is told whenever this changes so it's persisted
   *  for the next capture. */
  let targetLang = "en";

  /** Cache of the last cropped PNG (Lens mode only — used by submit
   *  in case we ever need to re-run the upload). */
  let lastCroppedDataUrl = null;

  /** Last rect-mode capture: cropped PNG + viewport-CSS rect bbox +
   *  the OCR lines returned for it. Lets us re-translate to a new
   *  language WITHOUT re-running OCR, and lets the user flip between
   *  Translate / Select-text / Copy on the same rect (e.g. translate
   *  → switch to ocr → selectable text appears instantly). */
  let lastRect = null; // { croppedDataUrl, rectCss: {x,y,w,h}, ocr: { lines, text } }

  /** Last text the user asked to translate via the selection toolbar.
   *  Used by the result card's "Try again" button to retry the same
   *  translation without making the user re-select. */
  let lastSelectionTranslate = null; // { text: string, target: string } | null

  /** Polygon points in CSS px (relative to the overlay window). */
  let points = [];
  let drawing = false;
  let busy = false;

  /** True while the user is dragging in a non-Lens mode. Drawing in
   *  these modes is a clean Snipping-Tool-style rectangle (origin →
   *  current corner) rather than the free-form Lens lasso. */
  let rectMode = false;
  /** Origin (anchor corner) of the current rect-mode drag. */
  let rectOrigin = null;

  /** When snap-to-rect kicks in we replace `points` with 4 rect corners
   *  and set this flag so the draw step knows to render the spotlight
   *  + rectangle outline rather than the freehand path. */
  let snapped = false;

  /* ----------------------------------------------------------------------
   *  Pencil presets — color, line widths, glow layers
   * ---------------------------------------------------------------------- */

  const PENCIL_STYLES = {
    // Original signature look — white core, animated RGB rainbow halo.
    rgb: {
      core: "#ffffff",
      coreWidth: 2.4,
      animatedRgb: true,
    },
    // Pure white pencil — no glow, just a soft white shadow.
    classic: {
      core: "#ffffff",
      coreWidth: 2.4,
      glow: [{ blur: 10, color: "rgba(255,255,255,0.45)", width: 2 }],
    },
    // Bright green neon — feels like a tactical HUD highlight.
    neon: {
      core: "#c8ffe8",
      coreWidth: 2.6,
      glow: [
        { blur: 18, color: "#00ff88", width: 2 },
        { blur: 30, color: "#00cc66", width: 2 },
      ],
    },
    // Indigo ink — heavier line + soft blue halo.
    ink: {
      core: "#dde2ff",
      coreWidth: 2.8,
      glow: [
        { blur: 16, color: "#5b8def", width: 2.2 },
        { blur: 26, color: "#3b66c4", width: 2.2 },
      ],
    },
  };

  function pencil() {
    return PENCIL_STYLES[settings.pencilStyle] || PENCIL_STYLES.rgb;
  }

  /* ----------------------------------------------------------------------
   *  Boot
   * ---------------------------------------------------------------------- */

  if (window.lens?.onInit) {
    window.lens.onInit(({ dataUrl, display: d, settings: s }) => {
      display = d;
      if (s && typeof s === "object") {
        settings = { ...settings, ...s };
      }
      currentAction = settings.defaultAction || "lens";
      targetLang = settings.translateTo || "en";
      document.body.dataset.mode = currentAction;
      setupActionMenu();
      setupLangPicker();
      setupResultCard();
      setupSelectionToolbar();
      screenImg.onload = () => {
        screenshotReady = true;
        screenshotEl.src = dataUrl;
        sizeCanvas();
        showHint();
        // Every action is now drag-based: Lens = free-form lasso,
        // Translate / Select-text / Copy = rectangle drag. We don't
        // auto-run OCR anywhere — the user always draws first so
        // they only pay the OCR cost on the region they actually
        // care about.
      };
      screenImg.src = dataUrl;
    });
  } else {
    console.error("[overlay] preload bridge missing — window.lens not exposed");
  }

  /* ----------------------------------------------------------------------
   *  Action menu — render position, wire button clicks, expose
   *  hide() so drawing can fade it out instantly.
   * ---------------------------------------------------------------------- */

  function setupActionMenu() {
    if (!actionMenu) return;

    // Honour the "completely hide the menu" preference (advanced
    // users who only ever use Lens via drawing).
    if (!settings.showActionMenu) {
      actionMenu.style.display = "none";
      return;
    }

    actionMenu.dataset.position = settings.menuPosition || "top";
    actionMenu.dataset.align    = settings.menuAlign    || "center";
    paintSelectedAction();

    for (const btn of actionMenu.querySelectorAll(".action")) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const a = btn.dataset.action;
        if (!a || a === currentAction) return;
        switchToMode(a);
      });
      // Block pointerdown from triggering the lasso drawing
      // underneath the menu — clicking the menu must never start
      // a lasso. (The overlay window listens at window-level so
      // the pointerdown would otherwise propagate.)
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    }

    // Fade in shortly after open so the menu doesn't pop in
    // immediately and feel jumpy.
    requestAnimationFrame(() => actionMenu.classList.add("show"));
    updateHintForAction();
  }

  function paintSelectedAction() {
    if (!actionMenu) return;
    for (const btn of actionMenu.querySelectorAll(".action")) {
      btn.classList.toggle("selected", btn.dataset.action === currentAction);
    }
  }

  function updateHintForAction() {
    if (!hintAction) return;
    hintAction.textContent =
      ACTION_VERBS[currentAction] || ACTION_VERBS.lens;
  }

  function hideActionMenu() {
    if (!actionMenu) return;
    actionMenu.classList.remove("show");
    actionMenu.classList.add("hide");
  }

  /** Bring the menu back after a capture finishes so the user can
   *  switch action (or language) and draw another rect without
   *  having to dismiss the overlay first. */
  function showActionMenu() {
    if (!actionMenu) return;
    if (!settings.showActionMenu) return;
    actionMenu.classList.remove("hide");
    requestAnimationFrame(() => actionMenu.classList.add("show"));
  }

  /* ----------------------------------------------------------------------
   *  Language picker — only shown when Translate is the active action.
   *  Anchors itself relative to the action menu's dock position so the
   *  picker never overlaps the menu strip.
   * ---------------------------------------------------------------------- */

  function setupLangPicker() {
    if (!langPicker) return;

    // Build the dropdown list once.
    if (langList && !langList.dataset.built) {
      langList.dataset.built = "1";
      const frag = document.createDocumentFragment();
      for (const lang of LANGUAGES) {
        const li = document.createElement("li");
        li.dataset.code = lang.code;
        li.setAttribute("role", "option");
        li.innerHTML =
          `<span class="lang-emoji">${lang.emoji}</span>` +
          `<span class="lang-name">${lang.name}</span>` +
          `<span class="lang-code">${lang.code}</span>`;
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          selectLang(lang.code);
          closeLangList();
        });
        li.addEventListener("pointerdown", (e) => e.stopPropagation());
        frag.appendChild(li);
      }
      langList.appendChild(frag);
    }

    // Anchor picker next to the action menu based on dock position
    // AND alignment so it always sits flush with the menu strip
    // (centred / start-edge / end-edge).
    const pos = settings.menuPosition || "top";
    const align = settings.menuAlign || "center";
    langPicker.dataset.position = pos;
    langPicker.dataset.align = align;
    Object.assign(langPicker.style, anchorForPicker(pos, align));

    paintSelectedLang();
    updateLangPickerVisibility();

    // Toggle dropdown on button click.
    langButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (langList.hasAttribute("hidden")) openLangList();
      else closeLangList();
    });
    langButton.addEventListener("pointerdown", (e) => e.stopPropagation());

    // Click outside closes the dropdown.
    document.addEventListener("click", () => closeLangList());
  }

  /**
   * Pick the picker's CSS offsets so it always sits next to the
   * action menu — same dock edge (perpendicular axis matches the
   * menu) and same alignment (parallel axis matches start/center/
   * end). The reset object clears every offset so the previous
   * position doesn't leak between sessions.
   */
  function anchorForPicker(pos, align) {
    const base = {
      top: "auto", bottom: "auto", left: "auto", right: "auto",
    };
    const alignCss = (axis /* "h" | "v" */) => {
      if (axis === "h") {
        if (align === "start") return { left: "24px" };
        if (align === "end")   return { right: "24px" };
        return { left: "50%" };
      }
      if (align === "start") return { top: "64px" };
      if (align === "end")   return { bottom: "64px" };
      return { top: "50%" };
    };
    switch (pos) {
      case "bottom":
        return { ...base, bottom: "144px", ...alignCss("h") };
      case "left":
        return { ...base, left: "100px", ...alignCss("v") };
      case "right":
        return { ...base, right: "100px", ...alignCss("v") };
      case "top":
      default:
        return { ...base, top: "116px", ...alignCss("h") };
    }
  }

  function updateLangPickerVisibility() {
    if (!langPicker) return;
    const show = currentAction === "translate" && settings.showActionMenu !== false;
    langPicker.hidden = !show;
    if (show) {
      requestAnimationFrame(() => langPicker.classList.add("show"));
    } else {
      langPicker.classList.remove("show");
      closeLangList();
    }
  }

  function openLangList() {
    if (!langList || !langButton) return;
    langList.hidden = false;
    langButton.setAttribute("aria-expanded", "true");
    paintSelectedLang();
  }

  function closeLangList() {
    if (!langList || !langButton) return;
    langList.hidden = true;
    langButton.setAttribute("aria-expanded", "false");
  }

  function selectLang(code) {
    targetLang = code;
    paintSelectedLang();
    // Persist the user's last-selected language so the next overlay
    // opens with it already selected.
    if (window.lens?.setTranslateTarget) {
      window.lens.setTranslateTarget(code).catch(() => {});
    }
    // If we already have a translated rect on screen, re-translate
    // from the cached OCR so the picker feels live (no second
    // tesseract pass).
    if (currentAction === "translate" && lastRect?.ocr?.lines?.length) {
      rerunTranslateFromCache();
    }
  }

  function paintSelectedLang() {
    if (langTargetName) langTargetName.textContent = langName(targetLang);
    if (!langList) return;
    for (const li of langList.querySelectorAll("li")) {
      const selected = li.dataset.code === targetLang;
      li.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function sizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    lasso.width = Math.round(w * dpr);
    lasso.height = Math.round(h * dpr);
    lasso.style.width = w + "px";
    lasso.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  window.addEventListener("resize", sizeCanvas, { passive: true });

  /* ----------------------------------------------------------------------
   *  Input
   * ---------------------------------------------------------------------- */

  window.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("keydown", onKey);
  // Suppress the browser context menu — right-clicks on the overlay
  // should be inert (otherwise the native menu briefly steals focus
  // and the active capture/selection visually "disappears").
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  /**
   * True when a pointer event originated on a UI element that owns
   * its own behaviour (action menu, language picker, result card,
   * selection toolbar) OR on a rendered text/translation span. Used
   * by onDown to decide whether to start a new draw or let the
   * event flow through to that element.
   */
  function isInteractiveTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return !!(
      target.closest("#action-menu") ||
      target.closest("#lang-picker") ||
      target.closest("#result-card") ||
      target.closest("#selection-toolbar") ||
      target.closest("#text-layer") ||
      target.closest("#translate-layer")
    );
  }

  function onDown(e) {
    // Ignore everything that isn't a primary (left) button. Without
    // this filter, a right-click anywhere on the overlay would race
    // with the user's in-progress left-drag (right's pointerup
    // would finalise the rect early, which is exactly the "rect
    // disappears before I'm done" symptom users were hitting).
    if (busy || e.button !== 0) return;

    // Don't restart drawing if the pointer is on an existing
    // rendered span or floating UI — that means the user wants to
    // INTERACT with that element (select OCR text, click a
    // translation pill, hit a menu button), not redraw.
    if (isInteractiveTarget(e.target)) return;

    // In non-Lens modes with a finalised rect, pointerdowns INSIDE
    // the rect must not wipe the OCR layer — the user is trying to
    // select text or click a translation. Native browser selection
    // will start from the cursor position even if it lands in a
    // gap between line spans (the .ocr-line spans handle the
    // actual highlighting). To start a fresh rect the user simply
    // drags OUTSIDE the existing one — or presses Esc.
    if (currentAction !== "lens" && lastRect?.rectCss) {
      const r = lastRect.rectCss;
      if (
        e.clientX >= r.x &&
        e.clientX <= r.x + r.w &&
        e.clientY >= r.y &&
        e.clientY <= r.y + r.h
      ) {
        return;
      }
    }

    drawing = true;
    snapped = false;
    rectMode = currentAction !== "lens";
    rectOrigin = rectMode ? { x: e.clientX, y: e.clientY } : null;

    // New drag begins — wipe any previous mode's render surface so
    // the user gets a clean slate.
    clearTextLayer();
    clearTranslateLayer();
    hideSelectionToolbar();
    hideOcrLoading();

    // Drawing begins — hide the floating action menu so it never
    // gets in the way, and dismiss the hint chip too.
    hideActionMenu();
    if (hint) hint.classList.remove("show");
    // Restore CSS dim if a previous failed attempt left it hidden.
    if (dimEl) dimEl.style.opacity = "";
    points = [{ x: e.clientX, y: e.clientY }];
    redraw();
    e.preventDefault();
  }

  function onMove(e) {
    if (!drawing) return;
    if (rectMode) {
      // Pure Snipping-Tool rect: replace `points` with the 4-corner
      // polygon derived from the anchor + current cursor on EVERY
      // move. snapped=true makes redraw() use the spotlight-rect
      // path (dim outside + outline + corner ticks), which is the
      // visual we want for these modes.
      points = rectCornersFromAnchor(rectOrigin, { x: e.clientX, y: e.clientY });
      snapped = true;
      return;
    }
    const last = points[points.length - 1];
    if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 2) return;
    points.push({ x: e.clientX, y: e.clientY });
  }

  async function onUp(e) {
    // Only the LEFT button finalises the drag. Other buttons (right
    // / middle / mouse-back) firing pointerup while the user is
    // mid-drag must be ignored, otherwise the rectangle commits
    // before the user lets go of the left button.
    if (e && e.button !== 0) return;
    if (!drawing) return;
    drawing = false;

    // Minimum-size guard. Lens needs a free-form path (>= 6 pts);
    // rect-mode just needs a non-trivial rectangle.
    if (rectMode) {
      const rect = rectFromPolygon(points);
      if (!rect || rect.w < 6 || rect.h < 6) {
        points = [];
        snapped = false;
        rectMode = false;
        rectOrigin = null;
        redraw();
        return;
      }
    } else if (points.length < 6) {
      points = [];
      redraw();
      return;
    }

    // Lens optionally snaps freehand to its bbox rect on release.
    if (!rectMode && settings.convertToRect) {
      points = polygonBoundingRect(points);
      snapped = true;
    }

    busy = true;
    cancelAnimationFrame(rafId);
    redraw(true);
    await submit();
  }

  /**
   * 4-corner polygon (TL, TR, BR, BL) for a rectangle anchored at
   * `a` with the opposite corner at `b`. Used by rect-mode onMove.
   */
  function rectCornersFromAnchor(a, b) {
    const minX = Math.max(0, Math.min(a.x, b.x));
    const minY = Math.max(0, Math.min(a.y, b.y));
    const maxX = Math.min(window.innerWidth,  Math.max(a.x, b.x));
    const maxY = Math.min(window.innerHeight, Math.max(a.y, b.y));
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }

  /** Returns viewport-CSS bbox {x, y, w, h} for a polygon. */
  function rectFromPolygon(poly) {
    if (!poly || poly.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  /* ----------------------------------------------------------------------
   *  Geometry helpers
   * ---------------------------------------------------------------------- */

  /** Returns 4-point polygon (TL, TR, BR, BL) representing the bbox. */
  function polygonBoundingRect(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // Tight crop with a small padding so the lasso's stroke isn't
    // touching the very edge of the result image.
    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(window.innerWidth, maxX + pad);
    maxY = Math.min(window.innerHeight, maxY + pad);
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }

  /* ----------------------------------------------------------------------
   *  Drawing — animated until release, then static crop frame
   * ---------------------------------------------------------------------- */

  /** Hue rotation phase (radians-ish; just a time accumulator). */
  let phase = 0;
  let rafId = 0;

  function tick() {
    phase += 0.018;
    redraw();
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  function redraw(closed = false) {
    if (!ctx) return;
    const w = lasso.width / dpr;
    const h = lasso.height / dpr;
    ctx.clearRect(0, 0, w, h);

    if (points.length < 2) return;

    // If we've snapped to a rectangle, render the snipping-tool style
    // spotlight + clean rectangle outline. The freehand path code is
    // skipped entirely in that branch.
    if (snapped) {
      drawSpotlightRect();
      return;
    }

    // ----- freehand path -----
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    if (closed) ctx.closePath();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    strokeWithPencil(ctx, closed);
  }

  /**
   * Strokes the current `ctx` path with the chosen pencil style.
   * For "rgb" the glow hues rotate over time using `phase`.
   */
  function strokeWithPencil(c, closed) {
    const p = pencil();

    if (p.animatedRgb) {
      const HUE_OFFSETS = [0, 120, 240];
      const BLURS = [22, 30, 38];
      for (let i = 0; i < HUE_OFFSETS.length; i++) {
        const hue = ((phase * 60) + HUE_OFFSETS[i]) % 360;
        const color = `hsl(${hue}, 100%, 60%)`;
        c.save();
        c.shadowBlur = BLURS[i];
        c.shadowColor = color;
        c.strokeStyle = color;
        c.globalAlpha = 0.85 - i * 0.18;
        c.lineWidth = 2;
        c.stroke();
        c.restore();
      }
    } else if (Array.isArray(p.glow)) {
      for (const layer of p.glow) {
        c.save();
        c.shadowBlur = layer.blur;
        c.shadowColor = layer.color;
        c.strokeStyle = layer.color;
        c.lineWidth = layer.width;
        c.stroke();
        c.restore();
      }
    }

    if (closed) {
      c.save();
      c.shadowBlur = 0;
      c.fillStyle = "rgba(255, 255, 255, 0.06)";
      c.fill();
      c.restore();
    }

    // Sharp core line on top.
    c.save();
    c.shadowBlur = 0;
    c.shadowColor = "transparent";
    c.strokeStyle = p.core;
    c.lineWidth = p.coreWidth;
    c.stroke();
    c.restore();
  }

  /**
   * Snap-to-rectangle "snipping-tool" effect:
   *   - Fill the entire canvas with a strong dim overlay.
   *   - Punch out the rectangle (destination-out) so the screenshot
   *     pixels show through clearly inside the rect.
   *   - Stroke the rectangle outline in the user's pencil style.
   *
   * Also hides the page's underlying dim layer so the contrast is
   * dramatic — only the canvas overlay is visible.
   */
  function drawSpotlightRect() {
    if (points.length < 4) return;
    const w = lasso.width / dpr;
    const h = lasso.height / dpr;
    const [tl, , br] = points;
    const x = tl.x, y = tl.y, rw = br.x - tl.x, rh = br.y - tl.y;

    // Hide the underlying dim — we own the dimming now.
    if (dimEl) dimEl.style.opacity = "0";

    // Step 1: dark blanket.
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, w, h);

    // Step 2: punch the rectangle hole.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(x, y, rw, rh);
    ctx.restore();

    // Step 3: rectangle outline in pencil style.
    ctx.beginPath();
    ctx.rect(x, y, rw, rh);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeWithPencil(ctx, true);

    // Small corner ticks — same as snipping tool.
    const tickLen = 12;
    ctx.save();
    ctx.strokeStyle = pencil().core;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // TL
    ctx.moveTo(x, y + tickLen); ctx.lineTo(x, y); ctx.lineTo(x + tickLen, y);
    // TR
    ctx.moveTo(x + rw - tickLen, y); ctx.lineTo(x + rw, y); ctx.lineTo(x + rw, y + tickLen);
    // BR
    ctx.moveTo(x + rw, y + rh - tickLen); ctx.lineTo(x + rw, y + rh); ctx.lineTo(x + rw - tickLen, y + rh);
    // BL
    ctx.moveTo(x + tickLen, y + rh); ctx.lineTo(x, y + rh); ctx.lineTo(x, y + rh - tickLen);
    ctx.stroke();
    ctx.restore();
  }

  /* ----------------------------------------------------------------------
   *  Submit pipeline: crop polygon → PNG → main → Lens
   * ---------------------------------------------------------------------- */

  /**
   * Per-action labels used in the in-flight toast.
   */
  const ACTION_BUSY_LABEL = {
    lens: "Searching with Lens…",
    translate: "Translating…",
    ocr: "Reading text…",
    copy: "Reading text…",
  };

  async function submit() {
    try {
      if (!screenshotReady) throw new Error("Screenshot didn't load");
      const polygon = points;
      const rectCss = rectFromPolygon(polygon);

      if (currentAction === "lens") {
        // Lens wants the native-res crop (Google's UI shows exactly
        // that image as the search query).
        const { dataUrl } = await cropToPolygon(polygon, {
          upscaleForOcr: false,
        });
        lastCroppedDataUrl = dataUrl;
        setToast(`<span class="spinner"></span>${ACTION_BUSY_LABEL.lens}`);
        await runLens(dataUrl);
        return;
      }

      // OCR-bound flows get a separately-prepared crop that is
      // upscaled so Tesseract has at least ~30-px-tall glyphs.
      const crop = await cropToPolygon(polygon, { upscaleForOcr: true });

      if (currentAction === "translate") {
        await runRectTranslate(crop, rectCss);
        return;
      }
      if (currentAction === "ocr" || currentAction === "copy") {
        await runRectSelectText(crop, rectCss);
        return;
      }
    } catch (err) {
      console.error("[overlay] submit failed:", err);
      setToast(
        `Couldn't ${labelForAction(currentAction).toLowerCase()}: ${err?.message || err}`,
        true,
      );
      busy = false;
    }
  }

  async function runLens(croppedDataUrl) {
    const res = await window.lens.submit(croppedDataUrl);
    if (!res?.ok) throw new Error(res?.error || "upload failed");
    setToast(`<span class="check"></span>Sent to Lens`);
    setTimeout(closeFade, 600);
  }

  /* ======================================================================
   *  Mode switching + rect-mode runners
   *
   *  Drag interaction per mode:
   *    - lens       : free-form lasso (existing). Crop → Google Lens.
   *    - translate  : rectangle drag → OCR inside rect → translate
   *                   each line → render frosted-glass pills anchored
   *                   to each line WITHIN the rect (in-place).
   *    - ocr / copy : rectangle drag → OCR inside rect → render
   *                   invisible-but-selectable spans WITHIN the rect.
   *                   Selection toolbar (Copy + Translate) appears
   *                   next to the user's selection.
   *
   *  After a rect-mode capture we cache the OCR result under
   *  `lastRect`. That lets switching ocr ⇄ translate, or changing
   *  language inside translate, render instantly without re-running
   *  tesseract.
   * ====================================================================== */

  function switchToMode(mode) {
    currentAction = mode;
    document.body.dataset.mode = mode;
    paintSelectedAction();
    updateHintForAction();
    updateLangPickerVisibility();

    // Tear down whatever render surface the previous mode had.
    clearTextLayer();
    clearTranslateLayer();
    hideSelectionToolbar();
    hideOcrLoading();

    if (mode === "lens") {
      if (dimEl) dimEl.style.opacity = "";
      if (hint) hint.classList.add("show");
      return;
    }

    // For non-Lens modes, if the user already drew a rect this
    // session we can re-render from cache instantly. Otherwise just
    // surface the hint to draw one.
    if (lastRect?.ocr?.lines?.length) {
      if (mode === "translate") {
        rerunTranslateFromCache();
      } else if (mode === "ocr" || mode === "copy") {
        renderSelectableText(
          lastRect.ocr.lines,
          lastRect.rectCss,
          lastRect.pxPerCssPx,
        );
        setToast(
          `<span class="check"></span>${lastRect.ocr.lines.length} lines ready — drag to select`,
        );
        setTimeout(() => toast?.classList?.remove("show"), 1800);
      }
    } else if (hint) {
      hint.classList.add("show");
    }
  }

  /* ----------------------------------------------------------------------
   *  Loading indicator (shared by both rect runners)
   * ---------------------------------------------------------------------- */

  function showOcrLoading(text) {
    if (!ocrLoading) return;
    if (ocrLoadingText && text) ocrLoadingText.textContent = text;
    ocrLoading.hidden = false;
  }
  function setOcrLoadingText(text) {
    if (ocrLoadingText && text) ocrLoadingText.textContent = text;
  }
  function hideOcrLoading() {
    if (ocrLoading) ocrLoading.hidden = true;
  }

  /* ----------------------------------------------------------------------
   *  Helpers — convert tesseract bboxes (in CROPPED-image pixels)
   *  to viewport CSS px so we can position selectable spans /
   *  translation pills exactly on top of each line WITHIN the rect.
   *
   *  The cropped image we sent to OCR is at `pxPerCssPx` pixels per
   *  CSS pixel (= display.scaleFactor × any OCR upscale factor we
   *  applied). To place a bbox back onto the viewport:
   *
   *      cssX = rectCss.x + bbox.x0 / pxPerCssPx
   *      cssY = rectCss.y + bbox.y0 / pxPerCssPx
   *      cssW = (bbox.x1 - bbox.x0) / pxPerCssPx
   *      cssH = (bbox.y1 - bbox.y0) / pxPerCssPx
   * ---------------------------------------------------------------------- */

  function bboxInRectToCss(bbox, rectCss, pxPerCssPx) {
    const f = pxPerCssPx || (display && display.scaleFactor) || 1;
    return {
      x: rectCss.x + bbox.x0 / f,
      y: rectCss.y + bbox.y0 / f,
      w: (bbox.x1 - bbox.x0) / f,
      h: (bbox.y1 - bbox.y0) / f,
    };
  }

  /* ----------------------------------------------------------------------
   *  Translate-in-rect runner
   * ---------------------------------------------------------------------- */

  async function runRectTranslate(crop, rectCss) {
    showOcrLoading("Reading text…");

    let lines;
    try {
      const res = await window.lens.ocrFullscreen(crop.dataUrl);
      if (!res?.ok) throw new Error(res?.error || "OCR failed");
      lines = res.lines || [];
      lastRect = {
        croppedDataUrl: crop.dataUrl,
        pxPerCssPx: crop.pxPerCssPx,
        rectCss,
        ocr: { lines, text: res.text || "" },
      };
    } catch (err) {
      hideOcrLoading();
      setToast(`Couldn't read text: ${err?.message || err}`, true);
      busy = false;
      return;
    }

    if (!lines.length) {
      hideOcrLoading();
      setToast(
        "No text found inside the rectangle. Try a larger area.",
        true,
      );
      busy = false;
      return;
    }

    setOcrLoadingText(
      `Translating ${lines.length} line${lines.length === 1 ? "" : "s"} to ${langName(targetLang)}…`,
    );

    let translations;
    try {
      const texts = lines.map((l) => l.text);
      const res = await window.lens.translateBatch(texts, targetLang);
      if (!res?.ok) throw new Error(res?.error || "translate failed");
      translations = res.translations;
    } catch (err) {
      hideOcrLoading();
      setToast(`Translate failed: ${err?.message || err}`, true);
      busy = false;
      return;
    }
    hideOcrLoading();

    renderTranslationOverlays(lines, translations, rectCss, crop.pxPerCssPx);
    setToast(
      `<span class="check"></span>Translated to ${langName(targetLang)}`,
    );
    setTimeout(() => toast?.classList?.remove("show"), 1800);
    // Let the user draw another rect (or switch language for an
    // instant re-translate from cache).
    busy = false;
    showActionMenu();
  }

  /**
   * Re-translate the cached OCR to the current `targetLang` without
   * touching tesseract. Used by the language picker (instant
   * re-translate on selection change).
   */
  async function rerunTranslateFromCache() {
    if (!lastRect?.ocr?.lines?.length) return;
    clearTranslateLayer();
    showOcrLoading(`Translating to ${langName(targetLang)}…`);
    try {
      const texts = lastRect.ocr.lines.map((l) => l.text);
      const res = await window.lens.translateBatch(texts, targetLang);
      if (!res?.ok) throw new Error(res?.error);
      renderTranslationOverlays(
        lastRect.ocr.lines,
        res.translations,
        lastRect.rectCss,
        lastRect.pxPerCssPx,
      );
      setToast(
        `<span class="check"></span>Translated to ${langName(targetLang)}`,
      );
      setTimeout(() => toast?.classList?.remove("show"), 1500);
    } catch (err) {
      setToast(`Translate failed: ${err?.message || err}`, true);
    } finally {
      hideOcrLoading();
    }
  }

  function renderTranslationOverlays(lines, translations, rectCss, pxPerCssPx) {
    if (!translateLayer) return;
    translateLayer.innerHTML = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = translations[i] || line.text;
      const css = bboxInRectToCss(line.bbox, rectCss, pxPerCssPx);
      if (css.w < 4 || css.h < 4) continue;

      const div = document.createElement("div");
      div.className = "translate-line";
      div.textContent = text;
      div.setAttribute("data-original", line.text);
      div.style.left = `${css.x}px`;
      div.style.top = `${css.y}px`;
      div.style.minWidth = `${css.w}px`;
      div.style.height = `${css.h}px`;
      // Font-size matches line height. Slightly smaller than the
      // OCR-line factor so translations into scripts like Devanagari
      // (which often need more glyph height) don't clip vertically.
      div.style.fontSize = `${Math.max(9, Math.round(css.h * 0.78))}px`;
      // Click toggles a "show original" inline swap.
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        const showingOriginal = div.dataset.showOriginal === "1";
        if (showingOriginal) {
          div.textContent = text;
          div.dataset.showOriginal = "0";
        } else {
          div.textContent = line.text;
          div.dataset.showOriginal = "1";
        }
      });
      translateLayer.appendChild(div);
    }
    translateLayer.hidden = false;
  }

  function clearTranslateLayer() {
    if (!translateLayer) return;
    translateLayer.innerHTML = "";
    translateLayer.hidden = true;
  }

  /* ----------------------------------------------------------------------
   *  Select-text-in-rect runner
   * ---------------------------------------------------------------------- */

  async function runRectSelectText(crop, rectCss) {
    showOcrLoading("Reading text…");

    let lines;
    try {
      const res = await window.lens.ocrFullscreen(crop.dataUrl);
      if (!res?.ok) throw new Error(res?.error || "OCR failed");
      lines = res.lines || [];
      lastRect = {
        croppedDataUrl: crop.dataUrl,
        pxPerCssPx: crop.pxPerCssPx,
        rectCss,
        ocr: { lines, text: res.text || "" },
      };
    } catch (err) {
      hideOcrLoading();
      setToast(`Couldn't read text: ${err?.message || err}`, true);
      busy = false;
      return;
    }
    hideOcrLoading();

    if (!lines.length) {
      setToast(
        "No text found inside the rectangle. Try a larger area.",
        true,
      );
      busy = false;
      return;
    }

    renderSelectableText(lines, rectCss, crop.pxPerCssPx);
    setToast(
      `<span class="check"></span>${lines.length} line${lines.length === 1 ? "" : "s"} ready — drag to select`,
    );
    setTimeout(() => toast?.classList?.remove("show"), 1800);
    busy = false;
    showActionMenu();
  }

  function renderSelectableText(lines, rectCss, pxPerCssPx) {
    if (!textLayer) return;
    textLayer.innerHTML = "";
    for (const line of lines) {
      const css = bboxInRectToCss(line.bbox, rectCss, pxPerCssPx);
      if (css.w < 4 || css.h < 4) continue;
      const span = document.createElement("span");
      span.className = "ocr-line";
      span.textContent = line.text;
      span.style.left = `${css.x}px`;
      span.style.top = `${css.y}px`;
      span.style.width = `${css.w}px`;
      span.style.height = `${css.h}px`;
      // 90% of bbox height keeps the ::selection highlight aligned
      // with the visible text in the screenshot beneath.
      span.style.fontSize = `${Math.max(8, Math.round(css.h * 0.9))}px`;
      textLayer.appendChild(span);
    }
    textLayer.hidden = false;
  }

  function clearTextLayer() {
    if (!textLayer) return;
    textLayer.innerHTML = "";
    textLayer.hidden = true;
  }

  /* ----------------------------------------------------------------------
   *  Selection toolbar — appears next to user's text selection in
   *  OCR / Copy modes. Provides Copy + Translate buttons.
   * ---------------------------------------------------------------------- */

  function setupSelectionToolbar() {
    if (!selectionToolbar) return;

    selectionToolbar.addEventListener("pointerdown", (e) => e.stopPropagation());
    selectionToolbar.addEventListener("click", (e) => e.stopPropagation());

    if (selCopyBtn) {
      selCopyBtn.addEventListener("click", async () => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (!text) return;
        const labelSpan = selCopyBtn.querySelector(".sel-btn-label");
        const original = labelSpan?.dataset?.label || "Copy";
        try {
          const res = await window.lens.copyText(text);
          if (!res?.ok) throw new Error(res?.error);
          selCopyBtn.classList.add("copied");
          if (labelSpan) labelSpan.textContent = `Copied ${text.length}`;
          setTimeout(() => {
            selCopyBtn.classList.remove("copied");
            if (labelSpan) labelSpan.textContent = original;
          }, 1300);
        } catch (err) {
          if (labelSpan) labelSpan.textContent = "Copy failed";
          setTimeout(() => {
            if (labelSpan) labelSpan.textContent = original;
          }, 1300);
        }
      });
    }

    if (selTranslateBtn) {
      selTranslateBtn.addEventListener("click", async () => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (!text) return;
        hideSelectionToolbar();
        lastSelectionTranslate = { text, target: targetLang };
        showResultCard("loading");
        setLoadingStatus(
          `Translating to ${langName(targetLang)}…`,
          "",
        );
        try {
          const res = await window.lens.translate(text, targetLang);
          if (!res?.ok) throw new Error(res?.error);
          showResultSuccess({
            translated: res.translated,
            original: text,
            detected: res.detected,
            target: targetLang,
          });
        } catch (err) {
          showResultError(
            `Translation failed: ${err?.message || err}`,
            text,
          );
        }
      });
    }

    // Watch the document's selection — show the toolbar when the
    // selection lives inside #text-layer and has actual content.
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        hideSelectionToolbar();
        return;
      }
      // Only fire in select-text-capable modes.
      if (currentAction !== "ocr" && currentAction !== "copy") {
        hideSelectionToolbar();
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || rect.width === 0 && rect.height === 0) {
        hideSelectionToolbar();
        return;
      }
      positionSelectionToolbar(rect);
    });
  }

  function positionSelectionToolbar(rect) {
    if (!selectionToolbar) return;
    selectionToolbar.hidden = false;
    // Estimate toolbar size (it's small; this is just for clamping).
    const toolbarH = 44;
    const toolbarHalfW = 110;
    const padding = 8;
    // Vertical: prefer above selection, fall back to below if no
    // room.
    let top = rect.top - toolbarH - padding;
    if (top < 8) top = rect.bottom + padding;
    // Horizontal: centre on the selection, but clamp into the
    // viewport so the toolbar never clips the edge.
    let left = rect.left + (rect.width / 2);
    const vw = window.innerWidth || document.documentElement.clientWidth;
    left = Math.max(toolbarHalfW + 8, Math.min(vw - toolbarHalfW - 8, left));
    selectionToolbar.style.top = `${Math.max(8, top)}px`;
    selectionToolbar.style.left = `${left}px`;
    selectionToolbar.style.transform = "translate(-50%, 0)";
    requestAnimationFrame(() => selectionToolbar.classList.add("show"));
  }

  function hideSelectionToolbar() {
    if (!selectionToolbar) return;
    selectionToolbar.classList.remove("show");
    selectionToolbar.hidden = true;
  }


  function labelForAction(a) {
    switch (a) {
      case "translate": return "Translate";
      case "ocr":       return "Select text";
      case "copy":      return "Copy text";
      case "lens":
      default:          return "Lens";
    }
  }

  /* ----------------------------------------------------------------------
   *  Result card — loading / success / error rendering for the Translate
   *  flow. Single DOM element switches between three states via classes.
   * ---------------------------------------------------------------------- */

  function setupResultCard() {
    if (!resultCard) return;

    // Esc closes the card (also closes the overlay as before via the
    // existing onKey handler — the card's close just dismisses the
    // card so the user can try again).
    if (resultClose) {
      resultClose.addEventListener("click", (e) => {
        e.stopPropagation();
        hideResultCard();
        closeFade();
      });
      resultClose.addEventListener("pointerdown", (e) => e.stopPropagation());
    }

    if (copyTranslatedBtn) {
      copyTranslatedBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const text = resultTranslated?.textContent || "";
        await copyAndFlash(copyTranslatedBtn, text);
      });
    }
    if (copyOriginalBtn) {
      copyOriginalBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const text = resultOriginal?.textContent || "";
        await copyAndFlash(copyOriginalBtn, text);
      });
    }
    if (errorRetry) {
      errorRetry.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!lastSelectionTranslate) {
          hideResultCard();
          return;
        }
        const { text, target } = lastSelectionTranslate;
        showResultCard("loading");
        setLoadingStatus(`Translating to ${langName(target)}…`, "");
        try {
          const res = await window.lens.translate(text, target);
          if (!res?.ok) throw new Error(res?.error);
          showResultSuccess({
            translated: res.translated,
            original: text,
            detected: res.detected,
            target,
          });
        } catch (err) {
          showResultError(
            `Translation failed: ${err?.message || err}`,
            text,
          );
        }
      });
    }

    // Stop the lasso drawing handler from intercepting clicks inside
    // the card (since the card lives inside #ui-layer which is
    // pointer-events:none, but the card itself enables them).
    resultCard.addEventListener("pointerdown", (e) => e.stopPropagation());
    resultCard.addEventListener("click", (e) => e.stopPropagation());
  }

  function showResultCard(state) {
    if (!resultCard) return;
    resultCard.hidden = false;
    resultCard.classList.remove(
      "state-loading", "state-result", "state-error",
    );
    resultCard.classList.add(`state-${state}`);
    requestAnimationFrame(() => resultCard.classList.add("show"));
  }

  function hideResultCard() {
    if (!resultCard) return;
    resultCard.classList.remove("show");
    setTimeout(() => {
      if (resultCard) resultCard.hidden = true;
    }, 240);
  }

  function setLoadingStatus(status, sub) {
    if (loadingStatus) loadingStatus.textContent = status;
    if (loadingSub) loadingSub.textContent = sub || "";
  }

  function showResultSuccess({ translated, original, detected, target }) {
    showResultCard("result");
    if (resultDetected) {
      resultDetected.textContent =
        "Detected: " + (langName(detected) || "auto");
    }
    if (resultTarget) {
      resultTarget.textContent = "→ " + langName(target);
    }
    if (resultTranslated) resultTranslated.textContent = translated || "";
    if (resultOriginal)   resultOriginal.textContent   = original || "";
  }

  function showResultError(message, recoveredText) {
    showResultCard("error");
    if (errorMessage) errorMessage.textContent = message;
    // If OCR succeeded but translate didn't, still expose the OCR
    // text in the (hidden by default) original-text section so the
    // user can copy it manually.
    if (recoveredText && resultOriginal) {
      resultOriginal.textContent = recoveredText;
    }
  }

  async function copyAndFlash(btn, text) {
    if (!text) return;
    const labelSpan = btn.querySelector(".result-btn-label");
    const originalLabel = labelSpan?.dataset?.label || labelSpan?.textContent || "";
    try {
      const res = await window.lens.copyText(text);
      if (!res?.ok) throw new Error(res?.error || "copy failed");
      btn.classList.add("copied");
      if (labelSpan) labelSpan.textContent = `Copied ${text.length} chars`;
      setTimeout(() => {
        btn.classList.remove("copied");
        if (labelSpan) labelSpan.textContent = originalLabel;
      }, 1400);
    } catch (err) {
      console.error("[overlay] copy failed:", err);
      if (labelSpan) labelSpan.textContent = "Copy failed";
      setTimeout(() => {
        if (labelSpan) labelSpan.textContent = originalLabel;
      }, 1400);
    }
  }

  /**
   * Crop the captured screenshot to the polygon defined by `polygon`
   * (CSS-px points relative to this window).
   *
   * When `opts.upscaleForOcr` is true the cropped canvas is scaled
   * up so the SHORTER side hits at least `OCR_MIN_PIXELS` (with a
   * hard cap so we don't blow memory on huge crops). This gives
   * Tesseract the ~30-px-tall glyphs it needs to maintain accuracy
   * on small UI text. drawImage with imageSmoothingQuality="high"
   * uses Lanczos-like interpolation in Chromium so the upscale is
   * sharp enough to feed straight into OCR.
   *
   * Returns `{ dataUrl, pxPerCssPx }` so callers can convert
   * bboxes (which come back in OUTPUT-image pixel space) to CSS px
   * via `bboxInRectToCss(bbox, rectCss, pxPerCssPx)`.
   */
  const OCR_MIN_PIXELS = 1200; // shorter-side target after upscale
  const OCR_MAX_PIXELS = 4096; // hard cap to avoid huge canvases

  async function cropToPolygon(polygon, opts) {
    if (!display) throw new Error("display info missing");
    const upscale = !!(opts && opts.upscaleForOcr);

    const sx = screenImg.naturalWidth / display.width;
    const sy = screenImg.naturalHeight / display.height;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    minX = Math.max(0, minX - 4);
    minY = Math.max(0, minY - 4);
    maxX = Math.min(window.innerWidth, maxX + 4);
    maxY = Math.min(window.innerHeight, maxY + 4);

    const cssW = Math.max(1, maxX - minX);
    const cssH = Math.max(1, maxY - minY);

    // Base (= native screenshot resolution) crop dimensions.
    const baseW = cssW * sx;
    const baseH = cssH * sy;

    // Decide upscale factor. Aim to lift the shorter side to
    // OCR_MIN_PIXELS, but never go below 1x (don't shrink) and cap
    // both dimensions at OCR_MAX_PIXELS to keep memory predictable.
    let scale = 1;
    if (upscale) {
      const shortSide = Math.min(baseW, baseH);
      const wantedByShort = OCR_MIN_PIXELS / Math.max(1, shortSide);
      const allowedByLong =
        OCR_MAX_PIXELS / Math.max(1, Math.max(baseW, baseH));
      scale = Math.max(1, Math.min(wantedByShort, allowedByLong));
    }

    const cw = Math.max(1, Math.round(baseW * scale));
    const ch = Math.max(1, Math.round(baseH * scale));

    const off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const octx = off.getContext("2d");
    // High-quality resampling matters MORE than usual here because
    // we're feeding the output straight into Tesseract.
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";

    octx.save();
    octx.beginPath();
    octx.moveTo(
      (polygon[0].x - minX) * sx * scale,
      (polygon[0].y - minY) * sy * scale,
    );
    for (let i = 1; i < polygon.length; i++) {
      octx.lineTo(
        (polygon[i].x - minX) * sx * scale,
        (polygon[i].y - minY) * sy * scale,
      );
    }
    octx.closePath();
    octx.clip();

    octx.drawImage(
      screenImg,
      minX * sx, minY * sy, baseW, baseH,
      0, 0, cw, ch,
    );
    octx.restore();

    return {
      dataUrl: off.toDataURL("image/png"),
      pxPerCssPx: sx * scale,
    };
  }

  /* ----------------------------------------------------------------------
   *  UI helpers
   * ---------------------------------------------------------------------- */

  function showHint() {
    hint.classList.add("show");
    setTimeout(() => hint.classList.remove("show"), 2400);
  }

  function setToast(html, isError = false) {
    toast.innerHTML = html;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
  }

  function closeFade() {
    document.body.classList.add("fading");
    setTimeout(() => window.lens?.cancel?.(), 220);
  }

  function cancel() {
    closeFade();
  }
})();
