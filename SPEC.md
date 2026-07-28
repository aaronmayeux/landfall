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

**Moved to `SPEC-DATA.md`.** Sources, relay, merge, geometry, wind field,
imagery, the normalized storm object, polling, cache TTLs, failure recovery.

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
- **BOTH SOURCES, EVERY FEATURE. No data feature is DONE until NHC and GDACS
  are both handled.** The two may ship in separate passes — NHC first is usually
  right, because its endpoints are confirmed — but a feature with only one source
  wired is IN PROGRESS, and the outstanding half is logged in `NOW.md` until it
  lands. **Half-built means the gap is STATED, not blank**: a GDACS storm missing
  a layer NHC storms have must read as "this source doesn't provide it," never as
  absence and never as safety. Silence where a wind field should be looks
  identical to no dangerous wind. The one standing exception is where a source
  genuinely does not publish the data at all — that is `unavailable` forever,
  recorded in the spec with what was checked, not an open task pretending to be
  finishable.
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
  12A · 11:00 PM Thu · Cat 2, 85 kt."* **Always this wording.**
- **CORRECTED 2026-07-28 — the "final advisory is unbuildable" claim was wrong,
  and it was wrong in a specific way worth recording.** This section used to say
  that a 2026-07-23 probe found no final-advisory flag, so a "final advisory
  issued" branch could never be built. The probe was right and the conclusion did
  not follow: `CurrentStorms.json` carries no such FIELD, but the text product it
  links states it outright — *"...THIS IS THE FINAL NHC ADVISORY..."*. The probe
  read the JSON and the conclusion was drawn about NHC. See **Ended storms**
  below, which is built on exactly that branch. A ghost is now the honest
  INTERMEDIATE state: gone from the feed, not yet confirmed over.
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
the same. Since 2026-07-28 it lives in `lib/future-slots.js` (`FUTURE_SLOTS`,
`withoutFuture`) because **Ended storms** below is its second caller; there is
deliberately no alias left under the old silence-flavoured names, since two names
for one rule is the drift the extraction prevents. `pastTrack` and `windSwath`
survive: a day-old record of where a storm
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

### Ended storms — the graceful death
**BUILT 2026-07-28.** `lib/lifecycle.js` (what follows from the answer),
`data/lifecycle.js` (the answer and the registry), `ENDED` in
`config/constants.js`, `tools/test-lifecycle.mjs`, `tools/ended-check.mjs`.

A ghost has left the feed and we do not know why. A silent storm is still in the
feed and has stopped moving. **An ended storm is over**, and until this shipped
there was no state for it — the storm was DELETED. GDACS flips `iscurrent` to
`"false"` and `data/gdacs.js` drops the event during parse; NHC retires a storm
and it is simply absent. Either way the dot, the track, the row and the badge
vanished between one poll and the next with nothing anywhere explaining it.
Someone watching a landfall saw the storm they were following disappear, with no
way to tell that from the app breaking.

**TWO WAYS TO DIE, AND NEITHER IS A TIMER.**

- **`declared`** — the agency published its final bulletin and said so in words.
  Both markers CONFIRMED verbatim off live products 2026-07-28:
  - NHC: *"...THIS IS THE FINAL NHC ADVISORY..."* and *"This is the last public
    advisory issued by the National Hurricane Center on this system."*
    (Post-Tropical Cyclone Imelda, AL092025, Advisory 24.)
  - JTWC: *"THIS IS THE FINAL WARNING ON THIS SYSTEM BY THE JOINT TYPHOON WRNCEN
    PEARL HARBOR HI."* (Typhoon 26W Mangkhut, Warning NR 039.)

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
design is shaped this way.** A clock cannot tell a dead storm from a dead
network: leave one running and a road tunnel, a captive-portal wifi, a relay
deploy or one truncated upstream list all read as a storm ending. A confirmation
is a poll that came back CLEAN and did not contain the storm — that is *evidence*,
where elapsed time is merely the *absence* of evidence. A failed poll produces no
confirmation rather than a negative one, so an hour with no signal moves the
counter by zero. Any reappearance resets it. **The hooks live in `data/store.js`'s
SUCCESS BRANCH and nowhere else** — structurally unreachable from the catch,
rather than guarded by a flag a later refactor could pass wrong.

