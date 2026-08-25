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

### 57.7 The landfall gap — 1971–1982, not 1971–1990

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

**Decision unchanged, scope halved: we compute the missing landfalls ourselves**
by crossing the track against a coastline, and label them as ours rather than
NOAA's. Twelve Atlantic years, not twenty. A mark the app derived and a mark
NOAA published must be distinguishable in the data even if they draw
identically — `lib/season-facts.js` stamps every published mark `source:
'noaa'` from the first day so nothing has to be retrofitted.

**Do not re-derive this from the old table.** Re-run the count when NOAA
publishes a new revision; `tools/seasons-fixtures.mjs` does it in one job.

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
   3D rings), imagery, the 3D cage and the flood polygons. The poll keeps
   running behind it — stopping it would mean leaving into a stale app — but
   five gates stop it repainting any of them, and `show()` re-pushes from
   `lastFullState`, so **leaving lands on the current weather, not on the
   weather from the moment of entry.**
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

**Everything in §57.34's retention rules applies to a per-storm download too.** A
reader who opens twelve storms has twelve downloads on their device, and that
store needs the same eviction rule and the same Settings entry as a basin does.

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

Step 6a. `map/layers/season-tracks.js` (the line and its name),
`map/layers/season-marks.js` (landfall pins and one-record dots),
`map/layers/season-focus.js` (the one shared opacity rule), and the focus
state in `ui/view-seasons-board.js`. Numbers live in `ARCHIVE_GEO`
(`config/tokens.js`); the one new themed ink is `geo.landfallRing`.

**THE NAME IS SET ALONG THE TRACK BY MAPLIBRE, AND §57.21's POINTER AT
`name-placement.js` WAS WRONG.** That module solves a different problem —
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

**TICKING A STORM FOCUSES IT.** Aaron's call on the design, 2026-08-24. Focus
had to work by thumb, by mouse and by keyboard on the day it shipped (§13),
and the alternative — a second control on every roster row — is clutter on a
list that runs to forty rows. Reusing the tick means the keyboard path is the
checkbox that was already there and the touch path is the row that was already
44px. **The cost is real and is not hidden:** tick four storms in a row and
only the last is bright. `Show all evenly` is the way back, and it is present
in the markup but `hidden` until something is focused, so toggling it never
rebuilds the roster and it is not a tab stop while it means nothing.

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

**THE LANDFALL MARK'S FILL IS THE STRENGTH AT THE COAST, NOT THE STORM'S
PEAK.** The track carries peak; the pin carries what actually arrived. Katrina
peaked at Cat 5 over open water and came ashore in Louisiana at Cat 3, and a
magenta pin would be the app stating something false about the event it is
named after. `tools/test-season-marks.mjs` asserts this against her real
records. The RING is the one mark in Seasons wearing an ink that is not a
category colour, which is what makes it findable in a globe full of
Saffir-Simpson hues — and the ring colour and the fill sit on separate paint
properties, because one property holding both a themed colour and a feature
read is evaluated in the worker, never receives the global state, and resolves
to black without throwing (`map/theme-state.js` rule 1b).

**A ONE-RECORD STORM NOW DRAWS A DOT.** `season-tracks.js` needs two points to
make a line, so a single sighting from a passing ship — real, and common in
the 19th century — was ticked by the reader and did nothing at all. It gets a
small dot with no ring, so it can never be read as a landfall.

**PER-RECORD DOTS ALONG EVERY TRACK WERE CONSIDERED AND REJECTED.** 2005 has
28 storms averaging about 40 records each — over a thousand dots — and the
line already says where the storm went. That belongs to the detail panel
(step 7).

**WHAT IS NOT HERE:** the wind field and the wind swath, which are step 6b.
They are a different data question — HURDAT2 only records wind radii from
2004, so most of the archive gets §57.25's honest line rather than a shape.

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

Nothing downloads until asked. Per basin, on demand — tap Atlantic, get the
Atlantic file; tap West Pacific later, get that then. Nobody pays for oceans
they never open.

**==> AND A TIER 2 STORM IS ITS OWN DOWNLOAD, SEPARATE FROM ITS BASIN. <==**
Aaron's call, 2026-08-24 (§57.17a). A basin is tens of KB a season; one Tier 2
storm is ~5.4 MB on its own — a hundred times the weight of the season it sits
in. Bundling it with the basin would make downloading the Atlantic mean
downloading every director's cut in it.

