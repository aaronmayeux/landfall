# SPEC-SEASONS-BUILD.md — the historical globe

**A BUILD PLAN, NOT CANONICAL AS-BUILT. NOTHING IN HERE IS SHIPPED.** As each
step lands it moves into the real specs — `SPEC-UI.md`, `SPEC-MAP.md`,
`SPEC-DATA.md` — and leaves this file. **When this file is empty, delete it.**

**Agreed with Aaron 2026-08-24 over one planning session.** Every decision below
has its reason written beside it, so a later session can disagree with the
*reason* rather than re-derive the *decision*. Do not reopen a numbered
decision without new evidence; say what the new evidence is.

**THE STEPS IN §57.30 ARE SIZED FOR ONE SESSION EACH.** Do not start two. Each
one names what it builds, what Aaron looks at on glass, and what "done" means.
A step is not done until it is on a phone.

---

## 57. Seasons — the historical globe

A second globe, in its own visual world, showing the tropical cyclone record
rather than the weather. You pick a basin and a year, see that season's name
roster, tick the storms you want, and watch them on an otherwise empty planet.
It is the same app, the same gestures, the same code — pointed at the past.

**It is called Seasons.** Not History, not The Record, not Archive. Aaron's
call; it reads better on a button and it names the unit the feature is
organised by.

### 57.1 Settled decisions — do not re-litigate

Everything here was decided in the planning session. The reason is with it.

| # | Decision | Why |
|---|---|---|
| 1 | **Name: Seasons** | Reads better on a button; names the organising unit |
| 2 | **Front door is the shelf AND the year picker**, not one or the other | A curated shelf is what people actually open the feature for; a year picker is the only thing that answers "what happened in 1998" and needs no maintenance |
| 3 | **The season clock ships in v1** | It is the reason to build the feature. Static tracks alone are a list with extra steps |
| 4 | **Every basin from the start** | Aaron's call. Note §57.12 — most of the world has no annual name list, so those basins get a storm list rather than a roster |
| 5 | **Theme is sepia** | Aaron's call on glass: "it feels like an old historical record." §57.20 records a measured collision and the fix, which does not change the direction |
| 6 | **"Near home" replaces the "None" filter, with a radius slider** | "None" is a button that does nothing useful. Distance-from-home is the version of this feature Aaron would open twice a week |
| 7 | **Data downloads only on request**, behind a button with the real boot spinner and a progress bar | It is megabytes. Nobody pays for it who does not want it |
| 8 | **The spinner is the app's own mark**, `#mark-spiral` with the `#boot-mark` animation | It already exists, it is already right, and a second loading animation would be a second thing to keep in sync |
| 9 | **Population is NOT in Seasons** | Aaron's call. Drawing today's population under a 1900 track is a claim about what *would* happen, not what did |
| 10 | **Not a FAB. Two doors** — bottom of the storms list, and a row on the Home dashboard | Both are places you already are. No new chrome |
| 11 | **Absent UI is deleted, explained, or disabled-with-reason** — never silently greyed | §57.25. A permanently disabled control is a promise that cannot be kept |
| 12 | **The Seasons layer list is opt-in, not a filtered copy of the live one** | An opt-out list rots: the next live layer that forgets to exclude itself ships a broken toggle |
| 13 | **Map modules are shared; only the menu is rebuilt** | Reuse the machinery, rebuild the menu |
| 14 | **All sixteen suggestions from the planning session are in scope** | They are distributed through §57.10–57.29 rather than listed as a block |
| 15 | **The shelf is every RETIRED NAME plus the famous unnamed storms** — and it is NOT the Tier 2 list | Aaron's call 2026-08-24. Retirement is the WMO's own definition of "bad enough to remember", so the shelf stops being our taste. A shelf entry points at track data we already hold; Tier 2 costs megabytes. §57.17 |
| 16 | **The forecast stays in Tier 2 in full, and each Tier 2 storm is its own download** | Aaron's call 2026-08-24. Forecast against reality is the reason the feature exists. Per-storm download means nobody pays for a storm they do not open, so size stopped being a reason to cut anything. §57.17a, §57.24 |
| 17 | **The SCREEN says "Past storms". The feature is still called Seasons everywhere else** | Aaron's call 2026-08-24, and it narrows decision 1 rather than reversing it. Seasons is the right name for the organising unit in a spec; "Past storms" is what a row on a phone has to say to be pressed. The directory, this file and the `?season=` parameter keep the old name. §57.16a |

### 57.2 What this feature must not break

Existing rules that this feature is unusually good at violating. Each is a real
bug that has already happened once, in this repo or next door to it.

- **==> HISTORY MUST NOT WRITE INTO LIVE STORAGE. <==** On 2026-08-10 Hurricane
  Ida appeared as a grey ended storm on the LIVE app, days after a replay,
  because the ended-storm store saved her exactly as designed and had no idea
  the storm was five years old. `lib/replay-mode.js` exists because of that.
  Seasons touches the same write paths and must use the same scoping. A 1935
  storm leaking into the live globe would be a miserable bug to chase.
- **No god files.** New concern, new directory. Nothing bolts onto `main.js`.
  `config/layers.js` is already 856 lines — the Seasons layer set does not go
  in it.
- **One-directional imports.** A cycle means the code is in the wrong file.
- **Zero hardcoded hex, zero raw pixel literals.** The sepia palette is a third
  entry in the tokens file, not a stylesheet of its own.
- **Motion constants live in one place.** The season clock's speed, the ghost
  fade, the focus/dim transition — all named constants, defined before the
  logic that uses them.
- **Touch, mouse and keyboard are all first-class.** Every action in Seasons —
  picking a year, ticking a storm, focusing one on the globe, running the
  clock, scrubbing it — works by tap, by click and by keyboard. Two out of
  three is not done.
- **Never ship silence on failure.** Especially here: an empty season and a
  failed fetch look identical, and the whole feature is about absence.
- **Fixed colour semantics.** Saffir-Simpson colours do not move. They are the
  constant the ground is judged against, not the other way round.

---

## The data

### 57.3 There are two histories, and they arrive by different roads

This is the single fact that shapes the feature.

| Era | Source | Notes |
|---|---|---|
| **Past seasons, Atlantic** | HURDAT2, 1851–2025, 6.8 MB | Updated once a year, late February |
| **Past seasons, E/C Pacific** | HURDAT2, 1949–2025, 4.0 MB | Same update |
| **Current season, NHC basins** | ATCF b-decks, `ftp.nhc.noaa.gov/atcf/btk/` | A small file per storm, updated during the storm. **This is what HURDAT2 is later built from** |
| **Rest of world, past** | IBTrACS | Different agency, larger file, own quirks — unverified, see §57.31 |
| **Rest of world, current** | **Our own capture** | Nobody publishes a reliable running file. This is the only place we truly need to build a store |

**The current season is not a gap we have to fill ourselves for NHC basins.**
NOAA already publishes it, in the same lineage as the historical file. We
mirror; we do not invent.

**But the rest of the world IS being lost daily.** JTWC products vanish from
the live directory when a storm ends and their season archives lag badly. Every
day without a capture is permanently gone. That argues for standing the capture
piece up early — see step 3 in §57.30.

**Our own `archive` branch cannot help.** It is a rolling 72-hour window,
force-pushed as one commit, no history. Verified 2026-08-24: `history/` held
exactly 72 hourly snapshots, oldest 2026-08-20. Do not plan around it.

### 57.4 What a HURDAT2 record contains

Verified against NOAA's own format document, not from memory. Per storm: a
header with basin, cyclone number, year, name (or `UNNAMED`), and a row count.
Then a record every six hours, plus extra records inserted at landfalls and
intensity peaks:

- Date and time, to the minute
- **Record identifier** — see §57.5
- **Status** — `TD`, `TS`, `HU`, `EX`, `SD`, `SS`, `LO` (neither tropical,
  subtropical nor extratropical), `WV` (tropical wave), `DB` (disturbance)
- Latitude and longitude
- Maximum sustained wind, knots
- Minimum central pressure, millibars
- 34 kt wind radii, four quadrants
- 50 kt wind radii, four quadrants
- 64 kt wind radii, four quadrants
- Radius of maximum wind — the eyewall

**Category is not in the file.** We derive it from wind, the same way the live
app does. One category function, both worlds.

**==> MEASURED ON REAL BYTES 2026-08-24 AND IT HOLDS. <==** `tools/seasons-probe.mjs`,
results on the `seasons-probe-results` branch. Every data row is **exactly 21
comma-separated fields** in both basins, header rows are 4, and `-999` is the
only sentinel present in the sample (10,681 of them in the Atlantic file alone,
which is what a century of missing wind radii looks like). Atlantic is 6.75 MB
covering 1851–2025; E/C Pacific 3.89 MB covering 1949–2025.

**Take the file from the directory, never by name.** NOAA leaves every past
revision in place — 41 files in `/data/hurdat/` on the day this was measured,
going back to a 2018 vintage — and the newest is not the last one
alphabetically. The probe's first run proved that the expensive way by reading a
file two seasons out of date. **Pick by the last season in the filename.**

### 57.4a What an ATCF b-deck record contains — AND IT IS NOT HURDAT2

Measured across all fourteen of the 2026 b-decks. §57.30 step 2 warned these
two formats lay their wind radii out differently; this is how.

**==> THREE FIELD POSITIONS IN THIS SECTION WERE OFF BY ONE AND ARE CORRECTED
BELOW. <==** Re-measured 2026-08-24 with a numbered dump of a real row. The
old text put the wind threshold at field 11 and the storm name at field 27; the
file puts the **status** at 11, the **threshold** at 12, the **quadrant code**
at 13 and the **name** at 28 (one-based). A parser built to the old text reads
a storm's status as its wind threshold. `SEASONS.atcf` in `config/constants.js`
now holds every index, zero-based, and is the only place they live.

**==> ONE LINE PER WIND THRESHOLD, SO SEVERAL LINES SHARE A TIMESTAMP. <==**
HURDAT2 puts 34, 50 and 64 kt on one row as twelve numbers. ATCF puts each
threshold on **its own line, repeating the position, wind and pressure**, with
the threshold in field 12 and the quadrant code in field 13. Lala, Fausto and
Genevieve each carry three lines per time at their peak; Bertha and Elida two;
the weak storms one.

**A parser keyed on timestamp must MERGE, not overwrite.** Overwriting silently
keeps whichever threshold happened to come last and throws the rest away — a
Cat 4's wind field reduced to its 64 kt core, or to its 34 kt envelope,
depending on line order. Nothing errors.

**And a weak storm cannot show you this.** Every storm below 50 kt has exactly
one line per time, which looks identical to a format that does not do this at
all. The probe's first run read one 40 kt storm and could not answer the
question; it took reading all fourteen.

**==> THE STORM'S NAME IS NOT A PROPERTY OF THE FILE. <==** Field 28 changes
DOWN the file as the system is reclassified — **all fourteen files carry more
than one name.** Cristobal's rows read `GENESIS006`, then `INVEST`, then
`CRISTOBAL`. Arthur's read `GENESIS001 → INVEST → ONE → ARTHUR`. Reading the
name off the first row, which is the obvious thing to do, labels a storm with
an internal genesis counter. **Take the LAST row's name.**

**The field count is not fixed: 28 to 44 across the fourteen files.** The head
is positional; the tail is a run of `key, value` pairs — `genesis-num, 006`,
`SPAWNINVEST, al762026 to al932026`, `TRANSITIONED, alA32026 to al032026`.
**Read the head by position and the tail by pairs.** A parser that indexes to
the end breaks on the first storm that spawns an invest.

**==> AND THE BOUNDARY IS FIELD 35, WHICH THE OLD TEXT DID NOT SAY. <==**
Fields 1–35 are ALL positional, not just the first 28 — 29 is depth, 30 the
seas threshold, 31 the seas quadrant code and 32–35 the four seas radii. The
pairs start at 36. Measured: Lala's rows are 36 fields with the last empty;
Bertha's are 38 and her extra two are exactly one pair, `genesis-num, 004`.
`SEASONS.atcf.positionalFields` is that boundary.

**Every basin NHC covers is in one directory** — `al`, `ep` and `cp` — and the
whole current season is 14 files of a few KB each. §57.13's filter is real and
does work: 18 files on the day measured, 4 of them invests, 14 real storms. No
test systems that day, which does not mean never.

### 57.5 The record identifiers are the story's turning points

`L` landfall · `G` genesis · `I` a peak in both wind and pressure · `P` minimum
central pressure · `C` closest approach to a coast without landfall · `R` rapid
intensity change · `W` maximum sustained wind.

**==> THE REAL FILE CARRIES NINE CODES, NOT SEVEN. <==** Counted across both
whole files 2026-08-24. Atlantic: `L` 1175 · `I` 33 · `R` 11 · `P` 10 ·
**`T` 9** · **`S` 8** · `C` 5 · `W` 4 · `G` 1. E/C Pacific: `L` 139 · `I` 7 ·
**`T` 5** · **`S` 3**. `T` and `S` are absent from the list above and are in
the data. **So the parser carries whatever is in the column, unvalidated** —
a closed list would silently drop the tenth code NOAA adds, and `lib/hurdat.js`
does not have one.

**NOAA has already marked the moments that matter.** The season clock does not
have to guess where a storm's story turns, and the detail panel does not have
to infer a peak. Use them.

### 57.6 The availability cliffs

Every one of these needs an honest line on screen rather than a blank space.
This table is the source for that copy.

| What | Exists from | Before that |
|---|---|---|
| Wind field size (34/50/64 kt radii) | **2004** | Missing, marked `-999` |
| Radius of maximum wind | **2021** | Missing, marked `-999` |
| Pressure on every record | **1979** | Only where actually measured |
| Storm names | **1950** | `UNNAMED` |
| Subtropical classification | **1968** | Not distinguished |
| Wind to nearest 5 kt | **1886** | Nearest 10 kt |

**==> EVERY ROW IN THIS TABLE IS A GENERALITY AND NOT ONE OF THEM IS A RULE.
<==** Measured 2026-08-24. **AL011852 carries a radius of maximum wind of 10 nm
on its landfall row — in 1852, 169 years before the stated cliff.** Hugo,
AL111989, carries three. Both were found by a rule-based search of the whole
file rather than by inspection, which is the only way this kind of thing turns
up.

**So nothing in the parser gates on a year, ever.** Every missing value is
decided by reading the sentinel on that row. This table is for WORDING — an
honest line explaining why a figure is usually absent in an era — and it must
never become a condition in code. A year gate would have thrown away real
published data on three of the storms already in `samples/seasons/`.

Two more that are not date cliffs but are missing data all the same:

- **A `-99` wind means no intensity was ever assigned**, which is a different
  absence from `-999`. §57.6 attributed this to the non-developing depressions
  of 1967; **the first one actually in the file is AL021971**, and it sits on
  ONE row of a storm whose other four carry a real wind. A parser that nulls a
  whole storm on one such row loses real data.
- **Pre-satellite undercount.** Before roughly 1966 storms are simply missing —
  nobody saw them. A quiet-looking 1935 season page is not evidence of a quiet
  season, and must carry a line saying so.

### 57.7 The landfall gap — twelve Atlantic years, thirty-nine Pacific ones

**==> COUNTED, NOT INFERRED, 2026-08-24. <==** This section used to say the
hole ran to 1990 and cited Hugo, Gloria, Alicia and Elena as its casualties.
**Hugo is not a casualty: his Sullivan's Island landfall is marked in the
current file, 120 kt and 934 mb at 0400Z on 22 September 1989.** That was
found by a test assertion written to the old text going red. `L` markers were
then counted per year across both whole files rather than argued from one
storm.

| period | Atlantic `L` markers | years with any | E/C Pacific | years with any |
|---|---|---|---|---|
| 1951–1970 | 203 | 20 of 20 | 1 | 1 of 20 |
| **1971–1990** | **42** | **8 of 20** | **6** | **2 of 20** |
| 1991–2010 | 277 | 20 of 20 | 61 | 18 of 20 |

**The hole is real, total, and shorter than claimed.** Atlantic: 1971 through
1982, twelve consecutive years with ZERO markers, then 1983 onward populated —
which is why Hugo '89 and Gloria '85 are fine and **Alicia '83 and Elena '85
need re-checking against the file rather than against this section.** E/C
Pacific: 1971 through 1988. NOAA has evidently backfilled part of the range
since whatever document the old claim came from.

**==> AND THE EAST PACIFIC HOLE IS FAR LARGER THAN THIS SECTION SAID.
MEASURED 2026-08-27 ACROSS EVERY MIRRORED SEASON. <==** Not 1971–1988. **39 of
77 East Pacific seasons carry no `L` marker at all** — 1949 through 1958 and
1960 through 1988, with a single storm in 1959 the lone exception in forty
years. Cross-checked against the raw bytes: **Liza, 1976, which killed around
a thousand people at La Paz, carries zero `L` records in our own copy of the
file.** That is a reanalysis gap, not weather.

**Decision, and it went further than this section originally proposed.** See
§57.7a: we compute landfalls ourselves and **ours are the answer everywhere**,
not only where NOAA is silent. NOAA's markers are still parsed and still
carried, stamped `source: 'noaa'`; they no longer decide.

**Do not re-derive this from the old table.** Re-run the count when NOAA
publishes a new revision; `tools/seasons-fixtures.mjs` does it in one job, and
`tools/seasons-landfall.mjs --check` prints the agreement figure every time it
runs.

### 57.7a Landfalls we compute ourselves

**Aaron's call, 2026-08-27: ours everywhere, rather than ours where NOAA is
silent.** The reason is §57.30 step 13 — IBTrACS carries no landfall marker in
any form, so a hybrid would make the West Pacific look different from the
Atlantic for reasons that are about which agency reanalysed the record rather
than about the weather. One method, one answer, every basin and every year.

**How.** `lib/landfall.js` rasterises a coastline into a land mask and walks
each track, recording every crossing from water to land while the system was a
cyclone. `tools/seasons-landfall.mjs` runs it on the runner. Nothing reaches a
phone: the mask is built, used and thrown away inside one job, and what ships
is the answer.

**The numbers, measured over all 3,266 storms in both basins:**

| | |
|---|---|
| storms NOAA marked with any landfall | 839 |
| storms we find came ashore | **1,343** |
| landfalls we find | 2,537 |
| agreement with NOAA, per storm, over the 839 | **98.6%** |
| NOAA marked and we do not — extratropical at NOAA's own mark | 3 |
| NOAA marked and we do not — genuine misses | **9** |
| we mark and NOAA never did | 516 |

**==> WHAT THE SOURCE DATA CANNOT SUPPORT, SO THAT NOTHING BUILT ON THIS
PRETENDS OTHERWISE. <==**

- **Every one of the 87,631 coordinates in the archive is at 0.1°**, about
  11 km, and every gap between fixes is six hours. A computed position is never
  better than ±11 km and a computed time never better than about half an hour.
- **600 of NOAA's own 1,314 markers sit on WATER** against a proper coastline,
  because a 0.1°-rounded position on a barrier island is a coin toss. Matching
  NOAA landfall-for-landfall is therefore chasing noise; the per-STORM question
  is the one that can be answered well, and it is the one the wall asks.
- A mask finer than the position error buys nothing. Tested at 0.01°: agreement
  got slightly **worse** and memory quadrupled. 0.02° it is.
- The 9 genuine misses are at that floor — Alice '54 on Anegada, Andres '97,
  and Walaka's 2018 landfall on French Frigate Shoals, an atoll no global
  polygon set carries.

**The coastline is Natural Earth 10m land plus minor islands, pinned to
`nvkelso/natural-earth-vector@v5.1.2`.** A branch would let 175 years of
history change between two monthly runs with nothing in the diff explaining
why. **`map/coastline.js` is NOT the source and must never be** — it is 1:110m,
126 rings, and Barbados is 296 km from its nearest vertex. It is a drawing
asset and it is correct for drawing.

**Where the answers live.** `seasons/data/<basin>-landfalls-<revision>.json`,
under `seasons/data/` so it inherits that path's `immutable` header and
revision-stamped filename rather than needing new rules. One file per basin,
36 KB gzipped for the Atlantic, shared by all 175 years. `data/seasons.js`
attaches it to each storm at the parse boundary and `stormFacts` reads it, so
the board, the panel, the roster and the globe all get it without any of them
learning a second file exists. `tools/seasons-wall.mjs` reads the same file, so
the wall and the board cannot disagree.

**The fallback is NOAA's list, not an empty one.** §5. When the computed file
has not arrived — the season in progress, or a sidecar that failed — an empty
list would claim the storm stayed at sea. `landfallSource` on the facts names
which is on screen.

**Our numbers no longer match anything NOAA publishes**, and across the years
NOAA did mark we find **1.73x** as many landfalls. That ratio is almost
entirely an era effect: modern seasons match NOAA nearly exactly (2020 is 34
against 34, 2005 is 30 against 29) while 1933 is 41 against 7. NOAA's
reanalysis never marked Caribbean landfalls in the early record. The extra ones
are real crossings nobody wrote down.

**==> AND THE WALL COUNTS STORMS, NOT LANDFALLS. AARON REVERTED THE COUNT ON
GLASS, 2026-08-27. <==** For about a day `seasons/wall.json` carried a real
landfall count, because computing them ourselves finally made counting
possible. It made the `Landfalls` sort a **ranking of archipelagos**: Irene
crossed five separate Bahamian islands and scored 10 while Katrina scored 1,
and 1933 topped the wall at 41 against a season that flattened the Gulf coast
scoring 6. Every number was correct and the leaderboard was useless.

**The wall asks whether a storm touched land, not how often.** The column is 0
or 1, the season figure is how many storms came ashore, and the sort is
labelled **"Came ashore"** to match the filter toggle's own wording — the two
controls ask the same question and calling it two things invited the reader to
assume the sort counted something the toggle did not.

The real per-storm counts are not lost. They are in the landfall file and on
the detail panel, where "Irene made 10 landfalls" is a fact about Irene rather
than a claim about 1933 being the worst season on record.

### 57.7b The season in progress answers for itself, on the device

Aaron's call, 2026-08-28: option A, ship the mask. §57.7a computes the archive's
landfalls on the monthly runner and ships the answers, so no phone ever carried
a coastline. The running season has no reviewed record and no runner pass — the
working best track carries no landfall marker at all (§57.18b) — so its dots
were permanently unmarked and `landfallsKnown` was a constant `false`.

**The number that decided this had never been measured, and when it was it went
the other way.** `NOW.md` carried *"~15 MB packed, almost certainly too much"*
for a fortnight. That was the UNCOMPRESSED size. Measured 2026-08-28 at the
archive's own 0.02° cell, both figures from `node tools/land-mask-pack.mjs
--measure`:

| one byte per cell | 118.80 MB |
| packed to one bit | 14.85 MB |
| **gzipped, which is what ships** | **0.30 MB** |

A raster of the Earth is vast runs of unbroken ocean and unbroken interior; only
coasts carry detail, and coasts are a rounding error of the planet's area. **A
coarser mask does not pay and that is measured too** — every one of the 3,266
storms walked at each resolution against the shipped answers: 0.05° agrees
99.05% with 31 storms changing answer, 0.1° agrees 98.35% with 54. There is no
cheap coarse version, and full resolution costs 0.30 MB anyway.

**The runner cannot do this job, which is why it is done on the device.**
`seasons-hurdat.yml` is the only workflow that commits to `main`, a commit there
spends one of 500 monthly Cloudflare Pages builds, and a season in progress needs
answering more often than monthly. That ceiling is the same reason the current
season lives behind a route rather than in the repo.

**`lib/landfall.js` was split, and the seam is visible in the path.** Every
import in this project ships to every visitor, so the scanline rasteriser — 480,000
coastline edges into a 119 MB array — moved to `tools/land-raster.mjs` and stays
on the runner. The walk stayed in `lib/` because both sides genuinely run it.
That file predicted this: it said its one-byte-per-cell choice was for speed and
that if it ever reached a browser "that decision flips". It flipped.

**Both sides run the identical walk over an identical mask, and that is the
point.** The wall puts 2026 in the same column as 1851; a second implementation
for the browser is exactly how the two would come to disagree about what a
landfall is. Verified rather than asserted: the shipped mask read back through
`lib/land-mask.js` gives byte-identical landfall counts to the runner's own mask
for all 3,266 storms, with 1.5 million cells sampled directly and zero
disagreements.

**The file describes itself and the constants are only checked against it.** A
32-byte header carries the magic, the cell size, the latitude floor and the
dimensions. If `config/constants.js` later moved `landfallMaskStep` and the
reader trusted the constant, every lookup would be offset and every coastline on
Earth would shift sideways while still returning clean booleans — a wrong answer
with no error, on a file that is still perfectly valid. The header decides and a
mismatch throws.

**The coastline pin and the cell size are in the filename** —
`landmask-v5.1.2-0.02.bin.gz` — because the answers change when either does, and
a cached mask from before a change would go on giving old answers to new code. A
new name is a new URL and every cache misses at once.

**The row paints first and the landfalls catch up.** The mask is not awaited: the
season renders from storms already in hand, the mask lands, the triangles appear.
Holding a visible row for a mark under a dot is the wrong trade.

**A mask that never arrives leaves the row exactly as it was (§5).** It does not
blank the season and it does not fill in zeroes — it simply never upgrades
`noaa` to `computed`, so the row goes on saying it does not know. Known-ness is
read off the facts `stormFacts` already stamps rather than threaded down beside
them, because a separate flag invites the quiet failure: the mask fails, the flag
still says true, and the row states nothing came ashore this year on the strength
of markers the working best track does not carry.

**`.gz` joined the service worker's fallback-page guard.** `/seasons/data/` is
cache-first, so a transient 404 answered with the app shell becomes permanent.
The mask's magic bytes mean an HTML page fails loudly rather than answering
wrongly — but on a cache-first path it would fail loudly FOREVER, and the running
season would lose its landfalls until someone cleared the cache by hand.

**Verified on NHC's real 2026 bytes**, not a fixture: Arthur comes ashore on the
Texas coast at 28.6, −96.1, Bertha twice on the Louisiana coast, and Lala and
Fausto stay at sea. `tools/test-land-mask.mjs` asserts the landfall point is on
land the mask itself agrees is land, which is a check against geography rather
than against a number someone typed.

**Confirmed on glass 2026-08-28, and that closed the last open question.** The
mask occupies about 14.85 MB while the phone walks the season and is then freed;
no test could answer whether that hurt, and it does not — the archive opens and
scrolls as it did. **So option B, computing landfalls at the edge, is not needed
and should not be built speculatively.** It stays on record as the fallback if a
future device says otherwise.

### 57.8 What HURDAT2 does not contain, at all

Watches and warnings. Cones. Forecast tracks. Rainfall. Surge. Radar.
Satellite. Deaths. Damage. And explicitly dropped from the old database and
never carried forward: **the state-by-state Saffir-Simpson rating for US
hurricanes** — so "Katrina was a Cat 3 in Louisiana" is not in this file.

### 57.9 Two tiers, and the app must say which it is showing

| | **Tier 1 — the track** | **Tier 2 — the whole night** |
|---|---|---|
| Covers | every storm, 1851 onward | a curated handful |
| Shows | path, strength, landfalls, wind field where it exists | everything the live app shows |
| Time control | the season clock | advisory-by-advisory scrubber |
| Cost | tens of KB a season | Ida is 7.7 MB on her own |

Tier 2 does not scale and should not. It is the director's cut shelf.
**`samples/ida-al092021/` is the model** — 19 forecast advisories, 29 public
advisories, per-advisory GIS (forecast track, cone, points, initial and
forecast wind radii, watch and warning lines), plus final best track, wind
swath, and the post-season report. **§57.17a measures what that actually costs
and settles what gets trimmed** — short version: the coordinate precision, and
nothing else.

**==> BEING ON THE SHELF AND BEING TIER 2 ARE DIFFERENT THINGS. <==** §57.17.
The shelf is every retired name plus the famous unnamed storms, and it points at
track data that exists for every storm since 1851. Tier 2 is a handful of storms
whose whole night was captured. **Andrew '92 is the case that proves the split:
he is a headline shelf storm and can never be Tier 2**, because the text
advisory archive stops at 1998 and the GIS archive at 2008.

**What Andrew DOES have is unusually good for Tier 1**, and the detail panel
should not read as a page full of holes: the full six-hourly best track with
pressure on every record (guaranteed from 1979), **NOAA's own landfall marks**
— he clears the 1971–1990 marking gap by two years, so his Florida crossing is
NOAA's flag rather than our computation, in an app called Landfall — the Cat 4
to Cat 5 re-analysis a decade after the fact, every derived fact in §57.15, and
NHC's written report. **What he has none of is a wind field of any kind**, since
radii start in 2004, so no swath and no footprint: a bright hand-marked line
with real numbers on it, and no storm-night scrubber, ever.

*Unverified and worth checking when step 2 has a parser:* how densely the §57.5
record identifiers are populated in 1992. The season clock leans on them, the
format has carried them since the beginning, and nobody has read Andrew's rows.

**Which storms get Tier 2 is a decision Aaron makes, and it has its own step.**
See step 11 in §57.30.

**==> THE ELIGIBILITY CLIFFS ARE NOW MEASURED, AND THEY ARE THREE DIFFERENT
CLIFFS. <==** 2026-08-24, `tools/seasons-probe.mjs`. This is the table step 11
picks from.

| What | Reaches back to | What is above the cliff |
|---|---|---|
| **ATCF b-decks** — the track | **1958**, at least; every probed year had files | Everything. 33 files in 1958, 199 in 2005 |
| **Text advisories** — what was said at the time | **1998**. 1997 and every year before is a 404 | The written bulletin. **But NOAA's own note says advisories before 1999 are largely SCANNED IMAGES of printed bulletins** — present, not machine-readable |
| **GIS** — cone, forecast track, watch/warning geometry | **2008** | The only era where a Tier 2 storm can show the cone that was actually drawn |

**So there are three grades of storm, not two, and the middle one is the trap.**

- **2008 onward** — the full Tier 2 as §57.9 describes it. Sandy '12 qualifies.
- **1998–2007** — text advisories exist, **geometry does not.** Katrina '05 is
  in this band. A scrubber can show what NHC *said* on each advisory and cannot
  show the cone. That is a real and interesting thing to build, but it is not
  the same feature, and promising a cone here would be promising a drawing we
  would have to invent. §57.10's `existed but not captured` is the wrong
  wording for it too — these warnings existed and *cannot* be captured as
  shapes, because they were never published as shapes.
- **Before 1998** — track only. **Andrew '92 cannot be a Tier 2 storm at all**,
  which kills one of the three obvious shelf candidates before step 11 opens.

**Do not average these three into one sentence on screen.** A 1998 hurricane
with no cone and a 1898 hurricane with no cone are the §57.10 hazard restated,
and this table is what tells them apart.

### 57.10 Watches and warnings — the three states

Aaron asked directly: do we show all of them? **No, and this is one of the more
important honesty calls in the feature.**

Watches and warnings were never part of the best track. They were text
bulletins at the time, and map geometry only in the modern era. For most of 175
years there is nothing to draw. Three states, matching the three the data layer
already uses:

1. **Shown** — Tier 2 storms. Real geometry, real advisory, exactly like live.
2. **Never existed** — pre-warning-era storms. Say so.
3. **Existed but not captured** — recent enough that NHC issued warnings, but we
   have not captured the archive. **This is the dangerous one.** A 1998
   hurricane showing no warnings looks identical to an 1898 hurricane showing
   no warnings and means something completely different. It must say
   "not captured", never "none".

### 57.11 Operational versus reviewed

Current-season numbers are what NHC believed while it was happening. The
reviewed version lands the following spring and **will** differ — positions get
nudged, intensities revised. Andrew was upgraded from Cat 4 to Cat 5 ten years
after the fact.

- A current-season storm carries a provisional stamp and a line naming when the
  final analysis is due.
- **The Central Pacific is slower** — its reviewed best track can take years,
  not months. Lala and Moke may sit provisional for a long time.
- The data model keeps room for both versions rather than overwriting. Showing
  a storm's operational track against its final track is a small piece of magic
  nobody else does, and it costs nothing now to leave the door open.

### 57.12 Only two basins have annual name lists

Atlantic and East Pacific get a fresh list each year. **The West Pacific does
not** — it runs one continuous list across years. Indian Ocean and Southern
Hemisphere are their own arrangements again.

So "the names for 2026" is a meaningless question in most of the world.

**Atlantic and East/Central Pacific get the name roster. Every other basin gets
a plain storm list, chronological, with no ghosted names.** Write this into the
component's contract or a future session will build a broken screen for Typhoon
Alley.

### 57.13 Storm numbers must be filtered

From NHC's own README: **01–30 are real storms. 90–99 are invests, and those
numbers are reused repeatedly within a season. 80–89 are internal test systems
that must always be ignored.**

Mirror the directory blindly and we ship test storms, plus an invest numbered
92 that collides with itself three times in one season.

### 57.14 Unnamed storms

Pre-1950 storms are all `UNNAMED`, and non-developing depressions before 2003
are too. They belong on the globe.

- In a roster, they display as `Storm 4` in the season's own chronological
  order. **They do NOT collect at the bottom** — the order is the season, and
  moving them would break the one thing the roster is for (§57.18).
- In a list, they display as `Storm 4, 1935`.

**==> AND A SPELLED-OUT NUMBER IS AN UNNAMED STORM, WHICH THIS SECTION USED TO
MISS. <== MEASURED 2026-08-24:** 71 storms across the two HURDAT2 basins carry
`TEN`, `NINETEEN` or `TWENTY-TWO` in the name column, in 22 distinct forms
including **both** `TWENTY-ONE` and `TWENTYONE`. They are storms that never
earned a name, wearing their number in words — exactly what `UNNAMED` means.

**2005 is the season that proves it matters:** NOAA wrote its tenth system as
`TEN` and its twenty-first as `UNNAMED`, so before this rule the roster showed
`TEN` beside `Storm 21` for two storms of identical standing, and one of them
looked like a name a person had chosen. `lib/hurdat.js` folds both into
`name: null` and the display form above covers all of them.

**IT ALSO PROTECTS THE GHOST ROSTER.** A storm called `TEN` counted as a used
name would be checked against a list it can never appear on and reported as
off-list — real noise in the one signal built to detect a real fault (§57.18a).

**ONE DISAGREEMENT IS NOAA'S OWN AND WE FOLLOW THE ID.** `AL232005` carries the
name `TWENTY-TWO` — post-season reanalysis inserted a storm and renumbered
without rewriting the label. The app shows `Storm 23`, because the identifier
is the authority and the name column here is not a name at all.
- **A small hand-maintained alias list** covers the famous ones — the Labor Day
  hurricane of 1935, the Galveston hurricane of 1900. **This list is half the
  shelf** (§57.17): a storm that was never named can never have its name
  retired, so the retired-names rule cannot reach these and the alias list is
  what does.

### 57.15 Derived facts — computed, never fetched

None of this is in any file; all of it falls out of the numbers. This is what
the detail panel is made of (§57.22).

- Peak intensity, when and where
- Lifespan; days at hurricane strength; days at major strength
- ACE — the standard accumulated-energy figure
- Every landfall: time, place, wind and pressure at the crossing
- Closest approach to home, and the storm's strength at that moment
- Fastest 24-hour intensification — how you find the rapid-intensification storms
- How it ended: went extratropical, dissipated, or was absorbed
- Season totals: named storms, hurricanes, majors, US landfalls, ACE

---

## The interface

### 57.16 Getting in, and getting out

**Not a FAB.** Two doors, both in places you already are:

1. **A permanent row at the bottom of the storms list** — *"Seasons — every
   storm since 1851."* No new chrome.
2. **A row on the Home dashboard** — *"Storms near home, ever."* This is the
   better door: it opens with the near-home filter already applied, which is
   the version of Seasons anyone opens twice a week. Home already answers "what
   does this mean for my house"; Seasons answers the same question in the past
   tense.

**Rejected, with reasons, so nobody re-proposes them:**
- *A fifth cluster button* — five floating buttons is a lot on a phone, and it
  implies you can hop to Seasons mid-storm and come back, which is not true:
  the whole globe changes underneath you.
- *Storms list only* — during a quiet season that list is nearly empty, so the
  door is most prominent exactly when it matters least. Backwards.

**Getting out:** a persistent bar along the bottom reading `SEASONS · 2005 ·
Atlantic` with a Leave button. Same shape and same job as the replay bar. You
are never in doubt about which globe you are standing on.

**Deep links.** `?season=2005` and `?season=2005&storms=katrina,rita,wilma`.
Shareable, and it means a specific state can be opened on a phone in one tap
instead of re-ticking six boxes.

---

### 57.16a Getting in and out, as built

Step 4, 2026-08-24. This section describes what IS; §57.16 above is the design
it was built to.

**==> THE READER NEVER SEES THE WORD "SEASONS". <==** Aaron's call
2026-08-24, overriding §57.1 decision 1 for the SCREEN only. Both door rows and
the bar say **Past storms**; the feature, this file, the directory and the
`?season=` parameter all keep the name Seasons. Two names for one thing on a
phone is the failure that call avoided, and the on-screen string is written
down in exactly two places — `DOOR_LABEL` in `ui/seasons-door.js` and
`ARCHIVE_LABEL` in `seasons/bar.js`.

**THE ONLY THINGS ON THE BOOT PATH ARE THE FLAG, THE TWO ROWS, AND ONE
FUNCTION.** `lib/archive-mode.js` imports nothing; `ui/seasons-door.js` imports
nothing; `main.js` holds an `enterSeasons` that does `await import(...)`.
Everything else — the bar, the deep link, the palette forcing, the exit — is
fetched the first time somebody presses a door (§57.35 fault 4).

**A FAILED IMPORT SAYS SO.** The module arrives over the network on first
press, so a reader on a bad connection can press a door and get nothing at all
— which is the silence §5 forbids, and it is a failure shape a dynamic import
introduces rather than one that existed before. Both call sites put a real
sentence on the status strip.

**WHAT ENTERING IS, IN ORDER.** The wall, then the live app, then the palette,
then the bar. Leaving runs all four backwards, and the order is not cosmetic: a
repaint landing while the globe is still empty is one frame of the right
colours with nothing on them, and a repaint landing after the storms are back
is one frame of the WRONG colours with storms on them.

1. **`lib/archive-mode.js` goes up.** One flag, and `data/lifecycle.js` reads
   it before it writes — see §57.2.
2. **The live globe empties.** `main.js` owns a `liveGlobe` facade with `hide`
   and `show`; the archive is handed it rather than importing `map/` or
   `data/` itself. Storm dots, watched areas (both the MapLibre patches and the
   3D rings), imagery, the 3D cage, the flood polygons **and the layer engine's
   ambient geometry — every live storm's past track, cone, wind field and model
   guidance** (§57.21c). The poll keeps running behind it — stopping it would
   mean leaving into a stale app — but **six** gates stop it repainting any of
   them, and `show()` re-pushes from `lastFullState`, so **leaving lands on the
   current weather, not on the weather from the moment of entry.**

   **THE AMBIENT HALF WAS MISSING UNTIL 2026-08-25 AND IT IS THE ONE WORTH
   NAMING.** Everything else in that list is a MARK the facade holds a handle
   to; the ambient bundles belong to the layer engine, so emptying all five
   left them drawn and the sepia globe carried this week's cones over whatever
   year was open. `hide()` calls `engine.ambientPrune(new Set())`, which drops
   the bundles and runs each layer's `forget` hook so the coastal band caches
   go with them; `show()` rebuilds through `pipeline.repushAmbient()`, reading
   the geometry cache and the ended-storm registry rather than the network.
3. **`forceMode(MODE.SEPIA)`.** `releaseMode` restores whatever was live
   including a settings change made while inside.
4. **The bar mounts** and `data-seasons="on"` goes on `<html>`.

**==> NOTHING IS "CLEARED" BY PUSHING AN EMPTY ARRAY, AND THAT IS §5 ARRIVING
FROM AN ODD DIRECTION. <==** An empty push to the watched-area layer is exactly
what a genuine all-clear looks like. `hide()` owns the emptying deliberately
and once; the gates only decline to undo it.

**THE DRAWER IS NAVIGATED, NOT CLOSED.** Step 4 closed it because there was
nothing to put in it; the board is a view inside it now, so entering runs
`drawer.go('seasons-board')` and focus lands on the year picker rather than
being placed on the Leave button by hand (§57.18a).

**THREE CLUSTER BUTTONS ARE HIDDEN WHILE THE ARCHIVE IS OPEN.** Storms, Home
and Layers each open a live-app drawer over an empty sepia globe: a list naming
storms that are not drawn, a dashboard describing a house against a storm that
is not there, and toggles for layers with no data behind them. `display: none`
rather than a fade, so they leave the tab order too (§13). **Recenter and
Settings stay** — the camera is the same camera, and Settings has an explicit
answer for being used from in here: `setThemeMode` keeps the new preference as
the RESTORE target instead of applying it, so a theme picked inside the archive
is the theme you get back on the way out.

**THE BAR NAMES THE SEASON, AND THAT SENTENCE IS A BUTTON.** *"Past storms ·
2005 · Atlantic"*, and pressing it reopens the board. Step 4's *"The year
picker is not built yet"* is **deleted**, as this section required. The bar is
also the only place the way back to the board can live: the storms, home and
layers buttons are all hidden while the archive is open, so a closed board over
an archive globe would otherwise have no door. §57.18a.

**A DEEP LINK'S REASON OUTRANKS THE SEASON.** `?season=1066` now falls through
to a year that exists, so without words the reader is looking at a working
archive that is quietly not the year they were sent — worse than the old empty
globe, not better. The bar keeps saying the link was wrong.

**A DEEP LINK IS VALIDATED, NOT PARSED.** `seasons/deep-link.js` answers with a
value the rest of Seasons can use unchecked, or with null and a reason.
`?season=1066` is a **malformed link, not an empty season** — the globe under
it is empty either way, so only the words can tell a typo from a quiet year,
and the bar says which. The year floor is `SEASONS.firstSeason`; the ceiling is
one year past the current one, because a link made on 31 December in one
timezone is opened on 1 January in another. `?storms=` is lowercased, trimmed,
deduped, slug-validated and capped at `SEASONS.deepLinkMaxStorms`.

**THE URL IS WRITTEN WITH `replaceState`, NEVER `pushState`**, so the phone's
own Back gesture does not walk the reader through every year they looked at.
**Other parameters survive a round trip** — `?replay=ida` is the one that
matters: entering the archive from a replay page and coming back out lands on
the replay, not on the live app.

**A FAILED ENTRY LEAVES.** Every step inside entry is wrapped, and a throw
anywhere in it goes out through the same door a button press would. A reader
looking at a sepia globe with no storms and no bar has no way back short of a
reload, which is the one failure in this mode worth spending code on.

**FOCUS IS A CONTRACT AT BOTH ENDS (§13).** Entering closes the drawer, which
would drop focus onto the document body, so it lands on the Leave button.
Leaving puts it back on the door row that opened it.

**`seasons/` IS THE ONE DIRECTORY HOLDING BOTH KINDS OF THING** — NOAA's
immutable history under `seasons/data/`, and application code beside it. The
`_headers` file therefore names the code files **one by one**: `/seasons/*`
would overlap the immutable rule, and Cloudflare's own documentation does not
state that a wildcard may carry a `.js` suffix, so a `/seasons/*.js` rule that
silently matched nothing would ship modules with no cache instruction at all.
**A new file under `seasons/` needs a line in `_headers` by hand.**

### 57.17 The shelf — and it is NOT the Tier 2 list

**==> THESE ARE TWO DIFFERENT DECISIONS AND THE PLAN USED TO CONFLATE THEM.
<==** Aaron, 2026-08-24. The confusion was expensive in one specific way: it
made "Andrew in the director's cut" look impossible, when in fact **Andrew
belongs on the shelf and simply cannot have advisories, because they do not
exist** (§57.9's cliff table).

- **THE SHELF is curation.** Which storms are worth putting in front of
  somebody. It points at TRACK data, which exists for every storm since 1851,
  so a shelf entry costs a row in a list and nothing else.
- **TIER 2 is capture.** Which storms get the whole night — every advisory, the
  cone, the watch and warning lines. It costs megabytes and is bounded by what
  NOAA published, not by what is interesting.

**A storm can be on the shelf without being Tier 2. Most will be.**

#### The shelf rule: every retired name, plus the famous unnamed

**Aaron's call, 2026-08-24.** A name is retired when a storm was bad enough that
the WMO agrees never to use it again. That is as close to an external definition
of "storms worth remembering" as exists.

Why it is the right rule rather than a hand-picked twelve:

- **It is not our editorial judgment.** The list is the WMO's, arrived at by the
  people who name the storms, and it is the same list a reader would already
  have in their head.
- **It maintains itself in spirit** — one or two names a year, decided each
  spring, and the answer to "should this storm be on the shelf" is never a
  taste argument.
- **A hand-picked twelve is exactly the thing that stops being maintained in
  March.** §57.17 said so about the old rule and was right about it.

**Two holes the rule does not cover, and both are already accounted for:**

1. **The famous storms that were never named cannot be retired.** Galveston
   1900, the Labor Day hurricane of 1935. §57.14's alias list covers these, and
   **the alias list and the retired names together ARE the shelf.** That was
   already the plan; the retired names just replaced the hand-picked dozen.
2. **Not every basin retires names, and those that do use different
   committees.** §57.12's rule again, wearing a different hat: a West Pacific
   shelf built on retirement alone will look thin, and that is a fact about the
   world rather than a gap to paper over.

**==> THE LIST IS HAND-MAINTAINED AND THAT IS A COST, NOT A FOOTNOTE. <==** NHC
publishes retired names as a WEB PAGE, not as a data file — nothing about it is
machine-readable, and nobody has confirmed otherwise. So this is roughly 120
rows somebody types once and adds to each spring. Cheap, and it is a file with
an owner. **Do not build a scraper for it**; a page NOAA restyles once would
silently empty the shelf.

**The shelf is ordered newest first, with the year in parentheses.** It is the
front door because it is what people open the feature for, and it is **not** the
only navigation, because a curated list can never answer "what happened in
1998".

### 57.17a What a Tier 2 storm actually costs — MEASURED

Off `samples/ida-al092021/`, 2026-08-24. **7.7 MB, 269 files**, and it is
lopsided in a way that decides every trimming question.

| What | Size | Share |
|---|---|---|
| Forecast wind radii | **3.07 MB** | 40% |
| The cone (`5day_pgn`) | **1.52 MB** | 20% |
| Best-track geometry | 0.54 MB | 7% |
| Observed wind radii | 0.62 MB | 8% |
| Forecast points | 0.17 MB | 2% |
| Watch and warning lines | 0.08 MB | 1% |
| Forecast track line | 0.01 MB | ~0 |
| **Every advisory NHC wrote — 48 documents** | **0.34 MB** | 4% |
| Post-season report and reference tables | ~0.10 MB | 1% |

**==> THE WORDS ARE ALMOST FREE. THE SHAPES ARE THE ENTIRE COST. <==** Every
bulletin issued over Ida's life is a third of a megabyte. Two geometry files
account for 4.6 MB of the 7.7. Any conversation about trimming Tier 2 that
starts with the text is aimed at 4% of the problem.

**THE FORECAST STAYS, IN FULL. Aaron's call, 2026-08-24**, and it is the
feature's whole point: watching what NHC predicted against what the storm
actually did. That is carried by the cone, the forecast track and the forecast
points — 1.7 MB, and never a candidate for cutting.

**The forecast wind RADII stay too**, though they are a different thing and were
the only real candidate. Fifteen polygons per advisory — five time steps × three
thresholds — and on a globe they stack into overlapping blobs rather than a line
you can compare against reality. They survive because **size stopped being the
constraint** (below), and because a layer that turns out to be mush is one toggle
away from off, whereas bytes we never captured are gone.

*If it ever does need a dial:* the 34 kt threshold alone is **1.10 MB** of the
3.07, and it is the one that answers "was I inside the forecast" — the 50 and 64
kt shapes sit underneath it. **Decide that on glass**, after seeing four days of
forecast footprints stacked on one screen, and not before.

#### Two changes that make the whole question go away

**1. TRIM THE COORDINATE PRECISION ON CAPTURE. Free, and it applies to every
storm forever.** These are raw NOAA exports carrying full float precision.
Measured over all 216 GeoJSON files: 6.02 MB as captured, **4.94 MB at four
decimal places** (~11 m), 4.49 MB at three (~110 m). A cone's edge is not
meaningful to eleven metres. **Four decimals, and nothing on screen changes** —
Ida lands at roughly 5.4 MB.

**2. ==> EACH TIER 2 STORM IS ITS OWN DOWNLOAD. <==** This is the change that
matters, and it is why nothing had to be cut. §57.24's gate was written for a
basin — one button, one bundle. **A Tier 2 storm is fetched when the reader opens
that storm, and not before.** Nobody pays for Andrew unless they open Andrew, so
a storm's size stops being a curation question and becomes a per-storm wait.

The remaining cost is the REPOSITORY, and it is affordable: ten storms at ~5.4 MB
is 54 MB on top of today's 32 MB, and ~2,700 files against Pages' 20,000-file cap
(§57.33 limit 3). **The file cap is the one to watch as the list grows, not the
byte total** — Ida alone is 269 files.

**==> AND THERE IS NO PER-STORM STORE TO RETAIN. <==** Rewritten 2026-08-25.
This used to say that §57.34's retention rules applied to a per-storm download
too — twelve storms opened means twelve downloads on the device, needing the same
eviction rule and Settings entry as a basin. **Step 8's deletion (§57.30) took
the device store away**, so a Tier 2 storm is fetched, drawn, and left to the
browser's own cache on the browser's own terms. What survives is the COST gate
(§57.24): 5.4 MB is worth announcing before it moves, whether or not any of it is
kept. §57.34 rules 5 and 6 record the same change from the other end.

### 57.18 The season board

Basin, then year, then the roster.

**The ghosted names are not decoration — they are the season's shape.** Names
are used in order, so the roster *is* the chronological order, and how far down
the list the solid names reach is how far the season got. In 2026 you would see
a handful used and fifteen ghosts. **In 2005 and 2020 there are no ghosts at
all**, because they ran out of names entirely.

**Nobody should ever "tidy up" by hiding unused names.** That is the whole
picture.

Each row: name, dates, a category dot for peak strength, a mark if it made
landfall, a mark if the name was retired. **Retired names are the most
emotionally loaded thing on the screen** and cost only a small static list to
maintain.

**The same name repeats across years** — Ida 2021 and Ida 2009 are different
storms. The year travels with the name everywhere, including in shared links.

Above the roster, the season scorecard from §57.15.

### 57.18a The season board, as built

Step 5a, 2026-08-24. This section describes what IS; §57.18 above is the design
it was built to.

**==> IT IS A VIEW INSIDE THE ONE DRAWER, NOT A SECOND PANEL. <==** §16. The
archive gets `ui/view-seasons-board.js` registered under the id
`seasons-board`, and entering runs `drawer.go('seasons-board')` where step 4
ran `drawer.close()`. A sheet of its own would have meant a second focus trap,
a second scroll container, a second set of sheet-or-rail breakpoints and a
second Escape rule — four chances to drift out of step with every other screen
in this app. **It is registered from `seasons/index.js` on first entry**, once
per page load, so none of it is on the boot path (§57.35 fault 4).

**THE ONE THING THAT IS ON THE BOOT PATH IS THE TRACK LAYER**, and it has to
be. `map/layers/season-tracks.js` adds its source in the `style.load` window
with everything else, because MapLibre inserts a layer relative to one already
in the style — added on first entry instead, it could not get beneath the storm
dots that step 6 draws on top of it. It is one small module holding no state
and drawing nothing until the archive hands it storms.

**IT DOES NOT GO THROUGH `map/layers/registry.js`, AND THAT IS A DECISION.**
The layer engine is built around a live feed: a bundle per warmed storm, a
selected storm excluded from the ambient set, a `forget` hook for storms that
leave. A 1935 season has none of those — it is a fixed set of finished tracks
that arrive at once and never change. **Step 6 is where that question is
actually answered**, because focus-and-dim is the first archive behaviour that
genuinely resembles selection.

**THE ROSTER IS CHRONOLOGICAL AND THE ORDER IS THE POINT** (§57.18). Each row
is a checkbox whose **dot is both the tick and the category**: an outline in
the storm's Saffir-Simpson colour when off, filled when on. So peak strength
reads down the list whether or not a storm is on the globe, in one column
rather than two. The whole row is the label, so the target is the row.

**==> A FILTER NARROWS THE LIST AND NEVER UN-CHOOSES A STORM. <==** Switching
to Majors with a tropical storm ticked leaves it ticked and leaves it drawn.
The roster is what the reader believes and the globe is what they see, and the
two disagreeing is the worst outcome on this screen. `tools/test-seasons-board.mjs`
asserts it and the mutation was run.

**CHANGING YEAR EMPTIES THE GLOBE BEFORE THE NEW SEASON ARRIVES.** Otherwise
the bar names a year the globe is not showing for as long as the fetch takes.

**THE THREE STATES ARE THREE SENTENCES, AND THE THIRD IS THE ONE §5 IS ABOUT.**
A season the record says was quiet (the Atlantic recorded two storms in 1914),
a season we could not reach, and a year the archive does not hold are three
different facts. The first blames the record, the second offers Retry, and the
third does **not** — retrying a year that is not in the index can never work,
and a button that cannot succeed is worse than none. A list emptied by the
reader's own filter blames the filter.

**A YEAR IS RESOLVED THROUGH `index.json`, NEVER BY BUILDING A FILENAME.** NOAA
revises seasons it has already published and a revision lands as a NEW filename
the index starts pointing at (§57.35 FIX 11). A built name would work for
eleven months and then 404 the whole archive.

**THE PICKER IS A NATIVE `<select>` PLUS TWO STEP BUTTONS.** One control that
already works by thumb, mouse and keyboard, with the OS's own scroll-and-type
behaviour free, and on a phone it opens the platform picker — which beats
anything 175 rows in a 60vh sheet could do. §57.29's Wall of Years stays last,
and only if this proves to be the weak link.

**THE BAR'S SENTENCE IS NOW A BUTTON.** `Past storms · 2005 · Atlantic`, and
pressing it reopens the board. Closing the board over an archive globe would
otherwise leave no way back to the year picker, because the storms, home and
layers buttons are all hidden in here (§57.16a). Two controls in the bar: where
you are, and out. **The "year picker is not built yet" sentence is deleted**,
as §57.16a required — but a deep link naming a year outside the record still
overrides the season and keeps saying so, because that fact is about the LINK
and does not stop being true when a season loads.

#### Ghosts are the current year only, and their absence is silent

**Aaron's call, 2026-08-24**, overriding §57.18 for settled seasons.

`lib/season-names.js` **shows** one year's lists — the running season's Atlantic
and East Pacific rosters — and nothing else. A settled year therefore has no
ghost rows and says nothing about names remaining.

**==> THE MODULE IS NOW THE GATE, BECAUSE THE DATA UNDERNEATH IT IS NOT. <==**
`lib/season-names-data.js` is GENERATED and carries six years ahead, so the
one-year rule can no longer be enforced by simply not holding the other years.
`rosterFor` takes the current year as a fourth argument and is **fail-closed**:
a caller that does not say what year it is gets no roster at all. Forgetting it
costs a reader some ghost rows; defaulting it would eventually print last
season's names beside this season's storms.

**WHY THAT IS NOT A LOSS.** For a finished season the names it used already
answer "how far did it get", and the board says the loud half in words: *"Every
name on the list was used."* 2005 running into the Greek alphabet is that
sentence, and it is derived from the storms rather than from a list nobody
typed. The alternative was a per-year roster for 175 years, which no NOAA file
contains.

**==> AN UNKNOWN YEAR SHOWS NO GHOSTS RATHER THAN THE WRONG ONES. <==** The
lists rotate every six years with retired names swapped out, so 2026's list is
not 2027's. `namesFor` is keyed on the year explicitly and answers null for
anything it was not told about — 1935 has no list here and never will. Printing
one year's names against another year's storms would be a confident lie, and
that is the failure this shape makes impossible.

**==> AND THE YEAR NO LONGER TURNS OVER BY HAND. <==** Aaron's call,
2026-08-24, replacing the earlier "hand-maintained is a deliberate cost" note.
`tools/seasons-names.mjs` reads NHC's own names page monthly and writes
`lib/season-names-data.js`. **That page publishes a column per year, six years
ahead, with the year in the header** — so there is no rotation to compute, no
anchor year to get wrong, no retirement table to maintain, and a name the WMO
retires in spring arrives on its own. `samples/nhc-names/` holds the real bytes
the parser was written against.

**THE FAILURE DIRECTION IS THE SAFE ONE, WHICH IS WHY THE OLD SCRAPER OBJECTION
NO LONGER HOLDS.** The lists are HELD in the repo, not fetched by a browser. If
NOAA restyles the page the parse fails, the job goes red, and the last good file
is untouched — and because one good read covers six seasons, the app stays
correct for years while that is noticed. The job refuses to write on any of:
a year header that is not four digits and consecutive, an Atlantic column that
is not exactly 21 names on A–W skipping Q/U/X/Y/Z, an East Pacific column that
is not exactly 24 on A–Z skipping Q/U, a duplicate or non-alphabetic name, a
result holding fewer years than the file it would replace, or — the one that
catches a shifted column — **a head-of-list disagreement with the names this
season has actually spent**, read from the `seasons-live` b-decks.

**A USED NAME THAT IS NOT ON THE ROSTER IS SAID OUT LOUD.** It means either the
season ran past its list onto the WMO supplemental one — real, and what
replaced the Greek alphabet in 2021 — or the list in this repo is wrong. Hiding
the second would make a broken roster look perfect.

**GHOSTS ARE COMPUTED BY MEMBERSHIP, NOT BY COUNTING FORWARD** from the last
name used. NHC occasionally skips a name, and an index would quietly delete
that ghost. Membership cannot make that mistake and costs nothing at 24 names.

**==> CENTRAL PACIFIC GETS NO ROSTER, AND THAT IS MEASURED. <==** §57.12 said
CPHC runs continuous lists rather than annual ones; the archive's own files
confirm it — **HONE (2024), IONA and KELI (2025), LALA and MOKE (2026)**, one
alphabet across three seasons. "The 2026 Central Pacific names" is a question
with no answer, so a roster there would invent a structure the basin lacks.

**THE LISTS ARE HAND-MAINTAINED AND VERIFIED AGAINST OUR OWN BYTES.** They were
transcribed from NHC's pronunciation PDFs, then checked against the real ATCF
b-decks on `seasons-live`: Atlantic positions 1–3 are ARTHUR, BERTHA, CRISTOBAL
and East Pacific 1–9 are AMANDA through ISELLE, in order.
`tools/test-season-names.mjs` re-runs that check position by position against
`samples/seasons-live/`, so a mistyped name in the used range fails the suite.
**It cannot check the unused tail** — nothing can, until a storm spends it, and
that is what makes it a ghost. **Do not build a scraper**, same reasoning as
§57.17's retired names.

### 57.18b The season in progress, as built

Step 5b, 2026-08-24. `data/seasons-live.js`, `ui/seasons-board-markup.js`, and
the second road through `ui/view-seasons-board.js`. §57.18a above is step 5a;
this is the half that reads the year currently happening.

**==> IT IS A SECOND ROAD, NOT A SECOND SCREEN. <==** A settled year is one
static file in this repo; the running year is `/api/seasons/live`, one ATCF
b-deck per storm through `/api/seasons/storm`, and a different parser (§58).
There is exactly ONE branch in the view — the line that picks which facade to
ask — and everything after it reads one shape, so a rule about rosters, filters
or selection cannot end up written twice with a difference in it.

**THE BOARD OPENS ON IT.** Aaron's call. It is the newest year and the one a
reader most likely came for, and on the Atlantic it is three small files — less
than the 14 KB a busy settled season costs. `yearsFor` puts it at the head of
the list, so this is step 5a's "newest year" rule rather than a second one. The
option says `2026 — this season`, because a bare year beside `2025` would read
as one more year NOAA has reviewed.

**==> WHICH YEAR IS "IN PROGRESS" COMES OFF THE FILENAMES, NEVER OFF THE
READER'S CLOCK. <==** §58.1's rule, carried through the client. NHC seeds the
new year's b-deck directory when it seeds it, so on 1 January a phone says 2027
and the season in progress is still 2026. Step 5a read
`new Date().getUTCFullYear()` for the ghost gate because there was nothing
better to read; there is now, and **there is no clock anywhere on this path.**
`rosterFor`'s fourth argument is the live year, and it is null when there is no
live season — fail-closed, no ghosts rather than the wrong ones.

**GHOSTS FINALLY HAVE A YEAR TO APPEAR ON**, which is the visible half of this
step. They stay off a NARROWED roster: "eighteen names are still unused" is a
whole-season fact and printing it at the foot of a Majors list puts an
unfiltered claim under a filtered one.

#### The landfall figure is a dash, and that is measured

**==> THE WORKING BEST TRACK CARRIES NO LANDFALL MARKER. <==** A landfall mark
is NOAA's `L` record identifier, which lives in HURDAT2 and in no ATCF b-deck.
Counted over all fifteen 2026 b-decks in `samples/seasons-live/` — 601 rows —
the parser finds zero, on storms that plainly reached land.

So the scorecard shows **a dash rather than a zero**, and the Landfalls filter
is not offered. In an app called Landfall, `0` on that cell reads as *nothing
reached land this year*; both are six characters on a phone and only one of
them is true. A filter that can only ever come back empty is the same mistake
as a Retry button on a year the archive does not hold (§57.18a). The filter
returns on any settled year, and the suite asserts that too — a control removed
for one season and never restored is the same bug wearing the other face.

**==> AND THE TRAP IS THAT AN `L` IS SITTING RIGHT THERE. <==** ATCF column 23
is the SUBREGION letter. Over those same 601 rows it takes exactly three values
and they are the three basins: `L` on all 55 Atlantic rows, `C` on all 144
Central Pacific ones, `E` on all 402 East Pacific ones. Anyone reaching for it
would ship a feature marking every Atlantic record as a landfall and no Pacific
one. `tools/test-seasons-live.mjs` asserts no b-deck point is ever read as a
landfall, so a future parser change cannot quietly start believing it.

#### The Central Pacific rides with the East Pacific

`SEASONS.liveBasins` maps `atlantic → AL` and `epacific → EP, CP`, and the
mapping is **NOAA's own filing, measured in this repo's files**:
`epacific-2024` holds CP012024, `epacific-2025` holds CP012025 and CP022025.
Anything else would make the season in progress disagree with the 77 settled
years behind it, and **Lala and Moke would fall off the board with nothing on
screen saying a storm was missing.** Both suites name them rather than counting
rows, because a count passes perfectly when CP is dropped.

#### Three states, and the gaps are counted

- **A basin with no storms yet is `ok`** — *"No storms have formed yet in 2026
  in this basin"*. In June that is simply true, and it is a different sentence
  from a settled year's *"The record has no storms for 1914"*.
- **Storms that would not load are counted out loud.** The index says fifteen
  and twelve arrive: a season quietly three storms short reads as complete.
  **And the second clause of that sentence is not a flourish** — a storm's NAME
  is inside the file that would not load, so its name also turns up in the
  unused list below. Nothing can fix that (the index carries ids, not names),
  so it is disclosed. Left unsaid, the ghost list would be quietly wrong on
  exactly the day something is already wrong.
- **Every storm failing is an OUTAGE, never a quiet season.** The road is down,
  not the record.
- **A stored copy says so** — it is a correct list of what it knew about and
  cannot promise nothing has formed since.
- **The live index being unreachable is not "there is no current season".** The
  year is simply absent from the picker, and an absent option explains nothing,
  so the sentence goes on the board — **with a button**, because unlike a year
  the archive does not hold, this is a failure a second attempt can fix. It
  asks only for the live index and leaves the settled year on screen untouched.

#### Politeness, and the reader's phone

Per-storm tracks are **not warmed** (§58.3) and are fetched
`SEASONS.liveFetchConcurrency` at a time — four. The ceiling is the reader's
phone as much as NOAA's server: fifteen parallel requests on a cell connection
is fifteen slow requests, not one fast one. The suite asserts both that the cap
holds and that it is actually REACHED, so a future change that serialises the
whole thing fails rather than passing quietly.

#### Two structural notes

**The board's markup moved to `ui/seasons-board-markup.js`.** The view was 584
lines and this step would have carried it past §12's ceiling. The cut is state
versus markup: the view owns what is true, that file owns what it looks like,
and every function in it is pure — told what to draw, never what the state is.
That is what stops a rule ending up written once in the state machine and once
in a template.

**`tools/spec-index.mjs` now indexes lettered subsections.** Its heading pattern
stopped at the digits, so §57.4a, §57.16a, §57.18a and this section were all
absent from `SPEC-INDEX.md` — a session told to look one up found nothing and
read the whole file, which is the cost the index exists to avoid.

### 57.19 Filters, and the near-home slider

**All · Majors · Landfalls · Near home.** "None" is gone; it was a button that
did nothing useful.

Selecting **Near home** reveals a radius slider:

- **Range 10 to 500 miles, stepping by 10.** Under 10 is noise given a position
  every six hours; over 500 and everything in the Atlantic matches. Default
  around 100–150.
- **What counts as "near":** the storm's **centre** distance, but the panel
  displays **strength at closest approach** — *"Gustav, 2008, passed 31 miles
  west as a Cat 2."* Centre distance works for all 175 years; a wind-field test
  would only work from 2004 and would silently answer "no" for everything
  earlier. The displayed fact is the more interesting one anyway.
- **==> MEASURE AGAINST THE LINE, NOT THE POINTS. <==** A storm moving 20 mph
  covers 120 miles between six-hourly records, so a fast mover can hop clean
  over the circle without a single recorded position landing inside it.

  **==> `lib/shape-distance.js` DOES NOT HAVE LINE-TO-POINT DISTANCE, AND THIS
  SECTION USED TO SAY IT DID. <==** It measures point-to-nearest-VERTEX and
  says so in its own comment — an accepted approximation there, because NWS
  zone outlines are drawn at 65 metres per point against a corridor hundreds
  of miles wide. A track has a point every six hours. The two are not the same
  problem. `lib/near-home.js` owns the real segment measurement, in 3D unit
  vectors so the antimeridian cannot reach it.

  **==> AND THE SIZE OF THE ERROR IS SMALLER THAN THIS SECTION IMPLIED, WHILE
  THE CONSEQUENCE IS WORSE. <==** Measured across the 2005 and 2021 Atlantic
  seasons against six coastal cities: the two methods differ by **2 to 25
  nautical miles**, not hundreds, because the nearest record is usually already
  near the nearest point. What matters is not the size of the gap, it is
  whether the gap moves a storm ACROSS the radius the reader chose. **It does,
  in 4 of 54 city-and-radius combinations — and one of them is Katrina at 30
  miles from New Orleans.** 24.4 nm measured against the line, 30.1 nm measured
  at the records: the single most famous storm-and-city pair in the Atlantic
  record, present in the reader's list one way and missing the other, with
  nothing on screen to say anything went wrong. `tools/test-near-home.mjs`
  asserts exactly that, both ways.
- Once this exists, the same answer belongs on the Home dashboard as a standing
  line — *"31 storms have passed within 100 miles since 1851. The last was
  2021."* That is the hook, and it is free.

### 57.19a Near home, as built

**Step 9, 2026-08-25.** `lib/near-home-words.js`, `ui/seasons-near-home.js`,
`data/near-home-index.js`, `seasons/near-home-worker.js`,
`ui/near-home-standing.js`, and the `nearHomeRange` / `nearHomeKeepMi` /
`nearHomeIndexDelayMs` block in `config/constants.js`. The measurement itself is
step 2's `lib/near-home.js` and is unchanged.

**==> IT IS TWO FEATURES WITH TWO COSTS, AND CONFUSING THEM IS THE MISTAKE THIS
SECTION EXISTS TO PREVENT. <==** §57.35 names two shapes and this step is the
only place both are reached.

- **The filter and its slider are FREE.** A season is already in memory — thirty
  storms, nine hundred segments — so `entriesNearHome` re-measures the whole year
  on every step of a slider drag in well under a millisecond. No fetch, no
  worker, no store. Reaching for the precomputed index here would be paying a
  megabyte to answer a question the loaded file already answers.
- **The standing line on the Home dashboard is the WHOLE-BASIN pass**, because
  *"how many storms have passed within 120 miles since 1851"* is every season at
  once and cannot be answered a year at a time. That is the one caller the
  whole-basin files have left after step 8's deletion.

**MEASURED, on the real files in this repo, and these five numbers are the whole
design. ==> RUN `node tools/near-home-size.mjs` AND QUOTE WHAT PRINTS; DO NOT
COPY THIS TABLE FORWARD. <==** Every figure below is that tool's output,
re-verified 2026-08-26.

| | |
|---|---|
| the archive | 3,266 storms · 87,631 positions · 84,365 segments |
| both whole-basin files | 11.17 MB of text → **0.93 MB over the wire** |
| parse | 358 ms on a cloud-sandbox CPU — see the phone note below |
| the near-home pass itself | 42–50 ms |
| the answer that is KEPT | **19–131 KB** — 526 entries for New Orleans (89 KB), 775 for Miami (131 KB), 112 for Honolulu (19 KB) |

**==> ONE ROW OF THIS TABLE WAS TYPED RATHER THAN COMPUTED AND IT WAS WRONG BY
ABOUT DOUBLE. <==** The stored answer read `10–65 KB`; it is 19–131 KB. Harmless
in effect — `localStorage` is around 5 MB and a house needs a tenth of a
percent of it — but it is precisely the failure CLAUDE.md's first section
describes: a fluent wrong number that nothing about invites a second look. The
entry COUNTS beside it were right, which is what made it read as measured. That
is why the tool exists and why this table now points at it rather than standing
on its own.

**AND THE TWO SIZE FIGURES WERE IN DIFFERENT UNIT SYSTEMS, ONE COMMA APART.**
`10.65 MB` was binary and `0.94 MB` decimal. Both are decimal now, which is what
a browser's network panel and Cloudflare's own reporting use, so the number in
this table is the number a reader would see if they looked.

**==> THE PHONE COST IS STILL UNMEASURED AND THIS SECTION USED TO STATE IT AS A
FACT. <==** It said *"two to three seconds on a phone"*. Nobody has run it on
one. CLAUDE.md is explicit that a millisecond figure out of node is evidence
about node, and the parse and the pass both run in a Worker on a CPU this
sandbox knows nothing about. The design does not depend on the answer — the
pass starts `nearHomeIndexDelayMs` after boot, off the main thread, to fill in
one sentence, so a slow device shows that sentence late and nothing else — but
the figure must not be quoted as though it were taken. **If it is ever wanted
for real, the cheap route is having the Worker report its own elapsed time
through the D1 telemetry already in place and letting real devices answer it.**

The download and the parse are big enough that they must not run on the main
thread and must not run on boot. The answer is small enough to store, which
means they need not run twice.

**==> SO IT RUNS ONCE PER HOUSE, NOT ONCE PER VISIT. <==** The result is written
to `STORAGE_KEY.nearHome` against the coordinates it was computed for **and the
revision stamps of the files it was computed from**. The second half is not
belt-and-braces: NOAA republishes seasons it has already published (§57.30 step
3b — five revisions of the 2022 Atlantic file), and a correction can move a storm
across the reader's radius. Keyed on the year alone a house would hold an answer
computed from a file NOAA has since withdrawn, silently, forever.

**==> AND THERE IS NO MAIN-THREAD FALLBACK, ON PURPOSE. <==** A browser with no
Web Worker gets no standing line. The alternative is a two-to-three second parse
in front of a globe that is trying to hold frame rate, to fill in one sentence at
the foot of a dashboard — which is §57.35 FAULT 1 happening deliberately. A
missing sentence costs a reader nothing.

#### §57.19's mile-only range did not survive contact with the unit setting

**==> THE RANGE IS PER-SYSTEM NOW, AND THIS IS A CORRECTION RATHER THAN A
PREFERENCE. <==** §57.19 fixed 10–500 miles stepping by 10, on the reasoning that
a reader thinks in miles. Half of them think in kilometres and `lib/units.js`
already knows which. The two ways of serving that reader are both worse than
this one: converting 500 miles gives a slider running to 805 and stepping by 16,
and holding the slider in miles while every other distance on screen is in
kilometres is a control lying about its own units.

So each system gets round numbers of its own, **covering the same ground**:
10–500 step 10 mi, or 20–800 step 20 km. Measured, 500 mi is 434.5 nm and 800 km
is 432.0 nm — the same circle to within half a percent, asserted in
`tools/test-seasons-near-home.mjs` so the two cannot drift and quietly cost a
metric reader their reach.

**`radiusToNm` IS THE ONLY PLACE THE TWO SYSTEMS MEET.** Everything above it is a
reader-facing number on a control; everything below is `lib/near-home.js`'s
nautical miles. A second converter anywhere else is how a metric reader ends up
filtering a circle 60% the size of the one on their screen, with a roster that
looks merely quiet rather than wrong.

**The default is the same number in both places by design** — the door says
*"within 120 mi"* and the board opens with its slider on 120. A door that names
one circle and opens a screen set to another is the app disagreeing with itself
in two taps.

#### The list is sorted by distance, and that breaks §57.18's rule deliberately

§57.18 says the roster is chronological and that nobody should ever tidy it by
sorting. **That rule is about a SEASON** — the order names were handed out in IS
the shape of the year. This list is not a season; it is an answer to *"what has
come near my house"*, and the first thing a reader wants from it is the closest
one. Every other filter still sorts chronologically and switching back to All
restores it.

**==> AND NEW ORLEANS CANNOT PROVE IT, WHICH IS WHY MIAMI IS IN THE SUITE. <==**
Deleting the sort left the assertion GREEN on the first mutation run: 2005 gives
New Orleans two storms, Cindy then Katrina, arriving in chronological order that
happens to already be ascending by distance. Miami in the same season is the
shape that can show it — Katrina 10, Ophelia 86, Rita 123, Tammy 96, Wilma 49 —
and the suite now asserts the fixture is out of order before asserting the sort
puts it right. **A fixture that cannot show the thing is worse than no
assertion, because it reads as coverage.**

#### Three absences, and each one is a rule rather than an omission

- **The filter is not offered when there is no house.** §57.18a's rule about a
  control that cannot succeed: with no home set, Near home can only ever narrow
  to nothing, and an empty roster is the one shape this feature must not produce
  by accident.
- **A strength is not claimed unless the record supports one.** §57.19 asks for
  the strength AT CLOSEST APPROACH, and HURDAT2 records `EX`, `LO`, `WV` and `DB`
  alongside the five cyclone statuses. A storm can be extratropical when it
  passes and a Cat 4 two days earlier, so *"as a Cat 2"* read off an `EX` record
  would be a Saffir-Simpson grading NOAA never gave it (§6). The clause is
  dropped; the distance and the direction stay, because they are true either way.
- **A direct hit gets no direction.** At a distance of nothing the bearing is
  arbitrary, and *"0.0 mi NNE"* is a compass point invented out of rounding.

#### The empty answer is the answer

*"No storms in 1997 match that filter"* is true and useless. Under this filter
the empty result **is** what somebody asked for, and it says so in its own words,
naming the circle they chose: *"No storm in 1997 came within 50 mi of home."*
That is the difference between the feature working and the feature looking like
it failed, and it is `emptyRosterHtml`'s fourth branch.

The same rule with the opposite sign governs the standing line. **A failure there
changes nothing on screen** (§57.35 FIX 8's surviving sentence): the archive door
keeps its scope subtitle, which is true, rather than gaining an apology for a
question nobody put. `setNote` refuses an empty string so a failure path cannot
blank a subtitle that was already correct. **What must never happen is the door
reporting zero**, because *"no storm has ever come near you"* and *"we could not
work it out"* are different facts and this feature's whole subject is absence.

#### The standing line takes the door's own subtitle

No new row, no new element, no change to the dashboard's layout. The archive door
already carries a line stating the archive's SCOPE — *"Every storm since 1851"* —
which answers *"why would I press this"*. The standing line answers the same
question with the reader's house in it, which is strictly better, and *"since
1851"* is read off the archive index rather than typed so it cannot outlive the
files that make it true.

**99 assertions in `tools/test-seasons-near-home.mjs`, and NINETEEN mutations
were run to prove they bite** — including the bearing taken the wrong way round,
kilometres converted as miles, the last year read off the whole index instead of
from inside the circle, the revision dropped from the cache key, the worker left
running after a good answer, and an empty slider value read as zero. **Two of
those were real faults rather than checks**: `Number('')` is `0`, so a blank
value was clamping silently to the ten-mile minimum, and the sort assertion was
passing on a fixture that could not show it.

**CONFIRMED ON GLASS 2026-08-25.** The three values §57.30 step 9 lists as settled
by acceptance were settled here.

**AND IT FOUND A GAP IN A FILE THAT WAS NOT ITS OWN.** `ui/slider-grab.js` binds
a `pointerup` listener on `window` and had no guard for there not being one.
Settings has armed it since 2026-07-25 and never met the case; this is the second
caller and met it on the first run, taking the whole board suite down with a
`ReferenceError`. The guard is at that file's own door rather than at this
caller's, so the third caller inherits it.

### 57.20 The theme — sepia, and the collision it has to survive

**Aaron chose sepia on glass.** It reads as an old historical record, which is
exactly the feeling the feature wants.

**==> AND IT HAS A MEASURED COLLISION THAT MUST BE FIXED BEFORE IT SHIPS. <==**
Hue angles, measured rather than eyeballed, from `mockups/seasons-themes.html`:

| | hue |
|---|---|
| Sepia coastline `#C79A4E` | 38° |
| **Cat 2 dot `#FFB52E`** | **39°** |
| Sepia mesh `#7A5A2E` | 35° |
| Cat 3 dot `#FF7A33` | 21° |

**The coastline and the Cat 2 dot are one degree apart.** They are the same
colour separated only by brightness. For scale: the live cyan coast sits 16°
off the nearest category colour, and this repo has *already* ruled that 16° was
too tight — `DARK.mesh` was rotated from 191° to 175° precisely because sitting
16° from the tropical-depression blue made lit nodes read as dull lattice.

**The problem is saturation, not warmth.** Every Saffir-Simpson colour is loud.
If the ground's browns are *faded* rather than *amber* — ink on old paper, not
gold leaf — nothing on the globe can compete with a dot and the historical
feeling survives intact. Arguably it strengthens: real old charts are faded.

**The rule for the sepia palette:** the globe's mesh, coastline and graticule
carry low chroma. The parchment panels, warm ink and warm accent stay in the
chrome, where no category colour is ever drawn. Step 1 in §57.30 builds
**A2 · Sepia (faded)** against A and Aaron picks on glass.

**Sepia is a mode the view forces, never a setting.** `config/theme.js` already
keys palettes by name, so a third entry is cheap — but the user's dark / light
/ auto preference is theirs and comes back untouched on leaving. Otherwise
somebody gets stuck in sepia on the live globe.

### 57.21 Telling four storms apart on one globe

Saffir-Simpson colours are fixed, so every selected storm is drawn from the
same ramp and colour cannot separate them. Three things do, and we do all
three:

1. **Names along the tracks.** `map/layers/name-placement.js` already does this
   job for live storms.
2. **Focus and dim.** Tap a storm — in the roster or on the globe — and it
   brightens while the others drop to a faint ghost. **This is the most
   important interaction in the feature** and it is also how the detail panel
   opens.
3. **Landfall marks.** NOAA flags the exact record where the centre crossed a
   coast. **The app is called Landfall.** These should be the most confident
   mark on the archive globe.

### 57.21a Telling four storms apart, as built

Step 6a, revised on glass 2026-08-25. `map/layers/season-tracks.js` (the line
and its name), `map/layers/season-points.js` (per-fix dots and one-record
dots), `map/layers/season-focus.js` (the one shared opacity rule), and the
selection state in `ui/view-seasons-board.js`. Numbers live in `ARCHIVE_GEO`
(`config/tokens.js`) and the archive's vertex budget in
`SEASONS.trackMaxVertices` (`config/constants.js`).

**CHECKING A STORM AND SELECTING ONE ARE TWO DIFFERENT ACTIONS.** Checking puts
a track on the globe: the line, its name, and nothing else. Four checks give
four tracks, all equally bright. Selecting is a second, deliberate act — the
rest drop to a ghost, the selected storm's line changes ink, and it gains a
Saffir-Simpson dot at every position NOAA published. This split is the whole
shape of the interaction and everything below follows from it.

**THE SELECTED STORM'S NAME COMES OFF ITS LINE AND ONTO ITS FIRST DOT.**
Aaron's call, 2026-08-25. A name set along a chain of forty dots reads as
running through them. It is placed by `map/layers/name-placement.js` — the live
globe's own module, with its two-spot above-or-below search and its collision
test against the drawn track and the dots — and drawn by
`map/layers/season-points.js` on the earliest fix only.

**AND THAT REVERSES THE PARAGRAPH BELOW RATHER THAN IGNORING IT.** The argument
against `name-placement.js` rested on a precondition: an archive track has no
position dot to hang a name off. **It has one now** — this pass put a dot at
every recorded position of the selected storm — so the module became the right
tool the moment the dots appeared. The argument is still correct for every
UNSELECTED track, which is why those still set their names along the line.

**SO WHILE ANYTHING IS SELECTED, EVERY NAME ON THE LINE LAYER GOES TO ZERO,
INCLUDING THE SELECTED STORM'S OWN.** Two reasons stacked on one number: the
others go dark because a dimmed word is illegible AND still holds its place in
MapLibre's collision index, so faded names would go on winning placement fights
against the one the reader asked for; the selected storm's goes dark because it
is being drawn somewhere else, and drawn in both places it would be the same
word twice on one storm.

**PLACEMENT IS SCREEN-SPACE, SO IT IS RECOMPUTED ON `moveend`, DEBOUNCED** with
the live globe's own `LABEL_PLACEMENT.recomputeDebounceMs`. It is far cheaper
here than on the live globe: at most one storm's points, and only while
something is selected. With nothing selected the pass returns on its first
comparison. `text-anchor` and `text-offset` are both read per feature —
**`text-variable-anchor` must stay absent**, because setting it makes MapLibre
choose the anchor itself and silently ignore ours, which on glass looks exactly
like the placement search failing (`map/markers.js` learned that first).

**BELOW THE DOT IS BOTH THE SEARCH'S FIRST CHOICE AND ITS FALLBACK, WHICH MAKES
IT A TRAP TO TEST.** A storm that happens to place below passes whether the
placement ran at all — a mutation that computed the placement and then never
applied the anchor survived until `tools/test-season-points.mjs` gained a track
running straight down the screen, which forces the search onto its other spot.

**THE NAME IS SET ALONG THE TRACK BY MAPLIBRE FOR EVERY UNSELECTED STORM, AND
§57.21's POINTER AT `name-placement.js` WAS WRONG FOR THAT CASE.** That module solves a different problem —
where a name sits BESIDE a moving storm's dot, chosen in screen space against
forecast geometry it must not cross. An archive track has no dot, no forecast
and no current moment; it is a finished curve, and MapLibre sets text along a
curve natively with its own collision handling. Ten names on ten tracks
therefore never overlap, for free. The name repeats every
`ARCHIVE_GEO.nameRepeatPx` along the line, because a name placed once sits at
whatever the midpoint happens to be — frequently off-screen on an Atlantic
crossing, leaving a bright unidentified line.

**FOCUS IS ONE PAINT PROPERTY, NOT A SELECTION SYSTEM.** §57.30 step 5 left
open whether the archive would eventually need the live layer engine once
focus arrived. It does not: the whole set is pushed as before and MapLibre is
told which id is bright, so the data never moves when focus does. That is a
repaint rather than a re-tile of the source, which matters because focus moves
on every tap. `ARCHIVE_GEO.dimmedOpacity` is 0.2 — a ghost, not an erasure:
the shape of the year stays readable while the focused storm is unmistakably
the subject. **Opacity is the only channel**, because hue already means
strength everywhere in this app (§6) and a thinner line at globe distance is
an invisible line.

**THE OTHER NAMES GO TO ZERO WHILE THE OTHER TRACKS GO TO 0.2, AND THE
INCONSISTENCY IS DELIBERATE.** Text is not geometry. A dimmed word is
illegible AND still holds its place in MapLibre's collision index, so faded
names would go on winning placement fights against the one name the reader
asked for — the focused storm could end up the only unlabelled track on
screen. Removing them entirely also reads correctly: focus means *just this
one*.

**TICKING A STORM DOES NOT SELECT IT, AND THAT REVERSED A DECISION MADE ON
2026-08-24.** It used to, on the reasoning that reusing the checkbox gave all
three input paths for free without a second control on a forty-row list. The
predicted cost arrived exactly as written: tick four storms to compare them and
only the last is bright, the other three ghosted, with the bright one chosen by
whichever the reader happened to touch last. Aaron's call on glass, 2026-08-25.
`Show all evenly` existed only to undo that coupling and went with it — a third
control undoing something the reader did on purpose is one control too many.

**SELECTING HAS A PATH FOR EACH INPUT AND NEEDS NO NEW MARKUP.** A thumb or a
mouse taps the track on the globe, and taps open water to clear. A keyboard
presses **Enter on a ticked row**, which toggles. Tab already lands on the
row's checkbox and Space already ticks it, and a native checkbox does nothing
with Enter in any browser, so there is nothing to collide with.

**ENTER ON AN UNTICKED ROW DOES NOTHING — NOT "CLEAR".** `setFocus` refuses an
id nobody has ticked and resolves it to null, so without an explicit guard in
the key handler, tabbing past a storm you had not ticked and pressing Enter
would silently close the storm you were reading. The guard reads as redundant
and is not; a mutation deleting it passed every other assertion in the suite
until `tools/test-seasons-board.mjs` gained the case for it.

**THE ROW CHEVRON WAS THE MORE DISCOVERABLE OPTION AND WAS DELIBERATELY NOT
BUILT.** It is the same markup step 7 added before glass reported every tap
target in this drawer misbehaving, and that cause is still unknown. Enter costs
no markup at all, so it does not re-introduce the suspect shape while it is
under suspicion. Revisit once step 7's fault is diagnosed.

**A TAP ON A TRACK FOCUSES IT; A TAP ON OPEN WATER CLEARS.** The hit box is
`SIZE.touchTarget`, the same 44px the live globe uses, because a track is a
1.75px line. It asks the LINE layer only — including the name layer would make
the word a bigger target than the line it labels. The tap arrives in `main.js`
and is routed to the BOARD through `seasons/index.js`'s `focusSeasonStorm`,
never straight to the globe: the roster is what the reader believes about what
is selected, and a track lighting up while the list looks unchanged is the
panel and the map disagreeing.

**INSIDE THE ARCHIVE THE TAP HANDLER ANSWERS FIRST AND RETURNS EITHER WAY.**
Every other branch in it is about a layer the archive deliberately hides, and
falling through would close the drawer — which in the archive is the reader's
only way back out. **Consequence worth stating: the home marker is not
tappable inside the archive.** It is still drawn, and nothing in Seasons has
anything to say about it until step 9's near-home work.

**A FOCUS NOBODY HAS TICKED IS REFUSED.** The globe only draws ticked storms,
so honouring one would ghost every visible track for a highlight that is not
on screen. Focus is dropped on a year change (ids do not repeat across
seasons), on unticking the focused storm, and on leaving.

**LANDFALL PINS ARE GONE.** Aaron's call, 2026-08-25: they were the archive's
one mark in a non-category ink and on glass they read as clutter over a globe
already full of Saffir-Simpson hues. NOAA's `L` records are not lost —
`lib/season-facts.js` still reads them, the roster row still marks a storm that
made one, and the Landfalls filter still works. What is gone is the mark on the
globe, and `geo.landfallRing` was retired with it.

**THE SELECTED STORM'S LINE CHANGES INK, NOT WIDTH.** It wears
`geo.trackForecast` — the same confident ink the live globe uses for a forecast
leg. Every other track keeps its peak-category hue, which is still the only
thing saying which storm was the monster. **Consequence on glass, and it is the
opposite of the usual instinct:** the selected line becomes quieter, not
louder. The emphasis comes from everything else dropping to a ghost and from
the dots appearing. This mirrors the live globe exactly — a neutral line with
coloured points on it — which is the point.

**THE INK IS BAKED FROM `palette()`, NOT NAMED WITH `gs()`.** The expression
reads `['get','id']`, and `map/theme-state.js` rule 1b makes a paint property
holding both a global-state reference and a feature read resolve to BLACK in
the worker without throwing. Baking is honest here rather than a workaround:
the archive forces sepia for as long as it is open, so there is no theme change
to miss, and the ink only enters through `setSeasonTrackFocus`, which can only
run inside the archive. With nothing selected the expression is a bare
`['get','color']` and carries no baked ink at all.

**THE SELECTED STORM GETS A DOT AT EVERY RECORDED POSITION, DRAWN AS A LIVE
FORECAST POINT.** Same radius, same dark ring, same one- or two-character code
inside, same wider white ring on the earliest fix — the same `STORM_GEO` tokens,
not a lookalike, so the two globes cannot drift apart. The white ring does the
job it does on the live globe: **direction.** A chain reading TD → 3 → 3 → TD
has no start and no end to the eye, and an archive track has no forecast cone to
say which way round it runs.

**EACH DOT IS THE CATEGORY AT THAT MOMENT, NOT THE STORM'S PEAK.** The line
carries peak; a fix carries what was actually blowing there. Katrina reads
Cat 1 over Florida, Cat 5 in the Gulf and Cat 3 at the Louisiana coast, which
is what happened. Once she is selected her line is neutral, so the dots are the
only thing telling the intensity story — the live globe's own division of
labour. `tools/test-season-points.mjs` asserts her dots take more than one
colour, which is what fails if anyone switches the fill to `peakCategory`.

**KNOWN SIMPLIFICATION: AN EXTRATROPICAL TAIL IS GRADED BY WIND.** HURDAT2's
status column distinguishes `EX` and `LO` from the cyclone codes, and §6 says a
non-tropical system must not wear a Saffir-Simpson hue. Mapping those codes onto
natures is a real change with its own glass call, and it would have to move the
track colour and the peak figure with it or the row and the globe would
disagree. Until then all three pass `'tropical'` unconditionally, so nothing
contradicts anything. The visible cost is that a storm's extratropical tail
draws in the hue of its wind rather than a duller one.

**PER-FIX DOTS EXIST ONLY FOR THE SELECTED STORM, AND THAT BOUND IS WHAT MAKES
THEM AFFORDABLE.** 2005 has 28 storms averaging about 40 fixes each. Over
eleven hundred ten-pixel discs is not a season, it is a smear hiding the very
lines it annotates. §57.21 rejected per-record dots outright on those numbers;
the bound is what changed, not the arithmetic. Same bound and same reasoning as
the wind footprint (§57.26a). **This is the one layer that REBUILDS on a
selection change rather than repainting** — a fix does not exist until its
storm is selected, so a selection change genuinely is new data. `season-points.js`
therefore remembers the last pushed set, so the board never has to push twice.

**A ONE-RECORD STORM DRAWS ITS DOT WHETHER OR NOT IT IS SELECTED, AND THAT IS
THE WHOLE DIFFERENCE BETWEEN THE TWO KINDS.** `season-tracks.js` needs two
points to make a line, so a single sighting from a passing ship — real, and
common in the 19th century — has no track at all. A per-fix dot is DETAIL and
waits to be asked for; this dot is the storm's ENTIRE presence on the globe, so
withholding it until selection would be §5's silence arriving through a new
door.

**THE TRACKS ARE SMOOTHED WITH THE APP'S OWN CURVE.** `smoothPath` from
`lib/trackline.js` — the same centripetal Catmull-Rom every live track and the
cone are drawn through, so an archive track and a live one bend identically
rather than the archive showing a hard corner at every six-hourly fix. It takes
`SEASONS.trackMaxVertices` (400) rather than the live globe's 1200, because a
season can put thirty tracks on screen where the live globe has one;
`TRACK_LINE.spacingDeg` decides the count for an ordinary storm anyway, so the
ceiling bites only on the long-lived monsters, which is where it is wanted. The
curve interpolates rather than approximating, so the first and last vertices are
NOAA's own positions — a storm is never drawn somewhere it was not. Results are
memoised per storm and **pruned to the pushed set on every push**, because
ticking is a whole-set push and browsing a dozen seasons in one visit would
otherwise accumulate every curve of every storm ever ticked.

**WHAT IS NOT HERE:** the wind field and the wind swath, which are step 6b.
They are a different data question — HURDAT2 only records wind radii from
2004, so most of the archive gets §57.25's honest line rather than a shape.

**AND THE 3D CAGE IS NOT HERE EITHER — SEE §57.21c.** Everything above is
MapLibre, which is invisible at the space floor where the globe opens. The
archive draws a ridge and a glyph out there now, on the same heightfield the
live globe uses, and the camera work that decides where the reader is looking
when they arrive is in that section too.

### 57.21b The drawer and the bar, as built

Push 2 of the UI polish, 2026-08-25. `ui/seasons-board-markup.js` (the rebuilt
row and the master box), `ui/seasons-board-paint.js` (the three things that
change rows already on screen), `ui/view-seasons-board.js` (the state behind
them), `seasons/bar.js` (`barDetail`), `seasons/seasons.css` (the container
query and the taller sheet), `ui/drawer.js` (the per-view minimise chevron),
`ui/panels.css` (`.check-box`, now shared with the Layers panel) and
`ui/view-home.js` (the door). §57.21a is the other half and describes the
globe; the check-versus-select split it records is the shape everything here
sits on.

**THE ROSTER ROW IS A REAL CHECKBOX, A SOLID DOT, THE NAME, THE STRENGTH BADGE,
THE LANDFALL MARK AND THE DATES.** Left to right, in that order.

**AND THE THREE TEXT PARTS ARE A GRID, NOT A FLEX ROW, SO THE BADGE IS A REAL
COLUMN.** Aaron on glass: right-aligned beside the dates it read as glued to
them — `CAT 4  ▲ Jul 4 – Jul 18` is one run of small text, and strength is what
the eye is scanning for. Three named areas: narrow puts the name and badge on
one line with the dates beneath both, wide puts all three across, and it is the
same three columns either way. The badge is CENTRED in its track, because `TS`
and `CAT 5` left-aligned share a left edge and nothing else.

**THE TWO RIGHT-HAND TRACKS ARE FIXED, AND THE FIRST ATTEMPT WAS NOT.** A grid
whose tracks are `auto` sizes them per ROW, and every row here is its own grid —
so `Jul 4 – Jul 7` gave its date column 68px and `Sep 17 – Sep 28` gave it
101px, sliding the badge 33px sideways between one line and the next. The dates
still ended flush right, so the badge was the only visibly wrong thing, and it
was jagged the whole way down. **This shipped**, with identical markup, every
class defined, the type on the scale and 130 board assertions green. Aaron
found it on glass.

**THE TRACK WIDTHS ARE MEASURED IN A BROWSER AND ARE MULTIPLES OF
`--type-small`.** `tools/seasons-row-check.mjs` renders these rows against this
stylesheet and reports the geometry: the widest badge needs 44px, the widest
date range plus a landfall mark needs 119. A `ch` track would have resolved
against the ROW's font size while everything being measured is set at
`--type-small`, so the two could drift apart silently; tying the track to the
size of the text inside it means a move on the type scale carries the columns
with it. **The multipliers carry ~15% headroom on purpose** — these were
measured in one browser on one platform and the app runs on several, and a
track a few pixels short does not ellipse, it widens and puts the jaggedness
straight back.

**THE ROWS RUN TO THE DRAWER'S OWN EDGE, NOT THE SCROLLER'S.** Aaron on glass:
the open storm's highlight stopped short on both sides and read as a floating
box rather than as the row being lit. `--drawer-body-pad` is smaller than
`--drawer-inset` precisely so a full-bleed press target can run wider than the
text inside it (index.html); the storm list spends that allowance by laying a
row out at the scroller's width and pushing its TEXT in, and this list bleeds
past it and puts the same amount back as padding, so nothing inside the row
moves. **The master box is in that rule too** — it carries the line that reads
as the roster's heading, and bleeding the rows without it would leave one short
line above a column of long ones. The dot
stopped being the checkbox: it was a hollow ring that filled when ticked, one
element carrying two meanings, which was only ever a way to avoid putting a
second control on a forty-row list. It is `.row-swatch` now — the same 12px
solid dot with its faint glow every other list in this app uses. The badge is
`.row-badge` from `categoryShortLabel`, the storm list's own, in neutral ink
because the swatch is already the hue (§6).

**THE TICK BOX IS THE APP'S OWN AND IS NOW SHARED.** `.check-box` in
`ui/panels.css` was `.model-check` and belonged to the Layers panel alone; §12
asks for extraction before the second use, and the alternative was a clip-path
polygon copied into `seasons/seasons.css` that would look identical on the day
it was written and drift the first time either box was retuned. **The on-state
selector is a PAIR** because the two have different drivers: a Layers row is a
`<button role="checkbox">` carrying `aria-checked`, a roster row is a `<label>`
wrapping a real `<input>` carrying `:checked`. Both are correct for what they
are, and one appearance answers to both. A platform checkbox was not used: it
is a different shape and a different blue on every device the app runs on.

**THE OPEN STORM'S ROW IS A LIFT AND NOTHING ELSE.** It carried a left bar in
the focus-ring amber as well, and that is gone — Aaron on glass. The bar was
drawn at the row's left edge, which is exactly where the tick box sits, so the
two shared a two-pixel column and the bar read as part of the checkbox rather
than as a separate signal. The argument for it was that the lift alone might be
too quiet; on glass it is not. **If it ever does read as too quiet the lever is
`--hover`, not a mark in the checkbox's column.**

**THE MASTER BOX IS THE SPREADSHEET'S THREE-STATE FILTER HEADER.** Aaron's
call: it should be a checkbox like all the other checkboxes and behave the way
a spreadsheet's does. Empty when none are ticked, a BAR when some are, a tick
when all are; pressing it fills the list, pressing it full clears the list.
That is one control answering both questions rather than two buttons, and a
reader who has met a spreadsheet already knows what the bar means.

**IT WORKS ON THE FILTERED LIST, WHICH IS ALSO THE SPREADSHEET'S RULE.** Under
Majors it ticks the majors. Reaching past the filter would put storms on the
globe the roster is not showing — the panel and the map disagreeing.

**THE MIDDLE STATE CANNOT BE WRITTEN IN MARKUP AT ALL.** `indeterminate` is a
property, not an attribute, so every path that changes what is ticked comes
back through `paintCheckAll`: a rebuild, a single tick, a press of the master
box itself. A rebuild alone is not enough — the roster returns with `checked`
restored from the markup and the middle state silently lost, which on glass is
an EMPTY box over a globe with tracks on it. `aria-checked="mixed"` is in the
markup as well, because it IS an attribute and the markup can count; the two
are kept in step by both being derived from the same tally rather than from
each other.

**TWO LINES WHEN THE DRAWER IS NARROW, ONE WHEN IT IS WIDE, MEASURED OFF THE
DRAWER.** A container query on `.seasons-roster`, breaking at 400px of its own
width. The window is the wrong thing to measure: the drawer is a bottom sheet
the full width of a phone and a ~340px side rail on desktop, so a viewport
media query would hand that rail one-line rows it cannot fit and truncate every
name in it. It also keeps this off any device branch (§13) — a narrow window on
a desktop gets two lines because it is narrow, not because of what it is.

**THE ARCHIVE'S SHEET IS A FIXED HEIGHT, TALLER THAN THE APP'S.** `66vh`
against the dashboard's 60, scoped to this view rather than to the archive —
**a future archive view that is three lines long should not inherit it**, which
is why it is keyed on `data-view`. The number lives once, in
`--seasons-sheet-h`; everything else in the rule derives from it.

**IT SHIPPED AS `max-height` ALONE AND THAT WAS THE FAULT.** A ceiling is not a
size: a season with four storms was shorter than one with twenty-eight, so
stepping the year resized the sheet and the `+`/`−` buttons walked up and down
the screen — on the one control in this view a reader presses repeatedly. Aaron
on glass, 2026-08-25. `height` is declared alongside `max-height` now, both
reading the SAME `min(var(--seasons-sheet-h), calc(100dvh - keyboard - comfy))`
expression so the two can never disagree about the keyboard inset, and each
declared twice — plain `vh` first — so a browser without `dvh` keeps a height
rather than dropping the declaration and falling back to content. The roster's
scroller absorbs the variation instead of the sheet doing it. It is the shape
`ui/panels.css` already uses on the home dashboard, for the same reason.

**AND IT STEADIES THE CAMERA, WHICH IS THE LARGER WIN.** `main.js`'s
`archiveOffset()` measures this drawer at call time to decide where a flight
centres (§57.21c), so a height that depended on the open year meant the same
storm framed differently depending on where the reader came from. A constant
height makes that offset a constant.

**WHERE 66vh CAME FROM.** Aaron's number is "about four storm names", and the
furniture above the roster is not a fixed height, so no `vh` figure yields
exactly four rows on every year — this one is measured rather than reasoned to.
`tools/seasons-height-measure.mjs` mounts the real board through the real
drawer against the real 2005 file and reports, at 390x844: **379.0px of
furniture** (a 60px drawer header, a 94px basin-and-year picker, a 94px
scorecard, 42px of filters, 89px of gaps and padding) over a **44.9px row
pitch**, so four names need **558.4px — 66.2vh**. The previous 75vh showed 5.7.
**Re-run that tool after anything changes the furniture**; §57.30 step 9 adds a
filter and a near-home slider to this same view and both land above the roster.

**THE COST, ACCEPTED RATHER THAN OVERLOOKED:** a quiet year with two storms now
leaves empty sheet below its roster where it used to shrink to fit. That is the
trade the dashboard already made — a moving control is felt far more than a
short list with room under it.

**`tools/seasons-height-check.mjs` IS THE GATE, AND IT IS A COMPARISON BECAUSE
THE BUG WAS ONE.** It opens the busiest Atlantic season (2005, 31 storms) and
the quietest (1914, 1) and asserts the sheet and the year stepper are within a
pixel in both — measuring one year cannot see this fault at all. It asks the
browser because `tools/css-orphan-check.mjs` was green the whole time the sheet
was resizing: a stylesheet scan proves a rule is present, never that it wins.
**One mutation survived the layout assertions and is recorded rather than
smoothed over:** deleting the plain-`vh` fallback changes nothing in chromium,
which supports `dvh`, so that pair is asserted against the stylesheet TEXT
instead — which proves it is still there and cannot prove it works.

**CHANGING A FILTER CLEARS THE CHECKS, AND THIS REVERSES A DOCUMENTED
DECISION.** Aaron's call. `onClick` argued that a filter narrows what the
roster SHOWS and must not un-choose a storm the reader deliberately ticked;
that comment is gone, and so is the assertion in `tools/test-seasons-board.mjs`
that guarded it. What the old rule produced was a globe carrying tracks the
list in front of you does not contain — switch to Majors and three tropical
storms stay drawn with no row to point at. That is the same panel-and-map
disagreement the rule was written to prevent, arriving from the other side.
**The clearing is visible**: the globe empties in the same beat, because a wipe
that waited for the next poll would look exactly like the tracks failing to
draw (§5).

**SELECTING FROM THE GLOBE SCROLLS THE ROSTER TO THAT ROW.** `block: 'nearest'`
and reduced-motion honoured. A tap on a track already marked the row and did
not bring it into view; with a 28-row roster the marked row is usually
off-screen, so the globe lit a storm up and the panel looked like nothing had
happened. `nearest` is what makes the same call safe from a repaint — a row
already on screen is not moved at all, so the list is never yanked out from
under a reader's thumb.

**THE HOME DOOR MOVED INTO THE SCROLL.** It was pinned below the scroller as a
sibling for a mechanical reason rather than a design one: `render()` rewrites
the body on every poll, so anything inside it is gone on the next tick. The
cost was a permanent bar taking a row of height from every home screen forever,
including the ones where the reader is trying to read a storm. **The fix is to
re-attach the same NODE, not to rebuild it** — the element is built once in
`mount` and survives the `innerHTML` wipe detached, so its click listener comes
back with it. It is appended from `afterRender()` rather than inside each of
the five render paths, which is what keeps it on all of them.

**THE HEADER'S X IS A MINIMISE CHEVRON, FOR THIS VIEW AND NO OTHER.** The
archive is a MODE, not a panel you are done with: closing its board leaves a
sepia globe you are still standing on, with the bar as the way back in. An X on
that reads as "leave", and a reader who presses it expecting to leave and finds
themselves still in 2005 has been told the wrong thing by the icon. The close
button lives in the SHARED drawer header, so this is an opt-in `minimises` flag
on the view definition — the BUTTON does not change, only its glyph and the
word a screen reader hears. No other view sets it.

**THE BAR'S SENTENCE TOGGLES THE BOARD, AND THE WHOLE HEADER DISMISSES IT.**
Both are Aaron's calls on glass. The bar only ever opened, which made it a
one-way door: press it with the board already up and nothing happened, so the
only way to clear the globe again was to find the chevron at the far edge of
the header. The bar is the one thing always on screen in the archive, so it
carries both halves of one action. **And the header itself is a press target**
— on this board it is a bare title and a chevron, so it reads as a bar you
should be able to press anywhere, and the chevron is a small target in the
corner a thumb reaches for least.

**THE HEADER RULE IS GATED ON `minimises` FOR THE SAME REASON THE CHEVRON IS,
AND IT IS THE MORE DANGEROUS OF THE TWO.** Every other header in this app has a
second job: the storm panel's title slot holds an identity block the dashboard
binds a click to — pressing the storm's NAME opens that storm — and any pushed
view's header holds a Back button whose whole purpose is going up rather than
out. A blanket rule would have made half the app's headers do two things at
once, with the destructive one winning. A press that lands on a real button is
left to that button, so Back and the chevron are never answered twice.
`#drawer` carries `data-minimises` so the header can also LOOK pressable where
it is — a surface that dismisses on a tap and offers no cursor or hover for it
is a hidden gesture (§13), and one that looks pressable and is not is worse.

**THE YEAR LIST IS PAINTED OUT OF THE PALETTE WHERE THE BROWSER ALLOWS IT, AND
NOT WHERE IT DOES NOT.** On desktop it opened as a white sheet with a
system-blue selected row over a sepia globe; `option` now takes `--ocean` and
`--text-primary`. **`--ocean` rather than `--glass-raised`, and that is the
whole point** — every other surface in this app is glass over the globe and is
therefore translucent, but this one the browser draws as an opaque menu ABOVE
the page, and handing it an rgba background is what made it fall back to its
own light colours. **Safari and iOS ignore `option` styling entirely** and
render the platform's own wheel. That sheet is already dark, because
`color-scheme` is published as `dark` for the sepia palette
(`app/theme-switch.js`), but it will never be sepia. Making it sepia means
replacing the native `<select>` with a custom listbox, which §57.18a rejected
on purpose: one control that already works by thumb, by mouse and by keyboard,
with the OS's own scroll-and-type behaviour free. A palette is not worth that
trade.

**AND THE BAR IS WHERE SELECTION GETS DISCOVERED.** `seasons/bar.js` exports
`barDetail`, a pure function, and it has three states:

- nothing drawn — `2005 · Atlantic · tick a storm to draw it`
- drawn, none open — `2005 · Atlantic · 3 shown · tap a track for detail`
- one open — `2005 · Atlantic · KATRINA`

§57.21a made opening a storm a deliberate act and nothing anywhere on screen
said a track could be tapped, so a reader could miss the per-fix dots entirely.
**Zero needs its own words or the bar is a title bar again** — `2005 ·
Atlantic` over an empty globe states a fact the reader can already see. **The
name replaces the count rather than joining it**: four facts do not fit one
line on a 390px phone, and once a storm is open it IS the subject.

**THE BOARD REPORTS FACTS AND THE BAR OWNS THE WORDS.** `onWhere` carries
`{ label, shown, openName }` and fires on four paths — the season settling, a
tick, a selection, and re-entry. A bar that updated only on a year change would
say `3 shown` over a globe with none on it the moment anybody unticked
something. A bad `?season=` link still overrides all three states, because that
reason is about the LINK and does not stop being true when a season loads.

**THE ROW CHEVRON IS STILL NOT BUILT, AND THIS PASS IS THE SECOND DATA POINT
THAT WOULD CONVICT THE ROW.** A per-row chevron opening the detail panel is the
more discoverable way to select and it is the exact markup step 7 added before
glass reported every tap target in this drawer misbehaving. That cause is still
unknown. This push rewrote the row completely — if taps misbehave again, the
row is a real suspect rather than a guess; if they do not, step 7's fault is
somewhere else and the chevron can be built.

### 57.21c The archive's globe: live storms off it, a ridge on it, and a camera

Push 1 of two, 2026-08-25. Aaron's list of seven; items 6 and 7 are the drawer
and are push 2. `map/season-mesh.js` (the ridge), `map/season-frame.js` (the
camera), `lib/lifecycle.js` (`reportingStormIds`), `main.js` (the two facades
and the wiring), `seasons/index.js` (when each flight happens),
`ui/view-seasons-board.js` and `ui/seasons-board-markup.js` (the roster half).
Numbers live in `SEASONS` — `basinView`, `stormZoom`, `meshMaxPointsTotal`,
`meshMinPointsPerStorm`, `activeWithinHours`.

**==> LIVE STORMS DO NOT APPEAR ON THE SEPIA GLOBE, AND THE HALF THAT WAS
ACTUALLY BROKEN WAS THE GEOMETRY. <==** `liveGlobe.hide()` emptied five
surfaces and left a sixth: the layer engine's ambient bundles, which are every
live storm's past track, cone, wind field and model guidance. Those belong to
the engine rather than to any handle the facade holds, so the sepia globe
carried this week's cones over whatever year was open — in 1935, in 2005,
anywhere. §57.16's account of entry now names all six.

**==> AND EMPTYING THE ENGINE ON THE WAY IN WAS NECESSARY AND NOT SUFFICIENT.
THE REFUSAL IS AT THE ENGINE'S DOOR. <==** Aaron on glass, 2026-08-25: the
cones were still there. Gating the poll's `warmGeometry` callback covered one
of five roads into `engine.ambientBundle` / `engine.setBundle`, and the four
it missed all fire while somebody is reading a historical year:

- **`onRepushGuidance` in `main.js`, which is the one a reader actually saw.**
  `app/theme-switch.js`'s `repaint()` calls it on EVERY palette change, and
  `openSeasons` runs `forceMode(MODE.SEPIA)` **one line after**
  `liveGlobe.hide()`. So the prune emptied the engine and the sepia repaint
  refilled it from `app/bundle-pipeline.js`'s cache in the same tick —
  deterministic, on the first frame, with no layer switched on and nothing to
  do with the poll. Model guidance colours live on each FEATURE rather than in
  a paint property, so a theme flip genuinely has to re-push them (§9); the
  push is correct and its timing against the archive was not.
- **the `subscribeLayers` callback**, on any toggle pressed inside the archive.
- **`onDeckLanded`**, when a model deck lands.
- **`onShipsLanded`**, when a SHIPS run lands.

**`createLayerEngine(map, { painting })` takes the predicate and refuses in
`ambientBundle` and `setBundle`.** `main.js` passes `() => !isArchive()`. It is
INJECTED rather than imported because that file imports nothing on purpose, and
it is asked FRESH on every push rather than captured, for the reason the
`warmGeometry` callback already records: these arrive minutes after the emit
that started them.

**`ambientPrune` and `clearSelection` are deliberately NOT behind the gate**,
and that is load-bearing rather than an oversight. The flag is already up by
the time `liveGlobe.hide()` runs, so gating the prune would refuse the very
call that does the clearing and leave every live cone painted. Refusing to draw
and refusing to erase are opposite acts.

**Nothing is held back for later.** A refused bundle is dropped, not queued:
the geometry cache in `app/bundle-pipeline.js` keeps it the whole time, and
`repushAmbient()` on the way out rebuilds it with no fetch — the road
`liveGlobe.show()` already took. `leave()` drops the wall first, so both the
palette repaint and `show()` land normally.

**THE GATE IS ONE PLACE BECAUSE FIVE CALL SITES COULD NOT BE KEPT IN
AGREEMENT.** Each of the four was correct on its own terms; the rule they all
had to obey was not theirs to know. `tools/test-archive-paint.mjs` drives all
four roads through the real engine and then **reads `main.js` and asserts the
gate is wired**, because everything behavioural passes just as happily against
an engine nobody hands a predicate to — which is exactly how push 1 shipped
green. Five mutations, all verified to bite, including gating the prune and
capturing a stale answer.

**And the poll put them back every cycle.** In `subscribe`, `markers`,
`genesis`, the 3D watch marks and `imagery` were gated on `!isArchive()`; the
ended-storm push and the `warmGeometry` callback were not. Both are gated now,
and **the callback re-asks rather than reading the captured flag** — it fires
when a bundle lands, minutes after the emit that started the warm, which is
long enough for somebody to have pressed a door in between. `refreshCage()`
rides inside that callback and would flatten the season's ridge to put this
week's mountains up, so the whole body bails.

**The fetching is not gated, only the painting.** Warming carries on behind the
archive on purpose, so `show()` has a full cache to repush from and leaving
lands on current weather rather than filling itself in over the next poll.

**==> A STORM THAT IS STILL HAPPENING STAYS ON THE ROSTER AND OFF THE GLOBE,
AND THE LIVE APP DECIDES WHICH. <==** Aaron's call, 2026-08-25, and it replaced
a twelve-hour age test on the last b-deck row. The live globe already greys a
storm out when nobody publishes a wind for it — `noCurrentReading`, which is
`ended` or `silent` — and that is the verdict a reader has watched happen.
`reportingStormIds` in `lib/lifecycle.js` asks it of a list; the archive takes
the answer rather than running a second clock. An independent rule could only
agree by coincidence, and the day the two disagreed a storm would be grey on
one globe and drawn as settled history on the other.

**It lives in `lifecycle.js` and not in `season-facts.js` because of the boot
path.** `lib/season-facts.js` is reached only through the archive's dynamic
import and never ships to a reader who does not open Past storms (§57.35 fault
4). `main.js` is the caller, so putting ten lines there would have put its
other three hundred on every boot forever.

**The join is the ATCF id, lowercased, and it is measured rather than assumed.**
`/api/seasons/live` lists `ep092026` off NOAA's b-deck filenames; NHC's own
CurrentStorms carries `"id": "ep092026"` for the same storm; the parser
upper-cases what it emits and `data/nhc.js` namespaces its copy as
`nhc:ep092026`. Both sides read off `origin/archive:latest/`. A GDACS storm's
`sourceId` is a numeric event id, so it cannot collide with an ATCF id and
needs no filtering — it simply never matches, which is the right answer for a
basin the provisional roster does not cover.

**`null` AND AN EMPTY SET ARE OPPOSITE FACTS (§5).** Empty means the feed
answered and nothing is running. `null` means it has never answered — a
`?season=` deep link landing before the first poll — and "we cannot ask" is not
"everything has finished". `main.js` returns `null` in that case and the board
falls back to the b-deck age test, which is the only thing
`SEASONS.activeWithinHours` still serves.

**What the roster does with it.** The date cell reads `Aug 20 – active`; the
start date stays because it is a real fact and it is what the chronological
roster is ordered by. The checkbox is **disabled, not absent** — a row silently
missing a control every other row has reads as a rendering fault — and the
reason rides in the `aria-label`. The master box counts only DRAWABLE rows, or
its bar could never fill and pressing it could never show a tick.
`selectedEntries()` is the single place that decides what reaches the globe and
it drops running storms there, **not only on the checkbox**: a storm can change
state under a tick that is already set, because the archive can be open for an
hour.

**It does not repaint itself.** The archive does not subscribe to the live
poll, so a storm that finishes while the board is on screen moves from
`– active` to drawable on the next thing that renders. Accepted rather than
overlooked: wiring the poll in would mean the live app reaching into a world it
is deliberately walled out of (§57.2), and the window is minutes on a surface
nobody is watching for that transition.

**==> THE RIDGE AND ITS GLYPHS. <==** `map/season-mesh.js`, its own file rather
than a branch inside `map/storm-mesh.js`: that file is built end to end around
a LIVE storm — a head bead at the current fix, a window measured from `now`, a
cap on unmeasured forecast beads, bundles arriving asynchronously — and an
archive storm has none of those. `thin` is EXPORTED from `storm-mesh.js` rather
than copied, because two copies would differ the first time either was tuned
and the difference would show as one globe's ridge reaching further than the
other's for the same storm.

- **The glyph is on the FIRST fix, in the TRACK's peak colour.** An archive
  storm is not anywhere, so the only fix with a claim to the mark is where the
  record opens — which is also where §57.21a puts the white direction ring and
  the name. The colour is a deliberate inconsistency: every BEAD is the
  category at that moment, the GLYPH is peak, because it caps the LINE and a
  first-six-hours hue would be blue on every storm that ever lived.
- **Height is the wind at each fix**, through the same `sevFromKt` the live
  globe uses, so a Cat 3 raises the same mountain in 1935 as today.
- **A storm with no recorded wind gets its glyph and lies flat.** Pre-1886 rows
  carry no intensity. Height is the loudest channel on this globe (§9) and must
  not shout a number nobody wrote down.
- **`meshMaxPointsTotal` (1,600) is shared EVENLY**, floored by
  `meshMinPointsPerStorm` (3) and capped by `MESH_TRACK.maxPointsPerStorm`.
  Every point is tested against all 1,440 cage nodes on a recompute. Spending
  it evenly means a busy season is COARSER, never missing storms — the one case
  where a dropped storm would be impossible to notice.
- **It reads `lon`, not `lonU`.** These are independent directions on a sphere,
  never joined into a line, so the published value is the right one.

`setTracks` pushes it and `clearTracks` flattens it. Neither is guarded on
`styleReady` for the 3D call: the engine exists from boot and owns its own
buffers, unlike the MapLibre sources. The state is `'ok'` unconditionally —
this is not a feed, the storms are already parsed and in memory, so there is no
outage for the cage to desaturate over.

**==> THE CAMERA. <==** `map/season-frame.js`, its own file because `main.js`
is over 1,700 lines and §12's row on it has said "take the next cut" for five
passes. It takes an offset and a door rather than reading the DOM; `main.js`
measures the drawer at call time through `app/views.js`'s own `panelOffsetFor`,
borrowed rather than rewritten because the archive's board is the same drawer
element as every other panel.

- **Entering goes to the BASIN from the storm-list door and to HOME from the
  home-dashboard door.** §57.16 has stamped `data-door` on both rows since step
  4 and this is the first thing to read it. A reader who pressed `Past storms`
  under the live storm list was looking at this year's ocean; swinging to their
  house is a non-sequitur. A basin with no rest position falls back to home
  rather than leaving the camera wherever the live app left it — after a
  selection that is a close zoom on a storm that has just been erased.
- **The flight rides on `onWhere`**, which is the first moment the basin is
  known; flying at `openSeasons` time would fly before the index has been read.
  A once-per-session flag guards it, because `onWhere` also fires on every
  tick, every filter and every focus. It sits outside the bad-link guard: a
  reader sent a broken `?season=` still gets a camera pointed somewhere
  sensible while the bar tells them the link was wrong.
- **Opening a storm frames its FIRST FIX at `SEASONS.stormZoom`.** Aaron on
  glass, and it reversed the design written first. Fitting the whole track
  reasoned well — a finished storm is a curve, and Katrina centred on one fix
  leaves most of her off screen — but the zoom that fits a two-thousand-mile
  arc is about `ZOOM.basin`, which framed a panel about one storm over a lot of
  open water. The start fix is the one already marked. `stormZoom` starts at
  `GLOBE.flyToZoom`'s value and is a separate dial on purpose.
- **A still-running storm gets no flight.** `showStorm` already refuses to tick
  or focus one, and a flight ending on empty ocean beside a full panel of
  figures is the same disagreement in a new place.

**==> THE SEAM ARITHMETIC WAS DELETED, NOT MOVED, AND THE TEST THAT WOULD HAVE
GUARDED IT WAS DELETED TOO. <==** The whole-track fit took bounds off `lonU`
because a min/max over raw longitudes on a dateline-crossing storm reports a
planet-wide span. There is no span left to measure. The plan for this pass
called for a Della (CP011957) seam case with "swap `lon` for `lonU`" as the
mutation — **that mutation cannot bite**: `lib/hurdat.js` anchors its unwrap at
the first fix (`points[0].lonU = points[0].lon`), so on the point this camera
frames the two properties are equal by construction. §12 calls a test that
passes on the same wrong assumption as the bug worse than no test, so
`tools/test-season-frame.mjs` asserts the ANCHOR instead — the fact the flight
is safe because of. `lon` is still the property used, because `find` falls
through to a later fix when the first is unusable and a later `lonU` genuinely
can sit outside ±180.

**THE GATES.** `tools/test-season-frame.mjs` (the camera and the ridge, on the
real 2005 file and the real Della record), `tools/test-seasons-board.mjs` (the
roster half), `tools/test-lifecycle.mjs` (`reportingStormIds`). Twenty-six
mutations were run and seven survived; all seven were the test's fault and are
recorded in the commits. Three are worth knowing about: the ridge's ceiling
**cannot be exercised by the record at all** — the whole of 2005 is 935 fixes
against a 1,600 ceiling, so deleting `thin()` left it green and the case is
synthetic and sized at forty storms, because `thin` halves and both 53 and 96
land a 200-fix storm on exactly 50. And two roster guards
(`selectedEntries`' filter, `showStorm`'s early return) are invisible in what
is DRAWN because a downstream guard catches them either way — the observable
symptom is the CHECKBOX, which paints a tick for a storm the globe is
declining, and that is where they are asserted.

**AND THE STAND-IN DOM COULD NOT READ AN ORDINARY ATTRIBUTE SELECTOR.**
`tools/markup-dom.mjs` matched `[…]` against the dataset only, so
`[type="checkbox"]` found nothing — indistinguishable from a view that never
rendered one. It falls back to real attributes now. That file has told this
class of lie three times; anything it cannot read gets made readable rather
than worked around in the view.

### 57.21d What a tap on the archive's globe means

Push 2 of two, 2026-08-25. Items 2 and 7 of Aaron's list of seven, built as one
piece because they are two answers to one question. **Confirmed on glass
2026-08-25** — all four gestures, on a phone, after the dead-gesture fix below. `map/season-mesh.js` (the
glyph list and the hit-test), `seasons/index.js` (the way in), `main.js` (the
ordered branch, the press clock and the minimise), `map/chrome-avoid.js`
(`TAP_BLOCKING_SELECTORS`), `map/globe.js` (the movement threshold). Numbers
live in `SEASONS` — `glyphTapMaxPhase`, `glyphFacingMin` — and in `TAP`.

**==> THERE IS ONE ORDERED LIST AND IT IS WRITTEN ONCE. <==** `main.js`'s
`map.on('click')` archive branch, top to bottom: **glyph**, then **track**,
then **empty water**. Every tap on the sepia globe resolves through exactly
these three in this order and returns.

**THE ORDER IS THE ARGUMENT RATHER THAN A PREFERENCE.** Without the glyph test
in front, a tap on a hurricane glyph resolves to nothing and falls through to
the empty-water branch — so building the minimise first would have shipped a
tap that shrank the sheet on the one gesture it is supposed to open a storm
with, and the glyph work would then have taken it back out.

**==> THE GLYPH AND THE TRACK CANNOT FIGHT, BECAUSE THEY ARE DISJOINT BY ZOOM.
<==** `map/globe3d.js` fades the surface glyphs across `DIVE.fade.nodes` — dive
phase 0.14 to 0.60, map zoom 2.42 to 3.80. `SEASONS.glyphTapMaxPhase` is the
NEAR end of that band, read off it rather than typed, so the glyph answers only
while it is at full strength and the track owns every zoom from there in.
**Nothing is lost at the handover:** the glyph is stamped on the track's own
first fix, so in the fading band the track hit-test resolves the same storm
from the same pixels.

**==> THE HIT-TEST IS MAPLIBRE'S PROJECTION, NOT A RAY CAST AND NOT THREE'S.
<==** The glyphs are Three.js sprites, so `queryRenderedFeatures` cannot see
them. `map/globe-follow.js` spends every frame keeping the two globes
pixel-locked — that is its whole job — so a longitude and latitude put through
`map.project` land on the pixel the sprite was drawn at. No picking geometry,
nothing added to the render path, and no second projection matrix that could
disagree with the one on screen. At most a few dozen glyphs, each one a
projection and a distance.

**THE FAR SIDE OF THE PLANET IS REFUSED, AND IT HAD TO BE.** `map.project`
answers for a position behind the globe as readily as for one in front of it,
so without a facing test a tap on the visible Atlantic could open a storm round
the back. `SEASONS.glyphFacingMin` is the floor a storm's direction must clear
against the map's centre, and it is **derived rather than chosen**: a point at
radius `r` is over the unit globe's horizon seen from a camera at distance `d`
when `r · (p̂ · â) < 1`, so the floor is `1 / (DIVE.stormDotRadius ·
DIVE.spaceDistance)` — about 0.324, a cap a little smaller than a hemisphere,
which is what a camera at finite distance can actually see. `d` shrinks as you
zoom in, which would raise the true floor, but this test only runs at the space
floor where the camera is at `spaceDistance`.

**NEAREST WINS, NOT FIRST-FOUND.** Two storms whose first fixes are a thumb's
width apart both qualify, and the reader aimed at one of them. Reach is
`SIZE.touchTarget`, the same half-box `stormAtPoint` and `seasonStormAtPoint`
use.

**==> THE GLYPH LIST IS A SECOND, TINY LIST AND NOT AN ID BOLTED ONTO THE RIDGE
POINTS. <==** `buildSeasonMeshPoints` feeds `map/heightfield.js`, which copies
every point into typed arrays on every recompute and tests each against all
1,440 cage nodes. Putting a storm id on up to 1,600 of those objects for the
benefit of the few dozen carrying a mark would be render-path cost for a field
nothing in the render loop reads. `seasonGlyphs` is one entry per storm, built
in `setTracks` beside the ridge and emptied in `clearTracks` beside it.

**AND BOTH READ ONE `usableFixes`.** The mark goes on element 0 of a filtered,
chronologically sorted list and the tap target is built from element 0 of the
same list. Two copies of that filter-and-sort would drift the first time either
was tuned, and the symptom is the worst kind: a mark you can plainly see that
opens the wrong storm, with no console line and no visible cause.

**==> OPENING A STORM IS ONE FUNCTION WITH THREE CALLERS. <==** `openStormNow` in
`seasons/index.js`, hoisted out of the board's `onOpenStorm` callback. The
roster row's chevron has run it since §57.22b; a glyph tap runs the same body,
and a track tap joined them in §57.21e — so the panel push, the camera flight
and the still-running refusal are one behaviour rather than three that look
alike today. `openSeasonStorm` is the export `main.js` reaches it through,
guarded on the session and on the drawer the session holds.

**A RUNNING STORM CANNOT BE REACHED THIS WAY AT ALL**, and that falls out of
the design rather than needing a guard of its own: `selectedEntries` drops a
still-running storm before the globe ever sees it, so it has no track, no ridge
and no glyph to tap. The refusal inside `openStormNow` stays anyway, because it
is the chevron's path too.

**==> A TAP ON EMPTY WATER ANSWERS WHATEVER IS IN FRONT OF IT. <==** Aaron's
call, 2026-08-25, and his correction to it on glass the same day.

- **Sheet up** — minimise it.
- **Sheet down** — clear the focus, every track back to even.

**IT IS STILL ONE TAP AND ONE VISIBLE OUTCOME, WHICH IS WHY THIS IS (b) AND NOT
(a).** The two answers belong to two STATES rather than to one gesture. Option
(a) — clear the focus AND minimise together — was considered and rejected: one
gesture with two visible outcomes is the shape readers report as a glitch. From
"sheet up with a storm focused" it is two taps to a clean globe and they
escalate outward: deal with the sheet, then the globe underneath it.

**==> THE FIRST VERSION HAD ONLY THE FIRST HALF, AND IT SHIPPED A DEAD GESTURE.
<==** It opened `if (!drawer.isOpen()) return;`, so **with the sheet already
down a tap on empty water did nothing at all** — not minimise, because there
was nothing to minimise, and not un-focus, because that had just been removed
in favour of the roster. The only road to an un-dimmed globe was the bar, then
the board, then the row: **three presses to undo one.**

**THE RULE WAS READ AS "THE ROSTER OWNS UN-FOCUS" AND NOBODY CHECKED WHAT THE
GESTURE DID IN THE STATE WITH NO SHEET.** Every assertion in the suite passed
against it, because every one of them was about the sheet-UP case. **A branch
that handles only one of two states is exactly the shape that reads as
finished**, and the gate against it is now the first thing
`tools/test-archive-tap.mjs` asserts — the sheet-down half explicitly, and an
`else` rather than two statements, because a version doing both at once would
satisfy each half on its own.

**BOTH ANSWERS SIT BEHIND THE TAP GATES, NOT JUST THE MINIMISE.** A failed drag
must not un-focus a storm any more than it may dismiss a sheet, and the
furniture measurement covers both — with the sheet down `#drawer[data-open]`
simply stops matching, while the archive's bar and the control cluster stay in
the list, so a press on either cannot quietly un-focus a storm behind them.

**==> A TAP AND THE START OF A DRAG ARE THE SAME EVENT, AND MAPLIBRE ALREADY
ANSWERS HALF OF IT. <==** `map.on('click')` does not fire when the pointer moved
`clickTolerance` pixels or more between down and up — measured in
`vendor/maplibre-gl-5.6.0.js`, whose click handler is exactly that one test. So
hanging the minimise off the event the archive branch already uses buys the
movement discrimination outright. `TAP.movePx` is now passed to the map
explicitly rather than left on MapLibre's undocumented default, so the number
lives where §12 says every behavioural number lives. **A second movement
threshold was deliberately NOT written:** two numbers that have to agree are
two numbers that eventually will not, and this one governs storm selection and
the flood chips as well as the archive.

**WHAT MAPLIBRE DOES NOT GATE ON IS TIME**, so a press held still for a second —
a drag the globe declined to follow, or a thumb resting on the glass — arrives
as an ordinary click. `TAP.maxMs` is enforced here: a `pointerdown` on the map's
canvas container stamps the clock and the minimise reads it. **On the canvas
container specifically**, so a press on the drawer or the bar never touches it
and the clock only ever measures presses on the globe.

**==> "OUTSIDE THE DRAWER" IS MEASURED, NEVER A HEIGHT. <==**
`map/chrome-avoid.js` already reads the furniture's real boxes off the DOM, and
`TAP_BLOCKING_SELECTORS` is the list this asks about. One rect-based rule covers
both shapes the sheet takes: on a phone it docks to the bottom, so outside it
means above it; on a wide screen it docks left, so outside it means beside it.
**A hardcoded height would have been wrong on the second one**, and wrong again
the moment `--seasons-sheet-h` moved (§57.21b).

**THE RECTS ARE PADDED BY HALF A TOUCH TARGET AND THE SLOP IS THE POINT.** A
thumb aimed at the drawer's own top edge lands a few pixels above it, and
minimising the sheet is the destructive answer to that miss. Inside the slop
strip the tap does nothing at all — a press that achieves nothing costs one more
press, and a press that dismisses the sheet somebody was reaching into costs
them the sheet.

**IT CANNOT FIRE INSIDE THE ARCHIVE'S BAR**, which is belt and braces rather than
a fix: `#seasons-bar` and `#drawer` are SIBLINGS of `#globe`, not children, so a
press on either never reaches MapLibre's listener and never becomes a map click
at all. The list exists so that the day somebody nests a panel inside the map
container, the archive does not start dismissing its own sheet. **`#seasons-bar`
is the one id `index.html` does not carry** — `seasons/bar.js` creates it at
runtime, because the archive's furniture must not be on the boot path — so
`tools/test-chrome-avoid.mjs` checks the contract against that file instead of
excusing it.

**ESCAPE STILL MINIMISES AND NOTHING WAS BUILT FOR IT.** `attachEscape` in
`map/globe.js` is one global contract: an open panel absorbs the first Escape,
and for a view that sets `minimises` the drawer's `close()` IS the minimise
(§57.21b). Asserted rather than assumed, so it cannot quietly go.

**THE KEYBOARD PATH FOR OPENING A STORM ALREADY EXISTED AND IS NOT DUPLICATED.**
§13 says a gesture-only way to open a storm is a bug; Enter on a ticked roster
row opens that storm and has since §57.21b. Making the glyphs tabbable would
mean a focus ring on a Three.js sprite — real machinery for a road already
paved, and a second way to reach one destination is a second thing to keep in
step. The existing path is asserted in the suite so it cannot quietly go.

**THE GATES.** `tools/test-season-glyph-tap.mjs` — the hit-test, the facing
refusal, the zoom handover, nearest-wins, and the wiring read out of `main.js`
and `seasons/index.js` as text, because everything behavioural passes just as
happily against a hit-test nothing calls. `tools/test-archive-tap.mjs` — the
minimise, driving the real `measureChrome` and `occludedByChrome` against a
stand-in DOM at phone and desktop shapes, then reading the shipped branch to
prove it asks the same questions in the same order.
`tools/test-chrome-avoid.mjs` gained the runtime-emitted id case.

**TWENTY-EIGHT MUTATIONS WERE RUN AND ONE SURVIVED.** The first version of the
glyph suite's ordering assertion did `indexOf('seasonGlyphAtPoint')`, which
matched the word inside the comment that EXPLAINS the branch — so commenting
the call out left the suite green, which is the failure §12 calls worse than no
test. Both halves were changed to match an actual invocation with its actual
arguments, **and §57.21e later proved that was only half a fix**: a
commented-out call carries its arguments too, so `// openSeasonStormNow(glyphId);`
matched just as happily. **Both tap suites now strip comments out of the source
before any assertion reads it**, and the mutation was re-run against the strip
and bites.

**AND ONE ASSERTION FAILED AGAINST CORRECT CODE, WHICH IS THE SAME LESSON FROM
THE OTHER SIDE.** The tap suite's ordering check searched the whole of `main.js`
for the empty-water call and found the FUNCTION DEFINITION, which sits above the
click handler — so it compared a definition against a call and went red on a
working branch. It cuts the archive branch out of the file first now, between
`if (isArchive()) {` and the home marker test that follows it, and reads only
that. **The same trap bit the dead-gesture fix**: the slice for the function
body was keyed on the text that happened to follow it, which matched earlier in
the file and produced a negative-length slice — four rules reading as broken.
It is keyed on the function's own closing brace now, and the slice's length is
itself asserted, so an empty slice fails as one clear thing rather than as four
false alarms.

**FIVE MORE MUTATIONS ON THE FIX AND ALL FIVE BITE**, including reintroducing
the dead gesture itself — which is the one that matters, since the suite was
green over it once.

### 57.21e A tap on a track opens the storm, the same as a tap on a glyph

Aaron's call, 2026-08-28. **Confirmed on glass the same day — "works".**
`main.js` (the one line, and both doc blocks around it),
`tools/test-archive-tap.mjs` and `tools/test-season-glyph-tap.mjs` (the
assertions, and the comment strip both now read through).

**==> EVERY WAY OF CHOOSING A STORM ON THE SEPIA GLOBE NOW LEADS TO THE SAME
PLACE: ITS PANEL, WITH THE CAMERA ON ITS FIRST FIX ABOVE THE SHEET. <==** The
track branch calls `openSeasonStormNow` rather than `focusSeasonStormNow`.
§57.21d's ordered list is untouched — glyph, then track, then empty water —
because that order is about WHICH STORM the pixels resolve to, not about what
happens next, and the answer to that is one answer now.

**THE OLD BEHAVIOUR WAS ONE MARK MEANING TWO THINGS EITHER SIDE OF A ZOOM.**
A glyph tap opened the storm; a track tap only brightened it. The glyph is
stamped on the track's own first fix, so the same pixels did two different
things depending on whether the reader had crossed `SEASONS.glyphTapMaxPhase`.
§57.21d calls that band a handover; before this it read as a bug.

**==> THE BRIGHTENING IS NOT LOST, AND NOTHING WAS BUILT TO KEEP IT. <==** The
panel's `onOpen` runs `showStorm`, which ticks the storm if it is not already
ticked and then focuses it (§57.22b). So the highlight the track tap used to be
arrives anyway — with the sheet and the flight attached. A second focus call in
the tap branch would be the roster and the globe being told twice by two
different roads, which is the disagreement §57.21a exists to prevent.

**A SECOND TAP ON A DIFFERENT TRACK DOES NOT STACK A SECOND PANEL**, and that
needed no work either: `ui/drawer.js`'s `push` replaces the top step when the
view id is the one already showing, precisely so Back does not walk through the
same view twice. Back stays one press from any storm to the roster.

**==> `focusSeasonStormNow` IS NOW ONLY EVER CALLED WITH NULL, AND IT KEEPS ITS
PARAMETER. <==** The empty-water clear is its one caller. Narrowing it to
`clearSeasonFocus()` would be a rename reaching across the wall into `seasons/`
for no behaviour, and the export on the other side is documented as taking an
id or null. The shape stays; the doc block on the function carries the fact so
the next reader does not go looking for the caller that used to be there.

**THE COST WAS NAMED BEFORE GLASS AND ACCEPTED.** With four storms ticked, a
reader can no longer flick between their tracks with the sheet down to compare
them — every track tap now raises it. One tap on empty water minimises it again
(§57.21d), so the comparison is still two gestures rather than one. Judged
worth it against one mark meaning one thing.

**==> THE GATE CAUGHT A HOLE IN ITSELF, AND THAT IS THE FINDING WORTH KEEPING.
<==** The new assertion was mutation-tested by commenting the call out, and the
suite stayed green: `// openSeasonStormNow(trackId);` is the same TEXT as a live
call, so a regex over raw source proves a string is present rather than that
anything is invoked. §57.21d had already recorded this exact trap being fixed
once with arguments — arguments do not help, because a dead line carries them
too.

**BOTH TAP SUITES STRIP COMMENTS BEFORE READING.** Block comments first, then
line comments, so a `//` inside a block cannot orphan the rest. Each strip is
done ONCE and every assertion in that block reads it, because the previous
attempt at this shape was fixed at one call site and the next assertion written
underneath inherited the bug. **Each strip asserts it left real code behind**,
so a regex change that empties the source fails as one clear thing rather than
as every rule at once — the same guard §57.21d put on its negative-length
slice.

**SEVEN MUTATIONS, ALL SEVEN BITE.** Revert the track to focus-only; focus AND
open (which every positive assertion alone would have passed, so the guard is
an ABSENCE — the branch must not reach for the focus-only road at all); comment
out the track call; comment out the glyph call; comment out the empty-water
call; swap the glyph and track order; and the glyph suite's own commented-out
call, which survived before this pass and does not now.

### 57.22 The storm detail panel

Same shell as the live detail panel, same section pattern, different sections
inside it. Contents are §57.15's derived facts, plus:

- Tier badge, and for Tier 2 the way into the advisory scrubber
- Provisional stamp where §57.11 applies
- The honesty line: **"NOAA best-track data, finalised after the season. These
  are not the forecasts issued at the time."** That sentence prevents a specific
  misunderstanding — a best track is cleaned-up hindsight, not what anyone knew
  on the night
- A link to NHC's written report where one exists

### 57.22a NHC's written reports — measured, and the answer is an index

`tools/tcr-probe.mjs`, run 2026-08-25 on an Actions runner. §57.22 asks the
panel for *"a link to NHC's written report where one exists"*; all three
unknowns in that sentence are now measured.

**WHERE THEY ARE.** `https://www.nhc.noaa.gov/data/tcr/index.php` is the entry
point and it carries **no report links at all** — it is navigation plus a grid
of **37** `?season=YYYY&basin=atl|epac|cpac` pages, and the reports live on
those. A machine-readable index also exists at
`https://www.nhc.noaa.gov/TCR_StormReportsIndex.xml`, 335 KB.

**==> COVERAGE IS 532 OF 3,266 STORMS — 16.3% — AND IT STOPS DEAD AT 1995.
<==** Not a taper: 1994 and everything before it has nothing at all. **This is
a FOURTH cliff to set beside §57.9's three** (b-decks 1958, text advisories
1998, GIS geometry 2008), and it is the earliest-biting of them. Within the
covered years it is partial rather than complete — 2005 has 31 reports against
48 storms, 2014 has 9 against 32 — so *"no report for this storm"* is the
ordinary answer even in a modern season, not an error.

**A MISS IS A CLEAN 404**, and every one of 40 sampled links returned 200. So a
constructed link is at least *verifiable*.

**==> BUT IT MUST NOT BE CONSTRUCTED, AND THE EXCEPTIONS ARE WHY. <==** The
filename is `AL122005_Katrina.pdf` for 510 of 534 identified reports. The other
24 fail in **two systematic ways, neither of which is random noise**:

1. **A storm that crossed basins carries BOTH ids.**
   `AL022022_EP042022_Bonnie.pdf`, `AL132022_EP182022_Julia.pdf`. Nothing in a
   single storm id can predict that the file will name a second one.
2. **An unnamed storm is written with its number spelled out** —
   `AL102004_Ten.pdf`, `AL022003_Two.pdf` — where we hold the name as
   `UNNAMED`. That is **our own normalisation, not NHC disagreeing with
   itself**: §57.14 deliberately reads a spelled-out number as a placeholder
   rather than a name, which is the rule that stopped 71 storms being called
   `TEN` in the roster. The two decisions are both right and they do not
   compose.

**THE DECISION: SHIP AN INDEX, NEVER BUILD A URL.** 532 rows of id → filename
is small, and it makes *"where one exists"* answerable **offline and without a
request**. Constructing and then verifying would mean a fetch to NOAA every
time a reader opens a panel, to answer a question that never changes for a
settled season — and constructing without verifying ships silent dead links
into the one panel whose whole job is historical accuracy.

**AND THE PROBE'S FIRST RUN GOT THIS WRONG IN THE WAY WORTH RECORDING.** It
asked for the XML under `/data/tcr/`, which was the one URL in it that was
guessed rather than read, got a clean 404, and reported *"no machine-readable
index exists"* in good faith. **A guessed URL's 404 is indistinguishable from
an absence.** It was caught only because the probe saves raw bytes for a human
to read afterwards — which is the argument for that habit, stated by the one
time it paid.

### 57.22b The panel as built, and the three bugs it shipped with the first time

**This is the as-built account of step 7. §57.22 is the design; read this for
what the code does.** `ui/view-season-detail.js` assembles it,
`ui/season-detail-markup.js` writes every sentence in it, `data/season-reports.js`
answers the one question that needs a fetch.

**==> IT SHIPPED ONCE, ON 2026-08-25, AND WAS REVERTED WHOLE THE SAME DAY.
<==** Aaron on glass: *"every tap target in the seasons drawer is fucked up —
pretty much anywhere I touch closes the drawer or does something I don't
intend."* The cause was never found. Two things were under suspicion, the
roster row's markup and the split that moved the year logic to its own file,
and **both were rebuilt from scratch afterwards for §57.21b and confirmed on
glass** — which cleared them and is the evidence this rebuild stands on. The
chevron below is the narrowest remaining suspect, and it is now measured in a
browser rather than argued about.

**==> THREE BUGS WERE FOUND IN THE REVERTED CODE WHILE REBUILDING IT, AND NOT
ONE OF THEM HAD EVER BEEN SEEN. <==** Step 7 was reverted before anybody opened
the panel, so all three were sitting in a commit that had already been pushed
and deployed. They are worth listing together because they are the same shape:
**the panel agreeing with itself while disagreeing with something outside it.**
Nothing threw, nothing logged, and each one reads correctly in review.

1. **The drawer's title contract, backwards.** The view exported `title(arg)`
   as a function. `ui/drawer.js` reads `def.titleFor ? def.titleFor(arg) :
   def.title` and appends the answer only if it is a string or a node — a
   function satisfies neither arm, so the panel would have opened with an
   **empty header**. `title` is a plain string now and `titleFor` is the
   function. `backLabelFor` is there too, for the day something pushes on top
   of this panel.
2. **The first stop was not focusable.** `focus()` returns the panel's `<h1>`,
   and the drawer does `v.def.focus?.() || backBtn` — a truthy heading beats
   the fallback, and `.focus()` on a heading with no `tabindex` is a silent
   no-op. A keyboard reader pressing the chevron would have been left focused
   on a button the drawer had just hidden, which is §13's own rule broken with
   nothing to say it had happened. The heading carries `tabindex="-1"`.
3. **==> OPENING A STORM WOULD HAVE DRAWN A PANEL OVER AN EMPTY GLOBE, AND
   THIS IS THE WORST OF THE THREE. <==** The panel's `onOpen` was routed
   straight at the board's `setFocus`, which **refuses an id nobody has
   ticked** — deliberately, so the globe never ghosts every track for a
   highlight nobody can see (§57.21a). So opening an unticked storm did
   nothing at all to the map: Katrina's full panel over a globe with no
   Katrina on it. **That is the panel-and-map disagreement this whole view is
   careful about, arriving through the door built to prevent it.**

**THE FIX FOR 3 IS `showStorm`, AND IT IS NOT §57.21a's COUPLING COMING BACK.**
That rule says **ticking must not select**. This is the other direction — the
globe shows what the panel is about — and it runs on the panel's `onEnter`,
so there is **one path** whether the reader arrived by the chevron, by Back, or
by a deep link. It ticks the storm if it is not already drawn, **patches that
one row rather than re-rendering the roster** (the reader is about to come Back
to that list and it must still be where they left it), then focuses. A storm
the season does not hold is refused rather than half-applied.

**==> AND THE FOURTH BUG IS THE ONE THAT KILLED STEP 7 THE FIRST TIME. FOUND
ON GLASS, 2026-08-25, AND IT IS ONE LINE. <==** Aaron tapped a roster row and
got a pushed panel reading *"That storm is not in this season."* The board's
click handler read `closest('[data-open]')`.

**`#drawer` ITSELF CARRIES `data-open`.** `ui/drawer.js` publishes the sheet's
open state there and `ui/panels.css` styles off it, and the board's body is
inside `#drawer` — so every click anywhere in this drawer that no earlier
branch claimed walked up past the roster and **matched the sheet**, handing the
line `dataset.open === "true"`. The board then asked to open a storm called
`true`.

That is Aaron's original report — *"pretty much anywhere I touch closes the
drawer or does something I don't intend"* — reproduced, and **the first cause
anybody has been able to point at.** The roster row's markup and the years
split were both suspected for a day, both were reverted, and both were
innocent.

**A BARE ATTRIBUTE SELECTOR IN A DELEGATED HANDLER IS A QUERY AGAINST EVERY
ANCESTOR UP TO THE DOCUMENT.** The selector is scoped to `.seasons-open` now.
The other six in this view were audited against what `ui/drawer.js` publishes
(`data-view`, `data-active`, `data-minimises`) and none collides today.

**==> NOTHING COULD HAVE CAUGHT IT, BECAUSE THE SUITE MOUNTED THE BOARD IN A
BARE `div` WITH NO PARENT. <==** `closest` had nowhere to walk, so a selector
escaping its own view was invisible by construction. `tools/test-seasons-board.mjs`
now builds the drawer's real chrome above the view and drives a click on inert
roster space, asserting that nothing opens, nothing draws and nothing focuses.
That is the only shape in which this class of fault is visible at all.

**THE WAY IN IS THE WHOLE ROW, AND THAT REVERSES §57.21b ITEM 1.** Aaron on
glass, same session: *"tapping anywhere on the row should open the storm
detail."* The row was a `<label>` whose every pixel ticked, with a chevron at
the end that opened. Now the swatch, the name, the badge, the dates and the
chevron are **one `<button>`** and the `<label>` is a 44px tick box beside it.
The chevron is a glyph on the end of that button rather than a control of its
own — two buttons for one action would be two tab stops and two press targets.

**NOTHING IS LOST BY TAPPING THE WRONG ONE**, which is what makes the reversal
safe: `showStorm` ticks a storm on the way into its panel, so a row tap is a
superset of what the label used to do. The box stays for the reader comparing
four storms on the globe who does not want a panel each time.

**THE BUTTON SITS OUTSIDE THE `<label>`, AND THAT IS LOAD-BEARING RATHER THAN
TIDY:** nested inside, every press would also toggle the checkbox it was nested
in, because that is a label's whole job, so opening a storm would silently draw
or undraw its track on the way past. The suite asserts the nesting in both
directions rather than trusting a comment.

**AND BOTH TARGETS ARE MEASURED IN A BROWSER, WHICH IS NEW.**
`tools/seasons-row-check.mjs` did not exist when this markup first shipped. It
now asserts, at 390px and 720px, that the open button is at least
`--touch-target` on both axes and **that the tick box still is too** — that is
the one that shrank, and a rule capping only the button would let the label
collapse to the 18px tick inside it with nobody noticing until a thumb missed.
It also asserts the two do not overlap (a shared pixel column is two actions
fighting over one thumb, and the loser is silent), that neither wraps onto the
next line, and that nothing hangs off the end of the row. **Fourteen mutations
were run across the step and all fourteen bite.**

**THE PANEL IS PUSHED, NEVER `go`.** It sits on top of the board, so Back is
one press and lands on the roster with its scroll position and its ticks
intact. `go` would throw that history away and leave Back walking out of the
archive entirely.

**COLLAPSE STATE IS DELIBERATELY NOT KEPT.** The live panel remembers which
sections a reader folded, because a live storm is one thing they return to over
days. An archive storm is opened, read and left.

**THE REPORT INDEX IS DROPPED ON THE WAY OUT OF THE ARCHIVE.** ~100 KB held for
the session, and a session can outlive a deploy — a reader who leaves, sits for
an hour and comes back should not answer *"does this storm have a report"* out
of a copy the server has since replaced. `_headers` marks it `no-cache` so the
second fetch is honest.

**AND THE WAITING LINE'S DOTS ARE APPLIED AFTER THE ESCAPE, INSIDE
`absenceHtml`.** The reverted code called `absenceHtml(dotted('Checking…'))`,
which handed `<span class="dots">` to `esc()` — the panel would have drawn
**visible angle brackets**. Doing it inside means no call site can get the
order wrong. `tools/test-loading-dots.mjs` pins the shape, because its own
stray-ellipsis scan is file-level and cannot see an ordering fault: **that
suite had been red on `main` for the whole time step 7 was reverted**, on this
exact line.

### 57.23 The season clock

**Static tracks are the default.** You tick storms, you see complete paths,
no time control. That is most of the value and it is instant.

**The clock is the headline.** One timeline across the whole season. Press play
and storms grow along their paths as the clock runs, dying out and leaving
ghost trails, so the season accumulates on the globe in front of you. At about
a day a second a full season runs roughly three minutes.

- **One clock, shared by every selected storm.** Not one per storm.
- **Ghost trails persist** after a storm dies. The accumulation is the point.
- **Pause on the turning points.** §57.5's `I`, `P`, `W` and `L` markers are
  where the story bends.
- **==> IT REDRAWS IN PLACE. IT DOES NOT RELOAD. <==** The Ida scrubber reloads
  the page on every step, deliberately and correctly for stepping through
  advisories. For playback that would be a slideshow of loading screens. This
  is new machinery, not a reuse.
- **Reduced motion is respected and there is a visible off switch.** Three
  minutes of moving dots is a migraine for some people.
- Keyboard: space plays and pauses, arrows scrub, the timeline is focusable.

### 57.24 The download gate

**==> THERE IS NO LONGER A GATE ON THE WAY IN, AND THAT IS THE HEADLINE OF THIS
SECTION. <==** Rewritten 2026-08-25 when step 8 was deleted (§57.30). What this
section used to describe — tap Atlantic, get the Atlantic file, hold it on the
device — does not exist and is not going to.

**Nobody pays anything to look around.** The runner cuts each basin into one
file per season (§57.35 FIX 12, `SPEC-OPS.md` §18.8). Opening 2005 fetches
**14 KB over the wire and parses in milliseconds**, with nothing downloaded,
nothing stored and nothing to consent to. Measured on the real bytes, not
estimated.

**Two things still move enough bytes to be worth announcing, and both are
asked for by name.**

**1. ==> A TIER 2 STORM IS ITS OWN FETCH, SEPARATE FROM ITS BASIN. <==**
Aaron's call, 2026-08-24 (§57.17a), and it survives the deletion of the basin
download because its reason was never storage. A basin is tens of KB a season;
one Tier 2 storm is **~5.4 MB on its own** — a hundred times the weight of the
season it sits in. Bundling it with the basin would have meant downloading the
Atlantic meant downloading every director's cut in it.

So a storm's size stops being a curation question and becomes a per-storm wait,
which is **the reason nothing in §57.17a had to be trimmed except the coordinate
precision.** The forecast — cone, track, points, and the wind radii with them —
survives in full because nobody pays for a storm they do not open.

**2. The whole-basin file, for step 9.** *"31 storms have passed within 100
miles since 1851"* is every season at once and cannot be answered a year at a
time. That is a real reason to spend somebody's megabytes, and it is something
they asked for by dragging the slider.

**Both need the same three states everything else here does** (§5): a button
that says what it will cost, real progress while it runs, and a failure that
says what failed. **Five megabytes over a phone's data plan earns a progress bar
whether or not a byte of it is kept.**

**==> AND NEITHER OF THEM PROMISES THE READER A STORE. <==** The old version of
this section ended by telling them where the download lived and that it was
removable in Settings. That promise went with step 8 and the sentence goes with
it — the browser's own cache holds what it holds, on its own terms, and an app
that offers to delete something it does not manage is lying in a small way about
a large thing.

The screen: the app's own mark (`#mark-spiral`, `--mark-plate: transparent`)
turning on the `#boot-mark` animation — 2.4s, eased so it surges rather than
tracking at constant rate, counter-clockwise to match the spiral drawn for real
storms, with the reduced-motion breathe. Below it a progress bar that
**animates `scaleX`, never `width`**. Below that: what is being fetched and how
big. **Progress is computed in one unit or the other and never mixed** — see
§57.35 FAULT 5, which is the bug that screen is most likely to ship with.

**A fetch that fails says so and offers a retry.** A stuck progress bar is
silence with a costume on.

### 57.25 What ports from the live app, and what does not

**Neither "port everything and grey it out" nor "delete everything unused."**
Greying out is a promise — *this exists, just not now* — and for most of the
live app that promise can never be kept. A permanently disabled control is a
lie with a tooltip.

Three states, the same discipline the data layer already uses:

**1. Never existed → delete entirely.** No control, no grey box, no mention. If
a thing is not a thing, its absence is not information.
Cone · forecast track · forecast points · genesis areas · countdown timers ·
arrival-time estimates · staleness warnings (the data is final by definition) ·
model tracks · radar · satellite · flood alerts · CAP and NWS zones ·
rainfall · the environment ribbon · surge.

**2. Could have existed, but not for this storm → show it, say why.**
Wind field before 2004. Watches and warnings before the warning era. Landfall
marks 1971–1990. Radius of maximum wind before 2021. Each gets a plain line:
*"Wind field size wasn't recorded before 2004."* That sentence teaches the
reader something true about the record.

**3. Exists for some storms, not this one → present, disabled, with the
reason.** The Tier 1 / Tier 2 split. *"Advisory record not captured for this
storm."* The only place greying out is honest, because it is the only place the
thing could genuinely appear later.

**The rule, stated so it can be applied without re-reading this section: if the
absence is information, say it. If the thing never existed, delete it.**

### 57.26 The Seasons layer list

Opt-in, its own short list. Not a filter over `config/layers.js`.

- **Track** — always
- **Landfall marks** — always
- **Wind footprint** — where the record has one. **This is ONE entry, not the
  two ("Wind field", "Wind swath") this list carried until step 6b** — see
  §57.26a for why, and for why the wind field comes back when the clock lands
- **Watches and warnings** — Tier 2 only
- **Cone at the selected advisory** — Tier 2 only, and only while scrubbing
- **Home marker and the distance circle**

**Population is not on this list** (§57.1 decision 9).

**==> AND THE LIST ITSELF DOES NOT EXIST YET. <== As built through step 6b the
archive has no layer control at all** — the Layers button is hidden inside the
archive (§57.16a) and the footprint appears with focus rather than with a
switch. That is deliberate for now: a list of one entry is furniture, and the
`Track` and `Landfall marks` rows above would both read `always`, which is a
control that cannot do anything. The list becomes real when a second thing on
it can be turned off.

The modules underneath are the live ones taking different data — past track,
wind field, coastline, globe, gestures, keyboard, drawer mechanics, type,
spacing, touch targets. What differs is which layers get registered. The layer
registry already supports this; a second registration set is the natural shape.

### 57.26a The wind footprint, as built

Step 6b. `lib/season-windswath.js` (HURDAT2's radii columns into a timeline),
`lib/windswath.js`'s `sweepTimeline` (the shared sweep),
`map/layers/season-swath.js` (the draw), `ARCHIVE_GEO.swath*` (the paint),
`SEASONS.windFieldFirstSeason` (the sentence's year), and
`footprintNoteHtml` in `ui/seasons-board-markup.js` (the sentence).
`tools/test-season-swath.mjs` is the gate — 54 assertions, twelve mutations
verified.

**==> IT IS ONE LAYER WHERE §57.26 LISTED TWO, AND THAT IS A REAL CHANGE
RATHER THAN A SHORTCUT. <==** The list above named a *wind field* (the extent
at a moment) and a *wind swath* (the footprint over the whole life) as separate
entries, which is the right split for a live storm. **A finished storm has no
"a moment."** There is no now to draw the field at, and drawing it at the peak
puts a ring inside a corridor that already covers the same ground — the same
paint twice. So the archive draws the footprint and calls it that. **The wind
field earns its own entry back the day step 10's clock exists**, because a
clock is exactly the thing that gives a finished storm a moment; the layer file
is written so that becomes picking a different record rather than a rewrite.

**==> ONLY THE FOCUSED STORM WEARS ONE. <==** Aaron's call, 2026-08-24. Three
nested corridors across four ticked storms is twelve translucent shapes
compounding on each other — the look he rejected outright when the live swath
was built, and the first thing `lib/windswath.js`'s header records. It is also
what makes the feature cheap: **one storm is 12–13 ms and ~1,600 vertices;
the whole 2005 season would be ~300 ms and ~34,500**, on a phone, on the
archive's most frequent interaction. The footprint is a *tell me about this
one* fact.

**The cost is real and is not hidden:** with nothing focused, nothing draws, so
a reader who never taps a track never sees a footprint. What makes that
acceptable is that the same tap is what the SENTENCE is attached to, so the
presence and the absence are discovered by one action. **If it reads as
undiscoverable on glass, the fix is the roster saying so — not drawing all of
them.**

**==> NOAA'S OWN PUBLISHED SWATH IS NOT USABLE, AND THAT IS MEASURED. <==**
§57.26 above pointed at `samples/ida-al092021/gis/best-track/AL092021_windswath.geojson`
as if it were the source. Measured 2026-08-24: its 34 kt polygon is 1,070
vertices and **100% of its edges are axis-aligned** — the same rasterized
staircase §14 records the live merged product being. It is also a per-storm GIS
download that only exists from 2008 (§57.9's third cliff), where the radii
columns start in 2004. Building the shape from the radii is cheaper, smoother
and covers four more years. Asserted in the suite rather than assumed, so if
NOAA ever fixes it the shortcut becomes worth reconsidering.

**Built against it, our corridors cover the same ground as the agency's** —
Ida's three thresholds agree to within half a degree at every corner.

**==> THE RULE THAT DECIDES THE SHAPE: A MISSING RADII ROW AND A ZERO RADII ROW
ARE NOT THE SAME THING. <==**

NOAA inserts extra records at landfalls and peaks, off the six-hour clock, and
those rows carry `-999` in all twelve radii columns — nobody wrote the wind
field down for that odd minute. `0,0,0,0` is a different statement: it was
written down, and there was no wind at that threshold.

The sweep breaks a corridor at any timeline point with no ring, which is
exactly right for a zero — sweeping across an hour published as ring-free would
claim wind the agency did not (§5). Applied to a MISSING row it is exactly
wrong. **Katrina's three landfall records are all `-999`, so a raw feed snaps
her footprint into three pieces at the three moments the app is named after.**

So a row with no radii group at all is dropped from the timeline and the
corridor interpolates across it; a row whose groups are present and zero stays
and breaks the run. **Measured across both mirrored basins, 2004 on: 90 such
rows, 85 off the six-hour clock, 73 of them landfalls, inside the wind-field
life of 41 storms. And the two kinds never mix on one row** — 24,087 rows carry
all three groups, 90 carry none, zero carry some — so "did this row have radii
at all" is one question rather than three.

**THE SWEEP IS SHARED WITH THE LIVE APP AND THAT IS WHY.** `sweepTimeline` was
extracted out of `buildFullTrack` with no behaviour change (the 103 existing
swath assertions prove it). Everything above it in that function is about a
live feed — joining radii to centres across five MapServer layers, dropping
forecast hours that have already happened, solving a ring's own centre — and
none of it exists for a finished storm. What is left is the same maths either
way, and **this project has already paid twice to get the seam right**; a
second copy would drift.

**==> THE ARCHIVE HAS ITS OWN SEAM STORMS AND THE FIRST VERSION OF THE SUITE
DID NOT CATCH THEM. <==** It passed with the branch fold deliberately removed —
the exact fault that swept Lala's 34 kt band 359.75° around the planet. Katrina
and Ida are both mid-Atlantic and cannot show it. **Thirteen storms from 2004
on cross ±180 carrying a wind field**: Ioke, Kika, Maka, Omeka, Pewa,
Genevieve, Halola, Kilo, Hector, Dora and three unnamed. **Ioke 2006 is the
fixture** — 83 records, all 83 with radii, crossing westbound where her
published longitude jumps −179.8 to +179.3. Her 34 kt corridor is 56° wide;
unfolded it is 356°, and that is now three assertions.

**THE SENTENCE IS THE POINT OF THE STEP, NOT A CAPTION ON IT.** Three quarters
of the archive has no wind field — **826 storms of 3,266** — so for most of
what a reader opens, the sentence IS the feature. §57.25 rule 2 asks it to
teach something true about the record rather than read as a missing button.

**Two wordings, and the second exists so the first cannot lie.** The era
sentence — *"Wind field size wasn't recorded before 2004"* — is only said for a
storm from before `SEASONS.windFieldFirstSeason`. A 2004-or-later storm with
nothing to draw gets *"No wind field was recorded for this storm"* instead,
because the era claim would be a statement about the record that its own
subject is the counter-example to. Every settled season measures 100% coverage
from 2004 on, so in practice the second wording is for the season still
running, whose b-decks are a different source. **A storm that HAS a footprint
says nothing** — a presence speaks for itself and the shape is on the globe.

**AND THE YEAR IS NEVER A GATE.** §57.6's rule holds here exactly as it does in
the parser: a storm has a footprint if its rows carry radii, whatever the year.
`windFieldFirstSeason` only chooses the wording once `season-facts.js` has
already established there is nothing to draw. Proven by grafting radii onto an
1851 storm and watching a footprint appear.

### 57.27 Things that exist only in Seasons

So the feature is not read as purely subtractive:

- The **season clock** and its ghost trails
- The **wind swath** — the footprint, which live has no use for
- The **closest-approach line** from a storm to home, with the strength at that
  moment
- **Focus and dim** across many simultaneous storms

### 57.28 First run

Seasons gets its own one-time explainer. **"This is not a forecast" matters more
here than anywhere else in the app**, because a cone and a track on a globe look
exactly like the live view. One screen, once, dismissible.

### 57.29 The Wall of Years — specified, not built

One vertical scroll, a row per year back to 1851, each row a strip of dots —
one per storm, coloured by peak strength. Scroll through 175 years and *see*
the quiet decades and the violent ones.

It is the eventual replacement for the year picker. It is written down now so
that nothing built earlier paints us into a corner, and built later because it
is a second full screen and it is browsing rather than finding.

---

## 57.30 The build, in steps

**One step per session.** Do not start two. Each names what lands, what Aaron
looks at, and what done means. **Nothing proceeds to the next step until the
current one is confirmed on a phone** — the flood rebuild's own lesson, learned
the expensive way.

---

**STEP 0 — MEASURE. ==> DONE 2026-08-24. <==**
`tools/seasons-probe.mjs`, run twice on an Actions runner. Findings are folded
into §57.3, §57.4, §57.4a, §57.9 and §57.33 above, replacing the assumptions.
Raw bytes and the full report live on the `seasons-probe-results` branch:
`git show origin/seasons-probe-results:findings.md`.

**==> ITS FIRST RUN ANSWERED TWO OF FOUR QUESTIONS WRONGLY, AND BOTH FAULTS
WERE IN THE PROBE. <==** Worth reading before trusting any probe nobody has
audited. It HEADed a PHP script and reported a GIS archive reaching 1958 — a
script answers 200 for a year that never happened. It cut a text sample at a
byte boundary, mid-line, and reported a fixed-width file as variable-width,
which would have produced a variable-width parser for HURDAT2. And it chose its
HURDAT2 file by sorting the directory, landing on one two seasons stale. **A
green probe is not a correct probe.**

**Do not re-run it to answer these questions again.** Re-run it when the season
turns over, or when a Southern Hemisphere storm is needed. What follows is the
original brief, kept because it names what was asked:

No app change. One GitHub Actions job, because a session cannot reach NOAA.
- Fetch a live b-deck and an archived one. **Confirm the line layout against
  real bytes.** It is ATCF, not HURDAT2, and the wind-radii rows are laid out
  differently — do not design against a remembered format.
- List what is actually in the 2026 b-deck directory today; apply §57.13's
  filter and see what survives.
- Fetch HURDAT2 Atlantic and E/C Pacific; confirm size and that the parser
  assumptions in §57.4 hold on the real file.
- **Find how far back NHC's advisory archive goes**, text and GIS separately.
  This answer decides step 11.
- Probe IBTrACS: what it is, what shape, and **how big — measured against
  the 25 MiB Pages per-file cap (§57.33 limit 3)**. If it is over, the
  rest-of-world storage design changes.
- Land the bytes in `samples/` so later steps test against real data.
**Done when:** the findings are written into this file, replacing assumptions.

---

**STEP 1 — THE PALETTE. ==> LANDED 2026-08-24. SEEN ON GLASS THROUGH STEP 4'S
EMPTY GLOBE, EXCEPT FOR THE ONE MEASURED COLLISION. <==**
Built, gated and pushed. **What it IS lives in `SPEC-MAP.md` §9** — the third
palette, the forced mode, the round-trip guarantee, the luminance-set land and
the knowingly-shipped hue collision. Read that, not this.

**A2 WAS NOT BUILT.** Aaron's call: the coastline is a hairline and the
collision §57.20 measured compares two things that are not drawn alike, so the
answer is a real Cat 2 crossing a real coast rather than a second paint chip.
§57.31 item 1 is closed.

**STEP 4 PUT A GLOBE ON SCREEN WEARING IT AND AARON CONFIRMED IT** — sepia
reads as an archive rather than as a broken theme, and **land against ocean is
fine at 1.12:1** where dark is 1.20:1. That was the open question with a number
attached to it and it is answered.

**==> WHAT IS STILL OPEN IS THE ONE §57.20 ACTUALLY MEASURED: THE COASTLINE
AGAINST A CAT 2 DOT. <==** Step 4's globe is empty, so there was no dot to
judge it against. **It cannot be closed before step 6 draws real tracks**, and
it must not be closed by looking at `mockups/seasons-themes.html` — that page
mirrors the shipped values and is a paint chip, which is exactly the comparison
§57.31 item 1 rejected. Keep the mockup in step with the tokens anyway.

---

**STEP 2 — THE PARSER AND THE INDEXER. ==> DONE 2026-08-24. <==**
`lib/hurdat.js`, `lib/season-facts.js`, `lib/near-home.js` and the `SEASONS`
block in `config/constants.js`. No UI, nothing on the boot path — none of the
four is imported by anything that ships today.

**WHAT IT IS lives in those files' own headers and in §57.4, §57.4a, §57.5,
§57.6, §57.7, §57.15 and §57.19**, several of which this step CORRECTED. Read
those, not this.

**==> THE STEP 0 SAMPLE WAS 1851–1859 AND THAT IS A DECADE WITH NO MODERN
FEATURE IN IT. <==** No names, no wind radii, no pressure, no record
identifiers. The probe saved the first 96 KB of each file, which was right for
answering "what shape is this" and useless for testing a parser.
`tools/seasons-fixtures.mjs` and its workflow download the WHOLE files on a
runner and cut storms at storm boundaries; `samples/seasons/` holds 368 KB of
them and `HOW-THESE-WERE-CUT.md` says which storm proves what. **Four of the
eleven were found by RULE rather than by hand** — the first `-99`, the first
east longitude, the first `R` marker, the first real RMW — and two of those
four are what corrected §57.6.

**THE HAND-CHECK IS A TRUE CROSS-SOURCE ONE.** Every Ida figure asserted in
`tools/test-season-facts.mjs` is stated in `samples/ida-al092021/
tcr-AL092021_Ida.txt`, NOAA's own Tropical Cyclone Report — a different
document from the database being parsed, written by different people for a
different purpose. Peak 130 kt, landfall 130 kt and 931 mb, minimum 929 mb,
Cuba landfall 2325Z, ended extratropical, ACE 10.58. All agree.

**176 assertions across three suites, and NINE mutations were run to prove they
bite** — the ATCF merge, the b-deck name, the dateline unwrap, a year gate on
RMW, `-999` read as a number, ATCF coordinates read as whole degrees, the
segment measurement removed, the segment treated as an infinite line, and the
seam handled in degrees. **Two of the nine stayed GREEN on the first pass and
that is the finding**: Ida cannot show a status filter working, because she
goes extratropical below hurricane force, so removing it changed none of her
numbers. Those two assertions were rewritten against a synthetic storm built to
be the shape no fixture has.

**STILL OPEN AND IT IS THE ONLY THING:** none of this has drawn a pixel. The
first surface is step 4's shell.

---

**STEP 3 — STORAGE AND SERVING. ==> SPLIT IN TWO, AND ONLY 3a HAS LANDED. <==**

It was written as one step and it is two. Capture and serving share no code and
neither blocks the other, so doing both in one pass would be the single
unbisectable commit `CLAUDE.md` exists to forbid. **One half is also urgent in a
way the other is not:** every hour without the rest-of-world capture is
permanently gone, while serving can wait a week and lose nothing.

---

**STEP 3a — THE CAPTURE. ==> DONE 2026-08-24. <==**
`tools/seasons-mirror.mjs`, `.github/workflows/seasons-mirror.yml`, the
`seasons-live` branch, and `tools/test-seasons-mirror.mjs`.

**WHAT IT IS lives in `SPEC-OPS.md` §18.7.** Read that, not this. The one-line
version: hourly, NHC's b-decks verbatim plus one JSON line per JTWC warning,
appended to a branch a session reads with plain git, committing only when a byte
actually moved and committing anyway when a source starts failing.

**==> NOTHING IN THE APP CHANGED, SO THERE IS NO PHONE TEST HERE. <==** Same
exception step 2 took and for the same reason: no module on the boot path
imports any of it. The first surface is still step 4's shell.

**THE JTWC HALF GOES THROUGH OUR OWN RELAY, NOT THE NAVY.** The relay already
turns the warning text into positions and it is the parse the app itself trusts,
so the stored track cannot disagree with what a reader saw on the day. It also
means the capture inherits every fix the relay ever gets.

**ONE QUESTION IS OPEN AND WAS NOT GUESSED AT.** Whether JTWC publishes live
ATCF b-decks during a season the way NHC does. If it does, the rest-of-world
capture gets a better source than our own relay output. Nothing in the sandbox
can find out and nothing here assumes an answer — it is a small addition to the
next probe run.

---

**STEP 3b — THE SERVING. ==> DONE 2026-08-24. <==**
`functions/api/seasons/live.js`, `functions/api/seasons/storm.js`,
`functions/api/seasons/_ids.js`, `tools/seasons-hurdat.mjs`,
`.github/workflows/seasons-hurdat.yml`, the `seasons/` directory and its
`_headers` block.

**WHAT IT IS lives in `SPEC-DATA.md` §58 and `SPEC-OPS.md` §18.8.** Read those,
not this. The one-line version: settled seasons are static files in the repo
refreshed by a monthly runner, the season in progress is two routes backed by
KV, and the split between them is decided by Pages' 500-builds-a-month cap.

**==> IT CORRECTED TWO SECTIONS OF THIS FILE. <==**

- **§57.35 FIX 11 was not sufficient.** It says the SEASON in the filename is
  the cache bust. NOAA revises seasons it has already published — the real
  directory carries **five revisions of the 2022 Atlantic file**, in two
  different date widths — so season-only naming points all five at one
  `immutable` URL and a browser holding April's copy never sees May's
  correction. The revision stamp is now in the filename too.
- **Graduation is automatic for the NHC basins, and this step said it was
  manual.** It described "one commit" promoting a year into the repo. Once the
  monthly refresh exists there is no such commit: February's file lands on its
  own and `index.json` gains the season. The only manual step left is squashing
  `seasons-live` (§57.34 rule 1), which is already a button.

**AND §57.34 RULE 2'S ~400-DAY TTL IS NOT WHAT SHIPPED, BECAUSE THE EXISTING
STORE ALREADY DOES BETTER.** The rule was written for a design where a season
was written once and read for a year. Serving through the ordinary warm loop
means every key is re-stamped every five minutes while something still warms
it, so `worker/src/kv.js`'s existing 48-hour TTL clears a graduated year within
two days instead of within four hundred. **Retention that depends on nothing
running is stronger than retention that depends on a yearly job**, which is the
rule's own stated reason for existing.

**==> A TEST PASSED WITH THE CODE BROKEN AND THAT IS THE FINDING. <==** Seven
mutations were run against the file picker and six turned the suite red. The
seventh — deleting the rule that an unreadable revision stamp is DROPPED rather
than ranked zero — stayed green. Ranking it zero looks harmless (it just loses
every tie) and on the day NOAA changes the stamp format it silently ranks the
NEWEST season below every older one with nothing in the report saying so. The
assertion is in and the mutation re-run against it.

**STILL NOTHING ON GLASS.** No module on the boot path imports any of it. The
one thing for Aaron is a URL: `/api/seasons/live` should list 14 storms and name
the 4 invests it dropped, matching `seasons-live`'s manifest exactly.

---

**STEP 4 — THE SHELL AND THE EMPTY GLOBE. ==> DONE 2026-08-24, CONFIRMED ON A
PHONE. <==**
`lib/archive-mode.js`, `seasons/index.js`, `seasons/bar.js`,
`seasons/deep-link.js`, `seasons/seasons.css`, `ui/seasons-door.js`, and
`tools/test-archive-mode.mjs`.

**WHAT IT IS lives in §57.16a below.** Read that, not this.

**==> IT IS THE FIRST STEP WITH PIXELS IN IT, AND THAT ENDS FOUR STEPS OF
NOTHING TO LOOK AT. <==** Steps 1, 2, 3a and 3b each landed with no module on
the boot path importing any of them. This one puts two rows on two screens and
a whole globe behind them.

**==> IT FOUND A BUG IN THE THEME SYSTEM THAT WAS NOT ITS OWN. <==** Every
repaint in `app/theme-switch.js` — the chrome variables, the 3D globe's
materials, and the twenty-eight basemap colours — sat inside `apply()`, behind
`if (!setThemeMode(...)) return;`. `forceMode` does not go through
`setThemeMode` and cannot: a forced mode has to outrank the stored preference,
which is the whole reason §57.20's palette is forced rather than selected. So
entering here would have moved `palette()` and repainted **nothing** — a dark
globe wearing a sepia palette, with the Layers panel's model swatches (the only
`subscribeThemeChange` subscriber that existed) correctly turning sepia beside
it. **It fails silently and it looks like a Seasons bug.** The repaint is a
theme subscriber now, so a settings flip, an OS flip, entering and LEAVING all
take one path. `tools/test-archive-mode.mjs` section 7 asserts it and the
mutation was run.

**ELEVEN MUTATIONS WERE RUN AND ALL ELEVEN TURNED THE SUITE RED**, including
the two that matter: deleting the storage wall, and putting the repaint back
inside `apply()`.

**AARON'S VERDICT, 2026-08-24: both doors, the empty sepia globe, leaving, and
a theme changed from Settings while inside — all correct on glass.** The
done-condition is met.

**==> ONE THING THIS DID NOT SETTLE, AND IT IS THE ONE §57.20 MEASURED. <==**
The sepia coastline against a Cat 2 dot has still not been seen, because there
were no storms on the globe to see it against. That question is step 6's, not
this one's. What step 4 DID settle is the other half — land against ocean came
out flatter in sepia than in dark (1.12:1 against 1.20:1) and reads fine. If
that ever changes, the lever is the ocean rather than the land, which is pinned
by the contrast gate.

---

**STEP 5 — THE SEASON BOARD. ==> BOTH HALVES BUILT. <==**
`data/seasons.js`, `data/seasons-live.js`, `ui/view-seasons-board.js`,
`ui/seasons-board-markup.js`, `map/layers/season-tracks.js`,
`lib/season-names.js`, and the board's block in `seasons/seasons.css`.

**WHAT IT IS lives in §57.18a (5a) and §57.18b (5b) below.** Read those, not
this.

**==> IT IS TWO PUSHES BECAUSE THE TWO HALVES READ DIFFERENT SOURCES. <==** A
settled year is a static file in this repo; the year currently running is two
KV-backed routes and a different parser (§58). Doing both in one pass would be
the unbisectable commit `CLAUDE.md` forbids, and only the second half can show
a ghost.

- **5a — SETTLED SEASONS.** 1851 to the last reviewed year, both NHC basins.
  Picker, scorecard, filters, roster, tracks.
- **5b — THE SEASON IN PROGRESS.** `/api/seasons/live`, one b-deck per storm,
  and the ghost roster. **Ghosts exist only here** — see §57.18a. **Done
  2026-08-24; §57.18b is the as-built account**, including the landfall dash
  and why the Central Pacific rides with the East Pacific.

**AARON'S CALL, 2026-08-24: GHOSTS ARE THE CURRENT YEAR ONLY.** §57.18 wanted
them on every season. That needs a per-year name list for 175 years, which no
file NOAA publishes contains. §57.18a records what a settled year says instead,
and it says it from the storms rather than from a list nobody typed.

**AND THE CURRENT YEAR'S TWO LISTS ARE NOT TYPED EITHER — SAME DAY, SECOND
CALL.** `tools/seasons-names.mjs` generates them monthly from NHC's names page,
which carries six years ahead with the year in each header. Nothing about this
feature is waiting on somebody remembering it each spring. §57.18a is the
account, including every gate the job refuses on.

**Aaron looks at (5a):** 2005 against 1935 and 2025. The shape of a season
should be visible without reading.
**Aaron looks at (5b):** 2026 on both basins. Does the season in progress read
as unfinished rather than as a thin year — the ghosts, the provisional line,
the landfall dash.
**Done when:** ticking storms puts them on the globe and unticking removes
them, by tap and by keyboard.

---

**STEP 6a — THE GLOBE LAYERS. ==> BUILT. <==**
Track rendering, landfall marks, name labels along tracks, focus-and-dim.
**§57.21a is the as-built account. Read that, not this.**

**==> IT IS TWO PASSES BECAUSE ITS OWN DONE-CONDITION ONLY TESTS ONE OF THEM.
<==** §57.30 listed six things under one step, and the done-condition below
covers four: four storms at once, telling them apart, focus, and the landfall
marks. The wind field and the wind swath are a different question with a
different source — HURDAT2 records wind radii only from 2004, so most of the
archive gets §57.25's honest line rather than a shape — and folding them in
would have made an unbisectable commit for no gain.

**AARON'S VERDICT, 2026-08-24: it all works.** Four 2005 storms at once — the
names, the landfall marks, focus and dim, and the tick-is-the-focus trade with
`Show all evenly` as the way back. The done-condition is met.

**THREE VALUES ARE NOW SETTLED ON GLASS AND SHOULD NOT BE REOPENED WITHOUT NEW
EVIDENCE.** `ARCHIVE_GEO.dimmedOpacity` at 0.2 reads as a ghost rather than an
erasure; `nameRepeatPx` at 220 keeps a name attached to its line while
panning; and only the last of four ticked storms being bright was judged a
fair trade for not putting a second control on every roster row.

---

**STEP 6b — THE WIND FIELD AND THE WIND SWATH.**
Wind field where it exists with §57.25's honest line where it does not, and
the swath — the total footprint that ever saw storm-force wind, which is a
historical shape with no live equivalent (§57.26, §57.27).
**§57.26a is the as-built account. Read that, not this.**

**==> IT SHIPPED AS ONE LAYER, NOT TWO, AND THE LIST IN §57.26 WAS CORRECTED
RATHER THAN FOLLOWED. <==** A finished storm has no "a moment" for a wind field
to be the extent AT, and drawing it at the peak is a ring inside a corridor
that already covers the same ground. The wind field earns its entry back when
step 10's clock gives a finished storm a moment.

**AND IT DRAWS THE FOCUSED STORM ONLY** — Aaron's call, 2026-08-24. Twelve
translucent shapes across four ticked storms is the look he rejected when the
live swath was built.

**Aaron looks at:** a 2004-or-later storm with radii, and a 19th-century one
without. Does the sentence explaining the absence teach him something true
about the record, or read as a missing feature?
**Done when:** a storm from before 2004 says why it has no wind field, on
glass.

**AARON'S VERDICT, 2026-08-25: it works.** The footprint under a modern
storm's track, the sentence on a 19th-century one, and the tap-to-see-it bound
— all correct. The done-condition is met. **`swathFillOpacity` at 0.14 is now
settled on glass**: the track stays readable through the wash.

---

**STEP 7 — THE DETAIL PANEL.**
§57.22. All derived facts, the honesty line, the tier badge, the provisional
stamp.
**§57.22b is the as-built account. Read that, not this.**

**==> IT SHIPPED, WAS REVERTED WHOLE THE SAME DAY, AND WAS REBUILT. <==**
§57.22b carries the whole story: the tap fault glass reported, the two suspects
that were cleared by §57.21b's rebuild, and the three bugs found in the
reverted code that nobody had ever seen because the panel was never opened.

**The tier badge and the way into the advisory scrubber are NOT built**, and
that is not an omission. Tier 2 does not exist yet — step 11 chooses the storms
and step 12 captures them — so a badge would be a control with one state and a
link to nothing. It lands with step 12.

**Aaron looks at:** one storm's figures, hand-checked against NOAA's own page.
Then the taps, deliberately.
**Done when:** every figure has been hand-checked against one storm.

**AARON'S VERDICT, 2026-08-25: it works great.** The done-condition is met.
**And the tap fault that killed the first attempt is solved** — it was the
board's click handler matching `#drawer`'s own `data-open`, one line, and
neither of the two things reverted for it was the cause. §57.22b.

---

**STEP 8 — ==> DELETED 2026-08-25. NOT SKIPPED, NOT DEFERRED. <==**

**It was the download gate, the whole-basin index pass, IndexedDB, the eviction
state and offline.** Aaron's call: *he does not need Seasons offline.*

**The number stays as a permanent address and nothing renumbers.** Step 9 is
still step 9. Code comments and other sections cite these numbers, so a step is
deleted in place with its reason beside it rather than closing the gap (§12).

**Two reasons, and the first one had already half-killed it.**

**1. FIX 12 took the gate's job away** (§57.35, `tools/seasons-slice.mjs`). The
runner cuts each basin into one file per season, so opening 2005 is **14 KB over
the wire and 14 ms of parsing** — nothing downloaded, nothing stored, nothing to
consent to. A gate exists to stand between a reader and a cost. There is no cost
left on the ordinary path, so most of this step was already gating an empty room.

**2. Offline was never asked for.** It is a real feature and it is somebody
else's. What it buys — the archive in a plane seat — is worth an IndexedDB
store, an eviction state, a persistence request, a two-phase progress screen, a
Settings entry and an unversioned cache rule, and every one of those is a
surface that can go silently wrong in the §5 way this whole feature is most
exposed to: an archive that quietly looks empty. **Not building it deletes six
failure modes rather than deferring them.**

**WHAT DID NOT DIE WITH IT, because each earns its place for a reason that was
never offline:**

- **The whole-basin file, and the one-time Worker pass over it.** Step 9 answers
  *"how many storms have passed within 100 miles since 1851"*, which is every
  season at once and cannot be answered a year at a time. **That pass is now
  step 9's to build and step 9's to size**, and it no longer arrives ready-made
  from a step before it — the one real cost of this deletion, written down here
  rather than discovered at step 9. §57.35 FAULT 1 and FAULT 2.
- **A per-storm cost gate for Tier 2** (§57.24, step 12). One storm is ~5.4 MB.
  That is worth telling somebody about before it moves, whether or not a byte of
  it is ever stored.
- **The service worker not precaching the data** (§57.35 FIX 9). That was never
  about offline — precaching 22 MB taxes every visitor at install time.
- **Cache-first for `/seasons/data/`** and `tools/test-sw-routing.mjs`. Those
  make the archive load fast and correctly ONLINE, against files `_headers`
  already declares immutable. Untouched by this.

**§57.24, §57.34 rules 5 and 6, and §57.35 were gone through in the same pass**
and everything in them that existed only to serve this step is deleted or
rewritten there, rather than left standing as machinery pointing at a step that
is not coming.

---

**STEP 9 — NEAR HOME. ==> BUILT 2026-08-25. <==**
`lib/near-home-words.js`, `ui/seasons-near-home.js`, `data/near-home-index.js`,
`seasons/near-home-worker.js`, `ui/near-home-standing.js`, and the near-home
block in `config/constants.js`.

**§57.19a is the as-built account. Read that, not this.** The one-line version:
the filter and its slider are free because a season is already in memory, and
only the Home dashboard's standing line pays for the whole-basin pass — 0.93 MB,
in a worker, several seconds after first paint, once per house rather than once
per visit.

**==> IT SIZED THE PASS THIS STEP INHERITED FROM STEP 8'S DELETION, AND THE
NUMBERS ARE IN §57.19a. <==** 3,266 storms, 84,365 segments, 570 ms to parse on a
desktop, 50–100 ms to measure, 10–65 KB of answer. The last of those is what makes
storing it worth doing and is why the megabyte is paid once.

**==> AND IT CORRECTED §57.19's RANGE. <==** The slider is per unit system now —
10–500 mi or 20–800 km, the same circle to within half a percent — because half
this app's readers think in kilometres and a control fixed in miles beside
kilometre distances is lying about its own units.

**The done-condition was already met before this step opened**, and that is worth
saying plainly rather than quietly: `tools/test-near-home.mjs` has asserted the
fast-mover case since step 2, both ways, and the mutation was run then. What step
9 added is 99 assertions and 19 mutations over everything BETWEEN that
measurement and a reader.

**AARON'S VERDICT, 2026-08-25: it works.** The slider under a thumb, the row line
at small type, and the standing sentence on the dashboard — all three confirmed.
The done-condition is met.

**THREE VALUES ARE NOW SETTLED BY ACCEPTANCE AND SHOULD NOT BE REOPENED WITHOUT
NEW EVIDENCE.** `nearHomeRange`'s default at 120 mi / 200 km, which is the number
the door quotes AND the number the slider opens on; `nearHomeIndexDelayMs` at 4
seconds, which put the sentence on the door without arriving over a storm somebody
was reading; and the globe emptying on the first step of a drag, which reads as
correct rather than as a fault.

---

**STEP 10 — THE SEASON CLOCK.**
§57.23. Redraw in place, ghost trails, reduced motion, keyboard.
**Measure before tuning** (§57.35 fault 3): discrete steps, split sources, curves
cached per storm. If the numbers say no, the fallback is fewer steps per second,
not a smaller feature.
**Aaron looks at:** 2005 played end to end on a phone. Frame rate, battery, and
whether it is worth watching.
**Done when:** it holds frame rate on a real phone for a full season.

---

**STEP 11 — CHOOSE THE TIER 2 STORMS. A decision session, not a build.**
Aaron picks which storms get the full advisory treatment.

**==> THE SHELF IS NO LONGER PART OF THIS DECISION. <==** It was, and §57.17
split it out on 2026-08-24: the shelf is every retired name plus §57.14's alias
list, which is a rule rather than a session. **What is left here is only the
handful of storms whose whole night gets captured.**

**Step 0 has run and it narrowed the field before this session opens** (§57.9):

- **Andrew '92 is OUT and cannot be argued back in.** Text advisories stop at
  1998. He is a headline SHELF storm with an unusually good Tier 1 page.
- **Katrina '05 is in the middle band** — every word NHC wrote, and no cone,
  because GIS geometry stops at 2008. Buildable and genuinely interesting, but
  it is **not the same feature** as a Sandy, and offering it as one would be
  promising a drawing we would have to invent.
- **2008 onward is the only era that gets the full thing.** Sandy '12 qualifies.

Bring to this session: §57.9's cliff table, §57.17a's real per-storm cost (Ida
is 7.7 MB as captured, ~5.4 MB after the precision trim), and a shortlist with
a reason beside each. **Watch the FILE count as much as the byte total** — Ida
alone is 269 files against Pages' 20,000 cap.
**Done when:** a named list exists in this file with a reason beside each entry,
and each entry says which of the three grades it is.

---

**STEP 12 — TIER 2 CAPTURE AND THE ADVISORY SCRUBBER.**
Capture the chosen storms the way Ida was captured, with §57.17a's two changes
built in from the first storm rather than retrofitted: **coordinates trimmed to
four decimal places on capture**, and **each storm downloaded on its own** when
the reader opens it rather than bundled with a basin. Wire the per-advisory
scrubber, cone, and watch/warning lines — reusing the existing replay machinery
where it fits.
**Done when:** one chosen storm scrubs advisory by advisory on a phone.

---

**STEP 13 — THE REST OF THE WORLD.**
IBTrACS for past seasons, our own capture for current. §57.12's rule: no name
roster outside the two basins that have one — a storm list instead.
**Done when:** a West Pacific season opens and does not pretend to have a name
roster.

---

**STEP 14 — THE WALL OF YEARS.** §57.29, §57.36, and **§57.36a for what it
actually is now that it is built.** No longer optional and no longer last: it
is the archive's front door, and the year picker it replaced is deleted.

Sub-steps 1, 2 and 3 (the wall, the pinned season in progress, and filters and
sort) are **DONE** — on `main`, confirmed on Aaron's phone 2026-08-27.

Sub-step 4 (the landfall triangles), the entry-point unwind and both pills
(§57.37 as amended, §57.38b–d) are **DONE** — confirmed on Aaron's phone and on
desktop, 2026-08-28.

Remaining: **Storm Details** (§57.22, the third rung of §57.39's ladder), which
is the only unbuilt piece of the wall's own ladder.

**==> SUB-STEP 4 SHRANK AND §57.7a IS WHY. <==** It was "the landfall triangles
AND the honesty marks". The marks existed because NOAA's record had twelve
uncoded Atlantic years and thirty-nine East Pacific ones; we compute landfalls
ourselves now, in every basin and every year, so there is no hole left to be
honest about. **The hollow gap marks, the "not recorded" hairline wording and
the landfall honesty line are out of scope.** What remains is the triangle
itself, plus the season in progress — live b-decks carry no marker and no phone
carries a coastline, so 2026 keeps its hollow mark and its
`landfallsKnown: false`.

**And step 13 got easier rather than harder.** IBTrACS carries no landfall
marker in any form, so every basin it brings in gets landfalls from
`lib/landfall.js` the day its tracks are parsed. That is the reason Aaron chose
ours-everywhere over ours-where-NOAA-is-silent (§57.7a) and it should not be
re-litigated when step 13 opens.

---

## 57.31 Open — not decided, do not assume

1. ~~**A2 versus A.**~~ **CLOSED 2026-08-24.** A2 was never built. Aaron's
   call: the measured collision compares a hairline to a lit disc, so the
   answer is a real storm on a real coast, not a second paint chip. Sepia
   shipped as chosen, with its land darkened to clear the contrast gate.
   `SPEC-MAP.md` §9.
2. **Which storms are Tier 2.** Step 11. Aaron decides, and step 0 already
   narrowed the field: Andrew '92 is ineligible, Katrina '05 is words-without-
   geometry, 2008 onward is the only full-treatment era (§57.9).
   **The SHELF is no longer part of this** — §57.17 settled it as a rule: every
   retired name, plus §57.14's alias list for the famous unnamed.
3. ~~**IBTrACS is unverified.**~~ **CLOSED 2026-08-24.** Measured: CSV is 316 MB
   and splitting by basin does not clear the cap; NetCDF fits but needs a binary
   reader. Neither raw form ships. The runner precomputes. §57.33.
4. ~~**The b-deck line layout is assumed, not read.**~~ **CLOSED 2026-08-24.**
   Read across all fourteen current b-decks. §57.4a — one line per wind
   threshold, a variable key/value tail, and a name that changes down the file.
5. ~~**How far back NHC's advisory archive reaches.**~~ **CLOSED 2026-08-24.**
   Three different cliffs: b-decks 1958, text 1998, GIS 2008. §57.9. **This
   rules Andrew '92 out of Tier 2 and puts Katrina '05 in a middle band with
   words but no geometry** — both are step 11's problem now, not an unknown.
6. **Season clock speed** — a day a second is a starting number, not a decision.
   Aaron tunes it on glass at step 10, and it lives in the motion constants.
7. **Whether the Wall of Years ever gets built.**

## 57.32 Files this feature is expected to create

Sketch, not a contract — but nothing here goes into an existing file that is
already near its limit.

```
seasons/            entry, shell, mode state, deep links
lib/hurdat.js       HURDAT2 + ATCF parsing into one shape        BUILT (step 2)
lib/season-facts.js the derived figures in §57.15                BUILT (step 2)
lib/near-home.js    line-to-point distance against a track       BUILT (step 2)
lib/near-home-words.js   the wording, and the per-system range   BUILT (step 9)
ui/seasons-near-home.js  the filter, the slider, the row line    BUILT (step 9)
data/near-home-index.js  the whole-archive answer, cached        BUILT (step 9)
seasons/near-home-worker.js  that pass, off the main thread      BUILT (step 9)
ui/near-home-standing.js the dashboard's standing line           BUILT (step 9)
ui/seasons-board-furniture.js  the season's own sentences        BUILT (step 9)
data/seasons.js     fetch and cache — NOT offline, see §57.30 step 8
map/layers/season-*.js   track, landfall marks, swath, ghosts
ui/view-seasons*.js      shelf, board, roster, detail
config/tokens.js         + the SEPIA palette                     BUILT (step 1)
config/constants.js      + a SEASONS block                       BUILT (step 2)
```

**Also built, and they are TOOLS rather than app code — nothing imports them:**
`tools/seasons-fixtures.mjs` with its workflow (cut real storms out of the full
NOAA files on a runner), and `tools/test-hurdat.mjs`,
`tools/test-season-facts.mjs`, `tools/test-near-home.mjs`,
`tools/test-seasons-near-home.mjs`.

## 57.33 What this costs — nothing, and the three limits that keep it that way

**Aaron's constraint: this feature must not cost money.** It does not, but only
because of decisions made below. A different storage choice would.

Verified against Cloudflare's published free-tier limits, August 2026.

| What | Where it lives | Why it is free |
|---|---|---|
| HURDAT2, both basins | committed to the repo, served as a static asset | requests to static assets are free and unlimited, and Cloudflare does not bill bandwidth at all |
| Tier 2 storms | same | same |
| Current season | **Workers KV**, behind a route | see limit 2 |
| Our JTWC-basin capture | appending branch + KV | public repo: free Actions, free clones, free storage |

**LIMIT 1 — KV WRITES, LISTS AND DELETES: 1,000 A DAY EACH.** Reads are 100,000
and storage is 1 GB, so reads and storage are not the constraint; writes are.
Our shape is one write per storm per hour — five active storms is 120 a day,
about a tenth of the budget.

**==> NEVER CALL `list()`. <==** List operations share that same 1,000/day cap,
and a route that lists keys per request burns it fast. **Keys get predictable
names and are fetched directly.** This is the single easiest way to turn this
feature into a bill.

**LIMIT 2 — PAGES BUILDS: 500 A MONTH (~16 A DAY).** This is the actual reason
the current season lives in KV rather than in the repo. Committing storm updates
to `main` fires a build each time — a dozen a day during an active season, which
collides with Aaron's own pushes and churns the service worker for every user on
what is only a data change. KV writes fire no build.

**LIMIT 3 — PAGES CAPS FILES AT 20,000 PER SITE AND 25 MiB EACH.** Measured
2026-08-24: the repo tracks 867 files, 32 MB total, largest single file 2.3 MB.
Ida alone is 269 files, so ten Tier 2 storms would add roughly 2,700 and put the
total near 3,600 — comfortably under the file cap.

**==> IBTrACS MEASURED 2026-08-24, AND THE SPREADSHEET FORM IS OUT. <==**

| Form | Whole world | Biggest basin | Verdict |
|---|---|---|---|
| CSV | **315.75 MB** | West Pacific **108.87 MB** | 8 of 11 files over the cap. **Splitting by basin does not save it** — only South Atlantic (55 KB) and the 3-year file (9.5 MB) clear 25 MiB |
| NetCDF | **22.27 MB** | West Pacific 8.55 MB | Every file clears the cap |

**NetCDF fits and is still the wrong answer.** It is a binary scientific format
with no zero-dependency browser reader, and shipping one would break the no-build-step
rule for a file the user never looks at. The CSV's own shape says why neither
raw form belongs on a phone: **174 columns**, because it carries twelve
different agencies' opinions of the same storm — Tokyo, CMA, Hong Kong, KMA,
New Delhi, Réunion, BOM, Nadi, Wellington and three historical datasets, each
with its own lat, lon, wind and pressure. The app draws maybe eight of them.

**THE RESOLUTION IS THE ONE §57.35 ALREADY MANDATES: PARSE ONCE, PRECOMPUTE.**
The Actions runner has open internet and no size cap, so it swallows the 316 MB
file, reduces each season to the fields we actually draw, and commits that. **The
user never receives IBTrACS — they receive our summary of it**, at a size in the
same class as a HURDAT2 season. The 25 MiB cap stops being a constraint because
nothing near it is ever served.

**This changes step 13's shape and nothing else.** The rest-of-world design is
now settled enough to build: no R2, no splitting scheme, no binary reader.

**The appending branch only commits when a file actually changes.** Off-season
that is zero commits a day. An hourly commit regardless of change would grow the
repo forever for no information.

## 57.34 Retention — nothing in this feature grows without a bound

**Aaron's constraint, and it is a separate one from cost:** no store here may
grow forever. Every place Seasons writes needs a rule for when it stops.
**Four places do, and it used to be six** — rules 5 and 6 were about a store on
the reader's device, and step 8's deletion (§57.30) means there is no longer one
of those. Both are recorded below rather than removed, because a deleted rule
that looks like an oversight invites somebody to re-derive it.

**1. THE APPENDING BRANCH — SQUASHED AT GRADUATION.**
It commits only when a file actually changes, so the off-season costs nothing.
But during a season it accumulates, and **once a year has graduated to a settled
static file the branch's whole purpose has expired** — the hour-by-hour
provenance of a live capture is only interesting while the capture is live.
**At graduation, squash to a single commit.** Same trick the `archive` branch
uses for the same reason, once a year instead of once an hour.

**2. KV — AT MOST TWO SEASONS, PLUS A TTL BACKSTOP.**
Graduation deletes the keys for the year it promoted. Roughly ninety storms
worldwide a year, deleted once a year, against a 1,000-a-day delete cap — a
rounding error.

**And every key carries a generous TTL anyway (~400 days).** Not because we
expect to need it, but because it makes cleanup the DEFAULT rather than an
action: if the graduation job ever breaks silently, the store shrinks on its own
instead of growing forever while nobody notices. A retention rule that depends
on a job running is not a retention rule.

**3. THE REPO — ONE NOAA FILE PER BASIN, REPLACED, NEVER ACCUMULATED.**
NOAA republishes one cumulative file each February. `hurdat2-1851-2024.txt` does
not sit beside `hurdat2-1851-2025.txt`; the old one is deleted in the same
commit that adds the new one. Deleted is deleted (§12).

**The working tree therefore stays flat, but git history does not.** Each swap
adds a blob. The new file is mostly an append to the old one, so delta
compression should keep the real cost near the diff rather than near 6.8 MB —
**but that is a prediction, not a measurement. Measure the repo before and after
the first February swap** and revisit here if it is worse than expected. Today
the whole repo is 32 MB, so there is a great deal of runway before this matters.

**4. TIER 2 CAPTURES ARE PERMANENT — DECIDE FIRST, COMMIT SECOND.**
Ida is 7.7 MB and 269 files. **Committing a Tier 2 storm is a permanent repo
cost even if it is later deleted**, because git keeps it. This is a second,
independent reason step 11 (§57.30) is a decision session that happens BEFORE
any capture: the shelf is short by design, and each addition is a door that does
not close.

**5. ==> ON DEVICE — DELETED 2026-08-25, BECAUSE THERE IS NO STORE. <==**
It read *"Seasons data — 10.8 MB — Remove"*, actual bytes, not a guess. It
existed for exactly one reason: step 8's download screen promised the download
was removable, and a promise has to be somewhere the user can find it later.

**Step 8 is deleted and so is the promise** (§57.24). Seasons now writes nothing
to the device that it manages. What the browser's own cache holds, it holds on
its own terms, and offering a Remove button for storage we do not own would be
a control that cannot keep its word.

**What would bring it back:** anything in this feature that writes a store we
manage and can measure. Step 9's precomputed near-home numbers are the nearest
candidate and do not qualify — a couple of thousand numbers is a few KB, and a
Settings row quoting it would be noise.

**6. ==> THE SEASONS DATA CACHE — REWRITTEN 2026-08-25, AND IT IS NOW A TRAP
RATHER THAN A RULE. <==**

It used to read: the seasons data cache must not be versioned with the app,
because the service worker purges old caches on activate, so **every deploy would
silently delete the user's 11 MB download** — and they would discover it the next
time they opened Seasons on a plane, which is exactly the moment the feature was
built for. It was called the easiest catastrophic mistake in this whole feature.

**There is no 11 MB download any more** (§57.30 step 8), so there is no
catastrophe and nothing to protect. As built, `/seasons/data/` sits in the
ordinary versioned cache and a deploy costs a reader **a 14 KB refetch per year
they revisit**, which nobody minds and nobody notices.

**The trap is still real for the first thing that is big enough**, and that is
step 12's Tier 2 storms at ~5.4 MB each. If one of those ever becomes cache-first
in the versioned cache, every deploy re-fetches it. **The rule for that day: a
Seasons artefact large enough that re-fetching it hurts gets its own unversioned
cache name and is excluded from the purge sweep.** Nothing today qualifies.

**Cache-first for `/seasons/data/` is not this rule and is not affected by it.**
That entry exists because the filenames carry NOAA's revision stamp and
`_headers` already serves them `immutable` — without it the worker would force a
revalidation round trip on a file the HTTP layer had just been told to keep.
`sw.js` says so at the entry, and `tools/test-sw-routing.mjs` holds it.

**7. Seasons writes nothing into live stores.** §57.2. It is listed again here
because the ended-storm store is the one place in this app that already grew a
record it should not have, and it grew it from a replay.

## 57.35 The pipeline, audited — parse once, precompute, never block

**Audited 2026-08-24 against three lenses: performance, front-end, cost.** The
first draft of this plan said "download the file, cache it, parse it." That is
three separate performance faults in one sentence. What follows replaces it.

**THE SHAPE, END TO END**

**==> AND THE ORDINARY SHAPE CHANGED TWICE SINCE THIS WAS WRITTEN. <==** FIX 12
cut the file into seasons on the runner, and step 8's deletion (§57.30) took the
device store away entirely. So there are two shapes now, and the first one is
what almost every reader gets:

```
THE ORDINARY PATH — browsing a year
NOAA  --(runner, yearly, conditional GET)-->  repo, whole basin
basin --(runner, sliced per season)-->        repo, one file per year
repo  --(one request, 14 KB gzipped)-->       the globe, parsed in 14 ms
```

```
THE WHOLE-BASIN PATH — step 9 only, and nothing else reaches it
repo  --(one request, ~1.4 MB gzipped)-->     phone
phone --(ONE parse, in a Worker)-->           ~2,000 near-home numbers, resident
```

Everything below is a rule one of those two shapes has to keep, and each fault
now says which.

**FAULT 1 — PARSING ON EVERY OPEN. The worst of them.**

The draft cached the raw text in the service worker. That means **6.8 MB is
re-parsed every single time Seasons opens** — roughly 55,000 lines split, comma-
split and number-parsed, on the main thread, in front of a globe that is trying
to hold frame rate. On a mid-range Android that is seconds of freeze, every time.

**Parse exactly once, at download time, in a Web Worker** (a plain ES module
worker — no build step needed). Write **per-season records into IndexedDB** and
**discard the raw text**. Opening 2005 then reads about 30 KB of already-parsed
data and touches no parser at all.

The download screen therefore has **two phases, and must say so**: *Downloading*
then *Indexing*. Both are real work and the second is not instant.

**==> ALL OF WHICH IS STILL TRUE, AND ALMOST NOBODY REACHES IT. <==** Everything
above applies to a pass over a WHOLE BASIN. Browsing a year goes through a
per-season file instead — 14 KB, milliseconds, no Worker and no store (FIX 12).

**==> AND `IndexedDB, PER SEASON` IS DELETED. <==** 2026-08-25, with step 8
(§57.30). A per-season record in a store was worth building when the alternative
was re-parsing 6.8 MB; against a 14 KB file that parses in 14 ms it is a store
with an eviction problem, a versioning problem and an is-it-still-there problem,
in exchange for nothing measurable.

**What survives is the Worker pass itself, and it belongs to step 9 now.** One
walk over the whole basin, off the main thread, producing the near-home numbers
in FAULT 2 — a couple of thousand of them, held in memory (FIX 7), recomputed
when home moves. **The two phases and the honest naming survive with it**:
*Downloading* then *Indexing*, because the second is real work and is not
instant. Step 9 sizes that pass; it no longer arrives ready-made from a step
before it.

**FAULT 2 — THE NEAR-HOME SLIDER WOULD SCAN THE WHOLE ARCHIVE.**

§57.19 measures against the line between points, not the points. Correct — and
across 175 years that is roughly 2,000 storms and 80,000 segments. **Doing that
on a slider drag freezes the app on every pixel.**

**Precompute at index time.** During the same Worker pass as FAULT 1, hold per
storm: **minimum distance to home, and the strength at that point.** The slider
then filters about 2,000 precomputed numbers, which is instant and stays instant.
**This whole fault is step 9's and is untouched by step 8's deletion** — nothing
in it was ever about offline.

- Bounding-box reject before precise distance, or the index pass is slow too.
- **Home moving invalidates it** — recompute once, in the Worker, on home change.
- This is also what makes the Home dashboard's standing line free.

**FAULT 3 — THE SEASON CLOCK WOULD RE-FEED MAPLIBRE EVERY FRAME.**

Calling `setData` sixty times a second hands the map worker a fresh parse and
re-index each time. Frame rate will not survive it.

- **The clock advances in discrete steps, not per frame.** Six-hourly data does
  not need sixty updates a second; something around 8–12 steps a second reads as
  smooth and costs a fifth as much.
- **Split the sources.** The accumulated trail is a large source that grows in
  chunks; the moving heads are a tiny separate source. Never rewrite the big one
  to move a dot.
- **Smooth and simplify once per storm, cached.** Running Catmull-Rom over 1,100
  points per frame is not affordable; the curve does not change.
- **Step 10 measures this on a real phone before the clock is called done.** If
  the numbers say no, the fallback is fewer steps, not a smaller feature.

**FAULT 4 — SEASONS WOULD HAVE LOADED FOR PEOPLE WHO NEVER OPEN IT.**

Every import in every file ships to every visitor (§12, no build step). The app
already carries 179 modules and Windows spends 317 ms on libraries alone.
Statically importing ten Seasons modules taxes every boot, forever, for a
feature most sessions never touch.

**Seasons is dynamically imported on first entry** — `await import(...)`, native
to ES modules, no build step, no tooling. The two doors in §57.16 are the only
things about Seasons on the boot path.

**FAULT 5 — THE PROGRESS BAR WOULD HAVE RUN PAST 100%.**

Cloudflare compresses text automatically, so 6.8 MB of HURDAT2 arrives as
roughly a fifth of that. **`Content-Length` reports COMPRESSED bytes while a
streaming reader yields DECOMPRESSED bytes.** Divide one by the other and the
bar sails past 400%.

**Progress is computed in one unit or the other, never mixed.** And the screen
quotes what is actually transferred, not the uncompressed file size — telling
someone 6.8 MB when 1.4 MB moves is a small lie in a place that is asking for
their patience.

**Kept after step 8's deletion, for a reason that was never offline:** two things
still show a progress bar over a compressed body — step 9's whole-basin fetch and
step 12's ~5.4 MB Tier 2 storm (§57.24) — and both would sail past 400% the same
way.

**FIX 6 — THE PHONE NEVER TALKS TO NOAA.**

The runner fetches from NOAA once a year and **commits the file to the repo**.
The phone requests it from our own origin as a static asset. That single decision
removes four problems at once: no CORS question, no NOAA outage taking Seasons
down, **no Pages Function in the path** — so no Workers quota, no 10 ms CPU
ceiling, no streaming a multi-megabyte body through a Worker — and static assets
are free and unlimited.

**Only the current season needs a Function**, and it is edge-cached hard
(`Cache-Control` around 15 minutes) so the Function runs on a miss rather than
on a request. Six-hourly data does not need a live query.

**FIX 7 — NEVER HOLD THE WHOLE ARCHIVE IN MEMORY.**

175 years parsed into JS objects is tens of megabytes of heap, on a device that
will kill the tab for less. **One season in memory at a time**, fetched on entry
and dropped on leave — which is what `ui/seasons-board-loading.js` does today,
replacing `entries` wholesale on every year change. The near-home index (FAULT 2)
is the one small thing allowed to stay resident, because it is a couple of
thousand numbers. **Unchanged by step 8's deletion; the source is a 14 KB file
rather than an IndexedDB read, and the rule is the same either way.**

**FIX 8 — ==> DELETED 2026-08-25 WITH STEP 8, MINUS ONE SENTENCE. <==**

It read: Safari clears site storage for sites not visited in about a week,
`navigator.storage.persist()` helps and does not guarantee, so **request
persistence and handle the data being gone as a first-class state** — a plain
line saying the download was cleared by the device and a button to fetch it
again, because an archive that quietly looks empty is exactly the silence §5
forbids.

**Every word of that was about a download that no longer exists** (§57.30 step
8). There is nothing on the device to be evicted, so there is nothing to lie
about: a cleared cache costs a 14 KB refetch that the reader never sees.

**The one sentence that survives, because it is a §5 rule rather than a storage
rule:** if step 9 ever holds its precomputed near-home numbers anywhere and they
are not there, that means **recompute quietly**, never *an archive with no
storms in it*. Absence is this feature's whole subject and it is the one thing
it must never accidentally state.

**FIX 9 — THE SERVICE WORKER MUST NOT PRECACHE THE DATA.**

If it lands in the install-time precache list, **every visitor downloads
megabytes they never asked for** — a boot-time tax on every session, including
the overwhelming majority that never open Seasons at all. The data is fetched on
request and cached on demand.

**This one is untouched by step 8's deletion and the reason is worth stating,
because the rest of this section lost its offline half:** FIX 9 was never about
offline. It is about what the app costs somebody who is not using this feature,
which is the same argument as FAULT 4. `sw.js`'s precache list is three entries
and `tools/test-sw-routing.mjs` holds it.

**FIX 10 — CONDITIONAL REQUESTS TO NOAA, WHICH ALSO GIVE US CHANGE DETECTION.**

The runner polls b-decks hourly during a season. Send `If-Modified-Since` /
`If-None-Match` and unchanged files come back `304` with no body.

This is good manners toward a public service we depend on, and **it hands us
§57.34's "commit only when a file actually changes" rule for free** — a 304 is
the answer, rather than something we have to diff for.

**FIX 11 — IMMUTABLE CACHING, WITH THE YEAR IN THE FILENAME.**

`hurdat2-atlantic-2025.txt` never changes; next February's file has a different
name. So it is cached permanently and the rename is the cache bust. A `_headers`
block for the data path, matching how `/vendor/*` is already handled.

**FIX 12 — THE RUNNER CUTS THE FILE INTO SEASONS, SO BROWSING COSTS NOTHING.**

Added 2026-08-24, Aaron's call, and it is the reason step 5 could be built
before step 8. `tools/seasons-slice.mjs`, `SPEC-OPS.md` §18.8.

Everything above solves "the phone holds 6.75 MB well". Nothing above asked
whether the phone needs 6.75 MB to show one year. **It does not**, and the file
is trivially separable — HURDAT2 is chronological and a storm's header carries
its own year.

Measured on the real 2005 Atlantic bytes:

| | Whole basin | One season |
|---|---|---|
| Fetched to open 2005 | 6.75 MB (≈1.4 MB gzipped) | **119 KB (14 KB gzipped)** |
| Parse | seconds, needs a Worker | **14 ms in node** |
| Needs | download gate, progress, IndexedDB | **nothing** |

So FAULT 1's Worker, FAULT 2's precomputed index and FAULT 5's progress units all
stop being prerequisites for looking at a year.

**==> AND ON 2026-08-25 THAT ARGUMENT FINISHED WHAT IT STARTED. <==** This
paragraph used to end *"they remain exactly what step 8 and step 9 need for the
whole-basin download."* Step 8 is deleted (§57.30) and **step 9 is the only
caller left.** The whole-basin file is not deleted and must not be — near-home-
since-1851 is every season at once — but everything above it now belongs to one
step rather than two, and FIX 8's eviction state went entirely.

**The cut is verified against the whole file before any of it is written**, and
that gate is the important half of this fix rather than the slicing. A slice
that loses the last storm of a season produces a page that is merely quieter
than it should be, with nothing on screen saying so — the §5 failure this
feature is most exposed to, since the whole subject is absence.

**WHAT THE AUDIT CONFIRMED WAS ALREADY RIGHT**

- Static assets for settled years, KV only for the season in motion (§57.33).
- The download gated behind an explicit ask (§57.24).
- **One parser, shared.** `lib/hurdat.js` is a plain ES module, so the Node
  runner and the browser Worker import the same file. Two parsers drifting apart
  is a bug this project has already paid for elsewhere.
- The retention rules (§57.34).

### 57.36 The Wall of Years — the front door, its filters, and how they stack

**Aaron's calls, 2026-08-26, judged on glass.** §57.30 gated step 14 as
optional and last. It is neither any more, and the reason is that its job
changed: **the wall is the archive's FRONT DOOR, not a second way to reach the
year picker.** Enter Seasons, see the wall, tap a year, land on the board —
and the year dropdown is REMOVED from the season drawer entirely. There is one
way into a year and this is it.

**The settled look, taken off a phone and not up for re-litigation:** rows are
44px (§'s touch-target rule, no exception carved out), every dot is the same
size regardless of strength, the storm count sits on the right, pre-1966 rows
are shaded with a line drawn at the boundary, a storm that came ashore carries
a small triangle under its dot, and **there are no decade headings.** The decade
heading was the first thing to go on glass — it broke the scroll into chunks and
the wall reads better as one unbroken run of years.

#### The whole design rests on one rule: filter first, then sort what survives

**==> EVERY SORT KEY IS COMPUTED OVER THE FILTERED SET, NEVER OVER THE WHOLE
SEASON. <==** This is the entire reason the two controls stack, and getting it
backwards makes the feature useless without looking broken.

Aaron's own example is the test case. *Filter to Category 5, then sort by count,
high to low.* If "count" meant the season's total storms, that sort would rank
2005 above 1932 because 2005 had 31 storms — a fact the filter was explicitly
asked to ignore. Counting only what survives the filter gives the answer he
actually asked for:

| Season | Cat 5s |
|---|---|
| 2005 | 4 |
| 2025 | 3 |
| 2024, 2019, 2017, 2007, 1961, 1933, 1932 | 2 |

**So there is no "sort by number of Category 5s" key, and there must never be
one.** It falls out of two general controls, and so does every question of that
shape — most landfalling storms, most major hurricanes, most ACE contributed by
storms that hit land. A special-purpose sort key for each of those is the
combinatorial explosion this rule exists to avoid.

The sort keys are **year, count, strongest, landfalls, and ACE** — each
reversible, high-to-low and low-to-high. Four of the five are recomputed under
the filter. Ties break by year, newest first.

#### ACE under a filter stops being the published number, and must say so

ACE sums per storm, so "the ACE of the storms still showing" is a well-defined
and genuinely interesting number — the share of a season's violence that came
from majors, say. **But it is no longer the figure NOAA publishes for that
season,** and a reader who checks 2005 against any reference will find 250 and
see something else on our screen. Whenever a filter is active the ACE column is
labelled as the filtered figure rather than presented bare. §5: a number that
is right about a different question is a wrong number.

#### The count column carries both figures, because the ratio is the story

Under a Cat 5 filter, 2005 shows 4 and 1932 shows 2. Bare, that reads as though
those seasons were comparable. **2005 had 31 storms and 1932 had 15**, and the
row loses the only context that makes its own number mean anything. The shown
count is the large figure and the season total sits beside it small — `4 of 31`.

#### Empty rows: hairlines keep the timeline, a collapsed tail is fine once the timeline is gone

**Measured: filtering the Atlantic wall to Category 5 empties 142 of its 175
rows.** That is the normal case for a tight filter, not an edge case, and it
decides the rule:

- **Sorted by year, empty rows stay in place as hairlines** with the year still
  legible. The gaps ARE the information — a run of empty years is what a quiet
  stretch looks like, and collapsing them would quietly redraw history.
- **Sorted by anything else the timeline is already destroyed**, so 142
  hairlines are just dead scroll. They collapse to a single line at the foot —
  *"142 seasons had no Category 5"* — expandable, never hidden.

#### The count line is always visible, under every combination

*"33 seasons shown · 142 with none"*. With filters this sharp, an over-filtered
wall and a broken wall are the same screen. §5 again.

#### ==> STACKING FILTER AND SORT IS WHERE THE PRE-SATELLITE UNDERCOUNT TURNS FROM A FOOTNOTE INTO A FALSE CLAIM. <==

A shaded band and a line at 1966 are enough when the wall is in year order,
because the shading is contiguous and reads as "the record gets thinner up
here." **Sort by anything else and the old years scatter through the list,
the line cannot be drawn at all, and the shading loses its meaning.**

The Category 5 case is the sharpest version and it is measured, not asserted:

| | Cat 5s | Seasons | Per year |
|---|---|---|---|
| Pre-1966 | 13 | 115 | **0.11** |
| 1966 onward | 32 | 60 | **0.53** |

Nearly five times the rate, and **only 3 of the top 20 Cat 5 seasons are
pre-satellite.** Almost none of that gap is weather. Nobody could measure a
140-knot wind over open water in 1890, so storms that never came ashore were
recorded at whatever a ship happened to see. An unmarked Cat 5 leaderboard
therefore states that Category 5 hurricanes are a modern phenomenon — **a
climate claim this dataset cannot support, made accidentally, by a sort
control.**

So: whenever a filter or a non-year sort is active, **a persistent line sits
under the controls carrying the actual numbers**, and every pre-1966 row keeps
its own mark rather than relying on a band. Not a tooltip and not a shade —
those are dismissable and this is not.

#### One filter vocabulary, shared with the board

The board already has pills — All, Hurricanes, Majors, Landfalling, Near home.
The wall must not grow a second, differently-worded set. **They are one filter
model with two presentations**, and a filter chosen on the wall carries through
when a year is tapped.

**Visible by default:** the seven category chips, coloured exactly as the dots
are, so the control documents itself in one row instead of seven labelled
checkboxes; the near-home slider; the landfall toggle.
**Collapsed:** retired names, long-lived, lowest pressure, ACE threshold.
All categories start checked. **There is no "Majors" shortcut** — it is three
chips, and a shortcut that duplicates a control is a second thing to keep in
sync. Category means PEAK category, matching what the dots are coloured by.

#### Sorting the dots inside a row is forbidden

The strip reads left to right as the season happened. Reorder it by strength
and June stops being on the left, and no two rows can be compared. **Duration
and lowest pressure sort on the BOARD, not the wall** — they are facts about a
storm, and the board is the screen that lists storms.

### 57.37 Proposed: the archive bar goes, the storm-list button becomes the door

**Aaron, 2026-08-26. PROPOSED, NOT BUILT.** Recorded here so the build pass has
it; nothing in this section is in the code yet.

**The change.** Delete `#seasons-bar` — the strip along the bottom of the
viewport — and make the existing storm-list control (`btn-storms` in
`index.html`, one of the four `.control` buttons) the way into the archive.

#### Two objections checked before writing this down, and only one survived

**==> THE HONESTY SURFACE IS NOT IN THE BAR, SO DELETING IT COSTS NOTHING
THERE. <==** The first worry was that the bottom bar was carrying data age and
source health, in which case removing it would be a §5 violation dressed up as
a layout change. It is not. `ui/status.js` owns source health, stale flags and
"GDACS is not responding", it lives on the TOP edge, and it is silent when
everything is clean. The two are independent. **This objection is dead and the
change is safe on those grounds.**

**The one that stands: the bar is currently TWO doors, not one.** §57.16 calls
it "the archive bar and the two doors into it", and a single button cannot be
two doors without deciding what happens to the second. That has to be answered
before this is built, not during.

#### RESOLVED — Aaron, 2026-08-26. Half of this section is withdrawn.

**The entry points do not change.** The two existing doors stay exactly as they
are: the `Past storms` row at the foot of the live storm list, and the Home
dashboard row that opens with the near-home filter already applied. `btn-storms`
is NOT the way in and never becomes one — it opens the live storm list, as it
always did. The proposal above to make it the door is withdrawn, and the "two
doors" objection above dissolves with it: there was never a need to collapse
two doors into one button.

A measured correction while this section is open: it says `btn-storms` is "one
of the four `.control` buttons". There are FIVE — recenter, home, storms,
layers and settings — so the rejected fifth-button option would have been a
sixth element in that cluster, which is a stronger argument against it than the
one the section makes.

**What DOES change is still the bar.** `#seasons-bar` is deleted, its
`--seasons-bar-h` with it, and the jobs it was doing move:

- **Naming where you are, and being the way out** → a new, small pill at the
  TOP of the archive globe. **BUILT — step 6, §57.38a is the as-built account.**
  It reads `‹ Live storms` and names the DESTINATION rather than the current
  place; §57.38's "what is currently being shown" wording is superseded there.
  Not `#storm-pill`, which is suppressed inside the archive entirely (§57.38a).
- **Reopening the drawer** → `btn-storms` while the archive is open reopens the
  ladder at the rung the reader left, rather than the live storm list. The
  rung memory this needs is already built (`lastRung` in `seasons/index.js`,
  fed by `drawer.onChange`) and is proved by `tools/seasons-rung-check.mjs`.
- **Source health** → nowhere, because it was never here. The objection above
  is correct and `ui/status.js` keeps it. Aaron's call, 2026-08-26: the top
  status strip is suppressed inside the archive, because nothing in there reads
  a live feed. A season that will not load still speaks, through the board's
  own three states (`ui/seasons-board-loading.js`).

**Step 6 — the pill — is BUILT (§57.38a), and the layout attribute
`data-seasons` moved to `seasons/index.js` with it, ahead of this file being
deleted. The status-strip suppression landed in the same pass. What remains
unbuilt is step 5: the bar itself, `--seasons-bar-h` and its four consumers,
and `btn-storms` reopening the ladder.**

#### What the bar costs and what it buys back

**MEASURED 2026-08-26: `--seasons-bar-h` has five references and all five are
inside `seasons/seasons.css`.** Nothing outside that file subtracts from it and
nothing reads it through `getComputedStyle`. The unwind is smaller than the
paragraph below fears.

`--seasons-bar-h` is published on `<html>` and every sheet in the app is laid
out above it, because §57.16's own header notes that a bar added underneath a
sheet is a bar with a sheet sitting on top of it. **So this is not one element
being deleted — it is a layout variable that other files subtract from their
own height.** Removing it means every consumer of `--seasons-bar-h` has to be
found and unwound, and that is the actual size of the job. It also returns that
strip of screen to the globe on every single view, which on a phone is the
whole argument for doing it.

#### The open question the build pass must answer first

**What does the storm-list button do when it is now two things?** The
candidates, and none is obviously right:

- **A segmented control inside the storm sheet** — live storms and past storms
  as two tabs of one list. Cheapest, and it matches the idea that both are
  "storms", but it buries the archive one level down.
- **Long-press or a second tap for the archive.** Rejected on sight: §'s input
  rule says every action needs a tap, click AND keyboard path, and a
  press-and-hold has no keyboard equivalent. This would make the archive
  unreachable without a pointer.
- **A fifth `.control` button** for the archive, leaving the storm list alone.
  Honest, keyboard-clean, and it admits the bar was carrying something the
  button cluster now has to carry.

**Aaron's call, and it is not made yet.**

#### What must not be lost

The bar's other door, whatever it is, and the sepia-on-its-own behaviour §57.16
describes — the bar turning sepia the instant the palette changes was a
deliberate piece of feedback, and if the bar goes, the thing that told the user
"you are in the archive now" goes with it. **A door with no indication you have
walked through it is worse than the bar.** The entry point can move; the "you
are in the past" signal has to land somewhere.

**==> STEP 6 IS WHY THE ORDER IS PILL FIRST, BAR SECOND. <==** The bar's Leave
button was the only exit — Escape never leaves the archive — so deleting the
bar before building the pill would have shipped a sepia globe with no way off
it. The pill is on `main` and confirmed before step 5 touches anything.

**==> AND THE SIGNAL IS STILL THE BAR'S JOB TODAY, WHICH IS WHY STEP 6 COULD
NOT ANSWER THIS QUESTION. <==** Step 6's glass pass was asked whether the
archive still says where you are with the drawer minimised, and the answer was
unreadable: `PAST STORMS` was sitting at the bottom left of the screenshot
doing exactly that. **The question does not become real until this bar is
deleted.**

After step 5 the signal rests on three things and none of them is a statement:
the sepia palette, the drawer's own heading (`Past storms`, or the year) which
is only there while the drawer is open, and a pill offering to take the reader
back to `Live storms` — which only makes sense if they are not there. **That
last one is an inference, not a label**, and whether it is enough on a
minimised archive globe is step 5's first glass call.

### 57.38 Proposed: the names, the rungs, and the archive pill

**Aaron, 2026-08-26. PROPOSED, NOT BUILT.** Companion to §57.37 — if the
archive bar goes, these are the names and the ladder that replace it.

#### The archive gets a pill, and it is the SAME pill

The live globe already carries `#storm-pill` along the bottom: a real button
with a text label and a busy state, sized off `--pill-inset` and `--pill-mark`.
**SUPERSEDED — Aaron, 2026-08-26. The archive gets TWO pills, and they are
different things.** The rule above assumed the archive needed one pill doing
one job. It needs two, and they are on screen at the same time: the existing
`#storm-pill` stays at the bottom and goes on saying what is currently drawn,
while a second, smaller pill at the top says "you are in the past" and is the
way out. One element cannot be in two places saying two things, so the
extract-before-the-second-use rule does not reach this case. What the rule was
protecting against — a lookalike drifting in another file — is still real, and
the answer to it is that the top pill carries no detail at all: it has one
sentence and one action, so there is nothing in it to drift.

What it says in the archive: **what is currently being shown**, in the same
plain voice the live pill uses. Candidates, cheapest first — how many storms
are drawn, which filters are on, which season. It must never be silent while
the globe has storms on it, for the same reason the live pill is not: a globe
covered in dots and no label is a screen that will not say what it is showing.

#### The names, and one correction

**Aaron's call: the drawers are `Season` and `Season Details`, and tapping a
year opens the second from the first.**

**==> ONE PUSHBACK, ON THE FIRST NAME ONLY. <==** The top drawer lists **175
seasons**, so calling it `Season` singular fights what is on the screen — and
`Season Details` beneath it makes the pair read as one thing and its detail
view, when actually the first is a list of many and the second is one member of
it. **Recommended: `Seasons` and `Season`.** The plural is the list, the
singular is the one you opened, the relationship is obvious from the words
alone, and `Seasons` is already the feature's name everywhere else in this
spec. If Aaron prefers his original pair it is his call and this paragraph is
the record of the objection, not a veto.

#### The rungs

The ladder, entry at the top. Each rung needs three things and they are not the
same string: what OPENS it, what its HEADING says, and what its BACK control
says. A back button reading "Back" tells the user nothing about where they are
about to land.

| Rung | Entry | Heading | Back says |
|---|---|---|---|
| 1 — the live globe | — | — | — |
| 2 — **Past storms** (the wall) | the two existing doors (§57.16) | `Past storms` | closes to the globe |
| 3 — **Season** (one year's board) | tapping a year row | the year itself | `Past storms` |

**Rung 3's heading is the YEAR, not the word "Season".** `2005` is the most
useful four characters that could sit there, the user tapped a year to get
here, and repeating a generic noun would waste the one line that could confirm
which year they landed on.

#### The rung this table is missing, and it needs an answer

**Tapping a storm in the roster.** The board is a list of storms and §57.17a
priced a full Tier 2 storm at 7.7 MB, so something is clearly intended to open
when one is tapped. That is a fourth rung with no name and no back label, and
this table is wrong until it has them. **Not decided.** If the answer is that
storms do not open at all from the archive, that is also an answer and it
should be written down rather than left as a gap somebody fills by accident.

#### What the names have to carry that the bar was carrying

§57.37's warning applies here and this is where it gets paid: the bar turned
sepia to say "you are in the past". **A heading reading `Seasons` and a sepia
palette have to do that job now.** The palette is already doing most of it; the
words must not fight it by being vague.

### 57.39 The ladder — SETTLED

**Aaron's call, 2026-08-26.** This supersedes the naming question left open in
§57.38 and fills the fourth rung that section flagged as missing.

```
Seasons  ->  Season Details (year)  ->  Storm Details (name)
```

**The naming objection in §57.38 is resolved, and Aaron's answer is better than
the one recommended there.** That section argued for `Seasons` / `Season` on
the grounds that plural-then-singular carries the relationship. Aaron kept the
plural for the list and made `Details` a consistent suffix instead, which does
the same work AND extends to the third rung for free. `Seasons` / `Season` had
no natural third term; `Storm Details` falls straight out of this one. **It is
a system rather than three separate choices, and that is why it is settled.**

### 57.36a The wall, as built

Steps 14 and 3. Everything here is on `main` and confirmed on Aaron's phone;
§57.36 above is the design and this is what shipping it taught.

**The data is a second file, not a section of the first.** `seasons/wall.json`,
93 KB raw and 24.3 KB gzipped, written by `tools/seasons-wall.mjs` on the same
monthly runner that refreshes HURDAT2. Every storm reduces to seven values —
`[peakCategory, landfall, ace, peakWindKt, days, pressureMb, name]`. It is
separate from `seasons/index.json` because the index is fetched by anyone
entering the archive at all, including through a deep link to one year, and the
wall's payload in front of that reader buys them nothing.

Every width was measured on the real files before the shape was chosen, both
basins, 3,266 storms. Re-derive with `node tools/seasons-wall.mjs --measure`:

| category only | 8,827 B raw | 2,286 B gzipped |
| + landfall flag | 21,891 B | 3,159 B |
| + ACE + peak wind | 45,992 B | 10,388 B |
| + days alive | 57,794 B | 14,128 B |
| + lowest pressure | 72,641 B | 17,803 B |
| + name (SHIPPED) | 93,107 B | 24,277 B |

The first four columns cover the chips, the landfall toggle and all five sort
keys; step 3 bought the last three for §57.36's COLLAPSED filters, at 14 KB
gzipped. The alternative was dropping three controls, not saving bytes — a wall
that cannot answer *"which storms lasted a fortnight"* is a smaller feature, not
a cheaper one. Names are carried though nothing filters on them yet, because
they are half that cost and regenerating the file is a monthly-runner round
trip.

**Three of §57.36's controls are not built, and none of the three is an
oversight.** The near-home slider needs track geometry the wall never loads:
filtering 175 seasons by distance means the 0.93 MB whole-basin file, whose
phone cost is unmeasured. The retired-names chip needs a list of ~120 retired
names that does not exist in this repo and which §57.17 rejects scraping for;
the names are in `wall.json` now, so it is a list away rather than a rebuild
away. And a filter chosen on the wall does NOT survive a tap into a year: the
wall is seven independent chips plus toggles and the board is one pill at a
time, so most wall states have no pill to become. Reconciling them means
changing a board already confirmed on glass, and that is its own pass.

**Filter first, then sort what survives.** `keepFor` builds the predicate,
`rowsFor` applies it and recomputes every per-row figure over what is left, and
only then does `sortRows` run. Reversed, the same rows come back in an order
computed from storms the reader asked to ignore — wrong, and invisibly so:
filtered to Category 5 and sorted by count, a season-total count ranks 1933
above 1932 on the strength of six storms the filter excluded.

**Sorting by a number that is nowhere on screen reads as a broken control.**
Year and count are already drawn, so those two add nothing; strongest, landfalls
and ACE borrow about 2.6em from the strip while their sort is active, which
takes a dot in the busiest basin from roughly 7px to 6px and gives it straight
back. `dotSizeFor` re-measures on every render, so no second calculation exists.

**`2 of 13` is one line or it is broken.** The count column was sized for a bare
count; the moment a filter turned it into a ratio it wrapped inside a 44px row
and read as two stacked numbers. It widens only while the ratio is showing.

**Solid category chips, and five sort buttons rather than a dropdown.** Both are
Aaron's calls on glass against the mockup, 2026-08-27, and both overruled a
shipped implementation. The chips were a 28% tint, which made the row read as
seven greyish pills rather than as the Saffir-Simpson scale — and that scale is
the legend for every dot below it. The sort was a `<select>` of ten named
orderings, argued for because press-again-to-reverse is a state nothing
announces; the arrow on the selected key now carries that signal and
`aria-label` spells it out. Ink on a saturated fill is `--on-bright`: none of
the seven category colours can carry the app's own pale text at AA.

**A repaint must not throw the reader back to 1851.** Every control change
replaces the body's markup, which resets its scroll — twelve arrow presses on a
threshold slider was twelve jumps — and the refocus that follows scrolled the
sheet on its own, undoing the fix a line later. Scroll is restored explicitly
and focus is handed back with `preventScroll`.

**Every season in both basins holds at least one storm.** Measured, not assumed.
So the hairline row and the tally's *"· N with none"* half had never rendered
before step 3 — a filter is the only thing that can produce an empty row, which
is exactly why *"no storms recorded"* is the wrong sentence for one. A filtered
row names what it is missing.

**What was never measured is excluded, never counted as nought.** A storm with
no central pressure is not a storm at 1013 mb; 1,258 of the 3,266 carry none at
all. A season with no measurable ACE is unknown, not quiet, and sinks to the
bottom in BOTH sort directions. An ungraded storm cannot be claimed for a
category chip. Three of the fourteen mutations run against
`tools/test-wall-filter.mjs` survived the first pass and all three were breaches
of exactly this rule — including one JavaScript trap worth naming: `null > -1`
is TRUE, so dropping a `Number.isFinite` guard silently reports an ungraded
storm as a tropical depression.

**One scale covers the screen, and 31 storms set it.** 2005 and 2020 are the
widest seasons on record, so a strip has about 9.7 CSS pixels per storm on a
390px phone INCLUDING the gap. Aaron asked for bigger dots and wider gaps on
glass; they cannot both be had, because exceeding that budget means clipping
2005, and the wall lying about its longest row defeats the screen. Room was
found by trimming the year and count columns instead, and the glow does the
rest. **If it is still too small, the next lever is letting the busiest rows be
denser than the others, which costs the row-to-row comparison — a product call,
not a technical one.**

**The dots are elements, not SVG.** They have to glow the way the live storm
list's do, that glow is `box-shadow` off `--dot-glow-blur`, and `box-shadow`
does not apply to an SVG circle. The alternatives were a filter per row — 175
filter passes down a scroll — or a faked halo, which would be a second
definition of a glow. Same construction as the live list, one rule, one place.

**The size is corrected after layout, never guessed.** It is a custom property
on the drawer BODY, so a correction costs two style writes rather than 175 rows
of markup, and it is on the body rather than on `.wall` because the pinned live
row sits outside that container and would otherwise draw at a different size.

**A storm that came ashore carries a triangle under its dot, and it is an
attribute on the dot rather than a second element.** 1,343 of the 3,266 storms
in the archive are flagged, so a span apiece would be 1,343 extra nodes down a
175-row scroll. A `::after` on the dot cannot drift from the dot it belongs to,
because it IS the dot — no second coordinate system and nothing to re-measure
when `dotSizeFor` rescales the strip. It is `clip-path` rather than the border
trick, which needs three widths held in step and draws a box whose width and
height argue every time the dot resizes.

**It is neutral ink, not the storm's colour.** Coming ashore is a fact about
land; strength is what the dot already says. Tinted by category it became a
dimmer second copy of the dot sitting directly under the dot, which reads as a
smudge rather than as a mark.

**The mark is sized off the dot and it moves no row.** Both ratios are the
mockup's — a little under three-quarters of the dot wide, and a little under
three-quarters of that tall — because `--wall-dot` ranges from 4px to 14px and a
fixed size would be a speck against one and wider than the other. Floors at 3px
and 2.5px, because at `wallDotMin` the arithmetic gives 2.88 by 2.07 and below
about 3px a triangle stops reading as a triangle. The `::after` is out of flow,
so a year with sixteen landfalls is exactly as tall as a year with none; the
wall is a comparison BETWEEN rows and a row growing to fit its own marks would
break that on the years most worth comparing. The strip's padding is a `max()`
of the glow and the triangle, because the glow needs more room at small dot
sizes and the triangle needs more at large ones — at `wallDotMax` it reaches
9.8px against the glow's 8px — and the slot clips whatever does not fit.

**The strip is `aria-hidden`, so the row's spoken sentence carries the count.**
It names how many came ashore, and it says *"none came ashore"* out loud on a
year where none did. A sentence that mentions landfalls only when there were
some cannot be told from one that never mentions them, and that is the §5
difference between a measured nought and an unanswered question — every settled
season has a computed answer (§57.7a), so nought here is a real measurement.

**Confirmed on glass 2026-08-28**, both the archive's triangles and the running
season's. Neutral ink and the mockup's proportions were right; nothing was sent
back.

**A suite can be green over a wall that claims every storm in 175 years came
ashore.** The mark shipped half-written — `data-lf` on every dot rather than on
the flagged ones — and all 72 assertions in `tools/test-seasons-wall.mjs` passed
over it, because not one of them read the strip's markup. The count is now
asserted in `tools/test-wall-filter.mjs` against `wall.json` itself, both
directions and both basins, so a moved coastline pin or a NOAA revision carries
both sides together instead of turning the test red on a correct rebuild.

**An asterisk marks the pre-satellite years, not a shaded band.** §57.36 called
for shading; at the contrast a sepia palette allows it was invisible on glass.
The mark survives any palette, a colour-blind reader, and — the reason it was
always the better answer — a sort that scatters the rows, which a contiguous
band cannot. The era line carries the key.

#### The season in progress is pinned above the record

**It cannot come from `wall.json` and this is not an oversight.** That file is
built from HURDAT2, the REVIEWED record, which does not hold the current year
until the following spring (§57.11). Removing the year dropdown while landing
on a wall whose newest row is last year would have left the season actually
happening unreachable — the regression this row exists to prevent.

So the browser builds one row from the live facade and pins it above the wall
with a rule underneath. **Ended storms get real dots; storms still running are
counted in words** — `2 active in the region` — which is §57.21c's rule in a
new place: a storm the live app is still drawing in colour is not part of the
past, and is not on the sepia globe either.

Two honesty flags ride with it, both load-bearing for step 4:

- `activeKnown` is false when the live feed has never answered. "Cannot ask" is
  not "nothing is running", so neither claim is made.
- `landfallsKnown` is **always** false. Measured on the real 2026 b-decks
  (§57.18b): the working best track carries no landfall marker, so a 0 there
  means "not recorded yet". **Step 4 must read this flag and draw nothing,
  rather than drawing the absence as a fact.**

The row says "in the region" rather than naming the basin. Naming it was the
fix for the row once reading as a lie — the Atlantic row said "nothing active
right now" while two Pacific storms were running — but spelling out `East and
Central Pacific` pushed the count off a phone's right edge. The basin switch
sits directly above the row and is the only thing "the region" can mean.

#### What left the board, and what the ladder cost

The 175-year `<select>` and the basin segments are gone from Season Details.
The step buttons stay: stepping to a neighbour is a different act from choosing
out of 175. `setSeason` and `setBasin` both LOAD now — they had one caller
between them before, a `?season=` link read before the index arrived.

**The entry camera flight moved to the wall**, because the board no longer
loads anything until a year is tapped.

**Reopening the drawer resumes the rung**, including a storm, with the rungs
below it rebuilt so Back still walks the ladder. The memory is fed by
`drawer.onChange` rather than by recording taps, and `restoreRung` reads a
SNAPSHOT taken before it navigates — its own first move would otherwise
overwrite what it is restoring. Both faults shipped once each and are held down
by `tools/seasons-rung-check.mjs`, a real-browser check kept precisely because
the node stand-in has no history stack and stayed green through both.

#### Still open on this screen

- **Filters and sort** (step 3), **the glow's landfall triangles and the
  honesty marks** (step 4). `filtered` is already threaded through the markup
  and the count column already carries both figures, so step 3 fills a slot.
- **The near-home slider.** §57.36 lists it among the wall's default controls.
  It is NOT free here the way it is inside a season (§57.19a): the wall never
  loads track data, so filtering 175 years by distance needs the whole-basin
  pass — 0.93 MB, and its cost on a phone has never been measured. **Do not
  build it into step 3 on the assumption it behaves like the board's.**

#### The three strings per rung

| Rung | Opens from | Heading | Back says |
|---|---|---|---|
| **Past storms** (the wall) | the two existing doors (§57.16) | `Past storms` | closes to the globe |
| **Season Details** | tapping a year row | the year — `2005` | `Past storms` |
| **Storm Details** | tapping a storm in the roster | the storm's name | the year — `2005` |

**CORRECTED 2026-08-26: the reader never sees the word `Seasons`.** The table
above said `Seasons` in three places and §57.16a says every on-screen string
for this feature reads `Past storms`. Two names for one thing on a phone is
what that rule exists to prevent, so the on-screen name wins and `Seasons`
survives only as the name of the SECTION, never as a string. The entry column
is corrected too — see §57.37.

**Each back control names the DESTINATION, never the word "Back".** Rung 3's
back says `2005` because that is where the tap lands, not `Season Details`,
which is a label for a kind of screen rather than the screen being returned to.

#### ==> 41% OF THE ARCHIVE HAS NO NAME, AND THE THIRD RUNG'S HEADING IS BUILT ON ONE. <==

Measured across both basins: **3,266 storms, 1,915 named, 1,351 unnamed — 41%.**
Naming did not begin until 1950, so nearly every storm before then is a blank.

`Storm Details (name)` is therefore a heading with no value for two of every
five storms in the archive, and the default failure is that it renders empty or
prints `undefined` — §5's fabrication rule and its silence rule at once. The
rung needs a stated fallback before it is built:

- **A storm with an alias uses it.** §57.14's list is exactly this — Galveston
  1900, the Labor Day hurricane of 1935. These are the famous ones, and they
  are the ones most likely to be opened.
- **Everything else needs a constructed heading**, not a blank. Something built
  from what the record does hold — the year and the month it formed, or its
  storm number within the season. `Unnamed · September 1899` is a real heading;
  an empty bar is a bug.

**The back label on rung 3 is unaffected** — it is the year, which every storm
has. Only the heading is exposed.

#### What rung 3 costs, and it is the expensive one

§57.17a measured a full Tier 2 storm at **7.7 MB, and 4.6 MB of that is two
geometry files** — forecast wind radii and the cone. Rungs 1 and 2 are cheap;
this one is not. Adding `Storm Details` to the ladder means deciding what a
storm detail actually loads, and "everything NHC published" is not the answer
at 7.7 MB a storm on a phone. **That is a separate decision and it is not made
here** — this section settles the NAME and the NAVIGATION only.

### 57.38a The way out, as built

Step 6. Everything here is on `main` and **confirmed on Aaron's phone and on
desktop, 2026-08-28**, with nothing sent back; §57.37 and §57.38 above are the
design and this is what shipping it taught.

**`seasons/pill.js` is a left chevron and the words `Live storms`, centred at
the top of the archive globe.** It names where the tap LANDS, not where the
reader is standing — Aaron's call, 2026-08-28, overruling a proposed
`Past storms · 2005 · Atlantic` that named the current place and left the
action unlabelled.

**It takes the back grammar rather than an X, and that was already settled
elsewhere in this app.** `ui/drawer.js` puts a chevron plus the destination in
words on every back control, because a bare `‹` was indistinguishable from the
storm stepper's chevron on glass (2026-08-12) and because an icon cannot answer
*back to what*. An X means dismiss, and a reader who presses one expecting to
leave and finds themselves still in 2005 has been told the wrong thing by the
icon. The chevron's path is read out of `ui/drawer.js` by
`tools/test-seasons-pill.mjs` rather than restated, so the two cannot become
two slightly different arrows.

**`Live storms` mirrors `Past storms` deliberately** — that is the word on both
doors into the archive and in the drawer's own heading, so the pair reads as
one axis. The visible words name the destination; `aria-label` carries *back*,
which the chevron supplies for a sighted reader in less space than a word.

#### It is the only way out, and that is why it is a real button

`attachEscape` steps the drawer back and then closes it; **it never leaves the
archive**, and `leaveSeasons()` has no caller. So this one control is the whole
of the exit, and a pill wired to no handler is pixel-identical to a working one.
`tools/test-archive-mode.mjs` therefore leaves by PRESSING it rather than by
calling `leave()`, and every teardown assertion in that section rides on the
listener existing.

The bar's `Leave` button is gone with it. Two ways out is two things to keep in
step, and the bar is deleted at step 5 anyway.

#### ==> THE LAYOUT ATTRIBUTE MOVED, AND IT IS THE PART STEP 5 WOULD HAVE BROKEN. <==

`data-seasons="on"` was set and cleared inside `seasons/bar.js`'s
`mount`/`unmount`, which was only ever true by accident — the bar happened to
be the first archive furniture on screen. **Every rule it drives outlives the
bar:** the drawer's fixed `--seasons-sheet-h`, the three hidden cluster
buttons, the control cluster's offset, and the two suppressions below. It is
owned by `seasons/index.js` now, set before any furniture mounts and cleared
last on the way out. Step 5 deletes `seasons/bar.js` and none of that goes with
it.

#### Two live surfaces were still on screen in the archive

Found by audit rather than by glass, 2026-08-28. Both sit under the drawer at
its 66vh, so only a reader who minimised the sheet ever met them — which is
exactly the state the archive's chrome exists for.

- **`#storm-pill`** is the narrow-width entry to the LIVE storm list. It went
  on counting today's storms over a sepia globe, and a tap opened a list naming
  storms that were not drawn: the identical wrong surface `#btn-storms` was
  hidden to prevent, reached by a different control.

  **==> AND HIDING IT WAS THE CHEAP HALF OF THE FIX, WHICH §57.38 HAD ALREADY
  SAID. <== CORRECTED 2026-08-28.** That section's own resolution reads: the
  existing pill *stays at the bottom and goes on saying what is currently
  drawn*. Step 6 suppressed it instead and wrote the suppression up here as a
  clean win, without noticing it contradicted the design two sections above.
  **The diagnosis was right and the remedy was half of one.** Step 5 built the
  missing half; §57.38b is the account, and it also records why the element is
  a NEW one rather than the live pill repurposed.
- **`#status`** is source health — stale flags, *GDACS is not responding*.
  Suppressed per §57.37, because nothing in the archive reads a live feed, so
  every word it could say is about a world the reader is not looking at. **It
  is not §5 silence:** a season that will not load still speaks, through the
  board's own three states (`ui/seasons-board-loading.js`). It also sat in
  exactly the slot the archive's own pill occupies.

Both use `display: none` rather than a fade, for the reason the three buttons
already do: they have to leave the TAB ORDER too (§13). Both are written as
descendants of `html[data-seasons="on"]` — that is (1,1,1) against
`#storm-pill[data-hidden="true"]`'s (1,1,0), so it wins regardless of which
stylesheet loads first. A bare `#storm-pill` would tie and hand the answer to
source order.

#### What it is styled by, and the two comments it inherited

The pill is styled by its **id**, the way `#storm-pill` is, because it needs to
outrank a bare id rule and to sit above the drawer (30) and the control cluster
(40). A class beside the id would be a second name with no rule behind it, and
`tools/css-orphan-check.mjs` caught exactly that in the first version.

Its centring is `ui/panels.css`'s, copied rather than re-derived: a fixed
element given `left` alone is silently capped at half the screen, and one given
`left` AND `right` stops growing to its contents. That comment is the record of
two glass faults and this pill has the same shape.

#### Eleven mutations, eleven killed

Including the three that would have shipped something that looked right: a pill
with no click listener, a pill reading `Past storms`, and the layout attribute
never cleared on the way out. The chevron-match, the `aria-label`'s *back*, and
`<button>` versus `<div>` were each verified to bite.

**`tools/seasons-smoke.mjs` fails six assertions in the cloud sandbox and did
so before this change** — 20 passing on clean `main`, 25 passing with the pill.
All six are *does a track actually draw*, which needs `tiles.openfreemap.org`;
it is blocked, MapLibre never finishes building, and the geometry never lands.
They pass on the CI runner. **Do not chase them here.**

### 57.38b The bar is gone, and its two jobs are two pills — as built

Step 5. Everything here is on `main`. §57.37 and §57.38 are the design; this is
what shipping it taught. **Not yet confirmed on glass.**

#### What was deleted

`seasons/bar.js`, its five rule blocks in `seasons/seasons.css`, the dead
`.seasons-leave` rules step 6 orphaned when it removed that button, and
`--seasons-bar-h` with all three of its consumers.

**The layout variable was the real content of this step.** `#seasons-bar` was
`position: fixed` to the bottom edge and full width, and the drawer and the
control cluster are fixed to that same edge — so both had to be pushed up by
its height or they sat on top of it. Three rules did that subtraction: the
cluster's offset, the narrow drawer's `bottom`, and the wide rail's
`calc(keyboard-inset + bar)`. All four are gone, the cluster sits where the
live app puts it, and **that strip of screen is the globe's again on every
archive view** — which on a phone was the whole argument for the change.

Measured before the work: five references, all inside `seasons/seasons.css`.
Nothing outside that file subtracted from it and nothing read it through
`getComputedStyle`, so the unwind was smaller than §57.37 feared.

#### The bottom pill is a NEW element, and that is a correction to §57.38

§57.38 says the existing `#storm-pill` should stay and change what it says. **It
cannot.** `ui/view-storms.js` rewrites that element's text, its busy state and
its error tone **on every poll, open drawer or not** — its own comment says the
pill updates whether or not the view is on screen. Sharing it would mean the
archive inheriting `data-tone="error"` because GDACS is down: a red pill about
today, under 1935's tracks. That is the §5 confusion step 6 was right to
remove, arriving by a different road.

So `#storm-pill` stays suppressed and `seasons/status-pill.js` is a second
element. §57.38 already made this argument once, for the top pill — one element
cannot be in two places saying two things — and it applies again to one element
saying two things at two different times with two different writers.

**It carries `pillDetail`, which is the deleted bar's `barDetail` unchanged.**
Same four states, same words. The sentence was always meant to end up in a
bottom pill; the bar was just the surface that existed first.

**It mounts hidden and stays hidden until it has a fact.** Not §5 silence: the
only moment it is empty is before the index has been read, and the drawer is
open on top of it saying so in its own words. An empty glass lozenge is a
control with no label, which is worse than no control.

**Muted rather than primary, and that is the one deliberate difference from the
pill above it.** This is a caption; the top pill is the only way out. Equal
weight would make the eye choose between them, and the one that must never be
missed would lose half the time.

#### Pressing it toggles the drawer, and `btn-storms` is the same action

The pill inherits the bar's sentence-is-a-button behaviour, including that it
**toggles** rather than opens — Aaron on glass 2026-08-25, after the open-only
version turned out to be a one-way door.

**`#btn-storms` is visible in the archive again, doing a different job.** It was
hidden with Home and Layers because it opened the LIVE storm list over a sepia
globe (§5). It now reopens the archive's own drawer, so the surface it opens is
about the world on screen and the objection is answered rather than dodged.
Home and Layers stay hidden; neither has an archive equivalent to be given.

**==> THE TWO ARE THE NARROW AND WIDE HALVES OF ONE ACTION, NOT TWO CONTROLS.
<==** The pill is `display: none` above 720px, exactly as `#storm-pill` is, so
without the button a desktop reader who minimised the drawer would have no way
to get it back. Both roads call `session.toggleDrawer` through the exported
`reopenArchiveDrawer()`, so they cannot drift into two ideas of which rung the
reader left.

**`main.js` asks the archive first and returns early on a yes.** So the
function's `false` is the load-bearing half, not its `true`: a `true` out on the
live globe would swallow every ordinary press of that button, the storm list
would stop opening, and nothing on screen would say why. **A mutation proved
that hole was open** — making it answer true with no session left all 92
assertions green, and the assertion that closes it is in
`tools/test-archive-mode.mjs`.

#### The bad link's sentence went to the wall, not to the pill

`detailFor` still produces it; `ui/view-seasons-wall.js` shows it. The pill sits
UNDER the drawer — that is what makes it cost no layout — and entering the
archive opens the drawer on the wall, so a sentence down there would be covered
at the exact moment a bad link matters. It renders above every one of the wall's
states, because the link was wrong whether or not the archive answered and the
two failures are unrelated.

**It is passed as a GETTER, and a plain string was a real bug caught during the
build.** The wall is registered once per page load and outlives every visit, so
a string would have been the note from whichever visit was first: arrive on
`?season=1066`, leave, come back clean, and the wall would still be apologising
about a link from ten minutes ago. It reads `session.linkReason` at render time.
Same trap `home` and `system` are getters to avoid in the board (§57.19).

**The guard that suppressed the pill's own sentence on a bad link is deleted.**
It existed because the bar showed one thing at a time, so the season would have
painted over the apology. Two elements now, so the reader gets both facts and
suppressing either would be hiding a true thing for no reason.

#### What this step taught about the gates

**`tools/check-syntax.mjs` passed over an archive that threw on entry.** The
half-finished working tree this step started from assigned to an undeclared
variable and referenced a deleted import six times; the gate proves imports
resolve and cannot see a free variable. **This is the second recorded instance**
— §57.30 step 4's deep-link constants were the first, and that entry already
says the gate cannot catch the class. `tools/test-archive-mode.mjs` caught it,
by running the thing.

**`tools/css-orphan-check.mjs` reports emitted-classes-with-no-rule and not the
reverse.** `.seasons-leave` sat in the stylesheet for the whole of step 6 with
nothing emitting it. The gate went green throughout and only spoke when
`seasons/bar.js` was deleted and its classes became orphans in the direction it
does check.

#### The glass call this step finally makes real

§57.37 records that step 6 could not answer whether the archive still says
*where you are* with the drawer minimised, because `PAST STORMS` was still
sitting at the bottom left doing that job. **The bar is gone, so the question is
now live.** After this step the signals are the sepia palette, the drawer's own
heading while it is open, a top pill offering to take you to `Live storms`, and
a bottom pill reading `2005 · Atlantic · 3 shown`.

**The expectation is that the bottom pill answers it better than the bar did** —
a specific year and basin is a stronger statement of "you are in the past" than
the words `PAST STORMS` were. If it reads wrong the fix is words, not structure.

#### Four mutations, four killed

The pill removed from `TAP_BLOCKING_SELECTORS`; `reopenArchiveDrawer` answering
true with no session; the pill rendering an empty lozenge instead of hiding; and
the pill built as a `<div>` rather than a `<button>`. The second survived the
first pass and its assertion was written because of it.

### 57.38c What glass found in step 5, and the two reversals it caused

Aaron on his phone, 2026-08-28, on the first look at the deleted bar. Five
reports, of which one was not a fault.

#### The pill was invisible in the worst way: present and empty

It rendered as a bare capsule over the globe with no words in it.
`createSeasonsStatusPill` sets `el.hidden = true` and clears it in `setDetail`,
and that was correct and did nothing — **the browser's own `[hidden] { display:
none }` is a bare element selector and lost to `#seasons-status-pill`'s
`display: flex`.** Declared explicitly now.

**The rule this generalises to: an id rule that declares `display` owes a
`[hidden]` companion beside it**, or the element's `hidden` property is
decoration. Nothing in the repo catches this and the suite for it is
`tools/test-seasons-status-pill.mjs`, at the CSS text.

#### It painted through the open drawer

`#seasons-status-pill` and `#drawer` were both `z-index: 30` — a tie broken by
stylesheet order, and `seasons.css` loads after `panels.css`. **`#storm-pill`
carries 30 and never shows this**, because it sets `data-hidden` whenever the
drawer opens; the archive's pill has no such rule on purpose, since being there
when the sheet comes down is its whole job. It sits at **20** now, under the
drawer rather than beside it. Asserted as a range below 30, not as a literal.

#### It said nothing on the archive's first screen

Step 5 wired the BOARD's `onWhere` to the pill and not the WALL's, so the pill
was empty from entry until a year was opened — and entry lands on the wall
(§57.36). **The wall reports now, and it needed words of its own**: it draws
nothing on the globe, so `tick a storm to draw it` names a roster the reader
cannot see. `where.rung` tells the two apart and the wall's sentence is
`Atlantic · tap a year to open it`.

**==> BOTH HALVES WERE UNTESTED AND THE SUITE WAS GREEN. <==** The words did not
exist and nothing called them. The wiring half has no symptom a unit test can
see, so it is asserted bluntly — the shipped module is read and the wall's block
is required to touch the pill. Same instrument `tools/test-kv-keys.mjs` had to
grow when two relay routes were warmed and read by nobody (`SPEC-DATA.md`
§58.3), and the same lesson: **a reporter wired at one end only is invisible to
every test that drives the other end.**

#### The desktop pill is not a fault

Aaron reported not seeing it on desktop and then observed that `#storm-pill` has
never appeared there either. Correct on both counts and by design: the pill is
`display: none` above 720px, the drawer is a docked rail at that width, and
`#btn-storms` carries the reopen job (§57.38b). **Recorded so it is not
rediscovered as a bug.**

#### REVERSAL: the drawer header is a title and an X, on every view

**Aaron on glass, 2026-08-28, reversing §57.21b items 5 and 6.** The archive's
header had a minimise chevron instead of the X, a hover highlight across the
whole bar, and a press anywhere on it dismissed the sheet. All three are
deleted. `def.minimises`, `data-minimises`, the header click handler and the two
CSS rules are gone from the code rather than left unset.

**==> THE THREE COULD NOT BE SEPARATED, AND THAT IS THE ARGUMENT. <== The hover
was the mouse's affordance FOR the press-anywhere target.** Removing the
highlight and keeping the press leaves a surface that dismisses on a tap and
gives no sign that it will, which is precisely the hidden gesture §13 forbids.
So the report "stop highlighting on hover" is a request to delete the gesture,
not to hide it.

**AND THE ORIGINAL OBJECTION TO THE X HAS BEEN ANSWERED BY STEP 5.** §57.21b
argued an X reads as *leave*, and a reader who presses it expecting to leave and
finds themselves still in 2005 has been told the wrong thing by the icon. That
held while the sheet was the only archive furniture on screen. It does not now:
`‹ Live storms` sits at the top of the globe naming the exit, so the X can mean
what it means everywhere else. **The two decisions were correct in sequence —
the second became available only because the first shipped.**

#### A bug caught in the fix, not on glass

The wall's and the board's `onWhere` closures were written over `ensureBoard`'s
`statusPill` parameter. **That function runs once per page load and both views
outlive every visit, while the pill is rebuilt on each entry** — so from the
second visit onward every sentence would have been written into a detached
element, silently, since `setDetail` on an orphan throws nothing. Both read
`session.statusPill` now. Third instance of this trap in one feature, after
`home`/`system` (§57.19) and `linkNote` (§57.38b).

### 57.38d Both bottom pills, at every width

**Aaron, 2026-08-28.** The two pills were phone-only; they are not any more.

#### The rule that hid them had outlived its own reason

`#storm-pill` carried `display: none` above 720px, and the reason written beside
it was *"the rail is open by default and the Storms control reopens it"*.
**That premise is dead and has been for some time.** `main.js` opens nothing on
launch at any width — §16's first-launch sketch had the rail out on wide screens
and glass rejected it, because the globe is the product and a list over it on
arrival buries what the reader came for.

So a desktop visitor arrived at a globe with **no caption at all**, which is the
one job that pill has. The archive's pill then copied the hide from it at step 5
(§57.38b), inheriting a rule whose justification had already gone.

**Both are unhidden together**, because the pair is the point: same furniture,
same edge, and one appearing only on a phone was never a decision anybody made.
`#btn-storms` keeps the job it took at step 5 — it is a second road to the
drawer, not a replacement for the pill.

#### They centre on the WINDOW, the same as the pill at the top

**A version that centred them on the visible globe was built and rejected on
glass, 2026-08-28.** It shifted both right by half the rail when the rail was
out, on the reasoning that a viewport-centred pill sits inside a 340px rail at
the narrow end of desktop. Aaron's call is that a pill which MOVES when the
drawer opens reads worse than one that sits still, and that the bottom pills
should match `seasons/pill.js` at the top — which has always been plain
`left: 50%`.

**The machinery went with it rather than being left unused:** `--pill-shift`,
`--rail-w`, and `document.documentElement.dataset.drawer`. That last existed
only because `#storm-pill` sits before `#drawer` in the markup and CSS cannot
select backwards past a sibling — a problem that only arises if the pill needs
to know the rail is out, which it no longer does.

#### And the live pill stopped outranking the drawer

`#storm-pill` was `z-index: 30` against `#drawer`'s 30, later in the same file,
so it won the tie and painted OVER the sheet. **It never showed on a phone with
the storm list up, because that view hides the pill** — but Layers, Settings and
Home do not, and none of them was ever checked. Found while fixing the identical
fault on the archive's pill (§57.38c) rather than on glass. Both are at 20 now.

#### What is asserted

That neither pill is hidden on a wide screen, that both centre on the window,
and that the live pill sits under the drawer. The desktop hide reinstated and
the live pill back at 30 were each mutation-checked and each turns
`tools/test-seasons-status-pill.mjs` red.

### 57.39a The archive drawer's two lines — as built

**Aaron on glass, 2026-08-28, on 2020.** Two faults, one control.

The header read `2020`. One line under it, inside the scroller, a full-width
row read `−  2020  +` — a bordered box pinned to the sheet's left edge and
another pinned to the right. **The year was printed twice, one line apart, at
the same size**, and the two buttons sat directly beneath the drawer's Back
chevron and its close X. That second half is the layout `ui/storm-stepper.js`
was rebuilt to escape on 2026-08-12 and the consequence is the same and still
asymmetric: press `+` instead of X and you step a year, press X instead of `+`
and you are out of the panel.

**The shape is the live storm drawer's, which Aaron pointed at directly.**
`KARINA` in the header, `‹ 1 of 7 ›` on its own pinned line beneath it. The
archive now reads the same way:

```
Atlantic                     <- ui/drawer.js, from titleFor()
−     2005     +             <- ui/year-stepper.js, pinned
```

**The header gave way, not the picker.** §57.39 titled rung 3 with the year and
was right that four digits beat a generic noun — but the year has to be beside
the buttons that change it, so of the two lines the header is the one that can
say something else. The basin is a fact this drawer otherwise never stated
anywhere. **§57.39's ladder is unchanged**; what changed is which of a rung's
two lines carries the year.

**Pinned, not scrolled, and that is load-bearing.** The element is a sibling of
`.drawer-body` rather than its first child — `.drawer-view` is a flex column
and only the body flexes — so it holds still while a 31-row roster moves under
it. This is the one control on the screen a reader presses repeatedly, and
§57.21b item 1 already records what happens when it moves between presses.

**`−` and `+`, not chevrons.** The live stepper uses chevrons because nothing
sits beside it. Here the Back button's own `‹` is one line up; two of the same
glyph at the same size on adjacent lines is the mis-press fault returning by
proximity rather than by position.

**It is not `ui/storm-stepper.js` and must not be merged into it.** Three rules
differ: the live one WRAPS and this one STOPS at 1851 (a `−` press that landed
on 2026 would be a lie), the live one HIDES below two storms and this one never
hides, and its middle slot is the subject rather than a position. Eleven shared
lines of shape is a coincidence, not a component; merging would mean one file
with a `wrap` flag, a `hide` flag and two label modes.

**Built node by node rather than from an `innerHTML` string.** The three
elements persist anyway — the buttons survive their own activation, which is
what keeps keyboard focus on the button under the thumb across a step — so
parsing a string and querying it back out buys nothing and costs a dependency
on `querySelector`. `tools/test-archive-mode.mjs` drives the real archive
against a deliberately tiny element stub with no parser, and the first cut
threw there.

**It has its own click listener.** The board binds one delegated handler on
`#seasons-board-body`; this row is outside it by construction. The old
`[data-step]` branch in `ui/view-seasons-board.js` is deleted, not moved.

**What was measured, at 390×844, with the busiest season open.** Furniture
above the first storm name is 318px, and the breakdown reconciles: header 60,
stepper 45, scorecard 94, filters 42, gaps and padding 77. The sheet is
unchanged at 58.9vh for four names, so this is a legibility and safety fix
rather than a height saving — the earlier estimate of ~94px recovered was
wrong.

`tools/seasons-height-measure.mjs`'s breakdown had two dead selectors and was
silently attributing 164px to "gaps and padding". `.seasons-picker` no longer
exists and `segGroups[1]` had pointed past the end of a one-element list since
§57.36 deleted the basin segments. Both are fixed; that file's own reconcile
assertion is what caught it.

**AND THE HEADER SAT ON ITS FALLBACK UNTIL THE READER PRESSED `+`.** Aaron on
glass the same day, on the first build of this section. It read `Past storms`,
and stepping a year fixed it.

**Nothing was computing the wrong string.** `titleFor` is drawn ONCE, when the
drawer enters the view, and on that frame the index has not landed — so there
is no basin to name and the fallback is correct. What was missing is anybody
asking for the header again afterwards. `onIndexReady` redraws the BODY, and
the only thing that had ever refreshed the header was `onWhere` re-pushing the
view on a year change, which is why `+` appeared to fix it.

The board now takes the drawer's own `refreshChrome`, the same hook the home
dashboard and the storm panel take and for the same reason: a view cannot
redraw furniture it does not own. **It asks only when the answer changes**,
which is once a visit. That guard is what makes it safe to sit on the render
path at all — `render` runs on every poll, every filter change and every tick
of the roster, and rebuilding the header that often would throw away the Back
button and the X on a surface the reader may have focused. **The ceiling is
asserted beside the floor**, because the over-correction is the worse bug.

**No existing assertion could have caught this and the reason is worth
keeping.** Every one of them calls `titleFor()` after the index has settled,
which is a question about the STRING rather than about WHEN the header was
painted — and the string was right the whole time. The gate counts redraw
REQUESTS instead, which is the only observable that differs between a header
that catches up and one that does not.

**The gates.** `tools/test-seasons-board.mjs` asserts the stepper is a sibling
of the scroller and not a descendant, that the header names the basin, and that
no four-digit number appears in the header. All five were mutation-verified:
moving the row back inside the body, titling the header with the year, never
asking for a redraw, and asking on every render each turn it red.

`tools/markup-dom.mjs` gained `append`, `prepend`, and reflection for
`className` and `disabled`. Each was a real gap: the stand-in was answering
"no such element" and "not disabled" for a control that was working, which is
the fourth and fifth time that file has told that particular lie. **A selector
it cannot read is indistinguishable from an element that does not match**, so
anything it cannot see gets fixed there rather than worked around in the app.

### 57.39b The season scorecard counts storms, not coast crossings

**Aaron on glass, 2026-08-28.** The `Landfalls` cell on 2020 read `34`. Two
lines below it the roster said `All 18 storms shown` under the Landfalls
filter, and one screen away the Wall of Years said `18 of 31`.

**Both figures are real and neither was a bug.** Counted off
`seasons/data/atlantic-landfalls-02272026.json`, 2020 Atlantic is **18 storms
and 34 crossings** — Laura alone made 7, across Hispaniola, Cuba and Louisiana.
The cell was printing `score.landfalls` (crossings) while every other surface
in the feature printed the count of storms. **One word, three surfaces, two
meanings, and nothing on screen to say which question was being answered.**

**The app had already decided which question, and this cell had not heard.**
§57.7a: the wall carried a real crossing count for about a day and Aaron
reverted it on 2026-08-27, because counting crossings turns a season into a
ranking of archipelagos — 1933 topped the board at 41 while a year that
flattened the Gulf coast scored 6. A season's question is how many storms
reached land. How often one particular storm did is a fact about that storm,
and it is on the storm's own row and in its panel.

**So the cell reads `score.stormsWithLandfall`, which `lib/season-facts.js` has
computed since it was written and nothing had ever displayed.**

**And the label changed with it, because it had to.** `Landfalls: 18` would be
a worse lie than `Landfalls: 34` — the same word over a figure that no longer
counts landfalls at all. It reads `Came ashore`, which is the wall's own
wording for the same measurement, so the two screens agree in words as well as
in arithmetic.

**Unchanged:** the dash for a season still running (§5 — a figure the record
cannot support is never a zero, and the working best track carries no landfall
marker), and the `landfalls` filter, which has always selected storms rather
than crossings.

**The gate** asserts the cell against the roster the reader can count for
themselves rather than against a typed number, so arithmetic that drifts fails
it too. Switching the cell back to crossings turns
`tools/test-seasons-board.mjs` red (29 against 16 on the season it opens on).

---

### 57.40 Naming a place — as built

**Every spot the archive names carries its region and its country.** Aaron's
call, 2026-08-29: *"People need to know if you mean Bloomington Ohio or
Bloomington South Carolina. Or Turks and Caicos or Port-au-Prince."* A bare town
name is not a shorter answer, it is a wrong one.

`tools/gazetteer.mjs` is the whole of it. **Runner only**, in `tools/` for the
same reason `tools/land-raster.mjs` is: `lib/` ships to every visitor and
`tools/` does not. It loads 135,233 towns and 4,596 admin-1 polygons — about
58 MB — uses them, and throws them away. What reaches a phone is one short
string per landfall.

**The town list is the one the app already ships.** `all-the-cities`, a
packaging of GeoNames, is the same source `tools/build-population.mjs` builds
`assets/hazards/population-towns.json` from. That shipped file is stripped to
`[lon, lat, pop]` to save bytes; the names are still in the source. One source
means the place named beside a landfall and the dot on the population layer can
never disagree about where a town is.

**==> THE REGION IS LOOKED UP FROM THE TOWN, NOT FROM THE STORM'S POINT, AND
THAT IS THE ONE IDEA IN THIS FILE. <==** A landfall position sits exactly ON the
coastline by construction, and Natural Earth's admin-1 coast is drawn from a
different generalisation than the `ne_10m_land` outline the landfall walk
crosses. Measured 2026-08-29 over fifteen real landfalls:

| Point tested against admin-1 | Inside a polygon | Country code agreed |
|---|---|---|
| The landfall position | 9 of 15 | — |
| The nearest town | 15 of 15 | 15 of 15, zero disagreements |

A town is inland by definition, so it does not sit on the boundary that is in
dispute. Testing it instead is not a workaround; it is the correct question.

**Where the two sources disagree, neither wins.** GeoNames says which country a
town is in and Natural Earth says which polygon contains it. When those differ
the region is dropped and the country falls back to GeoNames' code. Two sources
agreeing is evidence; two sources disagreeing is not a tiebreak.

**Two caps, and they are different questions.** `SEASONS.placeNearKm` (60 km)
governs a landfall, which claims to be AT a place — beyond it the answer is no
name and the panel falls back to coordinates, because *"came ashore near
Nouakchott"* for a point 400 km down an empty coast reads as a fact and is not
one. `SEASONS.placeFarKm` (400 km) governs genesis and stalls, which only claim
a bearing and always print the distance alongside.

**Three assembly rules in `placeLabel`,** each of which is a bug one repetition
away:

1. A region equal to its country is said once — `Crane, Barbados`, never
   `Crane, Barbados, Barbados`.
2. A region equal to the town is dropped — `Maunabo, Puerto Rico`.
3. The country name comes from admin-0's `NAME_LONG`, not admin-1's `admin`.
   They are different fields with different jobs: `admin` is the sovereignty
   label and reads `United States of America`, `NAME_LONG` is the plain form and
   reads `United States`. This goes in a sentence, so the plain form wins.
   `NAME` is not used at all — it is abbreviated for map labels
   (`St. Vin. and Gren.`, `Dominican Rep.`) and those are label-box
   contractions, not words.

**`ISO_A2_EH` is asked before `ISO_A2`,** because Natural Earth answers `-99`
for France, Norway and a handful of others where the sovereignty question is
contested. `_EH` is the field that answers.

**The pin is imported from `tools/seasons-landfall.mjs`, not restated.** If the
two ever diverge a landfall can be computed against one coastline and named
against another.

**Measured answers, 2026-08-29** — every one independently correct against the
storm's own history:

| Point | Answer |
|---|---|
| Harvey's Texas landfall | Fulton, Texas, United States (11 km) |
| Harvey's Louisiana landfall | Cameron, Louisiana, United States (18 km) |
| Katrina's Louisiana landfall | Port Sulphur, Louisiana, United States (22 km) |
| Maria's Puerto Rico landfall | Maunabo, Puerto Rico (1 km) |
| Michael's Florida landfall | Tyndall Air Force Base, Florida, United States (9 km) |
| Wilma's Mexico landfall | Cozumel, Quintana Roo, Mexico (7 km) |
| Dorian's stall centre | High Rock, Bahamas (1 km) |

Load time is 4.4 seconds on the sandbox, once per run.

**`npm install all-the-cities` is required** and is the same ad-hoc dependency
`tools/build-population.mjs` already asks for. `.gitignore` already blocks the
root `package.json` and `node_modules/` it creates — verified clean on
2026-08-29, nothing leaked into the tree.

---

### 57.40a The places sidecar — as built

**`tools/seasons-places.mjs` writes `seasons/data/{basin}-places-{revision}.json`.**
Runner-only, like `seasons-landfall.mjs` and for the same reason: the gazetteer
is 58 MB and what ships is a few tens of kilobytes of strings.

**Per storm: the genesis place, one place per landfall in order, and the stall.**

```
{ "basin": "atlantic", "revision": "02272026",
  "gazetteer": "natural-earth-vector@v5.1.2 + all-the-cities",
  "nearKm": 60, "farKm": 400, "stallRadiusKm": 150, "stallMinHours": 48,
  "source": "computed",
  "storms": {
    "AL092017": {
      "landfalls": [ {"name":"Crane, Barbados","km":3}, … ],
      "stall": {"at":1503705600000,"hours":66,
                "name":"Bloomington, Texas, United States","km":9} } } }
```

**==> IT READS THE LANDFALL SIDECAR RATHER THAN RECOMPUTING LANDFALLS, AND THAT
IS WHAT MAKES THE INDEX ALIGNMENT A FACT RATHER THAN A HOPE. <==** The names are
joined to the marks by position on the phone. A second walk against a coastline
that had moved would produce a different list of a different length, and lining
the two up would put Cameron's name on a Florida landfall. Reading the file also
means this job needs no 119 MB mask and finishes in about a second per basin.
**The landfall sidecar is therefore REQUIRED**, not optional — without it every
landfall would come back unnamed, and the file would be indistinguishable from a
basin whose landfalls are all in open country. The job refuses rather than
writing that.

**==> A STORM ABSENT FROM `storms` MEANS "WE LOOKED AND FOUND NOTHING TO NAME",
NOT "WE DID NOT LOOK". <==** §5, and the same convention the landfall sidecar
already uses for a storm that stayed at sea. **The FILE being on screen is what
carries "this basin was walked."** `data/seasons.js` keeps the two apart at the
attach point: `storm.places` is `null` when the file did not arrive and `{}`
when it did and this storm had nothing inside the cap. `null` and `{}` reach
different sentences — see §57.41 — and collapsing them prints *"out over open
water"* under a storm that formed in the Gulf of Mexico on a day the file 404'd.

**==> THE STALL IS WRITTEN DOWN WHOLE RATHER THAN AS A NAME THE PHONE HAS TO
RE-EARN. <==** The runner is the only side that can look a name up, so the
obvious split is "runner names it, phone recomputes the window". That makes the
name belong to a window the phone derives independently, and a constant moved
without a new revision stamp would silently attach the right name to the wrong
three days with nothing noticing. A self-contained answer cannot drift.
`lib/season-story.js` still owns the algorithm and the season in progress still
runs it on the device, so there is one implementation either way.

**==> LONGITUDE IS WRAPPED AT THE DOOR. <==** The archive stores `lonU`
unwrapped so a track crossing the date line is one line rather than two, and
`lib/landfall.js` writes that same value into every mark. A Marshall Islands
landfall therefore arrives at 187°. Handed to a town index keyed on real
longitude that is a point in the Atlantic, and the answer would be a confident
wrong name rather than no name at all. `wrapLon` returns an in-range value
untouched rather than passing it through the modulo, which turns 179.9 into
179.89999999999998.

**Measured, 2026-08-29, over the whole shipped archive:**

| | |
|---|---|
| Storms walked | 3,266 |
| Storms carrying at least one name | 2,080 |
| Landfalls named, at the 60 km cap | **2,313 of 2,537 — 91.2%** |
| Stalls named, at the 400 km cap | 224 of 433 |
| Atlantic file | 234 KB raw, **38.5 KB gzipped** |
| East Pacific file | 57 KB raw, **8.8 KB gzipped** |
| Runner time | 3.1 s to load the gazetteer, then 0.7 s and 0.3 s to walk |

**==> IT IS THREE TIMES THE SIZE §57.42 ESTIMATED, AND THE ESTIMATE WAS COUNTING
THE WRONG THING. <==** That figure — 12 to 15 KB gzipped — counted the 2,537
landfall marks. It did not count the genesis place on every one of 3,266 storms,
which is the clause §57.41 never drops. **The file rides in the same
`Promise.all` as the season text** rather than arriving late, because the archive
panel paints instantly and completely today and a paragraph appearing a beat
afterwards would make the whole panel twitch. **If that cost is ever judged too
high, the lever is deferring this one fetch until a storm panel opens** —
nothing on the roster, the wall or the globe reads it.

**`seasons/data/*` is a wildcard in `_headers`, so this inherits `immutable` and
needs no hand-written line.** The revision stamp is in the filename, which is
what makes that safe.

**==> THE `Landfalls` SECTION READS THE SIDECAR TOO, AND IT DID NOT ON THE DAY
THE SIDECAR SHIPPED. <==** Aaron on glass, 2026-08-29: the panel still read
`29.3°N 89.6°W` under Katrina's Louisiana landfall after this job had already
worked out it was Port Sulphur. The paragraph had the names and the list did
not. Each landfall now leads with its place, with the UTC stamp and the
coordinates demoted under it — **the name does not REPLACE the coordinates**,
because those are exact and are what the record holds, while a name 22 km away
is an orientation rather than a position.

**The alignment guard is the same one the paragraph uses**: a length check plus
`landfallSource === 'computed'`. Two lists that happen to be the same size are
still two lists, so NOAA-sourced landfalls get no names even when the counts
match. A landfall with no town inside `placeNearKm` simply has no place line,
and the timestamp demotes on every row either way — a rule that only applied
when a name was present would set two landfalls in one list at two different
sizes, which reads as a fault rather than as a hierarchy.

**`tools/test-seasons-places.mjs` is the gate**, 49 assertions. The gazetteer
itself is not driven — it loads 58 MB over the network, which is a runner's job
and not a suite's — so a stub records every question it was asked and the
assertions are about the QUESTIONS: which point, at which cap, with the
longitude wrapped. Six mutations against the job and three against the attach
point were run and all nine bite.

---

### 57.41 The storm's life, in a paragraph — as built

**Aaron's ask, 2026-08-29:** a short paragraph at the top of the archive drawer
summarising the storm's life — *"almost like a summary of all the stats we will
present further down."*

**==> IT IS ASSEMBLED FROM THE NUMBERS. NO MODEL WRITES IT. <==** Every clause is
backed by a figure computed from the storm's own rows, and a clause with no
figure behind it is DROPPED rather than softened. That keeps it offline,
instant, and incapable of inventing a fact. A generated sentence in a hurricane
archive that turns out to be wrong is the all-clear-during-an-outage bug wearing
better prose.

**It sits directly under the honesty line and above `STRONGEST`.** Aaron's call.
The honesty line qualifies it, so nothing can be read before that sentence.

**Aaron's four calls on the voice, 2026-08-29:**

1. **Length is variable** — longer when the storm earns it. A six-sentence
   paragraph is the floor, not the target.
2. **The repetitive `It … It … It …` stays.** Varied templates are where
   assembled prose starts sounding written, and sounding written is how a reader
   stops checking it. Plain and slightly repetitive is the correct trade.
3. **The paragraph must know about its own edge cases and say so** — see the
   extratropical rule below.
4. **Placement** as above.

**The clause order,** each independently droppable:

| # | Clause | Dropped when |
|---|---|---|
| 1 | Where and when it was first seen | never — every storm has a first row |
| 2 | How long to hurricane strength | first fix was already ≥34 kt |
| 3 | Peak wind, date, category | no wind was ever recorded |
| 4 | Landfalls, and the hardest one | it never came ashore (said explicitly) |
| 5 | The stall | no window meets §57.41's threshold |
| 6 | How and when it ended, and lifespan | never |

**==> CLAUSE 2 IS ONLY MEANINGFUL WHEN WE WATCHED IT FORM. <==** The first
version reported dozens of 1851 storms tied at "0 hours to hurricane", because
their first record was ALREADY a hurricane. That is not a fast-forming storm; it
is a storm nobody saw until it was big — the same observational undercount
`seasonFacts.undercountLikely` flags at season level, at the size of one storm.
The clause is shown only when the first fix is below 34 kt, and the alternative
sentence is *"It was already a hurricane when it was first spotted, so nobody
saw it form."* Filtering drops the population from 3,204 storms to a set where
the number means something.

**The comparison clause** reads off `SEASONS.medianHoursToHurricane` (60,
measured over the mirrored archive) and fires only past 0.6× and 2× that figure.
Between those it says nothing, because "slightly above average" is not a fact
worth a reader's attention.

**==> THE STALL IS MEASURED FROM THE WINDOW'S OWN CENTRE, NOT FROM ITS FIRST
FIX. <==** This is the single most valuable line in the paragraph and the
obvious implementation misses it entirely. Harvey went inland near Rockport,
back out over the Gulf, and ashore again near Cameron; every one of those legs
breaks a window anchored on its own first point, so **the storm whose entire
reputation is that it stopped moving reported no stall at all.** Measured as the
longest window whose fixes all sit inside `SEASONS.stallRadiusKm` of their
centroid, it reports three days in the Victoria, Texas area. Dorian reports two
days at High Rock, Bahamas — which is the fact about Dorian.

**A stall with no town inside `placeFarKm` says "out over open water"** rather
than dropping the clause, because *"it barely moved for two days"* with no
anchor tells a reader nothing they can picture.

**==> THE EXTRATROPICAL LANDFALL RULE NEEDS ITS OWN SENTENCE, AND SANDY IS
WHY. <==** Aaron's call 3. This app does not count a landfall by a system that
has already gone extratropical — §57.7a, and it is the same rule
`agreementWithNoaa` reports separately. So Sandy 2012's Jamaica and Cuba
landfalls appear and **its New Jersey landfall does not**, because Sandy was
extratropical by then. Sandy's entire reputation is the New Jersey landfall. Its
absence will read as a bug to every reader who knows the storm, and a correct
rule that looks like a fault is worse than no rule. When a storm ends
extratropical AND has an `L` marker in NOAA's record that we declined, the
paragraph says so in plain words.

**Counts are words, not digits** — `came ashore four times`, not `4 times` —
and the singular case has its own sentence rather than reading `one times`.

**==> A NUMBER HARDCODED INTO PROSE WILL DRIFT FROM THE CONSTANT THAT PRODUCED
IT. <==** The prototype's stall sentence said `within 100 km` while
`stallRadiusKm` was 150. It read as a measurement and was a leftover. Every
figure in the paragraph interpolates its constant; none is typed.

**When some landfalls have a town inside the cap and some do not, the name list
is dropped entirely** and only the count and the hardest one are given. Andrew
1992 came ashore four times with three names available, and printing four
alongside three reads as a miscount.

**Where it lives:** `lib/season-story.js` — pure, no DOM, no network and no
clock, driven by `stormFacts` plus the storm's own fixes plus its entry from the
places sidecar. `storyHtml` in `ui/season-detail-markup.js` escapes the finished
sentences and puts them in one `<p class="season-story">`; it assembles nothing
itself, so there is one author for the paragraph. `ui/view-season-detail.js`
draws it between `headHtml` and the first section, which is directly under the
honesty line and above `Strongest`.

**It is SHIPPED code, unlike §57.40's gazetteer.** The season in progress has no
runner pass at all, so the phone assembles that storm's paragraph itself — every
clause except the ones that need a name.

**==> IT IS NOT A `section()`, AND THAT IS THE ONE STRUCTURAL DECISION HERE.
<==** Every collapsible section on this panel can be folded away. A paragraph
that summarises the whole record must not be something a reader can fold and
then read the figures without.

**==> THE PARAGRAPH REBUILDS ON EVERY RENDER RATHER THAN BEING CACHED WITH THE
FACTS. <==** `stormFacts` is stable forever and is computed once when the board
loads a season; this reads mph or km/h and would go stale the moment somebody
changed the units setting. It is a handful of string joins over one storm, and
both its inputs already hang off the storm the board is holding, so nothing is
fetched to draw it.

**Real output, 2026-08-29, off the shipped archive files:**

> HARVEY was first seen on August 16, 2017, out over open water. It reached
> hurricane strength 9 days later, far longer than a storm usually takes. It
> peaked at 132 mph on August 26, a Category 4. It came ashore four times:
> Crane, Barbados; Biabou, Saint George, Saint Vincent and the Grenadines;
> Fulton, Texas, United States; and Cameron, Louisiana, United States. The
> hardest was near Fulton on August 26, a Category 4. It barely moved for
> 3 days, staying within about 90 mi of Bloomington, Texas, United States. It
> lost its tropical structure on September 2, 17 days after it was first seen.

**==> TWO FIGURES IN THE ACCEPTED PROTOTYPE DO NOT REPRODUCE, AND BOTH TIMES
THE PROTOTYPE WAS THE ONE THAT WAS WRONG. <==** It named Harvey's Texas landfall
`Seadrift`; the computed landfall names `Fulton, Texas, United States` at 11 km,
which is what §57.40's own hand-checked table says. And it said Andrew 1992 came
ashore four times with THREE names available — all four now resolve
(Dunmore Town, San Andros, Goulds, Patterson). The partial-list rule below still
stands and is still tested; Andrew is no longer an example of it.

**==> NO CLAUSE USES AN EM DASH, AND THAT IS A GUARD RATHER THAN TYPOGRAPHY.
<==** `lib/units.js` returns a bare `—` as its MISSING sentinel, so a paragraph
containing one is the cheapest available signal that a figure failed to resolve
and was printed anyway. `tools/test-season-story.mjs` bans the character across
every fixture, and that guard only works if nothing here uses one decoratively.
The comparison clause takes a comma; the landfall roll-call takes a colon and
gives the hardest one its own sentence. **Both of those read fine with a dash
and the dash was removed anyway** — the first version of this clause shipped
one, it was spotted in a browser rather than by the suite, and the choice was
between weakening the guard and rewording. The wording lost nothing.

**The hardest landfall is named by its town alone when the roll-call above it
already spelled the place out**, and by its full `town, region, country` label
when there is no roll-call — the partly named case, where that mention is the
only one. §57.40 forbids an AMBIGUOUS name, not a repeated one.

**Durations are digits; counts are words.** `four times`, `3 days`. A duration
is a measurement a reader may compare against another storm, and "twelve days"
beside "22 days" makes two facts of the same kind look like two different kinds.
Anything under 36 hours reads in hours, so a day is never printed singular.

**The stall radius is rounded before it is printed.** `stallRadiusKm` is 150 — a
chosen bound, not something anybody counted — and converted straight it reads
`93 mi`, which looks like the answer to a question rather than the edge of a box.
It prints as `about 90 mi`, still interpolated from the constant.

**`tools/test-season-story.mjs` is the gate**, 74 assertions. Twelve mutations
were run against it and every one bites, including the two that matter:
measuring the stall from a window's first fix instead of its centroid, and
breaking out of the search at the first burst window instead of continuing past
it.

**Confirmed rendering in a real browser 2026-08-29**, at 390px and at desktop
width: the paragraph draws between `.season-honesty` and the `Strongest`
section, with the place names from the sidecar in it and no horizontal
overflow. That is a wiring check and not a glass one — whether it READS well is
Aaron's, and it has not been seen on a phone.

---

### 57.42 The archive backlog — Tier 1 and Tier 2, each buildable alone

**Aaron asked for all of this on 2026-08-29 and asked that it be written down so
nothing is lost between chats.** Every item below is sized, has its cost
measured or its measurement named, and can be picked up cold. **Nothing here is
started.** Take one, build it, delete its entry, and write what IS in its place.

**The order below is not a priority order.** Aaron picks.

**TIER 1 — FREE. Arithmetic on rows `lib/hurdat.js` already parses.**

No new data, no runner job, no bytes on the phone. All of these land in
`lib/season-facts.js` and `ui/season-detail-markup.js`.

| # | Fact | Note |
|---|---|---|
| 1 | **Distance travelled** | sum of great-circle legs. `distanceNm` in `lib/season-facts.js` already exists for item 2 |
| 4 | **The comeback** | dropped below 34 kt and returned to 64 kt |
| 5 | **The loop** | the track crosses itself. Jeanne 2004 did a full circle |
| 6 | **Out of season** | formed before Jun 1 or after Nov 30 |
| 7 | **Northernmost / southernmost reach, and where it died** | lands in `How it moved` beside item 2 |
| 8 | **Cape Verde or home-grown** | genesis east of 30°W and south of 20°N. Changes how a reader reads the whole track |
| 10 | **How many other storms were running the same day** | lands in `In its season` beside item 9 |

**==> ITEMS 2, 3 AND 9 ARE BUILT. §57.43 IS THE AS-BUILT ACCOUNT. <==** Forward
speed, the weakening before the coast, and the rank within the season. Their
rows are deleted from the table above rather than ticked, per this file's own
rule — **the numbers stay as permanent addresses and nothing renumbers.** Two of
the remaining seven now have a home named for them, which is the one thing that
pass changed about the rest of this list.

**Item 11 — archive-wide rankings — is the research feature and is worth its own
pass.** Every figure in the drawer carries its rank: *"937 mb — 41st lowest of
3,266 storms on record."* And the inverse: *"Only 34 storms since 1851 have gone
from tropical storm to Category 4 in 24 hours. This is one."* Nobody else puts
this on a phone.

**==> AND THE COUNT THAT BLOCKED IT HAS BEEN EXPLAINED. <==** A scratch walk on
2026-08-29 visited **6,532 storm entries against 3,266 unique ids**, an exact 2×
that stopped the pass before it started. The cause is the directory, not the
data: **`seasons/data/` holds the per-season slices AND the two whole-basin
`hurdat2-*.txt` files**, so a glob over `*.txt` reads every storm twice. Counted
2026-08-29: per-season headers 3,266, whole-basin headers 3,266, both together
6,532. Both sets agree with `seasons/reports.json`.

**So the denominator is sound and this item is unblocked** — the walk simply has
to pick one set. The whole-basin files are the right one for an archive-wide
pass, since they are what §57.35 FIX 12 kept for exactly this kind of reader.
Do not quote a count taken over `seasons/data/*.txt` unfiltered.

The ranking table itself is a runner artifact — a few KB of thresholds per
statistic, not the storms — so the phone compares against a small file rather
than loading the archive.

**TIER 2 — ONE RUNNER JOB EACH. Heavy data stays on the runner.**

The pattern §57.7a already established: 119 MB of mask on a runner, a small JSON
on the phone.

**1. The places sidecar — BUILT. §57.40a is the as-built account.**

**2. People in the path.** `lib/population-count.js` already counts towns inside
a polygon. Run it against each storm's wind swath on the runner:
*"At least 4.1 million people lived inside the 64-knot footprint."*
**Two hard limits that must be on screen, not in a comment.** Wind radii do not
exist in HURDAT2 before **2004** — measured, first year with any radii is 2004 —
so this covers twenty years of a 175-year archive and everything older needs the
§57.25 rule 2 sentence saying why. And the town list is a known undercount
(about 3.04 bn against a real 8.1 bn), so the figure is `at least`, never a
census.

**3. Countries and states affected.** Every admin-1 unit the track passed within
100 km of, as a list. Uses §57.40's polygons. **Works for all 175 years**, unlike
item 2 — this is the one to build first of the three.

**4. Land area under hurricane-force wind.** Square miles. 2004+ only, same
cliff as item 2.

**5. Retired names.** Already wanted as a wall chip and blocked on a list that
does not exist in this repo (`NOW.md`, §57.36a). A runner job can fetch ~120
names once and ship them; `seasons/wall.json` already carries the storm names.
Unblocks the chip AND a drawer sentence: *"The name Harvey was retired after
this storm and will never be used again."*

**TIER 3 — DEATHS, DAMAGE, RAINFALL. NOT ACCEPTED. Read this before starting.**

**None of it is in HURDAT2.** The record holds position, wind, pressure and wind
radii. That is all.

The only authoritative source is NOAA's Tropical Cyclone Reports, and
`seasons/reports.json` already indexes them: **1,524 reports for 3,266 storms**,
47%, none before 1958. *(The comment in `ui/season-detail-markup.js` saying
"roughly a sixth" is wrong and should be corrected to 47% next time that file is
open.)*

They are **PDFs of human prose.** Extracting *"60.58 inches at Nederland,
Texas"* means parsing free text, which works most of the time and fails silently
the rest — and a silent failure here means the app states a wrong death toll.
That is the worst failure this app can have.

Three routes, and the recommendation is the third:

1. **Parse the PDFs.** Highest payoff, highest risk, several sessions, and
   nothing ships until a few hundred storms are hand-checked against source.
2. **A third-party database** (EM-DAT, Wikipedia). Faster, and it means shipping
   numbers we cannot defend from sources that disagree with each other. Against
   the rule the whole archive is built on.
3. **Curate the famous ones by hand.** Fifty or sixty storms — Galveston 1900,
   Labor Day 1935, Camille, Andrew, Katrina, Harvey, Maria, Ian — each a short
   paragraph and a figure with its NOAA report cited beside it. A hundred storms
   covers most of what anyone searches for; everything else gets the honest
   absence line the drawer already knows how to write. Incremental, defensible,
   and a storm can be added any time.

### 57.43 Speed, the coast, and the season — three Tier 1 facts, as built

**§57.42 Tier 1 items 2, 3 and 9, built 2026-08-29.** Arithmetic over rows
`lib/hurdat.js` already parses: no new data, no runner job, no bytes on the
phone. `lib/season-facts.js` computes, `ui/season-detail-markup.js` writes the
sentences, `ui/view-season-detail.js` mounts two new sections.

**==> EVERY FIGURE IN THIS SECTION WAS COUNTED OFF THE MIRRORED ARCHIVE, AND
THREE OF THEM CHANGED THE DESIGN. <==** They are recorded with the numbers
attached because each one is the reason a rule exists, and a rule with its
reason deleted is a rule the next session simplifies away.

#### The panel

| Section | What it says |
|---|---|
| `How it changed` | gains a sentence about the weakening before the coast, under the intensification rows |
| `How it moved` | **new.** Fastest and slowest forward speed, with a note about what is being averaged |
| `In its season` | **new.** Strength rank, lifespan rank, and the only-major sentence |

Katrina reads *"It had been a Category 5 before its hardest landfall and came
ashore a Category 3, 46 mph weaker."*, `Fastest 19 mph on Aug 30`,
`Slowest 6 mph on Aug 25`, and `3rd strongest of 31` /
`Tied 14th longest-lived of 31`. Every one of those was printed by the shipped
code against the real 2005 file before it was written here.

#### How much it weakened before the coast

`coastalWeakening` on `stormFacts`. Peak wind **at or before the hardest
landfall**, against the wind at that landfall, plus the Saffir-Simpson gap.

**==> THE ANCHOR IS THE PEAK BEFORE THAT LANDFALL, NEVER THE STORM'S OVERALL
PEAK, AND 17% OF THE ARCHIVE IS WHY. <==** Measured over both mirrored basins:
of **1,341 storms with a gradeable landfall, 226 reached their overall peak
AFTER it.** For those the overall peak describes a storm that went back out to
sea and got stronger, so subtracting it reports a weakening that never happened.
**Ophelia 2005 is the case in the suite:** she brushed land as a 25 kt
depression and only later reached 75 kt at sea. Anchored on her overall peak the
panel would announce a 50 kt collapse at a coast she touched as a depression —
fluent, wrong, and nothing about it inviting a second look.

**==> THE LANDFALL'S OWN WIND IS INSIDE THE WINDOW, AND LEAVING IT OUT PRODUCED
84 NEGATIVE WEAKENINGS. <==** `lib/landfall.js` interpolates the wind at the
coastline crossing between the two fixes either side and rounds it (§57.7a), so
a storm still strengthening as it hits can be marginally stronger at the coast
than at any fix at or before it. With the landfall in, the drop cannot be
negative by construction.

**==> AND THAT RULE WAS UNTESTABLE FROM ANY FIXTURE IN THE REPO. <==** Every
sample under `samples/seasons/` uses NOAA's own `L` markers, which sit ON a row
— so the landfall wind is always some fix's wind and the window contains it
whether or not anybody put it there. **A mutation removing the rule left the
whole suite green.** The case is driven directly instead, with a computed
landfall between a 60 kt fix and an 80 kt one. This is §12's failure caught by
mutation rather than by reading, and it is the second time in two passes that
`ui/season-detail-markup.js` has produced one.

**The landfall picked is the hardest one**, which is the same choice
`lib/season-story.js` makes. Two surfaces on one panel naming different
landfalls as the important one would read as a contradiction.

**A drop of zero is a real measurement and gets its own sentence.** 703 of those
1,341 storms came ashore at their strongest — the plurality, and the most
alarming thing the section can say. §57.25 bans a value cell reading `0`; it
does not ban the fact. A third wording exists for the case where wind was lost
but no category was (150 kt to 140 kt is still a Category 5 at the coast), since
naming the same category twice in one sentence reads as a misprint.

#### Fastest and slowest forward speed

`forwardSpeed` on `stormFacts`. Great-circle distance between consecutive fixes
over the time between them, in knots, through `formatSpeed`.

**==> SYNOPTIC ROWS ONLY, AND THE WALK BRIDGES THE OTHERS RATHER THAN TRIPPING
OVER THEM. <==** NOAA inserts extra records at landfalls and peaks, off the
six-hour clock — Ida's Louisiana landfall is stamped 1655Z. Measured:
**2,250 of 71,941 raw legs are shorter than six hours**, some as short as
thirty minutes, and every position in the file is rounded to 0.1° (about 6 nm).
Half an hour of travel divided by that rounding produced legs reading **49 kt on
storms that were crawling**. Walking the synoptic cyclone rows gives one clean
12:00 → 18:00 leg instead of a 4h55m and a 1h05m one.

**==> A GAP IS NOT A SLOW LEG. `SEASONS.trackSpeedMaxLegHours` IS 6. <==**
Bridging can join the two sides of a hole: **70,772 of the 70,841 bridged legs
are exactly six hours, and 63 of the other 69 run longer than a day**, because
the storm spent the middle of them as a wave or a low and nobody wrote synoptic
rows. AL062023 has a 228-hour one at 3.1 kt. Dividing that distance by that time
measures the record's silence, and it would become the "slowest" figure on
exactly the storms it is least true of. Longer legs are dropped, not divided.

**==> AND `SEASONS.trackSpeedFloorKt` IS 1 BECAUSE THE FILE'S OWN PRECISION SAYS
SO. <==** 0.1° over six hours is one knot, so anything under that is
indistinguishable from stationary. **185 of 3,234 storms have a slowest leg
under 1 kt and 100 come out at exactly zero** — those hundred would print
`Slowest 0 mph`, which is the dash §57.25 forbids wearing a number. Below the
floor the panel says *barely moving* and adds a sentence naming the precision.
Above it, that sentence does not appear, so it is not boilerplate.

**Non-cyclone fixes are excluded**, the same rule `stallWindow` and ACE already
apply: a remnant low sprinting northeast in the westerlies is the atmosphere
moving, not the storm.

**==> THE DATE LINE IS SAFE FOR FREE HERE, AND THAT IS MEASURED RATHER THAN
DESIGNED. <==** Haversine takes `sin(Δλ/2)`, which is periodic, so 359.1° of raw
longitude difference and 0.9° of real travel give the identical answer — checked
against Della (CP011957) at record 34, where passing the published `lon` instead
of `lonU` changes nothing to every decimal place. **The protection belongs to the
formula, not to the data**, so a later session swapping in flat-plane arithmetic
for speed would lose it silently. `lonU` is passed anyway and the suite asserts
Della's fastest leg stays sane, so that swap goes red.

**The note under the rows says what is being averaged.** These are means over a
six-hour leg, not top speeds, and a reader comparing against an advisory's
instantaneous *"moving NW at 12 mph"* is entitled to know which they have. Every
figure in it interpolates the constant that produced it.

#### Rank within its season

`rankInSeason(facts, allFacts)` — an exported function taking the season, not a
field on `stormFacts`.

**==> A RANK IS NOT A PROPERTY OF A STORM. <==** Katrina's peak wind is hers
forever; her being third strongest is a fact about 2005. `stormFacts` describes
a storm from its own rows and is stable forever, and folding a comparison in
would make a memoised fact depend on what else happened to be loaded. The view
computes it per render off `entries()`, for the same reason `entries` is a
function: a rank captured on first paint would go on describing last year's
roster under this year's heading.

**==> RANKS SHARE A PLACE, AND TIES ARE NOT AN EDGE CASE. <==** HURDAT2 writes
wind in five-knot steps, so seasons draw at the top constantly: **54 of 294
seasons have a tied strongest storm** and 12 have a tie for longest-lived.
Standard competition ranking — two storms tied at 4th are both 4th and the next
is 6th — with a `tied` count so the panel says *Tied strongest* rather than
putting the same outright claim on two different storms' panels. **An outright
winner reads `Strongest of 31`, not `1st strongest`**, because nobody says a
storm came first out of thirty-one.

**==> THE DENOMINATOR IS THE STORMS CARRYING THE FIGURE, AND 2005 CANNOT SHOW
IT. <==** Every storm in the mirrored archive has a peak wind, so a mutation
replacing the graded filter with the whole list left the suite green. The case
is real all the same — the season still running arrives from ATCF b-decks
(§57.11), where a fix can carry no wind at all — and counting an unmeasured
storm into "of 31" quietly makes every other rank a claim about a different set.
Driven directly.

**A one-storm season gets no ranking at all.** `1st strongest of 1` tells the
reader nothing while looking like it told them something, and **24 seasons in
the archive are that shape**.

**`onlyMajor` names one storm, not a season.** It checks the id, so a season with
one major does not put *"It was the only major hurricane of its season"* on the
other twenty storms in it. **67 seasons had exactly one major**; 2005 had seven.

#### What the gates are, and the one that was missing

`tools/test-season-facts.mjs` and `tools/test-season-detail.mjs`. **Sixteen
mutations were run and all sixteen bite.** Two of them found holes in tests that
had already been written and had already gone green — the interpolated-landfall
case above, and this one:

**==> DELETING THE ENTIRE `How it moved` SECTION FROM THE VIEW LEFT EVERY MARKUP
ASSERTION PASSING. <==** That is the `fastest24h` fault's exact shape (§57.42,
`ui/season-detail-markup.js`): markup that is correct, tested, and never called,
which ran unseen for a month across 175 years of storms until Aaron read a panel
on glass. **Testing a markup function proves the function; only mounting proves
the panel.** `test-season-detail.mjs` now mounts the drawer and asserts all three
figures reach the screen, and that assertion is the one that goes red for a
section nobody wired up.

#### Judged on glass, 2026-08-29

**Aaron: "all looks great."** Confirmed on a phone with nothing sent back: the
weakening sentence on Katrina, both new sections, and the panel at seven
sections.

**==> THE PLACEMENT IS SETTLED BY ACCEPTANCE AND SHOULD NOT BE REOPENED WITHOUT
NEW EVIDENCE. <==** Two new collapsible sections landing at once was the one
real risk in this pass and it was named in writing before glass rather than
discovered after. It reads as a research tool. `How it moved` and
`In its season` stay where they are, and §57.42 Tier 1 items 1, 7 and 10 land
in them rather than growing a third and fourth section.

**Three things were never seen, because no storm on screen could show them.**
They are not open questions, only unwitnessed branches — each has a driven test
and none is waiting on anybody:

1. **The `barely moving` value**, on one of the 100 storms slow enough to reach
   the floor.
2. **The precision sentence** that appears with it.
3. **The never-seen-twice line**, on one of the 32 storms with a single
   synoptic fix.

### 57.44 Where a storm stands in the whole archive — as built

**§57.42 Tier 1 item 11, built 2026-08-29.** Every figure on the archive's
storm panel now carries its place in the record: *"9th lowest in the Atlantic,
11th of 2,008 overall."* `tools/seasons-rankings.mjs` builds the table on a
runner, `lib/rankings.js` is shared by the runner and the phone,
`ui/season-rank-markup.js` writes the sentences, `ui/view-season-detail.js`
mounts one new section.

**==> EVERY FIGURE BELOW WAS COUNTED OFF THE MIRRORED ARCHIVE, AND FOUR OF THEM
CHANGED THE DESIGN. <==** They are recorded with their numbers attached because
each one is the reason a rule exists.

**THE FILE IS DISTINCT VALUES AND COUNTS, NOT STORMS.** A rank is "how many
storms are better than mine, plus one", and answering that needs only the
sorted distinct values and how many storms sit on each. **14,389 bytes raw,
3,846 gzipped** for all three scopes and six statistics — measured, not
estimated. It loads in the same `Promise.all` as the season text and `once()`
holds it for the session, so it is one round trip on the first year a reader
opens and free on the other 174.

**TWO SCOPES REACH THE PANEL AND THE BASIN LEADS.** Aaron's call. One basin is
one agency, one set of instruments and one span of coverage, so it is the
comparison that is honest without qualification; the cross-basin figure is the
one a reader actually wants and the one carrying the caveats, so it earns its
place but not the front of the sentence. A storm is never shown another basin's
rank.

**NOTHING ON SCREEN EVER SAYS "ON RECORD".** The set behind `overall` is two
NHC basins today and will be most of the planet after step 13. A reader who saw
*"3rd lowest on record"* this year and *"31st lowest on record"* next year,
about the same storm, would reasonably conclude the app broke. The count is in
the row and the membership is in the note, so both widen when the data does.

**THE DENOMINATORS, MEASURED 2026-08-29.** Each statistic is ranked only
against the storms that have it, which is why they differ:

| | Atlantic | East and Central Pacific | Overall |
|---|---|---|---|
| Storms | 2,004 | 1,262 | 3,266 |
| Peak wind | 2,004 | 1,262 | 3,266 |
| Lowest pressure | **1,254** | **754** | **2,008** |
| Lifespan | 2,004 | 1,262 | 3,266 |
| At major strength | 342 | 260 | 602 |
| ACE | 1,773 | 1,154 | 2,927 |
| Fastest 24 hours | 1,848 | 1,074 | 2,922 |

**Only 2,008 of 3,266 storms carry a pressure reading at all.** Ranking against
3,266 would be a claim about a set that does not exist, and it would be wrong
by a third.

**A RUNG IS THE NUMBER THE PANEL PRINTS, PRODUCED BY THE OPERATION THE PANEL
PRINTS IT WITH.** Two storms showing `12.4` must not show different ranks. The
first version quantized with `Math.round(v / step) * step`, which is the
obvious way and is **wrong for a decimal step**: `(6.55).toFixed(1)` is `6.5`
and `Math.round(6.55 / 0.1) * 0.1` is `6.6`. **Five real storms printed one ACE
and ranked at another** — the exact fault the rule was written to prevent,
arriving through the rule's own implementation. Each statistic now names its
renderer's rounding in `QUANTIZERS`, both sides call the same one, and the name
travels in the file so an older ladder still says how to read it.

**FOUR THINGS ARE NEVER RANKED, AND EACH REFUSAL IS A SENTENCE THE PANEL WOULD
OTHERWISE GET WRONG.**

1. **A storm from the season still running.** Its figures come off an
   operational b-deck NOAA has not reviewed and will move. The ladder would
   place it perfectly happily, because this morning's 968 mb is a value the
   archive holds, and the reader would get *"141st lowest"* printed in exactly
   the same voice as a figure from 1935. Refused in `rankStorm` rather than at
   the call site, because the roster and the wall are both obvious next readers.
2. **A storm that never reached major strength.** It did not come last at being
   one; it never was one. Ranking the 2,664 storms that never got there would
   make *"1,900th of 3,266"* the ordinary answer and say nothing.
3. **A weakening storm's best 24 hours.** A loss is not a slow gain.
4. **A value the ladder has never seen.** No rank rather than an interpolated
   one.

**A WIND RANK IS DECLINED IN ANY SCOPE THAT SAYS ITS WINDS ARE NOT COMPARABLE,
AND THIS IS THE ONE THING STEP 13 MUST NOT FORGET.** Both basins in the archive
today are NHC's, so every wind in this file is a one-minute sustained average
and `windComparable` is true everywhere. **IBTrACS carries twelve agencies'
separate opinions of the same storm (§57.31), and most of the world reports a
ten-minute average, which reads lower for the identical storm.** Mixed into one
ladder, every typhoon quietly sinks below hurricanes it actually beat. The flag
is written into the file rather than assumed by the reader, so the day a scope
carries mixed averaging periods it says so and the row simply does not appear
there. **Pressure is unaffected: a millibar is a millibar everywhere.**

**THE TWO RANK SECTIONS SIT ABOVE `Strongest`, AND EVERY SECTION FOLDS.**
Aaron's call, 2026-08-29, after seeing the panel on glass. The comparison comes
before the storm's own numbers, so a peak wind arrives already placed rather
than needing to be carried down the panel to a rank eight sections later.
**They moved together**: they answer one question at two sizes, and splitting
them leaves the wide one orphaned mid-panel with nothing leading into it.

**The fold is the live panel's mechanism, unchanged, and no CSS moved.**
`ui/panels.css` has styled `.detail-section-head` as a button since the live
panel was built — the 44px target, the chevron, the hover and the focus ring
are all already in it. **This panel had been rendering a `<div>` into that
recipe and getting only the type rules**, so its heads were unreachable by Tab
and did nothing on Enter. A real `<button>` buys all of it back for free.

**THE TWO RANK SECTIONS OPEN AND THE OTHER SEVEN FOLD.** Nine sections is more
than a phone shows, and a reader stepping through the archive wants to know
where a storm SITS before they want its arithmetic. Everything else is one tap
away with its heading still on screen, which is the difference between folded
and absent. **The constant is the OPEN list rather than the closed one**, so a
section added later defaults to folded — an unfamiliar section arriving already
open pushes eight known ones off the screen, and a closed list would have made
that the failure by omission.

**THE FOLDS PERSIST, exactly as the live panel's do.** The first version of
this pass did not, on the reasoning that an archive storm is opened, read and
left. **That reasoning is wrong and Aaron said so the same day:** a reader
stepping through 1851 to 2025 is doing the same thing over and over, and
re-folding seven sections on every storm is the tax it missed.

**They must also survive a RE-RENDER, and that is the silent half.** This panel
redraws when NOAA's report arrives a beat after it paints, so a fold living
only in the DOM would spring back under the reader a second after they made it
— **and only on the storms that have a report**, which is 47% of the archive
and the half nobody would think to test. `section()` reads the record on every
paint, which covers the redraw and the reload by the same road.

**THE KEYS ARE NAMESPACED `season:`, BECAUSE THE RECORD IS SHARED AND FLAT.**
`lib/section-state.js` owns one storage key, which is right — the parsing rules
and the private-mode failure behaviour should have one owner. But two panels
putting a bare `wind` in one flat record would fold each other's sections, and
it would read as the app forgetting a choice rather than as a collision. **No
id collides today**, and that is exactly the state in which a prefix is cheap:
added later it would also have to migrate whatever readers had already written.

**AND `lib/section-state.js`'s `hasChoice` IS WHAT MAKES A DEFAULT POSSIBLE AT
ALL.** "Never touched" and "deliberately opened" are both falsy and would
collapse into one answer if the record were read as a boolean, so a reader who
opened `Landfalls` would find it folded again on the next storm.

**EVERY HEADING CARRIES AN ICON, FROM `ui/section-icon.js` AND NOT A SECOND
SET.** Aaron's call. Five sections take a mark the app already owns, and the
match is by IDEA rather than by picture, which is that file's own rule:
`Strongest` takes the `gauge` the live panel's Vitals uses (peak wind and
lowest pressure are the same kind of figure), `Wind footprint` takes `wind`,
`Its life` takes the `clock` Home's Timeline uses because every row on it is a
time, `Landfalls` takes the `pin`, and `NOAA's report` takes the `doc` the live
Advisory uses — both being somebody else's document rather than our reading of
one.

**FOUR ARE NEW, AND THE TWO RANK SECTIONS ARE THE REASON THE SET HAD TO GROW.**
`In its season` and `Where it ranks` both say *"3rd strongest of N"* and the
only thing separating them is whether N is one year or 175 of them. **"One
name, one shape" would argue them into one glyph, and that is exactly the
arrangement that defeats the point** — icons are here for scanning, and two
adjacent headings wearing the same mark give the eye nothing. So the mark names
the SET instead: `calendar` for the season, `podium` for the ranking proper.
`trend` is an asymmetric rise-and-fall for `How it changed`, which is the
storm's intensity arc and covers both directions; `track` is a recurving path
with an arrow for `How it moved`, the one section about the track as a path
rather than a figure measured on it.

**ALL FOUR WERE DRAWN, RENDERED AND LOOKED AT RATHER THAN REASONED ABOUT, AND
THREE OF THEM CHANGED AS A RESULT.** Rendered at 64px and at the shipping 16px
against the rest of the set: `trend` and `track` were both up-and-right strokes
and read as near-duplicates in adjacent headings; `trend`'s first shape implied
only an increase; `podium`'s bars touched and blurred into one block at 16px.
A second attempt gave `trend` a baseline, which closed the shape into something
too near the `alert` warning triangle. **None of those three faults is visible
in the path data.**

**IT IS ONE SECTION RATHER THAN SIX RANKS GLUED ONTO SIX EXISTING ROWS.** The
scope sentence would otherwise have to be repeated six times or left off, and
it is the sentence that stops the whole thing being misread. `Lowest pressure`
would also become a row running to two lines on a 390px phone.

**NO ROW SAYS "TIED", AND SIX OF SIX DID BEFORE GLASS-ADJACENT INSPECTION.**
`seasonRankHtml` one section up marks ties and is right to: inside a 28-storm
season a shared place is unusual. Against 3,266 storms it is the norm — winds
are recorded in 5 kt steps and lifespans in whole hours, so Katrina's panel came
back with `Tied` on every row. A qualifier that fires everywhere qualifies
nothing and reads as hedging. The fact is stated once, in the note.

**THE PRE-SATELLITE SENTENCE IS ABOUT THE DENOMINATOR AND SAYS WHICH WAY IT
LEANS.** A pre-1966 storm is ranked against the storms somebody wrote down; the
ones that stayed at sea are missing from the count, so **its place would be
lower in a complete record, not higher.** Saying only "the record is thin"
leaves the reader unable to use the number, and calling the figure unreliable
would be wrong — it is an accurate rank in a smaller set.

**THE FILENAME IS DERIVED ON BOTH SIDES AND CARRIES EVERY CONTRIBUTING BASIN'S
REVISION.** `rankings-02272026.json` today. §57.40a's rule: two jobs must never
write one file, so `index.json` is not edited to name it. One basin's revision
cannot name a file spanning several, and the file is `immutable` for a year, so
a stamp that failed to move when NOAA revised one basin would leave a stale
ladder on every returning phone until 2027. Revised separately it becomes
`rankings-02272026-05142026.json`. `_headers` needs no edit: `/seasons/data/*`
already covers it and the stamp is the cache bust.

**LOSING THE TABLE COSTS THIS SECTION AND NOTHING ELSE.** It resolves to `null`
on a failed fetch, on a 200 carrying the wrong shape, and on an index with no
revision. The section simply does not draw. That is deliberate rather than a §5
silence: a rank is a comparison the app offers, not a fact about the storm, and
every figure it would have ranked is already on screen above with its own
units. Nothing wrong is left behind by its absence.

**THE COUNT THAT BLOCKED THIS ITEM IS NOW ASSERTED RATHER THAN REMEMBERED.**
`countsAgree` fails the build unless the per-season slices and the two
cumulative files report the same 3,266 storms. **And `cat`-ing the two
cumulative files together loses one:** the Atlantic file has no trailing
newline, so its last data row glues onto the East Pacific's first header and
EP011949 disappears, giving 3,265. Each file is read and parsed on its own.

**TWENTY-FOUR MUTATIONS WERE RUN AND FIVE SURVIVED THE FIRST PASS.** All five
are closed and the fixes are worth more than the count:

1. **`meetsFloor` and `countsAgree` were inline comparisons.** Both are guards
   whose condition is FALSE against the current archive — the thinnest ladder
   is 754 and the two counts agree — so deleting either changed not one byte of
   output and no assertion could see it. **A rule that cannot be caught being
   deleted is a rule that will be deleted.** Both are functions in
   `lib/rankings.js` now and are driven directly.
2. **Three wiring mutations survived because nothing drove the road between the
   library and the renderer.** A table that never arrives, or arrives under the
   wrong basin, fails silently rather than loudly. `tools/test-rankings.mjs`
   now drives `loadSeason` with a stubbed fetch and `createSeasonsBoardLoading`
   with stubbed facades.
3. **One survivor was the code being wrong, not the test.**
   `rankingsBasin = rankings ? basin : null` guarded nothing, because
   `rankStorm` bails on a missing table before it looks at the basin. Deleted
   rather than tested (§12, retire cleanly).

**THE CENTRAL ASSERTION IS A BRUTE-FORCE CROSS-CHECK AGAINST THE REAL ARCHIVE.**
A ladder written by hand in the suite would be the builder's arithmetic marking
its own homework. `tools/test-rankings.mjs` sorts all 3,266 storms the obvious
slow way and demands the shipped table agree, rank for rank and tie for tie,
across **14,991 ranks** — a figure the suite computes rather than carries. It
also checks the archive's published extremes: Patricia's 872 mb and 185 kt
first overall, Wilma's 882 mb first in the Atlantic and second overall.

**`ui/season-detail-markup.js` WENT OVER §12's CEILING AND THE CUT WAS TAKEN IN
THE SAME PASS.** It entered at 698 and reached 824. `NOW.md` records
`ui/view-seasons-board.js` crossing that ceiling on five consecutive passes with
the cut promised each time and taken later at a bigger size, so this one was
taken immediately: `ui/season-rank-markup.js` holds `ordinal`, `seasonRankHtml`
and `archiveRankHtml`, which are the only renderers on the panel that take a
comparison rather than a fact and the only ones needing `ordinal`. **651 and 202
lines, no behaviour change**, so a break can only be the move.

**THE PANEL NOW HAS NINE SECTIONS AND THAT IS THE RISK IN THIS PASS.** §57.43
put two on a panel that had seven and Aaron accepted the crowding as the thing
he was accepting; this adds a ninth. `SEASONS.rankingsMaxRows` exists so a
seventh statistic has to be a glass call rather than a free addition.
