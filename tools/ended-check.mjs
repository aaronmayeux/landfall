/**
 * ended-check.mjs — an ENDED storm, in a real browser, from a cold start
 * (SPEC §5, lib/lifecycle.js + data/lifecycle.js).
 *
 * ===========================================================================
 * WHY THIS EXISTS SEPARATELY FROM headless-check.mjs
 * ===========================================================================
 *
 * Two reasons, and the second is why it is a permanent file rather than a
 * throwaway script.
 *
 * 1. headless-check.mjs uses `waitUntil: 'load'`, which waits for the basemap
 *    style and its tiles. In a sandbox with no route to OpenFreeMap those
 *    requests HANG on DNS rather than failing, so that suite cannot finish
 *    where there is no internet. This one aborts every external request up
 *    front, so it runs anywhere — which is the only way it gets run.
 *
 * 2. IT TESTS THE ONE THING NO NODE SUITE CAN. tools/test-lifecycle.mjs proves
 *    the decision and the persisted shape against a stub localStorage. It
 *    cannot prove that a REAL browser, on a COLD START, rebuilds an ended storm
 *    out of real localStorage and puts it on screen — and that path is the
 *    entire reason the registry persists at all. If it silently failed, the
 *    symptom would be the exact bug this feature was built to remove (a storm
 *    vanishing with no explanation), just moved to page load, where nobody
 *    would connect it to the poll loop.
 *
 * THE STORM IS SEEDED THROUGH localStorage, not through a mocked feed. That is
 * deliberate: it exercises the same bytes `save()` writes and the same `load()`
 * that runs at module init, so a schema mistake fails here instead of on a
 * phone thirty-six hours after a storm ends — which is the slowest possible
 * feedback loop in this project.
 *
 *   python3 -m http.server 8099 & node tools/ended-check.mjs
 *
 * PLAYWRIGHT_CHROMIUM_PATH overrides the browser binary, same as its sibling.
 *
 * WHAT THIS STILL CANNOT TELL YOU: whether the grey reads as "finished" rather
 * than as "far away", whether the badge's three lines fit a thumb's glance, or
 * whether the flattened cage head looks deliberate. That is glass.
 */

import { chromium } from 'playwright';

const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const problems = [];
const note = (m) => console.log('  ' + m);
const ok = (c, m) => (c ? note('✓ ' + m) : (problems.push(m), console.log('  ✗ ' + m)));

/* A storm that ended eight hours ago — inside the 36 h window, so it must be on
 * screen. Shaped exactly as data/lifecycle.js `save()` writes it, because the
 * point is to run the real `load()` against real bytes. */
const endedAt = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
const t0 = Date.now() - 30 * 3600 * 1000;
const SEED = {
  v: 1,
  baseline: { nhc: 1, gdacs: 0 },
  seen: {},
  ended: [
    {
      at: Date.now() - 8 * 3600 * 1000,
      track: [
        [-58.0, 29.0, t0, 90, 4],
        [-58.8, 30.4, t0 + 6 * 3600 * 1000, 85, 3],
        [-59.2, 31.8, t0 + 12 * 3600 * 1000, 75, 3],
        [-59.5, 33.2, t0 + 18 * 3600 * 1000, 65, 2],
      ],
      storm: {
        id: 'nhc:al092026',
        source: 'nhc',
        sourceId: 'al092026',
        name: 'Imelda',
        basin: 'atlantic',
        lat: 33.2,
        lon: -59.5,
        windKt: 65,
        peakWindKt: 90,
        pressureMb: 980,
        headingDeg: 75,
        speedKt: 29,
        nature: 'post-tropical',
        category: 1,
        categoryCode: 'HU',
        categorySource: 'derived',
        observedAt: endedAt,
        advisoryKey: 'nhc:al092026:024',
        raw: { binNumber: 'AT1' },
        ended: {
          reason: 'declared',
          by: 'nhc',
          at: endedAt,
          became: 'became post-tropical',
          key: 'nhc:al092026:024',
        },
      },
    },
  ],
};

