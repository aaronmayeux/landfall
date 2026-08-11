# NOW.md — what's in flight

> **TRIM/AUDIT TRIGGER: 300 LINES.** Past that, this file gets a full read and a
> cut list before anything else is added. A trigger, not a ceiling — the point is
> a periodic honest audit, never compressing a finding on the day it was made.
>
> **WHY 300 AND NOT §12's 700.** A source file is navigated by jumping to the
> part you need; this one is read front to back at session start. Past roughly
> 300 lines that reading turns into searching, and searching only finds what you
> already knew to look for — which is exactly backwards for the file whose job is
> naming the things you DIDN'T know about.
>
> **THE FIRST SCREEN IS THE PRODUCT.** `IN FLIGHT` and `NEXT UP` stay short
> enough to read at a glance, because this file's whole job is orienting the
> next session in its first minute. Length accumulates BELOW them.
>
> **An item leaves this file in exactly two ways.**
> 1. **It lands** — delete it here, and add one or two sentences to the relevant
>    spec file describing what *is*, not what happened.
> 2. **It dies** — delete it. No tombstone, no "investigated and dismissed".
>
> **Not a log.** No dates on things, no completed section, no history. If you want
> to know what happened, that's what `git log` is for.
> **Not a decision tree.** Keep an item to a line or two where a line or two is
> honest. An item needing several paragraphs is a spec entry wearing a TODO's
> clothes — write it in the spec and leave a pointer here.
> **Never a place to record a rule.** Rules go in SPEC.md.

---

## IN FLIGHT

**==> SHIPPED AND UNSEEN: THE STORM LIST ROW ONLY SAYS THINGS IT CAN SAY ABOUT
EVERY STORM ON EARTH. <==** As-built is `SPEC-UI.md` §16.

Aaron's rule: a column that cannot be filled for every global storm goes to
another surface. Wind and the trend word failed it and are gone from the row.

**THE FAULT LINE IS NOT NHC VERSUS GDACS.** `applyJtwcWind` writes the whole NHC
field set onto a matched GDACS storm, so it is MATCHED versus UNMATCHED — and
that moves storm to storm as JTWC picks systems up and drops them. Measured on
the archive branch 2026-08-10, NHC empty and four GDACS storms up: three matched
and complete, **DOLPHIN unmatched with none of it** — the strongest system on the
globe, 35 hours silent. Wind's old fallback printed its FORECAST PEAK in the same
column as everyone else's current wind, three times its neighbours' number and a
different quantity.

The row is two lines of contract — swatch, name, category badge / distance and
bearing, freshness — plus a third line off the warm cache when the forecast has
landed. Left edge identity, right edge classification and freshness, two columns
down the whole list.

**AND THE RANKING KEY WAS THE SAME BUG.** `windKt ?? peakWindKt` ranked Dolphin's
145 kt whole-life maximum above a measured 130 kt Cat 4. `representativeKt` now,
in both `data/merge.js` and the view.

**Judge on glass, in this order:**

1. **Three lines per row is TALLER — 55px for two lines, 74 for three.** Fifteen
   storms is roughly 870px of scroll against 580 before. That is the one call
   here that no measurement settles. If it reads as bloated, the third line is
   the thing to cut and the row survives without it by design.
2. **Does the ↘ / ↗ read as a direction?** It replaces the word "closing". It was
   invisible at first — 0.75 opacity on muted text, a 12px speck — and is now
   1.35em at full contrast.
3. **Does losing the wind number hurt?** "Cat 2" carries roughly the same fact,
   and the number is on the detail panel attributed to whoever measured it. This
   is the biggest subtraction in the pass.
4. **Two rows deep in the Finished group.** The divider is the only thing saying
   the live list ended; the rows keep full contrast because `lifecycle.js`
   already greys their swatch and stamps them.

**Verified without glass:** both columns align to the pixel across every row
shape (`tools/row-shot.mjs`), every text element clears WCAG AA in both themes
with 4.80:1 the tightest, and `tools/test-storm-row.mjs` is 21 assertions, all
four mutations checked. **Two of those mutations passed against the bug on the
first run** — DOLPHIN's real 35-hour stamp made it silent, and silence sinks a
storm before `sortStorms` ever reaches intensity, so the ranking assertions were
right for a reason that had nothing to do with ranking.

**Still open, not done here:** GDACS names reach the screen with their year
suffix — the row says `DOLPHIN-26`, because `data/gdacs.js` takes `eventname`
raw. `lib/advisory.js` already strips it for MATCHING and nothing strips it for
display. One line in the parser, but it moves map labels and the detail title
too, so it wants its own pass.


**==> SHIPPED AND UNSEEN: THE BACKDROP LIGHT NOW SMEARS ALONG THE RIM. <==**
As-built is `SPEC-MAP.md` §9.14.

