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
import { carqWindAt } from '../lib/carq.js';

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
 * §9: elevation and color are one signal from one number. Lifting a bead to
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
 * The same answer for a PAST dot, out of the storm's analysed history.
 *
 * ==> THIS IS WHAT THE PARAGRAPH ABOVE SAID COULD NOT BE DONE. <==
 * It was right about the warning and wrong about the agency: a JTWC warning
 * carries no history, but JTWC's `CARQ` rows in the TCGP a-deck are nothing
 * but history — one analysed position and wind every six hours, going back.
 * `data/carq.js` attaches them; `lib/carq.js` holds every rule.
 *
 * ==> IT TAKES A POSITION AS WELL AS A TIME, UNLIKE THE JTWC ONE. <==
 * That join is anchored by a name match on a single active warning, so the
 * storm is already established before a time is compared. This one is reading a
 * file that can outlive the storm it describes and can hold a system through
 * two renames, so place is the check that the wind belongs here at all. Both
 * guards live in `carqWindAt` and both prefer silence: no match leaves the dot
 * on exactly the reading it had before this existed.
 *
 * THE CATEGORY MOVES WITH THE WIND, for the same reason it does above — a bead
 * standing at a measured 100 kt while its dot reads "HU" in the unknown grey
 * would be two channels reading two different sources at one position.
 */
function carqReadingAt(storm, timeMs, coords) {
  const lon = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  const hit = carqWindAt(storm?.carq, timeMs, lon, lat);
  if (!hit) return null;
  const index = categoryFromKt(hit.windKt);
  if (index == null) return null;
  return { windKt: hit.windKt, index, code: categoryDotCode(index, 'tropical') };
}

/**
 * The storm's own measured wind, for the ANALYSIS dot specifically.
 *
 * ==> THE DOT UNDER THE HEAD MUST NOT DISAGREE WITH THE HEAD <==
 * The analysis dot sits at the storm's current position — the same place the
 * cage's head bead stands and the same place the marker is drawn. The head
 * uses `storm.windKt`. Without this, the dot fell through to the class
 * MIDPOINT, so a storm measured at 45 kt got a 45 kt head sitting on top of a
 * 49 kt bead, and a 120 kt storm got a 125 kt bead. Small numbers, but it is
 * §9's invariant breaking at the one position where two channels overlap
 * exactly, and a fixture caught it before glass did.
 *
 * It is NOT redundant with `jtwcReadingAt`. That matches on TIME, and the two
 * agencies' analysis hours are usually but not always the same — GDACS can
 * publish a 12Z analysis against JTWC's 18Z fix. This asks the storm what its
 * wind is rather than asking the clock whether the hours line up.
 *
 * Returns null when the storm has no measured wind, which is every GDACS storm
 * JTWC is not warning on — those keep the classification path unchanged.
 */
function measuredAnalysis(storm) {
  const kt = storm?.windKt;
  if (!Number.isFinite(kt)) return null;
  const index = categoryFromKt(kt);
  if (index == null) return null;
  return { windKt: kt, index, code: categoryDotCode(index, 'tropical') };
}

/**
 * Every timestep dot with a readable time, oldest first.
 *
 * Shared by `parseGdacsPoints` and `splitTrackLines` so the two can never
 * disagree about which position happened when — the whole argument of §32.6
 * is that ONE timeline decides both the dots and the lines between them.
 */
function timedDots(features, issueMs) {
  const dots = [];
  for (const f of features || []) {
    const p = f?.properties || {};
    if (!isTimestepDot(p)) continue;
    const centre = centreOf(f.geometry);
    if (!centre) continue;
    const timeMs = parseGdacsPointTime(p.key, p.polygonlabel, issueMs);
    if (timeMs == null) continue;
    dots.push({ centre, timeMs });
  }
  dots.sort((a, b) => a.timeMs - b.timeMs);
  return dots;
}

/** The first dot at or after the issue time — the storm's current fix. Null
 *  when no dot reaches the issue, which is a payload we cannot reason about. */
