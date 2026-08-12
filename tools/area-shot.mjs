/**
 * area-shot.mjs — render the WATCHED-AREA panel's real markup against the real
 * CSS and photograph it. Not in the suite; needs Playwright.
 *
 *   ln -sfn "$(npm root -g)" node_modules
 *   node tools/area-shot.mjs
 *   rm -f node_modules            # before committing
 *
 * WHY THIS EXISTS, AND WHY IT IS SHAPED THIS WAY. This panel shipped with
 * markup and no stylesheet — every class resolved to nothing and the browser
 * fell back to its own defaults. No assertion in the suite caught it, and none
 * could have: the JS was correct, the strings were correct, and the only thing
 * wrong was that nothing painted them. The gap was a box-model gap, and the
 * box model needs a browser.
 *
 * ==> IT IMPORTS THE REAL VIEW. <== An earlier draft pasted a copy of the
 * markup in here, which is a preview that can pass while the panel is broken —
 * the copy drifts, the copy gets styled, and the real one does not. This one
 * calls `createAreaDetailView()`, mounts it into a real element, and shoots
 * whatever it puts there. If the view stops emitting a class, this stops
 * styling it too.
 *
 * IT IS STILL NOT GLASS. Whether the two-day figure reads as the quieter of
 * the pair, whether the card competes with the heading, and whether any of it
 * holds up in daylight are Aaron's calls.
 */

import fs from 'node:fs';
import { chromium } from 'playwright';

const css = fs.readFileSync('ui/panels.css', 'utf8');
const tokens =
  fs.readFileSync('index.html', 'utf8').match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';

/* THE FOUR SHAPES THIS PANEL ACTUALLY TAKES. A single happy-path area proves
 * almost nothing here — the layout hazards are all in the variants:
 *
 *  1. NHC, both horizons stated. The common case, and the one in the
 *     screenshot that started this.
 *  2. NHC with a MISSING two-day figure. "Not stated" is a longer string than
 *     any percentage and is the widest the value column ever gets.
 *  3. NHC, overdue. The amber badge rides in the source kicker; it has to fit
 *     on the line without pushing the name.
 *  4. JTWC. One horizon instead of two, a word instead of a number, no basin
 *     rows at all, and an extra note at the foot. Its card is a single row, so
 *     the divider rule between rows must not appear on it. */
const AREAS = [
  {
    id: 'a1',
    title: 'Central Atlantic',
    source: 'NHC',
    prob2day: 70,
    risk2day: 'HIGH',
    prob7day: 80,
    risk7day: 'HIGH',
    globeRisk: 'HIGH',
    issuedAt: Date.now() - 5 * 3600e3,
    centroid: { lon: -49, lat: 13 },
    sourceBasin: 'Atlantic',
    basin: 'atlantic',
  },
  {
    id: 'a2',
    title: 'Eastern Gulf of America',
    source: 'NHC',
    prob2day: null,
    risk2day: 'LOW',
    prob7day: 20,
    risk7day: 'LOW',
    globeRisk: 'LOW',
    issuedAt: Date.now() - 46 * 60e3,
    centroid: { lon: -84.25, lat: 26.5 },
    sourceBasin: 'Gulf of America',
    basin: 'atlantic',
  },
  {
    id: 'a3',
    title: 'Southwestern Caribbean Sea',
    source: 'NHC',
    prob2day: 0,
    risk2day: 'LOW',
    prob7day: 40,
    risk7day: 'MEDIUM',
    globeRisk: 'MEDIUM',
    issuedAt: Date.now() - 19 * 3600e3,
    centroid: { lon: -78.9, lat: 12.4 },
    sourceBasin: 'Atlantic',
    basin: 'atlantic',
  },
  {
    id: 'a4',
    title: 'Western North Pacific',
    source: 'JTWC',
    risk: 'MEDIUM',
    globeRisk: 'MEDIUM',
    issuedAt: Date.now() - 3 * 3600e3,
    centroid: { lon: 138.2, lat: 9.6 },
    sourceBasin: null,
    basin: 'westPacific',
  },
];

/* 390px is an iPhone 15's CSS width, which is the narrowest surface this has
 * to survive; the drawer is full-width there. 340px is the wide-layout rail
 * (SPEC §16) and is NARROWER than the phone — the fact list's two columns are
 * tightest here, not on the phone, which is the thing that makes shooting only
 * a phone width misleading. */
const WIDTHS = [390, 340];

