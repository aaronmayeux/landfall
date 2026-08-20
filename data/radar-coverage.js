/**
 * radar-coverage.js — does anything actually watch this patch of ground?
 * (SPEC §4, §4.9)
 *
 * ==> THE QUESTION THIS FILE EXISTS TO ANSWER IS THE DIFFERENCE BETWEEN "NO
 * RADAR HERE" AND "NO RAIN HERE", WHICH ARE THE SAME TRANSPARENT PNG. <==
 *
 * Radar is single-source now. NOAA's answer to this question was a bounding box
 * in a constants file — a hand-written rectangle claiming to describe a radar
 * network, wrong in both directions, with no southern hemisphere in it. It is
 * deleted. RainViewer publishes a MASK of where its radars are, and the service
 * is the only honest authority on that.
 *
 * THE MASK IS INVERTED FROM WHAT YOU EXPECT. Transparent means radar coverage
 * EXISTS; opaque means it does not. So this file counts the OPAQUE pixels, and
 * a high count is bad news.
 *
 * THREE STATES, AND THE THIRD ONE IS THE POINT:
 *
 *   'covered'   radar reaches this box. A blank frame here is real: no rain.
 *   'none'      no radar reaches this box. A blank frame here means nobody is
 *               looking, and saying "clear" would be a lie.
 *   'unknown'   the mask did not load. NOT the same as 'none' and it must never
 *               collapse into it — the whole §5 rule is that we say what we do
 *               not know rather than filling it in with the reassuring answer.
 *
 * ==> IT USED TO BE A SECOND OPINION. IT IS NOW THE ONLY ONE. <== While radar
 * was a per-storm disc the app measured each frame's own alpha, so the mask was
 * only consulted to explain a frame already known to be blank. Radar is a tile
 * layer now (map/radar-layer.js) — there is no single frame and no canvas, and
 * nothing anywhere can see whether rain is present. So this file is the whole of
 * what stands between an empty screen and an all-clear over ground nobody
 * watches, and it is asked about every live storm rather than only about a
 * blank one.
 *
 * It still never gates anything. The tiles load regardless; this only decides
 * what the status row is allowed to say.
 *
 * Imports: config/ and lib/ only. No map, no store.
 */

import { IMAGERY } from '../config/constants.js';
import { radarCoverageUrl } from '../lib/imagery.js';

/**
 * SESSION-LIFETIME, and deliberately not persisted.
 *
 * This is geography — it changes when a country joins or leaves the composite,
 * which RainViewer says is rare — so the edge holds it for a day and the tab
 * holds it until it closes. Persisting it to storage would buy one request per
 * session and inherit a whole invalidation problem for a value that is already
 * cheap.
 *
 * BOUNDED, like every cache in this project (§7). The key is a rounded cell
 * rather than an exact coordinate, so a storm drifting through a region reuses
 * one entry instead of minting a new one per poll — without that, "bounded"
 * would just mean "evicts constantly".
 */
const answers = new Map();
const MAX_ENTRIES = 64;

/**
 * How coarsely coordinates are binned into a cache key, in degrees.
 *
 * One degree is roughly 111 km, which is small against the coverage box this
 * asks about (a z5 tile, roughly 626 km across at the equator) and large
 * against how far a storm moves between polls. The zoom is part of the key even though
 * it is fixed today — a different zoom is a different box and can genuinely have
 * a different answer, and a key that silently ignored it would hand back the
 * wrong cached verdict the day it moves.
 */
const CELL_DEG = 1;