const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/* ABORT EVERYTHING OFF-ORIGIN. Basemap tiles, fonts, any relay call — all of it
 * would hang on DNS here. Aborting makes them fail instantly and take their
 * error paths, which is closer to a bad-signal phone than a stall is. */
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(URL.replace(/\/index\.html$/, '')) || u.startsWith('http://127.0.0.1:8099')) {
    return route.continue();
  }
  return route.abort();
});

/* SEEDED BEFORE ANY MODULE RUNS. data/lifecycle.js reads localStorage at import
 * time, so an init script is the only place this can go — set it after `goto`
 * and the registry would already have loaded empty. */
await page.addInitScript((seed) => {
  localStorage.setItem('landfall.ended', JSON.stringify(seed));
  /* Skip the first-run nudges so the drawer is reachable without dismissing
   * anything, and pin the dark theme so the swatch assertion has one expected
   * value rather than two. */
  localStorage.setItem('landfall.firstRun', JSON.stringify({ homePrompted: true, installHinted: true }));
  localStorage.setItem('landfall.settings', JSON.stringify({ theme: 'dark' }));
}, SEED);

/* `domcontentloaded`, NOT `load` — see the header. */
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

console.log('\n=== the registry survives a cold start ===');

const state = await page.evaluate(async () => {
  const { endedStorms } = await import('/data/lifecycle.js');
  const list = endedStorms();
  return {
    count: list.length,
    name: list[0]?.name || null,
    reason: list[0]?.ended?.reason || null,
    became: list[0]?.ended?.became || null,
  };
});
ok(state.count === 1, `the ended storm loaded out of localStorage (${state.count})`);
ok(state.name === 'Imelda', `and kept its name (${state.name})`);
ok(state.reason === 'declared', `and its reason (${state.reason})`);
ok(state.became === 'became post-tropical', `and its transition (${state.became})`);

const track = await page.evaluate(async () => {
  const { endedBundle } = await import('/data/lifecycle.js');
  const b = endedBundle('nhc:al092026');
  return {
    rebuilt: !!b?.rebuilt,
    points: b?.layers?.pastPoints?.fc?.features?.length ?? 0,
    lineStatus: b?.layers?.pastTrack?.status || null,
    lineCoords: b?.layers?.pastTrack?.fc?.features?.[0]?.geometry?.coordinates?.length ?? 0,
    windOnFirst: b?.layers?.pastPoints?.fc?.features?.[0]?.properties?._windKt ?? null,
    futureEmpty: !b?.layers?.cone && !b?.layers?.forecastTrack,
  };
});
ok(track.rebuilt, 'the bundle is flagged as rebuilt, not as a lagging fetch');
ok(track.points === 4, `the past track rehydrated (${track.points} points)`);
ok(track.lineStatus === 'ok', 'and the past LINE was rebuilt for the map');
ok(track.lineCoords === 4, `with every vertex (${track.lineCoords})`);
ok(track.windOnFirst === 90, `carrying its measured winds (${track.windOnFirst} kt)`);
ok(track.futureEmpty, 'and nothing forward-looking exists in it at all');

console.log('\n=== the map layer ===');

const layer = await page.evaluate(() => {
  const m = window.__landfallMap;
  if (!m) return { present: null };
  return {
    present: !!m.getLayer('storm-dot-ended'),
    minzoom: m.getLayer('storm-dot-ended')?.minzoom ?? null,
  };
});
if (layer.present === null) {
  note('… map handle not exposed; layer presence not checkable here (checked on glass)');
} else {
  ok(layer.present, 'the last-known-position layer exists');
  ok(layer.minzoom === 4, `and arrives with the rest of the storm picture (z${layer.minzoom})`);
}

console.log('\n=== the words on screen ===');

/* Open the storm list the way a thumb does. */
await page.click('#btn-storms');
await page.waitForTimeout(600);

