#!/usr/bin/env node
/**
 * seasons-clock-check.mjs — the season clock's two marks sit in ONE grid cell,
 * dead centre of the button. SPEC-SEASONS-BUILD.md §57.67g, §57.67j.
 *
 * ==> ONLY GEOMETRY SAYS THIS, WHICH IS THE WHOLE REASON IT IS A BROWSER CHECK.
 * <== The rule that stacks them was silently DEAD for two commits. A comment in
 * `seasons/seasons.css` closed early, the prose after it became raw CSS, and
 * the parser's error recovery discarded everything up to the end of the next
 * rule — which was the stacking rule. Nothing errored. Every text scan in this
 * repo stayed green, because the rule is still there in the file, correctly
 * spelled, doing nothing.
 *
 * What Aaron saw on his phone: the play triangle jammed against the TOP edge of
 * the button and, on tapping it, the second mark against the BOTTOM. Two marks
 * in two implicit grid rows, each centred inside its own.
 *
 * ==> THE SECOND MARK IS A PAUSE NOW AND WAS A STOP SQUARE IN SLICE C. <== The
 * geometry this file asserts is unchanged by that and that is the point: both
 * marks span the same 4.5-19.5 band and both are centred on (12,12), so the
 * column does not flicker between two sizes when the button is pressed.
 *
 * `tools/css-structure-check.mjs` is the cheap gate that catches the CAUSE and
 * runs on every push. This is the one that catches the EFFECT, and it is worth
 * having both: a stylesheet can lose a rule for reasons that have nothing to do
 * with a comment.
 *
 * ==> IT BUILDS THE BUTTON THE WAY THE COMPONENT DOES RATHER THAN OPENING THE
 * ARCHIVE. <== The archive needs the basemap and the basemap is unreachable
 * from this sandbox (`CLAUDE.md`), so a check that entered it could never run
 * here — and this fault is about a stylesheet and a button, neither of which
 * needs a globe. The markup is built from the SAME attributes
 * `seasons/clock-control.js` sets, against the REAL `index.html` and the REAL
 * `seasons/seasons.css`, so nothing about the cascade is invented.
 *
 * Needs the server: `bash tools/with-server.sh node tools/seasons-clock-check.mjs`
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;

/* The phone Aaron judges on, and the size every other seasons measurement in
 * this repo was taken at. */
