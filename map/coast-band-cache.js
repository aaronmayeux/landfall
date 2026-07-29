/**
 * coast-band-cache.js — keeps the BEST band select achieved so far, per storm.
 *
 * WHY THIS EXISTS. Coastline vertices come from LOADED tiles only
 * (map/coast-source.js). That makes any single select a function of where the
 * camera happened to be:
 *
 *   zoomed into the warning area -> detailed coast -> a rich painted band
 *   zoomed out to the basin      -> coarse tiles   -> a blockier band
 *   panned so half is off-screen -> half the coast -> a half-painted band
 *
 * Re-selecting on every camera move would therefore make the painted coast
 * visibly DEGRADE as you zoom out — geometry rewriting itself under the user
 * reads as a rendering bug, and per §5 a confident-looking wrong line is
 * worse than an honest one.
 *
 * THE RULE: A SELECT MAY ONLY IMPROVE. Keep the best result per storm;
 * replace it only when a new attempt is strictly better, so the painted coast
 * only ever gets sharper as tiles load.
 *
 * "Better" is: more painted features first, then more total painted length.
 * Length works as the quality signal because both ways a select improves —
 * more of the corridor's coast loaded, or the same coast at finer detail —
 * make the painted line longer. Vertex count breaks remaining ties.
 *
 * Invalidation is by advisory stamp: new NHC geometry means the old band
 * describes a warning that no longer exists, however good it was.
 *
 * Imports: map/ siblings + config. No DOM.
 */

import { coastGeneration, coastRings } from './coast-source.js';
import { bandSelect } from './coast-band.js';

/** stormKey -> { stamp, result, score, gen } */
const cache = new Map();

const KM_PER_DEG_LAT = 111.32;
const toRad = Math.PI / 180;

/** Planar km length of a MultiLineString's runs — a ranking number, not a
 *  measurement, so the cheap projection is fine. */
function paintedKm(feature) {
  if (feature.properties?._banded !== true) return 0;
  let km = 0;
  for (const run of feature.geometry.coordinates) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      const kmLon = KM_PER_DEG_LAT * Math.cos(a[1] * toRad);
      km += Math.hypot((b[0] - a[0]) * kmLon, (b[1] - a[1]) * KM_PER_DEG_LAT);
    }
  }
  return km;
}

function scoreOf(result) {
  let km = 0;
  let vertices = 0;
  for (const f of result.features) {
    km += paintedKm(f);
    if (f.properties?._banded === true) {
      for (const run of f.geometry.coordinates) vertices += run.length;
    }
  }
  return { painted: result.paintedCount, km, vertices };
}

function better(a, b) {
  if (!b) return true;
  if (a.painted !== b.painted) return a.painted > b.painted;
  if (a.km !== b.km) return a.km > b.km;
  return a.vertices > b.vertices;
}

/**
 * Band-select, or return a previously better select.
 *
 * @param {object} map        MapLibre map (queried for loaded coastline)
 * @param {string} key        cache key — storm id, or 'ambient'
 * @param {Array}  features   raw NHC watch/warning features
 * @param {string} stamp      advisory identity; a change clears the entry
 * @returns {{features, paintedCount, total, fromCache: boolean}}
 */
export function bandFor(map, key, features, stamp) {
  const list = features || [];
  if (!list.length) {
    cache.delete(key);
    return { features: [], paintedCount: 0, total: 0, fromCache: false };
  }

  const prev = cache.get(key);
  if (prev && prev.stamp !== stamp) cache.delete(key);

  const held = cache.get(key);

  /* ==> NOTHING HAS CHANGED, SO NEITHER HAS THE ANSWER. <==
   *
   * `gen` is the coastline substrate this held result was selected against
   * (map/coast-source.js). Same stamp AND same generation means a re-select
   * would walk the same tiles, buffer the same corridor and score the same
   * result, only to be told by `better()` that it is not an improvement.
   *
   * This is the hot path, not a corner: the stripe is re-decorated on every
   * selection, every layer push and every settled camera move, and each of
   * those calls used to pay a full ring decode plus a full band select for a
   * result already in hand. The one-way rule is unchanged — a genuinely new
   * generation still runs the select and still only replaces on improvement. */
  const gen = coastGeneration(map);
  if (held && held.gen === gen) {
    return { ...held.result, fromCache: true };
  }

  const { rings } = coastRings(map);

  /* No coast loaded right now. If a good band is already held, keep showing
   * it — it was selected from real coastline and is still correct geometry.
   * Otherwise fall through so the delivered chords are returned, flagged. */
  if (!rings.length && held) {
    /* Generation advanced too: a select against no coastline cannot beat what
     * is held, so re-asking on this same substrate is pure cost. */
    held.gen = gen;
    return { ...held.result, fromCache: true };
  }

  const attempt = bandSelect(list, rings);
  const score = scoreOf(attempt);

  if (!held || better(score, held.score)) {
    cache.set(key, { stamp, result: attempt, score, gen });
    return { ...attempt, fromCache: false };
  }

  /* The held result stays, but its generation moves forward: it has now been
   * tested against THIS substrate and won. Without this the early-out above
   * would never fire again for a storm whose first select was already the best
   * one, which is the common case once the coast is loaded. */
  held.gen = gen;
  return { ...held.result, fromCache: true };
}

/** Drop a storm's band — selection closed, or the storm left the feed. */
export function forgetBand(key) {
  cache.delete(key);
}

/** Drop everything. Used when the basemap style reloads and every cached
 *  band was selected from vertices that no longer exist. */
export function clearBands() {
  cache.clear();
}
