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
 * ocean `#C2C6CA`, composited at the layer's own 0.7 opacity:
 *
 *     HFSA #FFAB40  1.09:1        NEMN #4DD0A0  1.11:1
 *     TVCN #00E5FF  1.04:1        AVNO #B388FF  1.36:1
 *
 * 1.04:1 is not "washed out", it is very nearly the same luminance as the sea.
 * Reported on glass by Aaron 2026-07-28 and confirmed by the numbers above.
 *
 * (Re-measured 2026-08-08 against the greyscale ocean. The old sea was
 * `#9DBDD6` and the four numbers were 1.00 / 1.00 / 1.15 / 1.25 — a shade
 * better now and still nowhere near legible, which is the point. Nothing about
 * the light set needed to move.)
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

  /** A SWITCH IN ITS ON STATE. Was literally `--focus-ring`, and the two are
   *  different states that can both be true at once — the same argument the
   *  segmented control's note makes three lines up, which this had somehow
   *  escaped. Same cyan as before in the dark theme, so nothing moves here; it
   *  simply has a name now, so the light theme could stop being blue without
   *  dragging the focus ring with it. */
  switchOn:       '#5FE0F5',

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

  /** THE BUTTON'S EDGE, and the colour of the manual-install HEADING.
   *
   *  Exists because the light theme needed the fill and the boundary to be two
   *  different jobs (see the long note on LIGHT.installCtaEdge). Dark does not
   *  need it — `#F0B23C` on a night panel has all the edge it will ever want —
   *  but it gets one anyway, at a value just inside the fill, because a token
   *  that exists in one palette and not the other is a null waiting to be read.
   *  Quiet here, load-bearing there. */
  installCtaEdge: '#C98A1E',

  /* ---------------------------------------------------------------------
   * THE FORECAST-ERROR BAND on the home dashboard's chart.
   *
   * AMBER, AND SPECIFICALLY NOT `stale` AND NOT A CATEGORY COLOUR. It is a
   * hedge, not a severity and not an age: a wide band over a Cat 1 is not a
   * worse storm, and a wide band on a fresh advisory is not old data. Both of
   * those readings would be wrong, and both are what borrowing an existing
   * amber would invite — so this is its own name, and moving `stale` never
   * moves it.
   *
   * NOT RED EITHER, for the reason §6 reserves red: red means something is
   * broken. A forecast that admits its own error is the opposite of broken.
   *
   * TWO TOKENS BECAUSE THE FILL AND THE EDGE DO DIFFERENT JOBS. The ribbon
   * lies over the chart's own gridlines and the distance curve, so its fill
   * has to be faint enough to read through; the dashed edge is what actually
   * says where the band ENDS, and it carries the contrast. One token at one
   * opacity cannot do both without either hiding the curve or losing its own
   * boundary. */
  homeBandFill: 'rgba(224, 169, 60, 0.14)',
  homeBandEdge: '#C98A1E',

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
  /* THE SPACE BACKDROP IS A RADIAL GRADIENT, NOT A COLOUR — `#spacebg` in
   * index.html runs near -> space -> far from 42%/30% out to the corners.
   *
   * ==> THE THREE STOPS USED TO SPAN ABOUT FOUR PERCENT OF LUMINANCE AND THE
   * RESULT WAS A FLAT BLACK RECTANGLE. <== #0A1626 to #02040A is a gradient on
   * paper and nothing on a screen: the mechanism was right and the numbers
   * never made it visible. Widened 2026-08-08 so the near stop reads as
   * genuinely lit and the corners genuinely fall away. Reported on glass as
   * "the background has no depth", which is what a correct gradient with no
   * range looks like from the outside.
   *
   * `space` ITSELF IS UNCHANGED, and deliberately: it is also the Three.js
   * scene background and fog colour, so it is the value the globe's limb
   * dissolves into. Moving it moves the horizon. The two ENDS are free. */
  space:          '#04070E', // deep space behind the 3D globe (Three bg + fog)
  spaceNear:      '#0F1F38', // lit near-stop — where the light falls. Widened
                             // from #0A1626, then brought back down a notch on
                             // glass: 1.43:1 near-to-far read as a spotlight,
                             // 1.26:1 reads as depth. The window between "no
                             // gradient" and "too much" is narrow here because
                             // the whole range lives in the bottom 5% of
                             // luminance, where small steps are large ones.
  spaceFar:       '#010308', // darkest outer stop, at the corners

  /* Chrome — glass panels floating over the globe */
  /* Lowered with the light theme's, same reason and same day: the panels should
   * feel like they are floating over the planet rather than covering it.
   *
   * DARK HAS MORE ROOM HERE THAN LIGHT DOES. Lowering the alpha pulls the panel
   * toward the ocean, and the dark ocean (#070D18) is DARKER than the panel —
   * so light text on it gains contrast as this drops. In the light theme it
   * loses contrast, which is why that end sits at the floor and this one does
   * not. Check tools/contrast-check.mjs either way. */
  glass:          'rgba(10, 20, 34, 0.30)',
  glassRaised:    'rgba(16, 30, 48, 0.44)',
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
  textCountry:    '#6B8098', // country names — the broadest label, and for the
                             // brief band it lives in (ADMIN.nameLadder) very
                             // nearly the only text on the map, so it can
                             // afford to sit above state names
  textPlace:      '#7A90A6', // major city names: a point you navigate by
  textInverse:    '#07121D',

  /** THE SCROLLBAR INSIDE A PANEL.
   *
   *  `color-scheme: dark` already tells the browser to render a DARK scrollbar
   *  — and it does, in the operating system's grey, which is the one surface in
   *  the app that was never ours. On a night-sky panel it reads as a piece of
   *  someone else's interface bolted to the side of ours.
   *
   *  Same hue family as `glassBorder`, because that is what it is: an edge on a
   *  glass panel that happens to move. Deliberately quiet — a scrollbar is an
   *  affordance, not information, and §6 keeps colour for severity. */
  scrollThumb:      'rgba(120, 190, 225, 0.26)',
  scrollThumbHover: 'rgba(120, 190, 225, 0.46)',

  /* State */
  focusRing:      '#5FE0F5', // always visible, never outline:none
  stale:          '#E0A93C', // aging data, 4-9 h
  error:          '#E85D5D', // source down / layer failed
  ok:             '#4FD18B',
  dim:            'rgba(232, 241, 248, 0.38)', // ghosts, unsupported rows

  /** How far a storm-lit node is pushed toward ink before it is drawn.
   *  ZERO IN DARK, and it has to be: additive blending over a near-black ocean
   *  already delivers the category colour at full strength, and deepening it
   *  would be spending contrast in the direction it is already going. The whole
   *  reasoning lives on LIGHT.meshStormDeepen; this end of the pair is the
   *  no-op that keeps the code path identical in both themes. */
  meshStormDeepen: 0,

  /** THREE.JS MATERIAL OPACITIES, AND THEY LIVE IN THE PALETTE BECAUSE THEY
   *  ARE NOT ONE NUMBER.
   *
   *  These were in OPACITY, shared by both themes, until 2026-08-08 — and a
   *  shared opacity is a bug the moment the two themes stop using the same
   *  BLEND MODE, which these did the day light mode landed. map/globe3d.js
   *  flips the cage, the nodes and the far continents from AdditiveBlending to
   *  NormalBlending in light, and those two operations do opposite things with
   *  the same alpha: 0.3 additive over near-black is a bright line, 0.3 normal
   *  over near-white is 30% of the way from the background toward the colour,
   *  which is a pale one. Same token, same value, inverted result — which is
   *  exactly how the light theme's mesh came to look washed out while every
   *  number in the file was "correct".
   *
   *  So the number moved to where the blend mode already is: the theme. The
   *  values below are the shipped dark ones, unchanged. LIGHT.fx carries its
   *  own, all higher.
   *
   *  Read them through `fx()` in config/theme.js, never held at module scope —
   *  same caching trap as `palette()` itself. */
  fx: Object.freeze({
    land3dFront: 0.92,
    land3dBack:  0.35,
    coast3d:     0.55,
    cage:        0.30,
    meshFill:    0.16,
    node:        0.85,
    stormDot3d:  0.95,
    /** STORM LIGHT ON THE BACKDROP (map/limb-glow.js). Emitted light on a
     *  night sky, so it can run high — there is a whole dark gradient of
     *  headroom above `space` for it to climb into, and the blobs `screen`
     *  onto it rather than covering it. */
    glow:        0.60,
    /** No chroma push in the dark theme. `screen` blending keeps the colour's
     *  own value, and a Cat 1's blue reading as a Cat 1's blue is the point.
     *  See LIGHT.fx.glowSaturate for why the other theme needs the opposite. */
    glowSaturate: 0,

    /** THE TWO SHAPE DIALS, THEME-OWNED, AND DARK'S ARE BOTH 1.0 ON PURPOSE.
     *
     *  `GLOW.intensity` and `GLOW.radiusScale` in config/constants.js are the
     *  shipped dark look, which Aaron has signed off on glass. Light needs a
     *  stronger version of the SAME effect, and the canvas opacity (`glow`
     *  above) has no headroom left to give it — so the two numbers that
     *  actually change the look get a per-theme multiplier instead of being
     *  raised globally and dragging dark along with them.
     *
     *  These are the no-ops that keep the code path identical in both themes.
     *  The reasoning for the real values lives on LIGHT.fx.glowGain. */
    glowGain:    1.0,
    glowSpread:  1.0,
  }),

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

    /** THE X INSIDE AN ENDED STORM'S DOT, AND THE ONE MARK WHOSE INK HAS TO
     *  FLIP WITH THE THEME.
     *
     *  Everywhere else the app gets away with one ink in both themes, because
     *  the thing behind the ink does not move: a forecast dot is a §6 category
     *  colour, fixed, so a near-black ring and a near-black code are right on
     *  all seven of them in daylight and at night.
     *
     *  `stormEnded` is the exception. It is BONE on a night globe (#DCE4EC)
     *  and a STRONG NEUTRAL on a daylight one, because "drained of colour"
     *  renders as near-white in the dark and as invisible in the light — see
     *  the long note on the token itself. The dot flips, so its ink must flip
     *  with it or the X lands on a disc of its own brightness. It did: at
     *  1.79:1 in the greyscale light theme the X was gone and the mark read as
     *  a plain grey dot, which is a §5 problem and not a cosmetic one — that X
     *  is the whole statement that a storm is over.
     *
     *  Near-black here, against the bone disc. 14.4:1. */
    endedMark:      '#0B1420',

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
 * LIGHT — the daytime globe. GREYSCALE, and that is the whole design.
 *
 * ==> THE BASE IS NEUTRAL SO THE DATA CAN BE THE ONLY COLOUR ON SCREEN. <==
 *
 * This palette was blue-and-cream until 2026-08-08: a #9DBDD6 sea, a #E6E0D2
 * land, a #CFE1F1 sky, and a teal cage laid over all three. Four hues, none of
 * them carrying information, all of them competing with the one thing that
 * does. A Cat 1 yellow arriving on that globe had to out-shout a teal cage and
 * a blue ocean before it could say anything, and on glass it lost.
 *
 * So: OCEAN, LAND, SKY, CAGE, COASTLINE, BORDERS AND POPULATION ARE ALL
 * NEUTRAL GREY. Severity colour, and the storm-lifted cage that carries it,
 * are the only saturated things in the light theme. Nothing here should ever
 * gain a hue back without a reason that is about information.
 *
 * The three exceptions, and why each one keeps its colour:
 *   - `error` / `stale` / `ok` are STATUS VOCABULARY, read as words. Grey
 *     status text would say nothing and is the §5 failure this app exists to
 *     avoid.
 *   - `focusRing` is an accessibility affordance that appears one at a time and
 *     must never be mistaken for a border. A grey ring on a grey interface is
 *     a regression, greyscale intent or not.
 *   - `installCta` is dark mode's amber verbatim — Aaron's call, see below.
 *
 * WHAT THIS PALETTE STILL REFUSES TO INVERT:
 *
 *  - The cage, the coastline and the nodes go DARKER than their surface, not
 *    lighter. In the dark theme they are light lines glowing on a night sea;
 *    the equivalent statement on a pale sea is a dark line. Inverting their
 *    lightness numerically would have produced white lines on a white ocean.
 *
 *  - The chosen segment of a control goes DOWN in lightness and UP in edge
 *    strength. A step further toward white is a step toward invisible.
 *
 *  - The administrative furniture keeps its HIERARCHY, not its values:
 *    city > country > state > country lines > state lines > land, and every
 *    one of them still sits below the coastline.
 *
 * ==> THE OCEAN IS MID-GREY, NOT NEAR-WHITE, AND THAT IS DELIBERATE. <==
 * The inspiration for this theme is a near-white globe, and a near-white ocean
 * is exactly what made the old theme wash out: the §6 category ramp runs light
 * to mid, so a Cat 1 yellow over near-white has almost no luminance to spend.
 * Land is near-white and gets the paper feeling; the SEA carries the shading,
 * which is also where nearly every storm is. `space` stays near-white behind
 * it, so the globe separates from its own backdrop the way it does on a night
 * sky — just from the other direction.
 *
 * Every REQUIRED pair here is measured by tools/contrast-check.mjs. If a value
 * below changes, run it.
 */
