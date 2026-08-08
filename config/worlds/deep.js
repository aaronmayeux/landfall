/**
 * deep.js — THE DEEP WORLD'S BASEMAP IDENTITY.
 *
 * SPEC-GLOBES.md §38.1: a world owns its palette and its layer manifest. This
 * is the first real instance of that, and it exists because of a specific
 * failure you could see on glass — the Deep globe is ultraviolet, and diving
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
 * `proto/world-deep.js` DEEP.colors builds the globe's own colours out of one
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
 * IMPORTS NOTHING. It used to pull `config/tokens.js` for the plate pair, which
 * was the whole point of the import; that pair is magma now and owned here, so
 * the import went with it rather than lingering unused.
 */

/**
 * The FOURTEEN keys `map/style.js` actually reads. Not thirteen, not fifteen —
 * `tools/token-check.mjs` asserts this list against the real call sites, so a
 * layer added to the style with no colour here fails the check instead of
 * quietly painting one thing blue on a violet planet.
 *
 * `graticuleMajor` is deliberately absent: Deep draws no reference lines at all
 * (see `graticule` below), so a colour for them would be a value nothing reads.
 */
const MAP = Object.freeze({
  /* --- the globe body ---------------------------------------------------- */
  /** Deep violet-black. The cold end taken almost to nothing, so the unlit
   *  ocean is still violet rather than a neutral charcoal — the same move
   *  DEEP.colors makes for the glass orb. */
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
  /* No `textState`. Deep switches state names off entirely (`stateNames: false`
   * below), and the token itself was retired app-wide when state names took the
   * city ink — see map/style.js. */
  textPlace: '#9986AE',
});

