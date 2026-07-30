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
E: marks ✅ · F: shapes ✅ · **I: map-zoom mountains ✅** · G: submarine dimples ← next ·
H: plumes.**

**==> THE MOUNTAINS ARE RIDGES NOW AND NONE OF IT HAS BEEN SEEN ON GLASS. <==**
The units bug is fixed and confirmed: real geometry draws in the right place
over Guatemala at 84 fps with 126 mountains, tilt arrives, and nothing else on
the map breaks — so the THREE-on-MapLibre shared-context risk is answered. What
was still wrong was the LOOK: pancakes with a pimple, overlapping into a smear,
and a zoom band with no marks at all. Five changes, all in, none on a phone:
**taller** (the cone/tilt inequality, §42.1.4b), **one ridge** (footprint-
intersecting volcanoes merged into one heightfield with a smooth-max saddle),
**soft base** (per-vertex alpha ramp, mesh trimmed at the footprint), **depth
back on** (cleared first, tested only against ourselves), and **the circle
gate** (`isStyleLoaded()` → style.load, which is why there were no dots).

**==> `inflate` IS DELETED AND HAWAII IS WHY. <==** It was a uniform 5x scale
making distant volcanoes big enough to see. Mauna Loa's true footprint is ~100
km across and the Big Island is ~130, so drawn true the mountain very nearly IS
the island — at 5x it was a grey oval several times the island's width with
Hawaii floating inside it. It was also **causal**: clustering asks whether TRUE
footprints touch while the screen drew them five times wider, so the pairs that
visibly collided were exactly the pairs the merge decided were not neighbours.
Two solid cones inside each other give a depth seam that MOVES WITH THE CAMERA —
which is the "different parts get clipped from different angles" report. The
handoff moved 5.4 → **7.0**, where a median volcano is 36 px across at true
scale; the dots read `handoff` directly so they stretched to meet it. **There is
no zoom term in the draw scale at all now** — one metre is one metre.

**THE MERGE ONLY FIRES ON 5 GROUPS**, 113 ridges from 119 edifices, because the
drawn tier is the ACTIVITY tier — roughly one volcano per arc. That is expected
and correct at true scale; the dense Guatemala chain that really does overlap is
34 volcanoes in the catalog and mostly not in the tier. **Raising
`ridge.clusterPad` above 1.0 would merge mountains that do not touch, i.e.
invent terrain, which is the same lie as horizontal exaggeration. It stays at
1.0.**

The ladder is three rungs: Three pips z2.0–3.8, MapLibre circle
z2.4–7.8, real merged-ridge geometry z7.0 up. **The circle fades out under the
mountains** — a dot and a mountain for one volcano is two marks for one thing —
**except for submarine volcanoes and volcanic fields, which keep their mark
forever** because they never become an edifice. Contract and numbers are
`SPEC-GLOBES.md` §42.1.4b. Prototype only, behind the **Volcanoes** toggle.

**THE NUMBERS THAT WANT A LOOK, IN ORDER OF EFFECT.** `map3d.handoff`
([7.0, 7.8] — the replacement for `inflate`; lower it and mountains arrive
smaller, raise it and the dots carry longer). `map3d.vertical` (**4.0**; the
cone/tilt inequality is asserted, so moving this without moving `TILT.maxDeg`
can re-break it, and above ~4 they read as spires). `ridge.saddle` (0.35 — how
rounded the col between merged summits is; at 0 the join is a crease).
`ridge.edgeFade` (0.30) and `ridge.softBase` (0.18) — the two base fades; the
first hides the grid staircase, the second lets a mountain emerge from the map.
`map3d.opacity` 0.55 white and `eruptingColor` gold — **the gold on a flat
shield currently reads as an orange stain rather than a lit summit**, because
shields sit deliberately below the tilt threshold and have no peak for it to sit
on.

