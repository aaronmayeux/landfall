# SPEC-DATA.md — Landfall data architecture

**This is §4 of the Landfall spec.** It describes how data reaches the app: which
source is trusted for what, how the two merge, how failure is handled.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered or
> the route taken to get there. Fences ("do not re-propose X") live in SPEC.md's
> SETTLED list, one line each.
> **Section numbers are permanent addresses.** ~950 code comments cite them.
> A section may move between files; it may never be renumbered.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact we haven't tested.
Nothing marked `[VERIFY]` may be treated as confirmed.

---

## 4. Data architecture

### 4.1 Companion documents

**`spec-parameter.md` is the field reference and it is authoritative.** Every
field either feed publishes — name, type, units, sentinels, real sample payloads
— measured from a live pull. This file describes architecture and deliberately
does not duplicate those tables.

It exists for offline work. The cloud sandbox has no network route to
`nhc.noaa.gov`, `mapservices.weather.noaa.gov` or `gdacs.org`. When a session
cannot reach the sources, `spec-parameter.md` is the substitute for the feed.
Build against it rather than guessing; treat anything marked `[UNVERIFIED]` as
unproven.

**`SPEC-HAZARDS.md` scopes the expansion beyond cyclones** — earthquakes,
floods, volcanoes, drought, wildfire. All six GDACS hazard types return an
identical property schema, so `data/gdacs.js` is already most of a six-hazard
parser; what differs is the severity unit, the upstream source and the geometry
classes. One normalizer, six severity adapters.

Captured payloads are committed so the data layer can be built with no network:
`assets/hazards/` (client-shipped seed catalogs — 1,196 Smithsonian Holocene
volcanoes, PB2002 plate boundaries), `samples/gdacs/`, `samples/other/`.

TC is the built, shipped hazard. The rest is scoped, not started.

### 4.2 CORS ground truth

**Only a real browser can answer this.** A server emits
`Access-Control-Allow-Origin` only in response to a request carrying an `Origin`
header, and server-side fetches (Cloudflare Functions, curl) do not send one.
Edge probes therefore report "no CORS header" for endpoints that work fine in a
browser. This table is browser-tested; do not "correct" it from a server probe.

| Endpoint | Browser fetch |
|---|---|
| `www.nhc.noaa.gov/CurrentStorms.json` | **BLOCKED** — no header, server returns 200 |
| `mapservices.weather.noaa.gov/.../NHC_tropical_weather/MapServer` | OK |
| `www.gdacs.org/gdacsapi/.../geteventlist/SEARCH` | OK |
| `ftp.nhc.noaa.gov/atcf/aid_public/` (a-decks) | **BLOCKED** |
| Satellite vendors (GIBS, EUMETSAT) | OK — `*` |
| NOAA radar ImageServer | **BLOCKED** |

**The browser now fetches no upstream source directly.** Every `ENDPOINT` URL is
reached by a Pages Function. CORS is no longer the reason for most relay hops —
see 4.3.

### 4.3 The relay — keep it dumb

Forward and cache only. **The app merges NHC and GDACS client-side**, because:

1. Merge logic in a browser is debuggable on a phone plugged into a laptop.
2. The fiddly rules live in the merge and get tweaked often.
3. One source down must not blind the other (§5). Client-side, NHC storms draw
   while GDACS is timing out.

**Two reasons to relay a feed, and CORS is only one of them.** *CORS-open is a
permission, not a capacity plan.* The other is load: on a shared link during a
landfall, the same code makes thousands of uncacheable requests per poll from
thousands of IPs. The MapServer path alone was nine layer queries per storm, per
reader.

**Routes:**

| Route | Job |
|---|---|
| `/api/nhc/storms` | Forward the CORS-blocked storm list |
| `/api/nhc/adeck` | Forward + gunzip + filter model a-decks |
| `/api/nhc/mapserver` | Forward MapServer queries, build the WHERE clause |
| `/api/nhc/advisory` | Forward + cache the advisory `.shtml` |
| `/api/gdacs/events` | Forward the cyclone event list |
| `/api/gdacs/geometry` | Forward + edge-cache per-event geometry |
| `/api/jtwc/storms` | Name↔designation index, wind ladder, final-warning flag |
| `/api/jtwc/warning` | Forward + cache a warning `.txt` |
| `/api/tcgp/adeck` | UCAR model guidance for non-NHC basins |
| `/api/imagery/satellite` | Forward + cache satellite frames |
| `/api/imagery/radar` | Forward radar (CORS-blocked, pixels must be read) |
| `/api/geocode` | Proxy Mapbox — a secret problem, not a CORS one |
| `/api/beacon` | Telemetry sink |
| four `/inspect` routes | Read-only probes, secret-gated |

**The a-deck route bends "keep it dumb", deliberately and once.** It gunzips (the
upstream is a `.gz` *file*, not a gzip-encoded response) and drops every row
outside the five-model shortlist. Decks are warmed for every storm, not fetched
on selection; a deck carries ~100 model codes and runs to a few MB, and a busy
season is eight or nine storms. The filter cuts >90%. It does not violate the
rule's intent because an allowlist of five literal strings decides nothing —
every judgement still runs in `lib/adeck.js` in the browser. **`?full=1` returns
the deck unfiltered.**

**GDACS geometry is relayed for SIZE, not CORS.** 180–400 KB per event from a
European server, pulled fresh every load, against small US-hosted NHC queries
beside it. The client passes the *published* upstream URL as a parameter (§4.6
requires reading `url.geometry` off the feed rather than constructing it), so
`safeUpstream()` requires https, host exactly `www.gdacs.org`, and the exact
geometry path, refusing with 400 without fetching. Cache keys are the validated
URL, so `episodeid` keys the cache for free and a new episode self-invalidates.

**`/api/geocode` is a secret problem.** A Mapbox token in a static bundle is a
public token, and a stolen geocoding key bills until somebody notices.
`MAPBOX_TOKEN` is a Pages environment variable, never in the repo. The function
rate-limits per IP, caps query length, caches 30 days, and returns **codes, never
prose** — `geocode_not_configured` / `geocode_auth_failed` / `rate_limited` /
`geocode_unreachable` — because the client is the layer with the context to write
a sentence (§5). Autocomplete is debounced and floored at a minimum length.

**The MapServer route builds the WHERE clause itself** from a validated bin
number. Accepting a caller's `where` string would make it an arbitrary query
proxy into a federal service. **ArcGIS's 200-with-error body is forwarded
verbatim and never cached** — the client depends on seeing it to mark a layer
`unavailable` rather than empty. **There is one filter mode; `all=1` does not
exist.** On the summary service `1=1` returns every active storm, which would
hand one storm's panel three storms' cones.

