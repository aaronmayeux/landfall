/**
 * tokens.js — the single visual contract.
 *
 * Every color, type size, and spacing value in Landfall originates here.
 * Feature code contains zero hardcoded hex and zero raw pixel literals.
 * One edit in this file changes the whole app. That is the point.
 *
 * Imports nothing. Ever.
 */

/* ---------------------------------------------------------------------------
 * FIXED SEVERITY COLORS — NOT THEMEABLE (SPEC §6)
 *
 * These are identical in light and dark mode. A Cat 3 dot and a Hurricane
 * Warning must read the same everywhere, on every device, in every theme.
 * Do not add a light-mode variant of anything in this block.
 *
 * These are MAP colors, not TEXT colors. Category color is the swatch and the
 * glyph; it is never the color of body text in a panel. A yellow Cat 1 as text
 * on panel glass fails contrast outright. Color carries severity, text carries
 * the words.
 * ------------------------------------------------------------------------- */

/** Saffir-Simpson category. Index matches the normalized storm object's
 *  `category` field: 0 = tropical depression, 1 = tropical storm,
 *  2..6 = Category 1..5. GENERIC is for storms NHC advises on that have no
 *  meaningful category (post-tropical, potential tropical cyclone). */
export const CATEGORY_COLOR = Object.freeze({
  TD:      '#5BA8E0',
  TS:      '#3ECC7A',
  CAT1:    '#FFE14D',
  CAT2:    '#FFB52E',
  CAT3:    '#FF7A33',
  CAT4:    '#FF4D6D',
  CAT5:    '#E05BE0',
  GENERIC: '#B5474D',
});

/**
 * Hurricane strength, CATEGORY UNKNOWN.
 *
 * Not a Saffir-Simpson color and not part of the ramp. GDACS's strongest
 * published wind band is 120 km/h — the Cat 1 floor — so a Cat 1 and a Cat 5
 * publish an identical band set and its forecast points can only ever say
 * "hurricane". This is the color for that statement.
 *
 * FIXED, like the rest of §6: it must mean the same thing everywhere.
 *
 * **KNOWN TENSION, VERIFY ON GLASS.** CAT5 is already `#E05BE0`, a magenta.
 * This rose sits about 30° of hue away from it, which is a real gap on a
 * desktop monitor and a smaller one on a phone at night. If an unknown-
 * strength hurricane and a Cat 5 read as the same dot, that is a §6 failure
 * — the whole point is that severity is distinguishable at a glance — and
 * this should become a shape difference (hollow ring, heavier stroke)
 * rather than another hue.
 */
export const HURRICANE_UNKNOWN_COLOR = '#FF4FA3';

/** NHC watch/warning products, by TCWW code.
 *  These are watch/warning products — never called "advisories" in the UI.
 *  All four are wind-threshold products: 34 kt tropical-storm force,
 *  64 kt hurricane force. */
export const WATCH_WARNING_COLOR = Object.freeze({
  TWA: '#FFE14D', // Tropical Storm Watch
  TWR: '#3B7DDB', // Tropical Storm Warning
  HWA: '#FF6FB0', // Hurricane Watch
  HWR: '#E03030', // Hurricane Warning
});

/** Peak storm surge ramp, rising severity.
 *  NHC's own legend text is shown verbatim — rewriting an official legend is
 *  the same class of error as curving official geometry. */
export const SURGE_RAMP = Object.freeze([
  { color: '#64B5F6', label: 'Up to 3 ft',  feet: 3  },
  { color: '#FFE14D', label: 'Up to 6 ft',  feet: 6  },
  { color: '#FB8C00', label: 'Up to 9 ft',  feet: 9  },
  { color: '#E53935', label: 'Up to 12 ft', feet: 12 },
  { color: '#AB47BC', label: 'Above 12 ft', feet: Infinity },
]);

/** Wind bands, drawn nested: 34 kt widest, 64 kt core. */
export const WIND_BAND_COLOR = Object.freeze({
  KT34: '#43A047',
  KT50: '#FB8C00',
  KT64: '#E53935',
});

/* ---------------------------------------------------------------------------
 * MODEL TRACK IDENTITY COLORS — the one §6 contract that IS themed, and the
 * reason is measured rather than argued.
 *
 * §6 fixes severity and official-product colors because a Cat 3 dot and a
 * Hurricane Warning must read identically on every device: the user learns the
 * mapping once and it has to hold. Those survive light mode by carrying a HALO
 * in the theme's ink — the fill says which severity, the halo makes it findable.
 *
 * A MODEL LINE HAS NO HALO AND CANNOT HAVE ONE. A casing under 45 dashed
 * guidance lines would make the quietest layer on the map the boldest thing on
 * it, inverting §7's line grammar — guidance is thinner and dashed precisely so
 * a raw model run never wears NHC's authority.
 *
 * AND THE DARK SET IS INVISIBLE IN LIGHT MODE. Measured against the daylight
 * ocean `#9DBDD6`, composited at the layer's own 0.7 opacity:
 *
 *     HFSA #FFAB40  1.00:1        NEMN #4DD0A0  1.00:1
 *     TVCN #00E5FF  1.15:1        AVNO #B388FF  1.25:1
 *
 * 1.00:1 is not "washed out", it is the same luminance as the sea. Reported on
 * glass by Aaron 2026-07-28 and confirmed by the numbers above.
 *
 * SO IDENTITY IS CARRIED BY HUE, AND ONLY LIGHTNESS AND CHROMA MOVE. Every
 * light value below is the SAME HUE ANGLE as its dark twin — GFS purple stays
 * purple, HAFS orange stays orange. The picker swatch is generated from this
 * same function, so the legend and the line can never disagree about which
 * model is which. Nobody misreads a storm's severity because GFS shifted a
 * shade; that is exactly why this differs from the severity ramp.
 *
 * THE TARGET IS ~2.6:1, DELIBERATELY BELOW THE PAST TRACK'S 3.31:1. Guidance
 * must be legible and must still recede: forecast track 8.50 > past track 3.31
 * > guidance ~2.6. Raising these further would win contrast and lose the
 * grammar. `tools/contrast-check.mjs` gates both ends.
 *
 * HCCA shares TVCN's color: same consensus slot, never drawn together.
 * Models beyond the shortlist draw from MODEL_FALLBACK_RAMP.
 * ------------------------------------------------------------------------- */

/** The DARK set. Ask `modelColor()` in lib/adeck.js, never this table —
 *  it resolves the live theme for you. */
export const MODEL_COLOR = Object.freeze({
  TVCN: '#00E5FF',
  HCCA: '#00E5FF',
  AVNO: '#B388FF',
  HFSA: '#FFAB40',
  UKX:  '#F06292',
  /* TCGP ensemble means. Reusing the NHC hues deliberately rather than
   * inventing three more: the two families never appear on the same storm, so
   * a colour can carry one meaning per storm without collision, and a picker
   * showing both groups stays a set of five hues rather than eight.
   * GEFS takes GFS's purple because it IS the GFS, run many times. */
  AEMN: '#B388FF',
  NEMN: '#4DD0A0',
  CEMN: '#FFAB40',
});

