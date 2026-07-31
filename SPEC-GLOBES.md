# SPEC-GLOBES.md — the world model

**This is §38–§44 of the Landfall spec.** Companion to `SPEC.md`, which remains
the source of truth for the laws, the failure philosophy, the fixed colour
contracts and the input model. This file covers ONLY the extension from one
globe to several: what a world is, how you move between them, and what each one
is made of.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered.
> Fences ("do not re-propose X") live in SPEC.md's SETTLED list, one line each.
> **Section numbers are permanent addresses.** A section may move between files;
> it may never be renumbered.

**§38–§44 are SCOPED, NOT STARTED.** Nothing in the app reads them yet. What is
recorded here is architecture and measurement, not shipped behaviour. Same
status as SPEC-HAZARDS.md §18–§26, and the two files are read together — this
one says how a hazard is DRAWN, that one says where its data comes from.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact not yet tested.

---

## 38. The world model

**One app. Several globes. A switcher between them.**

A **world** (used interchangeably with "globe") is a complete visual and
behavioural identity: its own settings, its own layout, its own design language.
Worlds are not themes and not layer presets. Two worlds should not look like the
same product in different colours.

### 38.1 What a world owns

| A world owns | Where it lives |
|---|---|
| Palette and visual tokens | `config/worlds/{name}.js` |
| Layer manifest — which layers exist and their types | same |
| Visual system — the one rendering technique it is built around (§40) | same |
| Data adapters, poll cadences, cache TTLs | same |
| Its from-space read (§38.4) | same |
| Its basemap palette and layer manifest | same, applied by `map/style.js` |

**BUILT, AND THE BASEMAP HALF IS LIVE IN THE PROTOTYPE.** A world descriptor
carries four things the basemap cares about: `map`, a set of colour overrides
keyed exactly as `map/style.js` reads them; `graticule`, whether the world draws
the three reference latitudes at all; `plates`, the plate boundary colours or
`null` for a world that draws none (§43.2); and `admin`, which classes of
administrative furniture the world wants. `buildStyle({ palette })` layers the
overrides onto the live theme palette; `createGlobe(container, { palette })`
forwards them so a world never installs a style it is about to replace. Deep
(`config/worlds/deep.js`) overrides all fourteen basemap colours and draws no
graticule; Sky (`sky.js`) overrides nothing, which is how it stays the only
world that follows light and dark mode.

**DEEP DRAWS NO STATE OR PROVINCE FURNITURE.** On a map whose subject is plate
boundaries, a provincial border is a line of the same weight meaning something
incomparably smaller, and the seams cross it everywhere. Both the lines and the
names are ABSENT rather than hidden — a world declining a class of furniture
should not leave MapLibre laying it out behind a `visibility: none`, which a
stray `setLayoutProperty` could also switch back on.

**AND DROPPING A RUNG FORCES LENGTHENING THE ONE BELOW IT.** `ADMIN.nameLadder`
fades country names out at z5 precisely because state names have taken over by
then. Delete state names and that fade leaves a nameless map from z5 until cities
arrive at z6.4, which breaks the ladder's own written invariant. So Deep also sets
`sustainCountryNames`, and country names hold from `countryIn` to the top of the
zoom range. **The RISE is byte-identical to Sky's** — a world changes when a rung
ENDS, never when it begins — and both the sustained fade AND the removal of the
layer's `maxzoom` are required, because leaving the `maxzoom` in place retires the
layer at z5 whatever the opacity says. Same bug in a different property, and
invisible in the constants; `tools/test-world-basemap.mjs` samples the whole zoom
range instead of trusting the six numbers.

**A KNOB ADDED TO A LIVE APP NEEDS SOMETHING CHECKING THE DEFAULT.** The shipped
app passes no `admin` block at all, so the defaults ARE its current behaviour;
that suite asserts Sky and no-world produce an identical layer list and an
identical country-name layer, because "the default is the old behaviour" is a
claim.

**ONE OPEN CONSEQUENCE.** `setAdminVisible` is the user's own state-names toggle.
It is already safe on a world that draws none — it guards on `getLayer` — but safe
is not honest: whoever wires Deep into the real drawer has to hide that switch on
this world, or ship a control that silently does nothing (§5).

**A world states only what it CHANGES.** Overrides layer over the theme palette
rather than replacing it, so a colour added to `style.js` later resolves to the
app's value instead of `undefined` — which MapLibre does not throw on, it
silently rejects the layer. `tools/token-check.mjs` separately asserts every
world covers every key `style.js` reads, so "quietly kept the app's blue" fails
at check time rather than on a phone.

**`map/style.js` RESOLVES THE PALETTE EXACTLY ONCE, and the tool enforces it.**
Its six layer builders each called `palette()` for themselves, which is
invisible and correct until a world overrides the basemap: the override then
reaches only the code that holds the merged palette. Shipped that way for
minutes and the ultraviolet world repainted the sky while eighteen of
twenty-one colours stayed blue. Nothing threw, and it reads as "the override
doesn't work" rather than as a named line. One call at the top of
`buildStyle()`, a parameter everywhere below.

**`graticule.js`'s three lines are a Sky layer, not furniture.** The equator and
the two tropics are on the map because of cyclones — a storm cannot cross the
equator, and the tropics bracket the water they form in. On a quake-and-volcano
globe they mean nothing, so Deep turns them off through the existing
`setGraticuleVisible()`. A world's layer manifest is re-applied on every
`style.load`, because a style rebuild puts the layers back visible.

### 38.2 What every world shares

The camera and the one-zoom model (SPEC.md §2). The input model — touch, mouse
and keyboard, all first-class (SPEC.md §10). The drawer and its history stack
(SPEC-UI.md §16). The status strip. The install flow and service worker
(SPEC-OPS.md §17.11). The relay and its cache. The failure philosophy and the
three states (SPEC.md §5). The fixed colour contracts (SPEC.md §6).

**The shared part is the chrome and the laws. The distinct part is everything you
look at.** Getting that boundary right is the whole project; a world that needs
to reach into shared code to express itself is a world that was cut wrong.

**THE CAMERA CONTRACT HAS AN ADDRESS: `map/globe-follow.js`.** MapLibre owns
every gesture and the one zoom; anything drawn in Three.js on top is a passenger
that reads MapLibre's centre, bearing and on-screen size each frame and copies
them. That copy is three signs, a projection measurement and a distance formula,
and each has been wrong at least once. It is one file, imported by both the
shipped globe and the prototype.

**A world that hand-rolls its own input is cut wrong, and this is not
hypothetical.** The three-worlds prototype did exactly that, because the shipped
globe has no input code to copy — `globe3d.js` sets its canvas to
pointer-events:none and MapLibre underneath does all the driving, so there was
nothing visible to reuse and a second model got written instead. It had the
vertical drag backwards, the arrow keys backwards, no two-finger twist and no
momentum. Extracting the follower is what makes the boundary reusable rather
than merely described.

### 38.3 A world switch is a theme switch with a bigger payload

`app/theme-switch.js` already performs this operation at one-tenth scale, and
its phase order is correct and load-bearing:

1. **`applyTokens()`** — rewrite the CSS variables. The whole interface repaints
   with no per-component work. Needs no rendering engine, which is why boot can
   call it before either engine exists.
2. **The 3D engine** — materials, geometry and textures, with disposal.
3. **`buildStyle()` → MapLibre restyle** — the slow one, and it is last because
   it is the one the user waits on.

**A world switch is that same sequence.** What changes is payload: the palette
swap becomes a whole visual system teardown and rebuild, and the style rebuild
carries a different layer manifest. `config/theme.js` is the pure palette and
mode resolution and stays DOM-free; `config/worlds/` sits beside it and is
resolved the same way.

**Disposal is not optional and it is the known crash path.** A session switches
worlds repeatedly. Every texture, geometry, material and buffer a world creates
is released when it is torn down. `globe3d.js`'s `retheme()` already disposes
textures on a theme change and that habit scales up here, not down.

### 38.4 Every world needs a from-space read

The globe is the product, and out at the space floor it is roughly **200 px** on
a phone. The from-space read is what answers *is anything happening* before a
single label has been read.

Requirements, all of them:

- **Readable at ~200 px.** If it needs individual features resolved, it fails.
- **Answers the question in about a second**, ahead of any text.
- **Never colour alone.** WCAG, and the palette collisions in SPEC.md §6.
- **Nearly free to draw.** This lands in the first-paint budget, which is already
  a live problem — the globe currently takes ~4 s to appear.
- **One continuous global structure that deforms locally.** This is the node
  cage's real trick (SPEC-MAP.md §9.4) and it is why it works: you read the
  whole planet's state and the local anomaly in the same glance. A read made of
  discrete per-event glyphs cannot do that. The form may change completely
  between worlds; this property should not.

**The node cage belongs to Sky and does not travel.** Every other world builds
its own answer.

---

## 39. The switcher and the transition

### 39.1 The switch happens at the space floor and nowhere else

During the transition both worlds are briefly resident and both are drawing.
**That is the single most expensive frame in the app** — peak memory and peak
transparent overdraw at the same moment.

The space floor is where it is cheapest, and the reasons are structural rather
than aesthetic:

- The planet is at its minimum screen coverage, so overdraw is at its floor.
- **MapLibre is already at opacity 0 above `DIVE.zSpace`** (SPEC-MAP.md §7.2), so
  `setStyle()` — the slow phase of §38.3 — runs where nobody can see the canvas
  being rebuilt. The expensive step is free precisely here and nowhere else.

**So there is no path to switching worlds at close zoom.** Building one would
require funding a two-stack crossfade at maximum fill with two live MapLibre
styles. Do not build that door. This is a fence, not a default (SPEC.md SETTLED).

The narrative reading — fly out to space, the planet changes, fly back in — and
the performance reading agree completely. That is rare; take it.

### 39.2 The switcher is a place, not a button

**The control cluster does not gain a sixth button.** View control, Storms,
Layers, Home and Settings are places to go *within* a world. A world switcher is
their parent, not their peer, and a sixth target in the thumb zone puts a mode
change one mis-tap from Home.

**At the space floor the other worlds are simply present** — the current planet
centred, the others adjacent and dim and real. Selecting one moves the camera.
Zero chrome, and the switch becomes somewhere you go rather than a menu you open.

**That is gesture-only, which under SPEC.md §10 means it does not exist yet.**
Every action has a tap path, a click path and a keyboard path. So the ambient
space-floor affordance is accompanied by a real focusable world list running the
identical camera move, and every world is reachable by Tab with a visible focus
ring. Screen-reader labels name the world and its state.

**Discoverability is a first-run problem, not a chrome problem.** A first-time
user does not know to fly out. `ui/first-run.js` owns that.

### 39.3 The transition is animated, and it is one renderer

An animated switch rules out a page load, which rules out separate apps. **One
renderer, one canvas, one camera, for all worlds.** Worlds swap their contents;
they never swap the machine drawing them.

`[DECIDE]` The transition's own choreography — whether the planet re-skins in
place, whether the camera travels between adjacent planets, and what the other
worlds look like while dormant.

---

## 40. The rendering budget

### 40.1 The binding constraint is transparent overdraw, not geometry

**Geometry count is nearly free. Transparent screen coverage is not.**

1,196 volcano markers as one instanced point cloud cost one draw call and are
irrelevant to the frame budget. Ten thousand overlapping semi-transparent
particles covering the screen will thermally throttle a phone in roughly ninety
seconds regardless of how fast its GPU is, because every overlapping layer makes
the device paint the same pixels again.

Every effect this expansion wants — smoke, ash, embers, dust, ripples, water —
is semi-transparent. **Budget screen coverage and overlap. Never object count.**

**This is the argument for one visual technique per world (§41–§43).** Smoke and
embers share a technique and can coexist. Ripples and dust share one and can
coexist. Stacking smoke over water over dust in one frame is the
failure case, and the world split is what makes it impossible rather than merely
discouraged.

### 40.2 Everything is instanced, batched, or GPU-computed

**Never many separate objects.** This is not a style preference; it is what the
renderer is good and bad at.

WebGPU in three.js is currently *slower* than WebGL for large numbers of
individual objects — 50,000 separate cubes measured at 3–6 fps on WebGPU against
40 fps on WebGL on an M4 Pro, with the per-object uniform buffer system named as
the cause. The same renderer is dramatically faster for instanced geometry and
for GPU compute.

Every effect on the list happens to sit in the strong quadrant — instanced point
clouds, instanced quads, compute-driven particles. **That is only true if the
discipline holds from the first commit.** A world that grows a few hundred
individual meshes has quietly moved itself into the weak quadrant.

### 40.3 Engine baseline

- **The app is on three.js r128 (2021). Current is r182+.** The gap is five years
  and it is the gate on everything in §41–§43.
- `WebGPURenderer` became production-ready in **r171** (Sept 2025), zero-config:
  `import { WebGPURenderer } from 'three/webgpu'`.
- **TSL (Three Shading Language)** expresses effects in JavaScript and compiles to
  both WebGPU and WebGL2. One source, automatic fallback. **This is what keeps
  SPEC.md's no-build-step rule intact** — an effect language that needed a
  compiler would be disqualified no matter how good it was.
- **WebGPU ships enabled by default in Safari 26** (iOS 26, iPadOS 26, macOS
  Tahoe 26), Chrome 113+ on desktop, Chrome 121+ on Android. Firefox is partial.
  The phone platform that historically gated this no longer does.
- **`WebGPURenderer` requires `await renderer.init()`.** `map/globe3d.js:41`
  constructs a synchronous `WebGLRenderer` today, so adopting it moves boot
  ordering — and boot is already the app's worst measured problem.

### 40.4 Techniques evaluated and rejected

**Gaussian splatting — rejected for smoke, rejected for water.**

A splat is a soft anisotropic blob. Splats are transparent, so they must be drawn
back-to-front, and **that ordering changes every time the camera moves.**

- The leading three.js implementation (`mkkellogg/GaussianSplats3D`) sorts **on
  the CPU**, states in its own documentation that a GPU approach is unsolved,
  lists sub-optimal mobile performance as a known issue, and **disables its
  GPU-accelerated sort by default on mobile.**
- **Landfall's camera never rests** — idle rotation is specified behaviour
  (SPEC-MAP.md §9.7) — so the sort would run every frame, permanently, on a
  phone.
- Splats are the heaviest possible transparent overdraw, which §40.1 identifies
  as the only budget that binds.
- Photo-to-splat demos are not smoke engines. They run a depth model over a still
  photograph; the smoke-like quality comes from the source image and there is
  nothing to drive with live data.

**The salvageable idea, and it is worth costing: pre-baked splat ash columns.**
Splats are bad at simulating and good at *being* a soft volume that already
exists. There are only ~25 erupting volcanoes at any time (§42). One small
hand-tuned cloud each, sorted per-cloud rather than per-splat — 25 clouds ordered
against each other is cheap, and wrong ordering *inside* one diffuse blob is
invisible — scaled to the reported plume height and tilted to the reported drift
direction, both of which are real published values (SPEC-HAZARDS.md §22.4). No
simulation running. `[VERIFY]` unmeasured on a phone.

**Grid-based fluid simulation — the standing lead for smoke.** Real fluid
physics: semi-Lagrangian advection, vorticity confinement, divergence-free
pressure solve, on WebGPU compute. The published three.js implementation runs a
128×128 velocity buffer and a 512×512 density buffer. **It is a screen-space 2D
solver — a post-process, not a volume anchored to a point on a globe.** Adapting
the technique to a small local volume per plume is the actual work, and no mobile
numbers are published. `[VERIFY]`

**A limb glow is lit on the sphere's own front face, never on a shell around
it.** A separate shell rendered back-side is brightest at ITS OWN silhouette, so
it draws a ring at whatever radius the shell sits at and no resizing walks that
ring onto the planet — the ring IS the shell's edge. Lighting the globe's front
face puts the bright edge on the true silhouette by construction, which is the
same diameter the surface layers are drawn on. It also costs three fewer meshes
and one fewer full-disc transparent pass. Do not re-propose an atmosphere shell.

**Neither applies to water.** A flood is a flat sheet with ~258 vertices of
affected-area polygon (SPEC-HAZARDS.md §23.1). An animated surface treatment is
both the right shape and far cheaper than any particle or splat approach.

