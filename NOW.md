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

**==> THE VOLCANO LAYER IS SEEN AND ACCEPTED, AND POLISH IS DEFERRED. <==**
Aaron on glass: shapes, footprints, calderas, the cyan mountains and the pinch
through the tilt band are all good. The severity glow and the wider moving sea
were seen and accepted with **"we'll polish it later"** — that is ACCEPTED, not
validated, and the two open risks below have not been separately confirmed.
Everything as-built is `SPEC-GLOBES.md` §42.1.

**Two risks that did not fire but were never separately checked.** An erupting
pip is now up to 78 device px and a few old GPUs clamp point sprites at 63,
which squares off the halo rather than erroring — if erupting pips ever look
CUT OFF, that is `marks.glowPad`. And a sea wider than its mountain covers some
of MapLibre's own painted ocean, which is the composite fault already open on
the plate lines below.

**Phases: A–I ✅ · H (plumes, lava and emission classes) ← next.** Route, join
key, parser traps and the closed questions are in the Project as
`claude/volcanoes-deep-2026-07-30.md` — **do not re-survey the nine centres.**
**The Phase H design is approved and written up as `SPEC-GLOBES.md` §42.1.5 and
§42.1.9** — read both before opening a browser; the short version is that a
plume is invisible from space, only an ash advisory earns a column, and lava
gets a glowing vent rather than an invented flow.

**DO ERUPTING VOLCANOES READ AS LIVE?** Still formally open. The live set now
carries a full-strength halo in magma orange, which is a standing glow and costs
no frames, and nothing else animates on this world. **If they still read as
inert, that is an argument for pulling Phase H forward, not for adding a pulse.**
*New wrinkle since the colour change:* the live set is now the same hue as the
plate seams, so "hard to find" and "reads as inert" are two different failures
with two different fixes — separate them before touching either.

**THE SHORE CUT IS DONE AND CONFIRMED ON GLASS.** The sea stops at the coastline.
As-built in `SPEC-GLOBES.md` §42.1.4c. **Do not re-derive a coastline from tile
geometry** — three cuts did and all three were reverted; the answer is already
on screen.

**ONE THING WAS NOT SEPARATELY CHECKED: TWO-FINGER ROTATE.** That is where the
third attempt died, and this one should be immune because it reads the screen
rather than the tile cache. Immune by argument is not immune. Ten seconds next
time the app is open near Kuwae, Kavachi or Palinuro — everywhere else looks
identical either way.

**AND THE FRAME COST IS UNMEASURED.** The copy is skipped when the camera has
not moved, so a still map with moving water should pay nothing — but nobody has
measured one of these frames, which is `NEXT UP` item 1 and now has a third
feature riding on it.

**==> THE WATER WAS REWRITTEN AS OPTICS AND HAS NEVER RUN. READ THIS FIRST. <==**
Aaron on the tuned-wave version: *"looks like cartoony shit."* He was right and
the reason was structural, not a bad number — brightness was a function of wave
HEIGHT where in the world it is a function of SLOPE seen from somewhere. So the
sheet is now a flat plane and the wave exists only as a per-pixel normal, with
refraction, a specular glint and fresnel on top of it. As-built is
`SPEC-GLOBES.md` §42.1.4c. **Colours are ACCEPTED on glass and were not touched**
— `#241A5C` body, `#D6C1E1` crests, *"I like the colors."*

**NOTHING BELOW HAS BEEN SEEN.** Static checks only: 165 modules parse, every
uniform cross-checked between GLSL and JS, all nine volcano suites and the water
mask pass. **A shader fails at COMPILE time on the GPU and no check here can
catch that** — if the sea is simply gone, that is a GLSL error and the console
names the line. The readout gained a word: `ref` / `ref-` / `ref!` after the
mask's, for the refraction copy.

**THE FIRST DIAL TO TOUCH IS `wave.refractPx` (12).** Refraction is the strongest
of the three cues on a map whose camera mostly looks down. Then `slopeScale` (4)
for calm-versus-choppy, which moves all three cues together because they read one
normal. `crestMix` (0.35) is the *tint*, and if the sea looks flatly coloured
rather than lit, that is the one that is too high.

