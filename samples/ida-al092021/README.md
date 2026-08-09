# Hurricane Ida (AL092021) — real advisory capture

NHC's complete Forecast/Advisory record for **Hurricane Ida**, the ninth
Atlantic storm of 2021, plus the post-season Tropical Cyclone Report that says
what actually happened. She came ashore at Port Fourchon, Louisiana at
**130 kt** on 29 August 2021, and her centre passed within about **11 nautical
miles** of Prairieville, Ascension Parish, that night.

**Why she is here.** The home dashboard's hero draws three nested wind bands —
34, 50 and 64 kt — and until this capture the 50 and 64 kt bands had **only
ever been rendered against a fabricated storm**. Bertha never reached hurricane
strength: she has no 64 kt field at all, her 50 kt field points away from the
house, and she crawls at 5 kt. Everything about a major hurricane crossing a
real home was untested. `tools/test-home-ida.mjs` is 163 assertions against
these bytes.

## Provenance

Captured 2026-08-09 by a one-shot GitHub Actions job (`tools/ida-capture.mjs`,
`.github/workflows/ida-capture.yml` — a runner has open internet; a session
cannot reach `nhc.noaa.gov`) from NHC's 2021 advisory archive under
`https://www.nhc.noaa.gov/archive/2021/al09/`. The `.shtml` products were
unwrapped to their `<pre>` text and are otherwise **byte for byte what NHC
published**.

Nothing here was transcribed by hand. Bertha's README notes the risk of
hand-copying fixed-column text through a write API; this capture removes it,
and `tools/tcm-fixture.mjs` reads the files rather than a transcription of
them.

| Path | What it is |
|---|---|
| `fstadv/al092021.fstadv.001–019.txt` | All 19 Forecast/Advisories (TCM). Position, movement, pressure, max wind and gusts, **34/50/64 kt quadrant radii**, the full forecast track, and the watches and warnings in force. |
| `public/al092021.public.001–029.txt` | The Public Advisories, for the plain-language watch/warning record. Numbering runs past the TCMs because WPC continued them after Ida became a depression. |
| `tcr-AL092021_Ida.txt` | The Tropical Cyclone Report's text layer. Best track (Table 1), ship reports (Table 2), surface observations (Table 3). |
| `nhc-cone-radii-2021-table14.txt` | The cone circle radii **in force in 2021**, from Table 14 of NHC's 2020 verification report. |
| `home-zcta-70769.txt` | The Census Gazetteer ZCTA record for ZIP 70769, which is where "home" is. |
| `capture-manifest.json` | Every URL fetched, its HTTP status and byte count, including the ones that 404'd. |

The TCR **PDF** is not committed — it is roughly 40 MB of imagery. Only its
text layer is here. Re-fetch it from
`https://www.nhc.noaa.gov/data/tcr/AL092021_Ida.pdf`.

## Home

`30.30743 N, 90.940643 W` — the Census Gazetteer interior point for ZCTA
70769. That is within 0.2 nm of the "roughly 30.31, -90.94" the coordinate was
given as, so the given line was right. The suite reads it out of the fixture
rather than typing it, so it cannot drift.

## The advisory the mockup uses, and why

**Advisory 12, 0900 UTC Sun 29 August 2021** (4:00 AM CDT). Chosen against the
whole run rather than picked, and every other candidate fails at least one
condition:

| Adv | Issued | Wind | Closest pass | Lead | All three reach home? | Why not this one |
|---|---|---|---|---|---|---|
| 010 | 28/2100Z | 90 kt | 10.7 nm | +30.6 h | yes | Past the 30 h window, and 40 kt below her peak — the intensity ramp barely moves |
| 011 | 29/0300Z | 90 kt | 5.2 nm | +24.4 h | **no** — 64 kt never reaches | The one thing this session exists to test is missing |
| **012** | **29/0900Z** | **120 kt** | **0.2 nm** | **+18.7 h** | **yes** | **— the pick** |
| 013 | 29/1200Z | 130 kt | 0.6 nm | +15.5 h | yes | A *special* advisory, off the six-hourly cycle. A close second, and at her exact peak |
| 014 | 29/1500Z | 130 kt | 5.3 nm | +11.4 h | yes | Lead time falls under 12 h and the 64 kt window collapses to 0.8 h |
| 015 | 29/2100Z | 115 kt | 7.0 nm | +6.8 h | yes | She is already ashore; the pass is hours away, not a day |

Advisory 12 is the only candidate satisfying every condition without sitting on
a boundary. The lead time lands mid-window rather than at either edge; all
three thresholds are published at four forecast hours (0, 9, 21, 33) and all
three reach the house; she is a Cat 4 ten knots under her 130 kt peak on a
curve running Cat 4 → Cat 1 → TS → TD, so the category ramp spans four colours;
and it is an ordinary six-hourly advisory rather than a special, which is the
case the app meets four times a day.