**An empty FeatureCollection is cached 5 minutes, never as last-good.** An empty
answer for a valid bin is transient — geometry not published yet, or a storm just
retired. The window matches `CACHE.geometryRetryMs`, which is how long the client
waits before asking again; if they drift, one side spends the whole window
re-reading the other's cached nothing.

### 4.4 Sources and split

- **NHC/CPHC** (native, full fidelity): Atlantic, East Pacific, Central Pacific.
  Storm ids basin-prefixed `al` / `ep` / `cp`.
- **GDACS** (EU/JRC, coarser): Northwest Pacific, North Indian, Southwest Indian,
  Australian region, South Pacific.
- Where both know a storm, **NHC wins** — drop GDACS storms in NHC basins.
- **JTWC is the wind for the GDACS basins.** GDACS gives the roster and the
  geometry and has no current wind to give; its three-word classification cannot
  tell a Cat 1 from a Cat 5. JTWC warns on the same basins and publishes
  **one-minute sustained** wind exactly as NHC does, so it lands on the
  Saffir-Simpson thresholds with no conversion — which no RSMC feed can claim.
  `/api/jtwc/storms` already fetches every active warning for the name index, so
  reading intensity out of text already in memory costs zero extra requests.
  `lib/jtwc-wind.js` carries the join and the guards.
  **JTWC does not replace GDACS and cannot:** no cone, no wind bands, no past
  track, and it drops a storm at the final warning while GDACS keeps it.

**The GDACS list is cyclone-only, and that is a correctness requirement.**
`geteventlist/SEARCH?eventlist=TC&alertlevel=Green;Orange;Red`. The old
`EVENTS4APP` mixed every hazard type into one 100-feature cap; wildfire season
took 93 of 100 slots and a live typhoon fell off the end while every layer of the
stack reported healthy.

- **The `alertlevel` triple is load-bearing.** Without it the endpoint returns 20
  rows, measured missing live storms. Do not tidy it out of the URL.
- **The list carries ~a year of finished storms.** `iscurrent` is a **string**,
  not a boolean, filtered at ingest in `data/gdacs.js` and again in
  `worker/src/sources.js` before geometry keys are derived.
- `data/gdacs.js` warns when a list with features in it parses to zero current
  cyclones. Console-only, and it over-fires in a quiet off-season on purpose.

**`iscurrent` is not a liveness flag** — it means "GDACS has not archived this
yet", and it goes stale by days (observed at 51 and 58 hours on retired storms).
Liveness is decided by §5's silence and ended rules, never by this field.

### 4.5 NHC MapServer

NOAA publishes these products twice.

**`NHC_tropical_weather` — the block service. NOT USED.** 400 layers in per-storm
blocks of 26, addressed by arithmetic off `binNumber`. Abandoned because the
address is derived from a label and the data is not: when a storm crosses 140°W
the feed flips its bin from EP to CP, and the new block exists and is completely
empty while the geometry is still in the old block at the previous advisory. In
the Pacific a basin change is not an edge case.

**`NHC_tropical_weather_summary` — the service the app reads.** 35 layers, every
storm in one set keyed by `binnumber`. Fixed ids: no arithmetic, no stride, no
metadata round trip, no name matching. It also runs ahead of the block service.

| Id | Name | Wired as |
|---|---|---|
| 5 | Forecast Points | `forecastPoints` |
| 6 | Forecast Track | `forecastTrack` |
| 7 | Forecast Cone | `cone` |
| 8 | Watch-Warning | `watchWarning` |
| 10 | Past Points | `pastPoints` |
| 11 | Past Track | `pastTrack` |
| 12 | Past Cumulative Wind Swath | **never** — rasterized, §7 forbids it |
| 13 | Past Wind Radii | `windPast` |
| 15 | Forecast Wind Radii | `windSwath` |
| 16 | Advisory Wind Field | `windCurrent` |
| 18, 19 | Wind arrival — earliest reasonable / most likely | unwired |
| 22–24, 26–28 | Inundation and tidal mask | unwired |
| 30–32 | Probabilistic winds 34 / 50 / 64 kt | unwired |
| 1–3, 33, 34 | Tropical weather outlooks | unwired |

Group layers (0, 4, 9, 14, 17, 20, 21, 25, 29) cannot be queried. `Image_*`
layers are rasters; only boundary and footprint are queryable as geometry.

- **Every layer carries `binnumber`, and that is why this service wins.** Four
  also carry `stormid` (12, 13, 15, 16), deliberately unused: one filter currency
  that works everywhere beats two that each work somewhere. `stormid`'s case also
  varies between layers (`EP062026` on 13, `ep062026` on 15).
- **Geometry is simplified at the relay** via `maxAllowableOffset` on the polygon
  and line layers (6, 7, 11, 13, 15, 16) — a query parameter, so the bytes are
  never sent. 0.01° ≈ 1.1 km, below what a quadrant arc means at any zoom this
  app renders and below the whole-nautical-mile precision NHC issues. Point
  layers are excluded by design: simplification is a no-op on points, and past
  points feed the swath envelope's join and must stay exact. Measured on one
  storm, one load: **1.29 MB → 96 KB.**
- **Four layers carry the word "wind"** — Past Cumulative Wind Swath, Past Wind
  Radii, Forecast Wind Radii, Advisory Wind Field. Recorded so nobody
  reintroduces name matching on them; fixed ids removed that class of bug.
- **Wind arrival is fetched, never computed.** NHC publishes it as its own
  geometry (18, 19). Anything downstream saying "derive arrival from the radii"
  is stale and this line supersedes it.
- **`lat`/`lon` ATTRIBUTE fields are rounded to whole degrees** on every layer
  that has them — up to ~30 nm of error. **Always read the geometry.**
- **A bin's past-track layer carries the storm's pre-name history.** One system
  through genesis appears under `INVEST`, `SIX`, `FAUSTO` on consecutive points,
  all sharing one `binnumber`, and Past Track's `stormname` is `null` besides.
  That is intended — the track honestly shows where the storm came from.
  **Never key anything off `stormname` from these layers.**
- **Peak Storm Surge is a separate MapServer** (`NHC_PeakStormSurge`, polygon
  layer 2) with **no `stormid` field**. Filter spatially.

**Current position and the forecast's first dot are different things, and both
are correct.** `tau 0` is the synoptic analysis time (00/06/12/18Z); the advisory
is issued up to three hours later — roughly 40 nm of travel at 13 kt. The feed's
`latitudeNumeric`/`longitudeNumeric` is the current position and is what the app
draws as the storm; tau 0 is drawn as a forecast point. **Treating tau 0 as
current would plot the storm where it was three hours ago.** Clutter is solved by
rendering — one current-position marker, forecast points starting at tau 0
without a competing dot on top.

