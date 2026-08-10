# Milton peak surge — built fixture

Simplified to **0.005°** with `lib/simplify.js`, matching the
`maxAllowableOffset` the live relay asks ArcGIS for (SPEC-DATA.md §4.8).

**22 advisories.** Vertices 1,284,651 → **29,463** (97.7% removed). Total 1.20 MB.

| adv | polys | lines | vertices before | after | KB |
|---|---|---|---|---|---|
| 008 | 9 | 8 | 27,601 | 1,219 | 51 |
| 009 | 9 | 8 | 27,601 | 1,219 | 51 |
| 010 | 9 | 8 | 27,601 | 1,219 | 51 |
| 011 | 11 | 12 | 55,797 | 1,471 | 61 |
| 012 | 11 | 12 | 55,797 | 1,471 | 61 |
| 013 | 14 | 12 | 70,105 | 1,623 | 68 |
| 013A | 14 | 12 | 70,105 | 1,623 | 68 |
| 014 | 14 | 12 | 70,105 | 1,623 | 68 |
| 015 | 14 | 13 | 70,109 | 1,619 | 68 |
| 016 | 14 | 13 | 70,109 | 1,619 | 68 |
| 017 | 14 | 13 | 70,109 | 1,619 | 68 |
| 017A | 14 | 13 | 70,109 | 1,619 | 68 |
| 018 | 14 | 13 | 70,109 | 1,619 | 68 |
| 018A | 14 | 12 | 70,108 | 1,618 | 68 |
| 019 | 14 | 11 | 70,107 | 1,617 | 68 |
| 020 | 14 | 10 | 70,088 | 1,598 | 67 |
| 020A | 14 | 8 | 70,086 | 1,596 | 67 |
| 021 | 14 | 6 | 70,076 | 1,586 | 66 |
| 021A | 6 | 4 | 51,435 | 691 | 29 |
| 022 | 5 | 4 | 42,507 | 407 | 17 |
| 022A | 5 | 3 | 42,503 | 403 | 17 |
| 023 | 5 | 1 | 42,484 | 384 | 16 |

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
