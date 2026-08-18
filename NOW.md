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

**Everything under this heading is BUILT, DEPLOYED AND UNJUDGED.** The as-built
description is in the spec section named beside each one; what is here is only
the question a tool cannot answer.

**A JTWC watched area's patch now changes with its risk word.** `SPEC-MAP.md`
§45.4. The patch layer read `globeRisk`, which only NHC areas carry, so every
JTWC area drew with the Low hue, the loosest hatch and the weakest fill no matter
what the bulletin said — under its own label reading "High" in the High color.
Now `globeRisk ?? risk`, the same expression every other surface already used.
**Judge: when a Western Pacific area next goes Medium or High, does the patch
step visibly and match an NHC area at the same rung.** Both live JTWC areas are
genuinely Low right now, so there is nothing to see until one moves.

**A warning drawn where there is no coast now admits it.** `SPEC-MAP.md` §7.10,
`SPEC-DATA.md` §4.8. Lala's watch and warning for the Northwestern Hawaiian
Islands fell back to NHC's raw breakpoint chord — correctly, the atolls are below
what the basemap carries — but drew it in the coastal stripe's own paint, so a
guess looked exactly like a measurement. Unbanded products are now a thin dashed
chord with an open ring on every breakpoint; surge reaches got the same
treatment, since they band through the identical code. Retuned once on glass: the
first pass read as another model track, so the chord now carries the forecast
track line's weight with longer marks and shorter gaps than `modelDash`, and the
rings grew to sit between their old size and a forecast point. **Judge: with the
model tracks layer ON, does the chord still read as a government order rather
than as a sixth model line, and do the rings read as places rather than as
storms.** Lala is live and out there now.

**The environment ribbon paints a cone the rebuild refused to redraw, confirmed
on Lala.** `SPEC-MAP.md` §7.9, §47.5, `SPEC-UI.md` §47.9. Judged on glass and
corrected twice in the same pass — the ribbon sat a few pixels off the cone, and
a fold cut a black wedge across the inside of the right-hand curve. Both fixed,
both confirmed. Ida corpus: 35 of 35 advisories color, 100.0% of cone area,
nothing outside the drawn outline. Nothing left to judge on the ribbon itself.

**The colored forecast line now uses the cone's own ramp.** `SPEC-MAP.md` §47.5.
It carried a separate lifted ramp so it could never dissolve into the sea, which
worked and compressed the whole journey to do it — on Lala the fill read as a
gradient and the line read as one flat color across the same stretch. The floor
is a per-color lift now: the cone's exact hex wherever it clears 3 : 1 against
the ocean, blended toward the ramp's far end only where it does not. `envRampLine`
is retired from both palettes. **Judge whether the line and the fill now read as
one statement** — above the crossover they are the same pixel value, and below it
the line still refuses to reach zero.

**Two things still unseen.** A very tight bend: the pinch replaces a stretch of
the inside edge with a corner, so somewhere tighter than Lala's turn the color
should meet itself at a point rather than following the cone edge round.
Invisible on Ida and on Lala; if a flat spot ever shows, the answer is to walk
the ring's arc there the way the caps do. And **the hostile end of the line has
still never been seen** — every storm judged so far has been favorable, so the
lift has only ever been exercised in arithmetic.

**The archive now holds NHC layers 6 and 7.** The cone and the forecast track are
the rebuild's only two inputs and neither was ever snapshotted, so this entire
investigation ran against Ida's 2021 capture and could never be confirmed on
Lala. Next cone question is answerable on the actual storm.

**The Environment section's legend now disappears with the layer switch.**
`SPEC-NEXT.md` §47.11. Confirmed on glass. Nothing left to judge.

**Rainfall is on two surfaces and neither has been seen.** `SPEC-DATA.md`
§48.1–§48.7, `SPEC-UI.md` §48.8–§48.10. The storm drawer shows NHC's own
rainfall paragraph between `Wind field` and `Environment`; the home drawer
answers how much falls on the house, under `Where it is`. **THE ONE THING TO
JUDGE FIRST IS §48.10, AND IT NEEDS A STORM NEAR HOME.** Lala's advisory says
8 to 12 inches across eastern Maui while the grid at Kahului says 2.91 — both
correct, and a reader seeing both will think the app is broken. Two things are
built for that and nothing else: the home section is worded about the HOUSE,
and its last line names the point NWS is forecasting for. Whether that is
enough is yours. Then: does a rainfall total read as frightening or as trivia
beside the wind numbers — eleven inches is catastrophic and looks like a small
number. Does a live Flash Flood Warning above the total read as urgent, or does
it just make the section taller. On a storm with no land threat, does *NHC
lists no land hazards for this storm* read as reassurance or as a missing
feature. And outside NWS coverage, does an always-visible "no rainfall forecast
here" earn its space or become furniture — that is the direct cost of §48.5's
decision and only glass can price it.

