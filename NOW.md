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
> **THE FIRST SCREEN IS THE PRODUCT.** `IN FLIGHT` and `NEXT UP` stay short
> enough to read at a glance, because this file's whole job is orienting the
> next session in its first minute. Length accumulates BELOW them.
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

## IN FLIGHT

**Everything under this heading is BUILT, DEPLOYED AND UNJUDGED.** The as-built
description is in the spec section named beside each one; what is here is only
the question a tool cannot answer.

**Tapping your own house on the globe is the one Home camera path still
unjudged.** That gesture flies to the house at `GLOBE.homeZoom` and THEN opens
the drawer, so a one-shot flag stops the drawer's own framing flight running on
top of it (`SPEC-MAP.md` §9.16). Every other route in was confirmed on glass;
this one is a different gesture and has not been. If it ever stutters or lands
at the wrong zoom, that flag is the first thing to read.

**Settings will grow into the bug Home just came out of.** `SPEC-UI.md` §16. It
focuses whichever segmented option is currently checked, measured 309px into a
424px body — 79px of headroom. One more section above it and the focus ring goes
under the fold. `preventScroll` means the panel stays put rather than jumping,
which is the better failure, but a keyboard user loses the ring. Not fixed: it
changes a surface nobody has asked about, and the margin is real today.

**Every section heading is one grouped selector in `ui/panels.css`.** Adding a
heading anywhere means adding its selector to that list. If a new heading looks
subtly unlike its neighbours, that is the symptom — check the list first, then
check whether a type declaration crept back into `home.css`.

**The strength strip's third figure is coloured now.** `SPEC-UI.md` §8.
`Strongest` was the only cell falling through to plain white beside two coloured
ones. Judge: three coloured numbers in a row may now read as busy rather than as
consistent — the alternative, if so, is colouring none of them and letting the
category words underneath carry it.

**The storm list's freshness column is never blank.** `SPEC-UI.md` §16. Every
row with an observation time says its age; muted when current, amber when
overdue, red when the source has stopped. Judge: a column of grey timestamps on
fifteen rows is new visual weight in the list, and the amber ones now have to
win against fourteen quiet neighbours rather than against nothing.

**The storm name on the map is bigger, brighter, and further off the dot.**
`SPEC-MAP.md` §9.9. 14px in its own themed ink against 12px in the chrome's
secondary. **None of it is verified against a real basemap** — the sandbox
cannot reach `tiles.openfreemap.org`. Judge on a phone, both themes: does the
name now beat the state and country labels around it, and does the light
theme's near-black read on a grey globe. If it is too loud, the dial is
`SIZE.stormLabelPx`; if the halo now looks like an outline rather than
legibility, `stormLabelHaloPx`.

**Forecast timestamps no longer lie along the track.** `SPEC-MAP.md` §7. A
due-west storm tilts to −20° instead of laying every label flat on the forecast
line; due-north still stays horizontal. A side effect worth watching: dense
westward tracks now keep ALL NINE labels on one side where they used to thin to
seven, because the tilt separates parallel strips better. Judge: does nine
labels on a crowded track read as informative or as a wall, and does −20° look
deliberate or like a mistake. **Two rules were built here and one was cut** —
the clearance rule against distant track legs never changed an outcome on any
of nine fixtures and was removed rather than shipped unproven.

**The rail carries the storm's own story now, and it is the longest it has ever
been.** `SPEC-UI.md` §8. Class milestones (tropical storm / hurricane / major
hurricane, up and down) and the forecast peak. On a strengthening storm that is
up to four milestone rows on top of four wind rows, the pass and `now` — ten.
Judge: does it read as a narrative in order, or as a wall of text? If it is too
long, the designed cut is the intermediate wind endings, then the weakening
milestones. NOT the all-clear and NOT the worst arrival.

