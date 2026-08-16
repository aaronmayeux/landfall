# SPEC-NEXT.md — approved, not built

**This is §46, §47 and §49 of the Landfall spec.** What is agreed and specified
but has not shipped. **§49 — the past on the home dashboard — is the one to
read first: it is the only section in this file fixing something the app gets
WRONG today rather than adding something it lacks, and one of its five passes
closes a safety-adjacent sentence.** §47 is now PART built: the SHIPS source (§47.2), the color's
meaning (§47.4), the coverage rules (§47.6), performance (§47.7) and the
fixtures (§47.10) describe live code, and every section whose subject is fully
built has left — **§47.5, the ribbon itself, is in `SPEC-MAP.md`, §47.9, the
layers row, is in `SPEC-UI.md`, and §47.8, the storm health paragraph, is in
`SPEC-NEXT.md` only until its glass questions close.** §46, the intensity
chart, is written to be picked up cold by a future session with no memory of
the one that researched it.

**§48, rainfall, has shipped and left this file.** Sources, the two payload
traps, coverage and the relay are §48.1–§48.7 in `SPEC-DATA.md`; the two
drawer sections and the disagreement between their two numbers are
§48.8–§48.10 in `SPEC-UI.md`. The number went with it, as it always does.

§45 (genesis — the areas being watched) **has shipped** and left this file the
way anything leaves it: the section moved, whole, into the files that own each
part. Source and failure behaviour are §45.1–§45.3 and §45.5 in `SPEC-DATA.md`,
the globe layer is §45.4, §45.6 and §45.7 in `SPEC-MAP.md`, and the drawer
section is §45.8 in `SPEC-UI.md`. The number went with it, as it always does.

**Why the numbering started at 45 and not 38.** The live spec ends at §37, so 38
looks free and is not. §38–§44 were assigned by `SPEC-GLOBES.md` on the **`worlds`**
branch — the three-globe expansion that was cut from the roadmap but deliberately
preserved, not deleted. Section numbers are permanent addresses; a number that has
been spent stays spent, whether or not the code that spent it sits on `main`.
**Check `origin/worlds` before claiming the next free number.**

> **THIS FILE IS THE ONE EXCEPTION TO "THE SPEC DESCRIBES WHAT IS."**
> Every other spec file describes the app as it stands right now. This one
> describes what has been agreed and not yet built, which is exactly why it is a
> separate file rather than a `[TODO]` sprinkled through the real ones. A reader
> who opens `SPEC-DATA.md` must never have to ask whether a paragraph is
> describing something that exists.
>
> **An item leaves this file in exactly two ways.**
> 1. **It ships** — the section moves, whole, into the spec file that owns its
>    concern, rewritten in the present tense. The number goes with it. Delete it
>    here.
> 2. **It is cut** — delete it, and add one line to SPEC.md's SETTLED list so it
>    does not get re-proposed.
>
> **Not a log, same as everywhere else.** No dates, no history, no "considered
> and rejected". `git log` is the history.
>
> **Section numbers are permanent addresses.** A section here keeps its number
> when it graduates into the real spec.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact nobody has tested.
Nothing marked `[VERIFY]` may be treated as confirmed.

**Every endpoint in this file was fetched live and the response inspected.**
Field names are transcribed from the actual `?f=json` schema, not from
documentation. Where something was not fetched it says so.

---

## 46. The intensity chart

### 46.1 Why this exists

"Is it getting stronger or weaker, and does anybody actually know" is the first
question a storm raises and the app currently answers it in prose, inside the
advisory text, several taps down. A shape answers it in half a second.

The app has no chart of any kind. This is the first one, so it also sets the
house style for every chart after it.

### 46.2 What it draws

One plot in the storm detail panel. Time across, wind speed up.

- **Background: Saffir-Simpson bands as horizontal stripes**, using §6's fixed
  category colors at low opacity. This is the load-bearing idea. The line
  crossing from one band into the next *is* the category change, so the chart is
  readable without reading the axis, and it is the same color language as the
  globe.
- **A vertical "now" line.** Past to its left, forecast to its right.
- **Solid line, left of now** — observed intensity.
- **Dotted line, right of now** — the official forecast.
- **A shaded fan around the dotted line** — model spread. This is the honest
  part. A tight fan means the guidance agrees; a wide one means nobody knows and
  the centre line should not be read as a promise.
- **A fine second line, left of now** — the satellite estimate (§46.4), where
  available.
- **A marker** where rapid intensification probability crosses a threshold, once
  §47 lands and that number exists. Not a blocker; the chart ships without it.

Category bands, the forecast line and the spread fan are all built from data the
app already fetches.

### 46.3 Source — observed intensity

Currently the app draws past track from the MapServer's pre-rendered Past Track
layers. For a chart it wants the numbers, not the drawing.

`https://ftp.nhc.noaa.gov/atcf/btk/` — b-deck best track, e.g. `bal022026.dat`.
Fixed-width ATCF, the same record family `lib/adeck.js` already parses. Carries
lat, lon, max wind, min pressure, wind radii by quadrant, and eye diameter,
updated through the season after each advisory.

**AL / EP / CP only.** Confirmed directly: `ftp.nhc.noaa.gov/atcf/`'s own README
scopes `aid_public` and `btk` to those three basins, and a live listing of
`aid_public/` shows only `aal`, `aep`, `acp` files. **There is no West Pacific or
Indian Ocean b-deck on NHC's server.** For those storms the observed line comes
from the app's own accumulated history plus §46.4.

### 46.4 Source — the satellite estimate

`https://tropic.ssec.wisc.edu/real-time/adt/{ID}-list.txt`
Index at `https://tropic.ssec.wisc.edu/real-time/adt/adt.html`.

CIMSS Advanced Dvorak Technique. **Global — every basin.** Fixed-width plain
text, one row per fix, **every 20 to 30 minutes**.

Verified by pulling `12W-list.txt` in full: a complete series for Typhoon
Dolphin from 30 kt on 27 Jul, through 155 kt on 29 Jul, and back down. Columns
include date, time, CI number, MSLP, Vmax in knots, raw and adjusted T-numbers,
the constraint rule in force, scene type (`IRRCDO` → `CRVBND` → `EYE` → `EYE/L`),
estimated RMW, eye size, lat, lon, fix method (`FCST` / `ARCHER`), and the
satellite that produced it (`HIM-9`).

That is roughly twelve times the sampling rate of a 6-hourly warning. For West
Pacific and Indian Ocean storms — where the app has JTWC's warnings and nothing
else — it is the difference between four points a day and fifty.

**Filename convention `[VERIFY]`.** `12W-list.txt` was confirmed. The pattern for
Atlantic and East Pacific storms was not fetched and must be checked before this
is wired up; do not assume `AL02-list.txt` works.

**This is a university research page, not a hardened API.** No SLA, no published
rate limit, no stated licence. Cache hard, attribute UW-CIMSS, and treat an
outage as routine rather than exceptional.

### 46.5 The second opinion, and how to word it

Official warnings are 6-hourly. The satellite algorithm runs every half hour. In
a rapidly intensifying storm the official number is routinely behind reality, and
the gap between the two lines is the most useful thing on the chart.

When they diverge past a threshold, the panel says so:

> Satellite estimate 132 kt · last advisory 115 kt, 4 h ago

**Wording is a safety question, not a copy question.** Landfall is not a forecast
product (§1) and must never appear to second-guess a warning centre. The line
names what each number is and how old it is, and draws no conclusion. Never
"stronger than forecasters say." `[DECIDE]` — the divergence threshold, and
whether this surfaces at all or only lives on the chart.

### 46.6 Performance

**This is the item most exposed to the unmeasured frame cost.** A chart canvas in
the detail panel is new drawing work on a device that is already blocking for
3.2 seconds on Windows during load, with a MapLibre frame cost nobody has put a
number on. See SPEC-MAP.md §9.7.

Mitigations, decided rather than left open: the chart renders once on panel open
and on new data, never per frame; it is not animated beyond a transform-and-
opacity entrance; and it does not exist in the DOM until the detail panel is
opened.

### 46.7 Open questions for glass

1. **Do the category bands help or do they turn the chart into wallpaper?** At
   low opacity they may disappear; at high opacity they will fight the lines.
2. **The spread fan on a storm with wide guidance** may swamp the plot. There may
   need to be a cap on how much of the vertical range it can claim.
3. **At phone width, with a five-day forecast and a ten-day history**, does
   anything remain legible? The history may need truncating.

---

## 47. The environment ribbon

### 47.1 Why this exists

The cone says where. Nothing in the app — and nothing in any consumer tracker —
says **why** a storm strengthens or falls apart.

Forecasters get this by reading wind shear, sea temperature and ocean heat as
three separate charts on three separate sites and assembling it mentally.
Landfall already walks the smoothed forecast track to measure and redraw the cone
(§7.9). The same walk can carry the environment.

The result: "weakens to a tropical storm by Thursday" stops being a sentence to
skim and becomes a visible place on the map where the fuel runs out.

The layer answers exactly one question — **is the environment helping or
hurting this storm, and by how much** — and anything that is not that answer
belongs somewhere else.

### 47.2 Source — SHIPS

`https://ftp.nhc.noaa.gov/atcf/stext/`

Plain fixed-width text, 9.0–10.4 KB across a whole season, no auth, reissued
each synoptic hour (~6 h). One file carries the entire environmental picture for
one storm, which is why this is a single integration rather than four.

**There is no `latest` alias, and this shapes the whole integration.** Filenames
are `YYMMDDHH` + storm id + `_ships.txt` — `26081506EP0826_ships.txt` is Hernan
at 15 Aug 2026 06 UTC, and the 12 UTC run is a different file at a different
address. Anything reading SHIPS either builds the name from a synoptic hour and
handles the miss, or reads the directory index.

**Publication lag, measured over a season of 365 runs.** Median 53 minutes after
the nominal hour, 90th percentile 140 minutes, 99th percentile 374 minutes, worst
observed 446 minutes — over seven hours, which is longer than the gap between
runs. Two runs arrived *before* their nominal hour. Simulating a poll every
fifteen minutes across every storm's life: the newest synoptic slot alone works
77% of the time, two slots cover 98%, **three slots cover 99.1%**. The relay
therefore tries three, newest first, and only after all three miss does it say
no run is published (§47.6). Treating a single 404 as an outage would be wrong
almost a quarter of the time.

**The storm id inside the filename carries a two-digit year.** The app holds
`ep082026` from CurrentStorms.json; the filename wants `EP0826`. Getting this
wrong yields a 404 indistinguishable from "this storm has no SHIPS run".

