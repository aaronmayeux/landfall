/**
 * volcano-extrusion.js — the SAME volcanoes as the 3D globe, as GeoJSON rings
 * MapLibre can extrude.
 *
 * ==> WHY THE MAP NEEDS ITS OWN COPY AT ALL. <== `proto/shell.js` clears the
 * Three canvas and returns at dive phase 1, so there is no 3D scene below
 * `DIVE.zHandoff` — and the volcano layer fades out earlier still, with the
 * dots. Volcanoes that disappear exactly as you get close enough to see them
 * is backwards, so MapLibre draws them for every zoom the globe cannot reach.
 *
 * ==> ONE SHAPE, TWO RENDERERS. <== The silhouette maths is
 * `volcanoProfile()` in `lib/volcano-shape.js` and this file calls it rather
 * than restating it; the family ratios come from `VOLCANO.shapes.families`
 * rather than a map-specific copy. That is the trap `map/plate-seams.js`
 * exists to close — two independent constructions of one shape look right
 * until they quietly disagree, and nothing tells you when.
 *
 * No MapLibre, no THREE, no DOM. This turns marks into GeoJSON and stops.
 */

import { VOLCANO } from '../config/constants.js';
import { FAMILY, volcanoProfile } from './volcano-shape.js';

const SH = VOLCANO.shapes;
const EX = VOLCANO.extrusion;

/** Mean Earth radius. Only used to turn kilometres into degrees. */
const EARTH_KM = 6371;

/**
 * A ring of lon/lat points around a centre.
 *
 * ==> LONGITUDE DEGREES SHRINK WITH LATITUDE AND FORGETTING THAT IS HOW A
 * VOLCANO IN KAMCHATKA ENDS UP AN OVAL. <== At 55°N a degree of longitude is
 * 57% of a degree of latitude, so a circle drawn in raw degrees is squashed by
 * nearly half exactly where this catalog is densest.
 *
 * @param {number} lon centre longitude
 * @param {number} lat centre latitude
 * @param {number} radiusKm radius along the short axis
 * @param {number} elongate long-axis multiplier (east-west)
 * @param {number} narrow short-axis multiplier (north-south)
 * @param {boolean} reverse wind clockwise instead — GeoJSON holes are wound
 *   opposite to the ring that contains them
 */
function ring(lon, lat, radiusKm, elongate, narrow, reverse) {
  const n = EX.ringVertices;
  const degLat = (radiusKm / EARTH_KM) * (180 / Math.PI);
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  const degLon = degLat / cosLat;

  const pts = [];
  for (let i = 0; i <= n; i++) {
    const step = reverse ? n - i : i;
    const a = (step / n) * Math.PI * 2;
    /* ==> ROUNDED TO FIVE PLACES, WHICH IS ABOUT A METRE. <== These rings are
     * tens of kilometres across, so full double precision is spending memory
     * on a thousandth of a pixel at any zoom a phone reaches. */
    pts.push([
      round5(lon + Math.cos(a) * degLon * elongate),
      round5(lat + Math.sin(a) * degLat * narrow),
    ]);
  }
  /* Close it exactly rather than nearly — a polygon whose last point is a
   * rounding error away from its first is a polygon some renderers drop. */
  pts[pts.length - 1] = [pts[0][0], pts[0][1]];
  return pts;
}

/**
 * How wide this volcano's base is on the ground, before the family ratio.
 *
 * Reuses the 3D layer's own exaggeration curve so a volcano that is tall on
 * the globe is wide on the map — one number, one story. §42.1.3.
 */
function baseRadiusKm(elev) {
  const span = SH.elevPeakM - SH.elevFloorM;
  const t = clamp01((Number(elev) - SH.elevFloorM) / (span || 1));
  const lift = SH.minLift + (1 - SH.minLift) * Math.pow(t, SH.curve);
  return EX.minRadiusKm + (EX.maxRadiusKm - EX.minRadiusKm) * lift;
}