**The rail now names every wind that reaches the house.** `SPEC-UI.md` §8.
Arrivals ascend, endings descend, and the last field to lift says "The wind is
past you". Judge: on a two-field storm that is up to four wind rows plus the
pass plus `now` — does it read as escalation-then-recovery, or as a wall? If it
is too long, the designed cut is the intermediate endings, NOT the closing row.

**A KNOWN TEST GAP, stated rather than left to be discovered.** The
earliest-arrival hedge is taken from the weakest reaching field; taking it from
`worst` is a real bug that `tools/test-home.mjs` does NOT catch. The hedge row
is suppressed under two hours and the nested fixture's wind arrives inside a
day, where NHC's track error is small enough that both gaps come out under an
hour (measured 0.48 h and 0.96 h), so no hedge row renders and no assertion can
read one. The ordering fact behind the bug IS asserted against the corridor.
Closing it properly needs a second fixture whose wind arrives days out.

**A watch in force that the map cannot draw.** `SPEC-DATA.md` §4, `SPEC-UI.md`
§16. NHC published Lala's Hurricane Watch with a null geometry, so the panel
named it and the coast stayed unmarked and nothing said so. The IN EFFECT entry
now carries **not on the map** with a line naming why. Judge: does it read as
"NHC has not drawn it yet" rather than as our bug, and is the tag legible at the
far edge of the row without pulling the eye off the product name. **Whether a
shapeless watch is a Central Pacific quirk, one bad advisory, or normal is still
unknown** — layer 8 is now in the hourly archive, so read
`latest/geometry/nhc-*-watchWarning.geojson` across a few runs before deciding
whether the KMZ fallback is worth building.

**The waiting dots and the split `pending` rung.** `SPEC-UI.md` §16, §8. Every
"Checking…" in the app now animates its three dots, and the home chip's
`pending` rung was split three ways so it only says "Checking…" while something
is genuinely running. Judge: does the pulse read as thinking rather than as a
fault, is it distracting beside a live storm, and does "No forecast yet" land
better than the chip having nothing to say.

**The archive's NHC track snapshot has never actually run.** `SPEC-DATA.md` §4.
Layers 5 and 10 per active storm land under `latest/geometry/` on the hourly
job; the change was pushed minutes after the last run, so nothing has exercised
it. Confirm `nhc-<name>-<bin>-pastPoints.geojson` arrives, then read a real
`stormtype` off it — that field is what two bugs in one week turned on and
nobody has ever seen one.

**Genesis outlook — the held-empty memory has never once fired.**
`SPEC-DATA.md` §45.5, `SPEC-OPS.md` §17.7. An empty NHC outlook layer inside six
hours of a real answer is now held rather than believed, because "NHC is
watching nothing" and "NHC's layer is broken" are byte-identical on the wire.
The warm store was empty for this feature's whole life, so nobody has seen the
amber held note on glass. Judge: does it read as a stopped clock rather than a
failure, do the patches stay on the globe, and does a genuine all-clear still
get through once six hours lapse.

**Genesis arbiter — built, and nothing calls it.** `SPEC-DATA.md` §45.9.
`lib/outlook.js` reconciles the layer count against the `ABNT20`/`ABPZ20`
bulletin into six verdicts and is proven against the real bulletin.
`data/genesis.js` does not consult it, so app behaviour is unchanged. The wiring
and the sentence on screen are the remaining work.

**Genesis patches on glass — the one open design question.** `SPEC-MAP.md` §45.7.
Does a hatched sand patch read as *nothing here yet*, or as a storm-shaped thing
that undoes the app's clearest signal — that a coloured blob is a real cyclone?
Phone, both themes, planet and basin zoom, with a real storm beside it. Also:
are Low/Medium/High distinguishable without reading the number, and does the
section earn its space with several storms up?

