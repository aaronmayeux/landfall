/**
 * cone-ribbon.js — the cone, sliced along its length and colored by what the
 * environment is worth to the storm. SPEC §47.4, §47.5.
 *
 * A PURE FUNCTION. Ribs in, a SHIPS run in, GeoJSON out. No DOM, no network,
 * no clock, no map. Everything that decides what color a slice is happens
 * here, so the one place worth testing hard is one file with one entry point.
 *
 * ==> THIS LAYER REPORTS, IT DOES NOT SCORE. <== SHIPS publishes what each
 * factor is worth in knots and those columns sum to its own intensity
 * forecast. The number this file colors by is the signed sum of the ten
 * environment rows, computed upstream in the relay's parser and carried on the
 * wire. Nothing here weights anything, invents anything, or predicts anything.
 * Brighter means the environment is working for the storm, darker means it is
 * working against it, and the layer answers nothing else.
 *
 * ==> THE COLOR IS BAKED ONTO EACH FEATURE AND THAT IS NOT AN OPTIMISATION.
 * <== map/theme-state.js rule 1b: a MapLibre paint property holding BOTH a
 * themed `global-state` reference and a feature read (`['get', …]`) evaluates
 * in the worker, which is never sent the state, and resolves to BLACK in both
 * themes without throwing. Model guidance and the genesis patches already take
 * the color-per-feature route for exactly this reason. A theme change
 * re-pushes every bundle (main.js `onRepushGuidance`), so the ribbon rethemes
 * for free and needs no entry on that file's list of exceptions.
 *
 * EVERY NUMBER IN HERE IS KNOTS. Nothing converts. §8's rule, and §47.4 states
 * it for this layer specifically: the ramp domain, the band cuts and the
 * takes-a-side test are all knots, and the reader's units are applied at the
 * moment TEXT is drawn — which is §47.8's job, not this file's.
 *
 * Imports: config only.
 */

import { ENV_RIBBON, CONE_SWEEP, TRACK_LINE } from '../config/constants.js';

/** Two vertices closer than this are one vertex. The same figure every other
 *  ring in the app is deduped against (lib/cone-sweep.js), so a slice edge and
 *  the cone edge it lies against cannot disagree about what counts as a point. */
const RING_EPS_DEG = TRACK_LINE.joinEpsDeg;

/* ---------------------------------------------------------------------------
 * THE RAMP
 * ------------------------------------------------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');

/** Blend two hex stops. Plain sRGB, because the ramp's three stops were chosen
 *  by eye in sRGB on the mockup and a perceptual space would move the middle
 *  away from the color that was actually judged. */
function blend(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `#${A.map((v, i) => hex2(v + (B[i] - v) * t)).join('')}`;
}

/**
 * Walk a list of stops. `t` of 0 is the first, 1 is the last.
 *
 * Exported because `tools/test-cone-ribbon.mjs` asserts the ends and the middle
 * land exactly on the palette's own stops — a ramp that quietly drifted off its
 * tokens would still look like a ramp.
 */
export function rampAt(stops, t) {
  if (!Array.isArray(stops) || !stops.length) return null;
  if (stops.length === 1) return stops[0];
  const n = stops.length - 1;
  const span = clamp01(t) * n;
  const i = Math.min(Math.floor(span), n - 1);
  return blend(stops[i], stops[i + 1], span - i);
}

/** Knots to ramp position.
 *
 * ==> PIECEWISE SINCE 2026-08-22, AND THE MEASURED DOMAIN IS UNCHANGED (§47.4).
 * <== `-15..+15` maps onto the first `scaleInnerFraction` of the ramp, which
 * with four evenly-spaced stops puts the original three back on 0, 1/3 and 2/3.
 * So every reading inside the domain resolves to the colour it always had, byte
 * for byte, and §47.4's argument for +/-15 needs no revisiting.
 *
 * Past `scaleHiKt` it keeps going into the fourth stop rather than clamping,
 * out to `scaleOuterKt`. That end used to flatten 2.0% of the season, which
 * sounds small until it lands on a storm that lives up there: Lala ran +18 kt
 * to +34 kt across the back half of her cone and drew it in one flat violet.
 *
 * ==> THE HOSTILE END STILL CLAMPS AT `scaleLoKt` AND THAT IS NOT AN OVERSIGHT.
 * <== It is already the ocean colour in both palettes by design (§47.5), so
 * there is nothing further to extend into. A -52 kt hour and a -23 kt hour draw
 * identically; they always did.
 */
