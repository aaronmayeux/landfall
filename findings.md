# Seasons — step 0 findings

Probed 2026-08-24T13:56:10.932Z on a GitHub Actions runner.

**109 requests, 0 failed outright.** A 404 is not a failure here — it is how "this year does not exist" arrives.

**These answers replace the assumptions in `SPEC-SEASONS-BUILD.md` §57.31.** Raw bytes are under `raw/`; every response header is in `manifest.json`.

---

## 1 — Current-season b-decks — MEASURED

`https://ftp.nhc.noaa.gov/atcf/btk/` holds **18 `.dat` files**.

| §57.13 class | count |
|---|---|
| storm | 14 |
| invest | 4 |

Basins present: al, cp, ep. Years present: 2026.

**14 files survive §57.13's filter** (numbers 01–30). No test systems in the directory today. **4 invests**, whose numbers are reused within a season.

Surviving files: bal012026.dat, bal022026.dat, bal032026.dat, bcp012026.dat, bcp022026.dat, bep012026.dat, bep022026.dat, bep032026.dat, bep042026.dat, bep052026.dat, bep062026.dat, bep072026.dat, bep082026.dat, bep092026.dat

### The line layout, read rather than assumed

**Comma-separated fields per line, across all 14 files: 28, 30, 36, 38, 40, 44.** **NOT A FIXED FIELD COUNT.** The extra fields are a trailing run of key/value pairs, so a parser must read the fixed head by position and the tail by pairs — indexing the tail by number will break.

| file | lines | distinct times | max rows sharing one time | radius thresholds | peak kt | names seen |
|---|---|---|---|---|---|---|
| bal012026.dat | 13 | 13 | **1** | 0 34 | 40 | GENESIS001 → INVEST → ONE → ARTHUR |
| bal022026.dat | 30 | 27 | **2** | 0 34 50 | 50 | GENESIS004 → INVEST → TWO → BERTHA |
| bal032026.dat | 12 | 12 | **1** | 0 34 | 40 | GENESIS006 → INVEST → CRISTOBAL |
| bcp012026.dat | 124 | 59 | **3** | 0 34 50 64 | 115 | INVEST → ONE → LALA |
| bcp022026.dat | 25 | 25 | **1** | 0 34 | 45 | GENESIS017 → INVEST → TWO → MOKE |
| bep012026.dat | 31 | 31 | **1** | 0 34 | 40 | GENESIS001 → INVEST → ONE → AMANDA |
| bep022026.dat | 16 | 16 | **1** | 0 34 | 40 | INVEST → TWO → BORIS |
| bep032026.dat | 18 | 18 | **1** | 0 34 | 40 | INVEST → CRISTINA |
| bep042026.dat | 19 | 19 | **1** | 0 34 | 40 | GENESIS006 → INVEST → FOUR → DOUGLAS |
| bep052026.dat | 48 | 33 | **2** | 0 34 50 | 60 | GENESIS008 → INVEST → FIVE → ELIDA |
| bep062026.dat | 113 | 52 | **3** | 0 34 50 64 | 90 | INVEST → SIX → FAUSTO |
| bep072026.dat | 91 | 45 | **3** | 0 34 50 64 | 140 | GENESIS011 → INVEST → SEVEN → GENEVIEVE |
| bep082026.dat | 21 | 21 | **1** | 0 34 | 40 | GENESIS015 → INVEST → EIGHT → HERNAN |
| bep092026.dat | 15 | 13 | **2** | 0 34 50 | 55 | GENESIS016 → INVEST → ISELLE |

**==> THE WIND-RADII QUESTION: CONFIRMED. `bal022026.dat` has 2 lines sharing one timestamp, one per threshold (0, 34, 50 kt). A parser keyed on time MUST MERGE.

The shared block, verbatim:

```
AL, 02, 2026072112,   , BEST,   0, 288N,  862W,  50,  996, TS,  34, NEQ,   40,   80,   80,    0, 1010,  100,  40,  60,   0,   L,   0,    ,   0,   0,     BERTHA, M, 12, NEQ,    0,   60,    0,    0, genesis-num, 004, 
AL, 02, 2026072112,   , BEST,   0, 288N,  862W,  50,  996, TS,  50, NEQ,    0,   40,    0,    0, 1010,  100,  40,  60,   0,   L,   0,    ,   0,   0,     BERTHA, M, 12, NEQ,    0,   60,    0,    0, genesis-num, 004, 
```
 <==**

