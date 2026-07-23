/**
 * constants.js — every behavioral number in Landfall.
 *
 * Rule from SPEC §12: define the constant BEFORE the logic that uses it, and
 * attach the reason. No unexplained numbers anywhere in the codebase.
 *
 * Second rule, harder: DERIVE, NEVER HAND-TUNE TWICE. This file holds SOURCES;
 * anything downstream is arithmetic on them. Hand-set clearances drift out of
 * sync with the thing they were meant to clear.
 *
 * Imports nothing. Ever.
 */

/* ---------------------------------------------------------------------------
 * TIME BASE — everything below derives from these
 * ------------------------------------------------------------------------- */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** NHC issues full advisories every 6 hours, intermediates every 2-3 hours.
 *  This is the cadence everything about staleness is measured against. */
export const ADVISORY_CADENCE = 6 * HOUR;

/* ---------------------------------------------------------------------------
 * POLLING
 * ------------------------------------------------------------------------- */

export const POLL = Object.freeze({
  /** Storm sources. 30 min catches every intermediate advisory without
   *  hammering anyone. Poll runs ONLY while the page is visible — no
   *  background work, ever (SPEC §4). */
  storms: 30 * MINUTE,

  /** Imagery source cadence. Fetched only while an imagery layer is ON. */
  imagery: 5 * MINUTE,

  /** Auto-retry backoff after a failed fetch. Then stop and wait for the next
   *  normal poll. Never auto-retry while the page is hidden. */
  retryBackoff: Object.freeze([5 * SECOND, 15 * SECOND, 45 * SECOND]),

  /** Show the error UI once auto-retries are exhausted — EXCEPT when the
   *  screen is empty, where feedback is needed fast or it reads as broken. */
  errorDelayWhenEmpty: 2 * SECOND,

  /** Per-request abort. 20 s is generous for a JSON list on cell data but far
   *  short of GDACS-geometry's legendary 90 s — that endpoint is relay-cached
   *  precisely so no phone ever waits on it. A request that takes longer than
   *  this IS a timeout, and timeouts are retryable. */
  fetchTimeout: 20 * SECOND,
});

/** A 4xx is NOT retryable — that is "no data," not "try again," and retrying
 *  it burns battery for nothing. Retryable = timeout, network error, 5xx. */
export const RETRYABLE_STATUS = Object.freeze({
  min: 500,
  max: 599,
});

/* ---------------------------------------------------------------------------
 * CACHE TTLs (SPEC §4)
 *
 * Starting values, each with a reason so it can be argued with later.
 * Not measured — tune on real data.
 * ------------------------------------------------------------------------- */

export const CACHE = Object.freeze({
  /** Relay: NHC storm list. Well under the 30-min poll, so a poll never gets
   *  served its own previous copy. */
  nhcListFresh: 5 * MINUTE,

  /** Relay: model a-decks. Synoptic cycles are 6-hourly. */
  adeckFresh: 15 * MINUTE,

  /** Relay: GDACS per-storm geometry. THE ROW THAT MATTERS.
   *  That endpoint needed a 90-second timeout on the HA project. A 90-second
   *  wait on a phone is a dead app. Serve stale, refresh behind it.
   *  A six-hour-old cone is roughly right and infinitely better than a
   *  spinner. Past twelve hours it is genuinely misleading — drop it and show
   *  `unavailable` rather than a stale shape. */
  gdacsGeometryFresh: 30 * MINUTE,
  gdacsGeometryStale: 6 * HOUR,
  gdacsGeometryDrop: 12 * HOUR,

  /** Client: per-(storm, advisory) geometry. The key self-invalidates when a
   *  new advisory lands; the cap stops unbounded growth. Bound every cache. */
  geometryLruStorms: 8,

  /** Service worker: last-good storm data. ~1.5x advisory cadence, carried
   *  from the HA project. Served flagged stale with its age. */
  lastGoodStormData: 9 * HOUR,
});

/* ---------------------------------------------------------------------------
 * FRESHNESS BANDS — how the timestamp element reads (SPEC §16)
 *
 * Derived from ADVISORY_CADENCE, not hand-set, so changing the cadence
 * assumption moves all three together.
 * ------------------------------------------------------------------------- */

export const FRESHNESS = Object.freeze({
  /** Under ~4 h: quiet. Within a normal advisory cycle. */
  freshUntil: (2 / 3) * ADVISORY_CADENCE,

  /** 4-9 h: highlighted. We've missed at least one expected update. */
  agingUntil: CACHE.lastGoodStormData,

  /** Past 9 h: flagged. "⚠ Last update 11 hrs ago" */
});

