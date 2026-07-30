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

**THE THREE-WORLDS PROTOTYPE — `/proto-worlds.html`.** Standalone page, not
wired into the app, three buttons: Sky (today's globe), Surface (stubbed), Deep
(the dot-matrix glass globe, which is where the page opens). Source in `proto/`.
The names are the settled split — above the planet, on it, below it — and the
code, `SPEC-GLOBES.md` and `SPEC-HAZARDS.md` all use them.

It runs on the app's own map, camera and input — same `createGlobe()`, same
keyboard and idle drift, mirrored through `map/globe-follow.js`, and it dives all
the way into the real basemap on the app's own fade curves. Confirmed on glass.

**THE DEEP GLOBE'S LOOK IS SETTLED ENOUGH TO STOP TUNING IT.** Confirmed on
glass: ultraviolet palette throughout, dots AND the land sheet coplanar at 1.050,
sheet opacity 0.30, glow pickup 0.55, one even dot field over land and water.
Those are the shipped defaults in `proto/world-deep.js` now. The sliders stay
because the next look question will want them. The basemap underneath is
ultraviolet too, and the plate lines are magma orange — see below.

**THE LAND HANDOFF HAS THE SAME MIDPOINT PROBLEM THE PLATE LINES DO.** Aaron
caught a "shading" at mid-zoom that is two land fills overlapping during the dive:
MapLibre's very dark `landFaint`/`land` fading up under the Three sheet's
translucent white, on two different bands (`DIVE.fade.land` and `mapIn`). Two
half-faded fills do not composite back to one fill, so which one is winning varies
across the frame and reads as shading on the globe. **Same structural fault as the
cyan seam sag below, same `DIVE.fade` to fix, and fixing one should fix both.**
Not a bulge — both renderers use a perfect sphere at radius 1.0, no oblateness
anywhere.

**THE MAGMA SEAMS ARE THREE PASSES AT 1 : 4.4 : 10, AND THE MMI ARGUMENT IS
MEASURED.** They first shipped at effectively two widths and read as one line; the
stair-step is stated once in `SIZE.plateStack` now, and a cut across a seam
measures luminance 242 / 84 / 45 against a 38 background. Only the middle pass
overlaps USGS MMI's range, and **the rule that resolves it stands: quake severity
on Deep is size and ripple strength, never hue** (numbers and the re-measure
trigger in `SPEC-GLOBES.md` §43.2). **Never seen on a phone — look first at
whether the core reads as molten or as fairy lights.**

**THE PLATE LINES MAY SAG IN THE MIDDLE OF THE DIVE, AND THE MAGMA STACK MAKES IT
WORSE, NOT BETTER.** Pixel counts across the crossfade ran 8571 → **4844** →
10285 at z2.25 / 2.5 / 2.75: at the midpoint the 3D seams are at 74% and MapLibre
at 58%, and two half-faded copies of one line do not composite back to a whole
one. Structural, not a side effect of the width pass. **A three-pass MapLibre band
against a 1px Three hairline widens that gap** — known and accepted when the stack
went in. **Zoom in slowly from space and watch.** If it is real the fix is in
`DIVE.fade`, which the shipped coastline rides too, so it is not a prototype-only
change; the deeper fix is ribbon geometry for the 3D seams (SPEC-GLOBES §43.2.2).

**THE PLATE NAMES WANT A GLASS READ ON TWO NUMBERS.** `SIZE.plateLabelPx` is 10.5,
and at the planet band on a 429 px globe that is very small — move it first if they
are hard to read. `PLATE_LINE.labelBands[].anchorDeg` is the density dial, raised
60/20/5 → 95/34/9 after Aaron reported too many copies at once; a screen now
carries five to seven pairs. Two things that are DESIGN rather than misses:
a plate with four boundaries in view is named four times (one pair per seam, Nazca
at the planet band is the example), and the band handovers at z4.0 and z5.5 show
the same name at half strength in two places for 0.3 zoom levels. Both are
explained in `SPEC-GLOBES.md` §43.2.2; the second is the one that might read as a
ghost rather than a fade, and `bandOverlap` narrows it.

**THE "STATE NAMES" TOGGLE WILL DO NOTHING ON DEEP, AND THAT IS A §5 BUG WAITING
FOR A DRAWER.** Deep draws no state-name layer, so `setAdminVisible` is a safe
no-op there — safe, not honest. Whoever wires Deep into the real drawer has to
hide that switch on this world. Nothing is broken today because the prototype has
no drawer; there is no caller to write the code against yet.

**THE STAIRCASE IS GONE AND IT COST 133 km OF PRECISION — JUDGE THE TRADE.**
Simplification runs before the spline now, which is what actually killed it: the
published Mid-Atlantic Ridge turns past 70° at 106 of its 171 vertices, and a
curve through those points only rounds the corners. Worst-case deviation from a
published vertex is 1.20°, TWICE the Douglas-Peucker tolerance, and some of the
right angles removed are real ridge-transform geometry rather than artefact. Dial
is `PLATE_LINE.simplifyToleranceDeg`; the argument and the numbers are in
`SPEC-GLOBES.md` §43.2.1. **Does the trend read better than the structure did?**

**VOLCANOES ARE BEING BUILT ON DEEP IN PHASES, AND THE PLAN IS IN THE SPEC, NOT
HERE.** `SPEC-GLOBES.md` §42.1 is the render contract; `SPEC-HAZARDS.md` §22.4-22.6
is the data. Route, join key, parser traps and the closed questions are in the
Project as `claude/volcanoes-deep-2026-07-30.md` — **do not re-survey the nine
centres.**

**A: eruption data ✅ · B: the contract ✅ · C: the live relay ✅ · D: constants ✅ ·
E: marks ✅ · F: shapes · G: submarine dimples · H: plumes.** The layer draws for
the first time. Still only in `/proto-worlds.html`, behind the **Volcanoes**
toggle in the Deep panel — **not in the live app.**

**==> PHASE E IS ON GLASS AND TWO OF THE FOUR QUESTIONS ARE ANSWERED. <==**
The 128-strong cyan tier reads well, and it is visible at the space floor —
`quietMinPx: 3.5` and the fixed-screen-size decision are both confirmed. Two
faults came back from the same screen and both are fixed but **not yet
re-checked on a phone**:

1. **THE MARKS WERE UNDER THE DOT FIELD.** `renderOrder` shipped at 2, ordered
   against the plate seams at 1 and never checked against the dots at 3 — which
   draw last and therefore on top. **Depth testing is off on every layer of this
   world, so render order is the ONLY thing deciding overlap**, and a new layer
   has to be placed against the DOTS rather than against whatever it sits
   nearest. Marks are 4 now.
2. **THE ERUPTING GOLD WAS CREAM AND READ AS WHITE.** `#FFE9A8` measured
   luminance 0.824 against the dot field's 0.801 — **1.03:1, the same brightness
   as the white dots** — at saturation 0.34. Against a near-neutral field the
   separating channel is SATURATION, not lightness, and it had none to spend.
   Now `#FFC53D`: saturation 0.76, hue 42° against the seam core's 25°. **The
   lesson generalises past this hex — a colour argued only in luminance against
   a hazard ramp can end up with no argument at all against the thing it
   actually sits among.**

**STILL UNANSWERED, and question 2 could not be judged while the gold was
invisible:** does the gold survive the magma seams a volcano physically stands
on? And do erupting marks read as live or as inert, given nothing animates?

**==> AND THE LIVE FEED HAS NOT BEEN CONFIRMED WORKING ON THE DEPLOYED SITE.
<==** No gold was seen, which is consistent with BOTH faults above AND with an
empty or dead eruption feed, and those were never separated. **`#vstatus` is the
one place that distinguishes them** — it names the erupting count independently
of whether any pixel is legible. Read it before drawing any conclusion from the
globe.

**AHYI IS THE HONESTY CHECK AND IT IS ON THE FIRST SCREEN.** It is erupting 55 m
under water, so the erupting set contains a submarine volcano from day one. E
draws it as a **hollow gold ring** — the flat treatment §42.1.4 requires, and the
Phase G dimple inverted rather than fought. **A gold disc there would be the
layer's first lie.** 110 volcanoes carry the flag; 7 of them are in the quiet
tier.

**THE LIVE FEED IS DOWN ON A LOCAL SERVER, BY DESIGN.** `/api/volcano/live` is a
Cloudflare Function and a static dev server 404s it, so every local refresh takes
the `unavailable` path. That is the honest path being exercised, not a bug —
**and the thing to actually check is the wording**: the panel must say the
eruption feed is unavailable and that what is erupting is unknown, never draw 128
calm volcanoes and leave it at that. **The wording has not been approved.**

**THE VOLCANO LAYER HAS ITS OWN STATUS LINE AND THAT WAS FORCED.** Plate
boundaries and volcanoes both load asynchronously into the same prototype; one
shared `#status` element means whichever resolves last erases the other, and
"plate boundaries loaded" quietly overwriting "eruption feed down" is §5 wearing
an innocent face. `#vstatus` is the second line.

**==> THE ASH CHANNEL HAS NO ARCHIVE AND THAT IS THE LAYER'S BIGGEST HOLE. <==**
The bulletin slots are latest-only and overwritten in place, so **ONE MISSED POLL
IS ONE PERMANENTLY LOST ADVISORY.** BoM carried seven days and is gone for good.
**SCOPED, NOT BUILT — the design is `claude/ash-archive-scope-2026-07-30.md` in the
Project.** Shape: one KV key per advisory, written once, 30-day TTL, raw text not
parsed, on its own key prefix so the warm loop's `loadHashes` never pages it.

**Two things must be MEASURED before a line of it is written.** How much of the
free plan's **1,000 KV writes a day** the existing warm loop already spends (that,
not the 50-fetch cap, is the binding constraint — the Worker reads all 62 slots
through our own `?group=a|b` routes for two subrequests). And whether `ash.js`
honours the warm-key bypass at all: its stampede guard and the cron are both five
minutes, so **the Worker may be spending every cycle reading its own last answer.**

