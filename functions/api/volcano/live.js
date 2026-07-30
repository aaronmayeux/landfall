/**
 * /api/volcano/live — what is erupting on Earth right now, from three feeds.
 *
 * FOUR FETCHES BEHIND ONE ROUTE, AND TWO OF THEM ARE OUR OWN.
 *
 *   1-2  /api/volcano/ash?group=a|b   ALL NINE VAAC centres, 62 bulletin slots
 *   3    volcano.si.edu WeeklyVolcanoRSS     global weekly, all activity types
 *   4    volcanoes.usgs.gov HANS             US alert levels
 *
 * ==> WHY THE ASH READ IS TWO SUBREQUESTS TO OURSELVES INSTEAD OF 62 TO NOAA.
 * <== Cloudflare's FREE plan allows 50 external subrequests per invocation and
 * 50 is the free MAXIMUM — `limits.subrequests` raises a PAID cap only
 * (verified against Cloudflare's docs 2026-07-30). Reading every centre costs
 * 62 fetches, so one route cannot do it. Splitting the read across two sibling
 * routes gives each half its own 50-budget and brings this route's own cost to
 * four. **The alternative was dropping ~14 slots and hoping none of them
 * mattered. See `_slots.js` for why that was the worse trade.**
 *
 * ==> BoM IS GONE AND MUST NOT COME BACK. <== It was the primary — eight
 * centres and seven days of history behind one fetch — and it answers HTTP 403
 * to this runtime, with a block page that asks in words for automated access to
 * stop. A bare header-free fetch does still get through; we do not use it. The
 * full measurement is in `_slots.js`. **The cost is real and it is stated in
 * the payload rather than papered over: these bulletin slots are latest-only
 * with no archive, so one missed poll is one lost eruption.** Our own KV
 * archive is the answer to that and it is the next pass.
 *
 * WHY THIS IS ONE ROUTE AND NOT THREE, when §4.3 says keep the relay dumb: the
 * NHC/GDACS pattern relays per source and merges in the browser because those
 * are two views of the SAME storms. These are three feeds with three different
 * definitions of "active" that need dedupe, close-detection and an age filter
 * before any of it means anything — real logic, which belongs in one place and
 * must not run three times on a phone at boot. The BoM page alone carries ~83
 * advisories; shipping that to a handset to be parsed there would be the
 * performance lens losing an argument it should win. The cost is one failure
 * surface, and it is paid for by PER-SOURCE STATE IN THE PAYLOAD (_union.js).
 *
 * ==> TRAP 1: CACHE-BUST EVERY UPSTREAM FETCH. <== Measured on three
 * independent government weather hosts 2026-07-30. A bare fetch of the BoM
 * page returned advisories 29 DAYS OLD; the same URL with a cache-busting
 * parameter returned one 83 minutes old. Same failure on ospo.noaa.gov (6 days)
 * and JMA (24 days). **Without this the relay serves month-old ash during an
 * eruption and every health check passes** — a §5 silence bug with a plausible
 * face on it. The trap outlived the BoM page it was measured on: it still
 * applies to the weekly RSS here, and `ash.js` sends no-cache headers to every
 * bulletin slot for the same reason.
 *
 * ==> TRAP 2: THE WEEKLY RSS NEEDS A BROWSER-SHAPED User-Agent. <== A bare
 * server fetch gets 403. This is the original reason this layer is a relay at
 * all, and it is the same reason /api/jtwc/warning sends a UA.
 *
 * ==> TRAP 3: HANS MUST NOT BE CACHE-BUSTED WITH A QUERY PARAMETER. <== It
 * routes on the path, so `?cb=...` becomes part of the action name and the
 * service answers **HTTP 200 with an error body** — the failure shape that
 * looks exactly like a healthy fetch of an empty, calm United States. Header
 * only, and `_union.js` refuses a non-array body outright.
 *
 * ==> NO KV WARM CACHE ON THIS ROUTE YET, AND THAT DECISION IS NOW ON NOTICE.
 * <== It was made for a good reason: the cron runs every five minutes and
 * warming six government hosts on that cadence is ~1,700 fetches a day for
 * data that changes a few times a day, so a warm read nothing wrote would have
 * been dead code pretending to be an optimisation.
 *
 * **What changed is that losing BoM took the archive with it.** BoM carried
 * seven days, so a missed poll was survivable; the bulletin slots are
 * latest-only and overwritten in place, so a missed poll now loses an advisory
 * permanently. That turns KV from an optimisation into the archive itself — the
 * cron Worker accumulating advisories would beat BoM's seven days and depend on
 * nobody. **And it costs the Worker TWO subrequests, not 62** — it warms by
 * calling our own routes, so `?group=a` and `?group=b` hand it all 62 slots'
 * text already concatenated. The 50-fetch cap is not the constraint there; the
 * free plan's 1,000 KV writes a day is, which is why the archive is written
 * one key per advisory and never rewritten. **Scoped, not built — see
 * `claude/ash-archive-scope-2026-07-30.md` and NOW.md.**
 *
 * Cloudflare Pages Functions run in their own workerd runtime, so this file is
 * SELF-CONTAINED (§3) apart from its two siblings under this directory. The
 * VOLCANO tuning block is mirrored below rather than imported, and
 * tools/test-vaa.mjs asserts the mirror agrees with config/constants.js —
 * same arrangement, and same reason, as worker/src/sources.js and the KV keys.
 */

