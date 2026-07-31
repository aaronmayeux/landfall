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
 * ==> ONE SET NEVER GETS GEOMETRY, AND IT USED TO BE TWO. <== §42.1.4 excluded
 * submarine volcanoes on the grounds that a cone poking out of the Pacific for
 * a seamount 1,800 m down is simply false. That was true, and the conclusion
 * drawn from it — that a seamount can never be a mountain — was only true while
 * there was no way to draw the sea. There is now: the seamount is built exactly
 * like a land volcano, its summit is placed at its own negative elevation so it
 * cannot break the surface, and a translucent water plane is drawn over the top
 * (§42.1.4c). Aaron's call 2026-07-30.
 *
 * What is left is the half that does not change: a single edifice for "West
 * Eifel Volcanic Field" — scattered vents over tens of kilometres — is a
 * fabrication no amount of rendering fixes. Fields keep the circle, at full
 * strength, all the way in, which is what stops them vanishing when the circle
 * fades out under the mountains (SPEC.md §5).
 *
 * @param {object} mark one entry of `loadVolcanoField().marks`
 * @returns {boolean}
 */
export function isEdifice(mark) {
  if (!mark) return false;
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
  /* ==> A SEAMOUNT'S `elev` IS ITS SUMMIT DEPTH, SO USING IT AS RELIEF WOULD
   * READ AS NEGATIVE AND FLOOR EVERY ONE OF THE 105 AT 250 m. <== Relief under
   * water is modelled from a single flat seafloor at `submarineFloorM`: a
   * summit 600 m down rises 2,400 m, one 2,900 m down barely rises at all. The
   * cap and the floor then apply exactly as they do on land. */
  /* ==> IT READS THE MARK'S OWN `submarine` FLAG AND DOES NOT RE-DECIDE. <==
   * `elev < 0` used to stand in for "under water" here, and it is wrong for a
   * volcano in a continental depression — dry ground that happens to sit below
   * sea level. `lib/volcano-shape.js` `isSubmarine()` answers that once, when
   * the mark is built. Asking again here, from a mark that may not carry every
   * catalog field, is how the two get different answers for the same volcano —
   * which would put it on the map at zero with a 3 km-deep foot underneath. */
  const raw = mark.submarine ? M3.submarineFloorM - Math.abs(elev) : elev;
  return Math.min(Math.max(raw, M3.reliefFloor), cap);
}

/**
 * Where this volcano's FOOT sits relative to sea level, in metres.
 *
 * ==> THE ONE NUMBER THAT STOPS A SEAMOUNT PUNCHING THROUGH THE WATER, AND IT
 * IS THE FOOT RATHER THAN THE SUMMIT ON PURPOSE. <== A mountain is drawn
 * `relief * vertical` tall and `vertical` is 4. Stand a submarine volcano's
 * foot on the map at 0 and exaggerate it and the peak comes four times too far
 * up, straight through the sea. Put the foot HERE — `elev - relief`, which is
 * `-submarineFloorM` for anything not clamped — and the summit lands at exactly
 * `elev * vertical`: still negative, still under water, with depth exaggerated
 * by the same 4 as height. A seamount cannot break the surface by arithmetic
 * rather than by a clamp.
 *
 * Land volcanoes return 0 and stand on the map, which is what they did before
 * this function existed.
 *
 * @param {object} mark
 * @returns {number} metres, 0 on land and negative under water
 */
export function volcanoBaseM(mark) {
  if (!mark || !mark.submarine) return 0;
  const elev = Number(mark.elev);
  if (!isFinite(elev)) return 0;
  return elev - volcanoRelief(mark);
}

/**
 * How big this volcano's footprint is on a 0..1 scale, for sizing a MARK.
 *
 * ==> THIS IS A RANK, NOT A SCALE, AND THE DIFFERENCE IS THE WHOLE HISTORY OF
 * THIS FEATURE. <== Nothing here touches geometry. `inflate` and
 * `fill-extrusion` both died of stretching a real footprint to hit a pixel
 * target; this maps a real footprint onto a legible pixel RANGE, which a symbol
 * has to do because at the space floor one pixel is about 30 km and true scale
 * would draw all 1,024 of them as nothing. What survives is the ordering: a
 * bigger volcano gets a bigger dot at every zoom.
 *
 * Log, because the drawn set spans 1.0 km to 108 km. A linear ramp puts nine
 * tenths of it inside the bottom fifth of the range.
 *
 * @param {object} mark
 * @returns {number} 0..1
 */
export function markSizeRank(mark) {
  const [lo, hi] = VOLCANO.marks.sizeSpanM;
  const w = volcanoBaseRadius(mark) * 2;
  if (!(w > lo)) return 0;
  if (w >= hi) return 1;
  return Math.log(w / lo) / Math.log(hi / lo);
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
