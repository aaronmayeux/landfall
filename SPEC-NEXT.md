# SPEC-NEXT.md — approved, not built

**This is §45–§47 of the Landfall spec.** Three features that are agreed and
specified but have not shipped. Each is written to be picked up cold by a future
session with no memory of the one that researched it.

**Why the numbering starts at 45 and not 38.** The live spec ends at §37, so 38
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

## 45. Genesis — the areas being watched

### 45.1 Why this exists

The app can be completely empty and completely wrong at the same time.

Measured, both fetches minutes apart:

```
GET https://www.nhc.noaa.gov/CurrentStorms.json
{ "activeStorms": [] }

GET .../NHC_tropical_weather/MapServer/3/query
Atlantic  2-day  0%  Low    | 7-day  40%  Medium
Atlantic  2-day  0%  Low    | 7-day  20%  Low
Pacific   2-day 20%  Low    | 7-day  80%  High
Pacific   2-day  0%  Low    | 7-day  20%  Low
Pacific   2-day 10%  Low    | 7-day  50%  Medium
```

Zero storms and an 80% chance of one forming, at the same instant. §5 says the
app never shows an all-clear it has not earned. An all-clear that is technically
true of *storms* while NHC is publishing five watched areas is exactly the kind
of honest-looking wrong answer §5 exists to prevent.

It is also the answer to the question the app gets asked most and cannot
currently answer: **where might the next one start, and when.** Genesis is not
forecastable months out — seasonal outlooks say how many, never where. Inside
seven days it is, and it is published as a polygon with a percentage on it.

### 45.2 Source — NHC, the two- and seven-day outlook

Same MapServer the cone already comes from. No new host, no new relay pattern.

`https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer`

| Layer | Name | Geometry |
|---|---|---|
| `399` | Seven-Day Outlook | group |
| `3` | Seven-Day: Potential Development Region | polygon |
| `2` | Seven-Day: Current Location | point |
| `398` | Seven-Day: Development Motion | line |
| `1` | Two-Day: Current Location | point |
| `0` | Graphical Tropical Weather Outlook | group |

**Layer 3 is the only one strictly needed.** Its fields, transcribed from the
live schema:

```
basin           string(12)   "Atlantic" | "Pacific"
prob2day        string(4)    "0%" .. "100%"
risk2day        string(6)    "Low" | "Medium" | "High"
prob7day        string(4)
risk7day        string(6)
idp_source      string(50)
idp_filedate    date         epoch ms
```

**The probabilities are STRINGS with a percent sign, not numbers.** `"40%"`.
Parse them; do not sort them as text or `"100%"` lands between `"10%"` and
`"20%"`.

One polygon carries both horizons, so the two-day and seven-day answer come from
a single query. Layers 1 and 2 are label anchors for the same features and are
only needed if the design wants a point to hang a number on.

`f=geojson` is supported. `maxRecordCount` is 2000. `idp_filedate` is the
publication stamp and is what the app ages the layer by — not the phone's clock,
per §17.7's rule about third clocks.

Basin values are `"Atlantic"` and `"Pacific"` — **not** the `AL`/`EP`/`CP` codes
used everywhere else in the app. Central Pacific appears under `"Pacific"`.
`[VERIFY]` — only Atlantic and Pacific have been seen in a live response; whether
CP is ever distinguished is untested.

Cadence: with the text outlook, roughly every 6 hours.

### 45.3 Source — JTWC, everywhere else

`https://www.metoc.navy.mil/jtwc/products/abpwweb.txt`

The Significant Tropical Weather Advisory. Plain text, no auth, fetched clean
over plain HTTPS with no certificate trouble. It is the only genesis product
found outside NHC that carries a probability. RSMC Nadi, Météo-France La Réunion
and IMD publish narrative bulletins with no structured formation odds at all, so
there is nothing better to reach for.

Structure, from a live bulletin: a WMO header (`ABPW10 PGTW 081500`), then one
block per system. Active storms are listed alongside numbered invests, each with
position, motion, and a development probability expressed as **LOW / MEDIUM /
HIGH within 24 hours**.

Reissued several times a day; the header carries the issue time and that is the
stamp to use.

