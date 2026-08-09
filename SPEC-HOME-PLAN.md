# SPEC-HOME-PLAN.md — what is left of the home dashboard

**A BUILD PLAN, NOT CANONICAL AS-BUILT.** As pieces ship they move into the real
specs and leave here. When this file is empty, delete it.

**PHASE A HAS SHIPPED AND IS GONE FROM THIS FILE.** The dashboard, the threat
pick, the kept intensity curve, the linked-lane hero, the countdown, the
uncertainty band, category-at-CPA, peak-vs-arrival, the near-ring window, the
"Edit home" demotion and the globe glyph opening the dashboard are all built.
As-built is **`SPEC-UI.md` §8**; the derived figures are `data/home-dashboard.js`
and `lib/cone-error.js`; `tools/test-home.mjs` pins them against Bertha's real
Advisory 10. Read the spec, not this file, for how any of it works.

## The hero was chosen on glass, twice

**Round one: Option B, the linked lanes**, over a radial approach and a bare
countdown (`mockups/home.html`). The radial lost on geometry — an east-to-west
storm draws a flat line skimming under the centre and wastes the circle.

**Round two: the wind corridor, flipped, home on top** (`mockups/home-round2.html`
for the five concepts it came from, `mockups/home-corridor.html` for the built
result). It replaced Option B's strength lane outright, because the storm's own
wind is not what you feel. The three mockup files stay only as the record of
those comparisons; delete them once nobody is re-litigating.

**Still owed: a real hurricane.** The 50 and 64 kt bands have been rendered
only against a fabricated case. Ida (AL092021) is the intended first real test.

## PHASE B — held for a storm near home

Per NOW.md's standing rule: against a storm half a planet away there is no way
to tell a right answer from a plausible one. **The countdown already draws both
of these as a dashed row**, so the gap is visible rather than implied.

- **Winds-at-home: arrival, duration, and the exposure timeline.** Port HA's
  `_wind_report` and `_exposure_timeline` (in `geometry.py`) to nautical miles.
  The inputs are already fetched and carried — `forecastRadii` / `pastRadii` in
  the geometry bundle. Walk each tau's smooth ring against home. **This is the
  real answer to "when do I feel it"**; the 100-mile ring is a proxy that
  answers a different question and both should stand.
- **"Your home is under a Tropical Storm Warning."** Needs the watch/warning
  **geometry** — MapServer layer 8, `tcww` — which is served only for active
  storms. Deferred by decision: Aaron will pull layer 8 from a live storm when
  the feature needs it. The text fixtures in `samples/bertha-al022026/` already
  give the semantics and the lifecycle; what no code can yet check is whether a
  specific house falls inside a named breakpoint zone.

## Open, and only judgeable on glass

- **Does the ribbon read?** The band touching the home baseline is the whole
  argument for Option B. If it reads as decoration rather than as "it could come
  straight over you", the chart has failed at its one job and the countdown
  should become the hero.
- **Does the dashboard survive a 60 vh bottom sheet?** Hero plus headline plus
  countdown is a lot for the sheet's height cap, and the mockup carried a
  toggle for exactly this. If it does not, the options are a taller cap for this
  view or collapsing the vitals by default — not a shorter chart.
- **Is "Bearing down" the right chip** when the pick was made on closing but the
  storm is 900 miles away and barely gaining? The words may need a distance
  qualifier that the ranking does not have.

## Known gaps, logged not open

- **The near-ring threshold (100 statute miles) is a guess.** Nothing
  meteorological happens at that distance; it is the range at which most people
  stop reading a storm as somebody else's problem. `HOME_DASH.nearRingNm`.
- **`CONE_CIRCLE_NM_2026` goes stale every spring.** NHC republishes the radii
  each season. The year is in the constant's name so the staleness is visible;
  nothing yet *checks* it.
- **`categorySource` is now carried through the forecast curve but nothing
  renders the distinction.** NHC reports `ssnum` itself and we derive from knots
  when it cannot answer. The screen says "TS" either way. That is provenance
  quality, not a correctness bug (spec-parameter §35.2), and it is a real
  sentence the dashboard could earn later.
