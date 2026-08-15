/**
 * /api/nhc/ships?id=ep082026 — the environment ribbon's feed. §47.2, §47.6.
 *
 * WHAT COMES BACK: a small JSON of per-hour knots, not the fixed-width table.
 *
 * ==> THIS ROUTE PARSES, AND THAT BENDS "KEEP IT DUMB" (§4.3). <== It is the
 * second bounded exception after the a-deck filter, and §47.7 is where it was
 * decided rather than here. Three reasons it earns the exception:
 *
 *   1. THE UPSTREAM HAS NO `latest`. Files are named by synoptic hour, so
 *      "give me this storm's current SHIPS" is a LOOP of up to three fetches
 *      that only ends when one answers or all three miss (§47.2). That loop
 *      cannot live in a browser without three round trips per storm.
 *   2. SIZE. 9-10 KB of fixed-width text per storm per advisory against a few
 *      KB of numbers, for a layer drawn for EVERY storm that has a file rather
 *      than only the selected one (§47.7).
 *   3. The parse DECIDES NOTHING. `_ships-parse.js` places nineteen rows in
 *      the three groups §47.4 names and checks its own arithmetic. Every
 *      judgement — what colour, what words, what the reader is told — still
 *      happens in the browser, which is what the rule is actually protecting.
 *
 * Pages Functions run in their own workerd runtime with no access to this
 * project's config (§4.13), so the cache numbers below mirror §4.13's table by
 * hand and say so, exactly as the storm list and GDACS geometry do.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';
import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';
import { parseShips, ShipsParseError } from './_ships-parse.js';

const HOST = 'https://ftp.nhc.noaa.gov/atcf/stext';

/** NOAA servers 403 requests with no User-Agent. Identify ourselves plainly. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** The app's storm id, as CurrentStorms.json publishes it: `ep082026`. */
const ID_RE = /^([a-z]{2})(\d{2})(\d{4})$/;

/** ==> SHIPS COVERS THESE THREE BASINS AND NO OTHERS. <== §47.6. A typhoon
 *  must never render as a flat cone that looks like a calm environment, so a
 *  basin with no data is an ANSWER rather than an error — the layer row says
 *  so in words and the map draws nothing. */
const COVERED_BASINS = new Set(['AL', 'EP', 'CP']);

/* --------------------------------------------------------------------------
 * THREE SYNOPTIC SLOTS, NEWEST FIRST. §47.2, and the number is measured.
 *
 * Publication lag over a season of 365 runs: median 53 minutes after the
 * nominal hour, 90th percentile 140, 99th 374, worst 446 — over seven hours,
 * which is longer than the gap between runs. Simulating a poll every fifteen
 * minutes across every storm's life: the newest slot alone works 77% of the
 * time, two slots cover 98%, three cover 99.1%.
 *
 * So a single 404 is not an outage — it is the normal state for most of the
 * hour after a synoptic time, and treating it as one would have been wrong
 * almost a quarter of the time. Only after ALL THREE miss does this route say
 * no run is published.
 *
 * Two runs in the season arrived BEFORE their nominal hour, which is why the
 * newest slot is computed from the clock and simply tried rather than skipped
 * as impossible.
 * ----------------------------------------------------------------------- */
const SLOTS = 3;

/* --------------------------------------------------------------------------
 * CACHE, mirroring §4.13 by hand.
 *
 * FRESH 30 MIN — the house number, and twelve times faster than SHIPS's
 * 6-hourly reissue. It is deliberately NOT 5 minutes: a window equal to the
 * warm cron's cadence expires as its own replacement comes due, which is the
 * mistake that put DOLPHIN-26 behind a spinner on 2026-08-01.
 *
 * LAST-GOOD 12 H — two reissue cycles. A SHIPS run states its own synoptic
 * hour, which travels in the payload, so a stale environment is readable AS
 * stale rather than being decorated by us (§5).
 *
 * A "NO RUN PUBLISHED" ANSWER IS CACHED 15 MIN AND NEVER AS LAST-GOOD, which
 * is the same rule an empty MapServer answer follows. A remembered nothing is
 * strictly worse than the last real run: the first storm of a season gets
 * advisories before its first SHIPS, and that state is measured in hours, not
 * days. Fifteen minutes matches the poll cadence the three-slot number above
 * was simulated against.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 30 * 60;
const STALE_SECONDS = 12 * 60 * 60;
const NO_RUN_SECONDS = 15 * 60;

/** A cold miss cannot outlast the reader's patience (§4.13). */
const UPSTREAM_TIMEOUT_MS = 10_000;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  /* The phone caches nothing. Our relay URLs name no advisory, so a browser
   * holding a saved copy has no way to tell it has gone off (§4.13). */
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

/** `ep082026` -> `EP0826`. ==> THE TWO-DIGIT YEAR IS THE WHOLE TRAP. <== The
 *  app holds a four-digit year and the filename wants two. Getting it wrong
 *  yields a 404 indistinguishable from "this storm has no SHIPS run" (§47.2). */
function shipsStormId(basin, number, year) {
  return `${basin.toUpperCase()}${number}${year.slice(2)}`;
}

/** The synoptic hours, newest first, as `YYMMDDHH`. */
function synopticStamps(now, count) {
  const out = [];
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6);
  const p = (n) => String(n).padStart(2, '0');
  for (let i = 0; i < count; i++) {
    out.push(
      `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`
    );
    d.setUTCHours(d.getUTCHours() - 6);
  }
  return out;
}

