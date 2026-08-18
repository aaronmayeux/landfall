# NOW.md — what's in flight

> **TRIM/AUDIT TRIGGER: 300 LINES.** Past that, this file gets a full read and a
> cut list before anything else is added. A trigger, not a ceiling — the point is
> a periodic honest audit, never compressing a finding on the day it was made.
>
> **WHY 300 AND NOT §12's 700.** A source file is navigated by jumping to the
> part you need; this one is read front to back at session start. Past roughly
> 300 lines that reading turns into searching, and searching only finds what you
> already knew to look for — which is exactly backwards for the file whose job is
> naming the things you DIDN'T know about.
>
> **THE FIRST SCREEN IS THE PRODUCT.** `THE PLAN`, `IN FLIGHT` and `NEXT UP`
> stay short enough to read at a glance, because this file's whole job is
> orienting the next session in its first minute. Length accumulates BELOW them.
>
> **`THE PLAN` IS SEQUENCING, NOT A DECISION TRAIL.** It answers "what am I doing
> in this session" and nothing else. A wave carries a pointer to the section that
> describes the work, never a copy of it. When a wave lands it is DELETED here,
> the same as any other item.
>
> **An item leaves this file in exactly two ways.**
> 1. **It lands** — delete it here, and add one or two sentences to the relevant
>    spec file describing what *is*, not what happened.
> 2. **It dies** — delete it. No tombstone, no "investigated and dismissed".
>
> **Not a log.** No dates on things, no completed section, no history. If you want
> to know what happened, that's what `git log` is for.
> **Not a decision tree.** Keep an item to a line or two where a line or two is
> honest. An item needing several paragraphs is a spec entry wearing a TODO's
> clothes — write it in the spec and leave a pointer here.
> **Never a place to record a rule.** Rules go in SPEC.md.

---

## THE PLAN — pick one wave, do it, close it out

**Each wave is sized for ONE session.** They are ordered so nothing waits on
research it does not need. Do not start two. When a wave lands, delete it from
here and put what it built in the spec.

**WAVE 5 — research, and it is FOUR QUESTIONS IN ONE.**
- **Global coverage for the four NHC-only features** — watch/warning, rainfall,
  storm surge, the environment ribbon. Same question four times: *is there
  another source covering the rest of the world?* Research together or pay four
  times. See SCOPED, NOT STARTED.
- **Global radar** is its own pass and a different shape. See SCOPED, NOT STARTED.
- **The outlook KMZ has never been opened.** Inventory everything in it, not just
  the outlook areas. See SCOPED, NOT STARTED.
- **JTWC's per-storm `fix.txt` has never been fetched.** Whether it carries wind
  extent or only positions is the open question behind GDACS having no past wind
  field. See KNOWN AND ACCEPTED.

---

## IN FLIGHT

**Everything under this heading is BUILT, DEPLOYED AND UNJUDGED.** The as-built
description is in the spec section named beside each one; what is here is only
the question a tool cannot answer.

**A GDACS storm now gets the wind-arrival countdown, and no GDACS storm has
been on the glass with it.** `SPEC-NEXT.md` §49.16. The chart's bands, the
Timeline rail and the headline sentence all work for GDACS now, because its
wind field is recovered from the drawn polygons as the same quadrant radii NHC
publishes — exact, not approximated, verified against the archive.
**Judge on a real GDACS storm near home:** the drawer is deliberately SHORTER
than an NHC one — no past-wind sentence, no earliest-arrival hedge, no
rainfall, no watch/warning, because nobody publishes them. Does that read as a
source that knows less, or as an app that is missing something? And do the
arrival times pass the sanity test a reader would apply — weaker wind first,
stronger wind inside it, all-clear last.

**A JTWC watched area's patch now changes with its risk word.** `SPEC-MAP.md`
§45.4. **Judge when a Western Pacific area next goes Medium or High:** does the
patch step visibly, and does it match an NHC area at the same rung. Both live
JTWC areas are Low, so there is nothing to see until one moves.

