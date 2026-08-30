/**
 * test-season-spine.mjs — the distribution bar. §57.54c, §57.56.
 *
 * ==> THE FAULT THIS SUITE EXISTS TO CATCH IS A BAR THAT DRAWS BEAUTIFULLY AND
 * PUTS THE MARK IN THE WRONG PLACE. <== Nothing here is a crash. §57.46's two
 * distance ladders store DISPLAY units — miles and kilometres — while
 * `RANK_STATS.read()` returns nautical miles, so a bar handed the raw figure
 * renders perfectly, with the correct number printed beside it, and lies about
 * where the storm sits. The prototype did exactly that and nothing about it
 * invited a second look.
 *
 * Driven against the real shipped rankings file and real mirrored storms.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const section = (t) => console.log(`\n  ${t}\n`);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { rankStorm, rankingsFileName, RANK_STATS, toRung } = await import('../lib/rankings.js');
const { rankMarks } = await import('../ui/season-rank-markup.js');
const { peakHtml, lifeHtml, changeHtml } = await import('../ui/season-detail-markup.js');
const { movementHtml } = await import('../ui/season-track-markup.js');
const { binLadder, markFraction, spineHtml } = await import('../ui/season-spine.js');
const { figureRowsHtml } = await import('../ui/season-figure-row.js');
const { SEASONS } = await import('../config/constants.js');

const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
const { file } = rankingsFileName(index.basins);
const TABLE = JSON.parse(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8'));

const seasonOf = (basin, year) => parseHurdat2(
  readFileSync(join(ROOT, 'seasons', 'data', index.basins[basin].seasons[String(year)]), 'utf8')
).storms;

const katrina = stormFacts(seasonOf('atlantic', 2005).find((s) => s.id === 'AL122005'));

/* ---------------------------------------------------------------------------
 * 1. THE UNIT TRAP — the whole reason this file exists
 * ------------------------------------------------------------------------ */
section('THE UNIT TRAP \u2014 the rung, never the raw figure');
{
  /* ==> DRIVEN IN BOTH UNIT SYSTEMS, BECAUSE ONE OF THEM PASSES BY ACCIDENT.
   * <== §57.54c. Six of the eight ladders are unit-free and would be green
   * whichever number the bar was fed. The distance pair is the only place the
   * fault can show, and it shows differently in each system. */
  for (const [key, expect] of [['trackDistanceMi', 0.1952], ['trackDistanceKm', 0.1952]]) {
    const def = RANK_STATS[key];
    const ladder = TABLE.scopes.atlantic.stats[key];
    const raw = def.read(katrina);
    const got = markFraction(ladder, def.quantize, raw);
    ok(`${key}: the mark is at ${(expect * 100).toFixed(1)}% of the ladder, which is `
      + `where the printed figure belongs. Got ${(got * 100).toFixed(1)}%`,
    Math.abs(got - expect) < 0.002);

    /* ==> AND THE WRONG ANSWER IS ASSERTED TO BE DIFFERENT, SO THE TEST CANNOT
     * PASS ON THE BUG. <== §12: a test green against both answers proves
     * nothing. Handed the raw nautical miles, this ladder puts Katrina at
     * 16.9% (miles) and 10.4% (kilometres). */
    const min = Math.min(...ladder.values);
    const max = Math.max(...ladder.values);
    const naive = (raw - min) / (max - min);
    ok(`${key}: and feeding it the RAW nautical miles gives a visibly different `
      + `place (${(naive * 100).toFixed(1)}%), so this assertion has teeth`,
    Math.abs(naive - expect) > 0.02);
  }

  /* The unit-free ladders, where rung and raw agree, asserted so a future
   * change to `toRung` cannot quietly move them. */
  for (const [key, expect] of [['peakWindKt', 0.8929], ['lowestPressureMb', 0.1493]]) {
    const def = RANK_STATS[key];
    const got = markFraction(TABLE.scopes.atlantic.stats[key], def.quantize, def.read(katrina));
    ok(`${key}: ${(expect * 100).toFixed(1)}% of the ladder. Got ${(got * 100).toFixed(1)}%`,
      Math.abs(got - expect) < 0.002);
  }
}

