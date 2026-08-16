/**
 * row-shot.mjs — render the storm row's REAL markup against the REAL CSS and
 * measure it. Not in the suite; needs Playwright.
 *
 *   ln -sfn "$(npm root -g)" node_modules
 *   node tools/row-shot.mjs
 *   rm -f node_modules            # before committing
 *
 * WHY THIS EXISTS. `row-preview.mjs` proves the TEXT is right. It cannot prove
 * the two vertical columns line up, that the badge never compresses, that a
 * long name wraps without dragging the badge with it, or that a row clears the
 * 44px touch target. Those are properties of the box model, and the box model
 * needs a browser.
 *
 * It is still not glass. Color, contrast in daylight, and whether the arrow
 * reads as a direction are Aaron's calls.
 */

import fs from 'node:fs';
import { chromium } from 'playwright';
/* THE SAME ARROW THE APP DRAWS, not a copy of it. A preview rendering its own
 * version of the mark is a preview that can pass while the row is broken. */
import { headingArrow } from '../ui/heading-arrow.js';

const css = fs.readFileSync('ui/panels.css', 'utf8');
const tokens = fs.readFileSync('index.html', 'utf8').match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';

/* The four live storms from the archive, plus two shapes that only appear
 * rarely and are exactly where a layout breaks: a name long enough to wrap,
 * and the widest badge next to the widest stamp. */
const ROWS = [
  { name: 'Fifteen', badge: 'TD', where: '6,333 mi WNW', stamp: '7 hrs ago', tone: 'stale', track: { deg: 292, t: 'closest 120 mi in 9 hrs', tone: 'near' } },
  { name: 'Chan-hom', badge: 'TS', where: '6,572 mi NW', stamp: '', tone: '', track: { deg: 45, t: 'moving away', tone: 'far' } },
  { name: 'Peilou', badge: 'TS', where: '6,850 mi WNW', stamp: '7 hrs ago', tone: 'stale', track: null },
  { name: 'Dolphin', badge: 'HU', where: '7,956 mi NNW', stamp: 'not updating', tone: 'silent', track: null },
  { name: 'Tropical Depression Twenty-Two', badge: 'CAT 5', where: '11,204 mi NNW', stamp: 'ended', tone: 'ended', track: { deg: null, t: 'never comes near', tone: 'far' } },
  { name: 'Genevieve', badge: 'CAT 3', where: '38.4°N 145.9°E', stamp: '', tone: '', track: null },
];

const row = (r) => `
<button class="storm-row" type="button" role="listitem">
  <span class="row-swatch" style="--swatch:#FF7A33" aria-hidden="true"></span>
  <span class="row-text">
    <span class="row-head">
      <span class="row-name">${r.name}</span>
      <span class="row-badge">${r.badge}</span>
    </span>
    <span class="row-where">
      <span class="row-dist">${r.where}</span>
      ${r.stamp ? `<span class="row-stamp" data-tone="${r.tone}">${r.stamp}</span>` : ''}
    </span>
    ${r.track ? `<span class="row-track" data-tone="${r.track.tone}"><span class="row-track-lead">${headingArrow(r.track.deg)}</span>${r.track.t}</span>` : ''}
  </span>
</button>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}</style><style>${css}</style>
<style>
  /* The drawer sits on --glass over the globe, so the preview reproduces
     both: the theme's own sky color underneath, the glass on top. Using a
     hardcoded dark here is what made the first light-theme render unreadable
     and looked exactly like a contrast failure in the row. */
  body { margin:0; background: var(--space); }
  #rail { background: var(--glass); }
  #rail { width: 340px; padding: 0 4px; }
  h2.basin-head { display:block; }
</style></head>
<body><div id="rail" role="list">
  <h2 class="basin-head">Northwest Pacific</h2>
  ${ROWS.slice(0, 4).map(row).join('')}
  <section class="basin-group" data-ended="true">
    <h2 class="basin-head">Finished</h2>
    ${ROWS.slice(4).map(row).join('')}
  </section>
</div></body></html>`;

const THEME = process.argv[2] === 'light' ? 'light' : 'dark';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 380, height: 900 }, deviceScaleFactor: 2 });
await page.setContent(html.replace('<html>', `<html data-theme="${THEME}">`));
await page.waitForTimeout(120);

const m = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.storm-row')) {
    const b = el.getBoundingClientRect();
    const name = el.querySelector('.row-name').getBoundingClientRect();
    const badge = el.querySelector('.row-badge').getBoundingClientRect();
    const dist = el.querySelector('.row-dist').getBoundingClientRect();
    const stamp = el.querySelector('.row-stamp')?.getBoundingClientRect() || null;
    const track = el.querySelector('.row-track')?.getBoundingClientRect() || null;
    out.push({
      name: el.querySelector('.row-name').textContent.trim(),
      h: +b.height.toFixed(1),
      leftName: +name.left.toFixed(1),
      leftDist: +dist.left.toFixed(1),
      leftTrack: track ? +track.left.toFixed(1) : null,
      rightBadge: +badge.right.toFixed(1),
      rightStamp: stamp ? +stamp.right.toFixed(1) : null,
      badgeW: +badge.width.toFixed(1),
      overflow: +(dist.right > (stamp ? stamp.left : b.right)) ,
    });
  }
  return out;
});

console.log('\n  row                              h    L-name L-dist L-trk   R-badge R-stamp  badgeW');
for (const r of m) {
  console.log(
    `  ${r.name.slice(0, 30).padEnd(30)} ${String(r.h).padStart(5)}  ` +
      `${String(r.leftName).padStart(6)} ${String(r.leftDist).padStart(6)} ${String(r.leftTrack ?? '—').padStart(6)}   ` +
      `${String(r.rightBadge).padStart(7)} ${String(r.rightStamp ?? '—').padStart(7)}  ${String(r.badgeW).padStart(6)}`
  );
}

const leftsAgree = new Set(m.map((r) => r.leftDist)).size === 1;
const namesAgree = new Set(m.map((r) => r.leftName)).size === 1;
const rightsAgree = new Set(m.map((r) => r.rightBadge)).size === 1;
const tracksAgree = new Set(m.filter((r) => r.leftTrack != null).map((r) => r.leftTrack)).size === 1;
const allTall = m.every((r) => r.h >= 44);

console.log('');
console.log(`  left column (name)      ${namesAgree ? 'ALIGNED' : 'RAGGED'}`);
console.log(`  left column (figures)   ${leftsAgree && tracksAgree ? 'ALIGNED' : 'RAGGED'}`);
console.log(`  right column (badge)    ${rightsAgree ? 'ALIGNED' : 'RAGGED'}`);
console.log(`  every row >= 44px       ${allTall ? 'YES' : 'NO'}`);
console.log(`  tallest row             ${Math.max(...m.map((r) => r.h))}px`);
console.log(`  total list height       ${m.reduce((a, r) => a + r.h, 0).toFixed(0)}px for ${m.length} rows`);

await page.screenshot({ path: `/tmp/row-${THEME}.png`, fullPage: true });
console.log(`\n  ${THEME} shot: /tmp/row-${THEME}.png\n`);
await browser.close();