Both themes are signed off on glass and the geometry is settled — this is the
last piece, deferred until the position stopped moving. The light was a round
pool, which is what a FLAT wall hit square on gives you. It is now an ellipse
stretched tangentially: along the rim, thinning across it, growing with how far
past the limb a storm has rotated. Same aim term that drives brightness, so the
elongation animates through the sweep at no extra cost.

Drawn by rotating and scaling the canvas around one radial gradient. Stacking
circles along an arc would have been the obvious alternative and is exactly the
overdraw this layer exists to avoid.

**Judge on glass:**

1. **Spin it, both themes.** Does the light now read as lying ON a curved
   surface rather than floating near the globe? That is the whole pass.
2. **Too stretched / too streaky?** `GLOW.smear` (1.4) down. Raising it without
   also raising `GLOW.squash` is what makes deep storms bloom.
3. **Too thin?** `GLOW.squash` (0.35) down.
4. **Watch a storm at the moment it clears the limb.** It should start round and
   draw out as it goes behind. A light that is already fully smeared as it
   appears means `smear` is too high for the visible band.

Nothing else is outstanding on this feature.

**==> SHIPPED AND UNSEEN: SLIDERS NOW NEED A THUMB GRAB, AND DRAWER CONTENT
FADES UNDER THE HEADER. <==** As-built is `SPEC.md` §10 and `SPEC-UI.md` §16.

Two touch complaints from Aaron, both about the settings sheet. Sliders were
being changed by people scrolling past them — a range input commits on the
PRESS, before any movement — so `ui/slider-grab.js` refuses any press that does
not land on the thumb. And the scroller's top edge cut rows in half; it now
carries an 18px mask so content thins out under the title instead.

**Judge on glass, in this order:**

1. **Scroll the settings sheet fast, with a thumb, past all four sliders.**
   Nothing should move. This is the whole point of the change.
2. **Then grab a thumb and drag it.** It must feel exactly as it did before —
   no lag on the first pixel, no dead zone, and it must still be grabbable when
   pushed all the way to either END of its range (that was the specific bug the
   new suite pins).
3. **Is 18px of fade right, and is the extra 18px of space above the first row
   acceptable?** `--scroll-fade` in index.html is the one number. If the gap
   reads as loose, the fix is to trim `.drawer-head`'s bottom padding by the
   same amount — but that also tightens the storm-detail stamp and the storms
   view's chrome, so look at those two before doing it.
4. **Desktop mouse pass.** The track no longer jumps to a click. That is
   intended and consistent with touch, but it is a real behaviour change on a
   pointer that never had the problem — say so if it annoys you and the guard
   can be made coarse-pointer-only in one line.

Keyboard is untouched by design, and a refused press still focuses the slider,
so tapping the track then arrowing works.

**==> SHIPPED AND UNSEEN: THE LIGHT THEME IS GREYSCALE, AND A THEME CHANGE NO
LONGER REBUILDS THE MAP. <==** As-built is `SPEC-MAP.md` §9.2 and the new §9.3.

The blue sea, cream land and blue sky are gone; so is the teal cage. Base is
neutral, storm colour is the only saturated thing on screen. Three fixes rode
along, each with its own reason:

1. **The washed-out mesh was a shared opacity, not a colour.** The seven
   Three.js material alphas were one set for both themes, but the materials
   blend ADDITIVELY on a night globe and NORMALLY on a daylight one — 0.3 is a
   bright line on black and 30%-of-the-way-to-white on white. They live in the
   palette now (`DARK.fx` / `LIGHT.fx`), all higher in light.
2. **`LIGHT.meshStormDeepen` (0.18) is the dial** if storms still do not pop.
   Raise it before touching opacity, which drags the resting cage up with it.
   Above ~0.35 the severity ramp collapses toward one dark colour.
3. **The install button is dark mode's `#F0B23C` in both themes now.** Fill and
   edge are separate tokens; the edge carries the 3:1 and is also the heading
   text, which cannot be yellow on white at any size.

**Judge on glass, in this order:**

1. **Does a storm read at a glance on the grey globe?** This is the whole bet:
   that removing every competing hue does more for severity than any amount of
   tuning inside the storm colours. If it does not land, `meshStormDeepen` and
   `LIGHT.fx.cage` are the two dials, in that order.
2. **Flip the theme with a storm selected and watch the cone and tracks.**
   Nothing should flash and nothing should stay dark. This is the riskiest part
   of the change: `installOnStyle` used to re-bake the app's own layers as a
   side effect of the style teardown, and now nothing tears down. Model
   guidance re-pushes explicitly; if a guidance line keeps the old theme's
   colour, that is the wire to check.
