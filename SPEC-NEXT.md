# SPEC-NEXT.md — approved, not built

**This is §46–§47 of the Landfall spec.** Two features that are agreed and
specified but have not shipped. Each is written to be picked up cold by a future
session with no memory of the one that researched it.

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
  category colours at low opacity. This is the load-bearing idea. The line
  crossing from one band into the next *is* the category change, so the chart is
  readable without reading the axis, and it is the same colour language as the
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
  This is what the layer colours by — see §47.4.
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
  layer says so (§47.6) rather than drawing a bare cone.
- **Storm Type leaves `TROP` inside the drawable window** on 2.7% of hours,
  across 37 files. SHIPS keeps publishing an environment for a system that is
  no longer tropical.
- The basin in the header text is unreliable: Lala's file is headed `EAST
  PACIFIC` while her id is `CP012026`. The id is the truth.
- Invests get full SHIPS runs (`AL942026`). So do 80- and 90-numbered test
  systems. Neither is in the app's storm list.
- **Sections vary by basin, not by storm.** All 60 Atlantic files carry a
  secondary-eyewall block and a DSHIPS eyewall-replacement table, and with them
  four extra rows — a second `TIME (HR)`, `18HR AGO`, `12HR AGO`, `6HR AGO`. No
  Pacific file has any of them. Nothing may assume section order or presence,
  and the second `TIME (HR)` means a parser keying on a row label must take the
  first match or it will read the wrong table.
- SHIPS can be **newer than the advisory** — Lala's 06 UTC SHIPS against her
  00 UTC advisory. The ribbon therefore matches the drawn track by forecast
  hour, never by SHIPS's own coordinates, or the colour drifts off the line.

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
season, ocean heat content is the weakest of the coloured terms: median 0 kt,
95th percentile 2 kt, worst observed 8 kt, and it exceeds 1 kt on only 7.8% of
forecast hours. It is also strongly basin-dependent — the Atlantic never saw it
worth more than 1 kt, the East Pacific 3 kt, and the Central Pacific 8 kt with
19% of hours above 1 kt. So it is small but not nil, and the earlier claim that
it never moves a storm by more than a knot was an artefact of three East Pacific
files.

The decision stands on the same ground it always did: a fallback ribbon carrying
only this one term, in basins where nothing else is published, would be a worse
statement than an honest absence. AOML also states the dataset is not maintained
operationally.

Recorded here so the next session does not re-research it.

### 47.4 What the colour means

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
storm approaching a coast the cone can honestly read "the air is helping" while
the sentence beneath it says the storm is about to be torn apart by the ground.
Both are true and the wording must not pretend otherwise.

**There are exactly 19 contribution rows.** All 19 are read, all 19 are placed,
and they are split into three groups of which **only the first is coloured**:

1. **The air and sea — coloured.** Ten rows: `VERTICAL SHEAR MAG`, `VERTICAL
   SHEAR ADJ` and `VERTICAL SHEAR DIR` (summed and spoken of as one thing, since
   shear is one thing to a person), `200/250 MB TEMP.`, `THETA_E EXCESS`,
   `700-500 MB RH`, `850 MB ENV VORTICITY`, `200 MB DIVERGENCE`, `850-700 T
   ADVEC`, `OCEAN HEAT CONTENT`. Their signed sum is the ribbon.
2. **Water headroom — shown, never coloured.** One row: `SST POTENTIAL`.
3. **The storm itself and the model's bookkeeping — shown, never coloured.**
   Eight rows: `MODEL VTX TENDENCY`, `GOES PREDICTORS`, `RI POTENTIAL`,
   `PERSISTENCE`, `DAYS FROM CLIM. PEAK`, `SAMPLE MEAN CHANGE`, `ZONAL STORM
   MOTION`, `STEERING LEVEL PRES`. The last three are neither air nor headroom —
   `SAMPLE MEAN CHANGE` is the model's climatological baseline and the other two
   describe where the storm is going, not what it is sitting in.

**The reconciliation rule, and it is a parser assertion, not a comment.** The
three groups must add back to `TOTAL CHANGE` at every forecast hour of every
file. Each published value is rounded to a whole knot, so nineteen of them
accumulate slop: across the season the residual was 95% inside ±2 kt and never
worse than ±4. **A residual outside ±4 kt means a row is in the wrong group or a
row exists that this section has never seen, and the ribbon is misreporting.**
The parser fails loudly on that and on any row label not in the list of 19.

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
be reporting the storm back to itself instead of reporting its surroundings.

**The scale is −15 to +15 kt, verified.** Across every hour the ribbon can
actually paint — named storms, position published — the air-and-sea number runs
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
The bands drive the **words** and no longer the colour.

**Agreement** — the net divided by the total push and pull — is carried in words
only, and the sentence is **required, not optional**. A storm can net near zero
because nothing is happening or because a great deal is happening in both
directions at once, and only the drawer can say which. This is not a rare case:
among hours reading neutral, 47% are genuinely quiet with under 5 kt of push and
pull, but **21% are loud — 15 kt or more fighting to a draw, up to 44 kt.** One
neutral cone in five is a knife edge. Agreement was prototyped as a second map
mode and cut: it shared the ramp with the net, so bright meant "good for the
storm" in one and "loud" in the other, and on a storm where everything pulls down
together the two modes painted opposite ends of the same colours from the same
data.

### 47.5 What it draws

**The cone fill, not the track line.** Settled on glass 2026-08-15 after a
line-only version proved unreadable at a glance.

SHIPS has no left-to-right information — one point per forecast hour, the storm
centre, and nothing about how the environment varies across the cone's width. It
cannot say the west half differs from the east. But each published number is
already an area average over a region a few hundred kilometres across, which at
most forecast hours is **wider than the cone itself** — Pacific cone radius is
46 km at 12 h and 256 km at 120 h. So painting the cone claims an area smaller
than the one the number came from, which is a more honest statement than a
hairline implying knowledge at a point.

The cone is sliced along its length, one fill per slice, colour driven by the
knots at that hour. The forecast track stays drawn as a bright core down the
middle so the line still reads as a line.

**Two channels, two meanings, deliberately separated.** Cone width and cone edge
carry "how sure we are *where*"; the fill carries "why". The edge keeps its own
neutral colour and is never touched by the environment, so the shape reads even
where the fill has fallen to nearly nothing.

Fill is drawn opaque inside a group carrying the transparency. Per-slice alpha
paints every shared edge twice and the cone comes out looking like corduroy.

Ramp: ocean → indigo → violet, smooth, at 50% fill. **Brighter is the
environment working for the storm; darker is it working against.** Three stops
rather than two because a brightness-only ramp moves one channel while a hue
shift moves two. The dark end is the ocean colour rather than a grey, so a
hostile stretch dissolves into the sea instead of sitting on it as haze. Violet
is the one hue nothing else on the globe uses — not a category, not a watch or
warning, not a wind band, not the genesis teal.

**Open caution, and the season moved it to the other end of the ramp.** The
worry was that bright violet would collide with Cat 5 magenta. It will not: on
the season's only major hurricane the air-and-sea number never rose above +3 kt
at any drawable hour, so the bright end is close to unreachable on a monster.
The real risk is the opposite. While that storm was Cat 3 or above the number ran
−16 to +7 with a median of −4.5, which on a ±15 ramp puts most of the cone in the
darkest third — and the dark end is deliberately the ocean colour. **A Cat 5 cone
will be nearly black down most of its length, and whether that reads as "the air
is against it" or as "this layer is broken" is a glass call that has to be made
before it ships.** If it reads as broken, the fix is the dark stop, not the scale.

Two things that argue it is fine as drawn: the number moved 13–21 kt along the
cone within a single major-hurricane run, so it is not a flat wash; and a major
hurricane read neutral only 19.9% of the time against 50% for the season, so the
layer is *more* expressive on a strong storm, not less.

Reference implementation: `mockups/environment-ribbon.html`, built on real
SHIPS numbers from 2026-08-15 06 UTC.

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

One text file per NHC-basin storm per advisory, cached in KV like every other
feed. Parsing happens in the relay; the browser receives a small JSON of
per-hour knots rather than a fixed-width table.

The cone fill is one geometry pass on an existing shape. It is drawn for every
storm that has a file, not only the selected one.

### 47.8 The storm health paragraph

The cone answers "helping or hurting" at a glance. It cannot answer **why**, and
it must never be read as a forecast — §47.4 excludes headroom and structure from
the colour precisely so it stays honest, which means the colour alone is an
incomplete story by design. The paragraph is where the rest of it goes.

Lives in the storm detail drawer, under the figures already shown there.

**Structure — five parts, in this order.**

1. **The verdict.** Is it strengthening or weakening, and is that *with* or
   *against* the air.
2. **What is working against it.** Named, largest first, in knots.
3. **What is working for it.** Same.
4. **Room and structure.** The two numbers the colour deliberately leaves out.
5. **The bottom line.** The published intensity forecast in plain words.

**Worked from real bytes — 2026-08-15 06 UTC. These are acceptance cases.**

> **Hernan.** Hernan is coming apart, and the air around it is the main reason.
> Shear is the biggest problem, costing 8 kt on its own, with weak outflow aloft
> and dry air taking 3 more between them. The only thing in its favour is moist
> warm air, worth 1. The sea below could support a 136 kt storm, so there is no
> shortage of fuel — Hernan simply cannot use it, and its own ragged structure
> costs another 10 kt. SHIPS has it falling from 30 kt to 22 kt by Tuesday
> evening.

> **94L.** 94L is strengthening in spite of the air, not because of it. Shear
> and a hostile background spin work against it, costing 5 kt between them. What
> carries it is room: a 25 kt system sitting over water that could support 152 kt
> is a long way below its ceiling, and that alone is worth 45 kt. Its own
> structure costs 3. SHIPS has it reaching 60 kt by Thursday morning — the air
> slows it down rather than stopping it.

> **Lala.** Lala is strengthening and the air is helping it along. Cold air
> aloft is the main reason, worth 12 kt, with shear easing to add 3 more. Dry air
> costs 2. It is closer to its ceiling than the other two, so there is less room
> to grow, and its own structure adds 7 kt. SHIPS has it reaching 72 kt by
> Thursday evening.

**Rules the wording obeys.**

- **Direction comes only from the published intensity forecast** (`V (KT) LAND`),
  never inferred from the environment sum. 94L is the proof: its air is against
  it at every hour past +72 and it gains 13 kt anyway. Any phrasing that reads
  the environment and announces an outcome would have been wrong about it.
- **Where land decay is doing the work, say so.** The contribution table explains
  the over-water forecast and not the land-decayed one (§47.4), so on a storm
  approaching a coast the cone can honestly show helpful air while `V (KT) LAND`
  falls away. When the two forecasts diverge by 10 kt or more at any hour — 25
  files in the 2026 season — the bottom line names the coast as the reason. It
  must never read as though the environment turned against the storm.
- **The agreement sentence is required, not optional.** Whenever the air sum
  lands in the neutral band, the paragraph says whether that is a quiet
  environment or a tug of war, because one neutral reading in five is 15 kt or
  more of push and pull cancelling out (§47.4). "Nothing much is acting on it"
  and "a great deal is acting on it in both directions" are different warnings
  and the same colour.
- Verdict cases, on the intensity change and the air sum together: strengthening
  with helpful air; strengthening in spite of it; strengthening while the air
  stays out of it; weakening because of the air; weakening despite decent
  surroundings; weakening for its own reasons. Roughly steady is its own case.
  A factor counts as taking a side at ±3 kt, matching the neutral band in §47.4.
- **Plain English names only, never the file's row names.** "Cold air aloft",
  not `200/250 MB TEMP`. The full mapping lives with the parser.
- Shear's three published rows are summed and spoken of as one thing.
- A term that rounds to zero is **omitted**, never listed as "0 kt". At most
  three named per side, largest first.
- Times are a local day and part of day. Never "+60 h" — that is the figures
  row's register, not this one.
- Room to grow is spoken as the sea's ceiling in knots (`POT. INT.`) alongside
  the storm's current strength, because "45 kt of headroom" means nothing and
  "a 25 kt system over water that could hold 152" means everything.
- No hedging stack. One verdict, stated once.

**When SHIPS is missing** the paragraph is replaced, not dropped — §5. A storm
outside the NHC basins says the data is not published there; a storm whose first
run has not appeared says so. Silence is the one forbidden outcome.

Built in `lib/` as a pure function from parsed SHIPS to sentences, so it is
testable without a DOM, and rendered by its own small view file.
`ui/view-storm-detail.js` is already past the file ceiling (§12) and nothing new
goes into it.

### 47.9 The layers row

```
Environment
Colours the cone by whether the air and sea are helping or hurting the storm.
```

Label and `note`, using the standing-caveat mechanism layer rows already carry.

The note is not decoration. "Environment" alone does not say what the colour
means, and this is the only layer in the app whose colour encodes a signed
quantity rather than a category — every other coloured thing on the globe is a
class of storm, a watch, or a wind band.

**The note also carries the absence**, replacing the description rather than
appending to it, so a storm with no data never shows a row that promises
something the map is not drawing:

- Outside the Atlantic and East/Central Pacific: *Not published for storms in
  this basin.*
- Inside those basins, before the first run appears: *No SHIPS run published for
  this storm yet.*

Default **off**, and grouped with the cone — it modifies the cone rather than
adding a shape, so it belongs beside the thing it changes rather than in a group
of its own.

### 47.10 The fixtures

Twelve files in `samples/ships/`, promoted by hand from the 2026 corpus branch
(§47.2). They are chosen to span the extremes a season actually produced, not to
be representative. A parser that handles all twelve handles the season.

| File | Why it is here |
|---|---|
| `26072706EP0726_ships.txt` | **The season's only major hurricane, at 140 kt.** Air runs −13..+3 while headroom runs −83..−1 — the single file that proves the headroom exclusion (§47.4) and the file the dark-end ramp question (§47.5) has to be judged against. |
| `26080100EP0726_ships.txt` | The same storm at 45 kt with the most helpful air of any named storm, +26 kt, and a `Storm Type` row that turns extratropical partway along. |
| `26080218EP0726_ships.txt` | The **only file in the season containing `SUBT`**, and it also carries `EXTP` and `TROP` in the same row. Full storm-type token coverage. |
| `26061618EP9326_ships.txt` | **Most hostile air that is actually drawable, −52 kt.** The dark clip case. |
| `26072012EP0526_ships.txt` | **Most helpful air, +38 kt.** Bright clip case, and its positions stop at +60 h while its winds run further. |
| `26071600CP9126_ships.txt` | **Biggest headroom, +67 kt on a 25 kt system**, and the **biggest ocean-heat term, 4 kt** — the Central Pacific case that falsified §47.3's old claim. |
| `26060618EP9126_ships.txt` | **No forecast position at all past hour 0** while still publishing winds. The run-exists-but-nothing-to-draw case (§47.6). |
| `26060618EP9226_ships.txt` | **Largest land-decay gap in the season, 42 kt** between `V (KT) NO LAND` and `V (KT) LAND`. The file that proves the contribution table does not explain the land forecast. |
| `26072112AL0226_ships.txt` | Atlantic named storm carrying the **basin-only eyewall block and its four extra rows**, including the second `TIME (HR)` that a naive label lookup reads instead of the first. |
| `26081406AL9226_ships.txt` | Atlantic invest tied for most hostile air at −52 kt, with the eyewall block and `LOST` in `MODEL VTX`. The second Atlantic shape, at the opposite extreme from the one above. |
| `26062506EP9426_ships.txt` | **Latest publication in the season — 446 minutes after its nominal hour.** The run that forces three synoptic slots (§47.2). |
| `26081106CP9326_ships.txt` | **Published 41 minutes _before_ its nominal hour.** A parser or relay that assumes lag is never negative gets this one wrong. |

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
