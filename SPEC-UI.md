# SPEC-UI.md — Landfall home, units, and screen architecture

**This is §8 and §16 of the Landfall spec.** Where the user's home lives and what
it buys them; what is on screen, what is in the drawer, and how you move between
views.

> **Rules for this file, same as every spec file in this repo.**
> **Not a log.** It describes the app as it is right now. When a fact goes stale,
> delete it and replace it. No "update:" notes, no history, no as-of dates on
> things that are simply true.
> **Not a decision tree.** Record the outcome, not the alternatives considered or
> the route taken to get there. Fences ("do not re-propose X") live in SPEC.md's
> SETTLED list, one line each.
> **Section numbers are permanent addresses.** ~950 code comments cite them.
> A section may move between files; it may never be renumbered.

`[DECIDE]` marks an open decision. `[VERIFY]` marks a fact we haven't tested.
Nothing marked `[VERIFY]` may be treated as confirmed.

---

## 8. Home

### The voice

Every sentence on this screen is about **this house**, in the second person.
Not "your home" where "you" will do, and never the storm's biography. Six
rules, and a line that breaks one is wrong even if it reads nicely:

1. **Say what is happening to this house.** "Hurricane-force wind reaches you
   at 11 PM", not "Ida is a Cat 2".
2. **Never overstate, never understate.** Where the forecast stops, say it
   stopped. "At least" is a floor, not a hedge, and it exists because
   understating how long dangerous wind lasts is the direction that hurts.
3. **Plain words, short sentences.** A tired person at 2 AM is the reader.
4. **No drama and no reassurance.** The numbers are frightening enough on
   their own, and softening them is a lie.
5. **Uncertainty is stated, never implied.** Anything the app composed rather
   than received says so in the sentence.
6. **No exclamation marks.**

### The stage — one word that has to be true at a glance

`dash.stage`, computed in `buildHomeDashboard`, twelve rungs checked
most-immediate first: `wind-here`, `overhead`, `imminent`, `bearing-down`,
`closing`, `just-passed`, `past`, `far-off`, `track-unknown`, `no-track`,
`track-failed`, `pending`.

**IT REPLACED A COIN FLIP.** The chip was two words off the storm list's pick,
and `Nearest` was a shrug covering four unrelated situations — a stationary
storm, one past `relevanceNm`, one closing inside the deadband, and **every
GDACS storm**, because GDACS publishes no heading and nothing could tell "not
closing" from "cannot say". A cyclone bearing straight down wore the same word
as one parked half an ocean away. `track-unknown` is the rung that fixes it.

**IT LIVES IN THE DASHBOARD, NOT IN `pickThreatStorm`.** The list ranks storms
carrying only a current position; every interesting rung is a question about
the walked track and the wind fields.

**THE LAST THREE RUNGS ARE THE FOUR REASONS THERE IS NO CURVE, AND ONLY ONE OF
THEM MOVES.** An empty forecast arrives from a fetch still running, a fetch
that failed, a source that publishes no tracks at all, and a source that
answered with nothing — and the dashboard cannot tell them apart from the
curve, because all four hand it `[]`. So the view passes `trackState`
(`'loading' | 'ok' | 'error'`) alongside it, and `buildHomeDashboard` decides
once, in `noCurveReason`, in this order:

| `unavailable` | stage | chip | when |
|---|---|---|---|
| `source-publishes-no-track` | `no-track` | No forecast yet | `storm.can.forecastPoints === false` |
| `no-track-loaded` | `pending` | Checking… | the fetch is still running |
| `track-fetch-failed` | `track-failed` | Track unavailable | the fetch errored |
| `no-track-published` | `no-track` | No forecast yet | it answered, with nothing |

What the SOURCE can do outranks what happened on the wire — a GDACS storm whose
fetch also errored is still a source that never had a track, and reporting the
error would send a reader looking for a retry that cannot help. `trackState`
defaults to `'loading'`: a caller that has not been taught to report has not
been proven to have finished.

`pending` is the ONLY rung that means work is in progress, and it is the only
chip on the ladder whose dots animate. It used to be all four, which is how
Hernan (`ep082026`, advisory 002, 2026-08-13) sat on "Checking…" indefinitely:
NHC published a position, a pressure and a heading and no forecast track, the
storm's own detail panel said "No forecast track in this advisory", and the home
drawer beside it claimed to still be working on it.

**BOTH PASS RUNGS ARE GATED ON DISTANCE AS WELL AS TIME.** `HOME_DASH.nearRingNm`.
Timing alone is not proximity: a storm whose nearest point on the remaining
track is 111 nm away and happening this minute is not passing you.

**`imminent` IS MEASURED TO THE FIRST WIND, NOT TO THE PASS**
(`HOME_DASH.imminentHours`, 6 h) — because the wind is what arrives, and it
arrives hours before the centre.

**The stage also carries the TENSE.** The headline reads "wind is on your house
now" on `wind-here` and "wind reaches you … starting" otherwise; the kicker
reads "Closest it came" once the pass is behind. Before this, the screen stayed
in the future tense through the whole stretch the wind was actually blowing —
which is the stretch it exists for.

**`wind-here` ASKS ABOUT THE WIND ON THE HOUSE, NOT ABOUT THE WORST WIND.** It
tested whether `corridor.worst`'s window contained the present, which silently
means *is the strongest wind here yet*. A storm whose tropical-storm field has
been over the roof for hours and whose hurricane core is still five hours out
answered no, so the chip read *Hours away* while the wind was blowing. The test
is `corridor.here` — the strongest threshold whose window contains this minute
— and it is a THRESHOLD rather than a boolean because every caller has to name
which wind it is talking about: a present-tense sentence built on `worst` would
promise a hurricane that has not arrived. Measured against NHC's published
radii, a house is 8.68 nm inside Ida's 34 kt field at her Advisory 014 and
37.31 nm inside it at 015; both read `imminent` before this.

**AND `imminent` COUNTS DOWN TO THE FIRST WIND, NOT THE WORST.** Once
`wind-here` started asking the right question the rung became nearly
unreachable — by the time a hurricane core is six hours out its tropical-storm
field is usually already on the house — so the ladder jumped straight from
`bearing-down` to `wind-here`. *Imminent* means dangerous wind is nearly on
you, and the first field to arrive is what decides that. The ladder now walks
cleanly across Ida's real advisories: 012 `bearing-down`, 013 `imminent`, 014
and 015 `wind-here`.

### Home is a dashboard, not a setup screen

The home FAB opens a **single-storm dashboard** that answers one question: *is
this storm going to affect me, how badly, and when?* Setting home is
configuration behind an "Edit home" control in the corner, and is the whole
screen only when no home exists yet.

It used to be the other way round. The FAB opened search / locate / drop-a-pin,
and the only thing the app ever said about home — distance, closest approach —
was buried in the storm detail panel behind a storm selection. The one screen
named after the reader told them nothing about themselves.

**ONE STORM AT A TIME, AND A STEPPER TO CHANGE IT.** The storm list is the map
of the world's weather; this is about a house. The pick is `pickThreatStorm` in
`data/home-dashboard.js` and it is **closing first, then nearest** — ported from
the HA integration's `_threat_key`, at that altitude on purpose, because like
the list it runs over storms carrying only a current position. Ended storms are
never the threat. It is a **global** pick, deliberately not the list's basin
grouping: a basin boundary means nothing to one house.

The reader can step to any other storm in that ranking with chevrons flanking
the name. `pickThreatStorm` returns `ranked` — the whole ordering — so the
stepper and the automatic pick are **one ranking, never two**: the storm the
drawer opens on is always the storm the stepper starts at. The chevrons wrap,
so neither end is a dead stop, and with one storm in the running there are no
chevrons at all — a stepper through a list of one is furniture.

**A MANUAL PICK OUTRANKS THE POLL.** The drawer re-picks on every refresh, so a
choice with nowhere to live would silently revert on the next poll, which reads
as the app fighting the reader rather than as a control. The choice is held as
an **id, not a storm object** — the store replaces its storms wholesale on every
poll — so it re-resolves against the current feed and falls back to the ranking
on its own when that storm ends or leaves.

**BUT IT LASTS A VISIT, NOT THE LIFE OF THE APP.** Pressing the Home button is a
fresh ask — "what is coming for my house" — and it re-opens on the top of the
ranking and frames the camera against that storm, whatever the reader stepped to
last time. Held indefinitely, the pick made the button answer a question nobody
had just asked, and the map centred on the house and the wrong cyclone. Setting a
new home clears it too: the choice was made against the old address, and a
different house has a different storm bearing down on it.

The dashboard can tell the two apart because `ui/drawer.js` passes **`fresh`** to
`onEnter` — true for `go`, which throws the history away, false for `push` and
`back`. Returning from a storm's own detail panel is the same visit continuing
and lands back on the storm the reader was looking at; anything else would drop
them somewhere they never navigated to. `go('home')` and `back()` onto the same
root both arrive with an undefined argument, so a view cannot work this out for
itself — it is a fact about the call, and `tools/drawer-head-check.mjs` reads it
off the call.

**The name is the largest text in the drawer**, and everything else was stepped
down to make that true. A figure that outweighs the name of the thing it is
about makes the reader work out what they are looking at from context. The name
is also the link to that storm's own detail panel: the chevrons say "show me a
different storm against my house", the name says "tell me about this storm",
and they are two visibly different controls.

**GDACS storms can never win the closing key.** GDACS publishes no heading, so
`motionTrend` is null for all of them and they rank on distance alone.
Inventing a heading so they could compete is the fabrication §5 forbids. The
consequence is real: a GDACS storm genuinely bearing down can be out-ranked by
a closer NHC storm that is leaving.

**Reachable two ways** — the home FAB, and the home glyph on the globe, which
recenters *and* opens the dashboard. Tapping your own house is the same request
either way.

### The closest-approach figure never ships without its band

**A true number under a false impression is the failure this screen exists to
avoid.** Measured against Bertha's Advisory 10 from a New Orleans home: the
forecast passes 31.6 nm away, 25.5 hours out, and NHC's own two-thirds error
circle at that lead time is 40.25 nm. Two thirds of past official forecasts
would have put that storm **on the house**. "Closest pass 36 miles south" on
its own is arithmetically correct and can leave somebody unprepared.

So the band renders in the same block as the figure, and nothing collapses it.
The numbers are NHC's, copied not computed — the cone circle radii from
`aboutcone.shtml`, in `config/constants.js` as `CONE_CIRCLE_NM_<year>`, looked
up by `lib/cone-error.js`.

**THEY ARE REPUBLISHED EVERY SPRING AND THE APP HOLDS ONE TABLE PER SEASON.**
`CONE_CIRCLE_BY_SEASON` maps a season to its table and `coneSeasonOfStorm()`
reads the season off the storm's own advisory time, so an archived hurricane is
measured against the numbers that were in force during its season rather than
the newest ones on file. That is not hypothetical: 2021's Atlantic circle is
55 nm at 36 h against 2026's 49, and 2021 publishes a 3-hour row that 2026 does
not. A season with no table falls back to the newest one — the live app only
ever shows current-season storms, so that is right for every storm a user sees
— and `band.tableSeason` and `band.tableIsStormsOwnSeason` say so, because a
figure measured against another year's table has to be visible rather than
inferred. Calendar year is enough only because no southern-hemisphere basin has
a published table at all.

**AND THE STALENESS IS CHECKED NOW, NOT JUST NAMED.** `tools/test-home.mjs`
fails from 1 July onward if the newest table on file predates the current
season. It waits until July because NHC publishes before the season starts and
a check firing on 1 January would go red for six months against a table that
does not exist yet.

**Two tables, and no table for most of the world.** The Atlantic and the
eastern/central Pacific have measurably different skill (200 nm against 138 nm
at five days). JTWC and GDACS publish no equivalent, so a west Pacific or
Indian Ocean storm gets **no band at all**, and the screen says why rather than
dropping the line. Borrowing the Atlantic's numbers would be fabricating an
error bar and signing NHC's name to it.

### Near and far are two layouts, not one layout with quieter numbers

**==> A STORM THAT CANNOT REACH THIS HOUSE GETS A DIFFERENT SCREEN. <==** Every
block below — closest pass, strength at the pass, the arrival trend, the hero
chart, the wind countdown, the near ring — is *approach machinery*, and pointed
at a cyclone on the other side of the planet it produces sentences that are each
arithmetically true and collectively absurd. Measured on glass 2026-08-11
against PEILOU-26 at 5,529 nm: "At the pass 23 mph" about a closest approach of
6,001 miles, "It weakens on the way in" about a four-day journey in the opposite
direction, and a near-ring row measuring a Northwest Pacific storm against a
ring drawn round a house in Louisiana. The last one was the worst of the three,
because being *reassured* about a storm 6,000 miles away implies the app
seriously weighed the possibility. That row has since been cut from the rail
outright; `far` still governs the rest.

The fork is `dash.far`, which is `stage === 'far-off'` and **nothing else** —
one field, computed where the track is walked, so no part of the view
re-derives "is it close" from a distance and disagrees with the chip beside it.
It is true only when the geometry has actually arrived and says so: a storm
still on `pending` is not far, it is unmeasured.

Far keeps what stays honest — where it is, which ocean, how strong, which way
it is going — and names the **basin**, because that is the fact that explains
the distance. "6,363 mi WNW" is a number; "the Northwest Pacific" is a place,
and a reader who knows where that is needs no further sentence about whether it
can reach them.

### What the dashboard states

All of it from `buildHomeDashboard()`; the view computes nothing, which is what
keeps every sentence testable without a browser (`tools/test-home.mjs`).

**THE SCREEN IS FOUR NAMED SECTIONS, ONE QUESTION EACH.** Where it is · how
strong · the timeline · and, for a near storm, the closest pass above them.
Each carries an icon **beside** its label and never instead of it: a pin, a
gauge and a wind glyph are not a shared vocabulary, and a heading nobody can
read is a section nobody can skip past. What the icons buy is *scanning* — a
shape at the left edge of each heading is what the eye uses to find its place on
a stack of text blocks, and that works whether or not the reader ever decodes
the shape. All are `aria-hidden`; the words beside them are the accessible name.

**ONE FACT, ONE PLACE.** Three separate duplications were cut on 2026-08-11 and
the rule they produced is worth stating once:

- **Strength is the strip's job; the chart holds no wind speed at all.** The
  chart owns geometry and timing (see below, where the strength lane's removal
  is argued). So the strip is *now · when it's closest · strongest* — one
  quantity at three moments, left to right in time — and the current wind is its
  anchor, because without it the other two compare to nothing.