/** The LIGHT set. Same hue angles, darker and more saturated so they clear the
 *  daylight ocean. See the block above for why this table exists at all. */
export const MODEL_COLOR_LIGHT = Object.freeze({
  TVCN: '#005963',
  HCCA: '#005963',
  AVNO: '#6B17FF',
  HFSA: '#7B4500',
  UKX:  '#D10047',
  AEMN: '#6B17FF',
  NEMN: '#005D3B',
  CEMN: '#7B4500',
});

/** The long tail of models cycles through this ramp in registration order.
 *  Deliberately lower-chroma than the shortlist so named models stay dominant
 *  in a hairball of tracks. */
export const MODEL_FALLBACK_RAMP = Object.freeze([
  '#7E8FA6',
  '#8E7CA6',
  '#6FA68E',
  '#A69B6F',
  '#A67C8E',
  '#6F8EA6',
]);

/** The light-mode fallback ramp. Same hues, darkened for the same reason as
 *  the shortlist — an unnamed model that draws invisibly is worse than one
 *  that draws in a colour nobody can name. */
export const MODEL_FALLBACK_RAMP_LIGHT = Object.freeze([
  '#3D4A5C',
  '#4A3D5C',
  '#2E5C4A',
  '#5C5230',
  '#5C3D49',
  '#30475C',
]);

/* ---------------------------------------------------------------------------
 * THEMED PALETTE — dark is default (night-sky globe)
 *
 * Land fill values are chosen AGAINST the fixed severity colors above, never
 * the reverse. §6 is the constraint; this palette accommodates it.
 *
 * The audit that decides whether these survive contact with a real basemap is
 * SPEC §15 item 2, and it has not happened yet.
 * ------------------------------------------------------------------------- */

