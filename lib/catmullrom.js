/**
 * catmullrom.js — one centripetal Catmull-Rom sample. The curve, and nothing
 * else.
 *
 * EXTRACTED, NOT INVENTED (§12: any pattern used twice gets extracted before
 * the second use). This was private to lib/trackline.js, where it bends the
 * past and forecast tracks. lib/ringpolish.js now bends the cone of
 * uncertainty with the same maths, and the alternative was a second copy.
 *
 * WHY THE TWO CALLERS MUST SHARE IT RATHER THAN EACH KEEP ONE. The cone and
 * the track are drawn on top of each other and read as one picture. A curve
 * that rounded a track one way and its cone another would show up as the cone
 * leaving its own track's shoulder — which is a version of the mismatch this
 * work started from, not a fix for it.
 *
 * CENTRIPETAL, alpha 0.5, and that is a safety argument rather than a taste
 * call: at alpha 0 (uniform) the curve overshoots and can loop back on itself
 * where the direction change is sharp. On a track that is a recurve; on a
 * CLOSED RING it is a self-intersecting polygon, which MapLibre fills with a
 * hole. At 0.5 cusps and self-intersections are mathematically impossible.
 * Full reasoning lives on TRACK_LINE.alpha in config/constants.js.
 *
 * THE CURVE PASSES EXACTLY THROUGH p1 AND p2. Only the space between them is
 * invented, which is what lets both callers say they never moved a published
 * position.
 *
 * Pure function. Imports: nothing at all. No DOM, ever.
 */

/**
 * One sample on the segment p1 → p2, using p0 and p3 as the shape hints.
 *
 * @param {[number,number]} p0 the vertex before the segment
 * @param {[number,number]} p1 segment start — the curve passes through it at t=0
 * @param {[number,number]} p2 segment end — the curve reaches it at t=1
 * @param {[number,number]} p3 the vertex after the segment
 * @param {number} t 0..1 along the segment
 * @param {number} alpha knot exponent; 0.5 is centripetal
 * @param {number} minKnotGap floor on knot spacing, so a near-duplicate that
 *                            survived deduping cannot divide by zero
 * @returns {[number,number]}
 */
export function crPoint(p0, p1, p2, p3, t, alpha, minKnotGap) {
  const tj = (ti, a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return ti + Math.max(Math.pow(d, alpha), minKnotGap);
  };
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;

  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}
