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
