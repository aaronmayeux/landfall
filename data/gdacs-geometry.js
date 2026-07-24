/**
 * gdacs-geometry.js — per-event GDACS geometry → the same bundle NHC produces.
 *
 * THE CONTRACT: this returns the identical shape `data/nhc-mapserver.js`
 * returns — `{ layers: {key: {status, fc, error, unfiltered}}, forecast,
 * stamp, fetchedAt }`. That is deliberate and it is what makes this pass
 * cheap: `map/layers/wind-field.js`, the cone layer, the track layers and the
 * detail panel all read bundle slots and do not know or care which source
 * filled them. Not one line of the drawing code changes for GDACS.
 *
 * EVERY FIELD NAME BELOW WAS READ OFF LIVE DATA (2026-07-24, NOUL-26
 * eventid 1001294 episode 6, via /api/gdacs/inspect). Nothing here is
 * inherited from the HA project. The inherited description of this payload
 * was wrong about the wind thresholds and wrong about which products exist,
 * which is precisely why the inventory ran first.
 *
 * WHAT GDACS ACTUALLY PUBLISHES, per event:
 *   - 3 wind band classes × ~7 forecast timesteps (`featuretype: WindRadii`),
 *     QUADRANT-SHAPED — confirmed on glass 2026-07-24. The spec's inherited
 *     "one radius, symmetric circles" claim was wrong.
 *   - 1 uncertainty cone (`Class: Poly_Cones`)
 *   - ~10 two-point track segments, past and forecast, intensity-labelled
 *   - per-timestep centre dots (`featuretype: PointRadii`) — NOT bands
 *
 * No DOM, ever. Imports: config/, lib/, data/relay.js.
 */

import { ENDPOINT, GDACS_GEOMETRY } from '../config/constants.js';
import { mergeBandPolygons } from '../lib/bandmerge.js';
import { simplifyGeometry, countCoordinates } from '../lib/simplify.js';
import { fetchFeed } from './relay.js';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

/** A slot the source genuinely does not publish. Distinct from `unavailable`
 *  (fetch died) and from an empty `ok` — SPEC §5's three states. */
const NONE = () => ({ status: 'none', fc: null, error: null, unfiltered: false });

const okSlot = (features) => ({
  status: features.length ? 'ok' : 'none',
  fc: { type: 'FeatureCollection', features },
  error: null,
  unfiltered: false,
});

/**
 * Build the geometry URL.
 *
 * PREFER THE PUBLISHED ONE. Every event in the list feed carries
 * `url.geometry` (confirmed live), and reading it is strictly better than
 * assembling our own: if GDACS moves the endpoint, a published link keeps
 * working while a constructed one breaks silently. The constructed form is
 * the fallback only, and it is the form GDACS itself publishes today.
 */
function geometryUrl(storm) {
  const published = storm?.raw?.geometryUrl;
  if (typeof published === 'string' && published.startsWith('https://www.gdacs.org/')) {
    return published;
  }
  const id = encodeURIComponent(storm.sourceId);
  const ep = storm?.raw?.episodeId;
  const epPart = ep ? `&episodeid=${encodeURIComponent(ep)}` : '';
  return `${ENDPOINT.gdacsGeometry}?eventtype=TC&eventid=${id}${epPart}`;
}

/**
 * Identify a band feature's threshold from its OWN published label.
 *
 * This is the safety-critical function in the file, so it is deliberately
 * strict and it fails CLOSED.
 *
 * The trap: `Class` says "Poly_Orange", and `alertlevel` on the same feature
 * also says "Orange" — but alertlevel is GDACS's HUMANITARIAN impact rating
 * (SPEC §4), nothing to do with wind speed. Two meanings, one vocabulary. So
 * the class name alone is never trusted to carry a wind threshold.
 *
 * Instead: the class proposes an expected speed, and the feature's own
 * `polygonlabel` ("120 km/h") must AGREE with it within a few km/h. If GDACS
 * renumbers a band, or reorders the colors, or a class shows up we have never
 * seen, the two disagree and the feature is DROPPED rather than painted in a
 * guessed color. A missing ring is visible and gets reported; a ring in the
 * wrong severity color is invisible and is a §6 violation.
 *
 * @returns {{colorKey: 34|50|64, kmh: number}|null}
 */
function bandFromFeature(props) {
  const cls = props?.Class;
  const expected = GDACS_GEOMETRY.bandClass[cls];
  if (!expected) return null;

  const label = props?.polygonlabel;
  const m = typeof label === 'string' ? label.match(GDACS_GEOMETRY.bandLabelPattern) : null;

  /* NO LABEL IS NOT A FREE PASS. Only the first timestep of each band
   * carries the "60 km/h" text; the rest are labelled with their time. That
   * is fine — they are the same class, and the class's meaning was confirmed
   * by the labelled member and independently by the area nesting. What we
   * refuse is a label that CONTRADICTS the class. */
  if (!m) return { colorKey: expected.colorKey, kmh: expected.kmh };

  const published = parseFloat(m[1]);
  if (!Number.isFinite(published)) return null;
  if (Math.abs(published - expected.kmh) > GDACS_GEOMETRY.bandLabelToleranceKmh) {
    console.warn(
      `[landfall] GDACS band ${cls} labelled ${published} km/h, expected ~${expected.kmh}; dropped`
    );
    return null;
  }
  return { colorKey: expected.colorKey, kmh: published };
}