export const rampT = (kt) => {
  const { scaleLoKt: lo, scaleHiKt: hi, scaleOuterKt: outer } = ENV_RIBBON;
  const inner = ENV_RIBBON.scaleInnerFraction;
  if (!Number.isFinite(kt)) return 0;
  if (kt <= lo) return 0;
  if (kt <= hi) return ((kt - lo) / (hi - lo)) * inner;
  return inner + clamp01((kt - hi) / (outer - hi)) * (1 - inner);
};

/* ---------------------------------------------------------------------------
 * THE LINE'S LEGIBILITY FLOOR
 *
 * ==> THE LINE USES THE CONE'S OWN RAMP AND IS LIFTED ONLY WHERE IT WOULD
 * DISAPPEAR. <== §47.5. It used to carry a SEPARATE three-stop ramp
 * (`envRampLine`), hand-tuned so every stop cleared 3 : 1 against the sea. That
 * solved the real problem — a 1.75 px track that vanishes on exactly the storms
 * the environment is tearing apart is §5 silence — and it created a second one
 * nobody could see until a storm ran off the top of the scale.
 *
 * A separate ramp compresses the WHOLE journey, not just the end that needed
 * it. Measured on Lala, 2026-08-18: her environment runs −2 kt at the storm to
 * +32 kt by day five, so everything past hour 60 clamps to the ramp's bright
 * end and the visible variation is all in the first half. Across that half the
 * cone fill travelled #51448f → #c4b0ff, plainly a gradient; the line travelled
 * #8d80d3 → #c4b0ff and read as one flat colour. Two surfaces showing the same
 * number and only one of them showing it. Aaron, on glass.
 *
 * So the line takes the cone's colour EXACTLY wherever that colour can be seen,
 * and is lifted only where it cannot. At the bright end the two are now the
 * same pixel value rather than two nearby ones.
 *
 * ==> IT IS LIFTED TOWARD THE RAMP'S OWN FAR END, AND THAT IS WHAT MAKES ONE
 * RULE WORK IN BOTH THEMES. <== The floor is not "lightness". §47.5 states the
 * rule in terms of the OCEAN, because brightness inverts between the themes and
 * saturation does not: on the night globe a helping environment glows, and on
 * the greyscale day globe it darkens, so the light theme's hostile stop IS the
 * daylight sea. A lightness floor would be right in one theme and exactly
 * backwards in the other. Blending toward `stops[last]` is right in both by
 * construction — it is the direction "more environment" already runs — and it
 * preserves the hue journey rather than washing it out toward a neutral.
 *
 * 3 : 1 is WCAG's bar for a graphical object and the same bar the wind bands
 * are held to. It is the bar the retired ramp was tuned against, so nothing
 * about how legible a hostile line is has changed.
 * ------------------------------------------------------------------------- */

/** sRGB relative luminance, WCAG's definition. */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours, 1 to 21. */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A colour lifted toward `target` until it clears `min` against `sea`.
 *
 * ==> A SEARCH, NOT A FORMULA. <== Contrast is not linear in the blend factor
 * and the two themes travel in opposite directions through it, so the closed
 * form would be two closed forms and a sign. Sixteen steps of bisection lands
 * within a fraction of a ratio point, runs once per slice — about a hundred per
 * storm, at bundle build time and never per frame — and is the same answer in
 * both themes with no branch.
 *
 * Returns the colour UNCHANGED when it already clears, which is the common case
 * and the whole point: most of a ribbon is now literally the cone's own colour.
 *
 * Exported for `tools/test-cone-ribbon.mjs`, which asserts both halves — that a
 * legible colour is untouched, and that an illegible one comes back legible.
 */