**Two corners of rainfall nothing has exercised.** The `no_hazards` path — a
storm publishing `None.` — is proven against a SYNTHESISED product, because no
real bytes were ever captured (§48.11 says so in the spec). And a house outside
NWS coverage has never rendered: the 404/400 pair is asserted from the Nassau
fixtures, but nobody has set home in the Bahamas and looked.

**The no-home screen no longer promises something the app does not do.** It
said your coordinates never leave this device. That was already strained by the
reverse lookup that names a dropped pin, and rainfall settles it — asking how
much rain falls on a house means sending the house. It now says the home is
stored on this device only, no account, nothing that names you; both lookups
send a rounded point (two decimals here, three for `/api/reverse`) and
telemetry still carries no coordinate at all. Judge the new sentence: it is
weaker than the old one and it is true, which is the trade.

**Three Retry buttons on the storm panel were each doing two things.** The
generic geometry binder excluded `data-retry="advisory"` BY NAME, so `people`
and `environment` — both added since — were firing their own recovery AND a
full map-geometry refetch on one tap. It excludes the attribute now, so the
next scoped section is correct on the day it lands. Nothing to judge; noted
because it means those two retries have been doing extra work for weeks.

**The environment ribbon is judged on glass and four things about it are still
open.** `SPEC-MAP.md` §47.5, `SPEC-NEXT.md` §47.8, §47.11, `SPEC-UI.md` §47.9.

**Only the FAVORABLE end has been seen.** Lala's environment is +12, so the
colored forecast line was judged bright. The line and the cone deliberately do
not match at the hostile end — the line runs on a lifted ramp so it can never
fall into the sea, while the cone keeps its full range and does. Nothing has
shown that gap yet. The question when a hostile storm arrives: does a mid-violet
line inside a nearly-black cone read as one statement or as two? If it reads as
two, the dial is `envRampLine`'s first stop, not the cone's.

**Two figures lost their verdict-hour value and one caveat lost its voice.**
Room to grow and the storm's own structure are still said in sentence three, at
the fix; what they are worth at the verdict hour — days later, on a very
different storm — is gone. Neither can go back into the grid, whose one claim is
that its cells sum to the colored total. Gone with them: the line explaining why
a ribbon stops mid-cone when a run's positions end before its winds (§47.6's
fourth case). The ribbon still stops honestly; nothing now says why. Judge
whether either absence is felt on a storm that has the shape.

**A question that is Aaron's, not a bug.** §47.2 says a slice is drawable where
a wind AND a position both exist; §47.10's numbers were measured against
positions alone, and on EP9326 the two answers differ by 22 kt. The parser
applies §47.2 and carries both ends, so changing the rule is one line in the
layer. No live storm exercises the disagreement.

**The dateline path is written and has never run against a real seam-crossing
storm.** The ribs come back unwrapped past ±180 and the forecast points arrive
wrapped, so anchors are moved onto the stations' branch before anything is
measured; a synthesised seam case reproduces a real storm's ribbon exactly. LALA
is a CP storm already out at 172.7°W, so the first real exercise is probably
weeks rather than seasons away. If a cone crossing 180 ever comes out with its
colors crowded into the near end, that is this.

**The Environment section has been judged on a phone and is good, with two
corners nobody has looked at.** `SPEC-NEXT.md` §47.8. It has never been seen on
a GDACS storm, where the whole section is replaced by "Not published for storms
in this basin" — the question there is whether that reads as a fact about NHC
or as our failure. And it has never been seen at desktop width, where the
figures grid opens out to three or four columns instead of two; the dial is the
140px minimum in `.detail-env-figs` (`ui/panels.css`).

**A GDACS storm's panel says three new things, and its name says one thing
less.** `spec-parameter.md` §34.1, §35.1. The year suffix is stripped at ingest
(DOLPHIN, not DOLPHIN-26 — list row, map label, detail title together); a
`Forecast by` Vitals row names the real forecast office (`JTWC · via GDACS`);
and a storm JTWC has no warning on now shows `Winds 32–49 kt · estimated from
wind field`, bracketed from which of its own current wind bands contain its
centre — verified against all seven live storms off the archive, coherent with
GDACS's class on every one. Judge on glass, on a JTWC-unmatched storm: does
"estimated from wind field" read as honest provenance or as hedging noise
beside the crisp `Forecast peak` row under it; does `Forecast by` earn its line
or restate what the reader assumed; and does a suffix-free name still match
what the news is calling the storm when one is threatening land.

