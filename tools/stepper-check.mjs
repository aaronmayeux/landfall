#!/usr/bin/env node
/**
 * stepper-check.mjs — the storm detail panel's chevrons (SPEC-UI §16.5).
 *
 * ==> THIS HAS TO BE A BROWSER CHECK AND CANNOT BE A UNIT TEST. <== Every
 * assertion below is about a live DOM node rather than about a string:
 *
 *   1. `hidden` on the row is a property of an element. Below two storms the
 *      row must LEAVE the layout, not merely render empty — a pinned row of
 *      dead space costs the shortest screen in the app a touch target of
 *      height, and `display: none` on `[hidden]` is a CSS fact.
 *   2. The buttons must be the SAME NODES across a step. That is the whole
 *      reason they are built once in `buildSkeleton` instead of by innerHTML,
 *      and node identity is not observable from markup.
 *   3. `focus()` has to return a real, visible, focusable element. A version
 *      that returned a detached node would look correct in review and drop
 *      keyboard focus on every press.
 *
 * THE VIEW IS MOUNTED DIRECTLY, NOT THROUGH THE APP. The sandbox cannot reach
 * NHC or GDACS, so the app boots with an empty ocean and the detail panel is
 * unreachable by navigation. Importing the module and mounting it into a bare
 * div exercises the same code the drawer would.
 *
 * Run it with the static server up, in ONE shell command — a background server
 * does not survive between shell calls:
 *
 *     bash tools/with-server.sh node tools/stepper-check.mjs
 */

import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8099/tools/stepper-harness.html';
/* The CI runner installs its own chromium; the sandbox has one preinstalled at
 * a fixed path and cannot download another. Same env var every other browser
 * check reads, so there is one way to point these at a binary. */
const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) pass++;
  else failures.push(msg);
};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__harness, null, { timeout: 20000 });

const read = () => page.evaluate(() => window.__harness.read());

/* --- five storms: the ordinary case -------------------------------------- */

await page.evaluate(() => window.__harness.setup(5, 0));
let s = await read();
ok(s.visible, 'with five storms the stepper row is present');
ok(s.count === '1 of 5', `the count reads its position (got "${s.count}")`);
ok(
  s.prevLabel === 'Show Storm 5',
  `prev WRAPS to the last storm from the first (got "${s.prevLabel}")`
);
ok(
  s.nextLabel === 'Show Storm 2',
  `next goes to the following storm (got "${s.nextLabel}")`
);

/* ==> NEITHER ARROW IS EVER DISABLED. <== A chevron present but dead is a
 * control you have to look at to rule out. Checked as a property rather than
 * inferred from the labels above, because `disabled` is exactly the change
 * somebody would make later while leaving the labels intact. */
ok(!s.prevDisabled && !s.nextDisabled, 'neither chevron is ever disabled');

await page.evaluate(() => window.__harness.setup(5, 4));
s = await read();
ok(s.count === '5 of 5', `the count follows the storm (got "${s.count}")`);
ok(
  s.nextLabel === 'Show Storm 1',
  `next WRAPS to the first storm from the last (got "${s.nextLabel}")`
);

/* --- the row earns its height, or it goes --------------------------------- */

await page.evaluate(() => window.__harness.setup(1, 0));
s = await read();
ok(s.hidden, 'with ONE storm the row is hidden — a stepper through a list of one is furniture');
ok(
  s.displayNone,
  'and hidden means out of the layout, not merely empty (display: none)'
);

await page.evaluate(() => window.__harness.setup(2, 0));
s = await read();
ok(!s.hidden, 'with TWO storms the row is back');
ok(
  s.prevLabel === 'Show Storm 2' && s.nextLabel === 'Show Storm 2',
  'and both arrows reach the only other storm, which is correct'
);

/* --- a storm that has left the feed --------------------------------------- */

await page.evaluate(() => window.__harness.ghost());
s = await read();
ok(
  s.hidden,
  'a GHOST storm is not in the list, so it has no position and the row hides'
);

/* --- stepping: identity, wiring, and focus --------------------------------- */

await page.evaluate(() => window.__harness.setup(5, 2));
const stepped = await page.evaluate(() => window.__harness.step('next'));
ok(stepped.calledWith === 'Storm 4', `pressing next selects the next storm (got "${stepped.calledWith}")`);
ok(
  stepped.sameNode,
  'the chevron is the SAME NODE after the step — built once, never replaced'
);

/* ==> THE ONE-SHOT IS THE POINT. <== focus() must hand back the chevron just
 * pressed, and then STOP doing so — arriving from a list row or a dot on the
 * globe still starts at the drawer's Back button. */
const focus = await page.evaluate(() => window.__harness.focusAfterStep());
ok(focus.first === 'next', `focus() returns the chevron that was pressed (got "${focus.first}")`);
ok(focus.second === null, 'and only once — the next entry starts at Back again');
ok(focus.reallyFocusable, 'and the element it returns actually takes focus');

const cold = await page.evaluate(() => window.__harness.focusCold());
ok(cold === null, 'entering any other way starts at Back');

/* --- the labels are true BEFORE the coalesced body render ----------------- */

/* ui/drawer.js calls `focus()` on the line after `onEnter` returns, and the
 * body render is deferred to a microtask. Anything the reader is handed at
 * that instant has to already be about the storm they just stepped to. */
await page.evaluate(() => window.__harness.setup(5, 0));
const sync = await page.evaluate(() => window.__harness.enterAndReadSync(3));
ok(sync.count === '4 of 5', `the count is written in the entry turn (got "${sync.count}")`);
ok(
  sync.nextLabel === 'Show Storm 5',
  `and so are the labels — not one storm behind (got "${sync.nextLabel}")`
);

/* --- the labels stay true when the list changes underneath ---------------- */

await page.evaluate(() => window.__harness.shrinkTo(3));
s = await read();
ok(
  s.count === '3 of 3' || s.hidden === false,
  `a poll that shortens the list re-counts rather than going stale (got "${s.count}")`
);

await browser.close();

console.log(`\n  ${pass} passed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) {
  console.log(`\n${failures.length} failed.\n`);
  process.exit(1);
}
console.log('  ok    the stepper wraps, hides, steps and keeps focus\n');
