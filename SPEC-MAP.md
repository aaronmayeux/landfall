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
  named — "Surge unavailable"), unsupported (row dims with a reason — this is
  what §4's `can` block is for). **Re-tapping an errored row is the retry.**
  An unsupported row names the source that declines, and **points at the
  surface that does answer when one exists** — see §50.11: the storm drawer's
  "In effect" section no longer dead-ends a GDACS storm, because national
  agency warnings list below it and paint the same coastal stripe.
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
| Forecast points (SS-colored, coded) | baseline, ambient at every zoom | 4 |
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
- **But the turn test may not buy a corner with a hole.** If the only pairing
  without a sharp corner leaves a gap more than `TRACK_LINE.orientGapRatio` (2×)
  wider than the closest pairing available, the turn veto is overruled and the
  tight join is taken, corner and all. **A stale forecast makes a sharp corner; it
  does not make an ocean-sized hole.** Reached glass on 2026-08-21, on both live
  NHC storms at once: the past track (MapServer layer 11) was current while the
  forecast geometry was two advisories behind, so the storm had already walked
  past its own tau 0. The correct join therefore made a near-180° hairpin, the
  turn test threw it out, and a REVERSED forecast won on a gap of ~11° against
  the correct answer's ~1.3°. The dotted past track drew along the entire
  forecast and the solid forecast line drew backwards. The override warns by name
  when it fires, because a storm that has overtaken its own forecast is a
  **clock** finding worth surfacing, not a geometry one.
- **A run that repeats another run, forwards or backwards, is dropped before
  stitching** (`runsFrom`). NHC published the final segment of the past track
  TWICE on 2026-08-21 — identical coordinates, consecutive `objectid`s — for both
  live storms. `stitch` can only chain a copy tail-to-tail, so the path walked out
  along that leg and straight back down it, and `unfold` reported the fold on
  every load. A repeated segment is a fault in the SOURCE and carries no
  information the original did not, so it is dropped rather than repaired inside
  `stitch`: the same rule the module already applies to duplicate VERTICES,
  applied one level up to duplicate RUNS. Exact coordinate match at `joinEpsDeg`
  only — near is how you delete a real leg of a track.

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
unbent — every width the redrawn cone uses is measured off that polygon rather
than modelled, which is what keeps "is my town in the cone" honest. The redraw
itself is §7.9.

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

**WHICH dot the ring lands on is decided upstream of this section (§7.11).** By
the time `stampFirst` runs, any forecast hour that has already passed is gone
and tau-0 sits on the storm feed's own position. This section is about how the
ring LOOKS; §7.11 is about where it is.

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
that job.** Category color cannot: a track running Cat 1 → 2 → 2 → 1 is
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
**Wider because color alone is not enough** — at this radius 1.5 px is a
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
4. **An angle within `minTrackAngleDeg` (20°) of a label's own track tangent is
   struck out before any arrangement is built.** The angle is shared by every
   label on a storm, so this is a property of the angle rather than of an
   arrangement; asking it per-label would ask the same question nine times and
   could answer it inconsistently on a curving track. **One label being parallel
   strikes the angle out** — on a curving track a single label lying along its
   own leg is what makes the whole set look accidental.

**The track line is an obstacle, and for a long time it was not.** Placement
checked labels against other labels and against other dots, both of which the
reader can see — and so is the forecast line drawn between them. Nothing stopped
a label lying straight along it. On a fast west-moving storm that is not a rare
case, it is the DEFAULT: the search starts at 0° because horizontal reads best,
the dots on such a track are far enough apart that horizontal clears every one
of them, so 0° passes on the first try and the whole run of timestamps is laid
down on the line.

**It is an ANGLE rule and not a clearance, and that was measured rather than
assumed.** The failure is parallelism — a label three pixels off a line it runs
beside for its whole length is as unreadable as one drawn on it, and one
crossing that same line at 40° is fine. A companion rule keeping labels a fixed
distance off DISTANT legs of the track was built and then cut: measured against
straight tracks at four spacings, three recurve shapes, two self-overlapping
loops with the legs 25px apart, a zigzag and a hairpin, it changed the outcome
on **none** of them, because the angle rule and the dot rule had already moved
every label clear. Closest approach on the worst fixture was 14px against a 6px
rule.

**When every angle is struck out, the rule bends rather than breaking.** A
zigzag whose legs run at ±30° gives tangents of −30°, 0° and +30°, and a ±20°
exclusion around each covers the whole ±45° band. The fallback keeps the angles
LEAST parallel to the track and searches those. This is also what keeps
`placeSpokes` from ever dereferencing a null winner — the fallback never returns
an empty list, so some angle always produces one. There is no null guard; a
branch nothing can reach is a branch nothing can test.

**The storm's own NAME is an obstacle too, and it outranks the times.** It is
the largest text on the map and it sits beside the position dot, which is the
anchor of the first forecast label — the busiest square inch of the whole
track, and neither knew the other existed. MapLibre cannot arbitrate it either:
the time labels carry `text-allow-overlap`, so they draw through the name rather
than yielding. So the order is fixed and one-way: `points-forecast.js` picks the
name's spot first, off the drawn geometry alone (§9.9), and hands the resulting
rectangle to `placeSpokes` as an obstacle. A time label that cannot clear it is
hidden. The name never moves for a timestamp, which is what stops the two
chasing each other around the same dot.

The rectangle is derived from the same tokens `markers.js` draws the name with,
never restated — a name that moves and a box that does not is worse than no box,
and the name genuinely moves now. `_stormName` is stamped onto forecast points
by both parsers for the same reason `_stormId` is: neither source publishes it
on the geometry, and the fields that come close change with intensity.

Measured on three live storm shapes: a diagonal track and a due-north track both
place at 0°; a due-west track has to lean (−20°). **The angle is NOT derived from
the track** — the perpendicular at each point fans the labels and puts
near-vertical text on a westward storm. Legibility won; the tangent now
constrains the shared angle rather than dictating a per-point one.

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

**A five-day track at z4 was judged on glass and kept as it is** (Aaron,
2026-08-18). No thinning, no culling.

### 7.6 Model spaghetti tracks

What the layer answers is a different question from every other layer: not "where
is the storm going" — the cone answers that — but **"how much do the forecasters'
own tools disagree about it."** A tight bundle and a wide fan produce the SAME
official cone, and until this layer the two were indistinguishable on screen.

- **Per-model selector, not one on/off switch.** Five models at once over a cone is
  a hairball; the useful question is usually "where does GFS depart from the
  consensus", which needs two on and three off.
- **Four selector rows for five techs.** TVCN and HCCA share one slot, one color
  and one pref (`consensus`): the same consensus answer under two names, never
  drawn together, and a user who switched Consensus off must not have it return
  under the other name when TVCN drops out of a cycle.
- Shortlist carries named identity colors (§6); anything beyond it draws from
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

**==> THERE IS NO ID TRANSFORM ANY MORE, AND DELETING IT WAS THE FIX. <==** The
deck filename used to be DERIVED: ask JTWC's live warning feed for a
designation (`wp1126`), widen the year to TCGP's filename width (`wp112026`),
fetch. Two failure modes, one of them seen on glass — a silent slip in the
widening fetches a real deck for a **different storm**, and the moment JTWC
issued its final warning on a dying storm the id vanished and the app never
attempted a fetch that would have succeeded. Noul, 2026-07-26: 20 kt and inland
over Guangdong, a current 12Z deck sitting on TCGP, "Model guidance unavailable"
on the row.

**As built, `/api/tcgp/storms` asks TCGP which storms TCGP has decks for**, and
`parseTcgpIndex()` reads each filename stem straight off the index page. The id
is never constructed, so it cannot be constructed wrong, and deck availability
no longer depends on another agency still issuing warnings. `data/tcgp-index.js`
holds one copy per TTL for the app. **The rule this earned: ask the source that
HAS the data which data it has.** The full account is in the header of
`functions/api/tcgp/storms.js`.

**A failed index is not an empty index.** Both index modules report a `state`,
and a caller reading an empty list on `unavailable` as "no storm has model
guidance" is §5's exact failure.

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

**Guidance is NOT faded past ~72 h.** It was considered so the near-term cluster
would read first, and rejected on glass — the tracks read correctly as they are
(Aaron, 2026-08-18).

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
restroked wider — are painted the §6 warning color. No snapping, no walking, no
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
- **THE SELECT IS INDEXED, NOT SCANNED.** Corridor legs are bucketed into square
  cells of the corridor's own half-width, each leg registered in every cell its
  W-padded box touches, so a coast vertex is tested against the one or two legs
  near it instead of all of them — Ida's main hurricane warning is 18 legs over
  531 km, which at delta density is over a million segment projections per select.
  **Whole rings are rejected by bounding box first**: the decode returns every ring
  from every loaded tile, and at a basin zoom most of that is another ocean.
  `tools/test-coast-band-speed.mjs` keeps the pre-index scan as a REFERENCE
  IMPLEMENTATION and asserts the two agree run-for-run and coordinate-for-
  coordinate. **A faster select that paints differently is worse than a slow one** —
  if they ever disagree the answer is to delete the index, not update the oracle.
- **LATENCY: A FIRST PAINT AT A NEW ZOOM DOES NOT WAIT.** `reselectDebounceMs` is
  **120 ms** and exists only to collapse the several `moveend`s a pinch fires into
  one select. It is skipped entirely when the current zoom bucket holds no band
  (`bandMissingFor`), because the wait protects work already on screen and there is
  none — what is showing belongs to the zoom the user just left. At 400 ms,
  unconditional, it was nearly half the lag between a pinch ending and the stripe
  repainting, all of it spent doing nothing.
- **Tile-boundary filter.** The ocean polygon's ring is part real shoreline and part
  straight tile edge; a kept tile edge paints a straight seam across the map. A
  segment is dropped when EXACTLY axis-aligned (within `tileEdgeEpsDeg`) and at
  least `tileEdgeMinKm` long. **A false drop costs an invisible gap; a false keep
  costs a visible seam.** `tileEdgeMinKm` is **1.0 km**: tile coordinates quantize
  to 4096 units per tile, so one quantum at z6 is ~152 m and the old 0.25 km left
  under two quanta of headroom — two consecutive REAL coastline points landing on
  one quantized meridian produced a 300 m axis-aligned segment that was dropped as
  a seam, and the gap was then frozen into the cached band. 1.0 km is ~6.5 quanta
  at z6 and still far under any genuine seam, which crosses a 100 km corridor and
  is kilometres long.
- `map/coast-band-cache.js` — **one entry per (storm, INTEGER ZOOM)**, re-selected
  on debounced `moveend`. **Coast comes from LOADED TILES ONLY**, so any single
  select is a function of where the camera was.
  **BAND QUALITY IS PER ZOOM, not one global best.** The old rule held one band per
  storm and replaced it only on a strict improvement scored by painted features then
  painted km — and zooming IN shows LESS coast in MORE detail, so it failed the
  first test before detail was considered and the sharper select was discarded every
  time. The band froze at the zoom that first covered the most coastline, which is
  also the coarsest geometry the basemap has, while the cyan sharpened under it.
  Bucketing by integer zoom is what the basemap itself does; it also keeps the
  anti-degradation guarantee for free, because zooming out finds its own bucket
  untouched rather than an overwritten one.
  **Within a bucket, runs ACCUMULATE rather than contest.** A winner-take-all rule
  inside a bucket has the same coverage blindness one zoom down: pan east, the new
  select covers less total km than the held one covering the west, loses, and the
  coast now on screen has no stripe. Merging is safe here and only here — every run
  in one bucket came off the same tile zoom, so the same coast selected twice yields
  identical coordinates and duplicates drop by signature (length + both endpoints).
  Bounded by `COAST_BAND.maxBandEntries` (LRU) and `maxBandVertices` per feature,
  oldest runs first: the newest were selected nearest where the camera is.
  **A held bucket also records the coast generation it was last folded against**, so
  an identical stamp on an identical substrate returns immediately without a ring
  decode or a band select. **The advisory stamp clears EVERY bucket for that storm**
  — a superseded warning is wrong at every zoom.
  **A STORM LEAVING THE FEED DROPS ITS BANDS.** Deselection deliberately does not
  — the storm is still out there and still drawn ambiently, so the select is still
  useful work. A dissolved storm is the other case: nothing will ask for its
  coastline again, and its entry counts against `maxBandEntries`, so it does not
  merely sit there, it evicts a LIVE storm's band ahead of time. The wire is an
  optional `forget(stormId)` hook on the layer definition, called from
  `ambientPrune` in `map/layers/registry.js`. **The engine is not told what to
  drop and must not learn** — it imports nothing by design, and the key is not the
  storm id in every case: `map/layers/surge.js` namespaces its own as
  `surge:${id}`, so each layer builds its key with the same helper its writes use.
  `clearBands` drops everything and **has no caller in the app**, which is correct
  rather than a gap: it was written for a basemap style RELOAD, and a theme change
  is `setGlobalState` now, so the style loads once per session. Unreachable, not
  obsolete — the same read `registry.js` records for its retired `invalidate()`.
- **Severity stacking.** Overlapping products (a Hurricane Watch atop a Tropical
  Storm Warning) paint the same coast; `line-sort-key` via `wwSortKey()` makes the
  severer color win the pixels — §6 safety contract.
- **THE STRIPE IS THE COASTLINE, RESTROKED — TWO PASSES, ON THE COAST'S OWN WIDTH
  CURVES.** The cyan coast is a bright core over a wide blurred halo, and the warning
  color REPLACES both. Painting only the core leaves the cyan halo fringing out
  either side, which reads as a coast drawn twice rather than a coast recolored.
  Widths are MULTIPLIERS on `coastCoreWidth()` / `coastGlowWidth()` (exported from
  `map/style.js`, one definition for both callers), never pixel values:
  `SIZE.stripeCoreScale` 1.8, `stripeGlowScale` 1.3. The stripe therefore inherits
  the coastline's depth fade for free and cannot drift away from it.
  **The core and the halo are scaled DIFFERENTLY on purpose.** The core is scaled to
  emphasise; the halo only has to cover the cyan one, and scaling it to match the
  core pushes soft color ~2 px past anywhere the cyan reached — which on a coast
  like the Mississippi delta, where marsh islands sit a few pixels apart, fills the
  water between them and rebuilds a slab in a dimmer color. 1.3 keeps the stack's
  shape: the halo stands off its core by the same margin the cyan halo does.
  `tools/test-coast-stripe.mjs` asserts the RELATIONS at every zoom band, never a
  pixel value, so a coastline restyle drags the stripe along and a stripe that stops
  tracking the coast fails whatever width it picked.
- **Fallback keeps NHC's chords, flagged `_banded: false`** with a reason
  (`no-coastline` / `no-coast-in-band` / `not-a-line`). Official geometry isn't ours
  to curve, and no coast loaded in the corridor is `unavailable` (§5), never "no
  warning here". **How that chord DRAWS is §7.10** — deliberately not in this
  stripe's paint.
- **The legend dedupes by type** (`wwLegend`). One warning paints several coast runs;
  iterating naively stacks five identical rows.
- **`tcww` is the field carrying the TCWW code.** `lib/watchwarning.js` reads it
  directly and keeps a value-scan only as a fallback, because a scan over every
  property could match a stray "HWR" in a descriptive field and paint the §6 safety
  colors wrong.

**`W` = 50 km, picked off a live prototype** against real breakpoints: 15 km caught
only half of Galveston Bay; 35 km painted the full Galveston–Trinity–Sabine system;
50 km also reached the inner Matagorda Bay shore. Wider won. Flat caps held at every
width — the unwarned coast east of the last breakpoint never painted. Confirmed
against the real tile coast on glass; it is one constant if it ever needs moving.

**Recoloring the drawn basemap coastline is NOT possible.** The rendered coast is
the edge of an ocean POLYGON, one feature covering a huge area. MapLibre's only
mechanism for restyling part of a vector-tile layer is `feature-state`, whose unit
is the WHOLE FEATURE; there is no way to address the portion of a polygon's edge
between two points. Recoloring it would recolor every coast in the tile.
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
recolor has to drag the field with it. Two earlier passes deliberately chose
colors AWAY from the coast; both were rejected on glass. The two read apart by
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
stations, when the assembled ring still crosses itself after `maxLoopCuts`, when
the outline is degenerate, when the rebuild sits deeper inside the published cone
than the blur window can account for, or when less than `minAheadFrac` of the
published cone lies ahead of the storm. **Every refusal is said once on the
console** — the first version fell back silently, which is indistinguishable
from running and being no good, and cost a full round of work to notice.

#### The ring is asked, not the walls (2026-08-22)

**This refused on a flank that FOLDED, and that was the wrong question.** A
`folds` helper asked whether either edge ever stepped backwards against the
track's own direction. Good smell, wrong harm: the harm is a RING that crosses
itself, because MapLibre fills the doubled-over region as a hole.

Measured on Lala's archived bytes: her flanks fold on the recurve and **the
assembled ring does not cross itself**. A wall can reverse into a cusp without
the boundary ever crossing. So the rebuild was turning away a shape that was
perfectly safe to draw.

The ring is now assembled first and asked directly, and any loop it does carry is
CUT (`lib/unloop.js`, shared with §7.12's wind swath — both are offset curves and
both fold the same way). Refusal is kept for a ring still crossing after
`CONE_SWEEP.maxLoopCuts`: that is a shape nobody has measured, and a cone with a
hole in it is worse than the published one.

**THE COST OF THE OLD VETO WAS BIGGER THAN THE CONE.** Across Ida's 35
advisories it refused 12. Every one of those took §47.5's environment ribbon onto
the fallback path with it — which is what Aaron saw come and go on Lala
(2026-08-18). **All 35 now rebuild**, and none of them crosses itself.

#### The published cone's tail is behind the storm, and is not ours to cover

§7.11 moved the forecast track's start onto the storm's real position. The
published cone still starts at the ANALYSIS position, which on a lagged advisory
is a long way back: measured on Lala 2026-08-22, advisory 36A's apex sat at
26.65°N while the feed had her at 28.60°N — **135 miles ahead**.

A cone redrawn along the track cannot cover ground the track no longer crosses,
so the undercut guard read that as a **1.62° undercut against a 1.27° allowance**
and refused an otherwise sound rebuild. Before the re-anchor the same measurement
was 0.12°. **That regression arrived with §7.11 and is recorded rather than
quietly patched over.**

**The guard now asks its question only where the track actually goes.** A
published vertex whose projection falls behind the first station is skipped;
everything from the storm forward is checked exactly as before, so the guard's
real job — catching a cone that does not belong to this track — is untouched.

**THE COST IS REAL AND IT IS ACCEPTED (Aaron, 2026-08-22).** The drawn cone is
SMALLER than the one NHC published, by whatever the feed is ahead of the
advisory. What is dropped is the uncertainty about hours that have already
happened — water the storm has crossed — and nobody is at risk from a claim about
where it might have been yesterday. Drawing it would be §7.11's lie in a third
place. Measured effect on Lala: the drawn cone's apex moves from 135 miles behind
the storm to 33, which is its own rounded start cap.

**`CONE_SWEEP.minAheadFrac` is the backstop.** A cone with less than half of
itself in front of the storm is a different situation from anything measured —
the advisory is old enough that its shape says little about where the storm is
going — and it falls back to the published outline, which carries its own age
stamp (§4). Presenting a sliver as the whole forecast would be the §5 failure
this skip could otherwise cause.

**A REFUSAL COSTS THE DRAWING NOTHING AND MUST NOT COST THE MEASUREMENT
EITHER.** `lib/cone-measure.js` `measureConeRibs` is the second path, taken by
`lib/cone-smooth.js` whenever the rebuild declines **or was never offered the
cone at all**. It casts the same
perpendicular rays at the same stations and then stops — no blur, no gap-fill,
no fold test, no ring. Every point it returns is a ray hit on the published
polygon, which is the shape being drawn on that path, so §47.5's ribbon fits it
by construction rather than by agreement. The published outline is drawn with
its corners rounded (`curveGeometry`), which moves it by at most 3.1 km across
the whole Ida corpus.

**IT MEASURES THE RING THAT WILL BE DRAWN, NOT THE ONE THAT ARRIVED.** The
fallback outline is the published one with its corners rounded, which moves it by
at most 3.1 km. That reads as nothing on paper and as a grey rim between the
color and the cone edge on a phone, because a five-day cone fills the screen. The
ring is curved once and handed to both, so the two cannot disagree by any amount
at all rather than by an amount somebody decided was small enough.

**A FOLD PINCHES THE EDGE.** On the inside of a bend tighter than the cone is
wide, consecutive perpendicular rays hit the outline in reverse order and the
edge has nowhere further to go, so the point is held at its predecessor. That is
the shape the union-of-circles boundary genuinely has there, consecutive slices
go on sharing a boundary vertex, and the held point is itself a ray hit so the
segment joining them cannot leave the cone. The first version MARKED both
stations instead and let `lib/cone-ribbon.js` skip the slice — a slice spans many
stations, so one bad station cut a black wedge clean across the cone at the
inflection, which reads as a rendering fault rather than as an absence.

Pinched ribs share edge points, so slice rings are deduped like every other ring
in the app; a repeated vertex is a zero-length segment with no direction.

`ok: false` therefore means exactly one thing: no ray hit at this station.
`measureConeRibs` refuses outright on the same 60% hit floor the rebuild uses;
below that the track and the cone are not describing the same storm and §47.9 has
a sentence for it.

**The caps are the outline's own nose and tail, walked** — the arc of the drawn
ring between the end station's two edge points, taken on the side that lies
ahead. Exact, so the day-5 circle is the day-5 circle. Two earlier versions are
recorded in `lib/cone-measure.js`: clipping to a half-plane self-intersects on a
hooked cone, and the rebuild's half-ellipse sat up to 17.5 km off the ring
actually on screen.

**Measured across every Ida advisory (35 cones, `samples/ida-al092021/gis`):**
**all 35 rebuild** since the loop cut replaced the fold veto (it was 23 rebuilt
and 12 measured), none are blind, and every one colors 100.0% of its cone with no
slice sitting outside the drawn outline and none crossing itself.

**The corpus no longer volunteers a refusal, so the fallback path is now
exercised deliberately** — `tools/test-cone-sweep.mjs` and
`tools/test-cone-smooth.mjs` trim a track to its last 30%, which puts most of the
published cone behind the first station and trips `minAheadFrac`. Both suites had
warned in their own comments that a change accepting everything would leave them
silently testing nothing; this is that change, and the warning was honoured
rather than deleted.

**THE REBUILD'S BAR STAYS HIGH, AND ONE ATTEMPT TO LOWER IT IS WORTH THE
PARAGRAPH.** The fold guard was found to be refusing a third of Ida's advisories
— on advisory 006, from ONE station out of 316 — so the widths were held back to
the exact bound at which it fires. All 35 then rebuilt, and ten of the twelve
recovered outlines crossed themselves. The guard is a cheap PROXY for
self-intersection, not a test of it, and holding every segment forward satisfies
the proxy while the inside edge loops around and crosses further along. The
finding underneath: a swept ribbon is the wrong model for a cone on a tight bend.
A published cone is a union of growing circles, and on the inside of a bend that
union's boundary is the outer envelope of the overlap; an offset curve has no
envelope, so it loops. No threshold fixes that, which is why the second path
measures rather than redraws.

**THE THREE INPUTS DO NOT ARRIVE ON THE SAME BRANCH OF LONGITUDE.** §7.4 emits
the smoothed track UNWRAPPED on purpose — past ±180, so MapLibre draws one
continuous line across the seam — while the cone arrives wrapped into
(−180, 180]. Every dateline-crossing storm therefore refused itself, silently,
across the western half of the West Pacific. Everything is moved onto the
track's branch before it is measured; rings move as one piece after being made
continuous, because per-vertex would tear a straddling ring across the world.

**THE SAME SEAM CUT THE CONE ITSELF IN HALF, AND THE APP DREW BOTH HALVES AS
IF THEY WERE WHOLE.** Fixed 2026-08-20. NHC serves geometry wrapped into
(−180, 180], so a cone that crosses the antimeridian CANNOT be one polygon: it
is cut along the meridian and returned as a `MultiPolygon` whose two parts each
carry a straight artificial edge down the seam. Lala CP012026 advisory 33:
1,332 points spanning −180.00 to −170.58, and 191 points spanning 178.78 to
180.00. **The two seam edges are the same edge** — both run between latitude
37.8069 and latitude 33.9638, to ten decimal places.

Two things then went wrong, both seen on glass:

- **`curveGeometry` rounded the artificial edges.** It thins each ring to knots
  and puts arcs back between them, and it has no way to know one of those
  corners is not real. The western half bulged to −180.24 and the eastern to
  +180.22, each pushing a curved nose across the meridian into the other's
  ground.
- **The outline layer stroked them.** `map/layers/cone.js` draws a fill and a
  line, and the line strokes every ring it is handed — so both cut edges were
  painted as real cone edges. On screen: two overlapping lens shapes with a
  hard line down the middle of a cone that has no edge there at all.

**`lib/seam-stitch.js` puts the shape back together before anything reads it**,
and it is its own file because nothing in `lib/` owned the question *did this
polygon arrive whole?* — every consumer assumed it had, and each went wrong
differently when it had not. It is a STITCH rather than a union: the two halves
share one exact edge, so the repair is to delete that edge from both and splice
the open paths, with the eastern half moved one whole turn onto the western
one's branch. **Area is the assertion that proves it** — a stitch that dropped
a stretch of outline or tied a bow at the join would still close and still look
plausible in a coordinate dump, and the test checks the result against NHC's
own published `st_area(shape)` of 48.1509 rather than against our arithmetic.
Anything that is not a clean two-part cut is handed straight back untouched
(§5: the repair must never return something worse than its input).

The stitched cone is a single Polygon again, so it is also **offered to the
rebuild** instead of being turned away at the door. Its longitudes run past
−180 rather than stopping there, which is `lib/trackline.js`'s convention for
the track and is what makes it one shape instead of two on opposite rims of the
map.

**ONLY THE CONE IS STITCHED TODAY, AND THAT IS SCOPE RATHER THAN A FINDING.**
Every layer on the MapServer arrives wrapped the same way, so the wind swath,
the current wind field and a watch/warning chord are all cuttable by the same
meridian. None of Lala's were — all of them sit well east of it — so there are
no bytes to build against, and §5's rule about not guessing at payload shapes
applies to a repair as much as to a parse. The stitch is written to take any
geometry, so the day one of them arrives cut it is a call site, not a design.

**AND THE SAME SEAM TOOK THE RIBBON A SECOND WAY, THROUGH A GATE RATHER THAN
THROUGH ARITHMETIC.** Fixed 2026-08-20. `lib/cone-smooth.js` put ONE test in
front of both paths — single polygon only. That bar belongs to the REBUILD, and
it is correct there: a multi-part cone has no single spine, and sweeping one
track through two shapes would merge them into an outline no source published.
**It does not belong to the measurement**, which rays against every ring and
returns nothing that is drawn.

Sharing it mattered because **NHC's MapServer cuts a cone at ±180 and returns
the halves as a `MultiPolygon`.** Lala CP012026 advisory 33: one part spanning
−180.00 to −170.58, a second of 191 points spanning 178.78 to 180.00. She
failed the shared gate, came back with `ribs: null`, and §47.6's row told the
reader *"This cone could not be measured"* — about a cone that measures
perfectly. Handed the same two rings directly, `measureConeRibs` returns **236
stations out of 236, with no station losing its ray to the seam**, and the
ribbon builds 81 slices from hour 0 to hour 120.

**THIS WAS A WHOLE FEATURE MISSING FROM A LIVE BASIN, NOT A CORNER CASE.**
SHIPS covers the Central Pacific, whose five-day cones reach the seam as a
matter of routine. The two gates are now separate: `sweepable` still demands a
single polygon, the measurement asks only for a track and at least one ring.
The stitch above hands most seam cones back whole, so this gate rarely decides
anything on one any more — it stays split because a genuinely multi-part cone,
one the stitch could not recognise, must still be MEASURABLE even though it can
never be swept.

`tools/test-cone-dateline.mjs` asserts against Lala's actual bytes
(`samples/lala-cp012026/`) rather than a two-part cone somebody drew, because a
synthetic fixture built from the same idea of the bug as the fix is a test that
agrees with the code instead of checking it. Reinstating the shared gate fails
eight of its assertions.


### 7.10 When there is no coast to paint — the dashed chord and its breakpoints

`map/coast-fallback.js`, shared by the watch/warning stripe (§7.7) and the surge
reaches (§40). One module, both callers, because the trap is identical on each.

**The rule: a guess must not look like a measurement (§5).** The band select
paints a product onto real coastline where it can find some. Where it cannot, it
keeps NHC's delivered chord — the straight joins between named breakpoints —
flagged `_banded: false`. Keeping it is right; a warning that vanishes is the
silence §5 forbids. **Drawing it in the stripe's own paint was not.**

**Measured on glass, Lala advisory 25, 2026-08-18.** A Tropical Storm Watch
(French Frigate Shoals → Maro Reef) and a Hurricane Watch (Maro Reef →
Lisianski Island), both for the Northwestern Hawaiian Islands. Real orders on
real land — atolls a few hundred metres across, far below anything OpenMapTiles
carries, so both features fell back. On the phone: two fat solid strokes across
empty Pacific with no land in frame, reading as "the app drew a coastline in the
middle of the sea." The flag had existed since the band select was written and
nothing had ever read it.

**What an unbanded product draws now**

| | Banded (§7.7) | Unbanded (here) |
|---|---|---|
| stroke | `stripeCoreScale` 1.8 + glow 1.3, on the coastline curve | `trackForecastWidth`, flat, no glow |
| pattern | solid | dashed, `chordDash` [4, 1.5] in line-width multiples |
| opacity | `stripeOpacity` 0.9 | `chordOpacity` 0.85 |
| breakpoints | — | an OPEN RING at every vertex, `chordMarkRadius` 6.75 |

- **The rings are the point.** NHC's line is not a shape it surveyed; it is the
  straight joins between named places, and those places are the only part of the
  geometry that is exactly true. Anchors with an approximation strung between
  them is an honest picture; a confident solid stroke is not.
- **==> IT CARRIES THE FORECAST TRACK'S WEIGHT, NOT THE COASTLINE'S, AND THAT IS
  A CORRECTION MADE ON GLASS. <==** The first pass tied the chord to
  `coastCoreWidth` and held it at 0.6 opacity, reasoning that a fallback should
  look like the weakest thing on the map. It came out at model-track weight, and
  beside five model lines carrying `modelDash` [3,2] the reader had no way to
  tell a government order from a model's opinion (Aaron, 2026-08-18). **A watch
  is not a guess about where the storm goes; it is a fact about where the order
  applies.** It gets a decided line's weight — `trackForecastWidth` by
  reference, so a track restyle drags it along — and the DASH plus the open
  rings carry the "we could not snap this to a shore" reading instead. The dash
  keeps longer marks and shorter gaps than `modelDash` so the two textures never
  converge, and `tools/test-coast-fallback.mjs` asserts that as a relation.
- **Consequence, stated rather than discovered later:** the chord no longer
  inherits the coastline's depth fade, so it stays legible at globe distance.
  For a line whose whole job is "an order reaches here", that is the right trade.
- **The rings are HOLLOW, and the emptiness is the meaning.** A FILLED dot in
  this app is a storm of a known Saffir-Simpson strength (§6) — that equation is
  load-bearing and `map/watch-marks.js` already forbids borrowing it. An open
  ring says "a place", which is what a breakpoint is, and it lets the chord and
  the track beneath read through instead of being punched full of holes. The
  product colour therefore rides the STROKE.
- **==> THE CHORD STOPS AT EACH RING'S OUTER EDGE AND DOES NOT ENTER IT. <==**
  Aaron's call on glass, 2026-08-18. A line running THROUGH an open ring makes
  the ring look like a bead threaded onto it — decoration — and the reader stops
  seeing it as a place the order reaches. A line that stops short reads as
  arriving AT something. `trimChords` pulls both ends of every segment back by
  `chordMarkRadius + chordMarkStroke + chordMarkClearPx`.
- **The trim is done in SCREEN PIXELS, via `map.project`, and it has to be.**
  The ring is a fixed pixel radius, so the gap it needs is a pixel distance too;
  trimming a fixed number of degrees would bury the line inside the ring zoomed
  in and cut a hole hundreds of km wide zoomed out. Same tool
  `map/layers/points-forecast.js` uses for label placement.
- **Every segment becomes its own part.** NHC products run to a dozen
  breakpoints, and a single polyline trimmed only at its two ends still runs
  through every ring in the middle. Splitting an N-point line into N−1
  independently trimmed segments handles interior rings for free.
- **Two rules keep the trim honest.** (1) **Rings are cut BEFORE the trim** —
  they belong on NHC's original breakpoints, and marking trimmed geometry lands
  every ring a gap-width inside the place it names. (2) **A feature is never
  emptied.** A segment with no room left is dropped, but if that leaves nothing,
  the feature keeps NHC's untrimmed geometry — deleting a live government order
  from the map for a cosmetic reason is the §5 failure. A map that cannot
  project passes features through untrimmed for the same reason.
- **It goes stale mid-gesture, deliberately.** Both callers re-run `decorated()`
  on `moveend`, so the gap is right on any settled camera and can drift slightly
  during a pinch. Cosmetic drift on a thin dashed line is not worth a per-frame
  recompute.
- **Ring radius sits between the first pass (3.5) and a forecast point
  (`pointRadius` 10)**, Aaron's call on glass: 3.5 could not be found on a
  phone, a full 10 would compete with the dots carrying the category codes. It
  is a fixed pixel radius, not a zoom curve — the app OPENS at globe distance
  and a layer that goes silent there says nothing when it matters most. A ring
  is a LABEL, never a footprint (same reasoning `map/watch-marks.js` gives for
  `sizeAttenuation: false`).
- **Colour is untouched.** Saffir-Simpson and the NHC watch/warning hues are the
  §6 fixed contract. A Hurricane Watch is pink whether or not we managed to snap
  it to a shore. What the fallback changes is the CONFIDENCE the drawing claims,
  never the severity it reports.
- **Shared breakpoints are not deduped.** Adjacent products butt end to end —
  Lala's watch and warning share Maro Reef exactly — so two dots of different
  colours land on one coordinate. Merging would mean choosing a colour for a
  place genuinely under both orders; the sort key already answers that
  everywhere else products overlap, so it answers here (§6).
- **Marks copy their parent's properties wholesale**, which is what lets the
  caller's existing colour and sort-key expressions work on a dot without
  knowing dots exist. They must therefore be cut AFTER the layer stamps its
  colour on: cut a line earlier and `to-color` of undefined renders every dot
  BLACK, silently, in both themes — the failure `map/layers/points-forecast.js`
  already paid for once. `tools/test-coast-fallback.mjs` drives a real bundle
  through the engine to pin it.
- **Stripe and reach layers filter to `_banded: true`.** That filter is the fix;
  without it the chord goes straight back to wearing the coastline's paint, with
  nothing erroring.

**Known open:** the drawer's IN EFFECT rows (SPEC-UI.md §16) do not say which
products fell back. The panel reads the raw NHC slot and has no view of what the
map snapped, so saying it there means plumbing map state into the panel. Left
undone deliberately — the map now says it itself.

### 47.5 The environment ribbon — the cone, colored by what the environment is worth

`lib/cone-ribbon.js` builds the slices, `map/layers/environment.js` draws them,
`app/bundle-pipeline.js` `withEnvRibbon` is the join. **Additive layer, default
off**, sitting directly under the cone in the Layers panel (§47.9).

**The cone fill FIRST, and the track line with it.** SHIPS has no left-to-right
information — one point per forecast hour, the storm centre, and nothing about
how the environment varies across the cone's width. It cannot say the west half
differs from the east. But each published number is already an area average over
a region a few hundred kilometres across, which at most forecast hours is
**wider than the cone itself** — Pacific cone radius is 46 km at 12 h and 256 km
at 120 h. So painting the cone claims an area smaller than the one the number
came from, and a hairline alone would imply knowledge at a point. **The cone is
therefore the surface that carries the number**, and it is what §47.11's legend
keys.

**The line was added on 2026-08-16 and it adds no claim.** It lies inside the
cone it repeats, colored from the same number at the same stations, so it
asserts nothing the fill was not already asserting — and it earns its place at
the near end of the forecast, where the cone is 46 km wide and at a whole-basin
zoom is barely a few pixels of color. The first twelve hours are the part of the
ribbon a reader most wants and the part the fill is least able to show them.

`lib/cone-ribbon.js` emits **one collection with two kinds of feature** —
`_kind: 'slice'` for a cone polygon, `_kind: 'line'` for the stretch of
centreline it covers — built in the same loop, off the same stations, from the
same number. That is the whole guard against the two disagreeing: nothing
computes the value twice. `map/layers/environment.js` splits them by kind at the
source rather than with a MapLibre `filter`, because a filter still ships every
polygon to the line layer's worker to be discarded.

**THE LINE IS DRAWN AT `STORM_GEO.trackForecastWidth`, EXACTLY — the track does
not get fatter when the ribbon is switched on** (Aaron, 2026-08-16). It covers
the white forecast track rather than replacing it, which is also what makes
§47.6 free: where a run stops short of the cone, the colored segments simply end
and the white line continues from there, so the line stops being colored at the
same hour the fill does with no third thing to keep in step. It sits above the
forecast track and below the forecast dots, which carry category color and a
classification code and must never be painted over.

**IT USES THE CONE'S OWN RAMP, LIFTED ONLY WHERE A COLOR WOULD VANISH**
(`lib/cone-ribbon.js` `liftToLegible`). "Hostile dissolves into the sea" is right
for a translucent shape the width of a five-day cone and is a bug on a 1.75 px
line: measured against the night ocean the fill ramp reads **1.05 : 1** at its
hostile end and 2.70 : 1 through its middle, and in the light theme the hostile
stop *is* the daylight sea. With the environment number running p5 −14 kt,
roughly one hour in twenty would draw the most load-bearing line on the map in a
color that cannot be seen — §5 silence.

**THE FIRST ANSWER WAS A SECOND RAMP AND IT TRADED ONE FLATNESS FOR ANOTHER.**
`envRampLine` held three stops each tuned to clear the bar. It met the
requirement and compressed the *whole* journey to do it, not the end that needed
it. Measured on Lala, whose environment ran −2 kt at the storm to +32 kt by day
five: everything past hour 60 clamps to the ramp's bright end, and across the
half that did not, the fill travelled `#51448f → #c4b0ff` and plainly read as a
gradient while the line travelled `#8d80d3 → #c4b0ff` and read as one flat color.
Two surfaces carrying the same number and one of them showing it (glass,
2026-08-18).

So the floor is a per-color **lift** now, not a ramp. A line color is the cone's
color, unchanged, wherever that color already clears
`ENV_RIBBON.lineMinContrast` (3 : 1, WCAG's bar for a graphical object and the
same bar the wind bands are held to). Where it does not, it is blended toward the
ramp's own far end until it does, by bisection — sixteen steps, once per slice,
at bundle build time and never per frame. Above the crossover the line and the
fill are now the same pixel value rather than two nearby ones.

**IT IS DELIBERATELY NOT A LIGHTNESS FLOOR.** Brightness inverts between the
themes and saturation does not, so a lightness rule would lift the light theme's
line *toward* the water it is trying to be seen against. Contrast against the
ocean is the rule this section states, and it holds in both. Lifting runs toward
the ramp's far end because that is the direction "more environment" already runs,
which preserves the hue journey — and **only as far as the bar**, because
overshooting to the far end would paint a hostile stretch in the fully-favourable
color. That reads as the line and the cone disagreeing, and it trips no
legibility check, because the far end is the most legible color there is.

Measured across both palettes: dark lifts below about +4 kt, light below about
+8 kt, worst case 3.00 : 1 in each. The line and the fill never point opposite
ways; the line simply refuses to reach zero. **If the track is ever widened, the
floor can come back down.**

**IT SLICES THE STATIONS THE CONE REBUILD IS ALREADY ASSEMBLED FROM.** §7.9
walks the smoothed track at uniform stations and measures how far the published
outline lies to either side; `sweepConeDetail` returns those left/right pairs
alongside the ring, and a slice is one station's two edge points and the next
one's. Nothing measures the cone twice, because two measurements could disagree
and the disagreement would show as a ribbon that does not fit the cone it is
painted inside.

**A slice spans several stations, and the two spacings are different numbers
for different reasons.** The cone is measured every `CONE_SWEEP.stepDeg`
(0.06°, ≈6.5 km) because its EDGE has to read as a curve; the fill's color
comes from a number published every six forecast hours. `ENV_RIBBON.sliceDeg`
(0.2°) is therefore roughly three times coarser, putting sixty to eighty slices
on a five-day cone. Every intermediate station is still a vertex on both edges,
so a slice hugs the same curve the cone edge is drawn from: the saving is
polygon count, never shape.

**The spacing is set by BANDING, not by cost.** Each slice is one flat color,
so the step between neighbours is the whole color change across its length.
At 0.6° that step spanned 65 km and the eye drew a line on it — a cone came out
in stripes rather than as a ramp. The underlying number really is published
only every six hours, so the stripes were arguably honest; they still read as a
rendering fault. The cone EDGE is already around 800 vertices, so slice count
is not the expensive thing on the screen, and if it ever stripes again the dial
is 0.1° rather than something cleverer: a fill layer cannot carry a gradient,
so more slices is the only real answer.

**THE TWO ENDS OF THE CONE ARE NOT SLICES, AND THEY ARE PAINTED SEPARATELY.**
A station's rib is a cut across the cone; a cap is the half-ellipse *beyond*
the last station, and no pair of stations spans one. Slicing the ribs alone
covers the straight middle perfectly and drops the rounded nose and tail
through to the plain veil — a grey blob at each end of a cone whose run
published a number for every hour it covers, which reads as missing data.
`sweepConeDetail` therefore hands each cap back as its own closed ring — the
two cap quarters plus the rib that closes them against the body, deduped like
the outline is, since both quarters own the point dead ahead — and the ribbon
paints one feature each.

**A cap is painted only if the track end it touches is.** The nose cap *is* the
day-5 circle, so the last drawable hour is genuinely the number for that
ground. But when a run stops short of the cone (§47.6) the ribbon has to stop
mid-cone, and painting the far cap would jump the gap and put confident color
on the one stretch nothing is known about. Each cap borrows from its own
neighbouring slice or it is not drawn. The tail cap sits behind the current
position and takes the fix's color, which is already the +6 h value inherited
back — the same number one slice further along, claiming nothing new.

**The color of a slice is the environment at its MIDDLE station.** Taking
either end makes every slice a whole step brighter or darker than the stretch
it represents, which on a storm whose number moves 13–21 kt along one cone is a
visible shift of the entire ribbon.

**WHEN THE CONE REBUILD REFUSES, THE RIBBON IS MEASURED INSTEAD OF LOST.** §7.9
returns the published outline rather than a worse shape whenever the track cannot
see its cone, a flank would fold, or the rebuild sits too deep inside the
published shape. That was the end of it until 2026-08-18, and it cost a third of
Ida's advisories their entire ribbon — color that came and went between
advisories on a storm whose SHIPS data never had a problem, which is what Aaron
reported on Lala.

The reasoning that stood behind it was that a ribbon built from widths the guard
had just rejected would sit visibly inside the drawn cone edge. **That is true of
the REBUILD's widths and not of a fresh measurement.** `lib/cone-measure.js`
re-casts the rays against the published polygon and takes the raw hits, so every
rib end lies ON the outline the map is drawing, to within a metre. Nothing is
blurred, nothing is gap-filled, and no shape is invented — the two operations
that make a width right for drawing are exactly what make it wrong for measuring
someone else's.

**A fold pinches the edge rather than costing a slice** (§7.9). The first cut at
this marked the folding stations and skipped their slice, which on glass was a
black wedge across the cone at the inflection — a slice spans many stations, so
one bad station takes the whole thing. `ok: false` now means only "no ray hit
here", and a slice is skipped only for that. A swept rib carries no `ok` at all
and is trusted; the test is `=== false`, never a truthiness check, or every slice
on the path that works today would silently vanish.

**The two paths cap their ends differently, and that is not an oversight.** A cap
is the stretch beyond the end station that no pair of ribs spans; without one a
fully-colored cone shows a grey blob at each end (glass, 2026-08-15). The rebuild
is inventing a shape, so its cap is a half-ellipse anchored at the two flanks and
the reach dead ahead, and its own undercut guard prices it. The measured path is
inventing nothing and walks the drawn ring's actual arc. A cap whose end station
has no measurement is not drawn.

**THE JOIN IS BY FORECAST HOUR, NEVER BY SHIPS'S OWN COORDINATES.** SHIPS can
be newer than the advisory — a 06 UTC run against a 00 UTC advisory (§47.2) —
so its latitudes and longitudes are a different forecast from the one the map
draws, and anchoring to them would slide the colors off the track by however
far the two disagree. The stations are uniformly spaced by arc length, so each
carries a fraction along the track and the hour is interpolated between the
forecast points' own fractions. An anchor whose hour would run backwards along
the track is dropped rather than allowed to invert a stretch of ribbon.

**The two sides of that join do not arrive on the same branch of longitude.**
The stations come back on the track's branch, which §7.9 leaves unwrapped past
±180 so the cone draws as one continuous shape across the antimeridian; the
forecast points arrive from the source wrapped into (−180, 180]. The same
ground is −182 in one and 178 in the other, so each anchor is moved onto the
stations' branch by whole turns before anything is measured. Without it the
nearest-station search reads most of the way around the planet and the ribbon
refuses itself outright — silently, and only on storms crossing 180, which
includes the western half of a basin SHIPS covers.

**The fix has no number of its own, and is never given an invented one.** The
contribution table starts at +6 h — every value in it is a change *from now*,
so there is no column for now. Filling the gap with zero lands dead centre of
the ramp and paints a confident mid-violet "neutral" over the storm's current
position: the brightest thing the eye goes to first, asserting something the
file never said, and doing it worst on a storm the environment is tearing
apart. **The fix inherits the +6 h color instead.** Six hours is well inside
the area each SHIPS number already averages over, so carrying it back one slice
claims less than the number already claims. Starting the ribbon at +6 h and
leaving the fix on plain cone fill was considered and rejected: it puts a
visible seam at exactly the point the reader looks first, which reads as a
rendering fault rather than as honesty.

**Two channels, two meanings, deliberately separated.** Cone width and cone
edge carry "how sure we are *where*"; the fill carries "why". The edge keeps
its own neutral color and is never touched by the environment, so the shape
reads even where the fill has fallen to nothing.

**THE SEAM FIX IS `fill-antialias: false`, AND IT IS LOAD-BEARING.** Per-slice
transparency paints every shared edge twice and the cone comes out looking like
corduroy. MapLibre has no equivalent of the SVG group opacity the mockup used —
`fill-opacity` is per layer, and adjacent translucent polygons in one fill layer
blend against each other at their shared edge either way. So the slices share
their vertices EXACTLY, no overlap, and antialiasing is switched off, which is
what stops MapLibre feathering each polygon's edge and leaving a hairline where
two meet. `ENV_RIBBON.fillOpacity` (0.5) then lives on the layer, once, and
cannot stack.

**TWO PRESENTATIONS, LIKE EVERY OTHER GEOMETRY LAYER — an ambient source and a
selection source, identical in paint.** §7's engine excludes the selected storm
from the ambient merge so its geometry never draws twice, which means a layer
holding only an ambient source draws everything EXCEPT the storm the reader has
open. On this layer that erased the tapped storm's ribbon and restored it when
the drawer closed, while every other storm on screen kept its color — an
absence that reads as a caching fault rather than as a missing presentation.
`tools/test-env-ribbon-layer.mjs` runs the real engine and asserts the slices
are on the map after a tap.

**It is drawn ABOVE the plain cone fill, not instead of it** (order 11, against
the cone's 10). §47.6's fourth case — a healthy run publishing nothing drawable
— is 6% of the season, and the ribbon can also stop short of the cone's end.
Keeping the veil underneath makes that free: the cone is one shape whose front
half is colored, rather than two shapes clipped against each other. The veil is
0.08, so what shows through under a slice is negligible.

**THE COLOR IS RESOLVED IN JAVASCRIPT AND BAKED ONTO EACH FEATURE.** It cannot
be a paint property: a MapLibre expression holding both a themed `global-state`
reference and a `['get']` evaluates in the worker, which is never sent the
state, and resolves to BLACK in both themes without throwing (§9.3, rule 1b).
Model guidance and the genesis patches already take this route. A theme change
re-pushes every bundle, so the ribbon rethemes for free and needs **no** entry
on that section's list of exceptions.

Ramp: ocean → indigo → violet, smooth, `DARK.geo.envRamp` and
`LIGHT.geo.envRamp`. **Brighter is the environment working for the storm;
darker is it working against.** Three stops rather than two because a
brightness-only ramp moves one channel while a hue shift moves two. The dark
end is the ocean color rather than a grey, so a hostile stretch dissolves into
the sea instead of sitting on it as haze. Violet is the one hue nothing else on
the globe uses — not a category, not a watch or warning, not a wind band, not
the genesis teal.

**The light theme's ramp is not the dark one lightened.** The rule that
survives the theme is "hostile dissolves into the sea", and the daylight sea is
pale — so the first stop is `LIGHT.ocean` and "more environment" runs toward a
deeper, more saturated violet rather than a paler one. **Brightness therefore
inverts between the themes and saturation does not**, which is the channel §9.2
already leans on everywhere else.

**Open caution, and the season moved it to the other end of the ramp.** The
worry was that bright violet would collide with Cat 5 magenta. It will not.
Measured on the season's only major hurricane, three ways, because the three
give different answers and it matters which is quoted: on its **peak 140 kt
run** the environment number ran −13 to +3; across **every hour it was Cat 3 or
above** it ran −16 to +7 with a median of −4.5; across **its whole life**,
including when it was a weak storm, it ran −16 to +26. So the bright end is
reachable by the storm but essentially not while it is a monster.

The real risk is the opposite end. At a median of −4.5 on a ±15 ramp, a major
hurricane's cone sits in the darkest third — and the dark stop is deliberately
the ocean color. **A Cat 5 will be nearly black through the middle of its cone,
and whether that reads as "the environment is against it" or as "this layer is
broken" is a glass call.** Judged on the mockup as a dark passage bracketed by
lighter fill at both ends, not as a dead layer, because the number recovers
toward the end of the track. If a future storm stays hostile from end to end
and the cone reads as broken, **the fix is the dark stop, not the scale.**

Two things that argue it is fine as drawn: the number moved 13–21 kt along the
cone within a single major-hurricane run, so it is not a flat wash; and a major
hurricane read neutral only 19.9% of the time against 50% for the season, so
the layer is *more* expressive on a strong storm, not less.

Reference implementation: `mockups/environment-ribbon.html`, built on real
SHIPS numbers.


### 7.11 "Now" is where the storm is — re-anchoring an overtaken forecast

`lib/forecast-now.js`, run from `app/bundle-pipeline.js` `forMap`, **before**
`smoothTracks` (§7.4).

**A forecast's first dot is never "now". It is the ANALYSIS hour.** Three
published clocks describe one storm and none of them agree:

| source | what it is | how fresh |
|---|---|---|
| `CurrentStorms.json` | the storm's position | freshest we ever hold |
| MapServer past track / points | the record | behind the feed |
| MapServer forecast track / points | the projection | behind BOTH — its first hour is an analysis hour, not a publication time |

Measured on the archived bytes of 2026-08-21T23:30Z (`samples/lala-cp012026`,
and reproduced identically on Moke CP3):

```
storm feed       advisory 038, 21:00Z, 28.6N 170.4W, HU 80 kt
past points      published 21:04Z, newest fix 18:00Z at 28.1N 170.7W
forecast points  advisory 36A, published 12:02Z
                   tau-0  valid 09:00Z at 26.9N 171.2W
                   tau-12 valid 18:00Z at 28.1N 171.3W
```

**The forecast was not wrong. It had been overtaken.** Its tau-12 named 28.1N
at 18Z and the record independently put the storm at 28.1N at 18Z — that hour
verified. Two of its hours had simply become history and were still being drawn
as future.

**What that did on glass** (Aaron, 2026-08-22): the white ring is drawn on the
lowest-tau forecast point (§7.5 `stampFirst`), so it sat 117 miles behind the
storm; and §7.4 joins the end of the record to the start of the forecast, so the
dotted history climbed to its own newest fix at 28.1N and **doubled back 83
miles** to reach the ring. The return leg lies half a degree from the outbound
one, so it reads as one line that ran too far and stopped beside the second
forecast dot. Aaron identified that the thing beside that dot was itself a real
position; it was the 18Z fix.

**THE RULE. A forecast hour that has already passed is not a forecast.** Leading
expired hours are dropped, and one new tau-0 is placed on the storm feed's
position. Both the forecast line and the record then join there.

- **Expiry is walked from the front, never filtered.** A source publishing taus
  out of order would otherwise have a hole cut from the middle of its forecast,
  and the forecast LINE — which carries no times at all — could not follow.
- **The line is trimmed by COORDINATE, not by count.** Its leading vertices must
  BE the expired points (`FORECAST_NOW.matchEps`, a float-equality tolerance far
  smaller than NHC's ~0.1° position grid). A line and a point set from different
  advisories fail this and the whole re-anchor is abandoned.
- **The new tau-0 takes its position from the feed and its classification from
  the newest published past point** — reported, never derived (§4). The ring is
  therefore coloured by the same fix that colours the last leg of the trail
  behind it. Identity fields (`basin`, `stormnum`, `idp_source`, `advisnum`,
  `_stormId`) ride through from the hour it replaces, so grouping, tap targets
  and label placement are unchanged. It is stamped `_now: true`.
- **`FORECAST_NOW.expiryGraceMs` is one hour**, shorter than the shortest gap
  between published taus (12 h) so it can never keep two expired hours alive,
  and longer than any poll interval so the decision is stable across a refresh.

**THE RECORD IS NEVER TRIMMED.** The tempting fix was to cut the past track back
to the forecast's start so the picture tidies itself. That deletes the storm's
two most recent real positions to make a line look neat — the confident-wrong
failure §5 exists to prevent. History is kept whole; the stale claims about the
future are what go.

**EVERY GUARD BAILS WHOLE.** No feed position, an unreadable time, a line that
disagrees with the points, an entirely expired forecast — each returns the
bundle untouched. A half-applied re-anchor, points moved and line not, is a
worse picture than the one this fixes. A wholly expired forecast belongs to
`lib/silence.js` and its badge, not here, and says so on the console rather than
blanking silently.

**Side effect, and a wanted one:** §7.4's seam warning ("the past track has most
likely overtaken a stale forecast") was firing on every NHC storm. Once the
overtake is removed at source it stops firing, and goes back to meaning
something.

`tools/test-forecast-now.mjs` asserts all of it against the archived bytes, and
asserts that the raw bytes still reproduce the fault — if NHC's clocks ever line
up, the suite says so rather than passing vacuously.

**The same fact arrives through a second door in §7.12.** The wind swath builds
its own timeline and had the same stale hours folding it back. Fixed there
separately, because the swath never reads this module's output.


### 7.12 The wind swath's two folds — the timeline, and the walls

`lib/windswath.js`, built at parse time in `data/nhc-mapserver.js`. It never
reads the smoothed track (§7.4) — it is assembled from NHC's published quadrant
polygons and the centres they hang on.

**Aaron on glass, 2026-08-21: the bands carried fins, spurs and slivers instead
of reading as continuous corridors.** One symptom, two causes, proven separate.

#### Fault 1 — the timeline folded back on itself

The swath lays its centres out in travel order: past fixes, then the feed's
current position, then the forecast by ascending tau. The old rule dropped
forecast tau 0 before splicing, on the stated reasoning that the synoptic
analysis sits BEHIND the current position and inserting it after would fold the
timeline. **That reasoning was exactly right and the list was one entry long.**

Measured on the archived bytes: the feed had Lala at 28.6N at 21:00Z while
advisory 36A, published nine hours earlier, ran tau 0 at 26.9N *and tau 12 at
28.1N*. Dropping tau 0 alone left the spine going

```
current 28.6N  ->  tau-12 28.1N  ->  tau-24 29.8N
```

Half a degree backwards, against a corridor 130-160 nm wide. Both walls swung
round and crossed.

**Every forecast hour behind the current position is dropped now, not just tau
0.** Decided on the centre's own valid hour against the feed's `observedAt`,
which `data/nhc-mapserver.js` passes in as `currentPos.at`. **Time first, tau as
the fallback** — a source publishing no usable clock keeps the old tau-0
behaviour exactly, because an absent time is not evidence an hour has passed.

The centre's hour, not the wind rose's. NHC published this advisory with
forecast POINTS on a 09Z cycle and wind RADII on a 06Z synoptic; ordering the
timeline by one clock and placing it by the other is how this gets subtly wrong
in a way nobody sees.

**This is §7.11's fact arriving through a second door.** A forecast hour that
has already happened is not a forecast, wherever it is being drawn. The two
modules fix it independently because the swath does not read the track.

#### Fault 2 — the offset walls crossed themselves

Offset a curve inward by more than its own radius of curvature and the wall
swings round and genuinely crosses itself, over tens of vertices, at honest step
spacing with gentle per-vertex turns. **Every local test passes.** The existing
despike only sees a hairline fold — a near-reversal on sub-step segments — and
is blind to this.

Measured before the fix, all of it between 27.8N and 30.4N, Lala's recurve:

| band | crossings | loops enclosing |
|---|---|---|
| 34 kt | 3 | 90, 41, 25 vertices |
| 50 kt | 3 | 52, 25, 5 vertices |
| 64 kt (one run) | 1 | 26 vertices |

**Cutting the loop is the correct answer, not a cosmetic one.** The region the
ring describes is the UNION of every wind rose along the path. On the inside of
a tight turn, the boundary of that union is the ENVELOPE of the offset curve —
the offset curve with its self-intersection loops trimmed. The loop is an
artefact of tracing a boundary the swept area never had, and every point inside
a cut loop is still inside the ring, claimed by the samples either side.

**A self-intersecting ring was not merely ugly — it was punching holes.** Fill
treats the doubled-over region as outside. Measured: cutting the loops raised
the share of published wind-rose boundary points falling INSIDE the drawn band
from 77.8% to 78.8% while total area fell 0.85%. Less area, more coverage.

- **The cutter lives in `lib/unloop.js`, not here.** §7.9's cone rebuild is the
  second caller — both are offset curves and both fold the same way, and two
  copies of this maths could drift into a wind band that cleans up beside a cone
  that does not.
- **A uniform spatial grid finds the crossings, not an index window.** An index
  window is a guess: too small and a wide fold draws, too large and the O(n²) is
  back. The measured folds spanned 5 to 90 vertices and nothing says the next
  storm's sit in that range. Bucketing by position has no such parameter.
- **The larger piece wins, by area.** A crossing splits the ring in two; which
  is the storm and which is the artefact is decided by comparing areas, never by
  assuming the loop is the shorter run of indices. That assumption holds for
  every fold measured here and would fail silently the day it did not.
- **`WIND_SWEEP.maxLoopCuts` is a guard, not a dial.** Eight, against the six a
  real storm produced. Hitting it means the cut is not converging: the band is
  drawn as it is — a slightly wrong band beats a missing one (§5) — and it says
  so on the console. Raising it to silence a warning would be treating the
  symptom.

#### Both are needed

On the repo fixture (forecast and current tiers) fix 1 alone clears every fold.
On the FULL tiers, past wind field included, fix 1 alone leaves one folding band
on Lala and the cut clears it. `tools/test-windswath-folds.mjs` asserts fault 1
end-to-end and exercises the cut on constructed rings, where its behaviour can
be reasoned about exactly.

**KNOWN AND NOT CHASED.** Sampling published wind-rose boundaries at their exact
radius, 78.8% of Lala's and 65.1% of Moke's fall inside the drawn band; at 0.8x
radius that is 95.8% and 76.2%. The shortfall is the documented smoothing shrink
(a smoothed radius can never exceed a published one — Aaron's stated trade,
smoothness over accuracy) plus §5's run-break rule, which refuses to sweep a
threshold across a time NHC published no ring for. Moke's lower figure is the
run-break rule doing its job. Neither is a bug; both are recorded so the numbers
are not rediscovered as one.


## 9. Design

### 9.1 The visual contract

- **All colors, type and spacing in one tokens file; all motion durations and
  easings in one motion constants file.** Zero hardcoded hex, zero raw pixel
  literals in feature code. §6's fixed colors live there too, marked
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
- **A row that pairs two typefaces or two sizes states `align-items: baseline`.**
  Flex and grid align the child BOXES by default, which is not the same as
  aligning the text inside them — two faces at one font-size put their baseline
  at different heights, so a label/value row drifts apart by a pixel or more on
  every line. It shows on a desktop before it shows on a phone, because the
  desktop font pairing is wider apart. `tools/test-css-vars.mjs` sweeps for it.
- **Hover has its own token and it is never a panel colour.** `--hover` is a
  light wash in the dark theme and a dark one in the light theme, so both
  answer a pointer with the same strength of change in opposite directions.
  Reaching for `--glass-raised` looks right and is not: a dark panel laid over
  a dark panel over a near-black ocean moves the composite by single digits and
  is invisible in the one place hover exists at all. Hover stays below the
  selected treatment and never carries severity (§6).

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
administrative furniture are all neutral, so severity color has nothing to
compete with. `error` / `stale` / `ok` keep a hue because they are status words,
`focusRing` because it is an accessibility affordance that must never read as a
border, and the install amber because it is a brand color.

**The cage and its nodes are neutral. The coastline and the population heat
carry dark mode's CYAN.** The cage is ~7,680 edges over the whole planet, so by
area its resting color IS the color of the app — a hue there sits underneath
every storm bloom and competes with it. That is what the greyscale base is for,
and the cyan cage tried from 2026-08-08 lost the argument. `node` follows `mesh`:
same furniture, and splitting them reads as a rendering fault. The coastline is a
thin line rather than a field, so it tints nothing, and it is where the app's
identity carries across themes. **Same hue angle as dark, not the same hex** —
dark's `#4FD1E8` measures 1.05:1 against this ocean and would fail the required
`coastline vs the ocean` pair. A bright line glowing on a night sea becomes a
dark line drawn on a pale one; hue carries the identity across, lightness has to
move.

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
  §6's fixed severity colors live on the glyph, the dot and the swatch, all of
  which are drawn opaque and untouched. This is the dial for "storms do not pop
  enough in daylight".
- The chosen segment of a control goes **down** in lightness and up in edge
  strength. A step further toward white is a step toward invisible.
- **The install button is dark mode's `#F0B23C` in both themes.** It works
  because the fill and the boundary are two tokens: `installCtaEdge` — a dark
  amber — draws the 1px edge that WCAG 1.4.11 actually asks for, and is also the
  color of the manual-install heading, which is TEXT and cannot be yellow.
- **There is no starfield in daylight.** The token is held near the sky rather
  than removed, so there is no "if light, skip the stars" branch to forget.

**The space backdrop is a radial gradient, not a color.** `#spacebg` runs
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
**The token range is not the visible range.** `#spacebg` is
`radial-gradient(120% 120% at 42% 30%, near 0%, space 60%, far 100%)`. At 120%
the 100% stop lands outside the viewport, so the darkest pixel on screen is
around 83% of the way — roughly 58% of the space-to-far delta. `near` at 0% is
a single point, already blending toward `space` a few pixels out. Better than a
third of every number in the tokens never reaches the screen, and the geometry
is shared with dark, which reads correctly — so the compensation lives in the
light values. That is why they look extreme beside dark's and are not.

Both themes carry the same **profile** — most of the range behind the globe,
little in the corners. Dark is +9.8/-1.1; light is **+17.2/-16.6**. A given L\*
step is also a smaller perceptual event at the light end, so matching dark's
numbers produced a bloom that measured identical and read as weaker. Shape has
to match; size is a glass call, and it took five of them.

**The cost, and the lever if it goes wrong.** The bloom is now slightly
BRIGHTER than the land — `land3d` L\* 96.1 against the near stop's 96.8 — so
inside it the continents are carried entirely by `coast3d` (4.77:1) and read as
faintly darker than the sky behind them, which is what a backlit limb does.
Against `spaceFar` at the corners they have 33 L\*. If that reads as broken
rather than as lit, the lever is **`land3d` down** — a light grey continent
against a white sky. Bringing the bloom down has been rejected three times.

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
panels over `ocean`, a flat color, and a blur is precisely what protected text
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

**Every themed color MapLibre draws is a `["to-color", ["global-state", key]]`
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

**Only paint colors belong in state.** A `global-state` reference in a *layout*
property re-layouts every tile on change, which is the cost this exists to avoid.

**And never in an expression that also reads feature data.** MapLibre evaluates
a data-driven paint property — one containing `['get', …]` and friends — in the
WORKER, and the worker is never sent the global state.
`_findGlobalStateAffectedSources` does not help: it only reloads a source for a
LAYOUT or filter reference. It does not throw; `to-color` of the missing value
is **black, in both themes, permanently**. This shipped on the first forecast
dot's white ring, and the tell was that the `circle-stroke-width` beside it —
the same `case` on the same `_first`, plain numbers in its branches — worked.
The way out is not a cleverer expression: either the color is genuinely
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
- **Model guidance colors.** The line paints `['get', '_color']` — the color is
  a property of each *feature*, resolved by `modelColor()` at push time — so it
  rethemes by re-pushing bundles already in memory.

If that list ever grows past three, the mechanism is wrong rather than the list
being short an entry.

**What enforces it.** `tools/token-check.mjs` walks every `gs('…')` in `map/`
against `THEME_STATE` in both directions and resolves every palette path against
both palettes; it also fails on a single `palette()` call in `map/style.js`. A
missing key is not an error in MapLibre — it is a silently rejected layer.

It also resolves the local alias `P`, **but only in a file that contains
`const P = palette()`.** `P` is a one-letter name and the palette does not own
it: the check once read `ui/chart-home.js`'s `const P = []` — a list of past
track points — as a palette, and demanded colours named `push` and `length`. A
file declares itself by aliasing, so a new builder is covered the moment it
does and nothing is skipped by name.
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
surface using `NormalBlending` paints its own color over the map and can darken
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

**===> DISTANCE FOG RECOLOURS. IT DOES NOT FADE. <===** `scene.fog` blends a
fragment toward `space` by depth and never touches alpha, and that distinction
was invisible for as long as only the dark theme existed. Dark's `space`
(`#04070E`) sits within a few levels of `spaceNear` (`#0F1F38`), the backdrop
actually behind the globe at the planet band — so a fully fogged cage line lands
on the backdrop's own value and disappears. Fog *appears* to fade things out
there. It does not; it happens to arrive at the right colour.

The light theme gets no such luck. `space` is `#C2C6CA`, pinned to the ocean's
value on purpose, while the bloom behind the globe is `#EFF7FF` — about 30 levels
apart, and every far-side fragment lands on that gap. Measured on the cage: the
far lattice read **44 levels off its backdrop in light against 8 in dark**, better
than five times as visible, which is the whole of "we can see too clearly through
the globe."

**`map/fog-fade.js` gives fog the missing half: it fades ALPHA with depth as
well.** Eight lines of GLSL patched into Three's own fog block through
`onBeforeCompile`, reusing the `fogFactor` already computed. Strength is
`fx().fogFade` — **0 in dark, which is a measurement and not a default**, and
0.90 in light, tuned to land on dark's own 8-to-10 levels. One number reconciles
the two themes. Confirmed on a phone in both themes, 2026-08-21.

- **The haze starts at the LIMB, never before it.** `DIVE.fogFadeStart` is the
  fog factor at the terminator (0.357), *derived* from `fogNearBack` /
  `fogFarAhead` rather than typed beside them. The near shell stays crisp glass
  and only the inside of the sphere hazes. This matters in light specifically:
  the coastline is all that holds the continents apart from the bloom, and a
  translucent near limb would give that away to fix a far-side problem.
- **Structure fades; information does not.** Far-side land, coast, cage,
  storm-lit fill and nodes take the haze. **Storm glyphs and watch rings are
  excluded** — a cyclone is not less true for being on the far side of the world,
  and a mark that dissolves with depth is the app under-reporting (§5). They fog,
  so they recede; they never fade out.
- **Do not "fix" this by moving the light theme's fog colour to the bloom.** It
  hides the far side at the planet band and breaks the moment MapLibre fades up
  underneath, because MapLibre's daylight ocean *is* `#C2C6CA`. The correct fog
  colour would have to change with zoom. Alpha does not care what is behind it.
- **A translucent shell inside the sphere — literal smoke in a glass ball — is
  not available.** It would have to draw after the far-side geometry and before
  the near-side, and the cage, nodes, coastlines and fill are each ONE draw call
  spanning both hemispheres. Only the land is split front/back. Rejected.
- **The failure mode is silence.** The patch string-replaces a `#include`; if
  Three ever stops emitting it the replace finds nothing, throws nothing,
  compiles fine, and the far hemisphere quietly returns.
  `tools/test-fog-fade.mjs` pins that chunk text against the vendored build.

### 9.4 The node cage — an information surface, not decoration

**Node elevation AND node color encode live storm severity.** Each node rises by
a Gaussian heightfield over the active storms and simultaneously blends toward
that storm's §6 category color.

**===> ELEVATION AND COLOR ARE ONE SIGNAL FROM ONE NUMBER. <===** Two channels,
one number: a Cat 5 is both the tallest peak and the only pink one, so severity
survives being read at a glance, on a small screen, at an angle. **This invariant
has drifted twice at this same seam. Watch it.**

- Nearest storm wins outright — a node between a Cat 1 and a Cat 5 must not invent
  an in-between hue that means nothing.
- Heights and colors ease in/out together and recompute on the storm poll.
- **On a feed outage the cage desaturates to grey — colors included**, so a held
  peak cannot keep showing a category the feed can no longer vouch for — and holds
  its last shape. It never flattens to a fake all-clear (§5).
- Node count and spacing are a frame-budget decision (`geoDetail`); peak shape is
  tuned by `stormAmp` / `stormSigma`.
- Severity peaks are a **sharp local spike, not a regional swell**: `geoDetail` 3
  (642 nodes), `stormSigma` 0.16 rad (~9°), `stormAmp` 0.5, and a perceptual
  ramp (sqrt curve, `sevMinLift` 0.22 floor) so a 40 kt TS clears the cage's
  decorative noise instead of reading as flat ocean.
- **`sevMinLift` IS THE HEIGHT OF THE DEPRESSION CLASS, not a floor for edge
  cases.** `sevFloorKt` is 34 kt, which *is* the tropical-storm threshold, so
  every tropical depression there has ever been clamps to exactly this number.
  At 0.16 a live depression stood at half the lift of a finished storm.
- **The fade lives at the EDGE of the raised region, not across it.** Lift is
  remapped through a threshold band (`stormColorOnset`..`stormColorFull`), so the
  entire lifted cage sits at its storm's exact `CATEGORY_COLOR` and the gradient
  occupies roughly one ring of nodes just outside it. A single gamma exponent
  across the whole lift range spreads tint over barely-raised nodes, wraps every
  storm in a halo of muddy purple-grey, and never lets the peak reach its true
  hue. **A storm color that never actually appears is not a severity color.**
- **The band is read as a fraction of the WINNING STORM'S OWN PEAK**
  (`litAmount` divides by the winner's severity), so a weak storm is as solidly
  its own color as a strong one. Read as an absolute lift it assumed every
  storm's peak clears `stormColorFull`, and a depression's peak never does — see
  §9 in `SPEC.md` for the measurement. **Retuning these two constants without
  reading `litAmount` first puts every depression back under the floor.**
- **The RESTING cage stays at FULL brightness** (`meshRestDim` 1.0). Dimming the
  99% of the lattice that is storm-free to flatter the 1% that isn't makes the
  calm globe nearly invisible on a phone. Storm colors get their separation from
  saturation, hue distance and a narrow fade band, not from suppressing
  everything around them.
- **The cage's hue is chosen to clear the category colors either side of it.**
  It sits between `CATEGORY_COLOR.TS` (green, hue 145) and `CATEGORY_COLOR.TD`
  (blue, hue 205), and at its original 191 it was 44° clear of the green and 16°
  off the blue — at identical lightness, so a depression's lit nodes read as a
  slightly duller lattice. Now 175 in dark and 178 in light, roughly 30° to each
  neighbour. §6 colors are fixed and cannot move; the cage is what gives way.
- **The soft falloff is free.** The cage is `LineSegments` with a per-vertex color
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

**"FULL TRACK" MEANS THE WHOLE PUBLISHED TRACK.** `pastHours` 336 and
`forecastHours` 120 — fourteen days back, which reaches the first fix of any
cyclone on record, and NHC's and JTWC's own five-day forecast horizon. The
window was 72/72, which left the ridge visibly shorter at BOTH ends than the
track line drawn on the map beside it, under a control labelled "Full track" and
a sentence promising "each storm's whole path". Two surfaces disagreeing about
one storm reads as a rendering fault, not a choice. The hours are bounds rather
than infinities only so a bad timestamp cannot drag a bead into the last century.

**`maxPointsPerStorm` 96 is a guard, not a trim.** A fourteen-day storm is ~56
six-hourly past fixes plus nine forecast taus; a typical one is 20 to 30 points
total. It exists for a source that starts publishing hourly, and hitting it thins
by dropping alternates rather than truncating, so a capped ridge still spans the
whole window. **It is also the cost ceiling** — every point is tested against
every node on a recompute, so this number times the storm count is the work a
poll does. Measured in the sandbox: 1,440 points (the pathological case) is
~10 ms; a realistic 15 storms at ~30 points each is ~3 ms.

**HEIGHT IS INTENSITY, NOTHING ELSE.** A bead stands at the wind measured (or
forecast) at that position, so the tallest point on a storm's ridge is its
STRONGEST point — past, present or future — wherever that falls. Documented to the
user as *"the tallest point is the storm at its strongest, whether that has
happened yet or not."* **Check which mode is on before diagnosing a height
complaint.**

**Do not taper height with age or lead time.** It breaks the one-signal invariant
(color is each position's true category and is never tapered, so a Cat 4 three
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

**IT IS THE SHORTEST THING ON THE GLOBE, AND THAT ORDERING IS THE POINT.** 0.08,
a third of the weakest live storm and about seven times `baseLump`. It was
briefly derived as `stormColorFull + 0.02`, to guarantee the grey arrived at full
strength — sound reasoning with a backwards result, because it spent HEIGHT to
buy COLOR and left a finished storm standing at 0.32 against a live tropical
depression's 0.16. Twice as tall, in near-white, on the loudest channel the globe
has. The relative color band above removed the need: a low peak is now a fully
saturated peak, so the lift is free to be as short as it deserves. **A dead storm
must never out-rank a live one on height** — assert it, don't assume it
(`tools/test-mesh-ridge.mjs`).

This **reverses** the earlier "past beads keep their real colors and heights,
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
UNDER IT.** One winner per node owns both height and color, and influence
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
flat map, where past points are individual colored dots with no winner-takes-all
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
storm's color; everything else is fully transparent. It makes a storm read as a
**presence in an area** and not only as a spike.

- **It is a third reader of the one signal, never a fourth channel.** The fill
  shares `nodeGeometry`'s position attribute outright, so it is the lattice's own
  surface tenting up with the nodes that carry it. Its color is the cage's
  resolved color and its alpha is the same lit ramp that decides the tint
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
  schedule. Outage behaves like everything else: shape held, color muted grey.
- **One token: `OPACITY.meshFill`. Set it to 0 to retire the fill outright** —
  that is the off switch as well as the tuning knob.
- Measured at `geoDetail` 3: 642 nodes / 1,920 edges / 1,280 triangles. One settled
  Cat 4 lights 24 nodes and 65 triangles — 5% of the mesh, one extra draw call, no
  index rebuild when storms move.

### 9.6 Land, coast and atmosphere

- **Land is filled.** Filled land against dark ocean reads as a globe and gives
  storm dots and cones something solid to sit on. Values chosen against the §6
  storm colors. At the planet band the 3D clear globe is what shows (charcoal
  `land3d`); the MapLibre land below it drops to near-ocean and resolves to solid
  by the regional band.
- **Glowing coastline edges are the same line drawn TWICE** — wide/dim/blurred
  underneath, thin/bright on top. MapLibre's `line-blur` does what a third pass
  would have. **Do not "restore" a third pass.**
- Depth fade: line opacity and width driven by zoom, so distant coastlines are
  faint threads and near ones are crisp.
- **The rim light at the horizon is `map/limb-rim.js` (§9.17), and until
  2026-08-21 this paragraph claimed it came from the 3D clear globe.** It did
  not. There was no rim-light material in `map/globe3d.js` and there never had
  been — no shader, no shell — so between the handoff and §9.17 the horizon had
  nothing on it at all. It is emphatically not MapLibre's sky layer either:
  that layer is forced fully transparent on the globe projection, which is why
  the `atmosphere` token spent months wired to `horizon-color` and reaching
  nothing.
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
color are fixed at every band; what changes is only how much supporting
information sits around it. **If someone has to zoom in to discover that something
is dangerous, the design failed** — and that is truest at the band where you can
see every storm at once.

Four bands, not eight, so the transitions are felt rather than guessed at.

| Zoom | Land | Storms |
|---|---|---|
| **z0–2 · Planet** | Solid continents under the cyan node cage; far side dimmed through the clear ocean; grey coast | Category-color glyphs; severity as node elevation AND node color, plus a low storm-color wash inside every lit triangle. **No labels.** |
| **z3–4 · Basin** | + major islands; 3D cage handed off to MapLibre, continents solid | Storm names. Track, cone and forecast points are **already drawn** — they arrive with MapLibre itself. **At z4:** forecast time labels and the watch/warning stripe |
| **z5–6 · Regional** | + detailed coastline, inlets | (no new storm layers — the set is complete by z4) |
| **z7–8 · Local** | Full coastline detail, bays, barrier islands | + surge bands, wind bands |

- **No names at z0–2.** Six names scattered across a globe you can barely see is a
  mess, and at that distance the question is "how many and how bad", which color
  and glyph already answer.
- **The storm name is the LOUDEST label on the map, and it had been the
  quietest.** `SIZE.stormLabelPx` is 14 — above the state names around it — in
  its own ink, `geo.stormLabelColor`, with `stormLabelHaloPx` 1.8. It used to be
  12px in the chrome's `textSecondary`, borrowed through global state: smaller
  and dimmer than basemap furniture that is genuinely less important than the
  thing the app exists to show. **The ink is a cartographic decision, not a
  chrome one** — the light theme's globe is greyscale, so what the name needs
  there is decided against land, not against a glass panel, and it is near-black
  on the day globe against near-white on the night one. It is paired in the
  palette with the halo it is read against, the same way `labelColor` and
  `labelHalo` are for the time labels.
- **`stormLabelGapPx` is clearance from the DOT'S EDGE, not an offset from its
  centre.** `text-offset` is measured from the anchor point, so the old literal
  `1.3` em had the forecast dot's radius silently baked into it and left about
  five pixels of daylight — the name read as stuck to the dot. Stated as
  clearance, the number means something and stays correct if either the dot or
  the text changes size. The offset is computed in `markers.js` from
  `STORM_GEO.pointRadius` and its stroke, because at this zoom a live storm's
  position dot IS its tau-0 forecast point.
- **THE NAME IS ALWAYS CENTRED ON ITS DOT. THE ONLY QUESTION IS ABOVE OR
  BELOW.** `map/layers/name-placement.js`. Below leads, because it is what the
  app has always done and what the eye is trained on; if the drawn forecast
  line or one of its dots runs through that box, the name flips to centred
  above instead. Each candidate is tested in screen pixels against every leg
  of the drawn line and against every forecast dot, and the first that clears
  both wins. `LABEL_PLACEMENT.namePadPx` (4) is the tolerance on the ESTIMATED
  text box, not spacing — the name has its own 1.8px halo and is legible right
  against a line; what it must not do is sit ON one.
- **IT OFFERED EIGHT SPOTS FIRST, AND GLASS THREW SIX OF THEM OUT.** The sides
  and the four diagonals were built, shipped and judged. They always found
  clear air, and the result looked wrong: a name anywhere off the vertical
  reads as knocked askew rather than as placed, because a label's job is to
  look like it belongs to the dot it names. The six spots were bought with the
  ugliness of the result, which is a bad trade. Do not add them back on the
  argument that they reduce the fallback rate — that is the argument that was
  already tried and already lost.
- **THE COST IS A HIGHER FALLBACK RATE, AND IT IS THE RIGHT TRADE.** A track
  that leaves the dot going up and comes back down through it clashes on both
  spots. It goes below the dot with `fellBack` set, because the name is the one
  label that says WHICH STORM THIS IS, and a track with no name on it is worse
  than a name with a line through it (§5). Below is where the name has always
  lived, so the degraded case degrades to the familiar one rather than to
  something new and strange. A storm with no forecast points, or one placement
  has not run for yet, gets the same below-the-dot default.
- **WHY IT IS NOT DONE FROM `headingDeg`.** The obvious cheap version is to
  flip the name to whichever side the reported motion is not. Reported motion
  and the drawn first leg disagree, worst on exactly the storm that showed the
  bug — Hernan reported 245° against a drawn 193°, a 52° error, where Lala and
  Cristobal were within 10°. `headingDeg` is also null for every GDACS storm.
  The name is placed off the DRAWN geometry, in screen space, or it is not
  placed at all.
- **The dependency runs one way and the ORDER inside it runs one way.**
  `map/layers/*` must never import `markers.js`; `markers.js` may import from
  `map/layers/*`. So `points-forecast.js` — the only module that projects the
  forecast and therefore the only one that knows which way the track is drawn —
  computes the spot and publishes it; `markers.js` subscribes and stamps
  `_nameAnchor` / `_nameOffset` as data-driven layout. Within
  `points-forecast.js` the name is chosen FIRST, off the raw geometry, and the
  time labels are then routed around the box it landed in (§7). The name
  outranks the timestamps and never yields to them, so the two can never chase
  each other around the same dot.
- **The subscription is made once, at module scope, not inside
  `addStormMarkers`.** That function runs again on every restyle, so a
  subscription taken inside it would leave the previous pass's listener alive
  and unreachable, and a few theme switches would fire several `setData` calls
  on the storm source for one camera move.
- **THE NAME LAYER STILL PARTICIPATES IN MAPLIBRE'S OWN COLLISION, AND CAN BE
  SUPPRESSED OUTRIGHT.** Everything above decides where the name is DRAWN; it
  does not force it to draw. A time label that survives placement can still win
  the collision against it and take the name off the map entirely. Left that way
  deliberately: `text-allow-overlap` on the name would also let two storms'
  names overlap each other, which is worse than one name thinning out. If a name
  goes missing beside a busy track, this is the mechanism, not a placement bug.
- **The PAST track is not an obstacle, deliberately.** Only the forecast line
  and its dots are tested. The past track is dim and dashed and reads as
  context; the forecast line is solid and is what the app is for. Feeding past
  geometry in would mean passing it between two layer modules that do not talk.
- **THE CROSSFADE GATES STORM GEOMETRY — there is no zoom step for it.** Track,
  cone and forecast points carry no `minzoom` at all. They are part of the MapLibre
  canvas, which is itself fading in across `zSpace..zHandoff`. A hard z-floor
  underneath a fade already hiding the same pixels is a second gate doing the first
  gate's job.
- **`ZOOM.ambientGeometry` (z4) is RETAINED and gates exactly two things:**
  forecast time LABELS (ambient and selected both, via the shared `timeLabelLayer`)
  and the watch/warning stripe (`amb-ww-glow` / `amb-ww-core`). Labels need a floor
  because text at planet distance is unreadable clutter; the stripe because it hugs
  coastal detail that does not exist yet.
- **Ambient and selected storm geometry render IDENTICALLY.** Selecting a storm
  changes the camera and the panel, not what is drawn. Two code paths that were
  supposed to look the same, and could drift, became one.
- **The watch/warning stripe draws at z4, ahead of the coastal detail it hugs.**
  Deliberate: a warning is safety information and waiting until z7 to show it is
  worse than showing it imprecisely.
- **The z-thresholds were judged against a real basemap and kept** (Aaron,
  2026-08-18), including z0–2 carrying no text.

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
- **Covered-but-on-screen is a THIRD anchor case, not a flavor of off-screen.**
  When home is on the near face, inside the viewport, and merely underneath a panel,
  the pointer anchors at the GLYPH's own projected position and chrome avoidance
  slides it the shortest way clear — parking it directly against the top edge of
  whatever is covering it. Marching to the viewport edge first drifts the pointer
  sideways whenever home is off-centre, measured up to 44 px. **This bullet
  described behaviour that did not exist for three weeks**: the commit message that
  claimed it (2026-07-23) never contained it, and the gap was unobservable because
  the drawer had simultaneously fallen out of the selector lists below, so the state
  could not arise at all.
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
- **A SELECTOR THAT MATCHES NOTHING FAILS SILENTLY, AND ONE DID.** Both lists named
  `#panel-storms` and `#panel-home` for three weeks after those elements were
  replaced by the single `#drawer`. `querySelectorAll` returns an empty list and no
  error, so the drawer quietly stopped being an obstacle AND stopped being an
  occluder: the house slid under an open sheet with no pointer ever appearing, and
  every other check in the repo stayed green. `tools/test-chrome-avoid.mjs` now
  requires every `#id` named in either list to exist in `index.html`.
- **A FADED CONTROL IS NOT AN OBSTACLE.** On a phone the control cluster steps
  aside when the drawer opens (`opacity: 0`), but it is still laid out and still
  measures its full box. Anything under 5% opacity, `visibility: hidden`, or
  `display: none` is skipped, or the marker hides behind buttons that are not on
  the screen and the pointer dodges empty air. A threshold rather than an equality
  because the cluster spends a quarter of a second at fractional opacity.
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
  `SIZE.glyphArmWeight` strokes each outline in its own fill color before
  filling it. Unmodified, the arms taper to points that fall below a pixel at the
  12-24 px the glyph occupies on a phone, and the mark reads as a blob with a
  hole. Measured across 12/16/20/24/32/48 px: this weight holds the eye open and
  the four arms separate down to ~16 px, and roughly double it fuses them into a
  pinwheel — the worse failure, because a fused mark still looks deliberate.
- **THE HALO IS ONE INK IN TWO SHAPES, AND ONLY ITS SHAPE IS THEMED.**
  `geo.glyphHalo` is dark in both modes because it does a different job in each:
  on the night globe it deepens a bright mark against lit land, and on the pale
  daytime globe it is the only thing separating the mark from the sea. So in
  **dark** it is a soft blurred drop shadow; in **light** it is a crisp keyline
  at `SIZE.glyphKeylineWeight`, no blur at all — the same soft shadow on grey
  water reads as a smudge under the mark rather than as part of it.
  **It cannot simply be deleted in light, and the numbers are why:** §6's
  severity colors are fixed, and against the light ocean the fills measure
  1.03–1.87:1 where the findability floor is 3 — Cat 2 at 1.03 is the sea's own
  luminance. The ink is 10.77:1 there. `contrast-check.mjs` reads the TOKEN, not
  the render, so it would go on passing while every glyph below Cat 4 stopped
  being findable in daylight. **The keyline weight is set by the downscale, not
  by taste:** a 256px texture rendered at 40px is a 6.4× reduction, so a rim
  thinner than about 1 screen pixel arrives as a broken speckle along the edge
  instead of a line. That is worse than the smudge, and it is what the first
  attempt at half the arm weight actually produced.
- **ONE ENGINE DRAWS IT, AND IT IS THE MESH.** `map/glyph.js` is shared. MapLibre's
  copy is deleted: its zoom band reached full opacity at z3.4 while the mesh does
  not finish handing off until z5.0, so for 1.6 zoom levels two copies of one spiral
  drew at slightly different projected positions and sizes. That smear was
  structural, not tunable.
- **AT MAP ZOOMS THE GEOMETRY IS THE STORM.** Track, cone, wind field, and the
  forecast points — whose first dot sits on the analysis position (tau 0, NOT
  current — see §7.4) wearing the white direction ring of §7.5, and carrying the
  category color and code. Severity reads off the dots and bands rather than off a
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
  forecast dot is a fixed §6 category color. `stormEnded` is the exception:
  bone on a night globe, a strong dark neutral on a daylight one, because
  "drained of color" reads as near-white in the dark and as invisible in the
  light. The disc flips, so its ink flips with it. It did not, briefly, and at
  1.79:1 the X vanished into its own dot — a §5 failure, not a cosmetic one.
  `tools/contrast-check.mjs` gates it as required text.
- **The mesh glyph does not rotate** (Aaron, 2026-08-18). Animating N sprites
  forever is a battery cost for decoration.

### 9.14 Storm light on the backdrop

**Every live storm throws soft colored light onto the space gradient behind the
globe.** Spin the planet and the colors sweep across the background with it.
`map/limb-glow.js` owns it; `GLOW` in `config/constants.js` holds every dial and
`fx.glow` holds the per-theme strength.

**It is a 2D canvas (`#glow`) BETWEEN `#spacebg` and MapLibre, not part of the
Three scene**, and the layer order is the entire design. The Three canvas sits
*above* the CSS gradient, so anything drawn there composites over the backdrop
with plain source-over — it can never add light into it, and in the light theme
never multiply into it. Sitting below MapLibre instead buys three things at no
cost: the browser blends it with the real gradient via `mix-blend-mode`,
MapLibre fades up over it on the dive exactly as it does over `#spacebg`, and
the globe painting above means opaque continents cover the light behind them
while the transparent ocean lets it through.

**One light per RUN OF ONE COLOR along a storm's ridge, not one per storm.**
The point list is walked as what it is — a per-storm ridge in order — and every
consecutive stretch of one category color throws its own light, placed at that
stretch's middle bead. So the colors on the backdrop are the colors on the cage,
each where its own part of the cage is. Until 2026-08-18 only a storm's CURRENT
position threw light, which meant everything the cage remembers threw none: a
storm that peaked at Cat 4 and weakened to a Cat 1 drew a large red ridge and a
purely yellow glow. The red was not dim; it was never drawn.

**It is backdrop mood, not a readout, and that sets its volume.** Nothing is
read off this light: severity is the cage's height and the glyph's color, and
both run at full strength. The bar the glow has to clear is *present*, not
*legible* — if it competes with the globe for attention it is wrong however
pretty it is. Every strength dial was cut hard on 2026-08-18 for exactly this
reason, once one light per storm became one per color run and a dozen
overlapping lights stacked toward a saturated wash. `LIGHT.fx.glowGain` and
`glowSpread` went back to 1.0 in the same pass: light no longer runs the effect
*harder* than dark, it runs the same numbers through a different operator.

**Brightness is flat, and `GLOW.intensity` is a ceiling per STORM, not per
blob.** Every color shines at the same strength, untouched by severity —
elevation on the cage is already severity said in the loudest channel the globe
has, and multiplying the light by it too left a depression's glow unfindable
beside a hurricane's. The one thing that makes a color read louder is covering
more sky, and that comes from how many beads wear it (`GLOW.runFull`): three
days at Cat 1 throws a wide light, six hours at Cat 4 a small one. Aaron's rule
— *one color shouldn't overpower the others unless there is just more of it.*

**The per-storm part of that is not tidiness; it is the 2026-08-21 bug.** One
light per color run means a ridge that climbed TD → TS → Cat 1 → 2 → 3 → 4
spends six slots, and the six land on top of each other because categories
change fastest near a storm's peak. Under dark's additive blend those six
summed to 0.96 alpha — a near-white hot spot over exactly the tallest part of
the cage — against 0.16 for a storm that never left depression. No term in the
code multiplied by severity; the picture said it anyway. Aaron on glass: *the
light intensity is proportional to the height of the mesh and I don't want it to
be.* Each storm is now composited through its own scratch buffer, so its runs
blend with each other instead of summing and the storm's brightest point is
exactly `GLOW.intensity` however many colors it wears. Softening the operator
alone is not enough and must not be mistaken for the fix — plain `source-over`
on one canvas still accumulates six runs to 0.65.

**Storms still stack with EACH OTHER.** Two separate lights on a wall really are
brighter than one, and unlike the case above that is a true statement about how
many systems are out there rather than a restatement of one storm's severity.
The theme's operator therefore lives on the blit, not on the blob; the scratch
is always `source-over`, in both themes, and that never varies.

**The falloff is flat-topped, because a peak is what a SOURCE looks like.** The
profile held 62% of its alpha out to only 32% of its radius, so every light had
a findable hot centre — and because a blob lands straight outward from its storm
along the same line the ridge lifts, that centre sat directly above the peak.
Aaron on glass, 2026-08-21: *it looks like there is a floating light source
above the raised mesh... I only want to see the light reflected onto the
background. I don't want to see a source.* The alpha now holds essentially level
across the inner `GLOW.plateauStop` and only then falls, with `coreStop` rolling
the shoulder off so the tail does not read as a disc with a soft edge. No peak,
nothing to read as a bulb.

A grey point throws nothing. `stormSwatch` paints a storm nobody is publishing a
wind for in the theme's neutral, and a light with no hue is a claim with no
content (§5). Over `GLOW.maxLights`, every storm keeps its own biggest run
before any storm keeps its second — otherwise one long-lived system's color
spans silence a smaller storm outright, which is a false count of live systems.

**A storm is a lamp on the globe's skin, aiming straight outward, and the
backdrop is a curved shell `GLOW.wallRadius` globe-radii around it.** The light
is drawn where that outward beam strikes the shell — which, because a radial
lamp fires along its own radius, is just the storm's direction scaled up.

**No live storm goes dark, wherever it is on the planet.** The shell curves the
whole way round, so there is nowhere a lamp can point that lights nothing the
camera can see. The aim WEIGHTS the light; it does not gate it. Three cases,
and their ordering is the effect:

- **A storm just past the limb is the brightest.** Its beam grazes the shell and
  lands well outside the disc, in open sky.
- **A storm facing you is dimmer, at `GLOW.frontGain`.** Its beam runs past the
  planet and meets the shell head-on, further out and to the same side — so it
  lands as a round pool rather than a smear, and it is real light on real
  backdrop rather than a halo pinned to the storm.
- **A storm aimed straight back is dimmer, at `GLOW.rimFloor`.** Its light lands
  behind the planet, which covers the MIDDLE of it — the blob is over a globe
  radius across, so the falloff still spills past the silhouette all the way
  round, and the translucent ocean lets the covered part shine through.
  `rimInner`/`rimOuter` fade between the two cases instead of clipping.

Aim rises with rotation while clearance falls, so their product still peaks in a
band past the limb, and that peak sweeping around the edge is what you see when
you spin the globe. **Both floors are load-bearing and neither may go to zero.**
They were hard culls until 2026-08-18, and both were bugs on glass: a Cat 4 in
plain view on the front of the globe threw no light at all, and a glow did not
fade as its storm rotated behind the planet — it fell off a cliff and vanished.
Neither may go to 1 either; that flattens the sweep into a permanent even halo.

**Drawing the light at the storm's own screen position is still the wrong
answer** and was the first shipped cut. It is a halo around a lamp, not light on
a wall, and on glass it read as the mesh glowing. Every light lands on the shell
at `wallRadius`, including near-side ones. `tools/test-limb-glow.mjs` pins the
landing point outside the silhouette precisely because every other check passed
while that was wrong.

**A FLAT wall is also wrong.** At the limb the beam runs parallel to a plane and
either misses it or strikes it far off-screen — and the limb is where the whole
effect lives. Below about `wallRadius` 1.3 the light collapses back onto the
globe as a rim highlight, which is the Fresnel effect this was built to avoid.

**The two themes use different OPERATORS, not different numbers.** Dark is
emitted light — `lighter` between STORMS, `screen` onto the backdrop; two storms
overlapping brighten and their hues mix, which is what two real lights on a wall
do. Light blends storms with plain `source-over`, so an overlap lands BETWEEN
the two colors in proportion to how much of each is there. Either way the
operator applies to a finished storm, never to a single color run. It multiplied them until
2026-08-18, and multiply is per-channel arithmetic that does not know what a hue
is: a saturated Cat 1 yellow leaves red and green untouched and drives blue to
zero, so yellow could not be attenuated by anything else in the §6 ramp and the
blues and greens were erased. It also manufactured hues no storm had — yellow
times a TD blue reads green, and a backdrop showing a color nothing on the cage
wears is the same class of error as §5's silence. The canvas itself is still a
TINT — `mix-blend-mode: color`,
which takes hue and saturation from the light layer and keeps the backdrop's own
luminosity. Transparent is the identity for both, which is why the canvas is
only ever cleared and never painted with a base color.

**Light cannot darken, and that is the requirement, not a limitation.** Two
earlier passes used `multiply`: the first was invisible, the second deepened the
color so the filter had something to subtract and read on glass as a dark
smudge. Both were right about the mechanism and wrong about the goal — a dark
patch on a bright surface is a smudge by definition, and light cannot be made
out of less light. `color` blending removes the failure mode entirely; at the
wrong strength it is garish, never dirty.

**`fx.glowSaturate` pushes the storm color to full chroma in light, and is 0 in
dark.** `color` blending discards the source's value, so saturating costs
nothing and is the only thing that gives the tint strength — the §6 category
ramp runs pale, and a pale source under `color` is a pale tint. Hue survives at
any value, so a green storm still throws green. Dark uses the category color
verbatim.

**Light mode's extra strength comes from `fx.glowGain`, not from `fx.glow`.**
The canvas opacity is not the lever: the gradient showing THROUGH the light is
what makes it read as light rather than as paint, so it has to stay well under
1. The two dials that actually change the look — `GLOW.intensity` and
`GLOW.radiusScale` — are shared with dark, which is signed off on glass, so
light multiplies them per theme instead of raising them for both. Dark's
multipliers are exactly 1.0 and its maths is untouched.

**Light runs the alpha three times harder than dark, and that asymmetry is
correct.** The two themes were briefly held to the same numbers on the argument
that they should differ only by operator. That was too clean: `screen` onto a
near-black sky has the whole luminance range above the backdrop to work in,
while `color` has only chroma, because it keeps the backdrop's own brightness by
design. The same alpha buys visibly less. Aaron on glass, 2026-08-21: *we need
probably 3 times the intensity in light mode.* The themes still share one set of
source numbers; `glowGain` is the conversion factor between them.

**`GLOW.intensity × glowGain` must stay under 1.** The per-storm alpha is
clamped there, and once the brightest storms reach the ceiling they stop being
distinguishable from each other — the peak sweeping past the limb reads as a
plateau instead of a sweep, which is the effect's whole shape. At 0.16 × 3 the
brightest storm sits at 0.48 and the dimmest at 0.10, so nothing clips. Past
about 6 the strong end starts flattening and more gain stops buying more
picture.

**`glowSpread` is how much backdrop the tint covers, and it stays at 1.0.** A
light per color run already covers the sky several times over, so reach was
never the thing that was short. `radiusScale * glowSpread` must stay at or under
about 1.4 — past that the lights stop reading as coming from the globe and start
looking like weather on the camera lens.

**The halo is ambience, not a category readout.** It is the one place §6's fixed
color semantics do not bind: two storms of different categories overlapping
produce a blended hue on purpose, because that is what two colored lights do.
Nothing about a category is ever read from it — the dot, the glyph and the cage
carry that.

**The light is an arc, not a disc.** A round pool is what a flat wall hit square
on gives you; this wall curves away, and the further past the limb a storm has
rotated the more grazing its beam, so the patch stretches along the curve and
thins across it (`GLOW.smear`, `GLOW.squash`). Both scale with the same aim term
that drives brightness, so the elongation animates through the sweep for free.
The major axis is TANGENTIAL — stretching radially would read as a beam pointed
at the viewer, which this geometry says cannot be happening. The squash is not
decoration: stretching alone inflates the lit area, and area is brightness once
the falloffs overlap.

**The light list is `heightfield.getStormPoints()` outright, not a copy**, so a
storm that lifts the lattice is by construction the storm that lights the sky.
`map/glow-lights.js` does that split — it is pure, knows nothing about canvases
or cameras, and was cut out of `limb-glow.js` on 2026-08-21 when that file
crossed the 700-line ceiling. The seam is one-directional: the painter imports
the list builder, never the reverse.

**A feed outage goes dark** (§5). The cage greys; this goes out entirely. A
globe that knows nothing must not be running a light show.

**Buffer is `GLOW.pixelScale` of the viewport and ignores device pixel ratio.**
That is the whole performance story: a fifth-scale buffer is a twenty-fifth of
the pixels, which is what makes a dozen overlapping fills affordable where a
dozen full-size sprites would not be.

**The browser's upscaling is NOT free smoothing, and this section said it was.**
An 8-bit alpha channel holds about `intensity × 255` distinct values — roughly
41 at the shipped strength — so the falloff quantises into contour bands *inside*
the small buffer, and bilinear magnification stretches every band boundary into
a straight facet along the texel grid. The result is a fine crosshatch on an
image whose entire job is to be smooth. Aaron on glass, 2026-08-21: *there's a
weird grid/weave pattern in the reflection, it's not smooth. It is not my
monitor.* It was not the monitor.

**Raising `pixelScale` is the wrong lever and will not fix it** — the band count
is set by alpha depth, not by pixel count, so a bigger buffer only makes the
weave finer. The cure is `--glow-blur`, a CSS blur on `#glow`, which acts *after*
the magnification, where the artifact is made. It does a second job at the same
time: it removes every remaining edge, so what lands on the gradient is a region
of color rather than an object. `pixelScale` came DOWN, from 0.25 to 0.2, to pay
for it. If a low-end phone ever drops frames while rotating the globe, the blur
radius is the dial — halving it is visible but survivable, removing it brings
the weave straight back.

**It fades out earlier than the cage** (`GLOW.fade`). Once MapLibre has faded up
there is no visible backdrop left to catch light, so a glow still running past
that point is a colored wash over the map.

---

### 9.16 Opening the Home drawer frames the house and the storm together

**The Home drawer's opening flight puts the house and the threat storm equally
into the space above the sheet.** `map/home-frame.js` owns the decision and is
pure — no map, no DOM — so `tools/test-home-frame.mjs` drives every band on
plain node. `app/views.js` performs the flight through the same `flyToPoint` and
the same `panelOffset()` every other camera move uses.

**It frames the pair because the panel is about a relationship.** Centring on
the house put the panel's whole subject off screen. Centring on the storm made
the Home button do what tapping that storm in the storm list already does, and
`Home` stopped meaning *you*. The camera centres between them instead, and the
offset pushes that centre up into the visible strip so the pair sits above the
sheet rather than behind it.

**The fit is computed in Mercator world units, not in miles.** What has to fit
on screen is *screen* separation, and on a Mercator grid that is not
proportional to ground distance — 400 miles north-south near Alaska is far more
pixels than 400 miles near Florida. At zoom `z` the world is `512 · 2^z` pixels
across, so a world separation Δ is `Δ · 512 · 2^z` pixels; both axes must fit at
once and the tighter one wins:

    2^z ≤ W · FILL / (512 · Δx)     and     2^z ≤ H · FILL / (512 · Δy)

`FILL` is `GLOBE.homeFrameFill` (0.82), so the two ends sit inside the picture
rather than on the limb where a glyph foreshortens into a smear. It is the one
dial on this feature and it lives in the constants file, not in the module. **Both strip dimensions are kept
separate**: an east-west pair needs width, a north-south pair needs height, and
collapsing to the short side would zoom out further than necessary on every
east-west storm. The centre is the **Mercator** midpoint, not the great-circle
one — that is the point that puts the two ends equally far apart on the glass.

**The strip is the viewport minus the drawer.** The sheet eats the bottom of a
phone, the rail eats the left of a desktop. The offset decides *where* the
centre sits and the strip decides how much has to fit around it; changing one
without the other puts an end of the pair under the panel.

**Longitude is unwrapped against the house before anything else.** Home at −90
and a storm at +170 are 100° apart across the dateline, but subtracting the raw
numbers gives 260° — the camera would fit three quarters of the planet and put
the midpoint in the Atlantic off Africa. Measured with the unwrap removed: the
Hawaii/Guam midpoint lands at longitude −6.5.

**Three outcomes, named in the returned `framed` so a check and a human see the
same thing.** `pair` is the normal case. `too-close` caps at `GLOBE.homeZoom` —
a storm making landfall on your street must not zoom closer than "take me to my
house" does — and keeps the midpoint, since both ends are on screen either way.
`house-only` is no storm in the ranking: the house at `GLOBE.homeZoom`.

**THERE IS NO MINIMUM ZOOM, AND THE ONE THAT EXISTED IS THE CLEAREST LESSON THIS
SECTION HAS.** A `homeFrameMinZoom` of 3 used to declare a wide pair unframable
and fall back to the house alone. It read as sound reasoning and it was a bug
visible only on phones. **A constant compared against a zoom is a constant about
screen size in disguise**, and the two platforms have wildly different amounts
of globe: measured, a 390x844 phone leaves a 390x338 strip against a 1440x900
desktop's 1000x900. The same storm 1,600 nm out framed at z4.24 on the desktop
and hit the floor at z3 on the phone, where the camera gave up and centred on
the house — "works on desktop, still just centering on home on mobile". The only
limit now is MapLibre's own `minZoom`, the space floor derived per viewport in
`globe.js`, which is a limit of the planet rather than one we invented.

**Tapping the house glyph on the globe IS a Home button press.** It moves no
camera of its own — it opens this drawer, and the opening flight above does the
rest, so the house glyph, the Home button in the control cluster and finishing
the setup flow all produce the same camera. One control, one meaning.

**Two richer versions of that tap were built and both were cut on glass.** The
first committed to `GLOBE.homeZoom` and suppressed the framing flight, which
made the house glyph the one entrance to Home that never showed you the storm.
The second made it a two-stage gesture — house first, pair on a second tap —
which answered that but put two meanings on one control and made "what happens
when I press this" depend on state nobody can see. **The recenter crosshair
already exists for anyone who wants the camera on their house and nothing
else**, so the second meaning had somewhere better to live. Worth knowing if a
future session reaches for the same idea: the cost is that no control now zooms
IN on the house while a storm is up, because the pair framing pulls back to fit
both. That was the accepted trade, not an oversight.

**The off-screen pointer is a different control and keeps its own answer.** It
rotates home into view without changing zoom, and it opens nothing — so it flies
with `openPanelOffset()`, which contributes the drawer's offset only when a
drawer is actually up. `panelOffset()` measures the drawer whether it is on
screen or slid away, which is right for every caller that opens one in the same
breath and wrong here: offset it unconditionally and the camera shoves home into
the top half of an empty screen for a panel nobody can see.

**The chevrons do not go through this.** Stepping is a deliberate "show me that
one" and flies to the storm via `onFocusStorm`, unchanged.

---

### 9.17 The glass rim at the horizon

**Once MapLibre owns the picture, a soft ring is painted on its limb** —
`map/limb-rim.js`, its own 2D canvas (`#rim`) above the basemap and below the
3D globe. An edge all the way round, plus a stronger arc on one side so it
reads as light catching curved glass rather than as an outline someone drew.

**Without it the horizon has nothing on it, and three separate facts stack up
to make that true.**

1. **MapLibre paints nothing outside the sphere.** The atmosphere pass is off
   (§9.6) and nothing else fills those pixels.
2. **The whole `sky` block in `map/style.js` is inert on the globe
   projection.** MapLibre forces the sky's blend factor to 1 in globe mode,
   which fades `sky-color`, `horizon-color` and `fog-color` to fully
   transparent, and zeroes the fog opacity as well. Seven style properties,
   none of which reach a pixel. **They are kept only because the flat
   transform still reads them; nothing on the globe does.**
3. **So the pixel outside the limb is the CSS backdrop and the pixel inside it
   is the sea — and in the light theme those are the same hex.** `space` is set
   to `ocean` exactly, deliberately, so the 3D globe's own limb is the only
   edge. Once the 3D globe has gone there is no such limb.

**It is a wide-screen feature and a phone pays almost nothing for it.** With the
globe centred, the limb leaves the viewport once its radius passes the
half-diagonal. **Bisected against the live layer in a browser, not derived:**
the rim switches off at z5.65 on a 3440x1440 viewport, z4.67 on 1920x1080,
z4.31 on 1512x945, and z3.02 on a 390x844 phone — where it only appears from
about z2.5, because below that the 3D globe still owns the picture. Past the
cut-off the layer switches off and does not pay for the fill.

**Where the ring goes is asked, never derived.** The radius comes from
`limbRadiusPx()` in `map/marker-home-geometry.js`, which bisects on MapLibre's
own `isLocationOccluded`, and the ring's brightest stop lands on that figure
within a pixel at every zoom.

**Two reasons not to compute it instead.** `map/globe-follow.js` matches the two
globes at the screen CENTRE, and the Three camera runs at `DIVE.fov` while
MapLibre runs at its own default — two lenses matched in the middle do not agree
at the edge, by more the further in you go. And the closed form is itself about
4% low: on a 900-tall viewport the rendered limb is at 487 px at zoom 3 and
794 px at zoom 4, against 465 and 761 for radius = worldSize/2π at MapLibre's
field of view. **Why it is low is open and deliberately not chased.** Swept
against the live transform, the projected radius peaks at the exact arc where
the occlusion flag flips and `limbRadiusPx` returns that same number to a tenth
of a pixel — so the oracle is right and one of the formula's inputs is not what
it is assumed to be. Nothing in the app uses the formula. This is recorded so
the next session does not re-derive it and trust the answer.

### The highlight is on the planet, not around it

**Nothing is painted outside the silhouette but a few pixels of edge
softening** (`RIM.bleedPx`). The reach goes inward, as a fraction of the limb
radius rather than a pixel count, because how fast the surface turns away is a
property of the sphere and not of the screen.

**The first version straddled the edge — 10 px in, 44 px out — and it read as a
hoop around the globe.** Aaron on glass, 2026-08-21: *"it doesn't look like
glass and it's sitting outside the horizon."* The measurement was never at
fault; the profile was. the Deep globe on the `worlds` branch had already
recorded the same finding for the same reason: every earlier version of that
globe's rim drew a hoop, because a separate shell is brightest at *its own*
edge, and lighting the ball's own front face is what puts the bright line
exactly on the silhouette. **A halo outside the silhouette is an atmosphere. A
highlight on the surface is glass.** This app is asking for the second, and a
real limb highlight — a Fresnel term on the front face — cannot reach past the
edge by construction.

**Two fills, and the second is not an approximation.** A radial gradient
reaching inward from the limb — nothing at the inner end, `oceanDeep` as the sea
turns away, `atmosphere` hard against the edge — then the same annulus filled
with a linear gradient of `atmosphereDeep` running along the light direction. On
a circle the screen-space normal at angle *t* is (cos *t*, sin *t*), so the
shading term is cos(*t* − *t*<sub>light</sub>), which is exactly what a linear
gradient along that direction evaluates to on the ring. There is no error term.

**The arc is composited `source-atop`, and that is what keeps the inner edge
soft.** A linear gradient varies around the circle and is dead flat *across* the
band, so it has no falloff of its own; painted with plain alpha it lays an even
slab over the whole width and cuts square at the inner diameter. That shipped,
and it came back off glass — *"you still aren't fading in the inner edge, the
inside diameter"* (Aaron, 2026-08-21). The ring underneath was fading correctly
the whole time; the arc was covering it. Under `source-atop` the result's alpha
is the **ring's**, untouched, and the arc can only pull the ring's colour toward
its own — so **the arc can never paint where the ring does not**, by
construction rather than by tuning. Its numbers are a mix fraction, not an ink
quantity, and are deliberately not scaled by the layer's strength.

**The light direction is derived from the backdrop's own, never typed.**
`RIM.lightAt` mirrors the `radial-gradient(... at 42% 30% ...)` literal in
`index.html`, so the ring and the sky cannot disagree about where the light is.

**The lit arc sits on opposite sides in the two themes.** Dark: the lit side of
a limb against a night sky is the brighter side, so the arc goes toward the
light. Light: there is no headroom above near-white and every attempt to add
light to that backdrop has come back off glass as a smudge — but a near-white
ball reads as a ball because of the shading that gathers on the side *away*
from the light. Same geometry, opposite end. **This is one of the few places
the two themes need a different sign rather than a different number**, and
`tools/test-limb-rim.mjs` pins both.

**It hands off from the cage, on the cage's own band.** The 3D cage's outer
silhouette is the last 3D edge on screen, so the rim rises on exactly
`DIVE.fade.cage` as the cage falls on it — never two edges, never none, and
because both read one constant they cannot drift. **It must not be given its
own band.** It is therefore the one layer driven from the `p >= 1` branch of
`map/globe3d.js`'s render loop, where everything else is cleared.

**Drawn at 1:1 CSS pixels, unlike `map/limb-glow.js`'s fifth-scale buffer.** An
edge is the one thing here with high-frequency detail to lose, so it cannot be
blurred back afterwards. Only the annulus is ever rasterised, so the painted
area is a band, not a screen, and the band's width is in **pixels rather than
globe radii** — a lit edge does not get fatter because you walked closer.

**No `mix-blend-mode`, in either theme.** `#glow` paints light and must add or
tint; this paints an edge, and an edge is allowed to be darker than what is
under it — which is exactly what the light theme needs. Plain alpha, one code
path.

**The shipped numbers are settled on glass and are not a starting point.**
`fx.rim`, `RIM.reachFrac`, `RIM.tailStop`, `RIM.shoulderStop`, `RIM.glare` and
`RIM.glareMid` were judged on a real ultrawide monitor in both themes and
signed off, 2026-08-21. Two rounds of correction got them there and both are
recorded above, because both were mistakes a fresh pass would repeat: a bloom
outside the silhouette, and an arc with no falloff across the band. **Change
these because something is wrong on a screen, never to tidy them.**

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

Getting this backwards paints the whole globe ocean-colored and leaves only ice
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
- One color block (`DARK.adminState` / `adminCountry` / `textCountry` /
  `textPlace`) and one tuning block (`ADMIN`). The hierarchy is steep and
  deliberate: storm names > place names > country lines > state lines, and every
  one of them sits below the coastline.
- **State names and city names share one ink (`textPlace`) and one halo
  (`ocean`).** The difference between them is WEIGHT AND CASE, not color: states
  are bold, uppercase, letterspaced and set at `stateLabelPx` (the largest place
  label on the map); cities are regular, mixed case, `placeLabelPx`. A state is
  an area, a city is a point, and that reads at a glance without a second color.
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
    contained it and `slice(0, -1)` eats the last letter. **Each suffix
    endangers a different name length**, so the reach is one length per clause,
    not one case: ` State` (6) breaks 5-character names — TEXAS becomes TEXA;
    ` Province` (9) breaks 8-character ones — Michigan becomes Michiga;
    ` Prefecture` (11) breaks 10-character ones — Washington becomes Washingto.
    `tools/test-admin-suffix.mjs` pins all three by evaluating the `text-field`
    expression `buildStyle()` actually generates, rather than a JavaScript
    restatement of the rule that would be free to agree with itself while the
    shipped expression drifted. It also pins the `Free State` exception, the
    two words deliberately not stripped, the trailing-word-only rule, and the
    nameless feature — a null name reaching `length` is a hard expression error
    that removes the whole layer, not a blank label.
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

---

## 45.4 Genesis — what it draws on the globe

*The source and its failure behaviour are §45.2–§45.5 in `SPEC-DATA.md`; the
drawer section is §45.8 in `SPEC-UI.md`.*

A soft hatched patch per watched area, in `map/layers/genesis.js`. **Both
sources draw, through one code path.** JTWC publishes a position and no extent,
so `lib/abpw.js` gives it a circle at `GENESIS.jtwcRadiusDeg` — 6.04°, the mean
equivalent radius of NHC's real published areas — and the area panel says in
words that the shape is indicative. Aaron's call, 2026-08-09, overruling the
earlier rule that a JTWC system drew nothing: a drawer row that flew the camera
to empty ocean looked broken at the exact moment the app was being most careful.

**The risk ramp is one ramp, and it is fed from `globeRisk ?? risk`.** NHC's
word arrives on `globeRisk`, resolved from the horizon the globe draws; JTWC has
no horizon to choose between and writes straight to `risk`. Every surface that
asks an area's risk uses that same expression — the patch, the label, the
planet-band mark, the drawer row and the detail panel. A second spelling of the
question is not a style difference: the patch layer briefly read `globeRisk`
alone, `normalizeRisk(undefined)` returned the LOW fallback, and every JTWC
patch drew Low forever underneath its own label reading "High" in the High
color. Nothing was missing from the screen, which is why it survived.

**A genesis area is separated from a storm by SHAPE, not by color.** A storm
is a filled dot with a spiral and a halo; that equation is the whole legibility
of the globe. So an area is an area with a soft dashed edge and **nothing that
lives at a point**: no centroid dot, no glyph, and no cage at the planet band
(`GENESIS.planetBandCage` is `false` and says so explicitly rather than being
an omission). The percentage rides as haloed text, which cannot be mistaken for
a blob.

**Deliberately off the Saffir-Simpson ramp, and deliberately not gold.** §6's
color contract is that those hues mean a storm of a known strength, and a
genesis area is the absence of one. The first treatment was a low-chroma sand
around 42° on the reasoning that nothing else had claimed that hue — true, and
the wrong question. Gold on a night globe reads as *caution*, because gold is
what caution means everywhere else, so the mark that exists to say "nothing has
happened yet" was the warmest thing on screen. **Being off the severity ramp is
not the same as being calm.**

The ramp is now the **mesh / coastline family** — the globe's own furniture.
`mesh` is the cage at rest and `coastGlow` is the coastline's top line; between
them they are what the planet looks like when nothing is wrong. A watched area
drawn in that family reads as part of the world rather than as an alarm laid
over it, and recedes until you go looking for it, which is correct behaviour
for a maybe. Measured against the night ocean: 3.23 / 5.49 / 8.97:1, so even
Low clears the cage's own 3.20:1.

**Risk rides three channels, and color is the quietest of them.** The planet
glyph carries it structurally (hollow / filled / doubled), the patch carries it
in hatch density (`GENESIS_GEO.hatchGap`, 13 / 8 / 5 px), and color steps
lightness underneath both. That is why the color steps can afford to be subtle
— they are not carrying the message alone.

**Hatched rather than solid, and dashed rather than outlined**, because the
boundary of a development region is genuinely fuzzy and a hard fill or a solid
edge claims a precision the product does not have. Selection raises the fill
and the edge weight and *lengthens* the dash; it never moves the hue, so risk
can never be inferred from selection state.

### The planet band

`map/layers/genesis.js` draws into MapLibre, and **MapLibre's canvas is at
opacity 0 when the app opens** — the app boots at `spaceFloorZoom()`, capped at
`DIVE.zSpace`, where `divePhase` is 0 and `globe3d.js` sets `mapEl.style.opacity`
to 0. Storms are visible out there because the 3D engine draws its own glyphs.
So genesis draws its own too: `map/watch-marks.js`, a `THREE.Points` set per
risk level, added to the globe group beside the storm glyphs.

**A caution triangle in three structural variants** (`watchGlyphCanvas` in
`map/glyph.js`): hollow for Low, filled for Medium, filled with the exclamation
knocked out of it for High. Empty / full / full-and-marked is a ladder rather
than a scale, and at 30 px on a phone it is legible where three steps of any
count are a guess.

The exclamation is a **hole**, punched with `destination-out`, not an ink — so
whatever is behind the glyph shows through it, which is right in both themes
and is what a real warning plate does. It appears **only on the top rung**, so
a Low or Medium area is a plain triangle and cannot read as a warning at all.
It is positioned against the triangle's centroid: half-width at height `y` is
`0.866r(y + r)/1.5r`, so the bar's top at −0.22r has 0.45r of room and the dot
at +0.32r has 0.76r. It previously sat at 0.60r, below the base at 0.50r, and
hung out of the bottom of the sign.

Not a spiral — the spiral is the app's own mark and means a cyclone. Not a
filled dot — that means a storm of a known strength on the Saffir-Simpson ramp
(§6).

**No drop shadow, in either theme.** The mark carried a baked blur like the
storm spiral's and it read as a smudge. The spiral needs its halo and this does
not, for a §6 reason: a category color is fixed, so a Cat 1 yellow sits at
1.32:1 against the daylight ocean and is only findable because something dark
is drawn behind it. This mark's color is *themed* — `GENESIS_COLOR_LIGHT`
exists precisely so it clears its own background unaided — so a halo buys
nothing and costs the clean edge.

**Risk never rides size.** A shape on a map means extent, and the polygons
beside these already use size to mean exactly that.

**The standing objection, recorded because it does not go away.** A triangle
and exclamation is the universal *hazard* mark, and a watched area is not a
hazard — it is the absence of one, which is the whole reason §45 exists and the
whole reason the mark is off the severity ramp. Five of these on a quiet globe
risk reading as five warnings rather than five maybes, putting the app's most
alarming symbol on its least certain object. Drawn anyway on glass authority.
The ladder is already half the answer — the exclamation only appears on the top
rung. The remaining dials: thin the strokes, or drop the exclamation entirely
and let fill alone carry High.

Two marks preceded it and neither was wrong, only quiet — a dashed ring, then a
hatched lozenge that was the patch in miniature and had the better through-line
to the polygon it becomes. Legibility beat elegance. Both are in `git log`.

**The handoff is automatic.** The rings fade on `DIVE.fade.nodes` — the same
band that carries the storm glyphs out as MapLibre's marks fade in. Both curves
are complements of one `p`, so there is no gap where a watched area is
invisible and no band where a ring and a patch both claim the same spot at full
strength.

**The rings do not touch the heightfield.** The cage lifting means "a storm is
here", and a maybe must never make that claim. They are flat marks on the same
shell as the storm glyphs, with the mesh beneath them unmoved.

**A JTWC system is given a circle, and it is the one shape in §45 that nobody
published.** JTWC states a position and no extent, so before this it drew
nothing at close zoom and tapping its row flew the camera to empty ocean.

Two things keep the invention defensible. `GENESIS.jtwcRadiusDeg` is **6.04°,
measured** — the mean equivalent radius of NHC's five live outlook polygons
(`sqrt(area/pi)` on their own published `st_area(shape)`: 5.78, 5.79, 5.80,
5.92, 6.93) — so a JTWC circle is the size a watched area actually is rather
than a size that looked right. And the area panel states in words that the
shape is indicative, because a drawn boundary reads as a measurement and this
one is not one.

`circleAround` in `lib/genesis.js` divides the longitude offset by `cos(lat)`,
so the ring is a circle *on the globe* rather than in degrees, and emits
**unwrapped** longitudes — a ring that jumped ±180 mid-edge would render as a
band the width of the world.

Every watched area therefore has a polygon, and all of them draw through the
same three layers with identical zoom behaviour. If JTWC ever publishes an
extent, the invented circle is the line that goes.

**The layer toggle reaches both engines.** Genesis is the only layer that draws
in MapLibre *and* in the 3D globe, and `engine.setToggle` only knows about
MapLibre layer ids — so switching the row off removed the patches and left the
triangles on screen, a control that half works. `main.js` pushes
`g3d.watchMarks.setVisible()` on the same one-call path.

**A watched area is tappable from space** through `genesis-hit`, a fully
transparent circle at each area's centroid with its radius floored at the §9
44 px minimum. At the planet band the glyph is a 30 px triangle while the
polygon under it is a few pixels across, so a tap landing on the triangle would
otherwise miss the patch and close the drawer. It is the same trick
`storm-dot-planet` uses: MapLibre's canvas is at opacity 0 out there but still
receives pointer events. The point source carries **every** area and the label
layer filters on `_label`, so an area with no published probability is
unlabelled but still tappable — two different silences that must not collapse
into one hole in the interaction.

**Draw order is `order: 0`** — below the cone's 10 and below everything else. A
watched area never occludes a real storm. Input follows the same rule: the home
marker is hit-tested first, then storms, then genesis. A patch is hundreds of
miles across and would otherwise steal the tap from a storm sitting inside it.

**The colors are baked into the features, not read from global state.** This
is `map/theme-state.js` rule 1b, not a style choice: a paint property holding
both a `global-state` reference and a `['get', …]` resolves to black in both
themes rather than throwing, because a data-driven property is evaluated in a
worker the global state never reaches. Genesis is inherently per-feature, so
`genesisColor()` resolves at push time and a theme change re-pushes. This is
the **third and last** entry in `app/theme-switch.js`'s exception list; a
fourth is the signal to build the real repaint path rather than to add a line.

Selecting an area flies to `GENESIS.flyToZoom`, deliberately wider than
`GLOBE.flyToZoom`. A storm is a point; a development region measured 8–22°
across, and arriving at storm zoom puts the camera inside the patch, where a
soft hatch fills the screen and reads as a rendering fault.

**Each patch is labelled in its own source's vocabulary.** An NHC patch carries
its seven-day percentage; a JTWC patch carries its risk word — "Medium" — because
that is what JTWC published and converting it to a number would be inventing
data (§45.3). A reader tells the two apart precisely because one is a figure and
one is a word, which is what makes it safe to put both on one globe. An NHC area
with no published probability gets no label at all: null is "the source did not
say", which is different from zero.

### 45.6 Which horizon goes on the globe

**The seven-day number, and only the seven-day number.**

The polygon *is* the seven-day area. The two-day probability has no geometry of
its own — it is another field on the same seven-day shape. Putting the two-day
figure on it would be a lie of the class §5 forbids, and showing both gives
"0% / 40%" floating over an ocean, which is unreadable at a glance and still
half wrong.

The two-day figure is not discarded: it appears in the drawer row once it rises
above zero, and always in the area panel, where there is room to label the
horizon it belongs to.

Below `GENESIS.labelMinZoom` no percentage is drawn at all — at planet distance
a scatter of numbers over the oceans is noise, and the areas read as shapes
without them.

### 45.7 The standing visual risk

This layer puts a new class of object on a globe whose entire legibility rests
on **colored blob = storm**. The risk is visual, not technical, and it does
not expire: every change to this layer is judged first on whether a patch still
reads as *nothing here yet* rather than as a storm-shaped thing. Adding a
marker, moving the hue onto the category ramp, or making the fill solid would
each undo the layer's one safety property. That call is made on glass.
