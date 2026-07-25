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

  /* RELAY: GDACS PER-STORM GEOMETRY — the numbers are NOT here, deliberately.
   *
   * They live in `functions/api/gdacs/geometry.js` (fresh 30 min, serve-stale
   * ceiling 12 h) because Cloudflare Pages Functions run in their own runtime
   * and cannot import this file without a bundler step this project does not
   * have and must never grow (§3). Three constants sat here for a day naming
   * TTLs that nothing on either side of the wire ever read, which is worse
   * than an honest pointer: they looked authoritative and were inert.
   *
   * SPEC §4's cache table is the truth; the function file mirrors it and says
   * so. If those numbers change, they change in two places on purpose.
   *
   * On the numbers themselves: the HA project's 90-second timeout did NOT
   * reproduce here — measured 375–984 ms (2026-07-23) and 1.3–1.5 s / 224 kB /
   * 44 features (2026-07-24, live via /api/gdacs/inspect). Two independent
   * reads, so the "slow endpoint" story is retired. The cache stays as cheap
   * insurance against a source that has misbehaved before, on top of the size
   * and distance argument that actually justifies it. */

  /** Client: per-(storm, advisory) geometry. The key self-invalidates when a
   *  new advisory lands; the cap stops unbounded growth. Bound every cache.
   *  Sized 12 — geometry is WARMED for every NHC storm now (§9 ambient
   *  ladder), and the NHC basins have peaked at 8-9 concurrent storms in
   *  hyperactive seasons; a cap of 8 would evict bundles mid-warm. */
  geometryLruStorms: 12,

  /** Warm-fetch concurrency: bundles fetched two storms at a time. Gentle on
   *  the MapServer and on a phone radio, still warm within seconds. */
  geometryWarmConcurrency: 2,

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
  basin: 3,        // z3-4: + major islands, storm names
  regional: 5,     // z5-6: + full coastline resolution
  local: 7,        // z7-8: full coastline detail, surge bands, wind bands

  /** AMBIENT STORM GEOMETRY floor — cone, both tracks, forecast points,
   *  forecast time labels, and the watch/warning stripe all appear on this
   *  ONE step. Deliberately not a band floor: it sits inside the basin band
   *  (z3-4), one level above storm names, so committing to a basin brings the
   *  whole storm picture at once. A staggered arrival read as a rendering
   *  bug, not as a ladder — every ambient layer keys off this single value so
   *  they can never drift apart again. Selection still overrides it (§9). */
  ambientGeometry: 4,

  /** MapLibre resting zoom — where recenter() returns the camera, and the
   *  planet-band framing the dive lands near. (The old introStart retired with
   *  the MapLibre opening sequence; the 3D arrival uses camera distance, §2.) */
  introRest: 2.2,
});

/* ---------------------------------------------------------------------------
 * ADMINISTRATIVE FURNITURE (§11) — borders and place names.
 *
 * All of it comes out of the OpenMapTiles `boundary` and `place` layers that
 * OpenFreeMap already serves us. No new source, no new request, no new bytes:
 * this data has always been inside the tiles we download, we simply were not
 * drawing it.
 *
 * The governing rule is RESTRAINT. This app already draws coast glow, coast
 * core, the graticule, tracks, cones, forecast points, wind bands, and the
 * watch/warning stripe. Every mark added here competes with storm data for the
 * same dark pixels, so each one arrives as late as it can still be useful and
 * stays dimmer than the coastline (§9 — reference, not content).
 * ------------------------------------------------------------------------- */

export const ADMIN = Object.freeze({
  /** Zoom each mark starts fading in. Ordered by how much space the mark
   *  occupies and how early the question it answers gets asked:
   *  "which country" before "which state" before "which state is this" before
   *  "which city". Nothing appears at the planet band — z0-2 belongs to the
   *  mesh, and a border there is noise over a globe you are still orienting on
   *  (§9 zoom ladder: no labels at the planet band). */
  countryLineIn: 2.4,
  stateLineIn: 3.4,

  /** THE NAME LADDER — three bands, each `[startZoom, endZoom]`.
   *
   *  Each name begins rising while the thing before it is still on screen, so
   *  the map dissolves from one label to the next instead of switching:
   *
   *    cage fades out  2.48 -> 3.86   (derived, see below)
   *    country rises   3.40 -> 4.00   overlaps the cage's last third
   *    country holds   4.00 -> 4.40
   *    state rises     4.20 -> 4.90   begins BEFORE country starts leaving
   *    country falls   4.40 -> 5.00
   *
   *  THIS USED TO BE ONE SHARED BAND — country ran 1->0 and state 0->1 across
   *  the same pair of numbers, which made them structurally incapable of
   *  drifting. That is a real thing to give up, and it was given up on purpose:
   *  a shared band can only ever produce an EXACT crossfade, and the effect
   *  wanted on glass is an offset overlap where both names are briefly up
   *  together. Independent bands are the only way to express that.
   *
   *  So the guarantee moves from "impossible to break" to "stated, and checked
   *  by sampling the whole zoom range":
   *
   *    THE INVARIANT — NEVER A NAMELESS GLOBE. From the moment the cage starts
   *    dissolving until cities arrive, at least one name is on screen at every
   *    zoom. `countryIn` must start before the cage is gone, and `stateIn` must
   *    start before `countryOut` ends. Move any of these six numbers and
   *    re-sample; a gap is invisible in the constants and obvious on glass.
   *
   *  `countryIn[0]` is DERIVED FROM `fade.cage`, which puts the cage fully gone
   *  at z3.86 (the crossfade band is zSpace..zHandoff and `fade.cage` ends at
   *  p 0.62). RECHECK IT if the DIVE choreography is ever retimed. */
  nameLadder: Object.freeze({
    countryIn: Object.freeze([3.4, 4.0]),
    countryOut: Object.freeze([4.4, 5.0]),
    stateIn: Object.freeze([4.2, 4.9]),
  }),
  /** Cities land LATE — well inside the regional band, close to the local
   *  one. Walked out twice on glass 2026-07-24: 4.6 -> 5.4 -> 6.4. Both
   *  earlier values put city names on screen while the question was still
   *  "which storm" or "which state", where they were pure clutter. By 6.4 the
   *  question is "where exactly does this come ashore", and that is the first
   *  point a city name is the thing you are actually trying to read. */
  cityIn: 6.4,

  /** Fade width in zoom levels. Marks arrive over roughly half a zoom step so
   *  they never pop; matched to the coast layers' own ramps. */
  fadeSpan: 0.8,

  /** `place.rank` ceiling for city labels. The schema ranks cities 1..10, most
   *  important first, and ranks ONLY notable places — an unranked village has
   *  no rank at all, so this filter is what makes "major cities" a real
   *  category rather than a guess. 10 admits every ranked city; label
   *  collision, sorted by that same rank, does the thinning from there.
   *  Lower this if the near bands feel crowded. */
  cityRankMax: 10,

  /** Country borders are `admin_level` 2; states and provinces are 4. The
   *  schema carries more levels (counties, districts) and they are deliberately
   *  never drawn — past state level this becomes an atlas, not a storm map. */
  levelCountry: 2,
  levelState: 4,
});

/* ---------------------------------------------------------------------------
 * FORECAST TIME LABEL PLACEMENT (§7)
 *
 * Consumed only by map/layers/label-placement.js. Every number the spoke
 * placement uses lives here — nothing in that file is a literal.
 *
 * These are unmeasured starting values. `spokePx` and `charWidthPx` are the
 * two worth tuning first against a real busy basin on a phone.
 * ------------------------------------------------------------------------- */

export const LABEL_PLACEMENT = Object.freeze({
  /** Distance from the forecast point to the label's centre, along the
   *  normal to the track. This is the spoke length — big enough that the
   *  label clears the (now larger) point circle and the track line. */
  spokePx: 26,

  /** Collision box estimate. We cannot measure rendered text without a
   *  canvas round-trip, and `datelbl` is a short predictable string, so
   *  width is estimated per character. Overestimating is the safe direction:
   *  it spreads labels rather than letting them touch. */
  charWidthPx: 6.2,
  lineHeightPx: 13,
  padPx: 3,

  /** How far from a perfect 50/50 split the two sides may sit before the
   *  balance pass stops trying. 1 means 4/5 is fine but 6/3 is not — a 7/1
   *  split reads worse than an even one even when nothing overlaps. */
  sideBalanceTolerance: 1,

  /** Placement recomputes on `moveend`, debounced by this. A pinch fires
   *  several moveends in a row on a phone; recomputing on each is wasted
   *  work the frame budget cannot spare. */
  recomputeDebounceMs: 90,
});

/* ---------------------------------------------------------------------------
 * GLOBE BEHAVIOR
 * ------------------------------------------------------------------------- */

export const GLOBE = Object.freeze({
  /** Fallback resting center when there is no home and no active storm.
   *
   * THE CONTIGUOUS UNITED STATES, not the mid-Atlantic. This used to be
   * [-52, 22] — a fixed view of the open Atlantic on the reasoning that the
   * basin is what Landfall watches. On glass that is the wrong answer to
   * "take me back": recentering dropped you on empty ocean with the coastline
   * you actually care about off the left edge. Home is the real reference
   * point and recenter uses it whenever one is set; this is only what happens
   * when there is no home to go to, and the honest default there is the
   * landmass, not the water. Roughly the geographic centre of the lower 48. */
  fallbackCenter: Object.freeze([-98.5, 39.5]),

  /** Zoom for "take me to my house" — tapping the home glyph on the globe.
   *  Inside the regional band (ZOOM.regional = 5): close enough that the
   *  coastline around home has real shape, far enough out that a storm two
   *  states away is still on screen. Not the local band, which is street
   *  grids and a view too tight to see weather coming. */
  homeZoom: 6,

  /** How far off north the camera has to be before the view control switches
   *  from crosshair to compass, in DEGREES.
   *
   *  Not zero: MapLibre's bearing is a float and a two-finger gesture almost
   *  never lands on exactly 0, so a zero test would leave the button showing a
   *  compass at 0.03° — a control offering to fix something nobody can see.
   *  Half a degree is under a pixel of rotation on a phone-sized globe. */
  northTolerance: 0.5,

  /** Idle auto-rotate. Stops INSTANTLY on interaction; disabled under
   *  OS reduce-motion.
   *
   *  THESE ARE NOW DEFAULTS, NOT FIXED VALUES (2026-07-25). Whether the globe
   *  drifts, how fast, and how long it waits are settings — the right answer
   *  is personal, and the same drift that makes the globe feel alive to one
   *  person makes it feel like it will not sit still to another. This file
   *  still owns what "sensible" means; data/settings-prefs.js owns what the
   *  user chose. */
  idleRotateDegPerSecond: 1.6,
  idleResumeDelay: 12 * SECOND,

  /** Slider bounds for the two idle-rotation settings. Behavioural limits, so
   *  they live here rather than in the view — same rule as the imagery
   *  sliders. The speed floor is deliberately not 0: "off" is the toggle's
   *  job, and a speed slider that can reach zero gives the user two different
   *  ways to stop the drift, one of which leaves the toggle lying. */
  autoRotateSpeedRange: Object.freeze({ min: 0.2, max: 8, step: 0.1 }),
  /** In SECONDS. Up to a minute — long enough to read a storm without the
   *  globe wandering off under it. */
  autoRotateDelayRange: Object.freeze({ min: 2, max: 60, step: 1 }),

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
   *  up-vector and flips the view.
   *
   *  88, not 82: at 82 the stop was hit early enough to feel like a wall.
   *  This is as close to the pole as the camera can get while staying stable.
   *  There is no value here that removes the stop — that would need pan-over-
   *  the-pole (continue past 90 by flipping longitude 180 and descending the
   *  far side), which is a different feature, not a bigger number. */
  keyPanMaxLat: 88,

  /** Zoom per +/- press. */
  keyZoomStep: 0.5,
});

