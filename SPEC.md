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
   toggle/retry rows under a real outage. Label density is settled: the spoke
   axis is fixed and confirmed on glass (§7), and at the zooms Aaron tested
   nothing thins at all — every forecast time fits on one side. What is still
   unseen is a much wider zoom-out, where the tilt runs out of room and
   placement starts hiding labels.
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
   5. Model tracks with the per-model selector — **NHC half DONE and CONFIRMED
      ON GLASS 2026-07-25** (Aaron). The layer draws, the per-model selector
      works, and the geometric back-half clip anchors guidance at the current
      dot.
      **THE OTHER HALF SHIPPED 2026-07-26 AND HAS NOT TOUCHED GLASS.** UCAR's
      TCGP supplies a-decks for `wp`/`io`/`sh`, so GDACS storms now draw three
      ensemble means (GEFS / NAVGEM / GEPS) and the picker groups by region.
      Full as-built record in §15. §14's both-sources rule is satisfied in
      CODE; this step stays on the roadmap until a phone has seen it, because
      done means deployed and confirmed on glass and never anything less.
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

**DONE 2026-07-28 — GDACS storms carry a MEASURED wind, from JTWC. The class
midpoint is now the FALLBACK, not the answer.**

**THE BUG A USER FOUND FIRST.** A low-wind storm in the GDACS basins stood
TALLER on the cage than a measured Cat 4 in the NHC basins. It was real and it
was structural: GDACS's strongest classification word covers everything from a
marginal Cat 1 to a super typhoon, so `representativeKt()` returned the middle
of the whole hurricane range — ~110 kt — for every one of them. Measured
against the live ramp, that is **0.879 lift, above an NHC Cat 3 at 0.832**. A
Cat 1 typhoon outranked a Cat 3 hurricane, every time, by construction.

Confirmed live on DOLPHIN (12W) the same day: GDACS labelled its forecast track
`HU` while JTWC had the storm at **45 kt**. Its whole ridge was drawing at
0.879; it should have been 0.435 at the head, rising to 1.000 at the +60 h peak
JTWC actually forecasts.

**CONFIRMED ON GLASS 2026-07-28, DOLPHIN-26.** Once GDACS published its
forecast track, the storm drew nine forecast dots reading TS / TS / 1 / 3 / 4 /
5 / 5 / 4 / 4 — exactly JTWC's 45/60/80/105/130/145/145/135/135 kt ladder, bead
for bead. The dots land on 06Z and 18Z, which are precisely JTWC's tau hours,
so every one found a match and none fell back to the cap. A GDACS storm now
reads the same way an NHC storm does. **The feared sawtooth — alternating real
and capped beads on a cadence mismatch — did not occur, and interpolation
between taus stays unbuilt because nothing needs it.**

**AS BUILT.** `/api/jtwc/storms` already fetched every active warning to build
the name index and discarded everything but the subject line. It now also
parses the warning position and the forecast ladder — current wind, gusts,
pressure, movement, position accuracy, and a wind at every tau — for **zero
additional upstream requests**, inside the same cache, KV warm copy and
serve-stale window. `lib/jtwc-wind.js` (pure) joins it; `data/jtwc-wind.js`
fetches; `data/gdacs.js` applies it before anyone sees the list.

**WHY JTWC AND NOT AN RSMC.** JTWC publishes ONE-MINUTE SUSTAINED wind, the
same convention as NHC, so it lands on `CATEGORY_THRESHOLD_KT` untouched. Every
regional centre publishes TEN-MINUTE sustained, which needs a conversion factor
applied to the one number the whole severity ramp reads.

**JTWC DOES NOT REPLACE GDACS.** Checked before building, not assumed: no cone
polygon, no wind-band footprints, no past track, and it drops a storm at the
final warning while GDACS keeps it. GDACS stays the roster and the geometry.

