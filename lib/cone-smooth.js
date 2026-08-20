/**
 * cone-smooth.js — which cone the map draws, and the guard that decides.
 *
 * TWO WAYS TO DRAW A CONE, IN ORDER OF PREFERENCE:
 *
 *   1. THE SWEEP (lib/cone-sweep.js). Rebuild it as what it is — a growing
 *      circle slid along the smoothed forecast track. Bends exactly as much as
 *      the track bends, because it is built out of it.
 *   2. THE OUTLINE CURVE (lib/ringpolish.js `splineClosedRing`). Trace the
 *      published outline and put the arc back between its vertices. Fixes the
 *      nose cap, which our own Douglas-Peucker pass faceted, and cannot touch
 *      the long straight flanks — see CONE_CURVE in config/constants.js for why
 *      that is a property of splines and not a bug to be tuned out.
 *
 * The sweep runs whenever it can. It returns `null` — not a worse shape — the
 * moment anything it depends on is missing or wrong, and then (2) draws.
 *
 * ==> WHERE THE SAFETY CHECK LIVES. <== In lib/cone-sweep.js, not here, because
 * the bound it tests against — the sagitta of our own smoothed track — is
 * computed from geometry only that file holds. The sweep is deliberately
 * allowed to be NARROWER than the published cone on the inside of a bend, by
 * exactly that much and no more; see the note there for why no smooth shape can
 * avoid it and why Aaron took that trade. A `null` back from the sweep means
 * the bound was broken, and then (2) draws.
 *
 * THE ORDER AGAINST smoothTracks MATTERS NOW, WHERE IT DID NOT BEFORE. The
 * sweep reads the SMOOTHED forecast track, so it must run after it. Run it
 * first and the cone would be swept along the faceted track and would show the
 * facets of a line that is no longer drawn.
 *
 * A SHALLOW COPY, NEVER A MUTATION — same rule as smoothTracks and
 * withoutFuture: the bundle is a cached object shared with the ambient
 * collections.
 *
 * Pure functions. Imports: config and lib only. No DOM, ever.
 */

import { CONE_CURVE, SIMPLIFY, TRACK_LINE } from '../config/constants.js';
import { splineClosedRing } from './ringpolish.js';
import { simplifyRing } from './simplify.js';
import { sweepConeDetail } from './cone-sweep.js';
import { measureConeRibs } from './cone-measure.js';

/** Fallback curve settings. TRACK_LINE owns the shape, CONE_CURVE the budget. */
const OPTS = Object.freeze({
  spacingDeg: CONE_CURVE.spacingDeg,
  minPerLeg: CONE_CURVE.minPerLeg,
  maxPerLeg: CONE_CURVE.maxPerLeg,
  maxVertices: CONE_CURVE.maxVertices,
  alpha: TRACK_LINE.alpha,
  minKnotGap: TRACK_LINE.minKnotGap,
  minCosLat: TRACK_LINE.minCosLat,
});

/* ---------------------------------------------------------------------------
 * READING THE BUNDLE
 * ------------------------------------------------------------------------- */

