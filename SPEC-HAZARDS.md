# SPEC-HAZARDS.md — Landfall multi-hazard expansion

**This is §18–§26 of the Landfall spec.** Companion to `SPEC.md`, which is still
the source of truth for the stack, the failure philosophy, the design contract
and the cyclone feature. This file covers ONLY the extension from "hurricane
app" to "disaster app": earthquakes, floods, volcanoes, droughts, wildfires.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered or
> the route taken to get there. Fences ("do not re-propose X") live in SPEC.md's
> SETTLED list, one line each.
> **Section numbers are permanent addresses.** A section may move between files;
> it may never be renumbered.

Everything in here was captured by hitting the live endpoints on **2026-07-28**.
Anything not actually measured is tagged **UNVERIFIED** and says so. Do not
promote an UNVERIFIED line to fact without probing it.

Real payloads are committed to this repo so you can build the data layer with
no network:

```
assets/hazards/   static seed catalogs — SHIPPED TO THE CLIENT
samples/gdacs/    real GDACS responses, all six hazard types
samples/other/    real USGS / NIFC / NWS / USDM responses
```

---

## 18. The shared shape — one normalizer, six adapters

**All six GDACS hazard types return an IDENTICAL property schema.** Verified by
pulling all six lists and diffing the union of property keys — they match
exactly, key for key.

That means `data/gdacs.js` is already 90% of a six-hazard parser. What differs
between hazards is only:

| | `severitydata.severityunit` | `source` | geometry classes |
|---|---|---|---|
| **TC** cyclone | `km/h` | JTWC / NOAA / RSMC | tracks, cones, wind polys |
| **EQ** earthquake | `M` | NEIC (+ regional nets) | circle + ShakeMap intensity |
| **FL** flood | *(empty)* | GLOFAS | affected + global area |
| **VO** volcano | *(empty)* | VAAC name | circle only |
| **DR** drought | `km2` | GDO | affected area |
| **WF** wildfire | `ha` | GWIS | burnt-scar polygon |

Design consequence: **one normalizer, one `hazard` field, six severity
adapters.** Do not write six parsers. Do not fork `data/gdacs.js` per hazard —
extend it with a per-type severity/label strategy and keep everything else
shared.

---

## 19. GDACS — the common API

Host `https://www.gdacs.org`. **CORS verified open: `access-control-allow-origin: *`**
on both the event list and the geometry endpoint (measured with a real `Origin`
header, 2026-07-28).

**That does not mean fetch it from the phone.** SPEC.md §17 Pass B already
settled this and the reasoning is unchanged: CORS-open is a permission, not a
capacity plan. Every hazard goes through the existing Pages Function relay
pattern in `functions/api/gdacs/events.js`.

### 19.1 Event list

```
https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist={TYPE}&alertlevel=Green;Orange;Red
```

`{TYPE}` is one of `TC EQ FL VO DR WF`. The `alertlevel=Green;Orange;Red`
suffix is **load-bearing** — without it GDACS returns a short list. Naming all
three levels asks for the unabridged set; it is not a filter.

**Measured 2026-07-28** (feature count / how many are `iscurrent`):

| Type | Features | `iscurrent=="true"` | Bytes |
|---|---|---|---|
| TC | 100 | 4 | 142,249 |
| EQ | 100 | **65** | 135,094 |
| FL | 100 | 8 | 130,437 |
| VO | 25 | **0** | 32,426 |
| DR | 42 | 1 | 64,839 |
| WF | 100 | **100** | 135,392 |

Read that table carefully, it drives three decisions:

1. **100 is a hard cap.** TC, EQ, FL and WF all returned exactly 100. That is
   the API ceiling, not the real count. During a bad week you are seeing a
   truncated world. Use `fromdate`/`todate` to window the query rather than
   assuming 100 is everything.
2. **WF returned 100 current out of 100.** Wildfire alone will saturate any
   shared list. This is the same trap `functions/api/gdacs/events.js` already
   documents about `EVENTS4APP` — fire filled 93 of 100 slots and cyclones came
   back with two storms. **Every hazard gets its own `eventlist=` call. Never
   share one.**
3. **VO returned 0 current.** GDACS volcano is a VAAC ash-advisory relay, not a
   volcano monitor. It is near-useless as a live layer. Volcanoes come from
   Smithsonian + USGS instead (§22).

Date windowing works on every type, same param names as TC:

```
...&fromdate=2026-01-01&todate=2026-07-28
```

### 19.2 The shared property schema

Every feature is a GeoJSON `Point` with `Class: "Point_Centroid"`. Full
property list, identical across all six types:

| Field | Type | Example | Notes |
|---|---|---|---|
| `eventtype` | string | `"EQ"` | your hazard discriminator |
| `eventid` | number | `1554511` | stable event key |
| `episodeid` | number | `1721183` | increments per update. **EQ episode ids are huge and unrelated to a counter** — do not assume small integers |
| `eventname` | string | `"East Africa-2026"` | **often `""`** — WF is always empty |
| `name` | string | `"Drought in Ethiopia, Kenya, Somalia"` | **this is the display name.** Always populated |
| `description` | string | same as `name` | |
| `htmldescription` | string | `"Orange Drought in ... from: 21 Apr 2026 to: 25 Jul 2026 ."` | prose, has stray spaces |
| `glide` | string | `"DR-2026-000117-ETH"` | can be `""` |
| `icon`, `iconoverall` | string URL | `.../maps/Orange/DR.png` | `iconoverall` can be `null` |
| `url.geometry` | string URL | see §19.3 | **use this verbatim, do not rebuild it** |
| `url.report` | string URL | human page | |
| `url.details` | string URL | `geteventdata` | |
| `alertlevel` | string | `"Orange"` | `Green` / `Orange` / `Red` |
| `alertscore` | number | `2` | |
| `episodealertlevel` | string | `"Orange"` | per-episode, can differ from event |
| `episodealertscore` | number | `1.2` | |
| `istemporary` | string | `"false"` | **string, not boolean** |
| `iscurrent` | string | `"true"` | **string, not boolean. This is your live filter** |
| `country` | string | `"Spain"` | |
| `iso3` | string | `"ESP"` | |
| `affectedcountries` | array | `[{iso2,iso3,countryname}]` | **can be `[]`** |
| `fromdate` | string | `"2026-07-25T00:00:00"` | **no timezone suffix — treat as UTC** |
| `todate` | string | `"2026-07-27T00:00:00"` | |
| `datemodified` | string | `"2026-07-28T04:15:16"` | freshness signal to show the user |
| `source` | string | `"GWIS"` | see §18 table |
| `sourceid` | string | `"15503935"` | **`""` in the list, populated in `geteventdata`** |
| `polygonlabel` | string | `"Centroid"` | |
| `Class` | string | `"Point_Centroid"` | **capital C — inconsistent with every other key** |
| `severitydata` | object | `{severity, severitytext, severityunit}` | see §18 and per-hazard sections |

Everything `data/gdacs.js` already does — the string-bool trap, the
`parseGdacsStamp` UTC handling, the out-of-range lat/lon rejection — applies
unchanged to all six types. **Keep the position sanity check.** A latitude of 91
passes `isFinite` and comes out of the sphere math as a confident marker at the
pole.