**TWO GUARDS, BOTH PREFERRING SILENCE** (`JTWC_WIND` in config/constants.js).
A name match must ALSO pass a 200 NM position test, and the fix must be under
12 h old. A missing wind costs resolution; a wrong wind is a §5 lie on the
channel driving height, colour and badge at once. The distance guard does a
second job worth more than the first: when GDACS FREEZES and JTWC keeps warning
(Noul, 2026-07-26) the positions walk apart within a cycle and the match is
refused, so a live wind is never pasted onto a two-day-old position.

**THE FALLBACK IS UNCHANGED AND STILL CORRECT.** No JTWC warning, index down,
fix too old, positions disagree → the storm keeps `representativeKt()` and
behaves exactly as it did before this existed. Given only "this is a
hurricane", the middle of the band is the honest reading of a class label.

**GEOMETRY CACHE INVALIDATION MOVED WITH IT.** Forecast points now carry JTWC
winds, so a new JTWC warning changes what they should say even when GDACS has
not moved. `geometryKeyOf()` (data/cache.js) appends the warning number;
`advisoryKey` is deliberately untouched. Without this the head would jump to a
new wind while the beads under it kept the old one.

**REJECTED — deriving a measured FLOOR from GDACS band containment. Built and
reverted the same day (2026-07-25), and now permanently moot.** GDACS's
strongest band is 120 km/h = 64.8 kt, which IS the Cat 1 floor, so every
hurricane it publishes measures ">= 65 kt" and lands at the identical height.
Measured live on Fausto and Noul: both 65. It separates nothing the midpoint did
not, and JTWC now supplies the real number it was a proxy for.

**`representativeKt` IS NOT A MEASUREMENT AND IS NEVER DISPLAYED.** It feeds
ranking and the visual ramp only. A JTWC wind, being real, IS displayed — and
attributed, as "· JTWC" on the detail panel's Winds row, so a measurement is
never confused with the stand-in (§5).

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
   and never as "Winds". `storm.windKt` is NULL OUT OF THE GDACS PARSER: the
   source publishes no current wind, and a field named windKt holding a peak
   gets read as "now" by everything downstream. Current intensity comes from
   `severitytext`, giving `category` (0/1/null) plus `categoryCode`
   (TD/TS/HU), with `categorySource: 'reported'`.

   **THEN JTWC FILLS IT IN, since 2026-07-28.** `fetchGdacsStorms` runs the
   list through `withJtwcWinds` before returning it, so a storm JTWC is warning
   on leaves `data/gdacs.js` with a real measured `windKt`, a derived
   Saffir-Simpson `category`, gusts, pressure and motion — and
   `categorySource: 'derived'`, the same word `data/nhc.js` uses for the same
   arithmetic. See §15. The paragraph below is what an UNMATCHED storm still
   gets.

   **THE CEILING IS THE SOURCE'S — WHEN GDACS IS THE ONLY SOURCE.** GDACS's
   strongest band is 120 km/h = the Cat 1 floor, so a Cat 1 and a Cat 5 are
   indistinguishable in everything it publishes. A GDACS storm with no JTWC
   warning therefore carries no Saffir-Simpson NUMBER — `HU` plus the §6 rose,
   never a borrowed category color.

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

   **THE CEILING THAT CAME WITH IT — RESOLVED 2026-07-28 BY JTWC, see §15.**
   Every GDACS hurricane lifted to the middle of the whole hurricane range
   (~110 kt), which put a Cat 1 typhoon ABOVE a measured NHC Cat 3 on the cage.
   A user reported exactly that. It was a real limit of GDACS's
   CLASSIFICATION, and the answer was not a cleverer reading of GDACS — it was
   a second source with an actual number. `lib/jtwc-wind.js`.

   **`representativeKt` IS NOT A MEASUREMENT AND IS NEVER DISPLAYED.** It
   feeds ranking and visual ramps only, and it is now the FALLBACK for a storm
   JTWC is not warning on. Where there is no measured wind the detail panel
   still omits wind entirely rather than printing a midpoint as if GDACS had
   said it (§5).

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

**MODEL GUIDANCE OUTSIDE THE NHC BASINS — ANSWERED AND BUILT 2026-07-26.**
The probe that lived here is done; the finding replaced it rather than sitting
beside it.

