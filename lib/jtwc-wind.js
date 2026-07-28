/**
 * jtwc-wind.js — JTWC's measured wind, joined onto a storm that has none.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * GDACS is the app's roster for every basin NHC does not cover, and GDACS
 * PUBLISHES NO CURRENT WIND SPEED. Not a null field — no field. Its only
 * number is a forecast PEAK (proven four ways in data/gdacs.js), and its only
 * present-tense reading is three words: Depression, Storm, Hurricane/Typhoon.
 *
 * Its strongest word is the problem. GDACS's top wind band is 120 km/h, which
 * IS the Cat 1 floor, so "Hurricane/Typhoon" covers everything from a marginal
 * Cat 1 to a 160 kt super typhoon. With no number behind it the cage fell back
 * to `representativeKt()` — the middle of that whole span, ~109 kt — for every
 * one of them.
 *
 * A USER FOUND THAT BEFORE WE DID, and the report was exactly right: a low-wind
 * storm in the GDACS basins stood TALLER than a measured Cat 4 in the NHC
 * basins. Confirmed live 2026-07-28 on DOLPHIN (12W): GDACS labelled its
 * forecast track "HU" — a 109 kt ridge — while JTWC had the storm at 45 kt.
 * §9 says elevation and colour are one signal from one number. The number was
 * not a measurement of anything.
 *
 * ===========================================================================
 * WHY JTWC, AND WHY IT DOES NOT REPLACE GDACS
 * ===========================================================================
 *
 * JTWC warns on the same basins GDACS covers, and GDACS's own records name it
 * as their source there. Crucially it publishes ONE-MINUTE SUSTAINED wind, the
 * same convention as NHC, so its knots land on the Saffir-Simpson thresholds
 * in config/constants.js with no conversion. Every regional centre (JMA and
 * the rest) publishes TEN-MINUTE sustained, which would need a fudge factor
 * applied to the one number the entire severity ramp reads.
 *
 * It is NOT a replacement for the GDACS list, and that was checked before this
 * was built rather than assumed:
 *
 *   - NO GEOMETRY. No cone polygon, no wind-band footprints, no past track.
 *     That is most of what the app draws outside the NHC basins.
 *   - IT DROPS A STORM AT THE FINAL WARNING, while GDACS keeps it. Building on
 *     JTWC's liveness is the exact trap functions/api/tcgp/storms.js already
 *     documents: an identifier borrowed from a third party is a second
 *     liveness condition nobody wrote down.
 *
 * So GDACS stays the roster and the geometry, and JTWC becomes the wind. Two
 * sources, each doing the thing it is actually best at.
 *
 * ===========================================================================
 * THE JOIN IS GUARDED TWICE, AND BOTH GUARDS PREFER SAYING NOTHING
 * ===========================================================================
 *
 * A missing wind costs resolution — the storm keeps the class midpoint it has
 * today, which is derived, documented, and never displayed as a measurement.
 * A WRONG wind is a §5 lie on the channel that drives height, colour and the
 * category badge at once. Those costs are not close, so every uncertain case
 * resolves to no match.
 *
 *   1. NAME, via lib/advisory.js `matchStormByName` — the same reconciliation
 *      the advisory-text feature has used since §15 ("NOUL-26" → "NOUL").
 *      Reused rather than rewritten so the two can never disagree about which
 *      JTWC entry belongs to which storm.
 *   2. POSITION. The matched fix must sit within JTWC_WIND.maxSeparationNm of
 *      the storm. This is the guard that earns its keep: when GDACS FREEZES on
 *      a storm and JTWC keeps warning (Noul, 2026-07-26), the two positions
 *      walk apart inside a cycle and the match is refused — so a live wind is
 *      never pasted onto a two-day-old position.
 *
 * Plus an age limit: a fix older than JTWC_WIND.maxFixAge is not "the wind
 * now" and is not used as one.
 *
 * There is deliberately NO position-only fallback for unnamed systems. It was
 * considered and dropped: an unnamed JTWC depression and an unnamed GDACS
 * event in the same neighbourhood is precisely the case where a confident
 * wrong answer is easiest to produce, and a fresh depression is the storm
 * where the midpoint fallback is closest to right anyway.
 *
 * ===========================================================================
 *
 * PURE. No fetching, no DOM, no clock of its own — `nowMs` is always a
 * parameter, for the same reason data/merge.js takes one: every storm in one
 * pass must be judged against the same instant, and a fixture test needs to
 * pin it.
 *
 * Imports: config/ and lib/ siblings. One direction, no cycle.
 */

import { JTWC_WIND } from '../config/constants.js';
import { matchStormByName } from './advisory.js';
import { categoryFromKt } from './category.js';
import { greatCircleNm } from './geo.js';