**The load timings can now say WHERE the slow tail goes, and nothing has read
them yet.** `SPEC-OPS.md` §17.5. `t_scripts_ms` splits first-paint→touchable
into "the browser digesting 1.5 MB of MapLibre + Three" and "us building the
map"; `boot_longtask_*` and `visit_ms` make the blocked-time columns answerable;
a 60-second ceiling stops screen-locked phones being averaged as measurements;
`ref_host` says which site a spike came from. **Nothing to judge on glass — the
app is unchanged.** What is needed is a wait: rows only carry these once people
have visited on the new build, so re-query in a day. The question they exist to
settle is whether the fix is a bundling job (Three.js off the boot path) or a
code job (the map taking too long to build). Do not start the Three.js work
before that number exists — it is a real restructuring and ten modules import
`THREE`.

**The setup screen's three doors are peers now, and nothing opens a keyboard.**
`SPEC-UI.md` §8. One `.home-choice` recipe used three times, search opens on a
tap instead of sitting open, delete is red text at the bottom sharing nothing
with them. Judge on glass: do three identical rows read as "pick one", or as a
wall of three grey boxes? If it is a wall, the designed cut is the one-line
explanation under each title — NOT the icons and NOT the shared fill, which are
what make them peers. Second question: search now costs one extra tap on what is
probably the most common path. If that tap annoys you, the alternative is
leaving the box open but unfocused, which fixes the keyboard and gives up the
visual match.

**Home is a place name instead of a coordinate pair.** `SPEC-UI.md` §8,
`SPEC-DATA.md` §4. `/api/reverse` names the point, `map/water-at.js` asks the
already-drawn basemap whether it is water, and four outcomes stay distinct:
the name, `Open water`, `Unnamed location`, or the coordinates when we truly do
not know. **NONE OF THE LOOKUP HALF HAS RUN AGAINST REAL MAPBOX** — the sandbox
cannot reach it, so every failure path is written and none is exercised. First
real lookup happens on your phone. Judge: does the name that comes back read as
useful at three comma-parts ("Galveston, Texas, United States"), or is the
country noise? The dial is `labelOf()` in `functions/api/reverse.js`. And does
"Open water" land as a description rather than as a warning — it is styled like
every other place name on purpose, because watching a rig or a passage is a
legitimate thing to want.

**A question the water probe cannot answer for itself.** `map/water-at.js` reads
`queryRenderedFeatures` against the ocean fill, which is only as good as the
tiles loaded at that moment. It waits for idle and answers `unknown` rather than
guessing, but nobody has watched what it says on a slow connection over a fresh
flyTo. If a pin on obvious land ever says `Unnamed location` with coordinates
under it, that is this, and the dial is `GEOCODE.waterProbeMs`.

**The home marker could not see the drawer at all, and now it can.**
`SPEC-MAP.md` §9.10. `map/chrome-avoid.js` was still naming `#panel-storms` and
`#panel-home`, which stopped existing when the two panels became one `#drawer`;
a dead selector matches nothing and raises nothing, so the sheet was neither an
obstacle nor an occluder. Three things changed together: the selectors point at
`#drawer[data-open="true"]`, faded-out chrome (the FAB cluster under an open
sheet) is no longer measured as solid, and the covered-but-on-screen pointer
case described in the spec since July was finally built. Judge on glass with a
drawer open: pan until the house goes under the sheet and confirm the pointer
appears *directly above the house*, one clear gap off the sheet's top edge —
not flung out to a screen corner. Then confirm the no-drawer behaviour around
the FABs, the storm pill and the status chip is unchanged.

**Settings will grow into the bug Home just came out of.** `SPEC-UI.md` §16. It
focuses whichever segmented option is currently checked, measured 309px into a
424px body — 79px of headroom. One more section above it and the focus ring goes
under the fold. `preventScroll` means the panel stays put rather than jumping,
which is the better failure, but a keyboard user loses the ring. Not fixed: it
changes a surface nobody has asked about, and the margin is real today.

**Every section heading is one grouped selector in `ui/panels.css`.** Adding a
heading anywhere means adding its selector to that list. If a new heading looks
subtly unlike its neighbours, that is the symptom — check the list first, then
check whether a type declaration crept back into `home.css`.

**The strength strip's third figure is colored now.** `SPEC-UI.md` §8.
`Strongest` was the only cell falling through to plain white beside two colored
ones. Judge: three colored numbers in a row may now read as busy rather than as
consistent — the alternative, if so, is coloring none of them and letting the
category words underneath carry it.

**The storm list's freshness column is never blank.** `SPEC-UI.md` §16. Every
row with an observation time says its age; muted when current, amber when
overdue, red when the source has stopped. Judge: a column of grey timestamps on
fifteen rows is new visual weight in the list, and the amber ones now have to
win against fourteen quiet neighbours rather than against nothing.

