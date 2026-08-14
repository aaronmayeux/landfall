#!/usr/bin/env node
/**
 * home-setup-check.mjs — the setup panel, in a real browser (SPEC-UI §8).
 *
 * ==> WHY A BROWSER AND NOT A NODE SUITE. <== Everything this rebuild changed
 * is DOM behaviour: what has focus on arrival, whether a block is hidden,
 * whether three controls resolve to the same computed style, whether
 * `aria-expanded` tracks the thing it claims to control. None of that exists
 * outside a document, and asserting it against a string of HTML would be
 * asserting that the string is the string.
 *
 * IT MOUNTS THE VIEW ALONE, with no map and no network. Every callback the
 * view takes is injected, so `probeWater` and the camera are stubs and nothing
 * here needs `tiles.openfreemap.org` — which the sandbox cannot reach anyway.
 * The reverse lookup is never triggered because nothing is picked.
 *
 * ==> WHAT IT CANNOT PROVE, STATED SO NOBODY OVER-TRUSTS A GREEN RUN. <== That
 * the three rows LOOK like peers. Identical computed background, border and
 * min-height is necessary and nowhere near sufficient — whether the screen
 * reads as three equal doors is glass, on a phone, and stays Aaron's.
 *
 *   bash tools/with-server.sh node tools/home-setup-check.mjs
 */

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8099';

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };
const eq = (got, want, msg) =>
  ok(got === want, `${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

/* ==> LET PLAYWRIGHT FIND ITS OWN BROWSER. <== The first cut of this file
 * hard-coded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, which is the
 * SANDBOX's chromium and exists nowhere else. It passed here and failed on the
 * CI runner on the first push, where `npx playwright install` puts the browser
 * somewhere else entirely. `PLAYWRIGHT_BROWSERS_PATH` is what makes the
 * sandbox's copy findable without naming it, and every sibling check in this
 * directory already uses the override below — see csp-check, home-figs-check,
 * offline-check. Do not reintroduce a literal path. */
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/* A bare document that loads the app's stylesheets and mounts ONLY this view.
 * Nothing else boots — no map, no globe, no polling. */
await page.route('**/harness.html', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>
      <link rel="stylesheet" href="/ui/panels.css">
      <link rel="stylesheet" href="/ui/home.css">
    </head><body><div id="host"></div></body></html>`,
  })
);

await page.goto(`${BASE}/harness.html`);

/* index.html sets the design tokens on :root from config/tokens.js. The
 * harness has no index.html, so do the same thing here — without it every
 * `var(--space-base)` resolves to nothing and the computed-style assertions
 * below would compare empty strings and "pass" meaninglessly. */
/* THE TOKENS COME FROM index.html's OWN :root BLOCK, lifted verbatim. Without
 * them every `var(--space-base)` resolves to nothing and the computed-style
 * comparisons below would compare empty strings to empty strings and "pass"
 * while proving nothing — the exact self-consistent fiction §12's test rule
 * warns about. Lifting the real block rather than retyping values is why this
 * cannot drift from the app the way a hand-written fixture would. */
const rootCss = await page.evaluate(async (base) => {
  const html = await (await fetch(base + '/index.html')).text();
  const m = html.match(/:root\s*\{[\s\S]*?\n\}/);
  return m ? m[0] : null;
}, BASE);

ok(Boolean(rootCss), 'the token block was found in index.html — without it every '
   + 'computed-style assertion below would be vacuous');
if (rootCss) await page.addStyleTag({ content: rootCss });

/* Every callback stubbed: no map, no camera, no network. `probeWater` answers
 * `unknown`, which is a handled state, and nothing here ever picks a result so
 * the reverse lookup is never reached. */
const MOUNT = `
  import { createHomeSetupView } from '${BASE}/ui/view-home-setup.js';
  const view = createHomeSetupView({
    onPreview() {}, getProvisional: () => null, onCancelPreview() {},
    onCommit() {}, onDone() {}, getViewCenter: () => ({ lon: -90, lat: 29 }),
    probeWater: async () => 'unknown',
  });
  view.mount(document.getElementById('host'));
  view.onEnter();
  window.__view = view;
  window.__ready = true;
`;

await page.evaluate(() => localStorage.clear());
await page.addScriptTag({ type: 'module', content: MOUNT });

await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });

/* ------------------------------------------------- 1. three peers, one recipe */

const choices = await page.$$('.home-choice');
eq(choices.length, 3, 'three choices are on screen');

const styles = await page.$$eval('.home-choice', (els) =>
  els.map((e) => {
    const s = getComputedStyle(e);
    return {
      choice: e.dataset.choice,
      background: s.backgroundColor,
      border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
      radius: s.borderTopLeftRadius,
      minHeight: s.minHeight,
      height: Math.round(e.getBoundingClientRect().height),
    };
  })
);

const [a, b, c] = styles;
ok(a.background === b.background && b.background === c.background,
   `all three share one background — got ${styles.map((s) => `${s.choice}:${s.background}`).join(', ')}`);