3. **An ENDED storm's grey head.** It used to read as "different" against a
   teal globe. Everything is grey now, so it leans on weight and on the live
   storms beside it being vivid. Untested by anyone.
4. **The whole thing at phone width in daylight.** The ocean was deliberately
   held at mid-grey rather than the near-white of the reference image, because
   near-white leaves a Cat 1 nothing to sit against. If it reads as too heavy
   outdoors, that trade is the thing to revisit.

**None of it is verified on a real basemap.** The sandbox cannot reach
`tiles.openfreemap.org`. What IS verified: the generated style validates clean
against maplibre-gl 5.6.0's own style spec in both themes and both tile schemas,
and `tools/test-theme-state.mjs` (new, 510 assertions) proves the style is
byte-identical between themes outside its `state` block.

**==> AND THE FIRST CUT OF IT CALLED A METHOD THAT DOES NOT EXIST. <==**
`map.setGlobalState()` is on the STYLE, not the Map. It threw, so the basemap
kept its colours until a reload and the two repaints after it never ran. Every
check in the repo passed — none of them could see a plausible name that MapLibre
does not expose, which is the single most likely mistake to make against an API
this size. `tools/test-maplibre-api.mjs` is new and closes it: every `map.X(` in
the app is checked against the vendored bundle, plus an explicit list of methods
that are real but on the wrong object. **Its known limit is written into its
header — a real method on the wrong class only fails if it is on that list.**

**==> SHIPPED AND UNSEEN: EVERY RELAY ROUTE NOW REBUILDS ITS CACHE HIT, AND
GDACS FINALLY REPORTS ITS OWN AGE. <==** Eight routes converted, three left
publishing a cache directive on purpose, `SPEC-OPS.md` §17.7. GDACS was stamping
the storm list with the phone's clock, so the "GDACS feed delayed" branch was
unreachable code and NHC was silently the only feed that could raise the banner;
`data/gdacs.js` reads the relay's header now, same as `data/nhc.js`.

**Judge on glass, in this order:**

1. **Does the delayed banner ever fire wrongly now?** The false-alarm ceiling
   went from 90 minutes to 60 with the third clock gone, so it has real margin —
   but GDACS can raise it for the first time ever, and a source that has never
   been able to complain is a source whose complaints have never been seen.
2. **`X-Landfall-Cache` on any relay response** names which of five layers
   answered. Never opened. One header read answers questions that have cost
   whole sessions of inference.
3. **Whether the warm store's key count comes back down.** `KEY_TTL_SECONDS` is
   48 h, so dead storms' keys should drain within two days of a storm ending.
   `GET /api/nhc/inspect?warm=1&key=...` now answers this in one screen: one row
   per route family, and `staleOverTtl` should read **zero**. It read 184 keys
   with the oldest 12.3 days on 2026-08-07, which is what the expiry is for.

**==> SHIPPED AND UNSEEN: THE WHITE RING ON EACH STORM'S FIRST FORECAST DOT. <==**
Marks which end of a track is the future. As-built is `SPEC-MAP.md` §7.5.

White at 3 px against the dark 1.5 px every other dot wears. **Two things have
now been tried against it and reverted on glass:** equalising the widths (at
1.5 px the white stops carrying) and a dark casing disc under the ring (it read
as a BLACK ring, in both themes — the outermost edge is what the eye calls the
stroke). Both settled; do not re-run either.

**It was black for three deploys and the cause was not the colour.** A
`global-state` reference in a DATA-DRIVEN paint property is evaluated in
MapLibre's worker, which never receives the global state, and `to-color` of the
missing value is black — silently, in both themes. `circle-stroke-width` beside
it, the same `case` on the same `_first` with plain numbers, worked the whole
time; that asymmetry is what finally named it. The two ring inks are identical
in both palettes, so the ring bakes them from `palette()` now.

**The rule is in `map/theme-state.js` and enforced by
`tools/test-app-layer-state.mjs`:** a `gs()` may not appear in an expression
that also reads feature data. Worth knowing that `tools/test-theme-state.mjs`
could never have caught this — it walks `buildStyle()`, and the app's own layers
are added imperatively and are not in it.

The open question is unchanged: does it read as *start of forecast* rather than
a second storm marker, since the glyph sits roughly 40 nm away.

**==> SHIPPED AND UNSEEN: THE CONE IS MEASURED AND REDRAWN ON THE TRACK. <==**
Third attempt and the first one that reaches the map. Walk the smoothed track,
measure how far the published cone reaches left and right at each step, smooth
those two numbers, redraw the edges on our own curve. Every width is the
source's; the only change is what it is measured from. As-built is
`SPEC-MAP.md` §7.9.

