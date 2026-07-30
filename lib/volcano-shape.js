/**
 * volcano-shape.js — WHAT SHAPE A VOLCANO IS, from what the catalog says it is.
 *
 * Same split as `lib/volcano-severity.js` and for the same reason: deciding
 * what KIND of thing a volcano is reads catalog fields and returns a string.
 * It is a data question, not a drawing question, so it lives here rather than
 * in `proto/volcano-marks.js` — where it could not be tested without a GPU.
 *
 * No THREE, no DOM, no constants that are about pixels. The numbers that turn
 * a family into geometry live in `VOLCANO.shapes.families`; this file only
 * names the family.
 *
 * ==> THE `type` FIELD IS MESSIER THAN THE SPEC IMPLIES AND THAT IS WHY THIS
 * IS A TABLE RATHER THAN A SWITCH. <== Measured against the shipped
 * 1,196-feature catalog: 28 distinct strings, including plural variants
 * (`Stratovolcano(es)`), a hedge (`Stratovolcano?`), one outright `null`
 * (`Kuril Arc at 46.3°N`), and forms that name a crater rather than a
 * mountain (`Maar`, `Tuff ring(s)`, `Explosion crater(s)`). Anything written
 * from memory of "the type field" gets several of those wrong silently, which
 * is why `tools/test-volcano-shape.mjs` asserts every one of the 1,196 lands
 * somewhere deliberate.
 */

/**
 * The six families of SPEC-GLOBES §42.1.2. Five of them are edifices the
 * instanced mesh draws; `field` is not a mountain and draws flat.
 */
export const FAMILY = Object.freeze({
  /** Steep stratovolcano. The overwhelming majority — 86 of the 128-strong
   *  quiet tier. */
  cone: 'cone',
  /** Lava dome. Squat and round-shouldered. */
  dome: 'dome',
  /** Shield. Broad and low, and always flatter than a cone (§42.1.2's rank
   *  order rule). */
  shield: 'shield',
  /** Notched summit — a caldera, a maar, an explosion crater. The one family
   *  whose silhouette is defined by what is MISSING from the top. */
  caldera: 'caldera',
  /** A line of vents along a rift. Drawn as an elongated ridge, never a cone. */
  fissure: 'fissure',
  /** ==> NOT AN EDIFICE, AND THE MESH NEVER DRAWS ONE. <== §42.1.4: scattered
   *  vents spread over tens of kilometres. A single cone for "West Eifel
   *  Volcanic Field" is a fabrication. These keep the flat mark. */
  field: 'field',
});

/**
 * Families that are a single mountain. Everything else stays flat, and so does
 * anything below sea level regardless of family (§42.1.4 — that test is the
 * CALLER's, because it reads `elev` rather than `type`).
 */
export const EDIFICE_FAMILIES = Object.freeze([
  FAMILY.cone,
  FAMILY.dome,
  FAMILY.shield,
  FAMILY.caldera,
  FAMILY.fissure,
]);

/**
 * Every `type` string in the shipped catalog, mapped deliberately.
 *
 * Keys are lowercased and stripped of the plural suffixes GVP uses
 * inconsistently — `Fissure vent` and `Fissure vent(s)` are one form, and
 * carrying both spellings in the table is how one of them eventually gets
 * missed. `Stratovolcano?` loses its hedge the same way: the uncertainty is
 * real and it is not a different SHAPE.
 */
const BY_TYPE = Object.freeze({
  /* ---- single cones ----------------------------------------------------- */
  stratovolcano: FAMILY.cone,
  cone: FAMILY.cone,
  'lava cone': FAMILY.cone,
  'pyroclastic cone': FAMILY.cone,
  'tuff cone': FAMILY.cone,
  /* COMPLEX AND COMPOUND ARE CONES ON PURPOSE. Both mean several overlapping
   * summits on one edifice — Vesuvius, Kilimanjaro. That is still one mountain
   * from space, and it is emphatically not the scattered-vents case `field`
   * exists for. 12 of the 128 in the quiet tier are `Complex`. */
  complex: FAMILY.cone,
  compound: FAMILY.cone,

  /* ---- domes ------------------------------------------------------------ */
  'lava dome': FAMILY.dome,

  /* ---- shields ---------------------------------------------------------- */
  shield: FAMILY.shield,
  'shield(pyroclastic)': FAMILY.shield,

  /* ---- notched summits --------------------------------------------------
   * A maar and an explosion crater are holes in the ground rather than
   * mountains with holes in them, and at 10 px the honest silhouette for both
   * is the same one a caldera gets: a low rim around a missing middle. */
  caldera: FAMILY.caldera,
  maar: FAMILY.caldera,
  'explosion crater': FAMILY.caldera,
  'tuff ring': FAMILY.caldera,

  /* ---- lines of vents ---------------------------------------------------- */
  'fissure vent': FAMILY.fissure,
  'crater rows': FAMILY.fissure,

  /* ---- not one edifice at all -------------------------------------------- */
  'volcanic field': FAMILY.field,
});

/** The `landform` fallback, for the one catalog entry with no `type` at all. */
const BY_LANDFORM = Object.freeze({
  composite: FAMILY.cone,
  shield: FAMILY.shield,
  caldera: FAMILY.caldera,
  cluster: FAMILY.field,
  minor: FAMILY.cone,
  'minor (basaltic)': FAMILY.cone,
  'minor (silicic)': FAMILY.dome,
});

