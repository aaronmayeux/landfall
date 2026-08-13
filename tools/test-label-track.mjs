#!/usr/bin/env node
/**
 * test-label-track.mjs — the forecast track and the storm's own name are
 * OBSTACLES for the time labels (SPEC-MAP §7).
 *
 * ==> THE BUG THIS EXISTS FOR. <== Placement checked a candidate label against
 * other LABELS and against other DOTS, and against nothing else. The forecast
 * line drawn between those dots was invisible to it. On a fast west-moving
 * storm that is not an edge case, it is the DEFAULT outcome: the angle search
 * starts at 0° because horizontal text reads best, the dots on such a track
 * are far enough apart that horizontal text clears every one of them, so 0°
 * passes on the first try and the entire run of timestamps is laid down flat
 * on top of the line. Aaron, on glass.
 *
 * ==> WHY THE FIRST ASSERTION IS ABOUT AN ANGLE AND NOT ABOUT A DISTANCE. <==
 * Two parallel lines three pixels apart are as unreadable as two on top of
 * each other, and a label crossing the same line at 40° is fine. The failure
 * is PARALLELISM, so that is what is measured. A distance-based assertion here
 * would pass on a label sitting four pixels above the track and running its
 * whole length, which is the exact picture being fixed.
 *
 * MUTATION-VERIFIED, which in this project is the only kind of test that
 * counts. Each assertion below was watched going red with its own rule
 * disabled — see the note above each. A test that cannot fail is worse than
 * no test, and the horizontal case in particular is one an implementation
 * could pass by accident, because a track-blind placer returns a perfectly
 * valid arrangement; it just returns the wrong angle.
 *
 * Run: node tools/test-label-track.mjs
 */

import { placeSpokes } from '../map/layers/label-placement.js';
import { LABEL_PLACEMENT } from '../config/constants.js';

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) pass++;
  else failures.push(msg);
};

const LBL = '1:00 PM Thu';

/** A straight track of `n` points running at `deg`, `gapPx` apart. */
function track(deg, n = 6, gapPx = 70, x0 = 120, y0 = 300) {
  const a = (deg * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => ({
    x: x0 + Math.cos(a) * gapPx * i,
    y: y0 + Math.sin(a) * gapPx * i,
    text: LBL,
  }));
}

/* --- the box a placement result actually puts on screen --------------------
 * Rebuilt here from the RETURNED values rather than imported from the module
 * under test. That is deliberate: importing the module's own box builder would
 * let a bug in it agree with itself and the geometry assertions below would be
 * measuring nothing. These are the numbers MapLibre receives — an anchor, a
 * rotation and an offset — turned back into a rectangle the way MapLibre turns
 * them into glyphs. */
function boxOf(pt, placed) {
  const a = (placed.rotDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const len = pt.text.length * LABEL_PLACEMENT.charWidthPx;
  /* `offPx` is signed along the text's own x axis; a right anchor negates it
   * and runs the text back the other way. */
  const dir = placed.anchor === 'right' ? -1 : 1;
  const near = Math.abs(placed.offPx);
  const mid = near + len / 2;
  return {
    cx: pt.x + ux * mid * dir,
    cy: pt.y + uy * mid * dir,
    ux,
    uy,
    hl: len / 2,
    ht: LABEL_PLACEMENT.lineHeightPx / 2,
  };
}

/** Shortest distance from a point to a segment. */
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

/** Closest approach between a label's ink rectangle and a segment, sampled
 *  around the rectangle's outline. Sampling is honest here in a way it would
 *  not be inside the placer: this is a witness, not the decision. */
function boxSegDist(box, ax, ay, bx, by) {
  let min = Infinity;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (const s of [-1, 1]) {
      const along = -box.hl + (2 * box.hl * i) / N;
      const across = s * box.ht;
      const px = box.cx + box.ux * along - box.uy * across;
      const py = box.cy + box.uy * along + box.ux * across;
      min = Math.min(min, pointSegDist(px, py, ax, ay, bx, by));
    }
  }
  return min;
}