**THE VIEW DIRECTION IS AN APPROXIMATION AND HAS A NAMED UPGRADE.** One vector
for the whole sheet, from pitch and bearing, because neither THREE's camera nor
MapLibre's has a usable position (`getFreeCameraOptions` is **not in the vendored
5.6.0 bundle** — checked). It gives a broad glint band rather than a hotspot. **If
the glint reads as painted-on, carry mercator position as a varying** and compute
per pixel; nothing else is wrong with it.

**AND THE FRAME COST WENT UP, ON TOP OF A REPAINT NOBODY HAS MEASURED.** A second
full-screen blit and a second `render()` call per frame, plus roughly a dozen trig
calls per water pixel. Both copies skip themselves when the picture has not
changed, so a still map with moving water should still pay little — but `NEXT UP`
item 1 is now carrying a fourth passenger.

**`proto/volcano-3d.js` IS 734 LINES, OVER §12's CEILING, AND THE INVENTORY IS
DONE.** `render()` is 162 lines and `buildScene()` 138 — the shape the ceiling
exists to catch. **The cut is identified and deliberately NOT TAKEN**: the water
`ShaderMaterial` is ~70 lines of uniform block that belongs beside its GLSL in a
`proto/water-material.js`, which lands the file near 660. Not taken because this
same pass rewrote the shader and split the scene and none of it has been on
glass, and a file move in the same commit makes a break impossible to attribute.
**Take it the moment the water is confirmed working.**

**ONE THING NOTICED AND NOT TOUCHED: THE LAYER'S +y MAY BE SOUTH.** Local metres
go into mercator through a pure scale-and-translate with no flip, and MapLibre's
mercator y grows southward — which would mirror every cluster north-south.
**Unverified**, and invisible so far because 133 mountains sit in 127 ridges, so
almost every cluster is a single cone and a lone cone mirrored about its own axis
is identical. It would show on a multi-member arc. Worth ten seconds with a
two-volcano cluster on screen before anyone builds anything else on this frame.

**==> THE VOLCANO LAYER IS SEEN AND ACCEPTED, AND POLISH IS DEFERRED. <==**
Aaron on glass: shapes, footprints, calderas, the cyan mountains and the pinch
through the tilt band are all good. The severity glow and the wider moving sea
were seen and accepted with **"we'll polish it later"** — that is ACCEPTED, not
validated, and the two open risks below have not been separately confirmed.
Everything as-built is `SPEC-GLOBES.md` §42.1.

**Two risks that did not fire but were never separately checked.** An erupting
pip is now up to 78 device px and a few old GPUs clamp point sprites at 63,
which squares off the halo rather than erroring — if erupting pips ever look
CUT OFF, that is `marks.glowPad`. And a sea wider than its mountain covers some
of MapLibre's own painted ocean, which is the composite fault already open on
the plate lines below.

**Phases: A–I ✅ · H (plumes, lava and emission classes) ← next.** Route, join
key, parser traps and the closed questions are in the Project as
`claude/volcanoes-deep-2026-07-30.md` — **do not re-survey the nine centres.**
**The Phase H design is approved and written up as `SPEC-GLOBES.md` §42.1.5 and
§42.1.9** — read both before opening a browser; the short version is that a
plume is invisible from space, only an ash advisory earns a column, and lava
gets a glowing vent rather than an invented flow.

**DO ERUPTING VOLCANOES READ AS LIVE?** Still formally open. The live set now
carries a full-strength halo in magma orange, which is a standing glow and costs
no frames, and nothing else animates on this world. **If they still read as
inert, that is an argument for pulling Phase H forward, not for adding a pulse.**
*New wrinkle since the colour change:* the live set is now the same hue as the
plate seams, so "hard to find" and "reads as inert" are two different failures
with two different fixes — separate them before touching either.

