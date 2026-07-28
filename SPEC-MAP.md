# SPEC-MAP.md — Landfall layers, rendering, and basemap

**This is §7, §9 and §11 of the Landfall spec.** What is drawn on the globe, how
it looks, and what it is drawn on top of.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered.
> Fences ("do not re-propose X") live in SPEC.md's SETTLED list, one line each.
> **Section numbers are permanent addresses.** ~950 code comments cite them.
> A section may move between files; it may never be renumbered.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact we haven't tested.

---

## 7. Layer model

- **Baseline** (always drawn): storm markers worldwide; on selection — past
  track, forecast track, Saffir-Simpson forecast points, watch/warning coastal
  segments.
- **Mutually exclusive pairs** (siblings fighting for the same map space, one
  draws at a time): current-position wind field ↔ full-track wind swath;
  watch/warning stripe ↔ surge bands; satellite ↔ radar.
- **Additive toggles**: cone of uncertainty; forecast point date/time labels;
  model spaghetti tracks; home marker and readouts; tropics & equator.

**A layer is something DRAWN ON THE GLOBE.** Advisory text is prose, draws
nothing, and is per-storm while every other row is map-wide — it lives in the
storm drawer (§16), not in the layers panel.

- **The layer system takes an arbitrary number of layers. There is no cap.** Each
  layer declares its own type — baseline, pair member, or additive. Adding one
  later means adding a definition, not touching the engine.
- **Fetching layers fetch only while switched on; results cached per (storm,
  advisory).** The gate is the TOGGLE, not the tap — model tracks are warmed for
  every storm while their toggle is on, so selection is instant.
- **Cache failures, and let re-toggling clear them.** A dead layer must not
  refetch on every render; re-toggling means "try again."
- **Bound every cache.** Per-storm geometry and imagery frames both accumulate.
- Layer choices persist per device (localStorage). **Storm selection does not** —
  reopening the app restores layers and drops you on the globe, not on yesterday's
  dissipated storm.

### 7.1 The layers panel

Two groups. Group headers are real `<h2>`s so screen-reader users can jump by
heading; headers are not focusable, rows are.

```
STORM DETAIL
  Wind field ─── [ Off | Current | Full track ]    segmented, default Current
  Coastal    ─── [ Off | Watch/warning | Surge ]   segmented, Surge dimmed
  ▸ "Surge coming soon."
  Imagery    ─── [ Off | Satellite | Radar ]       segmented, default Off
  ▸ "Radar only reaches storms near land. Satellite is worldwide."
  Forecast times                      [ ○ ]   default ON
  Cone of uncertainty                 [ ○ ]   default ON
  Model tracks                        [ > ]   expands in place

REFERENCE
  Home marker                         [ ○ ]
  State names                         [ ○ ]
  Cities                              [ ○ ]
  Tropics & equator                   [ ○ ]   ships OFF, last in the group
```

- **Exclusive pairs are segmented controls, never two toggles.** Two toggles imply
  both-on is possible; a segment shows one is chosen.
- **Every pair carries an `Off` segment.** With several storms active the thing
  you want is often neither sibling; "pick which of these you cannot switch off"
  is not a choice a decluttering control should force. An `Off` segment is always
  `phase: 1` with a **null key** — drawing nothing has shipped since the first
  commit and no source can fail to deliver it, and a real phase would let
  `pairLiveOptions` dim the one segment whose whole job is to be reachable.
- **A manifest entry is not a wire. When a pair is declared, something has to
  answer `setPair`.** A layer registered without a `pairId` while the manifest
  declares a pair around it produces a control that drives nothing, with no error
  anywhere. Same shape as a toggle whose layer has no `engineKey`: switch flips,
  data loads, features build, layer stays hidden.
