# Lala and Moke — the forecast the storm had already driven past

The `archive` branch's `latest/` tree, captured **2026-08-22T13:04Z**, copied
here byte for byte. Every file came straight from NOAA's ArcGIS — no relay, no
cache of ours anywhere in the path (`manifest.json` records
`cache-control: max-age=0,must-revalidate` and no `x-landfall-cache` on all
eleven layer queries).

This is the fixture for **SPEC-MAP.md §7.14**. It is not
`samples/lala-cp012026/` and must not be confused with it — that one is the
2026-08-21T23:30Z capture, it is the fixture for §7.11 and §7.13, and it
reproduces a *different* fault of the same family.

## What the bytes say

| layer | advisory | published |
|---|---|---|
| `currentstorms-040.json` (Lala) | **040** | 09:00Z, 30.3°N 172.0°W, 75 kt, moving 325° at 14 kt |
| `forecast-points-039.geojson` | 039 | 03:27Z |
| `forecast-track-039.geojson` | 039 | 03:27Z |
| `wind-swath-039.geojson` (forecast radii) | 039 | 04:02Z |
| `wind-current-039.geojson` (initial radii) | 039 | 04:02Z |
| `past-points-040.geojson` | — | 09:02Z, newest fix 06:00Z at 30.2°N 171.4°W |
| `wind-past-040.geojson` | 040 | 09:02Z |

**Six hours of skew between the position and the forecast, on one storm, on one
poll.** That is the ordinary case, not the extreme one.

`currentstorms-040.json` is the whole feed, both storms, exactly as the relay
served it. Kept whole rather than cut down to Lala because the Moke row in it is
the second half of the measurement below.

## The fault

Advisory 39 forecast Lala to move at 8 kt. The record in
`past-points-040.geojson` says she did **13.5 kt** between 00Z and 06Z — 81 nm
in six hours on a bearing of 325°, which is the feed's own published motion to
the degree.

So advisory 39's tau-12, valid **12:00Z** at 30.1°N 171.2°W, sat **43 nm behind
her 09:00Z position** with three hours still to run. Noon had not happened. Both
drop rules in the app asked what time it was, both kept it, and both timelines
folded back on themselves:

```
track line    30.300,-172.000 -> 30.100,-171.200 -> 31.000,-172.200
wind swath    ...06Z fix -> 09Z fix -> 43 nm bearing 106° -> 75 nm bearing 316°
```

A 210° reversal. On the line it drew as a hairpin beside the white ring; inside
a corridor 130–150 nm wide it sent both walls round across themselves, and
`lib/unloop.js` cut the crossings out, which is why it read on glass as a link
rather than as an obvious fold. Aaron reported it at 07:53 local on 2026-08-22,
screenshot 4953.

**IT SELF-HEALS AND THAT IS WHY IT IS HARD TO CATCH.** Once 12:00Z aged past
`FORECAST_NOW.expiryGraceMs` the clock test caught it after all. The window ran
09:00Z to 13:00Z. Any capture taken outside one shows nothing wrong, which is
the whole reason these particular bytes are in the repo.

## Moke is the control, and he is the control for a reason

`moke-*` is CP032026 from the same 13:04Z capture. His skew is **28 hours and
four advisories** — cone, forecast track and forecast points all still at
advisory 4 (filed 2026-08-21 09:13Z) while his wind radii, his record and the
feed are all at advisory 8 from that morning. Far worse than Lala's six hours.

**And he has no fold.** Advisory 4 forecast him well: its tau-24 named 14.3°N
148.4°W for 06:00Z and the record put him at 14.1°N 148.7°W — 20 nm out after a
day. Every surviving forecast hour is genuinely ahead of him, so §7.14 drops
nothing on Moke and the timeline is unchanged.

That is the assertion that matters most in `tools/test-forecast-overtaken.mjs`.
The fault is **not** "the layers disagree" — Moke's disagree far more and draw
correctly. It is "the storm outran the forecast it is being drawn against", and
a rule that fires on staleness rather than on overtaking would break Moke to fix
Lala. Three sessions in a row have now tried to reproduce a Lala fault on Moke
and failed; this time the failure is the point.

## What these bytes cannot prove

Whether the corrected shape reads right. Whether a forecast line that starts at
the storm and skips to tomorrow looks like a forecast or looks like a missing
dot is a question for a phone, and it stays Aaron's.
