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

Plain fixed-width text, 9–17 KB, no auth, reissued each synoptic hour (~6 h).
One file carries the entire environmental picture for one storm, which is why
this is a single integration rather than four.

**There is no `latest` alias, and this shapes the whole integration.** Filenames
are `YYMMDDHH` + storm id + `_ships.txt` — `26081506EP0826_ships.txt` is Hernan
at 15 Aug 2026 06 UTC, and the 12 UTC run is a different file at a different
address. Anything reading SHIPS either builds the name from a synoptic hour and
handles the miss, or reads the directory index. Files appear one to two hours
after their nominal time, so the newest slot is usually not published yet.

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

**What the real bytes contain, measured against seven live files on
2026-08-15.** Every one of these has been observed and a parser meets all of
them or it is not finished:

- `N/A` fills every column past the end of a short forecast — Hernan's file
  stops at +60 h and the remaining nine columns are all `N/A`.
- `LOST` appears in `MODEL VTX` where the model loses the vortex.
- `xx.x` and `xxx.x` replace latitude and longitude past +120 h **while the
  data columns keep publishing numbers to +168 h.** The ribbon can only be
  drawn where a position exists, so it stops at +120 h regardless.
- The basin in the header text is unreliable: Lala's file is headed `EAST
  PACIFIC` while her id is `CP012026`. The id is the truth.
- Invests get full SHIPS runs (`AL942026`). So do 80- and 90-numbered test
  systems. Neither is in the app's storm list.
- Sections vary between files. 94L's carries a secondary-eyewall block and a
  DSHIPS eyewall-replacement table that the other files lack, so nothing may
  assume section order or presence.
- SHIPS can be **newer than the advisory** — Lala's 06 UTC SHIPS against her
  00 UTC advisory. The ribbon therefore matches the drawn track by forecast
  hour, never by SHIPS's own coordinates, or the colour drifts off the line.

Archived hourly to `origin/archive` under `latest/ships/`, with the stext
directory index archived beside it under the name `nhc-ships-index`. Roughly
half of each run's requests are expected to 404 because two synoptic slots are
requested and usually only the older one is published; a run where **all** of
them fail is the signal.

### 47.3 Ocean heat for the rest of the world — investigated, not adopted

`https://erddap.aoml.noaa.gov/hdb/erddap/griddap/TCHP` is NOAA AOML's global
0.25° tropical cyclone heat potential, point-queryable as JSON, and it was the
proposed fallback for basins SHIPS does not cover.

**It is not being built.** Measured against the real contribution tables, ocean
heat content never moved any of the three sample storms by more than one knot at
any forecast hour. It matters for large slow storms that churn cold water up,
which is a minority case, and a reduced ribbon carrying only the weakest term
would be a worse statement than an honest absence. AOML also states the dataset
is not maintained operationally.

Recorded here so the next session does not re-research it.

### 47.4 What the colour means

**The model's own accounting, in knots. Not an index of our own.**

Every SHIPS file publishes what each factor is worth in knots, cumulative from
now, and those columns sum exactly to the intensity forecast — verified against
94L, whose factors total +45 kt while its wind goes 25 kt to 70 kt. So the model
weights its own terms and the app does not invent weights.

The terms are split into three groups, and **only the first is coloured**:

1. **The air and sea.** Shear (three published rows, summed — it is one thing to
   a person), 200 mb temperature, theta-e excess, mid-level RH, environmental
   vorticity, 200 mb divergence, low-level temperature advection, ocean heat
   content. Their signed sum is the ribbon.
2. **Water headroom** (`SST POTENTIAL`). Shown as a figure, never coloured.
3. **The storm's own structure** (vortex tendency, satellite predictors, RI
   potential, persistence, climatological terms). Shown as a figure, never
   coloured.

**Water headroom is excluded on purpose and this is the single most important
decision in the section.** `SST POTENTIAL` is not a measure of the sea — it is
how far below its own ceiling the storm currently sits. A 25 kt blob over 29 °C
water scores +45 because it has nowhere to go but up; a Cat 4 already near its
ceiling scores near zero over the same water. Colouring by it means the ribbon
**dims exactly when a monster is at its most dangerous.** Including it also
inverts the honest answer: with headroom in, 94L reads +38 kt and looks like the
healthiest environment of the three; with it out, 94L reads −7 kt and the air is
in fact mildly against it. It intensifies because it is small and over hot water,
not because its surroundings are good.

Measured range across the three sample storms: −11 kt to +12 kt.

Scale −15 to +15 kt. Band names, which drive the **words** and no longer the
colour: tearing it down (< −8), working against it (< −3), neutral (< +3),
helping (< +8), feeding it (≥ +8).

**Agreement** — the net divided by the total push and pull — is carried in words
only. A storm can net near zero because nothing is happening or because a great
deal is happening in both directions at once, and the drawer says which. It was
prototyped as a second map mode and cut: it shared the ramp with the net, so
bright meant "good for the storm" in one and "loud" in the other, and on a storm
where everything pulls down together the two modes painted opposite ends of the
same colours from the same data.

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

Ramp: ocean → indigo → violet, smooth, at 50% fill. Three stops rather than two
because a brightness-only ramp moves one channel while a hue shift moves two.
The dark end is the ocean colour rather than a grey, so a hostile stretch
dissolves into the sea instead of sitting on it as haze. Violet is the one hue
nothing else on the globe uses — not a category, not a watch or warning, not a
wind band, not the genesis teal. **Open caution: its bright end sits near Cat 5
magenta and wants checking against a real Cat 5 before it ships.**

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
before its first run — says so in the same words rather than going blank.

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
