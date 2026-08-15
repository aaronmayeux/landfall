/**
 * sources.js — WHAT the cron warms, and how each key is derived.
 *
 * ===> THE WORKER FETCHES OUR OWN RELAY ROUTES, NOT THE UPSTREAM SOURCES. <===
 * This is the single most important decision in Pass B and it is worth
 * defending, because fetching NOAA directly from here looks more obvious.
 *
 * Two relay routes do not forward their upstream verbatim. `/api/jtwc/storms`
 * reads the RSS index and then every warning product to build a name lookup
 * (§4's second bounded exception), and `/api/nhc/adeck` filters a multi-megabyte
 * deck down to the five-model shortlist. If this Worker fetched upstream
 * itself, it would have to reimplement both — a second copy of the SUBJ line
 * regex and a second copy of the tech-column filter, in a runtime that renders
 * nothing, on the other side of a deploy boundary that makes drift invisible.
 * The project has been burned by exactly one duplicated regex before
 * (`parseSubject`), survived it only because a test asserts the two copies
 * agree, and wrote in that file's header that "a copy nobody checks is how the
 * two drift."
 *
 * Calling our own route means there is exactly ONE implementation of every
 * parse, living in the file that already owns it, and this Worker stays what
 * it should be: a thing that fetches URLs and stores bytes. It also means what
 * lands in KV is BYTE-IDENTICAL to what the route would have served, which is
 * the only way the reader can serve it without a second thought.
 *
 * The cost is one extra hop per feed per cycle, from a Worker to Pages, both
 * on Cloudflare. That is nothing, and it buys away an entire class of bug.
 *
 * WHAT IS DELIBERATELY NOT WARMED, so nobody "finishes" this list later:
 *  - **`/api/nhc/mapserver`** — its keys are layer ids, and a layer id is the
 *    output of §4's block math plus a resolve-by-name pass over patterns that
 *    live in `config/constants.js`. Warming it needs that arithmetic here, in
 *    a second copy, where drift points a confident cone at the wrong storm.
 *    The route's own header carries the full argument. Colo caching already
 *    took it from per-reader to per-colo, which was the part that mattered.
 *  - **`/api/imagery/radar`** — keyed by a per-storm bounding box at a chosen
 *    resolution. There is no finite set of keys to warm.
 *  - **`/api/geocode`** — driven by what a person typed. Same reason.
 *  - **the four `/inspect` routes** — diagnostics, gated (§17 A2), and warming
 *    a debugging surface spends the budget on bytes nothing renders.
 *
 * Runs in a standalone Worker, a SEPARATE DEPLOY from the Pages project, so
 * nothing here imports from the app or from functions/ (§3). The KEY SHAPES
 * below are the same strings `functions/api/*` read; tools/test-kv-keys.mjs
 * asserts the two sides agree.
 */

/** The three feeds with fixed URLs. Warmed every cycle, unconditionally —
 *  they are what everything else is derived FROM, so a cycle that fails to
 *  get these has nothing to fan out to. */
