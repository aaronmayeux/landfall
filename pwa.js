/**
 * pwa.js — PWA lifecycle: service worker registration and the install seam.
 * Its own file, not main.js wiring: PWA lifecycle is a concern, and main.js
 * is wiring only (§12).
 *
 * Loaded twice on purpose: as its own <script type="module"> in index.html
 * (so the worker registers even if main.js dies early) and imported by
 * main.js for the install API below. Modules evaluate once, so both see the
 * same instance — there is exactly one listener and one captured prompt.
 *
 * Registration happens after `load` so the worker's install never competes
 * with the boot-critical fetches (style, first tiles, first storm poll) for
 * the radio.
 *
 * Failure is silent BY DESIGN and that is not a §5 violation: the worker is
 * an enhancement layer — installability and offline fallback — and the app
 * without it is simply the app as it was before Phase 5. There is no user
 * promise being broken, so there is nothing to surface. The console line is
 * for the developer.
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch((err) => console.warn('[pwa] service worker registration failed:', err));
  });
}

/* ---------------------------------------------------------------------------
 * THE INSTALL SEAM (ui/first-run.js is the consumer, via main.js).
 *
 * CAPABILITY, NOT DEVICE CLASS (§10's rule, applied to install):
 * - Chromium fires `beforeinstallprompt` when the app is installable. We
 *   capture it and can replay it as a real install dialog. The listener is
 *   registered at module scope because the event can fire before any UI
 *   exists — miss it and it never fires again.
 * - iOS Safari fires nothing (Apple provides no install event). Its marker
 *   is the `navigator.standalone` property EXISTING — present only in iOS
 *   Safari, true only when launched from the Home Screen. That property
 *   check is the closest thing to a capability signal iOS offers; there is
 *   no user-agent string being parsed.
 * - A browser with neither signal (desktop Firefox, say) cannot install a
 *   PWA, and the honest UI for a capability that does not exist is nothing.
 * ------------------------------------------------------------------------- */

let deferredPrompt = null;
const readyListeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  /* Chrome shows its own mini-infobar on mobile without this. We take over
   * the moment so the hint can appear at OUR time (after home is set), not
   * mid-boot. */
  e.preventDefault();
  deferredPrompt = e;
  for (const fn of readyListeners) {
    try {
      fn();
    } catch (err) {
      console.warn('[pwa] install-ready listener failed:', err);
    }
  }
});

/** Already running as an installed app, on either platform? */
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/** A real install dialog is one call away (Chromium captured its event). */
export function canPromptInstall() {
  return deferredPrompt !== null;
}

/** iOS Safari: installable, but only by hand via the Share sheet. */
export function needsManualInstall() {
  return 'standalone' in window.navigator && !isInstalled();
}

/**
 * Fires `fn` when a captured install prompt becomes available — immediately
 * if it already is. Same fire-on-subscribe contract as every other
 * subscription in the app.
 */
export function onInstallReady(fn) {
  readyListeners.add(fn);
  if (deferredPrompt) {
    try {
      fn();
    } catch (err) {
      console.warn('[pwa] install-ready listener failed on registration:', err);
    }
  }
  return () => readyListeners.delete(fn);
}

/**
 * Shows the native install dialog. Resolves true if the user accepted.
 * The captured event is single-use — spent either way.
 */
export async function requestInstall() {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  p.prompt();
  const choice = await p.userChoice;
  return choice.outcome === 'accepted';
}
