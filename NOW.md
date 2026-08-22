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
> This file came down from 510. What is left is mostly `HELD FOR WEATHER` and
> `KNOWN AND ACCEPTED`, and both grow with the APP rather than with neglect — a
> bigger app has more built-but-unwitnessed surfaces and more settled questions
> worth not re-asking. If it climbs again, the lever is structural rather than
> editorial: move `KNOWN AND ACCEPTED` into SPEC.md as a SETTLED section. That
> has been left alone because its whole job is stopping a session re-asking a
> closed question, and it only does that job if it is read at session start.
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

**==> THE ARCHIVE WAS DEAD FOR THIRTEEN HOURS AND NOTHING SAID SO. FIXED,
NEEDS A RUN. <==** `SPEC-OPS.md` §18.3.

Eleven consecutive scheduled runs failed at the `rebuild the archive branch`
step, 01:41Z through 12:53Z on 2026-08-22. Last good run: 23:30Z. The cause was
a3fb3b4's new `adeck/` folder meeting a HARDCODED list of the three directories
`archive.yml` knew to skip before a plain `cp` — a comment directly above the
list warned that a directory would exit 1 and take the job with it under
`set -e`, and that is exactly what happened. The list is gone; the workflow asks
the filesystem now, and one loop rebuilds every directory instead of three named
blocks. Reproduced locally against a fixture tree, old step fails and new step
passes on the same fixture.

**==> AARON, ONE THING TO DO: PRESS RUN ON THE `archive` WORKFLOW. <==**
github.com → Actions → archive → Run workflow. The PAT cannot dispatch (§48.13,
403), so this is the one hands-on step. Otherwise it self-heals at the top of
the next hour. **Until a run lands, everything under `archive:latest/` is
stamped 2026-08-21T23:30:41Z and is four advisories out of date — do not measure
anything against it.**

**LALA'S TRACK STILL HAS A KINK IN IT, AND BUG 3 IS STILL BLOCKED.** Aaron on
glass 2026-08-22 07:53, screenshot 4953: the past track doubles back near the
current dot on Lala. Not diagnosed — there are no current bytes to diagnose it
from. **Do not chase it against the 23:30Z archive**; that capture is the one
§7.11 and §7.13 were already built from, and it will reproduce yesterday's fault
rather than today's. Start it after a fresh run lands.

**THE WIND SWATH WAS DRAWN 130 nm FROM WHERE NHC DREW IT. FIXED, NOT YET
CONFIRMED ON GLASS.** `SPEC-MAP.md` §7.13,
`tools/test-windswath-centre.mjs` (30 assertions, 5 mutations verified).

NHC serves the 5-day forecast POINTS and the forecast wind RADII as separate
ArcGIS layers on separate publish cycles. The swath took the quadrant numbers
from the radii and the centres from the points, joined on `tau` — which assumes
they are the same advisory. **On 2026-08-21 Moke's points were advisory 4
published 09:13Z and her radii advisory 6 published 21:12Z: twelve hours and two
advisories apart.** Every band sat 108–151 nm east-southeast of the truth. A
wind ring states its own centre twice over through its bounding box and its four
published radii, so it is placed there now, with its own `validtime` as its hour.
Measured across every archived ring on both storms, the two solves agree to
within 0.55 nm.

**==> AARON: WHAT TO LOOK FOR ON THE PHONE. <==** The green 34 kt band should
now start ON the storm rather than trailing behind and to the right of it, and
should reach the full length of the forecast. The orange 50 kt band on Moke
moved about 140 miles west. Lala should look **identical** — her two products
already agreed, and that is the point.

**==> THE BIGGER PROBLEM IS NOT FIXED AND IT IS AARON'S DECISION. <==** The
cone, forecast track and forecast points are still whatever advisory NHC's
layers happen to be serving, and §7.11 re-anchors that geometry onto the current
fix. On Moke that drags a twelve-hour-old cone forward and rounds off the cut
end with a half-ellipse no source published — **that is the purple lobe, and it
is why last session's cap clamp made it smaller instead of gone.** The choice:
keep re-anchoring and go on drawing a shape NHC never issued, or draw the
forecast where NHC drew it and stamp it honestly as stale, accepting that the
forecast line will visibly not start at the storm dot. **Not started. Waiting on
Aaron.**

**EIGHTEEN'S PAST TRACK — CONFIRMED ON GLASS BY AARON. Closed.** The mechanism
is in `spec-parameter.md` §32.6. Do not reopen.

