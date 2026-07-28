/**
 * lib/carq.js — the storm's OWN ANALYSED HISTORY, out of the a-deck.
 *
 * PURE. No fetch, no DOM, no globals. `data/carq.js` owns the network and
 * `data/gdacs-points.js` owns the stamping; this file only turns bytes into
 * numbers and answers one question about them.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 *
 * GDACS publishes no wind for its own history. Its past track points carry a
 * three-word class and nothing else, so `map/storm-mesh.js` falls back to the
 * middle of that class — about 110 kt for anything it calls a hurricane,
 * whatever the storm actually was. NOUL's ridge drew a full category above the
 * 85 kt peak GDACS itself published.
 *
 * `CARQ` rows are JTWC's answer. Their forecast hours are NEGATIVE, so each row
 * says where the storm WAS and how strong it WAS at that hour. Measured on
 * DOLPHIN (wp122026, read live 2026-07-28): 20 → 25 → 30 → 35 → 40 → 45 → 60 →
 * 75 → 100 kt across three days. That is a ridge with a shape, against a flat
 * slab of guesses.
 *
 * ===========================================================================
 * THREE THINGS IN THE REAL BYTES THAT A GUESSED PARSER GETS WRONG
 * ===========================================================================
 *
 * 1. **THE SAME MOMENT APPEARS IN FIVE CYCLES AND THEY DISAGREE.** Every cycle
 *    republishes the previous 24 hours at tau -24/-18/-12/-6, so one valid time
 *    is described by up to five rows. They are NOT copies — JTWC revises its own
 *    analysis afterwards. Measured: valid 2026-07-27 00Z reads `128N` in its own
 *    00Z cycle and `131N` in all four later ones. **The newest cycle wins**,
 *    because a later analysis is a correction of the earlier one, not a rival to
 *    it. Keying on valid time alone and taking whatever arrives last in file
 *    order would silently keep the stalest reading.
 *
 * 2. **EVERY TAU-0 ROW APPEARS THREE TIMES**, once per wind-radius threshold
 *    (34/50/64 kt), with identical position and vmax. Deduplication is not a
 *    tidy-up here: three identical entries would each be a candidate in the
 *    join and waste the comparison, and any future "how many analyses do we
 *    have" count would read three times the truth.
 *
 * 3. **A STORM CAN CROSS THE DATELINE MID-DECK.** DOLPHIN runs `1760W` →
 *    `1797E` → `1707E`. Longitudes are tenths of a degree with the hemisphere
 *    as a trailing letter, so the sign flips inside one storm's history. The
 *    position guard below therefore uses `greatCircleNm` and never a raw
 *    longitude difference, which would read that crossing as 350° of travel and
 *    reject every match on the far side.
 *
 * ===========================================================================
 * NEVER KEY ANYTHING OFF THE STORM NAME
 * ===========================================================================
 *
 * Column 27 walks `INVEST` → `TWELVE` → `DOLPHIN` across DOLPHIN's own deck —
 * one system through genesis, renamed twice. That is the same trap the
 * MapServer past-points layer carries (SPEC §4), reached by a different road.
 * The join below matches on TIME and PLACE, both of which are facts about the
 * storm rather than about what anybody had decided to call it that morning.
 */

import { atcfLatLon, parseDtg } from './adeck.js';
import { greatCircleNm } from './geo.js';

const HOUR_MS = 3600 * 1000;

/* Zero-based ATCF columns this file reads. Named because `parts[8]` three
 * screens from the format note is how a field-offset bug survives review. */
const COL = Object.freeze({
  DTG: 2,
  TECH: 4,
  TAU: 5,
  LAT: 6,
  LON: 7,
  VMAX: 8,
});

/**
 * NHC and JTWC both use 9999-style sentinels for "no value" on numeric fields,
 * and `lib/track-point.js` already refuses anything at or above 200 kt for the
 * same reason: the strongest storm ever recorded was under it, so a sentinel
 * that slipped through would peg a bead to full Cat 5 height on a row that has
 * no reading at all.
 */
const MAX_PLAUSIBLE_KT = 200;

/**
 * How far apart a CARQ analysis and a GDACS dot may sit and still be the same
 * storm at the same hour.
 *
 * The two agencies analyse independently, so their positions for one moment
 * differ by tens of miles routinely — that is normal disagreement, not a bad
 * match. What this rejects is a wind belonging to a DIFFERENT SYSTEM, which is
 * the only failure worth guarding against and is never subtle. Same number and
 * same reasoning as the JTWC wind join, deliberately: two guards on the same
 * question that disagree about the threshold are one guard and one bug.
 */
export const CARQ_MATCH_NM = 200;