**The truncation guard, and why it is allowed to be wrong once.** A truncated list
is a clean fetch missing storms, and it looks exactly like the end of the world
for whatever fell off the bottom — not hypothetical, a wildfire season crowded a
live typhoon off GDACS's 100-feature cap on 2026-07-26. So a poll only votes if
its list is credible: not a collapse against the previous one
(`ENDED.minCredibleFraction`, 0.5). A non-credible poll casts no votes **and
adopts the new size as the baseline**, because a guard that refused forever would
DEADLOCK — a season genuinely winding down from eight storms to three would fail
the test on every later poll against a baseline that never moves, and no storm
would ever end again. A real collapse costs one extra poll; a one-off truncation
costs nothing.

**An empty list is NOT special-cased, and that was a deliberate reversal** (found
by the test suite, not by reading the code). Refusing to believe an empty clean
list deadlocked the guard once the baseline reached zero, and it contradicted
`overallStatus`, which already treats zero storms from clean sources as the app's
only true all-clear. Going 1 → 0 is also how a season's last storm normally ends.
What is left exposed is a source answering 200-with-nothing for four consecutive
polls, and that is acceptable **here specifically** because being wrong greys one
dot for 36 h and revives itself the moment the storm is published again. The
behaviour it replaced deleted the storm on the first poll with no recovery.

**Revival is not optional.** Storms regenerate, and a grey "no longer tracked" dot
on a system NHC has resumed warning on is an all-clear over a live storm — this
section's failure in its worst form. An `absent` record dies the moment the storm
is in a feed again. A `declared` record needs more, because a declared storm is
NORMALLY still listed for hours after its final advisory: only a NEWER bulletin
(a different `advisoryKey`, a higher JTWC warning number) whose text does not
declare an ending revives it.

**THE GRACE PERIOD IS THE ONLY DURATION IN THIS FEATURE, and it is a DISPLAY
duration** — how long a finished storm stays on the globe explaining itself.
There is no data signal for that; there is nothing to measure. **36 h, Aaron's
call**: long enough that a full day away from the app still shows what happened
to the storm you were watching. It replaces `GHOST_TTL`, which was 12 h and was
never read by anything. The sweep rides the READ (`endedStorms()`), not a timer —
nothing happens at 36 h except that the record stops being worth screen space.

**THIS IS THE ONLY PERSISTED STORE THAT HOLDS STORM DATA** rather than a
preference (`STORAGE_KEY.ended`), and it has to be: an ended storm is out of both
feeds, so **nothing can rebuild it.** A refetch returns nothing, the in-memory
geometry cache is gone on reload, and the storm exists nowhere else on the device.
Without persistence, closing the tab would be indistinguishable from the storm
never having happened — the same abrupt disappearance, relocated to page load.
The **past track is persisted with it**, compacted to
`[lon, lat, timeMs, windKt, catIndex]` and capped at `ENDED.maxTrackPoints`,
stamped back under the same private field names the parsers use (`_time`,
`_windKt`, `_catStamped`/`_catIndex`) so `lib/track-point.js` reads a rehydrated
point without knowing it came out of localStorage. Both the points (for the cage)
and a rebuilt LineString (for the map trail) are restored — persisting only the
points would have kept the ridge and lost the path.

**Capture happens while the storm is still ALIVE**, on every poll. At the moment
it dies it is already absent from the feed, and on a cold start there is no
geometry cache to read it out of.

**THE TUPLE CARRIES THE INTENSITY CODE, AND OMITTING IT FLATTENED EVERY GDACS
RIDGE.** The first version persisted `_catIndex` and not `_catCode`. A GDACS
hurricane has no index — its strongest published band IS the Cat 1 floor, so the
source cannot say which hurricane it is — and keeps its whole severity in the
code. Measured on one point through the round trip: live `index null · code "HU"
· #FF4FA3 · 109.5 kt` became `index null · code "" · #B5474D · null`, and
`sevFromKt(null)` is the cage's noise floor. So every bead on every ended GDACS
storm sat at exactly the height of the flattened head — a level ridge in the
wrong hue, which reads as "the mesh is broken" rather than as lost data. Caught on
glass, not by the suite, because the suite asserted the tuple round-tripped
rather than walking the chain a cage bead actually walks. **It now asserts the
full chain: reading → colour → representative knots.** The generalised rule: an
NHC point and a GDACS point are not the same shape, so anything that round-trips a
point must carry what the WEAKER source uses, not what the richer one happens to
fill in.

