# SPEC.md — Landfall

**This is the root of the Landfall spec.** It holds the laws — what the app is,
what it is built on, how it behaves when things go wrong, and the rules that
outlive any one feature. The detail lives in the companion files below.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered or
> the route taken to get there. Fences ("do not re-propose X") live in the
> SETTLED list below, one line each.
> **Section numbers are permanent addresses.** ~950 code comments cite them.
> A section may move between files; it may never be renumbered.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact we haven't tested yet.
Nothing marked `[VERIFY]` may be treated as confirmed.

---

## Where every section lives

| § | File | What it covers |
|---|---|---|
| 1 | **SPEC.md** | What this is, and who it is for |
| 2 | **SPEC.md** | Stack — the two engines, the hosting, what is settled |
| 3 | **SPEC.md** | Domain, accounts, live infrastructure |
| 4 | **SPEC-DATA.md** | Data — sources, relay, merge, geometry, imagery, polling, caching |
| 5 | **SPEC.md** | Failure philosophy, and the ghost / silent / ended storm states |
| 6 | **SPEC.md** | Fixed color contracts — not themeable |
| 7 | **SPEC-MAP.md** | Layer model |
| 8 | **SPEC-UI.md** | Home |
| 9 | **SPEC-MAP.md** | Design — the globe, the cage, severity encoding |
| 10 | **SPEC.md** | Input — touch, mouse, keyboard |
| 11 | **SPEC-MAP.md** | Basemap tiles |
| 12 | **SPEC.md** | Code structure rules |
| 13 | **SPEC.md** | Inherited hard-won rules |
| 14 | *retired* | Roadmap. What's next is `NOW.md`; the PWA and install rules are **SPEC-OPS.md §17.11**; the both-sources rule is **§5**. Stub kept in SPEC.md. |
| 15 | *retired* | Open decisions. Still-open items are `NOW.md`; the findings became statements in **SPEC-DATA.md §4**, **SPEC-MAP.md §7/§9** and `spec-parameter.md`. Stub kept in SPEC.md. |
| 16 | **SPEC-UI.md** | Screen architecture — views, drawer, storm list, detail panel |
| 17 | **SPEC-OPS.md** | Public operation — disclaimers, CSP, telemetry, cron, cost |
| 18–26 | *retired* | Multi-hazard expansion — the shared normalizer and the earthquake, wildfire, volcano, flood and drought adapters. **Landfall became cyclone-only on 2026-08-08** and `SPEC-HAZARDS.md` was deleted with the code. The research was measured and is not lost: read it at `git show worlds-v1:SPEC-HAZARDS.md`. Stub kept here because §-numbers are permanent addresses. |
| 27 | **spec-parameter.md** | Snapshot conditions — what was up when the feeds were measured |
| 28 | **spec-parameter.md** | Does GDACS publish a current wind? (yes, three ways) |
| 29 | **spec-parameter.md** | NHC `CurrentStorms.json` — every field |
| 30 | **spec-parameter.md** | NHC MapServer — layer arithmetic and field lists |
| 31 | **spec-parameter.md** | GDACS event list — every field |
| 32 | **spec-parameter.md** | GDACS per-event geometry — the feature families |
| 33 | **spec-parameter.md** | GDACS `geteventdata` and the impacts chain |
| 34 | **spec-parameter.md** | Field → display: what the app does with each one |
| 35 | **spec-parameter.md** | Findings the audit changed |
| 36 | **spec-parameter.md** | Sample payloads |
| 37 | **spec-parameter.md** | Quick reference — do not get these wrong |
| 38–44 | *retired* | The three-globe world model — Sea, Air and Deep, the switcher, the transition, and the rendering budget. **Cut with the hazards on 2026-08-08**; `SPEC-GLOBES.md` was deleted. Read it at `git show worlds-v1:SPEC-GLOBES.md`. One thing was rescued rather than archived: the self-owned render loop that fixes the idle-rotation repaint, now written out in **SPEC-MAP.md §9.7**. Stub kept here because §-numbers are permanent addresses. |

**§18–§26 AND §38–§44 WERE NEVER STARTED, AND ARE NOW RETIRED.** They held
measured research and architecture, never shipped behaviour, and nothing in the
app ever read them. Landfall is a tropical cyclone app. The whole tree as it
stood before the cut is preserved on the **`worlds`** branch and the
**`worlds-v1`** tag — nothing was lost, it just stopped being on the roadmap.

**§27–§37 are a FIELD REFERENCE, not behaviour.** They say what the feeds
publish; the spec sections say what Landfall does about it. `spec-parameter.md`
is authoritative on any field's meaning, type or units, and it is written to be
usable with no network.

**One address space.** Every `§N` in this repo — in any spec file or any code
comment — means the same thing. There is no second numbering anywhere.

**`NOW.md` is the exception and carries no section numbers at all.** It holds
what is in flight, unconfirmed, or waiting on Aaron. It carries a 300-line
trim trigger — read front to back at session start, so it audits rather than
grows.
Nothing in it is a rule.

## SETTLED — do not re-propose

Each of these was decided and is closed. Reopening one needs new information,
not a fresh opinion.

- **No Firebase.** One vendor, one bill: Cloudflare's free tiers run no egress
  meter and Google Cloud Storage bills per GB out.
- **Never move Cloudflare bindings into `wrangler.toml`.** A Wrangler config file
  becomes the source of truth for the whole Pages project and turns the dashboard
  read-only, putting `INSPECT_KEY` and `MAPBOX_TOKEN` at risk.
- **Never add an Analytics Engine binding.** It needs a non-self-serve
  entitlement, and a binding to it fails the entire Functions deploy.
- **Don't chase `lcp_ms` — but not because it is empty. It is MISLEADING.**
  (Corrected 2026-07-29; the old reason here, "always zero, a canvas is not an
  LCP candidate", is false — 70 of 105 sessions carry a real value, up to
  44,460 ms.) Chrome reports LCP for `button#storm-pill`, which sits UNDER the
  opaque `#boot` overlay; LCP does no occlusion test. Use `t_globe_ms` and
  `t_storms_ms`, which are the app's own answer to the question people mean.
- **No `<link rel="modulepreload">`.** Measured both ways with
  `tools/load-probe.mjs`: it halves the module staircase and buys ~200 ms of
  DOMContentLoaded, and costs ~200 ms of FIRST PAINT, because the hints compete
  with the boot screen for the same connection. Loading sooner while feeling
  slower is the wrong trade under §Perf. The `--preload` switch stays in the
  probe so the rejection is reproducible rather than remembered.
- **Never use `flyTo({padding})`.** It permanently shifts MapLibre's camera and
  desyncs the 3D globe. Use `flyTo({offset})`.
- **The zoom ceiling is 11, and it is not a cost question either way.** It was 8
  on the reasoning that past z8 you pull in street grids; we draw no road layer,
  so that never happened — `map/style.js` reads four OpenMapTiles source-layers
  (`water`, `earth`, `boundary`, rank-filtered `place`) and nothing else. What
  pushed it to 11 specifically was the Deep world's seamounts, and **those were
  cut on 2026-08-08, so 11 no longer has a stated reason** — but neither does 8,
  and 11 is the known-good status quo. **`[DECIDE]` how far in is useful for
  reading a landfall point against a coastline.** That is a judgement on a phone,
  not a budget argument.
- **No obfuscation or minification step.** That is a build step, and there is no
  build step (§2).
- **No pass 4 of the main.js split, and no ~600-line target.** It ended at 896
  after three passes and that is the answer (§12). The measure was never the
  line count — it was whether `boot()` is one untestable closure. It is not.
  What is left is wiring, which is what this file is for.
- **No block-service fallback for MapServer geometry, and no second NHC service.**
  The two services measurably disagreed twice (07-26 summary ahead, 07-29 block
  ahead) and those measurements stand — but the stale cone they were meant to cure
  was the browser's own disk cache, fixed in `539cc81` with three lines and
  confirmed on glass. The design would have added a second upstream, four requests
  per storm selection and a service-keyed cache slot to work around a missing
  `cache: 'no-store'`. Reopening needs a stale render that survives a COLD load
  with that fix in — not another server-side probe, which cannot see a browser
  cache and is what made this look like a NOAA problem in the first place.
- **The model roster is closed** (Aaron, 2026-07-29). Three ensemble means in the
  non-NHC basins, five NHC techs in the NHC basins. No more models. The exclusion
  lists in `functions/api/tcgp/adeck.js` and SPEC-MAP.md stay exactly where they
  are — they are as-built, and deleting the reason a model is excluded is what
  invites the re-add. This closes the UKM/UKX question specifically: TCGP
  publishes the UK model as `UKM` and it is filtered out on the merits (one run,
  no ensemble, twelve hours behind the rest of the deck), not by accident.
- **No open-source LICENSE file.** The repo is public so Cloudflare Pages can
  build it, not as an invitation to fork.
- **No scope filter on the storm list.** It was removed 2026-07-25: with no
  filter, nothing can hide a storm that exists.
- **No position-matching to join a storm to a model deck.** Reverted in `8fa899a`:
  an identifier's job done by a heuristic, with a tuning constant in the path of a
  safety-adjacent layer and a b-deck fetch per storm to build the index.
- **No intensity coloring on track lines.** The segments carry TD/TS/HU and the
  centre dots already read it; the lines stay one flat color, because the track's
  own grammar is dotted-past versus solid-forecast and severity belongs to the
  dots and bands.
- **No R2/Protomaps basemap.** Trialled and reverted — OpenFreeMap serves the
  same tiles with no bucket to maintain. **The CODE for it was not deleted**, and
  "reverted" overstated that for a while: `TILES.useR2` is `false`, the branch in
  `map/style.js` is dormant, and `functions/tiles/` still carries the proxy plus
  1,721 vendored lines of pmtiles. Server-side only — a Pages Function is not
  downloaded by a visitor — so it costs nothing on the wire and reviving R2 stays
  a flag flip. `[DECIDE]` whether that option is still wanted.

- **No per-world basemap knobs, and no plate boundaries.** Ripped from `main`
  2026-08-11. `buildStyle()` took a per-world palette, plate colors, an
  admin-furniture override and two layer-builder callbacks; `main.js` passed none
  of them, so every branch was unreachable **and still downloaded by every
  visitor**, because there is no build step (§2). Gone from `map/style.js`,
  `map/globe.js` and `config/tokens.js`. The tree that actually uses it lives on
  the **`worlds`** branch — `git show origin/worlds:config/worlds/deep.js` is
  the file that passes the plate colors. Nothing was lost; it moved to where it
  is real.
- **No user-facing imagery TTL setting.** It is a correctness threshold, not a
  preference; someone picking "30 min" is choosing older weather without being
  told what it costs.
- **Never remove `orient` from the track pipeline.** The 176° hairpin it gets
  blamed for was always stale geometry, not a smoothing fault: one render drew a
  single continuous line spanning past AND forecast, the next render a minute
  later did not. `stitch` can hand a track back either way round, which is the
  whole reason `orient` exists (**SPEC-MAP.md §9**). Freshness was the fix.
- **No second hazard, and no second globe.** Settled 2026-08-08 after both were
  scoped in detail and neither shipped a line to a user. Landfall renders
  tropical cyclones. The full multi-hazard and three-globe research is on the
  `worlds` branch if the decision is ever revisited — but revisiting it means
  arguing with a measured decision, not filling a gap.

---

## 1. What this is

A cross-platform PWA (Progressive Web App — a website that installs to the home
screen, runs in its own window, and works offline via a service worker) that
renders live natural-hazard data on a full-screen 3D globe. Wireframe at
distance, detail fading in as you descend. Everything active plotted worldwide;
selecting one flies the camera to it. Installs on iOS and Android; runs in any
desktop browser with mouse and keyboard. No app stores. Spiritual successor to
ha-hurricane-tracker — not a port.

