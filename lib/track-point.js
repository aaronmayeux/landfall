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

import { CATEGORY_COLOR, HURRICANE_UNKNOWN_COLOR } from '../config/tokens.js';
import { categoryColor, categoryDotCode } from './category.js';

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

  /* Below hurricane strength NHC reports ss/ssnum as 0 and says which in
   * words. `tcdvlp` rides forecast points; `stormtype` rides past points
   * (SPEC §4). Both are checked because a past point carries only the
   * second, and reading one field on both layers is how the past tier
   * would silently degrade to "no category" across a storm's whole history. */
  const dv = String(p?.tcdvlp || p?.stormtype || '').toLowerCase();
  if (dv.includes('depression')) return 0;
  if (dv.includes('storm')) return 1;
  return null;
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
 *  - Nothing readable → the generic hue and no code.
 *
 * `nature` is not consulted. A position carrying a readable Saffir-Simpson
 * reading is by definition a tropical one at that moment, and reading the
 * STORM's present nature here would repaint a hurricane's whole history the
 * moment it went post-tropical — rewriting what was measured to match what is
 * true now.
 */
export function trackPointReading(p) {
  const index = categoryIndexOf(p);
  if (index != null) {
    return {
      index,
      color: categoryColor(index, 'tropical'),
      code: categoryDotCode(index, 'tropical'),
    };
  }
  const stamped = p?._catStamped && p._catCode ? String(p._catCode) : '';
  if (stamped) return { index: null, color: HURRICANE_UNKNOWN_COLOR, code: stamped };
  return { index: null, color: CATEGORY_COLOR.GENERIC, code: '' };
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
 * `intensity` is the past tier (+7), `maxwind` the forecast tier (+2), both
 * knots natively, both confirmed live 2026-07-24. Checked in that order only
 * because no single feature carries both; there is no precedence question.
 */
export function windKtOf(p) {
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
