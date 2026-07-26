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

import { ENDPOINT, GDACS_GEOMETRY, RING_POLISH } from '../config/constants.js';
import { mergeBandPolygons } from '../lib/bandmerge.js';
import { simplifyGeometry, countCoordinates } from '../lib/simplify.js';
import { smoothRadialSeams } from '../lib/ringpolish.js';
import { parseGdacsStamp } from '../lib/time.js';
import { parseGdacsPoints } from './gdacs-points.js';
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
 * Build the geometry URL — THROUGH THE RELAY.
 *
 * PREFER THE PUBLISHED UPSTREAM. Every event in the list feed carries
 * `url.geometry` (confirmed live), and reading it is strictly better than
 * assembling our own: if GDACS moves the endpoint, a published link keeps
 * working while a constructed one breaks silently. The constructed form is
 * the fallback only, and it is the form GDACS itself publishes today.
 *
 * THEN HAND THAT URL TO THE RELAY RATHER THAN FETCHING IT DIRECTLY. This is
 * not a CORS fix — GDACS sends the header and the browser can reach it. It is
 * a SPEED fix, and it is what SPEC §4 has specified all along: the payload is
 * 180-400 kB from a European server, and every load was pulling it fresh
 * while the NHC storms beside it returned almost instantly from small US
 * queries. Cloudflare's edge now holds it for 30 minutes, so the second and
 * every later load is local.
 *
 * The relay validates the URL against gdacs.org before touching it, so
 * passing it as a parameter does not turn the function into an open proxy —
 * see functions/api/gdacs/geometry.js.
 */
function upstreamGeometryUrl(storm) {
  const published = storm?.raw?.geometryUrl;
  if (typeof published === 'string' && published.startsWith('https://www.gdacs.org/')) {
    return published;
  }
  const id = encodeURIComponent(storm.sourceId);
  const ep = storm?.raw?.episodeId;
  const epPart = ep ? `&episodeid=${encodeURIComponent(ep)}` : '';
  return `${ENDPOINT.gdacsGeometry}?eventtype=TC&eventid=${id}${epPart}`;
}

function geometryUrl(storm) {
  return `${ENDPOINT.relay}/gdacs/geometry?url=${encodeURIComponent(upstreamGeometryUrl(storm))}`;
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
/**
 * Round the radial seams off a published band.
 *
 * A GDACS band is four sectors of DIFFERENT radii joined by RADIAL EDGES at
 * 90/180/270, so it draws with rectangular bites out of it. Measured on the
 * real green band (centre 120.4/19.7): the radius steps from 1.3268 to 0.7961
 * across due-west — 32 nm — and 27 nm across due-east.
 *
 * SMOOTHED IN THE ANGULAR DOMAIN, NOT IN X/Y. Two earlier attempts smoothed
 * the ring geometry and both shipped with no visible effect; a radial seam is
 * a step in r(theta), not a corner in x/y, and clipping the result inside the
 * published ring forbids the one direction that would round it. Full
 * reasoning in lib/ringpolish.js.
 *
 * The centre is the storm's own position, which is exactly what these sectors
 * are drawn around.
 */
function polishGeometry(geometry, centre) {
  const ring = (r) =>
    smoothRadialSeams(
      r,
      centre,
      RING_POLISH.seamSamples,
      RING_POLISH.seamWindowDeg,
      RING_POLISH.seamBlurPasses
    );
  if (geometry?.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(ring) };
  }
  if (geometry?.type === 'MultiPolygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((p) => p.map(ring)) };
  }
  return geometry;
}

/**
 * SIMPLIFICATION HAPPENS AT THE EXITS, NOT HERE.
 *
 * This function used to Douglas-Peucker the ring on the way in, and for the
 * CURRENT field that was backwards in a way that cost the whole seam polish.
 * `smoothRadialSeams()` builds its radius profile by binning the ring's own
 * vertices into 360 bearings, so vertex density is profile resolution — and DP
 * at 0.01° leaves arc points about sqrt(8·R·tol) apart, ~16° of bearing on a 1°
 * band. That is 22 real samples feeding 360 bins, with treads WIDER than the
 * blur window: the staircase walked straight through the smoother and reached
 * the screen as the quadrant hints Aaron reported on 2026-07-26.
 *
 * Nothing is paid for this. The polish rebuilds the ring at `seamSamples` (360)
 * points regardless, so the current field shipped 360 vertices before this
 * change and ships 360 after — the pre-simplify was discarding fidelity to save
 * work that was then redone. The swath path, which does not go through the
 * polish, is simplified at its own exit instead.
 */
function tagBand(f, band, whenMs) {
  return {
    ...f,
    properties: {
      ...f.properties,
      radii: band.colorKey,
      _gdacsKmh: band.kmh,
      _gdacsTime: whenMs,
    },
  };
}

