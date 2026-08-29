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
 * ==> AND A POST-TROPICAL STORM STILL COMES ASHORE. <== §57.7c, Aaron's call
 * 2026-08-29. This file used to refuse any crossing whose status was not a
 * tropical or subtropical one, which meant Sandy's New Jersey landfall was
 * found by the walk and then thrown away — she went extratropical six hours
 * before Brigantine. NOAA stamps an `L` on that record and NHC's own report
 * calls it a landfall. `landfallNature` below is where the two meanings of
 * HURDAT2's `EX` are separated; it counts, and it is labelled rather than
 * graded.
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
import { firstCycloneTime, isCycloneStatus, isPostTropicalStatus } from './season-nature.js';

export { firstCycloneTime };

/** Kilometres per degree of latitude. The same figure `lib/near-home.js` uses;
 *  a sphere is accurate enough for a mask whose cells are 2.2 km wide. */
const KM_PER_DEG = 111.2;

const RAD = Math.PI / 180;

/* ==> THE STATUS TESTS AND `firstCycloneTime` LIVE IN `lib/season-nature.js`
 * NOW, AND THEY LEFT BECAUSE THE MAP NEEDED THEM. <== §57.7f. The archive globe
 * was grading a fix from its wind alone and drawing `TS` on Beryl 2018's
 * disturbance while this file's rule, correctly, refused it a landfall. Two
 * copies of "was this a cyclone" is how the panel and the globe come to
 * disagree, so there is one. Re-exported above because `lib/season-facts.js`
 * imports it from here and the seam is not worth moving. */

/**
 * What KIND of landfall this crossing is, or null for one that does not count.
 *
 * ==> A POST-TROPICAL CODE MEANS TWO DIFFERENT THINGS AND THIS IS WHERE THEY
 * ARE SEPARATED. <== §57.7c, §57.7d. Sandy was 70 kt six hours after
 * transition when she crossed the New Jersey coast; the same `EX` sits on a
 * decayed remnant wandering over Newfoundland five days later. `LO` carries
 * the identical double meaning — Dorian over Halifax at 80 kt wears it, and so
 * does a dying swirl in the east Pacific. HURDAT2 gives each pair one code, so
 * the only separators available are strength and sequence:
 *
 *   - **Still at least tropical-storm force.** `postTropicalLandfallMinKt`,
 *     which is also NWS's own line between a remnant low and a post-tropical
 *     cyclone. It is what does nearly all the work: 52 of the archive's 404
 *     `EX` crossings fall under it, and 42 of its 47 `LO` ones.
 *   - **After the system had already BEEN a cyclone.** A storm that is an
 *     extratropical low on the way IN, comes ashore, goes back out and only
 *     then becomes tropical has not made a post-tropical landfall — it had not
 *     been tropical yet. Seven crossings in the archive are of that shape, and
 *     the anchor is the FIRST cyclone fix rather than the last so a storm that
 *     re-intensifies after transition is still handled correctly.
 *
 * ==> A POST-TROPICAL LANDFALL IS NEVER GIVEN A SAFFIR-SIMPSON CATEGORY. <==
 * That is not a rule invented here; `lib/category.js` has always refused to
 * grade a `post-tropical` nature and kept it visually distinct from a system
 * that was never a cyclone. The caller stamps `nature` and leaves `category`
 * null, and every surface that reads the list gets the app's existing
 * vocabulary for free.
 *
 * @param {string} status         the fix status the sample is nearer
 * @param {number|null} windKt    interpolated wind at the crossing
 * @param {number} time           interpolated time at the crossing
 * @param {number|null} firstCycloneTime  when the system first became one
 * @returns {'tropical'|'post-tropical'|null}
 */
export function landfallNature(status, windKt, time, firstCycloneTime) {
  if (isCycloneStatus(status)) return 'tropical';
  if (!isPostTropicalStatus(status)) return null;
  if (!Number.isFinite(firstCycloneTime) || !(time >= firstCycloneTime)) return null;
  if (!Number.isFinite(windKt) || windKt < SEASONS.postTropicalLandfallMinKt) return null;
  return 'post-tropical';
}

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
 * ==> AND IT CAN NOW SAY WHAT IT REFUSED, BECAUSE SILENCE IS NEVER THE ANSWER.
 * <== §5, §57.7e. The walk finds 135 water-to-land crossings across the archive
 * that are not landfalls — 86 under the wind floor, 38 carrying a code that is
 * not a former cyclone at all, 11 on a system that had not become one yet. For
 * 26 storms that is EVERY crossing they have, so the panel said "this storm did
 * not come ashore" over a track that plainly touched land. Pass a `declined`
 * array and the walk fills it; pass nothing and it costs nothing, which is why
 * this is an opt-in out-parameter rather than a changed return shape. `cameAshore`
 * and every existing caller are untouched by design.
 *
 * @param {Array<object>} points   HURDAT2/ATCF fixes, with `lonU`
 * @param {(lon:number, lat:number) => boolean} isLand
 * @param {object} [opts]
 * @param {Array} [opts.declined]  filled with `{time, lat, lon, windKt, status}`
 *   for every crossing the rule turned down
 * @returns {Array<{time:number, lat:number, lon:number, windKt:number|null,
 *   pressureMb:number|null, category:number|null, source:string}>}
 */
export function landfallsFor(points, isLand, {
  sampleKm = SEASONS.landfallSampleKm,
  separationKm = SEASONS.landfallSeparationKm,
  declined = null,
} = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lonU ?? p?.lon));
  if (pts.length < 2 || typeof isLand !== 'function') return [];

  const lonOf = (p) => (Number.isFinite(p.lonU) ? p.lonU : p.lon);

  const out = [];
  const bornAt = firstCycloneTime(pts);
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
          const raw = lerpOrNull(a.windKt, b.windKt, f);
          const windKt = raw == null ? null : Math.round(raw);
          const time = Math.round(a.time + (b.time - a.time) * f);
          const nature = landfallNature(status, windKt, time, bornAt);
          /* ==> THE REFUSAL IS RECORDED HERE AND NOWHERE ELSE. <== §57.7e.
           * This is the single place a real coast crossing stops being a
           * landfall, so a second implementation counting them from the
           * outside would be a second opinion about the same question — and
           * would drift the first time the rule moved. The status is carried
           * because it is the only part a reader could not work out from the
           * numbers beside it. */
          if (!nature && declined) {
            declined.push({
              time,
              lat: Math.round(lat * 100) / 100,
              lon: Math.round(lon * 100) / 100,
              windKt,
              status: String(status || '').toUpperCase() || null,
            });
          }
          if (nature) {
            out.push({
              time,
              lat: Math.round(lat * 100) / 100,
              lon: Math.round(lon * 100) / 100,
              windKt,
              pressureMb: (() => {
                const mb = lerpOrNull(a.pressureMb, b.pressureMb, f);
                return mb == null ? null : Math.round(mb);
              })(),
              /* ==> NULL FOR A POST-TROPICAL CROSSING, AND THAT IS THE APP'S
               * OWN RULE RATHER THAN A NEW ONE. <== `lib/category.js` refuses
               * to put a Saffir-Simpson number on a system that has lost its
               * tropical structure, everywhere else in this app. A landfall
               * list is not the place to start. */
              category: nature === 'post-tropical' || windKt == null
                ? null : categoryFromKt(windKt),
              /* ==> WHICH KIND OF LANDFALL, CARRIED RATHER THAN RE-DERIVED.
               * <== The status column that produced this answer is not in the
               * sidecar, so a reader of the file cannot work it out again.
               * It is also the value `categoryShortLabel` already speaks. */
              nature,
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
