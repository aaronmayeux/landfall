/**
 * track-point.js — reading ONE position on a storm's track.
 *
 * A track point is a single dot in a storm's life: a past fix, the current
 * analysis, or a forecast position. Both feeds publish them, with completely
 * different field names, and TWO surfaces now need the same three answers out
 * of one:
 *
 *   - map/layers/points-forecast.js — the dots drawn on the map.
 *   - map/storm-mesh.js            — the cage ridge that follows the track.
 *
 * This file exists because the second one arrived (SPEC §12: any pattern used
 * twice gets extracted before the second use). `categoryIndexOf` was lifted
 * VERBATIM out of points-forecast.js, which now imports it — the alternative
 * was two copies of the source-precedence rules below, drifting apart until a
 * dot and the ridge beneath it disagreed about the same storm at the same hour.
 *
 * PURE. No DOM, no THREE, no fetching. Imports: config and lib only.
 */

import { HURRICANE_UNKNOWN_COLOR } from '../config/tokens.js';
import { palette } from '../config/theme.js';
import { categoryColor, categoryDotCode, categoryFromKt } from './category.js';
/* ==> ONE RULE FOR "WHAT KIND OF SYSTEM IS THIS", BOTH GLOBES. <== This file
 * is the live globe's road and `map/layers/season-points.js` is the archive's;
 * both now ask `season-nature.js`. A second private copy of the rule here is
 * how the two came to disagree about Beryl 2018 in the first place, and the
 * rule moved twice in two days while that copy sat still. */
import { isCycloneStatus, natureAt, statusDotCode } from './season-nature.js';

/* ---------------------------------------------------------------------------
 * CATEGORY
 * ------------------------------------------------------------------------- */

/**
 * Our normalized category index is 0=TD, 1=TS, 2..6=Cat1..5. A reported
 * Saffir-Simpson number n maps to index n+1. Null when the source gives us
 * nothing we can honestly read.
 */
export function categoryIndexOf(p) {
  /* A source that already decided. GDACS publishes none of NHC's fields, so
   * data/gdacs-points.js resolves index and code together at parse time and
   * stamps the answer. Honouring it here keeps ONE reading behind both the
   * color and the text — the invariant this is built on — rather than
   * re-deriving from fields that do not exist and silently getting null.
   *
   * The flag is checked, not the value: a stamped null is a real answer
   * ("hurricane, no category available") and must not fall through to the
   * NHC path. */
  if (p?._catStamped) return p._catIndex ?? null;

  /* NHC's own reported index. `ssnum` on forecast points (+2), `ss` on past
   * points (+7) — the same number under two names, both live-confirmed
   * 2026-07-24 (SPEC §4). REPORTED, never derived: NHC's own classification
   * beats anything we could compute from its wind field, and re-deriving
   * would put the dot and the advisory in disagreement at a threshold. */
  const ss = Number.isFinite(p?.ssnum) ? p.ssnum : p?.ss;
  if (Number.isFinite(ss) && ss >= 1 && ss <= 5) return ss + 1;

  /* ==> BELOW HURRICANE STRENGTH THE TWO LAYERS SPEAK DIFFERENT LANGUAGES,
   *     AND READING ONLY ONE OF THEM PAINTED EVERY WEAK STORM'S HISTORY RED.
   *
   * NHC reports `ss`/`ssnum` as 0 for anything under a Cat 1 and says which it
   * is somewhere else. Measured, on real bytes:
   *
   *   - FORECAST points (+2) carry `tcdvlp`, spelled out in WORDS:
   *     "Tropical Storm", "Hurricane", "Major Hurricane" (samples/ida-al092021,
   *     advisory 10, every tau).
   *   - PAST points (+7) do not carry `tcdvlp` AT ALL. Their only
   *     classification field is `stormtype`, a two-letter CODE: `TD`, `TS`,
   *     `HU` (spec-parameter §29.3, §30.4).
   *
   * A word search alone therefore answered the forecast half correctly and the
   * past half not at all: "TD" contains neither "depression" nor "storm", so
   * every past position on every storm that never reached hurricane strength
   * fell through to `null` and was painted the GENERIC fallback — a dull red —
   * on both the cage ridge and the map's dots. Hurricanes were never affected,
   * because `ss` answers first for them, which is why this survived a season.
   *
   * The CODE is checked before the words, on an exact match rather than a
   * substring, so a two-letter code can never be found accidentally inside a
   * spelled-out phrase.
   *
   * `HU` and `MH` are deliberately absent from the table. Hurricane strength
   * with no Saffir-Simpson number behind it is not a category we can name, and
   * inventing one here would put a color on a position NHC did not grade.
   * `ss` answers for them at every real hurricane position; if it ever stops,
   * the honest result is the generic hue, which is what falls out below. */
  const raw = String(p?.tcdvlp || p?.stormtype || '').trim();
  const byCode = CLASSIFICATION_CODE[raw.toUpperCase()];
  if (byCode != null) return byCode;

  const dv = raw.toLowerCase();
  if (dv.includes('depression')) return 0;
  if (dv.includes('storm')) return 1;
  return null;
}

