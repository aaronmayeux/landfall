/**
 * /api/jtwc/storms — which storms JTWC is warning on right now, by NAME.
 *
 * WHY THIS EXISTS AT ALL. Phase 6 step 6 renders advisory text, and GDACS —
 * the app's only source outside the NHC basins — publishes none. That was
 * checked in four places on 2026-07-25 and the findings are recorded in
 * functions/api/jtwc/inspect.js next door: the event list carries a one-line
 * blurb, `geteventdata` has no narrative field at any depth, `documents` and
 * `additionalinfos` are both EMPTY OBJECTS, and `report.aspx` is eight
 * headings of tables. What GDACS does carry is `source: "JTWC"` — and JTWC
 * publishes the text. Without this route, every storm outside the Atlantic
 * and the eastern Pacific reads "no advisory text exists," which is a much
 * bigger and more wrong claim than the truth (§5, and the same false-claim
 * mistake step 5 shipped and had to correct).
 *
 * THIS IS A BOUNDED EXCEPTION TO §4's "THE RELAY STAYS DUMB", the second one
 * in the project after the a-deck filter. Recorded plainly, because an
 * unexplained exception is how a rule quietly dies.
 *
 * WHAT FORCED IT. GDACS gives a NAME ("NOUL-26") and no designation — its
 * `sourceid`, the field that would carry one, is an EMPTY STRING. JTWC's
 * product URL gives a DESIGNATION ("wp1126") and no name. The only place the
 * two meet is inside each warning's own header line:
 *
 *     SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//
 *
 * The RSS itself cannot close the gap — measured, after a first parse got it
 * wrong: it carries ONE ITEM PER REGION ("Current Northwest Pacific/North
 * Indian Ocean* Tropical Systems"), listing several storms' products at once,
 * with no per-storm titles, no anchors, and no description text.
 *
 * So resolving a name means reading every active warning. Doing that in the
 * browser is up to eight cross-origin round trips — all of which come through
 * this relay anyway, because JTWC sends no CORS header (measured:
 * `Access-Control-Allow-Origin: null`) — on a phone, at the moment a user
 * taps a storm. Doing it here is one cached call for every storm and every
 * reader at once.
 *
 * WHY IT DOES NOT VIOLATE THE RULE'S INTENT. §4 keeps the relay dumb so the
 * parts that get TWEAKED stay debuggable on a phone plugged into a laptop —
 * the merge, the chronology, the intensity reads. This builds a lookup table
 * of four literal fields off one fixed header line. It interprets nothing and
 * renders nothing. The warning TEXT the reader actually sees is fetched raw
 * through /api/jtwc/warning and parsed in lib/advisory.js, in the browser,
 * like every other product in this app.
 *
 * THE DUPLICATED REGEX IS DELIBERATE AND GUARDED. `parseSubject` below is the
 * same match as `parseJtwcWarning` in lib/advisory.js, and it has to be — a
 * Pages Function runs in its own workerd runtime and cannot import the app
 * bundle (§3). Both are exported, and tools/test-advisory.mjs asserts they
 * agree on the same corpus. A copy nobody checks is how the two drift; a copy
 * with a test that fails when they disagree is just a copy.
 */

import { kvRead, isWarmRequest } from '../_kv-cache.js';

const HOST = 'https://www.metoc.navy.mil';
const RSS = `${HOST}/jtwc/rss/jtwc.rss`;

/** The KV path the cron Worker warms this route under (SPEC §17 Pass B).
 *  Must match `worker/src/sources.js` — tools/test-kv-keys.mjs asserts it.
 *
 *  WARMING THIS ONE IS WORTH MORE THAN THE OTHERS. Every request that misses
 *  here costs the RSS index PLUS one fetch per active warning product — up to
 *  nine round trips to the Navy before anybody sees anything. Serving it from
 *  KV turns the most expensive route in the app into an edge read. */
const KV_PATH = 'jtwc/storms';

/** Be identifiable in the Navy's logs, same as the other relays. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/**
 * Storm warnings are `{basin}{nn}{yy}web.txt` — `wp1126web.txt`.
 *
 * This pattern also does the FILTERING, which is worth stating because it
 * looks like it does not. The RSS additionally links `abpwweb.txt` and
 * `abioweb.txt`, the Significant Tropical Weather Advisories — area bulletins
 * about disturbances that are not yet storms and have no designation. They
 * fail the four-digit requirement and drop out here rather than needing a
 * denylist that would go stale.
 */
const PRODUCT_RE = /\/products\/([a-z]{2}\d{4})web\.txt/gi;

