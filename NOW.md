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

**==> THE "NHC FEED DELAYED" BANNER WAS FIRING ON A HEALTHY FEED, AND SERVE-THEN-
REFRESH IS WHAT BROKE IT. <==** Caught on glass 2026-08-07, hours after that
shipped. `X-Landfall-Stale` meant one thing — upstream failed — until the list
routes started serving expired copies ON PURPOSE, at which point it also meant
"your copy is 31 minutes old and a fresh one is landing right now." The strip
could not tell those apart. It now judges by AGE
(`RELAY_AGE.delayedAfter`, 90 min) on both sources, as-built in `SPEC-UI.md`
§16. `isSourceStale()` in `data/store.js` made the same mistake in the other
direction and is deleted; it never had a caller.

**==> AND THE BANNER MAY HAVE BEEN TELLING THE TRUTH ABOUT SOMETHING ELSE. <==**
That path is only reached when the copy is ALREADY older than 30 minutes, and
the warm cron runs every 5. So either the KV copy is not staying fresh or the
routes are not reading it. **This is the "what does the warm store actually
contain" unknown below, with a symptom attached for the first time.**

**CONFIRMED GONE ON GLASS 2026-08-07.** It was the header semantics and nothing
else. **But the fix took the symptom away with it** — see the warm store item
below, which is back to needing a direct read.

**==> SHIPPED AND UNSEEN: THE WHITE RING ON EACH STORM'S FIRST FORECAST DOT. <==**
Aaron's ask, and the reason is direction: a track running Cat 1 → 2 → 2 → 1 is
symmetrical to the eye, so without a marked end the reader has to already know
which way cyclones travel in that basin. White at 3 px against the dark 1.5 px
every other dot wears. As-built is `SPEC-MAP.md` §7.5.

**Judge two things on glass.** Whether white survives against a pale Cat 1 fill
at the far end of the ramp — that is the one pairing where the ring could
disappear into the case it exists to disambiguate. And whether the ring reads as
*start of forecast* rather than as a second storm marker, since the glyph sits
roughly 40 nm away and the two are close enough at basin zoom to look like a
pair.

**IT MARKS TAU 0, NOT THE CURRENT POSITION, AND `SPEC-MAP.md` SAID OTHERWISE IN
TWO PLACES.** Current position is `latitudeNumeric`/`longitudeNumeric` and is
what the glyph draws; tau 0 is the analysis time, up to three hours behind. Both
lines are corrected and §7.4 now carries the distinction. Do not reintroduce it
— the two are close enough on a globe to look like one thing and are not one
thing.

**==> BOTH STORM LISTS NOW ANSWER FROM CACHE AND REFRESH BEHIND THE RESPONSE. <==**
`nhc/storms.js` got the serve-then-refresh and the 10 s upstream budget that
`gdacs/events.js` has carried since the DOLPHIN-26 fix. **The outstanding half is
closed and the parity rule is satisfied.** As-built in `SPEC-DATA.md` §4.13.

The GDACS behaviour was accepted on glass 2026-08-01 as a two-stage paint —
marker and imagery immediate, geometry and the rest of the roster ~5 s behind.
Inside the 10 s ceiling, above the 1-2 s ideal, **accepted and not optimised.**

**==> WHAT THE WARM STORE ACTUALLY CONTAINS — STILL UNREAD, AND THE ONE SYMPTOM
IS SPENT. <==** The cron Worker is deployed and its schedule is right; nothing
has ever read a KV value.

**One real observation, 2026-08-07 12:13 CDT:** a phone was served an NHC copy
older than 30 minutes, on a 5-minute cron. That should not happen. It means
either the KV copy is not staying fresh or the routes are not reading it —
**and it is a single sample, so it could equally be one cold colo on a day with
twelve visitors.** Do not treat it as a diagnosis.

**The status strip can no longer surface this.** It fires at 90 minutes now, by
design, so a 31-minute-old copy is invisible to it. That was the right call for
the alarm and it cost the canary. Answering this needs a DIRECT read: the
Cloudflare connector exposes KV namespaces but not values, so the routes in are
the inspect endpoint (needs `INSPECT_KEY`) or the warm Worker's own per-cycle
report, which already counts `reachedSource` and `bypassUnknown` per key.

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

**==> AHEAD OF THE NUMBERED QUEUE: A FIFTH OF REAL iPHONE TRAFFIC MAY BE SEEING
NOTHING. <==** 5 of 26 iOS sessions recorded no `t_globe_ms` at all; every other
platform is effectively zero. In four of the five the DATA arrived in under
1.2 s, so those visitors did not just leave — the app got what it needed and the
globe milestone never fired. Two were iPads. **Aaron owns no iPhone or iPad, so
all 26 are strangers.** Either the globe never came up, which is a silent failure
and banned, or the mark does not fire on WebKit and the column is a lie. Pairs
with: no outside visitor has ever opened an advisory. Cannot be reproduced on
hardware Aaron owns. Detail in the Project as `claude/backlog.md`.

**Per-device IDs are live and verified** — 12 of 12 sessions on 2026-08-07
carried one, 7 unique devices. Unique-user counting is now possible and this
question is answerable in a way it was not.

