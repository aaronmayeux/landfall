# Milton peak surge — built fixture

Simplified to **0.001°** with `lib/simplify.js`, matching the
`maxAllowableOffset` the live relay asks ArcGIS for (SPEC-DATA.md §4.8).

**22 advisories.** Vertices 1,284,651 → **132,033** (89.7% removed). Total 5.26 MB.

| adv | polys | lines | vertices before | after | KB |
|---|---|---|---|---|---|
| 008 | 9 | 8 | 27,601 | 5,528 | 225 |
| 009 | 9 | 8 | 27,601 | 5,528 | 225 |
| 010 | 9 | 8 | 27,601 | 5,528 | 225 |
| 011 | 11 | 12 | 55,797 | 6,564 | 267 |
| 012 | 11 | 12 | 55,797 | 6,564 | 267 |
| 013 | 14 | 12 | 70,105 | 7,231 | 295 |
| 013A | 14 | 12 | 70,105 | 7,231 | 295 |
| 014 | 14 | 12 | 70,105 | 7,231 | 295 |
| 015 | 14 | 13 | 70,109 | 7,232 | 295 |
| 016 | 14 | 13 | 70,109 | 7,232 | 295 |
| 017 | 14 | 13 | 70,109 | 7,232 | 295 |
| 017A | 14 | 13 | 70,109 | 7,232 | 295 |
| 018 | 14 | 13 | 70,109 | 7,232 | 295 |
| 018A | 14 | 12 | 70,108 | 7,231 | 295 |
| 019 | 14 | 11 | 70,107 | 7,230 | 295 |
| 020 | 14 | 10 | 70,088 | 7,211 | 294 |
| 020A | 14 | 8 | 70,086 | 7,209 | 294 |
| 021 | 14 | 6 | 70,076 | 7,199 | 293 |
| 021A | 6 | 4 | 51,435 | 3,297 | 134 |
| 022 | 5 | 4 | 42,507 | 1,706 | 70 |
| 022A | 5 | 3 | 42,503 | 1,702 | 69 |
| 023 | 5 | 1 | 42,484 | 1,683 | 69 |

## Colour → every range NHC published with it

The colour is a bucket; the range is the forecast for that place. Both are kept.

| colour | ranges |
|---|---|
| blue | 1-3 ft (×190), 1-2 ft (×1) |
| yellow | 3-5 ft (×47), 2-4 ft (×123) |
| orange | 4-7 ft (×12), 5-8 ft (×9), 6-9 ft (×2) |
| red | 5-10 ft (×15), 8-12 ft (×28), 6-10 ft (×10) |
| purple | 10-15 ft (×18), 9-13 ft (×5) |

No unrecognised colours, missing ranges or unexpected geometries.
