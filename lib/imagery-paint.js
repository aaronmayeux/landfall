/**
 * imagery-paint.js — the one pixel pass (SPEC §4).
 *
 * KEEP THE VENDOR'S COLOR. KNOCK OUT THE GREY.
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
 * A color-enhanced infrared product renders COLD STORM TOPS IN VIVID COLOR
 * and warm ground, low cloud and clear sky in GREY OR BLACK. So the key is
 * SATURATION, not brightness: a bright grey pixel is dropped, a colored one is
 * kept, and the vendor's own RGB is written back untouched. The only thing this
 * function writes is ALPHA.
 *
 * Unlike a brightness key, the two main knobs are independent of how BRIGHT the
 * cloud is — they set WHERE on the grey-to-color axis the cutoff sits.
 *
 * ==> WHAT REPLACED WHAT, SO NOBODY RE-LITIGATES IT <==
 *
 * Retired: `IMAGERY_RAMP`, the 256-entry LUT, `clearBelow`, `solidAbove`,
 * `colorSat`, `coloredFloor`, and the whole normalized-coldness idea. It is
 * gone, not commented out. The specific failure it produced: `coloredFloor`
 * pinned EVERY pixel the vendor had already colored into t >= 0.86, which on
 * our old ramp was the band from (191,230,245) to white — so the coldest,
 * most vivid, most informative part of a storm rendered as one flat white
 * smear. The most interesting pixels were the ones we destroyed hardest.
 *
 * ==> TWO KEYS, BECAUSE OUR VENDORS ARE NOT THE SAME PRODUCT <==
 *
 * A chroma key CANNOT work on a greyscale product — there is no chroma to key
 * on, every pixel resolves to zero, and the disc renders as nothing. Confirmed
 * on glass 2026-07-25: the three NASA GIBS birds ship a vivid thermal
 * enhancement; EUMETSAT's `msg_iodc:ir108` ships plain grey.
 *
 * So there are two paths, chosen by `sat.enhanced`, and they are DELIBERATELY
 * THE SAME SHAPE — a normalized signal, a `slope * signal + intercept` ramp,
 * clamped, then the rim feather. Only the SIGNAL differs:
 *
 *   enhanced   signal = CHROMA, how far the pixel sits from grey. The vendor
 *              already decided what is cold and colored it; we keep what it
 *              colored.
 *   greyscale  signal = BRIGHTNESS, normalized against that vendor's own black
 *              and white points. In every IR product brighter means colder
 *              means higher tops means the storm, so the floor goes just above
 *              warm ocean and cloud climbs away from it.
 *
 * EITHER WAY THE VENDOR'S RGB IS WRITTEN BACK UNTOUCHED. The greyscale path
 * renders honest monochrome infrared, not a repaint — which is the whole
 * difference between it and the ramp that was deleted. It looks like a
 * black-and-white satellite loop because that is what EUMETSAT sent.
 *
 * ==> THE CONFIG STATES A BELIEF AND THIS PASS CHECKS IT <==
 *
 * `sat.enhanced` is a claim about a vendor, and this project has already been
 * burned once by treating a claim about a vendor as a fact. So every frame
 * measures `chromaMax` regardless of which path it took, and a frame that
 * CONTRADICTS the flag warns loudly. A vendor changing its product silently is
 * exactly the kind of thing that would otherwise show up as a blank disc over a
 * live cyclone — the §5 failure the spec exists to prevent.
 *
 * Per-satellite and not per-frame, on purpose: a GOES frame over genuinely
 * clear ocean has no cold tops and therefore no color, and auto-switching THAT
 * to the brightness path would light up the warm low cloud the chroma key
 * exists to hide.
 *
 * Imports: config/ only. No DOM — the caller owns the canvas.
 */

import { IMAGERY } from '../config/constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 601 luma from 0..1 channels. A greyscale vendor sends R=G=B so any
 *  luma formula agrees on it; this one stays sane if a frame turns out to be
 *  faintly tinted after all. */
