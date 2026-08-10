/**
 * coast-band-cache.js — the painted band, per storm AND per zoom.
 *
 * WHY THIS EXISTS. Coastline vertices come from LOADED tiles only
 * (map/coast-source.js). That makes any single select a function of where the
 * camera happened to be:
 *
 *   zoomed into the warning area -> detailed coast, but only what is on screen
 *   zoomed out to the basin      -> the whole corridor, coarsely
 *   panned so half is off-screen -> half the coast
 *
 * Re-selecting from scratch on every camera move would therefore make the
 * painted coast visibly rewrite itself under the user, which reads as a
 * rendering bug — and per §5 a confident-looking wrong line is worse than an
 * honest one.
 *
 * ===========================================================================
 * WHAT THIS FILE GOT WRONG, AND IT SHIPPED
 * ===========================================================================
 *
 * The first version held ONE best band per storm and replaced it only on a
 * strict improvement, scored by painted features, then painted km, then
 * vertices. That treats "best" as a single global thing. It is not.
 *
 * Zooming IN shows LESS coast in MORE detail. Painted feature count drops —
 * several warning lines have no coast on screen at all — which failed the
 * first test before length or detail was ever considered. So the sharper
 * select was computed on every settled camera move, scored, judged worse, and
 * thrown away, every time. The band froze at whatever zoom first covered the
 * most coastline, which is also the coarsest geometry the basemap has, while
 * the cyan coastline underneath it went on sharpening. Blown up to street
 * level that coarse geometry is straight chords cutting across marsh — a
 * stripe that cannot keep up with its own coast, and gaps that look like a
 * broken layer. Reported on glass 2026-08-10; invisible while the stripe was
 * a flat 8 px slab, obvious the moment it became a line on the coastline.
 *
 * ===========================================================================
 * THE SHAPE NOW: BUCKET BY ZOOM, ACCUMULATE WITHIN A BUCKET
 * ===========================================================================
 *
 * 1. ONE ENTRY PER (STORM, INTEGER ZOOM). This is what the basemap itself
 *    does — it draws a different coastline at each zoom rather than one best
 *    one, and a band selected from those vertices belongs to that zoom in
 *    exactly the same way. Zooming in computes a fresh band at the detail
 *    actually on screen; zooming back out finds the wide band still waiting.
 *    Nothing degrades, because nothing is overwritten.
 *
 * 2. WITHIN A BUCKET, RUNS ACCUMULATE — they are not contested. A winner-
 *    take-all rule inside a bucket has the same coverage blindness as before,
 *    one zoom level down: pan east and the new select covers the east with
 *    less total km than the held band covering the west, loses, and the coast
 *    the user is now looking at has no stripe on it. Merging is safe here in
 *    a way it never was across zooms: every run in one bucket came off the
 *    same tile zoom, so the geometry is consistent and the same coast
 *    selected twice yields byte-identical coordinates. Duplicates are
 *    dropped by signature.
 *
 * Invalidation is by advisory stamp, and it clears EVERY bucket for that
 * storm: new NHC geometry means every band held for it describes a warning
 * that no longer exists, however good it was.
 *
 * Entries are capped (`COAST_BAND.maxBandEntries`) and evicted least-recently
 * used, and each feature's accumulated runs are capped
 * (`COAST_BAND.maxBandVertices`). Buckets multiply by storms and a delta band
 * is thousands of vertices; unbounded is not an option on a phone. An
 * eviction costs one re-select, never a wrong line.
 *
 * Imports: map/ siblings + config. No DOM.
 */

import { COAST_BAND } from '../config/constants.js';
import { coastGeneration, coastRings } from './coast-source.js';
import { bandSelect } from './coast-band.js';

/** `${stormKey}\u0000z${bucket}` -> { key, stamp, result, gen, used } */
const cache = new Map();

/** Monotonic tick for LRU eviction. Not a clock — order is all that matters. */
let tick = 0;

