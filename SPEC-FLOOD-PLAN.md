# SPEC-FLOOD-PLAN.md — the flood rebuild

**A BUILD PLAN, NOT CANONICAL AS-BUILT.** Nothing in here is shipped. As each
phase lands it moves into the real specs — `SPEC-UI.md`, `SPEC-MAP.md`,
`SPEC-DATA.md` — and leaves this file. **When this file is empty, delete it.**

**Agreed with Aaron 2026-08-22 over one planning session.** Every decision below
has a reason written beside it, so that a later session can disagree with the
reason rather than re-derive the decision. Do not re-open a numbered decision
without new evidence; say what the new evidence is.

---

## 56. Flood — the rebuild

### 56.1 What is wrong with what shipped

§48.21 shipped on 2026-08-21 and three separate things about it are wrong. This
plan replaces it whole rather than patching it.

**THE MATCH REGION IS THE FORECAST CONE, AND THE CONE IS THE WRONG SHAPE.** A
cone is where the storm's CENTRE might go. It says nothing about where the
weather is. Flooding happens hundreds of miles from a centre, inland, days after
landfall, from a storm that has stopped being a hurricane — Ida drowned New
Jersey while its centre was over Pennsylvania. A cone-shaped search finds
alerts near the middle of the storm and misses the ones that matter most.

**THE MAP DRAWS EVERY FLOOD ALERT IN THE UNITED STATES.** The toggle sits in the
`Storm detail` group and the layer draws nationally, which is an internal
contradiction the manifest and the code have been holding since it shipped.
Aaron approved a storm-scoped layer; the session that built it changed the
design and wrote its justification into a file header instead of asking.

**HOME DATA IS IN THE STORM DRAWER AND IN THE WRONG PLACES ON HOME.** The house
block renders under storms that have nothing to do with the house, and the home
dashboard's Rain section renders under whichever storm the stepper is showing —
so cycling to a Japan typhoon leaves your rainfall figure sitting under its
name, claiming a connection nobody made. That is the storm drawer's own gate
failing twice, on the two screens it was written to protect.

---

### 56.2 What was measured, before any of this was designed

**Every number below came off real bytes or a real browser in this repo. None
was typed from memory.** Re-measure rather than trusting these if the plan is
picked up more than a few weeks later — the archive window is 72 hours and
rolls.

**THE NATIONAL VOLUME, ONE HOUR.** `origin/archive:latest/relay-nws-flood.json`,
captured **2026-08-22 20:31Z**, 13,042 bytes:

| | count |
|---|---|
| alerts in force nationally | **27** |
| carrying a polygon | **25** |
| Flood Warning | 19 |
| Flash Flood Warning | 6 |
| Flood Watch (no polygon) | 2 |

**==> THIS IS A SAMPLE OF ONE, ON A DAY WITH NO US LANDFALL. <==** The archive
source was added on 2026-08-21, so one snapshot exists. Treat the shape as
measured and the volume as provisional.

**THE POLYGONS ARE SMALL AND THEY CLUMP.** Widths 0.060° to 0.440°, median
0.270° — roughly 4 to 40 km. **Fifteen of the twenty-five sat in one line along
the Wabash valley in Indiana and Illinois.** This is not twenty-five things
scattered across a country; it is a river flooding.

**HOW BIG A POLYGON IS ON SCREEN**, web mercator, by zoom:

| zoom | smallest | median | largest |
|---|---|---|---|
| z4 | 0.7 px | 3.1 px | 5.0 px |
| z5 | 1.4 px | 6.1 px | 10.0 px |
| z6 | 2.7 px | 12.3 px | 20.0 px |
| z7 | 5.5 px | 24.6 px | 40.0 px |
| z8 | 10.9 px | 49.2 px | 80.1 px |

**HOW MANY ICONS MAPLIBRE'S OWN COLLISION ACTUALLY DRAWS.** Measured in
chromium against the vendored MapLibre 5.6.0, a 390×700 phone viewport, the
real twenty-five, `icon-allow-overlap: false`, a 28 px icon:

| view | icons drawn | polygons on screen |
|---|---|---|
| whole US, z3 | **7** | 25 |
| centred on the cluster, z5 | 8 | 17 |
| centred on the cluster, z7 | **11** | 14 |

**==> IT DOES NOT RESOLVE BY ZOOMING IN. <==** Sitting on top of the cluster,
three of fourteen warnings still have no icon and nothing says so. That is §5's
silence with a map over it, and it is why collision cannot simply be left on.

**A SYMBOL LAYER OVER A POLYGON SOURCE PLACES ONE ICON PER POLYGON, INSIDE IT.**
Measured, not assumed: two polygons produced exactly two symbols; a query at
each polygon's centre returned its symbol and a query at its corner returned
nothing. So the shapes need no centre computed **for drawing**.

**==> BUT THE BOUNDING-BOX CENTRE IS NOT GOOD ENOUGH FOR CLUSTERING. <==** Five
of the twenty-five bbox centres fall **outside their own polygon** — every one
of them a long river-corridor shape. A hazard icon in the wrong county one time
in five is not acceptable, and this is the measurement that decides §56.5.

**A FLOOD WATCH CARRIES NO STATE IN `areaDesc`.** Measured: it reads
`Cuyahoga; Lake; Geauga; Ashtabula Inland; …` — zone names only, no state
anywhere in the string. Parsing a state out of it, which was the obvious cheap
route, **is not possible.** The state IS published, in `geocode.UGC`
(`OHZ011` → Ohio, `PAZ001` → Pennsylvania), which the relay currently discards.

---

### 56.3 The corridor replaces the cone — ==> SHIPPED 2026-08-22 <==

**Phase 1 landed. This section is now as-built in `SPEC-UI.md` §48.21** under
*The corridor*, *The antimeridian, and the bug the corridor deleted rather than
solved*, and *`no_track` is not `none_matched`*. Read it there.

**WHAT IT ACTUALLY BUILT**, so a later phase does not go looking:

- `lib/flood.js` — `trackChains()`, `trackSamples()`, `nearestNm()`,
  `alertsNearTrack()`, `corridorSummary()`. The three bounding-box functions
  that used to do the matching — the extent measurer, the overlap test and the
  cone matcher — are deleted, along with the doc comment claiming an undrawable
  alert still matches.
- `RAIN.floodCorridorNm` — 300 nm, Aaron's starting value, unmeasured and
  labelled as such.
- `app/views.js` hands the two track FeatureCollections to the facade;
  `ui/view-storm-detail.js` reads `layers.pastTrack.fc` and
  `layers.forecastTrack.fc` where it used to read the cone.
- `ui/rain-storm.js` names the radius in every sentence, in the reader's units.
- `tools/test-flood.mjs` — rewritten against real bytes. Seven mutations
  verified red.
- `samples/flood/alerts-national.json` and `track-lala-cp2-{past,forecast}.geojson`
  frozen off the archive, since its window is 72 hours and rolls.

**THE ONE THING PHASE 1 DID NOT DO.** Nothing has been seen on glass, and
nothing can be until a US storm is near a flooding region. The radius is
therefore still a guess, and every phase below inherits that.

---

### 56.4 Watches need their zone shapes — ==> SHIPPED AND CONFIRMED 2026-08-23 <==

