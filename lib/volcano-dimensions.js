/**
 * volcano-dimensions.js — HOW BIG A VOLCANO ACTUALLY IS, IN METRES.
 *
 * Same split as `lib/volcano-shape.js` and `lib/volcano-severity.js`, for the
 * same reason: "how wide is Etna" is a data question, not a drawing question,
 * so it lives here where it can be tested without a GPU. The renderer
 * (`proto/volcano-3d.js`) asks this file for metres and never does arithmetic
 * on `elev` itself.
 *
 * No THREE, no DOM, no pixels, no zoom. Everything below is real-world metres.
 *
 * ==> THE CATALOG HAS NO FOOTPRINT DATA AT ALL, AND THIS FILE IS THE
 * WORKAROUND STATED OUT LOUD. <== Measured against the shipped 1,196-feature
 * file: every volcano carries `elev`, `type`, `landform`, a country and an
 * eruption count. There is no basal diameter, no prominence, no radius. So a
 * footprint here is DERIVED from height and family, using real-world
 * proportions in `VOLCANO.map3d.families`, and it is an approximation of the
 * right order rather than a measurement of that mountain.
 *
 * ==> AND `elev` IS ABOVE SEA, NOT ABOVE THE VOLCANO'S OWN BASE. <== §42.1.2.
 * Ojos del Salado reads 6,879 m because it stands on a 4,000 m plateau; its
 * own relief is nearer 2,000. Uncapped, that one field turns a normal cone
 * into a 7 km spire and turns the Andes into a bed of nails. `reliefCap` per
 * family is the guard, and it is the single biggest inaccuracy in this file.
 * The honest fix is a DEM lookup for base elevation, which this layer does not
 * do and which SPEC-GLOBES §42.1.4b records as the known gap.
 */

import { VOLCANO } from '../config/constants.js';
import { FAMILY, EDIFICE_FAMILIES } from './volcano-shape.js';

const M3 = VOLCANO.map3d;

/** Families that get real geometry here. Same list the globe uses, so a
 *  volcano cannot be a mountain in one renderer and a mark in the other. */
const EDIFICE = new Set(EDIFICE_FAMILIES);

/**
 * Does this volcano get a mountain at map zoom, or does it keep its flat mark
 * forever?
 *
 * ==> TWO SETS NEVER GET GEOMETRY AND THIS IS §42.1.4, NOT AN OPTIMISATION.
 * <== A cone poking out of the Pacific for a seamount 1,800 m down is simply
 * false, and a single edifice for "West Eifel Volcanic Field" — scattered
 * vents over tens of kilometres — is a fabrication. Both keep the circle, at
 * full strength, all the way in. That is also what stops them vanishing when
 * the circle fades out under the mountains (SPEC.md §5).
 *
 * @param {object} mark one entry of `loadVolcanoField().marks`
 * @returns {boolean}
 */
export function isEdifice(mark) {
  if (!mark) return false;
  if (mark.submarine) return false;
  if (mark.family === FAMILY.field) return false;
  return EDIFICE.has(mark.family);
}

/**
 * The modelled relief of a volcano in metres — how far it stands above its own
 * base, as best this data can say.
 *
 * Clamped at both ends. The floor keeps a 90 m tuff cone from being zero-height
 * geometry (degenerate triangles, not a look call); the cap is the plateau
 * problem above.
 *
 * @param {object} mark
 * @returns {number} metres, always > 0
 */
export function volcanoRelief(mark) {
  const spec = M3.families[mark && mark.family];
  const cap = spec ? spec.reliefCap : M3.families.cone.reliefCap;
  const elev = Number(mark && mark.elev);
  if (!isFinite(elev)) return M3.reliefFloor;
  return Math.min(Math.max(elev, M3.reliefFloor), cap);
}

/**
 * The modelled base RADIUS of a volcano in metres.
 *
 * Relief times the family's real-world ratio. A stratovolcano is about 4.5
 * times wider at the base than it is tall, so a 3 km cone gets a 13.5 km
 * radius — 27 km across, which is Fuji.
 *
 * @param {object} mark
 * @returns {number} metres
 */
export function volcanoBaseRadius(mark) {
  const spec = M3.families[mark && mark.family] || M3.families.cone;
  return volcanoRelief(mark) * spec.ratio;
}

