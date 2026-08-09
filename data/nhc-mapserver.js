/**
 * nhc-mapserver.js — per-storm geometry from NHC's tropical MapServer.
 *
 * ===> THIS FILE USED TO DO BLOCK MATH. IT NO LONGER DOES, AND THAT IS THE
 *      WHOLE POINT. READ THIS BEFORE REINTRODUCING IT. <===
 *
 * NOAA publishes the same nine products twice. The one this file used to read
 * — `NHC_tropical_weather` — is sliced into PER-STORM BLOCKS: 26 layers per
 * slot, slot bases at AT=4 / EP=134 / CP=264, the storm's block addressed by
 * arithmetic on the feed's `binNumber` and then resolved layer-by-layer
 * against the service's own layer NAMES. That was ~150 lines of the fiddliest
 * code in the project and it had a structural flaw that no amount of care
 * inside it could fix:
 *
 *   THE FEED'S BIN IS A LABEL, AND THE BLOCK SERVICE IS THE DATA. WHEN THE
 *   LABEL MOVES FIRST, THE ADDRESS MOVES AND THE DATA DOES NOT.
 *
 * Measured live 2026-07-26. Hurricane Fausto crossed 140°W into the Central
 * Pacific. At the 15:00Z advisory the storm feed flipped his `binNumber` from
 * EP1 to CP1, so the block math resolved layers 264–289 — a block that existed
 * and was COMPLETELY EMPTY, zero features on all nine layers. His actual cone,
 * tracks and wind field were still sitting in the EP1 block at the previous
 * advisory. Every layer came back `none`, the map drew nothing, and the panel
 * said "no wind field published for this advisory", which was false: NHC had
 * published one, we were reading the wrong address for it.
 *
 * `NHC_tropical_weather_summary` is the same nine products with EVERY STORM IN
 * ONE SET OF LAYERS, keyed by `binnumber`. Fixed layer ids. No block
 * arithmetic, no 26-layer stride, no metadata round trip, no name patterns, no
 * multi-match guards. Measured on the same probe, at the same minute, it was
 * also AHEAD of the block service: Fausto's advisory 31 was already there
 * under CP1 — cone, forecast track, forecast points, and his full 37-point
 * past track and 76 past wind radii carried across the basin change intact —
 * while the block service was still serving advisory 30 in the old basin.
 *
 * Being wrong across a basin change is not an edge case in the Pacific. It is
 * a normal Tuesday.
 *
 * ===> THERE IS NO UNFILTERED RETRY ANY MORE, AND ADDING ONE BACK WOULD BE A
 *      DATA-CORRUPTION BUG, NOT A FALLBACK. <===
 * The old `fetchLayer` answered a refused clause by re-querying with `1=1`.
 * That was SAFE on the block service and only there: a block layer only ever
 * holds one storm, so an unfiltered read of the right block was still that
 * storm's data. On the summary service `1=1` returns EVERY ACTIVE STORM. The
 * same line that used to rescue a layer would now draw three storms' cones on
 * top of one — confident, plausible, and wrong, which is the exact §5 failure
 * mode this project keeps paying for. A refused clause is `unavailable` now.
 *
 * WHAT REPLACED IT is not in this file at all: `data/cache.js` holds each
 * storm's best-known bundle and refuses to let an empty or failed fetch
 * overwrite good geometry. A fallback that guesses at data was traded for one
 * that keeps data it already had and says how old it is.
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
 * No DOM, ever. Imports: config/, lib/ only.
 */

import { ENDPOINT, MAPSERVER, GEOMETRY_LAG_THRESHOLD } from '../config/constants.js';
import { parseNhcValidtime } from '../lib/time.js';
import { buildFullTrack } from '../lib/windswath.js';

/** Bin number: two letters and a digit (`AT2`, `EP1`, `CP1`). The same shape
 *  the relay validates before it reaches a WHERE clause. */
const BIN_RE = /^[A-Z]{2}\d$/;

/* ---------------------------------------------------------------------------
 * PER-LAYER QUERY
 * ------------------------------------------------------------------------- */

/**
 * ArcGIS reports errors as HTTP 200 with an `error` body — must be checked.
 *
 * THE WHERE CLAUSE IS NOT BUILT HERE (SPEC §17 Pass B). It is built by
 * `/api/nhc/mapserver`, which takes a validated bin and constructs the query
 * itself — the same shape as every other parameterized relay route, and the
 * reason the relay is not an arbitrary query proxy into a federal ArcGIS
 * service. This function says WHICH storm it wants; the relay decides what
 * that means in SQL.
 *
 * ===> `cache: 'no-store'` IS LOAD-BEARING. DO NOT REMOVE IT. <===
 * This URL is `?layer=7&bin=EP2`. It names no advisory and never changes, so it
 * is byte-identical from advisory 1 to the last one a storm ever gets. A browser
 * that saves the answer has NO WAY to tell the saved copy has gone off, and the
 * relay gives it no help either — geometry comes back with no `Cache-Control` on
 * a cache miss and `s-maxage` on a hit, and `s-maxage` binds Cloudflare while
 * saying nothing to a private cache. So the browser invents a lifetime.
 *
 * MEASURED ON GLASS 2026-07-29, 16:26 vs 16:27: Genevieve drew from advisory 16,
 * 36 HOURS OLD, in a Brave tab while the installed PWA on the same phone, same
 * network, same minute drew advisory 23. Android partitions the two, so one had
 * the stale copy and one did not. The feed line read "27 min ago" on BOTH —
 * because data/relay.js sets no-store and this did not. A position dot from
 * advisory 23 sat inside a cone from advisory 16 and only the small amber lag
 * line said so.
 *
 * Every relay fetch in the app sets this: data/relay.js (feed, advisory text),
 * data/adeck.js (models), and here. data/geocode.js deliberately does not — an
 * address maps to the same point forever.
 */