---

> **THE THREE WORLDS, AND WHERE EACH ONE IS WRITTEN DOWN.** The names sit on one
> axis — above the planet, on it, below it — and the grouping is by what the data
> IS rather than by rendering trick.
>
> | World | Hazards | Draws | Sections |
> |---|---|---|---|
> | **Sky** | tropical cyclone | paths through time | §41 |
> | **Surface** | flood, drought, wildfire | painted regions | §42, §42.2, §43.5 |
> | **Deep** | earthquake, volcano | points on a glowing plate skeleton | §43, §43.1–§43.4, §42.1 |
>
> **TWO SUBSECTIONS SIT UNDER A PARENT THEY DO NOT MATCH NUMERICALLY**, and that
> is correct: §42.1 (plumes) belongs to Deep and §43.5 (drought) belongs to
> Surface. Section numbers are permanent addresses, so a section that changes
> owner keeps its number rather than breaking every pointer at it. Each carries a
> note saying so.

---

## 41. Sky — tropical cyclone

**This is Landfall as it exists today.** Everything shipped in SPEC-MAP.md and
SPEC-UI.md describes this world.

- **Visual system:** paths moving through time — spirals, tracks, cones, wind
  bands.
- **From-space read:** the cyan geodesic node cage (SPEC-MAP.md §9.4). Node
  elevation and node colour encode live severity. **The cage belongs to this
  world only.**
- **Hazards:** tropical cyclone (SPEC-HAZARDS.md §19, and the whole of the
  shipped app).

**ALONE BY CHOICE.** Biggest data volume, most finished, and nothing else needs
the track-and-cone machinery. That also closes the old question of whether the
cage should generalise from storm severity to total hazard energy: one hazard, so
the cage stays cyclone-only.

**FLOOD LIVES ON SURFACE (§42), BUT STORM SURGE AND RIVER GAUGES STAY HERE.**
They are hurricane context, and during a landfall the flooding must not be on
another tab. NWPS gauge stage and flood category give the US a rising-water read
(SPEC-HAZARDS.md §23.3).

---

## 42. Surface — flood, drought and wildfire

- **Visual system:** painted regions. Slow, area-based, seasonal.
- **From-space read:** `[DECIDE]`. Must meet §38.4 in full.
- **Hazards:** flood (SPEC-HAZARDS.md §23); drought (§24); wildfire (§21).

**THE GROUPING IS THE WATER CYCLE** — too much water, too little, and what burns
when there is too little. Drought and fire overlap by definition. Flood overlaps
too: burn scars are where flash floods happen for years afterward.

**Flood renders as an animated surface, not particles** (§40.4). `Poly_Global` is
dropped — ~1,567 vertices of background for ~258 vertices of signal.

**TWO OPEN COSTS, AND BOTH ARE CONSEQUENCES OF THE SPLIT ITSELF.**

1. **Drought lost its free rendering path.** Modulating dots cost nothing only
   because drought used to live on the dot-matrix globe. Here it needs a new
   answer, and a full-screen haze is ~40% of the frame budget for one layer and
   is disqualified (§40.4).
2. **Three area layers compete for the same land** — drought classes, burn scars
   and flood sheets, painted in the same places. Needs a layer-priority rule or a
   toggle. Sky and Deep each have one dominant look; this world does not.

`[DECIDE]` This world's land form: filled geometry with region tints, or a
restyled dot field. Judged on a phone after Deep is built, with real drought
polygons in hand.

### 42.2 Fire is a zoom ladder, and the burning edge is derived

102,822 detections a day (SPEC-HAZARDS.md §21.4). Rendering them all at globe
distance is neither possible nor meaningful, so the ladder is by fire radiative
power: **≥500 MW = 5,086 points at globe distance; ≥100 MW = 37,921 at mid;
everything flown in.** Ember particles ride only the top handful.

**The burning edge is a derived product, not a fetched one** — perimeter vertices
within a few km of a recent hot detection. A dark scar with a live glowing arc
along one side, advancing day to day.

**Perimeters are US-only** (NIFC, §21.3). Outside the US there are glowing
detection clusters and GDACS burnt-scar polygons, and no burning edge. That is a
coverage limit to design around visibly, not to hide.

---

### 43.5 Drought has no global data, and on a dot matrix that is a §5 problem

> **Numbered 43.5, filed under Surface.** Section numbers are permanent
> addresses (the rules at the top of this file), so a section that moves
> between worlds keeps its number rather than breaking every pointer at it.

US Drought Monitor covers the United States in 5 polygons; Copernicus covers
Europe. **There is no usable global drought product** (SPEC-HAZARDS.md §26).

On the dot form it was prototyped against, **"no drought" and "no data" look
identical** — in both cases the
dots sit at rest. That is the app quietly reporting *clear* about places it knows
nothing about, which is exactly the failure SPEC.md §5 exists to prevent, and it
is worse here than in a list because nobody reads a caveat under a globe.

**The fix belongs in the design, whichever form this world lands on** (§42): the
uncovered regions carry their own resting state — readable as *not measured* without shouting, and without
competing with the drought signal itself. Get that right and the coverage map
becomes part of the look rather than a hole in it.

---

## 43. Deep — earthquakes and volcanoes

- **Visual system:** points on a skeleton — instant events on glowing plate
  seams. **The dominant effect is the cheap one**: a single instanced point
  cloud, per-point maths, almost no transparency. The plume (§42.1) is the one
  expensive thing on this globe.
- **From-space read: the dot matrix** (§43.1). Settled, in form and in owner.
- **Hazards:** earthquake (SPEC-HAZARDS.md §20); volcano (§22).

**~90% OF EARTHQUAKES AND VOLCANOES SIT ON PLATE BOUNDARIES**, and PB2002 is
already shipped (§43.2). Both hazards are the same shape of data — a point, a
time, a size — and the off-boundary exceptions (Hawaii, Yellowstone, New Madrid)
are interesting rather than embarrassing.

**A DOT FIELD IS A WAVE MEDIUM AND CANNOT DRAW A PLUME.** Quake ripples are
effectively free on this form; rising smoke and ash are not, and nothing has been
tried. §42.1 carries the plume budget and now sits at the end of this section.

**SEVERITY ON THIS GLOBE IS SIZE AND RIPPLE STRENGTH, NEVER HUE.** The plate
seams are magma orange (§43.2), and USGS MMI and PAGER both publish orange ramps
for exactly the hazard this world draws. A hot seam and a severe quake must not
be the same colour. SPEC-HAZARDS.md §20.6 already says magnitude drives size;
this makes it binding.

### 43.1 The dot matrix

> ==> **MOST LAYERS ON THIS WORLD DRAW WITH DEPTH TESTING OFF, SO `renderOrder`
> IS USUALLY THE ONLY THING DECIDING OVERLAP — AND A NEW LAYER MUST BE PLACED
> AGAINST THE DOTS, NOT AGAINST WHATEVER IT SITS NEAREST.** <== Depth is off on
> purpose for the flat layers: which side of the planet a dot or a mark is on is
> decided by its FACING in the shader, so the far hemisphere shows through the
> glass instead of being clipped by it (the same read `map/globe3d.js` uses for
> its far continents). The cost of that is that the depth buffer stops
> arbitrating anything, and the ordering has to be stated by hand.
>
> ```
> 0  glass orb    2  land sheet    4  volcano pips
> 1  plate seams  3  dot field     5  volcano edifices
> ```
>
> **The dot field at 3 is the trap, because it is 90,000 points at 0.95 opacity
> and it draws LAST of the flat layers.** The volcano marks shipped at 2 —
> ordered correctly against the seams at 1, never checked against the dots — and
> the field painted over the entire layer. **Anything added above the shell goes
> above 3.**
>
> ==> **TWO LAYERS DO USE DEPTH, AND "EVERYTHING IS DEPTH-OFF HERE" WAS WRITTEN
> HERE AS A RULE WHEN IT WAS ONLY EVER A MAJORITY.** <== Corrected 2026-07-30
> after it was quoted at a build and turned out not to be true of the code:
>
> - **The glass orb WRITES depth**, at radius 1.0. It is the only thing that
>   does, and it is why the other flat layers can ignore the buffer entirely —
>   nothing they draw over ever wrote to it.
> - **The plate seams test depth and do not write it**, deliberately, so
>   far-side seams hide behind the planet rather than showing through it. The
>   same call `map/globe3d.js` makes for its cage, and part of why the sphere
>   reads as a solid object.
> - **The volcano edifices test AND write depth, and clear the buffer first.**
>   Writing is what stops the back of a cone painting over its own front; a
>   caldera is not convex and mountains overlap in Kamchatka, so nothing cheaper
>   works. Clearing is what stops the orb clipping the far hemisphere, which
>   would leave one layer disagreeing with every other about which side of the
>   planet you can see. They draw last, so the clear costs a buffer wipe and
>   nothing after it.

Landmasses render as a uniform grid of small dots floating above a dark glass
sphere, with atmospheric rim glow at the limb.

**The water carries the same field at the same spacing and the same brightness** —
one even matrix over the whole planet. One point cloud with a per-dot land/sea
flag, not a second object: the difference is two `mix()` calls, and a second draw
call would be a real cost for no reason. **The reason it covers the water at all
is that the dots ARE the wave medium**, and a medium that stops at the coast is a
ripple with a bug: a quake off Japan has to send something across the Pacific.

**PARITY WAS NOT THE FIRST ANSWER, AND THE REASONING THAT LOST IS WORTH KEEPING.**
The ocean is 71% of the ball, so the prediction was that a sea field at land
density would erase the continents — the only thing ever drawing a coastline
being the CONTRAST between dots and empty glass. On glass that was wrong: the
translucent land sheet underneath is what draws the continents, and one even
field reads as a made object where two densities read as an effect. Confirmed
2026-07-29.

**The three knobs that would walk it back still exist**, at parity values, and
they are in that order of effect: sea spacing as a MULTIPLE of land spacing (so
one density control owns both and they cannot drift), sea dot diameter as a
fraction of the LAND spacing (a sparser sea dot must not also be a bigger one),
and sea brightness. At exactly 1x the two passes generate the same spiral and
split it between them, so the seam at the coast is exact rather than merely
close. The sea count is derived by dividing the land count by the multiple
squared rather than recomputed from its own spacing — run through the min/max dot
clamps a second time and at the extremes both fields land on the same density,
which would make "further apart" unenforceable exactly when it is needed.

Wave LIFT is deliberately not scaled per field, so a ripple crossing a coastline
keeps one wave height instead of stepping up over water.

**THE DOT SHELL AND THE LAND SHEET SHARE ONE PLANE AT 1.050, AND IT IS NO LONGER
THE CAGE PLANE.** Both used to be separate — dots imported `DIVE.cageRadius`
(1.065) so they could not drift from the shipped globe's node mesh, and the sheet
sat at 1.050 under them. Coplanar is what stops the sheet reading as a second
object sliding under the field, and the dots draw after it with depth testing
off, so there is nothing to punch through. The cage link is cut deliberately;
this is a look number for this world now.

**THE DOT SHELL OVERHANGS THE GLASS, AND THAT IS THE LOOK.** The shell is 5%
wider than the planet, so far-side dots near the limb project OUTSIDE the
silhouette as a speckled halo. It was invisible while only continents reached the
limb and is continuous now the field is complete. Confirmed on glass 2026-07-30:
it reads as an atmosphere of dots, and it stays. Do not "fix" it by clipping dots
to the silhouette or by lowering the shell — the second would also break the
coplanar land sheet.

Between the glass and the dots sits a **translucent white land sheet** — the
continents as a thin veil, with the plate seams drawn through it. Both take
their colour from the orb's own lighting, so the tint sweeps across the land as
the planet turns under a fixed light, and both switch palette live with the rim
pair.

**NEITHER TAKES A LIMB TERM, AND THAT IS THE ONLY REASON THEY CAN FLOAT.** A lit
surface is brightest at its own silhouette, so anything standing off the ball
rings at its own radius and the planet reads as two edges — the failure §40.4
records for the atmosphere shell, and the same one that killed every earlier
version of this. The glass keeps its edge light because the glass's edge IS the
planet's edge. Everything above it is coloured by light DIRECTION only, which
leaves nothing on those surfaces that knows where their own edge is. Height then
becomes a free parameter rather than a thing to fight.

**The form was chosen for a technical reason, not an aesthetic one: a dot grid is
a wave medium.** An earthquake ripple is not drawn on top of the dots — the dots
*are* the ripple, lifting and brightening in a ring spreading from the epicentre.
That is one function evaluated per dot per frame on the GPU, so **ten
simultaneous ripples cost what one costs.** Drought is the same mechanism
inverted: dots dim, thin and drift.

One instanced point cloud, one draw call, near-zero transparent overdraw. This is
the cheapest world in the app and probably the best-looking, which is why it is
likely built before Surface (§44).

**A floating layer sits on the cage plane, `DIVE.cageRadius`.** That is the
height at which a layer reads as standing off the glass rather than painted onto
it, and it is imported rather than copied so the two can never drift apart. A
tenth of that distance reads as paint.

**Dot density scales with screen coverage, and this is not optional.** The
reference form is a fixed-size hero graphic that never zooms. This globe hands
off to MapLibre on descent. **Dots smaller than one device pixel shimmer and
crawl, and there is no fixing it after the fact** — density is derived from the
planet's measured pixel radius, the same quantity `globe3d.js` already computes
for the dive handoff.

### 43.2 The plate boundaries are the seams

`assets/hazards/plate-boundaries.geojson` — 241 PB2002 lines, already shipped,
55 KB gzipped — renders as a glowing magma seam network.

**This is what makes the world explain itself.** Earthquakes cluster on plate
edges; showing the cracks and firing the ripples off them turns a field of dots
into a diagram of why.

**MAGMA IS THREE PASSES, AND THE THIRD ONE IS THE WHOLE EFFECT.** Hot things do
not glow evenly: a near-white core inside a bright orange body inside a wide dim
red spread. `plate-glow` / `plate-core` / `plate-hot`, drawn widest-and-dimmest
first, with only the core left unblurred — a hard bright line inside a soft one
is what reads as heat.

**==> AND THE WIDTHS HAVE TO STEP, NOT MERELY DIFFER. <==** The first version had
three passes at effectively two widths, because the heat derived from
`coastWidthGlow` while the body derived from `coastWidthCore` and the two landed
within half a pixel of each other. Three layers at two widths is two layers, and
it was reported on glass as "one same-colour line". The ratios now live in one
place (`SIZE.plateStack`) at **1 : 4.4 : 10** — each pass has to be a MULTIPLE of
the one inside it, because a blur closes a small gap and leaves a single soft
edge. `tools/test-world-basemap.mjs` asserts each step at least doubles.

Measured across the finished line at z6.5, luminance along a cut through a seam:
**242 at the core, 84 in the body, 45 in the outer heat, 38 background.** That is
the three-step falloff, as a number rather than an impression.

**A POST-PROCESS BLOOM IS DISQUALIFIED, NOT DEFERRED.** Arm measure their own
mobile bloom at ~3 ms a frame at full resolution — about a fifth of the whole
budget — because a blur reads pixels from outside its tile and breaks the
tile-local behaviour phone GPUs depend on. Their published alternatives are
baking the glow into a texture and using camera-facing glow geometry, and a
widened blurred line layer IS the second one. The cheap way and the
vendor-recommended way are the same way here.

**NOTHING ANIMATES IN MAPLIBRE.** Animating a paint property means a
`setPaintProperty` per frame, and every one of those makes MapLibre redraw the
whole map. Deep shimmers its seams in the THREE shader instead — from space,
where the renderer is already drawing (§43.2.2). `tools/test-world-basemap.mjs`
asserts no plate paint property varies on anything but zoom.

**THEY ARE DRAWN TWICE, BECAUSE ONE RENDERER CANNOT COVER THE ZOOM RANGE.** The
Three globe's seams and MapLibre's three passes are the same geometry, from one
fetch and one construction: `map/plate-seams.js` owns the fetch and the status,
`lib/plate-lines.js` owns the geometry, and both renderers read its output. They
are pixel-locked by `map/globe-follow.js`, with the dive crossfade handing one to
the other — the arrangement the coastline has always used. The seams leave on
`DIVE.fade.land`, the band that ends exactly where `mapIn` brings MapLibre to
full.

