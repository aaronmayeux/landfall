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

| Endpoint | Browser fetch | Consequence |
|---|---|---|
| `https://www.nhc.noaa.gov/CurrentStorms.json` | **BLOCKED** (no CORS header; server itself returns 200) | Must go through the relay |
| `https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer` | **OK** | Direct fetch from the app |
| `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP` | **OK** | Direct fetch from the app |
| `https://ftp.nhc.noaa.gov/atcf/aid_public/` (model a-decks) | **BLOCKED** (no CORS header; server returns 200) | Must go through the relay |

### Still untested — verify before building on them
- `[VERIFY]` GDACS per-event geometry endpoint (getgeometry — the cone). Sibling
  list endpoint passed, so likely OK, but unproven. Known from the HA project to
  be slow and flaky (needed a 90 s timeout there) — relay-cached regardless.
- `[VERIFY]` IEM GOES satellite WMS (`https://mesonet.agron.iastate.edu/cgi-bin/wms/goes_east.cgi`).
- `[VERIFY]` NOAA nowCOAST MRMS radar ImageServer (same host as the MapServer
  that passed, so likely OK; unproven).
- `[VERIFY]` Whether the MapServer's per-storm layers fully replace the zipped
  shapefiles: cone, forecast track, forecast points w/ intensity, past track,
  watch/warning lines, all as GeoJSON (`f=geojson`). High confidence; must be
  probed against a live storm before the data layer is coded.
- `[VERIFY]` The advisory-number field name in `CurrentStorms.json`, and whether
  it carries an explicit final-advisory flag. Both feed §4's advisory key and
  §5's ghost-storm wording. Believed present; not read from the live feed.
- `[VERIFY]` Whether the MapServer exposes a per-layer advisory number or
  issuance timestamp. Needed for the geometry-lag rule below.

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
2. **Edge-cache GDACS per-storm geometry. Non-negotiable, not an optimization.**
   That endpoint needed a 90-second timeout on the HA project. A 90-second wait
   on a phone is a dead app. Serve cached, refresh in background.
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

**Geometry lag is a real failure mode.** The MapServer updates on its own
schedule and can trail the JSON storm list. Caching cone geometry under the
JSON's advisory number would serve last advisory's cone labelled as current —
a smaller promise rendering larger data, which §5 forbids outright.

Rule: **the geometry cache stores its own timestamp from the MapServer response,
and the UI displays that timestamp, not the storm's.** When they disagree by
more than one advisory cycle, say so (§16).

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
  12A · 11:00 PM Thu · Cat 2, 85 kt."* If NHC flags a final advisory explicitly
  (`[VERIFY]`, §4), "final advisory issued" is allowed.
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
| Cone of uncertainty | baseline, on selection | 4 |
| Past track | baseline, on selection | 4 |
| Forecast track | baseline, on selection | 4 |
| Forecast points (SS-colored) | baseline, on selection | 4 |
| Watch/warning coastal stripe | exclusive pair A | 4 |
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
- **The toggle gates whether times draw at all; the zoom ladder gates when.**
  Forecast points appear at z5–6 (§9), so toggle-on below z5 draws nothing,
  silently. That is not a soft-fail needing a name — the ladder is doing its
  job.
- `[DECIDE]` If a five-day track at z5 is too dense, thin to 24 h intervals
  rather than culling. Measure on glass in Phase 4.

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
  - Atmosphere: MapLibre's globe sky/fog layer, thin rim light at the horizon.
  - **Flat lighting — MapLibre `light.intensity: 0`.** The default directional
    light shades the globe like a lit ball, producing a dark limb and a lit face
    that read as a day/night terminator. It is not one: the light is anchored to
    the map, so the "night side" never corresponded to the actual time of day
    anywhere on Earth. A globe that implies information it does not have is
    worse than a flat one. The sphere is lit identically everywhere and the only
    thing that varies across it is real data.
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
| **z3–4 · Basin** | + major islands; 3D cage handed off to MapLibre, continents solid | + category color, storm names, past track |
| **z5–6 · Regional** | + detailed coastline, inlets | + cone, forecast track, forecast points |
| **z7–8 · Local** | Full coastline detail, bays, barrier islands | + watch/warning stripe, surge bands, wind bands |

- **No names at z0–2.** Six names scattered across a globe you can barely see is
  a mess, and at that distance the question is "how many and how bad" — which
  color and glyph already answer. Names arrive once you have committed to a
  region.