export const LIST_FEEDS = [
  { path: 'nhc/storms', route: '/api/nhc/storms' },
  { path: 'jtwc/storms', route: '/api/jtwc/storms' },
  { path: 'gdacs/events', route: '/api/gdacs/events' },
  /* TCGP's own list of which storms it files a-decks for, and the deck id for
   * each. Warmed as a LIST because two per-storm jobs fan out of it below.
   *
   * ==> IT IS ALSO THE REASON THE A-DECKS CAN BE WARMED AT ALL. <==
   * §17 refuses to warm /api/nhc/mapserver because its keys are the output of
   * block arithmetic a Worker cannot import and must not duplicate — drift
   * there points a confident cone at the wrong storm. A deck id looked like the
   * same problem and is not: TCGP PUBLISHES IT. Nothing is derived, nothing is
   * duplicated, and this reads one literal field exactly as jtwcDerived reads
   * `product`. */
  { path: 'tcgp/storms', route: '/api/tcgp/storms' },

  /* ==> THE GENESIS OUTLOOK, AND IT IS THE ONLY ENTRY HERE THAT CAN REFUSE ITS
   * OWN WRITE. <==
   *
   * WHY IT IS WARMED AT ALL. Its route holds the one piece of memory in the
   * relay that has to survive being asked in a datacentre that has never seen
   * a real answer: "did NHC have areas an hour ago". An empty outlook layer and
   * a broken outlook layer are byte-identical, so that memory is the only thing
   * separating "nothing is out there" from "we cannot see". It lived in
   * `caches.default`, which is per-colo, and MEASURED on 2026-08-11 it was cold
   * in the colo that mattered ninety minutes after the fix shipped: a false
   * all-clear went out with a 70% development area live in the Atlantic.
   * `functions/api/nhc/genesis.js` carries the full account.
   *
   * ==> AND WHY IT MUST NOT BE WRITTEN WHILE THE ROUTE IS HOLDING. <==
   * `kv.js` re-stamps `fetchedAt` on every cycle whether the bytes changed or
   * not — deliberately, and for good reasons written up there. Feed a HELD body
   * through that and the held answer restamps its own age every five minutes:
   * it never grows older, `HELD_SECONDS` never lapses, and the app can never
   * return to a true all-clear. The hold would become permanent, silently, and
   * it would look like the feature working.
   *
   * So the route states two things on the wire and this gate reads them.
   * Nothing here parses a payload — that judgement stays in the one file that
   * owns it, which is the whole argument in this file's header.
   *
   * NOT WRITING IS THE POINT, NOT A FAILURE. While upstream is empty these keys
   * simply stop being touched, their age grows on its own, and one outlook
   * cycle later the route stops honouring them. The clock IS the absence of a
   * write. `index.js` counts it as `withheld` and names the path, so a cycle
   * that holds is visible in the log rather than looking like a cycle that
   * worked. */
  {
    path: 'nhc/genesis/areas',
    route: '/api/nhc/genesis?part=areas',
    /* A genuine all-clear IS a real answer and belongs in the warm store — most
     * of the year it is the correct one. Only a held body is refused. */
    store: (h) => !h.get('X-Landfall-Held'),
    lastGood: {
      path: 'nhc/genesis/areas/last-good',
      /* This key answers exactly one question — "when did NHC last publish
       * areas" — so an empty answer must never land in it, or the memory would
       * remember having no memory. */
      store: (h) => !h.get('X-Landfall-Held') && Number(h.get('X-Landfall-Genesis-Areas')) > 0,
    },
  },

  /* ==> THE TEXT OUTLOOK, WHICH IS THE ARBITER OVER THE ONE ABOVE. <==
   * Two fixed URLs, one per basin, warmed like any other list feed. No gate:
   * a bulletin is a bulletin, and its trustworthiness is decided from the
   * issue time INSIDE it (`OUTLOOK.maxAgeMs`) rather than from anything this
   * loop could know. Warming it matters for the same reason warming genesis
   * did — the comparison has to be available in the colo the reader lands in,
   * not only in the one that happened to fetch recently. */
  { path: 'nhc/outlook/atlantic', route: '/api/nhc/outlook?basin=atlantic' },
  { path: 'nhc/outlook/epacific', route: '/api/nhc/outlook?basin=epacific' },
];

/** Bin numbers are two letters and a digit (`AT2`) — the shape
 *  functions/api/nhc/advisory.js enforces. Checked here too so a malformed
 *  feed entry is skipped rather than turned into a request that 400s. */
const BIN_RE = /^[A-Z]{2}\d$/;

/** ATCF storm id, the shape functions/api/nhc/adeck.js enforces. */
const STORM_ID_RE = /^[a-z]{2}\d{6}$/;

/** JTWC product designation, the shape functions/api/jtwc/warning.js enforces. */
const PRODUCT_RE = /^[a-z]{2}\d{4}$/;

/** TCGP deck id — basin, storm number, FOUR-digit year. The shape
 *  functions/api/tcgp/adeck.js enforces, and it is deliberately not the same
 *  as PRODUCT_RE above: JTWC spells the same storm `wp1226` and TCGP spells it
 *  `wp122026`. They differ only in the width of the year, which is exactly why
 *  both are checked here rather than one being assumed to fit the other. */
const DECK_ID_RE = /^(wp|io|sh)\d{2}\d{4}$/;

/**
 * NHC storm list → the per-storm products worth warming.
 *
 * Reads two literal fields (`id`, `binNumber`) off `activeStorms` and
 * interprets neither. This is field access, not parsing — the moment it needs
 * to know what a classification MEANS or how two feeds reconcile, it has
 * crossed into the client's job and belongs there instead.
 */
