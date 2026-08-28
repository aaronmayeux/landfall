#!/usr/bin/env node
/**
 * seasons-row-check.mjs — the roster row's COLUMNS, measured in a browser.
 *
 *   bash tools/with-server.sh node tools/seasons-row-check.mjs
 *
 * ==> IT EXISTS BECAUSE THE THING THAT WAS WRONG IS INVISIBLE TO EVERY OTHER
 * CHECK HERE. <== The badge column shipped jagged: `auto` grid tracks are
 * sized per ROW, and every row in this list is its own grid, so a row reading
 * `Jul 4 – Jul 7` gave its date column 68px and one reading `Sep 17 – Sep 28`
 * gave it 101px — which slid the badge 33px sideways between one line and the
 * next. The markup was identical, the classes were all defined, the type was
 * on the scale, and 130 board assertions passed. Only geometry says it, and
 * only a browser has geometry.
 *
 * ==> AND IT IS A CHECK RATHER THAN A PREVIEW BECAUSE THE FIX IS A NUMBER.
 * <== The two right-hand tracks are fixed at 6ch and 15ch, chosen from measured
 * strings plus headroom. A track a few pixels short does not ellipse — it
 * widens, and the jaggedness comes straight back. This is what notices.
 *
 * It renders the real `seasons.css` against the real tokens, with the real
 * markup function, so there is no fixture to drift (the lesson of
 * `tools/drawer-head-harness.html`). What it CANNOT judge is whether the
 * result reads well, which is glass.
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const URL = `http://127.0.0.1:${PORT}/tools/seasons-row-harness.html`;

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };

const browser = await chromium.launch();
try {
  for (const [label, width] of [['narrow (two lines)', 390], ['wide (one line)', 720]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    ok(`${label}: the harness renders without throwing`, errs.length === 0);

    const cols = await page.$$eval('.seasons-row', (rows) => rows.map((r) => ({
      badge: r.querySelector('.row-badge')?.getBoundingClientRect().left ?? null,
      badgeRight: r.querySelector('.row-badge')?.getBoundingClientRect().right ?? null,
      dateRight: r.querySelector('.seasons-when')?.getBoundingClientRect().right ?? null,
      text: r.querySelector('.row-badge')?.textContent.trim(),
    })));

    ok(`${label}: every row rendered a badge`,
      cols.length > 3 && cols.every((c) => c.badge !== null));

    const spread = (k) => Math.max(...cols.map((c) => c[k])) - Math.min(...cols.map((c) => c[k]));

    /* ==> ONE PIXEL, NOT ZERO. <== Sub-pixel layout is real; a whole pixel of
     * drift is not visible and a fixed track cannot produce more than rounding.
     * The bug this replaces was 33px. */
    ok(`${label}: the badges share a left edge (spread ${spread('badge').toFixed(2)}px, was 33)`,
      spread('badge') <= 1);
    ok(`${label}: and a right edge, so the track is fixed rather than fitted (spread ${spread('badgeRight').toFixed(2)}px)`,
      spread('badgeRight') <= 1);
    ok(`${label}: the dates end flush (spread ${spread('dateRight').toFixed(2)}px)`,
      spread('dateRight') <= 1);

    /* ==> AND NOTHING OVERFLOWED ITS TRACK, WHICH IS THE FAILURE THE HEADROOM
     * EXISTS FOR. <== A badge wider than its column does not ellipse, it
     * spills over the dates beside it.
     *
     * ==> `scrollWidth` DOES NOT ANSWER THIS AND THE FIRST VERSION USED IT.
     * <== On a box whose overflow is visible the browser clamps `scrollWidth`
     * to the padding box, so a badge spilling 4px reported no overflow at all
     * and a deliberately-too-narrow track passed. The content width has to be
     * asked for directly: `max-content` on a copy of the box, compared with
     * what the track actually gave it. */
    for (const sel of ['.row-badge', '.seasons-row-meta']) {
      const over = await page.$$eval('.seasons-row', (rows, s2) => rows.map((r) => {
        const el = r.querySelector(s2);
        if (!el) return null;
        const had = el.style.width;
        el.style.width = 'max-content';
        const need = el.getBoundingClientRect().width;
        el.style.width = had;
        const got = el.getBoundingClientRect().width;
        return need > got + 0.5 ? `${el.textContent.trim()} needs ${need.toFixed(0)} got ${got.toFixed(0)}` : null;
      }).filter(Boolean), sel);
      /* ==> THE DATE COLUMN NEEDS THIS AS MUCH AS THE BADGE DOES, AND IT WAS
       * MISSING. <== The meta block is pushed to the end of its track, so
       * content too wide for it overflows to the LEFT, under the badge — every
       * right edge stays perfectly aligned while the row is visibly broken.
       * A mutation narrowing that track passed everything else here. */
      ok(`${label}: nothing overflows the ${sel} track${over.length ? ` (${over.join('; ')})` : ''}`,
        over.length === 0);
    }

    /* ==> THE CHEVRON'S HIT BOX, MEASURED, BECAUSE THIS MARKUP HAS FORM.
     * §57.22b, §13. <== Step 7 added a per-row `<button>`, glass reported
     * every tap target in this drawer misbehaving, and the whole step was
     * reverted with the cause never found. The row was rebuilt and cleared on
     * glass, so the chevron is now the narrowest remaining suspect — and this
     * tool did not exist when it first shipped. Three things a suite cannot
     * see and only geometry can.
     *
     * The GLYPH is 8px; the thing a thumb lands on must be 44. */
    const chev = await page.$$eval('.seasons-row', (rows) => rows.map((r) => {
      const btn = r.querySelector('.seasons-open');
      const label = r.querySelector('.seasons-check');
      if (!btn || !label) return null;
      const b = btn.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      const row = r.getBoundingClientRect();
      return {
        w: b.width,
        h: b.height,
        /* Positive means a gap; negative means the two press targets share
         * pixels, and a thumb on the overlap gets whichever the browser hands
         * it. That is exactly what "does something I don't intend" looks
         * like. */
        gap: b.left - l.right,
        /* The button must not hang off the end of its own row. */
        spill: b.right - row.right,
        inRow: b.top >= row.top - 0.5 && b.bottom <= row.bottom + 0.5,
      };
    }).filter(Boolean));

    ok(`${label}: every row has a chevron`, chev.length > 3);

    const touch = await page.evaluate(() => parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--touch-target')
    ));
    ok(`${label}: --touch-target resolves to a real number (${touch})`,
      Number.isFinite(touch) && touch >= 44);

    const smallest = Math.min(...chev.map((c) => Math.min(c.w, c.h)));
    ok(`${label}: every open button meets the touch minimum on both axes `
      + `(smallest side ${smallest.toFixed(1)}px, floor ${touch})`,
    smallest >= touch - 0.5);

    /* ==> AND SO DOES THE TICK BOX, WHICH IS THE ONE THAT SHRANK. §57.22b.
     * <== The label used to be the whole row and is now just the box; a rule
     * that only capped the button would let it collapse to the 18px tick
     * inside it and nobody would notice until a thumb missed. */
    const boxes = await page.$$eval('.seasons-row .seasons-check', (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return Math.min(r.width, r.height);
    }));
    ok(`${label}: every row has a tick box`, boxes.length > 3);
    ok(`${label}: and each one still meets the touch minimum `
      + `(smallest ${Math.min(...boxes).toFixed(1)}px, floor ${touch})`,
    Math.min(...boxes) >= touch - 0.5);

    /* ==> IT MUST NOT OVERLAP THE LABEL BESIDE IT. <== The label ticks the
     * storm and the chevron opens it; a shared pixel column is two actions
     * fighting over one thumb, and the loser is silent. */
    const worstGap = Math.min(...chev.map((c) => c.gap));
    ok(`${label}: no chevron overlaps the row's label (closest ${worstGap.toFixed(1)}px)`,
      worstGap >= 0);

    /* ==> AND IT MUST NOT WRAP ONTO THE NEXT LINE. <== Without the row's flex
     * rule the button drops under the name on a narrow phone, which puts a
     * 44px target in the middle of the text below it. */
    ok(`${label}: every chevron sits on its own row's line, not the next one`,
      chev.every((c) => c.inRow));
    const worstSpill = Math.max(...chev.map((c) => c.spill));
    ok(`${label}: nothing hangs off the end of the row (${worstSpill.toFixed(1)}px)`,
      worstSpill <= 0.5);

    /* The row bleeds past the scroller's padding to the drawer's own edge. */
    const bleed = await page.$$eval('.seasons-row', (rows) => {
      const host = document.querySelector('.drawer-body');
      const h = host.getBoundingClientRect();
      const r = rows[0].getBoundingClientRect();
      return { left: r.left - h.left, right: h.right - r.right };
    });
    ok(`${label}: the row runs to the scroller's own edge (${bleed.left.toFixed(1)}px / ${bleed.right.toFixed(1)}px)`,
      Math.abs(bleed.left) <= 1 && Math.abs(bleed.right) <= 1);

    /* The layout the width is supposed to produce. Two lines below the
     * container breakpoint, one above it — measured, not assumed. */
    const lines = await page.$eval('.seasons-row .seasons-row-text', (el) => {
      const name = el.querySelector('.seasons-name').getBoundingClientRect();
      const meta = el.querySelector('.seasons-row-meta').getBoundingClientRect();
      return meta.top >= name.bottom - 1 ? 2 : 1;
    });
    ok(`${label}: lays out as expected`, lines === (width < 600 ? 2 : 1));

    /* ==> THE MARKS AND THE TEXT SIT ON ONE LINE. <== Aaron on glass,
     * 2026-08-28: the box, the dot and the name were not centred with each
     * other. The cause was a grid rule nothing here was looking for — an
     * EMPTY row still takes its gap, so the permanently-declared `near` row
     * left a dead `--space-base` under the text and `align-items: center`
     * duly centred the block including the dead space, putting the text 6px
     * high while every mark beside it sat true.
     *
     * ==> IT IS MEASURED AGAINST THE TEXT RATHER THAN AGAINST THE ROW. <==
     * The box, the dot and the chevron were all at the row's exact centre
     * while it was broken — asserting THEY are centred would have passed on
     * the bug. What was wrong is the relationship, so that is what is asserted.
     *
     * ==> ONLY ON THE ONE-LINE LAYOUT. <== On two lines the name genuinely
     * sits above centre because it is the first of two lines, and the dot is
     * centred on the block on purpose (`seasons.css` says so where it says
     * `margin-top: 0`). There is no single line to share there. */
    if (lines === 1) {
      const centres = await page.$eval('.seasons-row', (r) => {
        const mid = (sel) => {
          const b = r.querySelector(sel)?.getBoundingClientRect();
          return b ? b.top + b.height / 2 : null;
        };
        return {
          box: mid('.check-box'),
          dot: mid('.row-swatch'),
          name: mid('.seasons-name'),
          chev: mid('.seasons-open-chevron'),
        };
      });
      const off = (k) => Math.abs(centres[k] - centres.name);
      /* ==> 1.5px, AND THE NUMBER IS NOT ARBITRARY. <== The bug was 6px. Text
       * centres move by fractions of a pixel with the font's own metrics and
       * a whole pixel of that is invisible; anything the eye can read as
       * "not on the same line" is several. A tighter bound would go red on a
       * font substitution rather than on a regression. */
      for (const k of ['box', 'dot', 'chev']) {
        ok(`${label}: the ${k} shares the name's centre line (${off(k).toFixed(2)}px, was 6)`,
          centres[k] !== null && off(k) <= 1.5);
      }

      /* ==> AND THE TEXT BLOCK CARRIES NO DEAD SPACE UNDER IT. <== The
       * assertion above catches the symptom; this catches the cause, so a
       * future edit that re-declares the empty row fails as the thing it is
       * rather than as three mysterious offsets. One line of text, one line
       * of block. */
      const slack = await page.$eval('.seasons-row', (r) => {
        const block = r.querySelector('.seasons-row-text').getBoundingClientRect();
        const name = r.querySelector('.seasons-name').getBoundingClientRect();
        return block.height - name.height;
      });
      ok(`${label}: the text block is no taller than its one line (${slack.toFixed(2)}px slack, was 12)`,
        slack <= 1.5);
    }

    await page.close();
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} row-geometry assertions pass — the columns line up`);
console.log('  (whether the row READS well is glass)');
