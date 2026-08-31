/*
 * forecast-now.js — "now" is where the storm IS, not where its forecast began.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * Three published clocks describe one storm and they do not agree:
 *
 *   - CurrentStorms.json    the storm feed. Freshest position we ever hold.
 *   - past track / points   the MapServer's record. Behind the feed.
 *   - forecast track/points  the MapServer's projection. Behind BOTH, because
 *                            its first hour is an ANALYSIS hour, not a
 *                            publication time.
 *
 * MEASURED, on the archived bytes of 2026-08-21T23:30Z (samples/lala-cp012026):
 *
 *   storm feed      advisory 038, 21:00Z, 28.6N 170.4W
 *   past points     published 21:04Z, newest fix 18:00Z at 28.1N 170.7W
 *   forecast points advisory 36A, published 12:02Z, tau-0 valid 09:00Z at
 *                   26.9N 171.2W — and tau-12 valid 18:00Z at 28.1N 171.3W
 *
 * Read that last line twice. The forecast is not WRONG. Its tau-12 verified —
 * it named 28.1N at 18Z and the record put the storm at 28.1N at 18Z. The
 * forecast has simply been overtaken: its first two hours are now history and
 * are still being drawn as future.
 *
 * ==> WHAT THAT LOOKED LIKE ON GLASS <==
 * The white ring is drawn on the lowest-tau forecast point (map/layers/
 * points-forecast.js `stampFirst`), so it sat at 26.9N — 117 miles behind the
 * storm. lib/trackline.js then joined the end of the record to the start of the
 * forecast, so the dotted history climbed to its own newest fix at 28.1N and
 * DOUBLED BACK 83 miles to reach the ring. The return leg lies half a degree
 * from the outbound one, so it reads as a single line that ran too far and
 * stopped beside the second forecast dot. Aaron reported exactly that, and
 * spotted that the thing beside that dot was itself a real position. It was:
 * the 18Z fix. Confirmed on Lala AND Moke from archived bytes, so it was every
 * NHC storm, not one.
 *
 * ==> THE RULE <==
 * A forecast hour that has already passed is not a forecast. It is dropped.
 * The storm's true current position becomes the one and only tau-0, and both
 * the forecast line and the history join THERE.
 *
 * ==> AND "PASSED" MEANS THE CLOCK OR THE GROUND, EITHER ONE. <== §7.14, added
 * 2026-08-22. The clock test above was the whole rule and it was half of one.
 *
 * MEASURED on the 13:04Z archive of that day, direct from NOAA's ArcGIS:
 *
 *   Lala  feed advisory 040, 09:00Z, 30.3N 172.0W
 *         cone / forecast track / forecast points — advisory 039, filed 03:27Z
 *         advisory 039's tau-12 is 30.1N 171.2W, valid 12:00Z
 *
 * Noon had not happened. The clock test kept it. But advisory 39 forecast Lala
 * to crawl at 8 kt and she did 13.5 — the record's own 00Z and 06Z fixes say
 * so — so by 09:00Z she stood 43 nm BEYOND where noon was supposed to put her.
 * The re-anchored line ran current -> noon on a bearing of 106° and then turned
 * 210° back to 316°, which drew as a hairpin beside the white ring. Aaron
 * reported it on glass at 07:53 local, screenshot 4953.
 *
 * The fault needs a storm OUTRUNNING its own forecast, which is why it did not
 * exist until Lala accelerated. It also self-heals: once noon aged past
 * `expiryGraceMs` the clock test caught it after all. A four-hour window every
 * cycle, and invisible from any capture taken outside one.
 *
 * ==> WHAT THIS FILE REFUSES TO DO <==
 * It never trims the RECORD. The tempting fix was to cut the past track back
 * to the forecast's start so the picture tidies itself, and that would have
 * deleted the storm's two most recent real positions to make a line look
 * neat — the confident-wrong failure §5 exists to prevent. History is kept
 * whole and the stale claims about the future are what go.
 *
 * It also never invents a reading. The new tau-0 takes its POSITION and its
 * CLASSIFICATION from the SAME feed — the storm feed — so the ring cannot say
 * one thing while the panel above it says another. The newest published past
 * fix is the fallback for a source that states no classification of its own.
 * Nothing here computes a category from a wind field.
 *
 * ==> WHY THE RECORD LOST THAT JOB, 2026-08-31. <== It held it until Aaron
 * found Five in the Gulf drawn as a teal dot with no letters in it while the
 * panel two inches below called it a tropical depression. Both were reading
 * NHC honestly; NHC was saying two things:
 *
 *   storm feed    classification "TD", 30 kt, 18:00Z
 *   past points   newest fix `stormtype: "LO"` — a low — 12:00Z, no words
 *
 * The record's classification lags its own positions, and this dot is not a
 * record position: it is the FEED's position, planted here because the feed is
 * fresher. Taking the colour from a layer six hours behind the coordinates it
 * is colouring was the mismatch. The panel reads `storm.nature` and
 * `storm.category`; the ring now reads the same two published facts, from the
 * same hour, so the two can no longer disagree because one of them is LAGGING.
 *
 * ==> AND THAT IS THE WHOLE CLAIM — SAID EXACTLY, BECAUSE THE OBVIOUS STRONGER
 * ONE IS FALSE. <== The panel and the ring still weigh those two facts in
 * OPPOSITE ORDERS: `categoryColor` asks the classification first and the
 * number second, `trackPointReading` asks the number first and falls back to
 * the classification. Swept across every code the feed publishes crossed with
 * 25/45/120 kt, the two match on every combination where the code and the wind
 * agree with each other — which is every real observation, because NHC does
 * not publish a 45 kt tropical depression — and part company only on
 * combinations that contradict themselves. That residue was not introduced
 * here and is not worth a branch nobody can point at real bytes for (§5:
 * measure before building). It is written down so the next person to find it
 * knows it was found, weighed and left.
 *
 * EVERY GUARD BAILS WHOLE. If the points and the line disagree, or a time is
 * missing, or the feed has no position, the bundle is returned exactly as it
 * arrived. A half-applied re-anchor — points moved, line not — would be a
 * worse picture than the one this fixes.
 *
 * Pure functions. No DOM, ever. Imports: config/ only.
 */