export function liftToLegible(color, sea, target, min) {
  if (!color || !sea || !target) return color;
  if (contrast(color, sea) >= min) return color;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const t = (lo + hi) / 2;
    if (contrast(blend(color, target, t), sea) >= min) hi = t;
    else lo = t;
  }
  const out = blend(color, target, hi);
  /* The far end of the ramp is the most contrast this hue journey has to give.
   * If even that does not clear the bar, the palette is the thing to fix, and
   * returning the best available beats returning something off the ramp. */
  return contrast(out, sea) >= min ? out : target;
}

/* ---------------------------------------------------------------------------
 * WHAT THE ENVIRONMENT IS WORTH AT ONE FORECAST HOUR
 * ------------------------------------------------------------------------- */

/**
 * The environment number at an arbitrary forecast hour, or `null` where the
 * run publishes nothing drawable there.
 *
 * ==> DRAWABILITY COMES OFF THE `drawable` ARRAY AND NEVER OFF A VALUE BEING
 * ZERO. <== §47.2 measured both halves of this and they point the same way. A
 * zero is not an end-of-forecast signal: of the files whose wind ends early,
 * 110 fall to zeros and 75 keep publishing real numbers to the end, so the
 * values alone cannot tell the two apart. And neutral is the season's single
 * most common REAL reading — 374 drawable hours across 224 files read exactly
 * 0 kt. Read a zero as an ending and a short forecast paints a confident
 * mid-violet "nothing happening" across the half of its cone that has no
 * forecast at all.
 *
 * ==> THE FIX HAS NO NUMBER OF ITS OWN AND INHERITS THE +6 h COLOR. <==
 * §47.5. Every value in the contribution table is a change FROM NOW, so there
 * is no column for now. Filling that gap with zero — which an early version of
 * this design did — lands dead centre of the ramp and paints a confident
 * neutral over the storm's current position: the brightest thing the eye goes
 * to first, asserting something the file never said, and doing it worst on a
 * storm the environment is tearing apart. Six hours is well inside the area
 * each SHIPS number already averages over, so carrying it back one slice
 * claims less than the number already claims.
 */
export function environmentAtHour(run, hr) {
  const hours = run?.hours;
  const env = run?.environmentKt;
  const drawable = run?.drawable;
  if (!Array.isArray(hours) || !Array.isArray(env) || !Array.isArray(drawable)) return null;
  if (!Number.isFinite(hr)) return null;

  /* Before the first published column: the fix, and the hours between it and
   * +6 h. Inherit, do not invent. */
  if (hr <= hours[0]) return drawable[0] ? env[0] : null;

  for (let i = 0; i < hours.length - 1; i++) {
    if (hr > hours[i + 1]) continue;
    /* ==> BOTH ENDS OF THE SPAN MUST BE DRAWABLE. <== Interpolating from a
     * drawable hour into an undrawable one would extend the ribbon half a
     * forecast interval past the last position the file actually publishes,
     * which is the §47.6 failure — a ribbon that quietly runs on past its own
     * data with nothing saying so. */
    if (!drawable[i] || !drawable[i + 1]) return null;
    const span = hours[i + 1] - hours[i];
    const t = span > 0 ? (hr - hours[i]) / span : 0;
    return env[i] + (env[i + 1] - env[i]) * t;
  }

  /* Past the last column. Never extrapolated — the ribbon simply stops and the
   * cone reverts to its plain fill (§47.6). */
  return null;
}

/* ---------------------------------------------------------------------------
 * WHERE ALONG THE CONE ONE FORECAST HOUR SITS
 * ------------------------------------------------------------------------- */

