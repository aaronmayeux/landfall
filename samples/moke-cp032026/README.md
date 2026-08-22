# MOKE — CP032026, advisory 006

Captured from the archive branch's 2026-08-21T23:30Z run
(`latest/geometry/nhc-Moke-CP3-*`). Real bytes, unmodified.

## Why this storm has its own corpus

**Lala cannot see the fault these bytes carry.** Both storms were running on a
stale advisory that night, but the geometry differs in the one way that
matters — how far the published cone extends BEHIND the storm's real position:

| | storm | published cone reaches behind it | cone half-width there |
|---|---|---|---|
| Lala | 28.60N 170.40W | modest | 0.43 deg |
| Moke | 13.90N 147.20W | **1.87 deg east** | 0.56 deg |

Moke was tracking nearly due west with a long east-west cone, so the tail her
advisory left behind her is more than three times the width of the cone at her
position. Lala was recurving northward and hers is comparable to her own width.

**That ratio is the whole fault.** `sweepConeDetail` sized the tail cap by
casting a ray backwards until it left the published outline — correct while the
track began at the published apex, and wrong since SPEC-MAP.md §7.11 made the
first station the STORM, which sits inside the cone ahead of its stale apex.
The ray then runs the length of the leftover tail. Measured, reach against the
flank width it caps:

```
Lala  start 0.48 / 0.52 = 0.91x     end 2.35 / 2.33 = 1.01x
Moke  start 1.56 / 0.64 = 2.43x     end 2.32 / 2.26 = 1.03x
```

Three of four agree within a tenth. Only Moke's start is measuring something
else, and only Moke's cap ballooned — into the purple lobe Aaron reported on
2026-08-22, hanging east and south of a storm it was supposed to be capping.

`tools/test-cone-cap.mjs` asserts against these bytes, and asserts Lala's cap
does NOT move — a fix that changed every cone to correct one would be a
regression wearing a fix's clothes.

## Do not refresh these

The moment NHC publishes an advisory whose apex is at Moke's real position, the
tail is gone and nothing here reproduces.

## The second fault these bytes carry — two advisories at once

Added 2026-08-22 with `wind-swath-adv6.geojson`, `wind-past-adv6.geojson`,
`wind-current-adv6.geojson` and `past-points-adv6.geojson`.

**The files named `006` in this folder are advisory 004.** The number came from
`CurrentStorms.json`'s advisory count at capture time, not from the geometry's
own `advisnum`, and it is wrong on three files. Left as-is rather than renamed —
`tools/test-cone-cap.mjs` and `tools/test-forecast-now.mjs` cite them by name —
but do not read the filename as the advisory.

What the geometry actually says:

| file | `advisnum` | published |
|---|---|---|
| `cone-006-stale`, `forecast-track-006-stale`, `forecast-points-006-stale` | **4** | 2026-08-21 09:13Z |
| `past-points-adv6`, `wind-past-adv6`, `wind-current-adv6`, `wind-swath-adv6` | **6** | 21:04–21:12Z |

Twelve hours and two advisories apart, in one capture, on one storm. The
forecast points still call her `Tropical Depression Two-C` at 30 kt while the
feed had Tropical Storm Moke at 40. See SPEC-MAP.md §7.13.

**Lala cannot reproduce this one either — that is now three.** Her points and
her radii are both advisory 36A, published five minutes apart, so her solved
ring centres match her forecast points to under 1 nm and the fix is a no-op on
her to the third decimal. `tools/test-windswath-centre.mjs` asserts both halves.

## Do not refresh these either

The moment NHC's layer 5 catches up with its layer 15, the two advisories agree
and nothing here reproduces.
