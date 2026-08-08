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

/** The boot screen (ui/boot.js, markup in index.html). */
export const BOOT = Object.freeze({
  /** How long before the screen admits something may be wrong.
   *
   *  ERRING LONG, and the reason is the shape of the mistake. Firing early on
   *  a merely-slow connection tells someone their app is broken when it is
   *  about to work — and they leave. Firing late costs a few seconds of a
   *  spinner they were already watching. The measured tail is the number: P99
   *  time-to-content was 8.6 s on real traffic (SPEC-OPS §17), so anything
   *  under that would fire on visits that went on to succeed. */
  stuckAfter: 12000,
});

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
  /** ==> 20 s WAS A COIN FLIP AGAINST A 20 s RELAY, AND IT ALWAYS LOST. <==
   *  Measured 2026-08-01: an uncached `/api/gdacs/events` took ~20 s, and this
   *  abort fired at 20 s. Four attempts, four aborts, the §5 unavailable
   *  banner, and Super Typhoon DOLPHIN-26 absent from the app while GDACS was
   *  healthy the whole time.
   *
   *  THE RACE IS FIXED ON THE OTHER SIDE, NOT HERE. `gdacs/events.js` now
   *  answers from cache immediately and refreshes behind the response, and
   *  caps its own upstream wait at 10 s — so nothing should approach this
   *  number any more. 30 s is headroom for the one case that still blocks (a
   *  cold colo with an empty warm store), not a fix. If a feed is ever seen
   *  reaching 30 s, raising this again is the wrong move: it means a route
   *  lost its cache, and the route is where to look. */
  fetchTimeout: 30 * SECOND,
});

/** A 4xx is NOT retryable — that is "no data," not "try again," and retrying
 *  it burns battery for nothing. Retryable = timeout, network error, 5xx. */
