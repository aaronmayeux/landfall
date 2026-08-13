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
 * THE MODEL — the text IS the spoke, and every spoke on a storm is
 * PARALLEL.
 *
 * Each label is rotated and anchored at the end nearest its dot, so the line
 * of text starts just outside the dot and runs outward, pointing back at the
 * dot's centre the way a spoke points at a hub.
 *
 * ONE ANGLE PER STORM. Every label on a track is drawn at the same tilt.
 * Only the DIRECTION a label runs from its dot varies — out along the angle,
 * or out along its opposite — and that is the side choice. Because the two
 * directions are 180 apart and the tilt never exceeds 45, both resolve to the
 * SAME `text-rotate`; the side shows up as a left or right anchor. So the
 * value handed to MapLibre is literally identical for every label on a storm.
 *
 * THE SHALLOWEST ANGLE THAT FITS WINS. The search starts at 0 — dead
 * horizontal — and works outward in `tiltStepDeg` steps to
 * `maxTextTiltDeg`, taking the first angle that places every label cleanly.
 * Text is easiest to read horizontal, so the tilt is a cost paid only when
 * the labels will not otherwise fit. 45 is a hard ceiling, not a preference.
 *
 * The angle is NOT derived from the track any more. It used to be the
 * perpendicular at each point, which fans the labels and puts near-vertical
 * text on a westward storm — a true spoke, and hard to read. Legibility won.
 * What survives of the spoke idea is the part that matters: the text starts
 * at the dot and runs outward, so extending any label lands on its own dot.
 *
 * WHY A SHALLOW ANGLE STILL SEPARATES CROWDED LABELS. Parallel strips laid
 * along a run of dots are separated by the dots' spacing times the sine of
 * the angle between the strips and the run. On a due-west track with dots
 * 50px apart, 0 lays every label along the track and through the next dot,
 * while about 25 clears them — so the search settles there rather than at
 * the vertical the old per-point normal would have chosen.
 *
 * MapLibre CAN do this, verified by reading the bundled 5.6.0 source rather
 * than from memory: `text-rotate`, `text-anchor` and `text-offset` are all
 * property-type `data-driven`, and the rotation matrix is applied to glyph
 * positions that ALREADY include the offset. So an offset of [g, 0] with
 * `text-anchor: 'left'` and `text-rotate: angle` puts the start of the text
 * g pixels out along `angle`. That last detail is the one the whole approach
 * rests on.
 *
 * TEXT MUST NEVER READ UPSIDE DOWN, which the 45 ceiling gives for free: the
 * angle always points rightward, so a label running the other way keeps the
 * same rotation and flips to a `right` anchor with a negated offset.
 *
 * LABELS AVOID OTHER DOTS, not just each other. A shallow angle can lay the
 * text straight through the next forecast point. Checking label against label
 * does not catch that, so the dots are obstacles in their own right.
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

/** Everything about a point that does not depend on the angle or the side,
 *  worked out once. The search below builds the same boxes thousands of
 *  times now that it sweeps angles too, so the length estimate must not be
 *  inside that loop.
 *
 *  Length is estimated from character count — we cannot measure rendered text
 *  without a canvas round-trip, and the label is a predictable short string
 *  ("1:00 PM Thu"), so an em-width estimate is accurate enough for collision
 *  and costs nothing. Overestimating slightly is the safe direction: it
 *  spreads labels rather than letting them touch. */
function prepare(pts) {
  return pts.map((p, i) => {
    /* THE LOCAL TRACK TANGENT, kept as an ANGLE and computed once. The spoke
     * angle is no longer allowed to run parallel to it (see
     * `LABEL_PLACEMENT.minTrackAngleDeg`), and that test is inside the angle
     * sweep, so deriving the tangent there would redo it nineteen times per
     * arrangement.
     *
     * FROM THE NEIGHBOURS EITHER SIDE, which is the same chord the old
     * per-point normal used and carries the same hard precondition: the list
     * must be ONE storm in track order. A list spanning two storms derives a
     * tangent from the chord between them — that was a real bug, and the
     * header of points-forecast.js has the measurement.
     *
     * `null` when there is no neighbour to derive it from, i.e. a single
     * point. No tangent means no parallelism to avoid, and the angle rule
     * simply does not apply — which is right: one dot with one label has no
     * line for the text to lie along. */
    const a = pts[i - 1] || p;
    const b = pts[i + 1] || p;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      x: p.x,
      y: p.y,
      tangent: dx === 0 && dy === 0 ? null : Math.atan2(dy, dx),
      /* Along the spoke: how long the text runs. Across it: one line tall. */
      len: (p.text?.length || 0) * LABEL_PLACEMENT.charWidthPx,
      thick: LABEL_PLACEMENT.lineHeightPx,
    };
  });
}

