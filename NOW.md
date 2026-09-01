# NOW.md — what's in flight

> **TRIM/AUDIT TRIGGER: 300 LINES.** Past that, this file gets a full read and a
> cut list before anything else is added. A trigger, not a ceiling — the point is
> a periodic honest audit, never compressing a finding on the day it was made.
>
> **WHY 300 AND NOT §12's 700.** A source file is navigated by jumping to the
> part you need; this one is read front to back at session start. Past roughly
> 300 lines that reading turns into searching, and searching only finds what you
> already knew to look for — exactly backwards for the file whose job is naming
> the things you DIDN'T know about.
>
> **==> NEVER NAME A STORM IN THIS FILE. <==** Aaron's call, 2026-09-01, and it
> is the rule the fourth cut existed to establish. A glass check needs something
> on screen, so entries kept reaching for whatever was live that week. **Storms
> die in about nine days and this file does not**, so every such entry rots into
> a note about a thing that no longer exists — and the 2026-09-01 audit found
> three separate items anchored to two storms that had been gone for a week.
> Name the CONDITION instead: "a storm near the house" is durable, "Lala's 34 kt
> band" is garbage by next Tuesday. `HELD FOR WEATHER` is written entirely in
> conditions for this reason.
>
> **==> AND A CORRECTNESS FIX WITH A PASSING TEST BEHIND IT IS DONE. <==** Same
> call, same day. A glass entry is only earned when the open question is about
> how something LOOKS — a colour, a wrap, whether a line reads as clutter. If it
> was measured against real bytes and the suite is green, it lands and leaves;
> it does not sit here waiting to be admired.
>
> **An item leaves in exactly two ways.** It **lands** — deleted here, one or two
> sentences added to the spec describing what *is*, not what happened. Or it
> **dies** — deleted, no tombstone.
>
> **Not a log** (no dates, no completed section — that is `git log`). **Not a
> decision tree** — an item needing several paragraphs is a spec entry wearing a
> TODO's clothes, so write it in the spec and leave a pointer. **Never a place to
> record a rule** — rules go in SPEC.md.
>
> **THIS FILE HAS BEEN CUT FOUR TIMES: 510, 978, then 1,839 down to here.** Every
> time, the bulk of it was landed work kept "until the next session reads it
> once," and every time that session never came. If you find yourself writing
> "kept for the next session," write it into the spec instead and delete it here.

---

## THE PLAN — pick one wave, do it, close it out

**Each wave is sized for ONE session.** Do not start two. When a wave lands,
delete it from here and put what it built in the spec.

**NO WAVE IS IN PROGRESS.** Nothing below is half-built. The next session picks
an item from `IN FLIGHT` or `NEXT UP`.

**How to reach the world from a sandbox that cannot: `SPEC-OPS.md` §18.**
**Do not reopen the single-source radar question** — §4.9 records the trade.

---

## IN FLIGHT

**Waiting on Aaron and nothing else. Anything gated on weather is below.**

**1. THE WALL'S 1971 ROW HAS NEVER BEEN LOOKED AT, AND IT IS THE ONE TO LOOK AT
HARDEST.** It sits top of `Came ashore` at 18 of 22 storms — the highest ratio
on the board — and it is one of the twelve years NOAA recorded nothing for, so
it is the row with no independent check. Its individual storms were read and
land in plausible places (Texas, Louisiana, Bermuda, Nova Scotia, Florida, the
Antilles), but plausible is not confirmed. §57.7a.

**2. THE FIRST FIX'S WIDE WHITE RING ON A SMALL DOT.** Noticed, never looked at.
A storm opening on a pre-genesis record gets a 6 px dot wearing a ring sized for
10, so it may read as direction or as a bullseye. **The lever is the stroke
width, not the radius**: `STORM_GEO.pointStrokeWidthFirst` is 3 against a normal
1.5. One archive storm, one look.

**3. THREE GLASS CALLS ON RADAR, ALL THREE ON `?replay=ida` — NO WEATHER
NEEDED.** Radar does not route through `ENDPOINT.relay`, so the replay draws
today's live radar over a 2021 position: real US radar, right ground, wrong
storm, which is all these need.

- **Is it sharp now?** It shipped as a per-storm disc and read badly — 8.5 km/px
  at the widest radius against RainViewer's own 1.2. It is a MapLibre raster
  tile layer now, the same mechanism as the basemap. Compare `?replay=ida`
  against RainViewer's own map at the same zoom; they should be
  indistinguishable on detail.