- **The `<name> right now` section is gone.** It ended up holding two rows and
  neither belonged in a section of its own. `Moving` joined the where-it-is line,
  where it finally reads as one sentence ("Moving ENE at 17 mph, getting
  closer") rather than a bare bearing at the foot of the screen that the reader
  had to carry back up to the distance. `Pressure` joined the strength strip,
  which is where an intensity measure belongs — millibars *are* how strong the
  storm is.
- **The wind sentence is not repeated in prose.** "Hurricane-force wind reaches
  you for at least 5 hours, starting Sun 8:25 PM" restated the rail bar, its
  arrival label, its duration floor and the dashed shadow, and then the
  countdown said all of it again. Three tellings of one fact.

**TWO EXCEPTIONS TO THAT LAST ONE, AND NEITHER IS REDUNDANCY.** The sentence
survives when there is **no corridor to draw** — `homeChart` returns nothing
without one and the countdown's wind rows are gated on the same field, so
cutting it there would leave the screen silent about wind, which §5 forbids
outright — and when **the wind is on the house now**, because the countdown's
version of that moment is the future tense with "now" bolted onto it, and that
is a weaker thing to read at the point it matters most.

**A THIRD EXCEPTION, RULED ON RATHER THAN ARGUED.** On a near storm the `Where
it is` section and the countdown's first row say the same words, and that
survives on purpose: the countdown is the chart's accessible twin, so it has to
be self-contained or a screen-reader user loses the whole of it. It was carried
as an open question for a while on the theory that seeing it on glass might change
the answer. It did not — Aaron ruled it stays as is. Do not re-cut it as a
duplication; it is the one place where saying a thing twice is the feature.

**The strip's three lines are ROWS OF ONE GRID, not three stacks side by side.**
`grid-auto-flow: column` over three declared rows, with each cell's wrapper set
to `display: contents` so its label, figure and note become items of the strip's
own grid. Each cell used to be its own block in equal `1fr` tracks, so the three
lines only aligned while every label happened to fit on one line — and "When
it's closest" wrapped as soon as its column got tight, dropping that column's
figure below the two either side of it. Measured after the fix, the old layout
misaligns at 288, 308 **and** 358px, so it was wrong on ordinary phones and not
only on the narrow desktop rail. `align-items: center` puts the three lines on a
shared centreline, which is what survives a label that does still wrap.

**The columns are content-width with the slack pushed into the gutters.**
`minmax(0, max-content)` sized, `justify-content: space-between`. Equal `1fr`
tracks make the TRACKS equal and the visible gaps unequal — the eye measures the
space between the last letter of one label and the first of the next, so a
narrow "Now" beside a wide "When it's closest" left a hole on one side and a
stranded margin after "Strongest" on the other. The `minmax(0, …)` floor is
load-bearing: bare `max-content` pushed 7px of "after it passes" off the panel
edge on a 320px phone, so the columns must be able to shrink and wrap rather
than overflow. `tools/home-figs-check.mjs` measures all of it; the markup no
longer declares a column count, because the flow derives it.

**The harness loads every stylesheet `index.html` loads, read from the `<link>`
tags rather than named in the check.** It used to load `ui/home.css` alone. When
the text-system pass moved `.home-figs-k`'s size into `ui/panels.css` the label
fell back to the browser's 16px default, wrapped at 308px, and the check
reported a layout regression in a page that was not the app. A hand-picked
stylesheet list is a second copy of a fact the markup already holds, and the two
drift the first time a rule moves house.

**And each column's three lines are centred on one vertical axis.** They were
flush left, so a column read as ragged — "Strongest" is wider than "81 mph" and
narrower than "after it passes", and three different line widths hung off one
left edge. One axis per column is what makes three stacked lines read as a
single figure rather than three fragments. The grid items stretch to their
column by default, so the column's own `max-content` width is the centring box
— no extra element, no width arithmetic. The outer columns stay flush to the
panel edges because their widest line is what the column is sized to; measured
0px of indent at 308, 358 and 424px. The check measures this on the text's own
ink via a `Range`, not on the item boxes: those stretch to the column and share
a centre by construction, so measuring them would report perfect centring
whatever the glyphs did.

**Every figure in the strength strip wears its own category color**, taken
from the same source as the wind beside it — the storm's present reading, the
sample at the closest pass, or the winning forecast point. `Strongest` alone had
no category to hand and rendered plain white next to two colored numbers, which
reads as that cell being singled out rather than as nobody having written it
down. `peak` now carries its category through `data/home-dashboard.js`, so the
color can never disagree with the number under it. A point with no
classification still gets no color, never a borrowed one.

**A cell that cannot be filled honestly is not drawn.** The strength strip's
column count is a variable: a GDACS storm publishes no forecast intensity and
loses the middle cell, and a storm already at its peak loses the last one and
gets a sentence instead of a number repeating the first cell verbatim.

- **Closest pass** — distance, bearing, clock time, lead time, and the band.
- **Strength at the pass**, interpolated off the forecast curve, with its
  category. The category is taken from the **nearer published point, never
  averaged** — a category is a label, not a quantity, and blending two indices
  mints one NHC never published.
- **Peak vs arrival.** The peak is taken over the forecast *plus the present
  wind*, because a storm at its strongest right now has already peaked and the
  curve alone would miss it. Bertha is exactly that: 50 kt now against a 45 kt
  forecast maximum, so reading only the curve says "peaks in nine hours" about
  a storm that is weakening.
- **Arrival trend** — compared against the wind *now*, not against the peak,
  because that is the comparison a reader is making. `HOME_DASH.peakDeltaKt`
  is a deadband on both sides: NHC's own intensity error is ~15 kt per
  forecast day, so a 3 kt difference is not a trend and a label that flips
  between advisories is worse than no label.
- **The near-ring window** — when the track comes inside `HOME_DASH.nearRingNm`
  (100 statute miles) and when it leaves. An editorial threshold, not a
  meteorological one, and not a substitute for the wind windows: "when does it
  get near" and "when do I feel it" are different questions.

**A FORECAST POINT OLDER THAN THE STORM'S OWN POSITION IS DROPPED.** NHC's
tau 0 is the synoptic analysis and the advisory is issued up to three hours
after it, so on every intermediate advisory the first forecast point predates
the position beside it. Walked as given, the track runs backwards from now and
forwards again over the same span — the same stretch drawn twice, and geometry
painted outside the axis. The rule is the one the rest of this section already
follows: past points are skipped, the current position is the anchor, and the
dropped point costs nothing because radii are keyed by tau rather than by point.

**A CLOSEST PASS THAT IS HAPPENING NOW GETS NO ERROR BAND.** The table tapers
linearly to zero at zero hours, which is right as arithmetic and false as a
sentence — it rendered "two-thirds of past NHC forecasts landed within 0.0 mi
of that" about a storm already overhead. There is no forecast left to put a
band on; the position is observed, not predicted.

**A WIND WINDOW CAN HAVE NO LENGTH AT ALL, AND IT IS NOT A DURATION OF ZERO.**
When a storm publishes radii at one hour only and the house is already inside
them, the window opens and closes at the same instant. The honest sentence is
that the wind is on the house and the forecast does not say for how long —
which is neither "no time" nor "at least an hour". `windDurationClause()` in
`lib/wind.js` owns the preposition as well as the number so no caller can build
"for null".

**The ring crossing is interpolated between samples, never snapped to one.**
Snapping reported Bertha's crossing 69 minutes **late**, and every snap error
runs late for the same structural reason — a sample can only be found inside
after the boundary is already behind it. "You have another hour" is the one
direction a preparation figure must never be wrong in.

### The hero chart: what reaches you, not where the centre goes

One lane. **Home is the line at the top and the storm rises toward it.**
`ui/chart-home.js`.

**THE AXIS IS INVERTED ON PURPOSE.** With zero at the bottom the closest
approach — the most important moment on the chart — is the bottom of a V, and
a low point reads as the safe moment on every chart anyone has seen. Flipped,
the same instant is a summit. Two things follow: the earliest-arrival shadow
extends *upward*, so risk looks like something rising at you rather than slack
opening below; and each wind band closes a gap between the storm and the house,
which is exactly what it means. The cost is real — inverted axes get misread at
a glance — and what carries it is that home is not an axis tick but a bold line
in the coastline's cyan with the word on it. The axis caption sits at the BOTTOM
so a close storm compressing every band into the ceiling collides with nothing.

**BOTH AXES ARE READABLE, WHICH THEY WERE NOT.** Fixed 2026-08-11.

- **Distance.** Two unlabelled-in-between gridlines meant the only distances a
  reader could name were the top of the frame and the house itself; every band
  edge sat between two numbers 45% of the plot apart. Four or five now, each
  labelled — and the interval is chosen **in the reader's own units and
  converted back**, because a round nautical-mile step reads as 58 / 115 / 173
  mi. It reads 50 / 100 / 150. The grid therefore moves when Settings changes,
  which is correct: it is a reading aid, not a property of the storm.
  `nmPerDisplayUnit()` in `lib/units.js` exists for this one caller.
- **The step is chosen by line count, not by dividing and rounding.** The
  obvious `max/4` snapped up to a nice number was measured on Ida and produced
  **two** gridlines on a 250 nm plot: 62.5 snaps to 100, and 100 fits twice.
  Snapping up is a cliff and half the time it lands on the wrong side of it.
- **Time.** Three flat labels — start, middle, end — left the middle of the plot
  with no time on it, so "the wind arrives here" could not be read off the
  picture without counting pixels. Five now, each with its own faint vertical,
  because a timestamp under the axis with nothing rising from it names a moment
  the eye cannot find again further up the frame. **Angled at -38°**, since five
  will not fit flat; they collide at four. Anchored at the *end*, because
  rotated text pivots about its anchor and anchoring at the start swings each
  label out to the right of the line it belongs to.
- **The rail gutter is in the reader's units, not knots.** This was the last
  place in the app still printing `64kt`. Knots are what NHC publishes and what
  the app stores; they are not what anybody chose in Settings, and a chart
  captioned in a unit the reader has to convert cannot be compared to the mph
  two inches above it.
- **The caption is two rows.** One ran off the right of the frame and was cut
  mid-word once the gutter widened to hold formatted distances.

**THE FOUR COLORS IT DRAWS WITH COME FROM `applyTokens()`, NOT FROM THE PAGE
IT HAPPENS TO BE ON.** `--kt34`, `--kt50`, `--kt64` and `--coast-glow` are set
on the root element at boot — the wind bands off `WIND_BAND_COLOR` because §6
fixes those hues in both themes, the home line off `palette()` because it is
the coastline's own color. This is written down because the chart shipped
referencing all four with none of them declared, and an unresolved `var()` in
an SVG presentation attribute renders BLACK in silence. `tools/test-css-vars.mjs`
enforces it.

**THE BANDS ARE THE WIND, NOT THE STORM.** Each is how far that threshold
reaches *toward home*, measured along the bearing that actually points at the
house. They nest — 64 inside 50 inside 34 — and each is clamped at zero, since
a negative distance is not a place.

**THE HOME LINE IS NEVER PAINTED OVER.** It used to wear each threshold's
color for the hours that wind was on the house, and that was cut on glass:
overstriking the reader's own house in the wind's color reads as damage to the
reference rather than as information, and the line every other figure is
measured against has to stay one thing.

**THE WIND RAIL ABOVE THE HOME LINE CARRIES WHAT THE STRIPE COULD NOT.** One
row per threshold that actually reaches the house — a bar from arrival to
departure, the clock time it starts, and how long it lasts.

**ORDERED BY SEVERITY, WEAKEST NEAREST THE HOUSE:** 34 kt on the home line,
64 kt at the top. It agrees with everything else on the screen — the wind that
arrives first and lasts longest is the one closest to the reference, and
severity climbs away from it, the same direction the storm itself climbs to
meet the line. Mirroring the bands instead (34 kt outermost, so highest) reads
as a nesting diagram rather than as a sequence of things that happen to you.

It sits above home because every band is clamped there, so
nothing else can ever occupy that space, and because *what is on my house, and
when* is a different question from *how far away is the centre*. A duration
still open when NHC stops publishing that threshold is prefixed **≥**, and a
bar that outlives the chart's window ends in a chevron rather than a flat edge,
so "the picture stops here" cannot read as "the wind stops here".

**THE HEADROOM IS BUILT, NOT RESERVED.** The space above the home line is one
16px header row plus exactly 14px per threshold that actually arrives — nothing
is held open for a row that is not there. It was a flat 58px holding three rows
whether or not there were three, so the storm with no wind reaching the house,
which is most storms most of the time, spent a third of the picture on blank
sky. The plot and everything under it move up behind it, and since `.home-chart`
is `height: auto` at `width: 100%`, a shorter viewBox is a shorter card: 242
units with an empty rail against 284 with three rows.

**THE PLOT ITSELF IS A FIXED 148 UNITS TALL AND ONLY ITS ORIGIN MOVES.**
Reclaiming the headroom must not quietly restretch the distance axis, or two
screenshots of the same storm an hour apart stop being comparable.

**A DOTTED VERTICAL MARKS NOW, AND THE AXIS NO LONGER CLAIMS ITS LEFT EDGE IS.**
The first sample is the storm's position as of the advisory, which on a live
feed is up to three hours old; the leftmost axis label said "now" regardless.
The axis states the time it actually shows and the vertical carries the present.

**THE CLOSEST PASS IS STAMPED WITH ITS DAY AND TIME, AND THE DOTTED LINE RUNS
UP TO IT.** The white vertical marking the closest pass was the only unlabelled
line on the chart: a reader could see *where* on the time axis and had to look
away to the panel above to find out *when*. The stamp is `formatClockDay()` —
byte-identical to the string the panel shows, because one screen cannot hold two
answers to one question — and it exists exactly when the dotted line does and
never otherwise. The line is carried up through the rail band to reach it, which
costs one hairline of ink across the bars and says something true besides:
whether the closest pass falls inside a window the wind is on the house.

It is placed as a *span*, to the right of its line where there is room and to
the left where there is not. When neither side clears the word `now` — which
means the closest pass is happening about now, so the two dotted verticals are
on top of each other — the header takes a **second 12px row** and the stamp
drops onto it rather than either label being dropped. Ida's Advisory 17 is a
real case of it.

**THE RAIL'S OWN LABELS DODGE THE SAME TWO VERTICALS, AND FOR A LONGER TIME
THEY DID NOT.** The arrival time sits at the bar's left end and the duration at
its right, each flipping to the other side when it runs out of room, and both
merging into one chip when neither has room. That logic knew about the **bar**
and the **frame edges** and nothing else — while `now` and the closest-pass
stamp both run the full height of the frame, straight through the rail band. On
glass 2026-08-20 the `now` line ran through the middle of a 39 kt arrival time:
the one row of this picture that says when to stop what you are doing, with a
hairline of dots through the digits.

Placement is now a preference ladder. Two labels where two fit and both clear
the verticals; failing that, the merged chip on whichever side of the bar is
free; failing that, the merged chip **slid along the row** until it is past the
line, which costs a small gap between chip and bar and keeps it on the bar's own
centre line in the bar's own colour so the pairing still reads. Only if none of
those works does it fall back to the old fits-only answer — a label with a
hairline through it still beats no label.

**A LABEL IS A SPAN, NEVER A POINT** — `end`-anchored text occupies the room to
the *left* of its x — and the clearance either side of a vertical is
`VERTICAL_CLEAR`, 2.5px. At 1px the dots land between the letters and the eye
stitches them into the word; at 2.5 there is a visible channel.

**THE COLLISION IS A FUNCTION OF THE CLOCK, SO THE CHECK SWEEPS RATHER THAN
SPOT-CHECKS.** Where `now` lands depends on how long ago the advisory was
issued, so a fixture rendered once at its own issue time exercises exactly one
of the positions the line can take — and none of the real collisions is
reachable at offset zero. `tools/test-home-ida.mjs` renders 19 advisories at 12
hourly offsets, 216 frames, and asserts no rail label has a vertical through it.
Removing the dodge produces 118 crossings.

**A BAND IS ONLY DRAWN FOR A FIELD THAT COMES NEAR.** Most storms most of the
time are nowhere near anybody, and three translucent bands hugging the frame
say nothing while making the two useful lines harder to read. Drawn when the
threshold is published *and* its edge comes within the near ring.

**WHAT WAS CUT AND WHY.** The first version was two lanes — the storm's own
wind above, distance-to-centre below. The strength lane went: the storm's wind
is not what you feel, and a home screen showing it instead of what reaches the
house is answering someone else's question. The standalone cone ribbon went
too, folded in as the earliest-arrival shadow. The radial "approach" was
rejected earlier on geometry (an east-to-west storm draws a flat line skimming
under the centre and wastes the circle); a Gantt of the same windows was
rejected as a prettier arrangement of what the countdown already says.

### The corridor, and the one figure that is ours

`data/home-corridor.js`. Per sample: bearing from the storm to home, the
published quadrant radii blended to that bearing by `radiusAtBearing` — the
same function the drawn swath uses, so the picture and the number cannot
disagree — and the gap from home to each field's edge.

**A WIND FIELD IS NOT A CIRCLE, AND TREATING IT AS ONE INVERTS THE ANSWER.**
Bertha's 34 kt winds reached 100 nm southeast and 40 nm northwest of the same
centre. New Orleans sat northwest — her narrow flank — which is the only reason
a 48 nm pass produced under three hours of wind instead of six. A mean radius
gets that backwards.

**THE PUBLISHED POINTS ALONE GIVE THE WRONG ANSWER.** At every one of NHC's
12-hourly forecast hours Bertha's 34 kt edge misses New Orleans by at least
17 nm. Interpolated along the track it crosses the house. Crossings are
interpolated between samples for the same reason the near-ring crossing is —
snapping always reports an arrival late.

**A THRESHOLD THAT STOPS BEING PUBLISHED HAS STOPPED.** Radii interpolate only
where *both* bracketing hours publish that threshold. Carrying the last set
forward drew tropical-storm winds through hours NHC forecast none for, and the
smeared values looked right because the bearing kept changing. A window still
open when the series ends is closed at the last published hour and flagged
`openEnded`; the UI then says "at least" rather than "about", because
understating how long dangerous wind lasts is the unsafe direction.

**`earliest` IS OURS AND IS THE ONLY FIGURE ON THIS SCREEN NEITHER AGENCY
PUBLISHES.** It re-runs the crossing test with every wind field pulled toward
home by NHC's two-thirds track error at that hour — their track error, their
radii, our composition. It lives in its own key so no renderer can show it
without asking for it by name, it is drawn as a dashed line rather than a
fourth fill, and it is always worded as a range ("could start as early as"),
never as a time.

**Per-tau radii ride on the bundle as `forecastRadii`**
(`normalizeForecastRadii`), read *before* `buildFullTrack` overwrites the swath
slot. The corridor needs the numbers, not the polygon: recovering a reach from
a rendered outline means point-in-polygon tests against a shape already
simplified, blended and fold-guarded.

### The countdown is the accessible twin

**NEVER COLLAPSED BY DEFAULT.** A screen reader cannot explore an SVG and a
keyboard user cannot hover a ribbon, so everything the picture shows is stated
here in words. The chart's `aria-label` is a summary, not a substitute.

**THE ROWS ARE SORTED BY WHEN THEY HAPPEN.** They are built in the order the
code writes them and that order is chronological only by luck: on a storm whose
wind outlasts its closest pass — which is every major hurricane — "winds last at
least this long" is written before "closest pass" and happens after it. The list
read 12 hrs, 16 hrs, 21 hrs, 18 hrs. The sort is stable, so rows sharing a
moment keep their written order, and a row whose moment will not parse sinks to
the bottom rather than corrupting the order of the rows around it.

**THE RAIL CARRIES EVENTS, AND ONLY EVENTS — EVERY ROW HAS A TIME ON IT.** Two
rows without one were removed, and each was its own kind of wrong.

A not-built-yet note about warned zones sat at the bottom on every NHC storm
that had a product in force, adding a permanent caveat to a question nothing on
this screen asked. **"Never comes within 100 mi of you"** printed an em dash in
the lead column where every other row prints a countdown, which reads as a clock
that failed rather than as a fact with no clock in it. That was the symptom; the
cause is that neither is an event.

The near-ring row was also the WEAKER of two answers to one question, which is
the same rule that already retires the ring rows whenever the wind rows exist.
The closest-pass headline measures the wind field — *"no tropical-storm wind
reaches you, the nearest edge stays 331 mi off"* — while the row measured the
CENTRE against a ring whose radius nothing meteorological chose. The proxy does
not get to argue with the measurement in the same drawer.

**ONE PLACE BUILDS THE DURATION PHRASE**, `windDurationPhrase()` in
`lib/wind.js`, because three surfaces say it and they were saying different
things. The hedge and the number used to be assembled separately, which shipped
"for at least about an hour" in the headline and "for about 5 hours" in the
chart's `aria-label` beside a countdown saying "at least 5 hours" about the same
window. A window under an hour is reported in minutes rather than as "under an
hour", since "at least under an hour" is a floor and a ceiling in one breath,
and the buckets round DOWN, because a floor may always be stated lower than it
is and never higher.

**The wind rows supersede the near-ring rows when they exist.** The 100-mile
ring was always a stand-in for "when do I feel it", built because the app could
answer it from a track alone. The corridor answers the real question; showing
both would be the proxy arguing with the measurement in one list.

**EVERY THRESHOLD THAT REACHES THE HOUSE GETS AN ARRIVAL AND AN ENDING —
ARRIVALS ASCENDING, ENDINGS DESCENDING.** The rail described `corridor.worst`
and nothing else until 2026-08-13, and on a storm where two fields reach the
house that is the wrong story told twice over. Measured on Lala against a Big
Island home: tropical-storm-force wind arriving 9:36 AM for fifteen hours,
damaging wind arriving 3:12 PM for four. Naming only the damaging pair put the
first wind six hours late, and printed a bare **"The wind eases"** at 6:45 PM
with six hours of tropical-storm-force wind still to come — which is read as
*it is over*, and is a confident wrong answer about when it is safe to go
outside. The chart beside it had both bands all along; only the words were
short.

Ascending then descending is the shape the weather has, and it makes the rail
readable as one escalation and one recovery with the closest pass sorting into
the middle. **The weakest field is the first wind and the last wind**, so it
owns both the earliest-arrival hedge and the closing row. Hanging the hedge on
`worst` put "wind could start this early" BELOW the arrival it hedges once the
weaker rows existed.

**The last field to lift says "The wind is past you", never "All clear".** That
phrase is the home chip's word for a *status* — nothing bearing down, both
sources answered (§8's quiet path) — and spending it on a forecast moment
inside one storm's rail would make it mean two things. An open-ended window
overrides both: the forecast stopped while the house was still inside, so the
end time is a floor and the row says so instead of claiming the wind ended.

Bold and a filled node go to the worst arrival only; every band shouting is
every band whispering.

**THE RAIL ALSO CARRIES WHAT THE STORM DOES TO ITSELF.** Every other row is
house-relative — *reaches you*, *of you* — and the milestone rows are not. That
is the point rather than an inconsistency: *"becomes a hurricane at 11 AM"* and
*"damaging wind reaches you at 3 PM"* are one story, and this is where the app
tells a story in order.

**Three named steps, from `HOME_DASH.classMilestones`:** tropical storm,
hurricane, major hurricane. A row per category would give a real Cat 5 ten of
them — up through five and back down — on a rail already carrying the wind
arrivals, the pass and the all-clear. These three are the phrases evacuation
orders and bulletins are written in, so they are used verbatim. Nothing is lost
by stopping there, because the peak row carries the actual maximum and its own
category.

**Strengthening names the class ENTERED; weakening names the class LANDED IN.**
"Drops below major hurricane" says what a storm is no longer; "weakens to a
tropical storm" says what it now is, which is what a reader is trying to find
out. Read off the point's own category, so a storm falling two steps in one
forecast gap is described by where it stopped.

**Simultaneous crossings collapse to one row** — deepest for a fall, highest
for a climb. Cat 3 to tropical storm inside one six-hour gap crosses two named
steps at the same minute, and printing both reads as the rail stuttering rather
than as a storm falling apart. The intermediate crossing is real and is not
news.

**The peak folds into a milestone within `HOME_DASH.peakMergeHours`,** because a
storm whose strongest forecast hour IS the hour it becomes a hurricane produced
two rows at one minute saying nearly the same thing. No figure is lost — the
milestone's detail already carries the wind. A peak that has already happened
(`when: 'now'`) gets no row at all; a countdown is not the place for it.

**==> POINT TIMES, NEVER INTERPOLATED, AND THE COST IS STATED. <==** The
corridor interpolates because it crosses a NUMBER between two published
numbers, which is arithmetic. A CLASSIFICATION is not: NHC states "hurricane"
at a forecast hour and states nothing whatever about the hours between, so
manufacturing the minute a storm crosses into a class invents a call the agency
did not make (§5). These rows therefore run late by up to one forecast interval
— as much as twelve hours at long range. That is acceptable for a fact about
the storm and would NOT be for the wind rows, which answer "when does dangerous
wind reach my house" and carry their own earlier-than-forecast hedge.

**The baseline is what the storm IS now,** so a hurricane forecast to stay one
is never told it becomes one. A null category is never a crossing in either
direction — treating unknown as "below" would announce a storm becoming a
hurricane every time one forecast hour omitted the field.

**THE RAIL IS SEGMENTS BETWEEN NODES, NOT ONE LINE BEHIND THEM.** A single
line down the list has to guess where to stop at each end, and it overshot the
first node and trailed past the last. It also ran straight through the middle of
the nodes that are HOLLOW on purpose — the earliest-arrival hedge — undoing the
hollowness that was carrying their meaning. A segment per row starts at one
node's bottom and ends at the next node's top, so it cannot overshoot and cannot
show through anything.

**The node is `border-box`, and that is load-bearing.** Nothing in this project
sets `box-sizing`, so a node declared 9px wide with a 1.6px border rendered
12.2px wide and its centre fell one border-width right of where the thread was
drawn. It looked *almost* right, which is why it survived a previous fix to the
same line.

**The node's VERTICAL offset is computed from the lead's line box, not tuned
against it.** A guessed `top` put every node 2.5px below its own first line —
measured, not estimated. `--rail-node-top` is
`(--rail-lead-size × --rail-lead-line − --rail-node) / 2`, so the node centres
on the first line by construction.

**And the lead's `line-height` is DECLARED, which is the half that matters.** It
was inheriting `normal`, a value the FONT chooses rather than the stylesheet, so
the line box was one height in Chromium and another in Safari's `ui-monospace`.
Any offset tuned by eye on one platform was therefore wrong on the other, which
is why this kept coming back. Two elements agreeing on a centreline must not do
it by writing the same number twice, and neither may depend on a number nobody
declared. `tools/test-css-vars.mjs` pins all three conditions.

**One thing that cannot be shown live, and was expected to be.** The gap
between a warning being issued and the winds arriving is the most actionable
number in the Bertha archive — 38 hours — and it is *not computable in the
app*. Layer 8 carries the products currently in force, not when they were
issued, and nothing stores advisory history on device. What the countdown can
say is the lead time from now, which it already does.

### Five render paths, and they must read differently (§5)

No home · a threat storm · nothing bearing down · a source unavailable · still
loading.

**==> AN OUTAGE MUST NEVER RENDER "ALL CLEAR". <==** This is the failure with
the worst consequence in the app and the easiest to write by accident. When a
source did not answer, the screen refuses the word, names which source failed,
and says explicitly that this is not an all-clear. `tools/test-home.mjs` drives
all five paths through a DOM stub for that one assertion.

**THE NO-HOME SCREEN'S PRIVACY SENTENCE IS A SMALLER PROMISE, KEPT.** It used to
say coordinates never leave the device. That stopped being true — the reverse
lookup that turns a dropped pin into a place name sends a point, and §48's
rainfall forecast sends the house. What it says now is what is true: the home is
stored on this device only, no account holds it, nothing in it names you, and the
two lookups that need a point send a rounded one (`RAIN.wireDecimals`, and three
decimals for `/api/reverse`). **The weaker sentence is the deliberate trade** — a
promise a feature quietly breaks is worse than a smaller one kept. Confirmed on
glass; do not restore the older, stronger wording.

### Geometry for the dashboard is warmed, never selected

`pipeline.warm()` — cache first, fetch if needed, and **no camera move, no
selection, nothing drawn**. Routing through `load` would mean opening the Home
drawer yanks the globe to a storm somewhere else in the ocean. Someone checking
their house has not asked to go anywhere. It fills the same cache `load` reads,
so a later selection is instant and the two can never hold different geometry
for one storm.

### Setting home

Three ways, all shipping: geolocation is the one-tap path, Mapbox address search
is the typed path, dragging the pin is both the correction path and the fallback
when search is down.

**The three are PEERS, and the styling says so.** One shared `.home-choice`
recipe — icon, title, one line of explanation — used three times with no
exceptions. A different treatment per door reads as a ranking, and there is no
ranking: geolocation fails for anyone who has ever denied it, search fails for
anyone whose road the geocoder has wrong, and the pin never fails at all. A
fourth way in gets the same class and nothing else.

**Nothing on this screen opens a keyboard on arrival.** Search is a choice you
open, not a field sitting open — the panel focuses the first choice, and the
address box takes focus only on the tap that reveals it. `aria-expanded` on the
choice button is the accessibility half of the same fact.

**Remove home is not in that family and is not next to it.** Text in the error
color, at the very bottom, behind a rule, with no fill or border — sharing no
declaration with `.home-choice`. Still a full 44px target: deliberately quiet is
not the same as hard to hit. A destructive action wearing the same clothes as
the thing you came here to do is one mis-tap from being the thing you did.

- **Never prompt for location on first launch.** A permission dialog before
  someone knows what the app is gets denied, and iOS makes that hard to undo.
  Prompt only when they tap "use my location."
- **Nothing commits without an explicit confirm.** A geocode result is a guess,
  and a wrong home silently poisons every distance and closest-approach figure
  downstream — the numbers still look like numbers. Pick → camera flies and drops
  a PROVISIONAL pin → user confirms or drags → only then is it home.
- **Low-confidence results say so BEFORE the user picks one** — an area centroid,
  or a weak relevance score. Surfacing it after selection means they have already
  started trusting it.
- Home is stored locally on the device only. No accounts, no server-side user
  data.

**The address box is `type="search"`, and that is load-bearing. Do not "fix" it
back to text.** As `type="text"`, with a label reading "address" and a
placeholder reading "Street, city, or postcode", it is a bullseye for browser
autofill heuristics, and neither Chrome nor Safari honours `autocomplete="off"`
on a field they have decided is an address. They offer the user's saved
addresses, which live on the same record as their saved CARDS — a hurricane app
popping a credit-card menu over the keyboard. A search field is excluded from
that machinery by both engines. For the same reason the `name` is deliberately
not address-shaped, the field is deliberately not inside a `<form>`, and
`data-1p-ignore` / `data-lpignore` / `data-bwignore` / `data-form-type` are set
as the non-standard opt-outs password managers respect.

### Home is a place, not a coordinate pair

A home set by pin used to carry no label at all, so every surface printed
`29.301, -94.798` — true, unreadable, and identical whether the point was in
open water, in unnamed backcountry, or whether the lookup had simply failed.

The point is NAMED now. Two independent questions are asked at once and neither
source can answer the other's:

- **What is this called** goes to `/api/reverse`, the mirror of the address
  search relay — same server-side token, same 30-day cache, its own rate budget.
  It asks for town, region and country; deliberately NOT street address and NOT
  points of interest, because a rooftop-accurate answer to a deliberately
  approximate question is a confident lie.
- **Is this water** goes to the basemap already drawn on the screen. Mapbox has
  no marine gazetteer — the open Atlantic matches no polygon and comes back
  exactly as the Sahara does. The tiles are the only source on the phone that
  knows, they are already downloaded and decoded, and reading them costs nothing
  and works offline. It also guarantees the answer agrees with what the user's
  own eyes are getting from the globe.

**Four outcomes, never collapsed into one another** (§5 in miniature — the old
single fallback made all four look the same):

| kind | shown |
|---|---|
| `named` | the place name |
| `water` | `Open water` |
| `unnamed` | `Unnamed location` |
| `unknown` | the coordinates, honestly |

The exact coordinates appear as a quiet second line under every kind except
`unknown`, where they are already the headline.

**A NAME BEATS THE WATER FLAG.** Harbours, river mouths and barrier islands
produce points the tiles call water while the geocoder names them without
hesitating; at these resolutions the tile edge and the real shoreline are not
the same line. Anything else tells somebody who searched their own address that
they live in the sea.

**Water is a description, not a warning.** Watching a point in the Gulf — a rig,
a passage, a boat's route — is a legitimate thing to want, and the app has no
standing to second-guess it. `Open water` is styled like every other place name
and nothing treats it as an error.

**Naming can fail and the user is never blocked by it.** The pin is already
right, the home will work, and only the caption is missing — so a failed lookup
degrades to coordinates and says nothing further. The commit never waits on the
network either: "Set as home" stores immediately, and a name that lands a moment
later is patched onto the stored home, guarded on the coordinates still
matching so a late answer can never label a home the user has since changed.

**CONFIRMED AGAINST THE LIVE SERVICE.** Every path in this block was written
blind — the sandbox cannot reach Mapbox, so the whole lookup half shipped with no
failure path ever exercised, and it was the largest untested surface in the app
for weeks. Aaron judged it on glass and all four outcomes read correctly: the
three-comma-part name is useful rather than noisy, and `Open water` lands as a
description rather than a warning. `labelOf()` in `functions/api/reverse.js` is
the dial if that ever stops being true; nothing needs turning today.

### What home is for

Five things depend on it: the dashboard above, storm-list sort order, where
recenter comes to rest, the opening sequence's resting position, and the detail
panel's home block.

Home features, in order of how much geometry they need:

| Feature | Needs | State |
|---|---|---|
| Home marker, off-screen pointer, distance, bearing | position only | shipped |
| Forecast closest approach | forecast track | shipped |
| Wind-arrival at home | forecast wind radii | shipped (`data/home-corridor.js`) |
| At-home exposure timeline | forecast wind radii | shipped (`ui/chart-home.js`, `ui/countdown-home.js`) |
| Surge-at-home | Peak Storm Surge service | not built |

**Wind arrival is COMPUTED from the published radii, not fetched.** The earlier
plan was to read MapServer's own arrival-time layers; `data/home-corridor.js`
measures the distance from home to the nearest EDGE of each wind field at every
step along the forecast instead, because a boundary sampled every twelve hours
is a boundary you will miss.

Peak Storm Surge has no `stormid` field and must be filtered spatially, so the
at-home version and the surge layer share one fetch-and-filter — build them
together or write it twice.

### Every home figure carries the advisory timestamp it came from

"Closest approach in 14 hours" from a six-hour-old advisory is a different
sentence than the same words from a fresh one. This is the one screen where
someone may make a real decision; stale gets labelled stale (§5).

**Enforced structurally, not by convention:** `distanceTo()` and
`closestApproach()` return `{nm, bearing, observedAt, advisoryKey}` as ONE
object. There is no call that yields the number without its age, so the rule
cannot be forgotten at a call site.

### Closest approach — a correct minimum is not a true sentence

**THE MINIMUM IS REFINED, NOT SAMPLED, AND THAT IS A CORRECTION.** The walk
lays eight samples across each leg and the best of them is not the minimum. On
Bertha, at 5 kt, the sampled answer was 0.3 nm too far out and **28 minutes
late**; on Ida, at 13 kt on a track that goes over the house, it was **5.4 nm
too far out and 39 minutes early**. The distance error has a direction and only
one — a sampled minimum can only ever be too FAR, because the true vertex lies
between two samples and both are further from it — so the screen read "passes
six miles east" about a storm forecast to cross the roof. So `closestApproach()`
ternary-searches the two intervals either side of the best sample and now agrees
with a 200,000-step brute force to under 0.01 nm and half a minute, which
`tools/test-home.mjs` and `tools/test-home-ida.mjs` both check by running that
search rather than by comparing against a pasted number.

The remaining error is in reporting that minimum unconditionally. A great circle from Louisiana to
the West Pacific crosses Alaska, so a typhoon bound for Taiwan gains 230 nm of
7,315 and the app prints "closest approach in 2 days."

**A cyclone is ephemeral, not orbital.** It lives days and dies where it dies; it
never comes round the far side. So the minimum is filtered, then described by two
orthogonal flags, all tuned by `APPROACH` in `config/constants.js`:

- **Past points are skipped.** Neither source's track starts at "now" — GDACS
  splits on the advisory ISSUE time, NHC's tau 0 is the synoptic analysis up to
  3 h behind issuance, and the advisory itself may be hours old. The current
  position is the one deliberate exception and the anchor.
- **`trend: 'closing' | 'receding'`,** never null, and it is a statement about
  the TRACK, not the clock: closing means the forecast beats the current position
  by more than `minGainNm`. Lead time is deliberately NOT part of it — a minimum
  forty minutes out is still a real minimum, and `formatUntil` renders anything
  inside two minutes as "now".
- **`relevant: false` beyond `relevanceNm` (1,500 nm),** orthogonal to `trend`.
  It does not decide whether anything is reported — that would make it a
  story-switch, and two East Pacific storms both bound for Hawaii at 1,408 nm and
  2,368 nm would read as two different situations for want of 92 nm. It only
  picks which true sentence fits.

**Three sentences, from those two flags**, each checked against what it claims:

| flags | sentence |
|---|---|
| `closing` + `relevant` | "Closest approach", with a number and a time |
| `receding` | "Moving away, never closer than current position." |
| `closing` + not relevant | "Moving away — never comes near home" |

A `null` return is a fourth thing entirely — "no forecast track", which is "we
cannot say" rather than any of these (§5).

**Every state of the approach block has words — there is no silent path.** Five
outcomes, worded to distinguish what is actually different: pre-fetch and
in-flight both say "Loading forecast track…"; a source that never publishes one
says so; a failed fetch says the track didn't load and offers Retry; a bundle
that arrived with no points says "No forecast track in this advisory" UNLESS that
layer's slot reads `unavailable`, in which case it is a failure and gets the
failure wording.

**More than one Retry can be on the panel at once**, so the handler binds every
`.detail-retry` by class. Binding one by id catches only whichever comes first in
the document and leaves the rest dead.

### The storm list's trend word comes from dead reckoning

Rows hold no geometry — tracks are fetched per storm on selection — so
`motionTrend()` projects the published `headingDeg`/`speedKt` forward
`trendProbeHours` along a great circle and compares. It returns null for no
motion data, a stationary storm, a storm beyond `relevanceNm`, or a broadside
pass inside the `minGainNm` deadband.

**GDACS publishes neither heading nor speed, so every GDACS row shows no trend
word.** Inventing a direction for a source that publishes none is the fabrication
§5 forbids.

### Units

Auto from locale, with a manual override in Settings. Auto alone breaks for the
American living abroad; a setting alone is a chore for everyone else.

| | Imperial | Metric | Stored as |
|---|---|---|---|
| Wind | mph | km/h | **knots** |
| Distance | miles | km | **nautical miles** (NHC native) |
| Pressure | mb | mb | mb |
| Surge | ft | m | ft |

- **Convert at render only**, never in storage or logic.
- **AUTO IS A STORED VALUE, NOT A SYNONYM FOR WHAT IT RESOLVED TO ONCE.** The
  preference persists as `auto` and is collapsed against the device locale at
  every render (`resolveSystem`), so a phone that travels — or a browser whose
  locale changes — follows along instead of being frozen to whatever it meant on
  first run. `main.js` owns the single resolver and injects it into every view.
  Two surfaces resolving it separately is how one drawer ends up showing miles
  above kilometres.
- **A formatter nobody passes a system to is a formatter with an opinion of its
  own.** Correct conversion functions shipped for weeks while callers silently
  took the default and two Settings sliders were hardcoded to `km` on a screen
  where everything else said miles. Machinery existing is not machinery wired.
- **THE USER'S UNITS LEAD. THE SOURCE'S FOLLOW, IN PARENTHESES** — "98 mph
  (85 kt)", "1,597 mi (1,388 nm)". Knots and nautical miles stay as the footnote
  because the advisory text a few rows down quotes them and a reader
  cross-checking should not have to convert in their head.
- **The storm list carries no source units at all.** It is the glance surface,
  and converting knots in your head is precisely what there is no time for there.
- Pressure is mb in both systems — NHC quotes mb, and inHg is a preference, not a
  system.
- **NHC's own surge legend text is shown verbatim** ("Up to 3 ft"), with the
  conversion in parentheses for metric users. Rewriting an official legend is the
  same class of error as curving official geometry (§7).

**THE SETTINGS SLIDERS CARRY NO EXPLANATORY PROSE.** A slider with a name, a live
figure in real units, and a globe visibly responding underneath it explains
itself better than a sentence can. The one exception is the MESH-HEIGHT note,
because that control's two options differ in a way only words carry: a forecast
peak looks identical to a measured one, and only the text says which you are
looking at.

### Time

- Everything stored UTC, formatted at render via `Intl.DateTimeFormat` against
  the device timezone. No library.
- **Both feeds hand the render path a UTC ISO string ending in `Z`.** GDACS
  stamps arrive bare and are normalized at ingest (§4); NHC's arrive already
  marked. `lib/time.js` therefore never has to know which source a storm came
  from — and nothing may reach it that has not been through that parser.
- **Local time to the user, absolute first, relative in parentheses:** `3:00 AM
  Thu (in 14 hrs)`. Relative alone hides what matters — 3 AM tells you it arrives
  while you are asleep. That is a decision-screen requirement, not a formatting
  preference.
- **Never a bare time without a weekday** beyond ~12 hours out. "3:00 AM" that
  could be tonight or tomorrow night is a dangerous ambiguity on the home panel.
- **The relative half runs in both directions** — `in 14 hrs` and `14 hrs ago`
  off one function, at one set of boundaries. §49.4.
- 12 h / 24 h follows locale. No separate setting.

---

## 16. Screen architecture

### Always on screen

Four things. Everything else is on demand. The globe is the product; chrome earns
its pixels or it goes.

1. **The globe** — full bleed, always the background layer.
2. **Status strip** — top edge. Source health, stale flags, "GDACS is not
   responding." Silent when everything is clean. Its ladder is below.
3. **Control cluster** — bottom-right vertical stack, top to bottom: **view
   control, Storms, Layers, Home, Settings.** Bottom-right because you may be
   holding a phone one-handed in the rain; reachability beats keeping the globe
   unobscured.
4. **The view control** — one button doing the more useful of two jobs.

**Thumb-zone rule (§10) bites here.** The bottom edge is the iOS home indicator
and the Android gesture bar — the OS eats swipes there. Controls float *above*
that strip, never flush to it. Same at the top for the notch.

### Waiting copy — the dots move

Every sentence in the app that means "still working" ends in `…`, and that
character is reserved for exactly that job. It is not a truncation marker
(that is CSS `text-overflow`) and not a dramatic pause. `ui/loading-dots.js`
swaps it for three dots that fade in and out left to right on a
`--duration-pulse` (1400 ms) loop.

**A STATIC ELLIPSIS AND A DEAD SCREEN LOOK IDENTICAL.** "Checking…" reads
exactly like a sentence that has finished and trailed off, so a live fetch and
a surface that had quietly stopped were indistinguishable on glass. The pill
already had a turning mark for this reason; the words did not.

Three shapes, one stylesheet rule (`.dots` in `ui/panels.css`):

- `DOTS` — the markup, for template literals. Sits outside whatever `esc()` the
  call site uses.
- `dotted(html)` — swaps a **trailing** `…` in already-escaped html. A string
  without one comes back untouched, which is what lets one call site cover both
  "Loading…" and "Vendor unavailable — tap to retry" without branching.
- `dotsEl()` / `setDottedText(node, text)` — the same markup as a node, for the
  two `textContent` call sites (the pill's label, the home-setup search status).

**OPACITY ONLY (lens 4).** No width, no transform, no layout. The offsets are
sixths of the cycle rather than thirds: at a third the three dots read as one
dot sliding right, which is a busier animation and a different one.
`prefers-reduced-motion` drops the pulse and leaves the dots solid.

`aria-hidden` on the span — a screen reader gets "Checking" and stops. Three
`<i>.</i>` nodes announced individually are three meaningless periods.

**The first-paint pill in `index.html` carries the markup literally**, because
no module has loaded yet and it is the label a cold start looks at longest.

Nine surfaces use it: the home drawer's chip, waiting paragraph and headline
sentence; the storm panel's forecast track, watches, wind field, advisory and
population rows; both kinds of layer row; the storm pill and the storm list's
loading note; and the home-setup address search.

### The status strip's ladder

`ui/status.js` decides what the FEEDS have to say. `main.js`'s arbiter decides
who gets the one line, because the basemap is a claimant too. One line at a
time, highest severity wins, silent when clean.

| Condition | Message | Tone |
|---|---|---|
| Both sources `unavailable` | Storm feeds are not responding | error |
| One source `unavailable` | *Named*, with the basins it covers | error |
| Basemap source error | Basemap tiles are not loading | error |
| Both fetched > `RELAY_AGE.delayedAfter` ago | Storm feeds delayed — showing last good data | stale |
| One fetched > that ago | *Named* feed delayed — showing last good data | stale |
| Otherwise | *(silent)* | — |

**A FEED OUTAGE OUTRANKS THE BASEMAP; A DELAY DOES NOT.** The order is the
table's order and it is not the obvious one. Losing tiles still leaves a globe
with coastlines on it, so it is a degradation. Losing both feeds leaves an empty
ocean that looks exactly like calm weather, which is §5's whole subject — when
the network goes, both are true at once and the one sentence available must be
spent on the storms. A *delayed* feed is the app working with older numbers and
sits below the basemap, where it belongs.

**The basemap message clears itself.** It is raised by a MapLibre `error`
carrying a `sourceId` and dropped again by a `sourcedata` event carrying a real
`tile` — the closest thing MapLibre offers to "bytes arrived". It was a one-way
latch until then: one rejected tile pinned the message for the whole session.

`tools/offline-check.mjs` asserts the ordering by cutting the network and
reading the strip.

### The pill's three rungs, and why the pill is faster than the strip

The collapsed pill answers "is anything on screen yet". It has three loading
rungs, not two:

| State | Pill says |
|---|---|
| Loading, under `POLL.errorDelayWhenEmpty` | Checking the oceans… |
| Loading, over it, still nothing | Still trying to reach storm feeds |
| Retries exhausted, nothing held | Storm data unavailable |

**A SOURCE STILL IN FLIGHT IS `loading`, NEVER `unavailable`.** The two feeds
are fetched in parallel, so `overallStatus` reads `some(loading)` and not
`every(loading)` — under `every` the faster feed landing empty tipped a healthy
startup straight to the red rung, which is §5's failure pointed the wrong way:
it spends the credibility the real outage message needs. `loading` is an initial
value only and is never restored, so this cannot blank a populated list on a
refresh. `ui/view-storms.js` restates the rule (it may not import the store) and
`tools/test-overall-status.mjs` asserts the two copies agree.

**THE PILL AND THE STRIP MOVE AT DIFFERENT SPEEDS ON PURPOSE.** The strip waits
for `POLL.retryBackoff` to run out — about 68 seconds — because a retry can
still succeed and an outage announced that resolves itself is the false alarm
that teaches people to stop reading the strip. The pill cannot wait that long:
it is what an empty screen is staring at, and one minute of "Checking the
oceans…" is indistinguishable from a hang. The middle rung is true whether the
cause is a dead network or a slow one, which is why it is timed rather than
driven by a failure signal from `data/relay.js`.

`slow` on a source slot is set by a timer in `data/store.js` and only when that
source has no last-good list to fall back on. It is cleared on both exits from
the poll, so it cannot latch.

**The mark turns on both loading rungs.** It is the same `<symbol>` as the boot
screen — defined once in `index.html`, pointed at by both — and it animates only
while `data-busy` is true, so it costs nothing during the almost-always case of
storms being on screen.

**The loading rungs carry their own line breaks.** "Checking the / oceans…" and
"Still trying to reach / storm feeds" are written with a `\n` in
`ui/view-storms.js`; `setLabel()` makes each line its own block. Letting the
browser choose split an article off its noun and broke the second rung mid-verb,
and it also caused the lopsided padding — a span sized to its longest unwrapped
line carries the slack inside itself. Both gaps are 17 px now.

**Rewording either rung means re-checking its break.** They are the two messages
on this surface that need two lines, and the break is part of the wording.

**THE MARK SITS AFTER THE TEXT AND SIZES ITSELF.** `align-self: stretch` plus
`aspect-ratio: 1` means it is as tall as the pill allows and follows the text
when it wraps, so there is no px literal to be wrong in one of the two states.
`SIZE.pillInset` keeps the pill clear of the info button and the control column.

**THE PILL USED TO BE CAPPED AT HALF THE SCREEN BY ACCIDENT.** It had a `left`
offset and no `right`, and a fixed element with one horizontal offset gets the
viewport minus that offset to lay out in — 195 px on a 390 px phone. Every
message it ever showed wrapped because of it. Both edges are pinned now and
`margin-inline: auto` does the centring, which is why the hidden state's
transform is a pure vertical slide with no `translateX(-50%)` in it.

**`max-width: 100%` IS NOT THE SPACE BETWEEN THE INSETS.** On a fixed-position
element the percentage resolves against the viewport, so it clamped at the full
screen width and clamped nothing; the long message ran under the settings
button. It is `calc(100% - 2 * var(--pill-inset))`.

**THE SYMBOL LIVES OUTSIDE `#boot`, AND THE PLATE IS OPTIONAL.** Two things that
each cost a trip to a phone to find. `#boot` is REMOVED from the page once the
globe has a frame, so a definition inside it takes the pill's spinner with it —
right size, right place, turning, and empty, with no error anywhere. And the
mark's first group is the app icon's full-bleed square background: correct at
88 px on the boot screen, a dark sticker at 22 px, and a rotating square reads
as a bug however good the artwork is. `--mark-plate: transparent` drops it.
A custom property is the only lever here — `<use>` content sits in a shadow tree
ordinary selectors cannot reach, but custom properties inherit into it.

**THE SYMBOL LIVES OUTSIDE `#boot` AND MUST STAY THERE.** `main.js` removes the
boot element once the globe has a frame. Defined inside it, the symbol was
deleted along with it and the pill's spinner pointed at nothing for the rest of
the session — right size, right place, turning, empty. A `<use>` that resolves
to nothing draws nothing and reports no error, so this is invisible to every
check except a screenshot.

**DELAY IS JUDGED BY AGE, NEVER BY `X-Landfall-Stale`.** That header meant
"upstream failed" until the storm-list routes began serving expired copies on
purpose and refreshing behind the response (SPEC-DATA §4.13). It now covers a
routine 31-minute-old cache and a genuine NOAA outage alike and cannot tell them
apart — it drove this strip for one afternoon and raised a NOAA-outage alarm on
a healthy feed, caught on a phone. It stays honest on the storm detail panel
("served from cache"), where it is a fact rather than an alarm.

**`RELAY_AGE.delayedAfter` measures OUR PIPELINE, not NHC's publishing.** It is
90 minutes and it is deliberately NOT derived from `ADVISORY_CADENCE`; the
reasoning, and what a cadence-derived number would hide, is in `RELAY_AGE` in
`config/constants.js`. Do not "harmonise" it with `FRESHNESS`, which answers a
different question about a different clock.

**A false alarm is not cosmetic here.** §5's rule is that a feed outage must
never be silent. The corollary: an alarm that fires during normal operation is
one people stop reading, which costs us the outage it exists for. Both
directions are asserted in `tools/test-status-delay.mjs`.

**Both sources get every message, and that depends entirely on both stamps coming
from the relay.** `fetchedAt` is read off `X-Landfall-Fetched-At` in
`data/nhc.js` and `data/gdacs.js` alike, with a fall back to the device clock
only when the header is genuinely absent. **A stamp minted on the device is
always zero seconds old**, so a source that mints its own turns every branch
here into unreachable code — silently, and looking perfectly healthy. GDACS did
exactly that and NHC was the only feed able to trip this banner. First thing to
check if a third source is ever added.

### The settings drawer's order

`ui/view-settings.js`, `build()`. Install · Theme · Units · **Mesh height** ·
**Globe drift** · Storm imagery · About.

**Globe-SHAPE controls sit above globe-MOTION controls.** Mesh height changes
what the planet is; drift changes what it is doing. The one that alters the
picture goes above the one that animates it.

The order lives in exactly one template string. Every block is self-contained
and wired by element id, so reordering cannot change behaviour — and the drift
block's two sliders hide when its switch is off, which is why it wants to be
lower: it is the one block whose height changes.

### The view control — one morphing button

**Off north it is a COMPASS.** The needle rotates every frame to keep pointing at
true north on screen (`-bearing`, since bearing is the direction the camera
faces), and tapping it eases the bearing back to 0 — **just the bearing.**
Someone who rotated the globe to read a track at an angle wants it upright, not
to be thrown back into space and lose the storm they were reading.

**At north it is the CROSSHAIR**, and tapping it flies all the way out to the
space floor, clears the storm selection, and centres on **your home if you have
one, the contiguous United States if you do not** (`GLOBE.fallbackCenter`). "Take
me back" landing on open water with the coastline off the left edge is the wrong
answer.

**The camera the app OPENS on is the same answer.** `main.js` builds the globe
with `createGlobe(globeEl, recenterTarget(getHome()))`, so boot and recenter
share one decision point rather than two that can drift apart. Home is read
synchronously off `localStorage`, so the first painted frame is already centred
correctly — there is no flash of the United States followed by a jump. **Only
the centre**: the opening zoom is always `spaceFloorZoom()`. A home means "start
with my part of the planet facing me", not "start zoomed in on my street".

**One control rather than two**, because they are the same request at two scales:
put the view back. A compass that appears and vanishes at north leaves a hole in
the cluster and shifts every button under it — a moving target in the thumb zone.
A permanent compass at north is a control that visibly does nothing. It sits at
the TOP of the cluster because it is the way out of wherever you are; the four
below it are places to go.

- Both marks live in the button at once and cross-fade on opacity — swapping
  innerHTML would reparse an SVG per frame during a live rotation gesture. Only
  the needle's inner `<g>` is transformed.
- **The `aria-label` tracks the mode.** A screen-reader user told "recenter" who
  gets a rotation is worse off than one with no label.
- **The tolerance is `GLOBE.northTolerance` (0.5°), not zero.** Bearing is a
  float and a two-finger gesture almost never lands on exactly 0; a zero test
  leaves a compass showing at 0.03°, offering to fix something nobody can see.
- **The mode variable is seeded `null`, not `false`.** The sync early-returns
  when the mode has not changed — it runs on every frame of every camera move —
  so seeding a real state makes the first call a no-op and the button keeps the
  placeholder `aria-label` from the HTML until the user has rotated and come
  back.

**THE NEEDLE TRACKS BEARING AND NOTHING ELSE, AND THAT IS NOT A SHORTCUT.** On
MapLibre's globe projection at bearing 0, north IS straight up everywhere that
matters: measured on the live map at six centres spanning the globe ([0,0],
[-90,30], [-52,22], [20,60], [-98,39], [140,-20]), both the local north vector at
the view centre and the screen direction to the actual pole read **exactly
0.00°** at every one. The projection places the view centre at screen centre with
its meridian vertical, so panning changes WHICH piece of the globe you see, never
which way north points from where you are looking.

Meridians curve away from the centre, so "which way is north" genuinely has a
different answer at every other pixel — but the needle is one arrow in one
corner, and the only non-arbitrary point for it to answer for is the centre. A
needle that moved while panning would have to be measuring something other than
north. **Do not "fix" this by inventing a quantity for it to track.** The honest
alternatives are a compass that sits still (this) or a reset-state indicator that
should not be shaped like a compass. The complaint this usually comes with is
about the globe drifting away from where it was left, which is a setting (§9).

### One drawer, views inside it

There is exactly ONE panel element on screen (`#drawer`, `ui/drawer.js`). Storms,
storm detail, layers, home and settings are VIEWS INSIDE IT, not sibling panels.
The drawer slides in once and does not re-animate when you move between views;
only the body crossfades. Glass, translucent, globe visible behind, never
full-screen.

**Docking adapts to width, not device** — same DOM element, CSS moves it:

- Narrow → bottom sheet, slides up, ~60% height max
- Wide → left rail, fixed width, full height

No `isMobile`, no second markup tree. A touchscreen laptop gets the rail because
it is wide, and that is correct.

**One view at a time, on every screen size**, and one state machine rather than
two. **A second desktop slot was considered and declined** (Aaron, 2026-08-18) —
one view everywhere means one state machine, and that is the point.

**NAVIGATION IS A REAL HISTORY STACK, and "back" means where you just were.**

```
storms → detail → layers      back ⇒ that storm's detail, not the list
```

Opening Layers from a storm is a SIDE TRIP and the storm survives it. Back walks
the stack; Close dismisses the drawer entirely.

**WHICH CORNER BUTTON DECIDES, NOT THE FACT OF PRESSING ONE.** The rule is
`clusterAction` in `ui/drawer.js` — a pure function with four outcomes, stated
as a table in `tools/test-drawer-nav.mjs`:

| Pressed | Drawer state | Result |
|---|---|---|
| the view already showing | open | **close** — the button that opened it dismisses it |
| **Storms** or **Home** | any | **go** — a fresh root, the stack thrown away |
| **Layers** or **Settings** | shut | **go** — nothing to sit on top of |
| **Layers** or **Settings** | open on anything else | **push** — Back returns to it |
| **Layers** or **Settings** | open on the *other* side trip | **swap** — replaces it, the stack does not grow |

Storms and Home are DESTINATIONS. Layers and Settings are SIDE TRIPS — places
you step aside to while still reading something. The test is not "is it
configuration", because Home is configuration too; it is whether arriving there
means you have finished with what you were looking at.

**Home must never push**, and that is behaviour rather than taste. Pressing it
is a fresh ask by definition (`fresh` below — the dashboard forgets which storm
you stepped to), and a pushed Home also loses its eyebrow, leaving a header that
names a storm with nothing saying which drawer you are in. **The swap caps the
stack at three** — destination → detail → side trip. Four corner buttons that
all pushed would be a stack a reader could grow all afternoon and then have to
unwind one press at a time.

**The back button carries the previous view's NAME, and a view whose title is a
node supplies one.** `backLabelFor(arg)` beats `titleFor`, which returns the
storm identity block and has no string in it — so Back from Layers read
`‹ Storm` rather than `‹ Hurricane Erin`, which does not say *which* storm
survived the side trip. `titleFor` is NOT called when `backLabelFor` answers:
the detail panel's assigns its `storm` from the argument, and labelling a button
must not reach into a view that is not on screen.

**Focus on close returns to the control that put you on the current step**, not
to whatever opened the drawer. `from` lives on the stack entry; a step opened by
a row tap carries none, so the lookup walks down to the nearest one that does.

### This was wrong in this file for a month, and the shape of the mistake is the lesson

The route above was written here as as-built and was reachable from nowhere. The
detail panel's own Layers shortcut was deleted on 2026-07-25 (one door per
layer), leaving the floating button as the only way in — and it called `go`.
Nothing caught it: every module parsed, every suite passed, and the app worked.
It simply had no Back button on a screen three files said had one. **A `go`
where a `push` belonged does not throw.** Navigation has no error state, which
is why the model now lives in a pure function with a test rather than inside
`boot()`'s closure where no assertion could reach it.

**At phone width the open drawer COVERS the control cluster, and that is
intended.** Measured at 390×844: the drawer top sits at y=620 while `#btn-storms`
spans y=636..680, so the button that opened a view cannot be tapped to close it.
Nothing is trapped — the X and Esc both close the drawer — and the rule below is
why this is right rather than tolerated. **Do not "fix" it.** It is also why the
side-trip push only ever matters on the WIDE layout, where the drawer is a left
rail and the four buttons stay in the corner.

**The hidden cluster is `visibility: hidden`, not merely transparent.** It was
`opacity: 0` plus `pointer-events: none`, which hides four buttons from a finger
and a mouse and leaves every one of them in the tab order and the accessibility
tree — a keyboard user with a storm open could Tab out of the sheet into an
invisible Layers button and press it, and a screen reader read all four aloud.
Same delayed transition as the drawer itself (§13): the fade plays, then the
buttons go untabbable on arrival.

**NO TAB ROW inside the drawer.** Home and Settings are configuration — you
arrive, you set, you leave — and nobody switches to them mid-storm. A persistent
nav would cost ~44 px of a 60vh sheet forever to duplicate controls that already
exist in the cluster. This is also why the cluster hiding behind an open sheet at
narrow widths is harmless: while the drawer is open the only navigation anyone
wants is Back, and Back is in the header.

**EVERY VIEW OPENS AT ITS TOP.** A drawer view is `hidden`, never destroyed, and
`hidden` preserves scroll offset — so reopening one put the reader wherever they
had left it, possibly days earlier. Measured on glass 2026-08-11: Home opened
with the storm's name half under the title fade, Layers with its first segmented
control sliced through the middle, Settings the same. It reads as a rendering
fault, and worse, nothing cues the reader that anything exists above what they
can see. `enter()` resets the scroll **after** `onEnter`, not before: a view that
rebuilds its body on entry — the home dashboard does, on every render — would
otherwise have the old offset restored behind the reset. It resets
`.drawer-body` and `.detail-body`, not the host: `.drawer-view` is a flex column
with no overflow, and **`scrollTop` on an element that cannot scroll is a silent
no-op**, so the wrong version of this looks correct in review and changes
nothing on a phone. `tools/drawer-scroll-check.mjs` holds it, in a browser,
because that is the only place the difference is observable.

**AND THE RESET IS ONLY HALF OF IT: A VIEW'S FIRST FOCUS STOP MUST BE REACHABLE
WITHOUT SCROLLING.** Focusing an element scrolls it into view, so `enter()`
resetting the offset and then moving focus can undo itself on the same frame.
That is what kept the Home drawer opening halfway down after the reset above was
already correct: it nominated its Edit-home button, which is the *last* section
of the dashboard (§16, and deliberately so — setting home is a once-a-year
action). Home now keeps the same contract the storm detail panel does — the
chevron just pressed, or nothing, falling through to the drawer's Back button in
the fixed header — and `enter()` focuses with `preventScroll` so no future view
can bring it back. **The order is not swappable:** resetting *after* focusing
would fix the offset and leave the focus ring off screen, which is worse. Layers
and Settings legitimately focus controls inside their bodies (measured at 80px
and 309px into a 424px body); that is fine and the rule is reachability, not
location. Settings is the one to watch — its target is whichever segment is
checked, so it moves with the reader's own preferences.

**CONTENT DISSOLVES AT BOTH ENDS, IT IS NOT GUILLOTINED AT EITHER.** Every
view's `.drawer-body` carries a 12px fade band at its top (`--scroll-fade`), so
a row scrolling up under the title thins out instead of being cut clean in half
at the scroller's edge — a hard cut reads as a rendering fault rather than as
"there is more above". It is a **mask on the content**, not an overlay: this
panel is glass, and any gradient strip painted on top would have to be a color
and would show as a lighter band against the blur. Masking fades the content
itself to transparent, so what shows through is the same glass and the same
globe as the rest of the panel. **It is not a `backdrop-filter`** — a second
blurred surface re-evaluated on every scroll frame, on a phone already running a
globe, is exactly the trade §9 refuses; a linear-gradient mask composites on the
layer that already exists and costs nothing per frame. The same 18px is also the
scroller's TOP PADDING, and that is load-bearing: a mask on a scroller is fixed
to the element's own box rather than to the content, so without matching padding
the first row would sit permanently half-faded at rest.

**THE SCROLLER STOPS AT THE PANEL'S ROUNDED CORNER, AND THE BOTTOM FADE EXISTS
BECAUSE OF IT.** The wide rail is rounded on its right edge and the scrollbar
lives on that same edge, so a body filling the panel to the last pixel ran its
track through the curve — a straight bar carrying on past the edge of the thing
it belongs to. A scrollbar cannot be shortened on its own; it always fills its
scroller. So the scroller ends early, via a transparent bottom border of exactly
`--radius-large` (`--body-end`), which is where a scrollbar track stops because
a track is laid out inside the border edge. Clipping it with `overflow: hidden`
on the drawer would have trimmed the bar to the curve, and a thumb sliced off on
a diagonal is a different wrong answer rather than the right one. **The phone
sheet leaves `--body-end` at zero:** its bottom corners are square and a phone
has no visible scrollbar to run into them.

Moving the scroller's edge up moves the CONTENT CLIP up with it, and a hard cut
floating 16px above the panel's own bottom edge reads as a rendering fault
exactly the way the top one did — which is why the mask now fades at both ends.
**Every bottom mask stop backs off by `--body-end` first**, because `mask-origin`
is the border box: a fade ending at 100% would land inside the transparent
border where nothing paints and would do nothing at all. The 16px of bottom
padding is what keeps the last row crisp at rest, the same relationship the top
stop has with its own padding.

**THE WIDE OVERRIDE IS `#drawer .drawer-body`, NOT `.drawer-body`.** The default
sits ~200 lines further down the same stylesheet and a media query carries no
specificity of its own, so the class-only version tied and lost on source order:
the property computed to `0px` and the corner stayed exactly as broken with the
fix apparently in place. Caught only by reading the computed style out of a
browser. `tools/test-css-vars.mjs` pins the selector.

**THE PADDING MUST EQUAL THE MASK EXACTLY, AND BOTH DIRECTIONS ARE BUGS.**
Shorter and the first line renders inside the gradient — measured at 8px against
an 18px fade while removing what looked like a doubled padding and was not, and
the storm's name came out ghosted. Longer and it is dead space above the thing
the panel is about. Note that `.home-dash` and `.drawer-body` are the **same
element** (view-home mounts one div carrying both classes), so a `padding-top`
rule on `.home-dash` restates the value rather than adding to it; there is no
nested wrapper and never was. The band was cut from 18px to 12px on 2026-08-11:
it is a decorative gradient and it was charging six pixels of every panel's most
valuable space, on the mask and on the padding it dictates.

**THE HEADER ROW IS AS TIGHT AS ITS CLOSE BUTTON ALLOWS.** Measured rather than
guessed: 60px, of which 44 are the close button's touch target (§16), which is
not negotiable. Only the padding was ever available and it is 4px top and bottom
— 52px total. Going further means shrinking the tap target, which trades a real
accessibility guarantee for eight pixels.

**THE HEADER IS LEAD · TITLE · CLOSE, AND CLOSE IS ALWAYS AT THE TRAILING EDGE.**
The back button is `display: none` whenever the view is a root, and under the
original `grid-template-columns: auto 1fr auto` the two remaining children
shifted one column left, so the close button landed left-aligned in a very wide
box, apparently welded to the word "Layers". **The general trap: a positional
layout plus a conditionally-hidden child is a layout that silently means
something different in each state.** It became flex, and is now a three-column
grid again — but with `minmax(0,1fr) auto minmax(0,1fr)`, whose outer columns
take equal shares so nothing is positional. See the centring note further down
this section for why the title had to stop being left-aligned.

**THE DRAWER TITLES A VIEW BEFORE IT ENTERS IT.** `enter()` calls
`renderChrome()` — and therefore the view's `titleFor(arg)` — **before**
`onEnter(arg)`. The storm detail view's `titleFor` assigns `storm = s` on its way
past, because the header names itself from its own argument. So **inside
`onEnter`, a comparison against the view's own current-storm variable is already
stale and can never detect a change.**

**AND IT TELLS THE VIEW HOW THE READER ARRIVED.** `onEnter(arg, { fresh })` —
**true only for `go`**, which throws the history stack away, and false for `push`
and for `back`. `go('home')` and `back()` onto the same root both arrive with an
undefined argument, so this is not derivable inside a view and is invisible in
markup: it is a fact about the call. It exists for state a view holds on the
reader's behalf — the home dashboard's manually stepped-to storm (§8) is the only
one today. **A fresh entry means a new question and that state starts over; a
return means the same visit continuing and it must not.** Resetting on a return
would drop the reader somewhere they never navigated to, which is the same class
of fault as not resetting at all. `tools/drawer-head-check.mjs` reads the flag
off the call itself, since nothing else can see it.

**THE RULE THIS EARNS: a view MUST NOT infer "did my argument change" by
comparing against state another lifecycle method can assign.** Either bind the
state to the identity it belongs to and treat a mismatch as stale (what the
advisory record does — `forId` + `forKey`), or compare against a variable only
`onEnter` writes. Never both-and-hope.

**A sequence-number race guard does not catch a staleness bug.** One was already
on the advisory fetch and did nothing, because nothing raced. Different failure,
different guard.

| View | Contents |
|---|---|
| **Storms** | Storm list, two lines per row. Tab order and screen-reader authority. |
| **Storm detail** | Pushed onto the stack from Storms. Back returns to the list. |
| **Layers** | Two groups, exclusive pairs as segmented controls, per-model selector with swatches (§7). |
| **Home** | Distance and closest approach; wind arrival, exposure timeline and surge-at-home when built. |
| **Settings** | Install door (top, amber), **theme** (Dark / Light / Automatic), **units**, **globe drift** (on/off, speed, delay), mesh height, imagery tuning sliders. |

### Two scoped sections were retired here on 2026-08-08

**The event model** (generalising `storm` to `event` across the list, the detail
panel and the layers panel) and **the world switcher at the space floor** both
lived here as "scoped, not started". Landfall is cyclone-only now and neither is
on the roadmap. Read them at `git show worlds-v1:SPEC-UI.md`.

Two rules they carried are NOT specific to that expansion and still hold
everywhere in this file:

- **Group with headers, never a filter.** A filter can hide something that
  exists; a header cannot. Same reasoning that removed the scope filter on
  2026-07-25.
- **A gesture-only affordance does not exist** (§10). Anything reachable by a
  drag or a pinch needs a real focusable twin running the identical action, with
  a visible focus ring and a screen-reader label.

### First launch — NOTHING IS OPEN, at any width

The globe is the product. Opening a rail over it on arrival buries the thing the
user came to look at behind a list they did not ask for.

- **Narrow:** collapsed pill above the thumb zone — `6 active storms`. Tap
  expands into the drawer's Storms view. The pill is the narrow-width entry point
  and shows itself.
- **Wide:** nothing open. The pill is hidden by CSS; the control cluster is the
  entry point.
- Tab from the globe reaches the controls either way.

### Selection

Tap a storm dot on the globe, tap a list row, or press Enter on a focused row —
all identical. Camera flies, detail panel opens.

- **flyTo centers on the visible globe area, not the viewport.** The bottom sheet
  eats the lower 60%; the rail eats the left third. Centering on the viewport
  lands the storm underneath the panel that just opened. Invisible on a desktop
  browser, obvious the moment you hold a phone.
- **The mechanism is flyTo's `offset`, NEVER its `padding`.** `padding` is not a
  one-shot flight parameter: it persists in the map transform, and from then on
  MapLibre renders its globe offset from canvas center while everything slaved to
  the camera through `project()` — the 3D cage, the home marker, the dive — was
  built against a zero-padding transform. The two globes visibly slide apart on
  the next zoom. `offset` moves only that animation's target and leaves no state
  behind. The values derive from the panel's real box at fly time (`main.js`), so
  there is no `340px`/`60vh` duplicate free to drift from the CSS.
- **Panel opens and camera flies together**, not sequentially — sequential reads
  as lag. Both transform/opacity, both on the same motion constant.
- **Closing:** back button, Esc, or tapping empty ocean. **Closing does not fly
  back out** — holding the camera is what lets you dismiss a panel to look at the
  map underneath it, which is the most common reason to close it. Esc twice
  recenters (§10).

### Storm list

**EVERY ROW SAYS THE SAME THINGS ABOUT EVERY STORM ON EARTH.** A column that can
only be filled for some storms does not belong on this surface; it belongs on
the detail panel or the home drawer, where one storm has room to explain itself.

**The fault line is not NHC versus GDACS — it is matched versus unmatched, and
it moves.** `applyJtwcWind` writes the whole NHC field set back onto a GDACS
storm JTWC is warning on, so a matched storm is field-identical to an NHC one.
Measured on the live feed 2026-08-10, with NHC empty and four GDACS storms up:
Peilou, Chan-hom and Fifteen were matched and carried wind, gusts, pressure,
heading, speed and a real Saffir-Simpson category. Dolphin — the strongest
system on the globe, 35 hours since its last fix — had none of them. JTWC picks
storms up and drops them, so a row cannot be designed around "GDACS shows less".
It has to be designed around "any storm may show less at any moment".

**Two lines are the contract; the third is enrichment.**

```
NORTHWEST PACIFIC
  ● Fifteen                          TD
    6,333 mi WNW               7 hrs ago
    ↖ closest 120 mi in 9 hrs

  ● Dolphin                          HU
    7,956 mi NNW            not updating

FINISHED
  ● Twenty-Two                    CAT 5
    11,204 mi NNW                  ended
      never comes near
```

The arrow on line 3 is a compass heading (§16.4) and is absent on the ended
storm because nobody published a motion for it and its bundle carries no
forecast to derive one from. The Dolphin row has no line 3 at all — a different
absence, and the reason is on its detail panel.

Lines 1 and 2 are built from position and timestamp alone, so they are present
on every storm from every source in every state. Line 3 comes off the warm
geometry cache and is genuinely absent while a fetch is in flight or when a
source publishes no track — its absence breaks no alignment, because the lines
above it are complete on their own.

**Two axes.** Left edge is identity and where the storm is; right edge is
classification and how current the row is. Two vertical columns down the whole
list, so the eye compares by position. The row used to be one dot-separated
string assembled with `.filter(Boolean)`, which meant a missing fact slid every
later fact left and the reader could never learn where to look.

**WIND IS NOT ON THE ROW.** It printed the current wind for a matched storm and
the FORECAST PEAK for an unmatched one — two different quantities in one
column, and the peak is the larger, so Dolphin's row claimed a number three
times its neighbours' while meaning something else entirely. Wind and category
are the same fact at two resolutions and only the category survives on every
row, so the number moves to the detail panel where it can be attributed
("JTWC · 3 hrs ago" against "GDACS forecast peak"). Blanking it instead was
considered and rejected: a dash beside the strongest storm in the list reads as
"nothing here".

**THE TREND WORD IS NOT ON THE ROW EITHER.** `motionTrend` is dead reckoning off
`headingDeg` and `speedKt`, which GDACS does not publish, so it was blank on
every unmatched storm. The track's own minimum replaces it: `data/gdacs-points.js`
emits the same `{lon, lat, time, windKt, tau}` shape `data/nhc-mapserver.js`
does, so closest approach answers identically for both sources. It is also
strictly more informative than the word it replaces.

#### 16.4 The heading arrow — one mark, three surfaces

**The arrow is a compass, not a relationship.** It points where the cyclone is
travelling, north up. It replaced a `↗`/`↘` pair that meant "moving away from
your house" and "closing on it" — a fact about two points wearing a direction's
clothes, on a row that also carries a real bearing five characters away. It read
as a heading because it looked like one.

**Nothing was lost in the swap.** Closing versus receding is carried by the
row's tone (`far` dims the whole line) and by the words beside the arrow, both
of which were already saying it.

**Two sources, in order, and never a third** (`lib/heading.js`):

1. **Published.** `storm.headingDeg` — NHC's `movementDir`, or the value
   `lib/jtwc-wind.js` writes onto a GDACS storm JTWC is warning on. Always wins,
   even when a track is loaded, because it is what the advisory a reader can go
   and check actually says.
2. **Derived.** The bearing from the current position to the first forecast
   point at least `MOTION.minTrackNm` (30 nm) away, walking at most
   `MOTION.maxProbePoints` (4) points. Nearer points are two roundings of the
   same position and their bearing swings between polls on a storm that has not
   turned.
3. **Nothing.** No arrow. GDACS publishes no motion at all, so a GDACS storm
   with no JTWC warning and no geometry loaded has neither source — an invented
   direction is the §5 fabrication, and a missing mark reads as "not stated"
   while a wrong one reads as fact.

**Where it appears.** The storm row's line 3, the detail panel's `Moving` row,
and the home dashboard's motion line. One component, `ui/heading-arrow.js`, an
SVG drawn pointing north at 0° and rotated by `transform` alone, stroked in
`currentColor` so each surface's existing ink drives it.

**Where it deliberately does not appear.** Beside `6,363 mi WNW`. That is the
bearing FROM the reader TO the storm — the same-looking mark, the opposite
meaning, and the way a reader concludes a storm is coming at them.

**The row holds the slot open when there is no arrow.** `.row-track-lead` is a
fixed-width span, always written, empty when there is no heading. Without it,
line 3's text would start under the arrow on some rows and under line 2's text
on others.

**The rotation is spoken.** `headingSpoken` splices "moving northwest" into the
row's `aria-label`, spelled out rather than abbreviated — a screen reader says
"N N E", which is not a direction anybody hears. The old glyph only needed its
one word translated; a continuous heading is a new fact that lives in a
`transform` and nowhere else.

**If this arrow is ever drawn ON the globe** it must also be rotated by the
map's bearing. North is up only at the centre of a globe projection.

**The detail panel gets a row the agency never gave it.** Where there is no
published motion but the forecast track defines a heading, the panel adds
`Track heading — NW · from the forecast track`. Named as a derivation, and
carrying **no speed**: dividing the chord by its forecast hours would put an
invented number beside a quoted one with nothing to tell them apart. The home
dashboard says `Its forecast track runs NW` for the same case, never `Moving
NW`, which would read as a quote from a bulletin nobody wrote.

- **Row:** category swatch (§6, the same color as the globe dot, so the list is
  its own legend) pinned to the name's line, then the name, then the category as
  a WORD at the right edge. Underneath: distance and bearing left, freshness
  right. Underneath that, when known, the trajectory.
- **The badge is neutral ink, never the category color.** The swatch already
  carries the hue; tinting the badge says it twice, and would put Cat 1's
  `#FFE14D` at 0.73rem on the light theme's background where it cannot reach AA
  at any weight. Color is the pre-attentive channel, text is the precise one.
  Measured in both themes: every element on the row clears AA, tightest 4.80:1.
- **The list drawer uses TABULAR FIGURES, never the code face.** `--font-numeric`
  is right for a coordinate — a dense string of digits read character by
  character — and wrong for a line that is mostly words with a number in it
  ("312 mi NW", "3 hrs ago", "closest 120 mi in 9 hrs"). Setting those in a
  monospace face made the words read as machine output rather than as a
  sentence about a storm. `font-variant-numeric: tabular-nums` keeps the one
  thing the code face was buying: equal-width digits, so distances and ages
  line up down the list and a poll updating "9 hrs" to "10 hrs" shifts nothing.
  Applies to `.row-where`, `.row-track`, `.row-meta` and `.watch-count`; the
  storm panel and the area panel's coordinates keep the code face.
- **The name is never truncated.** It is how you refer to the storm, how you
  match it to a forecast you heard elsewhere, and how a stranger arriving by
  shared link knows what they are looking at. It wraps; the badge stays on the
  first line.
- **One freshness slot, four tones, never moving, and never blank when there is
  a timestamp.** Fresh is `--text-muted` (current, on schedule), stale is amber
  (an update is overdue), silent is `--error` (the publisher has stopped), ended
  is secondary text (the quietest — there is nothing to do). Each REPLACES the
  one below it: "26 hrs ago" on an ended storm reads as a late update on
  something still running.
- **The color is the state; the text is just the clock.** Every row carrying an
  observation time reports its age, in the same words and the same slot, and
  only the ink changes. The slot used to render only when something was WRONG,
  which made a healthy row a blank — indistinguishable from a stamp that failed
  to render, and it left amber and red as the only marks in the column, so a
  routine two-hour-old advisory read as a warning purely by contrast with the
  nothing around it.
- **A storm with no observation time still gets nothing.** There is no age to
  report and "just now" invented for a reading of unknown age is the fabrication
  §5 forbids. A visible gap is the honest outcome, so the fresh stamp is guarded
  on the timestamp existing.
- **The ended state is the one that also says WHEN**, because it is the one that
  has stopped moving. The other two are a single qualifier whose whole job is to
  keep changing; this one never changes again, so it can afford a clock beside
  the word — `ended  Sun 3:00 PM`, the time one shade quieter than the state.
  It reads `ended.at`, the **agency's own issuance time**, never `confirmedAt`
  — the latter is when this app worked it out, can be days later, and matches no
  source a reader could check. Same choice `endedNote` makes, so the row and the
  detail badge cannot disagree. A missing or unreadable stamp still gets the
  bare word rather than a fabricated time.
- **No home means no distance**, and line 2 shows the storm's position instead.
  The row's shape must not depend on the reader's configuration.
- **Basin groups are ordered by their nearest storm** once a home exists, so the
  closest storm on the planet is the top row of the top group. Without a home
  there is no nearest and canonical basin order is the fallback.
- **Ended storms are their own group at the bottom, outside basin grouping,**
  under a rule. They used to sink only within their basin, so a finished
  Atlantic storm outranked every live storm in the Pacific and could be the sole
  reason a basin header existed. Silent storms deliberately do NOT get this
  treatment — a silent storm may still be out there, which is why it is not
  dropped; it sinks within its basin and keeps its place in the world.
- **Headers only when more than one group is present.** A lone header over a
  two-row list is noise.
- **Do not re-sort while the panel is open.** A poll can flip two storms' ranking
  and move a row out from under a thumb mid-tap. Sort on open and on reopen —
  never on poll. A poll that only changed numbers patches all three lines in
  place; line 3 in particular appears and vanishes between polls, so a patcher
  that only rewrote the metadata would leave it permanently missing on every row
  drawn before its geometry landed.
- **No virtual scrolling.** Peak worldwide is ~15 storms; rendering rows directly
  is simpler and faster than any windowing library.
- **Basin headers are real `<h2>`s**, so screen-reader users can jump by heading
  instead of arrowing through every row. Headers are not focusable; Tab hits rows
  only.

**THE RANKING KEY IS ONE QUANTITY.** Where there is no distance to sort on, the
list falls back to intensity — and that fallback used to be
`windKt ?? peakWindKt`, which compared an unmatched storm's whole-life maximum
against every other storm's present. Dolphin publishes a 269 km/h peak, about
145 kt, which put a storm with no measurement behind it above a measured Cat 4.
It is `representativeKt` now — the middle of the class the source actually
stated, the tool already built for exactly this and documented as never being
displayed. A measured wind always wins; the stand-in is only reached when there
is none. It also answers for GDACS's bare "HU", which has no category index and
would otherwise sort below a tropical depression. `data/merge.js` and
`ui/view-storms.js` state the rule separately, because they are two different
sorts that happen to agree on this one point.

**GDACS's "HU" is a rung, not a gap.** Its strongest published wind band is the
Cat 1 floor, so a marginal Cat 1 and a 160 kt super typhoon publish an identical
band set. The badge says `HU` and the swatch wears `HURRICANE_UNKNOWN_COLOR`,
deliberately off the Saffir-Simpson ramp. There is no way to invent the number.

**There is no scope filter, and nothing can hide a storm that exists.** Home
sorts the list nearest-first and puts a distance on every row; that is the
personalisation. So the storm list has **three** empty states, per §5 —
`none_matched` has no producer here, though it remains live elsewhere (geocode
search with no matches):

- `loading` → "Checking the oceans…"
- `clear` → "No active storms. All feeds reporting clean." Only when every source
  returned clean AND there are zero storms.
- `unavailable` → never an empty list. Partial: show what we have plus "GDACS is
  not responding — storms outside the Atlantic and eastern Pacific may be
  missing." Total: error state with Retry.

**THE BASINS IN THOSE NOTES ARE THE MERGE'S, NOT A ROUGH GESTURE AT A REGION.**
An outage note naming a narrower area than the outage covers is a false
all-clear about everywhere it left out. `data/merge.js` drops GDACS storms only
inside `NHC_BASINS`, so GDACS owns the other five entries in `BASIN_ORDER` —
Northwest Pacific, North Indian, Southwest Indian, Australian Region, South
Pacific — and the note says that boundary rather than listing five names, so
reassigning a basin cannot make it stale. NHC's note names Atlantic, East
Pacific **and Central Pacific**; CPHC storms arrive through the same feed under
`cp` ids. Corrected 2026-08-20: the old pair named two GDACS basins out of five
and omitted CPHC entirely. The strip (`ui/status.js`) and the list
(`ui/view-storms.js`) carry the same sentence and are corrected together.

A WebGL canvas is invisible to assistive technology. The storm list is not a
hidden duplicate — those rot because nobody looks at them. It is one visible list
that is simultaneously the click target, the Tab order, and the screen-reader
view of the globe. **The canvas is `aria-hidden`; the list is authoritative.**

#### 16.5 The storm stepper, and the header both drawers share

**The home dashboard and the storm detail panel are one design.** Both title
themselves with the storm — swatch, name, and a second line underneath (the
classification on the detail panel, the proximity chip on the dashboard) — in
the SAME identity block, handed to the drawer as the view's title. Both pin the
SAME stepper directly beneath the header: a tight centred cluster, `‹ 2 of 7 ›`,
built by `ui/storm-stepper.js`.

**The stepper is one component because two copies had already drifted.** They
had different markup, different wrap arithmetic, and only one of them handled
keyboard focus. §12's rule — any pattern used twice gets extracted before the
second use — was overdue.

**It walks the storm list's order, which the list exposes as `orderedStorms()`.**
Nothing else sorts, so "3 of 7" cannot mean one thing in the list and another in
a panel. It wraps, so neither arrow is ever disabled: a chevron present but dead
is a control you have to look at to rule out. Below two storms it hides
entirely, and a storm that has left the feed has no position in the list, so it
gets no stepper either — stepping "next" from a storm that no longer exists has
no defined meaning.

**Tight and centred is a safety fix, not a style choice.** The arrows first
shipped pinned to the panel's two outer edges. That put prev directly below the
drawer's Back chevron and next directly below Close — same glyph, same size,
same color, one row apart — and the consequence of missing is not symmetrical:
press prev instead of Back and you step a storm; press Close instead of next and
you lose the panel. Measured on the edge-pinned layout, Back to prev was 53px
apart with 18px of horizontal separation. Clustered, it is 107px and 95px.
`tools/drawer-head-check.mjs` holds both numbers against a floor of 88px, which
is two touch targets.

**The Back button carries its destination in words** — `‹ Storms`, `‹ Home`,
`‹ Hurricane Erin` — which is the other half of that fix and the only change
that stops the two left chevrons being twins. It also answers a question the
icon never could: the detail panel is reachable from both the storm list and the
dashboard, and side trips push on top of it, so where Back goes genuinely
varies. The destination was already computed for the `aria-label`; this puts it
on screen. A view whose title is a node supplies the string itself via
`backLabelFor` — see §16.

**The header is a three-column grid whose outer columns take equal shares**
(`minmax(0,1fr) auto minmax(0,1fr)`), which is what makes the middle column land
on the true centre regardless of how wide the lead slot's text is. "Back to
Storms" and "Home" are very different widths and neither may shift the name. A
long storm name truncates rather than shoving the title off-centre.

**The word "Home" moved to a small muted eyebrow in the lead slot**, shown only
while that view is a root. A drawer whose header names a storm and says nothing
else reads as the detail panel; two things at title weight in one bar is two
titles arguing. Pushed onto anything, the back button takes the slot — a view
that was pushed already says where it is.

**The dashboard's name is smaller than it was, and that is the accepted trade.**
It was 1.35rem in the body, the largest type on the screen. Header type is
smaller, and sizing it back up would grow the pinned header on the panel with
the least room to spare. The name is not the answer to "is this coming for me" —
the distance is, and that is still the biggest figure below.

**The header's padding is asymmetric, and the second line is a fixed height.**
The top edge is the sheet's rounded corner and the phone's own glass; the bottom
edge is the stepper, which brings its own touch target of breathing space. More
important, the header centres its columns vertically, so the identity block's
height decides where the name sits — and the dashboard's second line used to be
a pill with padding and a border while the detail panel's was plain text. Equal
header padding still put the name several pixels higher on the dashboard.
Pinning the second line to the taller of the two makes the block a constant
height and the name's inset identical on both drawers.

**Both second lines are the same chip as of 2026-08-20, and that was settled in
two steps worth recording because the second reversed the first.** The dashboard
put its stage word (`Hours away`, `Track unknown`, `Checking…`) in a bordered
chip in the slot where the detail panel put bare text, so stepping between the
two showed one header shape wearing two different objects. The chip was dropped
first, to match the detail panel. On glass Aaron preferred the chip — so the
DETAIL PANEL wears one too, and the dashboard's is back. Either way the words
were never in question: `STAGE_CHIP` here and `natureLine` there both decide
exactly what they decided before.

**The chip is `.drawer-chip` in `ui/panels.css`, not `.home-chip` in
`ui/home.css`.** Three surfaces render it — the dashboard's stage word, the
detail panel's classification, and the quiet state's "All clear" — and a
component named for one drawer being rendered by two is how a pattern drifts
into three slightly different pills. §12's rule is that a pattern used twice is
extracted before the second use.

**The per-rung `calm` tone did not come back with the box.** Each stage rung
used to paint itself muted or secondary. The detail panel's chip states a
classification and has no ladder to recolour against, so a stage chip shifting
colour beside one that never does puts the two drawers back out of step — the
exact thing being fixed. `data-tone="calm"` survives for the quiet state's "All
clear", which is a different surface and genuinely is quieter. Nothing is lost
that the screen does not say louder elsewhere: the category dot sits directly
above those words in the storm's own Saffir-Simpson ink.

**The dashboard's identity is a `<button>` and the detail panel's is a `<div>`,
and the harness used to make both buttons.** The dashboard's title is the only
route into the storm's own panel, so it is tappable; the detail panel's has
nowhere to go. `panels.css` scopes the reset, the hover underline and the focus
ring to `button.drawer-identity`, so a fixture rendering both as buttons was
styling the detail panel with the dashboard's rules and calling the result a
comparison. Found 2026-08-20 by a deliberate break that could not fire: with no
element-type difference in the fixture, no drawer-scoped override was
expressible, so the assertion written to catch one could not have. **A break
that fails to break is a finding about the fixture.**

**`tools/drawer-head-check.mjs` asserts the two chips are one component**, by
comparing computed font, padding, radius, border and colour across the drawers —
because every other assertion in that check would pass with two chips that were
perfectly centred and completely different. `--identity-sub-h` is kept at the
chip's height; `--drawer-head-h` is computed from it and five other headers
match that figure, so shortening it is a whole-chrome pass, not a tweak.

**The dot and the name are centred together, and the pair is what lands on the
panel's axis.** The dot is the storm's category, not an ornament beside the
name, and a reader takes the two as one object — so the pair sits on the
header's centre, the second line sits there too, and the stepper below and every
section heading further down share it. The cost, which is inherent rather than
accidental: the NAME's own letters sit half a dot-and-gap right of that axis,
because the dot occupies the left. Two other arrangements were built and
rejected on glass 2026-08-12 — padding the second line to chase the name (which
aligned the two lines to each other and left both 10px off everything else), and
shifting the first line so the name's letters land on the axis (whose numbers
were perfect and which left the dot hanging outside the centred group, reading
as the title sliding left).

**The identity block owns its dot.** The detail panel used to borrow
`.row-swatch` from the storm list and inherited two of that component's
corrections with it. `.row-swatch` composes its glow from `var(--swatch)`, which
every storm-row caller sets and the identity block did not — it passed the color
as a plain inline `background`, so the glow's `var()` resolved to nothing, the
whole `box-shadow` declaration became invalid, and it computed to `none`. The
dot was a flat disc on a panel where every other dot is a light (§6), and an
invalid `var()` is silent, so nothing reported it. `.row-swatch` also carries
`margin-top: 5px` to pin itself to the name's line inside the list row's
multi-line stack; in a vertically-centred header that landed as a 2.5px drop.
`.drawer-identity-dot` is declared beside the block it belongs to, takes its
color as `--dot-ink`, and both views render it.
`tools/drawer-head-check.mjs` asserts a live glow with real ink in it on both
drawers, so a caller that forgets to pass the color fails loudly instead of
shipping a flat disc.

**==> THE SAME CONSTRUCTION WAS IN TWO MORE PLACES, AND THAT IS WHY THE RULE IS
NOW A GATE RATHER THAN A NOTE. <==** The watch/warning legend and the wind-field
legend in `ui/view-storm-detail.js` were built the same way — colour as an inline
`background`, so the same dead glow, plus the full 5px drop rather than the
header's 2.5px, because `.detail-ww li` centres a single line. Both now pass
`--swatch`, and `.detail-ww .row-swatch` cancels the margin. **The cancel is
deliberate where the header's separate dot was deliberate**: unlike the header,
this IS the same dot doing the same job, and only the surrounding stack differs.

`tools/test-swatch-contract.mjs` is the gate. It is static rather than a browser
check, because the bug has no runtime symptom to observe — an inline `background`
is perfectly valid CSS referencing no variable at all, so `test-css-vars.mjs`
cannot see it either. The failure IS the absence of a name, so the rule is stated
positively: an element carrying a glow class is handed a custom property, never a
`background`. Adding a fourth glowing dot means adding its class to
`GLOW_CLASSES`, which is the point.

**A chip does not carry another row's layout.** The chip is pushed to the right
end of the quiet state's threat row, and that push belongs to the row —
`.home-threat .drawer-chip` — not to the chip. As a bare `margin-left: auto` on
the chip itself it followed the chip into the centred identity block and threw
it to the far right of the name; measured at 260px of used margin behind a long
storm name. Cancelling it from `panels.css` did not work and could not: same
specificity as the chip's own rule, in the stylesheet `index.html` loads first,
so source order decided it and the override applied to nothing. The rule that
works is a DESCENDANT selector, which wins on specificity rather than on which
file happens to load first — so it can stay in `home.css` beside the row it
belongs to even though the chip itself now lives in `panels.css`.

**Measure the ink, never the box that contains it.** Three assertions in this
header's check have now read 0.0px while the pixels were visibly wrong, each
because they compared two full-width boxes whose centres are equal by
construction rather than the content inside them. The centring assertions
measure the dot's left edge to the name's right edge, and a `Range` around the
second line's contents — never `.drawer-identity-line` or
`.drawer-identity-sub` themselves. One `Range` probe covers both drawers, since
both second lines now hold the same chip.

**The fixture's design tokens are the app's, and a check holds them there.**
Every number in `tools/drawer-head-check.mjs` is a distance expressed in the
spacing tokens, so a token that drifts between `tools/drawer-head-harness.html`
and `index.html` turns the file into a precise measurement of a different app
that still passes — thresholds absorb a few pixels. The fixture ran two commits
on 6/10/14/20 spacing against the app's 4/8/12/16, and every offset it reported
was about a quarter too large. The check now parses both `:root` blocks and
fails on any disagreement; fixture-only tokens (zeroed animation, zeroed safe
areas, the opaque sheet fill it needs with no globe behind it) are listed as
exempt rather than skipped.

**The dashboard is a fixed height, not a content height.** Every other view in
the sheet is longer than 60vh and therefore always exactly that; the dashboard
is not, because the near layout carries a chart and a countdown the far layout
drops. Stepping between a storm bearing down and one mid-ocean resized the sheet
under the reader's thumb. It also steadies the camera: the flyTo offset is
measured from this height, so a variable sheet meant the same storm framed the
same way landed differently depending on which storm you stepped from. The rule
is scoped to this one view — forcing a short view to 60vh would be a lot of
empty glass under three lines of text.

**The dashboard's title is a button.** It is the only route from the dashboard
into the storm's own panel. A tappable header title is unusual and will mostly
be found by trying it; that cost is accepted rather than overlooked, and it is
why the hover underline and the focus ring exist.

**Stepping moves the camera on both surfaces.** The detail panel's chevrons call
the same selection a list row does (`runSelect`): the drawer re-enters itself
with the new storm, the geometry loads, the camera flies. The dashboard's call
`runFocus` — the identical sequence **minus the drawer push**, because the
reader is on the one screen about one storm against one house and a chevron must
not throw them off it.

**The flight is measured after the render, never before.** The camera offset
comes from the drawer's real height so the storm lands in the visible strip
above the sheet; the dashboard's height changes with its own content, because
the far layout drops the chart and the countdown.

**The chevron buttons are built once and never replaced**, and the stepper's
`takeFocus()` returns the one just pressed, once. Stepping re-enters the view
and the drawer moves focus immediately afterwards; a freshly built button would
dump keyboard focus on Back on every press, so walking seven storms would mean
seven trips through the tab order and the wrong press would throw the reader out
of the panel. The count and both `aria-label`s are written synchronously on
entry, ahead of the coalesced body render.

**Both steppers are built at mount, not at construction.** They create DOM, and
the views are constructed in `app/views.js` long before anything opens them —
and with no DOM at all by the two headless suites that drive the dashboard's
render paths. Lazy is the drawer's own rule for views anyway.

**The desktop rail grows with the window: `clamp(340px, 36vw, 440px)`.** It was
a flat 340px. The home chart is an SVG with a fixed 320-unit viewBox scaled to
the body's width, so the rendered size of its text is a function of the rail's
width — at 340px its 8-unit labels land at 8.1 CSS px, against 9.3px on a 390px
phone and 10.3px on a 430px one. The desktop was the smallest the chart ever
got, on the screen viewed from the greatest distance. **Widening the container
rather than the text is deliberate:** the chart's geometry is hand-tuned around
those font sizes (baselines at `y + 3`, axis labels rotated −38° to clear each
other, y-axis text anchored `end` at `PAD_L - 4`), so raising the font size
alone moves text relative to a layout measured for it and the rotated date
labels are the first thing to collide. Scaling the container moves every
relationship together. The floor keeps a 720px window from losing most of itself
to the rail. Measured: 720px leaves the rail at 340 and the labels at 8.1px,
1024px gives 369/8.8px, and 1280px and up sit at the 440px ceiling and 10.6px —
a large phone's size, on a screen at arm's length. `36vw` rather than `30`
because at 30 a 1024px laptop still clamped to the floor and got nothing.

**The header is one fixed height across all five drawers.** `--drawer-head-h`
in `index.html` is derived from the tall case — the identity block's second
line plus one title line plus the header's own asymmetric padding — and applied
as a `min-height`. The three columns centre inside it, so the close X, the back
button and the title land on the same line whichever drawer is open. It is a
floor rather than a fixed height, so a long name wrapping at a narrow width
still gets the room instead of being clipped. Without it the header was as tall
as whatever title it happened to hold, and flipping between drawers slid the X
and every heading below it by a few pixels.

**Every drawer starts its text at `--drawer-inset`.** The scroller pads itself
by the smaller `--drawer-body-pad`, because a storm row is a full-bleed press
target and wants to run wider than the text inside it; each inner block makes
up the difference with `calc(var(--drawer-inset) - var(--drawer-body-pad))`
rather than restating a literal. Rows carry the same inset as the heading above
them. The storm detail panel takes the inset at full value on its sections
instead, because `.detail-body` has no side padding — its dividers are
full-bleed hairlines and inset rules would read as a stack of cards.

**One type scale, seven steps, and `tools/type-scale-check.mjs` enforces it.**
`--type-hero`, `--type-xl`, `--type-title`, `--type-lead`, `--type-body`,
`--type-small` and `--type-micro` are declared in `index.html` and are the only
sizes any rule in `ui/` may use. Three raw values are exempt and named in the
check: the heading arrow (sized in `em` against its own line), the home search
input (a 16px floor, below which iOS zooms the page on focus), and the
countdown rail's lead (the small step indirected through a local name so the
rail can multiply it by a line height). The check also holds the scale AT seven
— a scale that grows a step per component is the old sprawl with `var()`
wrapped round it.

