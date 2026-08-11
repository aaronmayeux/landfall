/**
 * drawer-scroll-check.mjs — the drawer opens at the top, every time.
 *
 * ==> THIS HAS TO BE A BROWSER CHECK AND CANNOT BE A UNIT TEST. <== Both facts
 * it asserts are facts about LAYOUT, and neither is observable from a string of
 * HTML:
 *
 *   1. `scrollTop = 0` on an element that cannot scroll is a silent no-op. It
 *      assigns a real property, throws nothing, and does nothing. The first cut
 *      of the fix reset `.drawer-view`, which is a flex column with no
 *      overflow — it would have passed any assertion about the code being
 *      present and changed nothing on a phone.
 *
 *   2. Whether the first line of content clears the title's fade is a question
 *      about pixels. `.drawer-body` masks its first --scroll-fade pixels to
 *      transparent; content has to start at or below that line. The home
 *      dashboard used to add the same padding a second time, which is what put
 *      a thumb of dead space above the storm's name.
 *
 * Run it with the static server up, in ONE shell command — a background server
 * does not survive between shell calls:
 *
 *     bash tools/with-server.sh node tools/drawer-scroll-check.mjs
 */

import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8099/';
/* The CI runner installs its own chromium and finds it on its own; the sandbox
 * has one preinstalled at a fixed path and cannot download another (browser
 * downloads are blocked by design). Same env var the other browser checks
 * read, so there is one way to point this at a binary. */
const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) pass++;
  else failures.push(msg);
};

const browser = await chromium.launch({ executablePath: EXE });
/* A phone, because that is the only viewport this question matters at — on a
 * desktop the drawer is tall enough that nothing overflows and nothing
 * scrolls. */
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
/* The basemap cannot load in this sandbox and is not what is under test. The
 * drawer is DOM and renders regardless. */
await page.waitForSelector('#drawer', { state: 'attached', timeout: 20000 });
await page.waitForFunction(() => !!window.__landfall?.drawer, null, { timeout: 20000 });

/** Open one drawer view through the app's own navigation, never by poking the
 *  DOM — the reset lives in `enter()`, so a test that shows the host directly
 *  would bypass the thing it is checking. */
async function openView(id) {
  await page.evaluate((v) => window.__landfall?.drawer?.go(v), id);
  await page.waitForTimeout(120);
}

const hasHook = await page.evaluate(() => !!window.__landfall?.drawer?.go);
ok(hasHook, 'the app exposes its drawer for driving (window.__landfall.drawer)');

if (hasHook) {
  for (const id of ['home', 'layers', 'settings']) {
    await openView(id);

    const body = await page.$(`.drawer-view[data-view="${id}"] .drawer-body`);
    if (!body) {
      failures.push(`${id}: no .drawer-body found`);
      continue;
    }

    /* Scroll it well down, leave, come back. This is exactly the sequence a
     * reader performs and exactly the one that used to fail: the host is
     * hidden rather than destroyed, so the offset survives. */
    await body.evaluate((el) => { el.scrollTop = 9999; });
    await page.waitForTimeout(60);
    const scrolled = await body.evaluate((el) => el.scrollTop);

    await openView(id === 'home' ? 'storms' : 'home');
    await openView(id);

    const after = await page.evaluate(
      (v) => document.querySelector(`.drawer-view[data-view="${v}"] .drawer-body`).scrollTop,
      id
    );

    /* A body with nothing to scroll cannot prove anything — say so rather than
     * passing on a vacuous zero. */
    if (scrolled === 0) {
      ok(true, '');
      console.log(`  note  ${id}: body does not overflow at this size, nothing to prove`);
    } else {
      ok(after === 0, `${id}: reopens at the top (was ${scrolled}, reopened at ${after})`);
    }
  }

  /* --- and the first line of content clears the fade, without overpaying --- */
  await openView('home');
  const geom = await page.evaluate(() => {
    const body = document.querySelector('.drawer-view[data-view="home"] .drawer-body');
    if (!body) return null;
    const fade = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--scroll-fade')
    );
    const first = body.querySelector('.home-nav-text, .home-sect, .home-lede, .detail-soft');
    return {
      fade,
      padTop: parseFloat(getComputedStyle(body).paddingTop),
      /* `.home-dash` IS `.drawer-body` — one element carrying both classes —
       * so there is no nested wrapper to double the padding and never was.
       * Recorded so a future reader does not go looking for one. */
      sameElement: body.classList.contains('home-dash'),
      offset: first
        ? first.getBoundingClientRect().top - body.getBoundingClientRect().top
        : null,
    };
  });

  if (!geom) {
    failures.push('could not measure the home body');
  } else {
    ok(geom.sameElement, 'the home body and the scrolling body are one element');

    /* ==> THE PADDING MUST EQUAL THE MASK, EXACTLY. <== Both directions are
     * bugs and they are different bugs:
     *
     *   SHORTER  the first line of content sits inside the gradient and
     *            renders half-faded. Measured at 8px against an 18px fade
     *            while trying to remove "dead space" that was never there —
     *            the storm's name came out ghosted.
     *   LONGER   dead space above the name, which is what this pass is for.
     *
     * There is exactly one right answer and it is the mask's own length. */
    ok(
      Math.abs(geom.padTop - geom.fade) < 0.5,
      `the body pads by exactly the fade (padding ${geom.padTop}px, fade ${geom.fade}px)`
    );
    ok(
      geom.offset != null && geom.offset >= geom.fade - 0.5,
      `so the first content clears it (starts at ${geom.offset}px)`
    );
    /* ==> THE SLACK IS FOR MARGIN COLLAPSING, NOT FOR PADDING. <== The first
     * section sets `padding-top: 0`, which lets its own first child's margin
     * collapse THROUGH it — a leading <p> contributes its 8px and the section
     * box moves down with it. That is the paragraph's spacing, not the
     * panel's, and it does not apply in the ordinary case where the first
     * child is the storm stepper's grid. Anything beyond it is a section
     * paying for the fade a second time, which is what this bounds. */
    ok(
      geom.offset != null && geom.offset <= geom.fade + 10,
      `and no section adds padding on top of it (starts at ${geom.offset}px, fade ${geom.fade}px)`
    );
  }
}

await browser.close();

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (pixels, not markup — this is the part a string assertion cannot see)');
process.exit(failures.length ? 1 : 0);
