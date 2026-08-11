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
§16. Wind and the trend word are gone from the row; a column that cannot be
filled for every global storm goes to another surface. Judge: three lines per
row is 74px against 55, roughly 870px of scroll for fifteen storms against 580.
If it reads as bloated, the third line is the designed cut. Does the ↘/↗ read as
a direction, and does losing the wind number hurt?

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

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. Detection is client-side; the app must
be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

**A Cat 4 has never been on this globe.** The severity ramp above Cat 2 is
untested by observation. So is the cone, swath and warnings together at basin
zoom — the densest this map ever gets.

## SCOPED, NOT STARTED

**`ui/view-home.js` is 1,257 lines and wants splitting before it is touched
again.** §12's ceiling is ~700 and this is nearly double it, having grown by 400
in one session. It holds at least three separable concerns: the strength strip
and its figures, the countdown rail, and the quiet/error/no-home states. The
split should be its own pass with **no behaviour change**, so a break can only
be the move.

**The countdown's `now` row repeats the `Where it is` section, word for word.**
`SPEC-UI.md` §8. Kept deliberately — the countdown is the chart's accessible
twin and must stand alone — but it needs a near storm on glass before that
argument survives contact. Cut one, or leave it.


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
