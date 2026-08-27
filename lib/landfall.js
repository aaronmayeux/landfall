/**
 * landfall.js — where a storm's centre crossed a coastline.
 * SPEC-SEASONS-BUILD.md §57.7, §57.7a.
 *
 * Pure. No fetch, no fs, no DOM, no clock. Given coastline rings and a track,
 * say where the centre came ashore. `tools/seasons-landfall.mjs` is the only
 * caller today and it runs on the monthly runner; nothing here reaches a phone.
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
 * THE LAND MASK
 * ------------------------------------------------------------------------- */

/**
 * Rasterise coastline rings into a land mask.
 *
 * ==> EVEN-ODD SCANLINE FILL, SO A HOLE IS A HOLE WITHOUT ANY RING-NESTING
 * LOGIC. <== Filling between alternating crossings on each raster row handles
 * an inner ring correctly and never needs to know which way a ring winds,
 * which is the class of bug `map/coast-source.js` records having to reason
 * about elsewhere.
 *
 * ==> AND THE SOURCE TURNS OUT TO CARRY ALMOST NO HOLES, WHICH IS FINE HERE
 * FOR A REASON WORTH WRITING DOWN. <== Measured on the shipped Natural Earth
 * land polygons: 6,837 outer rings and exactly ONE inner ring. So an enclosed
 * lake reads as LAND — Superior, Okeechobee, Victoria all do — while every
 * water body connected to the sea reads as water, which is the part that
 * matters: Pamlico Sound, Chesapeake Bay, Lake Pontchartrain and the Laguna
 * Madre are all correctly water, and those are exactly the ragged places
 * landfalls actually happen.
 *
 * An enclosed lake reading as land cannot produce a false landfall, because a
 * storm cannot reach one without crossing the real coast first — by the time
 * it is over Okeechobee the landfall has already fired. If a source with real
 * lake holes is ever swapped in, the fill above already handles it.
 *
 * ==> ONE BYTE PER CELL RATHER THAN ONE BIT, DELIBERATELY. <== A bitfield is
 * eight times smaller and cannot be filled with `TypedArray.fill`, which is
 * what makes the row fill fast. This runs on a runner with gigabytes free, so
 * 119 MB is the cheap side of the trade. If this ever has to reach a browser
 * that decision flips, and it is the only thing in this file that would need
 * to change.
 *
 * @param {Array<Array<[number,number]>>} rings  closed [lon, lat] loops
 * @param {object} [opts]
 * @returns {{isLand:(lon:number,lat:number)=>boolean, width:number,
 *   height:number, step:number, latMin:number, latMax:number, cells:number}}
 */
export function buildLandMask(rings, {
  step = SEASONS.landfallMaskStep,
  latMin = SEASONS.landfallMaskLatMin,
  latMax = SEASONS.landfallMaskLatMax,
} = {}) {
  const width = Math.round(360 / step);
  const height = Math.round((latMax - latMin) / step);
  const mask = new Uint8Array(width * height);

  /* Bucket every edge by the raster rows it spans, so each row's fill looks at
   * the handful of edges that can possibly cross it rather than at all of
   * them. Without this the fill is O(rows x edges) — 6,600 x 480,000. */
  const rowEdges = Array.from({ length: height }, () => []);
  for (const ring of rings || []) {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1];
      const [x1, y1] = ring[i];
      /* A horizontal edge crosses no scanline and would make the crossing
       * count odd where it touched one. Dropped rather than special-cased. */
      if (y0 === y1) continue;
      let lo = Math.ceil((Math.min(y0, y1) - latMin) / step - 0.5);
      let hi = Math.floor((Math.max(y0, y1) - latMin) / step - 0.5);
      if (hi < 0 || lo >= height) continue;
      if (lo < 0) lo = 0;
      if (hi >= height) hi = height - 1;
      for (let row = lo; row <= hi; row++) rowEdges[row].push(x0, y0, x1, y1);
    }
  }

  const xs = [];
  for (let row = 0; row < height; row++) {
    const y = latMin + (row + 0.5) * step;
    const edges = rowEdges[row];
    xs.length = 0;
    for (let k = 0; k < edges.length; k += 4) {
      const x0 = edges[k], y0 = edges[k + 1], x1 = edges[k + 2], y1 = edges[k + 3];
      /* The half-open rule: an edge counts when the scanline is above one end
       * and not the other, which keeps a vertex shared by two edges from being
       * counted twice and flipping the parity for the rest of the row.
       *
       * ==> IT IS BELT AND BRACES HERE, NOT LOAD-BEARING, AND SAYING SO IS
       * HONEST. <== The row bucketing above already hands this loop only the
       * edges that span the row, so this test almost never fires.
       * `tools/test-landfall.mjs` tried to mutation-check it on 2026-08-27 —
       * boxes, lakes and a spike with its apex sitting exactly on a scanline —
       * and could not construct a shape where removing it changes an answer.
       * It stays because the day the bucketing is rewritten it becomes the
       * only thing standing between a shared vertex and an inside-out
       * continent, but no test covers it and none pretends to. */
      if ((y0 > y) === (y1 > y)) continue;
      xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    const base = row * width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let c0 = Math.round((xs[k] + 180) / step);
      let c1 = Math.round((xs[k + 1] + 180) / step);
      if (c1 < 0 || c0 >= width) continue;
      if (c0 < 0) c0 = 0;
      if (c1 >= width) c1 = width - 1;
      mask.fill(1, base + c0, base + c1 + 1);
    }
  }

  const isLand = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (lat < latMin || lat >= latMax) return false;
    /* Longitudes arrive UNWRAPPED — `lib/hurdat.js` carries `lonU` so a track
     * crossing the date line stays one continuous line rather than jumping
     * 360°. The mask is indexed on real longitude, so the wrap happens here
     * and only here.
     *
     * ==> IT IS ARITHMETIC RATHER THAN A LOOP, AND MUTATION TESTING IS WHY.
     * <== This was `while (x < -180) x += 360` on 2026-08-27 and a longitude
     * needing TWO turns came out at -530, which produced a NEGATIVE column and
     * read a cell from the previous row — a wrong answer with no error, on a
     * lookup that runs two million times per archive. The double modulo below
     * is total for any input in one step and cannot produce an index outside
     * the row. The bounds check after it is belt and braces and it stays. */
    const x = (((lon + 180) % 360) + 360) % 360;
    const col = Math.floor(x / step);
    const row = Math.floor((lat - latMin) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) return false;
    return mask[row * width + col] === 1;
  };

  return { isLand, width, height, step, latMin, latMax, cells: mask.length };
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