Advisories 10–15 are all committed, so forecast churn is computable across the
approach, and 13 is in the set so the 130 kt peak advisory is on record
whichever one the mockup renders.

## What the forecast said, and what happened

| | Advisory 12 forecast | Best track (TCR Table 1) |
|---|---|---|
| Closest pass to home | **0.2 nm**, 30/0339Z | **11.3 nm**, 30/0353Z |
| Two-thirds error circle at that lead | 34.2 nm | — |
| Truth inside the band? | — | **yes**, with 23 nm to spare |
| Hurricane-force wind on the house | at least 5.1 h, from 30/0057Z | nearest anemometer measured **41 kt sustained, gusting 65 kt** |

**Ida's headline is not Bertha's, and that is the finding.** Bertha's every
point estimate was roughly twice too far out while every two-thirds band
contained the truth. Ida's Advisory 12 was 11 nm too **close** and 14 minutes
early — a better track forecast than the chart's own resolution, and wrong in
the opposite direction. The only claim that held on both storms is the one the
screen actually makes: **the two-thirds band contained the truth.** One storm
is not a sample, and the reason the band renders in the same block as the
figure is precisely that neither error direction is predictable in advance.

**The wind comparison needs its caveat stated, not buried.** The nearest
official observing site to home is Louisiana Regional Airport at Gonzales
(KREG), 8 nm south, which recorded 41 kt sustained with a 65 kt gust and a
979.0 mb minimum. The forecast put hurricane-force wind on the house for at
least five hours. These are not directly comparable: NHC's radii are the
largest **1-minute sustained** wind expected **anywhere in that quadrant**, and
a sheltered inland ASOS 8 nm away is not that. What the pair does say is that a
wind band is a forecast envelope and never a promise about one address — which
is why the app words an open-ended window as a floor and never rounds one up.

## Structural truths these bytes showed

1. **`tau` here is hours from ISSUANCE, not NHC's synoptic tau.** Advisory 12
   is issued at 0900Z with a forecast valid 1800Z, which this fixture calls
   tau 9. It is only ever a join key between a forecast point and its radii,
   and both come from the same document, so it agrees with itself — but do not
   read it as the number NHC's MapServer publishes.
2. **A special advisory renumbers the forecast hours.** Advisory 13 is issued
   off-cycle at 1200Z and its hours are 0, 6, 18, 30 rather than 0, 9, 21, 33.
   Anything assuming a fixed tau ladder is wrong.
3. **Thresholds stop being published one at a time, from the top down, while
   the house is still inside them.** By tau 21 Ida publishes no 64 kt field; by
   tau 33 only 34 kt survives. Every one of her 50 and 64 kt windows at home is
   therefore `openEnded` — closed at the last published hour, with the duration
   a floor rather than a measurement. **This is the first real storm to
   exercise that branch**; before Ida it existed only for the fabricated Cat 3
   that first found it.
4. **A threshold can be published at a later hour without being published
   now.** Advisories 1–5 forecast a 64 kt field days out while Ida is still a
   tropical storm with none. Leading absence is normal and is not a gap.
5. **Home is on Ida's WIDE flank, which is the opposite of Bertha.** New
   Orleans sat on Bertha's narrow north-west side, the only reason a 48 nm pass
   produced under three hours of wind. Prairieville sits where Ida's 34 kt
   field reaches 110–120 nm, which is why the answer here is 23 hours. Same
   code, same function, opposite answers — which is the argument for measuring
   the reach along the bearing that actually points at the house.

## What could NOT be captured

- **The watch/warning geometry** (NHC MapServer layer 8, `tcww`). Served only
  for *active* storms, so no archived hurricane can supply it. The advisory
  text names the zones — "Lake Pontchartrain", "Metropolitan New Orleans" —
  but naming a zone cannot tell code whether one house is inside it. Unchanged
  from Bertha's README: this waits for a live storm.
- **Observed wind radii.** The TCR publishes a best track of position, pressure
  and intensity, not a reanalysed wind field per quadrant per hour. So "how
  long was hurricane-force wind actually on this house" cannot be computed from
  anything here; the single-station observation above is the closest available
  answer and it is a different measurement.
- **Advisory issue times as a product history.** The gap between a warning
  being issued and the wind arriving is the most actionable figure in either
  archive, and it is still not computable in the app — layer 8 carries what is
  in force, not when it was issued, and nothing stores advisory history on
  device. These files *do* contain it (the Hurricane Warning first appears in
  Advisory 9), but only because they are a fixture.
- **A publication gap in the middle of a series.** No threshold in Ida's entire
  run stops and then restarts, and none does in Bertha's either. So the case
  where a crossing would be interpolated across hours NHC published nothing for
  is **untested against real data** and is deliberately not built for. Logged
  here rather than guarded, because a guard written against a case nobody has
  seen is a guess with a test attached.