**Judge the flanks on a recurving storm.** On a nearly straight forecast it
should look almost unchanged — a straight track's cone genuinely is
straight-flanked. Measured: longest straight run 2.84° → 0.91° on a 70° recurve,
area within 0.2% of published.

**If it declines, it now SAYS SO** — one console line per storm. The first two
attempts fell back silently, which looks exactly like running and being no good,
and that is what cost two rounds.

**==> A WRONG MEASUREMENT COST A WHOLE DESIGN. <==** The second attempt was torn
down on a reading that published cones are 43% lopsided about their own track.
They are not — symmetric to within 1 km. It was a sign error in my own
ray-segment test, which never errored and always returned a plausible number.
The same broken ray was inside the design it condemned. Nothing to do now; it is
here because the lesson is not about cones.

**The dial is `CONE_SWEEP.blurDeg`,** currently 2.5°. It is the only thing
deciding how smooth the cone looks — lower it and a wobble appears, raise it and
the cone stops tracking its own taper. Worth a look on glass before touching.

**==> SHIPPED AND UNSEEN: THE APP REPLAYS HURRICANE IDA, AND IT IS THE APP.
<==** `/?replay=ida`. Not a mockup and not a second renderer — the real globe,
the real dive, the real drawer and the real home dashboard, fetching Ida's
published bytes through the real data path. `replay/boot.js` points
`ENDPOINT.relay` at `/api/replay/<iso>/…` and shifts the clock; nothing else in
the app knows.

**WHAT IS ON SCREEN IS NHC's.** 35 advisories of forecast track, published cone,
forecast points, wind radii and **watch/warning lines**, plus the best track cut
at the replay clock for the past tier. `samples/ida-al092021/gis/README.md` has
the layout and the two slots that are assembled rather than served.

**==> AND IT CORRECTS A CLAIM THIS PROJECT HAS REPEATED THREE TIMES. <== The
watch/warning GEOMETRY is not live-only.** MapServer layer 8 is; NHC's GIS
archive publishes the same coastal lines with every advisory and always has.
"Our usual source cannot answer" had been read as "the data does not exist",
and it put a Phase-B feature behind a storm that never needed to come.

**==> THE REPLAY'S FIRST GLASS READ FOUND THE CHART HAD NEVER HAD ITS COLOURS.
<==** `ui/chart-home.js` fills the 34/50/64 kt bands and draws the home line
from four CSS custom properties — `--kt34`, `--kt50`, `--kt64`, `--coast-glow`
— and **nothing in the app declared any of them.** An unresolved `var()` in an
SVG presentation attribute does not warn and does not fall back: the property
reverts to its initial value, and `fill`'s initial value is BLACK. So the hero
of the home dashboard drew three black shapes on a dark globe, and the reader's
own house — the line every other figure is measured against — was not drawn at
all.

**It survived because the only place the chart could be looked at was
`mockups/home-corridor.html`, which declares its own copies because it is a
standalone page.** The one context that could not show the bug is the one
context it was signed off in. All four now come off `WIND_BAND_COLOR` and
`palette()` in `applyTokens()`, and `tools/test-css-vars.mjs` (new) fails if
any fallback-less `var()` in the app is never declared. Both mutations checked.

**AND THE GENESIS SECTION WAS PAINTING 2026 ONTO 2021.** `data/genesis.js` held
the last two hardcoded `/api/...` paths in the app, so on the replay they kept
asking the live endpoint while everything else was pointed at the archive — a
present-day hatched area with a percentage on it, sitting on an August 2021
map. Both go through `ENDPOINT.relay` now. **Imagery still does not**, and
there is no archived satellite or radar to point it at, so turning those on
during a replay shows today's sky over Ida.

**==> THE SECOND GLASS READ REDREW THE TOP OF THE CHART AND FOUND FOUR MORE.
<==** The home line is no longer overstruck with the wind's colour — Aaron's
call, and the cost is stated in `SPEC-UI.md` §8. **A wind rail above it carries
what the stripe could not**: one bar per threshold that reaches the house, when
it arrives, how long it stays, `≥` where the duration is a floor, and a chevron
where the bar outlives the frame. A dotted vertical marks now.

Four bugs found while doing it, all live in production rather than replay-only:

1. **The track walked three hours BACKWARDS on every intermediate advisory.**
   NHC's tau 0 is the synoptic analysis and the advisory is issued up to three
   hours later, so the first forecast point predates the position beside it.
   Measured on Advisory 7A: fifteen samples at negative time and a chart
   painting to x=19.9 in a plot starting at x=30. **`SPEC-UI.md` §8 already
   stated the NHC behaviour and nothing acted on it.**
2. **"reach your home for null."** A window can have no length at all — Ida
   inland, the house 27 nm inside her 34 kt field, radii published at one hour
   only. Neither "no time" nor "at least an hour" is true; the forecast simply
   does not say. `windDurationClause()` owns the preposition now.