export function nhcDerived(json) {
  const out = [];
  const list = json && Array.isArray(json.activeStorms) ? json.activeStorms : [];
  for (const raw of list) {
    const id = String((raw && raw.id) || '').toLowerCase();
    if (STORM_ID_RE.test(id)) {
      out.push({
        path: `nhc/adeck/${id}`,
        route: `/api/nhc/adeck?storm=${encodeURIComponent(id)}`,
      });

      /* ==> THE SHIPS RUN, AND THE KV PATH IS NOT THE ROUTE'S QUERY. <== §47.2.
       *
       * The route takes the app's id (`ep082026`) and stores under the ATCF
       * filename's id (`EP0826`) — upper case, two-digit year — because that is
       * the slot it computes for its own cache. A reader building its key from
       * the id it already holds must land on the same string, so this mirrors
       * `shipsStormId` in functions/api/nhc/ships.js rather than reusing the
       * query parameter. A Worker cannot import a Pages Function, so it is a
       * deliberate duplicate under tools/test-kv-keys.mjs.
       *
       * WITHOUT THIS THE KV READ ALWAYS MISSED and the first reader in each
       * colo paid a NOAA round trip — up to three of them, because a run is
       * requested at three synoptic slots (§47.2). Documented safe degradation
       * while nothing drew SHIPS; not acceptable once the cone is filled with
       * it for every storm.
       *
       * `CurrentStorms.json` only ever lists al/ep/cp, all three of which SHIPS
       * covers (§47.6), so there is no basin filter here — the route answers
       * `basin_not_covered` for anything else and that answer is never warmed
       * because it can never be asked for from this list. */
      out.push({
        path: `nhc/ships/${id.slice(0, 2).toUpperCase()}${id.slice(2, 4)}${id.slice(6, 8)}`,
        route: `/api/nhc/ships?id=${encodeURIComponent(id)}`,
      });
    }

    const bin = String((raw && raw.binNumber) || '').toUpperCase();
    if (BIN_RE.test(bin)) {
      /* The KV path mirrors the route's own cache SLOT
       * (`<office>TCP<bin>`), not the query parameter, so a reader building
       * its key from the slot it already computed lands on the same string.
       *
       * ==> THE OFFICE IS NOT ALWAYS `MIA`. <== Central Pacific products are
       * issued by CPHC Honolulu and use `HFO` (measured 2026-07-28:
       * `MIATCPCP1` 404s, `HFOTCPCP1` is live). This was hardcoded to `MIA`,
       * so the cron warmed a key for a URL that does not exist while the route
       * 502'd on the same bin — the two agreed with each other and both were
       * wrong, which is the failure mode tools/test-kv-keys.mjs exists to
       * catch and could not, because it only ever tested AT and EP bins. It
       * tests a CP bin now. Kept identical to `officeFor` in
       * functions/api/nhc/advisory.js; a Worker cannot import a Pages
       * Function, so this is a deliberate duplicate under that test. */
      out.push({
        path: `nhc/advisory/${bin.startsWith('CP') ? 'HFO' : 'MIA'}TCP${bin}`,
        route: `/api/nhc/advisory?bin=${encodeURIComponent(bin)}`,
      });
    }
  }
  return out;
}

/**
 * JTWC storm index → one warning text per storm JTWC is warning on.
 *
 * `/api/jtwc/storms` already reads every one of these to build its name
 * lookup, so warming them costs the JTWC servers nothing extra — the route
 * fetched them a moment ago either way. What it buys is that a reader tapping
 * a Pacific storm gets the text from KV instead of waiting on a relay round
 * trip that then waits on the Navy.
 */
export function jtwcDerived(json) {
  const out = [];
  const storms = json && Array.isArray(json.storms) ? json.storms : [];
  for (const s of storms) {
    const product = String((s && s.product) || '').toLowerCase();
    if (!PRODUCT_RE.test(product)) continue;
    out.push({
      path: `jtwc/warning/${product}`,
      route: `/api/jtwc/warning?product=${encodeURIComponent(product)}`,
    });
  }
  return out;
}

/** The ONLY host and path the geometry route will fetch — mirroring
 *  `ALLOWED_HOST` / `ALLOWED_PATH` in functions/api/gdacs/geometry.js. */
const GDACS_HOST = 'www.gdacs.org';
const GDACS_PATH = '/gdacsapi/api/polygons/getgeometry';

/**
 * Validate and normalise a published GDACS geometry URL, or return null.
 *
 * ===> THIS IS A DELIBERATE MIRROR OF `safeUpstream()` IN
 *      functions/api/gdacs/geometry.js, AND IT HAS TO BE EXACT. <===
 * Two separate things depend on it, and they fail differently:
 *
 * 1. **The KEY.** The route keys its cache on `u.toString()` — the PARSER'S
 *    output, not the caller's input string. A `new URL()` round trip can drop
 *    a default port, re-encode a character, or add a trailing slash. Key this
 *    side on the raw string and the two spellings differ by a byte, the reader
 *    misses every entry the writer creates, and the warm loop runs forever
 *    doing nothing while every dashboard stays green.
 *
 * 2. **The FILTER.** An earlier version of this function checked the host with
 *    `startsWith('https://www.gdacs.org/')` on the raw string while the route
 *    checked `u.hostname` on the parsed URL. Those disagree on
 *    `https://www.gdacs.org:443/...` — the route accepts it, the string test
 *    rejects it — so the writer would silently skip a storm the reader was
 *    perfectly willing to serve. `tools/test-kv-keys.mjs` caught that before
 *    it shipped, which is the entire argument for writing that test.
 *
 * Parse first, then judge the parsed parts. Never judge the string.
 */
function safeGeometryUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== GDACS_HOST) return null;
  if (u.pathname !== GDACS_PATH) return null;
  return u.toString();
}

/**
 * GDACS event list → one geometry payload per tropical cyclone.
 *
 * THE PUBLISHED URL IS USED, NOT A CONSTRUCTED ONE — the same rule
 * `data/gdacs-geometry.js` follows, for the same reason: if GDACS moves the
 * endpoint, a published link keeps working while an assembled one breaks
 * silently. It also means the KV key matches the one the client's request
 * produces, because both are built from the same string GDACS handed over.
 *
 * TWO FILTERS, AND THE SECOND ONE IS NEWER THAN IT LOOKS. Non-cyclone events
 * are skipped for the reason they always were: the old EVENTS4APP list was
 * ~96% non-cyclone payload (§4 audit, 2026-07-24), and warming without that
 * test spent the write budget on earthquakes and floods this app never draws.
 * The eventtype test survives the 2026-07-26 switch to a cyclone-only list
 * because a feed changing shape must not be able to change what this warms.
 *
 * The `iscurrent` test is the one that switch made necessary. That list
 * carries roughly a year of FINISHED storms, so without it this function
 * derives a geometry key for all hundred and the cron spends every cycle
 * fetching and storing the wind fields of typhoons that dissipated last
 * autumn — a hundred writes to serve four storms. `data/gdacs.js` applies the
 * identical filter at ingest; the two must agree, because a key this warms
 * that the client never asks for is budget burned for nothing, and a storm the
 * client asks for that this skipped is a cold read during a landfall.
 */
/**
 * TCGP storm list → the two a-deck bodies worth warming per storm.
 *
 * ==> WHY BOTH VARIANTS, AND WHY THEY ARE SEPARATE KEYS. <==
 * `/api/tcgp/adeck` answers two different questions off one upstream file:
 * without `carq=1` it is model guidance (the spaghetti), with it the storm's
 * own analysed history (past bead heights). They are cached under separate keys
 * precisely so one can never answer with the other's body — a storm's past
 * served as guidance would paint history across the map as a five-day forecast.
 * Warming has to honour that split or it rebuilds the collision in KV.
 *
 * ==> WHY THIS MATTERS MORE HERE THAN FOR THE OTHER FEEDS. <==
 * `caches.default` is per-datacentre across 300+ colos, which is the whole
 * reason §17 exists. And UCAR states plainly that TCGP is NOT AN OPERATIONAL
 * SERVICE — not maintained 24/7, outages without warning. Pointing a 300x
 * fan-out at a non-operational academic host is the least defensible load in
 * the app. One global fetch per cycle instead.
 *
 * Reads one literal field (`id`) and interprets nothing, exactly like the
 * functions above it.
 */
export function tcgpDerived(json) {
  const out = [];
  const storms = json && Array.isArray(json.storms) ? json.storms : [];
  for (const s of storms) {
    const id = String((s && s.id) || '').toLowerCase();
    if (!DECK_ID_RE.test(id)) continue;
    /* The KV path mirrors the route's own `variant` segment — a reader building
     * its key from the mode it already computed lands on the same string. Kept
     * identical to functions/api/tcgp/adeck.js under tools/test-kv-keys.mjs;
     * a Worker cannot import a Pages Function, so this is a deliberate
     * duplicate and the test is what stops the two drifting. */
    out.push({
      path: `tcgp/adeck/${id}/models`,
      route: `/api/tcgp/adeck?storm=${encodeURIComponent(id)}`,
    });
    out.push({
      path: `tcgp/adeck/${id}/carq`,
      route: `/api/tcgp/adeck?storm=${encodeURIComponent(id)}&carq=1`,
    });
  }
  return out;
}

export function gdacsDerived(json) {
  const out = [];
  const feats = json && Array.isArray(json.features) ? json.features : [];
  for (const f of feats) {
    const pr = (f && f.properties) || {};
    if (String(pr.eventtype || '') !== 'TC') continue;
    if (String(pr.iscurrent || '').toLowerCase() !== 'true') continue;

    const normalized = safeGeometryUrl(pr.url && pr.url.geometry);
    if (!normalized) continue;

    out.push({
      path: `gdacs/geometry/${encodeURIComponent(normalized)}`,
      route: `/api/gdacs/geometry?url=${encodeURIComponent(normalized)}`,
    });
  }
  return out;
}
