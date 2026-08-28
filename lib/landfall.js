/**
 * landfall.js — where a storm's centre crossed a coastline.
 * SPEC-SEASONS-BUILD.md §57.7, §57.7a.
 *
 * Pure. No fetch, no fs, no DOM, no clock. Given a land lookup and a track,
 * say where the centre came ashore.
 *
 * ==> THIS FILE SHIPS TO PHONES NOW, AND THAT IS WHY THE RASTERISER IS NOT IN
 * IT. <== It used to say nothing here reaches a phone. That stopped being true
 * on 2026-08-28: the running season has no reviewed record, so the only way to
 * mark its landfalls is to answer the question on the device (§57.7b, Aaron's
 * call). The walk below is what ships. Building the mask — a scanline fill over
 * 480,000 coastline edges into a 119 MB array — moved to
 * `tools/land-raster.mjs` and stays on the monthly runner, because the phone
 * needs the ANSWER and not the machinery that produces it.
 *
 * ==> AND BOTH SIDES RUN THIS SAME WALK, DELIBERATELY. <== The archive's
 * answers and the running season's answers come out of the identical function
 * over an identical mask. A second implementation for the browser is exactly
 * how 1971 and 2026 would come to disagree about what a landfall is.
 *
 * ==> WHY THIS EXISTS AT ALL: NOAA'S OWN MARKER HAS A HOLE THE SIZE OF A
 * GENERATION. <== §57.7. The Atlantic best track carries no landfall marker at
 * all between 1971 and 1982 — twelve consecutive years — and the East Pacific
 * carries none from 1949 to 1988 but for a single storm in 1959. Measured on
 * the shipped files: 39 of 77 East Pacific seasons and 12 of 175 Atlantic ones
 * read as zero landfalls, and Liza in 1976 — which killed about a thousand
 * people at La Paz — has no `L` record in our own copy of the file.
 *
 * ==> AND IT IS THE ONLY INSTRUMENT THAT CAN ANSWER FOR THE WHOLE WORLD. <==
 * Aaron's call, 2026-08-27: ours everywhere rather than ours-where-NOAA-is-
 * silent. IBTrACS carries no landfall marker in any form, so a hybrid would
 * make the West Pacific look different from the Atlantic for reasons that are
 * about which agency reanalysed the record rather than about the weather. One
 * method, one answer, every basin and every year (§57.30 step 13).
 *
 * ==> NOAA'S MARKERS ARE NOT DELETED, THEY STOP DECIDING. <== Every `L` record
 * is still parsed and still carried; `lib/season-facts.js` stamps the two
 * `source: 'noaa'` and `source: 'computed'` so a published mark and a derived
 * one are distinguishable in the data even where they draw identically. The
 * one thing that must never happen is our answer being written back into a
 * `seasons/data/` file as though NOAA had said it.
 *
 * ==> WHAT THE SOURCE DATA CAN AND CANNOT SUPPORT — MEASURED, NOT ASSUMED.
 * <== Every one of the 87,631 coordinates in the archive is at 0.1° precision,
 * about 11 km, and every gap between fixes is six hours. So:
 *
 *   - A computed position is never better than ±11 km and a computed time is
 *     never better than about half an hour. Neither is presented as exact.
 *   - A mask finer than the position error buys nothing. 0.02° (2.2 km) is
 *     already five times finer than the record it is measuring, and testing at
 *     0.01° made agreement with NOAA slightly WORSE while quadrupling memory.
 *   - 600 of NOAA's own 1,314 markers sit on WATER against a proper land
 *     polygon set, because a 0.1°-rounded position on a barrier island is a
 *     coin toss. Chasing an exact match against them is chasing noise, and
 *     that is why the per-storm answer is the one this file is built for.
 *
 * ==> IT IS A RASTER RATHER THAN A POLYGON TEST, AND THAT IS A SPEED
 * DECISION WITH A MEASUREMENT BEHIND IT. <== Walking 3,266 storms means about
 * two million point-in-land questions. Asked of 480,000 polygon edges directly
 * that is billions of comparisons; asked of a scanline-filled bitmap it is two
 * million array lookups. The whole archive walks in about half a second.
 */

import { SEASONS } from '../config/constants.js';
import { categoryFromKt } from './category.js';

/** Kilometres per degree of latitude. The same figure `lib/near-home.js` uses;
 *  a sphere is accurate enough for a mask whose cells are 2.2 km wide. */
const KM_PER_DEG = 111.2;

const RAD = Math.PI / 180;

/** True when the system was a cyclone at this moment. Reuses the app's own
 *  list rather than keeping a second one — subtropical storms come ashore too,
 *  and a wave or an extratropical low crossing a coast is not a landfall in
 *  any sense this app should draw. */
const isCyclone = (status) => SEASONS.cycloneStatuses.includes(String(status || '').toUpperCase());

/* ---------------------------------------------------------------------------
 * THE WALK
 * ------------------------------------------------------------------------- */