/**
 * Tag a band feature so the existing wind layer can read it unchanged.
 *
 * `wind-field.js` calls `windThresholdFromProps()`, which looks for a `radii`
 * field holding 34, 50 or 64. We write that field. This is a TRANSLATION, not
 * a claim that GDACS published NHC thresholds — the true published speed is
 * kept alongside in `_gdacsKmh` so the panel can state what GDACS actually
 * said (60/90/120 km/h) rather than parroting NHC's numbers at the user.
 */
function tagBand(f, band, whenMs) {
  return {
    ...f,
    geometry: simplifyGeometry(f.geometry),
    properties: {
      ...f.properties,
      radii: band.colorKey,
      _gdacsKmh: band.kmh,
      _gdacsTime: whenMs,
    },
  };
}

const timeOf = (props) => {
  const t = Date.parse(props?.polygondate || '');
  return Number.isFinite(t) ? t : null;
};

/**
 * Sort the flat FeatureCollection into the bundle's slots.
 *
 * One pass, switching on `Class` and `featuretype` — both confirmed live.
 */
function sortFeatures(features) {
  const bands = [];        // all band polygons, every timestep
  const cone = [];
  const pastTrack = [];
  const forecastTrack = [];

  for (const f of features) {
    const p = f?.properties || {};
    const cls = String(p.Class || '');

    if (cls === GDACS_GEOMETRY.coneClass) {
      cone.push({ ...f, geometry: simplifyGeometry(f.geometry) });
      continue;
    }

    if (p.featuretype === GDACS_GEOMETRY.windRadiiType) {
      const band = bandFromFeature(p);
      if (!band) continue; // unidentifiable → dropped, never guessed (§6)
      bands.push(tagBand(f, band, timeOf(p)));
      continue;
    }

    if (cls.startsWith(GDACS_GEOMETRY.linePrefix)) {
      /* `forecast` arrives as the STRING "true"/"false", not a boolean —
       * a plain truthiness test would put every segment in the forecast
       * bucket, since "false" is a non-empty string. */
      const isForecast = String(p.forecast) === GDACS_GEOMETRY.forecastTrue;
      const seg = {
        ...f,
        properties: {
          ...f.properties,
          _intensity: GDACS_GEOMETRY.trackIntensity[p.polygonlabel] || null,
        },
      };
      (isForecast ? forecastTrack : pastTrack).push(seg);
      continue;
    }

    /* Everything else — per-timestep centre dots (`PointRadii`) and the
     * centroid — is deliberately dropped. Those 30-odd polygons are NOT
     * wind bands; drawing them as such was the "soup" risk the census
     * existed to rule out. */
  }

  return { bands, cone, pastTrack, forecastTrack };
}

/**
 * Split the bands into the wind pair's two slots.
 *
 * The pair (SPEC §7) is "current" vs "full track", and GDACS supports both
 * because its bands arrive PER-TIMESTEP (7 polygons per color across 6
 * forecast times, confirmed live):
 *   windCurrent — the EARLIEST timestep: how big the storm is NOW.
 *   windSwath   — every timestep, merged: the total area that sees each
 *                 threshold over the forecast period.
 *
 * EARLIEST, NOT LATEST — and getting this backwards is what made the Current
 * toggle draw nothing on glass (2026-07-24). GDACS's `polygondate` runs
 * FORWARD from the analysis time: the first entry matches the storm's own
 * `todate` (the current fix) and the rest are projections out to +60 h.
 * `Math.max` therefore selected the furthest-out forecast — and because the
 * app flies to the storm's CURRENT position, that ring was drawn far off
 * screen. Nothing was broken and nothing errored; the shape was simply
 * somewhere the user was not looking. A layer that draws correctly in the
 * wrong place is indistinguishable from a layer that failed (§5), which is
 * why this now selects by earliest and says so.
 */
function splitPair(bands) {
  if (!bands.length) return { current: [], swath: [] };

  const times = bands.map((f) => f.properties._gdacsTime).filter((t) => t != null);
  /* No parseable times: every band is as current as any other. Show them
   * all in both slots rather than an arbitrary subset. */
  if (!times.length) return { current: bands, swath: bands };

  const nowStep = Math.min(...times);
  const current = bands.filter((f) => f.properties._gdacsTime === nowStep);

  /* Defensive, and reachable: a band class whose only feature has a null
   * time contributes nothing to `nowStep`, so its threshold would vanish
   * from Current. Falling back to the whole stack keeps every threshold
   * visible — stale-but-visible beats blank (§5). */
  return { current: current.length ? current : bands, swath: bands };
}

