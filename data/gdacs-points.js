/**
 * gdacs-points.js — GDACS centre dots → forecast and past track points.
 *
 * EVERY FIELD HERE WAS READ OFF LIVE BYTES (2026-07-24, NOUL-26 eventid
 * 1001294 episode 6, all 12 "Point" features dumped together). Nothing is
 * inherited, and the one claim that WAS inherited — "the centre dots carry no
 * forecast times" — is false. They carry two independent statements of their
 * time.
 *
 * WHAT THE PAYLOAD ACTUALLY HOLDS, per storm:
 *   - 1 `Point_Centroid`  — the current position, a true GeoJSON Point, no
 *     time. NOT a track point.
 *   - 11 `Point_Polygon_Point_N` — the track, N chronological from 0. Each is
 *     a 129-vertex POLYGON (a circle of radius 0.03°), not a point.
 *   - 10 `Line_Line_N` segments chaining those 11 in order, each labelled
 *     with an intensity code (TD / TS / HU).
 *
 * The measured cadence is asymmetric and worth knowing before reading a
 * track: PAST points are 6 h apart, FORECAST points are 12 h apart.
 *
 * WHY SPLIT AT THE ISSUE TIME RATHER THAN AT N=5. The dots' `Class` suffix
 * happens to put the current fix at index 5 on this storm, but that is a
 * property of this storm's age, not of the format. Every dot repeats the
 * issue time in `polygondate`, so the split is computed from the data. A
 * storm three hours old would have fewer past points and the index would
 * move; a hardcoded 5 would then draw history as forecast.
 *
 * No DOM, ever. Imports: config/, lib/.
 */

import { GDACS_GEOMETRY } from '../config/constants.js';
import { parseGdacsPointTime } from '../lib/time.js';
import { categoryFromKt, categoryDotCode } from '../lib/category.js';
import { jtwcWindKtAt } from '../lib/jtwc-wind.js';

/**
 * Bounding-box centre of a ring'd geometry.
 *
 * Exact for the symmetric circles GDACS draws, and it does not care how many
 * vertices they use or whether they switch to a Point later — both collapse
 * to the same answer. Verified against the payload: every dot's box centre
 * reproduces the published position to 4 decimals, and dot 5's centre equals
 * both the `Point_Centroid` and the event feed's own coordinates.
 */