export const DARK = Object.freeze({
  /* Globe body */
  ocean:          '#070D18', // deep, near-black — lets storm dots glow
  oceanDeep:      '#04080F', // toward the limb, for depth
  land:           '#132132', // filled land: solid enough to sit dots on
  landHigh:       '#1A2C42', // subtle relief at close zoom
  landFaint:      '#0C1420', // continents at the planet band: barely above
                             // ocean, so the mesh reads as the hero and the
                             // land resolves to `land` as you zoom in
  /** Nodal network at REST — the calm, storm-free cage. Deliberately the DIM
   *  cyan of the coastline stack, not the bright one: the cage is ~7,680 edges
   *  laid over the coastlines at the planet band, and at `coastGlow` brightness
   *  in the same hue the continents stop reading as edges at all. Same color
   *  family, cage sits behind the coast. NOT a severity color — severity
   *  arrives by blending toward CATEGORY_COLOR (see meshStormMix). */
  mesh:           '#1E6B7D',
  coastGlow:      '#4FD1E8', // the bright top line of the coastline stack
  coastGlowSoft:  '#1E6B7D', // the wide dim blurred underlay
  /* `graticule` (the MINOR grid colour) retired 2026-07-25 with the 15° grid
   * itself — only the major reference lines are drawn now. See map/graticule.js.
   *
   * THIS WAS #26496D AND NOBODY COULD SEE IT (2026-07-25).
   *
   * The grid is not just its own colour — it is multiplied by the dive
   * crossfade, which holds #globe at opacity 0 below z2 and only reaches 1 at
   * z5. Stack a 0.22 layer opacity on top of that and a near-ocean navy at
   * 0.5px wide, and the effective contrast against the #070D18 ocean was
   * around 7%: drawn, correct, and invisible. Aaron reported the toggle as
   * doing nothing, which is what "drawn but unreadable" looks like from the
   * outside — a §5 failure wearing a working switch.
   *
   * Still DIMMER THAN THE COAST (§9) — the coast glow is #4FD1E8 and these
   * remain well below it. They are just now above the noise floor. */
  graticuleMajor: '#5A8FC0', // equator and the two tropics

  /* --- POPULATION HEAT — THE COASTLINE'S OWN CYAN --------------------------
   *
   * ==> THE TOP OF THIS RAMP IS `coastGlow`, EXACTLY, AND THAT IS AARON'S
   * CALL. <== Two earlier passes picked a colour to stay OFF the coastline —
   * violet first, then a greener teal — on the reasoning that the coast line
   * is the primary structure and a field sharing its hue would muddy it. He
   * looked at both on glass and chose the coast colour itself. It is his app
   * and his eye; the reasoning was not wrong, the conclusion was.
   *
   * They read apart by FORM rather than by hue: the coast is a thin bright
   * line with a glow under it, the population is a broad soft field that never
   * reaches full strength except over a megacity core. A test asserts the top
   * stop still equals `coastGlow`, so a future coastline recolour drags this
   * with it instead of quietly splitting the pair.
   *
   * The two lower stops are the same colour walked down in lightness, so the
   * whole ramp is one hue and reads as one quantity.
   */
  populationLow:  '#1B5A66', // faint — a small town
  populationMid:  '#35A0BA', // a city
  populationHigh: '#4FD1E8', // a megacity core — IDENTICAL to coastGlow

  /* THE CHOSEN SEGMENT of a segmented control, and its hairline edge.
   *
   * These exist because the selected state used to be `glass` — DARKER than
   * the `glassRaised` group it sits inside, so the only thing distinguishing
   * the chosen option from the others was font weight. A step UP in lightness
   * is what makes a chip read as raised and therefore as picked. Deliberately
   * not the focus ring's cyan at full strength: selection and keyboard focus
   * are different states and must stay tellable apart when both are true. */
  segActive:      '#2B5175',
  segActiveEdge:  '#4A7CA8',

  /* THE INSTALL CALL-TO-ACTION. Amber, and its OWN token rather than reusing
   * `stale`.
   *
   * Aaron asked for red. Red is spoken for: §6's colour semantics reserve it
   * for failure — dead feeds, errored layers, the status chip — and a
   * call-to-action wearing it would mean red no longer reliably says "something
   * is broken". Amber is the compromise he picked, but it must not literally
   * BE `--stale` either: that colour means "this data is older than it should
   * be", and a button sharing it would quietly join that vocabulary. Same
   * family, separate name, so changing one never moves the other. */
  installCta:     '#F0B23C',
  installCtaInk:  '#1A1206', // near-black, for text on the amber fill

  /** Cage NODES at rest. A step brighter than the cage edges they sit on — the
   *  nodes are the signal, the edges are the lattice carrying it. */
  node:           '#4FD1E8',

  /** How far a fully-lifted node travels toward its storm's category color.
   *  1.0 = all the way (a Cat 5 node IS CAT5 pink); lower values keep a cyan
   *  undertone at peak. Elevation and color ride the SAME lift value, so they
   *  cannot desync — one number, two channels. */
  meshStormMix: 1.0,

  /** The RESTING cage brightness, as a multiplier on `mesh`/`node`.
   *  1.0 = full brightness, which is the setting. A 0.55 dim shipped once to
   *  make storm colors "pop" and made the calm lattice nearly invisible on a
   *  phone — the cage IS the planet-band look, and dimming the 99% of it that
   *  is storm-free to flatter the 1% that isn't was the wrong trade. If storm
   *  colors need more separation, raise their saturation or narrow the fade
   *  band; do not dim the thing you are looking at. */
  meshRestDim: 1.0,

  /** Storm glyphs at the PLANET band: the two-arm spiral in its category color,
   *  matching MapLibre's glyphs at every band. Was uniform grey — severity out
   *  here used to be elevation-only, but once the cage itself carries category
   *  color a grey glyph sitting inside a colored peak is the inconsistent
   *  element. Kept as a token because the OUTAGE state still needs a grey. */
  stormPlanetDot: '#8F99A6',

  /** A storm that has ENDED — its agency issued a final bulletin, or it left a
   *  healthy feed and stayed gone (SPEC §5, lib/lifecycle.js). Grey, and
   *  DELIBERATELY OUTSIDE THE SAFFIR-SIMPSON SET.
   *
   *  §6 fixes the category colors so a Cat 3 dot reads the same everywhere, and
   *  this does not break that rule — it steps out of it. An ended storm has no
   *  current category to be wrong about: nobody is publishing a wind for it, so
   *  any Saffir-Simpson hue here would be a severity claim about a system the
   *  issuing agency has stopped describing. Grey is the absence of that claim,
   *  which is the same thing `meshMuted` says about a cage with no feed behind
   *  it.
   *
   *  DISTINCT FROM `stormPlanetDot`, which is a live storm's glyph at the planet
   *  band and happens to also be grey. Two states that look similar today must
   *  still be two tokens: one is "too far away to color", the other is "there is
   *  no color to give it", and a single value would silently couple a zoom
   *  affordance to a data state.
   *
   *  ==> NEAR-WHITE, NOT DIM, AND THAT REVERSED THE FIRST ATTEMPT. <==
   *  This shipped at `#6F7885` on the reasoning that an ended storm should read
   *  as RECEDED. On glass Aaron read it as far away rather than as finished —
   *  which is exactly the failure mode a dim grey invites, because
   *  `stormPlanetDot` uses dimness to mean distance three tokens up.
   *
   *  The right idea is BONE, not shadow: a mark drained of its colour, still
   *  fully present. Near-white says "this had a severity and no longer has one";
   *  dim grey says "this is small and far off". Held just under `textPrimary`
   *  (#E8F1F8) so the brightest thing on a night globe is still type, not a dead
   *  storm. */
  stormEnded:     '#DCE4EC',

  /* 3D clear globe — the planet-band entry engine (SPEC §2). `mesh` (dim cyan,
   * above) is the cage and its nodes at rest. */
  land3d:         '#1E3047', // continents on the clear globe. Shifted out of
                             // charcoal into MapLibre's blue land family so the
                             // two engines read as one planet — but LIGHTER
                             // than `land` on purpose: the clear globe has no
                             // opaque backing, so an exact match would sink the
                             // continents into the see-through ocean.
  coast3d:        '#8A97A4', // grey coastline edge riding on the 3D land fill
  meshMuted:      '#6B7480', // cage when the storm feed is UNAVAILABLE —
                             // desaturated so a quiet globe can't be mistaken
                             // for all-clear (SPEC §5 safety rule)
  nodeMuted:      '#8F99A6', // nodes under the same outage

  /* Atmosphere */
  skyHigh:        '#040711',
  skyLow:         '#0B2138',
  atmosphere:     '#3D9BC4', // rim light at the horizon
  starfield:      '#8FA8C4',
  space:          '#04070E', // deep space behind the 3D globe (Three bg + fog)
  spaceNear:      '#0A1626', // lit near-stop of the space-background gradient
  spaceFar:       '#02040A', // darkest outer stop of that gradient

  /* Chrome — glass panels floating over the globe */
  glass:          'rgba(10, 20, 34, 0.72)',
  glassRaised:    'rgba(16, 30, 48, 0.86)',
  glassBorder:    'rgba(120, 190, 225, 0.16)',
  glassShadow:    'rgba(0, 0, 0, 0.55)',

  /* Text — never a severity color */
  textPrimary:    '#E8F1F8',
  textSecondary:  '#9DB3C7',
  textMuted:      '#7089A5',

  /** ADMINISTRATIVE FURNITURE (§11) — borders and place names.
   *
   *  ONE HIERARCHY, and it is deliberately steep, brightest first:
   *    storm names (textSecondary) > city names > state names
   *      > country lines > state lines > land
   *
   *  Every value here sits BELOW the coastline (`coastGlow`) in both brightness
   *  and saturation, because a border is reference and a coastline is where the
   *  water meets the land — the one line on this map a storm actually crosses.
   *  If a border ever reads as brightly as a coast, this is the block to fix. */
  adminState:     '#2B4058', // state / province divides — barely above land
  adminCountry:   '#3D5670', // national borders — one step up, still quiet
  textState:      '#556A80', // state / province names: big areas, so quieter
  textCountry:    '#6B8098', // country names — the broadest label, and for the
                             // brief band it lives in (ADMIN.nameLadder) very
                             // nearly the only text on the map, so it can
                             // afford to sit above state names
  textPlace:      '#7A90A6', // major city names: a point you navigate by
  textInverse:    '#07121D',

  /* State */
  focusRing:      '#5FE0F5', // always visible, never outline:none
  stale:          '#E0A93C', // aging data, 4-9 h
  error:          '#E85D5D', // source down / layer failed
  ok:             '#4FD18B',
  dim:            'rgba(232, 241, 248, 0.38)', // ghosts, unsupported rows

  /** SELECTED-STORM GEOMETRY, THEME-DEPENDENT HALF (see STORM_GEO below for
   *  the widths, dashes and opacities, which do not change with the theme).
   *
   *  These live in the palette rather than in STORM_GEO because every one of
   *  them is a statement about the BACKGROUND: a white cone is a veil on a
   *  night ocean and invisible on a day one, and a near-black label halo is a
   *  clean outline in the dark and a smudge in the light. The number stays in
   *  STORM_GEO; the color that depends on what's behind it lives here. */
  geo: Object.freeze({
    coneFill:       '#FFFFFF',
    coneLine:       '#FFFFFF',
    trackForecast:  '#E8F2F8',
    trackPast:      '#5C7A94',

    /** The dark ring around every forecast dot, and the code drawn inside it.
     *  DARK IN BOTH THEMES on purpose — the §6 category ramp runs light to
     *  mid, so a dark ring separates a Cat 1 yellow from a night ocean AND
     *  from lit daytime land, and a dark code stays legible on all seven
     *  fills. One ink, both themes, no second contract to keep in sync. */
    pointStroke:    '#0B1420',
    pointCodeColor: '#0B1420',

    /** THE EXCEPTION TO THE ONE-INK RULE ABOVE, AND IT IS DELIBERATE. The
     *  earliest forecast point of each storm wears a WHITE ring instead of the
     *  dark one, so the chain of dots reads directionally. Without it a track
     *  whose categories run 1 → 2 → 2 → 1 gives the eye no start and no end,
     *  and the reader has to already know which way storms travel in that
     *  basin to tell the future from the past. Light in BOTH themes for the
     *  same reason the dark ring is dark in both: it is the contrast AGAINST
     *  its neighbours that carries the meaning, not agreement with the sky. */
    pointStrokeFirst: '#FFFFFF',

    labelColor:     '#C7D6E2',
    labelHalo:      '#0B1420',

    /** Halo behind a STORM NAME on the map. A map label's legibility is
     *  decided by its halo, not by the terrain under it — the terrain changes
     *  pixel to pixel and the halo is what exists to hide that. This was
     *  `ocean` in both places it was used, which happened to be right in the
     *  dark theme and would have been catastrophic in the light one. */
    stormLabelHalo: '#070D18',

    /** THE §6 GUARANTEE, MADE MEASURABLE. Severity colors are fixed, so on a
     *  pale daytime ocean a Cat 1 yellow has almost no luminance contrast
     *  against the water. This halo is what makes the mark FINDABLE; the fill
     *  then says which severity it is. tools/contrast-check.mjs requires this
     *  color to clear 3:1 against both ocean and land in both themes — that
     *  check is the contract, not a nice-to-have. */
    glyphHalo:      '#070D18',
  }),
});