/* ---------------------------------------------------------------------------
 * THE 3D CLEAR GLOBE + LOCKSTEP DIVE (SPEC §2, §9 — as-built)
 *
 * The wide "planet" view is a Three.js clear globe: a see-through wireframe
 * sphere with blue-family land, a floating cyan geodesic cage, storm severity
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
   *  a shape — nodes sat ~8° apart, wider than the spike. Detail 3 is 642
   *  nodes / 1,920 edges / 1,280 triangles — one draw call each, three total
   *  (the triangles are the storm-lit fill, SPEC §9). Counts corrected
   *  2026-07-24: this comment claimed 2,562/7,680, which is detail FOUR.
   *  [VERIFY] frame budget on a mid-range phone; the overriding lens is feel,
   *  and if it stutters this goes back to 2 and the spike widens instead. */
  geoDetail: 3,

  /** Cage radius as a multiple of the unit globe — the nodal network floats
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

  /** Where the storm tint STARTS and where it reaches full color, as fractions
   *  of a node's 0..1 lift. Everything below `onset` is pure resting cyan;
   *  everything at or above `full` is the storm's exact CATEGORY_COLOR; the
   *  gradient lives only in the band between.
   *
   *  This replaced a single `stormColorGamma` exponent, which was wrong in a way
   *  that only showed on glass: a curve applied across the WHOLE lift range
   *  spread tint over nodes that were barely raised at all, so a Cat 4 sat in a
   *  wide halo of muddy purple-grey (#736077, #516479) and the peak had to
   *  compete with its own smear. Worse, the peak never reached its true hue —
   *  a TS topped out at a murky #31A67B instead of CATEGORY_COLOR.TS.
   *
   *  The band is deliberately narrow and sits at the OUTER edge of the raised
   *  region: the lifted cage is solidly its storm color, and the fade to cyan
   *  happens across roughly one ring of nodes just past the last raised one.
   *  Widen the gap for a softer, broader transition; narrow it toward a hard
   *  edge. `onset` below the ~0.05 visible-lift threshold keeps color from
   *  arriving before height. */
  stormColorOnset: 0.06,
  stormColorFull: 0.30,

  /** Beyond this many sigmas, a storm point's contribution to a node is
   *  smaller than the cage's own base unevenness and cannot be seen. Nodes
   *  further out are skipped on a DOT PRODUCT — three multiplies — instead of
   *  paying for an `acos` that would round to nothing anyway.
   *
   *  WHY IT MATTERS NOW: with one point per storm the influence loop was
   *  642 nodes x ~15 points and the cost was invisible. Following the whole
   *  track multiplies the point count by ~20, and every node was measuring
   *  its angle to every point on the planet, including storms in the other
   *  hemisphere. 3 sigma is exp(-4.5) ~ 1.1% of a point's lift — below
   *  `baseLump`, so nothing that survives this cutoff was ever visible. */
  influenceCutoffSigma: 3,

  /** Grey storm-position dots ON the 3D globe surface at the planet band
   *  (SPEC §9 zoom ladder: "grey position glyphs"). Riding just above the
   *  land so they never z-fight the fill; the cage floats far above at
   *  cageRadius. They fade with the nodes during the dive, handing off to
   *  MapLibre's own grey dots as the map fades in. */
  stormDotRadius: 1.012,

  /* --- FADE CHOREOGRAPHY (crossfade progress p, 0..1) --------------------- *
   * p is derived from the live MapLibre zoom (see zSpace/zHandoff), NOT a
   * timeline — you drive it by zooming. Each pair is [start, end] of a
   * smoothstep.
   *
   * LAND AND COAST GO FIRST, deliberately inverted from the cage and nodes.
   * They used to hold until 0.62 (z3.9) while mapIn completed at 0.30 (z2.9),
   * so for a full zoom level TWO opaque planets were stacked: the 3D globe's
   * far-side grey coastline composited over a finished MapLibre canvas, which
   * read on glass as a shadow lying across storm tracks and cones. It is not a
   * depth bug and cannot be fixed with renderOrder or depthWrite — the two
   * renderers are separate canvases with separate depth buffers and cannot
   * occlude each other, so opacity is the only lever.
   *
   * The rule now: the moment MapLibre can draw coastlines itself, the 3D
   * versions are duplicated information and must be gone. The cage and nodes
   * are the planet-band AESTHETIC, not duplicated data, so they still linger
   * and are the last thing to dissolve.
   *
   * THE CAGE'S LINGER IS NOT A BUG, and pulling it in does not fix shadowing.
   * These were briefly shortened to 0.10-0.40 to chase far-side lattice
   * appearing over storm tracks. That was treating a symptom: the real cause
   * was NORMAL BLENDING on the far-side land and coast, which painted fogged
   * near-black over MapLibre (see matLandBack in globe3d.js). Those surfaces
   * are additive now and cannot darken anything beneath them, so the cage is
   * free to dissolve slowly again — which is what makes the handoff feel like
   * a dive instead of a cut. Restored to 0.14-0.60 / 0.16-0.62.
   *
   * If something in the 3D scene ever appears to shadow MapLibre content
   * again, check its BLENDING before touching these numbers. */
  fade: Object.freeze({
    nodes:    Object.freeze([0.14, 0.60]),
    cage:     Object.freeze([0.16, 0.62]),
    land:     Object.freeze([0.10, 0.30]),
    mapIn:    Object.freeze([0.00, 0.30]),
    spaceOut: Object.freeze([0.00, 0.34]),
  }),
});

/* ---------------------------------------------------------------------------
 * MESH TRACK — the cage ridge that follows a storm's whole path (SPEC §9)
 *
 * The cage lifts over storms. By default it lifts over ONE position each: the
 * current fix. Set to `track`, it lifts over the storm's past positions and
 * its forecast positions too, each at that position's own intensity — the
 * globe grows a ridge along the whole path instead of a single peak.
 *
 * HEIGHT IS INTENSITY. NOTHING ELSE. A bead stands at the wind speed measured
 * (or forecast) at that position, so the tallest point on a storm's ridge is
 * its strongest point — past, present or future — wherever that falls.
 *
 * IT USED TO TAPER WITH AGE AND LEAD TIME AND THAT WAS WRONG (removed
 * 2026-07-25, on glass). The argument for it was that a forecast rendered as
 * tall as a measurement is a prediction drawn as fact (§5). Two things kill it:
 *
 *   1. IT BROKE §9's CENTRAL INVARIANT. Color is each position's true category
 *      and was never tapered, so a Cat 4 three days old rendered SHORT and red
 *      beside a taller orange Cat 2. "Elevation and color are one signal from
 *      one number" — the taper made height a blend of intensity and recency
 *      while color stayed pure intensity, which is exactly the drift this app
 *      has already fixed once at this seam.
 *   2. NOTHING ELSE IN THE APP DIMS THE FORECAST. Cones, forecast tracks,
 *      forecast wind bands and forecast dots all draw at full strength.
 *      "This is a forecast" is carried by shape and line grammar (§7), never
 *      by rendering it fainter. The cage was the only surface arguing
 *      otherwise.
 *
 * WHERE THE STORM IS NOW is not height's question to answer. The live fix
 * carries the spiral glyph and it is the ONLY point that does (§9), so the
 * present position stays unmistakable without borrowing a channel that
 * belongs to severity.
 */

export const MESH_TRACK = Object.freeze({
  /** How far back the ridge reaches, in hours. The feeds carry a storm's
   *  ENTIRE life — NHC's past points ran 28 fixes deep on Fausto (§4), which
   *  is a week — and a week of track wraps a third of the planet. Three days
   *  reads as a path; more reads as a smear. */
  pastHours: 72,

  /** How far ahead the ridge reaches, in hours. NHC forecasts to +120 h;
   *  matching `pastHours` keeps the ridge symmetric about the storm. The last
   *  two days of a five-day forecast are also where the cone is widest and
   *  the track least certain, so they are the cheapest hours to leave off. */
  forecastHours: 72,

  /** Hard cap on ridge points per storm after windowing. NHC past fixes are
   *  6-hourly, so 72 h is ~12 points, and forecast taus inside 72 h are ~7
   *  more — around 20 in normal conditions. This is the guard against a
   *  source that starts publishing hourly, not a routine trim: hitting it
   *  thins by dropping every other point rather than truncating, so a capped
   *  ridge still spans the whole window. */
  maxPointsPerStorm: 24,
});

/* THE SCOPE FILTER IS GONE, retired 2026-07-25.
 *
 * It was three buttons — All / My basin / Near me — sitting above a list that
 * has never held more than nine rows. A filter earns its space by removing
 * work; scrolling past two storms is not work, and the control cost a row of
 * chrome at the top of the one surface that is also the app's whole
 * accessibility layer. Home still SORTS the list (nearest first) and still
 * puts a distance on every row, which is the part that was actually doing
 * something. `SCOPE`, `SCOPE_RADIUS_NM`, `filterByScope`, and
 * `availableScopes` all went with it rather than being left as dead exports.
 */

/* ---------------------------------------------------------------------------
 * CLOSEST APPROACH (SPEC §8)
 *
 * A great-circle minimum over a 5-day track is easy to compute and easy to
 * report as nonsense, because the shortest path between two far-apart points
 * does not run the way a map makes it look.
 *
 * MEASURED, NOT ASSUMED. NOUL-26 from a Baton Rouge home (-91.0, 30.35) reads
 * 7,315 nm now and 7,085 nm at its forecast minimum — closer every hour,
 * because the great circle from Louisiana to the West Pacific crosses Alaska.
 * The geometry is right. The sentence "closest approach in 2 days" built from
 * it, over a typhoon bound for Taiwan, is not.
 *
 * A CYCLONE IS EPHEMERAL, NOT ORBITAL. It lives days and dies, and it never
 * comes round the far side. So an approach is only a real approach when the
 * storm is near enough for the track to mean anything, far enough ahead to be
 * a forecast rather than the present moment, and closing by enough to be more
 * than track wobble. These three numbers are those three tests.
 * ------------------------------------------------------------------------- */