3. **"landed within 0.0 mi of that."** The cone table tapers to zero at zero
   hours, so a pass happening NOW rendered a zero-width error band. There is no
   forecast left to put one on.
4. **The countdown rail ran 4 px left of its own dots** — the list's own indent
   counted once for the thread and twice for the nodes.

**And the dots carry the chart's colours now** — wind rows in their threshold,
the closest pass in the storm's category at that moment. Two scales on one
list, which is Aaron's call made knowing it.

**THE WHOLE SCREEN SPEAKS TO THE READER NOW.** Second person throughout,
present tense where the thing is present, nothing softened. The voice rules are
in `SPEC-UI.md` §8 so the next edit does not drift. The chip is a ten-rung
ladder (`dash.stage`) instead of two words, and `track-unknown` finally
separates "not closing" from "cannot say" — which every GDACS storm had been
losing.

**Judge on glass, in this order:**

1. **The wind rail.** It is new and nobody has seen it. Do three labelled bars
   above the home line answer "when does it arrive and how long does it stay"
   at phone width, or is it a second chart competing with the first?
2. **The corridor chart, now that it has colours at all.** Nobody has ever seen
   it outside a mockup. Three nested translucent bands on a phone, with the
   home line in the coastline's cyan across the top.
3. **Does a Cat 4 read on the globe?** Nothing in this app has ever had a 130 kt
   storm on it. The severity ramp above Cat 2 is untested by observation.
2. **The cone, the swath and the warnings together at basin zoom.** Three
   translucent things over a coastline is the densest this map ever gets, and
   Bertha was too weak to produce it.
5. **Scrub from advisory 8 to 15 and watch the cone shrink onto the house.**
   That is the sequence the whole home screen exists for.
6. **`?replay=ida&play=1`** steps every six seconds. Does it read as weather
   arriving, or as a slideshow?

**==> THE MAP'S IMAGERY IS STILL LIVE, AND ON A REPLAY THAT IS MISLEADING.
<==** Satellite and radar do not route through `ENDPOINT.relay` and there is no
archived imagery to point them at, so switching them on during a replay paints
TODAY's radar echoes over a 2021 hurricane — green cells over Louisiana that
look exactly like Ida's rain and are not. Seen in a screenshot. The honest
options are to suppress imagery in replay mode with a stated reason, or to find
an archive; doing nothing is the one option §5 rules out.

**Known and deliberate:** seeking RELOADS the page, because repointing the relay
mid-flight would do nothing until the app's next poll and would look broken for
a minute. Surge is absent because the app cannot draw it. The detail panel has
geometry but not the forecaster's words — the text fixtures exist and nothing
joins them yet.

**`tools/test-replay.mjs` is 77 assertions and it found a real one:** the relay's
`fail()` was spreading the HTTP status into the HEADERS, so every bad request —
a malformed clock, a bin from another basin — answered 200 with an error body.
`data/relay.js` only inspects the status, so all of them would have been read as
success.

## NEXT UP

**==> SHIPPED AND UNSEEN: THE HOME DASHBOARD, AND ITS HERO IS NOW THE WIND
CORRIDOR. NOBODY HAS LOOKED AT ANY OF IT ON A PHONE. <==** As-built is
`SPEC-UI.md` §8. `SPEC-HOME-PLAN.md` is down to Phase B and three glass calls.

Home was a setup screen; it is a single-storm dashboard now, setup is an "Edit
home" corner, and the globe glyph opens it. The hero went through two rounds:
linked strength/distance lanes, then this.

**THE CHART IS FLIPPED — HOME IS THE LINE AT THE TOP AND THE STORM RISES TO
MEET IT.** Aaron's call. The reason that made it right is that the closest
approach becomes a SUMMIT instead of the bottom of a V, and a low point reads
as the safe moment on every chart anyone has ever seen.

**THE BANDS ARE THE WIND, NOT THE STORM.** 34/50/64 kt, each measured toward
the house along the bearing that points at it, nesting, and the home line wears
that colour for the hours the wind is on it. The strength lane was cut: the
storm's own wind is not what you feel.

**Judge on glass, in this order:**

1. **Does the inverted axis read, or do you re-check which way is closer?**
   Everything else here rests on that.
2. **Do three translucent bands stay legible on a phone in daylight?** On
   `/mockups/home-corridor.html`, which is now THREE REAL STORMS — the
   fabricated Cat 3 is retired. Ida's Advisory 12 (all three fields on the
   house, 18 h out), Advisory 14 (nearly overhead, everything crushed into the
   ceiling, and a 64 kt stripe down to 50 minutes) and Bertha for contrast.
