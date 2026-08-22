#!/usr/bin/env node
/**
 * boot-smoke.mjs — does the app boot without throwing, and do the layer
 * controls actually apply?
 *
 * ==> THIS EXISTS BECAUSE A ONE-LINE SCOPE ERROR REACHED PRODUCTION AND EVERY
 * GATE PASSED. <== 2026-08-22, §48.21. `main.js` called
 * `layerStatus.setFloodAlerts(...)` and `layerStatus` is created in
 * `app/views.js` — it has never been in main.js's scope. That is a
 * ReferenceError inside `applyLayerState()`, which runs at boot and on every
 * layer change, and it fired on the DEFAULT path because the else-branch that
 * clears the row runs whenever the toggle is off.
 *
 * Everything after that line stopped running: the genesis glyphs in the 3D
 * globe, every exclusive pair, the imagery mode — and, in the `subscribeLayers`
 * callback, the Environment ribbon's warm and both pipeline repushes. The
 * symptom Aaron reported was *"the environment ribbon no longer works"*, and
 * the cause was a layer nobody had switched on.
 *
 * WHY NOTHING CAUGHT IT:
 *   - `check-syntax` parses every module and resolves every named IMPORT. A
 *     bare identifier that was never imported or declared is legal syntax and
 *     a runtime error. It cannot see this and it did not.
 *   - The 38 node suites are pure-function tests. `applyLayerState` is wiring;
 *     it has no test and would need a browser to have one.
 *   - The pre-push browser check drives the home SETUP panel. It never touches
 *     the layers panel and never flips a switch.
 *
 * ==> SO THIS ASSERTS THE ONE THING ALL OF THEM MISSED: THE CONSOLE IS CLEAN
 * AND THE CONTROLS DO SOMETHING. <== It is deliberately shallow. It does not
 * check what anything LOOKS like — that is Aaron's job on glass and no tool
 * substitutes. It checks that the code ran.
 *
 * Needs the static server in the SAME shell command:
 *   bash tools/with-server.sh node tools/boot-smoke.mjs
 */

import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8099/';

/* ==> THE BASEMAP AND EVERY FEED ARE UNREACHABLE FROM THIS SANDBOX, AND THAT
 * IS FINE FOR THIS TEST. <== A blocked tile host produces network failures, not
 * exceptions, and the app is built to survive exactly that (§5). What must not
 * appear is OUR code throwing. These are the noise patterns a blocked network
 * produces; anything else is a finding. */
const EXPECTED_NOISE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /openfreemap|tiles\./i,
  /AbortError/i,
  /Could not parse color from value 'null'/i, // known, tracked in NOW.md
];

const isNoise = (text) => EXPECTED_NOISE.some((re) => re.test(text));

/* ==> AND THE MOST IMPORTANT LISTENER IS ON `console.warn`, WHICH IS NOT AN
 * ERROR CHANNEL. <== The first cut of this file listened for `pageerror` and
 * `console.error` and PASSED with the production bug reintroduced — a test that
 * agreed with the bug, which is worse than no test at all (§12).
 *
 * The reason is that this app swallows subscriber exceptions ON PURPOSE and
 * logs them as warnings: `data/layer-prefs.js` `emit()` wraps every listener in
 * a try/catch so one bad subscriber cannot stop the others from updating, which
 * is the right call and is why a dead `applyLayerState` did not take the page
 * down. It also means the ONLY trace of a fatal wiring error is a
 * `console.warn` line reading `[landfall] layer-prefs subscriber failed`.
 *
 * So a swallowed exception is a FAILURE here, not noise. These are the markers
 * this app uses when it catches something it did not expect. */
const SWALLOWED = [
  /\[landfall\][^\n]*subscriber failed/i,
  /\[landfall\][^\n]*map error/i,
];

const isSwallowed = (text) => SWALLOWED.some((re) => re.test(text));

