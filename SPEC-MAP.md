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

---

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

**It is not an inversion**, and the places it refuses to invert are the ones worth
knowing before editing it:
- The cage, the coastline and the nodes go **darker** than their surface, not
  lighter. A glowing line on a night sea becomes a drawn line on a pale one.
- The 3D globe's far continents, coastline and nodes **drop additive blending** in
  light mode. Additive can only add light — right against a dark sky, invisible
  against a bright one. This is the one place the two themes need different
  mechanics rather than different numbers.
- The chosen segment of a control goes **down** in lightness and up in saturation.
  A step further toward white is a step toward invisible.
- The install amber is a **different amber**. `#F0B23C` on a white panel is a
  1.6:1 boundary — a button with no edge.
- **Space is not black.** A globe in daylight against a high-altitude sky. There
  is no starfield in daylight.

Mechanically: `config/theme.js` owns which palette is live and nothing else (no
DOM, no preference store, so `tools/` can import it). **Everything that draws
calls `palette()` at paint time and never caches it.** A theme change rewrites the
CSS custom properties (which repaints the entire interface for free — every panel
is already written against them), calls `retheme()` on the 3D globe, and hands
MapLibre a freshly-built style object. `index.html` carries a pre-paint inline
script, pinned in the CSP by hash, so a light-mode device never flashes the dark
globe on a cold load.

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

### 9.13 The storm glyph — 3D node mesh only

- **Simplified two-arm spiral**, rotated by hemisphere — counterclockwise north,
  clockwise south. Physically real, free to implement.
- **ONE ENGINE DRAWS IT, AND IT IS THE MESH.** `map/glyph.js` is shared. MapLibre's
  copy is deleted: its zoom band reached full opacity at z3.4 while the mesh does
  not finish handing off until z5.0, so for 1.6 zoom levels two copies of one spiral
  drew at slightly different projected positions and sizes. That smear was
  structural, not tunable.
- **AT MAP ZOOMS THE GEOMETRY IS THE STORM.** Track, cone, wind field, and the
  forecast points — whose first dot sits on the current position carrying the
  category colour and code. Severity reads off the dots and bands rather than off a
  spiral.
- **Size-scaled by category, never shape-scaled.** A Cat 5 is a bigger glyph, not a
  more elaborate one. It has to stay legible at ~12 px on a phone at z1, and a
  detailed spiral turns to mush at that size.
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
  in empty ocean.
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

**Why z8 is the ceiling — a design decision as much as a budget one.** The question
this app answers at close range is "is the cone over Tampa Bay or west of it."
That is z8: a metro area with inlets and barrier islands resolved. Past z8 you pull
in street grids, which are visual noise for storm data and would wreck the
lit-globe look. **Do not reopen this as a cost question.**

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
- **Cities arrive at z6.4**, close to the local band. Walked out twice on glass:
  4.6 → 5.4 → 6.4. Both earlier values put names on screen while the question was
  still "which storm" or "which state". **Decluttering is done by ZOOM first and
  the toggle second.**
- One colour block (`DARK.adminState` / `adminCountry` / `textState` / `textPlace`)
  and one tuning block (`ADMIN`). The hierarchy is steep and deliberate: storm
  names > city names > state names > country lines > state lines, and every one of
  them sits below the coastline.
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
| Cities rise | 6.40 → 7.20 |

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
