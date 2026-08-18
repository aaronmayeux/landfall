/**
 * coast-fallback.js — how a coastal product draws when there is NO COAST
 * UNDER IT TO PAINT (SPEC-MAP.md §7.10).
 *
 * ===========================================================================
 * THE PROBLEM, MEASURED ON GLASS
 * ===========================================================================
 *
 * NHC publishes watch/warnings and surge reaches as BREAKPOINTS — named
 * coastal places joined by straight lines. `map/coast-band.js` buffers that
 * line into a corridor, selects the loaded coastline inside it, and repaints
 * it, so the product ends up drawn ON the shore. Where no coast is loaded in
 * the corridor it keeps NHC's delivered chord instead, flagged
 * `_banded: false` — correctly, because official geometry is not ours to
 * discard, and a warning that vanishes is the §5 silence.
 *
 * ==> BUT THE FALLBACK WAS DRAWN IN THE STRIPE'S OWN PAINT, SO A GUESS AND A
 *     MEASUREMENT WERE PIXEL-IDENTICAL. <==
 *
 * Lala, advisory 25, 2026-08-18: a Tropical Storm Watch from French Frigate
 * Shoals to Maro Reef and a Hurricane Watch on to Lisianski Island. Real
 * orders, real land — the Northwestern Hawaiian Islands are atolls a few
 * hundred metres across, far below anything the basemap carries, so the
 * corridor found nothing and both features fell back. On the phone that was
 * two fat solid strokes across empty ocean, and it read exactly as the bug it
 * was not: "the app drew a coastline in the middle of the sea."
 *
 * The same trap sits under `map/layers/surge.js`, whose reaches band through
 * the identical path — Caribbean cays and Pacific atolls hit it the same way.
 * One fix, two callers, so it lives here rather than twice.
 *
 * ===========================================================================
 * THE FIX: DASH THE LINE, DOT THE BREAKPOINTS
 * ===========================================================================
 *
 * NOT deletion. A Hurricane Watch in force with nothing on the map is the §5
 * failure with the worst consequence in the app, and it is the one the coastal
 * pipeline has already been bitten by once (lib/watchwarning.js carries the
 * null-geometry measurement).
 *
 * NOT the stripe's paint either. A guess must not look like a measurement.
 *
 * So: the chord draws DASHED at the forecast track line's own width
 * (`STORM_GEO.trackForecastWidth`), with longer marks and shorter gaps than
 * any model line — and every breakpoint gets an OPEN RING.
 *
 * ==> WHY NOT LIGHTER. <== The first pass tied the chord to the coastline's
 * width curve and held it at 0.6 opacity, on the reasoning that a fallback
 * should look like the weakest thing on the map. On glass, beside five model
 * tracks, that made a government order look like a model's opinion (Aaron,
 * 2026-08-18). A watch is not a guess about where the storm goes; it is a fact
 * about where the order applies. It gets a decided line's weight, and the DASH
 * plus the OPEN rings carry the "we could not snap this to a shore" reading
 * instead.
 *
 * The rings are the point. NHC's line is not a shape it surveyed; it is the
 * straight joins between named places, and those places are the only part of
 * the geometry that is exactly true. Anchors with an approximation strung
 * between them is an honest picture. A confident solid stroke is not.
 *
 * ==> AND THE RINGS ARE HOLLOW ON PURPOSE. <== A FILLED dot in this app means
 * a storm of a known Saffir-Simpson strength (§6); map/watch-marks.js already
 * forbids borrowing that equation. An open ring says "a place".
 *
 * ==> COLOR IS UNTOUCHED. <== Saffir-Simpson and the NHC watch/warning hues
 * are the §6 fixed contract, and a Hurricane Watch is pink whether we managed
 * to snap it to a shore or not. What changes is the CONFIDENCE the drawing
 * claims, never the severity it reports.
 *
 * ==> SHARED BREAKPOINTS ARE NOT DEDUPED, ON PURPOSE. <== Adjacent products
 * meet at a breakpoint — Lala's watch and warning share Maro Reef exactly —
 * so two dots of different colors land on one coordinate. Merging them would
 * mean choosing a color for a place that is genuinely under both orders, and
 * the app already has an answer for that: the caller's sort key, which puts
 * the severer product on top everywhere else it overlaps (§6). Let it decide
 * here too.
 *
 * Imports: map/ sibling + config. Pure — no map, no DOM, no fetch.
 */

import { STORM_GEO } from '../config/tokens.js';
import { lineParts } from './coast-band.js';

/** Painted onto real coastline — the ordinary stripe. */
export const IS_BANDED = ['==', ['get', '_banded'], true];

/** Fell back to NHC's delivered chord. */
export const IS_CHORD = ['==', ['get', '_banded'], false];

