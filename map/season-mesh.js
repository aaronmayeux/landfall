/**
 * season-mesh.js — a ticked season → the weighted points the 3D cage lifts over.
 *
 * §57.21c. The archive's half of `map/storm-mesh.js`: same output contract,
 * same heightfield, completely different input.
 *
 * ==> WHY IT IS A SECOND FILE AND NOT A BRANCH IN THE FIRST. <== `storm-mesh.js`
 * is built end to end around a LIVE storm: a head bead at the current fix, a
 * time window measured from `now`, a cap on unmeasured forecast beads, a
 * `noCurrentReading` rule, and geometry that arrives asynchronously as bundles.
 * An archive storm has none of those. It is a finished list of positions, each
 * with a measured wind, all present at once, with no current moment for a
 * window to be relative to. Adding a mode flag to that file would have meant
 * every rule in it asking "which kind of storm is this?" — which is the shape
 * §12 calls two systems wearing one name.
 *
 * ==> WHAT IS SHARED IS SHARED PROPERLY. <== `thin` comes from `storm-mesh.js`
 * and `sevFromKt` from `heightfield.js`, so the two globes coarsen a long track
 * the same way and turn knots into height with the same curve. A Cat 3 raises
 * the same mountain in 1935 as it does today, which is the §6 promise applied
 * to the one channel §9 says is loudest.
 *
 * ==> THE GLYPH GOES ON THE FIRST FIX, IN THE TRACK'S OWN INK. <== Aaron's
 * call, 2026-08-25. The live globe stamps the mark at a storm's CURRENT
 * position, because that is where the storm is. An archive storm is not
 * anywhere — it is a finished curve — so the only position with a defensible
 * claim to the mark is the one the record opens at, which is also where
 * §57.21a already puts the white direction ring and the storm's name. The three
 * marks land on the same fix and read as one "this end is the beginning".
 *
 * ==> AND IN THE TRACK'S COLOUR, WHICH IS PEAK AND NOT THE FIRST FIX'S. <==
 * Also Aaron's, and it is the deliberate inconsistency in this file. Every BEAD
 * is the category at that moment (the live globe's rule, and §57.21a's rule for
 * the dots); the GLYPH is the storm's peak, matching the line it sits on the
 * end of. A mark drawn in the hue of a storm's first six hours would be blue on
 * every storm that ever lived, which is exactly the reason `season-tracks.js`
 * colours the line by peak rather than by segment. The glyph belongs to the
 * LINE, not to the fix it happens to stand on.
 *
 * ==> A STORM WITH NO RECORDED WIND STILL GETS ITS GLYPH AND NO RIDGE, AND
 * THAT IS THE HONEST SHAPE. <== `sevFromKt(null)` is the cage's noise floor, so
 * a pre-1886 storm whose rows carry no intensity lies flat. It has not
 * vanished — the mark is there and the track is drawn — it simply makes no
 * severity claim, because nobody recorded one. Height is the loudest channel on
 * this globe (§9) and it must not shout a number that does not exist.
 *
 * `THREE` is a global (via lib/geo.js). Imports config/, lib/, and two map/
 * siblings. One direction, no cycle.
 */

import { MESH_TRACK, SEASONS } from '../config/constants.js';
import { lonLatToVec3 } from '../lib/geo.js';
import { categoryColor, categoryFromKt } from '../lib/category.js';
import { sevFromKt } from './heightfield.js';
import { thin } from './storm-mesh.js';

/**
 * How many ridge points each ticked storm may spend.
 *
 * ==> THE BUDGET IS SHARED OUT, BECAUSE THE ARCHIVE CAN TICK A WHOLE SEASON.
 * <== The live globe draws at most fifteen storms and bounds each one; a reader
 * who presses the master box on 2005 draws twenty-eight, and on a busy record
 * more. `SEASONS.meshMaxPointsTotal` carries the cost argument — every point is
 * tested against all 1,440 cage nodes on a recompute.
 *
 * Spending it EVENLY rather than first-come is what stops the last storms in a
 * season silently losing their ridge: the reader ticked them all and would have
 * no way to see which ones were dropped. Coarser everywhere is a visible,
 * uniform degradation; missing mountains are not.
 *
 * `MESH_TRACK.maxPointsPerStorm` still caps the per-storm share, so ticking one
 * storm out of 1851 does not license a thousand-point ridge for it.
 */