**Model tracks (a-deck), `lib/adeck.js`.** Comma-separated. Columns read: `[2]`
DTG (`YYYYMMDDHH` UTC), `[4]` tech, `[5]` tau, `[6]`/`[7]` lat/lon.
- **Coordinates are TENTHS of a degree with a hemisphere letter** — `286N` is
  28.6, not 286. A parser reading digits as degrees produces positions that wrap
  to a plausible wrong place rather than failing.
- **A tau repeats across the 34/50/64 kt rows** with identical position; first row
  per tau wins. Reading them all triples every track.
- Per-tech latest cycle, dropped if >12 h behind the deck's newest. Clip leading
  points behind the current position; anchor at the current dot.
- `aid_public` holds `al`/`ep`/`cp` only. Non-NHC basins come from UCAR's Tropical
  Cyclone Guidance Project via `/api/tcgp/adeck`. **The deck id is READ off
  TCGP's own current-storms list** (`/api/tcgp/storms`), matched by name — never
  built from JTWC's designation. Borrowing the id from the Navy added a second
  liveness condition nobody wrote down: when JTWC issued its final warning on
  NOUL the designation vanished and the app stopped even attempting a fetch that
  would have succeeded, with a current 12Z deck sitting there readable.

**`?carq=1` — THE SAME FILE, A DIFFERENT QUESTION.** `CARQ` rows are the storm's
own analysed history: NEGATIVE taus, a real `VMAX` at each. They are the ONLY
source of a measured wind for a GDACS storm's PAST, since a JTWC warning carries
no history. `lib/carq.js` parses, `data/carq.js` fetches, `data/gdacs-points.js`
stamps. Three rules, all measured on DOLPHIN's live deck:

- **One valid time is republished by up to five cycles and they DISAGREE.** Each
  cycle restates the previous 24 h at tau -24/-18/-12/-6, and JTWC revises its
  own analysis: valid 2026-07-27 00Z reads `128N` in its own cycle and `131N` in
  all four later ones. **Newest cycle wins** — a later analysis is a correction,
  not a rival.
- **A storm can cross the dateline inside one deck** (`1760W` → `1797E` →
  `1707E`). The join's position guard is a great circle, never a coordinate
  difference, which would read that as most of the planet.
- **Never key off the storm name.** DOLPHIN's own deck walks `INVEST` → `TWELVE`
  → `DOLPHIN` — one system through genesis, renamed twice. The join matches on
  time and place.

**It is a SEPARATE relay mode and a separate cache key, not an addition to the
model shortlist.** Merged into the guidance response these rows reach
`map/layers/model-tracks.js`, which draws what it is given — painting a storm's
past across the map as a five-day forecast.

**Both a-deck variants are cron-warmed** (`tcgpDerived` in `worker/src/sources.js`).
UCAR states TCGP is not an operational service, and `caches.default` is
per-datacentre across 300+ colos — a 300x fan-out at a non-operational academic
host is the least defensible load in the app. This is warmable at all only
because TCGP PUBLISHES the deck id: nothing is derived, so nothing is duplicated
across the deploy boundary (contrast `/api/nhc/mapserver`, §17).

**FIRST THING TO CHECK IF NON-NHC MODEL GUIDANCE DIES EVERYWHERE AT ONCE:** the
live data sits behind a path containing `hurricanes-beta` on `verif.rap.ucar.edu`
(`functions/api/tcgp/adeck.js`). A rename there breaks West Pacific and Indian
Ocean model tracks and nothing else in the app. Symptom is `/api/tcgp/adeck`
404ing for every storm simultaneously while NHC basins keep drawing.

### 4.6 GDACS geometry

`data/gdacs-geometry.js`, `data/gdacs-points.js`. **`spec-parameter.md` §32.2 is
required reading before touching GDACS polygons.**

- **The geometry URL is published, not guessed.** Every event carries
  `url.geometry`, `url.report`, `url.details`. **Read it off the feed.**
- **`featuretype` is the ONLY reliable discriminator** between the two polygon
  families. Colour class and `polygonlabel` both appear on each.
  - `"WindRadii"` → one forecast timestep's footprint.
  - `null` → the **pre-merged full-track corridor** for that threshold, with
    properly rounded end caps. **Use it** — `windSwath` reads this; the
    occupancy-grid reconstruction in `lib/bandmerge.js` is a fallback only.
  - `"PointRadii"` → track centre dots.
- **Band thresholds are round METRIC values**, each stated in the band's own
  `polygonlabel`:

  | `Class` | published | ≈ knots |
  |---|---|---|
  | `Poly_Green` | 60 km/h | 32.4 |
  | `Poly_Orange` | 90 km/h | 48.6 |
  | `Poly_Red` | 120 km/h | 64.8 |

  Drawn in the §6 34/50/64 colours because they are the same three severity
  tiers. **Never relabelled as 34/50/64 kt anywhere the user sees.** The panel
  shows GDACS's own km/h.
- **`alertlevel` is not a threshold.** It rides on every geometry feature reading
  "Orange" — the storm's *humanitarian* level. Same three colour words, two
  unrelated meanings, one payload. `bandFromFeature()` requires the class and the
  published label to agree within `bandLabelToleranceKmh`; a contradiction drops
  the feature rather than painting a guessed colour (§6).
- **Bands are per-timestep, not merged.** `windCurrent` is the earliest timestep
  (the analysis time, matching `todate`); `windSwath` is the published corridor.
- **Bands are quadrant-shaped**, four-lobed with notches where quadrants meet —
  the same shape family NHC publishes. Any note apologising for GDACS drawing
  symmetric circles is void.
- **Degenerate zero-area polygons are real and must be dropped first.** Where a
  threshold does not reach a forecast point, GDACS publishes a feature whose every
  vertex is the same coordinate (measured: 330 identical copies). Fed to any
  geometry stage these poison it — centroid collapses, radial profile all zeros,
  corridor blended down to a point. Dropped via
  `GDACS_GEOMETRY.degenerateSpanDeg` before anything else touches them.
- **`polygondate` means two different things.** On per-timestep bands it is the
  VALID time and matches that feature's `key`. On the published swath and on every
  centre dot it is the ISSUE time, identical across all of them. **Anything new
  that reads it must first establish which kind of feature it is on.**
- **GDACS timestamps carry no timezone marker and ARE UTC.** JavaScript reads a
  zoneless date-time as local. All parsing goes through `parseGdacsStamp()`, which
  appends the `Z`.
