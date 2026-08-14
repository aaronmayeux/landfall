#!/usr/bin/env node
/**
 * test-name-placement.mjs — where a storm's NAME lands relative to its track
 * (map/layers/name-placement.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-name-placement.mjs`.
 *
 * WHY THIS SUITE EXISTS. The name was pinned below the dot for the whole life
 * of the app, and that is correct for an east-west storm and wrong for a
 * north-south one. So the ONE variable every fixture below varies is the
 * track's angle on screen — the same variable the forecast-label suite had to
 * learn to vary before it could reproduce ITS bug.
 *
 * THE HEADLINE FIXTURE IS HERNAN. Aaron photographed it on glass: a storm
 * moving SSW with the forecast line running straight down through the middle
 * of the word. If this suite passes and that case still fails, the suite is
 * wrong.
 *
 * WHAT THIS CANNOT PROVE: that the chosen spot READS well — whether a name
 * sitting to the right of its dot looks deliberate or looks knocked askew.
 * Geometry is checked here; legibility is a question for a phone.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { placeName } = await import('../map/layers/name-placement.js');
const { LABEL_PLACEMENT } = await import('../config/constants.js');
const { SIZE, STORM_GEO } = await import('../config/tokens.js');

/* The real numbers the app draws with. A stand-in would quietly make every
 * fixture easier than reality. */
const CLEAR =
  STORM_GEO.pointRadius + STORM_GEO.pointStrokeWidth + SIZE.stormLabelGapPx;
const HEIGHT = LABEL_PLACEMENT.nameLineEm * SIZE.stormLabelPx;
const widthOf = (name) =>
  name.length * LABEL_PLACEMENT.nameCharEm * SIZE.stormLabelPx;

const place = (pts, name = 'HERNAN', anchorIndex = 0) =>
  placeName(pts, {
    anchorIndex,
    widthPx: widthOf(name),
    heightPx: HEIGHT,
    clearPx: CLEAR,
  });

/** A straight track of `n` dots leaving (0,0) at `deg` (screen degrees, +y
 *  down), `gap` pixels apart. NHC publishes at most nine points. */
function track(deg, gap = 60, n = 5) {
  const a = (deg * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => ({
    x: Math.cos(a) * gap * i,
    y: Math.sin(a) * gap * i,
  }));
}

/* --- independent geometry, written the other way round on purpose ---------
 * The checks below must not share code with the module under test, or a
 * wrong helper would agree with itself and the suite would pass on the same
 * mistake as the bug. Distance from a point to a segment, done plainly. */
function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Closest approach between the placed name box and the drawn track, sampled
 *  densely around the box's outline AND across its interior. Sampling rather
 *  than clipping: a second exact clipper would be the same idea twice. */
function clearanceToTrack(rect, pts) {
  let best = Infinity;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = rect.x0 + ((rect.x1 - rect.x0) * i) / N;
      const y = rect.y0 + ((rect.y1 - rect.y0) * j) / N;
      for (let k = 1; k < pts.length; k++) {
        best = Math.min(
          best,
          distPointSeg(x, y, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y),
        );
      }
    }
  }
  return best;
}

/** Does the box contain any part of the track? True if any sampled point
 *  along the polyline falls inside it. */
function trackInsideBox(rect, pts) {
  for (let k = 1; k < pts.length; k++) {
    for (let t = 0; t <= 1; t += 0.01) {
      const x = pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t;
      const y = pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t;
      if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) return true;
    }
  }
  return false;
}

/** Nearest distance from the box to the dot at (px, py). */
function clearanceToDot(rect, px, py) {
  const nx = Math.min(Math.max(px, rect.x0), rect.x1);
  const ny = Math.min(Math.max(py, rect.y0), rect.y1);
  return Math.hypot(px - nx, py - ny);
}

/* ------------------------------------------------------------------------ */

section('the bug: a SOUTH-moving storm must not get the name on its track');

/* ==> SOUTH, NOT "NORTH-SOUTH". <== The bug is one-sided and it is worth
 * being precise about why, because the obvious symmetry is wrong. The name
 * hangs BELOW the dot, and the obstacle it must clear is the FORECAST line —
 * the track the storm has yet to travel. A storm heading south draws that
 * line downward, straight through the word. A storm heading north draws it
 * upward, and below the dot is clear air, so the correct answer for a
 * north-mover is to leave the name exactly where it has always been. An
 * assertion demanding it move would be demanding the code get it wrong. */