- **Is the clip tight enough, or too tight?** Radar is fetched only within 8° of
  live storms, above zoom 3. **The bound itself is not negotiable** — unbounded
  tiles made MapLibre request the whole world pyramid and Cloudflare 429'd the
  origin, taking satellite down with it (§4.9). What is open is the padding: 8°
  is ~880 km, meant to reach past the rainbands. That constant is the dial.
- **The palette.** "Universal Blue" is the only scheme offered; on real weather
  it runs cyan → blue → orange → red → magenta. Two collisions to look for:
  heavy-rain magenta against the Saffir-Simpson cat-4 dot, and light-rain cyan
  against the coastline glow. The terms permit recolouring.

**4. FOUR WORDING QUESTIONS ON THE ARCHIVE PANEL, NONE BLOCKING ANYTHING.**
§57.7c. Whether `Post-Trop` reads as plain English on a landfall row; whether a
paragraph carrying four full place names in one sentence earns its length
(§57.41); whether *"by then a post-tropical storm"* lands as explanation or as
hedging; and whether the Wall's `Came ashore` column reads honest or inflated in
the 1880s now that 92 storms moved into it.

---

## NEXT UP — real work, nothing blocking it

**THE SURGE COAST DIM HAS NEVER RUN, AND ITS TEST IS GREEN OVER IT.**
`dimCoast` in `map/layers/surge.js` reads `line-opacity` off `coast-glow` and
`coast-core` and wraps it as `['*', original, OPACITY.surgeCoastDim]`. That
opacity is a zoom interpolate, and MapLibre forbids a zoom expression anywhere
except the top level of a `step` or `interpolate` — so `setPaintProperty` throws
on every call and the coast never dims. Visible in the console at every boot.
**The fix is to scale the interpolate's OUTPUT stops rather than wrap the whole
expression.** `tools/test-surge.mjs` passes 1,515 assertions against this
because it drives `dimCoast` with a stub map that does not validate expressions.
**Make the test fail first; that half is worth more than the fix.**

**`count('area_select')` HAS NEVER BEEN RECORDED.** The call site is
`app/views.js:231`; `lib/usage.js` ACTIONS does not list it, and `count()` drops
an unlisted name in silence. **Not a one-line fix** — ACTIONS names are D1
columns, so restoring it means an `ALTER TABLE` on `sessions`. Every tap on a
watched area since §45 is counted as nothing.

**THE HOME TIMELINE COLOURS EVERY ROW BY THE STORM'S PRESENT NATURE.**
`ui/countdown-home.js` builds each row as
`categoryColor(row.category, dash.storm.nature)`, and `categoryColor` tests
nature FIRST and returns early. So the moment a storm goes post-tropical every
row in the timeline turns brick, and on a remnant every row turns the ungraded
teal — including the "at its strongest" row, which describes a moment when it
was neither. `lib/track-point.js` documents refusing exactly this; the timeline
does it. **Three call sites, lines 368, 408 and 488, all in that one file.**

**THE HOME DASHBOARD ANSWERS A US STORM ABOUT THE WRONG MODEL.** The storm
drawer's Flooding section carries NHC's own peak surge (`SPEC-UI` §56.8);
`ui/flooding-home.js` still answers the same storm with `MODEL_NOT_THIS_BASIN`
alone — "coastal flooding is not modelled in this basin". Not wrong for that
screen, which has no surge surface, but the two screens now say different things
about one storm, and §51.5's own reasoning is that NHC's forecast is the trusted
product where NHC publishes one. **The pieces exist**: `lib/surge-legend.js` is
pure and `ui/flood-words.js` holds the wording, so this is a wiring pass. The
only real question is where the home screen gets the slot from, since it has no
geometry bundle of its own.

**`no_ribs` IS TWO DIFFERENT FAILURES WEARING ONE SENTENCE, AND IT COST A
SESSION.** `lib/cone-ribbon.js` returns it both when the cone could not be
measured (line 438) AND when `hoursAlong` cannot line the run up against the
ribs (line 441) — different files, different fixes. `app/layer-status.js` says
*"This cone could not be measured"* for both, which from a phone points at one
of two files with no way to tell which. **Split the reason and give the second
one its own words.** Small, and the next seam-shaped bug is unreadable without
it.

**THE 3D CAGE TAKES NO CLOCK CUT.** §57.67h. `buildSeasonMeshPoints` and
`seasonGlyphs` in `main.js` ignore the season clock, so at the space floor a
ticked season shows mountains for storms the clock has not reached. Only visible
zoomed all the way out, so it may not be worth its own pass at all.