**Confirmed on glass against Moke**, whose Flood Watch rendered in the storm
drawer naming eight resolved Big Island zones. That is the first resolved watch
ever on screen: without this phase it carried `geometry: null`, matched nothing
and was held back entirely. **The zone SHAPES have still never been drawn** —
that is Slice A's, and §56.5 owns the question of whether a warning still reads
as more urgent than a watch fifty times its area.

**What it built is as-built in `SPEC-UI.md` §48.21** under *The
zone codes, and the two geographies inside them* and *Zone boundaries, and the
watch that finally has a shape*. Read it there. What stays here is what was
MEASURED, because those numbers were the whole reason the phase waited.

#### The boundaries, read for the first time on 2026-08-23

Nothing in this project had ever seen a zone boundary — not its envelope, not
its geometry type, not its vertex count, not its byte cost. All four were
guesses and §12 forbids a parser built on those. The archive runner fetched
23 of them, every forecast zone named by the three Flood Watches in force.

| | |
|---|---|
| zones asked for | **23**, one request each, all 200 OK |
| upstream latency | **20–218 ms** |
| total as served | **1,627,853 bytes** |
| median document | **34,854 bytes**; largest **229,320** (`HIZ023`, Kona) |
| geometry, compact | **361,930 bytes** — 22% of what was served |
| vertices | **15,335** across 23 zones; median 340, worst 2,171 |
| geometry types | **both** — `Polygon` and `MultiPolygon` |
| `cache-control` | `public, max-age=2592000` — **thirty days** |
| `last-modified` | **2026-04-16**, four months before the read |

**==> THE DOCUMENT IS FOUR TIMES THE BOUNDARY IN IT, AND MOST OF THE REST IS
WHITESPACE. <==** NWS serves these pretty-printed with four-space indentation,
plus a list of every observation station in the zone, forecast-office URLs and
effective dates. Kona is 229,320 bytes on the wire and 46,870 of them are the
polygon. This is why the relay projects rather than forwards.

**==> BOTH GEOMETRY TYPES ARE REAL. <==** A zone with offshore islands is a
`MultiPolygon`; one without is a plain `Polygon`. Handling only the second was
the obvious guess and it would have been wrong for a third of the captured set.

**==> AND THE CACHE HEADER SETTLES THE HOLD. <==** Thirty days is NWS's own
number, on a document last modified four months earlier. A county line is not
weather, and `CACHE.zoneFresh` is that number rather than one this project
invented.

#### The bulk probe: it answers, and it answers without shapes

§48.21 rejected zone resolution as *"seventeen more requests per watch"*, and
the collection endpoint was the hope that would delete the objection. **Asked
for the first time on 2026-08-23, `GET /zones?type=forecast&id=…` returned 200,
all 23 zones, 30,172 bytes, in 153 ms — with `geometry: null` on every single
feature.**

So the id list works and the boundaries do not come with it. **The per-zone loop
is not an implementation choice; it is the only route.** Phase 4 shipped on it:
23 zones, 23 requests, cached thirty days at the edge and keyed per zone so
overlapping watches share what they have already paid for.

**==> `include_geometry` IS ANSWERED AND THE ANSWER IS NO. DO NOT RE-PROBE IT.
<==** Read off
`origin/archive:latest/geometry/nws-zones-bulk-probe-geometry.geojson` on
2026-08-23: **200 OK, and byte-for-byte identical to the plain bulk probe beside
it** — same MD5, the same 24,282 bytes, `geometry: null` on all 19 features.
NWS accepts the parameter and ignores it.

So the per-zone loop is not an implementation choice, it is the only route, and
`functions/api/nws/zone.js` is correct as written. The probe stays in the runner
so the day NWS starts honouring the parameter is a day somebody notices — but
that is a watch, not an open question. **A session that re-measures this has
wasted its first hour.**

#### What was NOT measured, and must not be assumed

**Nothing has been seen on glass, and the shapes are the least-seen thing in the
app.** A resolved watch draws a MultiPolygon covering entire forecast zones —
far larger than the small river polygons §56.2 measured for warnings, whose
median width is 0.270°. A Hawaii zone is 0.7° tall. **Whether a warning still
reads as more urgent than a watch when the watch is fifty times its area is a
glass call and nobody has made it.** Phase 5 owns the map and inherits this.

**And the national volume is still one snapshot on a quiet day.** Three watches
naming 23 zones. `RAIN.zonesPerRequest` caps a request at 40 on that evidence
alone; a genuine national flood day has never been read.

---

### 56.15 The first attempt at Phase 5, and why it was reverted

**==> READ THIS BEFORE §56.5. IT IS THE MOST EXPENSIVE THING IN THIS FILE.
<==** Phase 5 was built and pushed on 2026-08-23 (`9c236dc`), patched twice
(`0439ba6`), and reverted whole (`0882353`) the same day. It was correct and it
was **slow**: tapping a storm on the globe and stepping between storms in either
drawer all dragged. The revert cleared it, which settles the cause — it was this
work, not something older.

#### The mistake was the evidence, not the code

**Every performance number behind that push was headless JavaScript measured in
a sandbox that cannot open a browser.** The interior-point search at 6 ms for 35
shapes, `nearestNm` at 7.1 ms per zone boundary, the whole corridor match at
2.8 ms —
all true, all reproducible, and all beside the point. The cost that was actually
felt lived where the sandbox cannot see: pushing county-scale geometry into
MapLibre sources, the Layers panel rewriting its own markup, style recalculation
and paint.

**==> SO THE RULE, AND IT IS NOT NEGOTIABLE ON THIS PHASE. <==** A measurement
taken in the sandbox is evidence about the sandbox. It is **never** evidence that
the app is fast. Any claim about how this feature performs comes off the CI
runner, which has a real browser, or off Aaron's phone. Nothing else counts, and
a session that reports millisecond figures from `node` as reassurance is
repeating the whole failure.

#### Three faults, and two of them are traps for the next attempt

1. **==> THE LAYER ENGINE CALLS `update()` ON EVERY DEFINITION ON EVERY
   `setBundle`, WHETHER OR NOT THE LAYER IS VISIBLE. <==** This layer is off by
   default, so a reader who never touched the switch paid the full corridor
   match on every storm selection and every poll, to draw nothing. **Any work in
   that hook must be gated on visibility, and `setVisible` must then push when
   it is turned on** or the switch appears to do nothing until the next poll.
2. **A poll re-pushing an unchanged bundle repeated all of it.**
   `repushSelected()` fires on every poll touching the selected storm, on a
   theme change and on a restyle. If the match is memoized, **key it on the
   bundle and not on the samples derived from it** — densifying produces a new
   array every call, so an identity test on samples compares against the copy it
   just made and never hits. The clock belongs in the key too: expiry is
   filtered at render.
3. **`app/layer-status.js` `commit()` fires `layersView.refresh()`
   unconditionally**, and that rewrites the panel's whole markup and rewires it.
   Four rows meant four rebuilds per selection for text that had not moved.
   **This one is pre-existing and survived the revert** — it is not Phase 5's to
   fix, but Phase 5 made it hurt.

**Neither the visibility gate nor the memo made the app usable.** Both were
measured to work — in the sandbox — and Aaron reported no improvement. That
disagreement between the measurement and the glass is the moment the session
should have stopped, and it is why the third attempt is a slice plan rather than
a fourth patch.

