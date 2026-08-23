# NOW.md — what's in flight

> **TRIM/AUDIT TRIGGER: 300 LINES.** Past that, this file gets a full read and a
> cut list before anything else is added. A trigger, not a ceiling — the point is
> a periodic honest audit, never compressing a finding on the day it was made.
>
> **WHY 300 AND NOT §12's 700.** A source file is navigated by jumping to the
> part you need; this one is read front to back at session start. Past roughly
> 300 lines that reading turns into searching, and searching only finds what you
> already knew to look for — exactly backwards for the file whose job is naming
> the things you DIDN'T know about. `THE PLAN`, `IN FLIGHT` and `NEXT UP` stay
> short enough to read at a glance; length accumulates BELOW them.
>
> **THE TRIGGER IS MET AND THE RESIDUE IS STRUCTURAL, SO DO NOT AUDIT BLIND.**
> This file has been cut twice — 510, then 978 down to here. **Both times the
> bulk of it was landed work kept "until the next session reads it once," and
> both times that session never came.** A diagnosis is worth writing down while
> it is hot; it is worth keeping only in the spec, which describes what IS. If
> you find yourself writing "kept for the next session" into this file, write it
> into the spec instead and delete it from here.
>
> What is left is mostly `NEXT UP`, `HELD FOR WEATHER` and `KNOWN AND ACCEPTED`,
> and those grow with the APP rather than with neglect — a bigger app has more
> built-but-unwitnessed surfaces and more settled questions worth not re-asking.
> If it climbs again the lever is structural rather than editorial: move
> `KNOWN AND ACCEPTED` into SPEC.md as a SETTLED section. That has been left
> alone deliberately, because its whole job is stopping a session re-asking a
> closed question and it only does that job if it is read at session start.
>
> **`IN FLIGHT` MEANS WAITING ON AARON AND NOTHING ELSE.** ==> THIS IS THE RULE
> THE 2026-08-19 CUT EXISTED TO RESTORE. <== The heading had silted up with items
> that could not be judged at all, because the weather they needed had not
> happened — sixteen of them against four real ones. That does not just make the
> file long, it makes it LIE: a session reads the heading, tells Aaron he has ten
> minutes of looking to do, and is wrong. Anything gated on a storm goes under
> `HELD FOR WEATHER` with the storm named. If you cannot say what an item is
> waiting for, that is the finding.
>
> **An item leaves in exactly two ways.** It **lands** — deleted here, one or two
> sentences added to the spec describing what *is*, not what happened. Or it
> **dies** — deleted, no tombstone.
>
> **Not a log** (no dates, no completed section — that is `git log`). **Not a
> decision tree** — an item needing several paragraphs is a spec entry wearing a
> TODO's clothes, so write it in the spec and leave a pointer. **Never a place to
> record a rule** — rules go in SPEC.md.

---

## THE PLAN — pick one wave, do it, close it out

**Each wave is sized for ONE session.** Do not start two. When a wave lands,
delete it from here and put what it built in the spec.

**WAVES 5 AND 6 ARE DONE.** What they built is described as-built in the spec —
radar in `SPEC-DATA.md` §4.9. **How to reach the world from a sandbox that
cannot: `SPEC-OPS.md` §18.**

**NO WAVE IS IN PROGRESS. The next session picks one, or picks one of the
items under `NEXT UP`.** Nothing below is half-built.

**Do not reopen the single-source radar question.** §4.9 records what it was
traded for.

---

## IN FLIGHT

**Waiting on Aaron. Nothing here is waiting on weather — that is `HELD FOR
WEATHER` below.**

**==> THE DECISION: MOKE'S FORECAST GEOMETRY IS A DAY OLD AND NHC IS NOT FIXING
IT. <==** Measured on the 14:28Z archive, not inferred. Her cone, forecast track
and forecast points are still **advisory 4, filed 2026-08-21 09:13Z** — nearly
thirty hours and four advisories frozen — while her wind radii, her record and
the feed are all advisory 8 from this morning. Her forecast starts **215 nm**
behind her. Lala, for contrast, runs six hours of skew.

Skew is the ordinary condition (§7.14). This is not: §7.11 re-anchors that
geometry onto her real position, so the app drags a day-old cone 215 nm forward
and presents it as current, with nothing on screen saying otherwise. §7.14
stopped the drawing folding; it did not make the cone honest.

Three ways out:

1. **Keep re-anchoring.** Today's behaviour. Looks right, stays wrong.
2. **Draw it where NHC drew it, stamped a day old.** Honest, and it reads as a
   fault: the forecast line visibly starts 215 nm behind the storm dot. The gap
   IS the information, drawn to scale, but a reader who thinks the app is broken
   stops reading it.
3. **Refuse a forecast this stale** — past track and wind field only, saying
   why. Nothing wrong is drawn; the reader loses the cone on a storm whose
   day-old forecast actually verified to within 20 nm.

**Andy's recommendation is 3, with a threshold well past a normal publish lag**
(≈6 h) so an ordinary wobble never trips it — the only option where nothing on
screen is a claim we cannot back. **Aaron has not decided. Do not build until he
has.**

**BUG 2 — THE COLOUR-NULL ERRORS ARE UNCOUNTED AND THE INSTRUMENT IS POINTED AT
THE WRONG THREAD.** `tools/perf-instrument.mjs` counts them by patching
`console.error` on the MAIN page; they come from MapLibre's WORKER, which has
its own global scope and its own console. **A zero from that instrument is not a
zero.** Fix the instrument before anything else here. The same run also reported
`styleLoaded: false` on all three arms, which its own report calls "map numbers
below are meaningless".

Real findings from it, worth keeping: `blockedMs 26490` against a 1200 budget,
`ourModules 179` against 175, radar arm `loadMs 109802`.

**SAUDEL LOST ITS SAFFIR-SIMPSON GRADING ON TWO DEVICES AND KEPT IT ON A THIRD.**
Nine pink `HU` pills on the phone and work PC #1; work PC #2, minutes later, drew
graded dots. Hard-close changed nothing on the bad two.

**Everything server-side was proven healthy on real bytes and is NOT the cause** —
JTWC issuing on schedule, the relay parser returning an 80 kt fix and a nine-step
ladder off the archived `wp1726web.txt`, `matchStormByName` resolving, both join
guards passing at 0 NM separation. **The break is on the device.**

**The remaining candidate is a per-PoP cache.** A Cloudflare datacentre serving a
`last-good` copy older than `JTWC_WIND.maxFixAge` (12 h) fails every storm
`fix_too_old`, silently, and falls back to the class midpoint — which looks
exactly like this. **WAITING ON AARON:** open `/api/jtwc/storms` on a device that
shows the bug and read `fetchedAt` and the fix `at`. Nothing in the sandbox can
reach the live app. Do not write a fix before that.

**`data/surge.js` CALLS `/api/nhc/surge` AND THAT ROUTE DOES NOT EXIST.**
`functions/api/nhc/` has no `surge.js`. Every NHC surge request is a 404 today,
and `lib/surge-locations.js` already says so in a comment. Building it needs a
real storm with surge data to verify against — see `HELD FOR WEATHER`.

