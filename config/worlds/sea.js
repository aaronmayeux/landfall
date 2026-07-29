/**
 * sea.js — THE SEA WORLD'S BASEMAP IDENTITY, WHICH IS THE APP'S OWN.
 *
 * Sea is Landfall as it ships today: the night-sky blue basemap out of
 * `config/tokens.js`, the node cage, the three reference latitudes. So this
 * file overrides nothing, and that is the entire point of it existing.
 *
 * ==> A FILE THAT SAYS "THE DEFAULT" LOOKS LIKE NOISE. IT IS NOT. <==
 *
 * Without it, `config/worlds/` holds exactly one entry and Air reads as a
 * special case bolted onto a shared basemap. With it, there are two worlds and
 * one of them happens to want the app's palette — which is a fact about Sea,
 * deliberately chosen, not an absence of a decision. The asymmetry is what
 * rots: the day a third world lands, "worlds have palettes except the one that
 * doesn't" is the shape that produces a branch in `switchTo()`.
 *
 * It also fixes the direction nobody thinks about. Switching Air → Sea has to
 * put the blue basemap BACK, and that only reads as ordinary if Sea is a world
 * asking for its own palette rather than a special case asking for nothing.
 *
 * SPEC-GLOBES.md §38.1. Imports nothing.
 */

export const SEA_WORLD = Object.freeze({
  id: 'sea',
  name: 'Sea',

  /**
   * NO OVERRIDES — `buildStyle()` falls through to the live theme palette,
   * which is what makes Sea the only world that follows light and dark mode.
   * That is correct: Sea IS the app, and the app has a light theme.
   *
   * `null` rather than an empty object, deliberately: `{}` reads as "a palette
   * that has not been filled in yet", and `null` reads as "asked for and
   * declined". `tools/token-check.mjs` skips null and audits every object.
   */
  map: null,

  /**
   * NO PLATE BOUNDARIES.
   *
   * They are a Land-world feature that Air currently borrows (SPEC-GLOBES.md
   * §43.2, and NOW.md on who owns the dot matrix). Sea is cyclones and floods:
   * a tectonic seam has nothing to say about either, and a second glowing line
   * network crossing the coastline would be competing with the thing this
   * globe exists to show.
   */
  plates: null,

  /**
   * The equator and the two tropics. See `map/graticule.js` — they are here
   * because of cyclones, and Sea is the cyclone world, so this is the one
   * globe where they carry their weight.
   *
   * Still subject to the USER's toggle in settings; this is the world saying
   * the layer exists, not that it is forced on.
   */
  graticule: true,
});
