#!/usr/bin/env node
/**
 * drawer-head-check.mjs — the drawer header and the stepper below it
 * (SPEC-UI §16.5).
 *
 * ==> EVERY ASSERTION HERE IS A PIXEL FACT, WHICH IS WHY IT CANNOT BE A UNIT
 * TEST. <== Three of them in particular:
 *
 *   1. THE TITLE IS CENTRED, AND STAYS CENTRED. The header is
 *      `minmax(0,1fr) auto minmax(0,1fr)` precisely so the middle column lands
 *      on the true centre no matter how wide the lead slot's text is. "Back to
 *      Storms" and "Home" are very different widths. A version that centred
 *      only when the two sides happened to match would look right in one view
 *      and wrong in the other, which is exactly the bug the header already had
 *      once — grid columns are positional, and a hidden back button used to
 *      shift the close button into the wrong column.
 *
 *   2. THE CHEVRONS ARE CLEAR OF THE CHROME. This is the whole reason for the
 *      pass. Under the old layout the stepper's arrows sat at the panel's two
 *      outer edges, which put prev directly below Back and next directly below
 *      Close — same glyph, same size, one row apart, and a mis-aimed step
 *      dismissed the panel. "Clustered in the middle" is only true if the
 *      numbers say so.
 *
 *   3. THE TOUCH TARGETS SURVIVED THE MOVE. Pulling controls inward is exactly
 *      the change that quietly shrinks them (§17: 44px, not negotiable).
 *
 * Run it with the static server up, in ONE shell command — a background server
 * does not survive between shell calls:
 *
 *     bash tools/with-server.sh node tools/drawer-head-check.mjs
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* This module binds `URL` to the harness's address, so the global constructor
 * is not reachable here — the paths below are built with `path` instead. */
const HERE = dirname(fileURLToPath(import.meta.url));

const URL = 'http://127.0.0.1:8099/tools/drawer-head-harness.html';
const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/** How far apart two controls have to be before a thumb stops confusing them.
 *  A fingertip contact patch is about 40px across, so anything under one full
 *  touch target is not separation at all. Two of them is the bar. */
const CLEAR_PX = 88;

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) pass++;
  else failures.push(msg);
};

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));

/* ==> BEFORE MEASURING ANYTHING, CHECK THE RULER. <== Every number below is a
 * distance expressed in the design tokens, so a token that drifts between the
 * fixture and index.html turns the whole file into a precise measurement of a
 * different app — and one that still passes, because thresholds are generous
 * enough to absorb a few pixels. That is exactly what happened: the fixture ran
 * for two commits on 6/10/14/20 spacing against the app's 4/8/12/16, and the
 * offsets it reported were about 20% larger than the ones on glass.
 *
 * Only the tokens the fixture actually declares are compared. It is free to
 * declare fixture-only ones the app has no opinion about (zeroed animation
 * durations, zeroed safe-area insets) — those are listed as exempt rather than
 * silently skipped, so adding one is a deliberate act. */
const FIXTURE_ONLY = new Set([
  '--duration-base', '--duration-instant', '--ease-settle', '--ease-swap',
  '--safe-bottom', '--safe-top', '--keyboard-inset',
  /* The harness measures still frames on a plain background: a backdrop blur
   * costs time and changes nothing a rect reports, and the sheet needs an
   * opaque fill because there is no globe behind it here. */
  '--glass-blur', '--glass',
]);

const harnessSrc = readFileSync(join(HERE, 'drawer-head-harness.html'), 'utf8');
const appSrc = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const harnessRoot = harnessSrc.slice(harnessSrc.indexOf(':root'), harnessSrc.indexOf('body { margin'));
const declared = [...harnessRoot.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map(([, k, v]) => [k, v.trim()]);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const drifted = [];
for (const [key, val] of declared) {
  if (FIXTURE_ONLY.has(key)) continue;
  const m = appSrc.match(new RegExp(`${key}\\s*:\\s*([^;]+);`));
  if (!m) { drifted.push(`${key} is not in index.html at all`); continue; }
  if (norm(m[1]) !== norm(val)) drifted.push(`${key}: fixture ${norm(val)}, app ${norm(m[1])}`);
}
ok(
  drifted.length === 0,
  `the fixture's design tokens are the app's — every distance below is measured ` +
    `in these units (${drifted.join('; ') || 'all match'})`
);
ok(
  declared.length >= 15,
  `and it really did parse a token block, rather than an empty one that agrees ` +
    `with everything (${declared.length} tokens read)`
);

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__harness, null, { timeout: 20000 });

