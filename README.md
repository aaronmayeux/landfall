# Landfall

Live tropical cyclone data on a 3D globe. Installs to the home screen on iOS
and Android, runs in any desktop browser. No app stores.

**Live:** landfall.getgravitate.app

## Current state

Phase 1 — skeleton on glass. Globe renders with filled land, glowing
coastlines, depth fade, graticule, and the opening sequence. No storm data yet.

The basemap currently points at OpenFreeMap as scaffolding. The Cloudflare R2
bucket exists; the z0–8 `.pmtiles` file has not been built. Swapping over is
one flag: `TILES.useR2` in `config/constants.js`.

## Running locally

No build step. Any static server:

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Structure

```
config/   constants.js  tokens.js  motion.js    (imports nothing)
map/      globe.js  style-dark.js  graticule.js
ui/       status.js
main.js   wiring only
```

Imports point downward only. See SPEC.md for the full architecture.