/** Great-circle-ish distance in km. Flat enough over a six-hour storm step. */
function stepKm(aLon, aLat, bLon, bLat) {
  const dx = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * RAD) * KM_PER_DEG;
  const dy = (bLat - aLat) * KM_PER_DEG;
  return Math.hypot(dx, dy);
}

/** Interpolate a value that may be absent at either end. A storm with no
 *  pressure reading at one fix does not get half of the other one — §5, a
 *  number that was never measured is null and stays null. */
const lerpOrNull = (a, b, f) => (Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * f : null);

/**
 * Every landfall on one track.
 *
 * ==> THE PATH BETWEEN FIXES IS SAMPLED, NOT JUST THE FIXES. <== This is the
 * whole reason the method works. The median distance between consecutive
 * fixes is 107 km and the ninetieth percentile is 202 km; Dominica is 45 km
 * across. Testing only at the fixes would report an open ocean crossing for
 * Maria in 2017, and for every storm that has ever crossed a small island or
 * clipped a cape between two six-hourly observations.
 *
 * ==> A LANDFALL IS A WATER-TO-LAND TRANSITION, NOT A POSITION ON LAND. <== A
 * storm that forms over land, or that is already inland when the file starts,
 * has not come ashore. The first sample sets the state and never fires.
 *
 * ==> AND A STORM SKIMMING A COAST IS ONE LANDFALL, NOT SIX. <== A track
 * running along a ragged shore crosses the line repeatedly at 0.1° precision.
 * `landfallSeparationKm` of open water is required before a second crossing
 * counts as a second landfall — the storm has to have genuinely gone back out
 * to sea. It has no effect on WHETHER a storm came ashore, only on how many
 * times it is said to have done so.
 *
 * @param {Array<object>} points   HURDAT2/ATCF fixes, with `lonU`
 * @param {(lon:number, lat:number) => boolean} isLand
 * @param {object} [opts]
 * @returns {Array<{time:number, lat:number, lon:number, windKt:number|null,
 *   pressureMb:number|null, category:number|null, source:string}>}
 */
export function landfallsFor(points, isLand, {
  sampleKm = SEASONS.landfallSampleKm,
  separationKm = SEASONS.landfallSeparationKm,
} = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lonU ?? p?.lon));
  if (pts.length < 2 || typeof isLand !== 'function') return [];

  const lonOf = (p) => (Number.isFinite(p.lonU) ? p.lonU : p.lon);

  const out = [];
  let wasLand = isLand(lonOf(pts[0]), pts[0].lat);
  let waterKm = wasLand ? 0 : Infinity;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const aLon = lonOf(a), bLon = lonOf(b);
    const dist = stepKm(aLon, a.lat, bLon, b.lat);
    const n = Math.max(1, Math.ceil(dist / sampleKm));
    const per = dist / n;

    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const lon = aLon + (bLon - aLon) * f;
      const lat = a.lat + (b.lat - a.lat) * f;
      const land = isLand(lon, lat);

      if (!land) {
        waterKm += per;
      } else {
        if (!wasLand && waterKm >= separationKm) {
          /* Status is read from whichever fix the sample is nearer. There is
           * no better answer available: the file records a status at the fix
           * and says nothing about the six hours in between. */
          const status = f < 0.5 ? a.status : b.status;
          if (isCyclone(status)) {
            const windKt = lerpOrNull(a.windKt, b.windKt, f);
            out.push({
              time: Math.round(a.time + (b.time - a.time) * f),
              lat: Math.round(lat * 100) / 100,
              lon: Math.round(lon * 100) / 100,
              windKt: windKt == null ? null : Math.round(windKt),
              pressureMb: (() => {
                const mb = lerpOrNull(a.pressureMb, b.pressureMb, f);
                return mb == null ? null : Math.round(mb);
              })(),
              category: windKt == null ? null : categoryFromKt(Math.round(windKt)),
              /* ==> THE STAMP IS THE POINT. <== §57.7 asked from the first day
               * for a derived mark and a published one to stay distinguishable
               * even when they draw the same. */
              source: 'computed',
            });
          }
        }
        waterKm = 0;
      }
      wasLand = land;
    }
  }

  return out;
}

/**
 * Did this storm come ashore at all?
 *
 * ==> IT IS ITS OWN FUNCTION BECAUSE IT IS THE ROBUST QUESTION. <== Matching
 * NOAA landfall-for-landfall tops out in the low nineties and cannot go higher,
 * because 46% of NOAA's own markers sit on water against any global coastline
 * (see the header). Measured against the whole archive, this question agrees
 * with NOAA on **98.1%** of the storms NOAA marked at all. It is also exactly
 * what the Wall of Years asks of each storm, so the wall reads this rather
 * than counting a list it would then throw away.
 */
export const cameAshore = (points, isLand, opts) => landfallsFor(points, isLand, opts).length > 0;
