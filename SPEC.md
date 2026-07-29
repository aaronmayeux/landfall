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
| 6 | **SPEC.md** | Fixed colour contracts — not themeable |
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
| 18 | **SPEC-HAZARDS.md** | The shared shape — one normalizer, six hazard adapters |
| 19 | **SPEC-HAZARDS.md** | GDACS — the common API across all six hazard types |
| 20 | **SPEC-HAZARDS.md** | Earthquakes |
| 21 | **SPEC-HAZARDS.md** | Wildfires |
| 22 | **SPEC-HAZARDS.md** | Volcanoes |
| 23 | **SPEC-HAZARDS.md** | Floods |
| 24 | **SPEC-HAZARDS.md** | Drought |
| 25 | **SPEC-HAZARDS.md** | Cross-cutting — CORS, states, rate limits, build order |
| 26 | **SPEC-HAZARDS.md** | What is still open on hazards |
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
| 38 | **SPEC-GLOBES.md** | The world model — what a globe is, shared vs distinct |
| 39 | **SPEC-GLOBES.md** | The switcher and the transition |
| 40 | **SPEC-GLOBES.md** | The rendering budget, engine baseline, rejected techniques |
| 41 | **SPEC-GLOBES.md** | Sea — cyclones and floods (Landfall today) |
| 42 | **SPEC-GLOBES.md** | Air — volcanoes and wildfire |
| 43 | **SPEC-GLOBES.md** | Land — earthquakes and drought |
| 44 | **SPEC-GLOBES.md** | Build order |

**§18–§26 and §38–§44 are SCOPED, NOT STARTED.** They hold measured research and
architecture, not shipped behaviour. Nothing in the app reads them yet. The two
files are read together: **SPEC-HAZARDS.md says where a hazard's data comes from,
SPEC-GLOBES.md says how it is drawn and which world it lives on.**

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
- **The z8 tile ceiling is not a cost question.** It is what the basemap is for —
  the storm data is the detail, not the streets.
- **No obfuscation or minification step.** That is a build step, and there is no
  build step (§2).
- **No pass 4 of the main.js split, and no ~600-line target.** It ended at 896
  after three passes and that is the answer (§12). The measure was never the
  line count — it was whether `boot()` is one untestable closure. It is not.
  What is left is wiring, which is what this file is for.
- **No open-source LICENSE file.** The repo is public so Cloudflare Pages can
  build it, not as an invitation to fork.
- **No scope filter on the storm list.** It was removed 2026-07-25: with no
  filter, nothing can hide a storm that exists.
- **No position-matching to join a storm to a model deck.** Reverted in `8fa899a`:
  an identifier's job done by a heuristic, with a tuning constant in the path of a
  safety-adjacent layer and a b-deck fetch per storm to build the index.
- **No intensity colouring on track lines.** The segments carry TD/TS/HU and the
  centre dots already read it; the lines stay one flat colour, because the track's
  own grammar is dotted-past versus solid-forecast and severity belongs to the
  dots and bands.
- **No R2/Protomaps basemap.** Trialled and reverted — OpenFreeMap serves the
  same tiles with no bucket to maintain.
- **No user-facing imagery TTL setting.** It is a correctness threshold, not a
  preference; someone picking "30 min" is choosing older weather without being
  told what it costs.
- **No switching worlds anywhere but the space floor.** It is the only place the
  switch is affordable, and the reason is measured, not aesthetic
  (**SPEC-GLOBES.md §39.1**).
- **No sixth button in the control cluster for the world switcher.** It is the
  cluster's parent, not its peer (**§39.2**).
- **No gaussian splatting for smoke or water.** Depth sorting is CPU-bound and
  unsolved in the leading three.js implementation, this app's camera never rests,
  and splats are maximum transparent overdraw (**§40.4**). The pre-baked ash
  column remains open; the renderer does not.
- **No per-disaster spec files.** The organising unit is the globe, not the
  hazard: a hazard's DATA lives in SPEC-HAZARDS.md, its RENDERING lives with its
  world in SPEC-GLOBES.md. Splitting by disaster duplicates the shared normalizer
  six times and creates six places for one fact to drift.

---

## 1. What this is

A cross-platform PWA (Progressive Web App — a website that installs to the home
screen, runs in its own window, and works offline via a service worker) that
renders live natural-hazard data on a full-screen 3D globe. Wireframe at
distance, detail fading in as you descend. Everything active plotted worldwide;
selecting one flies the camera to it. Installs on iOS and Android; runs in any
desktop browser with mouse and keyboard. No app stores. Spiritual successor to
ha-hurricane-tracker — not a port.