**IT IS ONE APP AND ONE GLOBE, AND THAT IS A DECISION RATHER THAN A STAGE.**
Landfall renders tropical cyclones. A three-globe world model — Sea, Air, Deep —
with a switcher between them was scoped in detail, prototyped, and cut on
2026-08-08 without ever shipping to a user; it is preserved on the `worlds`
branch. The name question that expansion raised is closed with it: "hurricane
app" is what this is.

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
  app's own four-arm logo mark, vector path data inlined in `map/glyph.js`,
  hemisphere-split
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

  **The land fill is DRAFTED, THEN UPGRADED.** The charcoal land is rasterised
  into an equirectangular canvas at runtime and draped on the sphere; at full
  size that is ~200 ms of drawing plus ~500 ms of upload sitting in front of the
  first frame, on the one screen with nothing to look at yet. So the globe boots
  on a 1024×512 draft — finer than the screen at the space floor, where the app
  always starts — and swaps in the 4096×2048 version once the main thread goes
  idle. A theme switch takes the same path, so tapping the toggle answers
  instantly instead of freezing. Full size stays 4096 rather than shrinking
  permanently: 2048 softens visibly above ~600 px of globe and drops the small
  Lesser Antilles below two texture pixels, which is the wrong detail for this
  app to lose. Sizes and the delay are `DIVE.landW` / `landDraftW` /
  `landUpgradeDelay`, with the arithmetic beside them. On `tools/load-probe.mjs`
  this moved GLOBE ON GLASS from 4,772 ms to 3,978 ms.

  Severity peaks are a **sharp local spike, not a regional swell**: `geoDetail` 3
  (~2,562 nodes, confirmed smooth on a phone with coastal warnings up), `stormSigma` 0.16
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

  **THE BAND IS A FRACTION OF THE WINNING STORM'S OWN PEAK, NOT OF THE SEVERITY
  SCALE.** `litAmount` divides a node's lift by the severity of the storm that
  won it, so the question asked is *how close is this node to its storm's
  centre* — and every storm, weak or strong, is solidly its own color at its
  peak and fades across the same ring of nodes. Read as an ABSOLUTE lift, the
  band silently assumed every storm clears `stormColorFull`, and the weakest
  never do: everything at or below tropical-storm force clamps to
  `DIVE.sevMinLift`, so a tropical depression's TALLEST node sat part-way up the
  gradient and no node on it ever reached blue. Measured: a 30 kt depression
  peaked at rgb(84,194,229) against a resting cage of rgb(79,209,232) — five
  points apart on one channel, which on glass is nothing at all. The arithmetic
  is unchanged for a Cat 5 (its peak is 1.0) and moves a Cat 3's saturation
  point by less than the width of one node.

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
  render loop, the crossfade), `map/globe-follow.js` (HOW that slaving works —
  the on-screen measurement, the camera distance formula, the dive phase, and
  the three signs that decide which way is up),
  `map/heightfield.js` (cage geometry + node elevation), `map/coastline.js`
  (baked world coastline), `map/glyph.js` (the shared spiral), `lib/geo.js`
  (lon/lat↔vector math), wired in `main.js`.
- MapLibre GL JS v5+, globe projection, loaded from CDN. Owns the basin band and
  closer (see the hybrid note above).
- Wireframe-at-distance via zoom-stopped line layers in a custom style JSON.
- Vanilla JS, ES modules, no framework, no build step.
- Basemap tiles: OpenFreeMap (OpenMapTiles), styled by us (see §11).
  R2/Protomaps was tried and retired.
- PWA: web app manifest + service worker (rules in SPEC-OPS.md §17.11). App code
  network-first with offline cache fallback; pinned CDN cache-first; data
  endpoints never intercepted. Maskable icons for Android; 180x180
  non-transparent apple-touch-icon for iOS, both on the ocean-dark backdrop.
- Hosting: Cloudflare Pages (free tier). Deploy loop: push to main on GitHub →
  Pages builds → live URL. Done = deployed and confirmed on a real phone.
- Server side is two small Pages Functions, both dumb by design: the relay
  (§4, forward-and-cache) and the tile proxy (§11, read-bytes-and-cache).
  That is the whole backend.
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

**Moved to `SPEC-DATA.md`.** Sources, relay, merge, geometry, wind field,
imagery, the normalized storm object, polling, cache TTLs, failure recovery.

## 5. Failure philosophy (non-negotiable)

### The five empty states, never conflated

- `unavailable` — a source errored. NEVER shown as all-clear.
- `none_matched` — the request succeeded and matched nothing. Lives in geocode
  search ("no matches for that address"). Nothing in the storm list produces it
  any more: the scope filter that did was removed (§16), and with no filter
  nothing can hide a storm that exists.
- `clear` — everything fetched clean and the ocean is genuinely quiet.
- `silent` — a FOURTH state, not a flavor of the other three. Every fetch
  succeeded, the storm is still in the list, its record still says current, and
  the newest analysis in it is more than a day old. Nothing errored, nothing is
  missing, the data is simply frozen. See **Silent storms**.
- `degraded` — a FIFTH state: **the fetch succeeded and the coverage did not.**
  Some of the sources behind one channel answered and some did not, so the
  reading is true about a smaller world than the channel claims to cover. It is
  neither an outage nor calm, and the surface must say what is missing rather
  than how much.

  **==> THIS STATE EXISTS BECAUSE ITS ABSENCE HID AN ERUPTION. <==** On
  2026-07-30 the ash channel reported `ok` while reading three bulletin slots
  covering Vanuatu, Tonga and the Kermadecs — three percent of the planet —
  because its primary source had begun refusing the relay. Etna erupted at
  AVIATION COLOR CODE RED with ash to FL230 and appeared nowhere in the
  channel. `ok` was true about the transport and a lie about the world, and no
  existing state could tell those apart.

  **An empty result under `degraded` is NEVER `clear`.** An empty read of a
  partial world is a smaller sky, not a quiet one — and that conflation is the
  most dangerous one on this list, because it is the one that looks healthiest.

### The rules

- **Never collapse "we don't know" into "there is none."** A failed fetch and a
  clean fetch returning zero results are different facts and get different
  wording.
- **Name every soft-fail; never silently substitute.** Asymmetric on purpose: a
  *smaller* promise must never render *larger* data — the HA card refused to
  draw a multi-day wind swath under a label reading "Current", because it made a
  tropical depression look enormous. A bigger promise degrading to a smaller
  truth is fine. When a fallback fires, say so in the UI.
- **Stale data + a visible timestamp beats a blank screen, always.** Last-good
  storm data is cached (service worker, stale-while-revalidate) and served
  flagged stale with its age; entries age out at ~1.5× advisory cadence.
- **Every async surface handles loading / empty / error-with-recovery
  explicitly.** No partial renders while loading.
- **Errors surface near their source, in human language, naming the failed
  source** ("GDACS is not responding"), never raw exception text.
- **One source down must not blind the other.**
- **A feed that answers successfully can still be unable to answer the question,
  and that is the failure mode with no error to catch.** Every rule above assumes
  a fault announces itself. A GDACS list once returned 200, fresh, well-formed
  and correctly cached at every layer while simply not containing a live typhoon,
  because an unrelated hazard had filled its 100-feature cap; the app rendered a
  confident empty West Pacific. Where a feed's shape allows this, warn on the
  *fingerprint* rather than waiting for an error that never comes — `data/gdacs.js`
  logs when a list with features in it parses to zero current cyclones. Such a
  warning is console-only and deliberately over-fires in a quiet off-season,
  because `clear` really is the right render for a quiet ocean. **Ask of every new
  feed: what does it look like when this succeeds and is wrong?**
- **BOTH SOURCES, EVERY FEATURE. No data feature is DONE until NHC and GDACS are
  both handled.** The two may ship in separate passes — NHC first is usually
  right, because its endpoints are confirmed — but a feature with only one source
  wired is IN PROGRESS, and the outstanding half is logged in `NOW.md` until it
  lands. **Half-built means the gap is STATED, not blank**: a GDACS storm missing
  a layer NHC storms have must read as "this source doesn't provide it", never as
  absence and never as safety. Silence where a wind field should be looks
  identical to no dangerous wind. The one standing exception is a source that
  genuinely does not publish the data at all — that is `unavailable` forever,
  recorded in the spec with what was checked, not an open task pretending to be
  finishable.
- **A solver bug must never blank the map.** Any layout, placement or geometry
  solver is wrapped: on throw, warn and fall back to the simplest correct
  rendering. Degraded output beats a dead render. Dropping an individual element
  that genuinely fits nowhere is expected; the catch is for the different case
  where the solver itself breaks.

### Ghost storms — a storm leaving the feed

A selected storm can vanish mid-session. It gets a dimmed glyph at its last known
position plus a note, never silent removal. A ghost is the honest INTERMEDIATE
state: gone from the feed, not yet confirmed over.

- **Don't say "dissipated" unless we know it dissipated.** All we observe is that
  the source stopped publishing it — storms also go post-tropical, get absorbed,
  or leave the basin. Wording: *"FIONA — no longer in the NHC feed. Last advisory
  12A · 11:00 PM Thu · Cat 2, 85 kt."* **Always this wording.**
- **Promote to ghost only when the fetch came back clean.** If the source errored,
  storms hold as stale — they do not become ghosts. This is `unavailable` vs
  `clear` applied to a single storm, and getting it backwards shows a live
  hurricane as gone.
- **Neutral color, not the category color.** §6 colors encode present severity;
  a ghost has none. Category stays in the text.
- **Keep the past track. Drop the cone and forecast track.** History is still
  true. A forecast for a storm that is no longer there is a prediction about
  nothing, and drawing it is the "smaller promise, larger data" failure above.
- **Ghosts die on reload**, consistent with §7 not persisting selection.
  Dismissible, plus a TTL constant.

### Silent storms — a source that stopped publishing

`lib/silence.js`, `SILENCE.after` in `config/constants.js`,
`tools/test-silence.mjs`.

A ghost has LEFT the feed. A silent storm is still in it, still flagged current,
and has simply stopped being updated. Without this state a frozen storm renders
identically to a live one — cone, forecast track, forecast points, wind field,
the lot, at full confidence.

**The threshold is 24 h (`4 × ADVISORY_CADENCE`) since the last ANALYSIS.** GDACS
fixes run 6–12 h apart and NHC's run 6, so this is two missed cycles even for the
slowest publisher and effectively cannot fire on a live storm. Erring long is the
cheap direction *because a silent storm is not dropped* — it keeps its dot, its
past track and a badge, so firing late costs a label arriving a few hours after
it could have. Dropping the storm instead would invert that trade.

**`observedAt` AND NOTHING ELSE.** Both feeds publish a second timestamp that
moves without a new fix behind it, and reading either would make this test
permanently pass. GDACS moves `datemodified` on days it has published nothing.
**`iscurrent` is not a liveness flag either** — it means "GDACS has not archived
this yet", and it goes stale by days (two measured cases, 58 h and 51 h).

**Keep history, drop the future** — the same rule as a ghost and the same reason.
It lives in `lib/future-slots.js` (`FUTURE_SLOTS`, `withoutFuture`) because
**Ended storms** below is its second caller; there is deliberately no alias under
the old silence-flavored names, since two names for one rule is the drift the
extraction prevents. `pastTrack` and `pastPoints` survive: a day-old record of
where a storm has been is still true. `cone`, `forecastTrack`, `forecastPoints`,
`modelTracks`, `windCurrent`, `watchWarning` and `windSwath` are emptied, because
each is a claim about now or next. **`windSwath` was on the surviving side until
2026-08-08 on a sentence that was never checked against the feed** — "the winds
this storm has already laid down". Measured live on DOLPHIN-26, GDACS's published
`60 km/h` corridor spans 112.66-178.33 E and covers the forecast track as well as
the past, and NHC's `buildFullTrack` sweeps past, current and forecast into one
envelope by design. The polygon carries no mark where history ends, so it cannot
be clipped back — only kept whole or dropped whole, and a corridor of forecast
wind coverage drawn beside a hidden cone is the exact failure this rule exists to
prevent. The cost is accepted: a storm whose forecast bands were all degenerate
(KUJIRA-26, measured the same day) has a swath that genuinely is past-only, and it
goes too, because nothing in the data distinguishes the two. Watch/warning is on that list for a sharper reason than
tidiness: those are live government orders, and a day-old evacuation stripe
painted as current is the most dangerous thing this app could draw.

**Every path to the map goes through one gate** — `forMap()` in `main.js`,
covering selection, re-push, ambient warm and the cold-start repush. Model tracks
are folded in *first* so silencing can take them straight back out; a warmed
a-deck would otherwise paint five-day guidance across a storm nobody has
published a fix for since yesterday.

