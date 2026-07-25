/**
 * imagery-paint.js — the one pixel pass (SPEC §4).
 *
 * Takes whatever a satellite vendor sent and produces the picture Landfall
 * draws: our palette, our knockout, our feathered rim. One function, run over
 * one disc, no per-vendor branching beyond two calibration numbers.
 *
 * ==> WHAT REPLACED THE INHERITED FILTER, AND WHY <==
 *
 * The HA project keyed clear sky out of colour-enhanced infrared using a
 * SATURATION key — cold tops render in vivid colour, warm low cloud renders
 * grey, so keying on chroma keeps the storm and drops the haze. That cost a
 * day to learn and it is correct ABOUT THAT ONE PRODUCT.
 *
 * It does not survive contact with a second vendor. Measured 2026-07-25 across
 * four satellites: EUMETSAT's SEVIRI IR 10.8 is PURE GREYSCALE — mean colour
 * saturation 0.00, maximum 0.00, every test box. A chroma key applied to it
 * erases one hundred percent of the image. Half the tropical belt would have
 * rendered as nothing at all, silently, which is precisely the §5 failure the
 * spec spends a section warning about.
 *
 * So the key moved to the thing every vendor actually agrees on. In all four
 * products BRIGHTER MEANS COLDER — the meteorological convention for infrared
 * — and colder means higher cloud tops means the storm. Normalize brightness
 * against each vendor's own measured black and white points and you get ONE
 * coldness scale that means the same thing on all four satellites. Colour then
 * comes from our ramp instead of theirs, which is what makes an Indian Ocean
 * cyclone and an Atlantic hurricane read identically.
 *
 * The saturation test survives, demoted to a special case: a pixel the vendor
 * ALREADY coloured is a cold top the vendor flagged, and it is pinned near the
 * top of our scale (see `colouredFloor`). It is no longer the key.
 *
 * ==> THE ONE KNOWN SIMPLIFICATION, STATED PLAINLY <==
 *
 * Inside a vendor's own enhancement, colour is not ranked. GIBS' palette runs
 * through hues whose brightness is NOT monotonic with temperature — a cyan
 * pixel is bright and a deep red one is dark, and both are colder than any
 * grey. Ranking one against the other needs that palette's exact temperature
 * table, which has not been read from the vendor and is NOT going to be
 * guessed. So every sufficiently-coloured pixel lands in the top band of our
 * ramp, nudged only slightly by how saturated it is. The visible cost is less
 * gradation inside the very coldest tops on GIBS; the benefit is that the
 * result is identical in kind to Meteosat's, which has no enhancement at all.
 * Uniform across vendors beat maximum detail on one of them.
 *
 * Imports: config/ only. No DOM — the caller owns the canvas.
 */

import { IMAGERY } from '../config/constants.js';
import { IMAGERY_RAMP } from '../config/tokens.js';

/** Rec. 601 luma. The vendors' greys are R=G=B so any luma formula agrees on
 *  them; this one is also sane on the enhanced colours. */
const lum = (r, g, b) => (r * 299 + g * 587 + b * 114) / 255000;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Hermite ease. Used for both the alpha fade-in and the rim feather — a
 *  linear ramp shows its endpoints as visible creases against a dark globe. */
function smoothstep(edge0, edge1, x) {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Flatten the ramp to a 256-entry lookup once, at module load.
 *
 * A disc is 512x512 — a quarter of a million pixels, per storm, every refresh,
 * on a phone. Walking a stop list per pixel is the difference between a pass
 * that disappears into a frame and one you can feel. The palette is frozen
 * config, so the table can never go stale.
 */
const LUT = (() => {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = IMAGERY_RAMP[0];
    let b = IMAGERY_RAMP[IMAGERY_RAMP.length - 1];
    for (let s = 0; s < IMAGERY_RAMP.length - 1; s++) {
      if (t >= IMAGERY_RAMP[s].t && t <= IMAGERY_RAMP[s + 1].t) {
        a = IMAGERY_RAMP[s];
        b = IMAGERY_RAMP[s + 1];
        break;
      }
    }
    const span = b.t - a.t;
    const f = span > 0 ? (t - a.t) / span : 0;
    table[i * 3] = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f);
    table[i * 3 + 1] = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f);
    table[i * 3 + 2] = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f);
  }
  return table;
})();

/**
 * Rewrite one disc in place.
 *
 * @param {ImageData} img     square, as returned by the vendor
 * @param {object}    sat     the SATELLITES entry — supplies black/white
 * @returns {{coldFraction:number}} share of the disc that survived the
 *   knockout. The caller uses it to tell "this storm has no imagery yet" apart
 *   from "this storm's sky is genuinely clear" — two different messages (§5).
 *
 * IN PLACE, on purpose: a second quarter-million-pixel buffer per storm per
 * refresh is exactly the kind of allocation that shows up as a stutter.
 */
export function paintDisc(img, sat) {
  const d = img.data;
  const w = img.width;
  const h = img.height;

  /* Vendor calibration, guarded. A black/white pair that arrived inverted or
   * equal would divide by zero and paint garbage; falling back to the full
   * byte range degrades the contrast and nothing else. */
  const black = Number.isFinite(sat?.black) ? sat.black / 255 : 0;
  const white = Number.isFinite(sat?.white) ? sat.white / 255 : 1;
  const span = white - black > 0.05 ? white - black : 1;

  const { colourSat, colouredFloor, clearBelow, solidAbove, featherStart } = IMAGERY;
  const satThreshold = colourSat;

  /* Feather geometry, in pixels, computed once. The disc is inscribed in the
   * square the server returned, so the rim is at half the width. */
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rim = Math.min(cx, cy);
  const inner = rim * featherStart;

  let cold = 0;
  let counted = 0;

  for (let y = 0, i = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++, i += 4) {
      const a0 = d[i + 3];

      /* The vendor already said "no data here." Nothing to rescue. */
      if (a0 === 0) {
        d[i + 3] = 0;
        continue;
      }

      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];

      /* Coldness, on one scale for every vendor. */
      const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
      const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
      const chroma = hi - lo;

      let t;
      if (chroma >= satThreshold) {
        /* The vendor's own cold-top enhancement — see the header note on why
         * this is flat rather than ranked by hue. */
        t = clamp01(colouredFloor + (chroma / 255) * (1 - colouredFloor));
      } else {
        t = clamp01((lum(r, g, b) - black) / span);
      }

      counted++;
      if (t >= clearBelow) cold++;

      /* The knockout: warm surface draws nothing, so the night-sky globe shows
       * through. This is the whole reason the layer is watchable. */
      let alpha = smoothstep(clearBelow, solidAbove, t);

      if (alpha > 0) {
        /* The rim feather. A hard edge reads as a sticker stuck on the planet;
         * this is what makes it read as weather. */
        const dx = x - cx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= rim) alpha = 0;
        else if (dist > inner) alpha *= 1 - smoothstep(inner, rim, dist);
      }

      const li = (t * 255) | 0;
      d[i] = LUT[li * 3];
      d[i + 1] = LUT[li * 3 + 1];
      d[i + 2] = LUT[li * 3 + 2];
      d[i + 3] = (alpha * a0) | 0;
    }
  }

  return { coldFraction: counted ? cold / counted : 0 };
}