/**
 * LIGHT — the daytime globe.
 *
 * NOT AN INVERSION OF DARK, and the places it refuses to invert are the
 * interesting ones:
 *
 *  - The cage, the coastline and the nodes go DARKER than their surface, not
 *    lighter. In the dark theme they are light lines glowing on a night sea;
 *    the equivalent statement on a pale sea is a dark line, not a pale one.
 *    Inverting their lightness numerically would have produced white lines on
 *    a white ocean.
 *
 *  - The chosen segment of a control goes DOWN in lightness and UP in
 *    saturation. In dark mode "picked" reads as a step toward the light; in
 *    light mode a step further toward white is a step toward invisible, so
 *    picked reads as a tinted step toward the ink instead.
 *
 *  - The install button's amber is a DIFFERENT amber. `#F0B23C` on a white
 *    panel is a 1.6:1 boundary — a button with no edge. The light theme's
 *    amber is dark enough to clear 3:1 against the panel it sits on, and
 *    carries near-white ink instead of near-black.
 *
 *  - The administrative furniture keeps its HIERARCHY, not its values:
 *    city > country > state > country lines > state lines > land, and every
 *    one of them still sits below the coastline. In light mode "quieter"
 *    means closer to the land color from above rather than from below.
 *
 *  - Space is not black. At the planet band the light theme is a globe in
 *    daylight against a soft high-altitude sky, not a lit globe in a void.
 *    There is no starfield in daylight.
 *
 * Every REQUIRED pair here is measured by tools/contrast-check.mjs. If a value
 * below changes, run it.
 */
export const LIGHT = Object.freeze({
  /* Globe body */
  ocean:          '#9DBDD6', // daylight sea — deep enough that a white cone,
                             // a pale label and the glass panels all have
                             // something to sit against
  oceanDeep:      '#87A9C6', // toward the limb, for the same depth cue
  land:           '#E6E0D2', // warm pale land: paper, not white, so the ocean
                             // reads as the cooler surface and severity fills
                             // keep some separation from it
  landHigh:       '#F0EBE0', // subtle relief at close zoom
  landFaint:      '#BFD2E1', // continents at the planet band: barely above the
                             // ocean, so the cage reads as the hero — the same
                             // rule as dark, pointed the other way

  /** Nodal network at REST. DARK teal on a pale sea, and deliberately the
   *  quieter of the two coastline colors, exactly as in dark mode: the cage is
   *  ~7,680 edges laid over the coastlines and must sit BEHIND them. */
  mesh:           '#3D7F94',
  coastGlow:      '#0C5065', // the strong top line of the coastline stack
  coastGlowSoft:  '#4E93A8', // the wide soft underlay
  graticuleMajor: '#3B6E97', // equator and the two tropics — still well under
                             // the coastline, still clearly above the water

  /* Population heat on a light basemap. DARKER AND MORE SATURATED as density
   * rises, which is the inverse of the dark theme's rising lightness — the
   * rule is "further from the background", and the background moved. Same
   * hue, same three-stop shape, same reason it is not orange. */
  /* Same rule on light: the top stop is this palette's `coastGlow`. */
  populationLow:  '#9FD0DC',
  populationMid:  '#3E8FA8',
  populationHigh: '#0C5065',

  /* Chosen segment of a segmented control. Down in lightness, up in
   * saturation — see the header note. */
  segActive:      '#B7D3EE',
  segActiveEdge:  '#3F729E',

  /* Install call-to-action. Same family as dark's amber, dark enough to have
   * an edge against a near-white panel, with near-white ink on it. */
  installCta:     '#9C5D06',
  installCtaInk:  '#FFF6E9',

  node:           '#0C5065', // nodes: the signal, a step stronger than the cage
  meshStormMix: 1.0,
  meshRestDim: 1.0,
  stormPlanetDot: '#48555F', // planet-band glyph in the OUTAGE state
  /** An ENDED storm's glyph and cage head — see the dark theme's note for why
   *  this steps outside the fixed category colors rather than breaking them, and
   *  for why the idea is BONE rather than shadow.
   *
   *  ==> IT CANNOT MIRROR DARK'S NEAR-WHITE, and this is the one token where the
   *  two themes are not each other's inverse. "Drained of colour" renders as
   *  near-white on a night globe and would render as INVISIBLE on a pale
   *  daytime ocean, so here the same idea has to be carried by a strong neutral
   *  instead: no hue, clearly deliberate, obviously not one of the severity
   *  colours. Reaching for a light grey to "match" dark is how this mark
   *  disappears in daylight. */
  stormEnded:     '#5B6675',

  /* 3D clear globe */
  land3d:         '#DCD6C6', // continents on the clear globe — slightly DEEPER
                             // than `land` here, the mirror of dark's
                             // slightly-lighter: the clear globe has no opaque
                             // backing, so an exact match washes out
  coast3d:        '#5C6873', // grey coastline edge on the 3D land fill
  meshMuted:      '#7D858D', // cage when the storm feed is UNAVAILABLE
  nodeMuted:      '#5C6873',

  /* Atmosphere — daylight */
  skyHigh:        '#BFDBF2',
  skyLow:         '#8FBEE0',
  atmosphere:     '#5FA8D8', // rim light at the horizon
  /** No stars in daylight. Held near the sky rather than removed, so the
   *  starfield code path stays identical in both themes and there is no
   *  "if light, skip the stars" branch to forget. */
  starfield:      '#B4CDE2',
  space:          '#CFE1F1', // high-altitude sky behind the 3D globe
  spaceNear:      '#E4EFF9',
  spaceFar:       '#AEC9E1',

  /* Chrome — glass panels floating over the globe */
  glass:          'rgba(250, 252, 254, 0.80)',
  glassRaised:    'rgba(255, 255, 255, 0.92)',
  glassBorder:    'rgba(22, 54, 82, 0.20)',
  glassShadow:    'rgba(18, 40, 64, 0.22)',

  /* Text */
  textPrimary:    '#0D1A26',
  textSecondary:  '#374F63',
  textMuted:      '#4C6377',

  /** ADMINISTRATIVE FURNITURE (§11) — same hierarchy, inverted direction.
   *  Every value sits BELOW the coastline, approaching the land color from
   *  above rather than from below. */
  adminState:     '#B6B0A0', // state / province divides — barely off land
  adminCountry:   '#8F887A', // national borders — one step up, still quiet
  textState:      '#67768A', // state / province names: big areas, quieter
  textCountry:    '#52627A', // country names — the broadest label
  textPlace:      '#3C4C5F', // major city names: a point you navigate by
  textInverse:    '#F4F9FD',

  /* State */
  focusRing:      '#095F92',
  stale:          '#7D5100',
  error:          '#A81E16',
  ok:             '#0B6B3D',
  dim:            'rgba(13, 26, 38, 0.55)',

  /** Themed storm geometry. The cone and the tracks flip to ink; the dot ring
   *  and the code inside it do NOT (see the note on DARK.geo.pointStroke) —
   *  a dark ring is correct on both a night sea and lit daytime land, and one
   *  ink is one contract. */
  geo: Object.freeze({
    coneFill:       '#12293C',
    coneLine:       '#12293C',
    trackForecast:  '#101F2E',
    trackPast:      '#4A6076',

    pointStroke:    '#0B1420',
    pointCodeColor: '#0B1420',

    /** See the note on DARK.geo.pointStrokeFirst — one ink, both themes. */
    pointStrokeFirst: '#FFFFFF',

    labelColor:     '#14283A',
    labelHalo:      '#F4F8FB',
    stormLabelHalo: '#F4F8FB',

    /** Still a dark ink. On a pale ocean a dark halo is what separates a
     *  yellow Cat 1 from the water; a pale halo would separate it from
     *  nothing. This is the whole reason the halo is a token. */
    glyphHalo:      '#0B1420',
  }),
});

