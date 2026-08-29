# Seasons fixtures — real storms cut from the full HURDAT2 files

Run 2026-08-24T14:27:59.000Z. Source: https://www.nhc.noaa.gov/data/hurdat/

**These are bytes NOAA published, cut at storm boundaries, nothing edited.**
Copy the ones worth keeping into `samples/seasons/` on `main` by hand.


Directory holds 41 HURDAT2 files. Atlantic 23, E/C Pacific 18.
The newest is picked by the last season in the filename, never by sorting.


### Atlantic — `hurdat2-1851-2025-02272026.txt`

6.75 MB, 2004 storms, 1851-2025.


**Named storms cut**

| id | name | rows | why |
|---|---|---|---|
| `AL092021` | IDA | 40 rows | IDA 2021 — §57.30 step 2 names her as the hand-check, and we already hold her full advisory capture in samples/ida-al092021 to check against. Post-2021 so she carries radius of maximum wind. |
| `AL122005` | KATRINA | 34 rows | KATRINA 2005 — wind radii present (2004+), RMW absent (pre-2021), several landfalls. The middle band §57.9 describes. |
| `AL041992` | ANDREW | 52 rows | ANDREW 1992 — pre-2004, so NO wind radii at all, but landfalls ARE marked (the §57.7 gap ends in 1991). Pressure present. |
| `AL111989` | HUGO | 64 rows | HUGO 1989 — inside the 1971-1990 landfall hole. A US landfall that NOAA did not mark. §57.7. |
| `AL031935` | UNNAMED | 52 rows | LABOR DAY 1935 — UNNAMED, pre-1950, and the headline entry on §57.14 alias list. |
| `AL011851` | UNNAMED | 14 rows | The first storm in the file. Already held as part of the probe sample; kept here so one directory holds every era. |
| `AL092017` | HARVEY | 74 rows | HARVEY 2017 — §57.41's headline case. He went inland near Rockport, back out over the Gulf and ashore again near Cameron, so a stall measured from a window's own FIRST FIX reports nothing at all for the storm whose whole reputation is that it stopped moving. Cut 2026-08-29. |
| `AL052019` | DORIAN | 70 rows | DORIAN 2019 — the other stall, and a different shape: two days genuinely parked over Grand Bahama rather than a track that doubles back. Five landfalls, so the naming and the count are both exercised. Cut 2026-08-29. |
| `AL182012` | SANDY | 45 rows | SANDY 2012 — §57.41's extratropical rule. NOAA marks her New Jersey landfall; this app declines it because she was already extratropical, and her ENTIRE reputation is that landfall. The paragraph has to say so in words or a correct rule reads as a bug. Cut 2026-08-29. |

**Found by rule**

| id | rows | what it proves |
|---|---|---|
| `AL021971` | 5 rows | A row with NO assigned intensity (`-99`). §57.6 says the non-developing depressions of 1967 have this; this is the first one in the file. |
| `AL041932` | 73 rows | Carries an EAST longitude. A parser that assumes W and negates blindly puts this storm on the wrong side of the planet. |
| `AL091955` | 39 rows | Carries an `R` record identifier — a rapid intensity change. §57.5. |
| `AL011852` | 45 rows | The first storm with a real radius of maximum wind (field 21). §57.6 puts that cliff at 2021. |

**Whole seasons cut**

- **2005** — 31 storms, 116 KB
- **2021** — 21 storms, 75 KB

**Counted across the WHOLE file, not a sample**

- Data rows: **55605**
- Field counts on data rows: `21` 55605
- Status values: `TS` 20383 · `HU` 15785 · `TD` 9929 · `EX` 6279 · `LO` 1725 · `SS` 736 · `SD` 326 · `DB` 304 · `WV` 138
- Record identifiers: `L` 1175 · `I` 33 · `R` 11 · `P` 10 · `T` 9 · `S` 8 · `C` 5 · `W` 4 · `G` 1

### E/C Pacific — `hurdat2-nepac-1949-2025-02272026.txt`

3.89 MB, 1262 storms, 1949-2025.


**Named storms cut**

| id | name | rows | why |
|---|---|---|---|
| `EP152021` | OLAF | 23 rows | A 2021 E Pacific storm — the Pacific file with a modern row shape. |

**Found by rule**

| id | rows | what it proves |
|---|---|---|
| `—` | nothing cut | No `-99` wind value anywhere in this file. |
| `CP011957` | 48 rows | Carries an EAST longitude. A parser that assumes W and negates blindly puts this storm on the wrong side of the planet. |
| `—` | nothing cut | No `R` record identifier in this file. |
| `EP012021` | 17 rows | The first storm with a real radius of maximum wind (field 21). §57.6 puts that cliff at 2021. |

**Whole seasons cut**

- **2021** — 19 storms, 60 KB

**Counted across the WHOLE file, not a sample**

- Data rows: **32026**
- Field counts on data rows: `21` 32026
- Status values: `TS` 12259 · `HU` 8009 · `TD` 7832 · `LO` 3407 · `DB` 332 · `EX` 165 · `SS` 9 · `SD` 8 · `WV` 5
- Record identifiers: `L` 139 · `I` 7 · `T` 5 · `S` 3