The file's contents:

- A per-forecast-hour table, 0 to 168 h: shear speed and direction, SST,
  potential intensity, 200 mb temperature, mid-level RH, ocean heat content,
  storm speed and position.
- Three intensity forecasts side by side: no-land, land-decay, and LGEM.
- **The model's own per-factor contributions, in knots, cumulative from now.**
  This is what the layer colors by — see §47.4.
- A rapid-intensification probability matrix. Not used by this layer.

**What the real bytes contain, measured across the whole 2026 season — 365
files, 31 storms.** Every one of these has been observed and a parser meets all
of them or it is not finished:

- **Eight non-numeric tokens appear where a number belongs**, and a parser that
  knows fewer will silently mangle a column. `N/A` fills every column past the
  end of a short forecast. `LOST` appears in `MODEL VTX` where the model loses
  the vortex. `xx.x` and `xxx.x` replace latitude and longitude. `TROP`, `SUBT`
  and `EXTP` are the values of the `Storm Type` row — tropical, subtropical and
  extratropical. `DIS`, for dissipated, appears only in the Atlantic block
  below.
- **The forecast has two independent ends and either can come first.** Winds and
  positions truncate separately: 209 files publish winds past the last position,
  57 publish positions past the last wind. The ribbon can only be drawn where
  both exist.
- **Positions stop at any hour, not just at +120 h.** A position never appears
  past +120 h, but only 256 of 365 files reach it. Twenty-three files — 6% —
  have **no forecast position at all past hour 0** while still publishing winds
  out to +120 h, so there is a real class of file with nothing to paint. The
  layer says so (§47.6) rather than drawing a bare cone. **Twenty-FOUR files
  have nothing drawable**, which is the same twenty-three plus one that
  publishes positions while its wind stops immediately — the two counts are
  measuring different things and neither is wrong.
- **A ZERO IN THE CONTRIBUTION TABLE IS NOT AN END-OF-FORECAST SIGNAL, AND
  NOTHING MAY READ IT AS ONE.** Past the last published wind, the table's
  behaviour is not consistent: of the files whose wind ends before +168 h, 110
  fall to zeros and **75 keep publishing real numbers to the end**. So a zero
  can mean the forecast has stopped or it can mean the model has genuinely
  found nothing happening, and the values alone cannot tell them apart.
  **Neutral is also the season's most common real reading** — 374 drawable
  hours across 224 files carry an environment of exactly 0 kt. Drawability is
  therefore decided from the position and wind rows and never from a value
  being zero, or a short forecast paints a confident mid-violet "nothing
  happening" across the half of its cone that has no forecast at all — the
  §47.5 failure, arrived at from the other direction.
- **Truncation is always trailing. There is not one interior gap in the
  season.** Measured across all 365 files: no row ever resumes after a `N/A`,
  `xx.x` or `xxx.x`. So the drawable window is always a single clean run from
  +6 h rather than a set of scattered hours, and the two published ends
  (`lastWindHr`, `lastPositionHr`) fully describe it.
- **Storm Type leaves `TROP` inside the drawable window** on 2.7% of hours,
  across 37 files. SHIPS keeps publishing an environment for a system that is
  no longer tropical.
- The basin in the header text is unreliable: Lala's file is headed `EAST
  PACIFIC` while her id is `CP012026`. The id is the truth.
- **Invests get full SHIPS runs** (`AL942026`), and they are numbered 90–99.
  They are real model output and are kept. Separately, 80–89 are internal test
  systems, which appear out of season and are dropped by the sweep. Neither
  invests nor test systems appear in the app's storm list, so nothing in the
  live app ever renders one — but the parser meets invests constantly in the
  fixtures and must handle them.
- **Sections vary by basin, not by storm.** All 60 Atlantic files carry a
  secondary-eyewall block and a DSHIPS eyewall-replacement table, and with them
  four extra rows — a second `TIME (HR)`, `18HR AGO`, `12HR AGO`, `6HR AGO`. No
  Pacific file has any of them. Nothing may assume section order or presence,
  and the second `TIME (HR)` means a parser keying on a row label must take the
  first match or it will read the wrong table.
- SHIPS can be **newer than the advisory** — Lala's 06 UTC SHIPS against her
  00 UTC advisory. The ribbon therefore matches the drawn track by forecast
  hour, never by SHIPS's own coordinates, or the color drifts off the line.

Archived hourly to `origin/archive` under `latest/ships/`, with the stext
directory index archived beside it under the name `nhc-ships-index`. Most of
each run's requests are expected to 404, because three synoptic slots are
requested and usually only the oldest is published; a run where **all three**
fail is the signal.

**A whole season is swept separately, and the parser is built against that
rather than against the hourly archive.** `tools/ships-corpus.mjs`, run by hand
from the `ships-corpus` workflow, walks the directory index and pulls every real
storm and invest file for a season to the `ships-corpus` branch. The 2026 sweep
took 365 files across 31 storms — 239 East Pacific, 66 Central Pacific, 60
Atlantic; 202 named-storm runs and 163 invest runs. Test systems, numbered
80–89, are dropped; they appear out of season and are exercises rather than
weather. Invests are kept, because they are real model output, they carry the
season's most extreme values, and a parser that chokes on one has a bug.

**Read the inventory the sweep writes before opening a single file.** A season
fits in no one's head and in no context window. The inventory is a few KB and
carries what a parser author actually needs: every non-numeric token that
appeared where a number belonged, the section headings and their frequency, the
row labels and which are **not** in every file, the spread of forecast lengths,
and how long after its nominal hour a run was actually published.

The corpus is data and is never merged to `main`; every file in `main` ships to
every visitor. Twelve files spanning the extremes the season showed are promoted
to `samples/ships/` by hand as fixtures, listed in §47.10.

### 47.3 Ocean heat for the rest of the world — investigated, not adopted

`https://erddap.aoml.noaa.gov/hdb/erddap/griddap/TCHP` is NOAA AOML's global
0.25° tropical cyclone heat potential, point-queryable as JSON, and it was the
proposed fallback for basins SHIPS does not cover.

**It is not being built.** Measured against every contribution table in the 2026
season, ocean heat content is the weakest of the colored terms: median 0 kt,
95th percentile 2 kt, worst observed 8 kt, and it exceeds 1 kt on only 7.8% of
forecast hours. **That 8 kt is at +168 h, where no position is published and
nothing is drawn — the largest value that ever reaches the map is 4 kt.** It is
also strongly basin-dependent — the Atlantic never saw it
worth more than 1 kt, the East Pacific 3 kt, and the Central Pacific 8 kt with
19% of hours above 1 kt. So it is small but not nil, and the earlier claim that
it never moves a storm by more than a knot was an artefact of three East Pacific
files.

The decision stands on the same ground it always did: a fallback ribbon carrying
only this one term, in basins where nothing else is published, would be a worse
statement than an honest absence. AOML also states the dataset is not maintained
operationally.

Recorded here so the next session does not re-research it.

### 47.4 What the color means

**The model's own accounting, in knots. Not an index of our own.**

**This is a reporting layer, not a forecast.** SHIPS already publishes what each
factor is worth in knots — that number *is* the effect, as measured by the model
that makes the official forecast. The app reports it faithfully and adds nothing:
no weights of our own, no score, no attempt to predict. Brighter means the
environment is working for the storm, darker means it is working against it, and
the layer answers nothing else.

Every SHIPS file publishes what each factor is worth, cumulative from now, and
those columns sum to `V (KT) NO LAND` — the over-water intensity forecast. Across
the 2026 season the current wind plus `TOTAL CHANGE` reproduced `V (KT) NO LAND`
exactly on 4,475 of 4,516 forecast hours, never off by more than 1 kt.

**They do not explain `V (KT) LAND`.** Land decay is applied after the fact and
the contribution table never accounts for it — against `V (KT) LAND` the same sum
is off by up to 42 kt, and 25 files in the season carry a decay gap of 10 kt or
more. This matters because §47.8 quotes the land-decayed forecast in words: on a
storm approaching a coast the cone can honestly read "the environment is helping"
while
the sentence beneath it says the storm is about to be torn apart by the ground.
Both are true and the wording must not pretend otherwise.

**There are exactly 19 contribution rows.** All 19 are read, all 19 are placed,
and they are split into three groups of which **only the first is colored**:

1. **The environment — colored.** Ten rows: `VERTICAL SHEAR MAG`, `VERTICAL
   SHEAR ADJ` and `VERTICAL SHEAR DIR` (summed and spoken of as one thing, since
   shear is one thing to a person), `200/250 MB TEMP.`, `THETA_E EXCESS`,
   `700-500 MB RH`, `850 MB ENV VORTICITY`, `200 MB DIVERGENCE`, `850-700 T
   ADVEC`, `OCEAN HEAT CONTENT`. Their signed sum is the ribbon.

   **"Environment" names the whole package, and only the whole package.** The
   layer is Environment in the layers row (§47.9), the number is the environment
   number, the color is what the environment is worth, and the verdict says the
   environment is helping or hurting. It never picks up a second name for the
   same thing — not "the air and sea", not "the surroundings", not "conditions".
   One thing, one name, or the reader thinks there are two layers.

   **The individual factors are described in whatever plain words actually fit,
   and those words are air, sea and water.** That is the register the storm
   health paragraph is written in (§47.8), and the mapping lives in
   `lib/env-health.js`:

   | Parser key | What a reader sees |
   |---|---|
   | `shear` | wind shear |
   | `tempAloft` | cold air above it |
   | `thetaE` | warm moist air |
   | `midRh` | moisture around it |
   | `vorticity` | spin in the air around it |
   | `divergence` | air flowing out the top |
   | `tempAdvection` | warm air moving in |
   | `oceanHeat` | deep warm water |

   **A name has to survive both signs, and "dry air" did not.** `700-500 MB RH`
   is POSITIVE when the air around the storm is moist and that is helping it.
   Named "dry air", a helping hour printed as "dry air +2" — which reads as
   dryness doing the storm a favor, the exact opposite of what the file says.
   Named for the quantity rather than for one end of it, "moisture around it +2"
   and "moisture around it −2" are both true. Every name is checked the same
   way: read it aloud with a plus and with a minus, and if only one of the two
   is honest the name is wrong.

   **`wind shear` is the one term kept from the trade, deliberately.** It is the
   single most-reported quantity in tropical meteorology and every broadcast on
   earth uses it; inventing a private name for it would make the app harder to
   read, not easier. The rule is plain English, not a ban on words people
   already know. It is spelled out — never bare "shear".

   The umbrella rule is about the package's name, not about scrubbing the
   vocabulary underneath it: "the environment turns against it, and most of that
   is wind shear" is exactly right, while "the air and sea are worth −13" is the
   package wearing a second name and is not.