export const APPROACH = Object.freeze({
  /** Great-circle distance, NAUTICAL MILES, beyond which a storm is "never
   *  near home" no matter what its track does.
   *
   *  ITS JOB SHRANK, DELIBERATELY. It used to decide whether an approach was
   *  reported at all, which made it a story-switch: two East Pacific storms
   *  both bound for Hawaii, 1,408 nm and 2,368 nm out, read as two completely
   *  different situations because one fell either side of the line. Now it
   *  only picks which true sentence to use about a storm that IS closing, and
   *  a storm drifting across it changes a few words rather than the meaning.
   *  1,500 nm is roughly a basin's width. */
  relevanceNm: 1500,

  /** How much nearer the storm must actually get, NAUTICAL MILES, before its
   *  track counts as bringing it closer at all. Also the deadband for the
   *  list-row trend.
   *
   *  THIS IS NOW THE MAIN TEST, because it is what the words on screen claim:
   *  "never closer than current position" is a statement about the track, not
   *  about distance. Under this margin the storm is at its nearest now and the
   *  rest is arithmetic noise — a storm passing broadside crosses its minimum
   *  almost flat, and without a deadband the label flips between polls. Well
   *  under NHC's ~100 nm three-day track error, so it never suppresses a real
   *  approach. */
  minGainNm: 25,

  /** How far ahead the LIST ROW projects a storm along its published heading
   *  and speed, HOURS. The list has no forecast track — geometry is fetched
   *  only on selection — so the row trend is dead reckoning from `headingDeg`
   *  and `speedKt`. At a typical 12 kt that is ~144 nm of travel, comfortably
   *  past the deadband above while staying inside the window where a storm
   *  holds its heading. */
  trendProbeHours: 12,
});

/* ---------------------------------------------------------------------------
 * HOME MARKER (SPEC §9 — "The home marker (as-built)"; §8 is the home FEATURE
 * set, this is how it draws)
 *
 * Home floats ABOVE the node lattice, tethered to its exact surface point.
 * Three visibility states, and the state machine is the hard part:
 *
 *   ON_GLOBE  — on the near hemisphere AND inside the viewport.
 *               Marker at altitude + tether. No pointer.
 *   OVER_LIMB — on the FAR hemisphere (behind the planet). Pointer rides the
 *               limb, bobbing, at the great-circle crossing toward home.
 *   OFF_SCREEN— near hemisphere but outside the viewport (zoomed in). Pointer
 *               clamped to the viewport edge instead of the limb.
 *
 * The altitude curve is the reason this feels like floating instead of a
 * sticker. A FIXED altitude looks right from far out and drifts off the house
 * up close (parallax grows with proximity). So altitude SHRINKS with zoom:
 * high at the planet band, nearly touching down by the time you can see a
 * street. Expressed in EARTH RADII so it scales with the globe automatically —
 * "moves with the radius of the earth," per Aaron.
 *
 * Every value here is a GUESS until measured on glass. That is the whole
 * reason they live in one block.
 * ------------------------------------------------------------------------- */

export const HOME = Object.freeze({
  /** Altitude above the surface, in EARTH RADII, at the far end of the zoom
   *  ladder (whole globe in frame).
   *
   *  RAISED 0.06 → 0.16 on glass: at the planet band the 3D clear globe sits
   *  at DIVE.spaceDistance with a SMALL on-screen radius, so 0.06·R came out
   *  a few pixels and the marker was buried in the node lattice — invisible at
   *  exactly the zoom where it most needs to say "your home is over here." The
   *  altitude has to clear the lattice in SCREEN terms, and out there the
   *  screen radius is small. */
  altFar: 0.16,

  /** Altitude in earth radii once zoomed in past the ladder's near end. Not
   *  zero: a marker sitting flat ON the surface stops floating and gets lost
   *  in the lattice. Small enough that parallax can't push it off the house. */
  altNear: 0.004,

  /** The zoom band the altitude curve interpolates across. Deliberately the
   *  SAME band as the storm-dot crossfade so the two reads change together
   *  rather than at two unrelated moments. */
  altZoomFar: ZOOM.planet,
  altZoomNear: ZOOM.regional,

  /** Tether: the line from the marker down to its exact surface point. This is
   *  what makes the altitude legible — without it, "floating" is ambiguous
   *  with "offset by accident." Width in screen px, constant. */
  tetherWidthPx: 1.5,

  /** Tether fades toward the surface end rather than butting into the lattice
   *  with a hard stop. Opacity at the marker end and at the ground end. */
  tetherOpacityTop: 0.85,
  tetherOpacityBase: 0.15,

  /** DIRECTLY-OVERHEAD DEADZONE — measured in SCREEN space, not angle.
   *
   *  When the camera sits directly over home the surface normal points at the
   *  lens, its screen projection is zero, the tether direction is undefined,
   *  and sub-pixel noise spins it. Measured: 26.6° of swing per 0.1° of camera
   *  movement at 0.2° off centre. That is "wobbling all around like crazy."
   *
   *  THE FIRST FIX USED AN ANGULAR THRESHOLD AND THAT WAS WRONG. Foreshorten
   *  is sin(angle from the view axis), so a 0.05 cutoff means 2.9° of arc —
   *  but past z5 the ENTIRE VISIBLE MAP is only a degree or two wide, so every
   *  on-screen point fell inside the deadzone and the tether never drew at
   *  all. That is the regression Aaron saw as "we lost the tether."
   *
   *  These are a FRACTION OF THE GLOBE'S ON-SCREEN RADIUS instead: how far the
   *  anchor sits from the projected globe centre, in pixels, over the globe's
   *  pixel radius. Scale-free — it behaves identically at z0 and z8, because
   *  both terms grow together. The wobble only ever happens when the anchor is
   *  genuinely within a few pixels of the disc centre, which this measures
   *  directly. */
  overheadDeadzone: 0.012,
  overheadFadeBand: 0.05,

  /** MINIMUM VISIBLE TETHER LENGTH, in screen px.
   *
   *  The foreshortened normal is geometrically correct and PRODUCT-WRONG on
   *  its own. Once zoomed past the basin band, home sits within a degree or
   *  two of the view centre in almost every frame, so the true projected
   *  altitude collapses below a pixel and the tether vanishes — which is
   *  exactly the regression Aaron caught: "we lost the tether, home looks like
   *  it's sitting directly on the globe."
   *
   *  The tether is a UI AFFORDANCE, not a physics readout. Its job is to say
   *  "this mark floats above THAT point," and it has to keep saying that at
   *  street zoom. So the drawn length is max(trueProjected, this), and the
   *  overhead deadzone below only kills it in the genuinely degenerate case
   *  where there is no direction to draw at all. */
  tetherMinPx: 26,

  /** Full tether length at the far end, in screen px — the ceiling the
   *  foreshortened value is allowed to reach at the planet band. Keeps the
   *  marker clear of the node lattice without launching it into space. */
  tetherMaxPx: 64,

  /** Marker glyph size in SCREEN px — constant, like the storm glyph. A home
   *  marker is a position, not an area. Hit area is SIZE.touchTarget. */
  markerPx: 22,

  /** The surface point gets its own small anchor dot, so the tether visibly
   *  lands ON something. */
  anchorPx: 5,

  /** Anchor dot opacity when the surface point is visible. Deliberately under
   *  1: the dot is a reference mark, and at full strength it competes with the
   *  house for attention when both are on screen.
   *
   *  It drops to 0 the moment the surface point goes behind the limb. The dot
   *  asserts "home is exactly here," and once the point is occluded that is no
   *  longer true — the tether foot is clamped to the silhouette, which is a
   *  direction, not a location. */
  anchorOpacity: 0.55,

  /* --- the off-screen pointer ------------------------------------------- */

  /** Pointer assembly size in screen px — the house is scaled from this and
   *  the arrow is smaller again (see pointerParts). Slightly larger than the
   *  marker: it carries more meaning (identity AND direction) and often sits
   *  near a screen edge competing with chrome. */
  pointerPx: 28,

  /** Gap between the house's centre and the arrow's centre, along the axis
   *  pointing at home. Both marks sit on that one imaginary line: house, then
   *  arrow, then (off screen) home. Big enough that they read as two marks in
   *  a row rather than one overlapping blob. */
  pointerAxisGapPx: 21,

  /** Clearance the pointer keeps from on-screen chrome (control cluster, storm
   *  pill, status strip, open panels). A direction indicator that slides under
   *  a button is both unreadable and untappable, so it walks AROUND obstacles
   *  rather than rendering beneath them.
   *
   *  RAISED 12 → 20 on glass: at 12 px the pointer cleared the buttons
   *  technically but sat visually welded to them. This is the gap between the
   *  pointer's HIT BOX edge and the obstacle, and the glyph inside that box is
   *  smaller than the box, so the apparent gap is larger than the number —
   *  which is why it needs to be generous to read as deliberate spacing rather
   *  than a near-miss. */
  pointerChromeClearancePx: 20,

  /** Padding used when deciding whether home is HIDDEN BEHIND chrome — a
   *  separate question from where the pointer may sit, and a separate number.
   *
   *  Home sliding under the storm drawer is invisible to the user, so the
   *  pointer must appear even though home is still inside the viewport
   *  rectangle. Testing bounds alone (the first pass) left the marker
   *  officially "on screen" while it sat behind an opaque panel.
   *
   *  Smaller than the pointer clearance on purpose: this asks "can the user
   *  actually see it," so a marker a few px from a panel edge is still visible
   *  and should NOT flip to the pointer. Overshooting here would make the
   *  marker vanish while it is plainly on screen, which is worse than the bug
   *  it fixes. */
  occlusionPaddingPx: 4,

  /** Inset from the limb, in screen px, so the pointer sits just OUTSIDE the
   *  silhouette rather than half-buried in the planet's edge. */
  pointerLimbInsetPx: 14,

  /** Minimum distance from any viewport edge, in screen px. SPEC §10: nothing
   *  important within a thumb-width of an edge where the OS eats the gesture.
   *  Derived from the touch target, not hand-set. */
  pointerEdgeMarginPx: 44,

  /** The bob. Perpendicular to the limb — the pointer nudges OUTWARD along the
   *  axis it points and settles back. A vertical bob on a curved rim reads
   *  wrong at the sides. Amplitude in screen px; transform only. */
  bobAmplitudePx: 5,
  bobPeriodMs: 2600,

  /** Under prefers-reduced-motion the bob is DAMPENED, not removed. A few px
   *  of local travel on a 44 px control is not the large-area parallax that
   *  setting guards against, and the movement is what makes the pointer
   *  findable against a busy globe. */
  bobReducedScale: 0.4,

});

/* ---------------------------------------------------------------------------
 * GEOCODING (SPEC §8)
 *
 * Mapbox, proxied through /api/geocode. The token is a Pages environment
 * variable and NEVER reaches the client — a key in a static bundle is a public
 * key, and a stolen geocoding key bills until someone notices.
 *
 * Autocomplete fires per keystroke, so it is debounced and floored at a
 * minimum length. Both are cost controls as much as UX ones.
 * ------------------------------------------------------------------------- */