**Genesis outlook — the held-empty memory has never once fired.**
`SPEC-DATA.md` §45.5, `SPEC-OPS.md` §17.7. An empty NHC outlook layer inside six
hours of a real answer is held rather than believed. Nobody has seen the amber
held note. Judge: does it read as a stopped clock rather than a failure, do the
patches stay on the globe, and does a genuine all-clear still get through once
six hours lapse.

**Rainfall is on two surfaces and neither has been seen.** `SPEC-DATA.md`
§48.1–§48.7, `SPEC-UI.md` §48.8–§48.10. Nothing blocks judging it now — the
alert row has its background and corner back, and the Retry is a real 44px
bordered button with a focus ring instead of an unstyled link.
**Judge §48.10 first, and it needs a storm near home.** Lala's advisory says
8–12 inches across eastern Maui while the grid at Kahului says 2.91 — both
correct, and a reader seeing both will think the app is broken. Two things are
built for that: the home section is worded about the HOUSE, and its last line
names the point NWS is forecasting for. Then: does a rainfall total read as
frightening or as trivia beside the wind numbers. Does a live Flash Flood Warning
above the total read as urgent or just make the section taller. On a storm with
no land threat, does *NHC lists no land hazards for this storm* read as
reassurance or as a missing feature.

**Two corners of rainfall nothing has exercised.** The `no_hazards` path is
proven against a SYNTHESISED product (§48.11). And a house outside NWS coverage
has never rendered — the 404/400 pair is asserted from the Nassau fixtures, but
nobody has set home in the Bahamas and looked.

**The no-home screen's new privacy sentence.** It no longer says coordinates
never leave the device, because rainfall sends the house. It now says the home is
stored on this device only, no account, nothing that names you. Judge the new
sentence: it is weaker than the old one and it is true, which is the trade.

**A GDACS storm's panel says three new things, and its name says one thing
less.** `spec-parameter.md` §34.1, §35.1. Judge on a JTWC-unmatched storm: does
"estimated from wind field" read as honest provenance or as hedging noise beside
the crisp `Forecast peak` row under it; does `Forecast by` earn its line; and
does a suffix-free name still match what the news calls the storm.