import { parseStream } from './_vaa.js';
import { buildPayload, parseWeekly, parseAlerts } from './_union.js';
import { ALL_CENTRES, centresInGroup } from './_slots.js';

/**
 * ==> A MIRROR OF config/constants.js's VOLCANO BLOCK, AND THE MIRROR IS
 * ASSERTED. <== Pages Functions cannot import from the app (§3), so the
 * alternative to duplicating these five numbers is hardcoding them at the
 * three call sites, which is the same duplication with nowhere to check it.
 * `tools/test-vaa.mjs` reads both files and fails if they disagree — the
 * arrangement `tools/test-kv-keys.mjs` already uses for the KV key shapes.
 * **If you change a number here, change it there.**
 */
const VOLCANO = Object.freeze({
  ash: Object.freeze({
    freshSeconds: 30 * 60,
    staleSeconds: 6 * 60 * 60,
    advisoryMaxAgeHours: 24,
    exerciseStatus: Object.freeze(['EXER', 'TEST']),
    flightLevelToFeet: 100,
  }),
  alerts: Object.freeze({ freshSeconds: 15 * 60, staleSeconds: 6 * 60 * 60 }),
  weekly: Object.freeze({ freshSeconds: 6 * 60 * 60, staleSeconds: 10 * 24 * 60 * 60 }),
  state: Object.freeze({
    ok: 'ok',
    /* `degraded` = the fetch worked and the coverage did not. See
     * config/constants.js for why this state exists. */
    degraded: 'degraded',
    stale: 'stale',
    clear: 'clear',
    unavailable: 'unavailable',
  }),
});

const UPSTREAM = Object.freeze({
  weekly: 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml',
  alerts: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
});

/** The two ash group routes, on OUR origin. Built from the incoming request
 *  rather than hardcoded so preview deploys read their own groups and not
 *  production's — a preview silently reading production is how you verify a
 *  deploy that never happened. */
const ashGroupUrl = (origin, group) => `${origin}/api/volcano/ash?group=${group}`;

/** Our own identity, as on every other relay route. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/**
 * ==> AND THE ONE UA THAT IS NOT OURS. <== volcano.si.edu answers 403 to a
 * bare server fetch and 200 to a browser-shaped one. Sending a browser string
 * is not something to do casually — it is a claim about what we are — so it is
 * confined to the single host that requires it, and the honest identifier is
 * appended rather than hidden, so a Smithsonian log reader can still see who
 * this is and where to complain.
 */
