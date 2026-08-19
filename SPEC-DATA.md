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

Captured payloads are committed so the data layer can be built with no network:
`samples/gdacs/`, `samples/other/`, and the client-shipped seed catalogs under
`assets/hazards/` (GeoNames town populations, the 111 NWS watch/warning colors).

**Tropical cyclones are the only hazard.** Five others were scoped in detail and
cut on 2026-08-08 without shipping; their samples and catalogs went with them.
Everything is on the `worlds` branch.

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
| `/api/nhc/genesis` | Forward + unzip + read the two outlook KMZs |
| `/api/nhc/advisory` | Forward + cache the advisory `.shtml` |
| `/api/nhc/ships` | Walk three synoptic slots + parse SHIPS to per-hour knots |
| `/api/gdacs/events` | Forward the cyclone event list |
| `/api/gdacs/geometry` | Forward + edge-cache per-event geometry |
| `/api/gdacs/surge` | Two hops to modelled surge at named towns (§51.2) |
| `/api/jtwc/storms` | Name↔designation index, wind ladder, final-warning flag |
| `/api/jtwc/warning` | Forward + cache a warning `.txt` |
| `/api/tcgp/adeck` | UCAR model guidance for non-NHC basins |
| `/api/cap/alerts` | National agencies' cyclone alerts, worldwide (§50.2) |
| `/api/cap/shapes` | Those alerts' areas, fetched per set (§50.10) |
| `/api/nws/rainfall` | Two hops to the gridded QPF at a point (§48.7) |
| `/api/rain/global` | Open-Meteo, reshaped into the NWS body (§48.15) |
| `/api/imagery/satellite` | Forward + cache satellite frames |
| `/api/imagery/radar` | Forward radar (CORS-blocked, pixels must be read) |
| `/api/geocode` | Proxy Mapbox — a secret problem, not a CORS one |
| `/api/reverse` | The same, backwards: a point becomes a place name |
| `/api/replay/*` | Serves an archived storm as if it were live (§8) |
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

**`/api/nhc/ships` is the second bounded exception, and it PARSES.** `§47.7`
decided this rather than the route. The upstream has no `latest` alias — files
are named by synoptic hour — so "this storm's current SHIPS" is a loop of up to
three fetches that ends only when one answers or all three miss, which cannot
live in a browser without three round trips per storm. It is also 9–10 KB of
fixed-width text per storm per advisory against a few KB of numbers, for a layer
drawn for every storm with a file rather than only the selected one. Like the
a-deck filter, **the parse decides nothing**: `_ships-parse.js` places nineteen
rows in the three groups §47.4 names and checks its own arithmetic, and every
judgement about color and wording still runs in the browser. It fails loudly —
an unknown row label, a missing row, a ninth non-numeric token or a
reconciliation residual past ±4 kt all stop the parse rather than yielding a
plausible number, because a SHIPS file that has changed shape produces a wrong
answer that looks perfectly healthy on screen. **It is not warmed by the cron
Worker**, so the KV read always misses today and the first reader in each colo
pays one NOAA round trip; the route degrades exactly as `_kv-cache.js` §17
describes and gains warming the day the Worker learns the key.

**`/api/nhc/genesis` is the third bounded exception, and it UNZIPS AND PARSES.**
§45.2 decided this rather than the route. NHC publishes the outlook twice — as
GIS layer 3 and as a KMZ on its own web server — and the KMZ is the better
publication: it carries the forecaster's name for each area, the discussion
paragraph attached to the shape it describes, and a disturbance number joining
an area to its current-position point, none of which layer 3 publishes at all.
A KMZ is a zip, so somebody has to open it; four of its five entries are icons
and 45% of its bytes, so opening it on a phone would send a reader bytes that
exist only to be thrown away. `_kmz.js` unwraps the container — the same
category as the a-deck route's gunzip — and `_gtwo-kml.js` converts the
document to the FeatureCollection layer 3 used to answer with.

**Like the a-deck filter and the SHIPS parse, this parse decides nothing.**
Every judgement about basin, colour, ordering, staleness and wording still runs
in `lib/genesis.js` and `lib/outlook.js` in the browser. It fails loudly: a
document that will not unzip, will not parse, or names a basin other than the
one requested throws rather than yielding a plausible answer, because a KMZ
that has changed shape produces an outlook that looks perfectly healthy with an
ocean missing from it. **Both parsers live under `functions/` for the same
reason `_ships-parse.js` does** — a working client-side copy would be a second
implementation of this judgement on the far side of a deploy boundary, and
would invite somebody to fetch a zip from a phone.

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

