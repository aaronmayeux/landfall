#!/usr/bin/env node
/**
 * attrib-check.mjs — the credits pill's BOX, in a real browser (SPEC.md §9).
 *
 *   bash tools/with-server.sh node tools/attrib-check.mjs
 *
 * ==> WHY A BROWSER, AND WHY THIS PARTICULAR BUG NEEDED ONE. <== On 2026-08-20
 * the open pill was one unwrapped line about 1,100px wide on a 390px phone. It
 * ran off the right edge and passed BEHIND the storm pill and the control
 * cluster, so the credits were on screen and unreadable — the one thing this
 * control exists to prevent. Neither half of that is visible in a string of
 * markup: the width came from `white-space: nowrap` plus a measured label, and
 * the overlap came from a z-index chosen for the CLOSED state. Both are
 * questions only a layout engine can answer.
 *
 * ==> IT BUILDS ITS OWN PAGE, AND KEEPS NO FIXTURE ON DISK. <== The first cut
 * of this check was a committed `attrib-preview.html` carrying a copy of
 * index.html's tokens and rules. That is precisely the fixture this repo has
 * already been bitten by — see the note at the head of
 * tools/drawer-head-harness.html, whose tokens drifted from the app for two
 * commits under a comment asking them not to. So the page is assembled at run
 * time FROM index.html: the real `:root`, the real `#attrib-host` rules, and
 * the real module imported over the local server. Nothing here can drift,
 * because there is nothing here to drift from.
 *
 * The obstacles are stand-ins — a box where the storm pill sits and a stack
 * where the controls sit, at the z-indexes index.html gives them. That is
 * enough: the assertion is about stacking order, and a real storm pill would
 * add nothing but a network.
 *
 * ==> WHAT IT CANNOT PROVE. <== Whether five lines of grey credits over a lit
 * globe are legible, or whether the italic "i" reads as a letter at 20px.
 * Those are glass, and they stay Aaron's. tools/attrib-glyph-preview.html is
 * where the glyph gets looked at.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

/* --- the page, assembled from the app ------------------------------------ */

const html = readFileSync('index.html', 'utf8');

/** Cut a run of CSS out of index.html, from a selector to a sentinel. Thin on
 *  purpose: if the stylesheet is rearranged this throws rather than silently
 *  testing an empty ruleset, which is the failure mode that matters. */
const slice = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`attrib-check: cannot find "${from}" .. "${to}" in index.html`);
  return html.slice(a, b);
};

const tokens = slice(':root {', '\n}\n') + '\n}\n';
const pillCss = slice('#attrib-host .attrib {', '/* --- Status strip');
const hostCss = slice('#attrib-host {', '/* --- Map controls');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
${tokens}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--ocean, #0B111A);
  font-family: system-ui, sans-serif; }
/* Stand-ins for the two surfaces the open pill was disappearing behind, at
 * the z-indexes index.html gives them. */
#storm-pill { position: fixed; left: 50%; transform: translateX(-50%);
  bottom: var(--safe-bottom); z-index: 40; padding: 10px 18px; }
#controls { position: fixed; right: var(--safe-right); bottom: var(--safe-bottom);
  z-index: 40; width: 44px; height: 200px; }
${pillCss}
${hostCss}
</style></head><body>
<div id="storm-pill">3 active storms</div><div id="controls"></div>
<div id="attrib-host"></div>
<script type="module">
  import { createAttribution } from '/map/attribution.js';
  window.__attrib = createAttribution(document.getElementById('attrib-host'));
