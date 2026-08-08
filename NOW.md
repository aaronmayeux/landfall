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

**==> SHIPPED AND UNSEEN: EVERY RELAY ROUTE NOW REBUILDS ITS CACHE HIT, AND
GDACS FINALLY REPORTS ITS OWN AGE. <==** Eight routes converted, three left
publishing a cache directive on purpose, `SPEC-OPS.md` §17.7. GDACS was stamping
the storm list with the phone's clock, so the "GDACS feed delayed" branch was
unreachable code and NHC was silently the only feed that could raise the banner;
`data/gdacs.js` reads the relay's header now, same as `data/nhc.js`.

**Judge on glass, in this order:**

1. **Does the delayed banner ever fire wrongly now?** The false-alarm ceiling
   went from 90 minutes to 60 with the third clock gone, so it has real margin —
   but GDACS can raise it for the first time ever, and a source that has never
   been able to complain is a source whose complaints have never been seen.
2. **`X-Landfall-Cache` on any relay response** names which of five layers
   answered. Never opened. One header read answers questions that have cost
   whole sessions of inference.
3. **Whether the warm store's key count comes back down.** `KEY_TTL_SECONDS` is
   48 h, so dead storms' keys should drain within two days of a storm ending.
   `GET /api/nhc/inspect?warm=1&key=...` now answers this in one screen: one row
   per route family, and `staleOverTtl` should read **zero**. It read 184 keys
   with the oldest 12.3 days on 2026-08-07, which is what the expiry is for.

**==> SHIPPED AND UNSEEN: THE WHITE RING ON EACH STORM'S FIRST FORECAST DOT. <==**
White at 3 px against the dark 1.5 px every other dot wears, marking which end of
a track is the future. As-built is `SPEC-MAP.md` §7.5.

**Judge two things on glass.** Whether white survives against a pale Cat 1 fill at
the far end of the ramp — the one pairing where the ring could vanish into the
case it exists to disambiguate. And whether it reads as *start of forecast*
rather than as a second storm marker, since the glyph sits roughly 40 nm away.

**It marks tau 0, not the current position.** Tau 0 is the analysis time, up to
three hours behind the glyph. `SPEC-MAP.md` §7.4 carries the distinction. Do not
collapse them — they are close enough on a globe to look like one thing.

## DEEP IS PARKED — READ THIS BEFORE REOPENING IT

Sky is the globe that matters until December (`claude/backlog.md`, freeze
window). Everything built on Deep is **as-built in `SPEC-GLOBES.md` §42.1 and
§43.2** — the volcano shapes, the lava model, the water optics, the magma seams,
the plate lines and their labels. **Read it there. None of it is repeated here.**

Aaron has seen and ACCEPTED the volcano layer, its colours and the lava flows.
Accepted is not validated. **What has never been on glass, in the order to judge
it:**

1. **Does a refined mountain look wrong beside an unrefined one?** An erupting
   volcano is sampled 3x finer, so it has gullies its dormant neighbour lacks.
2. **Do erupting volcanoes read as LIVE, and can you FIND them?** Two different
   failures now that live volcanoes share the plate seams' hue — separate them
   before touching either.
3. **The water**, after the tiling slope map and the constant half-vector. Is
   there water at all; can you see the seamount through it.
4. **Two-finger rotate near Kuwae, Kavachi or Palinuro** — ten seconds, and it
   is where the shore cut died three times before.
5. **The plate lines and the land fill both sag at the midpoint of the dive.**
   One structural cause in `DIVE.fade`; fixing one should fix both. Zoom in
   slowly from space and watch.

**NOTHING HAS BEEN SEEN WITH REAL LAVA DATA.** Zero flows in a given week is
plausible and looks identical to a broken shader — the `!L` badge is the only
way to tell.

**Open debt on Deep, none of it urgent while it is parked:** `proto/volcano-3d.js`
(795) and `lib/volcano-ridge.js` (730) are over §12's ceiling with their cuts
identified; the ash channel has no archive, so one missed poll is one
permanently lost advisory (`claude/ash-archive-scope-2026-07-30.md`); the layer's
+y may be south, which would only show on a multi-member arc; and the "state
names" toggle is a silent no-op on Deep that whoever wires it into the real
drawer must hide.

## NEXT UP

**==> THE TELEMETRY WAS LYING AND IT IS NOT ANYMORE. READ THIS BEFORE ANY OTHER
NUMBER IN THIS FILE. <==** `timings_ok` has collected real values. **Only rows
where it equals 1 are measurements.** Everything below is that slice, 2026-08-07,
94 sessions across 20 devices:

