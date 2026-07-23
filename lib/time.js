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
