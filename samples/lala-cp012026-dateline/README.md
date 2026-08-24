# Lala (CP012026) — the storm that walked onto the date line

The 2026-08-24T17:37Z archive run, lifted off the `archive` branch
(`latest/geometry/nhc-Lala-CP2-*`) and **byte-identical** to what the hourly
runner stored. Nothing here was reformatted, simplified or hand-edited — a
session cannot reach `nhc.noaa.gov`.

| file | MapServer layer |
|---|---|
| `forecastPoints.geojson` | 5 — forecast centres |
| `windSwath.geojson` | 15 — forecast wind radii, per tau per threshold |
| `windCurrent.geojson` | 16 — the wind field at the current position |

The feed's own record for that run: **33.4°N 175.3°W, moving 320°**
(`latest/nhc-currentstorms.json`).

## Why it is here

**Her forecast genuinely straddles ±180 and `samples/lala-cp012026/` does not.**
That fixture is three days older, when every one of Lala's wind bands sat well
east of the seam — which is exactly what SPEC-MAP.md §7.9 recorded as the reason
the wind layers had no dateline coverage yet. These nine forecast points run
**−179.40 through +179.20**:

| tau | position |
|---|---|
| 0 | 33.30°N 174.80°W |
| 48 | 35.60°N 177.80°W |
| 60 | 36.10°N 178.50°W |
| 72 | 36.90°N **179.40°W** |
| 96 | 38.30°N **179.20°E** |
| 120 | 40.50°N 177.00°E |

`lib/windswath.js` flattens the timeline onto a plane by subtracting raw
longitudes from the first entry's. On these bytes the far end of the forecast
measured 316° from the start of the past instead of 43°, and the built 34 kt
band came out **359.75° of longitude wide** — a green ring around the globe,
which is what Aaron saw on glass on 2026-08-24. SPEC-MAP.md §7.12 fault 3 is
the fix and `tools/test-windswath-dateline.mjs` asserts against these bytes.

## Two other things in here that are load-bearing

1. **The forecast points arrive out of tau order.** Taus 72, 96 and 120 come
   first, then 0 through 60. `buildFullTrack` sorts; a fixture tidied into order
   would stop testing that it does.
2. **The past tier is deliberately NOT here.** `windPast` for this run is 1.4 MB
   and the fault reproduces from the forecast and current tiers alone — asserted
   in the suite, so nobody re-adds it thinking it was needed.

## Keep the coordinates verbatim

**Do not normalize these onto one branch of longitude.** The whole point of the
fixture is that they are not on one. Shift them and the suite passes against
data that could never have produced the bug.

**Do not refresh this against a newer advisory.** Lala clears the seam and
nothing here reproduces.
