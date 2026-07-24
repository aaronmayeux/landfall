# spec-parameter.md — Landfall data reference

**What this is.** A complete, offline-usable record of every field the two storm
feeds actually publish, what each field really means, and how Landfall displays
it today. It exists so development can continue from a phone, with no network
and no ability to re-probe the sources. Everything here was measured from the
live feeds, not remembered.

**Companion to SPEC.md, not a replacement.** SPEC.md says what the app is and how
it behaves. This file says what the *data* is. When a field's meaning changes at
the source, this file changes.

**Rule for this document: every claim is measured or it is marked.** Anything not
observed directly carries `[UNVERIFIED]`. Nothing here is inherited from the HA
project.

---

## 0. Snapshot conditions

All observations in this document come from one continuous live audit.

| | |
|---|---|
| **Audit run** | 2026-07-24, approx. 21:00–21:40 UTC |
| **NHC feed state** | 2 active storms, advisory issuance `2026-07-24T21:00:00.000Z` |
| **GDACS feed state** | 4 active TC events |
| **Method** | Direct browser fetch from each source's own origin (no relay, no proxy) |

**The four storms this document is built on.** They are a good sample by luck:
two are in NHC's basins and two are not, they span TD → Cat 2, one is brand new
(episode 2) and one is already dying, and one is outside NHC coverage entirely.

| Storm | Source(s) | NHC id | GDACS id | State at snapshot |
|---|---|---|---|---|
| **Fausto** | NHC + GDACS | `ep062026` | `1001289` | Hurricane, 90 kt, Cat 2, open East Pacific |
| **Genevieve** | NHC + GDACS | `ep072026` | `1001296` | Tropical Storm, 40 kt, brand new (GDACS episode 2) |
| **Noul** | GDACS only | — | `1001294` | Typhoon, NW Pacific, near Luzon/Taiwan |
| **Bertha** | GDACS only | *(dropped)* | `1001295` | Tropical Depression, inland over Texas. **NHC has already removed it; GDACS still lists it.** |

Bertha is the important one. It is a live example of the ghost-storm case: a
storm that leaves the NHC feed while GDACS keeps publishing it.

---

## 1. The headline question: does GDACS give current wind?

Aaron asked this directly. The answer is **yes, but not where you would look for
it, and the obvious field is a trap.**

### 1.1 The trap — `severitydata.severity` is NOT current wind

The GDACS event list publishes exactly one wind-shaped number per storm:
`properties.severitydata.severity`, in km/h. It is tempting because it is the
only number on offer. **It is the maximum wind over the storm's entire forecast
track**, and using it as current intensity draws every storm at its forecast peak.

This is not an inference. It was proven by arithmetic against NHC's own forecast:

```
GENEVIEVE-26
  GDACS severitydata.severity ............ 203.7024 km/h
  NHC current intensity (tau=0) ..........  40 kt      = 74.07 km/h
  NHC max maxwind across all forecast taus 110 kt

  110 kt x 1.85184 km/kt = 203.7024 km/h    <-- exact match, to four decimals
```

GDACS converts knots at **1.85184 km/kt** (the international nautical mile),
not the 1.852 the app uses elsewhere. The match is exact, so the identity is
established, not guessed: **`severity` = `max(maxwind over forecast) x 1.85184`.**

The second storm confirms the mechanism rather than contradicting it:

```
FAUSTO-26
  GDACS severitydata.severity ............ 166.6656 km/h  = 90.0 kt
  NHC current intensity (tau=0) ..........  90 kt
  NHC max maxwind across all forecast taus  90 kt   (forecast is steady weakening)
```

Fausto's `severity` equals its current wind **only because it is at its lifetime
peak right now and forecast to weaken.** That coincidence is exactly what makes
this field dangerous: on a mature storm it looks correct, and on a strengthening
storm it is off by 70 kt.

The `severitytext` prefix disagrees with its own parenthetical for the same
reason — the prefix is the classification *now*, the number is the peak *later*:

```
"Tropical Storm (maximum wind speed of 204 km/h)"     <- Genevieve. TS now, Cat 3 later.
```

**Never use `severity` as current wind. It is a forecast peak. The app is
correct to store it as `peakWindKt` and to leave `windKt` null.**

### 1.2 The real current wind, source A — timestepped wind-radii polygons

The GDACS per-event geometry payload contains **two different kinds of
green/orange/red polygon**, and they are easy to confuse:

| kind | `featuretype` | `polygonlabel` | `key` | what it is |
|---|---|---|---|---|
| aggregate swath | *(absent)* | `"60 km/h"` / `"90 km/h"` / `"120 km/h"` | *(absent)* | one merged corridor for the **whole track**, past and forecast |
| **timestepped** | `"WindRadii"` | `"24/07 21:00"` | `"07242100"` | the wind footprint **at one specific time** |

The timestepped set is the useful one. Each timestep publishes up to three
nested footprints at 60, 90 and 120 km/h, and **the first key in the sorted set
is the current analysis time**. Testing whether the storm centre falls inside
each of those three polygons brackets the current wind into a range.

Measured, all four storms, against NHC ground truth where it exists:

| storm | 60 km/h | 90 km/h | 120 km/h | implied current wind | NHC truth | verdict |
|---|---|---|---|---|---|---|
| Genevieve | in | out | out | 60–90 km/h = **32–49 kt** | **40 kt** | correct |
| Fausto | in | in | in | ≥120 km/h = **≥65 kt** | **90 kt** | correct |
| Noul | in | in | in | ≥120 km/h = **≥65 kt** | *(no NHC)* | consistent with "Typhoon" |
| Bertha | out | out | out | <60 km/h = **<32 kt** | *(dropped)* | consistent with "Tropical Depression" |

Four for four. **This is a validated current-wind estimator, it is already in a
payload the app fetches, and it costs no extra request.**

Note the ceiling: 120 km/h is 65 kt, which is only the Cat 1 floor. This method
can say "at least Cat 1" but can never distinguish Cat 1 from Cat 5. That limit
belongs to GDACS, not to us.

### 1.3 The real current wind, source B — an exact number, buried

`geteventdata` → `properties.impacts[0].resource.locations` returns a GeoJSON
whose feature `description` is a human-readable block that contains a genuine
current wind number:

```
Latitude = 19.7
Longitude= 120.4
Hurricane name = NOUL-26
Hurricane ID = 1001294
Basin = NW Pacific
Bulletin No = 6
Simulation based on Bulletins 1-6
Maximum water height (m)   1.83 on location Jiesheng
Advisory wind velocity (m/s) 30 cathegory 0
Maximum wind velocity (m/s) 43 cathegory 2
Date of max. wind velocity  24 Jul 2026 12:00:00
Bulletin of max. wind velocity 6
Grid size of last simulation (min) 0.5
Time (hh:mm) based on publication date 23 Jul 2026  06:00:00 of Bulletin No. 1
Date of Simulation 24 Jul 2026 16:39:22
```