2. **Water headroom — shown, never colored.** One row: `SST POTENTIAL`.
3. **The storm itself and the model's bookkeeping — shown, never colored.**
   Eight rows: `MODEL VTX TENDENCY`, `GOES PREDICTORS`, `RI POTENTIAL`,
   `PERSISTENCE`, `DAYS FROM CLIM. PEAK`, `SAMPLE MEAN CHANGE`, `ZONAL STORM
   MOTION`, `STEERING LEVEL PRES`. The last three are neither air nor headroom —
   `SAMPLE MEAN CHANGE` is the model's climatological baseline and the other two
   describe where the storm is going, not what it is sitting in.

**The reconciliation rule, and it is a parser assertion, not a comment.** The
three groups must add back to `TOTAL CHANGE` at every forecast hour of every
file. Each published value is rounded to a whole knot, so nineteen of them
accumulate slop: across the season the residual was 95% inside ±2 kt and never
worse than ±4. **A residual outside ±4 kt means a row is missing, misread, or
one exists that this section has never seen, and the ribbon is misreporting.**
The parser fails loudly on that and on any row label not in the list of 19.

**THE TOLERANCE HAS NO HEADROOM, AND THAT IS DELIBERATE RATHER THAN LUCKY.**
±4 kt is not a comfortable margin around the season — it is exactly the
season's observed worst, and **ten runs sit precisely on it**. So a future file
one knot noisier stops the parse. That is the correct trade: widening the window
to buy quiet would mean the first real accounting error also passes, and the
whole claim this layer makes is that it reports the model's own arithmetic. If
a run ever does throw `ships_reconcile`, read the file before touching the
number.

**It does NOT catch a row placed in the wrong GROUP, and an earlier version of
this paragraph claimed it did.** The three groups are summed together before
being compared to `TOTAL CHANGE`, so moving `SST POTENTIAL` from headroom into
the environment leaves the residual at exactly zero while inverting the ribbon
on every strong storm — the one failure this section calls its most important
decision. Measured: that move takes the season's only major hurricane from
−13..+3 to −80..−3. What catches it is the block of measured anchors in
`tools/test-ships.mjs`, real ranges off named fixtures that move violently the
moment a row changes group, and the suite mutation-tests exactly that.

Getting this wrong is not hypothetical. An earlier version of this section named
only sixteen rows and dropped `SAMPLE MEAN CHANGE`, `ZONAL STORM MOTION` and
`STEERING LEVEL PRES` — which left the accounting short by a mean of 1.5 kt,
95th percentile 11 kt, worst 20 kt, with `SAMPLE MEAN CHANGE` alone reaching
16 kt.

**Water headroom is excluded on purpose and this is the single most important
decision in the section.** `SST POTENTIAL` is not a measure of the sea — it is
how far below its own ceiling the storm currently sits. A 25 kt blob over 29 °C
water scores +45 because it has nowhere to go but up.

**Over a season the exclusion is not a judgement call, it is arithmetic.** The
headroom term tracks current weakness almost exactly: median +11 kt while a
storm is a depression, 0 kt at tropical-storm strength, −6.5 kt at Cat 1–2, and
**−41 kt at Cat 3 and above**, reaching −104 kt. Correlated against current wind
it is loose at short lead — r² 0.11 at +24 h — and tight further out, r² 0.66 at
+72 h and 0.67 at +120 h.

So including it would not merely dim the ribbon on a strong storm. It would
**invert it**: the season's only major hurricane would have been painted as the
most hostile environment of the year, at the moment it was most dangerous, on
the strength of a number that only says it had already arrived. The layer would
be reporting the storm back to itself instead of reporting the environment.

**Units: knots inside, the reader's units on screen.** §8's rule holds without
exception here — every threshold in this section is defined in knots, the ramp
domain is knots, the band cut points are knots, the ±3 kt "takes a side" test is
knots, and the reconciliation is checked in knots. Nothing converts until the
moment text is drawn, and then it converts through `formatWind` in `lib/units.js`
like every other wind figure in the app. A reader on imperial sees mph, a reader
on metric sees km/h, and neither ever sees a knot. These are *changes* in wind
speed, so they always carry a sign.

**Converting breaks the arithmetic, and this has to be handled rather than
ignored.** Each term is a whole number of knots and the terms sum exactly. Round
each one to mph independently and the sum no longer closes: Genevieve's +8, −5,
+2, −1 and a −1 remainder total +3 kt, but converted and rounded one at a time
they read +9, −6, +2, −1, −1 and total +3 mph only by luck — other combinations
miss by 1 or 2. Since §47.8 requires the visible figures to add up to the visible
headline, **the conversion closes the sum with the stated remainder** (`closeWindParts`,
beside `formatWind` in `lib/units.js`): every named term converts with the same
plain rounding every other wind figure in the app uses — so one term never
prints two different values on two surfaces — and the remainder is computed as
displayed-total minus displayed-named, so the parts sum to the total by
construction, in whatever unit is on screen. Verified against all four §47.8
acceptance cases and every drawable hour of all fifteen fixtures in both unit
systems. This is the only place it is needed; the alternative — figures that visibly do not add up — destroys the one
claim this layer makes, that it is reporting the model's own accounting rather
than a score of our own.

**Omission is decided in knots, before conversion**, so a metric reader and an
imperial reader see the same set of named terms. A term worth zero knots is
worth zero in every unit; a term worth one is not allowed to appear for one
reader and vanish for the other.

**The scale is −15 to +15 kt, verified.** Across every hour the ribbon can
actually paint — named storms, position published — the environment number runs
p5 −14, median 0, p95 +10, full range −26 to +38. That window holds 94.5% of
them, clipping 3.5% at the dark end and 2.0% at the bright end. Widening to
−20..+20 would capture 98.3% at the cost of flattening the middle, where half
the season lives. It stays at ±15.

**The five bands, verified.** Tearing it down (< −8) 12.3%, working against it
(< −3) 14.8%, neutral (< +3) 50.1%, helping (< +8) 14.9%, feeding it (≥ +8)
8.0%. No band is empty and none dominates to the point of uselessness. Neutral
is the largest at half the season, which is the true answer half the time rather
than a failure to resolve — tightening the inner cut to ±2 moves it only to 39%
and would break the ±3 rule §47.8 uses for whether a factor has taken a side.
The bands drive the **words** and no longer the color.

**Agreement** — the net divided by the total push and pull — is carried in words
only, and the sentence is **required, not optional**. A storm can net near zero
because nothing is happening or because a great deal is happening in both
directions at once, and only the drawer can say which. This is not a rare case:
among drawable named-storm hours reading neutral, 47% are genuinely quiet with
under 5 kt of push and pull, but **21% are loud — 15 kt or more fighting to a
draw, topping out at 38 kt.** (Counting invests as well, which the app never
draws, the loudest neutral hour reaches 44 kt.) One neutral cone in five is a
knife edge. Agreement was prototyped as a second map
mode and cut: it shared the ramp with the net, so bright meant "good for the
storm" in one and "loud" in the other, and on a storm where everything pulls down
together the two modes painted opposite ends of the same colors from the same
data.

### 47.6 The coverage problem, stated plainly

SHIPS covers the Atlantic and the East and Central Pacific. It does not cover
the West Pacific, the Indian Ocean or the Southern Hemisphere.

**A typhoon must never render as a flat cone that looks like a calm
environment.** With §47.3 not being built, the absence is total in those basins,
so it is stated rather than shaded: the layer row and the storm drawer both say
the data is not published for that basin. Silence is the one outcome forbidden
(§5).

A storm whose SHIPS run is not published yet — a fresh depression gets advisories
before its first run — says so in the same words rather than going blank. A run
counts as not published only after all three synoptic slots have been tried and
missed (§47.2).

**There is a fourth case and the season proved it is not rare: a run exists and
publishes nothing drawable.** Twenty-three files in 2026 — 6% — carried a full
contribution table and forecast winds but no forecast position past hour 0, and a
further 86 lost their positions somewhere short of +120 h. So the ribbon can be
shorter than the cone it sits in, or absent from it entirely, while the file
itself is perfectly healthy. Where the ribbon stops the cone reverts to its plain
fill, and the drawer says the environment is only published for part of the
track. A ribbon that quietly ends mid-cone with no explanation is the silence
§5 forbids.

### 47.7 Performance

**Every part of §47 is built**: `functions/api/nhc/_ships-parse.js` is the pure
parser, `functions/api/nhc/ships.js` the route at `/api/nhc/ships?id=ep082026`,
`lib/cone-ribbon.js` and `map/layers/environment.js` the fill, `config/layers.js`
the row (§47.9), and `lib/env-health.js` with `ui/env-health.js` the storm
health paragraph (§47.8). `tools/test-ships.mjs` runs the parser against the
fifteen fixtures and `tools/test-env-health.mjs` runs the paragraph against the
four acceptance storms figure by figure.

**The parser has been run against the ENTIRE 2026 corpus — all 365 files, 31
storms, both kinds and all three basins — and nothing threw** (most recently
after `potIntNowKt` was added: `POT. INT.` at hour 0 is published on all 365,
range 77–174 kt).** That is the
strongest correctness statement available to this layer and it is recorded here
so nobody sweeps the season again to re-establish it. The twelve fixtures are
the regression suite; the corpus is the proof, and `.github/workflows/ships-corpus.yml`
re-runs it after any future sweep. The route has also been verified live against
real storms, which confirmed the two ends and the basin-from-id rule on a
Central Pacific storm whose own header says East Pacific.

The route answers four ways and never blank (§47.6): the run; `basin_not_covered`;
`no_run_published`, only after all three synoptic slots miss; or a 502 carrying
`ships_unreadable` (the file changed shape) as distinct from `ships_unreachable`
(NOAA is down), because only the first is ours to fix. The payload is column-
oriented — one list of forecast hours and one list per number, lined up — which
is the shape the cone slices want and roughly half the size of per-hour objects.
It carries `lastWindHr` and `lastPositionHr` alongside `drawable` so the
unsettled question in §47.10's EP9326 row can be answered without a re-parse.

