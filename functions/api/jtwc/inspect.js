/**
 * /api/jtwc/inspect — READ-ONLY probe into the Joint Typhoon Warning Center.
 *
 * WHY THIS EXISTS. Same reason as its NHC and GDACS siblings: the cloud
 * sandbox cannot reach anything but GitHub and the package registries, so
 * every claim about an upstream's SHAPE has to come from the deployed site
 * or it is inference. The two rules this serves are §14's "half-built means
 * the gap is STATED" and the standing one against writing a parser from
 * recollection.
 *
 * WHAT IT IS FOR, specifically. Phase 6 step 6 renders advisory text, and
 * GDACS — which is the app's only source outside the NHC basins — publishes
 * NONE. That was checked properly on 2026-07-25, four places, before this
 * file existed:
 *   - `geteventlist/EVENTS4APP`: `description` is "Tropical Cyclone
 *     FAUSTO-26" and `htmldescription` is a one-line severity blurb. Nothing
 *     else carries prose.
 *   - `geteventdata`: full property list read. No bulletin, advisory, or
 *     narrative field at any nesting level.
 *   - `documents` and `additionalinfos`: BOTH EMPTY OBJECTS. These are the
 *     two fields that would have carried it.
 *   - `report.aspx`: eight section headings, all tables of numbers, links,
 *     and impact figures. No prose.
 * The one text-adjacent field, `cyclonesurge[].data[].bulletinid`, is a surge
 * model run id, not words.
 *
 * BUT GDACS NAMES ITS SOURCE, and for NOUL-26 that source reads `"JTWC"` —
 * which does publish text warnings. So the text exists; GDACS simply does not
 * relay it. That is the same shape as the model-guidance gap in §15, and it
 * had the same apparent blocker: mapping a GDACS event to a JTWC storm.
 * `sourceid`, the field that would have carried the designation, is an EMPTY
 * STRING.
 *
 * THE WAY THROUGH IS THE NAME, and this endpoint is how that gets confirmed
 * rather than assumed. JTWC's RSS lists every active storm as designation
 * plus name — "Typhoon 11W (Noul)" — and GDACS's `eventname` is "NOUL-26".
 * Strip the year suffix and the two match. No id needed from either side.
 *
 * SAFE TO LEAVE DEPLOYED. It:
 *   - only ever GETs from one hardcoded navy.mil host,
 *   - writes nothing, anywhere,
 *   - needs no secret,
 *   - returns metadata and truncated samples.
 *
 * USAGE:
 *   /api/jtwc/inspect                → the RSS: raw shape + every active storm
 *   /api/jtwc/inspect?product=wp1126 → that warning's RAW bytes, described
 *   /api/jtwc/inspect?product=...&full=1 → the whole product, untruncated
 *
 * Deliberately NOT a general proxy: the host is fixed and `product` must
 * match a strict basin+number+year pattern.
 */

import { guardInspect } from '../_inspect-guard.js';

const HOST = 'https://www.metoc.navy.mil';
const RSS = `${HOST}/jtwc/rss/jtwc.rss`;

/** Be identifiable in the Navy's logs, same as the other two relays. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** Warning products are `{basin}{nn}{yy}web.txt` — `wp1126web.txt`. Two
 *  letters, four digits, nothing else. This is the whole guard against the
 *  endpoint becoming a general fetcher. */
const PRODUCT_RE = /^[a-z]{2}\d{4}$/;

/** Truncation point for a described product. A JTWC warning runs a few KB;
 *  enough to see the header, the first forecast block, and how it ends. */
const SAMPLE_CHARS = 1200;

const TIMEOUT_MS = 20000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });

/** GET with a timeout, returning status as DATA rather than throwing — a 404
 *  on a candidate URL is a finding, not an error. */
async function timedGet(url, accept) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: ctl.signal,
    });
    const body = await r.text();
    return {
      ok: r.ok,
      status: r.status,
      contentType: r.headers.get('Content-Type'),
      /* Does the upstream allow a direct browser fetch, or must this go
       * through a relay like every other source? Answer it by MEASUREMENT —
       * "probably no CORS header" is how a whole afternoon gets spent. */
      accessControlAllowOrigin: r.headers.get('Access-Control-Allow-Origin'),
      ms: Date.now() - t0,
      body,
    };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WHAT THE FEED ACTUALLY IS — measured 2026-07-25, after the first version of
 * this function got it wrong. There is ONE ITEM PER REGION, not one per
 * storm: "Current Northwest Pacific/North Indian Ocean* Tropical Systems"
 * carries every WP and IO storm at once. So the titles hold no storm names,
 * and the first parse returned three regions with `designation: null` for
 * each while happily listing their product URLs.
 *
 * The names live in the DESCRIPTION markup. This reports that markup as
 * structure — the anchors with their text, and the description flattened to
 * readable prose — so the pairing of name to product URL is read rather than
 * assumed. That pairing is the whole point: GDACS gives a name ("NOUL-26")
 * and no designation, JTWC's product URL encodes a designation ("wp1126")
 * and no name, and the description is the only place the two meet.
 */