/** Every ring of a cone feature's geometry, outer and holes alike. */
function ringsOf(geometry) {
  const t = geometry?.type;
  if (t === 'Polygon') return geometry.coordinates;
  if (t === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

/** The smoothed forecast track as one polyline, or null.
 *
 *  ONLY A SINGLE LINESTRING QUALIFIES. A track that arrived in pieces and would
 *  not assemble (lib/trackline.js `extras`) is not one path, so there is no
 *  single curve to sweep along and no honest way to pick which piece is the
 *  spine. Those storms keep the published outline. */
function trackOf(bundle) {
  const slot = bundle?.layers?.forecastTrack;
  if (slot?.status !== 'ok') return null;
  const feats = slot.fc?.features || [];
  if (feats.length !== 1) return null;
  const g = feats[0]?.geometry;
  if (g?.type !== 'LineString') return null;
  const c = g.coordinates;
  return Array.isArray(c) && c.length >= 3 ? c : null;
}

/** Storms already reported, so a refusal is said ONCE rather than on every
 *  ambient re-push — which is several times a minute. */
const refused = new Set();

/**
 * Say so when the rebuild declines.
 *
 * ==> THE MISSING LINE THAT COST A WHOLE ROUND. <== The first version of this
 * fell back silently. It refused on every storm, drew the old shape, and the
 * only evidence was Aaron looking at his phone and saying it had not changed —
 * which is indistinguishable from the rebuild running and being no good. A
 * feature that can quietly not run is a feature nobody can debug (§5: never
 * ship silence on failure).
 */
function noteRefusal(label) {
  if (refused.has(label)) return;
  refused.add(label);
  console.info(
    `[landfall] ${label}: cone rebuild declined — drawing the published outline. ` +
    `Its shape does not fit the smoothed forecast track closely enough to redraw safely.`
  );
}

/* ---------------------------------------------------------------------------
 * THE FALLBACK
 * ------------------------------------------------------------------------- */

/** Thin to knots, then put the arc back between them. Simplifying first makes
 *  the output density a property of this module rather than of whichever source
 *  published the cone; the tolerance is the one the GDACS path already applied,
 *  so on that path it drops nothing. */
const curveRing = (ring) =>
  splineClosedRing(simplifyRing(ring, SIMPLIFY.gdacsToleranceDeg), OPTS);

function curveGeometry(geometry) {
  const t = geometry?.type;
  if (t === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(curveRing) };
  }
  if (t === 'MultiPolygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((poly) => poly.map(curveRing)) };
  }
  return geometry;
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------- */

/**
 * A bundle whose cone is drawn the best way available to it.
 *
 * `_smoothed` marks a reshaped geometry, and `_swept` says which of the two
 * ways produced it. Nothing downstream reads either today; a geometry that has
 * been rebuilt should say so in the one place a future reader will look, and
 * "which path ran" is the first question anybody debugging this will ask.
 *
 * @param {object} bundle
 * @param {string} [label] storm name, for the console line only
 */
export function smoothCone(bundle, label = 'storm') {
  const slot = bundle?.layers?.cone;
  if (slot?.status !== 'ok') return bundle;
  const features = slot.fc?.features;
  if (!Array.isArray(features) || !features.length) return bundle;

  try {
    const track = trackOf(bundle);

    /* ==> THE STATIONS THE SWEEP IS ASSEMBLED FROM, KEPT RATHER THAN DROPPED.
     * <== §47.5's environment ribbon fills this cone in slices, and a slice is
     * one station's two edge points and the next one's. Measuring the cone a
     * second time to get them would be a second answer to a question this pass
     * has already answered, and the two could disagree — which shows on glass
     * as a ribbon that does not fit the cone it is painted inside.
     *
     * ONLY THE FIRST POLYGON'S. A cone is one polygon or it is not swept at
     * all (see `single` below), so there is never a second set to choose
     * between; the array exists so the map/filter below stays a pure
     * expression rather than becoming a loop with an accumulator. */
    let ribs = null;
    /* The two half-ellipses at either end of the rebuilt cone. They are NOT
     * ribs and no pair of stations spans them, which is why they are carried
     * as their own shapes — see the note in lib/cone-sweep.js. */
    let caps = null;

    const rebuilt = features.map((f) => {
      const rings = ringsOf(f.geometry);

      /* ==> SWEEPING NEEDS ONE POLYGON. MEASURING DOES NOT. <== §47.5, and
       * these were ONE gate until 2026-08-20, which is what kept the
       * environment ribbon off every storm near the antimeridian.
       *
       * The sweep's bar is right and unchanged: a multi-part cone has no
       * single spine, and running one track through two shapes would merge
       * them into an outline no source published.
       *
       * ==> BUT A MULTI-PART CONE IS NOT AN ODDITY IN THE CENTRAL PACIFIC —
       * IT IS WHAT THE DATE LINE DOES TO EVERY CONE THAT CROSSES IT. <== NHC's
       * MapServer cuts the polygon at ±180 and returns the two halves as a
       * MultiPolygon. Lala, advisory 33: one piece spanning −180.00 to
       * −170.58, a second of 191 points spanning 178.78 to 180.00. Sharing the
       * gate meant her cone was never even OFFERED to the measurement, so the
       * ribbon reported "this cone could not be measured" about a cone that
       * measures fine — 236 stations out of 236 when the same rings are handed
       * to `measureConeRibs` directly. SHIPS covers the Central Pacific, whose
       * five-day cones reach the seam routinely, so this is a live basin
       * rather than a corner case.
       *
       * Measuring across the two halves is safe for the reason cone-measure.js
       * exists: it rays against ALL the rings and returns nothing that is
       * DRAWN as an outline. `ringOnBranch` puts every ring on the track's
       * branch first, so the eastern half arrives as −181.22 to −180.00 and
       * sits contiguous with the western one; a ray that finds nothing at a
       * station marks that station `ok: false` and lib/cone-ribbon.js drops
       * only the slice around it. */
      const sweepable = f.geometry?.type === 'Polygon' && rings.length >= 1;

      if (track && sweepable) {
        const swept = sweepConeDetail(track, rings);
        if (!swept) noteRefusal(label);
        if (swept) {
          if (!ribs) {
            ribs = swept.ribs;
            caps = { start: swept.capStart, end: swept.capEnd };
          }
          return {
            ...f,
            properties: { ...(f.properties || {}), _smoothed: true, _swept: true },
            geometry: { type: 'Polygon', coordinates: [swept.ring] },
          };
        }
      }

      /* ==> THE REBUILD DECLINING — OR NEVER BEING OFFERED — IS NOT A REASON
       * TO LOSE THE MEASUREMENT. <== §47.5. `sweepConeDetail` refuses when it
       * cannot produce a smooth outline that is safe to DRAW: on a tight bend
       * the swept edge loops and MapLibre fills the loop as a hole. That bar
       * is right for pixels and has nothing to do with whether the cone can be
       * measured. For a third of Ida's advisories it took the environment
       * ribbon down with it, which is what Aaron saw come and go on Lala
       * (2026-08-18).
       *
       * So the cone here falls back to the published outline exactly as it
       * always has — the drawing is untouched — and the stations are measured
       * off it instead.
       *
       * ==> MEASURED AGAINST THE CURVED RING, NOT THE PUBLISHED ONE, AND THE
       * DIFFERENCE IS VISIBLE. <== The first version rayed against `rings`
       * and it is nearly right: `curveGeometry` thins the outline to knots
       * and puts arcs back between them, which moves it by at most 3.1 km
       * across the Ida corpus. That reads as nothing on paper and as a grey
       * rim between the color and the cone edge on a phone, because a cone
       * five days long fills the screen and three kilometres is several
       * pixels of it. Aaron saw it as the ribbon sitting slightly off the
       * cone, 2026-08-18.
       *
       * The fix is to measure the shape that will actually be DRAWN. It is
       * curved once, here, and the same rings are handed to both — so the
       * ribbon cannot sit off the cone by any amount at all, rather than by
       * an amount somebody has decided is small enough. */
      const curved = curveGeometry(f.geometry);
      if (!ribs && track && rings.length) {
        const measured = measureConeRibs(track, ringsOf(curved));
        if (measured) {
          ribs = measured.ribs;
          caps = { start: measured.capStart, end: measured.capEnd };
        }
      }
      return {
        ...f,
        properties: { ...(f.properties || {}), _smoothed: true, _swept: false },
        geometry: curved,
      };
    });

    return {
      ...bundle,
      layers: {
        ...bundle.layers,
        /* `ribs` is null only when NEITHER path could measure this cone —
         * the rebuild declined AND the published outline could not be read
         * from the track either (too few stations see it at all). A null here
         * is a real answer rather than a missing one, and lib/cone-ribbon.js
         * says so in words. A declined REBUILD no longer produces one: the
         * stations then come from the published polygon instead. */
        cone: { ...slot, fc: { type: 'FeatureCollection', features: rebuilt }, ribs, caps },
      },
    };
  } catch (err) {
    console.warn(`[cone] ${label}: leaving the cone as published —`, err);
    return bundle;
  }
}