**THREE GLASS CALLS ON RADAR, AND ALL THREE WORK ON `?replay=ida` — NO WEATHER
NEEDED.** Radar does not route through `ENDPOINT.relay`, so the replay draws
today's live radar over Ida's 2021 position: real US radar, right ground, wrong
storm, which is all these need.

1. **Is it sharp now?** It shipped as a per-storm disc and Aaron's verdict was
   that it looked like ass. He was right and the cause was structural — 8.5 km/px
   at the widest radius against RainViewer's own 1.2. It is a MapLibre raster
   tile layer now, the same mechanism as the basemap, so compare `?replay=ida`
   against RainViewer's own map at the same zoom: they should be
   indistinguishable on detail.
2. **Is the clip tight enough, or too tight?** Radar is fetched only within 8° of
   live storms, above zoom 3. The bound itself is not negotiable — unbounded
   tiles made MapLibre request the whole world pyramid and Cloudflare 429'd the
   origin, taking satellite down with it (§4.9). What is open is the padding: 8°
   is ~880 km, meant to reach past the rainbands. If radar stops short of weather
   you want, that constant is the dial.
3. **The palette.** "Universal Blue" is the only scheme offered; sampled off real
   weather it runs cyan → blue → orange → red → magenta. Two collisions to look
   for: heavy-rain magenta against the Saffir-Simpson cat-4 dot, and light-rain
   cyan against the coastline glow. The terms permit recolouring.

**MOKE'S CAP AND HER WIND BANDS HAVE NOT BEEN SEEN.** Both fixes are deployed and
both were measured on Moke's own bytes, because Lala cannot reproduce either
(`samples/moke-cp032026/`). Lala has been confirmed on glass and is the no-op
control for both — she should look unchanged.

- **The tail cap** (`SPEC-MAP.md` §7.9, `tools/test-cone-cap.mjs`). Her cone
  should end in a small rounded cap AT the storm, not a lobe hanging east and
  south of it, and the environment ribbon should stop there too.
- **The wind-band centres** (§7.13, `tools/test-windswath-centre.mjs`). Her
  orange 50 kt band moved about 140 miles west; every band should start ON her
  and run the full forecast.

**TWO CONSOLE LINES ARE FINDINGS, NOT NOISE, IF THEY APPEAR.**

- `"the past track has most likely overtaken a stale forecast"` — it fired on
  every NHC storm before §7.11 and should now be silent. If it returns, the
  re-anchor bailed on a guard and the console names which.
- `"a band still crosses itself after 8 loop cuts"` (§7.12) — a shape nobody has
  measured. The band is drawn anyway rather than dropped.


## NEXT UP

**==> §48.21 SHIPPED BROKEN AND THE FIX IS PUSHED. THREE BUGS, ONE PUSH, AND
NONE OF THEM WAS CAUGHT BY ANY EXISTING GATE. <==** Aaron's report was *"no
layer toggle, nothing different, and the environment ribbon no longer works"* —
which was one cause and three faults.

1. **`main.js` wrote to `layerStatus`, which lives in `app/views.js` and has
   never been in main.js's scope.** A ReferenceError inside `applyLayerState()`,
   on the DEFAULT path — the else-branch clearing the row runs whenever the
   toggle is off, which is always. Everything after it died: the genesis glyphs
   in the 3D globe, every exclusive pair, the imagery mode, and — in the
   `subscribeLayers` callback — the Environment ribbon's warm and both pipeline
   repushes. **The ribbon was the symptom; a layer nobody had switched on was
   the cause.** Now routed through `views.setFloodSlot`, the shape
   `setImageryStatus` beside it already used.
2. **The toggle was never added to `SHIPPED_EARLY`,** so `isLive` saw
   `phase: 9` against `SHIPPED_THROUGH: 4` and presented the control as
   not-built-yet. The manifest entry, engine key and layer file were all
   correct. **Adding a layer past the numbered phases is TWO edits and this is
   the second one.**
3. **`floodLineWidth` went into `STORM_GEO` and the layer read it from `Z`.**
   MapLibre rejected the whole line layer at `addLayer` with *number expected,
   undefined found*, so the polygons never drew. Found by the new gate below,
   not by a human.

**`tools/boot-smoke.mjs` IS NEW AND IT IS THE GATE THAT WAS MISSING.** It boots
the app in chromium, fails on any uncaught exception, and flips every toggle
both ways. Verified against all three bugs above — each one turns it red with
the exact error text. In the pre-push hook and in CI.

**==> ITS FIRST VERSION PASSED WITH BUG 1 REINTRODUCED, WHICH IS THE FAILURE
§12 CALLS WORSE THAN NO TEST. <==** It listened on `pageerror` and
`console.error`. `data/layer-prefs.js` `emit()` wraps every subscriber in a
try/catch ON PURPOSE so one bad listener cannot stop the others — the right
call, and the reason a dead `applyLayerState` did not take the page down. The
only trace was a **`console.warn`** reading `[landfall] layer-prefs subscriber
failed`. **A swallowed exception is now a failure in that file.** If another
catch-and-warn site is added anywhere, add its marker to `SWALLOWED` or this
gate goes blind to it.

**STILL UNSEEN ON GLASS: everything §48.21 actually draws.** The layer has never
been looked at. See the flood entry below.


**==> §48.21 IS BEING REPLACED WHOLE. PHASES 1, 2, 3 AND 4 OF SIX ARE IN. DO
NOT TUNE THE REST, DO NOT LOOK AT IT ON GLASS. <==** Plan agreed with Aaron
2026-08-22: `SPEC-FLOOD-PLAN.md` §56, one phase per session, in order. Read that
file before touching anything flood-shaped.

**==> PHASE 5 WAS BUILT, PUSHED, PATCHED TWICE AND REVERTED WHOLE ON 2026-08-23.
IT WORKED AND IT WAS SLOW. <==** Tapping a storm on the globe and stepping
between storms in either drawer all dragged; the revert (`0882353`) cleared it,
so the cause is settled. **Before rebuilding it, read `SPEC-FLOOD-PLAN.md`
§56.15 (what went wrong and the findings worth keeping), §56.16 (the three
slices and the baseline that must exist first) and §56.17 (the prerequisite).**

The short version, because it is the kind of mistake that repeats:

- **Every perf number behind that push was headless `node` in this sandbox.** It
  cannot open a browser, so it could not see the costs that were actually felt.
  **A sandbox measurement is evidence about the sandbox and never about the
  app.** Perf claims come off the CI runner or off Aaron's phone.
- **The layer engine calls `update()` on EVERY definition on EVERY
  `setBundle`**, visible or not. Work put there is paid by every reader on every
  selection for a layer that may be switched off. Gate it, and make `setVisible`
  push on turn-on.
- **It went out as one 2,523-line commit**, so when it was slow there was
  nothing to bisect and the session guessed twice instead of knowing once.
- **When the measurement and the glass disagree, the glass is right and the
  session stops.** That disagreement happened after the first patch and was
  ignored.

**==> THE PREREQUISITE IS DONE AND IT CAME WITH A FINDING THAT NEARLY REPEATED
THE WHOLE MISTAKE. <==** Shipped 2026-08-23, `SPEC-FLOOD-PLAN.md` §56.18 and
§56.17, as-built in `SPEC-UI.md` §48.21.