#### What was learned that is worth keeping

These are facts about the world and the data, independent of the code that was
reverted. **Do not re-derive them.**

- **The bounding-box centre falls outside its own polygon 6 times in 35** on the
  frozen national capture plus the two archived zone boundaries. §56.2 recorded
  5 of 25 on a narrower set; both are the same finding.
- **The area-weighted centroid in `lib/genesis.js` did NOT fail on that set** —
  it landed inside all 35. It carries no *guarantee* (a crescent puts a centroid
  in the hole by construction), but the claim that it fails like the bbox centre
  does was written before anybody ran it, and it is false.
- **HIZ023 is three members, not eight islands** — one island of 1,959 vertices
  and two slivers of six and five with effectively zero area, which NWS ships.
  Flattening them into one ring set returns a point inside a *sliver*, about a
  hundred metres off the island, which passes a naive "inside any member" check.
- **`nearestNm` costs about 7.1 ms against one resolved zone boundary** at 471
  track samples. Twelve of them is roughly 100 ms per selection, in JavaScript
  alone, before anything is drawn.
- **A rounded-square marker, not a dot.** `GENESIS_GEO` refuses a point marker
  outright because a storm in this app IS a filled dot with a spiral and a halo.
  A flood chip has to be separated by SHAPE, which also holds for a reader who
  cannot tell the green from the orange.
- **One ink for the cluster count fails WCAG AA on a reachable case** — the dark
  theme's ink measures 3.51 against a watch chip, under 4.5 for text that size.
  It has to be chosen per chip.

---

### 56.16 How Phase 5 gets built the second time

**==> IT LANDS IN THREE PUSHES, NOT ONE. <==** The first attempt was 2,523
inserted lines in a single commit: interior points, two sources, clustering, the
zoom gate, four generated chip images, tap-to-detail, keyboard rows and a
rewritten status row. When it was slow there was nothing to bisect, and the
session guessed twice rather than knowing once. **Each slice below is a separate
push Aaron can feel on a phone and revert on its own.**

**==> SLICE A SHIPPED 2026-08-23 AND HAS NOT BEEN JUDGED ON GLASS. <==** Both
structural faults below are designed out rather than patched afterwards — the
match and the source write sit behind the layer's own `visible` gate,
`setVisible` pushes on turn-on, and the memo is keyed on the bundle and the
alert list by identity. `tools/test-flood-layer.mjs` counts the WORK rather than
its result, because a feature count is identical with the memo deleted. The
visibility gate is doubled (`update()` and `push()`), so a single-line mutation
leaves the suite green and only removing both turns it red — recorded in the
suite so nobody mistakes that for blindness. **The phone pass below is still the
only real gate and it has not been run.**

**SLICE A — THE LAYER GOES PER-STORM. POLYGONS ONLY.** No chips, no clustering,
no interior points, no new panel. Delete the national draw, gate the work on
visibility, add the zoom ramp. This is the smallest change that closes §56.1's
first fault, and it is the one most likely to be the expensive one — it is where
county-scale geometry starts being pushed into a source on every selection.
**Judge on glass before anything else is written.**

**==> SLICE B SHIPPED 2026-08-23 AND HAS NOT BEEN JUDGED ON GLASS EITHER. <==**
Interior points, the clustered point source, the four chip images, the count and
its per-chip ink. As-built in `SPEC-UI.md` §48.21. **Tapping is NOT in it** —
the detail panel, the cluster split and the rows becoming buttons are Slice C.

**WHAT IT DID ABOUT COST, AND IT IS THE ONLY NEW STRUCTURAL FINDING IN THIS
PHASE.** The interior-point search is the one piece of arithmetic in this
feature big enough to be felt on its own: about 8 ms for a single 1,970-vertex
forecast zone, about 16 ms across the 33 national warning polygons, measured in
the sandbox on the archived bytes. **That is a FLOOR for a phone and never a
measurement of one.** The first attempt ran the whole set on every push. It is
cached per alert id now — an NWS CAP id carries a content hash and a corrected
alert gets a new one, so the id is a permanent handle on one shape — and the
cache OUTLIVES the selection, so stepping between storms whose corridors overlap
pays once per shared alert rather than once per storm.

**AND SLICE B DELIBERATELY TOUCHED NOTHING SLICE A SHIPPED.** The polygon zoom
ramp, the corridor memo and the visibility gate are unchanged. Changing any of
them here would have made the two pushes impossible to tell apart on a phone,
which is the failure this whole slice plan exists to prevent. **The two slices
are still separately revertable.**

**ONE ASSERTION CAUGHT ITS OWN AUTHOR.** The contrast section of
`tools/test-flood-features.mjs` was written claiming one ink everywhere fails on
the dark-theme watch chip. Recomputed rather than quoted, it fails on **three of
the four**. The layer's header names the case that forced the split; the suite
names the whole cost of undoing it.

**SLICE C — TAPPING.** The detail panel, the click dispatch, the cluster split,
and the alert rows becoming buttons. Mostly DOM and mostly cheap, and it is last
because §56.6's keyboard path is meaningless until there is something to open.
**Judge on glass.**

**==> AND IT DOES THE FILE SPLIT FIRST. <==** `map/layers/flood.js` crossed
§12's 700-line ceiling on Slice B (724) and has a row in SPEC.md's inventory
naming the cut: `chipImage`, `ensureChipImages` and the five paint expressions
are pure functions with no module state, so they lift out with no behaviour
change and nothing new to thread. It was not done in the push that crossed the
line because folding a behaviour-neutral split into the same commit as new
behaviour is what made the first attempt unbisectable.

#### Before Slice A, and this is a gate rather than a suggestion

**==> THERE IS NO BASELINE, SO THERE IS NOTHING TO COMPARE AGAINST. <==**
Nobody can say a change made the app slower without a number from before it.
`NOW.md` records `blockedMs 26490` against a 1200 budget from 2026-08-21, and
the same run reported `styleLoaded: false` on all three arms — which its own
report calls meaningless. **`tools/perf-instrument.mjs` counts console errors on
the main page while they come from MapLibre's worker, so its zero is not a
zero.**

Fix the instrument, take one honest reading of *tap a storm on the globe to the
drawer being painted* on the current `main`, and write the number into `NOW.md`.
**Until that exists, every perf argument on this phase — including one arguing
that a slice is fine — is somebody's impression.**

**AND THE GATE THAT WOULD HAVE STOPPED THE FIRST ATTEMPT NOW EXISTS, UNARMED.**
`tools/perf-select.mjs` runs in CI's `browser` job. It drives `?replay=ida` —
samples off disk, so the storm is identical every run and two numbers a month
apart are comparable — taps a storm row six times, discards the first, and
reports the **worst single main-thread block** during a selection. That is the
number that corresponds to *it feels sticky*; an average would hide the one
dropped frame that is actually felt, and the wall clock to the panel appearing
can look fine while the thread stays jammed behind it.