/**
 * Does a spoke drawn at `angle` run too nearly along `tangent`?
 *
 * UNDIRECTED, which is why this is one test and not two. A label running out
 * along the angle and one running out along its opposite lie on the SAME LINE
 * — the side choice moves which end of that line the text occupies, never its
 * direction — so the answer cannot depend on the side, and the caller gets to
 * apply this once per angle instead of once per arrangement.
 *
 * `|sin(Δ)|` is the separation between two undirected lines: it is 0 when they
 * are parallel whichever way each one points, and 1 when they are square. That
 * is exactly the quantity, with no branching on quadrants.
 */
function tooNearTrack(angle, tangent) {
  if (tangent == null) return false;
  const sep = Math.asin(Math.min(1, Math.abs(Math.sin(angle - tangent))));
  return sep < (LABEL_PLACEMENT.minTrackAngleDeg * Math.PI) / 180;
}

/**
 * Where a label lands, given the storm's shared angle and this label's side.
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
 * Thin rotated strips are the whole reason a tilt relieves the crowding, so
 * the collision test has to be able to see that they are thin.
 */
function boxFor(p, angle, side) {
  const a = side > 0 ? angle : angle + Math.PI;
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
    /* The INK, without the collision padding. Label-against-label wants the
     * padding — it is what keeps two labels from touching. Label-against-dot
     * does not: counting padding as ink there measures a clearance the label
     * genuinely has and throws it away for it. */
    inkL: p.len / 2,
    inkT: p.thick / 2,
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

/** Does this label strip run across a forecast dot? A shallow angle can lay
 *  the text straight along the track and through the next point, which
 *  label-against-label collision cannot see. Nearest point on the box to the
 *  circle centre, in the box's own frame. */
function hitsDot(box, px, py) {
  const dx = px - box.cx;
  const dy = py - box.cy;
  const along = dx * box.ux + dy * box.uy;
  const across = -dx * box.uy + dy * box.ux;
  const nx = Math.max(-box.inkL, Math.min(box.inkL, along));
  const ny = Math.max(-box.inkT, Math.min(box.inkT, across));
  const ex = along - nx;
  const ey = across - ny;
  return ex * ex + ey * ey < LABEL_PLACEMENT.dotClearPx * LABEL_PLACEMENT.dotClearPx;
}

/**
 * Does a segment reach inside the axis-aligned rectangle `|x| <= hl`,
 * `|y| <= ht`? Liang-Barsky: clip the segment's parameter range against the
 * four slabs in turn and see whether anything survives.
 *
 * EXACT, not a sampled approximation. The alternative — testing a handful of
 * points along the segment — misses a long track leg clipping the corner of a
 * label, which is precisely the case worth catching on a recurving storm.
 */
function segmentInBox(x1, y1, x2, y2, hl, ht) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  /* Each edge as `p·t <= q`. A zero `p` means the segment is parallel to that
   * slab, so it is either wholly inside it (q >= 0) or wholly outside. */
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x1 + hl) && clip(dx, hl - x1) &&
    clip(-dy, y1 + ht) && clip(dy, ht - y1)
  );
}

/** Does this label strip touch the segment a→b? The segment is rotated into
 *  the box's own frame so the thin strip stays thin — the same reason the
 *  label-against-label test is oriented rather than axis-aligned. Used only by
 *  `hitsRect` below; the track's own legs are handled by the ANGLE rule, not
 *  by a clearance (see LABEL_PLACEMENT.minTrackAngleDeg for the measurements
 *  that settled that). */
function hitsSegment(box, ax, ay, bx, by, clear) {
  const toBox = (px, py) => {
    const dx = px - box.cx;
    const dy = py - box.cy;
    return [dx * box.ux + dy * box.uy, -dx * box.uy + dy * box.ux];
  };
  const [x1, y1] = toBox(ax, ay);
  const [x2, y2] = toBox(bx, by);
  return segmentInBox(x1, y1, x2, y2, box.inkL + clear, box.inkT + clear);
}