### 19.3 Geometry

```
https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype={TYPE}&eventid={id}&episodeid={ep}
```

Take the URL from `properties.url.geometry` rather than building it — geometry
is per-episode and the pairing matters.

**Measured payload sizes and shapes, 2026-07-28:**

| Type | Bytes | Features | Classes returned |
|---|---|---|---|
| VO | 5,892 | 2 | `Point_Centroid`, `Poly_Circle` |
| WF | 5,945 | 2 | `Point_Centroid`, `Poly_area` |
| DR | 4,193 | 2 | `Point_Centroid`, `Poly_area` |
| FL | 349,277 | 3 | `Point_Centroid`, `Poly_Affected`, `Poly_Global` |
| TC | 385,961 | 77 | tracks, cones, wind polys (existing) |
| **EQ** | **1,756,834** | 11 | `Point_Centroid`, `Poly_Circle`, `Poly_SMPInt_3..7` |

**The EQ geometry call is 1.7 MB for one earthquake.** Do not fetch it on
selection without thought. The ShakeMap intensity polygons (`Poly_SMPInt_{n}`,
`polygonlabel: "Intensity 3"`, extra properties `intensity` and `shakeid`) are
`MultiPolygon` and they are where all the bytes are. Options, in order:

1. Fetch geometry **only for the selected event**, never for the list.
2. Server-side simplify in the relay before it reaches the phone.
3. Drop the low intensity bands (3, 4) at globe zoom — MMI 3 covers half a
   continent and reads as noise.

**FL geometry**: `Poly_Affected` is the flood footprint (1,731 points in the
sample); `Poly_Global` is a 17,734-point `MultiPolygon` context layer. **Drop
`Poly_Global`** — it is ten times the bytes for background you do not need.

Polygon features carry three properties the centroid does not: `polygondate`
(when the footprint was mapped — show it), `iconeventlink`, `iconitemlink`.

**Watch for degenerate rings.** WF burnt-area polygons contain 4-point interior
rings with sub-metre area. Filter rings under ~5 distinct points or MapLibre
draws slivers.

### 19.4 Event detail

```
https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype={TYPE}&eventid={id}
```

Returns a single `Feature`, not a collection. Superset of the list properties
plus `episodes[]`, `impacts[]`, `images{}`, `additionalinfos`, `documents`,
`url.media`, `url.eventnews`. **No `url.details`.** Detail-panel call only.

Samples: `samples/gdacs/eventdata-EQ.json`, `eventdata-WF.json`.

### 19.5 Skip the RSS

`https://www.gdacs.org/xml/rss_wf_24h.xml` → 404. The JSON API is strictly
better (geometry URLs, severity units, episode ids). Do not build on GDACS RSS.

---

## 20. Earthquakes

GDACS EQ is fine as an alert-level layer but **USGS is the real source** and it
is better in every dimension: lower latency, no 100-cap, magnitude/depth/
ShakeMap/PAGER, and CORS-open.

### 20.1 USGS summary feeds — **CORS `*` verified**

```
https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{FEED}.geojson
```

`{FEED}` = `{significant|4.5|2.5|1.0|all}_{hour|day|week|month}`.
Measured: `2.5_day` = 41,567 bytes, 58 features. `significant_month` = 11,141 bytes.

**Use `2.5_day` or `4.5_week` as the default globe layer.** `all_*` is a
firehose of M<1 events that means nothing at globe zoom.

Sample committed: `samples/other/usgs-quakes-2.5day.json`.

Real feature properties, verbatim from the live feed:

```json
{"mag":5.8,"place":"191 km NW of Oula Xiuma, China","time":1785209645779,
 "updated":1785211151384,"tz":null,
 "url":"https://earthquake.usgs.gov/earthquakes/eventpage/us6000tga9",
 "detail":"https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/us6000tga9.geojson",
 "felt":null,"cdi":null,"mmi":7.337,"alert":"yellow","status":"reviewed",
 "tsunami":0,"sig":650,"net":"us","code":"6000tga9","ids":",us6000tga9,",
 "sources":",us,","types":",ground-failure,losspager,origin,phase-data,shakemap,",
 "nst":107,"dmin":3.422,"rms":0.67,"gap":33,"magType":"mww",
 "type":"earthquake","title":"M 5.8 - 191 km NW of Oula Xiuma, China"}
```

Field notes that matter:

- **Geometry is `[lon, lat, depth_km]` — three elements.** Depth is in the
  coordinate array, not the properties. This is the single easiest thing to get
  wrong, and it is also the most interesting number for a 3D globe: you can
  render hypocentre depth as actual depth below the surface.
- `time` and `updated` are **epoch milliseconds**, not ISO strings.
- `felt`, `cdi`, `tz` are **commonly null**. `mmi` and `alert` are present only
  on events that got a ShakeMap/PAGER run.
- `alert` is the **PAGER** level: `green` / `yellow` / `orange` / `red` — an
  impact estimate, not a magnitude. An M5.8 with `alert:"yellow"` matters more
  than an M7 in open ocean with no alert at all.
- `tsunami` is `0`/`1`, and it means "this event is in a tsunami-eligible
  region", **not** "a tsunami was observed". Do not label it as a tsunami
  warning. That is a SPEC.md §5 safety-adjacent bug.
- `sig` (0–1000) is USGS's own significance score — a decent single sort key.
- `types` is a comma-wrapped string listing available products. Parse it to
  know whether a ShakeMap exists before requesting the detail feed.
- `status`: `automatic` vs `reviewed`. Show it. An automatic solution can move.

### 20.2 USGS query API — **CORS `*` verified**

```
https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5&limit=5
```

Params worth having in `config/constants.js`: `starttime`, `endtime`,
`minmagnitude`, `maxmagnitude`, `latitude`+`longitude`+`maxradiuskm`,
`mindepth`/`maxdepth`, `orderby` (`time`, `time-asc`, `magnitude`,
`magnitude-asc`), `limit`, `offset`, `eventid`.

### 20.3 Detail feed — ShakeMap and PAGER

Follow `properties.detail`. Sample committed: `samples/other/usgs-quake-detail.json`
(43,533 bytes for one M5.8). It contains `properties.products.{shakemap,
losspager, origin, ground-failure, phase-data}[]`, each with a `contents`
map of downloadable artifacts. This is where you get MMI contour GeoJSON and
PAGER fatality/economic loss histograms.

The MMI contour key is **`download/cont_mmi.json`** — 61,624 bytes for that one
M5.8, `application/json`. `download/cont_mi.json` is the same size and appears to
be an alias; prefer the explicit name. Read out of the committed sample, not
guessed.

**PICK THE CONTOURS, NOT THE COVERAGE.** The same product also carries
`coverage_mmi_{low,medium,high}_res.covjson` at 59 KB / 231 KB / 919 KB. Those
are CoverageJSON rasters — a different format needing a different reader, and
the high-res one is nearly a megabyte for a single quake on a phone. Contours
### 20.3.1 MMI colours — USGS ships them inside the contour file