- **`affectedcountries` is the structured list**; `country` is a display string.

**Forecast points** (`Point_Polygon_Point_N`):
- Each carries `key` (`"07241200"`, MMDDHHMM UTC) and `polygonlabel`
  (`"24/07 12:00 UTC"`) — the same instant, independently. Both are parsed and
  **must agree**; a contradiction drops the point.
- **The dots are POLYGONS, not points** — 129-vertex circles of radius 0.03°.
  Centres are taken from the bounding box. The single true GeoJSON Point in the
  payload is `Point_Centroid`, the current position, which carries no time and
  must never join the track.
- **The cadence is asymmetric**: past points 6 h, forecast points 12 h.
- **The past/forecast split is computed against the issue time, never indexed.**
  A hardcoded index draws history as forecast on a younger storm.
- The band↔point join is exact: forecast point times reproduce the band `key`
  values with no interpolation.

**Track segments** (`Line_Line_N`): 2-point segments that chain end-to-end into
one continuous ordered path. The `forecast` flag arrives as the **string**
`"true"`/`"false"`. Each segment's `polygonlabel` is an intensity code —
`TD`/`TS`/`HU` — joined to a centre dot by coordinate. They are *labelled* by
intensity but chain by geometry into correct chronological order. **The track
lines are not coloured by intensity, by decision (§7).**

**How a GDACS bead gets its wind — three steps, best first:**
1. **Measured JTWC wind** where a warning's forecast hour lines up with the dot
   (`_windKt`). Height and colour both come from that number; §9 holds exactly as
   for NHC. This is the normal case.
2. **Capped class midpoint** on a forecast bead nobody published a wind for
   (`forecastKt()` in `map/storm-mesh.js`). Colour is the source's forecast class;
   height is `min(classMidpoint, currentMeasuredWind)`. `min()` not substitution,
   so a leg labelled TD still reads lower and a forecast to weaken is not raised.
   **The cap only pulls down.** A bounded, stated exception to §9's one-signal
   rule.
3. **Plain class midpoint** on a past bead, uncapped — history is a record, not a
   claim, and flattening it would erase a storm's peak.

The analysis dot takes the storm's measured wind (`measuredAnalysis`), matching on
the *storm* rather than the clock, because GDACS can publish a 12Z analysis
against JTWC's 18Z fix.

**Two guards on the JTWC join, both preferring silence** (`JTWC_WIND`): a name
match must also pass a 200 NM position test, and the fix must be under 12 h old.
A missing wind costs resolution; a wrong wind is a §5 lie on the channel driving
height, colour and badge at once. The distance guard also catches frozen-GDACS —
positions walk apart within a cycle.

**`representativeKt()` is the fallback and is not a measurement.** It is never
displayed. Given only "this is a hurricane", the middle of the band is the honest
reading of a class label.

**Do not derive a wind floor from band containment.** The band floor tops out at
120 km/h = the Cat 1 floor, so it cannot separate a Cat 1 from a Cat 5, and JTWC
supplies a real knot value for the same storms.

**The current field's radial seams are smoothed by smoothing r(theta), not x/y.**
A band is four sectors of different radii joined by radial edges at 90/180/270;
within a sector the radius varies smoothly, only the seams jump (measured: 32 nm
across due-west). `smoothRadialSeams()` samples the radius at 360 bearings, blurs
with a raised-cosine circular kernel (`RING_POLISH.seamWindowDeg` 40°, run
`seamBlurPasses` = 2), and rebuilds. Longitude scaled by cos(lat).

- **Simplification happens at the EXITS, never before the polish.** The profile is
  built by binning the ring's own vertices into 360 bearings, so vertex density
  *is* profile resolution. Douglas-Peucker first leaves gaps wider than the blur
  window and the staircase walks straight through it.
- **Two passes, not one.** A single raised-cosine is smooth in value and slope but
  jumps in second derivative at each end of the ramp, and a closed outline reads a
  curvature jump as a corner. Two ≈ Gaussian. Each pass is a convex combination,
  so N passes carry the same no-overshoot bound as one.
- `radialProfile()` interpolates linearly for bearings no vertex landed on. Taking
  the min of the flanking radii manufactures flat plateaus with a step at every
  real sample.
- **A cosine blend cannot overshoot the values it blends between.** Every weight
  is non-negative and they sum to 1, so a smoothed radius always lies between the
  min and max published radius inside its window. Measured overshoot: 0.000000°.
- **The quadrant STEP is a reporting artifact; the ASYMMETRY is real.** Four radii
  are samples of a continuous field, exactly as 6-hourly fixes are samples of a
  continuous track. Measured after the polish: lobes retain ~75% of amplitude, the
  hard-corner harmonic drops to ~7%, peak-to-trough spread unchanged.
- **NHC is not touched and must not be.** Layer 16 already publishes a smooth
  product. §14's both-sources rule is satisfied by both *rendering* smooth, not by
  both running the same code.
- Only the drawn timestep is smoothed. Degenerate rings pass through untouched.

### 4.7 The wind field — four numbers, three tiers

NHC publishes wind extent as four per-quadrant distances in nautical miles —
`ne`/`se`/`sw`/`nw` — at each threshold (`radii` 34/50/64 kt). **Storms are wildly
lopsided and the four numbers are how that asymmetry is carried.** A quadrant of
zero next to one of 170 is normal, not a data error.

**Build the ring from the numbers; do not average them away.** Each radius is the
value at its quadrant centre (45/135/225/315°); blend with a periodic cosine and
sample densely. Cosine rather than spline because **a cosine blend cannot
overshoot the issued radii** — a spline can, and drawing outward past NHC's
published extent claims hurricane-force wind where NHC claims none.

**Three tiers, one swath: a single swept ENVELOPE per threshold.** "Full track"
renders past + current + forecast as one merged smooth outline per threshold,
built in `lib/windswath.js`, assembled into `windSwath` by
`data/nhc-mapserver.js`. Stacking NHC's per-time rings was rejected on looks —
dozens of translucent fills compound wherever rings overlap.

| Tier | Radii | Centres |
|---|---|---|
| Past | layer 13 Past Wind Radii | layer 10 Past Points geometry, joined `dtg` ↔ `synoptime` |
| Current | layer 16 Advisory Wind Field | the feed's current position |
| Forecast | layer 15 Forecast Wind Radii | layer 5 Forecast Points geometry, joined on `tau` |

**The join key is the synoptic time**: `dtg` is a NUMBER (`2026071712`),
`synoptime` is a STRING (`"2026072318"`) — same ten digits, so the join is a
string/number normalization and nothing more. Past points also carry `intensity`
(kt), `mslp`, `ss` and `stormtype`, which is the measured half of the §9 track
ridge. **Do not substitute a polygon centroid for these centres** — a lopsided
ring's centroid is not the storm centre.