const list = await page.evaluate(() => {
  const pill = document.querySelector('#storm-pill, .storm-pill, [data-pill]');
  const row = document.querySelector('.storm-row, [data-storm-id]');
  return {
    pill: pill?.textContent?.trim() || null,
    rowText: row?.textContent?.trim() || null,
    rowLabel: row?.getAttribute('aria-label') || null,
    endedSpan: document.querySelector('.row-ended')?.textContent?.trim() || null,
    swatch: document.querySelector('.row-swatch')
      ? getComputedStyle(document.querySelector('.row-swatch')).getPropertyValue('--swatch').trim()
      : null,
  };
});

ok(
  list.pill == null || /ended/.test(list.pill),
  `the pill splits the count rather than hiding it: "${list.pill}"`
);
ok(list.endedSpan === 'ended', `the row is qualified "${list.endedSpan}"`);
ok(
  list.rowLabel == null || /ended/.test(list.rowLabel),
  `the qualifier is in the accessible name too: "${list.rowLabel}"`
);
ok(
  list.swatch == null || list.swatch.toLowerCase() === '#6f7885',
  `the row swatch is the ended grey, not a category colour: "${list.swatch}"`
);

/* Select it — this is the path that must NOT fetch (a flushed NHC bin) and must
 * NOT offer a Retry button for a storm that loaded perfectly well. */
if (list.rowText) {
  await page.click('.storm-row, [data-storm-id]');
  await page.waitForTimeout(1200);
}

const panel = await page.evaluate(() => {
  const stamp = document.querySelector('.detail-stamp');
  return {
    band: stamp?.dataset?.band || null,
    stampText: stamp?.textContent?.replace(/\s+/g, ' ').trim() || null,
    nature: document.querySelector('.detail-nature')?.textContent?.trim() || null,
    vitalsTitle: [...document.querySelectorAll('.detail-section-head h2')].map((h) => h.textContent.trim()),
    retries: document.querySelectorAll('.detail-retry').length,
    problem: document.querySelector('.detail-geo-error')?.textContent?.trim() || null,
    body: document.querySelector('.detail-body')?.textContent?.replace(/\s+/g, ' ') || '',
  };
});

ok(panel.band === 'ended', `the badge is in the ended band ("${panel.band}")`);
ok(
  /final advisory/i.test(panel.stampText || ''),
  `the badge names what the agency did: "${panel.stampText}"`
);
ok(
  /National Hurricane Center/.test(panel.stampText || ''),
  'and names the agency'
);
ok(
  !/dissipat/i.test(panel.body) && !/dissipat/i.test(panel.stampText || ''),
  'nothing on the panel says the storm dissipated'
);
ok(
  !/all clear/i.test(panel.body) && !/None in effect/i.test(panel.body),
  'and no section published an all-clear'
);
ok(
  /Last reported/.test(panel.nature || ''),
  `the classification line is qualified: "${panel.nature}"`
);
ok(
  panel.vitalsTitle.includes('Last known'),
  `the vitals section is relabelled: ${JSON.stringify(panel.vitalsTitle)}`
);
ok(panel.problem === null, 'no map-problem block blames the source for a finished storm');
ok(panel.retries === 0, `no Retry button is offered (${panel.retries})`);

console.log('\n=== console ===');
/* EXPECTED NOISE, NAMED RATHER THAN BLANKET-IGNORED. There is no Pages Function
 * behind a python static server, so every /api call 404s, and the telemetry
 * beacon POSTs — which python answers with 501 Unsupported method. Both are
 * harness artifacts. Everything else is a real page error and must be zero;
 * filtering more loosely than this is how a genuine exception hides inside the
 * noise the harness creates. */
const real = errors.filter(
  (e) => !/Failed to fetch|net::ERR|404|501|Unsupported method|Load failed|NetworkError/i.test(e)
);
ok(real.length === 0, `no page errors beyond the blocked requests (${real.length})`);
for (const e of real) note('   ! ' + e);

await browser.close();

if (problems.length) {
  console.log(`\n✗ ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\n✓ an ended storm survives a cold start, draws, and says why');
console.log('  (the grey still has to LOOK finished rather than distant — that is glass)');