**==> IT IS NON-BLOCKING AND ITS BUDGETS ARE `null`, AND BOTH ARE DELIBERATE.
<==** `tools/perf-budgets.json` ships empty because a budget nobody measured is
a number somebody invented. And the check itself was written in a sandbox that
cannot execute it — this repo's own rule is that **a check nobody has seen pass
does not get to block a deploy** (`headless-check` was promoted exactly that
way). Watch it print stable numbers over a few runs, fill the budgets from them,
record the baseline in `NOW.md`, then drop `continue-on-error` from the workflow.
**Until that happens it is an instrument, not a gate, and it says so in its own
output.**

**THE OTHER HALF OF FIXING THE INSTRUMENT WAS ADMITTING WHAT IT CANNOT SEE.**
`perf-instrument.mjs`'s colour-null counter is renamed `colorNullsMainThread`
and carries `workerConsoleWatched: false` beside it, and the report prints the
blind spot every time rather than only when the count is zero. Reaching
MapLibre's worker console needs a CDP attach and is its own change — what is
fixed here is that a 0 can no longer be read as "none happened", which is how
that number got recorded as progress once already.

#### The phone pass, per slice — three minutes, and it is the only real gate

**Aaron is the glass and no tooling substitutes.** After each slice deploys, on
a real phone, on cell data, with the VPN off:

1. **Tap four storms in a row on the globe.** Does the drawer arrive under your
   finger, or after it? This is the exact motion that exposed the first attempt.
2. **Step through storms on the home dashboard with the chevrons.** Same
   question. This path was as bad as the globe and is easy to forget.
3. **Turn the `Flood alerts` switch on and off twice**, then repeat 1. The layer
   is off by default, so the off case is what most readers get and it must cost
   nothing — that was fault 1 in §56.15.
4. **Open a storm, leave it open for a poll cycle** (a few minutes) and tap
   another. A re-push of an unchanged bundle used to redo the whole match; this
   is where that would come back.
5. **Only then look at whether it is any good.** Colour, size, whether a warning
   still reads as more urgent than a watch fifty times its area.

**If any of 1–4 feels worse than the slice before it, the slice is reverted, not
patched.** That is the rule the first attempt broke: two patches were shipped
against a symptom nobody could measure, and both were wrong.

**==> AND IF THE MEASUREMENT AND THE PHONE DISAGREE, THE PHONE IS RIGHT. <==**
It happened on 2026-08-23 — Aaron reported no improvement while the numbers said
the fix could not have failed — and the session shipped another guess instead of
stopping. `CLAUDE.md` carries this rule now because it has to survive a change
of session config.

---

### 56.17 The `Flooding` section says it is checking, and it never is — ==> FIXED AND CONFIRMED 2026-08-23 <==

**==> OPTION 1 WAS BUILT: THE LIST IS FETCHED FOR EVERY READER, AND ONLY THE
DRAWING IS STILL GATED ON THE MAP SWITCH. <==** As-built in `SPEC-UI.md` §48.21.
`main.js` calls `ensureFlood()` unconditionally from `applyLayerState()` **and**
once at boot outside the map's control, so a basemap outage cannot strand the
section — §5's rule that one source going down must not blind another, and the
flood relay has nothing to do with the tile host. The map push kept its gate:
the list is small JSON the section needs anyway, while pushing county-scale
geometry into a MapLibre source is the expensive half and nobody who left the
layer off pays it. `/api/nws/flood` is on the cron warm list now
(`worker/src/sources.js`), so the first ask on a cold edge comes off the edge.

**The stale half-sentence went with it.** `data/flood.js`'s header claimed the
fetch fired when "a storm drawer asks for its count", which was never true and is
most of why nobody noticed. `app/views.js`'s facade comment said the read-only
shape existed to avoid a fetch; it is kept now for a different and still-good
reason — two callers racing across a cache boundary would let two surfaces
disagree about how many alerts are in force.

**What follows is the account of the fault, kept because §56.5's map puts more
weight on this same path.**

Aaron found it on 2026-08-23. Open any storm with the
`Flood alerts` map switch off — which is the default — and the `Flooding`
section read *Checking flood alerts…* **forever**. No request was ever made and
none ever would be.

The chain, verified rather than inferred:

- `ui/flooding-storm.js` prints the checking line whenever the summary state is
  `loading`.
- The state is `loading` when `floodFacade.value()` returns null.
- That is `floodSlot` in `app/views.js`, and the only thing that ever fills it
  is `views.setFloodSlot(...)`.
- `main.js` calls that from `ensureFlood()`, which runs **only** when
  `toggleOn('floodAlerts')`. The else branch sets the slot back to null
  explicitly.

**==> IT IS §5's WORST SENTENCE, PRINTED BY THE FEATURE WRITTEN TO PREVENT IT.
<==** "Checking…" asserts a fetch is in flight. None is. A reader on a bad
connection reads it as their connection; a reader on a good one reads it as a
hung app. Both are wrong, and neither can tell.

**AND THE TWO FILES DISAGREE IN WRITING ABOUT WHOSE JOB THIS IS.**
`data/flood.js`'s header says the list is fetched "when either the Flood alerts
toggle goes on **or a storm drawer asks for its count**." The facade in
`app/views.js` says the opposite — `value()` is read-only and never fetches,
because a drawer that kicked its own request would make opening a storm cost a
national download. **The code follows the second. The first describes something
that does not exist**, and that stale half-sentence is most of why nobody
noticed.

#### The gate was right once and is not right now

Nothing is wrong with the relay. `/api/nws/flood` exists, projects the national
list down small, and serves it from the edge. **The device simply never asks.**

The rule — do not download this for somebody who never turned the map layer on
— was written when flood alerts were only ever painted on the globe. §56.7 then
made `Flooding` a permanent section on **both** screens. A section that renders
every time a storm is opened, but whose data arrives only if the reader happens
to flip an unrelated map switch, is broken by construction.

**Three ways out were written down; option 1 was taken.** The other two are
recorded so nobody re-derives them: *say "not checked yet" with a button*, which
makes the reader press a control for something the app could have done; and *do
not render the section without the layer on*, which quietly removes a section
§56.7 deliberately put on both screens.

**==> AND FLOOD IS NOT ON THE CRON WARM LIST. <==** Checked 2026-08-23:
`worker/src/sources.js` warms NHC storms, JTWC storms, GDACS events, TCGP
storms, genesis areas, both outlooks, and the derived adecks, ships, advisories,
JTWC warnings and GDACS geometry. **Neither `/api/nws/flood` nor
`/api/nws/zone` is among them.** So whoever asks first on a cold edge waits for
the relay to go to NWS — which under option 1 is a reader opening a storm.
Adding flood to that list is a small, separate change and it makes the section
fill from the edge instead of from a round trip.

**IT IS A PREREQUISITE, NOT A PHASE.** It is small, it is independent of the map,
and it is the difference between the `Flooding` section working for everybody and
working only for people who found a switch. **Do it before Slice A** — Phase 5
puts more weight on this same data path, and building on a section that has never
had data is how a fault gets attributed to the wrong change.

---

### 56.18 Making the corridor match cheap — ==> SHIPPED AND CONFIRMED 2026-08-23 <==

**==> CONFIRMED ON THE EXPENSIVE CASE, NOT A QUIET ONE. <==** Judged on a phone
against Moke with the `Flood alerts` switch off — the default, and the path that
matters. Her watch resolved to **eight large Hawaii coastal zones**, the same
family of boundary as the 1,970-point fixture the measurements below were taken
against. Aaron's verdict was that it works and feels good. The first attempt at
Phase 5 was reverted for exactly this motion, so this is the gate that counts
rather than a formality.

