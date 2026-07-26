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
import { parseNhcValidtime } from '../lib/time.js';
import { buildFullTrack } from '../lib/windswath.js';

/* ---------------------------------------------------------------------------
 * SERVICE METADATA — the layer list, fetched once and cached
 * ------------------------------------------------------------------------- */

let metaCache = null; // { layers: [{id, name, subLayerIds}], fetchedAt }

async function fetchMetadata() {
  const fresh =
    metaCache && Date.now() - metaCache.fetchedAt < MAPSERVER.metadataTtl;
  if (fresh) return metaCache;

  const res = await fetch(`${ENDPOINT.relay}/nhc/mapserver?meta=1`);
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

/**
 * ArcGIS reports errors as HTTP 200 with an `error` body — must be checked.
 *
 * THE WHERE CLAUSE IS NO LONGER BUILT HERE (SPEC §17 Pass B). It is built by
 * `/api/nhc/mapserver`, which takes a validated storm id or an explicit
 * unfiltered flag and constructs the query itself — the same shape as every
 * other parameterized relay route, and the reason the relay is not an
 * arbitrary query proxy into a federal ArcGIS service. This function now says
 * WHICH storm it wants and the relay decides what that means in SQL.
 *
 * `filter` says WHICH storm this layer should be narrowed to, in whichever
 * currency the layer actually keys on:
 *   `{ storm: 'al012026' }` — the four layers carrying a `stormid` column
 *   `{ bin: 'AT2' }`        — the six that key on `binnumber` instead
 *   `null`                  — the unfiltered retry below
 * The relay validates each shape and builds the clause; see its header for
 * why the split exists and why `bin` beats a bare `1=1` on those six.
 */
async function queryLayer(layerId, filter) {
  const params = new URLSearchParams({ layer: String(layerId) });
  if (filter?.storm) params.set('storm', filter.storm);
  else if (filter?.bin) params.set('bin', filter.bin);
  else params.set('all', '1');

  const res = await fetch(`${ENDPOINT.relay}/nhc/mapserver?${params}`);
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
 * Fetch one layer, narrowed to this storm by whichever column the layer has.
 * If ArcGIS rejects the clause anyway, retry once unfiltered and FLAG it — the
 * inline comment below explains why the fallback is that broad.
 *
 * THE RETRY IS NOW A GENUINE SURPRISE RATHER THAN ROUTINE. Until 2026-07-26 it
 * fired on six of nine layers on EVERY load, because the bundle sent a
 * `stormid` clause to layers that have no such column. That made the warning
 * below worthless as a signal — it was always on, so it meant nothing, and it
 * buried the real diagnostics in the console. With the clause matched to the
 * column, a rejection reaching this catch is something we have not seen before
 * and the warning is worth reading again.
 */
async function fetchLayer(layerId, filter) {
  try {
    const fc = await queryLayer(layerId, filter);
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
    const clause = filter?.storm ? `stormid=${filter.storm}` : filter?.bin ? `binnumber=${filter.bin}` : 'none';
    console.warn(
      `[landfall] layer ${layerId}: ArcGIS refused ${clause} (${e.message}); retrying unfiltered`
    );
    const fc = await queryLayer(layerId, null);
    return { fc, unfiltered: true };
  }
}

/* ---------------------------------------------------------------------------
 * PARSING — sentinel scrub, stamp extraction, forecast normalization
 * ------------------------------------------------------------------------- */

/** Stamp `_time` (epoch ms UTC, or null) on every forecast point, from
 *  `validtime` + `advdate` via the one shared parser. One parse feeds BOTH
 *  the time-label layer (which formats it device-local) and
 *  closestApproach() — they can never disagree about what time a point is. */
function annotateForecastTimes(fc, stormId) {
  for (const f of fc.features || []) {
    const p = f.properties || (f.properties = {});
    p._time = parseNhcValidtime(p.validtime, p.advdate);
    /* The owning storm, stamped explicitly. Forecast points are TAP TARGETS
     * now that the spiral glyph is gone (map/markers.js), and a target that
     * cannot say which storm it belongs to selects nothing. NHC's points
     * publish no usable storm id of their own — `stormid` is queryable but
     * not returned in feature properties — so it is put here rather than
     * inferred downstream from fields that change every advisory. */
    p._stormId = stormId;
  }
}

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
 * Time comes from `_time` when annotateForecastTimes already ran, else from
 * parsing `validtime` + `advdate` directly — the SAME parser either way
 * (lib/time.js parseNhcValidtime), so the two paths cannot disagree.
 * `validtime` is `DD/HHMM` UTC, NOT epoch ms and NOT Date.parse-able; the
 * old branches here tested exactly those two forms and both failed on every
 * real point, which is why closest approach silently degraded to
 * distance-only for its entire life (SPEC §7). A null time still degrades
 * honestly to distance-only, per §5. `datelbl` is never parsed OR rendered —
 * it is basin-local with no zone marker.
 */
export function normalizeForecast(fc) {
  const pts = (fc.features || [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      const ms = Number.isFinite(p._time) ? p._time : parseNhcValidtime(p.validtime, p.advdate);
      const time = ms != null ? new Date(ms).toISOString() : null;
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
  /* The swept envelope's past tier (§4): +10 radii and their +7 centres.
   * Raw inputs to buildFullTrack below — no map layer reads these slots
   * directly, and the at-home exposure timeline will want them later. */
  'windPast',
  'pastPoints',
];

/**
 * WHICH BUNDLE LAYERS CARRY A `stormid` COLUMN. Everything else keys on
 * `binnumber` instead, and sending it a stormid clause is invalid SQL rather
 * than a filter that matches nothing.
 *
 * MEASURED FIELD-BY-FIELD ON THE LIVE SERVICE, 2026-07-26, across both active
 * blocks (EP1/Fausto, EP2/Genevieve) — not inferred from the layer names, which
 * give no hint. Of the 26 layers in a block only four have the column, and all
 * four are wind products:
 *   +9  Past Cumulative Wind Swath   (not in the bundle — §7 forbids drawing it)
 *   +10 Past Wind Radii              → windPast
 *   +12 Forecast Wind Radii          → windSwath
 *   +13 Advisory Wind Field          → windCurrent
 *
 * The other six the bundle reads — cone, forecastTrack, forecastPoints,
 * watchWarning, pastTrack, pastPoints — do not, and every one of them was
 * rejecting the clause on every load. The console has been shouting about this
 * since the bundle was built; it read as noise because the unfiltered retry
 * papered over it and the map looked right.
 *
 * A SET, NOT A GUESS FROM THE NAME: if NOAA adds the column to a layer later,
 * this list is the one place that changes, and the six-layer split above is
 * written down as a measurement with a date on it rather than a habit.
 */
const STORMID_LAYERS = new Set(['windPast', 'windSwath', 'windCurrent']);

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

  /* LOWER case, and that is now the wire format: /api/nhc/mapserver validates
   * the ATCF shape `al012026` and upper-cases it itself inside the clause
   * (the hard-won UPPER(stormid) rule from §4 lives there now). One case
   * convention on the wire, one place that knows why the clause is shaped the
   * way it is. */
  const stormIdLower = String(storm.sourceId).toLowerCase();

  /* The bin is already proven usable — resolveLayerIds above returned ids,
   * which it only does when blockBaseFromBin parsed this string. Upper-cased
   * to match the relay's BIN_RE, the same way the storm id is lower-cased to
   * match its own. */
  const binUpper = String(storm.raw?.binNumber || '').toUpperCase();

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
        /* The clause matched to the column the layer actually has. A bin we
         * could not parse falls through to the unfiltered read rather than
         * sending a clause we know ArcGIS will refuse — same data, since the
         * layer is already this bin's, and one fewer wasted round trip. */
        const filter = STORMID_LAYERS.has(key)
          ? { storm: stormIdLower }
          : binUpper
            ? { bin: binUpper }
            : null;
        const { fc, unfiltered } = await fetchLayer(ids[key], filter);
        const clean = scrubSentinels(fc);
        if (key === 'forecastPoints') annotateForecastTimes(clean, storm.id);
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

  /* ---- THE FULL-TRACK ENVELOPE (§4: three tiers, one swath). ----
   * The windSwath slot is REPLACED with the swept envelope built from all
   * three tiers — past (+10 joined to +7), current (+13 at the FEED
   * position), forecast (+12 joined to +2 geometry). The raw +12 features
   * stay behind as the §5 solver fallback: if construction throws or
   * produces nothing while inputs existed, the slot keeps NHC's raw
   * per-tau rings — stacked and compounding, but correct. Same promise
   * either way ("full track"), so the fallback needs a console warning,
   * not a UI flag. */
  try {
    const built = buildFullTrack({
      pastRadii: layers.windPast?.status === 'ok' ? layers.windPast.fc.features : [],
      pastPoints: layers.pastPoints?.status === 'ok' ? layers.pastPoints.fc.features : [],
      currentField: layers.windCurrent?.status === 'ok' ? layers.windCurrent.fc.features : [],
      forecastRadii: layers.windSwath?.status === 'ok' ? layers.windSwath.fc.features : [],
      forecastPoints: layers.forecastPoints?.status === 'ok' ? layers.forecastPoints.fc.features : [],
      currentPos: Number.isFinite(storm.lat) && Number.isFinite(storm.lon)
        ? { lat: storm.lat, lon: storm.lon }
        : null,
    });
    if (built.length) {
      layers.windSwath = {
        status: 'ok',
        fc: { type: 'FeatureCollection', features: built },
        error: null,
        unfiltered: layers.windSwath?.unfiltered || false,
      };
    } else if (layers.windSwath?.status === 'ok') {
      console.warn(`[landfall] ${storm.id}: swath envelope built empty; drawing raw radii stack`);
    }
  } catch (e) {
    console.warn(`[landfall] ${storm.id}: swath envelope failed (${e?.message || e}); drawing raw radii stack`);
  }

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
