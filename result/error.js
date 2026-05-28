/**
 * Circle to Lens — error/sign-in page logic.
 *
 * Reads the original Lens result URL from `?url=…`, wires the three
 * action buttons to the `window.c2l` preload bridge, and adapts the
 * copy depending on whether the user is already signed in.
 */

(() => {
  const url = new URL(location.href).searchParams.get("url") || "";

  const $ = (id) => document.getElementById(id);
  const signInBtn = $("signin");
  const browserBtn = $("browser");
  const retryBtn = $("retry");
  const closeBtn = $("close");
  const urlReadout = $("url-readout");
  const signedInHint = $("signed-in-hint");
  const signedOutHint = $("signed-out-hint");

  urlReadout.textContent = url || "(no URL captured)";

  // If we know the user is already signed in, swap the hint copy and
  // promote "Open in browser" / "Try again" over the sign-in button.
  if (window.c2l?.isSignedIn) {
    window.c2l
      .isSignedIn()
      .then((signedIn) => {
        if (signedIn) {
          signedInHint.hidden = false;
          signedOutHint.hidden = true;
          signInBtn.textContent = "Try a different account";
          signInBtn.classList.remove("primary");
          retryBtn.classList.remove("ghost");
          retryBtn.classList.add("primary");
        }
      })
      .catch(() => {
        /* fall through with default copy */
      });
  }

  signInBtn.addEventListener("click", () => {
    window.c2l?.signIn();
  });

  browserBtn.addEventListener("click", () => {
    if (!url) return;
    window.c2l?.openInBrowser(url);
  });

  retryBtn.addEventListener("click", () => {
    if (!url) return;
    window.c2l?.retry(url);
  });

  closeBtn.addEventListener("click", () => {
    window.c2l?.close();
  });
})();