**The two sources do not speak the same language and must not be forced to.**
NHC gives a percentage over two and seven days. JTWC gives a word over 24 hours.
Mapping `HIGH` onto some invented percentage would be inventing data, which §5
forbids. They render as what each source said, in one list, each labelled with
its own source and horizon.

### 45.4 What it draws

**On the globe.** A soft hatched patch per area. Deliberately **not** on the
Saffir-Simpson ramp — §6's colour contract is that those colours mean a storm of
a known strength, and a genesis area is the absence of a storm. A separate,
desaturated treatment keyed to the risk word: Low, Medium, High. Hatched rather
than solid because the boundary is genuinely fuzzy and a hard fill claims a
precision the product does not have.

Genesis areas sit **below** every storm layer in draw order. They never occlude
a real storm and they never compete for attention with one.

**In the drawer.** A second section below the storm list: **Being watched**,
with a count. One row per area, ranked by probability across both sources, each
row naming its source and horizon:

```
Eastern Pacific        80%  in 7 days      NHC
Central Atlantic       40%  in 7 days      NHC
Invest 98W           HIGH  in 24 hours     JTWC
```

Ranking two scales against each other is a judgement call, so it is written down
rather than left to whoever implements it: sort by probability descending, with
JTWC's HIGH/MEDIUM/LOW slotted at 70/40/10 **for ordering only**. That number
never reaches the screen.

**When there are no storms and no areas**, and both sources answered, that is
the real all-clear and the app may finally say it plainly.

### 45.5 Failure behaviour

Three states, per §5, and the genesis layer has its own set separate from the
storm list's:

- **unavailable** — the outlook query errored. Say which source. Never fall
  through to "nothing is being watched."
- **none_matched** — the source answered and published no areas. This is a real
  and common answer and is different from the one above.
- **clear** — no storms *and* no areas, from both sources.

**`overallStatus` must learn about this.** §5's existing note says it returns
`ok` rather than `clear` while ended storms are held, because a grey dot on the
globe contradicts an all-clear. A hatched genesis patch contradicts it the same
way. `[DECIDE]` — whether a watched area alone downgrades `clear` to `ok`, or
gets a status of its own.

### 45.6 Open questions for glass

1. **Does a hatched patch read as "nothing here yet"?** The risk is that it reads
   as a storm-shaped thing and undoes the app's clearest signal — that a coloured
   blob is a real cyclone.
2. **Does the drawer section earn its space in an active season?** With six
   storms up, five watched areas below them may be noise. It may need to collapse
   by default when storms are present.
3. **Two-day versus seven-day on the globe.** The polygon is the seven-day area.
   The two-day probability has no separate geometry. Showing one number on a
   shape drawn for the other is a possible lie. `[DECIDE]`.

### 45.7 Effort and risk

Low. The relay route, the GeoJSON path, the layer manifest entry and the drawer
section are all established patterns. The JTWC text parser is the only genuinely
new code and it is small.

The real risk is visual, not technical: this puts a new class of object on a
globe whose entire legibility rests on coloured blob = storm.

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

### 47.2 Source — SHIPS

`https://ftp.nhc.noaa.gov/atcf/stext/`

Filename: `YYMMDDHH` + basin (`AL`/`EP`/`CP`) + 2-digit storm number + 2-digit
year + `_ships.txt`. Confirmed live: `26080218EP0726_ships.txt`.
Fuller diagnostics with more predictors: `https://ftp.nhc.noaa.gov/atcf/lsdiag/`.

Plain fixed-width text, 9–17 KB, no auth, reissued each advisory (~6 h).

**One file carries the entire environmental picture for one storm**, which is why
this is a single integration rather than four:

- A per-forecast-hour table, 0 to 168 h: **shear speed**, **shear direction**,
  **SST**, potential intensity, 200 mb temperature, **mid-level RH**, **ocean
  heat content**, storm speed and position.
- Three intensity forecasts side by side: no-land, land-decay, and LGEM.
- `PRELIM RI PROB (DV .GE. 35 KT IN 36 HR)` — a single headline number.
- A **rapid-intensification probability matrix**: four models (SHIPS-RII,
  Logistic, Bayesian, Consensus) × eight thresholds from 20 kt/12 h to 65 kt/72 h,
  each with a "times climatological mean" comparison.