Letting the `Flooding` section fetch — the plan's own recommendation — would have
put the corridor match on every storm open for every reader. **That match cost
800 ms of pure arithmetic for one US storm**, measured in `node`, which is faster
than a phone. Building the prerequisite as written would have recreated the
Phase 5 lag in a new place wearing the plan's blessing.

Two causes, neither of which was the number of alerts: **the only prefilter was
latitude**, and Hawaii shares latitudes with the Gulf, so a Hawaii zone against
an Atlantic storm was rejected by nothing; and **NWS draws zone outlines at 65
metres per point** against a 300 nm corridor. Now: a bounding-box lower bound,
a thinned outline at 1 nm, and the full outline only where a shape sits close
enough to the corridor edge to change the verdict.

| list | before | after |
| --- | --- | --- |
| 33 real warning polygons | 4.6 ms | 3.0 ms |
| + 23 watch zones far away | 800 ms | 2.4 ms |
| + 23 watch zones on the track | 235 ms | 15 ms |

**The verdict is exact at every radius; only the reported distance moves, by at
most 1 nm, and only upward.**

**==> AND ITS GUARDING TEST PASSED WITH A DELIBERATE 2% INFLATION IN THE BOUND.
<==** That is the mutation that silently drops live flood warnings off a storm.
`tools/test-flood-fast.mjs` was testing the CONSEQUENCE through a probe grid too
coarse to land in the band where the bug bites. `boxLowerNm` is exported now and
the inequality is asserted head-on, with a second assertion whose only job is to
prove the first has teeth. Both mutants verified red, then green.

**WHAT WAS DELIBERATELY NOT BUILT: the per-storm memo the plan called for.** A
repaint costs 3 ms on a real list, 15 ms worst case. The memo would buy
milliseconds against an expiry-invalidation problem on a hazard surface. If the
phone disagrees it is a small addition — §56.18 says where to start.

**`lib/flood.js` CROSSED §12's CEILING AND WAS CUT.** The measurement is
`lib/shape-distance.js` now: it answers *how near does this shape come to this
track* and knows nothing about floods. Flood imports distance; distance imports
nothing of flood's.

**GLASS, AND IT IS THE ONLY GATE THAT COUNTS.** Open a storm with the
`Flood alerts` switch OFF — the default. `Flooding` should now show a real answer
instead of *Checking flood alerts…* forever. Then tap four storms in a row on the
globe and step through them on the home dashboard: **that is the motion that
exposed the first attempt.** Nothing in the sandbox can measure it —
`perf-select` needs the basemap and the tile host is outside the wall, verified
this session.

**SLICE A IS NEXT AND WAS DELIBERATELY NOT STARTED.** §56.16's three slices are
unchanged. Do not start it before the above has been felt on a phone.

**THE TOOLS FOR THE RETRY ARE IN, AND ONE OF THEM NEEDS A HUMAN BEFORE IT IS
WORTH ANYTHING.** Added 2026-08-23:

- **`tools/perf-select.mjs`** — the interaction measurement this repo never had.
  Drives `?replay=ida` (samples off disk, so the storm is identical every run),
  taps a storm row six times, discards the first, and reports the **worst single
  main-thread block** per selection. Runs in CI's `browser` job.
- **`tools/perf-budgets.json`** — ships with every value `null`, because a
  budget nobody measured is a number somebody invented.
- **The colour-null counter no longer lies.** `colorNullsMainThread` with
  `workerConsoleWatched: false` beside it, and the report prints the blind spot
  every run. Reaching the worker's console is a CDP attach and its own change;
  what is fixed is that a 0 can no longer read as "none happened".

**AND ITS FIRST CI RUN FAILED IMMEDIATELY, WHICH IS THE SYSTEM WORKING.** Run
#361: `SyntaxError: Unexpected identifier 'colorNulls'`. The browser-side probe
in `perf-instrument.mjs` is built as a TEMPLATE LITERAL, and a comment added
inside it contained backticks, which closed the string early. **The file was a
syntax error and every gate in this repo passed it** — because `tools` is in
`SKIP_DIRS` in `check-syntax.mjs`, so nothing in that directory had ever been
parsed at all.

`check-syntax.mjs` now parses every `tools/*.mjs` as a second, PARSE-ONLY pass
(no import resolution — these files legitimately import playwright, which is not
in this repo). 142 tools, milliseconds, and the mutation was verified: put the
backtick back and it goes red. **The pre-push hook runs check-syntax, so this
class of bug cannot reach a runner again.**

**==> IT IS NON-BLOCKING AND UNARMED, AND SOMEBODY HAS TO WATCH IT RUN. <==**
`continue-on-error: true`, budgets `null`. It was written in a sandbox that
cannot execute it, and this repo's rule is that **a check nobody has seen pass
does not get to block a deploy**. **NEXT ACTION: watch `perf-select` print
stable numbers over a few CI runs, fill the budgets, paste the baseline line it
prints into this file, then drop `continue-on-error`.** Until then there is
still no baseline — only a tool that can take one.

**PHASE 1 — THE CORRIDOR — SHIPPED 2026-08-22.** The match is no longer an
overlap with the forecast cone; it is a great-circle distance from the storm's
whole densified track, past and forecast, under `RAIN.floodCorridorNm`. As-built
in `SPEC-UI.md` §48.21. The three bounding-box functions that used to do the
matching are gone, and the antimeridian problem is gone with them — a
great-circle distance has no seam.

**PHASE 2 — THE FLOODING SECTION — SHIPPED 2026-08-22.** One section on both
screens: alert rows on top, the modelled coastal figure as prose below. The
`Coastal flooding` section is deleted and its spec entry with it; the flood rows
are out of both Rain sections; the national agencies' storm-surge rows moved
across; `Watches and warnings` gained one line pointing here. As-built in
`SPEC-UI.md` §56.7, §56.8 and §56.10.

**==> THE RADIUS IS 300 nm, IT IS A GUESS, AND IT IS AARON'S TO MOVE. <==**
Nothing in the sandbox can measure it. Do not write a derivation for it and do
not let a later session quietly convince itself the number was measured.

**HELD FOR WEATHER: nothing from Phase 1 or Phase 2 has been seen, and none of
it can be.** Every assertion is offline against real bytes — 25 of the 33
archived US alerts match Ida's real advisory-19 track at 300 nm, Lala matches
none of them at 1,966 nm, and `tools/test-flooding.mjs` renders all six of
Phase 2's states — but not one pixel has been judged. It needs a US storm near a
flooding region. Expect this line to stay here after every flood phase.

**Two live gaps §56 names.** The national volume is one snapshot on a quiet day
(36 alerts at 2026-08-22T22:29:35Z, now frozen at
`samples/flood/alerts-national.json`). Re-read
`git show origin/archive:latest/relay-nws-flood.json` before tuning anything that
depends on the count — clustering thresholds in Phase 5 most of all. And
`map/layers/flood.js` still draws the whole country from a `Storm detail`
toggle; Phase 5 replaces it. Nothing about that layer is worth tuning.

**PHASE 3 — HOME GATING — SHIPPED 2026-08-22.** The house is off the storm
drawer entirely, and the home dashboard's `Rain` and `Flooding` render only when
the storm on screen is measured to reach the house — or when there is no storm
on screen at all. One radius now means *near this storm* everywhere in the app.
As-built in `SPEC-UI.md` §56.9.

