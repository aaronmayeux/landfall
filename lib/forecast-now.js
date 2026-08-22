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
 * ==> WHAT THIS FILE REFUSES TO DO <==
 * It never trims the RECORD. The tempting fix was to cut the past track back
 * to the forecast's start so the picture tidies itself, and that would have
 * deleted the storm's two most recent real positions to make a line look
 * neat — the confident-wrong failure §5 exists to prevent. History is kept
 * whole and the stale claims about the future are what go.
 *
 * It also never invents a reading. The new tau-0 takes its POSITION from the
 * storm feed and its CLASSIFICATION from the newest published past point, so
 * the ring is coloured by the same fix that colours the last leg of the trail
 * behind it. Nothing here computes a category from a wind field.
 *
 * EVERY GUARD BAILS WHOLE. If the points and the line disagree, or a time is
 * missing, or the feed has no position, the bundle is returned exactly as it
 * arrived. A half-applied re-anchor — points moved, line not — would be a
 * worse picture than the one this fixes.
 *
 * Pure functions. No DOM, ever. Imports: config/ only.
 */

import { FORECAST_NOW } from '../config/constants.js';

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

/** The classification fields for the new tau-0, taken from the newest
 *  published fix. Only keys we actually HAVE are returned: spreading a key
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
   * follow. A missing `_time` stops the walk for the same reason. */
  const cutoff = nowMs - FORECAST_NOW.expiryGraceMs;
  let expired = 0;
  while (expired < feats.length) {
    const t = feats[expired]?.properties?._time;
    if (!Number.isFinite(t) || t > cutoff) break;
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
      ...readingFrom(newestPastPoint(bundle)),
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
export const __internals = { num, dLon, samePoint, newestPastPoint, readingFrom };
