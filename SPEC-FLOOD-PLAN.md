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
name, claiming a connection nobody made. That is §48.18's own failure, twice, on
the two screens it was written to protect.

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

### 56.7 One Flooding section, both kinds of water

**RAIN AND FLOODING ARE SEPARATE SECTIONS; COASTAL FLOODING IS NOT.** Rainfall is
our arithmetic on a forecast. A flood alert is an agency's statement about right
now with an expiry on it. Burying the second inside the first makes the urgent
thing look like a footnote on the other thing — so Flood leaves Rain.

**BUT COASTAL FLOODING MERGES INTO IT RATHER THAN STANDING BESIDE IT.** Somebody
deciding whether to move a car does not care whether the water came off the sky
or off the sea. Two headings for *water is going to be where you are* is a
distinction that matters to the plumbing and not to the reader. §51.6's separate
`Coastal flooding` section is deleted and its content moves here.

**AND THE TWO BARELY EVER CO-OCCUR, WHICH SETTLES IT.** NWS flood alerts are US
only. GDACS models coastal flooding and explicitly does not cover NHC basins
(§51.5). So a US storm has alert rows and no modelled figure; a Japan typhoon has
a modelled figure and no alert rows. **Two sections where one is always empty is
worse than one section that fills from whichever source has something.**

**THEY ARE DIFFERENT KINDS OF STATEMENT AND MUST NOT BE STYLED THE SAME.** An
alert is somebody else's order. A surge height is our reading of a model. Given
one look, the model borrows the authority of the order. So the section takes the
shape Rain already uses: **bordered alert rows on top with their own ink, our
modelled figure as plain prose underneath.**

**==> ONE SECTION NOW CARRIES TWO COVERAGE GAPS AND EACH ONE READS AS AN
ALL-CLEAR IF IT IS SILENT. <==** This is the §5 cost of merging and it is the
thing most likely to be got wrong.

- A Japan typhoon shows a modelled figure and no rows. That must not read as
  *no flood warnings are in force* — it means **NWS is US-only and we have no
  global equivalent.** The section says so.
- A US storm shows rows and no modelled figure. That must not read as *no
  coastal flooding expected* — it means **this model does not cover this
  basin.**

Getting that right in one place rather than two is another point in favour of
the merge.

**ORDER ON BOTH SCREENS:** Rain, then Flooding.

---

### 56.8 Watches and warnings keeps its place, and gains one line

**FLOOD ALERTS DO NOT MOVE INTO `Watches and warnings`.** The line that holds:
**that section carries products that name this storm; Flooding carries products
that do not.**

- NHC's four products — Tropical Storm Watch/Warning, Hurricane Watch/Warning —
  are issued for this storm, by name, in its own advisory. No attribution risk.
- The foreign-agency CAP rows are matched by country (§50.3), which is weaker,
  and §50.12's footnote already hedges it.
- An NWS flood alert names nothing at all. It is a distance match **we**
  performed. In a section whose other rows genuinely belong to the storm, that
  difference would be laundered into looking official.

**REJECTED: one merged warnings list.** It would sit a Hurricane Warning — this
storm, named, act now — beside a Flood Warning two states away that may have a
different cause entirely, in one list with one look. The strong row lends its
authority to the weak one.

**THE COST IS ONE SENTENCE, AND IT IS THE WHOLE DEFENCE.** A reader who opens
`Watches and warnings` during a flood and finds no flood warning will conclude
the app missed it. That section carries a line pointing at Flooding.

**ONE OVERLAP TO FIX: STORM SURGE ALERTS RENDER UNDER FLOODING.**
`functions/api/cap/alerts.js` queries `%Storm Surge%`, so a foreign Storm Surge
Warning currently lands in `Watches and warnings` while every other kind of water
now lives in Flooding. That splits water across two sections according to which
feed happened to carry it — the exact arbitrariness the merge just deleted. Same
fetch, shown where the reader is already looking for water.

---

### 56.9 Home data leaves the storm drawer, and gates on the corridor at home

**NOTHING ABOUT THE READER'S HOUSE APPEARS IN THE STORM DRAWER.** The house
block goes — the rainfall total at home, the peak timing, the home flood rows.
A storm panel is about the storm. What stays in its Rain section is NHC's own
published rainfall range, which is about the storm.

**THE HOME DASHBOARD GATES ITS HOME SECTIONS ON THE SAME CORRIDOR.** The
dashboard has a stepper and you can cycle every storm on Earth through it. Its
Rain section is a plain query at the reader's address with no storm in it, so
cycling to a Japan typhoon leaves the rainfall figure sitting under that storm's
name — **its position claiming a connection nobody made.** That is §48.18's
failure on the other screen.

**ONE TEST, USED TWICE.** The corridor that decides *which alerts belong to this
storm* is the same question as *does this storm reach my house*. So: **if the
house falls inside the shown storm's corridor, the home sections render. If it
does not, they do not appear at all.** One radius, one meaning — and it replaces
the two differently-sized rings §48.20 currently juggles.

**ONE EXCEPTION, AND IT IS NOT A LOOPHOLE.** On a calm day with no storm near,
the home screen must still show the reader their own rain forecast — that is the
screen's entire job. So the home sections render when the storm on screen is in
range **or when there is no storm on screen at all.** What they never do is
render under a storm they have nothing to do with.

---

### 56.10 The glyph

**THREE STACKED WAVES, AND THE SAME SHAPE ON THE MAP.** Tap a wave on the globe
and the panel that opens is headed with the same wave — one continuous thought
rather than two unrelated marks. Added to `ui/section-icon.js` under a name for
the idea rather than the picture, as that file requires.

**`surge`'s ICON IS DELETED WITH ITS SECTION.** Its own comment says it exists
solely to separate `Coastal flooding` from `Rain` at a glance while scrolling.
That section no longer exists, so the mark has no job. **The wave-icon collision
this plan worried about at one point is gone with it** — there is exactly one
water mark now.

**THE MAP ICON IS DRAWN FROM THE SAME PATH DATA, NOT REDRAWN.** `map.addImage`
wants pixels, so the path is stroked onto a canvas the way `map/layers/genesis.js`
builds its hatch — including that file's no-DOM degrade, which returns null
rather than throwing and taking the whole layer engine down with it.

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
- The house block in `ui/rain-storm.js`, its scope logic, and its CSS.
- §51.6's `Coastal flooding` section, and `surge` from `ui/section-icon.js`.
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

**PHASE 2 — THE FLOODING SECTION.** One section on both screens: alert rows on
top, the modelled coastal figure as prose below. Merge in §51.6 and delete it.
Add the three-wave glyph. Add the pointer line to `Watches and warnings` and
move storm-surge CAP rows across. **This is the phase that gives keyboard users
a path to an alert, so it must land before the map icons.**

**PHASE 3 — HOME GATING.** Strip the house block out of the storm drawer. Gate
the home dashboard's home sections on the corridor, with the no-storm-on-screen
exception. Small, self-contained, no new data.

**PHASE 4 — ZONE SHAPES FOR WATCHES.** Resolve and cache the zone polygons a
watch names. Ends with watches drawable and matchable, and the watch/warning
special case gone from every surface downstream.

**PHASE 5 — THE MAP.** Interior points, clustering, the polygon zoom gate, the
icon, and tap-to-detail. Last because it is the only phase that cannot be judged
without weather, and because Phase 2 already gave the feature a keyboard-reachable
home.

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