function analysisTimeOf(dots, issueMs) {
  const first = dots.find((d) => d.timeMs >= issueMs);
  return first ? first.timeMs : null;
}

/**
 * Sort the `Line_*` track segments into past and forecast.
 *
 * ==> GDACS'S OWN `forecast` FLAG IS THE FALLBACK, NOT THE ANSWER. <==
 *
 * MEASURED, EIGHTEEN-26 eventid 1001307 episode 5, archived 2026-08-21: all
 * ELEVEN of its segments carried `forecast: true`, including the four the
 * storm had already travelled. Every segment therefore landed in the forecast
 * slot, the past-track slot came back empty, and the whole track — history
 * included — drew in the forecast's confident solid line instead of the
 * dotted one history is entitled to (SPEC §7 line grammar). Caught on glass
 * by Aaron the same afternoon.
 *
 * THE PAYLOAD CONTRADICTS ITSELF AND ONE HALF OF IT IS TRUSTWORTHY. The same
 * response's timestep dots carry real per-point times in `key` and
 * `polygonlabel` (§32.4), and those put EIGHTEEN's first five positions
 * squarely before its own issue time. A segment's endpoints sit exactly on
 * two of those dots, so the dots can date the segment — and a date beats a
 * boolean that has been observed to be wrong.
 *
 * THE RULE: a segment is FORECAST when its EARLIER endpoint is at or after the
 * analysis position. The earlier endpoint rather than the first one in the
 * array, so a segment published backwards classifies the same either way —
 * nothing in the format promises a direction. The segment ARRIVING at the
 * analysis dot is past, because the storm has already travelled it; the one
 * LEAVING it is forecast. They share that vertex, which is what makes the two
 * halves meet at the current position rather than overlapping or gapping.
 *
 * A SEGMENT WE CANNOT DATE KEEPS GDACS'S FLAG. An endpoint that matches no
 * dot, an unreadable issue time, or a payload whose dots never reach the issue
 * all fall back to what the source said. Overriding evidence we have is right;
 * inventing evidence we do not is the §5 failure pointed inward.
 *
 * VERIFIED AGAINST FOUR LIVE STORMS in one archived hour: LALA-26 (45
 * segments), SAUDEL-26 (21) and TWO-C-26 (12) agree with the published flag on
 * every single segment and nothing moves. EIGHTEEN-26 moves four. The
 * correction is not a second opinion applied everywhere — it is a repair that
 * fires only where the source is self-contradictory.
 *
 * @param {Array} features raw GeoJSON features from the geometry endpoint
 * @param {number} issueMs the advisory issue time, epoch ms UTC
 * @param {string} [label] the storm id, for the console line. Reporting lives
 *   HERE rather than at the call site because the two counters exist only to
 *   be said out loud — split them from their sentence and the next caller
 *   quietly drops it.
 * @returns {{pastTrack: Array, forecastTrack: Array, corrected: number,
 *            undated: number}}
 */
