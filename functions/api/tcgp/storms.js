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
 *   { state, storms: [{ id, label, name, basin }], fetchedAt }
 *
 * `id` is the deck filename stem (`wp112026`) — the whole point. `name` is the
 * storm name alone (`NOUL`), which is what GDACS's `eventname` reduces to.
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

    const storms = parseTcgpIndex(html);
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