**The storm name on the map is bigger, brighter, and further off the dot.**
`SPEC-MAP.md` §9.9. 14px in its own themed ink against 12px in the chrome's
secondary. **None of it is verified against a real basemap** — the sandbox
cannot reach `tiles.openfreemap.org`. Judge on a phone, both themes: does the
name now beat the state and country labels around it, and does the light
theme's near-black read on a grey globe. If it is too loud, the dial is
`SIZE.stormLabelPx`; if the halo now looks like an outline rather than
legibility, `stormLabelHaloPx`.

**Forecast timestamps no longer lie along the track.** `SPEC-MAP.md` §7. A
due-west storm tilts to −20° instead of laying every label flat on the forecast
line; due-north still stays horizontal. A side effect worth watching: dense
westward tracks now keep ALL NINE labels on one side where they used to thin to
seven, because the tilt separates parallel strips better. Judge: does nine
labels on a crowded track read as informative or as a wall, and does −20° look
deliberate or like a mistake. **Two rules were built here and one was cut** —
the clearance rule against distant track legs never changed an outcome on any
of nine fixtures and was removed rather than shipped unproven.

**The rail carries the storm's own story now, and it is the longest it has ever
been.** `SPEC-UI.md` §8. Class milestones (tropical storm / hurricane / major
hurricane, up and down) and the forecast peak. On a strengthening storm that is
up to four milestone rows on top of four wind rows, the pass and `now` — ten.
Judge: does it read as a narrative in order, or as a wall of text? If it is too
long, the designed cut is the intermediate wind endings, then the weakening
milestones. NOT the all-clear and NOT the worst arrival.

**The rail now names every wind that reaches the house.** `SPEC-UI.md` §8.
Arrivals ascend, endings descend, and the last field to lift says "The wind is
past you". Judge: on a two-field storm that is up to four wind rows plus the
pass plus `now` — does it read as escalation-then-recovery, or as a wall? If it
is too long, the designed cut is the intermediate endings, NOT the closing row.

**A KNOWN TEST GAP, stated rather than left to be discovered.** The
earliest-arrival hedge is taken from the weakest reaching field; taking it from
`worst` is a real bug that `tools/test-home.mjs` does NOT catch. The hedge row
is suppressed under two hours and the nested fixture's wind arrives inside a
day, where NHC's track error is small enough that both gaps come out under an
hour (measured 0.48 h and 0.96 h), so no hedge row renders and no assertion can
read one. The ordering fact behind the bug IS asserted against the corridor.
Closing it properly needs a second fixture whose wind arrives days out.

**A watch in force that the map cannot draw.** `SPEC-DATA.md` §4, `SPEC-UI.md`
§16. NHC published Lala's Hurricane Watch with a null geometry, so the panel
named it and the coast stayed unmarked and nothing said so. The IN EFFECT entry
now carries **not on the map** with a line naming why. Judge: does it read as
"NHC has not drawn it yet" rather than as our bug, and is the tag legible at the
far edge of the row without pulling the eye off the product name. **Whether a
shapeless watch is a Central Pacific quirk, one bad advisory, or normal is still
unknown** — layer 8 is now in the hourly archive, so read
`latest/geometry/nhc-*-watchWarning.geojson` across a few runs before deciding
whether the KMZ fallback is worth building.

**The waiting dots and the split `pending` rung.** `SPEC-UI.md` §16, §8. Every
"Checking…" in the app now animates its three dots, and the home chip's
`pending` rung was split three ways so it only says "Checking…" while something
is genuinely running. Judge: does the pulse read as thinking rather than as a
fault, is it distracting beside a live storm, and does "No forecast yet" land
better than the chip having nothing to say.

**The archive's NHC track snapshot has never actually run.** `SPEC-DATA.md` §4.
Layers 5 and 10 per active storm land under `latest/geometry/` on the hourly
job; the change was pushed minutes after the last run, so nothing has exercised
it. Confirm `nhc-<name>-<bin>-pastPoints.geojson` arrives, then read a real
`stormtype` off it — that field is what two bugs in one week turned on and
nobody has ever seen one.

**Genesis outlook — the held-empty memory has never once fired.**
`SPEC-DATA.md` §45.5, `SPEC-OPS.md` §17.7. An empty NHC outlook layer inside six
hours of a real answer is now held rather than believed, because "NHC is
watching nothing" and "NHC's layer is broken" are byte-identical on the wire.
The warm store was empty for this feature's whole life, so nobody has seen the
amber held note on glass. Judge: does it read as a stopped clock rather than a
failure, do the patches stay on the globe, and does a genuine all-clear still
get through once six hours lapse.

