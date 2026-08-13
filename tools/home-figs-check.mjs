#!/usr/bin/env node
/**
 * home-figs-check.mjs — the strength strip's three lines line up across its
 * columns, and the air between the columns is even (SPEC-UI §8).
 *
 * ==> WHY THIS CANNOT BE A STRING ASSERTION. <== Everything here is a pixel
 * fact. `tools/test-home.mjs` can prove the strip emits the right CELLS and no
 * empty ones; it cannot see that one cell's figure sits a line lower than the
 * two beside it, which is exactly the bug that shipped.
 *
 * THE BUG. Each cell was its own block in an `N x 1fr` grid, so the label, the
 * figure and the note only lined up while every label happened to be one line
 * long. "When it's closest" is the longest label and it wrapped as soon as its
 * column got tight — which the 340px desktop rail did — dropping that column's
 * figure below the two either side of it. Three figures at three heights read
 * as a rendering fault rather than as the comparison the strip exists to be.
 *
 * 308px IS THE CASE THAT BROKE, not a round number: it is the strip's width
 * inside the narrowest desktop rail (340 rail - 16 body - 16 section padding).
 * The phone widths are here so a fix aimed at desktop cannot quietly cost the
 * layout that was already right.
 *
 * Run it with the static server up, in ONE shell command — a background server
 * does not survive between shell calls:
 *
 *     bash tools/with-server.sh node tools/home-figs-check.mjs
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

/* The real stylesheet and the real tokens — not a copy. A fixture that
 * restates either is measuring a different app, which this project has already
 * paid for once (see tools/drawer-head-harness.html). */
const homeCss = readFileSync(join(ROOT, 'ui/home.css'), 'utf8');
const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
const rootStart = idx.indexOf(':root {');
const rootBlock = idx.slice(rootStart, idx.indexOf('}', idx.lastIndexOf('--keyboard-inset', idx.indexOf('</style>'))) + 1);

/** The widest real label set, which is the one that used to wrap. */
const THREE = [
  { k: 'Now', v: '40 mph', s: 'TS' },
  { k: "When it's closest", v: '69 mph', s: 'TS' },
  { k: 'Strongest', v: '81 mph', s: 'after it passes' },
];
/** A GDACS storm publishes no forecast intensity and loses the middle cell. */
const TWO = [
  { k: 'Now', v: '40 mph', s: 'TS' },
  { k: 'Strongest', v: '105 mph', s: 'before it reaches you' },
];

const page = (cells) =>
  `<style>${rootBlock}
   body{margin:0;font-family:var(--font-ui);background:#0b1420;color:#E8F1F8}
   ${homeCss}</style>
   <div id="w"><div class="home-figs">${cells
     .map(
       (c) =>
         `<div><div class="home-figs-k">${c.k}</div>` +
         `<div class="home-figs-v">${c.v}</div>` +
         `<div class="home-figs-s">${c.s}</div></div>`
     )
     .join('')}</div></div>`;

const browser = await chromium.launch({ executablePath: EXE });

/* 308 = narrowest desktop rail. 358 = a 390px phone. 424 = the widest rail. */
for (const [label, cells] of [['three cells', THREE], ['two cells', TWO]]) {
  for (const width of [288, 308, 358, 424]) {
    const p = await browser.newPage({ viewport: { width: width + 60, height: 420 } });
    p.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
    await p.setContent(page(cells));
    await p.evaluate((w) => { document.getElementById('w').style.width = `${w}px`; }, width);

    const m = await p.evaluate(() => {
      const rects = (sel) =>
        [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
      const k = rects('.home-figs-k');
      const v = rects('.home-figs-v');
      const s = rects('.home-figs-s');
      const wrap = document.querySelector('.home-figs').getBoundingClientRect();
      /* ==> CENTRES, NOT TOP EDGES. <== The row is `align-items: center`, so a
       * label that wraps to two lines grows its row and the one-line labels
       * beside it centre inside that taller row — their TOPS then differ by
       * design while the lines are, correctly, aligned. Measuring tops caught
       * that as a failure at 288px and was measuring the wrong thing. The
       * claim is that the three lines share a centreline, so that is what is
       * measured. */
      const spread = (r) => {
        const mid = r.map((b) => b.top + b.height / 2);
        return Math.max(...mid) - Math.min(...mid);
      };
      const gutters = [];
      for (let i = 1; i < k.length; i++) gutters.push(k[i].left - k[i - 1].right);
      return {
        rowSpread: Math.max(spread(k), spread(v), spread(s)),
        tallestLabel: Math.max(...k.map((b) => b.height)),
        gutters,
        leftEdge: k[0].left - wrap.left,
        rightEdge: wrap.right - k[k.length - 1].right,
        overflow: Math.max(...k.map((b) => b.right)) - wrap.right,
      };
    });

    const where = `${label} at ${width}px`;

    /* THE ONE THAT MATTERS. A spread of zero means every label shares a top
     * edge, every figure shares one, and every note shares one — which is the
     * whole claim. Sub-pixel tolerance only. */
    ok(
      m.rowSpread < 0.6,
      `${where}: the three lines share their rows across every column ` +
        `(worst row is ${m.rowSpread.toFixed(1)}px out of line)`
    );

    /* A wrapped label is what pushed a figure down in the first place, so no
     * label may wrap at any width the app actually renders a rail or a phone
     * at. 288px is EXEMPT and that is a real trade: it is a 320px phone, the
     * narrowest screen still in service, and there the three cells genuinely
     * do not fit on one line each. Wrapping is the right answer there —
     * `minmax(0, max-content)` lets the columns shrink instead of pushing 7px
     * of "after it passes" off the panel edge, which is what `max-content`
     * alone did. The centre-line assertion above still holds at 288, so the
     * figures stay in a row even when a label above them takes two.
     *
     * Written as an absolute height rather than read off a token, so raising
     * the type scale cannot move the goalposts to meet a regression. */
    if (width >= 308) {
      ok(
        m.tallestLabel < 22,
        `${where}: no label wraps to a second line (tallest is ${m.tallestLabel.toFixed(1)}px)`
      );
    }

    /* Even air between the groups. The eye measures the gap between the last
     * letter of one label and the first of the next, not the width of the
     * invisible track behind them — which is why equal `1fr` columns looked
     * uneven while being, technically, equal. */
    const gutterSpread = Math.max(...m.gutters) - Math.min(...m.gutters);
    ok(
      gutterSpread < 0.6,
      `${where}: the gutters between columns are even ` +
        `(${m.gutters.map((g) => g.toFixed(1)).join(' / ')})`
    );

    /* And the strip uses its full width rather than stranding a margin after
     * the last cell, which is the other half of what read as lopsided. */
    ok(
      Math.abs(m.leftEdge) < 0.6 && Math.abs(m.rightEdge) < 0.6,
      `${where}: the strip runs edge to edge ` +
        `(left ${m.leftEdge.toFixed(1)}px, right ${m.rightEdge.toFixed(1)}px)`
    );

    ok(
      m.overflow < 0.6,
      `${where}: nothing overflows the panel (${m.overflow.toFixed(1)}px past the edge)`
    );

    await p.close();
  }
}

await browser.close();

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`✓ ${pass} strength-strip layout assertions pass`);
console.log('  (the rows line up and the air is even; whether it READS is glass)');
