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

`dash.stage`, computed in `buildHomeDashboard`, ten rungs checked most-immediate
first: `wind-here`, `overhead`, `imminent`, `bearing-down`, `closing`,
`just-passed`, `past`, `far-off`, `track-unknown`, `pending`.

**IT REPLACED A COIN FLIP.** The chip was two words off the storm list's pick,
and `Nearest` was a shrug covering four unrelated situations — a stationary
storm, one past `relevanceNm`, one closing inside the deadband, and **every
GDACS storm**, because GDACS publishes no heading and nothing could tell "not
closing" from "cannot say". A cyclone bearing straight down wore the same word
as one parked half an ocean away. `track-unknown` is the rung that fixes it.

**IT LIVES IN THE DASHBOARD, NOT IN `pickThreatStorm`.** The list ranks storms
carrying only a current position; every interesting rung is a question about
the walked track and the wind fields. `pending` is what the chip says before
geometry arrives — deliberately nothing, rather than a confident word that has
to be taken back a second later.

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
direction, and "Never comes within 100 mi of you" measuring a Northwest Pacific
storm against a ring drawn round a house in Louisiana. The last one is the worst
of the three, because being *reassured* about a storm 6,000 miles away implies
the app seriously weighed the possibility.

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
strong · how it unfolds · and, for a near storm, the closest pass above them.
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

**THE FOUR COLOURS IT DRAWS WITH COME FROM `applyTokens()`, NOT FROM THE PAGE
IT HAPPENS TO BE ON.** `--kt34`, `--kt50`, `--kt64` and `--coast-glow` are set
on the root element at boot — the wind bands off `WIND_BAND_COLOR` because §6
fixes those hues in both themes, the home line off `palette()` because it is
the coastline's own colour. This is written down because the chart shipped
referencing all four with none of them declared, and an unresolved `var()` in
an SVG presentation attribute renders BLACK in silence. `tools/test-css-vars.mjs`
enforces it.

**THE BANDS ARE THE WIND, NOT THE STORM.** Each is how far that threshold
reaches *toward home*, measured along the bearing that actually points at the
house. They nest — 64 inside 50 inside 34 — and each is clamped at zero, since
a negative distance is not a place.

**THE HOME LINE IS NEVER PAINTED OVER.** It used to wear each threshold's
colour for the hours that wind was on the house, and that was cut on glass:
overstriking the reader's own house in the wind's colour reads as damage to the
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

**A DOTTED VERTICAL MARKS NOW, AND THE AXIS NO LONGER CLAIMS ITS LEFT EDGE IS.**
The first sample is the storm's position as of the advisory, which on a live
feed is up to three hours old; the leftmost axis label said "now" regardless.
The axis states the time it actually shows and the vertical carries the present.

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
read 12 hrs, 16 hrs, 21 hrs, 18 hrs. Rows with no time (the held Phase-B row,
"never comes inside") sink to the bottom rather than sorting among things that
occur, and the sort is stable so rows sharing a moment keep their written order.

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

A held Phase-B row (winds arriving, and for how long) is drawn with a **dashed
node rather than omitted**, because a countdown that jumps from "comes inside
100 miles" to "closest pass" implies the wind arrives at the pass. It arrives
hours before.

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

### What home is for

Five things depend on it: the dashboard above, storm-list sort order, where
recenter comes to rest, the opening sequence's resting position, and the detail
panel's home block.

Home features, in order of how much geometry they need:

| Feature | Needs | State |
|---|---|---|
| Home marker, off-screen pointer, distance, bearing | position only | shipped |
| Forecast closest approach | forecast track | shipped |
| Wind-arrival at home | MapServer layers `+15`/`+16` | not built |
| At-home exposure timeline | forecast wind radii | not built |
| Surge-at-home | Peak Storm Surge service | not built |

**Wind arrival is FETCHED, never computed** (§4). Peak Storm Surge has no
`stormid` field and must be filtered spatially, so the at-home version and the
surge layer share one fetch-and-filter — build them together or write it twice.

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
two. `[DECIDE]` whether a second desktop slot earns its place.

**NAVIGATION IS A REAL HISTORY STACK, and "back" means where you just were.**

```
storms → detail → layers      back ⇒ that storm's detail, not the list
```

Opening Layers from a storm is a SIDE TRIP and the storm survives it. Cluster
buttons ENTER a view as a fresh root (clearing the stack); Back walks the stack;
Close dismisses the drawer entirely.

**At phone width the open drawer COVERS the control cluster, and that is
intended.** Measured at 390×844: the drawer top sits at y=620 while `#btn-storms`
spans y=636..680, so the button that opened a view cannot be tapped to close it.
Nothing is trapped — the X and Esc both close the drawer — and the rule below is
why this is right rather than tolerated. **Do not "fix" it.**

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