**ONE FETCH AND ONE CONSTRUCTION IS A CORRECTNESS PROPERTY, NOT A SAVING.** Each
renderer used to read the file and build its own line geometry. Two readers of
one file is fine; two independent constructions of one shape is not, because
these two copies are pixel-locked and nothing on screen would tell you when they
drifted apart. MapLibre's sources are therefore declared EMPTY in the style and
filled on `style.load` — `setStyle` carries declarations, never data.

### 43.2.1 The seams are chained, straightened, then curved — in that order

Three passes, and the middle one is the one that matters.

**CHAIN.** PB2002 publishes one boundary as several abutting features — the
Mid-Atlantic Ridge's Africa–South America seam is three of them. Splining them
separately leaves a corner at each joint and labelling them separately puts three
copies of AFRICA down one ridge. 241 published features chain into 162 boundaries.

Chaining is safe because **reversing a line swaps its sides**: PlateA is to the
left of travel, so a reversed line with its pair also swapped is the same
geography. Every fragment is normalised to a canonical pair order, reversing and
relabelling as needed, and then fragments that abut simply concatenate.

**==> SIMPLIFY, AND THIS IS THE PASS THAT DELIBERATELY BREAKS THE STORM-TRACK
RULE. <==** A spline through every published vertex was the first answer, on the
principle that a reported position is never moved. On glass the seams still read
as staircases, and the measurement says why: **PB2002 digitises mid-ocean ridges
on a grid, so the MEDIAN turn between consecutive published vertices on the
Mid-Atlantic Ridge is 83.8°, with 106 of 171 turns steeper than 70°.** The
corners ARE the data. Curve-fitting rounds each one and draws a rounded
staircase.

So Douglas-Peucker runs first (`lib/simplify.js simplifyPath`), at
`PLATE_LINE.simplifyToleranceDeg`. Near-right-angle turns across the whole file
fall from 930 to single figures and the median drawn turn is under 2°.

**THE DEVIATION IS TWICE THE TOLERANCE, NOT THE TOLERANCE.** Douglas-Peucker
promises every point within the tolerance of the chords it keeps; the spline then
bows away from those chords by about as much again. Measured end to end,
published vertex to nearest drawn seam, the worst case is **1.20° — roughly
133 km, exactly 2.0x**. `tools/test-plate-lines.mjs` asserts that ratio, so
raising the tolerance cannot quietly double a distance nobody restated.

**AND SOME OF THE REMOVED RIGHT ANGLES ARE REAL GEOLOGY.** A mid-ocean ridge
genuinely is a staircase — spreading segments offset by transform faults, meeting
near 90°. This is therefore not artefact removal: it is a decision to draw a
boundary's TREND rather than its segment-by-segment structure, taken on Aaron's
call 2026-07-30 because the staircase read as a rendering fault rather than as
tectonics. Defensible on the data (§5 applied to cartography: PB2002 is a
generalised interpretation of zones tens of kilometres across, so 133 km is
inside the shrug the source already carries) but the honest statement is that it
is a LOOK choice with a number attached.

**SPLINE.** `smoothPath` from `lib/trackline.js` — centripetal Catmull-Rom in a
latitude-corrected frame, unable to cusp or self-intersect. One smoothing
implementation, not two (§12). `PLATE_LINE.samplesPerLeg` is much higher than it
was, because simplification left long legs and five samples across one is
visibly faceted.

**The two passes together are CHEAPER than the single pass was**: 6,213 chained
vertices become about 14,500 rather than 28,000, and the line is smoother because
the vertices are spent where the curve actually bends.

### 43.2.2 Every seam is named on both sides, at one point

Each boundary carries the two plates it separates, and both names are drawn, one
to each side, bending along the seam. `config/plate-names.js` holds all 52 PB2002
codes spelled out, read off Bird's own publication page rather than recalled.

**PLATE A IS TO THE LEFT OF THE DIRECTION OF TRAVEL.** PB2002's own ordering
convention, measured rather than assumed against six boundaries whose geography
is not in dispute. The Iceland fixture is the load-bearing one: it is the same
Mid-Atlantic Ridge as the 50°N fixture with the pair written the other way round,
and the sides swap with it, which rules out "PlateA is the western one".
**Getting this backwards labels the Pacific plate over California** — a clean,
well-placed, curve-following label that is simply a lie. `tools/test-plate-lines.mjs`
asserts it as a set of compass facts rather than as field order, so canonicalising
the pair order in the chainer cannot break the test while the map stays correct.

**==> THE SIDE IS CARRIED BY THE GEOMETRY, NOT BY `text-offset`. <==** MapLibre
can push a line label perpendicular to its curve, pixel-constant, which is
exactly what you want — and it cannot be used. MapLibre flips a line label
end-for-end when it would otherwise read upside down, and the flip takes the
offset with it, so the two names swap sides. Measured in a browser against real
MapLibre 5.6.0. It cannot be normalised away by ordering the source vertices
either, because the flip is decided from the label's SCREEN direction, live, and
`dragRotate` lets the user turn the planet under it. So `plate-labels` holds
lines already displaced to one side, each carrying one name.

**==> THE PAIR IS PLACED AT ONE POINT, WITH `line-center`. <==** The first
version used `symbol-placement: 'line'`, which repeats a label every
`symbol-spacing` pixels and places each side independently. That gave five copies
of AFRICA down one ridge with no relationship between the two sides, so reading a
boundary meant hunting for its other name. `line-center` places exactly ONE label
per feature at that feature's centre, so the geometry hands over short WINDOWS of
the curve — one per side, both centred on the same anchor — and the two names land
opposite each other across the seam and read together. Density becomes a number
in the constants file (`anchorDeg`) instead of an emergent property of a pixel
spacing.

**A PAIR OR NOTHING.** Both windows are built and both are checked before either
is emitted; if one fails the anchor is skipped. A lone plate name does not read
as "the other one did not fit", it reads as a statement about the plate that got
named — and the failure is systematically ONE-SIDED, because only the inner copy
of a pair is bent by the displacement. Seen on glass: AFRICA on the Mid-Atlantic
Ridge with nothing opposite it.

**AN ANCHOR THAT FAILS IS NUDGED, NOT ABANDONED.** 29% of anchors failed the pair
test on the first try, which left whole boundaries unlabelled. Candidates are
tried outward from the ideal position (`ANCHOR_NUDGES`), which drops that to
about 21% while keeping the spacing even. Packing anchors closer would be the
wrong lever — spacing is the density dial and the point was getting density down.

**THE DISPLACEMENT IS CLAMPED BY LOCAL CURVATURE.** Offset a curve inward by more
than its own radius and the copy turns inside out. The worst case measured was the
**Galapagos plate, whose entire boundary is 5° long** — displacing it by the far
band's 1.1° produced a window with a 161° reversal in it. `curvatureSafety` caps
the displacement at a fraction of the local radius on the inner side only, and a
fold filter backs it up. Without this, the 90th-percentile turn inside a label
window was 68° when coarsely sampled and 169° at full resolution: **coarse
sampling was averaging the cusps away, so the bug looked like a sampling question
and was not.**

**THREE BANDS, ONE HANDOVER NUMBER EACH.** A geographic displacement is not
pixel-constant, so each band carries its own offset, window length and anchor
spacing, and they crossfade. Each band states a single `until` — the zoom it hands
over at. It was a `from`/`to` pair per band, which describes each boundary twice,
and the two copies promptly disagreed: at z3.75 the outgoing and incoming ramps
summed to 1.12 and every name was drawn one and a bit times over.

**EACH BAND IS CONFINED TO ITS OWN ZOOM WINDOW, AND THAT IS A COLLISION FIX.**
All three shared one `minzoom` at first, on the reasoning that the opacity ramps
decide what is visible. They do — and **MapLibre still PLACES a symbol whose
opacity is zero.** Measured at z4.4: nine invisible `near`-band labels were laid
out and, because `near` is the topmost layer and placement runs top-down, they
won every collision against the `mid` labels that were actually on screen.

**NO COLLISION PADDING.** The two names sit tens of pixels apart on purpose —
that closeness is what lets both be read at once — and MapLibre's default 2 px of
padding is enough at that separation to make the pair collide with itself and
drop one half.

**THE TIER LADDER IS WHAT MAKES IT LEGIBLE.** All 52 plates labelling at once is
52 labels the collision pass throws away, with the survivors decided by placement
order. Total boundary length per plate is the rank — Pacific 665°, Eurasia 600°,
down to Manus at 4° — and the thresholds are read off a step in that measured
data: seven plates in tier 1, then a gap. A boundary takes the BETTER of its two
plates' tiers.

**PLATE NAMES YIELD TO EVERY BASEMAP LABEL**, at every zoom, by being last in the
layer list. A country name tells you where you are looking and a plate name tells
you what you are looking at.

**ONE REPETITION REMAINS, AND IT IS THE DESIGN RATHER THAN A BUG.** Every visible
seam names both of its own sides, and a plate shorter than one anchor spacing
still gets one anchor — so a small plate with four boundaries in view is named
four times. Nazca at the planet band is the worked example. Removing that would
mean labelling a plate's AREA rather than its seams, which is a different feature.

**NAMELESS FROM SPACE, DELIBERATELY.** MapLibre is fully transparent below
`DIVE.zSpace`, and the Three globe has no text engine, so plate names arrive with
the map at about z2.5. Aaron's call, 2026-07-30: that is the wanted behaviour,
not a gap to close.

**Told apart from the coastline by three channels, not one.** Deep paints them
magma against that world's orchid coastline, which is a wide hue separation — but
warm-against-magenta is still a hard pair for red-green colour blindness, so
width (`SIZE.plateWidthScale`) and opacity (`OPACITY.plate*`) have to carry it
too, and they do.

**AND THE MAGMA STACK IS THE ONE THING ON THIS GLOBE THAT COULD COLLIDE WITH A
FIXED HAZARD RAMP** (§6, and see the severity rule at the head of §43). USGS MMI
runs `#ffaa00` to `#fd0000`. The three passes are placed against that ramp by
MEASUREMENT, not by comparing swatches:

- The outer heat's `#D92600` looks like an MMI red and is not one: at 24% over
  this world's `#10091E` ocean it composites to luminance 0.0152, against 0.2088
  for MMI's darkest red. Fourteen times darker. **Re-measure if the ocean colour
  or `OPACITY.plateGlow` moves** — the argument is about the composite.
- The body's `#FF7A1A` genuinely sits inside the MMI range at luminance 0.3525,
  and it stays. This collision is not resolved by hex-picking; it is resolved by
  the rule that quake severity here is size and ripple strength, never hue.
- The hot core is a near-WHITE at luminance 0.8872 — 1.8x brighter than anything
  MMI has, so it is off the END of that ramp rather than on top of it. A seam is
  hotter than any earthquake colour, which is also true of rock.

**THEY ARE A WIDE SOFT BAND, NOT A LINE, AND THAT IS A CLAIM ABOUT THE DATA.**
The stack first shipped NARROWER than the coastline, on the reasoning that the
plate network is the layer beneath it. On glass that read as a second coastline
in another colour — the same kind of mark competing with the original. At four
times the coast's width and half the opacity it stops competing, because a
diffuse band and a crisp edge are different kinds of thing. It is also the
truthful mark: PB2002 lines are a generalised interpretation of deformation
zones tens of kilometres across, so a hairline claims a precision the data does
not have (§5, applied to cartography). The two knobs move together — opacity is
per-pixel and width decides how many pixels there are, so widening without
dimming makes a reference layer the loudest thing on the globe.

The widening costs about 2% of frame time in the sandbox, which is a soft number
on a software renderer but is nowhere near §40.1's overdraw ceiling. The core is
floored at `SIZE.hairlineFloor`: nothing is near it now, but the scale is a knob
someone retunes on glass, and at 0.7 that stop came out at 0.63px — perfectly
drawn and invisible, which is how the old graticule died.

### 43.2.3 The 3D seams spend the same three colours differently

**THE 3D SEAMS ARE 1px AND CANNOT BE WIDENED.** WebGL renders `LineSegments` at
one pixel whatever the material asks for, so from space the plate network is a
hairline mesh and on the map it is a three-pass band. The coastline has the same
split (1px in Three, a 3.5px glow in MapLibre) and reads fine; the plate gap is
larger, and the three-pass stack widened it further.

**SO THE THIRD COLOUR ARRIVES AS A SHIMMER INSTEAD OF A THIRD LINE.** A hairline
cannot be stacked, so up here the near-white `hot` is what a shimmer crest
reaches. Two sines at incommensurate frequencies travelling opposite ways along a
per-vertex arc-length attribute. Both renderers spend the same three colours; one
stacks them and one moves through them.

**CREST SHARPNESS IS COUNTER-INTUITIVE AND IS THE DIAL TO KNOW.** The exponent
applies to a 0..1 wave, so RAISING it squeezes the bright part into a shorter
fraction of the seam. At 3 the crests were brief flecks — correct for "mostly
cooling crust", and reported on glass as too subtle to see. At `shimmerSharpness`
1.8 the bright part is a travelling band rather than a spark, while the troughs
still spend most of their length at the base colour. Measured headless over one
second with the camera pinned: about 0.5% of the canvas changes, mean delta 27,
peak 168 of 255.

**THE SHIMMER IS OFF ENTIRELY UNDER REDUCE-MOTION**, not dampened. A
continuously travelling light is close to the centre of what that preference asks
to be spared, and the seams say exactly the same thing standing still. Half a
shimmer is still a shimmer.

