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

**WAVE 5 — research. ONE PASS LEFT.** Pass 1 shipped rainfall and surge; what it
built is in the spec and what it still needs is under IN FLIGHT. **How to reach
the world from a sandbox that cannot: `SPEC-OPS.md` §18.**

- **Pass 2 — global radar.** Same method, different shape, its own session. The
  honest framing is MORE COASTLINES, not global. See SCOPED, NOT STARTED.

**THIS FILE IS 489 LINES AND ITS OWN TRIGGER IS 300.** It was already 462 on
arrival, so the audit was overdue before this pass and this pass made it worse.
**The next session does the read and the cut list before adding anything**, and
the first candidates are the IN FLIGHT entries that have been unjudged longest —
several name a glass question for a storm shape that has not occurred in months.

---

## IN FLIGHT

**Everything under this heading is BUILT, DEPLOYED AND UNJUDGED.** The as-built
description is in the spec section named beside each one; what is here is only
the question a tool cannot answer.

**Global rainfall and global surge are BUILT, DEPLOYED AND UNJUDGED.**
`SPEC-DATA.md` §48.14–§48.16, §51; `SPEC-UI.md` §48.12, §51.6. Wave 5 Pass 1's
two features. What a tool cannot answer:

**Rainfall's second source is invisible from anywhere with an NWS forecast.**
It only fires when NWS says `not_covered`, so judging it means setting home
somewhere NWS does not reach — the Bahamas, Manila, anywhere outside the US and
its territories — and looking. Three things to judge there: does *"Open-Meteo,
nearest model point 14.59, 121.00"* read as provenance or as a coordinate leak;
does *"Flood warnings aren't published for this location"* land as a fact or as
a missing feature; and does a rainfall total from a raw model beside an
American storm's read as the same kind of number. **The old Bahamas hole is
now closed** — §48.5's never-rendered 404/400 pair now falls through to a real
forecast instead of a coverage sentence.

**Surge at home has never rendered and needs a GDACS-basin storm near a house.**
West Pacific, Indian Ocean, Southern Hemisphere — not an NHC basin, see the
hole below. Judge: does *"About 0.5 m of coastal flooding is modelled at
Shomushon"* read as useful or as trivia beside the wind numbers; does *"it keeps
rising for about six hours after it first arrives"* earn its clause; and — the
one that matters — does the `out_of_range` pair of sentences read as **a gap in
what we know** or as an all-clear. If it reads as an all-clear that is a §5
bug, not a wording preference.

**BOTH COASTAL STRIPES ARE PAINTING FOR THE FIRST TIME — JUDGE THAT BEFORE
ANYTHING ELSE ON THIS LIST.** `SPEC-DATA.md` §50.11, §51.4. Between shipping and
2026-08-19 neither `cap-coast.js` nor `gdacs-surge-coast.js` could draw: both
handed `areaSelect()` the wrapper `coastRings()` returns instead of the rings
array inside it, and the surge one also handed a single ring where a list was
wanted. Every earlier judgement of these two was a judgement of a blank map.
`tools/test-coastal-paint.mjs` now runs the real layers through the real engine
and asks whether anything landed.

**The same commit is a performance fix, and that needs glass too.** The select
memo was keyed on `coastGeneration()`, which bumps whenever tiles stream, so
every engine push paid a full basemap decode on the main thread — measured in
the field at 421 blocked-thread events totalling 38.7 seconds in one four-minute
Windows visit, against four to fifteen on the same laptop the day before. Judge
on a desktop with a GDACS storm open: does dragging the globe feel clean, and
does the cage's storm ridge rise in one motion rather than crawling. Telemetry
answers it too — `longtask_n` on a `windows` session should be back in single
digits.

**THE SURGE STRIPE NOW REACHES 13 km AND THAT IS THE DIAL.** `SPEC-DATA.md`
§51.4. On the archive's towns this turns 47 flecks into five continuous
stripes, and the measured window for the constant is 13 to 16 km — below 13 a
town is stranded, above 16 the stripe starts painting coast GDACS modelled
nothing on. Judge: does a continuous Big Island stripe read as a coast, or as
one town's number claiming too much ground. **Also judge the GAPS**, which is
the harder half — the two long empty stretches of the south shore stay
unpainted on purpose, and the question is whether a reader takes that as "not
modelled" or as "safe here". If it reads as safe, that is a §5 bug and the fix
is wording somewhere, not a wider corridor.

Still worth judging on the same pass: whether the teal-to-magenta ramp is
distinguishable from NHC's blue-to-purple at a glance.

**Every archived height is sub-metre, so nobody has seen the ramp move.** The
whole three-storm archive spans 0.10 m to 0.48 m: rungs 0 and 1 of five. The
top three colours and the "deepest town elsewhere" sentence have never
rendered. Needs a real typhoon on a real coast.

