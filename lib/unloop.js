/*
 * unloop.js — finding where a ring crosses itself, and cutting the loop out.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * Two callers, and the project rule is that a pattern used twice gets extracted
 * BEFORE the second use. There is a sharper reason than tidiness here: both
 * callers are OFFSET CURVES, and offset curves fail the same way for the same
 * reason. Two copies of this maths could drift, and a drifted copy means a wind
 * band that cleans up and a cone that does not — an inconsistency nobody would
 * think to check.
 *
 *   lib/windswath.js  the swept wind corridor's walls (SPEC-MAP.md §7.12)
 *   lib/cone-sweep.js the rebuilt cone's flanks       (SPEC-MAP.md §7.9)
 *
 * ==> THE FAULT IT EXISTS FOR <==
 * Offset a curve inward by more than its own radius of curvature and the offset
 * swings round and genuinely crosses itself — over tens of vertices, at honest
 * spacing, with gentle per-vertex turns. Every LOCAL test passes. The ring is
 * simply not simple any more, and fill treats the doubled-over region as
 * OUTSIDE, so the artefact reads as a hole or a fin rather than as a mistake.
 *
 * ==> CUTTING THE LOOP IS THE CORRECT ANSWER, NOT A COSMETIC ONE. <== The region
 * an offset ring describes is a swept union. On the inside of a tight turn the
 * boundary of that union is the ENVELOPE of the offset curve — which is exactly
 * the offset curve with its self-intersection loops trimmed. The loop is an
 * artefact of tracing a boundary the swept area never had.
 *
 * Pure functions. No DOM, ever. No imports.
 */

/* ---------------------------------------------------------------------------
 * SELF-INTERSECTION — finding a wall that crossed itself, and cutting it out
 * ------------------------------------------------------------------------- */

/** Twice the signed area of a triangle. Positive when a→b→c turns left. */
export function cross3(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Where segments a→b and c→d PROPERLY cross, or null. "Properly" excludes
 *  touching and collinear overlap: a ring's own consecutive segments share an
 *  endpoint by construction and must never be read as a crossing. */
export function segCross(a, b, c, d) {
  const d1 = cross3(c, d, a);
  const d2 = cross3(c, d, b);
  const d3 = cross3(a, b, c);
  const d4 = cross3(a, b, d);
  if ((d1 > 0) === (d2 > 0) || (d3 > 0) === (d4 > 0)) return null;
  const t = d1 / (d1 - d2);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The first place the ring crosses itself, or null.
 *
 * ==> A UNIFORM GRID, NOT AN INDEX WINDOW. <== The obvious cheap version only
 * compares segments within N of each other, which turns the search into a
 * guess: pick N too small and a wide fold is missed and draws, pick it large
 * and the O(n²) is back. The measured folds spanned 5 to 90 vertices and
 * nothing says the next storm's sit in that range. Bucketing by POSITION has
 * no such parameter — segments that cannot touch are never compared, however
 * far apart in the ring they are. The cell is the mean segment length, so a
 * segment spans about one cell and the buckets stay small.
 *
 * `ring` is OPEN here (no repeated closing vertex); the closing segment is
 * walked explicitly.
 */
export function firstCrossing(ring) {
  const n = ring.length;
  if (n < 5) return null;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const cell = total / n;
  if (!(cell > 0)) return null;

  const buckets = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const list = buckets.get(k);
        if (list) list.push(i); else buckets.set(k, [i]);
      }
    }
  }

  let best = null;
  for (const list of buckets.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]);
        const j = Math.max(list[p], list[q]);
        /* Neighbours in the ring share an endpoint. Not a crossing. */
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        const at = segCross(ring[i], ring[i + 1], ring[j], ring[(j + 1) % n]);
        if (!at) continue;
        /* Deterministic: the same ring must always cut the same loop first,
         * whatever order the buckets happened to iterate in. */
        if (!best || i < best.i || (i === best.i && j < best.j)) best = { i, j, at };
      }
    }
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * THE SPINE, NOT THE WALL — where an OPEN path crosses itself
 *
 * ==> THIS IS A DIFFERENT FAULT FROM THE ONE ABOVE, AND CUTTING THE WALL
 * CANNOT REACH IT. <== Everything above trims a wall that folded. This finds
 * the case where the CENTRELINE folded — a storm that looped and drove back
 * over its own path.
 *
 * A corridor traced as two offset walls only describes a swept region while
 * the path does not overlap itself. Once it does, "left of travel" and "right
 * of travel" stop naming two sides of one corridor, the traced boundary stops
 * enclosing the area actually covered, and the WIDER the band the earlier it
 * breaks. Measured on Jeanne 2004 (SPEC-MAP.md §7.12): 26.2% of her 64 kt
 * outline was drawn OUTSIDE her 34 kt outline, which is impossible — anywhere
 * that saw 64 kt necessarily saw 34.
 *
 * Cutting the wall does not help, because the wall is not what is wrong.
 * Splitting the PATH at its own crossings does: each piece is then a corridor
 * that never overlaps itself, so its walls are meaningful again.
 * ------------------------------------------------------------------------- */