**Home is a place name instead of a coordinate pair.** `SPEC-UI.md` §8,
`SPEC-DATA.md` §4. **NONE OF THE LOOKUP HALF HAS RUN AGAINST REAL MAPBOX** — the
sandbox cannot reach it, so every failure path is written and none is exercised.
Judge: does the name read as useful at three comma-parts ("Galveston, Texas,
United States"), or is the country noise? Dial is `labelOf()` in
`functions/api/reverse.js`. And does "Open water" land as a description rather
than a warning — watching a rig or a passage is a legitimate thing to want.

**A question the water probe cannot answer for itself.** `map/water-at.js` reads
`queryRenderedFeatures` against the ocean fill, which is only as good as the
tiles loaded at that moment. If a pin on obvious land ever says
`Unnamed location` with coordinates under it, that is this, and the dial is
`GEOCODE.waterProbeMs`.

**The home marker can see the drawer now.** `SPEC-MAP.md` §9.10. Judge with a
drawer open: pan until the house goes under the sheet and confirm the pointer
appears *directly above the house*, one clear gap off the sheet's top edge — not
flung to a screen corner. Then confirm the no-drawer behaviour around the FABs,
the storm pill and the status chip is unchanged.

**Two `.row-swatch` callers in the detail panel are built the way the header bug
was.** `ui/view-storm-detail.js` ~721 and ~775, the wind-field and model legend
items, pass color as an inline `background:` rather than `--swatch`. Same
construction as the header bug, so almost certainly the same dead glow plus a
stray 5px offset — **NOT measured**, and not touched, because it changes two more
surfaces nobody has looked at.

**The heading arrow is on three surfaces and none are judged.** `SPEC-UI.md`
§16.4. Judge: does it read as a direction rather than decoration; is the stroke
heavy enough beside monospace figures in both themes; and does a row with NO
arrow look deliberate rather than broken.

**The storm list's freshness column is never blank.** `SPEC-UI.md` §16. Judge: a
column of grey timestamps on fifteen rows is new visual weight, and the amber
ones now have to win against fourteen quiet neighbours rather than against
nothing.

**A storm nobody is analysing now leaves, and stays left.** `SPEC.md` §5. Judge
on the next one: does "quiet since Sun 7:00 AM" under a **Finished** heading read
as coherent, and does the storm vanishing at hour 60 read as a decision rather
than a glitch. Nobody has seen the disappearance itself.

**A dead storm's trail is no longer a souvenir of who was watching.** `SPEC.md`
§5, `data/ended-track.js`. Judge: does a finished storm that arrives trackless
get its dotted line inside one poll on a phone that has never seen it before, and
does the line look identical to one captured live.

**The environment ribbon's colored forecast line uses the cone's own ramp.**
`SPEC-MAP.md` §47.5. **Judge whether the line and the fill read as one
statement** — above the crossover they are the same pixel value, and below it the
line still refuses to reach zero. **Only the FAVORABLE end has ever been seen.**

**One duplication survives on purpose and has been SEEN but not ruled on.**
`SPEC-UI.md` §8. On a near storm the `Where it is` section and the countdown's
first row say the same words. The countdown is the chart's accessible twin and
has to be self-contained. It was on the glass and drew no complaint, which is
weaker than an answer. Aaron's call.

**Sliders need a thumb grab; drawer content fades under the header.** `SPEC.md`
§10, `SPEC-UI.md` §16. Scroll the settings sheet fast past all four sliders —
nothing should move. Then drag a thumb: no lag on the first pixel, still
grabbable at either end. Desktop mouse: the track no longer jumps to a click,
which is intended.

**Every relay route rebuilds its cache hit, and GDACS reports its own age.**
`SPEC-OPS.md` §17.7. GDACS can now raise the delayed banner for the first time
ever. Watch for false alarms.

**The app replays Hurricane Ida at `/?replay=ida`.** `SPEC-UI.md` §8.
**Imagery is the open hole:** satellite and radar do not route through
`ENDPOINT.relay` and there is no archived imagery, so switching them on during a
replay paints TODAY's radar over a 2021 hurricane. Suppress with a stated reason
or find an archive — doing nothing is what §5 rules out.

## NEXT UP

**1. WINDOWS IS SLOW BEFORE OUR CODE RUNS, AND THE THREE.JS FIX IS AIMED AT THE
WRONG THIRD.** Read against 808 clean sessions on current code — `timings_ok=1`,
rows carrying `t_scripts_ms`, own device excluded. **Medians**, because averages
were hiding a tail:

| ms | iPhone (528) | Android (196) | **Windows (56)** | Mac (13) | Linux (15) |
|---|---|---|---|---|---|
| First paint | 222 | 528 | **684** | 204 | 308 |
| Libraries finished | 667 | 1,087 | **1,446** | 567 | 852 |
| Storms on screen | 1,226 | 1,552 | **1,991** | 1,219 | 1,638 |
| Blocked during boot | *not measured* | 391 | **323** | 0 | 512 |

Windows is 765 ms behind an iPhone. **462 of that is already gone at first
paint**, before our JavaScript matters; 317 is downloading and parsing the two
vendored libraries; **our map-and-data code costs Windows 14 ms LESS than an
iPhone** — that stage is identical everywhere. And Windows sits blocked for
*less* time during boot than Android does.

**So the main thread is not what is slow on Windows, and moving Three.js off the
boot path would help Android more.** Ten modules import `THREE`; the most it can
win is a slice of 317 ms on the platform with the least blocking. Not worth the
restructuring on this evidence. iOS stays blind either way — Safari has no
long-task observer, so every iOS zero is "not measured".

*The old figures here (Windows 2,764 / 4,670) came from 21 sessions and
overstated this by roughly half. Windows is 1.6× an iPhone, not 2.2×.*

**2. WHAT A MAPLIBRE FRAME COSTS — UNMEASURED, AND THE GATE ON ITEM 1.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint. The free half is already gone. The
remaining repaint cannot simply be skipped, because `setCenter` is what
`map/globe-follow.js` mirrors to make the rotation visible. The four rules a fix
must follow are in `SPEC-MAP.md` §9.7. Needs a real device with a real basemap.

**3. THE GDACS SPINNER LARGELY FIXED ITSELF; THE RETRY BUTTON IS THE OPEN
QUESTION NOW.** Re-read over 14 days: GDACS 1,591 of 1,713 loads reached `ok`,
90 said `unavailable`, and **32 ended still loading — about 2%, down from 11%**.
NHC is 1,700 `ok` against 18 `unavailable`. The stamp fix and the two-second rung
did their job.

**What did not move: Retry has still been pressed zero times, now across 1,711
sessions in 30 days** — including the 108 visits that were shown a real
`unavailable` state with a real button on it. Either the outage clears before
anyone reacts, or the button is not reading as a thing to press. **A glass
question, not a data one:** open the app with the network off and look at what
that screen actually invites you to do. `retry_which` now names which button a
press was, so the first one ever recorded will say which section people care
enough to fight.

*Dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not the
bottleneck, and modulepreload was measured and rejected (`SPEC.md` SETTLED). The
4096×2048 land texture costs ~511 ms of upload plus ~202 ms rasterising on cold
load — worth removing, but not urgent and not user-facing, and the answer is
filled triangles (below), not a smaller canvas.

## HELD FOR WEATHER

**Watch a storm get a real final warning.** The `declared` end path has never
fired on a real storm. Detection is client-side; the app must be open.

**Surge is HELD FOR A STORM NEAR HOME, and the live relay route is the gap.**
`SPEC-DATA.md` §4.8. `fetchSurgeLive()` throws until that route exists, which the
caller surfaces as `unavailable` — never as an empty coast. The Peak Storm Surge
service only answers while a US storm has surge watches in effect, so the live
field names cannot be read until one does. **Build the relay route and
surge-at-home together the moment such a storm appears** — they share one
fetch-and-filter, and against a storm half a planet away there is no telling a
right answer from a plausible one.

**Two glass questions §49.12 records and nothing has answered.** Does *Was
strongest* beside *When it was closest* read as one story in two tenses or as two
unrelated facts (Q6)? And on a storm mid-pass, is the single line *It came closer
earlier* enough, or does the past want its own vertical (Q5)? Both need a storm
sitting in that state long enough to look at.

## SCOPED, NOT STARTED

**Two views are over §12's ~700-line ceiling and both want a cut before they are
touched again.** `ui/view-home.js` is 1,413 — the strength strip and its figures,
the countdown rail, and the quiet/error/no-home states are three separable
concerns sharing a file. `ui/view-storm-detail.js` is 1,440; the stamp, the
section renderers, the advisory record and the stepper are its four. Each split
should be its own pass with **no behaviour change**, so a break can only be the
move.

**The outlook KMZ is archived and unparsed.** Layer 3 is empty on BOTH NOAA map
services while NHC's website draws areas (§45.2 — settled, don't re-check).
`gtwo_atl.kmz` is the second publication path and is snapshotted hourly. **Open
the real bytes and inventory EVERYTHING in them, not just the outlook areas** —
the question is what else a KML carries that we are not getting elsewhere. The
Pacific filename in the archive is inferred and may 404.