ok(a.border === b.border && b.border === c.border,
   `all three share one border — got ${styles.map((s) => `${s.choice}:${s.border}`).join(', ')}`);
ok(a.radius === b.radius && b.radius === c.radius, 'all three share one corner radius');

/* THE REGRESSION THIS EXISTS FOR: drop-a-pin was `background: transparent`
 * while the other two were filled. If anybody makes one of these "quieter"
 * again, this is the line that goes red. */
ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(a.background),
   `the shared fill is a real colour, not transparent — got ${a.background}`);

for (const s of styles) {
  ok(s.height >= 44, `the ${s.choice} row is at least a 44px target — got ${s.height}px`);
}

/* ------------------------------------- 2. nothing opens a keyboard on arrival */

const focusTag = await page.evaluate(() => {
  const el = window.__view.focus();
  return el ? `${el.tagName}:${el.dataset.choice || ''}` : null;
});
eq(focusTag, 'BUTTON:locate',
   'focus() nominates the first CHOICE, not the search box — this is the whole '
   + 'fix for the keyboard opening by itself');

eq(await page.getAttribute('.home-search-block', 'data-hidden'), 'true',
   'the search box starts collapsed');
eq(await page.getAttribute('.home-choice[data-choice="search"]', 'aria-expanded'), 'false',
   'and says so to a screen reader');

/* ------------------------------------------------- 3. search opens on the tap */

await page.click('.home-choice[data-choice="search"]');
eq(await page.getAttribute('.home-search-block', 'data-hidden'), 'false',
   'tapping the search choice reveals the box');
eq(await page.getAttribute('.home-choice[data-choice="search"]', 'aria-expanded'), 'true',
   'and aria-expanded tracks it');
eq(await page.evaluate(() => document.activeElement?.className), 'home-search',
   'focus moves into the field on THAT tap — a user asking for a keyboard, '
   + 'not being handed one');

/* Esc collapses the choice rather than closing the drawer. */
await page.keyboard.press('Escape');
eq(await page.getAttribute('.home-search-block', 'data-hidden'), 'true',
   'Esc collapses the search choice');
eq(await page.evaluate(() => document.activeElement?.dataset?.choice), 'search',
   'and puts focus back on the button that opened it');

/* --------------------------------------------- 4. delete is not one of the three */

eq(await page.getAttribute('.home-danger', 'data-hidden'), 'true',
   'with no home set there is nothing to remove, so the control is absent');

/* ==> A RELOAD, NOT JUST A RE-RENDER, AND THE REASON IS WORTH KNOWING. <==
 * `data/home.js` reads localStorage once and caches the answer at module
 * scope, so seeding storage under a module that has already answered "no home"
 * changes nothing — the first version of this check asserted against that
 * stale null and reported four failures that were entirely its own fault.
 * Seed, reload, mount again. */
await page.evaluate(() => {
  localStorage.setItem('landfall.home', JSON.stringify({
    lon: -94.7977, lat: 29.3013, label: 'Galveston, Texas', place: 'named',
    source: 'address', setAt: new Date().toISOString(),
  }));
});
await page.reload();
if (rootCss) await page.addStyleTag({ content: rootCss });
await page.addScriptTag({ type: 'module', content: MOUNT });
await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });

eq(await page.getAttribute('.home-danger', 'data-hidden'), 'false',
   'with a home set, Remove home appears');
eq(await page.textContent('.home-now-place'), 'Galveston, Texas',
   'and the current home reads as a PLACE, not a coordinate pair');
eq(await page.textContent('.home-now-coords'), '29.301, -94.798',
   'with the exact point as the quiet second line');

const clear = await page.$eval('.home-clear', (e) => {
  const s = getComputedStyle(e);
  return {
    background: s.backgroundColor,
    borderWidth: s.borderTopWidth,
    color: s.color,
    height: Math.round(e.getBoundingClientRect().height),
  };
});

/* THE REGRESSION THIS EXISTS FOR: the delete control used to carry the same
 * fill, border and radius as the buttons above it and read as a fourth way to
 * set a home. It must share NOTHING with `.home-choice`. */
ok(clear.background !== a.background,
   `Remove home does not share the choice fill — choice ${a.background}, clear ${clear.background}`);
ok(clear.borderWidth === '0px',
   `Remove home has no border, unlike a choice — got ${clear.borderWidth}`);
ok(clear.color !== (await page.$eval('.home-choice', (e) => getComputedStyle(e).color)),
   'and is not the same ink as a choice');
ok(clear.height >= 44,
   `but is still a full 44px target — deliberately quiet is not hard to hit — got ${clear.height}px`);

/* ------------------------------------------------------- 5. nothing threw */

ok(consoleErrors.length === 0,
   `no uncaught errors while mounting and driving the panel — saw ${consoleErrors.join(' | ')}`);

await browser.close();

for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} browser assertions passed`
);
console.log('  (the structure is right; whether it READS as three equal doors is glass)');
process.exit(failures.length ? 1 : 0);
