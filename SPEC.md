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
- Basemap tiles: Protomaps, self-hosted on Cloudflare R2 (see §11).
- PWA: web app manifest + service worker. Maskable icons for Android; 180x180
  non-transparent apple-touch-icon for iOS.
- Hosting: Cloudflare Pages (free tier). Deploy loop: push to main on GitHub →
  Pages builds → live URL. Done = deployed and confirmed on a real phone.
- One small server-side relay as a Cloudflare Pages Function (see §4). This is
  the only backend.
- **Firebase is not used.** Not a cost question — the reason is one vendor and
  no bandwidth meter. R2 charges nothing for egress; Google Cloud Storage bills
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
- **R2:** active. Bucket `landfall-tiles`, public at
  `https://pub-72a4a9c118d14117ace3a2fc6660f8e0.r2.dev`.
  **No payment method is required for R2.** A card is not a gate.
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
  phone on cell data.

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
2. **Edge-cache GDACS per-storm geometry. Keep it — but for the honest reason.**
   The HA project needed a 90-second timeout there, and that number drove this
   decision. It did NOT reproduce when probed 2026-07-23: three events returned
   in 375–984 ms. Three fast responses on one afternoon, from a datacentre, do
   not disprove a flaky endpoint — so the cache stays as cheap insurance against
   a source that has misbehaved before, NOT because the endpoint is currently
   unusable. Payloads are large (180–400 KB per event), which is its own reason
   to cache. Serve cached, refresh in background.
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
- GDACS quirks (hard-won, still true): track lines are grouped by intensity,
  not time — chronology must be reconstructed from time-labelled circles; its
  Green/Orange/Red polygons are the 34/50/64 kt wind bands; alert level
  (Green/Orange/Red) and affected-country list ride the event feed.
- NHC MapServer knowledge (hard-won, still true): each storm slot owns a block
  of 26 layers — block starts AT=4, EP=134, CP=264; layer id = block +
  (slot−1)×26 + offset; advisory wind field offset +13, forecast wind radii
  +12. Some layers store stormid lowercase → always match case-insensitively
  (`UPPER(stormid)=...`). Peak Storm Surge is its own MapServer
  (`NHC_PeakStormSurge`, polygon layer 2) with **no stormid field** — filter
  spatially by an envelope around the storm's position.
- Model tracks (a-deck): per-model latest cycle, dropped if >12 h behind the
  deck's newest. Clip leading points behind the storm's current position; anchor
  the line at the current dot. Model shortlist and colors: §7.

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

| What | Fresh | Serve stale until | Hard drop | Why |
|---|---|---|---|---|
| NHC storm list (relay) | 5 min | — | — | Well under the 30-min poll, so a poll never gets served its own previous copy |
| Model a-decks (relay) | 15 min | — | — | Synoptic cycles are 6-hourly |
| **GDACS geometry (relay)** | **30 min** | **6 h** | **12 h** | The 90-second endpoint. Serve stale, refresh behind it |
| Client geometry per (storm, advisory) | — | — | LRU, 8 storms | Key self-invalidates; cap stops unbounded growth |
| Last-good storm data (service worker) | — | 9 h | 9 h | ≈1.5× advisory cadence, carried from HA |

The GDACS row is the one that matters. A six-hour-old cone is roughly right and
infinitely better than a 90-second spinner on a phone. Past twelve hours it is
genuinely misleading — drop it and show `unavailable` rather than a stale shape.

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
| Cone of uncertainty | baseline, ambient from z4 | 4 |
| Past track (dotted) | baseline, ambient from z4 | 4 |
| Forecast track (solid) | baseline, ambient from z4 | 4 |
| Forecast points (SS-colored, coded) | baseline, ambient from z4 | 4 |
| Forecast time labels (spoke-placed) | additive, ambient from z4 | 4 |
| Watch/warning coastal stripe | exclusive pair A, ambient from z4 | 4 |
| Surge bands | exclusive pair A | 6 |
| Current-position wind field | exclusive pair B | 6 |
| Full-track wind swath | exclusive pair B | 6 |
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
- **AMBIENT, not selection-only.** Labels draw for every warmed storm from
  `ZOOM.ambientGeometry`, with no tap. They were originally held back on the
  grounds that `datelbl` on every point of every storm is a wall of text; the
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
- **`datelbl`** is a pre-formatted label ("1:00 PM Thu") and **`fldatelbl`** the
  long form with timezone. No date formatting needed for this layer.