**Local agency alerts — a drawer section AND a coast stripe, neither judged.**
`SPEC-DATA.md` §50. CAP alerts from national weather agencies, matched to a
GDACS storm by country, shown as text and — since 2026-08-19 — banded onto the
coast by `map/layers/cap-coast.js` through the NHC stripe's own selector and
widths. **The question is whether it earns its place.** The whole global feed
was ONE row at an hour with three live cyclones, so on most storms this reads
"no national weather agency in the affected countries currently has a tropical
cyclone alert in force" — true, and possibly not worth a section. Judge that
first; the rest is cosmetic if the answer is no.
**Second, the paint at country scale (§50.11), which nothing has seen.** An NHC
warning covers a stretch of one coast; a CAP area covers a nation. The
Philippines is 7,600 islands and Costa Rica takes in both its shores. Correct
and possibly far too much — also whether that volume meets
`COAST_BAND.maxBandVertices`. `areaPadKm` is the dial if it undershoots at a
river mouth or an offshore island.
**Third, the wording chevron (§50.4).** A non-English alert arrives collapsed
with only the coded English line showing — which names a severity and NOT a
hazard. Judge whether "Possible threat — expected later, possible" over an
agency and an area is enough to be worth reading, or whether it reads as an
alert with the subject missing. If it is the second, the answer is a
translation pass, not a layout tweak.
**Fourth, the new gap sentence (§50.12), which will be on screen more often
than the alerts are.** A storm with no country listed and an alert in force
somewhere now reads "this is a gap in what we know, not an all-clear". Judge
whether that lands as honest or as alarming boilerplate on a storm nowhere near
anyone — it fires on EVERY unattributed storm whenever any agency on Earth has
anything out, which on 2026-08-19 was two of the three live storms.
Then, when a Western Pacific storm is live: does PAGASA's alert — English, so
no chevron — read as informative or as clutter; does the
footnote successfully say "this agency covers this country" rather than "this
alert is about this storm"; and on an NHC storm, does pointing at **In effect**
above read as an answer or as a dead section.

**THE COUNTRY JOIN IS THE FEATURE'S REAL CEILING, AND IT IS NOW BEING
MEASURED.** `SPEC-DATA.md` §50.12. Every hourly archive run writes a
`countryMatch` block into the manifest: each live storm's ISO-2 codes, episode
and position, every country with an alert in force, and the alert countries no
live storm carries. Read a few days of `history/*/manifest.json` and the
question answers itself — a country that sits in `unmatchedAlertCountries` and
later attaches to a storm was an attribution LAG, one that never attaches was a
coverage HOLE. The hole is the harder one: GDACS tracks named cyclones and
agencies warn on depressions and invests, which is exactly what happened on
2026-08-19. **Do not decide how to close it before there are several days of
snapshots** — the fix for a lag is patience and the fix for a hole is a second
storm source, and one hour of data cannot tell them apart.

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

**One corner of rainfall nothing has exercised.** The `no_hazards` path is
proven against a SYNTHESISED product (§48.11). *The Bahamas corner is gone —
a house outside NWS coverage now gets a real forecast from the second source
(§48.14), and what needs looking at is above.*

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

**THE AMERICAN HALF OF SURGE IS THE WHOLE OF WHAT AMERICAN SURGE NEEDS, AND
`/api/nhc/surge` DOES NOT EXIST.** `SPEC-DATA.md` §51.5. `fetchSurgeLive()`
calls that route, gets a 404, throws, and every NHC-basin storm shows
`unavailable` — today, whether or not a watch is out. **Nothing fills it in
from GDACS and nothing should** (Aaron, 2026-08-19: NHC's surge data is trusted
over GDACS's, so in NHC's basins NHC is the only source; §51.5 is settled and
the test guards it). That makes this route the only path to surge on an
American storm.

**Still held for a storm with a watch in force, and that is not procrastination.**
`SPEC-DATA.md` §4.8. The Peak Storm Surge service only answers while a US storm
has surge watches in effect, and `SURGE.liveColorFields` is an ordered list of
GUESSES at where the colour lives on the live service — the fixture's field
names are known, the live ones are not. Against a storm half a planet away there
is no telling a right answer from a plausible one. Build the route and
surge-at-home together the moment such a storm appears; they share one
fetch-and-filter.

**Two glass questions §49.12 records and nothing has answered.** Does *Was
strongest* beside *When it was closest* read as one story in two tenses or as two
unrelated facts (Q6)? And on a storm mid-pass, is the single line *It came closer
earlier* enough, or does the past want its own vertical (Q5)? Both need a storm
sitting in that state long enough to look at.

## SCOPED, NOT STARTED

**JTWC'S `.tcw` IS A BETTER SOURCE THAN THE PRODUCT WE PARSE, AND ONE PIECE OF
IT DELETES CODE.** Read 2026-08-19 on two storms at one hour, archived hourly
under `latest/jtwc/` from now on. Four separable wins, in order of confidence:

1. **`resolveDtg` and `nextDtgAfter` in `functions/api/jtwc/storms.js` stop
   being necessary.** They exist only because the warning text stamps `DDHHMM`
   with no month or year, so the relay guesses the calendar against read time
   and guards the rollover. The `.tcw` header carries `2026081912` and every
   forecast step is a plain offset from it. That is a class of bug removed, not
   just lines.