**THE COLOUR-NULL ERRORS ARE UNCOUNTED AND THE INSTRUMENT IS POINTED AT THE
WRONG THREAD.** `Could not parse color from value 'null'` fires from MapLibre's
expression evaluator about fifteen times per boot. `tools/perf-instrument.mjs`
counts them by patching `console.error` on the MAIN page; all but one line comes
from the MapLibre WORKER blob, which has its own global scope and its own
console. **A zero from that instrument is not a zero** — it reported
`colorNulls: 0` and that number is worthless. **Fix the instrument before
reading another zero off it**, or fail the metric honestly as unmeasurable.

*Already ruled out, so nobody re-walks it:* all twelve `['get', <colour>]` paint
properties in `map/` were traced to their feature producers and every one has a
real fallback. The remaining signal is that it fires from the worker, which
points at the basemap style rather than at our storm layers.

**STILL NO PERF BASELINE, AND IT IS ONE CI RUN AWAY.** `tools/perf-select.mjs`
runs in CI's `browser` job, `continue-on-error: true`, with every budget in
`tools/perf-budgets.json` still `null` — because a check nobody has seen pass
does not get to block a deploy. **NEXT ACTION: watch it print stable numbers
over a few runs, fill the budgets, then drop `continue-on-error`.** The sandbox
cannot dispatch the workflow.

**RADAR CAN REPORT A TRUE FRAME TIME AND THROWS IT AWAY.**
`/api/imagery/radar-frames` returns the frame's `time` in seconds;
`map/radar-layer.js` discards it, so the row says nothing about age. Every
vendor before this one sent no time — that is what `IMAGERY_SENDS_NO_TIME` is
about, and why satellite honestly says "Downloaded". Radar is the first source
that can say the real thing, and the tile split made it easier: the two rows are
built in different files now, so giving radar its own wording no longer changes
satellite's.

**RADAR'S REQUEST VOLUME HAS NEVER BEEN WATCHED.** One image per storm became
roughly thirty tiles per viewport. Each is small, immutable and cached two days
by the browser and shared at our edge, so the expectation is that a session is
LIGHTER than before — **that is a prediction, not a measurement**, and
RainViewer's terms say plainly that they block abusive IPs. The archive runner
has open internet and could sample it.

**GERMAN THUNDERSTORMS ARE IN THE TROPICAL-CYCLONE ALERT FEED.**
`functions/api/cap/alerts.js`, §50.12. The Esri query asks for
`event LIKE '%Hurricane%'` and DWD issues "severe thunderstorms with
hurricane-force gusts". The country match keeps them out of any storm's panel,
**so nothing wrong reaches that section** — but it does reach §50.12's gap
sentence, which fires whenever an unattributed storm coexists with any alert
anywhere. So German weather alone can trigger "this is a gap in what we know,
not an all-clear" on a day with no cyclone alerts on Earth. Decide whether the
gap sentence should count only alerts that could plausibly be a cyclone, or
whether `%Hurricane%` needs a companion exclusion. **This gates the global alert
line under `SCOPED, NOT STARTED`.**

**THE MAP STILL TELLS THE LIE THE HEADCOUNT STOPPED TELLING.** §54 split
`Population affected` into what is still coming and what has already been
through. **The drawn swath did not change.** It is a record where it is behind
the storm and a forecast where it is ahead, painted in one shade, so a green
wash still sitting over a city reads as a warning days after the wind stopped.
The forward-only geometry already exists in every NHC bundle as the `windAhead`
slot, **so the data side is done** — what is left is a styling call about how
"already happened" should look beside "still to come". Logged OPEN in §54.

*Deferred deliberately alongside it:* "it went through on Sunday". The past
track carries timestamps so the date is there for the taking, but the useful
half is the tense and a date is a second thing to get wrong.

**THE GDACS RETRY BUTTON HAS NEVER BEEN PRESSED.** Over 30 days and 1,711
sessions, zero presses — including the 108 visits shown a real `unavailable`
state with a real button on it. The spinner itself largely fixed itself (2% of
loads still loading, down from 11%). Either the outage clears before anyone
reacts, or the button does not read as a thing to press. **A glass question:**
open the app with the network off and look at what that screen invites you to
do. `retry_which` now names which button a press was.

---

## HELD FOR WEATHER

**Everything here is BUILT AND DEPLOYED and cannot be judged until the named
condition arrives. Never a storm name — the condition outlives the storm.** Do
not tell Aaron these are ten minutes of looking; they are not.

**==> AS OF THE LAST ARCHIVE READ, FOUR OF THESE CONDITIONS LOOK MET AT ONCE.
<==** A US storm is on the Gulf coast near the house, a West Pacific storm is at
Orange alert near a mainland coast with a PAGASA alert in force, and there is a
Cat 4 in the East Pacific. **Check the archive manifest before assuming any of
this is still true** — `git show origin/archive:latest/manifest.json`.

