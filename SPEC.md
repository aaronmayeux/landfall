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

Aaron is founder and sole developer. **DIRECTION (set 2026-07-25): Landfall is
being built FOR THE MASSES** — public users arriving by shared link, most of
them during a storm, most of them on phones. Two things follow:
- First-use experience is real work, not polish for later: a stranger must be
  able to land, set a home, and install without anyone explaining anything.
- §15's scale pass (the relay funnel, rate limiting, the budget question) is
  REQUIRED before the season, not optional hardening.
Simplest-path still wins on implementation choices — what changed is who the
app is for, not how it gets built. No accounts and no server-side user state
remain settled (§2, §8).

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
  by `main.js` from `map/storm-mesh.js`, which turns the merged storm list plus
  the warm geometry cache into weighted points. Two modes (§9, a Settings
  control): `current` is one point per storm at its live fix; `track` follows
  each storm's past and forecast positions too. The seam's promise held — the
  elevation and color code did not change when the ridge landed.

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
- PWA: web app manifest + service worker (built — §14 Phase 5). App code
  network-first with offline cache fallback; pinned CDN cache-first; data
  endpoints never intercepted. Maskable icons for Android; 180x180
  non-transparent apple-touch-icon for iOS, both on the ocean-dark backdrop.
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

### Field-level truth lives in `spec-parameter.md`

**`spec-parameter.md` is the field reference for both feeds and it is
authoritative.** Every field either source publishes — name, type, units,
sentinels, real sample payloads, and how the app displays it today — is recorded
there, measured from a live pull, not remembered. This section describes the
ARCHITECTURE: which source we trust for what, how they merge, how failure is
handled. It deliberately does not duplicate the field tables.

**It exists for offline and sandboxed work.** The cloud sandbox has no network
route to `nhc.noaa.gov`, `mapservices.weather.noaa.gov`, or `gdacs.org` — live
probing requires a browser on Aaron's machine. When development happens from a
phone, or from a session that cannot reach the sources, `spec-parameter.md` is
the substitute for the feed. Build against it rather than guessing, and treat
anything it marks `[UNVERIFIED]` as unproven.

**When a field's meaning changes at the source, `spec-parameter.md` changes.**
Same rule as this file: it is live state, not a log.

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
| `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?eventlist=TC&alertlevel=Green;Orange;Red` | **OK** | Relayed anyway, for load (§17 Pass B) |
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

### Settled by the full field audit, 2026-07-24 — see `spec-parameter.md`

Both feeds were pulled live with four storms up: Fausto (`ep062026`, HU 90 kt)
and Genevieve (`ep072026`, TS 40 kt) in NHC basins, Noul (GDACS `1001294`) in
the Northwest Pacific, and Bertha (GDACS `1001295`) **still listed by GDACS
after NHC had dropped it** — the ghost case, observed rather than reasoned about.

The architectural conclusions:

- **GDACS `severitydata.severity` is a FORECAST PEAK. Proven, not inferred.**
  Genevieve's severity of 203.7024 km/h is exactly NHC's maximum forecast
  `maxwind` of 110 kt × 1.85184, while she was a 40 kt tropical storm at the
  time. Fausto's severity happened to equal his current wind only because he
  was at his lifetime peak and forecast to weaken — which is what makes the
  field dangerous: it looks right on a mature storm and is off by 70 kt on a
  strengthening one. It stays in `peakWindKt`. It never becomes `windKt`.
- **GDACS DOES publish a current wind field, and we already fetch it.** The
  per-event geometry carries timestepped 60 / 90 / 120 km/h footprints
  (`featuretype: "WindRadii"`) whose first key is the current analysis time.
  Centre-in-polygon brackets current intensity, validated on all four storms
  against NHC ground truth. NOT USED — §15 records why the cage stays on the
  class midpoint; do not derive a floor from it.
- **`spec-parameter.md` §5.2 is required reading before touching GDACS
  polygons.** The payload contains two families of green/orange/red polygon —
  an aggregate whole-track swath and the timestepped footprints — and
  `featuretype` is the ONLY reliable discriminator. Colour class and
  `polygonlabel` both appear on each.
- **NHC MapServer `Forecast Points` publishes `ssnum`**, its own
  Saffir-Simpson index, valid at every tau. We derive category from knots and
  mark it `derived`; for NHC storms it could honestly be `reported`. The two
  agreed on both live storms.
- **MapServer `lat`/`lon` ATTRIBUTE fields are rounded to whole degrees** —
  Fausto read `lat: 19, lon: -133` against a geometry of `18.6999…,
  -132.6999…`, up to ~30 nm of error. Always read the geometry.
- **`impacts[].source` names the real forecast office behind a GDACS storm** —
  `NOAA` in NHC basins, **`JTWC`** for Noul. Not currently captured. Crediting
  an aggregator for a forecast office's work is an attribution bug (§6 rose
  logic: say who said it).
- **The GDACS list is cyclone-only, and that is a correctness requirement, not
  a bandwidth one.** `EVENTS4APP` mixed every hazard type into one
  100-feature cap. On 2026-07-24 that held 4 cyclones in 135,606 bytes and read
  as ~96% waste. On 2026-07-26 wildfire season held 93 of the 100 slots, the
  list carried 2 cyclones — both East Pacific, both dropped by `data/merge.js`
  as NHC's to report — and Typhoon Noul went missing from the app while every
  layer of the stack reported healthy. Now on
  `SEARCH?eventlist=TC&alertlevel=Green;Orange;Red`: cyclones only, field parity
  confirmed key-for-key. **The `alertlevel` triple is how you ask for the
  unabridged 100 rows; without it the endpoint returns 20 and was measured
  missing two live storms.** The list carries ~a year of finished storms, so
  `iscurrent` (a STRING, not a boolean) is filtered at ingest in
  `data/gdacs.js` and again in `worker/src/sources.js` before geometry keys are
  derived. Full measurements in `spec-parameter.md` §4.

### Still untested — verify before building on them
- **CLOSED 2026-07-25 — both imagery endpoints were probed live.** IEM's GOES
  WMS answers fine (`fulldisk_ch13`, PNG, EPSG:3857, CORS open) but Landfall
  does not use it: IEM serves only the two GOES birds, and the app needs four
  satellites through one product family, which GIBS and EUMETSAT provide. The
  radar ImageServer answers on `mapservices.weather.noaa.gov`; the old
  `nowcoast.noaa.gov` host is dead. See §4's imagery block for what shipped.
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
1. Fetch-and-forward the two CORS-blocked NHC feeds — storm list
   (`/api/nhc/storms`) and model a-decks (`/api/nhc/adeck?storm=…`). **Both
   built.**

   **THE A-DECK ROUTE BENDS "KEEP IT DUMB", DELIBERATELY AND ONCE.** It
   gunzips (the upstream is a `.gz` FILE, not a gzip-encoded response, so no
   browser inflates it transparently) and it DROPS EVERY ROW whose model code
   is outside the five-model shortlist.

   What forced the second one: decks are WARMED for every storm, not fetched
   on selection. A deck carries ~100 model codes and runs to a few MB; a busy
   season is eight or nine storms at once. Unfiltered, warming is megabytes
   over cell data during a hurricane. The filter cuts >90% (measured on a
   synthetic hundred-model deck).

   Why it does not violate the rule's intent: the rule exists so the MERGE
   stays debuggable on a phone. An allowlist of five literal strings decides
   nothing. Every judgement — which cycle, what is stale, where to clip, how
   to read tenths-of-a-degree — still runs in `lib/adeck.js` in the browser.
   **`?full=1` returns the deck unfiltered**, so the real bytes are one URL
   away; a filter with no way to see past it is the version that would have
   been a mistake.
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

4. **Relay the GDACS event list and the NHC MapServer — BUILT 2026-07-25 as
   §17 Pass B B1** (`/api/gdacs/events`, `/api/nhc/mapserver`). Both were
   fetched DIRECTLY by the browser until then, and neither is a CORS fix.

   **CORS-open is a permission, not a capacity plan.** Both endpoints send the
   header, both worked, and so neither was looked at again — at one user. On a
   shared link during a landfall the same code makes thousands of uncacheable
   requests per poll from thousands of client IPs, and the MapServer path is
   nine layer queries **per storm, per reader**. §17 Pass B's origin collapse
   could not have touched any of it, because none of that traffic passed
   through anything we control. The reason to relay a feed is whichever comes
   first: the browser can't reach it, or we can't responsibly point a crowd at
   it.

   **The MapServer route builds the WHERE clause itself** from a validated bin
   number — the same shape as the bin in `advisory.js` and the product name in
   `warning.js`, not a new exception. Accepting a caller's `where` string would
   make it an arbitrary query proxy into a federal service.
   **ArcGIS's 200-with-error is forwarded verbatim and never cached**, because
   the client depends on seeing that body to mark a layer `unavailable` rather
   than empty; converting it to a 502 would erase the distinction.

   **THERE IS ONE FILTER MODE AND `all=1` IS GONE (2026-07-26).** The client
   used to answer a refused clause by re-querying unfiltered. That was safe on
   the block service and only there — a block layer holds one storm. On the
   summary service `1=1` returns EVERY ACTIVE STORM, so the same line would
   hand one storm's panel three storms' cones. Do not add it back.

   **An EMPTY FeatureCollection is cached for 5 minutes, not 30, and never as
   last-good.** On the summary service an empty answer for a valid bin is
   transient — a bin created by an advisory whose geometry has not published
   yet, or a storm just retired. Holding "nothing here" for half an hour turns
   a publication gap into a half-hour outage for every reader on that colo.
   The window is matched to `CACHE.geometryRetryMs`, which is how long the
   CLIENT waits before asking again; if they drift, one side spends the whole
   window re-reading the other's cached nothing.

**As of §17 Pass B the browser fetches NO upstream source directly.** Every
`ENDPOINT` URL is reached by a Function; the CSP's `connect-src` shrank to
OpenFreeMap and the two imagery hosts, and that shrink is a security win as
much as a load one — every upstream host removed is one fewer place an
injection can reach.

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
    (`RING_POLISH.seamWindowDeg`, 40°, run `seamBlurPasses` = 2 times), and
    rebuilds. Longitude scaled by cos(lat) so the profile is measured on real
    distance.

    **THE THIRD ATTEMPT SHIPPED, AND STILL SHOWED THE QUADRANTS** — Aaron, on
    glass, 2026-07-26. Three causes, all fixed together:

    1. **THE SIMPLIFY RAN FIRST, AND THAT IS THE BIG ONE.** `tagBand()`
       Douglas-Peuckered the ring before the polish saw it. The profile is
       built by binning the ring's OWN vertices into 360 bearings, so vertex
       density IS profile resolution — and DP at 0.01° left **37 points, gaps
       ~11° of bearing, against a blur half-width of ±12°**. The blur window
       was barely wider than one stair tread, so the staircase walked through
       it. Failure #1 in the list above was the same mistake in the X/Y era;
       it survived the rewrite because the simplify moved but never left.
       **Simplification now happens at the EXITS.** Costs nothing: the polish
       rebuilds at 360 points either way, so the current field shipped 360
       vertices before and ships 360 after.
    2. **±12° was too narrow for a 32 nm step.** 24° → 40°.
    3. **One pass leaves a CURVATURE jump.** A single raised-cosine over a
       step is smooth in value and slope but jumps in second derivative at
       each end of the ramp, and a closed outline reads a curvature jump as a
       corner. Two passes ≈ Gaussian. Each pass is a convex combination, so N
       passes carry the same no-overshoot bound as one.

    Also fixed: `radialProfile()`'s fill for bearings no vertex landed on took
    the MIN of the two flanking radii, manufacturing flat plateaus with a step
    at every real sample. It interpolates linearly now — no radius the source
    did not publish, and a ramp instead of a staircase.

    **MEASURED, on the real NOUL-26 green band profile (2026-07-26):** max
    radius change per degree of bearing 0.0234 → 0.0108 (2.2× flatter through
    the seam); **max curvature 8.26 → 2.45 per degree, a 3.4× rounder
    corner**; overshoot 0.000000° (unchanged, still exact); area −0.37% vs
    published; **peak-to-trough radius spread unchanged at 0.5307° — the
    lopsidedness is fully intact.** By harmonic: the 90°-period component (the
    real quadrant asymmetry) retains ~75% of amplitude, the 30°-period
    component (the hard corner) drops to ~7%. Lobes survive, steps do not.

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
- **NHC MapServer — THE FULL INVENTORY.** NOAA publishes these products TWICE
  and the difference is the whole reason the geometry path was rewritten on
  2026-07-26.

  **`NHC_tropical_weather` — the block service. NOT USED.** 400 layers, sliced
  into per-storm blocks of 26. Blocks start AT=4, EP=134, CP=264; the feed's
  `binNumber` gives the slot, so `base = blockStart + (slot−1) × 26`. Five
  slots per basin, group layers unqueryable, layer ids resolved by NAME inside
  the block against a cached copy of the service's own layer list.

  It was abandoned because the address it computes is derived from a LABEL and
  the data it holds is not. **Measured live 2026-07-26:** Hurricane Fausto
  crossed 140°W into the Central Pacific, the storm feed flipped his
  `binNumber` from EP1 to CP1 at the 15:00Z advisory, and the CP1 block existed
  and was COMPLETELY EMPTY — zero features on all nine layers. His cone,
  tracks and wind field were still in the EP1 block at the previous advisory,
  where nothing was looking. Every layer came back `none`, the map drew
  nothing, and the panel said "no wind field published for this advisory",
  which was false. In the Pacific a basin change is not an edge case.

  **`NHC_tropical_weather_summary` — THE SERVICE THE APP READS.** 35 layers.
  The same nine products with every storm in ONE set, keyed by `binnumber`.
  Fixed ids, so there is no arithmetic, no stride, no metadata round trip and
  no name matching. At the same minute of the same probe it was also AHEAD of
  the block service: Fausto's advisory 31 was already there under CP1 — cone,
  forecast track, forecast points, and his full 37-point past track and 76
  past wind radii carried across the basin change intact — while the block
  service was still serving advisory 30 in the old basin.

  | Id | Name | Wired as |
  |---|---|---|
  | 5  | `Forecast Points` | `forecastPoints` |
  | 6  | `Forecast Track` | `forecastTrack` |
  | 7  | `Forecast Cone` | `cone` |
  | 8  | `Watch-Warning` | `watchWarning` |
  | 10 | `Past Points` | `pastPoints` |
  | 11 | `Past Track` | `pastTrack` |
  | 12 | `Past Cumulative Wind Swath` | **never** — rasterized, §7 forbids it |
  | 13 | `Past Wind Radii` | `windPast` |
  | 15 | `Forecast Wind Radii` | `windSwath` |
  | 16 | `Advisory Wind Field` | `windCurrent` |
  | 18, 19 | Arrival time — earliest reasonable / most likely | **unwired** |
  | 22–24, 26–28 | Inundation and tidal mask, boundary/footprint/image | **unwired** |
  | 30–32 | Probabilistic Winds 34 / 50 / 64 kt | **unwired** |
  | 1–3, 33, 34 | Tropical weather outlook, two-day and seven-day | **unwired** |

  Group layers (0, 4, 9, 14, 17, 20, 21, 25, 29) cannot be queried. `Image_*`
  layers are rasters; only boundary and footprint are queryable as geometry.

  **EVERY LAYER CARRIES `binnumber`, AND THAT IS WHY THIS SERVICE WINS.**
  Verified field-by-field on all nine, 2026-07-26. Four also carry `stormid`
  (12, 13, 15, 16) — deliberately unused: one filter currency that works
  everywhere beats two that each work somewhere, which is exactly the
  per-layer special-casing that produced the block service's split-clause bug.
  `stormid`'s case also varies BETWEEN layers on this service (`EP062026` on
  13, `ep062026` on 15, measured), a second reason not to key on it.

  **GEOMETRY IS SIMPLIFIED AT THE RELAY, not client-side**, via
  `maxAllowableOffset` on the polygon and line layers (6, 7, 11, 13, 15, 16).
  It is a query parameter, so the bytes are never sent at all. 0.01° ≈ 1.1 km,
  far below what a quadrant arc or a cone edge means at any zoom this app
  renders and below the whole-nautical-mile precision NHC's own radii are
  issued in. Point layers are absent by design — simplification is a no-op on
  points, and past points feed the swath envelope's join and must stay exact.
  Measured on Fausto, one storm, one load: past wind radii 993 KB → 78 KB,
  forecast radii 205 KB → 16 KB, cone 87 KB → 1.5 KB; **1.29 MB → 96 KB**.

  **FOUR LAYERS CARRY THE WORD "WIND"** — Past Cumulative Wind Swath, Past
  Wind Radii, Forecast Wind Radii, Advisory Wind Field. This cost a full day
  under the old name-matching scheme: `windSwath` matched `wind.*swath` →
  "Past Cumulative Wind Swath", so a control labelled "Full track" drew where
  the storm had ALREADY BEEN. Fixed ids removed the class of bug entirely —
  there is no pattern left to be loose. The names are recorded here so nobody
  reintroduces matching on them.

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

  **Peak Storm Surge is a SEPARATE MapServer** (`NHC_PeakStormSurge`, polygon
  layer 2) with **no stormid field** — filter spatially by an envelope around
  the storm's position.

- **A bin's past-track layer carries the storm's PRE-NAME history.** Past Points
  for EP1 returned 36 features under three different `stormname` values —
  `INVEST`, `SIX`, `FAUSTO` — which is one system through genesis, not three
  storms. All 36 share `binnumber: 'EP1'`, so no bin or stormid clause separates
  them, and `stormname` on Past Track came back `null` besides. Treat it as
  intended: the track honestly shows where the storm came from. Just never key
  anything off `stormname` from these layers.
- **Model tracks (a-deck) — BUILT 2026-07-25 (`lib/adeck.js`). Format confirmed
  against a live deck (`aep012026`, 2026-07) on the HA project and INHERITED
  rather than re-probed.** Comma-separated; the columns read are `[2]` DTG
  (`YYYYMMDDHH`, UTC), `[4]` tech, `[5]` tau, `[6]/[7]` lat/lon.
  **Coordinates are TENTHS of a degree with a hemisphere letter** — `286N` is
  28.6, not 286. A parser reading the digits as degrees produces positions that
  wrap to a plausible wrong place rather than failing.
  **A tau repeats across the 34/50/64 kt wind-radii rows** with identical
  position, so the first row per tau wins; reading them all triples every track.
  Per-tech latest cycle, dropped if >12 h behind the deck's newest.
  Clip leading points behind the storm's current position; anchor at the
  current dot. Model shortlist and colors: §7.

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
time. Each past point also carries `intensity` (kt), `mslp`, `ss`, and
`stormtype` — per-point intensity-at-time from a layer the swath was already
fetching, and now the measured half of the §9 track ridge. Also
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

### Imagery (Phase 7) — BUILT AND CONFIRMED ON GLASS 2026-07-25.
### Measured, not inherited.

Owners: `lib/imagery.js` (addressing), `lib/imagery-paint.js` (the pixel
pass), `lib/imagery-cache.js` (the frame cache), `map/imagery.js` (the layer),
`functions/api/imagery/radar.js` and `functions/api/imagery/satellite.js` (the
two relay hops — satellite joined on 2026-07-26, see below). Every number below
was measured from the deployed site, first on 2026-07-25 via
`/api/imagery/inspect` and `tools/imagery-probe.html` and again on 2026-07-26
through the app's own modules in a live tab, because the sandbox cannot reach
any of these hosts.

**IT IS A DISC PER STORM, NOT A GLOBAL RASTER.** A 600 km-radius box around
each eye, feathered to nothing at the rim, drawn ambiently on every storm in
the feed. Aaron's call and it collapses the hard part of the problem: no
mosaic, no seam blending between four satellites with four calibrations, a
fraction of the bytes, and it reads as weather on a globe rather than as a
second basemap. The vendor question becomes a longitude lookup.

**EVERY REQUEST IS PINNED TO THE MODE THAT ASKED FOR IT (fixed 2026-07-26).**
A frame takes a few hundred milliseconds. `map/imagery.js` used to read the
live `mode` at the moment bytes LANDED rather than the moment they were asked
for, and `setMode` tore down every disc record and rebuilt fresh ones under the
same storm ids — so a stale request's "does this storm still exist" check passed
against a record that was not its own. Both directions were reproduced headless
against the real module:

- **satellite → radar**: the satellite frame arrived under `radar`, took the
  radar branch (rim feather only, **no colour knockout**) and was drawn as the
  radar disc. A raw vendor square on the globe, labelled radar. This is what
  Aaron saw as "the radar actually showed up" for a storm with no ground radar
  within a thousand miles.
- **radar → satellite**: the radar frame arrived under `satellite` and went
  through the chroma knockout with **no bird attached** — the pass logged its
  satellite id as `?`.

It also wrote `failed` / `empty` / `noColour` onto the orphaned record it still
held, where `report()` cannot see them, so the row described state with no
relationship to what was on screen. **A wrong-mode frame is not a cosmetic bug:
imagery is the layer a user reads as "what the sky is actually doing", and the
knockout is what separates storm from warm cloud.**

The fix is a **request identity**, not a longer check. Every fetch pins the
generation, the mode, the bird and the exact box it was addressed to; everything
downstream reads THE REQUEST rather than live module state. Two questions gate
every draw — has the generation moved, and is this still the same record object
— because the generation alone reads a rebuilt disc as valid, and that was the
case that put satellite frames under the radar segment. Same pass fixed two
neighbours: **corners are taken from the request** (they were recomputed from the
record at draw time while the bbox came from the storm at request time, so a
storm that moved mid-fetch had its frame drawn at coordinates the image does not
describe), and **renders are serialised** through the one shared canvas rather
than relying on `toBlob` snapshotting to survive twelve concurrent renders.

**Which storm loses is a function of bytes.** Measured live 2026-07-26 at the
same minute: Genevieve's GOES-West frame was 825 KB / 36.8% kept, Fausto's
477 KB / 4.85%. The bigger frame is reliably the one still in flight when a
toggle lands and reliably the one whose stale bytes arrive last and win — which
is why the failure looked storm-specific and read as "Genevieve's satellite is
broken" when her data was the healthier of the two.

**SATELLITE GOES THROUGH OUR OWN RELAY, AND THE REASON IS NOT CORS
(2026-07-26).** Every satellite vendor sends `Access-Control-Allow-Origin: *`,
so the browser always could read those pixels directly, and did — that is why
radar had a relay and satellite did not, and the reasoning was sound. What
changed is a measurement:

- GIBS sends `Cache-Control: max-age=0, no-store, no-cache, must-revalidate`,
  plus `Expires: Thu, 1 Jan 1970`, plus `Pragma: no-cache`. A triple-belt refusal
  to be cached, so **nothing ever was** — every toggle, poll and re-selection
  re-downloaded the full frame (826 KB measured on one disc).
- Four identical back-to-back requests returned in **2523 ms, 11785 ms,
  30728 ms and 779 ms**. Thirty seconds to see a hurricane for the first time,
  and no client-side cache can ever fix a first view.
- Two of those four returned 826100 bytes and two 826635. **GIBS serves
  different frames on consecutive requests**, so refetching can hand back an
  *older* frame than the one already on screen. Fewer upstream requests is not
  only cheaper, it is more stable.

Behind `/api/imagery/satellite` we own the response headers, so `max-age=300`
makes the browser cache work and `caches.default` collapses every reader and
every storm on screen into one upstream request per box per five minutes.

- **No client fallback to the vendors.** A second path exercised once a month
  has rotted by the time it is needed, and it would make a relay outage
  invisible — the app would just go slow again with nothing on screen saying
  why. One path; a failure surfaces on the imagery row and re-tapping the
  segment is the retry.
- **The relay carries a hand-maintained mirror of `SATELLITES`** (endpoint,
  layer, WMS version) because Pages Functions cannot import
  `config/constants.js` (§3, no build step). Add or repoint a bird in the config
  and **it must be changed in `functions/api/imagery/satellite.js` too.** Same
  tradeoff `radar.js` already makes for its `UPSTREAM`. The table is also the
  allowlist — a caller-supplied endpoint would make this an open proxy.
- **It has an upstream deadline and radar does not.** 20 s, matching
  `POLL.fetchTimeout`. Without it the 30 s case occupies a Function invocation
  until the platform kills it and the client sees a hang instead of a fault.
- **`Timing-Allow-Origin: *`** so `transferSize` is readable. Cross-origin
  opacity reporting it as 0 is what made an early probe of GIBS look like a
  cache hit when it was a full 826 KB download; this is the header that stops
  that mistake recurring.
- **The CSP lost two more hosts.** `gibs.earthdata.nasa.gov` and
  `view.eumetsat.int` are out of `connect-src`; the browser now reaches exactly
  one third-party host. Same origin-collapse payoff §17 Pass B banked, banked
  again.

**THE FRAME CACHE IS KEYED BY REQUEST, NOT BY DISC (`lib/imagery-cache.js`).**
Aaron: "if i toggle to radar as soon as the satellite imagery loads, then switch
back, it looks to be redownloading the image again." It was. `map/imagery.js`
held one frame per disc record and `setMode` drops every record, so the bytes
died on each toggle — a frame is not a property of a disc, it is the answer to a
request, and the same request can be asked again after the disc that first asked
it is gone. **The key is the request URL itself**: it already encodes mode, bird,
box and size, so there is no second key format free to disagree with the bytes
actually fetched. This works only because no TIME parameter is ever sent, which
is what makes the URL stable across refreshes.

Both relay URLs are built by `lib/imagery.js` and come back **relative**, so the
two are spelled the same way — built in two files, one absolute and one
relative, the same frame would cache under two keys.

Three bands, all derived from `POLL.imagery` rather than hand-set:

| Age | Behaviour | Row says |
|---|---|---|
| ≤ 5 min (`currentFor`) | serve, **no refetch** — the poll owns cadence | "Downloaded 3 min ago" |
| 5–60 min | serve **instantly**, refresh behind it | "Downloaded 12 min ago" |
| > 60 min (`maxServeAge`) | treated as **absent**; disc shows loading | — |

There is deliberately no threshold between the first two: §5 says stale data plus
a visible timestamp beats a blank screen, always. `maxServeAge` is where
"labelled" stops being enough. **The cost of staleness here is not position** — a
storm at 13 kt moves ~12 km in half an hour against a 900 km disc radius, which
is invisible. What changes on that scale is what the *cloud* is doing: convective
bursts, eyewall cycles, rapid intensification.

- **The row reports the OLDEST frame on screen, not the newest.** With a dozen
  discs the ages differ, and the row reports the whole set by design. "14 min
  ago" when three of four are current is pessimistic; "just now" when one is
  fourteen minutes behind hides the stale one. Only one of those can mislead
  someone about the weather.
- **"Downloaded", never "old".** We are never told the frame's observation time
  — no TIME parameter, and cross-origin CORS would not have exposed `Date` or
  `Age` anyway. This is when *we* got the bytes; the picture may already have
  been older. Wording it as frame age would be a §5 confident wrong answer.
- **A timestamp goes up to the view, not a sentence.** `report()` runs on events
  and its slowest is the five-minute poll, so a string formatted in `map/` would
  freeze — a four-minute-old frame still reading "just now", since `formatAge`
  flips at two. `ui/view-layers.js` formats at render.
### The vendor is slow, and a failed disc now asks again on its own

**Measured on the deployed relay 2026-07-26: six of seven genuinely COLD
satellite fetches did not answer inside the relay's 20 s deadline and came back
502.** Sequentially as well as in parallel, so it is GIBS, not our concurrency —
consistent with the 0.8 s to 30.7 s spread measured across four identical
requests when the cache landed.

