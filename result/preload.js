/**
 * Circle to Lens — preload for the (hidden) uploader window.
 *
 * The "result window" is actually a hidden BrowserWindow we use to
 * run the Lens POST from inside a real Chromium renderer (so cookies,
 * UA, and multipart serialization all behave like a normal browser).
 * The renderer talks to main through two channels:
 *
 *   - `lensResult(url)`  — POST succeeded; main opens `url` in the
 *                          user's default browser via shell.openExternal
 *                          and closes this window.
 *   - `lensError(info)`  — POST failed (network / 403 / etc); main
 *                          loads our local `result/error.html` into
 *                          this window so the user can sign in, retry,
 *                          or open the URL externally.
 *
 * The remaining methods (`signIn`, `signOut`, `isSignedIn`,
 * `openInBrowser`, `retry`, `close`) back the buttons on
 * `result/error.html`.
 *
 * `contextIsolation: true` keeps this API invisible to Google's JS
 * even though the same window also navigates to google.com during
 * the upload step.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("c2l", {
  /** Open a Google sign-in window (Electron-side cookies persist after). */
  signIn() {
    ipcRenderer.send("c2l:signin");
  },
  /** Clear all .google.com cookies from this app's session. */
  signOut() {
    ipcRenderer.send("c2l:signout");
  },
  /** Returns `true` if a Google SID cookie is present. */
  isSignedIn() {
    return ipcRenderer.invoke("c2l:is-signed-in");
  },
  /** Hand a URL off to the user's default browser and close this view. */
  openInBrowser(url) {
    ipcRenderer.send("c2l:open-external", url);
  },
  /** Re-load the original Lens result URL inside the same window. */
  retry(url) {
    ipcRenderer.send("c2l:retry-result", url);
  },
  /** Close the result window. */
  close() {
    ipcRenderer.send("c2l:close-result");
  },

  /* ---------- Upload pipeline ---------- */

  /**
   * The hidden uploader page calls this after Lens's POST resolves.
   * `url` is the final result URL (after the 302). Main will open it
   * in the user's default browser via shell.openExternal.
   */
  lensResult(url) {
    ipcRenderer.send("c2l:lens-result", url);
  },

  /**
   * The hidden uploader page calls this if the POST or its follow-up
   * fails (network error, 403, etc.). Payload:
   *   { status?: number, statusText?: string, message?: string, url?: string }
   */
  lensError(info) {
    ipcRenderer.send("c2l:lens-error", info);
  },
});