**EMPTYING A SLOT IS NOT ENOUGH, and this is the trap worth remembering.** Every
section of the detail panel writes a sentence from its slot's status, and those
sentences were written for a slot that came back empty *on its own*: "None in
effect." for watches and warnings, "No wind field published for this advisory."
for the wind field. Silencing the slot without changing the sentence would turn a
hidden warning into a published all-clear — this section's exact failure,
manufactured by the fix for this section's exact failure. Every section that
reads a silenced slot branches on silence FIRST (`silenceSectionNote()`), and
`mapProblemHtml()` returns nothing rather than blaming the source for our own
deliberate removal.

**The wording never says the storm ended**, only that we stopped hearing about
it. A storm can go silent at landfall while very much still happening.

- Stamp badge (a fourth band, three lines, replacing the advisory line rather
  than tinting it): *"No updates from GDACS since Sat 7:00 PM"* / *"Last advisory
  13 · 26 hrs ago"* / *"Position shown is last known and the forecast is hidden.
  This storm may no longer be active."* The second sentence is load-bearing —
  **a missing cone with nothing explaining it reads as a broken app.**
- **The band is `--stale` amber and carries NO warning glyph.** It was `--error`
  red with a `⚠` until 2026-08-08, and `--error` is defined as *"source down /
  layer failed"* — so a state in which every fetch returned 200 and the app is
  behaving correctly was painted, twice over, as a fault. Silence is not on the
  freshness scale's red end and it is not a failure; it is aging data, which is
  what `--stale` means. It stays distinguished from the one-line aging band by
  SHAPE — three lines against one — which is what carried the difference for a
  color-blind reader before, when the two shared red.
- **The identity line is qualified whenever there is no current reading**:
  *"Last reported: Tropical Depression"*. Bare, it is the most present-tense claim
  on the panel, and it sat directly above a badge saying nobody knows what the
  storm is doing. One predicate (`noCurrentReading`) covers silent and ended both.
- **JTWC's silence is corroboration and it goes in the DETAIL, not the headline.**
  When the roster is clean and carries no warning under the storm's name, the
  detail adds *"The Joint Typhoon Warning Center has no warning under this name
  either."* It is not promoted to a "nobody is publishing" headline, because
  `listed` is the result of a NAME match and JTWC carries unnamed systems as bare
  designations (`13W`) that match nothing — the headline would announce silence
  over a storm JTWC is actively warning on.
- The agency is NAMED. With two feeds, "no updates" leaves the reader unable to
  tell which half of the world went quiet. One template, source substituted, so
  NHC going silent reads correctly for free.
- Panel sections: *"Hidden — no update from GDACS in over 24 hours."*
- Storm row and pill: *"not updating"* — *"2 active · 1 not updating"*, or *"No
  active storms · 1 not updating"* when every storm held has gone quiet. The count
  is SPLIT, never subtracted: dropping the storm from the pill would make it
  vanish from the only surface a narrow phone shows by default.
- The row's qualifier is spliced into its `aria-label`. The list is the
  accessibility surface for an aria-hidden canvas — a qualifier that exists only
  for sighted users does not exist.

**Silence outranks staleness** wherever both apply. `FRESHNESS` bands a timestamp
amber at ~4 h and red at ~9 h on the assumption an update is LATE and coming;
silence is that assumption failing. The row has space for one qualifier and it is
this one. Silent storms also sort last within their basin, ahead of every other
rule, in both `data/merge.js` and the list's own nearest-first order — a storm
nobody has published a fix for since yesterday should not head the list on the
strength of a day-old wind number.

**`sortStorms(storms, now)` takes an injected clock.** It makes the rule testable
against recorded timestamps, and it guarantees every pair in one sort is judged
against the same instant — a comparator reading the clock per comparison could
place one storm above and below the threshold within a single sort, which is an
inconsistent comparator and produces garbage orderings rather than errors.

**Deliberately NOT done: the worker cron still warms silent storms.**
`worker/src/sources.js` is untouched. A silent storm keeps its past track on
screen, so skipping it would turn that history into a cold read during exactly
the landfall someone is watching — and a key the client asks for and the cron
skipped is the expensive direction.

### Ended storms — the graceful death

`lib/lifecycle.js` (what follows from the answer), `data/lifecycle.js` (the answer
and the registry), `ENDED` in `config/constants.js`, `tools/test-lifecycle.mjs`,
`tools/ended-check.mjs`.

A ghost has left the feed and we do not know why. A silent storm is still in the
feed and has stopped moving. **An ended storm is over.** Without this state the
storm was DELETED — the dot, the track, the row and the badge vanished between
one poll and the next with nothing explaining it, and someone watching a landfall
could not tell that from the app breaking.

**TWO WAYS TO DIE, AND NEITHER IS A TIMER.**

- **`declared`** — the agency published its final bulletin and said so in words.
  Both markers are verbatim off live products:
  - NHC: *"...THIS IS THE FINAL NHC ADVISORY..."* and *"This is the last public
    advisory issued by the National Hurricane Center on this system."*
  - JTWC: *"THIS IS THE FINAL WARNING ON THIS SYSTEM BY THE JOINT TYPHOON WRNCEN
    PEARL HARBOR HI."*

  This is a fact the source STATES, so it applies on the poll it is read, with no
  waiting and no inference. Matching lives in `lib/advisory.js`
  (`isNhcFinalAdvisory`, `isJtwcFinalWarning`). **Every gap in those patterns is
  `\s+`**: these are hard-wrapped teletype products, so any phrase long enough to
  be unambiguous contains a newline, and where it falls moves with the storm's
  name. A matcher built against a single-space fixture passes and then silently
  stops working — which looks exactly like no storm ever ending.

- **`absent`** — nobody said anything and the storm is gone from a feed that is
  otherwise answering normally. **Counted in CLEAN CONFIRMATIONS, never in
  elapsed time.** `ENDED.absentConfirmations` is 3.

**WHY COUNTED AND NOT TIMED — Aaron's hard requirement, and the reason the whole
design is shaped this way.** A clock cannot tell a dead storm from a dead network:
a road tunnel, a captive-portal wifi, a relay deploy or one truncated upstream
list all read as a storm ending. A confirmation is a poll that came back CLEAN and
did not contain the storm — that is *evidence*, where elapsed time is merely the
*absence* of evidence. A failed poll produces no confirmation rather than a
negative one, so an hour with no signal moves the counter by zero. Any
reappearance resets it. **The hooks live in `data/store.js`'s SUCCESS BRANCH and
nowhere else** — structurally unreachable from the catch, rather than guarded by a
flag a later refactor could pass wrong.

**The truncation guard, and why it is allowed to be wrong once.** A truncated list
is a clean fetch missing storms, and it looks exactly like the end of the world
for whatever fell off the bottom. So a poll only votes if its list is credible:
not a collapse against the previous one (`ENDED.minCredibleFraction`, 0.5). A
non-credible poll casts no votes **and adopts the new size as the baseline**,
because a guard that refused forever would DEADLOCK — a season genuinely winding
down from eight storms to three would fail the test on every later poll against a
baseline that never moves, and no storm would ever end again. A real collapse
costs one extra poll; a one-off truncation costs nothing.

**An empty list is NOT special-cased.** Refusing to believe an empty clean list
deadlocks the guard once the baseline reaches zero, and it contradicts
`overallStatus`, which already treats zero storms from clean sources as the app's
only true all-clear. Going 1 → 0 is also how a season's last storm normally ends.
What is left exposed is a source answering 200-with-nothing for four consecutive
polls, and that is acceptable **here specifically** because being wrong greys one
dot for 24 h and revives itself the moment the storm is published again.

**JTWC'S ACTIVE ROSTER IS A SECOND ABSENCE AUTHORITY, and without it a GDACS storm
cannot die at all.** GDACS does not reliably retire anything — `iscurrent: "true"`
sat on Bertha for ~58 h, and NOUL-26 stayed listed for days after her last
analysis. Such a storm is never `absent` (it never leaves the list) and never
`declared` either (the only bulletin for those basins is JTWC's, and JTWC drops a
storm from its active list shortly after the final warning — miss that window and
there is nothing left to read). Both routes structurally could not fire. So
falling off JTWC's roster is counted exactly like falling out of a source's list:
same confirmation count, same credibility guard, same words, `by: 'jtwc'`. **Three
guards.** Only a storm JTWC has ACTUALLY LISTED can be killed by leaving the list,
because GDACS covers systems JTWC never warns on. An `unavailable` or `partial`
index attaches no verdict at all, so a JTWC outage moves the tally by zero in
either direction — held, not reset, and not counted. And **the storm must already
be `silent`**: JTWC stops warning when a system leaves its area of responsibility
or drops under its criteria, and GDACS can keep publishing real fixes afterwards —
killing that storm would be a grey "no longer tracked" dot over a live system. The
roster is the evidence; silence is the permission to act on it. None of the three
is a timer: a storm silent for a month with JTWC still warning on it stays live.

**A ROSTER KILL USED TO BE A REMOVAL RATHER THAN A BADGE, AND THAT WAS A BUG
DRESSED AS A DESIGN.** Silence fires at 24 h since the last fix and the display
window was 24 h from the same stamp, so any storm past the silence gate had
already spent its grace period and went from a silent grey dot straight to gone
with no `ended` badge in between. This was written up as the intended read. It was
not: the same arithmetic deleted the badge for `lapsed`, and for any absence
confirmed more than a day after the last advisory — an overnight ending, an app
that was shut. Only a promptly-read `declared` ending ever got the window. Fixed
2026-08-08 by measuring the window from `ended.confirmedAt`; see the grace period
below.

**`lapsed` IS THE THIRD ENDING, AND THE ONLY ONE NOBODY HAS TO ACT FOR.**
`declared` needs a bulletin and `absent` needs a list to drop the storm. GDACS
provides neither: it publishes no bulletins, and `iscurrent` stays `"true"` for
days. A storm JTWC never warned on — so the roster route's `jtwcSeen` guard can
never arm — is unreachable by every other route in this file and would sit on the
globe until the season ended. So **48 h of silence ends a storm on its own**,
attributed to nobody (`by: null`), saying only that no fix has been published.
Twice `SILENCE.after`, and the doubling is the argument: 24 h is already the badge,
and reusing it would collapse the two states into one instant, leaving no interval
in which the app has said "we have stopped hearing about this" — which is the
entire purpose of `silent`. GDACS was mid-landfall on Noul when it froze; that
hedge has to have a life. It is a timer, which this feature otherwise refuses, and
the difference is that here the clock IS the evidence rather than standing in for
evidence we failed to fetch. **Revival compares `observedAt` against the stamp it
lapsed on** — not list membership, because the storm never left the list.

**Revival is not optional.** Storms regenerate, and a grey "no longer tracked" dot
on a system NHC has resumed warning on is an all-clear over a live storm — this
section's failure in its worst form. An `absent` record dies the moment the storm
is in a feed again — **except a roster absence, which only JTWC can contradict**:
that storm never left GDACS, so reading the GDACS list as a revival would promote
and revive it on alternating polls forever. A `declared` record needs more,
because a declared storm is NORMALLY still listed for hours after its final
advisory: only a NEWER bulletin (a different `advisoryKey`, a higher JTWC warning
number) whose text does not declare an ending revives it.

**THE GRACE PERIOD IS THE ONLY DURATION IN THIS FEATURE, and it is a DISPLAY
duration** — how long a finished storm stays on the globe explaining itself. There
is no data signal for that; there is nothing to measure. **24 h, Aaron's call**:
long enough that opening the app the next morning still shows what happened to the
storm you went to bed watching. The sweep rides the READ (`endedStorms()`), not a
timer — nothing happens at 24 h except that the record stops being worth screen
space.

**`lapsed` GETS HALF OF IT — `ENDED.holdForLapsed`, 12 h — BECAUSE THE READER HAS
ALREADY HAD THE NEWS.** `declared` and `absent` both arrive on the poll they land:
the storm was live on the previous one and is finished on this one, so the grey
day is the first and only chance to see what happened. `lapsed` is the opposite.
That storm wore the silent badge from 24 h and this route does not fire until 48,
so a further full day of grey is the third day of one fact. Measured on the real
case: DOLPHIN-26's last GDACS analysis was Sun 12:00 UTC, the lapse fired Tue
12:00 UTC, and under one flat window it would have sat in the Finished group until
Wednesday morning — 72 h after anybody last said where it was. Not zero, because
the storm must never vanish on the same poll that ends it; that is the failure the
hold exists for, arriving from the other side.

