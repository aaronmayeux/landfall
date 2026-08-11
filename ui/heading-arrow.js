/**
 * heading-arrow.js — the one arrow, drawn once (SPEC-UI §16.4).
 *
 * ===========================================================================
 * ONE FILE BECAUSE THREE SURFACES DRAW IT
 * ===========================================================================
 *
 * The storm list row, the detail panel's Moving row, and the home dashboard's
 * motion line. §12: any pattern used twice gets extracted before the second
 * use, and this one has a sharper reason than most — an arrow that means
 * "north is up" in two places and something subtly different in the third is
 * a compass the reader cannot trust anywhere.
 *
 * ===========================================================================
 * AN SVG, NOT A GLYPH, AND THE ROTATION IS A TRANSFORM
 * ===========================================================================
 *
 * The ↗/↘ it replaces were text characters, which is why they only ever came
 * in eight flavours and why they sat high in the line and needed nudging down.
 * A heading is continuous, so the mark has to be too.
 *
 * ==> ROTATED WITH `transform`, WHICH IS THE ONLY THING THIS APP ANIMATES
 * (§13). <== It is a static transform here rather than an animated one, but
 * the rule is what keeps a heading change off the layout path: a row patched
 * in place while the list is on screen re-points its arrow without the browser
 * touching anything but the compositor.
 *
 * `currentColor` throughout, so the arrow inherits whatever the surface around
 * it is already saying with colour — the row's far/near tone, the detail
 * panel's body ink — and no hex ever appears here (§13, one visual contract).
 *
 * ===========================================================================
 * NORTH IS UP. THAT IS A CLAIM, AND IT IS ONLY TRUE OFF THE GLOBE
 * ===========================================================================
 *
 * On a rotating 3D globe north is up only at the centre of the screen. These
 * three surfaces are flat panels, where north-up is the convention every map
 * legend has trained the reader on, so it holds. IF THIS ARROW IS EVER PUT ON
 * THE GLOBE ITSELF it must be rotated by the map's bearing as well, or it will
 * be wrong everywhere except dead centre.
 */

import { headingWords } from '../lib/heading.js';

/**
 * The arrow, as a markup string.
 *
 * @param {number} deg   compass heading, 0 = north, clockwise.
 * @param {object} [opts]
 * @param {string} [opts.className]  extra class for surface-specific sizing.
 * @returns {string} markup, or '' when there is no heading to draw. THE EMPTY
 *        STRING IS THE POINT: a caller with no heading renders nothing rather
 *        than a placeholder, and every layout using this has to survive that.
 */
export function headingArrow(deg, { className = '' } = {}) {
  if (!Number.isFinite(deg)) return '';
  /* One decimal place. The rotation is continuous and the reader cannot see
   * a tenth of a degree, but the string is compared on the in-place patch path
   * and a full float would make every render look like a change. */
  const r = (((Number(deg) % 360) + 360) % 360).toFixed(1);
  return `<span class="heading-arrow ${className}" style="--heading:${r}deg" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="M12 3 L12 21 M12 3 L6.5 9.5 M12 3 L17.5 9.5"/></svg>
    </span>`;
}

/**
 * What a screen reader should hear instead of the arrow.
 *
 * Re-exported through this file rather than imported from lib/heading.js at
 * every call site, so that a surface adding the arrow cannot forget the half
 * of it that is not visible. The two belong together; keeping them in one
 * import is the cheapest way to make that structural rather than remembered.
 */
export function headingSpoken(deg) {
  const w = headingWords(deg);
  return w ? `moving ${w}` : null;
}