**1. WHAT A MAPLIBRE FRAME COSTS — STILL UNMEASURED, AND STILL THE GATE.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint — including at the space floor where the
map is at CSS opacity 0 and invisible. **Moving water pays it too**, at map zoom,
via `triggerRepaint()`. Measured: drift pinned, zero MapLibre renders per second;
unpinned, one per frame. **Nobody has measured what one of those frames costs**,
and it needs a real device with a real basemap — the sandbox has no tunnel to
one. `proto/shell.js`'s self-driven loop is the shape of the fix. Do it before
smoke, dust or any further continuous effect.

**HALF OF IT IS ALREADY GONE AND IT WAS THE FREE HALF.** Past `DIVE.zHandoff` the
loop used to schedule a frame anyway and throw the reading away. It stops now;
`tools/test-idle-drift.mjs` asserts the frame counts. **This does not touch the
repaint above**: `setCenter` is what `map/globe-follow.js` mirrors, so it is also
what makes the visible rotation happen and cannot simply be skipped.

**2. RESPONSIVENESS — SHIPPED, AWAITING A GLASS READ.** The five fixes are in and
the counts are asserted by `tools/test-recompute-budget.mjs`; what is NOT known
is whether INP crossed under the 200 ms bar. **Read `worst_event_ms` in D1, not
Web Analytics** — same question, no dashboard, and it splits by platform. Current
picture: 115 ms typical, but 1,797 ms in the worst-blocked band, so this is the
same disease as the Windows entry below. Boot long tasks are NOT the remaining
suspect: 2–3 tasks and ~900 ms before DOMContentLoaded against ~7000 ms after it,
which is the idle rotation loop and belongs to item 1.

**3. THE BOOT SCREEN IS UP FOR FOUR SECONDS AND NOTHING MEASURES IT.**
`tools/load-probe.mjs` on a 4x-throttled phone: the veil lifts at **3982 ms**,
while Chrome reports LCP at 340 ms. `#boot` is opaque and `inset: 0` and Chrome's
LCP does no occlusion test, so **every LCP number this project has is timing an
element nobody can see.**

Roughly 1.9 s sits between DOMContentLoaded and the globe. `tools/boot-profile.mjs`
names the biggest single piece — a 4096x2048 land texture, **511 ms in
`texImage2D` plus 202 ms rasterising it**, on every cold load, for a sphere first
seen from space. The other ~1.2 s is unattributed; **profile that before
touching the texture.**

**==> DO NOT HALVE THE TEXTURE AS THE FIRST SWING. <==** This file used to call
that the obvious move; `claude/backlog.md` has the measurement that kills it. At
2048x1024 the map image is 19.6 km per pixel against ~11.6 km per screen pixel on
a full-screen phone globe, and Barbados and Antigua drop from ~3.5 image pixels
to ~1.7 — flickering or gone. Wrong detail to lose in a hurricane app. The real
answer is filled triangles (SCOPED, below).

*Two dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck (3982 ms healthy vs 3807 ms unreachable), and preloading was
measured and rejected (see `_headers` and the probe's `--preload` switch).

**4. GDACS IS STILL THE FEED THAT LEAVES PEOPLE ON A SPINNER, THOUGH LESS SO.**
Since the 2026-08-01 fix: 41 of 46 GDACS loads reached `ok` against NHC's 44 of
46. **Zero errors either side — the misses are sessions that ended still
loading**, not failures. Retry has been pressed **zero times in 193 sessions**, so
that recovery path has never been exercised by a real user. Whether the NHC
parity fix moves the GDACS number is the thing to re-read next.

**5. GULLIES ARE THE HALF OF CHARACTER THAT DOES NOT FIT, AND THE MEASUREMENT IS
NOT TO BE REPEATED.** The grid is ~21 samples across a mountain and fine downhill
rills need roughly 3x that. Tripling `ridge.cellsPerRadius` to 30 on the
240-volcano drawn set takes it from **130,350 nodes to 1,108,989** and the build
from **134–288 ms to 994–4,021 ms** on a sandbox CPU faster than a phone, with
`ridge.maxCells` needing to rise 9x alongside or every cluster silently coarsens
back. **That is a blocking multi-second build on a phone.** The answer is
resolution that follows on-screen size, which is its own session.

**6. THE RENDERING DEEP DIVE, AND THE BRIEF IS ALREADY WRITTEN.** Cutting edge of
three.js and anything else that gets §41–§43's effects onto a phone. **The loaded
brief is `claude/globes-research-brief.md` in the Project** — every measured
number, the engine baseline, the rejected techniques with their evidence, and
eight named questions. Read it before searching anything. The gate on all of it:
**the app is on three.js r128 (2021), current is r182+.** Nothing in §41–§43 is
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

- **The slow tail is WINDOWS, and 43 of its 62 sessions are Aaron's own work
  PCs.** Strangers on Windows: 8.8 s to storms, 3,561 ms blocked. Aaron's two
  work machines: 2.1 s, 572 ms. Both are 32 GB / 14-core on office internet and
  were hiding the problem. Blocking is the cause and the correlation is clean —
  under 0.5 s blocked averages 1.5 s to storms, over 5 s blocked averages 14.2 s.
  Worst single session: 27,086 ms across 86 long tasks. **Nobody has looked at
  what the blocking is.** Numbers and the per-band table are in the Project as
  `claude/backlog.md`.
- **Re-run that before acting on it.** `hidden_at_start` / `first_hidden_ms`
  shipped 2026-07-31 and have never carried a real value. Some of that tail may
  be backgrounded tabs rather than slow machines — one hidden iOS session
  recorded 97 s to storms and made iOS look like the worst platform in the table
  when its true median is second best.
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
