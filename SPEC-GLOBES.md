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

**A VOLCANO IS THE PLANET'S OWN SKIN PUSHED UP, NOT A MARKER STUCK ON IT.** Same
colour and material as the translucent land sheet, lifting out of it, catching the
same light sweep as every other surface on this globe. A pin would read as
furniture; a bump reads as terrain.

**COST IS NOT THE CONSTRAINT AND MUST NOT BE USED AS AN ARGUMENT HERE.** All 1,196
edifices are one `InstancedMesh` and **one draw call**, with the family profile as
a per-instance vertex attribute so six shapes come out of one geometry. What limits
the layer is VISUAL NOISE. Every count decision below is a legibility decision.

**VOLCANOES GO IN THEIR OWN FILE.** `proto/world-deep.js` is past 1,000 lines and
therefore past §12's trigger. `proto/volcano-field.js`, alongside
`proto/ripple-field.js`.

#### 42.1.1 Selection is a ladder, not a cut

**1,196 dots is noise and 364 of them have no recorded eruption ever.** Measured
tiers, all live 2026-07-30:

| Rule | In the shipped file | In GVP's eruption record |
|---|---|---|
| erupted since 1900 | 422 | 435 |
| **≥10 confirmed eruptions since 1900** | **128** | **129** |
| max VEI ≥ 5 | 126 | 128 |
| erupted since 2020 | 116 | — |
| erupting right now | ~22–27 | — |
| submarine (`elev < 0`) | 110 | — |
| no eruption record at all | 321 | — |

**THE TWO COLUMNS DIFFER BY THE 19 UNPLACEABLE VOLCANOES IN §42.1.7, AND THE
SHIPPED COLUMN IS THE ONE THE CODE CAN DELIVER.** The single missing member of the
space tier is Akan, with 19 eruptions since 1900.

> ==> **THE ERUPTING SET IS A UNION, NEVER A FILTER, AND THIS IS NOT A
> PREFERENCE.** <== Measured against the live weekly report 2026-07-30: **6 of the
> 22 currently-erupting volcanoes fall OUTSIDE the 128 activity tier** — Ambae,
> Dukono, Great Sitkin, Ibu, Lewotolok, Sabancaya. Drawing `tier ∩ erupting` hides
> six volcanoes that are erupting today, which is SPEC.md §5's exact failure mode:
> the app reporting calm about places it has live evidence are not.
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

#### 42.1.4 Two sets that are not mountains and must not be drawn as one

**110 ARE BELOW SEA LEVEL** (`elev < 0`, to −5,700 m). A cone sticking out of the
Pacific for a seamount 1,800 m down is simply false. Sunken dimple, glow UNDER the
shell, **and never an ash column above the water.**

**365 ARE NOT A SINGLE EDIFICE.** 138 are typed `Volcanic field` and 227 carry
`landform: Cluster` — "West Eifel Volcanic Field", "Crater rows", "Fissure
vent(s)" — scattered vents spread over tens of km. A single cone for them is a
fabrication. Broad low mound or a flat mark.

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
   | **E** | flat marks, erupting set first | |
   | **F** | shapes — the six families (§42.1.2) | |
   | **G** | submarine dimples (§42.1.4) | |
   | **H** | plumes (§42.1.5) | |

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
   final. **Shipping E with Ahyi drawn as a mountain would be the layer's first
   lie**, and it is the reason submarine work came forward with the relay.
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
