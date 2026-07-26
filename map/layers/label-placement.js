/**
 * label-placement.js — spoke placement for forecast time labels (SPEC §7).
 *
 * THE PROBLEM MapLibre CANNOT SOLVE FOR US.
 * Its collision engine only hides colliding labels (`text-optional`), and
 * `text-variable-anchor` can only try a fixed menu of anchors. Neither can:
 *   - place a label on the axis perpendicular to the TRACK at that point, or
 *   - keep a run of labels on ONE side of the track, or
 *   - split the run into a small number of contiguous groups when one side
 *     will not hold them all.
 * All three are the requested behaviour, so placement is computed here and
 * handed to MapLibre as a plain per-feature pixel offset it just draws.
 *
 * THE MODEL — a spoke on a wheel.
 * Each forecast point sits on a track. The track's local bearing at that
 * point gives a tangent; the label rides the NORMAL to it, so the label, the
 * point, and the track form a spoke. Both normals are valid, hence a side:
 * +1 or -1.
 *
 * WHY THE TRACK'S ANGLE DECIDES WHETHER THIS IS EASY (measured 2026-07-26).
 * On a DIAGONAL track the spoke has both an across and an up component, so
 * consecutive labels staircase and clear each other with room to spare — all
 * eight sit happily on one side. On a DUE WEST track the spoke is straight
 * up, every label lands at the same height, and the row becomes eight 80px
 * boxes at 50px spacing. They cannot all fit on one side, and no choice of
 * side changes that. Measured across spacings: one side is clean at 90px
 * apart and impossible at 50–70px. A westward storm at moderate zoom is
 * therefore the only case any of this machinery exists for.
 *
 * WHAT REPLACED THE OLD PER-LABEL FLIPPING, AND WHY.
 * The previous version placed labels one at a time and flipped each one that
 * collided with the label before it. On a westward track that produces
 * up-down-up-down all the way along: measured seven side changes in eight
 * labels. It fit every label and read as noise. A label's side is not a
 * property of that label — it is a property of the RUN it belongs to.
 *
 * So the arrangement is chosen whole:
 *   1. Every label on one side. If that fits, done — this is the common case
 *      and it is what a diagonal track always gets.
 *   2. Otherwise try every single split point: the first N labels on one
 *      side, the rest on the other. Two contiguous groups, one side change.
 *   3. Otherwise try every pair of split points. Three groups, two changes.
 *   4. LABEL_PLACEMENT.maxRuns stops it there. A fourth group would be two
 *      labels long and we would be back to alternating under a new name.
 *
 * Whatever still will not fit is HIDDEN rather than flipped out of its
 * group. That is the deliberate trade: on a westward storm zoomed out you
 * see roughly half the times, all on one side, legible — and the rest appear
 * as you zoom in and the dots spread apart. Zoom is already the density
 * control for every other label in the app. Four readable times beat eight
 * fighting each other on a phone.
 *
 * Arrangements are ranked by labels kept, then fewest groups, then the
 * evenest split. Keeping the most labels cannot smuggle alternation back in,
 * because alternation needs a group per label and the cap forbids it.
 *
 * WHY THIS RUNS ON `moveend`, NOT PER FRAME (§ performance lens).
 * Screen positions change every frame during a drag; recomputing placement
 * per frame on a phone is exactly the frame-budget spend the overriding lens
 * forbids. Labels therefore settle when the CAMERA settles. During a drag
 * they hold their last offsets, which can look briefly stale on a hard
 * rotate — the accepted cost of a globe that stays at frame rate.
 *
 * Imports: config only. Nothing imports this but points-forecast.js.
 * `map` is a MapLibre instance; this file never touches THREE or the DOM.
 */

import { LABEL_PLACEMENT } from '../../config/constants.js';

/** Screen-space bearing of the track through a point, in radians.
 *  Uses the neighbours when they exist so the spoke follows the real curve;
 *  falls back to whichever single neighbour is available. A lone point has
 *  no track, so it gets a horizontal tangent and the label sits straight
 *  above it — the honest default rather than a guessed angle. */
function tangentAt(pts, i) {
  const prev = pts[i - 1];
  const next = pts[i + 1];
  const a = prev || pts[i];
  const b = next || pts[i];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx);
}