**Do not hardcode a shaking palette. `cont_mmi.json` carries USGS's own hex on
every feature**, as `properties.color`, alongside `value` (the MMI) and `weight`
(2 for whole steps, 4 for half steps). The colour contract under SPEC.md §6 is
therefore satisfied by reading the product, which is strictly better than a
table in our repo: it cannot drift from what USGS publishes.

The full scale, collected from the contour products of seven real events
(2011 Tohoku M9.1, 2025 Kamchatka M8.8, 2014 Iquique M8.2, 2025 Mandalay M7.7,
2023 Kahramanmaraş M7.8, 2010 Haiti M7.0, 2025 S. Tibetan Plateau M7.1):

| MMI | hex | | MMI | hex |
|---|---|---|---|---|
| 1.5 | `#dfe6ff` | | 5.5 | `#bbff4a` |
| 2.0 | `#bfccff` | | 6.0 | `#ffff00` |
| 2.5 | `#afd9ff` | | 6.5 | `#ffe200` |
| 3.0 | `#a0e5ff` | | 7.0 | `#ffc600` |
| 3.5 | `#90f2ff` | | 7.5 | `#ffaa00` |
| 4.0 | `#80ffff` | | 8.0 | `#ff9100` |
| 4.5 | `#7cffc7` | | 8.5 | `#ff4700` |
| 5.0 | `#7cff90` | | 9.0 | `#fd0000` |

**THE CONTOUR PRODUCT STOPS AT MMI 9, AND THAT IS NOT A GAP IN THE SAMPLE.**
All four of the highest-intensity events checked cap at 9.0 — including
Mandalay 2025, whose reported peak intensity is **9.95**. IX is the top contour
USGS draws. A layer that expects a X band will wait forever for one.

**MMI I and X are therefore NOT in this palette.** They exist only on the
discrete binned scale used in the printed legend, which is a gradient image and
not a clean source. Neither is needed to draw contours: I is "not felt" and is
never contoured. If a binned legend is ever built, that is its own lookup — do
not invent the two values to round the table out.

Use it as: `feature.properties.color` straight into the line-colour paint. The
table above is for review and for a sane fallback when a feature somehow has no
colour, not for lookup at runtime.

`weight` is USGS's own emphasis of whole intensity steps over half steps. Honour
it — it is what makes the contour set readable rather than a stack of rings.

**PICK THE CONTOURS, NOT THE COVERAGE.** The same product also carries
`coverage_mmi_{low,medium,high}_res.covjson` at 59 KB / 231 KB / 919 KB. Those
are CoverageJSON rasters — a different format needing a different reader, and
the high-res one is nearly a megabyte for a single quake on a phone. Contours
are line geometry the existing layer machinery can already draw. The other
`cont_*` files (`pga`, `pgv`, `psa*`) are ground-motion physics, not felt
intensity, and are not what §6's colour contract is about.

### 20.4 Other earthquake sources

- **EMSC** `seismicportal.eu` — FDSN-compatible, plus a real-time WebSocket.
  Often faster than USGS for European/Mediterranean events. **UNVERIFIED** —
  not probed.
- **NOAA tsunami** `tsunami.gov` — **UNVERIFIED**. If you build a tsunami
  indicator, it must come from a real warning product, never from the USGS
  `tsunami` flag.
- **NWS alerts** carry `Tsunami Warning`, `Tsunami Advisory`, `Tsunami Watch` —
  verified present in the live type list (§25).

### 20.5 Reference layer — tectonic plates (SHIPPED)

`assets/hazards/plate-boundaries.geojson` — 241 `LineString` features,
226,378 bytes raw / **54,579 gzipped**. Source: fraxen/tectonicplates (PB2002,
Bird 2003). Properties: `{LAYER, Name, Source, PlateA, PlateB, Type}` e.g.
`Name: "AF-AN"`.

This is the single highest-value-per-byte layer in the whole expansion. Every
earthquake on the globe suddenly has a reason. Draw it as a dim hairline under
the quake dots and it explains the Ring of Fire without a word of copy.

### 20.6 Color contract

**Magnitude drives size, PAGER drives color.** Do not color by magnitude — an
M7 in the ocean and an M7 under a city are the same dot and that is wrong.

- Radius: `log`-scaled on magnitude, floored at the 44px-equivalent tap target.
- Fill: PAGER `green`/`yellow`/`orange`/`red` when `alert` is present; a
  neutral tone when it is absent (**absent is not green** — that is the SPEC.md §5
  `unavailable` vs `clear` distinction in miniature).
- Age: fade opacity over the feed window. A quake from 20 hours ago should not
  read as live.

**UNVERIFIED**: official USGS hex values for the MMI I–X shaking scale. Look
them up before hardcoding; they are a fixed contract like Saffir-Simpson and
must not be themed.

---

## 21. Wildfires

Four sources, each doing one job. Do not use more.

### 21.1 GDACS WF — the named-event backbone

Covered by §19. Severity is **hectares burnt** (`severityunit: "ha"`,
`severitytext: "Orange impact for forestfire in 12406 ha"`). Source is GWIS.
`eventname` is always `""` — use `name`.

`getgeometry` returns a real **burnt-area polygon** (`Class: "Poly_area"`,
`polygonlabel: "Affected Area"`) with interior rings for unburnt islands, at
4-decimal precision, for ~6 KB. Excellent value. Sample: `samples/gdacs/geometry-WF.json`.

### 21.2 NASA FIRMS — the detection layer

The only source that shows fires nobody has named yet. Global, 375 m (VIIRS).

**Key-free bulk files (verified to exist):**

```
https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv
https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv
https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv
```

**Measured 2026-07-28: the Suomi-NPP global 24h file is 5,665,108 bytes and
sends NO CORS header.** Both facts are disqualifying for a direct client fetch.
`_48h` and `_7d` variants follow the same pattern.

VIIRS columns (verbatim header):
```
latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
```
MODIS columns:
```
latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight
```

Parser traps:
- **VIIRS `confidence` is a word** (`low`/`nominal`/`high`); **MODIS
  `confidence` is an integer 0–100.** Same column name, different type.
- `acq_time` is `HHMM` UTC as a **zero-padded string** (`0033`). Parse as text.
- The bulk files have **no `instrument` column** unlike the keyed API. Key your
  parser off the header row, not fixed indices.
- `satellite` values: `N` (Suomi-NPP), `N20`, `T` (Terra), `A` (Aqua).

**Keyed API** (needs a free MAP_KEY from `https://firms.modaps.eosdis.nasa.gov/api/map_key/`):
```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north|world}/{1..5}/{YYYY-MM-DD}
```
`SOURCE` ∈ `MODIS_NRT MODIS_SP VIIRS_SNPP_NRT VIIRS_SNPP_SP VIIRS_NOAA20_NRT
VIIRS_NOAA20_SP VIIRS_NOAA21_NRT LANDSAT_NRT`. Day range hard cap **5**.
Documented limit **5000 transactions / 10 minutes** per key.

**The MAP_KEY must live in the Worker, never in client JS.** A key in the
bundle is a key the internet burns through your quota.