/**
 * Merge one threshold's stacked polygons into a single smooth outline.
 *
 * WHY, in one sentence: drawing seven translucent quadrant shapes per color
 * makes their fills compound at every overlap, which is the look Aaron
 * rejected on the NHC swath and rejected again here on glass.
 *
 * Returns merged features, or the ORIGINAL stack when the merge cannot run
 * (span too large for the grid budget, or a trace that came back empty).
 * Falling back to the stack is deliberate: it is uglier and correct, where
 * returning nothing would blank a wind band — the §5 failure. Same promise
 * either way ("full track"), so this warns to the console rather than
 * flagging the UI.
 */
function mergeThreshold(features) {
  if (features.length < 2) return features;

  const polygons = [];
  for (const f of features) {
    const g = f.geometry;
    if (g?.type === 'Polygon') polygons.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') for (const p of g.coordinates) polygons.push(p);
  }
  if (polygons.length < 2) return features;

  let rings;
  try {
    rings = mergeBandPolygons(polygons);
  } catch (e) {
    console.warn(`[landfall] GDACS band merge failed (${e?.message || e}); drawing raw stack`);
    return features;
  }
  if (!rings.length) {
    console.warn('[landfall] GDACS band merge produced nothing; drawing raw stack');
    return features;
  }

  /* Properties come from the first feature so the threshold, color key and
   * published km/h survive the merge untouched — the merge changes SHAPE,
   * never severity. */
  const proto = features[0].properties;
  return rings.map((ring) => ({
    type: 'Feature',
    properties: { ...proto, _merged: true },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }));
}

/** Merge each threshold independently, then flatten. Thresholds must never
 *  be merged together — that would fuse a 60 km/h band into a 120 km/h one
 *  and destroy the severity nesting the colors depend on. */
function mergeSwath(bands) {
  const byThreshold = new Map();
  for (const f of bands) {
    const kt = f.properties?.radii;
    if (!byThreshold.has(kt)) byThreshold.set(kt, []);
    byThreshold.get(kt).push(f);
  }
  const out = [];
  for (const group of byThreshold.values()) out.push(...mergeThreshold(group));
  return out;
}

/**
 * Fetch and normalize one GDACS storm's geometry.
 *
 * @returns {Promise<object>} the same bundle shape fetchStormGeometry returns.
 * @throws when the fetch itself fails — a bundle-level failure the caller
 *         shows as one error, exactly as the NHC path does.
 */
export async function fetchGdacsGeometry(storm) {
  if (storm.source !== 'gdacs') throw new Error('gdacs geometry: GDACS storms only');

  const { json } = await fetchFeed(geometryUrl(storm));
  const features = Array.isArray(json?.features) ? json.features : [];

  const rawCount = features.reduce((n, f) => n + countCoordinates(f.geometry), 0);
  const { bands, cone, pastTrack, forecastTrack } = sortFeatures(features);
  const { current, swath } = splitPair(bands);
  /* Full track is MERGED per threshold; current is a single timestep and
   * needs no merge (one shape per color already). */
  const swathMerged = mergeSwath(swath);

  const keptCount =
    [...bands, ...cone].reduce((n, f) => n + countCoordinates(f.geometry), 0);
  if (rawCount) {
    console.info(
      `[landfall] ${storm.id}: GDACS geometry ${features.length} features, ` +
      `${rawCount} coords in → ${keptCount} drawn`
    );
  }

  const layers = {
    cone: cone.length ? okSlot(cone) : NONE(),
    forecastTrack: forecastTrack.length ? okSlot(forecastTrack) : NONE(),
    pastTrack: pastTrack.length ? okSlot(pastTrack) : NONE(),
    windCurrent: current.length ? okSlot(current) : NONE(),
    windSwath: swathMerged.length ? okSlot(swathMerged) : NONE(),

    /* Products GDACS genuinely does not publish. `none` is the honest state
     * and it is what makes the panel rows dim with a reason instead of
     * showing a fake error (§5). */
    forecastPoints: NONE(),
    watchWarning: NONE(),
    windPast: NONE(),
    pastPoints: NONE(),
  };

  /* GDACS has no advisory number. `polygondate` on the cone/bands is the
   * closest equivalent to NHC's filedate, so the panel's "as of" line has
   * something true to show rather than nothing. */
  const stampMs =
    timeOf(cone[0]?.properties) ??
    (bands.length ? Math.min(...bands.map((f) => f.properties._gdacsTime).filter(Boolean)) : null);

  return {
    layers,
    forecast: [], // GDACS publishes no forecast POINT track with times
    stamp: { advisnum: null, filedate: Number.isFinite(stampMs) ? stampMs : null },
    fetchedAt: new Date().toISOString(),
  };
}

export { bandFromFeature as _bandFromFeature, splitPair as _splitPair };