**`/api/reverse` is the same file backwards** and shares the token, the 30-day
cache and the code-not-prose rule. Three things differ. It asks for town, region
and country and deliberately NOT street address or points of interest — a
rooftop-accurate answer to a deliberately approximate question is a confident
lie. Its coordinates are rounded to three decimals (~100 m) BEFORE they become a
cache key, which is both the cost lever and the privacy posture: home
coordinates are STORED only on the device, this user-initiated lookup is one of
the two things that send one (the other is §48.3's rainfall forecast), and it
sends the coarsest number that can still answer. And unlike
the forward route it CACHES AN EMPTY ANSWER, because there is no next keystroke
— a point in the mid-Atlantic has no name today and none in thirty days, so
"nothing" is the durable correct answer and exactly the one worth never paying
for twice.

**It cannot say whether a point is water, and must never be asked to.** Mapbox
has no marine gazetteer; the open Atlantic matches no polygon and returns
exactly what the Sahara returns. That question is answered on the client against
the already-drawn basemap (`map/water-at.js`), and the two answers are combined
at the point of display (§8).

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

**THE ARCHIVE SNAPSHOTS NHC TRACKS, AND IT IS WHY.** `tools/archive-fetch.mjs`
derives a query per active storm per layer from `CurrentStorms.json`'s own
`binNumber` and writes them under `latest/geometry/`. The storm LIST was archived
from day one and the TRACK never was, which cost two bugs in one week — both of
them questions about a per-position field that no session could read, because the
sandbox cannot reach NOAA and `web_fetch` strips the query string an ArcGIS query
*is*.

**LAYERS 6 AND 7 WERE ADDED LAST, AND THE REASONING THAT KEPT THEM OUT IS THE
LESSON.** They were excluded as "geometry-heavy, and they answer questions nobody
has been stuck on." On 2026-08-18 somebody was stuck on exactly them: the cone
rebuild sweeps 7 along 6 and those two are its ONLY inputs, so a report that the
environment ribbon was vanishing on Lala had to be investigated against Ida's
2021 GIS capture instead — a different storm, a different basin, five years
earlier — and the finding could be generalised to Lala but never confirmed on
her. A layer is worth archiving when it is the sole input to something that can
fail, not when it has already caused trouble.

The set is now 5, 6, 7, 8, 10, 13, 15 and 16.

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

- **LAYER 8 CAN ANSWER WITH A WATCH THAT HAS NO SHAPE, AND THAT IS NOT A PARSE
  FAILURE.** Measured on Lala 2026-08-13, `?layer=8&bin=CP2` returned one
  feature carrying every attribute — `tcww: "HWA"`, `advisnum: "5A"`,
  `stormname: "Lala"` — and `"geometry": null`, `"shape": null`,
  `"st_length(shape)": null`. Its own `idp_source` is `cp012026-005A_ww_wwlin`,
  the **line** shapefile, so the geometry exists upstream and was lost before
  the MapServer. Nothing on our side dropped it: the relay sends
  `returnGeometry: true`, and layer 8 is **not** in `SIMPLIFY_LAYERS`.

  Consequence, and it is a §5 one: `status` is `ok` because a feature came back,
  the legend reads properties so the panel names the product correctly, and the
  map has nothing to paint. `wwHasOutline()` in `lib/watchwarning.js` is what
  tells the two apart, and `SPEC-UI.md` §16 carries what the panel says. The
  coastal band select had already been tagging these `_bandReason: 'not-a-line'`
  for weeks with no reader.

  **Whether this is a Central Pacific quirk, one bad advisory, or normal for
  this layer is UNKNOWN — one sample.** Layer 8 carried real breakpoint lines
  for Bertha in the Atlantic in July, so it is not simply broken. The hourly
  archive now snapshots layer 8 per storm (`tools/archive-fetch.mjs`) so the
  question can be answered by reading rather than by asking Aaron to paste a
  response off a phone, which is how this one was found. If it proves chronic,
  the second publication path is the KMZ named in the storm feed's
  `windWatchesWarnings.kmzFile` — XML, so no build step to read it.

- **`PC` IS A LIVE CLASSIFICATION CODE AND WAS MISSING FROM THE TABLE.**
  Observed on One-C (`cp012026`) 2026-08-13: `classification: "PC"`, 35 kt.
  `NATURE_BY_CLASSIFICATION` in `data/nhc.js` carried `PTC` — which has never
  been observed — and not `PC`, so it fell through to the `'tropical'` default
  and was graded from its own wind. The app drew a **Potential Cyclone as a
  tropical storm**, with a Saffir-Simpson category NHC pointedly has not
  assigned. Both spellings are now mapped. **Add codes here because they were
  OBSERVED, never because a document lists them** — this is the second time a
  guessed vocabulary has cost a visible bug.
- **THE TWO POINT LAYERS STATE A STORM'S CLASS IN DIFFERENT LANGUAGES, AND
  READING ONLY ONE OF THEM PAINTS EVERY WEAK STORM'S HISTORY RED.** Below
  hurricane strength `ss`/`ssnum` is 0 and the class is carried elsewhere:
  - **Forecast Points (5)** carry `tcdvlp`, spelled out — `"Tropical Storm"`,
    `"Hurricane"`, `"Major Hurricane"` (verbatim in
    `samples/ida-al092021/gis/010/5day_pts.geojson`, every tau).
  - **Past Points (10)** do not carry `tcdvlp` at all. Their only classification
    field is `stormtype`, a CODE — `TD`, `TS`, `HU` (spec-parameter §29.3, §30.4).

  `lib/track-point.js categoryIndexOf()` therefore matches the CODE first, on an
  exact comparison, and falls back to searching the spelled-out form for words.
  Searching for words alone answered the forecast half correctly and the past
  half not at all: `"TD"` contains neither "depression" nor "storm", so every
  past position on every storm that never reached hurricane strength fell through
  to `null` and drew in the GENERIC fallback hue on both the cage ridge and the
  map's dots. Hurricanes were never affected — `ss` answers first for them —
  which is why it survived a season undetected. **`HU` and `MH` are deliberately
  NOT in the code table**: hurricane strength with no Saffir-Simpson number is
  not a nameable category, and `PT`/`PTC`/`EX`/`LO`/`DB`/`WV` stay ungraded
  because they are not Saffir-Simpson systems at all (§6) — but see the
  pre-genesis hue below, because *ungraded* must not mean *loud*.
- **AN UNGRADED POSITION IS THE QUIETEST THING ON A TRACK, NOT THE LOUDEST.**
  Every track begins before the cyclone does, and NHC publishes those positions
  with a real wind and a classification it declines to grade. They drew in
  `CATEGORY_COLOR.GENERIC`, a brick red, so the earliest and weakest stretch of
  every storm read HOTTER than the depression it grew into — the severity
  ordering inverted at exactly the moment a system is least dangerous.
  `PREGENESIS_COLOR` (config/tokens.js) is now used for `LO`, `DB`, `WV`, `PC`,
  `PTC` and any unrecognised code. It **is** `GENESIS_COLOR.MEDIUM`, assigned
  rather than retyped: a watched area and a pre-cyclone track position are the
  same statement, and Aaron already settled how that statement looks on
  2026-08-09. `PT`/`EX` are the deliberate exception and keep the brick — a
  post-tropical cyclone was a named storm and is often still the dangerous half
  of its own life.
- **HEIGHT STAYS HONEST TO THE MEASURED WIND even here.** A Potential Cyclone
  is warned on precisely because it can carry damaging wind to land, so
  flattening it would understate a real threat. Color carries *"nobody has
  graded this"*; height carries *"here is how much wind"*. This is the same
  bounded §9 exception `map/storm-mesh.js` already documents for capped GDACS
  beads — two channels answering two questions we have two different
  confidences about.
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

**The parsed decks are cached per TCGP deck id, bounded by
`CACHE.geometryLruStorms` like every other per-storm cache, on the same
`ADVISORY_TEXT.indexTtl` the index itself uses — read from that constant, not
restated.** An EMPTY parse is cached too and deliberately: TCGP files no
analysis rows for some storms, and without it the app would re-ask every poll
for a deck with nothing in it. **A MANUAL RETRY DROPS THEM ALL** (`refresh()` in
`data/store.js`, which is where the storm list's Retry and a re-toggled layer
land). A poll reusing the cache is correct — the deck only grows — but the user
pressing Retry is doing so because something came back wrong, and the entry
cached during the failure is the likeliest thing to be wrong. Without the drop
the button is a no-op for a quarter of an hour. A re-toggled layer pays one
re-parse per GDACS storm for nothing, which is cheaper than a second entry point
a future poll change could forget.

**The Layers row's model-tracks Retry drops the SHARED TCGP INDEX as well as the
storm's deck** (`app/views.js`). A deck is resolved by name through
`data/tcgp-index.js`, and a relay answering 200 with a degraded index — the state
that file exists to keep distinguishable from an empty one — is held for
`indexTtl` whatever it says. Dropping only the deck retries the second half of a
lookup whose first half already decided the outcome, so every press fails
identically until the TTL lapses. Exactly what `fetchAdvisory` does with
`evictJtwcIndex`, for the same reason: the control IS the recovery (§5/§7), and
one that can recover half a path is not one.

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
  families. Color class and `polygonlabel` both appear on each.
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

  Drawn in the §6 34/50/64 colors because they are the same three severity
  tiers. **Never relabelled as 34/50/64 kt anywhere the user sees.** The panel
  shows GDACS's own km/h.
- **`alertlevel` is not a threshold.** It rides on every geometry feature reading
  "Orange" — the storm's *humanitarian* level. Same three color words, two
  unrelated meanings, one payload. `bandFromFeature()` requires the class and the
  published label to agree within `bandLabelToleranceKmh`; a contradiction drops
  the feature rather than painting a guessed color (§6).
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
lines are not colored by intensity, by decision (§7).**

**How a GDACS bead gets its wind — three steps, best first:**
1. **Measured JTWC wind** where a warning's forecast hour lines up with the dot
   (`_windKt`). Height and color both come from that number; §9 holds exactly as
   for NHC. This is the normal case.
2. **Capped class midpoint** on a forecast bead nobody published a wind for
   (`derivedKt()` in `map/storm-mesh.js`). Color is the source's forecast class;
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
height, color and badge at once. The distance guard also catches frozen-GDACS —
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

**Built against Hurricane Milton's published archive; the live path is one
adapter short.** `data/surge.js` normalizes both sources to one shape —
`kind`, `color`, `severity`, `range`, `place` — and `map/layers/surge.js` draws
it as segment B of the `coastal` pair. The fixture is
`samples/milton-al142024/surge/`, 22 advisories, simplified at `SURGE.offsetDeg`
to match what the relay asks ArcGIS to generalize to. `/?surge=milton&adv=017`
shows it on the real globe.

**What is NOT built: the relay route.** The Peak Storm Surge service only
answers while a US storm has surge watches in effect, so the live field names
cannot be read today. `fetchSurgeLive()` throws until that route exists, which
the caller surfaces as `unavailable` — never as an empty coast.

Rules below are inherited from the HA project and corrected where Milton's
bytes disproved them.

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
- **==> `symbolid` DOES NOT CARRY THE COLOR CLASS. THIS SECTION SAID IT DID.
  <==** The service declares `symbolid` as `esriFieldTypeInteger`. The HA
  project searched that integer for the substring "blue", never matched, and
  fell through to coloring bands by ARRIVAL ORDER — no error, plausible
  output, wrong severity. **Never resolve a severity from `symbolid`;**
  `tools/test-surge.mjs` goes red if anything does.
- **The color word rides a description blob.** In the archived product it is
  `{"peak_surge_range": "8-12 ft", "color": "red"}`, verified against Milton's
  22 advisories. On the live service the field is most likely `popupinfo` —
  Esri's landing spot for a KML `<description>`, and this service is visibly a
  KML import. `SURGE.liveColorFields` tries the candidates in order and
  `data/surge.js` logs which one answered, so **the first live storm settles it
  as a measurement rather than leaving it a guess.**
- **The color is a BUCKET; the range is the forecast.** `SURGE_RAMP` labels red
  "Up to 12 ft"; the archive publishes 5-10, 6-10 *and* 8-12 ft as red. Show the
  published range, and the ramp label only when a feature has none.
- **`name` is place AND depth joined by an ellipsis** — "Tampa Bay...8-12 ft".
  Take only the place from it; the range has its own field and cannot be
  ambiguous. **Never show `name` whole as if it were a surge height.**
- **==> SURGE IS NOT BANDS ONLY. <==** Every advisory carries coastal LINES
  beside the polygons, each with its own color and depth — roughly half the
  features on Milton. Layer 1 (Lines) and layer 2 (Polygons) are both required;
  drawing only the bands drops half the product. **Reaches are breakpoint lines
  and band onto the real coast the same way a watch/warning does; when there is
  no coast under one, it draws as the dashed chord of SPEC-MAP.md §7.10, not as
  a reach stroke.** The polygons are areas NHC drew itself — never chords, so
  nothing about them is approximated and they are never dashed.
- **A "surge band" is not a surge WATCH/WARNING.** Surge watch/warning does not
  exist as a vector product anywhere in NHC's services. Layer 8's `tcww` carries wind codes only (HWA/HWR/TWA/TWR);
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

**PNG, never JPEG** — mosquito noise near black keys as colored halos.

**The knockout keys on saturation and the vendor's color is the picture.**
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
  A grey-flagged bird that starts sending color warns to console with the fix;
  per-satellite, not per-frame, because an enhanced bird over clear ocean has no
  cold tops and therefore no color.
- **`chromaMax` near zero on an `enhanced: true` bird** surfaces as *"Satellite
  sent a grey frame — the color filter has nothing to keep."* Never as clear sky,
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
| NHC storm list (relay) | 30 min | 9 h | Six times faster than NHC's 6-hourly advisory cycle. **The 5-min warm cron does NOT keep the served copy 0-5 min old** — see the stamp collision below |
| GDACS event list (relay) | 30 min | 9 h | Same, against a feed that re-issues a cyclone roughly every 6 h. **Was 5 min, which equalled the warm cron and expired as its own replacement came due** — see below |
| Model a-decks (relay) | 15 min | 9 h | Synoptic cycles are 6-hourly; stale + its visible cycle beats a blank layer |
| SHIPS run (relay) | 30 min | 12 h | Twelve times faster than a 6-hourly reissue. The payload states its own synoptic hour, so a stale environment is readable *as* stale |
| SHIPS "no run published" | 15 min | **never** | Transient — a fresh depression gets advisories before its first run, and that state lasts hours, not days. Matches the poll cadence §47.2's three-slot number was simulated against |
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

**THE CRON CADENCE MUST BE FASTER THAN THE SHORTEST WINDOW IT REFILLS, NEVER
EQUAL TO IT.** This line used to say "set to the shortest fresh window ... for
exactly that reason," and that is the sentence that broke the app. A 5-minute
window refilled by a 5-minute cron reaches its expiry at the moment its
replacement is due; cron triggers drift, so a share of requests judge the warm
copy too old, skip it, and go to the origin. On 2026-08-01 that origin was
gdacs.org, the trip measured ~20 s uncached against a 20 s client abort, and
Super Typhoon DOLPHIN-26 was missing from a hurricane tracker while every layer
of the cache was working exactly as designed. The cron stays at 5 min; the
windows it refills are now 30.

**A ROUTE ANSWERS FROM CACHE AND REFRESHES BEHIND THE RESPONSE.** Aging out is a
reason to refresh, not a reason to make the reader wait — the two were conflated
and the cost was a red banner over a live Category 5. Where a route holds an
expired copy it returns it immediately with `X-Landfall-Stale`, pulls the update
under `waitUntil`, and the next reader gets the newer one. Only a genuine cold
miss — nothing in the colo, nothing warmed, no last-good — blocks, and that path
carries a 10-second upstream budget so it cannot outlast the reader's patience.

**BOTH STORM LISTS DO THIS — `gdacs/events.js` and `nhc/storms.js`, one shared
shape.** Each holds a `pullUpstream()` that fetches, validates the JSON, and
writes BOTH cache slots, used by the blocking cold-miss path and the background
refresh alike; splitting those two without sharing the writes is how a
background refresh quietly stops populating last-good. A warm cycle skips the
serve-then-refresh path entirely, or the cron Worker would spend forever
re-confirming its own last answer.

NHC got the wider window in the DOLPHIN-26 fix but not these two behaviours, on
the reasoning that NOAA had never been measured slow and hurricane season is not
where to prove a pattern. That reasoning had a shelf life. The gap was the same
loaded gun pointed at the other source, and the parity rule — **no data
behaviour is finished until both sources have it** — is what closed it. The
files cannot import this project's config (Pages Functions, no bundler), so both
mirror this table by hand and say so.

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

### 4.15 The town list

`assets/hazards/population-towns.json` — 107,464 towns of 1,000+ people, built
from GeoNames via `all-the-cities` (MIT / CC BY 4.0). GeoNames is credited in
`map/attribution.js`; that is a licence condition, not a courtesy. The recipe
is `tools/build-population.mjs` and nothing in the app imports it.

**One flat array of numbers**, `[lon, lat, pop, …]`, not GeoJSON and not an
array of triples. Measured: GeoJSON ~15 MB raw, triples 2.29 MB / 809 KB
gzipped, flat 1.87 MB / **670 KB gzipped**. The flat form also lets the in-path
count walk the numbers without allocating; GeoJSON is built from it at runtime
only when the heat layer is switched on. Coordinates are rounded to 2 decimals
(~1.1 km) because both readers are coarser than that by nature.

**PPLX is dropped and that is the most important line in the recipe.** GeoNames
classes sections of cities — Villa Lugano inside Buenos Aires, 4,816 others —
as their own places, and their populations are already inside the parent's
figure. Keeping them added **91,027,545 people who do not exist**, concentrated
in exactly the dense coastal cities this app cares about most. `PPLQ`, `PPLW`,
`PPLH` and `PPLCH` are dropped too: abandoned, destroyed, historical.

**Fetched lazily and shared.** One in-flight promise serves both readers, so
switching the layer on and tapping a storm cannot start two requests for the
same megabyte. Three states, and there is no `none`: the file is static and
shipped, so anything other than `ok` is `unavailable`. A truncated file still
parses and still produces a plausible wrong headcount, so the town count is
checked against `POPULATION.expectedTowns` rather than trusted.

#### ==> COVERAGE IS WILDLY UNEVEN BY COUNTRY AND NO DIAL FIXES IT <==

Measured against real populations:

| | counted | real | captured |
|---|---|---|---|
| Louisiana | 4.2M | 4.6M | 91% |
| Japan | 108.5M | 123M | 88% |
| Florida | 15.8M | 22.6M | 70% |
| **India** | **367.8M** | **1,428M** | **26%** |

GeoNames catalogues Indian villages poorly and most Indians live below the
1,000 floor. Settlement density compounds it: New York state carries 6.33 towns
per 1,000 km² against India's 0.42 — fifteen times the POINTS for a quarter the
people per km² — so the field reads partly as how finely a country is
catalogued. Turning weights up to compensate would be inventing density, which
is worse than undercounting it. The only real answer is a gridded raster, and
that is a texture upload on a device where texture upload is the measured
cold-load problem.

---

## 45. Genesis — the areas being watched

### 45.1 Why this exists

The app can be completely empty and completely wrong at the same time.

Measured, both fetches minutes apart:

```
GET https://www.nhc.noaa.gov/CurrentStorms.json
{ "activeStorms": [] }

GET .../NHC_tropical_weather/MapServer/3/query
Atlantic  2-day  0%  Low    | 7-day  40%  Medium
Atlantic  2-day  0%  Low    | 7-day  20%  Low
Pacific   2-day 20%  Low    | 7-day  80%  High
Pacific   2-day  0%  Low    | 7-day  20%  Low
Pacific   2-day 10%  Low    | 7-day  50%  Medium
```

Zero storms and an 80% chance of one forming, at the same instant. §5 says the
app never shows an all-clear it has not earned. An all-clear that is technically
true of *storms* while NHC is publishing five watched areas is exactly the kind
of honest-looking wrong answer §5 exists to prevent.

It is also the answer to the question the app gets asked most and could not
previously answer: **where might the next one start, and when.** Genesis is not
forecastable months out — seasonal outlooks say how many, never where. Inside
seven days it is, and it is published as a polygon with a percentage on it.

### 45.2 Source — NHC, the two- and seven-day outlook

**The Graphical Tropical Weather Outlook, as the KMZ NHC publishes on its own
web server.** Two documents, one per basin:

```
https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz
https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz
```

Reached through `/api/nhc/genesis?part=areas` (`functions/api/nhc/genesis.js`),
fresh for 15 minutes, serve-stale for 9 hours. The route unzips both, converts
them, and answers with one FeatureCollection spanning both basins.

**This is the same forecaster run GIS layer 3 publishes, not a second source.**
Proven before it was switched: `tools/gtwo-compare.mjs` ran both against all 72
hourly snapshots on the archive branch and they agree on every area, every
vertex and every probability — worst vertex disagreement 4.5e-10 degrees — with
the issue stamp matching to the minute every hour. Two differences are real and
deliberate: the KMZ's issue time is the forecaster's where layer 3's
`idp_filedate` was NOAA's ingest a median 203 seconds later, and **the two
paths wind their rings in opposite directions**, which matters to a
triangulator and to nothing currently drawn.

**Why swap rather than add.** The KMZ carries three things layer 3 does not
publish at all: NHC's own name for each area, the forecaster's paragraph
attached to the shape it describes, and a disturbance number joining an area to
its current-position point. Running both to obtain them would require matching
prose to polygons — the thing §45.9 refuses to do, for measured reasons — plus
three new failure states, in exchange for two text fields. One source per fact.

A KMZ is a zip of five entries; four are icons and 45% of the bytes.
`functions/api/nhc/_kmz.js` unwraps it and `_gtwo-kml.js` reads it. Both live
under `functions/` for the same reason `_ships-parse.js` does — see §4.3.

**What a document carries**, per placemark:

```
Disturbance        integer   1, 2, 3 ... per basin, per issuance
2day_percentage    string    "0%" .. "100%"
2day_category      string    "Low" | "Medium" | "High"
7day_percentage    string
7day_category      string
Discussion         string    the forecaster's paragraph, numbered and titled
```

Placemarks come in three shapes: a `Polygon` for each watched area, a `Point`
for a disturbance that already has a current location, and — in 23 of the 72
archived hours — an unlabelled `LineString` carrying no data at all. **The
LineString is not drawn and is not named.** In every hour examined it appeared
exactly when a disturbance sat outside its own watched area and vanished when
it moved inside, which reads like a short motion path; that is four samples on
one disturbance in one basin, so the parser carries it through as `tracks` and
claims nothing.

The route converts each area to the field names layer 3 used — `prob2day`,
`risk2day`, `prob7day`, `risk7day`, `basin`, `objectid`, `idp_source`,
`idp_filedate` — so nothing downstream changed shape. Two differ on purpose.
`objectid` is namespaced by basin (`atl-1`, `epac-1`) because each document
numbers its disturbances from 1 and a bare number would let an Atlantic area
and a Pacific one collide. `idp_source` reads `gtwo_kml_202608190525` rather
than `gtwo_areas_...`, so a value we synthesised is never mistaken for one NHC
published. Two new fields ride alongside: `nhcTitle` and `discussion`.

**The probabilities are STRINGS with a percent sign, not numbers.** `"40%"`.
`parsePercent` in `lib/genesis.js` parses them; sorted as text, `"100%"` lands
between `"10%"` and `"20%"`. A missing field parses to `null` and never to `0` —
"not stated" and "zero" are different facts and render as different sentences.

One polygon carries both horizons, so the two-day and seven-day answers come
from a single query.

**Nothing structural reads the `basin` field.** The canonical basin comes from
the polygon's own centroid through `basinFromPosition()` — the same function
every storm is placed by — so an unexpected value cannot drop, misfile or
mistitle an area. The raw string survives as `sourceBasin`, shown as provenance
in the area panel. This is stronger than a fallback: a fallback still has a
wrong branch to take. (Measured: the live field is `"Atlantic"` or `"Pacific"`
and nothing else. Central Pacific is **not** distinguished — an area at
140–156°W was still called `"Pacific"`.)

**Layer 2, the published label anchor, is not fetched.** It carries a point for
only some areas — five polygons, three points — and its attributes match one
polygon while its position sits inside another, so the two ArcGIS layers could
not be reliably matched. **The KMZ publishes that join**: every placemark
carries a disturbance number, so an area and its current-position point arrive
already paired. The percentage is still drawn at the app's own centroid, which
is now a choice about placement rather than a workaround — a centroid comes off
the same feature the number came from and therefore cannot belong to the wrong
area, however NHC moves its label points.

**NHC's name is used where NHC publishes one.** The KMZ carries the forecaster's
own wording for each area — "South-Southwest of Mexico" — in the first line of
the discussion, and that heads the row and the panel. A document arriving
without one falls back to `areaTitle()`, which computes a description from the
centroid ("Central Atlantic", "East Pacific"); `titleIsOurs` carries which of
the two is on screen, because the fallback is descriptive rather than a
designation and the panel prints the centroid underneath it as the checkable
fact. NHC's own `basin` word is carried as `sourceBasin` and grouped on by the
outlook arbiter (§45.9), but is not shown: see §45.8 for why one basin row
beats two.

**The forecaster's paragraph is shown verbatim in the area panel** under a
heading naming its source, minus two things. The two formation-chance lines go,
because they restate the probability rows directly above the paragraph in a
second vocabulary. And the `2. South-Southwest of Mexico:` prefix goes, because
it is packaging rather than content — NHC's plain-text bulletin publishes these
paragraphs with no number at all, and left on, the paragraph opens by restating
the heading above it with a rank in front. The prefix is removed **only when it
is exactly the title already read off it**; anything else survives whole rather
than having its first sentence guessed at. Nothing else is touched: it is never
trimmed to a sentence and never summarised, because a paraphrase of a forecast
is a forecast the app wrote.

Cadence: with the text outlook, roughly every 6 hours. The publication stamp is
the **forecaster's issue time**, read from the document's own title and carried
in `idp_filedate`, and it is what the app ages the layer by — never the phone's
clock (§17.7). It runs a median 203 seconds ahead of the value ArcGIS published
under the same field name, which was NOAA's ingest time rather than NHC's
issue time.

**The layer publishes and then empties, and this is measured, not suspected.**
Across the archive's 72-hour window it runs three to six areas for many hours,
falls to zero features in a single step, and stays there — gaps up to five and
a half hours, one starting within ninety minutes of a good publish. This is not
"unchanged republishes being skipped"; it publishes, then it empties.

**There is no other ArcGIS address holding the shapes.** NOAA runs two tropical
map services — `NHC_tropical_weather`, which this route reads, and
`NHC_tropical_weather_summary`, which every other NHC route reads (§4). Both
carry a layer 3 named `Seven-Day: Potential Development Region`. On 2026-08-11
both were queried within a minute of each other and both answered zero features
while NHC's own website drew five areas. Checking the second service is
therefore a settled question, not a next step. The summary service has 35
layers, with a `Seven-Day Outlook` group at 34 and `Seven-Day: Development
Motion` at 33; there is no two-day polygon layer any more, only `Two-Day:
Current Location` (1).

**That outage is the reason the outlook is no longer read from ArcGIS at all.**
The KMZ on `nhc.noaa.gov/xgtwo/` is the same product off a different path,
which is the likeliest reason NHC's website had areas when layer 3 did not, and
it is now the source (§45.2). Both basin filenames are live; the East Pacific
one was inferred from its Atlantic sibling and is correct. The fear recorded
here before anyone opened the bytes — that KML carries colour where the GIS
layer carries `prob7day`, so shapes might arrive without numbers — was wrong:
each placemark carries both percentages, both risk words and the forecaster's
paragraph in `ExtendedData`.

**The KMZ states an all-clear instead of merely being empty, and that narrows
the hold.** A quiet basin's document says formation is not expected, in a dated
sentence, so "NHC is watching nothing" and "NHC's layer is broken" are no
longer the same bytes. `/api/nhc/genesis` therefore believes an explained
all-clear at once and no longer holds it behind remembered areas for six hours.

**The hold still exists, on a narrower trigger: no areas AND no explanation.**
Every quiet basin in 72 hours of archive carried the sentence, so this shape
has never been observed. It is kept because nothing has watched this source
through an outage yet, and a false all-clear is the failure §5 ranks worst. If
it never fires, the apparatus is a candidate for deletion rather than a fixture.

### 45.3 Source — JTWC, everywhere else

`https://www.metoc.navy.mil/jtwc/products/abpwweb.txt`, relayed through
`/api/jtwc/abpw` because that host sends no usable CORS header.

The Significant Tropical Weather Advisory. Plain text. It is the only genesis
product outside NHC that carries a probability — RSMC Nadi, Météo-France La
Réunion and IMD publish narrative bulletins with no structured formation odds
at all, so this is not a placeholder for something better.

Structure: a WMO header (`ABPW10 PGTW 090300`), then numbered areas, each with
lettered blocks. `lib/abpw.js` reads **section B, the tropical disturbance
summary, and nothing else**. Section A is the tropical cyclone summary and
those systems are already in the storm list from JTWC's own warnings; parsing
them here would put one typhoon on screen twice.

Four things drop an item, none of them an error: no designator ("NO OTHER
SUSPECT AREAS"), no current fix, no probability sentence, or the item having
been upgraded — "IS NOW THE SUBJECT OF A TROPICAL CYCLONE WARNING" means it is
a storm now and belongs to the storm list.

The bulletin hard-wraps at ~70 columns, through the middle of the probability
sentence, so every pattern is applied to whitespace-collapsed text. The
position pattern anchors on `NOW LOCATED NEAR`: the same sentence opens with a
`PREVIOUSLY LOCATED NEAR` fix roughly 100 nm behind.

The WMO header's date-time group is the stamp. A bulletin whose header will not
parse has no honest timestamp and is reported `unavailable` rather than stamped
with the device clock. Over a day old is also `unavailable` — it is reissued
several times a day, so a full day of silence is a broken product, and a
day-old "HIGH" is worse than an honest gap.

**The one invented thing.** JTWC states a position and no extent, so
`lib/abpw.js` gives each system a circle of `GENESIS.jtwcRadiusDeg` — 6.04°,
the measured mean equivalent radius of NHC's real published areas. The numbers
are all transcribed; only the shape is ours, and the area panel says so.

**The two sources do not speak the same language and are not made to.** NHC
gives a percentage over two and seven days. JTWC gives a word over 24 hours.
Mapping `HIGH` onto some invented percentage would be inventing data, which §5
forbids. They render as what each source said, in one list, each labelled with
its own source and horizon.

### 45.5 Failure behaviour

Three states, per §5, and the watch list has its own set separate from the
storm list's — held per source in `data/genesis.js`, so one source being down
never speaks for the other:

- **unavailable** — the query errored, was refused (ArcGIS reports failure as
  HTTP 200 with an `error` body), or came back truncated. Say which source.
  Never fall through to "nothing is being watched."
- **none_matched** — the source answered and published no areas. This is the
  common state for most of the year and is different from the one above.
- **clear** — no storms *and* no areas, from every source.

**A fourth state exists between `unavailable` and `none_matched`, and it is
invisible to any parser.** An empty FeatureCollection from NHC's outlook layer
is *unstamped* — a populated one carries `idp_source` and `idp_filedate`, an
empty one carries nothing — so "NHC is watching nothing" and "NHC's layer is
broken" are byte-identical. The only thing separating them is what was on the
wire an hour ago, so the relay remembers: inside one outlook cycle
(`HELD_SECONDS`, 6 h) of a real answer, an empty one is **held** and the last
real answer is served with its own age and `X-Landfall-Held: upstream-empty`.
Past that the emptiness is believed and a true all-clear gets through.

**Status stays `ok` while held**, deliberately — the areas are real and are
NHC's, and downgrading to `unavailable` would blank the very patches the branch
exists to keep. What changes is that the section *says* the layer has stopped,
with an age. The cost, stated: for up to six hours after NHC genuinely clears
the board, the app shows the last areas labelled with their age instead of a
clean all-clear. That is the direction to be wrong in.

**The memory is global, not per-colo, and that distinction was learned the
expensive way.** It first lived in `caches.default`, which is one copy per
datacentre; measured 2026-08-11, the relay served a false all-clear ninety
minutes *after* the held branch went live, because the colo it ran in had never
seen a real answer. The memory now lives in KV, warmed by the cron Worker
(§17.7), and the route reads both memories and takes the newer stamp.

**And an empty answer is never served out of a cache, on either path.** The
route answers colo-first, then KV, then upstream — and all of the remembering
above lives in the third step. Measured 2026-08-11: the relay served 42 bytes
of empty FeatureCollection carrying `X-Landfall-Cache: kv` and no held marker,
for at least two hours, while NHC's bulletin listed five areas. The held branch
was not broken; it was never reached. The cron re-stamps the warm copy every
five minutes whether the bytes changed or not (§17.7, and that re-stamping is
correct for its own reasons), so one empty answer reaching the store is
permanently "fresh" and short-circuits every request forever after. A single
empty cycle that got through poisoned the whole outage.

So a stored body with zero features is stepped over rather than served, an
empty upstream answer is no longer written to the colo slot at all, and the
emptiness is re-decided against the memory on every request. The cost: while
NHC is genuinely watching nothing, every request goes to NOAA instead of
answering from the store — a couple of fetches an hour at this scale, and the
direction §5 requires. A populated answer still serves from cache unchanged,
which is every request that matters for load. A body that will not parse counts
as *unreadable*, not as empty.

**The KV path states the area count too**, which it did not before. Nothing
reads it today — the cron bypasses every cache, so its write gate only ever
sees the upstream branch's headers. It matters the day that bypass silently
stops working, because a mismatched `WARM_KEY` does not fail, it just gets
answered from the warm copy; a gate reading `> 0` off an absent header then
refuses forever and `last-good` is never written again. That key was in fact
empty for the whole life of this feature (confirmed against the deployed warm
store, 2026-08-11), which is why a free header is not left off twice.
on `unavailable` — the previous patches hold, exactly as a storm's last-good
geometry does, and the words go in the drawer section and the status strip.
There is no such thing as drawing an outage.

**`overallStatus` knows about this, and it takes a SEPARATE FLAG to say so.**
§5's rule is that anything drawn on the globe outranks an all-clear — an ended
storm's grey dot already downgrades `clear` to `ok`, and a hatched genesis patch
does the same. `clear` additionally requires the watch list to have *answered*.

That requirement is carried by `answered`, not by `status`, and the distinction
is load-bearing. `status` reports a PARTIAL watch-list outage as `none_matched`
on purpose, so one dead source never blanks a live one — right for the drawer,
and it meant a dead NHC reached the status ladder wearing the same word as a
quiet day. Both `data/store.js` and `ui/view-storms.js` carried a comment
claiming an outage "falls through to unavailable"; it could not, because the
rollup had already converted it one function earlier. `answered` is false when
any source failed, and both copies of the ladder read it. The
watch list is a branch of store state of its own and deliberately **not** a
third entry in `sources` — that table feeds `data/lifecycle.js`, which counts a
source answering without a storm in it as evidence the storm has ended, and a
list of things that were never storms must never reach it.

### 45.9 The text outlook — the arbiter over layer 3

**NHC publishes the same forecast twice: as polygons and as prose.** The
polygons are `genesis.js`/layer 3; the prose is the Tropical Weather Outlook
(`ABNT20` Atlantic, `ABPZ20` East Pacific), issued 0000/0600/1200/1800 UTC by
the same forecaster. Relayed by `functions/api/nhc/outlook.js`, parsed by
`lib/outlook.js`.

**It exists because the two disagreed and the polygons were wrong.**
2026-08-11: layer 3 answered `{"features":[]}` for two hours while the bulletin
listed three Atlantic areas, one at 70% over seven days. An empty
FeatureCollection is unstamped, so from the polygons alone "NHC is watching
nothing" and "NHC's layer is broken" are byte-identical. The bulletin separates
them.

**IT CANNOT DRAW, AND IT IS NOT A SECOND POSITION SOURCE.** There is no
geometry in a paragraph — a title, a prose location, two percentages. So this
is not GDACS-beside-NHC; it is an arbiter that answers *is the layer telling
the truth*, by count and by probability, and never answers *where*.

**Areas are never matched to polygons.** NHC publishes no id on either side to
join on, and titles genuinely collide — two areas in the same third of the
Atlantic both titling as "Central Atlantic", measured live. A wrong match
prints one area's probability on another area's shape, which is what killed the
layer-2 anchor idea (`GENESIS.anchorLayer`). Invest designators (`CP93`) are
captured for display and are deliberately **not** used as a join key: the GIS
layer publishes no matching field, and a half-available key is how a confident
wrong match gets built later.

**Six verdicts, from `reconcile()`:** `agree`, `both-clear` (a true all-clear,
showable **immediately** rather than waiting out the six-hour hold),
`layer-broken` (empty layer, prose has areas — the hold may now outlast
`HELD_SECONDS`, because this is a reading rather than an inference),
`layer-short`, `layer-ahead` (the GIS layer publishes before the prose is
written, so this is expected briefly and is never a fault), and `no-arbiter`.

**ONE LAYER, TWO BULLETINS — `reconcileBasins()` is that asymmetry.** NHC
returns the Atlantic and the East Pacific in a single FeatureCollection and
publishes the prose as two products.

**THE LAYER IS SPLIT BY NHC'S OWN `basin` FIELD, AND THAT IS NOT THE INVENTED
JOIN THIS SECTION REFUSES.** Nothing is matched to anything: areas are still
never paired with paragraphs and no boundary is drawn by us. The grouping key
is NHC's word on NHC's feature, beside NHC's bulletin for the same basin — only
the counts on each side are compared. The layer says `Atlantic` and `Pacific`;
`Pacific` maps to `ABPZ20`, which covers the East *and* Central Pacific, so the
mapping is a translation and lives in a closed table (`LAYER_BASIN` in
`data/genesis.js`). An unrecognised word drops the whole comparison back to
summing rather than silently discarding the area — a dropped area shrinks the
count and makes a healthy layer look broken, which is a false *outage*, the
mirror of the bug this feature answers.

**WHY IT IS WORTH THE SPLIT, MEASURED ON REAL BYTES.** The 2026-08-09 polygons
are 2 Atlantic and 3 Pacific; the 2026-08-11 bulletins are 3 Atlantic and 2
Pacific. Summed that is five against five and reports `agree` — the Atlantic
being one short is cancelled exactly by the Pacific having one extra, over two
basins that both disagree with their own forecaster. Split, both errors
survive. More generally, one basin going dark beside a healthy one sums to
`layer-short`, a verdict nothing acts on; split it is `layer-broken`, which
holds. The worst per-basin answer wins, so a healthy neighbour can never
average a dark basin away, and an absent basin is *unknown*, never zero.

**AND THE LAYER GOES EMPTY BETWEEN PUBLICATIONS, WHICH IS WHY THE SECOND
WINDOW IS 24 HOURS.** Measured across the archive's `idp_filedate`: NHC
republishes roughly six-hourly, about a minute after the text bulletin, and the
layer is *not* skipping unchanged republishes — it publishes fine and then
falls to zero features for hours before refilling at the next cycle. It ran
clean all of 2026-08-10 and did this twice on 08-11, once emptying within an
hour and a half of a good publish. The observed gaps run right up against
`HELD_SECONDS`, which is what `HELD_LAPSED_SECONDS` exists to survive.

**A HALF-READ SKY CAN ACCUSE, BUT IT CANNOT ACQUIT.** The two bulletins fail
independently. One readable bulletin listing areas over an empty layer is
`layer-broken` whatever the other says — an area cannot be un-seen. Every
comparison finer than "the layer is empty", including `both-clear`, requires
*all* basins readable, because a sum over a subset is not a magnitude and an
all-clear declared over an ocean nobody looked at is §5's worst failure.

**THE HOLD HAS TWO WINDOWS, AND THE RELAY DECIDES NEITHER.** Inside
`HELD_SECONDS` the hold is ASSERTED and the client draws it — the shape of the
drop is the evidence. Between there and `HELD_LAPSED_SECONDS` (24 h) the relay
still has the memory and only OFFERS it, under a distinct marker
`X-Landfall-Held: upstream-empty-lapsed`; `data/genesis.js` draws those areas
only on a `layer-broken` verdict and drops them otherwise. Past a day the
memory is let go entirely.

The split exists because **the relay cannot read a bulletin.** §4 forbids a
relay from interpreting a payload and §3 keeps every Pages Function importing
nothing but its `_`-prefixed siblings; parsing prose in the edge would put a
second implementation of `lib/outlook.js`'s judgement on the far side of a
deploy boundary. So the route remembers and the browser decides. A client that
has never heard of the second marker ignores it and behaves exactly as before
it existed.

**WHAT THE CLIENT ARBITRATES ON IS UPSTREAM'S COUNT, NOT THE ONE IN ITS HAND.**
A held response carries remembered areas; counting those would tell the arbiter
the layer published areas at the moment it published none, and `both-clear`
would be unreachable forever. While held, the layer count is zero by
definition.

**THE BULLETIN DATES ITSELF, AND THAT IS WHY IT MAY CONTRADICT ANOTHER
SOURCE.** `ABNT20 KNHC 111142` is a day and a time, so a mirror that quietly
stops updating is detectable here and invisible everywhere else. Not
hypothetical: `nhc.noaa.gov/ftp/pub/forecasts/discussion/MIATWOAT` was found on
2026-08-11 serving the 24 June bulletin — plain text, HTTP 200, two months
stale, healthy by every signal except the line inside the body. Every read
checks the age against `OUTLOOK.maxAgeMs` (12 h, two publication cycles) and a
stale bulletin arbitrates nothing. **A second opinion that can silently freeze
is worse than no second opinion.**

**`DDHHMM` carries no month.** A day-31 stamp read on the 1st is either
tomorrow or four weeks ago, and assuming the current month dates a bulletin
into the FUTURE, which passes every staleness check there is.
`OUTLOOK.futureToleranceMs` bounds it at one day of skew.

**Anything unreadable is `unreadable`, never an all-clear** — an error page at
200, a redesigned page with no `<pre>`, a bulletin both listing areas and
saying none are expected. That collapse is the original bug this section
answers and must not be re-committed inside the fix.

**As-built gap, stated:** the relay scrapes the `<pre>` from NHC's `.shtml`
pages. Plain-text equivalents at `tgftp.nws.noaa.gov` are archived beside them
(`tools/archive-fetch.mjs`) so the switch can be made on evidence; the parser
anchors on the WMO header and reads either identically. Measured 2026-08-11
over ONE archive cycle, both basins: the two transports are byte-identical
apart from three lines above the WMO header (`en Español`, a blank, and a `000`
sequence number), all of which the parser already steps over. The East Pacific
raw URL — inferred from its Atlantic sibling and never fetched until then —
answered 200 with a current bulletin. One cycle is a good sign and not proof;
the switch waits on several.

## 48. Rainfall — the sources

### 48.1 Why this exists, and what it deliberately is not

Flash flooding kills more people in United States tropical cyclones than wind
does. The app answers two different questions about it, on two different
surfaces: the storm drawer says what the forecaster wrote about this storm's
rain (§48.9), and the home drawer says how much is coming to the house (§48.8).

**==> THERE IS NO MAP LAYER IN THIS SECTION, AND THAT IS A DECISION, NOT A GAP. <==**
NHC publishes no rainfall geometry. This was checked against NHC's own GIS
index, where every other hazard has a product and rainfall has none: track,
cone, watches/warnings, wind field, best track, wind arrival time, the outlook,
wind speed probabilities, **four separate storm surge products**, and
breakpoints. Rainfall is the single hazard on that page with no entry. WPC's
shapefile and KML pipelines carry only the CONUS QPF, which is all rain
everywhere rather than the storm's, is lower-48 only, and would have been
useless for the storm that motivated this work. The storm-specific graphic NHC
links as *Rainfall Potential* is a GIF and ships as nothing else. **Do not
re-research this.**

The disqualifying limits on the CONUS QPF polygons, recorded so the map
question does not get reopened from memory: extent is −132 to −59 longitude and
20 to 57 latitude, so no Hawaii, Puerto Rico, Guam, Caribbean or Mexico; it is
all precipitation rather than the storm's; and its own service description
claims a 06Z/18Z cadence while its KML issue stamps read 22:24Z–22:44Z, so the
documentation disagrees with the product.

### 48.2 Source — the advisory paragraph

No new source. `data/advisory.js` fetches the whole product for the Advisory
section and `lib/advisory.js` returns the verbatim teletype text; `advisoryRainfall`
finds the rainfall block inside it. **It is not free of network cost, though —
see §48.9.**

Every NHC Public Advisory carries a `HAZARDS AFFECTING LAND` block whose
subsections are introduced by an all-caps label and a colon at the start of a
line. Labels measured across captured products: `WIND:`, `RAINFALL:`,
`STORM SURGE:`, `SURF:` and — on Ida — `TORNADOES:`. The parser stops at
whatever label comes next rather than at a list of the ones a spec recorded,
because that list has already been wrong once.

**The block's end is the line above the next underline.** There is no closing
marker and the next heading is not distinguishable from the capitalised lines
inside the block, but its row of dashes is. `$$` closes the product.

**==> THE PARAGRAPH IS SHOWN, NOT REWRITTEN. <==** Same rule surge follows in
§4.8: NHC's range is the forecast and our summary would be a second opinion
nobody asked for. Nothing extracts a number, classifies a severity, or shortens
a sentence. Two paragraphs are stripped because they are plumbing rather than
forecast — the `For a complete depiction...` pointer at the rainfall graphic
and the `For a list of rainfall observations...` pointer at the WPC storm
summary — both measured present on Lala.

Products are hard-wrapped at roughly 68 columns, so a paragraph arrives with
newlines mid-sentence and is rewrapped for display. **A whitespace-only line is
a paragraph break**, not just an empty one: NHC writes `\n \n` as often as
`\n\n`, and treating only the empty form as a break joins two paragraphs into
one. Ida's advisories carry two rainfall paragraphs and prove it.

**`None.` IS A REAL ANSWER AND IT SURVIVES.** A storm with no land threat
publishes the hazards heading followed by exactly that, with no labelled
subsections at all. Four states, and no two of them render the same sentence:

| State | When |
|---|---|
| `ok` | a `RAINFALL:` block was found |
| `no_hazards` | the block exists and reads `None.` |
| `no_rainfall` | the block exists, has labels, and none of them is rainfall |
| `no_block` | no `HAZARDS AFFECTING LAND` at all — every JTWC product |

### 48.3 Source — gridded rainfall at a point

`ENDPOINT.nwsPoints` (`/points/{lat},{lon}`) resolves a coordinate to a
forecast office and grid cell, and its `properties.forecastGridData` is the URL
of the raw numeric grid. That grid's `properties.quantitativePrecipitation` is
the rainfall series. **Two hops, which is why the relay does both (§48.7).**

**Every figure below was computed by running code against captured bytes, not
read off a page.** Probed 2026-08-16T01:49Z; the fixtures are in `samples/rain/`.

| Point | Office | Grid HTTP | Values | Total | Through |
|---|---|---|---|---|---|
| Hilo, Big Island HI | `HFO` | 200 | 20 | 282.956 mm (11.14 in) | 2026-08-20T10:00Z |
| Honolulu, Oahu HI | `HFO` | 200 | 20 | 84.074 mm | 2026-08-20T10:00Z |
| Kahului, Maui HI | `HFO` | 200 | 20 | 73.914 mm | 2026-08-20T10:00Z |
| Tamuning, Guam | `GUM` | 200 | 17 | 144.272 mm | 2026-08-23T20:00Z |
| San Juan PR | `SJU` | 200 | 29 | 44.450 mm | 2026-08-24T01:00Z |
| Key West FL | `KEY` | 200 | 30 | 1.778 mm | 2026-08-23T06:00Z |
| Galveston TX | `HGX` | 200 | 30 | 0.254 mm | 2026-08-23T06:00Z |
| Nassau, Bahamas | — | **404** | — | — | — |

**Guam answers.** Guam is JTWC and GDACS territory for every other feature in
this app, so the home rainfall number is not a lower-48 feature: Hawaii, Puerto
Rico and Guam all carry a real series.

**NWS requires a `User-Agent` naming a contact** and answers 403 without one.
The relay sets it; nothing in the browser app ever talks to this host.

### 48.4 Two traps in the payload, both measured

**==> THE UNITS ARE MILLIMETRES. <==** `quantitativePrecipitation.uom` reads
`wmoUnit:mm` at every point probed, including all five US ones. An
implementation that assumes inches because the advisory is written in inches
produces a number 25.4 times too small and looks entirely plausible on the
page. `lib/rainfall.js` reads `uom` against a short table and answers
`unreadable` for anything not in it rather than guessing. Display follows the
app's existing unit system (§4.7's `sys()`), so a metric reader sees
millimetres and never a conversion round-trip.

**==> `validTime` IS AN INTERVAL, NOT A TIMESTAMP. <==** The format is
`2026-08-15T22:00:00+00:00/PT6H` — a start instant, a solidus, and an ISO 8601
duration. Splitting on `T` returns nonsense that parses. Splitting on `/` and
discarding the duration silently treats a twelve-hour block as an hour. A block
whose start reads and whose duration does not is DROPPED, not assumed.

**The durations are not uniform**, within one response or between offices.
Hilo mixes `PT1H` and `PT6H`; Guam runs to `PT12H`; San Juan includes `PT3H`;
**Key West carries a `PT5H`**, which nobody predicted and which is the whole
argument for parsing the duration rather than enumerating the known ones.

### 48.5 Coverage, and the two shapes of "no"

Outside NWS's forecast areas there is no answer, and **the section stays
visible and says so** rather than disappearing. A section that silently is not
there cannot be told apart from a section that failed to load, which is the §5
failure this app is built to avoid, and it matches how §47.6 handles a storm
outside SHIPS coverage.

The two endpoints disagree about how to say no, and both shapes are measured:

```
/points/25.048,-77.3554        -> HTTP 404  problems/InvalidPoint
/alerts/active?point=25.048,-77.3554  -> HTTP 400  problems/InvalidParameter
```

**A 404 from `/points` and a 400 from `/alerts` are the SAME fact** — this
place is outside coverage — and both map to `not_covered`, never to
`unavailable`. Treating the 400 as an error would put a Retry button under a
house in the Bahamas that will never get an answer, which is §4.11's
`none_matched` versus `unavailable` distinction in a new place. The relay
matches on the `problems/` URI rather than on the status code alone; the URI is
stable and the status is not, as these two already prove.

`unavailable` is reserved for a network failure, a timeout, or a 5xx. Only
`unavailable` offers Retry. A 200 grid carrying no
`quantitativePrecipitation` is `not_covered` rather than an error — all eight
probed points that answered 200 carried the series, so this has not been
observed, and the parser treats a missing series as an absence rather than
throwing.

### 48.6 Flood warnings in force

`ENDPOINT.nwsAlerts` returns what is in force at a point as structured GeoJSON
with `event`, `severity`, `urgency`, `headline`, `onset`, `expires` and `ends`.
Same host, same relay, so it costs one route rather than a new source.

Measured at Hilo during Lala: Flash Flood Warning (Severe/Immediate), Hurricane
Warning (Extreme/Immediate), Flood Watch (Severe/Future), High Surf Warning
(Moderate/Expected), Tropical Cyclone Local Statement (Moderate/Expected).

**Only the flood family is rendered** — events whose `event` contains `Flood`
(`RAIN.alertEventMatch`). Hurricane and tropical storm warnings already have a
home in the `In effect` section and must not be duplicated; High Surf and the
local statement belong to neither. A warning in force is a fact about now and
outranks any forecast total, so it renders **above** the number.

**==> SEVERITY IS NOT THE ORDER; URGENCY IS. <==** A Flood Watch and a Flash
Flood Warning are both `Severe`, so the word cannot separate them.
`urgency: Immediate` sorts first and takes the error ink; everything else takes
the stale ink.

**`expires` is authoritative and is honoured AT RENDER, not only at fetch.**
The Hilo Flash Flood Warning expired 52 minutes after it was issued. Flash
flood warnings are routinely shorter-lived than one cache window, so a held
payload becomes a lie about now inside the hour. `ends` outranks `expires` when
both are present: one is when the message goes stale, the other is when the
weather does.

### 48.7 The relay route

`functions/api/nws/rainfall.js` takes `lat` and `lon`, does the two upstream
hops plus alerts, and returns a small object: the series, its `uom`, the grid's
`updateTime`, the office id, the nearest named place, and the alerts.

**==> 99% OF THE PAYLOAD IS WASTE AND THE RELAY DOES NOT SHIP IT. <==** Hilo's
grid is 130,885 bytes on the wire and its `quantitativePrecipitation` is 1,223
— under one percent. The largest single field, `relativeHumidity`, is 8,679
bytes by itself, seven times the field we came for. The alerts response is
55,236 bytes, nearly all of it alert text and polygons. Measured through the
projection on the stored fixtures: the grid comes out at 2,702 bytes and the
alerts at 1,379.

**This is a projection, not logic** (§4.3) — no summing, no unit conversion, no
classification, all of which stay client-side in `lib/` where they are
testable. `projectPoint` is exported separately from the fetching so that
`tools/test-rainfall.mjs` can run it over real captured bytes; a Pages Function
is otherwise unreachable from a sandbox, and so is its upstream.

**The relay does NOT filter alerts by event.** Which events reach the screen is
a decision about which SECTION owns a fact, and it lives beside the sentence it
governs (§48.6). What the relay drops is `description`, `instruction` and the
polygon, which is the entire 55 KB; the five stripped alerts at Hilo come to
1.4 KB, so passing all of them costs nothing and keeps this route dumb.

**A failed alerts hop never fails the request** and comes back as `null`, which
is "not known" — distinct from `[]`, which is "nothing in force". Rendering
them the same would be an all-clear nobody verified (§5).

**The fresh window is set by the alerts, not by the grid.** Grid `updateTime`
differs by office — `2026-08-15T21:11:51Z` for Honolulu against
`2026-08-16T00:20:24Z` for Houston — and on the rainfall numbers alone this
could be cached for hours. It cannot be, because a flash flood warning travels
in the same payload and can come and go inside one. Fifteen minutes fresh, six
hours last-good, twenty-four hours for `not_covered` — which is durable but not
permanent, and is never written to last-good.

**Home coordinates are rounded to `RAIN.wireDecimals` (two) before they go
upstream**, and again server-side. About 1.1 km, comfortably inside a ~2.5 km
NWS cell, so the coarser number resolves to the same forecast. It is both the
privacy posture and what makes a cache key hit twice. §4's note on `/api/reverse`
being "the one exception" to home coordinates staying on the device is now two
exceptions; both send a rounded point, and neither carries an identifier.

### 48.11 Acceptance cases

Computed against captured bytes, not typed. A test that passes on a
hand-written fixture proves nothing about this API's real shapes.
`tools/test-rainfall.mjs` asserts every row; the fixtures are in `samples/rain/`.

| Case | Fixture | Produces |
|---|---|---|
| Units are read, not assumed | `grid-hilo-hi` | `uom` is `wmoUnit:mm`; a payload relabelled `wmoUnit:in` moves the total and still looks plausible |
| Mixed durations sum correctly | `grid-hilo-hi` | `PT1H` and `PT6H` both present; 24 h = 254.508 mm, 48 h = 274.320, 72 h = 282.956 |
| The 120 h window equals the 72 h window | `grid-hilo-hi` | 282.956 mm both, over **13 blocks against 20** — the series ends before the window does, and the extra seven are zeroes |
| The label follows the data | `grid-hilo-hi` | cutting the series short moves the "through" label; the window it sits in does not move |
| Twelve-hour blocks | `grid-tamuning-gu` | `PT12H` present; 17 values; 144.272 mm |
| Three-hour blocks | `grid-san-juan-pr` | `PT3H` present; 29 values; 44.450 mm |
| Negligible rain is words | `grid-galveston-tx` | 0.254 mm across 30 values; the figure it replaces would have been `0.0 inches` |
| Peak block is found | `grid-hilo-hi` | 84.836 mm at `2026-08-15T22:00:00+00:00/PT6H`, 30% of the total, rendered as 3 inches |
| Outside coverage, grid | `points-nassau-bs` | HTTP 404, `problems/InvalidPoint` |
| Outside coverage, alerts | `alerts-nassau-bs` | HTTP **400**, `problems/InvalidParameter` — one pattern recognises both |
| Flood family only | `alerts-hilo-hi` | Flash Flood Warning and Flood Watch kept; Hurricane Warning, High Surf Warning and Tropical Cyclone Local Statement dropped |
| Expiry is honoured at render | `alerts-hilo-hi` | the Flash Flood Warning ending `2026-08-15T16:00:00-10:00` is gone a minute later, from the SAME payload |
| Urgency orders, severity cannot | `alerts-hilo-hi` | both flood alerts are `Severe`; only `urgency` separates them |
| Advisory block found | `advisory-lala-HFOTCPCP2` | the `RAINFALL:` paragraph, stopping before `STORM SURGE:`, both `For a ...` pointers stripped |
| Multi-paragraph, fifth label | Ida `public.011` | two paragraphs kept, `TORNADOES:` not swept in |
| Whitespace-only paragraph break | Ida `public.001` | `\n \n` separates two paragraphs |
| The relay projection | `grid-hilo-hi` | 58,373 stored bytes to 2,702; alerts 34,369 to 1,379 |

**Every rule is shown to fail when broken.** Eight mutations reintroduce a named
bug and assert the output moves (§12).

**==> ONE CASE IS SYNTHESISED AND THE SUITE SAYS SO. <==** `no_hazards` — a
storm publishing `HAZARDS AFFECTING LAND` followed by exactly `None.` — is
asserted against a hand-built product, because **no such bytes were ever
captured.** The probe branch holds two NHC pages and one of them is a 404. What
is proven is the parser's behaviour on the shape §48.2 describes, not a claim
about what any real advisory said. Replace it with real bytes the next time a
storm publishes one.

**==> AND ONE MUTATION CANNOT BITE ON THIS FIXTURE. <==** Labelling by the
window instead of by the last block held is a real bug, and Hilo cannot prove
it: the window ends 2026-08-20T15:00Z and the series ends 2026-08-20T10:00Z,
five hours apart and both `early Thursday` in Honolulu. The suite proves the
rule a different way — cut the series and the label must move — rather than
asserting an accident.

---

### 49.3 The observed track

**The app has always downloaded where a storm HAS BEEN and never read it.** Both
sources publish an observed track and both already pay for it — NHC to draw the
trail and build the wind swath, GDACS as half of its centre dots. Nothing new
goes over the wire for any of this.

**NHC** — `SUMMARY_LAYER.pastPoints` (layer 10), on every geometry bundle. Read
live off `origin/archive:latest/geometry/nhc-Lala-CP2-pastPoints.geojson`,
2026-08-16: 26 fixes, one every 6 hours, from `dtg` 2026081000 through
2026081606 — the storm's whole life including its pre-genesis stretch.

| Field | Meaning | Note |
|---|---|---|
| `geometry.coordinates` | position | **the position.** `lat`/`lon` attributes are rounded to whole degrees, ~30 nm of error |
| `dtg` | 10-digit synoptic time, NUMBER | `2026081606`, UTC |
| `intensity` | wind, knots | NHC's own analysed wind — a measurement, not a forecast |
| `mslp` | central pressure, mb | not carried; nothing asks for it |
| `stormtype` | NHC's class letter | `DB`, `LO`, `TS`, `HU` all on Lala's one track |
| `ss` | Saffir-Simpson number | `0` below hurricane |
| `binnumber` | `CP2` | the filter currency every layer keys on |

**GDACS** — `data/gdacs-points.js` already splits its centre dots at the
advisory issue time and already attaches JTWC's analysed `CARQ` wind where
`lib/carq.js` finds a match. GDACS publishes no wind of its own on history, so
most past dots carry a position and a time and nothing else. Measured on
HERNAN-26 episode 12: 11 past dots, every one with a position, a time and a
class letter, none with a wind.

**`normalizePastPoints()` in `lib/track-point.js` is the one normalizer, for
both sources.** It returns `[{lon, lat, time, windKt, gustKt, category,
categorySource, stormType, tau}]` — the same shape `normalizeForecast()`
produces — ascending by time. It lives in `lib/track-point.js` rather than
twice in `data/` because that file already owns reading ONE track position
source-blind: `timeMsOf`, `windKtOf` and `categoryIndexOf` between them already
resolve NHC's field names, GDACS's stamped ones, and the skeleton
`data/lifecycle.js` rehydrates for an ended storm. Two copies would have meant
two copies of the source-precedence rules, drifting until the dashboard and the
map disagreed about the same fix.

**A FIX WITH NO READABLE TIME IS DROPPED, never placed.** Same rule the ridge
builder and the ended-storm compactor already apply. So is one whose
coordinates are not numbers — `Number(null)` is `0`, and 0°N 0°E is a real
place in the Gulf of Guinea.

**`tau` IS ALWAYS NULL** even though a GDACS past dot arrives carrying a
negative one (measured −66 on HERNAN-26). Tau means hours ahead of the
analysis and a measurement has none; NHC publishes none on layer 10 at all. A
field present on half the points invites a consumer to sort on it, which would
silently scramble an NHC track. The times are the ordering key and they always
exist. `gustKt` is always null for the same kind of reason — neither source
publishes a gust on an observed fix — and is present only so one loop can read
a past point and a forecast point without asking which it has.

**A DISTURBANCE GETS NO CATEGORY EVEN THOUGH IT HAS A WIND.** The knots
fallback fires only where the source published no classification at all.
`categoryIndexOf` refuses to grade `DB`, `LO`, `WV`, `HU`-without-`ss` and the
post-tropical codes, and that refusal is what stops the map painting a storm's
pre-genesis history hotter than the depression it grew into; deriving here
would put two different readings on one position. **Lala is the live proof:**
three of her 35 kt fixes are still `LO` and the fourth is `TS`, so a
knots-derived grade would have named her a tropical storm eighteen hours before
NHC did.

**`categorySource` says whose grading it is.** `'reported'` where the agency
graded the fix, `'derived'` where the number is our Saffir-Simpson read of
somebody's wind. GDACS's stamp is ambiguous from outside the parser that made
it — its index can be GDACS's own leg code or our arithmetic on a JTWC or CARQ
wind — so `data/gdacs-points.js` writes `_catSource` beside `_catIndex`, and
`data/lifecycle.js` persists it as a seventh element on each compacted tuple.
A six-element tuple written before this existed reads back as unknown, which is
true; records expire inside `ENDED.holdFor` and cannot outlive a day and a half.

**Where it arrives:** `bundle.past` on both sources' geometry bundles, on the
rebuilt bundle `endedBundle()` returns for a storm that has left the feed, and
on the four empty fallback bundles in `app/bundle-pipeline.js`. `ui/view-home.js`
reads it off the bundle with no source test and no ended test and hands it to
`buildHomeDashboard`, which exposes it as `dash.pastCurve`. Empty array, never
null — a storm named in its first advisory has no history yet, and that is an
answer rather than a gap.

**WHAT READS IT.** §49's pass 3 turned it into the closest pass that already
happened (`SPEC-NEXT.md` §49.5), the storm's real peak (§49.6) and the rungs
that describe the past (§49.14). The left half of the chart and the Timeline
rail's past rows are pass 4 and do not read it yet.

### 48.14 Source — rainfall where NWS does not reach

**Open-Meteo, `api.open-meteo.com/v1/forecast`.** Keyless, global, and the
non-American half of §48. Measured 2026-08-19 against Manila: HTTP 200 in
403 ms, 1,992 bytes, **72 hourly values with zero nulls and zero time gaps**,
`mm` and ISO-8601 on a UTC base.

**==> CORS IS OPEN AND WE RELAY ANYWAY. <==** The first probe carried no
`access-control-allow-origin` — but the runner sent no `Origin`, so the server
was never asked, and reading that silence as "CORS is closed" would have been
the mistake. A second probe sent one from the production origin and the answer
is `access-control-allow-origin: *`. A browser **can** call this directly. It
does not, for three reasons, and none of them is access: the free tier's daily
ceiling is a documentation-page number with **no `x-ratelimit-*` header of any
kind** in the response, so the only defence is fewer calls and that needs a
shared cache; the coordinate is somebody's house and behind a relay it reaches
one third party from one server rather than from the reader's own IP; and a
second origin in `connect-src` is a permanent widening of what this app may
talk to.

**Two constraints on shipping it, neither on reading it.** CC BY 4.0 requires
**visible** attribution — discharged in the provenance line of §48.16, because
a credit in a code comment is not one. And the free tier is non-commercial,
which this app is.

**==> THE UNIT PROBLEM DOES NOT EXIST, AND THAT IS LUCK RATHER THAN DESIGN.
<==** §48.4 records that NWS's `quantitativePrecipitation` reads `wmoUnit:mm`
at every point ever probed, including the American ones. Open-Meteo's
`hourly_units.precipitation` reads `mm`. Same unit, no conversion — but the
field is still **read** rather than assumed, and an unrecognised one is an
answer (`unreadable`) rather than a guess.

**What differs is the packaging, and that is a transport concern.** Open-Meteo
sends parallel arrays — a list of ISO times and a list of numbers, positionally
paired. NWS sends `{ validTime, value }` objects where `validTime` is an
interval. Same fact, two shapes.

### 48.15 The global relay route

`/api/rain/global?lat=&lon=` — `functions/api/rain/global.js`.

**==> IT EXISTS SO `lib/rainfall.js` NEVER LEARNS THERE ARE TWO SOURCES. <==**
`projectOpenMeteo()` normalises the parallel arrays into the exact body
`/api/nws/rainfall` already serves, including rebuilding `validTime` to NWS's
own grammar: `2026-08-19T00:00:00+00:00/PT1H`, an instant, a solidus and a
duration §48.4's `parseInterval` already reads. Every line of arithmetic, every
window, every sentence and every test downstream is untouched. The alternative
— a second parser — is two code paths that must agree about what an inch is,
and they drift.

**A null inside the series is dropped, not zeroed.** Never seen in the archive.
A missing hour is an hour we do not know about, and summing it as zero quietly
shrinks a total with no shape to the failure.

**A 200 with no series is `values: null`, never `values: []`.** This model
covers the planet, so it cannot report a place as uncovered; an empty array
would read downstream as a forecast of nothing, which is a claim nobody made.

**Cache: fresh 1 h, last-good 6 h.** Four times the NWS route's fresh window,
and the reason is what is **missing** from this payload. That route's fifteen
minutes is set by flood warnings that expire inside the hour. Nothing here
expires — it is a numerical model rerun a few times a day — and the longer hold
is the difference between one upstream call per hour per neighbourhood and four,
against a ceiling nothing can measure.

**==> THERE ARE NO FLOOD WARNINGS HERE AND THE ROUTE SAYS SO. <==** Open-Meteo
publishes weather, not what an agency has in force, and no global equivalent of
`/alerts/active` has been found. `alerts: null` is the same signal the NWS route
sends when its alerts hop fails, so `provider` travels beside it — see §48.16.

### 48.16 Which source answered, and the two meanings of `alerts: null`

**NWS first, everywhere it answers.** It is a forecaster's product rather than a
raw model: a gridded QPF an office has touched, flood warnings in the same
payload, and a named nearest town that §48.10 depends on. The global model has
none of those three and covers everywhere.

**==> ONLY `not_covered` FALLS THROUGH. <==** `data/rainfall.js` moves to the
second source on a statement about the PLACE and never on one about the
NETWORK. Answering an `unavailable` from elsewhere would mean a reader in Miami
silently getting a different forecast, with different provenance and no flood
warnings, on the days api.weather.gov is having trouble. Retry is the honest
response to a transport failure; substitution is not. And if the second source
also fails, the answer is **its** failure — returning the first one's
`not_covered` would tell a reader outside NWS coverage, permanently and with no
button, that nobody forecasts rain for their house.

**`provenance()` in `lib/rainfall.js` reads which source answered.** A payload
with no `provider` field is the American one — `/api/nws/rainfall` predates the
second source and sends none, so defaulting to `nws` keeps every fixture in
`samples/rain/` reporting the source it actually came from with nothing
rewritten.

**==> `alerts: null` MEANS TWO OPPOSITE THINGS AND GETS TWO SENTENCES. <==**
From NWS it means the alerts hop failed while the grid succeeded: what is in
force is **unknown**, which is not "nothing in force" and must not read as
silence (§5). From the global model it means no flood-warning source exists for
this place at all — a durable fact. "Could not be checked just now" under the
second invites a reader to wait for an answer that is never coming.
`alertsKnown` is what separates them.

**The provenance line names the point on both paths, and §48.10 is why.** NWS
supplies a town ("nearest point Kahului, HI"). Open-Meteo supplies only the grid
point it snapped to — measured, 14.5995/120.9842 asked and 14.586995/121.002785
answered — which is a poorer answer to the same question and not nothing.

**`not_covered` is now close to unreachable, and its wording changed.** It used
to explain NWS's coverage area, because NWS not forecasting here **was** the
whole answer. Reaching it now means both sources declined to produce a series.
It still carries no Retry.


## 50. Local agency alerts — what the rest of the world publishes

### 50.1 Why this exists, and what it deliberately is not

The watch/warning stripe on the coast (§7.7) is NHC-only. Outside NHC's basins
the app has never been able to say who has warned whom, which for a global
storm tracker is a real hole: a typhoon closing on Luzon shows a cone, a wind
field and no indication that anyone has told anybody to move.

**THE SOURCE IS CAP, VIA THE WMO ALERT HUB.** Esri's CAP Connector republishes
what the Hub aggregates — every member country's official alerts — as an
ordinary ArcGIS feature service: public, anonymous, no key.

**==> IT IS A TEXT SECTION AND IT PAINTS NOTHING, AND THAT DECISION CAME OUT
OF THE BYTES. <==** Measured on the archive branch, 2026-08-19, at an hour when
GDACS was tracking eleven active cyclones, the entire global cyclone-alert feed
held FIVE rows:

- Two from Environment Canada — storm surge for the **Yukon coastline**. Arctic,
  no cyclone within thousands of kilometres. They match because surge is surge.
- Two from Costa Rica's Instituto Meteorológico Nacional, in Spanish, announcing
  the **END** of a tropical wave's influence. Headline: rain and showers on
  Tuesday. The same message published twice, eight minutes apart, at two
  different severities. Geometry: the **entire national outline, 6,585 points.**
- One from PAGASA — "Tropical Cyclone Alert: Tropical Depression Neneng."
  Geometry: a **seven-point rectangle, 113–130°E by 5–21°N.** That is the
  Philippine Area of Responsibility, the whole monitoring basin, not a warned
  zone.

A CAP area is whatever the issuing country drew, and what countries draw is
administrative: a province, a nation, a basin. Banded onto a coast the way §7.7
bands NHC's breakpoint lines, that shades seventeen degrees of open ocean
because a depression exists somewhere inside it. **Painting it would be a
worse lie than leaving the coast unpainted**, so the stripe stays NHC-only and
this section is words.

**NOTHING IN THIS SECTION INFERS A THREAT.** It does not rank alerts, read
severity as danger, or derive an all-clear. Two of the five archived rows
announce weather ENDING. It reports that an agency said something, and shows
what.

### 50.2 The payload, and the geometry we refuse

Two forms of one query, both measured 2026-08-19:

| Form | Rows | Bytes |
|---|---|---|
| Attributes only, `returnGeometry=false` | 5 | 8,015 |
| With shapes, ten requested | 3 | 281,336 |

We paint none of it (§50.1), so the shapes are pure weight and are not asked
for. **A national outline is not a payload a phone should download to render a
sentence.**

**==> AND THAT IS WHY THERE IS NO SPATIAL FILTER. <==** The obvious design is
to ask the service which alerts intersect a storm's box and let the server
match. It would work, and it would cost one round trip PER STORM OPENED for a
feed whose global contents are 8 KB. One cached list shared by every storm is
cheaper, and it moves the matching somewhere `tools/test-cap.mjs` can drive it
offline against real bytes.

### 50.3 Matching — by country, and only for GDACS storms

A CAP row carries `countryCode` as ISO-2. A GDACS storm carries
`affectedcountries`, each entry with `iso2` already on it. The join needs no
lookup table — the two sources happen to speak the same alphabet.

**MEASURED: 63 of 98 rows in the archived GDACS list carry countries.** The
other 35 are out at sea, where no country has issued anything about them, so an
empty answer for those is the truth rather than a gap.

**AN NHC STORM CARRIES A BASIN AND NO COUNTRY, AND WE DO NOT INVENT ONE.**
Deriving a nation from a storm's position would mean this app deciding which
country a storm belongs to. NHC storms are also the only storms whose watches
and warnings we already paint, so the section points those readers at "In
effect" and at the coast rather than reporting an outage (§50.5). That is how
the both-sources rule is met here: the same section, a different true answer.

**A COUNTRY MATCH IS NOT A CAUSAL CLAIM.** PAGASA's alert covers a basin;
Environment Canada's covers the Yukon. The question this answers is "which
agencies covering this storm's countries currently have a cyclone alert out" —
weaker than "this alert is about this storm", and true. §50.5 requires the UI
to word it that way.

### 50.4 Translation — the coded fields only

**==> WE DO NOT MACHINE-TRANSLATE A SAFETY MESSAGE WE CANNOT CHECK. <==** An
alert's `event` and `headline` are the agency's free text in the agency's
language. A mistranslated warning is a worse failure than an untranslated one,
and nothing in this sandbox can verify a translation's quality.

What IS put into English is everything CAP defines as a **code**. Severity,
urgency and certainty come from fixed vocabularies that mean the same thing
whatever language surrounds them, so `lib/cap.js` renders them directly:

- **severity** — Extreme/Severe/Moderate/Minor/Unknown
- **urgency** — Immediate/Expected/Future/Past/Unknown
- **certainty** — Observed/Likely/Possible/Unlikely/Unknown

That yields a real English sentence for every alert on earth with no
interpretation and no risk.

**THE AGENCY'S OWN WORDS ARE BEHIND A CHEVRON, AND ONLY WHEN THEY ARE NOT IN
ENGLISH.** The coded line leads; a disclosure labelled with the language in
English ("Spanish wording") opens the original, verbatim, in a `lang`-tagged
block. **An English alert gets no chevron** — PAGASA writes in English, and
hiding readable text behind a tap would cost the reader the one line that names
the hazard and buy nothing.

**==> THE COST OF THIS LAYOUT, STATED RATHER THAN DISCOVERED LATER. <== The
English line names a SEVERITY AND NOT A HAZARD.** With the wording collapsed, a
Spanish alert reads "Possible threat — expected later, possible" over an agency
and an area, and the only text saying what the alert is *about* is behind the
tap. That is accepted knowingly: the section is titled for alerts inside a
cyclone app, the label names the language, and the alternative — leading with a
sentence the reader cannot read — is worse. **It is also the strongest argument
for a translation pass**, and `tools/test-cap.mjs` asserts the tradeoff so the
day it stops being true is a failing test rather than a forgotten comment.

**EXPANDED STATE IS IN MEMORY AND SURVIVES A REPAINT, NOT A SESSION.** The
drawer's own sections persist because a section is a permanent fixture with a
stable name. An alert expires and is reissued, so a stored key would accumulate
forever and match nothing.

**THE DOM CARRIES A HASH, NEVER THE ALERT KEY.** The key is built from the
agency, event and area — the agency's untranslated words. In a `data-`
attribute they are out of the visible half but still in the markup, which is
the same text somewhere nobody thought about.

**AN UNRECOGNISED CODE IS NAMED, NEVER DROPPED.** CAP may add one; an agency
may mis-set one. Omitting that half of the sentence would leave a reader
thinking an alert had no urgency rather than an unreadable one.

Machine translation is a **separate pass**, not part of this one, and would
ship labelled as machine-translated with the original still visible.

### 50.5 The relay route

`functions/api/cap/alerts.js`. Forward-and-cache, no parameters, the same dumb
sibling `jtwc/abpw.js` is. The `where` clause, the field list and
`returnGeometry=false` live there and nowhere else — splitting a query between
a constant and a route is how half of it gets changed. `ENDPOINT.capAlerts`
records the service so the URL is written down.

**`Storm Surge` IS IN THE `where` CLAUSE AND IT COSTS US NON-TROPICAL ROWS.**
That is what pulls Yukon in. Dropping the term would lose a real storm-surge
warning during a real hurricane, so it stays, and the country join is what
keeps Yukon out of a Philippine storm's panel — asserted in `tools/test-cap.mjs`,
not assumed.

**AN EMPTY ANSWER IS COMMON AND TRUE, AND IS NOT HELD.** Most hours no country
has a cyclone alert in force. This is §45's situation without §45's danger:
there, emptiness could read as "no storm is forming", so that route holds its
last non-empty answer. Here emptiness means "no agency has published one", and
holding would make the route claim an **expired alert is still in force** —
the worse lie of the two. Every row carries its own expiry, which is also why
the stale window is two hours rather than nine: a six-hour-old list is mostly
things that have already ended.

**A COLO CACHE, NOT THE WARM KV STORE.** §45 needed global KV because a cold
colo made its held branch unreachable, and the hold is that feature's whole
point. Nothing is held here, so a cold colo costs one 8 KB fetch.

**ARCGIS REPORTS FAILURE AS HTTP 200 WITH AN `error` BODY.** Read as a feature
list, a refused query becomes an empty one, and an empty one renders as "no
agency has issued an alert" — a false all-clear built out of a server error,
cached for ten minutes. The route answers 502 and forwards the body verbatim so
`data/cap.js` can say unavailable for the real reason.

### 50.6 The three states

Kept apart, per §5, and the distinction is split across two files on purpose:

| State | Means | Decided in |
|---|---|---|
| `unavailable` | the fetch or the parse failed | `data/cap.js` |
| `ok`, empty list | no country anywhere has an alert in force | `data/cap.js` |
| nothing matched | the feed answered; this storm's countries have nothing | `lib/cap.js` |
| no countries | the storm is offshore; there is nothing to look up | `lib/cap.js` |

`readAlerts()` returns **null** for a body it could not read and an **empty
array** for a genuinely empty feed. Collapsing those two — the ordinary
`(json?.features || [])` — is precisely how a refused query becomes a published
all-clear, and `tools/test-cap.mjs` demonstrates that the naive form cannot
tell them apart.

**A FAILURE IS NEVER CACHED CLIENT-SIDE.** Holding an outage for the client
window would outlast its own recovery and leave the retry button doing nothing
visible.

### 50.7 Acceptance cases

1. A GDACS storm affecting the Philippines shows PAGASA's alert, with an
   English sentence built from the codes and PAGASA's own words below it.
2. That same storm shows **no** Environment Canada row. The country join is the
   only thing preventing it.
3. A storm with no affected countries says so — "no country is currently listed
   as affected" — and does not read as a failure.
4. An NHC storm points at "In effect" and the painted coast. It never says
   unavailable.
5. The feed being unreachable says the list did not load **and** says that this
   does not mean no alert is in force.
6. Costa Rica's duplicate renders **once**, showing the row the agency issued
   last — not the more severe one.
7. An alert past its stated expiry does not render at all.
8. A drill, a test and a draft never render. A cancellation renders as text and
   never paints.

### 50.8 A warning, a stand-down and a drill are three different things

Three CAP fields decide whether a row is a warning at all. All three are short
closed-vocabulary strings, and the relay asks for all three.

| Field | Values | What it settles |
|---|---|---|
| `status` | Actual, Exercise, System, Test, Draft | is this a real event or a drill |
| `msgType` | Alert, Update, Cancel, Ack, Error | is it in force or withdrawn |
| `responseType` | …, AllClear, None | is the agency standing down |

**A MISSING `status` COUNTS AS ACTUAL.** CAP's own default. Treating an absent
field as a drill would silently discard live warnings from every agency that
omits it.

**A DRILL IS DROPPED AT THE READ; A CANCELLATION IS KEPT AND TAGGED.** They are
not the same kind of thing. An exercise has no public reader at all, so
`readAlerts()` discards it and no surface downstream can render one. A
cancellation is information somebody watching a departing storm wants — it is
kept, shown as text, and withheld from the paint by `isInForce()`.

**WHY THIS EXISTS.** Costa Rica's institute published `Fin de Influencia de
Onda Tropical` — the tropical wave has passed — tagged `severity: Severe`. With
only the coded severity fields in hand, §50.4's English line renders that as
"Significant threat", which inverts what the agency said. A national exercise
was indistinguishable from a live alert for the same reason.

### 50.9 Severity onto the NHC colour rungs

Foreign alerts paint in the §6 watch/warning colours, chosen by the CAP
`severity` code alone.

| CAP severity | Rung | Colour of |
|---|---|---|
| Extreme | `HWR` | Hurricane Warning |
| Severe | `HWA` | Hurricane Watch |
| Moderate | `TWR` | Tropical Storm Warning |
| Minor | `TWA` | Tropical Storm Watch |
| Unknown, absent | none | not painted |

**BY THE CODE, NEVER BY THE AGENCY'S WORDS.** `event` is free text in the
issuing agency's language with no closed vocabulary behind it, so reading
"warning" out of it is a translation problem in a hundred languages that fails
silently. `severity` means the same thing everywhere.

**WHAT IT COSTS, STATED.** CAP's one axis is danger; NHC's four codes are two
axes, hazard crossed with confidence. The second axis cannot be recovered from
the first, so the severities lie on the rungs in `wwSortKey` order and nothing
claims a foreign Extreme alert **is** a Hurricane Warning. It sits on the same
rung. An unstated severity is not a rung and is not painted — picking one would
mean inventing the only fact the paint depends on.

### 50.10 The shape route

`/api/cap/shapes?ids=…` serves warning areas for alerts already on screen.
Separate from §50.5's text route because geometry is large, wanted only for the
few alerts a reader surfaced, and is the half that can go wrong on size.

**MEASURED:** the attribute query with shapes was 281,336 bytes for three
features — Costa Rica drew its own coastline at 6,585 points. Unsimplified CAP
geometry is not shippable to a phone.

So the service generalises it: `maxAllowableOffset` at 0.01° (~1.1 km) and
`geometryPrecision=4`. **That costs nothing here because the polygon is never
drawn.** It is only ever asked which coastline vertices fall inside it, and the
painted line is the basemap coastline's own geometry at its own detail. The
tolerance is a fifth of §50.11's pad, so simplification can never eat the reach
the pad exists to provide.

Rings arrive as Esri's flat list rather than GeoJSON, deliberately: §50.11
treats every ring as a boundary and needs neither nesting nor winding.

### 50.11 The warning area as a coast selector

**Foreign warnings paint the coast identically to NHC's, because they run
through the same selector.** `selectRuns` never asked for a corridor — it asks
for `{inBand, toXY, bbox}`. `corridor()` builds that by fattening NHC's
breakpoint lines, which have no width. A CAP alert arrives **as** a shape, so
`areaBand()` skips the fattening and answers the same question about the
polygon directly. Same runs, same tile-edge filter, same coastline geometry.
The two stripes are identical by construction, not by two pieces of drawing
code being kept in step.

**THE AREA IS DILATED BY `COAST_BAND.areaPadKm` (5 km) RATHER THAN USED AS
DRAWN.** A CAP area states jurisdiction, drawn against the agency's basemap,
not ours. Where their outline runs slightly inland, the true shoreline falls
outside it and a strict inside-test paints nothing along exactly the coast the
warning is about. Two coastline datasets also disagree by a few hundred metres
where both are right. The test is "inside **or** within the pad of the
boundary" — the same distance-to-segment arithmetic the corridor already does,
without the flat caps, because a closed ring has no ends.

**THE ERROR IS OUTWARD.** For a warning, over-inclusion is the safe way to be
wrong; the opposite failure is a warned coast left unpainted, which §5 calls
the worst outcome in the app. The pad is an order of magnitude under the NHC
corridor's 50 km, and that asymmetry is the point: 50 km over-reaches around a
line carrying no area of its own, while here the area is published and the pad
has one job.

Inside-ness is an even-odd crossing count over every ring, so holes come free
and winding direction never matters.

**UNJUDGED.** Nothing has been on glass with a live foreign warning. Open
questions: whether a whole-country area paints far more coast than reads well
(the Philippines is 7,600 islands; Costa Rica gets both coasts), and whether
that volume meets `COAST_BAND.maxBandVertices`. `areaPadKm` is the dial if the
stripe undershoots at a river mouth or an offshore island.
9. A Spanish alert arrives with its wording COLLAPSED and the English coded
   line visible. Tapping the chevron opens it; the chevron rotates and nothing
   else on the panel moves.
10. An English alert has no chevron at all — its wording is simply there.
11. The disclosure is reachable by Tab, opens on Enter or Space, shows a focus
    ring, and reports its state through `aria-expanded`.

### 50.12 Coverage is the storms we list, and an unattributed storm says so

**LANDFALL COVERS STORMS NHC, JTWC OR GDACS LIST. SETTLED, NOT A GAP TO
CLOSE.** Aaron's call, 2026-08-19. The CAP feed is worldwide, so it carries
alerts for systems none of those three centres carries — PAGASA names
depressions and invests inside its own area, and on 2026-08-19 had a Tropical
Cyclone Alert out for "Tropical Depression Neneng", which appears in no storm
list this app reads. Such an alert has nowhere to attach and is not shown.

The alternative was rejected on identity, not effort. Adopting a national
centre's naming means a system can exist here under a name no other centre
uses, then acquire a second name when JTWC picks it up — two rows, or a rename
mid-storm. That is the ghost-storm failure §5 already guards against. Systems
that have not become storms yet have a home already: §45's genesis outlook.

**AND THE ALERT'S OWN GEOMETRY ARGUES THE SAME WAY.** The archived PAGASA
polygon is a seven-vertex box spanning 113°–130°E and 5°–21°N. Both candidate
invests that hour — 94W at 23.0°N 126.7°E and 95W at 19.5°N 111.8°E — fall
**outside** it. The published area does not contain the system it is about,
which is what "jurisdiction, not hazard" means in coordinates. Weigh that when
judging §50.11's stripe on glass: it bands a shape that was never drawn to say
where the danger is.

**SO THE JOIN'S ONE REMAINING FAILURE IS AN ATTRIBUTION LAG, AND IT IS
MEASURED.** §50.3 matches through GDACS's `affectedcountries`. Among the three
storms actually live on 2026-08-19 exactly one carried a country, and it was the
American one; the other two carried none in every hourly snapshot across the
window. The reassuring figure previously written here — 63 of 98 rows carry
countries — counts a list that is mostly *ended* storms, which is where
attribution accumulates.

`tools/archive-fetch.mjs` writes a `countryMatch` block into the archive
manifest every run: each live storm's ISO-2 codes, episode and position, every
country with an alert in force, and the alert countries no live storm carries.
It rides in the manifest because that is the one file carried into `history/`.
A country that sits in `unmatchedAlertCountries` for some hours and then
attaches to a storm was a lag; one that never attaches was a system we do not
cover, which is the decision above rather than a defect.

**AN UNATTRIBUTED STORM GETS ONE SENTENCE AND IT STOPS WHERE OUR KNOWLEDGE
STOPS.** *No country is listed as affected by this storm yet.* Nothing follows
it. The clause it replaced — "so there are no national alerts to look up" — is
an ANSWER, and the state is unavailable rather than none-matched (§5). The word
"yet" carries the whole distinction.

**IT DOES NOT COUNT ALERTS ELSEWHERE ON EARTH, AND THAT IS DELIBERATE.** A
build that did so put a global fact on a per-storm surface: with alerts out in
three countries, every unattributed storm anywhere would announce a gap,
including storms nowhere near any of them. It diluted the one case that matters
and edged toward the causal claim §50.5 forbids. The sentence is identical
whether the rest of the world is quiet or not, and `tools/test-cap.mjs` asserts
those two renders are byte-identical.

## 51. Storm surge outside America — modelled water at named towns

### 51.1 The product, and the one that is not it

**==> THE THING CALLED `cyclonesurge` IN THE GDACS API IS NOT THE SURGE
FORECAST. <==** Measured off the archive branch 2026-08-19, three live storms.
The event record carries a `cyclonesurge` index — three models, one row per
bulletin, each flagged `last` and `overall`. Every row resolves to a
`getdetails` card that arrives with `geometry: null`, `bbox: null`, one headline
`maxheight`, and links. **No places in it and no shapes in it.**

**The product with the answer hangs off `impacts` on the same record:
`getlocations`.** One export per storm, model-agnostic, and already aggregated
across every bulletin — "Simulation based on Bulletins 1-29", read verbatim out
of Lala's header. That is what `/api/gdacs/surge` fetches, and it is why its
first hop is `geteventdata` rather than anything with "surge" in its name.

**The shape, per town:**

| Field | Meaning | Note |
|---|---|---|
| `city` | the town | **absent on the header feature** — that is the test that separates them |
| `country` | the country | "Northern Mariana Islands", "United States" |
| `maxheight` | modelled water height, **metres**, as a string | `"0.48"`. `-1` is a sentinel for "not computed" |
| `timearrival` | **hours from bulletin 1**, `"87:00"` | not a clock time |
| `timemaxh` | hours from bulletin 1 to the peak | `"93:00"` — six hours of rising |
| `latitude` / `longitude` | the town, six decimals | padded strings |

**Every export opens with a header feature that is not a town.** It sits at the
storm's own position with `city: null` and a blob of simulation metadata. Kept,
it renders as an unnamed place in the ocean with no height. Hernán's export is
**the header alone**, which is why the `city` test is the right one and "the
first feature is metadata" would have been right by accident.

**`overall` on the surge index is the event aggregate. Confirmed, not
inferred.** Every model group carries exactly one `overall: true` row, always
`bulletinid: "0"`, its `episodedate` equal to the newest bulletin's, and its
figures are running maxima — Lala's overall rain 831 mm against bulletin 15's
328, Hernán's overall wind 31 m/s against 17. Recorded because the question was
open; the app does not read these cards.

**==> THE TWO PRODUCTS DISAGREE AND ONLY ONE MAY REACH A SCREEN. <==** Lala's
`getlocations` header states 0.17 m at Hookena as the worst **populated** place;
its ECMWF card states `maxheight: 0.330424815416`. Both are true of different
questions. The route serves the towns and never the card's number.

**==> THE HEIGHTS ARE SUB-METRE AND THAT GOVERNS THE DESIGN. <==** The whole
archive: Lala's worst populated place 0.17 m, Saudel's 0.48 m, Hernán none.
Lala's entire 47-town spread is 0.10 to 0.17 — seven centimetres end to end.

Two things follow and neither is a style choice.

1. **NHC's ramp may never be reused.** `SURGE_RAMP`'s bottom rung is "up to
   3 ft" ≈ 0.91 m, so every observation this product has ever made lands in it.
   Painted on that ramp, every storm outside America renders the same blue for
   ever and a reader correctly concludes from the globe that surge only happens
   in America. §6 says a red band means one thing everywhere; keeping that
   promise here needs a ramp of our own. `GDACS_SURGE.thresholdsM` and
   `GDACS_SURGE_RAMP`, teal through magenta, deliberately a different hue
   family so the two cannot be mistaken for one scale.
2. **The figure outranks the colour.** At this scale a bucket says almost
   nothing. Every surface shows the height itself, in the reader's own units,
   through `formatSurge` — the app's one surge formatter, fed metres converted
   at this boundary rather than a second formatter that rounds differently.

**==> AND THE DATUMS HAVE NOT BEEN CONFIRMED TO MATCH. <==** NHC publishes
inundation **above ground level**. What the JRC model reports its height above
is not stated in any byte this project has read. Until somebody confirms it,
putting the two numbers on one scale asserts an equivalence nobody checked.

**==> `aoi_surge` IS NOT A SURGE FOOTPRINT. READ 2026-08-19, SETTLED, DO NOT
RE-ASK. <==** The surge card carries an `aoi` list and one storm of three had an
`aoi_surge` entry in it — checked twice an hour apart, Saudel both times. Both
its payloads were fetched. They are an affected-PLACES export: 52 features made
of one city, seven provinces, twenty-one urban areas and their contours, plus
two raw geometry rows. Seven carry `geometry: null`. **`intensity` is `1` on
every feature**, so it states no severity, and **not one of its twenty property
keys is a height, a surge, a water level or a depth.** Its two real shapes are a
432-vertex outline over Korea and Honshu and a five-vertex box spanning
123.9°E–169.2°E — a model domain, not a hazard.

**And the places do not match the surge.** It names Korea, Japan and the
Philippines for a storm whose `getlocations` export names the Northern Mariana
Islands. Two products about one storm naming different countries. Drawing that
outline as surge would paint Korea and Japan flooded on evidence that says
nothing about water depth, while omitting the only two places GDACS modelled
water for. The derivation that fetched it has been deleted; the reason is
recorded in `tools/archive-fetch.mjs` beside `surgePicks`.

### 51.2 The relay route

`/api/gdacs/surge?eventid=` — `functions/api/gdacs/surge.js`. Two hops:
`geteventdata` for the record, then the `locations` URL off its `impacts`.

**Only a `https://www.gdacs.org/` URL is ever followed.** This route takes an
event id from the open internet and then fetches a URL found inside somebody
else's JSON. Without the host test it is a request forwarder pointed at any
host a compromised upstream cares to name.

**Towns are sorted deepest-first and capped at `GDACS_SURGE.maxPlaces` (60).**
Lala returned 47 and 27 KB — fine on the wire, impossible on a screen, and 47
overlapping corridors along one island chain on the map. `placeCount` carries
the count **before** the cap.

**==> `-1` AND AN EMPTY LIST ARE TWO DIFFERENT ANSWERS AND NEITHER IS AN ERROR.
<==** A card with no `locations` key, or an export holding only its header, is
`none_matched`: the model ran and found nobody. Hernán, mid-Pacific. A fetch
that fails is `unavailable`. Collapsing them puts "no surge expected" under a
house during an outage, which is the §5 failure the app is built against.

**Cache: fresh 1 h, last-good 12 h.** A JRC run is redone per bulletin at best
— Lala's ECMWF index sat at bulletin 15 while its GFS index sat at 29 at the
same instant — and nothing in this payload expires.

**It works on both sources, which is the point.** Lala is NOAA-sourced and
returned 47 towns; Saudel is JTWC-sourced and returned two. The export is
structurally identical across them — same twelve keys, same header, same
description grammar — so there is one parser.

### 51.3 Surge at the house — the home dashboard section

`ui/surge-home.js`, under Rain and above the figures. The two water sections
sit together; Rain is first because it reaches every house on Earth and this
only reaches coastal ones.

**Four states, and only one is an all-clear (§5).**

| State | Means | Retry? |
|---|---|---|
| `ok` | a town within `GDACS_SURGE.homeRadiusKm` has a height | — |
| `out_of_range` | towns exist, none near this house. **A fact about the house.** | no |
| `none_matched` | the model found no populated place at all. **A fact about the storm.** | no |
| `unavailable` | the fetch failed | yes |

**==> `out_of_range` IS NOT SAFETY AND MUST NEVER READ AS ONE. <==** It means
nobody modelled the water here, not that the house is dry. The section says so
in as many words and names the deepest town elsewhere on the storm, because an
absence with no figure beside it reads as an all-clear.

**The radius is mandatory and Kauai is why.** Lala modelled the Big Island (41
towns), Maui and Molokai (4) and Oahu (2) — and **not Kauai**. Nearest with no
ceiling hands a Lihue house a town 150 km away across open ocean and prints it
as that house's forecast. 50 km is about an hour's drive and inside one
island's coast.

**Nearest, then the ceiling — never "the deepest within the radius".** A reader
asking what happens at their house is asking about their house; handing them a
worse number from further away because it is scarier is inventing a forecast.

**The deepest town elsewhere is named only when it is a different rung.** The
first rule compared against `negligibleM`, which borrowed a constant meaning
"too small to print" to answer "too small a difference to mention" — and at
this scale silenced the line on every storm in the archive. If the deepest town
shares this house's colour it is the same story.

**No clock times.** The offsets are hours from bulletin 1, whose publication
time this route does not carry. `arrivalMs` stays null without a supplied base;
what the section says instead is the **spread** — "it keeps rising for about
six hours after it first arrives" — because a clock time from a guessed base is
a confident wrong answer about when somebody's street floods.

**The provenance line names the modeller and says "modelled".** Both halves are
load-bearing: the modeller, because a reader comparing an American storm's feet
against this storm's centimetres has to see they are two products; and
"modelled", because this is a simulation output rather than a forecaster's
warning, and stating water depth at somebody's address in an official warning's
voice would overclaim.

### 51.4 The coastal layer

`map/layers/gdacs-surge-coast.js`. Joins the `coastal` pair's **SURGE** segment
— `surge.js` is the NHC half of that same segment. **No second switch**: a
reader who taps Surge means surge, and a "global surge" option would ask them
to know which agency models their coast before they can turn on the thing that
tells them.

**==> THE INPUT IS POINTS, AND EVERY METRE OF COAST PAINTED AROUND ONE IS OURS
RATHER THAN THE MODEL'S. <==** NHC publishes a **reach** — a named stretch of
coast that IS the subject of the forecast — so fattening its breakpoint chord
reconstructs geometry NHC meant. GDACS publishes a **town** and a number. So
`GDACS_SURGE.bandHalfWidthKm` is 5 km against surge's 8 and watch/warning's 50:
enough to reach the shoreline the town sits on, not enough to claim anything
about the next bay. `pointRingDeg` makes the point a ring `areaSelect` can take;
the pad is what sets the reach.

**==> NOTHING IS INTERPOLATED BETWEEN TOWNS, AND A COAST THAT JOINS UP DOES SO
BY OVERLAP RATHER THAN BY DRAWING. <==** A continuous ramp from one town's
height to the next was the first design and was rejected before it was written:
Hookena reads 0.17 and Hilo 0.13, and a value drawn between them is a forecast
the JRC never made for ground it never ran on. Each town paints its own
shoreline; where two corridors overlap the deeper wins on the sort key. Nothing
in this file ever states a height for a stretch of coast no town reports.

**==> AT 5 km THE STRIPES DO NOT JOIN, AND THAT IS THE OPEN DEFECT. <==**
Measured on Lala's 47 towns, 2026-08-19: median distance to a nearest
neighbour **3.8 km**, worst **24.2 km**. A 5 km half-width reaches 10 km, and
single-link chaining at 10 km joins **8 of 47** — the towns are clumped rather
than evenly spread, so the result is several short disconnected fragments and
isolated stubs down one island. The fix and its measurements are in
`SPEC-NEXT.md` §51.7. **This paragraph describes what ships today; it is not a
description of what the layer should look like.**

**Deepest on top**, via `line-sort-key` — Shomushon and Marasu are 3.7 km apart
and share coastline at this corridor width, and where two heights overlap the
reader must see the deeper. Same §6 contract `surge.js` enforces with
`fill-sort-key`.

**No fallback geometry.** `surge.js` keeps NHC's delivered chord when a reach
fails to band, because official geometry is not ours to discard. Here the
delivered geometry is a **point**, and a dot in the sea off a coastline we could
not load is not a lesser version of the answer — it is a different and worse
claim. No coast means no feature; the section beside it words that honestly.

**There is no better geometry to fall back from, and that is now measured
rather than assumed.** `aoi_surge` was the only candidate and it is an
affected-places list with no height in it (§51.1). Town bands are not a stand-in
for a footprint this product declines to publish — they are the whole of what it
publishes, drawn honestly. **Nothing here waits on a better source.**

### 51.5 The hole this feature has, stated plainly

**Every storm in an NHC basin reaches this app without a GDACS event id, so
this feature cannot see it.** `mergeStorms` (`data/merge.js`) drops the GDACS
twin of any storm whose basin NHC covers, which is the right dedupe rule. It
costs something real: GDACS modelled 47 Hawaiian towns for Lala, a Central
Pacific storm, and neither the section nor the layer can reach them.

**What covers the gap today is NHC's own product** (§4.8, §36) — the better
forecast where it publishes, and it only answers while a US surge watch is in
force. So on an American storm with no surge watch out, there is a real answer
sitting in GDACS that nothing renders.

**Closing it means joining an NHC storm to a GDACS event id by NAME**, which is
the same class of join §50.12 is currently measuring for CAP alerts and is not
free. Decide it there, with that evidence, rather than writing a second
name-matcher here.

`gdacsEventIdOf()` in `lib/surge-locations.js` is the one place the mapping
lives, and `tools/test-surge-locations.mjs` asserts that an NHC storm yields
null — so the day somebody closes this gap, that line is what has to change.