</script></body></html>`;

/* --- run ------------------------------------------------------------------ */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
await page.route('http://127.0.0.1:8099/__attrib-check__', (r) =>
  r.fulfill({ contentType: 'text/html', body: PAGE }));
await page.goto('http://127.0.0.1:8099/__attrib-check__');
await page.waitForFunction(() => Boolean(window.__attrib));

const read = () => page.$eval('.attrib', (el) => {
  const r = el.getBoundingClientRect();
  const host = document.getElementById('attrib-host');
  const label = el.querySelector('.attrib-label');
  const lh = parseFloat(getComputedStyle(label).lineHeight) || 1;
  return {
    w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    expanded: el.getAttribute('aria-expanded'),
    hostOpen: host.dataset.open,
    hostZ: Number(getComputedStyle(host).zIndex),
    lines: Math.round(label.getBoundingClientRect().height / lh),
    tabbable: [...el.querySelectorAll('a')].every((a) => a.tabIndex === 0),
    untabbable: [...el.querySelectorAll('a')].every((a) => a.tabIndex === -1),
    inert: label.inert,
    credits: el.querySelectorAll('a').length,
    /* The 44px target lives on the icon, and `overflow` on an ancestor would
     * clip hit-testing as well as painting — the scar SPEC.md §9 records. */
    hitW: el.querySelector('.attrib-icon').getBoundingClientRect().width,
  };
});

const open = async () => {
  await page.evaluate(() => document.querySelector('.attrib-icon').parentElement.click());
  await page.waitForTimeout(450);
};
const close = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
};

/* --- closed: a true circle, inert, and OUT of the way -------------------- */

const shut = await read();
ok(Math.abs(shut.w - shut.h) < 0.5,
   `closed, it is a true circle (${shut.w.toFixed(1)} x ${shut.h.toFixed(1)})`);
ok(shut.expanded === 'false' && shut.hostOpen === 'false',
   'and it ships closed, with the host flag saying so rather than absent');
ok(shut.hostZ === 20,
   `and sits BELOW the drawer at z-index 20 (got ${shut.hostZ}) — closed, a ` +
   `licensing credit does not outrank a storm warning`);
ok(shut.untabbable && shut.inert,
   'and its credit links are inert and out of the tab order, not merely invisible');

/* --- open: wrapped, on screen, and ON TOP -------------------------------- */

await open();
const wide = await read();
ok(wide.expanded === 'true' && wide.hostOpen === 'true', 'a tap opens it');
ok(wide.credits > 8, `with every credit in it (${wide.credits} links)`);
ok(wide.tabbable && !wide.inert, 'and the links become reachable when they are visible');

/* THE BUG, STATED AS A NUMBER. */
ok(wide.lines > 1, `the credits WRAP rather than running off in one line (${wide.lines} lines)`);
ok(wide.right <= 390 - 12 + 0.5,
   `and the pill's right edge stays inside the safe area (${wide.right.toFixed(1)} of 378)`);
ok(wide.left >= 12 - 0.5, `with its left edge still on the inset (${wide.left.toFixed(1)})`);
ok(wide.bottom <= 700 - 20 + 0.5,
   `it grows UPWARD from its pinned bottom edge, never down into the OS ` +
   `gesture zone (bottom ${wide.bottom.toFixed(1)} of 680)`);
ok(wide.top > 0, 'and not off the top either');
ok(wide.hostZ === 60,
   `and OPEN it outranks the drawer (30) and the controls (40) at z-index ` +
   `${wide.hostZ} — credits nobody can read are the bug this control exists to prevent`);

/* --- the keyboard path, all of it ---------------------------------------- */

await close();
const afterEsc = await read();
ok(afterEsc.expanded === 'false' && afterEsc.hostZ === 20,
   'Escape closes it and drops the stacking flag with it');
ok(await page.evaluate(() => document.activeElement?.classList.contains('attrib')),
   'and hands focus back to the pill rather than losing it to the body');

/* A real pointer event first, so the document genuinely has input focus —
 * `keyboard.press` on a page that has never been clicked goes nowhere, and a
 * keyboard assertion that silently tests nothing is worse than none. The
 * click lands on empty background, which is also the dismiss gesture, so it
 * leaves the pill shut. */
await page.mouse.click(200, 120);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Tab');
ok(await page.evaluate(() => document.activeElement?.classList.contains('attrib')),
   'Tab reaches the pill — and the page really had input focus, without which ' +
   'every keyboard assertion below would pass by testing nothing');
await page.keyboard.press('Enter');
await page.waitForTimeout(450);
ok((await read()).expanded === 'true',
   'and Tab then Enter opens it — every action has a keyboard path (§Input)');

/* --- rotation: the cap is a vw expression, so the wrap count moves -------- */

const beforeRotate = await read();
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(450);
const rotated = await read();
ok(rotated.lines < beforeRotate.lines,
   `rotating to landscape re-wraps to fewer lines ` +
   `(${beforeRotate.lines} -> ${rotated.lines})`);
ok(rotated.h < beforeRotate.h - 1,
   `and the open pill re-measures instead of holding a stale box ` +
   `(${beforeRotate.h.toFixed(0)}px -> ${rotated.h.toFixed(0)}px tall)`);
ok(rotated.right <= 844 - 12 + 0.5,
   `still inside the safe area at the new width (${rotated.right.toFixed(1)} of 832)`);
ok(rotated.bottom <= 390 - 20 + 0.5,
   `and still clear of the bottom (${rotated.bottom.toFixed(1)} of 370)`);

/* --- the touch target ---------------------------------------------------- */

const target = await page.$eval('.attrib-icon', (el) => {
  const after = getComputedStyle(el, '::after');
  return { w: parseFloat(after.width), h: parseFloat(after.height) };
});
ok(target.w >= 44 && target.h >= 44,
   `the finger target is at least 44px (${target.w} x ${target.h})`);

await browser.close();

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed\n`
    : `\n  ${pass} passed\n  ok    the credits wrap, stay on screen, and open on top\n`
);
process.exit(failures.length ? 1 : 0);
