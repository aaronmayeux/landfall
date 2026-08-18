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

/**
 * The two layers that draw an unbanded product: the dashed chord and its
 * breakpoint dots.
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
