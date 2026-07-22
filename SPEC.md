# SPEC.md — Landfall

**Status: SPEC.** Live state as of the end of session four (2026-07-22). This
document describes the project only as it is right now. It is not a log — when a
fact goes stale, delete it and replace it. No "update:" notes, no history.

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

- MapLibre GL JS v5+, globe projection, loaded from CDN.
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
  **R2 activated with no payment method required.** This was a long-standing
  open question carried from earlier sessions; it is now settled, and settled
  *no*. A card is not a gate on R2.
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
| Graticule | additive | 1 |

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

- **How it's set:** both. Geolocation is the one-tap path; manual pin/search is
  the fallback. **Never prompt for location on first launch** — a permission
  dialog before someone knows what the app is gets denied, and iOS makes that
  hard to undo. Prompt only when they tap "use my location."
- **v1 features** — all of them ship:
  - Home marker on the globe, with an off-screen pointer
  - Distance to storm
  - Forecast closest approach (+hours)
  - Wind-arrival ("at home") status
  - At-home exposure timeline
  - Surge-at-home
- **Sequencing — home splits in two, and the split is by data dependency:**
  - **Geometry-free home, Phase 3:** location set, home marker, off-screen
    pointer, distance, forecast closest approach. These need only the storm's
    position and forecast track, both of which exist in Phase 2's feed data.
  - **Geometry-dependent home, Phase 6:** wind-arrival, at-home exposure
    timeline, surge-at-home. These need forecast wind radii and the Peak Storm
    Surge service, neither of which exists until the layers phase. Peak Storm
    Surge has no stormid field and must be filtered spatially, so building the
    at-home version before the surge layer would mean writing that
    fetch-and-filter twice.
- **Home moved up to Phase 3 deliberately.** It is not a feature, it is a
  *reference point* four other things depend on: storm-list sort order, the
  scope filter, the opening sequence's resting position, and the detail
  panel's home block. Building Phases 2 and 4 without it means writing the
  fallback path first and the real path second — exactly the "hand-tune twice"
  failure §12 forbids. The cost is that Phase 3 has no visible payoff on the
  globe beyond a marker; select-and-fly, the moment the app feels real, moves
  back one step. That is a motivation cost, not a technical one, and it was
  accepted knowingly.
- **Every home figure carries the advisory timestamp it came from.** "Closest
  approach in 14 hours" from a six-hour-old advisory is a different sentence
  than the same words from a fresh one. This is the one screen where someone
  may make a real decision; stale gets labelled stale (§5).
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
- **Visual direction: lit volumetric globe, not a wireframe skeleton.**
  - **Land is filled.** Filled land against dark ocean reads as a globe and
    gives storm dots and cones something solid to sit on. Land fill values are
    chosen against the §6 storm colors.
  - Glowing coastline edges ride on top of the fills — the same line drawn
    **twice**: wide/dim/blurred underneath, thin/bright on top. MapLibre's
    `line-blur` does what a third pass would have. As-built and correct; do not
    "restore" a third pass.
  - Depth fade: line opacity and width driven by zoom, so distant coastlines are
    faint threads and near ones are crisp.
  - Graticule (lat/long grid), generated in code — no tile source carries it.
    Dimmer than the coast; it's what gives the "digital sphere" read.
  - Atmosphere: MapLibre's globe sky/fog layer, thin rim light at the horizon.
- **Dark by default** (night-sky globe), **light mode included**. `[DECIDE]`
  light-mode look — needs a real design pass against the actual basemap, not an
  inversion.
- **Floating menus**: panels float over the globe (glass/translucent), globe
  visible behind. No full-screen page takeovers.
- **Beautiful AND informative** — equal billing. Animation polish where it
  helps: camera flyTo on selection, panel enter/exit, layer fades. Animate
  transform and opacity only.
- **Idle globe rotation**: gentle auto-rotate when untouched; stops instantly
  on interaction; disabled when OS reduce-motion is set. `[DECIDE]` resume
  delay + rotation speed (constants file).
- **Imagery playback**: a play button animates radar/satellite through their
  recent timestamped frames, with a scrubber. Heaviest feature in the app —
  only ever runs on explicit press, never in the background. `[DECIDE]` loop
  length (frame count / time span) and preload strategy.
- Accessibility: 44 px touch targets; every interactive element
  keyboard-reachable and screen-reader-labeled; visible focus ring always;
  contrast meets WCAG AA in both modes.
- Verify at phone width and desktop width before anything is called done.

### Opening sequence
The globe arrives from a distance and rotates into its resting position. This is
the first thing anyone sees, and it delays time-to-first-paint — the Phase 1
baseline (§14) — so it is deliberately short.

- **Zoom-in and rotation run together, not in sequence.** The camera pulls in
  while the globe turns. One continuous move, half the wall-clock time.
- **~3.5 s total, ease-out** — fast at the start, settling gently into the idle
  drift.
- **Storm dots fade in during the last third.** The answer to "is anything out
  there" arrives before the intro does.
- **Any input aborts instantly** — touch, click, key, scroll snap to the resting
  state. Never trap someone in an animation. Same rule as idle rotation stopping
  on interaction.
- **Skipped entirely on reduce-motion**, and **skipped on warm loads.** Someone
  checking twice during a landfall must not sit through it twice. Warm-load
  window is a motion constant.
- **Resting position:** the most significant active storm → home, if set → fixed
  Atlantic view. The app's job is telling you what is happening; if there is a
  Cat 4 out there, ending the intro looking at it is the most useful place to
  be. "Most significant" = strongest, or nearest-to-home when home is set and
  something is within the filter radius.
- **Camera-only.** The intro runs while tiles are still streaming. No layer work,
  no label solving during the fly. Labels appear at rest.