**==> AND THE STORM NAME IS NOT A PROPERTY OF THE FILE. <==** Field 27 changes DOWN the file as the system is reclassified — 14 of 14 files carry more than one name. Taking the name from the first row gives an internal genesis label, not the storm. **Take the LAST row's name.**

`bep072026.dat` — first line, one field per row, so the positions can be counted:

```
(see raw/atcf/ for every file)
```

---

## 2 — HURDAT2 — MEASURED

Files in `/data/hurdat/`: 41. Atlantic 23, Pacific 18.

Full listing: hurdat2-1851-2017-050118.txt, hurdat2-1851-2018-051019.txt, hurdat2-1851-2018-102619.txt, hurdat2-1851-2018-120319.txt, hurdat2-1851-2019-042820.txt, hurdat2-1851-2019-052520.txt, hurdat2-1851-2020-020922.txt, hurdat2-1851-2020-052921.txt, hurdat2-1851-2021-040822.txt, hurdat2-1851-2021-041922.txt, hurdat2-1851-2021-091922.txt, hurdat2-1851-2021-100522.txt, hurdat2-1851-2022-04042023.txt, hurdat2-1851-2022-04072023.txt, hurdat2-1851-2022-040723.txt, hurdat2-1851-2022-042723.txt, hurdat2-1851-2022-050423.txt, hurdat2-1851-2023-051124.txt, hurdat2-1851-2024-040225.txt, hurdat2-1851-2024-040425.txt, hurdat2-1851-2025-02272026.txt, hurdat2-atl-02052024.txt, hurdat2-atl-1851-2023-042624.txt, hurdat2-nepac-1949-2016-041317.txt, hurdat2-nepac-1949-2017-050418.txt, hurdat2-nepac-1949-2018-070119.txt, hurdat2-nepac-1949-2018-071519.txt, hurdat2-nepac-1949-2018-122019.txt, hurdat2-nepac-1949-2019-040820.txt, hurdat2-nepac-1949-2019-042320.txt, hurdat2-nepac-1949-2020-043021a.txt, hurdat2-nepac-1949-2021-040622.txt, hurdat2-nepac-1949-2021-042022.txt, hurdat2-nepac-1949-2021-042522.txt, hurdat2-nepac-1949-2021-091522.txt, hurdat2-nepac-1949-2022-04042023.txt, hurdat2-nepac-1949-2022-042723.txt, hurdat2-nepac-1949-2022-050423.txt, hurdat2-nepac-1949-2023-042624.txt, hurdat2-nepac-1949-2024-031725.txt, hurdat2-nepac-1949-2025-02272026.txt

### Atlantic — `hurdat2-1851-2025-02272026.txt`

Declared size **6.75 MB** (first 96.0 KB sampled).

In the sample: 51 header lines, 764 data lines. **Data fields per line: 21** — consistent.

Status codes seen: `EX`, `HU`, `TS`. §57.4 expects TD, TS, HU, EX, SD, SS, LO, WV, DB.

Sentinels in the sample: `-999` × 10681, `-99` × 0.

First header and its first two data lines, verbatim:

```
AL011851,            UNNAMED,     14,
18510625, 0000,  , HU, 28.0N,  94.8W,  80, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999
18510625, 0600,  , HU, 28.0N,  95.4W,  80, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999
```

### E/C Pacific — `hurdat2-nepac-1949-2025-02272026.txt`

Declared size **3.89 MB** (first 111.4 KB sampled).

In the sample: 48 header lines, 765 data lines. **Data fields per line: 21** — consistent.

Status codes seen: `HU`, `TD`, `TS`. §57.4 expects TD, TS, HU, EX, SD, SS, LO, WV, DB.

Sentinels in the sample: `-999` × 10709, `-99` × 0.

First header and its first two data lines, verbatim:

```
EP011949,            UNNAMED,      7,
19490611, 0000,  , TS, 20.2N, 106.3W,  45, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999
19490611, 0600,  , TS, 20.2N, 106.4W,  45, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999, -999
```

---

## 3 — How far back the archive goes — MEASURED

**A 200 is not an answer on its own.** The text archive is a real directory, so its status means what it says. GIS is a PHP script that answers 200 for any year ever written down, so what is counted there is STORMS LISTED ON THE PAGE. The ATCF directory is real but can be empty, so its files are counted too.