**THE ARCHIVE CAPTURED LAYER 11 AND CAPTURED NO DECKS, AND THE REASON WAS OURS.**
`latest/geometry/nhc-*-pastTrack.geojson` arrived as expected. `latest/adeck/`
did not exist at all — not "no decks this hour", no folder. The a-deck phase
landed without its `mkdirSync` line, so the first deck write threw `ENOENT`
every hour, the phase's own try/catch swallowed it, and the manifest read
`68/69 sources ok`. Both halves fixed: the folder, and every derived catch now
records `{phase, reason}` into `derivedFailures` in the manifest.
`tools/test-archive-dirs.mjs` guards both, mutation-verified. §18.3.
**Check `latest/adeck/` and the manifest's `derivedFailures` after the next
hourly run** — the sandbox cannot dispatch it.

**==> AN EMPTY `latest/adeck/` IS NOT YET A FINDING, AND ONE SESSION ALREADY
READ IT AS ONE. <==** Checked 2026-08-22: the newest archive run is 23:30Z and
the folder fix shipped at 00:27Z, so no run has carried it. The archive branch
is force-pushed as one commit, so there is no earlier run to compare against
either. It only becomes a finding if it is still empty after a run stamped
LATER than the commit that fixed it — check `fetchedAt` in the manifest, not the
wall clock.

**BUG 3 (model tracks not starting at the current-position dot) IS STILL
BLOCKED UNTIL THAT RUN.** No deck bytes, nothing to read, do not start it.

**THE PAST TRACK DOUBLING BACK — CONFIRMED ON GLASS BY AARON. Closed.**
Deployed at bed43ba, checked on the phone 2026-08-22: past and forecast tracks
both draw correctly on Lala and Moke. The mechanism is `SPEC-MAP.md` §7.11 and
§7.4. Do not reopen. What follows is the diagnosis, kept until the next session
reads it once. 2026-08-22. Aaron, on the a3fb3b4 build: the dotted past track still ran past
the white ring and stopped near the SECOND forecast dot, model guidance off.

**His read was right and it broke the case open.** There IS a point next to that
dot — the storm's real 18Z fix at 28.1N 170.7W. NHC's tau-12 dot is 28.1N
171.3W. Near twins.

**The line was not stopping there. It was turning around there.** Reproduced
from archived bytes with the forecast fully present: the record climbs to 28.1N
and doubles back 83 miles to the ring at 26.9N. The two legs lie half a degree
apart, so it reads as one line that overshot.

**==> LAST SESSION'S AMBIENT-BUNDLE THEORY IS DEAD. DO NOT RUN THE TAP TEST. <==**
That measurement checked where the line ENDS (the ring — correct) and never
checked where it GOES. It reproduces with both slots present.

**The cause is three clocks.** Feed: advisory 038, 21:00Z, 28.6N. Record:
published 21:04Z, newest fix 18:00Z at 28.1N. Forecast: advisory 36A, published
12:02Z, tau-0 valid 09:00Z at 26.9N. **A forecast's first dot is never "now" —
it is the analysis hour**, and the white ring is drawn on it, so the ring sat
117 miles behind the storm. The forecast was not WRONG: its tau-12 named 28.1N
at 18Z and the record independently put the storm there at 18Z. That hour
verified. It had been overtaken, not falsified.

**The fix:** `lib/forecast-now.js` drops leading forecast hours that have already
passed and puts one tau-0 on the feed's real position; the record and the
forecast line both join there. The record is NEVER trimmed — cutting it back to
fit a stale forecast would delete two verified positions to tidy a line.
`SPEC-MAP.md` §7.11, `FORECAST_NOW`, `tools/test-forecast-now.mjs`, six
mutations verified. Confirmed on Lala AND Moke: overshoot 1.20° and 0.70° both
to 0.00°.

**CONFIRMED ON GLASS.** The dotted past track runs forward into the white ring
and stops; the ring sits on the storm; nothing doubles back.

**THE OVERTAKEN-FORECAST CONSOLE LINE SHOULD NOW BE SILENT.** It fired on every
NHC storm before this. If you still see "the past track has most likely
overtaken a stale forecast" after this deploys, the re-anchor bailed on a guard
and the console will say which one — that is a finding, not noise.

