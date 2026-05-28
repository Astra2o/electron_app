/**
 * Circle to Lens — Google sign-in / sign-out / status.
 *
 * Why sign-in helps:
 *
 *   Lens's visual-search result page (`/search?vsrid=...&udm=26`) gates
 *   anonymous traffic aggressively. Upload itself works without an
 *   account, but fetching the result page often returns **403
 *   Forbidden** unless the cookie jar carries a real signed-in Google
 *   session (SID / HSID / SSID + NID).
 *
 *   This module gives the user a one-click way to sign in inside the
 *   app. Electron's `defaultSession` cookie store persists across
 *   restarts (under `%AppData%\Roaming\circle-to-lens`), so signing in
 *   once is enough — every later Lens search just works.
 *
 * Exports:
 *   - openSignIn()    open a small BrowserWindow at Google sign-in.
 *                     Auto-closes when the user lands back on
 *                     www.google.com (= sign-in succeeded).
 *   - signOut()       wipe every .google.com cookie from this session.
 *   - isSignedIn()    quick check: do we have a SID cookie?
 */

const { BrowserWindow, session, shell, Notification } = require("electron");

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const SIGNIN_URL =
  "https://accounts.google.com/ServiceLogin?" +
  "service=oz&passive=1209600&continue=https://www.google.com/";

/** @type {BrowserWindow | null} */
let signInWin = null;

function openSignIn() {
  if (signInWin && !signInWin.isDestroyed()) {
    signInWin.show();
    signInWin.focus();
    return signInWin;
  }

  signInWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: "Sign in to Google",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    resizable: true,
    minWidth: 360,
    minHeight: 520,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Lens / accounts pages do user-agent sniffing — present as stock
  // Chrome so the sign-in flow looks identical to a normal browser.
  signInWin.webContents.setUserAgent(CHROME_UA);

  signInWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  signInWin.loadURL(SIGNIN_URL);

  // Auto-close on successful sign-in: Google redirects to the `continue`
  // URL (= www.google.com) after the password / 2FA step. Matching the
  // bare host catches it whether the user lands at "/" or "/?…".
  let consumed = false;
  signInWin.webContents.on("did-navigate", (_e, url) => {
    if (consumed) return;
    if (/^https:\/\/(www\.)?google\.com\/?(\?.*)?$/.test(url)) {
      consumed = true;
      notify(
        "Signed in to Google",
        "Circle to Lens will use your account for future searches.",
      );
      setTimeout(() => {
        if (signInWin && !signInWin.isDestroyed()) signInWin.close();
      }, 700);
    }
  });

  signInWin.on("closed", () => {
    signInWin = null;
  });

  return signInWin;
}

async function signOut() {
  const ses = session.defaultSession;
  const cookies = await ses.cookies.get({ domain: "google.com" });
  await Promise.all(
    cookies.map((c) => {
      const host = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      const url = (c.secure ? "https://" : "http://") + host + (c.path || "/");
      return ses.cookies.remove(url, c.name).catch(() => {});
    }),
  );
  notify(
    "Signed out of Google",
    "Cleared " + cookies.length + " cookie(s). Lens will run anonymously again.",
  );
}

async function isSignedIn() {
  try {
    const ses = session.defaultSession;
    const sid = await ses.cookies.get({ domain: ".google.com", name: "SID" });
    if (sid && sid.length) return true;
    // Some sign-in flows only set the leaner __Secure-1PSID cookie.
    const psid = await ses.cookies.get({
      domain: ".google.com",
      name: "__Secure-1PSID",
    });
    return psid && psid.length > 0;
  } catch (_) {
    return false;
  }
}

function notify(title, body) {
  try {
    new Notification({ title, body, silent: true }).show();
  } catch (_) {}
}

module.exports = { openSignIn, signOut, isSignedIn };
