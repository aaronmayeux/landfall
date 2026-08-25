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

**==> LALA'S WIND SWATH WRAPPED THE PLANET. FIXED, NOT YET SEEN ON GLASS. <==**
Aaron reported it 2026-08-24: the 34 kt band ran off both edges of the screen
and made a green ring around the globe. **Not a regression and nothing to do
with the seasons work** — it is the case `SPEC-MAP.md` §7.9 named as unreachable
for want of bytes, and Lala supplied the bytes by tracking northwest onto ±180.
Her nine forecast points now run −179.40 through +179.20.

The corridor is flattened onto a plane by raw longitude subtraction from the
first timeline entry. Across the seam that read the far end of the forecast as
316° away instead of 43°, so the sweep went the long way round the world. The
built 34 kt band measured **359.75° of longitude wide**; it is 38.03° now.
`SPEC-MAP.md` §7.12 fault 3 is the whole account,
`tools/test-windswath-dateline.mjs` (33 assertions, three mutations verified) is
the gate, `samples/lala-cp012026-dateline/` is the real archived bytes.

**The half with no symptom went with it.** The same polygon feeds `People in the
path` (§54), and the headcount's own dateline machinery treated a 359°-wide ring
as a wrapped one and shifted it into a shape covering most of the planet —
**Lala's figure has been meaningless, silently, for as long as she has been on
the seam.** The corrected envelope runs past ±180 by design (one shape across
the seam, `lib/trackline.js`'s convention), which the headcount could not read
either, so `lib/population-count.js` folds longitudes back into range at the
door.

**GLASS, and Lala is the only storm that can show it:**

1. **The 34 kt band stops being a ring.** It should read as one continuous
   corridor running northwest past the date line and ending near 40°N 177°E —
   one shape crossing the seam, not two shapes on opposite rims of the map, and
   nothing running off the far edge. Worth a two-finger rotate to follow it
   across.
2. **`People in the path` on Lala.** It should now be a small number or none —
   she is over open ocean west of Hawaii. Anything in the millions means the
   fold is not reaching the count.
3. **Every other storm unchanged.** Iselle, Moke, Narra, Saudel, Atsani are all
   the no-op control: none of them is near ±180, so any visible change on them
   is a regression, not the fix.

**==> AND THE SECOND SEAM FAULT IS WIRED SHUT BEFORE IT SHOWS. <==** Different
mechanism, same meridian. NHC CUTS any shape crossing ±180 into two halves, each
carrying a fake straight edge down the seam. `lib/seam-stitch.js` has undone that
since 2026-08-20 — **but it was wired to the cone alone**, and it repaired
nothing else for four days. On the 17:37Z run, two of Lala's forecast wind rings
already arrive cut and nobody was repairing them. It cost nothing yet only
because those are consumed as numbers rather than drawn.

**The current wind field is the one that would have shown**, and it is drawn raw
— nothing replaces that slot. Cut, it draws as two blobs on opposite rims of the
map with the fake edges stroked as real wind-field edges. Lala's is still whole
only because at 175.3°W she has not reached the line. She will.

Wired at the DOOR now (`data/nhc-mapserver.js stitchSeams()`), over every fetched
layer, so a layer added later inherits the repair. Measured safe on the path that
already worked: stitching the forecast radii first leaves the built corridor
bit-for-bit identical, both bands, every vertex to six decimal places.
`tools/test-seam-layers.mjs`, 88 assertions against the real cut rings, area
checked against the two halves added together. It also reads the shipped module
and asserts the call is on the fetch path — blunt, and the right instrument: a
helper nobody calls is exactly the state this corrected.

**NOTHING NEW TO CHECK ON GLASS FOR THIS ONE UNTIL LALA CROSSES.** When she does,
her Current wind bands should read as one shape across the line — no hard
straight edge down the middle, no second blob on the far rim. If that appears,
the stitch declined the shape and the console will not say so; grab the bytes off
the archive rather than guessing.

**ORANGE AND RED ARE FIXED TOO, AND THAT IS MEASURED RATHER THAN REASONED.**
Aaron asked 2026-08-24. Only the green 34 kt band wrapped, which is an accident
of the advisory — NHC stopped publishing Lala's 50 kt radii after tau 36 and
published no 64 kt at all, so orange and red END before the seam rather than
being handled differently. The branch is applied once to the timeline above the
per-threshold loop, so all three sweep the same corrected spine. Proven by
carrying Lala's own 50 kt numbers onto the taus that cross ±180 and building a
64 kt rose at half those radii: **with the branch removed all three wrap —
360.13°, 359.50°, 358.48°; with it, none does.** Asserted per threshold in
`tools/test-windswath-dateline.mjs` so a future repair cannot cover one and miss
two.

**The prime meridian was checked at the same time and is clean** — 0° is not a
branch cut, so no wrap arithmetic runs there at all. All five longitude
normalizers in the repo are the identity across it, `basinFromPosition` returns
`atlantic` continuously through 0, and both facts are now asserted. One latent
fault is recorded rather than fixed: the headcount's "wider than 180° means
wrapped" rule would tear a shape genuinely spanning 200° across 0. No corridor
is remotely that wide and the new general span assertion keeps it that way.

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

**==> TWO RELAY ROUTES WERE WARMED FOR WEEKS AND READ NONE OF IT. FIXED. <==**
`tcgp/storms` and `nws/flood` were both in the cron's `LIST_FEEDS` and neither
route imported `kvRead` at all — **~576 origin fetches and KV writes a day
between them, every byte read by nothing.** Both routes worked the whole time,
falling through to their colo cache and to upstream exactly as they did before
Pass B, which is why there was no symptom: the warm loop reported perfect health
over a store nothing consulted.

**FOUND BY A CHECK WRITTEN FOR SOMETHING ELSE.** `tools/test-kv-keys.mjs` proved
that every reader's key is filled by the writer; it never proved the reverse, and
that is the direction with no symptom. It now asserts zero orphans. **`nws/flood`
reads KV at the fresh tier only and must not be "finished"** — that route
refuses a stale answer on purpose, and a warmed copy nine hours old is an expired
flood warning arriving by a different road. `SPEC-DATA.md` §58.3.


**==> STEP 7 WAS BUILT, SHIPPED, AND REVERTED THE SAME DAY. GLASS SAID THE
SEASONS DRAWER WAS UNUSABLE. <==** Aaron, 2026-08-25: *"every tap target in the
seasons drawer is fucked up — pretty much anywhere I touch closes the drawer or
does something I don't intend."* Reverted whole rather than patched, per §12's
rule, back to the 6b state he had already confirmed.

**==> DO NOT REBUILD STEP 7 UNTIL THIS IS DIAGNOSED. THE CAUSE IS NOT KNOWN.
<==** Four things were checked in the sandbox and all four came back clean:
the roster row hit-tests correctly at 390×844 (label 324 px, chevron 44 px, no
overlap), `seasons/seasons.css` has no unbalanced brace, `data-seasons="on"` is set at
tap time, and a synthetic tap outside the drawer did not close it.

**THAT LAST RESULT IS WORTHLESS AND THE NEXT SESSION MUST NOT TRUST IT.** The
sandbox cannot load the basemap, so MapLibre may not be firing `click` at all —
the check was run in the one environment that cannot have the bug. **This is
the `styleLoaded: false` trap this file already names elsewhere, arriving at a
new door.**

**THE ONE REAL FINDING, UNEXPLAINED:** at 390×844 the drawer body is **424 px
of an 844 px screen**, and the roster's first row starts at y=678. More than
half of what a thumb lands on is not drawer at all — it is globe. Whether that
is the cause or a long-standing fact about this drawer was not established.

**THE PRIME SUSPECTS ARE THE TWO COMMITS THAT TOUCHED THE ROW**, `c381b46` and
`2b2dc55`: the roster row gained a second child (a `<button>` chevron beside
the `<label>`), and the board's year and filter logic moved out to a new file of its own.
Both are in `git log` and can be read rather than re-derived.

**THE ONE QUESTION THAT WOULD SPLIT IT:** tapping a storm's NAME in the list
should tick its box and brighten its track. If that closes the drawer instead,
the row markup is the fault. If it ticks correctly and something else misfires,
the fault is elsewhere and the row is innocent.

**WHAT SURVIVED THE REVERT AND SHOULD NOT BE REBUILT.** `seasons/reports.json`
(1,524 storms back to 1958), `tools/tcr-index.mjs` and its monthly job,
`tools/tcr-probe.mjs`, and §57.22a's measurements. **None of it is UI and none
of it ever touched the drawer.** A future step 7 has its report lookup already
solved and already deployed.

**==> SEASONS UI POLISH, PUSH 1 OF 2: THE GLOBE. SHIPPED, NOT YET SEEN ON
GLASS. <==** Aaron's list, 2026-08-25. Checking a storm and selecting one are
now two different actions: checking draws the line and its name, four checks
give four equal tracks; selecting dims the rest, switches that storm's line to
the forecast ink and puts a Saffir-Simpson dot at every recorded position.
Landfall pins are gone. Tracks are smoothed with the app's own curve.
`SPEC-SEASONS-BUILD.md` §57.21a is the as-built account.

**WHAT TO JUDGE, AND ONE OF THESE IS EXPECTED TO COME BACK WRONG:**

0. **CONFIRMED ON GLASS 2026-08-25**, with one change asked for and made: the
   selected storm's name came off its line and onto its first dot, placed by
   the live globe's own `name-placement.js`. Items 1-5 below were the open
   questions and Aaron answered them by accepting the pass; they are kept only
   because the name change has NOT been seen yet and lands on top of them.

1. **The selected line is QUIETER, not louder** — neutral ink, same width,
   with the emphasis carried by everything else ghosting and the dots
   appearing. That is the live globe's grammar and it is the opposite of the
   usual instinct. If it reads as "nothing happened", the lever is the ink.
2. **Forty ten-pixel dots along one track at basin zoom.** They may be a
   legible chain or a caterpillar that hides the line. The fix if so is a zoom
   ladder on the radius, which was written up and deliberately not built once
   the dots were bounded to one storm.
3. **The white ring on the earliest fix.** It is there for direction, which an
   archive track has no cone to supply. It may also just read as a fatter dot.
4. **The curve.** 400 vertices per track; a long-lived storm may read faceted
   at close zoom. `SEASONS.trackMaxVertices` is the dial.
5. **Enter on a ticked row opens that storm; Enter again closes it.** The
   keyboard path. Worth one pass with the mouse untouched.

**==> SEASONS UI POLISH, PUSH 2: THE DRAWER AND THE BAR. SHIPPED, NOT YET SEEN
ON GLASS. <==** All eight items of §57.21b, which is now the as-built account —
read that, not this. The roster row is a real checkbox, a solid category dot,
the name, a strength badge, the landfall mark and the dates; a spreadsheet-style
master box sits above it; changing a filter clears the checks; the sheet opens
at 75vh; the header's X is a minimise chevron; and the bar names what is drawn
and what is open.

**==> CONFIRMED ON GLASS 2026-08-25, WITH FIVE CHANGES ASKED FOR AND MADE.
<==** Aaron: "looks good and works well." The five: the year list is painted
out of the palette on desktop, the focused row's left bar is gone, the strength
badge is its own column, the bar toggles the board, and the whole drawer header
dismisses. All five are in §57.21b as-built. **The list below is what was open
BEFORE those five and is kept because they land on top of it.**

**WHAT IS LEFT TO SEE, AND ONE ANSWER IS ALREADY IN:**

0. **THE TAPS BEHAVE.** Item 1 below was the open question and glass answered
   it: the rewritten row works. **So step 7's tap-target fault is NOT the row
   markup**, which is the first real finding about it since it was reverted —
   and the per-row chevron §57.21b holds back can now be built, because the
   shape it was avoiding has been cleared.

**WHAT TO JUDGE, AND THE FIRST TWO ARE THE ONES MOST LIKELY TO COME BACK
WRONG:**

1. **DO THE TAPS BEHAVE.** This push REWROTE the roster row completely, which
   is the same thing step 7 did before glass reported every tap target in this
   drawer misbehaving — a cause still unknown. **If taps go wrong again, that
   is the second data point and the row becomes a real suspect rather than a
   guess.** If they are fine, step 7's fault is somewhere else and the per-row
   chevron can finally be built. Worth testing deliberately rather than
   noticing in passing: tick a row, untick it, press the master box, press a
   filter.
2. **75vh.** A dial, not an answer. It was 424px of an 844px screen; it should
   now be roughly 630. If it eats too much globe the number is one line in
   `seasons/seasons.css`.
3. **The bar's middle sentence at 390px.** `2005 · Atlantic · 3 shown · tap a
   track for detail` is long and is allowed to wrap to a second line rather
   than ellipsing. If it reads as clutter, the hint is the part to cut.
4. **One line or two.** The container query breaks at 400px of ROSTER width, not
   window width. A phone should be two lines; a wide desktop window one. **The
   desktop side rail is ~300px and should stay two lines** — that is the case a
   viewport query would have got wrong, and the one worth checking.
5. **The master box's bar state.** Tick one storm of 2005: the box above should
   show a horizontal bar, not a tick and not empty. Tick them all: a tick.
6. **The chevron.** Only Seasons gets it. Every other drawer — storms, detail,
   layers, settings, home — must still show an X.
7. **The home door.** It is inside the scroll now rather than pinned under it,
   so it is at the very bottom of the dashboard and the dashboard is a row
   taller.
8. **Keyboard pass, mouse untouched.** Space ticks a row, Space on the master
   box fills or clears the list, Enter on a ticked row opens that storm.

**THE §12 CEILING WAS CROSSED AGAIN AND THE CUT WAS TAKEN AGAIN.** The board
went in at 833 and came back at 769: `ui/seasons-board-paint.js` took the three
functions that change rows already on screen. **769 is still 69 over and the
file now has a row in §12's table** naming the next cut precisely — the LOADING
block, roughly 170 lines, which owns every piece of fetch state and shares
nothing with the roster's own. It was not taken here because this pass changed
eight behaviours at once. **It is the next thing that happens to that file,
before any feature.**

**AND ONE RED SUITE ON MAIN IS NOT FROM THIS PASS.**
`tools/test-loading-dots.mjs` has been failing on `ui/season-detail-markup.js`
since step 7 was reverted — the file survived the revert and nothing imports
it. Either it gets its waiting sentence routed through `ui/loading-dots.js`, or
it is dead code and §12's retire-cleanly rule says delete it. Confirmed
pre-existing by stashing this pass and re-running.

**THREE VALUES ARE SETTLED ON GLASS AND SHOULD NOT BE REOPENED WITHOUT NEW
EVIDENCE.** `ARCHIVE_GEO.dimmedOpacity` at 0.2 reads as a ghost rather than an
erasure. `nameRepeatPx` at 220 keeps a name attached to its line while
panning. `swathFillOpacity` at 0.14 leaves the track readable through the
wash. **The fourth — ticking a storm focusing it — was reversed on 2026-08-25
and its cost was exactly what §57.21a predicted in writing.**

**AND THE FOOTPRINT'S DISCOVERABILITY COST WAS ACCEPTED RATHER THAN
OVERLOOKED.** With nothing focused, nothing draws — the bound that keeps four
ticked storms from becoming twelve compounding translucent shapes. It was
flagged as the one real risk in the design before glass and judged fine.
**If a later pass wants to draw them all, the numbers to argue with are in
§57.26a**: ~300 ms and ~34,500 vertices for a season against 12 ms and ~1,600
for one storm.

**AND THE HOME MARKER STAYING UNTAPPABLE INSIDE THE ARCHIVE IS SETTLED TOO.**
It was flagged as a behaviour change made without asking and accepted. The tap
handler answers for the archive and returns, because falling through would
close the drawer, which is the only way back out. §57.21a records it.

**THE §12 CEILING WAS CROSSED TWICE IN TWO SESSIONS AND THE CUT WAS TAKEN BOTH
TIMES RATHER THAN DOCUMENTED.** Step 6a took `liveDownHtml` out of
`ui/view-seasons-board.js`; step 6b's footprint slot put it back at 705, so the
whole roster assembly went too — `seasonRosterHtml`, told what to draw and
reading no state, same cut and same reason. **693 now, and the pattern is that
this file grows on every seasons pass.** The next one should expect to cut
again rather than be surprised. **`main.js` is 1,659 and the `warmable layer`
helper has been "the next cut" for five passes running**; §12's row says so
plainly and the next pass that opens that file should take it.

**THIRTY-THREE MUTATIONS HAVE NOW BEEN RUN ACROSS THE SEASONS SUITES AND THREE
SURVIVED**, which is the failure §12 calls worse than no test. Step 6b's two
are in §57.26a — the seam, and the threshold-colour drop guard. Step 6a's was
`test-seasons-board.mjs`'s
filter case ticked whatever happened to be at the top of 2005 and then
narrowed to Majors, so it took the branch where the storm had been filtered
off the list and asserted nothing — with the focus repaint deleted it stayed
green. It now narrows FIRST and ticks from the narrowed list, so the storm is
a major by construction, and the mutation was re-run and bites.

**AND THE BOARD'S STAND-IN DOM TOLD THE SAME LIE TWICE.** It could not read a
compound selector, so `.seasons-row[data-row]` returned false for every
element in the document and the view looked like it had simply never marked a
row. The note already on `matches()` warned about exactly this shape from a
previous occurrence. Compound selectors are supported now; **anything that
stand-in cannot read must be made readable rather than worked around in the
view.**

**A STORM WHOSE FILE WILL NOT LOAD ALSO LOSES ITS NAME**, so it turns up in the
unused list — the board says so in the same sentence that counts it. Disclosed
rather than fixed: the season index carries ids, not names, so nothing here can
know the name of a storm whose file never arrived.

**WHAT STEPS 3b AND 4 BUILT LIVES IN `SPEC-DATA.md` §58, `SPEC-OPS.md` §18.8
AND §57.16a.** Read those, not this. Both were verified by Aaron on a phone on
2026-08-24 and neither has anything left for him to look at.

**==> BROWSING A YEAR NO LONGER GOES THROUGH STEP 8'S MACHINERY. <==** Aaron's
call 2026-08-24. The runner now cuts each HURDAT2 basin into **one file per
season** (`tools/seasons-slice.mjs`, §57.35 FIX 12, `SPEC-OPS.md` §18.8), so
opening 2005 is **14 KB over the wire and 14 ms of parsing** instead of 6.75 MB
behind a download gate, a Worker and IndexedDB. Measured on the real bytes.
**The whole-basin file stays** — offline (step 8) and near-home-since-1851
(step 9) both need every season at once.

**AND `seasons/data/` WAS EMPTY UNTIL THIS.** The monthly job had never run, so
there was no history in the repo at all and a board would have had nothing to
draw. Started by pushing the `seasons-hurdat` branch.

**==> THE SERVICE WORKER WAS ABOUT TO OVERRIDE THE `immutable` HEADER. FIXED
2026-08-24, BEFORE STEP 5 FETCHES ANYTHING. <==** `sw.js` routes every
same-origin GET, and `/seasons/data/` was on none of its lists — so it fell into
`networkFirst()`, which fetches `cache: 'no-cache'` and would have forced a
revalidation round trip on files `_headers` declares immutable for a year, then
stored a copy of each. It is now cache-first alongside `/vendor/`, which also
means the archive works offline. **The precache list was checked first and is
clean** — three entries, no history, so nobody downloads 22 MB at install.

`.txt` went into `typeMatchesUrl()` in the same commit and that is not a tidy-up:
cache-first turns a transient 404 into a permanent one, and a season file
replaced by Cloudflare's `index.html` fallback throws no MIME error — the
archive would just look empty. `tools/test-sw-routing.mjs` is new, runs the real
`sw.js` in a VM, and was verified by breaking each of the four rules in turn.
**A NEW CACHE-FIRST PATH NEEDS A SAMPLE FILENAME IN THAT SUITE**; it fails on
purpose until one is added.

**==> AND THE DEEP LINK'S YEAR CHECK HAD BEEN INERT SINCE STEP 4. FIXED
2026-08-24. <==** `seasons/deep-link.js` read `SEASONS.firstSeason`,
`seasonLinkFutureYears` and `deepLinkMaxStorms`; **none of the three was ever
added to the constants block.** `year < undefined` is false and `year >
undefined` is false, so every comparison passed and the range check did
nothing — `?season=1066` was accepted, resolved to a season with no storms, and
opened the archive on an empty globe saying nothing. A year outside the record
and a quiet season looked identical, which is the one distinction §57.20's
words exist to make. The three constants are now in, measured (`AL011851` is
the first header row of the Atlantic file, so the floor is 1851) and each was
verified by removing it again and watching the suite go red.

**THE SPEC WAS RIGHT AND THE CODE WAS WRONG**, which is the rarer direction:
§57.20 described this validation correctly all along, so nothing there needed
changing. **`check-syntax.mjs` CANNOT CATCH THIS CLASS OF BUG** — it proves an
import resolves, and `SEASONS` imported fine; it was the PROPERTIES that were
absent. Only `tools/test-archive-mode.mjs` named it, and it had been red on
main since step 4 shipped. Worth a look at whether other constants blocks have
readers ahead of them.

**THE STEP 1 COLOUR COLLISION IS ANSWERED. AARON, 2026-08-24: THE SEPIA LOOKS
FINE.** §57.20 measured the coastline at 38° against the Cat 2 dot at 39° and
the question was whether a storm would sink into the ground. Judged against
step 5a's real tracks on the real globe, it does not. **Do not reopen it
without new evidence, and do not reopen it off `mockups/seasons-themes.html`**
— that is a paint chip, and §57.31 item 1 already rejected the comparison.

**A NEW FILE UNDER `seasons/` NEEDS A LINE IN `_headers` BY HAND**, and nothing
catches the omission. That directory holds both NOAA's immutable history and
application code, so the code files are listed one by one — §57.16a says why a
wildcard was not used.

**AND ONE QUESTION LEFT DELIBERATELY UNANSWERED.** Whether JTWC publishes live
ATCF b-decks during a season the way NHC does. If it does, the rest-of-world
capture gets a better source than our own relay output. Nothing in the sandbox
can reach either host to find out, so nothing was assumed — it is a small
addition to the next probe run.

**==> TWO SPEC SECTIONS WERE WRONG AND REAL BYTES SAID SO. <==**

- **§57.35 FIX 11 said the SEASON in the filename is the cache bust.** It is
  not sufficient: NOAA revises seasons it has already published, and the real
  directory carries **five revisions of the 2022 Atlantic file** in two
  different date widths. Season-only naming points all five at one `immutable`
  URL, so a browser holding April's copy never sees May's correction. The
  revision stamp is now in the filename too.
- **§57.30 step 3b said graduation is "one commit" somebody makes by hand.**
  Once the monthly refresh exists there is no such commit: February's file
  lands on its own and `index.json` gains the season. The only manual step left
  is squashing `seasons-live`, which is already a button.

**AND ONE TEST OF MINE PASSED WITH THE CODE BROKEN.** Seven mutations were run
against `tools/seasons-hurdat.mjs` and six turned it red. The seventh — deleting
the rule that an unreadable revision stamp is DROPPED rather than ranked zero —
stayed green, which is the failure §12 calls worse than no test. The missing
assertion is in, and the mutation was re-run to confirm it now bites.

**ONE THING TO WATCH RATHER THAN A TASK.** `seasons-live` is a push to a
non-production branch every hour it captures something, and a Pages project can
be configured to build previews for those — §57.33 limit 2 caps builds at 500 a
month. The evidence says ours does not: `archive` has been force-pushed hourly
for weeks against the same cap. **That is evidence, not proof.** If the build
count starts climbing, the fix is the Pages project's branch-control setting.

**AND ONE QUESTION LEFT DELIBERATELY UNANSWERED.** Whether JTWC publishes live
ATCF b-decks during a season the way NHC does. If it does, the rest-of-world
capture gets a better source than our own relay output. Nothing in the sandbox
can reach either host to find out, so nothing was assumed — it is a small
addition to the next probe run.

**STEP 2 LANDED AND THERE IS NOTHING FOR AARON TO LOOK AT.** The parser, the
derived facts and the near-home index are in `lib/hurdat.js`,
`lib/season-facts.js` and `lib/near-home.js`; what they ARE is in §57.30 step 2
and the sections it cites. **Nothing imports them yet**, so no pixel changed
and there is no phone test to do — the first surface is step 4's shell. That is
deliberate and it is the exception to this project's usual rule, not a lapse.

**==> IT CORRECTED FOUR SPEC SECTIONS, ALL FOUND BY REAL BYTES DISAGREEING
WITH REMEMBERED ONES. <==** Read the sections, not this list — but know they
moved: **§57.4a** had three ATCF field positions off by one (the status column
was documented as the wind threshold). **§57.5** listed seven record
identifiers; the file carries nine. **§57.6**'s cliffs are generalities, not
rules — an 1852 storm carries a radius of maximum wind, 169 years before the
stated cliff, so nothing in the parser gates on a year. **§57.7**'s landfall
hole is **1971–1982, not 1971–1990**; Hugo '89 is marked and the hole is
twelve Atlantic years, counted per year across the whole file. The work to
compute those landfalls ourselves still stands at half the scope.

**AND §57.19 WAS OVERSTATING ITS OWN CASE.** It said `lib/shape-distance.js`
already had line-to-point distance; it does not, it measures to the nearest
VERTEX and says so in its own comment. It also implied the points-only answer
is wrong by a lot. Measured, the two differ by 2 to 25 nautical miles — but
the gap moves a storm across the reader's chosen radius in 4 of 54 city-and-
radius combinations, **and one of them is Katrina at 30 miles from New
Orleans**. The size was wrong; the reason to do it was right, and worse than
stated.

**STEP 1 STILL HAS NOT BEEN SEEN, AND STEP 2 DID NOT CHANGE THAT.** The sepia palette, the forced mode and
the round-trip guarantee are in `SPEC-MAP.md` §9 — read that, not this. A2 was
never built; §57.31 item 1 records why. **Nothing calls `forceMode()` yet**, so
there is no globe wearing it: `mockups/seasons-themes.html` mirrors the shipped
values and is the only place to look before step 4's shell. Keep the two in step.

**STEP 0 IS DONE AND ITS FINDINGS ARE IN §57.4, §57.4a, §57.9 AND §57.33** —
measured on real bytes, replacing the assumptions. Read those, not this. The
probe is `tools/seasons-probe.mjs`; raw bytes are on `seasons-probe-results`.
**Its first run answered two of four questions wrongly and both faults were in
the probe** — §57.30 step 0 records how, and it is the reason to distrust a
green probe nobody has audited.

**THE SHELF AND TIER 2 ARE NOW TWO DIFFERENT DECISIONS (§57.17, §57.17a).**
Aaron, 2026-08-24. The shelf is **every retired name plus §57.14's alias list**
— a rule, not a curation session — and it points at track data we already hold
for every storm since 1851. Tier 2 is the handful whose whole night is captured.
**Andrew '92 is the case that proves the split:** a headline shelf storm that
can never be Tier 2, because text advisories stop at 1998. The retired-names
list is HAND-MAINTAINED, ~120 rows, +1-2 a year — NHC publishes it as a web
page and **a scraper is explicitly rejected**, because a restyle would silently
empty the shelf.

**NOTHING IN TIER 2 GETS TRIMMED EXCEPT COORDINATE PRECISION.** Measured off
Ida: 7.7 MB, and the words are 4% of it — every advisory NHC wrote is 0.34 MB
against 6.8 MB of shapes. The forecast stays in full because it is the reason
the feature exists. What made that affordable is **each Tier 2 storm being its
own download** rather than riding along with its basin (§57.24).

**TWO FINDINGS REACH FORWARD AND ARE WORTH KNOWING NOW.** ATCF puts **one line
per wind threshold**, so up to three lines share a timestamp and a parser keyed
on time must MERGE rather than overwrite — silently keeping one threshold and
discarding the rest is the failure, and no storm under 50 kt can show it. And
**the archive has three cliffs, not one**: b-decks 1958, text advisories 1998,
GIS geometry 2008. That rules **Andrew '92 out of Tier 2 entirely** and puts
**Katrina '05 in a middle band with words but no cone** — step 11's problem,
but it changes what step 11 can be offered.

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

**§48.21's LAYER HAS NOW BEEN JUDGED ON GLASS IN FULL** — polygons, chips,
clustering, tapping and the detail panel. See the flood entry below for what it
is and the one fault glass found.


**==> §48.21 IS DONE. THE FLOOD FEATURE SHIPPED IN SIX PASSES AND EVERY ONE WAS
CONFIRMED ON A PHONE. <==** 2026-08-22 to 2026-08-23. What it IS lives in
`SPEC-FLOOD-PLAN.md` §56 and `SPEC-UI.md` §48.21 — read those before touching
anything flood-shaped. **The narrative that used to sit here is deleted per this
file's own rule: an item that lands leaves, and the spec describes what is.**

**FOUR THINGS ARE STILL OPEN, AND ONLY FOUR.**

1. **==> THE LAYER DRAWS NOTHING OUTSIDE THE UNITED STATES, AND THE GDACS ROAD
   IS ALL BUT CLOSED. <==** NWS is a US agency, so a reader watching a typhoon
   turns the switch on and gets an empty globe. The switch says `US only`,
   which stops it reading as a fault and does not stop it being a hole.

   **THE PROBE HAS BEEN READ — 2026-08-23, and §56.19 carries the numbers.**
   130 KB, 100 rows, and the answer is no: **100 of 100 are a single point**,
   not a polygon. `severity` is 0 on every row. The row count is **exactly the
   100-row cap** that lost Noul in July, so the volume question cannot even be
   asked of this feed, and only 10 of the 100 are current. Worse than the
   missing geometry: every row is a **GLOFAS river state running 1 to 95 days**
   — a basin high for a season, not water this storm put on the ground.

   **ONE CHEAP THREAD IS UNCUT:** each row carries a `url.geometry` on the same
   `polygons/getgeometry` endpoint this app already fetches cyclone shapes
   from, and `functions/api/gdacs/geometry.js` would accept it unchanged.
   Nobody has pulled one. **But a polygon around a three-month river state is
   still not a claim this app can put beside a storm**, so even a yes there
   does not reopen it alone.

   **THE LIKELY END STATE IS WORDING, NOT SHAPES**, and §56.19 already says an
   empty globe with an honest note beats a drawn guess. A fuller sentence on
   that switch than `US only` is the cheapest real improvement here.

2. **STILL NO PERF BASELINE, AND IT IS ONE CI RUN AWAY.** `tools/perf-select.mjs`
   exists and runs in CI's `browser` job, `continue-on-error: true` with every
   budget `null` — because **a check nobody has seen pass does not get to block a
   deploy**, and it was written in a sandbox that cannot execute it. **NEXT
   ACTION: watch it print stable numbers over a few runs, fill
   `tools/perf-budgets.json`, then drop `continue-on-error`.** Until then there
   is no baseline, only a tool that can take one.

3. **`count('area_select')` HAS NEVER BEEN RECORDED.** The call site in
   `app/views.js` asks for it; `lib/usage.js` ACTIONS does not list it, and
   `count()` drops an unlisted name in silence — the exact bug that file's own
   comment records happening to the Environment retry. **NOT a one-line fix**:
   ACTIONS names are D1 columns, so restoring it means an `ALTER TABLE` on
   `sessions`. Every tap on a watched area since §45 is counted as nothing.

4. **`tools/test-genesis.mjs` HANGS RATHER THAN FAILS.** It stops after the
   section headed *a broken NHC half is an OUTAGE, never an empty sky*, where
   `fetchGenesis` is driven with every relay hop throwing, and never returns.
   Killed at 130 s. **Confirmed pre-existing** — it hangs identically with the
   flood work reverted. A suite that hangs is worse than a red one: it blocks
   whatever runs it and names nothing.

**==> AND ONE THING TO READ BEFORE ADDING ANY ROUTE THAT TAKES AN IDENTIFIER
FROM A QUERY STRING. <==** `functions/api/nws/alert.js` is the only route in this
app that builds an upstream URL out of client input. The id must match NWS's CAP
URN **anchored at both ends** or it is refused before any fetch — unanchored,
`https://evil.example/?ok=urn:oid:…` passes and the function fetches it with our
User-Agent from inside Cloudflare's network. Seven refusal cases are asserted and
the anchors are mutation-verified.

**THE RULE THE PHONE PASS ENFORCED IS NOT CLOSED EVEN THOUGH THE PASS IS.** If a
future flood pass makes a selection, a chevron or a switch feel worse than
today's build, **revert the whole thing rather than patching it**. That is the
rule the first attempt broke, and the reason this one landed in six separable
pushes — the one fault glass found (a tapped cluster staying painted for the
whole flight) was fixed as one small change against a known-good base rather
than a bisect through 2,523 lines.


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

**RAIN ALREADY ON THE GROUND AT THE HOUSE — needs rain at Aaron's address.**
`SPEC-FLOOD-PLAN.md` §56.14. Phase 6 shipped 2026-08-23 and **no reader has
seen the sentence.** The `Flooding` section now says *"About 3.1 in of rain is
estimated to have fallen at your address in the last 48 hours"*, between the
alert rows and the modelled coastal figure — what IS happening, then what HAS,
then what MIGHT.

Four things to judge when weather arrives, and the first is the only one that
is not cosmetic:

1. **Does it read as an estimate or as a measurement?** The line under it says
   estimated by a global model, not measured at a nearby gauge. §56.14 names
   this as the single most likely thing in the feature to get wrong, **because
   a wrong version carries the identical number** and nothing on the page
   invites a second look.
2. **Is 48 hours the right window?** `RAIN.pastHours` is a placeholder, not a
   measurement — one line to move. Too short and it misses the front that
   soaked the ground before the storm; too long and it stops being about this
   weather.
3. **Does it earn its line on a calm day?** It renders with no storm on screen,
   like the rows, because it is a fact about a place rather than about a storm.
   That may be useful or may be clutter on the screen's quietest state.
4. **On an American house, two numbers on one screen now have two different
   authors** — the forecast from NWS, this from Open-Meteo, because NWS
   publishes no matching observed series. Deliberate, and disclosed rather than
   hidden. Does the disclosure read as precision or as confusion?

**THE TWO COVERAGE PROBES ARE NOT A GLASS CALL AND SHOULD BE READ FIRST.**
`git show origin/archive:latest/openmeteo-rain-past-ocean.json` and
`…-past-desert.json`. Everything about `past_days` was measured at Manila —
tropical, coastal, on land, raining. **Nothing has confirmed the past half of
this model covers ocean or sparse land the way the forecast half does.** The
Sahara is the sharper of the two: land, so it cannot be declined for being sea,
and genuinely dry, which makes it the hardest place on Earth to tell a real
`dry` from a `no data`. That distinction is §5.

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