**A SEGMENT PUBLISHED TWICE — separate fault, fixed 2026-08-21, still valid.**
Layer 11 sent the final past-track leg twice on both storms (`objectid` 742/743,
745/746); `runsFrom` drops a repeated run. `TRACK_LINE.orientGapRatio` from the
same pass also stays — it is the backstop for a hairpin the re-anchor cannot
remove. SPEC-MAP.md §7.4.

**THE WIND SWATH'S FINS — ROOT CAUSE FOUND, FIXED, NEEDS GLASS.** 2026-08-22.
Aaron zoomed in on Lala: the bands carried fins, spurs and slivers instead of
reading as continuous corridors. **One symptom, two causes, proven separate.**

- **The timeline folded back.** The swath lays centres out past -> current ->
  forecast by tau, and dropped forecast tau 0 before splicing because the
  analysis hour sits behind the storm. That reasoning was right and the list was
  one entry long: on a nine-hour-stale advisory **tau 12 is behind the storm
  too**. The spine ran current 28.6N -> tau-12 28.1N -> tau-24 29.8N. Half a
  degree backwards against a corridor 130-160 nm wide, and both walls crossed.
  Every expired hour is dropped now, on the centre's own clock, with the old
  tau-0 rule kept as the fallback when no clock is readable.
- **The offset walls crossed themselves.** Offset a curve inward past its own
  radius of curvature and it self-intersects over tens of vertices at honest
  spacing with gentle turns — every local test passes, and the existing despike
  only sees hairlines. Measured on Lala's recurve: 34 kt crossed 3 times (loops
  of 90, 41, 25 vertices), 50 kt 3 times, one 64 kt run once. A spatial grid
  finds the crossing; the larger piece by area survives.

**==> A SELF-INTERSECTING BAND WAS NOT JUST UGLY, IT WAS PUNCHING HOLES. <==**
Fill treats the doubled-over region as outside. Cutting the loops raised
published-wind coverage from 77.8% to 78.8% while area FELL 0.85%.

`SPEC-MAP.md` §7.12, `WIND_SWEEP.maxLoopCuts`,
`tools/test-windswath-folds.mjs`, five mutations verified. Fixtures are real
archived bytes; the past wind field is deliberately excluded as a megabyte that
the fault reproduces without.

**WHAT TO LOOK AT ON GLASS:** zoom into Lala or any recurving storm. Each wind
band should read as ONE continuous blob — no slivers crossing it, no triangular
fins hanging off it, no thin spurs. Green, orange and red should nest inside
each other cleanly.

**IF YOU SEE THE CONSOLE SAY "a band still crosses itself after 8 loop cuts",
that is a finding.** It means a shape nobody has measured. The band is drawn
anyway rather than dropped.

**KNOWN AND NOT CHASED, so it is not rediscovered as a bug:** sampled at their
exact published radius, 78.8% of Lala's wind-rose boundary points and 65.1% of
Moke's fall inside the drawn band; at 0.8x radius, 95.8% and 76.2%. That is the
documented smoothing shrink plus §5's run-break rule refusing to sweep across a
time NHC published no ring for. Both deliberate.

**THE CONE DRAWING OFF OLD DATA — FIXED, NEEDS GLASS.** 2026-08-22. Aaron on
the phone: the cone was not aligning with the storm's current position. **He was
right.** The app was drawing NHC's PUBLISHED outline, whose apex sits at the
stale analysis position — advisory 36A's tip at 26.65N against the storm at
28.60N, **135 miles behind**.

**We only saw the published shape because the §7.9 rebuild was declining.** Two
reasons, and one of them was mine:

- **The walls folded, and that was the wrong question.** The old guard refused
  whenever an edge stepped backwards against the track. The harm is a RING that
  crosses itself. Measured: Lala's flanks fold and her assembled ring does NOT
  cross. The ring is asked directly now and any loop is cut (`lib/unloop.js`,
  extracted because §7.12's wind swath is the other caller).
- **==> THE UNDERCUT GUARD BROKE WHEN §7.11 MOVED THE TRACK'S START, AND THAT
  WAS MY REGRESSION. <==** A cone redrawn along a track starting at the storm
  cannot cover the published cone's tail: **1.62 deg undercut against a 1.27
  allowance**, where before the re-anchor it was 0.12. The guard now asks its
  question only where the track actually goes, skipping published vertices
  behind the first station.

**THE COST IS ACCEPTED (Aaron, 2026-08-22):** the drawn cone is SMALLER than
NHC's, by whatever the feed is ahead of the advisory. What is dropped is
uncertainty about hours that already happened. `CONE_SWEEP.minAheadFrac` is the
backstop — under half the cone ahead of the storm and it falls back to the
published outline rather than presenting a sliver as the whole forecast.

**THE SIDE EFFECT IS BIGGER THAN THE CONE.** The fold veto was refusing **12 of
Ida's 35 advisories**, and every refusal put §47.5's environment ribbon on the
fallback path. **All 35 rebuild now.** That is the ribbon Aaron watched come and
go on Lala, 2026-08-18.

Measured on Lala: cone apex moves from 135 miles behind the storm to 33, which
is its own rounded start cap. `SPEC-MAP.md` §7.9, `CONE_SWEEP.minAheadFrac` /
`maxLoopCuts`.

**WHAT TO LOOK AT ON GLASS:** the cone's narrow tail should start AT the white
ring with a rounded nose, not hook down past it. And the environment ribbon
should stay put on a recurving storm instead of vanishing and returning.

**TWO SUITES CHANGED SHAPE AND THAT IS NOT A REGRESSION.**
`tools/test-cone-sweep.mjs` and `test-cone-smooth.mjs` both hunted the Ida corpus
for a naturally-declining advisory. There are none left. Both had warned in
their own comments that a change accepting everything would leave them testing
nothing; the refusal is now CONSTRUCTED (a track trimmed to its last 30% trips
`minAheadFrac`) rather than found.

**MOKE'S PURPLE LOBE — FIXED, NEEDS GLASS.** 2026-08-22. Aaron, twice: a big
purple blob hanging east and south of Moke, outside the cone it belonged to.

**It was the cone's TAIL CAP, and it was my own knock-on from §7.11.** Each cap's
length comes from a ray cast out of the cone until it leaves the published
outline. Right while the track began at tau 0 — the published apex. §7.11 moved
the first station onto the STORM, which sits inside the cone ahead of its stale
apex, so the backward ray started running the whole length of the advisory's
leftover tail and the cap ballooned to fit.

Measured, each cap's reach against the flank it caps:

```
Lala  tail 0.48 / 0.52 = 0.91x     nose 2.35 / 2.33 = 1.01x
Moke  tail 1.56 / 0.64 = 2.43x     nose 2.32 / 2.26 = 1.03x
```

Three of four agree within a tenth — the end of a corridor of half-width w IS a
cap of radius about w. The outlier was measuring something else. The flank is a
CEILING on the tail now. **The nose is deliberately NOT clamped**: the last
station is still the published cone's own day-5 nose, so its ray is right.

**==> THE RIBBON WAS THE MESSENGER, NOT THE FAULT. <==** §47.5 paints the caps,
so on Moke it put confident environment colour over 112 miles of water she had
already crossed. The wrong shape had been there all along; painting it is what
made it obvious. `lib/cone-ribbon.js`'s comment "the tail cap sits behind the
current position" had gone from description to bug without anyone touching it —
corrected in place.

**Moke's cone BODY is not too wide.** Checked and dropped: NHC published it 24
degrees of longitude across. Real data.

`SPEC-MAP.md` §7.9, `samples/moke-cp032026/`, `tools/test-cone-cap.mjs`, four
mutations verified. Moke's cap bounding box 2.22 -> 0.96 sq deg; Lala unchanged.

**==> LALA'S BYTES CANNOT REPRODUCE THIS, WHICH IS WHY MOKE HAS HER OWN CORPUS.
<==** A suite built on Lala alone passes before AND after the fix. Verified by
doing it. Same trap as `test-cone-anchor.mjs`.

**WHAT TO LOOK AT ON GLASS:** Moke, zoomed in. The cone should end in a small
rounded cap at the storm, not a lobe hanging behind it. The environment ribbon
should stop at the storm. Lala should look exactly as she did.

**THE PERF AUDIT WENT GREEN HAVING MEASURED NOTHING, TWICE OVER.** Two runs
2026-08-21. The 21:11 run crashed at exit 2, wrote no JSON, and every step after
it no-opped by design — artifact warned, branch push hit its `test -f || exit 0`,
budget grep found no `FAIL` in a stack trace. Green tick, zero data. The 21:38
run went red and DID write, so `perf-history` exists now with one file.
Both holes closed: the job fails when no measurement file exists, and the budget
fails outright when `styleLoaded` is false.

**==> DO NOT TRUST `colorNulls: 0` FROM THAT RUN — IT IS BUG 2's EVIDENCE AND IT
IS NOT IN HAND. <==** `tools/perf-instrument.mjs` counts colour-null errors by
patching `console.error` on the MAIN PAGE, and the errors come from MapLibre's
WORKER, which has its own global scope and its own console. A zero from an
instrument pointed at the wrong thread is not a zero. All three arms also
reported `styleLoaded: false`, which the audit's own report calls "map numbers
below are meaningless". **Bug 2 needs the instrument fixed before it needs
anything else.**

The run's real findings, worth keeping: `blockedMs 26490` against a 1200 budget,
`ourModules 179` against 175, and the radar arm at `loadMs 109802`.

**SAUDEL LOST ITS SAFFIR-SIMPSON GRADING ON TWO DEVICES AND KEPT IT ON A THIRD,
AND THAT IS STILL UNEXPLAINED.** 2026-08-21. Forecast track drew nine pink `HU`
pills on the phone and work PC #1; work PC #2, opened minutes later, drew the
graded dots correctly. Hard-close and reopen changed nothing on the two bad ones.

**Everything server-side was proven healthy, on real bytes, and is NOT the
cause:** JTWC has been issuing on schedule (warnings 10→14 across 18 archived
hours); the relay parser was run against the archived `wp1726web.txt` and returns
an 80 kt fix plus a nine-step ladder to 130 kt; `matchStormByName` resolves
`SAUDEL-26` → `SAUDEL`; the two join guards both pass — GDACS and JTWC publish
the *identical* position, so separation is 0 NM. Aaron's paste of the live
`/api/jtwc/storms` at 20:10Z carries SAUDEL with the fresh fix. **The relay is
fine. The break is on the device.**

**The remaining candidate is a per-datacentre difference.** The relay caches per
Cloudflare PoP. A PoP serving a `last-good` copy older than `JTWC_WIND.maxFixAge`
(12 h) makes every storm fail `fix_too_old`, silently, and fall back to the class
midpoint — which looks exactly like this. Untested: nothing in the sandbox can
reach the live app, and the one thing that would settle it is opening
`/api/jtwc/storms` **on a device that shows the bug** and reading `fetchedAt` and
the fix `at`. **WAITING ON AARON FOR THAT.** Do not write a fix before it.

**THE ARCHIVE NOW CAPTURES THE RELAY, NOT JUST THE UPSTREAMS.** The hour above
was spent proving things the archive should have answered in thirty seconds: it
held JTWC's raw products and not `/api/jtwc/storms`, and the app never reads a
navy.mil URL. Five relay routes added (`jtwc/storms`, `tcgp/storms`, `cap/alerts`,
`jtwc/abpw`, `jtwc/abio`), and `tools/relay-archive-check.mjs` now fails the push
when a route in `functions/api/` is neither archived nor excused in writing
(§18.3). Mutation-verified. **Check `archive:latest/relay-jtwc-storms.json`
exists after the next hourly run** — the runner is the only thing that can prove
these URLs answer, and the sandbox cannot dispatch it.

**A FORMATION ALERT NO LONGER BREAKS THE JTWC INDEX.** Found while chasing the
above. `/api/jtwc/storms` counted INVEST 91E as a listed product with no storm in
it, so `state` read `partial` — and `partial` withholds `jtwcRoster`, which is one
of the three ways a GDACS storm is allowed to die. One invest anywhere on Earth
disabled that for every storm, and in August there is nearly always one.
`isFormationAlert` counts them out; `formationAlerts` is published beside
`productsListed` (§5). `tools/test-jtwc-formation-alert.mjs`, 13 assertions on the
archived 91E bytes, mutation-verified. **Not the SAUDEL bug** — the join runs on
`partial` too.

**`data/surge.js` CALLS `/api/nhc/surge` AND THAT ROUTE DOES NOT EXIST.** Noticed
by the new gate. `functions/api/nhc/` has no `surge.js`; `lib/surge-locations.js`
already says so in a comment. Every NHC surge request is a 404 today. Not touched
this pass — see HELD FOR WEATHER.

**THE TELEMETRY PULL NOW ASKS WHERE VISITORS COME FROM, AND THE NEXT HOURLY
ARCHIVE RUN IS THE PROOF.** Three queries added to the D1 pull on 2026-08-20 —
`daily-devices` (people, not just visits), `referrers`, `referrers-daily` (§18.6).
The SQL moved out to `tools/telemetry-queries.mjs` so it could be tested; the
guards inside it are now enforced by `tools/test-telemetry-queries.mjs`,
mutation-verified against four separate breakages.

**Verified against a stub, NOT against Cloudflare** — api.cloudflare.com is
blocked from the sandbox, so the loop ran end to end with canned rows and wrote
all three files, but no real SQL has touched D1. A query whose column name is
wrong fails at the runner, not here. **Check `archive:latest/telemetry/manifest.json`
after the next run: all three should read `ok`.** If one says `unavailable`, the
reason is in that same entry and the fix is the SQL in the queries module.

The question that prompted it: a link went on tigerdroppings.com on 2026-08-20
and the archive could say visits doubled (34 → 76) but not say why. There is a
15-session burst in the 13:00–14:00 UTC hour against a 2–3/hr background, which
is the right shape, but attribution was not in any archived query. It will be
from the next run on.

**§48.10 IS STILL UNSETTLED, AND THE ONE THING THAT SETTLES IT IS AN NHC STORM
NEAR A HOME PIN.** The storm drawer's Rainfall section now holds NHC's area
range and the house's point total, one above the other, separated by a hairline,
with one line between them explaining why they can differ. **The question is
whether that reads as two answers or as the app contradicting itself.** Aaron
has seen the house block ALONE (GDACS storm, no range above it) and said it
looks good — that is §48.17 working, and it is NOT the §48.10 call. Needs an
Atlantic or Pacific storm with a rainfall paragraph, within
`APPROACH.relevanceNm` of the pin.

Two smaller things to glance at while there: a far-away typhoon should show NO
house block at all rather than a stray figure, and a live Flash Flood Warning
should appear at the TOP of the house block, in red, above the total.

**THREE GLASS CALLS ON RADAR, AND ALL OF THEM WORK ON `?replay=ida` — NO
WEATHER NEEDED.** Radar does not route through `ENDPOINT.relay`, so the replay
draws today's live radar over Ida's 2021 position: real US radar, right ground,
wrong storm, which is all these three need. Wave 6 replaced NOAA with
RainViewer and then replaced the disc with a tile layer; both are deployed.

**1. IS IT SHARP NOW?** Radar shipped as a per-storm disc first and Aaron's
verdict on glass was that it looked like ass. He was right and the cause was
structural: one 512 px image over a whole disc is 8.5 km/px at the widest
radius, against the 1.2 km/px RainViewer's own site draws at the same zoom, and
no amount of tuning reaches it. **It is a MapLibre raster tile layer now** —
the same mechanism as the basemap — so the clarity should match RainViewer's
site because it is what their site does. Compare `?replay=ida` against
RainViewer's own live radar map at the same zoom; they should now be
indistinguishable on detail.

**2. IS THE CLIP TIGHT ENOUGH, OR TOO TIGHT?** Radar is no longer global — it is
fetched only within 8° of the live storms, above zoom 3. **That was not a taste
call in the end: unbounded tiles on a globe made MapLibre request the whole world
pyramid and Cloudflare 429'd the origin, which took satellite down too.** §4.9
records it. What is left to judge is the padding: 8° is about 880 km, meant to
reach past the rainbands. If radar visibly stops short of weather you want to
see, that constant is the dial. With no storms tracked, radar draws nothing and
says so.

**3. THE PALETTE, still unjudged.** "Universal Blue" is the only scheme offered.
Sampled off real weather it runs cyan → blue → orange → red → magenta — the
spec's old "blue → yellow" was read off light rain and has been corrected. Two
collisions worth looking for: heavy-rain magenta against the Saffir-Simpson
cat-4 dot, and light-rain cyan against the coastline glow. The terms permit
recolouring if it needs to change.

**Anything that turns out to need weather goes to `HELD FOR WEATHER` with the
storm named — do not leave it here to make the section look busy.**

## NEXT UP

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

**THE CREDITS PANEL IS GATED NOW, AND IT CHANGES WHAT LANDING A FEED COSTS.**
`tools/test-attribution.mjs` fails unless every external host in
`config/constants.js`, `functions/` and `worker/` is accounted for in
`CREDIT_HOSTS`. **Wiring up a new feed turns the push red until somebody decides
whether it needs a credit** — that is the point, not a nuisance. Full reasoning,
and the three real gaps it found on day one, are as-built in `SPEC.md` under
Chrome, focus and third-party controls. Noted here only so the next session
meeting a red push knows what it is looking at.

**`no_ribs` IS TWO DIFFERENT FAILURES WEARING ONE SENTENCE, AND IT COST A
SESSION.** `lib/cone-ribbon.js` returns `no_ribs` both when the cone could not
be measured AND when `hoursAlong` cannot line the run up against the ribs —
different files, different fixes. `app/layer-status.js` says *"This cone could
not be measured"* for both. On 2026-08-20 that sentence was the only evidence
available from a phone, and it pointed at one of two files with no way to tell
which; the bug was found by pulling Lala's bytes off the archive instead.
**Split the reason and give the second one its own words.** Small, and the next
seam-shaped bug is unreadable without it.

**AND THE ARCHIVE ALREADY HAD THE BYTES.** `tools/archive-fetch.mjs`
`nhcTrackSources` captures NHC's cone, forecast track, forecast points, wind
swath and wind field per storm, hourly, under `latest/geometry/nhc-*`. Two
sessions in a row have gone looking for a way to reach NHC from the sandbox and
missed them. They are the reason the date-line bug was diagnosable at all.

**THE SAUDEL CONTRADICTION IS FIXED AND CONFIRMED ON GLASS — DO NOT RE-OPEN
IT.** Vitals said `Country  Japan` while the section below said no country was
listed; that was `lib/cap.js` reading `storm.countries` instead of
`storm.raw.countries` (§50.3). Confirmed 2026-08-20: Saudel now shows *"No
national weather agency in the affected countries currently has a tropical
cyclone alert in force."* — **the OTHER branch**, which is the proof the
country join is live. Japan simply has nothing out.

**AND THE PHILIPPINE ALERT IS NOT MISSING — IT IS ABOUT SOMETHING WE DO NOT
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

**THE `perf-history` BRANCH DOES NOT EXIST — NO RUN HAS EVER RECORDED.** The
nightly cron has not fired since the workflow landed. **Actions → perf-audit →
Run workflow** is the first thing to do, and it costs four minutes. Expect it to
go red: `colorNulls` is budgeted at 0. The JSON is written before the failure.

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

**0e. LALA'S PAST TRACK DOUBLED BACK — SOLVED, and the candidate was wrong.**
It was not stationary jitter at the start of the track. NHC published the FINAL
segment of layer 11 twice, identically, on both live storms; `stitch` chained
the copy reversed and the path folded at the tail. Fixed in `runsFrom`, see
`IN FLIGHT`. The archived bytes are `samples/lala-cp012026/past-track-038-doubled.geojson`.

**THE ELEVEN REPEATS ARE STILL OPEN and are a separate question.** The warning
fired eleven times in one load, which is about `smoothTracks` re-running per
push rather than per fetch. Nothing to do with why the track folded. The fold is
gone, so the count is no longer observable from that warning — measure it off
the new join warning instead, which fires from the same place.

**0f. MODEL TRACKS DO NOT START AT THE CURRENT-POSITION DOT.** Reported on glass
2026-08-21, on Lala and Two-C both: the dashed guidance lines converge at a
point clearly off the white dot. `clipBehind` in `lib/adeck.js` prepends the
storm's own position as an anchor vertex, so on paper this cannot happen, and
nothing has been proven.

**ONE MEASURED FACT WORTH KEEPING WHETHER OR NOT IT IS THE CAUSE.** At the same
instant, `CurrentStorms.json` carried Lala at advisory **038, 21:00Z, 28.6N**
while the MapServer geometry for the same storm was advisory **36A, 12:00Z,
26.9N** — two advisories and nine hours apart. The dot, the models and the cone
are not all reading from one clock. **THE DECKS ARE STILL NOT ARCHIVED** — see
`IN FLIGHT`; the phase was throwing `ENOENT` every hour. Blocked until the next
run after that fix deploys.

**AND THE CLOCK SKEW HAS NOW BEEN SEEN FROM A SECOND DIRECTION.** The same
mismatch made the past track overtake its own forecast and flip the seam
orientation (`IN FLIGHT`). Two symptoms, one cause, and it is bigger than an
adeck question: `TRACK_LINE.orientGapRatio`'s warning names every storm it
happens to, so the console now measures how widespread it is.

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

**A GDACS-basin storm near the house** — `SPEC-DATA.md` §51, `SPEC-UI.md` §51.6.
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