/** Everything about a point that does not depend on which side it lands on,
 *  worked out once. The search below builds the same boxes hundreds of
 *  times; the trig and the width estimate must not be inside that loop.
 *
 *  Width is estimated from character count — we cannot measure rendered text
 *  without a canvas round-trip, and the label is a predictable short string
 *  ("1:00 PM Thu"), so an em-width estimate is accurate enough for collision
 *  and costs nothing. Overestimating slightly is the safe direction: it
 *  spreads labels rather than letting them touch. */
function prepare(pts) {
  return pts.map((p, i) => {
    const angle = tangentAt(pts, i) + Math.PI / 2;
    return {
      x: p.x,
      y: p.y,
      /* Unit normal for side +1. Side -1 is this negated. */
      nx: Math.cos(angle),
      ny: Math.sin(angle),
      w: (p.text?.length || 0) * LABEL_PLACEMENT.charWidthPx + LABEL_PLACEMENT.padPx * 2,
      h: LABEL_PLACEMENT.lineHeightPx + LABEL_PLACEMENT.padPx * 2,
    };
  });
}

/** Axis-aligned box for a prepared point placed at `side` on its spoke. */
function boxFor(p, side) {
  const ox = p.nx * side * LABEL_PLACEMENT.spokePx;
  const oy = p.ny * side * LABEL_PLACEMENT.spokePx;
  return { cx: p.x + ox, cy: p.y + oy, w: p.w, h: p.h, ox, oy };
}

function overlaps(a, b) {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.w + b.w &&
    Math.abs(a.cy - b.cy) * 2 < a.h + b.h
  );
}

/**
 * The order we would rather keep labels in when they cannot all fit.
 *
 * The first point and the last point lead: the nearest forecast hour is what
 * a reader looks at first, and the far end is where the cone stops, so
 * dropping either is the one thing thinning must not do casually. After
 * those, each remaining index is added by taking whichever sits FARTHEST
 * from everything already kept. That spreads the survivors evenly along the
 * track instead of clearing one stretch of it and leaving a bare gap in the
 * middle of the forecast.
 *
 * Depends only on the count, so it is memoised — the search calls it once
 * per candidate arrangement.
 */
const keepOrderCache = new Map();
function keepOrder(n) {
  const hit = keepOrderCache.get(n);
  if (hit) return hit;

  const order = [];
  if (n > 0) order.push(0);
  if (n > 1) order.push(n - 1);
  const taken = new Set(order);

  while (order.length < n) {
    let bestI = -1;
    let bestGap = -1;
    for (let i = 0; i < n; i++) {
      if (taken.has(i)) continue;
      let gap = Infinity;
      for (const t of taken) gap = Math.min(gap, Math.abs(i - t));
      if (gap > bestGap) { bestGap = gap; bestI = i; }
    }
    order.push(bestI);
    taken.add(bestI);
  }

  keepOrderCache.set(n, order);
  return order;
}

/** Sides array from a starting side and a list of split indices. A split at
 *  k means the side changes AT k, so k begins a new group. */
function sidesFrom(n, splits, first) {
  const out = new Array(n);
  let side = first;
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (s < splits.length && i === splits[s]) { side = -side; s++; }
    out[i] = side;
  }
  return out;
}

/**
 * Lay one arrangement down and see what survives.
 *
 * Labels are placed in keep order, and anything that lands on top of an
 * already-placed label is hidden. It is never moved to the other side —
 * that is what produced the alternation this file exists to stop. A group's
 * side is fixed by the arrangement; the only remaining question is whether
 * each label fits inside it.
 */
function layDown(prepared, sides) {
  const n = prepared.length;
  const hidden = new Array(n).fill(false);
  const boxes = new Array(n);
  const placed = [];

  for (const i of keepOrder(n)) {
    const box = boxFor(prepared[i], sides[i]);
    boxes[i] = box;
    let clash = false;
    for (const other of placed) {
      if (overlaps(box, other)) { clash = true; break; }
    }
    if (clash) hidden[i] = true;
    else placed.push(box);
  }

  /* Groups and balance are counted over what is actually VISIBLE, because
   * that is what a reader sees. An arrangement whose middle group thins away
   * entirely reads as one clean side change, not two, and should be ranked
   * as the cleaner result it is. */
  let kept = 0;
  let plus = 0;
  let runs = 0;
  let lastSide = 0;
  for (let i = 0; i < n; i++) {
    if (hidden[i]) continue;
    kept++;
    if (sides[i] > 0) plus++;
    if (sides[i] !== lastSide) { runs++; lastSide = sides[i]; }
  }

  return { hidden, boxes, kept, runs, imbalance: Math.abs(plus * 2 - kept) };
}