**IT WAS NOT SELF-CONTAINED, AND THE COST WAS DELETION.** Taking the house out
of the storm drawer orphaned six exports and one constant reaching from `ui/`
through `lib/` into `data/` and `config/` — both scope predicates, the
three-word wind-field verdict, its composition in `app/views.js`, the
range-to-home helper, the house-fallback distance, and a CSS rule. Retiring them
cleanly was most of the diff, and three §48 sections went with them. Aaron
approved the full chain rather than a half-removal.

**AND ONE HALF OF §56.9 DID NOT EXIST TO BE GATED.** The plan said the sections
render *when there is no storm on screen at all*; the audit found both were
built only on the dashboard path, which needs a threat storm — so a genuinely
calm day showed neither. Building the gate alone would have shipped a change
that only ever subtracted. Both halves are in.

**PHASE 4 — ZONE SHAPES FOR WATCHES — SHIPPED 2026-08-23.** A Flood Watch
carries no shape, so it could be neither drawn nor matched. Its zones are
resolved now through a new route and joined onto the alert list in `data/flood.js`,
and a watch measured **23.0 nm** from Lala's real track matches where before it
was held back entirely. As-built in `SPEC-UI.md` §48.21; what was measured stays
in `SPEC-FLOOD-PLAN.md` §56.4.

**==> THE BULK PROBE ANSWERED, AND IT ANSWERED WITHOUT SHAPES. <==** This was
the open question that could have deleted the phase's cost argument. Asked for
the first time: `GET /zones?type=forecast&id=…` returns 200 with all 23 zones in
one request, 30,172 bytes — and `geometry: null` on every feature. The id list
works; the boundaries do not come with it. So the per-zone loop shipped: 23
zones, 23 requests, held thirty days at the edge on NWS's own `max-age`.

**==> ONE PARAMETER IS STILL UNTESTED AND IT WOULD TURN 40 REQUESTS INTO 1. <==**
NWS documents `include_geometry` on that endpoint and this project has never
sent it. The probe is in the runner as of this push. **Read
`geometry/nws-zones-bulk-probe-geometry.geojson` off `archive` before touching
`functions/api/nws/zone.js`** — if it carries the boundaries, that route should
ask once instead of forty times.

**WHAT THE ZONE BYTES SAID, since nobody had ever read one.** Both `Polygon` and
`MultiPolygon` are real (islands make the difference). 23 zones are 1.63 MB as
served and only 22% of that is geometry — NWS pretty-prints and ships an
observation-station list — which is why the route projects to `name`, `state`
and the shape. Coordinates are rounded to four places, about 11 m: **a rounding,
not a simplification**, every vertex still travels.

**==> THE SILENT CASE IS GONE AND THE HONEST ONE REPLACED IT. <==** The drawer's
clause *"issued by zone and has no shape to draw"* counted `total - drawable`,
which is always zero — nothing shapeless reaches the match — so it had never
printed once. `unplaceable` does that job now and CAN be non-zero: a watch whose
boundaries did not come back is counted, and on `none_matched` the all-clear is
withheld rather than printed over it.

**HELD FOR WEATHER, AND THE SHAPES ARE THE LEAST-SEEN THING IN THE APP.** A
resolved watch draws whole forecast zones — a Hawaii zone is 0.7° tall against a
median warning polygon 0.270° wide. **Whether a warning still reads as more
urgent than a watch fifty times its area is a glass call nobody has made**, and
Phase 5 owns the map that has to make it.

**ONE THING FIXED IN PASSING** because this change depends on the file it was
wrong in: `functions/api/nws/flood.js` named the mirror checker without its
`test-` prefix. It is `tools/test-relay-mirrors.mjs` and that comment now says
so. **Still open and still Aaron's call:** `tools/test-home-ida.mjs` fails one
assertion — a rail label crossed by a dotted vertical at adv 010 +6h and +7h,
**confirmed pre-existing on clean `main`** and not flood-related.


**AND THERE IS A PHASE 6 NOW — PAST RAINFALL, added 2026-08-22 after Phase 2
shipped.** `SPEC-FLOOD-PLAN.md` §56.14. How much has already fallen at the
reader's address, from `past_days` on the Open-Meteo route this app already
relays, in the `Flooding` section rather than in Rain. **It is the only global
flood-relevant number this project has found** — §48.15 records that no global
equivalent of NWS's alert feed exists, so the coverage gap §56.7 documents is
permanent for ALERTS and this is what can honestly sit beside it.

**==> IT IS BLOCKED ON A RUNNER PROBE AND NOTHING ELSE. <==** Five questions in
§56.14 that the sandbox cannot answer — `api.open-meteo.com` is outside the wall.
Nobody writes a line of it until those are measured and written into that
section. It depends only on Phase 2, so it CAN move ahead of 3, 4 or 5; if it
does, say so out loud rather than quietly swapping them. **Phase 2
already emptied the warnings-only tier and closed its fetch gate** — that
was this change's own cost, not a head start: leaving the tier would have shown
the same alert in two sections of one panel.

**==> ONE THING PHASE 2 TRADED AWAY, AND IT IS A GLASS CALL. <==** §48.6's rule
is that a warning in force renders ABOVE any forecast. The section order is Rain
then Flooding, so on both screens the warning is now one section BELOW the
rainfall total. Inside the section the rows still lead. What was bought is a
heading of its own instead of a footnote on a section about something else; what
was sold is roughly one section's scroll height on a phone. **If it reads wrong,
the fix is one line in `dashboardHtml` and one in `renderBody`.**

**GLASS: THE RAINFALL PASS. NONE OF IT HAS BEEN SEEN.**
§48.19 and §56.9 are as-built in `SPEC-UI.md`; this is only what to look at.

1. **The house block is GONE from the storm drawer, on every storm** (§56.9).
   Open any storm: `Rainfall` should now be NHC's paragraph and nothing else,
   and on a GDACS storm one sentence saying it is not published for that basin.
   **The thing to check is that nothing looks amputated** — a section that was
   two blocks for a month is one now, and whether it reads as focused or as
   half-loaded is a glass call.
2. **The totals dropped and that is the fix, not a fault.** "About 11 inches"
   became "about 9" on the Hilo fixture because two blocks totalling 63.754 mm
   had already fallen when it was read. On the global source it is larger: 23%
   of today's Manila capture was already on the ground. If a figure looks
   smaller than you remember, that is why.
3. **Flood warnings lost the box and the colours** — no fill, no red, no amber,
   no bold. The urgency moved into the sentence: *in force until 4:15 PM*
   against *until 6:00 AM*. **The question is whether an immediate warning
   still reads as more urgent than a watch with the ink gone.** If it does not,
   the fallback is a weight change rather than the old fill coming back.
4. **A new `lapsed` state.** A forecast whose every hour has passed says it has
   run out and offers Retry, rather than "no meaningful rain expected". Only
   reachable on a genuinely old last-good copy, so it may not be seeable.