/**
 * Which coastline is on screen, as an integer.
 *
 * Integer zoom because that is the granularity at which the basemap changes
 * the geometry it hands us: within one integer zoom the tiles are the same
 * tiles, so one bucket is exactly one substrate resolution.
 *
 * A map with no `getZoom` (the test stubs, and any caller before the map is
 * ready) collapses to a single bucket, which is the old behaviour minus the
 * contest — correct, just not zoom-aware.
 */
function zoomBucket(map) {
  const z = typeof map?.getZoom === 'function' ? map.getZoom() : null;
  return Number.isFinite(z) ? Math.floor(z) : 0;
}

const entryKey = (key, bucket) => `${key}\u0000z${bucket}`;

/** Every bucket held for one storm. */
function* bucketsOf(key) {
  const prefix = `${key}\u0000z`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) yield k;
}

function dropAllBuckets(key) {
  for (const k of [...bucketsOf(key)]) cache.delete(k);
}

/** Least-recently-used eviction. Runs after a write, so the entry just
 *  written is by definition the newest and cannot evict itself. */
function evictIfFull() {
  while (cache.size > COAST_BAND.maxBandEntries) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [k, v] of cache) {
      if (v.used < oldest) { oldest = v.used; oldestKey = k; }
    }
    if (oldestKey == null) return;
    cache.delete(oldestKey);
  }
}

/* ---------------------------------------------------------------------------
 * MERGING RUNS WITHIN A BUCKET
 *
 * A "run" is a chain of consecutive coast vertices inside the corridor. Two
 * selects on the same substrate produce identical arrays for the same stretch
 * of coast — same rings, same corridor test, same floats — so identity is an
 * exact test here rather than a tolerance. The signature is length plus both
 * endpoints: two genuinely different runs sharing all three is not a case
 * that occurs on real coastline, and the cost of being wrong is one duplicate
 * run drawn underneath an identical one.
 * ------------------------------------------------------------------------- */

function runSignature(run) {
  const a = run[0];
  const b = run[run.length - 1];
  return `${run.length}|${a[0]},${a[1]}|${b[0]},${b[1]}`;
}

const isBanded = (f) => f?.properties?._banded === true;

/**
 * Union of two features' runs, newest last, capped by vertex count.
 *
 * OLDEST GO FIRST WHEN THE CAP BITES. The newest runs are the ones selected
 * against the tiles nearest where the camera actually is, so they are the ones
 * the user is looking at. Dropping the far end of a pan is the right loss.
 */
function mergeRuns(heldRuns, freshRuns) {
  const seen = new Set();
  const out = [];
  let vertices = 0;

  for (const run of [...heldRuns, ...freshRuns]) {
    if (!run || run.length < 2) continue;
    const sig = runSignature(run);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(run);
    vertices += run.length;
  }

  while (vertices > COAST_BAND.maxBandVertices && out.length > 1) {
    vertices -= out.shift().length;
  }
  return out;
}

/**
 * Fold a fresh select into the bucket's held result.
 *
 * Returns `{ result, changed }`. `changed` is what tells the caller whether
 * anything reached the map this time — a settled camera that revealed no new
 * coast must not count as a redraw.
 */