/** Geometry lag: when the MapServer's own timestamp trails the storm feed by
 *  more than one advisory cycle, the detail panel grows a second line saying
 *  so. When they agree, the line does not exist — silence means synchronized. */
export const GEOMETRY_LAG_THRESHOLD = ADVISORY_CADENCE;

/* ---------------------------------------------------------------------------
 * ZOOM LADDER (SPEC §9)
 *
 * Zoom controls DETAIL, not MEANING. A storm's category color, glyph, and
 * position never change with zoom. What changes is how much supporting
 * information sits around it.
 *
 * Four bands, not eight, so transitions are felt rather than guessed at.
 *
 * [DECIDE] Exact thresholds, once there is a real basemap to look at.
 * These are the spec's stated bands, unmeasured.
 * ------------------------------------------------------------------------- */

export const ZOOM = Object.freeze({
  min: 0,
  max: 8,          // Hard ceiling. §11: past z8 you pull in street grids,
                   // which are noise for storm data and wreck the lit-globe
                   // look. This is a design decision, not a budget one.

  /** Band floors. A band runs from its floor up to the next band's floor. */
  planet: 0,       // z0-2: continent fills, coast glow, graticule.
                   //       Glyph + category color only. NO LABELS.
  basin: 3,        // z3-4: + major islands, storm names, past track
  regional: 5,     // z5-6: + cone, forecast track, forecast points
  local: 7,        // z7-8: full coastline detail, watch/warning stripe,
                   //       surge bands, wind bands

  /** MapLibre resting zoom — where recenter() returns the camera, and the
   *  planet-band framing the dive lands near. (The old introStart retired with
   *  the MapLibre opening sequence; the 3D arrival uses camera distance, §2.) */
  introRest: 2.2,
});

/* ---------------------------------------------------------------------------
 * GLOBE BEHAVIOR
 * ------------------------------------------------------------------------- */

export const GLOBE = Object.freeze({
  /** Fallback resting center when there is no home and no active storm.
   *  Fixed Atlantic view — the basin Landfall is most often watched for. */
  fallbackCenter: Object.freeze([-52, 22]),

  /** Idle auto-rotate. Stops INSTANTLY on interaction; disabled under
   *  OS reduce-motion. [DECIDE] speed + resume delay — measure on glass. */
  idleRotateDegPerSecond: 1.6,
  idleResumeDelay: 12 * SECOND,

  /** Graticule generation. Drawn in code — no tile source carries it. */
  graticuleStepDeg: 15,
  graticuleDensifyDeg: 2, // vertex spacing along each line, so lines follow
                          // the sphere's curve instead of cutting through it

  /** Storm selection flyTo. Padding is applied so the camera centers on the
   *  VISIBLE globe area, not the viewport — the bottom sheet eats the lower
   *  60%, the rail eats the left third. Centering on the viewport lands the
   *  storm underneath the panel that just opened. */
  flyToZoom: 5,
  flyToSpeed: 1.1,
  flyToCurve: 1.42,

  /** KEYBOARD CAMERA STEPS (SPEC §10).
   *
   *  Pan is expressed in DEGREES, not screen pixels. panBy() converts pixels
   *  through the projection, which on a globe means a horizontal step near the
   *  poles maps to an enormous longitude change and no step wraps the
   *  antimeridian — left/right did nothing and up/down jammed at ~180°. Idle
   *  rotation already moves the camera in degrees via setCenter and spins
   *  forever without a stop; the keyboard now uses the same model.
   *
   *  Degrees per keypress is deliberately larger than it looks: at the space
   *  floor the whole planet is on screen, so a small step reads as nothing.
   *  [DECIDE] whether this should scale with zoom — measure on glass. */
  keyPanDegrees: 8,

  /** Latitude the camera may not pass. NOT a clamp on longitude — longitude
   *  wraps, which is what makes the globe endlessly rotatable. Latitude has to
   *  stop short of ±90: a globe camera exactly at a pole has no defined
   *  up-vector and flips the view. */
  keyPanMaxLat: 82,

  /** Zoom per +/- press. */
  keyZoomStep: 0.5,
});