2. **Forecast wind footprints outside NHC.** Per-quadrant radii at 34/50/64 kt
   out to 120 hours — the same shape `lib/windswath.js` already renders from
   NHC layer 15, which today has no non-American half.
3. **A nine-day past track with intensity on every step**, against GDACS's
   twelve centre dots for Hernán.
4. **Possibly one fetch where the app makes two** — the `.tcw` embeds a full
   warning text. NOT a swap: its subject line reads `SUBJ:` where the plain
   product reads `SUBJ/`, the character `parseSubject` keys on in the relay AND
   in `lib/advisory.js`, which are held together by a test. `web.txt` is now
   archived beside it so the rest of the comparison is a diff.

**DO NOT WRITE THE PARSER OFF THIS SNAPSHOT.** Two storms, one hour, one
hemisphere. A formation alert's `.tcw` has no forecast rows and no radii at all
and says ALERT where a storm says WARNING, so the layout varies by system type
before any basin question is asked. Wait for a Southern Hemisphere storm in the
72-hour window and write it against a corpus, the way SHIPS was done.

**Two views are over §12's ~700-line ceiling and both want a cut before they are
touched again.** `ui/view-home.js` is 1,413 — the strength strip and its figures,
the countdown rail, and the quiet/error/no-home states are three separable
concerns sharing a file. `ui/view-storm-detail.js` is 1,440; the stamp, the
section renderers, the advisory record and the stepper are its four. Each split
should be its own pass with **no behaviour change**, so a break can only be the
move.

**BASIN GROUPING IS WANTED AND NOT STARTED.** Areas should sit under the same
basin headings the storms do. **The blocker is not layout:** `Being watched`
is currently the only surface that can say the outlook is DOWN, and dissolving
the section leaves that message with no home — repeated per basin, or floated
to the top where it reads as being about the storms. Decide where an outage
speaks before moving any rows. Two smaller things it drags in: an ordering rule
within a basin (storms and areas are not on one scale), and basin headers that
contain only a watched area, which at a glance can read as an active threat.

**A quiet basin is believed at once now, and nobody has seen that happen.**
`SPEC-DATA.md` §45.5. The KMZ states the all-clear in a dated sentence, so the
six-hour hold no longer stands between a genuine all-clear and the screen. The
hold still exists for a document that goes quiet WITHOUT explaining — a shape
NHC has never published in 72 hours of archive. If it never fires, the whole
held apparatus becomes a candidate for deletion.

**The unlabelled LineString is parsed, carried, and drawn nowhere.** Present in
23 of 72 hours, always when a disturbance sat outside its own area. Four
samples, one disturbance, one basin — decide what it is before deciding whether
to draw it.

**Ring winding is opposite between the two paths.** Nothing drawn today cares.
The planned 3D land fill triangulates rings and will.

**The 3D land fill should be shapes, not a picture.** Feeding `RINGS` to the GPU
as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling, and turns retheming into a recolor. Traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, flat
triangles cutting chords through the sphere. `earcut` (~10 KB, no build step) does
the triangulation. **Not during cyclone season, and not in the same pass as the
engine upgrade** — both are surgery on `map/globe3d.js`.

**The three.js r128 → r182+ upgrade gates nothing.** Ordinary maintenance now.

**PASS 2 — global radar, through the fewest sources that hold quality.**
`SPEC-DATA.md` §4. Today's box is NOAA only, roughly the Americas. **The honest
framing is MORE COASTLINES, not global** — ground radar needs ground, and no
radar exists over open ocean anywhere on Earth. The storms it would newly reach
are ones already near land, which is when radar matters most.

## KNOWN AND ACCEPTED

- **`aoi_surge` IS NOT A SURGE FOOTPRINT. SETTLED 2026-08-19, DO NOT RE-ASK.**
  `SPEC-DATA.md` §51.1. Fetched and read: an affected-PLACES export — cities,
  provinces and urban areas, `intensity: 1` on every feature, and no height,
  surge, water or depth field among its twenty keys. Its two real shapes are a
  Korea/Honshu outline and a model-domain bounding box, and it names Korea,
  Japan and the Philippines for a storm whose surge export names the Northern
  Mariana Islands. There is nothing in it to draw. The derivation that fetched
  it is deleted; §51.4's town bands are not a stand-in for a better geometry,
  they are the whole of what this product publishes.
- **NOBODY PUBLISHES PAST WIND EXTENT OUTSIDE NHC. SETTLED, DO NOT RE-ASK.**
  GDACS: every band on every live storm is dated at or after its bulletin —
  checked across all three storms in the archive 2026-08-18. JTWC: all four
  per-storm products read 2026-08-19 on Saudel (17W) and Lala (01C), and none
  carries a past radius. The `.tcw` comes closest and is the proof it is
  deliberate — its best track repeats each past hour once per wind threshold the
  storm met, with the radius columns stripped out. So NHC's layer 13 is the only
  source of past wind footprints on Earth, and that feature stays American.
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
