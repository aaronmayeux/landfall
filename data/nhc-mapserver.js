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
import { parseNhcValidtime, parseSynopticStamp } from '../lib/time.js';
import { categoryFromKt } from '../lib/category.js';
import { buildFullTrack } from '../lib/windswath.js';
import { normalizePastPoints } from '../lib/track-point.js';

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
function annotateForecastTimes(fc, stormId, stormName) {
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
    /* The storm's DISPLAY NAME, for label placement only. The name is drawn
     * on the map under this storm's position (map/markers.js) and the time
     * labels have to be routed around it — so the placement pass needs to
     * know how wide it is, and placement only ever sees these features.
     * Stamped for the same reason `_stormId` is: NHC's forecast-point service
     * publishes no name column at all, and the fields that come close change
     * with the storm's intensity ("Tropical Storm Bertha" becomes "Hurricane
     * Bertha"), so it is put here rather than inferred downstream. */
    p._stormName = stormName || null;
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
 * NHC's `ssnum` → the app's category index.
 *
 * TWO DIFFERENT NUMBERINGS, AND THEY ARE OFF BY ONE IN A WAY THAT LOOKS RIGHT.
 * `ssnum` is a Saffir-Simpson number: 0 means "below hurricane strength",
 * 1..5 mean Cat 1..5. The app's index (lib/category.js) is 0 = TD, 1 = TS,
 * 2..6 = Cat 1..5. So `ssnum` 2 is index 3, and reading one as the other
 * silently demotes every hurricane by a full category — the exact class of
 * error §6 exists to prevent, and it would never throw.
 *
 * `ssnum` 0 CANNOT BE RESOLVED ON ITS OWN. It covers both TD and TS, which are
 * two different colors and two different words. That case falls through to
 * the wind, which is always published here (spec-parameter §30.3: no sentinel
 * on `maxwind`, `gust` or `ssnum` at any tau).
 *
 * Returns null when neither source can answer, so a caller degrades rather
 * than defaulting to TD.
 */
function categoryAt(ssnum, windKt) {
  if (Number.isFinite(ssnum) && ssnum >= 1) return Math.min(ssnum + 1, 6);
  return categoryFromKt(windKt);
}

/**
 * Forecast point features → the normalized forecast curve, ordered by forecast
 * hour (`tau`):
 * `[{lon, lat, time, windKt, gustKt, category, categorySource, stormType, tau}]`
 *
 * ==> THIS USED TO KEEP FOUR FIELDS AND THROW THE REST AWAY. <==
 * `{lon, lat, time, windKt, tau}` was everything closestApproach() needed, so
 * everything else NHC publishes at every tau went on the floor — and Forecast
 * Points is the richest layer in the service. `gust`, `ssnum` and `stormtype`
 * are valid at EVERY tau with no sentinel (measured, tabulated in
 * spec-parameter §30.3), so the app was discarding a complete five-day
 * intensity forecast on every geometry fetch and then had nothing to answer
 * "how strong is it when it reaches me" with. Keeping them costs one extra
 * property read per point.
 *
 * `categorySource` IS PART OF THE RETURN, not a detail. NHC reports `ssnum`
 * itself; deriving a category from knots is our arithmetic. Those are
 * different provenances and spec-parameter §35.2 logs the gap. A caller that
 * wants to say "NHC calls this a Cat 2" rather than "this is 90 kt, which we
 * call a Cat 2" has to be able to tell them apart.
 *
 * THE GEOMETRY IS THE POSITION. Never `p.lat` / `p.lon` — those attribute
 * fields are rounded to whole degrees, up to ~30 nm of error at mid latitudes
 * (spec-parameter §35.3).
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
      const windKt = num(p.maxwind);
      const ssnum = num(p.ssnum);
      return {
        lon: num(lon),
        lat: num(lat),
        time,
        windKt,
        /** Peak gust at this tau, knots. Published at every tau; omitted
         *  (null), never zeroed, if an advisory ever stops carrying it. */
        gustKt: num(p.gust),
        category: categoryAt(ssnum, windKt),
        /** 'reported' when NHC's own `ssnum` answered, 'derived' when we
         *  computed it from knots, null when neither could. Three states,
         *  because "no category" is real and has no source at all. */
        categorySource:
          Number.isFinite(ssnum) && ssnum >= 1
            ? 'reported'
            : Number.isFinite(windKt)
              ? 'derived'
              : null,
        /** NHC's own classification letter at this tau: `TD`, `TS`, `HU`,
         *  `MH`, `PT`. Carried verbatim. `MH` (Major Hurricane) exists here
         *  and nowhere in CurrentStorms.json, and this curve is the only
         *  place the app can watch a storm CROSS a classification boundary. */
        stormType: typeof p.stormtype === 'string' ? p.stormtype.toUpperCase() : null,
        tau: num(p.tau),
      };
    })
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
    .sort((a, b) => (a.tau ?? Infinity) - (b.tau ?? Infinity));
  return pts;
}