const finite = (v) => (Number.isFinite(v) ? v : null);

/** A JTWC fix is usable only if it carries a real wind at a real place. */
function usableFix(fix) {
  return (
    fix != null &&
    Number.isFinite(fix.windKt) &&
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon)
  );
}

/**
 * The JTWC index entry for this storm, or null.
 *
 * `reason` is returned alongside on failure because the difference between
 * "JTWC is not warning on this storm" and "JTWC is warning on it but the fix
 * is 30 hours old" is a real distinction and the console should be able to
 * state it (§5's three states, applied to a join rather than to a fetch).
 *
 * @param {object} storm      a normalized storm
 * @param {object[]} entries  `storms` out of /api/jtwc/storms
 * @param {number} nowMs
 * @returns {{entry: object|null, reason: string}}
 */
export function matchJtwcEntry(storm, entries, nowMs) {
  if (!storm || !Array.isArray(entries) || entries.length === 0) {
    return { entry: null, reason: 'no_index' };
  }

  const entry = matchStormByName(entries, storm.name);
  if (!entry) return { entry: null, reason: 'none_matched' };
  if (!usableFix(entry.fix)) return { entry: null, reason: 'no_fix' };

  const fixMs = Date.parse(entry.fix.at);
  if (!Number.isFinite(fixMs)) return { entry: null, reason: 'no_fix_time' };
  if (nowMs - fixMs > JTWC_WIND.maxFixAge) return { entry: null, reason: 'fix_too_old' };

  if (!Number.isFinite(storm.lat) || !Number.isFinite(storm.lon)) {
    return { entry: null, reason: 'storm_unpositioned' };
  }
  const sepNm = greatCircleNm(storm.lon, storm.lat, entry.fix.lon, entry.fix.lat);
  if (sepNm > JTWC_WIND.maxSeparationNm) {
    /* See the header. This is the frozen-GDACS case, not a bug. */
    return { entry: null, reason: 'too_far_apart' };
  }

  return { entry, reason: 'ok' };
}

/**
 * JTWC's FINAL-WARNING declaration for this storm, or null.
 *
 * ===========================================================================
 * WHY THIS MATCHES ON NAME ALONE WHEN `matchJtwcEntry` ABOVE DOES NOT
 * ===========================================================================
 *
 * This is the one intentional divergence in the file and it needs to be read
 * before anyone "fixes" it by routing this through the guarded match.
 *
 * The guards above exist because a WIND IS A MEASUREMENT OF A PLACE. Pasting
 * JTWC's 90 kt onto a position GDACS froze two days ago would put a live number
 * on a dead coordinate, so the fix has to be fresh and it has to be near.
 *
 * A FINAL WARNING IS A STATEMENT ABOUT A SYSTEM, and a system's identity is its
 * name and designation — not its coordinates and not its age. Every guard above
 * would reject it for reasons that have nothing to do with whether it is true:
 *
 *   - `no_fix` / `no_fix_time`: a final warning is exactly where an intensity
 *     block is most likely to be degenerate, since the system being warned on
 *     may no longer have a meaningful centre to fix.
 *   - `fix_too_old`: by definition. It is the LAST warning; it stops being
 *     fresh and never gets replaced. Under the wind guard, a final warning
 *     becomes undetectable a few hours after it is issued — which is the same
 *     as never detecting one at all.
 *   - `too_far_apart`: this is THE case that matters. GDACS freezing while JTWC
 *     keeps warning is the documented Noul scenario, the two positions walk
 *     apart, and it is precisely then that JTWC's final warning is the only
 *     thing that can tell the app the storm is over.
 *
 * So the wind stays guarded and the declaration does not. The cost of being
 * wrong is also different in kind: a bad wind drives height, colour and the
 * category badge and is a §5 lie on three channels at once; a bad final flag
 * greys one storm out for 36 hours, and the storm reappearing in either feed
 * revives it automatically (data/lifecycle.js `revive`).
 *
 * The false-positive risk left is a name collision — two storms sharing a name,
 * in the same season, in JTWC's active list at once. lib/advisory.js's
 * `stormNameKey` already accepts that risk for advisory text and states why.
 *
 * @returns {{designation: string|null, warningNumber: string|null,
 *            at: string|null} | null}
 */
export function matchJtwcFinal(storm, entries) {
  if (!storm || !Array.isArray(entries) || entries.length === 0) return null;
  const entry = matchStormByName(entries, storm.name);
  /* `final` is the boolean the relay sets off the warning's own words
   * (functions/api/jtwc/storms.js `isFinalWarning`). An OLDER relay response
   * — a KV copy warmed before this shipped — has no such field, and `undefined`
   * has to read as "not final" rather than as "unknown", because there is no
   * third state to render here and treating a missing field as suspicious would
   * mean no storm ever ends until the cache turns over. */
  if (!entry || entry.final !== true) return null;
  return {
    designation: entry.designation || null,
    warningNumber: entry.warningNumber || null,
    /* The warning's own fix time is the closest thing to "when this was
     * declared" that the product carries. Null is fine — the registry stamps
     * the moment it learned instead, and says so. */
    at: entry.fix?.at || null,
  };
}

