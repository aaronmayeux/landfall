/**
 * glow-lights.js — THE CAGE'S POINTS -> THE LIGHT LIST.
 *
 * Pure. Takes the heightfield's live point array and answers "what throws
 * light, in what color, from where, and how much of the ridge wears it". It
 * knows nothing about canvases, cameras, blending or the backdrop — that all
 * lives in map/limb-glow.js, which is its only caller.
 *
 * ==> WHY IT IS ITS OWN FILE. <== limb-glow.js crossed the 700-line ceiling on
 * 2026-08-21 and the cut had to go somewhere honest rather than somewhere
 * convenient. This is the one clean seam in it: everything here is arithmetic
 * on a list of storm points and could be tested with no browser at all,
 * everything left there is painting. The split is one-directional — limb-glow
 * imports this and this imports nothing but config.
 *
 * Imports: config/ only.
 */

import { GLOW } from '../config/constants.js';

/** How far a color is from grey, 0..255. A colorless point makes no severity
 *  claim and throws no light — see `buildLights`. */
export function chromaOf(hex) {
  const h = typeof hex === 'string' && hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  if (typeof h !== 'string') return 0;
  const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
  if (!Number.isFinite(n)) return 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * ==> THE CAGE'S POINTS -> THE LIGHTS. ONE PER RUN OF ONE COLOR, NOT ONE PER
 * STORM. <==
 *
 * This used to be `pt.head === true` and nothing else: a single light per
 * storm, wearing that storm's CURRENT category color. Everything the cage
 * remembers threw no light at all — so a storm that peaked at Cat 4 and has
 * since weakened to a Cat 1 showed a large red ridge on the globe and a purely
 * yellow glow behind it. The red was not dim, it was never drawn. Aaron on
 * glass, 2026-08-18: "make sure all node mesh colors shine on the background,
 * in the correct position."
 *
 * So the list is walked as what it is — a per-storm ridge, in order — and every
 * consecutive stretch of ONE category color becomes one light, placed at that
 * stretch's middle bead. The colors on the backdrop are then the colors on the
 * cage, each where its own part of the cage is.
 *
 * ==> WEIGHT IS HOW MUCH CAGE WEARS THE COLOR, AND IT DRIVES SIZE ONLY. <==
 * Aaron's rule, same session: "one color shouldn't overpower the others unless
 * there is just more of it — height shouldn't dictate intensity." Severity is
 * already the loudest channel on the globe as ELEVATION; letting it also set
 * the light's brightness said the same thing twice and left a depression's
 * light too dim to find. Brightness is now flat across every color, and the
 * only thing that makes one read louder is covering more of the sky — which is
 * exactly "there is more of it", measured off the ridge rather than off height.
 *
 * THE HEAD IS ITS OWN RUN AND IS NOT MERGED WITH ITS NEIGHBOURS, because the
 * list is not chronological across that seam: `buildMeshPoints` enters the head
 * FIRST and then the beads oldest-first, so the point beside the head is the
 * oldest one in the window, days away. Merging them would put a run's midpoint
 * in open ocean between the two.
 *
 * A storm WITH beads drops its head light: the beads already cover the present
 * position with the present color, and keeping both double-lights it. A storm
 * with NO beads — CURRENT mesh mode, a failed geometry bundle, or a storm with
 * no current reading — keeps its head as its single light, so no live storm
 * ever goes dark.
 *
 * @param {Array} pts  the heightfield's live point list
 * @returns {Array<{dir, color, weight}>}
 */
export function buildLights(pts) {
  const perStorm = [];
  let runs = null;
  let cur = null;

  const closeRun = () => {
    if (cur) runs.push(cur);
    cur = null;
  };
  const closeStorm = () => {
    if (!runs) return;
    closeRun();
    if (runs.length) perStorm.push(runs);
    runs = null;
  };

  for (const pt of pts) {
    if (!pt || !pt.dir) continue;
    if (pt.head === true) {
      closeStorm();
      runs = [];
    }
    if (!runs) continue; // a bead before any head: not part of a storm we know
    /* A point with no lift, or no color, states nothing worth lighting. Grey is
     * what `stormSwatch` gives a storm nobody is publishing a wind for, and a
     * light with no hue under `color` blending tints nothing anyway — so this
     * refuses to shine on a claim the data does not make, rather than throwing
     * a neutral wash the dark theme would render as plain white. */
    if (!(pt.sev > 0) || chromaOf(pt.color) < GLOW.minChroma) {
      closeRun();
      continue;
    }
    if (pt.head === true) {
      runs.push({ color: pt.color, pts: [pt], head: true });
      continue;
    }
    if (cur && cur.color === pt.color) cur.pts.push(pt);
    else {
      closeRun();
      cur = { color: pt.color, pts: [pt], head: false };
    }
  }
  closeStorm();

  const lights = [];
  for (const stormRuns of perStorm) {
    const beadRuns = stormRuns.filter((r) => !r.head);
    const keep = beadRuns.length ? beadRuns : stormRuns;
    for (const run of keep) {
      lights.push({
        dir: run.pts[(run.pts.length - 1) >> 1].dir,
        color: run.color,
        weight: run.pts.length,
        storm: perStorm.indexOf(stormRuns),
      });
    }
  }

  if (lights.length <= GLOW.maxLights) return lights;

  /* ==> OVER BUDGET: EVERY STORM KEEPS ITS BIGGEST RUN BEFORE ANY STORM KEEPS
   * ITS SECOND. <== Sorting the whole list by weight and truncating would let
   * one long-lived system's five color spans silence a smaller storm outright,
   * which is a false reading of how many systems are out there — the same
   * class of error as the head flag on the cage glyphs. Below the cap this
   * branch never runs at all. */
  const best = new Map();
  for (const l of lights) {
    const b = best.get(l.storm);
    if (!b || l.weight > b.weight) best.set(l.storm, l);
  }
  const first = [...best.values()];
  const rest = lights.filter((l) => !first.includes(l)).sort((a, b) => b.weight - a.weight);
  return first.concat(rest).slice(0, GLOW.maxLights);
}