/** NHC's sub-hurricane classification codes → our category index.
 *
 *  Subtropical systems are graded alongside their tropical twins: SPEC §6 lists
 *  `subtropical` as a categorizable nature, and a subtropical storm is a
 *  tropical storm's equal in the one thing this index is used for. The codes
 *  appear in both two- and three-letter forms in NHC's published set
 *  (spec-parameter §29.3); both spellings are here because guessing which one a
 *  layer uses is exactly the mistake this table exists to end.
 *
 *  Everything NOT in this table is out on purpose — `PT` (post-tropical), `EX`
 *  (extratropical), `LO` (low), `DB` (disturbance), `WV` (wave) and `PTC`.
 *  Those are genuinely not Saffir-Simpson systems and must fall through rather
 *  than borrow a color they have not earned (SPEC §6). `trackPointReading`
 *  sorts them into two greys of different SIZE below; the "generic hue" this
 *  comment used to name is no longer where any of them land.
 *
 *  ==> `PTC` IS **POTENTIAL** TROPICAL CYCLONE, NOT POST-TROPICAL, AND THIS
 *  COMMENT SAID OTHERWISE UNTIL 2026-08-30. <== The same error is at
 *  `config/constants.js` `postTropicalStatuses`, which calls `PT`/`PTC` "NHC's
 *  other spellings" for one thing when they are opposite ends of a storm's
 *  life. Nothing shipped wrong from it — `PTC` was unlisted either way, so it
 *  fell through — but it is the kind of wrong note that gets acted on later. */
const CLASSIFICATION_CODE = Object.freeze({
  TD: 0, SD: 0, STD: 0,
  TS: 1, SS: 1, STS: 1,
});

/* ---------------------------------------------------------------------------
 * THE LIVE FEEDS' VOCABULARY, TRANSLATED INTO THE RECORD'S
 * ------------------------------------------------------------------------- */

/**
 * A live NHC classification, expressed in the status codes HURDAT2 uses.
 *
 * ==> THIS EXISTS SO THE LIVE GLOBE AND THE ARCHIVE GLOBE ANSWER "WHAT KIND OF
 * SYSTEM IS THIS" WITH ONE FUNCTION. <== `lib/season-nature.js` is that
 * function. It speaks the record's nine codes, measured: TS, HU, TD, EX, LO,
 * SS, DB, SD, WV are every code in all 3,266 storms and there are no others.
 * The live feeds speak a wider set and sometimes speak in whole words. Rather
 * than widen `SEASONS.cycloneStatuses` — which would put unmeasured live-only
 * codes inside the constant the archive's landfall walk reads — the live side
 * translates on the way in and the rule downstream stays one rule.
 *
 * `MH` IS MEASURED, not assumed: spec-parameter §29.3 confirms it on
 * Genevieve's forecast points, and it is on Karina's right now (tau 48 and 60,
 * archive branch 2026-08-30). It is a major hurricane, so it maps to `HU`.
 * Every live `MH` also carries `ssnum`, so `categoryIndexOf` answers before
 * this is ever consulted — it is here as a backstop, because "in practice the
 * other field always answers" is the assumption that produced the red-track
 * bug.
 *
 * ==> `PTC` IS **POTENTIAL** TROPICAL CYCLONE AND IS DELIBERATELY NOT MAPPED.
 * <== NHC uses it for a disturbance that has NOT formed yet but is close
 * enough to a coast to warrant advisories. It is pre-genesis, the opposite of
 * post-tropical, and mapping it to `EX` would print `PTC` inside a dot on a
 * system that was never a storm. Unmapped, it falls through to the record's
 * "not a code I know", which `natureAt` reads as a remnant — the right answer,
 * reached by refusing to guess rather than by guessing correctly.
 *
 * `PT` and the spelled-out forms DO map: post-tropical and extratropical are
 * the same class, and NHC's forecast tier writes them as words while its past
 * tier writes `EX`. That two-languages split is what produced the original
 * bug and it is closed here, once, instead of at every reader.
 */