- Also present per point: `maxwind`, `gust`, `mslp`, `tau` (forecast hour),
  `tcdvlp` ("Tropical Storm"), `tcdir`, `tcspd`, `validtime`.

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

### Watch/warning coastal segments — settled: client-side coast tracing
NHC publishes these as **breakpoints** (named coastal reference points), not as
coastline. Drawn naively, a warning covering Tampa Bay renders as a straight
chord slicing across open water.

The HA project solved this server-side and it works live. Port the approach,
client-side (Protomaps coastline vectors are already loaded, so this needs no
relay involvement):

- **Trace each segment against the coastline basemap** — re-cut it from the same
  vertices as the drawn coast. A traced segment *is* coastline and follows every
  bay and inlet.
- **Traced segments smooth with the coast** (same Catmull-Rom pass). Drawn
  straight against a curve-smoothed coastline, the stripe visibly peels off the
  shoreline on every bend.
- **Untraced segments draw straight**, flagged. This is the fallback when
  tracing fails, and the rule behind it is a principle: *official geometry isn't
  ours to curve.*
- **The legend dedupes by type.** After tracing, one warning emits several
  segments — the mainland run plus each fronting barrier island. Iterating
  segments naively stacks five identical rows.

This derives coverage from NHC's own breakpoints rather than inventing it, and
degrades to the raw chords with a flag rather than guessing. That's what makes
it honest.

**As-built: the stripe is TRACED, PER LEG, with one open bug.** Measured live
on Bertha 2026-07-23. The probe settled the questions the earlier note only
guessed at: NHC's segments are breakpoint chords (11 vertices over 464 km,
median spacing 51 km); breakpoints land a median 0.85 km from the drawn
shoreline (max 3.4), so snapping is well-posed; and the CURRENT basemap yields
3720 coast vertices at z6.4 — tracing did NOT have to wait for Protomaps. The
earlier note predicted it did, and was wrong.

Shape of the build:
- `map/coast-source.js` is the ONLY schema-aware file: it resolves Protomaps
  `earth` or OpenMapTiles `water`/ocean and returns rings of `[lon, lat]`.
  Flipping `TILES.useR2` changes the answer there and nothing else.
- `map/coast-trace.js` is pure `[lon, lat]` math and schema-blind. It stitches
  tile-clipped pieces (growing from BOTH ends — a tail-only stitcher leaves
  runs split and they read as separate landmasses), snaps each breakpoint to
  the nearest coast vertex, and walks between them.
- **Winding is never assumed.** Both walk directions are tried and the shorter
  by real distance wins, so the same code is correct on an ocean-edge and a
  land-edge schema with no flag.
- **Fallback is PER LEG.** NHC's breakpoint-to-breakpoint legs are the natural
  unit: each is a straight line NHC drew between two surveyed points, so
  keeping one as delivered while tracing its neighbours is exactly what
  "untraced segments draw straight, flagged" means. An earlier all-or-nothing
  rule discarded eight correct legs because one tripped a threshold.
- `map/coast-trace-cache.js` keeps the BEST trace per storm and re-traces on
  `moveend`. Coast vertices come from LOADED TILES ONLY, so a naive re-trace
  makes the stripe visibly degrade as you zoom out. A trace may only improve.

Measured result on Bertha: **9 of 10 legs trace**, ratios 1.0–1.9x with one
genuine bay at 6.5x (21.9 km chord, 141.5 km of barrier-island shoreline).