export const GEOCODE = Object.freeze({
  /** Wait this long after the last keystroke before asking. 250 ms is below
   *  the threshold where typing feels laggy and still collapses a fast typer's
   *  10-character burst into one request instead of ten. */
  debounceMs: 250,

  /** Don't ask at all below this. Two characters match half the planet and
   *  bill for the privilege. */
  minChars: 3,

  /** Suggestions shown. More than this and the list becomes a scroll surface
   *  competing with the globe on a phone. */
  maxResults: 5,

  /** A geocode result is a GUESS. Confidence below this shows the
   *  "drag to adjust" hint prominently rather than as a quiet affordance —
   *  a wrong home silently poisons every distance downstream (SPEC §8). */
  lowConfidence: 0.7,

  /** Zoom the camera flies to when a result is picked. ZOOM.max is a hard z8
   *  ceiling (§11 — past it you pull in street grids, which wreck the
   *  lit-globe look), so confirmation happens at the top of the local band,
   *  not at street zoom. This is the real constraint on address confirmation:
   *  you are checking the right neighborhood and coastline, not the right
   *  driveway. Dragging the pin is what gets you the last few hundred metres. */
  confirmZoom: ZOOM.local + 1,
});

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

  /** GDACS per-event geometry. CONFIRMED LIVE 2026-07-24 — and note this is
   *  the FALLBACK form only: every event in the list feed publishes its own
   *  `url.geometry`, which data/gdacs-geometry.js prefers. Recorded here so
   *  the shape is written down somewhere (the 2026-07-23 probe measured this
   *  endpoint's timing but never recorded its URL, which cost a round trip). */
  gdacsGeometry: 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry',

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

  /** Phase 4 layers are resolved BY NAME within the storm's confirmed block,
   *  not by hardcoded offsets. Reason: only the two offsets above were ever
   *  confirmed on the live service (probe 2026-07-23); the other six were
   *  never recorded, and inventing them from memory would put an unverified
   *  number on a safety-adjacent path. One cached metadata fetch
   *  (`MapServer?f=json`, same CORS-OK host) lists every layer's name and id;
   *  matching inside [base, base+26) keeps the confirmed block math
   *  authoritative and self-corrects if NHC ever reorders within a block. */

  /* CONFIRMED against the live layer list 2026-07-24 (/api/nhc/inspect).
   * Every block is 26 layers with these EXACT names, prefixed by the bin:
   *   +0  AT1                              (group)
   *   +1  AT1 Forecast Information         (group)
   *   +2  AT1 Forecast Points
   *   +3  AT1 Forecast Track
   *   +4  AT1 Forecast Cone
   *   +5  AT1 Watch-Warning
   *   +6  AT1 Past Track Infomation        (group — NOAA's typo, not ours)
   *   +7  AT1 Past Points
   *   +8  AT1 Past Track
   *   +9  AT1 Past Cumulative Wind Swath
   *   +10 AT1 Past Wind Radii
   *   +11 AT1 Wind Information             (group)
   *   +12 AT1 Forecast Wind Radii
   *   +13 AT1 Advisory Wind Field
   *   +14 AT1 Arrival Time of TS Winds     (group)
   *   +15 AT1 Earliest Reasonable Arrival Time
   *   +16 AT1 Most Likely Arrival Time
   *   ...then inundation and tidal mask groups.
   *
   * PAST vs FORECAST IS THE TRAP, and it cost a day. Four layer names carry
   * "wind": Past Cumulative Wind Swath, Past Wind Radii, Forecast Wind Radii,
   * Advisory Wind Field. A pattern matching `wind.*swath` hits the PAST swath
   * first and silently draws where the storm has ALREADY BEEN under a label
   * reading "Full track" — which is the §5 asymmetry violation in its purest
   * form, and which is what shipped. Every wind pattern below therefore
   * excludes `past` explicitly rather than relying on match order.
   *
   * Resolution is still BY NAME, not by offset: the offsets above are now
   * known, but a name match survives NOAA inserting a layer, and the guards
   * below make a wrong match loud rather than silent. */
  layerName: Object.freeze({
    cone:           /forecast\s+cone/i,
    forecastTrack:  /forecast\s+track/i,
    forecastPoints: /forecast\s+points/i,
    pastTrack:      /past\s+track$/i,
    watchWarning:   /watch-?\s*warning/i,

    /* windCurrent — the wind field at the storm's CURRENT position. */
    windCurrent:    /advisory\s+wind\s+field/i,

    /* windSwath — FORECAST wind radii, the per-forecast-hour polygons ahead
     * of the storm. Anchored on "forecast" and explicitly not "past". */
    windSwath:      /forecast\s+wind\s+radii/i,

    /* windPast — PAST wind radii (+10), the per-synoptic-time quadrant
     * polygons behind the storm. NOT "Past Cumulative Wind Swath" (+9),
     * the rasterized merged product this app must never draw — "radii"
     * anchors it clear. Feeds the swept envelope's past tier (§4). */
    windPast:       /past\s+wind\s+radii/i,

    /* pastPoints — Past Points (+7), the past-tier CENTRES, joined to
     * windPast on the 10-digit synoptic time (+7.dtg ↔ +10.synoptime,
     * measured live §4). Anchored so it cannot touch "Forecast Points" or
     * the "Past Track Infomation" group. */
    pastPoints:     /past\s+points/i,
  }),

  /** Service metadata cache. The layer list changes when NOAA redeploys the
   *  service, not per advisory — a day is conservative. */
  metadataTtl: 24 * HOUR,

  /** ArcGIS uses 9999 as a missing-value sentinel on geometry properties
   *  (CONFIRMED live 2026-07-23 on mslp/tcdir/tcspd beyond tau=0). It is
   *  finite, survives isFinite, and renders as "Pressure 9999 mb" unless
   *  scrubbed to null in the geometry parser. */
  nullSentinel: 9999,

  /** Peak Storm Surge is its OWN MapServer with NO stormid field — filter
   *  spatially by an envelope around the storm's position. */
  surgeService: 'NHC_PeakStormSurge',
  surgePolygonLayer: 2,
});

/* ---------------------------------------------------------------------------
 * WIND SWATH SWEEP (SPEC §4 — three tiers, one envelope)
 *
 * Tuning for lib/windswath.js, which merges the past/current/forecast
 * quadrant rings into ONE smooth envelope per threshold. Aaron's call, and
 * the direct-draw ring stack was rejected on looks: overlapping translucent
 * fills compound, and beauty is a driving factor of this app. NHC's own
 * merged product (+9) is rasterized (100% axis-aligned edges, measured
 * 2026-07-24), so the clean outline is built here from the same published
 * quadrant numbers NHC built theirs from. The cosine blend cannot overshoot
 * issued radii and linear interpolation between published points is bounded
 * by its endpoints — the envelope never claims wind outside NHC's numbers.
 * ------------------------------------------------------------------------- */

export const WIND_SWEEP = Object.freeze({
  /** Track resample step, nautical miles. 6-hourly fixes sit ~70–150 nm
   *  apart; 10 nm keeps bearing changes gradual across joints (the central
   *  difference smooths the rest) at a vertex cost far below any frame
   *  concern (~450 boundary points per threshold on a 5-day storm). */
  stepNm: 10,

  /** Fan samples across each 180° end cap. 24 ≈ 7.5° per step — visually
   *  circular at every zoom the app allows, cheap. */
  capSamples: 24,

  /** Samples for the degenerate single-point run (a threshold published at
   *  exactly one time). 72 = 5° steps, matching NHC's own per-degree
   *  construction closely enough to sit flush beside it. */
  ringSamples: 72,

  /** A past point this close to the current position (degrees, per axis) is
   *  the same fix — dropped so the tier seam carries no zero-length segment
   *  (§4). Value from the spec. */
  coincideDeg: 0.05,

  /** Hard ceiling on resample steps per run. A pathological track widens
   *  its step rather than exploding the vertex budget — jank is worse than
   *  a slightly coarser outline (§9: feel is the overriding lens). */
  maxSamples: 2000,

  /** Iterated 3-point averaging passes over the resampled centres and
   *  quadrant values BEFORE offsetting. This is THE smoothness dial —
   *  Aaron's call after the first on-glass look (2026-07-24): the linear
   *  blend carried a corner through every 6-hourly fix and the walls
   *  mirrored every track wobble. Gaussian-equivalent sigma ≈
   *  sqrt(passes/2)·stepNm ≈ 22 nm at 10. Bounded: smoothed radii stay
   *  between neighbours (never above any published value); centres drift
   *  only where the track curves, by less than the track's own deviation
   *  in the window. 0 restores the exact piecewise-linear sweep. */
  smoothPasses: 10,

  /** Averaging passes on the final closed ring — rounds wall/cap junctions
   *  and rounds residual despike corners. Runs on the UNIFORMLY RESAMPLED
   *  ring (see lib/windswath.js — on irregular spacing this same pass
   *  SHARPENED angles). Can nudge concave vertices outward by
   *  the sagitta at one step's spacing (a couple nm, worst case); see the
   *  bound note in lib/windswath.js. */
  ringSmoothPasses: 3,

  /** A boundary vertex turning more than this (degrees) ON SHORT SEGMENTS
   *  is a wall fold and is cut. Genuine features turn less or ride
   *  step-length segments — see the despike note in lib/windswath.js. */
  spikeTurnDeg: 100,

  /** "Short" for the fold test, nm. Just over half the resample step:
   *  fold vertices bunch far below step spacing; honest vertices sit at
   *  it. */
  spikeMaxSegNm: 6,
});

/* ---------------------------------------------------------------------------
 * BASEMAP TILES (SPEC §11)
 *
 * Protomaps, self-hosted on Cloudflare R2, capped at z8, served through the
 * Pages Function tile proxy at `functions/tiles/[[path]].js`. The proxy reads
 * single tiles out of the 525 MB .pmtiles archive in the bucket and stamps
 * them cache-forever (coastlines don't move), so tiles cache at Cloudflare's
 * edge AND in the browser. The client never talks to the bucket directly and
 * never loads the pmtiles library — it just fetches ordinary tile URLs.
 *
 * The archive's R2 object key lives in the function file, not here — it is a
 * server-side concern, and the function is deliberately self-contained rather
 * than importing client config across the functions/ boundary. The two files
 * cross-reference each other by comment.
 *
 * Still outstanding: `glyphs` in style-dark.js points at OpenFreeMap's font
 * endpoint regardless of this flag, so text layers (storm names, live since
 * Phase 2) fetch from OpenFreeMap even on R2 tiles. Self-hosting fonts in the
 * same bucket is a separate decision — see SPEC §15.
 * ------------------------------------------------------------------------- */

export const TILES = Object.freeze({
  /** OpenFreeMap is the basemap. The R2/Protomaps path — still carried by
   *  style-dark.js and coast-source.js — is OFF: its tile proxy cold-reads
   *  each tile out of a 525 MB archive, so panning to new areas lagged, and
   *  its land-polygon schema fragments the outer coast into separate barrier
   *  islands, which breaks watch/warning coast tracing. OpenMapTiles' ocean-
   *  polygon coast is continuous and traces cleanly. Set true to revive R2. */
  useR2: false,

  /** The tile proxy, absolute on purpose: a local dev server has no Pages
   *  Functions, so relative URLs would 404 in dev. The proxy sends
   *  `Access-Control-Allow-Origin: *`, which is what lets localhost fetch
   *  these cross-origin. */
  tilesUrl: 'https://landfall.getgravitate.app/tiles/{z}/{x}/{y}.mvt',

  /** The archive's zoom ceiling (SPEC §11 — a design decision, not a budget
   *  one). MapLibre needs this on the source to overzoom z8 data past z8
   *  instead of requesting tiles that don't exist. */
  sourceMaxzoom: 8,

  /** SPEC §11 names OpenFreeMap as the legitimate fallback if self-hosting
   *  becomes a burden.
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
  /* Display preferences that are NOT layer choices. Separate key from
   * `layers` because layer state carries phase-gating rules that display
   * preferences do not, and merging them would put an unshipped-layer guard
   * in front of a setting that has no phase. */
  settings: 'landfall.settings',
  /* NO 'models' KEY, deliberately — retired unbuilt 2026-07-25. Which models
   * draw is a SUB-CHOICE of the model-tracks layer, so it lives inside the
   * `layers` record above rather than in a store of its own. A third
   * preference store is the point at which data/settings-prefs.js says to
   * extract a shared factory (§12), and inventing one for state that already
   * has a rightful owner would spend that refactor on nothing. */
  home: 'landfall.home',
  units: 'landfall.units',
  theme: 'landfall.theme',
  /* NO 'scope' KEY — the scope filter was retired 2026-07-25 (see the note
   * where SCOPE used to live). A stored value for a control that no longer
   * exists is a key nothing will ever read again. */
  sections: 'landfall.sections',
  lastVisit: 'landfall.lastVisit',
  /* First-run nudge state (home prompt, install hint) — ui/first-run.js. */
  firstRun: 'landfall.firstRun',
});

