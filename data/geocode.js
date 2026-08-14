/**
 * geocode.js — address search, client side (SPEC §8).
 *
 * Talks to /api/geocode, never to Mapbox directly — the token is server-side
 * and stays there.
 *
 * The contract this file owns: a geocode result is a GUESS, and it is labelled
 * as one. A wrong home silently poisons every distance and closest-approach
 * figure downstream, so nothing here ever commits a location. It returns
 * candidates; the confirm-and-drag step in the UI is what makes one real.
 *
 * Three states, explicitly, like every async surface (SPEC §5):
 *   { status: 'ok',          results: [...] }
 *   { status: 'none_matched' }                  — searched, nothing found
 *   { status: 'unavailable', message, canRetry } — the search itself failed
 *
 * 'none_matched' and 'unavailable' are NOT the same and must never render the
 * same. "No such address" sends someone back to their typing; "search is down"
 * sends them to the manual pin. Collapsing them wastes the user's time on the
 * wrong recovery.
 *
 * Imports: config/ only. No UI, no map.
 */

import { GEOCODE } from '../config/constants.js';

const ENDPOINT = '/api/geocode';

/* ---------------------------------------------------------------------------
 * ERROR VOCABULARY
 *
 * The relay sends codes; this is where they become sentences a person can act
 * on (SPEC §5: no raw exception text, ever). Each one names the recovery.
 * ------------------------------------------------------------------------- */

const MESSAGES = Object.freeze({
  geocode_not_configured:
    'Address search isn’t set up yet — drop a pin on the globe instead.',
  geocode_auth_failed:
    'Address search isn’t working right now — drop a pin on the globe instead.',
  geocode_quota_exceeded:
    'Address search has hit its limit for now — drop a pin on the globe instead.',
  rate_limited:
    'Too many searches just now. Wait a moment, or drop a pin on the globe.',
  geocode_upstream_error:
    'Address search isn’t responding — drop a pin on the globe instead.',
  geocode_unreachable:
    'Can’t reach address search — check your connection, or drop a pin.',
  query_too_short: 'Type a little more to search.',
  query_too_long: 'That search is too long.',

  /* --- reverse lookup ------------------------------------------------------
   * A DIFFERENT TONE ON PURPOSE. A failed forward search blocks the user —
   * they cannot get where they are going, so every message above names the
   * escape hatch. A failed reverse lookup blocks NOTHING: the pin is already
   * in the right place, the home will work perfectly, and the only thing lost
   * is the pretty name. So these say what is missing and stop, rather than
   * sending somebody to fix a problem they do not have. */
  reverse_not_configured: 'Couldn’t look up the name of this place.',
  reverse_auth_failed: 'Couldn’t look up the name of this place.',
  reverse_quota_exceeded: 'Couldn’t look up the name of this place right now.',
  reverse_upstream_error: 'Couldn’t look up the name of this place right now.',
  reverse_unreachable: 'Couldn’t look up the name of this place — no connection.',
  bad_coordinates: 'Couldn’t look up the name of this place.',
});

/** Which failures are worth a retry button. A missing token or a blown quota
 *  will not fix itself in five seconds; a network blip might. */
const RETRYABLE = new Set([
  'geocode_upstream_error',
  'geocode_unreachable',
  'rate_limited',
]);

const unavailable = (code, detail) => ({
  status: 'unavailable',
  code,
  message: MESSAGES[code] || 'Address search isn’t available — drop a pin instead.',
  canRetry: RETRYABLE.has(code),
  detail, // for the console seam only, never rendered
});

/* ---------------------------------------------------------------------------
 * CONFIDENCE
 *
 * Mapbox gives two signals and they answer different questions:
 *   relevance — "did I understand what you typed?"
 *   accuracy  — "how precise is the point I'm giving you?"
 *
 * A rooftop match on a misread address is confidently wrong; a perfectly
 * understood postcode is a 5-mile circle. Home needs BOTH to be good, so the
 * low-confidence flag trips on either.
 * ------------------------------------------------------------------------- */

/** Mapbox accuracy values that mean "this is a real point", as opposed to a
 *  centroid of an area. Anything else gets the prominent drag hint. */
const PRECISE_ACCURACY = new Set(['rooftop', 'parcel', 'point', 'address']);

function isLowConfidence(result) {
  if (typeof result.relevance === 'number' && result.relevance < GEOCODE.lowConfidence) {
    return true;
  }
  /* An `address` type with no accuracy field is Mapbox's interpolated street
   * position — good to a few houses, not to a driveway. Treat as imprecise. */
  if (result.type === 'address') return !PRECISE_ACCURACY.has(result.accuracy);
  /* place / postcode / locality are areas by definition. Always imprecise as
   * a home point, however confident the match. */
  return true;
}

/** Decorate raw relay results with the flag the UI branches on, so the
 *  confidence rule lives in exactly one place. */
const decorate = (results) =>
  results.map((r) => ({ ...r, lowConfidence: isLowConfidence(r) }));

/* ---------------------------------------------------------------------------
 * THE SEARCH
 * ------------------------------------------------------------------------- */

/** One-shot search. `signal` lets a caller abort a stale in-flight request —
 *  without it, a slow response for "12 Ma" can land after "12 Main St" and
 *  overwrite the newer results with older ones. */