**AND THE ROW DOES NOT SAY "ended" FOR IT.** `lib/lifecycle.js` `endedRowStamp`
returns `quiet since` plus the clock for a `lapsed` record, `ended` plus the clock
for the other two. The stamp was joining two true facts into one false one: the
word came from the ending and the clock came from the last published fix, so a
`lapsed` row asserted that something happened at a moment when nothing did — and
in DOLPHIN's case GDACS still listed the storm as current while the row said it
had ended two days earlier. Same vocabulary as `endedNote`'s headline for each
route, shortened to fit a column. The group heading stays **Finished**, which is
true of all three from this app's point of view.

**ONE ENDING PER STORM. `promote` REFUSES A STORM ALREADY IN THE REGISTRY, and
without that refusal nothing in this feature works.** Every route but one needs
the storm to be gone from something, so a second promotion could not arise;
`lapsed` fires on a storm that is *still in its source's list* by definition, so
it re-fired every poll and rewrote `ended.confirmedAt` — the field the display
window is measured from. The countdown restarted roughly every 30 minutes and no
lapsed storm could expire on any device. DOLPHIN-26 sat in **Finished** for two
days on that (Aaron, on glass, 2026-08-12), including two days after the 12-hour
window below landed and did nothing. Two rules keep it refused now: an ended
storm is kept out of `seen` entirely, so `observeSource`'s three promoting steps
cannot see one, and `promote` itself returns early. There is no upgrade path — a
lapse is never rewritten into a declaration, because `observeDeclarations` has
always skipped registry members.

**AND THE APP STOPS BELIEVING THE FEED ROW, NOT JUST ITS OWN RECORD —
`ENDED.stopListingAfter`, applied in `data/gdacs.js` at parse.** Fixing only the
refusal above produces something worse than the zombie: the record expires, and
the storm is instantly back in the *live* list wearing a "not updating" badge,
because GDACS is still publishing the row. The next poll lapses it again and it
flips between **Finished** and live forever. So a GDACS event whose last analysis
is older than this never enters the app at all. It is the **sum** of
`lapsedAfter` and `holdForLapsed` and not a number of its own: the moment the
last grey pixel leaves the screen is the moment the row stops counting, and any
daylight between those two *is* the bounce. `iscurrent` is a filing state, not a
weather one — DOLPHIN-26 measured `"true"` with `datemodified` eleven minutes old
and `todate` three days old. A row with an unreadable date is **kept**: one
malformed field must not delete a live typhoon. It holds no state, so a single
fresh fix puts the storm straight back with nothing to unwind.

**IT IS MEASURED FROM `ended.confirmedAt` — when the app worked it out — NOT from
the storm's last published fix. Reversed 2026-08-08.** It was `observedAt`, on the
argument that a storm confirmed dead days later must not get a fresh full window
starting from the day the app caught up; that is how a system three and a half days
silent stayed on the globe. The argument was right about unboundedness and wrong
about the fix. Anchored on `observedAt`, the window is 24 h and every ending that
is not read promptly arrives later than that — the roster route is gated on
silence, `lapsed` fires at 48 h, an overnight absence confirms past it — so those
storms expired on the poll that ended them. The rule did not shorten the grey
period, it deleted it, and a storm the reader was watching blinked out with no
ending shown, which is the disappearing-storm failure this whole section exists to
fix. The unboundedness worry is now answered by `lapsed` instead: a silent storm
cannot drift for a week before anybody notices. **`confirmedAt` is a separate field
from `at`** — `at` is the agency's own clock and the badge must quote it, while on
`absent` and `lapsed` `at` IS `observedAt`, so a window anchored there would have
changed nothing on the two routes that needed it most. The chain falls back
`confirmedAt` → `at` → `observedAt`, so records persisted before the field existed
age out on the old behaviour rather than vanishing at once on upgrade; all three
unreadable expires immediately, because a corrupt record must not become permanent
furniture.

**THIS IS THE ONLY PERSISTED STORE THAT HOLDS STORM DATA** rather than a
preference (`STORAGE_KEY.ended`), and it has to be: for a storm that ended by
`declared` or `absent`, **nothing can rebuild it** — a refetch returns nothing,
the in-memory geometry cache is gone on reload, and the storm exists nowhere else
on the device. Without persistence, closing the tab would be indistinguishable
from the storm never having happened. The **past track is persisted with it**,
compacted to `[lon, lat, timeMs, windKt, catIndex, catCode]` and capped at
`ENDED.maxTrackPoints`, stamped back under the same private field names the
parsers use (`_time`, `_windKt`, `_catStamped`/`_catIndex`) so `lib/track-point.js`
reads a rehydrated point without knowing it came out of localStorage. Both the
points (for the cage) and a rebuilt LineString (for the map trail) are restored —
persisting only the points would keep the ridge and lose the path.

**Capture happens while the storm is still ALIVE**, on every poll. At the moment
it dies it is already absent from the feed, and on a cold start there is no
geometry cache to read it out of.

**AND A `lapsed` STORM IS THE EXCEPTION, WHICH IS WHY IT HAS A BACKFILL.**
`data/ended-track.js`. Capture-while-alive only works for a device that WAS alive
alongside the storm. A device that first meets one already past `ENDED.lapsedAfter`
promotes it inside its very first `observeSource` call — step 1 writes the
working-set entry and step 5 lapses it, in the same pass — while the geometry warm
is asynchronous and has not run. The record is filed with an EMPTY track and the
storm is excluded from warming from that moment on, so it draws a grey mark and no
trail for the rest of its window. The trail was never a property of the storm; it
was a souvenir of who happened to be watching.

A lapse is the one ending where the source is **still listing the storm** and has
merely stopped analysing it, so its geometry is still published and still
fetchable. `endedNeedsTrack` therefore admits `lapsed` and only `lapsed` — the
other two mean the storm has left its feed, where a fetch would spend a round trip
to learn nothing. `backfillEndedTracks` runs beside the ambient push on each poll,
is never awaited, and writes through `fillEndedTrack`, which fires the lifecycle
listeners and comes back round as a normal store emit: **one path from a filled
track to pixels.** It never touches the geometry cache, so what a backfilled device
draws is identical to what any device draws after a reload. Failure is console-only
— a finished storm without its trail is a smaller wrong than a finished storm
wearing an outage badge — and bounded at `ENDED.trackBackfillAttempts` per session,
which for a retired event (a 404, which `data/relay.js` does not retry) is three
requests and then silence.

**Longer wins, and nothing else does.** `fillEndedTrack` refuses any track that is
not longer than the one held, the same only-ever-improves rule `observeSource`
follows on the live path, so a half-published payload cannot shorten a good trail.

**A central store was considered and rejected** for this. The archive branch holds
only storms GDACS still flags current and rebuilds `latest/geometry` from scratch
hourly, so a retired storm's bytes are gone on the next run — it can only serve a
storm during the window the storm is fetchable anyway. A relay store would work and
buys something real (trails for storms the feed has fully retired, which today
vanish from the app outright), but that is a different feature with its own
retention question, and holding tracks rather than whole payloads means a second
parser on the server — two parsers for one thing is how the map's trail and the
globe's ridge end up disagreeing about the same storm.

**BOTH HALVES OF THE STORE ARE SWEPT ON LOAD**, against different clocks. Ended
records expire on `ENDED.holdFor` (or `ENDED.holdForLapsed`, above); last-known-live records are dropped past
`ENDED.seenMaxAge` (48 h, the same threshold as `lapsed`). Sweeping only the
first is the bug that lets a device which was closed for a week load a
week-dead storm as live, fail the next few polls, and stamp the ending with
**today's** date — reporting an old death as fresh news. A record still real is
restored by the next poll with current data, so dropping costs nothing when it
is wrong.

**A REPLAY WRITES TO ITS OWN KEY.** `?replay=…` is the real app on real archived
bytes, so it saves storms exactly as designed and the store cannot tell they are
years old. `lib/replay-mode.js` moves `STORAGE_KEY.ended` aside to
`landfall.ended.replay` for the duration, which keeps the replay exercising the
full save/load path — half of what this feature is — without leaving its storms
on the device. The test reads the URL, not the relay global, because the global
is set after an `await` and this store loads at module init.

**THE TUPLE CARRIES THE INTENSITY CODE.** A GDACS hurricane has no category index
— its strongest published band IS the Cat 1 floor, so the source cannot say which
hurricane it is — and keeps its whole severity in `_catCode`. Dropping the code
turns every bead on every ended GDACS storm into `sevFromKt(null)`, the cage's
noise floor: a level ridge in the wrong hue, which reads as "the mesh is broken"
rather than as lost data. **The generalised rule: an NHC point and a GDACS point
are not the same shape, so anything that round-trips a point must carry what the
WEAKER source uses, not what the richer one happens to fill in.** A test on this
must walk the whole chain a cage bead walks — reading → color → representative
knots — not merely assert the tuple round-tripped.

**Precedence: ended beats silent** everywhere (`endedWins`) — "may no longer be
active" is a hedge, and once the agency has said it is finished the hedge is the
less honest sentence.

| Kept | Emptied |
|---|---|
| `pastPoints`, `pastTrack` | `cone`, `forecastTrack`, `forecastPoints` |
| all text vitals, the timestamp | `watchWarning`, `modelTracks`, `windCurrent` |

- **The cage head is GREY and sits at the noise floor** — a deliberate §9
  exception, stated rather than hidden. §9 says elevation and color are one
  signal from one number; here there is no number, so the two channels agree on
  "no current reading". The alternative — drawing the last wind it ever had at
  full color and height — is a severity claim about *now* from a bulletin
  superseded by its own author, and a dead Cat 4 standing as tall as a live one is
  exactly what this state exists to prevent. Height is `sevFromKt(null)`, never a
  literal, so it tracks the cage's floor through any retune.
- **Past beads keep their real severity colors and heights.** History is a
  record, only the future is a claim. A Cat 4 that ended was still a Cat 4.
- **`storm-dot-last-known`**, a grey mark at the last known position of a
  storm nobody is publishing — ended OR silent — arriving on
  `ZOOM.ambientGeometry` with the rest of the storm picture. It exists because a
  LIVE storm's position dot at map zoom is its tau-0 forecast point, and an ended
  storm has none — without it you zoom in and find a track ending in empty ocean.
  **It is a forecast dot with no forecast in it**: the same radius, stroke and
  centred character as a real forecast point, read off `STORM_GEO` rather than
  copied, with the ended grey for a fill and a capital **X** where the category
  code would be. It was half that size until 2026-07-29; size was carrying "this
  matters less", which is color's job under §6, and it cost the mark its
  legibility at the only zoom it exists to serve.
- **`stormEnded`** is its own token in both themes, deliberately outside the
  Saffir-Simpson set — §6 is stepped out of, not broken, because there is no
  category to be wrong about. `stormSwatch()` is the one place four surfaces ask
  this.

  **BONE, NOT SHADOW.** Near-white (`#DCE4EC`, held just under `textPrimary`) says
  "this had a severity and no longer has one". A dim grey reads as *far away*,
  because `stormPlanetDot` already uses dimness to mean distance.

  **The two themes are NOT each other's inverse here**, and this is the one token
  where that is true. "Drained of color" renders as near-white on a night globe
  and would be INVISIBLE on a pale daytime ocean, so the light theme carries the
  same idea with a strong hueless neutral (`#5B6675`). Reaching for a light grey
  in light mode to "match" dark is how this mark disappears in daylight.
- **No live imagery.** Satellite and radar are live-conditions overlays; anchoring
  one to a position that finished thirty hours ago invites the reader to read the
  two as one thing. Silence can live with that contradiction because the storm
  might still be out there. This cannot.
- **No deck warming, no geometry warming, no fetch on selection.** All three would
  request products that no longer exist and read the empty answer as a source
  fault, keeping an outage row alive for 24 h and offering a Retry that can never
  succeed. `load()` in `app/bundle-pipeline.js` serves an ended storm from the
  registry via `endedBundle()` and returns.