**THE FIRST DEPLOY OF THIS BLANKED THE DEEP WORLD ENTIRELY, AND THE LESSON IS
OLDER THAN THE FEATURE.** `attachPitchRamp` called `map.setProjection` in the
same tick as the attach; MapLibre's `Style.setProjection` opens with
`_checkLoaded()`, which throws before `style.load`, and because the attach ran at
module top level the exception took `proto/shell.js` down with it — no world, no
render loop, a dark screen with the HTML still on it. **`map/globe.js` and
`proto/shell.js` both already set style properties inside a `style.load` handler
and both say in a comment why.** `tools/test-volcano-map3d.mjs` now stubs
MapLibre's guard and fails if the ramp touches the style early or listens on
`styledata` (which `setProjection` itself fires, forever, because MapLibre's
redundancy check compares a name string to an expression array).

**`map.isStyleLoaded()` IS NOT "DOES A STYLE EXIST", AND USING IT AS THAT GATE
MEANT THE LAYER WAS NEVER ADDED.** `Style.loaded()` also requires no pending
source updates, **every source cache to have finished fetching tiles**, and the
image manager to be loaded — none of which is true inside a `style.load`
handler, which is the only moment the layer was going to be added. `addLayer`
itself only needs `_loaded`, which IS set before `style.load` fires. **The gate
is "has style.load fired", never `isStyleLoaded()`.** `proto/volcano-map.js`
carried the same wrong gate and survived on a `styledata` retry landing by luck
until the luck ran out — no volcano dots at all below z5.4. Both files use the
honest gate now.

**THE V3D READOUT IN THE STATS BAR IS THE DIAGNOSTIC AND IT EARNED ITS KEEP.**
One word per distinct failure: `wait` / `off` / `gl!` / `hidden` / `idle` /
`mtx!` / `z<5.0` / `nodata` / `n0` / `12 @0.55`. It resolved this bug in one
screenshot. Keep it until the layer is in the live app.

**==> TWO THINGS I COULD NOT VERIFY WITHOUT A BROWSER AND THEY ARE THE FIRST
THINGS TO WATCH. <==** The sandbox has no Chromium, so nothing below the syntax
checker was exercised. **One: does the custom layer line up with the basemap?**
It draws Three into MapLibre's own GL context using the matrix MapLibre hands
it. `TILT.flatten` moves the globe→mercator blend down to z4.2–5.4 specifically
so the layer only ever sees a plain mercator transform — if volcanoes sit
offset from their circles, that band is the first suspect. **Two: does anything
else on the map break after Three has touched the GL state?** `resetState()` is
called every frame, which is the standard guard, but a basemap that goes wrong
only after a volcano is on screen is that guard failing.

**AND THE PROJECTION FLATTENS EARLIER THAN IT USED TO, WHICH IS A VISIBLE
CHANGE TO THE DIVE.** MapLibre's globe held its curve to z11 before; it is flat
by z5.4 now. That band sits above z3.86 so it cannot desync the Three globe, but
**watch the basemap between z4 and z5.5 for a flattening that reads as a lurch.**

**THE TILT FLOOR IS z3.86 AND IT IS ASSERTED, NOT REMEMBERED.**
`map/globe-follow.js` has no concept of pitch, so tilt while the 3D globe is
still visible pulls the two planets apart. `tools/test-volcano-map3d.mjs` fails
if `TILT.zStart` is ever lowered under the tail of `DIVE.fade.cage`.

**`elev` IS ABOVE SEA, NOT ABOVE THE VOLCANO'S OWN BASE, AND THAT IS THE
LAYER'S REAL INACCURACY.** Capped per family so Ojos del Salado is a cone rather
than a 7 km spire. Footprints are derived from height and family because the
catalog has no basal diameter at all. Measured: Fujisan 31.5 km across against a
real ~30, Mauna Loa 100 against ~120, **Masaya 9.5 km against the 45 km that got
`fill-extrusion` cut.** Honest fix is a DEM lookup, which this does not do.