**What it looks like.** Precedence: **ended beats silent** everywhere
(`endedWins`) — "may no longer be active" is a hedge, and once the agency has
said it is finished the hedge is the less honest sentence.

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
- **`storm-dot-ended`**, a small grey mark at the last known position, arriving on
  `ZOOM.ambientGeometry` with the rest of the storm picture. It exists because a
  LIVE storm's position dot at map zoom is its tau-0 forecast point, and an ended
  storm has none — without it you zoom in and find a track ending in empty ocean.
  Smaller than a live storm's dot on purpose.
- **`stormEnded`** is its own token in both themes, and deliberately outside the
  Saffir-Simpson set — §6 is stepped out of, not broken, because there is no
  category to be wrong about. `stormSwatch()` is the one place four surfaces ask
  this.

  **BONE, NOT SHADOW — and that reversed the first attempt.** It shipped as a dim
  `#6F7885` on the reasoning that a finished storm should read as *receded*. On
  glass it read as *far away*, which is the failure a dim grey invites, because
  `stormPlanetDot` already uses dimness to mean distance. Near-white
  (`#DCE4EC`, held just under `textPrimary`) says "this had a severity and no
  longer has one"; dim grey says "this is small and distant".

  **The two themes are NOT each other's inverse here**, and this is the one token
  where that is true. "Drained of colour" renders as near-white on a night globe
  and would be INVISIBLE on a pale daytime ocean, so the light theme carries the
  same idea with a strong hueless neutral (`#5B6675`) instead. Reaching for a
  light grey in light mode to "match" dark is how this mark disappears in
  daylight.
- **No live imagery.** Satellite and radar are live-conditions overlays; anchoring
  one to a position that finished thirty hours ago invites the reader to read the
  two as one thing. Silence could live with that contradiction because the storm
  might still be out there. This cannot.
- **No deck warming, no geometry warming, no fetch on selection.** All three would
  request products that no longer exist and read the empty answer as a source
  fault, keeping an outage row alive for 36 h and offering a Retry that can never
  succeed. `loadGeometry` serves an ended storm from the registry and returns.
- **EVERY consumer of a bundle needs the registry fallback, including the cage.**
  `repushAmbient`, the warm loop and `loadGeometry` got it on the first pass;
  `refreshCage`'s `bundleFor` did not, and the result was an ended storm drawing
  its trail on the map while staying perfectly flat on the globe. It looked fine
  in-session because the warm cache still held the geometry from when the storm
  was alive — only a RELOAD, the exact case the registry is persisted for, showed
  it. The lesson generalises: when a state introduces a second source for
  something the app already caches, grep for every reader of the cache, because
  the ones that look right are the ones still holding warm data.

**THE WORDING REPORTS AN AGENCY ACTION, NEVER A METEOROLOGICAL FACT — and this is
the whole point of `lib/lifecycle.js`.** Aaron asked for "storm has dissipated"
and it was pushed back on, because on the NHC side it is frequently FALSE: a
final advisory is most often issued on a system that became post-tropical or
extratropical, and Imelda's described *"a large and powerful system"* carrying
75 mph winds across the central Atlantic. NHC stopped writing about her because
she stopped being their desk's problem, not because she stopped existing.
"Imelda has dissipated" would be a confident false statement about weather, in a
safety-adjacent app, from a bulletin that said nothing of the kind.

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
  classified TD/TS/HU at its final advisory gets nothing — this is the honest
  version of what "dissipated" was reaching for.
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
  `error`. Without it the row sat on `loading` forever, because nothing warms a
  deck for a storm that is over.

**Ordering:** ended sorts BELOW silent, both below everything live, in
`data/merge.js` and the list's nearest-first order. A silent storm may still be
out there and is the one of the two worth a second look.

**`mergeWithEnded()` owns the union**, because two rules matter and both bite.
The registry WINS over the feed copy — a storm can be in both at once and it is
the normal case, and the registry copy is the one that has read the final
bulletin. And an ended storm is still subject to NHC-wins: without that, Bertha's
GDACS shadow returns through the grace period as a grey second Bertha.

**Verified.** `tools/test-lifecycle.mjs` — 98 assertions, zero dependencies, and
**the bulletin fixtures are real published text with their original line breaks**,
including an explicit assertion that the markers survive the break moving.
Dedicated scenarios cover every glitch case: no polls at all ending nothing over
a week, a reappearance resetting the count, one empty poll between two good ones,
a sudden collapse, an unreadable advisory, and a routine advisory. The relay's
mirrored `isFinalWarning` is held against the app's copy on the same corpus, the
same guard `parseSubject` already carries.