3. **Is the coloured segment on the home line strong enough** to carry "the
   wind is on your house right now"? The band above it is clamped at zero and
   cannot show depth, so that stripe is doing all the work.
4. **Does the dashed amber read as a hedge rather than a second forecast?** It
   is the only figure on the screen neither NHC nor GDACS publishes.

**THE MEASUREMENT THAT JUSTIFIES THE WHOLE SCREEN.** Bertha's Advisory 10
predicted a 31.6 nm closest pass to a New Orleans home. She actually passed
**16.8 nm** away. Across ten advisories every point estimate was roughly twice
too far out — and **every one of them had the truth inside its two-thirds
band.**

**==> IDA HAS BEEN RUN AND SHE FOUND FOUR MORE, ALL FIXED AND ALL
MUTATION-CHECKED. <==** `samples/ida-al092021/` is her whole advisory record
verbatim, the Tropical Cyclone Report's text, the 2021 cone table and the
Census record for the house; `tools/test-home-ida.mjs` is 163 assertions
against those bytes.

1. **`closestApproach()` reported the best of eight samples, not the minimum.**
   On Ida's Advisory 12 that is **5.4 nm too far out and 39 minutes early** —
   she is forecast to pass 0.2 nm from the house and the screen said 5.4. The
   distance error only ever runs one way, too far, which is the unsafe
   direction. It was wrong on Bertha too, by 0.3 nm and 28 minutes, and
   `SPEC-UI.md` §8's claim that it agreed "to 0.2 nm and under a minute" was
   simply false. Refined by ternary search now; both suites check it against a
   200,000-step brute force rather than a pasted number.
2. **The countdown ran backwards.** Rows were pushed in source order, so on any
   storm whose wind outlasts its pass the list read 12 hrs, 16 hrs, 21 hrs,
   18 hrs. Live on Bertha as well, never looked at. **This is the surface a
   screen reader has instead of the chart.**
3. **The chart's `aria-label` understated an open-ended window** — "for about
   5 hours" beside a countdown saying "at least 5 hours" about the same window,
   and "for about under an hour" on a short one.
4. **The headline shipped reading "for at least about an hour"**, because the
   hedge was written in two places. One builder now, `windDurationPhrase()` in
   `lib/wind.js`. **The first mutation run did not catch this one** — neither
   Ida advisory lands in the one-hour bucket — so the phrase itself is now
   tested at every bucket and both hedges.

**AND THE CONE TABLE IS PER-SEASON.** `CONE_CIRCLE_BY_SEASON` holds 2021 beside
2026 and a storm reads the table in force during its own season. Not cosmetic:
2021's 36 h circle is 55 nm against 2026's 49, and 2021 publishes a 3-hour row
2026 does not. `tools/test-home.mjs` now goes red from 1 July if the newest
table predates the season — the check SPEC-HOME-PLAN said was missing.

**WHAT IDA SAID ABOUT THE FORECAST, AND IT IS NOT WHAT BERTHA SAID.** Advisory
12 put the centre 0.2 nm from the house; it really passed **11.3 nm** away, 14
minutes later. Bertha's every estimate was twice too far out; Ida's was 11 nm
too CLOSE. The only claim that survived both storms is the one the screen
makes: **the truth was inside the two-thirds band**, here with 23 nm to spare.
The nearest anemometer to the house, 8 nm away at Gonzales, measured 41 kt
sustained gusting 65 against a forecast of five hours of hurricane force —
which is not a like-for-like comparison and is written up as such in the
sample's README.

**FOUR EARLIER BUGS THE BUILD FOUND, all fixed, all of the same family — a boundary
sampled too coarsely, or a value carried past where it was published:**
snapping the ring crossing reported it 69 minutes LATE; the forecast peak
missed a storm peaking right now; the last published wind radii were **smeared
across every later leg**, drawing tropical-storm winds through hours NHC
forecast none for (found by a mutation run, not review — the smeared values
looked right because the bearing kept changing); and a wind window still open
when the radii stop reported `everInside` beside a duration of **zero**, which
renders as "hurricane-force winds for under an hour" (found only by the
fabricated Cat 3).

**ONE THING WE EXPECTED TO SHIP AND CANNOT.** The gap between a warning being
issued and the winds arriving — 38 hours for Bertha — is the most actionable
number in the whole archive and is **not computable in the app**. Layer 8
carries what is in force, not when it was issued, and nothing stores advisory
history on device. That, not the chart, is what "forecast churn" would need.

`tools/test-home.mjs` is 168 assertions, all mutation-checked. Including one
whose only job is that **an outage never renders "All clear"**.

**==> THE TELEMETRY WAS LYING AND IT IS NOT ANYMORE. READ THIS BEFORE ANY OTHER
NUMBER IN THIS FILE. <==** `timings_ok` has collected real values. **Only rows
where it equals 1 are measurements.** Everything below is that slice, 2026-08-07,
94 sessions across 20 devices:

| | iPhone | Android | Linux | Mac | **Windows** |
|---|---|---|---|---|---|
| Boot veil lifts | 1,158 | 1,209 | 829 | 596 | **2,764** |
| Storms on screen | 2,132 | 2,219 | 1,279 | 799 | **4,670** |
| Blocked | *(blind)* | 430 | 884 | 17 | **3,210** |
| Worst tap | 18 | 115 | 146 | 45 | 131 |

**1. WHAT WINDOWS IS DOING FOR 3.2 SECONDS. NOBODY HAS LOOKED, AND IT IS NOW THE
ONLY REAL PERFORMANCE PROBLEM LEFT.** 21 clean sessions across **7 stranger
machines**, so it is not one weird PC. Worst single session: **29,604 ms** of
blocking. Everything else on the table clears its bar; this does not.

**2. WHAT A MAPLIBRE FRAME COSTS — STILL UNMEASURED, AND STILL THE GATE.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint. **Moving water pays it too**, at map
zoom, via `triggerRepaint()`. Measured: drift pinned, zero MapLibre renders per
second; unpinned, one per frame. **Nobody has measured what one of those frames
costs**, and it needs a real device with a real basemap — the sandbox has no
tunnel to one. The four rules the fix has to follow are written out in
**SPEC-MAP.md §9.7** — measured in the Deep prototype before it was cut, kept
because the problem is Landfall's. Prime suspect for item 1.

**HALF OF IT IS ALREADY GONE AND IT WAS THE FREE HALF.** Past `DIVE.zHandoff` the
loop used to schedule a frame anyway and throw the reading away. It stops now;
`tools/test-idle-drift.mjs` asserts the frame counts. **This does not touch the
repaint above**: `setCenter` is what `map/globe-follow.js` mirrors, so it is also
what makes the visible rotation happen and cannot simply be skipped.

**3. THE BOOT SCREEN IS NOT A FOUR-SECOND PROBLEM ON A PHONE.** `perfMark('globe')`
and `boot.done()` are the same moment in `main.js`, so `t_globe_ms` **is** the
veil lift — and on real hardware it is **1.2 s on iPhone and Android**. The 3,982
ms figure came from `tools/load-probe.mjs` at 4x throttle and was never a user
number. Windows' 2,764 ms is item 1 wearing a different hat.

The 4096x2048 land texture is still **511 ms in `texImage2D` plus 202 ms
rasterising** on every cold load (`tools/boot-profile.mjs`). Worth removing, on
memory and retheming grounds as much as speed — but it is **not urgent and not
user-facing**, and the answer is filled triangles (SCOPED, below), not a smaller
canvas. `claude/backlog.md` has the measurement that kills halving it.

