# HANDOFF — Seasons UI polish, the GLOBE pass (§57.21c)

**THIS FILE EXISTS BECAUSE A SANDBOX IS THROWAWAY AND A PLAN THAT LIVES ONLY IN
A CHAT WINDOW DIES WITH IT.** Aaron's point, 2026-08-25, and he was right: the
first three quarters of this pass were written with nothing on GitHub to show
for them.

**DELETE THIS FILE IN THE COMMIT THAT LANDS THE PASS ON `main`.** It describes
work in progress, which is the one thing the spec files must never do. What is
built goes into `SPEC-SEASONS-BUILD.md` §57.21c as an as-built account; what is
left goes into `NOW.md`. A handoff note that outlives its handoff becomes a
stale fact nobody deletes.

---

## WHERE THIS LIVES

Branch **`seasons-globe-polish`**, off `main` at `3ca213a`. **Not on `main` and
not deployed** — the pass is roughly two thirds built and pushing it live would
ship a half-wired archive globe.

`NOW.md` on `main` carries a pointer to this branch. That is how a new session
finds it, because `NOW.md` is what gets read at session start.

---

## AARON'S LIST, VERBATIM, 2026-08-25

Seven items. This branch is **push 1 of 2 — the globe**. Items 6 and 7 are the
drawer and were deliberately deferred; see PUSH 2 below.

1. Live storms should not show on the seasons globe. They may stay in the LIST,
   marked **active** where the date normally is.
2. Hurricane glyphs on the season globe's Three.js node mesh, the same as live
   storms. Glyph at the START of the storm's track, in the TRACK's colour.
3. Raise the mesh height the same way the live storm globe does.
4. Tapping a storm in the season list to open the detail drawer should zoom the
   globe to that storm, centred in the space ABOVE the drawer.
5. The globe should open/pan to the selected BASIN when the archive is entered
   from the live storm list door, and centre on HOME when entered from the home
   dashboard door.
6. *(PUSH 2)* The season drawer must hold a persistent height at all times.
   Toggling between years with different storm counts currently resizes the
   sheet, so the year stepper moves and has to be hunted for after every press.
   About four storm names is the height he wants.
7. *(PUSH 2)* Tapping the open space above the drawer minimises it — but pan and
   zoom must still work with the drawer open.

**AND THE FIRST TWO THINGS HE ASKED FOR WERE ALREADY DONE.** The message that
opened the session also asked for the board's loading cut and the step 8
deletion. Both landed the day before in `e0986d9` and `3ca213a`. Do not redo
them. The loading cut did NOT clear §12's ceiling — the board is 762, still 62
over — and step 9 has to take an inventory before it adds anything to that file.

---

## WHAT IS BUILT ON THIS BRANCH

### Item 1 — active storms (the ROSTER half only; see WHAT IS LEFT)

- **`lib/season-facts.js`** — new `isStillRunning(facts, {provisional, nowMs})`.
  A b-deck carries no "this storm is over" flag; NHC simply stops appending
  rows. So the only available signal is the age of the last row.
  `SEASONS.activeWithinHours` is **12** — two missed six-hourly cycles. Gated on
  `provisional` FIRST, so nothing in a reviewed file can trip it however odd its
  timestamps look. A negative age counts as running: a fix stamped a minute
  ahead of the reader's clock is an ordinary phone, and "the last row is in the
  future" certainly does not mean the storm finished.
- **`ui/seasons-board-markup.js`** — the date cell reads `Aug 20 – active`. The
  START date is kept deliberately: it is a real fact and it is what the
  chronological roster is ordered by. The checkbox is **disabled, not absent** —
  a row silently missing a control every other row has reads as a rendering
  fault, and the reason rides in the `aria-label`. The master box counts only
  DRAWABLE rows, or its bar could never fill and pressing it could never show a
  tick, which is a control whose state is unreachable.
- **`ui/view-seasons-board.js`** — `selectedEntries()` is the single place that
  decides what reaches the sepia globe, and it drops running storms. Focus,
  `showStorm` and the master box all ask that same question rather than three
  copies that can drift. `activeIds()` is recomputed per read rather than held,
  because it is an answer about the CLOCK and goes stale on its own inside an
  hour.
- **`config/constants.js`** — `SEASONS.activeWithinHours`.

### Items 2 and 3 — the archive ridge and its glyphs

