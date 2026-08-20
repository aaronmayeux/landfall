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
 * ==> IT IS ONLY EVER ASKED WHEN A FRAME CAME BACK EMPTY. <== Which is why it
 * costs nothing in the common case and never gates a request. A storm whose
 * frame HAS weather in it needs no mask — the weather is the proof. That also
 * makes the mask's box alignment harmless: a storm near the edge of its own
 * frame could sit in a mask box that reads 'none' while its rainbands fall on a
 * covered coast nearby, and because the frame is drawn on its own merits, that
 * disagreement can never reach the screen.
 *
 * Imports: config/ and lib/ only. No map, no store.
 */

import { IMAGERY } from '../config/constants.js';
import { radarCoverageUrl, radarZoomFor } from '../lib/imagery.js';

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
 * One degree is roughly 111 km, which is small against every frame this asks
 * about (±156 km at the sharpest zoom the slider can reach) and large against
 * how far a storm moves between polls. The zoom is part of the key because a
 * different zoom is a different box, and a different box can genuinely have a
 * different answer.
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
export async function radarCoverage(lat, lon, radiusKm) {
  const z = radarZoomFor(lat, radiusKm);
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
  const res = await fetch(radarCoverageUrl(lat, lon, z, px), { mode: 'cors' });
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
 * The sentence for a set of radar discs that are ALL blank.
 *
 * ==> THIS USED TO BE ONE SENTENCE FOR THREE DIFFERENT FACTS, AND ONE OF THEM
 * WAS AN ALL-CLEAR NOBODY HAD EARNED. <== "No radar coverage for these storms"
 * was said whether radar was watching or not, because with a bounding box for a
 * coverage model there was no way to know. There is now.
 *
 * WRITTEN WORST-CASE-FIRST, AND THE ORDERING IS THE SAFETY PROPERTY. A mixed
 * set — one storm unwatched, one genuinely clear — must never be summarised
 * with the reassuring half. So any 'none' outranks a 'covered', and anything
 * unresolved outranks a clean sweep of 'covered'. Only a set where EVERY disc
 * is known-covered may say there is no rain.
 *
 * `null` verdicts are discs whose mask lookup has not landed yet, and they get
 * the same cautious wording as 'unknown'. That is correct rather than lazy: to
 * a person reading the row right now, not knowing yet and not being able to
 * find out are the same fact.
 *
 * Lives HERE, beside the three states, rather than inside map/imagery.js's
 * closure — the file that defines what a verdict means is the file that should
 * own what it reads like, and a pure function is one a test can hold to
 * account.
 */
export function radarEmptyMessage(verdicts) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  if (!list.length) return 'Radar is blank here and we could not check whether it reaches these storms';

  if (list.some((v) => v === 'none')) {
    return list.every((v) => v === 'none')
      ? 'No radar reaches these storms — a gap in what we can see, not an all-clear'
      : 'Some of these storms have no radar watching them — not an all-clear';
  }
  if (list.every((v) => v === 'covered')) {
    return 'Radar is watching and showing no rain near these storms';
  }
  return 'Radar is blank here and we could not check whether it reaches these storms';
}

/** Testing seam only — the cache is process-wide and a suite that ran two
 *  scenarios against it would read the first one's answer in the second. */
export function _resetRadarCoverage() {
  answers.clear();
  inFlight.clear();
}
