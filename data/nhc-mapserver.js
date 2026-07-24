/**
 * nhc-mapserver.js — per-storm geometry from the NHC tropical MapServer.
 *
 * Owns the fiddliest math in the project: each storm slot owns a block of 26
 * layers; block starts AT=4, EP=134, CP=264; the feed's `binNumber` ("AT2")
 * gives the slot directly — base = blockStart + (slot−1) × 26. All confirmed
 * live 2026-07-23 (SPEC §4).
 *
 * WITHIN the block, Phase 4 layers are resolved BY NAME from the service's
 * own layer list (`MapServer?f=json`, cached MAPSERVER.metadataTtl), because
 * only two numeric offsets were ever confirmed and none of them are the six
 * layers this file fetches. See the reasoning at MAPSERVER.layerName.
 *
 * GEOMETRY IDENTITY IS THE GEOMETRY'S OWN, never the feed's (SPEC §4 —
 * confirmed lag of 3¾–6¾ h on live storms). `advisnum` where present
 * (cone / forecast track / forecast points / watch-warning), `idp_filedate`
 * everywhere. The bundle carries that stamp and the UI displays IT.
 *
 * 9999 IS A NULL SENTINEL, NOT DATA (SPEC §7, confirmed live). Scrubbed here
 * and only here — the storm feed never uses it and data/nhc.js deliberately
 * does not handle it.
 *
 * No DOM, ever. Imports: config/ only.
 */

import { ENDPOINT, MAPSERVER, GEOMETRY_LAG_THRESHOLD } from '../config/constants.js';

/* ---------------------------------------------------------------------------
 * SERVICE METADATA — the layer list, fetched once and cached
 * ------------------------------------------------------------------------- */

let metaCache = null; // { layers: [{id, name, subLayerIds}], fetchedAt }

async function fetchMetadata() {
  const fresh =
    metaCache && Date.now() - metaCache.fetchedAt < MAPSERVER.metadataTtl;
  if (fresh) return metaCache;

  const res = await fetch(`${ENDPOINT.nhcMapServer}?f=json`);
  if (!res.ok) throw new Error(`mapserver metadata HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`mapserver metadata: ${json.error.message || 'error'}`);
  if (!Array.isArray(json?.layers)) throw new Error('mapserver metadata: no layer list');

  metaCache = { layers: json.layers, fetchedAt: Date.now() };
  return metaCache;
}

/* ---------------------------------------------------------------------------
 * BLOCK MATH + NAME RESOLUTION
 * ------------------------------------------------------------------------- */

/** "AT2" → the block's first layer id, or null when the bin is unusable. */
export function blockBaseFromBin(binNumber) {
  const m = /^([A-Z]{2})(\d+)$/.exec(String(binNumber || '').toUpperCase());
  if (!m) return null;
  const start = MAPSERVER.blockStart[m[1]];
  const slot = parseInt(m[2], 10);
  if (start == null || !(slot >= 1)) return null;
  return start + (slot - 1) * MAPSERVER.slotStride;
}

/**
 * Resolve the Phase 4 layer ids for one storm's block.
 * Only LEAF layers qualify — ArcGIS group layers carry subLayerIds and
 * cannot be queried. Returns { cone, forecastTrack, ... } with null for any
 * layer the block genuinely does not name (that is `none`, not an error).
 */
export function resolveLayerIds(binNumber, metadataLayers) {
  const base = blockBaseFromBin(binNumber);
  if (base == null) return null;

  const inBlock = metadataLayers.filter(
    (l) =>
      l.id >= base &&
      l.id < base + MAPSERVER.slotStride &&
      !(Array.isArray(l.subLayerIds) && l.subLayerIds.length)
  );

  const ids = {};
  for (const [key, pattern] of Object.entries(MAPSERVER.layerName)) {
    /* The patterns are anchored on the service's real layer names (confirmed
     * 2026-07-24), so each should match EXACTLY ONE leaf in a block. The old
     * loose patterns needed per-key exclusion guards bolted on here; those
     * are gone because the patterns no longer overlap.
     *
     * A multi-match is now treated as a fault rather than resolved by match
     * order. Match order is what silently pointed the forecast swath at
     * "Past Cumulative Wind Swath" for a day — a wrong-but-plausible layer
     * draws a confident, completely incorrect shape, and nothing about it
     * looks broken (§5). Loud beats plausible. */
    const hits = inBlock.filter((l) => pattern.test(l.name));
    if (hits.length > 1) {
      console.warn(
        `[landfall] layer '${key}' matched ${hits.length} layers in block ` +
          `(${hits.map((h) => `${h.id}:${h.name}`).join(', ')}); refusing to guess`
      );
      ids[key] = null;
      continue;
    }
    ids[key] = hits.length === 1 ? hits[0].id : null;
  }

  /* Belt and braces: the two wind segments must never resolve to the same
   * layer. Two segments drawing identical geometry is worse than one honest
   * gap — the user toggles and sees no change, which reads as a broken
   * control rather than missing data (§5). */
  if (ids.windCurrent != null && ids.windCurrent === ids.windSwath) {
    console.warn(
      `[landfall] wind field: both segments resolved to layer ${ids.windCurrent}; ` +
        'treating the swath as unavailable rather than drawing it twice'
    );
    ids.windSwath = null;
  }

  return ids;
}

/* ---------------------------------------------------------------------------
 * PER-LAYER QUERY
 * ------------------------------------------------------------------------- */

/** ArcGIS reports errors as HTTP 200 with an `error` body — must be checked. */
async function queryLayer(layerId, where) {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  const res = await fetch(`${ENDPOINT.nhcMapServer}/${layerId}/query?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) {
    const err = new Error(json.error.message || 'query error');
    err.arcgis = json.error;
    throw err;
  }
  if (json?.type !== 'FeatureCollection') throw new Error('not a FeatureCollection');
  return json;
}