import { FORECAST_NOW } from '../config/constants.js';
import { alongTrackNm } from './geo.js';

/* --------------------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------------------ */

/** A finite number, or null. Blank, null and undefined all become null rather
 *  than 0 — see the guard in `reanchorNow` for why that distinction matters. */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Shortest longitude separation, so a storm sitting on the antimeridian
 *  compares +179.9 against -179.9 as 0.2° and not 359.8°. */
function dLon(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Are two published coordinates the SAME fix? A float-equality test, not a
 *  proximity test — see FORECAST_NOW.matchEps. */
function samePoint(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return dLon(a[0], b[0]) <= FORECAST_NOW.matchEps
    && Math.abs(a[1] - b[1]) <= FORECAST_NOW.matchEps;
}

/** The newest past point, by NHC's own `dtg` (YYYYMMDDHH, monotonic as a
 *  number). Used for the ring's CLASSIFICATION only — never its position,
 *  which always comes from the storm feed because the feed is fresher. */
function newestPastPoint(bundle) {
  const slot = bundle?.layers?.pastPoints;
  if (slot?.status !== 'ok') return null;
  let best = null;
  for (const f of slot.fc?.features || []) {
    const dtg = Number(f?.properties?.dtg);
    if (!Number.isFinite(dtg)) continue;
    if (!best || dtg > best.dtg) best = { dtg, f };
  }
  return best?.f || null;
}

/**
 * The classification fields for the new tau-0, taken from the STORM FEED —
 * the same feed the dot's coordinates came from. Null when the source states
 * no classification of its own, which sends the caller to `readingFrom` below.
 *
 * ==> THIS WRITES NHC'S OWN CODE, NOT A COLOUR AND NOT A NAME. <== SPEC §4:
 * trust the source's label for what kind of thing it is, derive only the
 * number. `lib/track-point.js` already knows every code the feed publishes —
 * `TD`/`SD`/`STD`/`TS`/`SS`/`STS` grade, `HU`/`MH` defer to the number,
 * `PT`/`EX` keep the loud hue, `PC`/`PTC`/`LO`/`DB`/`WV` are ungraded — so
 * handing it the code rather than a decision means one table decides what a
 * classification means and this file never gets a second opinion.
 *
 * A code that table does not recognise lands on the quiet ungraded hue, which
 * is the same place an unrecognised code lands everywhere else and is the
 * right default: a code we cannot read is not evidence of severity (§5).
 *
 * `ssnum`, and ALWAYS written even when it is 0. Below hurricane strength the
 * number carries nothing — the code answers — but the template it is spread
 * over is a stale forecast hour carrying its own `ssnum`, and a key we decline
 * to write is a key that stale value keeps. `category` is our normalized index
 * (0 = TD, 1 = TS, 2..6 = Cat 1..5); NHC's `ssnum` is the Saffir-Simpson
 * number itself, so it is one lower and only exists from Cat 1 up.
 *
 * `maxwind` is the exception and is written only when the feed has one, for
 * the reason `readingFrom` gives: a key spread as `undefined` blanks the
 * template's copy, and this one feeds the mesh ridge's height rather than any
 * colour.
 */
function readingFromStorm(storm) {
  const code = String(storm?.raw?.classification || '').trim().toUpperCase();
  if (!code) return null;
  const cat = storm?.category;
  const out = {
    stormtype: code,
    ssnum: Number.isFinite(cat) && cat >= 2 ? cat - 1 : 0,
    /* Same reason as `readingFrom`: the stale advisory's WORDS for its
     * analysis hour describe a storm that has moved on, and `tcdvlp` is read
     * before `stormtype`, so carrying it would beat the code we just set. */
    tcdvlp: null,
  };
  const kt = num(storm?.windKt);
  if (kt != null) out.maxwind = kt;
  return out;
}

/** The classification fields for the new tau-0, taken from the newest
 *  published fix. THE FALLBACK since 2026-08-31 — see `readingFromStorm`
 *  above, and the header for what the record's lag cost on glass. Still the
 *  whole answer for a source that publishes positions and no classification
 *  with them.
 *
 *  Only keys we actually HAVE are returned: spreading a key
 *  whose value is `undefined` would blank the template's copy of it, which is
 *  how the ring would end up uncoloured on a source that omits one field.
 *
 *  `ssnum` not `ss` — forecast points spell it `ssnum` and lib/track-point.js
 *  `categoryIndexOf` reads that name first, so writing `ss` here would leave
 *  the STALE `ssnum` from the template winning. */
function readingFrom(pastPoint) {
  const p = pastPoint?.properties;
  if (!p) return {};
  const out = {};
  if (Number.isFinite(p.ss)) out.ssnum = p.ss;
  if (p.stormtype != null) out.stormtype = p.stormtype;
  if (Number.isFinite(p.intensity)) out.maxwind = p.intensity;
  /* The forecast's own words for its analysis hour describe a storm that has
   * moved on. Cleared rather than carried, so `trackPointReading` falls to
   * `stormtype` above — the code from the fix we are actually standing on. */
  out.tcdvlp = null;
  return out;
}

/* --------------------------------------------------------------------------
 * THE RE-ANCHOR
 * ------------------------------------------------------------------------ */

/**
 * Move "now" onto the storm's real position and drop the forecast hours that
 * have already passed.
 *
 * MUST RUN BEFORE lib/trackline.js `smoothTracks`, which joins the record to
 * whatever the forecast's first point is. Run it after and the join is made
 * against the stale hour this function exists to remove.
 *
 * @param {object} bundle  the layer bundle
 * @param {object} storm   normalized storm (data/nhc.js) — lon, lat, observedAt
 * @param {number} nowMs   wall clock, injected so the suite can pin it
 * @param {string} label   storm name, for the console only
 * @returns {object} a new bundle, or the SAME bundle untouched
 */
export function reanchorNow(bundle, storm, nowMs = Date.now(), label = 'storm') {
  const ptsSlot = bundle?.layers?.forecastPoints;
  const trkSlot = bundle?.layers?.forecastTrack;
  if (ptsSlot?.status !== 'ok') return bundle;

  const feats = (ptsSlot.fc?.features || []).filter((f) => f?.geometry?.type === 'Point');
  if (feats.length < 2) return bundle;

  /* ==> `Number(null)` IS 0, NOT NaN, AND 0,0 IS A REAL PLACE. <== A storm whose
   * feed position had not arrived would have had its ring planted in the Gulf
   * of Guinea by an `isFinite` test alone. Caught by the suite, not on glass. */
  const lon = num(storm?.lon);
  const lat = num(storm?.lat);
  if (lon == null || lat == null) return bundle;

  /* HOW MANY LEADING HOURS HAVE GONE. Walking from the front and stopping at
   * the first live hour, rather than filtering: a source that published its
   * taus out of order would otherwise have a hole cut out of the middle of its
   * forecast, and the line — which has no times on it at all — could not
   * follow.
   *
   * ==> TWO WAYS AN HOUR CAN BE GONE, AND THE CLOCK IS ONLY ONE OF THEM. <==
   * §7.14. The second is the ground: when the forecast layers are an advisory
   * older than the position — routine, measured at 6 h on Lala and 28 h on Moke
   * on 2026-08-22 — a storm moving faster than its own forecast said it would
   * is already past the next forecast hour's POSITION while that hour is still
   * in the FUTURE. Lala's advisory 39 named 30.1N 171.2W for noon; the feed had
   * her at 30.3N 172.0W at 09:00Z, 43 nm beyond it, three hours early. The
   * clock test kept noon and the line ran backwards to reach it.
   *
   * The heading is NHC's own published motion and nothing else. Deriving one
   * from the forecast points would be asking the suspect for its own alibi;
   * deriving one from the last two fixes is a chord across a 0.1° grid and came
   * out 44° from the published number on the very storm this was measured on.
   * With no published heading the ground test simply does not run and the clock
   * test stands alone — which is exactly today's behaviour, so a source that
   * states no motion loses nothing. */
  const cutoff = nowMs - FORECAST_NOW.expiryGraceMs;
  const heading = num(storm?.headingDeg);
  let expired = 0;
  while (expired < feats.length) {
    const f = feats[expired];
    const t = f?.properties?._time;
    const clockGone = Number.isFinite(t) && t <= cutoff;
    /* Read by index, never spread. NHC serves 2-element coordinates today, but
     * GeoJSON allows a third (elevation), and spreading would slide it into the
     * heading argument — which reads as a heading of 0 rather than failing. */
    const c = f?.geometry?.coordinates;
    const along = Array.isArray(c) ? alongTrackNm(lon, lat, c[0], c[1], heading) : null;
    const groundGone = along != null && along < -FORECAST_NOW.behindGraceNm;
    if (!clockGone && !groundGone) break;
    expired++;
  }

  if (expired === 0) return bundle;

  /* ==> AN ENTIRELY EXPIRED FORECAST IS NOT THIS FILE'S PROBLEM. <== That is a
   * publisher who has stopped, and lib/silence.js already has a name for it and
   * a badge that says so. Dropping every point here would blank the forecast
   * with no explanation attached, which is the §5 silence failure. Said out
   * loud so it is visible when it happens. */
  if (expired >= feats.length) {
    console.warn(
      `[landfall] ${label}: every published forecast hour has already passed. ` +
      'Drawing the forecast as published; the staleness badge is what says it is old.'
    );
    return bundle;
  }

  /* THE FORECAST LINE, TRIMMED BY COORDINATE AND NOT BY COUNT. The line carries
   * no times, so the only honest way to find its expired head is to check that
   * its leading vertices ARE the expired points. A source whose line and points
   * came from different advisories fails this and the whole re-anchor is
   * abandoned. */
  let trackFc = null;
  if (trkSlot?.status === 'ok') {
    const line = (trkSlot.fc?.features || []).find((f) => f?.geometry?.type === 'LineString');
    if (line) {
      const coords = line.geometry.coordinates.slice();
      let dropped = 0;
      while (dropped < expired && coords.length > 1
        && samePoint(coords[0], feats[dropped].geometry.coordinates)) {
        coords.shift();
        dropped++;
      }
      if (dropped !== expired) {
        console.warn(
          `[landfall] ${label}: the forecast line does not begin with the hours ` +
          `that have already passed (matched ${dropped} of ${expired}). Leaving ` +
          'the forecast as published rather than moving half of it.'
        );
        return bundle;
      }
      coords.unshift([lon, lat]);
      trackFc = {
        ...trkSlot.fc,
        features: trkSlot.fc.features.map((f) => (f === line
          ? { ...f, geometry: { ...f.geometry, coordinates: coords } }
          : f)),
      };
    }
  }

  /* THE NEW TAU-0. Identity fields come from the hour it replaces — basin,
   * stormnum, idp_source, advisnum, _stormId, _stormName — so grouping, tap
   * targets and label placement all keep working unchanged. Only the position,
   * the time and the reading are new. */
  const template = feats[expired - 1];
  const observedAt = Date.parse(storm?.observedAt ?? '');
  const nowPoint = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      ...(template.properties || {}),
      ...(readingFromStorm(storm) ?? readingFrom(newestPastPoint(bundle))),
      tau: 0,
      _time: Number.isFinite(observedAt) ? observedAt : (template.properties?._time ?? null),
      /* This dot is an OBSERVATION wearing a forecast point's clothes. Stamped
       * so anything downstream that needs to say so can, without re-deriving
       * the comparison that got us here. */
      _now: true,
    },
  };

  const layers = {
    ...bundle.layers,
    forecastPoints: {
      ...ptsSlot,
      fc: { ...ptsSlot.fc, features: [nowPoint, ...feats.slice(expired)] },
    },
  };
  if (trackFc) layers.forecastTrack = { ...trkSlot, fc: trackFc };

  return { ...bundle, layers };
}

/* Exported for tools/test-forecast-now.mjs only. Kept here rather than
 * duplicated in the test so the suite exercises the shipped maths. */
export const __internals = {
  num, dLon, samePoint, newestPastPoint, readingFrom, readingFromStorm,
};