export const DEEP_WORLD = Object.freeze({
  id: 'deep',
  name: 'Deep',

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
   * ==> MAGMA, AND THE PAIR IS NOW A LITERAL RATHER THAN A REFERENCE. <== These
   * used to be `DARK.coastGlowSoft` / `DARK.coastGlow` — the app's own glow
   * cyan, referenced so retuning the coastline would carry the seams with it.
   * Aaron asked for lava on 2026-07-29 and there is no cool-family token that
   * means it, so the link is CUT DELIBERATELY: these are this world's own
   * colours now, and nothing upstream moves them.
   *
   * ==> AND THIS IS THE ONE THING ON THIS GLOBE THAT COLLIDES WITH A FIXED
   * HAZARD RAMP. <== SPEC.md §6 fixes severity colour so a Cat 3 reads the same
   * everywhere, and this world's OWN hazard is earthquakes, whose two published
   * ramps are exactly here: USGS MMI runs `#ffaa00` → `#ff9100` → `#ff4700` →
   * `#fd0000` (SPEC-HAZARDS.md §20.3.1), and PAGER alert has a literal "orange"
   * level. A hot seam and a severe quake must never be the same orange.
   *
   * The pair below is chosen to sit BELOW that ramp rather than beside it: a
   * dark ember underlay and a top line held under MMI's first orange in both
   * lightness and saturation, so a seam reads as cooling rock and an alert
   * reads as light. **The real answer is not a hex — it is that quake severity
   * on this globe must not be carried by hue at all.** §20.6 already says
   * magnitude drives size; ripple strength is the second channel and it is free.
   * If a quake mark ever goes orange, this pair has to go back to cyan.
   *
   * `core` is the bright top line and `glow` the wide dim underlay, matching
   * the coastline stack in `map/style.js`. The Three seams take the same two as
   * a cold/warm pair, so the material still sweeps with the light like every
   * other surface on this globe — same lighting, different metal — and the
   * lines do not change colour partway through the dive.
   *
   * COLOUR IS NOT THE ONLY SIGNAL, and it must not become one. Orange sits far
   * from this world's orchid coastline in hue, and `SIZE.plateWidthScale` and
   * `OPACITY.plate*` carry the rest. See the note on `plateWidthScale`.
   *
   * `null` on a world means it draws no plate boundaries at all.
   */
  plates: Object.freeze({
    /** THE OUTER HEAT. Not a line — the light a hot seam throws onto the rock
     *  around it, drawn wide and heavily blurred at `OPACITY.plateGlow`.
     *
     *  ==> IT WENT FROM COOLING BASALT TO BURNING, AND THE MMI ARGUMENT IS NOW
     *  A MEASUREMENT RATHER THAN A HEX COMPARISON. <== It was `#7A2A0C`, chosen
     *  dark so it could never be confused with MMI's reds. Dark was the wrong
     *  lever: a dark blurred band over a near-black ocean is a smudge, not a
     *  glow, and the whole point of the outer pass is that the seam reads as a
     *  SOURCE of light.
     *
     *  What matters is what lands on screen, not the swatch. Measured: `#D92600`
     *  at 24% over this world's `#10091E` ocean composites to `#401017`,
     *  luminance 0.0152. MMI's darkest red `#fd0000` is 0.2088 — fourteen times
     *  brighter — and its brightest `#ffaa00` is 0.5001. There is no zoom or
     *  blend at which this pass could be mistaken for a shaking-intensity
     *  colour. RE-MEASURE IF `ocean` OR `OPACITY.plateGlow` MOVES; the argument
     *  is about the composite, and either one changes it. */
    glow: '#D92600',
    /** THE MAGMA BODY: the bright orange middle pass, lightly blurred so it
     *  bleeds into the heat outside it instead of ending on an edge.
     *
     *  THIS IS THE ONE VALUE IN THE STACK THAT GENUINELY SITS INSIDE THE MMI
     *  RANGE — luminance 0.3525, between `#ff9100` (0.4151) and `#ff4700`
     *  (0.2577) — and it stays, unchanged, because the collision is not resolved
     *  by hex-picking. It is resolved by the rule below: quake severity on this
     *  globe is size and ripple strength, never hue. */
    core: '#FF7A1A',
    /** THE SUPERHEATED CORE: a thin, unblurred, full-strength near-white, and
     *  the layer that turns an orange line into molten rock. A bright hard line
     *  inside two soft dim ones is what hot looks like.
     *
     *  PALE WARM WHITE, NOT A BRIGHTER ORANGE, AND THAT IS THE MMI ANSWER FOR
     *  THIS PASS. At luminance 0.8872 it is 1.8x brighter than the brightest
     *  colour MMI has, so it sits OFF THE END of that ramp rather than on top of
     *  it — a seam is hotter than any earthquake colour, which happens to also
     *  be true of rock. Kept warm (`#FFF1D0`, not `#FFFFFF`) so it belongs to
     *  the pair above it instead of reading as a highlight from another map. */
    hot: '#FFF1D0',

    /** ---------------------------------------------------------------------
     *  THE PLATE NAMES. Two per seam, one on each side, bending along it
     *  (`map/style.js plateLabelLayers`).
     *
     *  EMBER, NOT ORCHID: a plate name belongs to the seam it names, and this
     *  world's own text colours are all violet. Warm text is the only thing that
     *  makes the label read as part of the magma family rather than as another
     *  place name that happens to be near a line.
     *
     *  PLACED BY CONTRAST, NOT BY EYE. Against the `#10091E` ocean this is
     *  5.14:1 — comfortably past WCAG AA, and deliberately just ABOVE the
     *  country names' own 4.77:1, because on THIS globe the plates are the
     *  subject and the countries are the reference. It is the only text on the
     *  map that outranks a country name in weight, and it still loses to one in
     *  collision (see the placement note in `placeLabelLayers`). */
    text: '#AE774F',
    /** Haloed in the OCEAN colour rather than the land colour the country and
     *  state names use, and for a plain reason: a plate boundary spends most of
     *  its length at sea. Same choice the city labels already make. */
    textHalo: '#10091E',
  }),

  /**
   * NO STATE OR PROVINCE FURNITURE, AND COUNTRY NAMES ALL THE WAY DOWN.
   *
   * Aaron's call on glass, 2026-07-30, and it is the right one: on a map whose
   * subject is plate boundaries, a provincial border is a line of the same
   * weight meaning something incomparably smaller, and the seams cross it
   * everywhere. Clutter.
   *
   * ==> THE THIRD FLAG IS NOT A SEPARATE PREFERENCE — IT IS THE COST OF THE
   * FIRST TWO. <== `ADMIN.nameLadder` fades country names OUT at z5 because
   * state names have taken over by then. Delete state names and that fade leaves
   * a nameless map from z5 until cities arrive at z6.4 — which breaks the
   * ladder's own written invariant that at least one name is on screen at every
   * zoom. So a world that drops a rung has to lengthen the rung below it.
   * `sustainCountryNames` does exactly that and nothing else: the country label's
   * rise is byte-identical to Sky's, and only its ending changes.
   *
   * The keys and their defaults live in `map/style.js ADMIN_DEFAULTS`. A world
   * states what it CHANGES; `graticule` below is the same pattern one step
   * simpler.
   */
  admin: Object.freeze({
    stateLines: false,
    stateNames: false,
    sustainCountryNames: true,
  }),

  /**
   * NO REFERENCE LINES.
   *
   * `map/graticule.js` draws exactly three: the equator and the two tropics,
   * and its header is explicit that they earn their place BECAUSE OF CYCLONES
   * — a storm cannot cross the equator, and the tropics bracket the warm water
   * they are born in. Deep is earthquakes and volcanoes. Neither line means
   * anything here, and an unmeaning line is decoration.
   *
   * Enforced with the existing `setGraticuleVisible()`, which `main.js`
   * already uses for the user's own toggle — no new machinery, and re-applied
   * on every `style.load` because a style rebuild puts the layers back.
   */
  graticule: false,
});
