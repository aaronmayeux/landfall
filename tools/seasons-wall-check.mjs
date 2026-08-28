/**
 * seasons-wall-check.mjs — the Wall of Years' filters and sort, in a real
 * browser. SPEC-SEASONS-BUILD.md §57.36, §57.30 step 3.
 *
 * ==> IT EXISTS BECAUSE THE NODE SUITES CANNOT SEE THIS CLASS OF FAULT. <==
 * They drive views against `tools/markup-dom.mjs`, which has no layout, no
 * `<details>`, no `<select>`, no focus and no computed style. All three faults
 * that reached Aaron's phone during step 14 lived in exactly that seam and
 * every node suite stayed green through all of them. Step 3 puts considerably
 * more state on this screen than step 14 did, so the check was written
 * alongside the code rather than after it.
 *
 * WHAT IT IS FOR, specifically — the things only a real browser can answer:
 *
 *   1. A chip tap actually narrows the rows on screen, rather than the state
 *      changing while the markup stays put.
 *   2. The `More filters` disclosure survives a chip tap. Every render
 *      replaces the markup, so a `<details>` whose open state was left to the
 *      DOM would slam shut under the reader's thumb.
 *   3. Focus survives a repaint. A slider that loses focus after one arrow key
 *      is unusable by keyboard and passes every markup assertion.
 *   4. The dots stay ONE SIZE when the figure column narrows the strip. The
 *      size is corrected after layout, so this is the one thing in the whole
 *      feature that cannot be checked without a layout engine.
 *
 * Needs a server on 8099 and a chromium:
 *   bash tools/with-server.sh node tools/seasons-wall-check.mjs
 */

import { chromium } from 'playwright';