**One text system, six roles, every drawer.** A piece of text in a drawer is one
of these or it is a bug. The roles are grouped selectors at the head of
`ui/panels.css` and `tools/text-role-check.mjs` holds every listed selector to
its role after the whole cascade has resolved.

| Role | Size | Colour | What it is |
|---|---|---|---|
| 1 Section heading | `--type-body`, 700, caps, `0.06em` | `--text-primary` | Names a whole section. "WATCHES AND WARNINGS" |
| 2 Sub-label | `--type-micro`, 700, caps, `0.09em` | `--text-secondary` | Labels one figure inside a section. "DISTANCE" |
| 3 Headline figure | `--type-xl` or `--type-hero` | `--text-primary` | The one number a section exists to state. At most ONE per section |
| 4 Value | `--type-body`, numeric face when numeric | `--text-primary` | An answer in a row. "86 mph" |
| 5 Body | `--type-body` | `--text-secondary` | Any sentence |
| 6 Footnote | `--type-small` | `--text-muted` | Provenance, caveats, timestamps, the disclaimer |

**It replaced eighteen distinct size-and-colour pairings, and the contrast ran
backwards.** Headings were `--text-muted` and prose beneath them was
`--text-primary`, so on every panel the least important line was the brightest
and the thing naming it was the faintest. Two measured cases: the People section
set the sentence stating its figure MUTED and the caveat under it SECONDARY, so
the caveat outshone what it qualified; and `.settings-label` was 600 weight,
sentence case and primary, making Settings the one drawer whose headings did not
look like headings — while being, ironically, the one already coloured the way
all of them should be. Aaron on glass 2026-08-20. Nine pairings remain: the six
roles plus the three excluded groups below.