async function fetchSlot(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
      signal: ctl.signal,
    });
    /* A 404 is the ordinary answer for a slot that is not published yet, and
     * it is separated from every other failure here. Collapsing the two would
     * turn a NOAA outage into "no run published", which reads to a reader as a
     * fact about their storm rather than a fact about our day. */
    if (r.status === 404) return { missing: true };
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    return { text: await r.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk the slots newest first and parse the first one that answers.
 *
 * A PARSE FAILURE ON A PUBLISHED FILE STOPS THE WALK. It is tempting to fall
 * through to the older slot and serve that instead, and it is wrong: the two
 * runs are the same format, so a file we cannot read means the format changed
 * and the older one is a coin flip that happens to have landed. Silently
 * serving a six-hour-old environment because the current one confused us is
 * exactly the confident-nonsense failure `_ships-parse.js` exists to prevent.
 */
async function pullUpstream(stormId, now) {
  for (const stamp of synopticStamps(now, SLOTS)) {
    const slot = await fetchSlot(`${HOST}/${stamp}${stormId}_ships.txt`);
    if (slot.missing) continue;
    return { run: parseShips(slot.text), stamp };
  }
  return { noRun: true };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const raw = String(url.searchParams.get('id') || '').toLowerCase();

  const m = ID_RE.exec(raw);
  if (!m) {
    return json({ error: 'bad_id', detail: 'id must look like ep082026' }, 400);
  }
  const [, basinLower, number, year] = m;
  const basin = basinLower.toUpperCase();

  /* ==> THE BASIN COMES FROM THE ID, NEVER FROM THE FILE'S HEADER TEXT. <==
   * Lala's file is headed EAST PACIFIC while her id is CP012026 (§47.2). */
  if (!COVERED_BASINS.has(basin)) {
    /* 200, not an error. §47.6: the absence is stated, not shaded. This is a
     * durable fact about the basin rather than a failure, so it is the one
     * answer here worth caching for a long time. */
    return json({ status: 'basin_not_covered', basin }, 200, {
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    });
  }

  const stormId = shipsStormId(basin, number, year);
  const cache = caches.default;
  const freshKey = new Request(`https://landfall-relay.internal/nhc/ships/${stormId}/fresh`);
  const lastGoodKey = new Request(`https://landfall-relay.internal/nhc/ships/${stormId}/last-good`);

  const warming = isWarmRequest(context.request, context.env);
  const kvPath = `nhc/ships/${stormId}`;

  /* THE HIT IS REBUILT, NEVER HANDED BACK AS STORED. The slot copies below
   * carry `Cache-Control: s-maxage=...` because that is how `caches.default`
   * is told how long to keep them; returning one verbatim published that
   * instruction to the public internet and Cloudflare's own edge honoured it
   * (§17.7). */
  const hit = warming ? null : await cache.match(freshKey);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  const warm = warming ? null : await kvRead(context.env, kvPath, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = {
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.KV,
    };
    context.waitUntil(
      cache.put(
        freshKey,
        new Response(warm.body, {
          headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })
      )
    );
    return json(JSON.parse(warm.body), 200, headers);
  }

  let upstreamError;
  try {
    const result = await pullUpstream(stormId, Date.now());
    const fetchedAt = new Date().toISOString();

    if (result.noRun) {
      /* All three slots missed. §47.6: a run counts as not published only
       * here, and never on a single 404. Short-cached, and NEVER written to
       * last-good — a remembered nothing would outlive the storm's first real
       * run by up to twelve hours. */
      const body = JSON.stringify({ status: 'no_run_published', stormId });
      context.waitUntil(
        cache.put(
          freshKey,
          new Response(body, {
            headers: {
              ...jsonHeaders({ 'X-Landfall-Fetched-At': fetchedAt }),
              'Cache-Control': `s-maxage=${NO_RUN_SECONDS}`,
            },
          })
        )
      );
      return json(JSON.parse(body), 200, {
        'X-Landfall-Fetched-At': fetchedAt,
        [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
      });
    }

    const payload = { status: 'ok', ...result.run };
    const body = JSON.stringify(payload);
    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      'X-Landfall-Ships-Run': result.stamp,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(
      Promise.all([
        cache.put(
          freshKey,
          new Response(body, {
            headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
          })
        ),
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
          })
        ),
      ])
    );

    return json(payload, 200, headers);
  } catch (e) {
    upstreamError = e;
  }

  /* Then the last good run, then the warm copy declined above as too old. Each
   * carries its own synoptic hour in the payload, so a reader is looking at a
   * dated run rather than an undated guess (§5). */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return json(await stale.json(), 200, {
      'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
      'X-Landfall-Stale': 'true',
      [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
    });
  }
  if (warm) {
    return json(JSON.parse(warm.body), 200, {
      'X-Landfall-Fetched-At': warm.fetchedAt || '',
      'X-Landfall-Stale': 'true',
      [CACHE_PATH_HEADER]: CACHE_PATH.KV_STALE,
    });
  }

  /* Codes, never prose — the client is the layer with the context to write a
   * sentence (§4.3). A parse failure is reported AS a parse failure and not as
   * an unreachable upstream: one means NOAA is down and the other means the
   * file changed under us, and only the second is ours to fix. */
  const parseFailure = upstreamError instanceof ShipsParseError;
  return json(
    {
      error: parseFailure ? 'ships_unreadable' : 'ships_unreachable',
      code: parseFailure ? upstreamError.code : undefined,
      detail: String(upstreamError?.message || upstreamError),
    },
    502
  );
}