/** How many warnings to read at once. JTWC has run three concurrent storms
 *  today and peaks around a dozen worldwide; six at a time finishes in one or
 *  two rounds without opening a dozen sockets to a government host. */
const CONCURRENCY = 6;

/** Hard ceiling on products read per call. A runaway feed must not turn one
 *  request into ninety upstream fetches. Well above any real storm count. */
const MAX_PRODUCTS = 20;

/** Fresh window. JTWC warns every 6 h with intermediates; 15 min is well
 *  inside a cycle and means selecting six storms in a row costs one index. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale window on upstream failure: ~1.5x advisory cadence, the same
 *  9 h every other relay in this project uses. */
const STALE_SECONDS = 9 * 60 * 60;

const TIMEOUT_MS = 15000;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });

/**
 * The identity line of a JTWC warning.
 *
 *   SUBJ/TYPHOON 11W (NOUL) WARNING NR 008//
 *   SUBJ/TROPICAL DEPRESSION 12W WARNING NR 001//     ← unnamed, no parens
 *
 * MUST STAY IDENTICAL to parseJtwcWarning in lib/advisory.js. Exported so
 * tools/test-advisory.mjs can hold the two against the same corpus.
 */
export function parseSubject(text) {
  const m = String(text || '').match(
    /SUBJ\/\s*([A-Z][A-Z '.-]*?)\s+(\d{2}[A-Z])\s*(?:\(([^)]*)\))?\s*WARNING\s+NR\s*(\d+)/i
  );
  if (!m) return null;
  const name = m[3] ? m[3].trim() : null;
  return {
    kind: m[1].trim(),
    designation: m[2].toUpperCase(),
    name: name || null,
    warningNumber: m[4] || null,
  };
}

/**
 * Does this warning declare itself the FINAL one on the system?
 *
 *   THIS IS THE FINAL WARNING ON THIS SYSTEM BY THE JOINT TYPHOON WRNCEN
 *   PEARL HARBOR HI.
 *
 * CONFIRMED verbatim 2026-07-28 on Typhoon 26W (Mangkhut) Warning NR 039.
 *
 * MUST STAY IDENTICAL to isJtwcFinalWarning in lib/advisory.js, which carries
 * the full reasoning — why the match stops at "ON THIS SYSTEM" rather than
 * pinning the issuing centre, and why every gap is `\s+`. Exported so
 * tools/test-advisory.mjs can hold the two against the same corpus, the same
 * way it already guards `parseSubject`.
 */
export function isFinalWarning(text) {
  return /THIS\s+IS\s+THE\s+FINAL\s+WARNING\s+ON\s+THIS\s+SYSTEM/i.test(
    String(text || '')
  );
}

/* ---------------------------------------------------------------------------
 * INTENSITY — the reason this route stopped being only a name lookup
 *
 * WHAT IT FIXES. GDACS publishes NO current wind speed, anywhere, for any
 * storm (data/gdacs.js has the four-way proof). Its only number is a forecast
 * PEAK, and its only present-tense reading is three words: Depression, Storm,
 * Hurricane/Typhoon. Its strongest published band IS the Cat 1 floor, so a
 * marginal Cat 1 and a 160 kt super typhoon are the same word to it.
 *
 * The app therefore drew every GDACS hurricane at ONE height — the middle of
 * the whole hurricane range, ~109 kt (lib/category.js `representativeKt`) —
 * which is TALLER THAN A MEASURED NHC CAT 3. Reported by a user, confirmed
 * live 2026-07-28 on DOLPHIN (12W): GDACS labelled its forecast track "HU"
 * while JTWC had it at 45 kt. §9's "elevation and colour are one signal from
 * one number" was being fed a number that was not a measurement of anything.
 *
 * WHY HERE AND NOT A NEW ROUTE. This function ALREADY FETCHES EVERY ACTIVE
 * WARNING — that is what building the name index costs — and then throws all
 * but the subject line away. Reading the intensity out of text already in
 * memory is ZERO additional upstream requests, shares this route's cache, its
 * KV warm copy and its serve-stale window, and adds no new failure mode. A
 * second route would have doubled the load on a government host to re-read
 * bytes we had already paid for.
 *
 * WHY JTWC AND NOT AN RSMC. JTWC publishes ONE-MINUTE SUSTAINED wind, the same
 * convention as NHC, so it lands on the Saffir-Simpson thresholds in
 * config/constants.js with no conversion. Every regional centre (JMA and the
 * rest) publishes TEN-MINUTE sustained, which would need a fudge factor
 * applied to the one number the whole severity ramp is built on. GDACS's own
 * records name JTWC as their source for these basins.
 *
 * STILL A BOUNDED PARSE, NOT AN INTERPRETATION. It reads fixed-format lines
 * off a teletype product into numbers and does nothing with them. Every
 * decision — which storm this belongs to, whether the fix is fresh enough to
 * use, what category the wind implies — happens in the browser, in
 * lib/jtwc-wind.js, where it can be debugged on a phone (§4).
 * ------------------------------------------------------------------------- */

/**
 * A position line. Opens a block; the wind line under it belongs to it.
 *
 *   271800Z --- NEAR 13.2N 173.7E      ← the warning position (current fix)
 *   280600Z --- 13.3N 171.4E           ← a forecast tau
 *
 * The `---` is what makes this specific. The message header (`WTPN31 PGTW
 * 272100`) is also six digits and would otherwise match; it has no dashes and
 * no coordinates, so it drops out here rather than needing to be excluded.
 *
 * Hemispheres are read, never assumed: the Southern Hemisphere basin runs
 * `13.2S`, and longitudes cross the dateline into `179.4W`.
 */
const POSIT_RE =
  /^\s*(\d{2})(\d{2})(\d{2})Z\s*-{2,}\s*(?:NEAR\s+)?(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EW])/i;

/** `MAX SUSTAINED WINDS - 045 KT, GUSTS 055 KT`. Gusts are optional — a few
 *  products omit them and a missing gust is not a missing wind. */
const WIND_RE =
  /MAX\s+SUSTAINED\s+WINDS?\s*-\s*(\d{1,3})\s*KTS?(?:\s*,\s*GUSTS?\s*(\d{1,3})\s*KTS?)?/i;

/** `MOVEMENT PAST SIX HOURS - 280 DEGREES AT 15 KTS`. */
const MOVE_RE = /MOVEMENT\s+PAST\s+SIX\s+HOURS\s*-\s*(\d{1,3})\s*DEGREES\s+AT\s+(\d{1,3})\s*KTS?/i;

/** `MINIMUM CENTRAL PRESSURE AT 271800Z IS 997 MB.` */
const MSLP_RE = /MINIMUM\s+CENTRAL\s+PRESSURE\s+AT\s+\d{6}Z\s+IS\s+(\d{3,4})\s*MB/i;

/** `POSITION ACCURATE TO WITHIN 060 NM`. Carried through so the client can see
 *  how well located the fix it is trusting actually is. */
const ACCURACY_RE = /POSITION\s+ACCURATE\s+TO\s+WITHIN\s+(\d{1,3})\s*NM/i;

/** Nothing on a JTWC track is further out than five days. A DTG that resolves
 *  beyond this is a parse that went wrong, not a forecast, and is dropped. */
const MAX_LEAD_HOURS = 24 * 6;

/** A wind above this is not a wind. The strongest reliably measured tropical
 *  cyclone was under 200 kt, so anything past it is a misread column, and a
 *  misread column would peg the cage to full height on a storm that has no
 *  such reading (the §5 failure this whole change exists to remove). */
const MAX_PLAUSIBLE_KT = 200;

const HOUR_MS = 3600 * 1000;

/**
 * A JTWC date-time group is `DDHHMM` — DAY OF MONTH ONLY. No month, no year,
 * anywhere in the product. So the calendar has to come from somewhere, and
 * the only honest source is the clock at read time.
 *
 * THE FIX TIME resolves against `nowMs`: the same day-of-month in the previous,
 * current and next month is tried, and the one CLOSEST to now wins. That
 * handles both rollover directions — a fix issued on the 31st read just after
 * midnight on the 1st, and a fix on the 1st read from the last hours of the
 * 31st — without needing to know which one happened.
 *
 * Returns null when the day/hour are not a real time. A DTG we cannot place is
 * a position with no moment, and those are dropped, never guessed at (the same
 * rule lib/track-point.js applies to a point with no readable time).
 */
export function resolveDtg(day, hour, minute, nowMs) {
  if (!(day >= 1 && day <= 31) || hour > 23 || minute > 59) return null;
  const ref = new Date(nowMs);
  let best = null;
  for (let offset = -1; offset <= 1; offset++) {
    const t = Date.UTC(
      ref.getUTCFullYear(),
      ref.getUTCMonth() + offset,
      day,
      hour,
      minute,
      0
    );
    /* Date.UTC ROLLS OVER SILENTLY: day 31 in a 30-day month becomes the 1st
     * of the next one. That would place a fix a month and a day from where it
     * belongs, so the candidate is checked against what it came back as. */
    if (new Date(t).getUTCDate() !== day) continue;
    if (best == null || Math.abs(t - nowMs) < Math.abs(best - nowMs)) best = t;
  }
  return best;
}

/**
 * Forecast DTGs after the fix, walked FORWARD rather than resolved
 * independently.
 *
 * A tau is always later than the one before it, so a day-of-month that goes
 * DOWN is a month boundary and nothing else. Resolving each one against `now`
 * the way the fix is resolved would put a `011800Z` five days out back at the
 * start of the CURRENT month — a forecast point a month in the past, which
 * sorts into the history window and lifts the cage in the wrong place.
 */
function nextDtgAfter(day, hour, minute, prevMs) {
  if (!(day >= 1 && day <= 31) || hour > 23 || minute > 59) return null;
  const prev = new Date(prevMs);
  for (let offset = 0; offset <= 2; offset++) {
    const t = Date.UTC(
      prev.getUTCFullYear(),
      prev.getUTCMonth() + offset,
      day,
      hour,
      minute,
      0
    );
    if (new Date(t).getUTCDate() !== day) continue;
    if (t > prevMs) return t;
  }
  return null;
}

const kt = (s) => {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PLAUSIBLE_KT ? n : null;
};

/**
 * One warning's intensity content: the current fix and the forecast ladder.
 *
 * SCANNED AS BLOCKS, NOT AS ONE BIG REGEX. Each position line opens a block
 * and the FIRST wind line beneath it — before the next position line — is that
 * block's wind. A single expression spanning both would have to tolerate the
 * quadrant radii, the remarks and the vector text that sit between them, which
 * is how a parser starts matching across storms.
 *
 * The first block is the WARNING POSITION (the current analysis); every block
 * after it is a forecast tau. That ordering is the product's, not an
 * assumption: `WARNING POSITION:` always precedes `FORECASTS:`.
 *
 * @param {string} text the raw warning product
 * @param {number} nowMs read-time clock, for resolving month-less DTGs
 * @returns {{fix: object|null, forecast: object[]}}
 */
export function parseWarningIntensity(text, nowMs = Date.now()) {
  const lines = String(text || '').split(/\r?\n/);

  const blocks = [];
  let current = null;
  for (const line of lines) {
    const pm = line.match(POSIT_RE);
    if (pm) {
      current = {
        day: +pm[1],
        hour: +pm[2],
        minute: +pm[3],
        lat: (pm[5].toUpperCase() === 'S' ? -1 : 1) * parseFloat(pm[4]),
        lon: (pm[7].toUpperCase() === 'W' ? -1 : 1) * parseFloat(pm[6]),
        windKt: null,
        gustKt: null,
      };
      blocks.push(current);
      continue;
    }
    if (!current) {
      /* Lines before the first position line still carry storm-wide facts. */
      continue;
    }
    if (current.windKt == null) {
      const wm = line.match(WIND_RE);
      if (wm) {
        current.windKt = kt(wm[1]);
        current.gustKt = kt(wm[2]);
      }
    }
  }

  if (!blocks.length) return { fix: null, forecast: [] };

  /* Storm-wide fields, read from the whole product rather than from a block:
   * each appears exactly once and belongs to the current analysis. */
  const mv = text.match(MOVE_RE);
  const mslp = text.match(MSLP_RE);
  const acc = text.match(ACCURACY_RE);

  const head = blocks[0];
  const fixMs = resolveDtg(head.day, head.hour, head.minute, nowMs);
  /* A fix whose time will not resolve takes the forecast ladder with it: every
   * tau below is dated by walking forward from this one. Better nothing than a
   * ladder hung off a guessed anchor. */
  if (fixMs == null) return { fix: null, forecast: [] };

  const fix = {
    at: new Date(fixMs).toISOString(),
    lat: head.lat,
    lon: head.lon,
    windKt: head.windKt,
    gustKt: head.gustKt,
    pressureMb: mslp ? Number(mslp[1]) : null,
    headingDeg: mv ? Number(mv[1]) : null,
    speedKt: mv ? Number(mv[2]) : null,
    accuracyNm: acc ? Number(acc[1]) : null,
  };

  const forecast = [];
  let prevMs = fixMs;
  for (const b of blocks.slice(1)) {
    const t = nextDtgAfter(b.day, b.hour, b.minute, prevMs);
    if (t == null) continue;
    if ((t - fixMs) / HOUR_MS > MAX_LEAD_HOURS) continue;
    prevMs = t;
    forecast.push({
      at: new Date(t).toISOString(),
      lat: b.lat,
      lon: b.lon,
      windKt: b.windKt,
      gustKt: b.gustKt,
    });
  }

  return { fix, forecast };
}

async function getText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain,application/xml,*/*' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded-concurrency map. No dependencies, and no all-or-nothing: one dead
 *  product must not cost the other five their place in the index. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]); } catch { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/jtwc/storms/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/jtwc/storms/last-good');

  /* SPEC §17 Pass B — colo cache, then the globally warmed KV copy, then
   * upstream. The cron Worker skips the first two (functions/api/_kv-cache.js). */
  const warming = isWarmRequest(context.request, context.env);

  const hit = warming ? null : await cache.match(freshKey);
  if (hit) return hit;

  const warm = warming ? null : await kvRead(context.env, KV_PATH, FRESH_SECONDS);
  if (warm && warm.fresh) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    };
    context.waitUntil(
      cache.put(
        freshKey,
        new Response(warm.body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })
      )
    );
    return new Response(warm.body, { headers });
  }

  let upstreamError;
  try {
    const rss = await getText(RSS);

    const pubDate = (rss.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate\s*>/i) || [])[1] || null;

    const keys = [...new Set([...rss.matchAll(PRODUCT_RE)].map((m) => m[1].toLowerCase()))]
      .slice(0, MAX_PRODUCTS);

    const now = Date.now();
    const parsed = await mapLimit(keys, CONCURRENCY, async (key) => {
      const text = await getText(`${HOST}/jtwc/products/${key}web.txt`);
      const subj = parseSubject(text);
      if (!subj) return null;
      /* THE SUBJECT LINE IS STILL THE GATE. A product whose identity will not
       * parse is not in the index at any price — an intensity with no storm
       * attached to it is worse than no intensity. The reverse is fine and
       * expected: a storm whose intensity block will not parse stays in the
       * index with `fix: null`, because the name join it was built for still
       * works and the advisory-text feature must not lose a storm over a
       * field it never asked for. */
      const { fix, forecast } = parseWarningIntensity(text, now);
      /* THE FINAL-WARNING FLAG, and it is free for exactly the reason the
       * intensity block above is free: the full text is already in memory.
       * §5's ended state needs a DEFINITIVE end-of-storm signal outside the
       * NHC basins, and this line is it — nothing else GDACS or JTWC publishes
       * states an ending rather than implying one. Reading it anywhere else
       * would mean re-fetching every active warning from a government host to
       * look at one sentence we already had. */
      return { ...subj, product: key, fix, forecast, final: isFinalWarning(text) };
    });

    const storms = parsed.filter(Boolean);

    /* THREE STATES, NOT TWO (§5). `clear` is JTWC genuinely warning on
     * nothing — a quiet ocean, which happens for months at a time. `partial`
     * is products listed that would not read or would not parse, which is a
     * DEGRADED index: a storm may be missing from it and the panel must not
     * say "no warning exists" on the strength of a list that is short. The
     * client distinguishes these; a boolean could not. */
    const state = keys.length === 0
      ? 'clear'
      : storms.length < keys.length
        ? 'partial'
        : 'ok';

    const body = JSON.stringify({
      state,
      /* THE FEED'S OWN AGE, separate from ours. A JTWC RSS frozen for three
       * weeks and a JTWC RSS with no storms in it look identical downstream,
       * and only one of them means "quiet ocean". */
      pubDate: pubDate ? pubDate.trim() : null,
      fetchedAt: new Date().toISOString(),
      productsListed: keys.length,
      storms,
    });

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    };

    context.waitUntil(
      Promise.all([
        cache.put(freshKey, new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
        })),
        cache.put(lastGoodKey, new Response(body, {
          headers: { ...headers, 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
        })),
      ])
    );

    return new Response(body, { headers });
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    const body = await stale.text();
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Landfall-Stale': 'true',
      },
    });
  }

  /* Then the warm copy declined above as too old. A DEGRADED INDEX MUST NOT
   * READ AS AN EMPTY ONE (§5, and the exact mistake step 5 shipped): the
   * stored body carries its own `state` and `pubDate`, so a stale index still
   * says what it is and how old it is rather than becoming "no storms". */
  if (warm) {
    return new Response(warm.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Landfall-Fetched-At': warm.fetchedAt || '',
        'X-Landfall-Stale': 'true',
      },
    });
  }

  return json(
    { state: 'unavailable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