**==> §56.17 WOULD HAVE HANDED EVERY READER AN 800 ms BLOCK, AND THE PLAN DID
NOT SEE IT COMING. <==** Letting the `Flooding` section fetch means the corridor
match runs on every storm open for everybody instead of for the few who found the
map switch. Before this pass that match cost **800 ms of pure arithmetic** for one
US storm — measured in `node`, which is faster than a phone. Building §56.17 as
written would have recreated the Phase 5 lag in a new place, wearing the plan's
own recommendation.

**THE MEASUREMENTS.** Ida's real track (363 densified samples) against the frozen
national capture plus Phase 4's resolved watch zones:

| what is in the list | before | after |
| --- | --- | --- |
| 33 real warning polygons | 4.6 ms | 3.0 ms |
| + 23 watch zones far from the track | **800 ms** | **2.4 ms** |
| + 23 watch zones lying ON the track | **235 ms** | **15 ms** |

**TWO CAUSES, AND NEITHER WAS THE NUMBER OF ALERTS.**

1. **==> THE ONLY PREFILTER WAS LATITUDE. <==** A Hawaii coastal zone sits at
   19.0–19.7 and Ida's track spans 16.5–48.8, so the gate rejected **nothing**
   and all 1,970 of that zone's points were measured against all 363 samples —
   for a shape 4,000 miles away. Latitude was chosen because it has no
   antimeridian seam; the fix is to add longitude and *decline* on the seam
   rather than pick a frame, which is what got the old `extent()` deleted.
2. **==> NWS DRAWS ZONE BOUNDARIES AT 65 METRES PER POINT. <==** Against a
   corridor 300 **nautical miles** wide. The precision is real and irrelevant to
   this question.

**THREE STAGES, IN `lib/flood.js`.**

- **The boxes.** `boxLowerNm` is a haversine with the smallest lat/lon gaps the
  two bounding boxes admit and the cosine at the highest latitude either
  reaches, so it can only come out *smaller* than the true distance. One
  comparison kills every shape in another part of the country.
- **The thinned outline.** `RAIN.floodCoarseTolNm` = 1 nm; HIZ023 goes from 1,970
  points to 109. A thinned outline can only report a shape as **further** than it
  is, so it can only keep an alert that is just outside — never drop one that is
  just inside, which is the direction §56.3 demands.
- **The full outline**, reached only when a shape lands within the tolerance of
  the corridor edge, where the thinning could actually change the verdict. A zone
  lying across the track is hundreds of miles inside and never gets here.

**==> THE INCLUDE/EXCLUDE VERDICT IS EXACT AT EVERY RADIUS. ONLY THE REPORTED
DISTANCE MOVES, BY AT MOST 1 nm, AND ONLY UPWARD. <==**

**THE THINNING IS PAID ONCE PER FETCH, NOT ONCE PER REPAINT.** A `WeakMap` keyed
on the geometry object itself — `inForce`'s spread copies the reference, so the
same object arrives on every render — and weak so a replaced list is not held
alive by this cache.

**==> WHAT THE GUARDING TEST TAUGHT, AND IT IS THE §12 LESSON AGAIN. <==**
`tools/test-flood-fast.mjs` walks a real zone boundary across the corridor edge in
0.05 nm steps at five radii — 1,575 include/exclude decisions — and probes 620
shapes spread over the globe. **Its first version passed with a deliberate 2%
inflation in `boxLowerNm`**, which is the mutation that drops live warnings off a
storm. It tested the *consequence* (did anything real get dropped) through a probe
grid too coarse to land in the narrow band where a slightly-too-large bound
actually bites. `boxLowerNm` is exported now and the **inequality is asserted
head-on**: the bound is never larger than the distance it bounds. Both mutants —
the inflated bound, and removing the exact fallback at the corridor edge — were
verified to turn the suite red.

**A SECOND ASSERTION EXISTS ONLY TO GIVE THE FIRST ONE TEETH:** a bound that is
always far below the truth satisfies the inequality and rejects nothing, so the
suite also requires the bound to come within 50 nm of the true distance at least
once. It gets to 0.2 nm.

**WHAT WAS DELIBERATELY NOT BUILT: a memo of the whole answer per storm.** The
plan called for one. With the `WeakMap` in, a repaint costs 3 ms on a real
national list and 15 ms in the worst constructed case, so the memo would buy a
few milliseconds in exchange for an expiry-invalidation problem on a hazard
surface — where the failure mode is showing a flood warning that has run out.
Not worth it. If the phone disagrees, it is a small addition and this is where to
start.

---

### 56.5 The map

**ICON AND POLYGON, EACH DOING THE JOB THE OTHER CANNOT.** The polygon is the
honest answer to *which county* and is the whole point up close. The icon is
what makes an alert findable and tappable when the polygon is three pixels.

**THE POLYGON IS ZOOM-GATED, AND THE THRESHOLD COMES OFF THE MEASUREMENTS IN
§56.2.** Below roughly z6 a median polygon is under 12 px and reads as dirt on
the screen. Appears around z6, solid by z7. One constant, movable on glass.

**THE ICONS CLUSTER AND SPLIT AS YOU ZOOM.** MapLibre's own clustering, so
nothing here animates or counts anything by hand. A cluster carries the number
of alerts inside it.

**==> CLUSTERING NEEDS A POINT SOURCE, AND THE POINT MUST BE COMPUTED PROPERLY.
<==** MapLibre clusters Point geometry only, so the icons cannot ride the
polygon source the way a plain symbol layer could. The bounding-box centre —
the obvious cheap point — **falls outside its own polygon five times in
twenty-five on real data** (§56.2), every one of them a river corridor, which
is exactly the shape being clustered. So compute a true interior point: the
same pole-of-inaccessibility approach MapLibre uses internally for its own
polygon labels. About forty lines, no dependency, no build step.

**ONE LIST, TWO SOURCES, BUILT IN ONE PLACE.** Shapes in one source and points
in the other is exactly the split that drifts apart. Both are built from a
single function over a single alert list, so there is never a second list to
keep in step.

**THE TEST THAT GUARDS IT:** every computed point falls inside its own polygon,
across the whole archived set. Mutation-verify by swapping in the bbox centre
and confirming the suite goes red on those five.

**THE LAYER IS PER-STORM AND DRAWS FOR THE SELECTED STORM ONLY.** Which puts it
honestly in the `Storm detail` group where the manifest always had it.

**==> AND THIS IS THE ONE PLACE THIS PLAN ACCEPTS A RISK IT CANNOT WORD AWAY.
<==** Drawing green shapes only inside one storm's corridor tells the reader
*this storm did this*, in pictures, where there is no sentence to hedge with —
and an NWS flood alert names no storm (§48.21, §50.3). The mitigation is that
the layer draws only while that storm is selected, so the drawer's wording is on
screen at the same moment as the shapes. **Aaron made this call knowingly on
2026-08-22.** It is written down here so that a later session finds the decision
rather than the smell.

**WITH NO STORM SELECTED THE LAYER DRAWS NOTHING, AND THE STATUS ROW SAYS WHY.**
A toggle that appears to do nothing is its own bug. The row reads that a storm
must be selected — never an empty map with no explanation.

