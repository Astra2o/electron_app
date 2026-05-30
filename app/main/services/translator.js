/**
 * Circle to Lens — translation service (no API key required).
 *
 * Provider chain:
 *   1) Google Translate's unofficial JSON endpoint
 *      (`translate_a/single`). Best quality, supports auto-detect,
 *      no key. Stable for years but technically undocumented — so
 *      every call is wrapped in try/catch and falls back to (2).
 *   2) MyMemory free API as fallback. Doesn't really auto-detect,
 *      so we pass `autodetect|<target>` which MyMemory interprets
 *      as "guess source".
 *
 * `translateBatch()` is for the in-place "Translate" overlay mode
 * (one OCR line per overlay × dozens of lines on a busy screen).
 * It fans out CONCURRENT requests through `translateText` with a
 * small cap (5) so we don't burst Google and get rate-limited.
 */

"use strict";

const TRANSLATE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Translate `text` into `target` (ISO 639-1, e.g. "en", "hi").
 * Source language is auto-detected.
 *
 * @param {string} text
 * @param {string} target  ISO 639-1 code
 * @returns {Promise<{ translated: string, detected: string, provider: string }>}
 */
async function translateText(text, target) {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Nothing to translate (empty text)");
  const tgt = (target || "en").toLowerCase();

  // ---- Provider 1: Google unofficial endpoint ----------------------------
  try {
    const url =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=auto&tl=${encodeURIComponent(tgt)}` +
      `&dt=t&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": TRANSLATE_UA },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    // Response shape:
    //   [[[translatedSegment, originalSegment, ...], ...], null, "en", ...]
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("Unexpected response shape");
    }
    const translated = data[0]
      .map((seg) => (Array.isArray(seg) ? seg[0] : ""))
      .join("");
    const detected = typeof data[2] === "string" ? data[2] : "auto";
    if (!translated) throw new Error("Empty translation");
    return { translated, detected, provider: "google" };
  } catch (e) {
    console.warn(
      "[translate] google failed, falling back to MyMemory:",
      e?.message || e,
    );
  }

  // ---- Provider 2: MyMemory free tier ------------------------------------
  try {
    const url =
      "https://api.mymemory.translated.net/get" +
      `?q=${encodeURIComponent(trimmed)}` +
      `&langpair=${encodeURIComponent("autodetect|" + tgt)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (!translated) throw new Error("Empty translation");
    return { translated, detected: "auto", provider: "mymemory" };
  } catch (e) {
    throw new Error(
      "All translate providers failed. Last error: " + (e?.message || e),
    );
  }
}

/**
 * Translate many strings in parallel with a small concurrency cap.
 * On a per-string failure we keep the original text in that slot
 * (so the user still sees readable content) and continue. Detected
 * source language is taken from the first successful translation.
 *
 * @param {string[]} texts
 * @param {string} target
 * @returns {Promise<{ translations: string[], detected: string, failed: number }>}
 */
async function translateBatch(texts, target) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { translations: [], detected: "auto", failed: 0 };
  }
  const CONCURRENCY = 5;
  const out = new Array(texts.length).fill("");
  let cursor = 0;
  let detected = "auto";
  let detectedSet = false;
  let failed = 0;

  async function worker() {
    while (cursor < texts.length) {
      const idx = cursor++;
      const src = (texts[idx] || "").trim();
      if (!src) {
        out[idx] = "";
        continue;
      }
      try {
        const r = await translateText(src, target);
        out[idx] = r.translated;
        if (!detectedSet && r.detected) {
          detected = r.detected;
          detectedSet = true;
        }
      } catch (e) {
        console.warn(
          "[translateBatch] line " + idx + " failed, keeping original:",
          e?.message || e,
        );
        out[idx] = src;
        failed += 1;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, texts.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return { translations: out, detected, failed };
}

module.exports = { translateText, translateBatch };
