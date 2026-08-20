/**
 * /api/imagery/radar — one RainViewer radar TILE (SPEC §4.9).
 *
 * ==> IT SERVES TILES NOW, AND THAT IS THE FIX FOR "IT LOOKS BLURRY". <==
 *
 * This route used to hand back ONE image per storm, centred on the eye, sized
 * to whatever radius the Cloud slider was asking for. That contract came from
 * SATELLITE, where the vendor is a WMS: you ask for a rectangle and you get one
 * picture, so a disc around the eye is the natural shape.
 *
 * RainViewer is not a WMS. It is a tile pyramid, and using a tile pyramid as if
 * it were a WMS throws away the only reason it is sharp. The pixel budget in one
 * image is fixed at 512, so a bigger disc is always a blurrier one — at the
 * slider's maximum that was a single 512 px image stretched across roughly
 * 4,300 km, about 8.5 km per pixel, against the 1.2 km/px RainViewer's own site
 * shows at the same zoom. Seven times coarser, and not tunable: the radius
 * slider was not a quality control, it was a quality tax.
 *
 * Served as tiles, MapLibre asks for exactly the tiles the viewport needs at the
 * zoom it is actually drawing, the same way it already does for the basemap.
 * The clarity matches RainViewer's site because it is what RainViewer's site
 * does.
 *
 * ==> EVERY TILE NAMES ITS FRAME, AND THE CLIENT CHOOSES IT. <== `?f=` carries
 * the frame path that /api/imagery/radar-frames handed out. Two consequences,
 * both load-bearing:
 *   1. Every tile in one viewport is the SAME MOMENT. Letting this route pick
 *      "the newest" per tile would let two tiles either side of a ten-minute
 *      boundary disagree, and a map showing two moments is a picture of
 *      something that never happened.
 *   2. A frame path never changes its pixels, so the answer is IMMUTABLE and
 *      can be cached for two days rather than ten minutes — which is exactly
 *      what RainViewer's terms ask for, and the best defence against the IP
 *      block they warn about.
 *
 * Self-contained for the §3 reason every route here is. Values mirrored in
 * `IMAGERY.radar`, guarded by tools/test-relay-mirrors.mjs.
 */

/** The tile host. RainViewer's index publishes it and it has never differed
 *  from this, but the index is authoritative — so `?h=` may override it, and is
 *  validated against the same suffix rule the frames route applies. */
const DEFAULT_HOST = 'https://tilecache.rainviewer.com';

/**
 * Mirrors `CACHE.radarFresh`.
 *
 * TWO DAYS, NOT TEN MINUTES, AND THAT IS A CONSEQUENCE OF `?f=` RATHER THAN A
 * SEPARATE DECISION. When the address named "the newest frame" the answer went
 * stale on the source's own cadence. Now the address names ONE frame, whose
 * pixels are fixed forever, so the only correct cache lifetime is a long one.
 * RainViewer serves these with `max-age=172800` for the same reason.
 */
const FRESH_SECONDS = 2 * 24 * 60 * 60;

/** Mirrors `IMAGERY.radar.colorScheme` / `.smooth` / `.snow`.
 *
 *  ==> SMOOTH IS 0 AND MUST STAY 0. <== Blur invents alpha outside the data.
 *  Measured: an open-Pacific tile with NO radar coverage at all came back 10 KB
 *  of muddy blended colour at `smooth=1`, against 1,096 bytes and nothing at
 *  all at `smooth=0`. A smoothed tile paints haze over ground no radar can see,
 *  which is the §5 failure this layer keeps finding new roads to. */
const COLOR_SCHEME = 2;
const SMOOTH = 0;
const SNOW = 0;

const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** RainViewer serves 256 or 512 and nothing else. 512 into a 256-slot tile is
 *  the standard retina trick — one image pixel per device pixel on a 2x screen. */
const SIZES = new Set([256, 512]);

/** Documented maximum zoom. The source declares this to MapLibre, which
 *  overzooms above it rather than asking for tiles that do not exist. */
const MAX_Z = 7;

const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

const int = (s) => (/^\d+$/.test(s) ? Number(s) : NaN);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const frame = url.searchParams.get('f') || '';
  const host = url.searchParams.get('h') || DEFAULT_HOST;
  const z = int(url.searchParams.get('z') || '');
  const x = int(url.searchParams.get('x') || '');
  const y = int(url.searchParams.get('y') || '');
  const px = int(url.searchParams.get('px') || '512');

  /* ==> STRICT INPUT, AND STRICTER THAN THE OLD ROUTE'S BECAUSE MORE OF THE
   * UPSTREAM URL NOW COMES FROM THE CALLER. <== The frame path and the host are
   * both pasted into an address this route then fetches, so both are matched
   * against an exact shape rather than merely checked for plausibility. Without
   * this, `?h=` is an open proxy. */
  if (!/^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(frame)) return fail(400, 'f must be a radar frame path');
  if (!/^https:\/\/[a-z0-9-]+\.rainviewer\.com$/.test(host)) return fail(400, 'h must be a rainviewer host');
  if (!Number.isInteger(z) || z < 0 || z > MAX_Z) return fail(400, `z must be a whole number between 0 and ${MAX_Z}`);
  /* A tile index outside the pyramid cannot exist, and forwarding it would ask
   * the upstream a question it has to answer with a 404 — a request we can
   * decline to make on a service that blocks abusive callers. */
  const span = 2 ** z;
  if (!Number.isInteger(x) || x < 0 || x >= span) return fail(400, 'x is outside the tile pyramid');
  if (!Number.isInteger(y) || y < 0 || y >= span) return fail(400, 'y is outside the tile pyramid');
  if (!SIZES.has(px)) return fail(400, 'px must be 256 or 512');

  const upstream = `${host}${frame}/${px}/${z}/${x}/${y}/${COLOR_SCHEME}/${SMOOTH}_${SNOW}.png`;

  const cache = caches.default;
  const cacheKey = new Request(upstream, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
    });
  } catch (e) {
    return fail(502, 'radar service did not respond');
  }

  if (!upstreamResponse.ok) return fail(502, `radar service returned ${upstreamResponse.status}`);

  /* Refuse to cache a non-image. A service answering a failure with a 200 and a
   * text body would otherwise put an error document where the weather should be
   * — for two days, for everybody, which is a much longer mistake than it was
   * when this cached for five minutes. */
  const type = upstreamResponse.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) return fail(502, 'radar service returned a non-image');

  const body = await upstreamResponse.arrayBuffer();
  const out = new Response(body, {
    headers: {
      'Content-Type': type,
      /* `immutable` is not decoration. It tells the browser not to revalidate
       * at all, which is the difference between a warm pan costing nothing and
       * costing thirty conditional requests. */
      'Cache-Control': `public, max-age=${FRESH_SECONDS}, immutable`,
      'Access-Control-Allow-Origin': '*',
    },
  });

  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