- **`map/season-mesh.js`** (new) — `buildSeasonMeshPoints(selected)` turns the
  ticked entries into the `{dir, sev, color, head}` list `map/heightfield.js`
  takes. Its own file rather than a branch inside `map/storm-mesh.js`: that file
  is built end to end around a LIVE storm (a head bead at the current fix, a
  window measured from `now`, a cap on unmeasured forecast beads,
  `noCurrentReading`, bundles arriving asynchronously) and an archive storm has
  none of those.
  - **The glyph is on the FIRST fix, in the TRACK's peak colour.** Aaron's call.
    The live globe marks a storm's CURRENT position; an archive storm is not
    anywhere, so the only fix with a claim to the mark is where the record
    opens — which is also where §57.21a already puts the white direction ring
    and the name. The colour is the deliberate inconsistency: every BEAD is the
    category at that moment, the GLYPH is peak, because it belongs to the LINE
    it caps and a first-six-hours hue would be blue on every storm that ever
    lived.
  - **Height is the wind at each fix** through the same `sevFromKt` the live
    globe uses, so a Cat 3 raises the same mountain in 1935 as today.
  - **A storm with no recorded wind gets its glyph and lies flat.** Pre-1886
    rows carry no intensity; `sevFromKt(null)` is the cage's noise floor. The
    storm has not vanished, it simply makes no severity claim — height is the
    loudest channel on this globe (§9) and must not shout a number nobody wrote
    down.
  - **`SEASONS.meshMaxPointsTotal` (1,600) is shared EVENLY** across ticked
    storms, floored by `SEASONS.meshMinPointsPerStorm` (3) and capped by
    `MESH_TRACK.maxPointsPerStorm`. Every point is tested against all 1,440 cage
    nodes on a recompute, and a fully ticked 2005 is 28 storms of ~50 fixes.
    Spending it evenly means a busy season is COARSER, never missing storms —
    the one case where a dropped storm would be impossible to notice.
  - **It reads `lon`, not `lonU`.** These are independent directions on a
    sphere, never joined into a line, so the published value is the right one.
- **`map/storm-mesh.js`** — `thin` is now EXPORTED rather than copied into the
  new file. Two copies would differ the first time either was tuned, and the
  difference would show as one globe's ridge reaching further than the other's
  for the same storm.
- **`main.js`** — `archiveGlobe.setTracks` now also calls
  `g3d.heightfield.setStormPoints('ok', buildSeasonMeshPoints(selected))`. Not
  guarded on `styleReady`: the 3D engine exists from boot and owns its own
  buffers, unlike the MapLibre sources. `'ok'` unconditionally, because this is
  not a feed — the storms are already parsed and in memory, so there is no
  outage for the cage to desaturate over.

### Items 4 and 5 — the archive's camera

- **`map/season-frame.js`** (new). Its own file because `main.js` is 1,660 lines
  and §12's row on it has said "take the next cut" for five passes.
  - `entryTarget(from, basin, home)` — the storm-list door goes to the BASIN,
    the home door goes to HOME. §57.16 already stamps `data-door` on the two
    doors; this is the first thing to read it. A reader who pressed `Past
    storms` under the live storm list was looking at this year's ocean, and
    swinging to their house is a non-sequitur. A basin with no rest position
    falls back to home rather than leaving the camera wherever the live app left
    it — after a selection that is a close zoom on a storm that has just been
    erased.
  - `flyToArchiveStorm` **fits the storm's WHOLE TRACK** into the strip above
    the drawer. A finished storm is a curve, not a point: Katrina is a
    2,000-mile arc, and centring her at `GLOBE.flyToZoom` on any single fix
    frames open water with most of her off screen. It reuses `fitPair` and
    `visibleStrip` from `map/home-frame.js` rather than re-deriving the
    antimeridian and Mercator arithmetic. Bounds come off **`lonU`** — this IS
    the seam case, because a min/max over raw longitudes on a dateline-crossing
    storm reports a planet-wide span and zooms to the space floor. Clamped to
    `ZOOM.basin`..`ZOOM.max`, because a one-fix storm has zero extent on both
    axes and `fitPair` correctly answers `Infinity`.
  - **`SEASONS.basinView`** in `config/constants.js` — camera rest positions,
    NOT claims about where a basin is. Nothing is drawn from them. `epacific`
    sits at 125°W because that file carries the CENTRAL Pacific too.

`node tools/check-syntax.mjs` passes on the branch: 278 modules, 185 tools.

---

## WHAT IS LEFT, IN ORDER

### 1. THE ACTUAL LIVE-STORM BLEED-THROUGH — THE ROOT CAUSE, STILL OPEN

**This is the most important item on the list and the least finished.** Aaron's
item 1 has two halves and only the roster half is built.

`liveGlobe.hide()` in `main.js` empties the storm dots, the watched areas, the
imagery, the 3D cage and the flood polygons. **It never touches the layer
engine's AMBIENT geometry** — so every live storm's past track, cone, wind field
and model tracks stay drawn on the sepia globe, in whatever year you open.

**And the poll puts them back every cycle.** In the `subscribe` handler,
`markers` and `genesis` are gated on `const live = !isArchive()`; the
`engine.ambientBundle` calls below them — the ended-storm push and the
`warmGeometry` callback — are **not**. So even clearing on entry would be undone
within a poll.

The fix:

- `liveGlobe.hide()` → `engine.ambientPrune(new Set())`. That drops every
  ambient bundle AND calls each layer's `forget` hook, which also clears the
  coastal band caches.
- `liveGlobe.show()` → `pipeline.repushAmbient()`. It rebuilds from the geometry
  cache and the ended-storm registry, and it is already the restore path
  `style.load` uses, so this is a road that is known to work.