/**
 * Our three-letter classification code for a category index.
 *
 * The normalized storm's `categoryCode` field is documented as
 * 'TD' | 'TS' | 'HU' | null, and it exists to carry the hurricane case that
 * has no category index behind it. Once a MEASURED wind gives us a real index
 * the code is redundant for colour and label — both prefer the index — but it
 * is still read in places, so it is kept consistent rather than left saying
 * "HU" next to a category of 5.
 */
function codeForIndex(index) {
  if (index == null) return null;
  if (index === 0) return 'TD';
  if (index === 1) return 'TS';
  return 'HU';
}

/**
 * A storm wearing JTWC's measured wind. Returns a NEW object; the input is
 * never mutated (the store keeps last-good lists and a mutation here would
 * rewrite history on the next poll).
 *
 * WHAT IT DOES NOT TOUCH, and why:
 *
 *   - `observedAt`. That is GDACS's analysis time and it drives the SILENCE
 *     rule, which is about whether the geometry on screen is still a forecast
 *     or a leftover. A fresh JTWC wind says nothing about whether GDACS's cone
 *     is current, and letting it refresh that stamp would silently disable the
 *     silence test on exactly the storms it was written for.
 *   - `lat` / `lon`. The position stays the roster's. Two agencies' fixes
 *     drawn as one storm is how a marker starts drifting between polls, and
 *     the separation guard has already established they agree.
 *   - `peakWindKt`. Still GDACS's forecast peak, still named as such.
 *
 * @param {object} storm
 * @param {object} entry a matched /api/jtwc/storms entry
 * @returns {object} a new storm object
 */
export function applyJtwcWind(storm, entry) {
  const fix = entry.fix;
  const index = categoryFromKt(fix.windKt);

  /* Forecast winds are kept as epoch ms so the per-point lookup below is a
   * subtraction rather than a Date.parse per bead per frame. Only taus that
   * actually carry a wind survive — a position with no intensity is not
   * something this module has any use for. */
  const forecast = (Array.isArray(entry.forecast) ? entry.forecast : [])
    .map((f) => ({ timeMs: Date.parse(f.at), windKt: finite(f.windKt) }))
    .filter((f) => Number.isFinite(f.timeMs) && f.windKt != null);

  return {
    ...storm,

    /* THE FIX ITSELF. `windKt` was null by design on every GDACS storm; every
     * consumer already branches on it, so filling it in with a real
     * measurement lights up the list row, the detail panel, the marker colour
     * and the cage head all at once, with no special-casing anywhere. */
    windKt: fix.windKt,
    gustKt: finite(fix.gustKt),
    /* GDACS publishes no pressure and no motion at all. Taken only where the
     * roster had nothing, so a source that starts publishing them later wins
     * over this one without a code change. */
    pressureMb: storm.pressureMb ?? finite(fix.pressureMb),
    headingDeg: storm.headingDeg ?? finite(fix.headingDeg),
    speedKt: storm.speedKt ?? finite(fix.speedKt),

    /* DERIVED, and labelled that way. `reported` is reserved for a source that
     * states the category number itself; JTWC states a wind and we apply the
     * thresholds, which is exactly what data/nhc.js does and calls derived. */
    category: index,
    categoryCode: codeForIndex(index),
    categorySource: index == null ? null : 'derived',

    /** Provenance, for the detail panel and for anyone reading the object in a
     *  console. A number on screen with no way back to who measured it is how
     *  a derived stand-in gets mistaken for a fact. */
    windSource: 'jtwc',
    windObservedAt: fix.at,
    windAccuracyNm: finite(fix.accuracyNm),

    /** Everything the track-point stamp needs, in one place. */
    jtwc: {
      designation: entry.designation || null,
      warningNumber: entry.warningNumber || null,
      product: entry.product || null,
      kind: entry.kind || null,
      fix: { at: fix.at, windKt: fix.windKt, lat: fix.lat, lon: fix.lon },
      forecast,
    },

    /** WHAT THE GEOMETRY CACHE KEYS ON (main.js, data/cache.js).
     *
     *  The cache is keyed by storm and refreshed when this string changes. It
     *  used to be `advisoryKey` alone — GDACS's own episode — which was right
     *  while GDACS was the only thing the drawn geometry depended on. It is
     *  not any more: the forecast points now carry JTWC's per-tau winds
     *  (data/gdacs-points.js), so a NEW JTWC WARNING CHANGES WHAT THE POINTS
     *  SHOULD SAY even when GDACS has not moved. Without the warning number in
     *  here, the cage head would jump to the new wind while the beads under it
     *  kept the old one — the two-numbers-one-signal failure §9 forbids,
     *  visible as a step between the head and the analysis dot beneath it.
     *
     *  `advisoryKey` itself is deliberately untouched: it identifies the
     *  ADVISORY, it keys the advisory-text cache, and JTWC's warning number is
     *  not part of GDACS's advisory identity. */
    geometryKey: `${storm.advisoryKey}+jtwc:${entry.designation || '?'}:${
      entry.warningNumber || '?'
    }`,
  };
}

