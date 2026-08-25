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
 * ==> AND IT ANSWERS TAPS ON THAT GLYPH, WHICH IS WHY THE HIT-TEST LIVES HERE
 * AND NOT IN A FILE OF ITS OWN. <== §57.21d. The only hard part of hitting a
 * glyph is knowing WHICH fix carries it, and that decision is made here, four
 * lines into `stormPoints`. A hit-test in another file would have to make the
 * same decision a second time, and the day the two disagreed the symptom would
 * be a mark you can plainly see that opens the wrong storm or none at all.
 * `usableFixes` is the shared answer and both readers go through it.
 *
 * `THREE` is a global (via lib/geo.js). Imports config/, lib/, and three map/
 * siblings. One direction, no cycle.
 */

import { MESH_TRACK, SEASONS } from '../config/constants.js';
import { SIZE } from '../config/tokens.js';
import { lonLatToVec3 } from '../lib/geo.js';
import { categoryColor, categoryFromKt } from '../lib/category.js';
import { sevFromKt } from './heightfield.js';
import { thin } from './storm-mesh.js';
import { divePhase } from './globe-follow.js';

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
/**
 * The storm's usable fixes, oldest first.
 *
 * ==> ONE FUNCTION BECAUSE THE GLYPH AND ITS TAP TARGET MUST NOT BE DECIDED
 * TWICE. <== `stormPoints` below stamps the mark on element 0 of this list;
 * `seasonGlyphs` builds the hit target from element 0 of this list. A second
 * copy of the filter-and-sort would drift the first time either was tuned, and
 * the symptom is the worst kind: a glyph you can see, and a tap on it that
 * opens nothing or opens the wrong storm.
 *
 * CHRONOLOGICAL, and sorted here rather than trusted. `stormFacts` sorts its
 * own copy and hands the original back untouched, so reading the file's row
 * order would put the mark at whichever end the parser happened to emit first.
 */
function usableFixes(storm) {
  return (storm?.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
      && Number.isFinite(p?.time))
    .slice()
    .sort((a, b) => a.time - b.time);
}

function stormPoints(storm, facts, budget) {
  const pts = usableFixes(storm);

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
/**
 * Where each drawn storm's glyph is, as a longitude and a latitude. §57.21d.
 *
 * ==> A SECOND, TINY LIST RATHER THAN AN ID BOLTED ONTO THE RIDGE POINTS. <==
 * `buildSeasonMeshPoints` above feeds `map/heightfield.js`, which copies every
 * point into typed arrays on every recompute and tests each one against all
 * 1,440 cage nodes. Adding a string to those objects would put a storm id on
 * up to 1,600 of them for the benefit of the few dozen that carry a mark, on
 * the hot path, for a list nothing in the render loop reads. This is one entry
 * per storm and it never enters the render path at all.
 *
 * @param {Array<{storm:object}>} selected  the same list `setTracks` is given.
 * @returns {Array<{id:string, lon:number, lat:number}>}
 */
export function seasonGlyphs(selected) {
  const list = Array.isArray(selected) ? selected : [];
  const out = [];
  for (const entry of list) {
    const storm = entry?.storm;
    if (!storm?.id) continue;
    const first = usableFixes(storm)[0];
    if (!first) continue;
    /* `lon`, not `lonU`, and for the same reason the ridge reads `lon`: this
     * is a bearing on a sphere rather than a position on a plane, and it is
     * the value `map.project` expects. On the FIRST fix the two are equal by
     * construction anyway — `lib/hurdat.js` anchors the unwrap there — which
     * is what makes the choice safe rather than merely defensible. */
    out.push({ id: storm.id, lon: first.lon, lat: first.lat });
  }
  return out;
}

/**
 * Which storm's glyph is under this tap, if any. §57.21d.
 *
 * ==> IT PROJECTS THROUGH MAPLIBRE RATHER THAN RAY-CASTING THE CAGE. <== The
 * glyphs are Three.js sprites, so `map.queryRenderedFeatures` cannot see them
 * and NOW.md offered two ways round it: cast a ray at the cage, or project
 * each glyph to the screen and take the nearest. This is neither exactly — it
 * is the second one, done with MapLibre's own projection instead of Three's,
 * which is available because `map/globe-follow.js` spends every frame keeping
 * the two globes pixel-locked. That IS the whole job of that file, so a
 * longitude and latitude put through `map.project` land on the pixel the
 * sprite was drawn at. No picking geometry, nothing added to the render path,
 * and no second projection matrix that could disagree with the one on screen.
 *
 * ==> AND IT IS SWITCHED OFF ONCE THE GLYPH IS FADING. <== See
 * `SEASONS.glyphTapMaxPhase`. A mark at 40% opacity is not the thing a reader
 * is aiming at; the track under it is, and the track owns the tap from there
 * in. Nothing is lost by the handover because the glyph stands on the track's
 * first vertex.
 *
 * ==> THE FAR SIDE OF THE PLANET IS REFUSED. <== `map.project` answers for a
 * position behind the globe as readily as for one in front of it, so without
 * the facing test a tap on the visible Atlantic could open a storm in the
 * Pacific that is round the back. See `SEASONS.glyphFacingMin`.
 *
 * NEAREST WINS, not first-found. Two storms that began within a thumb's width
 * of each other both qualify, and the one whose mark is closest to the finger
 * is the one that was aimed at.
 *
 * @param {object} map    MapLibre map
 * @param {{x:number, y:number}} point  the tap, in screen pixels
 * @param {Array<{id, lon, lat}>} glyphs  from `seasonGlyphs`
 * @returns {string|null} a storm id, or null
 */
export function seasonGlyphAtPoint(map, point, glyphs) {
  if (!map || !point || !Array.isArray(glyphs) || !glyphs.length) return null;
  if (divePhase(map.getZoom?.() ?? 0) > SEASONS.glyphTapMaxPhase) return null;

  const centre = map.getCenter?.();
  if (!centre) return null;
  const facing = lonLatToVec3(centre.lng, centre.lat, 1).normalize();

  const reach = parseInt(SIZE.touchTarget, 10) / 2;
  let bestId = null;
  let bestDist = Infinity;

  for (const g of glyphs) {
    if (!Number.isFinite(g?.lon) || !Number.isFinite(g?.lat)) continue;
    if (lonLatToVec3(g.lon, g.lat, 1).normalize().dot(facing) < SEASONS.glyphFacingMin) {
      continue;
    }
    const p = map.project?.([g.lon, g.lat]);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d <= reach && d < bestDist) {
      bestDist = d;
      bestId = g.id;
    }
  }
  return bestId;
}

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
