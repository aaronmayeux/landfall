/*
 * polyunion.js — merging the swath's split pieces back into one shape.
 *
 * ==> WHY THIS EXISTS <==
 * SPEC-MAP.md §7.12 fault 4 breaks a wind band wherever the storm drove back
 * across its own track, because a corridor traced as two offset walls stops
 * describing a swept region once the path overlaps itself. That fixed the
 * nesting — Jeanne 2004's 64 kt outline went from 26.2% outside her 34 kt band
 * to 0% — and it created a second problem on glass.
 *
 * **Aaron, 2026-08-30, off the phone: the bands overlapped and drew edges
 * inside their own colour.** Two symptoms, one cause. A band is several
 * polygons now, so the line layer outlines EVERY one of them including the cap
 * at a cut, and the fill double-darkens where two overlap — 0.14 on 0.14 reads
 * as 0.26. Measured: 12.2% of Jeanne's outline and 17.7% of Nadine 2012's was
 * boundary buried inside a sibling piece, against 0% before the split.
 *
 * ==> THE HONEST FIX IS THAT THE SWATH *IS* ONE REGION AND SHOULD BE ONE
 * SHAPE. <== Trimming only the outlines would have hidden the edges and left
 * the fill wrong, and the arc-trimming it needs is most of this file anyway.
 *
 * ==> IT IS A UNION OF A HANDFUL OF PIECES, NOT A GENERAL CLIPPER, AND THAT IS
 * WHAT MAKES IT SMALL ENOUGH TO OWN. <== The inputs are not arbitrary
 * polygons. They are consecutive stretches of one corridor, each already
 * simple (`sweepRun` cuts its own loops), and consecutive pieces SHARE a track
 * point — so where they meet they properly overlap rather than touching.
 * There is no build step in this project and no library to lean on (§12), and
 * a general polygon clipper is a great deal of code to carry for a shape this
 * constrained.
 *
 * ==> IT FAILS BY GIVING UP, NOT BY GUESSING. <== Every anomaly — a walk that
 * does not close, a step budget exhausted, a ring that comes back degenerate —
 * returns null, and the caller draws the separate pieces exactly as it does
 * today. That is what makes this safe to ship to the live globe in hurricane
 * season: the worst case is the shape that is already on the phone.
 *
 * Pure functions. No DOM, no network, no clock, no map. Imports one sibling.
 */

import { segCross, ringArea2 } from './unloop.js';

/* How close two coordinates have to be to count as the same point. The frame
 * is nautical miles, so this is about two metres — far below anything the
 * sweep resolves (its vertices sit 5 nm apart) and far above float noise on
 * numbers of this magnitude. */
const EPS = 1e-3;

const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/**
 * Is this point strictly inside the ring? Even-odd, with points ON the
 * boundary reported as OUTSIDE.
 *
 * ==> THE BOUNDARY CASE IS THE WHOLE DIFFICULTY AND IT IS DECIDED
 * DELIBERATELY. <== Every intersection point sits exactly on both rings by
 * construction. If those counted as "inside", the walk would discard the arcs
 * either side of every crossing and unravel. Reporting them outside keeps them
 * eligible, and the walk's own direction rule decides which one to take.
 */
export function pointInRing(pt, ring, { onBoundary = false } = {}) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    /* On the segment? Answer directly rather than letting the parity test
     * decide it, which it does arbitrarily. */
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    if (len2 > 0) {
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / len2));
      const px = xi + dx * t;
      const py = yi + dy * t;
      if (Math.hypot(x - px, y - py) < EPS) return onBoundary;
    }

    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ring area, absolute, in the frame's own square units. */
const area = (r) => Math.abs(ringArea2(r) / 2);

/**
 * Insert every crossing with `others` into `ring`, and mark each vertex with
 * whether it lies inside any of them.
 *
 * Returns [{ pt, inside, cross }], the ring walked in its own order with the
 * intersection points spliced in at the right places.
 */
function annotate(ring, others) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push({ pt: a, cross: false });

    /* Every crossing on segment a→b, ordered along it, so the ring stays a
     * ring. Sorting by distance from `a` is what keeps two crossings on one
     * segment from being spliced in backwards. */
    const hits = [];
    for (const o of others) {
      for (let j = 0; j < o.length; j++) {
        const at = segCross(a, b, o[j], o[(j + 1) % o.length]);
        if (at) hits.push(at);
      }
    }
    hits.sort((p, q) => Math.hypot(p[0] - a[0], p[1] - a[1]) - Math.hypot(q[0] - a[0], q[1] - a[1]));
    for (const h of hits) {
      if (!same(h, a) && !same(h, b) && !out.some((e) => same(e.pt, h))) {
        out.push({ pt: h, cross: true });
      }
    }
  }
  for (const e of out) {
    e.inside = !e.cross && others.some((o) => pointInRing(e.pt, o));
  }
  return out;
}