/**
 * Turn one mark into a stack of extrusion rings.
 *
 * Each ring is an annulus — an outer boundary with the next ring punched out
 * of it — extruded from the ground to its own height. Stacked, they read as a
 * stepped cone. The innermost is a solid disc so the summit is capped, EXCEPT
 * on a caldera, where the missing middle is the whole point of the family.
 *
 * @returns {object[]} GeoJSON Features, outermost first
 */
function ringsFor(mark) {
  const spec = SH.families[mark.family];
  if (!spec) return [];

  const rBase = baseRadiusKm(mark.elev) * spec.ratio;
  /* Height in metres, floored so a 300 m volcano is not a painted disc. The
   * VERTICAL EXAGGERATION IS NOT APPLIED HERE — it is a zoom expression on the
   * layer, so it can be retuned without regenerating a polygon. */
  const summitM = Math.max(Math.abs(Number(mark.elev)) || 0, EX.minVisibleM);

  /* Sample the shared profile at ring boundaries. `v` runs 0 at the base to 1
   * at the summit; for a caldera the samples stop at the rim, because past it
   * the profile is descending into a crater that an extrusion cannot express —
   * an empty middle is the honest version of that. */
  const top = spec.rim >= 1 ? 1 : spec.rim;
  const n = EX.rings;

  const out = [];
  for (let i = 0; i < n; i++) {
    const vOuter = (i / n) * top;
    const vInner = ((i + 1) / n) * top;
    const pOuter = volcanoProfile(vOuter, spec);
    const pInner = volcanoProfile(vInner, spec);

    /* The ring stands at the height of its INNER edge, so the terrace you see
     * is the ground the next ring up sits on. Using the outer edge instead
     * would put the outermost ring at zero height and lose a whole step. */
    const heightM = pInner.h * summitM;

    const outer = ring(mark.lon, mark.lat, pOuter.r * rBase, spec.elongate, spec.narrow, false);
    const rings = [outer];

    const isLast = i === n - 1;
    /* A caldera's last ring keeps its hole — that hole IS the crater. Every
     * other family caps the summit with a solid disc. */
    if (!isLast || spec.notch > 0) {
      rings.push(ring(mark.lon, mark.lat, pInner.r * rBase, spec.elongate, spec.narrow, true));
    }

    out.push({
      type: 'Feature',
      properties: {
        n: mark.n,
        name: mark.name,
        /** Metres, before the layer's zoom exaggeration. */
        hM: Math.round(heightM),
        erupting: mark.erupting ? 1 : 0,
        family: mark.family,
      },
      geometry: { type: 'Polygon', coordinates: rings },
    });
  }
  return out;
}

/**
 * Every drawable volcano as extrusion rings.
 *
 * ==> THE TWO SETS THAT ARE NOT MOUNTAINS GET NOTHING HERE, THE SAME AS ON THE
 * GLOBE (§42.1.4). <== A submarine volcano extruded above sea level is a lie
 * that gets worse the closer you look, and a single cone for a volcanic field
 * is a fabrication. Both keep the circle marker, which is true at every zoom.
 *
 * @param {object[]} marks `loadVolcanoField()`'s `marks`
 * @returns {object} a GeoJSON FeatureCollection
 */
export function buildVolcanoExtrusions(marks) {
  const features = [];
  for (const m of marks || []) {
    if (m.submarine) continue;
    if (m.family === FAMILY.field) continue;
    for (const f of ringsFor(m)) features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Every volcano as a point, for the flat circle layer.
 *
 * This one takes ALL of them — including the submarine and the fields, which
 * is the whole reason it exists as well as the extrusions rather than instead
 * of them.
 */
export function buildVolcanoPoints(marks) {
  return {
    type: 'FeatureCollection',
    features: (marks || []).map((m) => ({
      type: 'Feature',
      properties: {
        n: m.n,
        name: m.name,
        sev: m.sev,
        erupting: m.erupting ? 1 : 0,
        submarine: m.submarine ? 1 : 0,
        family: m.family,
      },
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    })),
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}
