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
  mesh:           '#FBC333', // nodal network — amber. Planet-zoom only, fades
                             // by the basin band. NOT a severity color.
  coastGlow:      '#4FD1E8', // the bright top line of the coastline stack
  coastGlowSoft:  '#1E6B7D', // the wide dim blurred underlay
  graticule:      '#1C3550', // dimmer than the coast, always
  graticuleMajor: '#26496D', // equator, prime meridian, tropics

  /* 3D clear globe — the planet-band entry engine (SPEC §2). `mesh` (amber,
   * above) is reused for the geodesic cage and its live nodes. */
  land3d:         '#40474F', // charcoal continents on the clear globe. Lighter
                             // than `land` on purpose: it must read as solid
                             // against the see-through ocean, not merge into it.
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

  /** Visible storm glyph at rest. Hit area is touchTarget regardless. */
  glyphBase: 16,

  /** Glyph size multiplier by category index (0 = TD .. 6 = Cat 5).
   *  Size-scaled, never shape-scaled — a Cat 5 is a bigger glyph, not a more
   *  elaborate one. It has to stay legible at ~12px on a phone at z1. */
  glyphScale: Object.freeze([0.75, 0.85, 1.0, 1.1, 1.2, 1.32, 1.45]),

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
   *  sizeAttenuation on). The glowing amber LEDs riding the geodesic cage. */
  node3dSize: 0.09,
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
  land3dBack:  0.60,
  coast3d:     0.55,
  cage:        0.46,
  node:        1.0,

  ghost: 0.4,
  disabled: 0.38,
});

/** Elevation — panels float over the globe, nothing takes the full screen. */
export const Z = Object.freeze({
  globe: 0,
  statusStrip: 20,
  panel: 30,
  controlCluster: 40,
  focusOverlay: 50,
});