/* ---------------------------------------------------------------------------
 * THE 3D CLEAR GLOBE + LOCKSTEP DIVE (SPEC §2, §9 — as-built)
 *
 * The wide "planet" view is a Three.js clear globe: a see-through wireframe
 * sphere with charcoal land, a floating amber geodesic cage, storm severity
 * read as node elevation. Zoom in and it crossfades into MapLibre, which owns
 * the basin band inward. The crossfade IS the intended effect, not a seam.
 *
 * This block replaced the old MESH block: the flat MapLibre nodal mesh was a
 * stopgap for the planet band; the 3D cage owns that band now and map/mesh.js
 * is retired.
 *
 * Every number here is a SOURCE. The globe geometry and the dive choreography
 * are arithmetic on them. Ported from proto-transition.html, validated on a
 * phone before integration.
 * ------------------------------------------------------------------------- */

export const DIVE = Object.freeze({
  /* --- ENTRY FRAMING ------------------------------------------------------ */

  /** Three camera distance (globe radii) — the initial/fallback framing before
   *  MapLibre can be measured. While the 3D globe is visible the camera distance
   *  is recomputed each frame from MapLibre's on-screen globe radius, so the two
   *  stay pixel-locked at every zoom (§2). */
  spaceDistance: 3.05,

  /** Three camera field of view, degrees. The per-frame globe-match depends on
   *  it, so it is a source, not a literal. */
  fov: 42,

  /** Space CEILING — the furthest-in a session may start, and the fade
   *  band's fixed lower edge. The ACTUAL space floor (starting zoom AND
   *  minZoom) is derived per-viewport in globe.js `spaceFloorZoom()`:
   *  min(zSpace, the zoom where the full globe diameter fits the viewport's
   *  short side). A wide desktop fits at z2 so nothing changes there; a
   *  phone's floor lands near z1 so the whole planet is visible at rest
   *  instead of clipped at the sides. Viewport-derived, never device-sniffed
   *  (SPEC §10). Below zSpace the crossfade p clamps to 0 — deeper space,
   *  map fully hidden, cage at full strength. */
  zSpace: 2.0,

  /** How much of the viewport's short side the globe's diameter takes at the
   *  derived floor. <1 leaves breathing room for the cage's storm spikes. */
  fitFraction: 0.86,

  /** Handoff complete — at/above this MapLibre zoom the 3D globe is fully faded
   *  and MapLibre owns the screen. The crossfade band is zSpace..zHandoff, and
   *  the fade progress p = (zoom − zSpace) / (zHandoff − zSpace). */
  zHandoff: 5.0,

  /** Globe-match fudge. 1.0 = the two globes are pixel-locked; nudge only if a
   *  device shows a seam during the crossfade. */
  scale: 1.0,

  /* --- CLEAR-GLOBE GEOMETRY ----------------------------------------------- */

  /** Icosphere subdivision → cage/node spacing. Each step up ~quadruples the
   *  node count. Raised 2 → 3 on glass (2026-07-23): with sharp storm spikes
   *  (see stormSigma) the detail-2 lattice was too coarse for a peak to have
   *  a shape — nodes sat ~8° apart, wider than the spike. Detail 3 is ~2,562
   *  nodes / ~7,680 edges — still one draw call each. [VERIFY] frame budget
   *  on a mid-range phone; the overriding lens is feel, and if it stutters
   *  this goes back to 2 and the spike widens instead. */
  geoDetail: 3,

  /** Cage radius as a multiple of the unit globe — the amber network floats
   *  just above the surface. */
  cageRadius: 1.065,

  /** Fill everything south of this latitude solid: the only land that far
   *  south is Antarctica, and it closes the pole cleanly. */
  poleCap: -82,

  /** Faint fixed unevenness so a calm (storm-free) cage isn't dead flat. */
  baseLump: 0.012,

  /* --- STORM HEIGHTFIELD (SPEC §9) ---------------------------------------- */

  /** A Cat-5 pushes a node this fraction beyond the cage radius; a TS a small
   *  bump. Severity read as elevation — the cage peaks over storms.
   *  0.22 → 0.5 on glass: the old value read as "slight bump," and a signal
   *  you have to squint for is not a signal (§5 in visual form). */
  stormAmp: 0.5,

  /** Storm influence radius in radians of arc (~9°): how wide each peak
   *  spreads across the cage. Narrowed from ~17° with geoDetail 3 — only the
   *  nodes CLOSEST to the storm spike, a sharp local peak instead of a broad
   *  regional swell. Node spacing at detail 3 is ~4°, so a 9° sigma still
   *  catches a ring of neighbors and reads as a shape, not one stray node. */
  stormSigma: 0.16,

  /** Per-frame ease as node heights rise/fall toward the storm target
   *  (~1 s settle). Not an absolute ramp — see SPEC §13. */
  liftEase: 0.06,

  /** Severity ramp for elevation. Mirrors CATEGORY_THRESHOLD_KT: TS force is
   *  the smallest visible lift, Cat 5 is full lift. This is a VISUAL ramp for
   *  the cage, not a category assignment.
   *
   *  Tuned on glass 2026-07-23: the first (linear, minLift 0.04) ramp made a
   *  40 kt TS lift nodes ~1% of the radius — LESS than baseLump, i.e. a live
   *  storm read as flat ocean, which is the §5 failure in visual form. The
   *  ramp is now lift = minLift + (1-minLift) * t^sevCurve: the sqrt curve is
   *  a perceptual boost that keeps ordering (TS ≈ 0.4, Cat 1 ≈ 0.65, Cat 5 = 1)
   *  while every real storm clears the noise floor. */
  sevFloorKt: 34,
  sevPeakKt: 137,
  sevMinLift: 0.16,
  sevCurve: 0.5,

  /** Grey storm-position dots ON the 3D globe surface at the planet band
   *  (SPEC §9 zoom ladder: "grey position glyphs"). Riding just above the
   *  land so they never z-fight the fill; the cage floats far above at
   *  cageRadius. They fade with the nodes during the dive, handing off to
   *  MapLibre's own grey dots as the map fades in. */
  stormDotRadius: 1.012,

  /* --- FADE CHOREOGRAPHY (crossfade progress p, 0..1) --------------------- *
   * p is derived from the live MapLibre zoom (see zSpace/zHandoff), NOT a
   * timeline — you drive it by zooming. Each pair is [start, end] of a
   * smoothstep. Nodes and cage LINGER as you zoom past them, then fade; land
   * holds under them a beat longer; the map fades up and space fades out early. */
  fade: Object.freeze({
    nodes:    Object.freeze([0.14, 0.60]),
    cage:     Object.freeze([0.16, 0.62]),
    land:     Object.freeze([0.22, 0.62]),
    mapIn:    Object.freeze([0.00, 0.30]),
    spaceOut: Object.freeze([0.00, 0.34]),
  }),
});