export function splitTrackLines(features, issueMs, label = 'storm') {
  const dots = Number.isFinite(issueMs) ? timedDots(features, issueMs) : [];
  const analysisMs = analysisTimeOf(dots, issueMs);

  const timeAt = (position) => {
    for (const d of dots) if (near(d.centre, position)) return d.timeMs;
    return null;
  };

  const pastTrack = [];
  const forecastTrack = [];
  let corrected = 0;
  let undated = 0;

  for (const f of features || []) {
    const p = f?.properties || {};
    if (!String(p.Class || '').startsWith(GDACS_GEOMETRY.linePrefix)) continue;

    /* `forecast` arrives as a boolean on some payloads and as the STRING
     * "true"/"false" on others — a plain truthiness test would put every
     * segment in the forecast bucket, since "false" is a non-empty string. */
    const flagged = String(p.forecast) === GDACS_GEOMETRY.forecastTrue;

    const coords = f.geometry?.type === 'LineString' ? f.geometry.coordinates : null;
    const a = coords && coords.length >= 2 ? timeAt(coords[0]) : null;
    const b = coords && coords.length >= 2 ? timeAt(coords[coords.length - 1]) : null;

    let isForecast = flagged;
    if (analysisMs != null && a != null && b != null) {
      isForecast = Math.min(a, b) >= analysisMs;
      if (isForecast !== flagged) corrected++;
    } else {
      undated++;
    }

    (isForecast ? forecastTrack : pastTrack).push(f);
  }

  /* ==> A CORRECTION IS ANNOUNCED. <== GDACS disagreeing with itself is a fact
   * about the feed, and the map just quietly draws the right thing afterwards.
   * Silent repair is how the next session concludes the flag was reliable all
   * along. */
  if (corrected) {
    console.info(
      `[landfall] ${label}: GDACS mislabelled ${corrected} track segment(s) — ` +
      'dated them from the timestep dots instead (SPEC \u00a732.6)'
    );
  }
  if (undated) {
    console.info(
      `[landfall] ${label}: ${undated} track segment(s) could not be dated from ` +
      'the timestep dots; keeping GDACS\u2019s own forecast flag on those'
    );
  }

  return { pastTrack, forecastTrack, corrected, undated };
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

  /* ONE TIMELINE FOR THE DOTS AND THE LINES BETWEEN THEM. `timedDots` sorts by
   * PARSED TIME, not by the Class suffix — the suffix is chronological today;
   * the times are chronological by construction. A dot whose time cannot be
   * read is DROPPED there, not placed: position without time is not a track
   * point, and a visible gap is the honest outcome (§5). */
  const dots = timedDots(features, issueMs).map((d) => ({
    ...d,
    code: codeAt(legs, d.centre),
  }));

  const analysisMs = analysisTimeOf(dots, issueMs);

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
    /* THREE SOURCES, BEST FIRST, AND THE ORDER IS THE ARGUMENT.
     *
     *   1. The live WARNING, where its forecast hour lines up — the freshest
     *      thing JTWC has said about this hour.
     *   2. The storm's own wind on the ANALYSIS dot specifically, so the dot
     *      under the cage head cannot disagree with the head.
     *   3. The ANALYSED HISTORY, which is the only one of the three that can
     *      speak about a past hour at all.
     *
     * The warning outranks the history where both answer, because a warning is
     * this cycle's reading and a CARQ row for the same hour may be up to a day
     * old — though in practice they overlap only at tau 0, where they agree by
     * construction (measured on DOLPHIN: warning 60 kt, CARQ tau-0 60 kt, same
     * position to a tenth of a degree).
     *
     * When all three are silent the existing reading stands unchanged and this
     * dot behaves exactly as it did before any of these joins existed. */
    const measured =
      jtwcReadingAt(storm, d.timeMs) ??
      (isAnalysis ? measuredAnalysis(storm) : null) ??
      carqReadingAt(storm, d.timeMs, d.centre);
    /* ==> WHERE THE READING CAME FROM, RECORDED WITH IT (§49.3). <==
     * A measured index is OUR arithmetic on somebody's wind number
     * (`categoryFromKt`); `readingFor` returns GDACS's own leg code or the
     * storm's own published classification. Those are different provenances
     * and `lib/track-point.js normalizePastPoints` has to be able to tell them
     * apart — from outside this file, the two are one stamped integer and
     * indistinguishable. Nothing renders it yet; the past figures in §49 do.
     * Null when there is no index at all, matching data/nhc.js's convention
     * that a source only exists where an answer does. */
    const { index, code } = measured
      ? { index: measured.index, code: measured.code }
      : readingFor(d.code, isAnalysis, storm);
    const catSource = index == null ? null : measured ? 'derived' : 'reported';

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
        /** 'reported' (GDACS's own code, or the storm's classification) or
         *  'derived' (our Saffir-Simpson read of a JTWC or CARQ wind), or null
         *  when there is no index. See the note above. */
        _catSource: catSource,
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
        /* The display name, for label placement — the time labels are routed
         * around the storm's own name on the map and placement needs its
         * width. Same field the NHC path stamps, so
         * map/layers/points-forecast.js reads one property and stays
         * source-blind. */
        _stormName: storm?.name || null,
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