const luma01 = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;

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
 * @param {object}    sat  the SATELLITES entry — supplies `enhanced` and, on
 *                         the greyscale path, the `black`/`white` anchors
 * @returns {{keptFraction:number, chromaMax:number, chromaMean:number,
 *            lumaLow:number, lumaHigh:number, enhanced:boolean}}
 *
 *   keptFraction  share of the vendor's pixels that survived the knockout,
 *                 measured BEFORE the rim feather — the feather is geometry
 *                 and must not contaminate a reading about content.
 *   chromaMax     the most saturated pixel in the frame, 0..1. Measured on
 *                 BOTH paths so a vendor that changes its product is caught.
 *   chromaMean    average saturation. Tells "faintly tinted" from "genuinely
 *                 enhanced" when the flag is in question.
 *   lumaLow/High  the frame's 2nd and 98th brightness percentiles, 0..255.
 *                 THESE ARE HOW THE GREYSCALE ANCHORS GET CORRECTED — read
 *                 them off a real cyclone frame rather than guessing, which is
 *                 the mistake this file has already made once.
 *
 * IN PLACE, on purpose: a second half-million-pixel buffer per storm per
 * refresh is exactly the kind of allocation that shows up as a stutter.
 */
export function paintDisc(img, sat, opts = {}) {
  const d = img.data;
  const w = img.width;
  const h = img.height;

  const { satSlope, satIntercept, edgeFade, purpleFade, greySlope, greyIntercept } = IMAGERY;

  /* WHICH KEY. A claim from config, checked against the frame below. */
  const enhanced = sat?.enhanced !== false;

  /* Greyscale anchors, guarded. A pair that arrived inverted or equal would
   * divide by zero and paint garbage; falling back to the full byte range
   * degrades the contrast and nothing else. Only the brightness path reads
   * these — an enhanced vendor never touches them. */
  const black = Number.isFinite(sat?.black) ? sat.black / 255 : 0;
  const white = Number.isFinite(sat?.white) ? sat.white / 255 : 1;
  const greySpan = white - black > 0.05 ? white - black : 1;

  /* 256-bucket brightness histogram, for the percentiles above. One increment
   * per pixel — cheaper than sorting and it is the only way to report a
   * calibration number that outliers cannot skew. */
  const hist = new Uint32Array(256);

  /* The fade is a live SETTING, so it arrives as an argument and the constant
   * is only the fallback. Passed in rather than imported from data/ because
   * lib/ never reads a store — the caller owns where the number came from. */
  const fadeWidth = Number.isFinite(opts.fadeWidth) ? opts.fadeWidth : IMAGERY.fadeWidth;
  const featherStart = clamp01(1 - fadeWidth);

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
       * because the subtract zeroes intermediate alpha and wipes the color.
       * A canvas loop has no such hazard — the arithmetic is the arithmetic. */
      const avg = (r + g + b) / 3;
      const chroma = Math.abs(r - avg) + Math.abs(g - avg) + Math.abs(b - avg);

      counted++;
      chromaSum += chroma;
      if (chroma > chromaMax) chromaMax = chroma;

      const luma = luma01(r, g, b);
      hist[(luma * 255) | 0]++;

      let alpha;

      if (enhanced) {
        /* THE COLOR KNOCKOUT.
         *
         * CLAMPED HERE, BEFORE THE FADES, AND THAT ORDER IS LOAD-BEARING. The
         * SVG clamps every feColorMatrix result to 0..1 and then MULTIPLIES the
         * fade masks onto it (`feComposite operator="arithmetic" k1="1"` is a
         * product). Translating the fades as subtractions off an unclamped mask
         * — which is the obvious-looking port, and the one that was proposed —
         * breaks in both directions at once:
         *
         *   strong red pixel, raw mask 4.03: subtracting 0.05 + 0.05 leaves
         *     3.93, which clamps to 1.0, so THE FADES DO NOTHING on exactly the
         *     vivid pixels they were written to tame.
         *   faint blue pixel, raw mask 0.433: 0.433 * 0.80 * 0.96 = 0.333 the
         *     right way, but 0.433 - 0.20 - 0.04 = 0.193 the wrong way — 42%
         *     too aggressive.
         *
         * The HA source says so in its own comment: "Multiplied onto the
         * saturation mask, so it only ever REMOVES opacity." */
        alpha = clamp01(satSlope * chroma + satIntercept);

        if (alpha > 0) {
          /* Edge fade. The enhancement's cold-EDGE band renders blue/purple and
           * otherwise sits at full opacity like the hot cores, which reads as
           * overpowering. High blue fades; the green/yellow/orange/red cores
           * (low blue) stay full. */
          alpha *= clamp01(1 - edgeFade * b);

          /* Purple-only fade, stacked on top. Purple/magenta is the one band
           * with BOTH red and blue high, so r*b is a magenta detector: pure
           * blue (r ~ 0) and the red/orange cores (b ~ 0) are untouched. */
          alpha *= clamp01(1 - purpleFade * r * b);
        }
      } else {
        /* THE BRIGHTNESS KNOCKOUT — same shape, different signal.
         *
         * `t` is normalized coldness against this vendor's own grey range:
         * 0 is the warmest thing it renders, 1 the coldest. Then the identical
         * `slope * signal + intercept` ramp the color path uses, so the two
         * behave like siblings and one mental model covers both.
         *
         * NO EDGE OR PURPLE FADE HERE, and that is not an omission. Both are
         * functions of the blue and red channels, which on a grey pixel are
         * just luminance again — `1 - edgeFade * b` would dim the brightest,
         * coldest cloud tops by half, which is precisely backwards.
         *
         * This is NOT the ramp that was deleted. That one repainted every pixel
         * from a palette of ours; this only decides opacity and leaves
         * EUMETSAT's own greys alone. The result is honest monochrome infrared,
         * which is what a black-and-white satellite loop has always looked
         * like — not a wash. */
        const t = clamp01((luma - black) / greySpan);
        alpha = clamp01(greySlope * t + greyIntercept);
      }

      if (alpha > 0) {
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

  /* Percentiles, not min and max: a single stuck pixel or one coastline
   * highlight would otherwise define the whole range, and these numbers exist
   * to be pasted into the `black`/`white` anchors. */
  const percentile = (frac) => {
    const target = counted * frac;
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= target) return v;
    }
    return 255;
  };

  const stats = {
    keptFraction: counted ? kept / counted : 0,
    chromaMax,
    chromaMean: counted ? chromaSum / counted : 0,
    lumaLow: counted ? percentile(0.02) : 0,
    lumaHigh: counted ? percentile(0.98) : 0,
    enhanced,
  };

  /* One line per disc per refresh, so "what do our vendors actually send" is
   * answerable from a phone plugged into a laptop instead of from argument.
   * console.info, not warn: this is an observation, not a fault. The fault
   * call belongs to the caller, which has the whole set.
   *
   * luma is what CALIBRATES the greyscale path. If Meteosat's discs are washed
   * out or too sparse, these two numbers are the `black`/`white` anchors that
   * should have been used — read them off a real cyclone, never a clear box. */
  console.info(
    `[landfall] imagery ${sat?.id || '?'} ${enhanced ? 'color' : 'grey'} ` +
      `chromaMax=${chromaMax.toFixed(3)} chromaMean=${stats.chromaMean.toFixed(3)} ` +
      `luma=${stats.lumaLow}..${stats.lumaHigh} ` +
      `kept=${(stats.keptFraction * 100).toFixed(1)}%`,
  );

  /* THE CONFIG IS A BELIEF AND THIS IS THE CHECK.
   *
   * Warn on a CONTRADICTION in either direction, because both are real. A
   * vendor that starts colorising would silently lose its warm-cloud knockout;
   * one that stops would render nothing at all under the chroma key. Only the
   * grey-flagged direction can be judged from one frame, though — an enhanced
   * bird over genuinely clear ocean has no cold tops and therefore no color,
   * which is not evidence of anything. */
  if (!enhanced && chromaMax >= IMAGERY.greyscaleChroma) {
    console.warn(
      `[landfall] ${sat?.id} is flagged greyscale but this frame has color ` +
        `(chromaMax=${chromaMax.toFixed(3)}). Set enhanced:true in SATELLITES ` +
        `and the chroma knockout takes over.`,
    );
  }

  return stats;
}