**It is ONE APP CONTAINING SEVERAL GLOBES**, each a complete visual identity with
its own settings, layout and design language, and a switcher between them
(**SPEC-GLOBES.md §38**). Tropical cyclones are the Sea globe and the only one
built; Air (volcano, wildfire) and Land (earthquake, drought) are scoped. **The
product name still says "hurricane app" in places and the product itself no
longer is** — `[DECIDE]` the name, the subdomain and the install identity before
a second globe ships.

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

### The four empty states, never conflated

- `unavailable` — a source errored. NEVER shown as all-clear.
- `none_matched` — the request succeeded and matched nothing. Lives in geocode
  search ("no matches for that address"). Nothing in the storm list produces it
  any more: the scope filter that did was removed (§16), and with no filter
  nothing can hide a storm that exists.
- `clear` — everything fetched clean and the ocean is genuinely quiet.
- `silent` — a FOURTH state, not a flavour of the other three. Every fetch
  succeeded, the storm is still in the list, its record still says current, and
  the newest analysis in it is more than a day old. Nothing errored, nothing is
  missing, the data is simply frozen. See **Silent storms**.

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
- **Neutral colour, not the category colour.** §6 colours encode present severity;
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
the old silence-flavoured names, since two names for one rule is the drift the
extraction prevents. `pastTrack` and `windSwath` survive: a day-old record of
where a storm has been is still true. `cone`, `forecastTrack`, `forecastPoints`,
`modelTracks`, `windCurrent` and `watchWarning` are emptied, because each is a
claim about now or next. Watch/warning is on that list for a sharper reason than
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
  than tinting it): *"⚠ No updates from GDACS since Sat 7:00 PM"* / *"Last
  advisory 13 · Sat 7:00 PM (26 hrs ago)"* / *"Forecast hidden after 24 hours
  without an update. Position shown is last known. This storm may no longer be
  active."* The second sentence is load-bearing — **a missing cone with nothing
  explaining it reads as a broken app.**
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
dot for 36 h and revives itself the moment the storm is published again.

**Revival is not optional.** Storms regenerate, and a grey "no longer tracked" dot
on a system NHC has resumed warning on is an all-clear over a live storm — this
section's failure in its worst form. An `absent` record dies the moment the storm
is in a feed again. A `declared` record needs more, because a declared storm is
NORMALLY still listed for hours after its final advisory: only a NEWER bulletin
(a different `advisoryKey`, a higher JTWC warning number) whose text does not
declare an ending revives it.

**THE GRACE PERIOD IS THE ONLY DURATION IN THIS FEATURE, and it is a DISPLAY
duration** — how long a finished storm stays on the globe explaining itself. There
is no data signal for that; there is nothing to measure. **36 h, Aaron's call**:
long enough that a full day away from the app still shows what happened to the
storm you were watching. The sweep rides the READ (`endedStorms()`), not a timer —
nothing happens at 36 h except that the record stops being worth screen space.

**THIS IS THE ONLY PERSISTED STORE THAT HOLDS STORM DATA** rather than a
preference (`STORAGE_KEY.ended`), and it has to be: an ended storm is out of both
feeds, so **nothing can rebuild it.** A refetch returns nothing, the in-memory
geometry cache is gone on reload, and the storm exists nowhere else on the device.
Without persistence, closing the tab would be indistinguishable from the storm
never having happened. The **past track is persisted with it**, compacted to
`[lon, lat, timeMs, windKt, catIndex, catCode]` and capped at
`ENDED.maxTrackPoints`, stamped back under the same private field names the
parsers use (`_time`, `_windKt`, `_catStamped`/`_catIndex`) so `lib/track-point.js`
reads a rehydrated point without knowing it came out of localStorage. Both the
points (for the cage) and a rebuilt LineString (for the map trail) are restored —
persisting only the points would keep the ridge and lose the path.

**Capture happens while the storm is still ALIVE**, on every poll. At the moment
it dies it is already absent from the feed, and on a cold start there is no
geometry cache to read it out of.

**THE TUPLE CARRIES THE INTENSITY CODE.** A GDACS hurricane has no category index
— its strongest published band IS the Cat 1 floor, so the source cannot say which
hurricane it is — and keeps its whole severity in `_catCode`. Dropping the code
turns every bead on every ended GDACS storm into `sevFromKt(null)`, the cage's
noise floor: a level ridge in the wrong hue, which reads as "the mesh is broken"
rather than as lost data. **The generalised rule: an NHC point and a GDACS point
are not the same shape, so anything that round-trips a point must carry what the
WEAKER source uses, not what the richer one happens to fill in.** A test on this
must walk the whole chain a cage bead walks — reading → colour → representative
knots — not merely assert the tuple round-tripped.

**Precedence: ended beats silent** everywhere (`endedWins`) — "may no longer be
active" is a hedge, and once the agency has said it is finished the hedge is the
less honest sentence.

