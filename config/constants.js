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

  /** Opening sequence camera positions. */
  introStart: 0.4, // arriving from a distance
  introRest: 2.2,  // resting position — planet band, whole globe legible
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
 * Swapping to R2 is ONE line: set `source` to R2 and flip `useR2` to true.
 * ------------------------------------------------------------------------- */

export const TILES = Object.freeze({
  /** Flip to true once the .pmtiles file is uploaded to the bucket below. */
  useR2: false,

  /** Cloudflare R2 public bucket, created 2026-07-22. */
  r2Base: 'https://pub-72a4a9c118d14117ace3a2fc6660f8e0.r2.dev',
  r2File: 'landfall-z0-8.pmtiles',

  /** Phase 1 scaffolding. SPEC §11 names OpenFreeMap as the legitimate
   *  fallback if self-hosting becomes a burden — using it as temporary
   *  scaffolding is the same call, made earlier. */
  openFreeMapStyle: 'https://tiles.openfreemap.org/planet',

  /** Vector source layer names. Protomaps and OpenFreeMap/Planetiler differ,
   *  so the style module reads these rather than hardcoding either. */
  layerNames: Object.freeze({
    openfreemap: Object.freeze({ land: 'landcover', water: 'water', boundary: 'boundary' }),
    protomaps: Object.freeze({ land: 'earth', water: 'water', boundary: 'boundaries' }),
  }),
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