**The source is UCAR's Tropical Cyclone Guidance Project.** It publishes ATCF
a-decks for the West Pacific, North Indian and Southern Hemisphere — the exact
basins `ftp.nhc.noaa.gov/atcf/aid_public/` leaves out. Public, no key, at a
derivable URL. Read live on Noul (`wp112026`): 1,487,364 bytes, 15,299 rows,
87 model codes, **zero unparsed rows**, newest cycle the same day.
`lib/adeck.js` reads it unchanged — it already handled EAST longitude, so
`1280E` was never at risk of mirroring into the Atlantic.

**THE LIVE HOST HAS `hurricanes-beta` IN ITS PATH, AND THAT IS THE STANDING
RISK.** TCGP's long-established production host still serves storm pages, but
its current-storms index **froze on 26 May 2026** and reported "no current
storms" in every basin while three were live. The beta host was current to the
hour. So the fresh data is behind a URL that does not look permanent. If
`/api/tcgp/adeck` starts 404ing everywhere at once, check that first.

**NONE OF THE FIVE NHC MODEL CODES APPEAR IN A NON-NHC DECK.** No TVCN, HCCA,
AVNO, UKX or HFSA. §15 said not to assume they would and it was right. The deck
is ENSEMBLE MEMBERS — one model run many times from nudged starting conditions
— from three centres: `AP01..AP30`+`AEMN` (GEFS), `NP01..NP20`+`NEMN`
(NAVGEM), `CP01..CP20`+`CEMN` (GEPS).

**AS BUILT: the three published ensemble MEANS, and nothing else.** Aaron's
call, 2026-07-26. We do not average the members ourselves — each centre already
publishes its own mean, and computing a second one would be free to disagree
with the plots TCGP shows beside it.

Every exclusion has its own reason, recorded in `functions/api/tcgp/adeck.js`
so none gets quietly re-added: **`CARQ` is not a forecast** (negative forecast
hours — it is the storm's own past, and drawn as guidance it would paint
history as prediction); **CHIPS (`CHIP`, `CHP2..CHP7`) is an INTENSITY model**,
per TCGP's own contributors page; **UKMET** is a single run with no ensemble
and ran 12 h behind the rest of the deck; **`CMC` and `NGX`** are the
deterministic runs of two centres already represented by their means.

**THE ID JOIN CLOSED WITHOUT NEW WORK, exactly as §15 predicted.** JTWC's
product id is `wp1126`; TCGP's filename wants `wp112026`. The two differ only
in the width of the year, and `tcgpIdFromJtwcProduct()` in `lib/adeck.js` is
the single place that transform lives — a silent slip there fetches a REAL
deck for a DIFFERENT storm, which is the wrong-but-plausible failure this spec
has already paid a day for once. Ten assertions guard it. The century is
hardcoded deliberately: deriving it from today's date is wrong every New
Year's Eve for a storm that formed in December.

**`data/jtwc-index.js` was extracted** — advisory text and model tracks are now
its two readers, and the rule is that a pattern gets extracted before its
second use, not after.

**A REAL BUG THE TESTS CAUGHT, worth more than the feature.** The
"you cannot switch off the last model" refusal counted models GLOBALLY. Correct
with one family; a hole the moment there were two — a user could switch off all
four NHC models while three TCGP ones stayed on, the refusal never fired, and
the layer drew NOTHING on the hurricane in front of them while reporting itself
healthy. That is the exact silence the rule exists to prevent, arriving through
a door the original could not see. It is per-family now
(`MODEL_FAMILY_BY_PREF`, `modelsOnInFamily`), with assertions that fail if it
regresses.

**THE PICKER GROUPS BY REGION, headers only when both families have storms** —
the same rule the storm list uses for basin headings, and for the same reason.
With one family up the control is byte-identical to before. `.model-family-head`
deliberately matches `.basin-head` down to the values; they are one idea in two
places and should be retuned together.