Before this, a disc that lost that race was marked `failed` and **nothing asked
again.** The row said "tap to retry" and the only other recoveries were the
five-minute poll or returning to the tab. Aaron watched a storm sit blank,
walked away, and found the imagery there when he came back — that was the poll,
not a race.

Two changes, one on each side of the wire:

- **`map/imagery.js` retries on `POLL.retryBackoff`** — 5 s, 15 s, 45 s, then
  stop and let the five-minute poll own it. The constant already existed and
  this file never used it. One pending attempt per disc; the schedule resets on
  success so a later unrelated failure starts at 5 s again; the timer is
  disarmed with its disc; and it re-checks mode, generation, record identity and
  `document.hidden` at fire time. Hidden is a **defer, not a cancel** — the disc
  stays `failed` and `onVisibility()`'s `refreshAll()` picks it up.
- **`functions/api/imagery/satellite.js` stops throwing the render away.** The
  20 s limit is now a RACE against a single upstream fetch bounded at 60 s, not
  an abort. The client still gets its 502 at 20 s; whatever GIBS eventually
  returns is banked into the edge cache under `waitUntil`. **One upstream
  request, not two** — asking GIBS again while GIBS is struggling is the one
  thing this route must not do.

**Why a retry works so well here:** our abort stops us waiting, it does not stop
GIBS rendering. The first attempt warms the vendor and now the edge cache too,
so the 5 s retry is frequently a cache hit. The failure is close to
self-healing; it just needed someone to ask twice.

- **`retry()` evicts before refetching.** Without that the button would have
  stopped working the day the cache landed: a retry answered from cache returns
  the bytes already on screen and reports success.
- **It does not persist.** Session-lifetime `Map`, cleared on `destroy()` so a
  restyle cannot leak a set of frames per theme change. Cold starts are the edge
  cache's job, where the copy is shared between readers instead of per-device.
- Bounded at `maxDiscs * 2` — both sides of the toggle, or every toggle is a
  miss and the original problem is back. ~20 MB of compressed PNG worst case
  against a measured 10.7 GB quota; the cap bounds a leak, not a budget.

**RADAR COVERAGE IS DECIDED BY MEASURING THE FRAME, NOT BY A BOX
(2026-07-26).** Aaron spotted that Genevieve at 12.9N 108.3W was declared
covered while sitting a thousand miles from the nearest ground radar. The bbox
in `IMAGERY.radar` was the service's stated *extent* and was being read as an
answer to "does this storm have radar," which it never was.

The bug underneath it was worse and was pure §5 silence. `map/imagery.js`
initialised `keptFraction = 1` and **only the satellite branch ever overwrote
it** — `featherOnly` returned nothing — so `rec.empty` was mathematically
unreachable on the radar path. A completely blank radar frame drew a fully
transparent raster over a live hurricane and **the status row said nothing at
all**. The same "blank raster reads as clear sky" failure this section warns
about three other times, reached by a different road.

- **`featherOnly` now returns a kept fraction**, counted inside the rim (the
  disc is inscribed in the square, so the corners are outside the thing being
  drawn) and before the feather is applied (the feather is geometry and must not
  contaminate a measurement about content). The service keys no-echo areas fully
  transparent, so alpha *is* the signal — no threshold to tune.
- **A frame with nothing in it is hidden, never drawn**, and the decision is
  made *before* the encode. The old order drew first and noted the emptiness
  afterwards. Skipping the `toBlob` and the texture upload is a free side
  benefit.
- **`IMAGERY.emptyKeptFraction` replaces a bare `0.005`** that only ever ran on
  satellite. Measured through the relay, one 900 km disc per point:

  | echo | location |
  |---|---|
  | 0.00% (334-byte PNG) | Genevieve 12.9N 108.3W, Fausto 19.7N 139.8W |
  | 0.06% | mid-Atlantic 25N 60W |
  | 0.08% | San Juan |
  | 0.58% | Anchorage |
  | 2.20% | ~100 nm off Louisiana |
  | 2.55% | 100 nm off Cape Hatteras |
  | 3.66% | Miami, over land |

  0.002 sits in the wide gap with margin either side. **The old 0.005 would not
  have done** — too close to Anchorage's 0.58%, which is a real radar picture of
  a real city. Satellite is nowhere near either bound (4.85% and 36.8% the same
  day), so one constant serves both paths, and should: the question is identical
  whichever knockout asked it.
- **The bbox is now documented as a request guard and deliberately NOT
  tightened.** Its only job is to avoid asking NOAA about the Indian Ocean. A
  narrower box would be a geography table nobody can verify, and every degree it
  is wrong by is a storm that HAD radar and was refused it unasked. Generosity
  costs one 334-byte round trip and buys the guarantee that the answer came from
  the service rather than from a constant.
- **The row's standing note no longer claims "the US and its territories."**
  CONUS returned 2.2–3.7% and Anchorage 0.58%, but Honolulu and San Juan came
  back at 0.06–0.08% — indistinguishable from empty. One frame cannot separate
  "not in this mosaic" from "clear skies today", so the note stops naming
  territories it cannot vouch for. The limit that IS certain is **range, not
  nationality**: a hurricane far offshore has nothing looking at it even in the
  middle of the Gulf.
- `rec.url` is tracked separately from `rec.req` so `retry()` can still evict a
  disc whose frame came back blank — that disc holds no `req`, and it is exactly
  the one a user re-taps.

**Four satellites, two vendors, one channel.** ABI band 13, AHI band 13 and
SEVIRI IR 10.8 are the same physical measurement — clean longwave infrared,
~10.3–10.8 µm. Picking the matching channel everywhere is what makes one
palette honest. The table lives in `SATELLITES` (`config/constants.js`).

| Bird | Vendor | Owns |
|---|---|---|
| GOES-East | NASA GIBS | 105°W–30°W |
| GOES-West | NASA GIBS | 180°W–105°W |
| Meteosat IODC | EUMETSAT | 30°W–105°E |
| Himawari | NASA GIBS | 105°E–180°E |

- **The dateline handoff is FREE** — GOES-West and Himawari both returned real
  imagery for a box straddling 180°, so the boundary is the obvious number
  rather than a limit.
- **The eastern Indian Ocean handoff is NOT.** Himawari at 95–105°E came back
  washed out (luminance 95..141, near its horizon) where Meteosat IODC over
  the same box was clean. IODC owns it.

**NEVER SEND A TIME PARAMETER.** Measured, and the most load-bearing line in
the imagery code. Asking GIBS for a specific timestamp hits empty frames
unpredictably — on one afternoon's ladder GOES-East returned a blank frame at
0 and 20 minutes back, GOES-West at 60 and 120, Himawari at 0 — while every
request sending no time at all returned real imagery on all three. The server
knows its newest complete frame; we do not. **So the app carries no
per-satellite lag constant.** Playback (v2.0) needs explicit times and will
have to solve this properly; the time dimension IS advertised, it is just not
safe to guess a value from.

**THE KNOCKOUT KEYS ON SATURATION AND THE VENDOR'S COLOR IS THE PICTURE.** A
color-enhanced infrared product draws cold storm tops in vivid color and warm
ground, low cloud and clear sky in grey or black. So chroma is the key: a
bright grey pixel is dropped, a colored one is kept, and **the vendor's RGB is
written back untouched.** `lib/imagery-paint.js` writes ALPHA and nothing else.
Ported from the HA integration's `#extract-clouds` SVG filter, values and all:
`satSlope` 4, `satIntercept` −0.5 (cutoff at 12.5% of full chroma), `edgeFade`
0.5, `purpleFade` 0.5.

**Order of operations is load-bearing: clamp the mask, THEN multiply the
fades.** The SVG clamps every `feColorMatrix` result to 0..1 and applies the
fade masks as products (`feComposite operator="arithmetic" k1="1"`). Porting
them as subtractions off an unclamped mask breaks in both directions — a strong
red pixel with a raw mask of 4.03 absorbs both fades in its headroom and the
fades do nothing at all on exactly the vivid pixels they exist to tame, while a
faint blue pixel comes out 42% too aggressive. Verified against hand arithmetic.

**RETIRED: the normalized-coldness scale.** `IMAGERY_RAMP`, its 256-entry LUT,
`clearBelow`, `solidAbove`, `colourSat`, `colouredFloor`, and the per-vendor
`black`/`white` grey anchors are all gone from the code. That approach
repainted every pixel from a palette of ours, and `colouredFloor` pinned every
pixel the vendor had already colored into t ≥ 0.86 — the band from
(191,230,245) to white — so **the coldest, most vivid, most informative part of
a storm rendered as one flat white smear.** Aaron shot the HA card and Landfall
against the same weather at the same minute: vivid red/yellow/green versus a
white-and-blue wash. The most interesting pixels were the ones we destroyed
hardest.

**ALL FOUR BIRDS ARE NOW SETTLED, ON GLASS.** The three NASA GIBS layers are
color-enhanced — GOES-West (Genevieve, Fausto) and Himawari (NOUL-26 off
Guangdong) verified by screenshot. **EUMETSAT's `msg_iodc:ir108` is plain
grey**, verified by dropping test storms across the whole IODC footprint (Cape
Verde, Mozambique Channel, Arabian Sea, Bay of Bengal, Andaman Sea). The earlier
"all four are greyscale" probe finding was wrong about three of the four and is
struck; Meteosat is believed grey because it was SEEN, not because that probe
agreed.

**SO THERE ARE TWO KEYS, CHOSEN BY `sat.enhanced`, AND THEY ARE THE SAME
SHAPE.** A normalized signal, a `slope * signal + intercept` ramp, clamped, then
the rim feather. Only the signal differs:

| | signal | ramp | fades |
|---|---|---|---|
| `enhanced: true` | CHROMA — distance from grey | `satSlope` 4, `satIntercept` −0.5 | edge + purple |
| `enhanced: false` | BRIGHTNESS — normalized to the vendor's `black`/`white` | `greySlope` 4, `greyIntercept` −1.2 | none |

- **Either way the vendor's RGB is written back untouched.** The greyscale path
  renders honest monochrome infrared, not a repaint — that is the whole
  difference between it and the ramp that was deleted. It looks like a
  black-and-white satellite loop because that is what EUMETSAT sent.
- **No edge or purple fade on the grey path, and that is not an omission.**
  Both are functions of the blue and red channels, which on a grey pixel are
  just luminance again — `1 - edgeFade * b` would dim the brightest, coldest
  cloud tops by half, which is precisely backwards.
- **`greyIntercept` is derived, not picked.** Tropical ocean on IR sits around
  raw 26..61 against Meteosat's 9..218 anchors (t ≈ 0.08–0.25) and cloud starts
  climbing near raw 79..96 (t ≈ 0.33). Floor just above the ocean at t = 0.30,
  solid by t = 0.55 — which is slope 4, intercept −1.2. Meteosat's `black`/`white`
  came back into `SATELLITES` for this one path; they are the old probe's
  numbers and are a STARTING POINT, not a trusted measurement.
- **The config states a belief and the pass checks it.** Every frame measures
  `chromaMax` whichever path it took, and a grey-flagged bird sending colour
  warns to console with the fix. Per-satellite and not per-frame on purpose: an
  enhanced bird over genuinely clear ocean has no cold tops and therefore no
  colour, and auto-switching THAT to brightness would light up the warm low
  cloud the chroma key exists to hide.

**THE GREYSCALE TRAP, NARROWED TO THE CASE THAT IS ACTUALLY A FAULT.** A bird we
believe is enhanced sending a frame with no colour means the chroma key had
nothing to key on and the disc is empty — which over a live cyclone reads as
clear sky. `chromaMax` below `IMAGERY.greyscaleChroma` (0.02) on an
`enhanced: true` bird is surfaced as the named state *"Satellite sent a grey
frame — the colour filter has nothing to keep."* Never as clear sky, and with no
retry offered, because refetching a greyscale product returns another greyscale
product. An empty disc over a live cyclone is the §5 failure this document
exists to prevent.

**CALIBRATION IS LOGGED, NOT GUESSED.** Every frame reports its own 2nd and 98th
brightness percentiles (`luma=44..205` in the console line). Those two numbers
ARE the `black`/`white` anchors the greyscale path should be using — read them
off a real cyclone, never a clear box. This file has already made the mistake of
trusting a vendor claim it had not looked at.

- **This trades away the cool-toned rule, knowingly.** §6 fixes red, orange and
  yellow to category and to watch/warning, and a vivid IR palette puts those
  hues on the map carrying cloud-top temperature instead of severity. Aaron
  made that call against a side-by-side. The category dots and watch/warning
  segments still own their exact colors; imagery now shares the family.
- **The four constants were tuned for IEM's `conus_ch13` palette, not ours.**
  `edgeFade` and `purpleFade` exist because that specific enhancement renders
  its cold edge blue/purple. Our vendors may enhance differently. Starting
  points, not settled values.

**SAME-ORIGIN IS NO LONGER REQUIRED, and that retired a whole relay.**
Measured: NASA GIBS and EUMETSAT both send `Access-Control-Allow-Origin: *`,
so the browser reads their pixels directly. The inherited "the bytes must be
same-origin or the filter cannot apply" was an SVG-filter constraint and does
not bind a canvas pass. **Satellite has no relay hop.**

**PNG NEVER JPEG survives** — mosquito noise near black keys as colored halos.
Both vendors were measured serving PNG.

**WHAT IS STILL UNKNOWN: what our four vendors actually send.** The knockout
now logs `chromaMax`, `chromaMean` and the kept fraction per disc per refresh
(`console.info`, prefixed `[landfall] imagery`), because "is this product
enhanced or grey" is exactly the question that was answered wrong before and
guessing at it twice is not a plan. Read those numbers off a real frame per
satellite before touching any of the four constants.

**TWO OF THE DIALS ARE LIVE IN SETTINGS (§16), NOT CODE.** Cloud radius
(`imageryRadiusKm`, 300–1500 km) and edge fade (`imageryFade`, 0.05–0.70 of
the radius) are sliders. `config/constants.js` now holds their DEFAULTS and
their bounds; the effective values come from `data/settings-prefs.js` and are
pushed into `map/imagery.js` by main.js. The map module still never imports
`data/` — it takes tuning in through `setTuning()` the same way it takes storms
in through `update()`.

- **The fade is stored as the FADE WIDTH, not as where the fade starts.** It is
  the number the slider shows and the number a person thinks in;
  `lib/imagery-paint.js` computes `featherStart = 1 - fadeWidth` at the one
  place that needs the other end. One name for one idea.
- **The two dials cost different things, and that drives the whole design.**
  Fade is a client-side rim effect, so a change repaints from each disc's
  CACHED vendor frame with no network at all. Radius changes the request BBOX,
  so it refetches — there is no way to widen a picture we were never sent.
  Both are debounced in main.js (`IMAGERY.tuning.settleMs`, 180 ms) because the
  controls fire on `input` so the readout can track the thumb.
- **Settings stopped rebuilding itself on every change.** Re-running
  `innerHTML` is fine for buttons and fatal for a slider — it destroys the
  element the finger is holding. The view builds once and syncs in place, and
  never writes a value back to the control the user is currently touching.

**DIAL ORDER for the ones still in code, if the look is off.** `satIntercept`
first — more negative removes more haze, less negative keeps more of the outer
bands. Then `IMAGERY_OPACITY` (now 1.0, was 0.82; it was muting a disc that no
longer covers the whole box). Then `edgeFade` / `purpleFade` if the cold edge
reads too loud or too dead.

**The rim feather stays, and the HA card not having one is not an argument.**
That card drew a full-viewport rectangle clipped by its frame, so it had no rim
to hide. Landfall draws a 600 km disc on a globe, and an unfeathered disc reads
as a sticker stuck on the planet. Different shape, different problem.

**Radar is the near-land bonus and a different problem.** Ground radar is
blank over the open ocean where storms live. It arrives already keyed
transparent by the service, so it needs no knockout — only the rim feather, so
it sits on the globe the same way. Coverage `(-170, 10, -60, 72)`, gated by
storm position, stated on the row when outside. Never a blank raster: that
reads as clear sky.

- **`nowcoast.noaa.gov` IS GONE** — 403 through a CDN error page, measured.
  The service is `mapservices.weather.noaa.gov/eventdriven/.../radar_base_reflectivity_time/ImageServer/exportImage`.
- **Radar sends NO CORS header**, and the client must read its pixels to
  feather the rim. That is the entire reason `/api/imagery/radar` exists, and
  the only reason.

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
`advisoryKey` is a per-source function returning a string. It identifies WHICH
advisory a bundle was fetched for.

**It is no longer the geometry cache key, and that change is load-bearing.**
Keying the cache on it meant a new advisory self-invalidated for free — and it
also meant an EMPTY answer was stored as a success under a key that could not
change until the next advisory. On 2026-07-26 that froze Fausto's blank map for
six hours: the app had drawn his cone correctly minutes earlier and threw it
away because a later, emptier answer arrived. The cache is keyed by STORM and
holds each storm's BEST bundle (§7); `advisoryKey` records what the last attempt
was for, so an unsuccessful one is retried after `CACHE.geometryRetryMs` rather
than at the next advisory.

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
- **SCHEDULED polls** only run while the app is visible (page visibility API).
  No background work.
- **The FIRST load is never gated on visibility, and the distinction is
  load-bearing.** This line used to read "poll only while visible" without
  qualification, and `data/store.js` implemented it literally: the visibility
  check sat inside the function `startPolling()` calls immediately, so a page
  that began life hidden — background tab, prerender, PWA behind its splash —
  fetched nothing, held both source slots on `loading` indefinitely, and showed
  a permanent, error-free "Checking the oceans…". It recovered only because the
  separate `visibilitychange` handler fetched on the way back in, which made the
  first load quietly dependent on a listener that reads like an optimization.
  Fixed 2026-07-26: the check lives in the interval tick, which is the only
  caller that fires with nobody watching. Every deliberate fetch — first load,
  return-to-tab, Retry — is unconditional. The rule is about not spending a cell
  radio on an unwatched tab, never about refusing to load.
- Imagery frames: 5-minute source cadence; fetched only while an imagery layer
  is on.
- All intervals live in the constants file. No unexplained numbers anywhere.

### Cache TTLs
Starting values, each with a reason attached so it can be argued with later.
Not measured — tune on real data.

| What | Fresh | Serve stale until | Why |
|---|---|---|---|
| NHC storm list (relay) | 5 min | 9 h | Well under the 30-min poll, so a poll never gets served its own previous copy |
| **GDACS event list (relay)** | **5 min** | **9 h** | The NHC list's sibling behind the same poll. A list feed fresher than its sibling just means the merge sees two different moments |
| Model a-decks (relay) | 15 min | 9 h | Synoptic cycles are 6-hourly; stale + its visible cycle beats a blank layer |
| **NHC MapServer query (relay)** | **30 min** | **12 h** | Per-storm geometry, so it takes the GDACS geometry row's numbers. Geometry already lags the feed by 3¾–6¾ h, so 30 min on top is noise |
| **NHC MapServer EMPTY answer (relay)** | **5 min** | never | An empty FeatureCollection for a valid bin is transient — a bin whose geometry has not published yet, or a storm just retired. Never stored as last-good: a remembered nothing is strictly worse than the last real geometry. Matched to `CACHE.geometryRetryMs` |
| Client a-deck per (storm, advisory) | — | LRU, 12 storms | Same key and cap as geometry. A cached FAILURE is retried on the next warm pass, unlike geometry's — nothing taps a warm-only layer, so a hard-cached failure would never clear |
| **GDACS geometry (relay)** | **30 min** | **12 h** | Serve stale behind a failure, then stop — see below |
| Client geometry per STORM | — | LRU, 12 storms | Each storm's BEST bundle, not one entry per advisory. An empty or failed fetch never replaces geometry we already hold — it is recorded as an attempt and retried after `geometryRetryMs` (5 min). Cap 12, not 8: geometry is warmed for every NHC storm and the basins have peaked at 8–9 at once |
| Last-good storm data (service worker) | — | 9 h | ≈1.5× advisory cadence, carried from HA |

**EVERY "FRESH" NUMBER ABOVE IS NOW ALSO A KV FRESHNESS TEST (§17 Pass B).** A
route serves the globally warmed copy only while it is inside its own fresh
window; past that it goes to upstream itself and keeps the warm copy in hand as
last-good. **A warm store is not permission to stop checking** — §5's rule is
stale data *with a visible timestamp*, and the timestamp only means something if
we tried to beat it first. The cron cadence (5 min, `worker/wrangler.toml`) is
set to the shortest fresh window in this table for exactly that reason: warm
slower than the freshest row and that row ages out before the next cycle, so it
is paid for and bypassed.

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
  - `none_matched` — the request succeeded and matched nothing. Live in
    geocode search ("no matches for that address"). It no longer has a
    producer in the storm list: the scope filter that created it was removed
    2026-07-25 (§16), and with no filter nothing can hide a storm that exists.
  - `clear` — everything fetched clean and the ocean is genuinely quiet.
  - `silent` — **a FOURTH state, added 2026-07-26, and not a flavour of the
    other three.** All three of the above succeeded: the feed answered 200, the
    storm is still in the list, its record still says current — and the newest
    analysis in it is more than a day old. Nothing errored, nothing is missing,
    the data is simply frozen. See "Silent storms" below.
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
- **A feed that answers successfully can still be unable to answer the
  question, and that is the failure mode with no error to catch.** Every rule
  above assumes a fault announces itself — a throw, a bad status, a stale
  stamp. On 2026-07-26 the GDACS list returned 200, fresh, well-formed, cached
  correctly at every layer, and simply did not contain the live typhoon,
  because an unrelated hazard had filled its 100-feature cap. The app rendered
  a confident empty West Pacific. Nothing was broken and nothing was true.
  Where a feed's shape allows this, the app warns on the *fingerprint* rather
  than waiting for an error that never comes: `data/gdacs.js` logs when a list
  with features in it parses to zero current cyclones. Such a warning is
  console-only and deliberately over-fires in a quiet off-season — there is no
  honest user-facing claim to make, since `clear` really is the right render
  for a quiet ocean. **Ask of every new feed: what does it look like when this
  succeeds and is wrong?**
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

### Silent storms — a source that stopped publishing
**BUILT 2026-07-26.** `lib/silence.js`, `SILENCE.after` in
`config/constants.js`, `tools/test-silence.mjs`.

A ghost has LEFT the feed. A silent storm is still in it, still flagged
current, and has simply stopped being updated. Until this shipped there was no
state for that, so a frozen storm rendered identically to a live one — cone,
forecast track, forecast points, wind field, the lot, at full confidence.

**The threshold is 24 h (`4 × ADVISORY_CADENCE`) since the last ANALYSIS.**
GDACS fixes run 6–12 h apart and NHC's run 6, so this is two missed cycles even
for the slowest publisher and effectively cannot fire on a live storm. Erring
long is the cheap direction *because a silent storm is not dropped* — it keeps
its dot, its past track and a badge, so firing late costs a label arriving a few
hours after it could have. Dropping the storm instead would invert that trade.

**`observedAt` AND NOTHING ELSE.** Both feeds publish a second timestamp that
moves without a new fix behind it, and reading either would make this test
permanently pass. GDACS moved Noul's `datemodified` to 16:37Z on a day it had
published nothing since midnight. **`iscurrent` is not a liveness flag either** —
it means "GDACS has not archived this yet", and Bertha proves it goes stale by
days.

Measured on two real storms, not guessed:
- **Bertha, 2026-07-24.** NHC retired her completely — gone from
  `CurrentStorms.json`, her MapServer bin flushed to 0 features, her advisory
  bin archived. GDACS kept `iscurrent: "true"` on her for ~58 h with no new
  analysis. `data/merge.js`'s basin rule hid the damage by accident: a GDACS
  copy of an NHC-basin storm is dropped regardless.
- **Noul, 2026-07-26.** West Pacific, where that accident does not apply. GDACS
  ran ~6 h fixes and went silent at `2026-07-26T00:00:00Z` as she came ashore in
  Guangdong. Seventeen hours later the app was still drawing her **pre-landfall**
  cone and forecast points as the live future of a storm that had already hit.

**Keep history, drop the future** — the same rule as a ghost, and the reason is
the same. `pastTrack` and `windSwath` survive: a day-old record of where a storm
has been is still true. `cone`, `forecastTrack`, `forecastPoints`, `modelTracks`,
`windCurrent` and `watchWarning` are emptied, because each is a claim about now
or next. Watch/warning is on that list for a sharper reason than tidiness: those
are live government orders, and a day-old evacuation stripe painted as current
is the most dangerous thing this app could draw.

**Every path to the map goes through one gate** — `forMap()` in `main.js`,
covering selection, re-push, ambient warm and the cold-start repush. Model
tracks are folded in *first* so silencing can take them straight back out; a
warmed a-deck would otherwise paint five-day guidance across a storm nobody has
published a fix for since yesterday.

**EMPTYING A SLOT IS NOT ENOUGH, and this is the trap worth remembering.** Every
section of the detail panel writes a sentence from its slot's status, and those
sentences were written for a slot that came back empty *on its own*: "None in
effect." for watches and warnings, "No wind field published for this advisory."
for the wind field. Silencing the slot without changing the sentence would turn
a hidden warning into a published all-clear — this section's exact failure,
manufactured by the fix for this section's exact failure. Every section that
reads a silenced slot branches on silence FIRST
(`silenceSectionNote()`), and `mapProblemHtml()` returns nothing rather than
blaming the source for our own deliberate removal.

**The wording never says the storm ended**, only that we stopped hearing about
it. Same rule as the ghost note, and Noul is why: GDACS froze at landfall, when
the storm was very much still happening.
- Stamp badge (a fourth band, three lines, replacing the advisory line rather
  than tinting it): *"⚠ No updates from GDACS since Sat 7:00 PM"* / *"Last
  advisory 13 · Sat 7:00 PM (26 hrs ago)"* / *"Forecast hidden after 24 hours
  without an update. Position shown is last known. This storm may no longer be
  active."* The second sentence is load-bearing — **a missing cone with nothing
  explaining it reads as a broken app.**
- The agency is NAMED. With two feeds, "no updates" leaves the reader unable to
  tell which half of the world went quiet. One template, source substituted, so
  NHC going silent reads correctly for free.
- Panel sections: *"Hidden — no update from GDACS in over 24 hours."*
- Storm row and pill: *"not updating"* — *"2 active · 1 not updating"*, or
  *"No active storms · 1 not updating"* when every storm held has gone quiet.
  The count is SPLIT, never subtracted: dropping the storm from the pill would
  make it vanish from the only surface a narrow phone shows by default.
- The row's qualifier is spliced into its `aria-label`. The list is the
  accessibility surface for an aria-hidden canvas — a qualifier that exists only
  for sighted users does not exist.

**Silence outranks staleness** wherever both apply. `FRESHNESS` bands a
timestamp amber at ~4 h and red at ~9 h on the assumption an update is LATE and
coming; silence is that assumption failing. The row has space for one qualifier
and it is this one. Silent storms also sort last within their basin, ahead of
every other rule, in both `data/merge.js` and the list's own nearest-first
order — a storm nobody has published a fix for since yesterday should not head
the list on the strength of a day-old wind number.

**`sortStorms(storms, now)` takes an injected clock.** It makes the rule
testable against recorded timestamps, and it guarantees every pair in one sort
is judged against the same instant — a comparator reading the clock per
comparison could place one storm above and below the threshold within a single
sort, which is an inconsistent comparator and produces garbage orderings rather
than errors.

