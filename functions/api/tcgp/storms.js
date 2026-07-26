/**
 * /api/tcgp/storms — which storms TCGP has a-decks for, and what each file is
 * called.
 *
 * ==> WHY THIS EXISTS: A DEPENDENCY THAT SHOULD NEVER HAVE BEEN THERE <==
 * The first build of global model tracks resolved a GDACS storm to a TCGP
 * filename like this:
 *
 *     GDACS "NOUL-26" → ask JTWC's LIVE WARNING FEED for a designation
 *                     → "wp1126" → widen the year → "wp112026" → fetch TCGP
 *
 * The file lives at TCGP. The identifier came from the Navy. So the moment
 * JTWC issued its final warning on a dying storm and dropped it from the
 * active feed, the id resolution returned nothing and the app NEVER ATTEMPTED
 * THE FETCH — while the deck sat there, current and readable.
 *
 * Seen on glass 2026-07-26: Noul, down to 20 kt and inland over Guangdong,
 * with a current 12Z deck on TCGP and "Model guidance unavailable" on the row.
 *
 * THE RULE THIS EARNED: ask the source that HAS the data which data it has.
 * An identifier borrowed from a third party is a second liveness condition
 * nobody wrote down — the deck is available whenever TCGP publishes it, not
 * whenever some other agency is still issuing warnings about it.
 *
 * (The near-miss version of the same lesson is already in §15: JTWC's
 * designation is what UNBLOCKED this basin, via advisory text. It was the
 * right key to discover the door with and the wrong key to leave in the lock.)
 *
 * ==> WHAT IT RETURNS <==
 *   { state, storms: [{ id, label, name, basin, lat, lon, at }], fetchedAt }
 *
 * `id` is the deck filename stem (`wp112026`) — the whole point.
 *
 * ==> POSITION IS THE JOIN KEY. THE NAME IS NOT. <==
 * The first version matched GDACS's storm name against `name` here, and it
 * broke within hours on the storm it was built for. TCGP labelled Noul
 * "TYPHOON NOUL (WP11)" in the morning and "ELEVEN (WP11)" the same evening —
 * once she decayed, the name reverted to the ATCF number-word. GDACS still
 * said NOUL-26. Nothing matched.
 *
 * A NAME IS NOT AN IDENTIFIER. It arrives after genesis, it is dropped on
 * decay, and two agencies drop it on different schedules. SPEC already carried
 * this exact warning about NHC's own layers — one system appearing as INVEST,
 * then SIX, then FAUSTO — and it was ignored twice here before the third
 * attempt took it seriously.
 *
 * So each storm now carries its LATEST ANALYSED POSITION, read from its b-deck
 * (the ATCF history file). Two agencies describing one physical storm agree on
 * where it is to within a few tens of miles whatever either calls it. `name`
 * is still published, for labels and as a tiebreak, never as the key.
 *
 * ==> STATE IS NOT A BOOLEAN, AND THAT IS §5 <==
 *   ok          — the page parsed and its storm list is trustworthy
 *   unavailable — could not reach or could not parse it
 * A caller must never read an empty `storms` on `unavailable` as "no storms
 * have decks". That is the mistake the advisory index already documents, and
 * it is the reason this route reports a state at all instead of just a list.
 *
 * ==> ONLY THE BASINS NOAA DOES NOT COVER <==
 * TCGP lists Atlantic and East Pacific storms too. They are dropped here, not
 * downstream: the app has authoritative NOAA decks for those, and a second
 * source for the same storm is a way for two answers to disagree in front of a
 * user.
 *
 * Self-contained (§3, no build step): Pages Functions cannot import the app
 * bundle, so the basin list is mirrored from `lib/adeck.js`'s TCGP_BASINS.
 */

const HOST = 'https://verif.rap.ucar.edu';
const INDEX = `${HOST}/jntweb/hurricanes-beta/realtime/current/index.php`;

