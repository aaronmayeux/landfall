/**
 * season-windswath.js — the total footprint that ever saw storm-force wind,
 * for a finished storm. SPEC-SEASONS-BUILD.md §57.26, §57.27, §57.30 step 6b.
 *
 * ==> THIS IS THE ONE LAYER IN SEASONS WITH NO LIVE EQUIVALENT. <== The live
 * app draws a corridor that is part record and part forecast and is redrawn
 * every poll. This is a completed shape about a storm that finished: where
 * 34, 50 and 64 knot winds reached at ANY point in its life, merged into one
 * outline per threshold. §57.27 lists it as Seasons-only for that reason.
 *
 * ==> IT SHARES `lib/windswath.js`'s MATHS RATHER THAN COPYING IT. <== The
 * sweep — one branch of longitude, a planar frame, a cosine blend between the
 * four published quadrant radii — is the same problem here as it is live, and
 * it is a problem this project has already paid to get right twice (the seam
 * fault that made Lala a green ring, and the fold that made her walls cross).
 * A second copy would drift. What this file owns is the part that IS
 * different: turning HURDAT2's twelve radii columns into the timeline that
 * function wants.
 *
 * ==> AND NOAA'S OWN PUBLISHED SWATH IS NOT USABLE, WHICH IS MEASURED RATHER
 * THAN ASSUMED. <== `samples/ida-al092021/gis/best-track/AL092021_windswath.geojson`
 * exists and is the obvious shortcut. Measured 2026-08-24: its 34 kt polygon
 * is 1,070 vertices and **100% of its edges are axis-aligned** — a rasterized
 * staircase, the same garbage `lib/windswath.js` already refuses from the live
 * service. It is also a per-storm GIS download that only exists from 2008
 * (§57.9's third cliff), where the radii columns start in 2004. Building the
 * shape here is cheaper, smoother, and covers four more years.
 *
 * ==> THE RULE THAT MATTERS: MISSING RADII AND ZERO RADII ARE NOT THE SAME
 * THING, AND TREATING THEM THE SAME TEARS THE FOOTPRINT APART AT THE
 * LANDFALLS. <==
 *
 * NOAA inserts EXTRA records at landfalls and peaks, off the six-hour clock.
 * Those rows carry `-999` in all twelve radii columns — nobody wrote the wind
 * field down for that odd minute. `0,0,0,0` is a different statement: it was
 * written down, and there was no wind at that threshold.
 *
 * `lib/windswath.js` breaks a corridor at any timeline point with no ring,
 * which is exactly right for a zero — sweeping across an hour the agency
 * published as ring-free would claim wind the agency did not (§5). Applied to
 * a MISSING row it is exactly wrong: Katrina's three landfall records are all
 * `-999`, so a raw feed would snap her footprint into three pieces at the
 * three moments **the app is named after**.
 *
 * So a row with no radii group at all is DROPPED from the timeline, and the
 * corridor interpolates across it from the six-hourly neighbours either side —
 * which is what the sweep does between published points anyway. A row whose
 * groups are present and zero stays, and breaks the run.
 *
 * MEASURED 2026-08-24 across both HURDAT2 basins, 2004 onward: 90 such rows,
 * 85 of them off the six-hour clock, **73 of them landfalls**, sitting inside
 * the wind-field life of 41 storms. And the two kinds never mix on one row —
 * 24,087 rows carry all three groups, 90 carry none, and **zero carry some** —
 * so "did this row have radii at all" is one question, not three.
 *
 * Pure functions. No DOM, no network, no clock, no map. Imports config/ and
 * two siblings.
 */

import { SEASONS, WIND_SWEEP } from '../config/constants.js';
import { WIND_KT } from './wind.js';
import { sweepTimeline } from './windswath.js';

/** True when this record wrote a wind field down at all. `null` for every
 *  group is `lib/hurdat.js`'s answer to a row of `-999`s; an object of zeros
 *  is a real measurement of no wind. See the header. */
