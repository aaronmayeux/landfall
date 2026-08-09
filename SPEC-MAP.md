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
  City names                          [ ○ ]
  Tropics & equator                   [ ○ ]   ships OFF
  Population                          [ ○ ]   ships OFF, the only row that fetches
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
- **A `setPair` hook reports whether the segment actually MOVED**, by returning
  `true`; anything else is read as a no-op and the engine skips the ambient
  re-merge. `applyLayerState()` pushes every pair on every layer change and on
  every selection, so most pushes carry the value the layer already holds — the
  engine used to re-merge for each of them, which meant one tap on a storm ran
  the merge three times and re-derived the coastal band three times. A layer
  that writes its own sources on a segment change (watch-warning: `key` never
  moves) returns `false`; a layer that re-points `key` at a different bundle
  slot (wind-field) returns `true`, because only then does the merge produce a
  different answer. `tools/test-recompute-budget.mjs` holds the count at zero.
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

Eighteen layers: **four baseline, three exclusive pairs (six layers), eight
additive.**

| Layer | Type | Phase |
|---|---|---|
| Storm markers (worldwide) | baseline | 2 |
| Cone of uncertainty | additive (ships ON), ambient at every zoom, redrawn along the track (§7.9) | 4 |
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
| State names | additive, basemap furniture | 1 |
| City names | additive, basemap furniture | 1 |
| Tropics & equator | additive, ships OFF | 1 |
| Population heat | additive, ships OFF, fetches | 1 |

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
  NHC's first forecast point — the ANALYSIS position (tau 0), which is where the
  history hands over to the prediction. They share the vertex, so they cannot
  separate however the curve is tuned. Without this the map draws a storm whose
  history simply stops out at sea.
  **It is NOT the current position, and this line used to say it was.** Current
  position is `latitudeNumeric`/`longitudeNumeric` and is what the glyph draws;
  tau 0 is the synoptic analysis time, up to three hours and ~40 nm behind it
  (SPEC-DATA §4). The two are close enough to look like one thing on a globe and
  are not one thing. The white ring in §7.5 marks tau 0 — the start of the
  forecast — and must never be described as marking the storm's position now.
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

**Order matters: this runs AFTER silencing.** A silent or ended storm has no
forecast slot left, so it gets a smoothed history and **no connector to a
forecast** — right, because the leg joining those two is a claim about where the
storm is *going*.

**It DOES get a leg to the last known position**, which is a different claim and
one the source made: that is where the storm was when somebody last looked, and
it is exactly where the grey X is drawn. `smoothTracks` takes the coordinate as
its third argument — the same `storm.lon/lat` `map/markers.js` builds the X from,
passed in rather than dug out of the bundle so the two cannot drift. For a LIVE
storm the leg comes free (the forecast begins at tau-0 and `orient` turns the
past around to meet it); emptying the forecast took the connector with it and
left the dotted trail stopping short of its own mark with open water between
them. Found on glass.

**The chain has no direction, so the anchor goes on whichever end is nearer** —
`stitch` may hand a track back either way round, the same reason `orient` exists.
**And there is a distance cap** (`TRACK_LINE.anchorMaxDeg`, 10°): past it the leg
is refused and the console says so. A bad parse or a longitude on the wrong side
of the antimeridian would otherwise draw a confident line across an ocean nothing
crossed — inventing a track, which §5 forbids more strongly than a missing one. A
gap a reader can see beats a line they would believe.

**The vertex budget is SHARED EVENLY ACROSS THE LEGS, never spent front to back.**
It was a running total each leg drew down until it hit zero, so a path with more
legs than budget came out smooth at the start and dead straight at the end with one
hard corner where the money ran out. On a guidance run under a tighter cap that put
the elbow mid-track and left the whole outer half — the part that fans out, which is
the entire reason the layer exists — drawn exactly as it was before smoothing. It
also flattened the freshest end of a mature storm's official track, which nobody had
noticed. Every leg is equally entitled to the curve.

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

### 7.5 Forecast point dots, and the ring that says which way

**Every forecast dot wears a dark ring (`geo.pointStroke`, 1.5 px) except the
earliest one of each storm, which wears WHITE at 3 px
(`geo.pointStrokeFirst` / `pointStrokeWidthFirst`). White in BOTH themes, with
nothing behind it.**

**A dark casing under that white ring was tried and reverted on glass
(2026-08-08).** The measurement said it was needed — white sits at 1.72:1 over
the greyscale sea and 1.13:1 over the near-white land — and the result read as
a BLACK-ringed dot in both themes, because the outermost edge is what the eye
calls the stroke. In the dark theme it was worse than pointless: the casing was
the same near-black every other dot already wears, so the marked dot stopped
looking marked. Do not re-add it. If the ring ever needs more presence the lever
is the background — a slightly deeper `LIGHT.ocean` or `land` — not another
layer wrapped around the dot.

**The contrast requirement is deliberately absent.** Ring-against-terrain prints
in ADVISORY only; requiring it is exactly what would force the ring dark, and
the ring is white because its job is to differ from its NEIGHBOURS.

**Equalising the two widths was tried and reverted on glass (2026-08-08),** on
the reasoning that the extra width read as a bigger dot rather than a marked one.
Side by side it read worse — at 1.5 px the white stops carrying at a glance.
Settled; do not re-run it.**

**The ring's job is DIRECTION, and it is the only thing on the dot chain doing
that job.** Category colour cannot: a track running Cat 1 → 2 → 2 → 1 is
symmetrical to the eye, so without a marked end the reader has to already know
which way cyclones travel in that basin to tell the forecast from the history.
The dotted past track answers the same question at map zooms where the whole
track is in frame; the ring answers it when it is not.

**It is stamped PER STORM, never per collection** (`stampFirst`,
`map/layers/points-forecast.js`). The ambient source carries every live storm in
one FeatureCollection, so a per-collection "first" would ring one track, leave
the rest bare, and let upstream ordering decide which. Grouping is `stormKey` —
the same grouping, for the same reason, as the label spokes.

**Order is lowest finite `tau`, falling back to arrival order** when no point in
a storm has one. That fallback is GDACS's live path, not a defensive branch:
GDACS points carry no forecast hour. It matches the label-placement sort
deliberately — if the two disagreed, the ring would sit on one dot while the
spokes fanned from another.

**An unattributable point gets no ring.** Same rule as its label: "the storm
starts here" is a claim, and a dot we cannot tie to a storm cannot support it.

**White in both themes**, like the dark ring is dark in both. It is the contrast
against its NEIGHBOURS that carries the meaning, not agreement with the sky.
**Wider because colour alone is not enough** — at this radius 1.5 px is a
hairline, and a white hairline against a pale Cat 1 fill would vanish into
exactly the case it exists to disambiguate. The stroke grows OUTWARD, so the
fill and the classification code inside it are untouched.

`tools/test-first-point.mjs` asserts the per-storm rule, the shuffled-input
case, the no-`tau` fallback, and the orphan rule.

#### Date/time labels

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
- **The AMBIENT set rides the same debounced path as the camera** — one shared
  timer for both. Ambient placement used to run synchronously inside
  `updateAmbient`, which the layer engine calls on every re-merge (a storm
  warming, a selection opening or closing, a layer pref changing), so it landed
  inside the click handler and showed up as INP. **The SELECTED storm still
  places immediately**: it is one storm's worth of points and it is the thing
  the user just asked for.
- **A label is HIDDEN until it is placed** (`_hide` defaults to `true`).
  Deferring placement with the old default of `false` would draw the whole
  ambient set stacked on its own dots for the length of the debounce. Dots and
  their category codes carry no filter and appear immediately — only the time
  text waits, and a forecast HOUR arriving a tenth of a second after its dot is
  not a §5 silence.
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
- **SMOOTHED, with the same curve the official tracks get** (`smoothPath` in
  `lib/trackline.js`). A model run is a handful of six-hourly fixes, and joined with
  straight segments it read as a folded paper chain beside a forecast track that
  flows — two drawing languages for the same kind of object. The dash, the width and
  the draw order are what say "this is guidance"; the corners were never carrying
  that. The curve begins and ends exactly on the model's own first and last fix.
- **Smoothed in `data/adeck.js`, not in the parser and not at render.** The parser's
  output is what the model said, and a curve is not — smoothing inside `parseAdeck`
  deleted the fixes it had just read, which `tools/test-adeck.mjs` catches by
  counting them. And `tracksToFeatures` runs on every push through the bundle
  pipeline, where this runs once per fetched deck and is cached with it. It must
  follow `unwrapRun`: `smoothPath` deliberately does no unwrapping, because the run
  is already anchored to the storm's own longitude and a second unwrap against the
  path's first point draws a 180°-crossing track a world away.
- **AND IT SITS OUTSIDE THE PARSE'S `try`, PER TRACK.** It shipped inside it for one
  release, which meant a throw anywhere in the smoothing returned
  `status: 'unavailable'` and took the WHOLE DECK with it — every model for that
  storm, behind a retry that would fetch identical bytes and fail identically.
  Cosmetic geometry must never cost data (`lib/trackline.js` says it of its own
  smoothing, `data/jtwc-wind.js` of its enrichment); this is the same rule, and it
  was broken in the one place where the failure is invisible, since nothing on
  screen tells "the smoother threw" from "TCGP files no deck for this storm". A run
  that will not smooth now draws in raw segments and names itself on the console.
- **Guidance gets the SAME resolution as the official tracks.** It had its own
  tighter vertex budget for one release, on the arithmetic that a full basin is
  40-odd of these where official geometry is one. Both halves of that were wrong:
  splining a basin measures at a few milliseconds and runs once per fetched deck,
  and `TRACK_LINE.maxVertices` already bounds a run on its own (`MODEL_TRACKS.
  maxPoints` caps a deck at 32 fixes). What the extra knob did do was draw guidance
  visibly coarser than the tracks beside it — the opposite of the point.

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

**THE NON-NHC BASINS DRAW THREE ENSEMBLE MEANS, AND NOTHING ELSE.** UCAR's TCGP
a-decks for `wp`/`io`/`sh` carry no NHC tech at all — no TVCN, HCCA, AVNO, UKX or
HFSA. What they carry is ensemble MEMBERS, one model run many times from nudged
starting conditions, from three centres: GEFS, NAVGEM and GEPS. Each centre
already publishes its own mean, so **we draw the published mean and never average
the members ourselves** — a second average would be free to disagree with the
plots TCGP shows beside it.