One text file per NHC-basin storm per advisory, cached in KV like every other
feed. Parsing happens in the relay; the browser receives a small JSON of
per-hour knots rather than a fixed-width table.

The cone fill is one geometry pass on an existing shape. It is drawn for every
storm that has a file, not only the selected one.

### 47.8 The storm health paragraph

**Read this before writing a line of it.** This section generates English
sentences with numbers in them, which makes it the single easiest place in the
app to be fluently wrong. **Every figure in every sentence is computed from the
file at the hour the sentence is about, printed, and then quoted — never typed
from memory and never worked out in your head.** That applies to the code, to
the tests, and to any new acceptance case added below.

The four worked cases below were themselves rewritten once for exactly this
reason. A first draft quoted 94L's shear as the main thing working against it,
when at the hour under discussion shear was the only term *helping* it; the
hostile figure came from a column 24 hours further out. The same draft told a
Cat 5 she had no room to grow while she sat 27 mph under her ceiling. Both read
perfectly. Both were caught only by computing the numbers instead of writing
them. See `CLAUDE.md`.

The cone answers "helping or hurting" at a glance. It cannot answer **why**, and
it must never be read as a forecast — §47.4 excludes headroom and structure from
the color precisely so it stays honest, which means the color alone is an
incomplete story by design. The paragraph is where the rest of it goes.

Lives in the storm detail drawer, under the figures already shown there.

**Structure — a paragraph, a grid, and a footnote, in that order.**

**The paragraph is four sentences and carries the STORY.**

1. **The verdict.** What the environment does *across the whole track*, and
   whether the storm is strengthening or weakening with it or against it.
2. **What is acting on it** — which factor leads, or that none does and the
   work is spread; then **the other side in its own sentence**, named, or said
   to be empty. **No figures in either.**
3. **Room to grow**, said as the storm's strength beside the sea's ceiling, and
   what its own structure is worth.
4. **The bottom line.** The published intensity forecast in plain words, with at
   most one closing clause.

**The grid under it carries the NUMBERS.** Its heading is the hour the verdict
named and the environment's total there; its cells are the named factors,
largest first, and a closing cell. **The cells visibly sum to the total**, which
is the whole reason it exists: a paragraph can only assert that its figures add
up, and a column of numbers under a total either does or does not.

**Then the footnotes, one short paragraph each** — the two figures the color
leaves out, where the track's numbers stop if they stop short, and who publishes
them. Three separate thoughts sharing nothing except not belonging in the story,
and run together as one block they were unreadable on glass.

**Two rules the footnotes obey, both learned by shipping the opposite.**

- **No signed figure ever reaches a sentence.** A storm whose structure
  contributed nothing printed *"its own structure +0 mph"*, which is a number
  pretending to be information. Signs are the grid's register; in a sentence a
  contribution *adds*, *costs*, or *counts for nothing*.
- **Name the quantity, never the state**, because these read at the VERDICT hour
  while the room sentence reads at the FIX and the two can be days apart. Lala's
  06 UTC run says *"plenty of room to grow"* from hour 0 while her headroom at
  +120 h is negative; a first draft rendered that as *"being up against its
  ceiling"* and the paragraph argued with itself on screen. *"The gap between
  its strength and the sea's ceiling costs 2 mph"* is symmetric in both signs
  and cannot contradict the sentence above it. The opener says which hour they
  belong to out loud.

**The figures used to be recited in the prose and it read like a ledger.** The
sentence *"Nothing dominates — working against it: shear −2, dry air −2 and cold
air aloft −1, and a smaller term and rounding take back 2"* is every rule in this
section obeyed and is still the wrong artifact: it does arithmetic out loud
because a paragraph was the only surface available. Once there is a grid, the
closing clause becomes a closing CELL — named `Rounding` where nothing was left
out and `Everything else` where something was — and the sentence goes back to
being a sentence.

**Which also gives the headroom figure a home.** It previously appeared in one
of three room-sentence branches, so most storms never showed it at all; it is
now always in the footnote, and whether that room is being USED is the bottom
line's closing clause, taken from `V (KT) LAND` alone. *"Plenty of room and the
forecast still has it easing"* is two published numbers set beside each other.
*"The air is what stops it filling that room"* is this section predicting, and
is banned.

**The verdict describes the shape of the track, not one hour of it.** This is
the most important rule in the section and the easiest to get wrong. The cone
already draws the shape — dark here, brighter there — and the sentence's job is
to name it, not to repeat one slice of it.

An early version quoted the **last** forecast hour. Genevieve is why that had to
go: her environment number runs
`0, −2, −6, −8, −11, −13, −13, −10, −5, 0, +1, +2, +3`,
so the last hour is +3 and a Cat 5 coming apart was summarised as *helping*. The
last hour was her single most favorable moment. Quoting the **worst** hour
instead fails the other way — half the season sits in the neutral band, and a
quiet storm with one −4 afternoon would be announced as "working against it".

**So the verdict names the shape.** Seven shapes cover the season, and a storm
is matched to one of them:

- **Steady** — the number never leaves one band. *"The environment stays out of
  it all week."*
- **Turning against** — it falls, ending materially lower than it starts.
  *"The environment turns against it through Monday, costing up to 13 mph."*
- **Turning for** — it rises. *"The environment is quiet for two days, then
  swings behind it, reaching 14 mph by Thursday."*
- **A bad patch in the middle** — down and back up, the Genevieve case.
  *"The environment turns hard against it through Tuesday afternoon, costing up
  to 15 mph, then eases back to neutral by Thursday afternoon."*
- **A good patch in the middle** — up and back down.
- **Hurts, then swings behind it** — down and out the OTHER side. Measured on
  the 2026 corpus before it was added: 23 runs cross from hostile to helping.
- **Helps, then turns against it** — the mirror, 11 runs. Together the two
  reversals are one run in ten, and a closing clause that always said "eases
  back to neutral" hid the ending on every one of them. A reversal is claimed
  only when the ending side clears the ±3 side test with 2 kt of hysteresis to
  spare (`ENV_HEALTH.reversalHysteresisKt`) — a track finishing one knot over a
  cut point has grazed a boundary, not reversed, and is told as a return to
  neutral. Genevieve finishes at +3 and is the graze case.

Rules for matching a shape: on a patch the peak named is the hour furthest
from zero; **on a turning shape it is the furthest hour on the ENDING side** —
a track that rides +9 up before falling to −9 must not headline "+9" in a
sentence about the environment turning hostile. The interior extreme can
outvote the endpoints: when the furthest hour sits on the opposite side of the
start from where the track ends, at equal or greater band distance, the story
is the patch (Genevieve ends at +3, exactly on the helping boundary, and
end-vs-start alone would call a Cat 5 coming apart "turning for"). Every peak
is always given **with a time** — a bare number from the middle of a track
with no idea where it sits on the map is worse than no number. A shape counts
as turning only if it crosses a band boundary; drift inside one band is
Steady. When the track is too short or too flat to have a
shape — fewer than three drawable hours, or every hour inside the neutral band —
the verdict falls back to naming the single furthest-from-zero hour and its time.

**This describes; it does not predict.** "The environment turns against it
through Monday" is a report of published numbers. "The environment turns against
it, so it will weaken" is a forecast and is forbidden — the storm's fate comes
from `V (KT) LAND` in part five, stated separately, and the two are allowed to
disagree.

**Worked from real bytes. These are acceptance cases, written in mph for an
imperial reader; a metric reader sees the same sentences in km/h.** Times are the
reader's local day and part of day, computed here for US Central.

> **Hernan** — `26081506EP0826`.
> The environment is about even now but turns against Hernan steadily, reaching −13 mph by Monday afternoon. Most of that is wind shear. The only thing working in its favor is warm moist air. There is plenty of room to grow — 35 mph over water that could hold 160 mph, and its own structure costs 12 mph. The intensity model has it falling from 35 mph to 25 mph by Monday afternoon, so the room is there and nothing is using it.
>
> *Monday afternoon — −13 mph in total.* Wind shear −9 mph · Air flowing out the top −2 mph · Warm moist air +1 mph · Moisture around it −1 mph · Everything else −2 mph
>
> At that same hour, two other things move the forecast and are not counted above: the gap between its strength and the sea's ceiling adds 17 mph, and the storm's own structure costs 12 mph.
>
> From NHC's SHIPS intensity model.

> **94L** — `26081506AL9426`.
> The environment helps 94L mildly for the first day, then turns against it, reaching −8 mph by early Wednesday. That cost is spread across several factors rather than one, the largest being cold air above it and moisture around it. The only thing working in its favor is wind shear. There is plenty of room to grow — 29 mph over water that could hold 158 mph, and its own structure costs 5 mph. The intensity model has it reaching 69 mph by early Thursday, so the environment slows it rather than stopping it.
>
> *early Wednesday — −8 mph in total.* Cold air above it −2 mph · Moisture around it −2 mph · Wind shear +1 mph · Warm moist air −1 mph · Everything else −4 mph
>
> At that same hour, two other things move the forecast and are not counted above: the gap between its strength and the sea's ceiling adds 45 mph, and the storm's own structure costs 5 mph.
>
> The model publishes wind further along the track than it publishes positions, so the environment can only be shown for part of it.
>
> From NHC's SHIPS intensity model.

> **Lala** — `26081506CP0126`.
> The environment works against Lala briefly on Sunday, then swings behind it, reaching +14 mph by early Thursday. Almost all of that is cold air above it. The only thing working against it is moisture around it. There is plenty of room to grow — 63 mph over water that could hold 161 mph, and its own structure adds 8 mph. The intensity model has it reaching 83 mph by early Thursday, using some of that room.
>
> *early Thursday — +14 mph in total.* Cold air above it +14 mph · Wind shear +3 mph · Moisture around it −2 mph · Warm moist air +1 mph · Everything else −2 mph
>
> At that same hour, two other things move the forecast and are not counted above: the gap between its strength and the sea's ceiling costs 2 mph, and the storm's own structure adds 8 mph.
>
> The model publishes wind further along the track than it publishes positions, so the environment can only be shown for part of it.
>
> From NHC's SHIPS intensity model.

