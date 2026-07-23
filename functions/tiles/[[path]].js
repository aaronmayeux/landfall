/* The tile proxy (SPEC §11) — serves single basemap tiles out of the .pmtiles
 * archive in R2, with caching stamped on hard.
 *
 * WHY THIS EXISTS. The bucket's r2.dev public URL is Cloudflare's rate-limited
 * development endpoint: no real CDN cache in front, every session re-fetches
 * every byte range, and tile pop-in is visible on glass. This function turns
 * the archive into ordinary tile URLs — GET /tiles/{z}/{x}/{y}.mvt — and every
 * response carries `Cache-Control: immutable` with a one-year max-age, so a
 * tile is fetched from the bucket once per edge location and once per browser,
 * ever. Coastlines don't move; cache-forever is honest. If the archive is ever
 * regenerated, bump the URL (a `?v=` in TILES.tilesUrl) rather than trusting
 * caches to notice.
 *
 * KEPT DUMB ON PURPOSE, same philosophy as the relay (SPEC §4): read bytes,
 * forward bytes, cache. No merging, no rewriting, no logic to debug on a
 * server. The pmtiles directory walk happens through the vendored library
 * (./_pmtiles.js) against an R2 bucket binding — never through public HTTP.
 *
 * REQUIRES a Pages R2 bucket binding named TILES_BUCKET -> landfall-tiles
 * (dashboard: Pages project -> Settings -> Bindings, Production AND Preview).
 * Without the binding this function 500s with `binding_missing`, which the
 * check below names explicitly rather than letting it die as a TypeError —
 * a misconfigured dashboard must not read like a code bug (SPEC §5).
 *
 * The client half lives in config/constants.js (TILES.tilesUrl) and
 * map/style-dark.js. The object key below is the server-side twin of the
 * upload name recorded in SPEC §3.
 */

import { PMTiles } from './_pmtiles.js';

/** The archive in the landfall-tiles bucket: z0–8 world, 525 MB, built
 *  2026-07-23 by `pmtiles extract`. */
const ARCHIVE_KEY = 'landfall-z0-8.pmtiles';

/** The archive's zoom ceiling. Twin of TILES.sourceMaxzoom client-side —
 *  requests past it are 404s, not bucket reads; MapLibre overzooms client-side
 *  and never asks. */
const MAX_ZOOM = 8;

/** GET /tiles/{z}/{x}/{y}.mvt — anything else under /tiles/ is a 404. */
const TILE_PATH = /^\/tiles\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/;

/** One year, immutable. See the header comment for why this is honest. */
const CACHE_FOREVER = 'public, max-age=31536000, immutable';

/* The pmtiles library reads through a Source: getBytes(offset, length). This
 * one is an R2 ranged read on the bucket binding — the 525 MB archive is never
 * fetched whole. */
class R2Source {
  constructor(bucket) {
    this.bucket = bucket;
  }
  getKey() {
    return ARCHIVE_KEY;
  }
  async getBytes(offset, length) {
    const obj = await this.bucket.get(ARCHIVE_KEY, { range: { offset, length } });
    if (!obj) throw new Error(`archive_missing: ${ARCHIVE_KEY}`);
    return { data: await obj.arrayBuffer() };
  }
}

/* Module-scoped so the library's internal header/directory cache survives
 * across requests in a warm isolate — without this, every tile re-reads the
 * archive's directories from the bucket. */
let archive = null;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const match = TILE_PATH.exec(url.pathname);
  if (!match) return textResponse(404, 'not_found');

  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return textResponse(404, 'out_of_range');

  /* Edge cache first. Key on the bare URL so header variance can't fragment
   * the cache. */
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (!env.TILES_BUCKET) return textResponse(500, 'binding_missing');
  if (!archive) archive = new PMTiles(new R2Source(env.TILES_BUCKET));

  let tile;
  try {
    tile = await archive.getZxy(z, x, y);
  } catch (err) {
    /* A read failure is `unavailable`, never a silent empty tile (SPEC §5) —
     * 500 makes MapLibre surface a source error instead of quietly drawing
     * blank ocean over a real coastline. */
    return textResponse(500, 'tile_read_failed');
  }

  /* A genuinely empty tile (open ocean) is `clear`, and 204 says so. Only 200s
   * go to the edge cache. */
  if (!tile || !tile.data || tile.data.byteLength === 0) {
    return new Response(null, { status: 204, headers: baseHeaders() });
  }

  const response = new Response(tile.data, {
    status: 200,
    headers: { ...baseHeaders(), 'Content-Type': 'application/x-protobuf' },
  });
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function baseHeaders() {
  return {
    'Cache-Control': CACHE_FOREVER,
    /* Same-origin in production; the `*` is what lets a localhost dev server
     * fetch these tiles cross-origin (TILES.tilesUrl is absolute for the same
     * reason). The tiles are public data — there is nothing to protect. */
    'Access-Control-Allow-Origin': '*',
  };
}

function textResponse(status, code) {
  /* Codes, never prose — the client is the layer with the words (SPEC §4). */
  return new Response(code, {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
