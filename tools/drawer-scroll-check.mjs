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

/**
 * ==> A HOME IS SEEDED BEFORE THE FIRST BYTE LOADS, AND WITHOUT IT THIS WHOLE
 * FILE WAS CHECKING THE WRONG SCREEN. <== With no home stored, the Home drawer
 * renders `noHomeHtml` — a short "Set your home" prompt that cannot overflow at
 * any viewport. Every scroll assertion below therefore hit its own
 * "does not overflow, nothing to prove" branch and reported a pass. That is how
 * a real scroll bug shipped past a check whose entire job was scrolling.
 *
 * `addInitScript` runs before the page's own scripts, which matters: `getHome`
 * caches on first read, so writing the key after boot would be ignored until
 * something invalidated it.
 *
 * New Orleans, because the dashboard's quiet state still names distances and
 * the value should be somewhere storms actually go.
 */
await page.addInitScript(() => {
  localStorage.setItem(
    'landfall.home',
    JSON.stringify({
      lon: -90.0715,
      lat: 29.9511,
      label: 'New Orleans, LA',
      source: 'pin',
      setAt: new Date().toISOString(),
    })
  );
});

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

  /* --- and nothing pulls the view back down after the reset --------------- */

  /**
   * ==> THE RESET WAS NEVER THE BUG. FOCUS WAS. <== The Home drawer opened
   * halfway down for weeks with a correct reset sitting right above the cause:
   * `enter()` sets `scrollTop = 0` and then moves focus, and focusing an
   * element scrolls it into view. Home nominated its Edit-home button, which is
   * the LAST section of the dashboard, so every open reset to the top and was
   * dragged straight back to the bottom on the same frame.
   *
   * ==> "NEVER FOCUS INSIDE THE BODY" WAS THE FIRST SHAPE OF THIS CHECK AND IT
   * WAS TOO STRICT. <== Measured on this viewport (390x844, body 424px tall):
   * Layers focuses its first segmented control at 80px down, Settings focuses
   * the CHECKED segment at 309px down. Both are inside the scrolling body and
   * both are perfectly fine — they are on screen without scrolling, which is
   * what a first stop has to be. A rule that banned them would have been
   * failing two views that work.
   *
   * SO THE RULE IS REACHABILITY, NOT LOCATION: after entry the body must be at
   * the top AND the focused control must be visible there. That is exactly what
   * broke and exactly what cannot be checked from markup.
   *
   * SETTINGS IS THE ONE TO WATCH. Its target is the segment that happens to be
   * checked, so it moves with the reader's own preferences — 309 of 424px today
   * is 73% of the way down the visible area, and one more section above it puts
   * it under the fold. `ui/drawer.js` focuses with `preventScroll`, so the view
   * would stay at the top and the focus ring would go off screen instead. This
   * prints the number every run so the margin is visible before it runs out.
   */
  for (const id of ['home', 'layers', 'settings', 'storms']) {
    await openView(id);

    const m = await page.evaluate(() => {
      const el = document.activeElement;
      const bodyEl = document.querySelector(
        '.drawer-view[data-active="true"] .drawer-body'
      );
      if (!bodyEl) return null;
      if (!el || el === document.body) {
        return { focused: 'nothing', scrollTop: bodyEl.scrollTop };
      }
      const owner = el.closest('.drawer-body, .detail-body');
      const r = el.getBoundingClientRect();
      const b = bodyEl.getBoundingClientRect();
      return {
        focused: el.className || el.tagName,
        inBody: !!owner,
        scrollTop: bodyEl.scrollTop,
        clientH: Math.round(bodyEl.clientHeight),
        /* Distance from the top of the VISIBLE body to the top of the control.
         * Negative means above the fold, past clientH means below it. */
        top: Math.round(r.top - b.top),
        bottom: Math.round(r.bottom - b.top),
      };
    });

    if (!m) {
      failures.push(`${id}: no active .drawer-body to measure focus against`);
      continue;
    }

    ok(m.focused !== 'nothing', `${id}: entry puts focus somewhere (not on <body>)`);

    /* The reset held — focusing did not drag the panel down. This is the
     * assertion the shipped bug would have failed outright. */
    ok(m.scrollTop === 0, `${id}: entry focus leaves the body at the top (scrollTop ${m.scrollTop})`);

    if (m.inBody) {
      ok(
        m.top >= 0 && m.bottom <= m.clientH,
        `${id}: the focused control is on screen without scrolling ` +
          `(${m.top}–${m.bottom} of ${m.clientH})`
      );
      const headroom = m.clientH - m.bottom;
      console.log(
        `  note  ${id}: focus is ${m.top}px into a ${m.clientH}px body — ${headroom}px of headroom left`
      );
    } else {
      console.log(`  note  ${id}: focus is in the drawer chrome, which cannot scroll`);
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
    /* `.home-nav-text` led this list until the one-header rewrite (7da75e3)
     * deleted it. The three that remain are live and plentiful — .home-sect
     * ×11, .home-lede ×4, .detail-soft ×46 — so the measurement never broke,
     * which is exactly why nobody noticed. A dead name at the FRONT of a
     * fallback list is the cheapest possible way for this file to start
     * measuring nothing: thin the survivors out and `first` goes null, and the
     * two assertions below fail on a null rather than on a fact. */
    const first = body.querySelector('.home-sect, .home-lede, .detail-soft');
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

/* ---------------------------------------------------------------------------
 * THE SHORT WINDOW — the only pass here that can actually catch the bug
 *
 * ==> EVERYTHING ABOVE PASSED WHILE THE BUG WAS SHIPPED, AND THIS IS WHY. <==
 * On a 390x844 phone with no storms in the feed, the Home dashboard is 424px of
 * content in a 424px body. Nothing overflows, so the Edit-home button sits at
 * 172px — comfortably on screen — and both the scroll assertion and the
 * reachability assertion pass with the broken focus target in place. Measured:
 * reverting the fix changed nothing above this line. A check that cannot fail
 * is worse than no check, so it gets a viewport where it can.
 *
 * 390x420. NOT A PHONE, AND NOT PRETENDING TO BE — it is a small desktop
 * browser window, which is a real thing people have, and it is narrow enough to
 * stay in the bottom-sheet layout rather than flipping to the wide side rail at
 * 720px. There the body is 170px tall against 240px of content, and Edit-home
 * lands at 172px: two pixels past the fold. That is the whole bug, reproduced
 * without inventing a single byte of storm data.
 *
 * THE SANDBOX IS WHY THIS SHAPE IS NEEDED AT ALL. With a live feed the
 * dashboard is several screens long and the button is far below the fold on any
 * viewport. The CI runner has open internet and would see that; this box does
 * not, and a check that only works where the network does is a check that never
 * runs while you are building.
 * ------------------------------------------------------------------------- */

{
  const short = await browser.newPage({ viewport: { width: 390, height: 420 } });
  short.on('pageerror', (e) => failures.push(`short-window page error: ${e.message}`));
  await short.addInitScript(() => {
    localStorage.setItem(
      'landfall.home',
      JSON.stringify({
        lon: -90.0715,
        lat: 29.9511,
        label: 'New Orleans, LA',
        source: 'pin',
        setAt: new Date().toISOString(),
      })
    );
  });
  await short.goto(URL, { waitUntil: 'domcontentloaded' });
  await short.waitForFunction(() => !!window.__landfall?.drawer, null, { timeout: 20000 });
  await short.evaluate(() => window.__landfall?.drawer?.go('home'));
  await short.waitForTimeout(150);

  const m = await short.evaluate(() => {
    const bodyEl = document.querySelector('.drawer-view[data-active="true"] .drawer-body');
    if (!bodyEl) return null;
    const el = document.activeElement;
    const r = el?.getBoundingClientRect();
    const b = bodyEl.getBoundingClientRect();
    return {
      overflows: bodyEl.scrollHeight > bodyEl.clientHeight,
      scrollTop: Math.round(bodyEl.scrollTop),
      clientH: Math.round(bodyEl.clientHeight),
      scrollH: Math.round(bodyEl.scrollHeight),
      focused: el?.className || el?.tagName || 'nothing',
      inBody: !!el?.closest?.('.drawer-body, .detail-body'),
      bottom: r ? Math.round(r.bottom - b.top) : null,
    };
  });

  if (!m) {
    failures.push('short window: no active .drawer-body to measure');
  } else {
    /* If this ever stops overflowing, the pass below has gone vacuous and the
     * viewport needs shrinking again — say so rather than passing quietly. */
    ok(
      m.overflows,
      `short window: the home body overflows, so there is something to prove ` +
        `(${m.scrollH}px of content in ${m.clientH}px)`
    );
    ok(
      m.scrollTop === 0,
      `short window: home still opens at the top (scrollTop ${m.scrollTop})`
    );
    ok(
      !m.inBody || (m.bottom != null && m.bottom <= m.clientH),
      `short window: entry focus is reachable without scrolling ` +
        `(${m.focused} ends at ${m.bottom} of ${m.clientH})`
    );
    console.log(
      `  note  short window: ${m.scrollH}px of content in ${m.clientH}px, ` +
        `focus on ${m.focused}${m.inBody ? ` ending at ${m.bottom}px` : ' (chrome)'}`
    );
  }
  await short.close();
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