**A STORM NEAR THE HOUSE** — `SPEC-UI.md` §48.10. An advisory quoting 8–12
inches across a region while the grid at the nearest point says 2.91 are both
correct, and a reader seeing both thinks the app is broken. Does wording the
section about the HOUSE and naming the forecast point defuse that? Then:
frightening or trivia beside the wind numbers; is a Flash Flood Warning above it
urgent or just taller; does *NHC lists no land hazards* reassure or look broken.

**RAIN ALREADY ON THE GROUND AT THE HOUSE** — `SPEC-FLOOD-PLAN.md` §56.14.
**No reader has seen this sentence.** The `Flooding` section says *"About 3.1 in
of rain is estimated to have fallen at your address in the last 48 hours"*,
between the alert rows and the modelled coastal figure — what IS happening, then
what HAS, then what MIGHT. Four things to judge, and only the first is not
cosmetic:

1. **Does it read as an estimate or as a measurement?** The line under it says
   estimated by a global model, not measured at a nearby gauge. §56.14 names
   this as the single most likely thing in the feature to get wrong, **because a
   wrong version carries the identical number** and nothing on the page invites
   a second look.
2. **Is 48 hours the right window?** `RAIN.pastHours` is a placeholder, not a
   measurement — one line to move.
3. **Does it earn its line on a calm day?** It renders with no storm on screen,
   because it is a fact about a place rather than about a storm.
4. **On an American house two numbers now have two different authors** —
   the forecast from NWS, this from Open-Meteo, because NWS publishes no
   matching observed series. Does the disclosure read as precision or confusion?

**READ THE TWO COVERAGE PROBES FIRST — they are not a glass call.**
`git show origin/archive:latest/openmeteo-rain-past-ocean.json` and
`…-past-desert.json`. Everything about `past_days` was measured somewhere
tropical, coastal, on land and raining. **Nothing has confirmed the past half of
this model covers ocean or sparse land the way the forecast half does.** The
desert probe is the sharper of the two: land, so it cannot be declined for being
sea, and genuinely dry, which makes it the hardest place on Earth to tell a real
`dry` from a `no data`. That distinction is §5.

**A GDACS STORM WHOSE COUNTRY IS ATTRIBUTED, WITH AN ALERT IN FORCE** —
§50.3, §50.11, §50.12. What has never been on screen is the section listing a
foreign agency's alert: the rows, the agency/area/expiry meta line, a
non-English disclosure chevron, and the closing note that keeps a country-level
alert from reading as an order about this storm.

**A GDACS-BASIN STORM NEAR A COAST** — §50.11, §51.4, §51.7. Three things ride
on one condition. Do the two coastal stripes read as coasts (**nobody has ever
seen either one paint**). Does the 13 km surge corridor join towns into one
honest stripe. And **do its GAPS read as "not modelled" or as "safe here"** —
the harder half, and a reader taking an unpainted stretch as safe is a §5 bug
fixed by wording, not by a wider corridor. Also: is teal-to-magenta
distinguishable from NHC's blue-to-purple at a glance.

**A REAL TYPHOON ON A REAL COAST** — §51.4. The whole archive spans 0.10–0.48 m,
rungs 0 and 1 of five. **The top three surge colours and the "deepest town
elsewhere" sentence have never rendered.**

**A GDACS-BASIN STORM NEAR THE HOUSE** — §51, `SPEC-UI.md` §56.7. Surge at home
has never rendered. Useful or trivia beside the wind numbers; does the
six-hours-of-rising clause earn its line; and — the one that matters — does
`out_of_range` read as **a gap in what we know** or as an all-clear. All-clear
is a §5 bug.

**A WEST PACIFIC STORM WITH A PAGASA WARNING ON IT** — §50. **The prior question
is whether the alerts section earns its place at all** — the entire global feed
was one real row at an hour with three live cyclones. Then: informative or
clutter; does the footnote say "this agency covers this country" rather than
"this alert is about this storm"; and on an NHC storm, is pointing at **In
effect** above an answer or a dead section.

**A JTWC WATCHED AREA GOING MEDIUM OR HIGH** — `SPEC-MAP.md` §45.4. Does the
patch step visibly, and match an NHC area at the same rung.

**AN NHC OUTLOOK GOING QUIET WITHOUT EXPLAINING ITSELF** — §45.5, `SPEC-OPS.md`
§17.7. Nobody has seen the amber held note. Stopped clock or failure; do the
patches stay; does a genuine all-clear still get through at six hours. **If it
never fires, the whole held apparatus is a candidate for deletion** — the KMZ
states an all-clear in a dated sentence now, so the six-hour hold no longer
stands in front of a real one.

