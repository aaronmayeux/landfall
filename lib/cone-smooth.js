/**
 * cone-smooth.js — the cone of uncertainty, curved instead of faceted.
 *
 * THE PROBLEM, OFF GLASS (Aaron, 2026-08-08, CHAN-HOM crossing Japan): the
 * forecast track and the past track are splined (lib/trackline.js) and read as
 * one continuous curve. The cone drawn around them was not, so the veil showed
 * hard corners and long straight flanks against a curved track running down
 * its middle. Two descriptions of the same forecast, disagreeing about whether
 * a storm travels in facets.
 *
 * WHERE THE FACETS CAME FROM — measured, not assumed. GDACS publishes the cone
 * at 211 vertices with a worst turn of 9.4°; data/gdacs-geometry.js thins it
 * through Douglas-Peucker for the vertex budget and hands on 53 vertices with
 * a worst turn of 18.6°, the nose cap reduced to four straight chords. So the
 * corners are ours, not the source's, and the fix is not "stop simplifying" —
 * that trades the corners back for vertices on every ambient cone. It is to
 * put the ARC back between the vertices DP kept, all of which are genuine
 * published points.
 *
 * THE SAME CURVE THE TRACKS GET, and that is the whole design (§12): both go
 * through lib/catmullrom.js at TRACK_LINE's own settings, so a cone and the
 * track inside it round identically. A second, differently-tuned smoother
 * would have re-created the mismatch in a subtler form.
 *
 * NOTHING PUBLISHED MOVES. Centripetal Catmull-Rom passes exactly through
 * every input vertex; only the space between them changes. The measured
 * excursion on the shipped cone is 0.034° outside the published outline and
 * 0.027° inside it — about 3 km against a cone hundreds of km across — and the
 * area goes UP 0.18%, which is the only direction a hazard shape is allowed to
 * be wrong in.
 *
 * FAILURE IS PASS-THROUGH, exactly as lib/trackline.js is. This is cosmetic
 * geometry over a §5 safety layer: a faceted cone is a worse picture, a
 * missing cone is a bug. Anything unexpected returns the bundle untouched with
 * one console warning.
 *
 * A SHALLOW COPY, NEVER A MUTATION — same rule as smoothTracks and
 * withoutFuture, and for the same reason: the bundle is a cached object shared
 * with the ambient collections.
 *
 * Pure functions. Imports: config and lib only. No DOM, ever.
 */

import { CONE_CURVE, SIMPLIFY, TRACK_LINE } from '../config/constants.js';
import { splineClosedRing } from './ringpolish.js';
import { simplifyRing } from './simplify.js';

/** The curve settings, assembled once. TRACK_LINE owns the SHAPE of the curve
 *  (see the note on TRACK_LINE.alpha); CONE_CURVE owns only the budget. */
const OPTS = Object.freeze({
  spacingDeg: CONE_CURVE.spacingDeg,
  minPerLeg: CONE_CURVE.minPerLeg,
  maxPerLeg: CONE_CURVE.maxPerLeg,
  maxVertices: CONE_CURVE.maxVertices,
  alpha: TRACK_LINE.alpha,
  minKnotGap: TRACK_LINE.minKnotGap,
  minCosLat: TRACK_LINE.minCosLat,
});

/**
 * One ring: reduce to KNOTS, then put the arc back between them.
 *
 * ==> WHY IT SIMPLIFIES FIRST, WHICH LOOKS BACKWARDS. <== A spline needs
 * knots, not vertices. Handed a densely published ring it would faithfully
 * reproduce every published micro-facet and double the vertex count doing it —
 * measured on the raw GDACS cone: 212 in, 455 out, for a shape nobody can tell
 * from the input. Thinning to knots first makes the OUTPUT density a property
 * of this module rather than of whichever source published the cone, which is
 * what stops an NHC cone and a GDACS cone from being smooth in different ways.
 *
 * ==> IT IS THE SAME TOLERANCE data/gdacs-geometry.js ALREADY APPLIED. <== So
 * for GDACS this pass is idempotent — it re-runs on an already-thinned ring
 * and changes nothing — and the whole effect is the spline. For a source that
 * publishes dense rings it is the step that makes the budget hold. One number,
 * one behaviour, no per-source branch.
 *
 * KNOTS ARE PUBLISHED VERTICES. Douglas-Peucker only ever DROPS points; every
 * one it keeps is a real coordinate the source sent, and the curve passes
 * exactly through all of them.
 */
const curveRing = (ring) =>
  splineClosedRing(simplifyRing(ring, SIMPLIFY.gdacsToleranceDeg), OPTS);

/**
 * Curve every ring of one geometry.
 *
 * HOLES ARE CURVED TOO, not just the outer ring. No cone published to date has
 * one, but a Polygon's second ring is a hole and skipping it would leave a
 * faceted island inside a smooth veil the first time a source published one.
 * Anything that is not a Polygon or MultiPolygon comes back untouched — a
 * LineString cone would be a data bug, and quietly reshaping it would hide it.
 */
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

/**
 * A bundle whose cone slot is curved.
 *
 * `_smoothed: true` is stamped on each feature, matching what lib/trackline.js
 * stamps on its lines — nothing downstream reads it today, but a geometry that
 * has been reshaped should say so in the one place a future reader will look.
 *
 * @param {object} bundle
 * @param {string} [label] storm name, for the warning only
 */
export function smoothCone(bundle, label = 'storm') {
  const slot = bundle?.layers?.cone;
  if (slot?.status !== 'ok') return bundle;
  const features = slot.fc?.features;
  if (!Array.isArray(features) || !features.length) return bundle;

  try {
    const curved = features.map((f) => ({
      ...f,
      properties: { ...(f.properties || {}), _smoothed: true },
      geometry: curveGeometry(f.geometry),
    }));

    return {
      ...bundle,
      layers: {
        ...bundle.layers,
        cone: { ...slot, fc: { type: 'FeatureCollection', features: curved } },
      },
    };
  } catch (err) {
    console.warn(`[cone-smooth] ${label}: leaving the cone as published —`, err);
    return bundle;
  }
}