- **Coastal detail at z7–8, not sooner.** §11 caps tiles at z8 precisely because
  that is where inlets and barrier islands resolve. The watch/warning stripe is
  traced against coastline vertices (§7); drawing it at z3 means tracing against
  geometry that is not there yet. The stripe and the coast detail arrive
  together.
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
  visibly terminates ON something.
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
  `ON_GLOBE` (near face, in viewport) — marker + tether, no pointer.
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
`lib/{geo,category,basin,time,units}.js`,
`data/{relay,nhc,gdacs,merge,store,home,geocode}.js`,
`map/{globe,globe3d,heightfield,coastline,glyph,style-dark,graticule,markers,marker-home,pin-provisional}.js`,
`ui/{status,panel-storms,panel-home}.js`, `ui/{panels,home}.css`, `main.js`,
`index.html`, and two Pages Functions: `functions/api/nhc/storms.js` and
`functions/api/geocode.js`. Both are self-contained on purpose — Pages
Functions run in their own workerd runtime, and importing config/ would couple
a static site to a bundle step; their cache numbers mirror §4's table, which
stays the truth.

`ui/panel-home.js` is the ONE ui/ file that imports `data/` directly
(`home.js`, `geocode.js`). It owns the setup flow, so it owns those calls.
`panel-storms.js` takes home through an injected façade from `main.js` instead
— it only READS home, and injection keeps the arrow pointing one way.
Not yet built in `data/`: `nhc-mapserver.js` and `cache.js` (Phase 4 —
per-storm geometry). `map/layers/` does not exist until Phase 4 either.
**Storm layers attach on `style.load`, never on `load`** — `load` waits on
basemap tiles, and a basemap outage must not blind the storm layer (§5). This
was caught in testing, not on glass; keep it true.

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
   UI — absent, not disabled. Row/dot activation flies the camera (an early
   Phase 4 slice — no detail panel, no panel padding yet).
3. **Home — DONE. Deployed and confirmed on a real phone.** Location set three
   ways (geolocation, Mapbox address search, drag-a-pin — never prompted on
   first launch); home marker as a house glyph floating above the lattice on a
   zoom-scaled altitude curve, tethered along the surface normal to its exact
   surface point; off-screen pointer (house + arrow on one axis) riding the limb
   with a bob and routing around on-screen chrome; distance on every storm row;
   scope filter live with all three scopes; storm list flips to nearest-first
   within basin order.
   **Deliberately deferred, with reasons:**
   - **Closest approach returns null** for every storm until Phase 4. The
     normalized storm object has no forecast track — that geometry arrives with
     the cone. `closestApproach()` is written against the shape those points
     will land in and documented at its definition, so Phase 4 lights it up
     with no edit here. Distance and bearing work today.
   - **Settings panel not built.** Units resolve from locale via
     `lib/units.js`; the manual override (§8) has nowhere to live yet. Auto is
     correct for most users, so this is a gap, not a blocker.
   - **`MAPBOX_TOKEN` is not yet set in Cloudflare Pages.** Until it is,
     `/api/geocode` returns `geocode_not_configured` and the panel says address
     search isn't set up, offering the pin instead. Geolocation and pin-drag
     work without it. This is configuration, not code.
4. **Select → fly.** Tap/click/keyboard selection; camera flyTo with panel
   offset; cone, tracks, forecast points, forecast point times, watch/warnings
   (with coast tracing, §7) from MapServer GeoJSON; storm detail panel — built
   with its home block live from the start, not retrofitted.
5. **PWA.** Manifest, icons, service worker with stale-while-revalidate;
   install verified on iOS and Android.
6. **Layers.** Layers panel (§7); wind field/swath, surge + surge-at-home,
   wind-arrival and exposure timeline, model tracks with the per-model
   selector, advisory text — one at a time in the §7 model.
7. **Imagery + playback.** Satellite/radar layers, play/scrub loop.
8. **Polish.** Idle rotation tuning, light mode pass, animation tuning,
   a11y audit, color-contract audit against the real basemap.

## 15. Open decisions — next session agenda

Everything remaining is either measure-on-glass or a live probe; there is
nothing left to design on a whiteboard.

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
12. Whether forecast point times need thinning at z5 (§7).

**Live probes (§4, §11):**
13. GDACS per-event geometry CORS; IEM GOES WMS; NOAA nowCOAST radar
    ImageServer; MapServer GeoJSON completeness; the advisory-number field name
    and final-advisory flag in `CurrentStorms.json`; whether MapServer exposes
    a per-layer advisory number or issuance timestamp.

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
  lands the storm underneath the panel that just opened. MapLibre takes a
  padding option for exactly this. Invisible on a desktop browser, obvious the
  moment you hold a phone.
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