/**
 * How far a CARQ analysis's valid time may sit from a GDACS dot's.
 *
 * Both publish on synoptic hours, so the normal case is an exact hit and this
 * is slack for rounding, not a search radius. Three hours is half the 6-hourly
 * cadence — wide enough that a stamp rounded to the wrong minute still lands,
 * narrow enough that a dot can never claim the NEXT analysis's wind, which
 * would shift a whole ridge one step along its own track.
 */
export const CARQ_MATCH_HOURS = 3;

/**
 * Parse the `CARQ` rows of an a-deck into one analysis per valid time.
 *
 * Returns `[{ at, lon, lat, windKt }]` sorted oldest first, where `at` is the
 * VALID time (cycle + tau), not the cycle. Empty array for empty, malformed or
 * non-CARQ input — never a throw, because this feeds a ridge that must degrade
 * to its old behaviour rather than take the globe down with it (§5).
 *
 * @param {string} text  raw a-deck text, CARQ rows only or mixed
 */
export function parseCarq(text) {
  const byValidTime = new Map();

  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    if (parts.length <= COL.VMAX) continue;
    if (parts[COL.TECH].trim() !== 'CARQ') continue;

    const cycleMs = parseDtg(parts[COL.DTG]);
    if (cycleMs == null) continue;

    const tau = Number(parts[COL.TAU]);
    if (!Number.isFinite(tau)) continue;
    /* ANALYSED HISTORY ONLY. Every CARQ row measured so far is tau <= 0, and
     * that is what makes it history rather than guidance. If UCAR ever files a
     * positive-tau CARQ row this refuses it rather than quietly drawing a
     * forecast as something the storm already did — the exact confusion the
     * relay's separate `?carq=1` mode exists to prevent. */
    if (tau > 0) continue;

    const lat = atcfLatLon(parts[COL.LAT]);
    const lon = atcfLatLon(parts[COL.LON]);
    if (lat == null || lon == null) continue;

    const vmax = Number(parts[COL.VMAX]);
    /* A zero vmax is "not analysed", not a calm storm. Dropping the row leaves
     * that dot on its existing class fallback, which is honest; stamping 0 kt
     * would flatten a real bead to the noise floor and claim we measured it. */
    if (!Number.isFinite(vmax) || vmax <= 0 || vmax >= MAX_PLAUSIBLE_KT) continue;

    const at = cycleMs + tau * HOUR_MS;

    /* NEWEST CYCLE WINS — see the header note. `>` and not `>=`, so among the
     * three identical tau-0 rows of one cycle the FIRST is kept and the result
     * is stable whatever order the file happens to arrive in. */
    const prev = byValidTime.get(at);
    if (prev && prev.cycleMs >= cycleMs) continue;
    byValidTime.set(at, { at, lon, lat, windKt: vmax, cycleMs });
  }

  return [...byValidTime.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ at, lon, lat, windKt }) => ({ at, lon, lat, windKt }));
}

/**
 * The analysed wind at one place and time, or null.
 *
 * BOTH GUARDS PREFER SILENCE. A dot with no match keeps the class fallback it
 * has always had, which is a known approximation; a dot given the wrong storm's
 * wind is a confident lie at full height and colour. The cost of refusing is a
 * bead that looks like it did yesterday.
 *
 * @param {Array<{at:number, lon:number, lat:number, windKt:number}>} analyses
 * @param {number} timeMs  the dot's own time
 * @param {number} lon     the dot's longitude
 * @param {number} lat     the dot's latitude
 * @returns {{windKt:number, at:number, distanceNm:number}|null}
 */
export function carqWindAt(analyses, timeMs, lon, lat) {
  if (!Array.isArray(analyses) || !analyses.length) return null;
  if (!Number.isFinite(timeMs) || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const tolerance = CARQ_MATCH_HOURS * HOUR_MS;
  let best = null;
  let bestGap = Infinity;

  for (const a of analyses) {
    const gap = Math.abs(a.at - timeMs);
    if (gap > tolerance) continue;
    /* NEAREST IN TIME, then first-wins on an exact tie. Time is the primary
     * key because both sources publish on the same synoptic clock; picking by
     * distance instead would let a slow-moving storm's neighbouring hour win
     * whenever the two agencies happened to agree more closely about the wrong
     * moment than the right one. */
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = a;
  }

  if (!best) return null;

  /* GREAT CIRCLE, NEVER A COORDINATE DIFFERENCE — DOLPHIN's own deck crosses
   * the dateline, so `lon` legitimately jumps from +179.7 to -176.0 inside one
   * storm's history and a subtraction would read that as most of the planet. */
  const distanceNm = greatCircleNm(best.lon, best.lat, lon, lat);
  if (!Number.isFinite(distanceNm) || distanceNm > CARQ_MATCH_NM) return null;

  return { windKt: best.windKt, at: best.at, distanceNm };
}
