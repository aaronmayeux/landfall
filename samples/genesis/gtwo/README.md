# samples/genesis/gtwo — NHC's Graphical Tropical Weather Outlook, as published

Every file here is **bytes NHC actually served**, lifted off the `archive`
branch and not touched afterwards. Nothing is hand-tidied and nothing is
fabricated. The same rule as `samples/outlook-text/README.md`, for the same
reason: a parser proven against bytes somebody imagined has no standing to
replace a source that is currently working.

The KMZ is a zip holding one KML and four PNG icons. The `.kml` files here are
that KML, extracted. The `.b64` file is the whole zip, kept so the unzip step
has something real to run against too.

| File | Where it came from | Why it is here |
|---|---|---|
| `epacific-two-areas.kml` | `latest/nhc-gtwo-epacific.kmz.b64`, issued Wed Aug 19 05:25:08 2026 | The ordinary case. Two watched areas, one of them carrying a current-position point. |
| `epacific-with-track.kml` | `history/2026-08-18T170000Z/`, issued Tue Aug 18 17:39:14 2026 | The same two areas an advisory earlier, when the disturbance point sat OUTSIDE its own area and NHC published a `LineString` as well. The only fixture in the repo containing one. |
| `atlantic-all-clear.kml` | `latest/nhc-gtwo-atlantic.kmz.b64`, issued Wed Aug 19 05:25:08 2026 | A basin with nothing being watched. Carries the all-clear as a SENTENCE, which is the thing an empty GIS layer cannot do. |
| `atlantic.kmz.b64` | `latest/nhc-gtwo-atlantic.kmz.b64` | The zip container itself, base64 as the archive stores it. |

## What the KMZ carries that GIS layer 3 does not

Measured across all 72 hours in the archive window on 2026-08-19, comparing
these bytes against `nhc-genesis-areas.geojson` from the same hour:

- **The geometry is the same.** Same vertex counts, agreeing to roughly nine
  decimal places — the same forecaster run, published twice. Both paths carry
  the same issue stamp to the minute.
- **NHC's own name for each area** — `South-Southwest of Mexico`,
  `Central Pacific`. Layer 3 publishes no name at all, which is why
  `lib/genesis.js` computes a description from the centroid instead.
- **The forecaster's paragraph**, attached to the polygon it describes.
- **A disturbance number on every placemark**, which joins an area to its
  current-position point. Layer 2's inability to be joined is the whole reason
  `GENESIS.anchorLayer` records it as not fetched.
- **An unlabelled `LineString`**, present in 23 of the 72 hours and in no GIS
  layer we read.

## The LineString is a hypothesis, not a fact

It carries no name, no `ExtendedData` and no disturbance number. In all four
hours tested it was present exactly when a disturbance's current position sat
outside its own watched area and absent when the position was inside, starting
about half a degree ahead of that position and running roughly six degrees
west-northwest. That reads like a short motion path. **Four samples, one
disturbance, one basin — treat it as unconfirmed until it is seen elsewhere.**
The parser therefore carries it through as `tracks` and labels nothing.