/** Families that are a single mountain and can therefore be demoted by
 *  `landform: Cluster`. `fissure` and `field` already describe several vents,
 *  so Cluster tells them nothing they do not already say. */
const DEMOTABLE = new Set([FAMILY.cone, FAMILY.dome, FAMILY.shield, FAMILY.caldera]);

/**
 * Strip GVP's plural and hedge suffixes so one form is one key.
 * `Stratovolcano(es)` → `stratovolcano`, `Fissure vent(s)` → `fissure vent`,
 * `Lava cone(es)` → `lava cone`, `Stratovolcano?` → `stratovolcano`.
 *
 * ==> ONLY PARENTHESISED PLURALS ARE STRIPPED, NEVER A BARE TRAILING `s`. <==
 * `Crater rows` is the reason: a general de-pluraliser turns it into
 * `crater row`, which matches nothing, and it would have been the one entry in
 * the table that silently fell through to the fallback. `Shield(pyroclastic)`
 * is untouched for the same class of reason — that parenthesis carries a real
 * distinction rather than a plural, so it stays as its own key.
 */
function normaliseType(raw) {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\?+$/, '')
    .replace(/\((?:e?s)\)$/, '')
    .trim();
}

/**
 * Which of the six families this volcano draws as.
 *
 * ==> NEVER RETURNS `undefined` AND NEVER GUESSES SILENTLY. <== An unknown
 * type falls to the landform, and an unknown landform falls to `cone`, which
 * is what 86 of the 128 drawn volcanoes are. The fallback is stated rather
 * than accidental, and `classifyVolcanoShape.unmatched` lets the test suite
 * assert that the shipped catalog never reaches it.
 *
 * @param {object} props a catalog feature's `properties`
 * @returns {string} one of `FAMILY`
 */
export function volcanoFamily(props) {
  const p = props || {};
  const landform = String(p.landform || '').trim().toLowerCase();

  let family = BY_TYPE[normaliseType(p.type)];
  if (!family) family = BY_LANDFORM[landform];
  if (!family) family = FAMILY.cone;

  /* ==> A CLUSTER OF CONES IS NOT A CONE (§42.1.4). <== 227 catalog entries
   * carry `landform: Cluster` — scattered vents over tens of km. Most already
   * type as a field or a fissure and this changes nothing for them; it catches
   * the ~32 that type as a single mountain and are not one, five
   * `Stratovolcano` entries among them. */
  if (landform === 'cluster' && DEMOTABLE.has(family)) return FAMILY.field;

  return family;
}

/**
 * Did this volcano reach the stated fallback rather than a real match? Used by
 * the test suite so a catalog refetch that introduces a new `type` string
 * fails loudly instead of quietly rendering as a cone.
 *
 * @returns {boolean} true when neither the type nor the landform matched
 */
export function volcanoFamilyIsFallback(props) {
  const p = props || {};
  if (BY_TYPE[normaliseType(p.type)]) return false;
  if (BY_LANDFORM[String(p.landform || '').trim().toLowerCase()]) return false;
  return true;
}

/**
 * ==> THE SILHOUETTE ITSELF, AND THIS IS THE ONLY PLACE THE MATHS LIVES. <==
 * Radius and height of a family's profile at `v`, on a unit template — base
 * radius 1 at `v = 0`, summit height 1 at `v = 1`.
 *
 * TWO RENDERERS SPEND THESE NUMBERS AND THEY MUST NOT DRIFT. The 3D globe bends
 * a lathe with this in a vertex shader (`EDIFICE_VERT` in
 * `proto/volcano-marks.js`, a line-for-line mirror of the body below), and the
 * map builds stacked extrusion rings with it (`lib/volcano-extrusion.js`). That
 * is the same trap `map/plate-seams.js` exists to close: two independent
 * constructions of one shape look right until they quietly disagree, and
 * nothing tells you when.
 *
 * The GLSL copy is unavoidable — a shader cannot import — so it is a copy with
 * a pointer at it rather than a second opinion. Change one, change both.
 *
 * `rim` below 1 is what makes a caldera: past it the profile turns inward and
 * DOWN into the crater instead of continuing up. Every other family sets
 * `rim = 1`, so the crater term multiplies out.
 *
 * @param {number} v 0 at the base, 1 at the summit
 * @param {object} spec one entry of `VOLCANO.shapes.families`
 * @returns {{r: number, h: number}} radius and height on the unit template
 */
export function volcanoProfile(v, spec) {
  const rim = spec.rim;
  const topR = spec.topR;

  /* Up the flank. Clamped at the rim so the crater term takes over cleanly
   * rather than the flank continuing to climb underneath it.
   *
   * The 1e-5 floors are not cosmetic: pow(0, x) is UNDEFINED in GLSL and
   * returns NaN on some drivers, and both ends of this profile hit zero. They
   * are carried here so the two implementations stay identical rather than
   * "the same apart from a guard". */
  const t = Math.min(v / Math.max(rim, 1e-4), 1);
  let r = Math.pow(Math.max(1 - t, 1e-5), spec.flankPow) * (1 - topR) + topR;
  let h = Math.pow(Math.max(t, 1e-5), spec.heightPow);

  const c = rim >= 1 ? 0 : clamp01((v - rim) / Math.max(1 - rim, 1e-4));
  r = r * (1 - c);
  h -= spec.notch * c;

  return { r, h };
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