/**
 * Join a whole list in one pass.
 *
 * NON-GDACS STORMS ARE SKIPPED WHOLESALE. NHC publishes its own measured wind
 * for the basins it owns, and a second agency's number for the same storm is
 * two answers free to disagree in front of a user (data/merge.js makes the
 * same call for the same reason). JTWC does warn on East Pacific systems —
 * FAUSTO and GENEVIEVE were both in its index on 2026-07-28 — so this is a
 * live condition, not a hypothetical one.
 *
 * @param {object[]} storms
 * @param {{state: string, storms: object[]}} index result of getJtwcIndex()
 * @param {number} nowMs
 * @returns {{storms: object[], matched: number, considered: number}}
 */
export function joinJtwcWinds(storms, index, nowMs = Date.now()) {
  const list = Array.isArray(storms) ? storms : [];

  /* A FAILED INDEX IS NOT AN EMPTY INDEX (data/jtwc-index.js's first rule).
   * `unavailable` means we could not ask, so nothing is claimed and every
   * storm keeps the reading it already had. `partial` IS used: it means some
   * products would not read, and a storm that did match matched on its own
   * warning — the shortfall can only cost us a match, never fake one. */
  if (!index || index.state === 'unavailable') {
    return { storms: list, matched: 0, considered: 0 };
  }

  let matched = 0;
  let considered = 0;

  const out = list.map((s) => {
    if (s?.source !== 'gdacs') return s;
    considered++;

    /* THE DECLARATION IS READ FIRST AND SEPARATELY, and it survives a failed
     * wind match — see `matchJtwcFinal` for why the two use different rules.
     * Attached as a plain field; data/lifecycle.js is the only reader, and it
     * is what turns this into an `ended` record. Nothing here decides the
     * storm's fate, so this file stays pure and stateless. */
    const declared = matchJtwcFinal(s, index.storms);

    const { entry } = matchJtwcEntry(s, index.storms, nowMs);
    let next = s;
    if (entry) {
      matched++;
      next = applyJtwcWind(s, entry);
    }
    return declared ? { ...next, jtwcFinal: declared } : next;
  });

  return { storms: out, matched, considered };
}

/**
 * JTWC's wind for one moment on a storm's track, in knots, or null.
 *
 * Used to stamp GDACS forecast points (data/gdacs-points.js) so the cage beads
 * and the dots drawn on top of them read the same measured number.
 *
 * NEAREST TAU WITHIN A TOLERANCE, NEVER INTERPOLATED. Both agencies publish on
 * synoptic hours, so a real pair lands on the same hour or not at all, and the
 * tolerance is half a step — it can accept the matching tau and can never
 * reach the neighbouring one. Interpolating would manufacture a wind no agency
 * published, which is the exact thing this whole module exists to stop.
 *
 * PAST POSITIONS GET NOTHING, ON PURPOSE. A JTWC warning carries the current
 * analysis and the forecast ladder; it has no history in it. Rather than
 * letting the tolerance quietly stretch the tau-0 fix backwards over a storm's
 * whole past track, anything earlier than the fix returns null and falls back
 * to the class midpoint. The past ridge stays derived, and SPEC §4 says so.
 */
export function jtwcWindKtAt(storm, timeMs) {
  const j = storm?.jtwc;
  if (!j || !Number.isFinite(timeMs)) return null;

  const fixMs = Date.parse(j.fix?.at);
  if (!Number.isFinite(fixMs)) return null;
  if (timeMs < fixMs - JTWC_WIND.forecastMatchTolerance) return null;

  let best = null;
  let bestGap = Infinity;

  const consider = (t, kt) => {
    const gap = Math.abs(t - timeMs);
    if (gap <= JTWC_WIND.forecastMatchTolerance && gap < bestGap) {
      bestGap = gap;
      best = kt;
    }
  };

  consider(fixMs, j.fix.windKt);
  for (const f of j.forecast || []) consider(f.timeMs, f.windKt);

  return best;
}
