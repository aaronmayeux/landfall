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

**NO WAVE IS IN PROGRESS. The next session picks one, or picks one of the four
items under `NEXT UP`.** Nothing below is half-built.

**Do not reopen the single-source radar question.** §4.9 records what it was
traded for.

---

## IN FLIGHT

**RAINFALL AT THE HOUSE, IN THE STORM DRAWER (§48.17) — ONE GLASS CALL, AND IT
NEEDS A HOME PIN SET WITHIN 1,500 nm OF A STORM.** The Rainfall section now has a
second block, "At your house": a point total for the home pin, on every storm
from every source, reading the SAME cached record the dashboard's Rain section
shows. **What to judge is whether the two figures read as two answers or as one
contradiction.** Under an NHC storm the section shows NHC's area range ("10 to 20
inches across the Big Island") and then the point total ("about 11 inches"),
separated by a hairline, with one line between them explaining why they can
differ. §48.10 has called that risk unsettled since it was written and this is
the first build that puts both numbers where a reader meets them together.
Secondary: the block is suppressed entirely for a storm further than
`APPROACH.relevanceNm` — check a far-away typhoon shows NO house block rather
than a stray figure.

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

**Two things are still UNMEASURED** and `tools/perf-audit.mjs` measures them on
the Actions runner: radar's request volume (item 0b below, still a prediction)
and the colour-null count (item 0d, still untraced). The budget sets colour-nulls
to 0, so that run fails until it is fixed. **`node tools/load-probe.mjs` and
`boot-profile.mjs` both build their browser with `serviceWorkers: 'block'`** —
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
evaluator, on every boot. **Which property is NOT known** — it was seen in a
console paste and never traced, and guessing at it is how the wrong thing gets
"fixed". Needs a real hunt through the paint properties and the tokens they read
before anything is written. The cost is unknown too: it may be drawing nothing
where something belongs, or falling through to a default that happens to look
right. Do not assume the second.

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

## HELD FOR WEATHER

**Everything here is BUILT AND DEPLOYED and cannot be judged until the named
weather arrives.** Do not tell Aaron these are ten minutes of looking — they are
not. Each names its condition first, then the question; the as-built description
is in the spec section cited.

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
FAVORABLE end of the ribbon's ramp has ever been seen.

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

## KNOWN AND ACCEPTED

- **`aoi_surge` IS NOT A SURGE FOOTPRINT. SETTLED, DO NOT RE-ASK.**
  `SPEC-DATA.md` §51.1. An affected-PLACES export — cities and provinces,
  `intensity: 1` on every feature, no height/surge/water/depth field among its
  twenty keys. Nothing in it to draw. §51.4's town bands are not a stand-in for a
  better geometry; they are the whole of what this product publishes.
- **NOBODY PUBLISHES PAST WIND EXTENT OUTSIDE NHC. SETTLED, DO NOT RE-ASK.**
  `SPEC-NEXT.md` §53, `SPEC-DATA.md` §45.3. GDACS bands are all dated at or after
  their bulletin; none of JTWC's four per-storm products carries a past radius. The
  `.tcw` is the proof it is deliberate — its best track repeats each past hour once
  per wind threshold met, radius columns stripped. NHC layer 13 is the only source
  on Earth, so that feature stays American. Stitching a history from our own hourly
  snapshots would make what a user sees depend on how long their phone happened to
  be open — the exact bug `data/ended-track.js` exists to fix.
- **NHC's live layer 13 publishes real history.** Lala carried 21 six-hourly steps
  with real quadrant radii back to 13 Aug against a past track reaching 10 Aug —
  three days shallower, not a token amount. `partial` already says so. The past
  track's `stormtype` carries DB/LO/TS/HU.
- **A shapeless watch looks like one bad advisory, not a basin quirk.** Lala's
  watch and warning both carried real LineStrings. One snapshot, so evidence rather
  than proof — but it points away from a Central Pacific problem.
- **The `Where it is` / countdown duplication is APPROVED.** `SPEC-UI.md` §8. Both
  say the same words on a near storm; the countdown is the chart's accessible twin
  and has to be self-contained. Aaron ruled: keep as is.
- **The Windows main-thread fix is confirmed on glass.** The coast-layer select
  memo no longer re-keys on `coastGeneration()`, so an engine push stops paying a
  full basemap decode. Confirmed running well on Chromium / Beelink mini PC driving
  a 43" touchscreen.
- **`/?replay=ida` paints TODAY's imagery over a 2021 storm, and that is
  accepted.** Satellite and radar do not route through `ENDPOINT.relay` and there
  is no archived imagery. Replay is a mock-up, not a user-facing feature — not
  worth suppressing the toggle for.
- **The water probe is only as good as the tiles loaded.** `map/water-at.js` reads
  `queryRenderedFeatures` against the ocean fill. A pin on obvious land reading
  `Unnamed location` is this; the dial is `GEOCODE.waterProbeMs`.
- **Every relay route rebuilds its cache hit, and GDACS reports its own age.**
  `SPEC-OPS.md` §17.7. GDACS can raise the delayed banner for the first time ever;
  a false alarm would show up as an unexplained banner.
- **`functions/tiles/` is dormant, and dormant SERVER-side.** `TILES.useR2` is
  false, so the Protomaps branch in `map/style.js` and the 1,721 vendored pmtiles
  lines never run, and a Pages Function is not downloaded by a visitor. **R2 is no
  longer wanted** (§2 SETTLED); not urgent to delete, but nobody should maintain it.
- **The drawer does not say which watch/warning products fell back to a chord.**
  `SPEC-UI.md` §16, `SPEC-MAP.md` §7.10. Saying it there means plumbing map state
  into the panel. Left undone deliberately now the map admits it itself.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic.
- **The gap between a warning being issued and the winds arriving is not
  computable in the app.** Layer 8 carries what is in force, not when it was
  issued, and nothing stores advisory history on device. The most actionable number
  in the archive, and out of reach.
- **iOS long-task numbers are an instrumentation gap, not a result.** WebKit does
  not implement the observer, so `longtask_n = 0` everywhere and `ttfb_ms`,
  `mem_gb`, `conn_type` are blank. Never read those as "iPhones never block".
- **Filter telemetry on `timings_ok = 1` or repeat a mistake this project already
  made.** Backgrounded tabs (`timings_ok = 2`, averaging 322,440 ms to storms)
  poisoned every iPhone average ever computed here. **But it EXCLUDES valid usage
  rows** — do not use it when counting people or sessions.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength comes
  from GDACS's own `severitytext`.
- **Three suites need Playwright and do not run in a bare sandbox.** Expected.
