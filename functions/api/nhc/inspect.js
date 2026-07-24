/**
 * /api/nhc/inspect — READ-ONLY probe into the NHC tropical MapServer.
 *
 * WHY THIS EXISTS. The cloud sandbox Andy works in cannot reach NOAA: its
 * egress proxy allowlists github.com and package registries, and everything
 * else returns 403 `host_not_allowed`. That has meant every statement about
 * the SHAPE of NHC's geometry — how many features a layer returns, what
 * fields they carry, whether a swath arrives merged or per-forecast-hour —
 * was inference from layer names and documentation. Three consecutive wrong
 * diagnoses of the wind swath's jagged edges came out of exactly that gap
 * (SPEC §15). This endpoint closes it: the deployed site CAN reach NOAA, so
 * it fetches on request and reports what actually came back.
 *
 * SAFE TO LEAVE DEPLOYED, unlike the probe scaffolding it replaces (§15,
 * which committed responses to the repo and needed a GitHub token and a
 * reminder to delete it). This one:
 *   - only ever GETs from one hardcoded NOAA host,
 *   - writes nothing, anywhere,
 *   - needs no secret,
 *   - returns metadata and truncated samples, not bulk geometry.
 * The worst it can do is make NOAA requests, which the site already makes.
 *
 * USAGE:
 *   /api/nhc/inspect                     → the service's whole layer list
 *   /api/nhc/inspect?layer=6             → summary of layer 6's features
 *   /api/nhc/inspect?layer=6&geom=1      → include coordinate counts per ring
 *   /api/nhc/inspect?layer=6&where=...   → custom filter (default 1=1)
 *
 * Deliberately NOT a general proxy: `layer` must be a plain integer and the
 * host is fixed, so this cannot be pointed at arbitrary URLs.
 */

const SERVICE =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

/** NOAA 403s requests with no User-Agent. Same identity the storms relay uses. */
const USER_AGENT = 'Landfall/1.0 (+https://landfall.getgravitate.app)';

/** How many features to describe in full. A swath layer returning three
 *  polygons is the interesting case; a hundred would be noise. */
const SAMPLE_LIMIT = 12;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });

async function getUpstream(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
  const body = await r.json();
  if (body?.error) throw new Error(body.error.message || 'ArcGIS error');
  return body;
}

/** Count coordinates in a GeoJSON geometry without dumping them all. */
function ringSummary(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', rings: geometry.coordinates.map((r) => r.length) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      parts: geometry.coordinates.length,
      rings: geometry.coordinates.map((p) => p.map((r) => r.length)),
    };
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', points: geometry.coordinates.length };
  }
  if (geometry.type === 'Point') {
    return { type: 'Point', at: geometry.coordinates };
  }
  return { type: geometry.type };
}

/**
 * Is this ring axis-aligned — i.e. rasterized? The whole wind-swath question
 * in one number. A grid trace is nothing but horizontal and vertical edges;
 * a forecaster-drawn or interpolated shape is mostly neither.
 */
function axisAlignedShare(geometry) {
  const rings = [];
  if (geometry?.type === 'Polygon') rings.push(...geometry.coordinates);
  else if (geometry?.type === 'MultiPolygon')
    for (const p of geometry.coordinates) rings.push(...p);
  else return null;

  let axis = 0;
  let total = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const dx = Math.abs(ring[i + 1][0] - ring[i][0]);
      const dy = Math.abs(ring[i + 1][1] - ring[i][1]);
      if (dx < 1e-9 && dy < 1e-9) continue;
      total++;
      if (dx < 1e-9 || dy < 1e-9) axis++;
    }
  }
  if (!total) return null;
  return { edges: total, axisAligned: axis, share: +(axis / total).toFixed(3) };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const layerParam = url.searchParams.get('layer');

  try {
    /* No layer given: return the service's layer list. This is what names the
     * blocks and confirms which id a storm's wind layers actually sit at. */
    if (layerParam == null) {
      const meta = await getUpstream(`${SERVICE}?f=json`);
      return json({
        service: SERVICE,
        layerCount: meta.layers?.length ?? 0,
        layers: (meta.layers || []).map((l) => ({
          id: l.id,
          name: l.name,
          group: Array.isArray(l.subLayerIds) && l.subLayerIds.length > 0,
        })),
      });
    }

    /* Guard: an integer id only. This is not a general-purpose proxy. */
    if (!/^\d+$/.test(layerParam)) {
      return json({ error: 'layer must be an integer' }, 400);
    }

    const where = url.searchParams.get('where') || '1=1';
    const wantGeometry = url.searchParams.get('geom') === '1';

    const params = new URLSearchParams({
      where,
      outFields: '*',
      returnGeometry: wantGeometry ? 'true' : 'false',
      outSR: '4326',
      f: 'geojson',
    });

    const fc = await getUpstream(`${SERVICE}/${layerParam}/query?${params}`);
    const features = fc.features || [];

    return json({
      layer: Number(layerParam),
      where,
      featureCount: features.length,
      /* The union of property names across all features, which is the fastest
       * way to answer "what field carries the wind threshold" and "is there a
       * timestamp on these" without reading a full dump. */
      propertyKeys: [
        ...new Set(features.flatMap((f) => Object.keys(f.properties || {}))),
      ].sort(),
      sample: features.slice(0, SAMPLE_LIMIT).map((f) => ({
        properties: f.properties,
        geometry: wantGeometry ? ringSummary(f.geometry) : undefined,
        rasterized: wantGeometry ? axisAlignedShare(f.geometry) : undefined,
      })),
      truncated: features.length > SAMPLE_LIMIT,
    });
  } catch (e) {
    return json({ error: 'inspect_failed', detail: String(e?.message || e) }, 502);
  }
}