**No accuracy claim is made about any of the three.** Consensus earns one in
the NHC set because NHC publishes verification supporting it. A 2025 West
Pacific verification study exists and its per-model numbers were NOT obtained —
ranking these three from reputation is the thing this project has a rule
against.

**ECMWF IS NOT IN THESE DECKS, and the copy says so.** Generally the strongest
track model in the world, absent from TCGP. Unstated, three tight Pacific lines
read as a better-understood storm than four spread Atlantic ones, when the real
difference is a thinner SOURCE. That is a §5 confident-wrong impression
produced entirely by what we chose to draw.

**UCAR SAYS IT IS NOT AN OPERATIONAL SERVICE** — not maintained 24/7, outages
without warning. That is an engineering fact, not a legal one: this source will
be down more often than NOAA, and the `none` / `unavailable` split is what
keeps that from reading as "no models are forecasting this storm".

**==> STATUS: BUILT, DEPLOYED, AND NOT WORKING YET. BLOCKED ON A LIVE STORM. <==**

The picker is CONFIRMED ON GLASS (2026-07-26, phone): both groups render, the
headers read correctly, all three swatch colours resolve. Relay, parse, feature
build and colour resolution were each verified against real bytes.

**No track has ever drawn.** The storm-to-deck join is the one broken link, and
three attempts failed on the same day against the same storm:

1. **JTWC designation** (`wp1126` → `wp112026`). JTWC issued its final warning
   on Noul and dropped her from the active feed, so no id could be built and no
   fetch was attempted at all. Row read `unavailable`.
2. **TCGP's own storm list, matched by NAME.** TCGP relabelled her from
   "TYPHOON NOUL (WP11)" to **"ELEVEN (WP11)"** the same evening — the ATCF
   number-word returns when a storm decays. GDACS held "NOUL-26" throughout.
   Nothing matched.
3. **Position matching**, 250 NM. Worked in tests. REVERTED by Aaron the same
   session: an identifier's job done by a heuristic, with a tuning constant in
   the path of a safety-adjacent layer and a b-deck fetch per storm to build
   the index. Reverted in `8fa899a`; do not re-propose without new evidence.

**THE DIAGNOSIS THAT MATTERS IS NOT ABOUT THE JOIN.** Every failure was an
artifact of building against a DYING storm. Noul was 20 kt and inland when this
was written. Each agency lets go of a storm's identity on its own schedule —
JTWC stops warning, TCGP drops the name, GDACS holds it — and those schedules
only diverge at the end of a storm's life. **On a live named typhoon all three
agree and the name join works.**

`NEVER KEY ANYTHING OFF stormname` was already in §4, about NHC's own layers,
and it was ignored twice here before it was taken seriously. It is right, and
it is also not the whole story: the name is a fine key while a storm is named.

**==> TODO — REVISIT ON A LIVE PACIFIC STORM. Aaron, 2026-07-26. <==**
The shipped state is the TCGP name join. It is deployed, honest in failure
(`none` / `unavailable`, never silence), and unverified.

When a named West Pacific or Indian Ocean storm is up and being actively
warned on:
1. Read `/api/tcgp/storms` and confirm the storm is listed WITH its name.
2. Confirm three tracks draw ambiently, no selection needed.
3. Only if the name join fails on a HEALTHY storm is a different key
   warranted — and then the question is what stable id both sources carry,
   not how close two positions are.

This is the same call as holding surge for a storm near home: **you cannot
judge a feature against a degenerate case.** The whole session's evidence came
from a storm in the one state where every source disagrees.

**ALSO OPEN:**
- **The model-tracks row stays silent when it should speak.** `statusForAll()`
  only reports when EVERY storm agrees, so two healthy NHC decks masked a
  GDACS storm failing completely — the row said nothing until the storm was
  selected. With one source that was sensible; with two it hides a per-source
  failure. Should report a family-wide failure. NOT FIXED.
- **[APPROVE] the family header copy** — the labels and the ECMWF sentence are
  drafted, marked in `config/layers.js`, not signed off.