/**
 * Wind-radii features → `[{tau, kt, ne, se, sw, nw}]`, ascending by tau then
 * threshold.
 *
 * ==> WHY THIS EXISTS ALONGSIDE buildFullTrack(). <==
 * The swath builder consumes these same features and returns POLYGONS — the
 * drawn envelope. A polygon is the right answer for the map and the wrong one
 * for a question: "how far do 50 kt winds reach toward my house at 3 PM" is a
 * NUMBER, and recovering it from a rendered outline means point-in-polygon
 * tests against a shape that has already been simplified, blended and
 * fold-guarded. The published quadrant numbers are right here; the home
 * corridor reads them directly and the two never disagree, because both start
 * from this same feature list.
 *
 * IT ALSO SURVIVES THE SLOT BEING OVERWRITTEN. fetchStormGeometry REPLACES
 * `layers.windSwath` with the built envelope, so by the time anything
 * downstream sees the bundle the raw radii are gone. This is extracted before
 * that happens and rides on the bundle as its own field.
 *
 * A ZERO IS REAL DATA, NOT A GAP (spec-parameter §37.5): it means "no winds
 * this strong in this quadrant", which is a measurement. Only a missing or
 * unparseable field becomes 0 here by way of `Number(...) || 0`, and that
 * collision is acceptable precisely because both readings — absent and zero —
 * mean the same thing to a reader: nothing reaches you from that side.
 *
 * `radii` IS THE THRESHOLD IN KNOTS, not a distance. It is the single most
 * confusable field name on the service; anything reading it as a length gets
 * a wind field 34 nm wide.
 */
export function normalizeForecastRadii(fc) {
  const out = [];
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const kt = typeof p.radii === 'string' ? parseFloat(p.radii) : p.radii;
    if (![34, 50, 64].includes(kt)) continue;
    const tau = num(p.tau);
    if (tau == null) continue;
    out.push({
      tau,
      kt,
      ne: Number(p.ne) || 0,
      se: Number(p.se) || 0,
      sw: Number(p.sw) || 0,
      nw: Number(p.nw) || 0,
    });
  }
  return out.sort((a, b) => (a.tau - b.tau) || (a.kt - b.kt));
}

/**
 * PAST wind-radii features (layer 13) → `[{time, kt, ne, se, sw, nw}]`,
 * ascending by time then threshold.
 *
 * ==> THE SAME SHAPE AS normalizeForecastRadii, KEYED ON A CLOCK INSTEAD OF A
 * FORECAST HOUR. <== `tau` is a number of hours after an advisory was issued
 * and has no meaning behind the clock: NHC's past wind field is stamped with
 * the synoptic hour it was ANALYSED at. So the key is an instant, and every
 * rule the forecast version follows is repeated here deliberately rather than
 * shared — the two functions are twelve lines each and merging them would need
 * a mode flag threaded through both, which is how one of them quietly starts
 * obeying the other's rules.
 *
 * `synoptime` IS TEN DIGITS OF UTC, `YYYYMMDDHH`, AS A STRING. Layer 10's
 * `dtg` is a NUMBER of the same ten digits and the two join on it — that join
 * is what `lib/windswath.js` already does to place these rings, and it is
 * measured against NHC's own published best track: 28 of 28 of Ida's radii
 * times find a centre, zero orphans. Parsed here into an ISO instant so
 * everything downstream compares times the one way the rest of the app does.
 *
 * ==> A RING WITH NO STATED CENTRE IS DROPPED, AND NOT HERE. <== This function
 * answers "how wide was the field", not "where was it", so a radius set whose
 * synoptic hour has no matching position is still returned — the corridor
 * drops it when it fails to find a centre to hang it on. Splitting the two
 * decisions is what lets a test say which of them lost a ring.
 *
 * A ZERO IS REAL DATA, exactly as in the forecast version: it means no winds
 * that strong in that quadrant, which is a measurement.
 */