**A JTWC-UNMATCHED GDACS STORM** — `spec-parameter.md` §34.1, §35.1. Does
"estimated from wind field" read as honest provenance or hedging noise beside
the crisp `Forecast peak` row; does `Forecast by` earn its line; does a
suffix-free name still match what the news calls the storm.

**A GDACS STORM GENUINELY OUT AT SEA WITH NO COUNTRY** — §50.3. Whether *"No
country is listed as affected by this storm yet"* reads as a non-sequitur under
`Watches and warnings`. An NHC storm never enters this branch at all.

**AN NHC STORM'S TWO NEW VITALS ROWS** — neither has been seen. **`Gusts`
arrives a moment AFTER the panel paints**, because it comes from a second NHC
product fetched on open. The question is whether that reads as the panel filling
in or as the panel twitching; the rest of the section is settled by then, so it
should be one row appearing under Winds with nothing moving above it. **If the
shift is annoying the fallback is not showing gusts on NHC at all** rather than
shipping a jumpy panel — that is a real option, say so. And **`Forecast by` on a
Central Pacific storm says Central Pacific Hurricane Center**, not National
Hurricane Center: useful precision or a confusing second agency? A GDACS storm's
row says `JTWC · via GDACS` and the two should read as the same kind of fact.

**A STORM IN AN UNFAVORABLE ENVIRONMENT** — `SPEC-MAP.md` §47.5. Only the
FAVORABLE end of the ribbon's ramp has ever been seen. The ribbon itself is
confirmed across the date line, so what is left is the COLOUR at the hostile end
and nothing structural.

**A STORM WHOSE WATER FAILS UNDER IT** — `SPEC-NEXT.md` §47.8. The water
sentence fires on 11.7% of runs, always tightening, and three of fifteen
fixtures produce it — so it is proven on real bytes. No reader has seen it under
a live cone. Does *"The water ahead of it holds less — down to 100 mph by
Thursday morning"* read as the correction it is meant to be, sitting under a
cone painted its brightest violet.

**FIFTEEN STORMS IN THE LIST** — `SPEC-UI.md` §16. The freshness column is never
blank, so grey timestamps are new visual weight and the amber ones must win
against quiet neighbours rather than against nothing. **Two live storms is not
the test; a dozen is closer.**

**A STORM GOING QUIET, THEN VANISHING AT HOUR 60** — `SPEC.md` §5. Does "quiet
since Sun 7:00 AM" under **Finished** read as coherent, and the disappearance as
a decision rather than a glitch.

**AN ENDED STORM AND A PHONE THAT HAS NEVER SEEN IT** — §5,
`data/ended-track.js`. Does a trackless finished storm get its dotted line
inside one poll, identical to one captured live.

**A REAL FINAL WARNING** — the `declared` end path has never fired. Detection is
client-side; the app must be open.

**A STORM MID-PASS, SITTING STILL LONG ENOUGH TO LOOK AT** — `SPEC-NEXT.md`
§49.12. Does *Was strongest* beside *When it was closest* read as one story in
two tenses or as two unrelated facts; is *It came closer earlier* enough, or does
the past want its own vertical.

**SEVERAL DAYS OF HOURLY SNAPSHOTS — not a glass call** — §50.12. Each archive
run writes a `countryMatch` block. A country in `unmatchedAlertCountries` that
later attaches was attribution LAG; one that never attaches is a coverage HOLE.
**Do not decide how to close it before there are several days** — the fix for a
lag is patience, the fix for a hole is a second storm source, and one hour
cannot tell them apart. The German thunderstorm bug pollutes the denominator.

**A REAL BUSY INDIAN OCEAN BULLETIN — a fixture swap, not a glass call.**
§45.3. JTWC reissues ABIO once a day and every snapshot ever captured reads
`SUMMARY: NONE.` all the way down, so `samples/genesis/jtwc-abio-busy.txt` is
ASSEMBLED — a real Pacific disturbance body transplanted into the real ABIO
skeleton. It proves the template parses; it cannot prove JTWC words an Indian
Ocean disturbance the same way. **The gap is guarded, not ignored:**
`GENESIS.ABPW.noneAssertion` fails the whole bulletin as `unavailable` if a
disturbance block neither says NONE nor lists numbered items, so a wording we
cannot read reports a gap rather than a calm ocean. **When a real busy ABIO
lands in `history/`, replace the fixture.** The 72-hour window rolls, so check
rather than assume.

---

## SCOPED, NOT STARTED

