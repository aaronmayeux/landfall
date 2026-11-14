# archive — raw feed bytes, refreshed hourly

**This branch is data, not code. Never merge it into anything.**

It is rebuilt from scratch every hour by `.github/workflows/archive.yml` and
force-pushed as a single commit, so it has no history by design — the repo would
otherwise grow by 24 commits a day of near-identical JSON, forever.

## Why it exists

A cloud session reaches GitHub and npm and nothing else. It cannot `curl` NHC,
GDACS, JTWC, or even our own app. So "what exactly did the feed say" used to be
unanswerable from inside a session. A GitHub Actions runner has open internet.
This branch is what it brings back.

| Path | What it is |
|---|---|
| `latest/` | The most recent good copy of each source |
| `latest/manifest.json` | Status, timing, and **every response header** — including `X-Landfall-Cache`, which nothing inside a session can show you |
| `latest/telemetry/` | The D1 telemetry, pulled straight from the Cloudflare API |
| `latest/telemetry/platform-rollup.json` | **The Windows question** — blocked time per platform |
| `latest/telemetry/schema.json` | Ground truth for what the other queries can ask about |
| `latest/nhc-genesis-areas.geojson` | **§45 genesis** — NHC's seven-day potential development polygons, both horizons on each feature |
| `latest/nhc-genesis-anchors.geojson` | NHC's own label anchors for those polygons |
| `latest/jtwc-abpw.txt` | **§45 genesis** — the JTWC Significant Tropical Weather Advisory, plain text |
| `latest/geometry/` | **Per-storm GDACS polygons**, one file per current cyclone — cone, wind bands, the pre-merged swath, the centre dots, and the `Line_*` track segments whose `forecast` flag splits past from future. `latest/` only; see below |
| `latest/ships/` | **§47 the environment ribbon** — the SHIPS diagnostic per storm per synoptic hour. Roughly half are expected to be missing: two slots are asked for and usually only the older one is published yet |
| `latest/jtwc/` | **Per-storm JTWC products**, four per storm — the warning text (`…web.txt`), the Satellite Fix Bulletin (`…fix.txt`), the Navy's own plot file (`.tcw`) and the Google Earth overlay (`.kmz.b64`). The `.tcw` is the one worth reading: forecast wind radii per quadrant plus a nine-day best track with intensity. None of them carries PAST wind extent — measured, settled |
| `history/<UTC hour>/` | Hourly snapshots of everything above **except `geometry/`**, rolling 72-hour window |

## `latest/geometry/` plays by two different rules, on purpose

**It is not in `history/`.** One storm's polygons ran ~386 KB; a handful of live
storms is a megabyte or more an hour, and a 72-hour window of that is around a
hundred megabytes of near-identical shapes. The rolling window earns its size
for event lists and bulletins, where *when did this change* is a real question.
For geometry the question is always *what is the feed serving for this storm
right now*, and `latest/` answers it completely.

**It is rebuilt from scratch each hour, rather than keeping the last good copy.**
Every other path here holds a fixed set of sources, so stale-with-a-timestamp
beats blank. This one is a *mirror of the current storm set*, and its filenames
carry the event and episode ids — so carrying files forward would leave polygons
for storms that ended last week sitting beside this hour's, with nothing on the
filename saying which is which. It would also grow one file per episode per
storm, forever. A storm whose geometry fetch failed is simply absent, and
`manifest.json` carries the reason like every other failure.

The addresses are **GDACS's own**, taken from `url.geometry` on each event row
rather than built here — the episode id changes on every update, so there is no
fixed URL to list, and a link the source published keeps working if GDACS moves
the endpoint.

**NHC has no equivalent yet, and that is a gap rather than a decision.** Its
geometry is one ArcGIS query per layer per storm, and there has not been an
Atlantic or Pacific storm to point it at.

## Reading it without cloning

```
git fetch origin archive
git show origin/archive:latest/nhc-currentstorms.json
git show origin/archive:latest/manifest.json
```

Or just browse the `archive` branch on github.com from a phone.

## Telemetry

The Cloudflare MCP is the other way to reach this data, and it is not connected
in every session — on 2026-08-08 it was simply absent and nobody noticed until
someone went looking. A connector that can silently not be there is a bad single
route to the numbers that tell you whether the app is healthy. So the runner asks
Cloudflare's API directly, with a `D1 Read` token in the repository secrets, and
files the answers here where plain `git` reaches them from anything.

```
git show origin/archive:latest/telemetry/platform-rollup.json
git show origin/archive:latest/telemetry/manifest.json
```

Each query runs independently. One failing because a column moved does not cost
you the other six — `manifest.json` names the query, the SQL, and Cloudflare's
own error code. `state` is `ok`, `partial`, or `unavailable`, and if no token is
configured it says exactly that.

## Failure is stated, never blanked

A source that failed is **not** emptied in `latest/` — its previous good copy
stays put and `manifest.json` records `unavailable` with the reason. An empty
file reads as "no storms", and that confusion is exactly what SPEC §5 exists to
prevent. Check `fetchedAt` in the manifest against the clock before trusting
anything here.