/**
 * Is this polygon zero-area — every vertex the same point?
 *
 * GDACS's way of saying "this threshold does not reach here". Confirmed on
 * real data: the last two forecast steps of NOUL-26's green band were each
 * 330 identical copies of a single coordinate. Cheap to detect and it must
 * be detected, because a zero-radius shape poisons every downstream stage:
 * the centroid collapses onto it, the radial profile is all zeros, and the
 * bridge tapers the corridor to a point.
 *
 * Tolerance rather than exact equality: GDACS coordinates are published to
 * 4 decimal places, so a genuine shape is orders of magnitude larger than
 * this, and a shape smaller than it would be sub-pixel at any zoom anyway.
 */
function isDegenerate(geometry) {
  const rings = geometry?.type === 'Polygon' ? geometry.coordinates
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates.flat()
    : null;
  if (!rings?.length) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return (maxX - minX) < GDACS_GEOMETRY.degenerateSpanDeg
      && (maxY - minY) < GDACS_GEOMETRY.degenerateSpanDeg;
}

/**
 * `polygondate` → epoch ms UTC.
 *
 * WAS A PLAIN Date.parse, AND THAT WAS WRONG BY THE DEVICE'S UTC OFFSET.
 * GDACS publishes "2026-07-24T12:00:00" with no zone marker, and JavaScript
 * reads a zoneless date-TIME as local. Measured on 2026-07-24: under
 * TZ=Asia/Manila that value parsed to 04:00Z — eight hours early. The times
 * are UTC (the dots' own labels say "UTC"), so parsing goes through
 * lib/time.js, which appends the Z.
 *
 * Band selection never noticed because it only compares these to each other
 * and a uniform shift preserves the ordering. The "as of" line the user
 * reads did notice, and was wrong for everyone outside UTC.
 *
 * REMEMBER WHICH FEATURE YOU ARE ON (§4): this is the VALID time on a
 * per-timestep band and the ISSUE time on a centre dot, the cone, and the
 * merged swath.
 */
const timeOf = (props) => parseGdacsStamp(props?.polygondate);

/**
 * Sort the flat FeatureCollection into the bundle's slots.
 *
 * One pass, switching on `Class` and `featuretype` — both confirmed live.
 */