**Genesis arbiter — built, and nothing calls it.** `SPEC-DATA.md` §45.9.
`lib/outlook.js` reconciles the layer count against the `ABNT20`/`ABPZ20`
bulletin into six verdicts and is proven against the real bulletin.
`data/genesis.js` does not consult it, so app behaviour is unchanged. The wiring
and the sentence on screen are the remaining work.

**Genesis patches on glass — the one open design question.** `SPEC-MAP.md` §45.7.
Does a hatched sand patch read as *nothing here yet*, or as a storm-shaped thing
that undoes the app's clearest signal — that a colored blob is a real cyclone?
Phone, both themes, planet and basin zoom, with a real storm beside it. Also:
are Low/Medium/High distinguishable without reading the number, and does the
section earn its space with several storms up?

**Storm list row — the biggest subtraction in the app's history.** `SPEC-UI.md`
§16, §16.4. Wind and the trend word are gone from the row; a column that cannot
be filled for every global storm goes to another surface. The ↘/↗ pair is gone
too — the arrow is now a real compass heading. Judge: three lines per row is
74px against 55, roughly 870px of scroll for fifteen storms against 580. If it
reads as bloated, the third line is the designed cut. Does losing the wind
number hurt, and does the rotating arrow read at 12px on a phone?

**The header's title block is settled: dot and name centred together, second
line under them.** `SPEC-UI.md` §16.5. Three arrangements were built before this
one. Padding the second line to chase the name aligned the two lines to each
other and left both 10px off the stepper. Shifting the first line so the name's
letters landed on the axis measured perfectly and left the dot hanging outside
the group. The dot is part of the title and counts in the centring, which is the
arrangement the app started with — the only real bug was the chip's stray auto
margin. Judge on glass: dot-and-name, chip, stepper, headings all on one line.

**The detail panel's dot was flat and 2.5px low, and nothing could have caught
it.** It borrowed `.row-swatch` from the storm list, whose glow is composed from
a custom property the identity block never set — an invalid `var()` makes the
whole `box-shadow` compute to `none`, silently — and whose `margin-top: 5px`
pins a dot to the first line of a multi-line row. `.drawer-identity-dot` now
lives beside the block it belongs to and both views render it. The check asserts
a live glow with real ink on both drawers.

**Two more `.row-swatch` callers in the detail panel are built the same way.**
`ui/view-storm-detail.js` lines ~721 and ~775, the wind-field and model legend
items, pass the color as an inline `background:` rather than `--swatch`. Same
construction as the header bug, so almost certainly the same dead glow plus a
stray 5px offset on an inline list item — NOT measured, and not touched, because
it changes two more surfaces Aaron has not looked at.

**The header gives 9px above the name, not the 11 an earlier commit claimed.**
The top padding did double (4px → 8px) and the direction was right, but the
number was measured against a fixture with wider spacing than the app. Whether
9px looks like enough clearance from the sheet's rounded corner is a call no
check can make. If it still reads squeezed, the header's top padding is the dial.

**A box is not its contents, and this file's check learned it three times.**
Three separate assertions have read 0.0px while the header was visibly wrong,
each comparing two full-width boxes whose centres are equal by construction. The
centring assertions now measure the dot-to-name span, the chip's own box, and a
`Range` around bare text. The fixture's design tokens had also drifted from
`index.html` — 6/10/14/20 against 4/8/12/16 — so every pixel figure in two
commits was about a quarter too large; the check now parses both `:root` blocks
and fails on disagreement.

**A check that had been reading 0.0px whatever the chip did.** It compared two
full-width block boxes in the same parent, whose centres are identical by
construction, and passed with the chip visibly off to one side. It now measures
the chip's box against the name's box, and the harness exercises the pairing
that lets the bug exist: a name WIDER than the chip, where the block has free
space in it. Five mutations caught. The fixture was also using the dashboard's
swatch class for both drawers when the detail panel has its own — both 12px, so
the numbers agreed by luck.

**Both drawers now share one header and one stepper.** `SPEC-UI.md` §16.5. The
storm's name and its second line are the drawer title on both; `‹ 2 of 7 ›` is a
tight centred cluster pinned under it; Back says where it goes in words; "Home"
is a small eyebrow in the lead slot. The dashboard is now a fixed height so
stepping stops resizing the sheet, and the name sits the same distance below the
sheet's top edge on both drawers. Judge: does the storm name read as the panel's
heading now it is centred and smaller — on the dashboard it lost the
biggest-type slot it had. Is the eyebrow legible enough to answer "which drawer
am I in", or so quiet it may as well not be there. Would anyone find that the
header title is still tappable, which is the ONLY route from the dashboard into
the storm's own panel. And does the camera flight on every chevron press feel
like navigation or like the map twitching while you compare two storms.