function stripTags(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml) {
  const items = [];
  for (const item of xml.matchAll(/<item\b[\s\S]*?<\/item\s*>/gi)) {
    const block = item[0];
    const title = stripTags((block.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i) || [])[1] || '');
    const rawDesc = (block.match(/<description\b[^>]*>([\s\S]*?)<\/description\s*>/i) || [])[1] || '';
    /* CDATA first: the description is escaped or wrapped markup, and the
     * anchors are invisible until it is unwrapped. */
    const desc = rawDesc
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, '&');

    /* THE PAIRING, if it exists: each anchor's href beside its visible text.
     * If a storm's name is the link text on its own warning URL, the mapping
     * is one regex and no index route is needed. */
    const anchors = [...desc.matchAll(/<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a\s*>/gi)]
      .map((m) => ({ href: m[1], text: stripTags(m[2]) }));

    const products = [
      ...new Set([...block.matchAll(/https?:\/\/[^\s"'<>]+?\.txt/gi)].map((m) => m[0])),
    ];

    items.push({
      title,
      anchors,
      products,
      /* The flattened description, capped. If the names are plain text
       * rather than link text, this is where they show up. */
      descriptionText: stripTags(desc).slice(0, 600),
    });
  }
  return items;
}

/* SPEC §17 A2 — this route is gated. Read the guard's header for why it is
 * locked rather than deleted, and why the refusal is a 404. */
export async function onRequestGet(context) {
  /* THE GATE COMES FIRST — before parsing parameters and before any
   * upstream fetch, so an unauthorised caller never causes an outbound
   * request to NOAA or GDACS. That is the whole point (§17 A2). */
  const denied = guardInspect(context);
  if (denied) return denied;

  const url = new URL(context.request.url);
  const product = url.searchParams.get('product');

  try {
    /* --- one warning product, raw --------------------------------------- */
    if (product != null) {
      const key = String(product).toLowerCase();
      if (!PRODUCT_RE.test(key)) {
        return json({ error: 'product must look like wp1126 — two letters, four digits' }, 400);
      }
      const target = `${HOST}/jtwc/products/${key}web.txt`;
      const r = await timedGet(target, 'text/plain');
      if (r.body == null) {
        return json({ target, ...r, body: undefined, fetchFailed: true }, 502);
      }
      const full = url.searchParams.get('full') === '1';
      return json({
        target,
        status: r.status,
        contentType: r.contentType,
        accessControlAllowOrigin: r.accessControlAllowOrigin,
        ms: r.ms,
        bytes: r.body.length,
        /* Is this genuinely plain text, or HTML wearing a .txt extension?
         * The NHC product's `.shtml` wrapper is exactly why this is asked
         * rather than assumed. */
        looksLikeHtml: /<\s*(html|head|body|pre)\b/i.test(r.body),
        lineCount: r.body.split('\n').length,
        text: full ? r.body : r.body.slice(0, SAMPLE_CHARS),
        truncated: !full && r.body.length > SAMPLE_CHARS,
      });
    }

    /* --- the RSS: raw shape, then what parses out of it ------------------ */
    const r = await timedGet(RSS, 'application/rss+xml,application/xml,text/xml');
    if (r.body == null) {
      return json({ target: RSS, ...r, body: undefined, fetchFailed: true }, 502);
    }

    const pubDate = (r.body.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate\s*>/i) || [])[1] || null;
    const items = parseRss(r.body);

    return json({
      target: RSS,
      status: r.status,
      contentType: r.contentType,
      accessControlAllowOrigin: r.accessControlAllowOrigin,
      ms: r.ms,
      bytes: r.body.length,
      /* THE FEED'S OWN AGE, reported separately from ours. A JTWC RSS that
       * has not moved in three weeks and a JTWC RSS with no storms in it
       * look identical downstream, and only one of them is `clear` (§5). */
      pubDate: pubDate ? pubDate.trim() : null,
      itemCount: items.length,
      items,
      /* The whole feed, on request. ~5.6 KB. */
      raw: url.searchParams.get('raw') === '1' ? r.body : undefined,
    });
  } catch (e) {
    return json({ error: 'inspect_failed', detail: String(e?.message || e) }, 502);
  }
}
