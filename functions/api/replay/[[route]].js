/**
 * replay/[[route]].js — the live NHC feed, except it is August 2021.
 *
 * ==> THIS IS NOT A MOCK. IT IS A RELAY POINTED AT AN ARCHIVE. <==
 *
 * It answers on exactly the routes data/nhc.js and data/nhc-mapserver.js
 * already call — `/nhc/storms` and `/nhc/mapserver?layer=&bin=` — in exactly
 * the shapes they already parse, so the app's whole data path runs unchanged:
 * the timeouts and retries in data/relay.js, the sentinel scrub, the forecast
 * normalisation, the swath construction, the merge, the caching. Nothing in
 * the app knows it is looking at Hurricane Ida. That is the point: a replay
 * that bypasses the data layer proves the drawing and nothing else.
 *
 * WHERE THE TIME COMES FROM. The route carries it — `/api/replay/<iso>/...` —
 * because the app never sends a clock and must not learn to. The replay page
 * moves that segment when its scrubber moves, and this serves the latest
 * advisory issued at or before it. Advisories the storm had not published yet
 * are not visible, which is the whole reason a replay is worth building.
 *
 * WHAT IS REAL AND WHAT IS ASSEMBLED. Every coordinate and every number here
 * is NHC's, converted from the shapefiles they published per advisory and
 * committed verbatim under samples/ida-al092021/gis/. Two slots are ASSEMBLED
 * rather than served: the past track and past wind radii are the best track
 * truncated at the replay clock, because NHC publishes no per-advisory past
 * track. That is real published data cut at a real moment, and it is named
 * here rather than left for someone to discover.
 *
 * THE ONE TRANSLATION. Shapefile attribute names arrive upper-case out of the
 * DBF (`MAXWIND`); the MapServer service the app was written against serves
 * them lower-case (`maxwind`). Keys are lower-cased and nothing else is
 * touched — no renaming, no unit conversion, no filling in of 9999 sentinels,
 * which the app scrubs itself and must go on scrubbing.
 */

const ROOT = '/samples/ida-al092021/gis';

/** SUMMARY_LAYER in data/nhc-mapserver.js, inverted. Keep them in step. */
const LAYER = {
  5: 'forecastPoints',
  6: 'forecastTrack',
  7: 'cone',
  8: 'watchWarning',
  10: 'pastPoints',
  11: 'pastTrack',
  13: 'windPast',
  15: 'windSwath',
  16: 'windCurrent',
};

/* ==> STATUS IS NOT A HEADER, AND IT SHIPPED AS ONE. <== The first cut spread
 * the caller's options into `headers`, so `fail(400, …)` set a header literally
 * named "status" and answered 200 with an error body. Every bad request — a
 * malformed clock, a bin from another basin, a layer this archive does not
 * hold — came back looking like success, and data/relay.js only inspects the
 * status. Found by tools/test-replay.mjs, which is why the two are separate
 * arguments now and cannot be confused again. */
const json = (body, headers = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      /* No store, same as every other relay route: a replay URL is stable per
         advisory and a cached copy would silently outlive the scrubber. */
      'cache-control': 'no-store',
      'x-landfall-replay': 'al092021',
      ...headers,
    },
  });

const fail = (status, why) =>
  json({ error: { code: status, message: why, replay: 'al092021' } }, {}, status);

/** Static assets, via the binding when Pages gives us one and by plain fetch
 *  when it does not. Both are the same bytes; the binding avoids a hop. */
async function asset(env, request, path) {
  const url = new URL(path, request.url);
  const res = env?.ASSETS ? await env.ASSETS.fetch(url.toString()) : await fetch(url.toString());
  if (!res.ok) return null;
  return res.json();
}

/** Lower-case every property key, recursively over a FeatureCollection's
 *  features. Values are untouched. */
function lower(fc) {
  if (!fc?.features) return fc;
  for (const f of fc.features) {
    const p = f.properties;
    if (!p) continue;
    const out = {};
    for (const k of Object.keys(p)) out[k.toLowerCase()] = p[k];
    f.properties = out;
  }
  return fc;
}

const empty = () => ({ type: 'FeatureCollection', features: [] });

/** "2021082909" -> ms. NHC's 10-digit synoptic stamp, always UTC. */
function dtgMs(v) {
  const s = String(v);
  if (!/^\d{10}$/.test(s)) return NaN;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));
}

/**
 * The CurrentStorms.json shape, for one storm, at one moment.
 *
 * Only the fields normalizeStorm() actually reads are set, and they are set
 * from the advisory's own tau-0 point rather than from anything derived.
 * `windWatchesWarnings` is present exactly when that advisory published
 * watch/warning lines, because its PRESENCE is what tells the app the storm
 * can answer for layer 8 at all — an absent key there is the difference
 * between "no watches in effect" and "we never asked".
 */