**THE SHORE CUT IS DONE AND CONFIRMED ON GLASS.** The sea stops at the coastline.
As-built in `SPEC-GLOBES.md` §42.1.4c. **Do not re-derive a coastline from tile
geometry** — three cuts did and all three were reverted; the answer is already
on screen.

**ONE THING WAS NOT SEPARATELY CHECKED: TWO-FINGER ROTATE.** That is where the
third attempt died, and this one should be immune because it reads the screen
rather than the tile cache. Immune by argument is not immune. Ten seconds next
time the app is open near Kuwae, Kavachi or Palinuro — everywhere else looks
identical either way.

**AND THE FRAME COST IS UNMEASURED.** The copy is skipped when the camera has
not moved, so a still map with moving water should pay nothing — but nobody has
measured one of these frames, which is `NEXT UP` item 1 and now has a third
feature riding on it.

**THE SEA IS VIOLET, ITS CRESTS CARRY COLOUR, AND THE WAVE HAS BEEN RETUNED
TWICE WITHOUT A CLEAN LOOK YET.** Colours are ACCEPTED on glass — *"I like the
colors"* — `#241A5C` body, pale `#D6C1E1` crests. The motion was not: **too slow
and it read as a QUILT.** Both were real and both were the same root cause,
which is that every wave number in this block was chosen at the old z8 ceiling.

- **Speed x6** (`speedMps` [140,90,60] → [840,540,360]). The old note reasoned in
  metres per second; what a person sees is PIXELS per second, and at 36 m/px the
  long train was moving under 4 px/s. **On-screen speed moves with zoom, so this
  number is only judgeable at a stated zoom** — if it now runs too fast, say at
  what zoom.
- **The lattice is broken by a sampling WARP** (`warpLengthM` / `warpAmpM`), not
  by more trains. Three sines are periodic whatever their ratios; the old
  comment claiming awkward wavelengths prevented a grid was wrong and is cut.
- **Crests are sharpened** (`crestSharpness` 2.0, `crestMix` 0.22 → 0.35 to hold
  the brightness). Narrow ribbons instead of soft blobs.

**THE WARP IS IN THE FRAGMENT PASS ONLY, AND THAT IS A DECISION WITH A TRIPWIRE
ON IT.** Warping the vertex pass too would drop the displacement grid from 3.0
samples per wavelength to ~1.7 — under Nyquist, which renders a travelling wave
as a STANDING zigzag — and surviving it costs roughly triple the water vertices.
It buys nothing today because the sea is unlit: no normals, one flat shade, so
displacement produces no shading at all. **The day the sea gets a normal that
stops being true**, and the grid has to be re-costed before the warp moves into
the vertex shader.

**AND THE FRAGMENT PASS NOW COSTS TWO MORE SINES AND A POW, ON TOP OF A
PER-FRAME REPAINT NOBODY HAS MEASURED** (`NEXT UP` item 1). If the phone gets
warm, that is where to look first.

**`tools/coast-probe.html` IS NOW ORPHANED.** It reports the live tile schema,
ring count and point spacing. Nothing uses tile geometry for the shoreline any
more, so it is a diagnostic with no consumer — delete it the next time anything
in `tools/` is touched.

**THE VOLCANOES WEAR THE WORLD'S OWN TWO COLOURS AND AARON HAS SEEN THEM.**
Quiet is the coastline's orchid `#DB8EF0`, live is the plate seam's magma
orange `#FF7A1A` — *"the colors look great."* **Kept through the revert; they
were never part of it.** The measured objection is recorded and does not stand:
an erupting volcano is now the same hue as the seam it physically sits on,
where gold held 17°. **If an orange pip is ever hard to find against an orange
seam, that is this** — and the fix is hue, since this colour already failed
once by going pale.

**WHAT SURVIVED THE REVERT, AND IT IS WORTH KEEPING.** Two files were over the
§12 ceiling and both came under it: the sea sheet left `lib/volcano-ridge.js`
(778 → 632) as `lib/volcano-water.js`, and the two GLSL programs left
`proto/volcano-3d.js` as `proto/water-shader.js`. Structure only — no
behaviour rode along.

