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
