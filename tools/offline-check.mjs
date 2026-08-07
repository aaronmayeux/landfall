/**
 * offline-check.mjs — does the app survive losing the network, and does it say
 * so? (SPEC §5, §14 Phase 5.)
 *
 * THIS IS THE ONE THING THE SERVICE WORKER PROMISES AND NOTHING TESTED. `sw.js`
 * is 200 lines of caching policy with real reasoning behind every branch, and
 * until this file existed not one line of it had ever been exercised by
 * anything but a human with a flight-mode toggle — which, on the record, nobody
 * had done.
 *
 * ==> THE QUESTION THAT MATTERS IS NOT "DOES IT BOOT". <== A shell that boots
 * offline and then shows an empty ocean is WORSE than a shell that fails to
 * boot, because it looks like an answer. §5 calls that shape safety-adjacent
 * and it is the whole reason this check exists: the pass condition is that the
 * app comes up AND admits the feeds are gone.
 *
 * WHAT IT CANNOT COVER. Real flight mode on a real phone, an installed
 * standalone window, and iOS's own worker implementation, which is not
 * Chromium's. This is a floor. Glass is still the proof.
 *
 * NEEDS PLAYWRIGHT AND A LOCAL SERVER. No internet: the vendored libraries are
 * same-origin (§17 A3) and /api/ is mocked below, so the only thing missing is
 * basemap tiles, which no check here reads.
 *
 *   python3 -m http.server 8099 & node tools/offline-check.mjs
 *
 * IF NODE CANNOT FIND `playwright`, it is installed globally and ES modules do
 * not read the global path. Symlink it in for the session and delete it after:
 *
 *   ln -sfn "$(npm root -g)" node_modules
 *
 * PLAYWRIGHT_CHROMIUM_PATH overrides the browser binary, same as
 * tools/headless-check.mjs.
 */

import { chromium } from 'playwright';

const URL_BASE = process.env.LANDFALL_URL || 'http://127.0.0.1:8099';
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/* A HEALTHY-BUT-EMPTY OCEAN IS THE RIGHT BASELINE. Both feeds answer, neither
 * has a storm — so the app's honest state before the network is cut is `clear`.
 * That makes the offline assertion sharp: `clear` must become `unavailable`,
 * and a check that started from storms-on-screen could pass on leftovers. */
const EMPTY_NHC = JSON.stringify({ activeStorms: [] });
const EMPTY_GDACS = JSON.stringify({ type: 'FeatureCollection', features: [] });

/* The relay stamps every response with the time it reached upstream, and
 * ui/status.js bands the strip on that age. An absent or old stamp would raise
 * the "feed delayed" banner and muddy what this file is measuring. */
function relayHeaders() {
  return {
    'content-type': 'application/json',
    'x-landfall-fetched-at': new Date().toISOString(),
    'access-control-allow-origin': '*',
  };
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** The status strip's text, or '' when it is hidden. §5's "never ship silence"
 *  is judged on this string and nothing else. */
async function stripText(page) {
  return page.evaluate(() => {
    const n = document.getElementById('status-chip');
    if (!n || n.dataset.visible !== 'true') return '';
    return (n.textContent || '').trim();
  });
}

/** Every URL the service worker is currently holding. */
async function cachedUrls(page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const out = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(req.url);
    }
    return out;
  });
}

