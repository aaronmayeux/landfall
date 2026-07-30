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

**THE 176° HAIRPIN SHOULD BE GONE — CONFIRM AND THEN DELETE THIS.** It was always
the visible symptom of stale geometry, not a smoothing bug: the stale render drew
one continuous line spanning past AND forecast, the fresh render one minute later
did not. Freshness is fixed and confirmed on glass 2026-07-29, so the prediction
is testable now. **Look at a track's shape, not its advisory number.** If it is
clean, this line goes and the `orient` fence moves to SETTLED. If a hairpin
survives on demonstrably fresh geometry, the diagnosis was wrong and
`lib/trackline.js` gets a real look.

**GUIDANCE SMOOTHING IS ONLY NOW ACTUALLY ON.** The first pass shipped with a
vertex budget that spent front to back, so every model run was smooth for five
legs and dead straight after — reported on glass as "no smoother", which was
literally half true. The budget is shared evenly now and the guidance-specific
cap is gone. **Look at whether the runs read as curves, and whether a full basin
with the layer on still feels right on the phone.**

**THE GLYPH IS THE LOGO, AT ONE FIXED SIZE, AND BOTH NUMBERS WANT A LOOK.**
`SIZE.stormDot3dPx` is 40 CSS px — set from what the mark measured on glass at the
zoom it was most visible, since "the size right before it disappears" lands
anywhere from ~35 px to ~130 px depending where in the fade you read it. **If it
is too small at globe zoom, this is the one number.** `SIZE.glyphArmWeight` is
halved to 0.035 now the glyph no longer shrinks; too light and the arms break up,
far too heavy and they fuse into a pinwheel.

**NOUL SHOULD BE GONE, AND THAT IS THE PROOF THE ROSTER RULE WORKS.** Three clean
GDACS polls with her off JTWC's active list ends her, and her last fix is days old,
so she drops on the same sweep. If she is still there after ~90 minutes with the
app open, the roster route is not firing and the thing to read is whether
`/api/jtwc/storms` returns `state: 'ok'` — a `partial` index attaches no verdict by
design. Never confirmed against the live feed from the sandbox; the diagnosis was
read off the code.

