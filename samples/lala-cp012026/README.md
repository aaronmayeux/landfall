# Lala (CP012026) — the watch with no coast under it

`watch-warning-025.geojson` is advisory 25 of Hurricane Lala, Central Pacific,
exactly as the NHC MapServer served layer 8. Two features:

| `tcww` | Product | From | To |
|---|---|---|---|
| `TWA` | Tropical Storm Watch | 166.27°W 23.86°N | 170.50°W 25.33°N |
| `HWA` | Hurricane Watch | 170.50°W 25.33°N | 173.96°W 26.06°N |

Those coordinates are **French Frigate Shoals**, **Maro Reef** and **Lisianski
Island** — the Northwestern Hawaiian Islands, inside Papahānaumokuākea.

## Why it is here

**It is the only capture of a real coastal product with NO COAST UNDER IT.**
Every other watch/warning fixture in this repo sits on a mainland shore the
basemap draws, so the band select (SPEC-MAP.md §7.7) finds coastline, paints it,
and the fallback path is never exercised. These atolls are a few hundred metres
across — far below anything OpenMapTiles carries — so both features fall through
to `_banded: false` and keep NHC's delivered chord.

Aaron saw the result on glass 2026-08-18: two solid strokes across empty Pacific
with no land in frame, wearing the coastal stripe's own paint, reading as a
coastline drawn in the middle of the sea. The orders were real; the drawing was
overconfident. SPEC-MAP.md §7.10 is the fix and
`tools/test-coast-fallback.mjs` asserts against these bytes.

Note that both features carry a **real LineString**. This is NOT the shapeless-
watch case — Lala advisory 5A published `geometry: null` for a Hurricane Watch
and that is a separate problem, measured in `lib/watchwarning.js`. Same storm,
two different ways for a coastal product to be undrawable.

The two products **share the Maro Reef breakpoint exactly**, which is why
breakpoint dots are not deduped: one place, genuinely under both orders.

## Provenance

Lifted 2026-08-18 off the `archive` branch
(`latest/geometry/nhc-Lala-CP2-watchWarning.geojson`), captured by the hourly
runner — a session cannot reach `nhc.noaa.gov`. Byte-identical to what the
runner stored; nothing here was reformatted, simplified or hand-edited.

## The advisory-33 geometry — the cone the date line cut in half

`cone-033-multipolygon.geojson`, `forecast-track-033.geojson` and
`forecast-points-033.geojson` are layers 7, 6 and 5 of the MapServer for
advisory 33, captured off the archive branch on 2026-08-20. The matching SHIPS
run is `samples/ships/26082012CP0126_ships.txt`.

**The cone is a `MultiPolygon` and that is the whole reason it is here.** NHC
cuts a cone at ±180, so Lala's arrives in two parts: 1,332 points spanning
−180.00 to −170.58, and 191 points spanning 178.78 to 180.00. `lib/cone-smooth.js`
gated its cone MEASUREMENT behind the same single-polygon test as the cone
REBUILD, so every Central Pacific storm reaching the seam lost its environment
ribbon and was told *"This cone could not be measured."* SPEC-MAP.md §7.9 is
the fix and `tools/test-cone-dateline.mjs` asserts against these bytes.

Aaron saw it on glass 2026-08-20: Environment on, the drawer's environment
paragraph full of real numbers, and a grey cone.

**Keep the coordinates verbatim.** The point of the fixture is that the two
parts sit on opposite sides of ±180 — normalize them onto one branch and it
stops testing anything.

## The advisory-38 tracks — a segment sent twice, and a forecast running late

`past-track-038-doubled.geojson` and `forecast-track-038-stale.geojson` are
layers 11 and 6 of the MapServer at 2026-08-21T21:31Z, captured off the archive
branch. They carry **two separate faults at once**, and both were visible on
Aaron's phone the same evening.