- **EVERY consumer of a bundle needs the registry fallback, including the cage.**
  `repushAmbient`, the pipeline's `warm()`, `load()` and `refreshCage`'s `bundleFor`
  all take it. The lesson generalises: when a state introduces a second source for
  something the app already caches, grep for every reader of the cache, because
  the ones that look right are the ones still holding warm data — a missed reader
  looks correct in-session and only breaks on the RELOAD the registry exists for.

**THE WORDING REPORTS AN AGENCY ACTION, NEVER A METEOROLOGICAL FACT — and this is
the whole point of `lib/lifecycle.js`.** "Storm has dissipated" is frequently FALSE
on the NHC side: a final advisory is most often issued on a system that became
post-tropical or extratropical, and Imelda's described *"a large and powerful
system"* carrying 75 mph winds across the central Atlantic. NHC stopped writing
about her because she stopped being their desk's problem, not because she stopped
existing.

- Badge, `declared`: *"The National Hurricane Center issued its final advisory on
  this system, Mon 7:01 PM"* / *"Last advisory 024"* / *"The system became
  post-tropical. Position and track shown are the last published. There is no
  forecast to show — no further advisories will be issued."*
- Badge, `absent`: *"GDACS stopped listing this system, …"* / *"It is no longer in
  a feed that is otherwise reporting normally…"* — weaker, because we know less.
  Collapsing the two would either overclaim on `absent` (asserting a bulletin we
  never read) or underclaim on `declared`.
- **`became` is the ONE place this app describes a physical transition**, and only
  because NHC's own `classification` field makes the claim. A storm still
  classified TD/TS/HU at its final advisory gets nothing.
- **Attribution is to whoever SPOKE, not to whose storm it is.** A GDACS storm's
  ending is usually declared by JTWC, because GDACS publishes no bulletin at all;
  the record carries `by` separately from `source`. Crediting GDACS for a sentence
  JTWC wrote would send a reader to the wrong agency to check it.
- Sections: *"Not shown — no further advisories will be issued for this system."*
  Different from silence's *"Hidden — no update in over 24 hours"*, which implies
  one may still arrive.
- Row and pill: *"ended"* — *"2 active · 1 ended"*, *"No active storms · 1
  ended"*. Three counts are built as CLAUSES, and `isEnded` is checked first so a
  storm that is both silent and ended is not counted twice. Row qualifier is
  `--text-secondary`, **not** `--error` like `.row-silent`: a silent storm may
  still be out there and there is something to act on; an ended one is the least
  urgent row in the list.
- **The classification line gets "Last reported:"** and the vitals section is
  relabelled **"Last known"**. `natureLine` returns a present-tense noun phrase in
  the largest supporting text on the panel; the grey swatch and the badge both
  qualify it, but neither is *in* the sentence, and the sentence is what a reader
  takes away.
- Model guidance row: *"No guidance — this system has ended"*, `empty` not
  `error`. Without it the row sits on `loading` forever, because nothing warms a
  deck for a storm that is over.
- **A SILENT selection gets the same treatment** — *"No guidance — no update in
  over 24 hours"*, hours derived from `SILENCE.after`, never typed. `withoutFuture`
  empties `modelTracks` for silent exactly as it does for ended, but only the ended
  case was answered, so a silent storm fell through to its DECK's status — very
  often a healthy `ok`. The map drew no guidance while the row reported guidance was
  fine: two answers to one question on one screen, and the reassuring one was wrong.
  **Ended is tested first and stays first**, per this section's precedence rule.

**Ordering:** ended sorts BELOW silent, both below everything live, in
`data/merge.js` and the list's nearest-first order. A silent storm may still be
out there and is the one of the two worth a second look.

**`mergeWithEnded()` owns the union**, because two rules matter and both bite. The
registry WINS over the feed copy — a storm can be in both at once and it is the
normal case, and the registry copy is the one that has read the final bulletin.
And an ended storm is still subject to NHC-wins: without that, a retired Atlantic
storm's GDACS shadow returns through the grace period as a grey second copy.

**The bulletin fixtures in `tools/test-lifecycle.mjs` are real published text with
their original line breaks**, including an explicit assertion that the markers
survive the break moving. `tools/ended-check.mjs` runs a real browser cold start
with a storm seeded through actual localStorage, and aborts every off-origin
request so it needs no internet.

**The `declared` path cannot be relied on for GDACS-basin storms.** JTWC is
inconsistent about issuing a final warning at all — one measured storm stopped
mid-sequence having promised four more warnings, none of which were issued —
while GDACS can keep `iscurrent: "true"` on the same storm for days, so the
absence path never counts either. NHC is well covered; a GDACS storm can be left
with no path to `ended`. **Always read JTWC through the relay**: archived product
files stay readable after a storm leaves the RSS, but only with the relay's
User-Agent — fetched direct from the Navy host the same file returns a stale
warning number.

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

**Model track identity is the one entry here that IS themed, and the exception
is measured.** Dark: `TVCN/HCCA #00E5FF · AVNO/AEMN #B388FF · HFSA/CEMN #FFAB40 ·
UKX #F06292 · NEMN #4DD0A0`. Light: the same hue angles, darker and more
saturated — `#005963 · #6B17FF · #7B4500 · #D10047 · #005D3B`.

Everything else in §6 survives light mode by wearing a HALO in the theme's ink.
**A guidance line has no halo and cannot have one:** a casing under 45 dashed
lines would make the quietest layer on the map the boldest thing on it,
inverting §7's grammar. And the dark set is not merely washed out on a daylight
ocean — composited at the layer's own 0.7 opacity it measures **1.00:1** for
HFSA and NEMN, the same luminance as the sea.

The fence still holds where it means something: **identity is carried by HUE,
and only lightness and chroma move.** Purple stays purple. The picker swatch
comes from the same `modelColor()` the lines do, so the legend and the line can
never disagree. Nobody misreads a storm's severity because GFS shifted a shade —
which is exactly what separates this from the category ramp.

Light values target ~2.6:1 against the daylight ocean, deliberately near the
past track's 3.31:1 and far below the forecast track's 8.50:1, so guidance stays
legible without gaining authority. `tools/contrast-check.mjs` REQUIRES the floor
and prints the grammar comparison as advisory — a first pass gated the ceiling
too and would have failed the shipped dark theme, where guidance runs 3.6–6.5:1
and recedes on width, dash and draw order rather than on contrast.

Models beyond the shortlist draw from a defined fallback ramp, which is themed
the same way — see §7.

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

### 6.0 The glow, and the one thing that cannot be shared

A colored dot means the same thing wherever it appears — on the globe, in the
storm list, beside the storm's name, and on the countdown rail. The halo that
makes it read as a **severity statement rather than a bullet** is part of that
contract, so its radius is one token: `--dot-glow-blur` in `index.html`.

**==> THE WHOLE SHADOW CANNOT LIVE ON `:root`, AND GETTING THAT WRONG COSTS
EVERYTHING RATHER THAN A LITTLE. <==** The obvious consolidation is
`--dot-glow: 0 0 8px var(--dot-ink)`, with each dot setting its own
`--dot-ink`. It does not work. **A custom property whose value contains
`var()` is substituted at computed-value time on the element where it is
DECLARED** — `:root` — which has no `--dot-ink`. So it computes to
`0 0 8px transparent`, and every descendant inherits that. The dots keep their
background and lose their halo completely: not a duller glow, **no glow**.

It fails silently, it fails totally, nothing in a diff shows it, and no parser
complains. Three passes were spent adjusting ring, spread and opacity on a
shadow that had been transparent since the first line of it was written.

So: **the radius is shared, the ink is composed locally.** One number in one
place; one line each at the four sites. That is as far as CSS custom properties
actually reach. `tools/test-css-vars.mjs` pins both halves and rejects any
custom property that composes a length together with a `var()` the same file
does not declare — the trap by shape, not just by name.

`--dot-glow-hedge` is the mix percentage for a dot that is a **hedge rather
than an event** (the earliest-arrival row on the countdown): the same shadow
with the ink mixed down, so it is the same effect quieter and not a different
one.

### 6.1 NWS watch/warning products are the second fixed contract

**FIXED. Someone will see the same thing somewhere else and it has to match.**
A Hurricane Warning is the same pink on this globe as it is on a television, a
NOAA page and every other weather app, because a person reading it under a
watch is matching it against what they already saw somewhere else. All 111
products, with their official hexes, live in
`assets/hazards/nws-wwa-colors.json`. Read the color out of that file — never
hardcode one, and never theme one.

This is the same rule as Saffir-Simpson category color above and for the same
reason. Between them they are the only two color contracts the app does not
own.

**==> THIS SECTION USED TO BE ABOUT EIGHT PALETTES, NOT TWO. <==** It scoped the
multi-hazard expansion's severity ramps — MMI shaking, fire radiative power,
drought D0–D4, PAGER, aviation color codes, GDACS alert levels — and argued
that eight simultaneous "how bad" ramps are unreadable no matter what hues you
pick, because nobody holds eight of those in their head at once. That analysis
was right and it is now moot: Landfall is cyclone-only as of 2026-08-08. It is
preserved at `git show worlds-v1:SPEC.md` along with the structural fix it
proposed, which was one visual system per world.

## 7. Layer model

**Moved to `SPEC-MAP.md`.** Layer types, the layers panel, the full inventory,
the track line, forecast labels, model tracks, watch/warning coastal paint.

## 8. Home

**Moved to `SPEC-UI.md`.** Setting home, what depends on it, closest approach and
its three sentences, the storm-list trend word, units, time formatting.

## 9. Design

**Moved to `SPEC-MAP.md`.** Visual contract, light mode, the crossfade, the node
cage, land and atmosphere, idle rotation, the zoom ladder, the home marker,
icons, the storm glyph.

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
- **A SETTINGS SLIDER ONLY MOVES WHEN YOU GRAB ITS THUMB** (`ui/slider-grab.js`,
  built 2026-08-10). A native range input commits a value on the PRESS, before
  any movement, anywhere along its track — so in a tall scrolling sheet a thumb
  coming down to flick past a slider changed the setting. `touch-action: pan-y`
  cannot fix that: it decides who gets the DRAG, and the damage is done on the
  touch down. So a press outside the thumb circle (plus `SLIDER.grabSlopPx`) is
  refused outright, and a press on the bare track now does nothing. The 44px
  rule is still met — the row is `--touch-target` tall and thumb-plus-slop is
  48px wide on a coarse pointer. THE KEYBOARD IS UNTOUCHED: arrows, Home/End and
  PageUp/Down produce no pointer gesture, so the guard never sees them, and a
  refused press still FOCUSES the slider so tapping the track then arrowing
  works. `--slider-thumb` is one token read by both the CSS that draws the
  circle and the JS that measures it; two copies would drift and the symptom
  would be "the slider ignores me sometimes".
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

## 11. Basemap tiles

**Moved to `SPEC-MAP.md`.** OpenFreeMap, the two schemas, administrative
furniture, the name ladder, label collision order.

## 12. Code structure rules (summary — full rules live in project instructions)

- No god files (the HA card ended at 3,619 lines; never again). Code goes in
  the file that owns its concern; ~700-line ceiling triggers an inventory.
  The ceiling targets accumulated *behavior*, not length as such: a long
  function is worse than a long file. `config/constants.js` is a standing
  exemption — it is frozen data with a stated reason per number, has no logic
  and no coupling, and splitting it would dilute the one-place-for-tuning rule
  in exchange for extra import lines. Don't re-litigate it.
  ==> THE EXEMPTION IS ABOUT LENGTH, AND IT IS NOT A LICENCE TO PUT OFF-PATH
  TUNING THERE. <== Because there is no build step (§2), everything in that
  file is downloaded by every visitor whether or not any shipped module reads
  it. A block nothing on the shipped path reads is bytes every visitor pays for
  and nobody uses. **`tools/module-graph.mjs` is the check**: if a constants
  block's only readers are outside the 128-module live graph, it does not belong
  in `constants.js`. Three such blocks once lived there — `VOLCANO`,
  `PLATE_LINE` and `TILT` — and all three were deleted outright with the Deep rip
  on 2026-08-08. The rule outlives them.
- One-directional imports. Any pattern used twice gets extracted.

### Ceiling inventory (audited 2026-07-24)
The ~700-line ceiling triggers an INVENTORY, not an automatic split. Here is
the inventory, with a call on each. Re-run
`find . -name '*.js' -o -name '*.css' | xargs wc -l | sort -rn` when in doubt.