/** Be identifiable in UCAR's logs, same as every other relay. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** The storm list turns over on the model cycle; 15 min is well inside one and
 *  matches the deck route so the two never disagree about what exists. */
const FRESH_SECONDS = 15 * 60;

/** Serve-stale window. A day-old list still names storms correctly — names and
 *  ids do not change — so this is deliberately generous. */
const STALE_SECONDS = 24 * 60 * 60;

/** Mirrors TCGP_BASINS in lib/adeck.js. NOAA owns al/ep/cp. */
const KEEP_BASINS = new Set(['wp', 'io', 'sh']);

/** How many b-decks to read at once. The West Pacific, North Indian and
 *  Southern Hemisphere run a handful of storms between them, so this finishes
 *  in one round without opening a dozen sockets to a research host. */
const CONCURRENCY = 4;

/** Hard ceiling on b-decks read per call, so a runaway index cannot turn one
 *  request into fifty upstream fetches. Well above any real storm count. */
const MAX_STORMS = 12;

/** A storm directory in a TCGP link: /plots/<basinFolder>/<year>/<id>/ */
const STORM_HREF = /\/plots\/[a-z]+\/\d{4}\/([a-z]{2}\d{6})\/?/i;

/** Every anchor, with its href and its inner text. */
const ANCHOR = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

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
 * `"TYPHOON NOUL (WP11)"` → `"NOUL"`.
 *
 * TCGP labels a storm as KIND NAME (DESIGNATION). The name is the last word
 * before the parenthesis — storm names are single words, and the kind can be
 * one or two ("TYPHOON", "DEPRESSION INVEST").
 *
 * Returns null when there is nothing name-shaped, which is the honest answer
 * for an unnamed invest like "INVEST 93 (WP93)". GDACS does not name those
 * either, so nothing is lost and a numeric "name" would match sloppily.
 */
function stormNameFrom(label) {
  const beforeParen = String(label || '').split('(')[0].trim();
  if (!beforeParen) return null;
  const last = beforeParen.split(/\s+/).pop();
  /* Letters only. "93" from "INVEST 93" is a number, not a name. */
  return /^[A-Za-z][A-Za-z'-]*$/.test(last) ? last.toUpperCase() : null;
}

/** Strip tags and collapse whitespace from an anchor's inner HTML. */
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Parse the current-storms page into deck identities.
 *
 * DEDUPED BY ID because the page links each storm from both the list and its
 * overview map area, and a duplicate would make a downstream uniqueness check
 * look ambiguous when it is not.
 */
export function parseTcgpIndex(html) {
  const seen = new Set();
  const storms = [];

  ANCHOR.lastIndex = 0;
  let m;
  while ((m = ANCHOR.exec(html)) !== null) {
    const href = m[1];
    const hit = STORM_HREF.exec(href);
    if (!hit) continue;

    const id = hit[1].toLowerCase();
    if (seen.has(id)) continue;
    if (!KEEP_BASINS.has(id.slice(0, 2))) continue;
    seen.add(id);

    const label = textOf(m[2]);
    storms.push({ id, label, name: stormNameFrom(label), basin: id.slice(0, 2) });
  }
  return storms;
}

/**
 * Last analysed position from a b-deck.
 *
 * A b-deck is the storm's HISTORY — one row per synoptic time, oldest first —
 * so the last parseable row is the most recent fix. Read rather than guessed:
 * columns are basin, number, DTG, tech, tau, lat, lon (tenths of a degree with
 * a hemisphere letter), exactly as the a-deck.
 *
 * @returns {{lat:number, lon:number, at:string}|null}
 */
export function lastFixFromBdeck(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parts = lines[i].split(',');
    if (parts.length < 8) continue;
    const lat = atcfDeg(parts[6]);
    const lon = atcfDeg(parts[7]);
    if (lat === null || lon === null) continue;
    return { lat, lon, at: parts[2].trim() };
  }
  return null;
}

/** `'251N'` → 25.1, `'1142E'` → 114.2, `'920W'` → -92.0. Null on anything
 *  malformed — a junk row must not place a storm in the wrong ocean. */