/** Is `a` the better arrangement OF THE SAME GROUP COUNT? Show the most
 *  labels; among equals prefer the evenest split, so seven labels as four
 *  and three beats seven as six and one. Choosing BETWEEN group counts is a
 *  separate question, settled in `placeSpokes` — see the keep floor there. */
function betterWithinRuns(a, b) {
  if (!b) return true;
  if (a.kept !== b.kept) return a.kept > b.kept;
  return a.imbalance < b.imbalance;
}

/** Every arrangement worth trying, cheapest and cleanest first. */
function* arrangements(n) {
  for (const first of [1, -1]) yield sidesFrom(n, [], first);
  if (n < 2 || LABEL_PLACEMENT.maxRuns < 2) return;

  for (const first of [1, -1]) {
    for (let k = 1; k < n; k++) yield sidesFrom(n, [k], first);
  }
  if (n < 3 || LABEL_PLACEMENT.maxRuns < 3) return;
  if (n > LABEL_PLACEMENT.maxPointsForThreeRuns) return;

  for (const first of [1, -1]) {
    for (let a = 1; a < n - 1; a++) {
      for (let b = a + 1; b < n; b++) yield sidesFrom(n, [a, b], first);
    }
  }
}

/**
 * Place one storm's forecast labels.
 *
 * @param {Array<{x:number,y:number,text:string}>} pts  Screen-space points in
 *        TRACK ORDER, ALL FROM ONE STORM. Both are hard preconditions the
 *        caller must guarantee: the tangent is derived from pts[i-1] and
 *        pts[i+1], so a list spanning two storms derives a tangent from the
 *        chord between them and the resulting normals are meaningless. That
 *        was a real, long-lived bug — see the header of points-forecast.js.
 * @returns {Array<{ox:number,oy:number,side:number,hidden:boolean}>} one
 *          entry per input point, in the same order. `ox`/`oy` are the spoke
 *          vector IN PIXELS, pointing from the point out to the label centre;
 *          the caller converts to ems. Screen-space convention: +y is DOWN,
 *          which is also what `text-offset` expects, so no flip is needed.
 */
export function placeSpokes(pts) {
  if (!pts.length) return [];

  const prepared = prepare(pts);
  const n = prepared.length;

  /* Keep the best arrangement AT EACH GROUP COUNT rather than one overall
   * winner. The choice between "eight labels on one side" and "nine labels
   * with one stranded across the track" is not a comparison two numbers can
   * settle — it needs the floor applied below, and that needs both options
   * still on the table. Indexed by how many groups are VISIBLE, which is
   * what a reader actually sees: an arrangement whose middle group thins
   * away entirely reads as one side change, not two, and is ranked as the
   * cleaner result it is. */
  const byRuns = [];
  for (const sides of arrangements(n)) {
    const result = layDown(prepared, sides);
    const slot = byRuns[result.runs];
    if (betterWithinRuns(result, slot?.result)) byRuns[result.runs] = { result, sides };
    /* Every label on one side is the goal and nothing can beat it. Stop the
     * search the moment we have it rather than scoring another two hundred
     * arrangements that cannot win — this is the common case, and it should
     * cost the least. */
    if (result.kept === n && result.runs <= 1) break;
  }

  /* FEWEST GROUPS WINS, above a floor. Walk up from one group and take the
   * first that still shows enough of the forecast. This is the whole point
   * of the rewrite: the tidiest arrangement is preferred even when a busier
   * one would fit one more label, and only a genuinely jammed side — a track
   * doubling back on itself — is allowed to force the split. */
  let best = null;
  const most = byRuns.reduce((m, e) => (e && e.result.kept > m ? e.result.kept : m), 0);
  const floor = Math.ceil(most * LABEL_PLACEMENT.minKeepFraction);
  for (const entry of byRuns) {
    if (entry && entry.result.kept >= floor) { best = entry; break; }
  }
  /* The floor is a preference, never a way to end up with nothing: if no
   * arrangement clears it (only reachable when `most` is 0 and every label
   * is on top of every other), fall back to whichever showed the most. */
  if (!best) {
    for (const entry of byRuns) {
      if (entry && (!best || entry.result.kept > best.result.kept)) best = entry;
    }
  }

  const bestResult = best.result;
  const bestSides = best.sides;

  return prepared.map((_, i) => ({
    ox: bestResult.boxes[i].ox,
    oy: bestResult.boxes[i].oy,
    side: bestSides[i],
    hidden: bestResult.hidden[i],
  }));
}