### OPEN BUG: wrong-way walks along tile edges
Leg 2 walks 448 km on a 49.8 km chord — 96% of the entire stripe. That is not
a bay; the walk is going around the outside of the landmass.

Cause, not yet fixed: on OpenMapTiles the coast is the edge of the OCEAN
POLYGON, and a tile-clipped ocean polygon's ring is part real shoreline and
part **straight tile boundary**. The walk can follow those artificial edges.
The fix is to filter tile-boundary vertices out of the rings before walking —
they are detectable, lying exactly on tile edges and running perfectly
straight. Until then `maxTraceRatio` catches the runaway and that leg keeps
NHC's chord, flagged.

`COAST_TRACE.maxTraceRatio` (7.5) is fitted to ONE storm's leg distribution,
not derived from a principle, and will need revisiting on differently shaped
coastline. `maxStrayRatio` was intended as a wrong-way detector and is NOT one:
a real bay measured 0.76 and a wrong-way walk 0.86, which overlap. It survives
only as a loose sanity bound.

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
  - **Geometry-dependent home, Phase 6:** wind-arrival, at-home exposure
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
  over. The volumetric globe is still the real product. **The node cage is an
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
| **z3–4 · Basin** | + major islands; 3D cage handed off to MapLibre, continents solid | + category color, storm names. **At z4: ALL ambient storm geometry at once** — past track, forecast track, cone, forecast points with their codes, time labels, watch/warning stripe |
| **z5–6 · Regional** | + detailed coastline, inlets | (no new storm layers — the set already arrived at z4) |
| **z7–8 · Local** | Full coastline detail, bays, barrier islands | + surge bands, wind bands |

- **No names at z0–2.** Six names scattered across a globe you can barely see is
  a mess, and at that distance the question is "how many and how bad" — which
  color and glyph already answer. Names arrive once you have committed to a
  region.
- **ALL AMBIENT STORM GEOMETRY ARRIVES ON ONE STEP (z4).** The layers used to
  ladder in separately — past track at basin, cone and forecast at regional,
  stripe at local. On glass that read as a rendering bug, not as a ladder: you
  crossed z3, got a lone past track, then two levels of nothing before the rest
  appeared. Every ambient layer now keys off the single `ZOOM.ambientGeometry`
  constant so they cannot drift apart again. The ladder still governs storm
  geometry versus BASEMAP detail; it no longer staggers storm geometry against
  itself.
- **The watch/warning stripe now draws at z4, ahead of the coastal detail it
  hugs.** That is a deliberate trade for the single arrival. The stripe is still
  untraced (§7 as-built), so it may visibly chord across bays at z4 — if it
  reads badly the fix is tracing it against real vertices, NOT moving its floor
  back up and re-staggering the set.
- **Coastal detail at z7–8, not sooner.** §11 caps tiles at z8 precisely because
  that is where inlets and barrier islands resolve.
- **Selection overrides the ladder.** Select a storm from the list at z1 and its
  cone draws immediately — you asked for it explicitly. The ladder governs
  *ambient* detail, not requested detail.
- `[DECIDE]` Exact z-thresholds, once there is a real basemap to look at.
- `[DECIDE]` Whether z0–2 carries any text at all.

### The home marker (as-built)
Home floats ABOVE the node lattice, tethered to its exact surface point. Every
value lives in `HOME` in `config/constants.js`; all are guesses until measured.

- **Altitude is expressed in EARTH RADII, not pixels**, and converted per frame
  using MapLibre's measured on-screen globe radius — so it scales with the
  planet automatically at every zoom ("moves with the radius of the earth").