/* ---------------------------------------------------------------------------
 * 1. A HORIZONTAL TRACK MUST NOT GET HORIZONTAL TEXT.
 *
 * The reported bug, stated as directly as it can be. MUTATION: set
 * `minTrackAngleDeg` to 0 and this goes red at 0°, which is what shipped.
 * ------------------------------------------------------------------------- */
{
  /* ==> WIDELY SPACED DOTS, WHICH IS THE CASE AARON ACTUALLY SAW AND THE ONLY
   * ONE THAT ISOLATES THIS RULE. <== At a tight 70px spacing a horizontal
   * label overruns the NEXT dot and the leg beyond it, so the dot rule and the
   * segment rule reject 0° all by themselves and this case would stay green
   * with the angle rule deleted — proved by mutation, and it is exactly the
   * "test that cannot fail" this project treats as worse than no test.
   *
   * A FAST-MOVING STORM SPREADS ITS FORECAST POINTS OUT. At 200px apart a
   * horizontal label sits entirely in the gap between two dots, touching
   * neither, and the only thing standing between it and being drawn flat
   * along the track is the angle rule. That is both the honest isolation and
   * the storm Aaron reported. */
  const pts = track(0, 6, 200);
  const placed = placeSpokes(pts);
  const rot = placed[0].rotDeg;
  /* ==> THE NUMBER IS WRITTEN OUT, NOT READ FROM THE CONSTANT. <== The first
   * cut of this line said `>= LABEL_PLACEMENT.minTrackAngleDeg`, which reads
   * the dial the code under test is steered by — so setting that dial to 0
   * reproduced the original bug AND moved the goalposts to meet it, and the
   * assertion passed at 0°. Caught by mutation, which is the only reason it
   * was caught at all: the test was green, the numbers looked sensible, and
   * it was measuring nothing.
   *
   * 15 is the REQUIREMENT — the angle below which a strip of text stops
   * reading as clear of the line it is beside. The constant is the
   * implementation's dial and is allowed to move above this; it is not
   * allowed to move below it without this failing. */
  ok(
    Math.abs(rot) >= 15,
    `a due-west storm tilts its labels clear of its own track ` +
      `(got ${rot}°, need at least 15°)`
  );
  ok(
    placed.every((p) => !p.hidden),
    `and it does it without throwing labels away — the tilt is what buys the ` +
      `room, so nothing should need hiding (hid ${placed.filter((p) => p.hidden).length} of 6)`
  );
}

/* ---------------------------------------------------------------------------
 * 2. AND A VERTICAL TRACK MUST STILL GET HORIZONTAL TEXT.
 *
 * The other half, and the one that keeps rule 1 from being "always tilt".
 * Horizontal is the most readable angle and is the whole reason the search
 * starts there; a fix that tilted every storm would be a regression wearing a
 * fix's clothes. MUTATION: make the angle rule unconditional rather than
 * tangent-relative and this goes red.
 * ------------------------------------------------------------------------- */
{
  const placed = placeSpokes(track(90));
  ok(
    placed[0].rotDeg === 0,
    `a due-north storm keeps its labels horizontal — the tilt is a cost paid ` +
      `only when the track demands it (got ${placed[0].rotDeg}°)`
  );
}

/* ---------------------------------------------------------------------------
 * 3. A RECURVING STORM STILL SHOWS MOST OF ITS FORECAST.
 *
 * The angle rule forbids angles, and a forbidding rule's real risk is that it
 * quietly starves the thing it is protecting. A hard recurve presents tangents
 * across a wide span, so it is the shape most likely to leave nothing legal to
 * draw at — and a storm that answers "when" with four blank dots has traded
 * one problem for a worse one.
 *
 * NO CLEARANCE ASSERTION HERE, and that is a finding rather than an omission.
 * A companion rule keeping labels a fixed distance off DISTANT legs of the
 * track was built, then measured against this fixture and eight others: it
 * never changed an outcome, because the angle rule had already moved every
 * label clear. It was cut. See LABEL_PLACEMENT.minTrackAngleDeg.
 * ------------------------------------------------------------------------- */
{
  const pts = [
    { x: 420, y: 340 }, { x: 340, y: 320 }, { x: 280, y: 275 },
    { x: 262, y: 210 }, { x: 300, y: 155 }, { x: 380, y: 130 },
    { x: 460, y: 140 },
  ].map((p) => ({ ...p, text: LBL }));

  const placed = placeSpokes(pts);
  const shown = placed.filter((p) => !p.hidden).length;
  ok(shown >= 5, `a recurving storm still shows most of its forecast (${shown} of 7 labels)`);
  ok(
    placed.every((p) => Math.abs(p.rotDeg) <= 45),
    `and never leans past the 45° ceiling to get there — past that the labels ` +
      `stop scanning as text`
  );
}