/**
 * Fetch one layer, filtered to this storm. Some layers store stormid
 * LOWERCASE, so the filter is UPPER(stormid)=... (hard-won, SPEC §4). If
 * ArcGIS rejects the clause for any reason, retry once unfiltered and FLAG
 * it — the inline comment below explains why the fallback is that broad.
 */
async function fetchLayer(layerId, stormIdUpper) {
  try {
    const fc = await queryLayer(layerId, `UPPER(stormid)='${stormIdUpper}'`);
    return { fc, unfiltered: false };
  } catch (e) {
    /* Fall back to unfiltered on ANY ArcGIS-reported error, not just ones
     * that name the field: ArcGIS's stock rejection is the generic "Unable
     * to complete operation." with no mention of WHY, so sniffing the
     * message for "field" silently killed every layer whose clause was
     * refused. Network/HTTP errors still rethrow — 1=1 won't fix a dead
     * connection. The slot itself is derived from the CURRENT feed's
     * binNumber and the bundle carries its own advisory stamp, so an
     * unfiltered read of the right block is this storm's data; `unfiltered`
     * stays flagged regardless. */
    if (!e.arcgis) throw e;
    console.warn(
      `[landfall] layer ${layerId}: stormid filter rejected (${e.message}); retrying unfiltered`
    );
    const fc = await queryLayer(layerId, '1=1');
    return { fc, unfiltered: true };
  }
}

/* ---------------------------------------------------------------------------
 * PARSING — sentinel scrub, stamp extraction, forecast normalization
 * ------------------------------------------------------------------------- */

/** Map every 9999-valued numeric property to null, in place on a copy. */
function scrubSentinels(fc) {
  return {
    ...fc,
    features: (fc.features || []).map((f) => {
      const props = {};
      for (const [k, v] of Object.entries(f.properties || {})) {
        props[k] = v === MAPSERVER.nullSentinel ? null : v;
      }
      return { ...f, properties: props };
    }),
  };
}

/** The geometry's OWN advisory identity, off feature properties (the layer
 *  endpoints carry no timeInfo — confirmed). Two paths required: `advisnum`
 *  is ABSENT on past track; `idp_filedate` (epoch ms) is on every layer. */