5. **On HOME, `Rain` and `Flooding` now come and go with the stepper** (§56.9).
   Step through storms on the home dashboard: both sections should be there for
   a storm whose track passes within 300 nm of your house and **absent
   entirely** for one that does not — no heading, no explanation, nothing.
   **This is the one most likely to read as a bug rather than a rule.** A
   section vanishing as you press a chevron is a strong signal; whether it reads
   as *this storm has nothing to do with your house* or as *the app lost
   something* is exactly the call nothing here can make. The fallback if it
   reads wrong is a one-line placeholder saying why, which the gate deliberately
   does not draw today.
6. **And with NO storm on screen they should BOTH be there** — on a calm day,
   and on a day a source is down. That half did not exist before this phase; a
   quiet home screen showed neither. Check it with the globe empty.
7. **The warning rows carry their affected area and how long is left.** *Hawaii
   in Hawaii, HI* under the name, *52 min left* under that. **The watch's area
   is seventeen zones and is printed whole on purpose** — the reader is hunting
   for their own zone and truncating hides it. On a phone that is a real block
   of text, and whether it reads as thorough or as a wall is a glass call. They
   are in `Flooding` now, not in Rain.

8. **The `Flooding` section itself, on a calm day with a home set.** It renders
   with no storm on screen — that is the point of gating it on the house rather
   than the storm — and on a quiet day it says *no flood alerts are in force for
   your address* and nothing else. **Is that a useful line or a section of
   nothing?** It exists because a section headed *Flooding* with a blank body
   cannot be told from one that failed to load, but whether that reads as
   reassurance or as clutter is glass. Also: three stacked waves beside the
   heading, and whether they read as *water where it should not be* rather than
   as surf.


**THE MAP STILL TELLS THE LIE THE HEADCOUNT JUST STOPPED TELLING.** §54 split
the Population affected count into what is still coming and what has already
been through, and Lala's panel now reads past tense correctly — confirmed on
glass 2026-08-21. **The drawn swath did not change.** It is a record where it is
behind the storm and a forecast where it is ahead, painted in one shade, so a
green wash still sitting over Honolulu reads as a warning days after the wind
stopped. The forward-only geometry the fix needed already exists in every NHC
bundle as the `windAhead` slot, so the data side of this is done — what is left
is a styling call about how "already happened" should look next to "still to
come", and that is Aaron's to make on glass. Logged as OPEN in §54.

**"IT WENT THROUGH ON SUNDAY" IS AVAILABLE AND NOT BUILT.** The split says
*whether* a storm has passed, not *when*. The past track carries timestamps, so
the date is there for the taking. Deferred deliberately on 2026-08-21: the
useful half is the tense, and a date is a second thing to get wrong. Logged as
OPEN in §54.

**`no_ribs` IS TWO DIFFERENT FAILURES WEARING ONE SENTENCE, AND IT COST A
SESSION.** `lib/cone-ribbon.js` returns `no_ribs` both when the cone could not
be measured AND when `hoursAlong` cannot line the run up against the ribs —
different files, different fixes. `app/layer-status.js` says *"This cone could
not be measured"* for both. On 2026-08-20 that sentence was the only evidence
available from a phone, and it pointed at one of two files with no way to tell
which; the bug was found by pulling Lala's bytes off the archive instead.
**Split the reason and give the second one its own words.** Small, and the next
seam-shaped bug is unreadable without it.

**THE PHILIPPINE ALERT IS NOT MISSING — IT IS ABOUT SOMETHING WE DO NOT
HAVE.** Asked and answered, so nobody re-derives it. PAGASA's row reads
`Tropical Cyclone Alert : Neneng`, area `Philippine Area of Responsibility`.
Saudel is at 12.8N 150.2E — roughly 900 nm EAST of the PAR's 135E edge and
tracking away toward Japan. Showing that row under Saudel would be the causal
claim §50.5 forbids. `Neneng` is a PAGASA local name, and PAGASA declares
systems JTWC has not warned on, so the likely explanation is that **PAGASA is
warning about a system this app holds as neither a storm nor a watched area.**
==> THAT LAST SENTENCE IS AN INFERENCE, NOT A MEASUREMENT. <== No published
crosswalk maps a PAGASA local name to a JTWC invest number, and nothing here
has verified it.

**GLASS: TWO VITALS ROWS ON AN NHC STORM.** Open Lala (or any Atlantic/Pacific
storm) and look at Vitals. Two things are new and neither has been seen.

**1. A `Gusts` row now appears on NHC storms.** It arrives a moment AFTER the
panel paints, because it comes out of a second NHC product fetched on open —
the storm list carries no gust and the public advisory says only "with higher
gusts". The question is whether that late arrival reads as the panel filling
in or as the panel twitching. The rest of the section is already settled by
then, so it should be one row appearing under Winds and nothing moving above
it. **If the shift is annoying, the fallback is not showing gusts on NHC at
all** rather than shipping a jumpy panel — that is a real option, say so.

**2. `Forecast by` now appears on NHC storms**, and on a Central Pacific storm
it says **Central Pacific Hurricane Center**, not National Hurricane Center.
Lala is CP1, so it is the storm to check it on. Does naming the Honolulu desk
read as useful precision or as a confusing second agency? A GDACS storm's row
says `JTWC · via GDACS` — the two should read as the same kind of fact.

*(Also worth a glance while there: a GDACS storm JTWC has a warning on should
still show its own `Gusts` from the JTWC fix, unchanged.)*

**0-PERF. THE BOOT PATH HAS BEEN MEASURED AND THE FINDINGS ARE IN
`PERF-AUDIT.md`.** Read that file, not this entry — it carries the numbers, the
citations and a ranked plan in three tiers. The one-line version: **a returning
visitor revalidates all 167 application modules over the network on every load**,
because `sw.js:72` treats only `/vendor/` as immutable and everything else goes
through `networkFirst` with `cache: 'no-cache'`. Measured at 1,899 ms of queue
against a 1,960 ms staircase, and **1,991 of 2,036 D1 sessions are
service-worker controlled**, so it is the product rather than an edge case.

**PRESSURE-TESTED AND CORRECTED 2026-08-19.** A second session re-verified every
citation and re-derived every module number in the sandbox, and found five items
wrong. The two that matter: **Tier 1's "delete the dead data/surge.js import"
would have shipped a ReferenceError on every load** — `fixtureAdvisory()` is
called synchronously at `main.js:651` and `:1051`, so the module is inert, not
dead. And **the dynamic-import savings were inflated**: the eight-module item is
worth 3 modules / 36 KB once the unsafe ones are removed, while the seven drawer
views are worth 33 modules / 656 KB. The plan is now grouped into pushes with a
verification route tagged on every item.

**§7 — version-gating the service worker — IS NO LONGER THE FIRST MOVE.** Its
payoff has never been measured, and the arithmetic behind it (171 × 11.17 ms) is
equally consistent with the gap being browser dispatch, which a version gate does
not remove. **`tools/perf-audit.mjs:149` already records `workerStart` per
resource**, and `/vendor/` is already cache-first in the shipping build, so the
deployed app contains its own control group. One workflow run settles it with no
code change. Do not start §7 before reading that JSON.

**`perf-history` HOLDS ONE FILE AND NOTHING HAS BEEN RUN SINCE.** **Actions →
perf-audit → Run workflow** is the first thing to do here; it costs four
minutes and the sandbox cannot dispatch it. Expect red — `colorNulls` is
budgeted at 0, and until Bug 2's instrument is fixed (`IN FLIGHT`) that number
is measuring the wrong thread anyway. The JSON is written before the failure.