> **Genevieve** — `26072706EP0726`.
> The environment turns hard against Genevieve through Tuesday afternoon, costing up to 15 mph, then eases back to about even by Thursday afternoon. Almost all of that is wind shear. The only thing working in its favor is moisture around it. Genevieve is close to its ceiling — 161 mph over water that could hold 188 mph — so there is not much room left to grow, and its own structure adds 5 mph. The intensity model has it falling from 161 mph to 63 mph by early Saturday, so the environment and its own decay are pulling the same way.
>
> *Tuesday afternoon — −15 mph in total.* Wind shear −15 mph · Cold air above it −1 mph · Moisture around it +1 mph
>
> At that same hour, two other things move the forecast and are not counted above: the gap between its strength and the sea's ceiling costs 20 mph, and the storm's own structure adds 5 mph.
>
> The model publishes wind further along the track than it publishes positions, so the environment can only be shown for part of it.
>
> From NHC's SHIPS intensity model.

**These four are the generator's own output, printed by running it and pasted
here, and asserted sentence by sentence and cell by cell in
`tools/test-env-health.mjs`.** An earlier hand-written version of them carried
four computed-figure errors: two miscounted "smaller terms" clauses and two
wrong times on Genevieve. The section's first rule caught its own cases. The
storm is always "it": a generator guessing gender from a name would guess wrong
somewhere public, and it is what NHC's own discussions use.

**Four of them are worth reading for what they show.** Genevieve's grid has NO
closing cell — her three named factors close on their own, and a cell written as
zero would be arithmetic theatre. Her headroom is NEGATIVE, which is §47.4's
whole argument for keeping it out of the color, visible in the footnote where it
can do no harm. Lala is the only one of the four whose forecast actually uses
the room it has. And 94L's bottom line already carries the slows-not-stops
clause, so no room clause is appended to it: **one clause per sentence**, always.

**The room bands are a judgement about words and were recut once.** The first
cut called a storm at 48% of its ceiling *"fairly close to its ceiling"* with
*"less room to grow"*, which is plainly false read aloud — Lala at 75 mph under
a 157 mph ceiling. Plenty of room now runs to half the ceiling and "not much
left" starts at 80% (`ENV_HEALTH.roomFarRatio`, `roomNearRatio`). Genevieve at
86% is the one acceptance storm that really is near hers.

**Rules the wording obeys.**

- **Direction comes only from the published intensity forecast** (`V (KT) LAND`),
  never inferred from the environment sum. 94L is the proof: its air is against
  it at every hour past +72 and it gains 13 kt anyway. Any phrasing that reads
  the environment and announces an outcome would have been wrong about it.
- **Where land decay is doing the work, say so.** The contribution table explains
  the over-water forecast and not the land-decayed one (§47.4), so on a storm
  approaching a coast the cone can honestly show a helpful environment while
  `V (KT) LAND` falls away. When the two forecasts diverge by 10 kt or more at any hour — 25
  files in the 2026 season — the bottom line names the coast as the reason. It
  must never read as though the environment turned against the storm.
- **The agreement sentence is required on a NEUTRAL verdict and forbidden
  everywhere else.** Whenever the environment sum lands in the neutral band, the
  paragraph says whether that is a quiet environment or a tug of war, because
  one neutral reading in five is 15 kt or more of push and pull cancelling out
  (§47.4). "Nothing much is acting on it" and "a great deal is acting on it in
  both directions" are different warnings and the same color, and nothing else
  in the paragraph can tell them apart.

  **Off a neutral verdict it was deleted, and the deletion is the point.** It
  used to append *"and nearly everything is pulling the same way"* or *"though
  not everything agrees"*, both of which are a vaguer restatement of the
  sentence one line later — the sentence that names the other side outright.
  Kept together they read as a contradiction: *"…nearly everything is pulling
  the same way. …with nothing helping"* sounds like two claims to anyone who
  has not read §47.4. One fact, said once, concretely.
- Verdict cases, on the intensity change and the environment together:
  strengthening with the environment behind it; strengthening in spite of it;
  strengthening while the environment stays out of it; weakening because of the
  environment; weakening despite a decent one; weakening for its own reasons.
  Roughly steady is its own case. A factor counts as taking a side at ±3 kt —
  measured in knots before conversion, matching the neutral band in §47.4.
- **Plain English names only, never the file's row names.** "Cold air aloft",
  not `200/250 MB TEMP`. The full mapping lives with the parser.
- Shear's three published rows are summed and spoken of as one thing.
- A term that rounds to zero is **omitted**, never listed as "0 kt". At most
  four named in total, largest first. The per-side cap was three while the
  figures were in the prose — four signed figures on one side of a sentence is a
  wall — and rose to four when they moved into the grid, where four cells on one
  side cost nothing to scan. Lala is the case: all four of her non-zero factors
  are hostile, and the old cap clipped one into an unnamed "smaller term" for no
  reason a reader could see.
- Times are a local day and part of day. Never "+60 h" — that is the figures
  row's register, not this one.
- **Every figure comes from one hour: the one the verdict named.** The verdict
  picks the hour furthest from zero, and the terms in parts 2, 3 and the
  structure figure in part 4 are all read at that same hour. Mixing hours inside
  one paragraph is how an early draft ended up quoting a term from +120 h under
  a headline taken from +36 h.
- **Room to grow is the one exception, and it is quoted at the fix.** It is
  spoken as the sea's ceiling alongside the storm's strength — *"a 29 mph system
  sitting over water that could hold 158 mph"* — because "45 mph of headroom"
  means nothing and the pair means everything. This is the sentence where sea
  and water are the right words; the umbrella term stays "environment"
  (§47.4). Both halves are read at hour 0. An early draft paired
  the storm's strength **now** with the ceiling **five days out** — 94L read as
  "a 25 kt system over water that could support 152 kt", where the 152 was
  `POT. INT.` at +120 h, about 1,500 km down the track; at the fix it was 137.
  One sentence, two moments, and the more impressive of the two numbers. Both
  halves come from the same column or the sentence is not true.
- **The named cells must add up to the total printed above them, and the closing
  cell is what makes them.** At most four are named, so there is often a
  remainder, and unit conversion adds a little more (§47.4). It is a cell rather
  than a sentence, named `Rounding` where every non-zero factor was already
  listed and `Everything else` where some were left out. Where the named cells
  close on their own — Genevieve — there is no closing cell at all, rather than
  one written as zero. `tools/test-env-health.mjs` checks this by ADDING THE
  PRINTED CELLS on every fixture in both unit systems, never by re-deriving
  them: a test that recomputes the thing it is checking agrees with the bug.
- **Days and parts of day are the reader's local time**, from the same clock as
  every other time in the app, never the storm's local time and never UTC. A
  reader in Louisiana looking at a Central Pacific storm should see their own
  Thursday evening. Mixing clocks to be technically correct about a distant
  storm is how someone reads the wrong day about a storm that is near them.
- **The noun for a spread-out effect echoes the verdict's own verb.** The
  verdict says *"costing up to 5 mph"*, so the sentence after it opens *"That
  cost is spread across…"* and picks the reader up where they were left. It said
  *"The damage"*, which is too strong for a five-mph number and drifts toward
  describing what happens to the STORM — and what happens to the storm comes
  from the published forecast in the last sentence, never from here. A cost is a
  fact about the environment's own accounting.
- **A direction word may never be reused as a causation word.** The verdict
  says the environment *"swings behind it"*, meaning helping. An early draft of
  the next sentence opened *"No single thing is behind it"*, meaning *is the
  cause of* — a private second meaning hung on a phrase the reader had learned
  four words earlier. The same draft ended *"a group of small ones"* without
  ever supplying the noun. Both were unreadable in exactly the way a generator
  cannot notice, because each sentence is defensible alone.
  `tools/test-env-health.mjs` sweeps every fixture for the collision rather than
  checking one storm, since it only appears where a run happens to draw both
  phrasings.
- No hedging stack. One verdict, stated once.

**When SHIPS is missing** the paragraph is replaced, not dropped — §5. A storm
outside the NHC basins says the data is not published there; a storm whose first
run has not appeared says so. Silence is the one forbidden outcome. **None of
those replacements says "SHIPS" at the reader** — they say *the intensity
model*, which is the same register the bottom line uses. The name is real
provenance and it belongs where the app puts every other source name: in the
footnote under the figures, *"From NHC's SHIPS intensity model."*