function stampFrom(fc) {
  for (const f of fc.features || []) {
    const p = f.properties || {};
    const advisnum = p.advisnum != null ? String(p.advisnum) : null;
    const filedate = Number.isFinite(p.idp_filedate) ? p.idp_filedate : null;
    if (advisnum || filedate) return { advisnum, filedate };
  }
  return { advisnum: null, filedate: null };
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/**
 * Forecast point features → the shape closestApproach() was written against:
 * [{lon, lat, time, windKt}], ordered by forecast hour (`tau`).
 *
 * Time comes from `validtime` when it parses (ArcGIS date fields arrive as
 * epoch ms in GeoJSON properties); otherwise null. A null time degrades the
 * closest-approach readout to distance-only — honest, per SPEC §5. `datelbl`
 * is NOT parsed here; it is a pre-formatted display string that the label
 * layer shows verbatim.
 */
export function normalizeForecast(fc) {
  const pts = (fc.features || [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      let time = null;
      if (Number.isFinite(p.validtime)) time = new Date(p.validtime).toISOString();
      else if (typeof p.validtime === 'string' && isFinite(Date.parse(p.validtime))) {
        time = new Date(Date.parse(p.validtime)).toISOString();
      }
      return {
        lon: num(lon),
        lat: num(lat),
        time,
        windKt: num(p.maxwind),
        tau: num(p.tau),
      };
    })
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
    .sort((a, b) => (a.tau ?? Infinity) - (b.tau ?? Infinity));
  return pts;
}

/* ---------------------------------------------------------------------------
 * THE BUNDLE
 * ------------------------------------------------------------------------- */

/* Every layer the bundle carries. Renamed from PHASE4_LAYERS when the wind
 * pair landed — a list called "phase 4" holding phase 6 layers is the kind of
 * stale name that misleads the next reader. Fetched in parallel, each an
 * independent slot. */
const BUNDLE_LAYERS = [
  'cone',
  'forecastTrack',
  'forecastPoints',
  'pastTrack',
  'watchWarning',
  'windCurrent',
  'windSwath',
];

/**
 * Fetch everything selection needs for one storm, in parallel, each layer an
 * independent slot — one failing must not blank the others (SPEC §5).
 *
 * @returns {Promise<{
 *   layers: Record<string, {status: 'ok'|'unavailable'|'none', fc, error, unfiltered}>,
 *   forecast: Array, stamp: {advisnum, filedate}, fetchedAt: string
 * }>}
 * Throws only when NOTHING could be resolved (no metadata / no usable bin) —
 * that is a bundle-level failure the caller shows as one error.
 */
export async function fetchStormGeometry(storm) {
  if (storm.source !== 'nhc') throw new Error('geometry: NHC storms only');

  const meta = await fetchMetadata();
  const ids = resolveLayerIds(storm.raw?.binNumber, meta.layers);
  if (!ids) throw new Error(`geometry: unusable binNumber "${storm.raw?.binNumber}"`);

  const stormIdUpper = String(storm.sourceId).toUpperCase();
  const layers = {};

  await Promise.all(
    BUNDLE_LAYERS.map(async (key) => {
      /* The `can` block distinguishes "this source never had it" from "the
       * fetch died" — a storm with no watches in effect gets `none`, never a
       * fake error row (SPEC §4). */
      if (key === 'watchWarning' && storm.can && !storm.can.watchWarning) {
        layers[key] = { status: 'none', fc: null, error: null, unfiltered: false };
        return;
      }
      if (ids[key] == null) {
        layers[key] = { status: 'unavailable', fc: null, error: 'layer not found in block', unfiltered: false };
        return;
      }
      try {
        const { fc, unfiltered } = await fetchLayer(ids[key], stormIdUpper);
        const clean = scrubSentinels(fc);
        layers[key] = {
          status: clean.features.length ? 'ok' : 'none',
          fc: clean,
          error: null,
          unfiltered,
        };
      } catch (e) {
        /* Named on the console because the panel only says WHICH layers died,
         * not why — this is the debuggable-on-a-phone-plugged-into-a-laptop
         * seam the client-side merge decision (§4) exists for. */
        console.warn(`[landfall] geometry layer '${key}' (id ${ids[key]}) failed:`, e?.message || e);
        layers[key] = { status: 'unavailable', fc: null, error: e?.message || 'failed', unfiltered: false };
      }
    })
  );

  /* Stamp preference order mirrors data quality: cone and forecast track are
   * the advisory-stamped layers users actually see. */
  const stampSource =
    [layers.cone, layers.forecastTrack, layers.forecastPoints, layers.watchWarning, layers.pastTrack]
      .find((l) => l?.status === 'ok');
  const stamp = stampSource ? stampFrom(stampSource.fc) : { advisnum: null, filedate: null };

  const forecast =
    layers.forecastPoints?.status === 'ok' ? normalizeForecast(layers.forecastPoints.fc) : [];

  return { layers, forecast, stamp, fetchedAt: new Date().toISOString() };
}

/**
 * Does the geometry lag the storm feed by more than one advisory cycle?
 * (SPEC §4/§16 — when they agree, the detail panel's second line does not
 * exist; silence means synchronized.) Time-based on purpose: advisory numbers
 * like "16A" vs "017" cannot be reliably counted in cycles, but
 * GEOMETRY_LAG_THRESHOLD (= one full advisory cadence) can be measured.
 */
export function geometryLagged(stormObservedAt, stamp) {
  if (!stamp?.filedate || !stormObservedAt) return false;
  const feed = Date.parse(stormObservedAt);
  if (!isFinite(feed)) return false;
  return feed - stamp.filedate > GEOMETRY_LAG_THRESHOLD;
}