function sortFeatures(features) {
  const bands = [];        // per-timestep band polygons (featuretype WindRadii)
  const swathBands = [];   // GDACS's OWN pre-merged swath, one per threshold
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

    /* A band class polygon. TWO KINDS live under the same `Class`, and the
     * difference is `featuretype` — confirmed from a raw coordinate dump
     * 2026-07-24 (Poly_Green on NOUL-26):
     *
     *   featuretype "WindRadii" → ONE forecast timestep's footprint.
     *   featuretype  null       → GDACS'S OWN PRE-MERGED FULL-TRACK SWATH,
     *                             labelled with the threshold ("60 km/h"),
     *                             tracing the whole corridor nose to tail
     *                             WITH PROPERLY ROUNDED END CAPS.
     *
     * The second one is the thing this file spent two commits reconstructing
     * with an occupancy grid. It was in the payload the whole time; the
     * `featuretype === 'WindRadii'` test filtered it out, and the census
     * never showed it because it groups by Class, not by featuretype. */
    if (GDACS_GEOMETRY.bandClass[cls]) {
      const band = bandFromFeature(p);
      if (!band) continue; // unidentifiable → dropped, never guessed (§6)

      /* DEGENERATE POLYGONS ARE REAL AND MUST BE DROPPED. Where a threshold
       * does not exist at a forecast point, GDACS does not omit the
       * feature — it publishes one whose every vertex is the SAME POINT
       * (measured: 330 identical copies of [113.5, 24.8]). Aaron diagnosed
       * this from the map before the dump confirmed it: "you are assigning
       * a 0 radius at a forecast point when you don't see a field. That is
       * causing the pinch." Exactly right — a zero-area shape fed to the
       * bridge blends the corridor down to a mathematical point, which is
       * the pinched end he kept seeing. No invented fixture ever contained
       * one of these. */
      if (isDegenerate(f.geometry)) continue;

      if (p.featuretype === GDACS_GEOMETRY.windRadiiType) {
        bands.push(tagBand(f, band, timeOf(p)));
      } else {
        swathBands.push(tagBand(f, band, timeOf(p)));
      }
      continue;
    }

    if (cls.startsWith(GDACS_GEOMETRY.linePrefix)) {
      /* `forecast` arrives as the STRING "true"/"false", not a boolean —
       * a plain truthiness test would put every segment in the forecast
       * bucket, since "false" is a non-empty string. */
      const isForecast = String(p.forecast) === GDACS_GEOMETRY.forecastTrue;
      (isForecast ? forecastTrack : pastTrack).push(f);
      continue;
    }

    /* Everything else — per-timestep centre dots (`PointRadii`) and the
     * centroid — is deliberately dropped. Those 30-odd polygons are NOT
     * wind bands; drawing them as such was the "soup" risk the census
     * existed to rule out. */
  }

  return { bands, swathBands, cone, pastTrack, forecastTrack };
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
  const { bands, swathBands, cone, pastTrack, forecastTrack } = sortFeatures(features);
  /* POLISH ONLY WHAT IS DRAWN. `splitPair` picks the analysis timestep for
   * the Current segment; the other ~15 band features feed only the swath
   * FALLBACK, which goes through lib/bandmerge.js and is already polished
   * there. Polishing all of them would be five times the work for shapes
   * nobody sees. */
  const { current: rawCurrent } = splitPair(bands);
  const centre = [storm.lon, storm.lat];
  const current = rawCurrent.map((f) => ({ ...f, geometry: polishGeometry(f.geometry, centre) }));

  /* THE FULL-TRACK SWATH: USE GDACS'S OWN.
   *
   * It publishes one pre-merged corridor per threshold — the whole track,
   * nose to tail, with properly rounded end caps — and this file spent two
   * commits rebuilding that from the per-timestep footprints with an
   * occupancy grid. The reconstruction is kept ONLY as a fallback for a
   * payload that lacks the merged features, because a source that has
   * surprised us twice may yet publish a storm without them, and a stack of
   * timestep footprints is still better than a blank layer (§5).
   *
   * Preferring the source's own product is also the right call on accuracy:
   * ours is a grid trace of shapes GDACS drew, so it can only ever be a
   * lossy copy of the thing sitting next to it in the same response. */
  const swathMerged = (swathBands.length ? swathBands : mergeSwath(bands))
    .map((f) => ({ ...f, geometry: simplifyGeometry(f.geometry) }));
  if (!swathBands.length && bands.length) {
    console.info(`[landfall] ${storm.id}: no published GDACS swath; rebuilding from timesteps`);
  }

  /* Count what is actually DRAWN, not what was parsed — `bands` now carries
   * published density, since simplification moved to the exits. */
  const keptCount =
    [...current, ...swathMerged, ...cone].reduce((n, f) => n + countCoordinates(f.geometry), 0);
  if (rawCount) {
    console.info(
      `[landfall] ${storm.id}: GDACS geometry ${features.length} features, ` +
      `${rawCount} coords in → ${keptCount} drawn`
    );
  }

  /* THE ISSUE TIME, taken from a centre dot.
   *
   * Every dot repeats it identically in `polygondate` (confirmed live across
   * all 11), which is exactly why that field must not be read as a per-point
   * time — but it makes it the right place to read the issue from. The cone
   * carries the same value and is the fallback. */
  const issueMs =
    timeOf(features.find((f) => f?.properties?.featuretype === GDACS_GEOMETRY.pointRadiiType)
      ?.properties) ?? timeOf(cone[0]?.properties);

  /* The centre dots. Split into forecast and past against the issue time,
   * timestamped, and carrying GDACS's own intensity code — with a REAL
   * Saffir-Simpson category on the analysis dot, the one position with a
   * published wind speed behind it. */
  const { forecastPoints, pastPoints, forecast } = Number.isFinite(issueMs)
    ? parseGdacsPoints(features, issueMs, storm)
    : { forecastPoints: [], pastPoints: [], forecast: [] };

  if (!Number.isFinite(issueMs) && features.length) {
    console.warn(`[landfall] ${storm.id}: GDACS issue time unreadable; track points skipped`);
  }

  const layers = {
    cone: cone.length ? okSlot(cone) : NONE(),
    forecastTrack: forecastTrack.length ? okSlot(forecastTrack) : NONE(),
    pastTrack: pastTrack.length ? okSlot(pastTrack) : NONE(),
    windCurrent: current.length ? okSlot(current) : NONE(),
    windSwath: swathMerged.length ? okSlot(swathMerged) : NONE(),
    forecastPoints: forecastPoints.length ? okSlot(forecastPoints) : NONE(),

    /* Filled, though nothing draws it yet — no past-points layer exists for
     * either source. Carrying the data costs nothing and means the layer,
     * when it lands, needs no change here. */
    pastPoints: pastPoints.length ? okSlot(pastPoints) : NONE(),

    /* Products GDACS genuinely does not publish. `none` is the honest state
     * and it is what makes the panel rows dim with a reason instead of
     * showing a fake error (§5). */
    watchWarning: NONE(),
    windPast: NONE(),
  };

  /* GDACS has no advisory number. `polygondate` on the cone/bands is the
   * closest equivalent to NHC's filedate, so the panel's "as of" line has
   * something true to show rather than nothing. */
  const stampMs =
    issueMs ??
    timeOf(cone[0]?.properties) ??
    (bands.length ? Math.min(...bands.map((f) => f.properties._gdacsTime).filter(Boolean)) : null);

  return {
    layers,
    /* Real now. Feeds closestApproach() in data/home.js, which GDACS storms
     * were locked out of for as long as this was an empty array. */
    forecast,
    stamp: { advisnum: null, filedate: Number.isFinite(stampMs) ? stampMs : null },
    fetchedAt: new Date().toISOString(),
  };
}

export { bandFromFeature as _bandFromFeature, splitPair as _splitPair };