**==> PHASE F IS PUSHED AND HAS NEVER BEEN SEEN ON GLASS. <==** Volcanoes are
real geometry now: flat pips at the space floor cross-fading into five lathed
silhouettes as you descend, lit by this world's own fixed light. Still only
`/proto-worlds.html` behind the **Volcanoes** toggle — **not in the live app.**
Four numbers want a look, in order of effect: **`shapes.maxHeight`** (0.018
radii, how tall the tallest stands — reasoned off `DIVE.baseLump` x1.5 and never
measured), **`shapes.shapeIn`** (0.00 → 0.18, when mountains arrive — the window
between "shape is in" and "layer is gone" has never been watched),
**`families.shield.ratio`** (4.0 — a shield lands ~3.4x a cone's footprint,
correct by rank order and possibly too much on a phone), and **`shapes.ambient`**
(0.45 — too low and a volcano in shadow reads as a hole in a translucent planet).

**Turn on `All shapes` while judging.** The quiet tier is 100 cones and **no
fissures at all**, so four of the five silhouettes are otherwise invisible
without waiting for the right eruption.

**AND THE COLOURS WERE MEASURED AGAINST 3.5 px PIPS, NOT AGAINST MOUNTAINS.** A
12 px lit silhouette is roughly ten times the ink at the same hex. Nothing was
retuned — §42.1's rule is that a colour is not moved without re-measuring
against what it actually sits among, and that measurement needs a phone. **If
the gold shouts now, move the hue and keep the saturation** (`VOLCANO.marks`
records why going pale is how it disappeared the first time).

**ONE GLASS QUESTION IS STILL OPEN: do erupting volcanoes read as LIVE, or as
inert?** Nothing animates (`wantsFrames()` still returns false). The answer
scoped for it is the **Phase H plume**, not a pulse — a pulse is a standing
frame cost on a world that otherwise rests, and it is a placeholder for
something already on the list. **If F still reads inert, that is an argument for
pulling H forward, not for adding animation.**

**THE STATUS WORDING IS UNAPPROVED AND THE STATUS LINE IS BURIED.** `#vstatus`
lives inside the collapsed CONTROLS panel, so the one line that distinguishes *the
world is quiet* from *the feed is dead* is invisible by default. **Aaron's call:
leave it, UI polish comes after the layer works.** Recorded so it is not mistaken
for done — the preferred shape was surfacing failures only, under the globe, and
staying silent when all three channels are healthy.

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

**1. THE VOLCANO LOOK PASS — FOUR ITEMS, AGREED WITH AARON 2026-07-30.**
Ordered by payoff per line changed. `inflate` and the edge fringe are already
done; these are what is left.

**1a. TILT MUST FOLLOW ZOOM CONTINUOUSLY, AND THIS IS A QUESTION BEFORE IT IS A
TASK.** Pitch is written on `zoomend` for a glass-proven reason: `Map.setPitch`
is `jumpTo`, and `jumpTo`'s first statement is `stop()`, which aborts the pinch
that triggered it — reported as a gesture that had to be restarted over and over
through the whole tilt band. So "just do it continuously" is not a decision
anyone can make from the outside; it is a question about whether MapLibre 5.6
offers a camera write that does not abort a gesture, most likely by writing the
transform directly rather than going through the camera API. **READ
`vendor/maplibre-gl-5.6.0.js` BEFORE PROMISING THIS.** Every failure in this
feature's history was a confident assumption about MapLibre resolved only by
reading the bundle. If it works it also fixes Aaron's report that some things
tilt back out of step with each other — that is pitch easing on its own clock
while every other fade tracks zoom instantly.

**1b. DOTS AND MOUNTAINS BECOME ONE VISUAL FAMILY. DECIDED 2026-07-30.**
Aaron: "dot size matches volcano size", and the mountain colours match the dot
colours. So the dot stops being an abstract mark and starts being a preview of
the mountain underneath it — the same volcano, the same size, the same colour,
just drawn cheaper because it is far away.

> ==> **AND THE FALLOUT IS THAT SIZE STOPS RANKING HAZARD.** <== Today
> `quietMinPx`/`quietMaxPx` ramp a quiet dot's radius by `sev`, and an erupting
> one is a fixed `eruptingPx`. Once radius tracks the footprint, severity has
> nowhere to sit. **The recommendation, not yet ruled on by Aaron: severity
> moves to LIGHTNESS within the quiet colour** — a bright quiet dot outranks a
> dim one — which keeps erupting gold categorically distinct and does not
> touch the fixed colour semantics. Do not silently drop severity; if it is
> going away, say so out loud first.
>
> Note the honest upside: a dot sized by footprint is TRUE information, where a
> dot sized by a severity score was a proxy invented because a dot had nothing
> better to say.

