#!/usr/bin/env node
/**
 * test-slider-grab.mjs — where the slider thumb actually IS
 * (ui/slider-grab.js, `thumbCenterOffset`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-slider-grab.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> WHY THIS SUITE EXISTS. <==
 *
 * Settings sliders now refuse any press that does not land on the thumb, which
 * means the app has to KNOW where the thumb is. The obvious version of that
 * maths — `left + fraction * width` — is wrong, and wrong in a way nobody
 * would report clearly. The thumb's centre stops half a thumb in from each
 * end, so the naive form drifts by up to half a thumb, and the drift is worst
 * exactly at the two ends. The symptom on a phone is "the cloud radius slider
 * won't move when it's pushed all the way up" — a slider that has quietly
 * become ungrabbable at its own maximum, on a control the user can see and is
 * touching correctly.
 *
 * The ends are therefore asserted to the pixel, not approximately. This suite
 * was checked by reintroducing the naive form: the max-end and min-end cases
 * fail, which is the whole point of writing it.
 *
 * It also pins the touch rule as ARITHMETIC rather than as a comment: thumb
 * plus slop on a coarse pointer must clear 44px (§9). A future tidy-up that
 * shrinks either number gets caught here rather than on somebody's phone.
 *
 * WHAT THIS CANNOT PROVE. That the browser draws the thumb where CSS says it
 * does, that `preventDefault` actually stops the native drag in every engine,
 * or that the slop FEELS right under a thumb. Those are glass. It closes the
 * one hole that is pure arithmetic and silent when broken.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { thumbCenterOffset } = await import('../ui/slider-grab.js');
const { SLIDER } = await import('../config/constants.js');

/** A 300px-wide control with a 20px thumb — a settings slider on a desktop. */
const at = (value, over = {}) =>
  thumbCenterOffset({ width: 300, thumb: 20, min: 0, max: 100, value, ...over });

/* ------------------------------------------------------------------ */
section('The ends — where the naive maths breaks');

{
  ok(at(0) === 10, 'at minimum: centre sits half a thumb in from the left');
  ok(at(100) === 290, 'at maximum: centre sits half a thumb in from the right');
  /* Stated the other way round, because this is the failure that matters:
   * the naive form would put it at 300, a full half-thumb past the real
   * position and outside the grab zone. */
  ok(at(100) === 300 - 10, 'at maximum: NOT flush with the right edge');
  ok(at(50) === 150, 'at the midpoint: dead centre');
}

/* ------------------------------------------------------------------ */
section('The travel is the box less one whole thumb');

{
  /* 300 wide, 20 thumb -> 280 of travel. A quarter of the range is 70px of
   * travel from a start of 10. */
  ok(at(25) === 80, 'quarter value: 10 + a quarter of 280');
  ok(at(75) === 220, 'three-quarter value: 10 + three quarters of 280');

  /* A fatter thumb has less room to move, so the same value sits closer to
   * the middle. This is the relationship a hardcoded 20 in the JS would break
   * the moment `(pointer: coarse)` swapped the CSS to 28. */
  const fine = at(100);
  const coarse = at(100, { thumb: 28 });
  ok(coarse === 286, 'coarse thumb at maximum: 300 - 14');
  ok(coarse < fine, 'a bigger thumb reaches less far');
}

/* ------------------------------------------------------------------ */
section('The real shipped ranges, not just 0-100');

{
  /* Pulled from constants rather than typed here: if a slider's range ever
   * changes, this suite should follow it rather than test a range the app no
   * longer has. */
  const { GLOBE, IMAGERY } = await import('../config/constants.js');
  const mid = (r) => (r.min + r.max) / 2;

  const delay = GLOBE.autoRotateDelayRange;
  ok(thumbCenterOffset(
      { width: 260, thumb: 28, min: delay.min, max: delay.max,
        value: mid(delay) }) === 130,
    'drift delay halfway: dead centre whatever the units are');

  /* The imagery fade is a FRACTION with a non-zero minimum, so the ratio it
   * computes is exact in decimal and not in binary. A hair of float noise is
   * meaningless when the answer is compared against a 10px grab slop, so this
   * one is asserted to within a pixel rather than to the bit. */
  const fade = IMAGERY.tuning.fade;
  const centred = thumbCenterOffset(
    { width: 200, thumb: 20, min: fade.min, max: fade.max, value: mid(fade) });
  ok(Math.abs(centred - 100) < 1,
    'edge fade halfway: still centred despite a fractional range');
}

/* ------------------------------------------------------------------ */
section('Degenerate inputs cannot produce a grab zone off in space');

{
  /* Every one of these returns a real number inside the control. A NaN here
   * would make every press land "off the thumb" and freeze all four sliders
   * at once — the loudest possible version of this bug, so it is the one most
   * worth being sure about. */
  const sane = (o, label) => {
    const v = thumbCenterOffset(o);
    ok(Number.isFinite(v) && v >= 0 && v <= o.width, label);
  };

  sane({ width: 300, thumb: 20, min: 5, max: 5, value: 5 },
    'min equal to max: no division by zero');
  sane({ width: 10, thumb: 20, min: 0, max: 100, value: 50 },
    'control narrower than its own thumb: no negative travel');
  sane({ width: 300, thumb: 20, min: 0, max: 100, value: NaN },
    'an unparseable value: falls back to the low end');

  ok(at(500) === 290, 'a value above maximum clamps to the maximum');
  ok(at(-500) === 10, 'a value below minimum clamps to the minimum');
}

/* ------------------------------------------------------------------ */
section('The grab zone is still a 44px touch target');

{
  /* The coarse thumb size lives in panels.css, so it is READ rather than
   * restated — a second copy of 28 here would be the drift this whole file
   * exists to prevent. */
  const css = readFileSync('ui/panels.css', 'utf8');
  const coarse = css.match(
    /\(pointer:\s*coarse\)[^}]*--slider-thumb:\s*(\d+)px/s);
  ok(coarse, 'panels.css still sets --slider-thumb for a coarse pointer');

  if (coarse) {
    const zone = Number(coarse[1]) + 2 * SLIDER.grabSlopPx;
    ok(zone >= 44,
      `finger grab zone is ${zone}px, which must be at least 44 (§9)`);
  }

  /* The fine-pointer default is declared once, in index.html, and the JS
   * fallback must agree with it or a stylesheet that failed to load would
   * silently change the grab zone rather than just the look. */
  const html = readFileSync('index.html', 'utf8');
  const fine = html.match(/--slider-thumb:\s*(\d+)px/);
  ok(fine, 'index.html declares --slider-thumb');
  ok(fine && Number(fine[1]) === SLIDER.thumbFallbackPx,
    'SLIDER.thumbFallbackPx matches the declared token');
}

/* ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