async function run() {
  const browser = await chromium.launch({
    executablePath: EXECUTABLE_PATH,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  /* /api/ is mocked rather than proxied: a static server answers it with a 404,
   * and a 404 is a DIFFERENT code path from a dead network. Conflating them
   * would make the offline result meaningless. */
  /* ==> ORDER IS LOAD-BEARING AND IT IS BACKWARDS FROM THE OBVIOUS READING.
   * Playwright matches the MOST RECENTLY ADDED handler first, so the catch-all
   * goes FIRST and the specific routes go last. Written the intuitive way round
   * it silently 503s the two feeds this file exists to keep healthy, both
   * sources sit in `loading`, and every assertion below measures the harness
   * instead of the app. That is exactly what happened on the first run.
   *
   * ==> AND `setOffline` DOES NOT REACH A MOCKED ROUTE. <== A route handler
   * fulfils from inside the browser process and never touches the network
   * stack, so cutting the context's network leaves the mocks answering happily.
   * The second run "went offline" and both feeds came back `ok` — the app was
   * never tested at all. The flag below is what actually cuts the feeds, and
   * `setOffline` remains only for everything that is NOT mocked. */
  const net = { offline: false };
  const cut = (route) => route.abort('internetdisconnected');

  await context.route('**/api/**', (route) =>
    net.offline ? cut(route) : route.fulfill({ status: 503, body: '{}' })
  );
  await context.route('**/api/nhc/storms*', (route) =>
    net.offline
      ? cut(route)
      : route.fulfill({ status: 200, headers: relayHeaders(), body: EMPTY_NHC })
  );
  await context.route('**/api/gdacs/events*', (route) =>
    net.offline
      ? cut(route)
      : route.fulfill({ status: 200, headers: relayHeaders(), body: EMPTY_GDACS })
  );

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  console.log('\n1. FIRST LOAD (online) — does the worker take control?');
  await page.goto(`${URL_BASE}/index.html`, { waitUntil: 'load' });
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-support';
    const reg = await navigator.serviceWorker.ready;
    return reg && navigator.serviceWorker.controller ? 'controlled' : 'registered-not-controlling';
  });
  check(
    'service worker registers',
    controlled === 'controlled' || controlled === 'registered-not-controlling',
    controlled
  );

  console.log('\n2. SECOND LOAD (online) — the runtime cache fills.');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const onlineStrip = await stripText(page);
  check('online: shell renders', (await page.locator('#globe').count()) === 1);
  /* THE BASEMAP IS THE ONE THING THIS HARNESS CANNOT MOCK. Vector tiles come
   * from OpenFreeMap and a sandbox with no internet cannot reach them, so the
   * tile message is EXPECTED here and is not a finding. What must never appear
   * while both feeds are answering is a message about the FEEDS. */
  check('online: strip says nothing about the feeds',
    !/not responding|delayed/i.test(onlineStrip), onlineStrip || '(hidden)');

  const cached = await cachedUrls(page);
  check('runtime cache captured app modules', cached.some((u) => u.includes('/main.js')),
    `${cached.length} entries`);
  const apiCached = cached.filter((u) => u.includes('/api/'));
  check('NO /api/ response was cached by the worker', apiCached.length === 0,
    apiCached.length ? apiCached.join(', ') : 'data stays live, as §14 says');

  console.log('\n3. NETWORK CUT — reload with nothing reachable.');
  net.offline = true;
  await context.setOffline(true);
  let bootFailed = false;
  try {
    await page.reload({ waitUntil: 'load', timeout: 20000 });
  } catch (err) {
    bootFailed = true;
    check('offline: the page loads at all', false, String(err.message).split('\n')[0]);
  }
  if (!bootFailed) {
    await page.waitForTimeout(4000);
    check('offline: the page loads at all', true);
    check('offline: shell renders', (await page.locator('#globe').count()) === 1);
    check('offline: controls are present', (await page.locator('#btn-storms').count()) === 1);
    check(
      'offline: the boot veil lifts (not stuck on a spinner)',
      await page.evaluate(() => {
        const v = document.getElementById('veil') || document.getElementById('boot');
        if (!v) return true;
        const s = getComputedStyle(v);
        return s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0;
      })
    );

    /* ==> THIS IS A STOPWATCH, NOT A SNAPSHOT. <== The first version sampled
     * the strip once at four seconds, called it silent and would have called
     * that a §5 violation. It is not: the message DOES arrive, it arrives after
     * the retry ladder gives up, and HOW LONG THAT TAKES is the actual finding.
     * A check that only answers yes/no cannot tell "broken" from "a minute
     * late", and a minute late on a phone is indistinguishable from broken. */
    const started = Date.now();
    let offlineStrip = '';
    let admitMs = null;
    while (Date.now() - started < 90000) {
      offlineStrip = await stripText(page);
      if (/not responding|unavailable|offline|no connection/i.test(offlineStrip)) {
        admitMs = Date.now() - started;
        break;
      }
      await page.waitForTimeout(500);
    }
    check('==> offline: the app SAYS the feeds are gone <==', admitMs != null,
      admitMs != null ? `"${offlineStrip}"` : 'NEVER — strip stayed silent for 90 s');
    check('offline: it says so within 10 s of the reload', admitMs != null && admitMs <= 10000,
      admitMs != null ? `took ${(admitMs / 1000).toFixed(1)} s` : 'n/a');
    check('offline: does not claim all clear', !/all clear|no storms/i.test(offlineStrip),
      offlineStrip ? `"${offlineStrip}"` : '(silent)');
  }

  console.log('\n4. NETWORK BACK — does it recover without a hard reload?');
  net.offline = false;
  await context.setOffline(false);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const recovered = await stripText(page);
  check('recovery: the feed outage message is gone',
    !/not responding/i.test(recovered), recovered || '(hidden)');

  const fatal = consoleErrors.filter(
    (t) => !/favicon|tiles|openfreemap|Failed to fetch|503|ERR_FAILED|ERR_INTERNET_DISCONNECTED/i.test(t)
  );
  check('no unexplained console errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('offline-check could not run:', err.message);
  process.exitCode = 1;
});