const read = () => page.evaluate(() => window.__harness.read());

/* --- a plain root view: no eyebrow, no back, title still centred ---------- */

await page.evaluate(() => window.__harness.go('storms'));
let s = await read();
ok(!s.backVisible, 'a root view has no back button');
ok(!s.eyebrowVisible, 'and a view titled with its own name shows no eyebrow — that would say it twice');
ok(
  Math.abs(s.titleOffCentre) < 1.5,
  `the title is centred with nothing in the lead slot (off by ${s.titleOffCentre?.toFixed(1)}px)`
);
ok(s.closeInset >= 0 && s.closeInset <= 12, `close is pinned to the trailing edge (inset ${s.closeInset}px)`);

/* --- the home shape: storm title, "Home" eyebrow, stepper ----------------- */

await page.evaluate(() => window.__harness.go('home'));
s = await read();
ok(s.eyebrowVisible && s.eyebrowText === 'Home', `the drawer names itself in the lead slot (got "${s.eyebrowText}")`);
ok(!s.backVisible, 'and the eyebrow only appears where there is no back button');
ok(
  Math.abs(s.titleOffCentre) < 1.5,
  `the storm name is centred despite the eyebrow beside it (off by ${s.titleOffCentre?.toFixed(1)}px)`
);
ok(s.stepperVisible, 'the stepper is pinned under the header');

/* ==> THE COMPLAINT, MEASURED. <== */
ok(
  s.backToPrev === null || s.backToPrev >= CLEAR_PX,
  `home has no back button, so nothing to confuse prev with (${s.backToPrev})`
);
ok(
  s.closeToNext >= CLEAR_PX,
  `next is clear of Close (${s.closeToNext?.toFixed(0)}px apart, bar is ${CLEAR_PX})`
);
ok(
  s.closeToNextX >= 44,
  `and the separation is HORIZONTAL, not just a vertical drop (${s.closeToNextX?.toFixed(0)}px across)`
);

/* --- the detail shape: labelled back, no eyebrow, stepper ----------------- */

await page.evaluate(() => window.__harness.push('detail'));
s = await read();
ok(s.backVisible, 'pushing a view gives it a back button');
ok(
  s.backText === 'Home',
  `and the button says where it goes, in words (got "${s.backText}")`
);
ok(
  s.backLabel === 'Back to Home',
  `the accessible name still names the destination too (got "${s.backLabel}")`
);
ok(!s.eyebrowVisible, 'the eyebrow steps aside for the back button — one answer to "where am I", not two');
ok(
  Math.abs(s.titleOffCentre) < 1.5,
  `the storm name is STILL centred with a wide labelled button beside it (off by ${s.titleOffCentre?.toFixed(1)}px)`
);

ok(
  s.backToPrev >= CLEAR_PX,
  `prev is clear of Back (${s.backToPrev?.toFixed(0)}px apart, bar is ${CLEAR_PX})`
);
console.log(`  note  Back→prev ${s.backToPrev?.toFixed(0)}px (${s.backToPrevX?.toFixed(0)} across), Close→next ${s.closeToNext?.toFixed(0)}px (${s.closeToNextX?.toFixed(0)} across)`);
ok(
  s.backToPrevX >= 44,
  `and horizontally, which the edge-pinned layout had none of (${s.backToPrevX?.toFixed(0)}px across)`
);
ok(
  s.closeToNext >= CLEAR_PX,
  `next is clear of Close (${s.closeToNext?.toFixed(0)}px apart)`
);

/* --- the two drawers sit the name at the SAME height ---------------------- */

/* ==> THE HEADER CENTRES ITS COLUMNS, SO THE SECOND LINE'S HEIGHT DECIDES
 * WHERE THE NAME LANDS. <== The detail panel's second line is plain text; the
 * dashboard's is a pill with padding and a border, ~11px taller. With the same
 * header padding on both, the name still sat visibly higher on the dashboard —
 * which is what Aaron reported as the padding not matching. `min-height` on the
 * second line makes the identity block a fixed height and this a comparison of
 * two equal numbers rather than two that happen to be close. */
await page.evaluate(() => window.__harness.go('home'));
const homeHead = await read();
await page.evaluate(() => window.__harness.go('detail'));
const detailHead = await read();