### Zoom ladder
**Zoom controls detail, not meaning.** A storm's category color, glyph, and
position never change with zoom. What changes is how much supporting information
sits around it. If someone has to zoom in to discover that something is
dangerous, the design failed.

Four bands, not eight, so the transitions are felt rather than guessed at.

| Zoom | Land | Storms |
|---|---|---|
| **z0–2 · Planet** | Continent fills, coast glow, graticule | Glyph + category color only. No labels. |
| **z3–4 · Basin** | + major islands | + storm names, + past track |
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

### The storm glyph
- **Simplified two-arm spiral**, rotated by hemisphere — counterclockwise north,
  clockwise south. Physically real, free to implement.
- **Size-scaled by category, never shape-scaled.** A Cat 5 is a bigger glyph, not
  a more elaborate one. It has to stay legible at ~12 px on a phone at z1, and a
  detailed spiral turns to mush at that size.
- **Non-tropical `nature` values get a plain dot, not a spiral.** The glyph means
  "this is a cyclone."
- **Constant in screen pixels, not map units.** A position marker does not
  balloon as you zoom — it is not an area.
- **Visible glyph may be 16 px; the hit area is never under 44 px.**
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
- Keyboard: arrows pan, +/− zoom, Tab cycles storms, Enter selects, Esc closes
  and recenters; full logical tab order.
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
sheets visible — which is exactly what the first Phase 1 deploy did, because the
style was written against an assumed shared schema that does not exist.
`style-dark.js` now carries two separate layer builders rather than a
layer-name lookup table. **Do not "simplify" them back into one.**

Second finding from the same deploy: MapLibre's globe `sky` fog settings bleed
across the entire sphere face, not just the limb, if the blend values are high.
`fog-ground-blend` at 0.55 produced a lit blue planet. It lives at 0.02 now.
The rim is meant to be a thin edge, not a wash.

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

**Built so far** (Phase 1): `config/{constants,tokens,motion}.js`,
`map/{globe,style-dark,graticule}.js`, `ui/status.js`, `main.js`, `index.html`.
`lib/` and `data/` do not exist yet and should not be created until something
needs them.

`main.js` sits at **107 lines**, over the 100-line target. The overage is the
comment explaining error precedence in the status strip. Cutting it to hit the
number would be cutting the *why*, which §12 forbids outright — the target
yields to the rule.

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

1. **Skeleton on glass — DONE except tiles.** Repo, accounts, DNS, R2 bucket,
   Pages project all live (§3). MapLibre globe from CDN rendering filled land,
   two-pass glowing coasts, depth fade, graticule, atmosphere rim, and the
   opening sequence. Tokens, constants, and motion files carry real values.
   Deployed and confirmed rendering on a desktop browser.
   **Still open before Phase 1 is fully closed:** build the z0–8 `.pmtiles`
   file, upload to R2, flip `TILES.useR2`; and verify on a real phone. The
   time-to-first-paint baseline has not been measured.
2. **Storm dots.** Both storm lists via their decided paths (relay + direct);
   every active storm plotted, category-colored; storm list panel. **No scope
   filter UI at all in this phase** — not a disabled one, absent. List sorts
   **strongest-first within canonical basin order**, because with no home there
   is no reference point and intensity is the only ranking the data supports.
   The three failure states built in from day one.
3. **Home.** Location set (geolocation or manual pin — never prompt on first
   launch), home marker, off-screen pointer, distance, forecast closest
   approach. Scope filter appears and lights up all three scopes. Storm list
   flips to nearest-first, grouped under basin headers. Settings panel.
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

The paper work is done. Everything remaining is either measure-on-glass or a
live probe; there is nothing left to design on a whiteboard.

**Finish Phase 1 (needs a terminal):**
1. Build the z0–8 `.pmtiles` file (`pmtiles extract`), upload to R2, flip
   `TILES.useR2`. Answers the file-size `[VERIFY]` in §11.
2. Verify on a real phone. Measure time-to-first-paint.

**Measure-on-glass (needs the real basemap and real storms on screen):**
3. Color-contract audit against the real basemap **and the land fill** (§6).
   Land and ocean currently read closer in value than intended — it works with
   an empty globe, but a yellow Cat 1 dot sitting on land is the actual test.
   Do not adjust before Phase 2; storm dots are what tell you whether it needs
   changing.
4. Light-mode design direction (§9) — a real pass, never an inversion.
5. Exact zoom-band thresholds; imagery loop length + preload; idle-rotation
   speed and resume delay; whether the storm glyph rotates.
6. Whether forecast point times need thinning at z5 (§7).

**Live probes (§4, §11):**
7. GDACS per-event geometry CORS; IEM GOES WMS; NOAA nowCOAST radar
   ImageServer; MapServer GeoJSON completeness; the advisory-number field name
   and final-advisory flag in `CurrentStorms.json`; whether MapServer exposes a
   per-layer advisory number or issuance timestamp.

**Design, when it earns it:**
8. Additional additive layers beyond the sixteen in §7. Current call: **add
   nothing until Landfall has been used during a real storm.** Anything added
   now is a guess about what will matter in September.
9. `[DECIDE]` Whether a second desktop panel slot earns its place in Phase 8.

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

- **All three scopes arrive together in Phase 3**, with home. Phase 2 ships no
  scope UI at all — not a disabled control, absent. A filter with two dead
  options is worse than no filter.
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

- **No home means no distance.** Phase 2 ships before home exists, so the sort
  is canonical basin order, strongest first within each. Not arbitrary — with
  no reference point, intensity is the only ranking the data supports. Becomes
  distance-sorted in Phase 3 when home arrives.
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
