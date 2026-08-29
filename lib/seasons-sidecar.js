/**
 * seasons-sidecar.js — what the two generated per-basin sidecars are called.
 * SPEC-SEASONS-BUILD.md §57.7a, §57.40a, §57.47.
 *
 * Pure. No fetch, no fs, no DOM, no clock. Two template strings and the reason
 * they are not written inline in four places.
 *
 * ==> IT EXISTS BECAUSE A FILENAME IS THE ONLY THING STANDING BETWEEN A PHONE
 * AND A YEAR-OLD ANSWER. <== `_headers` holds `/seasons/data/*` at
 * `max-age=31536000, immutable`, which is right: NOAA's history does not
 * change and a returning reader should never revalidate it. The consequence is
 * that a file whose CONTENTS we change while its NAME stays the same is served
 * from a browser cache until 2027, with no error, no empty state and no
 * console line. §57.47 is that failure, found on glass, on the rankings table.
 *
 * ==> AND THE NAME HAS TO BE BUILT IN ONE PLACE OR THE GUARD IS DECORATIVE.
 * <== Before this file the runner built these names in `tools/` and the app
 * built them inline in `data/seasons.js`. Two spellings of one rule means a
 * bumped schema on one side and not the other produces a 404 that
 * `loadLandfalls` swallows into `null` by design, which the app then reports
 * honestly as "the sidecar is not on screen". Every surface degrades
 * gracefully and nothing anywhere says the deploy is broken.
 *
 * ==> THE VERSION IS BUMPED ON A CHANGE OF CONTENT, NOT ONLY OF SHAPE. <== The
 * test is not "did the code change" but "would a phone holding yesterday's
 * file be wrong". §57.7c changed which crossings count as a landfall; every
 * list in both files grew; every phone holding the old copy was wrong.
 */

import { SEASONS } from '../config/constants.js';

/** The computed landfalls for one basin. `lib/landfall.js` decides the shape;
 *  `SEASONS.landfallsSchema` is bumped when it or the rule behind it moves. */
export const landfallFileName = (basin, revision) =>
  `${basin}-landfalls-${SEASONS.landfallsSchema}-${revision}.json`;

/** The place names for one basin's genesis point, landfalls and stall.
 *
 *  ==> ITS VERSION MOVES WHEN THE LANDFALL RULE MOVES, EVEN THOUGH NO CODE IN
 *  THE GAZETTEER CHANGED. <== §57.40a: the `landfalls` array in this file is
 *  index-aligned against the computed landfall list. A phone pairing a new
 *  landfall list with an old places file gets a length mismatch, the alignment
 *  guard refuses the names, and the panel silently drops back to bare
 *  coordinates. That is a degradation rather than a wrong answer, which is
 *  exactly why nobody would notice it. */
export const placesFileName = (basin, revision) =>
  `${basin}-places-${SEASONS.placesSchema}-${revision}.json`;