`tools/ended-check.mjs` — a real browser at 390×844, COLD START, storm seeded
through actual localStorage so the real `load()` runs against the real bytes.
Confirms the registry rehydrates, the track and the past line come back with
their measured winds, nothing forward-looking exists in the bundle, the pill
splits the count, the row swatch is the ended grey, the badge lands in the
`ended` band naming the agency, no section publishes an all-clear, no Retry is
offered, and no page errors. It aborts every off-origin request, so unlike
`headless-check.mjs` it runs with no internet.

**Not verified on glass yet, and it is what Aaron should look at:** whether the
grey reads as *finished* rather than as *far away*, and whether the flattened cage
head looks deliberate.

### What the first real case taught us — NOUL, 2026-07-28

**The `declared` path cannot be relied on for GDACS-basin storms, and the reason
is worse than a narrow window.** Measured, all of it, the night this shipped:

- GDACS still published `iscurrent: "true"` for NOUL with a `todate` frozen at
  `2026-07-26T00:00:00` — 51 hours stale — so she was PRESENT in every poll and
  the absence path could never count. (`datemodified` had moved to 07-27T00:37,
  the decoy the SILENCE note already warns about.)
- JTWC had dropped her from its RSS entirely, so there was no index entry for a
  `final: true` to ride on.
- **Her last warning was NR 008 and it does not say FINAL.** Its remarks read
  *"NEXT WARNINGS AT 250900Z, 251500Z, 252100Z AND 260300Z"* — none of which were
  ever issued. **JTWC did not end her with a bulletin. It stopped mid-sequence
  having promised four more.** Mangkhut NR 039 *did* carry a proper final
  warning, so JTWC is inconsistent about issuing one at all.

**ARCHIVED PRODUCT FILES ARE STILL READABLE after a storm leaves the RSS**, which
was briefly and wrongly concluded otherwise from a cached response — fetched
direct from the Navy host, `wp1126web.txt` returned a stale NR 004; fetched
through our own relay with the correct User-Agent it returned the live NR 008.
**Always read JTWC through the relay.** This reopens a retroactive read as a
viable option, but it does not help NOUL: there is no final warning to find.

So the coverage is lopsided in exactly the way it was not supposed to be. NHC is
well covered — the final advisory persists while the storm stays listed. A GDACS
storm can be left with no path to `ended` at all while GDACS insists it is
current, which takes days to clear (Bertha 58 h, NOUL 51 h and counting).

**The candidate fix, NOT BUILT, awaiting a live case:** apply the absence rule to
the DECLARING agency rather than the roster — a GDACS storm absent from a
credible JTWC index across `ENDED.absentConfirmations` clean polls is over.
Gated on the storm already being `silent`, so both agencies have to agree: GDACS
has stopped publishing fixes AND JTWC is not warning. Neither alone is enough,
together they are decisive, and neither can kill a live storm (a live storm has
either fresh GDACS fixes or a JTWC warning). Promoting `silent` to `ended` on a
longer clock was considered and REJECTED — it is the time-based rule Aaron ruled
out, and it would have fired on Noul mid-landfall while she was still happening.

**Open:** DOLPHIN (12W) is the storm to watch — live at NR 005 on 2026-07-28.
Either she gets a real final warning and the `declared` path is proven on glass,
or JTWC walks away from her too and the JTWC-absence rule above is confirmed as
necessary rather than theoretical. Detection is client-side, so the app has to
be open when it happens; a retroactive product read would remove that
dependency.

**Deliberately not done:** `overallStatus` still returns `ok`, not `clear`, when
the only storms held are ended ones. `clear` would trigger an all-clear message
while a grey dot sits on the globe, which is a worse contradiction than a slightly
conservative status. The pill carries the nuance instead.

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
lib/        adeck.js  advisory.js  bandmerge.js  basin.js  category.js
            geo.js  imagery.js  imagery-cache.js  imagery-paint.js
            jtwc-wind.js  perf.js  ringpolish.js  silence.js  simplify.js
            telemetry.js  time.js  track-point.js  trackline.js  units.js
            usage.js  watchwarning.js  wind.js  windswath.js
data/       adeck.js  advisory.js  cache.js  gdacs.js  gdacs-geometry.js
            gdacs-points.js  geocode.js  home.js  jtwc-index.js
            jtwc-wind.js  layer-prefs.js  merge.js  nhc.js
            nhc-mapserver.js  relay.js  settings-prefs.js  store.js
            tcgp-index.js  warm.js
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