Every exclusion is recorded in `functions/api/tcgp/adeck.js` so none gets quietly
re-added: **`CARQ` is not a forecast** (negative forecast hours — it is the
storm's own past, and drawn as guidance it would paint history as prediction);
**CHIPS is an intensity model**, not a track one; **UKMET** is a single run with
no ensemble and lags the rest of the deck; **`CMC` and `NGX`** are the
deterministic runs of two centres already represented by their means.

**The id join is one function and a silent slip there fetches a REAL deck for a
DIFFERENT storm.** JTWC's product id is `wp1126`, TCGP's filename wants
`wp112026` — they differ only in the width of the year, and
`tcgpIdFromJtwcProduct()` in `lib/adeck.js` is the single place that transform
lives. **The century is hardcoded deliberately:** deriving it from today's date
is wrong every New Year's Eve for a storm that formed in December.

**"You cannot switch off the last model" is PER FAMILY, not global.** Counted
globally it was correct with one family and a hole the moment there were two — a
user could switch off all four NHC models while three TCGP ones stayed on, the
refusal never fired, and the layer drew NOTHING on the hurricane in front of them
while reporting itself healthy.

**The picker groups by region, with headers only when both families have storms**
— the same rule the storm list uses for basin headings, and for the same reason.
With one family up the control is byte-identical to before. `.model-family-head`
deliberately matches `.basin-head` down to the values; they are one idea in two
places and should be retuned together.

**No accuracy claim is made about any of the three.** Consensus earns one in the
NHC set because NHC publishes verification supporting it; nothing comparable was
obtained for these, and ranking models from reputation is the thing this project
has a rule against. **ECMWF is not in these decks, and the copy says so** —
unstated, three tight Pacific lines read as a better-understood storm than four
spread Atlantic ones, when the real difference is a thinner SOURCE.

**UCAR says TCGP is not an operational service** — not maintained 24/7, outages
without warning. It will be down more often than NOAA, which is exactly what the
`none` / `unavailable` split exists to keep from reading as "no models are
forecasting this storm."

**THE ROW REPORTS A PARTIAL FAILURE, NOT ONLY A TOTAL ONE.** `statusForAll()`
used to fall silent the moment ANY storm's deck was ok, on the reasoning that
something was drawing. With two independent families that is backwards: "some ok,
some broken" is the *normal* shape of an outage here — TCGP goes down while NOAA
stays up — and it was the one shape guaranteed to be swallowed. A row that only
speaks when everything is broken cannot report the failures that actually happen.

A partial failure reads **"Model guidance unavailable for some storms — tap to
retry"** and keeps the retry, unlike the coverage cases: decks that already
loaded prove the network is fine, so the ones that failed have a real chance of
succeeding. A deck merely still in flight, or a basin nobody files one for, does
NOT interrupt a row that is drawing real guidance — those are coverage
statements, not faults.

**LONGITUDES ARE UNWRAPPED, ANCHORED TO THE STORM.** ATCF writes every position
inside −180..180 with a hemisphere letter, so a model carrying a storm across the
dateline publishes −179.5 and then +179.0 — half a degree apart on the water, 359
apart as numbers. `unwrapRun()` in `lib/adeck.js` makes each run continuous and
lets it pass ±180, which is what MapLibre needs to draw across the seam and the
same contract `lib/trackline.js` keeps for the official tracks. The run is
anchored to the storm's own longitude, not to its first point, because the
back-half clip and the anchor vertex both compare model positions against the
current position and those comparisons are meaningless across a 360° gap.
**Not split into two features** — a split leaves a visible hole at the seam and
gives the layer two answers to one question.

`[DECIDE]` whether to fade guidance past ~72 h so the near-term cluster — the
actionable part — reads first.

**Ambient legibility holds with a basin up** — crossing model lines read as a
spread, not as noise, at phone width (confirmed on glass). No `ZOOM` floor is
needed. The deck filter's reduction is still measured on synthetic input only,
which is a number nobody has checked, not a legibility risk.

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
  **The decode is memoized per substrate generation.** `querySourceFeatures`
  re-walks every loaded basemap tile on the main thread, and the rings can only
  change when the tile set does — so a counter bumped by the map's own
  `sourcedata` (for `basemap`) and `styledata` events is an exact invalidation
  signal, not a staleness tradeoff. `coastGeneration(map)` exposes it so a
  caller can ask "has the coast moved?" without paying for a decode to find out.
  Per-map in a `WeakMap`, so a replaced map takes its rings with it. The
  returned object is shared within a generation — **nobody may mutate it.**
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
  **A held result also records the coast generation it beat**, so an identical
  stamp on an identical substrate returns immediately without a ring decode or a
  band select — the same answer `better()` would have reached the long way. The
  generation advances on the held entry whenever it survives a real contest, or
  no coast is loaded to contest it, so the early-out keeps firing for the common
  case of a storm whose first select was already its best.
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
width — the unwarned coast east of the last breakpoint never painted. Confirmed
against the real tile coast on glass; it is one constant if it ever needs moving.

**Recolouring the drawn basemap coastline is NOT possible.** The rendered coast is
the edge of an ocean POLYGON, one feature covering a huge area. MapLibre's only
mechanism for restyling part of a vector-tile layer is `feature-state`, whose unit
is the WHOLE FEATURE; there is no way to address the portion of a polygon's edge
between two points. Recolouring it would recolour every coast in the tile.
(OpenFreeMap's ocean polygons also carry no stable id for `promoteId`.)

---

### 7.8 Population heat — where people are

A heat field over 107,464 towns of 1,000 people or more, built from GeoNames
(`assets/hazards/population-towns.json`, SPEC-DATA.md §4.15). Reference group,
**last row in the group**, **ships OFF**, and the only row in that group that
fetches — every other Reference row is a free style switch on tiles already
downloaded, so the one that costs a download sits at the bottom.

**It is one hue and the hue is the coastline's.** `populationHigh` equals
`coastGlow` exactly, in both palettes, and a test asserts it — a coastline
recolour has to drag the field with it. Two earlier passes deliberately chose
colours AWAY from the coast; both were rejected on glass. The two read apart by
form, not hue: the coast is a thin bright line, this is a broad soft field that
only reaches full strength over a megacity core.

**Weight is the log of population, never population.** Tokyo is 22,000 times a
small town; fed in raw the ramp is a map of Tokyo. A floor keeps the smallest
town above zero so a scatter of villages still reads as somewhere people live.

> A curve steepening the middle of that range was built, shipped and reverted
> the same session (`3622415`, reverted by `d23d11b`). It measured correctly —
> a 50,000-person town fell from 0.46 to 0.25 — and looked worse. The flatness
> is deliberate now, not an oversight.

**Towns fade in; they never pop in.** The zoom gate is on WEIGHT, not
membership: a town ramps from nothing to full across `fadeWidthLog` as a
sliding threshold passes it. A `step` filter survives only as a performance
guard, set one row ahead of the threshold table so it can never clip a town
mid-fade.

**The blur is anchored to the ground, not the screen.** Pixels double per zoom
to hold ~20 km on the planet. A floor at the planet band keeps a city a
readable dot; a ceiling past the local band bounds heatmap cost, which is per
point and scales with radius squared. Both clamps are deliberate trades.

#### Draw order is the whole answer to two opposite requirements

    ocean fill -> inland water -> POPULATION HEAT -> sea mask -> coast

The sea must cover the heat. Lakes and rivers must not — a lake painted over a
population field reads as water on top of people. Inland water therefore sits
UNDER the heat, and only an ocean-filtered mask sits above it.

**A fully opaque fill cannot occlude a heatmap.** Opaque fills render in
MapLibre's opaque pass, which runs before a heatmap composites its density
texture in the translucent pass with depth testing off. Measured: with the
basemap ocean above the heat and the layer order confirmed correct, 3,491 heat
pixels still showed through the sea; the same fill at `fill-opacity: 0.999`
dropped it to zero. That fraction is load-bearing and is why the value is not 1.

**The coastline cannot do the clipping**, and the question has been asked.
`coast-glow` and `coast-core` are `line` layers, and a line has no inside for a
renderer to fill. Masking needs an area; the only area meaning "sea" here is the
water polygon. Both come from the same shorelines, so they agree — one is the
outline, one is the region.

The anchor is computed from the live style rather than naming a neighbour: the
requirement is the POSITION, and a hardcoded id would break silently back into
"population reads as underwater". On the Protomaps path (`TILES.useR2`, off)
ocean is the background and there is no sea polygon, so the code tests the
ocean layer's TYPE and draws uncut rather than not at all.

**The tile buffer is not a factor.** `buffer: 0` was suspected of causing edge
flicker and measured innocent — heat energy is identical at buffer 0, 8, 64 and
128, at zooms where tiles cut through the data. Do not re-open it without a new
measurement.

### 7.9 The cone of uncertainty — measured, then redrawn along the track

`lib/cone-sweep.js`, orchestrated by `lib/cone-smooth.js`, running as the fourth
decoration in `forMap()`. **It must run AFTER `smoothTracks()`** — it is drawn on
the smoothed track, and run first it would carry the facets of a line that is no
longer drawn.

**The problem.** Sources publish the cone as the circle at day 1, 2, 3, 4 and 5
joined by the lines pulled taut around consecutive pairs. Measured on
`samples/gdacs/geometry-TC.json`, **16 segments longer than ~55 km carry 81.6% of
the outline's perimeter**, four of them 5.2° (≈570 km) of straight edge each.
Drawn under a curved track those legs read as a ruler.

**Two things it is NOT.** Not a spline of the published outline — an
interpolating curve takes its direction from a vertex's neighbours, and along a
570 km leg every neighbour says "straight", so it rounds the nose cap and returns
the legs unchanged. And not a model of what a cone should be — that was tried,
carried an interpolation floor, a lean correction, tangency caps and a sagitta
bound to make the model fit, and refused itself on every storm in production.

**What it does.** Walk the smoothed track at uniform stations. At each one,
measure how far the published outline lies to the left and to the right,
perpendicular to the track. Smooth those two 1-D profiles. Redraw the edges as
track ± width, with half-ellipse caps at each end that leave the flank along the
track so they do not corner where they join.

**Every width is read off the source's polygon.** Nothing about how far the cone
reaches is invented, the two sides are measured independently so nothing assumes
symmetry, and no forecast points are needed. The only deliberate change is where
the width is measured FROM.

**THE BLUR IS WHERE THE BEND COMES FROM, and that is not obvious.** Measure the
width exactly and redraw it and you get the published outline back, kinks and
all — the operation is an identity. Removing the per-leg ripple from the profile
is what lets the edge follow the track instead of the source's straight legs. So
`CONE_SWEEP.blurDeg` is the one dial that decides how smooth it looks, and too
narrow a window leaves a wobble rather than a facet: measured on a 70° recurve,
a 1° window left total turning at 1477° where a smooth convex ring is 360°; the
shipped 2.5° window settles near 1000°. The window is also capped at a quarter
of the track, so a short forecast is not flattened into a sausage.

**Measured on the shipped payload:** area within 0.2% of published, longest
straight run on a recurving cone 2.84° → 0.91°.

**A WRONG MEASUREMENT COST A WHOLE DESIGN, AND IT IS WORTH THE PARAGRAPH.** The
model-based version was torn down on a reading that published cones are up to
43% wider on one side of their track than the other. They are not — the shipped
GDACS cone is symmetric to within 1 km at every forecast point. The 43% came
from a **sign error on the `u` parameter of the ray-segment test**, which
rejected crossings inside a segment and accepted ones beyond its end. It never
errored and always returned a plausible number. The same broken ray was inside
the model-based design, feeding it garbage widths, and is the likeliest reason
it refused itself on every storm.

**It refuses rather than draws** when the track cannot see the cone at 60% of its
stations, when a flank would fold through itself on a tight recurve, when the
outline is degenerate, or when the rebuild sits deeper inside the published cone
than the blur window can account for. **Every refusal is said once on the
console** — the first version fell back silently, which is indistinguishable
from running and being no good, and cost a full round of work to notice.

**THE THREE INPUTS DO NOT ARRIVE ON THE SAME BRANCH OF LONGITUDE.** §7.4 emits
the smoothed track UNWRAPPED on purpose — past ±180, so MapLibre draws one
continuous line across the seam — while the cone arrives wrapped into
(−180, 180]. Every dateline-crossing storm therefore refused itself, silently,
across the western half of the West Pacific. Everything is moved onto the
track's branch before it is measured; rings move as one piece after being made
continuous, because per-vertex would tear a straddling ring across the world.


## 9. Design

### 9.1 The visual contract

- **All colours, type and spacing in one tokens file; all motion durations and
  easings in one motion constants file.** Zero hardcoded hex, zero raw pixel
  literals in feature code. §6's fixed colours live there too, marked
  non-themeable.
- **The app owns its whole screen and does not follow an ambient theme.** A user
  may CHOOSE to follow the device in Settings; that is a preference, not the app
  taking its look from its surroundings. **The default is dark for everyone**
  regardless of what the OS says.
- **Beautiful AND informative — equal billing.** Animate transform and opacity
  only.
- **Floating menus.** Panels float over the globe (glass/translucent), globe
  visible behind. No full-screen page takeovers.
- 44 px touch targets; every interactive element keyboard-reachable and
  screen-reader-labelled; visible focus ring always; contrast meets WCAG AA in
  both modes. Verify at phone width and desktop width before anything is done.

**Visual direction: a cyan nodal-network entry that dissolves into a lit
volumetric globe.** At the planet band the globe is a glowing geodesic node cage
over solid continents — near hemisphere solid, far continents visible through the
clear ocean and dimmed to read as "behind" — with grey coastlines on top. The cage
is cyan, drawn from the coastline stack's own dim tone, so the two engines read as
one planet across the crossfade instead of two visual languages meeting at z3.

### 9.2 Light mode

Dark / Light / Automatic in Settings, stored in the `settings` record, **default
Dark for everyone regardless of the device.** Dark is what the app looks like and
what a shared link should open on; automatic is available, not leading.

**The light theme's base is greyscale.** Ocean, land, sky, borders and the
administrative furniture are all neutral, so severity colour has nothing to
compete with. `error` / `stale` / `ok` keep a hue because they are status words,
`focusRing` because it is an accessibility affordance that must never read as a
border, and the install amber because it is a brand colour.

**ON TRIAL (2026-08-08): the cage, the coastline, the nodes and the population
heat carry dark mode's CYAN rather than a neutral.** They were grey for one
deploy. Aaron asked to see the cyan version, and these are the exact values the
light theme used before the greyscale pass, so reverting is a straight swap back
to the grey block in git history. **Same hue angle as dark, not the same hex** —
dark's `#4FD1E8` measures 1.05:1 against this ocean and would fail the required
`coastline vs the ocean` pair. A bright line glowing on a night sea becomes a
dark line drawn on a pale one; hue carries the identity across, lightness has to
move. The open question is the one the greyscale pass was answering: whether a
cyan resting cage competes with the storm colour blooming out of it.

**It is not an inversion**, and the places it refuses to invert are the ones worth
knowing before editing it:
- The cage, the coastline and the nodes go **darker** than their surface, not
  lighter. A glowing line on a night sea becomes a drawn line on a pale one.
- The ocean is **mid-grey, not near-white**. The §6 category ramp runs light to
  mid, so a near-white sea leaves a Cat 1 yellow no luminance to spend. Land is
  near-white and carries the paper feeling; the sea carries the shading, and the
  sea is where nearly every storm is.
- **`space` is the OCEAN's value, with a whisper of a lighter near-stop.** It
  shipped near-white on the reasoning that this theme is a lit object on paper,
  and the globe vanished into it — `land3d` is near-white too, so the planet
  band was white on white with only the cage visible. The rule dark mode
  follows is the one that was missing: space sits below the surfaces drawn on
  it. `spaceNear` is a lift you feel rather than see, for the same reason
  dark's `#0A1626` over `#04070E` is; a strong bloom sits exactly where the
  land is and re-creates the washout. `land3d` is consequently a shade LIGHTER
  than `land`, not deeper — the clear globe has no opaque ocean, so the grey
  backdrop shows through at 8% and drags it down.
- The 3D globe's far continents, coastline and nodes **drop additive blending** in
  light mode. Additive can only add light — right against a dark sky, invisible
  against a bright one.
- **The seven Three.js material opacities are per-palette** (`DARK.fx` /
  `LIGHT.fx`), which follows from the line above: 0.3 additive on near-black is a
  bright line, 0.3 normal on near-white is a pale one. A shared opacity is a bug
  the moment the blend modes diverge, and it was — it is what made the light
  theme's mesh look washed out while every value in the file looked right.
- **A storm-lit cage node is deepened toward ink** in light mode
  (`LIGHT.meshStormDeepen`). The cage is a semi-transparent field, not a mark;
  §6's fixed severity colours live on the glyph, the dot and the swatch, all of
  which are drawn opaque and untouched. This is the dial for "storms do not pop
  enough in daylight".
- The chosen segment of a control goes **down** in lightness and up in edge
  strength. A step further toward white is a step toward invisible.
- **The install button is dark mode's `#F0B23C` in both themes.** It works
  because the fill and the boundary are two tokens: `installCtaEdge` — a dark
  amber — draws the 1px edge that WCAG 1.4.11 actually asks for, and is also the
  colour of the manual-install heading, which is TEXT and cannot be yellow.
- **There is no starfield in daylight.** The token is held near the sky rather
  than removed, so there is no "if light, skip the stars" branch to forget.

**The space backdrop is a radial gradient, not a colour.** `#spacebg` runs
`spaceNear` at 0% -> `space` at 60% -> `spaceFar` at 100%, from 42%/30% out to
the corners. `space` is also the Three.js scene background and fog, so it is the
value the globe's limb dissolves into — move it and you move the horizon. The
two ends are free.

**A bloom needs CHROMA, not only lightness.** Dark's near stop is navy against
a near-black field — a hue shift, which is what makes it read as a glow rather
than a grey patch. Light's was neutral on neutral, and a lightness-only lift at
L\* 89 is very nearly invisible; getting the L\* profile right (below) still
looked like nothing until the near stop went cool. Chroma is also the cheap
axis: it costs nothing against the near-white land, because land separation is
a lightness question.

**Tune it in L\*, never in contrast ratio, and match the two themes on the
DISTRIBUTION rather than the total.** A ratio understates a step badly at the
light end, and comparing the themes that way hid a real fault for three rounds:
dark put +9.8 L\* between near and space and 1.1 between space and far — almost
all of its range directly behind the globe — while light had 5.7 and 11.4, which
is the same gradient pointing at the corners where there is nothing to see.
Raising light's total without fixing the distribution just darkened the corners.
Both themes now carry dark's profile: **+9.8 near-to-space, 1.1 space-to-far.**

The cost in light is that a brighter near stop sits behind near-white land:
`land3d` has about 6.8 L\* of separation from it, down from 10.7. `coast3d` at
4.77:1 against the land is what carries the outline. If the continents start to
disappear again, that is the pair to look at.

**Scrollbars are themed** (`scrollThumb` / `scrollThumbHover`, both syntaxes in
`index.html`). `color-scheme` alone gets you the operating system's grey, which
is the one surface in the app that was never ours. The track stays transparent —
a panel is glass over a globe, and a filled gutter is an opaque stripe down the
side of it.

**Glass is alpha AND blur, and the blur is the one that decides whether the
translucency is visible.** `--glass-blur` / `--glass-blur-raised` (8px / 6px,
from `SIZE`). At the 18px this shipped with, the backdrop is smeared into a flat
wash before compositing, so lowering the alpha lets more of a flat wash through
and the panel looks exactly as solid as before — three separate alpha reductions
produced no visible change for that reason. Alpha decides how much backdrop you
get; blur decides whether any of it is recognisable.

Both of them spend the same currency: `tools/contrast-check.mjs` composites
panels over `ocean`, a flat colour, and a blur is precisely what protected text
from a backdrop that is *not* flat — a radar cell, a lit mesh peak. Less blur
and less alpha spends it twice. Raise the blur first if a panel becomes hard to
read over weather.

Mechanically: `config/theme.js` owns which palette is live and nothing else (no
DOM, no preference store, so `tools/` can import it). **Everything that draws
calls `palette()` or `fx()` at paint time and never caches it.** A theme change
does three things — rewrite the CSS custom properties (which repaints the whole
interface for free, since every panel is already written against them), call
`retheme()` on the 3D globe, and walk `map.setGlobalStateProperty()`. See §9.3.
`index.html` carries a pre-paint inline script, pinned in the CSP by hash, so a
light-mode device never flashes the dark globe on a cold load.

### 9.3 Theming the map without rebuilding it

**Every themed colour MapLibre draws is a `["to-color", ["global-state", key]]`
expression.** `map/theme-state.js` owns the key-to-palette-path map, the `gs()`
helper that writes a reference, and `themeState()` which produces the values. The
style's top-level `state` block carries the initial values; after that
`map.setGlobalStateProperty(key, value)`, one key at a time, is the only
thing that writes them. **There is no `map.setGlobalState`** — that is on the
Style, takes the `{ key: { default } }` stylesheet shape, and does not mark the
style dirty, so nothing repaints. The Map's method does both, and
`tools/test-maplibre-api.mjs` fails the build if the Style one is called on a
Map again. This
covers the basemap **and** the app's own layers — cones, tracks, forecast points,
storm markers, the graticule.

This replaced `map.setStyle(buildStyle(), { diff: false })`. That `diff: false`
was load-bearing, not lazy: the app adds its storm layers to the live style
imperatively, so MapLibre's differ would have emitted `removeLayer` for every one
of them and never put them back. The whole style was therefore thrown away and
`main.js`'s `installOnStyle` reinstalled the app's layers on the `style.load`
that followed — a basemap teardown, a full re-layout and a visible flash, to
change twenty-seven hex values. Global state never touches the layer list.

**Only paint colours belong in state.** A `global-state` reference in a *layout*
property re-layouts every tile on change, which is the cost this exists to avoid.

**And never in an expression that also reads feature data.** MapLibre evaluates
a data-driven paint property — one containing `['get', …]` and friends — in the
WORKER, and the worker is never sent the global state.
`_findGlobalStateAffectedSources` does not help: it only reloads a source for a
LAYOUT or filter reference. It does not throw; `to-color` of the missing value
is **black, in both themes, permanently**. This shipped on the first forecast
dot's white ring, and the tell was that the `circle-stroke-width` beside it —
the same `case` on the same `_first`, plain numbers in its branches — worked.
The way out is not a cleverer expression: either the colour is genuinely
theme-independent, so bake it from `palette()` and assert both palettes agree
(what `geo.pointStroke` / `geo.pointStrokeFirst` do), or it needs a real repaint
path. `tools/lib-state-scan.mjs` fails the build on any expression holding both,
and `tools/test-app-layer-state.mjs` applies it to the layers the app adds
itself — which is where the bug was, and which `buildStyle()` does not contain.

**Two things a paint property cannot reach, and both repaint explicitly from
`app/theme-switch.js`:**
- The **population heat ramp** (`rethemePopulation`). `heatmap-color` stops carry
  per-stop alpha composited from a palette hex, and MapLibre bakes the ramp into
  a texture rather than evaluating it per pixel.
- **Model guidance colours.** The line paints `['get', '_color']` — the colour is
  a property of each *feature*, resolved by `modelColor()` at push time — so it
  rethemes by re-pushing bundles already in memory.

If that list ever grows past three, the mechanism is wrong rather than the list
being short an entry.

**What enforces it.** `tools/token-check.mjs` walks every `gs('…')` in `map/`
against `THEME_STATE` in both directions and resolves every palette path against
both palettes; it also fails on a single `palette()` call in `map/style.js`. A
missing key is not an error in MapLibre — it is a silently rejected layer.
`tools/test-theme-state.mjs` walks the generated style in both themes and both
tile schemas and asserts it is byte-identical outside its `state` block, which is
the property that makes `setGlobalState` sufficient.

### 9.3 The crossfade

Choreographed in one order, and the order is the whole trick (`DIVE.fade`,
progress `p` derived from live zoom across `zSpace..zHandoff`):

| Surface | Fades |
|---|---|
| MapLibre | IN, 0.00–0.30 |
| 3D land and coast | OUT, 0.10–0.30 |
| Cage | OUT, 0.16–0.62 |
| Nodes | OUT, 0.14–0.60 |
| Space | OUT, 0.00–0.34 |

3D land and coast finish exactly as MapLibre arrives, because the moment MapLibre
can draw coastlines itself the 3D ones are duplicated data. The cage and nodes
trail: they are the planet-band **aesthetic** rather than duplicated data, and
that short trailing dissolve is what makes the handoff feel like a dive instead of
a cut.

**The 3D globe composites OVER MapLibre, so its BLEND MODE decides whether it can
damage map content.** `#gl` is `z-index: 2` above `#globe` at `1`. Three.js and
MapLibre are separate canvases with separate depth buffers, so `renderOrder` and
`depthWrite` are inert across that boundary. What IS available is blending. A
surface using `NormalBlending` paints its own colour over the map and can darken
it; a surface using `AdditiveBlending` can only add light and is physically
incapable of hiding anything beneath it.

**Far-side land and coast are ADDITIVE for exactly that reason.** `scene.fog`
blends fragments toward `DARK.space` by distance, so normal-blended far continents
paint a depth-graded dark wash over MapLibre and swallow storm tracks toward the
limb.

**When 3D content appears to shadow map content, check BLENDING first, then
opacity.** Fade choreography controls WHEN a surface is present; blend mode
controls whether its presence is destructive. Different questions — pulling fade
bands in dims the symptom and costs the dive its slow dissolve.

### 9.4 The node cage — an information surface, not decoration

**Node elevation AND node colour encode live storm severity.** Each node rises by
a Gaussian heightfield over the active storms and simultaneously blends toward
that storm's §6 category colour.

**===> ELEVATION AND COLOUR ARE ONE SIGNAL FROM ONE NUMBER. <===** Two channels,
one number: a Cat 5 is both the tallest peak and the only pink one, so severity
survives being read at a glance, on a small screen, at an angle. **This invariant
has drifted twice at this same seam. Watch it.**

- Nearest storm wins outright — a node between a Cat 1 and a Cat 5 must not invent
  an in-between hue that means nothing.
- Heights and colours ease in/out together and recompute on the storm poll.
- **On a feed outage the cage desaturates to grey — colours included**, so a held
  peak cannot keep showing a category the feed can no longer vouch for — and holds
  its last shape. It never flattens to a fake all-clear (§5).
- Node count and spacing are a frame-budget decision (`GEO_DETAIL`); peak shape is
  tuned by `STORM_AMP` / `STORM_SIGMA`.
- Severity peaks are a **sharp local spike, not a regional swell**: `geoDetail` 3
  (~2,562 nodes), `stormSigma` 0.16 rad (~9°), `stormAmp` 0.5, and a perceptual
  ramp (sqrt curve, 0.16 floor) so a 40 kt TS clears the cage's decorative noise
  instead of reading as flat ocean.
- **The fade lives at the EDGE of the raised region, not across it.** Lift is
  remapped through a threshold band (`stormColorOnset`..`stormColorFull`), so the
  entire lifted cage sits at its storm's exact `CATEGORY_COLOR` and the gradient
  occupies roughly one ring of nodes just outside it. A single gamma exponent
  across the whole lift range spreads tint over barely-raised nodes, wraps every
  storm in a halo of muddy purple-grey, and never lets the peak reach its true
  hue. **A storm colour that never actually appears is not a severity colour.**
- **The RESTING cage stays at FULL brightness** (`meshRestDim` 1.0). Dimming the
  99% of the lattice that is storm-free to flatter the 1% that isn't makes the
  calm globe nearly invisible on a phone. Storm colours get their separation from
  saturation and a narrow fade band, not from suppressing everything around them.
- **The soft falloff is free.** The cage is `LineSegments` with a per-vertex colour
  attribute, so the GPU interpolates along every segment — an edge from an
  unaffected node to a lifted one renders as a smooth cyan→category gradient. No
  shader, no second layer, no extra draw call.
- **The cage depth-tests against the land.** Land writes depth on its front face
  only and its ocean pixels are discarded by `alphaTest`, so far-side lattice hides
  behind near-side continents while still showing through open water. The intended
  read is a clear globe whose LANDMASSES are opaque, not a wireframe ball. **Cage
  and nodes must carry the same depth setting** or the lattice comes apart at the
  limb.

**Mesh height: `current` or `track`** (a Settings control; `map/storm-mesh.js`
builds it, `MESH_TRACK` owns every number). `current` lifts the cage over each
storm's live fix — one point per storm, and the default. `track` follows the whole
path: past positions trailing, forecast ahead, each bead at its own intensity at
that hour.

**HEIGHT IS INTENSITY, NOTHING ELSE.** A bead stands at the wind measured (or
forecast) at that position, so the tallest point on a storm's ridge is its
STRONGEST point — past, present or future — wherever that falls. Documented to the
user as *"the tallest point is the storm at its strongest, whether that has
happened yet or not."* **Check which mode is on before diagnosing a height
complaint.**

**Do not taper height with age or lead time.** It breaks the one-signal invariant
(colour is each position's true category and is never tapered, so a Cat 4 three
days old draws SHORT and red beside a taller orange Cat 2), and nothing else in
the app dims the forecast — cones, forecast tracks, forecast bands and forecast
dots all draw at full strength. **"This is a forecast" is carried by shape and line
grammar (§7), never by rendering it fainter.**

**WHERE THE STORM IS NOW is not height's question.** The live fix carries the
spiral glyph and is the only point that does.

**ONE GLYPH PER STORM, ALWAYS.** Every point lifts and tints the cage but only the
live fix carries `head: true`, and only head points draw a surface spiral. Twenty
beads stamping twenty spirals would not be a cosmetic bug, it would be a false
count of live systems.

**Source honesty on the ridge.** NHC publishes a measured wind at every past
position (`intensity`) and every forecast position (`maxwind`). A GDACS storm's
head and forecast beads are measured too, from JTWC's warning (§4). **Its PAST
beads are measured from the a-deck's `CARQ` rows** — JTWC's own analysed
history, one position and wind every six hours going back. A warning carries no
history, which is why this is a second source and not the same one. Where
neither answers, a bead falls back to the class midpoint under its `peakWindKt`
ceiling, which is never displayed. See §4 for the resolution order.

**A DERIVED PAST BEAD IS CAPPED AT `peakWindKt`**, the strongest wind the storm's
own source has ever published for it. `representativeKt('HU')` is the middle of
the entire hurricane range (~110 kt), so before this every past bead on a GDACS
hurricane stood at Cat 3 height whatever the storm was — NOUL's ridge drew a full
category above the 85 kt peak GDACS published for her. The ceiling is a `min()`
and can only pull down; a measured wind is checked first and passes through
untouched. It is a ceiling and not a value on purpose: `peakWindKt` is GDACS's
FORECAST peak (§4) and is no evidence the storm reached it, but nothing derived
should stand above the loudest claim its own source made.

**A STORM WITH NO CURRENT READING CONTRIBUTES NO RIDGE — head only.** Ended *or*
silent, via `noCurrentReading()`. That head is grey at `DIVE.sevNoReadingLift`:
there is no number, so both channels agree on "no current reading".

This **reverses** the earlier "past beads keep their real colours and heights,
history is a record" rule, and the reversal is Aaron's on glass. The old rule was
right about truth and wrong about emphasis — a ridge is severity read as HEIGHT,
the loudest channel on the globe, and a finished storm's peak at full lift shouts
about a system that no longer exists. History is still a record everywhere it is
read rather than shouted: the map trail, the list, the drawer, and a LIVE storm's
own past beads are all untouched. Silent is included deliberately — excluding only
`ended` would have changed nothing on the case that prompted it, because GDACS
still lists a silent storm as current. It is recomputed per build, so a storm that
starts updating again gets its ridge straight back.

**THE CAGE IS A SEVERITY FIELD, NOT A TRACK CHART, AND THERE IS A HARD LIMIT
UNDER IT.** One winner per node owns both height and colour, and influence
spreads over `stormSigma` (~9.2°). A storm's past track spans more than that —
DOLPHIN's ran 13.1° — so **a strong current or forecast position blankets the
storm's own weaker history**. Measured on her live ridge with real CARQ winds
attached: all ELEVEN past beads lost at their own node, the 20 kt depression
beaten 1.87× by the 100 kt position 13° away. The blue and green were computed
correctly and then lost the comparison.

For a weak bead to survive, the strong point must fall under `sevMinLift` before
reaching it — influence below ~5°. Node spacing at `geoDetail` 3 is ~4°, so
below that beads fall between nodes and vanish outright. **The window is 4–5°
and even there only a third of them come back.** This is the lattice being too
coarse for the job, not a tuning miss, and NARROWING THE BEADS ALONE CANNOT FIX
IT: at its own node a bead's Gaussian is 1.0 whatever its width, so what decides
the fight is always the competitor's reach.

**Accepted deliberately** (Aaron, on glass). Near a Cat 3, "how bad is it around
here" is honestly answered by the Cat 3. A storm's life story is read on the
flat map, where past points are individual coloured dots with no winner-takes-all
at all. The measured CARQ winds still earn their keep: they fix the near past,
where a ridge is legible, and nothing invents a 110 kt guess any more. The only
route to a legible weak past is `geoDetail` 4 plus a narrower influence, which
quadruples the node count — a frame-budget decision, and detail 3 is already the
confirmed-smooth setting, so quadrupling it is a bet nobody has reason to place.

**Performance.** The influence loop is nodes × points. Points beyond
`DIVE.influenceCutoffSigma` sigmas are rejected on a dot product instead of paying
for the `acos` inside `angleTo`; beyond 3 sigma a point's contribution is under
`baseLump` and was never visible. **The cutoff cosine is DERIVED from
`stormSigma`**, so widening the peak widens the reject radius with it.

### 9.5 Storm-lit triangle fill

Every cage triangle with at least one storm-lit corner carries a low wash of that
storm's colour; everything else is fully transparent. It makes a storm read as a
**presence in an area** and not only as a spike.

- **It is a third reader of the one signal, never a fourth channel.** The fill
  shares `nodeGeometry`'s position attribute outright, so it is the lattice's own
  surface tenting up with the nodes that carry it. Its colour is the cage's
  resolved colour and its alpha is the same lit ramp that decides the tint
  (`litAmount()`). If a node is tinted, its triangles fill. They cannot disagree.
- **Per-corner alpha, not per-triangle opacity.** A triangle with one lit corner
  fades to nothing across itself. Flat opacity would ring every storm with a jagged
  triangular fringe — the exact hard edge `stormColorOnset`/`stormColorFull` exist
  to prevent.
- **Normal blending, not the nodes' additive.** Additive makes a node read as an
  LED, but the fill covers area, and additive over the lit near continents blooms
  into haze where the map must stay readable.
- Drawn UNDER the cage (`renderOrder` 1) with `depthWrite: false` — a fill that
  wrote depth would occlude the lattice it is built from. Fades on the cage's own
  schedule. Outage behaves like everything else: shape held, colour muted grey.
- **One token: `OPACITY.meshFill`. Set it to 0 to retire the fill outright** —
  that is the off switch as well as the tuning knob.
- Measured at `geoDetail` 3: 642 nodes / 1,920 edges / 1,280 triangles. One settled
  Cat 4 lights 24 nodes and 65 triangles — 5% of the mesh, one extra draw call, no
  index rebuild when storms move.

### 9.6 Land, coast and atmosphere

- **Land is filled.** Filled land against dark ocean reads as a globe and gives
  storm dots and cones something solid to sit on. Values chosen against the §6
  storm colours. At the planet band the 3D clear globe is what shows (charcoal
  `land3d`); the MapLibre land below it drops to near-ocean and resolves to solid
  by the regional band.
- **Glowing coastline edges are the same line drawn TWICE** — wide/dim/blurred
  underneath, thin/bright on top. MapLibre's `line-blur` does what a third pass
  would have. **Do not "restore" a third pass.**
- Depth fade: line opacity and width driven by zoom, so distant coastlines are
  faint threads and near ones are crisp.
- The thin rim light at the horizon comes from the 3D clear globe, NOT from
  MapLibre's sky layer.
- **No day/night shading — `atmosphere-blend: 0` AND `light.intensity: 0`.** On
  the globe projection MapLibre's atmosphere darkens the sphere away from the
  camera-facing centre, producing a lit face and a dark limb. **It is not a
  terminator**: nothing in the app knows the subsolar point, so the "night side"
  never corresponded to the actual time of day anywhere on Earth. **A globe that
  implies information it does not have is worse than a flat one.**

  `atmosphere-blend` is the knob that matters and it must be 0. Zeroing
  `light.intensity` alone does NOT remove the effect, and neither do the fog
  blends — `fog-ground-blend` and `horizon-fog-blend` control the fog wash, not
  the atmosphere darkening.

### 9.7 Idle rotation

Gentle auto-rotate when untouched; stops instantly on interaction. **Storm
selection counts as interaction** — panels are off-canvas, so `main.js` must
interrupt the drift explicitly before `flyTo`, or the drift's per-frame
`setCenter` stomps the running camera animation and selection goes dead.

**Three settings: on/off, speed, and resume delay.** The right answer is personal
— the same drift that makes the globe feel alive to one person makes it feel like
it will not sit still to another. The constants file owns the defaults;
`data/settings-prefs.js` owns what was chosen.

- **Speed applies mid-drag**, because the step function reads its config every
  frame, so you can aim the slider at a speed you like while watching it.
- **The two sliders DISAPPEAR when the toggle is off**, rather than dimming — a
  deliberate exception to §7's "rows dim, they never disappear", which protects
  LAYER rows where a missing toggle is indistinguishable from a missing feature.
  Nothing is hidden here: the switch that brings them back is the line directly
  above the gap. They are `hidden` AND `disabled` — the attribute takes them out of
  the tab order and the accessibility tree, the disable guards against a stray
  `display` rule re-exposing a focusable control nobody can see.
- **Turning it off stops the globe immediately**, not at the next interrupt. A
  switch labelled "rotate when idle" that leaves the globe rotating is the switch
  lying.
- **OS reduce-motion overrides all three.** `attachIdleRotation` returns its inert
  handle before it reads a single setting: the OS preference is an accessibility
  request, not a default for an app toggle to beat.
- The speed slider's floor is deliberately above zero. "Off" is the toggle's job,
  and a speed that can reach zero gives two ways to stop the drift, one of which
  leaves the toggle lying.

**==> THE DRIFT COSTS A FULL MAPLIBRE REPAINT PER FRAME, AND THAT IS NOT FIXED.
<==** Below `DIVE.zHandoff` the step function calls `map.setCenter` every frame.
That is not a cheap camera nudge: it is a complete map redraw — every tile, every
layer, every label — for a globe nobody is touching. On a phone it is the single
largest thing the app spends battery on at rest, and it has been there since the
drift shipped. `setCenter` cannot simply be skipped, because it is also what
`map/globe-follow.js` mirrors to make the visible rotation happen.

**The shape of the fix is a self-owned render loop that stands aside for
MapLibre.** The pattern below was built and measured in the removed Deep
prototype (`proto/shell.js`, preserved on the `worlds` branch and the `worlds-v1`
tag). It is recorded here because the problem it solves is Landfall's, not Deep's.

Four rules, and every one of them is a bug that was actually hit:

1. **Normal frames are painted inside MapLibre's own `render` event, never a
   separate `requestAnimationFrame`.** A parallel loop reads a stale camera, so
   the 3D overlay drifts out of phase with the map beneath it and visibly lags,
   flickers and snaps. This is the same call the shipped globe already makes.
2. **The self-owned loop starts only on MapLibre's `idle` event and renders the
   Three scene alone — it never calls `triggerRepaint`.** It is safe *because*
   MapLibre has gone quiet: nothing is moving, so there is no camera to be out of
   phase with. `triggerRepaint` is the tempting fix and the wrong one — it buys
   frames by redrawing the whole map, which is the cost being removed.
3. **It stands down from the `render` handler, not from `movestart`.**
   `movestart` misses a keyboard zoom, a style reload and a resize — all of which
   resume MapLibre frames with no move event. Hooking `render` covers every case
   with no list to keep current. Cancel from there, never from inside the frame
   function itself: the self-loop calls that function too, and cancelling its own
   pending frame from inside the work it scheduled stops the loop after exactly
   one frame.
4. **The "should I run?" gate checks camera state directly, not the scene's own
   fade flag.** The frame function returns early past the handoff, *before* it
   updates the fade state — so a loop that trusts the scene's flag keeps
   answering "yes" from a stale value and redraws a full globe on top of a street
   map. Ask the zoom.

**The measurement this replaces nothing of:** nobody has yet measured what one
MapLibre frame at the space floor actually costs on a real phone. Now that the
drift is known to be paying that cost on every idle frame, that number matters
more, not less. It is NOW.md's NEXT UP item 1 and it needs a real device with a
real basemap — the sandbox cannot reach the tile host.

### 9.8 Opening sequence

The 3D clear globe IS the entry. On load you are in "space": the clear globe fills
the screen, idly drifting, while MapLibre streams tiles behind it, hidden. **There
is no scripted fly-in** — the globe is just there, immediately, which keeps
time-to-first-paint short.

- **You enter by zooming.** Scroll / pinch / + zooms in; the clear globe crossfades
  out and MapLibre crossfades in. Drag pans, arrows pan, Esc flies back out. One
  continuous zoom — no button, no modes.
- **Idle drift** only runs while zoomed out and stops on any interaction; disabled
  under reduce-motion. No auto-animation to sit through.
- `[DEFER]` auto-resting on the most significant active storm → home → fixed
  Atlantic view. Today the globe rests where it last drifted.

### 9.9 Zoom ladder

**Zoom controls detail, never severity.** A storm's glyph, position and category
colour are fixed at every band; what changes is only how much supporting
information sits around it. **If someone has to zoom in to discover that something
is dangerous, the design failed** — and that is truest at the band where you can
see every storm at once.

Four bands, not eight, so the transitions are felt rather than guessed at.

| Zoom | Land | Storms |
|---|---|---|
| **z0–2 · Planet** | Solid continents under the cyan node cage; far side dimmed through the clear ocean; grey coast | Category-colour glyphs; severity as node elevation AND node colour, plus a low storm-colour wash inside every lit triangle. **No labels.** |
| **z3–4 · Basin** | + major islands; 3D cage handed off to MapLibre, continents solid | Storm names. Track, cone and forecast points are **already drawn** — they arrive with MapLibre itself. **At z4:** forecast time labels and the watch/warning stripe |
| **z5–6 · Regional** | + detailed coastline, inlets | (no new storm layers — the set is complete by z4) |
| **z7–8 · Local** | Full coastline detail, bays, barrier islands | + surge bands, wind bands |

- **No names at z0–2.** Six names scattered across a globe you can barely see is a
  mess, and at that distance the question is "how many and how bad", which colour
  and glyph already answer.
- **THE CROSSFADE GATES STORM GEOMETRY — there is no zoom step for it.** Track,
  cone and forecast points carry no `minzoom` at all. They are part of the MapLibre
  canvas, which is itself fading in across `zSpace..zHandoff`. A hard z-floor
  underneath a fade already hiding the same pixels is a second gate doing the first
  gate's job.
- **`ZOOM.ambientGeometry` (z4) is RETAINED and gates exactly two things:**
  forecast time LABELS (ambient and selected both, via the shared `timeLabelLayer`)
  and the watch/warning stripe (`amb-ww-core`, one solid stroke — its glow underlay
  was killed on glass as fuzz at the doubled width). Labels need a floor because
  text at planet distance is unreadable clutter; the stripe because it hugs coastal
  detail that does not exist yet.
- **Ambient and selected storm geometry render IDENTICALLY.** Selecting a storm
  changes the camera and the panel, not what is drawn. Two code paths that were
  supposed to look the same, and could drift, became one.
- **The watch/warning stripe draws at z4, ahead of the coastal detail it hugs.**
  Deliberate: a warning is safety information and waiting until z7 to show it is
  worse than showing it imprecisely.
- `[DECIDE]` exact z-thresholds, once there is a real basemap to look at.
- `[DECIDE]` whether z0–2 carries any text at all.

### 9.10 The home marker

Home floats ABOVE the node lattice, tethered to its exact surface point. Every
value lives in `HOME` in `config/constants.js`.

- **Altitude is expressed in EARTH RADII, not pixels**, converted per frame using
  MapLibre's measured on-screen globe radius, so it scales with the planet at every
  zoom.
- **The altitude SHRINKS as you zoom in** (`altFar` 0.16 → `altNear` 0.004,
  smoothstepped across planet→regional). A fixed altitude reads correctly from far
  out but drifts off the house up close, because parallax grows as the camera
  approaches. **It never reaches zero** — a marker flat on the surface stops
  floating and is lost in the lattice.
- **`altFar` is set by SCREEN clearance, not by kilometres.** At the planet band
  the globe's on-screen radius is small; 0.06 radii comes out ~9 px and the marker
  vanishes into the lattice at exactly the zoom where it most needs to say "home is
  over here."
- **The tether is PERPENDICULAR TO THE SURFACE** — it follows the outward surface
  normal, projected to screen, and that projection FORESHORTENS. Full length at the
  limb, zero directly overhead. **Direction alone is not enough; the length is the
  tell.**
- **The DRAWN tether length is not the true projected altitude.** Clamped into
  `[tetherMinPx, tetherMaxPx]`. Foreshortening alone is geometrically right and
  product-wrong: past the basin band home sits within a degree or two of the view
  centre almost every frame, the projection collapses below a pixel, and the tether
  vanishes — the marker then reads as sitting flat ON the globe, the exact opposite
  of the design.
- **The directly-overhead deadzone is measured in SCREEN space, not angle.** With
  the camera straight over home the normal points at the lens and the direction is
  undefined — measured, a 0.1° camera move swung the tether 26.6°. The threshold is
  the anchor's pixel distance from the projected globe centre OVER the globe's pixel
  radius, which is scale-free. **An angular threshold breaks badly:** past z5 the
  entire visible map is a degree or two wide, so every on-screen point falls inside
  the deadzone and the tether never draws.
- **Direction falls back to screen-radial when the normal is degenerate.**
- The tether fades toward the ground end and lands on a small anchor dot. **The dot
  drops the moment the surface point is occluded** — it asserts "home is exactly
  here", and once the point is behind the planet that claim is false.
- **It mounts in `#home-layer-host`, NOT in MapLibre's canvas container.**
  `#globe`'s opacity is animated from 0 by the dive, and opacity on a parent fades
  everything inside it. The host sits at z3, above both globe engines and below all
  chrome.
- **It is a DOM overlay**, not a Three.js object and not a MapLibre symbol. Three
  would vanish at the dive handoff; a MapLibre symbol has no altitude at all.
  Driven by MapLibre's projection, which is valid at every zoom because MapLibre
  owns the one camera both engines mirror. One marker, one code path.

**Three visibility states, and the third is the one that gets forgotten:**
- **`ON_GLOBE`** — the GLYPH is still above the horizon. Marker + tether, no
  pointer. Note this is the *glyph's* horizon, not home's: the marker floats at
  altitude, so it stays visible for `acos(1/(1+alt))` of arc after its own surface
  point has gone under (30.4° at planet zoom, 5.1° zoomed in). Across that arc the
  tether foot is pinned to the silhouette and the lift decays to zero, so the house
  settles onto the rim rather than hovering above it.
- **`OVER_LIMB`** — behind the planet. The pointer rides the LIMB, the circular
  silhouette, because that keeps it attached to the Earth; a viewport-edge indicator
  detaches and reads as UI chrome. **The safe-margin clamp applies to the
  viewport-edge case ONLY** — clamping the limb position too drags the pointer to
  the screen edge whenever the whole globe is in frame. When the limb crossing is
  off screen, fall back to the viewport edge.
- **`OFF_SCREEN`** — near face, outside the viewport. Constant once zoomed in.

**Occlusion is asked of MapLibre, never derived.** `isLocationOccluded` on the
transform tests the point against the globe's own clipping plane — the same call
MapLibre's `Marker` class makes. A `cos`-against-the-limb test approximates it and
disagrees under pitch. Feature-detected: falls back to "never occluded" on mercator
and on any build without it.

- **`project()` has NO occlusion test.** It is a bare perspective divide, so an
  occluded point still returns a coordinate — a meaningless one. **Any bounds test
  on a far-side point is nonsense.** The DIRECTION survives occlusion (far-side
  points project inside the disc, collapsing toward the centre, never flipping
  side), which is why the pointer can still aim correctly from a projection the
  foot cannot trust.
- **The limb radius is MEASURED, never derived.** `limbRadiusPx()` walks the great
  circle out from the view centre through home and bisects on `isOccluded` for the
  arc where the renderer stops drawing, then projects that point. `readFrame` calls
  it once per frame and carries it as `limbPx`. **Anything needing a limb radius
  reads `f.limbPx`. Never `R`** — `measureGlobeRadiusPx` returns px per radian of
  arc at the screen centre, a different quantity that vastly overshoots the rim up
  close.
- **MapLibre does not clip at the geometric horizon.** Its clipping plane sits
  deliberately past the tangent, at `cos = 1/(d+1)` rather than `cos = 1/d`. A
  closed-form tangent answer agrees within a percent far out and diverges without
  limit up close — measured on 390×844, zoom 3 gave 379 px against a real rim of
  509 px, and by zoom 3.5 had collapsed to 312 px while the real rim grew to
  650 px.
- **The durable rule: one question, one oracle.** `isOccluded` deciding *when* to
  hand off while a formula decided *where* to draw gives two answers to "where is
  the edge of the globe" that agree at the zoom they were checked at and drift
  everywhere else. **If the renderer will answer a question, ask it** — a
  derivation is a second copy of somebody else's camera, free to go stale. This
  also buys pitch for free.
- **Cost, measured:** 12 µs per frame for an 18-step bisection — 0.07% of a 60 fps
  budget, on software rendering. Each step is one plane dot product, no projection
  and no allocation inside the loop.

**The off-screen pointer:**
- **Its position is the great-circle direction to home**, so dragging toward it
  brings home to you and it slides smoothly around the rim.
- **The bob rides OUTWARD along the pointing axis**, not vertically — a vertical
  bob on a curved rim reads wrong at the sides. Pointer only, never the marker.
  Under `prefers-reduced-motion` it is **dampened, not killed**: a few px of local
  travel on a 44 px control is not the large-area parallax that setting guards
  against, and the movement is what makes the pointer findable against a busy globe.
- **It is TWO marks on ONE imaginary line** running from the house, through the
  arrow, out to the real home location. Reading outward gives house → arrow → home,
  so the house says "this is your home" and the arrow says "it is that way."
  Putting the house on home's side would place it between the viewer and the
  direction it is claiming.
- **NO ENCLOSING CIRCLE.** A ring reads as a separate object from the marks inside
  it — three scattered elements rather than one indicator.
- **Only the arrow rotates.** The house stays upright — a rotated house reads as a
  falling building.
- **"Off screen" and "not visible" are DIFFERENT QUESTIONS, and both trigger the
  pointer.** Home sliding under the storm drawer is invisible while still inside the
  viewport rectangle. The occlusion test covers both the anchor AND the floating
  glyph, since the glyph is what the eye looks for.
- **When home is hidden but on screen, the pointer anchors at HOME's projected
  position**, not at the viewport edge. Chrome avoidance then slides it the shortest
  way clear, parking it against the covering panel's edge. Marching to the viewport
  edge first drifts the pointer sideways whenever home is off-centre — measured up
  to 44 px.
- **It is a real `<button>`** — tap or Enter brings home into view WITHOUT changing
  zoom (the user picked that zoom). **It leaves the tab order when hidden**; a
  focusable control you cannot see is a keyboard trap (§13).
- Clamped `pointerEdgeMarginPx` from every viewport edge — the limb crossing can
  otherwise land in a corner where the OS eats the gesture (§10).

**The floating house is also a button.** The two answer **different** questions and
so do different things: the pointer means "home is off screen, show me where" and
is a rotation at the current zoom; the house means "take me there" and commits to
`GLOBE.homeZoom` (6 — inside the regional band, close enough for the coastline
around home to have shape, far enough out to still see a storm two states away).
Flying to a point already on screen without changing zoom would be nothing visibly
happening. Sized to the 44 px touch target with the glyph centred inside. It leaves
the tab order whenever the marker is not `ON_GLOBE`. **The tether and anchor dot
stay inert** — they are a claim about a location, not controls.

**Chrome avoidance is SHARED, not home's.** `map/chrome-avoid.js` imports nothing
and knows nothing about the home marker — any future overlay positioned freely over
the globe uses it rather than growing a second copy. Two functions, deliberately
separate: `occludedByChrome` answers "can the user SEE this point" (tight occlusion
padding), `avoidChrome` answers "where may this SIT" (wider clearance).
**Conflating them is a real bug** — overshooting the visibility test hides a marker
that is plainly on screen.

- Obstacles are MEASURED from the live DOM once per frame and cached, never
  hardcoded — they move with safe-area insets, panel state and dock side.
- **The per-frame cache is the CALLER's job.** `measureChrome` calls
  `getBoundingClientRect`, a layout read that must not happen more than once per
  frame inside a render loop; each consumer repeats the `chromeCache` pattern
  (measure once, key on a frame counter).
- Escape candidates are clamped to the viewport BEFORE being chosen; clamping
  afterwards pushes the point straight back into the obstacle it just left.
- The occluding set is a SUBSET of the avoidance set: the small attribution button
  is something the pointer must not cover, but not something that should banish the
  marker when it passes behind.
- **When storm callouts land they become chrome other overlays must dodge** — add
  them to `OCCLUDING_SELECTORS` then, or two markers will silently overlap.

### 9.11 The provisional pin

Shown between picking a candidate and confirming it. **Dashed and hollow where the
real marker is solid and filled**, so the two can never be confused — a provisional
pin that looked like a set home would tell the user they had finished when they had
not.

**Draggable, because a geocode result is a GUESS**: Mapbox puts rural addresses on
the road and postcodes on a centroid. Dragging is the correction path.

- **A dragged pin drops its address label** and its source becomes `pin` — keeping
  the searched label would name a place the home no longer is. The confirm step's
  label follows the pin live and switches to coordinates once dragged, because
  commit already refuses to store the old label and showing a street name the user
  is about to lose is a small lie told at the exact moment they are deciding.
- **THREE DOORS INTO SETTING A HOME, not two.** Geolocation needs permission,
  search needs the geocoder to know the road, and neither helps someone down a lane
  Mapbox files in the wrong parish. **"Drop a pin on the globe"** puts the
  provisional pin at the centre of the current view and goes straight to confirm.
  **It does NOT change zoom** — the pin belongs where the user is looking, and
  pulling the camera to a fixed confirm zoom would move the ground out from under
  the thing they just placed. It carries no label and is marked low-confidence,
  which is what makes the confirm copy tell them to drag it.

### 9.12 Icons — no pack, deliberately

Every icon is hand-drawn inline SVG in one language: 24×24 viewBox,
`currentColor`, stroke-width 1.7, round caps and joins. The house mark lives in
`map/glyph-home.js` and is shared by the marker, the off-screen pointer and the
provisional pin.

**An icon pack was considered and rejected.** At ~10 icons in one consistent style
there is nothing to gain, and both delivery routes cost something the project has
ruled out: a CDN request puts a third party in the render path, and a bundled
package needs a build step. Revisit around 30 icons, and even then by copying
individual paths into `glyph-home.js`, not by adding a dependency.

**The settings icon is a GEAR.** It was a ring with eight radial spokes — the same
drawing every weather app uses for "clear sky", which on a globe covered in cloud
imagery is the one thing that control must not read as.

**The storm-list button is the APP'S OWN MARK, and it is the one filled icon in the
rail.** Every other control there is stroked line art at 1.7 because each is a VERB
— layers, home, settings, recentre. This one is identity, the same artwork the
home-screen icons, the boot splash and the globe glyph are cut from, so reading as
the odd one out is the point rather than a slip. The master's five outlines are
transformed into the 24 box by a group transform rather than retraced at icon size:
a hand-drawn 24 px version would be a SECOND copy of the logo, free to drift. Its
arm weight matches `SIZE.glyphArmWeight` and is a literal in `index.html`, because
that file cannot read `config/tokens.js` without a build step — the same reason
every other icon's geometry is inline. The two move together by hand.

### 9.13 The storm glyph — 3D node mesh only

- **THE GLYPH IS THE APP'S OWN LOGO.** The four-arm spiral with an open eye, the
  same mark the home-screen icons are cut from, mirrored by hemisphere —
  counterclockwise north, clockwise south, which is the direction the artwork is
  already drawn in (measured off the paths, not assumed). It replaced a hand-drawn
  two-arm spiral on 2026-07-29.
- **PATH DATA, NOT THE FILE.** The five outlines are inlined in `map/glyph.js` as
  `Path2D` strings rather than fetched from `assets/icons/maskable-512.svg`.
  Loading the SVG would make texture creation asynchronous — a frame of nothing
  on the storm surface while a request completes — and put a fetchable file in
  the render path for a drawing that never changes. The artwork living in two
  places is the accepted cost.
- **THE ARMS ARE FATTENED, AND THAT IS WHAT MAKES IT WORK AT GLYPH SIZE.**
  `SIZE.glyphArmWeight` strokes each outline in its own fill colour before
  filling it. Unmodified, the arms taper to points that fall below a pixel at the
  12-24 px the glyph occupies on a phone, and the mark reads as a blob with a
  hole. Measured across 12/16/20/24/32/48 px: this weight holds the eye open and
  the four arms separate down to ~16 px, and roughly double it fuses them into a
  pinwheel — the worse failure, because a fused mark still looks deliberate.
- **ONE ENGINE DRAWS IT, AND IT IS THE MESH.** `map/glyph.js` is shared. MapLibre's
  copy is deleted: its zoom band reached full opacity at z3.4 while the mesh does
  not finish handing off until z5.0, so for 1.6 zoom levels two copies of one spiral
  drew at slightly different projected positions and sizes. That smear was
  structural, not tunable.
- **AT MAP ZOOMS THE GEOMETRY IS THE STORM.** Track, cone, wind field, and the
  forecast points — whose first dot sits on the analysis position (tau 0, NOT
  current — see §7.4) wearing the white direction ring of §7.5, and carrying the
  category colour and code. Severity reads off the dots and bands rather than off a
  spiral.
- **Size-scaled by category, never shape-scaled.** A Cat 5 is a bigger glyph, not a
  more elaborate one.
- **ONE FIXED SCREEN SIZE AT EVERY ZOOM** (`SIZE.stormDot3dPx`, and the sprite runs
  `sizeAttenuation: false`). It was sized in WORLD units, and the 3D camera distance
  is recomputed each frame from MapLibre's on-screen globe radius, so the mark
  roughly doubled per zoom level — tiny at the space floor, where the whole planet
  is on screen and a storm most needs finding, and enormous by the time it faded
  out. **A storm marker is a LABEL:** it says "a cyclone is here", never "the
  cyclone is this big". Extent belongs to the wind field and the cone, which are
  measurements. The cage nodes KEEP their attenuation — they are geometry sitting
  on the sphere, and a lattice whose spacing changes with zoom while its dots do
  not would come apart.
- **A storm with NO category index sizes on its class floor, not on TS.** A GDACS
  hurricane legitimately has `category: null` and `categoryCode: 'HU'`; a plain
  coalesce-to-1 draws every unclassified typhoon at tropical storm size — the least
  severe reading available, on the surface a thumb aims at. `map/markers.js`
  resolves a `sizeRank` per feature: `HU` with no index takes the Cat 1 floor,
  anything else with no index stays at TS. **The floor understates a real Cat 4,
  which is the honest direction to be wrong** — every alternative asserts a strength
  the source never stated (§5).
- **Non-tropical `nature` values get a plain dot, not a spiral.** The glyph means
  "this is a cyclone."
- **SELECTION DOES NOT RIDE THE GLYPH.** `storm-dot-planet` is a fully transparent
  circle with no maxzoom, present at every zoom — it is what makes the MESH spiral
  tappable in globe view, and what keeps a storm selectable before its geometry has
  warmed or after that fetch failed. Forecast points are tap targets too (`_stormId`
  stamped by both data paths), so anywhere along a track selects its storm.
  **Selection must never depend on a network round trip.** Hit radius is floored at
  half the 44 px touch minimum, and the query box in `stormAtPoint` enforces it
  again.
- **Zero-opacity queryability is the load-bearing assumption under the whole
  hit-target design.** MapLibre does return fully transparent layers from
  `queryRenderedFeatures` (unlike `visibility: none`, which it excludes). If taps
  ever stop selecting, this is the first thing to re-check, and the fix is raising
  the opacity a hair — **not** restoring the MapLibre glyph.
- **`storm-dot-last-known`** — a live storm's map-zoom position dot is its tau-0 forecast
  point, and an ended storm has none. Without it you zoom in and find a track ending
  in empty ocean. Drawn as a forecast dot with no forecast in it: forecast radius and
  stroke, ended grey, and a capital **X** in `storm-dot-last-known-mark` where the
  category code would sit. **No zoom floor**, exactly like the forecast dots it
  mirrors — it stood on `ZOOM.ambientGeometry` until caught on glass, which left two
  zoom levels where a live storm had its dots and an ended one had nothing but a
  track running into open water. The X is plain ASCII, not the multiplication sign it wants
  to be — the glyph pack is only guaranteed across basic Latin, and a missing
  codepoint draws nothing, which is a silent failure on the one mark whose job is to
  say a storm is over.

  **The X is the one ink in the app that flips with the theme**
  (`geo.endedMark`: near-black in dark, white in light). Everywhere else a
  single ink serves both themes because what is behind it does not move — a
  forecast dot is a fixed §6 category colour. `stormEnded` is the exception:
  bone on a night globe, a strong dark neutral on a daylight one, because
  "drained of colour" reads as near-white in the dark and as invisible in the
  light. The disc flips, so its ink flips with it. It did not, briefly, and at
  1.79:1 the X vanished into its own dot — a §5 failure, not a cosmetic one.
  `tools/contrast-check.mjs` gates it as required text.
- `[DECIDE]` whether the mesh glyph rotates slowly. Leaning no — animating N sprites
  forever is a battery cost for decoration.

---

## 11. Basemap tiles — OpenFreeMap (OpenMapTiles), z8 by design

**The app serves the basemap from OpenFreeMap and styles it itself.**
`TILES.useR2` is `false`. The `basemap` source points at `TILES.openFreeMapStyle`
and `style.js` draws the OpenMapTiles layer set — land is the background,
`class=ocean` water on top, coast is the ocean-polygon edge. Watch/warning coast
selection (§7) runs against that continuous ocean edge.

**Tradeoff accepted:** OpenFreeMap is one person's donation-funded server with no
SLA. Re-self-hosting is a flag flip.

**The ceiling is z11 (`ZOOM.max`), and z8 is still where the cyclone work ends.**
The question this app answers at close range is "is the cone over Tampa Bay or
west of it," and that is answered at z8 — a metro area with inlets and barrier
islands resolved. Nothing in the storm picture needs more.

**What is past z8 is not what §11 used to claim was past z8.** The old ceiling was
justified by street grids wrecking the lit-globe look; we never drew one.
`style.js` reads exactly four OpenMapTiles source-layers — `water`, `earth`,
`boundary`, and `place` filtered to `rank <= ADMIN.cityRankMax` — so past z8 the
basemap gains finer coastline and a handful of town names, and gains no roads
because no road layer is defined. The ceiling moved to 11 for the Deep world's
seamounts, and **those were cut on 2026-08-08, so 11 no longer has a stated
reason** — nor does reverting to 8, whose reason was the street grids that were
never there. It stays at 11 as the known-good status quo until somebody judges,
on a phone, how far in is useful for reading a landfall point against a
coastline. Full note on `ZOOM.max` in `config/constants.js`. **Do not reopen this
as a cost question** — it is not one either way.

**Reviving R2/Protomaps is one flag.** `style.js` and `coast-source.js` still carry
the Protomaps path; set `TILES.useR2` true. The `landfall-z0-8.pmtiles` archive
(525 MB), the `TILES_BUCKET` binding and the tile proxy are untouched, and the
client never reads the pmtiles format — the library is vendored server-side at
`functions/tiles/_pmtiles.js`. If the archive is ever regenerated, bump a `?v=` on
`TILES.tilesUrl` rather than trusting caches to notice.

Two things sank R2 when it was live, and both would recur:
- **Cold-tile latency.** The proxy reads one tile out of the 525 MB archive on each
  edge cache miss, so the first look at any new region pays a bucket round-trip and
  panning lags with visible pop-in — worse in practice than OpenFreeMap's CDN.
- **It broke coast tracing.** Protomaps draws the coast from the `earth` LAND
  polygon, and land is not continuous. (The band-select rewrite in §7 removed the
  tracer this failed, so this half may no longer bite. Unverified.)

**Fonts come from OpenFreeMap either way.** `glyphs` in `style.js` points at
OpenFreeMap's font endpoint regardless of `useR2`. Self-hosting fonts is open.

### 11.1 The two schemas are not interchangeable

**OpenFreeMap serves the OpenMapTiles schema. Protomaps serves its own. They share
layer *names* but not layer *meanings*, and the difference is structural.**

- **OpenMapTiles has no land polygon layer at all.** Land is the absence of water.
  Its `landcover` layer is surface *material* — glacier, wood, grass, sand — not
  landmass.
- **Protomaps has a real `earth` layer** that is the landmass.

| | Background | Fill on top | Coast from |
|---|---|---|---|
| **OpenMapTiles** | land | ocean (`class=ocean`) | ocean polygon edge |
| **Protomaps** | ocean | land (`earth`) | land polygon edge |

Getting this backwards paints the whole globe ocean-coloured and leaves only ice
sheets visible. `style.js` carries two separate layer builders rather than a
layer-name lookup table. **Do not "simplify" them back into one.**

**MapLibre's globe `sky` fog bleeds across the entire sphere face, not just the
limb, when blend values are high.** `fog-ground-blend` at 0.55 produces a lit blue
planet; it lives at 0.02. The rim is a thin edge, not a wash.

### 11.2 Administrative furniture — borders and place names

Four layers, all drawn from OpenMapTiles data **already inside the tiles we
download**: `boundary` (lines, keyed by `admin_level`) and `place` (points, keyed
by `class` and `rank`). No new source, no new request, no new bytes.

| Layer | Data | Appears |
|---|---|---|
| `admin-country` | `boundary`, `admin_level` = 2 | z2.4 |
| `admin-state` | `boundary`, `admin_level` = 4 | z3.4 |
| `place-country` | `place`, `class` = country | z3.4, gone by z5.0 |
| `place-state` | `place`, `class` in state/province | z4.2 |
| `place-city` | `place`, `class` in city/town, ranked | z6.4 |

- **Nothing at the planet band.** z0–2 belongs to the mesh (§9). Each mark arrives
  as late as it can still be useful.
- **Borders draw UNDER the coast, names OVER it.** A reference line crossing a
  glowing coastline reads as an error, but a label buried under one is not a label.
- **Maritime boundaries are stripped everywhere** (`maritime != 1`). The `boundary`
  layer carries sea borders that strike out across open water, and beside a
  forecast cone such a line reads as though it means something.
- **`rank` IS the definition of "major".** The schema ranks notable cities 1–10 and
  leaves everything else unranked, so requiring a rank is a real category rather
  than an arbitrary cutoff. `ADMIN.cityRankMax` is the knob.
- **No city dots, deliberately.** Storm glyphs, forecast points and the home marker
  are already three kinds of dot that each mean something specific. A fourth
  meaning "a place exists here" would be read as storm data at a glance.
- **Never below state level.** Counties and districts are in the schema and are
  never drawn — past state level this becomes an atlas, not a storm map.
- **BORDER LINES ARE PERMANENT. Only NAMES toggle.** Borders are structural —
  hairlines that cost almost nothing visually and answer "which state is this" by
  existing. TEXT is what clutters a map, so text is what the Reference toggles
  remove. Both lines live in `LAYER_BASELINE` so the inventory stays honest.
- **Two toggles in Reference: `stateNames` and `cities`.** Both default ON, both
  `fetches: false`, so neither row can ever go amber. Visibility goes through
  `setAdminVisible` in `style.js`, deliberately the same shape as
  `setGraticuleVisible` — one mechanism for basemap visibility, not a second one
  that drifts. **`setAdminVisible` must never be given a line layer.** It addresses
  `place-state` and `place-city` only; handing it `admin-state` is how the
  permanence rule above gets quietly broken.
- **City names arrive at z6.4**, close to the local band. Walked out twice on glass:
  4.6 → 5.4 → 6.4. Both earlier values put names on screen while the question was
  still "which storm" or "which state". **Decluttering is done by ZOOM first and
  the toggle second.**
- **State names leave as cities arrive** (`nameLadder.stateOut`, 6.6 → 7.4), with
  `maxzoom` retiring the layer at the same number the fade reaches nothing. Until
  2026-08-07 this rung did not exist: state names rose at 4.2 and never left, so
  past `cityIn` the map carried every province name on top of the town names it
  was there to help you read. **The never-a-nameless-globe invariant is
  guaranteed only up to `cityIn`** — past 7.4 an unpopulated frame has no label,
  which is accepted for the local band.
- One colour block (`DARK.adminState` / `adminCountry` / `textCountry` /
  `textPlace`) and one tuning block (`ADMIN`). The hierarchy is steep and
  deliberate: storm names > place names > country lines > state lines, and every
  one of them sits below the coastline.
- **State names and city names share one ink (`textPlace`) and one halo
  (`ocean`).** The difference between them is WEIGHT AND CASE, not colour: states
  are bold, uppercase, letterspaced and set at `stateLabelPx` (the largest place
  label on the map); cities are regular, mixed case, `placeLabelPx`. A state is
  an area, a city is a point, and that reads at a glance without a second colour.
  There is no `textState` token — it was retired when the two merged.
- **`Noto Sans Bold` is the only bold fontstack in the app**, used by the state
  name layer alone. It is present on the OpenFreeMap glyph server. A fontstack
  that 404s draws NOTHING rather than falling back, so this name is never a guess.
- **City names are drawn ABOVE state names, so a city wins every collision.**
  MapLibre places symbols top layer down and first placed wins. The order reads
  backwards — the loudest label yielding to the quietest — and it is right: below
  `cityIn` there are no cities to lose to, and above it the state name is already
  leaving. The reverse order shipped for about an hour on 2026-08-07 and cost
  every city label over Japan.
- **State names have the trailing administrative noun stripped.** OpenMapTiles'
  English names carry it across much of Asia — "Shimane Prefecture", "Jilin
  Province", "Gangwon State" — and at this type size that wraps to two lines to
  say what the map already said. `withoutAdminSuffix` in `map/style.js` removes
  a trailing ` Prefecture`, ` Province` or ` State`. **This layer only.** Country
  names never carry one and cities are points, not regions.
  - `Region` and `Territory` are deliberately NOT stripped — Northern Territory
    would become "Northern". `ADMIN_SUFFIX_KEEP` holds the one counter-example to
    `State` (South Africa's Free State).
  - **The `> 0` guard on `index-of` is load bearing.** `index-of` returns -1 on a
    miss, which equals `length - suffixLength` for a name one character shorter
    than the suffix, so the end-of-string test passes on a word that never
    contained it and `slice(0, -1)` eats the last letter. TEXAS became TEXA.
    `tools/test-world-basemap.mjs` pins every five-letter state against this.
- **OpenMapTiles only.** The Protomaps path has its own boundary schema and does
  NOT get these.

### 11.3 The name ladder — each rung overlaps the last

The globe is never a nameless shape. As you zoom, the map DISSOLVES from one label
to the next rather than switching: each name starts rising while the thing before
it is still on screen.

| | Zoom |
|---|---|
| Node cage fades out | 2.48 → **3.86** — *derived*, not chosen |
| Country names rise | 3.40 → 4.00 |
| Country names hold | 4.00 → 4.40 |
| **State names rise** | **4.20** → 4.90 — *begins before country starts leaving* |
| Country names fall | 4.40 → 5.00 |
| City names rise | 6.40 → 7.20 |

Measured overlaps: cage and country share the screen z3.42–3.74; country and state
share it z4.22–4.98.

- **`ADMIN.nameLadder` holds all six numbers**, as three `[start, end]` bands.
- Country and state used to share ONE band, which made them structurally incapable
  of drifting — but a shared band can only ever produce an EXACT crossfade, and the
  effect wanted on glass is an OFFSET overlap with both names briefly up together.
  Independent bands are the only way to express it, so the guarantee moved from
  "impossible to break" to "stated and checked":

  > **THE INVARIANT — NEVER A NAMELESS GLOBE.** From the cage starting to dissolve
  > until cities arrive, at least one name is on screen at every zoom. `countryIn`
  > must start before the cage is gone; `stateIn` must start before `countryOut`
  > ends.

  **Move any of the six and re-sample the whole range.** A gap is invisible in the
  constants and obvious on glass.
- **`countryIn[0]` is DERIVED from `fade.cage`. Recheck it if the dive
  choreography is ever retimed** — it is not an independent number.
- The country layer carries a `maxzoom` at the end of its fall, so past it MapLibre
  stops laying out text that is already invisible.
- **Country names have NO TOGGLE** — the one exception to "text is what toggles".
  For about a zoom level they are the only label on the map, and switching them off
  would leave a bare unnamed globe in exactly the band the ladder exists to fill.
  **A control whose off state breaks the design's own invariant should not exist.**

### 11.4 `to-number` on a missing property is 0, not null

`boundary` holds administrative borders as **linestrings** and aboriginal lands as
**polygons** — one layer, two different things. A line layer handed a polygon draws
its outline.

A country filter of `admin_level <= 2` therefore drew every aboriginal-lands
polygon as a national border: those polygons carry no `admin_level`, `to-number`
turns a missing property into **0**, and `0 <= 2` is true.

**Three rules, and they apply well beyond this layer:**
- **Never write an open-ended comparison against a property that might be absent.**
  Match the value EXACTLY. `0` can equal neither 2 nor 4.
- **Guard with `has` when a filter's correctness depends on the property
  existing.** It is the difference between a filter that means what it says and one
  that silently admits everything.
- **Filter on `geometry-type` when a source layer mixes geometries.** It is
  structural and survives schema changes that rename attributes.

Both border layers carry all three plus the maritime and aboriginal-lands
exclusions. **There is no toggle for tribal boundaries** — they are not
administrative borders in this map's sense and drawing them as such misstates what
they are.

### 11.5 Label collision order is free, and it is load-bearing

**Verified against the pinned MapLibre 5.6 source.** `PauseablePlacement` starts at
`order.length - 1` and counts DOWN, so symbols in the **top** layer are placed
first and win every collision beneath them. Storm names and forecast labels are
added above this style, so they beat basemap labels automatically — no sort keys,
no z-order juggling, no coordination between the two systems.

Within a layer, `symbol-sort-key` decides, and both place layers sort on the
schema's own `rank`. In a crowded basin the small places fall out and the big ones
survive. **That is why city labels need no per-zoom rank ladder:** one filter admits
every ranked city and collision does the thinning at every zoom.

**One consequence.** Forecast time labels must run `text-ignore-placement: false`.
At `true` they stay out of the collision index entirely, so a city name renders
underneath one and both are unreadable. The two flags are independent:
`allow-overlap: true` still guarantees the forecast label draws no matter what,
while `ignore-placement: false` makes it reserve its space. **This cannot cause a
forecast label to disappear.**