- A dry-air proxy: `%area of TPW <45mm upshear`.

**Do not go looking for shear anywhere else.** CIMSS's shear, Saharan Air Layer
and deep-layer-mean pages are rendered PNG charts for human eyes — there are no
numbers behind them to fetch, and reading values off an image is not a technique
this project uses. The GFS alternative means decoding GRIB2, which needs a binary
decoder and violates §2's no-build-step rule anywhere it would have to run.

**AL / EP / CP only.** This is the whole difficulty; see §47.5.

### 47.3 Source — ocean heat, for the rest of the world

`https://erddap.aoml.noaa.gov/hdb/erddap/griddap/TCHP`

NOAA AOML, via ERDDAP. Two variables: `Tropical_Cyclone_Heat_Potential`
(kJ/cm²) and `D26`, the depth of the 26 °C isotherm in metres. 0.25°, **global**,
daily. Point-queryable as JSON, which is the property that matters — one small
fetch per track point rather than pulling a raster.

Sea surface temperature says how warm the top few metres are. Ocean heat content
says how *deep* the warm water goes, and that is the number that decides whether
a storm churns up cold water and chokes itself. It is the better fuel gauge and
it is the one available globally.

**AOML states plainly that this is not maintained operationally and may have
gaps or delays.** It is a garnish, never a foundation. For NHC-basin storms
SHIPS already carries ocean heat content and is the better source; this exists so
a typhoon is not left with nothing.

### 47.4 What it draws

The forecast track line, today a single flat colour, becomes a gradient.

Walk the smoothed track — the same walk `lib/cone-sweep.js` already performs.
At each forecast hour, read shear, SST, ocean heat content and mid-level RH from
the SHIPS table, combine them into one favourable-to-hostile score, and paint the
line with it. Warm and bright where the storm has deep warm water beneath and
calm winds above; fading toward neutral grey where it meets shear or cool water.

Tapping a point on the ribbon gives the numbers behind that colour:

> Wed 8pm · 29 °C water · 35 kt shear · coming apart here

**The ribbon is not on the Saffir-Simpson ramp.** §6's category colours mean
observed strength; this means environment. Two meanings on one ramp would make
both unreadable. `[DECIDE]` — which ramp, and whether it survives beside the
category-coloured storm head at all.

**The scoring weights live in `config/constants.js`** with the rest of the
behavioural tuning, defined before the logic is written. No unexplained numbers
in feature code.

### 47.5 The coverage problem, stated plainly

**SHIPS covers the Atlantic, East Pacific and Central Pacific. Nothing else.**

That collides directly with §4's contract that a cyclone reads the same
everywhere — the reason model guidance draws for both sources and states its
reason where it cannot.

The ribbon gets the same treatment, and it is written down here so it is not
re-litigated at build time. **Two honest tiers, never one fake one:**

- **NHC basins** — full ribbon from SHIPS: shear, SST, ocean heat, dry air.
- **Everywhere else** — a reduced ribbon from AOML ocean heat and SST alone, in a
  visibly plainer treatment, with the row stating what is missing and why.

What must never happen is a ribbon that looks equally confident in both cases,
or a typhoon whose track quietly renders flat while a hurricane's glows. An
absence must be visible, per §5.

### 47.6 Performance

A per-vertex gradient down the track is more expensive than a flat line, and it
recomputes whenever the forecast updates rather than per frame. It must be baked
once on advisory change and cached with the track geometry, never recomputed on
zoom or rotate.

Same standing caveat as §46.6: the Windows blocking time and the MapLibre frame
cost are still unmeasured, and this is drawing work on the busiest surface in the
app.

### 47.7 Open questions for glass

1. **Does a gradient track still read as a track?** A line that changes colour
   along its length may read as two different things joined, especially beside
   the category-coloured storm head.
2. **Is one score honest?** Collapsing shear, heat and dry air into a single
   colour is a real simplification. It may need to be shear alone, which is the
   dominant term and the one a reader can name.
3. **The reduced ribbon must be visibly reduced.** If tier two looks like tier
   one it is a coverage claim the app has not earned.
4. **Does the RI probability belong on the ribbon or only on the chart?** It is
   the most alarming number in the file and the easiest to misread.

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