export function recordStatusOf(p) {
  /* `stormtype` FIRST, and this is the correction the port turned up. The old
   * reading preferred `tcdvlp`, on the belief that the forecast tier speaks
   * only words. Measured on the archive branch 2026-08-30: NHC's forecast
   * points carry BOTH — Karina's tau 48 is `stormtype: "MH"` and
   * `tcdvlp: "Major Hurricane"` on the same feature. Preferring the code means
   * one exact-match table answers both tiers and the word search below is a
   * fallback rather than the forecast tier's only path. */
  const code = String(p?.stormtype || '').trim().toUpperCase();
  if (code) return LIVE_STATUS_CODE[code] || code;

  const words = String(p?.tcdvlp || '').trim().toLowerCase();
  if (!words) return '';
  if (/post-trop|extratrop/.test(words)) return 'EX';
  if (/remnant/.test(words)) return 'LO';
  /* `potential tropical cyclone` must not reach the two lines below it: it
   * contains the word "tropical" and would otherwise be read as a depression.
   * Same trap as `PTC` above, in the other language. */
  if (/potential/.test(words)) return '';
  if (/depression/.test(words)) return 'TD';
  if (/hurricane|typhoon/.test(words)) return 'HU';
  if (/storm/.test(words)) return 'TS';
  return '';
}

/** Live-only codes → the record's. Anything absent passes through unchanged,
 *  which is what lets the nine measured HURDAT2 codes arrive untouched. */
const LIVE_STATUS_CODE = Object.freeze({
  MH: 'HU',   // Major Hurricane. Measured, §29.3 and Karina 2026-08-30.
  TY: 'HU',   // Typhoon. JTWC's word for the same thing.
  ST: 'HU',   // Super Typhoon.
  PT: 'EX',   // Post-Tropical. NHC's other spelling of extratropical.
  STD: 'SD',  // Subtropical Depression, three-letter form.
  STS: 'SS',  // Subtropical Storm, three-letter form.
});

/**
 * When a storm first became a cyclone, read off its raw GeoJSON point features.
 *
 * ==> BOTH LIVE CALLERS NEED THIS AND NEITHER CAN GET IT FROM ONE POINT. <==
 * `natureAt` cannot tell an `LO` before genesis from an `LO` after it without
 * knowing when genesis was, and that is a whole-track fact. Lowell is the live
 * proof: she carries an `LO` fix at 18Z on 26 August, twenty-four hours BEFORE
 * her first `TS` (archive branch, 2026-08-30). Graded without this she would
 * wear post-tropical letters on a system that had never been a storm.
 *
 * The features must be ONE STORM's. A mixed collection returns the earliest
 * cyclone fix across all of them, which is a genesis time for nobody.
 */
export function bornAtOf(features) {
  let earliest = null;
  for (const f of Array.isArray(features) ? features : []) {
    const p = f?.properties || f;
    if (!isCycloneStatus(recordStatusOf(p))) continue;
    const t = timeMsOf(p);
    if (t == null) continue;
    if (earliest == null || t < earliest) earliest = t;
  }
  return earliest;
}