for (const [label, deg] of [
  ['due south (HERNAN, drawn 193°)', 97],
  ['SSW', 103],
  ['SSE', 77],
  ['due south, tight 30px spacing', 90],
]) {
  const pts = label.includes('tight') ? track(deg, 30) : track(deg);
  const got = place(pts);
  ok(!!got, `${label}: a placement is returned`);
  ok(
    !trackInsideBox(got.rect, pts),
    `${label}: the track does not run through the name box (anchor ${got.anchor})`,
  );
  ok(
    got.anchor !== 'top',
    `${label}: the name moved off the default below-the-dot spot (got ${got.anchor})`,
  );
  ok(!got.fellBack, `${label}: a clear spot was found, not the fallback`);
}

section('a NORTH-moving storm keeps the familiar spot below the dot');

/* The other half of the same rule: the below-the-dot spot leads the
 * preference order and must still WIN whenever it is clear, or the fix has
 * traded one wrong placement for a lot of needless movement. */
for (const [label, deg] of [
  ['due north', -90],
  ['NNE', -80],
  ['NNW', -100],
]) {
  const pts = track(deg);
  const got = place(pts);
  ok(!!got, `${label}: a placement is returned`);
  ok(
    !trackInsideBox(got.rect, pts),
    `${label}: the track does not run through the name box (anchor ${got.anchor})`,
  );
  ok(
    got.anchor === 'top',
    `${label}: below the dot is clear, so the name stays there (got ${got.anchor})`,
  );
  ok(!got.fellBack, `${label}: it is a chosen spot, not the fallback`);
}

section('an east-west storm keeps the familiar spot below the dot');

for (const [label, deg] of [
  ['due west', 180],
  ['due east', 0],
  ['WNW', 168],
]) {
  const pts = track(deg);
  const got = place(pts);
  ok(got.anchor === 'top', `${label}: name stays below the dot (got ${got.anchor})`);
  ok(
    Math.abs(got.offsetPx[0]) < 1e-9 && Math.abs(got.offsetPx[1] - CLEAR) < 1e-9,
    `${label}: offset is the plain downward clearance`,
  );
}

section('every spot clears the dot by the same distance');

/* The diagonals divide the clearance by root two on each axis SO THAT the
 * nearest corner lands at the same radius as the straight spots' nearest
 * edge. If that arithmetic is ever "simplified" to a full clearance on both
 * axes, the diagonals drift out and this catches it. */
for (const deg of [0, 45, 90, 135, 180, 225, 270, 315, 97, 13, 271]) {
  const pts = track(deg);
  const got = place(pts);
  const d = clearanceToDot(got.rect, pts[0].x, pts[0].y);
  ok(
    Math.abs(d - CLEAR) < 0.01,
    `${deg}°: name sits exactly ${CLEAR}px off its own dot (got ${d.toFixed(2)}, ${got.anchor})`,
  );
}

section('the placed name keeps real air from the drawn line');

for (const deg of [97, 103, -90, -80, 45, -45, 30, 150, 200, 260, 300]) {
  const pts = track(deg);
  const got = place(pts);
  if (got.fellBack) continue; // the fallback is allowed to overlap; tested below
  const gap = clearanceToTrack(got.rect, pts);
  ok(
    gap >= LABEL_PLACEMENT.namePadPx - 0.5,
    `${deg}°: ${gap.toFixed(1)}px of air from the track, wanted ${LABEL_PLACEMENT.namePadPx} (${got.anchor})`,
  );
}

section('and from every forecast dot');

for (const deg of [97, -90, 45, 200, 300]) {
  for (const gap of [30, 45, 60, 90]) {
    const pts = track(deg, gap);
    const got = place(pts);
    if (got.fellBack) continue;
    let worst = Infinity;
    for (const p of pts) worst = Math.min(worst, clearanceToDot(got.rect, p.x, p.y));
    ok(
      worst >= LABEL_PLACEMENT.dotClearPx - LABEL_PLACEMENT.namePadPx - 0.5,
      `${deg}° at ${gap}px spacing: nearest dot is ${worst.toFixed(1)}px away (${got.anchor})`,
    );
  }
}

/* ==> AND A SWEEP THAT ACTUALLY EXERCISES THE DOT RULE, BECAUSE THE LOOP
 * ABOVE DOES NOT. <== Disabling the dot check left the block above entirely
 * green, which means it was proving nothing about dots — the long five-point
 * tracks it uses always push the name so far from the line that the dots come
 * free with it.
 *
 * The rule only earns its keep near a track's END, where the line stops but
 * the dot's disc keeps going: the box can sit clear of the segment and still
 * be half on the last dot. So this sweeps SHORT two-point tracks at shallow
 * angles, which is where that gap lives. Verified by mutation: with the dot
 * check switched off, this block goes red. */