**`tools/doc-check.mjs` HOLDS THIS TABLE TO THE TRUTH.** Every count below is
checked against `wc -l` on every push (to within 5%, so an ordinary comment
edit does not cry wolf), and any file that crosses the ceiling without a row
here fails the check. The table went stale once — every row wrong,
four files over the ceiling missing entirely, and `main.js` recorded at a number
it had passed by 246 lines — which is worse than having no table, because a
wrong row says a file was looked at and judged when it was not.

| File | Lines | Call |
|---|---|---|
| `config/constants.js` | 4884 | **Exempt — standing** (above). Was 5,509 before `VOLCANO` (1,972 lines), `PLATE_LINE` (223) and `TILT` (64) moved to their own files, all three since deleted. No off-path block remains. |
| `config/tokens.js` | 1925 | **Exempt** — same reason as constants.js: one table, no logic. |
| `ui/panels.css` | 2607 | **Exempt, and the threshold below it was missed.** See below. Crossed 2,500 when the environment paragraph and the freshness column landed; still declarative all the way down. |
| `functions/tiles/_pmtiles.js` | 1721 | **Exempt — vendored.** Third-party library, not our code, never edited by hand. |
| `ui/view-storm-detail.js` | 1571 | **Over the line, and holding at seams only.** The Environment section (§47.8) went in as four seams — a section row, an ensure, a wire and a repaint — with its whole controller in `ui/env-health.js`, which is the shape every further addition must take. The stamp, the section renderers, the advisory record and the stepper remain the four separable concerns; inventory and cut list before the next detail pass that is more than a seam. |
| `config/layers.js` | 734 | **Newly over the line, and exempt for `constants.js`'s reason rather than by analogy.** It is the layer MANIFEST: frozen data, one entry per row, with the argument for each default written beside it. The only logic in it is four small helpers at the foot (`isLive`, `pairLiveOptions`, `layerGroups`, `defaultLayerState`), none of which can throw and none of which has state. Splitting it would put half the inventory in each of two files and give the panel two places to look. Crossed the ceiling when the environment row landed. |
| `ui/view-storms.js` | 1243 | **Watch.** The row builder and the list chrome are separable if it grows again. |
| `main.js` | 1228 | **Cut in three passes, done.** It grew 246 lines since, of which 89 are code and all 89 are wiring. See below. The environment ribbon (§47) added ~40 more, all of it the warm-and-push pair that model guidance already had — the same shape twice is the signal that a `warmable layer` helper is the next lift out of here, not a fourth copy. |
| `map/layers/points-forecast.js` | 772 | **Newly over the line, and the seam is already cut once.** Crossed it when the storm name learned to move. It is three things: the MapLibre layer definitions, the per-storm projection and grouping pass, and the two publish/subscribe stores that hand placement out. The GEOMETRY of both placements is already out of it — `label-placement.js` for the time labels, `name-placement.js` for the name — which is why what remains is readable. If it grows again, the layer definitions are the clean lift. |
| `map/style.js` | 897 | **Watch.** The unreachable per-world plate and admin layers were ripped out; what remains over the ceiling is the dormant Protomaps branch (§2's basemap entry). |
| `map/imagery.js` | 939 | **Watch.** |
| `data/lifecycle.js` | 1021 | **Watch, and closer to a cut than the number alone says.** The registry, the persisted shape, the three ending routes and the track repair's two seams are already four separable concerns; the FETCHING half of the repair went to `data/ended-track.js` rather than in here, which is the pattern the eventual split should follow. |
| `ui/view-home.js` | 1713 | **Over the line and still the largest file in the app.** Rainfall (§48.8) went in the way the ceiling requires — a section string, an ensure, a wire, an icon — with its whole controller in `ui/rain-home.js`; the file grew about sixty lines and none of them is logic. The cut list is written and unstarted: `countdownHtml` and its row builders are one concern, the strength strip and its figures a second, the quiet/error/no-home states a third. Next home pass does the split FIRST, with no behaviour change, so a break can only be the move. |
| `data/home-dashboard.js` | 756 | **Newly over the line.** Crossed it when the class-milestone walk landed. Three concerns are already visible and already independent: the approach maths (`closestApproach` feeding `band`, `atClosest`, `nearRing`), the intensity story (`peak`, `arrivalTrend`, `peakWhen`, `milestones`), and the `stage` ladder, which reads all of them and is the only part that has to. `nearRingWindow` and the corridor call are the natural seam. Not urgent — every piece is pure and separately tested — but it does not get to grow again first. |
| `ui/home.css` | 1171 | **Watch, and it grew for a good reason.** Same cascade-order argument as `panels.css`, at half the size. It crossed 1,000 when the setup screen's three doors became one shared `.home-choice` recipe, and 1,100 when the Rain section landed with its alert rows. The visible seam if it grows again is the SETUP screen against the DASHBOARD; they share only tokens. |
| `map/marker-home.js` | 882 | **Watch — the real one.** See below. |
| `app/views.js` | 936 | **Watch, and the cut list is written.** The composition layer that came out of `main.js` pass 3. Almost all of it is wiring — the drawer, the five views, the home marker and the provisional pin, knotted by construction order. Splitting it would put half a knot in each of two files, which is the thing it exists to prevent. The Home drawer's opening camera frame (§9.16) added ~50 lines of it and the *maths* went to `map/home-frame.js`; only the orchestration lands here, which is the pattern that has kept this file readable. **The next feature that wants a home in this file does the inventory and the cut FIRST**, with no behaviour change, so a break can only be the move. The visible seam: the five view factories and their callback bags are one concern; the home cluster — marker, provisional pin, setup and dashboard — is a second. |
| `functions/api/gdacs/inspect.js` | 750 | **Watch.** A diagnostic route, self-contained by the Pages-Function rule, and it writes nothing. Not in the render path. |

**`ui/panels.css` — exempt, for constants.js's reason, not by analogy.** It is
declarative: no logic, no imports, nothing that can throw. Its thirteen
sections (drawer chrome, views, basin groups, storm rows, failure states, the
pill, storm detail, the shared switch row, the segmented control, the Layers
shortcut, settings) are separable, but splitting a stylesheet in a project with
NO BUILD STEP means hand-managing cascade order across files — trading a real
correctness hazard for tidiness.

**==> THE OLD 1,000-LINE REVISIT THRESHOLD WAS PASSED WITHOUT ANYONE NOTICING,
AND IS NOT REPLACED WITH A BIGGER NUMBER. <==** The file is 2,084 lines. A
line-count trigger on a stylesheet was the wrong instrument: nothing was
watching it, and length was never the hazard — the hazard is cascade order, and
468 lines or 2,084, a cascade bug crosses a section boundary or it does not.
**The trigger is now that event, and only that event.** The first time a rule in
one section changes the rendering of another, this file gets cut along the seam
that broke, not along all thirteen. `[DECIDE]` if Aaron would rather take the
split pre-emptively; the cascade argument above is the case against.

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

**`main.js` WAS cut, in three passes, 1,747 -> 896, AND IS NOW 1,142 AGAIN.** It
stands up two engines, hands the dive both, and routes input, so it will never
be 100 lines — but it reached 1,747 by being the convenient place for anything
that needed two of those things at once, which is exactly what §12 forbids.

**==> 246 LINES CAME BACK, AND THEY WERE MEASURED RATHER THAN ARGUED ABOUT.
<==** Of the growth since the third pass: **177 lines are comment, 10 are blank,
and 89 are code.** Every one of those 89 is wiring — the imports for population,
genesis, surge and the home dashboard; the store subscription fanning out to
those modules; the map click handler dispatching to `selectStorm` or
`selectArea`; the tile-error latch. The only local function added is
`ensurePopulation()`, six lines of load-then-push.

**Nothing that DECIDES anything moved back in**, which is the measure §12
actually cares about — `boot()` being one untestable closure, not a line count.
Four features shipped into the app and main.js grew by 89 lines of glue, which
is the split working, not the split eroding. **The verdict stands: no pass 4.**
Re-measure the same way — comment versus code — before anyone proposes one on
the strength of the number alone.

**THE ~600 TARGET IS RETIRED. THE PASSES STOP AT THREE — do not re-propose a
pass 4.** That number was written before anyone had read what was actually in
this file, and it counted work that turned out to belong here. What remains is
the four things main.js is for: the two engines, the `style.load` install, the
one-time input wiring, and the store subscription that fans out to ten modules.

The measure was never the line count — it was whether `boot()` is one closure
sharing state that nothing can test. It is not any more. Everything that
DECIDED something left; what stayed is wiring, and wiring is what this file is.

A pass 4 would have to move the store subscription, and pass 2 already declined
it for the reason that still holds: it trades 125 readable lines for a
fifteen-callback argument list and RELOCATES the coupling rather than reducing
it. Cutting good wiring to hit a number is the failure this rule exists to
prevent, pointed the other way.

**THE PROBLEM IS NOT THE LENGTH, IT IS THAT `boot()` IS ONE CLOSURE.** Everything
inside it shares `map`, `engine`, `selected` and `lastStorms` by being in the
same scope, which is why nothing in it could be tested and why two §5 silences
shipped inside `statusForAll` unnoticed. Each cut turns a section into a factory
handed exactly what it needs — the shape `createGlobe`, `createDrawer` and
`createLayerEngine` already use.

**`app/` is the composition layer.** It may import from anywhere; **nothing may
import from `app/` except `main.js`.** That keeps the import graph
one-directional (§12) and gives the multi-hazard work somewhere to land instead
of piling onto `main.js` again.

Pass 1 landed `app/layer-status.js`, `app/theme-switch.js` and
`map/view-control.js`. Pass 2 landed `app/bundle-pipeline.js` and
`app/source-status.js`. Pass 3 landed `app/views.js`.

**`app/views.js` OWNS THE VIEW KNOT.** The drawer, the five views, the home
marker, the provisional pin and the per-layer status store are tied together by
CONSTRUCTION ORDER rather than by logic — the status store is built from a
callback into the Layers view, the drawer registers all five, the home
subscription reads two of them. Inside `boot()` that knot was invisible because
every name was simply in scope; in a module it has to be written down, which is
the point. It is constructed immediately after the pipeline, and the four
things that do not exist yet (`lastStorms`, `lastFullState`, `imagery`,
`onDeckLanded`) arrive as getters — the same rule that kept both earlier passes
from moving boot order.

**THE TWO ORDERS IN THERE ARE EXPORTED SEPARATELY BECAUSE THEY ARE CONTRACTS.**
`runSelect` starts the geometry fetch LAST: push the drawer after the fetch and
its synchronous `loading` state reaches a detail view still entered with the
PREVIOUS storm, which is the one-storm-behind advisory bug. `runRecenter`
clears the pipeline whether or not the drawer was open, because closing the
drawer deliberately leaves the geometry drawn (§16) and this is the only path
off that state. Neither has an error state; both just quietly show the wrong
thing. `tools/test-views.mjs` asserts both sequences exactly, so any reordering
fails by name.

**`app/bundle-pipeline.js` OWNS THE SELECTION.** `selected`, its held bundle
and the stale-response sequence guard were three `let`s in `boot()`'s closure,
which is why the decoration order they feed could never be tested. The only
doors are `select` / `retarget` / `clear` / `load`, and `clear` also clears the
engine so there is one fewer place that has to remember the style guard.

**`forMap` STAYS IN `app/`, NOT `lib/`, though it is nearly pure.** It is the
ordering contract for silenced and ended storms — model tracks folded in
FIRST so the future-drop takes them back out, smoothing LAST on what survived —
and its value is sitting beside the two functions that call it. Separated from
them, the order gets reversed by somebody who does not know why it matters.
`tools/test-bundle-pipeline.mjs` asserts the order directly; reversing the two
steps fails five of its assertions.

**THE STORE SUBSCRIPTION DELIBERATELY STAYED IN `main.js`.** It fans out to ten
modules, and a fan-out is wiring — which is what this file is for. Moving it
would have traded 125 lines of body for a fifteen-callback argument list and
relocated the coupling rather than reducing it. What came out of it is the part
that DECIDES something: the feed-transition test and the `data` milestone
(`app/source-status.js`), and the new-advisory refetch test (`needsRefetch`).

`styleReady` and the storm list stay owned by `main.js` — both have a dozen
readers and the theme switch resets `styleReady` — so the pipeline takes them
as getters. It is constructed immediately after the layer engine, and
everything that does not exist yet (`detailView`, `lastStorms`) arrives the
same way, which is what keeps the split from moving boot order.
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
app/        the composition layer — may import from ANYWHERE, and
            NOTHING imports from it except main.js
main.js     wiring only
```

**`app/` is where a piece goes when it needs two layers at once** and would
otherwise be bolted onto `main.js` for convenience. It is the one folder allowed
to reach across `data/`, `map/` and `ui/` in the same file, and the one-way rule
above is what keeps that from becoming a cycle: nothing may import from `app/`.
A module that only needs its own layer does NOT belong here — `map/view-control.js`
stayed in `map/` for exactly that reason.

**Built so far** — generated from the tree, never typed from memory, and
**`tools/doc-check.mjs` fails the push if any name here is not on disk.** It
was months stale once already (it still named `ui/panel-*.js` long after the
drawer refactor renamed them all to `ui/view-*.js`), so check it against
`find . -name '*.js'` before trusting it.

```
config/     constants.js  layers.js  motion.js  theme.js  tokens.js
lib/        abpw.js  adeck.js  advisory.js  bandmerge.js  basin.js
            carq.js  category.js  catmullrom.js  cone-error.js
            cone-smooth.js  cone-sweep.js  device-id.js  future-slots.js
            genesis.js  geo.js  imagery.js  imagery-cache.js
            imagery-paint.js  jtwc-wind.js  lifecycle.js  outlook.js
            perf.js  place-label.js  population-count.js  replay-mode.js
            ringpolish.js
            section-state.js  silence.js  simplify.js  telemetry.js
            time.js  track-point.js  trackline.js  units.js  usage.js
            watchwarning.js  wind.js  windswath.js
data/       adeck.js  advisory.js  cache.js  carq.js  gdacs.js
            gdacs-geometry.js  gdacs-points.js  genesis.js  geocode.js
            home.js  home-corridor.js  home-dashboard.js  jtwc-index.js
            place-resolver.js
            jtwc-wind.js  layer-prefs.js  lifecycle.js  merge.js  nhc.js
            nhc-mapserver.js  population.js  relay.js  settings-prefs.js
            store.js  surge.js  tcgp-index.js  warm.js
app/        bundle-pipeline.js  layer-status.js  source-status.js
            theme-switch.js  views.js
map/        attribution.js  chrome-avoid.js  coast-band.js
            coast-band-cache.js  coast-source.js  coastline.js  globe.js
            globe3d.js  globe-follow.js  glyph.js  glyph-home.js
            graticule.js  heightfield.js  imagery.js  limb-glow.js
            marker-home.js  marker-home-geometry.js  markers.js
            pin-provisional.js  population.js  storm-mesh.js  style.js
            theme-state.js  view-control.js  watch-marks.js  water-at.js
map/layers/ cone.js  genesis.js  index.js  label-placement.js
            model-tracks.js  points-forecast.js  registry.js  surge.js
            track-forecast.js  track-past.js  watch-warning.js
            wind-field.js
ui/         boot.js  boot-failure.js  chart-home.js  disclaimer.js
            drawer.js  first-run.js  home-search.js  keyboard.js
            slider-grab.js  status.js  view-area-detail.js  view-home.js
            view-home-setup.js  view-layers.js  view-settings.js
            view-storm-detail.js  view-storms.js
            home.css  nudge.css  panels.css
replay/     boot.js          the replay harness (§16), repoints ENDPOINT.relay
surge/      boot.js
root        main.js  index.html  pwa.js  sw.js
tools/      check-syntax.mjs  doc-check.mjs  spec-index.mjs
            css-orphan-check.mjs  drawer-scroll-check.mjs
            contrast-check.mjs  csp-hash-check.mjs  token-check.mjs
            headless-check.mjs  csp-check.mjs  module-graph.mjs
            area-shot.mjs  load-probe.mjs  boot-profile.mjs
            bootstrap.sh  with-server.sh  (+ 43 test-*.mjs suites)
```

**Pages Functions — twenty-four files**, all self-contained on purpose: Pages
Functions run in their own workerd runtime, and importing `config/` would
couple a static site to a bundle step we do not have. Their cache numbers
MIRROR §4's table; that table stays the truth.

| Route | Job |
|---|---|
| `api/nhc/storms.js` | forward NHC's `CurrentStorms.json` past CORS |
| `api/nhc/mapserver.js` | the nine per-storm layer queries; builds its own WHERE clause from a validated bin (§17.7) |
| `api/nhc/advisory.js` | the forecaster's advisory text, by bin |
| `api/nhc/genesis.js` | the tropical weather outlook areas, with the held-empty memory (SPEC-DATA §45.5) |
| `api/nhc/outlook.js` | the `ABNT20`/`ABPZ20` bulletin, scraped from NHC's `.shtml` |
| `api/nhc/adeck.js` | filters a multi-megabyte deck to the five-model NHC shortlist |
| `api/gdacs/events.js` | the global event list |
| `api/gdacs/geometry.js` | edge-cache the 180–400 KB per-event geometry |
| `api/jtwc/storms.js` | name lookup built from the RSS plus every warning product |
| `api/jtwc/warning.js` | a single warning product, including the final warning |
| `api/jtwc/abpw.js` | the significant tropical weather advisory |
| `api/tcgp/storms.js` | which storms UCAR has a deck for, and each deck's filename |
| `api/tcgp/adeck.js` | one deck, filtered to the three ensemble means; every exclusion is recorded in the file |
| `api/imagery/radar.js` | the ONE imagery hop; radar sends no CORS and the client must read its pixels |
| `api/imagery/satellite.js` | the satellite tile hop |
| `api/geocode.js` | proxy Mapbox, keep the token off the client |
| `api/reverse.js` | the same backwards — a point becomes a place name (§8) |
| `api/replay/[[route]].js` | serves an archived storm's published bytes under the live route shapes (§16) |
| `api/beacon.js` | the telemetry sink (§17.5) |
| `api/nhc/inspect.js` | read-only inventory probe — deployed permanently |
| `api/gdacs/inspect.js` | read-only inventory probe — deployed permanently |
| `api/jtwc/inspect.js` | read-only inventory probe |
| `api/tcgp/inspect.js` | read-only deck probe |
| `api/imagery/inspect.js` | read-only vendor probe — takes no parameters at all |
| `api/_middleware.js`, `api/_kv-cache.js`, `api/_cache-path.js`, `api/_rate-limit.js`, `api/_inspect-guard.js`, `api/_telemetry-store.js` | shared helpers, not routes. `_kv-cache.js` deliberately has no `kvWrite` (§17.7) |

`functions/tiles/` — the proxy plus `_pmtiles.js` — is DORMANT. See §2's
basemap entry for what that costs and the open question about it.

**The five `inspect` routes are the exception to "no diagnostic scaffolding in
the shipped app."** §15 retired the repo-writing probe bridge after use and
says so; these are different — read-only, write nothing, cost nothing idle,
gated by `_inspect-guard.js` (§17.2), and each has already turned a day-long
misdiagnosis into a ten-minute read. They stay.

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

**The boot mark is the real Landfall logo, inlined in `index.html`** — the
four-arm spiral from `assets/icons/`, which stays the master file. It is inline
rather than an `<img>` because the boot screen's job is being on glass before
any module runs, and it carries its own hex rather than reading tokens: artwork
is a fixed contract, the same exemption Saffir-Simpson colors get. The ONE
exception is its full-bleed background plate, which reads `var(--ocean)` — left
at its exported literal it paints a black square on the light theme. It spins
counter-clockwise, matching the northern-hemisphere spiral `map/glyph.js` draws
for real storms, and swaps to a scale breath under `prefers-reduced-motion`.

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

### The pre-push hook must run what CI runs

**==> A LOCAL GATE THAT IS A SUBSET OF THE REMOTE GATE IS WORSE THAN NO LOCAL
GATE. <==** It manufactures false confidence at exactly the moment somebody is
deciding whether to check.

Measured 2026-08-11: the hook ran the credential scan, `doc-check` and
`check-syntax`; CI ran those **and** `spec-index.mjs --check`. `SPEC-INDEX.md`
records each spec file's byte size, so *any* edit to a spec file — even one
number in one table — makes it stale. **Five consecutive pushes went out green
on the workstation and red on the runner**, and nobody looked, because the hook
had printed `ok` every time. The gap is the bug; the stale index was only its
symptom.

`tools/bootstrap.sh` now installs the hook with `spec-index --check` in it. The
rule when adding any new gate: **add it to both, in the same change.** If a
check is worth failing a build over, it is worth failing a push over — and if
it cannot run locally (anything needing the basemap, or a browser the sandbox
does not have), say so in the CI step's own comment so the next session knows
why the hook is quiet about it.

**Verify a new gate by breaking the thing it guards.** `spec-index --check`
exits 1 on a stale index and 0 on a current one; that was confirmed by appending
a newline to `SPEC.md` and watching it go red, not by reading the source.

### A class with no rule is silent, and no other gate can see it

`ui/view-area-detail.js` shipped with markup and **no stylesheet at all**.
Every class it emitted — `.area-head`, `.area-name`, `.area-horizons`,
`.area-facts`, `.area-note` — resolved to nothing, so the browser fell back to
its own defaults: an oversized heading, values indented under labels like a
dictionary entry, and a color swatch that did not appear at all, because an
inline `<span>` ignores width and height and collapses to a zero-size box.

**Every gate above passed the whole time.** The JS was correct, the strings
were correct, forty suites, `check-syntax`, `contrast-check` and the CSP checks
were all green. A missing rule is not a runtime error in a browser — it is
silence, and §5's rule about silence applies to the stylesheet exactly as it
applies to a feed.

`tools/css-orphan-check.mjs` compares the two halves in **both directions**,
because they are different bugs:

| | what it means |
|---|---|
| emitted, never styled | a visible defect — the user sees the browser's fallback |
| styled, never emitted | dead weight shipped to every visitor, and a lie to the next reader about what the app draws |

The first sweep found, besides the area panel: `.detail-geo-block`, emitted on
every geometry notice in the storm panel and never authored, with the two rules
beside it each carrying their own copy of the margin and size it existed to
hold; and 47 lines of `.detail-link*` left behind when the storm panel's Layers
shortcut was removed, plus five dead `home-*` rules from earlier home redesigns.

**It is a text scan and it is deliberately blunt.** It cannot see a class
assembled at runtime and does not try. A false alarm costs ten seconds and a
line in its `HOOKS` map — which takes a reason, so the next person can judge
whether the next one belongs. A missed one ships another unstyled panel to a
phone. Verified by re-introducing all four failures: deleting the area
stylesheet section, emitting one unknown class, leaving one dead rule, and
typo'ing a class the code searches for by name.

`tools/area-shot.mjs` is the other half of the answer: it mounts the real view
— not a copy of its markup — at 390px and 340px across all four shapes the
panel takes, and prints the box model back. The orphan check catches a class
with no rule; only a browser catches a rule that is wrong.

### A selector a CHECK queries is a contract too, and it rots the same way

When the home setup screen's three controls were rebuilt, `.home-drop` stopped
existing and `tools/headless-check.mjs` went on asking for it. It crashed on a
null in CI minutes after the push.

**That is the bad kind of failure.** A check querying a dead selector does not
report that the app is broken — it falls over on its own null, inside a job
named after the app, and it reads *identically* whether the app regressed or
was merely rearranged. The first move is always to go hunting a bug that is not
there. §5's rule about silence, applied to the test suite.

`tools/selector-contract-check.mjs` holds every selector in `tools/` against
what the app actually emits. **Three ways a selector is legitimate, and all
three are real:**

| | |
|---|---|
| the app emits it | the ordinary case |
| the check emits it | `area-shot.mjs` styles and queries its own `.frame`; `home-figs-check.mjs` builds its whole fixture. Those files talk to themselves |
| it is asserted absent | `headless-check.mjs` proves the model group headings and the scope filter **stay** removed. Matching nothing is the pass condition — see `PROVEN_ABSENT` |

**Ids are scanned everywhere; classes only inside a query call.** That asymmetry
is the only honest line available. The `#panel-storms` rot (§9.10) did not live
in a `querySelector()` call at all — it sat in an exported array of selector
strings in `map/chrome-avoid.js`, handed to `querySelectorAll` a hundred lines
later, invisible to any scan that reads only the call site. So literals are read
wherever they sit. For ids that is free: a sweep of the whole repo found exactly
one unmatched id literal, and it was a preview tool's own markup. For classes it
is impossible — a bare `.foo` literal is indistinguishable from a file
extension, and the same sweep produced `.js`, `.css`, `.png` and `.git` as
"phantom classes". An exclusion list of extensions goes stale silently, which is
the exact failure this gate exists to prevent.

**A name in `PROVEN_ABSENT` that turns up in the app again is a failure**, not a
pass. The entry has become a lie and the removal it guarded has been undone —
and this catches it even when the feature returns in a file the original check
never visits, which the original assertion cannot do.

`PROVEN_ABSENT` is an escape hatch and a session wanting green can bury a real
phantom in it. The only defence is that an entry takes a written reason naming
the check and the removal, read by whoever adds the next one. Same bargain as
`HOOKS` in `css-orphan-check`.

**The reading half is shared.** `tools/markup-scan.mjs` holds the directory
walk, the comment stripping, the "skip anything with `${` in it" rule and what
counts as an emitted class, because `css-orphan-check.mjs` needs all of it too
and two copies would drift silently — in exactly the way both gates exist to
prevent. Comments are blanked rather than deleted so line numbers survive: a
failure message that names the wrong line sends the reader somewhere confident.

Verified by six mutations, each watched going red and green again: `.home-drop`
restored; a live class renamed in the app with the check not following; a dead
id in an array constant; a `PROVEN_ABSENT` entry removed; a proven-absent
feature returning to the app; and an id dropped from `index.html`.

**Not covered:** `[data-*]` attribute selectors, the third contract shape in
this codebase (`[data-toggle="cities"]`, `[data-storm-id]`). Nobody has measured
how noisy that direction would be, so it is not claimed.

### Running the browser checks in a cloud sandbox

**Five of them run with NO INTERNET**, because they abort off-origin requests
or wait on `domcontentloaded` rather than `load`: `ended-check.mjs`,
`privacy-check.mjs`, `disclaimer-layout-check.mjs`, `detail-disclaimer-check.mjs`
and `csp-check.mjs`. Only `headless-check.mjs` still waits on basemap tiles.

`waitUntil: 'load'` is the trap, and it is worth naming because it does not
LOOK like a failure. `load` waits for every subresource including tiles from
`tiles.openfreemap.org`, so offline the check does not fail — it HANGS until
Playwright's navigation timeout, which reads as "the tool is broken" rather
than "the app is fine". Two checks had this and were fixed 2026-07-29. Use
`domcontentloaded` plus an explicit wait; the app is fully wired by then.

**`page.click()` carries the SAME trap after the page has loaded, and
`ended-check.mjs` was sitting in it.** Playwright waits for scheduled
navigations after every click. This harness aborts every off-origin request up
front — which is the whole reason it runs offline — and an aborted request is
one Playwright never sees settle, so the wait had nothing to wait for and burned
its 30-second timeout instead. The trace read `click action done` followed by
`waiting for scheduled navigations to finish`, and the process then died on an
uncaught `TimeoutError`: **every assertion above the click passed, so the entire
tail of the file simply looked like it had never been written.** Nothing in
these panels navigates — a drawer is a DOM change — so both clicks pass
`{ noWaitAfter: true }`. Do not tidy it away. Any offline browser check that
clicks should carry it.

**The load-speed tools are separate and need no server** — they bring their own,
speaking TLS + HTTP/2 with gzip and serving the real `_headers`, because a
probe on plain HTTP/1.1 measures the six-connection cap instead of the app:

```
export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-<rev>/chrome-linux/chrome
node tools/module-graph.mjs                     # the import graph, in waves
node tools/load-probe.mjs --runs 5 --cold-only  # cold load, phone-throttled
node tools/boot-profile.mjs                     # V8 self time per file at boot
```

`load-probe.mjs` reports **GLOBE ON GLASS** — the moment `#boot` lifts. That is
the only number that matches what a user sees; see the `lcp_ms` correction in
SPEC-OPS §17.5 for why the LCP beside it does not.

**`npm i playwright` installs a browser build the sandbox does not have.** The
sandbox ships a fixed Chromium under `/opt/pw-browsers`; a freshly-installed
Playwright asks for whatever revision IT wants and dies with "Executable
doesn't exist" plus an `npx playwright install` banner that cannot work here.
Every check already reads `PLAYWRIGHT_CHROMIUM_PATH`, so point it at the
binary that IS there rather than chasing the version:

```
export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-<rev>/chrome-linux/chrome
(python3 -m http.server 8099 >/dev/null 2>&1 & SRV=$!; sleep 2; \
  node tools/ended-check.mjs; node tools/privacy-check.mjs; \
  node tools/disclaimer-layout-check.mjs; kill $SRV)
```

**The server and the checks go in ONE shell command**, or the server is gone by
the time the check runs — and never start two on port 8099 in one command, they
collide and the second check fails for no reason anyone can see.

`ended-check.mjs` is the most valuable of the three for a refactor, because it
cold-starts the whole app in a real browser. A boot-order mistake shows up
there as a page error, which no Node suite can catch.

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
- **A focus ring must never be a CHILD of an element whose opacity animates.**
  `#globe`'s opacity is written per frame by the dive crossfade, and the globe's
  ring was `#globe::after` — a child cannot be more opaque than its parent, so
  the ring faded out with the map canvas. Measured: at rest, zoomed out on the
  3D globe, `#globe` sits at **opacity 0** and the ring was mathematically
  invisible; mid-dive it was washed out; only fully zoomed in was it correct.
  The animated opacity also opens a stacking context, which buried it under
  `#gl` besides. It is now a SIBLING overlay (`#globe-ring`) lit by
  `#globe:focus ~ #globe-ring` — no JS and no class to keep in sync. **The
  general rule: an indicator that must always be visible cannot live inside
  something the app is allowed to fade.**
- **A focus outline follows the BORDER BOX, so a control with no `border-radius`
  gets a square ring.** `.home-glyph` and `.home-pointer` have no background and
  no border, so nothing made their missing radius visible until a keyboard user
  tabbed to them and got the only two square rings in the app. They carry
  `var(--radius)` now purely so the outline rounds. **Any bare icon button needs
  a radius even when nothing but focus will ever show it.**
- **Two ring sizes, named apart.** `--focus-ring-*` is the chrome's (2px against
  a glass panel); `--globe-ring-*` is the globe's (3px, inset clear of the safe
  area, because it reads against a lit ocean at the viewport edge). They shared
  one prefix until 2026-07-28, which made a globe-only value look app-wide and
  left every button hardcoding its own `2px` instead of reading a token. Both
  colors come from the single `--focus-ring` token and must stay that way.
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