---

### 56.6 Tapping an alert

**Tap a single icon → that alert's details. Tap a cluster → the map zooms until
it splits.** The second is MapLibre's standard behaviour and readers already own
it, and it removes the "which of these fifteen did I just tap" problem without
any chooser UI.

**THE DETAIL VIEW SHOWS WHAT THE RELAY ALREADY CARRIES** — event, the whole area
list, when it began, when it ends, and how long is left.

**==> THIS SECTION USED TO SAY "AND THE ISSUING OFFICE" AND THAT WAS WRONG.
<==** Checked 2026-08-23: `functions/api/nws/flood.js` projects id, event,
areaDesc, severity, urgency, onset, expires, ends, geometry, drawable, zones and
counties. **`senderName` is not among them.** The office is not in hand and the
panel cannot print one. Adding it is one short string per alert and a separate,
deliberate decision about the projection — **not something to slip into a map
phase because it was named here by mistake.**
**Do not widen the relay projection to carry NWS's `description` and
`instruction`.** That projection takes 34,369 stored bytes down to 2,607 and a
suite asserts the ratio; putting the prose back blows it on every phone for a
field most readers never open. If the detail reads thin on glass, fetch that one
alert on demand — do not widen the list.

**KEYBOARD IS NOT OPTIONAL AND THE MAP ALONE DOES NOT PROVIDE IT (§10).** An
icon reachable only by tapping the globe does not exist for a keyboard user. The
alert rows in the Flooding section are the keyboard path: each row opens the same
detail the icon does. **A phase that ships the icon without the rows has shipped
a gesture-only feature.**

---

### 56.11 What gets deleted

Deleted code is deleted, not commented out, and orphaned imports go with it
(§12).

- ~~`lib/flood.js` — the extent measurer, the overlap test, the cone matcher~~
  — **done, Phase 1.** The antimeridian machinery had no job once the match
  became a distance.
- ~~`tools/test-flood.mjs` — the cone cases~~ — **done, Phase 1.** Including
  the assertion that encoded the shapeless-alert bug.
- ~~`lib/flood.js`'s doc comment claiming an undrawable alert still matches~~ —
  **done, Phase 1.** The comment said the opposite of the code; the code was
  right. Once §56.4 gives watches real geometry the special case disappears
  entirely.
- ~~The house block in `ui/rain-storm.js`, its scope logic, and its CSS~~ —
  **done, Phase 3.** The block, both scope predicates, the wind-field verdict
  behind them, the composition in `app/views.js`, the house-fallback constant
  and the hairline rule all went together — six exports, one constant, one CSS
  rule. Half-removing it in Phase 2 would have left a predicate answering a
  question with one live answer and one dead one; the whole chain went in one
  pass instead. `SPEC-UI.md` §56.9 names each piece.
- ~~The `Coastal flooding` section, and `surge` from `ui/section-icon.js`~~
  — **done, Phase 2.** Both deleted rather than deprecated. `ui/surge-home.js`
  is gone whole; its contents are the lower half of `ui/flooding-home.js`.
- ~~The flood-alert rows inside both Rain sections, and the `alerts: null`
  sentences that went with them~~ — **done, Phase 2.** Rain is a forecast and
  only a forecast on both screens now.
- `map/layers/flood.js`'s national-draw behaviour and the file header arguing
  for it.

---

### 56.12 The build order

**Each phase is sized for one session. Do not start two.** When a phase lands,
delete it from this file and write what it built into the real spec.

**PHASE 1 — THE CORRIDOR. ==> DONE, 2026-08-22. <==** See §56.3 above and
`SPEC-UI.md` §48.21 for what it built.

**IT DID CHANGE THE UI, WHICH THIS PLAN SAID IT WOULD NOT, AND THAT WAS RIGHT.**
The drawer said *"in force inside this storm's forecast cone"*. Once the match
stopped being a cone, leaving that string in place would have shipped a false
sentence — so the copy followed the code. No new structure, no new sections. A
later phase should read "no UI changes" as "no new UI", not as licence to leave
a lie on screen.

**PHASE 2 — THE FLOODING SECTION. ==> DONE, 2026-08-22. <==** See §56.7, §56.8
and §56.10 above, and `SPEC-UI.md` for what it built.

**IT ASKED ONE QUESTION THE PLAN DID NOT ANSWER, AND AARON ANSWERED IT: ALL
FLOOD DATA ASSOCIATED WITH THAT STORM.** The plan said "the modelled coastal
figure" on both screens without saying which figure the STORM drawer gets, and
the only one it had was house-anchored — which §56.9 forbids there. So
`lib/surge-locations.js` gained `surgeOnStorm`: the deepest coast this storm is
modelled to flood anywhere, no house in it. The storm drawer's section now
carries every flooding fact tied to the storm — corridor alerts, the agencies'
storm-surge rows, the modelled figure — and the house-anchored version stays on
the screen that has a house on it.

**IT ALSO TOOK ONE THING OUT OF PHASE 3, AND THAT WAS THIS CHANGE'S COST RATHER
THAN VOLUNTEERING.** The warnings-only tier in the storm drawer's house block
drew flood rows and nothing else. Leaving it would have shipped the same
alert in two sections of one panel — the duplication the merge exists to delete.
The tier returns empty and its fetch gate closed; the block, the scope logic and
the CSS are still Phase 3's.

**AND IT TRADED AWAY §48.6's ORDERING, DELIBERATELY.** A warning in force now
renders BELOW the rainfall total, because the section order is Rain then
Flooding. Within the section the rows still lead. **Judge on glass.**

**PHASE 3 — HOME GATING. ==> DONE, 2026-08-22. <==** As-built in `SPEC-UI.md`
§56.9. **This file's own §56.9 is gone** — the section moved to the real spec
under the same number, and two headings with one address is a collision
`tools/spec-index.mjs` fails on.

**WHAT IT ACTUALLY BUILT**, so a later phase does not go looking:

- `lib/flood.js` — `stormSamples()` and `homeInCorridor()`; `nearestNm()` now
  measures a `Point`, so one function answers for a county and for a house.
- `ui/home-gate.js` — new, and the whole rule: `houseCorridor()` and
  `houseSectionsShow()`, pure, imports `lib/` only. `ui/view-home.js` takes one
  seam plus `wireHouseSections()`, which runs on the quiet path too.
- `ui/rain-home.js` — `inner(home, head, { underStorm })`, and the attribution
  clause that rides on it.
- `ui/rain-storm.js` — the house block, its state machine, its retry and its
  scope logic deleted. 484 lines to 196, five injected dependencies to one.
- Deleted whole: both scope predicates, the wind-field verdict, its
  composition, the range-to-home helper, the house-fallback constant, the
  hairline CSS rule, and three sections of §48 with them. `SPEC-UI.md` §56.9
  names each piece.
- `tools/test-flood.mjs` — eighteen cases against Ida's advisory-19 positions
  and Lala's archived track. Four mutations verified red.
- `tools/test-home.mjs` — eleven cases on the view gate, including the
  calm-day and source-outage exceptions. Three mutations verified red.