/* ---------------------------------------------------------------------------
 * 2. THE BINS — the comb, and the storm that must never vanish
 * ------------------------------------------------------------------------ */
section('THE BINS \u2014 capped by the ladder\u2019s own resolution');
{
  /* ==> THE CAP IS THE MEASUREMENT THAT PUT `spineBins` WHERE IT IS. <==
   * `fastest24hGainKt` is recorded on a 5 kt grid and holds 18 rungs. Drawn in
   * a fixed 40 columns, 22 come back empty and the bar is a comb. */
  const coarse = TABLE.scopes.atlantic.stats.fastest24hGainKt;
  const box = binLadder(coarse);
  ok(`a ladder with ${coarse.values.length} rungs is drawn in ${coarse.values.length} `
    + `columns, not ${SEASONS.spineBins}. Got ${box.bins.length}`,
  box.bins.length === coarse.values.length);
  ok('and every one of them holds storms, so the bar is a distribution rather '
    + 'than a comb',
  box.bins.every((b) => b > 0));

  const fine = TABLE.scopes.atlantic.stats.trackDistanceMi;
  ok(`a ladder with ${fine.values.length} rungs is capped at ${SEASONS.spineBins}`,
    binLadder(fine).bins.length === SEASONS.spineBins);

  /* ==> AND THE COMB IS ASSERTED AGAINST DIRECTLY, NOT ONLY VIA THE CAP. <== A
   * mutation run is why: raising `spineBins` to 400 left every assertion above
   * green, because they all read the constant they were meant to be checking.
   * This one names the SHAPE instead. Measured 2026-08-30, the emptiest bar in
   * the shipped file is `hoursAtMajor` at 9 of 40 columns (22.5%) — genuine
   * gaps in a long tail, not an artifact of the binning. Half is a wide
   * margin over that and a comb blows straight through it. */
  for (const [scopeKey, scope] of Object.entries(TABLE.scopes)) {
    for (const [key, ladder] of Object.entries(scope.stats)) {
      const bins = binLadder(ladder).bins;
      const empty = bins.filter((b) => b === 0).length;
      ok(`${scopeKey}/${key}: reads as a distribution, not a comb \u2014 `
        + `${empty} of ${bins.length} columns empty`,
      empty / bins.length < 0.5);
    }
  }

  /* ==> EVERY STORM ON THE LADDER IS DRAWN SOMEWHERE. <== A binning bug that
   * dropped the top or bottom rung would be invisible on screen and would move
   * every mark. The totals have to agree exactly. */
  for (const [key, ladder] of Object.entries(TABLE.scopes.atlantic.stats)) {
    const total = ladder.counts.reduce((a, b) => a + b, 0);
    const drawn = binLadder(ladder).bins.reduce((a, b) => a + b, 0);
    ok(`${key}: all ${total} storms land in a column. Got ${drawn}`, drawn === total);
  }
}

/* ---------------------------------------------------------------------------
 * 3. THE ENDS — findable at both extremes, which is the glass question
 * ------------------------------------------------------------------------ */