export function normalizePastRadii(fc) {
  const out = [];
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const kt = typeof p.radii === 'string' ? parseFloat(p.radii) : p.radii;
    if (![34, 50, 64].includes(kt)) continue;
    const time = synopticToIso(p.synoptime);
    if (!time) continue;
    out.push({
      time,
      kt,
      ne: Number(p.ne) || 0,
      se: Number(p.se) || 0,
      sw: Number(p.sw) || 0,
      nw: Number(p.nw) || 0,
    });
  }
  return out.sort((a, b) => (Date.parse(a.time) - Date.parse(b.time)) || (a.kt - b.kt));
}

/**
 * Ten digits of UTC (`YYYYMMDDHH`) → an ISO instant, or null.
 *
 * ==> STRICT, BECAUSE THE FAILURE IS SILENT OTHERWISE. <== `new Date(
 * '2021082618')` does not throw; it produces a date in the year 2021082618's
 * general vicinity or an Invalid Date depending on the runtime, and either way
 * a wind field lands somewhere no reader will ever see it. Only ten digits
 * that parse to a real calendar hour are accepted. A number is coerced first,
 * because layer 10 publishes the same value as one.
 */
function synopticToIso(v) {
  /* ==> THE PARSE ITSELF MOVED TO `lib/time.js` (§7.13). <== `lib/windswath.js`
   * needs the same ten digits to place a forecast ring on its own clock, and it
   * cannot import from `data/`. This wrapper is the ISO face of that one
   * parser, kept because everything downstream of normalization compares ISO
   * instants; the ms face is what the swath builder reads. */
  const ms = parseSynopticStamp(v);
  return ms == null ? null : new Date(ms).toISOString();
}