**The 3D land fill should be shapes, not a picture.** Feeding `RINGS` to the GPU
as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling, and turns retheming into a recolor. Traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, flat
triangles cutting chords through the sphere. `earcut` (~10 KB, no build step) does
the triangulation. **Not during cyclone season, and not in the same pass as the
engine upgrade** — both are surgery on `map/globe3d.js`.

**The three.js r128 → r182+ upgrade gates nothing.** Ordinary maintenance now.

**Global coverage for four NHC-only features — ONE research pass, not four.**
Watch/warning, rainfall, storm surge and the environment ribbon are all limited
to NHC's basins for the same reason: the product is American. The question is
identical each time — *is there another source covering the rest of the world* —
so researching them together is far cheaper than four separate investigations.
§47.3 already answered it NO for the environment ribbon's ocean-heat term and
that answer stands; the rest are open.

**Global radar, through the fewest sources that hold quality.** `SPEC-DATA.md`
§4. Today's box is NOAA only, roughly the Americas. **The honest framing is MORE
COASTLINES, not global** — ground radar needs ground, and no radar exists over
open ocean anywhere on Earth. The storms it would newly reach are ones already
near land, which is when radar matters most. Its own pass, separate from the four
above.

## KNOWN AND ACCEPTED

- **GDACS PUBLISHES NO PAST WIND SHAPES, MEASURED.** Every band on every live
  GDACS storm is dated at or after the bulletin's issue time — checked across all
  three storms in the archive 2026-08-18. Hernán carried twelve PAST centre dots
  and five FORWARD wind shapes. JTWC is no help either: its warning is text, with
  no cone, no footprints and no past track (`lib/jtwc-wind.js` says so). The one
  unexamined candidate is JTWC's per-storm `fix.txt`, which this project has
  never fetched — whether it carries wind extent or only positions is unknown.
  Stitching a history from our own hourly snapshots would make what a user sees
  depend on how long their phone happened to be open, which is the exact bug
  `data/ended-track.js` exists to fix.