**THE THREE-WORLDS PROTOTYPE — `/proto-worlds.html`.** Standalone page, not
wired into the app, three buttons: Sky (today's globe), Surface (stubbed), Deep
(the dot-matrix glass globe, which is where the page opens). Source in `proto/`.
The names are the settled split — above the planet, on it, below it — and the code
uses them throughout; **`SPEC-GLOBES.md` §41–§43 does not yet**, and says so at the
top of §41.

It runs on the app's own map, camera and input — same `createGlobe()`, same
keyboard and idle drift, mirrored through `map/globe-follow.js`, and it dives all
the way into the real basemap on the app's own fade curves. Confirmed on glass.

**THE DEEP GLOBE'S LOOK IS SETTLED ENOUGH TO STOP TUNING IT.** Confirmed on
glass: ultraviolet palette throughout, dots AND the land sheet coplanar at 1.050,
sheet opacity 0.30, glow pickup 0.55, one even dot field over land and water.
Those are the shipped defaults in `proto/world-deep.js` now. The sliders stay
because the next look question will want them. The basemap underneath is
ultraviolet too, and the plate lines are magma orange — see below.

**THE DOT SHELL OVERHANGS THE GLASS, AND IT IS A GLASS CALL, NOT A BUG REPORT.**
The shell is 5% wider than the planet, so far-side dots near the limb land
OUTSIDE the silhouette as a speckled halo. Invisible while only continents reached
the limb; continuous now the field covers the water. **Either it reads as an
atmosphere of dots or it reads as dirt — decide on a phone.** If it is dirt the
fix is a silhouette clip in the vertex shader (compare each dot's angle off the
view axis against `asin(1/dist)`), NOT moving the shell back down, which would
undo the coplanar sheet.

**THE LAND HANDOFF HAS THE SAME MIDPOINT PROBLEM THE PLATE LINES DO.** Aaron
caught a "shading" at mid-zoom that is two land fills overlapping during the dive:
MapLibre's very dark `landFaint`/`land` fading up under the Three sheet's
translucent white, on two different bands (`DIVE.fade.land` and `mapIn`). Two
half-faded fills do not composite back to one fill, so which one is winning varies
across the frame and reads as shading on the globe. **Same structural fault as the
cyan seam sag below, same `DIVE.fade` to fix, and fixing one should fix both.**
Not a bulge — both renderers use a perfect sphere at radius 1.0, no oblateness
anywhere.

**MAGMA SEAMS COLLIDE WITH THE QUAKE RAMP, AND DEEP IS THE QUAKE GLOBE.** The
plate lines are lava orange now (`#FF7A1A` over `#7A2A0C`), which is deliberately
held under USGS MMI's first orange — but MMI and PAGER both live in that range and
both belong on THIS globe. **The rule this forces: quake severity on Deep is size
and ripple strength, never hue.** If a quake mark ever goes orange, the seams go
back to cyan. Never seen on a phone.

**THE PLATE LINES MAY SAG IN THE MIDDLE OF THE DIVE, AND NOBODY HAS LOOKED.**
Cyan pixel counts across the crossfade run 8571 → **4844** → 10285 at z2.25 /
2.5 / 2.75: at the midpoint the 3D seams are at 74% and MapLibre at 58%, and two
half-faded copies of one line do not composite back to a whole one. Reproducible,
and unchanged by the width pass, so it is structural rather than a side effect.
It may also be the pixel classifier's saturation threshold rather than anything
on screen — **zoom in slowly from space and watch.** If it is real the fix is in
`DIVE.fade`, which the shipped coastline rides too, so it is not a prototype-only
change.

**Volcano plumes still have no home on Deep, and a dot field cannot draw one.**
The split puts quakes and volcanoes on the same globe, which is right by data
shape — a point, a time, a size — but a wave medium cannot do rising smoke and
ash. `SPEC-GLOBES.md` §42.1 has the plume budget; nothing has been tried.

**`proto-globe.html` is dead on the deployed site.** It loads Three from unpkg
with an inline script and the enforced CSP blocks both. `proto-worlds.html` now
carries that globe anyway, so this wants deleting — flagged twice, no answer
yet, so it is still here.

## NEXT UP

**0. THE RENDERING DEEP DIVE, AND THE BRIEF IS ALREADY WRITTEN.**
Cutting edge of three.js and anything else that gets the effects in
`SPEC-GLOBES.md` §41–§43 onto a phone. **The loaded brief lives in the claude.ai
Project as `claude/globes-research-brief.md`** — it carries every measured number
from the data pass, the engine baseline, the rejected techniques with their
evidence, and eight named questions. Read it before searching anything; it exists
so that session does not spend half its context rediscovering July.

The gate on all of it: **the app is on three.js r128 (2021), current is r182+.**
Nothing in §41–§43 is reachable without that jump.

**1. THE ENFORCED CSP NEEDS A GLASS READ, AND IT IS THE ONE THING THAT CAN
BLANK THE APP.** The policy is out of Report-Only and blocking for real.
`tools/csp-check.mjs` boots it locally at both widths and passes, but it runs
offline, so **a selected storm, satellite imagery and radar were never
exercised** — the paths most likely to reach a host the policy has not been
told about. Open a storm on a phone with imagery on and watch for anything
missing. If something breaks, put the header back to
`Content-Security-Policy-Report-Only` and redeploy; that is a one-word fix.

**2. RESPONSIVENESS — SHIPPED, AWAITING A GLASS READ.** The five fixes are in
and the counts are asserted by `tools/test-recompute-budget.mjs`; what is NOT yet
known is whether INP actually crossed under the 200 ms bar. **Read Web Analytics
again after a day of traffic** — map canvas and disclaimer nudge. Boot long
tasks are NOT the remaining suspect: measured at 2-3 tasks and ~900ms before
DOMContentLoaded, against ~7000ms after it, which is the idle rotation render
loop and belongs to this item, not to load speed.

**3. THE BOOT SCREEN IS UP FOR FOUR SECONDS AND NOTHING MEASURES IT.**
`tools/load-probe.mjs` on a 4x-throttled phone: the veil lifts at **3982ms**,
while Chrome reports LCP at 340ms. The gap is not noise — `#boot` is opaque and
`inset: 0`, and Chrome's LCP does no occlusion test, so **every LCP number this
project has, field or lab, is timing an element nobody can see.** Read
`claude/perf-baseline` with that in mind; it calls 340ms "time to main content".

Roughly 1.9s of the wait sits between DOMContentLoaded and the globe: MapLibre's
style install, then the Three globe build. `tools/boot-profile.mjs` names the
biggest single piece — a 4096x2048 land texture, **511ms in `texImage2D` plus
202ms rasterising it**, on every cold load, for a sphere first seen from space.
Halving the texture is the obvious first swing and it is untested. The other
half of the wait is unattributed; profile before guessing.

`boot.done()` fires on MapLibre's `style.load`, which resolves a TileJSON from
`tiles.openfreemap.org`. Measured with that host stubbed healthy vs unreachable:
3982ms vs 3807ms. **So the CDN is NOT the bottleneck** — that hypothesis is
dead, do not re-open it without new data.

**4. `X-Landfall-Empty` IS WRITTEN AND NEVER READ — DELETE IT OR GIVE IT A JOB.**
`functions/api/nhc/mapserver.js:301` sets it on an empty FeatureCollection. Nothing
anywhere reads it: not the client, not `data/relay.js`, not the inspect routes, not
`tools/`. Grepped 2026-07-29, one hit in the whole repo, and that hit is the write.

It also disagrees with itself. The header is set on the direct return but was never
stored in the colo copy, so a cache hit — the NORMAL path — has always dropped it.
That predates the `no-store` work and was found while auditing it.

**Deletion is the recommendation** (§dead code), because the body already answers
the question: a client that wants to know whether a layer came back empty counts
`features`, which is what it does today. The header can only ever restate that, and
a marker that says something the payload already says is a second source of truth
for one fact. **Keep it only if there is a reason the CLIENT must distinguish "the
relay is sure this is empty" from "zero features arrived" — and if so it has to be
stored in the cache copy too, or it stays wrong on the common path.**

Preloading was measured and REJECTED (see `_headers` and the `--preload` switch
in the probe). Do not re-propose it without a reason the numbers changed.

## HELD FOR WEATHER

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. Detection is client-side; the app must
be open. (The JTWC-ABSENCE rule this item used to also carry is built — SPEC.md §5.)

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

## SCOPED, NOT STARTED

**The three-globe expansion.** One app, several globes, a switcher between them:
**Sky** (cyclone, and it is Landfall today), **Surface** (flood + drought +
wildfire), **Deep** (earthquake + volcano). Data in `SPEC-HAZARDS.md` §18–§26,
payloads under `samples/`.

**`SPEC-GLOBES.md` §38–§44 IS STALE ON BOTH THE SPLIT AND THE NAMES** and needs
rewriting before the second globe starts. It still describes Sea/Air/Land grouped
by rendering technique. The grouping is now by what the data IS — paths, painted
regions, points on a skeleton — which is why the names are altitudes. The live
consequence is that **drought lost its free rendering path**: per-dot dimming
cost nothing only on the dot-matrix globe, and drought no longer lives there. A
full-screen haze is ~40% of the frame budget, so Surface needs a different
answer, and its land form is deliberately undecided until Deep is on glass.

Build order is §44 and it is engine-first: r128 → r182+ with WebGPU and a WebGL
fallback, then the world shell, then **Deep with earthquakes only** — the cheapest
world, fully unblocked, and the plate boundaries make it look finished on day one.

Still genuinely blocked: **the global drought raster** (Copernicus is Europe-only
and name-guessing is exhausted) and **the NIFC perimeter payload size** (429 on
every attempt). Neither gates the first two globes.

**The app is called Landfall and is no longer a hurricane app.** Name, subdomain
and install identity are `[DECIDE]` before a second globe ships.

**THE 3D LAND FILL SHOULD BE SHAPES, NOT A PICTURE.** `landTexture` still
rasterises a 4096×2048 canvas and hands it to the GPU; the draft-then-upgrade
moved that cost off the first frame but did not remove it. Feeding `RINGS` to the
GPU as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling entirely, and turns retheming into a
recolour instead of a repaint — which matters once three worlds each want their
own land. Known traps: rings-inside-rings for inland lakes, the antimeridian with
Antarctica worst, and flat triangles cutting chords through the sphere, so large
shapes need interior points to bend with it. `earcut` (~10 KB, no build step)
does the triangulation. **Not during cyclone season, and not in the same pass as
the engine upgrade** — both are surgery on `map/globe3d.js` and two at once makes
a break impossible to attribute. If Surface adopts filled land, write it there
first and this becomes a swap.


## KNOWN AND ACCEPTED

- **The slow tail is WINDOWS, and it is worse than the 8.6 s P99 suggested.**
  Queried from D1 2026-07-29, per platform: Windows averages 4,389 ms LCP
  against ~550 ms everywhere else, maxes at **44,460 ms**, and averages 1,917 ms
  of long tasks. `t_globe_ms` tracks it to within 300 ms at the maximum, so the
  whole boot took 44 seconds — not one metric misfiring. 26 of 105 sessions.
  Nobody has looked at what those sessions have in common.
- **iOS's clean long-task numbers are an instrumentation gap.** All ten WebKit
  sessions report `longtask_n = 0` because WebKit does not implement the
  observer. Do not read that column as "iPhones never block".
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody
  has asked for it.
