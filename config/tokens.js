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

/** Model track identity colors — the shortlist only.
 *  HCCA shares TVCN's color: same consensus slot, never drawn together.
 *  Models beyond the shortlist draw from MODEL_FALLBACK_RAMP. */
export const MODEL_COLOR = Object.freeze({
  TVCN: '#00E5FF',
  HCCA: '#00E5FF',
  AVNO: '#B388FF',
  HFSA: '#FFAB40',
  UKX:  '#F06292',
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
  graticule:      '#1C3550', // dimmer than the coast, always
  graticuleMajor: '#26496D', // equator, prime meridian, tropics

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
  textMuted:      '#647C93',
  textInverse:    '#07121D',

  /* State */
  focusRing:      '#5FE0F5', // always visible, never outline:none
  stale:          '#E0A93C', // aging data, 4-9 h
  error:          '#E85D5D', // source down / layer failed
  ok:             '#4FD18B',
  dim:            'rgba(232, 241, 248, 0.38)', // ghosts, unsupported rows
});

/** Light mode is Phase 8. It is NOT an inversion of DARK — it needs a real
 *  design pass against the actual basemap (SPEC §9, §15 item 1). This stub
 *  exists so nothing in feature code has to branch on its absence. */
export const LIGHT = Object.freeze({ ...DARK });

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

  /** Storm name labels on the map (basin band and closer). Px because MapLibre
   *  speaks px; the halo is what keeps a name legible crossing a coastline. */
  stormLabelPx: 12,
  stormLabelHaloPx: 1.4,

  radius:      '10px',
  radiusLarge: '16px',
  radiusPill:  '999px',

  focusRingWidth: '2px',
  focusRingOffset: '2px',

  /** Coastline stack: the same line drawn three times.
   *  Wide/dim/blurred underneath, thin/bright on top. */
  coastWidthGlow: 3.5,
  coastWidthCore: 0.9,
  graticuleWidth: 0.5,
  graticuleWidthMajor: 0.8,

  /** 3D clear-globe node sprite size, in world units (Three PointsMaterial,
   *  sizeAttenuation on). The glowing cyan LEDs riding the geodesic cage; they
   *  take their storm's category color as they rise.
   *  Shrunk 0.09 → 0.07 when the cage went to geoDetail 3 — denser lattice,
   *  same total glow budget. */
  node3dSize: 0.048,

  /** Storm glyph sprite on the 3D globe surface (planet band, SPEC §9): the
   *  same two-arm spiral as MapLibre's, in grey. Clearly bigger than a cage
   *  node — it marks a storm, not a lattice point. */
  stormDot3dSize: 0.17,
});

/** Layer opacities. Separated from color so a layer can be dimmed without
 *  touching its §6 severity hue. */
export const OPACITY = Object.freeze({
  coastGlow: 0.35,
  coastCore: 0.95,
  graticule: 0.22,
  graticuleMajor: 0.34,
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
  coneFill:        '#FFFFFF',
  coneFillOpacity: 0.08,      // a veil, not a shape — the track reads through it
  coneLine:        '#FFFFFF',
  coneLineOpacity: 0.35,
  coneLineWidth:   1.25,

  /** The dash contract, deliberately NOT the usual cartographic reading.
   *  The forecast is the question everyone opened the app to answer, so it
   *  gets the solid, confident line; observed history is quieter context and
   *  reads as a dotted trail. Uncertainty is carried by the cone, which is
   *  the honest place for it. */
  trackForecast:      '#E8F2F8',
  trackForecastWidth: 1.75,                  // solid = where it's going
  trackPast:          '#5C7A94',
  trackPastWidth:     1.5,
  trackPastDash:      Object.freeze([1, 2]), // dotted = where it's been

  /** Forecast points: SS-colored circles (color computed per feature from
   *  NHC's own `ssnum` — reported, never derived). Sized to carry a one- or
   *  two-character classification code INSIDE the dot ("TD", "TS", "1".."5"),
   *  which is why the radius is well above a plain marker's. The dark stroke
   *  keeps a yellow Cat 1 point readable over the cone veil on lit land. */
  pointRadius:      10,
  pointStroke:      '#0B1420',
  pointStrokeWidth: 1.5,

  /** The code drawn inside the point. Near-black on every category color —
   *  the §6 palette runs light-to-mid, so dark type holds contrast on all of
   *  it, and a per-category text color would be a second color contract to
   *  keep in sync. No halo: the dot itself is the backdrop. */
  pointCodeSize:   11,
  pointCodeColor:  '#0B1420',

  /** Forecast time labels (`datelbl`, shown verbatim — no reformatting). */
  labelSize:      11,
  labelColor:     '#C7D6E2',
  labelHalo:      '#0B1420',
  labelHaloWidth: 1.4,
  /* No static offset: placement is per-feature and lives in
   * LABEL_PLACEMENT.spokePx (map/layers/label-placement.js). */

  /** Watch/warning coastal stripe. Color is per-feature from
   *  WATCH_WARNING_COLOR (§6 — fixed contract). Wide + soft underlay so the
   *  stripe reads as coastal shading, not a wire. */
  stripeWidth:        4,
  stripeOpacity:      0.9,
  stripeGlowWidth:    9,
  stripeGlowOpacity:  0.25,
});

/** Elevation — panels float over the globe, nothing takes the full screen. */
export const Z = Object.freeze({
  globe: 0,
  statusStrip: 20,
  panel: 30,
  controlCluster: 40,
  focusOverlay: 50,
});