/**
 * The ONE reading behind a track position's color, its category, and the text
 * drawn inside its dot.
 *
 * Resolved together, in one place, because a dot whose fill says one severity
 * and whose letters say another is worse than either alone — and now because
 * the cage ridge lifts from the same positions the dots sit on, so a third
 * surface would otherwise get a fourth opinion. Three cases:
 *
 *  - A category we can name → its Saffir-Simpson color and code.
 *  - A source-supplied code with NO category behind it → GDACS's "HU". This
 *    gets HURRICANE_UNKNOWN_COLOR: hurricane strength is real and must not
 *    read as milder than the tropical storm next to it, but the category is
 *    genuinely unknown (GDACS's top band IS the Cat 1 floor) so it must not
 *    borrow a Saffir-Simpson hue either.
 *  - Nothing gradeable → one grey, and the size and the letters say which
 *    kind of not-a-cyclone it is. See below.
 *
 * `nature` is not consulted for a GRADEABLE point. A position carrying a
 * readable Saffir-Simpson reading is by definition a tropical one at that
 * moment, and reading the STORM's present nature here would repaint a
 * hurricane's whole history the moment it went post-tropical — rewriting what
 * was measured to match what is true now. `bornAt` below is not that: it is
 * the storm's own first cyclone fix, a fact about its past, and it is only
 * consulted once a point has already failed to grade.
 *
 * ==> THE NON-CYCLONE READING IS THE ARCHIVE GLOBE'S, PORTED. <== §57.7f and
 * §57.7g, Aaron's calls on glass 2026-08-29, now on the live globe because the
 * live globe had the palette he rejected. Before this it painted `EX` and `PT`
 * the brick `CATEGORY_COLOR.GENERIC` — which reads as a strong storm — and
 * everything else the teal `PREGENESIS_COLOR`, which reads too close to the
 * `TD` blue. Neither system has a severity to claim, so neither gets a hue
 * that implies one. Both are `stormEnded`: the app's existing "this had a
 * colour and no longer has one".
 *
 * Size carries "was this ever a storm", because colour no longer can:
 *
 *   never a cyclone (`DB`, `WV`, `PTC`, `LO` before genesis)  small, blank
 *   was a cyclone   (`EX`, `PT`, `LO` after genesis)          full size, lettered
 *
 * `LO` is on both rows, which is why the split is by SEQUENCE and not by code,
 * and why `bornAt` is a parameter rather than something read off the point.
 * Lowell, live on the archive branch 2026-08-30, carries an `LO` fix a full
 * day before her first `TS`.
 *
 * MEASURED on the live feed the moment this was written: Karina 11 `DB` of 20
 * past points, Lowell 7 `DB` and 1 `LO` of 17. More than half of Karina's
 * drawn history was wearing the rejected teal.
 *
 * ==> THE GREY IS RESOLVED HERE, AT BUILD TIME. <== `stormEnded` is
 * palette-scoped, so the obvious spelling would be a `gs()` in the layer's
 * paint — and that would put a global-state reference in the same expression
 * as `['get', '_color']`, the shape `SPEC-MAP.md` rule 1b forbids. It is the
 * FIRST theme-dependent value this reading has ever produced (Saffir-Simpson
 * is fixed by §6 and the two old fallbacks were module constants), so the
 * callers must rebuild on a theme change or the grey goes stale. `main.js`
 * repushes both point sources on `subscribeThemeChange` for exactly this.
 *
 * @param {object} p       one point's properties
 * @param {number|null} bornAt  `bornAtOf` for the WHOLE track this point is on.
 *   Omitted means "unknown", and an `LO` then reads as a remnant — the quiet
 *   answer, which is the right way to be wrong.
 */
export function trackPointReading(p, bornAt = null) {
  const index = categoryIndexOf(p);
  if (index != null) {
    return {
      index,
      color: categoryColor(index, 'tropical'),
      code: categoryDotCode(index, 'tropical'),
      small: false,
    };
  }
  const stamped = p?._catStamped && p._catCode ? String(p._catCode) : '';
  if (stamped) {
    return { index: null, color: HURRICANE_UNKNOWN_COLOR, code: stamped, small: false };
  }

  const status = recordStatusOf(p);

  /* ==> A HURRICANE THAT DID NOT GRADE IS STILL A HURRICANE. <== `HU`, and
   * `MH`/`TY`/`ST` through the translation table, reach here only when the
   * source published no `ssnum` — which no live feed does today, but the whole
   * point of a backstop is the day one stops. It must NOT fall into the grey
   * below: hurricane strength is real. `HURRICANE_UNKNOWN_COLOR` is the token
   * for exactly this, already used two branches up for GDACS's stamped `HU`. */
  if (isCycloneStatus(status)) {
    return { index: null, color: HURRICANE_UNKNOWN_COLOR, code: '', small: false };
  }

  const nature = natureAt(status, timeMsOf(p), bornAt);
  return {
    index: null,
    color: palette().stormEnded,
    small: nature === 'remnant',
    /* The record's own letters, and that is Aaron's call over blank or a word
     * (§57.7f): a blank grey dot beside a lettered one reads as a dot that
     * failed to load, where `DB` reads as a fact the reader can look up.
     * `statusDotCode` drops anything that will not fit in two characters
     * rather than truncating it, because `PTC` cut to `PT` is a WRONG label
     * and not a short one. */
    code: nature === 'post-tropical' ? statusDotCode(status) : '',
  };
}

/* ---------------------------------------------------------------------------
 * WIND
 * ------------------------------------------------------------------------- */

