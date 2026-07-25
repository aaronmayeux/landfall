/**
 * privacy-check.mjs — proves the §17 A5 privacy contract in a real browser.
 *
 * lib/telemetry.js promises that HOME COORDINATES NEVER LEAVE THE DEVICE.
 * That promise is worth exactly as much as the thing that checks it, because
 * it is the kind of promise that gets broken by accident: somebody adds a
 * useful-looking field, or spreads an object into a payload, and nothing
 * visibly changes. A code review catches that on a good day. This catches it
 * every day.
 *
 * WHAT IT DOES. Sets a home with real coordinates and a real street address,
 * forces an uncaught error, an unhandled rejection and a flush, INTERCEPTS
 * every POST the app makes to /api/beacon, and searches the raw bytes for the
 * coordinates at several precisions plus every component of the address.
 *
 * IT CHECKS ROUNDED AND TRUNCATED FORMS ON PURPOSE. "We only send it to one
 * decimal place" is the exact shape the contract forbids — a coarsened
 * coordinate is still a coordinate, and one decimal place is a ~11 km square
 * around somebody's house. Failing on `30.3` is the point, not overreach.
 *
 *   python3 -m http.server 8099 &
 *   node tools/privacy-check.mjs
 *
 * Exits non-zero on any leak, so it can gate a deploy.
 * PLAYWRIGHT_CHROMIUM_PATH overrides the browser binary (see headless-check).
 */

import { chromium } from 'playwright';

const URL = process.env.LANDFALL_URL || 'http://127.0.0.1:8099/index.html';
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/* A real address with no round numbers in it — every digit below is a needle
 * that must not appear in a payload. */
const HOME = {
  lon: -91.00107,
  lat: 30.334537,
  label: '18642 Magnolia Estates Road, Prairieville, Louisiana 70769',
};

const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

/* Intercept rather than let it 501 against the static server: we want the
 * BYTES, and we want them whether or not a relay is running. */
const bodies = [];
await page.route('**/api/beacon', async (route) => {
  bodies.push(route.request().postData() || '');
  await route.fulfill({ status: 204, body: '' });
});

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(
  (h) =>
    localStorage.setItem(
      'landfall.home',
      JSON.stringify({ ...h, source: 'address', setAt: Date.now() })
    ),
  HOME
);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);

/* Force one of each event kind telemetry.js knows about. */
await page.evaluate(() => {
  setTimeout(() => {
    throw new Error('forced test error');
  }, 0);
});
await page.evaluate(() => {
  Promise.reject(new Error('forced test rejection'));
});
await page.waitForTimeout(500);

/* Drive a flush the way the app does — hidden, not unload (mobile Safari). */
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(800);

const all = bodies.join('\n');

console.log(`beacons captured: ${bodies.length}`);
console.log('--- payload ---');
console.log(all.slice(0, 1500) || '(none)');

if (!bodies.length) {
  console.log('\n⚠ NO BEACONS CAPTURED — this proves nothing.');
  console.log('  Telemetry may be sampled off, or the forced errors did not fire.');
  await browser.close();
  process.exit(2);
}

/* Substring needles. Every one of these is long enough that an incidental
 * match is not credible. */
const needles = [
  ['exact lon', String(HOME.lon)],
  ['exact lat', String(HOME.lat)],
  ['lon 4dp', HOME.lon.toFixed(4)],
  ['lat 4dp', HOME.lat.toFixed(4)],
  ['lon 2dp', HOME.lon.toFixed(2)],
  ['lat 2dp', HOME.lat.toFixed(2)],
  ['lon 1dp', HOME.lon.toFixed(1)],
  ['lat 1dp', HOME.lat.toFixed(1)],
  ['street number', '18642'],
  ['street name', 'Magnolia'],
  ['city', 'Prairieville'],
  ['state', 'Louisiana'],
  ['postcode', '70769'],
  ['home storage key', 'landfall.home'],
  ['a lat field', '"lat"'],
  ['a lon field', '"lon"'],
];

let leaks = 0;
console.log('\n--- privacy assertions ---');
for (const [name, needle] of needles) {
  if (all.includes(needle)) {
    leaks += 1;
    console.log(`  ✗ LEAK: ${name} ("${needle}") appears in a beacon`);
  } else {
    console.log(`  ✓ no ${name}`);
  }
}

/* ==> WHOLE-DEGREE COORDINATES ARE CHECKED STRUCTURALLY, NOT BY TEXT. <==
 * Math.trunc(30.334537) is 30, and "30" occurs in almost any JSON — it first
 * flagged here on `(:311:30)`, the line:column of a stack frame, and then
 * again on a tightened regex, because `:30)` really is colon-prefixed. No
 * amount of pattern sharpening separates a JSON number from a number inside
 * a string, so the check stops guessing and PARSES.
 *
 * The concern is real and stays: a whole-degree coordinate is still a
 * coordinate (a ~110 km square), and this contract forbids coarsening
 * exactly as much as it forbids precision. What changes is the method —
 * every NUMBER in the parsed payload is walked, and any number within a
 * degree of home fails. Strings are searched separately by the needles
 * above, so a coordinate hidden in a message is still caught.
 *
 * As a bonus this is a stronger assertion than the one it replaces: it
 * catches ANY numeric value near home, not just the two rounded forms
 * somebody thought to list. */
function numbersIn(value, out = []) {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out);
  return out;
}

const parsed = [];
for (const body of bodies) {
  try {
    parsed.push(JSON.parse(body));
  } catch {
    leaks += 1;
    console.log('  ✗ a beacon body was not valid JSON — cannot verify it');
  }
}

const nums = parsed.flatMap((b) => numbersIn(b));
const nearHome = nums.filter(
  (n) => Math.abs(n - HOME.lat) < 1 || Math.abs(n - HOME.lon) < 1
);
if (nearHome.length) {
  leaks += 1;
  console.log(`  ✗ LEAK: numeric value(s) within 1° of home: ${nearHome.join(', ')}`);
} else {
  console.log(`  ✓ no numeric value within 1° of home (${nums.length} numbers checked)`);
}

console.log(
  leaks === 0
    ? '\n✓ PRIVACY CONTRACT HELD'
    : `\n✗ PRIVACY CONTRACT VIOLATED — ${leaks} leak(s). Do not deploy.`
);

await browser.close();
process.exit(leaks === 0 ? 0 : 1);