let passed = 0;
const failures = [];
const ok = (what, cond) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failures.push(what); console.log(`  FAIL  ${what}`); }
};
const section = (t) => console.log(`\n${t}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' });

const rows = () => page.$$eval('#seasons-wall-body .wall .wall-row:not(.wall-row-live)', (e) => e.length);
const hairs = () => page.$$eval('#seasons-wall-body .wall .wall-hair', (e) => e.length);
const settle = () => page.waitForTimeout(250);

/* --- getting there ------------------------------------------------------- */

await page.waitForSelector('#btn-storms', { timeout: 20_000 });
await page.click('#btn-storms');
await page.waitForSelector('.seasons-door', { timeout: 20_000 });
await page.click('.seasons-door');
await page.waitForSelector('#seasons-wall-body .wall-row', { timeout: 30_000 });

section('1. The wall arrives unfiltered');

const all = await rows();
ok(`every season is a row to begin with (${all})`, all > 150);
ok('nothing is collapsed into a tail', await page.$('[data-tail]') === null);
ok('and no undercount line is showing yet', await page.$('.wall-honesty') === null);
ok('all seven chips are pressed',
  await page.$$eval('[data-chip]', (e) => e.every((c) => c.getAttribute('aria-pressed') === 'true')));

/* --- the landfall triangles ---------------------------------------------- */

section('1b. ==> THE LANDFALL MARK IS ON SCREEN, NOT MERELY IN THE DOM <==');
/* ==> COUNTING THE ELEMENTS IS EXACTLY THE CHECK THAT ALREADY PASSED OVER AN
 * INVISIBLE TRIANGLE. <== While step 14's mark was still a mockup, 732 of them
 * rendered into the DOM and none of them was visible: a `display: none` left
 * behind by a deleted toggle. The element count said everything was fine and
 * only the pixels disagreed. So this asks the layout engine for the drawn size
 * of the pseudo-element rather than asking the document whether it exists. */
const tri = await page.evaluate(() => {
  const dot = document.querySelector('.wall-strip i[data-lf]');
  if (!dot) return null;
  const s = getComputedStyle(dot, '::after');
  return {
    w: parseFloat(s.width),
    h: parseFloat(s.height),
    clipped: s.clipPath,
    shown: s.display !== 'none' && s.content !== 'none' && parseFloat(s.opacity) > 0,
  };
});
ok('a storm that came ashore carries a mark', tri !== null);
ok(`the mark has real size (${tri?.w} x ${tri?.h})`, tri && tri.w >= 3 && tri.h >= 2.5);
ok('and it is actually painted', Boolean(tri?.shown));
ok(`it is a triangle rather than a box (${tri?.clipped})`, /polygon/.test(tri?.clipped || ''));

/* ==> AND THE MARKS ARE THE ONES THE FILE ASKED FOR. <== The assertions above
 * prove a triangle is drawn; none of them would notice a triangle under EVERY
 * dot, which is the same screen saying something entirely different — that
 * every storm in 175 years came ashore. The count is read back out of
 * `seasons/wall.json` rather than written here, so a NOAA revision moves both
 * sides together instead of turning this red. */
const marks = await page.evaluate(async () => {
  const wall = await (await fetch('/seasons/wall.json')).json();
  const y2005 = wall.basins.atlantic.years['2005'];
  const row = document.querySelector('.wall-row[data-year="2005"]');
  return {
    wantAshore: y2005.filter((s) => s[1]).length,
    wantTotal: y2005.length,
    gotAshore: row?.querySelectorAll('.wall-strip i[data-lf]').length,
    gotTotal: row?.querySelectorAll('.wall-strip i').length,
  };
});
ok(`2005 draws ${marks.gotAshore} marks under ${marks.gotTotal} dots`,
  marks.gotAshore === marks.wantAshore && marks.gotTotal === marks.wantTotal);
ok('and they are some of the storms rather than all of them',
  marks.wantAshore > 0 && marks.wantAshore < marks.wantTotal);

/* ==> AND A ROW THAT CARRIES MARKS IS EXACTLY AS TALL AS ONE THAT DOES NOT.
 * <== The whole wall is a comparison between rows, so a year growing to fit
 * its own landfalls would break the comparison on the years most worth
 * comparing. The `::after` is out of flow to prevent that, and out-of-flow is
 * the kind of claim only a layout engine can settle. */
const heights = await page.evaluate(() => {
  const withMark = [...document.querySelectorAll('.wall-row')]
    .find((r) => r.querySelector('.wall-strip i[data-lf]'));
  const without = [...document.querySelectorAll('.wall-row')]
    .find((r) => r.querySelector('.wall-strip i') && !r.querySelector('.wall-strip i[data-lf]'));
  return [withMark?.getBoundingClientRect().height, without?.getBoundingClientRect().height];
});
ok(`marks do not make a row taller (${heights.join(' vs ')})`,
  heights[0] && heights[1] && Math.abs(heights[0] - heights[1]) < 0.5);

/* --- the chips ----------------------------------------------------------- */

section('2. ==> A CHIP TAP NARROWS WHAT IS ON SCREEN <==');

/* Leave only Category 5. Index 6 — `lib/category.js` grades 0 = TD, 1 = TS,
 * 2..6 = Cat 1..5, and reading `6` as "Category 6" is the easiest mistake to
 * make against this data. */
for (const c of [0, 1, 2, 3, 4, 5]) {
  await page.click(`[data-chip="${c}"]`);
  await settle();
}

const cat5Rows = await rows();
const cat5Hairs = await hairs();
ok(`33 seasons keep a strip and 142 go to hairlines (${cat5Rows}, ${cat5Hairs})`,
  cat5Rows === 33 && cat5Hairs === 142);
ok('the empty years keep their place, because year order is a timeline',
  await page.$('[data-tail]') === null);
ok('==> AND THE UNDERCOUNT LINE APPEARS <==', await page.$('.wall-honesty') !== null);
ok('carrying the real numbers rather than a vague warning',
  /13 .*115 seasons/s.test(await page.textContent('.wall-honesty')));

ok('the count column now shows both figures',
  await page.$$eval('.wall-row:not(.wall-row-live) .wall-count small',
    (e) => e.length > 0 && /of \d+/.test(e[0].textContent)));

/* ==> AND `2 of 13` IS ONE LINE, NOT TWO. <== Aaron on glass. The column was
 * sized for a bare count, so the ratio wrapped inside a 44px row and read as
 * two separate numbers stacked. Only a layout engine can see this. */
/* A Range over the contents reports one client rect per line box, which is the
 * only reliable way to count them — `lineHeight` computes to the string
 * `normal` here, and dividing by that gives NaN, which compares false against
 * everything and would have made this assertion permanently red. */
const ratioLines = await page.$$eval('.wall-row[data-ratio] .wall-count', (els) => els
  .slice(0, 20)
  .map((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    /* Count DISTINCT TOPS, not rects. A range spanning `2` and a nested
     * `<small> of 13</small>` yields one rect per text run even when both sit
     * on the same line, so counting rects reports two lines for a perfectly
     * good one-liner. Runs that share a top share a line. */
    return new Set([...r.getClientRects()].map((b) => Math.round(b.top))).size;
  }));
ok(`every ratio fits on one line (${[...new Set(ratioLines)].join(', ')})`,
  ratioLines.length > 0 && ratioLines.every((n) => n === 1));

section('3. ==> AND THE LAST CHIP CANNOT BE UNTICKED <==');
/* Zero chips is a blank wall, which looks exactly like a wall that failed to
 * load — and the reader's own last tap is the least likely explanation they
 * will reach for. */
await page.click('[data-chip="6"]');
await settle();
ok('unticking the only remaining chip is refused',
  await page.getAttribute('[data-chip="6"]', 'aria-pressed') === 'true');
ok('and the wall is not blank', await rows() === cat5Rows);

/* --- the sort ------------------------------------------------------------ */

section('4. Sorting off the timeline collapses the empty rows and shows the figure');

await page.click('[data-sort="count"]');
await settle();

const firstYear = await page.getAttribute('#seasons-wall-body .wall .wall-row:not(.wall-row-live)', 'data-year');
ok(`most Category 5s first puts 2005 at the top (${firstYear})`, firstYear === '2005');
ok('==> THE 142 EMPTY ROWS COLLAPSE INTO ONE LINE <==', await page.$('[data-tail]') !== null);
ok('which names what it is hiding rather than saying "none"',
  /142 seasons had no Category 5/.test(await page.textContent('[data-tail] summary')));
ok('and they are collapsed, never deleted',
  await page.$$eval('[data-tail] .wall-hair', (e) => e.length) === 142);
ok('no figure column for a count sort — the count is already drawn',
  await page.$('.wall-row[data-figure]') === null);
ok('and the selected key carries an arrow, the only sign direction exists',
  await page.$('[data-sort="count"][aria-pressed="true"] .wall-sort-arrow') !== null);

/* ==> PRESSING THE SELECTED KEY AGAIN REVERSES IT. <== The hidden half of
 * this control, and the reason the arrow has to be on screen. */
await page.click('[data-sort="count"]');
await settle();
const fewest = await page.getAttribute('#seasons-wall-body .wall .wall-row:not(.wall-row-live)', 'data-year');
ok(`a second press flips to fewest first (${fewest})`, fewest !== '2005');
ok('and the arrow turns over',
  (await page.textContent('[data-sort="count"]')).includes('↑'));

await page.click('[data-sort="ace"]');
await settle();
ok('while pressing a DIFFERENT key starts it largest-first again',
  (await page.textContent('[data-sort="ace"]')).includes('↓'));
ok('==> SORTING BY ACE PUTS THE ACE ON SCREEN <==',
  await page.$('.wall-row[data-figure] .wall-figure') !== null);

section('5. ==> AND EVERY DOT IS STILL ONE SIZE WHEN THE STRIP NARROWS <==');
/* The figure column borrows about 2.6em from the strip and the dot size is
 * corrected AFTER layout, so this is the assertion that cannot exist without
 * a layout engine. Two sizes on one screen is the one thing a wall drawn to a
 * single scale must never show. */
const sizes = await page.evaluate(() => [...new Set(
  [...document.querySelectorAll('.wall-strip i')].slice(0, 500)
    .map((el) => getComputedStyle(el).width),
)]);
ok(`one dot size across the whole screen (${sizes.join(', ')})`, sizes.length === 1);

await page.click('[data-sort="year"]');
await settle();
ok('back in year order the tail is gone again', await page.$('[data-tail]') === null);
ok('and so is the figure column', await page.$('.wall-row[data-figure]') === null);

/* --- the disclosure and focus -------------------------------------------- */

section('6. ==> THE DISCLOSURE SURVIVES A REPAINT, AND SO DOES FOCUS <==');

await page.click('[data-more] > summary');
await settle();
ok('More filters opens', await page.$eval('[data-more]', (d) => d.open));

await page.click('[data-chip="5"]');
await settle();
ok('==> AND A CHIP TAP DOES NOT SLAM IT SHUT <==', await page.$eval('[data-more]', (d) => d.open));
ok('and the tapped chip keeps focus, so a keyboard reader is not dropped',
  await page.evaluate(() => document.activeElement?.dataset?.chip === '5'));

section('7. A threshold slider narrows as it moves, and keeps the keyboard');

await page.focus('[data-threshold="days"]');
const before = await rows();
for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
await settle();
ok(`arrowing the duration slider narrows the wall (${before} then ${await rows()})`,
  await rows() < before);
ok('==> AND THE SLIDER STILL HAS FOCUS AFTER TWELVE REPAINTS <==',
  await page.evaluate(() => document.activeElement?.dataset?.threshold === 'days'));
ok('its label says what it is filtering on, not a bare number',
  /day/.test(await page.textContent('.slider-row .slider-value')));

/* --- the whole thing by keyboard ----------------------------------------- */

section('8. Every control is reachable with the mouse untouched');

/* ==> `dataset.landfall` ON `data-landfall` IS THE EMPTY STRING, WHICH IS
 * FALSY. <== This check reported the sort control and the landfall toggle as
 * unreachable by keyboard on its first run, and both were perfectly reachable
 * — the bug was here, counting valueless data attributes as absent. Worth the
 * comment because a check that cries wolf about accessibility is a check that
 * gets its failures waved through. Test by ATTRIBUTE, not by dataset value. */
const reachable = await page.evaluate(() => {
  const sel = '#seasons-wall-body button, #seasons-wall-body select,'
    + ' #seasons-wall-body input, #seasons-wall-body summary';
  const all = [...document.querySelectorAll(sel)];
  const tabbable = all.filter((el) => el.tabIndex >= 0 && !el.disabled);
  const count = (attr) => tabbable.filter((el) => el.hasAttribute(attr)).length;
  return {
    chips: count('data-chip'),
    sort: count('data-sort'),
    landfall: count('data-landfall'),
    thresholds: count('data-threshold'),
    /* ==> A ROVING TAB STOP IS CORRECT, NOT A FAULT. <== The basin control is
     * a radiogroup: exactly one segment takes a tab stop and the arrow keys
     * move between them, which is what a radiogroup owes its reader. Counting
     * its unselected segment as unreachable is this check misreading a
     * pattern the app got right. Only elements OUTSIDE a radiogroup have to
     * be individually tabbable. */
    untabbable: all.filter((el) => (el.tabIndex < 0 || el.disabled)
      && !el.closest('[role="radiogroup"]'))
      .map((el) => el.className || el.tagName),
  };
});
ok(`all seven chips take a tab stop (${reachable.chips})`, reachable.chips === 7);
ok(`all five sort keys do too (${reachable.sort})`, reachable.sort === 5);
ok('so does the landfall toggle', reachable.landfall === 1);
ok(`and all three thresholds (${reachable.thresholds})`, reachable.thresholds === 3);
ok(`nothing in the block is unreachable (${reachable.untabbable.join(', ') || 'none'})`,
  reachable.untabbable.length === 0);

/* ==> A VISIBLE FOCUS RING ON EVERY ONE OF THEM. <== §13 — `outline: none`
 * with no replacement makes a keyboard pass impossible to follow, and it is
 * invisible to every assertion that does not compute style. */
const rings = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-chip], [data-sort], [data-landfall], [data-threshold]')) {
    el.focus();
    const s = getComputedStyle(el);
    out.push(s.outlineStyle !== 'none' || s.boxShadow !== 'none');
  }
  return out;
});
ok(`every control shows a focus ring (${rings.filter(Boolean).length} of ${rings.length})`,
  rings.length > 0 && rings.every(Boolean));

/* --- the pinned row ------------------------------------------------------ */

section('9. The season in progress obeys the same filter as the wall under it');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#btn-storms', { timeout: 20_000 });
await page.click('#btn-storms');
await page.waitForSelector('.seasons-door', { timeout: 20_000 });
await page.click('.seasons-door');
await page.waitForSelector('#seasons-wall-body .wall-row-live', { timeout: 30_000 });

const liveDotsBefore = await page.$$eval('.wall-row-live .wall-strip i', (e) => e.length);
for (const c of [0, 1, 2, 3, 4, 5]) {
  await page.click(`[data-chip="${c}"]`);
  await settle();
}
const liveDotsAfter = await page.$$eval('.wall-row-live .wall-strip i', (e) => e.length);
ok(`the pinned row narrows too (${liveDotsBefore} then ${liveDotsAfter})`,
  liveDotsAfter <= liveDotsBefore);

/* --- and it still opens a year ------------------------------------------- */

section('10. A filtered wall still opens the year you tap');

await page.click('#seasons-wall-body .wall .wall-row:not(.wall-row-live)');
await page.waitForSelector('#seasons-board-body', { timeout: 30_000 });
ok('tapping a surviving row opens Season Details',
  await page.getAttribute('#drawer', 'data-view') === 'seasons-board');

await page.click('.drawer-back');
await settle();
ok('and Back finds the wall still narrowed to Category 5',
  await page.getAttribute('[data-chip="6"]', 'aria-pressed') === 'true'
  && await page.getAttribute('[data-chip="0"]', 'aria-pressed') === 'false');

await browser.close();

console.log(`\nseasons-wall-check: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
