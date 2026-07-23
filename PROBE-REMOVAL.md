# Removing the coast probe — TEMPORARY DIAGNOSTIC

The coast probe is scaffolding, kept deliberately while the coast tracer has an
open bug (the wrong-way walk, SPEC §7). **Delete this whole file too when the
probe goes.** If the tracer is finished and this file still exists, the removal
was not done.

## Why it is still here

The tracer traces 9 of Bertha's 10 legs. Leg 2 walks the wrong way (49.8 km
chord → 448 km walk). Diagnosing that needs measurement on a live storm from a
phone, which is exactly what the probe provides and nothing else does. It comes
out when that bug is fixed and the stripe is confirmed on glass.

## What it costs while it stays

- One `URLSearchParams` read at boot when `?probe=coast` is absent.
- One module-level array assignment per stripe update (`lastRawFeatures`).
- Six `export` keywords on `map/coast-trace.js` internals that would otherwise
  be private.

Nothing runs on the render path. The O(n·m) scan only fires on a button tap.

## How to remove it — five edits

### 1. Delete the probe module

```
rm map/coast-probe.js
```

### 2. `main.js` — remove the imports

```js
/* TEMPORARY — coast tracing diagnostic. Both of these delete together. */
import { probe } from './map/coast-probe.js';
import { __rawStripeFeatures } from './map/layers/watch-warning.js';
```

### 3. `main.js` — remove the debug handle entry

Delete the `coastProbe` property and its comment from `window.__landfall`,
leaving the rest of the handle intact:

```js
    /* TEMPORARY (map/coast-probe.js): ... */
    coastProbe: () => probe(map, __rawStripeFeatures()),
```

### 4. `main.js` — remove the `?probe=coast` trigger block

The whole `if (new URLSearchParams(location.search).get('probe') === 'coast')`
block that mounts the orange button.

> After this, check whether `SPACE`, `SIZE`, `FONT`, `DARK` are still used
> elsewhere in `main.js` before touching the token import on line 15 — they
> almost certainly are, so it probably stays as-is.

### 5. `map/layers/watch-warning.js` — remove the raw-feature hook

Delete:

```js
/* TEMPORARY (coast-probe.js): the raw delivered features ... */
let lastRawFeatures = [];
export function __rawStripeFeatures() {
  return lastRawFeatures;
}
```

and the first line of `decorated()`:

```js
  if (fc?.features?.length) lastRawFeatures = fc.features;
```

### 6. `map/coast-trace.js` — un-export the internals

These were exported **only** so the probe could re-run the walk leg by leg.
Revert each to a plain `function` declaration:

- `haversineKm`
- `pathLengthKm`
- `stitchRings`
- `nearestVertex`
- `walkBetween`
- `linePositions`

`traceSegments` stays exported — that is the real entry point.

## Verify

```
node tools/check-syntax.mjs      # must report all modules parse
grep -rn "coast-probe\|__rawStripeFeatures\|probe=coast" --include="*.js" .
rm PROBE-REMOVAL.md
```

The grep must come back empty.