/**
 * How wide the piece a crossing encloses actually is: the diameter of the
 * circle with the same area, in the path's own units.
 *
 * ==> AREA, NOT THE DISTANCE BETWEEN THE FARTHEST TWO POINTS. <== A hairpin
 * that doubles straight back along its own line encloses almost nothing
 * however far it reached, and calling that a loop 300 units wide would be a
 * confident wrong answer. The same choice, for the same reason, as
 * `loopWidthNm` in `lib/storm-shape.js`.
 */
function loopWidth(ring) {
  if (ring.length < 3) return 0;
  let twice = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return 2 * Math.sqrt(Math.abs(twice / 2) / Math.PI);
}

/**
 * Every place an OPEN path crosses itself, ascending. Each hit carries the
 * WIDTH of the piece it encloses (`loopWidth`), because not every crossing is
 * a loop — see `WIND_SWEEP.loopMinWidthNm`.
 *
 * Same uniform grid and the same reason as `firstCrossing` — a loop can span
 * any number of vertices and an index window would be a guess. `path` is open:
 * there is no closing segment and none is walked.
 *
 * @param {Array<[number, number]>} path
 * @returns {Array<{i: number, j: number, at: [number, number], width: number}>}
 */
export function pathCrossings(path) {
  const n = path?.length || 0;
  if (n < 4) return [];

  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  }
  const cell = total / (n - 1);
  if (!(cell > 0)) return [];

  const buckets = new Map();
  for (let i = 0; i < n - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx},${cy}`;
        const list = buckets.get(k);
        if (list) list.push(i); else buckets.set(k, [i]);
      }
    }
  }

  const seen = new Set();
  const out = [];
  for (const list of buckets.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]);
        const j = Math.max(list[p], list[q]);
        /* Neighbouring segments share an endpoint. Not a crossing. */
        if (j <= i + 1) continue;
        const key = `${i},${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const at = segCross(path[i], path[i + 1], path[j], path[j + 1]);
        if (at) out.push({ i, j, at, width: loopWidth([at, ...path.slice(i + 1, j + 1)]) });
      }
    }
  }
  /* A segment straddling several cells is bucketed several times, so the walk
   * above can reach the same pair from more than one cell. `seen` is what
   * makes the answer independent of iteration order, not a tidy-up. */
  out.sort((a, b) => a.i - b.i || a.j - b.j);
  return out;
}

/**
 * The FEWEST vertex indices at which to break a path so no piece keeps a
 * crossing.
 *
 * ==> THE COUNT MATTERS, WHICH IS WHY THIS IS SOLVED RATHER THAN GUESSED. <==
 * Every break is a second translucent polygon overlapping the first and a
 * second outline drawn across the band, so a lazy rule that breaks at both
 * ends of every crossing pays that cost twice over and pays it again for loops
 * that could have shared a break. Nadine 2012 has four real loops and needs
 * two breaks, not four and not eight.
 *
 * Breaking at index `k` puts `path[0..k]` in one piece and `path[k..end]` in
 * the next — they SHARE vertex `k`, so the corridors meet rather than leaving
 * a gap. A crossing between segment `i` and segment `j` is separated by any
 * break in `[i + 1, j]`, so this is interval stabbing: sort by the right end
 * and take that end whenever the next span is not already covered. That is
 * optimal, and it is four lines.
 *
 * @param {Array<{i: number, j: number}>} crossings
 * @returns {number[]} ascending, no duplicates
 */
export function splitIndices(crossings) {
  const spans = (crossings || []).map((c) => [c.i + 1, c.j]).sort((a, b) => a[1] - b[1]);
  const cuts = [];
  let last = -1;
  for (const [lo, hi] of spans) {
    if (last >= lo && last <= hi) continue;
    cuts.push(hi);
    last = hi;
  }
  return cuts;
}

/** Twice the signed area of a closed ring. */
export function ringArea2(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/**
 * Cut the artefact loop out of a ring that crosses itself at `hit`, in place.
 *
 * The crossing splits the ring into two closed pieces that meet at one point:
 * `inner` (the vertices between the two crossing segments) and `outer`
 * (everything else). Both get the intersection point as their join. The larger
 * by area is the storm; the smaller is the fold, and it goes.
 */
export function cutLoop(ring, hit) {
  const { i, j, at } = hit;
  const inner = [at, ...ring.slice(i + 1, j + 1)];
  const outer = [at, ...ring.slice(j + 1), ...ring.slice(0, i + 1)];
  const keep = Math.abs(ringArea2(outer)) >= Math.abs(ringArea2(inner)) ? outer : inner;
  ring.length = 0;
  ring.push(...keep);
}