### MapLibre's own gates, and the two that are not what they look like

Both cost a deploy. Both fail SILENTLY — the layer is simply absent, which on
glass is indistinguishable from a layer that drew nothing.

- **`map.isStyleLoaded()` IS NOT "does a style exist", and it is never the gate
  for adding a source or a layer.** `Style.loaded()` also requires no pending
  source updates, **every source cache to have finished fetching its tiles**, and
  the image manager to be loaded — none of which is true inside a `style.load`
  handler, which is the only moment a layer is going to be added. What `addLayer`
  actually needs is `_loaded`, which IS set before `style.load` fires. **The gate
  is "has `style.load` fired".** Two files carried the wrong one; one survived on
  a `styledata` retry landing by luck until the luck ran out and a whole layer
  went missing below z5.4.
- **`Style.setProjection()` throws before `style.load`**, because it opens with
  `_checkLoaded()`. Called at module top level it took the whole world down with
  it — no globe, no render loop, a dark screen with the HTML still on it. Set
  style properties inside a `style.load` handler, and **never listen on
  `styledata` instead**: `setProjection` itself fires it, forever, because
  MapLibre's redundancy check compares a name string to an expression array.

**A style reload drops every source and layer a file added, with no warning that
it happened.** `style.load` fires again on a reload and is the same gate as the
first add, so one listener covers both — but a file that adds layers and does not
listen will simply lose them on the next theme switch.