ok(
  Math.abs(homeHead.nameInset - detailHead.nameInset) < 1.5,
  `the name sits the same distance below the sheet's top edge on both drawers ` +
    `(home ${homeHead.nameInset?.toFixed(1)}px, detail ${detailHead.nameInset?.toFixed(1)}px)`
);
ok(
  Math.abs(homeHead.subH - detailHead.subH) < 1.5,
  `because the second line is a fixed height regardless of what is in it ` +
    `(pill ${homeHead.subH?.toFixed(1)}px, plain text ${detailHead.subH?.toFixed(1)}px)`
);
/* ==> THE ASYMMETRY IS THE CLAIM, AND 9px IS THE NUMBER. <== This used to read
 * `nameInset > 10`, which was invented against a fixture running 25% wider
 * spacing than the app: the real inset is 9px, not the 11 the commit that added
 * it recorded. A round number nobody can defend is not a better assertion than
 * the property it was standing in for, so the property is what is asserted —
 * the top of this header gives more than the bottom does, deliberately, because
 * above it is the sheet's rounded corner and below it is a stepper carrying its
 * own touch target of space. Whether 9px LOOKS like enough above the name is a
 * judgement on glass and no check can make it. */
console.log(`  note  header padding ${homeHead.headPadTop}px top / ${homeHead.headPadBottom}px bottom, name inset ${homeHead.nameInset?.toFixed(1)}px`);
ok(
  homeHead.headPadTop > homeHead.headPadBottom,
  `the header gives more room above the name than below it, on purpose ` +
    `(${homeHead.headPadTop}px top against ${homeHead.headPadBottom}px bottom)`
);
ok(
  homeHead.nameInset > homeHead.headPadBottom,
  `and the name clears the sheet's rounded corner by more than that tight edge ` +
    `(${homeHead.nameInset?.toFixed(1)}px)`
);

/* ==> THE SECOND LINE SITS UNDER THE NAME. <== Two separate faults put it
 * elsewhere, and the first version of this check could see neither.
 *
 * ONE: it compared the CENTRE OF `.drawer-identity-sub` against the CENTRE OF
 * `.drawer-identity-line`. Those are two full-width block boxes in the same
 * parent, so their centres are the same number by construction. It read 0.0px
 * with the chip sitting visibly off to the side. It is now the chip's own box
 * against the name's own box.
 *
 * TWO: it only ever ran with a chip WIDER than the storm name, which makes the
 * identity block chip-width and leaves no free space inside the second line.
 * `margin-left: auto` — inherited from `.home-chip`'s other home in the quiet
 * state's threat row — needs free space to do damage, so the pairing that
 * mattered was never tested. Behind a long name it took 260px.
 *
 * The target is the NAME, not the name and its dot. The dot is an adjective;
 * the reader takes the name as the title, and 11px of drift off it is what
 * Aaron saw on both drawers. */
const CENTRED_PX = 1.5;

/* ==> AND THE AXIS IS THE HEADER'S CENTRE, NOT THE NAME'S. <== The first cut of
 * this fix padded the SECOND line to chase the name where the dot had pushed
 * it. Both assertions below passed and the header was still visibly crooked on
 * glass: name and chip agreed with each other at 700 while the stepper one row
 * down, the panel's edges and every section below sat at 672 on a 1344px
 * screen — 9 CSS px, two touching rows. Aligning a pair to each other is not
 * aligning them to the page, and only this assertion can tell the difference. */
console.log(`  note  name off head centre: home ${homeHead.nameVsHead?.toFixed(1)}px, detail ${detailHead.nameVsHead?.toFixed(1)}px; stepper ${homeHead.stepperVsHead?.toFixed(1)}px`);
ok(
  Math.abs(homeHead.nameVsHead) < CENTRED_PX,
  `the storm's name sits on the header's own centre, dot notwithstanding ` +
    `(off by ${homeHead.nameVsHead?.toFixed(1)}px)`
);
ok(
  Math.abs(detailHead.nameVsHead) < CENTRED_PX,
  `on the detail panel too (off by ${detailHead.nameVsHead?.toFixed(1)}px)`
);
ok(
  Math.abs(homeHead.stepperVsHead) < CENTRED_PX,
  `— the same axis the stepper below it already used, which is what made the ` +
    `drift visible (stepper off by ${homeHead.stepperVsHead?.toFixed(1)}px)`
);

ok(
  Math.abs(homeHead.chipVsName) < CENTRED_PX,
  `the dashboard's chip is centred under the storm's name (off by ${homeHead.chipVsName?.toFixed(1)}px)`
);
ok(
  Math.abs(detailHead.subInkVsName) < CENTRED_PX,
  `and so is the detail panel's classification (off by ${detailHead.subInkVsName?.toFixed(1)}px)`
);

