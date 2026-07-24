# SPEC.md — Landfall

**Status: SPEC.** This document describes the project only as it is right now.
It is not a log — when a fact goes stale, delete it and replace it. No "update:"
notes, no history.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact we haven't tested yet.
Nothing marked `[VERIFY]` may be treated as confirmed.

---

## 1. What this is

A cross-platform PWA (Progressive Web App — a website that installs to the home
screen, runs in its own window, and works offline via a service worker) that
renders live tropical cyclone data on a full-screen 3D globe. Wireframe at
distance, detail fading in as you descend. All active storms plotted worldwide;
selecting one flies the camera to it. Installs on iOS and Android; runs in any
desktop browser with mouse and keyboard. No app stores. Spiritual successor to
ha-hurricane-tracker — not a port.

Solo project. Aaron is founder, sole developer, and primary user. Default to the
simplest path; no over-engineering for scale.

- **App name:** Landfall
- **Subdomain:** landfall.getgravitate.app
- **Repo:** `landfall`

## 2. Stack (settled — don't re-litigate without new info)

- **Two-engine hybrid.** The wide "planet" view is a Three.js clear globe: a
  see-through sphere with land on its surface, a floating geodesic cage, the back
  hemisphere visible through the front. MapLibre owns everything from the basin
  band inward — detailed coastline and all storm data. Each engine does what it
  is good at: Three.js the entry, MapLibre the streamed-detail cartography and
  data layers that are miserable to rebuild by hand. MapLibre loads lazily behind
  the 3D globe so the entry stays instant. The crossfade IS the intended "matrix
  dissolves into the detailed globe" effect, not a compromise seam.

  **MapLibre owns the ONE zoom and the ONE camera; the clear globe is a pure
  overlay slaved to it.** You start zoomed out in "space" (MapLibre at opacity 0,
  the clear globe filling the screen) and zoom in — the clear globe crossfades
  out and MapLibre crossfades in across the `zSpace..zHandoff` band. Zoom out, or
  Esc, to return. **No dive button, no space/map modes** — one continuous zoom,
  which is why native scroll-to-zoom and drag-to-pan work everywhere (`#gl` is
  `pointer-events:none`, so every gesture falls through to MapLibre).

  It renders inside MapLibre's own `render` event, not a separate rAF, so the two
  are the same frame. Each frame the Three camera distance is set from MapLibre's
  measured NEAR-CENTER surface scale (px per radian at screen centre — matching
  the limb overshoots on a perspective globe) and the clear globe mirrors
  MapLibre's center and bearing, so the two stay locked.

  The clear globe renders: solid charcoal land on the near hemisphere with the far
  continents visible through the clear ocean, dimmed to read as "behind" (a
  two-pass glass globe, `land3dBack`); grey coastlines; the cyan geodesic node
  cage; storm spiral glyphs in category color (the §9 planet-band glyphs — the
  same two-arm spiral MapLibre stamps, shared via `map/glyph.js`, hemisphere-split
  into two Points because the spiral flips at the equator and a Points material
  carries one texture; per-storm color rides a geometry color attribute so a
  mixed-severity basin is still one draw call per hemisphere; they live in the 3D
  scene because MapLibre is at opacity 0 in space); and **node elevation AND node
  color encoding live storm severity** (§9).

  The cage rests at `DARK.mesh` — deliberately the DIM cyan of the coastline stack
  (`coastGlowSoft`), not the bright `coastGlow`. At ~7,680 edges laid over the
  coastlines in the same hue, a bright cage stops the continents reading as edges
  at all; same color family, cage behind the coast. Nodes rest one step brighter
  (`DARK.node`). 3D land sits at `land3d`, in MapLibre's blue land family but
  lighter than `DARK.land` — the clear globe has no opaque backing, so an exact
  match would sink the continents into the see-through ocean.

  Severity peaks are a **sharp local spike, not a regional swell**: `geoDetail` 3
  (~2,562 nodes, `[VERIFY]` frame budget on a mid-range phone), `stormSigma` 0.16
  rad (~9°) so only the nearest nodes rise, `stormAmp` 0.5, and a perceptual ramp
  (sqrt curve, 0.16 floor) so a 40 kt TS clears the cage's decorative noise
  instead of reading as flat ocean.

  **Elevation and color are one signal from one number.** Each node holds a single
  0..1 lift from the nearest storm (nearest wins outright — a node between a Cat 1
  and a Cat 5 must not invent an in-between hue that means nothing). That lift
  raises the node and blends its color from resting cyan toward that storm's
  §6 category color, so a tall node is always a colored node and the two channels
  cannot drift apart.

  The soft falloff is free: the cage is `LineSegments` with a per-vertex color
  attribute, so the GPU interpolates along every segment. An edge running from an
  unaffected node to a lifted one renders as a smooth cyan→category gradient —
  no shader, no second layer, no extra draw call.

  **The fade lives at the EDGE of the raised region, not across it.** Lift is
  remapped through a threshold band (`stormColorOnset` .. `stormColorFull`), so
  the entire lifted cage sits at its storm's exact `CATEGORY_COLOR` and the
  gradient occupies roughly one ring of nodes just outside it. The first version
  used a single gamma exponent across the whole lift range, which looked right in
  the numbers and wrong on glass: tint spread over nodes that were barely raised,
  wrapping every storm in a wide halo of muddy purple-grey, and the peak never
  reached its true hue (a TS topped out near #31A67B instead of its green). A
  storm color that never actually appears is not a severity color.

  The RESTING cage stays at FULL brightness (`meshRestDim` 1.0). A 0.55 dim
  shipped once to make storm colors "pop" and made the calm lattice nearly
  invisible on a phone. The cage is the planet-band look; dimming the 99% of it
  that is storm-free to flatter the 1% that isn't is the wrong trade. Storm
  colors get their separation from saturation and a narrow fade band, not from
  suppressing everything around them.

  **The cage depth-tests against the land.** Far-side lattice hides behind the
  near-side continents rather than showing through them — without it you could
  read the back of the globe straight through South America and the sphere
  stopped looking like a solid object. Land writes depth on its front face only,
  and its ocean pixels are discarded by `alphaTest`, so the far cage still shows
  through open water. That is the intended read: a clear globe whose LANDMASSES
  are opaque, not a wireframe ball. Cage and nodes must carry the same depth
  setting or the lattice comes apart at the limb.

  Storm data arrives through `map/heightfield.js`'s `setStormPoints()` seam, fed
  by `main.js` from the data store (both sources merged, one weighted point per
  storm at its current fix, `sevFromKt`). The full-track comet-tail later feeds
  the SAME seam — the elevation code does not change.

  Code: `map/globe3d.js` (overlay: land, coast, cage, nodes, the MapLibre-slaved
  render loop, the crossfade), `map/heightfield.js` (cage geometry + node
  elevation), `map/coastline.js` (baked world coastline), `map/glyph.js` (the
  shared spiral), `lib/geo.js` (lon/lat↔vector math), wired in `main.js`.
  `proto-globe.html` / `proto-transition.html` are standalone reference proofs,
  not loaded by the app.
- MapLibre GL JS v5+, globe projection, loaded from CDN. Owns the basin band and
  closer (see the hybrid note above).
- Wireframe-at-distance via zoom-stopped line layers in a custom style JSON.
- Vanilla JS, ES modules, no framework, no build step.
- Basemap tiles: OpenFreeMap (OpenMapTiles), styled by us (see §11).
  R2/Protomaps was tried and retired.
- PWA: web app manifest + service worker. Maskable icons for Android; 180x180
  non-transparent apple-touch-icon for iOS.
- Hosting: Cloudflare Pages (free tier). Deploy loop: push to main on GitHub →
  Pages builds → live URL. Done = deployed and confirmed on a real phone.
- Server side is two small Pages Functions, both dumb by design: the relay
  (§4, forward-and-cache) and the tile proxy (§11, read-bytes-and-cache).
  That is the whole backend.
- **Firebase is not used.** Not a cost question — the reason is one vendor and
  no bandwidth meter. Cloudflare's free tiers run no egress meter; Google Cloud Storage bills
  per GB out. One cloud account, one dashboard, one bill to watch.
- **No push notifications in v1.** They would break three settled decisions at
  once: the relay stops being dumb, background work becomes necessary, and home
  coordinates would have to live on a server (§8). That converts Landfall from a
  static site with a cache in front of it into a service with users and a
  subscriber database. The half-measure is worse than nothing — notifications
  that only fire while the app happens to be alive are unreliable by design
  (iOS kills backgrounded service workers aggressively), and an unreliable storm
  alert teaches you to trust a silence that means nothing. Same failure class as
  showing "All Clear" during an outage. Revisit post-v1 as a deliberate
  architecture change, never as a feature that quietly drags a server in behind
  it.

## 3. Domain, accounts, and live infrastructure

All of this exists and is wired. Nothing in this section is pending.

- **Domain:** getgravitate.app registered at **Namecheap**, and it stays there.
  A CNAME record (`landfall` -> `landfall-99g.pages.dev`) points the subdomain
  at Cloudflare Pages. The apex still points at Firebase hosting for the
  existing Gravitate site and was not touched.
- **Live URLs:** `landfall.getgravitate.app` and `landfall-99g.pages.dev`.
- **Cloudflare account:** live. Billing alert set at **$1** — any charge at all
  is a signal something is misconfigured, not a warning that a limit is near.
- **R2:** provisioned but DORMANT — the app no longer serves tiles from it
  (§11, retired 2026-07-24). Bucket `landfall-tiles` still holds
  `landfall-z0-8.pmtiles` (525 MB) and the Pages binding `TILES_BUCKET`
  (Production and Preview) is intact, so flipping `TILES.useR2` back on revives
  it with no infra work. The bucket's public r2.dev URL and permissive CORS
  policy are unused and harmless. **No payment method is required for R2.**
- **GitHub:** `github.com/aaronmayeux/landfall`, public, branch `main`.
- **Cloudflare Pages project:** `landfall`. Framework preset None, no build
  command, output directory `/`. Push to main deploys automatically; there is
  no build step and there must never be one.

## 4. Data architecture

### CORS ground truth (verified by Aaron in Chrome from https://example.com, 2026-07-22)

**Only a real browser can answer this.** A server emits
`Access-Control-Allow-Origin` only in response to a request carrying an `Origin`
header, and server-side fetches (Cloudflare Functions, curl) do not send one.
Edge probes therefore report "no CORS header" for endpoints that work fine in a
browser. The table below is browser-tested and is the truth; do not "correct" it
from a server-side probe.

| Endpoint | Browser fetch | Consequence |
|---|---|---|
| `https://www.nhc.noaa.gov/CurrentStorms.json` | **BLOCKED** (no CORS header; server itself returns 200) | Must go through the relay |
| `https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer` | **OK** | Direct fetch from the app |
| `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP` | **OK** | Direct fetch from the app |
| `https://ftp.nhc.noaa.gov/atcf/aid_public/` (model a-decks) | **BLOCKED** (no CORS header; server returns 200) | Must go through the relay |

### Probed live 2026-07-23 — confirmed, no longer open
Probed against live storms Bertha (`al022026`, TS) and Fausto (`ep062026`, HU).

- **MapServer per-storm layers fully replace the zipped shapefiles.** All eight
  layer types returned valid GeoJSON with real geometry via `f=geojson`
  (service reports `JSON, geoJSON, PBF`, ArcGIS 11.3).
- **Layer-id math confirmed exactly as documented below**: block starts AT=4,
  EP=134, CP=264, stride 26, five slots per basin.
- **Slot lookup needs no search.** The feed's `binNumber` ("AT2", "EP1") gives
  the slot directly: `base = block + (slot-1) * 26`.
- **`CurrentStorms.json` advisory number is `publicAdvisory.advNum`**, a
  zero-padded string ("017"). Never `parseInt` it.
- **There is NO final-advisory flag.** Confirmed absent across both storms.
  §5's ghost wording is therefore always the cautious form.
- **GDACS per-event geometry works and is FAST** — 375–984 ms for three events,
  85 features (58 polygons, 26 linestrings, 1 point). The HA project's 90-second
  behaviour did not reproduce.

### Still untested — verify before building on them
- `[VERIFY]` IEM GOES satellite WMS (`https://mesonet.agron.iastate.edu/cgi-bin/wms/goes_east.cgi`).
- `[VERIFY]` NOAA nowCOAST MRMS radar ImageServer (same host as the MapServer
  that passed, so likely OK; unproven).
- `[VERIFY]` Model a-deck parsing (`ftp.nhc.noaa.gov`, relay-bound). Not probed.
- `[VERIFY]` Everything above was one sample on one afternoon from Cloudflare's
  edge. Response times measured from a datacentre are not response times from a
  phone on cell data. **One path is now exempt:** GDACS per-storm geometry
  through `/api/gdacs/geometry` was confirmed on a phone 2026-07-24 — cold
  first selection, fast on every one after. Everything else in this list is
  still datacentre-only.

### The relay (Cloudflare Pages Function) — settled: keep it dumb
Forward and cache only. **The app merges NHC and GDACS client-side.** Reasons,
in order:
1. Merge logic in the browser is debuggable on a phone plugged into a laptop.
   Server-side it's a black box needing a redeploy per tweak.
2. The fiddly rules live in the merge (NHC beats GDACS in shared basins; GDACS
   chronology rebuilt from time-labelled circles) and will be tweaked often.
3. One source down must not blind the other (§5). Client-side, NHC storms draw
   even while GDACS is timing out.

Relay jobs:
1. Fetch-and-forward the two CORS-blocked NHC feeds (storm list, model a-decks).
2. **Edge-cache GDACS per-storm geometry — BUILT 2026-07-24, CONFIRMED ON
   GLASS 2026-07-24 (`/api/gdacs/geometry`, phone, live GDACS storm).** First
   selection of a storm in a cold colo is the slow one; every selection after
   it is fast. That is the edge filling and then serving, which is exactly the
   shape the fix predicted, and it is now measured on a phone rather than
   inferred from a datacentre — the `[VERIFY]` caveat at the top of §4 does not
   apply to this path any more. **It was specified here from the start and the
   route did not exist.** For a full day the app fetched `gdacs.org` directly
   while three TTL constants in `config/constants.js` pointed at nothing. On
   glass that read as "the GDACS storm loads slow while the NHC storms are
   instant", and it was misattributed to the wind-field smoothing work before
   anyone checked whether the route existed. **Look for the route before
   blaming the algorithm.**

   **THIS IS A SPEED FIX, NOT A CORS FIX.** GDACS sends the header and the
   browser can reach it — §4's CORS table says so. The reason is size and
   distance: 180–400 KB per event from a European server, pulled fresh every
   load (`relay.js` sets `cache: 'no-store'`), against small US-hosted NHC
   queries beside it. Cloudflare's edge now holds it, so every load after the
   first in a given colo is local. The flaky-endpoint story is NOT the reason
   and never was: the HA project's 90-second timeout has now failed to
   reproduce twice (375–984 ms, then 1.28 s). The cache stays cheap insurance
   against a source that has misbehaved before, on top of the size argument
   that actually justifies it.

   **The client passes the PUBLISHED upstream URL as a parameter, and the
   relay validates it.** §4 requires reading `url.geometry` off the feed
   rather than constructing it, so the URL has to travel from client to
   relay — and a function that fetches whatever URL it is handed is an open
   proxy. `safeUpstream()` therefore requires https, host exactly
   `www.gdacs.org`, and the exact geometry path, and refuses with a 400
   without fetching. Cache keys are the validated URL, so `episodeid` keys the
   cache for free and a new episode self-invalidates.
3. **Proxy Mapbox geocoding** (`/api/geocode`). Not a CORS problem — a SECRET
   problem. A Mapbox token in a static bundle is a public token, and a stolen
   geocoding key bills until somebody notices. `MAPBOX_TOKEN` is a Pages
   environment variable (Production AND Preview); it is never in the repo.
   The function rate-limits per IP, caps query length, caches 30 days (an
   address does not move), and returns CODES, never prose — the client turns
   `geocode_not_configured` / `geocode_auth_failed` / `rate_limited` /
   `geocode_unreachable` into sentences, because that is the layer with the
   context (§5). Autocomplete is debounced client-side and floored at a minimum
   length; both are cost controls as much as UX ones.
   **Mapbox over Google:** comparable accuracy on addresses, materially cheaper
   at volume, and no licensing friction — Google's terms restrict displaying
   their geocoding results on a non-Google map, which is exactly what a
   MapLibre globe is. Nominatim was rejected on accuracy for a decision screen.

Everything not listed above is fetched directly by the browser.

### Sources and split (carried over from the HA project — proven logic)
- **NHC/CPHC** (native, full-fidelity): Atlantic, East Pacific, Central Pacific.
  Storm ids are basin-prefixed: `al` / `ep` / `cp`.
- **GDACS** (EU/JRC, coarser): Northwest Pacific, North Indian, Southwest
  Indian, Australian region, South Pacific.
- Where both know a storm, **NHC wins** (drop GDACS storms sitting in NHC basins).
- GDACS quirks — **RE-READ LIVE 2026-07-24 via `/api/gdacs/inspect`** against
  NOUL-26 (`1001294`, ep 6, Northwest Pacific). What held and what did not:
  - **CONFIRMED: the geometry URL is PUBLISHED, not guessed.** Every event
    carries `url.geometry`, `url.report`, `url.details`. Geometry is
    `gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=…&episodeid=…`.
    **Read it off the feed; never construct it.**
  - **CONFIRMED: three nested band classes exist.** `Class` carries
    `Poly_Green` / `Poly_Orange` / `Poly_Red`, and `featuretype` splits
    `WindRadii` (bands) from `PointRadii` (track dots).
  - **CONFIRMED: usable times exist.** `polygondate` parses cleanly and steps
    in 12 h increments; `polygonlabel` carries `24/07 12:00 UTC` stamps. The
    inherited "chronology must be reconstructed from time-labelled circles"
    claim is *softer* than reality — the dates are right there as ISO
    timestamps.
  - **DEAD: the 90-second flaky endpoint.** 1.28 s / 224 kB / 44 features,
    now contradicted twice (2026-07-23 and 2026-07-24). The relay cache stays
    as cheap insurance, NOT because the endpoint is slow.
  - **SETTLED 2026-07-24 — the band thresholds, read off live data.** The
    inherited claim (Green/Orange/Red = 34/50/64 kt) was **WRONG**. GDACS
    publishes ROUND METRIC thresholds, each stated in the band's own
    `polygonlabel`:

    | `Class` | published | ≈ knots | median area (sq°) |
    |---|---|---|---|
    | `Poly_Green` | 60 km/h | 32.4 | 3.92 |
    | `Poly_Orange` | 90 km/h | 48.6 | 1.03 |
    | `Poly_Red` | 120 km/h | 64.8 | 0.16 |

    Confirmed two independent ways: the labels state the speeds, AND the
    areas nest strictly (Green widest → Red smallest), which is what wind
    bands must do physically. We draw them in the §6 34/50/64 colors because
    they are the same three severity tiers; we do NOT relabel them as 34/50/64
    kt anywhere the user sees. The panel shows GDACS's own km/h.
  - **`alertlevel` is NOT a threshold and never was.** It is on every geometry
    feature reading "Orange" — the storm's HUMANITARIAN level. Same three
    color words, two unrelated meanings, one payload. `bandFromFeature()`
    therefore requires the class and the published label to AGREE within
    `bandLabelToleranceKmh`; a contradiction drops the feature rather than
    painting a guessed color (§6).
  - **GDACS publishes MORE than the spec claimed.** Also confirmed present:
    an uncertainty cone (`Poly_Cones`, one polygon) and intensity-labelled
    2-point track segments split past vs forecast by a `forecast` property
    that arrives as the STRING "true"/"false". `data/gdacs.js` declared
    `cone`, `forecastTrack` and `pastTrack` false on inherited authority and
    was wrong on all three. Corrected.
  - **Bands are PER-TIMESTEP, not merged** — 7 polygons per color across 6
    forecast times. So the §7 wind pair works for GDACS: `windCurrent` is the
    EARLIEST timestep (the analysis time, matching the storm's `todate`),
    `windSwath` is every timestep merged.
  - **GDACS BANDS ARE QUADRANT-SHAPED. The inherited "one radius, symmetric
    circles" claim is DEAD — disproven on glass 2026-07-24** (Aaron's phone,
    NOUL-26). They are four-lobed, with visible notches where quadrants
    meet, exactly like NHC's. Any design note apologising for GDACS drawing
    circles is void, and the detail panel's source-limitation sentence was
    removed rather than left as an apology for a limitation that does not
    exist.
  - **The swath is MERGED into one smooth outline per threshold**
    (`lib/bandmerge.js`) for the same reason NHC's is: seven translucent
    quadrant shapes per color compound their fills at every overlap, and
    Aaron rejected that look on both sources. Different input, so a different
    merge — NHC sweeps a corridor from quadrant RADII, GDACS has only
    finished POLYGONS, so its merge is an occupancy-grid union plus boundary
    trace. **The finishing pass is shared**: uniform resample then iterated
    3-point averaging, extracted to `lib/ringpolish.js` (§12) rather than
    copied.
  - **GDACS PUBLISHES ITS OWN PRE-MERGED SWATH. Use it.** Read from a raw
    coordinate dump 2026-07-24 (`?dump=1`), which is the first time this
    project looked at real GDACS rings rather than approximations. Under each
    band `Class` there are TWO kinds of polygon, distinguished by
    `featuretype`:
    - `"WindRadii"` → one forecast timestep's footprint.
    - `null` → **the full-track corridor for that threshold**, labelled with
      the speed (`"60 km/h"`), tracing the whole track nose to tail WITH
      PROPERLY ROUNDED END CAPS.

    `data/gdacs-geometry.js` now uses the published corridor for `windSwath`.
    The occupancy-grid reconstruction in `lib/bandmerge.js` is kept only as a
    fallback for a payload that lacks it. **The census never revealed this
    because it groups by `Class`, and the sorter's
    `featuretype === 'WindRadii'` test filtered the merged feature out** —
    two commits were spent rebuilding a product that was sitting in the same
    response.
  - **ALL THREE BAND CLASSES CONFIRMED WORKING ON GLASS 2026-07-24.** Green,
    orange and red all render as clean corridors with rounded ends. The
    published-swath path keys on `featuretype`, not on color, so one code
    path serves all three — verified on a phone, not inferred.
  - **`polygondate` MEANS TWO DIFFERENT THINGS. Read it carefully.**
    - On per-timestep bands (`featuretype: "WindRadii"`) it is the VALID
      time, and it matches that feature's `key`.
    - On the published swath (`featuretype: null`) and on every centre dot,
      it is the ISSUE time — identical across all of them.

    Current code happens to use it correctly everywhere (`splitPair` reads
    only WindRadii members; the stamp wants the issue time and takes it from
    the cone), but nothing enforces that. **Anything new that reads
    `polygondate` must first establish which kind of feature it is on.**
  - **THE CENSUS HAD BOTH ANSWERS ALL ALONG and they were misread as noise.**
    `areaSqDeg.min: 0` on every band class WAS the degenerate polygons.
    `areaSqDeg.max` far above the median WAS the swath feature sitting among
    the timesteps. The summary was not wrong; the reading was. Worth
    remembering before commissioning another round trip: re-read what is
    already in hand first.

### GDACS forecast points — BUILT 2026-07-24, from a full dump of all 12
### "Point" features (NOUL-26). Owner: `data/gdacs-points.js`.

1. **FORECAST POINTS EXIST AND ARE WIRED.** `can.forecastPoints` is now true.
   The eleven `Point_Polygon_Point_N` features each carry:
   - `key`: `"07241200"` — MMDDHHMM UTC, the valid time
   - `polygonlabel`: `"24/07 12:00 UTC"` — the same instant, independently

   Both are parsed and must AGREE; a contradiction drops the point. The long
   confusion was `polygondate`, identical on all eleven because it is the
   ISSUE time. Never read it as a per-point time.

   **THE DOTS ARE POLYGONS, NOT POINTS** — 129-vertex circles of radius
   0.03°. The single true GeoJSON Point in the payload is `Point_Centroid`,
   the current position, which carries no time and must never join the track.
   A first read of one feature (index 0) concluded "true Point" and happened
   to have grabbed the centroid; dumping all twelve corrected it. **Sampling
   one feature to characterise a set is how that mistake is made.**

   Centres are taken from the bounding box — exact for a symmetric ring, and
   indifferent to vertex count.

2. **THE CADENCE IS ASYMMETRIC.** Past points are **6 h** apart, forecast
   points **12 h**. Measured across all eleven. Do not assume a uniform step.

3. **THE SPLIT IS COMPUTED, NOT INDEXED.** The current fix sat at `Point_5`
   on this storm, but that is a function of the storm's age. Points are split
   past/forecast against the issue time. A hardcoded index would draw history
   as forecast on a younger storm.

4. **THE BAND↔POINT JOIN IS VERIFIED, both dumps, real bytes.** The six
   forecast point times reproduce the six `key` values on the wind bands
   exactly. Bands and points line up with no interpolation.

5. **`polygondate` HAS NO TIMEZONE MARKER AND THAT WAS A LIVE BUG.** GDACS
   publishes `"2026-07-24T12:00:00"`; JavaScript reads a zoneless date-TIME
   as LOCAL. Measured under `TZ=Asia/Manila`: parsed to 04:00Z, eight hours
   early. The times ARE UTC. All parsing now goes through
   `parseGdacsStamp()`, which appends the Z. Band selection never noticed
   (it only compares these to each other), but the "as of" line shown to the
   user was wrong by the device offset for everyone outside UTC.

6. **HOW INTENSITY IS READ, and its hard ceiling.** Track segments carry
   `TD` / `TS` / `HU` in `polygonlabel`, joined to a dot by coordinate. TD
   and TS map to our first two colors. **`HU` maps to NO category**: GDACS's
   strongest band is 120 km/h = 64.8 kt, which IS the Cat 1 floor, so a Cat 1
   and a Cat 5 publish an identical band set. A hurricane dot states `HU`
   and stays generic rather than borrowing a color it has not earned (§6).
   The analysis dot is the exception — see §15's open question before
   trusting it.

   **The `Line_*` segments HAVE been read** — the suffixes turned out to be
   grouped by intensity rather than chronology (§15), and the leg direction
   was wrong until glass caught it. The coordinate join and the TD/TS/HU
   vocabulary are measured, not inferred. This is no longer an open probe.

2. **TRACK SEGMENTS CHAIN INTO ONE ORDERED PATH, AND CARRY INTENSITY.**
   Verified by walking them: the ten 2-point `Line_Line_N` segments link
   end-to-end into a single continuous 11-point track, from `128.4,17.4`
   through the current position to `112.9,26.5`. The `forecast` flag
   (`"true"`/`"false"` strings) splits past from future, and the storm's
   current position sits exactly on the boundary. Each segment's
   `polygonlabel` is an intensity code — `TD`, `TS`, `HU` — and that code is
   what gives the centre DOTS their reading. **The track LINES are not
   colored by it, by decision (§14).**

   The inherited "track lines are grouped by intensity, not time" claim is
   half right: they are labelled by intensity, but they chain by geometry
   into correct chronological order, so nothing needs reconstructing.

### GDACS band quirks (continued)

  - **THE CURRENT FIELD'S RADIAL SEAMS ARE SMOOTHED — third attempt, and the
    first two are recorded because the failure is the lesson.**

    A band is four SECTORS of different radii joined by RADIAL EDGES at
    90/180/270. Measured on the real green band (centre 120.4/19.7): the
    radius steps 1.3268 → 0.7961 across due-west (**32 nm**) and 27 nm across
    due-east. Within a sector the radius varies smoothly; only the seams jump.

    **TWO ATTEMPTS SHIPPED AND NEITHER COULD HAVE WORKED.** Both smoothed the
    ring in X/Y:
    1. Polish-then-simplify. Douglas-Peucker at 0.01° keeps arc points about
       sqrt(8·R·tol) apart — ~0.32° on a 1.3° band — so it cut long chords
       back across the curves the polish had just built.
    2. Polish replacing simplify. Better, still invisible: the XY smoothing
       window is `sqrt(passes/2) × spacing` = **1.5 nm at the shipped
       settings, against a 32 nm notch.** Measured effect on the seam: one
       vertex moved 0.005°.

    **AND THE DESIGN ITSELF WAS SELF-DEFEATING.** A seam is a REFLEX corner,
    so rounding it means moving OUTWARD — and the containment rule ("never
    leave the published ring") forbade exactly that. With a large enough
    window it either did nothing or tore the ring into zero-radius gaps. A
    constraint was written that prohibited the fix.

    **AS BUILT: smooth r(theta), not x/y.** `smoothRadialSeams()` samples the
    radius at 360 bearings, blurs it with a raised-cosine circular kernel
    (`RING_POLISH.seamWindowDeg`, 24°), and rebuilds. Longitude scaled by
    cos(lat) so the profile is measured on real distance.

    This is the method `lib/windswath.js` already uses (`radiusAtBearing`) and
    the HA project before it: **a cosine blend CANNOT OVERSHOOT the values it
    blends between.** Every weight is non-negative and they sum to 1, so a
    smoothed radius always lies between the min and max published radius
    inside its window — the same bound windswath states. Verified on the real
    seam: overshoot 0.000000°, area −0.07%, and the step becomes a ramp
    (0.795 → 0.924 → 1.038 → 1.119 → 1.273 → 1.317 across 250°–280°).

    **THE QUADRANT STEP IS A REPORTING ARTIFACT, NOT WEATHER.** Four radii are
    samples of a continuous field, exactly as 6-hourly fixes are samples of a
    continuous track. No storm's wind ends in a square step at due west. The
    spec already made this argument for bridging bands across TIME; this is
    the same argument in the ANGULAR dimension. The earlier claim in these
    notes that the steps were "real asymmetry to preserve" was wrong — the
    ASYMMETRY is real, the STEP is not.

    **NHC IS NOT TOUCHED AND MUST NOT BE.** `+13 Advisory Wind Field` already
    publishes a smooth product; a polish pass was briefly added there and
    reverted, having done nothing but cost frames. §14's both-sources rule is
    satisfied by both rendering smooth, not by both running the same code.

    Only the DRAWN timestep is smoothed — the other ~15 band features feed
    only the swath fallback, which `lib/bandmerge.js` finishes itself.
    Degenerate rings pass through untouched.

    **THE METHOD LESSON, third time this project has paid it:** measure the
    FEATURE you are trying to change against the STRENGTH of the tool before
    writing code. One line — smoothing window vs notch depth — would have
    killed both failed attempts before they shipped.

  - **DEGENERATE ZERO-AREA POLYGONS ARE THE PINCH, and they are real.** Where
    a threshold does not reach a forecast point, GDACS does NOT omit the
    feature — it publishes one whose every vertex is the SAME COORDINATE
    (measured: 330 identical copies of `[113.5, 24.8]` on NOUL-26's green
    band, and again at the final step). Fed to any geometry stage these
    poison it: the centroid collapses onto the point, the radial profile is
    all zeros, and the bridge blends the corridor down to a mathematical
    point. **Aaron diagnosed this from the map before the dump confirmed it**
    — "you are assigning a 0 radius at a forecast point when you don't see a
    field" — and he was literally correct. Dropped via
    `GDACS_GEOMETRY.degenerateSpanDeg` before anything else touches them.
  - **Bridging is GDACS-only, and that was tested, not assumed.** Beading is
    a failure mode of stamp-and-trace specifically. `lib/windswath.js` fed
    only FOUR fixes 24 h apart with a tight 64 kt core still returns ONE
    continuous corridor — it resamples the track and walks continuous walls,
    so it cannot bead by construction. NHC's path is untouched by this work.
  - **RESOLVED — the pinch was degenerate polygons, found via `?dump=1`.**
    Four rounds of synthetic fixtures failed to reproduce it and every one
    passed on the buggy code, because no invented fixture contained a
    zero-area polygon. **The rule this cost us: when a fixture passes and
    glass fails, stop building fixtures and go read the real bytes.** The
    dump endpoint is permanent for exactly this reason.
  - **THE FEATURE SPLIT, counted from two full dumps 2026-07-24.** The
    earlier "~30 of 33 polygons are centre dots" claim was WRONG — it came
    from reading a census summary rather than the features. NOUL-26's 44
    features are: **21 band polygons** (3 classes × 6 timesteps, plus 3
    pre-merged swaths), **11 timestep dots**, **1 centroid**, **10 track
    segments**, **1 cone**. `Poly_Green` held exactly 7 features and not one
    of them was a dot. Dots carry `featuretype: "PointRadii"` and their own
    `Class` prefix; only `featuretype: "WindRadii"` is a band.
  - Alert level and the affected-country list ride the event feed. `country`
    is a display string; **`affectedcountries` is the structured list** —
    `data/gdacs.js` read the wrong one and is corrected.
- **NHC MapServer — THE FULL INVENTORY, read live 2026-07-24 via
  `/api/nhc/inspect`.** Not inferred, not from documentation: this is the
  service's own layer list. 400 layers total.

  Block math: each storm slot owns **26 layers**. Blocks start AT=4, EP=134,
  CP=264; the feed's `binNumber` ("AT2") gives the slot, so
  `base = blockStart + (slot−1) × 26`. Five slots per basin.

  Every block carries these, in this order. GROUP layers cannot be queried —
  a pattern that matches one silently returns nothing:

  | Offset | Name | Type | Wired as |
  |---|---|---|---|
  | +0  | `AT1` | group | — |
  | +1  | `AT1 Forecast Information` | group | — |
  | +2  | `AT1 Forecast Points` | leaf | `forecastPoints` |
  | +3  | `AT1 Forecast Track` | leaf | `forecastTrack` |
  | +4  | `AT1 Forecast Cone` | leaf | `cone` |
  | +5  | `AT1 Watch-Warning` | leaf | `watchWarning` |
  | +6  | `AT1 Past Track Infomation` | group | — (NOAA's typo, not ours) |
  | +7  | `AT1 Past Points` | leaf | **unwired** |
  | +8  | `AT1 Past Track` | leaf | `pastTrack` |
  | +9  | `AT1 Past Cumulative Wind Swath` | leaf | **unwired** |
  | +10 | `AT1 Past Wind Radii` | leaf | **unwired** |
  | +11 | `AT1 Wind Information` | group | — |
  | +12 | `AT1 Forecast Wind Radii` | leaf | `windSwath` |
  | +13 | `AT1 Advisory Wind Field` | leaf | `windCurrent` |
  | +14 | `AT1 Arrival Time of TS Winds` | group | — |
  | +15 | `AT1 Earliest Reasonable Arrival Time` | leaf | **unwired** |
  | +16 | `AT1 Most Likely Arrival Time` | leaf | **unwired** |
  | +17 | `AT1 Inundation and Tidal Mask` | group | — |
  | +18 | `AT1 Inundation` | group | — |
  | +19 | `AT1 Boundary_Inun` | leaf | **unwired** |
  | +20 | `AT1 Footprint_Inun` | leaf | **unwired** |
  | +21 | `AT1 Image_Inun` | leaf | **unwired** |
  | +22 | `AT1 Tidal Mask` | group | — |
  | +23 | `AT1 Boundary_TMask` | leaf | **unwired** |
  | +24 | `AT1 Footprint_TMask` | leaf | **unwired** |
  | +25 | `AT1 Image_TMask` | leaf | **unwired** |

  **Outside the blocks** (not per-storm):
  - `0–3` Graphical Tropical Weather Outlook, Two-Day and Seven-Day current
    location / development motion / potential development region. Disturbances
    that are not yet storms — nothing in the app shows these.
  - `394–397` Probabilistic Winds (group), then **34 kt / 50 kt / 64 kt**.
    Basin-wide probability of each threshold. Not per-storm, so no block math.
  - `398–399` Seven-Day Outlook group members.

  **FOUR LAYERS CARRY THE WORD "WIND"** — Past Cumulative Wind Swath, Past
  Wind Radii, Forecast Wind Radii, Advisory Wind Field. Any loose pattern
  picks the wrong one, and a wrong-but-plausible layer draws a confident
  incorrect shape that looks fine. This cost a full day: `windSwath` matched
  `wind.*swath` → "Past Cumulative Wind Swath", so a control labelled "Full
  track" drew where the storm had ALREADY BEEN. Patterns are now anchored on
  the exact names and **a multi-match REFUSES rather than resolving by
  order** (`resolveLayerIds`).

  **Arrival-time layers already exist (+15, +16). DECIDED: fetch them, never
  compute them.** NHC publishes wind arrival as its own geometry — earliest
  reasonable and most likely. Phase 6 originally planned to derive arrival
  from the radii; that plan is withdrawn. Anything downstream that says
  "compute wind arrival" is stale and this line supersedes it.

  **CURRENT POSITION AND THE FORECAST'S FIRST DOT ARE DIFFERENT THINGS, AND
  BOTH ARE CORRECT.** Measured on Fausto EP1 advisory 22, 2026-07-24:

  - forecast `tau: 0` sits at 18N 130W, `fldatelbl` `2026-07-23 8:00 PM HST`
  - `advdate` on the same features is `1100 PM HST Thu Jul 23 2026`

  Three hours apart. `tau 0` is the **synoptic analysis time** (00/06/12/18Z);
  the advisory is issued up to three hours later. At Fausto's `tcspd` of
  13 kt that is roughly 40 nm of travel between the two.

  **The storm feed's `latitudeNumeric`/`longitudeNumeric` is the current
  position and is what the app draws as the storm.** The forecast's first dot
  is tau 0 of the advisory and is drawn as a forecast point. They are not
  rivals and neither is "more recent data cluttering the display" — tau 0 is
  the OLDER of the two. Treating tau 0 as current would plot the storm where
  it was three hours ago.

  Clutter is a rendering concern, not a sourcing one: draw ONE
  current-position marker from the feed, and let the forecast points start at
  tau 0 without a competing dot on top of it. The model-track path already
  solves the same problem geometrically — drop guidance points behind the
  current position and anchor the line there.

  **`lat` / `lon` attributes on `+2 Forecast Points` are WHOLE DEGREES** on
  the live sample (18/-130, 19/-132, 20/-137). Either NOAA rounds the
  attributes and the real precision is in the geometry, or the layer is
  coarse. `[VERIFY]` with `&geom=1` before anything depends on those
  attributes — use the GEOMETRY coordinates, not the attribute pair, until
  this is settled.

  **The `Image_*` layers are rasters,** not vectors. Inundation and tidal mask
  ship as boundary + footprint + image triples; only the first two are
  queryable as geometry.

  Some layers store `stormid` LOWERCASE → always match case-insensitively
  (`UPPER(stormid)=...`). Peak Storm Surge is a SEPARATE MapServer
  (`NHC_PeakStormSurge`, polygon layer 2) with **no stormid field** — filter
  spatially by an envelope around the storm's position.
- Model tracks (a-deck): per-model latest cycle, dropped if >12 h behind the
  deck's newest. Clip leading points behind the storm's current position; anchor
  the line at the current dot. Model shortlist and colors: §7.

### The wind field — FOUR NUMBERS, THREE TIERS (settled 2026-07-24)

NHC publishes wind extent as four per-quadrant distances in nautical miles —
`ne` / `se` / `sw` / `nw` — at each threshold (`radii` = 34 / 50 / 64 kt).
**Storms are wildly lopsided and the four numbers are how that asymmetry is
carried.** Measured on Fausto: `ne 80, se 170, sw 160, nw 40` on one band,
`ne 0, se 0, sw 120, nw 80` on another. A quadrant of zero next to one of 170
is normal, not a data error.

**Build the ring from the numbers, do not average them away.** Each radius is
the value at its quadrant CENTRE (45° / 135° / 225° / 315°); blend between
them with a periodic cosine and sample densely. This is the HA project's
proven method and the reason it is cosine rather than a spline: **a cosine
blend cannot overshoot the issued radii.** A spline can, and drawing outward
past NHC's published extent claims hurricane-force wind where NHC claims
none (§6 — these are safety colors on a safety layer).

**THREE TIERS, ONE SWATH — AS-BUILT (2026-07-24): a single swept ENVELOPE
per threshold.** "Full track" renders past + current + forecast as ONE
merged smooth outline per threshold, constructed in `lib/windswath.js` and
assembled into the bundle's `windSwath` slot by `data/nhc-mapserver.js`.
**The direct-draw alternative — stacking NHC's per-time rings — was
rejected by Aaron on looks:** dozens of translucent fills compound wherever
rings overlap, and beauty is a driving factor of this app. NHC's own merged
product (`+9`) is rasterized (above), so the clean outline is built here
from the same published quadrant numbers NHC built theirs from.

| Tier | Radii | Centres |
|---|---|---|
| Past | `+10 Past Wind Radii` | `+7 Past Points` GEOMETRY, joined on `+7.dtg` ↔ `+10.synoptime` |
| Current | `+13 Advisory Wind Field` | the FEED's current position (§4: that IS the storm) |
| Forecast | `+12 Forecast Wind Radii` | `+2 Forecast Points` GEOMETRY, joined on `tau` |

Construction: each timeline point carries a centre and four quadrant radii;
radius at any bearing is the periodic COSINE blend (cannot overshoot issued
radii, unlike a spline — the only acceptable error direction is inward);
the track is resampled at `WIND_SWEEP.stepNm` with centres and quadrants
interpolated LINEARLY (bounded by endpoints, so interpolation cannot exceed
published values either); the boundary walks left offsets nose-to-tail,
fans the front cap, walks right offsets back, fans the stern cap. Every
vertex sits ON some point's blended ring; chords cut inward. Tuning lives
in `WIND_SWEEP` (`config/constants.js`).

Rules the build enforces, each for a §5 reason:
- **Order strictly along travel**: past by ascending `dtg`, current,
  forecast by ascending `tau`. Past points within `coincideDeg` of the
  current position are dropped (no zero-length seam segment).
- **Tau 0 is dropped whenever a current entry exists** — it is the synoptic
  analysis BEHIND the current position (§4), and inserting it after the
  current entry would fold the timeline back on itself. With no current
  ring it stands in as the best available "now".
- **A threshold's run BREAKS at any timeline point with no published ring
  for it**, one envelope feature per contiguous run — sweeping across a
  time NHC published as ring-free would claim wind NHC did not.
- **Radii without a joinable centre are dropped.** A centroid is not a
  centre.
- **Solver fallback (§5):** if construction throws or builds empty while
  raw inputs existed, the slot keeps NHC's raw `+12` per-tau rings —
  stacked and compounding, but correct, with a console warning. Same
  promise either way ("full track"), so no UI flag.

Cost: ~600 boundary vertices across all three thresholds on a 5-day storm
— the old 21k-coordinate past-tier weight concern is void. Known limit,
accepted: a track that loops back on itself (Harvey-style stall)
self-intersects the corridor and fills imperfectly; rare, bounded, measure
on glass before engineering for it. The raw `windPast`/`pastPoints` slots
stay in the bundle — no map layer reads them, and the at-home exposure
timeline will.

**SMOOTHING — added after the first on-glass look (2026-07-24, Aaron:
smoothness over accuracy, keeping as much accuracy as possible).** The
exact sweep was jagged on glass: linear interpolation carried a slope
corner through every 6-hourly fix, and the walls mirrored every wobble in
the raw track. The pipeline, each stage with a stated bound:
1. **Sample smoothing** (`smoothPasses`): iterated 3-point averaging over
   the resampled centres and quadrant values, Gaussian-equivalent σ ≈ 22 nm.
   Smoothed radii stay between neighbours — never above any published
   value; centres drift only where the track curves, by less than the
   track's own deviation in the window. Endpoints pinned.
2. **Despike** (`spikeTurnDeg`/`spikeMaxSegNm`): where the radius profile
   changes faster than the wall advances, the offset curve reverses and
   leaves hairline folds — near-reversal turns on sub-step segments. Cut
   on BOTH conditions, because a published ZERO quadrant pinches the ring
   into an honest cusp that also turns hard but descends on step-length
   segments; cutting it would paint wind NHC didn't publish.
3. **Uniform resample then polish** (`ringSmoothPasses`): 3-point
   averaging on IRREGULAR spacing sharpens angles instead of rounding —
   measured, it manufactured a 154° kink out of an 85° corner — so the
   ring is resampled to even spacing first, where the same pass is a clean
   low-pass. Outward error bounded by the sagitta at half-step spacing.
Measured: a realistic storm goes from 12.5° max boundary turn to 6.8° at
1.9 nm max displacement; a pathological input (radii halving/doubling
every fix) keeps every turn under the despike threshold with zero outward
bbox growth beyond the polish bound.

**PAST TIER — PRIMARY: layer `+10`. Schema confirmed live on Fausto EP1
(layer 144), 2026-07-24.** 49 features spanning 07-19 18Z to 07-24 06Z,
6-hourly, three thresholds. Carries `radii`, `ne`, `se`, `sw`, `nw`,
`synoptime` (`"2026072318"`), and `timezone: "UTC"` — stated, not inferred.
Same field names as its `+12` and `+13` siblings, so one parser serves all
three tiers. No zip, no shapefile, no DBF: it is a third query against a
service the app already talks to, resolved by name like every other layer.

**THE JOIN IS VERIFIED — `+7 Past Points` schema read live on Fausto EP1
(layer 141), 2026-07-24.** 28 point features, 6-hourly, full storm history.
The join key is **`dtg`** (a NUMBER, `2026071712` = YYYYMMDDHH UTC) — the
same 10 digits as `+10`'s `synoptime` (a STRING, `"2026072318"`), so the
join is a string/number normalization on the synoptic time, nothing more.
There is no field named `synoptime` on `+7`; `year`/`month`/`day`/`hhmm`
also ride along split out. **The `lat`/`lon` ATTRIBUTES are whole degrees —
rounded, same trap as forecast points. The geometry coordinates carry full
precision (`-103.3, 9.3`); use the GEOMETRY, never the attribute pair.**
The best-track zip fallback is therefore dead — the past tier is a third
query against the service the app already talks to, joined on the synoptic
time. Bonus, recorded for §15's comet-tail: each past point carries
`intensity` (kt), `mslp`, `ss`, and `stormtype` — per-point
intensity-at-time from a layer the swath will already be fetching. Also
confirmed in the same read: `stormname` mutates across a storm's life
(INVEST → SIX → FAUSTO on consecutive points), hard evidence for §15's
rejection of it as a grouping key. Do NOT substitute a polygon centroid for
these centres; a lopsided ring's centroid is not the storm centre.

**PAST TIER — FALLBACK RETIRED (2026-07-24).** The best-track zip path
(DBF parsing, ~120 lines of binary reading) existed only for the case where
the `+7` join failed. The join is verified above, so the zip is not built —
recorded here only so nobody re-proposes it as "simpler": it is not, and the
`dtg` field on `+7` is literally the same `DTG` the zip's `_pts.dbf` carried,
so the data is identical either way.

**GDACS bands ARE quadrant shapes — the old "one radius" claim is DEAD.**
This section previously read "GDACS gives ONE radius, not four... so a GDACS
swath is necessarily symmetric about the track." That was inherited from the
HA project and **disproven on glass 2026-07-24**: its Green/Orange/Red
polygons are four-lobed, notched where quadrants meet, the same shape family
NHC publishes. The thresholds differ (60/90/120 km/h, §4) but the geometry
does not. GDACS publishes the SHAPES rather than the four numbers, which is
why `lib/bandmerge.js` unions polygons where `lib/windswath.js` sweeps radii —
different inputs, same merged look, shared finishing pass
(`lib/ringpolish.js`).

### Surge — inherited, proven on the HA project

- **The PeakStormSurge service is NOT per-storm and has NO `stormid` field.**
  One Points/Lines/Polygons trio serves every active storm. Filter spatially:
  an envelope of ±12° around the storm's current position, `spatialRel=
  esriSpatialRelIntersects`, polygon layer 2. This breaks the per-(storm,
  advisory) cache assumption every other layer relies on — surge keys on
  position, not storm id.
- **Ask the SERVER to generalize** (`maxAllowableOffset` ≈ 0.005°). These
  coastal polygons are enormous at full resolution. A second always-on
  client-side simplification pass on top deleted small rings and inland
  fingers — coarsen only a band that overruns its own budget.
- **Allocate the point budget ACROSS bands** proportional to raw size, with a
  per-band floor so small bands survive. Spending it front-to-back with a
  hard break dropped every band after the budget ran out, which read on glass
  as missing coverage — a §5 violation dressed as a performance fix.
- **Drop interior rings (holes).** Every pocket of high ground punched a hole
  in the fill and read as splattered paint at app scale. Painting over them
  is generalization, not deception, at these zooms. **Guard the orientation
  assumption**: if the server winds rings opposite to the Esri convention,
  EVERY ring looks like a hole and dropping them all makes the layer vanish —
  which reads as all-clear. Keep the original set rather than return nothing.
- **`symbolid` carries the NHC color class** (blue/yellow/orange/red/purple,
  rising severity); `name` is a bay or reach PLACE LABEL, not a depth. For
  surge-at-home report the severity INDEX and name the depth from the service
  legend — never show `name` as if it were the surge height.
- **SURGE WATCH/WARNING DOES NOT EXIST as a vector product anywhere in NHC's
  services.** Layer `+5`'s `tcww` carries wind codes only (HWA/HWR/TWA/TWR);
  NHC_Breakpoints is static reference points. Pair A's surge half is BANDS
  ONLY. Any design assuming a surge stripe symmetrical to the watch/warning
  stripe is void.

### Imagery (Phase 7) — inherited, proven on the HA project

- **Satellite leads, radar is the near-land bonus.** Ground radar is blank
  over the open ocean where storms live.
- **Satellite: IEM GOES-East Band 13** (color-enhanced IR), WMS 1.1.1
  GetMap, EPSG:3857. **Radar: NOAA nowCOAST MRMS base reflectivity**
  ImageServer `exportImage`, 5-minute updates, already a true transparent
  PNG — no knockout needed.
- **Clear sky renders SOLID BLACK on Band 13, not alpha.** The knockout is a
  **SATURATION key, not a brightness key**: cold storm tops render in vivid
  color and warm/low cloud in grayscale, so keying on chroma drops a bright
  grey pixel and keeps a colored one. Chroma via a `difference` blend against
  a grayscale copy — **never an arithmetic subtract**, which zeroes the
  intermediate alpha and wipes the color. Two stacked fades follow: a
  blue-edge fade and a red×blue magenta detector, because the palette's cold
  edge otherwise reads as loud as the hot cores.
- **Load-bearing, each cost a day to learn:** sRGB interpolation (linearRGB
  mis-tunes the constants); **PNG never JPEG** (mosquito noise near black
  keys as colored halos); and the bytes must be **same-origin** or the filter
  cannot apply at all.
- **THE MECHANISM DOES NOT PORT.** HA applies this as an SVG filter on an
  `<image>` element because its card draws into SVG. Landfall is MapLibre,
  where imagery is a raster source and SVG filters do not apply. The MATH
  ports; the delivery does not — expect a WebGL custom layer, a canvas
  pre-pass, or a paint-property approximation. **Budget this as engineering,
  never as "port the filter."**
- **Coverage-gate by bbox CENTRE** and say so when outside: satellite
  `(-140, -60, 10, 65)` reaches the Atlantic and East Pacific but NOT the
  GDACS basins; radar `(-170, 10, -60, 72)`. Outside coverage shows a stated
  "no coverage" note — never a blank raster, which reads as clear sky.

### The normalized storm object
Both sources land in one shape. The merge is only debuggable if there's one
target shape to merge into.

**A storm without a usable position does not exist.** Both parsers drop any
event whose id or position is missing — and "usable" means IN RANGE, not merely
finite. GDACS publishes placeholder and malformed geometry on events whose
position has not resolved yet, and a latitude of 91 (or 999) passes an
`isFinite` check, survives the sphere math, and renders as a confident storm
marker near the pole. That is the §5 failure with extra steps: a wrong position
stated confidently is worse than an absent one. Longitude must be within ±180
and latitude within ±90 or the event is dropped like any other positionless one.
`0,0` is NOT dropped — it is the Gulf of Guinea, a real place.

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
  advisoryKey: "nhc:al052026:12A",  // see advisory identity below

  can: {                        // what geometry this storm can actually offer
    cone: true, forecastTrack: true, forecastPoints: true,
    pastTrack: true, watchWarning: true, windRadii: true,
    surge: true, models: true, windBands: false
  },

  raw: { /* source-only fields */ }
}
```

- **Wind is stored in knots, everywhere, always.** Every threshold in this app —
  34/50/64 kt bands, the Saffir-Simpson breakpoints — is defined in knots.
  Convert only at the moment of drawing text. Converting internally means
  rounding drift, and drift near a threshold flips a storm between categories.
- **`categorySource` exists because GDACS publishes no category.** GDACS gives an
  alert level (Green/Orange/Red), which is a humanitarian impact estimate, not
  an intensity. **Never map alert level to category** — an Orange alert over a
  dense coastline can be a weaker storm than a Green one over open water. For
  GDACS, compute category from wind and mark it derived.
- **`nature` is separate from `category` on purpose.** NHC issues advisories on
  post-tropical storms and on "Potential Tropical Cyclone Five" — real positions
  and real warnings, no meaningful category. Trust NHC's own label for what kind
  of thing it is; derive only the number. That is what §6's generic
  `HU #B5474D` is for.
- **`can` distinguishes "this source never had it" from "the fetch died."** A
  GDACS typhoon has no cone, no forecast points, no watch/warnings. Without this
  block the layer panel shows toggles that do nothing, and the code cannot tell
  `unavailable` from `clear` (§5). It belongs in the data model, not bolted on
  later.

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

The UI reads `sources` to decide between "quiet ocean" and "we can't see half
the planet."

### Advisory identity
`advisoryKey` is a per-source function returning a string. It is the cache key
for all per-storm geometry (§7), so a new advisory self-invalidates.

- **NHC:** advisory number — a *string*, not a number (intermediates are `"5A"`,
  `"5B"`). Fallback: issuance timestamp.
- **GDACS:** `episodeid`, which increments per update. Fallback: event
  last-modified date.

**Geometry lag is a real failure mode — CONFIRMED, not theoretical.** Measured
live 2026-07-23, both active storms were lagging at the same moment:

| Storm | Feed `advNum` | Geometry `advisnum` | Geometry age |
|---|---|---|---|
| Bertha `al022026` | `017` (15:00Z) | `16A` | ~3 h 45 m behind |
| Fausto `ep062026` | `019` (15:00Z) | `18` | ~6 h 45 m behind |

Caching cone geometry under the JSON's advisory number would have served
advisory 18's cone labelled as 19 on a live hurricane — a smaller promise
rendering larger data, which §5 forbids outright.

Rule: **the geometry cache stores its own advisory identity from the MapServer
response, and the UI displays that, not the storm's.** When they disagree by
more than one advisory cycle, say so (§16).

The fields, confirmed on the GeoJSON feature properties (NOT on layer metadata —
the layer endpoints carry no `timeInfo` or `editingInfo` at all):
- **`advisnum`** — the geometry's own advisory number, same string form as the
  feed's (`"16A"`). Present on cone, forecast track, forecast points, and
  watch-warning.
- **`idp_filedate`** — epoch milliseconds. Present on every layer.

**Two paths are required.** `advisnum` is ABSENT on forecast wind radii,
advisory wind field, past points, and past track; those carry only
`idp_filedate`. Compare advisory numbers where present, fall back to
`idp_filedate` where not.

### Polling
- Storm sources: every **30 minutes** (NHC full advisories 6-hourly,
  intermediates 2–3-hourly; 30 min catches all without hammering anyone).
- Poll only while the app is visible (page visibility API). No background work.
- Imagery frames: 5-minute source cadence; fetched only while an imagery layer
  is on.
- All intervals live in the constants file. No unexplained numbers anywhere.

### Cache TTLs
Starting values, each with a reason attached so it can be argued with later.
Not measured — tune on real data.

| What | Fresh | Serve stale until | Why |
|---|---|---|---|
| NHC storm list (relay) | 5 min | — | Well under the 30-min poll, so a poll never gets served its own previous copy |
| Model a-decks (relay) | 15 min | — | Synoptic cycles are 6-hourly |
| **GDACS geometry (relay)** | **30 min** | **12 h** | Serve stale behind a failure, then stop — see below |
| Client geometry per (storm, advisory) | — | LRU, 12 storms | Key self-invalidates; cap stops unbounded growth. 12, not 8: geometry is warmed for every NHC storm and the basins have peaked at 8–9 at once |
| Last-good storm data (service worker) | — | 9 h | ≈1.5× advisory cadence, carried from HA |

**The GDACS row is TWO numbers, not three, and this was settled 2026-07-24.**
Fresh for 30 minutes; after that a failed upstream fetch is answered from the
last good copy, flagged stale, for up to twelve hours; past twelve hours the
copy is gone and the client gets an honest `unavailable`. There is no third
threshold. An earlier draft of this table carried a six-hour "serve stale" step
above a twelve-hour "hard drop" and never said what happened in between —
`config/constants.js` grew three constants to match, and **not one of the three
was ever read by anything**, on either side of the wire. The relay was built to
twelve because §5 says stale plus a visible timestamp beats a blank screen, and
a cone six to twelve hours old is still the right shape in the right ocean. The
constants are deleted; the numbers live in `functions/api/gdacs/geometry.js`,
which cannot import this project's config (Pages Functions, no bundler, §3) and
mirrors this table by hand and says so.

The "90-second endpoint" story that once justified this row is RETIRED — it has
failed to reproduce twice (375–984 ms, then 1.3–1.5 s). The cache earns its keep
on size and distance instead: 180–400 kB per event from a European server on
every load. See §4's relay section.

### Recovery from failure
- **Auto-retry at 5 s, 15 s, 45 s.** Then stop and wait for the normal 30-minute
  poll. Never auto-retry while the page is hidden.
- **Retryable = timeout, network error, 5xx. A 4xx is not retryable** — that is
  "no data," not "try again," and retrying it burns battery for nothing.
- **Have stale data** → show it flagged with its age, error in the status strip.
  Content is never replaced. Stale + timestamp beats blank.
- **Have nothing** → full error state, source named in plain English, 44 px
  Retry button.
- **Don't flash an error on the first blip.** Show the error UI once auto-retries
  are exhausted — unless the screen is empty, where feedback is needed within
  ~2 s.
- **Layers already have their recovery: the toggle** (§7). Re-toggling a dead
  layer means "try again." No second button. Feed-level errors live in the
  status strip; layer errors live on the layer.

## 5. Failure philosophy (non-negotiable, carried over)

- Three distinct empty states, never conflated:
  - `unavailable` — a source errored. NEVER shown as all-clear.
  - `none_matched` — storms active, none in current scope filter (§16).
  - `clear` — everything fetched clean and the ocean is genuinely quiet.
- **Never collapse "we don't know" into "there is none."** A failed fetch and a
  clean fetch returning zero results are different facts and get different
  wording. Inherited from the HA card's surge and watch/warning legends, which
  say "unavailable" and "none in effect" as separate strings by design.
- **Name every soft-fail; never silently substitute.** Asymmetric on purpose:
  a *smaller* promise must never silently render *larger* data (the HA card
  refuses to draw the multi-day wind swath under a label reading "Current" — it
  made a tropical depression look enormous). The reverse is fine: a bigger
  promise degrading to a smaller truth isn't misleading. When a fallback does
  fire, say so in the UI.
- Stale data + visible timestamp beats a blank screen, always. Last-good storm
  data is cached (service worker, stale-while-revalidate) and served flagged
  stale with its age; entries age out (HA used 9 h ≈ 1.5× advisory cadence —
  keep unless we learn better).
- Every async surface handles loading / empty / error-with-recovery explicitly.
  No partial renders while loading.
- Errors surface near their source, in human language, naming the failed source
  ("GDACS is not responding"), never raw exception text.
- One source down must not blind the other.
- **A solver bug must never blank the map.** Any layout, placement, or geometry
  solver is wrapped: on throw, warn and fall back to the simplest correct
  rendering. This is a storm-warning display; degraded output beats a dead
  render. Dropping an individual element that genuinely fits nowhere is
  expected and fine — the catch is for the different case where the solver
  itself breaks.

### Ghost storms — a storm leaving the feed
A selected storm can vanish mid-session. It gets a dimmed glyph at its last
known position plus a note, never silent removal.

- **Don't say "dissipated" unless we know it dissipated.** All we observe is that
  the source stopped publishing it — storms also go post-tropical, get absorbed,
  or leave the basin. Wording: *"FIONA — no longer in the NHC feed. Last advisory
  12A · 11:00 PM Thu · Cat 2, 85 kt."* **Always this wording.** An earlier draft
  allowed "final advisory issued" when NHC flagged one explicitly; probing
  2026-07-23 confirmed the feed carries NO such flag, so that branch is
  unbuildable and has been removed rather than left as a tempting option.
- **Promote to ghost only when the fetch came back clean.** If the source
  errored, storms hold as stale — they do not become ghosts. This is
  `unavailable` vs `clear` applied to a single storm, and getting it backwards
  shows a live hurricane as gone.
- **Neutral color, not the category color.** §6 colors encode present severity; a
  ghost has none. Category stays in the text.
- **Keep the past track. Drop the cone and forecast track.** History is still
  true. A forecast for a storm that is no longer there is a prediction about
  nothing, and drawing it is the "smaller promise, larger data" failure above.
- **Ghosts die on reload**, consistent with §7 not persisting selection.
  Dismissible, plus a TTL constant.

## 6. Fixed color contracts (not themeable — identical in light and dark)

Saffir-Simpson category:
`TD #5BA8E0 · TS #3ECC7A · 1 #FFE14D · 2 #FFB52E · 3 #FF7A33 · 4 #FF4D6D · 5 #E05BE0 · HU(generic) #B5474D`

**Hurricane strength, CATEGORY UNKNOWN — `#FF4FA3`.** Not part of the ramp and
not a Saffir-Simpson color. GDACS's strongest published wind band is 120 km/h,
which IS the Cat 1 floor, so a Cat 1 and a Cat 5 publish an identical band set
and its forecast points can only ever say "hurricane". The dot reads `HU` in
this rose. Fixed like the rest of §6.

`[VERIFY]` **STILL OPEN — it has not been seen beside a Cat 5.** The rose sits
~30° of hue from CAT5 `#E05BE0`, a real gap on a monitor and a smaller one on a
phone at night. The dots render correctly, but no Cat 5 has been on screen at
the same time, so the one comparison that matters is untested. If the two read
as the same dot, that is the §6 failure this section exists to prevent, and the
fix is a SHAPE difference — hollow ring, heavier stroke — not another hue.

NHC watch/warning (TCWW codes):
`TWA #FFE14D · TWR #3B7DDB · HWA #FF6FB0 · HWR #E03030`
(These are watch/warning products — never call them "advisories" in UI. All four
are wind-threshold products: 34 kt tropical-storm force, 64 kt hurricane force.)

Peak surge ramp (rising severity), with NHC's own legend text:
`blue #64B5F6 "Up to 3 ft" · yellow #FFE14D "Up to 6 ft" · orange #FB8C00 "Up to 9 ft" · red #E53935 "Up to 12 ft" · purple #AB47BC "Above 12 ft"`

Wind bands (GDACS-style, drawn nested 34 widest → 64 core):
`34 kt #43A047 · 50 kt #FB8C00 · 64 kt #E53935`

Model track identity (shortlist): `TVCN/HCCA #00E5FF · AVNO #B388FF · HFSA #FFAB40 · UKX #F06292`
Models beyond the shortlist draw from a defined fallback ramp — see §7.

**These are map colors, not text colors.** They were tuned against a dark globe.
Category color is the swatch and the glyph; it is never the color of body text
in a panel — a yellow Cat 1 as text on panel glass fails contrast outright.
Color carries severity, text carries the words.

`[DECIDE]` These hexes were tuned for the HA card's themed backgrounds. Audit
once our real dark and light basemaps exist, **including against the land fill**
(§9) — a yellow Cat 1 dot over dark ocean is fine; over a lit landmass it may
not be. Land fill values are chosen against these colors, not the reverse.
Values may shift for contrast, but the *principle* (fixed, severity-encoding,
non-themeable) does not.

## 7. Layer model

- **Baseline** (always drawn): storm markers worldwide; on selection — cone of
  uncertainty, past track, forecast track, Saffir-Simpson forecast points,
  watch/warning coastal segments.
- **Mutually exclusive pairs** (siblings fighting for the same map space — one
  draws at a time): current-position wind field ↔ full-track wind swath;
  watch/warning stripe ↔ surge bands; satellite ↔ radar.
- **Additive toggles**: forecast point date/time labels; model spaghetti
  tracks; advisory text; home marker and readouts; graticule.
  `[DECIDE — more, as they earn their place]`
- **The layer system takes an arbitrary number of layers. There is no cap.**
  Each layer declares its own type — baseline, exclusive-pair member, or
  additive. Adding a layer later means adding a definition, not touching the
  layer engine.
- On-demand layers fetch only when switched on; results cached per
  (storm, advisory) — a new advisory naturally invalidates.
- **Cache failures, and let re-selection clear them.** A dead layer must not
  refetch on every render; re-toggling it means "try again."
- **Bound every cache.** Per-storm geometry and imagery frames both accumulate.
- Layer choices persist per device (localStorage). **Storm selection does not** —
  reopening the app restores layers and drops you on the globe, not on
  yesterday's dissipated storm.

### The layers panel
Three groups. Group headers are real `<h2>`s so screen-reader users can jump by
heading; headers are not focusable, rows are.

```
STORM DETAIL
  Wind field ─── [ Current | Full track ]     segmented
  Coastal    ─── [ Watch/warning | Surge ]    segmented
  Forecast times                      [ ○ ]   default ON
  Model tracks                        [ > ]   expands in place
  Advisory text                       [ ○ ]

IMAGERY
  [ Off | Satellite | Radar ]                 segmented, 3-state
  ▸ Playback controls appear only when one is on

REFERENCE
  Home marker                         [ ○ ]
  Graticule                           [ ○ ]
```

- **Exclusive pairs are segmented controls, never two toggles.** Two toggles
  imply both-on is possible; a segment shows one is chosen. Satellite/radar
  gets a third `Off` segment because unlike the other pairs, neither-on is its
  normal state.
- **Every row shows its own state**: loading (spinner in row), error (row goes
  amber, naming it — "Surge unavailable"), unsupported (row dims, subtitle
  "Not available for GDACS storms"). That last one is what §4's `can` block is
  for. Re-tapping an errored row means retry — the toggle is the recovery.
- **Rows dim, they never disappear.** A missing toggle looks like a bug; a
  dimmed one with a reason is information.
- **The storm-detail group dims entirely with no selection**, header subtitle
  "Select a storm." Don't hide it — knowing those layers exist is the point.
- **Model tracks expands in place**, never pushing a second panel: §16 allows
  one panel at a time, so there is no stack to push onto. Rows carry their §6
  swatches, grouped consensus / globals / hurricane-specific.
- **Reset to defaults** at the bottom. After toggling six things during a
  landfall you will want it.
- 44 px rows; the whole row is the hit target, not just the switch.

### Full layer inventory
Sixteen layers: **five baseline, three exclusive pairs (six layers), five
additive.**

| Layer | Type | Phase |
|---|---|---|
| Storm markers (worldwide) | baseline | 2 |
| Cone of uncertainty | baseline, ambient at every zoom | 4 |
| Past track (dotted) | baseline, ambient at every zoom | 4 |
| Forecast track (solid) | baseline, ambient at every zoom | 4 |
| Forecast points (SS-colored, coded) | baseline, ambient at every zoom | 4 |
| Forecast time labels (spoke-placed) | additive, ambient from z4 | 4 |
| Watch/warning coastal stripe | exclusive pair A, ambient from z4 | 4 |
| Surge bands | exclusive pair A | 6 |
| Current-position wind field | exclusive pair B | 6 |
| Full-track wind swath (past + current + forecast, §4) | exclusive pair B | 6 |
| Satellite | exclusive pair C | 7 |
| Radar | exclusive pair C | 7 |
| Forecast point date/time | additive | 4 |
| Model spaghetti tracks | additive, per-model sub-selection | 6 |
| Advisory text | additive | 6 |
| Home marker + readouts | additive | 3 |
| Graticule | additive (ships OFF by default) | 1 |

The planet-band aesthetic is not a MapLibre layer at all: it is the **3D clear
globe's cyan geodesic cage** (`map/globe3d.js` + `map/heightfield.js`, §2),
which crossfades out as the dive hands off to MapLibre. It carries storm
severity as node elevation and node color but is not a toggle in the layers panel. The
graticule now ships off by default — the cage is the planet-band look — but
stays a MapLibre toggle for the equator/tropics reference.

### Forecast point date/time labels
- **Default ON.** "When does it get here" is the second question after "how
  bad is it," and a cone without times is just a shape. The toggle exists for
  decluttering, not because times are optional.
- **Pure render toggle — fetches nothing.** The times ride along in the
  forecast points GeoJSON already being pulled. It therefore has no error
  state; that row can never go amber.
- **Labels show DEVICE-LOCAL time, parsed from `validtime`** — never NHC's
  `datelbl`, which is basin-local and unmarked. See the time-field table
  below for the measurement that forced this.
- **AMBIENT, not selection-only.** Labels draw for every warmed storm from
  `ZOOM.ambientGeometry`, with no tap. They were originally held back on the
  grounds that a time on every point of every storm is a wall of text; the
  spoke placement below is the answer to that objection — it thins by hiding
  what genuinely cannot fit, rather than withholding the layer.
- **The toggle gates whether times draw at all; the zoom ladder gates when.**
  The toggle covers BOTH the ambient and the selected label layers — one that
  silenced only the selected storm would read as broken.

**Spoke placement (`map/layers/label-placement.js`) — WORKING EXCEPT THE
AXIS.** A label should sit on the NORMAL to the track at its own point, so
the point, the label, and the track form a spoke on a wheel. Labels prefer
ONE side of the track; when they collide, the minimum number flip to the far
side, and the split is then evened toward 50/50 — a 7/1 split reads worse
than 4/4 even when nothing overlaps. Anything that still cannot fit is
hidden, never overlapped.

**Confirmed working on glass:** labels render at every band, ambient and
selected, and the collision avoidance and side-balancing behave.

**NOT working on glass: the spoke axis.** Labels do not point at the dot's
centre; they sit above or below it. Three approaches have been tried and the
axis is still wrong — see the header of `map/layers/points-forecast.js` for
the full record and the ranked list of what to investigate next. Short
version:

- **MapLibre cannot place a spoke on its own.** `text-optional` only hides
  collisions and `text-variable-anchor` only tries a fixed menu of anchors;
  neither derives a per-point axis from the track nor balances a split.
  Placement is therefore computed in screen space and handed over per feature.
- **`text-translate` is a dead end** — no data-driven styling at all; a
  `['get']` there is silently ignored.
- **`text-radial-offset` is a dead end for a diagonal.** It validates and
  draws, but only pushes along ONE axis (outward in X for a left/right
  anchor, in Y for top/bottom), so a diagonal anchor gives an axis-aligned
  push. This is what made labels sit straight above/below the dot.
- **`text-offset` with a plain `['get']` IS data-driven** (property-type
  `data-driven`, parameters `["zoom","feature"]`) and is the current
  approach. The expression validates, the layer draws, and the placement
  module emits true diagonals when tested in isolation — and the on-glass
  result is still wrong. The fault is therefore somewhere node-side tests
  cannot see.
- **A LESSON WORTH KEEPING:** two consecutive fixes here passed full offline
  validation and both failed on the phone. For this layer, offline checks are
  necessary and NOT sufficient. Next session starts with a live feature's
  properties and a screenshot, not another round of validator runs.
- **Recomputed on `moveend`, debounced — never per frame.** Screen positions
  change every frame during a drag; re-placing per frame on a phone is the
  frame budget gone (§9, performance lens). Labels settle when the camera
  settles. Accepted cost: during a hard rotate they hold their last offsets
  and can look briefly stale. (Unverified on glass — the axis bug masks it.)
- All tuning values live in `LABEL_PLACEMENT` in `config/constants.js`.
- `[DECIDE]` Whether a five-day track at z4 is still too dense once placement
  is doing its job — if so thin to 24 h intervals rather than culling.
  Measure on glass once the axis is fixed.

**Confirmed on live geometry 2026-07-23** — forecast points carry more than
assumed, and Phase 4 should use it rather than deriving it:
- **`ssnum`** is the Saffir-Simpson number, stated per point. Do NOT derive
  category for forecast points; NHC gives it. (`categorySource: "reported"`
  genuinely applies here, unlike the storm feed where it is derived from wind.)
- Also present per point: `maxwind`, `gust`, `mslp`, `tau` (forecast hour),
  `tcdvlp` ("Tropical Storm"), `tcdir`, `tcspd`, `validtime`.

**TIMES ARE IN THE BASIN'S LOCAL ZONE, NOT THE USER'S. Measured on Fausto
EP1 advisory 22, 2026-07-24.** This section previously said "no date
formatting needed for this layer," and that instruction is what put a
Hawaii clock on a Texas user's screen.

| Field | Live value | What it is |
|---|---|---|
| `datelbl` | `"11:00 PM Thu"` | Pre-formatted, **basin-local, zone NOT stated** |
| `fldatelbl` | `"2026-07-23 8:00 PM Thu HST"` | Long form, basin-local, zone stated |
| `timezone` | `"HST"` | The zone the two labels above are in |
| `validtime` | `"24/0600"` | **DD/HHMM in UTC** — the only unambiguous time |
| `advdate` | `"1100 PM HST Thu Jul 23 2026"` | Advisory issuance, carries month + year |

- **`datelbl` MUST NOT be rendered.** It is basin-local with no zone marker,
  so an East Pacific storm labels itself in HST and a viewer four zones away
  reads it as their own time. Silent, plausible, and wrong — the §5 failure
  shape exactly.
- **`validtime` is the source of truth**, and it is NOT epoch ms. It is
  `DD/HHMM` UTC with no month or year; those come from `advdate`. Parsing
  must handle month rollover (an advisory issued on the 31st carries taus
  into the next month).
- Render through `lib/time.js`'s `formatClockDay()`, which formats via `Intl`
  against the device zone. That function already exists and already does the
  right thing; it was never wired to this layer.
- **A point whose `validtime` will not parse shows NO label** rather than a
  wrong one. Today a bad parse is invisible because the raw string draws;
  after the change it is a visible gap, which is the honest outcome.

**THE `validtime` PARSER — FIXED AND CONFIRMED ON GLASS 2026-07-24.**
`lib/time.js` `parseNhcValidtime(validtime, advdate)` parses `DD/HHMM` UTC,
anchoring month and year from `advdate`'s trailing `Mon DD YYYY`. Month
rollover is handled in BOTH directions — forward for taus crossing month end,
backward for a tau-0 synoptic time behind an issuance on the 1st — by trying
the day in the previous/same/next month and taking the candidate nearest the
advisory date; a winner more than 10 days out is a mis-parse and returns
null. Verified against the live Fausto measurement and both year rollovers.
`data/nhc-mapserver.js` stamps the result as `_time` (epoch ms, or null) on
every forecast point at fetch time; `normalizeForecast()` and the label layer
both read that one parse, so closest approach and the drawn labels can never
disagree about what time a point is. `closestApproach()` now receives real
times for NHC storms — for the first time ever; distance-only remains the
honest degrade for GDACS and for any point whose time will not parse.

**`9999` IS A NULL SENTINEL, NOT DATA.** Seen live on `mslp`, `tcdir`, and
`tcspd` for every forecast point beyond `tau=0`. It is finite, so it survives an
`isFinite` check and renders as "Pressure 9999 mb" — the same class of failure as
§4's out-of-range latitude. The geometry parser MUST map 9999 to null so §16's
"nulls are omitted, not zeroed" rule holds. It does not appear in
`CurrentStorms.json`, so this belongs in the geometry parser only — `data/nhc.js`
deliberately does not handle it.

### Model spaghetti tracks
- **Per-model selector, not one on/off switch.** Four models drawn at once over
  a cone is a hairball; the useful question is usually "where does GFS disagree
  with the consensus," which needs two on and two off.
- More than four models will ship. Shortlist carries named identity colors (§6);
  the long tail draws from a defined fallback ramp. HCCA shares TVCN's color —
  same consensus slot, never drawn together.
- Selector rows carry their own swatches, so the legend and the control are the
  same object. Group the list (consensus / globals / hurricane-specific) rather
  than one flat column of checkboxes.
- Selection persists per device.

### Watch/warning coastal paint — settled: wide-band coast select
NHC publishes these as **breakpoints** (named coastal reference points), not as
coastline. Drawn naively, a warning covering Tampa Bay renders as a straight
chord slicing across open water. Probed live on Bertha 2026-07-23: 11 vertices
over 464 km, median spacing 51 km, breakpoints a median 0.85 km from the drawn
shoreline.

**As-built (2026-07-24): the coast inside the warning is PAINTED by band
select.** The breakpoint polyline is buffered into a corridor of half-width
`COAST_BAND.halfWidthKm`, every loaded coast segment inside the corridor is
selected, and those segments — the same vertices the coastline is drawn from,
restroked wider — are painted the §6 warning color. No snapping, no walking,
no stitching, no winding: a segment is in the band or it is not.

**INTENT — wide and inclusive on purpose (Aaron, verbatim: "I WANT it to catch
all the little bays and islands. This is a warning to the area. They are in
the area. We can cast a wide band.").** A watch/warning is issued for an AREA;
every bay, inlet, and barrier island inside it is under the warning, so
over-inclusion near the line is desired behavior, not a bug. Inside the warned
area there is no "wrong" coast to avoid — only coast in the band or out of it.

Shape of the build:
- `map/coast-source.js` — unchanged; the ONLY schema-aware file. Resolves
  Protomaps `earth` or OpenMapTiles `water`/ocean and returns rings of
  `[lon, lat]`. Flipping `TILES.useR2` changes the answer there and nothing
  else. Winding never matters: the band asks membership, not direction, so a
  schema that fragments the coast into separate rings just yields more rings.
- `map/coast-band.js` — pure `[lon, lat]` math, schema-blind. Corridor test in
  a local planar km-space, **flat end caps** (the first leg of each part
  rejects projections before its start, the last past its end), so the band
  is capped at the perpendiculars through the first and last breakpoint. Note
  the honest shape of a wide corridor: interior breakpoints keep their full
  round joins, so where breakpoint spacing < W the band legitimately reaches
  a little past an end cap — within W of a warned breakpoint IS the area.
- **Tile-boundary filter.** The ocean polygon's ring is part real shoreline
  and part straight tile edge; a kept tile edge paints a straight seam across
  the map. A segment is dropped when EXACTLY axis-aligned (within
  `tileEdgeEpsDeg`) and at least `tileEdgeMinKm` long. A false drop costs an
  invisible sub-km gap in a thick stripe; a false keep costs a visible seam —
  err toward dropping. `[VERIFY]` on glass against real OpenMapTiles edges.
- `map/coast-band-cache.js` — keeps the BEST select per storm, re-selects on
  debounced `moveend`. Coast comes from LOADED TILES ONLY, so a naive
  re-select would degrade as you zoom out; a select may only improve
  (painted features, then painted km, then vertices). Invalidated by
  advisory stamp.
- **Severity stacking.** Overlapping products (a Hurricane Watch atop a
  Tropical Storm Warning) paint the same coast; `line-sort-key` via
  `wwSortKey()` makes the severer color win the pixels — §6 safety contract.
- **Fallback keeps NHC's chords, flagged `_banded: false`** with a reason
  (`no-coastline` / `no-coast-in-band` / `not-a-line`) — official geometry
  isn't ours to curve, and no coast loaded in the corridor is `unavailable`
  (§5), never "no warning here".
- **The legend dedupes by type** (`wwLegend`). One warning paints several
  coast runs; iterating naively stacks five identical rows.

**`W` = 50 km, picked by Aaron off a live prototype 2026-07-24** (Bertha's
real 8-breakpoint TWR, Matagorda→Vermilion Bay, against Natural Earth 10m
coast at 15/25/35/50 km): 15 caught only half of Galveston Bay; 35 painted
the full Galveston–Trinity–Sabine bay system; 50 also reached the inner
Matagorda Bay shore. Wider won. The flat caps held at every width — the
unwarned Louisiana coast east of the last breakpoint never painted.
`[VERIFY]` W against the real tile coast on glass; it is one constant.

**This replaced the snap-and-walk tracer (retired 2026-07-24).** Every
failure that design ever had was a WALK failure: it could not walk from the
mainland onto a barrier island (`split-landmass`), and it walked the wrong
way along tile-boundary edges (448 km on a 49.8 km chord, live on Bertha).
Both are gone by construction — there is no walk. Its threshold family
(`snapMaxKm`, `maxStrayRatio`, `maxTraceRatio`, `maxWalkVertices`,
`stitchToleranceKm`) is retired with it; `COAST_BAND` holds the one knob plus
the honesty gates. `map/coast-trace.js` and `map/coast-trace-cache.js` are
deleted, not archived.

### Recoloring the drawn coastline — investigated, NOT possible
The obvious alternative — recolor the basemap's own coastline between two
breakpoints instead of drawing our own line — cannot work, and the reason is
worth recording so it is not re-proposed. The rendered coast is the edge of an
ocean POLYGON, one feature covering a huge area. MapLibre's only mechanism for
restyling part of a vector-tile layer is `feature-state`, whose unit is the
WHOLE FEATURE; there is no way to address the portion of a polygon's edge
between two points. Recoloring it would recolor every coast in the tile.
(OpenFreeMap's ocean polygons also carry no stable id for `promoteId`.)

`tcww` is the field carrying the TCWW code — recorded off the same probe.
`lib/watchwarning.js` reads it directly and keeps the old value-scan as a
fallback, because a scan over every property could match a stray "HWR" in a
descriptive field and paint the §6 safety colors wrong.

## 8. Home (all features in v1)

- **How it's set:** three ways, all shipping. Geolocation is the one-tap path;
  Mapbox address search is the typed path; dragging the pin is both the
  correction path and the fallback when search is down. **Never prompt for
  location on first launch** — a permission dialog before someone knows what
  the app is gets denied, and iOS makes that hard to undo. Prompt only when
  they tap "use my location."
- **Nothing commits without an explicit confirm.** A geocode result is a guess,
  and a wrong home silently poisons every distance and closest-approach figure
  downstream — the numbers still look like numbers. So: pick → camera flies and
  drops a PROVISIONAL pin → user confirms or drags → only then is it home.
  Low-confidence results (an area centroid, or a weak relevance score) say so
  BEFORE the user picks one; surfacing it after selection means they have
  already started trusting it.
- **v1 features** — all of them ship:
  - Home marker on the globe, with an off-screen pointer
  - Distance to storm
  - Forecast closest approach (+hours)
  - Wind-arrival ("at home") status
  - At-home exposure timeline
  - Surge-at-home
- **Sequencing — home splits in two, and the split is by data dependency:**
  - **Geometry-free home, Phase 3:** location set, home marker, off-screen
    pointer, distance. **Correction to the original plan:** forecast closest
    approach was scoped here on the belief that the forecast track was already
    in Phase 2's feed data. It is not — the normalized storm object (§4) has a
    position and no track; forecast points arrive from the MapServer with the
    cone in Phase 4. `closestApproach()` is built and tested against the shape
    they will land in, and returns null until then. Distance and bearing are
    the geometry-free figures that actually shipped.
  - **Geometry-dependent home, Phase 6:** wind-arrival (FETCHED from layers
    `+15`/`+16`, not computed — §4), at-home exposure
    timeline, surge-at-home. These need forecast wind radii and the Peak Storm
    Surge service, neither of which exists until the layers phase. Peak Storm
    Surge has no stormid field and must be filtered spatially, so building the
    at-home version before the surge layer would mean writing that
    fetch-and-filter twice.
- **Home sits at Phase 3 because it is a reference point, not a feature.** Four
  things depend on it: storm-list sort order, the scope filter, the opening
  sequence's resting position, and the detail panel's home block. Building
  Phase 4 without it means writing the fallback path first and the real path
  second — the "hand-tune twice" failure §12 forbids.
- **Every home figure carries the advisory timestamp it came from.** "Closest
  approach in 14 hours" from a six-hour-old advisory is a different sentence
  than the same words from a fresh one. This is the one screen where someone
  may make a real decision; stale gets labelled stale (§5).
  **Enforced structurally, not by convention:** `distanceTo()` and
  `closestApproach()` return `{nm, bearing, observedAt, advisoryKey}` as ONE
  object. There is no call that yields the number without its age, so the rule
  cannot be forgotten at a call site.
- Home is stored locally on the device only. No accounts, no server-side user data.

### Units
Auto from locale, with a manual override in settings. Auto alone breaks for the
American living abroad; a setting alone is a chore for everyone else.

| | Imperial | Metric | Stored as |
|---|---|---|---|
| Wind | mph | km/h | **knots** |
| Distance | miles | km | **nautical miles** (NHC native) |
| Pressure | mb | mb | mb |
| Surge | ft | m | ft |

- Convert at render only, never in storage or logic.
- Pressure is mb in both systems — NHC quotes mb, and inHg is a preference, not
  a system.
- **NHC's own surge legend text is shown verbatim** ("Up to 3 ft"), with the
  conversion in parentheses for metric users. Rewriting an official legend is
  the same class of error as curving official geometry (§7).

### Time
- Everything stored UTC, formatted at render via `Intl.DateTimeFormat` against
  the device timezone. No library.
- **Local time to the user, absolute first, relative in parentheses:**
  `3:00 AM Thu (in 14 hrs)`. Relative alone hides what matters — 3 AM tells you
  it arrives while you are asleep. That is a decision-screen requirement, not a
  formatting preference.
- **Never a bare time without a weekday** beyond ~12 hours out. "3:00 AM" that
  could be tonight or tomorrow night is a dangerous ambiguity on the home panel.
- 12 h / 24 h follows locale. No separate setting.

## 9. Design

- **Single visual contract**: all colors, type, spacing in one tokens file; all
  motion durations/easings in one motion constants file. Zero hardcoded hex or
  raw pixel literals in feature code. §6's fixed colors live there too, marked
  non-themeable.
- **The app owns its whole screen and does not follow an ambient theme.** (The
  HA card auto-themes to the dashboard around it — correct there, wrong here.)
- **Visual direction: a cyan nodal-network entry that dissolves into a lit
  volumetric globe.** At the planet band the globe is a glowing geodesic node cage
  over solid continents (near hemisphere solid; the far continents visible through
  the clear ocean, dimmed to read as "behind"), grey coastlines on top. The cage
  is cyan, drawn from the coastline stack's own dim tone, so the two engines read
  as one planet across the crossfade instead of two visual languages meeting at
  z3. (It was amber `#FBC333` through Phase 3 — a handsome entry screen that
  belonged to a different app than the one it dissolved into.) As you zoom in the
  cage fades to zero by the basin band and the lit volumetric globe below takes
  over.
- **The crossfade is choreographed in one order, and the order is the whole
  trick** (`DIVE.fade` in `config/constants.js`, progress `p` derived from live
  zoom across `zSpace..zHandoff`). MapLibre fades IN across `0.00–0.30`. The 3D
  land and coast fade OUT across `0.10–0.30` — finishing exactly as MapLibre
  arrives, because the moment MapLibre can draw coastlines itself the 3D ones
  are duplicated data. The cage and nodes trail slightly: they are the
  planet-band AESTHETIC rather than duplicated data, and that short trailing
  dissolve is what makes the handoff feel like a dive instead of
  a cut. Cage `0.16–0.62`, nodes `0.14–0.60`. Space fades out `0.00–0.34`.
- **The 3D globe composites OVER MapLibre, so its BLEND MODE decides whether it
  can damage map content.** `#gl` is `z-index: 2` above `#globe` at `1`. Nothing
  in `globe3d.js` can reorder itself beneath storm geometry — Three.js and
  MapLibre are separate canvases with separate depth buffers, so `renderOrder`
  and `depthWrite` are inert across that boundary. What IS available is
  blending. A surface using `NormalBlending` paints its own color over the map
  and can darken it; a surface using `AdditiveBlending` can only add light and
  is physically incapable of hiding anything beneath it.
- **Far-side land and coast are ADDITIVE for exactly that reason.** They were
  normal-blended, and `scene.fog` blends fragments toward `DARK.space`
  (near-black) by distance — so the far continents painted a depth-graded dark
  wash over MapLibre and storm tracks got progressively swallowed toward the
  limb. Additive keeps them visible through the clear globe (which is the
  intended read) while making them incapable of darkening a track. The cage and
  nodes never had this bug because `matNodes` was additive from the start.
- **When 3D content appears to shadow map content, check BLENDING FIRST, then
  opacity.** This bug was misdiagnosed twice as a fade-timing problem and
  "fixed" twice by pulling fade bands in, which dimmed the symptom and cost the
  dive its slow dissolve. Fade choreography controls WHEN a surface is present;
  blend mode controls whether its presence is destructive. They are different
  questions.
- The volumetric globe is still the real product. **The node cage is an
  information surface, not decoration: node elevation AND node color encode live
  storm severity** — each node rises by a Gaussian heightfield over the active
  storms (one weighted point per storm at its current fix today; the whole track,
  each point at its intensity-at-time, once the relay feeds it — a comet-tail with
  the live head tallest) and simultaneously blends toward that storm's §6 category
  color. Two channels, one number: a Cat 5 is both the tallest peak and the only
  pink one, so severity survives being read at a glance, on a small screen, at an
  angle. Heights and colors ease in/out together and recompute on the storm poll.
  On a feed outage the cage desaturates to grey — colors included, so a held peak
  cannot keep showing a category the feed can no longer vouch for — and holds its
  last shape; it never flattens to a fake all-clear (§5). Node count and
  spacing are a frame-budget decision (`GEO_DETAIL`); peak shape is tuned by
  `STORM_AMP` / `STORM_SIGMA`.
  - **Land is filled.** Filled land against dark ocean reads as a globe and
    gives storm dots and cones something solid to sit on. Land fill values are
    chosen against the §6 storm colors. At the planet band the 3D clear globe is
    what shows (charcoal `land3d`); the MapLibre land below it
    drops to near-ocean (a color fade on the OpenFreeMap scaffold, where land is
    the background; an opacity fade on Protomaps, where land is a real polygon)
    and resolves to solid by the regional band.
  - Glowing coastline edges ride on top of the fills — the same line drawn
    **twice**: wide/dim/blurred underneath, thin/bright on top. MapLibre's
    `line-blur` does what a third pass would have. As-built and correct; do not
    "restore" a third pass.
  - Depth fade: line opacity and width driven by zoom, so distant coastlines are
    faint threads and near ones are crisp.
  - Graticule (lat/long grid), generated in code — no tile source carries it.
    Dimmer than the coast; it's what gives the "digital sphere" read.
  - Atmosphere: the thin rim light at the horizon comes from the 3D clear globe
    (§2), NOT from MapLibre's sky layer — see the day/night note below.
  - **No day/night shading — `atmosphere-blend: 0` AND `light.intensity: 0`.**
    On the globe projection MapLibre's atmosphere darkens the sphere away from
    the camera-facing center, producing a lit face and a dark limb. It is not a
    terminator: nothing in the app knows the subsolar point, so the "night side"
    never corresponded to the actual time of day anywhere on Earth. A globe that
    implies information it does not have is worse than a flat one.

    `atmosphere-blend` is the knob that matters and it must be 0. Zeroing
    `light.intensity` alone does NOT remove the effect (upstream discussion
    #5240 says so explicitly), and neither do the fog blends — `fog-ground-blend`
    and `horizon-fog-blend` control the fog wash, not the atmosphere darkening,
    which is why an earlier tuning pass that lowered them reduced the haze but
    left the night side intact. The rim light at the limb comes from the 3D clear
    globe's own atmosphere (§2) instead, which is under our control and does not
    shade the sphere face.
- **Dark by default** (night-sky globe), **light mode included**. `[DECIDE]`
  light-mode look — needs a real design pass against the actual basemap, not an
  inversion.
- **Floating menus**: panels float over the globe (glass/translucent), globe
  visible behind. No full-screen page takeovers.
- **Beautiful AND informative** — equal billing. Animation polish where it
  helps: camera flyTo on selection, panel enter/exit, layer fades. Animate
  transform and opacity only.
- **Idle globe rotation**: gentle auto-rotate when untouched; stops instantly
  on interaction; disabled when OS reduce-motion is set. **Storm selection
  counts as interaction** — panels are off-canvas, so `main.js` must interrupt
  the drift explicitly before flyTo, or the drift's per-frame setCenter stomps
  the running camera animation and selection goes dead. `[DECIDE]` resume delay
  + rotation speed (constants file).
- **Imagery playback**: a play button animates radar/satellite through their
  recent timestamped frames, with a scrubber. Heaviest feature in the app —
  only ever runs on explicit press, never in the background. `[DECIDE]` loop
  length (frame count / time span) and preload strategy.
- Accessibility: 44 px touch targets; every interactive element
  keyboard-reachable and screen-reader-labeled; visible focus ring always;
  contrast meets WCAG AA in both modes.
- Verify at phone width and desktop width before anything is called done.

### Opening sequence (as-built)
The 3D clear globe IS the entry (§2). On load you are in "space": the clear
globe fills the screen, idly drifting, while MapLibre streams tiles behind it,
hidden. There is no scripted fly-in — the globe is just there, immediately,
which keeps time-to-first-paint (the Phase 1 baseline, §14) short.

- **You enter by zooming.** Scroll / pinch / + zooms in; the clear globe
  crossfades out and MapLibre crossfades in (§2). Drag pans, arrows pan, Esc
  flies back out to space. One continuous zoom — no button, no modes.
- **Idle drift** only runs while zoomed out (near space) and stops on any
  interaction; disabled under reduce-motion. No auto-animation to sit through.
- `[DEFER]` Auto-resting on the most significant active storm → home → fixed
  Atlantic view needs storm data on the cage, so it is a Phase 2+ concern.
  Today the globe rests where it last drifted.

### Zoom ladder
**Zoom controls detail, never severity.** A storm's glyph, position, and category
color are fixed at every band; what changes is only how much supporting
information sits around it.

The planet band used to be an exception — uniform grey position dots, with
category color arriving at the basin band, on the reasoning that color out there
was noise and severity was the cage's job. That held while the cage was flat
amber. It stopped holding the moment the cage itself started carrying category
color: a grey glyph sitting inside a red-tinted peak is the inconsistent element,
not the restrained one. The exception is retired and the rule is now absolute at
every zoom. If someone has to zoom in to discover that something is dangerous,
the design failed — and that was always truest at the band where you can see
every storm at once.

Four bands, not eight, so the transitions are felt rather than guessed at.

| Zoom | Land | Storms |
|---|---|---|
| **z0–2 · Planet** | Solid continents under the cyan node cage; far side dimmed through the clear ocean; grey coast | Category-color glyphs; **severity read as node elevation AND node color** (the cage peaks over storms and takes their color, fading back to cyan across the lattice). No labels. |
| **z3–4 · Basin** | + major islands; 3D cage handed off to MapLibre, continents solid | Storm names. Track, cone, and forecast points are **already drawn** — they arrive with MapLibre itself, not on a z-step. **At z4:** forecast time labels and the watch/warning stripe |
| **z5–6 · Regional** | + detailed coastline, inlets | (no new storm layers — the set is complete by z4) |
| **z7–8 · Local** | Full coastline detail, bays, barrier islands | + surge bands, wind bands |

- **No names at z0–2.** Six names scattered across a globe you can barely see is
  a mess, and at that distance the question is "how many and how bad" — which
  color and glyph already answer. Names arrive once you have committed to a
  region.
- **THE CROSSFADE GATES STORM GEOMETRY — there is no zoom step for it.** Track,
  cone, and forecast points carry no `minzoom` at all. They are simply part of
  the MapLibre canvas, which is itself fading in across `zSpace..zHandoff`, so
  they arrive with the map rather than on top of it. The layers used to ladder
  in separately (past track at basin, cone and forecast at regional, stripe at
  local), which read as a rendering bug; then they were collapsed onto a single
  `ZOOM.ambientGeometry` step, which was correct but redundant — a hard z-floor
  underneath a fade that was already hiding the same pixels. Removing the floor
  removed a second gate doing the first gate's job.
- **`ZOOM.ambientGeometry` (z4) is RETAINED and gates exactly two things:**
  forecast time LABELS (ambient and selected both, via the shared
  `timeLabelLayer`) and the watch/warning stripe (`amb-ww-core` — one solid
  stroke; its glow underlay was killed on glass 2026-07-24 as fuzz at the
  doubled width). Both need a hard floor for their own reasons — labels
  because text at planet distance is unreadable clutter, the stripe because it
  hugs coastal detail that does not exist yet. Geometry needs neither.
- **Ambient and selected storm geometry now render IDENTICALLY.** Selecting a
  storm changes the camera (`flyTo`) and the panel, not what is drawn. This is
  the point of removing the floor: two code paths that were supposed to look
  the same, and could drift, became one.
- **The watch/warning stripe draws at z4, ahead of the coastal detail it hugs.**
  Deliberate: a warning is safety information and waiting until z7 to show it
  is worse than showing it imprecisely. The stripe is still untraced (§7
  as-built), so it may visibly chord across bays at z4 — if it reads badly the
  fix is tracing it against real vertices, NOT raising its floor.
- **Coastal detail at z7–8, not sooner.** §11 caps tiles at z8 precisely because
  that is where inlets and barrier islands resolve.
- `[DECIDE]` Exact z-thresholds, once there is a real basemap to look at.
- `[DECIDE]` Whether z0–2 carries any text at all.

### The home marker (as-built)
Home floats ABOVE the node lattice, tethered to its exact surface point. Every
value lives in `HOME` in `config/constants.js`; all are guesses until measured.

- **Altitude is expressed in EARTH RADII, not pixels**, and converted per frame
  using MapLibre's measured on-screen globe radius — so it scales with the
  planet automatically at every zoom ("moves with the radius of the earth").
- **The altitude SHRINKS as you zoom in** (`altFar` 0.16 → `altNear` 0.004,
  smoothstepped across the planet→regional bands). This is the resolution of a
  real tension: a FIXED altitude reads correctly from far out but drifts off
  the house up close, because parallax grows as the camera approaches. Shrinking
  keeps the float at planet zoom and the accuracy at street zoom. It never
  reaches zero — a marker flat on the surface stops floating and is lost in the
  lattice.
- **The tether is PERPENDICULAR TO THE SURFACE** — it follows the outward
  surface normal, projected to screen, and that projection FORESHORTENS. The
  normal tilts toward the camera as home approaches the disc centre, so the
  on-screen tether must shorten with it: full length at the limb, zero directly
  overhead. Drawing it full-length everywhere (the first pass) made it look
  locked to a narrow angle window. Direction alone is not enough; the length is
  the tell.
- **The DRAWN tether length is not the true projected altitude.** The true
  value is clamped into `[tetherMinPx, tetherMaxPx]`. Foreshortening alone is
  geometrically right and product-wrong: past the basin band home sits within a
  degree or two of the view centre almost every frame, the projection collapses
  below a pixel, and the tether vanishes — the marker then reads as sitting flat
  ON the globe, the exact opposite of the design. The tether is an AFFORDANCE
  that must keep saying "this floats above THAT point" at street zoom.
- **The directly-overhead deadzone is measured in SCREEN space, not angle.**
  With the camera straight over home the normal points at the lens, its screen
  projection is zero, and the direction is undefined — measured, a 0.1° camera
  move swung the tether 26.6°. The threshold is the anchor's pixel distance
  from the projected globe centre OVER the globe's pixel radius, which is
  scale-free. **An angular threshold was tried and broke badly:** foreshorten is
  sin(angle from view axis), so a 0.05 cutoff means 2.9° of arc — but past z5
  the entire visible map is a degree or two wide, every on-screen point fell
  inside the deadzone, and the tether never drew at all.
- **Direction falls back to screen-radial when the normal is degenerate.** Near
  the disc centre the normal's screen components are noise; the radial direction
  from the projected globe centre is stable there and agrees with the normal
  everywhere else.
- The tether fades toward the ground end and lands on a small anchor dot, so it
  visibly terminates ON something. **The dot drops the moment the surface point
  is occluded** — it asserts "home is exactly here," and once the point is
  behind the planet that claim is false. The tether foot is then a direction,
  not a location, so leaving the dot pinned to the silhouette would plant a
  marker on a spot that is not home.
- **`altFar` is set by SCREEN clearance, not by kilometres.** At the planet band
  the globe's on-screen radius is small, so the first pass's 0.06 radii came out
  ~9 px and the marker vanished into the node lattice at exactly the zoom where
  it most needs to say "home is over here." 0.16 clears it.
- **It mounts in `#home-layer-host`, NOT in MapLibre's canvas container.**
  `#globe`'s opacity is animated from 0 by the dive, and opacity on a parent
  fades everything inside it — mounted in the map container the marker was
  invisible at the planet band, the one zoom where an off-screen home most needs
  an indicator. This is the second time that trap has been hit (the attribution
  control was the first, §13); the host sits at z3, above both globe engines and
  below all chrome.
- **It is a DOM overlay, not a Three.js object and not a MapLibre symbol.**
  Three would vanish at the dive handoff; a MapLibre symbol has no altitude at
  all. Driven by MapLibre's projection, which is valid at every zoom because
  MapLibre owns the one camera both engines mirror (§2). One marker, one code
  path, no handoff to get wrong.
- **Three visibility states, and the third is the one that gets forgotten:**
  `ON_GLOBE` (the GLYPH is still above the horizon) — marker + tether, no
  pointer. Note this is the glyph's horizon, not home's: the marker floats at
  altitude, so it stays visible for `acos(1/(1+alt))` of arc after its own
  surface point has gone under — 30.4° at planet zoom, 5.1° zoomed in. Across
  that arc the tether foot is pinned to the silhouette and the lift decays to
  zero, so the house settles onto the rim rather than hovering above it.
  `OVER_LIMB` (behind the planet) — pointer rides the LIMB, the circular
  silhouette, because that keeps it attached to the Earth; a viewport-edge
  indicator detaches and reads as UI chrome. **The safe-margin clamp applies to
  the viewport-edge case ONLY.** Clamping the limb position too (the first pass)
  dragged the pointer out to the screen edge whenever the whole globe was in
  frame — the limb was plainly visible and the pointer wasn't on it. When the
  limb crossing is off screen (zoomed in far enough that the globe overflows),
  fall back to the viewport edge, because an anchor the user can't see is no
  anchor.
  `OFF_SCREEN` (near face, outside the viewport) — happens constantly once
  zoomed in, when the limb may not even be on screen, so the viewport edge is
  the only honest anchor.
- **Occlusion is asked of MapLibre, never derived.** `isLocationOccluded` on the
  transform tests the point against the globe's own clipping plane —
  the same call MapLibre's `Marker` class makes. A `cos`-against-the-limb test
  approximates it and disagrees under pitch, where the visible horizon is not
  the great circle 90° from the view centre. Feature-detected: falls back to
  "never occluded" on the mercator transform and on any build without it.
- **`project()` has NO occlusion test.** It is a bare perspective divide, so an
  occluded point still returns a coordinate — a meaningless one. Any bounds
  test on a far-side point is nonsense, and testing the anchor's projection is
  what silently defeated two earlier attempts at the handoff timing. The
  DIRECTION survives occlusion (far-side points project inside the disc,
  collapsing toward the centre, never flipping side), which is why the pointer
  can still aim correctly from the same projection the foot cannot trust.
- **The near-centre scale is NOT the silhouette radius.** `measureGlobeRadiusPx`
  returns px per radian of arc at the screen centre; the limb sits closer in on
  a perspective globe — 41% at planet zoom, over 100% up close. Converting needs
  the camera distance in radii: `limb = nearScale·(d−1)/√(d²−1)`. Using the
  near-centre number as a limb radius teleported the tether foot past the rim.
  **This trap has now been hit three times, and the third was inside the file
  that already documented it** — §2 sized the Three globe with it, `readFrame`
  clamped the tether foot with it, and the OFF-SCREEN POINTER used raw `R` for
  its limb ring ten lines further down. That threw the pointer to roughly 2.4×
  the real rim at planet zoom, so `limbOnScreen` read false almost every frame
  and the OVER_LIMB branch fell through to the viewport edge — the pointer
  detached from the planet and read as chrome, which is the one thing that
  state exists to prevent. Fixed 2026-07-24: the silhouette is measured ONCE
  per frame in `readFrame` and carried on the frame object as `limbPx`, so
  there is now a single place to get it wrong. **Anything needing a limb radius
  reads `f.limbPx` or calls `silhouetteRadiusPx`. Never `R`.**
- **The pointer's position is the great-circle direction to home**, so dragging
  toward it brings home to you and it slides smoothly around the rim.
- **The bob rides OUTWARD along the pointing axis**, not vertically — a
  vertical bob on a curved rim reads wrong at the sides. It is on the pointer
  only, never the marker: when home is visible the tether already sells the
  float, and the globe is doing enough moving. Under `prefers-reduced-motion` it
  is DAMPENED, not killed — a few px of local travel on a 44 px control is not
  the large-area parallax that setting guards against, and the movement is what
  makes the pointer findable against a busy globe.
- **The pointer is TWO marks on ONE imaginary line** running from the house,
  through the arrow, out to the real home location. The arrow is nearest home;
  the house sits on the OPPOSITE side of the arrow from home. Reading outward
  gives house → arrow → home, so the house says "this is your home" and the
  arrow says "it is that way." Putting the house on home's side would place it
  between the viewer and the direction it is claiming.
- **NO ENCLOSING CIRCLE.** The first pass wrapped the pointer in a ring and on
  glass it read as a separate object from the marks inside it — three scattered
  elements rather than one indicator. (It was also literally broken: an inline
  `display:block` overrode the stylesheet's `display:grid`, so the layers
  stacked vertically instead of overlapping. Setting layout in both JS and CSS
  is the underlying mistake; layout belongs in the stylesheet, per-frame
  transforms in JS.)
- **Only the arrow rotates.** The house stays upright — a rotated house reads as
  a falling building.
- **The pointer walks AROUND on-screen chrome**, never under it: control
  cluster, storm pill, status chip, open panels, attribution. Obstacles are
  MEASURED from the live DOM once per frame and cached, never hardcoded — they
  move with safe-area insets, panel state, and dock side. Escape candidates are
  clamped to the viewport BEFORE being chosen; clamping afterwards pushes the
  point straight back into the obstacle it just left.
- **"Off screen" and "not visible" are DIFFERENT QUESTIONS, and both trigger the
  pointer.** Home sliding under the storm drawer is invisible while still inside
  the viewport rectangle, so a bounds test alone leaves the marker officially
  on screen behind an opaque panel and the pointer never appears. The occlusion
  test covers both the anchor AND the floating glyph, since the glyph is what
  the eye looks for.
- **Chrome avoidance is SHARED, not home's.** It lives in `map/chrome-avoid.js`,
  imports nothing, and knows nothing about the home marker — any future overlay
  positioned freely over the globe (storm callouts, inspect readouts) uses it
  rather than growing a second copy. Two functions, deliberately separate:
  `occludedByChrome` answers "can the user SEE this point" (tight occlusion
  padding), `avoidChrome` answers "where may this SIT" (wider clearance).
  Conflating them is a real bug — overshooting the visibility test hides a
  marker that is plainly on screen.
  **The per-frame cache is the CALLER's job.** `measureChrome` calls
  `getBoundingClientRect`, a layout read that must not happen more than once
  per frame inside a render loop; each consumer repeats the `chromeCache`
  pattern (measure once, key on a frame counter). When storm callouts land,
  they become chrome other overlays must dodge — add them to
  `OCCLUDING_SELECTORS` then, or two markers will silently overlap.
- **Two chrome rect sets, two paddings, one DOM pass.** `pointerChromeClearance`
  (wider) is the gap the pointer keeps so it does not sit welded to a button;
  `occlusionPadding` (tighter) answers "can the user actually see the marker."
  Overshooting the second would hide the marker while it is plainly on screen —
  worse than the bug it fixes. The occluding set is also a SUBSET: the small
  attribution button is something the pointer must not cover, but not something
  that should banish the marker when it passes behind.
- **When home is hidden but on screen, the pointer anchors at HOME's projected
  position**, not at the viewport edge. Chrome avoidance then slides it the
  shortest way clear, parking it directly against the covering panel's edge.
  Marching to the viewport edge first drifts the pointer sideways whenever home
  is off-centre — measured up to 44 px of drift, and only correct by accident
  when home happens to be centred.
- **The pointer is a real `<button>`** — tap or Enter brings home into view
  WITHOUT changing zoom (the user picked that zoom). It leaves the tab order
  when hidden; a focusable control you cannot see is a keyboard trap (§13).
- Clamped `pointerEdgeMarginPx` from every viewport edge — the limb crossing
  can otherwise land in a corner where the OS eats the gesture (§10).

### Icons — no pack, deliberately
Every icon is hand-drawn inline SVG in one language: 24×24 viewBox,
`currentColor`, stroke-width 1.7, round caps and joins. The house mark lives in
`map/glyph-home.js` and is shared by the marker, the off-screen pointer, and the
provisional pin.

**An icon pack was considered and rejected.** At ~10 icons in a single
consistent style there is nothing to gain, and both delivery routes cost
something the project has ruled out: a CDN request puts a third party in the
render path (against §11's self-hosting direction), and a bundled package needs
a build step (against the no-toolchain rule — Aaron can read this code and it
never needs compiling). Revisit around 30 icons, and even then by copying the
individual paths into `glyph-home.js`, not by adding a dependency.

### The provisional pin
Shown only between "picked a geocode result" and "confirmed it". Dashed and
hollow where the real marker is solid and filled, so the two can never be
confused — a provisional pin that looked like a set home would tell the user
they had finished when they had not. Draggable, because a geocode result is a
GUESS: Mapbox puts rural addresses on the road and postcodes on a centroid.
Dragging is the correction path and doubles as tap-to-pin when search fails.
**A dragged pin drops its address label** and its source becomes `pin` —
keeping the searched label would name a place the home no longer is.

### The storm glyph — 3D NODE MESH ONLY (MapLibre's copy retired 2026-07-24)
- **Simplified two-arm spiral**, rotated by hemisphere — counterclockwise north,
  clockwise south. Physically real, free to implement.
- **ONE ENGINE DRAWS IT, AND IT IS THE MESH.** `map/glyph.js` is shared, and
  both engines used to stamp it: the mesh as a Points sprite, MapLibre as a
  symbol layer. **The zoom bands guaranteed they overlapped** — MapLibre's
  reached full opacity at z3.4 while the mesh does not finish handing off
  until z5.0, so for 1.6 zoom levels two copies of one spiral were drawn at
  slightly different projected positions and sizes. That smear was structural,
  not tunable, and MapLibre's copy is deleted. `glyph.js` stays; the mesh
  still needs it.
- **AT MAP ZOOMS THE GEOMETRY IS THE STORM.** Track, cone, wind field, and the
  forecast points — whose first dot sits on the current position carrying the
  category color and code. Severity still reads at a glance (§6); it reads off
  the dots and bands rather than off a spiral.
- **Size-scaled by category, never shape-scaled.** A Cat 5 is a bigger glyph,
  not a more elaborate one. It has to stay legible at ~12 px on a phone at z1,
  and a detailed spiral turns to mush at that size.
- **Non-tropical `nature` values get a plain dot, not a spiral.** The glyph
  means "this is a cyclone."
- **SELECTION DOES NOT RIDE THE GLYPH and never fully did.** `storm-dot-planet`
  is now a fully transparent circle with no maxzoom, present at every zoom —
  it is what makes the MESH spiral tappable in globe view, and what keeps a
  storm selectable before its geometry has warmed or after that fetch failed.
  Forecast points are tap targets too (`_stormId` stamped by both data
  paths), so anywhere along a track selects its storm. **Selection must never
  depend on a network round trip.** Hit radius is floored at half the 44 px
  touch minimum, and the query box in `stormAtPoint` enforces it again.
- **Zero-opacity queryability — CONFIRMED ON GLASS 2026-07-24.** MapLibre does
  return fully transparent layers from `queryRenderedFeatures` (unlike
  `visibility: none`, which it excludes). Storm selection works with the glyph
  retired. Recorded because it is the load-bearing assumption under the whole
  hit-target design: if taps ever stop selecting, this is the first thing to
  re-check, and the fix is raising the opacity a hair — not restoring the
  MapLibre glyph.
- `[DECIDE]` Whether the mesh glyph rotates slowly. Leaning no — animating N
  sprites forever is a battery cost for decoration.

## 10. Input — touch, mouse, keyboard all first-class

- Same code, every input. No device sniffing, no user-agent branching. Pointer
  Events; adapt by capability: `@media (hover: hover)`, `(pointer: coarse)`.
- Every action (select storm, change layers, recenter, zoom, inspect a point)
  works by tap, by click, and by keyboard.
- Touch: one finger drags, two fingers pinch/rotate; `touch-action` set so the
  page never scrolls during a map drag; nothing important within a thumb-width
  of screen edges; never hover-only.
- Mouse: drag pan, wheel zoom, right/modifier-drag tilt-rotate; hover states;
  cursor communicates state.
- Keyboard: arrows pan, +/− zoom, Enter selects, Esc closes and recenters;
  full logical tab order.
- **Tab reaches the storm LIST, it does not cycle map objects.** Tab moves
  through focusable elements in DOM order — pill/toggle, then the rows once the
  panel is open. Hijacking Tab to step through storms on the globe would break
  the one key a screen-reader user relies on to escape a region, and the list is
  already the declared accessibility surface (§16): the canvas is `aria-hidden`,
  so every storm is reachable as a real button in the list. Storms are not
  focusable on the canvas by design, not by omission.
- **Escape is one contract, handled once at the document level**
  (`attachEscape`, `map/globe.js`): if a panel is open it closes and focus
  returns to its toggle; otherwise the camera recenters. **Never re-add a
  panel-scoped or canvas-scoped Escape listener** — element-scoped listeners
  mean Escape does nothing unless focus happens to sit on that element.
- Done = tested with a mouse, a real phone with a thumb, and a full keyboard
  pass. Two out of three is not done.

## 11. Basemap tiles — settled: OpenFreeMap (OpenMapTiles), z8 by design

**Decision:** serve the basemap from OpenFreeMap and style it ourselves. A
self-hosted Protomaps `.pmtiles` archive on Cloudflare R2 was built, shipped
(2026-07-23), and retired a day later — "R2/Protomaps: tried and retired"
below records why and how to revive it.

Why not self-hosted after all: the theory was sound — coastlines don't move, so
upload once and depend on nobody's server but Cloudflare's, no egress meter. In
practice two things beat it: the proxy cold-reads each tile out of a 525 MB
archive so panning lagged, and Protomaps' land-polygon schema broke coastal
watch/warning tracing (below). OpenFreeMap is a purpose-built CDN and its
OpenMapTiles ocean schema traces cleanly.

**Why z8 is the ceiling — a design decision as much as a budget one.** The
question this app answers at close range is "is the cone over Tampa Bay or west
of it." That's z8: a metro area with inlets and barrier islands resolved. Past
z8 you pull in street grids, which are visual noise for storm data and would
wreck the lit-globe look. Do not reopen this as a cost question.

**As-built: the app serves OpenFreeMap.** `TILES.useR2` is `false`. The
`basemap` source points at `TILES.openFreeMapStyle` and `style-dark.js` draws
the OpenMapTiles layer set — land is the background, `class=ocean` water on
top, coast is the ocean-polygon edge. Watch/warning coast tracing (§7) runs
against that continuous ocean edge. Tradeoff accepted: OpenFreeMap is one
person's donation-funded server with no SLA — the reliability risk R2 was meant
to remove; re-self-hosting is a flag flip (below) if it ever bites.

**R2/Protomaps: tried and retired (live 2026-07-23 → 2026-07-24).** The app
served `landfall-z0-8.pmtiles` (525 MB) from Cloudflare R2 through the tile
proxy `functions/tiles/[[path]].js`. Two things sank it:

- **Cold-tile latency.** The proxy reads one tile out of the 525 MB archive via
  the `TILES_BUCKET` binding (§3) on each edge cache miss, so the first look at
  any new region paid a bucket round-trip and panning lagged with visible
  pop-in — worse in practice than OpenFreeMap's CDN. (Already better than the
  first wiring, which read the bucket's `r2.dev` endpoint directly with no CDN
  cache; the proxy fixed that but not the cold read.)
- **It broke coast tracing.** Protomaps draws the coast from the `earth` LAND
  polygon, and land is not continuous: the outer coast is the mainland plus
  separate barrier islands. Consecutive watch/warning breakpoints hop between
  those landmasses, so the tracer rejects most legs `split-landmass` and chords
  the gaps. Measured live on Bertha (upper Texas coast, 2026-07-24): 2 of 7
  legs traced. OpenMapTiles' ocean polygon is one continuous edge across every
  island and does not have this failure.

**Reviving R2 is one flag.** `style-dark.js` and `coast-source.js` still carry
the Protomaps path; set `TILES.useR2` true to switch back. The archive, the
`TILES_BUCKET` binding, and the proxy are untouched, and the client never reads
the pmtiles format — the library is vendored server-side at
`functions/tiles/_pmtiles.js`. If the archive is ever regenerated, bump a `?v=`
on `TILES.tilesUrl` rather than trusting caches to notice.

**Fonts come from OpenFreeMap either way.** `glyphs` in `style-dark.js` points
at OpenFreeMap's font endpoint regardless of `useR2`, so text layers — storm
name labels, live since Phase 2 — fetch glyphs from OpenFreeMap. Self-hosting
fonts is an open decision (§15), not a bug.

### The two schemas are not interchangeable (hard-won, cost a broken deploy)

**OpenFreeMap serves the OpenMapTiles schema. Protomaps serves its own. They
share layer *names* but not layer *meanings*, and the difference is structural,
not cosmetic.**

- **OpenMapTiles has no land polygon layer at all.** Land is defined as the
  absence of water. Its `landcover` layer is surface *material* — glacier,
  wood, grass, sand — not landmass.
- **Protomaps has a real `earth` layer** that is the landmass.

So the drawing approach inverts by source:

| | Background | Fill on top | Coast traced from |
|---|---|---|---|
| **OpenMapTiles** | land | ocean (`class=ocean`) | ocean polygon edge |
| **Protomaps** | ocean | land (`earth`) | land polygon edge |

Getting this backwards paints the whole globe ocean-colored and leaves only ice
sheets visible. `style-dark.js` carries two separate layer builders rather than a
layer-name lookup table. **Do not "simplify" them back into one.**

**MapLibre's globe `sky` fog bleeds across the entire sphere face, not just the
limb, when blend values are high.** `fog-ground-blend` at 0.55 produces a lit
blue planet; it lives at 0.02. The rim is a thin edge, not a wash.

**Alternatives considered and rejected:**
- **Google Maps.** Three independent blockers: (1) it's a second rendering
  engine that can't share MapLibre's canvas, so switching at a zoom threshold is
  a hard cut, and their terms forbid rendering Google tiles in a third-party
  engine anyway; (2) a billing account with a card is required even inside the
  free tier, and without one the APIs throttle to 1 request/day; (3) the JSON
  styling tool is the legacy path — Google has moved to cloud-hosted styling.
  Also worth recording: every free vector supplier gives *identical* control
  over look and feel, because they all hand over raw geometry and we write the
  style. Supplier choice was never a design-control question.
- **MapLibre demo tiles.** Too crude for production.

## 12. Code structure rules (summary — full rules live in project instructions)

- No god files (the HA card ended at 3,619 lines; never again). Code goes in
  the file that owns its concern; ~700-line ceiling triggers an inventory.
  The ceiling targets accumulated *behavior*, not length as such: a long
  function is worse than a long file. `config/constants.js` is a standing
  exemption — it is frozen data with a stated reason per number, has no logic
  and no coupling, and splitting it would dilute the one-place-for-tuning rule
  in exchange for extra import lines. Don't re-litigate it.
- One-directional imports. Any pattern used twice gets extracted.

### Ceiling inventory (audited 2026-07-24)
The ~700-line ceiling triggers an INVENTORY, not an automatic split. Here is
the inventory, with a call on each. Re-run
`find . -name '*.js' -o -name '*.css' | xargs wc -l | sort -rn` when in doubt.

| File | Lines | Call |
|---|---|---|
| `functions/tiles/_pmtiles.js` | 1721 | **Exempt — vendored.** Third-party library, not our code, never edited by hand. |
| `config/constants.js` | 1347 | **Exempt — standing** (above). |
| `ui/panels.css` | 760 | **Exempt, newly stated.** See below. |
| `functions/api/gdacs/inspect.js` | 734 | **Watch.** A diagnostic route, self-contained by the Pages-Function rule, and it writes nothing. Not in the render path. |
| `map/marker-home.js` | 676 | **Watch — the real one.** See below. |
| `main.js` | 670 | **Accepted** — the target yields to clarity (below). |

**`ui/panels.css` — exempt, for constants.js's reason, not by analogy.** It is
declarative: no logic, no imports, nothing that can throw. Its thirteen
sections (drawer chrome, views, basin groups, storm rows, failure states, the
pill, storm detail, the shared switch row, the segmented control, the Layers
shortcut, settings) are separable, but splitting a stylesheet in a project with
NO BUILD STEP means hand-managing cascade order across files — trading a real
correctness hazard for tidiness. Revisit around 1,000 lines or the first time
a cascade bug crosses a section boundary, whichever comes first.

**`map/marker-home.js` — the one worth watching, and NOT because of its
length.** The whole file is a single factory, `createHomeMarker()`, and §12's
own rule is that a long function is worse than a long file. Inside it:
`readFrame()` is ~150 lines, `drawOnGlobe()` ~114, `drawPointer()` ~80. That is
the shape the ceiling exists to catch.

The cut, if it is ever taken: the two `draw*` functions are pure DOM writing
against an already-computed frame, so they lift into a `marker-home-render.js`
cleanly, and the pure math already lives in `marker-home-geometry.js`.

**NOT TAKEN, deliberately.** §15 records this marker as SETTLED on glass —
altitude, tether, deadzone, pointer placement, chrome avoidance and the bob all
measured on a real phone. Refactoring verified-on-glass code for tidiness
spends the verification and buys nothing a user can see. Take the cut the next
time this file needs a real change, not before.

**`main.js` at 670 against a stated 100-line target.** It stands up two
engines, hands the dive both, and routes input. It stays WIRING ONLY — no globe
logic, no dive math — and the target yields to clarity. The number in the
module layout above is aspirational and has been wrong for a long time; the
rule that matters is the "wiring only" one, and that still holds.
- All behavioral constants (poll intervals, zoom thresholds, TTLs, duration)
  defined in one constants file before the logic that uses them.
- **Derive, never hand-tune twice.** The constants file holds *sources*;
  anything downstream is arithmetic on them. Hand-set clearances drift out of
  sync with the thing they were meant to clear — this cost the HA project a
  label printing over a ring it was supposed to sit outside of, and a rail that
  widened while its reserve didn't.
- **A comment explaining *why* is never the thing you delete to shorten a file.**
  Cut duplicated logic, cut dead code, never cut the post-mortem. The HA card is
  long partly because it carries its own scar tissue — that knowledge survived
  precisely because nobody trimmed it. In Landfall the *rules* live in this spec
  and the code points at them, but that only works if this spec is maintained.
- GitHub is source of truth; local is throwaway.

### Module layout
**Imports only ever point downward.** If something in `map/` needs something from
`ui/`, it is in the wrong file — wire it in `main.js` instead.

```
config/     constants.js  tokens.js  motion.js  layers.js  (imports nothing)
lib/        units.js  geo.js  time.js  category.js    (pure functions)
data/       relay.js  nhc.js  nhc-mapserver.js
            gdacs.js  merge.js  cache.js  store.js    (no DOM, ever)
map/        globe.js  style-dark.js  graticule.js
            markers.js  coast-band.js
            layers/registry.js  layers/*.js
ui/         drawer.js  view-storms.js  view-storm-detail.js
            view-layers.js  view-home.js  view-settings.js
            status.js
main.js     wiring only — target under 100 lines
```

**Built so far** — this list is generated from the tree, not from memory. It
was months stale once already (it still named `ui/panel-*.js` long after the
drawer refactor renamed them all to `ui/view-*.js`), so check it against
`find . -name '*.js'` before trusting it.

```
config/     constants.js  layers.js  motion.js  tokens.js
lib/        bandmerge.js  basin.js  category.js  geo.js  ringpolish.js
            simplify.js  time.js  units.js  watchwarning.js  wind.js
            windswath.js
data/       cache.js  gdacs.js  gdacs-geometry.js  gdacs-points.js
            geocode.js  home.js  layer-prefs.js  merge.js  nhc.js
            nhc-mapserver.js  relay.js  store.js  warm.js
map/        attribution.js  chrome-avoid.js  coast-band.js
            coast-band-cache.js  coast-source.js  coastline.js  globe.js
            globe3d.js  glyph.js  glyph-home.js  graticule.js
            heightfield.js  marker-home.js  marker-home-geometry.js
            markers.js  pin-provisional.js  style-dark.js
map/layers/  cone.js  index.js  label-placement.js  points-forecast.js
            registry.js  track-forecast.js  track-past.js
            watch-warning.js  wind-field.js
ui/         drawer.js  status.js  view-home.js  view-layers.js
            view-settings.js  view-storm-detail.js  view-storms.js
            home.css  panels.css
root        main.js  index.html  tools/check-syntax.mjs
```

**Pages Functions — five routes**, all self-contained on purpose: Pages
Functions run in their own workerd runtime, and importing `config/` would
couple a static site to a bundle step we do not have. Their cache numbers
MIRROR §4's table; that table stays the truth.

| Route | Job |
|---|---|
| `api/nhc/storms.js` | relay job 1 — forward `CurrentStorms.json` past CORS |
| `api/gdacs/geometry.js` | relay job 2 — edge-cache the 180–400 KB per-event geometry |
| `api/geocode.js` | relay job 3 — proxy Mapbox, keep the token off the client |
| `api/nhc/inspect.js` | read-only inventory probe (§15) — deployed permanently |
| `api/gdacs/inspect.js` | read-only inventory probe (§15) — deployed permanently |

`functions/tiles/` (the proxy plus the vendored pmtiles library) is DORMANT —
`TILES.useR2` is false and the app serves OpenFreeMap (§11). Kept because
reviving R2 is a flag flip.

**The two `inspect` routes are the exception to "no diagnostic scaffolding in
the shipped app."** §15 retired the repo-writing probe bridge after use and
says so; these two are different — read-only, write nothing, cost nothing
idle, and each has already turned a day-long misdiagnosis into a ten-minute
read. They stay.

`ui/view-home.js` is the ONE ui/ file that imports `data/` directly
(`home.js`, `geocode.js`) — verified against its import list, not remembered.
It owns the setup flow, so it owns those calls. `view-storms.js` and
`view-storm-detail.js` take home (and, for the detail panel, the geometry
lifecycle) through injected façades from `main.js` — they only READ, and
injection keeps the arrow pointing one way.
**Storm layers attach on `style.load`, never on `load`** — `load` waits on
basemap tiles, and a basemap outage must not blind the storm layer (§5). This
was caught in testing, not on glass; keep it true. The selection-layer engine
(`map/layers/registry.js`) attaches inside the same `style.load` handler,
AFTER the markers, so its layers anchor beneath `storm-dot-planet` and the
severity-colored glyphs stay on top (§6).

**Phase 4 layer ids are resolved BY NAME, not by hardcoded offsets.** Only
two numeric offsets (+12, +13) were ever confirmed on the live service; the
six Phase 4 layers were not. `nhc-mapserver.js` fetches the service's own
layer list once (`MapServer?f=json`, cached 24 h, same CORS-OK host) and
matches names inside the storm's confirmed 26-layer block — the block math
stays authoritative, and the mapping self-corrects if NHC reorders within a
block. Name patterns live at `MAPSERVER.layerName` in constants.

`main.js` stands up two engines, hands the dive both, and routes input, so it
runs over the 100-line target. It stays wiring only — no globe logic, no dive
math — and the target yields to clarity.

**CSS cannot import a JS module**, so `index.html` carries a small block of
first-paint fallback custom properties and `main.js` overwrites them from
`tokens.js` at boot. `tokens.js` remains the single source of truth; the CSS
block is a fallback, not a second definition. Do not edit the fallbacks
independently.

- `store.js` never imports `map/` or `ui/`. They subscribe to it. That is what
  keeps the arrow pointing one way.
- `nhc-mapserver.js` is its own file because the layer-slot arithmetic
  (block + (slot−1)×26 + offset) is the fiddliest math in the project and
  deserves to be testable alone.
- Every layer in `map/layers/` is one file declaring its own type
  (baseline / exclusive-pair / additive) and registering itself. Adding a layer
  later means adding a file, never editing the engine.

## 13. Inherited hard-won rules

### `node --check` DOES NOT CHECK ES MODULES (cost a production outage)
A duplicate `let px` inside one function shipped and took the app to a blank
screen. A SyntaxError means the module never parses, so NOTHING runs — no
globe, no buttons, no status strip. Not a degraded app: no app.

It shipped because the pre-push check was `node --check file.js`, which parses
in SCRIPT mode. The first `import` is invalid in a script, so the parse bails
at line 1 and never reaches the rest of the file. Exit code 0, every time, on
every module in this project.

```
node --check map/marker-home.js    # exit 0 — never saw the bug
node --check map/marker-home.mjs   # SyntaxError: 'px' has already been declared
```

**Run `node tools/check-syntax.mjs` before every push.** It parses every file
with `sourceType: 'module'` and reports file and line. It was itself verified
by re-introducing the exact bug and confirming a non-zero exit — a check that
cannot fail is worse than no check, because it buys false confidence.

**The deeper rule: when replacing a block of code, delete the old one first and
confirm it is gone.** This bug came from a rewrite that inserted a new
declaration block while the old one was still there. "Retire cleanly" (§12) is
not only about dead exports; it is about the half-second of overlap during an
edit.

Ported from ha-hurricane-tracker. These are scars, not preferences.

- **Never feed a measurement back into the choice it decides.** A cached layout
  estimate that picks a mode means one bad read locks in a wrong layout
  permanently. A measurement that only *positions* something — and is re-taken
  every pass, and self-corrects — is fine. The distinction is whether it gates a
  decision.
- **Transformed measurements lie.** An element mid-animation reports a
  scaled/rotated box: a 948×685 card once measured 299×1405. Landfall has camera
  flyTo, panel transitions, and layer fades — anything that measures during
  motion hits this. Detect the disagreement and defer.
- **Freshly written DOM can measure 0×0 in the same task.** Any measure-after-
  render needs a deferred retry with a capped budget.
- **Per-frame normalization, never an absolute ramp.** Scaling symbol size
  against a global range flattens — two attempts at population-dot scaling both
  failed this way. Normalize against the current frame's extremes, using a high
  percentile rather than the max so outliers don't crush everything else.
- **Patch in place when only content changed.** A five-minute imagery heartbeat
  that rebuilds the whole view just to swap one frame makes the map blink.
  Presence changes rebuild; steady-state swaps the source. On a globe with a
  live camera this matters more, not less.

### Chrome, focus, and third-party controls
Earned on the keyboard pass. Each of these cost a wrong fix before the right one.

- **No chrome inside an element whose opacity animates.** Opacity on a parent
  composites everything inside it, so anything mounted into the map element
  fades with the basemap. Attribution is a licensing requirement and must be
  legible at every zoom, so it lives in `#attrib-host`, a fixed *sibling* of
  `#globe`. The rule is general and still binding — the home marker hit the
  same trap later (§9).
- **MapLibre's `AttributionControl` IS NOT USED. We ship our own**
  (`map/attribution.js`, ~40 lines): a 24 px "i" always visible, a small glass
  panel that opens on tap, closed at rest. Attribution must be REACHABLE at all
  times; it does not have to be asserted on arrival.

  **It could not be made to start collapsed from outside.** There is no
  `collapsed` option — the docs say it "is expanded by default, regardless of
  map width" — and it re-expands itself from several handlers
  (`_updateAttributions` calls `_updateCompact` on styledata, sourcedata and
  terrain, and tiles stream in for a while after load). It also owns a native
  `<details>` whose `open` state the browser toggles independently. Anything we
  add is a third actor in that race: measured live, our JS ran successfully and
  was overwritten moments later, and each attempt to hold the state made the tap
  count worse — one tap became three. **Six attempts went in before the rewrite.
  The rewrite was smaller than the workarounds.**

  **THE TRADE, AND THE ONE MAINTENANCE RULE.** MapLibre's control derived
  credits from the style's sources automatically. **Ours does not.** If the
  basemap tile source ever changes, the credits in `map/attribution.js` must be
  updated BY HAND — today OpenFreeMap/OpenMapTiles; flipping `TILES.useR2` back
  to Protomaps would need Protomaps' attribution added there. This is the one
  way that file can silently go wrong.

  Two bullets below are kept as METHOD lessons even though the code they
  described is gone: they are about reading a library before overriding it, not
  about attribution.
- **Read a third-party library's shipped CSS before overriding it.** MapLibre's
  compact attribution set its own `background` *and* `color` on the container.
  Recoloring only the links left the non-link text at `#000` — black on dark
  glass. Guessing at the cascade produced a fix aimed at a color the element
  never used.
- **A closed panel animated with transform and opacity stays focusable.** Tab
  walks through invisible rows. Use `visibility: hidden` on a delayed
  transition — untabbable and out of the accessibility tree when closed, still
  animatable so the slide plays. `display: none` would kill the animation.
- **Focus rings on a tabindex div need plain `:focus`.** Browsers apply the
  `:focus-visible` heuristic inconsistently to a plain div made focusable by
  tabindex. Use `:focus`, with `:focus:not(:focus-visible)` suppressing the ring
  for pointer clicks.
- **Never enlarge an absolutely-positioned third-party button with
  min-width/min-height.** MapLibre's "i" sits in a 24px box; a 44px box bursts
  it out of the clip area and it vanishes. Grow the hit target with a
  transparent `::after` overlay, which does not touch layout.
- **Keydown listeners belong on the outer container, not the canvas
  container.** Keydown fires on the outer element and bubbles up, so an inner
  listener never sees arrow keys — which is how idle rotation ends up fighting
  the user's steering.
- **Pan a globe in degrees, never screen pixels.** `panBy` breaks down under the
  projection: left/right does nothing and up/down jams near ±180°. Move in
  degrees via `setCenter`, the model idle rotation already uses. Longitude
  wraps; latitude clamps.
- **Put `tabindex` on the element that carries the role and the focus style.**
  A tabindex on an inner canvas while `role="application"`, the aria-label, and
  the focus ring live on the outer container means the thing is never a tab
  stop at all.

### Priority ordering
Two orderings, not one. Conflating them is how this gets messy.

**Draw order, bottom to top:**

```
imagery → land fill → graticule → coastline glow →
cone → wind field/swath → model tracks → past track → forecast track →
[coastal pair: watch/warning stripe OR surge bands] →
forecast points → storm dot → home marker → labels → off-screen pointer
```

The middle of that list is the `order` field on each layer definition, and the
numbers are the checkable version of it — `map/layers/registry.js` sorts on
them, nothing else:

| Layer | File | `order` |
|---|---|---|
| Cone | `layers/cone.js` | 10 |
| Wind field / swath (pair) | `layers/wind-field.js` | 15 |
| Model spaghetti tracks | — | NOT BUILT (§7 roadmap) |
| Past track | `layers/track-past.js` | 20 |
| Forecast track | `layers/track-forecast.js` | 30 |
| Watch/warning coastal | `layers/watch-warning.js` | 40 |
| Forecast points | `layers/points-forecast.js` | 50 |

Everything above 50 in the prose list is not in the registry at all: the storm
dot, the home marker, labels, and the off-screen pointer are separate modules.
The registry inserts its whole stack `beforeId: 'storm-dot-planet'`, which is
what holds them above it.

- **The wind field sits BELOW both tracks, not above them** (order 15, against
  20 and 30). The prose list said the opposite for a long time and the code was
  right: the bands are large and translucent, the forecast line is thin and is
  the thing the user is actually following, and painting the bands over it
  covers the answer with the context. This is the "smaller-area layer wins" rule
  below, applied to a shape layer rather than a fixed-color one. Under the cone
  (10) was also tried and buries the bands beneath the veil.

- **Nothing translucent draws over a §6 fixed color.** A translucent cone over an
  orange "Up to 9 ft" surge band tints it, and §6 colors are fixed *because* they
  encode severity. So fixed-color severity layers sit above shape layers.
- **When two fixed-color layers overlap, the smaller-area one wins.** Surge and
  watch/warning are narrow coastal ribbons; wind bands are huge circles. Big
  things survive being drawn under; small things get buried.
- **The coastal pair shares one slot.** They are mutually exclusive (§7) and can
  never draw together, so splitting them across two heights would make the
  ribbon visibly jump when toggled.
- **The cone is edge-dominant** — crisp outline, minimal fill. What you need from
  a cone is its boundary, not its interior. Drawn that way it sits low in the
  stack without losing its job, and stops fighting everything else for pixels.

**Label placement — displace before culling. Whatever can move should move
before anything disappears.**

1. **Displace.** Each label has candidate positions in order — right, left,
   above, below, diagonals, then a leader line at distance. Take the first that
   does not collide.
2. **Cull.** Only when *every* candidate collides does priority decide who dies:

```
selected storm name/category → watch/warning legend →
forecast point times (selected storm) → home readouts →
other storm names → model track labels → graticule labels
```

- **Only labels move. Geometry never does.** A storm dot sits at its reported
  position; a warning stripe sits on the coast it covers. Nudging either to
  resolve a collision is falsifying data. Same principle as §7's "official
  geometry isn't ours to curve."
- **Official geometry outranks derived geometry, always.** A model track label
  loses to a Hurricane Warning every time. The HA card said "mileage always
  loses"; Landfall's version is *distance and derived readouts lose to anything
  NHC published.*
- **Displaced labels need leader lines.** A label far from its dot is ambiguous
  about which dot it belongs to.
- **Solve on `moveend`, never per frame.** Labels measured mid-flyTo report
  garbage boxes (transformed measurements lie, above). During camera motion
  labels ride their anchors on transform only. This is also the frame-budget
  call — re-solving placement every frame during a fly is a disaster on a phone.
- **Cache nothing about fit.** Caching "this one does not fit, use a leader line"
  is a measurement gating a decision, and one bad read locks it in forever.
  Re-solve every pass.
- Solver wrapped per §5: on throw, fall back to naive placement with overlaps
  allowed. Ugly overlapping labels beat a dead map.

## 14. Roadmap

Each phase ends **deployed to Cloudflare Pages and verified on a real phone**.

**BOTH SOURCES, EVERY FEATURE.** No data feature is DONE until NHC and GDACS are
both handled. The two may ship in separate passes — NHC first is usually right,
because its endpoints are confirmed. The sandbox reaches GitHub but not NOAA or
GDACS, so anything needing live upstream bytes goes through the deployed
read-only inspect routes (`/api/nhc/inspect`, `/api/gdacs/inspect`, §12), which
are permanent and cost nothing idle. **The repo-writing probe bridge is NOT
needed for this and must not be rebuilt for it** — the inspect routes are the
standing answer. But a feature with only one source wired is IN PROGRESS, never
done, and it stays on this roadmap until both are.

Half-built means the gap is STATED, not blank. A GDACS storm missing a layer
that NHC storms have must read as "this source doesn't provide it" — never as
absence, and never as safety (§5). Silence where a wind field should be looks
identical to no dangerous wind.

Standing exception, and the only one: where a source genuinely does not publish
the data at all. That is `unavailable` forever, recorded here with what was
checked and when — not an open task pretending to be finishable.

1. **Skeleton on glass + 3D entry — DONE, tiles included.** Repo, accounts,
   DNS, R2 bucket, Pages project all live (§3). The 3D clear globe is the entry
   (§2): blue-family land, grey coasts, the cyan geodesic cage, storm severity
   as node elevation AND node color, and the zoom-driven crossfade into
   MapLibre — which renders filled land, two-pass glowing coasts, and depth
   fade behind it. Graticule ships off by default. Tokens, constants, motion
   carry real values. Basemap serves from OpenFreeMap (§11) — R2/Protomaps was
   trialled 2026-07-23 and reverted 2026-07-24 for tile lag and broken coast
   tracing.
   **Still open:** measure the entry frame on a real phone (two engines run on
   it) and take the time-to-first-paint baseline.
2. **Storm dots — DONE. Deployed and verified on desktop and a real phone
   against live feeds.** Both storm lists via their decided paths (NHC through
   `/api/nhc/storms`, GDACS direct); client-side merge, NHC-wins; every active
   storm plotted — hemisphere-rotated two-arm spiral in category color at every
   band, planet-band glyphs included, names z3+; storm list panel
   (pill → bottom sheet narrow, left rail wide), strongest-first within
   canonical basin order, basin headers as real h2s only when >1 basin; the
   three failure states built and exercised in headless tests. No scope filter
   UI — absent, not disabled. Row/dot activation flies the camera and opens
   the storm detail panel (Phase 4).
3. **Home — DONE. Deployed and confirmed on a real phone.** Location set three
   ways (geolocation, Mapbox address search, drag-a-pin — never prompted on
   first launch); home marker as a house glyph floating above the lattice on a
   zoom-scaled altitude curve, tethered along the surface normal to its exact
   surface point; off-screen pointer (house + arrow on one axis) riding the limb
   with a bob and routing around on-screen chrome; distance on every storm row;
   scope filter live with all three scopes; storm list flips to nearest-first
   within basin order.
   **Deliberately deferred, with reasons:**
   - **Closest approach: LIVE, confirmed on glass 2026-07-24** (the
     `validtime` parser fix, §7). The wiring was always right — the detail panel decorates
     the selected storm with normalized forecast points and
     `closestApproach()` computes against them — but `normalizeForecast()`
     could not parse `validtime` (`"24/0600"`, not epoch ms), so `time` was
     null on every point and the readout silently degraded to distance-only
     for its entire life. That failure stood unchallenged because
     distance-only is ALSO the honest GDACS fallback, so it rendered as a
     legitimate state. `parseNhcValidtime()` (§7) now feeds real times;
     storms without a forecast track (GDACS, or a failed geometry fetch)
     still honestly show distance only.
   - **Settings view EXISTS but is a stub** (`ui/view-settings.js`). Units
     still resolve from locale via `lib/units.js` and the manual override (§8)
     is not built — but the view is not missing, it is honest: it names the
     current behaviour ("Units follow your device — currently imperial") and
     what will live there. It exists rather than being deferred because the
     alternative was a control-cluster button that does nothing, and a control
     that silently no-ops is the same class of failure as a toggle that draws
     nothing (§5). When settings lands it fills this file in rather than adding
     a panel. Auto units are correct for most users, so this is a gap, not a
     blocker.
   - **`MAPBOX_TOKEN` is not yet set in Cloudflare Pages.** Until it is,
     `/api/geocode` returns `geocode_not_configured` and the panel says address
     search isn't set up, offering the pin instead. Geolocation and pin-drag
     work without it. This is configuration, not code.
4. **Select → fly + detail — BUILT, awaiting on-glass verification.** Selection
   (dot tap, list row, Enter) opens the storm detail panel in the list's slot
   and flies the camera with a one-shot `offset` derived from the panel's real
   box (never `padding` — §16). Per-storm MapServer geometry — cone, past
   track, forecast track, SS-colored forecast points (`ssnum`, reported) with
   time labels (additive toggle, default ON, ladder-gated) — **now rendered
   DEVICE-LOCAL from the parsed `_time` (fixed 2026-07-24; `datelbl` no
   longer renders anywhere — §7). A point whose time will not parse shows no
   label, the honest gap.** —
   watch/warning stripe in §6 colors — through a per-(storm, advisory) LRU
   cache that also caches failures (re-selection retries).
   **Geometry is WARM and AMBIENT (§9):** `data/warm.js` prefetches bundles
   for every NHC storm as the feed lands, and the layer engine draws them at
   EVERY zoom with no band floor and no tap required — the 3D-to-MapLibre
   crossfade is the real gate. `ZOOM.ambientGeometry` (z4) survives on only
   the time labels and the watch/warning stripe. Ambient time labels are ON, spoke-placed
   (§7) — the wall-of-text objection that kept them off is answered by the
   placement pass, which hides only what genuinely cannot fit. **The label
   SPOKE AXIS is STILL BROKEN (§15) — labels sit above/below their dot rather
   than radiating from it. A real grouping bug was found and fixed along the
   way (storms were placed as one track) but did not resolve this. Four
   suspects are now ruled out by live measurement; see §15.**
   Selection moves the tapped storm into its own layers and excludes it from
   the ambient collections so nothing double-draws; the two render
   identically, so this is a data split, not a visual difference. The detail panel carries the freshness-
   banded timestamp, the geometry-lag second line (time-based via
   GEOMETRY_LAG_THRESHOLD; validated against the live Bertha/Fausto lag
   measurements), the home block with `closestApproach()` now live, three
   distinct watch/warning strings (none / unavailable / not-available-for-
   GDACS), ghost form in place, and persisted section collapse. Closing a
   panel holds the camera AND the drawn geometry; recenter (button or
   Esc-twice, one shared path) ends the selection.
   **Deliberate deviations, with reasons:** watch/warning stripe traces against
   the OpenMapTiles ocean edge (§7 as-built); layer ids are
   name-resolved within the confirmed block (§12 — the six Phase 4 offsets
   were never recorded); forecast point times parse from `validtime` and
   degrade to null (closest approach then shows distance without hours).
   **Confirmed on glass 2026-07-23:** the two globes stay locked through zoom
   after a selection (the padding regression's test); the whole ambient set
   arrives together on one zoom step; past track dotted and forecast track
   solid; labels render at every band, ambient and selected, with collision
   avoidance and side-balancing working.

   **Still to verify on a phone:** fly offset at both widths; label density
   at z4–5 (the thin-to-24 h [DECIDE] above); that labels re-place cleanly
   after a drag settles rather than looking stuck; whether the untraced
   stripe visibly chords across bays now that it draws at z4; the
   classification code staying legible inside the dot at every band; and the
   toggle/retry rows under a real outage. The label-density judgements remain
   blocked behind the spoke axis bug (§15) — judging density is not meaningful
   while every label sits in the wrong place.
5. **PWA.** Manifest, icons, service worker with stale-while-revalidate;
   install verified on iOS and Android.
6. **Layers.** Layers panel (§7), then one layer at a time. Phase 6 is six
   separate deliveries, not one — hence `SHIPPED_EARLY` (§7) alongside
   `SHIPPED_THROUGH`. The steps, in order:

   1. Layers panel and manifest — **DONE** (`85c385f`).
   2. Wind field — **DONE. BOTH SOURCES, CONFIRMED ON A PHONE 2026-07-24.**
      NHC `9fcf9f8`; GDACS confirmed the same day after four on-glass
      passes — all three thresholds (green, orange, red) render as clean
      corridors with rounded ends, and Current shows the analysis-time
      footprint. §14's both-sources rule is satisfied for this layer.

      **The four passes are recorded below because the METHOD lesson is
      worth more than the fixes.** Each pass Aaron looked at a phone and
      found something four rounds of my synthetic fixtures had not.

      *What the first screenshot proved right:* bands draw, in the §6
      colors, nested correctly, on a GDACS storm in a basin NHC does not
      cover.

      *What it proved WRONG, and this is the valuable half:*
      - **The bands are QUADRANT-SHAPED.** The spec's inherited "one radius,
        symmetric circles" claim was false. Corrected in §4 and §6, and the
        panel's apologetic source-limitation note was deleted.
      - **Current drew NOTHING.** `splitPair` selected by `Math.max` on
        `polygondate` — the FURTHEST-OUT forecast (+60 h), not now. The
        layer worked perfectly and drew the ring hundreds of miles from
        where the camera had flown. **A layer that draws correctly in the
        wrong place is indistinguishable on glass from a layer that failed**
        — no error, no empty state, nothing in the console, just absence.
        Worth remembering the next time a layer "does nothing": check WHERE
        before checking WHETHER.
      - **The stack compounded**, exactly as NHC's did before its swath was
        built. Now merged per threshold via `lib/bandmerge.js`.

      *Second on-glass pass, same day — Current and the merge both work; one
      thing left:*
      - **The merged bands BEADED.** Each threshold traced as a string of
        disconnected blobs rather than a corridor, because GDACS fixes are
        ~12 h apart and a band narrower than the distance travelled leaves
        gaps. **This spec argued one commit earlier that those gaps were
        honest. That was wrong** — discrete fixes are samples of a continuous
        process, which is exactly why the NHC sweep interpolates between its
        own. Fixed by bridging consecutive shapes (§4), bounded so the
        corridor never exceeds published extent.
      - NHC storms were re-checked in the same pass and are unaffected —
        `lib/windswath.js` is not touched by any of this and cannot bead.

      *Third pass — the ends pinched to a point.* First fix was a straight
      taper between the widest points of consecutive shapes, which does not
      follow real widths when shapes differ in size. Replaced with
      interpolated shapes. **It was not the cause**, and four synthetic
      fixtures all passed while glass kept failing.

      *Fourth pass — RESOLVED, from real coordinates (`?dump=1`).* Two
      findings, both invalidating work done on guesses (§4):
      - **The pinch was DEGENERATE ZERO-AREA POLYGONS.** Aaron diagnosed it
        from the map before the dump confirmed it. No invented fixture ever
        contained one.
      - **GDACS already publishes the merged swath.** Two commits were spent
        rebuilding a product sitting in the same response, hidden by a
        `featuretype === 'WindRadii'` filter.

      **THE METHOD LESSON, and it cost most of a day: when a fixture passes
      and glass fails, the FIXTURE is wrong. Stop building fixtures and go
      read the real bytes.** This is the same shape as the wind-swath day
      (§15) — validating against synthetic input while the real input was
      the thing that differed. `/api/gdacs/inspect?dump=1` is permanent so
      the next question costs ten minutes, not a day.

      `data/gdacs-geometry.js` returns the identical bundle shape
      `nhc-mapserver.js` does, so `wind-field.js` and the panel are
      source-blind and needed no changes. The same fetch also fills cone,
      forecastTrack and pastTrack — all three CONFIRMED present, all three
      previously declared absent — but only the wind pair is wired this
      pass.

      **GDACS PARITY — where it stands after 2026-07-24.**
      1. **Forecast points — DONE, CONFIRMED ON GLASS.** Parsed in
         `data/gdacs-points.js` from the 11 timestep dots; times verified
         against the band keys across two real dumps (§4). Fills the bundle's
         `forecastPoints` and `pastPoints` slots and the `forecast` array,
         which unblocked closest-approach-to-home for GDACS storms.
      2. **Cone and both tracks — ALREADY DRAWING.** Confirmed 2026-07-24.
         They were wired the moment `gdacs-geometry.js` filled the slots,
         because the layers read slots and not sources. The claim that only
         the wind pair was wired was stale.
      3. **Track intensity coloring — DECIDED AGAINST (Aaron, 2026-07-24).
         Do not re-propose it.** The segments carry TD/TS/HU and the centre
         dots already read it; the track LINES stay one flat color. The
         past/forecast grammar is dotted-and-dim versus solid-and-bright
         (§7), and severity belongs to the dots and bands.

      **GDACS parity is therefore COMPLETE for Phase 6 step 2.**
   3. Surge + surge-at-home — spatial envelope (§4); no surge watch/warning
      product exists anywhere in NHC's services, so pair A's second half is
      bands only.
   4. Wind arrival — **FETCH layers `+15`/`+16`, do not compute** (§4).
   5. Model tracks with the per-model selector.
   6. Advisory text.

   The at-home **exposure timeline** stays computed rather than fetched: it
   is a home-intersection test against the forecast rings, not a published
   product. It depends on step 2's rings and step 4's arrival layers, so it
   lands after both.
   **Step 1 DONE** (`85c385f`): one drawer replacing three sibling panels,
   the sixteen-layer manifest (`config/layers.js`), the prefs store, the
   Layers view. Every Phase 6 row renders dimmed with its reason until its
   step lands; `SHIPPED_THROUGH` is the one switch that un-dims them.
   **Step 2 — wind field, NHC ONLY. CONFIRMED ON GLASS 2026-07-24 (phone,
   two live storms).** The "Full track" segment renders the three-tier
   swept ENVELOPE (§4 as-built) — past (+10 joined to +7), current, and
   forecast merged into one smooth outline per threshold in
   `lib/windswath.js`, built into the bundle's `windSwath` slot with the
   raw +12 rings as the §5 solver fallback. The "Current" segment still
   draws +13's official polygons directly. Verified: the envelope draws,
   the tiers read as one shape, thresholds nest, and the smoothing pass
   (§4) resolved the jagged first look. **Still unverified, because it
   needs conditions that were not present:** behaviour with many storms up
   (the soup check below), contrast over a lit landmass, and a
   looping/stalling track against the known self-intersection limit.
   **THE "FULL TRACK" SEGMENT WAS DRAWING THE WRONG LAYER FOR A DAY.**
   `windSwath` resolved to **"Past Cumulative Wind Swath"** instead of
   **"Forecast Wind Radii"** — the pattern contained `wind.*swath` and the
   past layer's name matched first. So a control labelled "Full track"
   showed where the storm had ALREADY BEEN, which is §5's asymmetry
   violation exactly: a smaller promise silently rendering different data.
   Nothing looked broken, because a wrong-but-plausible layer draws a
   confident shape. Three separate attempts to fix its "jagged edges"
   followed, all of them sanding a raster that should never have been on
   screen. Fixed 2026-07-24 by reading the real layer list through
   `/api/nhc/inspect`; patterns are now anchored on NOAA's exact names and a
   multi-match is a REFUSAL rather than resolved by match order.
   `pastTrack` was wrong too — it matched the group layer "Past Track
   Infomation" (NOAA's typo) instead of "Past Track".
   **The confirmed block layout is now recorded in `MAPSERVER.layerName`.**
   Three nested bands in §6 colors (34 kt widest and bottom, 64 kt core on
   top via sort key), drawn AMBIENTLY on every storm rather than only the
   selected one — a layer the user set and forgot should not apply to one
   storm. Both segments fetch together with the cone (`windCurrent` /
   `windSwath` in the same bundle), so switching Current ↔ Full track is a
   redraw, never a refetch. `lib/wind.js` owns threshold detection,
   `map/layers/wind-field.js` the drawing, and the engine gained `setPair()`
   — pairs previously had no mechanism at all, only additive toggles.
   **Deliberate calls, with reasons:**
   - **A band whose threshold cannot be identified is DROPPED, not drawn in
     a fallback color.** These are the §6 safety colors; a missing ring is
     visible and gets reported, a ring in the wrong green is invisible.
   - **No last-resort property scan**, unlike the watch/warning detector: a
     test caught `tau: 34` (forecast HOUR) being read as a 34 kt band. Codes
     like "HWR" are distinctive; 34/50/64 are ordinary numbers.
   - **`radii` IS the threshold field — CONFIRMED LIVE** on Fausto EP1
     2026-07-24, on both `+10` and `+12`. The former `[VERIFY]` is closed.
     `lib/wind.js`'s header still says the name was never read off live
     data; that comment is stale and contradicts this section.
   - Fill opacity is tuned for the STACKED result (three nested polygons
     compound where they overlap), not for one band alone.
   - **THE RASTERIZATION DISPUTE IS SETTLED — `lib/smooth.js` IS RETIRED
     (2026-07-24).** Layer `+9 Past Cumulative Wind Swath` was measured
     directly (layer 143, live on Fausto, `&geom=1`): **100% of its edges
     are axis-aligned** — 496/496, 1101/1101, and 1538/1538 across the
     three bands, share 1.0 on every feature. `+9` IS the rasterized layer.
     `+10` and `+12` measured clean (one vertex per degree of bearing — a
     compass-sampled shape, exactly the construction this spec prescribes).
     So both earlier observations were correct AND about different layers:
     the staircase was real, on the layer the resolver bug was drawing;
     the smoothing was built correctly, against a layer the app should
     never have shown and no longer can (multi-match refuses). With no
     rasterized layer left in the draw path, `lib/smooth.js` and
     `WIND_SMOOTH` retired under §12 — deleted, not archived.

     Retained regardless, because they are true of the METHOD and cost a day
     each to relearn: Chaikin's displacement is bounded where a spline's is
     not; corner-cutting shrinks convex corners but BULGES into concave ones,
     so a pure area check passes while the boundary leaks outward; clipping
     stray vertices back onto the raw ring cancels the smoothing outright
     (93% of vertices landed outside at a concave corner and were dragged
     back, giving four times the points and an identical outline — it
     shipped, looked unchanged on glass, and only a turn-angle probe caught
     it); and a test that measures right angles and containment never asks
     whether the outline MOVED.
   **Fixed along the way:** `ambientBundle()` never called `attach()`, so
   geometry arriving before the first selection was stored but undrawn. Only
   masked because main.js attaches on style.load.

   **GDACS wind bands SHIPPED the same day** — see the four on-glass passes
   recorded above. This step previously ended with a paragraph declaring them
   blocked behind a probe bridge that had to be rebuilt "before any code"; the
   bands were built, confirmed on a phone, and the paragraph outlived them by a
   day, sitting directly beneath the record of its own obsolescence. **A
   blocker is not done being maintained when it is cleared — it has to be
   deleted, or the next reader trusts it.** The read-only
   `/api/gdacs/inspect` route is what actually unblocked this, and it stays
   deployed (§12).
7. **Imagery + playback.** Satellite/radar layers, play/scrub loop.
8. **Polish.** Idle rotation tuning, light mode pass, animation tuning,
   a11y audit, color-contract audit against the real basemap.

## 15. Open decisions — next session agenda

Everything remaining is measure-on-glass, except the one open bug below.

**OPEN BUG — the forecast time label spoke axis. Still wrong on glass after
four attempts.** Labels sit above or below their dot instead of radiating along
the normal to the track. Attempt four (`c43f1d7`, 2026-07-23) fixed a real bug
and did NOT fix this one.

**Ruled out by live measurement — do not re-investigate these.** Read directly
off the source in the browser with two storms up:
- `_o` survives `setData` as a genuine JS array of two finite numbers.
  `typeof` is `object`, `Array.isArray` is `true`. The transport works.
- The values are real 2D vectors, including true diagonals
  (`[-2.34, 0.34]`, `[-0.22, 2.35]`). Placement is emitting spokes.
- Therefore: not `text-offset` data-driven support, not the array form, not
  the Y sign, not the em conversion. The four ranked suspects that stood for
  three sessions are all dead.

**Fixed along the way, but not the cause.** Placement grouped points by storm
on `stormId ?? STORMID ?? '_'` and NHC's 5-day points layer publishes neither,
so every point from every storm fell into one bucket and was placed as a single
track — the tangent at the seam between two storms was a chord across an ocean.
That was real and is fixed: the key is now `basin` + `stormnum`, confirmed off
a live feature, with `idp_source` as fallback and `stormname` rejected (it
carries intensity, so it changes when a storm strengthens). Unattributable
points are hidden rather than placed off a borrowed neighbour, and each track
is sorted by `tau`. Note `stormid` DOES exist as a queryable MapServer field —
`data/nhc-mapserver.js` filters on it — but is not returned in feature
properties, which is why the guessed key looked reasonable.

**The labels are still wrong after that fix**, so at least one further fault
remains. Nothing downstream of grouping has been verified against live data.

**Where to start next time.** The offsets reaching MapLibre are correct 2D
vectors, so the question is no longer "what is `_o`" but "does the rendered
label actually sit where `_o` says." Suggested first measurement, before any
code: pick one visible label, read its `_o` and its dot's screen position via
`map.project()`, compute where the label centre should land, and compare
against where it visibly is. That separates "the vector is wrong for this
dot" from "MapLibre is not applying the vector as expected" — a split no
amount of reading the placement math can settle.

Also unverified: whether `applyPlacement` output actually reaches the rendered
tiles unmodified, and whether the ambient and selected layers behave the same
(`sel-fpoints` was empty in every measurement so far — all live readings came
from `amb-fpoints` only).

**Method note, earned four times over.** Every fix here that passed offline
validation has failed on glass, because the isolation tests feed synthetic
tracks that cannot reproduce the real conditions. Reading live feature
properties in the browser killed four standing suspects in one step. Do not
open the next attempt with a validator run. Measure the running app first.

**And the harder version of the same lesson, 2026-07-24.** The wind swath ate
a full day across three failed fixes — smooth, clip, shrink-then-smooth —
every one of them sanding a staircase. The staircase was real. It was also
the WRONG LAYER: `windSwath` resolved to "Past Cumulative Wind Swath" instead
of "Forecast Wind Radii", so a control labelled "Full track" was drawing
where the storm had already been.

**And that DID explain the rasterization dispute — confirmed 2026-07-24.**
The staircase was observed while the app was drawing `+9 Past Cumulative
Wind Swath`; `+9` was then measured directly (layer 143) and 100% of its
edges are axis-aligned, while `+10` and `+12` are clean. `lib/smooth.js`
was built correctly against a layer the app should never have been drawing,
and is retired with that finding (§14). Ten minutes reading the service's own layer
list found it, and the same read exposed a second silent bug (`pastTrack`
matching a group layer) plus five useful layers nobody knew were there.

Three rules out of it, all of them cheap:
1. **Read the source's own inventory before writing a pattern against it.**
   Not the documentation, not the layer name — the inventory. When the
   sandbox cannot reach the source, a read-only Pages Function can, and
   building one costs ten minutes (see 0a above).
2. **A resolver that picks by match order will fail silently.** Wrong-but-
   plausible geometry draws a confident shape with nothing visibly broken.
   Multi-match must REFUSE, not choose.
3. **When a fix fails twice, stop fixing and question the input.** Three
   attempts at the edge treatment all assumed the shape was correct. It was
   not, and no amount of edge work was ever going to help.

**Still to verify on glass:**

0a. **THE GDACS INVENTORY — DONE 2026-07-24. Findings folded into §4.**
   Read live via `/api/gdacs/inspect` against NOUL-26 (`1001294`, ep 6). It
   found what the NHC inventory found: the inherited description was wrong.
   The band thresholds were wrong (60/90/120 km/h, not 34/50/64 kt), three
   `can` flags were wrong (cone, forecastTrack, pastTrack all exist), and two
   field reads were wrong (`country` vs `affectedcountries`; `severitytext`
   discarded). **The endpoint stays deployed** — it costs nothing, writes
   nothing, and the next GDACS question gets answered in ten minutes instead
   of a day.

   **Simplification is BUILT, and the numbers that justified it:** 8,868
   coordinates for one storm, largest single ring 365 points. `lib/simplify.js`
   (Douglas–Peucker, `SIMPLIFY.gdacsToleranceDeg`) measured a ~80% reduction
   on realistic rings with area error under 1% on the bands that matter.
   **The floor is the safety property**: a ring that cannot be reduced without
   falling below `minRingPoints` is returned UNTOUCHED. Simplification must
   never delete a ring — a missing wind band is indistinguishable from "no
   dangerous wind here", which is the §5 lie the surge notes already record.

   **Frame budget confirmed acceptable on a phone 2026-07-24** — GDACS bands
   drawn ambient alongside NHC storms, no reported stutter. Note the swath
   now uses GDACS's own published corridor rather than a reconstruction, so
   the drawn vertex count is lower than the numbers above imply.

   **Two `data/gdacs.js` field bugs found by report 1 — BOTH NOW FIXED:**
   `raw.countries` read the display string `country` instead of the
   structured `affectedcountries`; `severitydata.severitytext` was discarded
   and is now surfaced. Both corrected 2026-07-24.

   **RESOLVED 2026-07-24 — `severity` IS THE FORECAST PEAK, NOT THE CURRENT
   WIND. Fixed; do not re-derive a category from it.**

   Proven four independent ways on NOUL-26:
   1. It reported 157 km/h while its own `severitytext` said Tropical Storm.
   2. The published red 120 km/h swath spans 113.3°–118.36°E; the analysis
      position is 120.4°E. **Hurricane-force wind does not reach the storm's
      current position** — it begins twelve hours out.
   3. The track leg ARRIVING at the current position is labelled `TS`.
   4. On glass: the storm sat visibly outside its own hurricane-force band.

   Three of four live storms disagreed with themselves in one event-list read
   (SEVEN-E-26 said Depression while carrying 100 kt; BERTHA said Depression
   carrying 50 kt). All four convert to exact round knots, so GDACS stores
   knots and publishes km/h — `KMH_PER_KT` was never the problem.

   **AS BUILT.** `severity` → `storm.peakWindKt`, surfaced as "Forecast peak"
   and never as "Winds". `storm.windKt` is NULL for GDACS: the source
   publishes no current wind, and a field named windKt holding a peak gets
   read as "now" by everything downstream. Current intensity comes from
   `severitytext`, giving `category` (0/1/null) plus `categoryCode`
   (TD/TS/HU), with `categorySource: 'reported'`.

   **THE CEILING IS THE SOURCE'S.** GDACS's strongest band is 120 km/h = the
   Cat 1 floor, so a Cat 1 and a Cat 5 are indistinguishable in everything it
   publishes. GDACS storms therefore never carry a Saffir-Simpson NUMBER —
   `HU` plus the §6 rose, never a borrowed category color.

   **SORTING AND THE CAGE DIVERGE, DELIBERATELY.** Sorting falls back to
   `peakWindKt`: a list is a ranking, "how big is this storm" is the honest
   question, and a typhoon sorting to the bottom would be its own failure.

   **THE CAGE ELEVATION DOES NOT — CORRECTED 2026-07-24.** It read
   `windKt ?? peakWindKt`, so every GDACS storm fell through to the FORECAST
   PEAK and stood at a height describing a moment that had not happened. The
   node COLOR beside it comes from the current classification, so height and
   hue were telling different stories on exactly the storms §9 claims they
   cannot ("elevation and color are one signal from one number"). A broken
   invariant, not a tuning preference.

   The cage now uses `representativeKt()` (`lib/category.js`): the MIDDLE of
   the stated class's wind range when no measured wind exists. The middle,
   not the floor — given only "this is a tropical storm", the expected wind
   is the centre of the band, not its lowest possible value. Midpoints are
   DERIVED from `CATEGORY_THRESHOLD_KT` (§12: constants hold sources,
   downstream is arithmetic), with `CATEGORY_TOP_KT` (155 kt) supplying the
   open-ended Cat 5 an upper bound. A measured `windKt` always wins, so NHC
   storms are untouched.

   **ACCEPTED CEILING:** every GDACS hurricane lifts to the middle of the
   whole hurricane range (~110 kt, between Cat 3 and Cat 4) because the source
   cannot distinguish a Cat 1 from a Cat 5. Big typhoons therefore read
   SHORTER than they did under the peak. That is the source's honest limit and
   the §6 rose carries "category unknown" in the color channel.

   **`representativeKt` IS NOT A MEASUREMENT AND IS NEVER DISPLAYED.** It
   feeds ranking and visual ramps only. The detail panel still omits wind for
   a GDACS storm rather than printing a midpoint as if GDACS had said it (§5).

   **`Line_N` IS GROUPED BY INTENSITY, NOT TIME** (measured: 0-2 HU, 3-4 TD,
   5-9 TS). Legs are matched by COORDINATE and the suffix is never read.
   Anything that sorts on it will silently scramble the track.

   **The leg direction was wrong and shifted every dot one step early** —
   caught on glass. A point takes the leg ARRIVING at it (the interval ending
   there), not the one leaving.

0b. **The wind field (Phase 6 step 2). RESOLVED, OPEN, and MEASURE-ON-GLASS:**

   **Resolved 2026-07-24 — do not re-probe:**
   - `radii` IS the threshold field, live on `+10` and `+12`.
   - `+10 Past Wind Radii` carries `ne/se/sw/nw`, `synoptime`, `timezone:
     "UTC"` — the past tier needs no zip (§4).
   - Storm asymmetry is large and real (`ne 80, se 170, sw 160, nw 40`).
   - `+7 Past Points` schema read live (layer 141, 2026-07-24): centres
     joinable to `+10` on the 10-digit synoptic time — `+7.dtg` (number) ↔
     `+10.synoptime` (string). Geometry carries full precision; `lat`/`lon`
     attributes are rounded whole degrees. Full record in §4. The past
     tier is UNBLOCKED and the zip fallback is retired unbuilt.
   - `+9 Past Cumulative Wind Swath` IS the rasterized layer (layer 143,
     2026-07-24): 100% axis-aligned edges on all three bands. Dispute
     settled; `lib/smooth.js` retired (§14).

   - `+2 Forecast Points` geometry precision confirmed (layer 136,
     2026-07-24): geometry carries full precision (`-129.9, 18.5`) while
     the `lat`/`lon` attributes are rounded whole degrees — the same
     pattern as `+7`, now measured on both. The app reads geometry, so no
     code change. The same read cross-validated `parseNhcValidtime` against
     live truth: `validtime "24/0600"` alongside `fldatelbl "2026-07-23
     8:00 PM Thu HST"` is 06:00 UTC on the 24th, which is exactly what the
     parser returns. 9999 sentinels also seen live on `mslp`/`tcdir`/`tcspd`
     beyond tau 0, as documented.

   **Nothing in the wind-field probe set remains open.**

   **Measure on glass:**
   - **Soup check.** Bands draw ambiently on every storm with no zoom floor.
     Several storms up may turn the map illegible. The intended fix is a
     floor keyed off `ZOOM` — one constant, not a rewrite.
   - **Contrast over land (§6 audit).** 34 kt green over a lit landmass is
     the case the color note flags; `STORM_GEO.windFillOpacity` is the dial.
   - **Segment switch.** Current ↔ Full track must change the shape without
     a refetch or a flicker; both slots are already in the bundle.
   - **Envelope on glass.** The swept envelope (§4 as-built) is ~330
     vertices total — the old 21k past-tier weight concern is void. What
     needs eyes instead: the tier seams (past→current→forecast should read
     as one continuous shape, no kink at the current position); nested
     thresholds sitting cleanly inside each other; the end caps looking
     circular; and whether any live storm with a looping/stalling track
     self-intersects the corridor (known limit, §4). If the envelope ever
     draws obviously wrong, the console says whether the solver fallback
     fired — the raw stacked rings are the degraded-but-correct state.

0c. **Time handling — BUILT 2026-07-24. Verify on glass:**
   - `parseNhcValidtime()` built and tested (§7); closest approach now gets
     real times; labels render device-local via `formatClockDay()`;
     `datelbl` renders nowhere. On-glass check: labels show YOUR local time
     with a weekday, and the detail panel's closest approach carries hours.
   - `lib/wind.js`'s stale "NOT CONFIRMED LIVE" header rewritten to record
     the live confirmation. The previously-claimed stale "assumed" comment on
     `MAPSERVER.layerName.radii` does not exist — there is no `radii` key in
     `layerName` and no "assumed" comment anywhere in constants; that claim
     was itself the stale documentation.
1. `[VERIFY]` NHC parse details against live data: `movementSpeed` units (kt
   assumed), classification codes actually seen (PTC/PT mapping), `advNum`
   presence. All marked in `data/nhc.js`.
2. **Finish the keyboard pass.** Tab order through the app controls, focus
   rings, and zoom are confirmed good. Storm rows are real `<button>`s, so
   Enter-to-fly should work natively — but it has never been walked on glass,
   and neither has whether the focus ring stays legible against the globe at
   every zoom band. Both are pure verification, not open builds.

   **[DECIDE] pan-over-the-pole.** Latitude stops at `GLOBE.keyPanMaxLat` (88°)
   because a camera at ±90° has no defined up-vector and flips the view;
   longitude wraps forever. The stop is a constraint, not a bug, and no value
   removes it. The open question is whether to continue past 90° by flipping
   longitude 180° and descending the far side, making up/up/up continuous.
   Aaron has asked for "nothing blocking me," so this is live — but the view
   rolls as you cross, which may read worse than a clean stop. Measure on glass
   before committing.

**Finish Phase 1:**
3. **R2/Protomaps trialled and REVERTED (2026-07-23 → 2026-07-24).** The
   archive was built, uploaded, and served, but it lagged while panning and its
   land-polygon schema broke coast tracing (§11); the basemap is OpenFreeMap
   again. Storm-name labels fetch glyphs from OpenFreeMap's font endpoint
   regardless (§11) — the fonts-self-hosting decision below is independent of
   the tile source.
4. Measure time-to-first-paint on a real phone (fold into item 2's pass).
   Basemap now serves from OpenFreeMap's CDN (§11); judge tile speed on the
   phone as part of the same pass.

**The node-elevation heightfield (`map/heightfield.js`, §9):**
5. Turn the current-fix peaks into the **full comet-tail**: feed the
   `setStormPoints()` seam the whole storm track, each point at its intensity-
   at-that-time, live head tallest. The seam already takes a weighted-point
   list, so this is data plumbing, not a rewrite.

   **BOTH BLOCKERS THIS ITEM LISTED ARE GONE, and one was never real.** It
   said "NHC past-track is CORS-blocked (build the relay), GDACS track is the
   slow/flaky geometry endpoint (relay-cache it)".
   - **NHC was never CORS-blocked.** §4's own browser-tested table says the
     tropical MapServer is fetched DIRECTLY, and the app has been reading past
     tracks and past points from it since the wind swath shipped. This claim
     contradicted a measurement two thousand lines above it.
   - **GDACS is relay-cached now** (`/api/gdacs/geometry`, §4).

   **AND THE DATA IS ALREADY FETCHED.** `+7 Past Points` carries per-point
   `intensity` in knots, `mslp`, `ss` and `stormtype`, and the wind swath
   already pulls that layer for its past tier. GDACS's `pastPoints` are parsed
   with their intensity codes in `data/gdacs-points.js`. Both sources' bundles
   hold everything the tail needs. This is no longer blocked on anything —
   it is wiring the existing `pastPoints` slot into the seam.
6. Fine-tune `stormAmp`/`stormSigma` against real storms; decide whether the
   outage "desaturate + hold" cue is legible enough on a wordless globe or needs
   more (a pulse, a status word).

**Reduce-motion: camera moves are a DIRECT PAN, never a teleport.**
The first pass made `flyTo` an instant `jumpTo` under the OS preference. That
contradicted the rule beside it ("a transition of 0 makes state changes hard to
follow") and, on a globe, an instant cut is worse than a move — you lose the
spatial thread and have to re-find where you are. What the preference actually
guards against is large-area parallax and swooping, which is `flyTo`'s arc out
to space and back. So under reduce-motion every camera travel becomes a short
eased `easeTo` at constant zoom, routed through one `travelTo()` primitive in
`map/globe.js` so the contract exists in exactly one place.

**The home marker — SETTLED on glass, kept only as the tuning surface:**
7. Altitude, tether, deadzone, pointer placement, chrome avoidance, and the
    bob were all measured on a real phone and are confirmed working. Every
    value stays in `HOME` in `config/constants.js` so any of them is a
    one-line change if a later basemap or a different device says otherwise.
    Nothing here is an open question.
8. Address confirmation happens at `GEOCODE.confirmZoom` = z8, the §11 hard
    ceiling. That confirms the right neighbourhood and coastline, NOT the right
    driveway. **[DECIDE]** whether home confirmation earns an exception to the
    z8 cap, or whether drag-the-pin is sufficient for the last few hundred
    metres. Current call: drag is sufficient; do not break the cap for it.

**Measure-on-glass (needs the real basemap and real storms on screen):**
9. Color-contract audit against the real basemap **and the land fill** (§6).
   Storm dots exist now — a yellow Cat 1 spiral sitting on land is the actual
   test, so this audit is unblocked the moment live storms render.
10. Light-mode design direction (§9) — a real pass, never an inversion.
11. Exact zoom-band thresholds; imagery loop length + preload; idle-rotation
    speed and resume delay; whether the storm glyph rotates.
12. Whether forecast point times need thinning at z4–5 now that spoke
    placement is doing the decluttering (§7), and whether the spoke length
    and side-balance tolerance in `LABEL_PLACEMENT` want tuning against a
    real busy basin.

**Live probes (§4, §11):**
13. **NHC and GDACS probes are DONE (2026-07-23)** — findings folded into §4 and
    §7; the parser's `[VERIFY]` markers are resolved. Still unprobed: IEM GOES
    WMS, NOAA nowCOAST radar ImageServer (both Phase 7), and model a-deck
    parsing (Phase 6). Probe those when their phase comes up, not before.

    **The a-deck is unprobed HERE but PROVEN on the HA project** — verified
    against a live deck (`aep012026`, 2026-07). Inherit rather than
    rediscover: techs are TVCN (consensus, preferred) / HCCA (consensus,
    only when TVCN absent) / AVNO (**GFS**, not GFSO) / HFSA / UKX
    (**UKMET**, not EGRR). **EMXI (ECMWF) is access-restricted in public
    decks — its rows arrive blank**, so it is excluded deliberately; wiring
    it ships a model that silently draws nothing. **OFCL is excluded too** —
    it IS the official track already drawn solid, so a dashed overlay is
    invisible on top of it and redundant in the legend. Per-tech latest
    cycle, dropped if >12 h behind the deck's newest.

    **Clip the stale back half GEOMETRICALLY, not by timestamp.** Raw models
    analyze the storm slightly behind NHC's official position even on the
    matching cycle, so a time trim cannot catch those points. Drop leading
    points on the far side of the plane through the current position
    perpendicular to the storm's motion, then anchor the line at the current
    position — guidance radiates from the current dot instead of trailing
    into the past.

    The probe scaffolding (`functions/api/probe.js`, `probes/`) was deleted
    after use, along with its Cloudflare secrets `PROBE_GH_TOKEN` and
    `PROBE_SECRET`. **The pattern is worth repeating** if a later phase needs
    live data the sandbox cannot reach: its egress proxy allowlists github.com
    but not NOAA or GDACS, so a Pages Function that fetches upstream and commits
    raw responses to the repo is the bridge. Rebuild it from this note; do not
    leave a repo-writing endpoint deployed between uses.

    The IN-APP coast probe (`map/coast-probe.js`, the `?probe=coast` button,
    the `__rawStripeFeatures` hook on the stripe layer, and six probe-only
    exports on the since-retired walk tracer) was likewise removed after use. Its
    findings are recorded in §7 above. Same rule: rebuild it from that record
    if a later question needs measurement from a phone, but do not leave
    diagnostic scaffolding in the shipped app between uses.

**THE SCALE PASS — do this before the next season, not during it:**
14. Landfall is currently built on solo-user defaults (§ Solo-user context):
    no accounts, home on the device, "if it breaks he fixes it and pushes
    again." If it goes properly public, **the geocoder is not what breaks — the
    relay is.** Specifically, in the order they will bite:
    - `/api/nhc/storms` and the GDACS geometry cache are the traffic funnel.
      Every visitor's poll lands there. Cloudflare Pages Functions bill on
      invocations; a shared link during a Cat 4 landfall is the spike.
    - **NHC and GDACS are public-good endpoints.** Pointing real traffic at
      them through a proxy is a different relationship than one person polling
      for himself. Cache hard, identify the app honestly in the User-Agent
      (already done), and never let a client-side bug turn into a poll storm.
    - `/api/geocode`'s rate limiter is a per-colo cache counter — deliberately
      crude for a solo app. Under real traffic that undercounts by roughly the
      number of colos. Wants a Durable Object or Cloudflare's own rate-limiting
      rules.
    - Storm-name label glyphs come from OpenFreeMap's font endpoint (§11). The
      basemap tiles now come from OpenFreeMap too, so the map is third-party
      end to end; self-hosting fonts only matters if the whole basemap moves
      back off OpenFreeMap.
    - Decide the budget question BEFORE the storm: Mapbox and Pages both have
      free tiers that a viral week will clear.

**Design, when it earns it:**
15. Additional additive layers beyond the sixteen in §7. Current call: **add
    nothing until Landfall has been used during a real storm.** Anything added
    now is a guess about what will matter in September.
16. `[DECIDE]` Whether a second desktop panel slot earns its place in Phase 8.

## 16. Screen architecture

### Always on screen
Four things. Everything else is on demand. The globe is the product; chrome
earns its pixels or it goes.

1. **The globe** — full bleed, always the background layer.
2. **Status strip** — top edge. Source health, stale flags, "GDACS is not
   responding." Silent when everything is clean.
3. **Control cluster** — bottom-right vertical stack. Storms, Layers, Home,
   Settings. Bottom-right because you may be holding a phone one-handed in the
   rain; reachability beats keeping the globe unobscured.
4. **Recenter button** — its own control, not buried in a panel.

**Thumb-zone rule (§10) bites here.** The bottom edge is the iOS home indicator
and the Android gesture bar — the OS eats swipes there. Controls float *above*
that strip, never flush to it. Same at the top for the notch.

### One drawer, views inside it (as-built — replaced "one panel system")
There is exactly ONE panel element on screen (`#drawer`, `ui/drawer.js`).
Storms, storm detail, layers, home and settings are VIEWS INSIDE IT, not
sibling panels. The drawer slides in once and does not re-animate when you move
between views; only the body crossfades.

**This replaced four sibling `<aside>` elements alternated by JS**, which read
on glass as a stack of drawers fighting each other. Glass, translucent, globe
visible behind, never full-screen — all unchanged.

**Docking adapts to width, not device** — same DOM element, CSS moves it:

- Narrow → bottom sheet, slides up, ~60% height max
- Wide → left rail, fixed width, full height

No `isMobile`, no second markup tree. A touchscreen laptop gets the rail because
it is wide, and that is correct.

**One view at a time, on every screen size**, and one state machine rather than
two. `[DECIDE]` whether a second desktop slot earns its place in Phase 8.

**NAVIGATION IS A REAL HISTORY STACK, and "back" means where you just were.**
The earlier rule — "opening Layers closes Storms" — was too blunt once Layers
could be opened *from* a storm:

```
storms → detail → layers      back ⇒ that storm's detail, not the list
```

Opening Layers from a storm is a SIDE TRIP and the storm survives it. Cluster
buttons ENTER a view as a fresh root (clearing the stack); Back walks the
stack; Close dismisses the drawer entirely.

**NO TAB ROW inside the drawer.** Home and Settings are configuration — you
arrive, you set, you leave — and nobody switches to them mid-storm. A
persistent nav would cost ~44 px of a 60vh sheet forever to duplicate controls
that already exist in the cluster. This is also why the cluster hiding behind
an open sheet at narrow widths is harmless: while the drawer is open the only
navigation anyone wants is Back, and Back is in the header.

| View | Contents | Phase |
|---|---|---|
| **Storms** | Storm list. Tab order and screen-reader authority. Scope filter joins in Phase 3. | 2 |
| **Storm detail** | Pushed onto the stack from Storms. Back returns to the list. | 4 |
| **Layers** | Three groups, exclusive pairs as segmented controls, per-model selector with swatches (§7). | 6 |
| **Home** | Distance and closest approach in Phase 3; wind arrival, exposure timeline, surge-at-home in Phase 6. | 3 |
| **Settings** | Units override, light/dark, default scope. Stub — see §14 Phase 3. | 3 |

### First launch — NOTHING IS OPEN, at any width
The globe is the product. §16 previously specified the storm list open on wide
screens ("there is room, and it is the primary navigation"), and on glass that
was wrong: opening a rail over the globe on arrival buries the thing the user
came to look at behind a list they did not ask for.

- **Narrow:** collapsed pill above the thumb zone — `6 active storms`. Tap
  expands into the drawer's Storms view. The pill is the narrow-width entry
  point and shows itself.
- **Wide:** nothing open. The pill is hidden by CSS; the control cluster is the
  entry point.
- Tab from the globe reaches the controls either way.

### Selection
Tap a storm dot on the globe, tap a list row, or press Enter on a focused row —
all identical. Camera flies, detail panel opens.

- **flyTo centers on the visible globe area, not the viewport.** The bottom sheet
  eats the lower 60%; the rail eats the left third. Centering on the viewport
  lands the storm underneath the panel that just opened. Invisible on a desktop
  browser, obvious the moment you hold a phone.
  **The mechanism is flyTo's `offset`, NEVER its `padding` — hard-won, cost a
  live regression.** `padding` is not a one-shot flight parameter: it persists
  in the map transform, and from then on MapLibre renders its globe offset from
  canvas center while everything slaved to the camera through `project()` — the
  3D cage, the home marker, the dive — was built against a zero-padding
  transform. The two globes visibly slide apart on the next zoom. `offset`
  moves only that animation's target and leaves no state behind. The values
  derive from the panel's real box at fly time (`main.js`), so there is no
  340px/60vh duplicate to drift from the CSS.
- **Panel opens and camera flies together**, not sequentially — sequential reads
  as lag. Both transform/opacity, both on the same motion constant.
- **Closing:** back button, Esc, or tapping empty ocean. **Closing does not fly
  back out** — holding the camera is what lets you dismiss a panel to look at
  the map underneath it, which is the most common reason to close it. Esc twice
  recenters (§10).

### Scope filter
Three scopes, carried from the HA integration: **my basin · within N miles of
home · all.** This is what `none_matched` in §5 refers to.

One concept scoping four things at once: the storm list, Tab cycle order,
screen-reader content, and the empty state.

- **All three scopes are live** (as-built). With NO home set the control is
  absent entirely — not a disabled control, gone. A filter with two dead options
  is worse than no filter, and a lone "All" button is not a choice.
- Scope is map and list only. It does not drive notifications — see §2.

### Storm list
**Ordered nearest-first, grouped under basin headers.** Those two rules conflict
unless basin order is defined, so: **basins are ordered by their nearest storm**,
and within each group, nearest first. The single closest storm on the planet is
always at the top of the list, inside its basin's group.

```
ATLANTIC
  Fiona      Cat 2 · 85 kt      310 nm NNE
  Gaston     TS · 50 kt         890 nm E

EAST PACIFIC
  Estelle    Cat 1 · 75 kt    1,240 nm SW
```

- **No home means no distance**, and the list falls back to canonical basin
  order, strongest first within each. Not arbitrary — with no reference point,
  intensity is the only ranking the data supports. The store keeps that
  intensity order regardless (`data/merge.js`); the LIST re-sorts to
  nearest-first once home exists, without mutating the store's own ordering,
  because other surfaces still want intensity.
- **Headers only when more than one basin is present.** Under the radius scope
  there is usually one, and a lone header over a two-row list is noise.
- **Do not re-sort while the panel is open.** A 30-minute poll can flip two
  storms' ranking and move a row out from under a thumb mid-tap. Sort on open,
  on scope change, and on reopen — never on poll. Storms move slowly enough that
  nobody will notice.
- **Row:** category swatch (§6, the same color as the globe dot, so the list is
  its own legend), name, category · wind · distance and bearing. Bearing travels
  with distance — "310 nm" alone does not say whether it is coming or going.
- Stale rows carry their age inline. **Ghosts sit in a dimmed group at the very
  bottom under a divider, outside basin grouping** — otherwise a dissipated
  storm creates a header for a basin with nothing active in it.
- **No virtual scrolling.** Peak worldwide is ~15 storms; rendering rows directly
  is simpler and faster than any windowing library.
- **Basin headers are real `<h2>`s**, so screen-reader users can jump by heading
  instead of arrowing through every row. Headers are not focusable; Tab hits
  rows only.

Empty states, per §5:
- `clear` → "No active storms." Only when every source returned clean.
- `none_matched` → "No storms within 500 nm. 6 active worldwide," with a one-tap
  switch to All. **Always name the count outside the filter** — otherwise a
  filtered list looks identical to a quiet planet.
- `unavailable` → never an empty list. Partial: show what we have plus "GDACS is
  not responding — Northwest Pacific and Indian Ocean storms may be missing."
  Total: error state with Retry.

### The list is the accessibility surface
A WebGL canvas is invisible to assistive technology. The storm list is not a
hidden duplicate — those rot because nobody looks at them. It is one visible list
that is simultaneously the click target, the Tab order, and the screen-reader
view of the globe. **The canvas is `aria-hidden`; the list is authoritative.**

### Storm detail panel
Replaces the list in the same slot, back button top-left.

**1. Identity**
```
🌀 FIONA
Hurricane · Category 2
```
Category color is the swatch and glyph, never the text color (§6). For
non-tropical `nature`, the second line says what it actually is — "Post-Tropical
Cyclone," "Potential Tropical Cyclone Five."

**2. Vitals**
```
Winds      85 kt (100 mph)
Pressure   972 mb
Moving     NNW at 12 kt (14 mph)
Position   24.3°N 71.2°W
```
Native unit first, converted in parentheses — knots is what NHC says and what
every threshold in the app is defined in, so leading with mph makes the panel
impossible to reconcile against a real advisory. **Nulls are omitted, not
zeroed.** GDACS often has no pressure; a missing row is honest, "Pressure —" is
clutter, "0 mb" is a lie.

**3. Timestamp — the load-bearing element**
```
Advisory 12A · 11:00 PM Thu (2 hrs ago)
```
Directly under the vitals, because everything above it is only as true as this
line. Three states: fresh (under ~4 h, quiet), aging (4–9 h, highlighted), stale
(past the 9 h TTL, flagged — "⚠ Last update 11 hrs ago").

**Geometry timestamp is separate.** When MapServer lags the storm feed by more
than one advisory cycle (§4), a second line appears: *"Cone and tracks from
advisory 12 · 5 hrs ago."* When they agree, the line does not exist — silence
means synchronized. This is a "name every soft-fail" case where the fail is
invisible unless stated.

**4. Home block** — only when home is set. Distance and closest approach in
Phase 3; winds-at-home and surge-at-home in Phase 6.
```
DISTANCE
310 nm (357 mi) NNE of home

CLOSEST APPROACH
95 nm · 3:00 AM Thu (in 14 hrs)

WINDS AT HOME
TS-force · 8:00 PM Wed (in 7 hrs)
```
One advisory feeds all of these, so the block carries a single header stamp
rather than three identical timestamps — but if anything in it is stale, that is
stated at block level, never buried. Closest approach is a *forecast track*
number and should read as the forecast it is. `[DECIDE]` whether cone width
folds into that wording, in Phase 3 with real data on screen.

**5. Watch/warning block** — when in effect
```
IN EFFECT
■ Hurricane Warning
■ Tropical Storm Watch
```
§6 colors, deduped by type (§7). Never the word "advisory" for these. When none:
"None in effect." When the fetch failed: "Watches and warnings unavailable." Two
different strings, by design.

**6. What's drawn for this storm** — a SUMMARY plus a push into Layers.
**NO SWITCHES LIVE HERE, and that reverses this section's original call.** It
specified inline toggles for the pairs and additive layers on the "selecting a
storm and immediately wanting its wind field" argument, described as "the
shortcut, not a duplicate." It would have been a duplicate: two controls for
one layer means two places to look when something is not drawing, and two
places to keep in sync. There is exactly ONE toggle per layer and it is in the
Layers view. This section names what is currently drawn for the selected storm
and pushes there.

The navigation is what makes that cheap rather than annoying — Layers opened
from a storm is a side trip on the history stack, and Back lands on that
storm's detail, not on the list.

**7. Advisory text** — collapsed by default, expands in place. Never
auto-expanded; it would push everything above it off screen.

**Structure:**
- **The panel scrolls; identity and timestamp pin to the top.** At 60% height on
  a phone this content overflows, and you must never lose track of which storm
  and how old while reading.
- **Sections collapse per user, persisted** (localStorage, same as layer prefs).
  Someone who never reads coordinates should not scroll past them forever.
- **Ghost storms get a reduced panel:** identity, last-known vitals, the ghost
  notice, past track. No home block — distance to a storm that is not there is
  meaningless. No layer link either — there is nothing to configure for a
  storm that has stopped publishing.

**Failure states:**
- Storm in feed, geometry failed → panel renders fully from feed data; the map
  lacks the cone; the failure is named on the layer, not here.
- Selected storm's source goes down → panel holds with stale flag. Never blanks.
- Storm leaves the feed while open → becomes the ghost panel in place. No forced
  navigation.