**ONE THING THE PLAN DID NOT SAY AND THE AUDIT FOUND.** §56.9 promised the
sections would render *when there is no storm on screen at all*, and that half
did not exist: both were built only on the dashboard path, which needs a threat
storm, so a genuinely calm day showed neither. Building the gate without it
would have shipped a change that only ever subtracted. Aaron settled it on
2026-08-22 — build both halves in this phase.

**AND ONE THING IT TRADED.** The attribution sentence — *total rain from all
causes, not this storm alone* — followed the figure to the home screen rather
than being deleted with the block. The gate makes it need one MORE than before:
a section that draws only for a storm measured to reach the house is a section
whose presence asserts a connection.

**IT WAS NOT AS SELF-CONTAINED AS THE PLAN SAID, AND THE COST WAS DELETION
RATHER THAN INVENTION.** "Small, no new data" was right about the data and
wrong about the blast radius: taking the house out of the storm drawer orphaned
a chain of six exports and one constant reaching from `ui/` through `lib/` into
`data/` and `config/`. Retiring them cleanly (§12) was most of the diff.

**AND IT BUILT A HALF THE PLAN ASSUMED ALREADY EXISTED** — the sections on a
calm day. See §56.9 above.

**PHASE 4 — ZONE SHAPES FOR WATCHES.** Resolve and cache the zone polygons a
watch names. Ends with watches drawable and matchable, and the watch/warning
special case gone from every surface downstream.

**==> BLOCKED ON A CAPTURE THAT IS NOW IN THE RUNNER, 2026-08-22. <==** This is
a tier-3 change (`CLAUDE.md`) and the real bytes did not exist: `api.weather.gov`
is outside the wall, WebFetch returns empty against it — NWS answers 403 without
a contact in the User-Agent and WebFetch cannot set one — and no zone URL had
ever been archived. The probe is pushed; **the next session on this phase starts
by reading `geometry/nws-zone-*.geojson` off `archive`, writes what it finds into
§56.4, and only then writes a parser.** What landed with the probe, so nobody
rebuilds it: `tools/zone-codes.mjs` (`watchZoneCodes`, pure, splits forecast
zones from counties and counts what it drops), `tools/test-zone-codes.mjs`
(20 assertions, seven mutations verified red), and
`samples/flood/watches-national.json` frozen off the archive because that
branch's window is 72 hours and rolls.

**AND ONE PIECE OF PHASE 4 NEEDS NO NEW BYTES AT ALL:** the relay discards
`geocode.UGC` today — verified, zero mentions in `functions/api/nws/flood.js`,
`data/flood.js` or `lib/flood.js` — and §56.2 established the state is
recoverable from nowhere else. Keeping it is provable offline against
`samples/flood/watches-national.json`. **A Pages Function cannot import from
`lib/` (§4.13), so that is a mirrored copy of the UGC split, kept honest by
`tools/test-relay-mirrors.mjs` — not an import.**

**PHASE 5 — THE MAP. ==> ATTEMPTED AND REVERTED 2026-08-23. READ §56.15 AND
§56.16 BEFORE §56.5. <==** Interior points, clustering, the polygon zoom gate,
the icon, and tap-to-detail. Last because it is the only phase that cannot be
judged without weather, and because Phase 2 already gave the feature a
keyboard-reachable home.

**It was built, pushed, patched twice and reverted whole in one day.** It worked
and it was slow, and the revert cleared the slowness — so the cause is settled.
§56.15 has the diagnosis and the findings worth keeping; §56.16 has the three
slices it lands in next time and the baseline that has to exist first. **§56.17
is a prerequisite and comes before any of it.**

**==> THE ONE-LINE VERSION, IF NOTHING ELSE IS READ: <==** a measurement taken
in the sandbox is evidence about the sandbox, never about the app; work in the
layer engine's `update()` hook is paid by every reader on every selection whether
the layer is on or not; and this phase ships in three pushes so that the next
time something is slow, there is something to bisect.

**PHASE 6 — PAST RAINFALL, THE GLOBAL FIGURE.** How much has already fallen at
the reader's address, in a window we choose rather than one the source hands us.
**See §56.14 for the whole of it** — the source, the wording, the two rules, and
the five things the archive runner has to measure before a line is written.

**==> IT IS LAST BY DEPENDENCY, NOT BY IMPORTANCE. <==** It needs the `Flooding`
section to exist, which is Phase 2, and nothing else — so it could in principle
move ahead of 3, 4 or 5. **It is here because it is the only phase gated on a
measurement nobody has taken**, and because 3, 4 and 5 finish a feature that is
half-built while this one starts a new one. If the runner probe comes back clean
and a US storm still has not arrived to judge Phase 5 on, reordering is
reasonable — say so out loud rather than quietly swapping them.

---

### 56.13 Open, and not to be guessed at

**THE CORRIDOR RADIUS HAS NO VALUE YET.** Nothing in the sandbox can measure it.
Phase 1 ships a constant with a starting value Aaron moves on glass; **do not
write a derivation into the file that reads as though the number was measured.**

**NONE OF THIS CAN BE JUDGED ON GLASS UNTIL A US STORM IS NEAR A FLOODING
REGION.** Every phase can be proven offline against the archive; not one of them
can be *seen*. Expect this to sit under `HELD FOR WEATHER` in `NOW.md` after each
push, and say so plainly in the report rather than calling it done.

**THE NATIONAL VOLUME IS ONE SNAPSHOT.** 27 alerts on 2026-08-22 is a quiet day.
Nobody has measured an active one. Re-read
`git show origin/archive:latest/relay-nws-flood.json` before tuning anything
that depends on the count — clustering thresholds most of all.

---

### 56.14 Past rainfall — the global figure this feature is missing

**AGREED WITH AARON 2026-08-22, AFTER PHASE 2 SHIPPED. NOTHING BELOW IS BUILT.**

#### The question it answers, and the hole it fills

**RAIN ALREADY ON THE GROUND IS THE BIGGEST SINGLE INPUT TO WHETHER THE NEXT
INCH FLOODS ANYBODY, AND THIS APP DELETES IT.** §48.19 clips every block that
has already ended, correctly — the Rainfall section says *expected*, and summing
rain that had already fallen into a forecast total was a fluent wrong number
that read perfectly. That fix is not being reopened. **What is proposed is a
SECOND figure, labelled as what it is, in a different section.**

**==> AND IT IS THE ONLY GLOBAL FLOOD-RELEVANT NUMBER THIS PROJECT HAS FOUND.
<==** That is the argument, not the convenience. Today a storm outside the
United States gets a `Flooding` section containing a modelled coastal figure and
a sentence explaining that NWS is US-only. §48.15 records the search: **no
global equivalent of `/alerts/active` exists** and nothing has turned one up. So
the coverage gap §56.7 documents is real and permanent for ALERTS — but rain
that has already fallen is available at every point on Earth, keyless, from a
source this app already relays.

#### REJECTED: clipping the past out of the payload we already hold

The cheap version, and it was looked at first. `rainSummary` parses the whole
series and `futureBlocks` throws the past half away *inside* the function — so a
past total is the mirror of a function already in that file, at zero network
cost. §48.19's own measurements say how much is sitting there: the global path
always starts at 00:00 UTC of the current day, and every NWS grid captured starts
hours before its own `updateTime`.