**Role 4 is `--type-body` and not `--type-lead`, and that is the interesting
one.** A value used to be a step larger than the prose around it, which across a
panel produced a saw-tooth — 15px, 14px, 15px, 12.5px, 15px. At one size the
panel sits on one baseline rhythm and a value is told apart by being WHITE and,
where it is a number, by the tabular face. **Size is spent on roles 1 and 3
only.**

**Role 1 is still `--type-body` rather than a step up.** Capitals are taller than
lowercase at the same size, so all-caps white at the body step already leads the
sentence beneath it; bigger AND white at once is where a heading shouts. Its
tracking is `0.06em` against role 2's `0.09em` — tracking on all-caps exists to
keep small capitals from colliding, and the same figure at a larger size is a
visible gap between every pair of letters.

**Three things are deliberately outside the table.** TONE COLOURS — `--error`,
`--stale`, category and watch/warning ink — are semantic state (§6); a rule may
paint one on top of a role but may not invent a neutral. DRAWER CHROME (title,
back button, eyebrow, storm pill, stepper) and LIST ROWS (`.storm-row`,
`.watch-row` and their parts) are settled components with their own internal
hierarchy, and neither was what read as disjointed.

**Selectors from `home.css` appear in the grouped lists on purpose.**
`index.html` loads `panels.css` first, so anything `home.css` declares for the
same property still wins; those rules therefore carry only their own layout —
margins, grid placement — and nothing about type.