| Kept | Emptied |
|---|---|
| `pastPoints`, `pastTrack` | `cone`, `forecastTrack`, `forecastPoints` |
| all text vitals, the timestamp | `watchWarning`, `modelTracks`, `windCurrent` |

- **The cage head is GREY and sits at the noise floor** — a deliberate §9
  exception, stated rather than hidden. §9 says elevation and colour are one
  signal from one number; here there is no number, so the two channels agree on
  "no current reading". The alternative — drawing the last wind it ever had at
  full colour and height — is a severity claim about *now* from a bulletin
  superseded by its own author, and a dead Cat 4 standing as tall as a live one is
  exactly what this state exists to prevent. Height is `sevFromKt(null)`, never a
  literal, so it tracks the cage's floor through any retune.
- **Past beads keep their real severity colours and heights.** History is a
  record, only the future is a claim. A Cat 4 that ended was still a Cat 4.
- **`storm-dot-last-known`**, a small grey mark at the last known position of a
  storm nobody is publishing — ended OR silent — arriving on
  `ZOOM.ambientGeometry` with the rest of the storm picture. It exists because a
  LIVE storm's position dot at map zoom is its tau-0 forecast point, and an ended
  storm has none — without it you zoom in and find a track ending in empty ocean.
  Smaller than a live storm's dot on purpose.
- **`stormEnded`** is its own token in both themes, deliberately outside the
  Saffir-Simpson set — §6 is stepped out of, not broken, because there is no
  category to be wrong about. `stormSwatch()` is the one place four surfaces ask
  this.

  **BONE, NOT SHADOW.** Near-white (`#DCE4EC`, held just under `textPrimary`) says
  "this had a severity and no longer has one". A dim grey reads as *far away*,
  because `stormPlanetDot` already uses dimness to mean distance.

  **The two themes are NOT each other's inverse here**, and this is the one token
  where that is true. "Drained of colour" renders as near-white on a night globe
  and would be INVISIBLE on a pale daytime ocean, so the light theme carries the
  same idea with a strong hueless neutral (`#5B6675`). Reaching for a light grey
  in light mode to "match" dark is how this mark disappears in daylight.
- **No live imagery.** Satellite and radar are live-conditions overlays; anchoring
  one to a position that finished thirty hours ago invites the reader to read the
  two as one thing. Silence can live with that contradiction because the storm
  might still be out there. This cannot.
- **No deck warming, no geometry warming, no fetch on selection.** All three would
  request products that no longer exist and read the empty answer as a source
  fault, keeping an outage row alive for 36 h and offering a Retry that can never
  succeed. `loadGeometry` serves an ended storm from the registry and returns.
- **EVERY consumer of a bundle needs the registry fallback, including the cage.**
  `repushAmbient`, the warm loop, `loadGeometry` and `refreshCage`'s `bundleFor`
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

### 6.1 The hazard expansion brings eight more palettes, and only four are fixed

The multi-hazard work (SPEC-HAZARDS.md §18–§26) arrives carrying eight severity
ramps at once. **They are not all contracts, and treating them as if they were
guarantees an unreadable globe** — eight simultaneous ramps all meaning "how bad"
is unreadable regardless of hue, because nobody holds eight of those in their
head at once.

**FIXED. Someone will see the same thing somewhere else and it has to match.**

- **Saffir-Simpson category** — above, and thirty years of television.
- **NWS watch/warning products** — all 111, `assets/hazards/nws-wwa-colors.json`.
  A Hurricane Warning is the same colour here as on weather.gov or it is wrong.
  This covers the fire products too: Red Flag Warning `#FF1493`, Fire Weather
  Watch `#FFDEAD`.
- **USGS aviation colour code** — GREEN / YELLOW / ORANGE / RED. The code IS the
  colour; "Aviation Color Code Orange" is the name of the thing.
- **USGS MMI shaking** — and it is not ours to pick anyway. USGS ships its own
  hex on every feature of `cont_mmi.json` (SPEC-HAZARDS.md §20.3.1). Read it out
  of the data; never hardcode a shaking palette.

**FREE. Copied from the source, and nobody is checking.**

- **PAGER alert level** — an economic-loss estimate wearing a traffic light. The
  four-step severity is the contract; the specific greens and reds are not.
- **Fire radiative power bands** — SPEC-HAZARDS.md §21.6 says it outright:
  conventional, not a standard.
- **Drought D0–D4** — NDMC's yellow-to-maroon is a print palette designed for
  white paper and it is mud on a night globe.
- **GDACS Green/Orange/Red** — and this one is not merely free, it is **not
  rendered at all.** It is a fourth traffic light on a screen that already has
  three, it is the least authoritative severity present, and every hazard has a
  better native scale — magnitude, category, FRP, alert level. GDACS stays the
  discovery backbone; its `alertlevel` drives list ordering and nothing on the
  globe.

