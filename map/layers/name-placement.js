/**
 * name-placement.js — where a storm's NAME sits relative to its position dot
 * (SPEC §7, §9.9).
 *
 * ==> IT WAS PINNED BELOW THE DOT, FOREVER, AND ON A NORTH-SOUTH STORM THAT
 * IS ON TOP OF ITS OWN TRACK. <== `map/markers.js` drew the name with a fixed
 * `text-anchor: 'top'`, so the one place it could go was straight down. That
 * is clear air for an east-west storm and directly across the forecast line
 * for a north-south one. Seen on glass on HERNAN, moving SSW, with the white
 * forecast line running through the middle of the word.
 *
 * ==> THE CHEAP FIX DOES NOT WORK, AND THE MEASUREMENT THAT KILLS IT IS
 * WORTH KEEPING. <== The obvious move is to put the name perpendicular to
 * `storm.headingDeg` — NHC's own reported motion. Measured off `origin/archive`
 * on 2026-08-13, the reported motion and the DRAWN first leg of the forecast
 * disagree, and they disagree worst on exactly the storm that shows the bug:
 *
 *     Hernan     reported 245°   drawn 193°   -52°
 *     Lala       reported 285°   drawn 295°   +10°
 *     Cristobal  reported  55°   drawn  46°    -9°
 *
 * A perpendicular taken from 245° puts the name straight back across a line
 * running at 193°. `headingDeg` is also null for every GDACS storm. So the
 * name is placed off the DRAWN geometry, in screen space, or it is not placed
 * at all.
 *
 * ONE DIRECTION OF DEPENDENCY, AND IT MATTERS. The name is chosen FIRST, from
 * the track alone; the forecast timestamps are then routed around wherever it
 * landed (label-placement.js takes the resulting rect as an obstacle). The
 * name outranks the timestamps — it is the largest text on the map and the
 * answer to the question the map is being asked — so it never yields to them,
 * and because the order is one-way the two can never chase each other.
 *
 * AXIS-ALIGNED, WHICH IS WHY THIS FILE HAS ITS OWN GEOMETRY AND DOES NOT
 * BORROW label-placement.js's. A time label is a rotated strip and needs
 * oriented-box maths; a storm name is always drawn upright, so every box here
 * is screen-axis-aligned and the tests are a rectangle-vs-segment clip and a
 * rectangle-vs-circle distance. Simpler maths for a simpler shape, and it
 * keeps label-placement.js from growing past the size where it needs a cut
 * list (§12).
 *
 * WIDTH IS ESTIMATED, NOT MEASURED, the same way every other box in this
 * project is: there is no canvas round-trip. Overestimating is the safe
 * direction — it moves the name further out of the way than it strictly needs
 * to be, rather than leaving it clipping a line.
 *
 * Imports: config only. Nothing imports this but points-forecast.js.
 */

import { LABEL_PLACEMENT } from '../../config/constants.js';

const R2 = Math.SQRT1_2; // 1/√2

/**
 * THE EIGHT SPOTS, IN PREFERENCE ORDER, AND THE ORDER IS THE DESIGN.
 *
 * `anchor` is what MapLibre is told, and it names the part of the TEXT that
 * sits on the anchor point — so `top` puts the text BELOW and `bottom` puts
 * it ABOVE. Easy to read backwards, hence `dir`, which is the direction the
 * block of text actually travels from the dot, in screen pixels (+y is down).
 *
 * BELOW LEADS because it is what the app has always done and what the eye is
 * trained on; the name reads as hanging off the dot. From there it works
 * DOWN AND OUT before it ever flips over the top: the two lower diagonals,
 * then straight out to the sides, then the upper diagonals, and only then
 * straight up. Going over the dot is the biggest visual change and is the
 * last resort short of giving up.
 *
 * `dir` is a UNIT vector, so a diagonal spot is 1/√2 out on each axis. That
 * is deliberate arithmetic, not a rounding: it puts the box's nearest CORNER
 * at exactly the clearance distance from the dot's centre, the same distance
 * the straight-down spot puts its nearest EDGE. Every spot clears the dot by
 * the same amount.
 */
const SPOTS = Object.freeze([
  { anchor: 'top',          dir: [0, 1] },
  { anchor: 'top-left',     dir: [R2, R2] },
  { anchor: 'top-right',    dir: [-R2, R2] },
  { anchor: 'left',         dir: [1, 0] },
  { anchor: 'right',        dir: [-1, 0] },
  { anchor: 'bottom-left',  dir: [R2, -R2] },
  { anchor: 'bottom-right', dir: [-R2, -R2] },
  { anchor: 'bottom',       dir: [0, -1] },
]);

/** Where the text block lands, given which of its own corners/edges is
 *  pinned to the anchor point. Returns the box in screen pixels. */