- **The cron worker does not warm `/api/tcgp/adeck`.** `worker/src/sources.js`
  is untouched, so the route is colo-cached only — the per-datacentre problem
  §17 Pass B exists to solve. Acceptable at one user, not before a season.
  The KV read is already wired; this is a worker-side change alone.
- **The layer note was DELETED, not rewritten.** "Atlantic and Pacific storms
  only" became false. Nothing replaced it because no sentence is true of every
  storm the row draws on, and the per-storm states are more specific anyway.
  Test for any future note: is it true of EVERY storm this row covers? The last
  two were not.


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

**Moved to `SPEC-UI.md`.** What is always on screen, the view control, the drawer
and its history stack, first launch, selection, the storm list, the storm detail
panel.

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
Cloudflare settings must be made by hand before it is real — see
"Aaron's settings" at the end of this section. Until `INSPECT_KEY` is
set, A2 is fail-closed (the inspect routes refuse everyone, including Andy);
until a `TELEMETRY_DB` binding exists, A5 accepts and logs to the console
without retaining.

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

Built on **Cloudflare D1** — it binds directly to the existing Pages
Functions, needs no entitlement, runs on the free plan (5M rows read/day,
100k rows written/day, 5GB), and adds no vendor. Analytics Engine was the
original choice and it did not survive contact; see "ANALYTICS ENGINE NEEDS
AN ENTITLEMENT" below. Three pieces:
- `lib/telemetry.js` — `error`, `unhandledrejection`, and the signal that
  actually matters: **§5 state transitions.** A feed flipping to `unavailable`
  is the event worth paging on, not a stack trace. Batched through
  `navigator.sendBeacon` on `visibilitychange`, sampled, never blocks a frame,
  never throws (a telemetry module that can break the app is worse than none).
- `functions/api/beacon.js` — strict allowlist of event types, hard length
  caps, silently drops everything else. Not an open write path. Chooses the
  sink; `functions/api/_telemetry-store.js` owns the D1 schema and writes, so
  a storage change never edits the file that enforces the privacy allowlist.
- `lib/perf.js` — WHERE A SLOW LOAD ACTUALLY WENT. Browser timings (TTFB,
  FCP, LCP, DOM, load) plus the app's OWN milestones: `globe` (the map became
  touchable), `data` (a source left `loading`), `storms` (something painted).

  **`lcp_ms` IS STRUCTURALLY ZERO FOR THIS APP AND THAT IS NOT A BUG.
  MEASURED 2026-07-28** in a real Chromium against the real page: FCP fires at
  204 ms and **zero `largest-contentful-paint` entries are ever emitted**, six
  seconds in. The field agrees — 5 of the 6 most recent sessions have
  `lcp_ms` 0 across two platforms.

  A WebGL `<canvas>` triggers First Contentful Paint but **is not an LCP
  candidate**, and above the fold this app is nothing but canvas. There is no
  element for the browser to nominate, so no entry exists to observe.

  A previous pass diagnosed the same zeros as a drained-observer problem and
  fixed that in `05c064b` (`takeRecords()` before reading — a real bug, still
  worth having, and it is why the occasional non-zero now arrives at all). It
  was recorded as "needs confirming on the next real session"; **confirmed
  2026-07-28 as NOT the dominant cause.** Do not spend another night on this
  column. `t_globe_ms` and `t_storms_ms` are the app's real answers to the same
  question and they are populated on every session.

  It is left in the schema rather than dropped: it is one integer, the
  `AVG(NULLIF(lcp_ms,0))` rule already covers reading it safely, and removing a
  column costs a D1 migration plus a beacon-schema change for no gain.
  The gaps between those split the blame — globe→data is the network,
  data→storms is ours. Also long-task count and total, worst interaction
  latency, connection quality, and **WebGL context loss**, which is the
  standing hypothesis for the iPhone tail: Safari takes the context away under
  memory pressure and from outside it looks identical to "slow".