function mergeInto(held, fresh) {
  /* The feature list is fixed for the life of a stamp, so a length change
   * means the caller handed us a different warning. Take the fresh one whole
   * rather than pairing features that are not the same features. */
  if (held.features.length !== fresh.features.length) {
    return { result: fresh, changed: true };
  }

  let changed = false;
  const features = held.features.map((h, i) => {
    const f = fresh.features[i];

    /* Nothing new: no coast in this feature's corridor on this substrate.
     * Keeps whatever was already painted, including a flagged fallback. */
    if (!isBanded(f)) return h;

    /* First real paint for this feature in this bucket. */
    if (!isBanded(h)) { changed = true; return f; }

    const runs = mergeRuns(h.geometry.coordinates, f.geometry.coordinates);
    if (runs.length === h.geometry.coordinates.length) return h;
    changed = true;
    return {
      ...h,
      geometry: { type: 'MultiLineString', coordinates: runs },
      properties: { ...h.properties, _banded: true, _bandRuns: runs.length },
    };
  });

  if (!changed) return { result: held, changed: false };

  return {
    result: {
      features,
      paintedCount: features.filter(isBanded).length,
      total: features.length,
    },
    changed: true,
  };
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------- */

/**
 * Band-select for the zoom currently on screen, folded into what that zoom
 * already had.
 *
 * @param {object} map        MapLibre map (queried for loaded coastline)
 * @param {string} key        cache key — storm id, or 'ambient'
 * @param {Array}  features   raw NHC watch/warning features
 * @param {string} stamp      advisory identity; a change clears every bucket
 * @returns {{features, paintedCount, total, fromCache: boolean}}
 */
export function bandFor(map, key, features, stamp) {
  const list = features || [];
  if (!list.length) {
    dropAllBuckets(key);
    return { features: [], paintedCount: 0, total: 0, fromCache: false };
  }

  /* A superseded warning is wrong at EVERY zoom, so the stamp clears the lot.
   * Checked against any surviving bucket, because the one for the current
   * zoom may simply not exist yet. */
  for (const k of bucketsOf(key)) {
    if (cache.get(k).stamp !== stamp) { dropAllBuckets(key); }
    break;
  }

  const ek = entryKey(key, zoomBucket(map));
  const held = cache.get(ek);
  if (held) held.used = ++tick;

  /* ==> NOTHING HAS CHANGED, SO NEITHER HAS THE ANSWER. <==
   *
   * `gen` is the coastline substrate this bucket was last folded against
   * (map/coast-source.js). Same generation means a re-select would walk the
   * same tiles, buffer the same corridor and produce runs already merged in.
   *
   * This is the hot path, not a corner: the stripe is re-decorated on every
   * selection, every layer push and every settled camera move, and each of
   * those calls used to pay a full ring decode plus a full band select for a
   * result already in hand. */
  const gen = coastGeneration(map);
  if (held && held.gen === gen) {
    return { ...held.result, fromCache: true };
  }

  const { rings } = coastRings(map);

  /* No coast loaded right now. A band already held for this zoom was selected
   * from real coastline and is still correct geometry, so keep showing it.
   * Otherwise fall through and the delivered chords come back, flagged. */
  if (!rings.length && held) {
    held.gen = gen;
    return { ...held.result, fromCache: true };
  }

  const attempt = bandSelect(list, rings);

  if (!held) {
    cache.set(ek, { key, stamp, result: attempt, gen, used: ++tick });
    evictIfFull();
    return { ...attempt, fromCache: false };
  }

  const { result, changed } = mergeInto(held.result, attempt);
  held.result = result;
  held.gen = gen;
  return { ...result, fromCache: !changed };
}

/**
 * Does the zoom currently on screen have no band for these keys yet?
 *
 * The one question map/layers/watch-warning.js needs in order to decide
 * whether its re-select is a REFINEMENT or a FIRST PAINT. A refinement can
 * wait behind the debounce — there is already correct geometry on screen for
 * this zoom, and collapsing a pinch's several moveends into one select is
 * worth a tenth of a second. A first paint cannot: what is on screen is the
 * previous zoom's band at the previous zoom's detail, and waiting only holds
 * the wrong geometry there for longer.
 *
 * Answered without decoding a single tile — it is a Map lookup.
 */
export function bandMissingFor(map, keys) {
  const bucket = zoomBucket(map);
  for (const key of keys) {
    if (key && !cache.has(entryKey(key, bucket))) return true;
  }
  return false;
}

/** Drop a storm's bands — selection closed, or the storm left the feed. */
export function forgetBand(key) {
  dropAllBuckets(key);
}

/** Drop everything. Used when the basemap style reloads and every cached
 *  band was selected from vertices that no longer exist. */
export function clearBands() {
  cache.clear();
}