/**
 * Both numbers at once, which is what the renderer actually wants.
 *
 * @param {object} mark
 * @returns {{relief: number, radius: number}} metres
 */
export function volcanoDimensions(mark) {
  return { relief: volcanoRelief(mark), radius: volcanoBaseRadius(mark) };
}

/**
 * The uniform scale multiplier at a given zoom.
 *
 * ==> THIS IS THE ONE THING THAT MAY NOT TOUCH THE SHAPE. <== It scales both
 * axes together, so an inflated volcano is the same volcano seen closer, never
 * a different volcano. The moment width and height get separate zoom curves,
 * the footprint stops being true and every argument in §42.1.4b for why this
 * technique works stops holding.
 *
 * Decays to exactly 1.0 — true scale — at the far end of the band and stays
 * there. Zooming in past that point makes a volcano bigger only because you
 * are closer to it, which is what a map is.
 *
 * @param {number} zoom  map.getZoom()
 * @returns {number} >= 1
 */
export function inflationAt(zoom) {
  const [z0, z1] = M3.inflateBand;
  if (!(zoom > z0)) return M3.inflate;
  if (zoom >= z1) return 1;
  const t = (zoom - z0) / (z1 - z0);
  /* Smoothstep rather than linear so the decay has no visible corner at either
   * end — the same easing every other band in this project uses. */
  const s = t * t * (3 - 2 * t);
  return M3.inflate + (1 - M3.inflate) * s;
}

/**
 * How big one volcano is IN MAPLIBRE'S OWN UNITS — the numbers the renderer
 * scales its unit mountain by.
 *
 * ==> ALL THREE AXES ARE FRACTIONS OF THE WHOLE WORLD. HEIGHT IS NOT IN
 * METRES, AND THIS FUNCTION EXISTS BECAUSE BELIEVING IT WAS COST FOUR DEPLOYS.
 * <== The matrix MapLibre hands a custom layer multiplies out to
 * `scale(worldSize, worldSize, worldSize)` — its own mercator matrix — so Z
 * gets exactly the treatment X and Y get. Passing raw metres put a 3.5 km cone
 * at 43,750, i.e. forty-three thousand times the width of the planet, and every
 * mountain became a needle stretching past the far clip plane.
 *
 * ==> AND THIS IS WHY THE MATHS LIVES HERE RATHER THAN IN THE RENDERER. <==
 * Inside `proto/volcano-3d.js` it needed MapLibre and THREE to reach, so
 * nothing could check it without a browser and the sandbox has none. Out here
 * it is four multiplications against a plain number and
 * `tools/test-volcano-map3d.mjs` asserts it against the real catalog. The one
 * property that would have caught the bug on the first deploy is that
 * `tall / wide` is a fixed proportion — it must never depend on latitude.
 *
 * `unitsPerMetre` is MapLibre's `meterInMercatorCoordinateUnits()`, which
 * depends on latitude, so the caller reads it per volcano. One factor, three
 * axes: that is `inflate`'s uniform-scale rule holding.
 *
 * @param {object} mark
 * @param {number} zoom          map.getZoom()
 * @param {number} unitsPerMetre one metre, expressed in mercator units
 * @returns {{wide: number, tall: number}} mercator units
 */
export function edificeScale(mark, zoom, unitsPerMetre) {
  const inflate = inflationAt(zoom);
  const { relief, radius } = volcanoDimensions(mark);
  return {
    wide: radius * inflate * unitsPerMetre,
    tall: relief * inflate * M3.vertical * unitsPerMetre,
  };
}

/**
 * How strongly the mountains are drawn at a given zoom, 0..1.
 *
 * The twin of `proto/volcano-map.js`'s circle fade-out, and they are read off
 * the SAME constant so they cannot drift apart and leave a zoom band with
 * neither a dot nor a mountain in it.
 *
 * @param {number} zoom
 * @returns {number} 0..1
 */
export function edificeOpacityAt(zoom) {
  const [z0, z1] = M3.handoff;
  if (zoom <= z0) return 0;
  if (zoom >= z1) return 1;
  const t = (zoom - z0) / (z1 - z0);
  return t * t * (3 - 2 * t);
}