**Storm list row — the biggest subtraction in the app's history.** `SPEC-UI.md`
§16, §16.4. Wind and the trend word are gone from the row; a column that cannot
be filled for every global storm goes to another surface. The ↘/↗ pair is gone
too — the arrow is now a real compass heading. Judge: three lines per row is
74px against 55, roughly 870px of scroll for fifteen storms against 580. If it
reads as bloated, the third line is the designed cut. Does losing the wind
number hurt, and does the rotating arrow read at 12px on a phone?

**The header's title block is settled: dot and name centred together, second
line under them.** `SPEC-UI.md` §16.5. Three arrangements were built before this
one. Padding the second line to chase the name aligned the two lines to each
other and left both 10px off the stepper. Shifting the first line so the name's
letters landed on the axis measured perfectly and left the dot hanging outside
the group. The dot is part of the title and counts in the centring, which is the
arrangement the app started with — the only real bug was the chip's stray auto
margin. Judge on glass: dot-and-name, chip, stepper, headings all on one line.

**The detail panel's dot was flat and 2.5px low, and nothing could have caught
it.** It borrowed `.row-swatch` from the storm list, whose glow is composed from
a custom property the identity block never set — an invalid `var()` makes the
whole `box-shadow` compute to `none`, silently — and whose `margin-top: 5px`
pins a dot to the first line of a multi-line row. `.drawer-identity-dot` now
lives beside the block it belongs to and both views render it. The check asserts
a live glow with real ink on both drawers.

**Two more `.row-swatch` callers in the detail panel are built the same way.**
`ui/view-storm-detail.js` lines ~721 and ~775, the wind-field and model legend
items, pass the colour as an inline `background:` rather than `--swatch`. Same
construction as the header bug, so almost certainly the same dead glow plus a
stray 5px offset on an inline list item — NOT measured, and not touched, because
it changes two more surfaces Aaron has not looked at.

**The header gives 9px above the name, not the 11 an earlier commit claimed.**
The top padding did double (4px → 8px) and the direction was right, but the
number was measured against a fixture with wider spacing than the app. Whether
9px looks like enough clearance from the sheet's rounded corner is a call no
check can make. If it still reads squeezed, the header's top padding is the dial.

**A box is not its contents, and this file's check learned it three times.**
Three separate assertions have read 0.0px while the header was visibly wrong,
each comparing two full-width boxes whose centres are equal by construction. The
centring assertions now measure the dot-to-name span, the chip's own box, and a
`Range` around bare text. The fixture's design tokens had also drifted from
`index.html` — 6/10/14/20 against 4/8/12/16 — so every pixel figure in two
commits was about a quarter too large; the check now parses both `:root` blocks
and fails on disagreement.

**A check that had been reading 0.0px whatever the chip did.** It compared two
full-width block boxes in the same parent, whose centres are identical by
construction, and passed with the chip visibly off to one side. It now measures
the chip's box against the name's box, and the harness exercises the pairing
that lets the bug exist: a name WIDER than the chip, where the block has free
space in it. Five mutations caught. The fixture was also using the dashboard's
swatch class for both drawers when the detail panel has its own — both 12px, so
the numbers agreed by luck.

**Both drawers now share one header and one stepper.** `SPEC-UI.md` §16.5. The
storm's name and its second line are the drawer title on both; `‹ 2 of 7 ›` is a
tight centred cluster pinned under it; Back says where it goes in words; "Home"
is a small eyebrow in the lead slot. The dashboard is now a fixed height so
stepping stops resizing the sheet, and the name sits the same distance below the
sheet's top edge on both drawers. Judge: does the storm name read as the panel's
heading now it is centred and smaller — on the dashboard it lost the
biggest-type slot it had. Is the eyebrow legible enough to answer "which drawer
am I in", or so quiet it may as well not be there. Would anyone find that the
header title is still tappable, which is the ONLY route from the dashboard into
the storm's own panel. And does the camera flight on every chevron press feel
like navigation or like the map twitching while you compare two storms.

