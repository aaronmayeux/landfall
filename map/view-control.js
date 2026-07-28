/**
 * view-control.js — one button doing the more useful of two jobs.
 *
 * Upright, it is a crosshair: recenter on home and zoom back out. Rotated, it
 * becomes a compass whose needle points at true north, and tapping it turns
 * the globe upright without moving the camera anywhere else. Which job it is
 * doing is decided by the camera's bearing, nothing else. See the markup note
 * in index.html for why it morphs rather than appearing and disappearing.
 *
 * THE NEEDLE REDRAWS ON MAPLIBRE'S OWN EVENTS, never on a rAF loop of its own.
 * A separate loop drifts out of phase with the map and the needle visibly lags
 * the globe under the user's fingers — the same scar map/marker-home.js
 * carries. One transform on one cached element, no layout reads, so it costs
 * the compositor and nothing else.
 *
 * Imports: config/ only. Owns its own DOM and nothing else's.
 */

import { GLOBE } from '../config/constants.js';

/**
 * @param {object} deps
 * @param {object} deps.map  the MapLibre map
 * @param {() => void} deps.onRecenter  the crosshair job
 * @param {() => void} deps.onInterrupt  stop the idle drift before an easeTo
 */
export function createViewControl({ map, onRecenter, onInterrupt }) {
  const btn = document.getElementById('btn-recenter');
  if (!btn) return { sync() {} };
  const aim = btn.querySelector('.view-aim');

  /* NULL, NOT FALSE. `sync` early-returns when the mode has not changed —
   * which is the whole point, since it runs on every frame of every camera
   * move. Seeding this with `false` made the very first call a no-op, so the
   * button kept the placeholder aria-label baked into index.html and only ever
   * got the accurate one after the user had rotated the globe and come back.
   * Caught in Chrome 2026-07-25. A third value that can never equal either
   * real state guarantees the first sync writes. */
  let offNorth = null;

  function sync() {
    const bearing = map.getBearing();
    /* North on SCREEN is at minus the camera's bearing — bearing is the
     * direction the camera faces, so the needle counter-rotates. */
    if (aim) aim.style.transform = `rotate(${-bearing}deg)`;

    const next = Math.abs(bearing) > GLOBE.northTolerance;
    if (next === offNorth) return; // nothing but the needle moved
    offNorth = next;
    btn.dataset.mode = next ? 'north' : 'recenter';
    /* The accessible name has to track the behaviour, or a screen-reader user
     * is told "recenter" and gets a rotation — worse than no label at all. */
    btn.setAttribute(
      'aria-label',
      next
        ? 'Turn the globe back to north'
        : 'Recenter the globe on your home and zoom back out'
    );
  }

  map.on('rotate', sync);
  /* `rotate` does not fire for an easeTo that only changes bearing on some
   * paths, and it never fires at boot. `move` covers both and costs one cheap
   * comparison per frame the camera is already moving. */
  map.on('move', sync);
  sync();

  btn.addEventListener('click', () => {
    if (offNorth) {
      /* JUST THE BEARING. Someone who rotated the globe to read a track at an
       * angle wants it upright again — not to be thrown back into space and
       * lose the storm they were reading. That is what the crosshair is for,
       * and it is one more tap away the moment this lands at north. */
      onInterrupt?.();
      map.easeTo({ bearing: 0 });
      return;
    }
    onRecenter?.();
  });

  return { sync };
}