**Tiers 1 and 2 need nothing and nobody** — all doable from the sandbox with no
internet. `functions/api/nhc/advisory.js:95` is still `FRESH_SECONDS = 5 * 60`
against a 5-minute cron, which is the DOLPHIN-26 collision §4.13 bans in capitals
— and the review confirmed it is the ONLY such collision among warmed routes.

**Two things are still UNMEASURED** and `tools/perf-audit.mjs` measures one of
them on the Actions runner: radar's request volume (item 0b below, still a
prediction). **It does NOT measure the colour-null count** — item 0d — however
green the budget line looks; the instrument is pointed at the wrong thread. The
budget's `colorNulls: 0` reads as a pass on nothing. **`node tools/load-probe.mjs`
and `boot-profile.mjs` both build their browser with `serviceWorkers: 'block'`** —
every module number this repo held before today was taken on a path 98% of
sessions are not on.


**0. RADAR CAN NOW REPORT A TRUE FRAME TIME; THE ROW SAYS NOTHING ABOUT AGE AT
ALL.** `/api/imagery/radar-frames` already returns the frame's `time`, in
SECONDS, and `map/radar-layer.js` throws it away. Every vendor before this one
sent no time — that is what `IMAGERY_SENDS_NO_TIME` is about, and why the
satellite row honestly says "Downloaded" rather than claiming to know when the
picture was taken. Radar is the first source that can say the real thing, and
the tile split made it easier rather than harder: the two rows are now built in
different files, so giving radar its own wording no longer changes satellite's.
Small, and worth doing.

**0b. RADAR'S REQUEST VOLUME HAS NEVER BEEN WATCHED.** One image per storm became
roughly thirty tiles per viewport. Each is small, immutable and cached two days
by the browser and shared at our edge, so the expectation is that a session is
LIGHTER than it was — but that is a prediction, not a measurement, and
RainViewer's terms say plainly that they block abusive IPs. The archive runner
has open internet and could sample it.

**0c. THE SURGE COAST DIM HAS NEVER WORKED, AND ITS TEST IS GREEN.**
`dimCoast` in `map/layers/surge.js` reads `line-opacity` off `coast-glow` and
`coast-core` and wraps it as `['*', original, OPACITY.surgeCoastDim]`. That
opacity is a zoom interpolate, and MapLibre forbids a zoom expression anywhere
except the top level of a `step` or `interpolate` — so `setPaintProperty` throws
on every call and the coast never dims. Visible in the console at every boot.
**The fix is to scale the interpolate's OUTPUT stops rather than wrap the whole
expression.** ==> AND `tools/test-surge.mjs` PASSES AGAINST THIS. <== It drives
`dimCoast` with a stub map that does not validate expressions, so the suite has
been green over a feature that has never once run. The test is half the fix, and
it is the half worth doing first: make it fail, then make it pass.

**0d. SOMETHING RESOLVES A COLOUR TO `null`, DOZENS OF TIMES PER LOAD.**
`Could not parse color from value 'null'` out of MapLibre's expression
evaluator, on every boot — about fifteen times, counted off Aaron's console on
2026-08-21. **Which property is NOT known.**

**WHAT HAS NOW BEEN RULED OUT, so nobody re-walks it.** All twelve
`['get', <colour>]` paint properties in `map/` were traced to their feature
producers on 2026-08-21 and every one has a real fallback: `wind-field` skips
the feature when `windColor` returns nothing, `watch-warning` and `cap-coast`
both fall back to `CATEGORY_COLOR.GENERIC`, `model-tracks` and `genesis` always
resolve (their tables are total and `P.ocean` exists in both palettes),
`points-forecast` bottoms out at `PREGENESIS_COLOR`. `tools/test-theme-state.mjs`
passes at 605 assertions, and a scan for the rule-1b killer — a `global-state`
reference sharing an expression with a feature read — found nothing inline.

**THE REMAINING SIGNAL IS WHERE IT FIRES.** All but one line comes from the
MapLibre WORKER blob, not from `maplibre-gl-5.6.0.js` on the main thread, which
points at the basemap style rather than at our storm layers.

**==> THE AUDIT HAS NOW RUN, IT REPORTED `colorNulls: 0`, AND THAT NUMBER IS
WORTHLESS. <==** 2026-08-21. `tools/perf-instrument.mjs` counts these by patching
`console.error` on the MAIN PAGE via `addInitScript`. A dedicated worker has its
own global scope and its own console, so the ~14 of 15 lines that come from the
worker blob were never in range of the instrument. It measured the one thread
the bug is not on and returned a clean bill. All three arms ALSO reported
`styleLoaded: false`, which the audit's own report calls "map numbers below are
meaningless" — the budget passed them anyway until this pass.

**SO THE NEXT MOVE IS THE INSTRUMENT, NOT THE STYLE.** Get worker consoles into
the count — or fail the metric honestly as unmeasurable — before reading another
zero off it. The cost of the bug is still unknown: it may be drawing nothing
where something belongs, or falling through to a default that happens to look
right. Do not assume the second.

**0e. THE ELEVEN REPEATS.** The seam warning fired eleven times in one load,
which is `smoothTracks` re-running per push rather than per fetch — a cost
question, nothing to do with the folds §7.4/§7.11/§7.14 fixed. Those are gone,
so the count is no longer observable from that warning; measure it off the join
warning instead, which fires from the same place.

**1. THREE.JS ON THE BOOT PATH IS AIMED AT THE WRONG PLATFORM.** `SPEC-NEXT.md`
§52 has the per-platform boot table. Short version: Windows trails an iPhone by
765 ms, but 462 of that is gone before our JavaScript runs and our own stage is
14 ms FASTER on Windows than on iPhone. Moving Three.js off boot would help
Android more and wins a slice of 317 ms at best. Not worth the restructuring
unless something new turns up. *Also dead, do not reopen without new data:* the
OpenFreeMap CDN is not the bottleneck, and modulepreload was measured and
rejected (`SPEC.md` SETTLED).

**2. WHAT A MAPLIBRE FRAME COSTS — UNMEASURED, AND THE GATE ON ITEM 1.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint. The free half is already gone; the
remaining repaint cannot simply be skipped, because `setCenter` is what
`map/globe-follow.js` mirrors to make the rotation visible. The four rules a fix
must follow are in `SPEC-MAP.md` §9.7. Needs a real device with a real basemap.

**3. THE GDACS SPINNER LARGELY FIXED ITSELF; THE RETRY BUTTON IS THE OPEN
QUESTION.** Over 14 days GDACS reached `ok` on 1,591 of 1,713 loads, 90 said
`unavailable`, and **32 ended still loading — about 2%, down from 11%**. NHC is
1,700 `ok` against 18 `unavailable`. **What did not move: Retry has been pressed
zero times across 1,711 sessions in 30 days**, including the 108 visits shown a
real `unavailable` state with a real button on it. Either the outage clears before
anyone reacts, or the button does not read as a thing to press. **A glass
question:** open the app with the network off and look at what that screen invites
you to do. `retry_which` now names which button a press was.

