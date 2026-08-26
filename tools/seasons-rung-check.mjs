/**
 * seasons-rung-check.mjs — reopening the archive's drawer resumes the rung.
 * SPEC-SEASONS-BUILD.md §57.39, §57.36.
 *
 * ==> A REAL BROWSER, BECAUSE THE FAULT LIVED IN THE REAL DRAWER. <== The node
 * suites drive views against `tools/markup-dom.mjs`, which has no history
 * stack, no `currentArg` and no change notification — so the bug this file
 * exists to catch was invisible to every one of them. It was reported on glass
 * by Aaron, twice, and reproduced here in four lines.
 *
 * WHAT IT CAUGHT, so a future session does not have to rediscover either:
 *
 *   1. `lastRung` was only ever written when a year was TAPPED. Open 2005,
 *      press Back to the wall, minimise, reopen — and it came back on 2005,
 *      because nothing had ever unwritten the year. A record of the last rung
 *      ENTERED is not a record of where the reader IS.
 *
 *   2. The first fix for that erased its own memory. `restoreRung` navigated to
 *      the wall on its first line, the change listener heard it and wrote down
 *      "the reader is on the wall", and the next line read a year that was
 *      already null. Every restore landed on the top of the wall — the exact
 *      symptom it was written to cure. Only re-running this caught it.
 *
 * Needs a server on 8099 and a chromium:
 *   bash tools/with-server.sh node tools/seasons-rung-check.mjs
 */

import { chromium } from 'playwright';

let passed = 0;
const failures = [];
const ok = (what, cond) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failures.push(what); console.log(`  FAIL  ${what}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' });

const view = () => page.getAttribute('#drawer', 'data-view');
const shut = async () => {
  await page.click('.drawer-close, [aria-label="Minimise"], [aria-label="Close"]');
  await page.waitForTimeout(400);
};
/** The bar's own sentence is the control that reopens. §57.21b item 8. */
const reopen = async () => {
  await page.click('.seasons-bar-open');
  await page.waitForTimeout(800);
};

await page.waitForSelector('#btn-storms', { timeout: 20_000 });
await page.click('#btn-storms');
await page.waitForSelector('.seasons-door', { timeout: 20_000 });
await page.click('.seasons-door');
await page.waitForSelector('#seasons-wall-body .wall-row', { timeout: 30_000 });
ok('entering lands on the wall', await view() === 'seasons-wall');

/* ==> EVERY DOT ON SCREEN IS ONE SIZE. <== The wall's whole claim is that a
 * violent year looks longer than a quiet one, and that is only true if one
 * scale covers the screen. The pinned live row sits OUTSIDE the `.wall`
 * container, so a size published on `.wall` never reached it — two sizes on
 * one screen, reported on glass. */
const sizes = await page.evaluate(() => {
  const px = (el) => getComputedStyle(el).width;
  return [...new Set([...document.querySelectorAll('.wall-strip i')].slice(0, 500).map(px))];
});
ok(`one dot size across the whole screen (${sizes.join(', ')})`, sizes.length === 1);

await page.click('#seasons-wall-body .wall-row[data-year="2005"]');
await page.waitForSelector('#seasons-board-body [data-storm]', { timeout: 30_000 });
ok('a year row opens Season Details', await view() === 'seasons-board');

await shut();
await reopen();
ok('==> MINIMISING ON A YEAR AND REOPENING COMES BACK TO THAT YEAR <==',
  await view() === 'seasons-board');

await page.click('#seasons-board-body .seasons-open');
await page.waitForTimeout(600);
ok('a row chevron opens the storm', await view() === 'season-detail');

await shut();
await reopen();
ok('==> AND MINIMISING ON A STORM COMES BACK TO THAT STORM <==',
  await view() === 'season-detail');

/* The rungs below a restored storm are rebuilt rather than skipped, or Back
 * walks a reader out of the archive from a screen three deep. */
await page.click('.drawer-back');
await page.waitForTimeout(500);
ok('and Back from it still finds the year underneath', await view() === 'seasons-board');

await page.click('.drawer-back');
await page.waitForTimeout(500);
ok('and Back again finds the wall', await view() === 'seasons-wall');

await shut();
await reopen();
ok('==> AND MINIMISING ON THE WALL COMES BACK TO THE WALL, NOT TO 2005 <==',
  await view() === 'seasons-wall');

await browser.close();

console.log(`\nseasons-rung-check: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