/**
 * The forecast hour at each rib, by matching the DRAWN TRACK rather than
 * SHIPS's own coordinates.
 *
 * ==> §47.2 IS EXPLICIT ABOUT THIS AND THE REASON IS NOT OBVIOUS. <== SHIPS
 * can be NEWER than the advisory — a 06 UTC run against a 00 UTC advisory was
 * measured on a real storm. Its latitudes and longitudes are therefore a
 * different forecast from the one the map is drawing, and anchoring the ribbon
 * to them would slide the colors off the track by however far the two
 * forecasts disagree. The forecast HOUR is the one thing both publications
 * agree on, so that is the join.
 *
 * The ribs are uniformly spaced along the track by arc length (lib/cone-sweep.js
 * `resample` guarantees it), so each carries a fraction `t` and the hour is
 * interpolated between the forecast points' own fractions.
 *
 * @param {Array} ribs      from lib/cone-sweep.js `sweepConeDetail`
 * @param {Array} forecast  the bundle's forecast points: `{lon, lat, tau}`
 * @returns {Array<number>|null} one hour per rib, or null if it cannot be done
 */
export function hoursAlong(ribs, forecast) {
  if (!Array.isArray(ribs) || ribs.length < 2) return null;

  /* GDACS points can carry a null `tau` (data/gdacs-points.js computes it from
   * an analysis time that is not always published). A point with no hour is no
   * use as an anchor, and dropping it is not a loss — the remaining anchors
   * still span the track. */
  const pts = (forecast || []).filter(
    (p) => p && Number.isFinite(p.tau) && Number.isFinite(p.lon) && Number.isFinite(p.lat)
  );
  if (pts.length < 2) return null;

  /* ==> THE TWO INPUTS DO NOT ARRIVE ON THE SAME BRANCH OF LONGITUDE, AND ON
   * THE SEAM THAT IS A 360° ERROR RATHER THAN A SMALL ONE. <== The ribs come
   * out of lib/cone-sweep.js on the TRACK's branch, which lib/trackline.js
   * deliberately leaves unwrapped so MapLibre can draw one continuous line
   * across the antimeridian: a station at 178°E is carried as −182. The
   * forecast points arrive from the source wrapped into (−180, 180], so the
   * same ground is 178. Subtract those two and the nearest-station search is
   * measuring most of the way round the planet — every anchor lands on the
   * same end station, the ascending filter below throws all but one away, and
   * the whole ribbon silently refuses on exactly the storms that cross 180.
   *
   * SHIPS covers the Central Pacific, whose eastern half is 20° from the seam
   * and whose five-day cones routinely reach across it, so this is a live
   * basin rather than a theoretical one.
   *
   * The cone spans a few tens of degrees at most, so the ribs' own mean is an
   * unambiguous reference and each anchor moves onto it as one whole number
   * of turns. */
  const ref = ribs.reduce((a, r) => a + r.lon, 0) / ribs.length;
  const onBranch = (lon) => lon + 360 * Math.round((ref - lon) / 360);

  /* Each anchor's position along the ribs, by nearest station. Longitude is
   * scaled by cos(latitude) so "nearest" means nearest on the ground rather
   * than nearest in degrees — at 45° a degree of longitude is 79 km against
   * 111 km of latitude, and the error is worst on exactly the recurving tracks
   * where the anchors are closest together. */
  const cos = Math.max(
    Math.cos((ribs[Math.floor(ribs.length / 2)].lat * Math.PI) / 180),
    0.1
  );
  const anchors = [];
  for (const p of pts) {
    const lon = onBranch(p.lon);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ribs.length; i++) {
      const dx = (ribs[i].lon - lon) * cos;
      const dy = ribs[i].lat - p.lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    anchors.push({ t: ribs[best].t, tau: p.tau });
  }

  /* Sorted and de-duplicated by station. Two forecast points can land on the
   * same station on a slow-moving storm, and a zero-width span would divide by
   * zero and produce Infinity hours — which read as "past the end of the file"
   * and would silently blank the ribbon rather than throwing. */
  anchors.sort((a, b) => a.t - b.t || a.tau - b.tau);
  const kept = [];
  for (const a of anchors) {
    const prev = kept[kept.length - 1];
    if (prev && a.t - prev.t < 1e-9) continue;
    /* Hours must ASCEND with distance along the track or the join is not a
     * join. A track that doubles back on itself can put a later forecast point
     * nearest an earlier station; that anchor is dropped rather than allowed
     * to invert a stretch of the ribbon. */
    if (prev && a.tau <= prev.tau) continue;
    kept.push(a);
  }
  if (kept.length < 2) return null;

  return ribs.map((rib) => {
    const t = rib.t;
    if (t <= kept[0].t) return kept[0].tau;
    for (let i = 0; i < kept.length - 1; i++) {
      if (t > kept[i + 1].t) continue;
      const span = kept[i + 1].t - kept[i].t;
      const f = span > 0 ? (t - kept[i].t) / span : 0;
      return kept[i].tau + (kept[i + 1].tau - kept[i].tau) * f;
    }
    return kept[kept.length - 1].tau;
  });
}