### Method — how to find a bug in this project

- **When a fixture passes and glass fails, the FIXTURE is wrong.** Stop building
  fixtures and go read the real bytes. Real payloads carry shapes synthetic data
  never invents — quadrant-shaped wind bands, degenerate zero-area polygons,
  zero-radius forecast points, a track whose angle on screen is the one variable
  the test held constant. The `/inspect` routes exist so that read costs ten
  minutes instead of a day.
- **When a fix fails twice, stop fixing and question the INPUT.** Three attempts
  at a wind swath's edge treatment all assumed the shape was correct. It was the
  wrong layer entirely, and no amount of edge work was ever going to help.
- **Check WHERE before you check WHETHER.** A layer that draws correctly in the
  wrong place is indistinguishable on glass from a layer that failed — no error,
  no empty state, nothing in the console, just absence.
- **A resolver that picks by match order will fail silently.**
  Wrong-but-plausible geometry draws a confident shape with nothing visibly
  broken. A multi-match must REFUSE, never choose.
- **Read the source's own inventory before writing a pattern against it.** Not
  the documentation, not the layer name — the inventory.
- **Check whether the answer already exists before going to get it again.** The
  ATCF parser was inherited from the HA project, verified there against a live
  deck, and worked first time here; re-deriving the format would have cost a day
  and landed in the same place. The two projects are separate and MECHANISMS do
  not port — but FACTS do.
- **A measurement repeated from memory is not a measurement.** "All four
  satellites are greyscale" survived three sessions as settled fact because each
  pass quoted the last one instead of looking at the pixels.
- **A probe answers about the PAYLOAD it read, not about the source.** A probe of
  `CurrentStorms.json` correctly found no final-advisory field, and the spec
  recorded "NHC does not announce a final advisory" — which was false, and cost
  the ended-storm feature months. The text product says it outright. Write the
  finding as "this endpoint does not carry X", never as "the agency does not
  publish X".
- **When a report keeps coming back after a fix that validated, re-read the
  original words before re-reading the code.** "Angle" was read as "which side"
  three times across three sessions.
- **Before diagnosing a live symptom, CONFIRM WHICH COMMIT IS ACTUALLY SERVING.**
  A push is not a deploy and a successful build is not a deploy either. Both are
  true and neither means the bytes are live: a build can succeed and sit unused
  while Production points somewhere else entirely. Half an hour went into cache
  theory for a header that was missing because **the code containing it had never
  been promoted** — every observation was correct and the premise was not. The
  dashboard's Deployments list answers this in five seconds and it is the first
  thing to check, ahead of any header, any cache and any log.
- **The corporate VPN blackholes the site on an empty-cache hard reset.**
  GlobalProtect inspects fresh connections, and dropping every warm one at once
  trips it — the app appears completely dead and looks exactly like a bad deploy.
  **Verify on a phone on cell data with the VPN off**, which is the surface that
  matters anyway. This has cost an evening twice now.
- **A test only catches what it was told to look at**, and a test that only runs
  when a real hurricane exists is a test that does not run. Stub the one route
  that gates the screen.

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

## 14. Roadmap — RETIRED

Completed phases are no longer written down: the spec files describe what they
built, and what is next lives in `NOW.md`. The service-worker, icon and install
rules this section used to carry are **`SPEC-OPS.md` §17.11**; the both-sources
completion rule is **§5**.

## 15. Open decisions — RETIRED

Its findings were folded into the spec files as statements of what is —
`SPEC-DATA.md` §4 (GDACS fields, JTWC winds, TCGP a-decks), `SPEC-MAP.md` §7/§9
(label spokes, the track ridge, reduce-motion), `spec-parameter.md` (the field
reference). Everything still open lives in `NOW.md`.

## 16. Screen architecture

**Moved to `SPEC-UI.md`.** What is always on screen, the view control, the drawer
and its history stack, first launch, selection, the storm list, the storm detail
panel.

## 17. Public operation — hardening, scale, and the money question

**Moved to `SPEC-OPS.md`.** The disclaimer surfaces, the inspect gate, vendored
libraries and the service-worker type check, the CSP, telemetry and the privacy
contract, the boot failure screen, the origin collapse and the cron Worker, the
Cloudflare setup, the two things that can bill, push, and the IP position.
