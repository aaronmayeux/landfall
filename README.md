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
MapLibre GL JS for the map, Three.js for the globe, both from a pinned CDN.
Hosted on Cloudflare Pages; the only server-side code is a handful of small
Pages Functions that forward and cache upstream requests, plus one cron Worker
that warms the cache so 300 datacentres don't each hammer NOAA.

Basemap tiles are OpenFreeMap (OpenMapTiles vector tiles), styled here.

## Running locally

No toolchain, no install. Any static server:

```
python3 -m http.server 8000
```

Then open http://localhost:8000

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
```

## Docs

The spec is split by how often a thing changes. Section numbers are permanent
addresses — a section may move between files, it may never be renumbered.

- **`SPEC.md`** — the root. What the app is, the stack, the failure rules, the
  colour contracts, and an index of where every other section lives.
- **`SPEC-DATA.md`** — sources, relay, merge, geometry, imagery, polling, caching.
- **`SPEC-MAP.md`** — layers, the globe, severity encoding, basemap tiles.
- **`SPEC-UI.md`** — screens, the drawer, the storm list, the detail panel.
- **`SPEC-OPS.md`** — running it in public: disclaimers, CSP, telemetry, cost.
- **`SPEC-HAZARDS.md`** — the multi-hazard expansion. Scoped, not started.
- **`spec-parameter.md`** — the field reference. Every field NHC and GDACS
  publish, with types, units, sentinels and real sample payloads measured from
  live feeds. Written to be usable with no network.
- **`NOW.md`** — what's in flight right now. Nothing in it is a rule.

Every spec file describes the app as it is *right now*. They are not logs. When a
fact goes stale it gets deleted and replaced — `git log` is the history.

## Not a forecast product

Landfall displays official data from the agencies above. It is not an official
source and it does not issue forecasts. In an emergency, follow your local
authorities.
