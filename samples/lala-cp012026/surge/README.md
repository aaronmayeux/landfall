# Lala (CP012026) — peak storm surge, the first LIVE bytes

Captured 2026-08-16T23:27Z off the `archive` branch, which a GitHub Actions
runner fetches with open internet. Advisory 017, forecast cycle 2026081612.

Unfiltered — `where=1=1` against both layers, everything the Peak Storm Surge
service held at that moment. `maxAllowableOffset=0.001`, matching
`SURGE.offsetDeg`, so this is the same geometry the relay asks for.

- `peaksurge-polygons.geojson` — layer 2. **11 features.**
- `peaksurge-lines.geojson` — layer 1. **0 features**, and that is real, not a
  failed fetch: NHC published no coastal reaches for this storm. Kept so a test
  can prove an empty layer is handled as an answer rather than an error.

## Why this fixture exists when Milton's already did

Milton is 22 advisories and 460 features, and it is a **fixture we reshaped**
(`.github/scripts/milton-surge-shape.mjs`) into the normalized five-property
form. It proves the renderer. It cannot prove the READER, because the fields
it was built from are gone by the time the file is written.

This is the raw service response with NHC's own attribute names on it, so it
is the only thing that can settle what the live path actually reads.

## The three things it settled

**1. `popupinfo` carries the colour, and it is structured JSON.**

    "popupinfo": "{\"peak_surge_range\": \"1-2 ft\", \"color\": \"blue\"}"

Identical on all 11 features. `SURGE.liveColorFields` listed it first and
called itself "still a bet". It is no longer a bet.

**2. `symbolid` is `0` on every feature — an integer, exactly as the service
declares it, carrying no colour at all.**

This is not academic. The HA integration this app descends from reads
`symbolid`, searches it for a colour word, misses, and falls back to the
feature's INDEX in the list. Against these bytes that paints eleven bands that
are all genuinely blue (1-2 ft) as blue, yellow, orange, red, and then purple —
"Above 12 ft" — for the remaining seven, over Honolulu. Same data, same storm,
seven coastlines told a depth NHC never forecast. `tools/test-surge.mjs` fails
if anything here ever resolves severity from `symbolid` again.

**3. The service DOES publish a storm id, and every note in both projects said
it did not.**

    "idp_subset": "cp012026"
    "folderpath": "Peak Storm Surge Forecast: CP012026, adv: 017, ..."

`idp_subset` is the app's own storm id, same spelling, same case. The
"no stormid, so filter by a box around the position" rule came from scanning
the field list for a field literally named `stormid`, not finding one, and
stopping — a question answered from metadata instead of from rows, which is the
same mistake that had this whole feature written off as impossible for Hawaii
(the layer's published `extent` still described the previous Gulf storm).

`data/surge.js` matches on the id first and keeps the box as the fallback.

## What it does NOT settle

Every band here is blue and every feature is a polygon. This fixture cannot
exercise the colour ramp above blue, the range parser on a two-digit depth, or
the `line` branch. Milton covers all three. **Both fixtures are needed and
neither replaces the other.**