**Fault 1 — the same segment, published twice.** The past track arrives as 14
`LineString` features, and `objectid` 742 and 743 are coordinate-for-coordinate
identical: the final leg, −171.30/27.00 to −170.70/28.10, sent twice. `stitch`
cannot chain a copy head-to-tail, so it chains it TAIL-to-tail — the path walks
out along that leg and straight back down it. `unfold` caught the 180° fold and
reported it on every load. Moke (`CP032026`) arrived the same hour with the same
fault: 3 segments, `objectid` 745 and 746 identical. This is a source quirk, not
a chaining bug, so `runsFrom` drops the repeat before `stitch` ever sees it.

**Fault 2 — the past track has overtaken the forecast.** History reaches 28.1°N;
the forecast still begins at 26.9°N, two advisories and nine hours behind. So
joining the two correctly makes a near-180° hairpin at the seam, `maxTurnDeg`
vetoed that orientation, and a REVERSED forecast passed the turn test instead —
on a gap of roughly 11° against the correct answer's 1.3°. On glass: the dotted
past track ran the entire length of the forecast and the solid forecast line was
drawn backwards. `TRACK_LINE.orientGapRatio` is the fix and
`tools/test-trackline.mjs` asserts against these bytes.

**Fault 2 survives fault 1 being fixed**, which is why the suite checks them
separately. Dropping the duplicate segment silences the console warning and
changes nothing about the join.

**Keep both files verbatim.** Remove the duplicate feature, or nudge the
forecast's first point onto the past track's last, and neither fault is
reproducible any more.

---

## `forecast-points-038-stale.geojson` + `past-points-038.geojson`

Same 2026-08-21T23:30Z archive run as the two files above. These are the halves
`tools/test-forecast-now.mjs` needs, and they carry the fact that turned the
whole diagnosis around:

| layer | advisory | published | first / newest position |
|---|---|---|---|
| forecast points | 36A | 12:02Z | tau-0 valid **09:00Z** at 26.9°N 171.2°W |
| past points | — | 21:04Z | newest fix **18:00Z** at 28.1°N 170.7°W |
| `CurrentStorms.json` | 038 | 21:00Z | **28.6°N 170.4°W**, HU, 80 kt |

**The forecast is not wrong. It has been overtaken.** Its tau-12 is valid
18:00Z at 28.1°N — and the record independently puts the storm at 28.1°N at
18:00Z. That hour verified. It is still being drawn as future, and the white
ring is still being drawn on tau-0, 117 miles behind the storm.

Two forecast hours here have already passed at the wall clock Aaron reported
against (2026-08-22T00:39Z). `lib/forecast-now.js` drops both and puts a single
tau-0 on the feed's position, so the record joins the forecast going forwards
instead of doubling back 83 miles to reach it.

**Do not refresh these against a newer advisory.** The moment NHC's two clocks
line up, nothing here reproduces.

---

## `wind-swath-038-recurve.geojson` + `wind-current-038.geojson`

Same 2026-08-21T23:30Z archive run. NHC's per-tau, per-threshold quadrant
polygons (22 features) and the current-position wind field. These are what
`tools/test-windswath-folds.mjs` builds a corridor from.

**Two things in these bytes matter.**

1. **The features arrive out of tau order.** Index 6 is tau 48 sitting between
   tau 12 and tau 24. `buildFullTrack` sorts, but a fixture tidied into order
   would stop testing that it does.
2. **Two clocks in one advisory.** The wind roses carry `validtime` 2026082112,
   2026082121, 2026082209 against `synoptime` 2026082106 — a 06Z synoptic —
   while the forecast POINTS for the same advisory 36A run on a 09Z cycle. The
   swath is ordered by the CENTRE's hour, not the rose's, and that distinction
   only exists because these two disagree.

**The past wind field is deliberately NOT here.** It is a megabyte and the fault
reproduces without it. On the full tiers the timeline fix alone leaves one
folding band on Lala and the loop cut clears it — measured, recorded in
`SPEC-MAP.md` §7.12, and not reproducible from the repo by design.

**Do not refresh these against a newer advisory.** The moment NHC's two clocks
line up, the timeline stops folding and nothing here reproduces.