**THE MAGMA SEAMS HAVE NOT BEEN JUDGED, ONLY MEASURED.** Three passes at
1 : 4.4 : 10; a cut across a seam measures luminance 242 / 84 / 45 against a 38
background. Only the middle pass overlaps USGS MMI's range, and the rule that
resolves it stands: **quake severity on Deep is size and ripple strength, never
hue** (`SPEC-GLOBES.md` §43.2). **Look at whether the core reads as molten or as
fairy lights.**

**THE PLATE LINES MAY SAG IN THE MIDDLE OF THE DIVE.** Pixel counts across the
crossfade ran 8571 → **4844** → 10285 at z2.25 / 2.5 / 2.75: at the midpoint the
3D seams are at 74% and MapLibre at 58%, and two half-faded copies of one line do
not composite back to a whole one. Structural, and the three-pass stack widens
the gap. **Zoom in slowly from space and watch.** Fix is in `DIVE.fade`, which
the shipped coastline rides too, so it is not a prototype-only change; the deeper
fix is ribbon geometry (§43.2.2).

**THE LAND HANDOFF HAS THE SAME MIDPOINT FAULT.** A "shading" at mid-zoom that is
two land fills overlapping during the dive — MapLibre's `landFaint`/`land` fading
up under the Three sheet's translucent white, on two different bands. Same
structural cause, same `DIVE.fade`, and **fixing one should fix both.** Not a
bulge: both renderers use a perfect sphere at radius 1.0.

**THE PLATE NAMES WANT A GLASS READ ON TWO NUMBERS.** `SIZE.plateLabelPx` is 10.5
and at the planet band on a 429 px globe that is very small — move it first if
they are hard to read. `PLATE_LINE.labelBands[].anchorDeg` is the density dial at
95/34/9. Two things that are DESIGN rather than misses: a plate with four
boundaries in view is named four times, and the band handovers at z4.0 and z5.5
show one name at half strength in two places for 0.3 zoom levels. Both explained
in §43.2.2; the second may read as a ghost rather than a fade.

**THE "STATE NAMES" TOGGLE WILL DO NOTHING ON DEEP.** `setAdminVisible` is a safe
no-op there — safe, not honest. Whoever wires Deep into the real drawer has to
hide that switch on this world. Nothing is broken today because the prototype has
no drawer, so there is no caller to write the code against yet.

**==> THE ASH CHANNEL HAS NO ARCHIVE AND THAT IS THE LAYER'S BIGGEST HOLE. <==**
The bulletin slots are latest-only and overwritten in place, so **ONE MISSED POLL
IS ONE PERMANENTLY LOST ADVISORY.** **SCOPED, NOT BUILT** —
`claude/ash-archive-scope-2026-07-30.md` in the Project. Shape: one KV key per
advisory, written once, 30-day TTL, raw text not parsed, on its own key prefix.

**Two things must be MEASURED before a line of it is written.** How much of the
free plan's **1,000 KV writes a day** the warm loop already spends (that, not the
50-fetch cap, is the binding constraint). And whether `ash.js` honours the
warm-key bypass at all: its stampede guard and the cron are both five minutes, so
**the Worker may be spending every cycle reading its own last answer.**

**LEGACY VOLCANO NUMBERS ARE STILL ON THE WIRE.** Read live from Anchorage's
slots: `KATMAI 1101-17` and `PAVLOF 1102-03`, region-style numbers GVP retired in
2013. They cannot join the catalog and are dropped as `unknown_volcano`. Katmai
also arrives as `312170` elsewhere so it survives; **Pavlof may not.** Aaron has
ruled out a crosswalk — recorded so the count is understood, not so it gets
fixed.

**Two claims are NOT confirmed and must not be built on.** The 16 Decade
Volcanoes list is model memory only. And "21 of 22 weekly reports state a plume
height" did not reproduce — a first parse got **6 of 22** heights and 10 of 22
drift bearings. **Phase H1 writes a real parser and re-measures before any
pixel depends on a height being present** (§42.1.5).

