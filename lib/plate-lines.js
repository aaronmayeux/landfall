/**
 * plate-lines.js — the plate boundary network, curved and named.
 *
 * ONE PLACE TURNS THE RAW PB2002 FILE INTO WHAT BOTH RENDERERS DRAW. MapLibre
 * paints the magma stack and the labels; the Three globe draws the same seams
 * from space. Before this module they each read the file and built their own
 * geometry, which meant the two copies were only accidentally the same shape —
 * and they are pixel-locked through the dive, so "accidentally" was a bug
 * waiting for someone to change one of them.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS IT DOES.
 *
 * 1. SMOOTHS, with the storm tracks' own curve. `lib/trackline.js smoothPath`
 *    is centripetal Catmull-Rom in a latitude-corrected frame: it passes
 *    exactly through every published vertex, and at alpha 0.5 it cannot cusp or
 *    loop back on itself. PB2002 is a polyline sampled every degree or so, so
 *    raw it reads as a chain of corners for the same reason a 6-hourly storm
 *    track does. Same problem, same fix, no second implementation.
 *
 *    IS A CURVE HONEST HERE? More so than on a storm track, and that is worth
 *    saying. A published plate boundary is a generalised interpretation of a
 *    deformation zone that can be tens of kilometres wide (see the note on
 *    `SIZE.plateWidthScale`). The straight chords between its vertices are not
 *    a measurement anybody made; they are what happens when you stop sampling.
 *    A curve through the same points claims no more precision than the chords
 *    did, and looks like what a plate boundary is.
 *
 * 2. NAMES BOTH SIDES. Every boundary carries `PlateA` and `PlateB`, and PB2002
 *    orders its vertices so that A lies to the LEFT of the direction of travel.
 *    That rule is not assumed — `config/plate-names.js` records the six
 *    boundaries it was checked against. So each seam yields two label lines,
 *    one displaced to each side, each carrying only its own plate's name.
 *
 * 3. RANKS THEM. Fifty-two plates all labelling at once is fifty-two labels
 *    MapLibre throws away. Total boundary length per plate is the rank: Pacific
 *    665°, Eurasia 600°, Antarctica 593° down to Manus at 4°. That ordering
 *    lands on very nearly Bird's own fourteen-large / thirty-eight-small split
 *    without being told about it, which is the sign it is measuring something
 *    real rather than fitting a curve.
 *
 * ---------------------------------------------------------------------------
 * ==> WHY THE LABEL LINES ARE DISPLACED IN THE GEOMETRY INSTEAD OF WITH
 * `text-offset`. THIS IS THE ONE DESIGN DECISION IN THE FILE. <==
 *
 * MapLibre can push a line-following label sideways off its line with
 * `text-offset`, and that offset IS perpendicular to the curve — measured in a
 * real browser against real MapLibre 5.6.0 before this was written, not assumed.
 * It is also pixel-constant, which is exactly what you want. It was the first
 * choice and it does not work, for one reason:
 *
 *   MapLibre flips a line label end-for-end when the line runs right-to-left on
 *   screen, so the text never reads upside down (`text-keep-upright`). The flip
 *   rotates the whole shaped label — INCLUDING its offset. Verified in the same
 *   harness: one line west-to-east put A above and B below; the identical line
 *   drawn east-to-west put them the other way round.
 *
 * That is not cosmetic. It labels the Pacific plate over California. And it
 * cannot be normalised away by ordering the source vertices consistently,
 * because the flip is decided from the label's SCREEN direction, live, every
 * frame — and `map/globe.js` enables `dragRotate` and `touchZoomRotate`, so the
 * user can turn the whole planet under it.
 *
 * Displacing the geometry itself is immune. The label sits on a line that is
 * already on the correct side, so whatever MapLibre then does with the glyphs —
 * flip them, rotate them, drop them — it cannot move them across the seam.
 *
 * THE PRICE IS THAT A GEOGRAPHIC OFFSET IS NOT PIXEL-CONSTANT, and it is paid
 * in two bands rather than pretended away. One value that reads well at the
 * planet band is a few hundred pixels adrift by the time you are over a
 * coastline. So each side is built twice, at two displacements, tagged `far`
 * and `near`, and the style crossfades between them (`PLATE_LINE.labelBand`).
 * Two bands, not five: within a band the on-screen clearance still varies by
 * about 6x, and the honest reason that is acceptable is that a label reading as
 * "on this side of the seam" is a loose requirement, not a measured one.
 *
 * ---------------------------------------------------------------------------
 * PURE. Takes a parsed GeoJSON object, returns plain objects. The fetch, the
 * caching and the failure state belong to `map/plate-seams.js`, because those
 * are §5 questions about what the user sees when a file does not arrive, and
 * this file has no opinion about screens. Imports: config/ and lib/ only.
 */