**==> IT IS REJECTED BECAUSE THE WINDOW WOULD BE AN ACCIDENT OF THE SOURCE
RATHER THAN A CHOICE. <==** On the global path it is four hours at 04Z and
twenty-three at 23Z. On NWS it is whatever that grid's publish lag happened to
be. **Two readers a mile apart could be shown the same rain measured over
different periods, and neither sentence would be wrong.** A figure whose window
moves through the day and changes shape by provider is the class of number
`CLAUDE.md` exists to stop — it reads perfectly and nothing about it invites a
second look. Free is not the same as right.

#### THE SOURCE — `past_days` on the route we already own

`functions/api/rain/global.js` already asks Open-Meteo for
`&hourly=precipitation&forecast_days=N&timezone=UTC`. **`past_days` is one more
query parameter on the same call**, and `projectOpenMeteo` rebuilds every hour
into NWS's `validTime` grammar regardless of how many there are, so nothing
downstream learns the series got longer.

**WHAT IT COSTS, MEASURED ON THE ARCHIVED MANILA CAPTURE** (72 hourly values,
1,992 raw bytes, 4,383 bytes after projection — 27.7 raw and 60.9 projected
bytes per hour):

| window | hourly blocks added | raw bytes | projected bytes |
|---|---|---|---|
| `past_days=1` | 24 | ~665 | ~1,461 |
| `past_days=2` | 48 | ~1,330 | ~2,922 |
| `past_days=3` | 72 | ~1,994 | ~4,383 |

**==> IT IS A MODEL, NOT A RAIN GAUGE, AND THE WORDING HAS TO CARRY THAT. <==**
Open-Meteo's past hours are model and reanalysis output, not an observation from
an instrument near the reader. "3.1 in fell" overclaims; the sentence has to say
estimated and name the provider, exactly as the forecast line already does
(§48.12). **This is the single most likely thing to get wrong**, because the
number will look and behave identically either way.

**==> AND NWS HAS NO MATCHING PAST SERIES, SO THE PAST COMES FROM ONE SOURCE
EVERYWHERE. <==** `quantitativePrecipitation` is a forecast grid. An observed
American figure would be a different service entirely and is not in scope here.
So on an American house the forecast half stays NWS and the past half is
Open-Meteo. **That seam is invisible to the reader and it is deliberate:** one
source for what fell, one for what is coming, the same on every point on the
planet, is more consistent than a past figure that exists in some countries and
not others. Say so in the provenance line rather than hiding it.

#### WHERE IT GOES: `Flooding`, NOT `Rain`

**Rain answers *what is coming*. Flooding answers *is water going to be where I
am*.** Rain already on the ground belongs to the second question, and a flood
warning with *"about 3 inches fell here in the last two days"* under it is a
warning that explains itself.

**It also gives that section something true to say where it currently
apologises.** On a Japan typhoon the rows are empty by coverage and the modelled
figure is the only content; this is a real, local, present-tense fact to put
beside it.

**==> IT IS THE READER'S ADDRESS, NOT THE STORM'S FOOTPRINT, AND THOSE ARE
DIFFERENT FEATURES. <==** The storm-wide version — how much has THIS STORM
already dumped, and where — is GDACS's `images.rainaccumulationmap`, a PNG per
storm with no bounds published in the payload. **Not in scope here.** It cannot
be probed from the sandbox and nothing should be designed against it until a
runner has fetched one and established whether it is georeferenced consistently.
Recorded so the two do not get confused for one piece of work.

**==> §51.5 IS NOT IN THE WAY, AND A LATER SESSION WILL THINK IT IS. <==** That
section is about SURGE: NHC publishes an official inundation forecast and a
global model must not be shown over coastline the responsible warning centre
already forecasts for. **There is no competing NHC product here** — §48.1
establishes NHC publishes no rainfall geometry at all — so the authority
argument does not transfer. This proposal never needs a GDACS event id and never
needs the name join §51.5 forbids.

#### The wording, and the two rules that go with it

> **About 3.1 in** has fallen at your house in the last 48 hours.
> Estimated by Open-Meteo, nearest model point 14.60, 120.98.

**1. IT IS NEVER SUMMED INTO THE FORECAST TOTAL.** *"9 inches expected"* and
*"3 inches fell"* are different kinds of fact about different windows, and
adding them makes a storm-total nobody published. This is §48.19's own lesson
arriving from the other direction, and a later session WILL be tempted, because
one big number looks more useful than two small ones.

**2. DRY IS A REAL ANSWER AND A FAILED FETCH IS NOT.** Nothing having fallen is
safe to state plainly. The fetch failing means we do not know, and §5 forbids
those two rendering the same. Reuse `RAIN.negligibleMm`'s judgement — a modelled
0.2 mm printed as `0.01 in` reads as a malfunction, said plainly it reads as a
forecast (§48.8).

#### What must be MEASURED before a line of this is written

**==> THE PROBE IS IN THE RUNNER AS OF 2026-08-22, AND FOUR OF THE FIVE FALL
OUT OF IT. <==** A past-days entry in `tools/archive-fetch.mjs` asks the same
point for the same variable as the capture above, with `past_days=2` added and
nothing else changed, **so the two diff cleanly and the delta is the answer:**

```
git fetch origin archive
git show origin/archive:latest/openmeteo-rain-past-days-probe.json
git show origin/archive:latest/openmeteo-rain-outside-nws.json
```
 Question 5 —
the free tier's quota — has no runtime answer and never will: §48.14 records
there is no `x-ratelimit-*` header of any kind, so it comes off Open-Meteo's
documentation or not at all.

**Nothing below can be answered from the sandbox** — `api.open-meteo.com` is
outside the wall (`SPEC-OPS.md` §18). These go to the archive runner, which has
open internet, and the answers get written here before any code:

1. **Does `past_days` return what the docs say, at a point with real rain?** Its
   behaviour, its ceiling and whether the past hours arrive in the same
   `hourly.precipitation` array or a separate one. **Do not assume the array is
   simply longer.**
2. **Where is the join?** Whether the boundary between past and forecast hours is
   marked at all, or has to be found against the clock — and whether the hour
   containing `now` is counted once or twice.
3. **Does it change the response size or the latency enough to matter on a
   phone?** The table above is arithmetic on one archived capture, not a
   measurement of the real call.
4. **What does it report over the ocean and over sparse land?** The forecast half
   covers the planet; nothing has confirmed the past half does.
5. **Does the free tier's quota treat it as one call or as more?** §48.14 records
   that there is **no `x-ratelimit-*` header of any kind**, so this can only be
   answered by asking Open-Meteo's documentation, never at runtime.

#### Open, and Aaron's to settle

- **How long is the window — 24, 48 or 72 hours?** 48 is the number in the
  wording above and it is a placeholder, not a measurement. It wants a real
  storm to judge: too short and it misses the front that soaked the ground, too
  long and it stops being about this weather.
- **Does it render with no storm on screen?** The rows already do — Flooding is
  gated on the house, not the storm (§56.7). Past rain at a calm-day address may
  be genuinely useful or may be clutter on the screen's quietest state.
- **Does the storm drawer get one too?** It has no house (§56.9), so it would
  need the footprint version, which is the GDACS-image work above. **Probably
  not, and probably not in this phase.**

---
