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
];

/** Bin numbers are two letters and a digit (`AT2`) — the shape
 *  functions/api/nhc/advisory.js enforces. Checked here too so a malformed
 *  feed entry is skipped rather than turned into a request that 400s. */
const BIN_RE = /^[A-Z]{2}\d$/;

/** ATCF storm id, the shape functions/api/nhc/adeck.js enforces. */
const STORM_ID_RE = /^[a-z]{2}\d{6}$/;

/** JTWC product designation, the shape functions/api/jtwc/warning.js enforces. */
const PRODUCT_RE = /^[a-z]{2}\d{4}$/;

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
    }

    const bin = String((raw && raw.binNumber) || '').toUpperCase();
    if (BIN_RE.test(bin)) {
      /* The KV path mirrors the route's own cache SLOT (`MIATCP` + bin), not
       * the query parameter, so a reader building its key from the slot it
       * already computed lands on the same string. */
      out.push({
        path: `nhc/advisory/MIATCP${bin}`,
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
 * Non-cyclone events are skipped. The EVENTS4APP list is ~96% non-cyclone
 * payload (§4 audit, 2026-07-24), so warming without this filter would spend
 * the entire write budget on earthquakes and floods this app never draws.
 */
export function gdacsDerived(json) {
  const out = [];
  const feats = json && Array.isArray(json.features) ? json.features : [];
  for (const f of feats) {
    const pr = (f && f.properties) || {};
    if (String(pr.eventtype || '') !== 'TC') continue;

    const normalized = safeGeometryUrl(pr.url && pr.url.geometry);
    if (!normalized) continue;

    out.push({
      path: `gdacs/geometry/${encodeURIComponent(normalized)}`,
      route: `/api/gdacs/geometry?url=${encodeURIComponent(normalized)}`,
    });
  }
  return out;
}