**4. GERMAN THUNDERSTORMS ARE IN THE TROPICAL-CYCLONE ALERT FEED.**
`functions/api/cap/alerts.js`, `SPEC-DATA.md` §50.12. The Esri query asks for
`event LIKE '%Hurricane%'` and DWD issues "severe thunderstorms with
hurricane-force gusts" — so four of the five alerts in force worldwide were German
thunderstorms against one real PAGASA alert. The country match keeps them out of
any storm's panel, exactly as the route's Yukon note predicts, **so nothing wrong
reaches that section.** What it does reach is §50.12's gap sentence, which fires
whenever an unattributed storm coexists with any alert anywhere — so German
weather alone can trigger "this is a gap in what we know, not an all-clear" on a
day with no cyclone alerts on Earth. Decide whether the gap sentence should count
only alerts that could plausibly be a cyclone, or whether `%Hurricane%` needs a
companion exclusion.

**A BUSY INDIAN OCEAN BULLETIN — not a glass call, a fixture swap.**
`SPEC-DATA.md` §45.3. ABIO ships and is live; both bulletins are read and the
watch list now has no ocean-sized hole in it. But JTWC reissues ABIO once a
day and every snapshot ever captured reads `SUMMARY: NONE.` all the way down,
so `samples/genesis/jtwc-abio-busy.txt` is ASSEMBLED — a real Pacific
disturbance body transplanted into the real ABIO skeleton. It proves the
template parses; it cannot prove JTWC words an Indian Ocean disturbance the
same way.

**That gap is guarded, not ignored.** `GENESIS.ABPW.noneAssertion` makes a
disturbance block that neither says NONE nor lists numbered items fail the
whole bulletin as `unavailable`. A wording we cannot read reports a gap, never
a calm ocean — and `tools/test-genesis.mjs` drives exactly that, verified by
reintroducing the bug. **When a real busy ABIO lands in `history/`, replace
the fixture with it.** The 72-hour window rolls, so check rather than assume.

## HELD FOR WEATHER

**Everything here is BUILT AND DEPLOYED and cannot be judged until the named
weather arrives.** Do not tell Aaron these are ten minutes of looking — they are
not. Each names its condition first, then the question; the as-built description
is in the spec section cited.

**A GDACS STORM WHOSE COUNTRY IS ATTRIBUTED, WITH AN ALERT IN FORCE** —
`SPEC-DATA.md` §50.3, §50.11, §50.12. **THIS WAS NOT WAITING FOR WEATHER. IT
WAS WAITING FOR A ONE-WORD BUG.** `lib/cap.js` read `storm.countries`; the
field is `storm.raw.countries`. Every GDACS storm resolved to no country, so
no foreign agency alert had ever reached a screen and the CAP coastal stripe
had never painted. Fixed 2026-08-20; three tests were green over it and now
build their storms through the real normalizer.

**So this is judgeable the moment an attributed GDACS storm has an alert out,
and both halves of that already exist.** SAUDEL-26 carries Japan; PAGASA has
had a Philippine alert in force all day. What has still never been on screen
is the section listing a foreign agency's alert — the rows, the
agency/area/expiry meta line, a non-English disclosure chevron, and the closing
note that keeps a country-level alert from reading as an order about this
storm. Look at it on the next GDACS storm whose country matches an agency with
something out.

The wording question that rode on this is **narrower than it was.** Saudel now
resolves to Japan, so it no longer shows *"No country is listed as affected by
this storm yet."* That sentence is now reached only by a GDACS storm genuinely
out at sea — and **Two-C is not an example**, it is an NHC storm and never
enters this branch at all. Whether the sentence reads as a non-sequitur under
`Watches and warnings` is still Aaron's call, but it wants a real unattributed
GDACS storm to judge against, and there is not one right now.

**A GDACS-basin storm near a coast** — `SPEC-DATA.md` §50.11, §51.4, §51.7.
Three things ride on this one condition. Do the two coastal stripes read as
coasts (**nobody has ever seen either one paint** — both were handed the wrong
argument shape until 2026-08-19). Does the 13 km surge corridor join towns into
one honest stripe. And **do its GAPS read as "not modelled" or as "safe here"** —
the harder half, and if a reader takes an unpainted stretch as safe that is a §5
bug fixed by wording, not by a wider corridor. Also: is teal-to-magenta
distinguishable from NHC's blue-to-purple at a glance.

**A real typhoon on a real coast** — `SPEC-DATA.md` §51.4. The whole archive
spans 0.10–0.48 m, rungs 0 and 1 of five. The top three surge colours and the
"deepest town elsewhere" sentence have never rendered.

**A GDACS-basin storm near the house** — `SPEC-DATA.md` §51, `SPEC-UI.md` §56.7.
Surge at home has never rendered. Useful or trivia beside the wind numbers; does
the six-hours-of-rising clause earn its line; and — the one that matters — does
`out_of_range` read as **a gap in what we know** or as an all-clear. All-clear is
a §5 bug.

**A storm near the house** — `SPEC-UI.md` §48.10. Lala's advisory said 8–12
inches across eastern Maui while the grid at Kahului said 2.91; both correct, and
a reader seeing both thinks the app is broken. Does wording the section about the
HOUSE and naming the forecast point defuse that? Then: frightening or trivia
beside the wind numbers; is a Flash Flood Warning above it urgent or just taller;
does *NHC lists no land hazards* reassure or look broken.

**A Western Pacific storm with PAGASA warning on it** — `SPEC-DATA.md` §50.
**The prior question is whether the alerts section earns its place at all** — the
entire global feed was one real row at an hour with three live cyclones. Then:
informative or clutter; does the footnote say "this agency covers this country"
rather than "this alert is about this storm"; and on an NHC storm, is pointing at
**In effect** above an answer or a dead section.

**A JTWC watched area going Medium or High** — `SPEC-MAP.md` §45.4. Does the
patch step visibly, and match an NHC area at the same rung. Both live areas are
Low.

**An NHC outlook going quiet without explaining itself** — `SPEC-DATA.md` §45.5,
`SPEC-OPS.md` §17.7. Nobody has seen the amber held note. Stopped clock or
failure; do the patches stay; does a genuine all-clear still get through at six
hours.

**A JTWC-unmatched GDACS storm** — `spec-parameter.md` §34.1, §35.1. Does
"estimated from wind field" read as honest provenance or hedging noise beside the
crisp `Forecast peak` row; does `Forecast by` earn its line; does a suffix-free
name still match what the news calls the storm.

**A storm going quiet, then vanishing at hour 60** — `SPEC.md` §5. Does "quiet
since Sun 7:00 AM" under **Finished** read as coherent, and the disappearance as
a decision rather than a glitch.

**An ended storm and a phone that has never seen it** — `SPEC.md` §5,
`data/ended-track.js`. Does a trackless finished storm get its dotted line inside
one poll, identical to one captured live.

**A storm in an unfavorable environment** — `SPEC-MAP.md` §47.5. Only the
FAVORABLE end of the ribbon's ramp has ever been seen. The ribbon itself is now
confirmed on glass across the date line (Lala, 2026-08-20), so what is left
here is the COLOUR at the hostile end and nothing structural.

