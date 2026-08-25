#!/usr/bin/env node
/**
 * seasons-height-check.mjs — the archive sheet must not resize with the year.
 *
 *   bash tools/with-server.sh node tools/seasons-height-check.mjs
 *
 * ==> THE BUG WAS A COMPARISON, SO THE CHECK HAS TO BE ONE. <== Aaron on glass
 * 2026-08-25: stepping the year resized the drawer, so the `+`/`−` buttons
 * moved and had to be hunted for after every press — on the one control in
 * this view a reader uses repeatedly. The cause was `max-height` alone, which
 * is a CEILING: a year with four storms is shorter than a year with
 * twenty-eight. Measuring ONE year cannot see that. This opens the busiest
 * season in the record (2005, 31 storms) and the quietest (1914, 1) and asks
 * whether the sheet is the same size in both.
 *
 * ==> AND IT ASKS THE BROWSER, BECAUSE NOTHING ELSE HERE CAN. <== A stylesheet
 * scan can prove the `height` declaration is present; only layout can prove it
 * WINS — the rule sits inside a media query, reads two custom properties and a
 * `min()`, and any of those going wrong drops it silently. `tools/
 * css-orphan-check.mjs` passed the whole time this was broken.
 *
 * The companion `tools/seasons-height-measure.mjs` prints the arithmetic
 * behind the value; this one guards the behaviour.
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const url = (year) => `http://127.0.0.1:${PORT}/tools/seasons-height-harness.html?year=${year}`;

/* The phone Aaron judges on, and the size every other seasons measurement in
 * this repo was taken at (§57.21b item 3). */
const VIEWPORT = { width: 390, height: 844 };

/** Counted off the real files: 2005 is the busiest Atlantic season on record
 *  and 1914 the quietest. Both are asserted below rather than trusted, because
 *  a comparison between two years that turned out to be similar would pass
 *  over the bug it exists to catch. */
const BUSY = 2005;
const QUIET = 1914;

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };

const browser = await chromium.launch();
try {
  const read = async (year) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(url(year), { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => document.documentElement.dataset.harnessReady === 'true',
      null, { timeout: 15000 }
    );
    const out = await page.evaluate(() => {
      const d = document.getElementById('drawer');
      const stepper = document.querySelector('.seasons-year');
      return {
        height: d.getBoundingClientRect().height,
        top: d.getBoundingClientRect().top,
        /* The control that was walking. Its position is the symptom a reader
         * actually feels, so it is asserted beside the height rather than
         * inferred from it. */
        stepperTop: stepper ? stepper.getBoundingClientRect().top : null,
        rows: document.querySelectorAll('.seasons-row').length,
      };
    });
    await page.close();
    return { ...out, errs };
  };

  const busy = await read(BUSY);
  const quiet = await read(QUIET);

  ok(`${BUSY} renders without throwing`, busy.errs.length === 0);
  ok(`${QUIET} renders without throwing`, quiet.errs.length === 0);

  /* THE PRECONDITION. If these two years ever stopped differing sharply, every
   * assertion below would pass while proving nothing — the §12 failure. */
  ok(`${BUSY} is a busy season (got ${busy.rows} rows, want > 20)`, busy.rows > 20);
  ok(`${QUIET} is a quiet one (got ${quiet.rows} rows, want < 5)`, quiet.rows < 5);

  /* ==> ONE PIXEL, NOT ZERO. <== Sub-pixel layout is real and a whole pixel is
   * not visible. The fault this replaces was the difference between a roster
   * of 31 rows and one of 1 — hundreds. */
  const dh = Math.abs(busy.height - quiet.height);
  ok(`the sheet is the same height in both years `
    + `(${busy.height.toFixed(1)}px vs ${quiet.height.toFixed(1)}px, diff ${dh.toFixed(1)}px)`,
  dh <= 1);

  const dt = Math.abs(busy.stepperTop - quiet.stepperTop);
  ok(`the year stepper does not move `
    + `(${busy.stepperTop?.toFixed(1)}px vs ${quiet.stepperTop?.toFixed(1)}px, diff ${dt.toFixed(1)}px)`,
  busy.stepperTop !== null && quiet.stepperTop !== null && dt <= 1);

  /* AND IT IS THE RIGHT HEIGHT, not merely a consistent one. A rule that
   * collapsed both years to the same tiny box would satisfy everything above.
   * The band is wide because the exact figure is a glass dial — this only
   * refuses a sheet that has plainly stopped being most of the screen. */
  const vh = (busy.height / VIEWPORT.height) * 100;
  ok(`and it is a sheet rather than a strip (${vh.toFixed(1)}vh, want 45–85)`,
    vh >= 45 && vh <= 85);

  /* ==> AND THE NO-`dvh` FALLBACK, WHICH THIS BROWSER CANNOT SHOW. <== Both
   * `height` and `max-height` are declared twice: a plain `vh` first, then the
   * `min(…, 100dvh …)` that supersedes it. The plain one exists for a browser
   * that does not understand `dvh` and would otherwise drop the whole
   * declaration and go back to a content height — the exact bug.
   *
   * ==> IT IS ASSERTED AGAINST THE STYLESHEET TEXT BECAUSE CHROMIUM SUPPORTS
   * `dvh`, SO DELETING THE FALLBACK CHANGES NOTHING MEASURABLE HERE. <== It
   * was run as a mutation and survived every layout assertion above, which is
   * the §12 failure — a check that is green over a real regression. The honest
   * fix is a different instrument rather than a looser number, the same call
   * `tools/test-seam-layers.mjs` made about a helper nobody called. What this
   * cannot do is prove the fallback WORKS; only that it is still there. */
  const css = await (await fetch(`http://127.0.0.1:${PORT}/seasons/seasons.css`)).text();
  const rule = css.slice(css.indexOf('--seasons-sheet-h'));
  const declared = (prop) =>
    new RegExp(`\\n\\s*${prop}:\\s*var\\(--seasons-sheet-h\\);`).test(rule)
    && new RegExp(`\\n\\s*${prop}:\\s*min\\(var\\(--seasons-sheet-h\\)`).test(rule);

  ok('height is declared twice, plain vh then min(dvh)', declared('height'));
  ok('max-height is declared twice, plain vh then min(dvh)', declared('max-height'));
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`\nseasons-height-check: ${pass} passed, ${fails.length} FAILED\n`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} height assertions pass — the sheet holds one height across years`);
console.log('  (whether four names is the RIGHT number is glass)\n');
