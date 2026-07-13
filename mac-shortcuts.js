/**
 * Circle to Lens — macOS shortcut helper.
 *
 * On first launch (and when the install fingerprint changes), creates:
 *   - A Desktop alias to the app bundle (double-click to open)
 *   - A "Circle to Lens — Shortcuts.txt" cheat sheet on the Desktop
 *
 * Spotlight already indexes apps in /Applications after DMG install;
 * the Desktop alias is the fast double-click launcher.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { app } = require("electron");

const ALIAS_NAME = "Circle to Lens";
const GUIDE_NAME = "Circle to Lens — Shortcuts.txt";
const STAMP_NAME = "mac-shortcuts.stamp";

function stampPath() {
  return path.join(app.getPath("userData"), STAMP_NAME);
}

function desktopDir() {
  return app.getPath("desktop");
}

function aliasPath() {
  return path.join(desktopDir(), ALIAS_NAME);
}

function guidePath() {
  return path.join(desktopDir(), GUIDE_NAME);
}

function appBundlePath() {
  if (!app.isPackaged) return null;
  return path.resolve(process.execPath, "..", "..", "..");
}

function fingerprint() {
  return JSON.stringify({
    bundle: appBundlePath(),
    version: app.getVersion(),
    alias: aliasPath(),
  });
}

function runOsascript(lines) {
  const script = lines.join("\n");
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function buildShortcutsGuide(hotkey) {
  const hk = hotkey || "Alt+Shift+S";
  const macKeys = hk.replace(/Alt/g, "⌥ Option").replace(/CommandOrControl/g, "⌘ Cmd").replace(/Command/g, "⌘ Cmd").replace(/Control/g, "⌃ Ctrl");

  return `Circle to Lens — Mac shortcuts
================================

INSTALL (one time)
  1. Open the DMG and drag "Circle to Lens" to Applications
  2. First launch: right-click the app → Open (unsigned app)
  3. Allow Screen Recording + Accessibility when macOS asks

CAPTURE (use from any app)
  ${macKeys}          Start screen capture (draw a circle)
  Esc                 Cancel while drawing

MENU BAR ICON (top-right of screen)
  Click               Open Home window
  Double-click        Capture now
  Right-click         Menu: Capture / Settings / Quit

APP MENU (top menu bar when Circle to Lens is focused)
  ${macKeys}          Capture now
  ⌘ ,                 Open Settings
  ⌘ Q                 Quit

OPEN THE APP QUICKLY
  Double-click        Desktop alias "${ALIAS_NAME}"
  ⌘ Space             Spotlight → type "Circle to Lens" → Enter
  Dock                Drag the app from Applications to the Dock (optional)

HOME WINDOW
  Esc                 Close Home window
  Try a capture now   Button starts capture without the hotkey

CUSTOMIZE
  Settings → Capture hotkey → click the box → press your combo
  Good Mac alternatives: ⌥⇧S (default), ⌘⇧L, ⌃⌥L

PERMISSIONS (System Settings → Privacy & Security)
  Screen Recording    Required to capture your screen
  Accessibility       Required for the global hotkey

Need help? Re-open this file anytime from your Desktop.
`;
}

async function writeDesktopAlias(bundle) {
  const desktop = desktopDir();
  const target = bundle;
  const dest = aliasPath();

  if (fs.existsSync(dest)) {
    return dest;
  }

  const q = (s) => JSON.stringify(s);
  await runOsascript([
    'tell application "Finder"',
    `  set targetApp to POSIX file ${q(target)}`,
    `  set desktopFolder to POSIX file ${q(desktop)}`,
    `  make new alias file at desktopFolder to targetApp with properties {name:${q(ALIAS_NAME)}}`,
    "end tell",
  ]);
  return dest;
}

function writeShortcutsGuide(hotkey) {
  const file = guidePath();
  fs.writeFileSync(file, buildShortcutsGuide(hotkey), "utf8");
  return file;
}

function check() {
  if (process.platform !== "darwin") return false;
  try {
    return fs.existsSync(aliasPath()) || fs.existsSync(guidePath());
  } catch (_) {
    return false;
  }
}

/**
 * @param {{ force?: boolean, hotkey?: string }} [opts]
 */
async function ensure(opts = {}) {
  if (process.platform !== "darwin") return null;

  const bundle = appBundlePath();
  const fp = fingerprint();
  let existing = "";
  try {
    existing = fs.readFileSync(stampPath(), "utf8");
  } catch (_) {
    /* first run */
  }

  const hotkey = opts.hotkey || "Alt+Shift+S";
  const aliasOk = fs.existsSync(aliasPath());
  const guideOk = fs.existsSync(guidePath());

  if (!opts.force && existing === fp && aliasOk && guideOk) {
    return aliasPath();
  }

  try {
    let alias = aliasPath();
    if (bundle) {
      alias = await writeDesktopAlias(bundle);
      console.log("[mac-shortcuts] desktop alias:", alias);
    } else {
      console.log("[mac-shortcuts] dev mode — skipping desktop alias");
    }

    const guide = writeShortcutsGuide(hotkey);
    console.log("[mac-shortcuts] shortcuts guide:", guide);

    fs.mkdirSync(path.dirname(stampPath()), { recursive: true });
    fs.writeFileSync(stampPath(), fp, "utf8");
    return alias;
  } catch (err) {
    console.warn("[mac-shortcuts] ensure failed:", err?.message || err);
    try {
      writeShortcutsGuide(hotkey);
    } catch (_) {
      /* ignore */
    }
    return null;
  }
}

module.exports = { ensure, check, buildShortcutsGuide, aliasPath, guidePath };