**A STORM WHOSE WATER FAILS UNDER IT** — `SPEC-NEXT.md` §47.8. The water
sentence is built and fires on 11.7% of runs, always tightening. Three of the
fifteen fixtures produce it, so it is proven on real bytes — but no reader has
seen it under a live cone, and the question is whether *"The water ahead of it
holds less — down to 100 mph by Thursday morning"* reads as the correction it is
meant to be, sitting under a cone painted its brightest violet.

**Fifteen storms in the list** — `SPEC-UI.md` §16. The freshness column is never
blank, so grey timestamps are new visual weight and the amber ones must win
against quiet neighbours rather than against nothing. Two live storms is not the
test.

**A real final warning** — the `declared` end path has never fired. Detection is
client-side; the app must be open.

**A storm mid-pass, sitting still long enough to look at** — `SPEC-NEXT.md`
§49.12. Does *Was strongest* beside *When it was closest* read as one story in two
tenses or two unrelated facts (Q6); is *It came closer earlier* enough, or does
the past want its own vertical (Q5).

**A US storm with surge watches in force — and this one is a BUILD, not a look.**
`SPEC-DATA.md` §4.8, §51.5. **`/api/nhc/surge` does not exist**; `fetchSurgeLive()`
calls it, gets a 404, and every NHC-basin storm shows `unavailable` today. Nothing
fills it in from GDACS and nothing should (§51.5 settled, a test guards it), so
this route is the only path to surge on an American storm. Held because the Peak
Storm Surge service only answers while a watch is up and `SURGE.liveColorFields`
is an ordered list of GUESSES at where the colour lives — against a storm half a
planet away there is no telling a right answer from a plausible one. Build the
route and surge-at-home together; they share one fetch-and-filter.

**Several days of hourly snapshots — not a glass call** — `SPEC-DATA.md` §50.12.
Each archive run writes a `countryMatch` block. A country in
`unmatchedAlertCountries` that later attaches was attribution LAG; one that never
attaches is a coverage HOLE. **Do not decide how to close it before there are
several days** — the fix for a lag is patience, the fix for a hole is a second
storm source, and one hour cannot tell them apart. NEXT UP item 4 pollutes the
denominator.

## SCOPED, NOT STARTED

**AN ALERT IN FORCE THAT REACHES NOBODY — AND THE OBVIOUS FIX IS THE WRONG
ONE.** `SPEC-DATA.md` §50.3, §50.12. The app fetches live government cyclone
warnings and can currently show them only under an attributed GDACS storm. An
alert for a system we do not track is fetched, held, and displayed to no one.

**REJECTED: joining alerts to WATCHED AREAS by position** (Aaron's suggestion,
2026-08-20, talked through and dropped). An area carries a centroid, a shape,
two probabilities, a risk word and a basin — **no country**. NHC publishes none
for its areas; JTWC publishes a bearing off a landmark ("151 NM SSW OF KADENA
AIR FORCE BASE"), which is not attribution. Joining would mean deciding which
nation an area sits in from its position — exactly what §50.3 refuses to do for
storms, and on weaker evidence, since a JTWC area's shape is a circle WE drew.
It would also have matched wrong on the day it was proposed: 94W (23.9N 127.1E,
inside the PAR, rated **Low**) would have taken the alert while 95W (19.6N
110.3E, outside the PAR, rated **High**) got nothing.

**SURVIVING OPTION: a global line attached to nothing** — e.g. at the foot of
`Being watched`, naming the agency and the area and stopping there. Honest
precisely BECAUSE it claims no connection.

**GATED, AND THE GATE IS REAL.** Do not build it before the alert feed is
clean. `NEXT UP` item 4 is the reason: the Esri query asks for
`event LIKE '%Hurricane%'` and DWD writes "hurricane-force gusts", so on
2026-08-19 four of the five alerts in force worldwide were GERMAN
THUNDERSTORMS. A global surface makes that bug user-facing instead of a
footnote. Fix the query first, then watch several days of
`countryMatch.unmatchedAlertCountries` in the archive — a country that later
attaches was attribution LAG, one that never attaches is a coverage HOLE, and
one hour cannot tell them apart.

**JTWC'S `.tcw` IS A BETTER SOURCE THAN THE PRODUCT WE PARSE.** `SPEC-NEXT.md`
§53 — four separable wins, the strongest of which deletes the relay's
date-guessing code outright. **Do not write the parser off the current
snapshot:** two storms, one hour, one hemisphere, and a formation alert has a
different layout entirely. Wait for a Southern Hemisphere storm in the window.

**`map/imagery.js` CAME BACK UNDER 1,000 AND THE PATTERN IS WORTH COPYING.** It
shrank because radar left, and radar left because a tile pyramid and a WMS want
opposite shapes — the split was forced by a real defect, not by the line count.
The two views below are still waiting on a split that carries no behaviour, and
that is the harder kind to justify. It is still the right next move on both.

**Two views are over §12's ~700-line ceiling.** `ui/view-home.js` is **1,694**
(strength strip, countdown rail, and the quiet/error/no-home states are three
separable concerns); `ui/view-storm-detail.js` is **1,605** (stamp, section
renderers, advisory record, stepper). Each split is its own pass with **no
behaviour change**, so a break can only be the move.

**BASIN GROUPING IS WANTED AND NOT STARTED.** Areas should sit under the same
basin headings the storms do. **The blocker is not layout:** `Being watched` is
the only surface that can say the outlook is DOWN, and dissolving the section
leaves that message with no home. Decide where an outage speaks before moving any
rows. It also drags in an ordering rule within a basin (storms and areas are not
on one scale) and basin headers containing only a watched area, which at a glance
can read as an active threat.

**A quiet basin is believed at once now, and nobody has seen it happen.**
`SPEC-DATA.md` §45.5. The KMZ states the all-clear in a dated sentence, so the
six-hour hold no longer stands in front of a genuine all-clear. The hold still
exists for a document that goes quiet WITHOUT explaining — a shape NHC has never
published in 72 hours of archive. If it never fires, the whole held apparatus is a
candidate for deletion.

**The unlabelled LineString is parsed, carried, and drawn nowhere.** Present in 23
of 72 hours, always when a disturbance sat outside its own area. Four samples, one
disturbance, one basin — decide what it is before deciding whether to draw it.

**The 3D land fill should be shapes, not a picture.** Feeding `RINGS` to the GPU
as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling, and turns retheming into a recolor. Traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, flat
triangles cutting chords through the sphere. `earcut` (~10 KB, no build step) does
the triangulation. Ring winding is opposite between the two paths, and this is the
thing that will care. **Not during cyclone season, and not in the same pass as the
engine upgrade** — both are surgery on `map/globe3d.js`.

**The three.js r128 → r182+ upgrade gates nothing.** Ordinary maintenance now.

## KNOWN AND ACCEPTED — MOVED

**These live in `SPEC.md` §55 now.** Decisions that are finished, and things
that will otherwise be rediscovered and re-reported: the duplicate §9.3
heading, why the storm light is stronger on a phone, and the rest.

**Read it at session start along with this file.** That is the whole condition
on which the move was made — a section nobody opens is a section that has been
deleted with extra steps.

```
sed -n "$(grep -n '^## 55\.' SPEC.md | cut -d: -f1),\$p" SPEC.md
```

