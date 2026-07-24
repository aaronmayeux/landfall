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

  /** Relay: GDACS per-storm geometry.
   *  The HA project's 90-second timeout did NOT reproduce here: measured
   *  375–984 ms (2026-07-23) and 1.3–1.5 s / 224 kB / 44 features
   *  (2026-07-24, live via /api/gdacs/inspect). Two independent reads, so the
   *  "slow endpoint" story is retired. The cache stays as cheap insurance
   *  against a source that has misbehaved before — NOT because it is slow.
   *  Serve stale, refresh behind it: a six-hour-old cone is roughly right and
   *  infinitely better than a spinner. Past twelve hours it is genuinely
   *  misleading — drop it and show `unavailable` rather than a stale shape. */
  gdacsGeometryFresh: 30 * MINUTE,
  gdacsGeometryStale: 6 * HOUR,
  gdacsGeometryDrop: 12 * HOUR,

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
   *  a shape — nodes sat ~8° apart, wider than the spike. Detail 3 is ~2,562
   *  nodes / ~7,680 edges — still one draw call each. [VERIFY] frame budget
   *  on a mid-range phone; the overriding lens is feel, and if it stutters
   *  this goes back to 2 and the spike widens instead. */
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
 * SCOPE FILTER (SPEC §16)
 *
 * Two of three scopes need home. With no home set, the control is ABSENT
 * entirely — not disabled, and not a lone "All" button, since one option is
 * not a choice. It appears the moment a home exists.
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
 * HOME MARKER (SPEC §8)
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

  /** Intensity codes seen on track segments. Not thresholds — labels. */
  trackIntensity: Object.freeze({
    TD: 'Tropical depression',
    TS: 'Tropical storm',
    HU: 'Hurricane / typhoon',
  }),

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