**The envelope pipeline, each stage with a stated bound:**
1. **Sample smoothing** (`smoothPasses`) — iterated 3-point averaging over
   resampled centres and quadrant values, Gaussian-equivalent σ ≈ 22 nm. Smoothed
   radii stay between neighbours, never above any published value. Endpoints
   pinned.
2. **Despike** (`spikeTurnDeg`/`spikeMaxSegNm`) — where the radius profile changes
   faster than the wall advances, the offset curve reverses and leaves hairline
   folds. Cut on **both** conditions, because a published zero quadrant pinches
   the ring into an honest cusp that also turns hard; cutting it would paint wind
   NHC didn't publish.
3. **Uniform resample, then polish** (`ringSmoothPasses`) — 3-point averaging on
   irregular spacing sharpens angles instead of rounding them (measured: it
   manufactured a 154° kink out of an 85° corner). Resample to even spacing first.
   Outward error bounded by the sagitta at half-step spacing.

**Bridging is GDACS-only.** Beading is a failure mode of stamp-and-trace
specifically; `lib/windswath.js` resamples the track and walks continuous walls,
so it cannot bead by construction.

GDACS publishes the *shapes* rather than the four numbers, which is why
`lib/bandmerge.js` unions polygons where `lib/windswath.js` sweeps radii.
Different inputs, same merged look, shared finishing pass (`lib/ringpolish.js`).

### 4.8 Surge

**Not built.** Rules inherited and proven on the HA project.

- **The PeakStormSurge service is not per-storm and has no `stormid` field.** One
  Points/Lines/Polygons trio serves every active storm. Filter spatially: ±12°
  envelope around the current position, `spatialRel=esriSpatialRelIntersects`,
  polygon layer 2. This breaks the per-(storm, advisory) cache assumption every
  other layer relies on — **surge keys on position, not storm id.**
- **Ask the server to generalize** (`maxAllowableOffset` ≈ 0.005°). A second
  always-on client-side pass on top deletes small rings and inland fingers;
  coarsen only a band that overruns its own budget.
- **Allocate the point budget across bands** proportional to raw size, with a
  per-band floor. Spending it front-to-back with a hard break dropped every band
  after the budget ran out — a §5 violation dressed as a performance fix.
- **Drop interior rings (holes).** Every pocket of high ground punches a hole that
  reads as splattered paint at app scale. **Guard the orientation assumption:** if
  the server winds rings opposite to the Esri convention, every ring looks like a
  hole and dropping them all makes the layer vanish — which reads as all-clear.
  Keep the original set rather than return nothing.
- **`symbolid` carries the NHC colour class** (blue/yellow/orange/red/purple,
  rising). `name` is a bay or reach PLACE LABEL, not a depth. Report the severity
  index and name the depth from the service legend — **never show `name` as if it
  were a surge height.**
- **Surge watch/warning does not exist as a vector product anywhere in NHC's
  services.** Layer 8's `tcww` carries wind codes only (HWA/HWR/TWA/TWR);
  NHC_Breakpoints is static reference points. **Surge is bands only.** Any design
  assuming a surge stripe symmetrical to the watch/warning stripe is void.

### 4.9 Imagery

Owners: `lib/imagery.js` (addressing), `lib/imagery-paint.js` (the pixel pass),
`lib/imagery-cache.js` (the frame cache), `map/imagery.js` (the layer),
`functions/api/imagery/{radar,satellite}.js` (the two relay hops).

**It is a disc per storm, not a global raster.** A 900 km-radius box around each
eye, feathered to nothing at the rim, drawn ambiently on every storm. No mosaic,
no seam blending between four calibrations, a fraction of the bytes, and it reads
as weather on a globe rather than a second basemap. The vendor question becomes a
longitude lookup.

**Four satellites, two vendors, one channel.** ABI band 13, AHI band 13 and SEVIRI
IR 10.8 are the same physical measurement — clean longwave infrared, ~10.3–10.8 µm.
**Match the micrometers, never the band number**, if swapping products. Table lives
in `SATELLITES` (`config/constants.js`).

| Bird | Vendor | Owns | Enhanced |
|---|---|---|---|
| GOES-East | NASA GIBS | 105°W–30°W | yes |
| GOES-West | NASA GIBS | 180°W–105°W | yes |
| Meteosat IODC | EUMETSAT | 30°W–105°E | **no** |
| Himawari | NASA GIBS | 105°E–180°E | yes |

- Longitude exactly ±180 must resolve to −180 (GOES-West). Half-open ranges plus a
  wrap to +180 opened a one-degree hole that resolved to no satellite.
- The dateline handoff is free. **The eastern Indian Ocean handoff is not** —
  Himawari at 95–105°E is washed out near its horizon; IODC owns it.

**NEVER SEND A TIME PARAMETER.** The most load-bearing line in the imagery code.
Asking GIBS for a specific timestamp hits empty frames unpredictably; every
request sending no time returns real imagery. The server knows its newest complete
frame; we do not. **So the app carries no per-satellite lag constant.** Any
future animation over time would have to read each layer's advertised time
values first and solve this properly. **Imagery playback is not a planned
feature** — Aaron cut it 2026-07-28. This paragraph exists to stop the
no-time rule being read as an oversight.

**PNG, never JPEG** — mosquito noise near black keys as coloured halos.

**The knockout keys on saturation and the vendor's colour is the picture.**
`lib/imagery-paint.js` writes **alpha only**; the vendor's RGB goes back
untouched on both paths.

| | signal | ramp | fades |
|---|---|---|---|
| `enhanced: true` | CHROMA — distance from grey | `satSlope` 4, `satIntercept` −0.5 | edge 0.5 + purple 0.5 |
| `enhanced: false` | BRIGHTNESS — normalized to `black`/`white` | `greySlope` 4, `greyIntercept` −1.2 | none |

Both then take the rim feather.

- **The fades are MULTIPLICATIVE onto a CLAMPED mask.** The one thing not to
  break. As subtractions off an unclamped mask they misfire both ways: a vivid
  pixel absorbs both fades in its headroom so they do nothing on exactly the
  pixels they exist to tame, while a faint pixel is crushed.
- **No edge/purple fade on the grey path.** Both are functions of blue and red,
  which on a grey pixel are luminance again — it would dim the coldest tops by
  half.
- `enhanced` is stated as a **belief** and the pixel pass re-checks it every frame.
  A grey-flagged bird that starts sending colour warns to console with the fix;
  per-satellite, not per-frame, because an enhanced bird over clear ocean has no
  cold tops and therefore no colour.