const cellKey = (lat, lon, z) => `${z}:${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;

/** In-flight requests, so twelve storms in one region open one fetch rather
 *  than twelve. Same coalescing the frame path does, same reason. */
const inFlight = new Map();

/**
 * The coverage verdict for one storm's frame — 'covered', 'none' or 'unknown'.
 *
 * NEVER THROWS. Every failure path returns 'unknown', because a caller that has
 * to write a try/catch around a question about safety wording is a caller that
 * will one day forget and default to the reassuring answer.
 */
export async function radarCoverage(lat, lon) {
  const z = IMAGERY.radar.coverageZoom;
  const key = cellKey(lat, lon, z);

  const known = answers.get(key);
  /* A previous 'unknown' is NOT an answer and is never cached — it means the
   * network failed, and the next poll deserves a fresh attempt. Only real
   * verdicts land in the map. */
  if (known) return known;

  if (inFlight.has(key)) return inFlight.get(key);

  const work = measure(lat, lon, z)
    .then((verdict) => {
      if (verdict !== 'unknown') remember(key, verdict);
      return verdict;
    })
    .catch(() => 'unknown')
    .finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

function remember(key, verdict) {
  /* Oldest out first. A Map iterates in insertion order, so the first key is
   * the oldest — no timestamps to keep and nothing to sort. */
  if (answers.size >= MAX_ENTRIES) {
    const oldest = answers.keys().next().value;
    if (oldest !== undefined) answers.delete(oldest);
  }
  answers.set(key, verdict);
}

/**
 * Fetch the mask and count what fraction of it is opaque.
 *
 * OWN CANVAS, NOT THE IMAGERY ONE. map/imagery.js keeps a reused canvas sized
 * to the frame it is drawing, and borrowing it would mean this measurement and
 * a live repaint could land on the same pixels in either order. A mask is
 * measured once per region per session, so allocating for it is not a cost
 * worth sharing a buffer to avoid.
 */
async function measure(lat, lon, z) {
  const px = IMAGERY.radar.requestPx;
  const res = await fetch(radarCoverageUrl(lat, lon, px), { mode: 'cors' });
  if (!res.ok) return 'unknown';

  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bmp.close?.();
    return 'unknown';
  }
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();

  let opaque = 0;
  const total = bmp.width * bmp.height;
  /* ALPHA IS THE WHOLE SIGNAL. The mask paints black where there is no radar
   * and leaves everything else transparent, so the colour channels carry no
   * information and reading them would only invite a threshold nobody can
   * justify. Anything not fully transparent counts as masked. */
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) opaque++;

  if (!total) return 'unknown';
  return verdictFor(opaque / total);
}

/**
 * The verdict for a measured opaque fraction.
 *
 * SPLIT OUT SO IT CAN BE TESTED WITHOUT A BROWSER. Everything above it needs a
 * canvas and a network; this is the whole of the decision, and it is the part
 * that can be wrong in a way nobody notices — a threshold off by a little turns
 * a real coastline into "no radar here", or worse, turns an empty ocean into
 * "radar is watching and it is clear".
 */
export function verdictFor(opaqueFraction) {
  if (!Number.isFinite(opaqueFraction)) return 'unknown';
  return opaqueFraction >= IMAGERY.radar.noCoverageFraction ? 'none' : 'covered';
}

/**
 * The coverage caveat for the storms on screen, or `''` when there is none.
 *
 * ==> IT CAN SAY THAT SOMETHING IS MISSING. IT CAN NEVER SAY THAT ANYTHING IS
 * CLEAR. <== That asymmetry is the point of the function and it is stricter
 * than the version it replaces.
 *
 * The old one had a branch reading "radar is watching and showing no rain",
 * which was reachable because a per-storm disc measured its own alpha and could
 * PROVE the frame was empty. A tile layer proves nothing of the kind — MapLibre
 * draws what arrives and nothing counts it — so that sentence lost its evidence
 * and is deleted rather than left to be true by habit. A future pass wanting it
 * back needs a measurement, not a rewording.
 *
 * WORST-CASE-FIRST, AND THE ORDERING IS THE SAFETY PROPERTY. A mixed set — one
 * storm unwatched, one fine — must never be summarised by its reassuring half.
 * Any 'none' outranks everything; anything unresolved outranks a clean sweep.
 *
 * ==> AN EMPTY STRING IS NOT A REASSURANCE, IT IS A REFUSAL TO COMMENT. <== It
 * means every storm sits inside a radar network, so the pixels can speak for
 * themselves. It does NOT mean the sky is clear, and nothing downstream may
 * render it as though it did.
 *
 * `null` verdicts are storms whose mask lookup has not landed yet, and they get
 * the same cautious treatment as 'unknown' — to a person reading the row right
 * now, not knowing yet and not being able to find out are the same fact.
 */
export function radarCoverageMessage(verdicts) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  /* Nothing to say about no storms. The layer is global, so radar being on with
   * nothing tracked is an ordinary state rather than a gap. */
  if (!list.length) return '';

  if (list.some((v) => v === 'none')) {
    return list.every((v) => v === 'none')
      ? 'No radar reaches these storms — a gap in what we can see, not an all-clear'
      : 'Some of these storms have no radar watching them — not an all-clear';
  }
  if (list.every((v) => v === 'covered')) return '';
  return 'Radar reaches some of these storms — we could not check the rest';
}

/** Testing seam only — the cache is process-wide and a suite that ran two
 *  scenarios against it would read the first one's answer in the second. */
export function _resetRadarCoverage() {
  answers.clear();
  inFlight.clear();
}