- `lib/usage.js` — plain counts of what was used. Storms opened, advisories
  read, layers toggled, retries. **Counts only** — no order, no timestamps,
  no arguments; never which storm, never which layer. A sequence with times
  attached is a behavioural fingerprint and is exactly what the contract above
  keeps out.

**ONE ROW PER VISIT, AND THE PHONE DOES THE ARITHMETIC.** Both modules
accumulate in memory and are read exactly once, at the end of the visit. A
visitor who taps two hundred times is one row with bigger numbers, never two
hundred rows — which is what keeps this inside D1's 100k-writes-a-day free
tier. **The rule for anything added later: if it can happen more than once,
store an aggregate, never a list.**

**THE SUMMARY IS SENT ONCE, AT THE FIRST BACKGROUNDING.** `visibilitychange`
→ hidden is the only end-of-visit signal mobile Safari reliably gives, and a
phone user backgrounds an app constantly; sending on every hide would inflate
every count, and with no session id those rows could never be collapsed
afterwards. Load timings are complete long before the first hide, which is
what this was built for. **The cost: actions after the first background are
not counted, so usage numbers are a FLOOR, not a total.** Read them that way.
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

**DEVICE CHARACTERISTICS WERE ADDED 2026-07-28. A DELIBERATE DECISION,
RECORDED HERE RATHER THAN MADE QUIETLY.** The `sessions` row carries screen
size, pixel ratio, device memory, core count, and connection quality. Web
Analytics had shown the slow tail was almost entirely iPhones and could say
nothing further; without these there is no way to ask whether slow iPhones
are simply OLD iPhones, which is the first question anyone would ask.

What did NOT change, and does not: **home coordinates never leave the device**,
there is no user id, no session id, no cross-visit identifier, and no user
agent string — the highest-entropy field of the lot was deliberately left out
in favour of a six-value `platform` bucket. Nothing stored points at a person.

The honest note, so nobody has to rediscover it: these fields together are a
device fingerprint, and privacy regulators generally treat a fingerprint as
personal data even with no name attached. That is a consideration for any
future privacy policy, not a change to what the app actually knows about
anyone. **If this is ever reversed, drop the five device columns — the rest of
the table stands on its own.**

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

**THE DE-DUP KEY CONTAINS STATUS, AND THAT IS NOT OPTIONAL.** telemetry.js
collapses repeated events so one exception per frame is not six hundred
reports. The key must therefore contain everything that makes two events
DIFFERENT. It once did not — it keyed source events on the source name alone,
so `ok` and `unavailable` both collided with the `loading` already queued and
were discarded as repeats, and an outage shipped the stale `loading` row. **A
dead feed reported as still loading.** Any field added later that changes what
an event means goes in the key too.

**`sampleRate` IS 1.0 AS OF 2026-07-28 — EVERY VISIT REPORTS.** It was 0.25
for two days, and the reason it was turned down no longer exists: the sink was
a CONSOLE then, where volume was never a bill but ILLEGIBILITY, because
Cloudflare's real-time Worker log has no aggregation and no query. A database
does not get harder to read as rows arrive.

**The numbers, so this is a decision and not a vibe.** D1's free tier is
100,000 rows written per day, and "rows written" counts index updates —
measured on this schema, a `sessions` insert costs 4 and a `source_rollup`
upsert about 2. A visit is one session row plus roughly four feed transitions:
`1x4 + 4x2 ~= 12 rows`. The deliberate traffic peak of 2026-07-27 produced 386
visits — about 4,600 rows, under 5% of a day's budget. **The ceiling is
roughly 8,300 visits a day, ~21x the busiest day this app has had.**

**The flood case is not errors — it is state transitions, and they are
GLOBAL.** An error is per-session and rare. When NHC flips to `unavailable`,
every session on the site reports it within one `visibilitychange`: five
thousand concurrent readers, five thousand beacons, one fact. That is the
event telemetry exists for and the only one whose volume scales with the
crowd.