/* ---------------------------------------------------------------------------
 * SCOPE FILTER (SPEC §16)
 *
 * Two of three scopes need home, which is Phase 3. Phase 2 ships All only.
 * ------------------------------------------------------------------------- */

export const SCOPE = Object.freeze({
  ALL: 'all',
  BASIN: 'basin',
  RADIUS: 'radius',
});

/** Radius scope default, in NAUTICAL MILES — NHC's native distance unit and
 *  what everything in the app is stored in. Converted at render only. */
export const SCOPE_RADIUS_NM = 500;

/* ---------------------------------------------------------------------------
 * GHOST STORMS (SPEC §5)
 *
 * A selected storm can vanish mid-session. Dimmed glyph at last known
 * position plus a note, never silent removal.
 *
 * Promote to ghost ONLY when the fetch came back clean. If the source errored,
 * storms hold as stale — they do not become ghosts. Getting this backwards
 * shows a live hurricane as gone.
 * ------------------------------------------------------------------------- */

export const GHOST_TTL = 12 * HOUR;

/* ---------------------------------------------------------------------------
 * DATA ENDPOINTS
 *
 * CORS ground truth verified in-browser 2026-07-22. BLOCKED endpoints must go
 * through the relay; OK endpoints are fetched directly by the browser.
 * ------------------------------------------------------------------------- */

export const ENDPOINT = Object.freeze({
  /** BLOCKED — relay required. */
  nhcStormList: 'https://www.nhc.noaa.gov/CurrentStorms.json',
  nhcAdeck: 'https://ftp.nhc.noaa.gov/atcf/aid_public/',

  /** OK — direct browser fetch. */
  nhcMapServer:
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer',
  gdacsEventList:
    'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP',

  /** Relay base. One Cloudflare Pages Function, forward-and-cache only.
   *  The app merges NHC and GDACS CLIENT-SIDE — the relay stays dumb. */
  relay: '/api',
});

/** NHC MapServer layer-slot arithmetic. The fiddliest math in the project.
 *  Each storm slot owns a block of 26 layers.
 *  layer id = blockStart + (slot - 1) * SLOT_STRIDE + offset
 *
 *  Some layers store stormid lowercase — ALWAYS match case-insensitively
 *  with UPPER(stormid)=... */
