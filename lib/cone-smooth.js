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
import { sweepCone } from './cone-sweep.js';

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

/** Forecast point positions, or null. */
function pointsOf(bundle) {
  const slot = bundle?.layers?.forecastPoints;
  if (slot?.status !== 'ok') return null;
  const pts = (slot.fc?.features || [])
    .filter((f) => f?.geometry?.type === 'Point')
    .map((f) => f.geometry.coordinates)
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return pts.length >= 2 ? pts : null;
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
    const points = pointsOf(bundle);

    const rebuilt = features.map((f) => {
      const rings = ringsOf(f.geometry);

      /* ONE POLYGON ONLY. A multi-part cone has no single spine, and sweeping
       * one track through two shapes would merge them into something no source
       * published. */
      const single = f.geometry?.type === 'Polygon' && rings.length >= 1;

      if (track && points && single) {
        const swept = sweepCone(track, points, rings);
        if (swept) {
          return {
            ...f,
            properties: { ...(f.properties || {}), _smoothed: true, _swept: true },
            geometry: { type: 'Polygon', coordinates: [swept] },
          };
        }
      }

      return {
        ...f,
        properties: { ...(f.properties || {}), _smoothed: true, _swept: false },
        geometry: curveGeometry(f.geometry),
      };
    });

    return {
      ...bundle,
      layers: {
        ...bundle.layers,
        cone: { ...slot, fc: { type: 'FeatureCollection', features: rebuilt } },
      },
    };
  } catch (err) {
    console.warn(`[cone] ${label}: leaving the cone as published —`, err);
    return bundle;
  }
}