function centreOf(geometry) {
  if (geometry?.type === 'Point') {
    const [x, y] = geometry.coordinates || [];
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  const rings =
    geometry?.type === 'Polygon' ? geometry.coordinates
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates.flat()
        : null;
  if (!rings?.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Is this feature one of the timestep dots? The centroid shares the "Point"
 *  family but carries neither featuretype nor key, and must not join the
 *  track — it would land a second dot on top of the current fix. */
function isTimestepDot(props) {
  return (
    props?.featuretype === GDACS_GEOMETRY.pointRadiiType &&
    String(props?.Class || '').startsWith(GDACS_GEOMETRY.pointClassPrefix)
  );
}

const near = (a, b) =>
  Math.abs(a[0] - b[0]) <= GDACS_GEOMETRY.pointJoinEpsilonDeg &&
  Math.abs(a[1] - b[1]) <= GDACS_GEOMETRY.pointJoinEpsilonDeg;

/**
 * Collect the track segments as {from, to, code}.
 *
 * The code is GDACS's own `polygonlabel` on the segment — TD, TS or HU. It is
 * kept RAW here rather than expanded to prose, because it is about to be
 * drawn inside a dot two characters wide.
 */
function trackLegs(features) {
  const legs = [];
  for (const f of features) {
    const p = f?.properties || {};
    if (!String(p.Class || '').startsWith(GDACS_GEOMETRY.linePrefix)) continue;
    const coords = f.geometry?.type === 'LineString' ? f.geometry.coordinates : null;
    if (!coords || coords.length < 2) continue;
    const code = String(p.polygonlabel || '').trim().toUpperCase();
    legs.push({ from: coords[0], to: coords[coords.length - 1], code });
  }
  return legs;
}

/**
 * Intensity code for a position, from the leg ARRIVING at it.
 *
 * WAS THE LEAVING LEG, AND THAT SHIFTED THE WHOLE TRACK ONE STEP EARLY.
 * Caught on glass 2026-07-24: NOUL-26's dots read HU where GDACS had it
 * still at tropical-storm strength, and the current position read HU while
 * three other sources said TS.
 *
 * The arriving leg is the right one because it spans the interval that ENDS
 * at this position — it describes the storm becoming what it is here. The
 * leaving leg describes what happens next, which belongs to the next dot.
 * At the analysis position specifically, the arriving leg is observed
 * history while the leaving one is forecast, and this dot is asking "what is
 * it now".
 *
 * The FIRST dot has no arriving leg and takes its outgoing one — the
 * alternative is a track that starts blank, which reads as missing data
 * rather than as the boundary it is.
 *
 * NOTE `Line_N` IS NOT CHRONOLOGICAL. Measured: the suffixes are grouped by
 * intensity (0-2 HU, 3-4 TD, 5-9 TS on NOUL-26). Legs are matched by
 * COORDINATE here and the suffix is never read, so the grouping is harmless
 * — but anything new that sorts on it will silently scramble the track.
 *
 * Returns null when nothing matches. Null is drawn as an uncoded dot, never
 * as a borrowed neighbour's intensity.
 */
function codeAt(legs, position) {
  for (const leg of legs) if (near(leg.to, position)) return leg.code || null;
  for (const leg of legs) if (near(leg.from, position)) return leg.code || null;
  return null;
}

/**
 * Category index for a dot.
 *
 * TWO DIFFERENT READINGS, and the difference is the whole point:
 *
 *  - THE ANALYSIS DOT (the current fix) gets a REAL Saffir-Simpson category,
 *    derived from the storm's own published wind speed. It is the only dot
 *    with a wind number attached to it, and it uses the same derivation the
 *    storm marker already uses, so the dot and the glyph on top of it cannot
 *    disagree.
 *  - EVERY OTHER DOT gets GDACS's own intensity code and nothing more. TD and
 *    TS map onto our first two colors; HU maps to NOTHING, because GDACS's
 *    strongest band is the hurricane threshold itself and a Cat 1 is
 *    indistinguishable from a Cat 5 in what it publishes. The dot says HU and
 *    stays generic rather than claiming a category (§6).
 *
 * Returns {index, code} where index may be null. Code and index are decided
 * together, here, so the text inside a dot and the color of that dot cannot
 * come from different readings.
 */
function readingFor(code, isAnalysis, storm) {
  /* THE ANALYSIS DOT TAKES THE STORM'S OWN CLASSIFICATION, so the dot sitting
   * at the current position and the storm's row in the list cannot disagree.
   *
   * It used to derive a Saffir-Simpson category from `severity`, which is the
   * forecast PEAK — that put a Cat 2 badge on a tropical storm, visibly
   * outside its own hurricane-force wind field. Both readings now come from
   * `severitytext` (data/gdacs.js) — or, when JTWC is warning on the storm,
   * from JTWC's measured wind, which `applyJtwcWind` has already written into
   * `storm.category` and `storm.categoryCode` by the time this runs. Either
   * way this line stays correct by reading the storm rather than the source. */
  if (isAnalysis && storm?.categoryCode) {
    return { index: storm.category ?? null, code: storm.categoryCode };
  }
  const map = GDACS_GEOMETRY.trackIntensityIndex;
  if (code && Object.prototype.hasOwnProperty.call(map, code)) {
    return { index: map[code], code };
  }
  return { index: null, code: code || null };
}

/**
 * A measured wind for one dot, and the reading that goes with it — or null.
 *
 * ==> THE BUG THIS CLOSES <==
 * GDACS labels each track leg with one of three codes, and its strongest, HU,
 * spans a marginal Cat 1 to a super typhoon. Every HU dot therefore drew in
 * the generic hurricane hue and lifted the cage by `representativeKt`'s
 * ~109 kt — the middle of the whole hurricane range. Live on DOLPHIN
 * (2026-07-28): a 45 kt tropical storm whose forecast legs were labelled HU,
 * standing taller than a measured NHC Cat 3 for its entire track.
 *
 * JTWC publishes a wind at every forecast hour, on the same synoptic clock
 * these dots sit on. Where one lines up, the dot gets a REAL number and a real
 * Saffir-Simpson reading derived from it.
 *
 * ==> WHY THE READING MOVES WITH THE WIND, NOT SEPARATELY <==
 * §9: elevation and colour are one signal from one number. Lifting a bead to
 * 145 kt while its dot still says "HU" in the unknown-hurricane grey would be
 * two channels reading two different sources at the same position — worse than
 * the problem being fixed, because it would look deliberate. So a dot that
 * takes JTWC's wind takes JTWC's category too, and starts drawing "5" instead
 * of "HU".
 *
 * ==> PAST DOTS GET NOTHING, AND THAT IS NOT AN OVERSIGHT <==
 * A JTWC warning contains the current analysis and the forecast ladder. It has
 * no history. `jtwcWindKtAt` returns null for anything before the fix, so past
 * dots keep GDACS's own leg codes and the derived midpoint. The past ridge
 * stays honestly coarse rather than borrowing the tau-0 wind backwards across
 * a storm's whole life.
 */
function jtwcReadingAt(storm, timeMs) {
  const kt = jtwcWindKtAt(storm, timeMs);
  if (kt == null) return null;
  const index = categoryFromKt(kt);
  if (index == null) return null;
  return { windKt: kt, index, code: categoryDotCode(index, 'tropical') };
}

/**
 * Parse a GDACS geometry payload's centre dots.
 *
 * @param {Array} features raw GeoJSON features from the geometry endpoint
 * @param {number} issueMs the advisory issue time, epoch ms UTC
 * @param {object} storm the normalized storm (for its published wind speed)
 * @returns {{forecastPoints: Array, pastPoints: Array, forecast: Array}}
 */
export function parseGdacsPoints(features, issueMs, storm) {
  const legs = trackLegs(features);

  const dots = [];
  for (const f of features) {
    const p = f?.properties || {};
    if (!isTimestepDot(p)) continue;

    const centre = centreOf(f.geometry);
    if (!centre) continue;

    /* A dot whose time cannot be read is DROPPED, not placed. Position
     * without time is not a track point — it cannot be ordered, cannot be
     * labelled, and cannot feed closest-approach. A visible gap is the
     * honest outcome (§5). */
    const timeMs = parseGdacsPointTime(p.key, p.polygonlabel, issueMs);
    if (timeMs == null) continue;

    dots.push({ centre, timeMs, code: codeAt(legs, centre) });
  }

  /* Sorted by PARSED TIME, not by the Class suffix. The suffix is
   * chronological today; the times are chronological by construction. */
  dots.sort((a, b) => a.timeMs - b.timeMs);

  const firstForecast = dots.find((d) => d.timeMs >= issueMs);
  const analysisMs = firstForecast ? firstForecast.timeMs : null;

  const HOUR_MS = 3600 * 1000;
  const forecastPoints = [];
  const pastPoints = [];

  for (const d of dots) {
    const isAnalysis = analysisMs != null && d.timeMs === analysisMs;

    /* MEASURED FIRST, ALWAYS. A JTWC wind at this hour beats both GDACS's
     * three-word leg code and the storm-level classification, because it is
     * the only one of the three that is a measurement. When there is none, the
     * existing reading stands unchanged and this dot behaves exactly as it did
     * before the join existed. */
    const measured = jtwcReadingAt(storm, d.timeMs);
    const { index, code } = measured
      ? { index: measured.index, code: measured.code }
      : readingFor(d.code, isAnalysis, storm);

    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: d.centre },
      properties: {
        /* The render layer reads these three and needs no source knowledge.
         * `_catStamped` is what tells it to use them instead of hunting for
         * NHC's `ssnum`, which GDACS does not publish. */
        _catStamped: true,
        _catIndex: index,
        _catCode: code,
        _time: d.timeMs,
        /** A MEASURED wind in knots at this position, or absent.
         *
         *  Source-neutral by design, exactly like `_time` and `_catStamped`
         *  next to it: `lib/track-point.js windKtOf()` prefers this field over
         *  NHC's `intensity`/`maxwind` so one parser writes the answer and
         *  every consumer reads one field. Stamping NHC's field name onto a
         *  GDACS feature would have worked and would have been a lie about
         *  where the number came from.
         *
         *  Absent — not null — when there is no measurement, so the cage's
         *  fallback to the class midpoint keeps triggering on the same
         *  nullish test it always has. */
        ...(measured ? { _windKt: measured.windKt } : {}),
        /* Forecast hour relative to the analysis. Negative on past points.
         * Gives label placement a real ordering key rather than relying on
         * array order (see map/layers/points-forecast.js). */
        tau: analysisMs == null ? null : Math.round((d.timeMs - analysisMs) / HOUR_MS),
        /* Label placement groups by storm before deriving a spoke angle.
         * GDACS publishes none of the NHC fields it looks for, so without an
         * explicit key every GDACS label is treated as unattributable and
         * hidden. */
        _stormKey: storm?.id || null,
        /* The owning storm, for TAP TARGETING. Forecast points select their
         * storm now that the spiral glyph is retired (map/markers.js). Same
         * field name the NHC path stamps, so markers.js reads one property
         * and stays source-blind. */
        _stormId: storm?.id || null,
        _gdacsIntensity: d.code || null,
      },
    };

    (d.timeMs < issueMs ? pastPoints : forecastPoints).push(feature);
  }

  /* The shape closestApproach() reads (data/home.js). FORECAST ONLY — past
   * positions are history and would drag the "closest approach" backwards
   * into where the storm has already been.
   *
   * `windKt` is null on every point except the analysis one: GDACS publishes
   * no per-point wind, and closestApproach already degrades honestly to
   * distance-only when it is missing. Inventing a wind here to fill the
   * field would put a fabricated number on a decision screen. */
  const forecast = forecastPoints.map((f) => ({
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    time: new Date(f.properties._time).toISOString(),
    /* GDACS itself has no per-point wind anywhere on a track, INCLUDING the
     * analysis point: the only number it publishes is the forecast peak, and
     * putting a peak on a specific point would be a fabricated reading at a
     * specific time. So this stays null unless JTWC measured one at this exact
     * hour, in which case it is a real forecast wind from a real product and
     * closest-approach can finally say how strong the storm is expected to be
     * when it gets there. Where JTWC has nothing, closestApproach degrades to
     * distance-and-time exactly as before, which is honest (data/home.js). */
    windKt: f.properties._windKt ?? null,
    tau: f.properties.tau,
  }));

  return { forecastPoints, pastPoints, forecast };
}