**THE SEASON CLOCK IS BUILT THROUGH SLICE D AND SLICE E WAS REVERTED.** §57.67
is the plan; §57.67c through §57.67n are the as-built account. A, B, C and D are
on glass and confirmed — the arithmetic, the globe cut, the scrubber, and press
play. **Slice E — the trail wearing the colours the storm wore — was reverted in
full on 2026-08-31**: the per-fix track colours came out in the brick GENERIC and
teal PREGENESIS hues rather than the grey the rest of the archive uses, so the
tracks and the storm detail chart disagreed on screen. **Read the revert commit
before reattempting it.** Its lesson is the sharper part: twenty-seven mutations
bit and not one pointed at the rule, because the assertions asked whether a piece
wore the grade the clock answered for its fix — never whether that was the colour
the rest of the archive would have drawn.

**THE ARCHIVE STORM DRAWER'S STEP 8 — THE GLOBE TETHER — IS THE LAST STEP AND
AARON HAS NOT ASKED FOR IT.** §57.54j scoped it and recommends one block at a
time, driven by the row the reader taps, which sidesteps label collision
entirely. **Do not build before he has chosen.**

**GLOBAL COVERAGE FOR THE ARCHIVE (step 13).** **IBTrACS carries no landfall
marker in any form** — that is why ours-everywhere beat ours-where-NOAA-is-silent,
and it means the West Pacific, the Indian Ocean and the Southern Hemisphere get
landfalls the day their tracks are parsed, with no extra work and no second
method. `lib/landfall.js` takes any track with `lat` and `lonU`;
`tools/seasons-landfall.mjs` needs a basin added to its loop and a file written
per basin. **Do not reach for a per-agency marker in the IBTrACS columns.**
§57.7a.

**ONE ANSWER IS WANTED BEFORE STEP 13.** The archive wind rank is honest today
because both basins are NHC's, so every wind is a one-minute sustained average.
Most of the world publishes a ten-minute average, which reads lower for the
identical storm, and §57.31 measured that IBTrACS carries twelve agencies'
separate opinions of one storm. The flag that declines a mixed wind rank is
built and tested (`windComparable`); **what has NOT been decided is whether the
global scope should instead use IBTrACS's re-analysed US-style wind and keep the
row.** Nothing in the sandbox can reach IBTrACS, so nothing was assumed. A
question for step 13's probe, not a gap.

**TWO WALL-OF-YEARS CONTROLS ARE DELIBERATELY NOT BUILT.** §57.36a records the
reasoning for each. **The near-home slider**: the wall never loads track data, so
filtering 175 years by distance needs the whole-basin pass, 0.93 MB, phone cost
unmeasured. **A filter carrying through when a year is tapped**: the wall is seven
independent chips plus toggles, the board is one pill at a time, and most wall
states have no pill to become — so honouring it means bringing both screens onto
one model, which changes a board already confirmed on glass. Its own pass, with a
full context.

**ONE SURVIVING MUTATION IS A REAL HOLE.** Forcing the radius slider to render
under every filter changes nothing any suite can see, because **no board-level
test mounts the view with a home** — so the Near home filter never appears in any
of them and neither it nor its slider is covered at view level. §57.19 says the
slider is REVEALED by the choice, and that behaviour is unasserted. Closing it
needs new scaffolding (a mount carrying `home` and `system`), which is a piece of
work rather than an assertion.

**AN ALERT IN FORCE THAT REACHES NOBODY — AND THE OBVIOUS FIX IS THE WRONG ONE.**
§50.3, §50.12. The app fetches live government cyclone warnings and can show them
only under an attributed GDACS storm. An alert for a system we do not track is
fetched, held, and displayed to no one.

**REJECTED: joining alerts to WATCHED AREAS by position.** An area carries a
centroid, a shape, two probabilities, a risk word and a basin — **no country**.
NHC publishes none; JTWC publishes a bearing off a landmark, which is not
attribution. Joining would mean deciding which nation an area sits in from its
position — exactly what §50.3 refuses to do for storms, and on weaker evidence,
since a JTWC area's shape is a circle WE drew. It would also have matched wrong
on the day it was proposed: a Low-rated area inside the PAR would have taken the
alert while a High-rated one outside it got nothing.

**SURVIVING OPTION: a global line attached to nothing** — e.g. at the foot of
`Being watched`, naming the agency and the area and stopping there. Honest
precisely BECAUSE it claims no connection. **GATED, AND THE GATE IS REAL:** do
not build it before the German thunderstorm bug under `NEXT UP` is fixed. A
global surface makes that bug user-facing instead of a footnote.