/* ---------------------------------------------------------------------------
 * TYPE
 *
 * System stack only — no webfont, no network request, no layout shift on a
 * cold load over cell data. Time-to-first-paint is the Phase 1 baseline and a
 * font file would compromise it for decoration.
 *
 * Two roles: UI (everything) and NUMERIC (vitals, coordinates, timestamps).
 * The numeric face is tabular so a 30-minute poll updating "85 kt" to "90 kt"
 * doesn't shift the column.
 * ------------------------------------------------------------------------- */

export const FONT = Object.freeze({
  ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  numeric: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
});

/** Type scale, in rem. Base is 16px. */
export const TYPE = Object.freeze({
  display:  { size: '1.75rem', weight: 600, tracking: '-0.02em', leading: 1.15 },
  title:    { size: '1.25rem', weight: 600, tracking: '-0.01em', leading: 1.25 },
  body:     { size: '1rem',    weight: 400, tracking: '0',       leading: 1.5  },
  label:    { size: '0.875rem',weight: 500, tracking: '0.01em',  leading: 1.4  },
  caption:  { size: '0.75rem', weight: 500, tracking: '0.04em',  leading: 1.35 },
  micro:    { size: '0.6875rem',weight:600, tracking: '0.08em',  leading: 1.3  },
});

/* ---------------------------------------------------------------------------
 * SPACING & GEOMETRY
 *
 * A 4px base step. Named by role, not by size — feature code asks for
 * SPACE.panelPad, never SPACE.s16, so changing the panel's padding is one edit
 * here and not a search-and-replace.
 * ------------------------------------------------------------------------- */

const STEP = 4;
const s = (n) => `${n * STEP}px`;

export const SPACE = Object.freeze({
  hairline:   s(0.25),
  tight:      s(1),
  snug:       s(2),
  base:       s(3),
  comfy:      s(4),
  loose:      s(6),
  section:    s(8),

  panelPad:   s(4),
  rowGap:     s(2),
  groupGap:   s(6),
  controlGap: s(3),
});