export const MAPSERVER = Object.freeze({
  blockStart: Object.freeze({ AT: 4, EP: 134, CP: 264 }),
  slotStride: 26,
  offset: Object.freeze({
    advisoryWindField: 13,
    forecastWindRadii: 12,
  }),
  /** Peak Storm Surge is its OWN MapServer with NO stormid field — filter
   *  spatially by an envelope around the storm's position. */
  surgeService: 'NHC_PeakStormSurge',
  surgePolygonLayer: 2,
});

/* ---------------------------------------------------------------------------
 * BASEMAP TILES (SPEC §11)
 *
 * Protomaps, self-hosted on Cloudflare R2, capped at z8.
 *
 * PHASE 1 USES OPENFREEMAP AS SCAFFOLDING. The R2 bucket exists and is public
 * but the .pmtiles file has not been built yet — that needs a terminal.
 *
 * Swapping to R2 is one line HERE (flip `useR2`), but that was only true from
 * 2026-07-23: before that, nothing registered the `pmtiles://` protocol that
 * style-dark.js emits, so flipping the flag failed on style load. index.html
 * now loads the pmtiles library and main.js registers the protocol, both
 * unconditionally, so the flag is genuinely the only edit.
 *
 * Still outstanding: `glyphs` in style-dark.js points at OpenFreeMap's font
 * endpoint regardless of this flag, so text layers (storm names, live since
 * Phase 2) fetch from OpenFreeMap even on R2 tiles. Self-hosting fonts in the
 * same bucket is a separate decision — see SPEC §15.
 * ------------------------------------------------------------------------- */

export const TILES = Object.freeze({
  /** Flip to true once the .pmtiles file is uploaded to the bucket below. */
  useR2: false,

  /** Cloudflare R2 public bucket, created 2026-07-22. */
  r2Base: 'https://pub-72a4a9c118d14117ace3a2fc6660f8e0.r2.dev',
  r2File: 'landfall-z0-8.pmtiles',

  /** Phase 1 scaffolding. SPEC §11 names OpenFreeMap as the legitimate
   *  fallback if self-hosting becomes a burden — using it as temporary
   *  scaffolding is the same call, made earlier.
   *
   *  NOTE: OpenFreeMap serves the OpenMapTiles schema; Protomaps serves its
   *  own. They are not interchangeable by layer name — OpenMapTiles has no
   *  land polygon at all. style-dark.js handles this structurally with two
   *  separate layer builders rather than a name lookup. */
  openFreeMapStyle: 'https://tiles.openfreemap.org/planet',
});

/* ---------------------------------------------------------------------------
 * PERSISTENCE
 *
 * Layer choices and section collapse state persist per device.
 * STORM SELECTION DOES NOT — reopening drops you on the globe, not on
 * yesterday's dissipated storm.
 *
 * Home is stored locally on the device only. No accounts, no server-side
 * user data, ever.
 * ------------------------------------------------------------------------- */

export const STORAGE_KEY = Object.freeze({
  layers: 'landfall.layers',
  models: 'landfall.models',
  home: 'landfall.home',
  units: 'landfall.units',
  theme: 'landfall.theme',
  scope: 'landfall.scope',
  sections: 'landfall.sections',
  lastVisit: 'landfall.lastVisit',
});

/* ---------------------------------------------------------------------------
 * UNITS (SPEC §8)
 *
 * Wind stored in KNOTS, everywhere, always. Distance in NAUTICAL MILES.
 * Every threshold in this app — the 34/50/64 kt bands, the Saffir-Simpson
 * breakpoints — is defined in knots. Convert ONLY at the moment of drawing
 * text. Converting internally means rounding drift, and drift near a
 * threshold flips a storm between categories.
 * ------------------------------------------------------------------------- */

export const UNITS = Object.freeze({
  IMPERIAL: 'imperial',
  METRIC: 'metric',
  AUTO: 'auto',
});

/** Saffir-Simpson breakpoints in knots. The only place these numbers exist. */
export const CATEGORY_THRESHOLD_KT = Object.freeze([
  { min: 137, category: 6 }, // Cat 5
  { min: 113, category: 5 }, // Cat 4
  { min: 96,  category: 4 }, // Cat 3
  { min: 83,  category: 3 }, // Cat 2
  { min: 64,  category: 2 }, // Cat 1
  { min: 34,  category: 1 }, // Tropical Storm
  { min: 0,   category: 0 }, // Tropical Depression
]);

/** Wind band thresholds in knots. */
export const WIND_BAND_KT = Object.freeze([34, 50, 64]);