let failures = 0;
const ok = (label) => console.log(`  \u2713 ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  \u2717 ${label}${detail ? `\n      ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
const pageErrors = [];

page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' && !isNoise(text)) errors.push(text);
  /* A warning that says the app caught something is an uncaught exception
   * wearing a friendlier label. Counted with the errors, deliberately — but
   * still through the noise filter: MapLibre reports the blocked basemap
   * through the same `map error` channel, and a tile host this sandbox cannot
   * reach is the expected condition rather than a finding. */
  if (m.type() === 'warning' && isSwallowed(text) && !isNoise(text)) pageErrors.push(text);
});
/* ==> `pageerror` IS THE ONE THAT MATTERS AND IT IS A DIFFERENT EVENT. <== An
 * uncaught exception fires `pageerror`; `console.error` only fires if somebody
 * caught it and logged it. The bug this file exists for was uncaught, so a
 * listener on `console` alone would have missed it too. */
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));

console.log('\nBoot');
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  /* Long enough for module graph evaluation, boot, and the first
   * applyLayerState — which is the function this test is really about. */
  await page.waitForTimeout(6000);
  ok('the page loads');
} catch (e) {
  fail('the page loads', String(e?.message || e));
}

/* ------------------------------------------------------------------------- */
console.log('\nNothing threw');
{
  if (pageErrors.length === 0) ok('no uncaught exception during boot');
  else fail(`${pageErrors.length} uncaught exception(s) during boot`,
    pageErrors.slice(0, 5).join('\n      '));

  if (errors.length === 0) ok('no unexpected console errors');
  else fail(`${errors.length} unexpected console error(s)`,
    errors.slice(0, 5).join('\n      '));
}

/* ------------------------------------------------------------------------- */
console.log('\nThe layer controls apply');
{
  /* ==> THE ASSERTION THAT WOULD HAVE CAUGHT IT. <== `applyLayerState` runs at
   * boot and again on every layer change. If it throws, the switch still moves
   * — the preference store is updated before the map is told — so a test that
   * only clicked and read the checkbox would pass over a completely dead
   * layer path. What proves the function RAN to completion is a fresh
   * exception count after a flip. */
  const before = pageErrors.length + errors.length;

  const flipped = await page.evaluate(async () => {
    /* Drive the store the panel drives, rather than hunting for a DOM control
     * whose markup this test would then be coupled to. */
    const prefs = await import('/data/layer-prefs.js');
    const { LAYER_TOGGLES } = await import('/config/layers.js');
    const keys = LAYER_TOGGLES.map((t) => t.key);
    for (const k of keys) {
      prefs.setToggle(k, !prefs.toggleOn(k));
      prefs.setToggle(k, !prefs.toggleOn(k));
    }
    return keys;
  }).catch((e) => ({ error: String(e?.message || e) }));

  if (flipped?.error) {
    fail('every toggle can be flipped', flipped.error);
  } else {
    ok(`every toggle flips both ways (${flipped.length} of them)`);
    await page.waitForTimeout(1500);
    const after = pageErrors.length + errors.length;
    if (after === before) ok('and flipping them threw nothing');
    else fail(`flipping toggles produced ${after - before} new error(s)`,
      [...pageErrors, ...errors].slice(-3).join('\n      '));
  }
}

/* ------------------------------------------------------------------------- */
console.log('\nEvery live toggle is reachable');
{
  /* A layer whose manifest entry is complete but which never declared itself
   * in `SHIPPED_EARLY` renders as not-built-yet: the control is there and does
   * nothing a reader can see. §48.21 shipped exactly that way. This asserts
   * the two halves agree. */
  const dead = await page.evaluate(async () => {
    const { LAYER_TOGGLES, isLive } = await import('/config/layers.js');
    return LAYER_TOGGLES
      .filter((t) => t.engineKey && !isLive(t))
      .map((t) => t.key);
  }).catch(() => null);

  if (dead === null) fail('the manifest can be read');
  else if (dead.length === 0) ok('every toggle with an engine key is live');
  else fail('a toggle drives a real layer but is presented as not built yet',
    `${dead.join(', ')} \u2014 add to SHIPPED_EARLY in config/layers.js`);
}

await browser.close();

console.log(
  failures === 0
    ? '\n\u2713 boot smoke: the app boots clean and the layer controls apply\n'
    : `\n\u2717 boot smoke: ${failures} failure(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
