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

### 57.5 The record identifiers are the story's turning points

`L` landfall · `G` genesis · `I` a peak in both wind and pressure · `P` minimum
central pressure · `C` closest approach to a coast without landfall · `R` rapid
intensity change · `W` maximum sustained wind.

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

Two more that are not date cliffs but are missing data all the same:

- **The non-developing depressions of 1967 have no assigned intensity** (`-99`).
  They are in the file with no wind speed at all.
- **Pre-satellite undercount.** Before roughly 1966 storms are simply missing —
  nobody saw them. A quiet-looking 1935 season page is not evidence of a quiet
  season, and must carry a line saying so.

### 57.7 The landfall gap, 1971–1990

**Continental US landfalls are marked for 1851–1970 and 1991 onward.
International landfalls only for 1951–1970 and 1991 onward.**

So there is a twenty-year hole in US landfall marks — Hugo, Gloria, Alicia,
Elena — in an app called Landfall.

**Decision: we compute those landfalls ourselves** by crossing the track
against a coastline, and label them as ours rather than NOAA's. A mark the app
derived and a mark NOAA published must be distinguishable in the data even if
they draw identically, so a later session can tell them apart.

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
swath, and the post-season report.

**Which storms get Tier 2 is a decision Aaron makes, and it has its own step.**
See step 11 in §57.30. It cannot be decided before step 0 measures how far back
NHC's advisory archive actually goes.

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

- In a roster, they collect at the bottom: *"Two unnamed depressions."*
- In a list, they display as `Storm 4, 1935`.
- **A small hand-maintained alias list** covers the famous ones — the Labor Day
  hurricane of 1935, the Galveston hurricane of 1900. Those aliases are also
  exactly what belongs on the shelf (§57.16).

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

### 57.17 The shelf

A short curated list — around twelve storms — newest first, year in
parentheses. Katrina (2005), Andrew (1992), Camille (1969).

It is the front door because it is what people actually open the feature for.
It is **not** the only navigation, because a hand-maintained list can never
answer "what happened in 1998" and is the kind of thing that stops being
maintained in March.

The shelf overlaps §57.14's alias list. A famous unnamed storm belongs in both.

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
  `lib/shape-distance.js` already has line-to-point distance. Without this the
  feature quietly lies about fast storms, which is the worst kind of bug: it
  looks like it works.
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

**The phone takes the whole file and parses it locally**, rather than the server
slicing seasons on request. It is a one-time cost, it makes Seasons the only
part of this app that genuinely works with no signal, and a progress bar for
30 KB is theatre. A season you have never visited working on a plane is the
payoff.

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
- **Wind field** — 2004 onward
- **Wind swath** — the total footprint that ever saw storm-force wind.
  `samples/ida-al092021/gis/best-track/AL092021_windswath.geojson` already has
  one. **A historical shape with no live equivalent**
- **Watches and warnings** — Tier 2 only
- **Cone at the selected advisory** — Tier 2 only, and only while scrubbing
- **Home marker and the distance circle**

**Population is not on this list** (§57.1 decision 9).

The modules underneath are the live ones taking different data — past track,
wind field, coastline, globe, gestures, keyboard, drawer mechanics, type,
spacing, touch targets. What differs is which layers get registered. The layer
registry already supports this; a second registration set is the natural shape.

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

**STEP 0 — MEASURE. Gates everything.**
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

**STEP 1 — THE PALETTE. ==> LANDED 2026-08-24. NOT YET SEEN ON GLASS. <==**
Built, gated and pushed. **What it IS lives in `SPEC-MAP.md` §9** — the third
palette, the forced mode, the round-trip guarantee, the luminance-set land and
the knowingly-shipped hue collision. Read that, not this.

**A2 WAS NOT BUILT.** Aaron's call: the coastline is a hairline and the
collision §57.20 measured compares two things that are not drawn alike, so the
answer is a real Cat 2 crossing a real coast rather than a second paint chip.
§57.31 item 1 is closed.

**WHAT IS STILL OPEN HERE IS THE LOOKING, AND THERE IS NOTHING TO LOOK AT YET.**
Sepia is reachable only through `forceMode()`, and nothing calls it — the first
surface that does is step 4's shell. `mockups/seasons-themes.html` mirrors the
shipped values and is the only place to see it before then; keep the two in
step or the mockup becomes a paint chip for a colour nobody can buy.

**Two things for Aaron when there is a globe wearing it:**
1. **The coastline against a Cat 2 dot.** The one measured collision.
2. **Land against ocean, which came out flatter than dark's** — 1.12:1 where
   dark is 1.20:1. The coastline is what separates them and it clears the ocean
   at 7:1, so this may be nothing. If the landmasses read as mush, the lever is
   the ocean rather than the land: the land is pinned by the contrast gate.

---

**STEP 2 — THE PARSER AND THE INDEXER. No UI.**
Read HURDAT2 and ATCF into one normalised internal shape, and produce the
per-season records and the near-home index that §57.35 requires. **One module,
imported by both the Node runner and the browser Worker** — two parsers drifting
apart is a bug this project has already paid for. Handle every cliff in
§57.6, the `-999` and `-99` sentinels, §57.13's storm numbers, and the two
formats' different radii layouts.
**Tests must be verified by breaking them** — reintroduce each bug and confirm
the test goes red. A test that passes on the same wrong assumption as the bug is
worse than no test.
**Done when:** a real season parses out of real bytes and the derived figures in
§57.15 match a hand-check against a storm we know — Ida is the obvious one,
since NOAA's own format document uses her as its worked example and we hold her
full advisory capture.

