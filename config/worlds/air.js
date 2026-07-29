/**
 * air.js — THE AIR WORLD'S BASEMAP IDENTITY.
 *
 * SPEC-GLOBES.md §38.1: a world owns its palette and its layer manifest. This
 * is the first real instance of that, and it exists because of a specific
 * failure you could see on glass — the Air globe is ultraviolet, and diving
 * into it landed you on a basemap in the app's ordinary blue. One planet,
 * two colour schemes, and the handoff changed the subject halfway down.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS NOT: A SECOND PLACE TO PUT COLOURS.
 *
 * `config/tokens.js` still owns the app's palette and nothing here overrules
 * it for the shipped app. `buildStyle()` layers this on top of the live theme
 * palette, so anything absent below simply keeps the app's value. That is
 * deliberate: a world states what it CHANGES, never a whole copy of the
 * palette that then drifts.
 *
 * ---------------------------------------------------------------------------
 * HOW THESE FOURTEEN VALUES WERE DERIVED. NONE OF THEM IS A FRESH OPINION.
 *
 * `proto/world-air.js` AIR.colors builds the globe's own colours out of one
 * pair — cold 0x3311AA, warm 0xC64BE8 — and the basemap is built the same way,
 * from the same pair, so the planet reads as one object lit one way.
 *
 * The app's blue basemap is ALREADY a single coherent family, and measuring it
 * is what made this cheap. Its hues run 189° at the bright coast glow up to
 * 226° at the darkest sky: BRIGHTER MEANS WARMER. The ultraviolet pair has the
 * same structure at almost exactly the same width — cold 253°, warm 287° — just
 * pointing the other way. So each colour keeps its saturation and its place on
 * the bright/dark ladder, and only its hue moves:
 *
 *     t   = (226 − hue_blue) / (226 − 189)     // 1 = the warm accent, 0 = the coldest dark
 *     hue = 253 + t × (287 − 253)
 *
 * ==> AND THEN LIGHTNESS IS CORRECTED, WHICH IS THE STEP YOU CANNOT SKIP. <==
 *
 * HSL lightness is not luminance. Green carries 71% of perceived brightness and
 * moving 210° → 265° throws that away, so a straight hue rotation comes out
 * measurably dimmer than what it replaced — country labels dropped from 4.00:1
 * to 3.71:1, and the coast glow lost HALF its contrast against the ocean, 10.76
 * to 5.39. So every value below then had its lightness solved back until its
 * true WCAG luminance matched the blue it replaced. Every contrast relationship
 * in the basemap survives to within 0.02:1. The palette is tuned; the tuning is
 * inherited rather than redone.
 *
 * THE COAST GLOW PAIR IS THE ONE EXCEPTION, AND IT IS HAND-PLACED.
 * Cyan is unusually luminous. Matching #4FD1E8's luminance in violet lands on
 * #E5ADF4 — a pale lilac that has lost the pair it is supposed to belong to.
 * The coastline is the brightest structure on this map and it should read as
 * the same light as the globe's warm rim, so these two trade a little contrast
 * for their identity: 8.46:1 against the blue's 10.76:1, and 3.01:1 against
 * 3.20:1. That is a look call, made on glass. If it reads weak on a phone, walk
 * the lightness up — the value is the only thing to move, never the hue.
 *
 * ---------------------------------------------------------------------------
 * THE RIM SWITCHER IN `proto-worlds.html` DOES NOT MOVE THIS, ON PURPOSE.
 *
 * Five rims × a full `map.setStyle()` each is the slow operation §38.3 puts
 * LAST in a world switch precisely because it is the one the user waits on, and
 * a dropdown is not worth it. The deeper reason is that a world owns ONE
 * palette: a rim is a tuning control on a look NOW.md calls settled, and if
 * Aurora is ever promoted it becomes its own world file, not a branch in this
 * one. The prototype says so under the selector rather than silently ignoring
 * the change (SPEC.md §5).
 *
 * Imports `config/tokens.js` only — config/ imports config/ (§12). It is the
 * plate pair that needs it, and needing it is the point: see `plates` below.
 */

import { DARK } from '../tokens.js';