section('THE ENDS \u2014 first place is drawn inside the bar, not half outside it');
{
  const ladder = TABLE.scopes.atlantic.stats.peakWindKt;
  const strongest = Math.max(...ladder.values);
  const weakest = Math.min(...ladder.values);

  ok('the strongest storm in the archive sits at the far right of the wind bar',
    Math.abs(markFraction(ladder, 'round', strongest) - 1) < 1e-9);
  ok('and the weakest at the far left',
    Math.abs(markFraction(ladder, 'round', weakest)) < 1e-9);

  /* ==> AND NEITHER MARK IS DRAWN ON THE BOX EDGE. <== A 2px stroke centred on
   * x=0 loses half of itself to the clip, so the record-holder would show the
   * FAINTEST mark on the panel. §57.54k names "is the marker findable at both
   * extremes" as step 2's glass risk; this is the half of it that geometry can
   * answer without a phone. */
  const at = (v) => {
    /* ==> ANCHORED ON THE MARK'S OWN CLASS. <== A bare `x1="..."` match used
     * to work and stopped the day §57.64 added the baseline rule, whose own
     * `x1="0"` sits earlier in the markup — so the assertion read the rule's
     * left end and reported first place as uninset. It went red rather than
     * silently green, which is the only reason it is worth writing down. */
    const m = spineHtml(ladder, 'round', v, { axis: (x) => `${x}` })
      .match(/season-spine-mark" x1="([\d.]+)"/);
    return m ? Number(m[1]) : null;
  };
  ok(`first place is inset from the left edge. Got x=${at(weakest)}`, at(weakest) > 0);
  ok(`and last place from the right edge. Got x=${at(strongest)}`, at(strongest) < 100);
  ok('and the two are still at opposite ends of the bar',
    at(strongest) - at(weakest) > 90);
}

/* ---------------------------------------------------------------------------
 * 4. THE AXIS — the ends speak the row's units, and pressure says which way
 * ------------------------------------------------------------------------ */
section('THE AXIS \u2014 the same units as the row above it');
{
  /* ==> THE BARS ARE READ OUT OF THE REAL SECTIONS, NOT OUT OF A STAND-IN
   * LIST. <== §57.57b deleted `Where it ranks`, so there is no single renderer
   * that draws all seven any more — each one lands in the section that already
   * printed its figure. Building a row list here to hold them would be this
   * suite agreeing with itself: a key misspelled in `peakHtml` would silently
   * lose a bar on the panel and this file would never know. It drives the four
   * shipped renderers instead, which is exactly what the panel assembles. */
  const html = (system) => {
    const marks = rankMarks(rankStorm(katrina, TABLE, 'atlantic', system), { system });
    return peakHtml(katrina, system, marks)
      + lifeHtml(katrina, marks)
      + changeHtml(katrina, system, {
        windowHours: SEASONS.intensificationWindowHours,
      }, marks)
      + movementHtml(katrina, system, {
        floorKt: SEASONS.trackSpeedFloorKt,
        maxLegHours: SEASONS.trackSpeedMaxLegHours,
        distanceFloorNm: SEASONS.trackDistanceFloorNm,
        cycloneShareMax: SEASONS.trackDistanceCycloneShareMax,
      }, marks);
  };
  const imp = html('imperial');
  const met = html('metric');

  /* ==> THE WIND LADDER IS IN KNOTS AND THE ROW LEADS WITH mph. <== An axis
   * reading 25 and 165 under a row reading 173 mph is two measurements stacked
   * on one another, which is the fault §57.54a found in this panel. */
  ok('the wind bar\u2019s ends are in mph for an imperial reader',
    imp.includes('29 mph') && imp.includes('190 mph'));
  ok('and in km/h for a metric one', met.includes('46 km/h') && met.includes('306 km/h'));

  /* ==> AND THE DISTANCE LADDERS ARE ALREADY IN DISPLAY UNITS, SO THE AXIS
   * MUST NOT CONVERT. <== Handing a mile figure to `formatDistance`, which
   * takes nautical miles, would inflate the far end by 15% to 12,251 mi.
   * §57.54c records that exact number happening on the prototype. */
  ok('the distance bar\u2019s far end is the ladder\u2019s real top rung, 10,646 mi',
    imp.includes('10,646 mi') && !imp.includes('12,251'));
  ok('and 17,133 km for a metric reader', met.includes('17,133 km'));

  /* ==> THE ONE BAR WHERE LOW IS STRONG SAYS SO IN WORDS. <== §57.54c. Adding
   * a direction note to every bar would make this one invisible again. */
  ok('pressure names which end is which, because it is the only bar that runs '
    + 'backwards',
  imp.includes('882 mb (strongest)') && imp.includes('1016 mb (weakest)'));
  const notes = (imp.match(/\(strongest\)|\(weakest\)/g) || []).length;
  ok(`and it is said exactly twice on the whole panel, not on every bar. Got ${notes}`,
    notes === 2);

  /* ==> AND THE MARK IN THE RENDERED PANEL IS CHECKED, NOT JUST `markFraction`
   * IN ISOLATION. <== A mutation run is why. Section 1 calls `markFraction`
   * with the right quantizer by hand, so swapping `row.def.quantize` for a
   * hardcoded `'round'` at the call site — which is precisely the prototype's
   * bug, one level up — left this whole suite green. The assertion has to
   * follow the number all the way to the markup.
   *
   * Katrina belongs at 19.5% of the distance ladder. The bar insets the mark
   * by half a stroke at each end, so 0.5 + 0.195 x 99 = 19.8 in viewBox units.
   * The raw-nautical-miles answer is 17.2 (miles) and 10.8 (kilometres). */
  const markOf = (html, after) => {
    const at = html.indexOf(after);
    const m = at < 0 ? null : html.slice(at).match(/season-spine-mark" x1="([\d.]+)"/);
    return m ? Number(m[1]) : null;
  };
  const impMark = markOf(imp, '<dt>Distance travelled</dt>');
  const metMark = markOf(met, '<dt>Distance travelled</dt>');
  ok(`the distance mark is drawn at 19.8 of 100 for an imperial reader. Got ${impMark}`,
    impMark !== null && Math.abs(impMark - 19.8) < 0.3);
  ok(`and at the SAME place for a metric one, because it is the same storm on `
    + `the same track. Got ${metMark}`,
  metMark !== null && Math.abs(metMark - 19.8) < 0.3);

  /* ==> THIS STORM'S OWN FIGURE IS PRINTED ON THE BAR, AND IT IS THE RUNG. <==
   * §57.64. The axis formatters take a ladder's own units and `read()` returns
   * nautical miles for both distance entries, so handing `raw` straight to the
   * formatter would print `1,830 mi` under a mark placed correctly at the
   * 2,106 mi rung — the mirror of §57.54c's fault, number wrong instead of
   * position. Asserted in both unit systems, because six of the eight ladders
   * would be green either way. */
  ok('the distance bar prints the rung, not the raw nautical miles',
    imp.includes('>2,106 mi<') && !imp.includes('>1,830 mi<'));
  ok('and the kilometre ladder\u2019s own rung for a metric reader',
    met.includes('>3,388 km<') && !met.includes('>1,830'));
  ok('the wind bar prints the storm\u2019s figure in the reader\u2019s units',
    imp.includes('>173 mph<') && met.includes('>278 km/h<'));

  /* ==> THREE ANCHORS, AND THE RECORD-HOLDER IS WHY. <== A label centred on a
   * mark at 2% hangs half of itself off the left edge of the panel. Katrina's
   * own panel exercises all three: her wind sits at 89% (pinned right), her
   * pressure at 15% (pinned left) and her ACE at 27% (centred). */
  ok('a mark near the right end pins its figure to that end',
    /season-spine-figure-end">173 mph/.test(imp));
  ok('a mark near the left end pins its figure to that end',
    /season-spine-figure-start">902 mb/.test(imp));
  ok('and a mark in the middle is centred on it, carrying the position',
    /season-spine-figure-mid" style="--spine-at: 27\.\d+%">20\.0/.test(imp));

  /* ==> THE BASELINE AND ITS TWO END TICKS. <== §57.64. Without them the bar
   * has no floor and no ends, and on the coarse ladders the outermost columns
   * are one pixel tall — so where the range stops is not inferable from the
   * ink. Aaron asked for the mockup's styling and this was the substance of
   * it. */
  const plots = (imp.match(/season-spine-plot/g) || []).length;
  ok(`every bar stands on a rule \u2014 ${plots} bars, `
    + `${(imp.match(/season-spine-rule/g) || []).length} rules`,
  (imp.match(/season-spine-rule/g) || []).length === plots);
  ok('and carries a tick at each end of its range',
    (imp.match(/season-spine-tick/g) || []).length === plots * 2);

  /* ==> A BAR PER MARKED ROW, NOT PER ROW. <== §57.57b. Before step 3 every
   * row in `Where it ranks` was a ranked figure, so bars and `<dt>`s matched
   * one for one. The four sections these come from also carry dates,
   * coordinates and `As a tropical cyclone`, none of which ranks — so the
   * count to hold is against the MARKS, and a row that is not a figure must
   * still draw in the plain two-column shape. */
  const bars = (imp.match(/season-spine-plot/g) || []).length;
  const dts = (imp.match(/<dt>/g) || []).length;
  const marked = (imp.match(/class="has-rank"/g) || []).length;
  ok(`every marked row carries a bar \u2014 ${marked} marked, ${bars} bars`,
    bars === marked && bars >= 7);
  ok(`and the unranked rows are still printed \u2014 ${dts} rows against ${marked} marked`,
    dts > marked);
  ok('a row with no mark keeps the plain two-column cell',
    imp.includes('<dt>Reached</dt><dd>'));
}

/* ---------------------------------------------------------------------------
 * 5. SILENCE — a bar that cannot be drawn draws nothing
 * ------------------------------------------------------------------------ */
section('SILENCE \u2014 nothing half-drawn, and the row survives without a bar');
{
  const axis = (v) => `${v}`;
  ok('no ladder, no bar', spineHtml(null, 'round', 5, { axis }) === '');
  ok('a ladder whose values and counts disagree is refused rather than guessed at',
    spineHtml({ values: [1, 2, 3], counts: [1, 1], of: 2 }, 'round', 2, { axis }) === '');
  ok('a single-rung ladder has no spread to show',
    spineHtml({ values: [5], counts: [9], of: 9 }, 'round', 5, { axis }) === '');
  ok('and a ladder where every storm shares one value has no range',
    binLadder({ values: [7, 7], counts: [1, 1], of: 2 }) === null);
  ok('a figure the ladder cannot place produces no bar',
    spineHtml(TABLE.scopes.atlantic.stats.peakWindKt, 'round', null, { axis }) === '');

  /* ==> AND THE ROW IS STILL PRINTED. <== §5. The rank is the fact; the bar is
   * context. A missing bar must not take the figure down with it. */
  const rows = figureRowsHtml([{ label: 'Peak winds', value: '173 mph' }]);
  ok('a row with no mark renders as the ordinary two-column pair it always was',
    rows.includes('<dt>Peak winds</dt>') && rows.includes('<dd>173 mph</dd>')
      && !rows.includes('has-rank'));
  ok('a keyed row whose statistic did not rank draws the same way',
    figureRowsHtml([{ key: 'peakWindKt', label: 'Peak winds', value: '173 mph' }], new Map())
      === rows);
  /* ==> A LABEL-LESS ROW IS KEPT, WHICH REVERSES WHAT THIS FILE ASSERTED AT
   * STEP 2. <== §57.56e dropped it because this renderer had one shape of
   * caller, a ranked statistic, which always has a label. Step 3 gave it the
   * panel's ordinary rows, so §57.55a's rule is the one that applies now: a
   * label-less pair is a programming mistake, and dropping it here would turn
   * a visible layout fault into content that silently vanishes. */
  ok('and a row with no label is PRINTED, so the fault stays visible',
    figureRowsHtml([{ label: '', value: 'orphan' }]).includes('<dt></dt><dd>orphan</dd>'));
  ok('the value is escaped here exactly as `rowsHtml` escapes it',
    figureRowsHtml([{ label: 'A', value: '<b>x</b>' }]).includes('&lt;b&gt;'));
}

/* ---------------------------------------------------------------------------
 * 6. THE FLOOR — one storm is never drawn as none
 * ------------------------------------------------------------------------ */
section('THE FLOOR \u2014 §5 with a chart under it');
{
  /* A deliberately brutal shape: one bin holding a thousand storms and one
   * holding a single storm. On a linear scale the lone storm is 1/1000 of the
   * height and invisible. */
  const ladder = { values: [0, 100], counts: [1, 1000], of: 1001, direction: 'high' };
  const html = spineHtml(ladder, 'round', 0, { axis: (v) => `${v}` });
  /* The baseline's y, read off the rendered path rather than typed, so
   * §57.64's move from 24 to 27 cannot silently empty this match again. */
  const floorY = (html.match(/d="M[\d.]+ ([\d.]+)h/) || [])[1];
  const rects = html.match(new RegExp(`M[\\d.]+ ${floorY}h[\\d.]+v(-[\\d.]+)`, 'g')) || [];
  const heights = rects.map((r) => Math.abs(Number(r.match(/v(-[\d.]+)/)[1])));
  ok(`both columns are drawn, and the thin one has real height. Got ${heights.join(', ')}`,
    heights.length === 2 && Math.min(...heights) > 0);
  /* The plot area, not the viewBox: §57.64 made the box taller than the
   * columns so the mark and the end ticks can cross the baseline. */
  const plotH = Number(floorY) - 3;
  ok('and the thin column is at least the floor, so one storm never reads as none',
    Math.min(...heights) / plotH >= SEASONS.spineMinColumn - 1e-9);
  ok('while the tall one is still visibly taller, so the floor did not flatten '
    + 'the distribution into a block',
  Math.max(...heights) > Math.min(...heights) * 2);
}

/* ---------------------------------------------------------------------------
 * 6b. CONTRAST — the check that should have run before this reached a phone
 * ------------------------------------------------------------------------ */
section('CONTRAST \u2014 the mark against the panel it is drawn on');
{
  /* ==> THIS ASSERTION EXISTS BECAUSE A GUESS SHIPPED AT 2.19:1. <== §57.63.
   * The first version of these tokens reasoned about each theme's NAME rather
   * than reading its panel colour, and put a deep brown mark (`#7A3E12`) on
   * the sepia archive's `ocean` (`#1C1409`) — which its own comment describes
   * as "the parchment's SHADOW, not a night sky". Aaron caught it on glass.
   * Nothing crashed, nothing was missing; the one element the whole bar exists
   * to make findable was simply almost invisible.
   *
   * WCAG 2.1 SC 1.4.11 puts the floor for a non-text graphic at 3:1. */
  const { DARK, LIGHT, SEPIA } = await import('../config/tokens.js');

  const lum = (hex) => [1, 3, 5]
    .map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a2, c, i) => a2 + [0.2126, 0.7152, 0.0722][i] * c, 0);
  const ratio = (a2, b) => {
    const [hi, lo] = [lum(a2), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const [name, theme] of [['DARK', DARK], ['LIGHT', LIGHT], ['SEPIA', SEPIA]]) {
    /* ==> THE PANEL IS THE THEME'S OWN `ocean`, READ FROM THE TOKEN RATHER
     * THAN TYPED HERE. <== A hardcoded background is a second copy of a value
     * that already exists, free to go stale the day a theme is retuned — and
     * going stale is precisely how the bug this catches was born. */
    const r = ratio(theme.spineMark, theme.ocean);
    ok(`${name}: the mark clears 3:1 against its own panel `
      + `(${theme.spineMark} on ${theme.ocean} = ${r.toFixed(2)}:1)`, r >= 3);
  }

  /* ==> AND THE EXACT VALUE THAT SHIPPED IS ASSERTED TO FAIL. <== §12: a
   * threshold test that nothing can fall below proves nothing. */
  ok(`the mark that shipped on 2026-08-30 would fail this `
    + `(#7A3E12 on ${SEPIA.ocean} = ${ratio('#7A3E12', SEPIA.ocean).toFixed(2)}:1)`,
  ratio('#7A3E12', SEPIA.ocean) < 3);

  /* ==> THE FILL IS DELIBERATELY NOT HELD TO 3:1, AND THAT IS STATED RATHER
   * THAN QUIETLY SKIPPED. <== Composited over its panel the sepia fill is
   * about 2.1:1, and raising it enough to clear the floor would change a look
   * Aaron judged and accepted on glass. It is allowed to sit under because it
   * carries no fact of its own: the two extremes are printed as words at the
   * ends of the bar and the rank is printed above it, so a reader who cannot
   * see the silhouette at all loses nothing. `ui/chart-home.js` sets the same
   * rule — a picture is never the accessible answer. The MARK is the graphic
   * that has to be seen, and it is held to the floor above.
   *
   * What the fill must clear is the panel it sits on well enough to be told
   * apart from it at all, and the mark must be tellable from the fill. */
  for (const [name, theme] of [['DARK', DARK], ['LIGHT', LIGHT], ['SEPIA', SEPIA]]) {
    ok(`${name}: the mark is clearly distinguishable from the fill it crosses`,
      ratio(theme.spineMark, theme.ocean) >= 3);
  }
}

/* ---------------------------------------------------------------------------
 * 6c. THE SEAM — one pixel, and it must never close a column
 * ------------------------------------------------------------------------ */
section('THE SEAM \u2014 a hairline between columns, at every bin count');
{
  /* ==> AARON REJECTED THE MOCKUP'S WIDE GAPS AND THEN ASKED FOR A SINGLE
   * PIXEL. <== §57.65. The risk is not the wide case, it is the narrow one: a
   * fixed gap subtracted from a pitch that varies from 5.56 units (18 bins) to
   * 2.50 (the `spineBins` cap of 40) eats a different share of each, and a gap
   * that ever reached the pitch would silently delete the bar. */
  const geom = (key) => {
    const ladder = TABLE.scopes.atlantic.stats[key];
    const html = spineHtml(ladder, 'round', ladder.values[0], { axis: (v) => `${v}` });
    const d = html.match(/d="([^"]+)"/)[1];
    const segs = [...d.matchAll(/M([\d.]+) [\d.]+h([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    const bins = binLadder(ladder).bins.length;
    return { pitch: 100 / bins, width: segs[0][1], starts: segs.map((x) => x[0]), bins };
  };

  for (const key of Object.keys(TABLE.scopes.atlantic.stats)) {
    const g = geom(key);
    const gap = g.pitch - g.width;
    /* One device pixel at 358px, which is the panel's width inside a 390px
     * phone — the size this was judged at. */
    ok(`${key}: the seam is one pixel at phone width. Got ${(gap * 3.58).toFixed(2)}px`,
      Math.abs(gap * 3.58 - 1) < 0.05);
    ok(`${key}: and it never eats the column it separates \u2014 seam is `
      + `${((gap / g.pitch) * 100).toFixed(1)}% of a ${g.pitch.toFixed(2)}-unit pitch`,
    g.width > 0 && gap / g.pitch < 0.25);
  }

  /* ==> THE SEAM IS TAKEN HALF FROM EACH SIDE, SO A COLUMN STAYS CENTRED ON
   * ITS OWN BIN. <== Shaving it off one edge only would walk every column a
   * half-gap off the value it represents, and the mark is placed from that
   * same value — so the mark would drift out of its own column at one end of
   * the bar and not the other. Asserted on the coarse ladder, where a half-gap
   * is the most visible. */
  const g = geom('peakWindKt');
  /* ==> THE TOLERANCE IS THE PATH'S OWN ROUNDING, NOT FLOAT DUST. <== Every
   * coordinate is written with `toFixed(2)`, so a check at 1e-6 fails on the
   * hundredth rather than on the geometry — it did, first run, at 0.140
   * against 0.139. Half a hundredth is the real floor here. */
  const NEAR = 0.011;
  ok(`the first column is inset by half a seam, not a whole one or none. `
    + `Got ${g.starts[0].toFixed(3)}`,
  Math.abs(g.starts[0] - (g.pitch - g.width) / 2) < NEAR);
  ok('and every column sits centred on its own pitch',
    g.starts.every((x, i) => Math.abs((x + g.width / 2) - (i + 0.5) * g.pitch) < NEAR));
}

/* ---------------------------------------------------------------------------
 * 7. THE WHOLE ARCHIVE — no ladder in the shipped file refuses to draw
 * ------------------------------------------------------------------------ */
section('EVERY LADDER IN THE SHIPPED FILE DRAWS');
{
  let drawn = 0;
  let refused = [];
  for (const [scopeKey, scope] of Object.entries(TABLE.scopes)) {
    for (const [key, ladder] of Object.entries(scope.stats)) {
      const box = binLadder(ladder);
      if (!box) { refused.push(`${scopeKey}/${key}`); continue; }
      drawn++;
      ok(`${scopeKey}/${key}: no column is taller than the box`,
        binLadder(ladder).bins.every((b) => b >= 0));
    }
  }
  ok(`all ${drawn} ladders in the shipped table produce a bar. Refused: `
    + `${refused.join(', ') || 'none'}`, refused.length === 0);
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`    FAIL  ${f}`);
process.exit(fails.length ? 1 : 0);