/** Does this label strip overlap a SCREEN-AXIS-ALIGNED rectangle — the storm's
 *  own name, which MapLibre draws upright under the position dot and never
 *  rotates? Expressed as its four edges so the same oriented-frame clipper
 *  above does the work; a rectangle is four segments and testing its edges
 *  also catches the case where the label lies entirely inside it. */
function hitsRect(box, rect) {
  const { x0, y0, x1, y1 } = rect;
  const edges = [
    [x0, y0, x1, y0], [x1, y0, x1, y1],
    [x1, y1, x0, y1], [x0, y1, x0, y0],
  ];
  for (const [ax, ay, bx, by] of edges) {
    if (hitsSegment(box, ax, ay, bx, by, 0)) return true;
  }
  /* Fully contained: no edge crossed, but the box's centre is inside. */
  return box.cx >= x0 && box.cx <= x1 && box.cy >= y0 && box.cy <= y1;
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
function layDown(prepared, angle, sides, nameRect) {
  const n = prepared.length;
  const hidden = new Array(n).fill(false);
  const placed = [];

  for (const i of keepOrder(n)) {
    const box = boxFor(prepared[i], angle, sides[i]);
    let clash = false;
    for (const other of placed) {
      if (overlaps(box, other)) { clash = true; break; }
    }
    /* ...and it must not run across anybody else's dot. Its own dot is
     * excluded: the text starts `spokeStartPx` out from it by construction,
     * so testing it would only ever fight the geometry that put it there. */
    if (!clash) {
      for (let j = 0; j < n; j++) {
        if (j !== i && hitsDot(box, prepared[j].x, prepared[j].y)) { clash = true; break; }
      }
    }
    /* ...nor across the storm's own NAME, which is the largest text on the
     * map and sits directly under the position dot — the busiest square inch
     * of the whole track. */
    if (!clash && nameRect && hitsRect(box, nameRect)) clash = true;

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
export function placeSpokes(pts, { nameRect = null } = {}) {
  if (!pts.length) return [];

  const prepared = prepare(pts);
  const n = prepared.length;

  /* THE ANGLE SWEEP. Shallowest first: 0, then ±step, ±2·step, out to the
   * ceiling. Text is easiest to read horizontal, so a tilt is a cost paid
   * only when the labels will not otherwise fit — and the first angle that
   * places everything cleanly is therefore the answer, with no further
   * comparison needed.
   *
   * At equal magnitude the NEGATIVE angle is tried first, which on screen
   * (where +y is down) leans the text up and to the right. That is the
   * direction labels conventionally sit relative to a line, and it is what
   * Aaron's reference photo shows. */
  const allAngles = [0];
  for (let d = LABEL_PLACEMENT.tiltStepDeg; d <= LABEL_PLACEMENT.maxTextTiltDeg;
       d += LABEL_PLACEMENT.tiltStepDeg) {
    allAngles.push(-d, d);
  }

  /* ==> ANGLES THAT LIE ALONG THE TRACK ARE STRUCK OUT BEFORE ANY
   * ARRANGEMENT IS BUILT. <== This is a property of the ANGLE, not of an
   * arrangement — every label on a storm shares one angle — so asking it once
   * per angle is both cheaper and the only way it can be answered
   * consistently across a curving track.
   *
   * ONE LABEL BEING PARALLEL STRIKES THE ANGLE OUT. Rejecting only when MOST
   * of them are was tempting and is wrong: on a curving track a single label
   * lying along its own leg is exactly the artefact that makes the whole set
   * look accidental.
   *
   * ==> AND WHEN THAT STRIKES OUT EVERYTHING, THE RULE BENDS RATHER THAN
   * BREAKING. <== A hard recurve can put tangents right across the ±45 band —
   * three legs at -40°, 0° and +40° forbid every angle the ceiling allows —
   * and there is no angle left to draw at. Hiding the whole storm's
   * timestamps is the wrong answer to that: they are the most useful text on
   * the track and the reader loses a real fact to enforce a preference. So
   * the fallback keeps the angles that are LEAST parallel to the track and
   * searches those, which degrades to "as clear of the line as this storm
   * allows" instead of to nothing.
   *
   * Ordering is preserved through the filter, so the shallowest-first
   * property the search below depends on survives it. */
  const sepOf = (deg) => {
    const angle = (deg * Math.PI) / 180;
    let min = Infinity;
    for (const p of prepared) {
      if (p.tangent == null) continue;
      min = Math.min(min, Math.asin(Math.min(1, Math.abs(Math.sin(angle - p.tangent)))));
    }
    return min;
  };
  let angles = allAngles.filter((deg) =>
    !prepared.some((p) => tooNearTrack((deg * Math.PI) / 180, p.tangent)));
  if (!angles.length) {
    const best = Math.max(...allAngles.map(sepOf));
    angles = allAngles.filter((deg) => sepOf(deg) === best);
  }

  let best = null;
  let bestDeg = angles[0] ?? 0;

  for (const deg of angles) {
    const angle = (deg * Math.PI) / 180;

    /* Keep the best arrangement AT EACH GROUP COUNT rather than one overall
     * winner. The choice between "eight labels on one side" and "nine with
     * one stranded across the track" is not a comparison two numbers can
     * settle — it needs the floor applied below, and that needs both options
     * still on the table. Indexed by how many groups are VISIBLE, which is
     * what a reader sees: an arrangement whose middle group thins away
     * entirely reads as one side change, not two. */
    const byRuns = [];
    for (const sides of arrangements(n)) {
      const result = layDown(prepared, angle, sides, nameRect);
      const slot = byRuns[result.runs];
      if (betterWithinRuns(result, slot?.result)) byRuns[result.runs] = { result, sides };
      if (result.kept === n && result.runs <= 1) break;
    }

    /* FEWEST GROUPS WINS, above a floor. Walk up from one group and take the
     * first that still shows enough of the forecast, so the tidiest
     * arrangement is preferred even when a busier one would fit one more
     * label. Only a genuinely jammed side forces a split. */
    let pick = null;
    const most = byRuns.reduce((m, e) => (e && e.result.kept > m ? e.result.kept : m), 0);
    const floor = Math.ceil(most * LABEL_PLACEMENT.minKeepFraction);
    for (const entry of byRuns) {
      if (entry && entry.result.kept >= floor) { pick = entry; break; }
    }
    if (!pick) {
      for (const entry of byRuns) {
        if (entry && (!pick || entry.result.kept > pick.result.kept)) pick = entry;
      }
    }
    if (!pick) continue;

    /* ACROSS angles the rule is Aaron's, stated plainly rather than reusing
     * the within-angle comparison: a steeper tilt has to EARN it. It wins
     * only by showing more labels, or by showing the same number with fewer
     * side changes. It never wins on a tidier balance — that would trade a
     * readable angle for a cosmetic one. Ties go to the shallower angle for
     * free, because angles are tried shallowest first. */
    const beats = !best ||
      pick.result.kept > best.result.kept ||
      (pick.result.kept === best.result.kept && pick.result.runs < best.result.runs);
    if (beats) {
      best = pick;
      bestDeg = deg;
    }

    /* A clean placement at this angle cannot be beaten by a steeper one, and
     * angles are tried shallowest first — so stop. This is the common case
     * and it should cost one pass, not nineteen. */
    if (pick.result.kept === n && pick.result.runs <= 1) break;
  }

  /* ==> `best` IS NON-NULL BY CONSTRUCTION, AND THE FALLBACK ABOVE IS WHAT
   * KEEPS IT THAT WAY. <== Filtering the angle list opened the possibility of
   * an empty sweep, which would dereference null here and take out placement
   * for EVERY storm on the map — they share one pass. A guard was written for
   * it and then removed once the invariant was traced properly: the fallback
   * never returns an empty list, `arrangements()` always yields at least the
   * two single-group arrangements, and `layDown` always returns a result, so
   * some angle always produces a winner. A guard against a state that cannot
   * be reached is a branch nothing can ever test — the reason this file has no
   * such branch is written here instead. `tools/test-label-track.mjs` proves
   * the fallback rather than the guard, because the fallback is the thing that
   * actually holds the invariant up. */
  const bestResult = best.result;
  const bestSides = best.sides;

  return prepared.map((_, i) => {
    const side = bestSides[i];
    /* EVERY LABEL ON THIS STORM GETS THE SAME ROTATION. A label running the
     * other way is not drawn at angle+180 — that would mirror the text.
     * Because the tilt never exceeds 45 the angle always points rightward,
     * so the opposite direction is expressed by anchoring the text at its
     * RIGHT end and negating the offset. Same pixels, same line, and the
     * value MapLibre receives is identical across the whole track. */
    const flip = side < 0;
    return {
      rotDeg: bestDeg,
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
