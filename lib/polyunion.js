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
      /* ==> A CROSSING THAT LANDS ON A VERTEX MARKS THAT VERTEX, IT IS NOT
       * DROPPED. <== Skipping it here was a real bug: the same crossing would
       * be spliced into one ring as a new point and silently omitted from the
       * other, whose vertex it happened to sit on. The two rings then
       * disagreed about where they met and the chain ran off the end. Found on
       * Danielle 2022. */
      if (same(h, a)) { out[out.length - 1].cross = true; continue; }
      if (same(h, b)) continue; /* the next turn of this loop owns it */
      if (!out.some((e) => same(e.pt, h))) out.push({ pt: h, cross: true });
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
 * @returns {Array<Array<[number, number]>> | null} open rings — the shell
 *   first, then any holes — or null to fall back
 */
export function unionRings(rings, { stepBudget = 2 } = {}) {
  const live = (rings || []).filter((r) => r && r.length >= 3);
  if (live.length === 0) return null;
  if (live.length === 1) return [live[0].slice()];

  /* Drop the swallowed ones. A ring is inside another when every one of its
   * vertices is, which is stricter than testing one and cheap at this size. */
  const kept = live.filter((r, i) => !live.some(
    (o, j) => j !== i
      && area(o) >= area(r)
      && r.every((v) => pointInRing(v, o, { onBoundary: true }))
  ));
  if (kept.length === 0) return null;
  if (kept.length === 1) return [kept[0].slice()];

  const walks = kept.map((r, i) => annotate(r, kept.filter((_, j) => j !== i)));

  /* ---- Cut every ring into ARCS at its crossings. An arc runs from one
   * crossing to the next, carrying whatever plain vertices lie between. */
  const arcs = [];
  for (let i = 0; i < walks.length; i++) {
    const w = walks[i];
    const marks = [];
    for (let k = 0; k < w.length; k++) if (w[k].cross) marks.push(k);
    /* A ring nothing crosses is one arc, closed on itself. It is either the
     * whole answer or a separate component, and the chain below decides. */
    if (!marks.length) { arcs.push({ pts: w.map((e) => e.pt), closed: true }); continue; }
    for (let m = 0; m < marks.length; m++) {
      const from = marks[m];
      const to = marks[(m + 1) % marks.length];
      const pts = [w[from].pt];
      for (let k = (from + 1) % w.length; k !== to; k = (k + 1) % w.length) pts.push(w[k].pt);
      pts.push(w[to].pt);
      arcs.push({ pts, closed: false });
    }
  }

  /* ---- Keep the arcs that run along the OUTSIDE.
   *
   * ==> THE TEST IS ONE POINT IN THE MIDDLE OF THE ARC, AND THAT IS THE WHOLE
   * IDEA. <== An arc between two crossings is entirely inside another ring or
   * entirely outside it — it cannot be half of each, because changing sides is
   * what a crossing IS. So one interior point settles the arc, and no
   * direction, winding or entry/exit bookkeeping is needed anywhere. The
   * midpoint is taken along the arc's own length rather than as an average of
   * its ends, which on a curved arc can land off it. */
  const midOf = (pts) => {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let want = total / 2;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (want <= d || i === pts.length - 1) {
        const t = d > 0 ? want / d : 0.5;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
          pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      want -= d;
    }
    return pts[0];
  };
  const outer = arcs.filter((a) => !kept.some((r) => pointInRing(midOf(a.pts), r)));
  if (!outer.length) return null;

  /* ---- Chain them nose to tail. Every kept arc ends where exactly one other
   * kept arc begins; anything else is a shape this does not model. */
  /* ==> ENDS ARE MATCHED BY PROXIMITY, NOT BY A ROUNDED KEY. <== The same
   * crossing is solved twice, once from each ring's segment, and the two
   * answers differ in the last bits. A grid key puts two such points in
   * different cells whenever they straddle a boundary, and the chain then
   * cannot find its own continuation. `same` has no such seam. There are tens
   * of arcs, so the linear scan costs nothing. */
  const startingAt = (pt) => outer.filter((a) => !a.closed && same(a.pts[0], pt));

  const closedOnes = outer.filter((a) => a.closed);
  if (closedOnes.length) {
    /* A ring nothing crossed AND nothing contains is a separate island. Two
     * disjoint pieces land here, and merging them would draw wind across
     * ground between them that nothing reached. */
    if (closedOnes.length !== outer.length || closedOnes.length !== 1) return null;
    return [closedOnes[0].pts.slice()];
  }

  /* ---- Chain the arcs into closed rings. There can be more than one.
   *
   * ==> A LOOP'S CENTRE IS A HOLE, AND IT IS A TRUE ONE. <== A storm that
   * circles a patch of ocean without its wind field ever reaching the middle
   * leaves ground that saw no storm-force wind. That region's boundary is part
   * of the union's boundary just as the outside is, so the chain closes on it
   * separately. Filling it would claim wind the record does not carry (§5),
   * which is the same rule that stops a no-wind break healing. GeoJSON says
   * holes in so many words: rings after the first are subtracted. */
  const used = new Set();
  const closedRings = [];
  const budget = stepBudget * arcs.length;
  let steps = 0;

  for (const seed of outer) {
    if (used.has(seed)) continue;
    let current = seed;
    const ring = [];
    let ok = false;
    while (steps++ <= budget) {
      if (used.has(current)) break;
      used.add(current);
      for (let i = 0; i < current.pts.length - 1; i++) {
        const p = current.pts[i];
        if (!ring.length || !same(p, ring[ring.length - 1])) ring.push(p);
      }
      const end = current.pts[current.pts.length - 1];
      if (same(end, ring[0])) { ok = true; break; }
      const nexts = startingAt(end).filter((a) => !used.has(a));
      if (nexts.length !== 1) break;
      [current] = nexts;
    }
    if (!ok || ring.length < 3) return null;
    closedRings.push(ring);
  }
  if (steps > budget) return null;

  /* ==> EVERY OUTSIDE ARC HAS TO BE IN THE ANSWER. <== An arc left over means
   * a piece of boundary went missing, which is a band drawn short of ground it
   * covered — silently. */
  if (used.size !== outer.length || !closedRings.length) return null;

  /* The biggest ring is the outside; the rest are holes, and each has to sit
   * inside it or the pieces were never one shape to begin with. */
  closedRings.sort((a, b) => area(b) - area(a));
  const [shell, ...holes] = closedRings;
  for (const h of holes) {
    if (!h.every((v) => pointInRing(v, shell, { onBoundary: true }))) return null;
  }

  /* ==> AND THE ANSWER HAS TO CONTAIN EVERY INPUT. <== The last guard, and it
   * is cheap. A union cannot be smaller than any piece it merged, so if any
   * piece pokes out of the shell the chain took a wrong turn somewhere and the
   * band would be drawn short of ground it covered — the §7.12 fault arriving
   * through the fix for it. Refuse, and the caller draws the separate pieces.
   *
   * The test is against the SHELL, not the shell minus its holes: a hole is
   * ground genuinely inside every piece's outline and outside all of them at
   * once, and asking a piece's vertices to avoid it would refuse every storm
   * that loops, which is all of them. */
  const areaShell = area(shell);
  for (const r of kept) {
    if (area(r) > areaShell * 1.001) return null;
    if (!r.every((v) => pointInRing(v, shell, { onBoundary: true }))) return null;
  }

  return [shell, ...holes];
}
