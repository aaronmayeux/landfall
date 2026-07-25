/**
 * pwa.js — service worker registration. Its own file, not main.js wiring:
 * PWA lifecycle is a concern, and main.js is wiring only (§12).
 *
 * Registered after `load` so the worker's install never competes with the
 * boot-critical fetches (style, first tiles, first storm poll) for the radio.
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