function hasRadiiGroups(point) {
  const r = point?.radii;
  return !!(r && (r.r34 || r.r50 || r.r64));
}

/** One threshold's four quadrant numbers, as the sweep wants them. A group
 *  that is present but partly null keeps its measured quadrants and reads the
 *  rest as zero — `lib/hurdat.js` keeps a partial group on purpose, and half a
 *  measurement is still a measurement.
 *
 *  ==> AN ALL-ZERO GROUP IS RETURNED, NOT DROPPED, AND THAT IS NOT WHERE THE
 *  MISSING-VERSUS-ZERO RULE LIVES. <== Written down because a mutation run on
 *  2026-08-24 proved it: returning null here instead changes NOTHING, because
 *  the sweep breaks a run both on a threshold whose key is absent and on one
 *  whose radii are all zero. The rule is carried entirely by
 *  `hasRadiiGroups` deciding whether the ROW enters the timeline at all. This
 *  stays as it is because it is the clearer statement of intent — but nobody
 *  should believe it is load-bearing, and a comment claiming it was is worse
 *  than no comment. */
function quadOf(group) {
  if (!group) return null;
  const out = {};
  for (const k of SEASONS.quadrantOrder) {
    const v = Number(group[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return out;
}

/**
 * Turn a parsed HURDAT2 storm into the timeline `sweepTimeline` wants.
 *
 * ==> IT DRAWS `lon`, NOT `lonU`, AND THAT IS NOT THE SAME CALL
 * `season-tracks.js` MADE. <== The track layer hands raw coordinates to
 * MapLibre and must unwrap them itself. The sweep runs `onOneBranch` at its
 * own door, over the complete ordered list, which is that function's stated
 * precondition — handing it already-unwrapped longitudes would put values past
 * ±180 into a function whose job is to produce them, and the result depends on
 * which of the two ran first. One unwrap, at one door.
 *
 * @param {object} storm  a `lib/hurdat.js` storm
 * @returns {Array<{lon:number, lat:number, quads:object}>}
 */
export function timelineFor(storm) {
  const out = [];
  for (const p of storm?.points || []) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    if (!hasRadiiGroups(p)) continue; /* see the header — the landfall rows */

    const quads = {};
    const q34 = quadOf(p.radii.r34);
    const q50 = quadOf(p.radii.r50);
    const q64 = quadOf(p.radii.r64);
    if (q34) quads[WIND_KT.KT34] = q34;
    if (q50) quads[WIND_KT.KT50] = q50;
    if (q64) quads[WIND_KT.KT64] = q64;

    out.push({ lon: p.lon, lat: p.lat, quads });
  }
  return out;
}

/**
 * The merged footprint features for one finished storm.
 *
 * Returns an EMPTY ARRAY for a storm the record never measured, and that is
 * not the same answer as "this storm had no wind field" — §57.25 puts the
 * difference in words on screen, and `lib/season-facts.js`'s
 * `missing.windField` is the flag that decides which sentence is said. Nothing
 * here guesses; a storm with no radii columns simply produces no shapes.
 *
 * ==> THE STORM'S ID GOES ON EVERY FEATURE. <== Focus is one paint property
 * keyed on `id` across the whole archive (`map/layers/season-focus.js`), and a
 * footprint that could not answer which storm it belonged to would be the one
 * archive shape focus could not reach.
 *
 * @param {object} storm  a `lib/hurdat.js` storm
 * @param {object} [opts] WIND_SWEEP, or a copy of it
 * @returns {Array} GeoJSON Polygon features, `properties.radii` in knots
 */
export function buildSeasonSwath(storm, opts = WIND_SWEEP) {
  const timeline = timelineFor(storm);
  if (timeline.length === 0) return [];

  const features = sweepTimeline(timeline, opts);
  for (const f of features) {
    f.properties.id = storm.id;
  }
  return features;
}