const VIEWPORT = { width: 390, height: 844 };

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });

  const out = await page.evaluate(() => {
    /* Every archive rule hangs off this, exactly as `seasons/index.js` sets it. */
    document.documentElement.setAttribute('data-seasons', 'on');

    const NS = 'http://www.w3.org/2000/svg';
    const fab = document.createElement('button');
    fab.id = 'btn-season-clock';
    fab.className = 'control';

    const mark = (cls, child) => {
      const s = document.createElementNS(NS, 'svg');
      s.setAttribute('class', cls);
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('fill', 'none');
      s.setAttribute('stroke', 'currentColor');
      s.setAttribute('stroke-width', '1.7');
      s.append(child);
      return s;
    };
    const tri = document.createElementNS(NS, 'path');
    tri.setAttribute('d', 'M6.5 4.5 L17.5 12 L6.5 19.5 Z');
    /* Two bars in ONE svg, which is what the component builds — they are one
     * mark and have to cross-fade together. */
    const pause = document.createElementNS(NS, 'svg');
    pause.setAttribute('class', 'clock-pause');
    pause.setAttribute('viewBox', '0 0 24 24');
    pause.setAttribute('fill', 'none');
    pause.setAttribute('stroke', 'currentColor');
    pause.setAttribute('stroke-width', '1.7');
    for (const x of ['9', '15']) {
      const bar = document.createElementNS(NS, 'path');
      bar.setAttribute('d', `M${x} 4.5 V19.5`);
      pause.append(bar);
    }
    fab.append(mark('clock-play', tri), pause);
    document.getElementById('controls').prepend(fab);

    /* ==> AND THE PILL, BECAUSE THE SECOND FAULT THIS FILE COVERS IS THE TWO
     * PIECES COLLIDING RATHER THAN EITHER ONE BEING WRONG. <== Built from the
     * same attributes `seasons/clock-control.js` sets, against the real
     * stylesheet, with the archive's own root flags on. */
    document.documentElement.setAttribute('data-seasons-clock', 'on');
    const pill = document.createElement('div');
    pill.id = 'seasons-clock-pill';
    const date = document.createElement('span');
    date.className = 'seasons-clock-date';
    date.textContent = 'May 23, 2020, 12:12 AM UTC';
    const row = document.createElement('div');
    row.className = 'seasons-clock-row';
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'slider seasons-clock-range';
    range.min = '0'; range.max = '1000';
    const leave = document.createElement('button');
    leave.className = 'seasons-clock-leave';
    leave.append(document.createElementNS(NS, 'svg'));
    row.append(range, leave);
    pill.append(date, row);
    document.body.appendChild(pill);

    const box = (el) => {
      const b = el.getBoundingClientRect();
      return {
        l: +b.left.toFixed(1), r: +b.right.toFixed(1),
        t: +b.top.toFixed(1), b: +b.bottom.toFixed(1),
        w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      };
    };

    const fr = fab.getBoundingClientRect();
    return {
      controls: box(document.getElementById('controls')),
      pill: box(pill),
      range: box(range),
      leave: box(leave),
      fab: { w: fr.width, h: fr.height, display: getComputedStyle(fab).display },
      marks: [...fab.children].map((s) => {
        const r = s.getBoundingClientRect();
        const c = getComputedStyle(s);
        return {
          cls: s.getAttribute('class'),
          row: c.gridRowStart,
          col: c.gridColumnStart,
          top: +(r.top - fr.top).toFixed(2),
          left: +(r.left - fr.left).toFixed(2),
          w: +r.width.toFixed(2),
          h: +r.height.toFixed(2),
        };
      }),
    };
  });

  ok(`the page threw nothing (${errs.length} errors)`, errs.length === 0);
  ok('the button is a 44px grid, which is where the stacking comes from',
    out.fab.display === 'grid' && out.fab.w === 44 && out.fab.h === 44);
  ok(`both marks were found (${out.marks.length})`, out.marks.length === 2);

  for (const m of out.marks) {
    /* ==> THE ASSERTION THAT WOULD HAVE CAUGHT IT. <== `auto` here is a rule
     * that did not survive the cascade, and it is indistinguishable from a rule
     * that was never written. */
    ok(`.${m.cls} is placed in row 1 column 1 rather than flowing into its own `
      + `row (got ${m.row} / ${m.col})`, m.row === '1' && m.col === '1');

    /* Centred is arithmetic, not a threshold somebody chose: a 20px mark in a
     * 44px box leaves 12px either side. Asserted to a sub-pixel tolerance
     * because a fractional device pixel ratio is not a bug. */
    const wantX = (out.fab.w - m.w) / 2;
    const wantY = (out.fab.h - m.h) / 2;
    ok(`.${m.cls} is centred in the button — ${m.left},${m.top} against `
      + `${wantX},${wantY}`,
    Math.abs(m.left - wantX) < 0.5 && Math.abs(m.top - wantY) < 0.5);
  }

  /* And they are on top of each other, which is what a cross-fade needs. Two
   * marks each centred in their OWN row would pass every assertion above if
   * the rows happened to be the same height, so this is the one that pins the
   * pair together rather than each of them separately. */
  const [a, b] = out.marks;
  ok(`the two marks occupy the same place (${a.left},${a.top} and ${b.left},${b.top})`,
    a.left === b.left && a.top === b.top);

  /* ==> AND THE SCRUBBER PILL DOES NOT RUN UNDER THE CONTROL CLUSTER. <== The
   * second fault this file exists for, and it shipped: the pill took
   * `--space-comfy` off both sides and centred itself, which on a 390px phone
   * put its right edge at 374 against a cluster starting at 334. `#controls` is
   * z-index 40 and the pill is 20, so the FABs painted over it and 23 of the
   * leave button's 44 pixels were underneath the settings gear — a control the
   * reader can see half of and cannot press. Aaron on a phone, 2026-08-31.
   *
   * Every text scan stayed green on it, exactly as they did for the stacking
   * rule above: both elements were correctly styled and correctly placed by
   * their own rules, and only their two boxes together say anything is wrong. */
  ok(`the pill stops short of the control cluster — its right edge is at `
    + `${out.pill.r} and the cluster starts at ${out.controls.l}`,
  out.pill.r < out.controls.l);

  /* Not merely "not overlapping": two glass surfaces touching read as one
   * broken surface. `--space-snug` is the gap the cluster already puts between
   * its own buttons, so it is the app's own answer to "how far apart is
   * separate" rather than a number chosen here. */
  const gap = out.controls.l - out.pill.r;
  ok(`and it clears it by a visible margin rather than merely missing it (${gap}px)`,
    gap >= 8);

  /* The leave button is the piece that was actually unreachable, so it is
   * asserted on its own rather than trusted to the pill's edge. */
  ok(`the leave control is entirely clear of the cluster (${out.leave.l}-${out.leave.r})`,
    out.leave.r < out.controls.l);
  ok(`and it is still a full 44px target (${out.leave.w}x${out.leave.h})`,
    out.leave.w === 44 && out.leave.h === 44);

  /* ==> THE SLIDER MUST STILL BE WORTH DRAGGING. <== §57.67g rejected a centred
   * `--pill-inset` because it would have left the track "barely a hundred
   * pixels". Whatever this pill gives up to clear the cluster, it may not give
   * up so much that it lands back in the thing that argument refused. */
  ok(`the scrubber still has a real track at ${VIEWPORT.width}px wide `
    + `(${out.range.w}px)`, out.range.w >= 150);
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} geometry assertions pass — the clock's two marks share `
  + 'one cell, and the pill clears the cluster\n  (whether the ICONS read as play '
  + 'and pause is glass)');