**Every role-1 heading carries an icon, and the shapes are in
`ui/section-icon.js`.** Beside the label, never instead of it — the icons buy
SCANNING rather than reading, and a heading nobody can read is a section nobody
can skip past. Each is stroke-only in a 24 box, `currentColor` so a heading and
its icon cannot drift apart, `aria-hidden` because the words beside them are
already the accessible name, and sized by `.sect-ico` in CSS rather than by a
width attribute so one rule retunes every icon in the app. **One idea, one
shape, both drawers**: the storm panel's Wind field takes Home's How strong
glyph and its Rainfall takes Home's Rain cloud, and the storm panel's Home
section takes Home's crosshair rather than a house, because both of those
sections are about the RANGE to the house rather than the house itself.

The collapsible headings in the storm detail panel take the role-1 recipe
unchanged and say they are pressable with a chevron, a full-width 44px target
and a hover, not with extra type weight. Their icon is passed in at the call
site rather than looked up from the section id: a map from id to icon is a
second list of the panel's sections that a new section can be added to only half
of, and the failure mode is a section that silently renders without an icon.

### Storm detail panel

Replaces the list in the same slot, back button top-left.

**The panel scrolls; identity and timestamp pin to the top.** At 60% height on a
phone this content overflows, and you must never lose track of which storm and
how old while reading. **Sections collapse per user, persisted** (localStorage,
same as layer prefs) — someone who never reads coordinates should not scroll past
them forever.

**One full render per turn, not one per caller.** Opening the panel calls
`renderAll` twice in the same task — once from `onEnter` when the drawer pushes
the view, again from `setGeometry({state:'loading'})` when main.js starts the
geometry fetch — and each rebuilds every section, every vitals row and every
formatted figure. Nothing paints between them, so the first result was always
thrown away. Renders are **coalesced onto a microtask**, not a frame: INP runs
until the next paint, so work moved into a `requestAnimationFrame` callback is
still counted. What helps is doing it once. The microtask still runs before
paint, so nothing on screen arrives later than it used to.

**1. Identity**
```
🌀 FIONA
Hurricane · Category 2
```
Category color is the swatch and glyph, never the text color (§6). For
non-tropical `nature`, the second line says what it actually is — "Post-Tropical
Cyclone," "Potential Tropical Cyclone Five."

**2. Vitals**
```
Winds      85 kt (100 mph)
Pressure   972 mb
Moving     NNW at 12 kt (14 mph)
Position   24.3°N 71.2°W
```
**Nulls are omitted, not zeroed.** GDACS often has no pressure; a missing row is
honest, "Pressure —" is clutter, "0 mb" is a lie.

**3. Timestamp — the load-bearing element**
```
Advisory 12A · 11:00 PM Thu (2 hrs ago)
```
Directly under the vitals, because everything above it is only as true as this
line. Three states: fresh (under ~4 h, quiet), aging (4–9 h, highlighted), stale
(past the 9 h TTL, flagged — "⚠ Last update 11 hrs ago").

**Geometry timestamp is separate.** When MapServer lags the storm feed by more
than one advisory cycle (§4), a second line appears: *"Cone and tracks from
advisory 12 · 5 hrs ago."* When they agree, the line does not exist — silence
means synchronized. This is a "name every soft-fail" case where the fail is
invisible unless stated.

**4. Home block** — only when home is set.
```
DISTANCE
310 nm (357 mi) NNE of home

CLOSEST APPROACH
95 nm · 3:00 AM Thu (in 14 hrs)

WINDS AT HOME
TS-force · 8:00 PM Wed (in 7 hrs)
```
One advisory feeds all of these, so the block carries a single header stamp
rather than three identical timestamps — but if anything in it is stale, that is
stated at block level, never buried. Closest approach is a *forecast track*
number and reads as the forecast it is. **Cone width does NOT fold into that
wording** (Aaron, 2026-08-18) — one number, one claim.

**5. Watch/warning block** — when in effect
```
IN EFFECT
■ Hurricane Warning
■ Tropical Storm Watch
```
§6 colors, deduped by type (§7). Never the word "advisory" for these. When none:
"None in effect." When the fetch failed: "Watches and warnings unavailable." Two
different strings, by design.

