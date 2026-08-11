# Landfall

Live tropical cyclone data on a 3D globe. Installs to the home screen on iOS and
Android, runs in any desktop browser. No app stores.

**Live:** https://landfall.getgravitate.app

Every active storm worldwide, plotted on a see-through globe. Zoom in and the
globe crossfades into a detailed map carrying the forecast cone, the track, wind
fields, model guidance, satellite and radar imagery, and the forecaster's own
advisory text. Set a home and it tells you the closest approach.

## Where the data comes from

- **NHC** (US National Hurricane Center) — the Atlantic and East Pacific.
  Storm list, forecast geometry, wind fields, watches and warnings, advisory text.
- **GDACS** (the EU's global disaster system) — everywhere else.
- **JTWC** (US Joint Typhoon Warning Center) — forecast wind strength and final
  warnings for the storms GDACS carries.

Nothing is invented. When a source cannot answer, the app says which source and
why — it never shows an all-clear it hasn't earned.

## Built with

Vanilla JavaScript, ES modules, **no build step and there must never be one**.
MapLibre GL JS for the map, Three.js for the globe. Both are **vendored, not
loaded from a CDN** — `vendor/maplibre-gl-5.6.0.js` and
`vendor/three-0.128.0.min.js`, which `index.html` loads by relative path. They
are shipped application code and are deliberately not gitignored; a `vendor/`
ignore rule once swallowed them silently and deployed a black screen.

The only thing fetched from a third party at runtime is the basemap:
OpenFreeMap (OpenMapTiles vector tiles), styled here.

Hosted on Cloudflare Pages; the only server-side code is a handful of small
Pages Functions that forward and cache upstream requests, plus one cron Worker
that warms the cache so 300 datacentres don't each hammer NOAA.

## Running locally

No toolchain, no install. Any static server — but use **port 8099**, because
every browser check in `tools/` expects the app there:

```
python3 -m http.server 8099 --bind 127.0.0.1
```

Then open http://127.0.0.1:8099

In a cloud session, `bash tools/bootstrap.sh` does this and the rest of the
setup in one step.

## Structure

```
config/     constants, design tokens, motion, theme, layer manifest
            (imports nothing — every tunable number lives here)
lib/        pure logic, no DOM, no network — parsers, geometry, time, units
data/       fetching, caching, merging the two feeds, polling
map/        the globe, the map, and every drawn layer
ui/         views, the drawer, the status strip
functions/  Cloudflare Pages Functions — the relay and the tile proxy
worker/     the cron Worker that warms the cache
tools/      zero-dependency test suites and pre-push checks
main.js     wiring only
```

Imports point downward only. Any file crossing ~700 lines gets split.

Before pushing:

```
node tools/check-syntax.mjs
node tools/doc-check.mjs
```

`tools/bootstrap.sh` installs both as a pre-push hook, along with a scan for
committed credentials. A SyntaxError in an ES module is a blank screen in
production, not a broken feature — that check is not optional. `doc-check`
enforces the promise every spec file makes: that it describes the app as it is
right now. It checks that every file, function and section number the docs name
actually exists, and that §12's line-count table still matches `wc -l`.

## Docs

The spec is split by how often a thing changes. Section numbers are permanent
addresses — a section may move between files, it may never be renumbered.

- **`SPEC.md`** — the root. What the app is, the stack, the failure rules, the
  colour contracts, and an index of where every other section lives.
- **`SPEC-DATA.md`** — sources, relay, merge, geometry, imagery, polling, caching.
- **`SPEC-MAP.md`** — layers, the globe, severity encoding, basemap tiles.
- **`SPEC-UI.md`** — screens, the drawer, the storm list, the detail panel.
- **`SPEC-OPS.md`** — running it in public: disclaimers, CSP, telemetry, cost.
- **`spec-parameter.md`** — §27–§37, the field reference. Every field NHC and GDACS
  publish, with types, units, sentinels and real sample payloads measured from
  live feeds. Written to be usable with no network.
- **`SPEC-NEXT.md`** — §45–§47. The one file that describes what is *not* built:
  features that are agreed and specified but have not shipped. A section leaves it
  by shipping (it moves into the spec file that owns it, rewritten in the present
  tense) or by being cut. Everywhere else, the spec describes what is.
- **`NOW.md`** — what's in flight right now. Nothing in it is a rule.
- **`SPEC-INDEX.md`** — generated. Section number to file and line range, so you
  can jump to §17.7 instead of reading 61 KB to find it. Regenerate with
  `node tools/spec-index.mjs` whenever a heading changes; CI checks it is current.

The spec totals roughly 680 KB. **Do not read it whole** — start at `NOW.md` and
this README, then use `SPEC-INDEX.md` to open only the section you need.

Every spec file describes the app as it is *right now*. They are not logs. When a
fact goes stale it gets deleted and replaced — `git log` is the history.

## Not a forecast product

Landfall displays official data from the agencies above. It is not an official
source and it does not issue forecasts. In an emergency, follow your local
authorities.

## The `archive` branch

A GitHub Actions runner fetches NHC, GDACS, JTWC and our own relay every hour
and commits the raw bytes to the `archive` branch — including every response
header, which nothing else here can show you. It exists because a cloud session
can reach GitHub and npm and nothing else, so it cannot fetch a feed directly.

It also pulls the D1 telemetry straight from the Cloudflare API, so the numbers
do not depend on a connector being present in whatever session you are in.

```
git fetch origin archive
git show origin/archive:latest/nhc-currentstorms.json
git show origin/archive:latest/manifest.json
git show origin/archive:latest/telemetry/platform-rollup.json
```

The branch is data, not code. It is force-pushed as a **single commit** every
hour and holds a rolling **72-hour window** — one snapshot is about 297 KB, so
the branch settles around 20 MB of content and stops growing. Never merge it.

**Clone with `--single-branch --branch main`** (as `tools/bootstrap.sh` does),
or every clone drags the archive down with it.