- **NHC's live layer 13 publishes real history, measured 2026-08-18.** Lala's
  layer carried 21 six-hourly steps with real quadrant radii back to 13 Aug
  against a past track reaching 10 Aug — three days shallower, not a token
  amount. `partial` already exists to say so. The past track's `stormtype` is also
  real and carries DB/LO/TS/HU.
- **A shapeless watch looks like one bad advisory, not a basin quirk.** Lala's
  watch and warning both carried real LineStrings on 2026-08-18. One snapshot, so
  evidence rather than proof — but it points away from a Central Pacific problem
  and away from building the KMZ fallback for this reason.
- **`functions/tiles/` is dormant, and dormant SERVER-side.** `TILES.useR2` is
  false, so the Protomaps branch in `map/style.js` and the 1,721 vendored pmtiles
  lines never run. A Pages Function is not downloaded by a visitor, so this costs
  nothing on the wire. **R2 is no longer wanted as an option** (§2 SETTLED); the
  code is not urgent to delete but nobody should maintain it.
- **The drawer does not say which watch/warning products fell back to a chord.**
  `SPEC-UI.md` §16, `SPEC-MAP.md` §7.10. Saying it there means plumbing map state
  into the panel. Left undone deliberately now the map admits it itself.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic.
- **The gap between a warning being issued and the winds arriving is not
  computable in the app.** Layer 8 carries what is in force, not when it was
  issued, and nothing stores advisory history on device. It is the most actionable
  number in the archive and it is out of reach.
- **iOS clean long-task numbers are an instrumentation gap.** All WebKit sessions
  report `longtask_n = 0` because WebKit does not implement the observer.
  `ttfb_ms`, `mem_gb` and `conn_type` are blank there for the same reason. Do not
  read any of those columns as "iPhones never block".
- **Filter telemetry on `timings_ok = 1` or repeat a mistake this project already
  made.** Backgrounded tabs (`timings_ok = 2`, averaging 322,440 ms to storms)
  poisoned every iPhone average ever computed here. iPhone's real position is
  second fastest. **But it EXCLUDES valid usage rows** — do not use it when
  counting people or sessions.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength
  comes from GDACS's own `severitytext`. Logged because the question keeps getting
  re-asked.
- **Three suites need Playwright and do not run in a bare sandbox.** Expected,
  not broken.