for (let deg = 0; deg < 360; deg += 3) {
  for (let gap = 26; gap <= 44; gap += 2) {
    const pts = track(deg, gap, 2);
    const got = place(pts);
    if (got.fellBack) continue;
    let worst = Infinity;
    for (const p of pts) worst = Math.min(worst, clearanceToDot(got.rect, p.x, p.y));
    ok(
      worst >= LABEL_PLACEMENT.dotClearPx - LABEL_PLACEMENT.namePadPx - 0.5,
      `two-point ${deg}° at ${gap}px: nearest dot is ${worst.toFixed(1)}px away (${got.anchor})`,
    );
  }
}

section('a curved track is tested leg by leg, not just its first leg');

/* A recurve: the storm heads south, turns, and comes back north-east under
 * its own start. The first leg alone would say "put the name to the right";
 * the returning leg is what is actually there. */
const recurve = [
  { x: 0, y: 0 },
  { x: -6, y: 55 },
  { x: 4, y: 108 },
  { x: 46, y: 132 },
  { x: 96, y: 120 },
  { x: 130, y: 74 },
  { x: 140, y: 18 },
];
{
  const got = place(recurve);
  ok(!trackInsideBox(got.rect, recurve), `recurve: no leg runs through the name (${got.anchor})`);
  ok(!got.fellBack, 'recurve: a clear spot exists and was found');
}

section('a knotted track falls back to below the dot rather than hiding');

/* ==> THE SHAPE THAT ACTUALLY FORCES IT IS A STALL, AND IT HAS TO WIND OUT
 * FROM THE STORM'S OWN POSITION. <== The first version of this fixture was a
 * plain ring with the storm sitting ON its edge, and it never triggered the
 * fallback once: a ring leaves the whole outside of itself open, so the name
 * simply stepped away from the circle and found clear air on the first or
 * second try. The assertion passed on nothing and could not have failed.
 *
 * A stalling storm loops around WHERE IT IS. Start the track at the anchor
 * and spiral outward and the geometry ends up on every side of the dot at
 * once, which is the only way all eight spots clash. Verified against the
 * module: this shape returns fellBack, and the ring above does not. */
const knot = [{ x: 0, y: 0 }];
for (let i = 1; i <= 40; i++) {
  const a = (i / 40) * Math.PI * 2 * 3; // three turns
  const r = 120 * (i / 40); // widening out to 120px
  knot.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
}
{
  const got = place(knot, 'CHRISTOPHERSON');
  ok(!!got, 'knot: still returns a placement — the name is never dropped');
  ok(got.fellBack === true, 'knot: it is flagged as the fallback');
  ok(got.anchor === 'top', 'knot: the fallback is the familiar below-the-dot spot');
}

/* And the counter-case, so the fixture above is proved to be doing the work
 * rather than the fallback being returned for everything: the SAME loop, with
 * the storm sitting on its edge instead of at its centre, has clear air
 * outside it and must NOT fall back. */
{
  const ring = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    ring.push({ x: Math.cos(a) * 22, y: Math.sin(a) * 22 });
  }
  const got = place(ring, 'CHRISTOPHERSON');
  ok(!got.fellBack, 'a loop the storm sits on the EDGE of still has a clear side');
}

section('degenerate inputs');

{
  const got = place([{ x: 10, y: 10 }]);
  ok(got.anchor === 'top', 'a single point with no track keeps the default spot');
  ok(!got.fellBack, 'a single point is not a fallback — there was nothing to avoid');
}
{
  ok(place([], 'X') === null, 'no points at all returns null rather than throwing');
  ok(place(track(97), 'HERNAN', 9) === null, 'an anchor index past the end returns null');
}

section('the anchor names match what MapLibre is told to do');

/* `text-anchor` names the part of the TEXT on the anchor point, so `top`
 * draws BELOW and `bottom` draws ABOVE. Getting this backwards is the single
 * easiest mistake in the file, so it is asserted directly: for each spot, the
 * box must actually lie in the direction the offset points. */
const seen = new Set();
for (let deg = 0; deg < 360; deg += 7) {
  for (const gap of [26, 34, 48, 70]) {
    const got = place(track(deg, gap, 6));
    seen.add(got.anchor);
    const cx = (got.rect.x0 + got.rect.x1) / 2;
    const cy = (got.rect.y0 + got.rect.y1) / 2;
    const [ox, oy] = got.offsetPx;
    /* The box's centre must sit on the same side of the dot as the offset. */
    if (Math.abs(ox) > 1e-9) {
      ok(Math.sign(cx) === Math.sign(ox), `${deg}°/${gap}: box is on the offset's x side (${got.anchor})`);
    }
    if (Math.abs(oy) > 1e-9) {
      ok(Math.sign(cy) === Math.sign(oy), `${deg}°/${gap}: box is on the offset's y side (${got.anchor})`);
    }
  }
}
ok(seen.size >= 3, `the sweep exercised more than one spot (saw ${[...seen].join(', ')})`);

/* ------------------------------------------------------------------------ */

console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