export { synopticToIso as _synopticToIso };

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
        if (key === 'forecastPoints') annotateForecastTimes(clean, storm.id, storm.name);
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
  /* ==> READ BEFORE THE SLOT IS OVERWRITTEN, THREE LINES BELOW. <== The swath
   * builder's output REPLACES `layers.windSwath`, so the published quadrant
   * numbers only exist at this instant. The home corridor needs the numbers,
   * not the polygon. */
  const forecastRadii =
    layers.windSwath?.status === 'ok' ? normalizeForecastRadii(layers.windSwath.fc) : [];
  const currentRadii =
    layers.windCurrent?.status === 'ok' ? normalizeForecastRadii(layers.windCurrent.fc) : [];
  /* ==> READ HERE FOR THE SAME REASON THE TWO ABOVE ARE. <== `windPast` is not
   * overwritten by the swath builder the way `windSwath` is, so this one is
   * safe where it stands — but it is kept beside its siblings because all
   * three answer one question (what did the source publish as NUMBERS) and
   * splitting them across the function is how the next reader concludes the
   * past field is unavailable. */
  const pastRadii =
    layers.windPast?.status === 'ok' ? normalizePastRadii(layers.windPast.fc) : [];

  /* ==> THE RAW TIER FEATURES, READ ONCE, FOR THE SAME REASON THE NUMBERS
   * ABOVE ARE. <== `layers.windSwath.fc.features` is the FORECAST tier's raw
   * rings right now and something else entirely four lines below. It is read
   * twice down there — once for the full envelope and once for the forward-only
   * one — and reading it inline the second time would quietly feed the finished
   * envelope back into the builder as if it were input. */
  const tiers = {
    pastRadii: layers.windPast?.status === 'ok' ? layers.windPast.fc.features : [],
    pastPoints: layers.pastPoints?.status === 'ok' ? layers.pastPoints.fc.features : [],
    currentField: layers.windCurrent?.status === 'ok' ? layers.windCurrent.fc.features : [],
    forecastRadii: layers.windSwath?.status === 'ok' ? layers.windSwath.fc.features : [],
    forecastPoints: layers.forecastPoints?.status === 'ok' ? layers.forecastPoints.fc.features : [],
    /* `headingDeg` is NHC's published `movementDir`, carried through by
     * data/nhc.js. §7.14 projects each leading forecast hour onto it to decide
     * which ones the storm has already driven past. Absent (a stationary storm
     * publishes none) means that rule does not run — never that the heading is
     * north. */
    currentPos: Number.isFinite(storm.lat) && Number.isFinite(storm.lon)
      ? {
        lat: storm.lat,
        lon: storm.lon,
        at: storm.observedAt ?? null,
        headingDeg: Number.isFinite(storm.headingDeg) ? storm.headingDeg : null,
      }
      : null,
  };

  try {
    const built = buildFullTrack(tiers);
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

  /* ---- THE FORWARD-ONLY ENVELOPE (§54). ----
   *
   * ==> NOTHING DRAWS THIS. IT EXISTS SO THE HEADCOUNT CAN SAY "STILL TO COME"
   * WITHOUT GUESSING. <== The full envelope above merges past, present and
   * forecast into one polygon and keeps no record of where the past ends, so
   * anything reading it can only make a claim about the storm's whole life. The
   * People in the path section needs a narrower claim than that. Same builder,
   * same inputs, past tier withheld: what is left is the current wind field
   * swept forward through the forecast.
   *
   * ==> `none` AND `unavailable` ARE DIFFERENT ANSWERS HERE AND THE SECTION
   * READS THEM DIFFERENTLY. <== `ok` means a real forward shape was built, so a
   * headcount of zero inside it is a measured zero — nobody is ahead. Anything
   * else means we do not know what is ahead, and the section falls back to
   * counting the whole envelope rather than announcing an all-clear it cannot
   * support (§5, and SPEC.md's rule that a silent all-clear is the worst
   * failure this app has).
   *
   * Cost, measured on Lala's advisory 34A: 0.70 ms against 14.75 ms for the
   * full sweep, because the past tier is 71 of the 90-odd rings that go in. */
  try {
    const ahead = buildFullTrack({ ...tiers, pastRadii: [], pastPoints: [] });
    layers.windAhead = ahead.length
      ? { status: 'ok', fc: { type: 'FeatureCollection', features: ahead }, error: null }
      : { status: 'none', fc: null, error: null };
  } catch (e) {
    console.warn(`[landfall] ${storm.id}: forward envelope failed (${e?.message || e})`);
    layers.windAhead = { status: 'unavailable', fc: null, error: e?.message || 'failed' };
  }

  /* Stamp preference order mirrors data quality: cone and forecast track are
   * the advisory-stamped layers users actually see. */
  const stampSource =
    [layers.cone, layers.forecastTrack, layers.forecastPoints, layers.watchWarning, layers.pastTrack]
      .find((l) => l?.status === 'ok');
  const stamp = stampSource ? stampFrom(stampSource.fc) : { advisnum: null, filedate: null };

  const forecast =
    layers.forecastPoints?.status === 'ok' ? normalizeForecast(layers.forecastPoints.fc) : [];

  /* THE OBSERVED TRACK, IN THE SAME SHAPE AS THE FORECAST (§49.3). Layer 10
   * has been fetched on every geometry bundle since the swath was built from
   * it, but only the map ever read it — so the home dashboard could compute
   * where a storm is GOING and nothing whatever about where it HAS BEEN. The
   * normalizer is shared with the GDACS path rather than written twice; see
   * lib/track-point.js. Nothing new goes over the wire here. */
  const past =
    layers.pastPoints?.status === 'ok' ? normalizePastPoints(layers.pastPoints.fc.features) : [];

  /* `bin` rides along because the CACHE compares bundles across advisories,
   * and a basin change is the one difference worth naming on the console
   * (data/cache.js). Nothing renders it. */
  return {
    layers,
    forecast,
    /** The storm's published observed track, normalized (§49.3). Ascending by
     *  time, ending at NHC's most recent analysed fix — which is BEHIND the
     *  current feed position by up to a synoptic interval, and is a
     *  measurement rather than an estimate. Empty array, never null: a storm
     *  with no history yet is a real answer. */
    past,
    /** Published quadrant radii per forecast hour, per threshold — the raw
     *  numbers behind the drawn swath. See normalizeForecastRadii. */
    forecastRadii,

    /** The PAST wind field, keyed on the synoptic hour it was analysed at
     *  (§49.9). Layer 13 has been fetched on every bundle since the swath was
     *  built from it, and until now the only thing that ever read it was the
     *  drawn polygon — so the app could say what wind is FORECAST to reach the
     *  house and nothing at all about wind that already had. Empty array,
     *  never null: a storm too weak to have published a wind field is a real
     *  answer, not a missing one. Nothing new goes over the wire here. */
    pastRadii,
    /** The same, at tau 0, from the Advisory Wind Field layer. Kept apart
     *  because it is a MEASUREMENT of now and the other is a forecast, and a
     *  screen that blends them cannot say which it is showing. */
    currentRadii,
    stamp,
    bin,
    fetchedAt: new Date().toISOString(),
  };
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