export const RETRYABLE_STATUS = Object.freeze({
  min: 500,
  max: 599,
  /* ===> 429 IS THE ONE 4xx THAT MEANS "TRY AGAIN". <===
   * The rest of the 4xx range means "no data" — a wrong path or a malformed
   * request will be just as wrong in five seconds, so retrying is noise. 429 is
   * the opposite: it means the answer exists and we asked too fast, which is
   * the definition of retryable. Left out of the range above because the range
   * is a span and this is a single exception to it; listing it as a span
   * boundary would quietly make 430-499 retryable too.
   *
   * This matters now because the relay ISSUES 429s as of
   * functions/api/_middleware.js. Without this entry, one burst past the limit
   * would present to the user as a flat feed outage until the next poll, which
   * is both wrong and the §5 failure mode of a confident incorrect answer. */
  also: Object.freeze([429]),
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

  /** Client: per-STORM geometry — each storm's best-known bundle, not one
   *  entry per advisory (data/cache.js explains why that changed). The cap
   *  stops unbounded growth. Bound every cache. Sized 12 — geometry is WARMED
   *  for every NHC storm now (§9 ambient ladder), and the NHC basins have
   *  peaked at 8-9 concurrent storms in hyperactive seasons; a cap of 8 would
   *  evict bundles mid-warm. */
  geometryLruStorms: 12,

  /** How long an UNSUCCESSFUL geometry attempt is left alone before the app
   *  asks again. Only reached when a fetch failed or came back empty while a
   *  newer advisory is out — the success path is gated on the advisory key and
   *  never waits on this.
   *
   *  Five minutes because that is what the failure it exists for actually
   *  costs: NOAA moves a storm's bin at the advisory and publishes the new
   *  bin's geometry minutes to hours later (measured 2026-07-26 — Fausto's
   *  CP1 block was still empty 21 minutes after the advisory that created it).
   *  Retrying faster only re-reads the relay's own edge cache; retrying slower
   *  leaves a storm on visibly older geometry for no reason. Deliberately
   *  matched to the relay's short-TTL window for empty answers
   *  (functions/api/nhc/mapserver.js) so the two cannot fight. */
  geometryRetryMs: 5 * MINUTE,

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

/* ---------------------------------------------------------------------------
 * RELAY_AGE — is our PIPELINE healthy? A different question, different ruler
 * -------------------------------------------------------------------------*/

/**
 * ==> DO NOT DERIVE THIS FROM `ADVISORY_CADENCE`. IT IS THE WRONG RULER AND
 *     THAT MISTAKE HAS ALREADY BEEN MADE ONCE. <==
 *
 * `FRESHNESS` above measures A STORM: how long since NHC published a new
 * analysis, so 6-hourly cadence is exactly the right thing to divide by. This
 * measures US: how long since our relay last successfully reached NOAA.
 * `X-Landfall-Fetched-At` is stamped at OUR fetch, not at NHC's issuance, so a
 * quiet ocean with no new advisories still gets re-fetched and re-stamped on
 * every cycle. The two numbers look interchangeable and are not.
 *
 * ==> WHAT A CADENCE-DERIVED NUMBER WOULD ACTUALLY HIDE. <== The warm cron runs
 * every 5 minutes. A 6-hour-old copy is therefore not "NHC has not issued yet",
 * it is roughly SEVENTY-TWO consecutive failed refreshes — a completely dead
 * pipeline, unreported for most of a day. `isSourceStale()` in `data/store.js`
 * compared a fetch timestamp against `FRESHNESS.freshUntil` for exactly this
 * reason and could never mean anything; it is why that function sat with no
 * caller.
 *
 * THE HEALTHY WORST CASE IS ~35 MINUTES — a 30-minute relay window plus a
 * 30-minute client poll landing just after it turns over. Three of those is the
 * threshold: long enough that nothing routine trips it, short enough that a
 * broken pipeline surfaces inside one advisory cycle rather than after one.
 *
 * ==> AND IT REPLACED A FLAG THAT STOPPED MEANING WHAT IT SAID. <== The strip
 * used to fire on `X-Landfall-Stale`, which meant one thing — upstream failed —
 * until the storm-list routes started serving expired copies on PURPOSE and
 * refreshing behind the response. That header now covers both "NOAA is broken"
 * and "your copy is 31 minutes old and a fresh one is landing right now", so it
 * cannot drive an alarm. Age can: it is true regardless of which code path
 * served the bytes, and it works the same on both sources.
 */
export const RELAY_AGE = Object.freeze({
  /** Past this, the strip says the feed is delayed. */
  delayedAfter: 90 * MINUTE,
});

/* ---------------------------------------------------------------------------
 * SILENCE — a source that STOPPED PUBLISHING (SPEC §5)
 *
 * A FOURTH STATE, and it is not a flavour of the other three. `unavailable`
 * means the fetch died. `none_matched` means nothing was in scope. `clear`
 * means the ocean is genuinely empty. SILENT means all three succeeded — the
 * feed answered 200, the storm is still in the list, its record still says
 * current — and the newest fix in it is a day old. Nothing errors. Nothing is
 * missing. The data is simply frozen, and the app was drawing a forecast cone
 * off it as confidently as off a live one.
 *
 * MEASURED, TWICE, NOT GUESSED:
 *   - BERTHA (2026-07-24). NHC retired her: gone from CurrentStorms.json, her
 *     MapServer bin flushed to zero features, her advisory bin archived. GDACS
 *     kept `iscurrent: "true"` on her for ~58 hours with no new analysis. The
 *     Atlantic basin rule in data/merge.js hid the damage by accident — a
 *     GDACS copy of an NHC-basin storm is dropped regardless.
 *   - NOUL-26 (2026-07-26). West Pacific, where that accident does not apply.
 *     GDACS ran ~6 h fixes and then went silent at 2026-07-26T00:00:00Z as the
 *     storm came ashore in Guangdong. Seventeen hours later the app was still
 *     drawing her PRE-LANDFALL cone and forecast points as the live future of
 *     a storm that had already hit.
 *
 * THE DECOY IS `datemodified`. GDACS moved Noul's to 16:37Z on the day it had
 * published nothing since midnight. A backstop reading it would never fire, on
 * Noul or on Bertha. The only honest clock is the ANALYSIS time — the storm
 * model's `observedAt`, GDACS `todate` / NHC advisory issuance — and that is
 * what lib/silence.js reads. Do not "improve" this by reaching for whichever
 * timestamp looks freshest.
 *
 * FOUR CYCLES, and the number is the point rather than the caution. GDACS fixes
 * run 6-12 h apart and NHC's run 6, so 24 h is two missed cycles even for the
 * slowest publisher: it effectively cannot fire on a storm that is genuinely
 * live. That safety is affordable BECAUSE a silent storm is not dropped — it
 * keeps its dot, its past track and its badge, and the only cost of firing late
 * is a label arriving a few hours after it could have. Dropping the storm
 * instead would invert that trade and make a false positive expensive.
 * ------------------------------------------------------------------------- */

export const SILENCE = Object.freeze({
  /** Past this age with no new analysis, the source is treated as having
   *  stopped publishing. Aaron's call at 4 cycles; see the note above for why
   *  erring long is the cheap direction here. */
  after: 4 * ADVISORY_CADENCE, // 24 h
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
  /** ==> THE CEILING WAS 8 UNTIL 2026-07-31 AND THE REASON IT WAS 8 DID NOT
   *  SURVIVE A READ OF THE STYLE. <== §11 said "past z8 you pull in street
   *  grids, which are noise for storm data". We never draw a street. The only
   *  OpenMapTiles source-layers `map/style.js` touches are `water`, `earth`,
   *  `boundary` and `place`, and `place` is rank-filtered — so what actually
   *  arrives past z8 is finer coastline and a few more town names, not a road
   *  network. The stated objection was to a layer set that does not exist.
   *
   *  ==> WHAT FORCED IT: THE 3D SEAMOUNTS FINISH ARRIVING AT z7.8. <== The
   *  edifice handoff (`VOLCANO.map3d.handoff`) completes at 7.8, so at a ceiling
   *  of 8 there were TWO TENTHS of a zoom level in which the mountains and their
   *  sea were fully drawn. The water is unreadable there by arithmetic, not by
   *  taste: at z8 a pixel is ~610 m, so the shortest wave train (2.3 km) is
   *  under 4 px wide and the swell's 480 m of exaggerated vertical is under one
   *  pixel of movement. At z11 that is ~30 px wide and ~6 px of travel, which is
   *  something a person can actually judge.
   *
   *  ==> 11 AND NOT 12+, DELIBERATELY. <== A median water sheet is ~75 km
   *  across; at z11 it is roughly a screen wide, at z12 you are inside one with
   *  the mountain off-screen and no longer looking at a seamount at all.
   *
   *  Downstream: `TILES.sourceMaxzoom` (8) is the DORMANT R2 archive's real data
   *  ceiling and is untouched — flipping `TILES.useR2` back on overzooms past 8
   *  rather than 404ing. `GEOCODE.confirmZoom` derives from `ZOOM.local`, not
   *  from here, so address confirmation did not move. */
  max: 11,

  /** Band floors. A band runs from its floor up to the next band's floor. */
  planet: 0,       // z0-2: continent fills, coast glow, graticule.
                   //       Glyph + category color only. NO LABELS.
  basin: 3,        // z3-4: + major islands, storm names
  regional: 5,     // z5-6: + full coastline resolution
  local: 7,        // z7-8: full coastline detail, surge bands, wind bands

  /** THE LAST TWO LAYERS THAT STILL WANT A HARD FLOOR: forecast TIME LABELS
   *  and the watch/warning coastal stripe. Text and stripes read badly at
   *  partial opacity over the cage; lines and dots do not.
   *
   *  ==> IT IS NO LONGER THE AMBIENT GEOMETRY FLOOR, WHATEVER THE NAME SAYS.
   *  <== Cone, both tracks, forecast points and the last-known-position mark
   *  all carry NO floor now — the MapLibre crossfade is the real gate, so they
   *  materialise with the map instead of popping at a threshold
   *  (map/layers/registry.js). This comment claimed otherwise until 2026-07-29,
   *  and a layer written to it arrived two zoom levels after everything it was
   *  supposed to appear beside. The original rule still holds where it applies:
   *  a staggered arrival reads as a rendering bug rather than as a ladder, so
   *  anything gated here must be gated together. */
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

  /** THE NAME LADDER — four bands, each `[startZoom, endZoom]`.
   *
   *  Each name begins rising while the thing before it is still on screen, so
   *  the map dissolves from one label to the next instead of switching:
   *
   *    cage fades out  2.48 -> 3.86   (derived, see below)
   *    country rises   3.40 -> 4.00   overlaps the cage's last third
   *    country holds   4.00 -> 4.40
   *    state rises     4.20 -> 4.90   begins BEFORE country starts leaving
   *    country falls   4.40 -> 5.00
   *    cities rise     6.40 -> 7.20   (`cityIn` + `fadeSpan`, below)
   *    state falls     6.60 -> 7.40   begins AFTER cities start arriving
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
    /** THE RUNG THAT WAS MISSING UNTIL 2026-08-07. State names used to rise at
     *  4.2 and then never leave — the only label on the map with no exit. Past
     *  the point cities arrived you carried both, forever, and over a place
     *  like Japan or the eastern seaboard that is dozens of area labels sitting
     *  on top of the point labels you were actually trying to read.
     *
     *  Shaped like `countryOut`, one rung down: it begins AFTER `cityIn` (6.4)
     *  so cities are already coming up when states start to go, and it ends at
     *  7.4, just past the zoom cities reach full strength (`cityIn` +
     *  `fadeSpan` = 7.2). Both names are briefly up together, which is the
     *  same offset overlap the country-to-state handoff uses.
     *
     *  ==> THE INVARIANT DOES NOT REACH PAST HERE, AND THAT IS ACCEPTED. <==
     *  "Never a nameless globe" is guaranteed by construction from the cage
     *  through to `cityIn`. Beyond 7.4 the only labels are cities, and a
     *  stretch of coast with no ranked city in frame WILL be nameless. That is
     *  the local band — you are looking at a coastline and a track, not
     *  navigating by region — and it was true of the shipped map at any zoom
     *  past the cities' arrival in an unpopulated frame anyway. If it reads
     *  badly on glass, raise these two numbers rather than deleting the rung. */
    stateOut: Object.freeze([6.6, 7.4]),
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
 * These are unmeasured starting values. `charWidthPx` and `maxTextTiltDeg`
 * are the two worth tuning first against a real busy basin on a phone: the
 * first decides how tightly labels may pack, the second how steeply the text
 * is allowed to lean.
 * ------------------------------------------------------------------------- */

export const LABEL_PLACEMENT = Object.freeze({
  /** Distance from the DOT'S CENTRE to the NEAR END of the label, along the
   *  spoke. The text starts here and runs outward, so the line of text IS the
   *  spoke and it points back at the dot's centre.
   *
   *  IT IS THE NEAR END, NOT THE CENTRE, AND THAT MATTERS. This used to be
   *  the distance to the label's centre, which put a 80px-wide label 26px
   *  sideways from the dot — the label straddled the dot and the text landed
   *  on top of it. Visible on glass 2026-07-26 on Noul, a due-north storm
   *  whose spokes point sideways. Measuring to the near end gives the same
   *  clear gap in every direction. The dot is 10px radius plus a 1.5px
   *  stroke, so 18 leaves about 6px of air. */
  spokeStartPx: 18,

  /** The hardest limit here: the text never leans further than this from
   *  horizontal, in either direction. 45 is Aaron's call and it is a rule,
   *  not a preference — past it the labels stop scanning as text and start
   *  scanning as decoration. */
  maxTextTiltDeg: 45,

  /** The tilt is searched in steps of this many degrees, starting at 0 and
   *  working outward, so the SHALLOWEST angle that fits always wins. Five is
   *  fine enough that the chosen angle looks deliberate and coarse enough
   *  that the search stays cheap. */
  tiltStepDeg: 5,

  /** ONE ANGLE PER STORM. Every label on a track is drawn at the same tilt —
   *  they read as a set of parallel spokes rather than a fan, which is what
   *  Aaron asked for and what his reference photo shows. Only the DIRECTION
   *  each label runs from its dot varies, and that is the side choice below.
   *  This constant exists to name the rule; there is nothing to tune. */
  sharedAngle: true,

  /** Clear space kept between a label and any OTHER storm's-track dot it
   *  might run across. A shallow angle can lay the text straight along the
   *  track and through the next dot, which is how the Noul-style "text on
   *  the glyph" failure comes back by another road. The dot is 10px radius
   *  plus a 1.5px stroke; this is that plus a little air. */
  dotClearPx: 13,

  /** Collision box estimate. We cannot measure rendered text without a
   *  canvas round-trip, and `datelbl` is a short predictable string, so
   *  width is estimated per character. Overestimating is the safe direction:
   *  it spreads labels rather than letting them touch. */
  charWidthPx: 6.2,
  lineHeightPx: 13,
  padPx: 3,

  /** The most CONTIGUOUS GROUPS the labels may be split into. One group means
   *  every label on one side of the track, which is the goal. Two means one
   *  run then the other, e.g. four above followed by four below. Three is the
   *  ceiling on purpose: past that a "group" is one or two labels long and
   *  the result is indistinguishable from labels alternating sides dot to
   *  dot, which is the exact thing this replaced. When even three groups
   *  cannot fit the labels, the answer is to show fewer of them, never to
   *  add a fourth. */
  maxRuns: 3,

  /** How much of the best achievable label count a tidier arrangement is
   *  allowed to give up.
   *
   *  Fewest groups is the goal, so a run of eight on one side is preferred
   *  over seven plus a single rogue on the far side even though the rogue
   *  arrangement shows one more time. But that preference has to stop
   *  somewhere: a track that doubles back can jam one side completely, where
   *  insisting on a single group would throw away most of the forecast to
   *  keep the picture tidy. 0.75 means an arrangement must still show three
   *  quarters of the most any arrangement could show before its tidiness
   *  counts for anything. */
  minKeepFraction: 0.75,

  /** Search safety valve. The number of arrangements to try grows with the
   *  cube of the label count at three groups, so an unexpectedly long track
   *  drops to two groups rather than spending the frame budget. NHC publishes
   *  at most nine forecast points, so this should never fire in practice —
   *  it exists so a surprise from another source cannot stall a phone. */
  maxPointsForThreeRuns: 16,

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

  /** PLATE BOUNDARIES — 241 PB2002 lines, shipped in the repo.
   *
   *  ONE URL BECAUSE TWO RENDERERS READ IT. The Three globe builds its seam
   *  geometry from this file and MapLibre declares a geojson source pointing at
   *  the same one, so the two draw the same lines and hand off between them
   *  (SPEC-GLOBES.md §43.2). It was a bare string inside `proto/world-deep.js`
   *  when only Three read it; a second reader is exactly when that stops being
   *  acceptable (§12, any pattern used twice gets extracted).
   *
   *  The second fetch costs nothing — it is the same URL the browser already
   *  has in its HTTP cache from the first.
   *
   *  NO DENSIFICATION, and that is measured rather than assumed: the longest
   *  segment in the file is 4.08°, short enough to follow the sphere without
   *  cutting a visible chord, and there are ZERO antimeridian crossings, so
   *  there is no wrap seam to split. Both facts are properties of THIS file —
   *  re-measure if it is ever replaced. */
  plateBoundariesUrl: 'assets/hazards/plate-boundaries.geojson',

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

  /* --- LAND TEXTURE: TWO SIZES, AND THE REASON IS TIME-TO-FIRST-PAINT ------
   *
   * The charcoal land fill is rasterised into an equirectangular canvas at
   * runtime (map/globe3d.js `landTexture`) and draped on the sphere. Measured
   * on a cold load, the full-size canvas costs ~202 ms to rasterise and
   * ~511 ms to hand to the GPU. That 713 ms sits in front of the FIRST FRAME,
   * on the one screen where there is nothing to look at yet — and the people
   * who open a hurricane app during a hurricane are the ones who feel it.
   *
   * So the globe boots on a draft, and the full size replaces it a moment
   * later. Nothing about the final picture changes; only when it arrives.
   *
   * WHY FULL SIZE IS 4096 AND NOT PERMANENTLY SMALLER. 4096 across is 9.8 km
   * per texture pixel at the equator, against ~11.6 km per screen pixel on a
   * full-screen phone globe — just finer than the screen, which is the whole
   * point. Halving it to 2048 (19.6 km) softens visibly above ~600 px of
   * globe and takes the small Lesser Antilles from ~3.5 texture pixels to
   * ~1.7, where islands start dropping out of the render entirely. That is
   * the wrong detail for THIS app to lose, so the size stays and the cost
   * moves off the critical path instead.
   *
   * WHY THE DRAFT IS 1024 AND NOT SMALLER STILL. 1024 across is 39 km per
   * texture pixel, against ~64 km per screen pixel at the space floor — where
   * the app always boots. The draft is therefore FINER THAN THE SCREEN at the
   * size the globe actually arrives at, so it looks correct on arrival rather
   * than looking broken for a second. It only reveals itself if you zoom in
   * during the first moment, and it costs about a sixteenth of full size.
   * ------------------------------------------------------------------------ */
  landW: 4096,
  landH: 2048,
  landDraftW: 1024,
  landDraftH: 512,

  /** How long after boot before the full-size land canvas is built.
   *
   *  The build is synchronous and will jank whatever frame it lands on, so it
   *  must not land while the globe is still arriving or while someone is
   *  making their first gesture at it. Idle time is used when the browser
   *  offers it; Safari does not implement requestIdleCallback at all, so this
   *  is BOTH the idle deadline and the plain fallback delay — an idle window
   *  that never comes must not mean a globe that stays soft forever. */
  landUpgradeDelay: 1.2 * SECOND,

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

  /** The head lift for a storm with NO CURRENT READING — ended, or silent.
   *
   *  ==> WHY THIS IS NOT `sevMinLift`, WHICH IS WHAT IT USED TO BE. <==
   *  The head asked for the noise floor (0.16) and the ended grey, and got a
   *  faint cyan bump instead: `stormColorFull` is 0.30, so at 0.16 the node was
   *  only ~38% of the way from resting cyan to grey. The height said "no
   *  reading" and the colour said "not sure" — the §9 disagreement this cage
   *  exists to prevent, on the one state whose whole job is to stop making a
   *  severity claim. Confirmed on glass: Aaron saw no grey at all.
   *
   *  Sitting just ABOVE `stormColorFull` is the whole point — it is the
   *  smallest lift at which the grey arrives at full strength. Derived from
   *  that constant rather than typed, so retuning the colour band carries this
   *  with it (§12: derive, never hand-tune twice).
   *
   *  It is still far below a live storm: a 40 kt tropical storm sits near 0.4
   *  and a Cat 5 at 1.0, so a dead storm cannot out-rank a live one. What it
   *  buys is a mark you can SEE and read as deliberate, rather than a dent. */
  get sevNoReadingLift() {
    return this.stormColorFull + 0.02;
  },

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

  /** Zoom the camera flies to when a result is picked. Derived from the LOCAL
   *  band, never from `ZOOM.max` — the ceiling moved to 11 in 2026-07-31 for
   *  the Deep world's seamounts and address confirmation had no reason to
   *  follow it. Confirmation happens at the top of the local band, not at
   *  street zoom. This is the real constraint on address confirmation:
   *  you are checking the right neighborhood and coastline, not the right
   *  driveway. Dragging the pin is what gets you the last few hundred metres. */
  confirmZoom: ZOOM.local + 1,
});

/* ---------------------------------------------------------------------------
 * ENDED STORMS — the graceful death (SPEC §5)
 *
 * ==> NOT A TIMER. READ THIS BEFORE ADDING ONE. <==
 *
 * A storm ends one of two ways, and NEITHER of them is "it has been a while".
 *
 *   DECLARED   the agency published its final bulletin and said so in words.
 *              NHC's last public advisory carries "...THIS IS THE FINAL NHC
 *              ADVISORY..." in its headline and "This is the last public
 *              advisory issued by the National Hurricane Center on this
 *              system." under NEXT ADVISORY. JTWC's carries "THIS IS THE FINAL
 *              WARNING ON THIS SYSTEM BY THE JOINT TYPHOON WRNCEN PEARL HARBOR
 *              HI." Both CONFIRMED verbatim off live products 2026-07-28
 *              (Post-Tropical Imelda AL092025 #24; Typhoon 26W Mangkhut NR
 *              039). This is a fact the source states, so the app can state it
 *              too, immediately, with no waiting and no inference.
 *
 *   ABSENT     nobody said anything, the storm is simply gone from a list that
 *              is otherwise answering normally — its own source's, or JTWC's
 *              active roster. Counted in CLEAN CONFIRMATIONS, never in elapsed
 *              time — see below.
 *
 * WHY COUNTED AND NOT TIMED. A clock cannot tell a dead storm from a dead
 * network: leave one running and a tunnel, a captive-portal wifi, a relay
 * deploy or one truncated upstream list all read as a storm ending. A
 * CONFIRMATION is a poll that came back clean and did not contain the storm —
 * it is evidence, where elapsed time is only the absence of evidence. A failed
 * poll produces no confirmation at all rather than a negative one, so an hour
 * of dead connectivity moves this counter by zero. Any reappearance resets it
 * to zero.
 *
 * THE ONE FAILURE MODE THIS IS VULNERABLE TO, AND ITS GUARD. A TRUNCATED list
 * is a clean fetch that is missing storms — it looks exactly like the end of
 * the world for whatever fell off the bottom. That is not hypothetical: on
 * 2026-07-26 a wildfire season crowded a live typhoon off GDACS's 100-feature
 * cap (functions/api/gdacs/events.js). So a poll only gets to vote if the list
 * it came back with is CREDIBLE — non-empty, and not less than half of what
 * the previous poll held. A suspicious list is treated like a failure: no
 * votes, in either direction.
 *
 * ==> AND GDACS DOES NOT RETIRE STORMS, WHICH BREAKS BOTH ROUTES AT ONCE. <==
 * It left `iscurrent: "true"` on Bertha for ~58 hours and kept NOUL-26 listed
 * for days after her last analysis. Such a storm is never ABSENT, because it
 * never leaves the list. It is never DECLARED either: the only bulletin that
 * exists for those basins is JTWC's, and JTWC drops a storm from its active
 * list shortly after the final warning, so missing that window — one afternoon
 * with the app closed — used to make the storm immortal.
 *
 * SO JTWC'S ROSTER IS A SECOND AUTHORITY, counted exactly like the first.
 * Falling off JTWC's active list is the same shape of evidence as falling out
 * of a source's list: a feed that answers cleanly and no longer carries the
 * storm. Same confirmation count, same truncation guard, same words. Two guards
 * keep it honest — only a storm JTWC has ACTUALLY LISTED can be killed by
 * falling off the list (GDACS covers systems JTWC never warns on), and an
 * unavailable or partial index attaches no verdict at all, so a JTWC outage
 * moves the tally by zero in either direction. data/lifecycle.js step 4.
 *
 * THE GRACE PERIOD IS THE ONLY DURATION HERE, and it is a DISPLAY duration —
 * how long a dead storm stays on the globe explaining itself before it leaves.
 * There is no data signal for that; there is nothing to measure.
 *
 * ==> IT IS MEASURED FROM THE STORM'S LAST PUBLISHED FIX. <== Not from the
 * moment the app worked out the storm was over. Those two are within an hour of
 * each other for a storm whose ending we read as it happened, and DAYS apart
 * for one we only confirmed later — and anchored on the confirmation, that
 * second storm gets a fresh full window starting from the day we caught up.
 * That is how a system three and a half days silent stayed on the globe. It
 * also makes the two death routes agree: they stamp their moment from different
 * places, and a reader must not get a different lifetime depending on how the
 * app happened to find out.
 *
 * This replaces GHOST_TTL, which was 12 h and was never read by anything.
 * ------------------------------------------------------------------------- */

export const ENDED = Object.freeze({
  /** Silence alone, past this age, ends a storm — the third `reason`,
   *  `lapsed`, alongside `declared` and `absent`.
   *
   *  ==> WHY A THIRD ROUTE EXISTS AT ALL. <== The other two both require
   *  somebody to act. `declared` needs a final bulletin, and for GDACS basins
   *  the only bulletin in existence is JTWC's. `absent` needs the storm to fall
   *  out of a list — and GDACS does not retire storms: it held `iscurrent:
   *  "true"` on Bertha for ~58 h after NHC had fully retired her, and on
   *  KUJIRA-26 it is still true two days after the last analysis. A storm in
   *  that condition can never be confirmed absent because it never goes absent,
   *  and never confirmed declared because nobody writes bulletins for it. Both
   *  death routes are structurally unreachable and the storm is immortal.
   *
   *  48 h — twice SILENCE.after, and the doubling is the argument. 24 h is
   *  already spoken for: it is the badge, the point at which the app stops
   *  drawing the forecast and says so. Reusing it here would collapse the two
   *  states into one instant, and a storm would go from live to gone with no
   *  interval in which the app has said "we have stopped hearing about this" —
   *  which is the entire purpose of the silent state. GDACS was mid-landfall on
   *  Noul when it froze; that hedge has to have a life.
   *
   *  Two full days is four missed cycles at GDACS's slowest 12 h cadence, and
   *  it catches the Bertha class of zombie within a day of it going wrong.
   *  72 h was considered and dropped for having no evidence behind it. */
  lapsedAfter: 48 * HOUR,

  /** How long an ended storm keeps its dot, its past track and its note before
   *  it is dropped for good. A DISPLAY duration, not a detection one — nothing
   *  about the storm changes when this expires, it just stops being drawn.
   *
   *  ==> MEASURED FROM WHEN THE APP CONFIRMED THE ENDING, not from the storm's
   *  last published fix. REVERSED 2026-08-08. <== That is `ended.confirmedAt`,
   *  and lib/lifecycle.js `endedExpired` is where it is read, with the full
   *  reasoning. In short: anchored on `observedAt` this window was already
   *  spent before it opened for every ending that is not read promptly — the
   *  JTWC roster route, `lapsed`, and any absence confirmed overnight — so
   *  those storms vanished on the same poll that ended them instead of showing
   *  a grey day. The unbounded-fresh-window problem that anchoring was
   *  protecting against is now answered by `lapsedAfter` instead.
   *
   *  24 h at Aaron's call, down from 36 on 2026-07-29. Long enough that opening
   *  the app the next morning still shows what happened to the storm you went to
   *  bed watching; short enough that the globe does not carry a season of grey
   *  dots. Nothing about the number is derived — there is no data signal for how
   *  long a dead storm is worth looking at, and pretending to measure one would
   *  be worse than choosing. */
  holdFor: 24 * HOUR,

  /** Clean, credible polls with the storm absent before absence is believed.
   *  Three, because one is a truncation and two is a bad afternoon. At the
   *  30-minute poll this lands around 90 minutes for someone watching, but the
   *  COUNT is the rule and the clock is a side effect — a phone that polls
   *  twice all day takes all day, and that is correct. */
  absentConfirmations: 3,

  /** A poll whose list is smaller than this fraction of the previous one is
   *  not credible enough to vote (see the truncation guard above). 0.5 is
   *  deliberately loose: two of three storms dissipating in one cycle is
   *  real and should still count, while a cap-truncated list that drops most
   *  of the world should not. */
  minCredibleFraction: 0.5,

  /** Ended storms kept in the registry at once, newest first. A cap so a long
   *  season cannot grow localStorage without bound; well above the number
   *  that can be inside a 24 h window. */
  maxRegistry: 12,

  /** Past-track points persisted per ended storm. The track is what makes an
   *  ended storm worth looking at, and it has to survive a reload because
   *  NOTHING can rebuild it — the storm is out of both feeds, so a refetch
   *  returns nothing and the in-memory geometry cache is gone. Capped because
   *  a five-day storm at 6-hourly fixes is ~20 points and anything claiming
   *  hundreds is a parser bug, not a long storm. */
  maxTrackPoints: 64,
});

/* ---------------------------------------------------------------------------
 * DATA ENDPOINTS
 *
 * ===> AS OF §17 PASS B, THE BROWSER FETCHES NO UPSTREAM DIRECTLY. <===
 * Every URL below is reached by a Pages Function; nothing here is passed to
 * `fetch()` from the app. They are recorded because a URL nobody wrote down
 * costs a round trip to rediscover, and because the Functions that DO fetch
 * them cannot import this file (§3, separate runtime) and mirror these values
 * by hand.
 *
 * THE OLD SPLIT WAS "CORS-BLOCKED VS CORS-OK", AND IT WAS THE WRONG QUESTION.
 * CORS-open endpoints were fetched straight from the browser for the app's
 * whole life on the grounds that they worked — which they did, at one user.
 * A shared link during a landfall makes the same code thousands of
 * uncacheable requests per poll from thousands of client IPs, aimed at
 * public-good services, under nobody's control. **CORS-open is a permission,
 * not a capacity plan.** The reason to relay a feed is whichever arrives
 * first: the browser can't reach it, or we can't responsibly point a crowd at
 * it. The CORS ground truth below is still true and still verified
 * in-browser 2026-07-22 — it is just no longer what decides.
 * ------------------------------------------------------------------------- */

export const ENDPOINT = Object.freeze({
  /** CORS-BLOCKED. Relayed because the browser cannot reach them at all. */
  nhcStormList: 'https://www.nhc.noaa.gov/CurrentStorms.json',
  nhcAdeck: 'https://ftp.nhc.noaa.gov/atcf/aid_public/',

  /** CORS-OK, relayed anyway since §17 Pass B — for load, not for access.
   *  Reached via `/api/nhc/mapserver` and `/api/gdacs/events`. */
  nhcMapServer:
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer',
  /** CYCLONES ONLY, and the `alertlevel` triple is not a filter — it is how
   *  you ask this endpoint for the unabridged list (100 rows instead of 20).
   *  `EVENTS4APP` was used until 2026-07-26, when a wildfire season crowded a
   *  live typhoon off its 100-feature cap. The full reasoning, and why the
   *  archive this list carries has to be filtered at ingest, lives in
   *  `functions/api/gdacs/events.js`. */
  gdacsEventList:
    'https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH' +
    '?eventlist=TC&alertlevel=Green;Orange;Red',

  /** GDACS per-event geometry. CONFIRMED LIVE 2026-07-24 — and note this is
   *  the FALLBACK form only: every event in the list feed publishes its own
   *  `url.geometry`, which data/gdacs-geometry.js prefers. Recorded here so
   *  the shape is written down somewhere (the 2026-07-23 probe measured this
   *  endpoint's timing but never recorded its URL, which cost a round trip). */
  gdacsGeometry: 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry',

  /* ---- Volcanoes, live. Six upstreams behind ONE route (§22.4). ----------
   *
   * WHY ONE ROUTE AND NOT THREE. The NHC/GDACS pattern is one relay per
   * source with a client-side merge, and that is right for them because they
   * are two views of the SAME storms. These are three feeds carrying three
   * different definitions of "active", needing dedupe and close-detection
   * before any of it is usable — real logic, which belongs in one place and
   * must not run three times on a phone at boot. The cost is one failure
   * surface, and it is paid for by PER-SOURCE STATE IN THE PAYLOAD so a dead
   * channel reads as dead instead of being averaged into silence.
   *
   * ==> EVERY ONE OF THESE IS CACHE-BUSTED AT FETCH TIME, AND THAT IS NOT
   * TIDINESS. <== Measured on three independent government weather hosts
   * 2026-07-30: a bare fetch of the BoM page returned advisories 29 DAYS OLD
   * while the same URL with a cache-busting parameter returned one 83 minutes
   * old. Without it the relay serves month-old ash during an eruption and
   * every health check passes. See functions/api/volcano/live.js. */

  /** PRIMARY ASH FEED. One fetch, EIGHT of the nine VAAC centres, seven days
   *  of history, full advisory text. Seven days matters: the raw bulletin
   *  slots below are latest-only, so one missed poll there is one lost
   *  eruption, and this page is what makes that survivable. */
  vaacRecent: 'https://www.bom.gov.au/products/Volc_ash_recent.shtml',

  /** THE GAP. ==> BoM CARRIES EIGHT CENTRES AND WELLINGTON IS THE MISSING
   *  ONE, VERIFIED TWICE. <== Wellington covers Vanuatu, Tonga and the
   *  Kermadecs, and Ambae — one of the volcanoes erupting right now — is
   *  inside that hole. BoM alone is a §5 failure sitting directly on top of
   *  live activity. Three bulletin slots, plain text, one host. */
  vaacWellington: Object.freeze([
    'https://tgftp.nws.noaa.gov/data/raw/fv/fvps01.nzkl..txt',
    'https://tgftp.nws.noaa.gov/data/raw/fv/fvps02.nzkl..txt',
    'https://tgftp.nws.noaa.gov/data/raw/fv/fvps04.nzkl..txt',
  ]),

  /** Global weekly activity, every eruption type. NEEDS A BROWSER-SHAPED
   *  User-Agent: a bare server fetch gets 403, and that is the original
   *  reason this layer is relayed at all. */
  volcanoWeekly: 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml',

  /** US alert levels. ==> DO NOT APPEND A QUERY PARAMETER TO THIS URL. <==
   *  Measured: HANS routes on the path, so `?cb=...` is parsed as part of the
   *  action name and the service answers HTTP 200 with
   *  `{"error":"Did not find volcano/getElevatedVolcanoes?cb=..."}`. A
   *  200-with-an-error-body is the worst failure shape there is — it looks
   *  like a healthy fetch of an empty world. This one is cache-busted with a
   *  request HEADER instead. */
  volcanoAlerts:
    'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',

  /** Relay base. One Cloudflare Pages Function, forward-and-cache only.
   *  The app merges NHC and GDACS CLIENT-SIDE — the relay stays dumb. */
  relay: '/api',
});

/** NHC MapServer facts that are not layer ids.
 *
 *  THE LAYER IDS ARE NOT HERE ANY MORE. They live in `SUMMARY_LAYER`
 *  (data/nhc-mapserver.js) as nine fixed numbers, because the app reads
 *  `NHC_tropical_weather_summary` — one flat set of products keyed by
 *  `binnumber` — instead of the per-storm block service it used to address by
 *  arithmetic. The block math, the 26-layer stride, the AT/EP/CP block starts,
 *  the cached service metadata and the layer-NAME patterns that resolved
 *  inside a block are all gone. Read that file's header before bringing any
 *  of it back; it was deleted for a measured reason, not for tidiness. */
export const MAPSERVER = Object.freeze({
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
 * Still outstanding: `glyphs` in style.js points at OpenFreeMap's font
 * endpoint regardless of this flag, so text layers (storm names, live since
 * Phase 2) fetch from OpenFreeMap even on R2 tiles. Self-hosting fonts in the
 * same bucket is a separate decision — see SPEC §15.
 * ------------------------------------------------------------------------- */

export const TILES = Object.freeze({
  /** OpenFreeMap is the basemap. The R2/Protomaps path — still carried by
   *  style.js and coast-source.js — is OFF: its tile proxy cold-reads
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
   *  land polygon at all. style.js handles this structurally with two
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
  /* NO 'theme' KEY — retired 2026-07-26 when light mode shipped. The theme is
   * a DISPLAY PREFERENCE and lives in the `settings` record above with the
   * others, which is what gives it the same load-sanitise-persist-emit rules
   * and the same segmented control for free. A key of its own would have been
   * a second store for one string. */
  /* NO 'scope' KEY — the scope filter was retired 2026-07-25 (see the note
   * where SCOPE used to live). A stored value for a control that no longer
   * exists is a key nothing will ever read again. */
  sections: 'landfall.sections',
  lastVisit: 'landfall.lastVisit',
  /* First-run nudge state (home prompt, install hint) — ui/first-run.js. */
  firstRun: 'landfall.firstRun',
  /* Storms that have ENDED, with their last-known record and past track —
   * data/lifecycle.js. THE ONLY PERSISTED STORE THAT HOLDS STORM DATA rather
   * than a preference, and it has to, for a reason no other key shares: an
   * ended storm is out of both feeds, so a reload has nothing to rebuild it
   * from. Every other store on this list can be thrown away and refetched. */
  ended: 'landfall.ended',
  /* The anonymous device number — lib/device-id.js. THE ONLY KEY ON THIS LIST
   * THAT IS SENT ANYWHERE, and the only cross-visit identifier this app has
   * ever had. Added 2026-08-05 as a deliberate reversal of the old "no
   * cross-visit identifier" line; read lib/device-id.js before touching it.
   * Clearing site data clears it and the device becomes a new device, which
   * is the intended and only reset. */
  device: 'landfall.device',
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
 * ON-SCREEN KEYBOARD (SPEC §10)
 *
 * The drawer is a fixed bottom sheet on a phone, and iOS does not shrink the
 * layout viewport when the keyboard appears — so without these the keyboard
 * covers the sheet and you type blind. ui/keyboard.js measures, panels.css
 * responds.
 * ------------------------------------------------------------------------- */

export const KEYBOARD = Object.freeze({
  /** Below this, whatever shrank the visual viewport was NOT a keyboard.
   *  Safari's address bar growing back on scroll costs tens of pixels; the
   *  shortest phone keyboard is well over two hundred. A floor between the two
   *  stops the sheet twitching while somebody is only reading. */
  minInsetPx: 120,

  /** How long the keyboard takes to finish arriving. iOS animates it in about
   *  a quarter second and reports the new viewport size in stages, so anything
   *  that wants to position against the FINAL size has to wait this out.
   *  Deliberately a shade longer than DURATION.base — it is a hardware
   *  animation we do not control and cannot observe the end of. */
  settleMs: 300,
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
 * JTWC WIND — real knots for the basins GDACS covers (SPEC §4, §6, §9)
 *
 * THE PROBLEM THESE NUMBERS BOUND. GDACS publishes no current wind for any
 * storm. Its present-tense reading is three words, and its strongest word
 * covers everything from a marginal Cat 1 to a 160 kt super typhoon — so every
 * GDACS hurricane drew at the same ~109 kt of cage lift, TALLER THAN A MEASURED
 * NHC CAT 3. JTWC warns on the same basins, publishes one-minute sustained
 * wind exactly as NHC does, and is already fetched in full by
 * /api/jtwc/storms. lib/jtwc-wind.js does the join; these are its limits.
 *
 * EVERY VALUE HERE EXISTS TO STOP A WRONG WIND, not to catch more storms. A
 * GDACS storm with no JTWC wind falls back to today's class midpoint, which is
 * documented, visibly derived, and never displayed as a measurement. A GDACS
 * storm wearing ANOTHER storm's wind is a §5 lie on the one channel the whole
 * severity ramp reads. When these two outcomes compete, the fallback wins.
 * ------------------------------------------------------------------------- */

export const JTWC_WIND = Object.freeze({
  /** How far apart the two agencies' fixes may sit and still be believed as
   *  the same storm, in nautical miles.
   *
   *  DERIVED, not picked. The feeds run on the same six-hourly synoptic clock
   *  but not the same minute, so a genuine pair can be a full cycle apart: six
   *  hours at a fast tropical translation speed of ~20 kt is 120 NM, and JTWC
   *  itself reports position accuracy as poor as 60 NM (`POSITION ACCURATE TO
   *  WITHIN 060 NM`, live on 12W). 200 NM covers both with room and is still
   *  far tighter than the distance between two unrelated cyclones.
   *
   *  IT ALSO DOES A SECOND JOB THAT IS WORTH MORE THAN THE FIRST. When GDACS
   *  freezes on a storm and JTWC keeps warning — Noul, 2026-07-26, the exact
   *  case in the SILENCE note above — the two positions walk apart within a
   *  cycle, this test fails, and the storm keeps its stale GDACS reading
   *  instead of getting a live wind pasted onto a two-day-old position. That
   *  is the honest answer: we do not know that those are the same fix. */
  maxSeparationNm: 200,

  /** Oldest JTWC fix that may be called a storm's CURRENT wind.
   *
   *  Two warning cycles. JTWC warns every 6 h, so one missed cycle is normal
   *  and two is the point at which "this is the wind now" stops being a claim
   *  we can make. Past this the storm keeps its GDACS classification and the
   *  derived midpoint — worse resolution, but honest about its age. */
  maxFixAge: 12 * HOUR,

  /** How close a JTWC forecast hour must be to a GDACS track point before its
   *  wind is used for that point.
   *
   *  Both agencies publish on synoptic hours (00/06/12/18Z), so a real pair
   *  lands exactly or not at all; 3 h is half a step, which accepts the
   *  matching hour and can never reach the neighbouring one. NOT INTERPOLATED
   *  between taus: an interpolated wind is a number no agency published, and
   *  the whole point of this change is to stop feeding the ramp numbers nobody
   *  measured. A point with no matching tau falls back to the class midpoint,
   *  exactly as it does today. */
  forecastMatchTolerance: 3 * HOUR,
});

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
  /** Never reduce an OPEN path below this many points (`simplifyPath`). Lower
   *  than the ring floor on purpose: a two-point path is a legitimate straight
   *  segment, whereas a two-point "ring" is nothing at all. 4 leaves a path
   *  something to curve through after the spline. */
  minPathPoints: 4,
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

  /** Angular width of the seam blend, DEGREES of bearing (half-width either
   *  side of a bearing is windowDeg/2).
   *
   *  THIS IS THE DIAL. The seams are step discontinuities at 90/180/270, and
   *  this is how far either side of one the transition is spread. Too small
   *  and the step survives (the first attempt was effectively ~2°, which is
   *  why nothing changed); too large and a genuinely lopsided storm gets
   *  rounded toward a circle, losing the asymmetry that is real information.
   *
   *  RAISED FROM 24 TO 40 (2026-07-26). At 24 the blend half-width was ±12°,
   *  narrower than the vertex spacing the profile was actually being built
   *  from, so the step reached the screen as a visible shoulder — Aaron:
   *  "I can still see hints of the quadrants." Combined with seamBlurPasses
   *  below, the kernel's effective sigma goes from ~4.6° to ~10.9°. What that
   *  costs and keeps, computed from the Gaussian attenuation of each angular
   *  harmonic: the 90°-period component — the real quadrant asymmetry —
   *  retains ~75% of its amplitude, while the 30°-period component that IS
   *  the hard corner drops to ~7%. The lobes survive; the steps do not. */
  seamWindowDeg: 40,

  /** Blur passes over the radial profile. Repeated raised-cosine converges on
   *  a Gaussian, and that matters for a reason a wider single pass cannot fix:
   *  ONE raised-cosine pass over a step gives a ramp that is smooth in value
   *  and slope but jumps in CURVATURE at each end of the ramp. The eye reads a
   *  curvature jump on a closed outline as a corner even when the outline is
   *  technically smooth — which is what survived at a single pass.
   *
   *  Two passes stay inside the same safety bound as one: each pass is a
   *  convex combination (non-negative weights summing to 1), so the result
   *  still cannot overshoot the published radii. Cost is one extra 360×25
   *  convolution per ring — ~9k multiply-adds, three rings per storm. */
  seamBlurPasses: 2,

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
 * Track line construction (lib/trackline.js) — the past and forecast tracks
 * stitched into one continuous curved path through the current position.
 *
 * THERE IS NO MAXIMUM JOIN DISTANCE HERE AND THAT IS DELIBERATE (Aaron,
 * 2026-07-26). A guard would mean the app silently reverted to a broken
 * picture on exactly the days a feed was behind. It always connects; the
 * silence badge is what says the record is old.
 */
export const TRACK_LINE = Object.freeze({
  /** Catmull-Rom knot exponent. 0.5 is CENTRIPETAL, and the value is the
   *  whole safety argument: at 0 (uniform) the curve overshoots and can loop
   *  back on itself where the direction change is sharp — which on a storm
   *  track is a recurve, the one moment somebody is actually watching. At 0.5
   *  cusps and self-intersections are mathematically impossible. Do not tune
   *  this looking for a rounder line; raise it toward 1 (chordal) for a
   *  tighter one, never lower it. */
  alpha: 0.5,

  /** Target distance between output vertices, DEGREES in the planar frame
   *  (≈ 5 nm). Length-scaled rather than a fixed count per leg: a fixed count
   *  leaves a long leg visibly faceted at close zoom while spending vertices
   *  it does not need on a short one. */
  spacingDeg: 0.08,

  /** Floor and ceiling on samples per leg. The floor keeps a short leg from
   *  collapsing back to its own chord; the ceiling stops one enormous leg —
   *  the connector across a stale feed's gap — from eating the whole vertex
   *  budget before the rest of the track is drawn. */
  minPerLeg: 4,
  maxPerLeg: 24,

  /** Hard ceiling on vertices in one storm's curve. Same reasoning as
   *  RING_POLISH.maxSamples: a pathological track costs a coarser line, never
   *  the frame budget. A 45-fix past track plus a 7-point forecast lands near
   *  600, so this is roughly double the realistic worst case. */
  maxVertices: 1200,

  /** Two coordinates closer than this are the SAME point — used both to chain
   *  GDACS's abutting segments and to collapse the duplicate where the past
   *  track's last fix and the forecast's first are one position. Degrees;
   *  ~0.1 m, which is far below any published fix precision and far above
   *  float noise in a JSON round trip. */
  joinEpsDeg: 1e-6,

  /** How far, in degrees, the last known position may sit from the end of the
   *  past track before the connecting leg is REFUSED rather than drawn
   *  (lib/trackline.js `extendToAnchor`).
   *
   *  A storm with no forecast left still has a position, and the track has to
   *  reach it or it ends in open water beside a grey X. But the leg is a claim
   *  that the storm travelled it, so it needs a bound: a mismatched storm, a
   *  bad parse or a longitude read on the wrong side of the antimeridian would
   *  otherwise draw a confident line across an ocean nothing crossed.
   *
   *  10° is roughly two days of fast movement, which is far beyond any real gap
   *  — the past track normally ends AT the current fix or one 6-hourly step
   *  behind it, about 2° — and comfortably inside the wrong-hemisphere and
   *  wrong-storm errors it is there to catch. Loose on purpose: the cost of
   *  refusing a real leg is a visible gap, and the cost of drawing a false one
   *  is a fabricated track. §5 says which way to be wrong. */
  anchorMaxDeg: 10,

  /** Smallest gap allowed between spline knots, so a near-duplicate that
   *  survives deduping cannot divide by zero. */
  minKnotGap: 1e-9,

  /** Turn angle, DEGREES, past which an assembled path is treating a
   *  reversal as travel. 0 is straight ahead, 180 is a complete about-face.
   *
   *  THE INVARIANT: a storm does not double back onto its own path between
   *  two consecutive fixes. Storms loop, and a real loop turns thirty or
   *  forty degrees per six-hourly fix — a near-180° turn is never weather, it
   *  is an assembly mistake. 150 leaves the sharpest genuine recurve alone
   *  (measured well under 60°) while catching every fold.
   *
   *  It earned its place on glass: Genevieve's past track drew as a lens,
   *  both arms leaving the current-position dot and closing again at the far
   *  end, because the join had picked the OLD end of her track as the recent
   *  one. Nothing errored — the geometry was simply a journey she never made.
   *  Direction of travel now outranks endpoint distance at the seam. */
  maxTurnDeg: 150,

  /** Floor on cos(latitude) when scaling longitude into the planar frame.
   *  A tropical cyclone never gets near the pole, but an extratropical
   *  remnant tracking past 80°N would otherwise stretch longitude toward
   *  infinity and take the curve with it. */
  minCosLat: 0.05,
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
  /** One centre's ensemble, averaged. Non-NHC basins publish nothing else. */
  ENSEMBLE: 'ensemble',
});

/**
 * Which SOURCE a model's deck comes from, and therefore which storms it can
 * ever apply to.
 *
 * NOT a cosmetic grouping — it decides which relay is asked and which rows the
 * picker shows. The two families share NO model codes at all: a West Pacific
 * deck was read on 2026-07-26 and carried none of TVCN/HCCA/AVNO/UKX/HFSA.
 */
export const MODEL_FAMILY = Object.freeze({
  /** NOAA's public a-decks. Atlantic, East and Central Pacific. */
  NHC: 'nhc',
  /** UCAR's TCGP. West Pacific, North Indian, Southern Hemisphere. */
  GLOBAL: 'global',
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
      family: MODEL_FAMILY.NHC,
      sub: 'Blend of all models — usually the most accurate',
    }),
    Object.freeze({
      tech: 'HCCA', label: 'Consensus', pref: 'consensus', group: MODEL_GROUP.CONSENSUS,
      family: MODEL_FAMILY.NHC,
      sub: 'Blend of all models — usually the most accurate',
    }),
    Object.freeze({
      tech: 'AVNO', label: 'GFS', pref: 'avno', group: MODEL_GROUP.GLOBAL,
      family: MODEL_FAMILY.NHC,
      sub: 'Updated 4× a day · longest range',
    }),
    Object.freeze({
      tech: 'UKX', label: 'UKMET', pref: 'ukx', group: MODEL_GROUP.GLOBAL,
      family: MODEL_FAMILY.NHC,
      sub: 'Updated 2× a day · ends at 6 days',
    }),
    Object.freeze({
      tech: 'HFSA', label: 'HAFS-A', pref: 'hfsa', group: MODEL_GROUP.HURRICANE,
      family: MODEL_FAMILY.NHC,
      /* AMPERSAND, not "and": the spelled-out version wraps to a second line
       * in the 340px rail, and a two-line subtitle under a one-line name makes
       * the row taller than every other row in the selector. */
      sub: 'Hurricane Analysis & Forecast System (US)',
    }),

    /* --- UCAR TCGP, for the basins NOAA does not publish (§15) -------------
     *
     * THREE CENTRES, EACH ONE'S OWN PUBLISHED AVERAGE OF ITS OWN ENSEMBLE.
     * The `*EMN` codes are produced by the modelling centres themselves —
     * we do not average the members, because that would be a second answer to
     * a question the source has already answered.
     *
     * MEMBER COUNTS ARE MEASURED, not recalled: a live West Pacific deck on
     * 2026-07-26 carried AP01..AP30 (30), NP01..NP20 (20) and CP01..CP20 (20).
     * If a centre resizes its ensemble this copy is wrong on screen and
     * nothing will fail — it is prose, and prose has no test.
     *
     * LABELS ARE THE ABBREVIATIONS (Aaron, 2026-07-26). "GEFS" over
     * "American": the app names agencies elsewhere and these are the names
     * the model plots everywhere else use.
     *
     * NO ACCURACY CLAIM ON ANY OF THESE ROWS. Consensus earns one in the NHC
     * set because NHC publishes verification showing it. No equivalent
     * ranking was found for these three, and inventing one from reputation is
     * exactly the thing this project has a rule against.
     */
    Object.freeze({
      tech: 'AEMN', label: 'GEFS', pref: 'aemn', group: MODEL_GROUP.ENSEMBLE,
      family: MODEL_FAMILY.GLOBAL,
      sub: 'Average of 30 forecast runs (US)',
    }),
    Object.freeze({
      tech: 'NEMN', label: 'NAVGEM', pref: 'nemn', group: MODEL_GROUP.ENSEMBLE,
      family: MODEL_FAMILY.GLOBAL,
      sub: 'Average of 20 forecast runs (US Navy)',
    }),
    Object.freeze({
      tech: 'CEMN', label: 'GEPS', pref: 'cemn', group: MODEL_GROUP.ENSEMBLE,
      family: MODEL_FAMILY.GLOBAL,
      sub: 'Average of 20 forecast runs (Canada)',
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

/** Extracted so `maxDiscs` and the frame cache's cap can both name it — the
 *  cache holds two frames per disc, and writing 24 as a literal beside a 12
 *  would be a relationship nobody could see. */
const MAX_DISCS = 12;

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
   * Below this fraction of the disc surviving, a frame has NOTHING TO DRAW and
   * the disc is hidden rather than painted.
   *
   * ==> IT REPLACES A BARE `0.005` THAT ONLY EVER RAN ON SATELLITE. <==
   *
   * The radar path never measured anything at all: `keptFraction` was
   * initialised to 1 and only the satellite branch overwrote it, so
   * `rec.empty` was mathematically unreachable for radar. A completely blank
   * radar frame therefore drew a fully transparent raster over a live
   * hurricane and the row said NOTHING — §5's silence-on-failure, and the
   * exact "blank raster reads as clear sky" failure the file warns about three
   * separate times elsewhere.
   *
   * MEASURED 2026-07-26 through the deployed relay, one 900 km disc per point,
   * counting non-transparent pixels inside the rim:
   *
   *   0.00%  Genevieve (12.9N 108.3W) and Fausto (19.7N 139.8W), open Pacific
   *          — both returned a 334-byte PNG, which is the empty signature
   *   0.06%  mid-Atlantic 25N 60W
   *   0.08%  San Juan
   *   0.58%  Anchorage
   *   2.20%  ~100 nm off Louisiana
   *   2.55%  100 nm off Cape Hatteras
   *   3.66%  Miami, over land
   *
   * 0.002 sits in the wide gap between the near-empty cluster and the first
   * real echo, with margin on both sides. THE OLD 0.005 WOULD NOT HAVE DONE:
   * it is close enough to Anchorage's 0.58% to be uncomfortable, and that is a
   * real radar picture of a real city.
   *
   * Satellite is nowhere near either number — the same day measured Fausto at
   * 4.85% and Genevieve at 36.8% kept — so one constant serves both paths, and
   * one constant is right: the question ("did the pass keep anything worth
   * drawing") is identical whichever knockout asked it.
   */
  emptyKeptFraction: 0.002,

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
  maxDiscs: MAX_DISCS,

  /* --- THE FRAME CACHE -------------------------------------------------------
   * Added 2026-07-26 after Aaron noticed identical frames being re-downloaded
   * on every toggle. He was right, and the measurements are worse than the
   * symptom suggested. From the deployed site, same minute:
   *
   *   GIBS sends `Cache-Control: max-age=0, no-store, no-cache,
   *   must-revalidate` plus `Expires: Thu, 1 Jan 1970` plus `Pragma: no-cache`.
   *   A triple-belt refusal — the browser cannot help even in principle.
   *
   *   Four identical back-to-back fetches of one disc: 2523 ms, 11785 ms,
   *   30728 ms, 779 ms. The full 826 KB every time. THIRTY SECONDS on one of
   *   four, which is what a first look at a hurricane can cost.
   *
   *   Two of those four returned 826100 bytes and two returned 826635 — GIBS
   *   serves DIFFERENT frames on consecutive requests, so a fresh fetch can
   *   legitimately hand back an older frame than the one already on screen.
   *   That is an argument for caching, not against it.
   *
   * Radar was already fine, and the asymmetry is why it felt instant: it goes
   * through our own relay, which sets max-age=300, and the browser served the
   * repeat in 3 ms with zero bytes transferred. Satellite now takes the same
   * road (functions/api/imagery/satellite.js), so these numbers are the client
   * layer on top of an edge cache rather than the only defence.
   *
   * THE AGE WE REPORT IS DOWNLOAD TIME, NOT FRAME TIME, and the wording on the
   * row says "Downloaded". We send no TIME parameter (see
   * IMAGERY_SENDS_NO_TIME) so the vendor never tells us when the picture was
   * taken, and cross-origin CORS would not let us read `Date` or `Age` even if
   * it did. Claiming otherwise would be a §5 confident-wrong-answer.
   * ------------------------------------------------------------------------ */
  cache: Object.freeze({
    /**
     * Younger than this, a cached frame IS what a fresh fetch would return —
     * so it is served with no refetch and no age note. DERIVED FROM THE POLL
     * CADENCE, not hand-set: the timer already owns how often frames are
     * replaced, and a second independent number would drift from it.
     */
    currentFor: POLL.imagery,

    /**
     * Older than this, a cached frame is treated as ABSENT: the disc shows
     * loading and waits for real bytes.
     *
     * §5 says stale data plus a visible timestamp beats a blank screen, always
     * — which is why there is no threshold between `currentFor` and here. A
     * twenty-minute-old frame is served instantly, labelled, while the new one
     * downloads. This is the outer bound where "labelled" stops being enough:
     * an hour-old frame is not a picture of the current sky.
     *
     * THE COST OF STALENESS HERE IS NOT POSITION. A storm at 13 kt moves about
     * 12 km in half an hour against a 900 km disc radius — invisible. What
     * changes on that scale is what the CLOUD is doing: convective bursts,
     * eyewall cycles, rapid intensification. That is the thing an old frame
     * misreports, and it is why this is measured in minutes and not hours.
     */
    maxServeAge: 60 * MINUTE,

    /**
     * Frames held at once. Bound every cache (§7). Two per storm, because a
     * user toggling satellite/radar wants BOTH sides to come back instantly —
     * holding one would make every toggle a miss and rebuild the exact problem
     * this cache exists to fix.
     *
     * Compressed PNGs, not decoded buffers: measured 477 KB (quiet frame) to
     * 826 KB (Genevieve at 36.8% kept), so the ceiling is roughly 20 MB. The
     * device reported a 10.7 GB quota against 4.4 MB in use, so this is not
     * close to a constraint — the cap is here to bound a leak, not a budget.
     */
    maxFrames: MAX_DISCS * 2,
  }),

  /** Satellite, which now takes the same road radar always did. See the cache
   *  note above for the measurements that put it there — the short version is
   *  that GIBS forbids caching outright and answers between 0.8 and 30.7
   *  seconds, and behind our own route we own both of those facts. */
  satellite: Object.freeze({
    relay: '/api/imagery/satellite',
  }),

  /** Radar, which is a different problem: already a transparent PNG, needs no
   *  knockout, and covers only the US and its territories. */
  radar: Object.freeze({
    /** MEASURED 2026-07-25: nowcoast.noaa.gov is GONE (403 through a CDN
     *  error page). The service lives here now, and it sends NO CORS header,
     *  which is why radar goes through our relay and satellite does not. */
    relay: '/api/imagery/radar',

    /* ==> THIS BOX IS A REQUEST GUARD, NOT A COVERAGE CLAIM. <==
     *
     * It used to be documented as "the service's stated extent" and read as the
     * answer to "does this storm have radar" — which it is not, and Aaron caught
     * the consequence: Genevieve at 12.9N 108.3W sits inside this box, a
     * thousand miles from the nearest ground radar, and the app cheerfully
     * declared her covered.
     *
     * THE SERVICE IS THE ONLY HONEST AUTHORITY on whether it has data, and it
     * answers plainly — a 334-byte fully transparent PNG (measured 2026-07-26).
     * So coverage is now decided by MEASURING THE FRAME (see
     * `emptyKeptFraction`), and this box's only remaining job is to avoid
     * requests that cannot possibly return anything: nothing in the Indian Ocean
     * or the western Pacific needs to ask NOAA about ground radar.
     *
     * WHICH IS WHY IT IS DELIBERATELY NOT TIGHTENED. A narrower box would be a
     * geography table nobody can verify, and every degree it is wrong by is a
     * storm that HAD radar and was refused it without asking. Being generous
     * costs one 334-byte round trip and buys a guarantee that the answer came
     * from the service rather than from a constant.
     */
    lonMin: -170,
    lonMax: -60,
    latMin: 10,
    latMax: 72,
  }),
});

/* ---------------------------------------------------------------------------
 * PERF (SPEC §17 A5)
 *
 * Thresholds for lib/perf.js, which measures where a slow load actually went.
 * Read that file's header before changing anything here.
 * ------------------------------------------------------------------------- */
export const PERF = Object.freeze({
  /** What counts as the main thread being blocked, in ms.
   *
   *  50 is not a taste call — it is the figure the browser's own `longtask`
   *  observer uses, and picking a different number here would mean counting
   *  something the platform does not report. */
  longTaskMs: 50,

  /** Interactions faster than this are never reported to us at all.
   *
   *  The browser filters BEFORE calling back, so this is a performance knob
   *  as much as a data one: without it a fast-tapping user triggers a
   *  callback per tap, inside the interaction we are trying not to slow down.
   *  40ms is comfortably below the 200ms "feels instant" line, so nothing
   *  that would ever be judged slow can slip under it. */
  eventThresholdMs: 40,

  /** The app's own boot milestones, and the ONLY names mark() will accept.
   *
   *  - `globe`  the map style installed and the globe became touchable
   *  - `data`   the first storm data arrived from the store
   *  - `storms` a storm was actually painted on screen
   *
   *  The GAPS between these are the whole point. A long globe->data gap is a
   *  network or upstream problem; a long data->storms gap is ours. */
  marks: Object.freeze(['globe', 'data', 'storms']),

  /** Hard ceiling on stored marks. A mark name that slips past the list above
   *  cannot grow the map without bound. */
  maxMarks: 16,
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
   *  ==> 1.0 AS OF 2026-07-28. BACK UP FROM 0.25, AND THE REASON IT WAS EVER
   *  TURNED DOWN NO LONGER EXISTS. <==
   *
   *  0.25 was set on 2026-07-26 because the sink was a CONSOLE. Cloudflare's
   *  real-time Worker log has no aggregation and no query, so volume there
   *  was never a bill — it was ILLEGIBILITY, and past a few hundred lines a
   *  second the one message that matters is unreadable. That argument died
   *  when the sink became D1 (§17): a database does not get harder to read
   *  as rows arrive, it gets more useful.
   *
   *  ==> THE SIZING ARGUMENT, WITH REAL NUMBERS. <==
   *  D1's free tier is 100,000 ROWS WRITTEN PER DAY, and "rows written"
   *  counts index updates — one logical insert costs more than one row.
   *  Measured against this schema on 2026-07-28: a `sessions` insert cost 4,
   *  a `source_rollup` upsert about 2.
   *
   *  A visit at full sampling is one session row plus roughly four feed
   *  transitions (nhc and gdacs, each loading -> ok):
   *
   *      1 x 4  +  4 x 2   ~=  12 rows written per visit
   *
   *  2026-07-27 was a deliberate traffic peak — a forum post — and produced
   *  386 visits. That is ~4,600 rows, under 5% of a day's budget. The
   *  ceiling is roughly 8,300 visits a day, about 21x the busiest day this
   *  app has ever had.
   *
   *  ==> THE CASE THAT WOULD ACTUALLY BREAK THIS, SO IT IS NOT A SURPRISE.
   *  Errors are per-session and rare. SOURCE STATE TRANSITIONS ARE GLOBAL:
   *  when NHC flips to `unavailable`, EVERY live session reports it within
   *  one visibilitychange. Five thousand CONCURRENT readers is five thousand
   *  beacons describing one fact, and the per-minute rollup bounds the
   *  STORAGE of that, not the writes. Daily totals are what matter, and one
   *  such spike is ~10,000 rows — survivable. Several a day during a
   *  landfall with genuinely viral traffic is the scenario to watch.
   *
   *  **The lever is this line. 0.25 is a quarter of the load and still a
   *  large sample; 0.05 is the floor worth having.** A one-line push, not a
   *  rebuild. Revisit if sustained traffic passes a few thousand a day. */
  sampleRate: 1.0,

  /** Length of the anonymous device number, in hex characters (lib/device-id.js).
   *
   *  16 hex characters is 64 bits. The collision arithmetic, since the whole
   *  point of this field is counting: at 8,300 visits a day — the ceiling
   *  `sampleRate` is sized against — a full year of every visit being a
   *  DIFFERENT device is ~3 million numbers, and the chance any two of them
   *  collide is about one in four billion. Two devices counted as one is a
   *  wrong answer to the only question this field exists to answer, so it is
   *  sized to make that impossible rather than unlikely.
   *
   *  ==> IT IS ALSO THE SERVER'S VALIDATION RULE. <== functions/api/beacon.js
   *  accepts exactly this many lowercase hex characters and nothing else, so
   *  the column can never hold caller-controlled text. Changing this number
   *  changes that gate; the two must move together. */
  deviceIdHexChars: 16,

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

/**
 * POPULATION — the town list, the heat layer, and the in-path headcount.
 * SPEC §7 (layer manifest), SPEC.md §5 (three states).
 *
 * ==> ONE DATA FILE, TWO READERS, AND THAT IS THE WHOLE DESIGN. <== The heat
 * layer and the number in the storm drawer are the same 107,464 towns. Whoever
 * needs it first pays for it; the second gets it free. A visitor who never
 * opens a storm and never switches the layer on downloads nothing at all.
 *
 * WHY IT IS LAZY RATHER THAN WARMED. 670 KB gzipped is not a lot, and it is
 * also not nothing on the phone connection of somebody checking a hurricane
 * during a hurricane. Every byte on the critical path competes with the cone.
 * The file is service-worker cacheable, so the cost is once per device.
 */
export const POPULATION = Object.freeze({
  /** Built by tools/build-population.mjs. Flat [lon, lat, pop, …]. */
  url: 'assets/hazards/population-towns.json',

  /** What the shipped file holds, stated so a test can catch a silent
   *  truncation — a half-downloaded list would still parse and would still
   *  produce a plausible-looking, wrong headcount. */
  expectedTowns: 107464,

  /** The population floor of the source list. Surfaced in the UI note: this
   *  is the number that makes the count an undercount, so it is a fact the
   *  user is entitled to rather than an implementation detail. */
  minTownPopulation: 1000,

  /**
   * ==> A TOWN FADES IN. IT DOES NOT POP IN. <== The first build gated the
   * heat with a `step` filter on population, so at zoom 3 every town between
   * 50,000 and 300,000 arrived in a single frame. Aaron caught it on glass and
   * the description was exact: "the detailed data just pops in".
   *
   * A filter is binary; a threshold that slides with zoom is not. So the gate
   * moved onto WEIGHT rather than membership. Each town's contribution ramps
   * from nothing to full as the threshold passes it, which means nothing ever
   * appears — things only get louder.
   *
   * THE THRESHOLD IS IN LOG10 OF POPULATION, because that is the space the
   * weight already lives in, and two different ideas of "how big is this town"
   * are two things that can drift apart. 5.0 is 100,000 people; 3.0 is the
   * floor of the shipped file.
   *
   * Read as: at this zoom a town of exactly 10^log contributes nothing, and
   * one of 10^(log + fadeWidthLog) contributes its full weight.
   */
  fadeThresholdLog: Object.freeze([
    Object.freeze({ zoom: 0, log: 5.0 }),  // planet — 100k enters, 500k full
    Object.freeze({ zoom: 3, log: 4.3 }),  // basin — 20k enters
    Object.freeze({ zoom: 5, log: 3.6 }),  // regional — 4k enters
    Object.freeze({ zoom: 7, log: 2.8 }),  // local — under the floor, all in
  ]),

  /** How much population a town crosses while fading in, in log10. 0.7 is a
   *  factor of five: wide enough to read as a fade rather than a fast edge,
   *  narrow enough that the threshold still means something. */
  fadeWidthLog: 0.7,

  /**
   * ==> THE FILTER STILL EXISTS, AND IT MUST NEVER CUT A TOWN THAT WOULD BE
   * VISIBLE. <== Drawing all 107,464 points at every zoom is real work, so a
   * cheap membership test still earns its place. But a `step` is discrete and
   * the fade is continuous, so a filter set at the CURRENT threshold would
   * clip towns mid-fade and reintroduce the exact pop it exists to prevent.
   *
   * Each entry is therefore the LOWEST threshold its zoom range will reach —
   * which is the threshold at the START of the next range. A town enters the
   * source already weighing zero and fades up from there.
   *
   * These are not independent numbers. They are `fadeThresholdLog` read one
   * row ahead, and they change when it changes.
   */
  filterFloor: Object.freeze([
    /* ==> ROUNDED DOWN, NOT TO THE NEAREST ROUND NUMBER. <== 10^4.3 is 19,952
     * and 10^3.6 is 3,981. Writing the tidy 20,000 and 4,000 puts the filter a
     * hair ABOVE the threshold it is meant to sit under, which clips a sliver
     * of towns mid-fade — the pop-in bug back again, too small to see and
     * still wrong. The test asserts this and caught exactly that. */
    Object.freeze({ zoom: 0, pop: 19000 }),  // under 10^4.3, the z3 threshold
    Object.freeze({ zoom: 3, pop: 3900 }),   // under 10^3.6, the z5 threshold
    Object.freeze({ zoom: 5, pop: 1000 }),   // z7's threshold is under the floor
  ]),

  /**
   * Heat radius, by zoom.
   *
   * ==> THE BUG AARON DESCRIBED — "so large over Japan, then as you zoom it
   * shrinks and disappears" — IS ONE MISTAKE SEEN FROM BOTH ENDS. <== The
   * radius was in SCREEN pixels and grew only gently with zoom, so the ground
   * distance it stood for was wildly different at every altitude. At the basin
   * band a 20 px blur covered roughly 400 km, which turned Honshu into one
   * continuous smear and claimed a density nobody measured. At the local band
   * the same curve had fallen to a fraction of that in ground terms, so cities
   * thinned into separate specks and the field appeared to evaporate.
   *
   * ==> SO THE RADIUS IS NOW ANCHORED TO THE GROUND, NOT THE SCREEN. <== A
   * town's catchment is a real distance — call it `groundRadiusKm` — and the
   * pixel figure below is that distance converted at each zoom. Web Mercator
   * doubles its scale per zoom level, so these values double too. That is the
   * curve that keeps a blob the same size ON THE PLANET while the planet
   * changes size on the phone, which is the only version of this that is
   * making an honest claim.
   *
   * TWO CLAMPS, BOTH FOR REASONS THE MATHS DOES NOT KNOW ABOUT:
   *   - A FLOOR near the planet band. True ground-scale would put a town under
   *     one pixel out there, which is not a density field, it is noise. The
   *     floor holds cities at a readable dot — honest, because a dot claims
   *     far less than a smear did.
   *   - A CEILING past the local band. Heatmap cost is per-point and scales
   *     with the square of the radius, and unbounded doubling would put a
   *     several-hundred-pixel quad under every town. This is where the layer
   *     stops being exactly ground-true, and it is a deliberate trade rather
   *     than an oversight.
   */
  groundRadiusKm: 20,

  heatRadius: Object.freeze([
    Object.freeze({ zoom: 0, px: 5 }),    // floor — a city is a dot out here
    Object.freeze({ zoom: 4, px: 6 }),    // floor still binding
    Object.freeze({ zoom: 5, px: 9 }),    // ground scale takes over
    Object.freeze({ zoom: 6, px: 17 }),
    Object.freeze({ zoom: 7, px: 33 }),
    Object.freeze({ zoom: 8, px: 60 }),
    Object.freeze({ zoom: 9, px: 90 }),   // ceiling starts to bite
    Object.freeze({ zoom: 11, px: 110 }),
  ]),

  /**
   * ==> WEIGHT IS THE LOG OF POPULATION, NOT POPULATION. <== Tokyo is 22.3
   * million and a small town is 1,000 — a ratio of 22,000:1. Fed in raw, the
   * ramp saturates at Tokyo and is mathematically indistinguishable from black
   * everywhere else, which is a map of Tokyo, not a map of people.
   *
   * `log10(pop)` compresses the same range into 3 to 7.35, and those are the
   * two numbers below. Everything between lands on a usable part of the ramp.
   */
  weightMinLog: 3,      // log10(1,000)
  weightMaxLog: 7.35,   // log10(~22.3M), the largest place in the file

  /**
   * ==> THE SMALLEST TOWN MUST NOT WEIGH EXACTLY ZERO. <== Normalising 3.0 to
   * 0 makes every thousand-person town contribute literally nothing — and so a
   * hundred of them scattered across a rural county sum to nothing as well,
   * which is the opposite of what a density field is for. This floor is what
   * lets a scatter of small places read as somewhere people live.
   */
  weightFloor: 0.12,

  /**
   * Which wind band the drawer headcount uses. Aaron's call: the
   * tropical-storm-force band, not the cone.
   *
   * ==> THE CONE IS NOT AN IMPACT AREA AND COUNTING PEOPLE IN IT WOULD TEACH
   * THAT IT IS. <== The cone is where the CENTRE is likely to go — two thirds
   * of the time, historically. It says nothing about how far the damaging wind
   * reaches, which is the entire question "how many people are affected" is
   * asking. The wind swath is the shape that answers it, and both NHC and
   * GDACS publish one.
   *
   * 34 kt (GDACS: ~60 km/h) is the threshold, because tropical-storm-force
   * wind is where outdoor work stops, power lines come down, and evacuation
   * windows close. The stronger bands are a smaller, more alarming number
   * about a smaller area; this is the one that matches the plain-English
   * phrase "in the path".
   */
  pathSlot: 'windSwath',
  pathThresholdKt: 34,
});
