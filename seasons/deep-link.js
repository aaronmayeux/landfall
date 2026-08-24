/**
 * deep-link.js — `?season=2005` and `?season=2005&storms=katrina,rita,wilma`.
 *
 * §57.16. A specific archive state opens on a phone in one tap instead of six
 * taps of re-ticking, and it is shareable, which is most of why the feature is
 * worth having at all.
 *
 * ==> READING IS VALIDATION, NOT PARSING, AND THAT IS THE WHOLE FILE. <== The
 * query string is the one input to this app that a stranger writes. Everything
 * here answers with a value the rest of Seasons can use without checking it
 * again, or with `null` — never with a half-trusted object carrying a year
 * somebody typed.
 *
 * `?season=1066` IS NOT AN EMPTY SEASON. That distinction is §5 in its
 * smallest form: a year before the record begins is a MALFORMED LINK, and the
 * archive opening silently empty on one would be the app saying nothing
 * happened in 1066 rather than that it cannot answer. `read()` returns null
 * with a reason and the caller says so.
 *
 * THE URL IS WRITTEN WITH `replaceState`, NEVER `pushState`. Seasons is
 * entered from a button that already has a Leave button beside it; adding
 * history entries would mean the phone's own Back gesture walks the reader
 * through every year they looked at, which is neither what the bar promises
 * nor what Back means anywhere else in this app.
 *
 * Imports config/ only. Safe with no `location` at all — the suites call
 * `parse()` with a plain string.
 */

import { SEASONS } from '../config/constants.js';

/** The two parameters. Named here so the reader, the writer and the clear
 *  path cannot drift — three string literals is three chances to typo one. */
export const PARAM = Object.freeze({ season: 'season', storms: 'storms' });

/**
 * A storm slug in a link: lowercase letters and digits, hyphens between.
 *
 * Deliberately narrower than any identifier this app actually holds. Nothing
 * downstream trusts these — step 5 matches them against the season's real
 * roster and drops what does not match — so the only job here is refusing
 * anything that could be mistaken for markup or a path.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Read a deep link out of a query string.
 *
 * @param {string} search       `location.search`, with or without the `?`.
 * @param {number} [nowYear]    the current year; injected so the suite is not
 *                              a different test in January.
 * @returns {{season:number, storms:string[]}|null}
 *   null when there is no `season` parameter at all — the ordinary case, and
 *   NOT an error. Use `reasonFor` to tell that apart from a bad one.
 */
export function parse(search, nowYear = new Date().getUTCFullYear()) {
  const raw = rawSeason(search);
  if (raw === null) return null;
  const year = seasonYear(raw, nowYear);
  if (year === null) return null;
  return { season: year, storms: stormList(search) };
}

/**
 * Why a query string produced no state. Three answers, and they are three
 * different things to put on screen.
 *
 * @returns {'absent'|'malformed'|'out-of-range'|'ok'}
 */
export function reasonFor(search, nowYear = new Date().getUTCFullYear()) {
  const raw = rawSeason(search);
  if (raw === null) return 'absent';
  if (!/^\d{4}$/.test(raw)) return 'malformed';
  return seasonYear(raw, nowYear) === null ? 'out-of-range' : 'ok';
}

/** The `season` parameter exactly as written, or null if it is not there.
 *  An EMPTY `?season=` counts as written-and-wrong, not as absent: somebody
 *  built that URL on purpose and a silent archive is the wrong answer to it. */
function rawSeason(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  } catch {
    return null;
  }
  const raw = params.get(PARAM.season);
  return raw === null ? null : raw.trim();
}

/** A four-digit year inside the record, or null. */
function seasonYear(raw, nowYear) {
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  const ceiling = nowYear + SEASONS.seasonLinkFutureYears;
  if (year < SEASONS.firstSeason || year > ceiling) return null;
  return year;
}

/** The `storms` list: split, trimmed, deduped, validated, capped. Order is
 *  the link's own — it is what somebody chose to share. */
function stormList(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  } catch {
    return [];
  }
  const raw = params.get(PARAM.storms);
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(',')) {
    const slug = part.trim().toLowerCase();
    if (!SLUG.test(slug) || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= SEASONS.deepLinkMaxStorms) break;
  }
  return out;
}

/**
 * Build the query string for a given archive state. Pure, so the suite can
 * assert on it without a browser.
 *
 * @returns {string} e.g. `?season=2005&storms=katrina,rita` — or `''` when
 *   there is no season, which is what the live app's URL should look like.
 */
export function toSearch({ season = null, storms = [] } = {}, existing = '') {
  let params;
  try {
    params = new URLSearchParams(String(existing || '').replace(/^\?/, ''));
  } catch {
    params = new URLSearchParams();
  }
  /* ==> OTHER PARAMETERS SURVIVE. <== `?replay=ida` is the one that matters:
   * a session that entered the archive from a replay page and came back out
   * must land on the replay again, not on the live app. */
  params.delete(PARAM.season);
  params.delete(PARAM.storms);
  if (season) {
    params.set(PARAM.season, String(season));
    if (storms.length) params.set(PARAM.storms, storms.join(','));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * Write the archive state into the address bar without navigating.
 *
 * Guarded: `replaceState` throws on a `file://` page and in a sandboxed
 * iframe, and an address bar that did not update is not worth taking the
 * archive down for.
 */
export function write(state) {
  try {
    const search = toSearch(state, location.search);
    history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  } catch {
    /* The bar on screen still says where the reader is. */
  }
}

/** Take the archive out of the address bar. Same guard, same reason. */
export function clear() {
  write({ season: null, storms: [] });
}