- **`chromaMax` near zero on an `enhanced: true` bird** surfaces as *"Satellite
  sent a grey frame — the colour filter has nothing to keep."* Never as clear sky,
  and no retry (refetching grey returns grey).
- **`luma=` in the per-disc diagnostic line is the 2nd and 98th brightness
  percentile** and IS the `black`/`white` pair the greyscale path should use. If
  Meteosat's discs ever look thin or washed, read those numbers off a real cyclone
  and correct the anchors rather than tuning `greyIntercept` against wrong ones.

**Live dials (Settings → Storm imagery):** `imageryRadiusKm` 300–1500 km, default
900. `imageryFade` 0.05–0.70 of the radius, default 0.42. **Fade repaints with no
network** (each disc keeps the vendor's raw PNG); **radius refetches**, because it
changes the request bbox. Both debounced 180 ms. Stored as the fade WIDTH, not
`featherStart` — it is what the slider shows and what a person thinks in.

**Every request is pinned to the mode that asked for it.** A frame takes a few
hundred milliseconds, and reading live module state at the moment bytes *land*
puts satellite frames under the radar segment and vice versa. Every fetch pins
generation, mode, bird and the exact box it was addressed to; everything
downstream reads **the request**, never live state. **Two gates per draw** — has
the generation moved, and is this still the same record object — because a
generation check alone reads a rebuilt disc as valid. **Corners come from the
request** too; recomputing them at draw time draws a moved storm's frame at
coordinates the image does not describe. Renders are serialised through the one
shared canvas.

**Satellite goes through our own relay, and the reason is not CORS.** GIBS refuses
to be cached (`no-store`, `no-cache`, `Expires: 1970`), so nothing ever was — every
toggle, poll and re-selection re-downloaded the full frame (826 KB). Four identical
back-to-back requests returned in 2.5 s, 11.8 s, 30.7 s and 0.8 s, and **GIBS
serves different frames on consecutive requests**, so refetching can hand back an
*older* frame than the one on screen.

- Behind `/api/imagery/satellite` we own the headers: `max-age=300` makes the
  browser cache work and `caches.default` collapses every reader and every storm
  into one upstream request per box per five minutes.
- **No client fallback to the vendors.** A path exercised once a month has rotted
  by the time it is needed, and it would make a relay outage invisible.
- **Hand-maintained mirror of `SATELLITES` in the relay**, because Pages Functions
  cannot import `config/constants.js` (no build step). **Repoint a bird in the
  config and it must change in the relay too.** The table is also the allowlist —
  a caller-supplied endpoint would make this an open proxy.
- **20 s client deadline, racing a 60 s upstream fetch — not an abort.** The
  client gets its 502 at 20 s; whatever GIBS eventually returns is banked into the
  edge cache under `waitUntil`. **One upstream request, not two** — asking GIBS
  again while GIBS is struggling is the one thing this route must not do.
- **`Timing-Allow-Origin: *`** so `transferSize` is readable. Cross-origin opacity
  reporting it as 0 is what made an early probe look like a cache hit.

**The frame cache is keyed by REQUEST, not by disc** (`lib/imagery-cache.js`). A
frame is not a property of a disc — it is the answer to a request, and the same
request gets asked again after the disc that first asked it is gone. **The key is
the request URL itself**, which already encodes mode, bird, box and size, so no
second key format can disagree with the bytes fetched. Works only because no TIME
parameter is ever sent. Both relay URLs are built in `lib/imagery.js` and returned
**relative**, so the two are spelled identically.

**In-flight requests coalesce on the same URL** (`fetchFrameOnce`). The store
answers "have we got these bytes"; it cannot answer "are they already on their
way", and that window is where the duplicates were. `rec.busy` guards a DISC
RECORD, and `setMode` throws every record away and builds new ones — so a toggle
away and back opens a second request for a URL still in flight, on a disc that
has never heard of it. Same frame down the wire twice, decoded and pixel-walked
twice. **A settled entry is always removed, success or failure**: a rejected
promise parked under its URL would hand the retry path the original failure
without ever re-asking the vendor. The request-identity gates in `map/imagery.js`
are unchanged and still do the deciding — a shared answer landing under a
superseded request is discarded exactly as an unshared one would be.

| Age | Behaviour | Row says |
|---|---|---|
| ≤ 5 min (`currentFor`) | serve, no refetch — the poll owns cadence | "Downloaded 3 min ago" |
| 5–60 min | serve instantly, refresh behind it | "Downloaded 12 min ago" |
| > 60 min (`maxServeAge`) | treated as **absent**, disc shows loading | — |

No threshold between the first two, deliberately: §5 says stale plus a visible
timestamp beats a blank screen. **The cost of staleness here is not position** —
13 kt for 30 min is ~12 km against a 900 km disc. What changes on that scale is
what the *cloud* is doing.

- **"Downloaded", never "old".** We are never told the frame's observation time.
  Wording it as frame age would be a §5 confident wrong answer.
- **The row reports the OLDEST frame on screen.** "Just now" while one disc is 14
  minutes behind hides the stale one, and only that error can mislead.
- **A timestamp goes to the view, not a sentence.** `report()` runs on events and
  its slowest is the 5-minute poll, so a string formatted in `map/` would freeze.
  `ui/view-layers.js` formats at render.
- **Failed discs retry on `POLL.retryBackoff`** — 5 s, 15 s, 45 s, then the
  five-minute poll owns it. One pending attempt per disc; schedule resets on
  success; timer disarmed with its disc; re-checks mode, generation, record
  identity and `document.hidden` at fire time. Hidden is a **defer, not a cancel**.
  Our abort stops us waiting, it does not stop GIBS rendering, so the first
  attempt warms the vendor and the retry is frequently a cache hit.
- **`retry()` evicts before refetching**, or the button silently stops working the
  day the cache lands.
- **The cache does not persist.** Session-lifetime `Map`, cleared on `destroy()`.
  Bounded at `maxDiscs * 2` — both sides of the toggle. Cold starts are the edge
  cache's job.

**Radar coverage is decided by measuring the frame, not by a box.**
- `/api/imagery/radar` exists because radar sends **no CORS header** and the client
  must read its pixels to feather the rim. That is the only reason.
  `nowcoast.noaa.gov` is dead (403 via a CDN error page); the service is
  `mapservices.weather.noaa.gov/.../radar_base_reflectivity_time/ImageServer`.
- Radar arrives already keyed transparent, so it needs no knockout — only the rim
  feather.
- **`featherOnly` returns a kept fraction**, counted *inside the rim* (the disc is
  inscribed in the square, so corners are outside the thing being drawn) and
  *before* the feather (geometry must not contaminate a measurement about
  content). Alpha *is* the signal; nothing to tune.
- **A frame with nothing in it is hidden, never drawn**, decided before the encode.
  A blank transparent raster over a live hurricane with a silent status row is the
  §5 failure this whole layer keeps finding new roads to.
- **`IMAGERY.emptyKeptFraction` = 0.002.** Measured through the relay, one 900 km
  disc per point: 0.00% (334-byte PNG) over open Pacific; 0.06–0.08% Honolulu, San
  Juan, mid-Atlantic; 0.58% Anchorage; 2.2–3.7% CONUS coasts. **0.005 would not
  have done** — too close to Anchorage, which is a real radar picture of a real
  city. Satellite is nowhere near either bound, so one constant serves both paths.
- **The `IMAGERY.radar` bbox is a request guard and is deliberately NOT tightened.**
  Its only job is to avoid asking NOAA about the Indian Ocean. A narrower box would
  be a geography table nobody can verify, and every degree it is wrong by is a
  storm that HAD radar and was refused it unasked.
- **The standing note is "Radar only reaches storms near land. Satellite is
  worldwide."** It does not name territories, and it stays that way. The limit
  that matters is RANGE, not nationality: a WSR-88D sees roughly 230 km, so a
  storm in open ocean has no radar no matter whose mosaic covers the water.
- **The mosaic's footprint is settled — do not re-probe it.** The service
  describes itself as covering "the Continental United States, Alaska, The
  Caribbean, Guam, and Hawaii" (`ImageServer?f=json`, read 2026-07-28), with a
  `fullExtent` spanning roughly 176°W–150°E and 9°N–72°N. Hawaii and Puerto Rico
  ARE in it. The 0.06–0.08% readings above are therefore clear skies or
  out-of-range water, not a hole in the mosaic — which is exactly why the
  measured-frame test, not a geography box, remains the right call.
- `rec.url` is tracked separately from `rec.req`, so `retry()` can evict a disc
  whose frame came back blank and holds no `req`.

**Imagery draws ABOVE the land fill**, below the coastline glow and all storm
geometry. At landfall, cloud under the land polygon makes the eyewall vanish
exactly as it comes ashore. There is no placeholder image — the source is created
when the first real frame lands.

**This knowingly trades away the §9 cool-toned rule.** Imagery shares the hue
family of Saffir-Simpson category and watch/warning. Aaron made that call against
a side-by-side. Don't quietly revert it.

### 4.10 The normalized storm object

Both sources land in one shape. The merge is only debuggable if there is one
target shape to merge into.

**A storm without a usable position does not exist.** Both parsers drop any event
whose id or position is missing — and "usable" means IN RANGE, not merely finite.
A latitude of 91 passes an `isFinite` check, survives the sphere math, and renders
as a confident storm marker near the pole. Longitude within ±180, latitude within
±90, or the event is dropped. **`0,0` is NOT dropped** — it is the Gulf of Guinea,
a real place.

```js
{
  id:         "nhc:al052026",   // namespaced — collisions impossible
  source:     "nhc",            // "nhc" | "gdacs"
  sourceId:   "al052026",
  name:       "Fiona",
  basin:      "atlantic",

  lat: 24.3, lon: -71.2,

  windKt:     85,               // ALWAYS knots
  pressureMb: 972,              // nullable
  headingDeg: 305,              // nullable
  speedKt:    12,               // nullable

  nature:     "tropical",       // tropical | subtropical | post-tropical
                                // | remnant | potential
  category:   2,                // 0=TD, 1=TS, 2..6 = Cat1..5, null = unknown
  categorySource: "reported",   // "reported" (NHC said so) | "derived" (from wind)

  observedAt: "2026-07-22T15:00Z",  // when the fix was valid
  advisoryKey: "nhc:al052026:12A",  // see 4.11

  can: {                        // what geometry this storm can actually offer
    cone: true, forecastTrack: true, forecastPoints: true,
    pastTrack: true, watchWarning: true, windRadii: true,
    surge: true, models: true, windBands: false
  },

  raw: { /* source-only fields */ }
}
```

- **Wind is stored in knots, everywhere, always.** Every threshold in this app is
  defined in knots. Convert only at the moment of drawing text — converting
  internally means rounding drift, and drift near a threshold flips a storm
  between categories.
- **`categorySource` exists because GDACS publishes no category.** GDACS gives an
  alert level, which is a humanitarian impact estimate. **Never map alert level to
  category** — an Orange alert over a dense coastline can be a weaker storm than a
  Green one over open water.
- **`nature` is separate from `category` on purpose.** NHC issues advisories on
  post-tropical storms and on "Potential Tropical Cyclone Five" — real positions
  and real warnings, no meaningful category. Trust NHC's label for what kind of
  thing it is; derive only the number.
- **`can` distinguishes "this source never had it" from "the fetch died."**
  Without it the layer panel shows toggles that do nothing and the code cannot tell
  `unavailable` from `clear` (§5).
- **`observedAt` is the only clock that counts** for liveness. Both feeds publish a
  second timestamp that moves without a new fix behind it (GDACS `datemodified`,
  `iscurrent`). `tools/test-silence.mjs` carries those decoys as explicit
  assertions so anything reaching for the fresher-looking field fails loudly.

The store holds source health alongside the list, because an empty list means
nothing on its own:

```js
{
  storms: [ /* normalized, merged, NHC-wins */ ],
  sources: {
    nhc:   { status: "ok",          fetchedAt: "...", error: null },
    gdacs: { status: "unavailable", fetchedAt: "...", error: "timeout" }
  }
}
```

The UI reads `sources` to decide between "quiet ocean" and "we can't see half the
planet."

### 4.11 Advisory identity

`advisoryKey` is a per-source function returning a string. It identifies WHICH
advisory a bundle was fetched for.

- **NHC:** advisory number — a **string**, not a number (intermediates are `"5A"`,
  `"5B"`). Never `parseInt` it. Fallback: issuance timestamp.
- **GDACS:** `episodeid`, which increments per update. Fallback: event
  last-modified date.

**It is NOT the geometry cache key, and that is load-bearing.** Keying on it meant
an EMPTY answer was stored as a success under a key that could not change until the
next advisory — measured, that froze a storm's blank map for six hours after the app
had drawn its cone correctly minutes earlier. **The cache is keyed by STORM and
holds each storm's BEST bundle** (§7); `advisoryKey` records what the last attempt
was for, so an unsuccessful one is retried after `CACHE.geometryRetryMs`.

**Geometry lags the feed, confirmed not theoretical** — measured at 3¾ and 6¾ hours
behind on two live storms at the same moment. Caching cone geometry under the
JSON's advisory number would serve advisory 18's cone labelled 19 on a live
hurricane: a smaller promise rendering larger data, which §5 forbids outright.

**Rule: the geometry cache stores its own advisory identity from the MapServer
response, and the UI displays that, not the storm's.** When they disagree by more
than one advisory cycle, say so (§16).

The fields live on the **GeoJSON feature properties**, not on layer metadata — the
layer endpoints carry no `timeInfo` or `editingInfo` at all:
- **`advisnum`** — the geometry's own advisory number, same string form as the
  feed's. Present on cone, forecast track, forecast points, watch-warning.
- **`idp_filedate`** — epoch milliseconds. Present on every layer.

**Two paths are required.** `advisnum` is absent on forecast wind radii, advisory
wind field, past points and past track. Compare advisory numbers where present,
fall back to `idp_filedate` where not.

**Geometry cache invalidation also folds in the JTWC warning number**
(`geometryKeyOf()`, `data/cache.js`), because forecast points carry JTWC winds and
a new warning changes what they should say even when GDACS has not moved. Without
it the head jumps to a new wind while the beads under it keep the old one.
`advisoryKey` itself is deliberately untouched by this.

### 4.12 Polling

- Storm sources: every **30 minutes**. NHC full advisories are 6-hourly,
  intermediates 2–3-hourly; 30 min catches all without hammering anyone.
- **SCHEDULED polls only run while the app is visible.** No background work.
- **The first load is never gated on visibility, and the distinction is
  load-bearing.** The check lives in the interval tick — the only caller that
  fires with nobody watching. Every deliberate fetch (first load, return-to-tab,
  Retry) is unconditional. Read literally without this qualification, a page that
  begins life hidden — background tab, prerender, PWA behind its splash — fetches
  nothing and shows a permanent, error-free "Checking the oceans…". **The rule is
  about not spending a cell radio on an unwatched tab, never about refusing to
  load.**
- Imagery frames: 5-minute source cadence; fetched only while an imagery layer is
  on.
- All intervals live in `config/constants.js`.

### 4.13 Cache TTLs

| What | Fresh | Serve stale until | Why |
|---|---|---|---|
| NHC storm list (relay) | 5 min | 9 h | Well under the 30-min poll, so a poll never gets served its own previous copy |
| GDACS event list (relay) | 5 min | 9 h | The NHC list's sibling behind the same poll |
| Model a-decks (relay) | 15 min | 9 h | Synoptic cycles are 6-hourly; stale + its visible cycle beats a blank layer |
| NHC MapServer query (relay) | 30 min | 12 h | Geometry already lags the feed by 3¾–6¾ h, so 30 min on top is noise |
| NHC MapServer EMPTY answer | 5 min | **never** | Transient. A remembered nothing is strictly worse than the last real geometry. Matched to `CACHE.geometryRetryMs` |
| GDACS geometry (relay) | 30 min | 12 h | Two numbers, not three — see below |
| Client a-deck per (storm, advisory) | — | LRU, 12 | A cached FAILURE is retried on the next warm pass, unlike geometry's: nothing taps a warm-only layer, so a hard-cached failure would never clear |
| Client geometry per STORM | — | LRU, 12 | Each storm's BEST bundle. An empty or failed fetch never replaces geometry we already hold. Cap 12 because basins have peaked at 8–9 storms at once |
| Last-good storm data (service worker) | — | 9 h | ≈1.5× advisory cadence |

**Every "fresh" number is also a KV freshness test (§17).** A route serves the
globally warmed copy only while it is inside its own fresh window; past that it
goes upstream itself and keeps the warm copy as last-good. **A warm store is not
permission to stop checking** — §5's rule is stale data *with a visible
timestamp*, and the timestamp only means something if we tried to beat it first.
The cron cadence (5 min) is set to the shortest fresh window in this table for
exactly that reason.

**EVERY TABLE ROW ABOVE IS A CLOUDFLARE CLOCK. THE BROWSER HAS ITS OWN, AND IT IS
SET TO ZERO.** Every client fetch of relay data sets `cache: 'no-store'` —
`data/relay.js` (feed, advisory text), `data/adeck.js` (models),
`data/nhc-mapserver.js` (geometry) — and every relay route that answers them
returns `Cache-Control: no-store` to the browser. The colo caches on the numbers
above; the phone caches nothing. `data/geocode.js` is the one deliberate
exception: an address maps to the same point forever.

**Both halves are required, because our relay URLs name no advisory.**
`/api/nhc/mapserver?layer=7&bin=EP2` is byte-identical from a storm's first
advisory to its last, so a browser holding a saved copy has no way to tell it has
gone off. `s-maxage` does not help — it binds shared caches only, and a private
cache reading it falls back to inventing a lifetime. **This is the same failure
`_headers` documents for our JS modules**, one layer down, and it was missed on
`/api/` for exactly as long.

*Measured on glass 2026-07-29: Genevieve drew a 36-hour-old cone around a
27-minute-old position dot in a browser tab while the installed PWA on the same
phone, same network, same minute drew both current — because `queryLayer` was the
only relay fetch in the app without the option. Android partitions the two caches,
which is the only reason it was visible at all. A single install would have shown
one wrong answer and nothing to compare it to.*

**The GDACS row is two numbers, not three.** Fresh 30 minutes; after that a failed
upstream fetch is answered from the last good copy, flagged stale, for up to
twelve hours; past twelve hours the copy is gone and the client gets an honest
`unavailable`. There is no third threshold. The numbers live in
`functions/api/gdacs/geometry.js`, which cannot import this project's config
(Pages Functions, no bundler) and mirrors this table by hand and says so.

### 4.14 Recovery from failure

- **Auto-retry at 5 s, 15 s, 45 s.** Then stop and wait for the normal 30-minute
  poll. Never auto-retry while the page is hidden.
- **Retryable = timeout, network error, 5xx. A 4xx is not retryable** — that is "no
  data", not "try again", and retrying it burns battery for nothing.
- **Have stale data** → show it flagged with its age, error in the status strip.
  Content is never replaced.
- **Have nothing** → full error state, source named in plain English, 44 px Retry.
- **Don't flash an error on the first blip.** Show the error UI once auto-retries
  are exhausted — unless the screen is empty, where feedback is needed within ~2 s.
- **Layers already have their recovery: the toggle** (§7). Re-toggling a dead layer
  means "try again." No second button. Feed-level errors live in the status strip;
  layer errors live on the layer.