**The heading arrow is on three surfaces and none of them are judged.**
`SPEC-UI.md` §16.4. Storm row line 3, the detail panel's `Moving` row, and the
home dashboard's motion line, all off one component. Judge: does it read as a
direction rather than decoration; is the stroke heavy enough beside monospace
figures in both themes; and does a row with NO arrow (a GDACS storm with no
JTWC warning) look deliberate rather than broken — the slot is held open, so
the text should not shift.

**A storm nobody is analysing now leaves, and stays left.** `SPEC.md` §5.
DOLPHIN-26 could not expire on any device: the `lapsed` route re-ended it every
poll and reset the clock its own display window is measured from. Three fixes —
one ending per storm, an ended storm kept out of the live working set, and a
parse cutoff at `ENDED.stopListingAfter` so the app stops believing a feed row
GDACS will not retire. Judge on the next one: does "quiet since Sun 7:00 AM"
under a **Finished** heading read as coherent, or as two words arguing with each
other — and does the storm vanishing at hour 60 read as a decision rather than a
glitch. Nobody has seen the disappearance itself yet.

**The cone is measured and redrawn on the track.** `SPEC-MAP.md` §7.9. Judge the
flanks on a recurving storm; a straight forecast should look unchanged. Dial is
`CONE_SWEEP.blurDeg`, currently 2.5°.

**The white ring on each storm's first forecast dot.** `SPEC-MAP.md` §7.5. Does
it read as *start of forecast* rather than a second storm marker, given the
glyph sits roughly 40 nm away? Two alternatives were tried and reverted on
glass — equalising the stroke widths, and a dark casing disc. Both settled.

**The limb glow smears along the rim.** `SPEC-MAP.md` §9.14. Spin it, both
themes: does the light read as lying ON a curved surface? `GLOW.smear` (1.4)
down if too streaky, `GLOW.squash` (0.35) down if too thin.

**The light theme is greyscale, and a theme change no longer rebuilds the map.**
`SPEC-MAP.md` §9.2, §9.3. Judge: does a storm read at a glance on the grey
globe — that is the whole bet. Flip the theme with a storm selected and watch
the cone and tracks; nothing should flash or stay dark. **None of it is verified
on a real basemap**; the sandbox cannot reach `tiles.openfreemap.org`.

**Sliders need a thumb grab; drawer content fades under the header.** `SPEC.md`
§10, `SPEC-UI.md` §16. Scroll the settings sheet fast past all four sliders —
nothing should move. Then drag a thumb: no lag on the first pixel, and still
grabbable at either end of its range. Desktop mouse: the track no longer jumps
to a click, which is intended and is a real behaviour change.

**Every relay route rebuilds its cache hit, and GDACS reports its own age.**
`SPEC-OPS.md` §17.7. GDACS can now raise the delayed banner for the first time
ever — a source whose complaints have never been seen. Watch for false alarms.

**The app replays Hurricane Ida at `/?replay=ida`.** `SPEC-UI.md` §8. The real
globe, dive, drawer and home dashboard against NHC's published bytes.
**Imagery is the open hole:** satellite and radar do not route through
`ENDPOINT.relay` and there is no archived imagery, so switching them on during a
replay paints TODAY's radar over a 2021 hurricane. Suppress with a stated reason
or find an archive — doing nothing is what §5 rules out.

**One duplication survives on purpose and has now been SEEN but not ruled on.**
`SPEC-UI.md` §8. On a near storm the `Where it is` section and the countdown's
first row say the same words. The countdown is the chart's accessible twin and
has to be self-contained, which is the argument for keeping it; it may simply
look like a mistake with both on screen. It was on the glass 2026-08-16 with
home moved into Lala's path and drew no complaint, which is weaker than an
answer. Aaron's call.

**A dead storm's trail is no longer a souvenir of who was watching.** `SPEC.md`
§5, `data/ended-track.js`. The trail was whatever geometry THIS device happened
to hold when the storm was promoted, so a device that first met a storm already
past `lapsedAfter` lapsed it on its first poll — before the warm could land — and
filed it with an empty track, permanently. Measured in a real browser with clean
storage: one poll, `pastTrack: none`, zero points. A lapse is the one ending where
the source is still listing the storm, so it is the one ending that can go and
fetch what it missed. Judge: does a finished storm that arrives trackless get its
dotted line inside one poll on a phone that has never seen it before, and does the
line look identical to one captured live rather than subtly shorter.

## NEXT UP

**1. WINDOWS BLOCKS FOR 3.2 SECONDS AND NOBODY HAS LOOKED.** The only real
performance problem left. Clean slice, `timings_ok = 1`:

| | iPhone | Android | Linux | Mac | **Windows** |
|---|---|---|---|---|---|
| Boot veil lifts | 1,158 | 1,209 | 829 | 596 | **2,764** |
| Storms on screen | 2,132 | 2,219 | 1,279 | 799 | **4,670** |
| Blocked | *(blind)* | 430 | 884 | 17 | **3,210** |
| Worst tap | 18 | 115 | 146 | 45 | 131 |

