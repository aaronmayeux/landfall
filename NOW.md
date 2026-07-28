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

`[DECIDE]` **whether a mixed version needs a backstop beyond the cache fix.** A
single build id would NOT have caught the case that bit us — the list and the
globe disagreeing is two feature modules drifting, which one version string in
one config file cannot see. Options: stop here, or make the worker's cache
replace its set atomically. **Recommendation: stop here**, revisit only if a
mixed version is seen again now both cache halves are shut.

**The boot mark is a hand-drawn stand-in and it is not good enough.** Aaron
judged it on glass and it goes. **He is providing a real SVG of the Landfall
logo to replace it** — drop it into the `#boot-mark` block in index.html, keep
the counter-clockwise spin and the reduced-motion fallback. Until then the app
opens on a redraw that does not match its own icon.

**Aaron's work PC gets `ERR_CONNECTION_CLOSED`, zero bytes, on every Landfall
URL — including `manifest.webmanifest` and the `pages.dev` host.** NOT THE APP:
nothing was delivered, so nothing we ship can be the cause. Started immediately
after an Empty-Cache-and-Hard-Reload, which fires 120+ requests at one host from
a shared office IP. Read Cloudflare **Security -> Events** for the block, then
see the rate-limiting item below.

## NEXT UP

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. A real JTWC final warning proves it. If JTWC walks away mid-sequence as it
did with NOUL, build the JTWC-absence rule — a GDACS storm absent from a credible
JTWC index across `ENDED.absentConfirmations` clean polls, **gated on the storm
already being `silent`**. Detection is client-side; the app must be open.

**Surge (Phase 6 step 3) and wind arrival (step 4) are HELD FOR A STORM NEAR
HOME, not blocked.** Against a storm half a planet away there is no telling a
right answer from a plausible one. Surge is bands only (no watch/warning vector
product exists); wind arrival fetches layers 18/19 and never computes; the
at-home exposure timeline lands after both.

## NOT CONFIRMED ON GLASS

- The radar-coverage honesty fix. `geoDetail: 3` frame budget on a mid-range
  phone — now the ONLY route to a legible weak past on the ridge is detail 4,
  which quadruples the node count, so this measurement gates a real decision
  rather than being housekeeping (SPEC-MAP 9.4).
- **The module cache fix, on the work PC that showed the mixed version.** That
  is the reproduction case and the only real proof it worked.
- Model-track ambient legibility with a full basin up (~45 crossing lines) —
  do five lines read as a spread or as noise at phone width.
- **Wind field with several storms up** — ambient, no zoom floor, may turn the
  map illegible; fix is a `ZOOM` floor, one constant. Also 34 kt green over a lit
  landmass (`windFillOpacity` is the dial), and whether the swept envelope's tier
  seams read as one shape with circular end caps.
- **Model guidance in LIGHT mode, on glass.** The dark set measured 1.00:1
  against the daylight ocean; the new light set targets ~2.6:1. Numbers are
  gated by `tools/contrast-check.mjs`, but whether five hues still read as five
  distinct models at that lightness is a glass question, not a numbers one.
  Check the picker swatches match the lines after a live theme switch.
- Loose ends, one pass each: the Chromium Install button (iOS can't fire it);
  fly offset at both widths; labels re-placing after a drag; the watch/warning
  stripe chording across bays at z4; the classification code in the dot; toggle
  and retry rows under a real outage; label thinning at a wide zoom-out.

## OPEN BUGS AND GAPS

- **`tools/detail-disclaimer-check.mjs` cannot run offline.** It waits on
  `load`, which waits on basemap tiles, which the sandbox cannot reach. Fails
  identically on the parent commit. `disclaimer-layout-check` and `ended-check`
  both run fine offline — they wait on the DOM instead.

- **INP is over budget on the two most-touched things** — `maplibregl-canvas`
  376 ms, the disclaimer nudge button 496 ms. Read the code before any fix; 200 ms
  is the bar.
- **The cold-load import staircase.** With no build step the browser DISCOVERS
  modules by reading them — main.js, then its 40 imports, then theirs — and each
  layer costs a round trip. Candidate fix is `<link rel="modulepreload">` for
  every module, generated and verified by `tools/check-syntax.mjs` (which
  already walks every import) so the list cannot go stale. **MEASURE FIRST** —
  it is unproven that this is what costs the slow tail its seconds. A build step
  was considered and refused again; §2 stands.
- **The LCP tail.** ~6% Poor, P99 8.6 s. Best leads: a Windows session with
  `longtask_ms` 27086, and an Android phone blocking 483 ms across 3 long tasks
  at startup. Not chased.
- **`overallStatus` returns `ok`, not `clear`, when only ended storms are held.**
  Deliberate — `clear` would fire an all-clear while a grey dot sits on the globe.
- **Small carried gaps:** wind swath not persisted for ended storms (track only);
  the triple-state pill is long at 390 px; no in-flight request coalescing on
  imagery; a past track sometimes arrives in pieces and nobody knows why.

## DECISIONS WAITING ON AARON

- **CSP is still Report-Only.** Flip after one clean session with imagery on and
  a storm selected — and **not** before a traffic spike.
- **Rate limiting / attack protection — NOW HAS A REAL SYMPTOM.** Whatever is
  in front of the site locked Aaron's own office IP out for hard-reloading.
  Forty people in one town opening this during a storm is not a different
  pattern. Read Security -> Events, then set Rate Limiting Rules in the
  dashboard (no code, B4 from the §17 work).
- **Cloudflare Web Analytics' own RUM script** logs permanent CSP violations —
  neither host is in the policy. Turn the feature off (D1 covers it, and it's a
  third-party script on the critical path) or allow both hosts in `_headers`.
- **`[APPROVE]`** the model picker's family-header copy and the ECMWF sentence —
  drafted in `config/layers.js`, not signed off.
- **`[DECIDE]`** fade model guidance past ~72 h so the near-term cluster reads first.
- **`[DECIDE]`** rebuild the cone by sweeping recovered radii along the curved
  spine — bending a federal product changes "is my town in the cone".
- **`[DECIDE]`** whether the forecaster discussion earns a second drawer section
  (`ADVISORY_TEXT.kind`), and pan-over-the-pole (latitude stops at 88°; going
  over rolls the view — measure on glass first).

## SCOPED, NOT STARTED

**Multi-hazard expansion** — earthquakes, volcanoes, wildfire, flood, drought,
in that order. Full spec in `SPEC-HAZARDS.md`, payloads under `samples/`,
blockers in §26.

**Imagery playback (v2.0)** — blocked on GIBS returning empty frames for explicit
timestamps. It has to read each layer's advertised time values first.

**No new layers until Landfall has been used during a real storm** — anything
added now is a guess about what will matter in September.

## VERIFY BEFORE BUILDING ON

- `[VERIFY]` NHC parse details live — `movementSpeed` units (knots assumed), the
  PTC/PT classification mapping, `advNum` presence. Marked in `data/nhc.js`.
- Does the NOAA radar mosaic cover Hawaii and Puerto Rico? 0.06–0.08% is
  ambiguous between no coverage and clear skies. Re-probe on a day they have weather.
- Tuning numbers never checked against reality: `COAST_BAND.halfWidthKm` (50 km)
  and the tile-boundary thresholds; `LABEL_PLACEMENT`'s `spokeStartPx`,
  `charWidthPx`, `dotClearPx` against a busy basin; the model deck's >90% filter
  reduction, measured on synthetic input only.
- TCGP's fresh data sits behind a host with `hurricanes-beta` in its path. If
  `/api/tcgp/adeck` starts 404ing everywhere at once, check that first.