function atcfDeg(token) {
  const t = String(token ?? '').trim();
  if (t.length < 2) return null;
  const hemi = t[t.length - 1].toUpperCase();
  if (!'NSEW'.includes(hemi)) return null;
  const v = Number(t.slice(0, -1));
  if (!Number.isFinite(v)) return null;
  const deg = v / 10;
  return hemi === 'W' || hemi === 'S' ? -deg : deg;
}

/**
 * Attach each storm's latest position, in place.
 *
 * FAILS SOFT, PER STORM. A b-deck that will not load leaves that one entry
 * without coordinates rather than failing the whole index — one unreadable
 * storm must not cost every other storm its guidance. The client treats a
 * position-less entry as unmatchable, which is honest: we cannot confirm it is
 * the storm being asked about.
 *
 * The b-deck path is derived from the same link the id came from, so it cannot
 * drift from it.
 */
async function addPositions(storms, html) {
  const folderFor = new Map();
  ANCHOR.lastIndex = 0;
  let m;
  while ((m = ANCHOR.exec(html)) !== null) {
    const hit = /\/plots\/([a-z]+)\/(\d{4})\/([a-z]{2}\d{6})\/?/i.exec(m[1]);
    if (hit) folderFor.set(hit[3].toLowerCase(), { folder: hit[1], year: hit[2] });
  }

  const queue = [...storms];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const s = queue.shift();
        const where = folderFor.get(s.id);
        if (!where) continue;
        try {
          const url = `${HOST}/jntweb/hurricanes-beta/realtime/plots/`
            + `${where.folder}/${where.year}/${s.id}/b${s.id}.dat`;
          const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
          if (!r.ok) continue;
          const fix = lastFixFromBdeck(await r.text());
          if (fix) Object.assign(s, fix);
        } catch {
          /* Soft per storm — see the note above. */
        }
      }
    }
  );
  await Promise.all(workers);
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const freshKey = new Request('https://landfall-relay.internal/tcgp/storms/fresh');
  const lastGoodKey = new Request('https://landfall-relay.internal/tcgp/storms/last-good');

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  try {
    const r = await fetch(INDEX, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    const html = await r.text();

    /* Refuse to trust a page that is not the storm index. UCAR serving an
     * outage page would otherwise parse to zero storms and cache as "nothing
     * has a deck" — §5's silence-on-failure, and precisely the shape that let
     * a wildfire season hide a typhoon. The page names its own basins; if
     * none of them are here it is not the page we asked for. */
    if (!/Northwest Pacific/i.test(html)) {
      throw new Error('upstream body is not the current-storms index');
    }

    const storms = parseTcgpIndex(html).slice(0, MAX_STORMS);
    await addPositions(storms, html);

    const body = {
      state: 'ok',
      storms,
      fetchedAt: new Date().toISOString(),
    };

    /* An EMPTY list is a legitimate answer here and is NOT an error: a quiet
     * off-season really does have no West Pacific storms. The guard above is
     * what separates that from a broken page, which is why it checks the
     * page's own structure rather than the storm count. */
    const res = json(body, 200, { 'Cache-Control': `s-maxage=${FRESH_SECONDS}` });
    context.waitUntil(Promise.all([
      cache.put(freshKey, res.clone()),
      cache.put(lastGoodKey, json(body, 200, { 'Cache-Control': `s-maxage=${STALE_SECONDS}` })),
    ]));
    return res;
  } catch (e) {
    const stale = await cache.match(lastGoodKey);
    if (stale) {
      const prev = await stale.json();
      return json({ ...prev, state: 'ok', stale: true });
    }
    /* No cached copy and upstream down. `unavailable` with an EMPTY list, and
     * the caller is required to branch on the state — an empty list read as
     * fact here would silently mean "no storm anywhere has model guidance". */
    return json(
      { state: 'unavailable', storms: [], detail: String(e?.message || e) },
      502
    );
  }
}