**THE SINK IS D1 AS OF 2026-07-27, and the flood is handled by SHAPE, not by
volume.** `events` takes one row per error or rejection — rare, per-session,
and the detail is the value. `source_rollup` is a COUNTER, not a log: each
beacon increments a per-minute row keyed by source, status, app, country,
standalone and reason, so five thousand readers seeing one NHC outage become
a handful of rows with a big `n` rather than five thousand rows. That is also
the more useful answer, because "how many sessions saw it" is the question.

**HONEST LIMIT: the rollup bounds STORAGE and QUERY COST, not the write
quota.** An upsert still counts as a row written, so five thousand beacons is
still five thousand writes against the 100k/day ceiling. **`sampleRate`
remains the only lever for write VOLUME.**

The scenario to watch is not a busy day, it is a busy MINUTE repeated: several
source outages during a landfall with genuinely viral traffic. One such spike
at five thousand concurrent readers is ~10,000 rows and survivable; several a
day is not. **If sustained traffic passes a few thousand a day, drop
`sampleRate` to 0.25 — still a large sample — with 0.05 as the floor worth
having.** A one-line push, not a rebuild.

Without a `TELEMETRY_DB` binding the console fallback still applies and is a
supported state, not a fault. It loses history, which is exactly what D1
buys back.

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
`functions/api/beacon.js` writes to its database binding when one resolves
and to `console.log('[landfall-telemetry] …')` when it does not, from ONE set
of rebuilt `row` objects so the two sinks cannot disagree. Console logs reach
Cloudflare's real-time Worker logs with zero configuration. History is the
only thing lost.

**SUPERSEDED 2026-07-27 — THE SINK IS NOW D1, AND ANALYTICS ENGINE IS NOT
COMING BACK.** D1 needs no entitlement, is self-serve on the free plan, and
can be QUERIED, which is what buys history back. The binding is
`TELEMETRY_DB` and it stays OPTIONAL — the D1 code path deployed safely to an
account with no binding at all and simply kept logging to the console until
one was added, which is the rule below working exactly as intended.

**AND THE MISTAKE WAS REPEATED ON 2026-07-27.** Analytics Engine was
recommended again, off the same pricing page, by an assistant that had not
read this file first. The repo already contained the answer. **Read the repo
before proposing a build; a pricing page still answers only what something
costs.**

**THE BINDING IS SET IN THE PAGES DASHBOARD, NOT IN `wrangler.toml`.**
Deliberate: adding a Wrangler config file makes it the SOURCE OF TRUTH for
the entire Pages project and turns the dashboard read-only, which would put
`INSPECT_KEY` and `MAPBOX_TOKEN` at risk. Cloudflare's own safe migration
path is `wrangler pages download config` first. A diagnostics binding is not
worth that blast radius.

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

### Aaron's settings — Pass A is not live until 1 and 2 are made

All in the Cloudflare Pages project, Production AND Preview, same place
`MAPBOX_TOKEN` already lives. **One at a time.**

1. **Environment variable `INSPECT_KEY`** — any long random string. DONE
   2026-07-25. Until it exists the four inspect routes 404 for everybody.
   After it exists they are reached with `?key=<value>`.
2. **~~Analytics Engine binding named `TELEMETRY`~~ — DO NOT ADD IT, EVER.**
   The account lacks the entitlement, and a binding to an unentitled product
   blocks every deploy (see above). **If it is currently set in the Pages
   project, REMOVE IT** — that is what unblocks the pipeline. Superseded by
   D1; there is no reason to revisit this even if support grants it.
3. **D1 database binding named `TELEMETRY_DB`** — Settings > Bindings > Add >
   D1 database binding. Variable name `TELEMETRY_DB`, database
   `landfall-telemetry` (`dc08ce89-b597-40da-b5b5-7571a9b30d90`, created
   2026-07-27, tables and indexes already applied). Production AND Preview,
   then redeploy. **OPTIONAL and safe to defer** — until it exists telemetry
   logs to the Worker console exactly as it does today, and nothing else in
   the app changes. Verify with `GET /api/beacon?key=<INSPECT_KEY>`, which
   reports `sink: "d1"` once the binding resolves.

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
