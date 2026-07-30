/**
 * /api/volcano/ash?group=a|b — one half of the nine-centre VAAC bulletin read.
 *
 * ==> THIS ROUTE EXISTS FOR EXACTLY ONE REASON: A SUBREQUEST BUDGET. <==
 * Reading every VAAC centre costs 62 fetches (`_slots.js`). Cloudflare's FREE
 * plan allows 50 external subrequests per invocation, and 50 is the free
 * MAXIMUM — `limits.subrequests` raises a PAID cap only. So `/api/volcano/live`
 * cannot read the world by itself, and splitting the read across two routes
 * gives each half its own 50-budget. `live.js` then spends four fetches total:
 * these two, plus the weekly RSS and HANS.
 *
 * ==> THE ALTERNATIVE WAS GUESSING, WHICH IS WHY THIS SHAPE WON. <== The other
 * free path was trimming to ~48 slots by dropping the AWIPS `.vaa.akN`
 * re-routings and Melbourne's relays of Darwin. But `fvfe01.rjtd..txt` is 880
 * bytes against `fvfe01.rjtd.vaa.ak1.txt` at 775, so those are NOT the same
 * bytes and might not be the same advisory. Fetching a duplicate is free —
 * `parseStream` dedupes on GVP number + DTG. Not fetching one is how an
 * eruption goes missing. **This route reads all 62. Nothing is guessed at.**
 *
 * WHY IT RETURNS RAW TEXT AND NOT PARSED RECORDS. `parseStream` dedupes and
 * then takes the newest advisory per volcano, and both of those are decisions
 * that must be made across ALL nine centres at once — centres issue on each
 * other's behalf, so the same eruption arrives from London and Toulouse. Parse
 * each half separately and "newest per volcano" is computed twice on partial
 * evidence, then has to be re-resolved anyway. So each half returns the
 * concatenated bulletin text, `live.js` joins the two and parses ONCE, and the
 * parser's semantics are byte-for-byte what the test suite already asserts.
 * The text is ~25 KB per group; that is nothing at the edge and it buys a
 * blast radius of zero on a 196-assertion suite.
 *
 * PER-SLOT STATUS IS THE POINT OF THE ENVELOPE. A group that fetched 31 of 32
 * slots is not the same as one that fetched 32, and the difference is which
 * centre we cannot see. `live.js` turns these into the payload's coverage
 * report — the thing whose absence let Etna erupt at COLOUR CODE RED while the
 * ash channel said `state: ok`.
 *
 * NOT A PROXY. `group` is matched against a two-item allow-list; every URL
 * comes from the checked-in table in `_slots.js`. No host, path or filename is
 * ever taken from the caller.
 *
 * Self-contained per §3 apart from its sibling `_slots.js`.
 */

import { GROUPS, slotsInGroup, centresInGroup, slotUrl } from './_slots.js';

/** Our own identity, byte-identical to every other relay route. NOAA accepts
 *  it — the three Wellington slots have been answering under it in production
 *  all along. **We do not send a browser-shaped User-Agent here.** BoM taught
 *  the lesson: impersonation is both a claim we should not make and a worse
 *  bot signature than honesty. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Per-fetch timeout. One slow slot must not hold the group open — the other
 *  thirty are still worth returning, and a slot that times out is reported as
 *  failed, which is a real answer. */
const FETCH_TIMEOUT_MS = 8000;

/** How many slots to have in flight at once. Thirty-two simultaneous requests
 *  at one government host is impolite and is itself a thing an edge can start
 *  refusing — which would look exactly like the BoM failure and cost another
 *  evening to diagnose. Four rounds of twelve on 600-byte files is fast. */
const CONCURRENCY = 12;

/**
 * ==> THIS CACHE MUST STAY WELL UNDER `VOLCANO.ash.freshSeconds` (30 min) AND
 * THAT IS NOT A STYLE CHOICE. <== `live.js` caches its payload for 30 minutes.
 * If this route also cached for 30, the two windows would COMPOUND and the
 * route could serve 60-minute-old ash while promising 30. Five minutes makes
 * this a stampede guard — its only job — and leaves the freshness promise
 * owned by exactly one file.
 */
const GROUP_CACHE_SECONDS = 5 * 60;

/** Envelope shape version, carried in the cache key. Bump on any change to the
 *  JSON this route returns — `text`, `slotsExpected`, `slotsAnswered`,
 *  `centresUnreachable`, `slotsFailed`. See `live.js`'s `PAYLOAD_VERSION`. */