---

**STEP 3 — STORAGE AND SERVING.**
Two independent paths, neither depending on the other:
- The runner mirrors b-decks and our own JTWC-basin capture into an **appending
  branch** — provenance, readable from a session with plain git, free, no
  builds fired.
- The existing cron Worker pulls the same into **KV**, served by a route. The
  app reads a route, not GitHub.
- **Start the rest-of-world capture in this step**, ahead of the UI. Every day
  without it is permanently lost.
- Season graduation: when NOAA publishes the reviewed file, **one commit**
  promotes that year into the repo as a static file and KV stops carrying it.
- **Every retention rule in §57.34 is built in this step, not added later.**
  A store without an expiry rule is a store that will not get one.
**Done when:** a session can read a stored season with plain git, and the route
returns the same season to a browser.

---

**STEP 4 — THE SHELL AND THE EMPTY GLOBE.**
**Seasons is dynamically imported here** (§57.35 fault 4) — nothing but the two
doors may touch the boot path. Both doors from §57.16, the exit bar, the forced
palette, the archive globe with
no storms on it, deep-link handling, and **the storage scoping from §57.2**.
**Aaron looks at:** entering from both doors, the globe with nothing on it,
leaving, and confirming his live theme came back.
**Done when:** you can get in and out on a phone, and a session in Seasons has
written nothing into live storage.

---

**STEP 5 — THE SEASON BOARD.**
Year picker, roster with ghosted names, scorecard, the All / Majors / Landfalls
filters. Static tracks on the globe for whatever is ticked. One basin.
**Aaron looks at:** 2005 (no ghosts — they ran out of names) against 2026 (mostly
ghosts). The shape of a season should be visible without reading.
**Done when:** ticking storms puts them on the globe and untucking removes them,
by tap and by keyboard.

---

**STEP 6 — THE GLOBE LAYERS.**
Track rendering through the shared modules, landfall marks, name labels along
tracks, focus-and-dim, wind field where it exists with §57.25's honest line
where it does not, wind swath.
**Aaron looks at:** four storms at once. Can he tell them apart? Does focus/dim
feel right? Do the landfall marks read as the most confident thing on screen?
**Done when:** confirmed on glass with at least four simultaneous storms.

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
Aaron picks which storms get the full advisory treatment. Cannot happen before
step 0, because step 0 establishes which storms are even *eligible* — a storm
whose advisory archive does not exist cannot be promised.
Bring to this session: the eligibility findings, the byte cost per storm (Ida is
7.7 MB), and a proposed shortlist with reasons. Andrew '92, Katrina '05 and
Sandy '12 are the obvious probes. **The shelf in §57.17 and the alias list in
§57.14 are decided here too** — they overlap heavily.
**Done when:** a named list exists in this file with a reason beside each entry.

---

**STEP 12 — TIER 2 CAPTURE AND THE ADVISORY SCRUBBER.**
Capture the chosen storms the way Ida was captured. Wire the per-advisory
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
2. **Which storms are Tier 2.** Step 11. Aaron decides.
3. **IBTrACS is unverified.** Size, format and quirks are all assumed. Step 0
   probes it. Nothing about the rest of the world should be promised until then.
4. **The b-deck line layout is assumed, not read.** Step 0.
5. **How far back NHC's advisory archive reaches** is unknown. Step 0.
6. **Season clock speed** — a day a second is a starting number, not a decision.
   Aaron tunes it on glass at step 10, and it lives in the motion constants.
7. **Whether the Wall of Years ever gets built.**

## 57.32 Files this feature is expected to create

Sketch, not a contract — but nothing here goes into an existing file that is
already near its limit.

```
seasons/            entry, shell, mode state, deep links
lib/hurdat.js       HURDAT2 + ATCF parsing into one shape
lib/season-facts.js the derived figures in §57.15
lib/near-home.js    line-to-point distance against a track
data/seasons.js     fetch, cache, offline
map/layers/season-*.js   track, landfall marks, swath, ghosts
ui/view-seasons*.js      shelf, board, roster, detail
config/tokens.js         + the SEPIA palette
config/constants.js      + a SEASONS block
```

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

**==> BUT IBTrACS MAY EXCEED THE 25 MiB PER-FILE CAP. <==** The global file is
considerably larger than HURDAT2's 6.8 MB. If it is over 25 MiB it cannot be a
static asset at all and must be split by basin or era, or moved to R2. **Step 0
measures its size specifically**, and the rest-of-world design is not settled
until it has.

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

**WHAT THE AUDIT CONFIRMED WAS ALREADY RIGHT**

- Static assets for settled years, KV only for the season in motion (§57.33).
- The download gated behind an explicit ask (§57.24).
- **One parser, shared.** `lib/hurdat.js` is a plain ES module, so the Node
  runner and the browser Worker import the same file. Two parsers drifting apart
  is a bug this project has already paid for elsewhere.
- The retention rules (§57.34).