Built as three pure files, the clock and unit system arguments throughout so
every sentence they can say runs on plain node: `lib/env-series.js` (bands,
drawable hours, extremes, forecast hour to local time), `lib/env-verdict.js`
(the seven shapes and the verdict sentence, which also decides the one hour
every other figure is read at) and `lib/env-health.js` (the remaining three
sentences, the grid, the notes, the entry point). Imports run ONE WAY:
health → verdict → series. They were one file until it crossed §12's 700-line
ceiling, which is the whole reason the ceiling exists — three concerns had been
sharing a filename and nothing said so. Rendered by `ui/env-health.js`, a self-contained controller (state
machine, staleness binding, retry, HTML). `ui/view-storm-detail.js` is past the
file ceiling (§12) and holds only four seams: the section row, an ensure, a
wire, a repaint. The section is titled **Environment**, sits below the wind
field, and is ITS OWN GATE: it fetches the one selected storm's run when the
drawer opens — sharing `data/ships.js`'s per-advisory cache with the ribbon
through `loadShips`, cache-first and cache-filling — so the paragraph appears
whether or not the map layer is on, and a reader with the layer on pays nothing
twice. A silent or ended storm gets the same withheld note every other section
uses, never a paragraph claiming a current environment. The day-and-part
buckets are `lib/time.js` `formatDayPart`: local hour 0–5 "early <Day>", 6–11
morning, 12–17 afternoon, 18–23 evening. At most FOUR terms are named
(`ENV_HEALTH.namedTermsMax` and `namedPerSideMax`, ranked by magnitude, ties by
the parser's key order) — the selection rule all four acceptance cases
demonstrate. The room sentence's ceiling is `POT. INT.` at hour 0, carried by
the parser as `potIntNowKt`.

The generator returns three things, and **a build that renders the prose and
drops the grid has published the paragraph with its figures missing**:
`sentences`, `figures` (`{when, total, cells:[{label, value}]}`) and `notes`.
The grid is `.detail-env-figs`, an `auto-fit` grid on a 140px minimum so it
lands on two columns at phone width and three or four in a desktop drawer with
no media query deciding it — the mockup's fixed four columns put one factor name
on three lines beside a neighbour on one, which reads as a broken table. Its
register is deliberately the opposite of the paragraph's: tabular numerals,
uppercase micro labels, no reading line height, so a reader scanning for what
one factor is worth never has to read a sentence to find it.

### 47.10 The fixtures

Fifteen files in `samples/ships/`, promoted by hand from the 2026 corpus branch
(§47.2). They are chosen to span the extremes a season actually produced, not to
be representative. A parser that handles all fifteen handles the season; the last three are §47.8's acceptance storms and anchor the health paragraph's figures as well.

| File | Why it is here |
|---|---|
| `26072706EP0726_ships.txt` | **The season's only major hurricane, at 140 kt.** Its environment runs −13..+3 on this run while headroom runs −83..−1 — the single file that proves the headroom exclusion (§47.4) and the file the dark-end ramp question (§47.5) has to be judged against. |
| `26080100EP0726_ships.txt` | The same storm five days later at 45 kt, its environment number reaching +26 kt — the most helpful this storm ever gets — with a `Storm Type` row that turns extratropical partway along. |
| `26080218EP0726_ships.txt` | The **only file in the season containing `SUBT`**, and it also carries `EXTP` and `TROP` in the same row. Full storm-type token coverage. |
| `26061618EP9326_ships.txt` | **The file where the two definitions of "drawable" disagree, and by 22 kt.** Its wind stops at +84 h while its position runs to +120 h, and the −52 kt this table used to call the season's most hostile drawable hour sits in that gap. Under §47.2's rule — where BOTH exist — it is −30. Under a position-only rule it is −52 and ties the Atlantic file below. **Undecided; the parser applies §47.2 and carries both ends so the layer can change its mind in one line.** |
| `26072012EP0526_ships.txt` | **Most helpful environment of any named storm in the season, +38 kt.** Bright clip case. Its winds and positions both stop at +60 h — an earlier version of this row said the winds ran further, measured wrong. |
| `26071600CP9126_ships.txt` | **Biggest headroom, +67 kt on a 25 kt system**, and the **biggest ocean-heat term that ever reaches the map, 4 kt** (the same file reaches 8 kt of magnitude at +168 h, where nothing is drawn — and it is −8, not +8, which this row previously had the wrong way round) — the Central Pacific case that falsified §47.3's old claim. |
| `26060618EP9126_ships.txt` | **No forecast position at all past hour 0** while still publishing winds. The run-exists-but-nothing-to-draw case (§47.6). |
| `26060618EP9226_ships.txt` | **Largest land-decay gap in the season, 42 kt** between `V (KT) NO LAND` and `V (KT) LAND`. The file that proves the contribution table does not explain the land forecast. |
| `26072112AL0226_ships.txt` | Atlantic named storm carrying the **basin-only eyewall block and its four extra rows**, including the second `TIME (HR)` that a naive label lookup reads instead of the first. |
| `26081406AL9226_ships.txt` | Atlantic invest tied for the most hostile environment at −52 kt, with the eyewall block and `LOST` in `MODEL VTX`. The second Atlantic shape, at the opposite extreme from the one above. |
| `26062506EP9426_ships.txt` | **Latest publication in the season — 446 minutes after its nominal hour.** The run that forces three synoptic slots (§47.2). |
| `26081106CP9326_ships.txt` | **Published 41 minutes _before_ its nominal hour.** A parser or relay that assumes lag is never negative gets this one wrong. |
| `26081506EP0826_ships.txt` | **§47.8 acceptance: Hernan.** Turning against with near-total agreement (push 1, pull −12 at the peak) and the far-below-ceiling, hostile-environment room case — 30 kt under a 139 kt ceiling. |
| `26081506AL9426_ships.txt` | **§47.8 acceptance: 94L.** Early help then turning against; strengthening IN SPITE of the environment (gains 35 kt against a hostile track — the storm that proves direction comes only from `V (KT) LAND`); nothing-dominates term spread; positions stop at +120 h while winds run to +168 (the partial-track note). |
| `26081506CP0126_ships.txt` | **§47.8 acceptance: Lala.** Brief dip then turning for; one term carrying the whole net (cold air aloft 12 of 12 kt); the closer-to-ceiling room case. |

---

## 49. Time has a direction

### 49.1 Why this exists

**The home dashboard has no memory.** Every figure on it is computed from where
the storm is *right now* plus where it is forecast to go. The moment a storm is
past the house, every one of those figures collapses onto the present and the
screen starts telling a reader that the closest the storm ever came is exactly
where it is standing.

Seen on glass 2026-08-16, Lala against a Big Island home, after she had gone by:

- **CLOSEST IT CAME — 138 mi WNW of home** is the current distance.
- **WHEN IT WAS CLOSEST — 69 mph** is the current wind, identical to the NOW
  column beside it, which reads as a rendering fault even though each number is
  individually correct.
- **The Timeline's first two rows both said `now`** and one of them was the
  closest pass.
- **The chart's left edge is the present**, so the entire approach — the part
  the reader lived through — is off-frame.
- **"On this forecast no tropical-storm wind reaches you. The nearest edge stays
  27 mi off."** This is the dangerous one. It is a statement about the remaining
  forecast, worded as a statement about the storm, printed under a storm whose
  wind field may already have crossed the house.

Only the chip was right: **Moving away**.

**The cause is one rule and one function.** `closestApproach()` in
`data/home.js` skips every track candidate behind the clock — the code says so
deliberately: *THE PAST IS NOT AN APPROACH.* That rule was written for a real
problem (neither source's track starts at "now", so the raw minimum kept landing
behind the storm and reading as a future approach) and it is correct for
forecasting. It is wrong for reporting. Underneath it, `formatUntil()` in
`lib/time.js` had **no past branch at all** — a negative interval fell through
the "less than two minutes ahead" case and returned `'now'`, so every past moment
anywhere in the app rendered as `now`. That half is fixed and now lives in
`SPEC-UI.md` §49.4; the observed track it needs reaches the dashboard as
`SPEC-DATA.md` §49.3; the pass, the peak and the rungs that describe the past
are built as §49.5, §49.6 and §49.14; and the rail and the chart are built as
§49.7 and §49.8. The wind corridor's past arm — §49.9 — does not exist yet, and
it is the safety-adjacent one.

### 49.2 The rule this section adds

**Two facts, never merged, never inferred from each other:**

| | |
|---|---|
| **Closest it came** | past tense · observed position · analysed wind · no error band |
| **Closest it will come** | future tense · forecast position · forecast wind · error band |

A storm approaching has only the second. A storm gone has only the first. A
storm mid-pass has both and must show both. Nothing on any screen may present
one of them in the other's words.

**DERIVE, NEVER RECORD.** The past figures are computed from the storm's
published observed track measured against wherever home is *at render time* —
exactly the way the forecast figures already work. Nothing stores "the closest
it came" anywhere. This is the whole answer to moving home (§49.10) and it is
also the only design that survives the app not having been open.

**THE ERROR BAND NEVER TOUCHES AN OBSERVED POINT.** `lib/cone-error.js`
describes forecast error. A past position is a measurement. The dashboard
already has this case for a pass happening now (`bandUnavailable:
'pass-is-now'`); the same suppression extends backwards, and it is a rule rather
than a convenience — a two-thirds circle drawn around a place the storm
*actually was* is a fabricated uncertainty.

### 49.5 The closest pass, backwards

**BUILT.** `closestPassed()` in `data/home.js`, exposed as `dash.passed`.

`closestApproach()` was not widened. **Two functions, two objects, because they
are two facts and the caller must not be able to render one thinking it has the
other.**

- `approach` — unchanged. Current position plus forecast, past candidates
  skipped, refined by the ternary search, error band eligible.
- `passed` — the same walk over the observed track, ending at the current
  position. Returns `nm`, `time`, `windKt`, `bearing`, plus
  `windSource: 'analysed'`. Null when the storm has no observed track or has
  never been inside `APPROACH.relevanceNm`.

**ONE COPY OF THE GEOMETRY, TWO CALLERS.** `walkToClosest()` holds the densify,
the scan and the ternary refinement; the only thing the two callers differ in is
an `eligible(index, point)` predicate — the forward walk skips samples behind
the clock and exempts index 0, the backward walk drops samples ahead of it. A
second implementation is how the forecast pass and the observed pass, which
appear on one screen four lines apart, come to disagree about the same house.

**THE TWO WALKS SHARE THE CURRENT POSITION AND THAT IS DELIBERATE.** It is the
one point that belongs to both — the end of what happened and the start of what
is forecast — and giving it to only one of them creates a gap or an overlap at
the exact moment the reader cares about. It is APPENDED to the observed track
rather than assumed to be on the end of it, because it is not: NHC's layer 10
runs to the synoptic analysis, up to three hours behind the advisory position.
Appending is skipped when the history already reaches the current time, so a
zero-length leg never lands mid-polyline.

**THE ERROR BAND CANNOT REACH IT, STRUCTURALLY.** `band` in
`data/home-dashboard.js` is computed from `approach` and only from `approach`.
There is deliberately no `passed`-shaped branch in that block, so §49.2's rule
is enforced by there being no code path rather than by a convention a later edit
has to remember. The headline prints one plain line in the band's place instead
of dropping the most prominent caveat on the screen silently.

**How far back:** the whole published track. Measured on Hurricane Ida against a
Prairieville home, her Advisory 19 (2021-08-30 21:00 UTC): she is 141.50 nm away
and down to 30 kt, and the closest she ACTUALLY came is **11.28 nm at
03:52:45 UTC**, seventeen hours earlier. The old screen printed the first number
under the words "Closest it came". `formatUntil`'s past arm (§49.4) renders it
as `17 hrs ago`.

**THE FIGURE IS PROVED, NOT PASTED.** `tools/test-home-ida.mjs` recomputes the
same minimum with an independent 20,000-step brute force over the same polyline
and asserts agreement to 0.01 nm and one minute. Strip the ternary refinement
and it reports the best SAMPLE instead — the §4 bug — and the assertion goes red.

**The headline word follows `dash.stage`**, and the ladder gained a rung for it
— see §49.14.

### 49.6 Strongest means strongest, over the whole life

**BUILT.** `dash.peak` is the maximum over the observed track, the current wind,
and the forecast — the storm's entire published life. It was taken over the
forecast plus the present wind only, so a storm that peaked before it reached
the house reported a peak it had already passed as though it were still coming.

**THE ORDER IS THE TIE-BREAK AND IT RUNS OLDEST FIRST:** observed, then now,
then forecast, each replacing the incumbent only on a STRICTLY greater wind. So
a storm holding one speed across all three reports the earliest moment it
reached it, which is the true answer to "when was it strongest" — a later moment
at the same speed is not stronger.

`peak.when` gains a fourth value, **`'past'`**. It is the field every tense on
the screen is chosen from, so a peak behind the clock says so itself rather than
having a view infer it from a timestamp.

Consequences, all built:

- **The STRENGTH block's third column changes tense.** `Strongest` becomes
  `Was strongest`, and `before it reaches you` becomes `before it reached you`.
- **`dash.peakWhenPassed` is a separate field from `dash.peakWhen`**, not a
  widened one. The first dates the peak against the pass that happened, the
  second against the pass that is forecast. "Before it reaches you" and "before
  it reached you" are different claims about different events (§49.2).
- **`dash.atClosest` splits with the pass.** `atPassed` samples the OBSERVED
  track at the observed pass; `atClosest` still samples the forecast at the
  forecast pass. Past intensity is the agency's analysis of what the storm did
  and beats a forecast for the same hour. Null for most GDACS history, which
  publishes positions and times and no per-point wind — the cell then does not
  render, which is the honest shape of that answer rather than a borrowed
  figure. **The end of the observed track is the current position**, whose wind
  lives on the storm rather than on the curve, so a pass landing at or after the
  last published fix reads the storm's own reading.
- **"It weakens on the way in" and its two siblings are suppressed once the way
  in is over.** All three are the future tense computed from the forecast wind
  at the forecast pass, which for a departed storm is the current position — so
  under a storm that went by yesterday the strip offered *It holds its strength
  all the way in* about a trip that had finished.

**Measured on Ida's Advisory 19:** peak **130 kt at 1200 UTC 29 August**,
`when: 'past'`, `peakWhenPassed: 'before'` — she was weakening as she went by.
`samples/ida-al092021/tcr-AL092021_Ida.txt` states that peak in words and the
test asserts against the report, so the app has to agree with NHC rather than
with itself. Rebuild the same dashboard with no observed track and the peak
collapses to **30 kt**, which is what the old code saw.

**THE PEAK MILESTONE'S GATE IS OPEN BEHIND THE CLOCK.** `classMilestones` gated
its `peak` row on `when === 'forecast'` and a time ahead of the clock, so a past
peak produced no rail row — exactly as `when === 'now'` already did. §49.7's
pass opened it for `'past'`. `'now'` stays shut, and that subsection says why.

### 49.7 The Timeline rail keeps the past

**BUILT.** `data/home-dashboard.js` produces the rows; `ui/countdown-home.js`
chooses their words; `ui/home.css` draws the divider and dims what is behind it.

**The past is not dropped.** Three reasons, in order of weight:

1. **Dropping it deleted the section.** `countdownHtml` bailed on
   `rows.length <= 1`. A fully-passed storm has no future events, so the whole
   Timeline silently vanished — the §5 failure, on the screen about the storm
   that just went by the house.
2. **The rail is the accessible form of the chart.** A screen reader cannot
   explore an SVG. If the past is not in the rail it does not exist for that
   reader.
3. **It is nearly free.** The rail carries *events*, not track points — class
   changes, the pass, wind arriving and lifting. A six-day storm has four or
   five behind it, not thirty. Every row already carries an absolute `at` and
   the rail already sorts on it.

**THE PAST ROWS ARE MADE, NOT KEPT, AND THAT IS THE PART THE PLAN HAD WRONG.**
The rail was not filtering the past out; nothing was building it. The class
walk ran over the forecast curve only and gated on `ms >= now`, and the peak
row gated on `when === 'forecast'`. So the work is in `data/home-dashboard.js`,
which the pass table (§49.13) did not list.

- **One walk, two callers.** `walkClasses(points, baseline, keep, when)` runs
  over the forecast curve from the storm's current class, and over the observed
  track from nothing — a `null` baseline means the first fix sets the class and
  emits no crossing of its own, which is right for a history whose first point
  is the storm's first published position and wrong for a forecast that
  continues from what the storm is now. Same dedupe, same two-steps-at-once rule.
- **Every row carries `when`**, `'forecast'` or `'past'`, stamped where the
  crossing was found. The rail picks its TENSE from that field rather than
  comparing `at` against `now`, so the words and the filter that produced the
  row cannot disagree — the §49.1 failure, where an honest past lead time sat
  beside a future-tense verb.
- **The peak gate is open behind the clock.** `when === 'past'` now emits a
  row. `when === 'now'` stays shut: it means the storm is at its strongest
  right now, so the row would land on the divider and repeat what the strength
  strip says two inches higher.
- **The forecast pass row is suppressed once it is not ahead of the clock.**
  Not in the original plan, and it is the same bug pass 3 fixed on the
  headline: `closestApproach` walks forward from the current position, so a
  leaving storm's "closest pass" is where it is standing. On Ida's Advisory 19
  the rail printed *Closest pass — 163 mi NNE of you, now* two rows under
  *Closest it came — 13 mi ENE of you, 17 hrs ago* — one fact in the other's
  words, which §49.2 forbids. Kept whole for a storm with no observed track,
  where there is no truer row to fall back to.

**A `now` row, not a circled node.** The rail's dots are already coloured by the
storm's category at that moment (`categoryColor`); ringing one to mean "you are
here" overloads a signal that already means something else.

**AND IT IS THE ROW THAT WAS ALREADY THERE.** The plan asked for a divider —
a thin rule, a hollow node, no category colour, sorted in by time. The
live-distance row is already exactly that: it sits at the clock, its lead
already reads `now`, and it carries no tone. So it *becomes* the divider rather
than gaining a bare one beside it, which would have put two rows at the same
minute on a list whose whole job is order. A dashboard with no live distance —
no usable position published — gets a bare divider instead, so the reader can
still see which side of the list they are standing on.

**THE RULE RUNS OUT OF THE WORD: dot, then `now`, then the line.** It shipped
once as a `border-top` on the row, which put the line above the node and made
three stacked things out of one. Aaron's call on glass. The lead is a flex row
and the rule is its `::after` taking the remaining width, so it centres on the
same line box `--rail-node-top` centres the node against — the dot, the word
and the line cannot drift apart at another type size or on another platform's
line-height resolution.

- **Rows above it are dimmed** by `[data-when="past"]`, at 0.62 opacity.
  Opacity rather than a second colour set: every row's colour means something
  (the threshold ramp on the wind rows, Saffir-Simpson on the pass and the
  class changes), and recolouring the past would either throw that away or
  invent a second ramp. Dimming lowers the voice without changing the word.
- **One list, not two.** Past is an attribute on the `<li>`, not a separate
  section — a screen reader gets one ordered sentence: *…became a hurricane,
  3 days ago … closest it came, 17 hrs ago … now … weakens to a depression,
  in 9 hrs.*
- **The section's gate counts EVENTS, not rows.** `rows.length <= 1` counted
  the divider as content, so a single event on a dashboard with no live
  distance was swallowed.

**THIS IS A NAMED EXCEPTION TO THE RAIL'S OWN RULE.** `ui/countdown-home.js`
states that the rail carries events only and that anything without a time does
not belong. `now` is not an event; it is a *moment*, and this rail is ordered by
moment. The exception is written down here so it does not later look like drift.

### 49.8 The chart's left half

**BUILT.** `ui/chart-home.js`, fed by `dash.pastSamples`.

`ui/chart-home.js` already drew a dotted vertical at `X(0)` labelled `now`,
already tested whether it fell inside the frame (`nowShown`), and already
plotted in hours-from-now — so negative hours land to the left with no new
machinery. The line was pinned to the left edge only because there was no data
behind it.

**THE SERIES IS COMPUTED IN `data/home-dashboard.js`, NOT HERE.** `pastSamples`
is the observed track as hours-from-now against distance-from-home — the same
two fields the corridor's samples carry, so one `X`/`Y` pair plots both. The
chart imports `config/` and `lib/` and does no arithmetic of its own, which is
the rule that keeps its figures testable. It is deliberately not part of the
corridor: the corridor answers what the WIND does, and the past wind field is
§49.9's pass. This is the centre only, which the observed track always carries.

**HOW FAR BACK — TWO CUTS, AND BOTH ARE LOAD-BEARING.**

- **Time.** `HOME_DASH.chartPastHours` (12) is a floor, widened to a past
  closest pass plus `HOME_DASH.chartPastPassMarginHours` (6) when the pass is
  older than that — so the moment the screen is about is never off the left
  edge, with one synoptic step of run-up visible before it. **Twelve is a glass
  call, down from twenty-four:** a full day of history read as too much, and
  every hour of it comes out of the wind bars and the approach on the right.
- **Distance.** The same `limit` the forecast side is cut at
  (`nearRingNm × chartWindowRings`). Without it the picture rescales itself: a
  storm 800 nm away yesterday sets `nmMax` to 800 and flattens today's approach
  into the bottom two pixels. The walk keeps the most recent contiguous run
  inside the window, so the vertical axis means what it meant before and two
  screenshots an hour apart stay comparable.

**THE THREE NUMBERS LIVE IN `config/constants.js`.** `chartWindowRings` used to
be a local `WINDOW_RINGS` in the chart; it moved, because the three of them
together decide the shape of one picture and reading them in two files is how
they drift.

**Solid left of `now`, dotted right of it**, matching §46.2's house style for
observed-versus-forecast so the app has one visual grammar for the distinction
rather than two. **This changes every chart, not only a departed storm's:** a
track entirely ahead of the clock is entirely a forecast and was being drawn as
though it were a measurement. The seam is the corridor's first sample, which is
the advisory position and up to three hours behind `now`, so a short dotted
sliver can sit just left of the line — splitting the polyline at exactly h=0
would mean interpolating a position nobody published to move a line style by
three hours.

**The uncertainty band is drawn only right of `now`.** Per §49.2. The
earliest-arrival line is NHC's track error applied to their wind radii; left of
the present there is no forecast to be wrong, only positions the storm was
measured at, and a hedge over a measurement is a fabricated uncertainty.

The closest-pass stamp's collision logic against the `now` label already
handles the two verticals landing on top of each other and gets a second header
row for it. That case now happens on every storm mid-pass rather than one in a
hundred, so it wants a look on glass.

**`[VERIFY]` — A FULLY-PASSED STORM STILL DRAWS NO CHART, AND THAT IS NOT THIS
PASS.** `homeChart` returns `''` without a corridor, and a storm late in its
life stops publishing wind radii — Ida's Advisory 19 has none. So the rail has
her whole story and the picture beside it is absent. Pre-existing, orthogonal to
the domain work, and the fix belongs with §49.9's reading of the past wind field.

### 49.9 The wind that already reached you

**The safety fix, and the largest piece.** `buildCorridor()` walks the forecast
track and the forecast wind radii and answers *does dangerous wind reach my
house, when does it start, when does it lift*. Everything it says is
forward-only, and the headline sentence it feeds — **no tropical-storm wind
reaches you** — is printed with no tense marker on a storm whose wind field may
already have been over the roof.

**The past wind field is already downloaded.** `SUMMARY_LAYER.windPast` (layer
13) is fetched on every NHC bundle and currently feeds nothing but the drawn
swath. `lib/windswath.js` already performs the exact join this needs: **layer 13
carries `radii`, `ne`/`se`/`sw`/`nw` and a `synoptime` STRING; layer 10 carries
a `dtg` NUMBER of the same ten digits; the two join on that value.** Radii with
no joinable centre are dropped, because a ring with no stated centre cannot be
placed.

The corridor gains a past arm built from that join, using
`normalizeForecastRadii`'s output shape keyed on time instead of `tau`, and the
sentence splits by what is true:

- Wind reached the house and has lifted → **past tense, with when it started and
  when it ended**, and it must not be possible to render the forward sentence
  instead.
- Wind is on the house now → present, unchanged.
- Wind has not arrived and is forecast to → future, unchanged.
- Wind reached the house earlier *and* is forecast to again → both, in order.
- Never reached and is not forecast to → the current all-clear wording, which is
  only now actually true.

**`[VERIFY]` — LAYER 13 HAS NEVER BEEN READ FIELD-BY-FIELD OFF REAL BYTES.**
Its shape above is taken from `lib/windswath.js`, which consumes it successfully
in production, so the field names are trustworthy and the *coverage* is not:
nobody has confirmed how far back layer 13 publishes, whether it carries all
three thresholds at every synoptic hour, or what it does across a basin change.
**Add it to `tools/archive-fetch.mjs` and read a real file before building this
pass.**

**`[DECIDE]` on partial coverage.** If layer 13 goes back only a few synoptic
hours while layer 10 goes back to genesis, the corridor's past arm is shorter
than the observed track and the honest answer is a stated horizon — *we can
speak for the last N hours* — not a silent shrug. The wording is a glass call
once the real coverage is known.

**GDACS PUBLISHES NO PAST WIND RADII AT ALL.** `data/gdacs-geometry.js` sets
`windPast: NONE()` and that is correct, not a gap in our parsing. So this arm is
NHC-only and a GDACS storm says plainly that no past wind field was published
rather than showing an empty corridor. Per SPEC.md's both-sources rule the two
may ship in separate passes, but the GDACS sentence ships **in the same pass as
the NHC one** — an unhandled source here is a silent all-clear, which is the
exact failure this whole subsection exists to remove.

### 49.10 Moving home is not an edge case

Home is one point in `localStorage` (`data/home.js`), and every figure derived
from it is computed at render time from `getHome()`. Nothing caches a distance,
a bearing, a closest pass or a corridor. **So §49 requires no work for a moved
home beyond not introducing any.** Move the pin and the next render measures the
same published tracks against the new point and is immediately correct.

**The design that would have broken is recording.** Watching the distance tick
down and storing the minimum observed — *at 4:36 PM we saw 42 mi* — is wrong
three ways: it is wrong after a home move, it is wrong on a second device, and
it is wrong whenever the app was closed. It is not built and must not be.

**The ended-storm registry is not an exception.** `data/lifecycle.js` stores a
compacted copy of a dead storm's track so the map can still draw it after the
source drops it. That is a record of **the storm**, not of the home, so it
survives a move intact and the derived figures recompute off it correctly.

### 49.11 Fixtures

**Ida is the fixture, and she is already in the repo.**
`samples/ida-al092021/fstadv/` holds 19 sequential forecast advisories for a
real major hurricane that really passed over the Prairieville home
`tools/test-home.mjs` already uses, and `mockups/home-corridor.html` already
renders her Advisory 12 and 14. Stacking the position and wind at issue time
across advisories 001…N produces a **real observed track with real analysed
winds**, and running the dashboard at Advisory 17 — where she is inland and past
the house — gives every past-tense case at once: a closest pass behind the
clock, a peak behind the clock, wind that arrived and lifted, and a forecast
that still has hours left in it.

Bertha's Advisory 10 stays the forward-only fixture, unchanged, so a break in
the existing assertions can only be a regression rather than a fixture change.

**Every new rule gets mutation-tested.** Reintroduce the bug and confirm the
assertion actually fails. A test that passes on the same wrong assumption as the
bug is worse than no test — and the specific trap here is a fixture whose `now`
sits at a moment where past and future happen to agree.

### 49.12 Open questions for glass

1. **Does the `now` divider read as a divider or as an event?** It is the one
   row on the rail that is neither.
2. **How long is too long?** With the past kept, a six-day storm's rail may run
   past a phone screen. The designed cut, if one is needed, is intermediate past
   milestones — **never** the past closest pass and never the wind that reached
   the house.
3. **Do dimmed past rows read as history, or as disabled?** Dimming is the app's
   language for *unavailable* elsewhere.
4. **At phone width, with a week of history and five days of forecast**, does
   the chart still show the pass at a legible size, or does the lookback need
   capping harder than §49.8 proposes?
5. **Two verticals on top of each other** — the mid-pass case is now common. Is
   the second header row enough?
6. **Does `Was strongest` beside `Strongest` in the same block read as one fact
   in two tenses, or as two different facts?**

### 49.13 The passes

Three passes plus one piece of housekeeping, each shippable on its own and each
leaving the app more correct than it found it. They keep the numbers they were
given, because those numbers are how they are referred to; pass 1 landed as
`SPEC-UI.md` §49.4, pass 2 as `SPEC-DATA.md` §49.3, pass 3 as §49.5, §49.6 and
§49.14, and pass 4 as §49.7 and §49.8 above.

| Pass | Scope | Files |
|---|---|---|
| ~~**3. The pass and the peak, backwards**~~ | **DONE.** `closestApproach` gained a sibling `closestPassed`; the peak spans the whole life; `atClosest` split; the headline, the strength block and the chip got their tenses. Ida fixture landed. | `data/home.js`, `data/home-dashboard.js`, `ui/view-home.js`, `tools/test-home-ida.mjs` |
| ~~**4. The rail and the chart**~~ | **DONE.** Past class crossings and the past peak are BUILT (they were never being filtered out — nothing made them); every milestone carries its own tense; the live-distance row became the `now` divider; past rows dimmed; the forecast pass row suppressed once it is no longer ahead; chart domain extended left with two cuts; solid/dotted split; hedge suppressed left of `now`. | `data/home-dashboard.js`, `ui/countdown-home.js`, `ui/chart-home.js`, `config/constants.js`, `ui/home.css`, `tools/test-home-ida.mjs` |
| **5. The wind that already reached you** | Layer 13 read off real archived bytes first, then the corridor's past arm and the split sentence. GDACS's honest gap ships in the same pass. | `tools/archive-fetch.mjs`, `data/home-corridor.js`, `data/nhc-mapserver.js`, `ui/view-home.js` |
| **0. Housekeeping** | `lib/windswath.js`'s doc comment names layers `+7`, `+10`, `+12`, `+13`, `+2` for tiers whose real ids in `SUMMARY_LAYER` are 10, 13, 15, 16 and 5. As-built rule: fix the comment. Can ride along with any pass. | `lib/windswath.js` |

**PASS 4's FILE LIST WAS WRONG WHEN IT WAS WRITTEN, AND THE REASON IS WORTH
KEEPING.** It named the two views, the constants and the stylesheet, on the
premise that the rail was dropping past rows. It was not — nothing was
producing them. A plan that describes a filter where the real problem is an
absence points the next session at the wrong file.

### 49.14 The rungs that describe the past

**BUILT, and it is a correctness fix rather than a copy change.**
`dash.stage`'s past rungs were judged on `approach.nm` — the FORECAST approach —
and for a storm that has already gone by, `approach` is pinned to the current
position. So "how close did it get" was being answered with "how far away is it
now".

Three days after a storm went twelve miles past the house, `approach.nm` was
several hundred miles, the near-ring test was false, and the storm fell all the
way through to `far-off`: the rung that sets `dash.far` and hides the entire
closest-pass section. **The screen about the storm that just went over the house
had the least on it.**

The same two questions are now asked of `passed`, which is a measurement and
does not move as the storm leaves. Same `HOME_DASH.nearRingNm`, same
`HOME_DASH.afterCpaHours` split, same order — the observed rungs sit BELOW the
forecast ones deliberately, because a storm still closing has a future worth
leading with even if it has been near before.

**`past` USED TO CARRY TWO FACTS AND ONE WORD, AND NOW CARRIES ONE.**

| Rung | Chip | What it claims |
|---|---|---|
| `just-passed` | *Just passed you* | a real close pass, inside `afterCpaHours` |
| `gone-by` | *It's been by* | a real close pass, further back than that |
| `past` | *Moving away* | nothing about this house — only which way the storm is pointed |

`gone-by` is new. It is a statement about something that happened to THIS house;
`past` is a statement about the storm's heading. "Moving away" was only ever
true of the second. All three stay `calm` — none of them is a warning.

**`dash.far` needs no separate fix.** The observed rungs return before the
ladder reaches `far-off`, so a storm that came near and left is no longer
collapsed. A storm whose closest observed pass was outside the near ring still
reads `far-off`, which is honest: it never came near.

**Measured on Ida against Prairieville.** Advisory 18, eleven hours after the
pass: `just-passed`. Advisory 19, seventeen hours after it: `gone-by`, and
`far === false`. Rebuild either with no observed track and the ladder cannot
reach a past rung at all — the mechanism of the bug, asserted rather than
described.



---

## Where these came from

Every endpoint above was fetched and inspected live. Two things could not be
verified and are flagged where they appear: `nowcoast.noaa.gov` was unreachable
throughout the research session, and the ADT filename convention outside the West
Pacific is untested.

Sources that were investigated and are **not** proposed here, so the next session
does not re-research them: NHC wind speed probabilities (layers 394–397, real and
useful, lower priority), arrival time of TS winds (layers 18/19/20, already noted
in NOW.md), storm surge (held for a storm near home), aircraft reconnaissance
(`nhc.noaa.gov/text/URNT15-USAF.shtml`, spectacular and extremely seasonal),
HURDAT2 historical analogs (a Home feature, not a storm feature), NDBC buoys and
CO-OPS tide gauges (US coastal only), and ECMWF Open Data ensemble tracks
(`data.ecmwf.int`, genuinely the best global model product and genuinely BUFR,
which needs a binary decoder this project has no place to run).
