#!/usr/bin/env node
/**
 * seasons-height-measure.mjs — how tall must the sheet be to show four names?
 *
 *   bash tools/with-server.sh node tools/seasons-height-measure.mjs
 *
 * ==> A MEASUREMENT, NOT A CHECK. It prints and never fails. <== Aaron's number
 * is "about four storm names", and the furniture above the roster — picker,
 * live-down sentence, scorecard, filters — is not a fixed height, so no `vh`
 * figure yields exactly four rows on every year and every screen. There is a
 * right STARTING value though, and CLAUDE.md's rule is that a figure appearing
 * in prose or in a constant is computed and quoted rather than reasoned to.
 * This is the script that computes it.
 *
 * Run it again after anything changes the furniture — step 9 adds a filter and
 * a near-home slider to this same view, and both land above the roster.
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const URL = `http://127.0.0.1:${PORT}/tools/seasons-height-harness.html`;

/* The phone Aaron judges on, and the size every other seasons measurement in
 * this repo was taken at (§57.21b item 3). */
const VIEWPORT = { width: 390, height: 844 };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.harnessReady === 'true',
    null, { timeout: 15000 });

  if (errs.length) {
    console.error('the harness threw — the numbers below would be about nothing:');
    for (const e of errs) console.error(`  ${e}`);
    process.exit(1);
  }

  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.seasons-row')];
    const drawer = document.getElementById('drawer').getBoundingClientRect();
    const first = rows[0].getBoundingClientRect();
    const h = (el) => (el ? el.getBoundingClientRect().height : null);

    /* ==> BY THE CLASSES THE MARKUP ACTUALLY EMITS. <== The first version of
     * this asked for `.seasons-filters` and `.seasons-livedown`, and neither
     * exists: the filters are a `.seg-group` (the SECOND one — the basin and
     * year picker is the first) and the live-down note is a `.seasons-note`.
     * Both reported "(not rendered)" against a board that had rendered them
     * perfectly well, which is a breakdown that lies while the total beside it
     * is right — the reason the reconcile assertion below exists. */
    const segGroups = [...document.querySelectorAll('.seg-group')];

    /* Row PITCH rather than row height: what a reader counts is names, and the
     * gap between them is part of what one name costs. Taken across several
     * rows and averaged, because a two-line row and a one-line row are both
     * real at 390px. */
    const tops = rows.slice(0, 8).map((r) => r.getBoundingClientRect().top);
    const gaps = tops.slice(1).map((t, i) => t - tops[i]);
    const pitch = gaps.reduce((a, b) => a + b, 0) / gaps.length;

    return {
      screen: window.innerHeight,
      drawerHeight: drawer.height,
      /* Everything from the top of the sheet to the top of the first name. */
      furniture: first.top - drawer.top,
      pitch,
      rowCount: rows.length,
      parts: {
        'drawer header': h(document.querySelector('.drawer-head')),
        'basin + year picker': h(document.querySelector('.seasons-picker')),
        'live-down note': h(document.querySelector('.seasons-note')),
        scorecard: h(document.querySelector('.seasons-score')),
        filters: h(segGroups[1] ?? null),
      },
    };
  });

  const NAMES = 4;
  const wanted = m.furniture + NAMES * m.pitch;
  const vh = (wanted / m.screen) * 100;

  console.log(`\nseasons drawer height — measured at ${VIEWPORT.width}x${VIEWPORT.height}\n`);
  console.log(`  roster rows rendered        ${m.rowCount} (2005, the busiest season)`);
  console.log(`  furniture above the roster  ${m.furniture.toFixed(1)}px`);
  let named = 0;
  for (const [k, v] of Object.entries(m.parts)) {
    console.log(`    ${k.padEnd(24)}${v === null ? '(not rendered)' : `${v.toFixed(1)}px`}`);
    named += v || 0;
  }
  console.log(`    ${'(gaps and padding)'.padEnd(24)}${(m.furniture - named).toFixed(1)}px`);

  /* ==> THE BREAKDOWN HAS TO ADD UP TO THE TOTAL, OR THE BREAKDOWN IS WRONG.
   * <== A part measured with a selector that names nothing reads as zero and
   * costs nothing visible; it happened twice in the first run of this file.
   * The total comes off the first row's own position and cannot be fooled that
   * way, so the difference between them is the check. */
  const slack = m.furniture - named;
  if (slack < -1 || slack > 120) {
    console.error(`\n  !! the parts do not reconcile with the total (${slack.toFixed(1)}px unaccounted).`);
    console.error('     A selector above has probably stopped naming anything. The => figure');
    console.error('     is still trustworthy — it comes off the first row — but fix the list.\n');
  }

  console.log(`  one storm name costs        ${m.pitch.toFixed(1)}px (row pitch)`);
  console.log(`  ${NAMES} names therefore need      ${wanted.toFixed(1)}px`);
  console.log(`\n  => ${vh.toFixed(1)}vh  (round to ${Math.round(vh / 5) * 5}vh)\n`);
  console.log(`  today's 75vh shows          ${((0.75 * m.screen - m.furniture) / m.pitch).toFixed(1)} names\n`);
} finally {
  await browser.close();
}
