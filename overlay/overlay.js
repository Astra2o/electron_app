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
  const toast = document.getElementById("toast");
  const ctx = lasso.getContext("2d");

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
  };

  /** Polygon points in CSS px (relative to the overlay window). */
  let points = [];
  let drawing = false;
  let busy = false;

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
      screenImg.onload = () => {
        screenshotReady = true;
        screenshotEl.src = dataUrl;
        sizeCanvas();
        showHint();
      };
      screenImg.src = dataUrl;
    });
  } else {
    console.error("[overlay] preload bridge missing — window.lens not exposed");
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

  function onDown(e) {
    if (busy || e.button !== 0) return;
    drawing = true;
    snapped = false;
    // Restore CSS dim if a previous failed attempt left it hidden.
    if (dimEl) dimEl.style.opacity = "";
    points = [{ x: e.clientX, y: e.clientY }];
    redraw();
    e.preventDefault();
  }

  function onMove(e) {
    if (!drawing) return;
    const last = points[points.length - 1];
    if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 2) return;
    points.push({ x: e.clientX, y: e.clientY });
  }

  async function onUp() {
    if (!drawing) return;
    drawing = false;
    if (points.length < 6) {
      // Treat as accidental click — clear and let user try again.
      points = [];
      redraw();
      return;
    }

    if (settings.convertToRect) {
      points = polygonBoundingRect(points);
      snapped = true;
    }

    busy = true;
    cancelAnimationFrame(rafId);
    redraw(true);
    await submit();
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

  async function submit() {
    setToast(`<span class="spinner"></span>Searching with Lens…`);

    try {
      if (!screenshotReady) {
        throw new Error("Screenshot didn't load");
      }
      const croppedDataUrl = await cropToPolygon(points);
      const res = await window.lens.submit(croppedDataUrl);
      if (!res?.ok) throw new Error(res?.error || "upload failed");

      setToast(`<span class="check"></span>Sent to Lens`);
      // Main will close us; small grace period in case the close is
      // delayed (e.g. on slow machines).
      setTimeout(closeFade, 600);
    } catch (err) {
      console.error("[overlay] submit failed:", err);
      setToast(`Couldn't search: ${err?.message || err}`, true);
      busy = false;
      // Let the user try again — don't auto-cancel on error.
    }
  }

  /**
   * Crop the captured screenshot to the polygon defined by `polygon`
   * (CSS-px points relative to this window). Returns a PNG data URL.
   * Works for both freehand polygons and the 4-corner rectangle that
   * snap-to-rect produces.
   */
  async function cropToPolygon(polygon) {
    if (!display) throw new Error("display info missing");

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

    const cw = Math.round(cssW * sx);
    const ch = Math.round(cssH * sy);
    const off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const octx = off.getContext("2d");

    octx.save();
    octx.beginPath();
    octx.moveTo((polygon[0].x - minX) * sx, (polygon[0].y - minY) * sy);
    for (let i = 1; i < polygon.length; i++) {
      octx.lineTo((polygon[i].x - minX) * sx, (polygon[i].y - minY) * sy);
    }
    octx.closePath();
    octx.clip();

    octx.drawImage(
      screenImg,
      minX * sx, minY * sy, cssW * sx, cssH * sy,
      0, 0, cw, ch,
    );
    octx.restore();

    return off.toDataURL("image/png");
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
