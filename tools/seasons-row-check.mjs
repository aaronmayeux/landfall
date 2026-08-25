#!/usr/bin/env node
/**
 * seasons-row-check.mjs — the roster row's COLUMNS, measured in a browser.
 *
 *   bash tools/with-server.sh node tools/seasons-row-check.mjs
 *
 * ==> IT EXISTS BECAUSE THE THING THAT WAS WRONG IS INVISIBLE TO EVERY OTHER
 * CHECK HERE. <== The badge column shipped jagged: `auto` grid tracks are
 * sized per ROW, and every row in this list is its own grid, so a row reading
 * `Jul 4 – Jul 7` gave its date column 68px and one reading `Sep 17 – Sep 28`
 * gave it 101px — which slid the badge 33px sideways between one line and the
 * next. The markup was identical, the classes were all defined, the type was
 * on the scale, and 130 board assertions passed. Only geometry says it, and
 * only a browser has geometry.
 *
 * ==> AND IT IS A CHECK RATHER THAN A PREVIEW BECAUSE THE FIX IS A NUMBER.
 * <== The two right-hand tracks are fixed at 6ch and 15ch, chosen from measured
 * strings plus headroom. A track a few pixels short does not ellipse — it
 * widens, and the jaggedness comes straight back. This is what notices.
 *
 * It renders the real `seasons.css` against the real tokens, with the real
 * markup function, so there is no fixture to drift (the lesson of
 * `tools/drawer-head-harness.html`). What it CANNOT judge is whether the
 * result reads well, which is glass.
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const URL = `http://127.0.0.1:${PORT}/tools/seasons-row-harness.html`;

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };

const browser = await chromium.launch();
try {
  for (const [label, width] of [['narrow (two lines)', 390], ['wide (one line)', 720]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    ok(`${label}: the harness renders without throwing`, errs.length === 0);

    const cols = await page.$$eval('.seasons-row', (rows) => rows.map((r) => ({
      badge: r.querySelector('.row-badge')?.getBoundingClientRect().left ?? null,
      badgeRight: r.querySelector('.row-badge')?.getBoundingClientRect().right ?? null,
      dateRight: r.querySelector('.seasons-when')?.getBoundingClientRect().right ?? null,
      text: r.querySelector('.row-badge')?.textContent.trim(),
    })));

    ok(`${label}: every row rendered a badge`,
      cols.length > 3 && cols.every((c) => c.badge !== null));

    const spread = (k) => Math.max(...cols.map((c) => c[k])) - Math.min(...cols.map((c) => c[k]));

    /* ==> ONE PIXEL, NOT ZERO. <== Sub-pixel layout is real; a whole pixel of
     * drift is not visible and a fixed track cannot produce more than rounding.
     * The bug this replaces was 33px. */
    ok(`${label}: the badges share a left edge (spread ${spread('badge').toFixed(2)}px, was 33)`,
      spread('badge') <= 1);
    ok(`${label}: and a right edge, so the track is fixed rather than fitted (spread ${spread('badgeRight').toFixed(2)}px)`,
      spread('badgeRight') <= 1);
    ok(`${label}: the dates end flush (spread ${spread('dateRight').toFixed(2)}px)`,
      spread('dateRight') <= 1);

    /* ==> AND NOTHING OVERFLOWED ITS TRACK, WHICH IS THE FAILURE THE HEADROOM
     * EXISTS FOR. <== A badge wider than its column does not ellipse, it
     * spills over the dates beside it.
     *
     * ==> `scrollWidth` DOES NOT ANSWER THIS AND THE FIRST VERSION USED IT.
     * <== On a box whose overflow is visible the browser clamps `scrollWidth`
     * to the padding box, so a badge spilling 4px reported no overflow at all
     * and a deliberately-too-narrow track passed. The content width has to be
     * asked for directly: `max-content` on a copy of the box, compared with
     * what the track actually gave it. */
    for (const sel of ['.row-badge', '.seasons-row-meta']) {
      const over = await page.$$eval('.seasons-row', (rows, s2) => rows.map((r) => {
        const el = r.querySelector(s2);
        if (!el) return null;
        const had = el.style.width;
        el.style.width = 'max-content';
        const need = el.getBoundingClientRect().width;
        el.style.width = had;
        const got = el.getBoundingClientRect().width;
        return need > got + 0.5 ? `${el.textContent.trim()} needs ${need.toFixed(0)} got ${got.toFixed(0)}` : null;
      }).filter(Boolean), sel);
      /* ==> THE DATE COLUMN NEEDS THIS AS MUCH AS THE BADGE DOES, AND IT WAS
       * MISSING. <== The meta block is pushed to the end of its track, so
       * content too wide for it overflows to the LEFT, under the badge — every
       * right edge stays perfectly aligned while the row is visibly broken.
       * A mutation narrowing that track passed everything else here. */
      ok(`${label}: nothing overflows the ${sel} track${over.length ? ` (${over.join('; ')})` : ''}`,
        over.length === 0);
    }

    /* The row bleeds past the scroller's padding to the drawer's own edge. */
    const bleed = await page.$$eval('.seasons-row', (rows) => {
      const host = document.querySelector('.drawer-body');
      const h = host.getBoundingClientRect();
      const r = rows[0].getBoundingClientRect();
      return { left: r.left - h.left, right: h.right - r.right };
    });
    ok(`${label}: the row runs to the scroller's own edge (${bleed.left.toFixed(1)}px / ${bleed.right.toFixed(1)}px)`,
      Math.abs(bleed.left) <= 1 && Math.abs(bleed.right) <= 1);

    /* The layout the width is supposed to produce. Two lines below the
     * container breakpoint, one above it — measured, not assumed. */
    const lines = await page.$eval('.seasons-row .seasons-row-text', (el) => {
      const name = el.querySelector('.seasons-name').getBoundingClientRect();
      const meta = el.querySelector('.seasons-row-meta').getBoundingClientRect();
      return meta.top >= name.bottom - 1 ? 2 : 1;
    });
    ok(`${label}: lays out as expected`, lines === (width < 600 ? 2 : 1));

    await page.close();
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} row-geometry assertions pass — the columns line up`);
console.log('  (whether the row READS well is glass)');