export const LIGHT = Object.freeze({
  /* Globe body — one neutral ramp, land at the top of it, sea in the middle. */
  ocean:          '#C2C6CA', // daylight sea. Mid, not pale: this is the surface
                             // almost every storm is read against, so it is the
                             // one that has to leave luminance on the table.
  oceanDeep:      '#AAAFB4', // toward the limb, for depth
  land:           '#F1F1EF', // near-white land — paper. A hair warm against the
                             // faintly cool sea, which is the only remaining
                             // temperature difference in the palette and is
                             // there so the two read as different materials
                             // rather than as two greys.
  landHigh:       '#F8F8F6', // subtle relief at close zoom
  landFaint:      '#D6D8DA', // continents at the planet band: barely above the
                             // ocean, so the cage reads as the hero — the same
                             // rule as dark, pointed the other way

  /** ==> ON TRIAL: THE CAGE AND THE COASTLINE CARRY DARK MODE'S CYAN INTO THE
   *  LIGHT THEME. Aaron asked to see it, 2026-08-08. <==
   *
   *  These were grey for one deploy — the argument being that the cage is
   *  ~7,680 edges covering the whole planet, so whatever colour it rests at is
   *  by area the colour of the app, and a neutral base gives storm severity
   *  nothing to compete with.
   *
   *  ==> IT IS THE SAME HUE ANGLE AS DARK, NOT THE SAME HEX, AND THAT IS NOT A
   *  HEDGE. <== Dark's `#4FD1E8` on this grey sea measures 1.51:1 — it would
   *  fail the REQUIRED `coastline vs the ocean` pair in
   *  tools/contrast-check.mjs, which is a real gate and not a preference. A
   *  bright line glowing on a night sea becomes a dark line drawn on a pale
   *  one; the hue is what carries the identity across, and lightness is what
   *  has to move. So: same cyan family, walked down until it reads.
   *
   *  These are the EXACT values the light theme carried before the greyscale
   *  pass, so reverting the experiment is a straight swap back to the grey
   *  block in git history. Population heat comes with them — its top stop is
   *  asserted to equal `coastGlow`, so the two cannot split by accident. */
  mesh:           '#3D7F94',
  coastGlow:      '#0C5065', // the strong top line of the coastline stack
  coastGlowSoft:  '#4E93A8', // the wide soft underlay
  graticuleMajor: '#7E868D', // equator and the two tropics — still well under
                             // the coastline, still clearly above the water

  /* Population heat, neutral. DARKER as density rises, which is the inverse of
   * the dark theme's rising lightness — the rule is "further from the
   * background", and the background moved.
   *
   * This is REFERENCE FURNITURE, not live data: a static count of who lives
   * where. It gets no hue for the same reason the borders get none. The top
   * stop is still this palette's `coastGlow` exactly, which is the invariant a
   * test asserts — a future coastline recolour drags this with it instead of
   * quietly splitting the pair. */
  populationLow:  '#9FD0DC',
  populationMid:  '#3E8FA8',
  populationHigh: '#0C5065',

  /* Chosen segment of a segmented control. Down in lightness, up in edge
   * strength — see the header note. */
  segActive:      '#D9DCDF',
  segActiveEdge:  '#59626A',

  /** A SWITCH IN ITS ON STATE — grey, not blue.
   *
   *  It read `--focus-ring` until 2026-08-08, which made every switched-on
   *  toggle `#0B5FA0` and left a row of blue pills on a greyscale interface.
   *  The focus ring keeps its colour on purpose (it is an accessibility
   *  affordance that must never be mistaken for a border); a checked switch has
   *  no such claim and belongs to the neutral base.
   *
   *  WHAT CARRIES "ON" ONCE THE COLOUR STOPS DOING IT. Three things, and they
   *  were always the real signal: the thumb has TRAVELLED to the far end, the
   *  thumb goes from `textSecondary` to `textPrimary`, and `aria-checked` says
   *  so out loud. The track fill is reinforcement, which is why a light grey is
   *  enough — it is a filled track against an empty one, not a colour code.
   *
   *  It clears the off state (`glassRaised`, effectively white) by about 1.9:1
   *  and carries a `glassBorder` edge, which is the same reading of WCAG 1.4.11
   *  the chosen segment uses: the EDGE identifies the control, position and
   *  weight identify the state. Both numbers print in contrast-check's ADVISORY
   *  block so a future edit that flattens them is visible. */
  switchOn:       '#AEB3B8',

  /* ==> THE INSTALL CALL-TO-ACTION IS DARK MODE'S AMBER, EXACTLY, AND IT TOOK
   * A THIRD TOKEN TO GET THERE. <==
   *
   * This was `#9C5D06` — a dark amber, chosen because `#F0B23C` on a near-white
   * panel is about 1.6:1 and a button with no edge is not a button. Aaron asked
   * for the dark theme's yellow in both themes, and he is right that the CTA
   * should be one recognisable colour.
   *
   * The way to have both is to stop asking the FILL to do the job of the EDGE.
   * WCAG 1.4.11 asks that the control be identifiable against what is adjacent
   * to it; it does not ask that its fill be dark. So the fill is the yellow,
   * verbatim, and `installCtaEdge` — a dark amber of the same family — draws
   * the 1px boundary that makes it a shape. Both themes set the edge; in dark
   * it is a quiet inner line, in light it is what the button is found by.
   *
   * `installCtaEdge` is ALSO the colour of the manual-install HEADING, and that
   * is not a compromise, it is the rule. The heading is TEXT. `#F0B23C` as text
   * on white glass is unreadable at any size, and shipping it would be a §5
   * failure wearing a brand colour. Yellow where the amber is a shape, dark
   * amber where it is words. */
  installCta:     '#F0B23C',
  installCtaInk:  '#1A1206', // near-black, for text on the amber fill
  installCtaEdge: '#8A5100',

  /** The band, on a daylight globe. The fill is FAINTER than dark's, not
   *  stronger: the panel behind it is near-white and a translucent amber over
   *  white reads far heavier than the same alpha over a night panel — the
   *  same additive-versus-normal blending trap the mesh alphas hit in §9.2.
   *  The edge goes DARKER to keep the boundary legible against it, which is
   *  the same split of jobs as the install button's fill and edge. */
  homeBandFill: 'rgba(125, 81, 0, 0.10)',
  homeBandEdge: '#7D5100',

  node:           '#0C5065', // nodes: the signal, a step stronger than the cage
  meshStormMix: 1.0,
  meshRestDim: 1.0,

  /** ==> HOW FAR A STORM-LIT NODE IS PUSHED TOWARD INK BEFORE IT IS DRAWN.
   *  THE ONE PLACE THE LIGHT THEME TOUCHES A §6 COLOUR, AND IT IS ON PURPOSE.
   *
   *  §6 fixes severity colours so a Cat 3 reads the same everywhere. That
   *  contract lives on the MARKS — the glyph, the forecast dot, the legend
   *  swatch, the category chip. Every one of those is drawn opaque, at full
   *  strength, in both themes, and none of them is touched by this number.
   *
   *  The cage is not a mark. It is a semi-transparent FIELD drawn at
   *  `fx.cage` over a light surface, and normal blending toward a light
   *  background can only ever wash a colour out — that is the arithmetic, not
   *  a tuning problem. A field that is already a continuous grey-to-colour
   *  gradient is not making a category claim at any single pixel, so deepening
   *  it is not a claim being made wrongly.
   *
   *  0 in dark, where additive blending over near-black does the opposite and
   *  needs no help. THIS IS THE DIAL for "the storms do not pop enough in light
   *  mode" — raise it before touching opacity, which drags the resting cage up
   *  with it. Above roughly 0.35 the ramp starts collapsing toward one dark
   *  colour and severity stops being tellable apart. */
  meshStormDeepen: 0.18,

  stormPlanetDot: '#4A5259', // planet-band glyph in the OUTAGE state

  /** An ENDED storm's glyph and cage head — see the dark theme's note for why
   *  this steps outside the fixed category colours rather than breaking them.
   *
   *  ==> IT CANNOT MIRROR DARK'S NEAR-WHITE. "Drained of colour" renders as
   *  near-white on a night globe and would render as INVISIBLE on a pale
   *  daytime one, so here the same idea is carried by a strong neutral: no hue,
   *  clearly deliberate, obviously not one of the severity colours.
   *
   *  GREYSCALE MADE THIS TOKEN HARDER, NOT EASIER, and it is worth watching on
   *  glass. When the whole globe was teal, grey read instantly as "this one is
   *  different". On a grey globe the difference has to come from WEIGHT — this
   *  is darker than any furniture around it — and from the fact that every LIVE
   *  storm beside it is now vividly coloured with nothing else competing. That
   *  second half is new and should make it clearer, not worse, but nobody has
   *  looked yet. */
  stormEnded:     '#3A4149',

  /* 3D clear globe */
  land3d:         '#F4F4F2', // continents on the clear globe. Slightly LIGHTER
                             // than `land`, which reverses what this token said
                             // an hour ago — it was deeper, on the reasoning
                             // that a translucent surface over a pale backdrop
                             // needs to come down to stay visible. Correct, and
                             // then the backdrop became GREY (see `space`
                             // below), which flips the direction: the clear
                             // globe has no opaque ocean under it, so the
                             // backdrop shows through at 8% and drags the land
                             // toward grey. Starting a shade above `land`
                             // lands it back where `land` sits on the 2D map.
  coast3d:        '#5E656B', // coastline edge on the 3D land fill
  meshMuted:      '#9AA0A5', // cage when the storm feed is UNAVAILABLE
  nodeMuted:      '#646B71',

  /* Atmosphere — daylight, and no longer a blue one. The globe sits in a
   * near-white studio, which is what the reference image is: a lit object on
   * paper, not a planet in a sky. */
  skyHigh:        '#E9E9E7',
  skyLow:         '#D3D5D7',
  atmosphere:     '#9BA2A9', // rim light at the horizon
  /** No stars in daylight. Held near the sky rather than removed, so the
   *  starfield code path stays identical in both themes and there is no
   *  "if light, skip the stars" branch to forget. */
  starfield:      '#DEDEDC',
  /* ==> THE BACKDROP IS GREY, NOT WHITE, AND THE FIRST CUT HAD THIS BACKWARDS.
   *
   * It shipped near-white on the reasoning that the light theme is a lit object
   * on paper, so the paper should be pale. On glass the globe DISAPPEARED into
   * it: `land3d` is near-white too, so the continents at the planet band were
   * white on white and all that was left was the cage.
   *
   * The rule the dark theme follows is the one that was missing here. Space is
   * the darkest thing in dark mode, well below the ocean, and that is what
   * makes the limb an edge and the land a surface. Same rule, same direction:
   * the backdrop sits at roughly the ocean's value and the near-white land
   * reads against it.
   *
   * `spaceNear` is the soft bloom directly behind the globe, `spaceFar` the
   * falloff at the corners — the same structure dark mode uses with its lighter
   * blue near-stop, pointed at white instead. It is what keeps this from being
   * a flat grey rectangle. */
  space:          '#C2C6CA', // Three.js background and fog — the OCEAN's value
                             // exactly, so the backdrop and the sea agree and
                             // the limb is the only edge
  /* ==> LIGHT HAD DARK'S GRADIENT BACKWARDS, WHICH IS WHY TWO PASSES OF
   * "MAKE IT STRONGER" DID NOT HELP. <==
   *
   * `#spacebg` runs near at 0%, `space` at 60%, far at 100%. Measured in L*,
   * which is what the eye actually reads — a contrast RATIO understates a step
   * at the light end badly, and comparing the two themes by ratio is what hid
   * this:
   *
   *              near->space     space->far
   *     dark        +9.8            1.1        almost all of it behind the globe
   *     light       +5.7           11.4        almost all of it in the corners
   *
   * Dark spends its range where the globe is. Light spent its range where
   * nothing is, and the two earlier attempts raised the total without touching
   * the distribution — so the corners got darker and the part anyone looks at
   * stayed flat. Aaron reported "no gradient in light mode" three times, and he
   * was right every time.
   *
   * ==> THE TOKEN RANGE IS NOT THE VISIBLE RANGE, AND THAT IS MOST OF WHY THIS
   * TOOK FIVE PASSES. <==
   *
   * `#spacebg` is `radial-gradient(120% 120% at 42% 30%, near 0%, space 60%,
   * far 100%)`. At 120% the 100% stop lands well OUTSIDE the viewport, so the
   * darkest pixel anyone sees is around 83% of the way — roughly 58% of the
   * space-to-far delta. And `near` at 0% is a single point, already blending
   * toward `space` a few pixels out. Between them, better than a third of every
   * number written here never reaches the screen.
   *
   * The geometry is shared with dark, which looks right, so the compensation
   * belongs in these two values rather than in the gradient. That is why light's
   * numbers now look extreme next to dark's and are not.
   *
   * ==> AND LIGHT IS PUSHED PAST DARK'S PROFILE ON PURPOSE, AT AARON'S ASK:
   * +17.3 near-to-space and -14.4 space-to-far, against dark's +9.8/-1.1.
   *
   * That is not an inconsistency, it is the same correction as the chroma note
   * above pointed at the other axis. A given L* step is a SMALLER perceptual
   * event at the light end than at the dark end, so matching dark's numbers
   * exactly produced a bloom that measured identical and read as weaker. The
   * profile — most of the range behind the globe, little in the corners — is
   * what had to match. The magnitude is tuned to the eye, and the eye is his.
   *
   * `space` itself does not move: it is the Three.js fog and scene background,
   * so it is the value the limb dissolves into.
   *
   * ==> THE COST, KNOWINGLY TAKEN AND THE FIRST THING TO CHECK IF THE LAND
   * DISAPPEARS. <== The bloom is now BRIGHTER than the land: `land3d` is L* 96.1
   * against this stop's 97.0. Inside the bloom the continents are carried
   * entirely by `coast3d` (4.77:1 against them) and read as slightly darker than
   * the sky behind them, which is what a backlit limb does. Against `spaceFar`
   * at the corners they have 33 L* and read easily.
   *
   * If that reads as broken rather than as lit, the lever is `land3d` DOWN — a
   * light grey continent against a white sky. Bringing the bloom back down is
   * the thing that has now been rejected three times; do not reach for it. */
  /* ==> COOL, NOT JUST LIGHT, AND THAT IS THE HALF THAT WAS MISSING. <==
   * Dark's near stop is NAVY against a near-black field — a hue shift, which
   * is why it reads as a glow rather than as a grey patch. Light's was neutral
   * on neutral, and a lightness-only lift at L* 89 is very nearly invisible:
   * matching dark's L* PROFILE (see below) got the geometry right and still
   * looked like nothing.
   *
   * Same L* as before, real blue chroma added. Costs nothing against the land,
   * because the land separation is a lightness question and lightness did not
   * move. */
  spaceNear:      '#EFF7FF', // lit near-stop: a cool near-white bloom
  spaceFar:       '#97999B', // falloff at the outer corners

  /* Chrome — glass panels floating over the globe */
  /* ==> WHAT THE CONTRAST NUMBERS DO NOT COVER, AND WHY THIS IS ABOUT AS FAR AS
   * IT GOES. <== Every pair in tools/contrast-check.mjs composites the panel
   * over `ocean` — a flat, known colour. A real panel sits over whatever the
   * map is drawing, and at these alphas that includes a radar cell in full
   * rainbow. The measured 4.99:1 is the number over open water; over a red
   * echo it is whatever the echo allows. Lowering further trades a legible
   * panel during the one situation the app exists for.
   *
   * MORE TRANSLUCENT THAN THEY FIRST SHIPPED, and now the same alphas the dark
   * theme uses. There was no reason for the two to differ — light started at
   * 0.82/0.93 simply because a pale panel over a pale globe looked thin, which
   * the greyscale ocean fixed by giving it something to sit on. Aaron's call on
   * glass; the panels should feel like they are floating over the planet, not
   * covering it.
   *
   * ==> THIS IS THE FLOOR, NOT A DIAL TO KEEP TURNING. <== Every text pair in
   * tools/contrast-check.mjs is measured against the COMPOSITE — the panel over
   * the ocean, not the panel's own colour — so dropping the alpha spends real
   * contrast. Muted text on plain glass is the first to go. Check the numbers
   * before lowering these again. */
  glass:          'rgba(252, 252, 251, 0.38)',
  glassRaised:    'rgba(255, 255, 255, 0.52)',
  glassBorder:    'rgba(28, 32, 36, 0.18)',
  glassShadow:    'rgba(20, 23, 26, 0.20)',

  /* Text */
  textPrimary:    '#15181B',
  textSecondary:  '#414850',
  textMuted:      '#565D64',

  /** ADMINISTRATIVE FURNITURE (§11) — same hierarchy, inverted direction, and
   *  now with the last of its warmth removed. Every value sits BELOW the
   *  coastline, approaching the land colour from below rather than from above. */
  adminState:     '#CDCDCA', // state / province divides — barely off land
  adminCountry:   '#A7A7A3', // national borders — one step up, still quiet
  textCountry:    '#5C636A', // country names — the broadest label
  textPlace:      '#434A51', // major city names: a point you navigate by
  textInverse:    '#F7F7F5',

  /** The scrollbar inside a panel — see the note on DARK.scrollThumb. Neutral
   *  here like everything else in this palette, and drawn from `glassBorder`'s
   *  ink for the same reason: it is a moving edge on a glass panel. */
  scrollThumb:      'rgba(28, 32, 36, 0.26)',
  scrollThumbHover: 'rgba(28, 32, 36, 0.46)',

  /* State. The three status colours and the focus ring are the only saturated
   * values in this palette — see the header for why each one earns it. */
  focusRing:      '#0B5FA0',
  stale:          '#7D5100',
  error:          '#A81E16',
  ok:             '#0B6B3D',
  dim:            'rgba(21, 24, 27, 0.55)',

  /** THREE.JS MATERIAL OPACITIES, THEME-OWNED — see the note on DARK.fx for why
   *  these cannot be one shared set. Every number here is higher than dark's
   *  counterpart, and none of it is a taste decision: dark blends ADDITIVELY
   *  onto near-black and light blends NORMALLY onto near-white, so the same
   *  0.3 that glows on a night globe is "30% of the way from white toward the
   *  colour" in daylight. This is the block that fixes the washed-out mesh. */
  fx: Object.freeze({
    land3dFront: 0.92,
    land3dBack:  0.55,
    coast3d:     0.70,
    cage:        0.70,
    meshFill:    0.40,
    node:        0.95,
    stormDot3d:  1.0,
    /** STORM LIGHT ON THE BACKDROP — and LOWER than dark's, which is the one
     *  place this pair inverts the usual rule that light's alphas run higher.
     *
     *  Everywhere else in `fx` the higher light number compensates for normal
     *  blending being weaker than additive. Here the mechanism is `multiply`,
     *  which is not weaker — it is the most aggressive of the three. A
     *  saturated category colour multiplied into mid-grey lands as deep ink
     *  very fast, and at dark's 0.60 a Cat 4 puts a bruise on the backdrop
     *  rather than light through glass.
     *
     *  ==> TWO PASSES WENT THE WRONG WAY BEFORE THE OPERATOR CHANGED. <== At
     *  0.30 with `multiply` it was invisible; deepening the colour to give the
     *  filter something to subtract made it a dark smudge. Both were correct
     *  about the mechanism and wrong about the goal — `multiply` can only
     *  darken, and a dark patch on a bright surface is a smudge by definition.
     *
     *  The blend is `color` now (map/limb-glow.js), which tints the backdrop
     *  and cannot touch its brightness. That frees this number to run HIGH:
     *  it is now "how much hue soaks in", and the failure at the top of the
     *  range is garish rather than dirty.
     *
     *  0.75 -> 0.94 on glass, at Aaron's ask, once the operator was right.
     *  THERE IS ALMOST NO ROOM LEFT ABOVE THIS: at 1.0 the tint is the storm's
     *  hue at full chroma with none of the backdrop's own colour surviving, so
     *  the gradient stops showing through the light entirely. If it still
     *  wants more after this, the honest next dial is `GLOW.intensity` or the
     *  blob radius, not this one. */
    glow:        0.94,

    /** Push the storm colour to full chroma before tinting.
     *
     *  `color` blending keeps the BACKDROP'S luminosity and reads only hue and
     *  saturation from the source, so the colour's own value is discarded
     *  downstream and there is nothing to lose by saturating it. The §6
     *  category ramp runs pale, and a pale source under `color` is a pale
     *  tint — this is what gives the light something to be.
     *
     *  Hue is untouched at any value, so a green storm throws green. Lower it
     *  if the tint reads as garish; it cannot make the light muddy, only
     *  weaker. */
    glowSaturate: 1.0,

    /** ==> THIS IS WHERE LIGHT MODE'S GLOW GETS BIGGER, BECAUSE `glow` ABOVE
     *  IS OUT OF ROOM. <==
     *
     *  `glow` is the canvas opacity and it is already at 0.94 with a ceiling
     *  of 1.0 — six percent is not a change anyone sees. `glowSaturate` is
     *  pinned at full chroma. Both of the dials that are LEFT live in
     *  config/constants.js and are shared with dark, which is signed off, so
     *  they get a multiplier here rather than a raise there.
     *
     *  `glowGain` multiplies the per-blob alpha ceiling (`GLOW.intensity`).
     *  Under `color` blending that alpha is "how much of the storm's hue soaks
     *  into the backdrop", so raising it is more colour, never less light —
     *  the failure at the top is garish, not muddy. The alpha is clamped at 1,
     *  which means a gain above 1 saturates the strongest storms first and
     *  lifts the weak ones proportionally. That is the right shape: a Cat 5
     *  should be able to max the channel out.
     *
     *  `glowSpread` multiplies the blob radius (`GLOW.radiusScale`). More area
     *  of tinted backdrop is the half of "more glow" that alpha cannot buy.
     *  Its own note warns that past about 1.4 effective the lights stop
     *  reading as coming FROM the globe and start looking like weather on the
     *  camera lens — 1.15 x 1.2 lands at 1.38, deliberately just inside that.
     *  Do not raise this one without checking the limb on a phone. */
    glowGain:    1.3,
    glowSpread:  1.2,
  }),

  /** Themed storm geometry. The cone and the tracks flip to ink; the dot ring
   *  and the code inside it do NOT (see the note on DARK.geo.pointStroke) —
   *  a dark ring is correct on both a night sea and lit daytime land, and one
   *  ink is one contract. */
  geo: Object.freeze({
    coneFill:       '#1E242A',
    coneLine:       '#1E242A',
    trackForecast:  '#14191E',
    trackPast:      '#5C646B',

    pointStroke:    '#0B1420',
    pointCodeColor: '#0B1420',

    /** See the note on DARK.geo.pointStrokeFirst — one ink, both themes.
     *  `tools/test-first-point.mjs` asserts this equals DARK's, because
     *  `map/layers/points-forecast.js` now BAKES it rather than reading global
     *  state, and it is only allowed to do that while the two agree. */
    pointStrokeFirst: '#FFFFFF',

    labelColor:     '#191E24',
    labelHalo:      '#F6F6F4',
    stormLabelHalo: '#F6F6F4',

    /** WHITE, and see the note on DARK.geo.endedMark for why this is the one
     *  ink in the app that flips. The light theme's ended dot is a dark
     *  neutral, so the X on it has to be light — the near-black used in dark
     *  mode measured 1.79:1 here, which is a mark that is drawn and cannot be
     *  seen. 10.3:1 now. */
    endedMark:      '#FFFFFF',

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
  /** ==> HOW FAR THE GLASS BLURS WHAT IS BEHIND IT, AND WHY IT WAS THE REAL
   *  REASON THE DRAWER NEVER LOOKED TRANSLUCENT. <==
   *
   *  Three passes lowered `glass` from 0.82 to 0.38 and Aaron reported no
   *  change each time. He was right: at `blur(18px)` the backdrop is smeared
   *  into a flat wash before it is composited, so a lower alpha lets more of
   *  a FLAT WASH through and the panel looks exactly as solid as before.
   *  Alpha decides how much backdrop you get; blur decides whether any of it
   *  is recognisable. Translucency you can SEE is the second one.
   *
   *  18 -> 8. Enough to calm a busy backdrop, little enough that the cage
   *  reads through the panel and it is obviously glass over a globe.
   *
   *  THE COST IS LEGIBILITY OVER TEXTURE, and it is the same caveat as the
   *  alpha: tools/contrast-check.mjs composites over `ocean`, a flat colour.
   *  A blur is what protected text from a backdrop that ISN'T flat — a radar
   *  cell, a lit mesh peak. Less blur plus less alpha spends that twice. This
   *  is the pair to raise first if a panel becomes hard to read over weather.
   *
   *  Raw literals until 2026-08-08, in five files, which is how they went
   *  unnoticed while the token beside them was tuned four times. */
  glassBlur:       '8px',
  /** Raised surfaces — the pill, the nudge, the inline sheets. Tighter than
   *  the drawer's because they are small and sit directly over the map. */
  glassBlurRaised: '6px',

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
  countryLabelPx: 11.5,       // country names — broadest label of its band
  /** State / province names — the LARGEST place label on the map, and set in
   *  the app's only bold fontstack (map/style.js). A state is an area, not a
   *  point: it has to read as the thing a city sits INSIDE, and weight plus
   *  size is how that is said without spending a second colour on it.
   *
   *  Bigger than `countryLabelPx` on purpose. The two barely share the screen —
   *  country names are fading out over the same zooms state names rise (see
   *  ADMIN.nameLadder) — so the ladder is a handoff, not a stack, and the label
   *  that owns the band you actually watch a landfall in should be the big one. */
  stateLabelPx: 12.5,
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

  /** A WATCHED AREA'S GLYPH at the planet band (§45.4, map/watch-marks.js).
   *
   *  DELIBERATELY SMALLER THAN THE STORM GLYPH. A maybe must not compete with
   *  a certainty for the eye, and on a busy globe the storms are the answer to
   *  the question most people opened the app with. Small enough to recede,
   *  large enough that the hatch still reads as strokes and the edge still
   *  reads as broken — below about 24 px both close up and the mark turns into
   *  a solid blob, which is the one thing it must never look like, because a
   *  solid blob is what a storm is. */
  watchGlyph3dPx: 30,

  /** Its texture. Smaller than `glyphTexturePx` because this is a handful of
   *  strokes rather than five filled outlines — 128 covers the 30 px sprite
   *  with headroom and costs a quarter of the memory. */
  watchTexturePx: 128,

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

  /** PEAK STORM SURGE — TRANSLUCENT, AND THE REASON REVERSES AN INHERITED ONE.
   *
   *  The HA project made these OPAQUE because half-transparent bands "stacked
   *  into mud" wherever two overlapped, and that reasoning was carried here
   *  unexamined. It does not hold, for two measured reasons: MapLibre stacks
   *  by `fill-sort-key` so the worst severity always takes the pixels, and
   *  Milton's areas are adjacent rather than overlapping — 14 polygons at
   *  advisory 017 with two interior rings between them.
   *
   *  ==> WHAT OPACITY ACTUALLY COST WAS THE GAPS. <== NHC's polygons have
   *  concave pockets and fingers with dry ground between them. Painted solid,
   *  every one of those is a black hole punched in the middle of the water,
   *  and the coastline showing in them reads as a rendering fault rather than
   *  as dry land. Translucent, the basemap shows through EVERYWHERE evenly, so
   *  a pocket is simply less saturated instead of a hole. Aaron's call on
   *  glass, and it is the fix for the "cyan poking out" complaint too. */
  surgeFill: 0.55,

  /** The band's own edge, stronger than its fill so each area keeps a defined
   *  boundary once the interior goes translucent. Without this a 0.55 fill
   *  next to another 0.55 fill has no border at all and the severity step
   *  between them softens into a gradient — which is exactly the thing §6
   *  says a severity contract may not do. */
  surgeEdge: 0.9,

  /** THE DILATION STROKE, in pixels — and it is now doing TWO jobs.
   *
   *  It still rescues hairline features. It is also the only gap-bridging
   *  available: a same-colour stroke grows every shape by half its width, so
   *  a dry pocket narrower than this closes up from both sides at once.
   *
   *  A true morphological close (dilate then erode, so the OUTER edge returns
   *  to size) would be better and is not shippable — it needs a real polygon
   *  buffer, which means a heavy dependency in a no-build-step app, and doing
   *  it only in the fixture builder would make the fixture lie about what
   *  production draws. This is the honest approximation: the outer edge grows
   *  by ~1.5 px, which the translucent fill makes far less visible than it was
   *  at opacity 1.
   *
   *  ==> TUNING KNOB. <== Higher closes bigger pockets and fattens narrow
   *  channels; 4 welded the St. Johns River's two banks into a slab. */
  surgeDilatePx: 3,

  /** HOW FAR THE COASTLINE DIMS WHILE SURGE IS SHOWING.
   *
   *  ==> THE LAST OF THE "CYAN POKING OUT" IS NOT A SURGE PROBLEM. <== The
   *  coast on this schema is the land polygon's EDGE, drawn as a bright core
   *  under a wide blurred halo. Two things follow that no amount of paint on
   *  the surge layer can fix: the halo bleeds OUTWARD past wherever the surge
   *  boundary lands, and every canal network NHC did not flood keeps its full
   *  brightness right beside the water — Cape Coral and Port Charlotte on
   *  glass. Covering either would mean widening the surge edge until it lied
   *  about where the forecast reaches.
   *
   *  So the coastline steps back instead, and only while Surge is the live
   *  coastal segment. It is still legible — this is a dim, not a hide, and
   *  losing the shoreline entirely would take the map's main structure with
   *  it. Restored exactly on switching away, from the expression saved before
   *  the first dim rather than by re-deriving it. */
  surgeCoastDim: 0.35,

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

  /* ==> THE SEVEN 3D-GLOBE OPACITIES USED TO LIVE HERE AND NOW LIVE IN THE
   * PALETTE: `DARK.fx` / `LIGHT.fx`, read through `fx()` in config/theme.js.
   *
   * `land3dFront`, `land3dBack`, `coast3d`, `cage`, `meshFill`, `node` and
   * `stormDot3d`. They moved on 2026-08-08 because they are not one number:
   * the same alpha means opposite things additively on a night globe and
   * normally on a daylight one, and holding them here made the light theme's
   * mesh wash out while every value in the file looked right. The full
   * reasoning, and the dark values unchanged, are on DARK.fx.
   *
   * Nothing here is theme-dependent. If a new opacity turns out to be, it
   * belongs in `fx`, not in this object with a light-mode caveat in a comment. */

  ghost: 0.4,
  disabled: 0.38,
});

/* ---------------------------------------------------------------------------
 * GENESIS RISK — the areas being watched (SPEC §45)
 *
 * NOT ON THE SAFFIR-SIMPSON RAMP, AND THAT IS STILL THE POINT. §6's colour
 * contract is that those hues mean a storm of a known strength. A genesis area
 * is the ABSENCE of a storm — nobody has published a wind for it because there
 * is nothing yet to publish one about. Borrowing a category hue would be a
 * severity claim about a system that does not exist.
 *
 * ==> IT WAS A SAND / OCHRE RAMP AND THAT WAS A MISTAKE. <== The reasoning was
 * that ~42° is the one hue family nothing else in the app had claimed, which
 * was true and was the wrong question. Gold on a night globe reads as CAUTION,
 * because gold is what caution means everywhere else a person has ever seen
 * it — so the mark that exists to say "nothing has happened yet" was the
 * warmest thing on screen. Aaron read it as more urgent than it is, on glass,
 * 2026-08-09. Being off the severity ramp is not the same as being calm.
 *
 * ==> SO IT IS THE MESH / COASTLINE FAMILY NOW: THE GLOBE'S OWN FURNITURE. <==
 * `mesh` is the cage at rest and `coastGlow` is the coastline's top line —
 * between them they are what the planet looks like when nothing is wrong. A
 * watched area drawn in that family reads as part of the world rather than as
 * an alarm laid over it, which is exactly what it is: a place someone is
 * looking at. It recedes until you go looking for it, and that is correct
 * behaviour for a maybe.
 *
 * THE RISK LADDER STILL WORKS, AND IT LEANS HARDER ON SHAPE NOW. The planet
 * glyph carries risk structurally — hollow, filled, filled-and-doubled — and
 * the patch carries it in hatch density. Colour is the third channel rather
 * than the first, which is why these three steps can afford to be quiet.
 * Measured against the night ocean: 3.23 / 5.49 / 8.97:1, so even LOW clears
 * the cage's own 3.20:1 and nothing here is invisible.
 *
 * THEMED, LIKE THE MODEL LINES AND UNLIKE THE SEVERITY RAMP. §6 fixes severity
 * colours because a Cat 3 must read identically everywhere; those survive light
 * mode by carrying a halo in the theme's ink. A HATCHED AREA HAS NO HALO AND
 * CANNOT HAVE ONE, and the dark set composited at its own fill opacity is very
 * nearly the luminance of the daylight sea. So identity is carried by HUE and
 * only lightness and chroma move: every light value below is the same hue angle
 * as its dark twin. Nobody misreads a storm's severity because the teal shifted
 * a shade, which is exactly why this can be themed and the category ramp cannot.
 * ------------------------------------------------------------------------- */

/** The DARK set. Ask `genesisColor()` in lib/genesis.js, never this table —
 *  it resolves the live theme for you, and it resolves an UNKNOWN risk word to
 *  LOW rather than to undefined. */
export const GENESIS_COLOR = Object.freeze({
  LOW:    '#2A6B7A',
  MEDIUM: '#3E93A6',
  HIGH:   '#5FBDD1',
});

/** The LIGHT set. Same hue angles, darker and more saturated so a hatch at 5%
 *  fill still reads against the daylight ocean. Measured 2.63 / 3.08 / 4.19:1
 *  against it, and 4.00 / 4.69 / 6.37:1 against lit land. */
export const GENESIS_COLOR_LIGHT = Object.freeze({
  LOW:    '#5E7B85',
  MEDIUM: '#3F7286',
  HIGH:   '#1F5E75',
});

/* ---------------------------------------------------------------------------
 * GENESIS GEOMETRY — how the patch is drawn (SPEC §45)
 *
 * MAP styling values only, same split as STORM_GEO: colours are above,
 * behavioural thresholds (the zoom gate on the label) are in constants.js.
 *
 * THERE IS NO DOT IN THIS BLOCK AND THERE MUST NEVER BE ONE. A storm in this
 * app is a filled dot with a spiral and a halo; that equation is the whole
 * legibility of the globe (§45.7's "the real risk is visual"). A genesis area
 * is separated from a storm by SHAPE, not by hue — it is an area with a soft
 * edge and nothing that lives at a point. The percentage rides as haloed TEXT,
 * which can never be mistaken for a blob. Adding a centroid marker here would
 * undo the layer's one safety property.
 * ------------------------------------------------------------------------- */
export const GENESIS_GEO = Object.freeze({
  /** Hatch spacing in px, per risk word. TIGHTER MEANS MORE LIKELY — density
   *  is the second channel the colour ramp leans on. */
  hatchGap: Object.freeze({ LOW: 13, MEDIUM: 8, HIGH: 5 }),

  /** The flat fill UNDER the hatch. Still deliberately weak — a Low area is a
   *  maybe and must not hold the eye against a real storm anywhere on the same
   *  globe — but no longer nearly invisible.
   *
   *  ==> RAISED WHEN THE RAMP MOVED OFF GOLD. <== These numbers were tuned
   *  against a saturated sand on a near-black ocean, where 5% still read. The
   *  ramp is the mesh/coastline family now, which is the whole point of it and
   *  also means it RECEDES: the same opacity of a colour chosen to blend buys
   *  materially less presence, and in light mode a dark teal at 5% over a
   *  #C2C6CA sea is nothing at all. A layer nobody can see is not a quiet
   *  layer, it is an absent one. */
  fillOpacity: Object.freeze({ LOW: 0.08, MEDIUM: 0.12, HIGH: 0.18 }),

  /** The hatch lines themselves — the part that actually carries this layer.
   *  The fill is a tint; the strokes are what say "hatched", and they were
   *  raised with the fill for the same reason. */
  hatchWidth:   1.2,
  hatchOpacity: 0.75,

  /** DASHED EDGE, ALWAYS. The boundary of a development region is genuinely
   *  fuzzy; a solid outline would claim a precision NHC never published. This
   *  is the same argument as the hatch, made at the edge. */
  lineWidth:   1.25,
  lineOpacity: 0.55,
  lineDash:    Object.freeze([5, 5]),

  /** SELECTED. Everything steps up together — fill nearly doubles, the edge
   *  goes bolder and its dash lengthens so the shape reads as picked rather
   *  than as a different risk level. Risk must never be inferable from
   *  selection state. */
  selectedFillMultiplier: 1.8,
  selectedLineWidth:      2,
  selectedLineOpacity:    0.95,
  selectedLineDash:       Object.freeze([7, 4]),
  selectedHatchWidth:     1.5,
  selectedHatchOpacity:   0.85,

  /* ==> THE PLANET-BAND GLYPH'S RISK LADDER IS STRUCTURAL, NOT NUMERIC, SO
   *     THERE IS NO TABLE HERE. <== (map/glyph.js `watchGlyphCanvas`.)
   *
   * `glyphHatchLines` lived here — 2 / 3 / 5 strokes through a hatched
   * lozenge — and went with the lozenge itself. The mark is a caution triangle
   * now and its three variants differ in KIND: hollow, filled, filled inside a
   * second outline. Empty / full / doubled is legible at 30 px on a phone in a
   * way that three steps of any count is not, which is the same argument the
   * hatch-plus-lightness pairing makes on the patch.
   *
   * A lookup table would have to encode "is it filled" and "does it have an
   * outer ring" as data, which is two booleans pretending to be a ramp. The
   * three cases live in the drawing function where they can be read as
   * drawings. If a fourth risk word ever appears, that is the moment to
   * reconsider — not before. */

  /** ==> THE TAP TARGET'S RADIUS, AND IT IS A TOUCH RULE RATHER THAN A LOOK.
   *  <== The circle is fully transparent; this number exists only so a finger
   *  can land on it. 22 px of radius is the §9 44 px minimum diameter, the
   *  same floor `storm-dot-planet` is held to.
   *
   *  It is what makes a watched area tappable AT THE PLANET BAND, where the 3D
   *  glyph is a 30 px triangle and the polygon under it is a few pixels wide —
   *  a tap landing squarely on the triangle would otherwise miss the patch and
   *  close the drawer instead of opening the area. */
  hitRadiusPx: 22,

  /** The seven-day percentage, drawn at NHC's OWN label anchor (MapServer
   *  layer 2) rather than at a centroid we computed. Their point, their
   *  number. The halo is the theme's ink, the fill is the risk colour. */
  labelSize:      15,
  labelHaloWidth: 2.2,
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
   *  neighbours where it counts.
   *
   *  TAKEN AWAY AND PUT BACK, 2026-08-08. Equalising the widths was tried on
   *  the reasoning that the extra 1.5 px read as a bigger dot rather than a
   *  marked one. Compared side by side on glass it read WORSE — the mark
   *  stopped carrying at a glance. Aaron's call, and it is a glass call, so it
   *  outranks the argument. Do not re-run this experiment. */
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

  /** Watch/warning coastal stripe: THE COASTLINE, RESTROKED IN THE WARNING
   *  COLOR. Color is per-feature from WATCH_WARNING_COLOR (§6 — fixed
   *  contract).
   *
   *  ==> THESE ARE MULTIPLIERS ON THE COASTLINE'S OWN WIDTH CURVE, NOT PIXEL
   *  WIDTHS, AND THAT IS THE WHOLE FIX. <== The stripe shipped as a flat 8 px
   *  at every zoom while the coast it paints over fades with distance —
   *  0.59 px far out, 1.71 px zoomed in. So the stripe was about 5x the width
   *  of the line it was replacing at close range and 13x on the globe. On
   *  Bertha's smooth Texas coast at a basin zoom that read as a marked shore;
   *  on Ida's Mississippi delta at close zoom the strokes on adjacent marsh
   *  islands merged into a solid red slab. The 8 was never wrong on its own —
   *  it was never tied to the thing it sits on. Tying it means the stripe
   *  inherits the depth fade for free and cannot drift again.
   *
   *  1.8x, Aaron's call on glass 2026-08-10, from 1.5 / 1.8 / 2.5: the shore
   *  recolored AND slightly emphasised, rather than merely recolored.
   *
   *  ==> THE GLOW UNDERLAY IS BACK. THIS REVERSES THE 2026-07-24 KILL. <==
   *  It was removed for making an 8 px slab look imprecise, which it did. At
   *  coastline width the argument inverts: the cyan stack is TWO passes, a
   *  bright core over a wide blurred halo, and painting only the core leaves
   *  the cyan halo fringing out either side of the warning color. That reads
   *  as a coast drawn twice rather than a coast recolored. Replacing the
   *  coastline means replacing both of its passes. */
  stripeCoreScale:    1.8,

  /** The halo is NOT scaled by the same 1.8, and the difference is deliberate.
   *  The core is scaled to emphasise; the halo only has to COVER the cyan one
   *  it replaces, and scaling it to match the core would push a soft red wash
   *  ~2 px further out than the cyan ever reached — which on a coast like the
   *  Mississippi delta, where marsh islands sit a few pixels apart, fills the
   *  water between them and rebuilds the slab in a dimmer color.
   *
   *  1.3 keeps the stripe's halo standing off its core by the same margin the
   *  cyan halo stands off the cyan core (~2 px at close zoom), so the stack
   *  has the same shape, and still covers the cyan halo outright (7.3 px
   *  against 5.6 px) so no cyan fringes through. */
  stripeGlowScale:    1.3,
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