*Two dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck (3982 ms healthy vs 3807 ms unreachable), and preloading was
measured and rejected (see `_headers` and the probe's `--preload` switch).

**4. GDACS IS STILL THE FEED THAT LEAVES PEOPLE ON A SPINNER, THOUGH LESS SO.**
41 of 46 GDACS loads reached `ok` against NHC's 44 of 46. **Zero errors either
side — the misses are sessions that ended still loading**, not failures. Retry
has been pressed **zero times in 193 sessions**, so that recovery path has never
been exercised by a real user. **Two things have landed since these numbers were
taken and both should move them, so re-read before acting:** the stamp fix, and
the two-second rung — a session that used to sit on "Checking the oceans…" for a
minute now says something at two seconds, which is the likeliest reason nobody
ever reached the retry button.

## HELD FOR WEATHER

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. Detection is client-side; the app must
be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

## SCOPED, NOT STARTED

**==> TWO FEATURES ARE SPECIFIED AND WAITING IN `SPEC-NEXT.md`. <==**
The intensity chart (§46) and the environment ribbon (§47). Endpoints fetched
live, field names transcribed from the real schemas, open questions written
down. Read the section, not this line.

**§45, genesis areas, HAS SHIPPED** and has left `SPEC-NEXT.md`. It is
§45.1–§45.3 and §45.5 in `SPEC-DATA.md`, §45.4/§45.6/§45.7 in `SPEC-MAP.md`,
and §45.8 in `SPEC-UI.md`. The app no longer says "all clear" while NHC is
publishing an 80% chance of formation.

**ONE THING ABOUT IT IS STILL OPEN, AND IT IS A GLASS CALL.** The data is
tested (`tools/test-genesis.mjs`, 69 assertions against real archived bytes)
and the failure states are pinned. What no tool can answer is §45.7: does a
hatched sand patch read as *nothing here yet*, or does it read as a
storm-shaped thing and undo the app's clearest signal — that a coloured blob is
a real cyclone? Judge it on a phone, at planet zoom and at basin zoom, in both
themes, with a real storm on screen beside one. Two related things to look at
while you are there: whether Low, Medium and High are distinguishable *without*
reading the number, and whether the section earns its space with several storms
up (it collapses by default when any storm is present, and that threshold is a
guess).

**A known cosmetic, not a bug.** Two areas in the same third of the Atlantic
both title as "Central Atlantic" — measured live, the 40% and 20% areas sat ten
degrees apart. The rows are distinguishable by their percentages and the area
panel carries the coordinates. No compass scheme separates two areas that are
genuinely in the same place; naming them apart would mean inventing a
distinction NHC did not publish.

**THE 3D LAND FILL SHOULD BE SHAPES, NOT A PICTURE.** `landTexture` still
rasterises a 4096×2048 canvas and hands it to the GPU; draft-then-upgrade moved
that cost off the first frame but did not remove it. Feeding `RINGS` to the GPU as
filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU memory,
drops the resolution ceiling, and turns retheming into a recolour. Known traps:
rings-inside-rings for inland lakes, the antimeridian with Antarctica worst, and
flat triangles cutting chords through the sphere. `earcut` (~10 KB, no build step)
does the triangulation. **Not during cyclone season, and not in the same pass as
the engine upgrade** — both are surgery on `map/globe3d.js` and two at once makes
a break impossible to attribute.

**==> THE THREE-GLOBE EXPANSION IS GONE FROM THIS FILE BECAUSE IT IS GONE FROM
THE ROADMAP. <==** Cut 2026-08-08. Landfall is a tropical cyclone app. The whole
tree as it stood — Deep, Surface, the volcano and ash pipeline, `SPEC-GLOBES.md`
and `SPEC-HAZARDS.md` — is on the **`worlds`** branch and the **`worlds-v1`** tag.
Nothing was lost. It is simply not what is being built.

**One consequence worth knowing: the three.js r128 → r182+ upgrade is no longer a
gate on anything.** It only ever gated §41–§43's effects. It is now an ordinary
maintenance item — do it when there is a reason, not because something is waiting
behind it.

## KNOWN AND ACCEPTED

- **The dead-code sweep found no dead FILES and 21 dead exported NAMES.** All 106
  modules are reachable from `main.js`. Four of the 21 were `data/volcano-live.js`
  and went with the Deep rip; the two surge formatters belong to Phase 6 step 3
  and stay. `_normalizeNhcStorm` and `_drainForTest` are test seams whose tests
  are gone. **The three worth a second look are eviction functions nothing
  calls** — `evictTcgpIndex`, `evictCarq`, `forgetBand` — three caches that can be
  filled and never emptied. That is a memory question, not a tidiness one, and
  nobody has asked it. **Re-run the sweep**: the rip deleted ~42 modules, so the
  remaining count is stale.
- **Three suites need Playwright and do not run in a bare sandbox**, which is
  expected rather than broken. They DO run once `node_modules` is on the path.

- **iOS's "one in five sees nothing" WAS BACKGROUNDED TABS, and the item is
  dead.** Not one session of 312 is missing `t_globe_ms` — null or zero, any
  platform. What produced it: **22 of 71 iPhone sessions are `timings_ok = 2`**,
  20 of them hidden from the first frame, averaging **322,440 ms** to storms.
  Those rows poisoned every iPhone average this project ever computed. iPhone's
  real position is second fastest. **Filter on `timings_ok = 1` or repeat the
  mistake.**
- **The old Windows numbers were the same artifact and are superseded.** 8.8 s to
  storms and 43-of-62-are-Aaron's came from the unfiltered table; the clean slice
  is in NEXT UP item 1. The disease is real, the size of it was not.
- **Tap responsiveness is fixed and the item is closed.** Every platform is under
  the 200 ms bar on clean rows — worst is Linux at 146 ms, against 376 ms before
  the five fixes. `tools/test-recompute-budget.mjs` holds the counts.
- **iOS's clean long-task numbers are an instrumentation gap.** All 26 WebKit
  sessions report `longtask_n = 0` because WebKit does not implement the
  observer. `ttfb_ms`, `mem_gb` and `conn_type` are blank on WebKit for the same
  reason. Do not read any of those columns as "iPhones never block".
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
- **`X-Landfall-Empty` DOES NOT EXIST.** `claude/backlog.md` logs it as a header
  written but never read. Searched the whole repo 2026-08-07: there is no such
  string anywhere. The backlog entry is stale, not a finding.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength
  comes from GDACS's own `severitytext` classification; the alert level is parked
  unrendered in `raw`. Logged because the question keeps getting re-asked, not
  because anything is open.
