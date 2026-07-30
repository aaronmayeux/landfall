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
 * ==> THERE IS NO ZOOM-DRIVEN SCALE HERE ANY MORE, AND NOTHING MAY PUT ONE
 * BACK. <==
 *
 * `inflationAt()` and `ridgeScale()` used to live at this spot. `inflate` was
 * a uniform 5x multiplier that made a distant volcano big enough to see at the
 * moment it appeared, decaying to true scale by z9.5. It was deleted
 * 2026-07-30: it made Mauna Loa a grey oval several times the width of the
 * island it IS, and because clustering asks whether TRUE footprints touch
 * while the screen drew them five times wider, it manufactured exactly the
 * cone-inside-cone interpenetration it was blamed on. The handoff moved to
 * z7.0 instead, where a median volcano is 36 px across at true scale.
 *
 * What a renderer needs at draw time is now just MapLibre's own
 * `meterInMercatorCoordinateUnits()` for the cluster's latitude — one number,
 * all three axes, no zoom term. A wrapper returning its own argument would be
 * noise, so there isn't one. `proto/volcano-3d.js` reads it directly and
 * places each ridge ONCE, because nothing about the placement depends on zoom
 * any more.
 *
 * ==> ALL THREE AXES ARE FRACTIONS OF THE WHOLE WORLD. HEIGHT IS NOT IN
 * METRES, AND BELIEVING IT WAS COST FOUR DEPLOYS. <== The matrix MapLibre
 * hands a custom layer multiplies out to `scale(worldSize, worldSize,
 * worldSize)` — its own mercator matrix — so Z gets exactly the treatment X
 * and Y get. Raw metres put a 3.5 km cone at forty-three thousand planet
 * widths tall. Height exaggeration (`vertical`) is baked into the geometry in
 * METRES by `lib/volcano-ridge.js`, so there is no per-axis number left at
 * draw time to get wrong.
 */


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
