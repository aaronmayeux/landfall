/**
 * pin-provisional.js — the draggable pin shown while confirming a home (SPEC §8).
 *
 * This is NOT the home marker. It exists only between "the user picked a
 * geocode result" and "the user confirmed it", and it looks deliberately
 * different from the real marker (dashed, unfilled) so the two can never be
 * confused on screen. A provisional pin that looked identical to a set home
 * would tell the user they'd finished when they hadn't.
 *
 * It is draggable because a geocode result is a guess. Mapbox will put a rural
 * address on the road, an apartment on the building centroid, and a postcode
 * on a centroid that might be a mile off. Dragging is the correction path, and
 * it doubles as tap-to-pin when search fails entirely.
 *
 * Built on maplibregl.Marker rather than hand-rolled: it already handles
 * drag across touch, mouse, and the globe projection, and reimplementing that
 * would be a pile of pointer-event code with worse edge cases.
 *
 * Imports: config/ only. `maplibregl` is a CDN global, same as elsewhere.
 */

import { HOME } from '../config/constants.js';
import { DARK, SIZE } from '../config/tokens.js';

/** Dashed ring, hollow centre — visibly "not yet real". The real home marker
 *  is a solid ring with a filled core. */
function provisionalSvg(px) {
  return `
<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"
          stroke-dasharray="3.2 2.6"/>
  <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
</svg>`;
}

export function createProvisionalPin(map) {
  const el = document.createElement('div');
  el.className = 'home-pin-provisional';
  el.style.color = DARK.textPrimary;
  el.style.cursor = 'grab';
  /* Full touch target even though the glyph is smaller — this one gets
   * DRAGGED on a phone, so an undersized hit area is the difference between
   * correcting the pin and fighting it (SPEC §10). */
  const hit = parseInt(SIZE.touchTarget, 10);
  el.style.width = `${hit}px`;
  el.style.height = `${hit}px`;
  el.style.display = 'grid';
  el.style.placeItems = 'center';
  el.style.filter = `drop-shadow(0 2px 6px ${DARK.glassShadow})`;
  el.innerHTML = provisionalSvg(HOME.markerPx);

  const marker = new maplibregl.Marker({ element: el, draggable: true });

  let active = false;
  let onMove = null;

  marker.on('dragstart', () => {
    el.style.cursor = 'grabbing';
  });
  marker.on('drag', () => {
    const p = marker.getLngLat();
    onMove?.({ lon: p.lng, lat: p.lat });
  });
  marker.on('dragend', () => {
    el.style.cursor = 'grab';
    const p = marker.getLngLat();
    onMove?.({ lon: p.lng, lat: p.lat });
  });

  return {
    /** Show the pin at a position. Idempotent — moving an already-shown pin
     *  just repositions it rather than stacking markers. */
    show({ lon, lat }, { onChange } = {}) {
      onMove = onChange || null;
      marker.setLngLat([lon, lat]);
      if (!active) {
        marker.addTo(map);
        active = true;
      }
    },

    /** Current position, or null when hidden. The panel reads this at confirm
     *  time so a dragged pin wins over the geocoded coordinates. */
    get() {
      if (!active) return null;
      const p = marker.getLngLat();
      return { lon: p.lng, lat: p.lat };
    },

    hide() {
      if (active) {
        marker.remove();
        active = false;
      }
      onMove = null;
    },

    isActive: () => active,
  };
}
