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
 * THE MODEL — the text IS the spoke.
 * Each forecast point sits on a track. The track's local bearing at that
 * point gives a tangent; the spoke runs along the NORMAL to it. The label is
 * then ROTATED to lie along that spoke and anchored at its near end, so the
 * line of text starts just outside the dot and runs outward, pointing back at
 * the dot's centre like a spoke on a bicycle wheel. Both normals are valid,
 * hence a side: +1 or -1.
 *
 * ROTATING THE TEXT IS THE WHOLE FEATURE, and it took three sessions to
 * understand that. Earlier versions computed the right spoke VECTOR and then
 * drew horizontal text parked at the end of it. The offsets were correct the
 * whole time; the text just never turned. Horizontal text beside a dot does
 * not read as radiating from anything, which is why every fix "worked" in
 * isolation and looked wrong on the phone.
 *
 * MapLibre CAN do this, verified by reading the bundled 5.6.0 source rather
 * than from memory: `text-rotate`, `text-anchor` and `text-offset` are all
 * property-type `data-driven`, and the rotation matrix is applied to glyph
 * positions that ALREADY include the offset. So an offset of [g, 0] with
 * `text-anchor: 'left'` and `text-rotate: angle` puts the start of the text
 * g pixels out along `angle`. That last detail is the one the whole approach
 * rests on.
 *
 * TEXT MUST NEVER READ UPSIDE DOWN. A spoke pointing left would mirror the
 * text, so when the spoke points leftward the rotation is turned back by 180
 * and the anchor flips to `right` with a negated offset. Same pixels on
 * screen, same direction out from the dot, text still reading left to right.
 *
 * ROTATION ALSO LARGELY DISSOLVES THE CROWDING. Horizontal labels on a
 * westward track are 80px-wide boxes in a row 50px apart and cannot all fit.
 * Rotated onto a vertical spoke the same labels become thin vertical strips,
 * and all of them fit on one side with room to spare. The grouping and
 * thinning below still exist for the cases where they do not.
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
 *  Length is estimated from character count — we cannot measure rendered text
 *  without a canvas round-trip, and the label is a predictable short string
 *  ("1:00 PM Thu"), so an em-width estimate is accurate enough for collision
 *  and costs nothing. Overestimating slightly is the safe direction: it
 *  spreads labels rather than letting them touch. */
function prepare(pts) {
  return pts.map((p, i) => {
    /* The spoke for side +1. Side -1 is this angle plus 180. Screen space:
     * +y is DOWN, so this angle is already clockwise-from-east, which is the
     * convention `text-rotate` uses. No conversion anywhere. */
    const angle = tangentAt(pts, i) + Math.PI / 2;
    return {
      x: p.x,
      y: p.y,
      angle,
      /* Along the spoke: how long the text runs. Across it: one line tall. */
      len: (p.text?.length || 0) * LABEL_PLACEMENT.charWidthPx,
      thick: LABEL_PLACEMENT.lineHeightPx,
    };
  });
}

/**
 * Where a label lands, given its side.
 *
 * The text runs from `spokeStartPx` out to `spokeStartPx + len` along the
 * spoke, so its centre sits at the midpoint of that span. The result is an
 * ORIENTED box — centre, unit axis along the text, and half-extents along
 * and across it.
 *
 * IT MUST BE ORIENTED, NOT AXIS-ALIGNED. An axis-aligned box around a 45°
 * label is a 74x74 square drawn around a strip that is really 86x19, so two
 * neighbouring labels on a diagonal track "collide" with a clear 70px
 * between them. Measured: it cut a diagonal storm from eight labels to four.
 * Thin rotated strips are the whole reason rotation relieves the crowding,
 * so the collision test has to be able to see that they are thin.
 */
function boxFor(p, side) {
  const a = side > 0 ? p.angle : p.angle + Math.PI;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const mid = LABEL_PLACEMENT.spokeStartPx + p.len / 2;
  return {
    cx: p.x + ux * mid,
    cy: p.y + uy * mid,
    ux,
    uy,
    hl: p.len / 2 + LABEL_PLACEMENT.padPx,
    ht: p.thick / 2 + LABEL_PLACEMENT.padPx,
  };
}

/** Half-width of `box` projected onto the unit axis (nx, ny). */
function extent(box, nx, ny) {
  return (
    box.hl * Math.abs(box.ux * nx + box.uy * ny) +
    box.ht * Math.abs(-box.uy * nx + box.ux * ny)
  );
}

/** Separating-axis test for two oriented boxes. Four axes is the whole
 *  proof: two rectangles miss each other if and only if one of their four
 *  edge normals separates them. Exact, not an approximation. */
function overlaps(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const axes = [a.ux, a.uy, -a.uy, a.ux, b.ux, b.uy, -b.uy, b.ux];
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i];
    const ny = axes[i + 1];
    if (Math.abs(dx * nx + dy * ny) > extent(a, nx, ny) + extent(b, nx, ny)) return false;
  }
  return true;
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
  const placed = [];

  for (const i of keepOrder(n)) {
    const box = boxFor(prepared[i], sides[i]);
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

  return { hidden, kept, runs, imbalance: Math.abs(plus * 2 - kept) };
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
 * @returns {Array<{rotDeg:number,anchor:string,offPx:number,side:number,
 *          hidden:boolean}>} one entry per input point, in the same order.
 *          `rotDeg` goes straight to `text-rotate`, `anchor` to
 *          `text-anchor`, and `offPx` is the offset along the TEXT's own x
 *          axis in pixels — the caller converts to ems and passes it as
 *          `[offPx/size, 0]`. It is one number and not a vector on purpose:
 *          the text rotates, so the offset rotates with it, and a screen-
 *          space vector here would be applied in the wrong frame.
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

  return prepared.map((p, i) => {
    const side = bestSides[i];
    /* Degrees clockwise from east, which is what `text-rotate` takes. */
    let deg = ((side > 0 ? p.angle : p.angle + Math.PI) * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;

    /* READABILITY FLIP. A spoke pointing leftward would draw the text
     * mirrored. Turn the rotation back by 180 and anchor the text at its
     * RIGHT end instead, with the offset negated: the text occupies the same
     * pixels, still runs outward from the dot along the same spoke, and
     * still reads left to right. */
    const flip = deg > 90 && deg < 270;
    if (flip) deg -= 180;
    /* Into (-180, 180] so the number reads the way a person thinks about a
     * tilt. 270 and -90 are the same rotation; only one of them is legible
     * in a log or a test failure. */
    if (deg > 180) deg -= 360;

    /* The tilt cap, if one is set. Clamping the angle without moving the
     * text would leave it pointing somewhere the spoke does not, so the cap
     * is deliberately a blunt instrument: at 90 (the default) it never
     * fires, and below that it trades a true spoke for legibility. */
    const cap = LABEL_PLACEMENT.maxTextTiltDeg;
    if (cap < 90) deg = Math.max(-cap, Math.min(cap, deg));

    return {
      /* Degrees for `text-rotate`. */
      rotDeg: deg,
      /* Which end of the text sits against the dot. */
      anchor: flip ? 'right' : 'left',
      /* Signed distance along the TEXT's own x axis, in pixels. The caller
       * converts to ems. Negative for a right anchor so the text is pushed
       * away from the dot rather than through it. */
      offPx: flip ? -LABEL_PLACEMENT.spokeStartPx : LABEL_PLACEMENT.spokeStartPx,
      side,
      hidden: bestResult.hidden[i],
    };
  });
}