**THE FLOOD LAYER DRAWS NOTHING OUTSIDE THE UNITED STATES.** §56.19 carries the
numbers and the probe has been read: 130 KB, 100 rows, and **100 of 100 are a
single point**, not a polygon. `severity` is 0 on every row. The row count is
exactly the 100-row cap, so the volume question cannot even be asked of this
feed, and only 10 of the 100 are current. Worse than the missing geometry: every
row is a **GLOFAS river state running 1 to 95 days** — a basin high for a season,
not water this storm put on the ground. **One cheap thread is uncut:** each row
carries a `url.geometry` on the same endpoint this app already fetches cyclone
shapes from, and `functions/api/gdacs/geometry.js` would accept it unchanged.
Nobody has pulled one. **But a polygon around a three-month river state is still
not a claim this app can put beside a storm**, so even a yes there does not
reopen it alone. **The likely end state is wording, not shapes** — a fuller
sentence on that switch than `US only` is the cheapest real improvement.

**JTWC'S `.tcw` IS A BETTER SOURCE THAN THE PRODUCT WE PARSE.** `SPEC-NEXT.md`
§53 — four separable wins, the strongest of which deletes the relay's
date-guessing code outright. **Do not write the parser off the current
snapshot:** two storms, one hour, one hemisphere, and a formation alert has a
different layout entirely. **Wait for a Southern Hemisphere storm in the
window.**

**BASIN GROUPING IS WANTED AND NOT STARTED.** Areas should sit under the same
basin headings the storms do. **The blocker is not layout:** `Being watched` is
the only surface that can say the outlook is DOWN, and dissolving the section
leaves that message with no home. Decide where an outage speaks before moving
any rows. It also drags in an ordering rule within a basin (storms and areas are
not on one scale) and basin headers containing only a watched area, which at a
glance can read as an active threat.

**THE UNLABELLED LineString IS PARSED, CARRIED, AND DRAWN NOWHERE.** Present in
23 of 72 hours, always when a disturbance sat outside its own area. Four
samples, one disturbance, one basin — decide what it is before deciding whether
to draw it.

**THE 3D LAND FILL SHOULD BE SHAPES, NOT A PICTURE.** Feeding `RINGS` to the GPU
as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling, and turns retheming into a recolor. Traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, flat
triangles cutting chords through the sphere. `earcut` (~10 KB, no build step)
does the triangulation. **Ring winding is opposite between the two paths, and
that is the thing that will care.** Not during cyclone season, and not in the
same pass as the engine upgrade — both are surgery on `map/globe3d.js`.

**THE THREE.JS r128 → r182+ UPGRADE GATES NOTHING.** Ordinary maintenance now.

---

## THE §12 CEILING — MEASURED 2026-09-01, NOT REMEMBERED

**Every line count in this file was stale at the last audit and all of them were
stale in the same direction.** Re-measure before arguing from any of these.

| File | Lines | Note |
|---|---|---|
| `main.js` | 2,071 | The `warmable layer` helper has been "the next cut" for six passes. |
| `ui/view-storm-detail.js` | 1,881 | Stamp, section renderers, advisory record, stepper. |
| `ui/view-home.js` | 1,835 | Strength strip, countdown rail, and the quiet/error/no-home states are three separable concerns. |
| `lib/windswath.js` | 1,105 | Over the ceiling. A cut is owed before new features land here. |
| `ui/view-seasons-board.js` | 1,004 | **Has crossed 700 five times and been cut three.** Every seasons pass grows it. |
| `map/imagery.js` | 911 | Came back under 1,000 when radar left. |

**==> THE SEAM §12 RECOMMENDED FOR `view-seasons-board.js` FIVE TIMES DOES NOT
EXIST. <==** It called the input block "roughly 300 lines of event routing" over
"six ACTIONS, and every one already exists as a function". Measured: about
**fifteen** of those lines are dispatch, and **three** of the ten actions are
functions. Lifting the routing moves nothing; extracting the actions first is a
rewrite of the handlers. **A seam can be named in a ceiling row for five passes
without anyone once checking it is there** — that is worth more than the line
count.

**A NAMED CUT DEFERRED PAST A FEATURE DOES NOT STAY THE SAME SIZE.** §12
predicted "near 600" for one of these when it was 769; a feature put 90 lines
back first and the same cut landed at 762.

---

## RUNNING THINGS — measured 2026-09-01

- **146 test suites** in `tools/test-*.mjs`. Run them with
  `node tools/run-suites.mjs`, **never a shell loop** — a loop kills the slow
  ones early and reports a false failure.