**The heading arrow is on three surfaces and none of them are judged.**
`SPEC-UI.md` §16.4. Storm row line 3, the detail panel's `Moving` row, and the
home dashboard's motion line, all off one component. Judge: does it read as a
direction rather than decoration; is the stroke heavy enough beside monospace
figures in both themes; and does a row with NO arrow (a GDACS storm with no
JTWC warning) look deliberate rather than broken — the slot is held open, so
the text should not shift.

**A storm nobody is analysing now leaves, and stays left.** `SPEC.md` §5.
DOLPHIN-26 could not expire on any device: the `lapsed` route re-ended it every
poll and reset the clock its own display window is measured from. Three fixes —
one ending per storm, an ended storm kept out of the live working set, and a
parse cutoff at `ENDED.stopListingAfter` so the app stops believing a feed row
GDACS will not retire. Judge on the next one: does "quiet since Sun 7:00 AM"
under a **Finished** heading read as coherent, or as two words arguing with each
other — and does the storm vanishing at hour 60 read as a decision rather than a
glitch. Nobody has seen the disappearance itself yet.

**The cone is measured and redrawn on the track.** `SPEC-MAP.md` §7.9. Judge the
flanks on a recurving storm; a straight forecast should look unchanged. Dial is
`CONE_SWEEP.blurDeg`, currently 2.5°.

**The white ring on each storm's first forecast dot.** `SPEC-MAP.md` §7.5. Does
it read as *start of forecast* rather than a second storm marker, given the
glyph sits roughly 40 nm away? Two alternatives were tried and reverted on
glass — equalising the stroke widths, and a dark casing disc. Both settled.

**The limb glow smears along the rim.** `SPEC-MAP.md` §9.14. Spin it, both
themes: does the light read as lying ON a curved surface? `GLOW.smear` (1.4)
down if too streaky, `GLOW.squash` (0.35) down if too thin.

**The light theme is greyscale, and a theme change no longer rebuilds the map.**
`SPEC-MAP.md` §9.2, §9.3. Judge: does a storm read at a glance on the grey
globe — that is the whole bet. Flip the theme with a storm selected and watch
the cone and tracks; nothing should flash or stay dark. **None of it is verified
on a real basemap**; the sandbox cannot reach `tiles.openfreemap.org`.

**Sliders need a thumb grab; drawer content fades under the header.** `SPEC.md`
§10, `SPEC-UI.md` §16. Scroll the settings sheet fast past all four sliders —
nothing should move. Then drag a thumb: no lag on the first pixel, and still
grabbable at either end of its range. Desktop mouse: the track no longer jumps
to a click, which is intended and is a real behaviour change.

**Every relay route rebuilds its cache hit, and GDACS reports its own age.**
`SPEC-OPS.md` §17.7. GDACS can now raise the delayed banner for the first time
ever — a source whose complaints have never been seen. Watch for false alarms.

**The app replays Hurricane Ida at `/?replay=ida`.** `SPEC-UI.md` §8. The real
globe, dive, drawer and home dashboard against NHC's published bytes.
**Imagery is the open hole:** satellite and radar do not route through
`ENDPOINT.relay` and there is no archived imagery, so switching them on during a
replay paints TODAY's radar over a 2021 hurricane. Suppress with a stated reason
or find an archive — doing nothing is what §5 rules out.

**The home dashboard was rebuilt around four named sections, and only the far
layout has been judged.** `SPEC-UI.md` §8. Storm stepper with chevrons, far mode
for storms that cannot reach the house, strength as three intensities, the
`<name> right now` block folded away, and most of the closest-pass prose cut as
redundant with the chart and the countdown. The FAR layout was seen on glass and
passed. **The NEAR layout has not been seen since the rewrite** — it needs a
storm within `APPROACH.relevanceNm`, and there has not been one. Judge in order:
does the inverted axis read without re-checking which way is closer; do three
translucent bands stay legible in daylight; do five angled time labels and their
gridlines help or clutter; does the dashed amber read as a hedge rather than a
second forecast; does the wind rail answer "when does it arrive and how long
does it stay" or compete with the chart below it; and — the one this rewrite
gambled on — is `±37 mi forecast error — that reaches your house` still
frightening enough now that the two sentences explaining it are gone.

