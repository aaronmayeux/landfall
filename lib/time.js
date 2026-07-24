/**
 * time.js — time formatting (SPEC §8).
 *
 * Everything is stored UTC and formatted at render via Intl against the
 * device timezone. No library.
 *
 * Pure functions. Imports nothing. Ever.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** ms since a UTC timestamp (ISO string or epoch ms). NaN-safe: null in →
 *  null out, so callers can render "—" instead of "NaN hrs ago". */
export function ageMs(t, now = Date.now()) {
  if (t == null) return null;
  const then = typeof t === 'number' ? t : Date.parse(t);
  if (!isFinite(then)) return null;
  return now - then;
}

/** Relative age for stale flags: "just now", "40 min ago", "2 hrs ago",
 *  "3 days ago". Coarse on purpose — this qualifies a timestamp, it is not
 *  one. */
export function formatAge(t, now = Date.now()) {
  const ms = ageMs(t, now);
  if (ms == null) return null;
  if (ms < 2 * MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min ago`;
  if (ms < 48 * HOUR) {
    const h = Math.round(ms / HOUR);
    return `${h} ${h === 1 ? 'hr' : 'hrs'} ago`;
  }
  return `${Math.round(ms / (24 * HOUR))} days ago`;
}

/** Future counterpart of formatAge, for forecast wording: "now", "in 40 min",
 *  "in 14 hrs", "in 3 days". Same coarseness, same reason — it qualifies a
 *  timestamp. A past time returns "now" rather than a negative: a forecast
 *  point just behind the clock is happening, not scheduled. */
export function formatUntil(t, now = Date.now()) {
  const ms = ageMs(t, now);
  if (ms == null) return null;
  const ahead = -ms;
  if (ahead < 2 * MINUTE) return 'now';
  if (ahead < HOUR) return `in ${Math.round(ahead / MINUTE)} min`;
  if (ahead < 48 * HOUR) {
    const h = Math.round(ahead / HOUR);
    return `in ${h} ${h === 1 ? 'hr' : 'hrs'}`;
  }
  return `in ${Math.round(ahead / (24 * HOUR))} days`;
}

/** Absolute-first formatting: "11:00 PM Thu". Weekday is REQUIRED wording
 *  beyond ~12 h (SPEC §8) so it is simply always present — a same-day weekday
 *  costs three characters and removes a class of ambiguity. 12/24 h follows
 *  locale via Intl. */
export function formatClockDay(t) {
  if (t == null) return null;
  const d = new Date(typeof t === 'number' ? t : Date.parse(t));
  if (!isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  }).format(d);
}

const MONTH_INDEX = Object.freeze({
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
});

/**
 * NHC forecast-point time → epoch ms UTC, or null.
 *
 * `validtime` is `DD/HHMM` in UTC — the ONLY unambiguous time on a forecast
 * point (SPEC §7, measured live on Fausto EP1 2026-07-24: "24/0600"). It
 * carries no month or year; those come from `advdate` ("1100 PM HST Thu
 * Jul 23 2026"), whose trailing "Mon DD YYYY" is all this needs.
 *
 * MONTH ROLLOVER GOES BOTH WAYS. Forecast taus run up to 5 days AHEAD of
 * the advisory (issued the 31st, valid the 3rd = next month), and tau 0 is
 * the synoptic analysis up to 3 h BEHIND issuance (issued Aug 1 02Z, valid
 * Jul 31 18Z = previous month). So the day is tried in the previous, same,
 * and next month, and the candidate nearest the advisory date wins —
 * Date.UTC normalizes month under/overflow, year included. A winner more
 * than 10 days from the advisory is a mis-parse and returns null: no
 * plausible tau is that far out, and a wrong time on a decision screen is
 * worse than none (§5).
 */
export function parseNhcValidtime(validtime, advdate) {
  if (typeof validtime !== 'string' || typeof advdate !== 'string') return null;
  const v = /^(\d{1,2})\/(\d{2})(\d{2})Z?$/.exec(validtime.trim());
  if (!v) return null;
  const a = /([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s*$/.exec(advdate.trim());
  if (!a) return null;
  const mon = MONTH_INDEX[a[1].toLowerCase()];
  if (mon == null) return null;
  const advDay = +a[2];
  const year = +a[3];
  const day = +v[1];
  const hh = +v[2];
  const mm = +v[3];
  if (day < 1 || day > 31 || hh > 23 || mm > 59) return null;

  const anchor = Date.UTC(year, mon, advDay);
  let best = null;
  for (const m of [mon - 1, mon, mon + 1]) {
    const t = Date.UTC(year, m, day, hh, mm);
    if (best == null || Math.abs(t - anchor) < Math.abs(best - anchor)) best = t;
  }
  const TEN_DAYS = 10 * 24 * HOUR;
  return Math.abs(best - anchor) <= TEN_DAYS ? best : null;
}