const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">
<style>${tokens}</style><style>${css}</style>
<style>
  /* The drawer sits on --glass over the globe, so the preview reproduces both:
     the sky underneath, the glass on top. A panel shot on flat black lies
     about every hairline rule in it. */
  body { margin: 0; background: var(--space); font-family: var(--font-ui); color: var(--text-primary); }
  .stage { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; padding: 24px; width: 1320px; }
  .frame {
    background: var(--glass);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-large);
    overflow: hidden;
  }
  .cap { font-size: 11px; color: var(--text-muted); padding: 6px 0 4px; }
  /* The drawer's own header, reproduced so the body is judged under the same
     chrome it ships under rather than floating free. */
  .fakehead {
    display: flex; align-items: center; gap: 8px;
    min-height: 52px; padding: 0 12px;
    border-bottom: 1px solid var(--glass-border);
    font-size: 0.95rem; font-weight: 600;
  }
  .host { display: flex; flex-direction: column; max-height: 620px; }
</style></head><body><div class="stage" id="stage"></div>
<script type="module">
  import { createAreaDetailView } from '/ui/view-area-detail.js';
  const stage = document.getElementById('stage');
  window.__mount = (areas, widths) => {
    stage.innerHTML = '';
    for (const w of widths) {
      for (const a of areas) {
        const wrap = document.createElement('div');
        wrap.innerHTML = '<div class="cap">' + w + 'px — ' + a.title + '</div>';
        const frame = document.createElement('div');
        frame.className = 'frame';
        frame.style.width = w + 'px';
        frame.innerHTML = '<div class="fakehead"><span>Being watched</span></div>';
        const host = document.createElement('div');
        host.className = 'host';
        frame.appendChild(host);
        const v = createAreaDetailView();
        v.mount(host);
        v.onEnter(a);
        wrap.appendChild(frame);
        stage.appendChild(wrap);
      }
    }
  };
</script></body></html>`;

/* WRITTEN INTO THE SERVED TREE, NOT /tmp, and removed again at the end. The
 * page imports the real view by module path, so it has to be served from the
 * same origin as `ui/` or the import 404s. Nothing here is committed. */
const PAGE = 'tools/area-shot.html';
fs.writeFileSync(PAGE, html);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

/* Served over http, not file://, because the page imports the real view as an
 * ES module and a module import from file:// is blocked by CORS. The dev
 * server on 8099 is the same one every other browser check here expects. */
await page.goto('http://127.0.0.1:8099/tools/area-shot.html');
await page.evaluate(
  ([areas, widths]) => window.__mount(areas, widths),
  [AREAS, WIDTHS]
);
await page.waitForTimeout(150);

const stage = await page.locator('#stage');
await stage.screenshot({ path: '/tmp/area-panel.png' });

/* THE MEASUREMENTS, printed rather than asserted. This file is a preview, not
 * a suite — an assertion here would be a second place to keep the numbers and
 * would fail the moment anything is tuned. Printing them puts the box model
 * where a reader can see it and leaves the judgement to Aaron. */
const facts = await page.evaluate(() => {
  const out = [];
  for (const f of document.querySelectorAll('.frame')) {
    const q = (s) => f.querySelector(s);
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const sw = box(q('.watch-swatch'));
    const nm = box(q('.area-name'));
    const card = box(q('.area-horizons'));
    /* ==> THE ALIGNMENT CHECK USES THE LAST PAIR, NOT THE FIRST. <== The first
     * value is the coordinate and is the one element here set in the monospace
     * face. `align-items: baseline` aligns BASELINES, but two fonts at the same
     * size have different ascents, so their box TOPS differ by a pixel or two
     * even when the type is sitting perfectly. Measuring the first pair
     * reported a 2px fault that was not one. The basin rows are both in the UI
     * font, so their tops are a true test of the grid. */
    const rows = [...f.querySelectorAll('.area-facts dt')];
    const lastDt = rows[rows.length - 1];
    const lastDd = lastDt?.nextElementSibling;
    out.push({
      w: Math.round(f.getBoundingClientRect().width),
      title: q('.area-name')?.textContent,
      swatch: sw ? `${Math.round(sw.width)}x${Math.round(sw.height)}` : 'MISSING',
      nameSize: q('.area-name') ? getComputedStyle(q('.area-name')).fontSize : '-',
      cardRows: f.querySelectorAll('.area-horizon').length,
      cardW: card ? Math.round(card.width) : 0,
      labelTop: lastDt ? Math.round(box(lastDt).top) : null,
      valueTop: lastDd ? Math.round(box(lastDd).top) : null,
      overflow: Math.round(f.scrollWidth - f.clientWidth),
    });
  }
  return out;
});

for (const f of facts) {
  console.log(
    `${String(f.w).padStart(4)}px  ${f.title.padEnd(28)} swatch ${f.swatch.padEnd(7)} ` +
      `name ${f.nameSize.padEnd(7)} card ${f.cardRows} row(s) ${String(f.cardW).padStart(3)}px  ` +
      `fact rows ${f.labelTop == null ? 'n/a' : f.labelTop === f.valueTop ? 'ALIGNED' : `OFF BY ${Math.abs(f.labelTop - f.valueTop)}px`}  ` +
      `h-overflow ${f.overflow}px`
  );
}

console.log('\nwrote /tmp/area-panel.png');
await browser.close();
fs.unlinkSync(PAGE);