/* THE PAIRING THAT REPRODUCES THE BUG: a name wider than the chip, so the
 * second line has room in it for something to go wrong. */
await page.evaluate(() => window.__harness.go('home'));
await page.evaluate(() => window.__harness.useWideNameNarrowChip());
const wideName = await read();
console.log(`  note  chip off name: ${wideName.chipVsName?.toFixed(1)}px behind a name wider than the chip`);
ok(
  Math.abs(wideName.chipVsName) < CENTRED_PX,
  `and it stays centred when the name is WIDER than the chip, which is the ` +
    `arrangement a stray auto margin needs (off by ${wideName.chipVsName?.toFixed(1)}px)`
);
ok(
  wideName.lineW > 200,
  `— and that case really is the wide one, not a fixture that silently reverted ` +
    `(name line ${wideName.lineW?.toFixed(0)}px)`
);
await page.evaluate(() => window.__harness.useDefaultChip());
await page.evaluate(() => window.__harness.useShortName());

/* --- the dashboard is a fixed height, whatever storm is showing ----------- */

/* ==> STEPPING SHOULD MOVE THE MAP, NOT RESIZE THE FURNITURE. <== The near
 * layout carries a chart and a countdown that the far layout drops, so the
 * sheet used to jump shorter and taller as you flipped between a storm bearing
 * down and one in the mid-Atlantic. It also made the flyTo offset — measured
 * from this very height — depend on which storm you were coming from. */
await page.evaluate(() => window.__harness.go('home'));
await page.evaluate(() => window.__harness.useLongBody());
const tallSheet = (await read()).sheetH;
await page.evaluate(() => window.__harness.useShortBody());
const shortSheet = (await read()).sheetH;
ok(
  Math.abs(tallSheet - shortSheet) < 1,
  `the dashboard holds one height across a tall and a short layout (${tallSheet}px vs ${shortSheet}px)`
);
ok(tallSheet > 300, `and that height is the full sheet, not a collapsed one (${tallSheet}px)`);

/* A view WITHOUT the fixed height still sizes to its content, or the rule has
 * quietly been applied to everything — which would leave the first-run prompt
 * as three lines of text in 60vh of empty glass. */
await page.evaluate(() => window.__harness.go('storms'));
await page.evaluate(() => window.__harness.useShortBody());
const otherShort = (await read()).sheetH;
ok(
  otherShort < tallSheet,
  `and the rule is scoped to that one view (another view shrank to ${otherShort}px)`
);

/* --- an eyebrow view PUSHED onto something else --------------------------- */

/* ==> THE CASE THAT NEEDS BOTH TO BE TRUE AT ONCE. <== The detail panel does
 * not define an eyebrow, so pushing it proves only that an absent eyebrow stays
 * absent. The home dashboard DOES define one, so pushing it is the only way to
 * exercise the rule that the back button wins the lead slot — and without this
 * case a version that showed both would pass every other assertion here. */
await page.evaluate(() => window.__harness.go('storms'));
await page.evaluate(() => window.__harness.push('home'));
s = await read();
ok(s.backVisible && s.backText === 'Storms', `pushed home has a back button to the list (got "${s.backText}")`);
ok(
  !s.eyebrowVisible,
  'and its eyebrow yields to it — a view pushed onto something already says where it is'
);
ok(
  Math.abs(s.titleOffCentre) < 1.5,
  `the title stays centred there too (off by ${s.titleOffCentre?.toFixed(1)}px)`
);

await page.evaluate(() => window.__harness.go('detail'));
s = await read();

/* --- the targets survived being pulled inward ----------------------------- */

ok(
  s.prevW >= 44 && s.prevH >= 44 && s.nextW >= 44 && s.nextH >= 44,
  `both chevrons are still 44px square (${s.prevW}x${s.prevH}, ${s.nextW}x${s.nextH})`
);

/* --- a long name truncates rather than shoving the centre ----------------- */

const short = (await read()).titleOffCentre;
await page.evaluate(() => window.__harness.useLongName());
const long = await read();
ok(
  Math.abs(long.titleOffCentre) < 1.5,
  `a long storm name stays centred (off by ${long.titleOffCentre?.toFixed(1)}px)`
);
ok(
  long.headH <= short + 1000 && long.headH === (await read()).headH,
  'and does not change the header height'
);
ok(!long.backVisible, 'and the lead slot is unchanged by it');

await browser.close();

console.log(`\n  ${pass} passed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) {
  console.log(`\n${failures.length} failed.\n`);
  process.exit(1);
}
console.log('  ok    the header centres, the back button speaks, the chevrons are clear\n');