export const SIZE = Object.freeze({
  /** Minimum touch target. Non-negotiable, SPEC §10.
   *  A control may LOOK smaller; its hit area never is. */
  touchTarget: '44px',

  /** How far the collapsed storm pill stays clear of each screen edge.
   *
   *  ==> IT IS A TOUCH TARGET PLUS A GAP, NOT A CHOSEN NUMBER. <== The info
   *  button sits at one edge and the control column at the other, both of them
   *  `touchTarget` wide. The pill used to avoid them by accident — it had a
   *  `left` offset and no `right`, so it could never grow past half the screen
   *  and never got near either. That accident also wrapped every message it
   *  ever showed, so it had to go, and this is the deliberate version of what
   *  it was doing by luck. Widen the side chrome and this has to follow. */
  pillInset: '60px',

  /** The spinning mark inside the collapsed storm pill.
   *
   *  Sized against the 44 px touch target rather than against the pill's
   *  rendered height: the pill grows when its label wraps, and a mark that
   *  grew with it would be a different size in each of the three loading
   *  rungs. 30 px reads as a spiral rather than a dot at phone density and
   *  leaves the pill's own padding intact on both sides. */
  pillMark: '30px',

  /** Visible storm glyph at rest. Hit area is touchTarget regardless.
   *  Raised 16 → 26 after the first live deploy: at regional zoom on a
   *  desktop the 16 px spiral read as debris, not a hurricane. */
  glyphBase: 26,

  /** Glyph zoom growth (MapLibre icon-size at the basin floor and at max
   *  zoom). Deliberately NOT map-locked — a map-unit glyph would swallow a
   *  metro area at z8. Tuned on glass 2026-07-23; these two endpoints are the
   *  sweet-spot knobs. */
  glyphZoomMin: 0.8,
  glyphZoomMax: 1.5,

  /** Glyph size multiplier by category index (0 = TD .. 6 = Cat 5).
   *  Size-scaled, never shape-scaled — a Cat 5 is a bigger glyph, not a more
   *  elaborate one. It has to stay legible at ~12px on a phone at z1. */
  glyphScale: Object.freeze([0.75, 0.85, 1.0, 1.1, 1.2, 1.32, 1.45]),

  /** How much the glyph's arms are FATTENED, as a fraction of the glyph radius
   *  (map/glyph.js strokes each outline in its own fill colour before filling
   *  it).
   *
   *  THE ARTWORK NEEDS THIS AND THE HAND-DRAWN SPIRAL DID NOT. The old two-arm
   *  spiral was a stroked line, so its weight was its shape. The logo is four
   *  filled silhouettes whose arms taper to points, and at the 12-24 px the
   *  glyph occupies on a phone at globe zoom those points fall below a pixel
   *  and break up — the mark reads as a blob with a hole rather than a spiral.
   *
   *  MEASURED, not guessed: rendered at 12/16/20/24/32/48 px against three
   *  weights. At zero the arms break up under ~20 px. Far above this the arms
   *  FUSE and the mark becomes a pinwheel, which loses the spiral — the failure
   *  in the other direction and the worse of the two, because a fused mark
   *  still looks deliberate.
   *
   *  HALVED from 0.06 on glass. The first value was chosen when the glyph still
   *  shrank with zoom and had to survive ~16 px; `stormDot3dPx` now holds it at
   *  a fixed size well above that, so the arms no longer need the help and the
   *  extra weight was reading as a thick outline rather than as the mark.
   *
   *  A FRACTION OF THE RADIUS, never a pixel count: the glyph is size-scaled
   *  by category (`glyphScale`) and drawn into textures of more than one size,
   *  so a fixed width would make a Cat 5 look thinner-armed than a TD. */
  glyphArmWeight: 0.035,

  /* (`endedDotPx` and `endedDotStrokePx` retired 2026-07-29. The last-known
   * position of an ended storm is now drawn at the FORECAST POINT's size and
   * stroke, read straight off `STORM_GEO`, because the two marks have to match
   * and a second pair of numbers is how that stops being true. See the note in
   * map/markers.js for why size stopped being the channel that says a storm is
   * finished.) */

  /** Storm name labels on the map (basin band and closer). Px because MapLibre
   *  speaks px; the halo is what keeps a name legible crossing a coastline. */
  stormLabelPx: 12,
  stormLabelHaloPx: 1.4,

  /** Administrative furniture (§11). Line widths are hairlines on purpose —
   *  a border reads as a division, and a division needs to be seen, not
   *  announced. Label sizes step DOWN from the storm name so the text
   *  hierarchy is legible without reading the words. */
  adminLineWidth: 0.7,        // state / province
  adminLineWidthCountry: 1.0, // national
  placeLabelPx: 11,           // major cities
  countryLabelPx: 11.5,       // country names — broadest label, largest type
  stateLabelPx: 9.5,          // state / province names
  /* Equator / tropic names. Between the country and state sizes: they are
   * broad, planet-scale labels like country names, but they are REFERENCE
   * rather than content and must not out-shout a place. */
  graticuleLabelPx: 10,
  placeLabelHaloPx: 1.2,

  radius:      '10px',
  radiusLarge: '16px',
  radiusPill:  '999px',

  /** Every focus ring in the chrome — buttons, rows, links. The GLOBE's is a
   *  different problem and a different pair of values; see below. */
  focusRingWidth: '2px',
  focusRingOffset: '2px',

  /** The GLOBE's focus ring, which is a different problem from a button's.
   *
   *  #globe is full-bleed, so an outline sits in the last pixels of the
   *  viewport — under the browser chrome, inside the phone's rounded corners,
   *  outside the safe area. Confirmed on glass: tabbing to the globe showed
   *  nothing at all. These pull the ring inboard far enough to clear all of
   *  that and thicken it enough to read against a lit ocean.
   *
   *  `globeRingInset` is measured from the safe-area edge, not the viewport
   *  edge — the CSS adds `env(safe-area-inset-*)` on top. */
  globeRingWidth: '3px',
  globeRingInset: '6px',
  globeRingRadius: '14px',

  /** Coastline stack: the same line drawn three times.
   *  Wide/dim/blurred underneath, thin/bright on top. */
  coastWidthGlow: 3.5,
  coastWidthCore: 0.9,

  /** PLATE BOUNDARIES (SPEC-GLOBES.md §43.2) — the same two-pass stack as the
   *  coastline, drawn MUCH WIDER and much dimmer. A broad soft band, not a line.
   *
   *  ==> WIDE-AND-DIM IS A DIFFERENT THING FROM THIN-AND-BRIGHT, AND IT IS THE
   *  MORE HONEST ONE. <== It shipped at 0.7 — narrower than the coast, on the
   *  reasoning that the plate network is the layer beneath it — and on glass
   *  that read as a second coastline in another colour. At 2.8 it stops
   *  competing, because it stops being the same KIND of mark: the coast is a
   *  crisp edge because a coastline IS one, and a plate boundary is not. PB2002
   *  lines are a generalised interpretation of a diffuse deformation zone that
   *  can be tens of kilometres across, so a hairline claims a precision the data
   *  does not have (§5, applied to cartography) and a soft band does not.
   *
   *  STILL DERIVED FROM THE COAST, NEVER TYPED TWICE — retuning the coastline
   *  moves these with it, so the two networks keep their relationship whatever
   *  happens to either.
   *
   *  AND THE WEIGHT IS DOING REAL WORK, NOT DECORATION. The plate lines are told
   *  apart from the coast by hue (magma orange against the Deep world's orchid)
   *  — but hue is very nearly the only thing separating them, and warm-against-
   *  magenta is a hard pair for red-green colour blindness. Width and opacity
   *  are the channels that survive when hue is gone. Never let these land ON the coast
   *  widths; far above or well below, but not equal. */
  plateWidthScale: 2.8,

  /** ==> THE MAGMA STAIR-STEP. THREE PASSES ONLY READ AS THREE IF THEIR WIDTHS
   *  ARE VISIBLY DIFFERENT. <==
   *
   *  Multipliers on `coastWidthCore * plateWidthScale` (= 2.52 px at the basin
   *  band), so all three move together with the one scale above and cannot cross.
   *
   *  THE FIRST ATTEMPT LOOKED LIKE ONE LINE, and the widths are why. They were
   *  0.5 / 2.2 / (a glow derived from `coastWidthGlow` at 1.0) — about
   *  1.3 / 5.5 / 5.9 px, so the body and the heat were the SAME WIDTH and the
   *  core was a third of them. Three passes at two widths is two passes, and
   *  reported on glass as "one same-colour line".
   *
   *  1 : 4.4 : 10 is the ratio a glow actually needs — each pass has to be
   *  several times the one above it or the blur simply fills the gap and you get
   *  a single soft edge. That is also the ratio the reference implementations use
   *  (Gemini's sketch suggested 1 : 4 : 10 independently, which is a good sign
   *  the number is not a taste).
   *
   *  `heat` is the one to push if the seams still read flat; it is nearly
   *  invisible on its own and its whole job is the light around the line. */
  plateStack: Object.freeze({
    hot: 0.5,
    body: 2.2,
    heat: 5.0,
  }),

  /** PLATE NAME LABELS (`map/style.js plateLabelLayers`).
   *
   *  SMALLER THAN A STATE NAME, and the reason is not importance. A plate name
   *  sits on a LINE, not in the middle of an area, so it competes for the strip
   *  of screen either side of a seam — and there are two of them at every point
   *  along it. Set at the state label's size on first pass and the pair read as
   *  a wall of text across the boundary rather than as two names beside it.
   *
   *  The halo is WIDER than the place labels' for the opposite reason: those sit
   *  on flat land, and this sits next to the brightest line on the globe. A
   *  1 px halo disappeared into the magma glow. */
  plateLabelPx: 10.5,
  plateLabelHaloPx: 1.6,
  /** THE FLOOR FOR ANY LINE THAT MUST BE SEEN.
   *
   *  Sub-pixel lines are the other half of why the old grid vanished: at 0.5px
   *  a hairline is anti-aliased down to a fraction of its own colour before any
   *  opacity is applied — drawn, correct, and invisible.
   *
   *  A NUMBER THE CODE APPLIES, NOT A WARNING SOMEONE HAS TO REMEMBER TO READ.
   *  It was prose in this comment until a SCALED width slipped under it: a
   *  width derived from a safe one is not automatically safe, and the derivation
   *  is exactly where nobody thinks to check. Nothing is currently near the
   *  floor — it is a guard, and a guard that never fires is a guard doing its
   *  job. */
  hairlineFloor: 1.0,

  /* (`graticuleWidth`, the minor-grid width, retired with the grid.) */
  graticuleWidthMajor: 1.4,

  /** 3D clear-globe node sprite size, in world units (Three PointsMaterial,
   *  sizeAttenuation on). The glowing cyan LEDs riding the geodesic cage; they
   *  take their storm's category color as they rise.
   *  Shrunk 0.09 → 0.07 when the cage went to geoDetail 3 — denser lattice,
   *  same total glow budget. */
  node3dSize: 0.048,

  /** Storm glyph sprite on the 3D globe surface (planet band, SPEC §9): the
   *  app's own logo mark, tinted per category.
   *
   *  ==> SCREEN PIXELS, NOT WORLD UNITS, and that is the whole change. <== This
   *  was `stormDot3dSize: 0.17` in globe radii with `sizeAttenuation` on, so the
   *  mark grew with every zoom step — tiny at the space floor, where the whole
   *  planet is on screen and a storm most needs finding, and enormous by the
   *  time it faded out. A storm marker is a LABEL: it says "a cyclone is here",
   *  never "the cyclone is this big". Extent is the wind field's job and the
   *  cone's, both of which are real measurements.
   *
   *  40 is what the mark measured on a phone at the zoom where it was most
   *  visible, so the fixed size matches the largest it ever legibly got rather
   *  than the smallest. **Tune this on glass, not here** — it is one number and
   *  the whole read depends on it.
   *
   *  Three multiplies this by the renderer's pixel ratio for
   *  `sizeAttenuation: false`, so it is CSS pixels and stays honest on a 3x
   *  phone. Well under WebGL's point-size ceiling even at 3x. */
  stormDot3dPx: 40,

  /** Edge of the square canvas the glyph is rasterised into, before it becomes
   *  a `THREE.CanvasTexture`.
   *
   *  ENOUGH FOR THE SPRITE AT 3x AND THEN SOME. At `stormDot3dPx` 40 on a 3x
   *  phone the sprite covers 120 device pixels, so 128 was exactly break-even
   *  and any upward tune of the size above would have started sampling a
   *  texture smaller than the quad — soft arms, on the one mark that has to
   *  stay crisp. 256 buys headroom to roughly double the glyph before that
   *  happens, for two textures of a quarter-megabyte each, built once per
   *  theme. */
  glyphTexturePx: 256,
});

