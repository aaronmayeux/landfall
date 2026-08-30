#!/usr/bin/env node
/**
 * season-figure-check.mjs — the merged figure row, measured in a real browser.
 * SPEC-SEASONS-BUILD.md §57.57b.
 *
 *   bash tools/with-server.sh node tools/season-figure-check.mjs
 *
 * ==> EVERY OTHER ASSERTION ABOUT THIS ROW COMPARES STRINGS THE BROWSER MAY
 * NEVER FINISH DRAWING. <== `NOW.md` records the landfall sort reading
 * `18 of 3` on a phone while `textContent` said `18 of 31` — a 2.6em column
 * with `overflow: hidden` threw the last character away at paint, and no node
 * assertion in the repo could see it. The lesson written down that day was
 * that anywhere a number shares a fixed-width column with new content, the
 * assertion has to be a MEASUREMENT.
 *
 * §57.57b is exactly that situation at a bigger size. A figure now shares one
 * grid cell with a rank sentence and an SVG, inside a `.detail-vitals` list
 * that is `grid-template-columns: auto 1fr` and whose OTHER rows still take
 * two columns. Three things can go wrong and none of them throws:
 *
 *   1. the rank sentence or the bar overflows its cell and is clipped
 *   2. a cell spanning `1 / -1` widens the `auto` label column, pushing every
 *      unmarked row's value off to the right
 *   3. the bar and the axis labels under it stop being the same width, which
 *      is the one thing §57.64c's decision to keep the labels in HTML rests on
 *
 * ==> IT IS NOT IN THE PRE-PUSH HOOK. <== The hook already runs four browser
 * checks and this one is about a single section of a single panel. Run it by
 * hand after any change to the figure row, the bar, or `.detail-vitals`.
 *
 * Exit: 0 clean, 1 on any failure.
 */

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const URL = `http://127.0.0.1:${PORT}/tools/season-figure-harness.html`;

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };

const browser = await chromium.launch();
try {
  /* ==> BOTH ENDS OF THE PANEL'S REAL RANGE. <== §57.64c: this drawer runs
   * from 320px to 719px before the wide layout pins it to
   * `clamp(340px, 36vw, 440px)`. 390 is the phone it was judged at; 320 is the
   * narrowest screen it has to survive, and it is where a clip would appear
   * first. */
  for (const [label, width] of [['narrowest (320px)', 320], ['phone (390px)', 390], ['wide (719px)', 719]]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
    ok(`${label}: the harness renders without throwing`, errs.length === 0);

    const seen = await page.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      const cells = [...document.querySelectorAll('.detail-vitals dd')].map((dd) => ({
        marked: dd.classList.contains('has-rank'),
        overflowX: dd.scrollWidth - dd.clientWidth,
        ...box(dd),
      }));
      /* ==> GROUPED BY LIST, BECAUSE EACH SECTION IS ITS OWN GRID. <== The
       * panel draws four `<dl class="detail-vitals">`, one per section, and
       * `grid-template-columns: auto 1fr` sizes each one from its own labels.
       * `Fastest strengthening` and `Reached` are SUPPOSED to sit at different
       * widths; the first version of this check compared every label on the
       * page and reported 38.20px of drift on all three viewports, which was
       * the assertion being wrong rather than the layout. */
      const lists = [...document.querySelectorAll('.detail-vitals')].map((dl) => ({
        ...box(dl),
        labels: [...dl.querySelectorAll('dt')].map((dt) => {
          /* ==> THE TEXT'S OWN WIDTH, NOT THE CELL'S. <== `scrollWidth`
           * clamps to `clientWidth` when the content fits, so it cannot tell a
           * track sized to its label from a track a bar pushed wider. A
           * `Range` over the text node measures the glyphs. */
          const r = document.createRange();
          r.selectNodeContents(dt);
          return {
            text: dt.textContent.trim(),
            textWidth: r.getBoundingClientRect().width,
            overflowX: dt.scrollWidth - dt.clientWidth,
            ...box(dt),
          };
        }),
        cells: [...dl.querySelectorAll('dd')].map((dd) => ({
          marked: dd.classList.contains('has-rank'),
          ...box(dd),
        })),
      }));
      const labels = lists.flatMap((l) => l.labels);
      const ranks = [...document.querySelectorAll('.detail-figure-rank')].map((s) => ({
        text: s.textContent.trim(),
        overflowX: s.scrollWidth - s.clientWidth,
        ...box(s),
      }));
      const bars = [...document.querySelectorAll('.season-spine')].map((d) => ({
        plot: box(d.querySelector('.season-spine-plot')),
        axis: box(d.querySelector('.season-spine-axis')),
        figure: d.querySelector('.season-spine-figure span'),
      })).map((b) => ({
        plot: b.plot,
        axis: b.axis,
        figureLeft: b.figure ? b.figure.getBoundingClientRect().left : null,
        figureRight: b.figure ? b.figure.getBoundingClientRect().right : null,
      }));
      /* ==> THE NUMBERED LANDFALL ROWS. <== §57.60. A badge in a fixed-width
       * grid column beside text that wraps is the `18 of 3` shape one step
       * later, and the two-digit case only exists on `NOEL 2007`. */
      const landfalls = [...document.querySelectorAll('.season-landfall')].map((li) => ({
        n: li.querySelector('.season-landfall-n')?.textContent.trim() ?? '',
        badge: box(li.querySelector('.season-landfall-n')),
        badgeH: li.querySelector('.season-landfall-n').getBoundingClientRect().height,
        badgeTop: li.querySelector('.season-landfall-n').getBoundingClientRect().top,
        detail: box(li.querySelector('.season-landfall-detail')),
        detailTop: li.querySelector('.season-landfall-detail').getBoundingClientRect().top,
        overflowX: li.scrollWidth - li.clientWidth,
        badgeOverflowX: (() => {
          const b = li.querySelector('.season-landfall-n');
          return b ? b.scrollWidth - b.clientWidth : 0;
        })(),
        row: box(li),
      }));
      const foot = document.querySelector('.season-detail-footnote');
      return {
        cells,
        labels,
        lists,
        ranks,
        bars,
        list: box(document.querySelector('.detail-vitals')),
        landfalls,
        foot: foot ? { ...box(foot), border: getComputedStyle(foot).borderTopWidth } : null,
      };
    });

    /* --- 1. nothing clips ------------------------------------------------ */

    /* ==> THE ONE THAT ACTUALLY BIT LAST TIME. <== A clipped rank would read as
     * a shorter, wrong sentence rather than as a broken one. */
    const clipped = seen.ranks.filter((r) => r.overflowX > 0.5);
    ok(`${label}: no rank sentence is clipped (${seen.ranks.length} checked, `
      + `worst overflow ${Math.max(0, ...seen.ranks.map((r) => r.overflowX)).toFixed(2)}px)`,
    clipped.length === 0);
    ok(`${label}: no value cell is clipped`,
      seen.cells.every((c) => c.overflowX <= 0.5));
    ok(`${label}: no label is clipped`,
      seen.labels.every((l) => l.overflowX <= 0.5));

    /* --- 2. a spanning cell must not move the label column --------------- */

    /* ==> THIS IS THE FAILURE NOBODY WOULD HAVE PREDICTED FROM THE MARKUP. <==
     * `grid-template-columns: auto 1fr` sizes the first track from its
     * contents, and a `grid-column: 1 / -1` item participates in the intrinsic
     * sizing of the tracks it spans. If a bar 300px wide ever pushed the
     * `auto` track out, EVERY unmarked row on the panel — dates, coordinates —
     * would have its value shoved right, on a panel where nothing about the
     * markup changed. */
    const spreads = seen.lists.map((l) => {
      const r = l.labels.map((x) => x.right);
      return Math.max(...r) - Math.min(...r);
    });
    ok(`${label}: within each section the label column is sized by the labels, `
      + `not by the bars (worst spread ${Math.max(...spreads).toFixed(2)}px)`,
    spreads.every((sp) => sp <= 1));

    /* ==> AND THE TRACK IS NO WIDER THAN ITS WIDEST LABEL NEEDS. <== This is
     * the failure the check is really watching for, and the spread above
     * cannot see it: if a bar pushed the `auto` track out, every label in that
     * section would move together and the spread would stay zero. Comparing
     * the track against the LONGEST LABEL'S OWN GLYPHS is the only measurement
     * that distinguishes the two.
     *
     * ==> THE FIRST VERSION OF THIS ASSERTED THE TRACK TOOK UNDER HALF THE
     * LIST, AND THAT WAS A GUESS THAT FIRED ON A REAL LAYOUT. <== At 320px
     * `Fastest strengthening` is 152.1px of a 302px list — 50.4%, because that
     * is simply how wide those two words are. It is pre-existing
     * `.detail-vitals` behaviour, nothing to do with the bar, and the row's
     * value cell spans the full width anyway now that it carries a mark. A
     * threshold nobody measured is the fluent wrong number with a viewport
     * under it. */
    const slack = seen.lists.map((l) => Math.max(...l.labels.map((x) => x.width))
      - Math.max(...l.labels.map((x) => x.textWidth)));
    ok(`${label}: and the track is sized to its widest label's glyphs, not to a `
      + `bar (worst slack ${Math.max(...slack).toFixed(2)}px)`,
    slack.every((sp) => sp <= 2));

    const marked = seen.cells.filter((c) => c.marked);
    const plain = seen.cells.filter((c) => !c.marked);
    ok(`${label}: seven cells carry a mark and the rest do not `
      + `(${marked.length} marked, ${plain.length} plain)`,
    marked.length === 7 && plain.length > 0);

    /* ==> A MARKED CELL TAKES THE WHOLE LIST AND A PLAIN ONE DOES NOT. <== If
     * the spanning rule ever stops matching, the bar is drawn in whatever the
     * longest label left over — under half the panel on
     * `Fastest strengthening` at 390px — and it still LOOKS like a bar. */
    ok(`${label}: every marked cell spans the full width of its own section`,
      seen.lists.every((l) => l.cells.filter((c) => c.marked)
        .every((c) => Math.abs(c.width - l.width) <= 1)));
    ok(`${label}: and every plain cell is still in the value column, narrower `
      + 'than its list',
    seen.lists.every((l) => l.cells.filter((c) => !c.marked)
      .every((c) => c.width < l.width - 1)));

    /* --- 3. the bar and its axis are the same width ---------------------- */

    /* ==> §57.64c's WHOLE ARGUMENT FOR KEEPING THE LABELS IN HTML RESTS ON
     * THIS. <== The mockup put them inside the SVG and scaled the box; these
     * are outside it and line up only because the two elements are the same
     * width. If that ever stops being true the end labels stop marking the
     * ends of the range and start being decoration. */
    ok(`${label}: seven bars drew`, seen.bars.length === 7);
    ok(`${label}: every bar and the axis under it share both edges`,
      seen.bars.every((b) => Math.abs(b.plot.left - b.axis.left) <= 1
        && Math.abs(b.plot.right - b.axis.right) <= 1));

    /* ==> AND THE STORM'S OWN FIGURE STAYS INSIDE THE PANEL. <== §57.64b pins
     * it to whichever end it is near rather than centring it, precisely
     * because a label centred on a mark at 2% hangs half of itself off the
     * left edge. Katrina exercises all three anchors on one panel. */
    const stray = seen.bars.filter((b) => b.figureLeft !== null
      && (b.figureLeft < seen.list.left - 1 || b.figureRight > seen.list.right + 1));
    ok(`${label}: no bar's own figure hangs off the panel (${stray.length} stray)`,
      stray.length === 0);

    /* --- 3b. the numbered landfall rows ---------------------------------- */

    /* ==> THIRTEEN ROWS ACROSS TWO STORMS, AND THE SECOND ONE IS WHY. <==
     * Katrina takes three landfalls and `NOEL 2007` takes ten, so the badge has
     * to hold a `10` as well as a `1`. One storm cannot show that. */
    ok(`${label}: thirteen numbered landfall rows drew across the two storms`,
      seen.landfalls.length === 13
      && seen.landfalls.filter((l) => l.n === '10').length === 1);

    ok(`${label}: no landfall row clips (worst overflow `
      + `${Math.max(0, ...seen.landfalls.map((l) => l.overflowX)).toFixed(2)}px)`,
    seen.landfalls.every((l) => l.overflowX <= 0.5));

    /* ==> AND NO BADGE CLIPS ITS OWN DIGITS. <== A `10` inside a 16px circle is
     * the case that would show it, and it is exactly the shape that read
     * `18 of 3` on a phone while every node assertion agreed the DOM was fine. */
    ok(`${label}: no badge clips its own number (worst `
      + `${Math.max(0, ...seen.landfalls.map((l) => l.badgeOverflowX)).toFixed(2)}px)`,
    seen.landfalls.every((l) => l.badgeOverflowX <= 0.5));

    /* ==> EVERY ROW'S TEXT STARTS ON ONE LEFT EDGE. <== The badge is its own
     * grid column for this reason: a `10` indenting its own row further than
     * the `9` above it reads as a fault rather than as a list. */
    const detailLefts = seen.landfalls.map((l) => l.detail.left);
    ok(`${label}: every landfall's text starts on the same left edge `
      + `(spread ${(Math.max(...detailLefts) - Math.min(...detailLefts)).toFixed(2)}px)`,
    Math.max(...detailLefts) - Math.min(...detailLefts) <= 0.5);

    /* And the badge stays a circle at its declared size rather than being
     * squeezed by the text column beside it. 20px is the mockup's figure and is
     * the chart's disc size. */
    ok(`${label}: every badge holds its size and stays round`,
      seen.landfalls.every((l) => Math.abs(l.badge.width - 16) <= 0.5)
      && seen.landfalls.every((l) => Math.abs(l.badge.width - l.badgeH) <= 0.5));

    /* ==> THE TEXT IS BESIDE THE BADGE, NOT UNDER IT, AND THIS IS THE
     * ASSERTION THAT WAS MISSING. <== §57.60g. `grid-template-columns` held an
     * unresolved `var()` for a whole push, so it computed to `none` and the two
     * children stacked into one column. Nothing threw, nothing clipped, and the
     * "every row's text starts on the same left edge" check below PASSED —
     * because stacked rows all start at the same left edge. A test that passes
     * on the same wrong assumption as the bug is worse than no test. */
    ok(`${label}: every row's text sits BESIDE its badge, not under it`,
      seen.landfalls.every((l) => l.detail.left >= l.badge.right - 0.5
        && Math.abs(l.detailTop - l.badgeTop) <= 6));

    /* --- 4. the footnote --------------------------------------------------*/

    ok(`${label}: the footnote is there and carries its rule`,
      seen.foot !== null && parseFloat(seen.foot.border) >= 1);

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
console.log(`\n✓ ${pass} geometry assertions pass — the merged row does not clip, `
  + 'and a spanning cell does not move the label column');
console.log('  (whether it READS as one fact is glass)');