So a storm's size stops being a curation question and becomes a per-storm wait,
which is **the reason nothing in §57.17a had to be trimmed except the coordinate
precision.** The forecast — cone, track, points, and the wind radii with them —
survives in full because nobody pays for a storm they do not open.

It needs the same three states everything else here does: a button that says
what it will cost, real progress while it runs, and a failure that says what
failed. **And the same retention rule** — §57.34 applies to a shelf of downloaded
storms exactly as it does to a basin, including the Settings entry. A reader who
opens a dozen storms has a dozen downloads, and a store without an expiry rule is
a store that will not get one.

**==> AND THE ORDINARY CASE DOES NOT GO THROUGH THIS GATE AT ALL. <==** Aaron's
call 2026-08-24, and it corrects what this section used to say. The old text
read *"the phone takes the whole file and parses it locally, rather than the
server slicing seasons on request"* — the reasoning being that a progress bar
for 30 KB is theatre. That is still true and it is an argument against the
progress bar, not against the slicing.

**The runner cuts each basin into one file per season** (§57.35 FIX 12,
`SPEC-OPS.md` §18.8). Opening 2005 fetches **14 KB over the wire and parses in
milliseconds**, with nothing downloaded, nothing stored and nothing to consent
to. Measured on the real bytes, not estimated.

**The phone still takes the whole file when it has a reason to**, and there are
two: a basin the reader wants to work with **no signal**, and step 9's
*"31 storms have passed within 100 miles since 1851"*, which is every season at
once and cannot be answered a year at a time. Both are genuine reasons to spend
somebody's megabytes, and both are things they asked for.

The practical effect is that the gate stops standing between a reader and the
feature. **Nobody pays anything to look around.** They pay when they ask for
the ocean in their pocket.

The screen: the app's own mark (`#mark-spiral`, `--mark-plate: transparent`)
turning on the `#boot-mark` animation — 2.4s, eased so it surges rather than
tracking at constant rate, counter-clockwise to match the spiral drawn for real
storms, with the reduced-motion breathe. Below it a progress bar that
**animates `scaleX`, never `width`**. Below that: what is being fetched, how
big, where it is stored, and that it is removable in Settings.

**A download that fails says so and offers a retry.** A stuck progress bar is
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
**Done when:** every figure has been hand-checked against one storm.

---

**STEP 8 — THE DOWNLOAD GATE, THE INDEX PASS, AND OFFLINE.**
**This step owns most of §57.35.** Worker-based parse-once, IndexedDB per season,
two-phase progress in consistent units, `navigator.storage.persist()`, the
eviction state, and the service worker NOT precaching the data.
§57.24, plus service-worker caching so a downloaded basin survives with no
signal. Includes the failure state, the Settings entry from §57.34 rule 5, and
**§57.34 rule 6 — the data cache must NOT be versioned with the app**, or every
deploy silently deletes the user's download.
**Aaron looks at:** the download on a phone, then **aeroplane mode**, then
opening a season he has never visited. Then a push to `main`, then aeroplane
mode again — the download must still be there.
**Done when:** it works with the radio off, and it survives a deploy.

---

**STEP 9 — NEAR HOME.**
§57.19's line-not-points measurement, computed at index time per §57.35 fault 2 —
**the slider filters precomputed numbers and never scans geometry.** Plus the standing line on the
Home dashboard.
**Done when:** a deliberately fast-moving storm that skips over the circle is
still caught — verified by a test that fails without the line measurement.

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