**Recolouring the free four is permitted and probably wanted, but it is not the
fix.** The fix is structural and it is SPEC-GLOBES.md §41–§43: one visual system
per world, so no two ramps are ever asked to share a frame.

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
- One-directional imports. Any pattern used twice gets extracted.

### Ceiling inventory (audited 2026-07-24)
The ~700-line ceiling triggers an INVENTORY, not an automatic split. Here is
the inventory, with a call on each. Re-run
`find . -name '*.js' -o -name '*.css' | xargs wc -l | sort -rn` when in doubt.

| File | Lines | Call |
|---|---|---|
| `config/constants.js` | 2817 | **Exempt — standing** (above). |
| `functions/tiles/_pmtiles.js` | 1721 | **Exempt — vendored.** Third-party library, not our code, never edited by hand. |
| `main.js` | 896 | **Cut in three passes, done.** See below. |
| `ui/panels.css` | 1403 | **Exempt, newly stated.** See below. |
| `ui/view-storm-detail.js` | 1109 | **Watch.** One view, many sections; each section is short and independent. |
| `map/imagery.js` | 927 | **Watch.** |
| `config/tokens.js` | 892 | **Exempt** — same reason as constants.js: one table, no logic. |
| `map/marker-home.js` | 818 | **Watch — the real one.** See below. |
| `functions/api/gdacs/inspect.js` | 750 | **Watch.** A diagnostic route, self-contained by the Pages-Function rule, and it writes nothing. Not in the render path. |
| `ui/view-settings.js` | 713 | **Watch.** |

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

**`main.js` WAS cut, in three passes, 1,747 -> 896.** It stands up two engines,
hands the dive both, and routes input, so it will never be 100 lines — but it
reached 1,747 by being the convenient place for anything that needed two of
those things at once, which is exactly what §12 forbids.

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

**Built so far** — this list is generated from the tree, not from memory. It
was months stale once already (it still named `ui/panel-*.js` long after the
drawer refactor renamed them all to `ui/view-*.js`), so check it against
`find . -name '*.js'` before trusting it.

```
config/     constants.js  layers.js  motion.js  theme.js  tokens.js
lib/        adeck.js  advisory.js  bandmerge.js  basin.js  carq.js
            category.js  future-slots.js  geo.js  imagery.js
            imagery-cache.js  imagery-paint.js  jtwc-wind.js  lifecycle.js
            perf.js  ringpolish.js  silence.js  simplify.js  telemetry.js
            time.js  track-point.js  trackline.js  units.js  usage.js
            watchwarning.js  wind.js  windswath.js
data/       adeck.js  advisory.js  cache.js  carq.js  gdacs.js
            gdacs-geometry.js  gdacs-points.js  geocode.js  home.js
            jtwc-index.js  jtwc-wind.js  layer-prefs.js  lifecycle.js
            merge.js  nhc.js  nhc-mapserver.js  relay.js
            settings-prefs.js  store.js  tcgp-index.js  warm.js
app/        bundle-pipeline.js  layer-status.js  source-status.js
            theme-switch.js  views.js
map/        attribution.js  chrome-avoid.js  coast-band.js
            coast-band-cache.js  coast-source.js  coastline.js  globe.js
            globe3d.js  glyph.js  glyph-home.js  graticule.js
            heightfield.js  imagery.js  marker-home.js
            marker-home-geometry.js  markers.js  pin-provisional.js
            storm-mesh.js  style.js  view-control.js
map/layers/ cone.js  index.js  label-placement.js  model-tracks.js
            points-forecast.js  registry.js  track-forecast.js
            track-past.js  watch-warning.js  wind-field.js
ui/         boot.js  boot-failure.js  disclaimer.js  drawer.js
            first-run.js  keyboard.js  status.js  view-home.js
            view-layers.js  view-settings.js  view-storm-detail.js
            view-storms.js  home.css  nudge.css  panels.css
root        main.js  index.html  pwa.js  sw.js
tools/      check-syntax.mjs  contrast-check.mjs  csp-hash-check.mjs
            token-check.mjs  headless-check.mjs  csp-check.mjs
            module-graph.mjs  load-probe.mjs  boot-profile.mjs
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

**The boot mark is the real Landfall logo, inlined in `index.html`** — the
four-arm spiral from `assets/icons/`, which stays the master file. It is inline
rather than an `<img>` because the boot screen's job is being on glass before
any module runs, and it carries its own hex rather than reading tokens: artwork
is a fixed contract, the same exemption Saffir-Simpson colours get. The ONE
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
  colours come from the single `--focus-ring` token and must stay that way.
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
