# NOW.md — what's in flight

> **THIS FILE HAS A HARD CAP: 150 LINES.** If it's longer, something is wrong and
> it gets triaged before anything else is added.
>
> **An item leaves this file in exactly two ways.**
> 1. **It lands** — delete it here, and add one or two sentences to the relevant
>    spec file describing what *is*, not what happened.
> 2. **It dies** — delete it. No tombstone, no "investigated and dismissed".
>
> **Not a log.** No dates on things, no completed section, no history. If you want
> to know what happened, that's what `git log` is for.
> **Not a decision tree.** One line per item. If an item needs a paragraph to
> explain, it's a spec entry wearing a TODO's clothes — write it in the spec.
> **Never a place to record a rule.** Rules go in SPEC.md.

---

## IN FLIGHT

— nothing.

## NEXT UP

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. If JTWC walks away mid-sequence as it
did with NOUL, build the JTWC-absence rule — a GDACS storm absent from a credible
JTWC index across `ENDED.absentConfirmations` clean polls, **gated on the storm
already being `silent`**. Detection is client-side; the app must be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Both are judged on whether the answer lands where water and
wind threaten a coast Aaron knows; against a storm half a planet away there's no
telling right from plausible. Surge is bands only (no surge watch/warning vector
product exists in NHC's services); wind arrival fetches layers 18/19 and never
computes; the at-home exposure timeline lands after both.

## NOT CONFIRMED ON GLASS

- Ended storms — does the grey read as *finished* rather than *far away*, and
  does the flattened cage head look deliberate.
- The silence backstop. The radar-coverage honesty fix. `geoDetail: 3` frame
  budget on a mid-range phone.
- Model-track ambient legibility with a full basin up (~45 crossing lines) —
  do five lines read as a spread or as noise at phone width.
- **Wind field with several storms up** — ambient, no zoom floor, may turn the
  map illegible; fix is a `ZOOM` floor, one constant. Also 34 kt green over a lit
  landmass (`windFillOpacity` is the dial), and whether the swept envelope's tier
  seams read as one shape with circular end caps.
- **The full keyboard pass has never been walked** — Enter-to-fly should work
  natively on real `<button>` rows, and the focus ring's legibility against the
  globe at every zoom band is unchecked.
- The Chromium Install button. `beforeinstallprompt` can't fire on iOS, so an
  iPhone check never exercises it. One Android open closes it.
- Fly offset at both widths; labels re-placing cleanly after a drag settles;
  whether the untraced watch/warning stripe chords across bays at z4; the
  classification code inside the dot at every band; toggle and retry rows under a
  real outage; label thinning at a wide zoom-out where the tilt runs out of room.

## OPEN BUGS AND GAPS

- **INP is over budget on the two most-touched things** — `maplibregl-canvas`
  376 ms, the disclaimer nudge button 496 ms. Read the code before any fix; 200 ms
  is the bar.
- **The LCP tail.** ~6% Poor, P99 8.6 s. Best leads: a Windows session with
  `longtask_ms` 27086, and an Android phone blocking 483 ms across 3 long tasks
  at startup. Not chased.
- **The track ridge reads as a PLATEAU, not a path.** `DIVE.stormSigma` (~9° of
  arc) is wider than the 2–3° a storm covers between fixes, so beads blur
  together. Not tuned on purpose: that number also shapes the single-storm peak,
  so the honest fix is a SEPARATE sigma for track beads. Unmeasured: fifteen
  ridges at once, frame cost as geometry lands, a GDACS ridge beside an NHC one.
- **The model-tracks row stays silent when it should speak.** `statusForAll()`
  only reports when EVERY storm agrees, so two healthy NHC decks mask a GDACS
  storm failing completely. It should report a family-wide failure.
- **The cron worker doesn't warm `/api/tcgp/adeck`** — colo-cached only, the
  per-datacentre problem §17 exists to solve. Worker-side change alone, KV read
  already wired. Fine at one user, not before a season.
- **Past GDACS beads are still derived** — class midpoint, never displayed.
  Candidate is the TCGP a-deck's `CARQ` rows, on an endpoint already relayed.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Wind swath is not persisted** for ended storms, only the track. The pill in
  the triple state ("1 active · 1 not updating · 1 ended") is long at 390 px.
- **Why does a past track sometimes arrive in pieces?** Observed live, never
  explained. Drawing them separately is safe, but if NOAA publishes two
  descriptions of one history there is probably a right one to pick.
- **No in-flight request coalescing** on imagery — two identical concurrent
  requests both hit the network.
- `marker-home.js` is over the ~700-line ceiling. Split it on its next real change.

## DECISIONS WAITING ON AARON

- **CSP is still Report-Only.** Flip it after one normal session with imagery on
  and a storm selected reports nothing — and **not** before a traffic spike.
- **Cloudflare Workers Paid, $5/mo.** ~1,200–1,500 KV writes/day against a
  1,000/day free tier. Decide before a storm, not during one.
- **Cloudflare Web Analytics' own RUM script** logs permanent CSP violations —
  neither host is in the policy. Turn the feature off (D1 covers it, and it's a
  third-party script on the critical path) or allow both hosts in `_headers`.
- **`[APPROVE]`** the model picker's family-header copy and the ECMWF sentence —
  drafted in `config/layers.js`, not signed off.
- **`[DECIDE]`** fade model guidance past ~72 h so the near-term cluster reads first.
- **`[DECIDE]`** rebuild the cone by sweeping recovered radii along the curved
  spine. Bending a federal uncertainty product changes "is my town in the cone".
- **`[DECIDE]`** whether the forecaster discussion (TCD) earns a second drawer
  section. One constant away: `ADVISORY_TEXT.kind`.
- **`[DECIDE]`** pan-over-the-pole. Latitude stops at 88° (no up-vector at ±90°).
  Flipping longitude and descending the far side makes up/up/up continuous, but
  the view rolls as you cross. Measure on glass before committing.

## SCOPED, NOT STARTED

**Multi-hazard expansion** — earthquakes, floods, volcanoes, drought, wildfire.
Full spec in `SPEC-HAZARDS.md`, payloads under `samples/`. Order: earthquakes,
volcanoes, wildfire, flood, drought. Blockers in §26.

**Imagery playback (v2.0)** — blocked on GIBS returning empty frames for explicit
timestamps, so it can't step backwards from now. It has to read each layer's
advertised time values first.

**No new layers until Landfall has been used during a real storm** — anything
added now is a guess about what will matter in September.

## VERIFY BEFORE BUILDING ON

- `[VERIFY]` NHC parse details live — `movementSpeed` units (knots assumed), the
  PTC/PT classification mapping, `advNum` presence. Marked in `data/nhc.js`.
- Does the NOAA radar mosaic cover Hawaii and Puerto Rico? 0.06–0.08% is
  ambiguous between no coverage and clear skies. Re-probe on a day they have weather.
- `COAST_BAND.halfWidthKm` (50 km) and the tile-boundary filter thresholds
  against real OpenFreeMap/OpenMapTiles edges.
- `LABEL_PLACEMENT` against a real busy basin — `spokeStartPx` (18) air between
  dot and text, `charWidthPx` (6.2) as a length estimate, `dotClearPx` (13).
- Real payload and parse cost of a mature model deck on a phone — the >90% filter
  reduction is measured on synthetic input only.
- TCGP's fresh data sits behind a host with `hurricanes-beta` in its path. If
  `/api/tcgp/adeck` starts 404ing everywhere at once, check that first.