**STEP 14 — THE WALL OF YEARS.** §57.29. Optional, last, and only if the year
picker has proven to be the weak link.

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
data/seasons.js     fetch, cache, offline
map/layers/season-*.js   track, landfall marks, swath, ghosts
ui/view-seasons*.js      shelf, board, roster, detail
config/tokens.js         + the SEPIA palette                     BUILT (step 1)
config/constants.js      + a SEASONS block                       BUILT (step 2)
```

**Also built, and they are TOOLS rather than app code — nothing imports them:**
`tools/seasons-fixtures.mjs` with its workflow (cut real storms out of the full
NOAA files on a runner), and `tools/test-hurdat.mjs`,
`tools/test-season-facts.mjs`, `tools/test-near-home.mjs`.

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
Six places do. Two of them are easy to miss.

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

**5. ON DEVICE — A SETTINGS ENTRY WITH A REAL SIZE AND A REAL DELETE.**
*"Seasons data — 10.8 MB — Remove."* Actual bytes, not a guess. The download
screen already promises this is removable; that promise has to be somewhere the
user can find it later.

**6. ==> THE SEASONS DATA CACHE MUST NOT BE VERSIONED WITH THE APP. <==**
The easiest catastrophic mistake in this whole feature.

The service worker versions its caches and purges old ones on activate, which is
correct for application code. **If the downloaded seasons data lives in a cache
named the same way, every single deploy silently deletes the user's 11 MB
download** — and they discover it the next time they open Seasons on a plane,
which is exactly the moment the feature was built for.

The seasons data cache carries its own unversioned name, is excluded from the
purge sweep, and survives app updates. It is cleared by exactly two things: the
Settings action in rule 5, and the user clearing site data.

**7. Seasons writes nothing into live stores.** §57.2. It is listed again here
because the ended-storm store is the one place in this app that already grew a
record it should not have, and it grew it from a replay.

## 57.35 The pipeline, audited — parse once, precompute, never block

**Audited 2026-08-24 against three lenses: performance, front-end, cost.** The
first draft of this plan said "download the file, cache it, parse it." That is
three separate performance faults in one sentence. What follows replaces it.

**THE SHAPE, END TO END**

```
NOAA  --(runner, yearly, conditional GET)-->  repo, static asset
repo  --(one request, gzipped, our origin)-->  phone
phone --(ONE parse, in a Worker, at download time)--> IndexedDB, per season
IndexedDB --(one season, ~30 KB)--> the globe
```

Everything below is a rule that shape has to keep.

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

**==> ALL OF WHICH IS STILL TRUE, AND FIX 12 BELOW MEANS THE ORDINARY READER
NEVER REACHES IT. <==** Everything above applies to somebody downloading a
whole basin. Browsing a year goes through a per-season file instead — 14 KB,
milliseconds, no Worker and no store. The Worker pass is what step 8 builds for
the two cases that genuinely need the whole thing, rather than the toll gate on
the way in.

**FAULT 2 — THE NEAR-HOME SLIDER WOULD SCAN THE WHOLE ARCHIVE.**

§57.19 measures against the line between points, not the points. Correct — and
across 175 years that is roughly 2,000 storms and 80,000 segments. **Doing that
on a slider drag freezes the app on every pixel.**

**Precompute at index time.** During the same Worker pass as FAULT 1, store per
storm: **minimum distance to home, and the strength at that point.** The slider
then filters about 2,000 precomputed numbers, which is instant and stays instant.

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
will kill the tab for less. **One season in memory at a time**, read from
IndexedDB on entry and dropped on leave. The near-home index (FAULT 2) is the
one small thing allowed to stay resident, because it is a couple of thousand
numbers.

**FIX 8 — iOS EVICTS STORAGE, AND THE APP MUST NOT LIE ABOUT IT.**

Safari clears site storage for sites not visited in about a week. Installing to
the home screen helps and `navigator.storage.persist()` helps, and neither is a
guarantee.

**Request persistence, and handle the data being gone as a first-class state.**
Not an empty archive, not a spinner — a plain line saying the download was
cleared by the device, and the button to fetch it again. An archive that quietly
looks empty is exactly the silence §5 forbids.

**FIX 9 — THE SERVICE WORKER MUST NOT PRECACHE THE DATA.**

If it lands in the install-time precache list, **every visitor downloads
megabytes they never asked for** and the whole point of §57.24's gate is gone.
The data is fetched on request and cached on demand, in the unversioned cache
from §57.34 rule 6.

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

So FAULT 1's Worker, FAULT 2's precomputed index, FAULT 5's progress units and
FIX 8's eviction state all stop being prerequisites for looking at a year. They
remain exactly what step 8 and step 9 need for the whole-basin download, which
is not deleted — offline and near-home-since-1851 both genuinely want it.

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
