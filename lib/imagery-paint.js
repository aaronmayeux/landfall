/**
 * imagery-paint.js — the one pixel pass (SPEC §4).
 *
 * KEEP THE VENDOR'S COLOUR. KNOCK OUT THE GREY.
 *
 * This is a direct port of the HA integration's `#extract-clouds` SVG filter
 * (`hurricane-card.js`, ha-hurricane-tracker v0.2.7) into a Canvas 2D loop.
 * Aaron's call, and it is backed by a side-by-side he shot of the same place at
 * the same time: the HA card renders a vivid red/yellow/green storm on black,
 * and Landfall's previous pass rendered the same weather as a white-and-blue
 * smear. The old pass THREW THE VENDOR'S ENHANCEMENT AWAY and repainted every
 * pixel from a palette of ours. That was the bug.
 *
 * ==> WHAT THIS DOES, IN ONE BREATH <==
 *
 * A colour-enhanced infrared product renders COLD STORM TOPS IN VIVID COLOUR
 * and warm ground, low cloud and clear sky in GREY OR BLACK. So the key is
 * SATURATION, not brightness: a bright grey pixel is dropped, a coloured one is
 * kept, and the vendor's own RGB is written back untouched. The only thing this
 * function writes is ALPHA.
 *
 * Unlike a brightness key, the two main knobs are independent of how BRIGHT the
 * cloud is — they set WHERE on the grey-to-colour axis the cutoff sits.
 *
 * ==> WHAT REPLACED WHAT, SO NOBODY RE-LITIGATES IT <==
 *
 * Retired: `IMAGERY_RAMP`, the 256-entry LUT, `clearBelow`, `solidAbove`,
 * `colourSat`, `colouredFloor`, and the whole normalized-coldness idea. It is
 * gone, not commented out. The specific failure it produced: `colouredFloor`
 * pinned EVERY pixel the vendor had already coloured into t >= 0.86, which on
 * our old ramp was the band from (191,230,245) to white — so the coldest,
 * most vivid, most informative part of a storm rendered as one flat white
 * smear. The most interesting pixels were the ones we destroyed hardest.
 *
 * ==> THE ONE THING TO WATCH, AND IT IS MEASURED, NOT THEORETICAL <==
 *
 * A chroma key CANNOT work on a greyscale product — every pixel keys to zero
 * and the disc renders as nothing. A probe on 2026-07-25 reported EUMETSAT's
 * `msg_iodc:ir108` as pure grey (mean saturation 0.00, max 0.00). If that
 * holds, Meteosat draws NOTHING under this pass.
 *
 * That measurement is now IN DOUBT — Aaron has the GOES product on screen with
 * obvious thermal colour, so at minimum the "all four are grey" reading was
 * wrong. Finding out is the point of this pass. So it MEASURES AND REPORTS
 * rather than assuming: `chromaMax` near zero means "this vendor sent a grey
 * frame", which the caller surfaces as a NAMED FAULT and never as clear sky.
 * Showing an empty disc over a live cyclone because a filter ate it is exactly
 * the §5 failure the spec exists to prevent.
 *
 * Imports: config/ only. No DOM — the caller owns the canvas.
 */

import { IMAGERY } from '../config/constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Hermite ease, for the rim feather. A linear ramp shows its endpoints as
 *  visible creases against a dark globe. */
