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

