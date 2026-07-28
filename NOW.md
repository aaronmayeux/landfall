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

**Spec refactor** — splitting SPEC.md by how often things change. Done: §4 →
`SPEC-DATA.md`, §7/§9/§11 → `SPEC-MAP.md`, §8+§16 → `SPEC-UI.md`. Remaining:
§17 → `SPEC-OPS.md`, §14+§15 → this file, then SPEC.md cut back to the laws plus
the index and the SETTLED list. README.md is badly stale and needs rewriting last.

---

## NEXT UP

**Watch DOLPHIN (12W) finish.** The `declared` end path has never fired on a real
storm. If she gets a real JTWC final warning, it's proven. If JTWC walks away
mid-sequence as it did with NOUL, the JTWC-absence rule needs building — a GDACS
storm absent from a credible JTWC index across `ENDED.absentConfirmations` clean
polls, **gated on the storm already being `silent`** so both agencies must agree.
Detection is client-side, so the app has to be open when it happens.

**Surge (Phase 6 step 3)** — not started. Bands only; there is no surge
watch/warning vector product anywhere in NHC's services.

**Wind arrival (Phase 6 step 4)** — not started. Fetch layers 18/19, never compute.

---

## NOT CONFIRMED ON GLASS

- Ended storms — does the grey read as *finished* rather than as *far away*, and
  does the flattened cage head look deliberate.
- The silence backstop.
- Radar coverage honesty (the measured-frame fix).
- `geoDetail: 3` frame budget on a mid-range phone.
- Model-track ambient legibility with a full basin up (~45 crossing lines).
- Whether five model lines read as a spread or as noise at phone width.

---

## OPEN BUGS AND GAPS

- **INP is over budget on the two most-touched things.** `maplibregl-canvas`
  376 ms, the disclaimer nudge button 496 ms. Both need the code read before any
  fix. Under 200 ms is the bar.
- **The LCP tail.** ~6% of visits are Poor; P99 was 8.6 s. Best lead is a Windows
  session with `longtask_ms` 27086, and an Android phone blocking the main thread
  483 ms across 3 long tasks at startup. Not chased.
- **Past GDACS beads are still derived** — class midpoint, never displayed.
  Candidate is the TCGP a-deck's `CARQ` rows (negative forecast hours, real
  `VMAX`, on an endpoint already relayed).
- **`overallStatus` returns `ok`, not `clear`, when the only storms held are
  ended ones.** Deliberate for now — `clear` would trigger an all-clear message
  while a grey dot sits on the globe.
- **Wind swath is not persisted** for ended storms, only the track.
- **The pill in the triple state** — "1 active · 1 not updating · 1 ended" — is
  long at 390 px.
- **Why does a past track sometimes arrive in pieces?** Observed live on an NHC
  storm, never explained. Drawing the pieces separately is safe; if NOAA is
  publishing two descriptions of one history there is probably a right one to pick.
- **No in-flight request coalescing** on imagery. Two identical concurrent
  requests both hit the network.
- `marker-home.js` is over the ~700-line ceiling. Split it the next time it needs
  a real change.

---

## DECISIONS WAITING ON AARON

- **CSP is still Report-Only.** Flip it after one normal session with imagery on
  and a storm selected reports nothing — and **not** in the days before a
  deliberate traffic spike.
- **Cloudflare Workers Paid, $5/mo.** Realistic budget is ~1,200–1,500 KV
  writes/day against a 1,000/day free tier. Decide before a storm, not during one.
- **Cloudflare Web Analytics' own RUM script** logs permanent CSP violations
  because neither host is in the policy. Either turn the feature off in the
  dashboard (D1 telemetry already covers it, and it's a third-party script on the
  critical path) or add both hosts to `script-src` and `connect-src` in `_headers`.
- **`[DECIDE]`** fade model guidance past ~72 h so the near-term cluster reads first.
- **`[DECIDE]`** rebuild the cone by sweeping recovered radii along the curved
  spine. Deferred — bending a federal uncertainty product changes the answer to
  "is my town in the cone".
- **`[DECIDE]`** whether the forecaster discussion (TCD) earns a second drawer
  section. One constant away: `ADVISORY_TEXT.kind`.

---

## SCOPED, NOT STARTED

**Multi-hazard expansion** — earthquakes, floods, volcanoes, drought, wildfire.
Full spec in `SPEC-HAZARDS.md`, real payloads committed under `samples/`.
Recommended order: earthquakes (best data, CORS-open, small, and the plate
boundaries make it look finished immediately), volcanoes, wildfire, flood,
drought. Blockers listed in `SPEC-HAZARDS.md` §8.

**Imagery playback (v2.0)** — blocked on the fact that requesting a specific
timestamp from GIBS returns empty frames unpredictably, so it cannot simply step
backwards from now. It has to read each layer's advertised time values first.

---

## VERIFY BEFORE BUILDING ON

- Is `github.com/aaronmayeux/landfall` still public? An anonymous clone failed
  once. Cloudflare Pages needs its own access either way.
- Does the NOAA radar mosaic cover Hawaii and Puerto Rico? 0.06–0.08% is ambiguous
  between no-coverage and clear skies. Re-probe when those regions have weather.
- `COAST_BAND.halfWidthKm` (50 km) against the real OpenFreeMap tile coast.
- The tile-boundary filter thresholds against real OpenMapTiles edges.
- Real payload and parse cost of a mature model deck on a phone — the >90% filter
  reduction is measured on synthetic input only.