/**
 * A MEASURED wind in knots at this position, or null.
 *
 * Null is a real and common answer, not a failure: GDACS publishes no wind
 * number at any position on its track, past or future (SPEC §4). Callers must
 * degrade rather than invent — `lib/category.js representativeKt()` is the
 * stand-in, and it is never displayed as a measurement.
 *
 * `_windKt` is a wind ALREADY RESOLVED by a parser and stamped on the feature.
 * Preferred over everything for the same reason `_time` is preferred in
 * `timeMsOf` below: one parser decides, every consumer reads one field, and
 * two paths can never disagree about the same position. Today it carries
 * JTWC's measured forecast wind onto GDACS track points, which otherwise have
 * no number at all and drew the cage from a class midpoint that could not tell
 * a Cat 1 from a Cat 5 (data/gdacs-points.js, lib/jtwc-wind.js).
 *
 * `intensity` is the past tier (+7), `maxwind` the forecast tier (+2), both
 * knots natively, both confirmed live 2026-07-24. Checked in that order only
 * because no single feature carries both; there is no precedence question.
 */
export function windKtOf(p) {
  if (Number.isFinite(p?._windKt)) return p._windKt < SENTINEL ? p._windKt : null;
  const v = Number.isFinite(p?.intensity) ? p.intensity : p?.maxwind;
  if (!Number.isFinite(v)) return null;
  /* NHC uses 9999 as a "no value" sentinel on several numeric fields beyond
   * tau 0 (SPEC §4, seen live on mslp/tcdir/tcspd). Anything at or above the
   * sentinel is not a wind speed — the strongest storm ever recorded was
   * under 200 kt — and letting one through would peg the ridge to full Cat 5
   * height on a point that has no reading at all. */
  if (v >= SENTINEL) return null;
  return v;
}

/** NHC's "no value" marker. Not a wind, not a bearing, not a pressure. */
const SENTINEL = 9999;

/* ---------------------------------------------------------------------------
 * TIME
 * ------------------------------------------------------------------------- */

/**
 * Epoch ms UTC for this position, or null.
 *
 * Three shapes, all live-confirmed (SPEC §4):
 *   - `_time`  — already parsed. Stamped on NHC forecast points by
 *                data/nhc-mapserver.js and on every GDACS point by
 *                data/gdacs-points.js. Always preferred: one parser, one
 *                answer, no chance of two paths disagreeing.
 *   - `dtg`    — NHC past points (+7). A NUMBER, `2026071712` = YYYYMMDDHH,
 *                UTC. Not Date.parse-able in that form.
 *   - nothing  — null, and the caller drops the point rather than guessing
 *                where it belongs in time.
 *
 * A point with no readable time cannot be aged, tapered, or windowed, so the
 * ridge builder discards it. That is the honest failure: a bead placed at the
 * wrong moment in a storm's life is worse than a bead that isn't there.
 */
export function timeMsOf(p) {
  if (Number.isFinite(p?._time)) return p._time;
  const dtg = p?.dtg;
  if (!Number.isFinite(dtg)) return null;
  const s = String(Math.trunc(dtg));
  if (s.length !== 10) return null;
  const year = +s.slice(0, 4);
  const month = +s.slice(4, 6);
  const day = +s.slice(6, 8);
  const hour = +s.slice(8, 10);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31) || hour > 23) return null;
  /* Date.UTC, never the local-time constructor. GDACS timestamps shipped a
   * whole-app freshness bug by being parsed as local (SPEC §4); this is the
   * same trap on NHC's side and it is closed at ingest, here, not at render. */
  return Date.UTC(year, month - 1, day, hour, 0, 0);
}

/* ---------------------------------------------------------------------------
 * THE WHOLE OBSERVED TRACK
 * ------------------------------------------------------------------------- */