## NEXT UP

**1. WHAT A MAPLIBRE FRAME COSTS — AND TWO THINGS NOW PAY IT.** Undone, and more
urgent than when it was written. `attachIdleRotation` calls `setCenter` per frame
below `DIVE.zHandoff`, so a resting globe already drives a full map repaint —
including at the space floor where the map is at CSS opacity 0 and invisible.
**Moving water now pays it too**, at map zoom, via `triggerRepaint()`. Measured:
drift pinned, zero MapLibre renders per second; unpinned, one per frame. **Nobody
has measured what one of those frames costs.** `proto/shell.js`'s self-driven
loop is the shape of the fix. Do it before smoke, dust or any further continuous
effect.

**2. THE ENFORCED CSP NEEDS A GLASS READ, AND IT IS THE ONE THING THAT CAN BLANK
THE APP.** The policy is out of Report-Only and blocking for real.
`tools/csp-check.mjs` passes but runs offline, so **a selected storm, satellite
imagery and radar were never exercised** — the paths most likely to reach a host
the policy has not been told about. Open a storm on a phone with imagery on. If
something breaks, put the header back to `Content-Security-Policy-Report-Only`
and redeploy; that is a one-word fix.

**AND THE POLICY HAS ALREADY EATEN ONE TOOL.** `tools/imagery-probe.html`
carries an inline `<script>`, and `script-src` has no `'unsafe-inline'` — so on
the deployed site it is almost certainly dead, loading as a page whose controls
do nothing. Not verified on glass, and nothing in `tools/csp-check.mjs` covers
`tools/`. **The fix is the one `tools/coast-probe.js` already uses: move the
script to its own file.** Worth knowing before anybody reaches for that probe
and concludes the imagery is broken.

**3. RESPONSIVENESS — SHIPPED, AWAITING A GLASS READ.** The five fixes are in and
the counts are asserted by `tools/test-recompute-budget.mjs`; what is NOT known is
whether INP crossed under the 200 ms bar. **Read Web Analytics after a day of
traffic** — map canvas and disclaimer nudge. Boot long tasks are NOT the remaining
suspect: 2–3 tasks and ~900 ms before DOMContentLoaded against ~7000 ms after it,
which is the idle rotation loop and belongs to item 1.

**4. THE BOOT SCREEN IS UP FOR FOUR SECONDS AND NOTHING MEASURES IT.**
`tools/load-probe.mjs` on a 4x-throttled phone: the veil lifts at **3982 ms**,
while Chrome reports LCP at 340 ms. `#boot` is opaque and `inset: 0` and Chrome's
LCP does no occlusion test, so **every LCP number this project has is timing an
element nobody can see.**

Roughly 1.9 s sits between DOMContentLoaded and the globe. `tools/boot-profile.mjs`
names the biggest single piece — a 4096x2048 land texture, **511 ms in
`texImage2D` plus 202 ms rasterising it**, on every cold load, for a sphere first
seen from space. Halving the texture is the obvious first swing and it is
untested. The other half is unattributed; profile before guessing.

*Two dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck (3982 ms healthy vs 3807 ms unreachable), and preloading was
measured and rejected (see `_headers` and the probe's `--preload` switch).

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

## KNOWN AND ACCEPTED

- **The slow tail is WINDOWS, and it is worse than the 8.6 s P99 suggested.**
  Per platform: Windows averages 4,389 ms LCP against ~550 ms everywhere else,
  maxes at **44,460 ms**, and averages 1,917 ms of long tasks. `t_globe_ms` tracks
  it to within 300 ms at the maximum, so the whole boot took 44 seconds — not one
  metric misfiring. 26 of 105 sessions. Nobody has looked at what they have in
  common.
- **iOS's clean long-task numbers are an instrumentation gap.** All ten WebKit
  sessions report `longtask_n = 0` because WebKit does not implement the observer.
  Do not read that column as "iPhones never block".
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