const WEEKLY_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ' +
  'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Per-fetch timeout. A single slow government host must not hold the whole
 *  route open — the other five channels are still worth serving, and a
 *  channel that times out becomes `unavailable`, which is a real answer. */
const FETCH_TIMEOUT_MS = 8000;

/** The freshness window of the ROUTE is the tightest of the three channels.
 *  Serving a 30-minute-old ash reading is the point; serving a 30-minute-old
 *  weekly report costs nothing because it changes on Thursdays. */
const FRESH_SECONDS = VOLCANO.ash.freshSeconds;
const STALE_SECONDS = VOLCANO.ash.staleSeconds;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  ...extra,
});

/** Cache-busting parameter. Time-based, at the freshness granularity that
 *  matters — a value that changed per request would make the colo cache
 *  useless, and a value that never changed would reintroduce the trap. */
const bust = (url, nowMs) => {
  const u = new URL(url);
  u.searchParams.set('cb', String(Math.floor(nowMs / 1000)));
  return u.toString();
};

/**
 * One upstream fetch. Never throws: returns `{ok: false, error}` instead,
 * because a dead channel is a REPORTABLE STATE and not an exception — the
 * whole design is that two live channels still reach the client while the
 * third is down (§5, "one source down must not blind the other").
 */
async function pull(url, { headers = {}, bustQuery = true, nowMs, as = 'text' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(bustQuery ? bust(url, nowMs) : url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        /* Belt and braces with the query parameter. Government weather hosts
         * sit behind caches that honour one, the other, or neither. */
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        ...headers,
      },
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    if (as === 'json') {
      /* A JSON body that will not parse is an upstream fault, and it must not
       * become an empty result. */
      try {
        return { ok: true, json: await r.json() };
      } catch {
        return { ok: false, error: 'body is not JSON' };
      }
    }
    return { ok: true, text: await r.text() };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ==> THE CACHE KEY CARRIES A PAYLOAD VERSION, AND IT IS NOT DECORATION. <==
 * Measured 2026-07-30, an hour after the nine-centre deploy went live: a read
 * of this route came back in the PREVIOUS deploy's shape — `transports: {bom,
 * wellington}`, no `coverage` object at all, one centre listed — stamped 53
 * minutes old. The colo cache is keyed on a fixed internal URL, so it SURVIVES
 * A DEPLOY: new code, old body, and every consumer of `coverage.level` reading
 * `undefined` while the route looks perfectly healthy. That is a §5 silence bug
 * with a plausible face on it, and the coverage field it erases is the exact
 * one added to stop Etna erupting invisibly.
 *
 * **BUMP THIS WHENEVER THE PAYLOAD SHAPE CHANGES.** Adding a field counts —
 * a client that feature-detects the new field gets the old body and concludes
 * the field is unsupported. The old entries are not deleted; they simply stop
 * being addressed and age out on their own TTL.
 */
const PAYLOAD_VERSION = 'v2';

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request(
    `https://landfall-relay.internal/volcano/live/${PAYLOAD_VERSION}/fresh`
  );
  const lastGoodKey = new Request(
    `https://landfall-relay.internal/volcano/live/${PAYLOAD_VERSION}/last-good`
  );

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  const nowMs = Date.now();

  /* ==> ALL FOUR IN PARALLEL. <== One unreachable host must cost the other
   * three nothing. `pull()` already refuses to throw, so a rejection here
   * would mean a bug in this file rather than an upstream failure — the
   * alternative to handling it is a 500 that takes three healthy channels down
   * with it. */
  const origin = new URL(context.request.url).origin;
  const [groupA, groupB, weeklyRes, alertsRes] = await Promise.all([
    /* ==> NO CACHE-BUSTER ON OUR OWN ROUTES. <== `ash.js` owns a deliberate
     * five-minute stampede guard that must be allowed to work; busting it here
     * would put 62 NOAA fetches behind every single miss of this route. And
     * `?cb=` would not bust it anyway — `ash.js` caches on a fixed internal
     * key, exactly as this file does. */
    pull(ashGroupUrl(origin, 'a'), { nowMs, bustQuery: false, as: 'json' }),
    pull(ashGroupUrl(origin, 'b'), { nowMs, bustQuery: false, as: 'json' }),
    pull(UPSTREAM.weekly, { nowMs, headers: { 'User-Agent': WEEKLY_USER_AGENT } }),
    /* No query parameter — see TRAP 3 in the header. */
    pull(UPSTREAM.alerts, { nowMs, bustQuery: false, as: 'json' }),
  ]);

  /* --- the ash channel --------------------------------------------------
   * The two groups are ONE channel with two transports, not two channels.
   * Between them they carry all nine centres and all 62 bulletin slots, and
   * they are parsed TOGETHER and exactly once: `parseStream` dedupes on GVP
   * number + DTG and then takes the newest advisory per volcano, and both of
   * those decisions need every centre in front of them at the same time.
   * Centres issue on each other's behalf — a London bulletin read `VAAC LONDON
   * IS ISSUING THIS ADVISORY ON BEHALF OF VAAC TOULOUSE` — so half-parsing
   * would compute "newest" twice on partial evidence.
   *
   * ==> ONE GROUP ANSWERING IS STILL A LIVE CHANNEL, AND IT IS NOW ALSO A
   * REPORTED HOLE. <== Group A is Anchorage, Buenos Aires and Darwin; group B
   * is Wellington, Montreal, Tokyo, London, Toulouse and Washington. Losing
   * either leaves real eruptions visible and real eruptions invisible, which is
   * precisely the state that must never be worded as calm — so it resolves to
   * `degraded`, not `ok`, and `coverage.centresUnreachable` names the centres. */
  const groups = [
    { group: 'a', res: groupA },
    { group: 'b', res: groupB },
  ];

  const ashParts = [];
  const unreachable = new Set();
  const slotsFailed = [];
  let slotsExpected = 0;
  let slotsAnswered = 0;

  for (const { group, res } of groups) {
    if (res.ok && res.json && typeof res.json.text === 'string') {
      ashParts.push(res.json.text);
      slotsExpected += Number(res.json.slotsExpected) || 0;
      slotsAnswered += Number(res.json.slotsAnswered) || 0;
      for (const c of res.json.centresUnreachable || []) unreachable.add(c);
      for (const f of res.json.slotsFailed || []) slotsFailed.push(f);
    } else {
      /* ==> A DEAD GROUP MEANS EVERY CENTRE IT OWNS IS DARK, AND WE KNOW
       * EXACTLY WHICH ONES FROM THE CHECKED-IN TABLE. <== Reporting "a group
       * failed" would make the reader look up what that means; reporting
       * "TOULOUSE, WASHINGTON, ... unreachable" is a fact about the world. */
      for (const c of centresInGroup(group)) unreachable.add(c);
    }
  }

  const ashTransportOk = ashParts.length > 0;
  const centresUnreachable = [...unreachable].sort();
  const coverageLevel = !ashTransportOk
    ? 'none'
    : centresUnreachable.length === 0
      ? 'global'
      : 'partial';

  const ashChannel = ashTransportOk
    ? {
        ok: true,
        fetchedAt: new Date(nowMs).toISOString(),
        parsed: parseStream(ashParts.join('\n'), {
          exerciseStatus: VOLCANO.ash.exerciseStatus,
          flightLevelToFeet: VOLCANO.ash.flightLevelToFeet,
        }),
        /** ==> HOW MUCH OF THE WORLD THIS READING COVERS. <== `_union.js`
         *  turns this into the channel's `state`, and a `partial` level can no
         *  longer resolve to `ok`. This field is the fix for the bug that let
         *  Etna erupt at COLOUR CODE RED with ash to FL230 while the ash
         *  channel reported `ok` on three Wellington slots. */
        coverage: {
          level: coverageLevel,
          centresExpected: ALL_CENTRES.length,
          centresUnreachable,
          slotsExpected,
          slotsAnswered,
        },
        /** Which transports answered, ==> AND WHY THE FAILED ONES DID NOT.
         *  <== The first live deploy came back `bom: false` with the reason
         *  nowhere in the payload, so the channel was running on three small
         *  Pacific bulletin slots while reporting `ok` and there was no way to
         *  tell from outside whether BoM was 403ing, timing out or blocking
         *  the datacenter. That is this project's own §5 rule ("name every
         *  soft-fail") broken by the file that exists to enforce it. Never
         *  again: a failure that cannot be read from the payload is a failure
         *  that costs an evening. */
        transports: {
          groupA: groupA.ok,
          groupAError: groupA.ok ? null : String(groupA.error || 'unknown'),
          groupB: groupB.ok,
          groupBError: groupB.ok ? null : String(groupB.error || 'unknown'),
          /** Individual bulletin slots that failed while their group route
           *  succeeded. Normally empty. A slot listed here is one advisory
           *  channel we cannot see, which matters because these files are
           *  latest-only — see `_slots.js`. */
          slotsFailed,
        },
      }
    : {
        ok: false,
        error:
          `both ash groups down (a: ${groupA.error || 'unknown'}; ` +
          `b: ${groupB.error || 'unknown'})`,
      };

  const weeklyChannel = weeklyRes.ok
    ? { ok: true, fetchedAt: new Date(nowMs).toISOString(), parsed: parseWeekly(weeklyRes.text) }
    : { ok: false, error: weeklyRes.error };

  const parsedAlerts = alertsRes.ok ? parseAlerts(alertsRes.json) : null;
  const alertsChannel = parsedAlerts
    ? { ok: true, fetchedAt: new Date(nowMs).toISOString(), parsed: parsedAlerts }
    : {
        ok: false,
        /* A 200 carrying `{"error": ...}` lands here, not in the empty case.
         * `parseAlerts` returning null IS that detection. */
        error: alertsRes.ok ? 'HANS answered 200 with a non-array body' : alertsRes.error,
      };

  const payload = buildPayload(
    { ash: ashChannel, weekly: weeklyChannel, alerts: alertsChannel },
    VOLCANO,
    nowMs
  );
  if (ashChannel.ok) payload.sources.ash.transports = ashChannel.transports;

  const body = JSON.stringify(payload);
  const anyChannelUp = ashChannel.ok || weeklyChannel.ok || alertsChannel.ok;

  /* ==> A PAYLOAD WITH EVERY CHANNEL DOWN IS NEVER CACHED AS LAST-GOOD. <==
   * Caching it would mean serving "everything is unavailable" for six hours
   * after the world came back, and — worse — it would overwrite a last-good
   * copy that still had real advisories in it. Stale data with a visible
   * timestamp beats a blank screen (§5); stale data with three dead channels
   * in it beats nothing at all. */
  const headers = jsonHeaders({ 'X-Landfall-Fetched-At': payload.fetchedAt });

  if (anyChannelUp) {
    context.waitUntil(
      Promise.all([
        cache.put(
          freshKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
          })
        ),
        cache.put(
          lastGoodKey,
          new Response(body, {
            headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
          })
        ),
      ])
    );
    return new Response(body, { headers });
  }

  /* Everything is down. Serve the last good copy, FLAGGED, so the client can
   * say "this is from 40 minutes ago" instead of "there are no volcanoes". */
  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const staleBody = await stale.text();
    return new Response(staleBody, {
      headers: jsonHeaders({
        'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
        'X-Landfall-Stale': 'true',
      }),
    });
  }

  /* No upstream, no last-good. ==> STILL RETURN THE PAYLOAD, WITH ITS THREE
   * `unavailable` CHANNELS, AND STILL 200. <== A 502 with an error body would
   * tell the client "the relay failed" and nothing about WHICH source failed,
   * and the client would have to invent the three states this payload already
   * states correctly. There is no all-clear anywhere in it. */
  return new Response(body, {
    headers: jsonHeaders({
      'X-Landfall-Fetched-At': payload.fetchedAt,
      'X-Landfall-All-Sources-Down': 'true',
    }),
  });
}