| | iPhone | Android | Linux | Mac | **Windows** |
|---|---|---|---|---|---|
| Boot veil lifts | 1,158 | 1,209 | 829 | 596 | **2,764** |
| Storms on screen | 2,132 | 2,219 | 1,279 | 799 | **4,670** |
| Blocked | *(blind)* | 430 | 884 | 17 | **3,210** |
| Worst tap | 18 | 115 | 146 | 45 | 131 |

**1. WHAT WINDOWS IS DOING FOR 3.2 SECONDS. NOBODY HAS LOOKED, AND IT IS NOW THE
ONLY REAL PERFORMANCE PROBLEM LEFT.** 21 clean sessions across **7 stranger
machines**, so it is not one weird PC. Worst single session: **29,604 ms** of
blocking. Everything else on the table clears its bar; this does not.

**2. WHAT A MAPLIBRE FRAME COSTS — STILL UNMEASURED, AND STILL THE GATE.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint. **Moving water pays it too**, at map
zoom, via `triggerRepaint()`. Measured: drift pinned, zero MapLibre renders per
second; unpinned, one per frame. **Nobody has measured what one of those frames
costs**, and it needs a real device with a real basemap — the sandbox has no
tunnel to one. `proto/shell.js`'s self-driven loop is the shape of the fix. Do it
before smoke, dust or any further continuous effect. Prime suspect for item 1.

**HALF OF IT IS ALREADY GONE AND IT WAS THE FREE HALF.** Past `DIVE.zHandoff` the
loop used to schedule a frame anyway and throw the reading away. It stops now;
`tools/test-idle-drift.mjs` asserts the frame counts. **This does not touch the
repaint above**: `setCenter` is what `map/globe-follow.js` mirrors, so it is also
what makes the visible rotation happen and cannot simply be skipped.

**3. THE BOOT SCREEN IS NOT A FOUR-SECOND PROBLEM ON A PHONE.** `perfMark('globe')`
and `boot.done()` are the same moment in `main.js`, so `t_globe_ms` **is** the
veil lift — and on real hardware it is **1.2 s on iPhone and Android**. The 3,982
ms figure came from `tools/load-probe.mjs` at 4x throttle and was never a user
number. Windows' 2,764 ms is item 1 wearing a different hat.

The 4096x2048 land texture is still **511 ms in `texImage2D` plus 202 ms
rasterising** on every cold load (`tools/boot-profile.mjs`). Worth removing, on
memory and retheming grounds as much as speed — but it is **not urgent and not
user-facing**, and the answer is filled triangles (SCOPED, below), not a smaller
canvas. `claude/backlog.md` has the measurement that kills halving it.