/* ---------------------------------------------------------------------------
 * THE RIBBON
 * ------------------------------------------------------------------------- */

/** How many stations one painted slice spans. See ENV_RIBBON.sliceDeg for why
 *  this is not one. */
const STRIDE = Math.max(1, Math.round(ENV_RIBBON.sliceDeg / CONE_SWEEP.stepDeg));

/**
 * One storm's cone slices, colored.
 *
 * The returned `reason` is what the app says when nothing is drawn, and the
 * three answers are deliberately distinct (§5): a basin SHIPS does not cover,
 * a storm whose run is not published yet, and a healthy run with nothing
 * paintable in it. They are not the same fact and must never collapse into one
 * empty layer.
 *
 * @param {object} args
 * @param {Array}  args.ribs      lib/cone-sweep.js stations, or null
 * @param {object} args.caps      its two end-cap rings, or null
 * @param {Array}  args.forecast  the bundle's forecast points
 * ==> IT EMITS TWO KINDS OF FEATURE INTO ONE COLLECTION. <== `_kind: 'slice'`
 * is a cone polygon; `_kind: 'line'` is the same stretch of CENTRELINE, in the
 * floored line ramp (§47.5). They are built in the same loop off the same
 * stations from the same number, which is the whole point — the fill and the
 * track can disagree only if someone computes them twice, and nothing here
 * computes them twice. `map/layers/environment.js` splits them by `_kind`.
 *
 * @param {object} args.run       the SHIPS payload from /api/nhc/ships
 * @param {Array<string>} args.stops  the active palette's cone ramp. The line
 *        uses it too, lifted where it would vanish — see `liftToLegible`.
 * @param {string} args.sea   the active palette's `ocean`, which is what the
 *        line has to stay visible against
 * @returns {{status:string, reason:string|null, features:Array,
 *            fromHr:number|null, toHr:number|null}}
 */