**A FOURTH STATE: IN FORCE, WITH NOTHING TO DRAW.** NHC can publish a
watch as attributes with no shape — measured on Lala advisory 5A, 2026-08-13,
where layer 8 returned one feature carrying `tcww: "HWA"` and a null geometry,
from a row whose own `idp_source` names the line shapefile. The relay asks for
geometry and does not simplify layer 8, so the loss is upstream of us.

Left unsaid this is the §5 failure with the worst consequence in the app: the
panel reads properties and says "Hurricane Watch", the map paints geometry and
draws an ordinary coast, and *a hurricane watch in force* and *no watch at all*
become pixel-identical. So the entry carries **not on the map** and the block
adds a line naming why, ending with the fact that matters — the order stands.
`wwLegend()` reports `drawn` per code, folded as an OR across every feature
carrying it, because one product arrives as several segments and a partly-drawn
warning must not be reported as missing. `tools/test-watchwarning.mjs` drives
the real body and both segment orders.

**6. What's drawn for this storm** — a SUMMARY plus a push into Layers.
**NO SWITCHES LIVE HERE.** Two controls for one layer means two places to look
when something is not drawing, and two places to keep in sync. There is exactly
ONE toggle per layer and it is in the Layers view. This section names what is
currently drawn for the selected storm; the way in is the floating Layers
button, which is the ONLY door (the shortcut that used to live here was deleted
on 2026-07-25 for the same one-door reason). The navigation is what makes that
cheap rather than annoying — Layers is a side trip, so pressing it from a storm
pushes rather than starting fresh, and Back lands on that storm's detail, not on
the list. The rule and its table are in §16.