**Deliberately NOT done: the worker cron still warms silent storms.**
`worker/src/sources.js` is untouched. A silent storm keeps its past track on
screen, so skipping it would turn that history into a cold read during exactly
the landfall someone is watching — and the file's own note warns that a key the
client asks for and the cron skipped is the expensive direction.

**Open:** the threshold has not yet fired on a real storm. Noul is the first
case and crosses at ~2026-07-27T00:00Z. Watch what she does and correct the
number against that rather than against this reasoning.

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

**AUDITED AND SETTLED 2026-07-26, when light mode landed.** The hexes are
unchanged. The audit's finding was that the tension between "fixed severity
colors" and "readable on a pale daytime ocean" does not resolve by changing a
hue — it resolves the way WCAG itself points: do not carry meaning by color
alone.

**Every severity mark is drawn inside a halo in the theme's ink**, and the
forecast dots additionally carry their classification code as text. The FILL
says which severity; the HALO makes the mark findable. The two themes then work
from opposite directions and both pass: in the dark theme a bright Cat 1 yellow
separates itself from a near-black ocean by its fill, and in the light theme the
same yellow is held off a pale sea by its dark halo.

That is a measurable claim, so it is measured. `tools/contrast-check.mjs`
requires, for every severity color and both surfaces (ocean and land) in both
themes, that `max(fill-vs-surface, halo-vs-surface) >= 3:1`. It fails the run
otherwise. Land fill values are still chosen against these colors, never the
reverse.

## 7. Layer model

- **Baseline** (always drawn): storm markers worldwide; on selection — cone of
  uncertainty, past track, forecast track, Saffir-Simpson forecast points,
  watch/warning coastal segments.
- **Mutually exclusive pairs** (siblings fighting for the same map space — one
  draws at a time): current-position wind field ↔ full-track wind swath;
  watch/warning stripe ↔ surge bands; satellite ↔ radar.
- **Additive toggles**: forecast point date/time labels; model spaghetti
  tracks; home marker and readouts; graticule.
  `[DECIDE — more, as they earn their place]`
- **ADVISORY TEXT IS NOT A LAYER AND NEVER WAS.** It sat in this list and in
  `config/layers.js` until Phase 6 step 6 (2026-07-25), when Aaron asked where
  it should actually live. A layer here is something DRAWN ON THE GLOBE;
  advisory text is prose and draws nothing, so a row in the layers panel made
  that panel mean two things at once — what is on the map, and what is in the
  reading pane. It is also inherently per-storm, while every other row is
  map-wide. §16 item 7 had always placed it in the storm drawer; this list was
  the half of the spec disagreeing with the other half. The drawer won.
- **The layer system takes an arbitrary number of layers. There is no cap.**
  Each layer declares its own type — baseline, exclusive-pair member, or
  additive. Adding a layer later means adding a definition, not touching the
  layer engine.
- **Fetching layers fetch only while switched on; results cached per
  (storm, advisory)** — a new advisory naturally invalidates. This said
  "on-demand" and meant fetch-on-selection until model tracks landed
  (2026-07-25): that layer is WARMED for every storm while its toggle is on,
  so selection is instant. The gate is the TOGGLE, not the tap.
- **Cache failures, and let re-selection clear them.** A dead layer must not
  refetch on every render; re-toggling it means "try again."
- **Bound every cache.** Per-storm geometry and imagery frames both accumulate.
- Layer choices persist per device (localStorage). **Storm selection does not** —
  reopening the app restores layers and drops you on the globe, not on
  yesterday's dissipated storm.

### The layers panel
Two groups. Group headers are real `<h2>`s so screen-reader users can jump by
heading; headers are not focusable, rows are.

```
STORM DETAIL
  Wind field ─── [ Off | Current | Full track ]    segmented, default Current
  Coastal    ─── [ Off | Watch/warning | Surge ]   segmented, Surge dimmed
  ▸ "Surge coming soon."
  Imagery    ─── [ Off | Satellite | Radar ]       segmented, default Off
  ▸ "Radar only reaches storms near land. Satellite is worldwide."
  ▸ Playback controls are v2.0 — see §14 item 7
  Forecast times                      [ ○ ]   default ON
  Cone of uncertainty                 [ ○ ]   default ON
  Model tracks                        [ > ]   expands in place

REFERENCE
  Home marker                         [ ○ ]
  State names                         [ ○ ]
  Cities                              [ ○ ]
  Tropics & equator                   [ ○ ]   ships OFF, last in the group
```

**It was three groups until 2026-07-25.** Imagery had a group to itself
holding a single control, under a heading that repeated the control's own
label directly above it — a group of one is a divider with a redundant name
attached, and it pushed the pair away from Coastal, which is the row it
belongs beside. Both are things drawn over the storm, both are segmented
pairs. The pair moved into Storm detail after Coastal and the heading retired.

**"Graticule" became "Lat/long lines" and then "Tropics & equator"** — two
renames the same day, because the layer itself changed underneath the label
(see below). The pref key stays `graticule` throughout: renaming it would
silently reset the toggle on every device that has one stored.

- **Exclusive pairs are segmented controls, never two toggles.** Two toggles
  imply both-on is possible; a segment shows one is chosen.
- **EVERY PAIR CARRIES AN `Off` SEGMENT (2026-07-26).** It was satellite/radar's
  alone, on the reasoning that one sibling of the other two is always drawn —
  which described their DEFAULTS, not a rule anyone had argued for. Wind bands
  and the coastal stripe are both translucent area laid over the map, and with
  several storms active the thing you want is often neither of the two. "Pick
  which of these you cannot switch off" is not a choice a decluttering control
  should force. Defaults are unchanged: Current, Watch/warning, Off.
  - An `Off` segment is always `phase: 1` with a **null key**. Drawing nothing
    has shipped since the first commit and no source can fail to deliver it;
    giving it a real phase would let `pairLiveOptions` dim the one segment whose
    whole job is to be reachable.
  - A `neither: true|false` flag used to sit on each manifest entry stating
    exactly this. **Nothing ever read it** — zero consumers, grepped. The
    segment has always come from an `off` entry in `options`, which is where the
    view and the prefs store both look, so the flag was a second declaration of
    the same fact free to disagree with the first, and all three entries did.
    Retired rather than wired up: one source for one idea.
- **Coastal's control drove nothing at all until 2026-07-26, and no error said
  so.** `map/layers/watch-warning.js` registered as a baseline layer with no
  `pairId`, while the manifest had declared the `coastal` pair around it since
  Phase 4 — so `engine.setPair('coastal', …)` looped every definition, matched
  none, and returned, and the stripe drew whichever segment was lit. The layer
  worked, the manifest was right, the engine was right, and the wire between
  them did not exist. **Identical in shape to the model-tracks `engineKey` bug**
  (a switch flipped, data loaded, features built, layer stayed hidden), and the
  lesson is the same: a manifest entry is not a wire. When a pair is declared,
  something has to answer `setPair`.
- **Every row shows its own state**: loading (spinner in row), error (row goes
  amber, naming it — "Surge unavailable"), unsupported (row dims, subtitle
  "Not available for GDACS storms"). That last one is what §4's `can` block is
  for. Re-tapping an errored row means retry — the toggle is the recovery.
- **Rows dim, they never disappear.** A missing toggle looks like a bug; a
  dimmed one with a reason is information.
- **THE CONE GOT A TOGGLE (2026-07-25), having been baseline since Phase 4.**
  It defaults ON and always will — it is the official forecast envelope, the
  shape NHC leads every advisory with, and a storm without one is a dot with
  no future. What earned it a switch is the AMBIENT presentation: one cone
  answers "where is this going", six overlapping translucent cones are a milky
  film over the coastline you are trying to read a track against. **A layer
  that is right almost always and genuinely obstructive occasionally needs a
  switch, not a demotion.** It sits between Forecast times and Model tracks
  because those three are one group by meaning — when it arrives, how wide the
  official uncertainty is, and how much the models disagree.
- **Wind field ships CURRENT, not Full track.** It was flipped to the swath
  and flipped back the same day: a full-track envelope per storm is a lot of
  translucent area on a busy globe and it competes with the cone, which is the
  shape that answers the same question better. Current bands stay tied to a
  point, so they read as the storm rather than as weather in general.
- **The storm-detail group dims entirely with no selection**, header subtitle
  "Select a storm." Don't hide it — knowing those layers exist is the point.
- **Model tracks expands in place**, never pushing a second panel: §16 allows
  one panel at a time, so there is no stack to push onto. Rows carry their §6
  swatches, grouped consensus / globals / hurricane-specific — **the grouping
  is spacing only; the three headings were removed 2026-07-25.** Five rows in
  three clusters reads as three kinds of thing without three uppercase labels
  stacked over it, and every row already carries a second line saying what the
  model is.
- **The selected segment is a raised chip, not a darker patch.** It was
  `--glass` inside a `--glass-raised` group — literally darker and more
  transparent than the unselected segments, so font weight was the only signal
  that anything was chosen. Fixed 2026-07-25 with `--seg-active` /
  `--seg-active-edge` in tokens.js. A segmented control whose selection cannot
  be read has failed at its only job.
- **Reset to defaults** at the bottom. After toggling six things during a
  landfall you will want it.
- 44 px rows; the whole row is the hit target, not just the switch.

### Full layer inventory
Fifteen layers: **four baseline, three exclusive pairs (six layers), five
additive.** It was sixteen until advisory text was removed as a layer
(2026-07-25) — see the note above. The COUNT has not moved since; the cone
crossed from baseline to additive the same day (see below).

| Layer | Type | Phase |
|---|---|---|
| Storm markers (worldwide) | baseline | 2 |
| Cone of uncertainty | **additive (ships ON)**, ambient at every zoom | 4 |
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
| Model spaghetti tracks | additive, per-model sub-selection, ambient at every zoom, ships OFF | 6 |
| Home marker + readouts | additive | 3 |
| Tropics & equator (was "Graticule") | additive (ships OFF by default) | 1 |

The planet-band aesthetic is not a MapLibre layer at all: it is the **3D clear
globe's cyan geodesic cage** (`map/globe3d.js` + `map/heightfield.js`, §2),
which crossfades out as the dive hands off to MapLibre. It carries storm
severity as node elevation and node color but is not a toggle in the layers panel. The
graticule now ships off by default — the cage is the planet-band look — but
stays a MapLibre toggle for the equator/tropics reference.

**The grid was drawn and invisible until 2026-07-25, and that is a scar worth
keeping.** Its own values (#1C3550, 0.22 opacity, 0.5 px) were only half the
story: the layer rides MapLibre's canvas, which the dive holds at opacity 0
below `DIVE.zSpace` and does not bring to full until `DIVE.zHandoff` — and the
grid's ramp peaked at the planet band and had faded out again by z5. The two
ramps cancelled, so the brightest values landed exactly where the canvas
carrying them was invisible. Net contrast against the ocean was around 7% and
Aaron reported the toggle as doing nothing. **Any layer on the MapLibre canvas
is multiplied by the crossfade — a paint ramp tuned in isolation is tuned
against a number nobody sees.**

**THEN THE GRID ITSELF WENT, later the same day, and the second bug is the
better lesson.** Made visible, it drew UNEVENLY — and the cause was structural.
Parallels were generated on a clean `stepDeg` grid (…15°, 30°, 45°…) and the
two TROPICS were then appended at ±23.43665°, which lands on no step boundary
and never will. Between 15° and 30° sat three lines with 8.4° above the tropic
and 6.6° below, while every other gap on the globe was a clean 15° — an
irregular line in the middle of a regular grid, exactly where an Atlantic
hurricane spends its life.

That could have been fixed by dropping the tropics. It was fixed by dropping
**everything else**, because the tropics were the only lines in the set that
meant anything. §12's "structural devices encode something true" was already
in this file's header, arguing that major lines carry meaning and "a grid where
every line is identical tells you nothing" — **the honest end of that thought
is that the identical lines should not be drawn at all.**

What is drawn now is three labelled reference latitudes:

| Line | Why it earns its place |
|---|---|
| **Equator** | Tropical cyclones do not cross it — Coriolis reverses sign and a storm cannot survive the transit. It is also why northern storms spin counterclockwise and southern ones clockwise. |
| **Tropic of Cancer** (+23.43665°) | The conventional edge of the tropics; brackets the warm water these storms are born in. |
| **Tropic of Capricorn** (−23.43665°) | Same, southern hemisphere. A storm crossing one is usually beginning to recurve and weaken. |

**30°N/S was considered and rejected.** Recurvature under the subtropical ridge
really does tend to happen near it, but it is a rule of thumb that moves with
the ridge, and drawing it as a fixed line would claim a precision the
atmosphere does not have — §5's honesty rule applied to cartography.

**±23.43665, never 23.5.** That is the measured obliquity of the ecliptic; the
rounded value puts the line about 6 km from where the tropic actually is.

**The lines are LABELLED**, along the line (`symbol-placement: line`, repeated
by `symbol-spacing`) rather than at a point — a single centred label on a
line spanning the whole globe lands in whatever ocean happens to be at the
middle of the geometry. Names arrive at the basin band, not the planet band:
§9's ladder says z0–2 carries no labels, and these are labels like any other.
**An unlabelled line is decoration.** Three anonymous horizontals only mean
something to someone who already knew what they were, which is the audience
that needed them least.

### The track line — ONE continuous curved path, `lib/trackline.js`
**CONFIRMED ON GLASS 2026-07-26 (Aaron)**, both passes: the join and curve
(`9af7a65`), then the lens fix (`f0e18b6`).

The past and forecast tracks are two bundle slots and two map layers, but they
are **one storm path**, and they are built as one. `smoothTracks()` is the third
and last decoration in `forMap()` (§12): stitch → orient → join → spline → cut.

**THE GAP WAS REAL AND MEASURED ON GLASS 2026-07-26.** Aaron's screenshot of
Fausto, pixels read directly: NHC's Past Track line ended **254 screen px** from
the forecast's first dot. Extended in a straight line it passed within **4 px**
of that dot's centre — so the two layers are one path with a leg missing, not a
projection fault. The map drew a storm whose history simply stopped out at sea,
with a dotted line trailing off toward nothing.

- **The past track is made to END on the vertex the forecast STARTS from.**
  That vertex is NHC's first forecast point, which is the current position and
  the dot everything else on screen is anchored to. They share the vertex, so
  they cannot separate however the curve is tuned.
- **The connecting leg is DOTTED, not solid.** The cut is at the forecast's
  first *original* point, so the leg that closes the gap belongs to the past
  track. The storm has already travelled it; drawing it in the forecast's
  confident white would promote history to prediction.
- **NO DISTANCE GUARD ON THE JOIN** (Aaron, 2026-07-26). A first draft refused
  to connect across an implausibly large gap. That would have meant the app
  silently reverted to the broken picture on exactly the days a feed was behind.
  It always connects; the **silence badge** is what says the record is old.
- **Neither source guarantees a direction**, and a LineString drawn backwards
  renders identically — so a wrong assumption here would never surface until the
  connector appeared at the wrong end of the world. All four endpoint pairings
  are measured, never assumed.
- **DIRECTION OF TRAVEL OUTRANKS DISTANCE at the seam.** A pairing that makes
  the path reverse onto itself (`TRACK_LINE.maxTurnDeg`, 150°) is refused
  outright however near its endpoints happen to be; among what survives, the
  smallest gap wins. The connector has to continue where the storm was going —
  that is the whole meaning of "the most recent end".

**GDACS SHIPS A TRACK AS ~30 DISCONNECTED SEGMENTS IN INTENSITY ORDER**, with
the `forecast` flag flipping *inside* a class run (`spec-parameter.md` §5.3).
They only ever looked like a track because consecutive segments happen to abut
on screen. Smoothing them where they lay would have done nothing at all — a
two-point segment has no corner. They chain because their shared fixes are the
same COORDINATE, matched to `joinEpsDeg`. NHC sends one line and the stitcher is
a no-op there.

**===> RUNS THAT WILL NOT CHAIN STAY SEPARATE. NEVER FORCE THEM. <===**
The first version, having chained what it could, concatenated the leftovers by
nearest endpoint — reasoning that a track in pieces is the fault and one line is
the fix. **It is not, and it reached glass.** On Genevieve (2026-07-26, Aaron)
the past-track slot held two descriptions of the same history; joined tail to
tail, the path walked out along one and back along the other. It drew as a
**lens** — two dotted arms leaving the current-position dot, bowing ~44 px
apart, closing again at the far end of the track. Nothing errored. The geometry
was simply a journey she never made.

**It could not have been rescued downstream, and that is the durable part.** A
fold made of two near-parallel copies turns only about **120°** at the seam
(measured on the reproduction in `tools/test-trackline.mjs`), which is inside
the range a genuine sharp recurve reaches. Any threshold low enough to catch it
would cut real tracks. A first attempted fix — a 150° "no doubling back" guard —
was built, measured against the real shape, and **found not to catch it**. The
only safe move is not to build the fold.

So an unassemblable track draws as **separate features in the same slot, which
is exactly how it drew before this module existed.** That is the floor this
whole feature has to clear: a storm whose track cannot be assembled is never
worse off than it was. The longest chain is the one the forecast joins; the
others are smoothed on their own and left unjoined.

**"Always connect" applies to the past→forecast seam, NOT to unrelated pieces.**
Those are different joins. One closes a gap between two things known to be the
same journey; the other invents a journey. Conflating them is what caused this.

**A console line names any storm whose track will not assemble**, with the run
and chain counts for both slots. The diagnostic exists because when Genevieve
failed there was no way to tell from outside whether NOAA had sent one line or
several, and the sandbox cannot reach NOAA to look.

**THE CURVE: centripetal Catmull-Rom, `alpha` 0.5.** It passes exactly through
every published fix — **we never move a reported position** — and only the space
*between* fixes changes. Centripetal rather than uniform for one reason that
matters: uniform Catmull-Rom overshoots and can loop back on itself where the
direction change is sharp, which on a storm track is a recurve, the one moment
somebody is actually watching. At 0.5 a cusp is mathematically impossible.
`TRACK_LINE.alpha` is not a roundness dial — raise it toward 1 (chordal) for a
tighter line, never lower it.

**Splining ACROSS the seam is the point.** Smoothing the halves separately
leaves a kink exactly where the eye is looking. One curve through both carries
the tangent through the current position, so the dotted past flows into the
solid forecast without a corner. Measured: **under 12°** of heading change
across the join on the Fausto fixture.

**Is a curve honest?** A straight line between two 6-hourly fixes is exactly as
invented as a curve, and a storm carries momentum. Neither is a claim about
where the eye was at 03Z. The curve is the better guess, not a decoration.

**The forecast line stays well inside the cone, measured not assumed.** On a
classic Atlantic recurve the curve departs the straight chord by at most
**15.4 nm**, worst on the 48→72 h leg, against NHC cone half-widths of ~68 nm at
48 h and ~96 nm at 72 h. **The cone is still drawn as NOAA published it** —
their polygon, their water, unbent. `[DECIDE]` whether the cone should be rebuilt
by sweeping the recovered radii along the curved spine (the `lib/windswath.js`
machinery already does exactly that operation for the wind swath). Deferred on
purpose: at 15 nm the mismatch may not be visible, and bending a federal
uncertainty product changes the answer to "is my town in the cone".

**Planar frame and the antimeridian.** Longitude is scaled by cos(latitude)
before splining and unscaled after, so the curve is computed on something shaped
like the ocean. Every distance uses a **wrapped** longitude delta, so a run
published either side of 180° still chains; output longitudes are deliberately
left **unwrapped** (they may run past ±180), which is what MapLibre needs to draw
a continuous line across the seam. The first vertex keeps its source longitude,
so nothing translates.

**Order matters: this runs AFTER silencing.** A silent storm has no forecast
slot left, so it gets a smoothed history and no connector — right, because the
leg joining the two is a claim about where the storm is *now*. Smooth first and
that connector would outlive the forecast it was reaching for.

**Failure is pass-through.** This is cosmetic geometry; anything unexpected
returns the bundle untouched with a console warning. A straight track is a worse
picture, a missing track is a §5 bug.

**Cost, measured:** a mature storm (45 past fixes + 7 forecast points) becomes
353 + 73 vertices in **0.38 ms**. Ten storms on an ambient repush is ~3.8 ms —
nowhere near a frame, and it runs on data changes, never per frame.
`TRACK_LINE.maxVertices` caps a pathological track at a coarser line rather than
the frame budget.

**OPEN: why does a past track arrive in pieces at all?** Genevieve's did on
2026-07-26 and the reason was never established — the sandbox cannot reach NOAA,
and the gated `/inspect` route needs an `INSPECT_KEY` that may not be set on
Pages. Drawing the pieces separately is correct and safe, but if NOAA is
publishing two descriptions of one history there is probably a right one to
pick. The console line now names any storm this happens to, which is the
measurement to take next time it does.

**One touchpoint deliberately left alone:** the forecast time labels ride the
normal to the track (`map/layers/label-placement.js`), computed from the raw
forecast points, not from this curve. Label placement has an open fault of its
own (§7 above) and tangling a working change into it would confuse both.

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

**Spoke placement (`map/layers/label-placement.js`) — THE TEXT IS THE SPOKE,
AND EVERY SPOKE ON A STORM IS PARALLEL.** The label is rotated and anchored
at the end nearest its dot, so the line of text starts just outside the dot
and runs outward, pointing back at the dot's centre.

**Three rules, all Aaron's, all hard:**
1. **ONE ANGLE PER STORM.** Every label on a track is drawn at the same tilt.
   Only the DIRECTION a label runs from its dot varies — that is the side —
   and because the two directions are 180° apart while the tilt never exceeds
   45°, both resolve to the SAME `text-rotate`. The side shows up as a left
   or right anchor with a negated offset. The value MapLibre receives is
   literally identical for every label on a storm.
2. **THE SHALLOWEST ANGLE THAT FITS WINS.** The search starts at 0 — dead
   horizontal — and works outward in `tiltStepDeg` steps, taking the first
   angle that places every label cleanly. Text is easiest to read horizontal,
   so a tilt is a cost paid only when the labels will not otherwise fit.
   Across angles a steeper tilt has to EARN it: it wins only by showing more
   labels, or the same number with fewer side changes. Never on balance.
3. **`maxTextTiltDeg` = 45 is a ceiling, not a preference.** Past it the
   labels stop scanning as text.

Measured on the three live storm shapes: **Genevieve (diagonal) 0°,
Noul (due north) 0°, Fausto (due west) −25°** — every label kept, all on one
side, zero side changes in each case. A diagonal or north-south track
staggers its own labels and needs no tilt at all; only a due-west track,
where every label would land at the same height, has to lean.

**The angle is NOT derived from the track.** It used to be the perpendicular
at each point, which fans the labels and puts near-vertical text on a
westward storm — a true spoke, and hard to read. Legibility won. What
survives of the spoke idea is the part that matters: the text starts at the
dot and runs outward, so extending any label lands on its own dot.

**How it reaches MapLibre**, verified by reading the bundled 5.6.0 source
rather than from memory: `text-rotate`, `text-anchor` and `text-offset` are
all property-type `data-driven`, and the rotation matrix is applied to glyph
positions that ALREADY include the offset. So `text-offset: [g, 0]` with
`text-anchor: 'left'` and `text-rotate: θ` puts the START of the text `g` out
along `θ`. That one detail is what the whole approach rests on.
`text-rotation-alignment` is `viewport`; `text-max-width` is 30 ems to rule
out a wrap, which would break the one-line geometry.

**`spokeStartPx` is the distance to the NEAR END of the text, not its
centre.** It used to be the centre, which put an 80px-wide label 26px
sideways from its dot — so the label straddled the dot and the text landed on
the glyph. Seen on glass 2026-07-26 on Noul, a due-north storm.

**LABELS AVOID OTHER DOTS, not just each other.** A shallow angle can lay the
text straight along the track and through the next forecast point, which
label-against-label collision cannot see, so the dots are obstacles in their
own right (`dotClearPx`). That test is written against the text's INK, not
the padded collision box: counting collision padding as ink measures a
clearance the label genuinely has and throws the label away for it. Measured
— getting that wrong cut a tightly spaced westward track from nine labels to
two.

**Collision boxes are ORIENTED, tested by separating axis.** An axis-aligned
box around a 45° label is a 74x74 square around a strip that is really 86x19,
and two neighbours on a diagonal track then "collide" across a clear 70px gap
— measured, it cut a diagonal storm from eight labels to four.

**The side arrangement is still chosen whole, not label by label**, inside
each angle. A label's side is a property of the RUN it belongs to. Placement
tries every label on one side, then every single split point (two contiguous
groups), then every pair (three groups); `maxRuns` stops there, because a
fourth group on a nine-point track is two labels long and that IS
alternating. Ranked by fewest groups, then the evenest split — all on one
side when the geometry allows, and when it does not, four and four in
sequence, never one stranded against seven and never up-down-up-down.
Anything that still will not fit is hidden, never flipped out of its group;
thinning protects the first and last points and spreads the rest, and
`minKeepFraction` stops tidiness from gutting the forecast. With a shared
tilt these paths are rarely reached — it takes a tightly wound S-curve, and
that is the test fixture.

**Cost:** 0.002 ms when the labels fit at 0°, which is the common case and
stops the sweep on its first pass; 1.8 ms worst case when every angle is
tried. Recomputed on `moveend`, debounced, never per frame.

**The four MapLibre dead ends, kept so nobody re-treads them:**

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
  `data-driven`, parameters `["zoom","feature"]`) and is what ships. The
  expression validates, the layer draws, and `_o` was read live off the
  source as a genuine two-number array including true diagonals. The
  transport was never the fault. `text-radial-offset` must stay absent — it
  disables `text-offset` outright.
- **A LESSON WORTH KEEPING:** three consecutive fixes here passed full
  offline validation and failed on the phone, because every isolation test
  fed the same single synthetic track. The one variable that mattered — track
  angle — never varied. A fixture that cannot reproduce the failure is not a
  test. `tools/test-label-placement.mjs` now sweeps angle and spacing.
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

### Model spaghetti tracks — BUILT AND CONFIRMED ON GLASS 2026-07-25

What the layer answers, and it is a different question from every other layer:
not "where is the storm going" — the cone answers that — but **"how much do
the forecasters' own tools disagree about it."** A tight bundle of lines and a
wide fan produce the SAME official cone, and until this layer the two were
indistinguishable on screen.

- **Per-model selector, not one on/off switch.** Five models at once over a
  cone is a hairball; the useful question is usually "where does GFS depart
  from the consensus," which needs two on and three off.
- **Four selector rows for five techs.** TVCN and HCCA share one slot, one
  color and one pref (`consensus`): the same consensus answer under two names,
  never drawn together, and a user who switched Consensus off must not have it
  return under the other name when TVCN drops out of a cycle.
- Shortlist carries named identity colors (§6); anything beyond it draws from
  `MODEL_FALLBACK_RAMP` by position, so a model added to the manifest without
  a hex still draws distinctly and never silently borrows a named model's.
- Selector rows carry their own swatches, so the legend and the control are the
  same object. Grouped consensus / globals / hurricane-specific.
- **Selection persists per device — INSIDE the layer record**, not in a store
  of its own. Which models draw is a sub-choice of a layer, and
  `data/settings-prefs.js` states that a THIRD preference store is the moment
  to extract a shared factory (§12). `STORAGE_KEY.models` was retired unbuilt.

**SHIPS OFF, the only fetching layer that does.** Guidance is an expert read;
a stranger arriving by shared link mid-storm (§1) is asking where it is going,
not how confident the forecaster is. The off default also gates the warming
below, so a first-time visitor pays nothing for it.

**AMBIENT ON EVERY STORM, like the wind field and the cone.**

