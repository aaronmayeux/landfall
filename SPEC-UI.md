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

Four things depend on it: storm-list sort order, where recenter comes to rest,
the opening sequence's resting position, and the detail panel's home block. It
is a reference point, not a feature.

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

`closestApproach()` finds the right great-circle minimum: measured against a
4,000-step true-sphere search it agrees to 0.2 nm and under a minute, so the
linear interpolation between forecast points is not where error lives. The error
is in reporting that minimum unconditionally. A great circle from Louisiana to
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
| Loading, over it, still nothing | Trouble reaching the storm feeds — still trying |
| Retries exhausted, nothing held | Storm data unavailable |

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

### The event model — what changes when a storm is one hazard of six

**Scoped, not started.** SPEC-HAZARDS.md §18.1 generalises `storm` to `event`.
Everything below describes what that does to this section. Nothing here is built.

**One list, not one list per hazard.** Events sort nearest-first and group under
real `<h2>` headers by hazard, the same shape the basin grouping already uses.
**Headers, never a filter** — the same reasoning that removed the scope filter on
2026-07-25: with no filter, nothing can hide an event that exists.

**One detail panel with a shared frame and a swappable body.** The frame is name,
timestamp, source, distance from home, back and close — identical for every
hazard, because it is the same question every time. The body is per-hazard and
nothing else is.

**The layers panel grows a third group, and the new one goes on top** (SPEC-MAP.md
§7.1 owns the panel itself):

```
ON THE PLANET      the hazard toggles — the row most people will touch
SELECTED EVENT     rows swap by hazard type (was STORM DETAIL)
REFERENCE          plate boundaries joins home marker / cities / tropics
```

**Home's "closest approach" generalises to "what is near you"** — the nearest
event per active hazard, under the same rule that already governs it: every home
figure carries the timestamp it came from.

### The world switcher lives at the space floor, and needs a keyboard twin

**Scoped, not started.** Full rules in SPEC-GLOBES.md §39.

**The control cluster does not gain a sixth button.** Its five are places to go
*within* a world; the switcher is their parent. At the space floor the other
worlds are simply present and selectable, and choosing one moves the camera.

**That affordance is gesture-only, so on its own it does not exist** (§10). It is
accompanied by a real focusable list of worlds running the identical camera move,
reachable by Tab, with a visible focus ring and a screen-reader label naming the
world and its state.

**Discoverability belongs to `ui/first-run.js`**, not to a permanent control. A
first-time user does not know to fly out, and that is a first-run job.

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

**Ordered nearest-first, grouped under basin headers.** Those two rules conflict
unless basin order is defined, so: **basins are ordered by their nearest storm**,
and within each group, nearest first. The single closest storm on the planet is
always at the top of the list, inside its basin's group.

**Two lines per row, name on its own.**

```
ATLANTIC
  ● Fiona
    Cat 2 · 85 kt · closing · 310 mi
  ● Gaston
    TS · 50 kt · 890 mi

EAST PACIFIC
  ● Estelle
    Cat 1 · 75 kt · 1,240 mi
```

**The storm name is the one thing on this surface that must never be truncated.**
It is how you refer to the storm, how you match it to a forecast you heard
elsewhere, and how a stranger arriving by shared link knows what they are looking
at. A single line puts "Cat 2 · 85 kt · closing · 9,901 mi" across most of a
340 px rail and ellipsises the name. So the name owns a full-width line and the
figures sit under it, a step smaller and in secondary colour, so the names win
the glance. A name that still overruns wraps rather than clipping — a two-line
name is readable, "Tropical De…" is not.

- **Row:** category swatch (§6, the same colour as the globe dot, so the list is
  its own legend) pinned to the name's line, then the name; underneath, category
  · wind · trend · distance. **The trend word sits BEFORE the distance** — after
  it, "340 mi receding" reads as a measurement rather than a direction of travel.
- **No home means no distance**, and the list falls back to canonical basin
  order, strongest first within each. With no reference point, intensity is the
  only ranking the data supports. The store keeps intensity order regardless
  (`data/merge.js`); the LIST re-sorts to nearest-first once home exists, without
  mutating the store's ordering, because other surfaces still want intensity.
- **Headers only when more than one basin is present.** A lone header over a
  two-row list is noise.
- **Do not re-sort while the panel is open.** A poll can flip two storms' ranking
  and move a row out from under a thumb mid-tap. Sort on open and on reopen —
  never on poll. Storms move slowly enough that nobody will notice.
- Stale rows carry their age inline. **Ghosts sit in a dimmed group at the very
  bottom under a divider, outside basin grouping** — otherwise a dissipated storm
  creates a header for a basin with nothing active in it.
- **No virtual scrolling.** Peak worldwide is ~15 storms; rendering rows directly
  is simpler and faster than any windowing library.
- **Basin headers are real `<h2>`s**, so screen-reader users can jump by heading
  instead of arrowing through every row. Headers are not focusable; Tab hits rows
  only.

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

### The list is the accessibility surface

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