**IT IS ALSO THE FIRST EFFECT IN THIS APP THAT IS TRUE AT REST**, which is a
structural change and not a look. Ripples are transient and ask for frames while
they live; smoke, dust and moving water will all be continuous like the shimmer.
`proto/shell.js` therefore runs its OWN animation loop when MapLibre has gone
quiet, rather than calling `map.triggerRepaint()` — a repaint redraws the entire
map, every frame, including at the space floor where it is at CSS opacity 0 and
nobody can see it (the research doc's Part 1.3). Verified headless: zero MapLibre
renders in a one-second window while the Three canvas keeps changing.

**AND THAT MEASUREMENT FOUND SOMETHING ABOUT THE APP, NOT THE SHIMMER.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe ALREADY drives MapLibre continuously and already pays that full-map
repaint — and always has. The self-loop covers only the cases the drift does not
(rotation switched off, tab returning from hidden) and is the seam the next four
continuous effects need. **Measuring what a space-floor MapLibre frame costs now
matters more than the research doc thought, not less.**

If the crossfade ever pops, the fix is still on the Three side — ribbon geometry
with the falloff baked in, which is the vendor-recommended shape and would let
the 3D seams carry a real width. Not a narrower band on the map.

### 43.3 Ocean quakes ripple across water and land at the coast

Most large earthquakes are subduction-zone events at sea. **The field covers the
water at the same spacing as the land (§43.1), so the wave simply travels** — one
medium, one wave height, no handoff at the coastline and nothing to get wrong
where the two would have met.

**THE EARLIER ANSWER WAS A SURFACE RIPPLE ON THE GLASS, PICKED UP BY A LAND-ONLY
DOT FIELD AT THE COAST**, on the reasoning that it was cheaper than extending
dots over ocean. It is not the shape of the problem: a medium that stops at the
coast is a wave with a bug, and coastal arrival being the part that matters to
anyone is an argument for drawing the ocean crossing, not for skipping it.

### 43.4 Ripples are seismic, and there are two traps in that

S-waves travel at roughly 3.5 km/s, so a ripple expanding at **true seismic speed
from the true origin time** is available. Take it; a ripple at an invented speed
is decoration wearing a data costume.

- **Depth kills amplitude.** A 600 km-deep M6 barely shakes the surface, and the
  feed's depths run to 676 km. Amplitude falls off with depth or the app draws
  drama that did not happen — a SPEC.md §5 failure in visual form.
- **Age fade is structural, not cosmetic.** A ripple 20 hours old is 250,000 km
  across. The fade is what keeps the effect finite.

Volume is not a problem: 2,049 events in 30 days at M2.5+, 12 of them M6+. The
whole month fits.

### 42.1 Volcanoes — the render contract

> **Numbered 42.1, filed under Deep.** Section numbers are permanent
> addresses (the rules at the top of this file), so a section that moves
> between worlds keeps its number rather than breaking every pointer at it.

**A VOLCANO IS THE PLANET'S OWN SKIN PUSHED UP, NOT A MARKER STUCK ON IT.**
Real lathed geometry lifting out of the shell, catching the same fixed light
sweep as the land sheet and the seams. A pin would read as furniture; a bump
reads as terrain.

> ==> **"SAME COLOUR AND MATERIAL AS THE LAND SHEET" WAS THE ORIGINAL WORDING
> AND IT LOST ON GLASS. DO NOT PUT IT BACK.** <== Phase E shipped a mark in a
> near-white off the sheet's own palette and it was reported on a phone as
> simply "white" — against a 90,000-dot field at `#ECE4F8` a desaturated tint
> is not a second colour, it is the same colour. Volcanoes take the same LIGHT
> as the sheet and a deliberately different HUE from it: cool cyan quiet,
> saturated gold live. The measurement and the numbers are in `VOLCANO.marks`.

**COST IS NOT THE CONSTRAINT AND MUST NOT BE USED AS AN ARGUMENT HERE.** All 1,196
edifices are one `InstancedMesh` and **one draw call**, with the family profile as
a per-instance vertex attribute so six shapes come out of one geometry. What limits
the layer is VISUAL NOISE. Every count decision below is a legibility decision.

**VOLCANOES GO IN THEIR OWN FILES, AND THERE ARE TWO OF THEM.**
`proto/world-deep.js` is past 1,000 lines and therefore past §12's trigger.
`proto/volcano-field.js` owns the data — which volcanoes, where, and how loudly
each reads — and knows nothing about globes or THREE, the same split
`proto/ripple-field.js` makes. `proto/volcano-marks.js` draws them. The split is
not tidiness: Phase F replaces the drawing entirely and the data file does not
move.

> **AS-BUILT: TWO LAYERS, AND WHICH ONE YOU SEE DEPENDS ON HOW FAR DOWN YOU
> ARE.** Phase F is landed. The layer is:
>
> - **Flat pips at the space floor, real edifices during the dive.** A `Points`
>   cloud and an `InstancedMesh`, cross-faded across `VOLCANO.shapes.shapeIn`
>   (dive phase 0.00 → 0.18, about z2.0 → z2.54). This IS §42.1.3's "shape grows
>   in with zoom" and it is not a compromise: at 1 px ≈ 30 km even a wildly
>   exaggerated mountain is a couple of pixels out here, and 135 silhouettes at
>   the size they need would fuse across Java, Japan and Kamchatka.
> - **The pips are fixed screen size, not perspective-scaled**, which is the one
>   place they deliberately differ from the dot field they sit in. A symbol that
>   shrinks with distance is sub-pixel at the space floor.
> - **The edifices are five families out of one lathe** — cone, dome, shield,
>   caldera, fissure — bent per instance in the vertex shader from four numbers.
>   One geometry, one draw call, ~34,000 triangles for the whole layer.
>   `lib/volcano-shape.js` decides which family a volcano is, and
>   `tools/test-volcano-shape.mjs` asserts all 1,196 land somewhere deliberate.
> - **Three separating channels, and each one answers exactly one question.**
>   SIZE is modelled footprint — how big is the mountain. COLOUR is state — cool
>   cyan quiet at 72%, saturated gold live at full strength and a fixed size,
>   because live outranks history. **GLOW is severity**: a halo outside the mark
>   whose reach and brightness both ramp on `severityScore`, with erupting
>   pinned at maximum rather than ranked. Numbers in `VOLCANO.marks`; both rungs
>   read one `sev` so a volcano cannot glow harder as a pip than as a circle in
>   the band where both draw.
>
>   > ==> **SEVERITY HAS BEEN IN ALL THREE CHANNELS AND THE TWO IT LEFT ARE
>   > FENCED.** <== It rode RADIUS until 2026-07-30 — a proxy invented because a
>   > dot had nothing better to say, given up when footprint turned out to be
>   > true information about the thing under the mark. It then rode LIGHTNESS
>   > inside the quiet cyan for one deploy and **failed on glass**: one hue from
>   > lightness 0.45 to 0.73 on a 3.5–7 px dot already at 0.72 opacity is not a
>   > channel a phone can resolve. The written fallback was a stroke ring and it
>   > **could not be taken** — a hollow ring already means SUBMARINE on both
>   > rungs, and two facts in one shape is how a legend stops being readable. A
>   > glow was Aaron's call 2026-07-31, and it works because it adds ink OUTSIDE
>   > the mark rather than redistributing ink inside it. **It must never read as
>   > a bigger dot**: the halo is confined to outside the mark's own coverage on
>   > both rungs, and the MapLibre rung uses a second blurred circle UNDERNEATH
>   > rather than `circle-blur` on the mark, which would have made the volcanoes
>   > that matter most the hardest ones to locate. `tools/test-volcano-paint.mjs`
>   > asserts all three channels apart, not just the current one — a rule that
>   > only says what severity IS cannot catch it moving back into size.
> - **One set never gets an edifice (§42.1.4)** and keeps its pip at full
>   strength all the way down: volcanic fields and clusters, where a single cone
>   would be a fabrication. Submarine volcanoes were the second such set until
>   2026-07-30 and are not any more — see §42.1.4c. They still draw as Phase E's
>   hollow ring on the GLOBE, where the sea is not modelled at all; the mountain
>   and the water over it are a map-zoom feature.
> - **Nothing is tappable**, so §DESIGN's 44 px floor is not yet in play. It
>   arrives with picking, and the hit area will need to be far larger than the
>   ink.
> - **Nothing animates.** An erupting volcano reading as inert is still the open
>   glass question, and the answer scoped for it is the Phase H plume rather
>   than a pulse — a pulse is a standing frame cost on a world that otherwise
>   rests, and it is a placeholder for something already on the list.
>
> ==> **WHAT REAL GEOMETRY DOES NOT BUY, BECAUSE IT IS A SPHERE.** <== Only a
> ring near the limb shows a profile at all; the middle of the disc is looking
> straight down a volcano's throat. So this buys a planet whose EDGE goes lumpy
> as you descend, not a legend anyone can read shapes off. **Aaron's call
> 2026-07-30, made knowing that** — this world's argument is that it is a planet
> rather than a diagram, and telling the six types apart is picking's job. The
> fallback if it ever needs walking back is leaning the geometry toward the
> camera, which is one number, not a rebuild.

#### 42.1.1 Selection is a ladder, not a cut

**1,196 dots is noise and 364 of them have no recorded eruption ever.** Measured
tiers, all live 2026-07-30:

| Rule | In the shipped file | In GVP's eruption record |
|---|---|---|
| erupted since 1900 | 422 | 435 |
| **≥10 confirmed eruptions since 1900** | **128** | **129** |
| max VEI ≥ 5 | 126 | 128 |
| erupted since 2020 | 116 | — |
| erupting right now | **26** | — |
| submarine (`elev < 0`) | 110 | — |
| no eruption record at all | 321 | — |

**THE TWO COLUMNS DIFFER BY THE 19 UNPLACEABLE VOLCANOES IN §42.1.7, AND THE
SHIPPED COLUMN IS THE ONE THE CODE CAN DELIVER.** The single missing member of the
space tier is Akan, with 19 eruptions since 1900.

> ==> **THE ERUPTING SET IS A UNION, NEVER A FILTER, AND THIS IS NOT A
> PREFERENCE.** <== **Re-measured on the DEPLOYED app 2026-07-30, off the shipped
> layer's own readout rather than off a parse: 135 volcanoes drawn, 26 erupting,
> 109 quiet. The tier is 128, so 19 tier members are erupting and SEVEN ERUPTING
> VOLCANOES SIT OUTSIDE IT.** Drawing `tier ∩ erupting` hides those seven, which
> is SPEC.md §5's exact failure mode: the app reporting calm about places it has
> live evidence are not.
>
> The first measurement, off the weekly report alone, was 6 of 22 — Ambae,
> Dukono, Great Sitkin, Ibu, Lewotolok, Sabancaya. **The count moved because the
> live figure is three feeds unioned rather than one parsed, and the RATIO did
> not: roughly a quarter of what is erupting on any given day falls outside the
> activity tier. That stability is the argument, not either number.**
>
> **What is erupting now is drawn regardless of history.** The activity tier
> selects the QUIET context around it, nothing more. A volcano with two eruptions
> since 1900 that is erupting this week outranks Etna sitting idle.

**LIVE STATE OUTRANKS HISTORY EVERYWHERE THE TWO DISAGREE.** History decides what
is drawn when nothing is happening; it never suppresses something that is.

**THE SPACE TIER IS ~130 AND IT IS AN ACTIVITY RATE, NOT A RECENCY FLAG.**
"Erupted since 1800" is the 508 figure everyone half-remembers and it is a yes/no
flag — Etna, with 147 eruptions, and a Chilean cone that popped once in 1847 score
identically on it. Eruption COUNT is the honest activity channel and it is
complete for all 915 volcanoes with any record.

Deeper zooms add tiers. Nothing is permanently hidden; the globe is simply never
crowded at the distance where crowding is fatal.

#### 42.1.2 Six shape families, and the ratios are deliberately not real

**THE CATALOG HAS NO FOOTPRINT DATA AT ALL** — no basal diameter, no prominence.
`elev` is height above SEA, not above the volcano's own base, which is why Ojos
del Salado reads 6,879 m: it stands on a 4,000 m plateau.

**AND A TRUE-SCALE VOLCANO IS SUB-PIXEL ON THIS GLOBE.** At ~429 px across on a
phone, **1 px ≈ 30 km**. A stratovolcano is 10–15 km at the base and 2–3 km tall:
**half a pixel wide, one twentieth of a pixel tall.** The 3D globe lives only from
`DIVE.zSpace` 2.0 to `zHandoff` 5.0 and the land fade completes by p 0.30 (≈z2.9),
so **there is no zoom band in which a true footprint becomes legible.**

> **BAKING DEM FOOTPRINTS IS REJECTED, AND THIS IS THE RECORD SO IT IS NOT
> RE-PROPOSED.** Hundreds of KB to render a difference nobody can see. The
> accurate thing and the visible thing are not the same thing here.

Six families off the existing `type` field, with ratios **spread apart from
reality** so they separate at small size: steep cone ≈1:1.2, lava dome ≈1:1.6,
shield ≈1:4, plus caldera (notched summit), fissure vent (elongated ridge aligned
to the rift) and volcanic field (a scatter of pips). Real ratios are 1:5 and 1:20
and **both read as a dot at 3 px.**

**RANK ORDER IS TRUE AND ABSOLUTE PROPORTION IS NOT.** A shield is always flatter
than a cone. No shape on this globe is the real shape of a real mountain, and the
constants file says so where the numbers live.

**AS-BUILT: FIVE FAMILIES ARE GEOMETRY AND THE SIXTH IS NOT.** `volcanic field`
is drawn flat rather than as a low mound — §42.1.4's rule that a single edifice
for scattered vents is a fabrication, applied literally. Counted across the
shipped catalog: **cone 740 · field 172 · shield 113 · caldera 91 · fissure 57 ·
dome 23**. In the 128-strong quiet tier it is **cone 100 · caldera 13 · shield
12 · field 2 · dome 1 — and no fissures at all**, so four of the five
silhouettes cannot be judged against real data without the right volcano
erupting. That is what the `All shapes` debug switch on `/proto-worlds.html`
exists for, and it is a lie about the data that is never on by default.

**AND `landform: Cluster` DEMOTES A SINGLE-EDIFICE FAMILY TO `field`.** 227
entries carry it; most already type as a field or a fissure, and it catches the
~32 that type as one mountain and are not one — five `Stratovolcano` among them.
`fissure` is exempt because a line of vents is already a multi-vent form with
its own silhouette.

#### 42.1.3 Exaggeration is a curve, never a multiplier

**A SINGLE MULTIPLIER CANNOT SATISFY BOTH ENDS.** At 10x the tallest volcano
reaches `DIVE.baseLump` (0.012 radii ≈ 76 km — the globe's existing fake relief,
and therefore the established "reads as relief here" scale) while the median
1,637 m volcano sits at 0.55 px and is invisible.

So volcanoes reuse the shape the cage already uses for storm wind —
`DIVE.sevFloorKt` / `sevPeakKt` / `sevMinLift` / `sevCurve`. A floor so the median
is visible, a ceiling so the 6,879 m outlier is not a needle, a curve between.

**SHAPE GROWS IN WITH ZOOM RATHER THAN HOLDING FLAT.** 130 legible silhouettes
need ~8–12 px each, and at that size they collide in Java, Japan and Kamchatka.
Holding shape flat from space and resolving it during the dive costs one number
and converts the collision into a reveal: a ridge of merged peaks that separates
into individual mountains as you descend.

#### 42.1.4 What is not a mountain, and what only looked like it

**365 ARE NOT A SINGLE EDIFICE, AND THIS HALF HAS NOT MOVED.** 138 are typed
`Volcanic field` and 227 carry `landform: Cluster` — "West Eifel Volcanic
Field", "Crater rows", "Fissure vent(s)" — scattered vents spread over tens of
km. A single cone for them is a fabrication, and no rendering technique changes
that, because the problem is the claim rather than the picture. Broad low mound
or a flat mark, at full strength, at every zoom.

**110 ARE BELOW SEA LEVEL** (`elev < 0`, to −5,700 m) **AND THEY GET REAL
GEOMETRY NOW.** A cone sticking out of the Pacific for a seamount 1,800 m down
is still false — but the conclusion this section used to draw from that, that a
seamount can never be a mountain, was only true while there was no way to draw
the sea. **Aaron rejected the flat contour-ring proposal outright on 2026-07-30
and asked for actual geometry with water over the top of it.** §42.1.4c is how.
The rule that survives intact is the last clause: **never an ash column above
the water.**

**AT GLOBE ZOOM THEY ARE STILL FLAT, AND THAT IS A SCOPE LINE RATHER THAN AN
OVERSIGHT.** `proto/volcano-marks.js` draws no sea and models no bathymetry, and
a sub-pixel silhouette under an unmodelled ocean would be a mountain drawn on
top of the water rather than under it. The hollow ring stays there.

#### 42.1.4a What `fill-extrusion` ruled out, and why it stays ruled out

**THE THREE RENDERER IS CLEARED AT DIVE PHASE 1 AND THE VOLCANO LAYER LEAVES
EARLIER STILL**, with the dots, around z3.8. So the 3D globe cannot show a
volcano at any map zoom — and volcanoes that vanish exactly as you get close
enough to see them is backwards.

**WHAT SHIPPED IS A FLAT CIRCLE, FROM z2.4 UPWARD**, fading in under the Three
pips so the handover has no switch in it. Same two colours, same fixed size for
erupting, submarine still hollow. It solves the disappearing and nothing else.

> ==> **`fill-extrusion` WAS BUILT FOR THE 3D VERSION AND REJECTED ON GLASS
> 2026-07-30. DO NOT RE-PROPOSE IT WITHOUT ANSWERING BOTH OF THESE.** <==
>
> **1. PITCH IS DISABLED APP-WIDE AND AN EXTRUSION AT PITCH 0 IS A FLAT
> POLYGON.** `map/globe.js` sets `touchPitch: false` and
> `pitchWithRotate: false` — "a tilted sphere is disorienting and buys nothing
> for storm data." Perspective still splays tall geometry outward from screen
> centre, but that effect is ZERO at the centre, which is exactly where a
> volcano you flew to lands. On a phone it read as flat coloured discs.
>
> **2. AND THE FOOTPRINT PROBLEM IS INDEPENDENT OF PITCH, WHICH IS THE HALF
> WORTH KEEPING.** `fill-extrusion-height` takes a zoom expression; the polygon
> under it does not. So a volcano's width is fixed on the ground while the
> screen zooms past it, and there is no size that works twice: big enough to
> read at z6 means Masaya's caldera spanning Managua to Granada at z10, which
> is what it did. **A geographic footprint cannot be a screen-constant icon,
> and no amount of tuning changes that** — it is a property of the technique.
>
> **THE TERRACING ALSO DID NOT READ AS A CONTOUR MODEL**, which was the
> argument for accepting stacked rings over smooth geometry. Flat-on it is
> concentric discs.
>
> **What survives the rejection:** one profile shared by both renderers
> (`volcanoProfile()` in `lib/volcano-shape.js`), the family ratios, the
> exaggeration curve, and the measurement that a cone wants roughly 8–12 px to
> read. **What is gone:** `lib/volcano-extrusion.js` and its test, deleted
> rather than archived.

**BOTH REJECTIONS WERE ANSWERED IN §42.1.4b AND NEITHER WAS ANSWERED BY
TUNING.** Reason 1 was never a property of the technique — it was a missing
feature, and `map/pitch-ramp.js` is that feature. Reason 2 was answered by
giving up the thing that caused it: the footprint is TRUE now rather than sized
to hit a pixel target, and a true footprint cannot blow up at high zoom because
nothing is stretching it. **`fill-extrusion` itself stays rejected regardless**,
for a third reason that no amount of pitch or scale fixes: it cannot draw a
sloped side. A circle extruded is a cylinder, and stacking rings to fake a
slope is the terracing above.

#### 42.1.4b Real mountains at map zoom — the footprint is true, the height is not

**A MAPLIBRE CUSTOM LAYER DRAWING THREE INTO THE MAP'S OWN GL CONTEXT.**
`proto/volcano-3d.js`. **Volcanoes whose TRUE footprints intersect are gathered
into a cluster and sampled as ONE continuous heightfield**, because a 3.5 km
cone models 31 km across and arc volcanoes sit 15–25 km apart, so they really
do overlap — a cordillera is one ridge with peaks on it, not a row of separate
cones. Drawn as separate closed shapes they read as stamped coins with a hard
rim each. The merge uses a SMOOTH maximum, never a sum: where two mountains
differ in height by more than `ridge.saddle` it returns the exact larger value,
so a summit is never inflated by a neighbour, and where they are close it lifts
the join into a col instead of leaving the crease a plain max leaves.

**`volcanoProfile()` IS STILL THE ONLY SILHOUETTE.** A lathe asks "at this
fraction up the profile, what radius and height"; a heightfield asks the
inverse. `lib/volcano-ridge.js` INVERTS the same function into a
radius-to-height table per family — one silhouette read two ways, never two
silhouettes. That file has no THREE in it and is asserted against the real
catalog by `tools/test-volcano-ridge.mjs`; the metres live in
`lib/volcano-dimensions.js`.

**THE HARD RIM IS WHAT MADE THEM READ AS STICKERS, AND IT IS GONE IN TWO
PLACES.** Opacity ramps in over the bottom `ridge.softBase` of each point's own
local mountain height, so the surface emerges from the basemap rather than
being cut out of it — baked as per-vertex alpha, which r128 honours only when
the colour attribute has FOUR components. And the mesh is TRIMMED at the
footprint edge: quads with no height at any corner are not emitted at all, so
there is no large transparent sheet lying over the map.

**DEPTH IS ON AND TESTS ONLY AGAINST US.** It was off on the grounds that "at
these zooms they almost never overlap", which the arcs disprove outright.
Testing against MapLibre's buffer would still be meaningless — its 2D layers
write a thin per-layer slice, not geometric depth — so `render()` CLEARS depth
first and the buffer then holds nothing but our own mountains. **r128's
`clearDepth()` is a bare `gl.clear` and does NOT set the depth mask, and
clearing depth is a silent no-op while that mask is false**, so the mask is set
explicitly first. A heightfield is single-valued and cannot overlap itself; the
only thing depth resolves here is one ridge in front of another.

**THE LADDER IS THREE RUNGS NOW AND EACH ONE HANDS OFF RATHER THAN STOPPING.**

| What draws | Zoom | File |
|---|---|---|
| Three pips, then lathed silhouettes | z2.0 → z3.8 | `proto/volcano-marks.js` |
| MapLibre circle | z2.4 → z7.8 | `proto/volcano-map.js` |
| Real geometry, and the sea over it | z7.0 → up | `proto/volcano-3d.js` |

> ==> **EVERY AXIS OF THIS LAYER IS IN MERCATOR UNITS, HEIGHT INCLUDED, AND
> BELIEVING OTHERWISE COST FOUR DEPLOYS.** <== The matrix MapLibre hands a
> custom layer is `viewProjMatrix · scale(worldSize, worldSize, worldSize /
> pixelsPerMeter)`, and `viewProjMatrix` already ends in `scale(1, 1,
> pixelsPerMeter)`. The two Z terms cancel: what is left is MapLibre's own
> `_mercatorMatrix`, `scale(worldSize, worldSize, worldSize)`. Multiplied out
> of the vendored 5.6 bundle. **Passing height in raw metres put a 3.5 km cone
> at 43,750 — forty-three thousand planet widths — so every mountain shot past
> the far clip plane and rendered as horizontal streaks, while the layer's own
> `V3D` readout reported `126 @0.22`: drawing, correctly counted, and entirely
> wrong.** The conversion is `meterInMercatorCoordinateUnits()` on all three
> axes, which is also what MapLibre's published three.js example does. The
> maths lives in `lib/volcano-dimensions.js` (`edificeScale`) rather than the
> renderer precisely so it can be asserted without a browser, and the assertion
> that catches it is dimensionless: **`tall / wide` is fixed by family and must
> never depend on latitude or zoom.**

> ==> **THE MOUNTAINS START AT `TILT.flatten`'s FAR END, NOT AT
> `DIVE.zHandoff`.** <== While MapLibre is anywhere in its globe→mercator
> blend, `defaultProjectionData.mainMatrix` is the GLOBE matrix and expects
> positions on a unit sphere, and the basemap under a mountain is on a curve
> the mountain is not. The layer reads **`fallbackMatrix`**, which is the plain
> mercator matrix on both transforms, and `map3d.handoff` starts at z7.0 so it
> never draws inside the blend at all — the blend is finished by z5.4 —
> the two are asserted equal, because they came apart once when the handoff
> moved.

> ==> **THE CIRCLE FADES OUT UNDER THE MOUNTAINS, AND THAT IS AARON'S CALL
> 2026-07-30.** <== A dot and a mountain for the same volcano at the same time
> is two marks for one thing. **Except for volcanic fields, which keep their
> circle at full strength forever** — a field has no mountain to become, and
> fading its mark out would delete it from the map, which is SPEC.md §5. The
> fade-out is conditional on being an edifice and both halves read the same
> constant. **Submarine volcanoes were in that exemption until 2026-07-30 and
> hand off like anything else now** (§42.1.4c); they keep the hollow ring while
> the circle is up, because a ring is still the honest mark for something under
> the sea.

> ==> **A MOUNTAIN WEARS ITS DOT'S COLOUR, AND UNTIL 2026-07-30 IT DID NOT.**
> <== The mountains were `#FFFFFF` — "Aaron asked for white and translucent" —
> while the dot handing over to them was cyan `#8FD7E6`, so one volcano changed
> colour halfway down the ladder. §42.1's rule that a volcano must not change
> colour because it changed renderer was written about the gold and was quietly
> broken by the quiet tier the whole time. The gold was broken more finely:
> `#FFB020` against `#FFC53D`, two hexes for one thing that nobody would catch
> in a review and everybody would see on a phone. **Both hexes are now declared
> once, above `VOLCANO`, and read by both renderers**, because an object literal
> cannot refer to itself and that is the only reason they were ever duplicated.
> A mountain takes the FULL-STRENGTH quiet colour and never the severity ramp:
> a heightfield is already shaded per vertex by its own normal, and a second
> lightness signal on top of that reads as terrain rather than as hazard.

**HORIZONTAL IS TRUE AND VERTICAL IS EXAGGERATED, AND THE ASYMMETRY IS THE
DESIGN.** A true footprint is correct at every zoom by definition, which is
exactly what `fill-extrusion` could not have. Measured off the shipped catalog:
Fujisan 31.5 km across (real ~30), Etna 30.2 (real ~35), Mauna Loa 100.1 (real
~120), Vesuvius 11.5 (real ~10–15), **and Masaya 9.5 km — the volcano that
spanned Managua to Granada at 45 km in the rejected version.**

> ==> **A CONE ONLY CLEARS THE ELLIPSE ITS OWN BASE DRAWS WHEN
> `height / baseRadius > 1 / tan(tilt)`, AND MISSING THAT MADE IT A PANCAKE AT
> EVERY ZOOM FOREVER.** <== Seen from a camera tilted `t` off vertical, a
> circular base projects to an ellipse of on-screen half-height
> `baseRadius · cos t`, while the summit rises `height · sin t`. Below that
> line the silhouette never breaks the disc and no amount of shading rescues
> it. `height / baseRadius` is `vertical / family.ratio`. The first version
> ran 2.5 / 4.5 = **0.556 against a bar of 0.700 at 55°** — it was arithmetic,
> not taste, and it was reported on glass as "pancakes with a pimple on top".
> Both halves moved: `TILT.maxDeg` 55 → **60** drops the bar to 0.577 and
> `map3d.vertical` 2.5 → **4.0** lifts a cone to 0.889. **The test asserts the
> INEQUALITY, never either number**, because glass tuning is expected to move
> both and what must survive is the relationship. `maxDeg` now sits exactly on
> MapLibre's own default ceiling, so there is no headroom left there — the next
> move is `vertical`. **A shield stays below the bar at 0.333 and that is
> CORRECT**; a shield is a swell. The domes are the ones to watch at 2.0.

> ==> **`inflate` WAS DELETED 2026-07-30 AND NOTHING MAY PUT A HORIZONTAL
> SCALE FACTOR BACK.** <== It was a uniform 5x zoom-driven multiplier decaying
> to true scale by z9.5, whose job was making a distant volcano big enough to
> see at the moment it appeared. Three things killed it. **Hawaii proved the
> look:** Mauna Loa's true footprint is ~100 km across and the Big Island is
> ~130, so drawn true the mountain very nearly IS the island — at 5x it was a
> grey oval several times the island's width with Hawaii floating inside it.
> **It was causal, not merely ugly:** clustering asks whether TRUE footprints
> intersect while the screen drew them five times wider, so the pairs that
> visibly collided were exactly the pairs the merge decided were not
> neighbours, and two solid cones inside each other give a depth-buffer seam
> that MOVES WITH THE CAMERA — reported on glass as different parts being
> clipped from different angles. **And it is the mistake that killed
> `fill-extrusion`** (§42.1.4a): a footprint sized to hit a pixel target. A
> decaying lie is still a lie while it decays.
>
> The honest replacement is the handoff: do not draw a mountain until true
> scale is big enough to read, and let the dots carry the band below that,
> which is what the dots are for. Measured across the drawn set at true scale a
> median volcano is 12 px across at z5.4, 21 px at z6.2 and **36 px at z7.0**,
> so the handoff moved 5.4 → **7.0**. The circle fade-out reads `handoff`
> directly, so the dots stretched to meet it automatically. There is now no
> zoom term in the draw scale at all — one metre is one metre — which is why
> `proto/volcano-3d.js` places each ridge once and never again.

> ==> **`elev` IS ABOVE SEA, NOT ABOVE THE VOLCANO'S OWN BASE, AND THAT IS THIS
> LAYER'S BIGGEST INACCURACY.** <== §42.1.2. Ojos del Salado reads 6,879 m
> standing on a 4,000 m plateau. `reliefCap` per family is the guard — it models
> at 3,500 m like any other big cone — and it is an approximation stated as one.
> **The honest fix is a DEM lookup for base elevation, which this layer does not
> do.** The catalog has no basal diameter and no prominence either, so every
> footprint here is derived from height and family rather than measured.

**TWO RATIO TABLES, DELIBERATELY DIFFERENT, AND MERGING THEM BREAKS ONE OF
THEM.** `shapes.families.ratio` is spread apart from reality so six silhouettes
separate at 3 px on the globe (§42.1.2). `map3d.families.ratio` is real, because
at map zoom there is room for the truth. The SILHOUETTE parameters are shared;
only the proportion differs. The test asserts they disagree.

**TILT FOLLOWS ZOOM CONTINUOUSLY, AND HOW IT IS WRITTEN IS THE WHOLE STORY.**
`Map.setPitch` is `jumpTo({pitch})` and `jumpTo`'s first statement is `stop()`,
which aborts the gesture that triggered it — a pinch that had to be restarted
over and over through the tilt band. `Map.easeTo` calls `stop()` too. So pitch
was written once on `zoomend`, which worked and cost the thing tilt is for: the
lean arrived after the movement, on its own 420 ms clock, while every other fade
in the dive tracks zoom instantly. **That is the "things tilt back out of step"
report.** The fix, 2026-07-31, is to stop going through the camera API at all —
`map.transform.setPitch()` clamps, stores the radians and recalculates the
matrices, with no `stop()` and no events, and it is literally what `jumpTo` does
once `stop()` and the event firing are removed. Four facts out of the 5.6 bundle
make it safe, and they are listed in `map/pitch-ramp.js`; the load-bearing one
is that the gesture handlers apply DELTAS to the live transform every frame and
never write an absolute pitch, so a value written between frames is added to
rather than overwritten. **`map.transform` is a private field and the file says
so**; if the write is ever missing the ramp warns once and reverts to `zoomend`,
because a layer that silently draws pancakes forever is SPEC.md §5's failure.

**AND IT HAS A MEASURED FLOOR.** 0° to 60° across z4.2 → z6.6, programmatic
only —
`touchPitch` and `pitchWithRotate` stay off, so nothing the user can grab has
changed and §42.1.4a's "a tilted sphere is disorienting" is still true where it
was written. **The floor is z3.86**, the tail of `DIVE.fade.cage`, because
`map/globe-follow.js` plants the Three camera on +Z with no concept of pitch and
tilt while the 3D globe is visible pulls the two planets apart. The test asserts
`TILT.zStart` sits above it.

**THE PROJECTION FLATTENS ON THE SAME BAND.** MapLibre's `{type: 'globe'}` is
sugar for interpolating vertical-perspective → mercator between z11 and z12 —
read out of the vendored 5.6 bundle, not remembered. `TILT.flatten` moves that
band to z4.2 → z5.4. Two things want it there: a curved basemap under a 60°
camera at z8 is a warped map, and **a custom layer is only guaranteed a plain
mercator matrix once the globe transform has finished blending.**

**LIGHT IS BAKED INTO VERTEX COLOURS ONCE, NOT COMPUTED PER FRAME.** Every
mountain is axis-aligned and lit by the same fixed sun, so per-instance lighting
would compute one answer repeatedly. No lights in the scene, no shader written,
nothing to fail to compile on a phone GPU.

#### 42.1.4c A seamount is a mountain with the sea drawn over it

**AARON REJECTED THE FLAT CONTOUR RING OUTRIGHT ON 2026-07-30 AND ASKED FOR
ACTUAL GEOMETRY.** So a submarine volcano is built exactly like a land one —
same `volcanoProfile()`, same family ratios, same heightfield, same merge, same
soft base — and then a translucent sheet is laid over the top of it at sea
level. Nothing about the mountain is special-cased. What is special-cased is
where its foot goes.

> ==> **DEPTH GETS THE SAME EXAGGERATION AS HEIGHT, OR SEAMOUNTS PUNCH THROUGH
> THE WATER, AND THIS IS THE ONE THING THAT MUST NOT BE MISSED.** <== `elev` is
> the SUMMIT and it is negative under water. A mountain is drawn
> `relief * vertical` tall and `vertical` is 4. Stand a seamount's foot on the
> map at zero and exaggerate it and the peak comes four times too far up,
> straight through the sea it is supposed to be under. `volcanoBaseM()` puts the
> foot at `elev - relief` instead, so the summit lands at exactly
> `elev * vertical` — still negative, with the depth scaled by the same 4 as the
> height. **A seamount cannot break the surface by arithmetic rather than by a
> clamp**, and `tools/test-volcano-map3d.mjs` asserts it for all 103, Ahyi at
> 55 m down included.

**RELIEF UNDER WATER IS MODELLED FROM ONE FLAT SEAFLOOR, AND THAT IS A STATED
APPROXIMATION OF THE SAME CLASS AS `reliefCap`.** The catalog gives a summit
depth and nothing else — no basal depth, no prominence, no bathymetry at all. So
relief is `submarineFloorM - |elev|`: a shallow summit is a tall mountain, a deep
one is a low rise, every seamount rises from the same modelled floor. **3,000 m
rather than the ~3,700 m global mean**, because these are arc and ridge
volcanoes and the crust under them is shallower. Measured against the shipped
catalog: at 3,000 the median seamount models 22.5 km across against a median
LAND volcano's 16.6, which is the right relationship. At 4,000 the median is
31.5 km — the cone family's relief cap — i.e. most of the set pinned at the
ceiling with no ranking left between them. **The honest fix is a bathymetric
lookup, which this layer does not do.**

**THE SEA IS A SECOND MESH ON ITS OWN GRID, AND IT DOES NOT WRITE DEPTH.** A
heightfield is single-valued by definition, so water above a mountain is the one
thing it cannot express — hence a separate surface at sea level, placed by the
same matrix. It draws after every mountain (`renderOrder` 1) with `depthWrite`
off, so it covers the peak below it without occluding the next ridge behind it.

> ==> **BELOW SEA LEVEL IS NOT THE SAME QUESTION AS UNDER WATER, AND THE
> CATALOG HAS NO FIELD FOR EITHER.** <== `elev` is a summit ELEVATION, so
> `elev < 0` was standing in for "submarine" and it is wrong wherever the
> ground itself sits below the sea. Dallol is 48 m down in Ethiopia's Danakil
> Depression, 78 km inland, and it was being given a modelled seafloor, a foot
> 3 km underground and a 96 km sheet of ocean painted across the desert.
> `isSubmarine()` in `lib/volcano-shape.js` is the only place that decides,
> and it decides ONCE — when a mark is built. `volcanoRelief()` and
> `volcanoBaseM()` read the mark's stored `submarine` flag and must never
> re-classify, because a mark that reaches them without its GVP number would
> silently lose every exception. Two entries, both hand-checked and both far
> enough inland that no better coastline changes the answer;
> `tools/check-dry-volcanoes.mjs` re-derives the candidates from the shipped
> catalog and fails if a new one appears. **The test it uses is deliberately
> not the shipped rule** — the coastline it reads puts the Tjornes Fracture
> Zone, genuinely offshore Iceland, 8 km inland.

**IT REACHES `water.spread` — TWO — TIMES EACH SEAMOUNT'S BASE RADIUS, AND
THREE WAS TOO MANY.** Doubling a reach quadruples what gets painted: at 3 the
median sheet was 110 km across with a 19 km mountain in the middle of it, and
the sea stopped being a surface around a seamount and became a wash with
something under it. The rim compounded it — `water.edgeFade` at 0.30 is a ramp
over the outer 30% of the RADIUS, which is **51% of the disc's AREA**, so more
than half of what was actually looked at was gradient. 2 and 0.15 give a 75 km
sheet with a 5.6 km rim, 28% of it soft. **`edgeFade` no longer matches
`ridge.edgeFade` and that is deliberate**: a mountain's silhouette wants a soft
foot, a water surface wants an edge you can see, and they were the same number
by inheritance rather than by argument. Across the drawn set this took the sea
from 65,312 vertices to 29,066, and dropping the displacement later took it to
18,318.

**THE SHEET HAS ITS OWN GRID, AND THAT IS WHAT LETS IT BE WIDER THAN THE
MOUNTAIN AT ALL.** It borrowed the mountain heightfield's grid outright until
2026-07-31, so it could not be one metre wider than the thing under it, and a
sea exactly the size of what it covers reads as a LID rather than as water. Its
own grid is far coarser than the terrain's, because a sheet has no relief in it.
`lib/volcano-water.js` builds it, `proto/water-shader.js` holds its two GLSL
programs, and `proto/scene-copy.js` takes the picture the shader refracts. The
first two were split out of files that had passed the §12 line ceiling; the third
is new with the optics rewrite below.

**CLIPPED TO THAT REACH, FADED AT THE RIM. AARON'S CALL.** A viewport-wide ocean
is a much larger feature: it has to depth-sort against every land mountain, and
it lies on top of MapLibre's own water polygons, which is two renderers drawing
one ocean at two opacities — the same composite fault already open on the plate
lines and the land handoff. What stops a clipped plane reading as a puddle is
that it has no rim: alpha ramps to nothing over `water.edgeFade`. **The sea
fades out, it does not end.** *The sheet still covers some of MapLibre's own
painted ocean, and that composite fault is accepted here, not solved — it is
smaller at 2x than it was at 3x, which is a side effect and not a fix.*

**IT STOPS AT THE SHORE, AND WHAT TELLS IT IS A PHOTOGRAPH OF THE BASEMAP.**
`proto/basemap-mask.js` copies the framebuffer into a texture; the water shader
samples the pixel directly beneath each fragment and draws only where that pixel
is nearer the ocean's colour than the land's. There is no coastline geometry in
the feature at all.

> ==> **THE COPY IS TAKEN BY ITS OWN MAPLIBRE LAYER, LOW IN THE STYLE, AND THAT
> PLACEMENT IS THE WHOLE DESIGN.** <== The mountains draw on top of everything,
> so by the time they run the framebuffer also holds coastline glow, borders,
> plate seams and place names. A plate seam is orange — and arc seamounts sit
> ON plate seams — so a colour test run at that point punches a hole through the
> sea in exactly the places this feature exists for. The mask is therefore a
> separate, empty custom layer inserted **after the fills and before the first
> line or symbol layer**, where the picture is two colours and nothing else.
> Found by layer TYPE rather than by id, so a renamed coastline cannot move it,
> and so it works unchanged on the Protomaps schema.
>
> Ordering is guaranteed by MapLibre's pass structure rather than by luck: the
> painter runs `offscreen`, then `opaque` in reverse layer order, then
> `translucent` forward. An opaque fill is down before any line or symbol is
> drawn. **The mask layer must stay `renderingMode: '2d'`** — a 3d custom layer
> sets `opaquePassCutoff` to its own index and would drag the ocean fill it
> photographs out of the opaque pass. `tools/test-volcano-map3d.mjs` asserts
> both the mode and the insertion point.

> ==> **THE TEST IS A RATIO, NOT A TOLERANCE.** <== It measures the pixel's
> distance to the sea colour and to the land colour and asks which is nearer, so
> it needs no number tuned per theme. `shore.softness` only sets how wide the
> uncertain band around the halfway point is, which turns MapLibre's own
> antialiased coast pixel into a soft edge instead of a staircase — and its size
> on the ground is one screen pixel at any zoom, because it lives in the picture
> rather than in the world. **A pixel far from BOTH anchors draws no water**
> (`shore.maxDistance`): unknown fails toward no sea, never toward sea painted
> confidently over something unidentified. Nothing but the basemap draws beneath
> this layer today, so that guard is for the day imagery or radar does.
>
> The two colours come from the style's own `metadata`, published by
> `map/style.js` where the world's overrides are merged onto the theme, so the
> mask cannot hold a palette the basemap was not painted with.
> `tools/test-water-mask.mjs` asserts the sea/land gap stays wide enough to
> decide on in every palette — 0.218 at the narrowest today against a 0.12 floor
> — so a recolour that broke the mask fails at check time rather than on a phone.

> ==> **THE COPY IS SKIPPED WHENEVER IT WOULD PRODUCE THE SAME PICTURE.** <== It
> is a full-screen blit and the sea animates, so a naive version pays it on
> every frame the wave already forces. MapLibre repaints an identical basemap
> when the camera has not moved, so the copy runs only on a changed projection
> matrix, a resize, or a capture taken while tiles were still arriving — **a
> still map with moving water pays nothing.** It does not run at all unless a
> sea sheet is on screen. A capture taken mid-tile-load is retried rather than
> trusted, because an unpainted tile shows the background, which is the land
> colour.

> ==> **THREE EARLIER CUTS WERE BUILT AND REVERTED, AND THEY ALL FAILED THE SAME
> WAY: THEY ASKED THE TILE GEOMETRY.** <== `map/coast-source.js` exists to answer
> *is this segment inside a corridor* and its header says it cares nothing for
> winding, closure or which side is land; asked *is this point on land* it gives
> answers that look plausible and are not. The third named the class outright —
> `querySourceFeatures` returns only the tiles **currently cached**, so rotating
> the map made ocean whose tile had been evicted render as land. That is "no
> data" drawn as a confident answer, which `SPEC.md` §5 forbids. **Do not
> re-derive a coastline from tile data. The answer is already on screen.**

> ==> **THE MASK CAN BE LOOKED AT ON ITS OWN, AND THAT IS A REQUIREMENT.** <==
> All three earlier cuts shipped to a phone before anyone could tell whether the
> MASK was right, so a wrong cut and a wrong wiring looked identical. The `Shore
> mask (debug)` switch in `proto-worlds.html` paints the mask flat over the real
> map — cyan where the shader believes sea, red where it believes land. If that
> edge does not sit on the coastline the mask is wrong; if it does and the sea
> still spills, the fault is downstream.

**IT IS A SMALL-N PROBLEM AND THAT WAS NEVER MEASURED BEFORE.** Of the 25
sheets built across the drawn set, all but a handful sit hundreds to thousands
of kilometres from any land — Vailulu'u is 1,175 km out, Boomerang Seamount
3,300 km, the whole Tonga and Kermadec run past 600 km. The sheets that can
touch a shore are Kuwae in Vanuatu, Kavachi in the Solomons and Palinuro off
Italy — **so a shore cut looks identical to no shore cut everywhere else, and
any future one has to report on itself.** An exact count is not available from
anything in this repo, because `map/coastline.js` omits precisely the small
islands those three sit among.

**IT MOVES, AND THE SURFACE IS NEVER DISPLACED.** Three crossed wave trains at
different headings, wavelengths and speeds, in real metres so they scale with
the map and need no zoom term — and all three live in the fragment shader. The
geometry is a flat plane at exactly zero.

**IT DISPLACED THE MESH UNTIL 2026-07-31, AND THAT WAS THE WHOLE REASON THE SEA
LOOKED LIKE A CARTOON.** The vertex shader raised the sheet with the two longest
trains and the fragment shader then painted a lighter colour where the third
said the wave was high. Brightness was a function of HEIGHT, where in the world
it is a function of SLOPE seen from a particular direction — so there was no
optical relationship between the camera, the light and the surface, and it read
as a flat sticker with wavy lines on it however the numbers were tuned.

**Dropping the displacement did not cost anything, because it was never buying
anything.** At 60° of tilt a kilometre of swell on a 20 km sheet is about a
pixel of vertical movement, and this surface carries no normals — one flat
shade — so displacing it produced no shading either. What it DID cost was a
Nyquist floor: the grid had to resolve the shortest displacing wavelength, which
set the vertex count and held wide sheets to a spacing fixed in metres however
big they were. Removing it took the drawn set from 29,066 water vertices to
18,318 and freed `water.cellsPerRadius` to be whatever the rim fade wants and
nothing else. **It also made the invariant above true by construction** rather
than by an argument about a wave offset: a plane at zero cannot be broken by a
summit that is below zero.

### The three cues, and they are all one normal

The waves exist as a **normal** — the direction the surface faces at each pixel
— differentiated out of the same three sines analytically. The derivative of a
sine is a cosine at an angle the shader has already computed, so this is exact,
costs one extra `cos` per train, and needs no finite-difference epsilon and no
`dFdx` (which is an *extension* in WebGL1 and would have to be requested).
`wave.slopeScale` then exaggerates it, and **is named as a fudge because it is
one**: the true combined slope peaks near 0.19, about 11°, which is an honest
ocean swell and far too gentle to catch a light at this scale. Same spirit as
`map3d.vertical`, and confined to one number so the crest tint can still read
the wave's real shape.

Everything else falls out of that normal:

- **REFRACTION (`wave.refractPx`) — the strongest of the three here, and the one
  worth tuning first.** The scene beneath is sampled at an offset, so the
  seamount and the seabed wobble. It is strongest on this map because the camera
  mostly looks DOWN, which is exactly when you see *through* water rather than
  off it. Offset in screen pixels, not metres, so a denser phone does not get a
  weaker effect. Past roughly 30 px the seamount stops reading as a solid object
  under a surface and starts reading as a reflection in one.
- **SPECULAR (`wave.specular`, `wave.shininess`).** Blinn-Phong against
  `map3d.light` — **the same vector the mountains bake their shading from, read
  from the same constant**, so the sea and the rock standing in it cannot be lit
  from two directions. Below about 16 of shininess the whole sea turns milky,
  which is the failure that reads as fog.
- **FRESNEL (`wave.fresnel`) — real, and structurally weak here.** Water
  reflects ~2% head-on and does not pass ~5% until about 60° of incidence, which
  is exactly where `TILT.maxDeg` stops. So the physics sets the SHAPE of the
  curve and the constant sets its amplitude. What saves it from being pointless
  is that a wave face tilted toward the camera adds its own slope to the angle:
  **Fresnel here is a modulation on the wave, not a horizon effect.** Past about
  3 the distinction flattens into a uniform sheen and the water reads as metal.

**THE VIEW DIRECTION IS DERIVED FROM PITCH AND BEARING, AND THE TWO OBVIOUS
ROUTES ARE BOTH SHUT.** Specular and Fresnel both need to know where the eye is.
THREE's own `cameraPosition` is worthless — this layer overwrites
`camera.projectionMatrix` with MapLibre's entire matrix every frame, so THREE's
camera has never been moved and reports the origin. MapLibre's own is not
reachable either: `getFreeCameraOptions()` **is not in the vendored 5.6.0 build**
(checked in the bundle, not assumed), and `transform.cameraPosition` is private,
derived by inverting a different matrix from the one custom layers are handed,
and of unprovable units. So the vector comes from `map.getPitch()` and
`map.getBearing()`, both public and exact, remembering that **MapLibre's mercator
y grows southward** and the custom-layer matrix carries that straight into the
layer's metres.

It is **one direction for the whole sheet**, which is an approximation: strictly
it varies across a 40 km sea because the camera is not infinitely far away. One
value gives a broad even band of glint rather than a hotspot, which on a
stylised map is arguably the better picture and is certainly the cheaper one — a
uniform rather than a varying. **If the glint ever reads as flat or painted-on,
this is the thing to upgrade**: carry mercator position as a varying and compute
the vector per pixel.

### Two framebuffer copies, and merging them breaks both

`proto/basemap-mask.js` and `proto/scene-copy.js` photograph the same buffer at
two different moments, and the obvious-looking tidy-up here is a bug.

| | Taken | Contains | Answers |
|---|---|---|---|
| `uMask` | from its own MapLibre layer, low in the style | ocean fill and land fill, nothing else | is the pixel under me sea or land? |
| `uScene` | inside the volcano layer, between the terrain render and the water render | everything, including the mountains | what is underneath, to be bent? |

The mask must be two colours because its test asks which of two known colours a
pixel is nearer to — a coastline glow or an orange plate seam in that picture
punches holes through the sea wherever one crosses, and arc seamounts sit ON
plate seams. The scene copy must have the mountains in it because a refraction
shows you whatever is actually down there. **Feed either to the other's consumer
and it fails quietly**: the shoreline cut starts eating holes around mountains,
or the refraction wobbles a two-colour stencil and shows nothing.

**The shoreline test reads the UNDISTORTED pixel on purpose.** Refracting it as
well would let the sea creep inland wherever a wave leaned the right way, which
is the exact failure the cut exists to prevent. A wobbling waterline is welcome
as a deliberate effect; it is not welcome as a side effect of something else.

**AND WITH A SCENE COPY THE COMPOSITE IS OURS, NOT THE BLENDER'S.** Sampling the
background *and* letting GL alpha-blend over that same background counts it
twice. So the shader mixes the water over the refracted scene by hand and hands
back the sheet's **rim fade alone** as alpha, which makes the sheet's edge a fade
from refracted to un-refracted rather than a fade to nothing. This is why
`lib/volcano-water.js` bakes the rim fade *without* `water.opacity` folded in,
and why the opacity is a uniform: multiplied together they would be applied
twice. Before the first copy lands there is nothing to mix with, so the shader
falls back to ordinary alpha blending for a frame.

**THE SEA IS ITS OWN SCENE, AND THAT SPLIT IS WHAT MAKES ANY OF IT POSSIBLE.**
Terrain and water shared one scene with `renderOrder` 1 on the water, which drew
the right thing in the right order in one call and left nowhere to stand between
them. Refraction needs exactly that gap. Two scenes is two `render()` calls with
one line between them. **The depth buffer is not cleared between them and must
not be** — the sea is `depthTest: true, depthWrite: false`, so it still hides
behind terrain in front of it while never occluding anything; clearing would put
the sea over every mountain regardless of where the camera is.

**THE CREST TINT SURVIVED ALL OF THIS, AND IT NOW RIDES THE OTHER CHANNEL.**
`wave.crestColor` / `crestMix` / `crestSharpness` tint the wave by its HEIGHT
while the three cues above all read its SLOPE. That division is the right one —
colour belongs to the top of a wave, light belongs to its face — and it is the
diagnostic: if the sea looks flatly tinted rather than lit, `crestMix` is too
high and the three optical constants are too low.

> ==> **THE SURFACE SITS IN `[0, 2A]`, NOT ABOUT ZERO, AND THAT IS WHAT KEEPS
> THE INVARIANT ABOVE TRUE.** <== Ahyi's summit is 55 m down, which is 220 m in
> exaggerated space. A wave swinging evenly above and below sea level puts a
> trough under it and pops the peak through the sea roughly twice a second —
> defeating "a seamount cannot break the surface by arithmetic" with motion the
> geometry test cannot see. Offsetting by one amplitude means the lowest the sea
> ever gets is exactly sea level. Mean sea level then sits one amplitude high,
> which at a scale where the mountain under it is 20 km across is not visible.

> ==> **THE SEA IS THE ONE THING ON THIS LAYER THAT COSTS FRAMES, AND THE COST
> IS A FULL MAP REPAINT.** <== A MapLibre custom layer draws only when MapLibre
> draws, so motion means `triggerRepaint()` every frame — basemap, tiles and all
> layers, for a ripple. It is gated on visible-and-faded-in-and-water-exists,
> `V3D` prints `*` while it runs so the cost is never invisible, and
> `wave.amplitudeM: 0` stops the motion and the repaint together. **What one of
> those frames costs has still not been measured** (`NOW.md`).

**THE SEA HAS ITS OWN CELL CEILING, AND SHARING THE RIDGE'S WAS A BUG.** The two
grids are driven by different things — terrain resolution follows the mountain's
size, the sea's follows a wavelength fixed in metres — so one ceiling silently
coarsened every wide sheet straight back past its sampling floor. Same trap the
gully measurement names: raise a resolution without raising the cap and every
cluster quietly returns to where it started with nothing reporting it.
`water.maxCells` is set with headroom above the widest real sheet (116 km, near
Samoa), measured by `tools/check-water-extent.mjs` — **re-run that tool if
`spread`, `cellsPerRadius` or the wavelengths move.**

**A COASTAL CLUSTER CAN HOLD BOTH, AND THE BASE PLANE IS BLENDED RATHER THAN
ASSUMED.** Clustering is by intersecting footprints and does not care what is
under water, so a land volcano and a seamount can land in one ridge. Their feet
are 12 km apart vertically after exaggeration, and the first grid node neither
covers would have been a sheer wall between them. The foot under any node is an
inverse-square distance blend of every member's, which is continuous everywhere;
for an all-land cluster every term is zero, so it collapses to exactly the old
behaviour and is skipped entirely for cost.

**AND Z IS SIGNED NOW, WHICH RETIRED AN ASSUMPTION THE MESH TRIMMING RELIED ON.**
Height above the map could never be negative, so "is this node inside a
footprint" and "is this node above zero" were the same question and the trimming
asked the second one. A seamount is entirely below zero and would have been
trimmed away completely. Coverage is tracked explicitly.

**THIS REVERSED THREE ASSERTED THINGS AND ALL THREE MOVED TOGETHER.**
`isEdifice()` excluded submarine volcanoes; `tools/test-volcano-map3d.mjs`
asserted that no submarine volcano gets an edifice; and §42.1.4 said they keep
their circle forever. All three were right when there was no way to draw
underwater. **Volcanic fields still keep their mark**, so `isEdifice` keeps that
half of its job.

#### 42.1.4d No two volcanoes are the same mountain

**A HEIGHTFIELD BUILT FROM A RADIAL PROFILE IS A SURFACE OF REVOLUTION, AND
THAT MADE EVERY CONE THE SAME OBJECT.** `volcanoProfile()` answers "at this
distance from the axis, how high" and was never asked which DIRECTION.
Measured before this landed: Fujisan, Etna, Rainier, Popocatépetl and
Villarrica all reported an identical baked shade range of 0.49–0.99, spread
0.506, to three decimal places. 126 drawn volcanoes over five families is about
twenty-five copies of each and the eye finds repeats fast.
`lib/volcano-variation.js` makes the profile a function of BEARING as well. It
has no THREE in it and `tools/test-volcano-variation.mjs` asserts every
invariant below without a browser.

**TERRAIN SHADING IS NOT A SEPARATE FEATURE.** `lib/volcano-ridge.js` already
computes a surface normal per vertex and bakes a light value into the vertex
colour (§42.1.4b). Shading is what arrives the moment the terrain stops being a
surface of revolution — no light, no shader, no second pass.

> ==> **SEEDED FROM THE GVP CATALOG NUMBER, SO A MOUNTAIN IS THE SAME MOUNTAIN
> ON EVERY RELOAD.** <== Not three or four variants: every volcano gets its own
> shape for the same cost. The seed is multiplicatively hashed before it
> reaches the generator because GVP numbers run sequentially within a region —
> Kamchatka is 300240, 300250, 300260 — and a raw sequential seed walks a
> xorshift's state in lockstep, which would hand a whole arc one shape. That is
> the original problem arriving by a different door, and a test fails on it.

**RADIAL, NEVER ISOTROPIC, AND THE LADDER STOPS WHERE THE GRID DOES.**
Isotropic noise reads as gravel; variation that runs downhill from the summit
reads as a volcano. So every term is a function of bearing, expressed as
harmonics of the compass angle: k=2, 3, 5 and 7. **The grid sets the ceiling,
not taste** — `cellsPerRadius` 10 is about 21 samples across a mountain and
therefore about 33 cells around its mid-flank, so k=7 has roughly five cells
per lobe and anything finer aliases into a starfish. Finer relief than that is
downhill gullies, which were measured 2026-07-31 at 9x the grid — 130,350 nodes
to 1,108,989 and 134–288 ms to 994–4,021 ms — and are out of scope until
resolution follows on-screen size.

> ==> **THE SUMMIT OFFSET IS A DISPLACEMENT, NOT A HARMONIC, AND THAT IS WHY IT
> COSTS NO FOOTPRINT.** <== A k=1 harmonic gives the same read — one long flank
> and one short one — but it changes the OUTLINE, so pinning the maximum at the
> true radius makes everything else shrink to pay for it. The offset instead
> slides the peak sideways and is multiplied by `1 - q`, so it is full strength
> at the axis and exactly zero at the rim. It carries the largest share of the
> character here and the footprint does not move by a metre for it. There is
> deliberately no k=1 in the harmonic ladder and a test asserts its absence.

> ==> **THE TRUE RADIUS IS THE OUTER BOUND, NOT THE AVERAGE, AND A VARIED
> MOUNTAIN IS THEREFORE NARROWER.** <== A footprint that grows in any direction
> is the mistake that killed `fill-extrusion` and then `inflate` (§42.1.4a,
> §42.1.4b), so the harmonic sum is divided by its own maximum over all
> bearings — found by a 256-step scan **refined by golden section**, because a
> coarse scan left the widest bearing 0.02% outside the footprint and 0.02% is
> still a footprint growing. The widest bearing now lands exactly on the
> modelled radius and every other bearing lands inside it. Measured across the
> catalog: **a varied mountain averages 84% of its true radius**, and the drawn
> median is 35 px across at the z7.0 handoff against the 30 px that handoff was
> chosen for. **Raising a family ratio to win the average back would be a
> horizontal scale factor under a new name and is not done.**

> ==> **A CRATER IS ELEVEN GRID CELLS ACROSS AND THE FLANK WARP SHREDS IT.**
> <== All 13 calderas in the drawn tier sample their crater at exactly 11.0
> cells, so the rim ring is 5.5 cells from axis to edge and a warp at
> `variation.amount` 0.30 moves it by ±1.6 of them. Rendered from the real
> vertex colours, the bowl was gone and a caldera read as a lumpy hill — worse
> than the smooth one it replaced. **So on the one family with a crater the
> outline warp ramps in from the rim outward over `variation.craterTaper`**,
> gated on `spec.topR`, which already IS the rim radius: 0.04 on a cone, where
> it changes nothing, and 0.55 on a caldera.

**THE LOPSIDED RIM IS ITS OWN TERM, BECAUSE THE OUTLINE WARP CANNOT EXPRESS
IT.** Warping the radius moves a rim IN and OUT and cannot move it UP and DOWN,
so a caldera came out an oval ring at one uniform height. `variation.breach`
cuts one sector of the rim down toward the crater floor and leaves the opposite
sector alone — the shape Vesuvius's Somma and Mount St Helens have. It is
subtractive and bounded by the rim's own height above its own floor, so **it
can only lower a rim, never punch through the floor, and never touch the lower
flank.** Four families out of five have no crater and pay nothing.

**NOTHING IS INFLATED, WHICH IS WHAT KEEPS THE MERGE HONEST.** The smooth-max
guarantee is that a summit is never raised by a neighbour (§42.1.4b). Variation
can lower the ground and can move a peak sideways; it can never make a mountain
stand taller than the profile it came from, and the test asserts that against
the exact profile ceiling rather than a sampled one. Grid resolution is
untouched — the cell size comes from true radii — so **this adds zero samples
and zero triangles**, and the drawn set's triangle count went DOWN with the
narrowing. Build cost on the drawn tier is inside the run-to-run noise of the
build it modulates.

**`variation.amount` IS THE ONE NUMBER TO JUDGE ON GLASS AND EVERYTHING ELSE IS
STRUCTURE.** At 0.08 five stratovolcanoes still read as one mountain drawn five
times. At 0.45 they read as shards: the flanks go faceted where the grid runs
out at about five cells per lobe, and the shrink gets severe enough to see on a
shield. It ships at **0.30**.

#### 42.1.5 The plume budget is ~25, not 500

Every volcano carries summit elevation from −5,700 m to 6,879 m, so a plume
anchors at true altitude. **Phase E must leave a summit anchor point per volcano
behind for exactly this reason.**

**Only ~22–27 are erupting at any given time** — 22 items in the Smithsonian
weekly report, 5 elevated US volcanoes from USGS HANS. That is the emitter count,
and it is small enough to afford real detail per plume.

**Plume height and drift direction are published values, not invented ones** — and
that is what separates this from decoration. On-screen height and lean can both be
true.

> ==> **BUT THE "21 OF 22 STATE A HEIGHT" CLAIM IS NOT CONFIRMED AND SHOULD NOT BE
> RELIED ON.** <== A first-pass parse of the live feed on 2026-07-30 extracted a
> height for **6 of 22** and a drift bearing for **10 of 22**. Either the earlier
> figure was optimistic or the prose formats vary more than one regex catches —
> both are plausible and neither is established. **Phase H must write a real parser
> and re-measure before any design depends on a height being present.** Where no
> height is published the plume needs an honest default, not an invented number.

**Measured heights in that week, for calibration:** Purace 2.8 km, Taal 2.8 km,
Dukono 2.1 km, Mayon 2.0 km, Aira 1.7 km, Sabancaya 1.0 km. So the real range is
roughly **1–3 km above the summit**, against summit elevations of 300–5,960 m. The
plume is frequently TALLER than the mountain it sits on, which matters for §42.1.3:
whatever exaggeration the edifice gets, the plume needs its own and they must stay
in proportion to each other.

> ==> **AND A PLUME IS INVISIBLE FROM SPACE. THIS IS ARITHMETIC, NOT TASTE.**
> <== 1 px is about 30 km on the space globe (the same number that killed DEM
> footprint baking, §42.1.2). A 3 km column at `map3d.vertical` 4.0 is **0.4 of
> one pixel.** So **THERE IS NO SPACE-TIER PLUME AND BUILDING ONE MEANS
> INVENTING IT.** The erupting halo already holds that slot. It would also be
> the first continuously-animating thing on that world, which `NOW.md` forbids
> until a MapLibre frame has been costed.
>
> **At map zoom it works and it rides a frame already paid for.** The sea calls
> `triggerRepaint()` every frame there, so a plume adds no new repaint cost —
> which is why the frame-cost item does NOT block it. A 2 km plume at true
> scale and 4x measures **~9 px at z7, 19 at z8, 37 at z9**: it arrives quietly
> with the mountains and becomes the point a zoom later, the same ladder logic
> as the dots handing off to the edifices.

**ONLY AN ACTIVE VAAC ASH ADVISORY EARNS A COLUMN.** The erupting set is a
three-way union (§42.1.1) and **Great Sitkin and Kilauea erupt lava with no ash
cloud and appear in no advisory anywhere.** Smoke drawn over a lava-only
eruption is the layer's first outright lie. They take the vent glow in §42.1.9
instead. This cuts the emitter count well under 22.

##### The technique: billboards in a vertex shader. Both earlier candidates are rejected.

**GAUSSIAN SPLATS — NO.** Transparent blobs must be depth-sorted every time the
camera moves; this globe's camera never rests (SPEC-MAP.md §9.7); the leading
three.js implementation sorts on the CPU and disables its GPU sort on mobile by
default. Heaviest possible transparent overdraw against the one budget §40.1
says binds.

**GRID FLUID SIMULATION — NO.** WebGPU only, no published mobile numbers, and
it is a screen-space 2D solver — a post-process, not a volume anchored to a
point on a sphere. Adapting it is a research project, not a phase.

**BUILD: a stack of soft billboards rising from the vent, moved entirely in the
vertex shader from one time uniform.** Roughly a dozen quads per column, each
wider and fainter than the one below, drifting as it rises. No CPU work per
frame and no simulation.

> ==> **AND THE SORT PROBLEM DOES NOT EXIST, FOR A STATEABLE REASON.** <== The
> camera can never go below `TILT.maxDeg` off vertical, so it is **always above
> the column**, so the top of a vertical stack is **always** nearer the camera
> than its base. Back-to-front is therefore a fixed order — base first, top
> last, forever — and there is no per-frame sort to be slow. This is the whole
> reason billboards beat splats here.

**EXAGGERATION TIES TO THE MOUNTAINS BY ARITHMETIC, NOT BY DISCIPLINE.** The
plume reads `map3d.vertical` directly with one dial on top
(`plume.exaggerationRatio`, default 1.0), so moving mountain height on glass
moves the plume with it. That is this section's "must stay in proportion",
enforced rather than remembered.

**THE HONESTY RULES, BINDING.** Height published → true altitude. **Height
missing → a low, soft, UNTOPPED puff that visibly refuses to state a height**,
never an average and never a plausible-looking column. Drift missing → straight
up, which is the honest null.

**TWO CODE GAPS, ONE OF WHICH IS A SPEC DEVIATION.** `plumeTopFeet` reaches the
browser and nothing reads it, and no drift bearing is parsed at all. And **the
summit anchor this section requires of Phase E DOES NOT EXIST** — `buildRidge`
returns one `peak` per CLUSTER, not a point per volcano. The data is inside the
function and is not exported. Fix the code, not this paragraph.

#### 42.1.6 There is no list of what erupts next

**No global ranked eruption watchlist exists, and anything presenting itself as
one is guessing.** Eruption forecasting is days-to-weeks and site-specific. The
honest proxies, in order of directness: the Smithsonian weekly report (what is
erupting now), USGS HANS alert levels (US only — and empty outside the US is not
the same as calm, SPEC.md §5), and recent eruption frequency.

**Do not let a UI label imply prediction.** "Most active" is a measured rate.
"Erupting now" is a report window. Neither is a forecast.

#### 42.1.7 Nineteen volcanoes cannot be drawn, and the gap is all Japan and the Kurils

**GVP publishes these volcanoes and their eruptions but NO COORDINATES ANYWHERE IN
THE WFS.** Verified 2026-07-30 across two independent layers:
`E3WebApp_HoloceneVolcanoes` carries 1,215 rows of which **only 1,196 have
geometry — and the 19 nulls are exactly these**; a CQL query against
`Smithsonian_VOTW_Holocene_Eruptions` returns **222 eruption records for them, all
with null geometry.** This is an upstream gap, not a fetch mistake, and re-fetching
will not fix it.

```
Akan · Ontakesan · Nishinoshima · Zaozan · Nasudake · Chokaisan · Izu-Tobu
Harunasan · Nantaisan · Yokodake · Yokoatejima · Funka Asane · Kaitoku Seamount
Chachadake [Tiatia] · Etorofu-Yakeyama · Etorofu-Atosanupuri
Sashiusudake [Baransky] · Ruruidake [Smirnov] · Odamoisan [Tebenkov]
```

**EVERY ONE IS JAPAN OR THE KURIL ISLANDS.** A systematic regional hole, not
scatter — and the worst possible place for one in a volcano app. **17 of the 19
have eruption histories** and two are consequential: **Ontakesan**, whose 2014
eruption killed 63 hikers, and **Nishinoshima**, the island that has been rebuilding
itself for a decade. **Akan** is a space-tier member by its own numbers.

**They are absent from the globe today and the app must not imply otherwise.**
Under SPEC.md §5 this is a coverage limit to state, not to hide: the catalog is
`none_matched` for these, never `clear`.

**The fix, if it is ever wanted, is 19 hand-placed coordinates** — and that is a
real cost, not a chore: it makes the repo a second source of truth for the one
fact §22.1 says the catalog is the authority on. Not recommended without a bulk
source that is not the WFS.

#### 42.1.8 Population exposure — SHIPPED, and it is ONE channel among equals

> ==> **AARON'S CALL, 2026-07-30: "I'm not sure I want population exposure
> completely dropped. I just want it weighted equally among all of the data."**
> <== So it is neither the primary ranking key nor declined. **No single channel
> owns severity on this globe.**

`pop30` — people within 30 km — is merged into the catalog for **1,161 of 1,196**
volcanoes, costing **4,129 bytes gzipped**. Source is
`E3WebApp_HoloceneVolcanoes`, which also publishes 5 km, 10 km and 100 km radii;
only 30 km is shipped because one at-risk figure is enough for a weighted channel
and the other three are re-fetchable from the recipe.

**==> `pop30` ABSENT AND `pop30 == 0` ARE DIFFERENT FACTS AND MUST NEVER
COLLAPSE. <==** 35 volcanoes have **no exposure figure published** and 214 have a
**measured zero** — genuinely nobody within 30 km, which is the correct answer for
an Aleutian island. That is exactly SPEC.md §5's `unavailable` against `clear`, and
the merge preserves it by omitting the key rather than writing 0. **A renderer that
treats missing as zero silently reports "nobody lives here" about 35 volcanoes it
knows nothing about.**

**Why the channel earns its place, measured against the live erupting set:**

```
Merapi        4,348,473        Kilauea             8,495
Taal          2,380,326        Krakatau            8,027
Mayon         1,166,441        Ambae               4,326
Semeru        1,022,197        Sheveluch           1,718
Etna          1,016,540        Atka                  207
Kanlaon         923,257        Ahyi                    0
Aira            905,254        Great Sitkin            0
```

Merapi and Great Sitkin are **both erupting right now** and mean completely
different things. Live status alone cannot separate them; exposure can. That is the
argument for the channel and also the limit of it — **exposure never suppresses a
live eruption** (§42.1.1), it modulates how loudly one reads.

> **"EQUALLY WEIGHTED" HAD A TRAP AND THE RULE THAT ANSWERS IT IS SETTLED.** The
> channels do not share coverage. Counted against the **1,196-feature catalog the
> code actually reads**, which is the only denominator anything per-volcano can
> normalise over:
>
> ```
> ec      present  832   absent  364
> vei     present  670   absent  526
> pop30   present 1161   absent   35     (and 214 a measured ZERO)
> ```
>
> ==> **NO CHANNEL IS COMPLETE, AND THE DENOMINATOR IS WHY THIS KEEPS GETTING
> RESTATED WRONG.** <== `ec` is complete for the **915 volcanoes with any
> eruption record** and absent for the other 364; `vei` is missing for **226 of
> those 915** and for **526 of the 1,196**. Both figures are correct about
> different populations, and they reconcile: 915 − 226 = 689 with a VEI, minus
> the 19 unplaceable volcanoes of §42.1.7 = **670**, which is what the file
> holds. **Quote the 1,196 figures here. Anything normalising per-volcano reads
> the catalog, not the eruption record.**
>
> ==> **THE RULE: ONE TEST, AND IT IS WHETHER THE VOLCANO HAS AN ERUPTION RECORD
> AT ALL.** <== An equal-weight composite over raw values quietly penalises every
> volcano with a gap — a missing channel scored as zero is an opinion, not an
> absence. But so is a midpoint, and there are **two kinds of absence here**:
>
> - **`ec` absent is a RECORDED ZERO, not a gap.** Of the 364 with no `ec`,
>   **zero have a `vei` and zero have a `last`** — GVP looked and recorded no
>   Holocene eruption. Substituting 0 makes the floor fall out of the transform
>   instead of being a special case bolted onto it. A midpoint here would invent
>   activity nobody reported, 364 times.
> - **`vei` absent splits on the same test** — zero when there is no `ec` (the
>   same 364), the median when there is (**162 volcanoes** that erupted and
>   nobody sized it).
> - **`pop30` absent is always unknown** (**35**) → the median. `pop30 === 0` is
>   MEASURED for 214 more and never collapses into it.
>
> ==> **THE MIDPOINT IS EACH CHANNEL'S OWN MEDIAN, NOT A FLAT 0.5.** <== 0.5 is
> only neutral if the normalised distribution centres there and none of these do
> — normalised, the medians land at `ec` 0.304, `vei` 0.429, `pop30` 0.550.
> Stated honestly this is a SMALL decision: it touches 192 volcanoes, moves a
> score by at most 0.024, and reorders nothing by more than 71 places.
>
> ==> **THE TRANSFORM IS PER CHANNEL AND `vei` IS THE TRAP.** <== `ec` and
> `pop30` take `log1p`; **`vei` MUST NOT** — VEI is already logarithmic, so
> logging it twice halves a real 10× difference. That choice is worth roughly
> seven times the midpoint choice: log-against-linear reorders 1,106 of the
> 1,196 and moves one volcano 518 places.
>
> ==> **AND THE SCORE RANKS THE QUIET. IT IS NEVER A FILTER** (§42.1.1). A 0.5
> severity cut would hide five volcanoes erupting on 2026-07-30, Great Sitkin
> among them at 0.240. Selection of quiet context and how loudly a mark reads —
> those two, nothing else.
>
> The numbers live in `VOLCANO.severity` in `config/constants.js`, the
> arithmetic in `lib/volcano-severity.js`, and
> `tools/test-volcano-severity.mjs` recomputes every measured constant from the
> shipped catalog so none of it can drift. **Re-fetch the catalog, re-run that
> suite.**

`E3WebApp_HoloceneVolcanoes` carries `Within_5km` / `Within_10km` / `Within_30km` /
`Within_100km`. **The FIELDS exist for all 1,196 positioned volcanoes; the VALUES
do not** — 1,161 carry a figure and 35 are published empty. Median within 30 km is
4,523 people; the maximum is 6,735,396.

```
Tatun Volcanic Group 6,735,396 · Michoacan-Guanajuato 5,783,287
Tangkuban Parahu 5,729,309 · Penanggungan 4,605,710 · Merapi 4,348,473
Arjuno-Welirang 4,143,137 · Chichinautzin 4,061,942 · Vesuvius 3,907,941
```

**For a hazard app this is arguably a better selection channel than either
eruption count or VEI**, because it ranks by consequence rather than by frequency
or by size. A remote Andean cone that erupts constantly matters less than Vesuvius
with 3.9 million people inside 30 km. **NOT FETCHED AND NOT USED — recorded here
so the decision is available rather than rediscovered.**

---

#### 42.1.9 What comes out of a volcano, and which of it we can honestly draw

**SEVEN THINGS COME OUT AND OUR FEEDS DISTINGUISH THREE.** The table is the
whole design constraint:

| Emission | Do we know it is happening? | Where / how much? |
|---|---|---|
| **Ash** | Yes — VAAC, ~80 min old | Yes — `plumeTopFeet` and position |
| **Gas and steam** | Only in prose we currently discard | No |
| **Lava** | Yes — the weekly activity category | No |
| **Pyroclastic flow** | Prose only, rare, deadly | No |
| **Lahar** | Prose only | No |
| **Resuspended old ash** | Yes — VAAC flags it | Position yes |
| **Unrest, nothing emitted** | Yes — `New Unrest` | Nothing is coming out |

**GAS AND STEAM IS THE MOST COMMON THING A VOLCANO DOES, AND IT IS WHITE.** If
every eruption gets a grey ash column we draw ash over volcanoes that are
quietly steaming — the same class of error as an all-clear during an outage
(SPEC.md §5).

**RESUSPENDED ASH IS WIND LIFTING OLD DUST OFF A PLAIN. IT IS NOT AN
ERUPTION.** VAAC issues advisories for it; draw a plume and we have invented an
eruption. It probably falls out already because Buenos Aires sends those with
`VOLCANO: UNKNOWN` and they cannot join — **that is an accident, not a design,
and H1 must verify it rather than assume it.**

**`New Unrest` MEANS NOTHING IS COMING OUT.** Seismicity and deformation, no
emission. `_union.js` already excludes it from `erupting` correctly. Halo only.

##### Lava is a glowing vent, never an invented flow

**NO FEED PUBLISHES WHERE LAVA IS** — not direction, not length, not extent.

> ==> **REJECTED: RUNNING THE FLOW DOWNHILL ON OUR OWN HEIGHTFIELD.** <==
> Dishonest in a sneaky way — it looks measured and is only topography — and
> the grid is far too coarse for downhill detail anyway, with the fix a
> blocking multi-second build on a phone (`NOW.md`, the gully measurement).
> Two independent reasons, either one sufficient.

**BUILD: an incandescent vent.** The crater glows and heat spills a short,
non-directional way down the upper cone. It says *hot, erupting, no ash*, which
is exactly what is known, and it is cheap — emissive colour on vertices that
already exist. **This is also where lava orange belongs**, literally rather
than symbolically.

**A REAL DIRECTIONAL FLOW STAYS ON THE TABLE ONLY IF H1 FINDS A PUBLISHED
DIRECTION.** Unverified sources if it ever matters: MIROVA/MODVOLC thermal
anomalies, and NASA FIRMS hotspots — which are a FIRE product, so a nearby
wildfire and a lava flow are indistinguishable except by distance to the vent.

##### The highest-value data move in the phase

> ==> **WE FETCH THE SMITHSONIAN WEEKLY REPORT AND READ ONLY ITS TITLE.** <==
> `_union.js` takes the name, the window and the activity category from
> `<title>` and **throws the body away.** The body is the only place on any of
> our feeds that names what is actually coming out — *lava flow advanced 2 km
> to the southwest*, *gas-and-steam plume*, *pyroclastic flow*. One parser, on
> text already being downloaded, feeds ash-versus-steam colour, lava
> confirmation, and possibly the lava direction a real flow would need.

##### The build order

**H1 — measure, no pixels.** Count how many of the erupting set actually carry
`plumeTopFeet`; **the "21 of 22 state a height" claim did NOT reproduce and a
first parse got 6 of 22.** Prototype drift as the vector between the observed
cloud position and the +6 HR forecast position — published geometry, not parsed
prose. Parse the weekly body and count emission types and lava directions.
Verify resuspension is really being dropped.

**H2 — the column and the vent.** Summit anchors out of `buildRidges`, ash
plume, lava glow, ash grey versus steam white. **A NEW FILE** —
`proto/volcano-3d.js` and `proto/volcano-marks.js` are both at or over the §12
ceiling already.

**H3 — the lean.** Drift added, and a real lava flow only if H1 found a
direction to draw one from.

## 44. Build order

1. **The engine, before any new world.** r128 → r182+, `WebGPURenderer` with
   WebGL2 fallback through TSL, and the §40.2 instancing discipline proven on the
   globe that already exists. This is the riskiest step, it touches Sky, and it
   wants doing outside cyclone season.
2. **The world shell.** `config/worlds/`, the switcher, the transition, the
   teardown-without-leaking path (§38.3). One extra world is enough to prove it;
   three is not required.
3. **Deep, earthquakes only.** Fully unblocked, the cheapest thing on the list,
   and the plate boundaries make it look finished on day one. It proves the world
   model without putting the particle work on the critical path.
4. **Volcanoes, onto Deep.** The data is clean and complete and the plume is the
   strongest single effect available — but it is also the only expensive thing in
   the app (§42.1), so it lands on a globe whose other effect is already proven
   and free.

   **Volcanoes have their own eight phases inside this step**, because the
   catalog layer and the plume are separated by a relay and an engine's worth of
   distance:

   | | | |
   |---|---|---|
   | **A** | land the eruption data (§22.5) | ✅ |
   | **B** | write the contract (§42.1) | ✅ |
   | **C** | the live relay (§22.4) | ✅ |
   | **D** | constants — severity normalisation (§42.1.8) | ✅ |
   | **E** | flat marks, erupting set first | ✅ |
   | **F** | shapes — the six families (§42.1.2) | ✅ |
   | **G** | seamounts under water (§42.1.4c) | |
   | **H** | plumes, lava and emission classes (§42.1.5, §42.1.9) | |

   **THE RELAY IS `C` ON AARON'S CALL — "up to date active data over anything
   else"** — which pushed every letter after it down one. It was not in the
   original list at all; the catalog was going to carry the layer alone until
   the erupting set turned out to be a three-way union of feeds nobody had
   read yet.

   **E BEFORE F IS THE ONE THAT MATTERS.** Placement and silhouette shipped
   together means a wrong-looking phone screen has two candidate causes and no
   way to separate them. Marks first, proven, then shape on top.

   **G SITS AFTER F BECAUSE A DIMPLE IS A SHAPE FAMILY INVERTED**, and negative
   relief cannot be built before the positive geometry it is cut out of. That
   leaves a real gap in E and F: **Ahyi is erupting 55 m under water right
   now**, so the erupting set contains a submarine volcano from day one. E and F
   draw it with a distinguishable FLAT treatment and no dimple — honest, not
   final. **E shipped it as a hollow gold ring and it was confirmed on a phone
   2026-07-30**, in the Mariana arc where it belongs; 110 volcanoes carry the
   flag and 7 of them are in the quiet tier. **F must not lose the ring when it
   grows edifices around it** — the moment a submarine volcano gets a silhouette
   it becomes the layer's first lie, and G is what retires the workaround.
5. **Surface, wildfire first.** Clean data, and it rides the particle stack the
   plume just paid for.
6. **Drought**, onto Surface, once §43.5 has a design answer and §42's `[DECIDE]`
   on the land form is closed.
7. **Flood**, onto Surface, with surge and gauges staying on Sky.

**QUAKES BEFORE PLUMES, AND DEEP BEFORE SURFACE.** SPEC-HAZARDS.md §25.6 ranks by
data quality, which puts volcanoes early. This ranks by total risk, and the two
disagree on purpose: the cheap half of Deep retires the world model as a question
before anything expensive is attempted on top of it, and Surface is last because
its rendering form is still an open decision (§42) while Deep's is settled.
