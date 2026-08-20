/**
 * /api/imagery/radar-frames — which radar frames exist right now (SPEC §4.9).
 *
 * ==> THE CLIENT HAS TO KNOW THE FRAME BEFORE IT CAN ASK FOR A TILE, AND THAT
 * IS THE WHOLE REASON THIS ROUTE EXISTS. <==
 *
 * RainViewer's tile paths carry a hash that rolls every ten minutes. There is
 * no "latest" address. So something has to read the index, and there are only
 * two places it can happen:
 *
 *   - Inside the tile route, once per tile. Thirty tiles fill a viewport, so
 *     that is thirty index lookups for one picture — and worse, two tiles either
 *     side of a ten-minute boundary would come back from DIFFERENT frames and
 *     the map would show a seam of two different minutes.
 *   - Here, once, with the answer handed to the client, which then names the
 *     same frame in all thirty tile URLs.
 *
 * The second is both cheaper and the only one that is correct. **A viewport
 * showing two moments is a picture of something that never happened.**
 *
 * It also makes every tile IMMUTABLE — a frame path never changes its pixels —
 * which is what lets the tile route cache for two days instead of ten minutes,
 * and is what RainViewer's terms ask for.
 *
 * Self-contained for the §3 reason every route here is.
 */

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';

/** Mirrors `CACHE.radarFramesFresh`. Short, because this is the thing that
 *  DISCOVERS a new frame — but not zero, so a dozen tabs opening at once share
 *  one lookup. The tiles it points at are cached for two days. */
const FRESH_SECONDS = 60;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(context.request.url).origin + '/api/imagery/radar-frames', { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(INDEX_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  } catch (e) {
    return fail(502, 'radar frame list did not respond');
  }
  if (!upstream.ok) return fail(502, `radar frame list returned ${upstream.status}`);

  let json;
  try {
    json = await upstream.json();
  } catch (e) {
    return fail(502, 'radar frame list was not JSON');
  }

  const host = json && typeof json.host === 'string' ? json.host : '';
  const past = json && json.radar && Array.isArray(json.radar.past) ? json.radar.past : [];
  const newest = past.length ? past[past.length - 1] : null;

  /* ==> `radar.nowcast` IS DELIBERATELY NOT READ. <== It is a forecast of where
   * rain WILL be, and this layer's entire job is where rain IS. Drawing a
   * prediction under a label that says "radar" is a §5 confidently-wrong
   * answer, not a bonus feature. */
  if (!host || !newest || typeof newest.path !== 'string' || !Number.isFinite(newest.time)) {
    return fail(502, 'radar frame list had no usable frame');
  }
  /* The path is about to be handed to a client that will hand it back to the
   * tile route, which pastes it into a URL. Validate at BOTH ends — this end
   * catches an upstream change, the other end catches a caller. */
  if (!/^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(newest.path)) {
    return fail(502, 'radar frame list named an unexpected path');
  }

  /* Rebuilt rather than forwarded: the source sends `Cache-Control: no-cache`,
   * and storing that would mean this never caches at all (`SPEC-OPS.md` §17.7).
   * Only the fields the client uses are carried — a relay that forwards a
   * vendor's whole document invites the client to start reading fields nobody
   * has checked. */
  const out = new Response(
    JSON.stringify({ frame: newest.path, time: newest.time, host }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${FRESH_SECONDS}`,
        'Access-Control-Allow-Origin': '*',
      },
    },
  );

  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
