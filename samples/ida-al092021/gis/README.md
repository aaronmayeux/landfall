# Ida's published geometry, per advisory

NHC's GIS archive for AL092021, converted from shapefile to GeoJSON by
`.github/workflows/ida-gis.yml` and committed. **35 advisories** — the
six-hourly ones and the intermediates that carry an `A` — plus the best track.

## ==> THIS CORRECTS A CLAIM THE SPEC MADE <==

`SPEC-HOME-PLAN.md` and both sample READMEs said the watch/warning **geometry**
could only come from a live storm, because NHC's MapServer serves layer 8
(`tcww`) for active storms only. That is true of the MapServer. It is **not**
true of the GIS archive, which has published the same coastal lines with every
advisory for years. `ww_wwlin.geojson` is in 34 of the 35 directories here.
The deferred question — *does this specific house fall inside a warned zone* —
is answerable against Ida today.

## Layout

```
gis/index.json          every advisory, its issue time and its files
gis/<adv>/              001, 001A, 002 … 019
  5day_pts.geojson      forecast points: position, wind, gust, category, tau
  5day_lin.geojson      the forecast track as one line
  5day_pgn.geojson      the PUBLISHED uncertainty cone polygon
  ww_wwlin.geojson      watch/warning lines, `TCWW` = TWA/TWR/HWA/HWR
  *_initialradii.geojson   the wind field NOW, 34/50/64 kt, per quadrant
  *_forecastradii.geojson  the wind field at every forecast hour
gis/best-track/         where she actually went, post-season
  AL092021_pts.geojson  38 six-hourly fixes, `DTG` + `INTENSITY` + `MSLP`
  AL092021_lin.geojson  the whole track
  AL092021_radii.geojson    observed wind radii per synoptic hour
  AL092021_windswath.geojson  the swept 34/50/64 kt envelope
```

6.8 MB. The source zips are not committed; only what came out of them.

## Field names are NHC's, and they arrive UPPER-case

The DBF gives `MAXWIND`; the MapServer service the app was written against
gives `maxwind`. Every parser in `data/` reads the lower-case name and finds
nothing otherwise — silently, producing a storm with no wind. The replay relay
(`functions/api/replay/`) lower-cases keys and does nothing else: no renaming,
no unit conversion, and **9999 sentinels are passed through untouched** for the
app's own `scrubSentinels` to handle, because a replay that pre-cleans is a
replay that has stopped testing the cleaner.

## `TAU` here is NHC's, and it is NOT the tau in the text fixtures

These files use NHC's synoptic tau — 0, 12, 24, 36 — measured from `SYNOPTIME`,
which runs three hours behind the advisory. `samples/ida-al092021/fstadv/`
parsed by `tools/tcm-fixture.mjs` uses hours from ISSUANCE — 0, 9, 21, 33. Both
are internally consistent because in each case the points and the radii come
from the same document and tau is only ever a join key. They are not the same
number and must never be compared across the two captures.

## Two slots the archive does not publish, and what is served instead

NHC publishes no *per-advisory* past track. `pastPoints` and `pastTrack` are the
**best track, cut at the replay clock** — real published data, cut at a real
moment, and the cut is the only thing the relay decides. Same for `windPast`.
`tools/test-replay.mjs` asserts nothing after the clock ever appears in them,
and that they grow as the clock moves.

## What is still missing

- **Surge.** Not an archive problem — the app does not draw surge at all
  (`SPEC-HOME-PLAN.md`, Phase 6 step 3). Deliberately out of the replay.
- **Advisory text is a separate capture.** `samples/ida-al092021/fstadv/` and
  `public/` hold the products; nothing joins them to these files yet, so the
  replay's detail panel has geometry without the forecaster's words.