**1c. UNDERWATER VOLCANOES GET REAL 3D. DECIDED 2026-07-30.** Aaron rejected
the flat contour-ring proposal outright: he wants actual geometry, with water
over the top of it. Same heightfield, same profile, same everything — the
seamount is built exactly like a land volcano and then **the surface of the sea
is drawn over it.**

> ==> **THE ONE CONSTRAINT THAT MUST NOT BE MISSED: DEPTH GETS THE SAME
> EXAGGERATION AS HEIGHT, OR SEAMOUNTS PUNCH THROUGH THE WATER.** <== `elev` is
> the SUMMIT, negative for submarine. Place the summit at `elev * vertical` and
> build the cone downward from there and it can never break the surface,
> because `elev` is negative and the exaggeration scales both the mountain and
> its depth by the same 4x. Place the summit at raw `elev` while the mountain
> is exaggerated 4x and the peak comes straight up through the sea.
>
> ==> **AND THE ANIMATION IS THE EXPENSIVE HALF, SO IT IS THE SECOND HALF.**
> <== Aaron floated "maybe a water animation overlaid on top". A moving water
> surface needs either a shader — which `proto/volcano-3d.js` deliberately does
> not have, everything is baked into vertex colours on the CPU — or per-frame
> vertex rewrites, which is frame budget on a phone. **Build the geometry plus
> a STATIC translucent water plane first.** That is the part that actually says
> "there is a mountain here and it is under water"; it costs almost nothing and
> it can be judged on glass. Then decide whether motion is worth breaking the
> no-shader rule for. Do not open with the animation.
>
> Also unresolved and worth raising when it is built: the water plane needs an
> extent. Clipped to the seamount's own footprint it reads as a puddle; drawn
> across the viewport it is a full ocean layer and a much bigger feature. Ask.
>
> ==> **THIS REVERSES A RULE THAT IS CURRENTLY ASSERTED, SO TWO PLACES HAVE TO
> MOVE WITH IT.** <== `isEdifice()` in `lib/volcano-dimensions.js` excludes
> submarine volcanoes; `tools/test-volcano-map3d.mjs` asserts "no submarine
> volcano gets an edifice"; and `SPEC-GLOBES.md` states they keep their circle
> at full strength forever. All three were right when there was no way to draw
> underwater, and all three are now wrong. **Volcanic FIELDS still keep their
> mark** — a field is not one mountain and never becomes one, so `isEdifice`
> keeps that half of its job.

**1d. CHARACTER — AND IT IS ONE FEATURE, NOT FOUR.** Aaron asked for terrain
shading, lopsided craters, varied peaks and individuality between neighbours.
All of it is **fine-scale relief added into the heightfield, seeded per
volcano**. Surface normals are already computed per vertex, so the moment the
height varies the shading varies with it — terrain shading is not a separate
ask, it is what you get the instant the terrain is not smooth. Three things
decided in advance: **(i) per-volcano seed from the catalog number, not "three
or four variants"** — 126 volcanoes over five families means ~6 identical copies
of each variant and the eye finds repeats fast; a seed costs the same and gives
126 unique mountains that are identical on every reload. **(ii) Radial, not
isotropic** — volcanoes erode into rills running downhill from the summit;
isotropic noise reads as gravel, downhill gullies read as a volcano. **(iii)
Rotation is last, not first** — it does nothing until the shapes are actually
asymmetric. **THE OPEN RISK:** the grid is ~21 samples across a mountain, enough
for a silhouette and nowhere near enough for gullies. Gullies need roughly 3x
that, which is ~9x the triangles. **Measure before promising.** If it does not
fit, the answer is resolution that follows on-screen size, which is its own
session. This will push `lib/volcano-ridge.js` past 700 lines, so the variation
maths gets its own file.

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