/**
 * A storm's OBSERVED positions → the shape the home dashboard already reads
 * (§49.3): `[{lon, lat, time, windKt, gustKt, category, categorySource,
 * stormType, tau}]`, ascending by time.
 *
 * ==> ONE NORMALIZER, BOTH SOURCES, AND THAT IS WHY IT LIVES HERE. <==
 * `normalizeForecast()` in data/nhc-mapserver.js is NHC-only because NHC's
 * forecast layer is the only thing shaped like it. The observed track is the
 * opposite case: NHC's layer 10, GDACS's parsed centre dots, and the skeleton
 * data/lifecycle.js rehydrates for an ended storm all arrive as GeoJSON point
 * features, and the three readers directly above — `categoryIndexOf`,
 * `windKtOf`, `timeMsOf` — already resolve every one of them source-blind.
 * Writing this twice would mean two copies of the source-precedence rules,
 * drifting apart until the dashboard and the map disagreed about the same fix.
 *
 * A POINT WITH NO READABLE TIME IS DROPPED, not placed. Same rule the ridge
 * builder and the ended-storm compactor already use: a position that cannot be
 * ordered cannot be walked, and a fix at the wrong moment in a storm's life is
 * worse than a fix that isn't there.
 *
 * `tau` IS ALWAYS NULL, deliberately, even though a GDACS past dot carries a
 * negative one. Tau means "hours ahead of the analysis" and a measurement has
 * none; NHC publishes no tau on layer 10 at all. A field that exists on half
 * the points invites a consumer to sort on it, which would silently scramble
 * an NHC track. The times are the ordering key and they always exist.
 *
 * `gustKt` IS ALWAYS NULL for the same kind of reason: neither source publishes
 * a gust on an observed fix. It is present so that one loop can read a past
 * point and a forecast point without asking which it has.
 *
 * ==> WHY A DISTURBANCE GETS NO CATEGORY EVEN THOUGH IT HAS A WIND. <==
 * `categoryIndexOf` refuses to grade `DB`, `LO`, `WV`, `HU`-without-`ss` and
 * the post-tropical codes — that refusal is what stops the map painting a
 * storm's pre-genesis history hotter than the depression it grew into. The
 * knots fallback below therefore only fires when the source published NO
 * classification at all, so this function and `trackPointReading` can never
 * put two different readings on one position. NHC's layer 10 carries
 * `stormtype` on every point ever measured, so in practice the fallback is
 * there for a feed that stops carrying it, not for a case seen today.
 */
export function normalizePastPoints(features) {
  const out = [];
  for (const f of Array.isArray(features) ? features : []) {
    if (f?.geometry?.type !== 'Point') continue;
    /* ==> `Number(null)` IS 0, NOT NaN, AND 0 IS A REAL PLACE. <== A coerced
     * guard here accepted a null longitude and put the fix in the Gulf of
     * Guinea. The type is checked before the value, exactly as `num()` in
     * data/nhc-mapserver.js does for the forecast curve. Caught by
     * tools/test-home.mjs, not on glass. */
    const lon = f.geometry.coordinates?.[0];
    const lat = f.geometry.coordinates?.[1];
    if (typeof lon !== 'number' || !isFinite(lon)) continue;
    if (typeof lat !== 'number' || !isFinite(lat)) continue;

    const p = f.properties || {};
    const ms = timeMsOf(p);
    if (ms == null) continue;

    const windKt = windKtOf(p);
    let category = categoryIndexOf(p);
    let categorySource = null;

    if (category != null) {
      /* PROVENANCE FOLLOWS THE STAMP WHERE THERE IS ONE. A GDACS dot's index
       * can be GDACS's own leg code (reported) or our arithmetic on a JTWC or
       * CARQ wind (derived), and only the parser that resolved it knows which
       * — so data/gdacs-points.js writes `_catSource` beside `_catIndex`.
       * Unstamped means NHC answered out of `ss` or `stormtype`, both of which
       * are NHC's own grading. A stamped point from before `_catSource`
       * existed reads as null: unknown, which is true, rather than borrowing a
       * provenance it never had. */
      categorySource = p._catStamped
        ? (p._catSource === 'reported' || p._catSource === 'derived' ? p._catSource : null)
        : 'reported';
    } else if (
      windKt != null &&
      !p._catStamped &&
      !String(p.tcdvlp || p.stormtype || '').trim()
    ) {
      const derived = categoryFromKt(windKt);
      if (derived != null) {
        category = derived;
        categorySource = 'derived';
      }
    }

    out.push({
      lon,
      lat,
      time: new Date(ms).toISOString(),
      windKt,
      gustKt: null,
      category,
      categorySource,
      /** The SOURCE's own class letter at this fix — NHC's `stormtype`
       *  (`DB`, `TD`, `TS`, `HU`), GDACS's leg code in `_gdacsIntensity`
       *  (`TD`, `TS`, `HU`). Carried verbatim, never expanded, because it is
       *  the only field that can say a position was pre-genesis. Null on a
       *  rehydrated ended-storm skeleton, which does not persist it. */
      stormType:
        typeof p.stormtype === 'string' ? p.stormtype.toUpperCase()
        : typeof p._gdacsIntensity === 'string' ? p._gdacsIntensity.toUpperCase()
        : null,
      tau: null,
    });
  }
  out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return out;
}