/** A breakpoint dot generated below, not a feature from NHC.
 *  Line layers must exclude these explicitly: a mark copies its parent's
 *  properties (so it carries the right color and severity), which means every
 *  filter the parent passes, the mark passes too. */
export const IS_MARK = ['==', ['get', '_mark'], true];
export const NOT_MARK = ['!=', ['get', '_mark'], true];

/**
 * A Point feature for every breakpoint of every UNBANDED feature.
 *
 * Banded features are skipped: their geometry is real coastline now, with
 * hundreds of vertices, and dotting those would carpet the shore.
 *
 * Properties are copied wholesale so the caller's existing color and sort-key
 * expressions work on a mark without knowing marks exist.
 *
 * @param {Array} features  post-band features (each carrying `_banded`)
 * @returns {Array} Point features, `_mark: true`
 */
export function chordMarks(features) {
  const out = [];
  for (const f of features || []) {
    if (f?.properties?._banded !== false) continue;
    for (const part of lineParts(f.geometry)) {
      for (const p of part) {
        out.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p },
          properties: { ...f.properties, _mark: true },
        });
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * PULLING THE CHORD BACK OFF THE RINGS
 *
 * ==> THIS IS DONE IN SCREEN PIXELS, NOT IN DEGREES, AND IT HAS TO BE. <== The
 * ring is a FIXED PIXEL radius — it does not scale with the ground — so the
 * gap it needs is a pixel distance too. Trimming a fixed number of degrees
 * would leave the line buried in the ring when zoomed in and cut a hole
 * hundreds of km wide when zoomed out.
 *
 * `map.project` gives exact screen coordinates for the camera as it stands,
 * globe curvature included, which is the same tool map/layers/points-forecast.js
 * uses to place its labels. Trim there, unproject back.
 *
 * EVERY SEGMENT BECOMES ITS OWN PART. A product with five breakpoints has
 * rings on the three in the middle as well as the two ends, and a single
 * polyline trimmed only at its ends would still run straight through those
 * three. Splitting an N-point line into N-1 independently trimmed segments
 * handles interior rings for free — and a MultiLineString draws identically.
 *
 * THE CAMERA MOVES AND THIS GOES STALE. Both callers re-run `decorated()` on
 * `moveend`, so the gap is correct on any settled camera and can be slightly
 * off mid-pinch. That is a cosmetic drift on a thin dashed line, not a wrong
 * statement about a warning, so it is not worth a per-frame recompute.
 * ------------------------------------------------------------------------- */

/** Pixels of line to remove at each end of each segment: the ring's outer edge
 *  plus a hair of clear air. `circle-stroke-width` grows OUTWARD from
 *  `circle-radius`, so the outer edge is the two added. */
const trimPx = () =>
  STORM_GEO.chordMarkRadius + STORM_GEO.chordMarkStroke + STORM_GEO.chordMarkClearPx;

/**
 * Trim every unbanded feature's chord back to the edge of its breakpoint
 * rings. Banded features pass through untouched — their geometry is real
 * coastline and carries no rings.
 *
 * ==> CALL THIS AFTER `chordMarks`, NEVER BEFORE. <== The rings belong on
 * NHC's ORIGINAL breakpoints. Mark a trimmed line and every ring lands one
 * gap-width inside the place it is supposed to be naming, which is a wrong
 * position rendered confidently — the §5 failure, in miniature.
 *
 * @param {object} map       needs `project` / `unproject`; anything else is a
 *                           no-op and the untrimmed chords draw
 * @param {Array}  features  post-band features
 */
export function trimChords(map, features) {
  const list = features || [];
  if (typeof map?.project !== 'function' || typeof map?.unproject !== 'function') {
    return list;
  }
  const cut = trimPx();
  /* Below this many pixels of surviving line there is nothing worth drawing —
   * two breakpoints whose rings nearly touch. Drop that connector rather than
   * squeeze in a smear. The RINGS still draw, so the order is never silent. */
  const minVisiblePx = cut;

  return list.map((f) => {
    if (f?.properties?._banded !== false) return f;

    const parts = [];
    for (const part of lineParts(f.geometry)) {
      for (let i = 0; i < part.length - 1; i++) {
        const seg = trimSegment(map, part[i], part[i + 1], cut, minVisiblePx);
        if (seg) parts.push(seg);
      }
    }

    /* NOTHING SURVIVED, SO KEEP WHAT NHC GAVE US. Every segment being too
     * short to trim is a real case (a warning covering one short reach), and
     * an empty geometry would delete a live government order from the map for
     * a cosmetic reason. The rings are the honest signal there; the untrimmed
     * chord under them is a smaller wrong than nothing at all (§5). */
    if (!parts.length) return f;

    return { ...f, geometry: { type: 'MultiLineString', coordinates: parts } };
  });
}

/** One segment, shortened by `cut` pixels at each end. Null when there would
 *  be nothing left, or when the projection gives an answer we cannot trust. */
function trimSegment(map, a, b, cut, minVisiblePx) {
  let pa;
  let pb;
  try {
    pa = map.project(a);
    pb = map.project(b);
  } catch {
    return [a, b]; /* projection refused — draw it untrimmed rather than lose it */
  }
  if (!Number.isFinite(pa?.x) || !Number.isFinite(pa?.y) ||
      !Number.isFinite(pb?.x) || !Number.isFinite(pb?.y)) {
    return [a, b];
  }

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len === 0) return null;
  if (len <= 2 * cut + minVisiblePx) return null;

  const t = cut / len;
  const ax = pa.x + dx * t;
  const ay = pa.y + dy * t;
  const bx = pb.x - dx * t;
  const by = pb.y - dy * t;

  try {
    const la = map.unproject([ax, ay]);
    const lb = map.unproject([bx, by]);
    if (!Number.isFinite(la?.lng) || !Number.isFinite(lb?.lng)) return [a, b];
    return [[la.lng, la.lat], [lb.lng, lb.lat]];
  } catch {
    return [a, b];
  }
}