**One duplication survives on purpose and may not survive glass.** `SPEC-UI.md`
§8. On a near storm the `Where it is` section and the countdown's first row say
the same words. The countdown is the chart's accessible twin and has to be
self-contained, which is the argument for keeping it; it may simply look like a
mistake with both on screen. Aaron's call, and it needs a near storm to make.

**A dead storm's trail is no longer a souvenir of who was watching.** `SPEC.md`
§5, `data/ended-track.js`. The trail was whatever geometry THIS device happened
to hold when the storm was promoted, so a device that first met a storm already
past `lapsedAfter` lapsed it on its first poll — before the warm could land — and
filed it with an empty track, permanently. Measured in a real browser with clean
storage: one poll, `pastTrack: none`, zero points. A lapse is the one ending where
the source is still listing the storm, so it is the one ending that can go and
fetch what it missed. Judge: does a finished storm that arrives trackless get its
dotted line inside one poll on a phone that has never seen it before, and does the
line look identical to one captured live rather than subtly shorter.

## NEXT UP

**1. WINDOWS BLOCKS FOR 3.2 SECONDS AND NOBODY HAS LOOKED.** The only real
performance problem left. Clean slice, `timings_ok = 1`:

| | iPhone | Android | Linux | Mac | **Windows** |
|---|---|---|---|---|---|
| Boot veil lifts | 1,158 | 1,209 | 829 | 596 | **2,764** |
| Storms on screen | 2,132 | 2,219 | 1,279 | 799 | **4,670** |
| Blocked | *(blind)* | 430 | 884 | 17 | **3,210** |
| Worst tap | 18 | 115 | 146 | 45 | 131 |

21 clean sessions across 7 stranger machines, so it is not one weird PC. Worst
single session: 29,604 ms of blocking. Everything else clears its bar.

**2. WHAT A MAPLIBRE FRAME COSTS — UNMEASURED, AND THE GATE ON ITEM 1.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint; moving water pays it too via
`triggerRepaint()`. The free half is already gone — past `zHandoff` the loop no
longer schedules a frame it throws away. The remaining repaint cannot simply be
skipped, because `setCenter` is what `map/globe-follow.js` mirrors to make the
rotation visible. The four rules a fix must follow are in `SPEC-MAP.md` §9.7.
Needs a real device with a real basemap; the sandbox has no tunnel to one.

**3. GDACS STILL LEAVES PEOPLE ON A SPINNER, though less so.** 41 of 46 GDACS
loads reached `ok` against NHC's 44 of 46, with **zero errors either side** —
the misses are sessions that ended still loading. Retry has been pressed zero
times in 193 sessions, so that path has never been exercised by a real user.
Two changes have landed since these numbers and both should move them: the
stamp fix, and the two-second rung. **Re-read before acting.**

*Dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck, and modulepreload was measured and rejected (`SPEC.md` SETTLED).
The 4096×2048 land texture costs ~511 ms of upload plus ~202 ms rasterising on
cold load — worth removing, but not urgent and not user-facing, and the answer
is filled triangles (below), not a smaller canvas.

## HELD FOR WEATHER

**Watch a storm get a real final warning.** The `declared` end path has never
fired on a real storm. A real JTWC final warning proves it. Detection is
client-side; the app must be open. DOLPHIN-26 was the candidate and never got
one — it simply stopped being analysed, which is what `lapsed` is for.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

**A Cat 4 has never been on this globe.** The severity ramp above Cat 2 is
untested by observation. So is the cone, swath and warnings together at basin
zoom — the densest this map ever gets.

