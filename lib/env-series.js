/**
 * env-series.js — reading a parsed SHIPS run. SPEC §47.4, §47.8.
 *
 * The primitives every other environment file stands on: which band a number
 * is in, which hours are drawable, which hour is furthest from zero, and how a
 * forecast hour is spoken as a time. Pure, no DOM, no clock of its own — the
 * clock arrives as the run's own issuance.
 *
 * ==> EXTRACTED WHEN `lib/env-health.js` CROSSED §12's 700-LINE CEILING. <==
 * The paragraph, the verdict's shape machinery and these primitives are three
 * concerns that were sharing one file, and the ceiling is what made that
 * visible. Imports run one way only: env-health -> env-verdict -> env-series.
 *
 * Imports: config/, lib/ siblings only.
 */

import { ENV_HEALTH } from '../config/constants.js';
import { formatDayPart } from './time.js';

/** Which §47.4 band a knot value sits in: 0 tearing it down, 1 working
 *  against it, 2 neutral, 3 helping, 4 feeding it. */
export function bandOf(kt) {
  const cuts = ENV_HEALTH.bandCutsKt;
  for (let i = 0; i < cuts.length; i++) if (kt < cuts[i]) return i;
  return cuts.length;
}

export const NEUTRAL = 2;

/** Epoch ms of a forecast hour, off the run's own issuance. */
export const hourMs = (run, hr) => Date.parse(run.issuedAt) + hr * 3600 * 1000;

/** "by early Thursday" / "by Monday afternoon" */
export const at = (run, hr) => formatDayPart(hourMs(run, hr));
export const dayAt = (run, hr) => formatDayPart(hourMs(run, hr), { dayOnly: true });

/** Signed figure as spoken: "+14", "−13" — a real minus sign, matching every
 *  other signed figure in the app. */
export const signed = (n) => (n < 0 ? `\u2212${Math.abs(n)}` : `+${n}`);

/**
 * The drawable environment series: [{hr, kt}], in hour order. Drawability is
 * the parser's own §47.2 answer — a wind AND a position both published.
 */
export function series(run) {
  const out = [];
  for (let c = 0; c < run.hours.length; c++) {
    if (run.drawable[c]) out.push({ hr: run.hours[c], kt: run.environmentKt[c], c });
  }
  return out;
}

/** The point furthest from zero — FIRST occurrence, so the time named is when
 *  the track first gets there rather than the last moment it lingers. */
export function extremeOf(pts) {
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.kt) > Math.abs(best.kt)) best = p;
  return best;
}

/** The furthest point in one DIRECTION — the most negative (`side` −1) or the
 *  most positive (+1) — first occurrence, for turning shapes whose headline
 *  must sit on the side the track ends on. */
export function sideExtreme(pts, side) {
  let best = pts[0];
  for (const p of pts) if (p.kt * side > best.kt * side) best = p;
  return best;
}

/** Last drawable forecast hour, or null. Drawability is the POSITION alone
 *  (§47.2), so this is where the ribbon stops — not where the intensity
 *  forecast stops. Those are different hours and the difference is a bug
 *  waiting to happen; see `lastForecastHr` below. */
export function lastDrawableHr(run) {
  for (let c = run.hours.length - 1; c >= 0; c--) {
    if (run.drawable[c]) return run.hours[c];
  }
  return null;
}

/**
 * The last hour with BOTH a drawn position and a published wind — the bottom
 * line's ground truth, and the only hour it may quote a wind at.
 *
 * ==> THIS EXISTS BECAUSE `lastDrawableHr` SHIPPED A MISSING NUMBER. <== Until
 * 2026-08-22 drawability required a position AND a wind, so the last drawable
 * hour always had one and the bottom line could read `vLandKt` there safely.
 * §47.2 then made the POSITION alone decide, which was right for the map and
 * left this consumer reading a column that is now allowed to be empty. The
 * sentence printed an em dash where a wind belonged — *"falling from 81 mph to
 * — by Thursday morning"* — and, worse, `null - currentWindKt` coerces the
 * missing value to ZERO, so the closing clause was also chosen from a total
 * collapse the file never forecast. Measured on the 2026 corpus: **57 of 342
 * runs with a drawn track, 16.7%, 31 of them named storms.** Every suite was
 * green, because nothing had ever swept the SENTENCES.
 *
 * Both conditions, not just the wind: §47.8's rule is that the wind quoted
 * must match ground the ribbon actually paints, and 209 files publish winds
 * past their last position. Quoting one of those would put the bottom line on
 * ground the map draws nothing for.
 */
export function lastForecastHr(run) {
  for (let c = run.hours.length - 1; c >= 0; c--) {
    if (run.drawable[c] && run.vLandKt?.[c] != null) return run.hours[c];
  }
  return null;
}

export const cap = (s) => s[0].toUpperCase() + s.slice(1);