The first build drew the selected storm only, on the arithmetic: five models
across a nine-storm season is forty-five crossing lines. **Aaron changed it on
glass the same day, and the reason generalises — a layer the user turned on and
then has to tap a storm to see is not a layer, it is a detail popup wearing a
toggle.** A layer switch is a statement about the whole map. The wind field
settled this exact argument once already (§7, "a layer the user set and forgot
should not silently apply to one storm"); the second file to reach for the
same exception should have been read as a sign the rule was right.

The forty-five-line worry is real and UNMEASURED, not wrong. If a full basin
turns the map to soup, the fix is a floor keyed off `ZOOM` — one constant, the
same escape hatch this spec already names for the wind field. Measure before
building it.

The two presentations render IDENTICALLY, so selection changes which source a
storm's lines ride and nothing about how they look — a data split, never a
visual difference.

**Caught headless when ambient landed:** the selected storm's deck was pushed
to the SELECTION only, leaving its ambient copy without guidance. Everything
looked right until you deselected, at which point that storm rejoined ambient
and its lines silently vanished. `onDeckLanded` now pushes BOTH, always — the
ambient push is a no-op while the storm is selected, so there is no branch to
get wrong.

**WARMED FOR EVERY STORM, ON APP LOAD, WHILE THE TOGGLE IS ON (Aaron,
2026-07-25).** Not fetched on selection and not gated on zoom: switch it on
and every storm's guidance downloads, so the lines are simply there. Warming
runs one storm at a time (`MODEL_TRACKS.warmConcurrency`) — warm-ahead detail
nobody is waiting on should be the politest thing on the connection. This is
what forced the relay's row filter (§4).

`[DECIDE]` **A zoom trigger is the named fallback if load-time warming proves
slow** (Aaron, 2026-07-25) — fetch a storm's deck when the camera reaches its
band rather than at boot. Not built, because the cost has not been measured on
a real season yet, and the filtered payload may make the question moot.

**ATLANTIC AND PACIFIC ONLY — AND THAT IS A FILE LIMIT, NOT A DATA LIMIT.
CORRECTED 2026-07-25; the first version of this section was WRONG.**

It claimed GDACS "publishes no model output at all" and recorded that as §14's
standing exception — a permanent, closed question. **Aaron caught it by reading
the copy on screen and asking why worldwide models would not cover a typhoon.
He was right and the claim was never checked.**

What is actually true, verified the same day: `ftp.nhc.noaa.gov/atcf/aid_public/`
contains ONLY `al`, `ep` and `cp` files — confirmed by listing the directory and
by the ATCF README, which names those three basins. GFS and UKMET are worldwide
models and forecast typhoons perfectly well. The rest of the world is JTWC's
responsibility and its guidance is published somewhere we have not found yet.

So this is a COVERAGE GAP IN OUR SOURCE, and it is an OPEN TASK (§15), not an
exception. The row says "Atlantic and Pacific storms only"; a storm outside
that coverage reads "Guidance isn't published for this basin".

**THE LESSON, and it is the rule this spec already states:** stating a
source-coverage limit as a data absence is §5's failure with the blast radius
turned up. "We cannot reach the file for that ocean" and "no model on earth is
forecasting this typhoon" are wildly different claims, and the app was making
the second one. An unverified inference was written into the code AND into this
spec as settled — the exact thing "never present an unverified inference as a
confirmed fact" exists to prevent. It survived because it was plausible and
because nobody had a typhoon on screen to disbelieve it.

**DASHED AND THINNER THAN BOTH TRACKS, and that is the grammar.** Forecast is
solid at 1.75, past is dotted at 1.5, guidance is dashed at 1.1 and drawn
UNDER them (order 18, below the tracks at 20/30). A model run is an INPUT to
NHC's forecast, not a peer of it; drawing it at the forecast's weight would
promote a raw model to the status of NHC's judgement — a lie about authority,
and one that reads as authoritative precisely because it looks official. The
dash is longer than the past track's dots on purpose: at the zoom where both
appear, `[1,2]` and a short dash become the same grey texture.

**Caught headless before glass, and worth keeping:** the manifest entry had no
`engineKey`, and `main.js` only pushes toggles that name one. The switch
flipped, the deck loaded, the features were built — and the map layer stayed
`visibility: none`. A toggle that does nothing, with no error anywhere.
Identical pref and engine names are exactly when an assumed mapping looks
safest and fails silently.

**CONFIRMED ON GLASS 2026-07-25 (Aaron):** the layer draws, the toggle works,
and the tracks are correct — the one complaint was that it took a selection to
see them, which is what made it ambient.

**Still to verify on glass:** ambient guidance with more than one storm up —
the forty-five-line question, now live and unmeasured; whether five lines read
as a spread or as noise at phone width; `STORM_GEO.modelLineOpacity` against a lit landmass; whether
the dash survives at the basin band or blurs into a solid; the real payload and
parse cost of a mature storm's deck on a phone (the filter is measured on
synthetic input only); and whether warming nine decks is felt on a cell
connection. `[DECIDE]` whether to fade guidance out past ~72 h so the
near-term cluster — the part that is actually actionable — reads first.

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
- **The address box is `type="search"`, and that is load-bearing.** As
  `type="text"` it was a bullseye for browser autofill heuristics — a label
  reading "address", a placeholder reading "Street, city, or postcode" — and
  neither Chrome nor Safari honours `autocomplete="off"` on a field they have
  decided is an address. They offered the user's saved addresses, which live on
  the same record as their saved CARDS, so a hurricane app was popping a
  credit-card menu over the keyboard (seen on a Pixel 10 Pro XL, fixed
  2026-07-26). A search field is excluded from that machinery by both engines.
  The `name` is deliberately not address-shaped for the same reason, the field
  is deliberately not inside a `<form>`, and the `data-1p-ignore` /
  `data-lpignore` / `data-bwignore` / `data-form-type` attributes are the
  non-standard opt-outs the password managers respect. **Do not "fix" the type
  back to text** — the card menu comes straight back with it.
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
  things depend on it: storm-list sort order, where recenter comes to rest,
  the opening
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
- **A correct minimum is not a true sentence.** `closestApproach()` finds the
  right great-circle minimum — measured against a 4,000-step true-sphere search
  it agrees to 0.2 nm and under a minute, so the linear interpolation between
  forecast points is not where error lives. The error lived in reporting that
  minimum unconditionally. Measured live on NOUL-26 from a Baton Rouge home
  (-91.0, 30.35): 7,315 nm now, 7,085 nm at its forecast minimum — nearer every
  hour, because the great circle from Louisiana to the West Pacific crosses
  Alaska. The app printed "closest approach in 2 days" over a typhoon bound for
  Taiwan.
  **A cyclone is ephemeral, not orbital.** It lives days and dies where it dies;
  it never comes round the far side. So the minimum is filtered, then described
  by two orthogonal flags, all tuned by `APPROACH` in `config/constants.js`:
  - **Past points are skipped.** Neither source's track starts at "now" — GDACS
    splits on the advisory ISSUE time, NHC's tau 0 is the synoptic analysis up
    to 3 h behind issuance, and the advisory itself may be hours old. The
    current position is the one deliberate exception and the anchor.
  - **`trend: 'closing' | 'receding'`,** never null, and it is a statement
    about the TRACK, not the clock: closing means the forecast beats the
    current position by more than `minGainNm`. Lead time is deliberately NOT
    part of it — a minimum forty minutes out is still a real minimum, and
    `formatUntil` already renders anything inside two minutes as "now".
  - **`relevant: false` beyond `relevanceNm` (1,500 nm),** orthogonal to
    `trend`. It no longer decides whether anything is reported — that made it a
    story-switch, and two East Pacific storms both bound for Hawaii at 1,408 nm
    and 2,368 nm read as two different situations for want of 92 nm. It now
    only picks which true sentence fits.
  - **Three sentences, from those two flags**, each checked against what it
    claims. `closing + relevant` → "Closest approach" with a number and a time.
    `receding` → "Moving away, never closer than current position."
    `closing + not relevant` → "Moving away — never comes near home", because
    the first sentence would be measurably WRONG: NOUL-26 gains 230 nm of
    7,315 over the pole. A `null` return is a fourth thing entirely — "no
    forecast track", which is "we cannot say" rather than any of these (§5).
- **Every state of the approach block has words — there is no silent path.**
  It previously rendered nothing for a failed geometry fetch and nothing for a
  bundle that carried no track, which made a broken fetch and a healthy storm
  identical pixels (§5). Five outcomes now, and the wording distinguishes what
  is actually different: pre-fetch and in-flight both say "Loading forecast
  track…"; a source that never publishes one says so; a failed fetch says the
  track didn't load and offers Retry; and a bundle that arrived with no points
  says "No forecast track in this advisory" UNLESS that one layer's slot reads
  `unavailable`, in which case it is a failure and gets the failure wording.
  More than one Retry can be on the panel at once, so the handler binds every
  `.detail-retry` by class. Binding one by id catches only whichever comes
  first in the document and leaves the rest dead.
- **The storm list carries a trend word, from dead reckoning.** Rows hold no
  geometry — tracks are fetched per storm on selection — so `motionTrend()`
  projects the published `headingDeg`/`speedKt` forward `trendProbeHours` along
  a great circle and compares. It returns null for no motion data, a stationary
  storm, a storm beyond `relevanceNm`, or a broadside pass inside the
  `minGainNm` deadband. **GDACS publishes neither heading nor speed, so every
  GDACS row shows no trend word** — deliberate, since inventing a direction for
  a source that publishes none is the fabrication §5 forbids.
- Home is stored locally on the device only. No accounts, no server-side user data.

### Units
Auto from locale, with a manual override in Settings — **both halves live as of
2026-07-25**. Auto alone breaks for the American living abroad; a setting alone
is a chore for everyone else.

**THE SLIDERS CARRY NO EXPLANATORY PROSE.** All four hint lines came out on
2026-07-25. A slider with a name, a live figure in real units, and a globe
visibly responding underneath it explains itself better than a sentence can,
and the sentences were restating their own labels at four times the height.
The MESH-HEIGHT note stays, because that control's two options differ in a way
the words carry and the picture cannot: a forecast peak looks identical to a
measured one, and only the text says which you are looking at.

**AUTO IS A STORED VALUE, NOT A SYNONYM FOR WHAT IT RESOLVED TO ONCE.** The
preference persists as `auto` and is collapsed against the device locale at
every render (`resolveSystem`), so a phone that travels — or a browser whose
locale changes — follows along instead of being frozen to whatever it meant on
first run. `main.js` owns the single resolver and injects it into every view;
no view answers the question twice, because two surfaces resolving it
separately is how one drawer ends up showing miles above kilometres.

**THE USER'S UNITS LEAD. THE SOURCE'S FOLLOW, IN PARENTHESES.** Vitals read
"98 mph (85 kt)" and "1,597 mi (1,388 nm)" — it was the other way round until
2026-07-25, which put the reading unit second everywhere. Knots and nautical
miles stay as the footnote because the advisory text a few rows down quotes
them and a reader cross-checking should not have to convert in their head.

**The storm list carries no source units at all.** It is the glance surface,
and converting knots in your head is precisely what there is no time for
there.

Machinery existing is not the same as machinery being wired. The conversion
functions, the locale detection and the imperial-region list were all correct
and shipped for weeks while callers silently took the default and the two
Settings sliders did not convert at all — hardcoded `km` on a screen where
every other figure said miles. **A formatter nobody passes a system to is a
formatter with an opinion of its own.**

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
- **GDACS timestamps carry no timezone marker and are UTC.** `fromdate`,
  `todate` and `datemodified` all arrive bare — `"2026-07-24T21:00:00"`.
  JavaScript parses a bare ISO string as LOCAL time, so every GDACS timestamp
  must have `Z` appended before it reaches `Date`. NHC's do not: they arrive as
  `"2026-07-24T21:00:00.000Z"`, already marked. **The two feeds do not agree on
  this and must not share a parse path that assumes they do.**
- **So GDACS stamps are normalized AT INGEST, never at render.** Every GDACS
  entry point runs its bare strings through `parseGdacsStamp` (`lib/time.js`),
  which appends the `Z`: `data/gdacs.js` for `todate`/`fromdate` → `observedAt`,
  `data/gdacs-geometry.js` for `polygondate`, `data/gdacs-points.js` for the
  per-dot `key` via `parseGdacsPointTime`. What leaves the data layer is a UTC
  ISO string with a `Z` from BOTH feeds, so the shared render path in
  `lib/time.js` never has to know which source a storm came from. A new GDACS
  timestamp field is only safe once it has been through that parser — an
  unparseable one yields null, and the formatters render null as "—".
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
  A user may CHOOSE to follow the device in Settings; that is a preference, not
  the app taking its look from its surroundings. The default is dark for
  everyone regardless of what the OS says.
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
  storms and simultaneously blends toward that storm's §6 category color. Two channels, one number: a Cat 5 is both the tallest peak and the only
  pink one, so severity survives being read at a glance, on a small screen, at an
  angle. Heights and colors ease in/out together and recompute on the storm poll.
  On a feed outage the cage desaturates to grey — colors included, so a held peak
  cannot keep showing a category the feed can no longer vouch for — and holds its
  last shape; it never flattens to a fake all-clear (§5). Node count and
  spacing are a frame-budget decision (`GEO_DETAIL`); peak shape is tuned by
  `STORM_AMP` / `STORM_SIGMA`.
  - **MESH HEIGHT: `current` or `track` (built 2026-07-25, Settings §16).**
    `current` lifts the cage over each storm's live fix — one point per storm,
    the original behaviour, and still the DEFAULT. `track` follows the whole
    path: past positions trailing, forecast positions running ahead, each bead
    at its own intensity at that hour. `map/storm-mesh.js` owns the
    construction; `MESH_TRACK` in `config/constants.js` owns every number.

    **HEIGHT IS INTENSITY, NOTHING ELSE.** A bead stands at the wind measured
    (or forecast) at that position, so the tallest point on a storm's ridge is
    its STRONGEST point — past, present or future — wherever that falls.

    **AN EARLIER PASS TAPERED HEIGHT WITH AGE AND LEAD TIME. REMOVED
    2026-07-25, caught on glass by Aaron.** The argument for it was §5: a
    forecast rendered as tall as a measurement is a prediction drawn as fact.
    Two things kill it, and both are this spec's own rules:
    1. **It broke the invariant three paragraphs up.** Colour is each
       position's true category and was never tapered, so a Cat 4 three days
       old drew SHORT and red beside a taller orange Cat 2. "Elevation and
       color are one signal from one number" — the taper made height a blend
       of intensity and recency while colour stayed pure intensity. This is
       the SECOND time this exact drift has been fixed at this seam (§15 item
       0a, the `windKt ?? peakWindKt` fall-through).
    2. **Nothing else in the app dims the forecast.** Cones, forecast tracks,
       forecast wind bands and forecast dots all draw at full strength; "this
       is a forecast" is carried by shape and line grammar (§7), never by
       rendering it fainter. The cage was the only surface arguing otherwise.

    **WHERE THE STORM IS NOW is not height's question.** The live fix carries
    the spiral glyph and is the only point that does, so the present position
    stays unmistakable without borrowing severity's channel.

    **ONE GLYPH PER STORM, ALWAYS.** Every point lifts and tints the cage but
    only the live fix carries `head: true`, and only head points draw a
    surface spiral. Twenty beads stamping twenty spirals would not be a
    cosmetic bug, it would be a false count of live systems.

    **THE TWO SOURCES ARE NOT EQUALLY HONEST HERE.** NHC publishes a MEASURED
    wind at every past position (`intensity`) and every forecast position
    (`maxwind`), plus its own `ss`/`ssnum` — so an NHC ridge is measured bead
    by bead. GDACS publishes NO wind number anywhere on its track, only a
    TD/TS/HU code, so a GDACS bead's color is the source's own reading while
    its height falls through to `representativeKt()`. That is the same
    stand-in the current fix already used, applied per position — real
    information (a depression stretch reads lower than a hurricane stretch)
    built on a derived number. It is never displayed, so §5 holds. **The §15
    wind-field work will not fix this**: GDACS's timestepped footprints begin
    at the current analysis time, so band containment can measure a floor for
    the head and forecast steps, never for history.

    **PERFORMANCE.** The influence loop is nodes x points, and the point count
    went up ~20x. Points beyond `DIVE.influenceCutoffSigma` sigmas are now
    rejected on a dot product instead of paying for the `acos` inside
    `angleTo` — beyond 3 sigma a point's contribution is under `baseLump` and
    was never visible. The cutoff cosine is DERIVED from `stormSigma`, so
    widening the peak widens the reject radius with it.

  - **Storm-lit triangle fill (built 2026-07-24).** Every cage triangle with at
    least one storm-lit corner carries a low wash of that storm's color;
    everything else is fully transparent. It exists to make a storm read as a
    PRESENCE IN AN AREA and not only as a spike — at a glance you see a region
    is involved before you resolve which node is tallest.
    - **It is a third reader of the one signal, never a fourth channel.** The
      fill shares `nodeGeometry`'s position attribute outright, so it is not a
      patch painted on the globe — it is the lattice's own surface, tenting up
      with the very nodes that carry it. Its color is the cage's resolved color
      and its alpha is the same lit ramp that decides the tint (`litAmount()` in
      `heightfield.js`). If a node is tinted, its triangles fill. They cannot
      disagree.
    - **Per-corner alpha, not per-triangle opacity.** A triangle with one lit
      corner fades to nothing across itself, the same GPU interpolation that
      already softens the edges. Filling whole triangles at a flat opacity would
      ring every storm with a jagged triangular fringe — the exact hard edge
      `stormColorOnset` / `stormColorFull` exist to prevent.
    - **Normal blending, not the nodes' additive.** Additive is what makes a
      node read as an LED, but the fill covers area, and additive over the lit
      near continents blooms into haze where the map must stay readable.
    - Drawn UNDER the cage (`renderOrder` 1) with `depthWrite: false` — the
      lattice reads on top of the wash, and a fill that wrote depth would
      occlude the lattice it is built from. Fades on the cage's own schedule.
    - Outage behaves like everything else: shape held, color muted grey.
    - One token: `OPACITY.meshFill` (peak alpha). **Set it to 0 to retire the
      fill outright** — that is the off switch as well as the tuning knob.
    - Measured cost: at `geoDetail` 3 the mesh is 642 nodes / 1,920 edges /
      1,280 triangles. One settled Cat 4 lights 24 nodes and 65 triangles — 5%
      of the mesh, one extra draw call, no index rebuild when storms move.
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
- **Dark by default** (night-sky globe). **Light mode shipped 2026-07-26** —
  Dark / Light / Automatic in Settings, stored in the `settings` record, default
  Dark for everyone regardless of the device. Dark is what the app looks like
  and what a shared link should open on; automatic is available, not leading.

  It is **not an inversion**, and the places it refuses to invert are the ones
  worth knowing before editing it:
  - The cage, the coastline and the nodes go **darker** than their surface, not
    lighter. A glowing line on a night sea becomes a drawn line on a pale one.
  - The 3D globe's far continents, coastline and nodes drop **additive
    blending** in light mode. Additive can only add light, which is the right
    read against a dark sky and invisible against a bright one. This is the one
    place the two themes need different mechanics rather than different numbers.
  - The chosen segment of a control goes **down** in lightness and up in
    saturation. A step further toward white is a step toward invisible.
  - The install amber is a **different amber**: `#F0B23C` on a white panel is a
    1.6:1 boundary, i.e. a button with no edge.
  - **Space is not black.** A globe in daylight against a high-altitude sky.
    There is no starfield in daylight.

  Mechanically: `config/theme.js` owns which palette is live and nothing else
  (no DOM, no preference store, so `tools/` can import it). Everything that
  draws calls `palette()` at paint time and never caches it. A theme change
  rewrites the CSS custom properties (which repaints the entire interface for
  free — every panel is already written against them), calls `retheme()` on the
  3D globe, and hands MapLibre a freshly-built style object. `index.html`
  carries a pre-paint inline script, pinned in the CSP by hash, so a light-mode
  device never flashes the dark globe on a cold load.
- **Floating menus**: panels float over the globe (glass/translucent), globe
  visible behind. No full-screen page takeovers.
- **Beautiful AND informative** — equal billing. Animation polish where it
  helps: camera flyTo on selection, panel enter/exit, layer fades. Animate
  transform and opacity only.
- **Idle globe rotation**: gentle auto-rotate when untouched; stops instantly
  on interaction. **Storm selection counts as interaction** — panels are
  off-canvas, so `main.js` must interrupt the drift explicitly before flyTo, or
  the drift's per-frame setCenter stomps the running camera animation and
  selection goes dead.

  **THREE SETTINGS AS OF 2026-07-25** — on/off, speed, and resume delay — and
  the old `[DECIDE]` on those two numbers is closed by making them the user's
  rather than by picking better ones. The right answer is personal: the same
  drift that makes the globe feel alive to one person makes it feel like it
  will not sit still to another. The constants file still owns what "sensible"
  means (they are the defaults); `data/settings-prefs.js` owns what was chosen.

  - **Speed applies mid-drag**, because the step function reads its config
    every frame — so you can aim the slider at a speed you like while watching
    it.
  - **The two sliders DISAPPEAR when the toggle is off**, rather than dimming.
    A deliberate exception to §7's "rows dim, they never disappear": that rule
    protects LAYER rows, where a missing toggle is indistinguishable from a
    missing feature. Nothing is hidden here — the switch that brings them back
    is the line directly above the gap and is plainly off. They are `hidden`
    AND `disabled`: the attribute takes them out of the tab order and the
    accessibility tree, and the disable is the belt-and-braces against a stray
    `display` rule re-exposing a focusable control nobody can see (§13).
  - **Turning it off stops the globe immediately**, not at the next interrupt.
    A switch labelled "rotate when idle" that leaves the globe rotating is the
    switch lying.
  - **OS reduce-motion still overrides all three.** `attachIdleRotation`
    returns its inert handle before it reads a single setting: the OS
    preference is an accessibility request, not a default for an app toggle to
    beat. The handle still exposes `setConfig` so the subscription in main.js
    has something harmless to call.
  - The speed slider's floor is deliberately above zero. "Off" is the toggle's
    job, and a speed that can reach zero gives two ways to stop the drift, one
    of which leaves the toggle lying about the state.
