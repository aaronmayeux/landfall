/**
 * label-placement.js — spoke placement for forecast time labels (SPEC §7).
 *
 * THE PROBLEM MapLibre CANNOT SOLVE FOR US.
 * Its collision engine only hides colliding labels (`text-optional`), and
 * `text-variable-anchor` can only try a fixed menu of anchors. Neither can:
 *   - place a label on the axis perpendicular to the TRACK at that point, or
 *   - keep a run of labels on ONE side of the track, or
 *   - balance the split when some have to move.
 * All three are the requested behaviour, so placement is computed here and
 * handed to MapLibre as a plain per-feature pixel offset it just draws.
 *
 * THE MODEL — a spoke on a wheel.
 * Each forecast point sits on a track. The track's local bearing at that
 * point gives a tangent; the label rides the NORMAL to it, so the label,
 * the point, and the track form a spoke. Both normals are valid, hence a
 * side: +1 or -1. Preferred side is whichever holds the most labels without
 * overlapping.
 *
 * BALANCED FLIPPING.
 * Overlaps are resolved by flipping the minimum number of labels to the far
 * side — but a 7/1 split reads worse than 4/4, so once anything has flipped,
 * the split is evened out toward 50/50 (SIDE_BALANCE_TOLERANCE) by moving
 * the labels that gain the most room by moving.
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

/** Axis-aligned box for a label placed at `side` on its spoke. Width is
 *  estimated from character count — we cannot measure text without a canvas
 *  round-trip, and `datelbl` is a predictable short string ("1:00 PM Thu"),
 *  so an em-width estimate is accurate enough for collision and costs
 *  nothing. Overestimating slightly is the safe direction: it spreads
 *  labels rather than letting them touch. */
function boxFor(pt, side, textLen) {
  const nx = Math.cos(pt.tangent + Math.PI / 2) * side;
  const ny = Math.sin(pt.tangent + Math.PI / 2) * side;
  const cx = pt.x + nx * LABEL_PLACEMENT.spokePx;
  const cy = pt.y + ny * LABEL_PLACEMENT.spokePx;
  const w = textLen * LABEL_PLACEMENT.charWidthPx + LABEL_PLACEMENT.padPx * 2;
  const h = LABEL_PLACEMENT.lineHeightPx + LABEL_PLACEMENT.padPx * 2;
  return { cx, cy, w, h, ox: nx * LABEL_PLACEMENT.spokePx, oy: ny * LABEL_PLACEMENT.spokePx };
}

function overlaps(a, b) {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.w + b.w &&
    Math.abs(a.cy - b.cy) * 2 < a.h + b.h
  );
}

/** How many placed boxes a candidate would hit. */
function collisionCount(cand, placed) {
  let n = 0;
  for (const p of placed) if (overlaps(cand, p)) n++;
  return n;
}

/**
 * Place one storm's forecast labels.
 *
 * @param {Array<{x:number,y:number,text:string}>} pts  Screen-space points in
 *        TRACK ORDER (order matters — the tangent is derived from neighbours).
 * @returns {Array<{ox:number,oy:number,side:number,hidden:boolean}>} one entry
 *          per input point, in the same order.
 */
export function placeSpokes(pts) {
  if (!pts.length) return [];

  const withTangent = pts.map((p, i) => ({ ...p, tangent: tangentAt(pts, i) }));

  /* Pass 1 — which side holds more labels cleanly? Try both wholesale and
   * count collisions; the winner becomes the preferred side, so a clean run
   * stays on one side of the track as asked. */
  let best = { side: 1, hits: Infinity };
  for (const side of [1, -1]) {
    const placed = [];
    let hits = 0;
    for (const p of withTangent) {
      const box = boxFor(p, side, p.text.length);
      hits += collisionCount(box, placed);
      placed.push(box);
    }
    if (hits < best.hits) best = { side, hits };
  }
  const pref = best.side;

  /* Pass 2 — lay them down on the preferred side, flipping only what must
   * flip. Flipping is only accepted if the far side is genuinely clearer;
   * otherwise the label is marked hidden and MapLibre drops it, which beats
   * drawing a guaranteed overlap. */
  const placed = [];
  const out = withTangent.map((p) => {
    const near = boxFor(p, pref, p.text.length);
    const nearHits = collisionCount(near, placed);
    if (nearHits === 0) {
      placed.push(near);
      return { ox: near.ox, oy: near.oy, side: pref, hidden: false, _p: p };
    }
    const far = boxFor(p, -pref, p.text.length);
    const farHits = collisionCount(far, placed);
    if (farHits < nearHits) {
      placed.push(far);
      return { ox: far.ox, oy: far.oy, side: -pref, hidden: false, _p: p };
    }
    return { ox: near.ox, oy: near.oy, side: pref, hidden: true, _p: p };
  });

  /* Pass 3 — even the split. A 7/1 was explicitly called out as worse than
   * 4/4, so if anything flipped at all, keep moving the labels that flip
   * most cleanly until the two sides are within tolerance. Labels that
   * cannot move without colliding are left alone: balance is a preference,
   * never a reason to create an overlap. */
  const visible = out.filter((o) => !o.hidden);
  if (visible.some((o) => o.side !== pref) && visible.length > 2) {
    const target = Math.floor(visible.length / 2);
    let major = visible.filter((o) => o.side === pref);

    while (major.length > target + LABEL_PLACEMENT.sideBalanceTolerance) {
      const others = visible.filter((o) => o !== null);
      let moved = null;
      for (const cand of major) {
        const far = boxFor(cand._p, -cand.side, cand._p.text.length);
        const rest = others
          .filter((o) => o !== cand)
          .map((o) => boxFor(o._p, o.side, o._p.text.length));
        if (collisionCount(far, rest) === 0) {
          cand.ox = far.ox;
          cand.oy = far.oy;
          cand.side = -cand.side;
          moved = cand;
          break;
        }
      }
      if (!moved) break; // nothing can move cleanly — stop, don't force it
      major = visible.filter((o) => o.side === pref);
    }
  }

  return out.map(({ ox, oy, side, hidden }) => ({ ox, oy, side, hidden }));
}