function rectFor(anchor, ax, ay, w, h) {
  /* x: 0 = box starts at the anchor, 1 = box ends at it, 0.5 = centred.
   * Same for y. Read straight off the anchor name. */
  const fx = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5;
  const fy = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5;
  const x0 = ax - w * fx;
  const y0 = ay - h * fy;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** Is this point inside the box? */
function inRect(x, y, r) {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Does the segment a→b cross the box? Liang-Barsky clip: walk the four
 *  edges narrowing the surviving span of the segment, and if anything is
 *  left the two overlap. Exact, and it also catches a segment lying wholly
 *  inside — which a naive edge-crossing test does not. */
function segmentHitsRect(x1, y1, x2, y2, r) {
  if (inRect(x1, y1, r) || inRect(x2, y2, r)) return true;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.x0, r.x1 - x1, y1 - r.y0, r.y1 - y1];

  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      /* Parallel to this edge: it can only miss if it starts outside it. */
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Does the box come within `clear` of a dot at (px, py)? Nearest point on
 *  the box to the circle's centre, then a plain distance. */
function circleHitsRect(px, py, clear, r) {
  const nx = Math.min(Math.max(px, r.x0), r.x1);
  const ny = Math.min(Math.max(py, r.y0), r.y1);
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy < clear * clear;
}

/** Grow a box on all four sides. */
function inflate(r, by) {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

/**
 * Choose where one storm's name goes.
 *
 * @param {Array<{x:number,y:number}>} pts  This storm's forecast points in
 *        screen space, in TRACK ORDER. The polyline through them is the
 *        drawn forecast line — the thing the name must not sit on. ONE
 *        STORM ONLY: a list spanning two storms would draw an obstacle
 *        across the ocean between them, which is the same precondition
 *        placeSpokes carries and for the same reason.
 * @param {object} opts
 * @param {number} opts.anchorIndex  Which point the name hangs off — the
 *        storm's own position, which at this zoom IS its tau-0 forecast
 *        point.
 * @param {number} opts.widthPx      Estimated width of the drawn name.
 * @param {number} opts.heightPx     Estimated height of one line of it.
 * @param {number} opts.clearPx      Clearance from the DOT'S CENTRE to the
 *        nearest part of the name — dot radius + stroke + the design gap,
 *        computed by the caller from the same tokens the name is drawn with.
 * @returns {{anchor:string, offsetPx:[number,number], rect:object,
 *           fellBack:boolean} | null} null only when there is no anchor
 *          point to hang off. `offsetPx` goes to `text-offset` (the caller
 *          converts to ems), `anchor` to `text-anchor`, and `rect` is the
 *          keep-out box the time labels are routed around.
 */
export function placeName(pts, { anchorIndex = 0, widthPx, heightPx, clearPx }) {
  const at = pts[anchorIndex];
  if (!at) return null;

  const build = (spot) => {
    const ox = spot.dir[0] * clearPx;
    const oy = spot.dir[1] * clearPx;
    return {
      anchor: spot.anchor,
      offsetPx: [ox, oy],
      rect: rectFor(spot.anchor, at.x + ox, at.y + oy, widthPx, heightPx),
    };
  };

  for (const spot of SPOTS) {
    const cand = build(spot);
    const padded = inflate(cand.rect, LABEL_PLACEMENT.namePadPx);

    /* THE DRAWN LINE, LEG BY LEG. Not the reported heading — see the header.
     * Every leg is tested, not just the first: a recurving storm can bend
     * back under its own start, and the name has to clear the whole shape
     * it is sitting in the middle of. */
    let clash = false;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (segmentHitsRect(a.x, a.y, b.x, b.y, padded)) { clash = true; break; }
    }

    /* ...and the forecast dots themselves, which the line does not fully
     * account for: a dot is a disc with a stroke, wider than the line
     * through it, and the name landing half on one reads as a mistake.
     * The anchor dot is included rather than skipped — `clearPx` already
     * puts the box further out than `dotClearPx`, so it passes on its own
     * merits and there is no special case to get wrong later. */
    if (!clash) {
      for (const p of pts) {
        if (circleHitsRect(p.x, p.y, LABEL_PLACEMENT.dotClearPx, padded)) {
          clash = true;
          break;
        }
      }
    }

    if (!clash) return { ...cand, fellBack: false };
  }

  /* ==> NOTHING FITS, SO IT GOES BACK UNDER THE DOT. <== A storm can be
   * drawn so tightly wound — a stalling hurricane loops its five-day track
   * into a knot smaller than its own name — that every spot crosses
   * something. Hiding the name is not the answer: it is the one label that
   * says WHICH STORM THIS IS, and a track with no name on it is worse than
   * a name with a line through it (§5 — the failure has to stay visible,
   * and here the visible thing is the storm's identity). Below the dot is
   * the placement this app has always used, so the degraded case degrades
   * to the familiar one rather than to something new and strange. */
  return { ...build(SPOTS[0]), fellBack: true };
}