- **The altitude SHRINKS as you zoom in** (`altFar` 0.06 → `altNear` 0.004,
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
  This trap has now been hit twice, in two files (§2 sized the Three globe with
  it); if a third place needs a limb radius, it calls `silhouetteRadiusPx`.
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

### The storm glyph
- **Simplified two-arm spiral**, rotated by hemisphere — counterclockwise north,
  clockwise south. Physically real, free to implement.
- **Size-scaled by category, never shape-scaled.** A Cat 5 is a bigger glyph, not
  a more elaborate one. It has to stay legible at ~12 px on a phone at z1, and a
  detailed spiral turns to mush at that size.
- **Non-tropical `nature` values get a plain dot, not a spiral.** The glyph means
  "this is a cyclone."
- **Screen-pixel sized with a modest zoom ramp, never map units.** A position
  marker must not balloon into an area as you zoom — but a truly constant
  glyph felt lost at z8, so icon-size grows ~0.8→1.5 across the basin→max
  range (`glyphZoomMin`/`glyphZoomMax` in tokens, the sweet-spot knobs).
- **Visible glyph is ~26 px at base; the hit area is never under 44 px.** Below
  ~26 px the glyph reads as debris at regional zoom.
- `[DECIDE]` Whether the glyph rotates slowly. Leaning no — animating N sprites
  forever is a battery cost for decoration.

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

## 11. Basemap tiles — settled: Protomaps, self-hosted, capped at z8

**Decision:** build a Protomaps `.pmtiles` file covering the planet at zoom
levels 0–8, host it on Cloudflare R2, style it ourselves.

Why self-hosted rather than a hosted service: the usual downside of self-hosting
is regenerating the file as map data goes stale — but Landfall needs coastlines,
and coastlines don't move. Upload once, never touch it again, depend on nobody's
server but Cloudflare's. R2 charges nothing for egress, so no meter ever runs.

**Why z8 is the ceiling — a design decision as much as a budget one.** The
question this app answers at close range is "is the cone over Tampa Bay or west
of it." That's z8: a metro area with inlets and barrier islands resolved. Past
z8 you pull in street grids, which are visual noise for storm data and would
wreck the lit-globe look. Do not reopen this as a cost question.

**Current state: the tile file does not exist yet.** Landfall is running on
**OpenFreeMap** as scaffolding — §11 already names it as the legitimate fallback
if self-hosting ever becomes a burden, and using it as temporary scaffolding is
the same call made earlier. The R2 bucket is live and public but empty. Swapping
over is one flag: `TILES.useR2` in `config/constants.js`. **Delete this
paragraph the day the .pmtiles file is uploaded.**

**The `pmtiles://` protocol must be registered — MapLibre has no native support
for it.** `style-dark.js` emits a `pmtiles://` source URL when `useR2` is true;
`index.html` loads the pmtiles library and `main.js` calls
`maplibregl.addProtocol` in `registerPmtiles()` before `createGlobe()` parses the
style. Both are unconditional, so the flag stays the only edit. **Registration
order matters — after style parse is too late**, and an unregistered scheme fails
on style load with an unreadable protocol error.

**Fonts are not yet self-hosted.** `glyphs` in `style-dark.js` points at
OpenFreeMap's font endpoint regardless of `useR2`, so every text layer — storm
name labels, live since Phase 2 — fetches glyphs from OpenFreeMap even when
tiles come from R2. Self-hosting fonts in the same bucket is an open decision
(§15), not a bug, but "R2 tiles" does not currently mean "no third-party
dependency."

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

- `[VERIFY]` Actual file size at z0–8. Anchors: the full z0–15 planet is ~120 GB;
  a z0–6 planet is ~60 MB. Growth is roughly 3× per level, putting z0–8 around
  500–700 MB — comfortably inside R2's 10 GB free tier, but unmeasured. One
  `pmtiles extract` run tells us.
- `[VERIFY]` Cloudflare Pages caps individual files at ~25 MB, which is why the
  tile file lives in R2 rather than the repo.
- Raising the ceiling later means regenerating and re-uploading one file. Not a
  one-way door, but not free either — hence the design argument above.

**Rejected:**
- **Google Maps.** Three independent blockers: (1) it's a second rendering
  engine that can't share MapLibre's canvas, so switching at a zoom threshold is
  a hard cut, and their terms forbid rendering Google tiles in a third-party
  engine anyway; (2) a billing account with a card is required even inside the
  free tier, and without one the APIs throttle to 1 request/day; (3) the JSON
  styling tool is the legacy path — Google has moved to cloud-hosted styling.
  Also worth recording: every free vector supplier gives *identical* control
  over look and feel, because they all hand over raw geometry and we write the
  style. Supplier choice was never a design-control question.
- **OpenFreeMap.** Genuinely free, full planet, no key, no card — and the
  fallback if self-hosting ever becomes a burden. Rejected only because it's one
  person's donation-funded server, and the globe is the part that must never
  fail. Switching to it is a config change, not a rewrite.
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
config/     constants.js  tokens.js  motion.js        (imports nothing)
lib/        units.js  geo.js  time.js  category.js    (pure functions)
data/       relay.js  nhc.js  nhc-mapserver.js
            gdacs.js  merge.js  cache.js  store.js    (no DOM, ever)
map/        globe.js  style-dark.js  graticule.js
            markers.js  coast-trace.js
            layers/registry.js  layers/*.js
ui/         panel-storms.js  panel-storm-detail.js
            panel-layers.js  home.js  status.js
main.js     wiring only — target under 100 lines
```

**Built so far**: `config/{constants,tokens,motion}.js`,
`lib/{geo,category,basin,time,units,watchwarning}.js`,
`data/{relay,nhc,gdacs,merge,store,home,geocode,nhc-mapserver,cache,warm}.js`,
`map/{globe,globe3d,heightfield,coastline,glyph,style-dark,graticule,markers,marker-home,marker-home-geometry,chrome-avoid,pin-provisional,coast-trace}.js`,
`map/layers/{registry,index,cone,track-past,track-forecast,points-forecast,watch-warning}.js`,
`ui/{status,panel-storms,panel-storm-detail,panel-home}.js`, `ui/{panels,home}.css`, `main.js`,
`index.html`, and two Pages Functions: `functions/api/nhc/storms.js` and
`functions/api/geocode.js`. Both are self-contained on purpose — Pages
Functions run in their own workerd runtime, and importing config/ would couple
a static site to a bundle step; their cache numbers mirror §4's table, which
stays the truth.

`ui/panel-home.js` is the ONE ui/ file that imports `data/` directly
(`home.js`, `geocode.js`). It owns the setup flow, so it owns those calls.
`panel-storms.js` and `panel-storm-detail.js` take home (and, for the detail
panel, the geometry lifecycle) through injected façades from `main.js` —
they only READ, and injection keeps the arrow pointing one way.
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
  legible at every zoom — it lives in `#attrib-host`, a fixed *sibling* of
  `#globe`, mounted by calling the control's `onAdd()` directly. MapLibre's
  compact rules scoped to its own corner containers are replicated for the host
  in `index.html`; check those if the "i" ever jumps sides.
- **Read a third-party library's shipped CSS before overriding it.** MapLibre's
  compact attribution sets its own `background` *and* `color` on the container.
  Recoloring only the links leaves the non-link text at `#000` — black on dark
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
cone → model tracks → past track → forecast track →
wind field/swath →
[coastal pair: watch/warning stripe OR surge bands] →
forecast points → storm dot → home marker → labels → off-screen pointer
```

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

1. **Skeleton on glass + 3D entry — DONE except tiles.** Repo, accounts, DNS, R2
   bucket, Pages project all live (§3). The 3D clear globe is the entry (§2):
   blue-family land, grey coasts, the cyan geodesic cage, storm severity as node
   elevation AND node color, and the zoom-driven crossfade into MapLibre — which renders filled
   land, two-pass glowing coasts, and depth fade behind it. Graticule ships off
   by default. Tokens, constants, motion carry real values.
   **Still open:** build the z0–8 `.pmtiles` file, upload to R2, flip
   `TILES.useR2`; measure the entry frame on a real phone (two engines run on
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
   - **Closest approach is now LIVE (Phase 4)** — the detail panel decorates
     the selected storm with the geometry bundle's normalized forecast points
     and `closestApproach()` computes against them, exactly the shape it was
     written for; no edit was needed here. Storms without a forecast track
     (GDACS, or a failed geometry fetch) still honestly show distance only.
   - **Settings panel not built.** Units resolve from locale via
     `lib/units.js`; the manual override (§8) has nowhere to live yet. Auto is
     correct for most users, so this is a gap, not a blocker.
   - **`MAPBOX_TOKEN` is not yet set in Cloudflare Pages.** Until it is,
     `/api/geocode` returns `geocode_not_configured` and the panel says address
     search isn't set up, offering the pin instead. Geolocation and pin-drag
     work without it. This is configuration, not code.
4. **Select → fly + detail — BUILT, awaiting on-glass verification.** Selection
   (dot tap, list row, Enter) opens the storm detail panel in the list's slot
   and flies the camera with a one-shot `offset` derived from the panel's real
   box (never `padding` — §16). Per-storm MapServer geometry — cone, past
   track, forecast track, SS-colored forecast points (`ssnum`, reported) with
   verbatim `datelbl` time labels (additive toggle, default ON, ladder-gated),
   watch/warning stripe in §6 colors — through a per-(storm, advisory) LRU
   cache that also caches failures (re-selection retries).
   **Geometry is WARM and AMBIENT (§9):** `data/warm.js` prefetches bundles
   for every NHC storm as the feed lands, and the layer engine draws them all
   from ONE band floor (`ZOOM.ambientGeometry`, z4) so the whole set arrives
   together, with no tap required. Ambient time labels are ON, spoke-placed
   (§7) — the wall-of-text objection that kept them off is answered by the
   placement pass, which hides only what genuinely cannot fit. **The label
   SPOKE AXIS is STILL BROKEN (§15) — labels sit above/below their dot rather
   than radiating from it. A real grouping bug was found and fixed along the
   way (storms were placed as one track) but did not resolve this. Four
   suspects are now ruled out by live measurement; see §15.**
   Selection draws the tapped storm's full set at any zoom and excludes it
   from the ambient collections so nothing double-draws. The detail panel carries the freshness-
   banded timestamp, the geometry-lag second line (time-based via
   GEOMETRY_LAG_THRESHOLD; validated against the live Bertha/Fausto lag
   measurements), the home block with `closestApproach()` now live, three
   distinct watch/warning strings (none / unavailable / not-available-for-
   GDACS), ghost form in place, and persisted section collapse. Closing a
   panel holds the camera AND the drawn geometry; recenter (button or
   Esc-twice, one shared path) ends the selection.
   **Deliberate deviations, with reasons:** watch/warning stripe is untraced
   (§7 as-built — no Protomaps vertices to trace against yet); layer ids are
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
6. **Layers.** Layers panel (§7); wind field/swath, surge + surge-at-home,
   wind-arrival and exposure timeline, model tracks with the per-model
   selector, advisory text — one at a time in the §7 model.
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

**Method note, earned three times over.** Every fix here that passed offline
validation has failed on glass, because the isolation tests feed synthetic
tracks that cannot reproduce the real conditions. Reading live feature
properties in the browser killed four standing suspects in one step. Do not
open the next attempt with a validator run. Measure the running app first.

**Still to verify on glass:**
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

**Finish Phase 1 (needs a terminal):**
3. Build the z0–8 `.pmtiles` file (`pmtiles extract`), upload to R2, flip
   `TILES.useR2`. Answers the file-size `[VERIFY]` in §11. **The client side is
   ready but has never run against a real .pmtiles file** — the library loads
   and `registerPmtiles()` registers the protocol, so the flag flip is the only
   edit, and the first flip is the first real test.
   Storm-name labels still fetch glyphs from OpenFreeMap's font endpoint even on
   R2 tiles (§11). Decide then whether to self-host fonts in the same bucket —
   until that happens, "R2 tiles" does not mean "no third-party dependency."
4. Measure time-to-first-paint on a real phone (fold into item 2's pass).

**The node-elevation heightfield (`map/heightfield.js`, §9):**
5. Turn the current-fix peaks into the **full comet-tail**: feed the
   `setStormPoints()` seam the whole storm track, each point at its intensity-
   at-that-time, live head tallest. Needs storm-track geometry — NHC past-track
   is CORS-blocked (build the relay), GDACS track is the slow/flaky geometry
   endpoint (relay-cache it). The seam already takes a weighted-point list, so
   this is data plumbing, not a rewrite.
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

    The probe scaffolding (`functions/api/probe.js`, `probes/`) was deleted
    after use, along with its Cloudflare secrets `PROBE_GH_TOKEN` and
    `PROBE_SECRET`. **The pattern is worth repeating** if a later phase needs
    live data the sandbox cannot reach: its egress proxy allowlists github.com
    but not NOAA or GDACS, so a Pages Function that fetches upstream and commits
    raw responses to the repo is the bridge. Rebuild it from this note; do not
    leave a repo-writing endpoint deployed between uses.

    The IN-APP coast probe (`map/coast-probe.js`, the `?probe=coast` button,
    the `__rawStripeFeatures` hook on the stripe layer, and six probe-only
    exports on `map/coast-trace.js`) was likewise removed after use. Its
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
    - Storm-name label glyphs still come from OpenFreeMap's font endpoint even
      on R2 tiles (§11). That is a third party in the hot path of every map
      render. Self-host the fonts in the same bucket.
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

### One panel system
Every panel is the same component with different contents: glass, translucent,
globe visible behind, never full-screen.

**Docking adapts to width, not device** — same DOM element, CSS moves it:

- Narrow → bottom sheet, slides up, ~60% height max
- Wide → left rail, fixed width, full height

No `isMobile`, no second markup tree. A touchscreen laptop gets the rail because
it is wide, and that is correct.

**One panel open at a time, on every screen size.** A phone has no room for two,
and matching the behavior on desktop means one state machine instead of two.
Opening Layers closes Storms. Esc closes. `[DECIDE]` whether a second desktop
slot earns its place in Phase 8.

| Panel | Contents | Phase |
|---|---|---|
| **Storms** | Storm list. Tab order and screen-reader authority. Scope filter joins in Phase 3. | 2 |
| **Storm detail** | Replaces Storms in the same slot, back button. | 4 |
| **Layers** | Three groups, exclusive pairs as segmented controls, per-model selector with swatches (§7). | 6 |
| **Home** | Distance and closest approach in Phase 3; wind arrival, exposure timeline, surge-at-home in Phase 6. | 3 |
| **Settings** | Units override, light/dark, default scope. | 3 |

Detail replacing list in the same slot — rather than stacking — keeps it to one
slot at every width, and back-to-list is a motion everyone already knows.

### First launch
- **Narrow:** collapsed pill above the thumb zone — `6 active storms`. Tap
  expands to the full sheet. Same component collapsed and expanded, so there is
  one storm list, not two.
- **Wide:** storm list open. There is room, and it is the primary navigation.
- Tab from the globe opens the list either way.

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

**6. Layer toggles for this storm** — the exclusive pairs and additive layers
relevant to the selection, inline. Selecting a storm and immediately wanting its
wind field is the common path. Full layer config stays in the Layers panel; this
is the shortcut, not a duplicate.

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
  meaningless. No layer toggles.

**Failure states:**
- Storm in feed, geometry failed → panel renders fully from feed data; the map
  lacks the cone; the failure is named on the layer, not here.
- Selected storm's source goes down → panel holds with stale flag. Never blanks.
- Storm leaves the feed while open → becomes the ghost panel in place. No forced
  navigation.