**LEGACY VOLCANO NUMBERS ARE STILL ON THE WIRE, WHICH CONTRADICTS A CLOSED ITEM.**
Read live 2026-07-30 from Anchorage's slots: `VOLCANO: KATMAI 1101-17` and
`VOLCANO: PAVLOF 1102-03`, region-style numbers GVP retired in 2013. They cannot
join the catalog and are dropped as `unknown_volcano`. Katmai also arrives as
`312170` on another slot so it survives; **Pavlof may not.** Aaron has ruled out
building a crosswalk — this is recorded so the count is understood, not so it gets
fixed. Correct the volcanoes doc's CLOSED claim that legacy numbers are gone.

**Two claims are NOT confirmed and must not be built on.** The 16 Decade Volcanoes
list is model memory only. And "21 of 22 weekly reports state a plume height" did
not reproduce — a first parse got **6 of 22** heights and 10 of 22 drift bearings.
Phase H writes a real parser and re-measures.

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

**1. WHAT A MAPLIBRE FRAME COSTS AT THE SPACE FLOOR — AND THE IDLE DRIFT HAS BEEN
PAYING IT ALL ALONG.** The rendering research made this its step 1 and it is still
undone, but the reason changed: `attachIdleRotation` calls `setCenter` per frame
below `DIVE.zHandoff`, so a resting globe already drives MapLibre continuously and
already pays a full-map repaint — including at the space floor where the map is at
CSS opacity 0 and invisible. That is not a shimmer cost, it is the app's resting
cost, on Sky as much as Deep. Measured this session: with the drift pinned, zero
MapLibre renders per second; unpinned, one per frame. **Nobody has measured what
one of those frames costs.** `proto/shell.js`'s self-driven loop is the shape of
the fix if it turns out to be expensive, and the answer decides whether
`map/globe3d.js` needs the same treatment. Do it before smoke, dust or water.

**2. THE ENFORCED CSP NEEDS A GLASS READ, AND IT IS THE ONE THING THAT CAN
BLANK THE APP.** The policy is out of Report-Only and blocking for real.
`tools/csp-check.mjs` boots it locally at both widths and passes, but it runs
offline, so **a selected storm, satellite imagery and radar were never
exercised** — the paths most likely to reach a host the policy has not been
told about. Open a storm on a phone with imagery on and watch for anything
missing. If something breaks, put the header back to
`Content-Security-Policy-Report-Only` and redeploy; that is a one-word fix.

**3. RESPONSIVENESS — SHIPPED, AWAITING A GLASS READ.** The five fixes are in
and the counts are asserted by `tools/test-recompute-budget.mjs`; what is NOT yet
known is whether INP actually crossed under the 200 ms bar. **Read Web Analytics
again after a day of traffic** — map canvas and disclaimer nudge. Boot long
tasks are NOT the remaining suspect: measured at 2-3 tasks and ~900ms before
DOMContentLoaded, against ~7000ms after it, which is the idle rotation render
loop and belongs to this item, not to load speed.

**4. THE BOOT SCREEN IS UP FOR FOUR SECONDS AND NOTHING MEASURES IT.**
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