- Gate the ambient pushes inside `subscribe` on `live`, the same way the four
  above them are. Warming must keep FETCHING while the archive is open —
  leaving should land on current weather, not on the weather from the moment of
  entry — so gate the PUSH, not the fetch.

### 2. FINISH THE `main.js` WIRING

- `archiveGlobe.clearTracks()` must flatten the ridge:
  `g3d.heightfield.setStormPoints('ok', [])`. Without it a leave keeps 1935's
  mountains standing until `liveGlobe.show()`'s `refreshCage()` lands.
- Two new methods on the `archiveGlobe` facade, calling into
  `map/season-frame.js` — one for entry, one for a storm. They must take the
  drawer box and the viewport measured at call time; `seasons/` must never
  reach into `map/`.
- `enterSeasons(fromEl)` reads `fromEl?.dataset?.door` and passes it through as
  `from`.

### 3. `seasons/index.js`

- `openSeasons` takes `from` and holds it on the session.
- Fly on ENTRY, once — after the board settles a season, so the basin is known.
  `onWhere` is the existing hook that fires at that moment; use a
  once-per-session flag, because `onWhere` is called on every tick and every
  focus and the camera must not chase them.
- `onOpenStorm(id)` already pushes `season-detail`. It must also look the storm
  up in `boardView.currentEntries()` and hand its POINTS to the globe facade —
  points, not the storm object, so nothing about `map/` leaks into `seasons/`.

### 4. TESTS, AND THEY HAVE TO BE MUTATION-CHECKED

§12 calls a test that passes on the same wrong assumption as the bug worse than
no test, and thirty-three mutations across the seasons suites have already
produced three survivors.

- `isStillRunning` — the `provisional` gate, the 12-hour boundary either side,
  the negative age.
- `buildSeasonMeshPoints` — exactly one `head` per storm; the head's colour is
  PEAK and a mid-track bead's is not; a no-wind storm floors flat but still
  emits its glyph; the budget divides and `thin` keeps both ends.
- `entryTarget` — both doors, and the unknown-basin fallback.
- `flyToArchiveStorm` — **the dateline case is the one that matters.** Build it
  on Della, CP011957, which is already the repo's seam fixture, and prove the
  raw-`lon` version fails: that is the mutation.
- `tools/test-seasons-board.mjs` — a running storm's box is disabled, is not in
  `selectedEntries`, and cannot be focused. **Do not touch the harness that
  mounts the board inside the drawer's real chrome** (`#drawer` with
  `data-open`). That scaffold is what finally caught the fault that killed step
  7 twice.
- The board's stand-in DOM has told the same lie twice about selectors. If it
  cannot read something, make it readable rather than working around it in the
  view.

### 5. SPEC AND PUSH

- `SPEC-SEASONS-BUILD.md` §57.21c, as-built. §57.21a needs a line pointing at
  it, because it currently says the archive draws no ridge.
- `SPEC.md` §12's table — `main.js` and `ui/view-seasons-board.js` both grew.
- Delete this file.
- Pre-push gate chain, `git grep -I "github_pat_"` leak scan, redact every git
  command through `sed -E 's/(github_pat_|ghp_)[A-Za-z0-9_]+/[REDACTED]/g'`.

---

## PUSH 2 — THE DRAWER (items 6 and 7, nothing built)

- **Persistent height.** `seasons/seasons.css` sets `max-height: 75vh` on
  `#drawer[data-view="seasons-board"]` — a CEILING, so a short year shrinks the
  sheet and the year stepper walks up the screen. The fix is the shape the home
  dashboard already uses in `ui/panels.css`: set `height` as well as
  `max-height`, with the SAME `min(…, calc(100dvh - var(--keyboard-inset) - …))`
  expression, so the two cannot disagree about the keyboard. The roster scroller
  then absorbs the variation. **Four rows is a glass dial, not a computable
  number** — the furniture above it (picker, live-down sentence, scorecard,
  filters) is not a fixed height. Ship a starting value and tell Aaron the one
  line to change.
- **Tap above the drawer minimises it, but pan and zoom still work.** The
  constraint is that a tap and a drag start identically. A pointerdown/pointerup
  pair that moved less than a small threshold and lasted less than a short time
  is a tap; anything else is a gesture the map keeps. `map/chrome-avoid.js`
  already measures the drawer's real box, so "above the drawer" is answerable
  without a hardcoded 60vh. It must not fire inside the archive's bar, and
  `SIZE.touchTarget` slop matters at the seam.

---

## OPEN QUESTIONS FOR AARON

1. **`Aug 20 – active` or bare `Active`?** He said "listed as active where the
   date currently is". The start date was kept because it is real and it is the
   sort key. One line either way.
2. **Does fitting the WHOLE TRACK read right on a phone**, or does he want a
   tighter zoom on the storm's peak? Katrina fits at roughly `ZOOM.basin`, which
   is a long way out for a detail panel.
3. **Is 12 hours the right line for "active"?** It is a dial. Too long and a
   dissipated storm stays off the globe for half a day; too short and a storm
   between advisories gets drawn as history while it is still out there.