/* ---------------------------------------------------------------------------
 * 4. NO VISIBLE LABEL LIES ON THE STORM'S OWN NAME.
 *
 * The name is drawn under the position dot, which is the anchor of the first
 * forecast label — the two were competing for the same square inch and neither
 * knew the other existed. MapLibre cannot arbitrate it either: the time labels
 * carry `text-allow-overlap`, so they draw straight through the name rather
 * than yielding to it.
 *
 * MUTATION: pass `nameRect: null` and the first label lands inside the
 * rectangle, which is what this is here to prove cannot happen.
 * ------------------------------------------------------------------------- */
{
  /* ==> A NORTHWEST-MOVING STORM WITH SHORT HOPS, WHICH IS WHERE THIS RULE
   * ACTUALLY BITES. <== Found by sweeping track bearing, dot spacing and name
   * width and keeping the combinations where a label lands on the name with
   * the rule off: 47 of them, concentrated on tracks running up-left or
   * up-right with dots 60px apart. Northwest is the commonest Atlantic
   * heading, so this is not an exotic case. A due-west fixture was tried
   * first and proved nothing — its labels tilt up and away from a name that
   * sits below the dot, so the rule never fired and the assertion was green
   * either way. */
  const pts = track(135, 6, 60);
  const first = pts[0];
  /* The box map/markers.js actually draws: centred under the dot, one line
   * tall, starting one dot radius plus its stroke plus the gap below it. */
  const nameRect = {
    x0: first.x - 55, x1: first.x + 55,
    y0: first.y + 19.5, y1: first.y + 37,
  };
  const placed = placeSpokes(pts, { nameRect });

  const inside = (x, y) =>
    x >= nameRect.x0 && x <= nameRect.x1 && y >= nameRect.y0 && y <= nameRect.y1;

  const hitsIn = (result) => {
    let hits = 0;
    for (let i = 0; i < pts.length; i++) {
      if (result[i].hidden) continue;
      const box = boxOf(pts[i], result[i]);
      outer:
      for (let k = 0; k <= 24; k++) {
        for (const s of [-1, 0, 1]) {
          const along = -box.hl + (2 * box.hl * k) / 24;
          const across = s * box.ht;
          const px = box.cx + box.ux * along - box.uy * across;
          const py = box.cy + box.uy * along + box.ux * across;
          if (inside(px, py)) { hits++; break outer; }
        }
      }
    }
    return hits;
  };

  ok(hitsIn(placed) === 0, `no forecast time is drawn through the storm's own name`);
  /* ==> THE WITNESS. <== Without this, the assertion above is satisfied by any
   * placer that happens to point its labels somewhere else, and it would stay
   * green with the rule deleted. Running the SAME fixture with no name
   * reserved proves the rectangle is what moved the label, not luck. */
  ok(
    hitsIn(placeSpokes(pts)) > 0,
    `and the fixture genuinely exercises the rule — with no name reserved, a ` +
      `label lands on it (this assertion failing means the test proves nothing)`
  );
  ok(
    placed.filter((p) => !p.hidden).length >= 5,
    `reserving that space costs at most one label ` +
      `(${placed.filter((p) => !p.hidden).length} of 6 still shown)`
  );
}

/* ---------------------------------------------------------------------------
 * 5. A TRACK THAT FORBIDS EVERY ANGLE STILL DRAWS ITS LABELS.
 *
 * ==> THE FIXTURE IS EXACT AND FRAGILE ON PURPOSE. <== A zigzag whose legs run
 * at ±30° gives tangents of -30°, 0° and +30°, and a ±20° exclusion around
 * each of those covers (-50°, 50°) — every angle the 45° tilt ceiling allows.
 * There is nothing legal left to draw at. A ±40° zigzag does NOT reproduce it:
 * the exclusions leave -20° and +20° open on the boundary, and the sweep finds
 * them. That near miss is why this fixture is written to a specific angle
 * rather than "something sharp".
 *
 * The answer must not be a throw — placement runs one pass for every storm on
 * the map, so one bad track would take all of them down — and it must not be
 * blank labels either, which trades a small ugliness for a lost fact (§5). It
 * degrades instead: keep the angles LEAST parallel to the track and search
 * those.
 *
 * MUTATION: delete the fallback so the filtered list stays empty, and this
 * throws on `best.result` rather than failing. There is no null guard behind
 * it — the fallback IS the guard, which is why this case tests the fallback.
 * ------------------------------------------------------------------------- */
{
  const zig = [
    { x: 200, y: 300 }, { x: 300, y: 242 }, { x: 400, y: 300 },
    { x: 500, y: 242 }, { x: 600, y: 300 },
  ].map((p) => ({ ...p, text: LBL }));

  let threw = null;
  let placed = null;
  try { placed = placeSpokes(zig); } catch (e) { threw = e; }
  ok(!threw, `a track that forbids every angle returns instead of throwing (${threw?.message || 'ok'})`);
  ok(
    Array.isArray(placed) && placed.length === zig.length,
    `and it returns one entry per point, so the caller's index loop stays valid`
  );
  ok(
    Array.isArray(placed) && placed.every((p) => Number.isFinite(p.rotDeg)),
    `with a real angle on every entry — NaN reaches MapLibre as a rejected ` +
      `layout property and takes the labels out silently`
  );
  ok(
    Array.isArray(placed) && placed.some((p) => !p.hidden),
    `and it still shows the reader something rather than going quiet`
  );
}

/* ---------------------------------------------------------------------------
 * 6. THE ONE-POINT CASE HAS NO TRACK TO AVOID.
 *
 * A single forecast point has no neighbours, so it has no tangent. That must
 * read as "no line to lie along", not as a tangent of 0 — which would forbid
 * horizontal text on a storm that has no direction at all.
 * ------------------------------------------------------------------------- */
{
  const placed = placeSpokes([{ x: 300, y: 300, text: LBL }]);
  ok(placed.length === 1 && !placed[0].hidden, `a lone forecast point still gets its label`);
  ok(placed[0].rotDeg === 0, `and it is horizontal — there is no track to clear (got ${placed[0].rotDeg}°)`);
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`✓ ${pass} label-vs-track assertions pass`);