export function buildRibbon({ ribs, caps, forecast, run, stops, sea }) {
  /* No sea means no floor, not no ribbon: a palette that cannot say what its
   * ocean is has a bigger problem than a dim line, and losing the whole layer
   * over it would be the §5 failure this file exists to avoid. The line is
   * then simply the cone's colour, which is what it is everywhere legible
   * anyway. */
  const lineTarget = stops[stops.length - 1];
  const lineColor = (c) =>
    (sea ? liftToLegible(c, sea, lineTarget, ENV_RIBBON.lineMinContrast) : c);
  const nothing = (status, reason) => ({
    status, reason, features: [], fromHr: null, toHr: null,
  });

  if (!run) return nothing('empty', 'loading');
  if (run.status === 'basin_not_covered') return nothing('empty', 'basin');
  if (run.status === 'no_run_published') return nothing('empty', 'no_run');
  if (run.status !== 'ok') return nothing('empty', 'unavailable');

  /* A HEALTHY RUN THAT PAINTS NOTHING IS NOT RARE AND IT IS NOT AN ERROR.
   * Twenty-three files in the 2026 season — 6% — carried a full contribution
   * table and forecast winds while publishing no forecast POSITION past hour 0
   * (§47.6). The file is fine; there is simply nothing to draw. */
  if (!run.drawableHours) return nothing('empty', 'nothing_drawable');

  /* No ribs means the cone rebuild refused and the map is drawing the
   * published outline instead (lib/cone-smooth.js). That outline has no
   * stations, and a ribbon built from widths the sweep's own guard has just
   * rejected would sit visibly inside the drawn cone edge. Say so; do not
   * paint it. */
  if (!Array.isArray(ribs) || ribs.length < 2) return nothing('empty', 'no_ribs');

  const hours = hoursAlong(ribs, forecast);
  if (!hours) return nothing('empty', 'no_ribs');

  const kt = hours.map((hr) => environmentAtHour(run, hr));

  const features = [];
  let fromHr = null;
  let toHr = null;

  for (let a = 0; a < ribs.length - 1; a += STRIDE) {
    const b = Math.min(a + STRIDE, ribs.length - 1);

    /* EVERY STATION IN THE SLICE HAS TO HAVE A NUMBER, not just its two ends.
     * The drawable window is one clean run (§47.2 measured no interior gaps in
     * 365 files), so in practice this only ever trims the slice straddling the
     * end — but a slice half of which has no data is a slice claiming data it
     * does not have, and that is the failure this layer exists not to commit.
     *
     * ==> AND EVERY STATION HAS TO HAVE A PLACE, WHICH IS A SEPARATE FACT.
     * <== §47.5. On the path where the cone was MEASURED rather than rebuilt
     * (lib/cone-sweep.js `measureConeRibs`), a rib carries `ok: false` where
     * its ray missed the cone or where the edge doubles back on the inside of
     * a bend. Those two stations bound a slice that is not a slice — a
     * self-overlapping quad that paints one stretch of cone twice, which is
     * exactly the double-blend §47.5's shared vertices exist to prevent. The
     * reader loses a slice or two on a hard turn and keeps the rest; before
     * this path existed they lost the entire ribbon. A swept rib has no `ok`
     * and is trusted, which is what `!== false` says. */
    let ok = true;
    for (let i = a; i <= b; i++) {
      if (kt[i] == null || ribs[i]?.ok === false) { ok = false; break; }
    }
    if (!ok) continue;

    /* Color from the MIDDLE of the slice rather than either end, so a slice
     * is never a whole step brighter or darker than the stretch it represents. */
    const mid = kt[Math.floor((a + b) / 2)];

    /* Down the left edge, back along the right. Every intermediate station is
     * kept, so the slice hugs the same curve the cone edge is drawn from — the
     * saving in ENV_RIBBON.sliceDeg is polygons, never shape. */
    /* ==> DEDUPED, AND ON THE MEASURED PATH IT IS NOT COSMETIC. <== A rib whose
     * edge was pinched (lib/cone-measure.js) shares its point with its
     * neighbour, so a slice through the inside of a bend arrives with several
     * identical vertices. A repeated vertex is a zero-length segment and a
     * zero-length segment has no direction — enough to make a
     * self-intersection test report a crossing that is not there, and enough
     * to hand MapLibre a degenerate edge to triangulate. The cone rings strip
     * this in lib/cone-sweep.js for exactly the same reason; the slices did
     * not, and the moment pinching existed 148 of them read as crossed. */
    const ring = [];
    const push = (p) => {
      const prev = ring[ring.length - 1];
      if (prev && Math.abs(prev[0] - p[0]) < RING_EPS_DEG
               && Math.abs(prev[1] - p[1]) < RING_EPS_DEG) return;
      ring.push(p);
    };
    for (let i = a; i <= b; i++) push(ribs[i].left);
    for (let i = b; i >= a; i--) push(ribs[i].right);
    /* A slice pinched at BOTH ends is a line, not a polygon. Nothing to paint
     * and nothing honest to claim, so it is dropped like any other. */
    if (ring.length < 3) continue;
    ring.push(ring[0]);

    /* THE CENTRELINE FOR THIS SAME STRETCH. Built from the stations' own
     * `lon`/`lat` — the smoothed track the cone was swept along — so the
     * colored line lies exactly on the white forecast line it covers rather
     * than on a second interpolation of it.
     *
     * SLICES SHARE THEIR BOUNDARY STATION (`a` of the next is `b` of this
     * one), so consecutive segments meet at a point and the line has no gaps
     * at the color steps. */
    const spine = [];
    for (let i = a; i <= b; i++) spine.push([ribs[i].lon, ribs[i].lat]);
    if (spine.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {
          _kind: 'line',
          _color: lineColor(rampAt(stops, rampT(mid))),
          kt: Math.round(mid),
          hr: Math.round(hours[Math.floor((a + b) / 2)]),
        },
        geometry: { type: 'LineString', coordinates: spine },
      });
    }

    features.push({
      type: 'Feature',
      properties: {
        _kind: 'slice',
        _color: rampAt(stops, rampT(mid)),
        /* Carried for the drawer and for anyone debugging a slice that looks
         * wrong. Rounded to a whole knot because that is the precision SHIPS
         * publishes; a slice reading -6.4 would imply an accuracy the file
         * never claimed. */
        kt: Math.round(mid),
        hr: Math.round(hours[Math.floor((a + b) / 2)]),
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });

    if (fromHr === null) fromHr = hours[a];
    toHr = hours[b];
  }

  if (!features.length) return nothing('empty', 'nothing_drawable');

  /* ==> THE CAPS, AND WITHOUT THEM EVERY CONE HAD A GREY BLOB AT BOTH ENDS.
   * <== A rib is a cut across the cone; a cap is the half-ellipse BEYOND the
   * last station, and no pair of stations spans one. The first version sliced
   * the ribs, covered the straight middle perfectly, and dropped the rounded
   * nose and tail through to the plain veil — on a cone whose run was drawable
   * end to end, which made it look like missing data when it was missing
   * geometry.
   *
   * ==> A CAP IS PAINTED ONLY IF THE TRACK END IT TOUCHES IS. <== This is the
   * whole honesty of it. The nose cap is the day-5 circle, so the number at
   * the last drawable hour is genuinely the number for that ground — but when
   * a run STOPS SHORT of the cone (§47.6: 86 files in the season lost their
   * positions before +120 h, and 23 had none at all), the ribbon has to stop
   * mid-cone with plain fill beyond it. Painting the far cap then would jump
   * the gap and put confident color on the one stretch we know nothing about.
   * So each cap borrows from its OWN neighbouring slice or it is not drawn.
   */
  const capFeature = (ring, kt, hr) => ({
    type: 'Feature',
    properties: {
      _kind: 'slice',
      _color: rampAt(stops, rampT(kt)),
      kt: Math.round(kt),
      hr: Math.round(hr),
    },
    geometry: { type: 'Polygon', coordinates: [ring] },
  });

  /* The tail cap is the cone's rounded end AT the current position — since
   * §7.11 the first station IS the storm, so the cap is a small round-off
   * around the fix rather than a stretch of ground behind it. It takes the
   * fix's own color, which is already the +6 h value inherited back (§47.5).
   * Nothing new is claimed: it is the same number at the same place.
   *
   * ==> THIS SENTENCE USED TO READ "sits behind the current position", AND
   * THAT WENT FROM DESCRIPTION TO BUG WITHOUT ANYONE TOUCHING IT. <== It was
   * true while the cone began at the published apex. §7.11 moved the first
   * station forward onto the storm and left the cap's own sizing measuring the
   * advisory's leftover tail, so on Moke this painted confident environment
   * colour over 112 miles of water she had already crossed. Fixed in
   * lib/cone-sweep.js (§7.9); the note is kept because the layer that made it
   * visible was this one. */
  /* A cap borrows from the station it touches, so it inherits that station's
   * `ok` for the same reason the slices do: an unmeasurable end rib gives the
   * cap nothing to borrow. */
  if (caps?.start && kt[0] != null && ribs[0]?.ok !== false) {
    features.unshift(capFeature(caps.start, kt[0], hours[0]));
  }
  const lastIdx = ribs.length - 1;
  if (caps?.end && kt[lastIdx] != null && ribs[lastIdx]?.ok !== false) {
    features.push(capFeature(caps.end, kt[lastIdx], hours[lastIdx]));
  }

  return {
    status: 'ok',
    reason: null,
    features,
    fromHr: Math.round(fromHr),
    toHr: Math.round(toHr),
  };
}