- **Three suites are slow on purpose, not hung:** `test-genesis.mjs` ~195 s,
  `test-flood-fast.mjs` ~68 s, `test-lifecycle.mjs` ~65 s. **This file has
  misdiagnosed genesis as hanging twice.** Do not record a suite as broken
  without a `run-suites.mjs` run behind it.
- **`check-syntax.mjs`** parses 324 modules and 229 tools. `node --check` does
  NOT do this and once shipped a blank screen to production.
- **`token-check.mjs` passes** — 246 references, all resolve. *(An older note
  said it was failing on `volcano-plume.js`; those files no longer exist.)*
- **Browser suites need the server in the SAME shell command:**
  `bash tools/with-server.sh node tools/<check>.mjs`. A background process does
  not survive between shell calls; the sandbox reaps it, and a page that never
  loads times out on the first selector it waits for.
- **`seasons-wall-check.mjs` runs fine here** — 50 assertions, under a minute.
  It is in CI but **NOT in the pre-push hook**. Run it by hand after any change
  to the Wall of Years.
- **`perf-history` holds one file and nothing has been run since.** Actions →
  perf-audit → Run workflow is the first move there; the sandbox cannot dispatch
  it. Expect red — `colorNulls` is budgeted at 0 and that instrument is pointed
  at the wrong thread. The JSON is written before the failure.

---

## TRAPS THAT LOOK LIKE SOMETHING ELSE

**Each of these is written out in full in the spec section named. They are
listed — not repeated — because a session that hits one of them will not know to
go looking, and because a trap copied into two files goes stale in one of them.**

| If you see this | It is | Read |
|---|---|---|
| A storm count that is exactly double | `seasons/data/` holds two whole-basin files beside the 252 per-season ones. Filter to `<basin>-YYYY-`. | §57.61a |
| The archive opens with every landfall list empty | A 404 on a filename, not a broken rule — `_headers` holds `/seasons/data/*` immutable until 2027. Check the network tab before touching `lib/landfall.js`. | §57.16a |
| A new `seasons/` file 404s in production | It needs a line in `_headers` by hand and nothing catches the omission. | §57.16a |
| `test-sw-routing.mjs` fails after adding a cache-first path | On purpose, until a sample filename is added. Cache-first turns a transient 404 permanent. | §57.35 |
| A layout check reports huge drift on a layout that just improved | The check measures against the old column. Re-read it; do not undo the fix. | §57.66b |
| A distribution bar mark that disagrees with the number printed beside it | The bar was fed the raw value, not the rung. `toRung` is the only conversion that speaks a ladder's units. | §57.54c |
| A warmed route serving an expired flood warning | `nws/flood` reads KV at the fresh tier only and must not be "finished". | §58.3 |
| A cache that never serves a fresh answer | `FRESH_SECONDS` equalling the cron period. `functions/api/nhc/advisory.js` is still `5 * 60` against a 5-minute cron — the only such collision among warmed routes. | §4.13 |
| An upstream URL built from client input | Only `functions/api/nws/alert.js` does this. The id must match NWS's CAP URN anchored at BOTH ends or the function fetches an attacker's host with our User-Agent from inside Cloudflare's network. | §48.21 |
| Landfall counts moving with nothing in the diff | The coastline pin is a deliberate hand brake at `natural-earth-vector@v5.1.2`. Moving it means re-running `node tools/seasons-landfall.mjs --check` and comparing the agreement figure. | §57.7a |
| Pages preview builds climbing toward the 500/month cap | A push to a non-production branch can build a preview. Ours appears not to, but that is evidence rather than proof. The fix is the branch-control setting. | §57.33 |

**TWO RULES HAVE NO SPEC HOME YET AND SHOULD GET ONE.** Both were learned
expensively and neither is written down anywhere but here:

1. **`textContent` cannot see a clip.** A figure read `18 of 3` on a real phone
   while the DOM said `18 of 31` and every node assertion agreed — the column
   was 2.6em with `overflow: hidden` and the browser threw the last character
   away at paint. **Anywhere a number shares a fixed-width column with new
   content, the assertion has to measure `scrollWidth - clientWidth`**, not
   compare a string.
2. **A measurement tool must not import the module it measures.** A tool testing
   itself through the same assumptions as the code passes over bugs invisibly.

## KNOWN AND ACCEPTED — MOVED

**These live in `SPEC.md` §55 now.** Decisions that are finished, and things that
will otherwise be rediscovered and re-reported. **Read it at session start along
with this file** — that is the whole condition on which the move was made. A
section nobody opens is a section that has been deleted with extra steps.

```
sed -n "$(grep -n '^## 55\.' SPEC.md | cut -d: -f1),\$p" SPEC.md
```