`Advisory wind velocity (m/s)` is the current advisory wind. It validates
exactly:

```
FAUSTO-26  GDACS "Advisory wind velocity (m/s) 46 cathegory 2"
           NHC    90 kt = 46.30 m/s, ssnum = 2
```

Same number, same category. But four caveats make this a secondary source, not
a primary one:

1. **It can be missing.** Genevieve (Bulletin No. 1) has no `Advisory wind
   velocity` line at all — only a `Maximum wind velocity`. New storms, the ones
   where the peak-vs-current gap is widest, are exactly the ones that lack it.
2. **It lags.** It tracks the surge-model bulletin, not the event episode. Noul
   was on event episode 7 while this product was still on bulletin 6.
3. **The payload size is unpredictable and sometimes brutal.** Measured in this
   run: Fausto 1,089 bytes, Genevieve 1,083 bytes, Noul 237,185 bytes,
   Bertha 306,996 bytes. Size scales with coastal exposure — the storms that
   matter most are the most expensive to ask about. A 300 KB fetch on a phone
   for one wind number is not a trade this project makes.
4. **It is string-scraped out of an HTML-ish blob**, not read from a field. It
   will break without warning.

`cathegory` is GDACS's spelling, not a typo in this document. The values are
Saffir-Simpson indices where 0 = below Cat 1.

### 1.4 The real current wind, source C — the track segment label

Every `Line_*` feature in the geometry payload carries `polygonlabel` set to an
intensity **class code** (`TD`, `TS`, `HU`) and a `forecast` boolean. The
segment that ends at the current centroid gives the current class. Coarse — three
buckets — but authoritative, free, and already parsed.

### 1.5 Recommendation

Use **1.2 (timestepped wind radii)** as the primary GDACS current-wind read. It
is validated 4/4, needs no extra request, and produces an honest range rather
than a fake point value. Use **1.4** as the classification. Treat **1.3** as an
opportunistic exact number only when the payload is already in hand — never
issue a request purely to get it. Never use **`severity`** for anything but
`peakWindKt`.

---

## 2. NHC `CurrentStorms.json`

- **URL:** `https://www.nhc.noaa.gov/CurrentStorms.json`
- **CORS:** blocked. Must go through the relay (`/api/nhc/storms`).
- **Shape:** `{ activeStorms: [ ... ] }` — one top-level key, nothing else.
- **Coverage:** Atlantic, East Pacific, Central Pacific only.

### 2.1 Scalar fields — the whole list

Values shown are the live pair `Fausto ~ Genevieve`.

| field | type | example | notes |
|---|---|---|---|
| `id` | string | `"ep062026"` ~ `"ep072026"` | lowercase basin+num+year. The stable key. |
| `binNumber` | string | `"EP1"` ~ `"EP2"` | MapServer slot. Drives all geometry layer math. |
| `name` | string | `"Fausto"` ~ `"Genevieve"` | bare name, no "Hurricane" prefix |
| `classification` | string | `"HU"` ~ `"TS"` | see §2.3 |
| `intensity` | **string** | `"90"` ~ `"40"` | **KNOTS. Quoted string, not a number.** |
| `pressure` | **string** | `"967"` ~ `"1001"` | **millibars. Quoted string.** |
| `latitude` | string | `"18.7N"` ~ `"9.2N"` | display form; do not parse |
| `longitude` | string | `"132.7W"` ~ `"101.9W"` | display form; do not parse |
| `latitudeNumeric` | number | `18.7` ~ `9.2` | **use this** |
| `longitudeNumeric` | number | `-132.7` ~ `-101.9` | **use this**, already signed |
| `movementDir` | number | `275` ~ `290` | degrees true, direction of travel |
| `movementSpeed` | number | `15` ~ `13` | **KNOTS** |
| `lastUpdate` | string | `"2026-07-24T21:00:00.000Z"` | ISO 8601 UTC |
| `windWatchesWarnings` | object\|null | `null` ~ `null` | **null when none in effect** |
| `stormSurgeWatchWarningGIS` | object\|null | `null` ~ `null` | null on both live storms |
| `potentialStormSurgeFloodingGIS` | object\|null | `null` ~ `null` | null on both live storms |
| `peakSurgeKML` | object\|null | `null` ~ `null` | null on both live storms |

**`intensity` and `pressure` are strings.** They must go through the numeric
coercion helper. A raw comparison against a number silently fails.

### 2.2 Product objects — 13 of them, five distinct shapes

None of these carry storm data. They are pointers to advisory text and GIS
bundles, grouped here by identical sub-key signature.

| sub-keys | members |
|---|---|
| `advNum, issuance, fileUpdateTime, url` | `publicAdvisory`, `forecastAdvisory`, `windSpeedProbabilities`, `forecastDiscussion`, `forecastGraphics` |
| `advNum, issuance, fileUpdateTime, zipFile, kmzFile` | `forecastTrack`, `trackCone`, `initialWindExtent`, `forecastWindRadiiGIS` |
| `issuance, fileUpdateTime, zipFile, kmzFile` | `bestTrackGIS` |
| `advNum, issuance, fileUpdateTime, kmzFile` | `earliestArrivalTimeTSWindsGIS`, `mostLikelyTimeTSWindsGIS` |
| `issuance, fileUpdateTime, zipFile5km, zipFile0p5deg, kmzFile34kt, kmzFile50kt, kmzFile64kt` | `windSpeedProbabilitiesGIS` |

**`advNum` is a zero-padded string** — `"024"`, `"002"`. Intermediate advisories
take the form `"5A"`. It must never be parsed as an integer: `"017"` → `17`
breaks every cache key built from it.

### 2.3 `classification` codes