| year | text advisories | GIS storms listed | ATCF files |
|---|---|---|---|
| 1958 | 404 | — | 33 |
| 1969 | 404 | — | 46 |
| 1979 | 404 | — | 38 |
| 1988 | 404 | — | 65 |
| 1992 | 404 | — | 117 |
| 1993 | 404 | — | 83 |
| 1994 | 404 | — | 102 |
| 1995 | 404 | — | 96 |
| 1996 | 404 | — | 78 |
| 1997 | 404 | — | 98 |
| 1998 | **yes** | — | 91 |
| 1999 | **yes** | — | 90 |
| 2000 | **yes** | — | 120 |
| 2003 | **yes** | — | 114 |
| 2005 | **yes** | — | 199 |
| 2008 | **yes** | 35 | 145 |
| 2012 | **yes** | 36 | 144 |
| 2017 | **yes** | 39 | 156 |
| 2021 | **yes** | 40 | 160 |
| 2024 | **yes** | 34 | 136 |
| 2025 | **yes** | 33 | 132 |
| 2026 | **yes** | 14 | — |

**Earliest year with anything real in it:** text 1998, GIS 2008, ATCF 1958.

> **A year that lists storms is not proof a given storm is complete in it.** It says the shelf is eligible, which is all step 11 needs to draw up a list. Whether a chosen storm has every advisory is checked when it is captured, in step 12.

---

## 4 — IBTrACS — MEASURED

### `csv` — 11 files

| file | size | over the 25 MiB cap? |
|---|---|---|
| ibtracs.ALL.list.v04r01.csv | 315.75 MB | **YES** |
| ibtracs.since1980.list.v04r01.csv | 136.84 MB | **YES** |
| ibtracs.WP.list.v04r01.csv | 108.87 MB | **YES** |
| ibtracs.SI.list.v04r01.csv | 73.95 MB | **YES** |
| ibtracs.NA.list.v04r01.csv | 54.47 MB | **YES** |
| ibtracs.EP.list.v04r01.csv | 44.43 MB | **YES** |
| ibtracs.SP.list.v04r01.csv | 33.84 MB | **YES** |
| ibtracs.NI.list.v04r01.csv | 26.59 MB | **YES** |
| ibtracs.last3years.list.v04r01.csv | 9.51 MB | no |
| ibtracs.ACTIVE.list.v04r01.csv | 95.4 KB | no |
| ibtracs.SA.list.v04r01.csv | 55.1 KB | no |

**8 of 11 measured files exceed the cap.**

### `netcdf` — 11 files

| file | size | over the 25 MiB cap? |
|---|---|---|
| IBTrACS.ALL.v04r01.nc | 22.27 MB | no |
| IBTrACS.since1980.v04r01.nc | 10.28 MB | no |
| IBTrACS.WP.v04r01.nc | 8.55 MB | no |
| IBTrACS.SI.v04r01.nc | 5.77 MB | no |
| IBTrACS.NA.v04r01.nc | 4.05 MB | no |
| IBTrACS.EP.v04r01.nc | 3.49 MB | no |
| IBTrACS.SP.v04r01.nc | 2.91 MB | no |
| IBTrACS.NI.v04r01.nc | 2.88 MB | no |
| IBTrACS.last3years.v04r01.nc | 1.33 MB | no |
| IBTrACS.ACTIVE.v04r01.nc | 675.3 KB | no |
| IBTrACS.SA.v04r01.nc | 672.5 KB | no |

**0 of 11 measured files exceed the cap.**

### One basin file, read

`ibtracs.WP.list.v04r01.csv` — declared **108.87 MB** (first 101.0 KB sampled), 174 columns.

Column names:

```
SID
SEASON
NUMBER
BASIN
SUBBASIN
NAME
ISO_TIME
NATURE
LAT
LON
WMO_WIND
WMO_PRES
WMO_AGENCY
TRACK_TYPE
DIST2LAND
LANDFALL
IFLAG
USA_AGENCY
USA_ATCF_ID
USA_LAT
USA_LON
USA_RECORD
USA_STATUS
USA_WIND
USA_PRES
USA_SSHS
USA_R34_NE
USA_R34_SE
USA_R34_SW
USA_R34_NW
USA_R50_NE
USA_R50_SE
USA_R50_SW
USA_R50_NW
USA_R64_NE
USA_R64_SE
USA_R64_SW
USA_R64_NW
USA_POCI
USA_ROCI
USA_RMW
USA_EYE
TOKYO_LAT
TOKYO_LON
TOKYO_GRADE
TOKYO_WIND
TOKYO_PRES
TOKYO_R50_DIR
TOKYO_R50_LONG
TOKYO_R50_SHORT
TOKYO_R30_DIR
TOKYO_R30_LONG
TOKYO_R30_SHORT
TOKYO_LAND
CMA_LAT
CMA_LON
CMA_CAT
CMA_WIND
CMA_PRES
HKO_LAT
HKO_LON
HKO_CAT
HKO_WIND
HKO_PRES
KMA_LAT
KMA_LON
KMA_CAT
KMA_WIND
KMA_PRES
KMA_R50_DIR
KMA_R50_LONG
KMA_R50_SHORT
KMA_R30_DIR
KMA_R30_LONG
KMA_R30_SHORT
NEWDELHI_LAT
NEWDELHI_LON
NEWDELHI_GRADE
NEWDELHI_WIND
NEWDELHI_PRES
NEWDELHI_CI
NEWDELHI_DP
NEWDELHI_POCI
REUNION_LAT
REUNION_LON
REUNION_TYPE
REUNION_WIND
REUNION_PRES
REUNION_TNUM
REUNION_CI
REUNION_RMW
REUNION_R34_NE
REUNION_R34_SE
REUNION_R34_SW
REUNION_R34_NW
REUNION_R50_NE
REUNION_R50_SE
REUNION_R50_SW
REUNION_R50_NW
REUNION_R64_NE
REUNION_R64_SE
REUNION_R64_SW
REUNION_R64_NW
BOM_LAT
BOM_LON
BOM_TYPE
BOM_WIND
BOM_PRES
BOM_TNUM
BOM_CI
BOM_RMW
BOM_R34_NE
BOM_R34_SE
BOM_R34_SW
BOM_R34_NW
BOM_R50_NE
BOM_R50_SE
BOM_R50_SW
BOM_R50_NW
BOM_R64_NE
BOM_R64_SE
BOM_R64_SW
BOM_R64_NW
BOM_ROCI
BOM_POCI
BOM_EYE
BOM_POS_METHOD
BOM_PRES_METHOD
NADI_LAT
NADI_LON
NADI_CAT
NADI_WIND
NADI_PRES
WELLINGTON_LAT
WELLINGTON_LON
WELLINGTON_WIND
WELLINGTON_PRES
DS824_LAT
DS824_LON
DS824_STAGE
DS824_WIND
DS824_PRES
TD9636_LAT
TD9636_LON
TD9636_STAGE
TD9636_WIND
TD9636_PRES
TD9635_LAT
TD9635_LON
TD9635_WIND
TD9635_PRES
TD9635_ROCI
NEUMANN_LAT
NEUMANN_LON
NEUMANN_CLASS
NEUMANN_WIND
NEUMANN_PRES
MLC_LAT
MLC_LON
MLC_CLASS
MLC_WIND
MLC_PRES
USA_GUST
BOM_GUST
BOM_GUST_PER
REUNION_GUST
REUNION_GUST_PER
USA_SEAHGT
USA_SEARAD_NE
USA_SEARAD_SE
USA_SEARAD_SW
USA_SEARAD_NW
STORM_SPEED
STORM_DIR
```

First three lines verbatim:

```
SID,SEASON,NUMBER,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,WMO_AGENCY,TRACK_TYPE,DIST2LAND,LANDFALL,IFLAG,USA_AGENCY,USA_ATCF_ID,USA_LAT,USA_LON,USA_RECORD,USA_STATUS,USA_WIND,USA_PRES,USA_SSHS,USA_R34_NE,USA_R34_SE,USA_R34_SW,USA_R34_NW,USA_R50_NE,USA_R50_SE,USA_R50_SW,USA_R50_NW,USA_R64_NE,USA_R64_SE,USA_R64_SW,USA_R64_NW,USA_POCI,USA_ROCI,USA_RMW,USA_EYE,TOKYO_LAT,TOKYO_LON,TOKYO_GRADE,TOKYO_WIND,TOKYO_PRES,TOKYO_R50_DIR,TOKYO_R50_LONG,TOKYO_R50_SHORT,TOKYO_R30_DIR,TOKYO_R30_LONG,TOKYO_R30_SHORT,TOKYO_LAND,CMA_LAT,CMA_LON,CMA_CAT,CMA_WIND,CMA_PRES,HKO_LAT,HKO_LON,HKO_CAT,HKO_WIND,HKO_PRES,KMA_LAT,KMA_LON,KMA_CAT,KMA_WIND,KMA_PRES,KMA_R50_DIR,KMA_R50_LONG,KMA_R50_SHORT,KMA_R30_DIR,KMA_R30_LONG,KMA_R30_SHORT,NEWDELHI_LAT,NEWDELHI_LON,NEWDELHI_GRADE,NEWDELHI_WIND,NEWDELHI_PRES,NEWDELHI_CI,NEWDELHI_DP,NEWDELHI_POCI,REUNION_LAT,REUNION_LON,REUNION_TYPE,REUNION_WIND,REUNION_PRES,REUNION_TNUM,REUNION_CI,REUNION_RMW,REUNION_R34_NE,REUNION_R34_SE,REUNION_R34_SW,REUNION_R34_NW,REUNION_R50_NE,REUNION_R50_SE,REUNION_R50_SW,REUNION_R50_NW,REUNION_R64_NE,REUNION_R64_SE,REUNION_R64_SW,REUNION_R64_NW,BOM_LAT,BOM_LON,BOM_TYPE,BOM_WIND,BOM_PRES,BOM_TNUM,BOM_CI,BOM_RMW,BOM_R34_NE,BOM_R34_SE,BOM_R34_SW,BOM_R34_NW,BOM_R50_NE,BOM_R50_SE,BOM_R50_SW,BOM_R50_NW,BOM_R64_NE,BOM_R64_SE,BOM_R64_SW,BOM_R64_NW,BOM_ROCI,BOM_POCI,BOM_EYE,BOM_POS_METHOD,BOM_PRES_METHOD,NADI_LAT,NADI_LON,NADI_CAT,NADI_WIND,NADI_PRES,WELLINGTON_LAT,WELLINGTON_LON,WELLINGTON_WIND,WELLINGTON_PRES,DS824_LAT,DS824_LON,DS824_STAGE,DS824_WIND,DS824_PRES,TD9636_LAT,TD9636_LON,TD9636_STAGE,TD9636_WIND,TD9636_PRES,TD9635_LAT,TD9635_LON,TD9635_WIND,TD9635_PRES,TD9635_ROCI,NEUMANN_LAT,NEUMANN_LON,NEUMANN_CLASS,NEUMANN_WIND,NEUMANN_PRES,MLC_LAT,MLC_LON,MLC_CLASS,MLC_WIND,MLC_PRES,USA_GUST,BOM_GUST,BOM_GUST_PER,REUNION_GUST,REUNION_GUST_PER,USA_SEAHGT,USA_SEARAD_NE,USA_SEARAD_SE,USA_SEARAD_SW,USA_SEARAD_NW,STORM_SPEED,STORM_DIR
 ,Year, , , , , , ,degrees_north,degrees_east,kts,mb, , ,km,km, , , ,degrees_north,degrees_east, , ,kts,mb,1,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,mb,nmile,nmile,nmile,degrees_north,degrees_east,1,kts,mb, ,nmile,nmile, ,nmile,nmile,1,degrees_north,degrees_east,1,kts,mb,degrees_north,degrees_east, ,kts,mb,degrees_north,degrees_east, ,kts,mb, ,nmile,nmile, ,nmile,nmile,degrees_north,degrees_east, ,kts,mb,1,mb,mb,degrees_north,degrees_east, ,kts,mb,1,1,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,degrees_north,degrees_east, ,kts,mb,1,1,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,nmile,mb,nmile, , ,degrees_north,degrees_east,1,kts,mb,degrees_north,degrees_east,kts,mb,degrees_north,degrees_east, ,kts,mb,degrees_north,degrees_east, ,kts,mb,degrees_north,degrees_east,kts,mb,nmile,degrees_north,degrees_east, ,kts,mb,degrees_north,degrees_east, ,kts,mb,kts,kts,second,kts,second,ft,nmile,nmile,nmile,nmile,kts,degrees
1884177N17124,1884,14,WP,MM,UNNAMED,1884-06-24 16:00:00,NR,16.5,124.0, , , ,main,165,145,___________O___, , , , , , , , ,-5, , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , ,16.5,124.0,7, , , , , , , , , , , , , , , , , , , , , , , , , , , ,6,280
```
