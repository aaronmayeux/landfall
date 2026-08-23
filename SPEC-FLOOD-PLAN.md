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

### 56.4 Watches need their zone shapes, and that unlocks everything

A Flood Watch carries `geometry: null`. It therefore **cannot be drawn and
cannot be matched to a corridor** — there is nothing to measure a distance
from. Widening the search does not help; there is no shape to test.

**THE ZONE SHAPES ARE PUBLISHED AND THEY BARELY CHANGE.** Each watch names its
forecast zones in `geocode.UGC`, and NWS serves each zone's real polygon. So:
resolve the zones an active watch names, cache them hard, and a watch gets real
geometry — which makes it drawable **and** matchable through the same distance
test as everything else.

**WHY THIS IS NOW WORTH THE REQUESTS AND WAS NOT BEFORE.** §48.21 rejected it as
"seventeen more requests per watch", which was true and is still true — but it
was weighed against drawing alone. It now buys drawing *and* matching *and*
deletes the whole watch/warning special case from every surface downstream.
The captured watches named 13 and 8 zones; zone boundaries change on the order
of once a year, so a long cache makes this a handful of requests total rather
than per watch.

**==> A ZONE SHAPE IS NWS's OWN BOUNDARY, NOT ONE WE DREW. <==** This is the
distinction that makes it permissible at all. §48.21 forbids giving a shapeless
watch a shape — a centroid, a circle, anything invented. Fetching the boundary
the agency itself publishes for that zone is the opposite of inventing one.

**IF THE ZONE FETCH FAILS, THE WATCH IS SAID AND NOT DRAWN.** It reaches the
list with its area text and no shape, and the layer status row says how many
could not be placed. Never silently dropped, and never given a substitute
shape.

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
list, when it began, when it ends, how long is left, and the issuing office.
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

**PHASE 5 — THE MAP.** Interior points, clustering, the polygon zoom gate, the
icon, and tap-to-detail. Last because it is the only phase that cannot be judged
without weather, and because Phase 2 already gave the feature a keyboard-reachable
home.

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