*Two dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck (3982 ms healthy vs 3807 ms unreachable), and preloading was
measured and rejected (see `_headers` and the probe's `--preload` switch).

**4. GDACS IS STILL THE FEED THAT LEAVES PEOPLE ON A SPINNER, THOUGH LESS SO.**
41 of 46 GDACS loads reached `ok` against NHC's 44 of 46. **Zero errors either
side — the misses are sessions that ended still loading**, not failures. Retry
has been pressed **zero times in 193 sessions**, so that recovery path has never
been exercised by a real user. **Two things have landed since these numbers were
taken and both should move them, so re-read before acting:** the stamp fix, and
the two-second rung — a session that used to sit on "Checking the oceans…" for a
minute now says something at two seconds, which is the likeliest reason nobody
ever reached the retry button.

**5. GULLIES ARE THE HALF OF CHARACTER THAT DOES NOT FIT, AND THE MEASUREMENT IS
NOT TO BE REPEATED.** The grid is ~21 samples across a mountain and fine downhill
rills need roughly 3x that. Tripling `ridge.cellsPerRadius` to 30 on the
240-volcano drawn set takes it from **130,350 nodes to 1,108,989** and the build
from **134-288 ms to 994-4,021 ms** on a sandbox CPU faster than a phone, with
`ridge.maxCells` needing to rise 9x alongside or every cluster silently coarsens
back. **That is a blocking multi-second build on a phone.** The answer is
resolution that follows on-screen size, which is its own session.

**6. THE RENDERING DEEP DIVE, AND THE BRIEF IS ALREADY WRITTEN.** Cutting edge of
three.js and anything else that gets §41-§43's effects onto a phone. **The loaded
brief is `claude/globes-research-brief.md` in the Project** — every measured
number, the engine baseline, the rejected techniques with their evidence, and
eight named questions. Read it before searching anything. The gate on all of it:
**the app is on three.js r128 (2021), current is r182+.** Nothing in §41-§43 is
reachable without that jump, and the backlog defers it out of the Sky freeze
window.

## HELD FOR WEATHER

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. Detection is client-side; the app must
be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

## SCOPED, NOT STARTED

**THE 3D LAND FILL SHOULD BE SHAPES, NOT A PICTURE.** `landTexture` still
rasterises a 4096×2048 canvas and hands it to the GPU; draft-then-upgrade moved
that cost off the first frame but did not remove it. Feeding `RINGS` to the GPU as
filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU memory,
drops the resolution ceiling, and turns retheming into a recolour. Known traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, and
flat triangles cutting chords through the sphere. `earcut` (~10 KB, no build step)
does the triangulation. **Not during cyclone season, and not in the same pass as
the engine upgrade** — both are surgery on `map/globe3d.js` and two at once makes
a break impossible to attribute.

**The three-globe expansion.** One app, several globes, a switcher between them:
**Sky** (cyclone, and it is Landfall today), **Surface** (flood + drought +
wildfire), **Deep** (earthquake + volcano). Data in `SPEC-HAZARDS.md` §18–§26,
payloads under `samples/`.

**`SPEC-GLOBES.md` §38–§44 IS STALE ON BOTH THE SPLIT AND THE NAMES** and needs
rewriting before the second globe starts. It still describes Sea/Air/Land grouped
by rendering technique; the grouping is now by what the data IS, which is why the
names are altitudes. The live consequence is that **drought lost its free
rendering path** — per-dot dimming cost nothing only on the dot-matrix globe. A
full-screen haze is ~40% of the frame budget, so Surface needs a different answer,
and its land form is deliberately undecided until Deep is on glass.

Build order is §44 and it is engine-first: r128 → r182+, then the world shell,
then **Deep with earthquakes only** — the cheapest world, fully unblocked, and the
plate boundaries make it look finished on day one.

Still genuinely blocked: **the global drought raster** (Copernicus is Europe-only
and name-guessing is exhausted) and **the NIFC perimeter payload size** (429 on
every attempt). Neither gates the first two globes.

**The app is called Landfall and is no longer a hurricane app.** Name, subdomain
and install identity are `[DECIDE]` before a second globe ships.

## KNOWN AND ACCEPTED

- **The dead-code sweep found no dead FILES and 21 dead exported NAMES, and most
  of them are parked work rather than rot.** All 106 modules are reachable from
  `main.js`. Of the 21, the volcano-live four and the two surge formatters belong
  to Deep and to Phase 6 step 3 and stay. `_normalizeNhcStorm` and
  `_drainForTest` are test seams whose tests are gone. **The three worth a second
  look are eviction functions nothing calls** — `evictTcgpIndex`, `evictCarq`,
  `forgetBand` — three caches that can be filled and never emptied. That is a
  memory question, not a tidiness one, and nobody has asked it.
- **Three suites need Playwright and do not run in a bare sandbox**, which is
  expected rather than broken. They DO run once `node_modules` is on the path.

- **iOS's "one in five sees nothing" WAS BACKGROUNDED TABS, and the item is
  dead.** Not one session of 312 is missing `t_globe_ms` — null or zero, any
  platform. What produced it: **22 of 71 iPhone sessions are `timings_ok = 2`**,
  20 of them hidden from the first frame, averaging **322,440 ms** to storms.
  Those rows poisoned every iPhone average this project ever computed. iPhone's
  real position is second fastest. **Filter on `timings_ok = 1` or repeat the
  mistake.**
- **The old Windows numbers were the same artifact and are superseded.** 8.8 s to
  storms and 43-of-62-are-Aaron's came from the unfiltered table; the clean slice
  is in NEXT UP item 1. The disease is real, the size of it was not.
- **Tap responsiveness is fixed and the item is closed.** Every platform is under
  the 200 ms bar on clean rows — worst is Linux at 146 ms, against 376 ms before
  the five fixes. `tools/test-recompute-budget.mjs` holds the counts.
- **iOS's clean long-task numbers are an instrumentation gap.** All 26 WebKit
  sessions report `longtask_n = 0` because WebKit does not implement the
  observer. `ttfb_ms`, `mem_gb` and `conn_type` are blank on WebKit for the same
  reason. Do not read any of those columns as "iPhones never block".
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
- **`X-Landfall-Empty` DOES NOT EXIST.** `claude/backlog.md` logs it as a header
  written but never read. Searched the whole repo 2026-08-07: there is no such
  string anywhere. The backlog entry is stale, not a finding.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength
  comes from GDACS's own `severitytext` classification; the alert level is parked
  unrendered in `raw`. Logged because the question keeps getting re-asked, not
  because anything is open.
