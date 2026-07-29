/**
 * detail-disclaimer-check.mjs — the storm detail panel says who it is.
 *
 * ==> WHY THIS EXISTS AS A MEASUREMENT AND NOT A CODE REVIEW <==
 * SPEC §17 A1 names the storm detail panel as the placement worth more than
 * either of the disclaimer's other two surfaces, because it is the screen
 * where somebody reads a forecast and decides something. A footer that is
 * present in the source but scrolled out of a bottom sheet, or clipped by an
 * overflow rule, is absent to the person who needed it — and §5's whole
 * argument is that absence reads as safety.
 *
 * `disclaimer-layout-check.mjs` exists for exactly this reason on the
 * first-run strip: that bug was invisible in the source and only existed in
 * geometry at narrow widths. Same class of risk here, same kind of check.
 *
 * ==> IT STUBS THE FEED, WHICH IS THE POINT <==
 * `headless-check.mjs` reports "0 storms" locally, so it has never once
 * rendered this panel — the sandbox cannot reach NOAA, and the relay routes
 * 404 against a plain static server. A check that only runs when a real
 * hurricane exists is a check that does not run. One synthetic storm through
 * `/api/nhc/storms` in NHC's own `activeStorms` shape gets the panel on
 * screen deterministically, in January as well as September.
 *
 *   python3 -m http.server 8099 & node tools/detail-disclaimer-check.mjs
 */

import { chromium } from 'playwright';

const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const WIDTHS = [375, 390, 430, 768, 1280];

/* NHC's CurrentStorms.json shape, one storm, only the fields data/nhc.js
 * reads. Deliberately a real-looking major hurricane in the Atlantic: the
 * panel renders more sections the more the storm has, and the fullest panel
 * is the one where a footer is most likely to fall off the end. */
const FAKE = {
  activeStorms: [
    {
      id: 'al092026',
      binNumber: 'AT1',
      name: 'Teststorm',
      classification: 'HU',
      intensity: '115',
      pressure: '945',
      latitudeNumeric: 24.6,
      longitudeNumeric: -76.2,
      movementDir: 315,
      movementSpeed: 12,
      lastUpdate: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
      publicAdvisory: { advNum: '23', issuance: new Date().toISOString() },
    },
  ],
};

const problems = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); problems.push(m); };

/* PLAYWRIGHT_CHROMIUM_PATH, same override its siblings in this directory already
 * carry (headless-check.mjs, disclaimer-layout-check.mjs). Added 2026-07-28: this
 * file was the only playwright check without it, so in a sandbox whose bundled
 * Chromium build does not match the installed Playwright it could not launch at
 * all — a gate that cannot run is a gate nobody is passing. */
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});

for (const width of WIDTHS) {
  console.log(`\n=== ${width}px ===`);
  const page = await browser.newPage({ viewport: { width, height: 844 } });

  /* Stub the one route that produces a storm. Everything else is allowed to
   * fail exactly as it does today — the panel's job is to render its failure
   * states, and this check is not about those. */
  await page.route('**/api/nhc/storms*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE),
    })
  );

  /* ===> `domcontentloaded`, NOT `load`. <===
   * `load` waits for every subresource, and that includes basemap tiles from
   * tiles.openfreemap.org — a host this check cannot reach when it runs
   * offline. So the check did not fail, it HUNG, until Playwright's navigation
   * timeout, which reads as "the tool is broken" rather than "the app is fine".
   * The app is fully wired at DOMContentLoaded; the fixed wait below is what
   * gives the drawer time to render. Same fix as tools/ended-check.mjs:117,
   * which documented this first. */
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  /* Clear the first-run disclaimer if it is up — it is a different surface
   * and it sits over the bottom of the screen, which is where we measure. */
  const ack = page.locator('.nudge-disclaimer .nudge-action');
  if (await ack.count()) { await ack.click(); await page.waitForTimeout(600); }

  /* The list is a drawer view, so it has to be opened before any row exists.
   * The first version of this check looked for `.storm-row` on a closed
   * drawer and reported "the stub did not take" — a wrong diagnosis of a
   * working stub, which is exactly the failure §5 keeps warning about. */
  await page.click('#btn-storms');
  await page.waitForTimeout(1200);

  const row = page.locator('.storm-row').first();
  if (!(await row.count())) { bad('no storm row — the stub did not take'); await page.close(); continue; }
  await row.click();
  await page.waitForTimeout(2500);

  const foot = page.locator('.detail-disclaimer');
  if (!(await foot.count())) { bad('no .detail-disclaimer on the panel'); await page.close(); continue; }
  ok('footer present on the storm detail panel');

  const text = (await foot.innerText()).replace(/\s+/g, ' ').trim();
  if (!/unofficial/i.test(text)) bad(`footer does not say unofficial: "${text}"`);
  else ok('footer names the app as unofficial');
  if (!/National Hurricane Cent(er|re)/i.test(text)) bad('footer does not name the NHC');
  else ok('footer points at the NHC');

  /* Geometry. A box of zero height, or one sitting outside the viewport, is
   * the disclaimer-strip bug repeating on a different surface. */
  const box = await foot.boundingBox();
  if (!box) { bad('footer has no box — not rendered'); await page.close(); continue; }
  if (box.height < 10) bad(`footer collapsed to ${Math.round(box.height)}px tall`);
  else ok(`footer is ${Math.round(box.height)}px tall`);
  if (box.x < 0 || box.x + box.width > width + 1)
    bad(`footer spans x=${Math.round(box.x)}..${Math.round(box.x + box.width)} in a ${width}px viewport`);
  else ok('footer is inside the viewport horizontally');

  /* The link owes a 44px target like everything else (§10). */
  const link = foot.locator('.detail-disclaimer-link');
  if (!(await link.count())) bad('no link to the NHC');
  else {
    const lb = await link.boundingBox();
    if (!lb || lb.height < 44) bad(`NHC link is ${lb ? Math.round(lb.height) : 0}px tall, under the 44px target`);
    else ok(`NHC link target is ${Math.round(lb.height)}px`);
  }

  /* Reachable by scrolling, not clipped away. Scroll the panel body to the
   * bottom and confirm the footer lands inside it. */
  const reached = await page.evaluate(() => {
    const body = document.querySelector('.detail-body');
    const el = document.querySelector('.detail-disclaimer');
    if (!body || !el) return null;
    body.scrollTop = body.scrollHeight;
    const b = body.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return { top: e.top, bottom: e.bottom, bodyTop: b.top, bodyBottom: b.bottom };
  });
  if (!reached) bad('could not measure the footer against the panel body');
  else if (reached.top >= reached.bodyBottom || reached.bottom <= reached.bodyTop)
    bad('footer is outside the panel body even after scrolling to the end');
  else ok('footer is reachable by scrolling to the end of the panel');

  await page.close();
}

await browser.close();

console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nOK — the storm detail panel says who it is at every width');
for (const p of problems) console.log(` - ${p}`);
process.exit(problems.length ? 1 : 0);