**Mandatory architecture**: relay + server-side downsample. Pull the bulk CSV
on a cron in the Worker (the `worker/src/sources.js` pattern already does
this), drop `confidence === "low"`, threshold on `frp`, round to 4 decimals,
write compact GeoJSON to KV, serve bbox slices. The phone must never see the
difference between a quiet day and a catastrophic one.

**The seasonal trap — this is the number to remember.** Canada's CWFIS daily
hotspot CSVs, measured off their own directory index: **16 KB on 13 Jan,
201 KB on 15 Jan, 4 MB on 14 Jul, 7 MB on 15 Jul.** A 400× seasonal swing, for
one country. A fire layer sized during a quiet week will fall over in August.
Define a **max-rendered-detections budget in `config/constants.js` before
writing the fetch logic**, and enforce it server-side.

CWFIS also serves a WMS, which is the better door than the bulk CSVs — it does
the windowing for you and it answers a GetCapabilities (294 KB):
```
https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms
```
Layer names read from it: `hotspots`, `hotspots_24h`, `hotspots_last24hrs`,
`cwfis_hotspots_last24hrs3cls` (3-class styled, `_en` / `_fr` / `_v3`
variants), `cwfis_m3_polygons` (M3 fire perimeters), plus `firewx_stns`,
`firewx_stns_current`, `firewx_scribe`, `firewx_scribe_fcst`, `firewx_naefs`.

The CSV paths quoted from the old directory index are **dead**:
`/downloads/hotspots/hotspots.csv`, `hotspots.txt` and
`/downloads/activefires/activefires.csv` all 404 as of 2026-07-29. Use the
geoserver, or re-derive the current download paths — do not copy a path out of
this file without checking it answers.

### 21.3 NIFC / WFIGS — US detail — **CORS `*` verified**

```
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query
```

Working query (this exact call produced the committed sample):
```
?where=IncidentTypeCategory%3D%27WF%27&outFields=IncidentName,IncidentSize,PercentContained,POOState,FireCause,FireDiscoveryDateTime,IrwinID&f=geojson&resultRecordCount=25&outSR=4326
```

Samples: `samples/other/nifc-incidents.geojson`, `nifc-perimeters.geojson`.

Live counts 2026-07-28: 622 incidents total, **590** with
`IncidentTypeCategory='WF'`, 101 perimeters.

Four field traps, all verified against the live layer definition:

1. **`DailyAcres` does not exist.** The field is **`IncidentSize`** (double,
   acres). Any doc naming `DailyAcres` is stale.
2. **`POOState` is ISO 3166-2** — `"US-WA"`, not `"WA"`.
3. **`PercentContained` is frequently `null`.** Needs a real "not reported"
   state, not `0%`.
4. **You must filter `IncidentTypeCategory='WF'`** or you render prescribed
   burns as emergencies. Unfiltered records include literal `"CALTRANS FRP RX"`.
   That is a SPEC.md §5 safety-adjacent bug.

Incidents layer is native **wkid 4269 (NAD83)** — pass `outSR=4326`.
Perimeters layer is native **4326**. They differ; do not assume.

Perimeter fields are **prefixed**: `poly_IncidentName`, `poly_GISAcres`,
`poly_PolygonDateTime`, `attr_PercentContained`, `attr_FireCause`,
`attr_IrwinID`. 119 fields on that layer.

**Perimeter trimming is mandatory.** One untrimmed polygon (the 642,029-acre
"Morrill" fire) overflowed a fetch. With `maxAllowableOffset=0.02&geometryPrecision=4`
the same polygon came back as ~90 coordinate pairs. Always send:
- `outFields=` an explicit list — never `*`
- `maxAllowableOffset=0.02` at globe zoom (≈2 km), `0.002` flown in
- `geometryPrecision=4` (≈11 m)
- `returnGeometry=false` for the list panel
- watch `exceededTransferLimit: true`; `maxRecordCount` is 2000

`IrwinID` is the cross-system join key between the two layers.

#### The peak-season payload test — run 2026-07-29, and it failed loudly

The January measurements in this file were always flagged as a summer risk.
Measured at the end of July, in the middle of the northern fire season:

```
perimeters, where=1=1, outFields=*, no simplification   26,095,330 bytes
```

**Twenty-six megabytes for one request.** Not a tail case, not a bad day — the
default shape of the query, in season. That is the 400x seasonal swing this
file warned about, arriving.

**AND THE SAME REQUEST RATE-LIMITED THE SERVICE FOR EVERYTHING AFTER IT.**
That one call reported **70,260 request units against a 57,600-per-minute
ceiling**, and every subsequent query — including trivially small ones — came
back:
```
HTTP 200, 210 bytes
{"error":{"code":429,"message":"Unable to perform query. Too many requests.",
 "details":["API calls quota exceeded ... Retry after 60 sec."]}}
```
Still 429 at 65,146 units two minutes later, on a two-field query. **The quota
is on the shared public service and it is routinely near its ceiling from other
people's traffic**, so this is not something careful use alone avoids.

Three consequences, all mandatory:

1. **NIFC goes behind the relay with a KV cache, like every other upstream.**
   Direct-from-phone would put every Landfall user into that shared quota
   during exactly the week they need it.
2. **A 429 arrives as HTTP 200 with an error body.** `res.ok` is TRUE. Any
   handler that trusts the status code will parse `features: undefined` and
   render an empty fire map during a fire emergency — the §5 failure this
   project cares about most. **Check for `.error` in the body, not the status.**
3. The trimming rules above are not an optimisation, they are the price of
   entry. Never ship `outFields=*`.

Unresolved: the trimmed-and-filtered payload size. Every attempt to measure it
hit the 429 above. Measure it from the relay once the cache is in front.

### 21.4 NOAA HMS — smoke — the layer users actually feel

```
https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/{YYYY}/{MM}/hms_smoke{YYYYMMDD}.kml
https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/{YYYY}/{MM}/hms_smoke{YYYYMMDD}.zip
https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/{YYYY}/{MM}/hms_fire{YYYYMMDD}.txt
```
Latest: `https://www.ospo.noaa.gov/Products/land/hms/data/latest_smoke_final.kml`

Directory indexes 404 — you cannot browse, only construct paths.

The KML has **no `<ExtendedData>`**. Density comes from the style id:
`Smoke_Light`, `Smoke_Medium` (and `Smoke_Heavy`, **UNVERIFIED**). For a numeric
density attribute use the Shapefile and convert server-side.

HMS fire points text file — header is **space-padded**, trim every field:
```
 Lon,        Lat, YearDay, Time,       Satellite,           Method, Ecosystem,        FRP
-122.758060,  51.208057, 2026208, 0201,       GOES-EAST,             NGFS,        22,    312.740
```
`YearDay` is `YYYYDDD` ordinal (`2026208` = 27 Jul 2026). `FRP` in megawatts.

HMS is **geostationary GOES**, so ~5–10 min refresh over the Americas versus
~12 h between polar overpasses. For the Americas it is *fresher* than FIRMS,
and it is analyst-QC'd so fewer false positives.

