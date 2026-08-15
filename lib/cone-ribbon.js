/**
 * cone-ribbon.js — the cone, sliced along its length and coloured by what the
 * environment is worth to the storm. SPEC §47.4, §47.5.
 *
 * A PURE FUNCTION. Ribs in, a SHIPS run in, GeoJSON out. No DOM, no network,
 * no clock, no map. Everything that decides what colour a slice is happens
 * here, so the one place worth testing hard is one file with one entry point.
 *
 * ==> THIS LAYER REPORTS, IT DOES NOT SCORE. <== SHIPS publishes what each
 * factor is worth in knots and those columns sum to its own intensity
 * forecast. The number this file colours by is the signed sum of the ten
 * environment rows, computed upstream in the relay's parser and carried on the
 * wire. Nothing here weights anything, invents anything, or predicts anything.
 * Brighter means the environment is working for the storm, darker means it is
 * working against it, and the layer answers nothing else.
 *
 * ==> THE COLOUR IS BAKED ONTO EACH FEATURE AND THAT IS NOT AN OPTIMISATION.
 * <== map/theme-state.js rule 1b: a MapLibre paint property holding BOTH a
 * themed `global-state` reference and a feature read (`['get', …]`) evaluates
 * in the worker, which is never sent the state, and resolves to BLACK in both
 * themes without throwing. Model guidance and the genesis patches already take
 * the colour-per-feature route for exactly this reason. A theme change
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

import { ENV_RIBBON, CONE_SWEEP } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * THE RAMP
 * ------------------------------------------------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');

/** Blend two hex stops. Plain sRGB, because the ramp's three stops were chosen
 *  by eye in sRGB on the mockup and a perceptual space would move the middle
 *  away from the colour that was actually judged. */
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

/** Knots to ramp position. Clipped at both ends rather than rescaled — §47.4
 *  measured the clipping and accepted it (3.5% dark, 2.0% bright) to keep the
 *  middle, where half the season lives, from flattening. */
export const rampT = (kt) =>
  clamp01((kt - ENV_RIBBON.scaleLoKt) / (ENV_RIBBON.scaleHiKt - ENV_RIBBON.scaleLoKt));

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
 * ==> THE FIX HAS NO NUMBER OF ITS OWN AND INHERITS THE +6 h COLOUR. <==
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
 * to them would slide the colours off the track by however far the two
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
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ribs.length; i++) {
      const dx = (ribs[i].lon - p.lon) * cos;
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
 * One storm's cone slices, coloured.
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
 * @param {object} args.run       the SHIPS payload from /api/nhc/ships
 * @param {Array<string>} args.stops the active palette's ramp
 * @returns {{status:string, reason:string|null, features:Array,
 *            fromHr:number|null, toHr:number|null}}
 */
export function buildRibbon({ ribs, caps, forecast, run, stops }) {
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
     * does not have, and that is the failure this layer exists not to commit. */
    let ok = true;
    for (let i = a; i <= b; i++) if (kt[i] == null) { ok = false; break; }
    if (!ok) continue;

    /* Colour from the MIDDLE of the slice rather than either end, so a slice
     * is never a whole step brighter or darker than the stretch it represents. */
    const mid = kt[Math.floor((a + b) / 2)];

    /* Down the left edge, back along the right. Every intermediate station is
     * kept, so the slice hugs the same curve the cone edge is drawn from — the
     * saving in ENV_RIBBON.sliceDeg is polygons, never shape. */
    const ring = [];
    for (let i = a; i <= b; i++) ring.push(ribs[i].left);
    for (let i = b; i >= a; i--) ring.push(ribs[i].right);
    ring.push(ring[0]);

    features.push({
      type: 'Feature',
      properties: {
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
   * the gap and put confident colour on the one stretch we know nothing about.
   * So each cap borrows from its OWN neighbouring slice or it is not drawn.
   */
  const capFeature = (ring, kt, hr) => ({
    type: 'Feature',
    properties: { _color: rampAt(stops, rampT(kt)), kt: Math.round(kt), hr: Math.round(hr) },
    geometry: { type: 'Polygon', coordinates: [ring] },
  });

  /* The tail cap sits behind the current position, so it takes the fix's own
   * colour — which is already the +6 h value inherited back (§47.5). Nothing
   * new is claimed: it is the same number one slice further back. */
  if (caps?.start && kt[0] != null) {
    features.unshift(capFeature(caps.start, kt[0], hours[0]));
  }
  const lastIdx = ribs.length - 1;
  if (caps?.end && kt[lastIdx] != null) {
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