function budgetPerStorm(count) {
  if (count <= 0) return 0;
  const share = Math.floor(SEASONS.meshMaxPointsTotal / count);
  return Math.max(
    SEASONS.meshMinPointsPerStorm,
    Math.min(MESH_TRACK.maxPointsPerStorm, share)
  );
}

/**
 * One storm's beads.
 *
 * @param {object} storm  as `lib/hurdat.js` parses it
 * @param {object} facts  from `lib/season-facts.js`
 * @param {number} budget how many points this storm may spend
 * @returns {Array<{dir, sev, color, head}>}
 */
function stormPoints(storm, facts, budget) {
  /* CHRONOLOGICAL, and sorted here rather than trusted. `stormFacts` sorts its
   * own copy and hands the original back untouched, and the glyph goes on the
   * FIRST fix — so reading the file's row order would put the mark at whichever
   * end the parser happened to emit first. */
  const pts = (storm?.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
      && Number.isFinite(p?.time))
    .slice()
    .sort((a, b) => a.time - b.time);

  if (!pts.length) return [];

  /* ==> THINNED BEFORE THE GLYPH IS DECIDED, AND `thin` KEEPS BOTH ENDS. <==
   * That guarantee is what makes this safe: the first fix survives every level
   * of thinning, so the mark cannot migrate down the track on a busy season.
   * Deciding the glyph first and thinning afterwards could drop it. */
  const kept = thin(pts, budget);

  /* ==> `lon`, NOT `lonU`. <== The unwrapped longitude exists so a LINE drawn
   * through it does not travel the long way round the planet (`season-tracks.js`
   * draws `lonU` for exactly that reason). These are independent directions on
   * a sphere, never joined, and `lonLatToVec3` takes a bearing rather than a
   * position on a plane — so the published value is the right one and the
   * unwrapped one would only be right by accident of trigonometry being
   * periodic. Hurricane Della, CP011957, is the storm that tells them apart. */
  return kept.map((p, i) => ({
    dir: lonLatToVec3(p.lon, p.lat, 1).normalize(),
    /* Height is the wind AT THIS FIX. Null for a storm the record carries no
     * intensity for, which `sevFromKt` floors — see the header. */
    sev: sevFromKt(Number.isFinite(p.windKt) ? p.windKt : null),
    color: i === 0
      /* The GLYPH's ink: the track's colour, which is peak. Same call
       * `season-tracks.js` makes, so the mark and the line it caps can never
       * be two different colours for one storm. */
      ? categoryColor(facts?.peakCategory ?? null, 'tropical', null)
      /* Every other bead is the category at that moment — the live globe's
       * rule and §57.21a's rule for the per-fix dots. */
      : categoryColor(
        Number.isFinite(p.windKt) ? categoryFromKt(p.windKt) : null,
        'tropical',
        null
      ),
    /* ==> ONE GLYPH PER STORM, ON AN EXPLICIT FLAG. <== `map/heightfield.js`
     * stamps the mark on every point whose `head` is not false, so leaving it
     * off would draw one storm as forty — a false count of systems, which is
     * the §5 failure the live globe's own head flag exists to prevent. */
    head: i === 0,
  }));
}

/**
 * Build the cage's point list for the storms currently drawn on the archive.
 *
 * @param {Array<{storm:object, facts:object}>} selected  what the board ticked
 *   and the globe is drawing — already filtered of storms that are still
 *   happening (§57.21c, `ui/view-seasons-board.js`).
 * @returns {Array<{dir, sev, color, head}>}
 *
 * An empty list in gives an empty list out, which flattens the cage. That is
 * the correct reading here and NOT §5's forbidden silence: nothing was fetched
 * and nothing failed — the reader has ticked no storms, and a flat globe is
 * exactly what "you have drawn nothing" looks like. A source outage in the
 * archive is a different thing entirely and is answered in words by the roster.
 */
export function buildSeasonMeshPoints(selected) {
  const list = Array.isArray(selected) ? selected : [];
  if (!list.length) return [];

  const budget = budgetPerStorm(list.length);
  const out = [];
  for (const entry of list) {
    if (!entry?.storm) continue;
    /* One bad storm must not cost the globe its whole ridge. The others still
     * go in, which is the same degrade-never-blank contract `storm-mesh.js`
     * keeps around its own per-storm build. */
    try {
      for (const p of stormPoints(entry.storm, entry.facts, budget)) out.push(p);
    } catch (e) {
      console.warn(`[landfall] archive ridge failed for ${entry?.storm?.id || 'a storm'}:`, e);
    }
  }
  return out;
}