/**
 * The FOURTEEN keys `map/style.js` actually reads. Not thirteen, not fifteen —
 * `tools/token-check.mjs` asserts this list against the real call sites, so a
 * layer added to the style with no colour here fails the check instead of
 * quietly painting one thing blue on a violet planet.
 *
 * `graticuleMajor` is deliberately absent: Air draws no reference lines at all
 * (see `graticule` below), so a colour for them would be a value nothing reads.
 */
const MAP = Object.freeze({
  /* --- the globe body ---------------------------------------------------- */
  /** Deep violet-black. The cold end taken almost to nothing, so the unlit
   *  ocean is still violet rather than a neutral charcoal — the same move
   *  AIR.colors makes for the glass orb. */
  ocean: '#10091E',
  /** Filled land, solid enough to sit marks on. */
  land: '#28183F',
  /** Subtle relief at close zoom. */
  landHigh: '#352052',
  /** Continents at the planet band: barely above ocean, so the globe above is
   *  the hero and land resolves to `land` as you descend. */
  landFaint: '#180F28',

  /* --- sky and limb ------------------------------------------------------- */
  skyHigh: '#090515',
  skyLow: '#2C0F4E',
  /** Rim light at the horizon. This is the basemap's answer to the orb's own
   *  lit edge, and it sits between the pair. */
  atmosphere: '#B579D6',

  /* --- the coastline stack (hand-placed, see the header) ------------------ */
  /** The bright top line: the warm end of the pair, lifted for punch. */
  coastGlow: '#DB8EF0',
  /** The wide dim blurred underlay beneath it. */
  coastGlowSoft: '#922CB5',

  /* --- reference furniture ------------------------------------------------ */
  /** National borders — quiet on purpose (§11: a border is reference). */
  adminCountry: '#634783',
  /** State / province divides — one step quieter still. */
  adminState: '#4B3369',

  /* --- the map's own labels ----------------------------------------------- */
  textCountry: '#8876A0',
  textState: '#745F8E',
  textPlace: '#9986AE',
});

export const AIR_WORLD = Object.freeze({
  id: 'air',
  name: 'Air',

  /** Basemap palette overrides, layered over the live theme palette. */
  map: MAP,

  /**
   * PLATE BOUNDARIES, AND THEY ARE DELIBERATELY OUT OF FAMILY.
   *
   * Everything else on this globe derives from the ultraviolet pair so the
   * planet reads as one object lit one way. These do not, and the exception is
   * the point: a plate boundary is a different KIND of thing from a coastline,
   * and on the map they run through the same space. Painted in the same family
   * they were indistinguishable — one violet line network crossing another.
   *
   * ==> THE PAIR IS REFERENCED, NOT COPIED. <== Aaron asked for "the blue from
   * our glow colours", so this IS that colour rather than a hex that matches it
   * today. Retune the app's coastline cyan and the plate seams follow; a
   * pasted `#4FD1E8` would silently stop being the same blue.
   *
   * `core` is the bright top line and `glow` the wide dim underlay, matching
   * the coastline stack in `map/style.js`. The Three seams take the same two as
   * a cold/warm pair, so the material still sweeps with the light like every
   * other surface on this globe — same lighting, different metal — and the
   * lines do not change colour partway through the dive.
   *
   * COLOUR IS NOT THE ONLY SIGNAL, and it must not become one. Cyan sits 98°
   * from this world's orchid coastline but within 1.27:1 of it in luminance,
   * so `SIZE.plateWidthScale` and `OPACITY.plate*` carry the rest. See the note
   * on `plateWidthScale`.
   *
   * `null` on a world means it draws no plate boundaries at all.
   */
  plates: Object.freeze({
    glow: DARK.coastGlowSoft,
    core: DARK.coastGlow,
  }),

  /**
   * NO REFERENCE LINES.
   *
   * `map/graticule.js` draws exactly three: the equator and the two tropics,
   * and its header is explicit that they earn their place BECAUSE OF CYCLONES
   * — a storm cannot cross the equator, and the tropics bracket the warm water
   * they are born in. Air is volcanoes and wildfire. Neither line means
   * anything here, and an unmeaning line is decoration.
   *
   * Enforced with the existing `setGraticuleVisible()`, which `main.js`
   * already uses for the user's own toggle — no new machinery, and re-applied
   * on every `style.load` because a style rebuild puts the layers back.
   */
  graticule: false,
});