const ENVELOPE_VERSION = 'v2';

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/**
 * One slot. Never throws: a dead slot is a reportable state, not an exception.
 * Returns the bulletin text on success and a named reason on failure.
 */
async function pullSlot(slot) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(slotUrl(slot.file), {
      signal: ctl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain,*/*',
        /* These files are overwritten in place with no cache-friendly
         * validators, and a stale copy of a bulletin slot is a stale eruption.
         * ==> NO `?cb=` QUERY PARAMETER HERE, DELIBERATELY. <== On BoM the
         * parameter was load-bearing; on tgftp the filename IS the resource
         * and a query string on a static text file is at best ignored and at
         * worst a cache-key explosion at our own edge. Header only. */
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (!r.ok) return { ...slot, ok: false, error: `HTTP ${r.status}`, text: '' };
    return { ...slot, ok: true, error: null, text: await r.text() };
  } catch (e) {
    return {
      ...slot,
      ok: false,
      error: e && e.name === 'AbortError' ? 'timeout' : 'network error',
      text: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const group = url.searchParams.get('group');

  /* ==> AN UNKNOWN GROUP IS A 400, NEVER AN EMPTY SUCCESS. <== An empty
   * bulletin set and a quiet planet are the same bytes, and serving one as the
   * other is the §5 failure this whole layer is built to avoid. */
  if (!GROUPS.includes(group)) {
    return new Response(
      JSON.stringify({
        error: 'unknown group',
        detail: `group must be one of: ${GROUPS.join(', ')}`,
      }),
      { status: 400, headers: jsonHeaders({ 'Cache-Control': 'no-store' }) }
    );
  }

  const cache = caches.default;
  /* Versioned for the same reason `live.js` is — the colo cache key survives a
   * deploy, so an envelope-shape change without a bump serves the previous
   * deploy's body under the new code. See the comment on `PAYLOAD_VERSION`
   * there; the measurement that produced it was on this route's caller. */
  const cacheKey = new Request(
    `https://landfall-relay.internal/volcano/ash/${ENVELOPE_VERSION}/${group}`
  );
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const slots = slotsInGroup(group);
  const results = [];

  /* Bounded concurrency. Sequential rounds of CONCURRENCY, so the whole group
   * completes in ceil(n / 12) round-trips rather than one thundering herd. */
  for (let i = 0; i < slots.length; i += CONCURRENCY) {
    /* eslint-disable-next-line no-await-in-loop */
    const round = await Promise.all(slots.slice(i, i + CONCURRENCY).map(pullSlot));
    results.push(...round);
  }

  const answered = results.filter((r) => r.ok);

  /** Which centres we actually reached, and which went dark. Derived from the
   *  TRANSPORT, not from whether any advisory was found — a centre that
   *  legitimately has nothing to say is reachable and quiet, and conflating
   *  that with unreachable is the exact error being fixed here. */
  const reachable = [...new Set(answered.map((r) => r.centre))].sort();
  const unreachable = centresInGroup(group).filter((c) => !reachable.includes(c));

  const payload = {
    group,
    fetchedAt: new Date().toISOString(),
    centresExpected: centresInGroup(group),
    centresReachable: reachable,
    centresUnreachable: unreachable,
    slotsExpected: slots.length,
    slotsAnswered: answered.length,
    /* The bulletins, concatenated. `live.js` joins both groups and parses the
     * whole thing once — see the header. */
    text: answered.map((r) => r.text).join('\n'),
    /* Failures only. Listing all 32 successes would be noise; a slot that
     * failed is the only per-slot fact anybody needs. */
    slotsFailed: results
      .filter((r) => !r.ok)
      .map((r) => ({ file: r.file, centre: r.centre, error: r.error })),
  };

  const body = JSON.stringify(payload);
  const headers = jsonHeaders({ 'X-Landfall-Fetched-At': payload.fetchedAt });

  /* ==> A GROUP WITH NOTHING ANSWERING IS NEVER CACHED. <== Caching it would
   * pin a five-minute hole over half the planet after the host came back, and
   * `live.js` needs to see the failure now rather than a cached copy of it. */
  if (answered.length > 0) {
    context.waitUntil(
      cache.put(
        cacheKey,
        new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${GROUP_CACHE_SECONDS}` },
        })
      )
    );
  }

  return new Response(body, {
    headers: answered.length === 0 ? { ...headers, 'X-Landfall-Group-Down': 'true' } : headers,
  });
}