/** Layer opacities. Separated from color so a layer can be dimmed without
 *  touching its §6 severity hue. */
export const OPACITY = Object.freeze({
  coastGlow: 0.35,
  coastCore: 0.95,

  /** POPULATION HEAT. Deliberately shy of opaque: this layer draws UNDER every
   *  storm layer, and a cone read through it must still read as a cone. If it
   *  ever competes with the track for attention the number is too high, not
   *  the color wrong. */
  populationHeat: 0.72,

  /** PLATE BOUNDARIES — the same stack, at HALF the strength it first shipped
   *  at, because `SIZE.plateWidthScale` quadrupled the area each line covers.
   *
   *  The two move together and always will: opacity is per-pixel and the width
   *  decides how many pixels there are, so widening without dimming turns a
   *  reference layer into the loudest thing on the globe. The coast is the
   *  primary structure; this is the diagram underneath it and reads second.
   *  Together with the width scale this is the non-colour half of telling the
   *  two apart — see the note on `plateWidthScale`. */
  plateGlow: 0.34,
  plateCore: 0.55,
  /** THE SUPERHEATED CORE — full strength, and it has to be.
   *
   *  This is the layer that makes the seam read as molten instead of orange, and
   *  it only works because it is the ONE thing in the stack that is not dimmed:
   *  a bright hard line inside two soft dim ones is what hot looks like. Dim it
   *  and you have a third body layer and no core. The restraint that keeps it
   *  from shouting is width and the zoom ramp in `plateLayers`, not opacity —
   *  it is roughly a fifth the width of the body and held back to a quarter
   *  strength at the planet band.
   *
   *  1.0 also means this value is multiplied by the dive crossfade and nothing
   *  else, so the number here IS the number on screen once you are past the
   *  regional band. */
  plateHot: 1.0,
  /* Raised from 0.34. See the colour note in DARK — this is multiplied by the
   * dive crossfade before it ever reaches the screen, so the number here is
   * not the number you see. (`graticule`, the minor-grid opacity, retired with
   * the grid itself.) */
  graticuleMajor: 0.62,
  landFill: 1.0,

  /** Land fill at the planet band, for the Protomaps schema where land is a
   *  real polygon that can be faded. Continents dissolve up to full `landFill`
   *  by the regional band (SPEC directive). On the OpenFreeMap scaffold land is
   *  the background and this is done with `landFaint` color instead. */
  landFillPlanet: 0.15,

  /** 3D clear globe (SPEC §2). Near continents near-solid; FAR continents
   *  dimmer so they read as "behind" through the clear ocean; coast, cage, and
   *  nodes layered over. Node peak is full — the nodes ARE the signal. These
   *  are the AT-REST opacities; the dive fades them via DIVE.fade choreography. */
  land3dFront: 0.92,
  /** ADDITIVE (see matLandBack in globe3d.js) — 0.60 → 0.35. Additive blending
   *  over a dark basemap reads brighter than normal blending at the same
   *  number, so the old value would glow. Raise it if the far continents are
   *  too faint to read; lower it if they compete with storm geometry. */
  land3dBack:  0.35,
  coast3d:     0.55,
  cage:        0.3,   // dimmed 0.46 → 0.3 with the detail-3 lattice: twice the
                      // edges at the old opacity read as a solid gold shell

  /** Storm-lit triangle fill (SPEC §9) — the wash inside every cage triangle
   *  holding at least one storm-lifted corner. A PEAK: each corner is scaled
   *  again by its own lift, so only the heart of a storm reaches this number
   *  and the boundary fades to nothing. Deliberately low — the fill is a hint
   *  that something is there, not a second severity reading. The lattice and
   *  the glyph remain the signal. Set to 0 to retire the fill outright. */
  meshFill:    0.16,

  node:        0.85,
  stormDot3d:  0.95,

  ghost: 0.4,
  disabled: 0.38,
});