- **Every row shows its own state**: loading (spinner in row), error (row amber,
  named — "Surge unavailable"), unsupported (row dims, "Not available for GDACS
  storms" — this is what §4's `can` block is for). **Re-tapping an errored row is
  the retry.**
- **Rows dim, they never disappear.** A missing toggle looks like a bug; a dimmed
  one with a reason is information.
- **The storm-detail group dims entirely with no selection**, header subtitle
  "Select a storm." Don't hide it — knowing those layers exist is the point.
- **Model tracks expands in place**, never pushing a second panel (§16 allows one
  panel at a time). Rows carry their §6 swatches, grouped consensus / globals /
  hurricane-specific — **the grouping is spacing only, no headings.**
- **The selected segment is a raised chip, not a darker patch** (`--seg-active` /
  `--seg-active-edge`). A segmented control whose selection cannot be read has
  failed at its only job.
- **Reset to defaults** at the bottom. After toggling six things during a landfall
  you will want it.
- 44 px rows; the whole row is the hit target, not just the switch.
- The pref key for the tropics row stays `graticule` whatever the label says.
  Renaming a pref key silently resets the toggle on every device that has one.

### 7.2 Full layer inventory

Fifteen layers: **four baseline, three exclusive pairs (six layers), five
additive.**

| Layer | Type | Phase |
|---|---|---|
| Storm markers (worldwide) | baseline | 2 |
| Cone of uncertainty | additive (ships ON), ambient at every zoom | 4 |
| Past track (dotted) | baseline, ambient at every zoom | 4 |
| Forecast track (solid) | baseline, ambient at every zoom | 4 |
| Forecast points (SS-coloured, coded) | baseline, ambient at every zoom | 4 |
| Forecast time labels (spoke-placed) | additive, ambient from z4 | 4 |
| Watch/warning coastal stripe | exclusive pair A, ambient from z4 | 4 |
| Surge bands | exclusive pair A | 6 — **not started** |
| Current-position wind field | exclusive pair B | 6 |
| Full-track wind swath | exclusive pair B | 6 |
| Satellite | exclusive pair C | 7 |
| Radar | exclusive pair C | 7 |
| Model spaghetti tracks | additive, per-model sub-selection, ambient, ships OFF | 6 |
| Home marker + readouts | additive | 3 |
| Tropics & equator | additive, ships OFF | 1 |

The planet-band aesthetic is not a MapLibre layer at all — it is the 3D clear
globe's cyan geodesic cage (§9), which crossfades out as the dive hands off to
MapLibre.

**The cone has a toggle and defaults ON.** It is the official forecast envelope
and a storm without one is a dot with no future. What earned it a switch is the
ambient presentation: one cone answers "where is this going", six overlapping
translucent cones are a milky film over the coastline you are reading a track
against. **A layer that is right almost always and genuinely obstructive
occasionally needs a switch, not a demotion.**

**Wind field ships CURRENT, not Full track.** A full-track envelope per storm is
a lot of translucent area on a busy globe and it competes with the cone, which
answers the same question better. Current bands stay tied to a point, so they
read as the storm rather than as weather in general.

**ANY LAYER ON THE MAPLIBRE CANVAS IS MULTIPLIED BY THE DIVE CROSSFADE.** The
canvas sits at opacity 0 below `DIVE.zSpace` and does not reach full until
`DIVE.zHandoff`. A paint ramp tuned in isolation is tuned against a number nobody
sees — a layer whose own ramp peaks in the planet band lands its brightest values
exactly where the canvas carrying them is invisible.

### 7.3 Tropics & equator

Three labelled reference latitudes. **Not a graticule** — a grid where every line
is identical tells you nothing, so the identical lines are not drawn at all.

| Line | Why it earns its place |
|---|---|
| **Equator** | Tropical cyclones do not cross it — Coriolis reverses sign and a storm cannot survive the transit. Also why northern storms spin counterclockwise and southern ones clockwise. |
| **Tropic of Cancer** (+23.43665°) | The conventional edge of the tropics; brackets the warm water these storms are born in. |
| **Tropic of Capricorn** (−23.43665°) | Same, southern hemisphere. A storm crossing one is usually beginning to recurve and weaken. |

- **±23.43665, never 23.5.** That is the measured obliquity of the ecliptic; the
  rounded value puts the line about 6 km from where the tropic actually is.
- **30°N/S was considered and rejected.** Recurvature under the subtropical ridge
  really does tend to happen near it, but it is a rule of thumb that moves with
  the ridge; drawing it as a fixed line claims a precision the atmosphere does not
  have.
- **The lines are LABELLED**, along the line (`symbol-placement: line`, repeated by
  `symbol-spacing`) rather than at a point — a single centred label on a
  globe-spanning line lands in whatever ocean is at the middle of the geometry.
  Names arrive at the basin band, per §9's ladder. **An unlabelled line is
  decoration**: three anonymous horizontals only mean something to someone who
  already knew what they were.
- Mixing an off-step line into an on-step grid produces visibly uneven spacing.
  If a grid ever returns, generate every line from one rule.

### 7.4 The track line — one continuous curved path

`lib/trackline.js`. Past and forecast are two bundle slots and two map layers, but
they are **one storm path** and are built as one. `smoothTracks()` is the third and
last decoration in `forMap()` (§12): **stitch → orient → join → spline → cut.**

- **The past track ENDS on the vertex the forecast STARTS from.** That vertex is
  NHC's first forecast point, which is the current position and the dot everything
  else on screen is anchored to. They share the vertex, so they cannot separate
  however the curve is tuned. Without this the map draws a storm whose history
  simply stops out at sea.
- **The connecting leg is DOTTED, not solid.** The cut is at the forecast's first
  *original* point, so the leg belongs to the past track. The storm has already
  travelled it; drawing it in the forecast's confident white would promote history
  to prediction.
- **No distance guard on the join.** A guard that refuses to connect across a large
  gap silently reverts to the broken picture on exactly the days a feed is behind.
  It always connects; the **silence badge** (§5) is what says the record is old.
- **Neither source guarantees a direction**, and a LineString drawn backwards
  renders identically — a wrong assumption here would never surface until the
  connector appeared at the wrong end of the world. All four endpoint pairings are
  measured, never assumed.
- **Direction of travel outranks distance at the seam.** A pairing that makes the
  path reverse onto itself (`TRACK_LINE.maxTurnDeg`, 150°) is refused however near
  its endpoints happen to be; among what survives, the smallest gap wins.

**GDACS ships a track as ~30 disconnected segments in intensity order**, with the
`forecast` flag flipping *inside* a class run. They chain because their shared
fixes are the same COORDINATE, matched to `joinEpsDeg`. NHC sends one line and the
stitcher is a no-op there.

**===> RUNS THAT WILL NOT CHAIN STAY SEPARATE. NEVER FORCE THEM. <===**
Concatenating leftovers by nearest endpoint reached glass: a past-track slot
holding two descriptions of the same history, joined tail to tail, drew as a
**lens** — two dotted arms leaving the current-position dot, bowing apart, closing
at the far end. A journey the storm never made, with nothing errored.

**It cannot be rescued downstream.** A fold of two near-parallel copies turns only
about **120°** at the seam, inside the range a genuine sharp recurve reaches. Any
threshold low enough to catch it would cut real tracks. **The only safe move is
not to build the fold.** An unassemblable track draws as separate features in the
same slot — exactly how it drew before this module existed, which is the floor
this feature has to clear. The longest chain is the one the forecast joins.

**"Always connect" applies to the past→forecast seam, NOT to unrelated pieces.**
One closes a gap between two things known to be the same journey; the other
invents a journey.

**The curve: centripetal Catmull-Rom, `alpha` 0.5.** It passes exactly through
every published fix — **we never move a reported position** — and only the space
*between* fixes changes. Centripetal because uniform Catmull-Rom overshoots and
can loop back where the direction change is sharp, which on a storm track is a
recurve: the one moment somebody is actually watching. At 0.5 a cusp is
mathematically impossible. **`TRACK_LINE.alpha` is not a roundness dial** — raise
it toward 1 (chordal) for a tighter line, never lower it.

**Splining ACROSS the seam is the point.** Smoothing the halves separately leaves
a kink exactly where the eye is looking. One curve through both carries the
tangent through the current position. Measured: under 12° of heading change across
the join.

**Is a curve honest?** A straight line between two 6-hourly fixes is exactly as
invented as a curve, and a storm carries momentum. Neither is a claim about where
the eye was at 03Z. The curve is the better guess, not a decoration.

**The forecast line stays well inside the cone** — measured, at most 15.4 nm from
the straight chord on a classic recurve, against cone half-widths of ~68 nm at
48 h. **The cone is drawn as NOAA published it**: their polygon, their water,
unbent. `[DECIDE]` whether to rebuild the cone by sweeping the recovered radii
along the curved spine — deferred, because bending a federal uncertainty product
changes the answer to "is my town in the cone".

**Planar frame and the antimeridian.** Longitude is scaled by cos(latitude) before
splining and unscaled after. Every distance uses a **wrapped** longitude delta, so
a run published either side of 180° still chains; output longitudes are
deliberately left **unwrapped**, which is what MapLibre needs to draw a continuous
line across the seam. The first vertex keeps its source longitude.

**Order matters: this runs AFTER silencing.** A silent storm has no forecast slot
left, so it gets a smoothed history and no connector — right, because the leg
joining the two is a claim about where the storm is *now*.

**Failure is pass-through.** Cosmetic geometry; anything unexpected returns the
bundle untouched with a console warning. A straight track is a worse picture, a
missing track is a §5 bug.

**Cost, measured:** a mature storm (45 past fixes + 7 forecast points) becomes
353 + 73 vertices in 0.38 ms. Ten storms on an ambient repush is ~3.8 ms, and it
runs on data changes, never per frame. `TRACK_LINE.maxVertices` caps a
pathological track at a coarser line rather than the frame budget.

**A console line names any storm whose track will not assemble**, with run and
chain counts for both slots.

**OPEN: why does a past track arrive in pieces at all?** Observed on a live NHC
storm and never explained. Drawing the pieces separately is correct and safe, but
if NOAA is publishing two descriptions of one history there is probably a right
one to pick. The console line is the measurement to take next time it happens.

### 7.5 Forecast point date/time labels

- **Default ON.** "When does it get here" is the second question after "how bad is
  it", and a cone without times is just a shape. The toggle is for decluttering,
  not because times are optional.
- **Pure render toggle — fetches nothing.** The times ride along in the forecast
  points GeoJSON already being pulled, so this row can never go amber.
- **Ambient, not selection-only**, from `ZOOM.ambientGeometry`. The toggle covers
  both the ambient and the selected label layers — one that silenced only the
  selected storm would read as broken.

**Time fields on forecast points, measured live:**

| Field | Example | What it is |
|---|---|---|
| `datelbl` | `"11:00 PM Thu"` | Pre-formatted, **basin-local, zone NOT stated** |
| `fldatelbl` | `"2026-07-23 8:00 PM Thu HST"` | Long form, basin-local, zone stated |
| `timezone` | `"HST"` | The zone the two labels above are in |
| `validtime` | `"24/0600"` | **DD/HHMM in UTC** — the only unambiguous time |
| `advdate` | `"1100 PM HST Thu Jul 23 2026"` | Issuance, carries month + year |

- **`datelbl` MUST NOT be rendered.** Basin-local with no zone marker, so an East
  Pacific storm labels itself in HST and a viewer four zones away reads it as their
  own time. Silent, plausible, and wrong.
- **`validtime` is the source of truth**, and it is NOT epoch ms. `DD/HHMM` UTC
  with no month or year; those come from `advdate`.
- `lib/time.js`'s `parseNhcValidtime(validtime, advdate)` handles month rollover in
  **both** directions — forward for taus crossing month end, backward for a tau-0
  synoptic time behind an issuance on the 1st — by trying the day in the
  previous/same/next month and taking the candidate nearest the advisory date. A
  winner more than 10 days out is a mis-parse and returns null.
- `data/nhc-mapserver.js` stamps the result as `_time` (epoch ms, or null) at fetch
  time. `normalizeForecast()` and the label layer both read that **one parse**, so
  closest approach and the drawn labels can never disagree about what time a point
  is.
- **A point whose `validtime` will not parse shows NO label** rather than a wrong
  one. A visible gap is the honest outcome.
- Render through `formatClockDay()`, which formats via `Intl` against the device
  zone.

**`9999` IS A NULL SENTINEL, NOT DATA.** Seen on `mslp`, `tcdir` and `tcspd` for
every forecast point beyond `tau=0`. It is finite, so it survives an `isFinite`
check and renders as "Pressure 9999 mb" — the same class of failure as an
out-of-range latitude. The geometry parser MUST map 9999 to null so §16's "nulls
are omitted, not zeroed" rule holds. It does not appear in `CurrentStorms.json`,
so this belongs in the geometry parser only.

**`ssnum` is the Saffir-Simpson number, stated per point.** Do NOT derive category
for forecast points; NHC gives it. Also present per point: `maxwind`, `gust`,
`mslp`, `tau`, `tcdvlp`, `tcdir`, `tcspd`, `validtime`.

**Spoke placement** (`map/layers/label-placement.js`). Each label starts just
outside its dot and runs outward, so extending any label lands on its own dot.

**Three rules, all hard:**
1. **ONE ANGLE PER STORM.** Every label on a track is drawn at the same tilt. Only
   the DIRECTION a label runs from its dot varies — that is the side — and because
   the two directions are 180° apart while the tilt never exceeds 45°, both resolve
   to the SAME `text-rotate`. The side is a left or right anchor with a negated
   offset. The value MapLibre receives is literally identical for every label on a
   storm.
2. **THE SHALLOWEST ANGLE THAT FITS WINS.** The search starts at 0 — dead
   horizontal — and works outward in `tiltStepDeg` steps, taking the first angle
   that places every label cleanly. A steeper tilt has to EARN it: it wins only by
   showing more labels, or the same number with fewer side changes. Never on
   balance.
3. **`maxTextTiltDeg` = 45 is a ceiling, not a preference.** Past it labels stop
   scanning as text.

Measured on three live storm shapes: a diagonal track and a due-north track both
place at 0°; only a due-west track, where every label would land at the same
height, has to lean (−25°). **The angle is NOT derived from the track** — the
perpendicular at each point fans the labels and puts near-vertical text on a
westward storm. Legibility won.

- **How it reaches MapLibre**, verified by reading the bundled 5.6.0 source:
  `text-rotate`, `text-anchor` and `text-offset` are all property-type
  `data-driven`, and the rotation matrix is applied to glyph positions that ALREADY
  include the offset. So `text-offset: [g, 0]` with `text-anchor: 'left'` and
  `text-rotate: θ` puts the START of the text `g` out along `θ`. **The whole
  approach rests on that one detail.** `text-rotation-alignment` is `viewport`;
  `text-max-width` 30 ems rules out a wrap, which would break the one-line geometry.
- **`spokeStartPx` is the distance to the NEAR END of the text, not its centre.**
  As a centre it puts an 80 px label 26 px sideways from its dot, straddling it,
  with the text landing on the glyph.
- **Labels avoid other DOTS, not just each other** (`dotClearPx`). A shallow angle
  can lay text straight along the track and through the next forecast point, which
  label-against-label collision cannot see. That test is written against the text's
  **ink**, not the padded collision box — counting padding as ink throws away
  clearance the label genuinely has (measured: nine labels cut to two).
- **Collision boxes are ORIENTED, tested by separating axis.** An axis-aligned box
  around a 45° label is a 74×74 square around a strip that is really 86×19, and two
  neighbours on a diagonal track then "collide" across a clear 70 px gap (measured:
  eight labels cut to four).
- **The side arrangement is chosen whole, not label by label**, inside each angle.
  A label's side is a property of the RUN it belongs to. Placement tries all on one
  side, then every single split point, then every pair; `maxRuns` stops there,
  because a fourth group on a nine-point track is two labels long and that IS
  alternating. Ranked by fewest groups, then the evenest split. Anything that still
  will not fit is hidden, never flipped out of its group; thinning protects the
  first and last points, and `minKeepFraction` stops tidiness from gutting the
  forecast.
- **Cost:** 0.002 ms when labels fit at 0° (the common case, stops on the first
  pass); 1.8 ms worst case. **Recomputed on `moveend`, debounced, never per
  frame** — screen positions change every frame during a drag, and re-placing per
  frame on a phone is the frame budget gone. Accepted cost: during a hard rotate
  labels hold their last offsets and can look briefly stale.
- All tuning lives in `LABEL_PLACEMENT`.

**Three MapLibre dead ends, kept so nobody re-treads them:**
- **MapLibre cannot place a spoke on its own.** `text-optional` only hides
  collisions; `text-variable-anchor` only tries a fixed menu of anchors. Neither
  derives a per-point axis nor balances a split. Placement is computed in screen
  space and handed over per feature.
- **`text-translate` has no data-driven styling at all** — a `['get']` there is
  silently ignored.
- **`text-radial-offset` only pushes along ONE axis** (outward in X for a
  left/right anchor, in Y for top/bottom), so a diagonal anchor gives an
  axis-aligned push. **It must stay absent — it disables `text-offset` outright.**

`[DECIDE]` whether a five-day track at z4 is still too dense; if so thin to 24 h
intervals rather than culling.

### 7.6 Model spaghetti tracks

What the layer answers is a different question from every other layer: not "where
is the storm going" — the cone answers that — but **"how much do the forecasters'
own tools disagree about it."** A tight bundle and a wide fan produce the SAME
official cone, and until this layer the two were indistinguishable on screen.

- **Per-model selector, not one on/off switch.** Five models at once over a cone is
  a hairball; the useful question is usually "where does GFS depart from the
  consensus", which needs two on and three off.
- **Four selector rows for five techs.** TVCN and HCCA share one slot, one colour
  and one pref (`consensus`): the same consensus answer under two names, never
  drawn together, and a user who switched Consensus off must not have it return
  under the other name when TVCN drops out of a cycle.
- Shortlist carries named identity colours (§6); anything beyond it draws from
  `MODEL_FALLBACK_RAMP` by position, so a model added without a hex still draws
  distinctly and never silently borrows a named model's.
- Selector rows carry their own swatches, so the legend and the control are the
  same object.
- **Selection persists per device INSIDE the layer record**, not in a store of its
  own. Which models draw is a sub-choice of a layer, and a THIRD preference store
  is the moment to extract a shared factory (§12).

**SHIPS OFF, the only fetching layer that does.** Guidance is an expert read; a
stranger arriving by shared link mid-storm is asking where it is going, not how
confident the forecaster is. The off default also gates the warming, so a
first-time visitor pays nothing for it.

**AMBIENT ON EVERY STORM**, like the wind field and the cone. **A layer the user
turned on and then has to tap a storm to see is not a layer, it is a detail popup
wearing a toggle.** A layer switch is a statement about the whole map. The two
presentations render identically, so selection changes which source a storm's
lines ride and nothing about how they look — a data split, never a visual
difference. `onDeckLanded` pushes BOTH the selection and the ambient copy, always,
so there is no branch to get wrong.

**WARMED FOR EVERY STORM, ON APP LOAD, WHILE THE TOGGLE IS ON.** Not fetched on
selection and not gated on zoom. Warming runs one storm at a time
(`MODEL_TRACKS.warmConcurrency`) — warm-ahead detail nobody is waiting on should
be the politest thing on the connection. This is what forced the relay's row filter
(§4).

**DASHED AND THINNER THAN BOTH TRACKS, and that is the grammar.** Forecast solid
at 1.75, past dotted at 1.5, guidance dashed at 1.1 and drawn UNDER them (order 18,
below the tracks at 20/30). **A model run is an INPUT to NHC's forecast, not a peer
of it**; drawing it at the forecast's weight promotes a raw model to the status of
NHC's judgement — a lie about authority that reads as authoritative precisely
because it looks official. The dash is longer than the past track's dots on
purpose: at the zoom where both appear, `[1,2]` and a short dash become the same
grey texture.

**Coverage is a FILE limit, not a data limit.** `ftp.nhc.noaa.gov/atcf/aid_public/`
contains only `al`, `ep` and `cp`. GFS and UKMET are worldwide models and forecast
typhoons perfectly well. Non-NHC basins are served from UCAR's Tropical Cyclone
Guidance Project (§4). **Stating a source-coverage limit as a data absence is §5's
failure with the blast radius of a forecast**: "we cannot reach the file for that
ocean" and "no model on earth is forecasting this typhoon" are wildly different
claims.

`[DECIDE]` whether to fade guidance past ~72 h so the near-term cluster — the
actionable part — reads first.

**`[VERIFY]` ambient legibility with a full basin up.** Five models across nine
storms is forty-five crossing lines; whether that reads as a spread or as noise at
phone width is unmeasured. If it turns the map to soup the fix is a floor keyed off
`ZOOM`, one constant. Also unmeasured: the real payload and parse cost of a mature
deck on a phone (the filter is measured on synthetic input only), and whether
warming nine decks is felt on a cell connection.

### 7.7 Watch/warning coastal paint — wide-band coast select

NHC publishes these as **breakpoints** (named coastal reference points), not as
coastline. Drawn naively, a warning covering Tampa Bay renders as a straight chord
slicing across open water. Measured live: 11 vertices over 464 km, median spacing
51 km, breakpoints a median 0.85 km from the drawn shoreline.

**As built: the coast inside the warning is PAINTED by band select.** The
breakpoint polyline is buffered into a corridor of half-width
`COAST_BAND.halfWidthKm`, every loaded coast segment inside the corridor is
selected, and those segments — the same vertices the coastline is drawn from,
restroked wider — are painted the §6 warning colour. No snapping, no walking, no
stitching, no winding: a segment is in the band or it is not.

**INTENT — wide and inclusive on purpose.** Aaron, verbatim: *"I WANT it to catch
all the little bays and islands. This is a warning to the area. They are in the
area. We can cast a wide band."* A watch/warning is issued for an AREA; every bay,
inlet and barrier island inside it is under the warning, so over-inclusion near the
line is desired behaviour. Inside the warned area there is no "wrong" coast to
avoid — only coast in the band or out of it.

- `map/coast-source.js` — the ONLY schema-aware file. Resolves Protomaps `earth` or
  OpenMapTiles `water`/ocean and returns rings of `[lon, lat]`. Flipping
  `TILES.useR2` changes the answer there and nowhere else. **Winding never
  matters:** the band asks membership, not direction, so a schema that fragments
  the coast into separate rings just yields more rings.
- `map/coast-band.js` — pure `[lon, lat]` math, schema-blind. Corridor test in a
  local planar km-space, **flat end caps** (the first leg rejects projections before
  its start, the last past its end), so the band is capped at the perpendiculars
  through the first and last breakpoint. Interior breakpoints keep their full round
  joins, so where spacing < W the band legitimately reaches a little past an end cap
  — within W of a warned breakpoint IS the area.
- **Tile-boundary filter.** The ocean polygon's ring is part real shoreline and part
  straight tile edge; a kept tile edge paints a straight seam across the map. A
  segment is dropped when EXACTLY axis-aligned (within `tileEdgeEpsDeg`) and at
  least `tileEdgeMinKm` long. **A false drop costs an invisible sub-km gap in a
  thick stripe; a false keep costs a visible seam — err toward dropping.**
- `map/coast-band-cache.js` — keeps the BEST select per storm, re-selects on
  debounced `moveend`. **Coast comes from LOADED TILES ONLY**, so a naive re-select
  would degrade as you zoom out; a select may only improve (painted features, then
  painted km, then vertices). Invalidated by advisory stamp.
- **Severity stacking.** Overlapping products (a Hurricane Watch atop a Tropical
  Storm Warning) paint the same coast; `line-sort-key` via `wwSortKey()` makes the
  severer colour win the pixels — §6 safety contract.
- **Fallback keeps NHC's chords, flagged `_banded: false`** with a reason
  (`no-coastline` / `no-coast-in-band` / `not-a-line`). Official geometry isn't ours
  to curve, and no coast loaded in the corridor is `unavailable` (§5), never "no
  warning here".
- **The legend dedupes by type** (`wwLegend`). One warning paints several coast runs;
  iterating naively stacks five identical rows.
- **`tcww` is the field carrying the TCWW code.** `lib/watchwarning.js` reads it
  directly and keeps a value-scan only as a fallback, because a scan over every
  property could match a stray "HWR" in a descriptive field and paint the §6 safety
  colours wrong.

**`W` = 50 km, picked off a live prototype** against real breakpoints: 15 km caught
only half of Galveston Bay; 35 km painted the full Galveston–Trinity–Sabine system;
50 km also reached the inner Matagorda Bay shore. Wider won. Flat caps held at every
width — the unwarned coast east of the last breakpoint never painted. `[VERIFY]` W
against the real tile coast on glass; it is one constant.

**Recolouring the drawn basemap coastline is NOT possible.** The rendered coast is
the edge of an ocean POLYGON, one feature covering a huge area. MapLibre's only
mechanism for restyling part of a vector-tile layer is `feature-state`, whose unit
is the WHOLE FEATURE; there is no way to address the portion of a polygon's edge
between two points. Recolouring it would recolour every coast in the tile.
(OpenFreeMap's ocean polygons also carry no stable id for `promoteId`.)