import { PLATE_LINE } from '../config/constants.js';
import { plateName } from '../config/plate-names.js';
import { smoothPath } from './trackline.js';

const DEG = Math.PI / 180;

/** Left of travel is PlateA, right is PlateB. Named so the sign is never a
 *  bare +1/-1 at a call site — getting it backwards is the one failure mode
 *  this whole file is arranged around. */
const SIDE = Object.freeze({ left: 1, right: -1 });

/* ---------------------------------------------------------------------------
 * READING THE SOURCE
 * ------------------------------------------------------------------------- */

const isPt = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Every drawable run in one feature, as arrays of `[lon, lat]`.
 *
 * SPLIT AT THE ANTIMERIDIAN, EVEN THOUGH TODAY'S FILE NEVER NEEDS IT. Checked
 * when this was written: PB2002 as shipped has zero consecutive pairs more than
 * 180° apart, so it is already pre-split. The guard stays because the cost is
 * one comparison per vertex and the failure it prevents is a straight line
 * drawn clean through the middle of the planet — which is precisely the bug
 * `proto/world-deep.js` was carrying its own copy of this check to avoid.
 */
function runsOf(feature) {
  const g = feature?.geometry;
  if (!g) return [];
  const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
  const out = [];
  for (const part of parts) {
    if (!Array.isArray(part)) continue;
    let run = [];
    for (const c of part) {
      if (!isPt(c)) continue;
      if (run.length && Math.abs(c[0] - run[run.length - 1][0]) > 180) {
        if (run.length >= 2) out.push(run);
        run = [];
      }
      run.push([c[0], c[1]]);
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/** Planar length of a run, degrees, latitude-corrected. Used only for ranking,
 *  so a cheap flat metric is the right one — this is not a distance anybody
 *  reads. */
function planarLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const cos = Math.max(Math.cos(((pts[i][1] + pts[i - 1][1]) / 2) * DEG), PLATE_LINE.minCosLat);
    total += Math.hypot((pts[i][0] - pts[i - 1][0]) * cos, pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

/* ---------------------------------------------------------------------------
 * THE SIDEWAYS DISPLACEMENT
 * ------------------------------------------------------------------------- */

/**
 * A copy of `pts` pushed `deg` degrees to one side of its own direction of
 * travel.
 *
 * The normal is taken in the same latitude-corrected planar frame the spline
 * uses, then un-corrected per vertex on the way out, so the displacement is a
 * constant ground distance rather than a constant number of longitude degrees.
 * Without that, an Antarctic boundary's labels would sit four times further off
 * their seam than an equatorial one's.
 *
 * ENDS USE THE ONE LEG THEY HAVE; interior vertices use the chord between their
 * neighbours, which is what keeps the offset copy smooth through a bend instead
 * of mitring at every vertex.
 *
 * A TIGHT ENOUGH BEND WILL STILL PINCH the inside copy, and at a sharp enough
 * one it self-intersects. Not guarded: the input is already a spline through
 * points about a degree apart and the displacements are a fraction of that, so
 * the worst case is a short label line with a kink in it. Guarding would mean
 * dropping labels near hairpins, which is a real cost for an invisible gain.
 */
function offsetRun(pts, side, deg) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const cosMid = Math.max(Math.cos(pts[i][1] * DEG), PLATE_LINE.minCosLat);
    const dx = (b[0] - a[0]) * cosMid;
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    /* Left normal of the travel direction (dx, dy) is (-dy, dx). */
    const nx = (-dy / len) * side * deg;
    const ny = (dx / len) * side * deg;
    /* ==> LATITUDE IS CLAMPED, AND IT IS NOT A TIDY-UP. <== A boundary running
     * along 87°N displaced 4° north lands at 91°, which is not a coordinate.
     * MapLibre does not reject that one feature — geojson-vt fails on it and the
     * WHOLE SOURCE tiles to nothing, so every plate label on the planet
     * disappears because of two vertices in the Arctic. Measured exactly that
     * way in a headless run: 964 features in the source, 0 tiled, no error
     * anywhere and no glyphs ever requested. Two coordinates out of 8,872. */
    out.push([pts[i][0] + nx / cosMid, Math.max(-90, Math.min(90, pts[i][1] + ny))]);
  }
  return out;
}

/**
 * Thin a run down to roughly one vertex every `spacingDeg`.
 *
 * The label geometry only has to describe the shape the text bends along, and
 * text bends along a curve far coarser than the curve the magma line is drawn
 * from. Four label lines per seam at full spline resolution would quadruple the
 * vertex count of the whole layer to describe a bend no glyph can follow.
 * First and last vertices always survive, so a short run is never emptied.
 */
function thin(pts, spacingDeg) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    const cos = Math.max(Math.cos(pts[i][1] * DEG), PLATE_LINE.minCosLat);
    if (Math.hypot((pts[i][0] - prev[0]) * cos, pts[i][1] - prev[1]) >= spacingDeg) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ---------------------------------------------------------------------------
 * THE BUILD
 * ------------------------------------------------------------------------- */

const line = (coords, props) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

/**
 * Turn the PB2002 collection into the two collections the map draws.
 *
 * @param {object} gj — the parsed `plate-boundaries.geojson`.
 * @returns {{seams: object, labels: object, stats: object}}
 *   `seams`   — smoothed boundaries. Properties: `plateA`, `plateB` (full
 *               names), `codeA`, `codeB`, `type` (PB2002's own classification,
 *               `subduction` on 65 of them and empty on most of the rest),
 *               `tier`.
 *   `labels`  — one line per side per band, displaced. Properties: `plate`
 *               (the full name to draw), `tier`, `band` (`far` | `near`).
 *   `stats`   — `{ boundaries, vertices, labels, plates }`, for the status line.
 *               A count is what tells `none_matched` from `unavailable` (§5).
 *
 * TIER IS COMPUTED IN A FIRST PASS over the whole file, because a plate's rank
 * comes from the total length of all its boundaries and a single feature cannot
 * know it. Two passes over 241 features is not worth optimising away.
 */
export function buildPlateLines(gj) {
  const features = Array.isArray(gj?.features) ? gj.features : [];

  /* Pass one: how much boundary does each plate own? */
  const lengthByPlate = new Map();
  const runsByFeature = [];
  for (const f of features) {
    const runs = runsOf(f);
    runsByFeature.push(runs);
    if (!runs.length) continue;
    const total = runs.reduce((s, r) => s + planarLength(r), 0);
    for (const code of [f.properties?.PlateA, f.properties?.PlateB]) {
      if (!code) continue;
      lengthByPlate.set(code, (lengthByPlate.get(code) || 0) + total);
    }
  }

  /** A plate's tier: 1 is a plate everybody has heard of, 3 is a fragment.
   *  Thresholds are in `PLATE_LINE`, in the same degrees this file measures. */
  const tierOf = (code) => {
    const len = lengthByPlate.get(code) || 0;
    if (len >= PLATE_LINE.tierMajorDeg) return 1;
    if (len >= PLATE_LINE.tierMinorDeg) return 2;
    return 3;
  };

  const seams = [];
  const labels = [];
  let vertices = 0;

  /* Pass two: smooth, name, displace. */
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const codeA = f.properties?.PlateA || '';
    const codeB = f.properties?.PlateB || '';
    const nameA = plateName(codeA);
    const nameB = plateName(codeB);
    const tier = Math.min(tierOf(codeA), tierOf(codeB));
    const type = f.properties?.Type || '';

    for (const run of runsByFeature[i]) {
      /* ASKING FOR A DENSITY, NOT A TOTAL. `smoothPath` spreads whatever budget
       * it is given evenly across the legs, so `legs x samplesPerLeg` is how you
       * request uniform smoothness; the per-boundary ceiling then stops the
       * longest seam from spending the layer. Handing it a flat total instead
       * would make a 16-point boundary silky and a 272-point one straight.
       * `smoothPath` returns a run of fewer than three points untouched rather
       * than padding it. */
      const budget = Math.min(
        PLATE_LINE.maxVerticesPerBoundary,
        Math.max(1, run.length - 1) * PLATE_LINE.samplesPerLeg
      );
      const curve = smoothPath(run, budget);
      vertices += curve.length;
      seams.push(line(curve, { codeA, codeB, plateA: nameA, plateB: nameB, type, tier }));

      const spine = thin(curve, PLATE_LINE.labelSpacingDeg);
      for (const [band, deg] of Object.entries(PLATE_LINE.labelOffsetDeg)) {
        if (nameA) {
          const l = offsetRun(spine, SIDE.left, deg);
          if (l.length >= 2) labels.push(line(l, { plate: nameA, tier: tierOf(codeA), band }));
        }
        if (nameB) {
          const r = offsetRun(spine, SIDE.right, deg);
          if (r.length >= 2) labels.push(line(r, { plate: nameB, tier: tierOf(codeB), band }));
        }
      }
    }
  }

  return {
    seams: { type: 'FeatureCollection', features: seams },
    labels: { type: 'FeatureCollection', features: labels },
    stats: {
      boundaries: seams.length,
      vertices,
      labels: labels.length,
      plates: lengthByPlate.size,
    },
  };
}