/**
 * The two layers that draw an unbanded product: the dashed chord and its
 * breakpoint rings.
 *
 * Takes the caller's own `color` and `sortKey` expressions rather than
 * deriving them, because the two callers disagree on both — watch/warning
 * bakes a per-feature `_color` and sorts on `_sev`, surge matches a color word
 * and sorts on `severity` — and this module has no business knowing either
 * schema.
 *
 * NO GLOW PASS, unlike the stripe. The stripe carries one because it is
 * REPLACING the cyan coastline, which is a bright core over a wide blurred
 * halo, and painting only the core leaves cyan fringing out either side.
 * There is no coastline under a chord to cover, so a halo here would only
 * make an admitted approximation look heavier.
 *
 * @param {string} id            layer id prefix, matching the caller's stripe
 * @param {string} source        the caller's source id
 * @param {number|null} minzoom  ambient band floor, or null
 * @param {object} opts
 * @param {*} opts.color         MapLibre color expression
 * @param {*} opts.sortKey       MapLibre sort-key expression
 * @param {Array} [opts.extraFilter]  additional filter clauses (surge uses
 *   this to keep its polygons out — this module never learns what `kind` is)
 */
export function chordLayers(id, source, minzoom, { color, sortKey, extraFilter = [] }) {
  const zoomFloor = minzoom != null ? { minzoom } : {};
  return [
    {
      id: `${id}-chord`,
      type: 'line',
      source,
      ...zoomFloor,
      filter: ['all', IS_CHORD, NOT_MARK, ...extraFilter],
      layout: { 'line-cap': 'butt', 'line-join': 'round', 'line-sort-key': sortKey },
      paint: {
        'line-color': color,
        /* ==> THE FORECAST TRACK'S WIDTH, AS A REFERENCE RATHER THAN A COPY.
         * <== Tied to the coastline's zoom curve on the first pass, this came
         * out at model-track weight, and beside five model lines a government
         * order was indistinguishable from a model's opinion. A watch is not a
         * guess about where the storm goes; it carries a decided line's
         * weight. Reading `trackForecastWidth` means a future track restyle
         * drags this along instead of leaving the two to drift. */
        'line-width': STORM_GEO.trackForecastWidth,
        'line-opacity': STORM_GEO.chordOpacity,
        /* In multiples of line-width. Longer marks and shorter gaps than
         * `modelDash`, so the two never read as the same texture. */
        'line-dasharray': STORM_GEO.chordDash,
      },
    },
    {
      id: `${id}-chord-mark`,
      type: 'circle',
      source,
      ...zoomFloor,
      filter: ['all', IS_MARK, ...extraFilter],
      layout: { 'circle-sort-key': sortKey },
      paint: {
        'circle-radius': STORM_GEO.chordMarkRadius,
        /* ==> OPEN RING, NO FILL, AND THE EMPTINESS IS THE MEANING. <== A
         * FILLED dot in this app is a storm of a known Saffir-Simpson strength
         * (§6) and map/watch-marks.js already forbids borrowing that equation
         * for anything else. A hollow ring says "a place", which is what a
         * breakpoint is — and it lets the chord and the track under it read
         * through instead of being punched full of holes.
         *
         * The color therefore rides the STROKE. That is still feature data, so
         * it is fine; the rule broken by the black-ring bug was global THEME
         * state inside a data-driven expression, never data itself
         * (map/layers/points-forecast.js). */
        'circle-opacity': 0,
        'circle-stroke-width': STORM_GEO.chordMarkStroke,
        'circle-stroke-color': color,
      },
    },
  ];
}