function smoothstep(edge0, edge1, x) {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Rewrite one disc's ALPHA in place. RGB is never touched.
 *
 * @param {ImageData} img  square, as returned by the vendor
 * @param {object}    sat  the SATELLITES entry (used for diagnostics only)
 * @returns {{keptFraction:number, chromaMax:number, chromaMean:number}}
 *
 *   keptFraction  share of the vendor's pixels that survived the colour
 *                 knockout, measured BEFORE the rim feather — the feather is
 *                 geometry and must not contaminate a reading about content.
 *   chromaMax     the most saturated pixel in the frame, 0..1. THIS IS THE
 *                 GREYSCALE DETECTOR. Near zero means the knockout had nothing
 *                 to key on, which is a fault, not a clear sky.
 *   chromaMean    average saturation. Useful for telling "faintly tinted" from
 *                 "genuinely enhanced" when tuning the slope and intercept.
 *
 * IN PLACE, on purpose: a second quarter-million-pixel buffer per storm per
 * refresh is exactly the kind of allocation that shows up as a stutter.
 */
export function paintDisc(img, sat) {
  const d = img.data;
  const w = img.width;
  const h = img.height;

  const { satSlope, satIntercept, edgeFade, purpleFade, featherStart } = IMAGERY;

  /* Feather geometry, in pixels, computed once. The disc is inscribed in the
   * square the server returned, so the rim is at half the width.
   *
   * THE FEATHER STAYS, and the HA card not having one is not an argument: that
   * card drew a full-viewport RECTANGLE clipped by the frame, so it had no rim
   * to hide. Landfall draws a 600 km DISC on a globe, and an unfeathered disc
   * reads as a sticker stuck on the planet. Different shape, different problem.
   */
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rim = Math.min(cx, cy);
  const inner = rim * featherStart;

  let counted = 0;
  let kept = 0;
  let chromaMax = 0;
  let chromaSum = 0;

  for (let y = 0, i = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++, i += 4) {
      const a0 = d[i + 3];

      /* The vendor already said "no data here." Nothing to rescue. */
      if (a0 === 0) continue;

      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;

      /* CHROMA — how far this pixel sits from grey.
       *
       * In the SVG this was `feColorMatrix` to a 0.333/0.333/0.333 grey copy,
       * then `feBlend mode="difference"` against the source, then an alpha row
       * that summed the three difference channels. That is exactly:
       *   |R - avg| + |G - avg| + |B - avg|
       * A difference blend was used there rather than an arithmetic subtract
       * because the subtract zeroes intermediate alpha and wipes the colour.
       * A canvas loop has no such hazard — the arithmetic is the arithmetic. */
      const avg = (r + g + b) / 3;
      const chroma = Math.abs(r - avg) + Math.abs(g - avg) + Math.abs(b - avg);

      counted++;
      chromaSum += chroma;
      if (chroma > chromaMax) chromaMax = chroma;

      /* THE COLOUR KNOCKOUT.
       *
       * CLAMPED HERE, BEFORE THE FADES, AND THAT ORDER IS LOAD-BEARING. The
       * SVG clamps every feColorMatrix result to 0..1 and then MULTIPLIES the
       * fade masks onto it (`feComposite operator="arithmetic" k1="1"` is a
       * product). Translating the fades as subtractions off an unclamped mask
       * — which is the obvious-looking port, and the one that was proposed —
       * breaks in both directions at once:
       *
       *   strong red pixel, raw mask 4.03: subtracting 0.05 + 0.05 leaves 3.93,
       *     which clamps to 1.0, so THE FADES DO NOTHING on exactly the vivid
       *     pixels they were written to tame.
       *   faint blue pixel, raw mask 0.433: 0.433 * 0.80 * 0.96 = 0.333 the
       *     right way, but 0.433 - 0.20 - 0.04 = 0.193 the wrong way — 42% too
       *     aggressive.
       *
       * The HA source says so in its own comment: "Multiplied onto the
       * saturation mask, so it only ever REMOVES opacity." */
      let alpha = clamp01(satSlope * chroma + satIntercept);

      if (alpha > 0) {
        /* Edge fade. The enhancement's cold-EDGE band renders blue/purple and
         * otherwise sits at full opacity like the hot cores, which reads as
         * overpowering. High blue fades; the green/yellow/orange/red cores
         * (low blue) stay full. */
        alpha *= clamp01(1 - edgeFade * b);

        /* Purple-only fade, stacked on top. Purple/magenta is the one band with
         * BOTH red and blue high, so r*b is a magenta detector: pure blue
         * (r ~ 0) and the red/orange cores (b ~ 0) are untouched. */
        alpha *= clamp01(1 - purpleFade * r * b);

        /* Counted BEFORE the feather — see the return doc. */
        if (alpha > 0.02) kept++;

        const dx = x - cx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= rim) alpha = 0;
        else if (dist > inner) alpha *= 1 - smoothstep(inner, rim, dist);
      }

      /* RGB UNTOUCHED. The vendor's enhancement IS the picture — that is the
       * entire point of this rewrite. Only alpha is ours. */
      d[i + 3] = (alpha * a0) | 0;
    }
  }

  const stats = {
    keptFraction: counted ? kept / counted : 0,
    chromaMax,
    chromaMean: counted ? chromaSum / counted : 0,
  };

  /* One line per disc per refresh, so "what do our vendors actually send" is
   * answerable from a phone plugged into a laptop instead of from argument.
   * console.info, not warn: this is an observation, not a fault. The fault
   * call belongs to the caller, which has the whole set. */
  console.info(
    `[landfall] imagery ${sat?.id || '?'} chromaMax=${chromaMax.toFixed(3)} ` +
      `chromaMean=${stats.chromaMean.toFixed(3)} kept=${(stats.keptFraction * 100).toFixed(1)}%`,
  );

  return stats;
}