/* ---------------------------------------------------------------------------
 * SELECTED-STORM GEOMETRY (Phase 4 — cone, tracks, points, stripe)
 *
 * One block so the whole selection overlay is tuned in one place. These are
 * MAP styling values (colors, widths, dashes) — behavioral thresholds like
 * zoom gates stay in constants.js.
 *
 * The cone and tracks are deliberately NEUTRAL, not category-colored: severity
 * already rides the glyph and the forecast points (SPEC §6 — color carries
 * severity). A category-tinted cone would shout over its own dots.
 * ------------------------------------------------------------------------- */
export const STORM_GEO = Object.freeze({
  coneFillOpacity: 0.08,      // a veil, not a shape — the track reads through it
  coneLineOpacity: 0.35,
  coneLineWidth:   1.25,

  /** The dash contract, deliberately NOT the usual cartographic reading.
   *  The forecast is the question everyone opened the app to answer, so it
   *  gets the solid, confident line; observed history is quieter context and
   *  reads as a dotted trail. Uncertainty is carried by the cone, which is
   *  the honest place for it.
   *
   *  The COLORS these widths belong to are theme-dependent and live in
   *  `DARK.geo` / `LIGHT.geo` above. Widths and dashes do not change with the
   *  theme; the colors do. */
  trackForecastWidth: 1.75,                  // solid = where it's going
  trackPastWidth:     1.5,
  trackPastDash:      Object.freeze([1, 2]), // dotted = where it's been

  /** Forecast points: SS-colored circles (color computed per feature from
   *  NHC's own `ssnum` — reported, never derived). Sized to carry a one- or
   *  two-character classification code INSIDE the dot ("TD", "TS", "1".."5"),
   *  which is why the radius is well above a plain marker's. The dark stroke
   *  (`geo.pointStroke`) keeps a yellow Cat 1 point readable over the cone
   *  veil on lit land — and over a daytime ocean. */
  pointRadius:      10,
  pointStrokeWidth: 1.5,

  /** The earliest forecast point's ring — white (`geo.pointStrokeFirst`) and
   *  wider, marking which end of the dot chain the storm is travelling AWAY
   *  from. Wider because colour alone is not enough: at this radius a 1.5 px
   *  ring is a hairline, and a white hairline against a pale Cat 1 fill would
   *  disappear into exactly the case it exists to disambiguate.
   *
   *  IT GROWS OUTWARD, NOT INWARD. MapLibre draws `circle-stroke-width`
   *  outside `circle-radius`, so the fill and the classification code inside
   *  it are untouched and the marked dot stays the same size as its
   *  neighbours where it counts. */
  pointStrokeWidthFirst: 3,

  /** The code drawn inside the point. Size only — the color is
   *  `geo.pointCodeColor`. No halo: the dot itself is the backdrop. */
  pointCodeSize:   11,

  /** Forecast time labels (`datelbl`, shown verbatim — no reformatting). */
  labelSize:      11,
  labelHaloWidth: 1.4,
  /* No static offset and no static rotation: both are per-feature, computed
   * in map/layers/label-placement.js from LABEL_PLACEMENT. The label is
   * rotated onto the spoke, so `labelSize` is also the unit `text-offset`
   * is measured in — a change here rescales the gap to the dot. */

  /** Watch/warning coastal stripe: ONE solid stroke, no glow. Color is
   *  per-feature from WATCH_WARNING_COLOR (§6 — fixed contract). Width
   *  doubled 2026-07-24 after Aaron confirmed the band select on glass —
   *  at 4px the painted coast read as a line; at 8px it reads as the shore
   *  itself under warning. The glow underlay was killed the same day: at
   *  this width the line needs no help being found, and the blur made the
   *  paint look less precise than it is. */
  stripeWidth:        8,
  stripeOpacity:      0.9,

  /** WIND FIELD (Phase 6 step 2) — three nested bands, colors from the §6
   *  fixed contract in WIND_BAND_COLOR. These are the only tunable values;
   *  the hues are not themeable and are not here.
   *
   *  FILL IS DELIBERATELY WEAK. Three nested translucent polygons stack:
   *  where the 64 kt core sits inside the 50 and the 34, the pixel carries
   *  all three fills. At 0.18 each that compounds to roughly 0.45 at the
   *  core — present, but still letting the coastline and the storm's own
   *  glyph read through. Raising this is the first thing to try if the
   *  bands look weak on a phone, and the first thing to LOWER if the map
   *  turns to soup with several storms up (§14 note).
   *
   *  The outline carries most of the legibility: a clean edge reads as a
   *  threshold boundary far better than a stronger wash, and it survives
   *  the compounding above without muddying. */
  windFillOpacity:  0.18,
  windLineWidth:    1.25,
  windLineOpacity:  0.75,

  /** MODEL GUIDANCE TRACKS (Phase 6 step 5). Colors are per-model identity
   *  from MODEL_COLOR (§6, fixed contract) and are not here; these are the
   *  weight and rhythm that place guidance BELOW the official track in the
   *  visual hierarchy.
   *
   *  THINNER AND DASHED, DELIBERATELY. The forecast track is solid at 1.75
   *  and the past track dotted at 1.5 (see the dash contract above). A model
   *  run is an INPUT to NHC's forecast, not a peer of it, and drawing it at
   *  the same weight would read as five competing official forecasts. The
   *  hierarchy is the honesty here — get it wrong and the layer misrepresents
   *  authority while looking perfectly legible.
   *
   *  A LONGER DASH THAN THE PAST TRACK'S DOTS, on purpose: at the zoom where
   *  both are on screen, [1,2] dots and a short dash turn into the same grey
   *  texture, and the two mean completely different things. */
  modelLineWidth:   1.1,
  modelDash:        Object.freeze([3, 2]),

  /** Five lines crossing is a hairball at full strength. Held back so the
   *  cluster reads as a SHAPE — where the models agree, the overlap darkens
   *  and the eye finds it — rather than as five equally loud claims. First
   *  dial to raise if the spread is hard to see on a phone, and the first to
   *  lower if the map goes to soup with several models on. */
  modelLineOpacity: 0.7,
});

/** Elevation — panels float over the globe, nothing takes the full screen. */
export const Z = Object.freeze({
  globe: 0,
  statusStrip: 20,
  panel: 30,
  controlCluster: 40,
  focusOverlay: 50,
});

/**
 * How hard the finished disc is pushed into the map.
 *
 * FULL STRENGTH, and that changed with the colour knockout. It used to be 0.82
 * so a cone and a track could read across a disc that covered the whole box.
 * The knockout keys on colour, so warm ground and clear sky now draw NOTHING —
 * there is far less disc to see through, and muting what survives only moves it
 * back towards the washed-out look the knockout was written to fix.
 *
 * The one dial for "the storm is too loud under the geometry". Separate from
 * the knockout itself: the knockout decides WHICH pixels exist, this decides
 * how loud all of them are.
 */
export const IMAGERY_OPACITY = 1.0;
