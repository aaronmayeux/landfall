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
carries three things the basemap cares about: `map`, a set of colour overrides
keyed exactly as `map/style.js` reads them; `graticule`, whether the world draws
the three reference latitudes at all; and `plates`, the plate boundary colours
or `null` for a world that draws none (§43.2). `buildStyle({ palette })` layers the
overrides onto the live theme palette; `createGlobe(container, { palette })`
forwards them so a world never installs a style it is about to replace. Deep
(`config/worlds/deep.js`) overrides all fourteen basemap colours and draws no
graticule; Sky (`sky.js`) overrides nothing, which is how it stays the only
world that follows light and dark mode.

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
55 KB gzipped — renders as a glowing seam network.

**This is what makes the world explain itself.** Earthquakes cluster on plate
edges; showing the cracks and firing the ripples off them turns a field of dots
into a diagram of why. One line layer, one draw call.

**THEY ARE DRAWN TWICE, BECAUSE ONE RENDERER CANNOT COVER THE ZOOM RANGE.** The
Three globe's seams and MapLibre's `plate-glow`/`plate-core` are the same lines
from the same file (`GLOBE.plateBoundariesUrl`), pixel-locked by
`map/globe-follow.js`, with the dive crossfade handing one to the other — the
arrangement the coastline has always used. The seams leave on `DIVE.fade.land`,
the band that ends exactly where `mapIn` brings MapLibre to full.

That pairing is the whole point and getting it wrong is invisible from the code.
The seams rode `DIVE.fade.cage`, which runs to dive phase 0.62 — about **z3.9** —
and nothing below it drew plate boundaries at all, so they sharpened as the
planet grew and then simply stopped, with five zoom levels of nothing after.

**A world's `plates` is its colours AND its manifest**: an object turns the
layers on, `null` means the world draws none, so there is no second flag that
can disagree with the colours. They sit BENEATH the coastline, like the borders
and the graticule — a reference line crossing over a glowing coastline reads as
an error. No world currently draws both these and the graticule; their relative
order is undecided rather than decided wrong.

**Told apart from the coastline by three channels, not one.** Deep paints them in
the app's own glow cyan, 98° from that world's orchid coastline — but the two sit
within 1.27:1 in LUMINANCE, so hue is very nearly all that separates them, and
cyan-against-magenta is a hard pair for red-green colour blindness. Width
(`SIZE.plateWidthScale`) and opacity (`OPACITY.plate*`) carry the rest.

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

**THE 3D SEAMS ARE 1px AND CANNOT BE WIDENED.** WebGL renders `LineSegments` at
one pixel whatever the material asks for, so from space the plate network is a
hairline mesh and on the map it is a wide band. The coastline has the same split
(1px in Three, a 3.5px glow in MapLibre) and reads fine, but the plate gap is now
larger. If the transition ever pops, the fix is on the Three side — a second
offset pass, not a narrower band.

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

### 42.1 The plume budget is ~25, not 500

> **Numbered 42.1, filed under Deep.** Section numbers are permanent
> addresses (the rules at the top of this file), so a section that moves
> between worlds keeps its number rather than breaking every pointer at it.

The shipped catalog holds **1,196 volcanoes**, 508 of them with an eruption since
1800, each carrying summit elevation from −5,700 m to 6,879 m so a plume anchors
at true altitude. Drawing all of them is one instanced point cloud and one draw
call, so the catalog size is not a constraint.

**Only ~22–27 are erupting at any given time** — 22 items in the Smithsonian
weekly report, 5 elevated US volcanoes from USGS HANS. That is the emitter count,
and it is small enough to afford real detail per plume.

**110 of the catalog are submarine and get a different treatment** — a subsurface
glow and water disturbance, never an ash column above the sea.

**Plume height and drift direction are published values, not invented ones.**
21 of 22 weekly reports state a measured height in prose, most also a drift
bearing (SPEC-HAZARDS.md §22.4). On-screen height and lean can both be true, and
that is what separates this from decoration.

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