21 clean sessions across 7 stranger machines, so it is not one weird PC. Worst
single session: 29,604 ms of blocking. Everything else clears its bar.

**READ THE BLOCKED ROW AGAIN BEFORE ACTING ON IT.** Those figures are
`longtask_ms`, which covers the WHOLE VISIT, while every other row in the table
stops at boot. The comparison is therefore malformed and the 29,604 ms figure is
not 29 seconds inside a load — it is 29 seconds across a session of unknown
length. `boot_longtask_ms` and `visit_ms` now exist to answer this properly and
carry no history, so **wait for fresh rows rather than re-deriving from the old
column.** The iPhone blind spot is also worse than "blind" suggests: Safari has
no long-task observer at all, so every iOS zero in this table is "not measured".

**2. WHAT A MAPLIBRE FRAME COSTS — UNMEASURED, AND THE GATE ON ITEM 1.**
`attachIdleRotation` calls `setCenter` per frame below `DIVE.zHandoff`, so a
resting globe drives a full map repaint; moving water pays it too via
`triggerRepaint()`. The free half is already gone — past `zHandoff` the loop no
longer schedules a frame it throws away. The remaining repaint cannot simply be
skipped, because `setCenter` is what `map/globe-follow.js` mirrors to make the
rotation visible. The four rules a fix must follow are in `SPEC-MAP.md` §9.7.
Needs a real device with a real basemap; the sandbox has no tunnel to one.

**3. GDACS STILL LEAVES PEOPLE ON A SPINNER, though less so.** 41 of 46 GDACS
loads reached `ok` against NHC's 44 of 46, with **zero errors either side** —
the misses are sessions that ended still loading. Retry has been pressed zero
times in 193 sessions, so that path has never been exercised by a real user.
Two changes have landed since these numbers and both should move them: the
stamp fix, and the two-second rung. **Re-read before acting.**

**4. THE CSS-VARS SUITE CANNOT SEE A STYLESHEET.** `tools/test-css-vars.mjs`
walks `.js` only, so a fallback-less `var()` in a `.css` file — which renders as
nothing, silently, which is the entire reason that file exists — is invisible to
it. The blind spot survived because the bug that prompted the suite was in JS.
Widening the sweep to `.css` is a few lines and immediately fails: a probe on
2026-08-16 found five names already referenced and never declared —
`--radius-snug`, `--surface-raised`, `--accent`, `--touch-min` (`ui/home.css`)
and `--space-roomy` (`ui/panels.css`). **Each needs judging on its own**; some
may be deliberate inheritance from a parent, some may be things that have been
rendering as their initial value for months. The pass is: decide the five, then
widen the sweep so the sixth cannot happen.

*Dead hypotheses, do not reopen without new data:* the OpenFreeMap CDN is not
the bottleneck, and modulepreload was measured and rejected (`SPEC.md` SETTLED).
The 4096×2048 land texture costs ~511 ms of upload plus ~202 ms rasterising on
cold load — worth removing, but not urgent and not user-facing, and the answer
is filled triangles (below), not a smaller canvas.

## HELD FOR WEATHER

**Watch a storm get a real final warning.** The `declared` end path has never
fired on a real storm. A real JTWC final warning proves it. Detection is
client-side; the app must be open. DOLPHIN-26 was the candidate and never got
one — it simply stopped being analysed, which is what `lapsed` is for.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

**A Cat 4 has never been on this globe.** The severity ramp above Cat 2 is
untested by observation. So is the cone, swath and warnings together at basin
zoom — the densest this map ever gets.

## SCOPED, NOT STARTED

**Two views are over §12's ~700-line ceiling and both want a cut before they
are touched again.** `ui/view-home.js` is 1,413 — the strength strip and its
figures, the countdown rail, and the quiet/error/no-home states are three
separable concerns sharing a file. `ui/view-storm-detail.js` is 1,440, and the
stepper was the last thing that went in without a cut list; the stamp, the
section renderers, the advisory record and the stepper are its four. Each split
should be its own pass with **no behaviour change**, so a break can only be the
move.

**§49 IS COMPLETE AND JUDGED. Two things about it are still open.**
`SPEC-NEXT.md` §49. All five passes and the housekeeping have landed and been
seen on a phone across a real storm's whole life — approaching, mid-arrival,
and departed.