async function queryLayer(layerId, bin) {
  const params = new URLSearchParams({ layer: String(layerId), bin });

  const res = await fetch(`${ENDPOINT.relay}/nhc/mapserver?${params}`, {
    cache: 'no-store',
  });
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
     * cannot say which storm it belongs to selects nothing. NHC's forecast
     * points carry no `stormid` column at all on this service (measured
     * 2026-07-26), so it is put here rather than inferred downstream from
     * fields that change every advisory. */
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

/* Every layer the bundle carries, and the summary service's id for it.
 *
 * MEASURED against the live service 2026-07-26. These ids are FIXED — the
 * summary service is one flat set of products, not a per-storm block, so
 * there is nothing to compute and nothing that shifts when a storm forms,
 * dissipates, or changes basin. That is the entire reason this file is now a
 * third of its former size.
 *
 * NOT IN THE BUNDLE, deliberately: layer 12, "Past Cumulative Wind Swath".
 * It is NOAA's rasterized merged product (100% axis-aligned edges, measured
 * 2026-07-24) and §7 forbids drawing it — the clean envelope is built here
 * from the published quadrant numbers instead (buildFullTrack below). It is
 * named here only so the next reader knows 12 was skipped on purpose rather
 * than missed. */
export const SUMMARY_LAYER = Object.freeze({
  forecastPoints: 5,
  forecastTrack: 6,
  cone: 7,
  watchWarning: 8,
  pastPoints: 10,
  pastTrack: 11,
  /* The swept envelope's past tier (§4): past wind radii and their centres.
   * Raw inputs to buildFullTrack — no map layer reads these slots directly,
   * and the at-home exposure timeline will want them later. */
  windPast: 13,
  windSwath: 15,
  windCurrent: 16,
});

/* EVERY LAYER KEYS ON `binnumber`, AND THAT IS WHY THIS SERVICE IS THE RIGHT
 * ONE. Verified field-by-field on all nine, 2026-07-26. Four of them also
 * carry `stormid` (12, 13, 15, 16) — unused here on purpose: one filter
 * currency that works everywhere beats two that each work somewhere, and the
 * block service's split-clause bug came from exactly that kind of per-layer
 * special-casing. (`stormid`'s case also varies BETWEEN layers on this
 * service — `EP062026` on 13, `ep062026` on 15, measured — which is a second
 * reason not to key on it.) */

/**
 * Fetch everything selection needs for one storm, in parallel, each layer an
 * independent slot — one failing must not blank the others (SPEC §5).
 *
 * @returns {Promise<{
 *   layers: Record<string, {status: 'ok'|'unavailable'|'none', fc, error}>,
 *   forecast: Array, stamp: {advisnum, filedate}, bin: string, fetchedAt: string
 * }>}
 * Throws only when the storm has no usable bin — that is a bundle-level
 * failure the caller shows as one error.
 */
export async function fetchStormGeometry(storm) {
  if (storm.source !== 'nhc') throw new Error('geometry: NHC storms only');

  /* Upper-cased to match the relay's BIN_RE. The relay re-validates it; this
   * check exists so an unusable bin fails HERE with a sentence that names the
   * storm, rather than as nine identical 400s. */
  const bin = String(storm.raw?.binNumber || '').toUpperCase();
  if (!BIN_RE.test(bin)) {
    throw new Error(`geometry: unusable binNumber "${storm.raw?.binNumber}"`);
  }

  const layers = {};

  await Promise.all(
    Object.entries(SUMMARY_LAYER).map(async ([key, layerId]) => {
      /* The `can` block distinguishes "this source never had it" from "the
       * fetch died" — a storm with no watches in effect gets `none`, never a
       * fake error row (SPEC §4). */
      if (key === 'watchWarning' && storm.can && !storm.can.watchWarning) {
        layers[key] = { status: 'none', fc: null, error: null };
        return;
      }
      try {
        const fc = await queryLayer(layerId, bin);
        const clean = scrubSentinels(fc);
        if (key === 'forecastPoints') annotateForecastTimes(clean, storm.id);
        layers[key] = {
          status: clean.features.length ? 'ok' : 'none',
          fc: clean,
          error: null,
        };
      } catch (e) {
        /* Named on the console because the panel only says WHICH layers died,
         * not why — this is the debuggable-on-a-phone-plugged-into-a-laptop
         * seam the client-side merge decision (§4) exists for. */
        console.warn(`[landfall] geometry layer '${key}' (id ${layerId}) failed:`, e?.message || e);
        layers[key] = { status: 'unavailable', fc: null, error: e?.message || 'failed' };
      }
    })
  );

  /* ---- THE FULL-TRACK ENVELOPE (§4: three tiers, one swath). ----
   * The windSwath slot is REPLACED with the swept envelope built from all
   * three tiers — past (13 joined to 10), current (16 at the FEED position),
   * forecast (15 joined to 5 geometry). The raw forecast-radii features stay
   * behind as the §5 solver fallback: if construction throws or produces
   * nothing while inputs existed, the slot keeps NHC's raw per-tau rings —
   * stacked and compounding, but correct. Same promise either way ("full
   * track"), so the fallback needs a console warning, not a UI flag. */
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

  /* `bin` rides along because the CACHE compares bundles across advisories,
   * and a basin change is the one difference worth naming on the console
   * (data/cache.js). Nothing renders it. */
  return { layers, forecast, stamp, bin, fetchedAt: new Date().toISOString() };
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
