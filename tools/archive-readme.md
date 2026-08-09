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
| `history/<UTC hour>/` | Hourly snapshots of all of the above, rolling 72-hour window |

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