**CONTENT DISSOLVES UNDER THE HEADER, IT IS NOT GUILLOTINED BY IT.** Every
view's `.drawer-body` carries a 12px fade band at its top (`--scroll-fade`), so
a row scrolling up under the title thins out instead of being cut clean in half
at the scroller's edge — a hard cut reads as a rendering fault rather than as
"there is more above". It is a **mask on the content**, not an overlay: this
panel is glass, and any gradient strip painted on top would have to be a colour
and would show as a lighter band against the blur. Masking fades the content
itself to transparent, so what shows through is the same glass and the same
globe as the rest of the panel. **It is not a `backdrop-filter`** — a second
blurred surface re-evaluated on every scroll frame, on a phone already running a
globe, is exactly the trade §9 refuses; a linear-gradient mask composites on the
layer that already exists and costs nothing per frame. The same 18px is also the
scroller's TOP PADDING, and that is load-bearing: a mask on a scroller is fixed
to the element's own box rather than to the content, so without matching padding
the first row would sit permanently half-faded at rest.

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

**THE HEADER IS BACK · TITLE · CLOSE, AND CLOSE IS ALWAYS AT THE TRAILING EDGE.**
It is laid out with flex, deliberately: the back button is `display: none` in
four views out of five, and under `grid-template-columns: auto 1fr auto` the two
remaining children shifted one column left, so the close button landed
left-aligned in a very wide box, apparently welded to the word "Layers". **The
general trap: a positional layout plus a conditionally-hidden child is a layout
that silently means something different in each state.**

**THE DRAWER TITLES A VIEW BEFORE IT ENTERS IT.** `enter()` calls
`renderChrome()` — and therefore the view's `titleFor(arg)` — **before**
`onEnter(arg)`. The storm detail view's `titleFor` assigns `storm = s` on its way
past, because the header names itself from its own argument. So **inside
`onEnter`, a comparison against the view's own current-storm variable is already
stale and can never detect a change.**

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

- **Row:** category swatch (§6, the same colour as the globe dot, so the list is
  its own legend) pinned to the name's line, then the name, then the category as
  a WORD at the right edge. Underneath: distance and bearing left, freshness
  right. Underneath that, when known, the trajectory.
- **The badge is neutral ink, never the category colour.** The swatch already
  carries the hue; tinting the badge says it twice, and would put Cat 1's
  `#FFE14D` at 0.73rem on the light theme's background where it cannot reach AA
  at any weight. Colour is the pre-attentive channel, text is the precise one.
  Measured in both themes: every element on the row clears AA, tightest 4.80:1.
- **The name is never truncated.** It is how you refer to the storm, how you
  match it to a forecast you heard elsewhere, and how a stranger arriving by
  shared link knows what they are looking at. It wraps; the badge stays on the
  first line.
- **One freshness slot, three tones, never moving.** Stale is amber (an update
  is overdue), silent is `--error` (the publisher has stopped), ended is
  secondary text (the quietest of the three — there is nothing to do). Each
  REPLACES the one below it: "26 hrs ago" on an ended storm reads as a late
  update on something still running.
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
  not responding — Northwest Pacific and Indian Ocean storms may be missing."
  Total: error state with Retry.

A WebGL canvas is invisible to assistive technology. The storm list is not a
hidden duplicate — those rot because nobody looks at them. It is one visible list
that is simultaneously the click target, the Tab order, and the screen-reader
view of the globe. **The canvas is `aria-hidden`; the list is authoritative.**

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
Category colour is the swatch and glyph, never the text colour (§6). For
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
number and reads as the forecast it is. `[DECIDE]` whether cone width folds into
that wording.

**5. Watch/warning block** — when in effect
```
IN EFFECT
■ Hurricane Warning
■ Tropical Storm Watch
```
§6 colours, deduped by type (§7). Never the word "advisory" for these. When none:
"None in effect." When the fetch failed: "Watches and warnings unavailable." Two
different strings, by design.

**6. What's drawn for this storm** — a SUMMARY plus a push into Layers.
**NO SWITCHES LIVE HERE.** Two controls for one layer means two places to look
when something is not drawing, and two places to keep in sync. There is exactly
ONE toggle per layer and it is in the Layers view. This section names what is
currently drawn for the selected storm and pushes there. The navigation is what
makes that cheap rather than annoying — Layers opened from a storm is a side trip
on the history stack, and Back lands on that storm's detail, not on the list.

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

> **OPEN:** the copy says "estimate" but not that the undercount varies by
> country. A Bay of Bengal figure is off by roughly four times in a way a Gulf
> figure is not, and nothing on screen says so.

---

## 45.8 Genesis — the drawer section

*The source is §45.2–§45.5 in `SPEC-DATA.md`; the globe layer is §45.4 in
`SPEC-MAP.md`.*

A second section under the storm list, headed **Being watched** with a count.
One row per area, ordered by probability across both sources:

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
deliberately small: a watched area has six facts and no geometry beyond the
patch already drawn. It states both horizons, the publisher's own issue time,
and — as provenance for a title the app computed rather than NHC published —
the centroid and the source's own basin word. It carries no advisory, no track
and no intensity chart, because the thing it describes does not exist yet.

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
