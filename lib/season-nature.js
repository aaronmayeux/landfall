/**
 * season-nature.js — what KIND of system an archive fix was.
 * SPEC-SEASONS-BUILD.md §57.7f.
 *
 * ==> THIS FILE EXISTS BECAUSE TWO SURFACES ANSWERED THE SAME QUESTION TWO
 * DIFFERENT WAYS AND ONE OF THEM WAS WRONG ON GLASS. <== Aaron opened Beryl
 * 2018 on 2026-08-29. Her panel said she never came ashore, correctly: HURDAT2
 * codes her `DB` from 12Z on 8 July, so every crossing of Dominica, Puerto Rico
 * and Hispaniola happened to a disturbance rather than to a cyclone. The globe
 * two inches above drew that same run as a chain of green `TS` dots, because
 * `map/layers/season-points.js` graded a fix from its WIND alone and never read
 * the status column at all.
 *
 * **Her wind never dropped — 45 kt at Dominica. What she lost was her
 * structure.** That is precisely the distinction the status column carries and
 * a wind number cannot, and it is why grading from wind is not a shortcut to
 * the same answer.
 *
 * MEASURED over all 3,266 storms before the fix: **12,355 fixes across 1,440
 * storms** wore a tropical dot code at a non-cyclone status, and **687 of them
 * wore an actual Saffir-Simpson number** on an `EX` or `LO` fix — the exact
 * grading §6 and §57.7c forbid, on the globe rather than on the panel where it
 * was being watched for.
 *
 * ==> IT IS ONE FILE RATHER THAN A HELPER IN EACH CALLER, AND THAT IS THE WHOLE
 * POINT. <== `lib/landfall.js` already held this rule privately, for landfalls.
 * A second copy in the map layer is how the panel and the globe come to
 * disagree again the first time the rule moves — and it moved twice in two days
 * (§57.7c, §57.7d). Both roads read this now.
 *
 * Pure. Imports `config/` only. No DOM, no map, no fetch, no clock.
 */

import { SEASONS } from '../config/constants.js';

/** True when the system was a tropical or subtropical cyclone at this moment.
 *  Subtropical counts: `lib/category.js` grades it alongside its tropical twin
 *  and a subtropical storm comes ashore like one. */
export const isCycloneStatus = (status) =>
  SEASONS.cycloneStatuses.includes(String(status || '').toUpperCase());

/** True when the status is one of the codes for a former cyclone. `EX` and
 *  `LO` — see `SEASONS.postTropicalStatuses` for the whole argument, including
 *  why NWS treats the extratropical cyclone and the remnant low as two classes
 *  of one thing. */
export const isPostTropicalStatus = (status) =>
  SEASONS.postTropicalStatuses.includes(String(status || '').toUpperCase());

/**
 * When this system first became a tropical or subtropical cyclone, or null if
 * it never did.
 *
 * ==> THE ANCHOR IS THE FIRST SUCH FIX AND NOT THE LAST. <== §57.7c. A storm
 * that is an extratropical low on the way in and only becomes tropical later
 * has not been post-tropical yet; anchoring on the last cyclone fix would pass
 * those and break a storm that re-intensifies after transition.
 */
export function firstCycloneTime(points) {
  for (const p of points || []) {
    if (isCycloneStatus(p?.status) && Number.isFinite(p?.time)) return p.time;
  }
  return null;
}

/**
 * What kind of system one fix was, in the vocabulary `lib/category.js` speaks.
 *
 *   - `tropical` — a cyclone. Graded, coloured by Saffir-Simpson.
 *   - `post-tropical` — was a cyclone, is not now. Keeps the hue that holds the
 *     eye and is NEVER given a category number.
 *   - `remnant` — never a cyclone at this moment: a disturbance, a wave, or a
 *     low before the storm ever formed. The globe's quiet pre-genesis hue.
 *
 * ==> THERE IS NO WIND FLOOR HERE, AND THAT IS THE DIFFERENCE BETWEEN THIS AND
 * `landfallNature`. <== The floor in `SEASONS.postTropicalLandfallMinKt` decides
 * whether a coast crossing COUNTS AS A LANDFALL. It does not decide what a
 * system IS: a 20 kt remnant low is post-tropical by NWS's own definition, it
 * simply is not coming ashore in any sense worth drawing a mark for. Applying
 * the floor here would make a storm's dying tail change species halfway along
 * for a reason that is about landfalls.
 *
 * @param {string} status   the HURDAT2/ATCF status column
 * @param {number} time     this fix's time
 * @param {number|null} bornAt  `firstCycloneTime` for the whole track
 * @returns {'tropical'|'post-tropical'|'remnant'}
 */
export function natureAt(status, time, bornAt) {
  if (isCycloneStatus(status)) return 'tropical';
  if (!isPostTropicalStatus(status)) return 'remnant';
  if (!Number.isFinite(bornAt) || !(time >= bornAt)) return 'remnant';
  return 'post-tropical';
}

/**
 * The letters to print inside a dot that carries no Saffir-Simpson reading.
 *
 * ==> IT IS THE RECORD'S OWN CODE, AND THAT IS AARON'S CALL RATHER THAN A
 * DEFAULT. <== 2026-08-29, offered blank / the code / a word. A blank grey dot
 * beside a lettered one reads as a dot that failed to load; `DB` reads as a
 * fact the reader can look up. It is jargon, and it is jargon the record itself
 * uses.
 *
 * ==> TWO CHARACTERS OR NOTHING. <== `STORM_GEO.pointCodeSize` is set for `TD`
 * and for a single digit. `lib/hurdat.js` carries the status column through
 * unvalidated on purpose, so the tenth code NOAA invents arrives here as
 * whatever they wrote; anything that will not fit is dropped rather than
 * truncated, because `PTC` cut to `PT` is a wrong label rather than a short one.
 */
export function statusDotCode(status) {
  const s = String(status || '').trim().toUpperCase();
  return s.length >= 1 && s.length <= 2 ? s : '';
}