/* ---------------------------------------------------------------------------
 * FIRST-RUN NUDGES (ui/first-run.js) — §14 Phase 5.
 * One-time hints, never nags: each shows once and its dismissal persists.
 * ------------------------------------------------------------------------- */
export const FIRST_RUN = Object.freeze({
  /** How long after boot the "set your home" hint waits. The entry moment
   *  belongs to the globe — a callout talking over the opening animation
   *  reads as an ad. Long enough for the scene to settle and the user to
   *  have looked at it. */
  homeNudgeDelayMs: 8000,

  /** Pause between home being set and the install hint. Setting home opens
   *  a panel flow; the hint waits for that moment to finish rather than
   *  landing on top of the confirmation. */
  installNudgeDelayMs: 2500,
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

/** Nominal top of the scale, knots. Cat 5 is OPEN-ENDED (137 kt and up), so it
 *  has no arithmetic middle of its own; this supplies one. 155 kt sits between
 *  the Cat 5 floor and the strongest storms on record, so a Cat 5's
 *  representative wind lands high without pretending to be a record.
 *
 *  Used ONLY to derive class midpoints (lib/category.js `representativeKt`).
 *  It is NOT a threshold, NOT a cap on real measured wind, and nothing
 *  classifies against it — a storm reporting 180 kt is still read as 180 kt
 *  everywhere the actual number is known. */
export const CATEGORY_TOP_KT = 155;


/** Wind band thresholds in knots. */
export const WIND_BAND_KT = Object.freeze([34, 50, 64]);

/* ---------------------------------------------------------------------------
 * COAST BAND (SPEC §7)
 *
 * NHC publishes watch/warnings as BREAKPOINTS — named coastal reference
 * points — and the MapServer joins them with straight lines. Measured live on
 * Bertha, 2026-07-23: 11 vertices over 464 km, median spacing 51 km, max 70.
 * Drawn as delivered, that chords across every bay.
 *
 * The fix is a WIDE-BAND SELECT (map/coast-band.js): buffer the breakpoint
 * line into a corridor and paint every loaded coast segment inside it the
 * warning color. Deliberately wide — a watch/warning is issued for an AREA,
 * and every bay, inlet, and barrier island inside it is under the warning.
 * ------------------------------------------------------------------------- */

export const COAST_BAND = Object.freeze({
  /** THE ONE KNOB: corridor half-width in km, set GENEROUS on purpose.
   *  Prototyped 2026-07-24 against Bertha's live TWR (8 breakpoints,
   *  Matagorda→Vermilion Bay) at 15/25/35/50 km: 15 caught only half of
   *  Galveston Bay; 35 painted the full Galveston–Trinity–Sabine bay system;
   *  50 additionally reached the inner Matagorda Bay shore near the western
   *  breakpoint. Aaron picked 50 off the prototype panels — wider wins
   *  ("cast a wide band"; a warning is issued for an AREA and the bays are
   *  in it). Jumping to a genuinely different, unwarned stretch of coast is
   *  the only failure to avoid, and the flat end caps handle that. */
  halfWidthKm: 50,

  /** Below this many coast vertices, don't attempt a select at all. A handful
   *  of vertices from one half-loaded tile produces a confident-looking band
   *  in the wrong places, which is worse than the honest chord (§5). The
   *  2026-07-23 probe measured 3720 vertices at z6.4, so a real coast clears
   *  this by an order of magnitude. */
  minCoastVertices: 200,

  /** Tile-boundary filter. A tile-clipped ocean polygon's ring is part real
   *  shoreline and part straight tile edge; painting a tile seam as warned
   *  coastline is a confident wrong line (§5). An edge is dropped when it is
   *  EXACTLY axis-aligned (within tileEdgeEpsDeg — float slack around the
   *  tile boundary's constant coordinate, ~0.1 m) AND at least tileEdgeMinKm
   *  long (~2 grid quanta at z6, so quantized real coastline survives). Cost
   *  of a false drop is an invisible gap in a thick stripe; cost of a false
   *  keep is a straight blue seam across the map. Err toward dropping. */
  tileEdgeEpsDeg: 1e-6,
  tileEdgeMinKm: 0.25,

  /** Debounce before re-selecting after the camera settles. Coast vertices
   *  arrive as tiles load, so the first select after selection is often made
   *  against a half-loaded coast; re-selecting lets it sharpen. Debounced
   *  because a pinch fires several moveends in a row on a phone — the same
   *  reasoning as LABEL_PLACEMENT.recomputeDebounceMs. The cache guarantees
   *  a re-select can only improve the result, never degrade it. */
  reselectDebounceMs: 400,
});

/**
 * GDACS per-event geometry shape.
 *
 * EVERY VALUE HERE WAS READ OFF LIVE DATA on 2026-07-24 via
 * `/api/gdacs/inspect?event=1001294&episode=6` (NOUL-26, Northwest Pacific).
 * Nothing in this block is inherited from the HA project — the inherited
 * version of it was WRONG about the thresholds, which is exactly why the
 * inventory happened first.
 *
 * The payload is one FeatureCollection, 44 features for that storm, sorted
 * by two properties:
 *   `Class`       — "Poly_Green" | "Poly_Orange" | "Poly_Red" | "Poly_Cones"
 *                   | "Line_Line_N" | "Point_Polygon_Point_N" | "Point_Centroid"
 *   `featuretype` — "WindRadii" (the bands) | "PointRadii" (per-timestep dots)
 */
export const GDACS_GEOMETRY = Object.freeze({
  /**
   * THE BAND THRESHOLDS — the finding that killed the inherited claim.
   *
   * SPEC used to say Green/Orange/Red were the 34/50/64 kt NHC thresholds.
   * They are NOT. GDACS works in ROUND METRIC numbers, published in each
   * band's own `polygonlabel`:
   *
   *   Poly_Green   60 km/h  ≈ 32.4 kt   (median area 3.92 sq°)
   *   Poly_Orange  90 km/h  ≈ 48.6 kt   (median area 1.03 sq°)
   *   Poly_Red    120 km/h  ≈ 64.8 kt   (median area 0.16 sq°)
   *
   * Near the NHC thresholds, deliberately not identical. Confirmed twice
   * over: the labels state the speeds, AND the areas nest strictly
   * (Green widest → Red smallest), which is what wind bands must do
   * physically. Two independent agreeing checks is why this is settled.
   *
   * We draw them in the §6 34/50/64 colors because they are the same three
   * severity tiers a reader is being asked to distinguish. We do NOT relabel
   * them as 34/50/64 kt anywhere the user can see — that would put words in
   * the source's mouth. The panel says what GDACS actually published.
   */
  bandClass: Object.freeze({
    Poly_Green: Object.freeze({ kmh: 60, colorKey: 34 }),
    Poly_Orange: Object.freeze({ kmh: 90, colorKey: 50 }),
    Poly_Red: Object.freeze({ kmh: 120, colorKey: 64 }),
  }),

  /** A polygon whose entire bounding box is smaller than this (degrees) is
   *  GDACS saying "this threshold does not reach this forecast point" — it
   *  publishes a zero-area shape rather than omitting the feature.
   *  MEASURED on real data (NOUL-26 green band, raw dump 2026-07-24): the
   *  last two forecast steps were each 330 identical copies of one
   *  coordinate. These must be dropped before any geometry work: a
   *  zero-radius shape collapses the centroid onto itself, zeroes the
   *  radial profile, and tapers the merged corridor to a point — the
   *  pinched ends Aaron reported. Coordinates are published to 4 decimals,
   *  so a real shape is orders of magnitude bigger than this threshold and
   *  anything smaller is sub-pixel at any zoom. */
  degenerateSpanDeg: 0.001,

  /** `featuretype` on the three band classes. The per-timestep centre dots
   *  carry "PointRadii" and are NOT bands — 30 of the 33 polygons in that
   *  payload were dots. Drawing them as bands would be soup. */
  windRadiiType: 'WindRadii',

  /* --- the per-timestep centre dots, READ LIVE 2026-07-24 (NOUL-26, all 12
   * "Point" features dumped together). Every claim below is off those bytes.
   *
   * THE DOTS ARE POLYGONS, NOT POINTS. Each is a 129-vertex circle of radius
   * 0.03° around the storm centre. An earlier read of a single feature said
   * "true GeoJSON Point" — that feature was the CENTROID, which is the one
   * exception in the set. Take the bounding-box centre, which is exact for a
   * symmetric ring and survives GDACS changing the vertex count.
   *
   * `Class` is `Point_Polygon_Point_N`, N running 0..10 in chronological
   * order. We do NOT trust N: the times are parsed and sorted, so a
   * renumbering upstream cannot silently reorder a track. ------------------ */

  /** `featuretype` shared by every centre dot. */
  pointRadiiType: 'PointRadii',

  /** `Class` prefix on the timestep dots. */
  pointClassPrefix: 'Point_Polygon_Point_',

  /** The storm's CURRENT position as its own feature — and the one true
   *  GeoJSON Point in the payload. It is not a timestep and carries no key
   *  or date, so it must never enter the track. */
  centroidClass: 'Point_Centroid',

  /** Two coordinates closer than this (degrees) are the same place, when
   *  joining a track segment's endpoint to a dot's centre. Measured spacing
   *  between consecutive dots is ~0.5–2°, and the join is expected to be
   *  exact, so this is slack for float noise — not a fuzzy match. */
  pointJoinEpsilonDeg: 0.02,

  /** Track intensity code → our category index (0 = TD, 1 = TS).
   *
   *  HU IS DELIBERATELY NULL, and this is the whole reason GDACS forecast
   *  points cannot carry a Saffir-Simpson number: its strongest published
   *  wind band is 120 km/h = 64.8 kt, which IS the Cat 1 floor. A Cat 1 and
   *  a Cat 5 produce an identical band set. "Hurricane" is the finest read
   *  available, so a hurricane dot states HU and takes the generic hue
   *  rather than borrowing Cat 1's color it has not earned (§6). */
  trackIntensityIndex: Object.freeze({ TD: 0, TS: 1, HU: null }),

  /** The forecast cone. GDACS DOES publish one — `Poly_Cones`, a single
   *  207-point polygon labelled "Uncertainty Cones". data/gdacs.js declared
   *  `cone: false` on inherited authority and was wrong. */
  coneClass: 'Poly_Cones',

  /** Track segments: 2-point LineStrings, `Class` "Line_Line_N". Each is
   *  labelled with an intensity code in `polygonlabel` and split past vs
   *  forecast by the `forecast` property. */
  linePrefix: 'Line_',

  /** `forecast` arrives as the STRING "true"/"false", not a boolean. */
  forecastTrue: 'true',

  /** Band label format, e.g. "120 km/h". Parsed rather than trusted blindly:
   *  if GDACS renumbers a band, the parsed value disagrees with the expected
   *  kmh above and we drop it rather than paint the wrong color (§6). */
  bandLabelPattern: /^\s*(\d+(?:\.\d+)?)\s*km\/h\s*$/i,

  /** How far a published label may drift from the expected speed before the
   *  band is treated as unrecognized. Absolute km/h. Small on purpose: this
   *  is a safety mapping, not a fuzzy match. */
  bandLabelToleranceKmh: 5,
});

/**
 * Geometry simplification budget.
 *
 * MEASURED, NOT GUESSED: one GDACS storm returned 8,868 coordinates across
 * 44 features, largest single ring 365 points (2026-07-24, live). This is a
 * globe on a phone — that is real weight, and several storms drawn ambient
 * multiply it.
 *
 * Douglas–Peucker tolerance in DEGREES. At these zooms a band's outline is
 * a smooth blob a few degrees across, so a tolerance well under the smallest
 * feature we care about removes redundant vertices without changing the
 * shape a reader sees. The floor exists because simplification that can
 * delete a whole ring reads on glass as MISSING COVERAGE — a §5 failure
 * dressed up as a performance win, and the exact mistake the surge notes
 * warn about.
 */
export const SIMPLIFY = Object.freeze({
  /** Tolerance for GDACS wind bands and cone. */
  gdacsToleranceDeg: 0.01,
  /** Never reduce a ring below this many points. Below ~8 a closed blob
   *  stops reading as a blob. */
  minRingPoints: 12,
  /** Rings already at or under this size are left alone — the work costs
   *  more than it saves. */
  skipUnderPoints: 24,
});

/**
 * Closed-ring finishing — shared by the NHC sweep and the GDACS band merge
 * (lib/ringpolish.js). Defaults only; each caller passes its own values
 * where its geometry differs.
 */
export const RING_POLISH = Object.freeze({
  /** Default averaging passes. Matches WIND_SWEEP.ringSmoothPasses so the
   *  two mergers finish with the same visual weight. */
  smoothPasses: 3,
  /** Hard ceiling on resampled vertices. Same reasoning as
   *  WIND_SWEEP.maxSamples: a pathological ring gets a coarser outline
   *  rather than a frame-budget blowout. */
  maxSamples: 2000,

  /** Below this many vertices a ring is passed through unpolished. A shape
   *  with fewer points than this has no corner worth rounding, and a
   *  degenerate one must not be reshaped by a solver with nothing to work
   *  with (GDACS publishes zero-area polygons — SPEC §4). */
  minPolishPoints: 16,

  /** Bearings sampled when smoothing a band's radial seams. 360 = one per
   *  degree, which is finer than any seam needs and costs nothing at three
   *  rings per storm. */
  seamSamples: 360,

  /** Angular width of the seam blend, DEGREES of bearing.
   *
   *  THIS IS THE DIAL. The seams are step discontinuities at 90/180/270, and
   *  this is how far either side of one the transition is spread. Too small
   *  and the step survives (the first attempt was effectively ~2°, which is
   *  why nothing changed); too large and a genuinely lopsided storm gets
   *  rounded toward a circle, losing the asymmetry that is real information.
   *  24° spreads a seam across roughly a quarter of the sector it borders. */
  seamWindowDeg: 24,

  /** UNUSED BY THE BAND PATH — kept for the XY resample, which still serves
   *  lib/windswath.js and lib/bandmerge.js. Bands are smoothed in the ANGULAR
   *  domain instead; see lib/ringpolish.js on why XY cannot touch a radial
   *  seam. Resample spacing for a ring, in DEGREES.
   *
   *  Bands run ~0.5–1.5° in radius, so this puts a few hundred vertices
   *  around one — fine enough that 3-point averaging is a gentle low-pass
   *  rather than a shape change, coarse enough to stay cheap. Matches
   *  BAND_MERGE's grid cell (~1.2 nm of latitude) so the two paths finish at
   *  the same visual weight.
   *
   *  This is the dial if the seams still read hard: LOWER it for a finer
   *  ring, or raise smoothPasses for a rounder one. Passes cost more shape
   *  than spacing does. */
  bandSpacingDeg: 0.02,
});

/**
 * GDACS band merge (lib/bandmerge.js) — stacked per-timestep polygons into
 * one smooth outline per threshold.
 *
 * CONFIRMED ON GLASS 2026-07-24: GDACS bands are QUADRANT-SHAPED, not the
 * symmetric circles the spec inherited from the HA project. Aaron's phone
 * screenshot shows four-lobed shapes with notches where quadrants meet, one
 * stack per forecast timestep, fills compounding at every overlap. Same
 * visual failure the NHC swath was built to fix — different input, so a
 * different merge, but the same finishing pass.
 */
export const BAND_MERGE = Object.freeze({
  /** Occupancy grid resolution, DEGREES per cell.
   *
   *  This is the accuracy/cost dial and the one number to tune if the merged
   *  outline looks lumpy or the merge feels slow. 0.02° ≈ 1.2 nm of latitude
   *  — an order of magnitude finer than the ~100 nm bands being merged, so
   *  the traced boundary is faithful, while a typical storm's span (~10°)
   *  costs a 500×500 grid: 250k cells, trivial for one pass.
   *
   *  The error direction is OUTWARD by up to one cell (a cell fills if any
   *  polygon covers its centre), stated in lib/bandmerge.js as the accepted
   *  trade — GDACS publishes no radii to sweep inward from. */
  cellDeg: 0.02,

  /** Resample spacing for the traced contour, in CELLS. The raw marching-
   *  squares trace is one point per boundary cell, which is far denser than
   *  needed and stair-stepped by construction; resampling at 3 cells feeds
   *  the averaging pass a clean uniform ring. */
  resampleCells: 3,

  /** Averaging passes on the merged outline. Higher than the NHC ring's 3
   *  on purpose: this ring starts as a grid trace, so it carries a
   *  half-cell staircase the sweep's walls never had, and needs more
   *  low-pass to read as smooth. */
  smoothPasses: 6,

  /** Bridge gaps between consecutive band shapes into one corridor.
   *
   *  ON by default and it is the whole reason the merged swath reads as a
   *  swath. GDACS fixes are ~12 h apart, so a band narrower than the
   *  distance travelled merges into beads on a wire (seen on glass
   *  2026-07-24). The storm swept the ground between fixes; the beads were
   *  the artifact. NHC's sweep does the equivalent interpolation between its
   *  own 6-hourly fixes, so this is the same reading applied to a source
   *  that publishes shapes instead of radii.
   *
   *  Set false to see the raw per-timestep footprints — a debugging view,
   *  not a product one. */
  bridgeGaps: true,

  /** Bearings sampled when reducing a published polygon to a radial
   *  profile for blending. 72 = 5° steps, matching WIND_SWEEP.ringSamples
   *  so both mergers resolve a shape at the same angular fidelity. Bands
   *  are smooth quadrant blobs, not spiky, so 5° captures them fully. */
  profileSamples: 72,

  /** Spacing between interpolated bridge shapes, as a FRACTION of the
   *  narrowest radius involved. Two shapes of radius r overlap whenever
   *  their centres are under 2r apart, so 0.5r leaves a wide safety
   *  margin against micro-gaps while adapting to the band's own size —
   *  a wide 60 km/h band takes a few big steps, a tight 120 km/h core
   *  takes more, smaller ones. Self-tuning where a fixed cell count was
   *  not: 4 cells cost 257 ms per storm on realistic input. */
  bridgeStepFraction: 0.5,

  /** Floor on that step, in cells, so a degenerate near-zero radius
   *  cannot drive the step to zero and stamp until the cap. */
  bridgeMinStepCells: 3,

  /** Hard ceiling on interpolated shapes per gap. A pathological jump
   *  between fixes gets a coarser bridge rather than a stall. */
  maxBridgeSteps: 200,

  /** Contours shorter than this many cells are noise — a stray filled cell
   *  from a sliver of polygon — not a band. Dropped. */
  minContourCells: 12,

  /** A merged ring below this many points is not a legible shape; dropped
   *  rather than drawn as a triangle. */
  minRingPoints: 12,

  /** Hard ceiling on grid cells. Past this the merge BAILS and the caller
   *  keeps the unmerged stack — uglier but bounded. Guards against a
   *  pathological span or an outlier vertex allocating a huge grid on a
   *  phone. 4M cells ≈ 4 MB, the most worth spending on one storm. */
  maxCells: 4_000_000,
});

/* ---------------------------------------------------------------------------
 * MODEL GUIDANCE TRACKS (§14 Phase 6 step 5) — the "spaghetti" layer.
 *
 * Several forecast models are run for every storm and they DISAGREE. NHC's
 * official cone is a judgement made after weighing them; this layer shows the
 * raw spread behind that judgement. A tight cluster means confidence, a wide
 * fan means nobody knows — and that distinction is invisible from the cone
 * alone, which draws the same confident shape either way.
 *
 * SOURCE: the ATCF a-deck, one gzipped file per storm, fetched through the
 * relay (`ENDPOINT.nhcAdeck` is CORS-blocked — §4). NHC-ONLY, permanently:
 * GDACS aggregates official advisories and publishes no model guidance at
 * all, so that is §14's standing exception rather than an open task.
 *
 * THE SHORTLIST IS INHERITED AND PROVEN, verified against a live deck
 * (`aep012026`, 2026-07) on the HA project. Re-deriving it here would have
 * cost a day to land in the same place. Two name traps it records: GFS is
 * `AVNO`, NOT `GFSO`; UKMET is `UKX`, NOT `EGRR`.
 *
 * TWO MODELS ARE EXCLUDED ON PURPOSE, and both exclusions are load-bearing:
 *  - `EMXI` (ECMWF) is access-restricted in public decks — its rows arrive
 *    BLANK. Wiring it would ship a model that silently draws nothing, which
 *    is §5's failure wearing a checkbox.
 *  - `OFCL` IS the official forecast track, already drawn as the solid line.
 *    A dashed overlay on top of it is invisible and redundant in the legend.
 * ------------------------------------------------------------------------- */

/**
 * Selector groups. These still set the ORDER models appear in — consensus
 * first, then the globals, then the hurricane-specific models — and they still
 * separate the rows visually.
 *
 * THE HEADINGS ARE GONE (2026-07-25). §7 asked for grouping "never one flat
 * column of checkboxes", and the grouping delivers that on its own: five rows
 * in three clusters reads as three kinds of thing without three uppercase
 * labels stacked over it. Each row already carries its own second line saying
 * what the model is, so the heading was a third level of type over a control
 * that fits on half a phone screen. `MODEL_GROUP_LABEL` retired with them —
 * a label constant nothing renders is a constant that quietly goes stale.
 */
export const MODEL_GROUP = Object.freeze({
  CONSENSUS: 'consensus',
  GLOBAL: 'global',
  HURRICANE: 'hurricane',
});

export const MODEL_TRACKS = Object.freeze({
  /**
   * The shortlist, in render and selector order.
   *
   * `tech` is the ATCF code as it appears in column 4 of the deck. `label` is
   * what a human is shown — the UI never prints a tech code, because "AVNO"
   * means nothing and "GFS" means something.
   *
   * TVCN AND HCCA SHARE ONE SLOT AND ONE COLOR. Both are consensus aids;
   * TVCN is preferred and HCCA fills in only when TVCN is absent from the
   * deck, so the two are never drawn together. They share `pref` for the same
   * reason: a user who switched "Consensus" off must not have it come back
   * under a different name when TVCN drops out of a cycle.
   *
   * `sub` is the second line in the selector. EVERY FIGURE IN IT IS FROM
   * NHC's own model table (`nhc.noaa.gov/modelsummary.shtml`, read
   * 2026-07-25), not from recollection: GFS runs 00/06/12/18 UTC out to
   * 240 h, UKMET runs 00/12 only, out to 144 h. **If those cadences change,
   * this copy is wrong on screen and nothing will fail** — it is prose, and
   * prose has no test. Re-read the table before trusting it in a season
   * where the models have been upgraded.
   *
   * Consensus is the only row making an accuracy claim, and it is the only
   * one that can safely make one: "the best models were the consensus aids"
   * is NHC's own verification finding and has held for two decades.
   */
  techs: Object.freeze([
    Object.freeze({
      tech: 'TVCN', label: 'Consensus', pref: 'consensus', group: MODEL_GROUP.CONSENSUS,
      sub: 'Blend of all models — usually the most accurate',
    }),
    Object.freeze({
      tech: 'HCCA', label: 'Consensus', pref: 'consensus', group: MODEL_GROUP.CONSENSUS,
      sub: 'Blend of all models — usually the most accurate',
    }),
    Object.freeze({
      tech: 'AVNO', label: 'GFS', pref: 'avno', group: MODEL_GROUP.GLOBAL,
      sub: 'Updated 4× a day · longest range',
    }),
    Object.freeze({
      tech: 'UKX', label: 'UKMET', pref: 'ukx', group: MODEL_GROUP.GLOBAL,
      sub: 'Updated 2× a day · ends at 6 days',
    }),
    Object.freeze({
      tech: 'HFSA', label: 'HAFS-A', pref: 'hfsa', group: MODEL_GROUP.HURRICANE,
      /* AMPERSAND, not "and": the spelled-out version wraps to a second line
       * in the 340px rail, and a two-line subtitle under a one-line name makes
       * the row taller than every other row in the selector. */
      sub: 'Hurricane Analysis & Forecast System (US)',
    }),
  ]),

  /** Forecast hours past this are noise — guidance seven days out disagrees
   *  with itself more than it disagrees with the other models. */
  maxTau: 168,

  /** Per-model point cap. Taus run 6–12 h apart, so 32 covers the whole
   *  window with room to spare; the cap exists to bound a malformed deck,
   *  not to trim a healthy one. */
  maxPoints: 32,

  /**
   * A model's own latest cycle must be within this many hours of the DECK's
   * newest cycle, or the model is dropped.
   *
   * Two rules in one number. Raw models lag the official forecast by a cycle,
   * so taking each tech's OWN latest cycle (rather than one shared cycle) is
   * what keeps them on the map at all. But a model that stopped running
   * entirely must not keep drawing a days-old track that looks exactly as
   * current as the others — a stale line among fresh ones is a confident lie
   * about where a storm might go (§5).
   */
  staleHours: 12,

  /** Below this many points a "track" is a stub, not guidance. Dropped
   *  rather than drawn as a two-pixel stub the user cannot interpret. */
  minPoints: 2,

  /**
   * How many storms' decks are fetched at once while warming.
   *
   * ONE, not the geometry warmer's two. Decks are an order of magnitude
   * bigger than a MapServer bundle even after the relay's filter, and this
   * rides the same phone radio as the basemap tiles and the storm feed. The
   * layer is warm-ahead detail nobody is waiting on, so it should be the
   * politest thing on the connection, not a competitor.
   */
  warmConcurrency: 1,
});

/* ---------------------------------------------------------------------------
 * ADVISORY TEXT — Phase 6 step 6 (SPEC §16 item 7)
 *
 * The words a forecaster actually wrote, in the storm drawer. It is NOT a map
 * layer and has no toggle: a layer is something drawn on the globe, this is
 * prose, and it is inherently per-storm — there is no advisory without a
 * selected storm. The collapsed section IS the fetch gate, which is a better
 * one than a global switch because it is per storm and on demand.
 * ------------------------------------------------------------------------ */

export const ADVISORY_TEXT = Object.freeze({
  /**
   * Which NHC product the panel shows.
   *
   * TCP — the Public Advisory. Plain language, and the only one of the three
   * written for a person rather than a machine: TCM is the coded forecast
   * advisory (fixed-column wind radii), and TCD is the forecaster discussion,
   * which is the most interesting read in the whole app and also the most
   * technical. Both are one constant away; neither is the default.
   */
  kind: 'TCP',

  /**
   * How many storms' advisories are held in memory. Matches the geometry
   * cache for the same reason: the NHC basins have peaked at eight or nine
   * concurrent storms, and a cap below that evicts a storm the user is still
   * moving between. Bound every cache (§4).
   */
  lruStorms: 12,

  /**
   * How long the JTWC name index is trusted before it is re-fetched.
   *
   * Longer than the relay's own 15-minute window on purpose — this is the
   * CLIENT's copy, and its job is to keep a second storm selection from
   * costing a round trip at all. A new storm appearing in JTWC's list inside
   * this window shows as `none_matched`, which reads honestly ("JTWC has no
   * warning under that name") rather than as an error. Re-opening the section
   * is the recovery, same as everywhere else.
   */
  indexTtl: 15 * MINUTE,
});

/* ---------------------------------------------------------------------------
 * IMAGERY (SPEC §4, §7) — satellite discs around each storm's eye
 *
 * EVERY NUMBER AND EVERY URL BELOW WAS MEASURED, not inherited. The probe that
 * produced them ran from the deployed site on 2026-07-25 (tools/imagery-probe
 * plus /api/imagery/inspect) because the sandbox cannot reach any of these
 * hosts. Where a value came from a measurement, the measurement is stated.
 * ------------------------------------------------------------------------- */

/**
 * NO TIME PARAMETER IS EVER SENT. This is the single most load-bearing line in
 * the imagery code and it is a MEASURED result, not a preference.
 *
 * Asking GIBS for a specific timestamp hits empty frames unpredictably: on one
 * afternoon's ladder GOES-East returned a blank 512x512 at 0 and 20 minutes
 * back, GOES-West at 60 and 120, Himawari at 0 — while every request that sent
 * NO time at all returned real imagery on all three satellites. The server
 * knows which frame is its newest complete one and we do not.
 *
 * So Landfall carries no per-satellite lag constant. There is nothing to tune
 * and nothing to go stale. If playback lands in v2.0 it will need explicit
 * times and will have to solve this properly — the time dimension IS
 * advertised (measured), it is just not safe to guess a value from.
 */
export const IMAGERY_SENDS_NO_TIME = true;

/**
 * The satellite ring. Four birds, two vendors, the whole tropical belt.
 *
 * THE `black`/`white` GREY ANCHORS ARE GONE. They existed only to normalize
 * brightness onto a shared coldness scale, and that whole approach was retired
 * with the colour knockout (see IMAGERY below) — nothing reads them now, so
 * they are deleted rather than left as dead config. The measurements they held
 * (GOES 13..250, Himawari 8..226, Meteosat 9..218) are re-derivable from
 * tools/imagery-probe.html if a brightness path is ever needed again.
 *
 * `lonMin`/`lonMax` are the longitudes each satellite OWNS, not the extent it
 * can technically see — the discs overlap heavily and the boundaries are
 * chosen where the picture is best, which is measured:
 *
 *  - The dateline handoff is FREE. GOES-West and Himawari both returned real
 *    imagery for a box straddling 180 degrees, so 180 is picked because it is
 *    the obvious number, not because either satellite runs out there.
 *  - The eastern Indian Ocean handoff is NOT free. Himawari at 95-105E came
 *    back washed out (luminance 95..141, a narrow band near its horizon) where
 *    Meteosat IODC over the same box was clean. IODC owns it.
 */
export const SATELLITES = Object.freeze([
  Object.freeze({
    id: 'goes-east',
    label: 'GOES-East',
    vendor: 'NASA GIBS',
    /* ABI band 13, "clean longwave infrared", 10.3 microns. */
    layer: 'GOES-East_ABI_Band13_Clean_Infrared',
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    wms: '1.1.1',
    /* CONFIRMED ON GLASS 2026-07-25: vivid thermal colour. */
    enhanced: true,
    lonMin: -105,
    lonMax: -30,
  }),
  Object.freeze({
    id: 'goes-west',
    label: 'GOES-West',
    vendor: 'NASA GIBS',
    layer: 'GOES-West_ABI_Band13_Clean_Infrared',
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    wms: '1.1.1',
    /* CONFIRMED ON GLASS 2026-07-25: vivid thermal colour. */
    enhanced: true,
    lonMin: -180,
    lonMax: -105,
  }),
  Object.freeze({
    id: 'himawari',
    label: 'Himawari',
    vendor: 'NASA GIBS',
    /* AHI band 13 — the same 10.4 micron channel as ABI band 13. Choosing the
     * matching channel on every satellite is what makes one palette honest. */
    layer: 'Himawari_AHI_Band13_Clean_Infrared',
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    wms: '1.1.1',
    /* CONFIRMED ON GLASS 2026-07-25: vivid thermal colour. */
    enhanced: true,
    lonMin: 105,
    lonMax: 180,
  }),
  Object.freeze({
    id: 'meteosat-iodc',
    label: 'Meteosat IODC',
    vendor: 'EUMETSAT',
    /* SEVIRI IR 10.8 — same physical channel again.
     *
     * THE ONLY BIRD WHOSE COLOUR IS STILL UNVERIFIED. A 2026-07-25 probe
     * reported this layer as pure grey (mean saturation 0.00, max 0.00), and
     * that same probe run also called the three GIBS layers mostly grey —
     * which is FLATLY WRONG, confirmed on glass 2026-07-25 with vivid thermal
     * colour on GOES-West (Genevieve, Fausto) and Himawari (NOUL-26). So the
     * grey reading here is not evidence of anything; it is a run that got the
     * other three wrong. Look at an Indian Ocean or east-Atlantic storm and
     * read the `[landfall] imagery meteosat-iodc chromaMax=` line before
     * believing either answer. If it really is grey, the knockout keys to
     * nothing and map/imagery.js says so by name. */
    layer: 'msg_iodc:ir108',
    endpoint: 'https://view.eumetsat.int/geoserver/ows',
    wms: '1.3.0',
    /* CONFIRMED ON GLASS 2026-07-25 by Aaron, after test storms were dropped
     * across the whole IODC footprint: this product is PLAIN GREY. It takes the
     * brightness knockout instead of the chroma one, and `black`/`white` below
     * are the anchors that path normalizes against.
     *
     * The one earlier probe that said the same thing also called the three GIBS
     * birds grey, which is flatly wrong — so this is believed because it was
     * SEEN, not because that probe agreed. lib/imagery-paint.js re-checks the
     * claim on every frame and warns if a frame contradicts it. */
    enhanced: false,

    /* Grey range for the brightness path, 0..255. Deleted along with the old
     * coldness scale and brought back deliberately: ONE bird, ONE path, and it
     * genuinely needs them. The values are the earlier probe's (9..218) and are
     * therefore a STARTING POINT, not a measurement to trust — the pass logs
     * this frame's own 2nd and 98th luma percentiles so they can be corrected
     * from a real cyclone. */
    black: 9,
    white: 218,
    lonMin: -30,
    lonMax: 105,
  }),
]);

export const IMAGERY = Object.freeze({
  /**
   * Radius of the disc drawn around each eye.
   *
   * 900, up from 600, and the reason is on glass: with the colour knockout
   * doing the work, a major hurricane's shield RAN OUT OF DISC. Genevieve and
   * Fausto both reached the rim and got cut, which is the one thing the
   * feather cannot hide — it fades an edge, it cannot invent the cloud past it.
   * 600 km was sized for a knockout that erased most of the frame anyway.
   *
   * The ceiling is storms drawing into each other: two discs closer than
   * 1800 km apart now overlap, and the overlap composites to a slightly hotter
   * patch. Feathered rims blend rather than seam, so it reads as weather, but
   * this is the number that decides it.
   */
  discRadiusKm: 900,

  /**
   * Pixels per side requested per storm.
   *
   * DERIVED, not picked, and it moves with the radius: an 1800 km box across
   * 768 px is 2.3 km per pixel — the same sampling as the old 1200/512, and
   * ABI/AHI band 13 is a 2 km channel at nadir. Holding the ratio is what
   * keeps a bigger disc from being a blurrier one.
   *
   * Cost is real and worth stating: 768² is 2.25x the pixels and roughly
   * 2.25x the bytes of 512², per storm, per five-minute refresh. Asking for
   * more than this would upscale noise for battery.
   */
  requestPx: 768,

  /**
   * Where the feather starts, as a fraction of the disc radius. Inside this
   * the image is fully opaque; from here to the rim it falls to nothing.
   * A hard rim reads as a sticker on the globe — the whole reason this is a
   * disc and not a rectangle.
   *
   * STORED AS THE FADE WIDTH, not as where the fade starts, and that is on
   * purpose: it is the number the Settings slider shows and the number a person
   * thinks in ("how soft is the edge"). The geometry wants the opposite end, so
   * `lib/imagery-paint.js` computes `featherStart = 1 - fadeWidth` at the one
   * place that needs it. ONE name for one idea; two would drift.
   *
   * 0.38 at a 900 km radius is a 342 km blur. It was 0.42 (378 km) until
   * 2026-07-25; the slightly harder edge keeps a little more of the outer
   * bands, which is what the note under the slider warns a wide fade eats.
   *
   * THIS IS THE DEFAULT, NOT THE VALUE. Settings overrides it per device
   * (`imageryFade` in data/settings-prefs.js); this is what a fresh install
   * gets and what Reset returns to.
   */
  fadeWidth: 0.38,

  /**
   * Bounds for the two Settings sliders (SPEC §16). Here rather than in the
   * view because they are behavioural limits, not styling — the same rule that
   * puts poll intervals and zoom thresholds in this file.
   *
   * The ceilings are not arbitrary. 1500 km of radius is a 3000 km box, at
   * which point a "disc on a storm" has become a repainted ocean and discs
   * overlap almost everywhere. A 0.70 fade eats deep into any real cloud
   * shield. Both ends are reachable so the shape can be seen, but the useful
   * range lives nearer the defaults.
   */
  tuning: Object.freeze({
    radiusKm: Object.freeze({ min: 300, max: 1500, step: 50 }),
    fade: Object.freeze({ min: 0.05, max: 0.7, step: 0.01 }),

    /**
     * How long the sliders must sit still before the map acts on them, in ms.
     *
     * The controls fire on `input` so the readout tracks the thumb, which
     * means one drag emits dozens of changes. Acting on each would repaint
     * twelve discs per pixel of travel, or worse, refetch them from NASA.
     *
     * 180 ms is under the ~250 ms where a delay starts reading as lag, and
     * long enough that a normal drag settles exactly once.
     */
    settleMs: 180,
  }),

  /* --- THE COLOUR KNOCKOUT ---------------------------------------------------
   * Ported verbatim from the HA integration's `#extract-clouds` SVG filter,
   * values and all. A colour-enhanced infrared product draws cold storm tops in
   * VIVID COLOUR and warm ground, low cloud and clear sky in GREY, so the key
   * is SATURATION and the vendor's own RGB survives untouched.
   *
   * These four replaced `clearBelow` / `solidAbove` / `colourSat` /
   * `colouredFloor` and the normalized-coldness scale they belonged to. That
   * approach repainted every pixel from a palette of ours and produced a white
   * and blue smear where the HA card, on the same weather at the same minute,
   * produced a red/yellow/green storm. Aaron shot the pair side by side.
   *
   * THEY WERE TUNED AGAINST IEM'S `conus_ch13` PALETTE, NOT OURS. The edge and
   * purple fades in particular exist because that specific enhancement renders
   * its cold edge blue/purple. Our vendors may enhance differently, so treat
   * all four as starting points, not settled values.
   * ------------------------------------------------------------------------ */

  /**
   * Sharpness of the colour cutoff. Higher means a coloured pixel ramps to
   * full opacity faster once past the cutoff (crisper edge); lower is a softer
   * fade. Alpha before the fades is `satSlope * chroma + satIntercept`.
   */
  satSlope: 4,

  /**
   * Where the cutoff sits, as `-satIntercept / satSlope` of full chroma —
   * 0.125 at these values. MORE NEGATIVE means a higher cutoff, so more grey
   * and more faintly-tinted pixels are removed.
   *
   * This is the first dial to reach for if the discs keep too much haze (more
   * negative) or eat the storm's outer bands (less negative).
   */
  satIntercept: -0.5,

  /**
   * Cold-edge fade. Scales alpha by `1 - edgeFade * blue`, so the enhancement's
   * blue/purple outer band drops back while the green/yellow/orange/red cores
   * stay full. 0 turns it off. MULTIPLICATIVE — it can only ever remove
   * opacity, never add it.
   */
  edgeFade: 0.5,

  /**
   * Purple-only fade, stacked on top of `edgeFade`. Scales alpha by
   * `1 - purpleFade * red * blue`; `red * blue` is a magenta detector, since
   * purple is the one band with both channels high. Pure blue and the red and
   * orange cores are untouched. 0 turns it off.
   */
  purpleFade: 0.5,

  /* --- THE BRIGHTNESS KNOCKOUT (greyscale vendors) --------------------------
   * Same shape as the colour knockout above, different signal: `t` is the
   * pixel's brightness normalized against that vendor's black/white anchors,
   * where 0 is the warmest thing it renders and 1 the coldest. In every IR
   * product brighter means colder means higher tops means the storm.
   *
   * DERIVED FROM WHERE OCEAN ENDS AND CLOUD BEGINS, not picked. Tropical ocean
   * on infrared sits around raw 26..61 against Meteosat's 9..218 range — t of
   * roughly 0.08 to 0.25 — and cloud starts climbing near raw 79..96, t of
   * about 0.33. So the floor belongs just above the ocean at t = 0.30, reaching
   * solid by t = 0.55. Those two points give slope 4 and intercept -1.2.
   *
   * Slope 4 matching the colour path's `satSlope` is a coincidence, but a
   * convenient one: both keys ramp equally hard once past their floor.
   *
   * FIRST DIAL if Meteosat looks wrong: `greyIntercept`. More negative lifts
   * the floor and strips more low cloud; less negative keeps more haze. Check
   * the logged `luma=` range first, though — a floor tuned against wrong
   * anchors is tuning the wrong number.
   * ------------------------------------------------------------------------ */
  greySlope: 4,
  greyIntercept: -1.2,

  /**
   * Below this peak chroma, a frame is GREYSCALE and the knockout above cannot
   * work on it — every pixel keys to zero and the disc renders as nothing.
   *
   * This is a SAFETY CONSTANT, not a look constant. An empty disc over a live
   * cyclone reads as clear sky, which §5 forbids, so the caller turns this into
   * a named fault instead. A 2026-07-25 probe reported EUMETSAT's `ir108` at
   * exactly 0.00 max saturation; whether that still holds is what the pass now
   * measures and reports rather than assumes.
   */
  greyscaleChroma: 0.02,

  /** Ceiling on how many storm discs are held at once. Bound every cache
   *  (§7). Matches the geometry and advisory LRUs for the same reason: the
   *  basins have peaked at eight or nine storms at once. */
  maxDiscs: 12,

  /** Radar, which is a different problem: already a transparent PNG, needs no
   *  knockout, and covers only the US and its territories. */
  radar: Object.freeze({
    /** MEASURED 2026-07-25: nowcoast.noaa.gov is GONE (403 through a CDN
     *  error page). The service lives here now, and it sends NO CORS header,
     *  which is why radar goes through our relay and satellite does not. */
    relay: '/api/imagery/radar',
    /** The service's stated extent, and the reason a coverage note exists:
     *  ground radar is blank over the open ocean where storms live. */
    lonMin: -170,
    lonMax: -60,
    latMin: 10,
    latMax: 72,
  }),
});

/* ---------------------------------------------------------------------------
 * TELEMETRY (SPEC §17 A5)
 *
 * How Aaron finds out the app is broken for somebody who is not him. Read
 * lib/telemetry.js's header for the privacy contract before touching any of
 * this — the short version is that home coordinates never leave the device,
 * and no field here exists to identify a person.
 *
 * Every number below is a CEILING, not a target. They exist so that a
 * client-side bug cannot turn into a traffic problem of its own, which §17
 * lists as one of the ways a public launch goes wrong.
 * ------------------------------------------------------------------------- */
export const TELEMETRY = Object.freeze({
  /** Same-origin relay. Never a third-party host: a beacon to somebody else's
   *  domain is a tracker no matter what it carries. */
  endpoint: '/api/beacon',

  /** Identifies the BUILD, never the user — the same string for everyone on
   *  this deploy. Bump it when a release needs to be told apart in the data.
   *  Kept in step with the service worker's own VERSION by hand; they are
   *  separate on purpose (a worker cannot import this file, §14 Phase 5). */
  appVersion: 'v3',

  /** Fraction of sessions that report at all, decided ONCE per session
   *  (see telemetry.js on why per-session and not per-event).
   *
   *  1.0 TODAY, and that is the right value for now: at current traffic the
   *  free Analytics Engine tier (100k writes/day) is nowhere near reachable,
   *  and a partial view of a small number of sessions is close to useless.
   *  THIS IS THE FIRST DIAL TO TURN if a viral week arrives — drop it to 0.1
   *  and the signal survives while the write count falls by ten. */
  sampleRate: 1.0,

  /** Events held before the oldest is dropped. A cascade is one fact repeated;
   *  the newest events describe the current state. */
  maxQueue: 20,

  /** Beacons per session, ever. The backstop against a render-loop bug
   *  becoming a request storm — past this the module goes quiet for good. */
  maxSendsPerSession: 10,

  /** Field caps. An unbounded message is how page content or a URL ends up
   *  in a log by accident. */
  maxMessageChars: 300,
  maxStackChars: 600,

  /** Stack frames kept. Enough to name the failing module; not so many that
   *  the payload becomes a document. */
  stackFrames: 5,
});