## SCOPED, NOT STARTED

**Two views are over §12's ~700-line ceiling and both want a cut before they
are touched again.** `ui/view-home.js` is 1,413 — the strength strip and its
figures, the countdown rail, and the quiet/error/no-home states are three
separable concerns sharing a file. `ui/view-storm-detail.js` is 1,440, and the
stepper was the last thing that went in without a cut list; the stamp, the
section renderers, the advisory record and the stepper are its four. Each split
should be its own pass with **no behaviour change**, so a break can only be the
move.

**Two features are specified and waiting in `SPEC-NEXT.md`** — the intensity
chart (§46) and the environment ribbon (§47). Endpoints fetched live, field
names transcribed from the real schemas, open questions written down. Read the
section, not this line.

**The outlook KMZ is archived and unparsed.** Layer 3 is empty on BOTH NOAA map
services while NHC's website draws areas (§45.2 — settled, don't re-check).
`gtwo_atl.kmz` is the second publication path and is snapshotted hourly. Next
step is to open the real bytes and decide whether a KML fallback earns its
weight. The Pacific filename in the archive is inferred and may 404.

**GDACS names reach the screen with their year suffix** — the row says
`DOLPHIN-26`, because `data/gdacs.js` takes `eventname` raw. `lib/advisory.js`
already strips it for matching and nothing strips it for display. One line in
the parser, but it moves map labels and the detail title too, so it wants its
own pass.

**The 3D land fill should be shapes, not a picture.** Feeding `RINGS` to the GPU
as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling, and turns retheming into a recolour.
Traps: rings-inside-rings for inland lakes, the antimeridian with Antarctica
worst, flat triangles cutting chords through the sphere. `earcut` (~10 KB, no
build step) does the triangulation. **Not during cyclone season, and not in the
same pass as the engine upgrade** — both are surgery on `map/globe3d.js`.

**The three.js r128 → r182+ upgrade gates nothing.** It only ever gated the cut
§41–§43 effects. Ordinary maintenance now — do it when there is a reason.

## KNOWN AND ACCEPTED

- **`functions/tiles/` is dormant, and dormant SERVER-side.** `TILES.useR2` is
  false, so the Protomaps branch in `map/style.js` and the 1,721 vendored
  pmtiles lines never run. A Pages Function is not downloaded by a visitor, so
  this costs nothing on the wire — it is a maintenance question, not a
  performance one. `[DECIDE]` whether R2 is still wanted as an option.
- **The `> 0` guard on `index-of` in the state-name suffix trim is untested.**
  Its suite went with the three-globe cut. `SPEC-MAP.md` §11.2.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
- **The gap between a warning being issued and the winds arriving is not
  computable in the app.** Layer 8 carries what is in force, not when it was
  issued, and nothing stores advisory history on device. It is the most
  actionable number in the archive and it is out of reach.
- **Three eviction functions are never called** — `evictTcgpIndex`, `evictCarq`,
  `forgetBand`. Three caches that can be filled and never emptied. That is a
  memory question, not a tidiness one, and nobody has asked it.
- **iOS clean long-task numbers are an instrumentation gap.** All WebKit sessions
  report `longtask_n = 0` because WebKit does not implement the observer.
  `ttfb_ms`, `mem_gb` and `conn_type` are blank there for the same reason. Do not
  read any of those columns as "iPhones never block".
- **Filter telemetry on `timings_ok = 1` or repeat a mistake this project already
  made.** Backgrounded tabs (`timings_ok = 2`, averaging 322,440 ms to storms)
  poisoned every iPhone average ever computed here. iPhone's real position is
  second fastest.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength
  comes from GDACS's own `severitytext`; the alert level is parked unrendered in
  `raw`. Logged because the question keeps getting re-asked.
- **Three suites need Playwright and do not run in a bare sandbox.** Expected,
  not broken. They run once `node_modules` is on the path, and on the runner.