/**
 * The union of several simple rings, or null if it cannot be done cleanly.
 *
 * ==> THE WALK: FOLLOW THE OUTSIDE, SWITCH RINGS AT EVERY CROSSING. <== Start
 * on a vertex that is outside every other ring. Walk forward. At a crossing,
 * hop to whichever ring leaves that point heading OUTSIDE the others, and keep
 * going. Come back to the start and the outer boundary is traced. That is the
 * classic union walk with the degenerate cases refused rather than handled.
 *
 * ==> A RING WHOLLY INSIDE ANOTHER IS DROPPED BEFORE THE WALK. <== It
 * contributes nothing to the boundary and it has no crossing to hop at, so the
 * walk would never reach it and would report a failure that is not one.
 *
 * `rings` are OPEN (no repeated closing vertex).
 *
 * @param {Array<Array<[number, number]>>} rings
 * @param {{stepBudget?: number}} [opts] steps allowed per vertex before the
 *   walk is abandoned; see `WIND_SWEEP.unionStepBudget`
 * @returns {Array<[number, number]> | null} an open ring, or null to fall back
 */
export function unionRings(rings, { stepBudget = 2 } = {}) {
  const live = (rings || []).filter((r) => r && r.length >= 3);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0].slice();

  /* Drop the swallowed ones. A ring is inside another when every one of its
   * vertices is, which is stricter than testing one and cheap at this size. */
  const kept = live.filter((r, i) => !live.some(
    (o, j) => j !== i
      && area(o) >= area(r)
      && r.every((v) => pointInRing(v, o, { onBoundary: true }))
  ));
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].slice();

  const walks = kept.map((r, i) => annotate(r, kept.filter((_, j) => j !== i)));

  /* Somewhere to start: a vertex outside everything else. If there is none,
   * the pieces are disjoint or arranged in a way this does not model. */
  let startRing = -1;
  let startAt = -1;
  for (let i = 0; i < walks.length && startRing < 0; i++) {
    for (let k = 0; k < walks[i].length; k++) {
      if (!walks[i][k].inside && !walks[i][k].cross) { startRing = i; startAt = k; break; }
    }
  }
  if (startRing < 0) return null;

  /* ==> A BUDGET, BECAUSE A WALK THAT DOES NOT TERMINATE IS THE ONE FAILURE
   * THAT WOULD FREEZE A PHONE. <== Blowing it means the geometry is outside
   * what this models, and null is the answer. See `WIND_SWEEP.unionStepBudget`
   * for the size and the measurement behind it. */
  const budget = stepBudget * walks.reduce((s, w) => s + w.length, 0);

  const out = [];
  let ring = startRing;
  let at = startAt;
  let steps = 0;

  while (steps++ < budget) {
    const here = walks[ring][at];
    if (out.length && same(here.pt, out[0])) break; /* closed */
    if (!out.length || !same(here.pt, out[out.length - 1])) out.push(here.pt);

    at = (at + 1) % walks[ring].length;
    const next = walks[ring][at];
    if (!next.cross) {
      /* Walking into another piece's interior means this arc is buried and
       * the boundary left with the crossing we just passed. That should not
       * happen after a hop, so treat it as a shape this does not model. */
      if (next.inside) return null;
      continue;
    }

    /* At a crossing: hop to the ring whose next vertex is NOT inside anything.
     * That is the one still tracing the outside. */
    let hopped = false;
    for (let i = 0; i < walks.length && !hopped; i++) {
      if (i === ring) continue;
      const k = walks[i].findIndex((e) => same(e.pt, next.pt));
      if (k < 0) continue;
      const after = walks[i][(k + 1) % walks[i].length];
      if (after.inside) continue;
      ring = i;
      at = k;
      hopped = true;
    }
    /* No hop available means the other ring leaves here inward too; carry on
     * along this one, which is the correct answer when a crossing only grazes. */
  }
  if (steps >= budget) return null;

  if (out.length < 3) return null;

  /* ==> THE ANSWER HAS TO CONTAIN EVERY INPUT, AND THAT IS CHECKED RATHER THAN
   * ARGUED. <== A union cannot be smaller than any piece it merged. Two
   * failures both look plausible without this and both lose a band:
   *
   *   - DISJOINT PIECES. Nothing crosses, so the walk goes once round the
   *     first ring and closes. The result is a perfectly good polygon that has
   *     silently DROPPED the other one. Caught by a constructed test on two
   *     squares a hundred units apart, which returned one of them.
   *   - A WRONG TURN. Any hop onto an arc that was actually inside another
   *     piece cuts a bite out of the result.
   *
   * Both are a band losing ground it covered, which is the §7.12 fault this
   * whole pass exists to end. Refuse, and the caller draws the pieces. */
  const areaOut = area(out);
  for (const r of kept) {
    if (area(r) > areaOut * 1.001) return null;
    if (!r.every((v) => pointInRing(v, out, { onBoundary: true }))) return null;
  }

  return out;
}
