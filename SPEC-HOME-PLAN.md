# SPEC-HOME-PLAN.md — the home dashboard

**A BUILD PLAN, NOT CANONICAL AS-BUILT.** This file houses the plan for reworking
home into a single-storm dashboard so the canonical specs don't carry a roadmap.
As pieces ship, they move into the real specs (home is `SPEC-UI.md` §8, the map
marker `SPEC-MAP.md` §9.10, the derived figures `data/home.js`) and leave here —
the same way genesis (§45) graduated out of `SPEC-NEXT.md`. When this file is
empty, delete it. Headings here are deliberately unnumbered so the index does not
mint fake section addresses.

## The idea

Today home is a *setup screen*: the FAB opens a search / locate / drop-a-pin
flow, and the only home data (distance, closest approach) lives buried in the
storm-detail panel. The rework makes home its own **place** — a single-storm
**dashboard** that answers "is this storm going to affect *me*, how badly, and
when?" — and demotes setup to an "Edit home" affordance in a corner.

Decisions already locked with Aaron:

- **All home data lives in the home FAB.** Leave the Distance / Closest-approach
  block in `ui/view-storm-detail.js` — but all new data will live in the new home FAB Drawer.
- **One storm at a time: the one bearing down.** Not a list. The dashboard shows
  the single threat storm; if nothing is bearing down, it drops to the next storm
  on the ranking; if the ocean is quiet, a calm "all clear at home" (never blank,
  per §5 — distinguish unavailable / none / clear).
- **Reachable two ways:** the home FAB, and tapping the home glyph on the globe
  (which today only recenters — it should recenter *and* open the dashboard).

## The threat pick (which storm)

Ported from the HA integration's `_threat_key`, which is the right altitude
because — like our storm list — it only has current-position data, not per-storm
forecast geometry:

1. **Closing first.** Use our own `motionTrend` (in `data/home.js`), which is
   richer than HA's raw within-90° test — it projects along the great circle with
   a deadband and returns closing / receding / null.
2. **Then nearest**, by current great-circle distance to home.

Take the top one. This is a **global** pick, distinct from the storm list's
basin-grouped sort (`ui/view-storms.js`) — only the dashboard uses it. GDACS
storms publish no heading, so they can never be "closing" and rank by distance
only; that is honest (don't invent a heading), but a GDACS storm bearing down
won't get the closing bump.

## What data we have (read the whole payload, 2026-08)

- **Current vitals** (every poll, no geometry fetch): wind, gust, pressure,
  heading, speed, category + `categorySource`, `nature`, `observedAt`.
- **Home-derived, already computed** (`data/home.js`): `distanceTo`,
  `closestApproach` (nm, ETA, wind-at-CPA, trend, relevant), `motionTrend`.
- **The forecast intensity curve — currently discarded.** The Forecast Points
  layer carries wind + gust + Saffir-Simpson category + storm-type at every
  12-hour step (a full 5-day curve), but `normalizeForecast` in
  `data/nhc-mapserver.js` keeps only `{lon,lat,time,windKt,tau}`. Keeping gust,
  category, and storm-type unlocks most of the ideas below for free.
- **Wind-field radii per forecast hour** — already fetched and carried
  (`forecastRadii` / `pastRadii` in the geometry bundle; the code even says "the
  at-home exposure timeline will want them later"). Feeds winds-at-home.
- **Past track** with measured intensity/pressure — the storm's life story.
- **Watch/warning** — see the Bertha findings below.

Intensity curve, gust, and category are **NHC-only**; a GDACS threat storm gets
an honest degraded version, never a faked curve.

## Novel insights (link data across time)

The unique idea: HA showed intensity and distance as two separate facts. Linking
them is the insight no forecast page states — *how strong is it when it's closest
to me?*

- **Category at closest pass** — sample the (newly-kept) intensity curve at the
  CPA time. The number that actually matters.
- **Peak vs. arrival** — is the forecast peak before or after closest pass?
  "Weakening as it approaches" vs "still strengthening when it arrives."
- **Prep countdown** — every forecast time as time-from-now, ticking live.
- **Honest uncertainty band** — CPA shown with NHC's track-error range
  ("closest ~180 mi (could be 80–280)"). On-brand for §5.
- **Winds-at-home arrival + duration** — from the radii-per-hour (HA's
  `_wind_report` + `_exposure_timeline`, ported in nm).

## The chart (rethink the HA bar)

HA's bar was chosen for a cramped card. Three directions, to judge on glass:

- **The Approach (radial)** — home at center, the storm's track curves inward;
  closest pass = nearest point to center. Most beautiful / animatable.
- **Linked time chart** — intensity lane over distance-to-home lane, one closest-
  approach marker crossing both. Most information.
- **Countdown timeline (vertical)** — now at top, events (winds arrive, closest
  pass, peak, winds ease) pinned by lead time. Clearest / most accessible; also
  the required keyboard + screen-reader form of whichever visual wins.

Lean: **Approach as the hero, countdown as its accessible twin.** A static mockup
against Bertha's real bytes is the next glass call before committing.

## Watch/warning — the Bertha findings

Real data in `samples/bertha-al022026/` (see its README). The parser has never
seen a real feature (0 features at build time). Key truths:

- Four product types: **TS Warning, TS Watch, Storm Surge Watch** (Hurricane /
  Storm Surge Warning for stronger storms). Fixed NWS colours cover all
  (`assets/hazards/`).
- Zones are **named coastal breakpoints** including **metro areas and lakes** —
  the text can't tell code whether a specific home is inside.
- To say "**your home is under a Tropical Storm Warning**" needs the watch/warning
  **geometry** (MapServer layer 8, `tcww`), which is served only for active
  storms. **Deferred: Aaron will pull layer 8 from a live storm himself if the
  feature needs it.** The text fixtures give us the semantics and lifecycle now.

## Phasing

- **Phase A — buildable and verifiable now** against any live storm: the FAB /
  drawer rework (dashboard + "Edit home" + globe-glyph opens it), the threat
  pick, vitals + trend, the intensity curve (stop discarding it), the approach
  visual + countdown, distance / closest approach, category-at-CPA, peak-vs-
  arrival, prep countdown, uncertainty band.
- **Phase B — held for a storm near home** (per NOW.md's standing rule — a storm
  half a planet away gives no way to tell a right answer from a plausible one):
  winds-at-home + the exposure/arrival windows (port `_wind_report` /
  `_exposure_timeline`), and the watch/warning "home is under a warning" line
  (needs live layer 8 geometry). Port the math now; light it up live later.

## Open decisions

- Hero visual: Approach / linked / countdown (glass call — build a mockup first).
- Which insights make the first cut (all are cheap; category-at-CPA is the
  headline).
- All-clear / receding copy when nothing is bearing down.
