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
