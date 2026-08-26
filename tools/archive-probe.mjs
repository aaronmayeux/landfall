/**
 * archive-probe.mjs — open the archive in a real browser, tick a storm, and
 * report what actually happened. Diagnostic, not a gate.
 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8099/';
const errors = [];
const logs = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`);
  if (/seasons/.test(r.url())) logs.push(`SEASONS ${r.status()} ${r.url()}`);
});
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${t}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// Find and press the Past Storms door.
/* The doors live inside drawers. Open the storms drawer first. */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#controls button')]
    .find((x) => /storm list/i.test(x.getAttribute('aria-label') || ''));
  b?.click();
});
await page.waitForTimeout(1200);
let door = await page.$('.seasons-door');
if (!door) {
  const dump = await page.evaluate(() => ({
    controls: [...document.querySelectorAll('#controls button')].map((b) => b.className + '|' + (b.getAttribute('aria-label')||b.textContent||'').slice(0,30)),
    drawerOpen: document.querySelector('#drawer')?.getAttribute('data-open'),
    doors: document.querySelectorAll('.seasons-door').length,
  }));
  console.log('no door yet:', JSON.stringify(dump, null, 2));
}
  if (!door) { const st = await page.$$('.seasons-door'); console.log('doors on page:', st.length); }
console.log('door found:', Boolean(door));
if (door) { await door.click(); await page.waitForTimeout(6000); }

const state = await page.evaluate(() => {
  const clock = document.querySelector('.seasons-clock');
  const rows = document.querySelectorAll('[data-row]');
  const boxes = document.querySelectorAll('.seasons-row input[type="checkbox"], [data-row] input[type="checkbox"]');
  return {
    archiveOn: document.documentElement.getAttribute('data-seasons'),
    clockAttr: document.documentElement.getAttribute('data-seasons-clock'),
    clockExists: Boolean(clock),
    clockHidden: clock ? clock.hidden : null,
    playText: document.querySelector('.seasons-clock-play')?.textContent ?? null,
    barDetail: document.querySelector('.seasons-bar-detail')?.textContent ?? null,
    rowCount: rows.length,
    boxCount: boxes.length,
    rowsLi: document.querySelectorAll('li.seasons-row').length,
    firstRow: document.querySelector('li.seasons-row')?.innerText?.slice(0,60) || null,
    rowInputs: document.querySelectorAll('li.seasons-row input').length,
    rosterHtml: (document.querySelector('.seasons-roster, [class*=roster]')?.innerText || 'NO ROSTER EL').slice(0,300),
  };
});
console.log('after entering:', JSON.stringify(state, null, 2));

if (true) {
  await page.evaluate(() => {
    const b = document.querySelector('li.seasons-row input');
    b?.click();
  });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    clockAttr: document.documentElement.getAttribute('data-seasons-clock'),
    clockHidden: document.querySelector('.seasons-clock')?.hidden ?? null,
    playText: document.querySelector('.seasons-clock-play')?.textContent ?? null,
    date: document.querySelector('.seasons-clock-date')?.textContent ?? null,
    barDetail: document.querySelector('.seasons-bar-detail')?.textContent ?? null,
  }));
  console.log('after ticking one storm:', JSON.stringify(after, null, 2));
}

console.log('\npage errors:', errors.length);
for (const e of errors.slice(0, 8)) console.log('  ', e);
console.log('console errors/warnings:', logs.length);
for (const l of logs.slice(0, 12)) console.log('  ', l);

await browser.close();