export async function search(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < GEOCODE.minChars) return { status: 'none_matched' };

  let r;
  try {
    r = await fetch(`${ENDPOINT}?q=${encodeURIComponent(q)}`, { signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e; // caller's own cancellation, not an error
    return unavailable('geocode_unreachable', e?.message);
  }

  if (!r.ok) {
    let code = 'geocode_upstream_error';
    try {
      const body = await r.json();
      if (body?.error) code = body.error;
    } catch {
      /* Non-JSON error body — keep the generic code rather than guessing. */
    }
    return unavailable(code, `HTTP ${r.status}`);
  }

  let data;
  try {
    data = await r.json();
  } catch (e) {
    return unavailable('geocode_upstream_error', e?.message);
  }

  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) return { status: 'none_matched' };

  return { status: 'ok', results: decorate(results) };
}

/* ---------------------------------------------------------------------------
 * REVERSE — a point in, a name out
 *
 * ==> THIS IS THE OTHER HALF OF THE SAME PROMISE, AND IT WAS MISSING. <==
 * The forward search hands back a labelled result, so an address-set home has
 * always had a name. A home set by dropping or dragging a pin had none, and
 * every screen that wanted to say where home is printed `29.301, -94.798`
 * instead. Coordinates are true and unreadable, and a number where a place
 * name belongs is the app admitting it does not know what it is looking at.
 *
 * THE SAME THREE STATES, and the middle one carries real meaning here:
 *   { status: 'ok', label }   a place we can name
 *   { status: 'none_matched' } nowhere named is near enough to say
 *   { status: 'unavailable', message } the lookup itself failed
 *
 * ==> `none_matched` IS NOT "OVER WATER". <== It is "Mapbox has no polygon
 * containing this point", which is equally true of the open Atlantic, the
 * middle of the Sahara, and the Greenland ice sheet. Whether a point is on
 * water is answered from the basemap on the client (`map/water-at.js`), and
 * the two answers are combined at the point of display (`lib/place-label.js`).
 * Collapsing them here would put "Open water" under a pin in a desert.
 * ------------------------------------------------------------------------- */

const REVERSE_ENDPOINT = '/api/reverse';

/**
 * @param {number} lon
 * @param {number} lat
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] Cancel a lookup for a pin that has since
 *        been dragged somewhere else.
 */
export async function reverseGeocode(lon, lat, { signal } = {}) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return unavailable('bad_coordinates');
  }

  let r;
  try {
    r = await fetch(
      `${REVERSE_ENDPOINT}?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`,
      { signal }
    );
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return unavailable('reverse_unreachable', e?.message);
  }

  if (!r.ok) {
    let code = 'reverse_upstream_error';
    try {
      const body = await r.json();
      if (body?.error) code = body.error;
    } catch {
      /* Non-JSON error body — keep the generic code rather than guessing. */
    }
    return unavailable(code, `HTTP ${r.status}`);
  }

  let data;
  try {
    data = await r.json();
  } catch (e) {
    return unavailable('reverse_upstream_error', e?.message);
  }

  const label = typeof data?.label === 'string' ? data.label.trim() : '';
  if (!label) return { status: 'none_matched' };

  return { status: 'ok', label };
}

/* ---------------------------------------------------------------------------
 * DEBOUNCED SEARCHER
 *
 * Autocomplete fires per keystroke. Undebounced, "1600 Pennsylvania Ave" is
 * 23 billed requests. Debounced at GEOCODE.debounceMs it is one or two.
 *
 * Returns a stateful object rather than a bare function because it owns an
 * AbortController per query — cancelling the previous request is what keeps
 * results from arriving out of order.
 * ------------------------------------------------------------------------- */

export function createSearcher(onState) {
  let timer = null;
  let controller = null;
  let seq = 0;

  const cancelInFlight = () => {
    if (controller) controller.abort();
    controller = null;
  };

  const run = async (q) => {
    cancelInFlight();
    controller = new AbortController();
    const mine = ++seq;

    onState({ status: 'loading', query: q });

    try {
      const state = await search(q, { signal: controller.signal });
      /* Guard against an older request resolving after a newer one. The abort
       * above handles most of it; this catches the race where a response was
       * already in flight when abort fired. */
      if (mine === seq) onState({ ...state, query: q });
    } catch (e) {
      if (e?.name !== 'AbortError' && mine === seq) {
        onState({ ...unavailable('geocode_unreachable', e?.message), query: q });
      }
    }
  };

  return {
    /** Call on every keystroke. Cheap — it only schedules. */
    input(value) {
      clearTimeout(timer);
      const q = String(value || '').trim();

      if (q.length < GEOCODE.minChars) {
        cancelInFlight();
        seq++; // invalidate anything in flight
        onState({ status: 'idle', query: q });
        return;
      }
      timer = setTimeout(() => run(q), GEOCODE.debounceMs);
    },

    /** Skip the debounce — for Enter, or a retry button. */
    now(value) {
      clearTimeout(timer);
      const q = String(value || '').trim();
      if (q.length < GEOCODE.minChars) {
        onState({ status: 'idle', query: q });
        return;
      }
      run(q);
    },

    destroy() {
      clearTimeout(timer);
      cancelInFlight();
      seq++;
    },
  };
}