**Cadence, and it matters for SPEC.md §5:** fire detections published by 08:00 ET then
updated through the day; **smoke analysis is daylight-only** — passes at
11:00–12:00 ET and 19:00–20:00 ET. At 03:00 ET the newest smoke file is seven
hours old and the plume has moved. **"No smoke polygons at 3 a.m." is
`unavailable`, not `clear`.** Show the analysis timestamp.

No CORS expected from a bare Apache file server — **UNVERIFIED**, relay it.

### 21.5 GWIS / EFFIS — fire danger raster (optional)

```
https://maps.effis.emergency.copernicus.eu/effis     (Europe)
https://maps.effis.emergency.copernicus.eu/gwis      (global)
```
WMS 1.1.1, `SRS=EPSG:4326`, `TIME=YYYY-MM-DD` **required** on most layers.
Both GetCapabilities documents answer (257 KB global / 103 KB Europe) and the
layer names below are read from them, not guessed. **Guessing is not an option
on this server: it returns a blank image rather than a service exception for a
bogus layer name**, so a wrong name looks exactly like a quiet day.

Fire-relevant layers, GWIS (global):

| layer | what |
|---|---|
| `ecmwf.fwi` | Fire Weather Index — the headline danger field |
| `ecmwf.ffmc` `ecmwf.dmc` `ecmwf.dc` `ecmwf.isi` | the FWI system's components |
| `ecmwf.anomaly` `ecmwf.anomaly_day` `ecmwf.anomaly_sigm` | danger vs climatology |
| `modis.hs` | MODIS hotspots, with `.today` `.week` `.month` `.season` variants |
| `nrt.ba` | near-real-time burnt area, with `.bbox` and the same time variants |
| `gwis.globfire.finalperim` | GlobFire final perimeters |
| `mcd64a1.fire_frequency` | long-run burn frequency |

EFFIS (Europe) additionally serves `admin.*` boundary layers (`countries`,
`countries_borders`, `nuts3`) which are **not ours to use** — the app has its
own basemap.

Note the earlier note naming `ecmwf007.fwi` as "the one documented layer" is
wrong; the live capabilities say `ecmwf.fwi`. The `.today` / `.week` /
`.month` / `.season` suffixes are the supported way to pick a window, and are
cheaper than reasoning about `TIME` yourself — but pin `TIME` explicitly
anyway or your tile cache keys are meaningless.

FWI as a translucent raster is the right form for a continuous field. Pin
`TIME` explicitly or your tile cache keys are meaningless.

**Skip** GWIS active fires (it is the same MODIS/VIIRS detections as FIRMS,
re-served) and Copernicus EMS Rapid Mapping (human-curated PDFs published days
late — not a live feed).

### 21.6 Fire color contract

- **FRP drives the detection dot** (fill + radius), on a **log scale**. FRP is
  megawatts and heavily right-skewed — a linear ramp makes every fire on Earth
  look identical except a handful. Conventional bands (**CONVENTIONAL, not a
  standard**): <10 agricultural/small, 10–50 established, 50–100 significant
  front, 100–500 large spreading, >500 extreme.
- **Confidence is a quality flag, not intensity.** Drop `low` at wide zoom,
  restore it flown in. Never let confidence drive color.
- **GDACS alert level drives the event marker's ring or badge** — different
  shape, different role. Otherwise orange means two unrelated things on one
  screen.
- Burnt scars: charcoal/desaturated fill, thin warm outline. The scar is past;
  it must not compete with active fire.
- Smoke: neutral grey-white at three opacities. **Do not copy NOAA's KML
  colors** (green for light smoke) — green fights the fixed watch/warning
  semantics in SPEC.md §6.
- Red Flag Warning / Fire Weather Watch are **NWS products** and therefore fall
  under the fixed-color rule. The official table is committed — see §23.2.
  `Red Flag Warning` is `#FF1493`, `Fire Weather Watch` is `#FFDEAD`.

---

## 22. Volcanoes

**GDACS is not the source here.** `eventlist=VO` returned 25 features and
**zero** with `iscurrent=="true"`, all sourced from VAAC ash advisories
(`ANCHORAGE`, `DARWIN`, `TOKYO`, `TOULOUSE`, `WASHINGTON`, `BUENOS AIRES`) with
an **empty `severitydata`**. Geometry is a bare 100 km circle. Useful as an
"ash advisory active" flag, useless as a volcano layer.

Build the volcano globe on a bundled catalog plus a live alert overlay.

### 22.1 Smithsonian GVP catalog (SHIPPED) — `assets/hazards/volcanoes-holocene.geojson`

**1,196 Holocene volcanoes. 502,514 bytes raw / 43,030 gzipped.** Trimmed from
the 2.4 MB WFS response by dropping the geological summary prose and photo
fields and rounding coordinates to 4 decimals.

Last-eruption distribution, measured: **425** erupted 1900 CE or later, 238
between 0 and 1899 CE, 169 BCE, **364 with no known eruption date**.

That 425 is your "historically active" set — close to the ~500 figure, and it
is the right default filter for a globe. 1,196 dots is visual noise; 425 is a
map.

Per-feature properties (short keys, deliberately — this ships to a phone):

| Key | Meaning | Example |
|---|---|---|
| `n` | GVP Volcano Number | `210010` |
| `name` | | `"West Eifel Volcanic Field"` |
| `type` | primary volcano type | `"Volcanic field"`, `"Stratovolcano"` |
| `landform` | | `"Cluster"` |
| `last` | last eruption year, **negative = BCE, `null` = none known** | `-8300` |
| `elev` | elevation, metres | |
| `country`, `region`, `subregion` | | `"Germany"` |
| `rock` | major rock type | |
| `setting` | tectonic setting | |
| `evidence` | evidence category | |

`n` (Volcano Number) is the **universal join key** — USGS HANS returns it as
`vnum`, so the live alert overlay joins to the catalog for free.

Other GVP WFS layers, verified present:
```
GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes
GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions
GVP-VOTW:Smithsonian_VOTW_Pleistocene_Volcanoes
GVP-VOTW:E3WebApp_Eruptions1960
GVP-VOTW:E3WebApp_Emissions
GVP-VOTW:E3WebApp_HoloceneVolcanoes
```
Endpoint:
```
https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature&typeName={LAYER}&outputFormat=application/json
```
**Measured: NO `access-control-allow-origin` header.** Cannot be fetched from
the browser. Since the catalog is static, bundling it (as done) is the right
answer anyway — re-run the trim script annually, not at runtime.

Attribution required: Global Volcanism Program, Smithsonian Institution.

### 22.2 USGS HANS — live alerts — **CORS `*` verified**

```
https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes
```
3,270 bytes. Sample: `samples/other/usgs-hans-elevated.json`. Real record:

```json
{"obs_fullname":"Alaska Volcano Observatory","obs_abbr":"avo",
 "volcano_name":"Great Sitkin","vnum":"311120","notice_type_cd":"DU",
 "notice_identifier":"DOI-USGS-AVO-2026-07-27T19:33:00+00:00",
 "sent_utc":"2026-07-27 19:44:38","sent_unixtime":1785181478,
 "color_code":"ORANGE","alert_level":"WATCH",
 "notice_url":"https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-2026-07-27T19:33:00+00:00",
 "notice_data":"https://volcanoes.usgs.gov/hans-public/api/notice/getNotice/{id}"}
```