**`[VERIFY]` — LIVE LAYER 13 HAS STILL NEVER BEEN READ.** Every figure in §49.9
is measured against NHC's published best-track radii, which is the same product
with the same field names the live layer serves. How far back the LIVE layer
publishes on an active storm, and what it does across a basin change, is
unknown. It is in the hourly archive now; read
`latest/geometry/nhc-*-windPast.geojson` across a few runs. If it publishes far
less history than layer 10, `partial` already exists to say so and the wording
is a glass call.

**Two glass questions §49.12 records and nothing has answered.** Does *Was
strongest* beside *When it was closest* read as one story in two tenses or as
two unrelated facts (Q6)? And on a storm mid-pass, is the single line *It came
closer earlier* enough, or does the past want its own vertical (Q5)? Both need
a storm sitting in that state long enough to look at.

**The intensity chart (§46) is specified and waiting in `SPEC-NEXT.md`.**
Endpoints fetched live, field names transcribed from the real schemas, open
questions written down. Read the section, not this line. §47 is now fully
built — the health paragraph landed as `lib/env-health.js` + `ui/env-health.js`.

**The outlook KMZ is archived and unparsed.** Layer 3 is empty on BOTH NOAA map
services while NHC's website draws areas (§45.2 — settled, don't re-check).
`gtwo_atl.kmz` is the second publication path and is snapshotted hourly. Next
step is to open the real bytes and decide whether a KML fallback earns its
weight. The Pacific filename in the archive is inferred and may 404.

**The 3D land fill should be shapes, not a picture.** Feeding `RINGS` to the GPU
as filled triangles deletes the canvas, the ~500 ms upload and ~34 MB of GPU
memory, drops the resolution ceiling, and turns retheming into a recolor.
Traps: rings-inside-rings for inland lakes, the antimeridian with Antarctica
worst, flat triangles cutting chords through the sphere. `earcut` (~10 KB, no
build step) does the triangulation. **Not during cyclone season, and not in the
same pass as the engine upgrade** — both are surgery on `map/globe3d.js`.

**The three.js r128 → r182+ upgrade gates nothing.** It only ever gated the cut
§41–§43 effects. Ordinary maintenance now — do it when there is a reason.

## KNOWN AND ACCEPTED

- **`functions/tiles/` is dormant, and dormant SERVER-side.** `TILES.useR2` is
  false, so the Protomaps branch in `map/style.js` and the 1,721 vendored
  pmtiles lines never run. A Pages Function is not downloaded by a visitor, so
  this costs nothing on the wire — it is a maintenance question, not a
  performance one. `[DECIDE]` whether R2 is still wanted as an option.
- **The drawer does not say which watch/warning products fell back to a chord.**
  `SPEC-UI.md` §16, `SPEC-MAP.md` §7.10. The IN EFFECT rows read the raw NHC
  slot and have no view of what the map managed to snap; saying it there means
  plumbing map state into the panel. Left undone deliberately now the map admits
  it itself. Revisit only if glass says the dashed chord is not enough.
- **The `> 0` guard on `index-of` in the state-name suffix trim is untested.**
  Its suite went with the three-globe cut. `SPEC-MAP.md` §11.2.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Ended storms keep their track but not their wind swath.** Cosmetic; nobody has
  asked for it.
- **The gap between a warning being issued and the winds arriving is not
  computable in the app.** Layer 8 carries what is in force, not when it was
  issued, and nothing stores advisory history on device. It is the most
  actionable number in the archive and it is out of reach.
- **Three eviction functions are never called** — `evictTcgpIndex`, `evictCarq`,
  `forgetBand`. Three caches that can be filled and never emptied. That is a
  memory question, not a tidiness one, and nobody has asked it.
- **iOS clean long-task numbers are an instrumentation gap.** All WebKit sessions
  report `longtask_n = 0` because WebKit does not implement the observer.
  `ttfb_ms`, `mem_gb` and `conn_type` are blank there for the same reason. Do not
  read any of those columns as "iPhones never block".
- **Filter telemetry on `timings_ok = 1` or repeat a mistake this project already
  made.** Backgrounded tabs (`timings_ok = 2`, averaging 322,440 ms to storms)
  poisoned every iPhone average ever computed here. iPhone's real position is
  second fastest.
- **GDACS's `alertlevel` never reaches the screen and that is correct.** It is a
  humanitarian-impact score, so it can rate a Cat-5-equivalent Green. Strength
  comes from GDACS's own `severitytext`; the alert level is parked unrendered in
  `raw`. Logged because the question keeps getting re-asked.
- **Three suites need Playwright and do not run in a bare sandbox.** Expected,
  not broken. They run once `node_modules` is on the path, and on the runner.
- **`env_retry` has never been counted and is not a column.** `lib/usage.js` is
  an allowlist and that name is not in it, so every call has been silently
  dropped since §47.8 shipped. Rain's retry uses the generic `retry` rather
  than adding a second phantom. Fixing it properly is a D1 schema decision.
