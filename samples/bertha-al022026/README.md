# Bertha (AL022026) — real advisory capture

Real NHC advisory text for **Tropical Storm Bertha**, the 2nd Atlantic storm of
2026. She formed off the Florida panhandle, crossed the northern Gulf, and came
ashore in Louisiana as a weak (peak 45 kt) tropical storm, July 19–23 2026.

**Why she is here.** GDACS carries no watches or warnings, and NHC's live
watch/warning map layer returned **zero features** for every storm present when
the app was built (`spec-parameter.md` §30.4) — so the watch/warning parser has
**never seen real data**. Bertha put a real home (northern Gulf coast) under a
real Tropical Storm Warning, so her advisories are the first real target that
product has. She dissipated before this capture, so her live geometry is gone;
this is the text record.

## Provenance

Captured 2026-08-09 by the archive runner (`tools/archive-fetch.mjs`, a GitHub
Actions job with open internet — a session cannot reach `nhc.noaa.gov`) from
NHC's 2026 advisory archive under `https://www.nhc.noaa.gov/archive/2026/al02/`.
The `.shtml` products were unwrapped to their `<pre>` text.

- `watch-warning.txt` — all 19 **Public Advisories** distilled to the
  headline + `CHANGES IN WATCHES AND WARNINGS` + `SUMMARY OF WATCHES AND
  WARNINGS IN EFFECT`. The boilerplate was dropped. This is the watch/warning
  record — the data GDACS never carries and our parser has never seen.

The 19 **Forecast/Advisories** (TCM — position, movement, pressure, max wind +
gusts, and the **34 kt wind radii** per quadrant; the real input for the wind-
field / at-home-exposure / intensity work) are **not committed here** — hand-
copying 1,100 lines of fixed-column text through the write API risks silently
corrupting a fixture, and they are cheaply re-fetchable. To re-capture verbatim:
add `https://www.nhc.noaa.gov/archive/2026/al02/al022026.fstadv.NNN.shtml`
(NNN = 001..019) to `tools/archive-fetch.mjs`, dispatch the `archive` workflow on
a working branch, and read the bytes off the `archive` branch. A representative
sample is inlined below so the format is on record regardless.

## What the watch/warning data actually is

Four product types appear over her life: **Tropical Storm Warning**, **Tropical
Storm Watch**, and a distinct **Storm Surge Watch** (advisories 5–6). A stronger
storm would add Hurricane and Storm Surge Warnings.

Lifecycle (all times CDT):

| Adv | Time | Watches / warnings in effect |
|---|---|---|
| 1–4 | Jul 19–20 | TS Watch, FL panhandle coast |
| 5–6 | Jul 20 | + Storm Surge Watch (AL/FL border → mouth of Mississippi); TS Watch widens |
| 7 | Jul 20 10pm | **First TS Warning** (AL/FL border → Plaquemines Parish LA) + surge watch + flank watches |
| 8–14 | Jul 21–22 | Warning shifts/widens toward LA; Metro New Orleans, Lake Pontchartrain, Lake Maurepas named as their own zones |
| 15–18 | Jul 22–23 | Warning consolidates LA → Sargent TX; watch dropped |
| 19 | Jul 23 10pm | "No coastal watches or warnings in effect" — remnants, last advisory |

Structural truths that only real data showed:

1. **Zones are named coastal breakpoints, not coordinates** — e.g. "Okaloosa/
   Walton County Line, Florida to Morgan City, Louisiana." The text says *where*
   to a human; it cannot tell code whether a specific home is inside. That needs
   the breakpoint **geometry** (NHC MapServer layer 8, `tcww`), which is not in
   these files.
2. **Zones include metro areas and lakes**, not just coastline — "Metropolitan
   New Orleans," "Lake Maurepas." So "is home under a warning?" is not a nearest-
   coast test; it needs the real polygons/lines.
3. **Storm Surge Watch exists as text but not as a mappable vector product**
   (consistent with `SPEC-DATA.md` §4.8: surge is bands only). We can *say* it,
   not *draw* it.

Real wind-radii sample (fstadv 12, 45 kt storm):

```
MAX SUSTAINED WINDS  45 KT WITH GUSTS TO  55 KT.
34 KT....... 60NE  90SE  60SW  40NW.
```

## Forecast/Advisory format (one full sample, Advisory 10)

```
TROPICAL STORM BERTHA FORECAST/ADVISORY NUMBER  10
NWS NATIONAL HURRICANE CENTER MIAMI FL       AL022026
2100 UTC TUE JUL 21 2026

TROPICAL STORM CENTER LOCATED NEAR 29.4N  87.2W AT 21/2100Z
PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   5 KT
ESTIMATED MINIMUM CENTRAL PRESSURE  995 MB
MAX SUSTAINED WINDS  50 KT WITH GUSTS TO  60 KT.
50 KT.......  0NE  40SE   0SW   0NW.
34 KT....... 70NE 100SE  40SW  40NW.

FORECAST VALID 22/0600Z 29.6N  87.9W
MAX WIND  45 KT...GUSTS  55 KT.
34 KT... 60NE  90SE  50SW  40NW.
...
EXTENDED OUTLOOK. NOTE...ERRORS FOR TRACK HAVE AVERAGED NEAR 125 NM
ON DAY 4 AND 175 NM ON DAY 5...AND FOR INTENSITY NEAR 15 KT EACH DAY
```

Note the quadrant radii per threshold (`34 KT... NE SE SW NW` in nm — our exact
wind-field input), the per-forecast-hour radii, and NHC's own published track/
intensity error figures (raw material for the "honest uncertainty band" idea).

## Still needed (not captured here)

The watch/warning **geometry** (layer 8 `tcww` line features) — required to test
whether a specific home falls inside a warned zone. **This is no longer true and
is kept here only because the reasoning was wrong in an instructive way.** Layer
8 is indeed live-only, but NHC's GIS archive publishes the same lines with every
advisory, and Ida's are committed under `samples/ida-al092021/gis/`. "The app's
usual source cannot answer" was mistaken for "the data does not exist".
