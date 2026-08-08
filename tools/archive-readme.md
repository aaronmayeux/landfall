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
| `history/<UTC hour>/` | Hourly snapshots, rolling 72-hour window |

## Reading it without cloning

```
git fetch origin archive
git show origin/archive:latest/nhc-currentstorms.json
git show origin/archive:latest/manifest.json
```

Or just browse the `archive` branch on github.com from a phone.

## Failure is stated, never blanked

A source that failed is **not** emptied in `latest/` — its previous good copy
stays put and `manifest.json` records `unavailable` with the reason. An empty
file reads as "no storms", and that confusion is exactly what SPEC §5 exists to
prevent. Check `fetchedAt` in the manifest against the clock before trusting
anything here.