- **Imagery playback — CUT TO v2.0 (2026-07-25, Aaron's call).** A play button
  animating radar/satellite through recent timestamped frames, with a
  scrubber. Heaviest feature in the app; only ever runs on explicit press.
  Phase 7 shipped the still frame instead, refreshing itself every five
  minutes while the app is on screen. Still open when it is picked up:
  `[DECIDE]` loop length (frame count / time span) and preload strategy, and
  **the blocker §4 records — requesting a specific timestamp from GIBS returns
  empty frames unpredictably, so playback cannot simply step backwards from
  now.** It has to read each layer's advertised time values first.
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
| **z0–2 · Planet** | Solid continents under the cyan node cage; far side dimmed through the clear ocean; grey coast | Category-color glyphs; **severity read as node elevation AND node color** (the cage peaks over storms and takes their color, fading back to cyan across the lattice), plus a low storm-color wash inside every lit triangle. No labels. |
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
- **The limb radius is MEASURED, never derived.** `limbRadiusPx()` walks the
  great circle out from the view centre through home and bisects on
  `isOccluded` for the arc where the renderer stops drawing, then projects that
  point. `readFrame` calls it once per frame and carries it as `limbPx`.
  **Anything needing a limb radius reads `f.limbPx`. Never `R`** —
  `measureGlobeRadiusPx` returns px per radian of arc at the screen centre,
  which is a different quantity and vastly overshoots the rim up close.
- **MapLibre does not clip at the geometric horizon, and that is why the closed
  form had to go.** Its clipping plane sits deliberately past the tangent, at
  `cos = 1/(d+1)` rather than `cos = 1/d` — verified against
  `isLocationOccluded` at every zoom 0→11.5, exact to two decimals. The old
  `limb = nearScale·(d−1)/√(d²−1)` answered the tangent question instead. Far
  out the two agree within a percent and nothing looked wrong; up close they
  diverge without limit. Measured on a 390×844 viewport: at zoom 3 the formula
  gave 379 px against a real rim of 509 px, and by zoom 3.5 it had **collapsed
  to 312 px while the real rim grew to 650 px** — the off-screen pointer
  visibly walking inward, toward the middle of the screen, as you zoomed in.
  At zoom 4 a `d <= 1` guard returned the near-centre scale instead, which
  overshoots so hard that `limbOnScreen` reads false and the pointer snaps back
  to the viewport edge. **It looked self-correcting because it was failing in
  the other direction.**
- **The same error was the tether's horizon snap.** The foot follows the
  anchor's true projection until the anchor occludes, then clamps to `limbPx`,
  so the two must agree at that instant or the foot jumps. The derived
  silhouette missed by 3.3 px at zoom 1 and more with zoom, always inward —
  which on glass read as the marker floating slightly above the surface and
  then snapping down onto it at the horizon, plus jitter whenever the camera
  dithered across the boundary. Measuring makes them agree by construction:
  the limb point at the crossing IS the anchor, so the foot does not move.
  Verified frame-by-frame across the crossing — 3.30 px before, 0.00 after,
  0.025 px worst case within ±20 steps.
- **The durable rule: one question, one oracle.** `isOccluded` decided *when*
  to hand off while a formula decided *where* to draw. Two answers to "where is
  the edge of the globe" that agreed at the zoom they were checked at and
  drifted apart everywhere else. If the renderer will answer a question, ask
  it — a derivation is a second copy of somebody else's camera, free to go
  stale. This also buys pitch for free, which the closed form ignored.
- **Cost, measured, not assumed:** 12 µs per frame for an 18-step bisection —
  0.07% of a 60 fps budget, on software rendering. Each step is one
  plane-dot-product, no projection and no allocation inside the loop.
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
- **SO IS THE FLOATING HOUSE** (as-built 2026-07-25). Until then home off
  screen was tappable and home right in front of you was not, which is
  backwards — "take me to my house" is the most obvious thing to want from a
  house drawn on a globe, and the affordance was missing precisely when the
  target was visible. The two buttons answer **different** questions and so do
  different things: the pointer means "home is off screen, show me where" and
  is a rotation at the current zoom; the house means "take me there" and
  commits to `GLOBE.homeZoom` (6 — inside the regional band, close enough for
  the coastline around home to have shape, far enough out to still see a storm
  two states away). Flying to a point already on screen without changing zoom
  would be nothing visibly happening.
  Sized to the 44 px touch target with the glyph centred inside, since the
  house mark is smaller than a fingertip. It leaves the tab order whenever the
  marker is not in `ON_GLOBE` — the same keyboard trap in mirror image. The
  tether and anchor dot stay inert: they are a claim about a location, not
  controls.
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
Shown between picking a candidate and confirming it. Dashed and hollow where
the real marker is solid and filled, so the two can never be confused — a
provisional pin that looked like a set home would tell the user they had
finished when they had not. Draggable, because a geocode result is a GUESS:
Mapbox puts rural addresses on the road and postcodes on a centroid. Dragging
is the correction path.

**A dragged pin drops its address label** and its source becomes `pin` —
keeping the searched label would name a place the home no longer is. **The
confirm step's label follows the pin live** (as-built 2026-07-25): once dragged
it switches to coordinates, because commit already refuses to store the old
label and showing a street name the user is about to lose is a small lie told
at the exact moment they are deciding.

**THREE DOORS INTO SETTING A HOME, not two.** Geolocation needs permission,
search needs the geocoder to know the road, and neither helps someone down a
lane Mapbox files in the wrong parish. **"Drop a pin on the globe"** puts the
provisional pin at the centre of the current view and goes straight to confirm.
It does NOT change zoom — the pin belongs where the user is looking, and
pulling the camera to a fixed confirm zoom would move the ground out from under
the thing they just placed. It carries no label (coordinates stand in) and is
marked low-confidence, which is what makes the confirm copy tell them to drag
it. It was previously reachable only AFTER a successful search — the one
situation where you least need it.

**SCAR — the search path was dead for a while and nobody could tell.** When the
listeners were gathered into `wire()`, `pick()` was swallowed into that
function's scope. `renderResults()` sits outside it, so every tap on a search
result threw `ReferenceError: pick is not defined` into a console no phone user
will ever open. Results listed, tap did nothing, setting a home by address was
impossible. Found by driving the deployed site in Chrome on 2026-07-25.
**The general rule: a handler that only fails on click fails silently.** Syntax
checks and import resolution both passed the whole time — the reference was
legal, just unreachable. This is the class of bug `tools/headless-check.mjs`
exists to catch, and why the check clicks things rather than only reading them.

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
- **A storm with NO category index sizes on its class floor, not on TS.** A
  GDACS hurricane legitimately has `category: null` and `categoryCode: 'HU'`
  (§4), and a plain coalesce-to-1 drew every unclassified typhoon at tropical
  storm size — the least severe reading available, on the surface a thumb aims
  at. `map/markers.js` resolves a `sizeRank` per feature instead: `HU` with no
  index takes the Cat 1 floor, anything else with no index stays at TS. The
  floor understates a real Cat 4, which is the honest direction to be wrong —
  every alternative asserts a strength the source never stated (§5).
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
- **The on-screen keyboard is measured, and the sheet gets out of its way**
  (`ui/keyboard.js`, built 2026-07-26). A fixed element is positioned against
  the LAYOUT viewport, and neither iOS nor Chrome-for-Android shrinks that when
  the keyboard opens — they shrink the VISUAL viewport. So the drawer's
  `bottom: 0` meant "behind the keyboard": tapping the address box left you
  typing into something you could not see. `watchKeyboardInset()` publishes the
  overlap as `--keyboard-inset`; panels.css lifts the sheet by it on TRANSFORM
  (never `bottom` — the keyboard animates for a quarter second and a layout per
  frame lands on top of MapLibre) and clamps `max-height` so the lifted sheet
  cannot run off the top. The rail layout ends at `bottom: var(--keyboard-inset)`
  for the same reason.
  - **Chrome's `interactive-widget=resizes-content` was REJECTED.** It fixes
    this in one line on Android and does nothing on iOS, and the way it fixes
    it is by resizing the layout viewport — which reflows the MapLibre canvas
    and re-renders the globe every time a text field is tapped. Not worth it.
  - **The reveal hangs off the KEYBOARD MOVING, not off `focus`.** The drawer
    focuses a view's first control the moment the view opens, so the address
    box is already focused before any listener could run, and tapping a field
    that is already focused fires no event at all. `onKeyboardInset()` is the
    subscription that actually fires at the right moment; the `focus` listener
    remains only for the no-keyboard cases (a desktop click, a Tab, a
    Bluetooth keyboard).
  - **No padding hack for scroll room.** An earlier pass padded the drawer body
    while the keyboard was up so the input could always scroll to the top; it
    worked and it left a third of the panel visibly dead. The results list is
    the scroll room — it appears exactly when scrolling to the top is what
    anyone wants, so the reveal re-fires when results render instead.
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
`basemap` source points at `TILES.openFreeMapStyle` and `style.js` draws
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

**Reviving R2 is one flag.** `style.js` and `coast-source.js` still carry
the Protomaps path; set `TILES.useR2` true to switch back. The archive, the
`TILES_BUCKET` binding, and the proxy are untouched, and the client never reads
the pmtiles format — the library is vendored server-side at
`functions/tiles/_pmtiles.js`. If the archive is ever regenerated, bump a `?v=`
on `TILES.tilesUrl` rather than trusting caches to notice.

**Fonts come from OpenFreeMap either way.** `glyphs` in `style.js` points
at OpenFreeMap's font endpoint regardless of `useR2`, so text layers — storm
name labels, live since Phase 2 — fetch glyphs from OpenFreeMap. Self-hosting
fonts is an open decision (§15), not a bug.

### Administrative furniture — borders and place names (built 2026-07-24)

Four layers, all drawn from OpenMapTiles data **already inside the tiles we
download**: `boundary` (lines, keyed by `admin_level`) and `place` (points,
keyed by `class` and `rank`). No new source, no new request, no new bytes.

| Layer | Data | Appears |
|---|---|---|
| `admin-country` | `boundary`, `admin_level` ≤ 2 | z2.4 |
| `admin-state` | `boundary`, `admin_level` = 4 | z3.4 |
| `place-country` | `place`, `class` = country | z3.4, gone by z5.0 |
| `place-state` | `place`, `class` in state/province | z4.2 |
| `place-city` | `place`, `class` in city/town, ranked | z6.4 |

- **Nothing at the planet band.** z0–2 belongs to the mesh (§9 zoom ladder).
  Each mark arrives as late as it can still be useful.
- **Borders draw UNDER the coast, names OVER it.** Same rule as the graticule:
  a reference line crossing a glowing coastline reads as an error, but a label
  buried under one is not a label.
- **Maritime boundaries are stripped everywhere** (`maritime != 1`). The
  `boundary` layer carries sea borders that strike out across open water, and
  beside a forecast cone such a line reads as though it means something.
- **`rank` IS the definition of "major".** The schema ranks notable cities 1–10
  and leaves everything else unranked, so requiring a rank is a real category
  rather than an arbitrary cutoff. `ADMIN.cityRankMax` is the knob.
- **No city dots, deliberately.** Storm glyphs, forecast points, and the home
  marker are already three kinds of dot that each mean something specific. A
  fourth meaning "a place exists here" would be read as storm data at a glance.
- **Never below state level.** Counties and districts are in the schema and are
  never drawn — past state level this becomes an atlas, not a storm map.
- **BORDER LINES ARE PERMANENT. Only NAMES toggle.** Neither the country nor
  the state/province line has a control, and that is the design: borders are
  structural — hairlines that cost almost nothing visually and answer "which
  state is this" simply by existing. TEXT is what clutters a map, so text is
  what the Reference toggles remove. Both lines live in `LAYER_BASELINE` so the
  inventory stays honest about what is drawn.
- **Two toggles, in Reference: `stateNames` and `cities`.** Both default ON,
  both `fetches: false` — the data is inside tiles the basemap already pulls,
  so neither row can ever go amber. Visibility goes through `setAdminVisible`
  in `style.js`, deliberately the same shape as `setGraticuleVisible`
  (§12: one mechanism for basemap visibility, not a second one that drifts).
  **`setAdminVisible` must never be given a line layer.** It addresses
  `place-state` and `place-city` only; handing it `admin-state` is how the
  permanence rule above gets quietly broken.
- **Cities arrive at z6.4**, close to the local band. Walked out twice on
  glass: 4.6 → 5.4 → 6.4. Both earlier values put names on screen while the
  question was still "which storm" or "which state". Decluttering is done by
  ZOOM first and the toggle second.

#### The name ladder — each rung overlaps the last (built 2026-07-24)

The globe is never a nameless shape. As you zoom the map DISSOLVES from one
label to the next rather than switching: each name starts rising while the
thing before it is still on screen.

| | Zoom |
|---|---|
| Node mesh (cage) fades out | 2.48 → **3.86** — *derived*, not chosen |
| Country names rise | 3.40 → 4.00 |
| Country names hold | 4.00 → 4.40 |
| **State names rise** | **4.20** → 4.90 — *begins before country starts leaving* |
| Country names fall | 4.40 → 5.00 |
| Cities rise | 6.40 → 7.20 |

Measured overlaps: mesh and country share the screen z3.42–3.74; country and
state share it z4.22–4.98.

- **`ADMIN.nameLadder` holds all six numbers**, as three `[start, end]` bands.
- **These used to be ONE shared band** — country ran 1→0 and state 0→1 across
  the same pair, which made them structurally incapable of drifting. That was
  given up deliberately: a shared band can only ever produce an EXACT
  crossfade, and the effect wanted on glass is an OFFSET overlap with both
  names briefly up together. Independent bands are the only way to express it.
- **So the guarantee moved from "impossible to break" to "stated and checked":**

  > **THE INVARIANT — NEVER A NAMELESS GLOBE.** From the cage starting to
  > dissolve until cities arrive, at least one name is on screen at every zoom.
  > `countryIn` must start before the cage is gone; `stateIn` must start before
  > `countryOut` ends.

  Move any of the six and **re-sample the whole range**. A gap is invisible in
  the constants and obvious on glass.
- **`countryIn[0]` is DERIVED from `fade.cage`. RECHECK IT if the DIVE
  choreography is ever retimed** — it is not an independent number.
- The country layer carries a `maxzoom` at the end of its fall, so past it
  MapLibre stops laying out text that is already invisible.
- **Country names have NO TOGGLE** — the one exception to "text is what
  toggles". They are a rung on the ladder, not decoration: for about a zoom
  level they are the only label on the map, and switching them off would leave
  a bare unnamed globe in exactly the band the ladder exists to fill. A control
  whose off state breaks the design's own invariant should not exist.

#### `to-number` on a missing property is 0, not null (cost a shipped bug)

`boundary` holds administrative borders as **linestrings** and aboriginal lands
as **polygons** — one layer, two different things. A line layer handed a
polygon draws its outline.

The country filter shipped as `admin_level <= 2`. Aboriginal-lands polygons
carry no `admin_level`, `to-number` turns a missing property into **0**, and
`0 <= 2` is true — so every one of them drew as a national border and carved
Oklahoma into pieces. Caught on glass 2026-07-24.

Three rules came out of it, and they apply well beyond this layer:

- **Never write an open-ended comparison against a property that might be
  absent.** Match the value EXACTLY. `0` can equal neither 2 nor 4.
- **Guard with `has` when a filter's correctness depends on the property
  existing.** It is not defensive noise; it is the difference between a filter
  that means what it says and one that silently admits everything.
- **Filter on `geometry-type` when a source layer mixes geometries.** It is
  structural and survives schema changes that rename attributes.

Both border layers now carry all three plus the maritime and aboriginal-lands
exclusions. There is no toggle for tribal boundaries: they are not
administrative borders in this map's sense and drawing them as such misstates
what they are.
- One color block (`DARK.adminState` / `adminCountry` / `textState` /
  `textPlace`) and one tuning block (`ADMIN` in `constants.js`). The hierarchy
  is steep and deliberate: storm names > city names > state names > country
  lines > state lines, and every one of them sits below the coastline.
- **OpenMapTiles only.** The Protomaps path has its own boundary schema and
  does NOT get these. If R2 is ever revived they need writing against that
  schema, not copying (see the schema warning below).

#### Label collision order is free, and it is load-bearing

**Verified against the pinned MapLibre 5.6 source, not assumed.**
`PauseablePlacement` starts at `order.length - 1` and counts DOWN, so symbols
in the **top** layer are placed first and win every collision beneath them.
Storm names and forecast labels are added above this style, so they beat
basemap labels automatically — no sort keys, no z-order juggling, no
coordination between the two systems.

Within a layer, `symbol-sort-key` decides, and both place layers sort on the
schema's own `rank`. In a crowded basin the small places fall out and the big
ones survive. That is why city labels need no per-zoom rank ladder: one filter
admits every ranked city and collision does the thinning at every zoom.

**One consequence, and it required a change.** Forecast time labels ran
`text-ignore-placement: true`, which kept them out of the collision index
entirely — so a city name would render underneath one and both would be
unreadable. Now `false`. The two flags are independent: `allow-overlap: true`
still guarantees the forecast label draws no matter what, while
`ignore-placement: false` makes it reserve its space. **This cannot cause a
forecast label to disappear.**

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
sheets visible. `style.js` carries two separate layer builders rather than a
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
- **TWO preference stores, deliberately** (2026-07-25). `data/layer-prefs.js`
  enforces two guarantees a display setting must not inherit: an unshipped
  LAYER can never be switched on, and exclusive pairs validate against the
  layer manifest. `data/settings-prefs.js` has no phase and no manifest.
  Merging them would mean inventing a fake layer entry or punching an
  exception through the guard that store exists to be — and a guard with an
  exception is not a guard. The guarded-storage / subscribe / emit shape is
  duplicated across the two as the honest cost of keeping them separate. **A
  THIRD preference store is the moment to extract a shared factory**, not
  before.
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
config/     constants.js  tokens.js  motion.js  theme.js  layers.js
                                                       (imports nothing)
lib/        units.js  geo.js  time.js  category.js    (pure functions)
data/       relay.js  nhc.js  nhc-mapserver.js
            gdacs.js  merge.js  cache.js  store.js    (no DOM, ever)
map/        globe.js  style.js  graticule.js
            markers.js  coast-band.js
            layers/registry.js  layers/*.js
ui/         drawer.js  view-storms.js  view-storm-detail.js
            view-layers.js  view-home.js  view-settings.js
            status.js  keyboard.js
main.js     wiring only — target under 100 lines
```

**Built so far** — this list is generated from the tree, not from memory. It
was months stale once already (it still named `ui/panel-*.js` long after the
drawer refactor renamed them all to `ui/view-*.js`), so check it against
`find . -name '*.js'` before trusting it.

```
config/     constants.js  layers.js  motion.js  theme.js  tokens.js
lib/        bandmerge.js  basin.js  category.js  geo.js  imagery.js
            imagery-paint.js  ringpolish.js  simplify.js  time.js
            track-point.js  units.js  watchwarning.js  wind.js
            windswath.js
data/       cache.js  gdacs.js  gdacs-geometry.js  gdacs-points.js
            geocode.js  home.js  layer-prefs.js  merge.js  nhc.js
            nhc-mapserver.js  relay.js  settings-prefs.js  store.js
            warm.js
map/        attribution.js  chrome-avoid.js  coast-band.js
            coast-band-cache.js  coast-source.js  coastline.js  globe.js
            globe3d.js  glyph.js  glyph-home.js  graticule.js
            heightfield.js  imagery.js  marker-home.js
            marker-home-geometry.js  markers.js  pin-provisional.js
            storm-mesh.js  style.js
map/layers/  cone.js  index.js  label-placement.js  points-forecast.js
            registry.js  track-forecast.js  track-past.js
            watch-warning.js  wind-field.js
ui/         drawer.js  status.js  view-home.js  view-layers.js
            view-settings.js  view-storm-detail.js  view-storms.js
            home.css  panels.css
root        main.js  index.html
tools/      check-syntax.mjs  contrast-check.mjs  csp-hash-check.mjs
            token-check.mjs  headless-check.mjs
            (+ the per-feature test scripts)
```

**Pages Functions — seven routes**, all self-contained on purpose: Pages
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
| `api/imagery/radar.js` | relay job 4 — the ONE imagery hop; radar sends no CORS and the client must read its pixels |
| `api/imagery/inspect.js` | read-only vendor probe — takes no parameters at all |

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

**Layer ids are FIXED, and there is nothing left to resolve.** The app reads
the summary service, which publishes one flat set of products, so
`nhc-mapserver.js` holds nine constants (`SUMMARY_LAYER`) and asks for them by
number. The block math, the cached metadata fetch and the resolve-by-name pass
that used to live here are gone — see §4's inventory for what they were and
what went wrong with them.

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
- **`map/imagery.js` IS A LAYER AND IS DELIBERATELY NOT IN THE REGISTRY.** The
  engine exists for GEOMETRY arriving in a per-storm bundle: it merges GeoJSON
  features across warmed storms and hands each definition a feature list.
  Imagery has no features — it needs each storm's POSITION to address a
  request and draws one raster source per storm. Registering it would mean
  widening the engine's contract for a single caller, and "adding a layer means
  adding a file, never editing the engine" is worth more than having every
  layer in one folder. It follows `markers.js` instead: a `map/` module that
  takes storms in through `update()` and is wired by `main.js`. Its imagery
  PAIR is pushed on the same one-call `applyLayerState()` path as the engine's
  pairs, so there is still exactly one route from a layer choice to pixels.

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
land fill → imagery → graticule → coastline glow →
cone → wind field/swath → model tracks → past track → forecast track →
[coastal pair: watch/warning stripe OR surge bands] →
forecast points → storm dot → home marker → labels → off-screen pointer
```

**IMAGERY MOVED ABOVE THE LAND FILL (2026-07-25).** It sat below it, inherited,
until Aaron changed it — and the reason is the whole app. At landfall, the
moment this thing exists for, cloud painted under the land polygon means the
eyewall disappears exactly as it comes ashore. Continuous cloud across the
coast is the point. It still draws below the coastline glow, the borders, the
labels and every piece of storm geometry, so the map stays readable through it.
Imagery is not in the registry (§12), so it is inserted by name against
`coast-glow` rather than by an `order` number.

The middle of that list is the `order` field on each layer definition, and the
numbers are the checkable version of it — `map/layers/registry.js` sorts on
them, nothing else:

| Layer | File | `order` |
|---|---|---|
| Cone | `layers/cone.js` | 10 |
| Wind field / swath (pair) | `layers/wind-field.js` | 15 |
| Model spaghetti tracks | `layers/model-tracks.js` | 18 |
| Past track | `layers/track-past.js` | 20 |
| Forecast track | `layers/track-forecast.js` | 30 |
| Watch/warning coastal (pair) | `layers/watch-warning.js` | 40 |
| Forecast points | `layers/points-forecast.js` | 50 |

Everything above 50 in the prose list is not in the registry at all: the storm
dot, the home marker, labels, and the off-screen pointer are separate modules.
The registry inserts its whole stack `beforeId: 'storm-dot-planet'`, which is
what holds them above it.

- **Past track and forecast track are two layers drawing ONE curve.** Both slots
  are rebuilt together by `lib/trackline.js` before either layer sees them, and
  they share the vertex at the current position. Changing one layer's geometry
  in isolation is therefore always wrong — the join lives upstream of both
  (see "The track line" in §7).

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
   three failure states built and exercised in headless tests. Row/dot
   activation flies the camera and opens the storm detail panel (Phase 4).
   (Rows became two-line — name on its own — on 2026-07-25, once home
   distances proved they crowded the name off a 340px rail.)
3. **Home — DONE. Deployed and confirmed on a real phone.** Location set three
   ways (geolocation, Mapbox address search, drag-a-pin — never prompted on
   first launch); home marker as a house glyph floating above the lattice on a
   zoom-scaled altitude curve, tethered along the surface normal to its exact
   surface point; off-screen pointer (house + arrow on one axis) riding the limb
   with a bob and routing around on-screen chrome; distance on every storm row;
   storm list flips to nearest-first within basin order. (The scope filter
   shipped here with all three scopes and was **removed 2026-07-25** — see §16.
   The floating house became a tappable button in the same pass, and a
   drop-a-pin door was added that does not require a successful search first.)
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
   - **Settings view CARRIES ITS FIRST REAL CONTROL (2026-07-25)** — mesh
     height, `current` / `full track` (§9). It reuses the Layers panel's
     `.seg-group` segmented control verbatim, so the focus ring, 44px target
     and ARIA come with it. `data/settings-prefs.js` persists the choice; the
     cage subscribes in `main.js`. **It has since grown the units override, the
     globe-drift controls, the imagery sliders and the install door** — the
     file filled in rather than a second panel arriving, which is what it was
     stood up early to make possible. **The theme control landed 2026-07-26 and
     the panel has no stubs left.**
   - **`MAPBOX_TOKEN` IS SET in Cloudflare Pages and address search is LIVE —
     confirmed by Aaron on glass 2026-07-25.** All three home paths
     (geolocation, address search, drag-a-pin) now work. The
     `geocode_not_configured` code and its copy stay in place as the honest
     state if the variable is ever cleared or the key is revoked — a §5
     failure path, no longer the shipped condition.
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
   toggle/retry rows under a real outage. Label density is now judgeable —
   the spoke axis is fixed (§7) and placement thins on its own — so the open
   question is whether a westward storm's thinned labels read as deliberate
   or as missing data.
5. **PWA — DONE. Deployed and confirmed working on glass 2026-07-25.**

   What shipped: `manifest.webmanifest` (standalone, dark, id/start_url/scope
   `./`); the icon set in `assets/icons/` (192/512 transparent purpose-`any`,
   192/512 maskable at 72% over a solid backdrop — survived a simulated
   Android circle crop with the full spiral intact — 180×180 flattened
   apple-touch-icon, 32px favicon), regenerated by `tools/make-icons.py`
   (Python + Pillow, tooling not toolchain — the PNGs are committed);
   `sw.js`; `pwa.js` (registration after `load`, its own file — main.js is
   wiring only); and the head wiring in `index.html` including the apple-*
   metas and a black-translucent status bar.

   **DELIBERATE DEVIATION — app code is NETWORK-FIRST, not
   stale-while-revalidate.** The roadmap's SWR shorthand would serve the OLD
   copy first on every load, which on this project's push-then-check-the-phone
   loop guarantees "pushed the fix, phone still shows the bug" every single
   deploy. Network-first costs nothing while online and falls back to cache
   offline. SWR's spirit survives where it is safe: pinned CDN URLs
   (unpkg) are cache-first because a version-pinned URL cannot mean
   something new.

   **DATA IS NEVER TOUCHED BY THE WORKER.** `/api/`, NOAA, GDACS, OpenFreeMap
   tiles and fonts all pass straight through. Freshness, staleness banding,
   and the §5 three-state distinction belong to store.js; a cache below it
   cannot tell "stale but honest" from "stale and lying". `/tiles/` is also
   excluded so a revived R2 proxy (§3) cannot silently grow unbounded cache
   quota. Verified headless: zero `/api/` entries in the cache after a
   controlled load.

   **NO PRECACHED FILE LIST, by the spec's own documentation argument:** with
   no build step a hand-maintained module list WILL go stale. The runtime
   cache captures what the app actually loads, so offline works from the
   first CONTROLLED load — install, open once, offline works. Precache floor
   is `./` + manifest + one icon. SW constants live at the top of `sw.js`,
   not `config/constants.js` — a worker cannot import the app's modules;
   contained, documented Tuning deviation.

   **THE iOS BACKDROP IS OCEAN `#070D18`, NOT THE ICON'S NAVY — judged by
   eye, both rendered.** The spiral's arms ARE `#173B5F`; on a navy backdrop
   half the artwork vanishes. The earlier "navy filled in behind it"
   instruction is superseded. Maskable icons use the same backdrop, so the
   two platforms match.

   Headless verification (Chromium, local server): manifest 200, worker
   activates, page controlled, runtime cache populated, no data cached,
   offline reload serves the shell. Confirmed on glass by Aaron the same day.

   **One path is confirmed only by construction, not by eye: Chromium's
   `beforeinstallprompt` Install button.** It cannot fire on iOS at all, so
   an iPhone check does not exercise it. Costs one Android open to close.

   **FIRST-RUN NUDGES — BUILT 2026-07-25 (`ui/first-run.js`, §1's
   for-the-masses direction made this Phase 5 scope).** Two one-time hints,
   sequenced, never nagging — each shows once ever; acting, dismissing, or
   reaching the same end through any other door retires it permanently
   (guarded localStorage, `STORAGE_KEY.firstRun`; NOT a third prefs store —
   no subscribers, no validated values; the §12 extract-on-third counter
   still stands at two).
   1. **Home nudge**: `FIRST_RUN.homeNudgeDelayMs` after boot — the entry
      moment belongs to the globe — a chip under the status strip: set your
      home, [Set home] opens the home view. It never touches the OS
      location-permission dialog, so §8's "never prompted on first launch"
      rule holds; the nudge is a signpost, not a prompt.
   2. **Install hint, gated on home being SET** — the moment the user has
      invested, not the first web visit. Capability-based, no user-agent
      sniffing (§10's rule applied to install): a captured Chromium
      `beforeinstallprompt` (seam in `pwa.js`, listener at module scope
      because the event predates the UI) gets a real [Install] button
      driving the native dialog; iOS Safari (marked by the `standalone`
      property EXISTING on navigator) gets one line of Share-sheet
      directions; a browser with neither signal cannot install a PWA and
      honestly gets nothing. Already-installed (display-mode standalone /
      `navigator.standalone === true`) shows nothing anywhere.

   **AND A PERMANENT DOOR IN SETTINGS** (added 2026-07-25). The nudge is
   one-time by design — a hurricane app that nags is the wrong brand — which
   left anyone who dismissed it, or whose browser announced installability
   after the moment had passed, with no way to install at all. Settings is
   exactly where someone goes looking for that button. **Same `pwa.js` seam,
   not a second one**; a second install path would drift from the first.

   **THE FIRST VERSION OF THAT ROW LIED, AND THE SCAR IS THE POINT.** It had
   four states and derived the last by elimination: no captured Chromium
   prompt, no iOS marker, therefore "This browser can't install web apps."
   Aaron hit it on Chrome for macOS, which installs PWAs perfectly well —
   `beforeinstallprompt` simply had not fired. Manifest, icons, HTTPS and
   service worker all verified good at the time.

   **`beforeinstallprompt` IS NOT A CAPABILITY TEST.** It is a notification
   that the browser is willing to show a dialog *right now*. It does not fire
   when the app is already installed, it does not fire on every load, and there
   is no API anywhere that answers "could this browser install me". **Absence
   of a signal is not evidence of absence of a capability** — the same shape of
   error as reading a dead feed as an all-clear (§5), which is why it belongs
   in this spec and not in a commit message.

   The row therefore never claims incapability. Three states:

   - **Installed** — genuinely detectable (`display-mode: standalone` /
     `navigator.standalone`). The whole block is REMOVED. This is the one
     honest exception to "rows dim, they never disappear": a disabled
     "Installed" button is permanent furniture offering an action that can
     never be taken again, with nothing to recover and nothing to explain.
   - **Ready** — a prompt is captured. The real button, opening the real dialog.
   - **Manual** — everything else. Not "you can't" but **here is how**, as
     numbered steps for iOS Safari / Android / desktop, chosen by capability
     shape (`standalone` in navigator, then `maxTouchPoints`), never by parsing
     a user-agent (§10). If the prompt lands later, the subscription upgrades
     the block in place.

   **Amber, not red, and its own token.** Aaron asked for red; red is spoken
   for by §6 (failure — dead feeds, errored layers, the status chip) and a
   call-to-action wearing it would mean red stops reliably saying "something is
   broken". `--install-cta` is also deliberately NOT `--stale`, which means
   "this data is older than it should be" — same family, separate name, so
   changing one never moves the other.

   Chip styling is `ui/nudge.css` — the status-chip glass language, tokens
   only, status strip always outranks it (truth above advice), 44px targets,
   focus rings, host is `aria-live="polite"`. Verified headless across four
   Chromium scenarios: no chip during entry; home copy after the delay;
   dismiss persists across reload; [Set home] opens the drawer and retires
   the chip; iOS marker yields directions with no button; installed app
   shows nothing. Confirmed on glass 2026-07-25 alongside the PWA itself;
   the Android Install-button path carries the same one-open caveat above.

   **Source artwork** (master for the icon set via `tools/make-icons.py`):
   - `assets/source/app-icon-512.png` — 512px, proper alpha cutout, navy
     `#173B5F` + teal `#298F94`. **This is the master for the whole icon
     set**; every file in `assets/icons/` derives from it and is regenerated
     by rerunning `tools/make-icons.py` if it ever changes.
   - `assets/source/hurricane-art-2048.png` — 2048px, 2.3 MB, and it has **no
     transparency at all**: a teal spiral on a solid white square. Every white
     pixel connects to the border (flood-filled to check), so knocking the
     background out is clean if it is ever wanted.

   **Vectorising is NOT needed for the PWA.** iOS home-screen icons must be
   PNG — it ignores SVG — and Android's maskable icons are PNG in practice.
   SVG would only buy a browser-tab favicon.

   **The hurricane artwork was considered as the mesh glyph and REJECTED.**
   `map/glyph.js` draws a white shape that the mesh tints per storm — one
   drawing serving every Saffir-Simpson category and the grey outage state for
   free. A full-colour bitmap cannot be tinted (multiplying teal by a category
   red gives mud), and reducing it to a white silhouette throws away the
   colour that made it worth using. It also does not survive the size: rendered
   at the 12–24 px the glyph actually occupies on a phone, the drawn spiral
   holds its two arms and the artwork becomes an unreadable lump. It is a logo,
   not a map symbol. Use it big — a launch/splash screen or an About panel —
   or not at all.
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
      **DELIBERATELY HELD FOR A STORM NEAR HOME (Aaron, 2026-07-25.)** Surge is
      the one layer whose whole value is the at-home read, and it is judged on
      whether the envelope lands where the water actually threatens a coast you
      know. Building it against a storm half a planet away means tuning the
      look with no way to tell right from plausible — the exact failure the
      wind-swath day cost (§15). This is a WAIT, not a blocker: the moment a
      storm is close enough to Aaron to read the result, this is the next build.
   4. Wind arrival — **FETCH layers `+15`/`+16`, do not compute** (§4).
      **HELD FOR THE SAME STORM, for the same reason** — arrival time only
      means anything measured against a place you can check.
   5. Model tracks with the per-model selector — **DONE. CONFIRMED ON GLASS
      2026-07-25** (Aaron). The layer draws, the per-model selector works, and
      the geometric back-half clip anchors guidance at the current dot.
      **NHC BASINS ONLY** — every GDACS storm still draws no guidance, because
      no `wp`/`io`/`sh` a-deck source has been found (§15). §14's both-sources
      rule is therefore NOT satisfied and this step stays on the roadmap.
   6. Advisory text — **DONE. BOTH SOURCES, CONFIRMED ON GLASS 2026-07-25**
      (Aaron, NHC and JTWC paths both, including switching between them).
      Not a layer: it is a collapsed section in the storm drawer
      (§16 item 7), and the layer-manifest row that used to claim otherwise
      is gone (§7).

      **NHC storms** get the Public Advisory (TCP), whole and raw. Two things
      about the URL, both measured through `/api/nhc/inspect?text=`:
      - **`publicAdvisory.url` IN `CurrentStorms.json` IS NOT USABLE.** It
        points at the bare slot page `/text/MIATCPEP1.shtml`, which on
        2026-07-25 served **Post-Tropical Cyclone Amanda, Advisory 22, June
        7** — a storm six weeks dead — while the feed beside it said Fausto.
      - The `/text/refresh/MIATCP{binNumber}+shtml/{bust}.shtml` path serves
        the current product, and its timestamp segment is a **CACHE-BUSTER,
        NOT A SELECTOR**: `000000` and `999999` both returned the live
        advisory, on both storms. The URL is built from `raw.binNumber`.

      The page is ~26 kB of site furniture around **exactly one bare `<pre>`**
      holding the whole ~2 kB product. NOAA **injects live `<a href>` anchors
      inside the product text** (the rip-current line), so the extractor
      strips inner tags and keeps their text — dropping it would silently
      delete a line the forecaster wrote.

      **GDACS storms get JTWC**, and that is the answer to §14's both-sources
      rule rather than an exception to it. GDACS itself publishes NO advisory
      text — checked in four places 2026-07-25 and recorded in
      `functions/api/jtwc/inspect.js`: the event list carries a one-line
      blurb, `geteventdata` has no narrative field at any depth, `documents`
      and `additionalinfos` are **both empty objects**, and `report.aspx` is
      eight headings of tables. But it names its source, and for NOUL-26 that
      source is `"JTWC"`.

      **The join is the NAME.** GDACS's `sourceid` — the field that would
      carry a designation — is an **empty string**. JTWC's product URL encodes
      a designation (`wp1126`) and no name. The two meet only inside each
      warning's own header: `SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//`. The
      RSS cannot close the gap on its own: measured, it carries **one item per
      REGION**, listing several storms' products at once, with no per-storm
      titles, no anchors, and no description text.

   The at-home **exposure timeline** stays computed rather than fetched: it
   is a home-intersection test against the forecast rings, not a published
   product. It depends on step 2's rings and step 4's arrival layers, so it
   lands after both.
   **Step 1 DONE** (`85c385f`): one drawer replacing three sibling panels,
   the layer manifest (`config/layers.js` — sixteen entries then, fifteen
   now that advisory text is correctly not a layer), the prefs store, the
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
   **Name matching is retired entirely as of 2026-07-26** — the summary
   service's fixed ids removed the class of bug rather than guarding it.
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
7. **Imagery.** BUILT 2026-07-25 — satellite and radar discs, four satellites
   across two vendors, one palette. See §4's imagery block for the measured
   facts and §13 for where it sits in the stack. **Playback and scrubbing were
   cut to v2.0 on Aaron's call**, and the layer ships as a single current
   frame that refreshes itself every five minutes while the app is on screen
   and the layer is on. That is not a stub: a still frame answers "what does
   it look like right now", which is the question, and the loop is a separate
   feature with a separate cost (frame buffers, preload, a scrubber, and the
   time-parameter problem §4 records as unsolved).
8. **Polish.** Idle rotation tuning, animation tuning, a11y audit.
   **Light mode and the color-contract audit are DONE (2026-07-26)** — see §6
   and §9. The audit produced `tools/contrast-check.mjs`, which gates both
   palettes against WCAG AA on every run and caught two failures in the
   SHIPPED dark theme (`textMuted` at 4.33:1 on glass, and the storm-name halo
   silently equal to the ocean color) that no amount of looking had found.
9. **Public launch — THE FULL PLAN LIVES IN §17.** Pass A (disclaimer, locked
   inspect routes, vendored CDN libs, `_headers`/CSP, telemetry) is the gate on
   sharing the link at all. Pass B is the KV + cron origin collapse. §17 also
   records what was REJECTED — Firebase, and any attempt to obfuscate the
   client — so neither gets re-proposed. **This phase does not wait for
   Phase 8.** Polish is taste; §17 Pass A is the difference between a personal
   project and something responsible to hand a stranger during a storm.

## 15. Open decisions — next session agenda

Everything remaining is measure-on-glass, except the open bugs below.

**DONE — GDACS current intensity feeds the cage, and the answer is the CLASS
MIDPOINT. Settled; do not reopen.**

GDACS publishes no current wind number. `severitydata.severity` is a FORECAST
PEAK (§4) and stays in `peakWindKt` — never reuse it for this. So the cage asks
`representativeKt()` (`lib/category.js`) for the MIDDLE of the stated class's
wind range, and height and node colour both come from that one number, which is
what keeps them from disagreeing (§9). Working and deployed.

**THE MIDPOINT IS THE DECISION, NOT A PLACEHOLDER.** Given only "this is a
hurricane", the expected wind is the centre of the band, not its lowest
possible value. That is the honest reading of a class label and it is the most
this source can support.

**REJECTED — deriving a measured FLOOR from band containment. Built and
reverted the same day (2026-07-25). Do not propose it again.** The idea was
sound on paper: GDACS's timestepped 60/90/120 km/h footprints do bracket a
storm's current intensity, and the containment test worked on live storms.
It fails on what it BUYS. GDACS's strongest band is 120 km/h = 64.8 kt, which
IS the Cat 1 floor, so every hurricane it publishes — Cat 1 through Cat 5 —
measures ">= 65 kt" and lands at the identical height. Measured live on
Fausto and Noul: both 65. So the floor separates nothing the midpoint did not
already separate, and it drops every GDACS hurricane from ~110 kt to 65, making
typhoons read SHORTER than before and shorter than a comparable NHC storm.
More defensible, less useful — and on a visual ramp, useful wins.

The tiers that CAN be told apart already are, through the class: TD, TS and HU
each land at their own height. That is the separation this source supports.

**`representativeKt` IS NOT A MEASUREMENT AND IS NEVER DISPLAYED.** It feeds
ranking and the visual ramp only; the detail panel still omits wind for a GDACS
storm rather than printing a midpoint as if the source had said it (§5).

**RESOLVED 2026-07-26 — the forecast time label spoke axis. THE TEXT WAS
NEVER ROTATED.** Every earlier pass computed a spoke vector and then drew
horizontal text parked at the end of it, so nothing radiated from anything.
The fix is `text-rotate` with the text anchored at the end nearest its dot,
and one shared shallow angle per storm capped at 45° (§7).

Three real bugs were found and fixed on the way and none of them was the
cause: the collision handling alternated sides label by label on a westward
track (seven changes in eight labels); the spoke length was measured to the
label's CENTRE, which put a sideways label on top of its own dot, visible on
Noul; and the dot-clearance test counted collision padding as ink, throwing
away labels for clearance they had.

**The lesson that cost three sessions.** Aaron said "angle" from the first
message and it was read as "which side" three times. When a report keeps
coming back after a fix that validated, re-read the original words before
re-reading the code.

**Ruled out by live measurement — do not re-investigate these.** Read directly
off the source in the browser with two storms up:
- `_o` survives `setData` as a genuine JS array of two finite numbers.
  `typeof` is `object`, `Array.isArray` is `true`. The transport works.
- The values are real 2D vectors, including true diagonals
  (`[-2.34, 0.34]`, `[-0.22, 2.35]`). Placement was emitting spokes all along.
- Therefore: not `text-offset` data-driven support, not the array form, not
  the Y sign, not the em conversion, not the globe projection.

**Fixed along the way, and also not the cause.** Placement grouped points by
storm on `stormId ?? STORMID ?? '_'` and NHC's 5-day points layer publishes
neither, so every point from every storm fell into one bucket and was placed
as a single track — the tangent at the seam between two storms was a chord
across an ocean. That was real and is fixed: the key is now `basin` +
`stormnum`, confirmed off a live feature, with `idp_source` as fallback and
`stormname` rejected (it carries intensity, so it changes when a storm
strengthens). Unattributable points are hidden rather than placed off a
borrowed neighbour, and each track is sorted by `tau`. Note `stormid` exists
as a queryable field on FOUR layers only (§4) — the wind products — and is
not returned in feature properties even there, which is why the guessed key
looked reasonable. The layers this grouping runs over are not among the four.

**Method note, earned four times over.** Every fix here that passed offline
validation failed on glass, because the isolation tests fed ONE synthetic
track and the variable that decided everything — the track's angle on screen
— was the one thing they held constant. Reading live feature properties in
the browser killed four standing suspects in one step; varying the input the
app varies killed the last one. Measure the running app first, then make the
fixture reproduce what you measured.

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

   **ACCEPTED CEILING — NOW SUPERSEDED, see the open GDACS wind item at the
   top of this section.** Every GDACS hurricane currently lifts to the middle
   of the whole hurricane range (~110 kt, between Cat 3 and Cat 4), so big
   typhoons read SHORTER than they did under the peak. That ceiling is a real
   limit of GDACS's CLASSIFICATION, which cannot separate a Cat 1 from a Cat 5.
   It is NOT a limit of GDACS's wind field: the timestepped 60 / 90 / 120 km/h
   footprints give a measured floor per storm (§4). The cage should read that
   floor. Until it does, the midpoint stands and the §6 rose carries "category
   unknown" in the color channel.

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
     the live confirmation.
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
5. **THE TRACK RIDGE IS BUILT AND CONFIRMED ON GLASS (2026-07-25, phone,
   live storms).** `track` mode feeds the seam each storm's past AND forecast
   positions, each at its own intensity (§9). Default is still `current`, so
   the ridge is opt-in from Settings. Confirmed working: the ridge draws, its
   colours read as real categories across the band, and glyph count stayed
   one per storm.

   **The taper shipped and was removed the same day** — see §9. Height is
   intensity and nothing else. Recorded here only because the LESSON is the
   reusable part: a channel that already carries one meaning cannot be lent a
   second one, and the tell was that colour and height stopped agreeing.

   **STILL OPEN — the ridge reads as a PLATEAU, not a path.** Measured on
   glass: it draws as one broad raised mass rather than a trail following the
   track. `DIVE.stormSigma` (~9 deg of arc) is wider than the ~2-3 deg a storm
   covers between 6-hourly fixes, so consecutive beads overlap almost
   completely and blur together.

   **DELIBERATELY NOT TUNED.** Narrowing sigma is a one-number change, but it
   is the SAME number that shapes the single-storm peak, which was itself
   tuned on glass (§9, `stormSigma` raised with `geoDetail` 3). Sharpening the
   ridge would spike every individual storm with it. That is a look to judge
   on a phone, not a value to pick from a sandbox. If it is taken, the honest
   option is a SEPARATE sigma for track beads versus the live fix — two
   constants, not one retuned.

   **Also still unmeasured:**
   - **Soup.** Fifteen storms with ridges is the case that could turn the
     globe illegible. `MESH_TRACK.pastHours` / `forecastHours` are the dial;
     72 was picked from a map, not from glass.
   - **Frame cost on the settle.** The ridge recomputes when a bundle lands,
     not per frame, but that is ~20x the points through the influence loop.
     Watch for a hitch as geometry arrives on a mid-range phone.
   - **A GDACS ridge beside an NHC one.** GDACS beads are class-derived,
     NHC beads measured (§9). Whether that difference is visible, and whether
     it should be, is a judgement only glass can make.

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
12. `LABEL_PLACEMENT` tuning against a real busy basin (§7). Placement now
    thins on its own and picks its own angle, so the questions are narrower:
    does `spokeStartPx` (18) leave enough air between the dot and the start of
    the text, is `charWidthPx` (6.2) a good enough length estimate for the
    real font, and is `dotClearPx` (13) the right distance to keep from a
    neighbouring dot? A too-small `charWidthPx` packs labels until they touch;
    a too-large `dotClearPx` thins them for clearance they have.

**Live probes (§4, §11):**

**TODO — PROBE HOW TO GET MODEL GUIDANCE FOR THE REST OF THE WORLD. OPEN,
UNSTARTED, and the only thing standing between model tracks and §14's
both-sources rule.**

The problem, stated correctly: `ftp.nhc.noaa.gov/atcf/aid_public/` serves
`al`/`ep`/`cp` ONLY — verified 2026-07-25 by listing the directory and reading
the ATCF README. Every other basin belongs to the Joint Typhoon Warning Center.
The models themselves are worldwide; **we simply do not have a file for the
Pacific typhoons and Indian Ocean cyclones GDACS gives us.** Every GDACS storm
therefore draws no guidance, and until this is answered the layer is honest but
half a planet short.

**One candidate, UNVERIFIED — do not treat any of this as confirmed.** UCAR's
Tropical Cyclone Guidance Project (`hurricanes.ral.ucar.edu/realtime/`) states
it covers the North Atlantic, Northeast Pacific, Central Pacific, **Western
Pacific, North Indian Ocean and Southern Hemisphere**, and that it works from
a-decks. What was NOT established: whether the raw a-deck files are downloadable
at all, what the URL pattern is, whether CORS allows a browser fetch (it will
almost certainly need the relay either way), how fresh they are, and what the
terms of use permit for a public app. A JTWC-hosted path may also exist and was
not looked for.

**What to do, in order, and NOT before the probe:**
1. Find out whether raw a-decks are fetchable for a `wp`/`io`/`sh` storm at all.
   One real file for one real storm settles it. If nothing is fetchable, record
   that here with what was checked, and only THEN does this become a standing
   exception — which is what was wrongly claimed the first time (§7).
2. If a source exists, check the format. It is ATCF, so `lib/adeck.js` should
   parse it unchanged — but the model SHORTLIST will not carry over. JTWC basins
   run different guidance (different consensus aids, different regional models),
   so `MODEL_TRACKS.techs` needs a per-basin answer and `MODEL_COLOR` needs
   entries. Do not assume TVCN/AVNO/UKX/HFSA appear in a western Pacific deck.
3. ~~Map GDACS storms to an ATCF-style id.~~ **STEP 3 IS SOLVED. Do this
   first, it is already done.** Phase 6 step 6 needed the same mapping for a
   different reason and found the door: JTWC's RSS
   (`metoc.navy.mil/jtwc/rss/jtwc.rss`) links a warning per active storm, and
   each warning's own header line carries designation and name together —
   `SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//`. GDACS's `eventname` is
   `NOUL-26`. Strip the year suffix and the names match; the designation `11W`
   **is** the ATCF basin and number, so `wp` + `11` + the year is the a-deck id
   this step was blocked on. `/api/jtwc/storms` already builds and caches that
   lookup, and `lib/advisory.js` already does the name reconciliation
   (`stormNameKey`, `matchJtwcStorm`). Neither needs rewriting for model
   tracks — only calling.

   This is why the step said to check the mapping BEFORE the fetch, and the
   ordering paid: the mapping got solved by an unrelated feature and steps 1
   and 2 are now the only open questions. **What remains genuinely unknown is
   whether a `wp`/`io`/`sh` a-deck is fetchable at all, and what models it
   carries.**

Until then the Layers row reads "Atlantic and Pacific storms only" and a storm
outside that coverage reads "Guidance isn't published for this basin" — a
coverage statement, never a claim that no model is forecasting it.

**A NOTE ON HOW THIS ONE GOT SMALLER.** Nothing was built for it. Step 6 went
looking for advisory text, discovered GDACS publishes none, followed GDACS's
own `source: "JTWC"` field, and the mapping fell out of a header line. The
transferable part is the method, not the answer: **when a source will not give
you an id, read what it says about where its data came from.** `sourceid` was
empty and `source` was the whole answer.

13. **NHC and GDACS probes are DONE (2026-07-23)** — findings folded into §4 and
    §7; the parser's `[VERIFY]` markers are resolved. Still unprobed: IEM GOES
    WMS and NOAA nowCOAST radar ImageServer (both Phase 7). Probe those when
    their phase comes up, not before.

    **THE A-DECK WAS NEVER PROBED HERE AND DID NOT NEED TO BE — it was
    INHERITED from the HA project, verified there against a live deck
    (`aep012026`, 2026-07), and it worked first time on 2026-07-25.** Reading
    the proven parser out of the other repo took ten minutes; re-deriving the
    format would have taken a day and landed in the same place. Worth
    remembering the next time a phase opens with "we should probe this":
    **check whether the answer already exists somewhere before going to get it
    again.** The two projects are separate and MECHANISMS do not port (§14
    Phase 7 says the same about the imagery filter) — but FACTS do.

    The facts, now living in `lib/adeck.js` and `config/constants.js`: techs
    are TVCN (consensus, preferred) / HCCA (consensus, only when TVCN absent)
    / AVNO (**GFS**, not GFSO) / HFSA / UKX (**UKMET**, not EGRR). **EMXI
    (ECMWF) is access-restricted in public decks — its rows arrive blank**, so
    it is excluded deliberately; wiring it ships a model that silently draws
    nothing. **OFCL is excluded too** — it IS the official track already drawn
    solid, so a dashed overlay is invisible on top of it and redundant in the
    legend. Per-tech latest cycle, dropped if >12 h behind the deck's newest.

    **Clip the stale back half GEOMETRICALLY, not by timestamp.** Raw models
    analyze the storm slightly behind NHC's official position even on the
    matching cycle, so a time trim cannot catch those points — they are
    stamped "now". Drop leading points on the far side of the plane through
    the current position perpendicular to the storm's motion, then anchor the
    line at the current position, so guidance radiates from the current dot
    instead of every model trailing its own short tail into the past.
    The half-plane test scales the east-west offset by `cos(lat)`; without
    that it is wrong everywhere except the equator, and wrong in the direction
    of KEEPING points it should drop.

    The probe scaffolding (`functions/api/probe.js`, `probes/`) was deleted
    after use. **THE SECRETS WERE NOT — this sentence used to claim they
    were, and it was wrong for a day.** `PROBE_GH_TOKEN` and `PROBE_SECRET`
    were still set in the Pages project on 2026-07-25, found by eye in a
    screenshot of the environment-variable list rather than by any check.
    A write-scoped GitHub token outlived the endpoint that used it.
    **Deleting code does not delete its credentials, and "retire cleanly"
    covers both.** Cleared 2026-07-25; the GitHub token needs REVOKING on
    GitHub as well, since removing the variable leaves the token itself
    valid. **The pattern is worth repeating** if a later phase needs
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

**THE SCALE PASS — MOVED. It is no longer an open decision.**
14. The scale work was scoped, costed and DECIDED on 2026-07-25 and now lives
    in **§17, which is the standing launch document.** Read §17, not this item.
    Nothing about going public is open here any more.

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
3. **Control cluster** — bottom-right vertical stack, top to bottom: **view
   control, Storms, Layers, Home, Settings.** Bottom-right because you may be
   holding a phone one-handed in the rain; reachability beats keeping the globe
   unobscured.
4. **The view control — ONE button doing the more useful of two jobs**
   (as-built 2026-07-25, replaced the standalone Recenter button).

   **Off north** it is a COMPASS. The needle rotates every frame to keep
   pointing at true north on screen (`-bearing`, since bearing is the direction
   the camera faces), and tapping it eases the bearing back to 0 — **just the
   bearing.** Someone who rotated the globe to read a track at an angle wants
   it upright, not to be thrown back into space and lose the storm they were
   reading.

   **At north** it is the CROSSHAIR, and tapping it is the old recenter: fly
   all the way out to the space floor, clear the storm selection, and centre on
   **your home if you have one, the contiguous United States if you do not.**
   `GLOBE.fallbackCenter` moved from a fixed mid-Atlantic view to the lower 48
   for that reason — "take me back" landing on open water with the coastline
   off the left edge is the wrong answer.

   **Why one morphing control rather than two.** They are the same request at
   two scales: put the view back. A compass that appears and vanishes at north
   leaves a hole in the cluster and shifts every button under it — a moving
   target in the thumb zone. A permanent compass at north is a control that
   visibly does nothing. Morphing keeps the cluster's geometry fixed and always
   offers the more useful action. It sits at the TOP because it is the way out
   of wherever you are; the four below it are places to go.

   Both marks live in the button at once and cross-fade on opacity — swapping
   innerHTML would reparse an SVG per frame during a live rotation gesture.
   Only the needle's inner `<g>` is transformed. The `aria-label` tracks the
   mode: a screen-reader user told "recenter" who gets a rotation is worse off
   than one with no label.

   **The tolerance is `GLOBE.northTolerance` (0.5°), not zero.** Bearing is a
   float and a two-finger gesture almost never lands on exactly 0, so a zero
   test leaves a compass showing at 0.03° — offering to fix something nobody
   can see.

   **THE NEEDLE TRACKS BEARING AND NOTHING ELSE, AND THAT IS NOT A SHORTCUT.**
   Aaron expected it to move when panning or when the idle drift spins the
   globe — "out of north pretty much all of the time". It does not, because on
   MapLibre's globe projection at bearing 0 north IS straight up, everywhere
   that matters. Measured on the live map 2026-07-25, six centres spanning the
   globe ([0,0], [-90,30], [-52,22], [20,60], [-98,39], [140,-20]): both the
   local north vector at the view centre AND the screen direction to the actual
   pole read **exactly 0.00°** at every one.

   The projection places the view centre at screen centre with its meridian
   vertical, so panning changes WHICH piece of the globe you see, never which
   way north points from where you are looking. Meridians curve away from the
   centre, so "which way is north" genuinely has a different answer at every
   other pixel — but the needle is one arrow in one corner, and the only
   non-arbitrary point for it to answer for is the centre.

   A needle that moved while panning would therefore have to be measuring
   something other than north. **Do not "fix" this by inventing a quantity for
   it to track** — the honest alternatives are a compass that sits still
   (this), or a reset-state indicator that should not be shaped like a compass.
   What the underlying complaint actually wanted was the globe to stop drifting
   away from where it was left, and that is now a setting (§9).

   **Scar:** the mode variable is seeded `null`, not `false`. The sync
   early-returns when the mode has not changed (it runs on every frame of every
   camera move), so seeding it with a real state made the first call a no-op
   and the button kept the placeholder `aria-label` from the HTML until the
   user had rotated and come back.

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

**THE HEADER IS BACK · TITLE · CLOSE, AND CLOSE IS ALWAYS AT THE TRAILING
EDGE.** It was not, for a while, and the reason is worth keeping: the header
was `grid-template-columns: auto 1fr auto`, and **grid columns are positional.**
The back button is `display: none` in four views out of five, so with it gone
the two remaining children shifted one column left — the title took the `auto`
column and the close button took the `1fr` one, where it sat left-aligned in a
very wide box, apparently welded to the word "Layers". Only the one view that
happened to have a back button looked right. **Fixed with flex** (2026-07-25):
no fixed columns to shift into, title takes the remainder,
`margin-left: auto` pins close. **The general trap: a positional layout plus a
conditionally-hidden child is a layout that silently means something different
in each state.**

**THE DRAWER TITLES A VIEW BEFORE IT ENTERS IT, AND THAT ORDER HAS BITTEN
ONCE.** `enter()` calls `renderChrome()` — and therefore the view's
`titleFor(arg)` — **before** `onEnter(arg)`. The storm detail view's
`titleFor` assigns `storm = s` on its way past, because the header names
itself from its own argument. The consequence: **inside `onEnter`, a
comparison against the view's own current-storm variable is already stale and
can never detect a change.**

That shipped as a real bug in Phase 6 step 6 — select a storm, open its
advisory, select another, and the FIRST storm's advisory stayed on screen. The
reset sat behind `if (s.id !== storm?.id)`, which was never true. `geo` and
`ghost` were behind the same dead branch and were being carried across storms
too; they escaped notice only because `main.js` sets the geometry state
explicitly on every selection, masking it.

**THE RULE THIS EARNS: a view MUST NOT infer "did my argument change" by
comparing against state another lifecycle method can assign.** Either bind the
state to the identity it belongs to and treat a mismatch as stale (what the
advisory record does now — `forId` + `forKey`), or compare against a variable
only `onEnter` writes. Never both-and-hope.

And the second lesson, which generalises further: **a sequence-number race
guard does not catch a staleness bug.** One was already on the advisory fetch
and did nothing, because nothing raced. Different failure, different guard.

**NO TAB ROW inside the drawer.** Home and Settings are configuration — you
arrive, you set, you leave — and nobody switches to them mid-storm. A
persistent nav would cost ~44 px of a 60vh sheet forever to duplicate controls
that already exist in the cluster. This is also why the cluster hiding behind
an open sheet at narrow widths is harmless: while the drawer is open the only
navigation anyone wants is Back, and Back is in the header.

| View | Contents | Phase |
|---|---|---|
| **Storms** | Storm list, two lines per row. Tab order and screen-reader authority. (The scope filter shipped in Phase 3 and was removed 2026-07-25.) | 2 |
| **Storm detail** | Pushed onto the stack from Storms. Back returns to the list. | 4 |
| **Layers** | Two groups, exclusive pairs as segmented controls, per-model selector with swatches (§7). | 6 |
| **Home** | Distance and closest approach in Phase 3; wind arrival, exposure timeline, surge-at-home in Phase 6. | 3 |
| **Settings** | Install door (top, amber), **theme** (Dark / Light / Automatic), **units**, **globe drift** (on/off, speed, delay), mesh height, imagery tuning sliders. | 3 |

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

### Scope filter — REMOVED 2026-07-25
Three scopes were carried over from the HA integration — **my basin · within N
miles of home · all** — and shipped in Phase 3.

**They are gone.** A filter earns its space by removing work, and this one sat
above a list that has never held more than nine rows. Scrolling past two storms
is not work. What it cost was a row of chrome pinned to the top of the one
surface that is also the app's entire accessibility layer, on the screen where
vertical space is scarcest.

What survives is the part that was actually doing something: **home still sorts
the list nearest-first and still puts a distance on every row.** That is the
personalisation; the filter was never it.

`SCOPE`, `SCOPE_RADIUS_NM`, `filterByScope`, `availableScopes`, and the
`landfall.scope` storage key were deleted, not left as unused exports. The
`none_matched` state in §5 no longer has a producer in the storm list — with no
filter, nothing can empty the list while storms exist, so the three honest
states there are loading / clear / unavailable. `none_matched` remains a live
concept elsewhere (geocode search with no matches).

### Storm list
**Ordered nearest-first, grouped under basin headers.** Those two rules conflict
unless basin order is defined, so: **basins are ordered by their nearest storm**,
and within each group, nearest first. The single closest storm on the planet is
always at the top of the list, inside its basin's group.

**Two lines per row, name on its own** (as-built 2026-07-25).

```
ATLANTIC
  ● Fiona
    Cat 2 · 85 kt · closing · 310 mi
  ● Gaston
    TS · 50 kt · 890 mi

EAST PACIFIC
  ● Estelle
    Cat 1 · 75 kt · 1,240 mi
```

It was one line — swatch, name, metadata pushed right — and that failed the
moment home existed. "Cat 2 · 85 kt · closing · 9,901 mi" is most of a 340 px
rail, so the name took whatever was left and ellipsised. **The storm name is
the one thing on this surface that must never be truncated**: it is how you
refer to the storm, how you match it to a forecast you heard elsewhere, and how
a stranger arriving by shared link knows what they are looking at. It now owns
a full-width line and the figures sit under it, a step smaller and in secondary
colour so the names win the glance. A name that still overruns wraps rather
than clipping — a two-line name is readable, "Tropical De…" is not.

- **No home means no distance**, and the list falls back to canonical basin
  order, strongest first within each. Not arbitrary — with no reference point,
  intensity is the only ranking the data supports. The store keeps that
  intensity order regardless (`data/merge.js`); the LIST re-sorts to
  nearest-first once home exists, without mutating the store's own ordering,
  because other surfaces still want intensity.
- **Headers only when more than one basin is present.** A lone header over a
  two-row list is noise.
- **Do not re-sort while the panel is open.** A 30-minute poll can flip two
  storms' ranking and move a row out from under a thumb mid-tap. Sort on open
  and on reopen — never on poll. Storms move slowly enough that nobody will
  notice. (The third trigger used to be "on scope change"; the scope filter is
  gone, see above.)
- **Row:** category swatch (§6, the same color as the globe dot, so the list is
  its own legend) pinned to the name's line, then the name; underneath,
  category · wind · trend · distance. The trend word sits BEFORE the distance —
  after it, "340 mi receding" reads as a measurement rather than a direction of
  travel.
- Stale rows carry their age inline. **Ghosts sit in a dimmed group at the very
  bottom under a divider, outside basin grouping** — otherwise a dissipated
  storm creates a header for a basin with nothing active in it.
- **No virtual scrolling.** Peak worldwide is ~15 storms; rendering rows directly
  is simpler and faster than any windowing library.
- **Basin headers are real `<h2>`s**, so screen-reader users can jump by heading
  instead of arrowing through every row. Headers are not focusable; Tab hits
  rows only.

Empty states, per §5. **Three, not four** — `none_matched` retired with the
scope filter, because nothing can now hide a storm that exists:
- `loading` → "Checking the oceans…"
- `clear` → "No active storms. All feeds reporting clean." Only when every
  source returned clean AND there are zero storms.
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
auto-expanded; it would push everything above it off screen. **DONE,
CONFIRMED ON GLASS 2026-07-25.**

**THE RAW PRODUCT, WHOLE** (Aaron's call, over a parsed version that would
have dropped the product's header block as a duplicate of Vitals three inches
up the same panel). The argument that won: a parser that hides a section is a
parser that can hide the WRONG section, and during a hurricane the cost of
four redundant lines is nothing against the cost of silently swallowing one
the reader needed. It soft-wraps rather than scrolling sideways — the products
are fixed at 69 columns, which does not fit a phone, and a horizontal scroll
region inside a vertically scrolling drawer is a gesture fight on a
touchscreen and a trap for a keyboard user. The block is `tabindex="0"` with a
visible focus ring so arrow keys can scroll it.

**Expanding is what fetches it.** The collapsed section IS the gate — §7's
"fetching layers fetch only while switched on", applied to a reading surface.
That gate is strictly better than the layer toggle this used to have, because
it is per storm and on demand rather than global. The record caches per
(storm, advisory), so collapsing and re-opening costs nothing and a new
advisory self-invalidates.

**FOUR STATES, and the distinctions are the point** (§5):
| state | means | offers retry |
|---|---|---|
| `ok` | the words are here | — |
| `none_matched` | nobody is warning on this storm by that name | no |
| `unsupported` | this storm cannot have advisory text at all | no |
| `unavailable` | we tried and could not get it | **yes** |

Collapsing `none_matched` into `unavailable` puts a Retry button under a storm
that will never have text; collapsing `unavailable` into `none_matched` tells
a reader during a hurricane that no advisory exists when one does. Both are
the same §5 bug in opposite directions. **A degraded JTWC index reads as
`unavailable`, never as `none_matched`** — if five warnings are listed and
only four could be read, a name missing from the four is not evidence of
anything, and calling it an absence is exactly the coverage-limit-stated-as-
data-absence mistake step 5 shipped and had to correct.

The section names which agency wrote what you are reading. A reader in the
Philippines looking at a US Navy bulletin should know that is what it is.

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

---

## 17. Public launch — hardening, scale, and the money question

**This section is the standing launch document.** §1 set the direction
(Landfall is for the masses); this is the decided plan for surviving it. It
supersedes the old §15 scale-pass item, which now points here.

**The launch gate, stated once:** the link is not shared publicly until Pass A
below is deployed and confirmed on a phone. Everything after Pass A is
scale and depth — real work, but not the thing that makes sharing it
irresponsible. **THE GATE IS CLOSED as of 2026-07-25** — Pass A is confirmed on
glass, and Pass B is live and measured in production.

### The bet, and what it changes

A shared link during a Cat 4 landfall is the design case: thousands of
strangers, most on phones, most arriving in the same ten minutes, most of them
frightened. Three properties matter that did not matter for one user — and
performance-and-feel still overrides all of them.

1. **Nobody can be misled.** A stranger has no idea this is a hobby project.
2. **Nothing gets billed into the ground**, and NOAA does not get a firehose
   pointed at it wearing our name.
3. **Aaron finds out it is broken from a notification, not from a stranger.**

### PASS A — safe to share publicly. THE GATE.

**STATUS: BUILT, DEPLOYED, AND CONFIRMED ON GLASS BY AARON, 2026-07-25.**
The gate is closed — the link is safe to share. **The storm detail panel
disclaimer is BUILT as of 2026-07-26** (see A1's as-built note below), which
closes the last content gap in Pass A. One item remains and it does not gate
sharing: **the CSP is still REPORT-ONLY** — flip it after one normal session
with imagery on and a storm selected reports nothing, and **NOT in the days
before a deliberate traffic spike.** A wrong CSP breaks the app for everyone
at once, which is the single worst thing to discover on the deploy nobody is
watching; Report-Only blocks nothing, so waiting costs nothing and flipping
early costs everything. Soak it for a week or leave it.
The first deploy of it BLACK-SCREENED the app — see "the black screen" below
— because `.gitignore` silently dropped the vendored libraries. Fixed the
same day.
Two Cloudflare settings must be made by hand before it is real — see
"Aaron's two settings" at the end of this section. Until `INSPECT_KEY` is
set, A2 is fail-closed (the inspect routes refuse everyone, including Andy);
until the `TELEMETRY` binding exists, A5 accepts and drops.

Five items. None is large; together they are the difference between a personal
project and something defensible to hand to a stranger.

**A1. The disclaimer. THE SINGLE BIGGEST GAP, and it is not a legal formality.**
As of 2026-07-25 the app contains NO statement anywhere that it is unofficial —
grepped, zero hits. Someone lands on a globe showing cones and watch/warning
paint with nothing telling them this is not the National Hurricane Center.
Landfall renders real hazard data and people make real decisions near it. The
rule that governs the whole app applies to the app itself: **never let absence
read as safety (§5).** A missing disclaimer is that failure one level up.

Two surfaces, and the wording is deliberately plain — no legalese, per §1's
layman's-terms rule:
- **Persistent**, in the attribution panel (`map/attribution.js`, already the
  licensing surface): Landfall is unofficial. Always follow the National
  Hurricane Center and your local emergency management.
- **Once, on first run**, as a third `ui/first-run.js` step ahead of the home
  nudge — acknowledged, then never again. It uses the same one-time
  guarded-localStorage mechanism the existing two nudges use; **NOT a new
  store** (the §12 extract-on-third counter still stands at two).

Plus a plain-language Terms/About view holding the disclaimer, the sources, the
privacy statement (A5), and the copyright line (§17 IP below).

**A2. Lock the four `/inspect` endpoints.** `/api/nhc/inspect`,
`/api/gdacs/inspect`, `/api/jtwc/inspect`, `/api/imagery/inspect` are deployed,
public and unauthenticated. They are read-only and they stay deployed — §14
settled that they are the standing answer to "the sandbox cannot reach the
source." But an unauthenticated relay anyone can drive is an **open proxy
pointed at NOAA under our User-Agent**, which is exactly the relationship §17
says not to have. Gate on a shared secret in a Pages environment variable;
refuse with 404 (not 403 — a 403 advertises that something is there).

**A3. Vendor MapLibre and Three off unpkg.** `index.html` loads
`maplibre-gl@5.6.0` and `three@0.128.0` from `unpkg.com`. A CDN blip during a
storm is a black screen for anyone without a warm cache. That is a third party
on the critical path of a safety-adjacent app. Commit both files, serve from
our own origin, keep the SW's cache-first treatment (a pinned local file is
even safer to treat as immutable than a pinned URL). Costs repo weight and
buys the app's availability back.

**A4. `_headers` with a CSP.** The project has no `_headers` file at all.
Static site, so the exposure is modest — but a CSP is a handful of lines and it
is the difference between an injection being a catastrophe and a non-event.
Ships with the vendoring in A3, which shrinks the allowlist to our own origin
plus the tile/imagery hosts.

**A5. Telemetry — Aaron currently CANNOT KNOW the app is broken for anyone
else.** No error reporting, no analytics, nothing. Today a failure is visible
only when Aaron looks at his own phone. Under public traffic that is the whole
problem: the app can be dead for an entire region and the first signal is
somebody complaining.

Built on **Cloudflare Analytics Engine** — it binds directly to the existing
Pages Functions, the free tier is 100k writes/day and 10k queries/day, and it
adds no vendor. Three pieces:
- `lib/telemetry.js` — `error`, `unhandledrejection`, and the signal that
  actually matters: **§5 state transitions.** A feed flipping to `unavailable`
  is the event worth paging on, not a stack trace. Batched through
  `navigator.sendBeacon` on `visibilitychange`, sampled, never blocks a frame,
  never throws (a telemetry module that can break the app is worse than none).
- `functions/api/beacon.js` — strict allowlist of event types, hard length
  caps, writes to Analytics Engine, silently drops everything else. Not an open
  write path.
- **Cloudflare Web Analytics** — one script tag, no cookies, free. It answers
  "is this actually fast on real phones," which no amount of local measurement
  can.

**THE PRIVACY CONTRACT, AND IT IS ABSOLUTE. Home coordinates NEVER leave the
device.** Not exact, not coarsened, not rounded, not hashed, not bucketed into
a region. No IP retention beyond what Cloudflare does at the edge on its own.
No accounts, no user identifier, no cross-session id. This is not a
nice-to-have that telemetry gets to negotiate against — it is the app's promise
and, once there is anything to sell, one of the few things a competitor with
an ad model structurally cannot copy. **Any beacon field is guilty until
proven it cannot be joined back to a person.** State it plainly in the Terms
view (A1): your location stays on your phone.

### What Pass A actually shipped, and what it measured

**A1 — disclaimer. BUILT.** `ui/disclaimer.js` owns the wording as one frozen
export so no surface retypes it. First-run strip has NO dismiss X and does
not time out — the only way past it is the button. It shows IMMEDIATELY
rather than on the home nudge's 8-second delay, and the home nudge is now
CHAINED BEHIND IT (`ui/first-run.js`) instead of racing it.

**DELIBERATE DEVIATION FROM WHAT A1 SAID ABOVE — the permanent surface is
SETTINGS, not the credits panel.** `map/attribution.js` is a pill that
ANIMATES ITS WIDTH from a measurement of its own single-line label; a wrapped
paragraph inside it breaks that measurement, and that file's header records
six attempts spent getting its open/close behaviour to hold. Rebuilding it
into a panel to host four lines of text is a large change to hard-won code
for a placement nobody asked for. Settings is where people already look for
"what is this", it is where the install door already lives, and it is
reachable by tap, click and keyboard. The credits pill keeps doing its one
job.

**THE STORM DETAIL PANEL FOOTER — BUILT 2026-07-26, and it was the highest-
value placement of the three.** The other two surfaces both speak at the
moment of ARRIVAL; this one speaks at the moment of DECISION. It is
`DISCLAIMER.short` plus a live link to the NHC, rendered last in
`ui/view-storm-detail.js`'s body — **including on the ghost form**, since a
storm that has left the feed is precisely when a reader is most likely to be
looking at something out of date.

**It is a footer, not a pinned banner, and that is a measured tradeoff.** The
stamp above it is pinned while the body scrolls; two more lines up there cost
reading height on the phone that has the least of it, and would inherit the
stamp's freshness band colouring (`fresh`/`aging`/`stale`/`silent`) which the
disclaimer has nothing to do with. It is styled muted and rule-separated for
the same reason: it is always true, so it must never compete with the ghost
note or the stale warning, both of which mean *something is wrong right now*.

**`tools/detail-disclaimer-check.mjs` is the regression guard, and it exists
because `headless-check.mjs` has NEVER RENDERED THIS PANEL.** That check
reports "0 storms" locally — the sandbox cannot reach NOAA and the relay
routes 404 against a static server — so every assertion about the busiest
screen in the app has only ever run against an empty list. The new check
stubs `/api/nhc/storms` with one synthetic major hurricane in NHC's own
`activeStorms` shape, then measures the footer at 375/390/430/768/1280:
present, says "unofficial", names the NHC, non-zero height, inside the
viewport, 44px link target, and reachable by scrolling to the end of the
panel. **PASSING at all five widths, 2026-07-26.**

**The general lesson, and it is bigger than this footer: a test that only
runs when a real hurricane exists is a test that does not run.** Stubbing one
route bought deterministic coverage of a panel that was previously unverified
for eleven months of the year.

**A2 — inspect routes gated.** `functions/api/_inspect-guard.js`, imported by
all four. Gate runs FIRST, before parameter parsing and before any upstream
fetch, so an unauthorised caller never causes a request to NOAA. Refusal is
**404, not 403** — a 403 advertises that something is there. Fails CLOSED on
a missing key, which is the opposite of A5's rule and deliberately so: a
missing guard must lock the door, a missing telemetry binding must not cost
a user anything.

**A3 — MapLibre and Three vendored** into `./vendor/`, version in the
filename, pulled from the npm tarballs (byte-identical to what unpkg served).
`sw.js` bumped to v2 and now treats `/vendor/` as cache-first while NO
cross-origin host is cache-first any more.

**AND IT FIXED THE TEST HARNESS, WHICH NOBODY EXPECTED.** `headless-check.mjs`
had NEVER RUN in the cloud sandbox — the sandbox's egress proxy 403s unpkg,
so MapLibre and Three never loaded, the app never booted, and every check
reported "no drawer header". Vendoring made the app boot with no internet at
all, and the file's own "NEEDS INTERNET" header is now false and corrected.
**A dependency on a CDN was also a dependency for every test that ever ran.**

**A4 — CSP MEASURED ON THE LIVE SITE 2026-07-25: ZERO VIOLATIONS** across
boot, all four drawer views, the basemap, MapLibre's blob workers, and every
layer toggle switched on (`forecastTimes`, `cone`, `modelTracks`,
`homeMarker`, `stateNames`, `cities`, `graticule`). Measured with a real
`securitypolicyviolation` listener in Chrome, not inferred from the config.

**STILL NOT EXERCISED, so it stays REPORT-ONLY for now: the imagery layer**
(`gibs.earthdata.nasa.gov`, `view.eumetsat.int`) — it is a segmented control,
not a `data-toggle` row, so the sweep above missed it — and a live storm
SELECTION. Both hosts ARE in `connect-src`, so the expected result is clean;
that is a prediction, not a measurement, and §17's own rule is that a wrong
CSP breaks the app for everyone at once. **Flip it to enforcing after one
normal session with imagery on reports nothing** — not before, and not on the
strength of the sweep above.

**A4 — `_headers` with a CSP. THE CSP SHIPS REPORT-ONLY, DELIBERATELY.**
A wrong CSP does not degrade the app, it breaks it for everyone at once on
the deploy nobody is watching. Report-Only logs violations to the console and
blocks nothing, so the first deploy costs a console read instead of an
outage. **Flipping it to enforcing is a real remaining step, not a
formality** — rename the header once the deployed app runs clean at both
widths with a storm selected and imagery on. The connect-src list was built
by reading actual fetch call sites and ENDPOINT constants, not from memory.
The non-CSP headers cannot break a static map app and enforce immediately.

**A5 — telemetry. BUILT.** `lib/telemetry.js` + `functions/api/beacon.js` +
`TELEMETRY` in constants. Reports uncaught errors, unhandled rejections, and
**source state TRANSITIONS** — the last is the reason it exists, because a
feed flipping to `unavailable` throws no exception anywhere and a crash
reporter would see a perfectly healthy app. main.js reports transitions only,
never the steady state, so "nhc is still down" does not arrive every five
minutes and bury the moment it broke.

**`sampleRate` IS 0.25 AS OF 2026-07-26, turned down from 1.0 ahead of the
deliberate public launch.** This entry used to call 1.0 correct "until a viral
week arrives"; the viral week is now being caused on purpose, so the dial
moves BEFORE it rather than during it.

**The flood case is not errors — it is state transitions, and they are
GLOBAL.** An error is per-session and rare. When NHC flips to `unavailable`,
every session on the site reports it within one `visibilitychange`: five
thousand concurrent readers, five thousand beacons, one fact. That is the
event telemetry exists for and the only one whose volume scales with the
crowd.

**And the sink is a CONSOLE, not a database** — the Analytics Engine
entitlement never came through. Cloudflare's real-time Worker log has no
aggregation and no query, so volume here is not a bill, it is
**ILLEGIBILITY**: past a few hundred lines a second the one message that
matters is unreadable, which is the same as never having sent it. 0.25 keeps
a quiet day fully diagnosable and cuts a spike fourfold. **Next step down is
0.05 if the live log is unreadable during launch** — a one-line push.

**THE PRIVACY CONTRACT IS NOW ENFORCED BY A TEST, NOT BY A COMMENT.**
`tools/privacy-check.mjs` sets a real home, forces each event kind,
intercepts every `/api/beacon` POST and searches the bytes. **PASSING as of
2026-07-25** — no coordinate at any precision, no address component, no
identifier.

**It took three attempts to write correctly, and the lesson generalises.**
The first two flagged a false leak on `"30"` — the truncated latitude —
which was really `(:311:30)`, the line:column of a stack frame. Tightening
the regex to require a JSON-value position did not help, because `:30)` IS
colon-prefixed. **No amount of pattern sharpening separates a JSON number
from a number inside a string.** It now PARSES each payload and walks every
numeric value, failing on anything within a degree of home — which is both
correct and a stronger assertion than the rounded forms somebody thought to
list. Same shape as §15's standing lesson: when the check keeps failing on
something that is not the thing, question the method, not the threshold.

### THE BLACK SCREEN — `.gitignore` ate the vendored libraries. Cost one deploy.

A3 pointed `index.html` at `./vendor/maplibre-gl-5.6.0.js` and
`./vendor/three-0.128.0.min.js`. `.gitignore` still carried a `vendor/` rule
from when that folder was local scratch. **`git add -A` skipped all three
files without a word, the commit pushed clean, and the deployed site served
an index.html referencing scripts that were not there.** No MapLibre, no
Three, no globe. A black screen, with nothing in the UI to explain it —
Aaron found it by refreshing.

**THE EVIDENCE WAS IN `git status` AND THE ABSENCE IS WHAT MADE IT
INVISIBLE.** The untracked list showed `_headers`, `lib/telemetry.js`,
`ui/disclaimer.js` and the rest — and no `vendor/`. Reading that output and
seeing everything you expected is not the same as checking that nothing is
missing. It is the same failure this whole spec is organised around (§5): an
absence read as normal. A checklist of files you EXPECT to land catches it;
scanning for problems does not.

**Three rules out of it, all cheap:**
1. **A deploy is not verified by a successful push.** `git push` reported
   success for a commit that could not possibly work. Confirm the files exist
   in the remote tree — `git cat-file -e origin/main:<path>` per file — before
   calling anything deployed.
2. **Adding a path that application code loads means checking it is not
   ignored.** `git check-ignore -v <path>` costs one second and answers it
   outright.
3. **An ignore rule outlives the reason for it.** `vendor/` meant "local
   scratch" for months and then meant "shipped code" without anyone editing
   the file. The rule is now GONE with a comment in its place explaining why
   it must not return.

### AND THEN THE CACHE KEPT SERVING IT — the poisoned-vendor bug

The black screen above had a SECOND life, and this one is the more valuable
scar because the server was already fixed when it bit.

While `vendor/` was missing, `/vendor/maplibre-gl-5.6.0.js` did not fail
cleanly. **Cloudflare Pages answered it with the `index.html` FALLBACK, as
HTML, and `res.ok` was TRUE.** `sw.js` treats `/vendor/` as cache-first and
immutable (§17 A3), so it stored an HTML page under a `.js` filename — and
then kept serving it after the real file was deployed, because the entire
point of cache-first is never asking again. The browser refused to execute
it ("MIME type ('text/html') is not executable"), `maplibregl` was
undefined, and `createGlobe` threw.

**A CACHE-FIRST PATH TURNS A TRANSIENT 404 INTO A PERMANENT ONE.** The
missing file was fixed in minutes. The poisoned cache would have outlived
every future deploy on every device that loaded during that window — and it
was invisible from the server side, where everything measured healthy. Andy's
own browser session loaded the app perfectly while Aaron's stayed black, and
that disagreement was the diagnosis: when the server is provably fine and one
client is not, the client is holding something.

**Fixed two ways, because either alone is insufficient:**
1. `typeMatchesUrl()` — an HTML response for a `.js`/`.css`/`.json`/`.png`
   request is a fallback page, never the asset. Refused on the way IN and on
   the way OUT, so an already-poisoned cache heals itself rather than needing
   the new worker to activate first.
2. `VERSION` bumped v2 -> v3, dropping every v2 cache wholesale. This is the
   "hammer for a poisoned cache" that constant was documented for, and the
   first time it has been needed.

**The rule worth keeping: `res.ok` DOES NOT MEAN `res` IS WHAT YOU ASKED
FOR.** Any host with an SPA fallback answers a missing asset with a 200 and a
web page. Anything that caches by URL without checking the TYPE will
eventually cache a web page under an asset name. Validate the kind, not just
the status — and validate it on read as well as write, or the fix only
reaches devices that were never broken.

### MEASURED 2026-07-25 — an open drawer COVERS THE NAV CONTROLS at phone width

Drawer top sits at y=620 while `#btn-storms` spans y=636..680 at 390x844. So
the nav button that opened a view cannot be clicked to close it on a phone.

**RULED A FEATURE, NOT A BUG — Aaron's call, 2026-07-26. Do not "fix" this.**
The drawer is meant to sit over the nav cluster at phone width; the X and Esc
both close it, so every path out exists. Recorded here so the next reader does
not open it as an outstanding defect, and so the measurement below is kept as
a description of intended geometry rather than a standing complaint.

**Confirmed PRE-EXISTING and unrelated to anything in Pass A** — identical
geometry with the disclaimer acknowledged and not. It surfaced now only
because A3 made the headless check able to run at all. Nothing is trapped
(the X and Esc both close the drawer), so this is a design judgement for
glass, not a bug being sat on. The test now closes via the X, which is what
a phone user does anyway.

**Two headless failures are PRE-EXISTING test drift, not Pass A regressions.**
Do not chase them as new: `graticule row not renamed` (both widths), and
`no install control in Settings` — the latter asserts on `.install-cta`,
which by design only exists in the READY state, and headless Chromium over
plain HTTP never fires `beforeinstallprompt`. The MANUAL state renders
correctly. Both are the test disagreeing with the app, and the app is right.

### RESOLVED — ANALYTICS ENGINE NEEDS AN ENTITLEMENT, AND THE BINDING IS NOW OPTIONAL

2026-07-25. Builds stopped dead after `ddd5719`. Five commits sat on `main`
un-deployed while every `git push` reported success and no banner appeared
anywhere. The build log named it in one line:

    Error: Failed to publish your Function. Got error:
    You need to enable Analytics Engine.

**THE BLAST RADIUS IS THE POINT. One unusable binding took down ALL `/api/`
ROUTES** — storm feeds, geometry relay, geocoder — because Pages Functions
publish as a SINGLE Worker and a binding that cannot resolve fails the whole
deploy. Adding a binding is not an additive change. It is a deploy-pipeline
change.

**AND IT COULD NOT BE FIXED FROM THE DASHBOARD.** Creating a dataset (the
only control the Analytics Engine page offers — there is no enable toggle)
did NOT clear it; the next build failed identically. Analytics Engine
requires an ACCOUNT ENTITLEMENT separate from any plan tier, which is not
self-serve and generally needs Cloudflare support.

**The "100k data points/day free" figure describes the QUOTA, not the
ACCESS.** It was read, correctly, off Cloudflare's own pricing page and used
to conclude the feature was available. It was not. **A pricing page answers
what something COSTS, never whether you can turn it on.**

**AS BUILT — the binding is OPTIONAL and the console is the fallback sink.**
`functions/api/beacon.js` writes to Analytics Engine when the binding
resolves and to `console.log('[landfall-telemetry] …')` when it does not,
from ONE rebuilt `row` object so the two sinks cannot disagree. Console logs
reach Cloudflare's real-time Worker logs with zero configuration. History is
the only thing lost, and history is what the entitlement would buy back.

**THE RULE THIS SETTLES: Landfall's ability to ship a fix during a storm
must never depend on a diagnostics feature.** A telemetry sink that can block
a deploy is worse than no telemetry, by a wide margin. Optional, always.

**Two diagnosis rules, both cheap and both earned the hard way:**
1. **When a push does not appear on the site, READ THE BUILD LOG FIRST.** Not
   the caches, not the git state, not the integration. It is one screen and
   it names the error outright. Three wrong theories — cache poisoning, empty
   commits, a revoked GitHub integration — were spent ahead of it.
2. **Compare what the SITE serves against what the REPO holds, never against
   what you pushed.** A successful `git push` says nothing about what is
   deployed. One fetch against the live app proved the gap in two minutes and
   killed every client-side theory at once.

### CLOSED — the stale probe secrets, `PROBE_GH_TOKEN` / `PROBE_SECRET`

Spotted 2026-07-25 in the Pages environment-variable list. §15 recorded the
probe scaffolding (`functions/api/probe.js`, `probes/`) as deleted after use
"along with its Cloudflare secrets" — the code went, the variables did not, and
`PROBE_GH_TOKEN` looked like a live GitHub token with repo-write scope sitting
there for an endpoint that no longer exists.

**Not an exposure: Aaron confirmed 2026-07-25 that both tokens were issued with
24-hour expiry and lapsed days ago.** The variables may still be listed; the
credentials behind them are dead.

**The lesson survives the false alarm, and it is the cheaper half anyway:**
deleting the CODE that reads a secret does not retire the SECRET, and deleting
a Cloudflare variable does not revoke the token it holds. Three separate
actions, and §15 claimed all of them on the strength of one. What saved it here
was a short expiry chosen at issue time — **scope a throwaway credential with an
expiry, and the cleanup you forget stops mattering.**

### THE DISCLAIMER BUTTON RENDERED OFF-SCREEN — an inherited rule, wrong axis

Reported on glass 2026-07-25 (iPhone AND Pixel, both): the acknowledgement
text displayed correctly but the "I understand" button sat outside the panel,
pushed off the right edge. **It looked perfect on desktop**, which is why it
shipped.

**The cause was invisible in the rule that broke it.** `.nudge` carries, under
`@media (max-width: 480px)`, `flex-wrap: wrap` and `justify-content: flex-end`.
Both are correct for the ROW-shaped pill nudges they were written for — wrap
lets the action button drop to a second LINE on a narrow screen. The
disclaimer strip reuses `.nudge` for its glass styling but is a COLUMN, and on
a column container `flex-wrap: wrap` means content that overflows vertically
wraps into a NEW COLUMN BESIDE the first. The paragraph is ~165px tall, so the
button wrapped into a second column and left the panel: measured at
x=365..493 inside a 390px viewport.

**THE RULE: reusing a class for its LOOK inherits its LAYOUT too.** Every flex
property on the borrowed class has to be re-read against the new direction,
because half of them mean something different on the other axis. `flex-wrap`
and `justify-content` are now stated EXPLICITLY on `.nudge-disclaimer` rather
than inherited, with a comment saying why removing them breaks it.

**Also simplified while in there.** The button was full-width on narrow and
right-aligned on wide — two behaviours to keep true, and neither survived the
wrap bug. It is now CENTRED at every width: one rule, one thing to verify.

**`tools/disclaimer-layout-check.mjs` is the regression guard.** It asserts at
six widths (375 → 1280) that the button is inside the panel, inside the
viewport, horizontally centred, and still ≥44px tall. This class of bug is
invisible in the source and only exists in geometry at narrow widths, so it
needs a measurement, not a review.

**And the honest note about how it was found: Aaron found it on a phone.**
The headless checks all passed, because they never asserted anything about
where that button was. A test only catches what it was told to look at.

### THE APP HAD NO FAILURE STATE FOR ITS OWN BOOT — fixed 2026-07-25

`boot()` was a bare call in `main.js`. Anything thrown during startup — a
library that did not load, a WebGL context the browser refused — produced a
BLACK SCREEN and a console message no ordinary person will ever read.

**§5 is enforced for every feed, every layer and every async surface in this
app, and was not enforced on the app itself.** That is the worst place to
have the gap. A dead feed still leaves an app that can explain the dead feed;
a dead boot leaves nothing, and a stranger who followed a shared link during
a storm cannot tell whether the problem is them, their browser, or the site.

**Found on real hardware: Brave on Android showed a blank screen while the
identical build ran fine on macOS and iOS.** Brave's fingerprinting
protection can refuse a WebGL context, and both engines need one — MapLibre
renders the map on WebGL and Three.js draws the clear globe. The symptom was
BYTE-IDENTICAL to the deploy failures earlier the same day, which is what
made it expensive: the same black screen had already meant three different
things, so it cost a fresh round of diagnosis that one line of on-screen text
would have answered outright.

**As built — `ui/boot-failure.js`:**
- `hasWebGL()` runs BEFORE boot, so the likeliest cause is NAMED rather than
  surfacing as an opaque throw from inside MapLibre. `boot()` is additionally
  wrapped, so an unknown failure still gets a screen.
- It names a cause **only when it detects one**. WebGL missing gets its own
  message and its own remedy; everything else gets an honest generic one. A
  wrong diagnosis sends someone to change a setting that was not the problem
  — worse than "something went wrong", because it costs time and trust.
- **It imports NOTHING — not even tokens.** It runs when the app has failed,
  so it cannot depend on anything that might be part of the failure
  (`applyTokens()` may be what never ran). Its handful of literal colours are
  the ONE sanctioned exception to §9's zero-hardcoded-hex rule.
- 44px target and a real focus ring on the retry button: §10 applies to the
  failure screen exactly as much as to the app.
- The real error goes to `console.error` and is never rendered — §5 says
  people get human language, but discarding it would make a genuine bug
  undebuggable.

**Verified headless both ways** (`webgl available` -> normal boot, two
canvases, no alert; `webgl denied` -> the readable panel with a working retry
and no black screen).

**THE GENERAL RULE: an app that enforces honest failure states everywhere
except its own startup has not enforced them.** Startup is the one failure a
user cannot work around, cannot report usefully, and cannot distinguish from
the site being dead.

### Aaron's two settings — Pass A is not live until these are made

Both in the Cloudflare Pages project, Production AND Preview, same place
`MAPBOX_TOKEN` already lives. **One at a time.**

1. **Environment variable `INSPECT_KEY`** — any long random string. DONE
   2026-07-25. Until it exists the four inspect routes 404 for everybody.
   After it exists they are reached with `?key=<value>`.
2. **~~Analytics Engine binding named `TELEMETRY`~~ — DO NOT ADD IT.** The
   account lacks the entitlement, and a binding to an unentitled product
   blocks every deploy (see above). **If it is currently set in the Pages
   project, REMOVE IT** — that is what unblocks the pipeline. Telemetry works
   without it, writing to the Worker console instead. Revisit only if
   Cloudflare support grants the entitlement.

### PASS B — the origin collapse. LIVE AND CONFIRMED 2026-07-25.

**STATUS: DEPLOYED AND MEASURED IN PRODUCTION.** The KV namespace, the cron
Worker (`landfall-warm`, `*/5 * * * *`), `WARM_KEY` on both sides and the Pages
KV binding are all in place. A live warm cycle returned:

    lists 3 · derived 10 · written 1 · unchanged 12 · failed 0
    reachedSource 12 · bypassUnknown 1

Read that as: **all 13 keys stored, every checkable route reached its source,
and 12 of 13 cost no write.** `bypassUnknown: 1` is `/api/jtwc/storms`, which
carries its `fetchedAt` in the body rather than a header — reported honestly as
unknown rather than counted as a pass.

**The write-if-changed budget guarantee is holding in production, not just in
the test harness.** Twelve unchanged keys per cycle is the steady state.

**The finding that drove it:** every relay function caches in `caches.default`,
which is **PER-DATACENTER**. Cloudflare has 300+ colos, so `s-maxage=300` never
meant "NOAA is fetched once per five minutes" — it meant **up to ~300 times per
five minutes, and that was true at one user and would stay true at a hundred
thousand.** The same flaw is why §15's note about `/api/geocode`'s rate limiter
undercounting was right. It also means **the first visitor in every region eats
a full round-trip to NOAA** — the exact person arriving on a shared link during
a storm.

**The fix as built: one cron Worker fetches each feed ONCE globally into KV;
Pages Functions read KV.**

#### B1 — TWO FEEDS WENT BEHIND THE RELAY, AND FINDING THEM CHANGED THE PASS

The old version of this section scoped Pass B to "three core feeds." That was
wrong, and reading the actual fetch call sites is what corrected it: **two of
the heaviest upstream loads never touched the relay at all.**

- `data/gdacs.js` fetched `geteventlist/EVENTS4APP` **directly from the
  browser**, every poll, for the app's whole life.
- `data/nhc-mapserver.js` fetched `mapservices.weather.noaa.gov` **directly** —
  one metadata call plus **nine layer queries per selected storm, per reader**.

Both are CORS-open, both worked, so neither was looked at again. At one user
that is a handful of requests. On a shared link during a landfall it is
thousands of uncacheable requests per poll from thousands of client IPs, aimed
at a public-good European service and a federal ArcGIS deployment, with no
shared cache anywhere in the path — and **an origin collapse over the relay
could not have helped any of it, because none of that traffic ever passed
through anything we control.**

> **CORS-open is a permission, not a capacity plan.** The reason to relay a feed
> is whichever arrives first: the browser can't reach it, or we can't
> responsibly point a crowd at it. The second reason arrived late and was never
> re-checked against the endpoints that had already passed the first. The
> `ENDPOINT` block in `config/constants.js` was organised around
> "CORS-blocked vs CORS-OK" and that was simply the wrong axis.

**As built:** `functions/api/gdacs/events.js` and
`functions/api/nhc/mapserver.js`. Both forward-and-cache only; every field rule
still runs client-side, unchanged.

**The MapServer route builds the WHERE clause itself** rather than accepting
one. It takes a validated bin number, exactly as `advisory.js` takes a bin and
`warning.js` takes a product name — one more parameterized route, not a new
exception. Accepting a caller's `where` string would have made it an arbitrary
query proxy into a federal service: §17 A2's open-proxy problem, reopened on a
bigger endpoint.

**It forwards ArcGIS's 200-with-error verbatim and refuses to cache it**, so
the client can mark that layer `unavailable` rather than empty. Converting it
to a 502 would erase the distinction between a layer that failed and a layer
with nothing in it — two different sentences on the panel, by design (§5).

**The CSP shrank by four hosts** (`_headers`): `www.gdacs.org` and
`mapservices.weather.noaa.gov` because the browser no longer contacts them;
`www.nhc.noaa.gov` and `ftp.nhc.noaa.gov` because it never did — they were
relayed from the beginning and listed defensively. `pub-…r2.dev` went too: the
coastline archive is read by `functions/tiles/[[path]].js` and reaches the
browser as same-origin `/tiles/`. **The dead `preconnect` to that bucket in
`index.html` is also gone** — a TLS handshake per page load, spent on a
connection nothing ever used.

#### B2 — THE CRON WORKER (`worker/`)

**MEASURED CONSTRAINT — CRON TRIGGERS DO NOT WORK ON PAGES FUNCTIONS.**
Verified against Cloudflare's own Pages-to-Workers migration guide, 2026-07-25.
So: one small standalone Worker beside the Pages project, both binding the same
KV namespace. **Do NOT migrate Pages to Workers for this** — that risks a
deployment that currently works, for one feature.

**It is a separate deploy, and that is a safety property, not a detail.** The
Analytics Engine failure earlier the same day proved that one unusable binding
takes down **all** `/api/` routes, because Pages Functions publish as a single
Worker. A broken build in `worker/` fails only `worker/`. **Landfall's ability
to ship a fix during a storm must never depend on an infrastructure feature.**

**===> IT WARMS BY FETCHING OUR OWN RELAY ROUTES, NOT THE UPSTREAM SOURCES. <===**
This is the load-bearing decision in Pass B. Two routes do not forward their
upstream verbatim: `/api/jtwc/storms` builds a name lookup from the RSS plus
every warning product (§4's second bounded exception), and `/api/nhc/adeck`
filters a multi-megabyte deck to the five-model shortlist. A Worker fetching
upstream directly would need a second copy of both — the SUBJ regex and the
tech-column filter — in a runtime that renders nothing, across a deploy
boundary where drift is invisible. Calling our own routes means **one
implementation of every parse**, and what lands in KV is byte-identical to what
the route would have served.

**Pages Functions NEVER write to KV.** One writer, always. If a Function wrote
its upstream result back, 300 colos would each write the same key and we would
have rebuilt the exact write storm this pass deletes, with a bill attached.
Reads are cheap and bounded; writes are the metered thing. That rule is what
makes the write budget a number you can calculate in advance instead of a
function of traffic — there is no `kvWrite` in `functions/api/_kv-cache.js` on
purpose.

**Write-if-changed is the budget, not an optimisation.** The hash lives in each
key's KV **metadata**, and `list()` returns every key's metadata without any of
their values — so one list call per cycle yields every previous hash without
reading back a single 400 kB geometry blob. (The obvious alternative, one key
holding a map of all hashes, is a god-object with a read-modify-write race in
it. This needs neither.) **Measured on a full simulated cycle: nine keys
written on the first run, ZERO on the second.**

**`fetchedAt` is refreshed on a write and never otherwise**, and the asymmetry
is deliberate. An unchanged payload is not re-stamped, so a feed that has gone
quietly static **ages** in the store rather than looking eternally current. That
is §5 enforced by the infrastructure instead of hoped for: a source that stopped
updating must not read as a source that is fine.

**The warm-bypass header, and why it is gated.** Without it the Worker's request
is ordinary: the route answers from its colo cache or from the KV copy the
*previous* cycle wrote, the Worker stores what it already stored, and the warm
loop confirms its own last answer forever while never contacting the source
again — with every dashboard green. At a 5-minute cron against a 5-minute fresh
window that is not an edge case, it is the boundary every cycle lands on. It
costs a shared secret (`WARM_KEY`) because **an ungated cache bypass is a lever
any stranger pulls to drive uncached traffic through us at NOAA at whatever rate
they like, under our User-Agent** — §17 A2's hole on a bigger endpoint. Fails
closed: no key, no bypass, for anyone including us.

**What is deliberately NOT warmed, so nobody "finishes" the list later:**
`/api/nhc/mapserver` (its keys are the output of §4's block math plus a
resolve-by-name pass — warming it needs that arithmetic in a second copy, where
drift points a confident cone at the wrong storm, §7's wrong-but-plausible-layer
failure that already cost a day); `/api/imagery/radar` and `/api/geocode` (no
finite key set); the four `/inspect` routes (diagnostics). Colo caching already
took MapServer from per-reader to per-colo, which was the ~30x that mattered.
**If it ever becomes worth the last 300x, the honest way is to have the Worker
call the route rather than reimplement it.**

#### B3 — THE THREE-LEVEL READ, AND THE SAFETY VALVE

Every relay route now reads: **L1** `caches.default` (per-colo, free) → **L2**
KV (global, warmed) → **L3** upstream. Then on failure: colo last-good → the KV
copy it declined as unfresh, flagged stale → an honest 502.

**===> L3 IS NOT A FALLBACK, IT IS WHY THIS IS SAFE TO DEPLOY. <===**
Every route keeps its original upstream path completely intact. Missing binding,
empty namespace, Worker never deployed, cron silently dead for three days — each
degrades to **exactly pre-Pass-B behaviour** rather than going dark. A Worker
outage is a performance regression, not an outage. It is also why this can ship
before any Cloudflare setting is made.

**A KV entry with no `fetchedAt` is treated as STALE, never fresh.** An unstamped
value cannot be aged, and defaulting an unknown age to "current" is §5's failure
— absence read as safety.

**`kvRead` fails OPEN and `isWarmRequest` fails CLOSED**, in the same file, on
purpose: a missing cache binding must cost a user nothing (§17 A5's rule), and a
missing gate must not hand a bypass to everyone (§17 A2's rule). **A cache is a
convenience; a gate is a gate.**

#### WHAT WAS MEASURED, NOT ASSUMED

- **Cross-origin failures in the headless check fell from 12 to 4.** Same run,
  before and after, same 24 checks passing, same two known pre-existing drift
  failures (`graticule row not renamed`, `no install control in Settings`). The
  eight that vanished were GDACS and the NHC MapServer; the four that remain are
  OpenFreeMap tiles, which are supposed to be cross-origin. That is B1 visible
  in a measurement rather than argued for.
- **A full warm cycle: 9 written, then 0 written, then 1 after one body changed.**
  A dead feed is named and counted and the rest of the cycle continues.
- **All seven relay routes, four cases each** — no binding, fresh KV, stale KV
  with a dead upstream, and the warm bypass (plus a wrong-key bypass, refused).
- **`tools/test-kv-keys.mjs` caught a real bug before it shipped.** The writer
  validated the GDACS host with `startsWith('https://www.gdacs.org/')` on the
  raw string while the route checked `u.hostname` on the parsed URL. Those
  disagree on `https://www.gdacs.org:443/…` — the route accepts it, the string
  test rejects it — so the writer would have silently skipped a storm the reader
  was willing to serve. **Parse first, then judge the parsed parts. Never judge
  the string.**

#### THE CHECKER WAS SKIPPING THE TWO MOST-IMPORTED FILES UNDER functions/

Found while building this. **Two conventions collided and the checker lost:** in
this project a leading `_` has always meant "scratch, not shipped"; in Cloudflare
Pages Functions it means "**not a route**" — a shared module the real routes
import. So `_inspect-guard.js` (gates all four inspect endpoints) and
`_kv-cache.js` (now imported by every relay route) were the two most-depended-on
files under `functions/` and the only two `tools/check-syntax.mjs` never opened.

Worse than a parse gap: the LINK pass does `if (!known) continue` for any target
it did not collect, so **every named import from those files was unverified
too.** A typo'd `kvRead` would have printed a green tick and blanked the relay.
Fixed; the collector is now directory-aware. **Verify the verifier, then verify
what the verifier skips.**

#### BUDGET, AND THE ONE THING THAT COSTS MONEY

KV's free tier allows **1,000 writes/day**. The three list feeds alone on a
5-minute cron are 864/day before a single storm exists, and change-detection
does not help them much because a list feed's own timestamp moves. Add per-storm
products across a busy season and the realistic figure is **~1,200–1,500
writes/day**. **Expect to move to the $5/mo Workers Paid plan** (1M writes/month,
10M reads/month). That $5 is the cheapest possible insurance against the
invocation spike this whole pass exists to prevent. **Decide it before the storm,
not during it.**

**RATE LIMITING RULES ARE NOT AVAILABLE ON THIS PROJECT. Corrected 2026-07-26
— the previous version of this paragraph told the reader to go turn them on,
and they cannot be turned on.**

WAF rate limiting rules are created **per zone**, and **getgravitate.app is not
a Cloudflare zone**. §3 has said so since the beginning: the domain is
registered at Namecheap and stays there, and `landfall` reaches Pages by a
CNAME to `landfall-99g.pages.dev`. The Cloudflare account holds the Pages
project, the Worker, KV and R2 — and no domains at all. Confirmed on the
dashboard 2026-07-26.

**The only way to get the rules is to move the nameservers to Cloudflare, and
that is REJECTED.** It means recreating every DNS record for a domain whose
apex serves the separate Gravitate site on Firebase — real risk to a working,
unrelated property — and the free tier buys exactly ONE rule, IP-only, on a
fixed 10-second window. Wrong trade, and a spectacularly wrong trade in the
days before a deliberate traffic spike.

**AND THERE IS NO SPEND CAP UNDERNEATH IT — MAPBOX DOES NOT OFFER ONE.**
Confirmed against Mapbox's own billing documentation, 2026-07-26: accounts do
not support a spending cap or a usage limit after which service cuts off, and
there are no configurable usage alerts. **Past the free tier, service does not
stop — billing begins.** The only automatic signal is a courtesy email the
first time usage exceeds the free tier in a cycle. So the in-code limiter is
not the first line of defence with a backstop behind it. It is the only line.

**The numbers, so the risk is sized rather than feared.** Temporary geocoding
is free to **100,000 requests/month**, then $0.75 per 1,000. A person setting
a home address spends 3-8 requests (debounced at 250 ms, 3-character minimum),
and many never set one at all — geolocation and drop-a-pin are free paths. So
ordinary launch traffic does not get close; **the exposure is deliberate
abuse, not success.**

**What was changed 2026-07-26, and the reorder matters more than the number.**
`functions/api/geocode.js` now checks its 30-day result cache BEFORE the rate
limiter, so the limiter counts **billable** lookups instead of requests. The
old order charged a caller for a lookup that never touched Mapbox — worst for
everyone behind one mobile carrier's NAT, who share a single
`CF-Connecting-IP` and would have collected 429s during exactly the traffic
spike this pass exists for. That reorder is what made lowering the cap from
30 to 15/min/IP affordable.

**The per-colo undercount §15 records is real but it is an AGGREGATE
undercount**, and that distinction is what makes this adequate: one abuser's
requests land in one or two colos, so per-IP counting works close to as
intended against a single attacker, which is the threat this was ever for. A
Durable Object would fix the distributed case and is still not worth building
— §17's solo-user rule applies.

**THE EMERGENCY LEVER, and it is worth knowing before it is needed: DELETE
`MAPBOX_TOKEN` from the Pages environment variables.** Address search degrades
to `geocode_not_configured`, which is a handled state with its own honest
message rather than a crash, and both other ways to set a home keep working.
It is a 30-second kill switch for the only endpoint on the site that bills.

**The general lesson, and it is the one this document keeps re-learning: a
platform feature's availability is a property of YOUR account, not of the
product.** This is the Analytics Engine entitlement failure repeating in a new
place — read off the docs, correct about the product, wrong about whether it
could be switched on here. Check the dashboard before writing an instruction
that assumes a feature exists.

**One admitted tension.** §2 says no build step, and `worker/` has a
`package.json` and a wrangler dependency. There is no way around it: a Worker
with a cron trigger cannot be deployed from a static repo, and authoring it in
the dashboard instead would put shipped code outside git, which breaks the
larger rule that **GitHub is source of truth**. The toolchain is confined to
that one folder, the app still has none, and `worker/src/` has zero runtime
dependencies.

#### THE CLOUDFLARE SETUP — done 2026-07-25, recorded so it can be rebuilt

1. **KV namespace** `LANDFALL_CACHE`, id in `worker/wrangler.toml`. The id is a
   resource identifier, not a credential — it grants nothing without an API
   token on the account, so it belongs in the repo. `WARM_KEY` and
   `MAPBOX_TOKEN` are credentials and live in Cloudflare only.
2. **Worker `landfall-warm`** via Workers Builds, git-integrated to this repo
   with **root directory `/worker`**. `git push` deploys it, same loop as Pages.
   Cloudflare labels the root-directory field **"Path"**, under Advanced
   settings — it is not called root directory anywhere in that form.
3. **`WARM_KEY`** as a secret on the Worker AND an environment variable on the
   Pages project. Both sides, same value.
4. **KV binding `LANDFALL_CACHE`** on the Pages project. This is the step that
   turned the pass on.

**HOW TO VERIFY IT IS ACTUALLY WORKING, and why the obvious check is not
enough.** Hit `https://landfall-warm.<subdomain>.workers.dev/warm?key=<WARM_KEY>`.

**`ok: true` and `failed: 0` DO NOT MEAN THE PASS IS LIVE.** With a mismatched
`WARM_KEY` the routes still answer 200 — from the KV copy the previous cycle
wrote — the Worker stores what it already stored, and every counter in that
summary reads healthy while the loop confirms its own last answer forever and
no source is ever contacted again. The first live run looked identical in both
worlds, which is exactly why the summary now reports **`reachedSource`** and
leads with a plain `BYPASS REFUSED` warning naming the routes when it happens
(`worker/src/index.js`). **Read `reachedSource`, not `ok`.**

**A binding name typo does not throw.** It resolves to `undefined`, `kvRead`
returns null forever, every route quietly falls through to upstream, and the
whole pass deploys successfully and does nothing. `LANDFALL_CACHE` is spelled
identically in `wrangler.toml`, `functions/api/_kv-cache.js` and
`worker/src/index.js`, and `tools/test-kv-keys.mjs` asserts all three agree.

**Still true, carried from the old §15 item:** NHC and GDACS are public-good
endpoints, and pointing real traffic at them through a proxy is a different
relationship than one person polling for himself. Cache hard, keep the honest
User-Agent (already done), and **never let a client-side bug become a poll
storm** — the origin collapse makes that structurally impossible upstream, which
is half its value.

**Not a launch concern:** storm-name glyphs come from OpenFreeMap's font
endpoint, and the basemap tiles come from OpenFreeMap too (§11), so the map is
third-party end to end by choice. Self-hosting fonts only matters if the whole
basemap moves off OpenFreeMap.

### SETTLED — FIREBASE IS REJECTED. Do not re-propose it.

Evaluated 2026-07-25 against "save money, more robust, better performance." It
does none of the three.

- **Firestore / Auth** — adds server-side user state the project deliberately
  does not have (§2, §8: no accounts, home on the device). That is a feature.
- **Hosting / Cloud Functions** — duplicates Cloudflare on a different network
  with a second bill, and moves traffic off the edge it already sits on.
- **The web SDK is heavy JavaScript** on a project whose overriding lens is
  frame budget and time-to-first-paint on a phone. Directly counter to the
  stated priority.
- **Crashlytics is a native mobile SDK.** It is not the answer for a web PWA.
  Analytics Engine (A5) is.
- **Remote Config** — a JSON file on Cloudflare does it for free.

**The one genuinely good card is PUSH, and it does not need Firebase.**
"A storm is tracking toward your home" is probably the feature that earns a
permanent home-screen slot. But Web Push works natively — Chrome/Android, and
iOS 16.4+ for PWAs **installed to the home screen** (confirm the current iOS
constraint when the feature is actually built, not from memory) — and can be
sent straight from a Cloudflare Worker. Firebase would be a middleman.

**It is a v2 feature and a DELIBERATE §2 AMENDMENT, not a bolt-on**, because it
requires storing push subscriptions server-side. That is the one place
per-user server state is genuinely justified, and it must be decided as an
amendment in the open rather than arriving as a side effect of a build.

### IP, copying, and monetization — the honest position

**Landfall's client code CANNOT be protected, and no effort should be spent
trying.** It is a client-side PWA; every line ships to the browser. Minification
and obfuscation buy an afternoon against anyone competent, cost real
debuggability, and require the build step §2 deliberately does not have.
**Rejected — do not propose an obfuscation step.**

What actually holds:

1. **Copyright is automatic and already held.** The repo has **no LICENSE
   file**, which means all rights reserved — the strongest default. **Do not
   add an open-source license.** Add a copyright line to the Terms view (A1).
2. **The NAME is the commercial asset, not the code.** A clone can copy the JS;
   it cannot call itself Landfall. Worth a trademark search before spending
   anything — "landfall" is a common weather term and is in use by an existing
   games company, so clearance is not assumed.
3. **Server-side is the only real technical moat.** Anything computed in a
   Function is invisible to a copier. **If Landfall monetizes, that is where
   the paid features go** — and not before: moving free features server-side
   costs money, adds latency, and breaks offline.
4. **The private repo (2026-07-25) is a reasonable call and buys little.** It
   holds no secrets — `MAPBOX_TOKEN` is a Pages environment variable and
   correctly never in the repo — so it protects nothing that the shipped bundle
   does not already reveal. It does force a copier to reverse-engineer rather
   than clone. **VERIFY the Cloudflare Pages GitHub integration still has
   access**: flipping a repo private can silently drop it, and the failure
   looks like "I pushed and nothing deployed."
5. **THE ACTUAL MOAT IS THIS DOCUMENT.** Every hard-won fact in it — that GDACS
   `severity` is a forecast peak and not current wind, that
   `publicAdvisory.url` served a six-week-dead storm, that `+9` is the
   rasterized layer, that `beforeinstallprompt` is not a capability test — cost
   a day each. A copier gets a snapshot of the code and none of the reasoning,
   and walks into every one of those walls unaided.

**If it monetizes, the boundary is set here in advance:** core hazard
information stays free forever. Charging for hazard data during a disaster is
indefensible, and it is also the peak-cost moment — the two failures arrive
together. Revenue comes from convenience and depth: push alerts, multiple saved
locations, history, expert layers. That is the same set that has to live
server-side anyway (item 3), so the moat and the product boundary are the same
line.