function stormList(meta, adv) {
  return {
    activeStorms: [
      {
        id: 'al092021',
        binNumber: meta.storm.binNumber,
        name: 'Ida',
        classification: adv.stormType === 'MH' ? 'HU' : adv.stormType,
        intensity: String(adv.windKt),
        pressure: String(adv.mslp),
        latitude: `${adv.lat}N`,
        longitude: `${Math.abs(adv.lon)}W`,
        latitudeNumeric: adv.lat,
        longitudeNumeric: adv.lon,
        movementDir: adv.dirDeg === 9999 ? null : adv.dirDeg,
        movementSpeed: adv.speedKt === 9999 ? null : adv.speedKt,
        lastUpdate: adv.time,
        publicAdvisory: { advNum: adv.advisnum, issuance: adv.time },
        ...(adv.files.ww ? { windWatchesWarnings: { advNum: adv.advisnum, issuance: adv.time } } : {}),
      },
    ],
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);

  /* /api/replay/<iso>/nhc/storms  or  /api/replay/<iso>/nhc/mapserver */
  const iso = decodeURIComponent(parts[0] || '');
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return fail(400, `replay needs a time segment, got "${iso}"`);
  const route = parts.slice(1).join('/');

  const meta = await asset(env, request, `${ROOT}/index.json`);
  if (!meta) return fail(503, 'replay index missing — the fixtures are not deployed');

  /* THE LATEST ADVISORY AT OR BEFORE THE CLOCK, never the nearest. A replay
     that reaches forward is not a replay. */
  const issued = meta.advisories.filter((a) => Date.parse(a.time) <= at);
  if (issued.length === 0) {
    /* Before the first advisory the storm does not exist, and that is a real
       answer rather than an error: the app should show an empty ocean. */
    if (route === 'nhc/storms') return json({ activeStorms: [] });
    return json(empty());
  }
  const adv = issued[issued.length - 1];
  const stamp = { 'x-landfall-fetched-at': adv.time, 'x-landfall-replay-advisory': adv.advisnum };

  if (route === 'nhc/storms') return json(stormList(meta, adv), stamp);

  if (route !== 'nhc/mapserver') return fail(404, `replay does not serve "${route}"`);

  const url = new URL(request.url);
  const layerId = Number(url.searchParams.get('layer'));
  const bin = String(url.searchParams.get('bin') || '').toUpperCase();
  if (bin !== meta.storm.binNumber) return fail(400, `replay has no bin "${bin}"`);
  const key = LAYER[layerId];
  if (!key) return fail(400, `replay does not serve layer ${layerId}`);

  const dir = `${ROOT}/${adv.adv}`;
  const f = adv.files;

  /* --- the four straight passthroughs ----------------------------------- */
  const direct = {
    forecastPoints: f.pts,
    forecastTrack: f.lin,
    cone: f.pgn,
    watchWarning: f.ww,
    windSwath: f.forecastRadii,
    windCurrent: f.initialRadii,
  }[key];
  if (direct !== undefined) {
    if (!direct) return json(empty(), stamp); // published nothing for this slot
    const fc = await asset(env, request, `${dir}/${direct}`);
    return fc ? json(lower(fc), stamp) : fail(503, `replay missing ${dir}/${direct}`);
  }

  /* --- the two assembled slots ------------------------------------------
   * NHC publishes no per-advisory past track, so this is the BEST TRACK cut
   * at the replay clock. Real published data, cut at a real moment; the cut
   * is the only thing this route decides. */
  if (key === 'pastPoints' || key === 'pastTrack') {
    const pts = await asset(env, request, `${ROOT}/best-track/AL092021_pts.geojson`);
    if (!pts) return fail(503, 'replay missing the best track');
    const past = pts.features.filter((x) => dtgMs(x.properties.DTG) <= at);
    if (key === 'pastPoints') return json(lower({ ...pts, features: past }), stamp);
    if (past.length < 2) return json(empty(), stamp);
    return json(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { stormnum: 9, stormtype: past[past.length - 1].properties.STORMTYPE },
            geometry: {
              type: 'LineString',
              coordinates: past.map((x) => x.geometry.coordinates),
            },
          },
        ],
      },
      stamp
    );
  }

  if (key === 'windPast') {
    const r = await asset(env, request, `${ROOT}/best-track/AL092021_radii.geojson`);
    if (!r) return json(empty(), stamp);
    return json(
      lower({ ...r, features: r.features.filter((x) => dtgMs(x.properties.SYNOPTIME) <= at) }),
      stamp
    );
  }

  return fail(500, `replay has no handler for ${key}`);
}