**Environment** — the storm health paragraph, between the wind field and
People in the path. The whole contract — the seven verdict shapes, the named
terms and their closing remainder, room and structure, the bottom line, the
four replaced absences — is §47.8; this list only places it. It is its own
gate (fetches the selected storm's run on open, layer on or off), shows the
same withheld note as every section on a silent or ended storm, and its only
control is the Retry on a failed fetch.

**7. Advisory text** — collapsed by default, expands in place. Never
auto-expanded; it would push everything above it off screen.

**THE RAW PRODUCT, WHOLE**, not a parsed version. A parser that hides a section
is a parser that can hide the WRONG section, and during a hurricane the cost of
four redundant lines is nothing against the cost of silently swallowing one the
reader needed. It soft-wraps rather than scrolling sideways — the products are
fixed at 69 columns, which does not fit a phone, and a horizontal scroll region
inside a vertically scrolling drawer is a gesture fight on a touchscreen and a
trap for a keyboard user. The block is `tabindex="0"` with a visible focus ring
so arrow keys can scroll it.

**Expanding is what fetches it.** The collapsed section IS the gate — §7's
"fetching layers fetch only while switched on", applied to a reading surface, and
strictly better than a layer toggle because it is per storm and on demand rather
than global. The record caches per (storm, advisory), so collapsing and
re-opening costs nothing and a new advisory self-invalidates.

**FOUR STATES, and the distinctions are the point** (§5):

| state | means | offers retry |
|---|---|---|
| `ok` | the words are here | — |
| `none_matched` | nobody is warning on this storm by that name | no |
| `unsupported` | this storm cannot have advisory text at all | no |
| `unavailable` | we tried and could not get it | **yes** |

Collapsing `none_matched` into `unavailable` puts a Retry button under a storm
that will never have text; collapsing `unavailable` into `none_matched` tells a
reader during a hurricane that no advisory exists when one does. Both are the
same §5 bug in opposite directions. **A degraded JTWC index reads as
`unavailable`, never as `none_matched`** — if five warnings are listed and only
four could be read, a name missing from the four is not evidence of anything.

The section names which agency wrote what you are reading. A reader in the
Philippines looking at a US Navy bulletin should know that is what it is.

**Reduced panels:**
- **Ghost storms:** identity, last-known vitals, the ghost notice, past track. No
  home block — distance to a storm that is not there is meaningless. No layer
  link either; there is nothing to configure for a storm that has stopped
  publishing.

**Failure states:**
- Storm in feed, geometry failed → panel renders fully from feed data; the map
  lacks the cone; the failure is named on the layer, not here.
- Selected storm's source goes down → panel holds with stale flag. Never blanks.
- Storm leaves the feed while open → becomes the ghost panel in place. No forced
  navigation.

### People in the path

A section in the storm drawer, under Wind field: how many people live inside
this storm's tropical-storm-force wind swath.

**The swath, not the cone, and that is the point of the section.** The cone is
where the CENTRE is likely to go. A headcount inside it would produce a number
that sounds like an impact figure and is not one, and would teach the single
commonest misreading of a hurricane forecast to everyone who saw it. Both NHC
and GDACS publish swaths, so this works in every basin. Only the 34 kt ring is
counted — the swath nests three thresholds by construction, so counting every
feature would count the core three times.

**The number is an undercount and the section says so.** It counts residents of
named towns of 1,000+ (SPEC-DATA.md §4.15), shown with a "≈", the word
*estimate*, and the floor in plain English. Rounded to two significant figures:
the third is fiction and the seventh is an insult.

Four states, per §5: a figure, "no wind field published for this advisory",
"population estimate unavailable" with a retry, and a **measured zero** — a
storm in the open Atlantic genuinely has nobody in its path, and that gets its
own sentence rather than reading as a failure.

The figure itself is split into what is still coming and what has already
happened; that is §54, and the heading follows the split.

> **OPEN:** the copy says "estimate" but not that the undercount varies by
> country. A Bay of Bengal figure is off by roughly four times in a way a Gulf
> figure is not, and nothing on screen says so.

---

## 54. People in the path — still coming, or already been through

*The count itself is "People in the path" above; the shape it counts is §4's
full-track envelope. `config/constants.js` `POPULATION.aheadSlot`,
`data/nhc-mapserver.js`, `lib/population-count.js` `peopleInPhases`,
`ui/view-storm-detail.js`, `tools/test-population.mjs`.*

**The swath is the storm's whole life and nothing inside it says where the past
ends.** `buildFullTrack` sweeps the past track, the current wind field and the
forecast into one polygon per threshold. That is the right shape to draw and
the wrong shape to caption — counted whole under a heading reading *in the
path*, it warns about wind that has already fallen.

**Confirmed on glass 2026-08-21.** Shipped, checked on a phone, and correct.

**Measured, on glass, 2026-08-21.** Hurricane Lala, advisory 34A, sat 900 miles
west-northwest of Hawaii heading north into empty ocean. The section read
**≈1.3M people in 121 towns**. Rebuilt from the archived bytes: 1,337,723 people
in 121 towns, every town in Hawaii, every one of them behind the storm by days
— and **zero people, in zero towns, anywhere ahead of it**. The panel was a
future-tense warning about something entirely finished.

### The forward-only envelope

`data/nhc-mapserver.js` runs the same sweep a second time with the past tier
withheld, into a slot named `windAhead`. Nothing draws it. It exists so the
headcount can make a narrower claim than the drawn shape supports.

**Cost is not the reason to hesitate.** The past tier is 71 of Lala's ~90 input
rings, so the forward sweep is 0.70 ms against 14.75 ms for the full one, and
the split count is 1.65 ms against 1.46 ms for the single count — the forward
shape's bounding box rejects nearly every town before any ray cast. Measured in
the sandbox on node, not on a phone.

**`ok` is the only status that unlocks the split.** `none` and `unavailable`
both mean the forward shape could not be built, and reading either as "nobody
ahead" would put an all-clear on screen that no data supports — the worst
failure this app has (SPEC.md §6). Without it the section counts the whole
envelope in the words it always used: wrong in the same small way as before,
rather than newly wrong in a large one.

### Three shapes of sentence

The heading is **Population affected** in all three. Only the body changes.

| What is true | Body |
|---|---|
| People ahead, none behind | *≈N people in M towns are inside the tropical-storm-force wind field or ahead of it.* |
| Both | The ahead figure leads; one line beneath: *Another ≈N in M towns have already been through it.* |
| Nobody ahead, people behind | *≈N people in M towns have already been through the tropical-storm-force wind field. Nobody is ahead of the storm now.* |

**The one that can still be acted on leads, and the past gets a line rather than
a second figure.** Two big numbers stacked at phone width is two things to
compare and nothing saying which matters — the same call §49.2 makes for the
home drawer's mid-pass case.

**THE HEADING IS FIXED, AND THE FIRST CUT OF THIS SECTION GOT THAT WRONG.** It
swapped to *People it went through* whenever nobody was ahead, reasoning that
*in the path* over a past-tense paragraph is the same false claim in smaller
type. The claim was right and the remedy was not. Aaron's call, 2026-08-21:
*went through* reads as though the storm walked through the people, and a
section that renames itself is harder to find when scanning the drawer — open
the same storm twice and the heading has moved.

*Population affected* is true in every state, so the heading never lies and
never moves. **The body carries the tense**, which is where a tense belongs: a
sentence can say *have already been through* without a two-word heading trying
to. `title()` is a constant, and the section repaint touches the body only.

### Two rules that are load-bearing

**Each town is classified once against both shapes. Never `past = total −
ahead`.** The two envelopes come off the same sweep but are smoothed over
different runs, so the forward shape can sit a nautical mile or two outside the
full one near its far end. A town in that sliver is inside `ahead` and outside
`all`, and the subtraction hands back a **negative number of people**. Reverting
to it fails `tools/test-population.mjs` with `got -1000, want 0` — verified by
mutation, not assumed.

**`windAhead` is in `FUTURE_SLOTS`.** It is pure future by construction. A storm
whose agency has gone silent or issued its last bulletin has no "still ahead"
anybody is standing behind, and unlike the past track there is nothing in this
slot that survives clipping.

### NHC only, and that is correct rather than a gap

GDACS publishes no past wind field at all — `data/gdacs-geometry.js` sets
`windPast` to `none` — so its swath already begins at the current position and
is already entirely "ahead". Those storms carry no `windAhead` slot, take the
single-figure wording, and it means exactly what it always meant.

> **OPEN:** the split says *whether* the storm has passed, not *when*. The past
> track carries timestamps, so "it went through on Sunday" is available and not
> built. Deferred deliberately — the useful half is the tense, and a date adds a
> second thing to get wrong.

> **OPEN:** the MAP has the same problem the caption had. The drawn swath is a
> record where it is behind the storm and a forecast where it is ahead, in one
> undifferentiated shade. A green wash still sitting over Honolulu reads as a
> warning. Not touched here.

---

## 45.8 Genesis — the drawer section

*The source is §45.2–§45.5 in `SPEC-DATA.md`; the globe layer is §45.4 in
`SPEC-MAP.md`.*

A second section under the storm list, headed **Being watched** with a count.
One row per area, ordered by probability across both sources.

**THE WATCH ROW IS THE STORM ROW'S SHAPE, DELIBERATELY.** Identity and figures
down the left, classification and freshness down the right, so the eye compares
by position across both kinds of row instead of learning one layout for storms
and another for areas.

```
◪  South-Southwest of Mexico                    Low
   0% in 2 days · NHC                     2 hrs ago
   80% in 7 days
```

**The near horizon leads.** The row answers *is this imminent* before *is this
likely eventually*, so the two-day figure shares line one with the publish
stamp and the seven-day follows underneath — the same question the badge above
it answers. The seven-day figure is the one the globe draws, which is why it
sits on the line nearest the swatch that carries its colour.

**A figure is never separated from its own horizon.** `80% · in 7 days` split
one fact into two with a bullet between them. The middot survives only between
genuinely different facts: the figure and the source.

**The badge is the TWO-day rung, on both sources.** A storm's badge is what it
is right now; the near horizon is the closest thing a watched area has to that.
It deliberately does not match the swatch beside it — the dot carries the
seven-day risk, because the polygon on the globe is the seven-day area (§45.6)
— so a row may read `Low` next to an orange dot, and both marks are true about
different horizons. The subline names both horizons underneath for that reason.
A JTWC system has one horizon and one word, so its badge is that word and its
subline sheds it rather than saying it twice.

**Both percentages are always shown.** The near line used to be hidden below
1%, on the argument that a column of zeros trains the eye to skip the line that
matters. It cost more than it bought: rows changed height on a value, so the
reader could never learn where the two-day figure lives, and its absence
carried two meanings at once — a stated `0%` and a blank field looked
identical, which is the §45.5 conflation this feature exists to refuse. A
stated zero is NHC saying *not in this window*, which is exactly the
reassurance a watch list is scanned for. **A field NHC left blank reads `Not
stated`, never `0%`.**

**The stamp ages on the outlook's own cadence**, `GENESIS.staleAfter` at nine
hours, never on the storm freshness bands — those are built for three-hourly
advisories and would paint nearly every area amber nearly all the time, which
would make the colour mean nothing.

**THE SECTION IS PART OF THE `genesis` LAYER, NOT A LIST THAT SITS NEAR IT.**
Turning the layer off hides these rows as well as the patches on the globe, and
the check runs before every other branch — "the reader closed this surface"
outranks every reason the section might otherwise have for speaking, including
an outage. That is not the silence §5 forbids: it is a surface the reader
closed, and the Layers view is where they reopen it. The flip redraws
immediately rather than waiting for the next poll, because a toggle whose
effect arrives up to thirty minutes later is a toggle that does not work.

The headline pill stops counting hidden areas for the same reason. **`clear`
does not**, deliberately — whether anything is out there is a fact about the
ocean, not about a switch, so hiding the layer drops the app to "No active
storms" and can never promote it to an all-clear the reader did not earn.

**THE COUNT ANSWERS THE QUESTION ITS OWN WORDS ASK, NOT "HOW MANY CAN WE
DRAW".** Those are different numbers whenever NHC's outlook layer is being
contradicted by NHC's own prose: the text says how many areas exist, and only
the ones with polygons can become rows. Seen on glass 2026-08-11, the header
read `BEING WATCHED 1` directly above a note saying five areas were being
described. Both numbers were true and side by side they read as a bug, so the
count includes areas only the forecaster can see.

**THE NOTES SIT UNDER THE ROWS, NOT OVER THEM.** They are a *caption* on the
areas — "these are held", "this source is out" — and a caption above its subject
pushes the subject off the fold. Seen on glass 2026-08-11: a three-line amber
paragraph directly under the count meant the first watched area needed a scroll
to reach, so the section read as a wall of text rather than as a list with a
footnote. When there are no rows at all the notes are the only content and the
order is moot, so nothing is lost in the outage case.

**THE OUTAGE NOTE IS AMBER WHEN WE CAN SAY WHAT IS MISSING, RED WHEN WE
CANNOT.** `.list-error` means "something broke, look at this". A layer that
answered promptly with nothing, while its own forecaster is listing areas, is a
stopped clock — the same fact the held note carries, and it gets the same
`.list-held`. A source that did not answer at all, leaving nothing to say,
stays red.

```
BEING WATCHED  3

Eastern Pacific        80%  ·  in 7 days  ·  NHC
                       20%     in 2 days
Central Atlantic       40%  ·  in 7 days  ·  NHC
Invest 98W            High  ·  in 24 hours ·  JTWC
```

The heading is a plain `<h2>` with the count beside it, styled identically to
`.basin-head` — two headings in one scroller that differ by a pixel look like a
mistake. Nothing in it is focusable; Tab hits rows only (§16).

**The row grammar is the storm row's.** Swatch, name on its own line, figures
underneath, 44 px minimum, `.watch-row` sharing `.row-text` / `.row-name` /
`.row-meta` with `.storm-row` rather than redeclaring them. This list is half
of the app's accessibility surface (§16) and a second row shape on it is how
that surface rots.

**The swatch is a hatched square, never a round dot.** Same contract as the
globe: a filled circle means a storm of a known strength. The list and the map
teach the same lesson or neither does. No glow — a glow is what makes a storm
findable, and a maybe should not be findable in the same way.

**Each row names its own source and its own horizon**, so two scales in one
list can never be mistaken for one scale. NHC rows show the percentage and not
the risk word; JTWC rows show the word and no number, because JTWC published no
number.

**Ordering across two scales is written down rather than left to the
implementer**: sort by probability descending, with JTWC's HIGH / MEDIUM / LOW
slotted at 70 / 40 / 10 (`GENESIS.orderWeight`) **for ordering only**. Those
numbers never reach the screen — rendering one would present an invented
probability as though JTWC had published it. `tools/test-genesis.mjs` asserts
no UI file reads them.

**The two-day line appears only once it is above zero.** Most areas sit at "0%
in 2 days" for days, and a line of zeros on every row is noise that trains the
eye to skip the line that matters. Its *appearance* is the signal that
something has become imminent. Nothing is hidden: the area panel always shows
both horizons, including a genuine `0%` and a genuine "Not stated", which are
different facts.

**The section does not collapse and has no control that would let it.** It
shipped collapsing itself whenever storms were present; that was removed the
same day. The original reasoning was about space — five areas under six storms
is a long scroll on a phone — and this section is about safety. §45 exists
because an app showing storms is not thereby showing everything, so folding the
watch list away exactly when storms exist hides the answer at the moment the
app looks busiest and most complete. A count behind a chevron is not a list.
Removed rather than defaulted open: an affordance that exists gets used, and
one tap would turn the feature off permanently.

**Three states, never conflated** (§45.5): a source outage says which source is
down and never renders as "nothing is being watched"; `none_matched` reads
"Nothing being watched right now"; and the section renders nothing at all while
the first fetch is in flight rather than flashing a count of zero.

**Three input paths, none of them gesture-only.** Rows are `<button>`s in the
list, so Tab reaches them and Enter selects. Tap or click a patch on the globe
selects the same area. With no storms on screen the drawer's initial focus
falls through to the first watched row — a quiet ocean is exactly when this
section is the entire content of the drawer.

Selecting flies the camera with the **same `panelOffset()` a storm gets**, so
the area lands in the visible globe area rather than the centre of the
viewport — on a phone the drawer takes the bottom 60%, and a centred target
arrives behind the panel that just opened to describe it. It flies to
`GENESIS.flyToZoom`, wider than a storm's, because a development region is
8–22° across and storm zoom puts the camera inside the patch.

It does **not** go through `runSelect`. That path calls `pipeline.select` and
`pipeline.load`, which ask for a storm's cone, track and wind radii *by
advisory bin* — a watched area has no bin, because nothing has formed to advise
on, so the request cannot be satisfied and would mark a healthy layer
unavailable when it came back empty. `runSelectArea` does the four things that
do apply: interrupt the drift, mark the patch, push the panel, fly.

Selecting pushes the **area panel** (`ui/view-area-detail.js`), which is
deliberately small: a watched area has five facts and no geometry beyond the
patch already drawn. It states both horizons, the publisher's own issue time,
and — as provenance for a title the app computed rather than NHC published —
the centroid it was computed from, plus the basin the app files it under. It
carries no advisory, no track and no intensity chart, because the thing it
describes does not exist yet.

**The basin is stated ONCE, in the app's own vocabulary.** NHC's raw `basin`
word rode beside it until 2026-08-12. The two are identical for every Atlantic
area by construction, so the pair read as duplication; and where they differ
they differ in one direction only — NHC files the entire ocean as `Pacific`
where this app splits it at 140°W into East and Central Pacific, the boundary
CPHC works to. A vaguer word printed next to a sharper one only asks the reader
which to believe. `sourceBasin` is still carried on every area and is still
what the outlook arbiter groups by (§45.9); it is not a row on the panel.

Its rules live in `ui/panels.css` beside the storm panel's and borrow that
panel's language — the same kickers, hairline rules and numeric figures — so a
watched area and a storm read as neighbours. Two deliberate departures: the
title is **not** uppercase, because uppercase tracking reads as an official
designation and this name is the app's own; and the sections do not collapse,
because a chevron over three lines is furniture.

### Pill and empty-state wording

| Storms | Areas | Reads |
|---|---|---|
| any | any | `6 active storms` — areas never take the pill from a storm |
| 0 | 3 | `3 areas being watched` |
| 0 | 0, both sources answered | `All clear` |
| 0 | 0, a source is down | `Storm data unavailable` |

The pill reads the **counts**, never `overallStatus` — which returns `ok` for
both "six hurricanes" and "no storms, three watched areas". Reusing that word
was worth more than a fourth status word precisely because nothing ambiguous
reaches the screen.

The drawer's own all-clear is *"No active storms, and nothing being watched.
All feeds reporting clean."* — the first time the app has been able to say that
plainly.

### 47.9 The layers row

```
Environment
Colors the cone by what the air around the storm adds to or takes off its
strength, from NHC's SHIPS model.
```

Label and `note` in `config/layers.js`, using the standing-caveat mechanism
every layer row already carries.

The note is not decoration. "Environment" alone does not say what the color
means, and this is the only layer in the app whose color encodes a signed
quantity rather than a category — every other colored thing on the globe is a
class of storm, a watch, or a wind band.

**IT USED TO SAY "whether the environment is helping or hurting the storm" AND
THAT WAS THE WRONG REGISTER** (Aaron, 2026-08-16). Helping and hurting are OUR
verbs for a number SHIPS published, and a row that sounds like a judgement
invites the reader to read the color as our opinion. Naming the model says out
loud that this layer reports rather than scores — §47's founding rule, in the
one sentence most readers of it will ever see.

**IT THEN SAID "net contribution to intensity" AND THAT WAS WRONG TWICE —
2026-08-22.** First, the file's own table is `INDIVIDUAL CONTRIBUTIONS TO
INTENSITY CHANGE`, and dropping the last word turns a change in wind speed into
a share of the wind speed. Second and worse, **it over-claimed the ocean.** The
colored sum is the ten ATMOSPHERIC rows: `SST POTENTIAL` is excluded on purpose
(§47.4) and the sea's own ceiling is not in the contribution table at all. To
anyone who is not a forecaster the ocean is obviously part of a storm's
environment, and measured on the 2026 corpus **34 runs end in the ramp's
brightest violet over water whose ceiling has collapsed 20 kt or more** — so a
reader taking the word at face value is being misled on one storm in ten.

*What the air around the storm adds to or takes off its strength* is the same
claim in words a person uses. It is literally what a contribution in knots IS
rather than a judgement about it, and it survives both signs read aloud —
§47.4's own test for a name. **Confirmed on glass, 2026-08-22:** naming the AIR
reads as precision rather than as a hint at some second layer, which was the
open risk in dropping the word *environment* from the line that defines the row
called Environment. **The layer keeps the NAME Environment** (§47.4's
one-thing-one-name rule); this is the line that defines it, and the water is
carried in words by §47.8's paragraph instead of being smuggled into the color.

**Default OFF, and grouped with the cone** — it modifies the cone rather than
adding a shape, so it belongs beside the thing it changes rather than in a
group of its own. Off also gates the warming: a SHIPS run is fetched per storm
once this is on, so leaving it off costs a first-time visitor nothing. Same
reasoning as model guidance, and the same shape in `main.js`.

**`fetches: true`, so the row can go amber and must be able to.** §47.6 splits
the absences and only one of them is a fault.

**THE PER-STORM ABSENCES REPLACE THE DESCRIPTION RATHER THAN APPENDING TO IT**,
so a storm with no data never shows a row promising something the map is not
drawing. `app/layer-status.js` `environmentRow` decides which, on the same
precedence the model-guidance row uses — a selected storm's own state beats any
count, and ENDED is checked before SILENT:

- Outside the Atlantic and East/Central Pacific: *Not published for storms in
  this basin.*
- Inside those basins, before the first run appears: *No intensity model run
  published for this storm yet.* **It said "No SHIPS run" until 2026-08-22**,
  while the drawer said "the intensity model" about the identical condition —
  one storm, two names for one thing, on two surfaces a tap apart. §47.8 is
  explicit that no replacement sentence says SHIPS at the reader: the name is
  real provenance and belongs on the credit line and in this row's standing
  note, which is where both now carry it.
- A run that exists and publishes no forecast position (§47.6's fourth case,
  6% of the season): *This run publishes no forecast track to color.*
- The relay failed: *Environment data unavailable — tap to retry.* The only one
  that offers a retry, because it is the only one a retry can fix.
- A silenced or ended storm: it has no cone to paint inside, so it has no
  ribbon, and the row says that rather than reporting on a run nothing is
  drawing.

**TWO OF THE SIX ABSENCES ARE NOT ABOUT SHIPS AT ALL**, and the row is
computed from the built ribbon as well as the fetch so it can name them. The
run behind both is healthy:

- Neither path could put stations on this cone — the rebuild declined AND the
  published outline could not be measured from the track either (§7.9's 60% hit
  floor, which means the track and the cone are not describing the same storm):
  *This cone could not be measured, so there is nothing to color.*
- The run's forecast hours reach no part of the cone, so every slice was
  trimmed: *This run does not reach any part of this cone.*

Neither is retryable — the next advisory is the recovery. Both rank BELOW every
fetch answer above: a typhoon has no ribs either, and saying its cone could not
be measured would be true and useless.

**A DECLINED REBUILD ON ITS OWN NO LONGER REACHES EITHER SENTENCE.** It did
until 2026-08-18, and it was the common case rather than the corner one — a
third of Ida's advisories. §7.9's measured path now supplies stations whenever
the rebuild refuses, so `no_ribs` has narrowed to the genuine both-paths-blind
answer it was always worded for.

`lib/cone-ribbon.js` has always named both in its `reason`, and
`app/bundle-pipeline.js` has always written that into the bundle slot. Until
2026-08-18 nothing read it, so the row was computed from the fetch alone, the
fetch was fine, and the ribbon appeared and disappeared between advisories with
nothing said anywhere — the §5 silence, reached through the one door that made
it look like a data fault. `createBundlePipeline` now records each storm's
outcome as it decorates (keyed by storm id, capped like every other cache) and
exposes `ribbonReasonFor`; `refreshEnvironment` passes it in.

Across the whole map, *drawing* means the ribbon BUILT, not that the fetch
succeeded — otherwise one healthy run silences the row for a screen on which
every cone refused. Where every storm shares one geometry absence the row says
so in the plural; a mixed screen falls back to the plain count, exactly as two
different fetch absences already do.

**Re-tapping an errored row is the retry**, as it is for every other row. Only
a cached `unavailable` is evicted — `basin` and `no_run` are resolved answers,
and dropping them would refetch on every tap to be told the same permanent fact.

**THE ROW CARRIES THE LEGEND TO ITS OWN COLOR (§47.11)**, expanded in place
while it is on. The note above says the color means "helping or hurting"; it
cannot say which end is which, and this is the only layer in the app where that
question exists. Declared as `legend: 'environment'` in `config/layers.js` so
`ui/view-layers.js` stays a generic renderer.


## 48.8 Rain — the home drawer's section

A section titled **Rain**, directly under `Where it is`. §48.5 places it after
that section and before the address block, which is a range rather than a slot;
this is the top of that range, for one reason: a Flash Flood Warning in force is
the most actionable thing on the screen, it renders at the head of this section,
and a warning at the bottom of a scroll is a warning nobody read.

It draws on the DASHBOARD PATH ONLY. The quiet, loading, error and no-home
states do not render it, so nothing fetches a forecast for a section nobody can
see. The section is its own gate — there is no warm loop and no poll.

In order:

1. **Any flood warning or watch in force**, each with its expiry **in the
   reader's own local clock** — never UTC, the same rule §47.8 follows, and it
   matters more here because these expire in minutes rather than days. An
   `Immediate` alert says *in force* in the sentence itself (the restyle
   removed the ink; the distinction survives in words — §56.7).
   When the alerts hop failed, the section says the warnings could not be
   checked rather than showing nothing (§48.7).
2. **The total, with its window** — *About 9 inches expected through early
   Thursday.* **What is still ahead, never the whole series — §48.19.**
3. **The heaviest block**, when one carries at least `RAIN.peakShare` of the
   total — *The heaviest six hours bring about 3 inches, from Sat 12:00 PM.*
   Hilo's peak six hours are 39% of the rain still to come, and "most of it in
   six hours" is the sentence that distinguishes a flood from a wet week. Below
   a quarter there is no heaviest block worth naming and the line is omitted.
4. **Where the number is from** — *At your house — National Weather Service,
   nearest point Hilo, HI.*

**THE WINDOW IS A CEILING AND THE LABEL IS NOT.** `RAIN.windowHours` is 120;
every series captured stops before that. The sentence names the end of the LAST
BLOCK ACTUALLY HELD, so a series that stops on Thursday says Thursday rather
than claiming five days. A label computed from the window instead is unmoved
when the series is cut short, which is the bug the suite mutates for.

**ROUNDING.** Whole inches above one, one decimal below, and metric gets whole
millimetres in both bands. Hilo's remaining series says 219.202 mm — 8.63
inches — and printing the tenth claims a precision no four-day rainfall
forecast has; the reader's decision does not turn on it. One millimetre in nine
inches is under half a percent, which nobody reads as a precision claim.

**NEGLIGIBLE RAIN IS WORDS.** Under `RAIN.negligibleMm` (2.5 mm, a tenth of an
inch, the bottom rung NWS itself uses) the section says *No meaningful rain
expected through Sunday* rather than printing a figure. Galveston measured
0.254 mm across thirty blocks and Key West 1.778; as `0.01 in` and `0.07 in`
both read as a malfunction rather than as a forecast.

**Outside coverage the section stays and names who does not forecast here**
(§48.5), and offers no Retry — a house outside NWS's area will never get a
different answer, and a button that cannot work is worse than none.

**Where there IS a Retry it takes `.home-retry`'s declaration, which is the one
Retry shape in `ui/home.css`** — a bordered box at `--touch-target` in primary
ink, matching `.retry` and `.detail-retry` in `ui/panels.css`. It sits in its
own element, never inline in the sentence: a 44px control set mid-paragraph
pushes its line apart and reads as a bad wrap. A pattern used twice gets
extracted (§12), and the point of extracting this one is that a fourth Retry
cannot quietly become something else — the rainfall Retry shipped as a bare
underlined link in `--accent` at `--touch-min`, two names declared nowhere, so
it had no colour and no minimum height, and it was missing from the file's
`:focus-visible` list as well. Three of §10's rules broken by a rule nothing
could see was broken. `tools/test-css-vars.mjs` now sweeps stylesheets, so an
undeclared name cannot be invisible again.

### 48.9 Rainfall — the storm drawer's section

A section titled **Rainfall**, between `Wind field` and `Environment`, holding
**one thing: what NHC says this storm will drop.** A range across an AREA, in
NHC's own paragraph, rewrapped, under a line saying so. The four states of
§48.2 and nothing else. **No number is extracted from it, so nothing here can
disagree with NHC.**

**==> IT HELD A SECOND BLOCK — A TOTAL AT THE READER'S HOUSE — AND §56.9 TOOK
IT OFF THIS PANEL. <==** A gridded point forecast is true for every cyclone on
the globe, because it is about a PLACE. Under one storm's name it was a true
number in a position claiming a connection nobody made. The house's rain is on
the screen with the house on it.

A GDACS storm's section is therefore answered without a fetch and in one
sentence: *Not published for storms in this basin.* — worded identically to
§47.6's Environment sentence on purpose, so a reader who meets both learns one
sentence rather than two. **That is once again the whole section outside NHC's
basins**, and the reader's own rainfall figure is one screen away rather than on
this one. A silenced or ended storm gets the panel's withheld note like every
other section.

**==> IT COSTS THE ADVISORY FETCH, AND THAT IS A REAL CHANGE. <==** §48.2's "no
new network" is true of the SOURCE and not of the TIMING. The Advisory section
is collapsed by default and fetches on expand, so a reader who never opened it
never paid; an open-by-default Rainfall section means one advisory page per NHC
storm opened — 30,712 bytes for Lala. It is cached per advisory key and shared
with the Advisory section, so opening that afterwards is free. That is the price
of §48.1's complaint, which is that rainfall currently sits where nobody opens it.

### 48.10 The two numbers that disagree, and why both are right

Lala's advisory says eastern Maui gets 8 to 12 inches. The grid at Kahului says
2.91. Both are correct: the advisory quotes the heaviest band across an area,
and Kahului sits off that axis. At Hilo the two agree — the advisory says 10 to
20 inches for the Big Island and the grid says 8.63 for the rain still to come
(11.14 counting what had already fallen — §48.19).

**==> THIS IS THE ONE REAL DESIGN RISK IN §48. <==** A reader whose home is on
Maui, looking at the home drawer's "about 3 inches" and then at the storm
drawer's "8 to 12 inches across eastern Maui", will conclude the app is broken.

**==> THE TWO FIGURES WERE PUT ON ONE SCREEN, AND §56.9 SEPARATED THEM AGAIN.
<==** For a month the house total sat directly under NHC's range in the storm
drawer, with a hairline between them and a line explaining why they differ.
That fix worked and it is retired anyway, because the block it depended on was
making a worse claim than the one it defused: a house figure under a storm's
name asserts a connection nobody measured (§56.9).

**WHAT DEFENDS AGAINST THE DISAGREEMENT NOW:**

- **each figure is on the screen whose question it answers.** The storm panel
  quotes NHC on an area; the home dashboard reports a grid point at an address.
  Neither screen carries the other's number, so there is no adjacent pair to
  read as a contradiction;
- **the home figure's closing line names the point** it is a forecast for
  (§48.12) — the one sentence on either surface that explains the gap;
- **the storm panel extracts nothing** from NHC's paragraph, so what it shows
  cannot drift from what NHC said.

**==> AND THIS IS STILL A RISK, NOT A SOLVED PROBLEM. <==** A reader on Maui can
still meet *8 to 12 inches* on one screen and *about 3 inches* on another and
conclude the app is broken; they now have to remember one of them to do it.
Whether the provenance line carries that weight alone is a glass call nobody has
made, because it needs a storm with an NHC rainfall paragraph over a home.

Whether that is enough is a glass question and it needs a storm near a home to
ask — **it is not settled.**


### 48.12 The provenance line, on both paths

The closing line of the Rain section names the SOURCE and the POINT, and it is
the only thing on either surface that explains §48.10's disagreement.

- **NWS** — "At your house — National Weather Service, nearest point Kahului,
  HI." A town, as NWS itself names it.
- **Open-Meteo** — "At your house — Open-Meteo, nearest model point 14.59,
  121.00." No town exists in that payload; the coordinate it snapped to does,
  and it is a poorer answer to the same question rather than none. **Naming
  Open-Meteo here is also the CC BY 4.0 attribution** (§48.14) — a credit in a
  code comment is not one, and a footer would put it where nobody reading the
  number looks.

**Two sentences for `alerts: null`, and they are opposites** (§48.16). From NWS:
"Flood warnings could not be checked just now" — a hiccup, and the section is
retryable. From Open-Meteo: "Flood warnings aren't published for this location —
this is a rainfall forecast only" — a durable fact, and inviting a reader to
retry it would be inviting them to wait for an answer that never comes.

**`not_covered` no longer explains NWS's coverage area.** It used to, because
NWS not forecasting here was the whole answer. Since §48.14 the global model
covers the planet, so reaching that state means both sources declined; the
sentence says so and still carries no Retry.

### 48.19 "Expected" means expected

**==> BOTH SOURCES SEND A SERIES THAT BEGINS BEFORE THE MOMENT IT IS READ, AND
NEITHER OF THEM SAYS SO. <==** The total was summed over every block in the
payload and labelled *About 11 inches expected through early Thursday*. Some of
that rain had already fallen.

- **Open-Meteo's `forecast_days` always starts at 00:00 UTC of the current
  day.** Measured on the archive runner's own capture, fetched
  2026-08-22T17:27:18Z: **15.600 mm across the series, of which 3.600 mm —
  23.1% — had already fallen** before anybody could read it. That share climbs
  through the UTC day toward everything.
- **Every NWS grid captured starts hours before its own `updateTime`:** Hilo
  6h11m early, San Juan 6h16m, Guam 6h05m, Galveston 2h20m. Read at the §48.13
  probe's own instant, Hilo's total goes **282.956 mm to 219.202 mm** — 11
  inches to 9 — with 63.754 mm of the previous evening removed.

A fluent wrong number with nothing on the page inviting a second look is the
most expensive kind this project ships (`CLAUDE.md`). The peak sentence carried
the same fault, putting a future tense on a cloudburst that finished at
breakfast.

**`futureBlocks(blocks, now)` DROPS BLOCKS THAT HAVE ALREADY ENDED, AND IT RUNS
BEFORE THE WINDOW.** So `RAIN.windowHours` is anchored on the first block still
to come rather than on the first block the source happened to send. Every figure
inherits it: the total, the `through` label, and the peak — whose share of the
total moves from 30% to 39% at Hilo, because the old denominator was carrying
the past and understating exactly the "most of it in six hours" signal §48.8
says separates a flood from a wet week.

**==> THE BLOCK CONTAINING `now` IS KEPT WHOLE, NEVER PRORATED. <==** Splitting
it means inventing a rate inside it, which is the same thing `windowBlocks`
already refuses at the other end of the series and for the same reason: nobody
published an hourly breakdown of a six-hour block. Keeping it overstates by at
most part of one block and invents nothing; dropping it would lose rain the
reader is about to get. At Hilo the block the probe stands inside is the
heaviest in the series, 84.836 mm.

**A SERIES THAT HAS ENTIRELY RUN OUT IS `lapsed`, AND IT IS NOT A DRY
FORECAST.** Printing *no meaningful rain expected* off an empty list would be an
all-clear built from an absence (§5). Both surfaces say the forecast has run out
and offer Retry — a fresh fetch is the fix, and this is exactly what a last-good
copy at the edge's six-hour limit looks like.

### 48.21 Flood alerts — the first drawn thing in §48

**==> IT REOPENS §48.1 ON EVIDENCE RATHER THAN CONTRADICTING IT. <==** That
section says rainfall has no map layer and that this is a decision, not a gap,
because **NHC publishes no rainfall geometry** — checked against their own GIS
index, where every other hazard has a product and rainfall has none. Still true,
and nothing here disputes it. A flood warning is a **different product from a
different agency**: NWS issues it for a polygon a forecaster drew, and that
polygon travels in the alert. §48.1's finding was about NHC's rainfall
*forecast*; this is NWS's statement about water already on the ground.

#### The attribution problem, which is the whole difficulty

**An NWS flood warning does not name a storm.** It reads *Flash Flood Warning,
Hawaii in Hawaii, HI* and nothing else — the hurricane sitting on top of it is
mentioned nowhere in the product. So every row this app puts under a storm's
name is this app asserting a connection the source never made, which is exactly
what §50.3 forbids for the CAP list: **a geographic match is not a causal
claim.**

What is claimed is therefore the weakest true thing: **this alert's shape comes
within a stated distance of this storm's track.** A statement about two shapes
and one number, verifiable from all three, asserting nothing about cause. The UI
is required to word it that way — *"in force within 345 mi of this storm's
track"*, never *"this storm's flooding"* — and the closing line says out loud
that an alert near the track may have another cause. **A stalled front can flood
a county while the hurricane goes out to sea, and the wording is the only
defence.**

**==> AND THE SENTENCE NAMES THE DISTANCE, WHICH IT DID NOT HAVE TO DO WHEN THE
MATCH WAS A CONE. <==** "Inside the forecast cone" at least pointed at somebody
else's published shape. A corridor is entirely ours, so the reader is handed the
radius and left to judge it. An unnamed proximity is a claim wearing a
measurement's clothes. It prints through `formatDistance` in the reader's own
units, like every other length in the app.

**THE MAP LAYER SIDESTEPS THE PROBLEM ENTIRELY BY NOT MENTIONING A STORM.** The
toggle is a global additive switch, the kind `genesis` is, and it answers *what
flood alerts are in force* — a question with no storm in it and therefore no
causal claim to get wrong. The per-storm question is answered in the drawer, in
words, where the rule can be enforced on a sentence. **Two surfaces, two
questions, and the one that cannot be worded carefully is the one that never
names a storm.**

#### Warnings draw, watches do not, and that is the source's doing

Measured on real NWS bytes (`samples/rain/alerts-hilo-hi.json`):

| product | geometry | zones |
|---|---|---|
| Flash Flood Warning | Polygon, 346 bytes | 1 |
| Hurricane Warning | Polygon, 1,142 bytes | 1 |
| Flood Watch | **null** | 17 |
| High Surf Warning | **null** | 7 |
| Tropical Cyclone Local Statement | **null** | 43 |

A warning is issued for a box a forecaster drew; a watch is issued for a list of
forecast zones and its shape is seventeen more requests away. So both reach the
drawer's list and only warnings reach the globe — and **the count says so.** A
layer drawing eleven of nineteen under a sentence claiming nineteen is §5's
silence with a map over it, so `total` and `drawable` both travel and the
sentence names the difference.

**A SHAPELESS WATCH IS NEVER GIVEN A SHAPE.** No zone centroid, no circle,
nothing. That would be this app drawing a boundary NWS did not draw — the §5
fabrication in its most literal form.

#### The corridor — a distance from the whole track

**Landed 2026-08-22, replacing a bounding-box overlap with the forecast cone.**
For each alert, `lib/flood.js` measures the shortest great-circle distance from
its shape to the storm's densified track — **past and forecast, both, each
published line kept as its own chain** — and matches it if that distance is
under `RAIN.floodCorridorNm`.

**==> A CONE IS THE WRONG SHAPE AND THAT IS WHY IT WENT. <==** A cone is where
the storm's CENTRE might go; it says nothing about where the weather is.
Flooding happens hundreds of miles from a centre, inland, days after landfall,
from a system that has stopped being a hurricane — Ida drowned New Jersey while
her centre was over Pennsylvania. Measured on real bytes in `tools/test-flood.mjs`:
against the 33 drawable US flood alerts in force at 2026-08-22T22:29:35Z, Ida's
own advisory-19 track matches **25 within 300 nm**, and **the Indiana and
Illinois river warnings in that set all sit further than 150 nm out** — outside
any cone, and exactly the inland river flooding the old match was missing.

**==> THE PAST TRACK IS HALF THE ANSWER, NOT A COURTESY. <==** A storm that has
already crossed a region is still flooding it; the water arrives after the wind
leaves. Lala proves it on her own published geometry: her **forecast** track is
**1,083 nm** from the Hilo flash flood warning and her **past** track is
**21.9 nm**. A forecast-only match — which is approximately what a cone is —
drops it entirely.

**THE RADIUS IS ONE CONSTANT AND IT HAS NOT BEEN MEASURED.** `RAIN.floodCorridorNm`,
**300 nm**, a starting value Aaron chose on 2026-08-22 to move on glass. Nothing
in the sandbox can find the right number: it depends on how far a rain shield
reaches from a centre over land, and this project has never had a US landfall on
glass. **It is deliberately flat and not scaled off the wind field** — a
weakening storm inland has an enormous rain footprint and almost no wind field,
which is precisely the case that floods people, so scaling by wind radii would
shrink the search area exactly where the hazard is worst.

**NEAREST VERTEX OF THE SHAPE, NOT ITS CENTRE**, and that is a choice about
which way to be wrong. It overstates the overlap slightly and in **one
direction** — toward including an alert just outside the corridor, never toward
dropping one just inside. Measured across the archived set: a bounding-box
centre reads up to **10.0 nm further** than the nearest vertex and never nearer.
Same reasoning §48.19 uses to keep a partly-elapsed rainfall block rather than
prorate it.

**THE TRACK IS DENSIFIED AND THE ERROR IT REMOVES IS NOT SMALL.** `densifyTrack`
at `TRACK_SUBDIVISIONS`, the same tool `data/home-corridor.js` uses. Ida's
advisory 19 carries seven positions across five days, so an alert beside the
middle of a leg gets measured to that leg's ends: Russell and Washington
counties in Virginia sit **28 nm** from her track and **84 nm** from the nearest
published point. A 56 nm overstatement, running toward dropping an alert that is
inside the corridor.

**EACH PUBLISHED LINE STAYS ITS OWN CHAIN.** Lala's real past track off the
archive is **fourteen** LineString features plus a forecast one — the mapserver
publishes it in segments. Flattening them and interpolating through would draw
legs between segments the storm never travelled. Hers happen to be contiguous,
so flattening costs nothing there; the guard is asserted on a probe with a real
gap, where flattening puts a sample **536 nm** from anywhere the storm was. No
connector is needed between past and forecast: `lib/trackline.js` cuts one
smoothed curve into `slice(0, cut + 1)` and `slice(cut)`, so the two slots share
the vertex at the cut and the chains already meet.

#### The antimeridian, and the bug the corridor deleted rather than solved

**==> A PLAIN BOUNDING BOX ON LALA'S REAL CONE MEASURED −180 TO 180 — THE WHOLE
PLANET. <==** She is a Central Pacific storm at 30N 172W and her published ring
has vertices either side of the seam. Every flood warning in the United States
falls inside a box that wide, so **every Central Pacific storm would have
claimed every flood warning in the country.** Nothing threw. Nothing on screen
looked odd. The sentence read perfectly.

The fix at the time was `extent()`: sixty lines measuring longitude in both
frames and taking whichever was narrower. **All of it is gone.** A great-circle
distance has no frames and no seam — `greatCircleNm` is built on `sin(dLon/2)²`,
which is periodic in 360°, so an unwrapped longitude of −190° and a plain 170°
are the same place to it. That matters in practice and not only in theory:
`lib/trackline.js` unwraps longitudes before splining, so tracks do arrive here
carrying values past ±180.

**The before and the after are both asserted, on the same storm.** A plain box
on her cone still spans over 350°; her real track matches **none** of the 33
national alerts, the nearest of which is **1,966 nm** away.
`samples/flood/cone-lala-cp2.geojson` is kept as the record of the deleted bug.
`lib/seam-stitch.js` remains the drawing side of this same seam.

#### `no_track` is not `none_matched`

Both produce an empty list and **this is the §5 distinction this feature is most
likely to lose.** A storm with no published track has nothing to measure against
and the honest answer is that we cannot say. A storm whose track *was* measured
and came near nothing is a real all-clear. The drawer says *"this storm has no
published track, so flood alerts can't be matched to it"* for the first and *"no
flood alerts are in force within 345 mi of this storm's track"* for the second.

#### Nothing is held, and the reason is not the usual one

Every forecast route in this app keeps a last-good copy, because a stale
forecast beats a blank section. **This one keeps none, at the relay or on the
client.** An expired flood warning is not a stale reading of a live fact; it is
a shape on a map telling somebody they are in danger when they are not. §50.5
reaches the same conclusion about the CAP list.

`CACHE.floodClient` is **three minutes, the shortest window in that table**, and
it is set by how fast the contents stop being true rather than by how often the
source republishes: the captured Hilo Flash Flood Warning expired **52 minutes**
after it was issued. Expiry is filtered **again at render**, off each row's own
`ends`/`expires`, exactly as §48.6 does for the house rows.

#### The route

`functions/api/nws/flood.js` asks the upstream for **three products by name** —
Flash Flood Warning, Flood Warning, Flood Watch — rather than pulling
`/alerts/active` unfiltered and sieving it. Deliberately not a wildcard on
"Flood": that would also catch Coastal Flood Advisory and Lakeshore Flood
Warning, which are real products about different water that §51 already owns.
**Adding an event is a decision; discovering one through a wildcard is an
accident.** `isFloodFamily` on the client is the belt to that brace, and it
earns its place — the captured Hurricane Warning carries a polygon over the same
island and is not a flood product.

**ONE FAILING EVENT FAILS THE WHOLE REQUEST** (`Promise.all`, not
`allSettled`). A partial answer here is a map missing warnings it does not know
are missing — an all-clear over a flooding county, assembled out of a 500.

**==> THE VOLUME HAS NEVER BEEN MEASURED AND THE ARCHIVE NOW MEASURES IT. <==**
The per-feature shape was known from real bytes before a line was written. The
row **count** on an active day was not, and nothing in a sandbox can reach
api.weather.gov. Both queries are archived hourly so the first tuning pass reads
bytes rather than guessing. **Until that lands, every sizing claim about this
feature is a guess and should be treated as one.**

#### The layer

Green, because every other hue on this globe is spoken for and fixed:
Saffir-Simpson owns the dots, `WATCH_WARNING_COLOR` owns the coast, the surge
ramps own blue through magenta (§4.7). NWS draws flood warnings green on its own
maps, so this agrees with the agency rather than minting a third vocabulary.

**IT DOES NOT JOIN `main.js`'s THEME RE-PUSH LIST, AND THAT IS THE NOTE THERE
BEING OBEYED.** That list caps itself at three and says a fourth is the signal to
build the real repaint path rather than to add a line. This layer has exactly two
colours, so it uses a `['case']` paint expression with no `global-state` in it
(safe from `map/theme-state.js` rule 1b) and rethemes with two
`setPaintProperty` calls touching no geometry.

**Off by default**, like model tracks and Environment, and the off default gates
the fetch: nothing asks the relay for this list until the switch goes on. The
toggle's note names the two limits that would otherwise read as faults — **US
only**, because NWS is and no global equivalent has been found, and **watches
have no shape to draw.**

### 56.7 Flooding — one section, both kinds of water

**Landed 2026-08-22, on both screens at once.** `ui/flooding-storm.js` and
`ui/flooding-home.js`, the shared sentences in `ui/flood-words.js`, the rows
still drawn by `ui/rain-alerts.js`. **It replaced the `Coastal flooding` section
— deleted, along with its spec entry — and it took the flood-alert rows out of
both Rain sections.**

**RAIN AND FLOODING ARE SEPARATE SECTIONS; COASTAL FLOODING IS NOT.** Rainfall
is our arithmetic on a forecast. A flood alert is an agency's statement about
right now with an expiry on it. Burying the second inside the first makes the
urgent thing look like a footnote on the other thing — which is what §48.21
shipped — so Flood left Rain.

**BUT COASTAL FLOODING MERGED INTO IT RATHER THAN STANDING BESIDE IT.** Somebody
deciding whether to move a car does not care whether the water came off the sky
or off the sea. Two headings for *water is going to be where you are* is a
distinction that matters to the plumbing and not to the reader.

**AND THE TWO BARELY EVER CO-OCCUR, WHICH SETTLED IT.** NWS flood alerts are US
only. GDACS models coastal flooding and explicitly declines NHC's basins
(§51.5). So a US storm has alert rows and no modelled figure; a Japan typhoon
has a modelled figure and no alert rows. **Two sections where one is always
empty is worse than one section that fills from whichever source has
something.**

**THEY ARE DIFFERENT KINDS OF STATEMENT AND ARE NOT STYLED THE SAME.** An alert
is somebody else's order. A modelled height is our reading of a model. Given one
look, the model borrows the authority of the order. So the section takes the
shape Rain already used: **bordered alert rows on top with their own ink, our
modelled figure as plain prose underneath**, with a hairline between them —
`.flood-model--after-rows`, drawn only when both halves are present, because a
rule under nothing is a line across an empty section.

**ORDER ON BOTH SCREENS: Rain, then Flooding.**

#### ==> THE ONE THING THIS MERGE COST, AND IT IS A §5 COST <==

**ONE SECTION NOW CARRIES TWO COVERAGE GAPS AND EACH ONE READS AS AN ALL-CLEAR
IF IT IS SILENT.** This is the thing most likely to be got wrong, and the
sentences that stop it are in `ui/flood-words.js` so both screens say the same
one.

| Empty half | What it must NOT read as | What the section says |
|---|---|---|
| no alert rows | *no flood warnings are in force* | `NWS_US_ONLY` — the NWS issues these for the United States only and there is no global equivalent, so an empty list is not an answer for anywhere else |
| no modelled figure | *no coastal flooding expected* | `MODEL_NOT_THIS_BASIN` — coastal flooding is not modelled for storms in this basin; a gap in what the app can show, not a forecast |

**THE STORM PANEL SAYS `NWS_US_ONLY` ON EVERY EMPTY RESULT, NOT ONLY OUTSIDE THE
UNITED STATES, AND THAT IS DELIBERATE.** The quieter design needs a test for "is
this storm somewhere NWS covers", and nothing in this project can get that test
right: it is not the basin — a Central Pacific storm off Hawaii IS covered and
an Atlantic storm mid-ocean is not — it is not the source, and this app has
never had a US landfall on glass to check an answer against. **A wrong coverage
claim is worse than a true one said once too often.**

**THE HOME DASHBOARD DOES NOT USE IT, BECAUSE IT CAN ANSWER EXACTLY.** The
rainfall payload names the provider, so the sentence there is about this house:
from the global model, *flood alerts aren't published for this location*; from
NWS with a failed alerts hop, *could not be checked just now* (§48.16, and the
two must never swap).

#### What each screen puts under the rows

| | the rows | the figure |
|---|---|---|
| storm drawer | NWS alerts within `RAIN.floodCorridorNm` of the track (§56.3), plus the national agencies' storm-surge rows (§56.8) | `surgeOnStorm` — **the deepest coast this storm is modelled to flood, anywhere**, and where |
| home dashboard | what is in force at the reader's own address, off the point forecast the Rain section already fetched | `surgeAtHome` — the nearest reporting point to the house |

**NOTHING ABOUT THE READER'S HOUSE APPEARS IN THE STORM DRAWER'S HALF** (§56.9).
A storm panel is about the storm, so `lib/surge-locations.js` gained
`surgeOnStorm` rather than being handed a null house: `surgeAtHome`'s
`out_of_range` state means *the model ran and nothing is near YOU*, which is a
fact about an address and meaningless without one. **Two questions, two
functions, and neither can answer as the other by accident.**

**THE ROWS DO NOT READ THE STORM AT ALL ON HOME, AND THAT DELETED A RULE RATHER
THAN MOVING IT.** The retired gate needed a second scope tier inside the storm
drawer's house block so that a storm which misses the house keeps its warnings
— the total is the storm's to imply and the warning is not. On the home dashboard
there is now no tier: the rows render the same for a near storm, a distant storm
and no storm at all. **A rule that cannot fire cannot fire wrongly.**

**AND THE EMPTY RESULT BECAME SAYABLE.** Inside Rain an empty alert list was
correctly silent — the total below it was the section's answer, and announcing
the absence of a hazard nobody asked about is noise. A section headed *Flooding*
with nothing under it cannot be told from one that failed to load, so the home
dashboard states it: *no flood alerts are in force for your address.* That is
the one behaviour this move changed rather than relocated.

#### The states, and only one of them is an all-clear (§5)

| State | What it says |
|---|---|
| `unavailable` | the list didn't load — **never** "none in force" — with its own Retry |
| `no_track` | this storm has no published track, so alerts can't be matched to it |
| `none_matched` | no flood alerts are in force within *X* of this storm's track, **plus** `NWS_US_ONLY` |
| `ok` | *N* flood alerts are in force within *X* of this storm's track, the rows, and the not-attributed note |
| model `none_matched` | no coastal flooding is modelled for this storm — it isn't near enough to any populated coast. **The only all-clear in the modelled half**, and it is a fact about where the storm is |
| model `out_of_range` (home) | nothing modelled near your house, the deepest elsewhere named, and *this model only reports at populated coastal places, so this is a gap in what we know rather than an all-clear* |

**THREE RETRIES, THREE TOKENS, THREE SOURCES** on the storm panel — `flood` for
the national NWS list, `flood-cap` for the CAP feed, `flood-model` for the GDACS
run. They fail independently, and a Retry that refetches a source the reader did
not ask about is a Retry that lies about what it did.

**KEYBOARD IS WHY THIS PHASE LANDED BEFORE THE MAP** (§10, §56.6). Phase 5 puts
these alerts on the globe as tappable icons, and an icon reachable only by
tapping a sphere does not exist for a keyboard user. **The rows are the keyboard
path**, and a phase that shipped the icon without them would have shipped a
gesture-only feature.

**IT BORROWS RAIN'S TYPE SCALE RATHER THAN INVENTING ONE.** `.flood-line`,
`.flood-worst`, `.flood-note` sit beside their rain counterparts in
`ui/panels.css`'s role table. The two sections are adjacent and answer the same
kind of question, so they should read as one rhythm; what distinguishes them is
the icon and the words, which is where the difference actually is. **The rules
moved from `home.css` to `panels.css`** when the section gained a second screen
— the same move `.rain-alert` made.

**==> AND IT PUT §48.6's WARNING BELOW THE RAINFALL TOTAL, WHICH IS THE ONE
THING THIS SECTION TRADED AWAY. <==** §48.6's rule is that a warning in force
outranks any forecast and renders above it. Within one section it still does —
rows lead, prose follows. Across sections it no longer does, because the order
is Rain then Flooding. **The trade is deliberate and it is worth naming rather
than burying:** what was bought is that the warning has a heading of its own
instead of being a footnote on a section about something else, and that it sits
beside the other kind of water. What was sold is roughly one section's scroll
height on a phone. **Judge it on glass during a US storm near a home** — nothing
in the sandbox can, and if it reads wrong the fix is one line in
`dashboardHtml` and one in `renderBody`.

#### The row itself

**==> THESE RULES ARRIVED WITH A SECTION THAT HAS SINCE BEEN DELETED, AND THEY
OUTLIVED IT. <==** They were written
for the flood rows inside the storm drawer's house block; the block is gone
(§56.9) and the rows are this section's, on both screens, drawn by the one
shared builder in `ui/rain-alerts.js`. The rules did not change when the rows
moved, so they are recorded here rather than deleted with the section that
first stated them.

**THE AFFECTED AREA, VERBATIM AND WHOLE.** A warning with no area attached asks
the reader to assume it is about them, which on the flood family is the one
assumption worth not making. `areaDesc` now survives the relay projection.
Measured on the captured set: 20 bytes on the Flash Flood Warning (`Hawaii in
Hawaii, HI`), 307 on the Flood Watch (seventeen named zones). **Never truncated,
here or downstream** — the reader is hunting for their OWN zone in that list and
we do not know which one it is, so dropping the tail is how you hide it from
them.

**THE PROJECTION RATIO MOVED AND THE THRESHOLD MOVED WITH IT.** Alerts go from
34,369 stored bytes to **2,607**, the grid body to **3,930** from 58,373. The
suite asserted a twentieth and now asserts a tenth; what it is really guarding
is a projection that stops projecting and ships the 55 KB of `description`,
`instruction` and polygon. Both figures print in the output, so drift shows even
while the test passes.

**HOW LONG IS LEFT, BESIDE WHEN IT ENDS — NOT INSTEAD OF IT.** A clock time is
what somebody plans against; a duration is what tells them whether to move now.
`remainingWords()` states **minutes under an hour**, and that is the one figure
in §48 where minutes matter: Hilo's Flash Flood Warning ran **52 minutes**, and
`durationWords`' whole-hour rounding would call that "an hour" — overstating the
time a reader has, on the number whose entire point is how little is left. An
alert with no end time gets no duration rather than an invented one; two of the
five captured alerts carry `ends: null`.

**==> THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency`. <==** Measured on the
captured set: the Flood Watch reads **`urgency: Future` with an `onset` four
hours in the PAST**, because the urgency describes when the HAZARD is expected
and the onset describes when the MESSAGE took effect. A row reading "starts at
3:55 AM" off that urgency, or "not yet begun" off it, would be wrong in opposite
directions. `begun` compares `onset` against the reader's own moment, and the
three shapes — running with a known end, not yet started, running with no end
published — each get their own words.

---

### 56.8 Watches and warnings keeps its place, and gained one line

**FLOOD ALERTS DID NOT MOVE INTO `Watches and warnings`.** The line that holds:
**that section carries products that NAME this storm; Flooding carries products
that do not.**

- NHC's four — Tropical Storm and Hurricane Watch/Warning — are issued for this
  storm, by name, in its own advisory. No attribution risk.
- The foreign-agency CAP rows are matched by country (§50.3), which is weaker,
  and §50.12's footnote already hedges it.
- An NWS flood alert names nothing at all. It is a distance match **we**
  performed. In a section whose other rows genuinely belong to the storm, that
  difference would be laundered into looking official.

**REJECTED: ONE MERGED WARNINGS LIST.** It would sit a Hurricane Warning — this
storm, named, act now — beside a Flood Warning two states away that may have a
different cause entirely, in one list with one look. The strong row lends its
authority to the weak one.

**THE COST IS ONE SENTENCE AND IT IS THE WHOLE DEFENCE.** A reader who opens
`Watches and warnings` during a flood and finds no flood warning will not
conclude "it must be filed elsewhere" — they will conclude the app did not see
it. `FLOOD_POINTER` in `ui/flood-words.js` says so, once, in the quietest
register the panel has.

**IT IS APPENDED IN `wwHtml()`, NOT INSIDE EITHER HALF.** That section has two
bodies — NHC's own legend and `ui/cap-storm.js` — and a line written into one of
them would be missing from the other half of its own section, which is a blank
space and therefore invisible. **It is unconditional, including on the empty
state**, because the empty state is exactly when a reader is most likely to
think something is missing. **Not on a withheld storm:** the whole section is
replaced by one sentence saying why nothing in it can be trusted, and a signpost
under that is furniture on a notice.

**IT NAMES THE SECTION BY THE HEADING THE VIEW ACTUALLY RENDERS**, and
`tools/test-flooding.mjs` asserts the two agree. A pointer to a heading that
does not exist is worse than no pointer: the reader goes looking and concludes
the app lost the alert, which is the exact failure the line was written to
prevent — and renaming the section is otherwise a one-word change with no
failing check anywhere.

#### The storm-surge rows moved across

`functions/api/cap/alerts.js` asks its upstream for `Storm Surge` alongside four
cyclone terms, so a foreign Storm Surge Warning had always landed in `Watches
and warnings`. Since §56.7 every other kind of water lives in Flooding, so
leaving that one behind would **split water across two sections according to
which feed happened to carry it** — the exact arbitrariness the merge deleted.

**`partitionSurge()` IN `lib/cap.js` RETURNS BOTH HALVES, AND IT IS ONE FUNCTION
RATHER THAN TWO PREDICATES.** The property worth guaranteeing is that every row
lands in exactly one section: a row in **neither** is §5's silence with a filing
system over it, and a row in **both** is the app saying one thing twice under two
headings and leaving the reader to work out whether it is one alert or two. Two
independent tests can drift into either failure; a partition cannot.

**IT TESTS HOW THE ROW GOT HERE, NOT WHAT IT MEANS.** `CAP.surgeEventMatch` is
`'storm surge'`, matched case-insensitively — English, on a field that is the
agency's own words in the agency's own language. It cannot be a complete test of
"is this about surge" and is not written as one. What it CAN test is whether the
row came through the route's surge term, **which is the only door a surge-only
product has into this list at all.** An agency publishing surge in Spanish under
a cyclone name reaches `Watches and warnings`, which is where it was before this
rule and is not made worse by it.

**A ROW NAMING BOTH GOES TO FLOODING.** "Tropical Cyclone Storm Surge Warning"
is a real shape for this field and it is a statement about water; the reader
looking for water should find it in the one place the app now keeps water.

**ONE FETCH, ONE STATE MACHINE, TWO SECTIONS.** `ui/cap-storm.js` keeps the
fetch and hands Flooding finished markup through `waterHtml()`. A second
controller with its own fetch would be two answers to "what has this agency got
out right now" landing at different moments, with the older one showing in one
section and nothing on screen saying so. **`renderCapBody()` repaints BOTH
sections from one landing** for that reason, and for a second: the language
disclosures register their DOM ids during a render, and repainting one half
alone used to wipe the other half's — which would have stopped those disclosures
opening with nothing throwing.

---

### 56.9 The house gates on the corridor, and leaves the storm drawer

**==> NOTHING ABOUT THE READER'S HOUSE IS RENDERED IN THE STORM DRAWER. <==**
The house block is gone from `ui/rain-storm.js` — the rainfall total at the
address, the peak timing, the two-tier scope that decided how much of it a given
storm earned. What is left in that section is NHC's own published rainfall
range, which is about the storm. **A storm panel is about the storm.**

The figure was never wrong. It is a forecast about a PLACE, so it is true for
every cyclone on the globe — which is exactly the problem: printed under one
storm's name it is a true number in a position that claims a connection nobody
made. That failure has no exception to catch and no wrong digit to spot, and it
read perfectly for the month it shipped.

**THE HOME DASHBOARD GATES ITS TWO HOUSE SECTIONS ON THE STORM'S CORRIDOR.**
That screen has a stepper and every cyclone on Earth can be cycled through it.
`Rain` and `Flooding` are plain queries at the reader's address with no storm in
them, so stepping to a Japan typhoon left a rainfall figure sitting under its
name. Since 2026-08-22: **if the house falls inside the shown storm's corridor
the sections render, and if it does not they do not appear at all.**

**==> ONE TEST, ASKED TWICE, AND THAT IS THE WHOLE DESIGN. <==** The corridor
that decides *which flood alerts belong to this storm* (§56.3) is the same
question as *does this storm reach my house*. Same function, same samples, same
`RAIN.floodCorridorNm`: `homeInCorridor()` in `lib/flood.js` measures the house
against the storm's whole densified track, past and forecast, with `nearestNm`
— which now accepts a `Point`, a house being a ring of one vertex. The home
screen and the alert list cannot come to different conclusions about one storm.

**IT REPLACED TWO RINGS OF DIFFERENT SIZES.** The retired gate put the house
figure behind the wind field at 300 nm and the flood warnings behind
`APPROACH.relevanceNm` at 1,500, so a storm could be near enough for one
sentence and too far for the one beside it. Both are retired.
**`RAIN.floodCorridorNm` is now the only distance in this app that means *near
this storm*,** and the house-fallback constant beside it is deleted.

**==> ONE EXCEPTION, AND IT IS NOT A LOOPHOLE: THE SECTIONS RENDER WHEN THERE
IS NO STORM ON SCREEN AT ALL. <==** On a calm day, showing the reader their own
rain forecast and any flood alert over their address is this screen's entire
job. What the gate forbids is those sections rendering UNDER a storm they have
nothing to do with — not their existing. **This half was missing before this
phase**: both sections were built only on the dashboard path, which needs a
threat storm, so a genuinely quiet day showed neither. A gate that only ever
subtracted would have made a quiet day emptier still.

**AND IT HOLDS ON THE DAY A SOURCE GOES QUIET.** NHC being unreachable says
nothing about NWS's alert feed or the rainfall grid. The sections draw on the
`unavailable` branch too, because withholding them there would take away the
half that still works on the day the other half stopped.

#### The measurement, and the one property that makes it safe

**THE SAMPLES ALWAYS CARRY THE STORM'S OWN PUBLISHED POSITION**, not only its
track. The geometry bundle lands after the first paint, so for the first moment
of every storm the track arrays are empty; without the position this would have
to answer *cannot say*, and the caller would be deciding what an unknown means
on a screen about the reader's own house.

**==> WITH IT THERE IS NO UNKNOWN, AND THE ANSWER MOVES IN ONE DIRECTION ONLY.
<==** Adding track samples can only lower the nearest distance, never raise it.
So as the geometry arrives **the gate can open and can never close**: a section
can appear under the reader, and one can never vanish from under their finger.

**THE PAST ARM COUNTS, FOR THE REASON §56.3 GIVES.** The water arrives after the
wind leaves. Measured on Lala's own archived bytes: her genesis point is 0.0 nm
from her observed track and 2,158 nm from her forecast one, so a gate reading
only the forecast calls it a miss.

**IDA IS THE FIXTURE AND THE ARGUMENT.** Off NHC's advisory-19 positions:
Newark is **74 nm** from her track and **915 nm** from where her centre actually
was. A gate on the storm's position alone would have shown a New Jersey reader
nothing on the day New Jersey drowned. Chicago, at **367 nm**, is out — a real
American city on the same continent in the same week, which is what stops every
other case passing on a function that returns true.

#### What the reader sees

**ONE GATE, ASKED BY EVERY PAINT PATH AND BY EVERY FETCH.** `houseSectionsShow()`
in `ui/home-gate.js` — its own file, because `ui/view-home.js` is over §12's
ceiling and takes a seam and nothing else. It is read by the full render, both
per-section repaints and both `ensure` calls. A fetch dispatched for a state the renderer will not draw
is bytes the reader pays for and never sees; a repaint that disagrees with the
render that drew it is how a section ends up stuck on *Checking…* forever.

**THE ATTRIBUTION SENTENCE CAME OFF THE STORM DRAWER WITH THE BLOCK AND IS
NEEDED MORE ON THE HOME SCREEN, NOT LESS.** The section now draws only when the
storm on screen is measured to reach the house, so its presence is itself the
app stating a connection. The connection is real; **the number is still not the
storm's.** A gridded QPF is all rain from all causes, and a stalled front can put
four inches on a house while the hurricane goes out to sea. So the provenance
line closes *Total rain from all causes, not this storm alone* — **and only when
a storm is on screen**, because with no storm named anywhere that is a
disclaimer of a claim nobody made. It is a flag on `rainH.inner`, not a guess.

**§48.10's ONE-SCREEN FIX IS RETIRED, AND NOTHING IS LOST.** That risk was a
reader meeting *8 to 12 inches across eastern Maui* and *about 3 in* in one
section and concluding the app is broken; the fix was to put them adjacent with
a line explaining the difference. There is no disagreement left to explain,
because the storm drawer now prints one number and the home screen the other.

**WHAT WENT WITH IT — SIX EXPORTS, ONE CONSTANT AND A CSS RULE, IN ONE PASS.**
The two scope predicates in `lib/rainfall.js`; the three-word wind-field verdict
in `data/home-corridor.js` and the composition of it in `app/views.js`; the
range-to-home helper in `ui/view-storm-detail.js`; the house-fallback distance
in `config/constants.js`; and the hairline rule that separated the two blocks.
**Retiring them together was most of this phase's diff** — half-removing the
chain would have left a predicate answering a question with one live answer and
one dead one, which is a worse file to read than either the before or the after.
The Rainfall controller went from five injected dependencies to one and from 484
lines to 196. `buildCorridor` stays; the home chart draws it. **Three sections
of §48 are deleted with the code they described** — the house block, the gate
that decided which storms earned it, and the two-tier rule for its warnings —
and the row rules that arrived with the last of them are recorded under §56.7.

---

### 56.10 The glyph

**THREE STACKED WAVES**, `flood` in `ui/section-icon.js`. Water where it should
not be, whether it came off the sky or off the sea.

**`surge`'s CREST IS DELETED WITH ITS SECTION.** Its own comment said it existed
solely to separate `Coastal flooding` from `Rain` at a glance while scrolling.
That section no longer exists, so the mark has no job. **There is exactly one
water glyph in this app now, which is the point** — two would teach a reader
that the difference between them means something, and §56.7's whole finding is
that it does not.

**DELIBERATELY NOT THE RAIN CLOUD WITH MORE DROPS.** Rain and Flooding sit
adjacent on both screens and the icon is what separates them while scrolling. A
cloud is weather arriving; these are the ground already under water.

**IT IS CENTRED ON THE 24-BOX (x 4 to 20)** rather than inheriting `surge`'s
off-centre 3-to-19 span, because Phase 5 strokes these same path strings onto a
canvas for `map.addImage` — **the same path data, not a redrawn one.** Tap a
wave on the globe and the panel that opens is headed with the same wave. An icon
that is going to be rasterised has to be balanced inside its own box, where a
heading glyph could get away with a lean.

**AND THE NAMING RULE EARNED ITS KEEP THE DAY IT WAS TESTED.** That file's
standing instruction is to name an icon for the IDEA and not the picture. A
crest was replaced by three waves and **not one call site had to change**,
because no call site had ever named a crest.

---

### 49.4 Relative time has a direction

`formatUntil(t, now)` in `lib/time.js` answers in whichever direction the moment
actually lies: `in 3 days`, `in 14 hrs`, `in 40 min`, `now`, `40 min ago`,
`14 hrs ago`, `3 days ago`. It is the string every timed row on the home
dashboard leads with — seven in `ui/countdown-home.js`, one each in
`ui/view-home.js`, `ui/view-storm-detail.js` and `ui/view-storms.js`.

**IT CARRIES ITS OWN PREPOSITION IN EVERY DIRECTION** — `in 9 hrs` and `9 hrs
ago`, never a bare `9 hrs`. Callers concatenate one string and nothing
downstream branches on tense.

**THE DEAD ZONE IS `now` ON BOTH SIDES, AND IT IS THE ONLY TENSELESS WORD ON
THIS SCREEN.** Inside two minutes either way the event is happening rather than
scheduled or finished. `formatAge`'s word for the same span is `just now`, which
leans past — printed about an arrival ninety seconds out it would borrow the
past's words for a future fact, which is exactly what §49.2 forbids.

**THE PAST ARM IS `formatAge`, NOT A COPY OF IT.** The boundaries (one hour,
48 hours), the rounding and the hr/hrs plural already exist there and already
match the forward arm. A copy would be two places to change and a silent way for
the two directions to disagree.