`vnum` is a **string** here and a **number** in the GVP catalog. Coerce before
joining.

Coverage is US observatories plus a few monitored foreign volcanoes — **not
global**. Outside US territory this returns nothing, and nothing is not the
same as calm. Label the layer honestly.

### 22.3 Color contract — fixed, do not theme

Two independent USGS scales, both official:

- **Volcano alert level**: `NORMAL` → `ADVISORY` → `WATCH` → `WARNING`
- **Aviation color code**: `GREEN` → `YELLOW` → `ORANGE` → `RED`

The aviation code names its own colors, so those are settled. The four alert
levels map conventionally onto the same four colors. Both belong in the SPEC.md §6
fixed-color contract alongside Saffir-Simpson.

### 22.4 Not yet chased

**The GVP Weekly Volcanic Activity Report is reachable — it wanted a browser
User-Agent.** `https://volcano.si.edu/reports_weekly.cfm` answers **200 with
306,490 bytes** when sent a normal desktop UA; a bare curl gets 403. Send the
UA from the relay, where a fixed identifying string is appropriate anyway (the
same place §23.2's mandatory NWS `User-Agent` goes). This is the global "what
is erupting right now" source and it is no longer blocked.

Still to do on it: it is an HTML page, so decide between scraping it server-side
in the relay and finding the RSS equivalent
(`https://volcano.si.edu/news/WeeklyVolcanoRSS.xml`, which was **not** re-tried
with the working UA).

**UNVERIFIED**: the nine VAAC ash-advisory feeds; NOAA NCEI
Significant Volcanic Eruptions; MIROVA/MODVOLC thermal anomalies; Sentinel-5P
SO₂ plumes. The Weekly Report is the highest-value of these — it is the thing
that tells you *what a volcano is doing right now* globally, not just in the US.

---

## 23. Floods

### 23.1 GDACS FL

Covered by §19. Source is **GLOFAS** (Copernicus Global Flood Awareness System)
for all 100 features. `severitydata` is effectively **empty**:

```json
{"severity":0.0,"severitytext":"Magnitude 0 ","severityunit":""}
```

**Severity is unusable for floods.** All 100 returned `0.0`. Rank and color by
`alertlevel` / `alertscore` only, and do not render a magnitude the source did
not give you.

Geometry: `Poly_Affected` (the footprint — use it) and `Poly_Global` (17,734
points of context — **drop it**). Sample: `samples/gdacs/geometry-FL.json`.

### 23.2 NWS alerts — **CORS `*` verified**, US only

```
https://api.weather.gov/alerts/types
https://api.weather.gov/alerts/active?event={URL-ENCODED EVENT NAME}
```

**A `User-Agent` header is mandatory.** Documented format: an app identifier
and contact — `(landfall.getgravitate.app, andy@getgravitate.app)`. Send it
from the relay.

111 event types live. Sample committed: `samples/other/nws-alert-types.json`.
The hazard-relevant names, **verified present in the live list**:

```
Flood Warning · Flood Watch · Flood Advisory · Flood Statement
Flash Flood Warning · Flash Flood Watch · Flash Flood Statement
Coastal Flood Warning/Watch/Advisory/Statement
Lakeshore Flood Warning/Watch/Advisory/Statement
Hydrologic Outlook
Red Flag Warning · Fire Weather Watch · Fire Warning · Extreme Fire Danger
Tsunami Warning · Tsunami Advisory · Tsunami Watch
Volcano Warning · Ashfall Warning · Ashfall Advisory
Dust Storm Warning · Dust Advisory · Blowing Dust Warning/Advisory
```

Live counts at capture time: Flood Warning 5, Flood Watch 7, Flash Flood
Warning 0, Red Flag Warning 0. **Zero is a real answer here and it is
`none_matched`, not `unavailable`** — the call succeeded.

Rate limit is undocumented but "generous"; on exceed, retry after ~5 s.

#### The official colours — SHIPPED, all 111 products

`assets/hazards/nws-wwa-colors.json` — a flat `{"<product name>": "#RRGGBB"}`
map, 3,551 bytes, one entry per product, keys matching `alerts/types` exactly
so it joins straight onto `properties.event`.

Extracted from **NWS's own renderer**, not a documentation page:
```
https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1?f=json
  -> drawingInfo.renderer.uniqueValueInfos[], field `prod_type`
```
That is the service NWS draws its own public map with, which makes it the
contract rather than a description of it.

The ones this app touches:

| product | hex | | product | hex |
|---|---|---|---|---|
| Tornado Warning | `#FF0000` | | Hurricane Warning | `#DC143C` |
| Tornado Watch | `#FFFF00` | | Hurricane Watch | `#FF00FF` |
| Flash Flood Warning | `#8B0000` | | Tropical Storm Warning | `#B22222` |
| Flood Warning | `#00FF00` | | Tropical Storm Watch | `#F08080` |
| Flood Watch | `#2E8B57` | | Storm Surge Warning | `#B524F7` |
| Flood Advisory | `#00FF7F` | | Storm Surge Watch | `#DB7FF7` |
| Red Flag Warning | `#FF1493` | | Tsunami Warning | `#FD6347` |
| Fire Weather Watch | `#FFDEAD` | | Volcano Warning | `#2F4F4F` |

**THE PALETTE COLLIDES WITH ITSELF AND THAT IS NWS'S PROBLEM, NOT OURS TO
FIX.** `Hurricane Watch`, `Typhoon Watch` and `Tsunami Watch` are all
`#FF00FF`; `Hurricane Warning` and `Typhoon Warning` are both `#DC143C`; four
products share `#C0C0C0`. Do not "improve" it — under §6 these are fixed, and a
Landfall-specific hurricane pink would mean the app disagrees with every other
US weather map on screen. Disambiguate with the LABEL, never the colour.

Cross-check before wiring: `lib/watchwarning.js` already carries the cyclone
subset for §6. **Reconcile the two rather than adding a second table** — two
sources for one fixed contract is the drift this file exists to prevent.

### 23.3 NWPS river gauges — **CORS `*` verified**

```
https://api.water.noaa.gov/nwps/v1/gauges/{lid}
https://api.water.noaa.gov/nwps/v1/gauges/{lid}/stageflow
https://api.water.noaa.gov/nwps/v1/gauges/{lid}/ratings
https://api.water.noaa.gov/nwps/v1/reaches/{reachId}
https://api.water.noaa.gov/nwps/v1/reaches/{reachId}/streamflow
https://api.water.noaa.gov/nwps/v1/monitor
```
Paths verified from the service's own OpenAPI document. Sample:
`samples/other/nwps-gauge-BFOF1.json` — includes `lid`, `usgsId`, `reachId`,
`name`, `rfc{abbreviation,name}`, `wfo{}`, `state{}`, `county`, `timeZone`,
and the flood-category stages.

#### The `/gauges` bbox query — and the trap in it

The spec lives at `https://api.water.noaa.gov/nwps/v1/docs/swagger.json` (NOT
`/docs`, which is the Swagger UI shell, and NOT `/openapi.json`, which 404s).
`GET /gauges` takes exactly six query params:

```
bbox.xmin  bbox.ymin  bbox.xmax  bbox.ymax   (number)
srid                                          (string)
catfim                                        (boolean)
```

**===> `srid` IS REQUIRED, AND OMITTING IT RETURNS AN EMPTY LIST, NOT AN
ERROR. <===** Measured on the same box (-100,30 to -90,40), which covers a
large, gauge-dense stretch of the central US:

| query | gauges |
|---|---|
| `bbox.xmin/ymin/xmax/ymax` alone | **0** |
| the same plus `srid=EPSG_4326` | **1346** |
| `bbox.west/south/east/north` (invented names) | 2 |

Read that table before writing the fetch. Three separate §5 failures are hiding
in it:

1. **The correct query with no `srid` says "there are no river gauges here."**
   That is a confident wrong answer, and on a flood layer it is the dangerous
   direction — it reads as `clear` when the truth is `unavailable`.
2. **Wrong parameter names are silently ignored.** They do not 400. The bbox
   is simply dropped and you get an unfiltered default page — two gauges in
   Montana for a query about Arkansas. It looks like it worked.
3. So a `/gauges` response can be empty for two completely different reasons,
   and the endpoint will not tell you which. **Send `srid` always, and treat an
   empty list from a populated bbox as a bug in our query, not as `clear`.**

### 23.4 Not chased

- **GloFAS / Copernicus CEMS** beyond what GDACS already relays — **UNVERIFIED**.
  Likely needs CDS API registration.
- **Dartmouth Flood Observatory** — their MediaWiki Cargo API returns
  `permissiondenied` for arbitrary queries. Dead end as probed.
- **NOAA CO-OPS tides** `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station={id}&product=water_level&datum=MLLW&units=english&time_zone=gmt&format=json`
  — **verified 200, CORS `*`**, 171 bytes. Small and useful for coastal surge.
- NASA MODIS/VIIRS Global Flood Product, Sentinel-1 flood mapping — **UNVERIFIED**.

### 23.5 Color contract

NWS flood products are official watch/warning colors — **fixed, not themeable**,
same rule as hurricane watches in SPEC.md §6. NWPS flood categories are
`action → minor → moderate → major`, a four-step ramp. GDACS
Green/Orange/Red rides on top as the global fallback where NWS has no coverage.

---

## 24. Drought

Drought is **structurally unlike every other hazard in this app**. It is a
slow, area-based, index-driven *condition*, not a discrete event with a
position and a track. Treat it as a choropleth, not as markers.

### 24.1 GDACS DR

42 features, **1 current**, all sourced from **GDO** (Copernicus Global Drought
Observatory). Severity is **km² of affected area**:

```json
{"severity":472578.0,"severitytext":"Minor impact for agricultural drought in 472578 km2","severityunit":"km2"}
```

Geometry is small and well-behaved — **4,193 bytes** for the East Africa event,
`Class: "Poly_area"`, `polygonlabel: "Affected Area"`. Sample:
`samples/gdacs/geometry-DR.json`.

Real event for reference: `eventid 1027450`, `eventname "East Africa-2026"`,
`name "Drought in Ethiopia, Kenya, Somalia"`, `glide "DR-2026-000117-ETH"`,
Orange, from 21 Apr 2026 to 25 Jul 2026.

**The centroid marker is close to meaningless** for a three-country drought.
Render the polygon; use the centroid only as a label anchor and a tap target.

Cadence: GDO updates on a 10-day dekad. Polling faster is wasted.

### 24.2 US Drought Monitor — the authoritative US product

Weekly (published Thursdays). Served as ArcGIS polygons. **Measured: the full
national polygon set is 5,867,972 bytes. With `maxAllowableOffset=0.02` it is
317,317 bytes** — an 18× reduction with no visible loss at globe zoom. Sample
(2 features): `samples/other/usdm-polygons-trimmed.json`.

Real properties from the live layer:
```json
{"OBJECTID":12223,"period":"20260721","dm":0,"filename":"USDM_20260721.shp",
 "endyear":2026,"endmonth":7,"endday":21,"ddate":1784592000000,
 "d0":16.74,"d1":13.94,"d2":15.41,"d3":8.17,"d4":0.78,
 "D0_D4":55.04,"D1_D4":38.3,"D2_D4":24.36,"D3_D4":8.95}
```

- `dm` is the drought class **0–4** = D0 abnormally dry → D4 exceptional.
- `d0`…`d4` and the `D0_D4` cumulative fields are **percent of area**, not
  per-polygon attributes — they are national/regional summary stats riding on
  every feature.
- `ddate` is epoch **milliseconds**.
- USDM polygons are **nested, not disjoint** — a D4 area is also inside the D0
  polygon. Draw them in ascending order or the severe classes disappear.

#### The endpoint

```
https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/US_Drought_Intensity_v1/FeatureServer/3
```
Layer name `US_Drought_Current`, polygon, `maxRecordCount` 2000, renderer keyed
on `dm`. The layer holds **5 features** — one multipolygon per class, not one
per drought area, which is why the whole country fits in a single request.
`.../FeatureServer` (no `/3`) is the 2000-present archive.

**This is Esri's Living Atlas copy, not an NDMC endpoint.** NDMC itself
publishes only bulk downloads — shapefile, GML and KMZ under
`droughtmonitor.unl.edu/data/` — with no query API and no style file. The Esri
service is the practical source; the palette below is NOT.

#### D0–D4 colours — take NDMC's, not the service's

**===> THE FEATURESERVER'S OWN RENDERER IS A CARTOGRAPHIC RESTYLE. DO NOT USE
IT. <===** It returns a muted ramp (`#F0DFA6 #EDC97B #EB9550 #D94D23 #990000`)
that is not what the Drought Monitor publishes. Using the colours that happen
to ride along with the data would have shipped the wrong fixed contract under
§6 — the whole point of that rule being that a D3 looks like a D3 everywhere.

The real palette, sampled from NDMC's own published national map
(`droughtmonitor.unl.edu/data/png/current/current_usdm.png`, a lossless PNG, so
these are exact bytes and not a screenshot guess):

| class | | hex |
|---|---|---|
| **D0** | Abnormally Dry | `#FFFF00` |
| **D1** | Moderate Drought | `#FCD27E` |
| **D2** | Severe Drought | `#FFAA00` |
| **D3** | Extreme Drought | `#E60000` |
| **D4** | Exceptional Drought | `#730000` |

Class assignment follows the published D0→D4 ramp, which is monotonic in
lightness and matches the ordering of the Esri renderer it replaces.

Note `#FCD27E` for D1: secondary sources widely quote `#FCD37F`. NDMC's own
image says `#FCD27E`. One unit apart, invisible, and recorded as measured
because the whole point of this section is not eyeballing it.

**Neither of these is a token in `config/tokens.js`.** Same rule as
Saffir-Simpson (§6): fixed contract, not themeable.

### 24.3 Copernicus GDO/EDO — global

`https://edo.jrc.ec.europa.eu` — WMS/WCS. GetCapabilities and a CDI GeoTIFF
were successfully pulled during research. Indicators: Combined Drought
Indicator (CDI), SPI at multiple accumulation windows, Soil Moisture Anomaly
(SMA), fAPAR anomaly.

**STILL UNVERIFIED: the real layer names, and the WMS endpoint itself.** Four
candidate GetCapabilities URLs were tried on 2026-07-29 and all four 404'd:
`edo.jrc.ec.europa.eu/services/wms`, `/edora/wms.php`, `/gdo/php/wms.php`, and
`drought.emergency.copernicus.eu/geoserver/wms`. The earlier research note
saying GetCapabilities "was successfully pulled" did not record the URL, and it
has not been reproduced. Treat GDO as unreachable until someone finds the live
endpoint — do not guess a layer name onto a host that does not answer.

Drought is 5th in the build order (§25.6) and GDACS DR is derived from GDO, so
this blocks the *global raster overlay only*, not the drought layer itself.

GDACS DR is *derived from* GDO, so this is the upstream source, not a second
opinion.

### 24.4 Not chased

**UNVERIFIED**: SPEI Global Drought Monitor, NASA GRACE groundwater
(nasagrace.unl.edu), drought.gov / NIDIS API, CHIRPS, GPM IMERG, SMAP, NOAA
STAR VHI.

### 24.5 Rendering

Choropleth polygons, low opacity, no stroke or a very dim one. Drought must sit
*under* every other layer — it is a background condition, and a saturated
drought fill will destroy the night-sky globe and fight the fire and cyclone
colors. Weekly/dekadal cadence means the timestamp matters more than usual:
show the valid date prominently, because "current" here can be six days old and
that is normal, not stale.

---

## 25. Cross-cutting

### 25.1 Verified CORS results, 2026-07-28

Measured with `curl -sI -H "Origin: https://landfall.getgravitate.app"`.
Per SPEC.md §4 the browser is the final word, but these were real requests with a
real `Origin`.

| Endpoint | Status | ACAO |
|---|---|---|
| GDACS eventlist | 200 | `*` |
| GDACS getgeometry | 200 | `*` |
| USGS quake summary feed | 200 | `*` |
| USGS fdsnws query | 200 | `*` |
| USGS HANS volcano | 200 | `*` |
| NIFC WFIGS (geojson) | 200 | `*` |
| api.weather.gov | (400 on a bad param) | `*` |
| NWPS gauges | 200 | `*` |
| NOAA CO-OPS | 200 | `*` |
| raw.githubusercontent.com | 200 | `*` |
| **Smithsonian GVP WFS** | 200 | **none** |
| **NASA FIRMS bulk CSV** | 200 | **none** — and 5.66 MB |

Everything still goes through the relay. CORS-open is a permission, not a
capacity plan.

### 25.2 The three states, per hazard

SPEC.md §5 requires `unavailable` / `none_matched` / `clear` to be distinct. This
is harder here than it was for cyclones and needs deciding **per layer and per
viewport**, not once:

- **Wildfire**: there are always fires somewhere on Earth, so global `clear`
  essentially never happens — but in-view `none_matched` happens constantly.
- **Smoke**: HMS is daylight-only. No polygons at 03:00 is **`unavailable`**.
- **Volcano**: USGS HANS covers US observatories. Empty outside the US is
  **`unavailable`**, not calm.
- **Flood severity**: GDACS returns `0.0` for every event. That is a missing
  field, not a magnitude of zero. Render nothing, not "0".
- **Earthquake `alert`**: absent PAGER is **not** green.

### 25.3 Rate limits and keys

| Source | Key | Limit |
|---|---|---|
| GDACS | no | none documented |
| USGS earthquake | no | none documented |
| USGS HANS | no | none documented |
| Smithsonian GVP | no | none documented (bundle it anyway) |
| NIFC ArcGIS | no | `maxRecordCount` 2000 |
| api.weather.gov | no | undocumented; **User-Agent mandatory** |
| NWPS | no | none documented |
| **NASA FIRMS** | **yes, free** | **5000 / 10 min**, key server-side only |

### 25.4 Attribution to add to `map/attribution.js`

GDACS (EU/JRC) · USGS · Smithsonian Institution Global Volcanism Program ·
NASA FIRMS / LANCE · NIFC / WFIGS · NOAA / NWS / HMS · Copernicus (EFFIS,
GWIS, GDO) · US Drought Monitor (NDMC / USDA / NOAA) · PB2002 plate boundaries
(Bird 2003, via fraxen/tectonicplates).

### 25.5 Constants to define before writing any fetch logic

Per SPEC.md §"Tuning", define the constant first. New ones this expansion needs:

- Poll interval per hazard — they are wildly different. EQ is minutes; WF is
  sub-daily; DR is a 10-day dekad; USDM is weekly. One shared interval is wrong.
- Cache TTL per hazard, same reasoning.
- **Max rendered features per hazard per zoom** — especially fire (see §21.2).
- Simplification tolerance per hazard: `maxAllowableOffset` 0.02 at globe zoom,
  0.002 flown in.
- Minimum magnitude / minimum FRP / minimum drought class display thresholds.
- Volcano catalog filter: default to `last >= 1900` (425 of 1,196).

### 25.6 Recommended build order

1. **Earthquakes.** Best data, CORS-open, small payloads, and the plate-boundary
   layer makes it look finished immediately. Proves the multi-hazard shape at
   the lowest risk.
2. **Volcanoes.** The catalog is already in the repo and static — no fetch, no
   failure states, and 1,196 dots on a globe is a strong visual.
3. **Wildfire.** Highest value, highest risk. Do not start it until the relay
   downsampling story is real.
4. **Flood.** GDACS + NWS alerts. Blocked on nothing, but severity is unusable
   so it needs a design answer first.
5. **Drought.** Last. It is a different rendering paradigm and it will fight
   every other layer for the background.

---

## 26. What is still open

Ordered by how much it blocks work. **Earthquakes and volcanoes are not on this
list — both are unblocked.**

1. **A free NASA FIRMS `MAP_KEY`.** Email signup at
   `firms.modaps.eosdis.nasa.gov/api/map_key/`. Nothing automated can do this
   step; it needs a human and an inbox. Blocks all real fire-detection work,
   which is 3rd in the build order.
2. **The trimmed NIFC perimeter payload size.** Every attempt to measure it hit
   the service's shared 429 (§21.3). Measure it from behind the relay once the
   cache exists — and note that a 429 arrives as HTTP 200 with an error body.
3. **The Copernicus GDO WMS endpoint.** Four candidate GetCapabilities URLs
   404'd on 2026-07-29 (§24.3). Blocks the global drought raster only; drought
   is 5th in the build order and GDACS DR still works without it.
4. **GVP Weekly Report: scrape or RSS.** The HTML page is reachable with a
   browser User-Agent (§22.4). The RSS equivalent was never re-tried with that
   UA — try it before writing a scraper.
5. **Reconcile `lib/watchwarning.js` with `assets/hazards/nws-wwa-colors.json`.**
   Two tables now describe one fixed contract (§23.2). Not blocking, but it is
   exactly the drift this file exists to prevent, so do it before the second
   hazard lands rather than after the fifth.