Confirmed live in this feed: `HU` (Fausto), `TS` (Genevieve).
Confirmed live in MapServer `stormtype`: `HU`, `TS`, **`MH`** (Major Hurricane —
appears on Genevieve's forecast points at tau 60/72/96).

The rest are from NHC's published set and remain `[UNVERIFIED]` by direct
observation: `TD`, `SD`, `SS`, `STD`, `STS`, `PTC`, `PT`, `EX`, `LO`, `DB`, `WV`.

### 2.4 What this feed does NOT contain

- **No final-advisory flag.** There is no field anywhere saying "this is the last
  advisory." A storm simply stops appearing. Ghost-storm wording must therefore
  always be the cautious form.
- **No Saffir-Simpson number.** Category must be derived from `intensity`.
  (MapServer *does* publish it as `ssnum` — see §3.3.)
- **No wind radii numbers.** Those live in MapServer only.
- **No track history and no forecast.** Geometry is MapServer only.

---

## 3. NHC MapServer

- **Base:** `https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer`
- **CORS:** open. Direct browser fetch, no relay.
- **Service:** `Tropical Weather`, **400 layers**, `maxRecordCount` 2000.

### 3.1 Layer block arithmetic — confirmed

```
layer id = blockStart + (slot - 1) * 26 + offset

blockStart:  AT = 4      EP = 134     CP = 264
stride:      26 layers per storm slot
slots:       5 per basin  (AT1-AT5, EP1-EP5, CP1-CP5)
```

Confirmed this run: EP1 begins at 134, EP2 begins at 160. 160 − 134 = 26. The
stride is right.

### 3.2 The 26-layer block, as actually observed (EP1, base 134)

| offset | id | name |
|---|---|---|
| +0 | 134 | `EP1` *(group)* |
| +1 | 135 | `EP1 Forecast Information` *(group)* |
| +2 | 136 | `EP1 Forecast Points` |
| +3 | 137 | `EP1 Forecast Track` |
| +4 | 138 | `EP1 Forecast Cone` |
| +5 | 139 | `EP1 Watch-Warning` |
| +6 | 140 | `EP1 Past Track Infomation` *(group — NOAA's typo, not ours)* |
| +7 | 141 | `EP1 Past Points` |
| +8 | 142 | `EP1 Past Track` |
| +9 | 143 | `EP1 Past Cumulative Wind Swath` |
| +10 | 144 | `EP1 Past Wind Radii` |
| +11 | 145 | `EP1 Wind Information` *(group)* |
| +12 | 146 | `EP1 Forecast Wind Radii` |
| +13 | 147 | `EP1 Advisory Wind Field` |
| +14 | 148 | `EP1 Arrival Time of TS Winds` |
| +15 | 149 | `EP1 Earliest Reasonable Arrival Time` |
| +16 | 150 | `EP1 Most Likely Arrival Time` |
| +17 | 151 | `EP1 Inundation and Tidal Mask` *(group)* |
| +18 | 152 | `EP1 Inundation` |
| +19 | 153 | **`Boundary_Inun_EP1`** |
| +20 | 154 | **`Footprint_Inun_EP1`** |
| +21 | 155 | **`Image_Inun_EP1`** |
| +22 | 156 | `EP1 Tidal Mask` |
| +23 | 157 | **`Boundary_TMask_EP1`** |
| +24 | 158 | **`Footprint_TMask_EP1`** |
| +25 | 159 | **`Image_TMask_EP1`** |

**Trap, measured this run.** Six of the 26 layers do **not** carry the `EP1 `
name prefix — they use a `_EP1` **suffix** instead. Any name-matching that
assumes every layer in the block starts with the bin will find 20 layers, not 26,
and silently miss the raster sublayers. The block is still 26 ids wide; only the
naming convention breaks. Matching inside `[base, base+26)` remains correct.

### 3.3 `Forecast Points` (offset +2) — the richest layer in the service

Fields: `objectid, stormname, stormtype, dvlbl, basin, advdate, advisnum,
fcstprd, gust, maxwind, mslp, ssnum, datelbl, tcdvlp, tcdir, tcspd, fldatelbl,
lat, lon, stormnum, stormsrc, tau, timezone, validtime, idp_source,
idp_filedate, idp_ingestdate, binnumber`

Live, Fausto (EP1), all nine forecast points:

| tau | validtime | stormtype | maxwind | gust | mslp | ssnum | tcdir | tcspd |
|---|---|---|---|---|---|---|---|---|
| 0 | `24/1800` | HU | 90 | 110 | 967 | 2 | 275 | 13 |
| 12 | `25/0600` | HU | 85 | 105 | **9999** | 2 | **9999** | **9999** |
| 24 | `25/1800` | HU | 80 | 100 | **9999** | 1 | **9999** | **9999** |
| 36 | `26/0600` | HU | 75 | 90 | **9999** | 1 | **9999** | **9999** |
| 48 | `26/1800` | HU | 70 | 85 | **9999** | 1 | **9999** | **9999** |
| 60 | `27/0600` | HU | 65 | 80 | **9999** | 1 | **9999** | **9999** |
| 72 | `27/1800` | TS | 60 | 75 | **9999** | 0 | **9999** | **9999** |
| 96 | `28/1800` | TS | 45 | 55 | **9999** | 0 | **9999** | **9999** |
| 120 | `29/1800` | TS | 35 | 45 | **9999** | 0 | **9999** | **9999** |

Live, Genevieve (EP2) — the intensifying case:

| tau | stormtype | maxwind | gust | ssnum |
|---|---|---|---|---|
| 0 | TS | 40 | 50 | 0 |
| 12 | TS | 45 | 55 | 0 |
| 24 | TS | 55 | 65 | 0 |
| 36 | HU | 75 | 90 | 1 |
| 48 | HU | 90 | 110 | 2 |
| 60 | **MH** | 100 | 120 | 3 |
| 72 | **MH** | 110 | 135 | 3 |
| 96 | **MH** | 110 | 135 | 3 |
| 120 | HU | 95 | 115 | 2 |

Key facts, all measured:

- **`9999` is the missing-value sentinel.** It appears on `mslp`, `tcdir` and
  `tcspd` at every tau beyond 0. It is a real number in the JSON — an unguarded
  read renders a storm moving at 9999 kt.
- **`maxwind`, `gust` and `ssnum` are valid at every tau.** No sentinel. This is
  a complete intensity forecast curve, in knots, plus NHC's own Saffir-Simpson
  index. `ssnum` is *reported*, not derived — better provenance than deriving
  category from knots.
- **`ssnum` is offset from the Cat number**: `ssnum` 0 = TD/TS, 1 = Cat 1,
  2 = Cat 2, 3 = Cat 3. It is a Saffir-Simpson category, so 0 means "below
  hurricane strength", not "Cat 0".
- **`lat` and `lon` attribute fields are rounded to whole degrees.** Fausto's
  attributes read `lat: 19, lon: -133` while the feature geometry reads
  `x: -132.6999…, y: 18.6999…`. **Use the geometry. Never the lat/lon fields.**
  At this latitude the rounding error is up to ~30 nm.
- `stormtype` carries `MH` for major hurricanes, a code absent from
  `CurrentStorms.json`.
- `dvlbl` is the single-letter map label (`H`, `S`, `D`, `M`).

### 3.4 Remaining data layers — field lists

**`Forecast Track` (+3)** — `objectid, stormname, stormtype, basin, advdate,
advisnum, fcstprd, stormnum, idp_source, idp_filedate, idp_ingestdate,
st_length(shape), binnumber`

**`Forecast Cone` (+4)** — same as Forecast Track, with `st_area(shape)` and
`st_perimeter(shape)` in place of `st_length(shape)`

**`Watch-Warning` (+5)** — `objectid, stormname, stormtype, basin, advdate,
advisnum, fcstprd, stormnum, **tcww**, idp_source, idp_filedate, idp_ingestdate,
st_length(shape), binnumber`
`tcww` is the watch/warning class string. **Returned 0 features for both live
storms**, matching `windWatchesWarnings: null` in `CurrentStorms.json`. The two
sources agree, which is what makes the `can.watchWarning` flag trustworthy.

**`Past Points` (+7)** — `objectid, stormname, stormtype, stormnum,
**intensity**, basin, **mslp**, dtg, year, month, day, hhmm, lat, lon, **ss**,
idp_source, idp_filedate, idp_ingestdate, binnumber`
Note the naming divergence: past points use `intensity` and `ss`; forecast points
use `maxwind` and `ssnum`. Same quantities, different names.

**`Past Track` (+8)** — `objectid, stormtype, stormnum, ss, idp_source,
idp_filedate, idp_ingestdate, st_length(shape), binnumber`

**`Past Cumulative Wind Swath` (+9)** — `objectid, **radii**, stormid, basin,
stormnum, advnum, startdtg, enddtg, idp_source, …`

**`Past Wind Radii` (+10)** — `objectid, radii, stormid, basin, stormnum,
advnum, synoptime, timezone, **ne, se, sw, nw**, idp_source, idp_filedate,
idp_ingestdate, st_area(shape), st_perimeter(shape), binnumber`

**`Forecast Wind Radii` (+12)** — as Past Wind Radii plus `validtime` and `tau`;
`advnum` is a **string** here and a **number** in Past Wind Radii.

**`Advisory Wind Field` (+13)** — identical fields to Forecast Wind Radii. This
is the **current** wind field: `tau = 0`.

Live sample, Fausto Advisory Wind Field:

```json
{
  "objectid": 329, "radii": 34, "stormid": "ep062026", "basin": "ep",
  "stormnum": 6, "advnum": "24", "validtime": "2026072421",
  "synoptime": "2026072418", "timezone": "UTC", "tau": 0,
  "ne": 160, "se": 100, "sw": 90, "nw": 150, "binnumber": "EP1"
}
```

Live sample, Fausto Past Wind Radii — note the zeros:

```json
{
  "objectid": 1947, "radii": 34, "stormid": "EP062026", "basin": "ep",
  "stormnum": 6, "advnum": 24, "synoptime": "2026071918", "timezone": "UTC",
  "ne": 0, "se": 0, "sw": 0, "nw": 70, "binnumber": "EP1"
}
```

**Wind-radii semantics, and the trap in them:**

- `radii` is the wind **threshold in knots** — `34`, `50`, or `64`. One feature
  per threshold per time.
- `ne/se/sw/nw` are the radial extents **in nautical miles** per quadrant.
- **A quadrant value of `0` is real and means "no winds of this strength in this
  quadrant."** It is not a missing value. In the sample above Fausto had 34-kt
  winds only to its northwest.
- **`stormid` case is inconsistent between layers** — `"ep062026"` lowercase in
  Advisory Wind Field, `"EP062026"` uppercase in Past Wind Radii. Every
  `where=` clause must match case-insensitively via `UPPER(stormid)=`.
- `advnum` type is inconsistent — string in some layers, number in others.

### 3.5 Query form that works

```
{layerId}/query?where=UPPER(stormid)='{ID}'&outFields=*&returnGeometry=true&outSR=4326&f=geojson
```

`f=geojson` returns proper GeoJSON. `f=json` returns Esri JSON with `attributes`
and an Esri-shaped `geometry` — both work, but they are not interchangeable.

---

## 4. GDACS event list

- **URL used by the app:** `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP`
- **CORS:** open. Direct browser fetch.
- **Measured payload:** 135,606 bytes, **100 features**, of which only **4 were
  TC**. The rest were `EQ`, `FL`, `WF`.

**The app pulls 135 KB to find 4 storms — roughly 96% waste.** See §8.

Alternative endpoint, TC-only:
`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC`
`[UNVERIFIED]` whether its per-event fields are identical to EVENTS4APP; the
top-level shape matched in this run.

### 4.1 Complete field inventory — 44 paths, all of them

Structure is GeoJSON: `type`, `bbox`, `geometry`, `properties`.

| path | type | example | notes |
|---|---|---|---|
| `type` | string | `"Feature"` | |
| `bbox` | array[4] | | |
| `geometry.type` | string | `"Point"` | always Point in the list feed |
| `geometry.coordinates` | array[2] | `[-101.9, 9.2]` | **[lon, lat]** |
| `properties.eventtype` | string | `"TC"` | **must be filtered — list is mixed-hazard** |
| `properties.eventid` | **number** | `1001296` | the stable key |
| `properties.episodeid` | number | `2` | increments per update |
| `properties.eventname` | string | `"GENEVIEVE-26"` | bare, with `-YY` suffix |
| `properties.name` | string | `"Tropical Cyclone GENEVIEVE-26"` | display form |
| `properties.description` | string | `"Tropical Cyclone GENEVIEVE-26"` | |
| `properties.htmldescription` | string | `"Green Tropical Cyclone GENEVIEVE-26 off-shore from: 24 Jul 2…"` | HTML |
| `properties.alertlevel` | string | `"Green"` / `"Orange"` / `"Red"` | **humanitarian impact, NOT intensity** |
| `properties.alertscore` | number | `1`, `2` | same caveat |
| `properties.episodealertlevel` | string | `"Green"` | alert for this episode |
| `properties.episodealertscore` | number | `1` | |
| `properties.severitydata.severity` | number | `203.7024` | **forecast peak, km/h — see §1.1** |
| `properties.severitydata.severitytext` | string | `"Tropical Storm (maximum wind speed of 204 km/h)"` | prefix = class now, number = peak later |
| `properties.severitydata.severityunit` | string | `"km/h"` | |
| `properties.fromdate` | string | `"2026-07-24T15:00:00"` | **no timezone suffix — UTC implied** |
| `properties.todate` | string | `"2026-07-24T21:00:00"` | the analysis time |
| `properties.datemodified` | string | `"2026-07-24T20:54:23"` | |
| `properties.iscurrent` | **string** | `"true"` | **string, not boolean** |
| `properties.istemporary` | **string** | `"false"` | **string, not boolean** |
| `properties.country` | string\|empty | `"China, Philippines"` | **display string, comma-joined** |
| `properties.affectedcountries` | array | | **the structured list — use this** |
| `properties.affectedcountries[].countryname` | string | `"United States"` | |
| `properties.affectedcountries[].iso2` | string | `"US"` | |
| `properties.affectedcountries[].iso3` | string | `"USA"` | |
| `properties.iso3` | string\|empty | `"USA"` | single, often empty |
| `properties.source` | string | `"NOAA"` | **the real originating agency** |
| `properties.sourceid` | empty | `""` | **empty on all 4 storms** |
| `properties.glide` | empty | `""` | **empty on all 4 storms** |
| `properties.countryonland` | empty | `""` | **empty on all 4 storms** |
| `properties.polygonlabel` | string | `"Centroid"` | |
| `properties.Class` | string | `"Point_Centroid"` | **capital C** |
| `properties.icon` | string | URL | |
| `properties.iconoverall` | string | URL | |
| `properties.url.details` | string | URL | |
| `properties.url.geometry` | string | URL | **the published geometry link — prefer over any URL we build** |
| `properties.url.report` | string | URL | |

**There is no wind field in this feed other than `severitydata.severity`.**
Confirmed by exhaustive key walk across all four storms. No pressure, no
heading, no forward speed.

### 4.2 Type traps in this feed

- `iscurrent` and `istemporary` are the **strings** `"true"` / `"false"`.
  `if (p.iscurrent)` is true for both values.
- `eventid` is a **number** here. GDACS URLs take it as a string. Normalize once.
- Dates carry **no timezone suffix**. `new Date("2026-07-24T21:00:00")` parses as
  **local time** in JS, not UTC. This silently shifts every GDACS timestamp by
  the device's offset. A `Z` must be appended before parsing.
- `alertlevel` is a humanitarian impact estimate. A Green Cat 2 in open ocean and
  an Orange TD near Manila are both correct. **It must never colour a storm.**

---

## 5. GDACS per-event geometry

- **Published per event:** `properties.url.geometry`
- **Fallback form:** `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry`
- **Measured, Fausto:** 95 features.

### 5.1 Feature census (Fausto, 95 features)

| `Class` | n | geometry | `featuretype` | what it is |
|---|---|---|---|---|
| `Point_Centroid` | 1 | Point | — | current position |
| `Poly_Green` | 1 | Polygon | *(absent)* | aggregate 60 km/h swath, whole track |
| `Poly_Orange` | 1 | Polygon | *(absent)* | aggregate 90 km/h swath |
| `Poly_Red` | 1 | Polygon | *(absent)* | aggregate 120 km/h swath |
| `Poly_Cones` | 1 | Polygon | *(absent)* | uncertainty cone |
| `Poly_Green/Orange/Red` | 27 | Polygon | **`"WindRadii"`** | **timestepped footprints, 9 times x 3 thresholds** |
| `Line_Line_N` | 31 | LineString | *(absent)* | track segments |
| `Point_Polygon_Point_N` | 32 | **Polygon** | `"PointRadii"` | per-timestep position circles |

**`Point_Polygon_Point_N` features are Polygons, not Points**, despite the name.

### 5.2 Disambiguating the two polygon families

This is the single most important structural fact in the GDACS payload, and the
only reliable discriminator is `featuretype`:

```
Poly_Red  polygonlabel="120 km/h"      featuretype=undefined  -> AGGREGATE swath
Poly_Red  polygonlabel="24/07 21:00"   featuretype="WindRadii"
          key="07242100"               visible=true           -> TIMESTEP footprint
```

`polygonLabel` alone is not enough — it is a threshold on one and a timestamp on
the other. Colour class alone is not enough — both use Green/Orange/Red.

Measured timestep keys for Fausto (9 steps):
`07242100, 07250600, 07251800, 07260600, 07261800, 07270600, 07271800, 07281800, 07291800`

**The first key in sorted order is the current analysis time**, and it matches
the event's `todate` exactly. Timestep count varies with storm maturity:
Fausto 9, Noul 6, **Bertha 1** (a dying storm gets one step and no Red polygon
at all).

Colour → threshold mapping, read off `polygonlabel` on the aggregate polygons:

| class | threshold | ≈ knots | Saffir-Simpson meaning |
|---|---|---|---|
| `Poly_Green` | 60 km/h | 32 kt | tropical-storm force |
| `Poly_Orange` | 90 km/h | 49 kt | strong tropical storm |
| `Poly_Red` | 120 km/h | 65 kt | **hurricane force — the Cat 1 floor** |

### 5.3 `Line_*` track segments

Properties beyond the event-level block: `polygondate`, `polygonlabel`,
**`forecast`**, `Class`, `iconeventlink`, `iconitemlink`.

- **`forecast` is a real boolean** here (`false` / `true`) — unlike `iscurrent`
  in the list feed, which is a string. Do not assume consistency between feeds.
- `polygonlabel` is the **intensity class code** for that leg: `TD`, `TS`, `HU`.
- **Segments are ordered by intensity class, NOT chronologically.** Measured on
  Fausto, in array order:

```
idx  0-20 : HU      idx 21-22 : TD      idx 23-30 : TS
forecast flags: false x16, true x5, false x7, true x3
```

The `forecast` flag flips **within** a class run. Reconstructing chronology
requires coordinate chaining or the `Point_Polygon_Point` time keys. **Trusting
the `Line_Line_N` index as time order produces a scrambled track.**

### 5.4 `Point_Polygon_Point_N` timestep dots

Properties: `polygondate`, `polygonlabel`, `featuretype="PointRadii"`, `key`,
`Class`, `iconeventlink`, `iconitemlink`.

- `key` = `"07190300"` — **`MMDDHHMM`, no year.** Year must be inferred, and a
  year boundary is a real edge case for a December storm.
- `polygonlabel` = `"19/07 03:00 UTC"` — `DD/MM HH:MM UTC`, an independent
  cross-check on `key`.
- **`polygondate` is the ISSUE time and is identical on all of them.** It is not
  the point's own time. Reading it instead of `key` is the mistake that produced
  the long-standing and wrong belief that GDACS dots carry no forecast times.

### 5.5 Event-level properties are stamped on every feature

Every one of the 95 features carries the full event property block, including an
identical `severitydata`. Measured: **one distinct `severitydata` value across
all 95 features and all 7 class prefixes.**

This means **there is no per-point or per-timestep wind number anywhere in the
geometry payload.** Intensity must come from the polygon-containment test (§1.2)
or the segment class label (§1.4).

---

## 6. GDACS `geteventdata` and the impacts chain

```
https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=TC&eventid={id}
```

Returns a single GeoJSON Feature. `properties` has **35 keys — the 29 from the
list feed plus 6 more**: `episodes`, `impacts`, `images`, and three more
image/URL blocks.

Endpoints that **do not exist** (all returned HTTP 404 this run, so we stop
guessing at them): `getevent`, `gettimeline`, `getepisodes`, `getcap`.

- **`episodes`** — array, one per episode. Each entry is `{ details }` where
  `details` is a URL that has been JSON-serialized as a character-indexed object
  (`{"0":"h","1":"t",…}`). Join the values in numeric key order to recover the
  string. It is only a link. **No intensity history.**
- **`images`** — ~35 URLs: rain maps, overview maps, and storm-surge model
  output for ECMWF / HWRF / GFS / HOLLAND. Keys matching `maxwind` are **image
  links, not numbers.**
- **`impacts`** — the useful one.

### 6.1 `impacts` — agency attribution and the buried wind number

**Measured coverage: 4 of 4 storms had exactly one impacts entry with a
`locations` resource.**

| storm | `impacts[].source` | `locations` bytes | Bulletin | Advisory wind | Max wind |
|---|---|---|---|---|---|
| Genevieve | `NOAA` | 1,083 | 1 | **absent** | 51 m/s cat 3 |
| Fausto | `NOAA` | 1,089 | 23 | **46 m/s cat 2** | 46 m/s cat 2 |
| Noul | **`JTWC`** | 237,185 | 6 | **30 m/s cat 0** | 43 m/s cat 2 |
| Bertha | `NOAA` | 306,996 | 14 | **20 m/s cat 0** | 25 m/s cat 0 |

`impacts[].source` names the **real originating agency** — `NOAA` for
NHC-covered basins, **`JTWC` for the Northwest Pacific**. This is worth
surfacing on its own: it lets a GDACS storm be attributed honestly rather than
credited to "GDACS", which is an aggregator, not a forecast office.

`impacts[].resource` keys: `buffer39`, `buffer74`, `timeline`, `locations`.

- `buffer39` / `buffer74` — surge model output keyed
  `episodeid, eventid, modelname, modelrun, modelstatus, datums`. 39 and 74 are
  **mph** thresholds (34 kt and 64 kt). Measured 433 KB and 52 KB for Noul.
- `timeline` — an RSS/GeoRSS document (`channel, georss, version`), 110 KB.
  `[UNVERIFIED]` whether it carries per-bulletin intensity; not parsed this run.
- `locations` — GeoJSON of surge points. **446 features for Noul, each with a
  distinct description.** The wind numbers are in the description text (§1.3).

**Payload sizes are the disqualifier for routine use.** 1 KB for an open-ocean
storm and 307 KB for a landfalling one, with no way to know which before asking.

---

## 7. How Landfall displays this data today

The normalized shape both parsers emit, and what the user actually sees.

### 7.1 Field → display

| field | where it renders | exact display | when null |
|---|---|---|---|
| `id` | nowhere | internal key | — |
| `source` | gates copy | `"Not available for GDACS storms."` (in-effect), `"Not available for this source."` (wind field) | — |
| `name` | list row, drawer `<h1>`, map label | raw; map label uppercased, letter-spacing 0.08, offset `[0, 1.3]`, min zoom `ZOOM.basin` | ingest fallback: `sourceId.toUpperCase()` / `` `TC ${eventId}` `` |
| `basin` | list group header | `Atlantic`, `East Pacific`, `Central Pacific`, `Northwest Pacific`, `North Indian`, `Southwest Indian`, `Australian Region`, `South Pacific` — **only when more than one basin is present** | raw key |
| `lat` / `lon` | Vitals row `Position` | `19.7°N 120.4°E` (1 decimal) | row omitted |
| `windKt` | list meta; Vitals row `Winds` | list: `90 kt` **(knots only, never converted)**; detail: `90 kt (104 mph)` | row omitted, falls through to `Forecast peak` |
| `peakWindKt` | list meta; Vitals row `Forecast peak` | `peak 110 kt` / `110 kt (127 mph)` | row omitted |
| `pressureMb` | Vitals row `Pressure` | `967 mb` | row omitted. **GDACS always null.** |
| `headingDeg` + `speedKt` | Vitals row `Moving` | `NNW at 12 kt (14 mph)` | **row needs BOTH; either missing kills it** |
| `nature` | `.detail-nature` under the name | `Tropical Cyclone`, `Hurricane / Typhoon`, `Post-Tropical Cyclone`, `Potential Tropical Cyclone`, `Remnant Low`, `Tropical Depression`, `Tropical Storm`, `` `Hurricane · Category N` `` | — |
| `category` | list `.row-swatch`, header swatch | colour only, **never as coloured text** | `—` |
| `categoryCode` | list meta, nature line, forecast dot | `HU` / `Hurricane / Typhoon`, `HURRICANE_UNKNOWN_COLOR` | — |
| `categorySource` | **nowhere** | **dead field** | — |
| `observedAt` | list `.row-stale`, detail stamp | `just now`, `40 min ago`, `2 hrs ago`, `3 days ago`; stamp `11:00 PM Thu (2 hrs ago)`, prefixed `⚠ ` when stale | `"No timestamp"`, banded as **stale** |
| `advisoryKey` | detail | `Advisory 12A` (third colon-segment only) | nothing renders |
| `can.forecastPoints` | gates `"Loading forecast track…"` under kicker `"Closest approach"` | | |
| `can.watchWarning` | false → `"None in effect."` | | |
| `can.*` (7 others) | **written, never read** | | |
| `raw.binNumber` | error string `` `geometry: unusable binNumber "…"` `` | | |
| `raw.*` (6 others) | **written, never read** | | |

### 7.2 Units — `lib/units.js`

Constants: `KM_PER_NM = 1.852`, `MI_PER_NM = 1.15077945`,
`KMH_PER_KT = 1.852`, `MPH_PER_KT = 1.15077945`, `M_PER_FT = 0.3048`,
`MISSING = '—'`.

| function | formula | output |
|---|---|---|
| `formatWind(kt)` | `kt x 1.15077945` imperial / `kt x 1.852` metric | `98 mph` / `157 km/h`; null → `—` |
| `formatDistance(nm)` | `nm x 1.15077945` / `nm x 1.852` | `<10`: `4.2 mi`; else `1,204 mi`; null → `—` |
| `formatPressure(mb)` | none | `967 mb`; null → `—` |
| `formatSurge(ft)` | metric `ft x 0.3048` | `6 ft` / `1.8 m`; null → `—` |
| `formatSpeed` | **alias of `formatWind`** | identical |
| `formatBearing(deg)` | `round(((deg%360)+360)%360 / 22.5) % 16` | 16-point compass; null → `—` |

Unit system resolves from locale only. Imperial regions: `US, PR, VI, GU, AS, MP`.
Every call site passes no explicit system. Settings copy:
`"Units follow your device — currently ${units}."` There is **no override**.

**Note the conversion constant mismatch:** the app uses `1.852` km/kt; GDACS
uses `1.85184`. Harmless for display, but it means a round-trip of
`severity → kt → km/h` will not reproduce GDACS's number exactly. When matching
against a GDACS figure, use `1.85184`.

### 7.3 Saffir-Simpson thresholds — `lib/category.js`

| min kt | index | label |
|---|---|---|
| 137 | 6 | Cat 5 |
| 113 | 5 | Cat 4 |
| 96 | 4 | Cat 3 |
| 83 | 3 | Cat 2 |
| 64 | 2 | Cat 1 |
| 34 | 1 | TS |
| 0 | 0 | TD |

`CATEGORY_TOP_KT = 155`, used only for midpoints.

`categoryFromKt(kt)` — null/non-finite → `null`; otherwise first threshold whose
`min <=` wind. **A negative wind falls through and returns `0`.**

`representativeKt(category, nature, code)` — class midpoints, used for the 3D
cage height so a GDACS storm's elevation reflects its class rather than its
forecast peak:

| input | kt |
|---|---|
| nature not tropical/subtropical | `null` |
| category null + code `HU` | **109.5** |
| category null otherwise | `null` |
| 0 (TD) | **17** |
| 1 (TS) | **49** |
| 2 (Cat 1) | **73.5** |
| 3 (Cat 2) | **89.5** |
| 4 (Cat 3) | **104.5** |
| 5 (Cat 4) | **125** |
| 6 (Cat 5) | **146** |

`categoryShortLabel` → `—`, `Post-Trop`, `Potential`, `Remnant`, `HU`, `TD`,
`TS`, `` `Cat N` ``.

### 7.4 What the parsers actually match

**`data/gdacs-geometry.js`** switches on `Class` and `featuretype`:
`'Poly_Cones'`; `'Poly_Green'` → 34 kt, `'Poly_Orange'` → 50 kt,
`'Poly_Red'` → 64 kt; `Class.startsWith('Line_')` split by
`String(p.forecast) === 'true'`. **`featuretype === 'WindRadii'` → `bands[]`
(timestepped); anything else → `swathBands[]` (aggregate).** `windCurrent` is
the earliest `_gdacsTime` in `bands`. `polygonlabel` is validated against
`/^\s*(\d+(?:\.\d+)?)\s*km\/h\s*$/i` with ±5 km/h tolerance; a mismatch drops
the feature with a warning. `Point_Polygon_Point_N` and `Point_Centroid` are
explicitly dropped here. **`visible` is read nowhere in the codebase.**

**`data/gdacs-points.js`** requires **both** `featuretype === 'PointRadii'`
**and** `Class.startsWith('Point_Polygon_Point_')`. Reads `key` (`MMDDHHMM`) and
cross-checks it against `polygonlabel`; a contradiction drops the point rather
than placing it. Class-suffix `N` is explicitly not trusted for ordering.
`GDACS_GEOMETRY.trackIntensityIndex = { TD: 0, TS: 1, HU: null }`.
**`forecast[].windKt` is always `null`, including at the analysis point.**

**`data/nhc-mapserver.js`** resolves layers **by name regex within the 26-layer
block**, not by fixed offset — `/forecast\s+cone/i`, `/forecast\s+track/i`,
`/forecast\s+points/i`, `/past\s+track$/i`, `/watch-?\s*watch/i`,
`/advisory\s+wind\s+field/i`, `/forecast\s+wind\s+radii/i`,
`/past\s+wind\s+radii/i`, `/past\s+points/i`. Multi-match → `null` plus a
"refusing to guess" warning. Requests `outFields=*`. **`9999` is scrubbed to
`null` across every property before anything reads it** — but string `"9999"`
and `-9999` are not caught.

---

## 8. Findings — what this audit changed

Ordered by how much they matter.

### 8.1 GDACS current wind is available and unused — the headline

The app sets `windKt: null` for every GDACS storm and shows only
`Forecast peak`. Meanwhile `data/gdacs-geometry.js` **already parses**
`windCurrent` from the timestepped `WindRadii` bands. The geometry to bracket
current intensity is in memory; nothing derives a number or a range from it.

A storm in the 60 km/h footprint but outside 90 is 32–49 kt. Validated 4/4
(§1.2). This is honest, cheap, and already fetched.

**Recommendation.** Add a derived range field — a floor/ceiling pair in knots —
sourced from band containment, displayed as `Winds 32–49 kt (37–56 mph)` with
provenance `estimated from wind field`. Do **not** collapse it to a single
number; the whole point is that we don't have one.

### 8.2 NHC publishes `ssnum` and we derive category instead

`Forecast Points` carries `ssnum` at every tau — NHC's own Saffir-Simpson index.
The app computes category from knots and marks it `derived`. For NHC storms it
could be `reported`. The two agreed on both live storms (Fausto 90 kt → our
Cat 2, `ssnum` 2), so this is provenance quality, not a correctness bug.

### 8.3 MapServer `lat`/`lon` attributes are rounded to whole degrees

Fausto: attributes `lat: 19, lon: -133`; geometry `18.6999…, -132.6999…`. Up to
~30 nm of error. Anything reading the attribute fields instead of the geometry
places the storm wrong. **Verify no code path reads them.**

### 8.4 GDACS timestamps have no timezone and will parse as local

`fromdate`, `todate`, `datemodified` are all bare (`"2026-07-24T21:00:00"`).
`new Date(...)` on those treats them as **local time**. For Aaron in Chicago
that is a silent 5-hour shift on every GDACS age calculation and freshness
badge. A `Z` must be appended before parsing. **Audit `lib/time.js` for this.**

### 8.5 The `Number(p.ne) || 0` bug in `lib/windswath.js:297-300`

After `scrubSentinels` turns a 9999 radius into `null`, `Number(null) || 0`
yields `0` — a *missing* quadrant radius becomes a *zero-nautical-mile* radius
and the drawn envelope pinches toward the centre. This is precisely the failure
the GDACS path documents and guards against; the NHC path re-introduces it
numerically. **A missing radius must drop the ring, not shrink it.**

### 8.6 `markers.js:115` coalesces a null category to 1

`['coalesce', ['get', 'category'], 1]` gives every GDACS hurricane — which
legitimately has `category: null` and `categoryCode: 'HU'` — a tropical-storm-
sized tap target. Wrong severity read on the touch surface.

### 8.7 The ghost note hardcodes "NHC"

`view-storm-detail.js:395` says `"This storm is no longer in the NHC feed."` but
`update()` sets `ghost` for any source. Bertha is the live case: it left NHC and
GDACS still has it, so the reverse will happen too. The copy must name the
storm's own source.

### 8.8 Six of 26 MapServer layers break the bin-prefix naming convention

`Boundary_Inun_EP1`, `Footprint_Inun_EP1`, `Image_Inun_EP1`,
`Boundary_TMask_EP1`, `Footprint_TMask_EP1`, `Image_TMask_EP1` use a `_EP1`
**suffix**. Name matching that assumes a prefix finds 20 of 26. Harmless today
(none of the nine bundles the app resolves are raster sublayers) but it will
bite the moment inundation is wanted.

### 8.9 GDACS EVENTS4APP is 96% waste

135,606 bytes, 100 features, 4 of them TC. The `SEARCH?eventlist=TC` variant
returns tropical cyclones only. On a phone on cell data this is the single
cheapest performance win available. **Confirm field parity before switching.**

### 8.10 `MH` is real and has now been seen

`stormtype: "MH"` (Major Hurricane) appears on Genevieve's forecast points at
tau 60, 72 and 96. The classification map's `MH` entry is no longer unverified.

### 8.11 Dead weight

Written and never read: `categorySource`; `raw.alertLevel`, `raw.countries`,
`raw.countryLabel`, `raw.severityText`, `raw.classification`, `raw.advNum`; and
seven of nine `can.*` keys (`cone`, `forecastTrack`, `pastTrack`, `windRadii`,
`windBands`, `surge`, `models`). Either wire them up or cut them.

Worth wiring rather than cutting: **`impacts[].source`** (§6.1) is not currently
captured at all, and it names the real forecast office behind a GDACS storm —
`JTWC` for Noul. Attributing a Northwest Pacific typhoon to "GDACS" credits an
aggregator for a forecast office's work.

---

## 9. Sample payloads

Kept verbatim so parsing can be developed and tested with no network.

### 9.1 NHC `CurrentStorms.json` — one storm, trimmed to scalars

```json
{
  "activeStorms": [
    {
      "id": "ep062026",
      "binNumber": "EP1",
      "name": "Fausto",
      "classification": "HU",
      "intensity": "90",
      "pressure": "967",
      "latitude": "18.7N",
      "longitude": "132.7W",
      "latitudeNumeric": 18.7,
      "longitudeNumeric": -132.7,
      "movementDir": 275,
      "movementSpeed": 15,
      "lastUpdate": "2026-07-24T21:00:00.000Z",
      "publicAdvisory": {
        "advNum": "024",
        "issuance": "2026-07-24T21:00:00.000Z",
        "fileUpdateTime": "2026-07-24T20:35:23.250Z",
        "url": "…"
      },
      "windWatchesWarnings": null,
      "stormSurgeWatchWarningGIS": null,
      "potentialStormSurgeFloodingGIS": null,
      "peakSurgeKML": null
    }
  ]
}
```

### 9.2 MapServer Forecast Points — tau 0 and tau 12

```json
{
  "objectid": 1149,
  "stormname": "Hurricane Fausto",
  "stormtype": "HU",
  "dvlbl": "H",
  "basin": "EP",
  "advdate": "1100 AM HST Fri Jul 24 2026",
  "advisnum": "24",
  "fcstprd": 120,
  "tau": 0,
  "validtime": "24/1800",
  "maxwind": 90,
  "gust": 110,
  "mslp": 967,
  "ssnum": 2,
  "tcdir": 275,
  "tcspd": 13,
  "lat": 19,
  "lon": -133,
  "binnumber": "EP1"
}
```

```json
{
  "tau": 12,
  "validtime": "25/0600",
  "stormtype": "HU",
  "maxwind": 85,
  "gust": 105,
  "mslp": 9999,
  "ssnum": 2,
  "tcdir": 9999,
  "tcspd": 9999
}
```

Geometry for the tau-0 feature, for contrast with the rounded attributes:

```json
{ "x": -132.69999999999993, "y": 18.699999999600436 }
```

### 9.3 GDACS event list — one TC feature, properties

```json
{
  "type": "Feature",
  "bbox": [ … ],
  "geometry": { "type": "Point", "coordinates": [-101.9, 9.2] },
  "properties": {
    "eventtype": "TC",
    "eventid": 1001296,
    "episodeid": 2,
    "eventname": "GENEVIEVE-26",
    "name": "Tropical Cyclone GENEVIEVE-26",
    "description": "Tropical Cyclone GENEVIEVE-26",
    "htmldescription": "Green Tropical Cyclone GENEVIEVE-26 off-shore from: 24 Jul 2026 …",
    "alertlevel": "Green",
    "alertscore": 1,
    "episodealertlevel": "Green",
    "episodealertscore": 1,
    "severitydata": {
      "severity": 203.7024,
      "severitytext": "Tropical Storm (maximum wind speed of 204 km/h)",
      "severityunit": "km/h"
    },
    "fromdate": "2026-07-24T15:00:00",
    "todate": "2026-07-24T21:00:00",
    "datemodified": "2026-07-24T20:54:23",
    "iscurrent": "true",
    "istemporary": "false",
    "country": "United States",
    "affectedcountries": [
      { "countryname": "United States", "iso2": "US", "iso3": "USA" }
    ],
    "iso3": "USA",
    "source": "NOAA",
    "sourceid": "",
    "glide": "",
    "countryonland": "",
    "polygonlabel": "Centroid",
    "Class": "Point_Centroid",
    "icon": "…", "iconoverall": "…",
    "url": { "details": "…", "geometry": "…", "report": "…" }
  }
}
```

### 9.4 GDACS geometry — the two Poly_Red kinds side by side

```json
{
  "properties": {
    "Class": "Poly_Red",
    "polygonlabel": "120 km/h",
    "polygondate": "2026-07-24T21:00:00"
  }
}
```

```json
{
  "properties": {
    "Class": "Poly_Red",
    "polygonlabel": "24/07 21:00",
    "polygondate": "2026-07-24T21:00:00",
    "featuretype": "WindRadii",
    "key": "07242100",
    "visible": true
  }
}
```

A track segment and a timestep dot:

```json
{
  "properties": {
    "Class": "Line_Line_0",
    "polygonlabel": "HU",
    "forecast": false,
    "polygondate": "2026-07-24T21:00:00"
  }
}
```

```json
{
  "properties": {
    "Class": "Point_Polygon_Point_0",
    "polygonlabel": "19/07 03:00 UTC",
    "key": "07190300",
    "featuretype": "PointRadii",
    "polygondate": "2026-07-24T21:00:00"
  }
}
```

---

## 10. Quick reference — do not get these wrong

1. **`severity` is a forecast peak, not current wind.** Proven: Genevieve
   203.7024 km/h ≡ NHC's max forecast 110 kt × 1.85184.
2. **`alertlevel` is humanitarian impact, not intensity.** Never colour a storm
   with it.
3. **`featuretype === 'WindRadii'`** is the only reliable way to tell a
   timestepped footprint from the aggregate swath.
4. **`9999`** is NHC MapServer's missing-value sentinel on `mslp`, `tcdir`,
   `tcspd` beyond tau 0.
5. **`0`** in a wind-radii quadrant is real data meaning "no winds this strong
   here" — not missing.
6. **MapServer `lat`/`lon` attributes are rounded to whole degrees.** Use the
   geometry.
7. **GDACS dates have no timezone** and will parse as local. Append `Z`.
8. **`advNum` is a zero-padded string.** `"017"` is not `17`.
9. **`intensity` and `pressure` in `CurrentStorms.json` are strings.**
10. **`iscurrent` / `istemporary` in the GDACS list are strings**, but
    `forecast` on GDACS line features is a real boolean.
11. **`Line_Line_N` index is not time order** — it is grouped by intensity class.
12. **`polygondate` on a timestep dot is the issue time**, identical on all of
    them. The point's own time is in `key`.
13. **`stormid` case varies between MapServer layers.** Always `UPPER(stormid)=`.
14. **GDACS `Point_Polygon_Point_N` features are Polygons**, not Points.
15. **GDACS keeps storms after NHC drops them** (Bertha, this run).
