/**
 * test-season-life-chart.mjs — the life chart. §57.54d, §57.59.
 *
 * ==> THE FAULTS THIS SUITE EXISTS TO CATCH ARE ALL SILENT ONES. <== Nothing
 * here is a crash. A chart that clips its record holders against the roof, a
 * day label sitting on top of its neighbour, two landfall discs quietly
 * overlapping, a second Saffir-Simpson palette that reads perfectly and
 * disagrees with the dot in the panel's own header — every one of those
 * renders without a warning and looks deliberate.
 *
 * Driven against the real HURDAT2 files and the real computed landfall
 * sidecar, never a hand-built fixture. §57.58d is the reason: that step's
 * first fixture encoded the obvious guess about which storms carry an ACE and
 * the guess was backwards.
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
const { landfallFileName } = await import('../lib/seasons-sidecar.js');
const { SEASONS, CATEGORY_THRESHOLD_KT } = await import('../config/constants.js');
const { CATEGORY_COLOR } = await import('../config/tokens.js');
const {
  axisTicks, chartPoints, discRows, lifeChartAbsenceWords, lifeChartHtml,
  lifeChartSummary, orderedLandfalls, plotGeometry, axisLabelBox, axisLayout,
  LIFE_CHART_WIDTH, PLOT_BOTTOM,
} = await import('../ui/season-life-chart.js');

const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));

/** Every storm in a basin, with the computed landfall list attached exactly
 *  the way `data/seasons.js` attaches it on the phone. The NOAA fallback finds
 *  a fraction of the marks (§57.7a), so a suite driving it would be measuring
 *  disc collisions against a quarter of the real cases. */
function basin(name) {
  const meta = index.basins[name];
  const file = meta.file.startsWith('/') ? meta.file.slice(1) : join('seasons/data', meta.file);
  const parsed = parseHurdat2(readFileSync(join(ROOT, file), 'utf8'), { basin: name });
  const marks = JSON.parse(
    readFileSync(join(ROOT, 'seasons/data', landfallFileName(name, meta.revision)), 'utf8'),
  );
  for (const s of parsed.storms) s.landfallsComputed = marks.storms[s.id] || [];
  return parsed.storms;
}

const ATLANTIC = basin('atlantic');
const EPACIFIC = basin('epacific');
const ALL = [...ATLANTIC, ...EPACIFIC];

/** `stormFacts` plus the raw fixes, which is the shape the view hands over —
 *  the facts object deliberately does not carry 133 points around. */
const withPoints = (s) => ({ ...stormFacts(s), points: s.points });

const byId = (id) => withPoints(ALL.find((s) => s.id === id));
const KATRINA = byId('AL122005');
const LONGEST = byId('AL031899'); // 786 h, the longest track in the archive
const NOEL = byId('AL162007'); // 10 landfalls, the deepest disc stack
const SANDY = byId('AL182012'); // extratropical at 80 kt — a real ungraded wind

/* ---------------------------------------------------------------------------
 * 1. THE GEOMETRY MATCHES THE MOCKUP AARON ACCEPTED, TO THE DECIMAL
 *
 * These are not arbitrary coordinates. They are read off the prototype Aaron
 * approved on 2026-08-30, so a later pass that "tidies" a constant and moves
 * the plot has to argue with the thing he actually looked at.
 * ------------------------------------------------------------------------- */
section('1. Katrina renders at the accepted geometry');

const kHtml = lifeChartHtml(KATRINA, { summary: 'x' });
const kGeo = plotGeometry(KATRINA);

ok('the box is 358 wide and 172 tall on Katrina',
  /viewBox="0 0 358 172(\.0)?"/.test(kHtml));
ok('the tropical-storm band sits at y=71.9, 21.6 tall',
  kHtml.includes('y="71.9" width="350" height="21.6"'));
ok('the peak dot is at 237.3, 10.0', kHtml.includes('cx="237.3" cy="10.0" r="3.8"'));
ok('the first landfall disc is at x=19.8', kHtml.includes('cx="19.8" cy="148"'));
/* ==> HER FIRST LABEL IS AT 19.0 AND NOT ON ITS TICK AT 15.7, WHICH IS THE
 * EDGE RULE AND NOT A DRIFT. <== Centred on 15.7 a 30-unit label starts at 0.7
 * and the plot begins at 4, so it overhung by 3.3 and would have been shaved.
 * The clamp moves it by exactly that much. The tick itself is still at 15.7. */
ok('the first day label is `Aug 24`, clamped inboard to x=19.0',
  kHtml.includes('x="19.0" y="133" font-size="9.5" text-anchor="middle">Aug 24<')
  && kHtml.includes('class="lifec-tick" x1="15.7"'));
ok('the baseline is 0 kt', Math.abs(kGeo.yOf(0) - PLOT_BOTTOM) < 0.001);
ok('the width the geometry is quoted at is the box width', LIFE_CHART_WIDTH === 358);

/* ---------------------------------------------------------------------------
 * 2. THE WIND AXIS — a floor that stretches, never a ceiling that clips
 * ------------------------------------------------------------------------- */
section('2. the wind axis tops out at max(140, this storm\u2019s peak)');

ok(`Katrina's axis stretches to her own 150 kt peak, not to ${SEASONS.lifeChartTopKt}`,
  kGeo.topKt === 150 && KATRINA.peakWindKt === 150);
ok('a storm under the floor gets the shared scale', plotGeometry(SANDY).topKt === SEASONS.lifeChartTopKt);

/* ==> THE MUTATION THIS PAIR CATCHES IS DROPPING THE `max`. <== A fixed 140
 * renders every one of these storms without an error and draws them flat
 * against the roof, which is the one place a chart about strength must not
 * round down. */
const overFloor = ALL.map(withPoints)
  .filter((f) => Number.isFinite(f.peakWindKt) && f.peakWindKt > SEASONS.lifeChartTopKt);
ok(`the ${overFloor.length} storms above the floor each get their own peak as the top`,
  overFloor.length > 0 && overFloor.every((f) => plotGeometry(f).topKt === f.peakWindKt));
ok('and no storm is ever drawn above the top of its own box',
  ALL.map(withPoints).filter((f) => plotGeometry(f)).every((f) => {
    const g = plotGeometry(f);
    return chartPoints(f).every((p) => g.yOf(p.windKt) >= 9.99);
  }));

/* The Cat 5 band is the reason the floor is 140 and not 137. */
const cat5Floor = Math.max(...CATEGORY_THRESHOLD_KT.map((t) => t.min));
ok(`the floor leaves the Cat 5 band a real height above its ${cat5Floor} kt sill`,
  SEASONS.lifeChartTopKt > cat5Floor
  && plotGeometry(SANDY).yOf(cat5Floor) - plotGeometry(SANDY).yOf(SEASONS.lifeChartTopKt) > 1);

/* ---------------------------------------------------------------------------
 * 3. THE COLOURS ARE THE APP'S, NOT A SECOND SAFFIR-SIMPSON PALETTE
 *
 * ==> THIS IS THE ASSERTION THE ACCEPTED MOCKUP WOULD HAVE FAILED. <== Its
 * chart carried a warmed sepia ramp — a `#C93FA8` Cat 5 twenty pixels under a
 * `#E05BE0` Cat 5 dot in the same panel's header. SPEC §6 forbids exactly
 * that, and nothing on screen would have said so.
 * ------------------------------------------------------------------------- */
section('3. every colour in the chart is a real CATEGORY_COLOR');

const PALETTE = new Set(Object.values(CATEGORY_COLOR));
const hexesIn = (html) => [...html.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);

for (const [name, f] of [['Katrina', KATRINA], ['Sandy', SANDY], ['Noel', NOEL]]) {
  const hexes = hexesIn(lifeChartHtml(f, { summary: 'x' }));
  ok(`${name}: all ${hexes.length} literal colours are Saffir-Simpson tokens`,
    hexes.length > 0 && hexes.every((h) => PALETTE.has(h)));
}
ok('the Cat 5 band is the same ink as the Cat 5 dot in the panel header',
  kHtml.includes(`fill="${CATEGORY_COLOR.CAT5}"`));

/* ==> AND A SYSTEM WITH NO GRADE TAKES NO HEX AT ALL. <== §57.7g. It carries
 * the class and the stylesheet supplies `--storm-ended`, so the grey is a
 * palette decision rather than a value frozen into markup. */
section('4. an ungraded system is grey and keeps its real wind');

const sandyHtml = lifeChartHtml(SANDY, { summary: 'x' });
const sandyPts = chartPoints(SANDY);
const ungraded = sandyPts.filter((p) => !p.graded);
ok(`Sandy carries ${ungraded.length} ungraded fixes`, ungraded.length > 0);
ok('every ungraded fix refuses a category colour', ungraded.every((p) => p.color === null));
ok('and the strongest of them keeps a real wind rather than being zeroed',
  Math.max(...ungraded.map((p) => p.windKt)) >= 64);
ok('the ungraded segments carry the grey class',
  sandyHtml.includes('class="lifec-line lifec-line-ungraded"'));
ok('and no ungraded segment also carries a stroke attribute',
  [...sandyHtml.matchAll(/<line class="lifec-line lifec-line-ungraded"[^>]*>/g)]
    .every((m) => !m[0].includes('stroke="#')));
ok('a graded segment does carry one',
  /<line class="lifec-line" [^>]*stroke="#/.test(sandyHtml));

/* ==> THE GREY IS A TOKEN THE THEME ACTUALLY EMITS, AND THAT IS NOT
 * COSMETIC. <== §57.57c: a `var()` naming nothing renders as nothing and
 * throws nothing, and it is the one CSS mistake this repo has no gate for. */
{
  const css = readFileSync(join(ROOT, 'seasons/seasons.css'), 'utf8');
  const theme = readFileSync(join(ROOT, 'app/theme-switch.js'), 'utf8');
  const named = [...css.matchAll(/\.lifec[^{]*\{[^}]*\}/g)].join('')
    .match(/var\((--[a-z0-9-]+)\)/g) || [];
  const missing = [...new Set(named.map((v) => v.slice(4, -1)))]
    .filter((v) => !theme.includes(`'${v}'`) && !readFileSync(join(ROOT, 'index.html'), 'utf8').includes(`${v}:`));
  ok(`every custom property the chart's CSS names is really emitted. Missing: ${missing.join(', ') || 'none'}`,
    missing.length === 0);
}

/* ---------------------------------------------------------------------------
 * 5. THE DAY AXIS — zero overlapping labels, across the whole archive
 * ------------------------------------------------------------------------- */
section('5. the day axis never puts two labels on top of each other');

const MONTH = 30;

/* ==> THE BOXES COME OUT OF THE RENDERER'S OWN EDGE RULE. <== A label at
 * either end is PINNED rather than centred (`axisLabelBox`), so a sweep that
 * assumed centring would measure a layout the chart does not draw — and would
 * have gone on passing through the clipped `Aug 3` that reached glass. */
const DISC_ROW_Y = 148;
const DISC_ROW_PITCH = SEASONS.lifeChartDiscPx + 2;

const boxes = (facts) => axisLayout(facts, plotGeometry(facts));

function overlaps(facts) {
  const bs = boxes(facts);
  let n = 0;
  for (let i = 1; i < bs.length; i++) if (bs[i].left < bs[i - 1].right) n++;
  return n;
}

/* ==> AND NOTHING MAY BE DRAWN OUTSIDE THE PLOT, WHICH IS THE FAULT GLASS
 * FOUND. <== `Storm 3 1899` rendered `Aug 3` as `g 3`: its first tick sits at
 * the plot's left edge and the widest label there is was centred on it, so the
 * SVG's own boundary sheared the month off. Nothing threw and the chart looked
 * deliberate. */
function clipped(facts) {
  return boxes(facts).filter((b) => b.left < 0 || b.right > LIFE_CHART_WIDTH).length;
}

const charted = ALL.map(withPoints).filter((f) => plotGeometry(f));
const clashing = charted.filter((f) => overlaps(f) > 0);
ok(`0 of ${charted.length} storms have overlapping day labels. Offenders: `
  + `${clashing.slice(0, 3).map((f) => f.id).join(', ') || 'none'}`, clashing.length === 0);

const cut = charted.filter((f) => clipped(f) > 0);
ok(`and no label is drawn outside the plot on any of them. Clipped: `
  + `${cut.slice(0, 3).map((f) => f.id).join(', ') || 'none'}`, cut.length === 0);
/* ==> THE FAULT GLASS FOUND, NAMED. <== `Storm 3 1899` rendered `Aug 3` as
 * `g 3`. Its tick is at the plot's left edge and the widest label there is was
 * centred on it, so the SVG's own boundary sheared the month off. */
{
  const g = plotGeometry(LONGEST);
  const firstTick = axisTicks(LONGEST).find((t) => t.label);
  ok('the longest track\u2019s first tick really does sit at the plot edge',
    g.xOf(firstTick.time) < MONTH / 2);
  ok('and its label is clamped inboard rather than left to clip',
    axisLabelBox(firstTick.label, g.xOf(firstTick.time)).left >= 0);
  ok('a label with room is not moved at all',
    axisLabelBox('15', 180).x === 180);
}

const longTicks = axisTicks(LONGEST);
ok('the longest track in the archive thins 33 ticks down to 11 labels',
  longTicks.length === 33 && longTicks.filter((t) => t.label).length === 11);
/* ==> AND THE LAYOUT DROPS ONE MORE, WHICH IS THE TWO RULES MEETING. <==
 * `Aug 3` clamps inboard by 15 units to clear the edge and lands 0.2 units
 * into `6`. The earlier label wins, so ten are drawn. */
ok('and the layout draws 10 of those 11 once the edge clamp is applied',
  axisLayout(LONGEST, plotGeometry(LONGEST)).length === 10);
/* ==> `Aug 30` IS MISSING FROM THIS SET ON PURPOSE AND IT IS THE EVICTION
 * WORKING. <== It sat two days before the month change at 10.93 units a day,
 * which is 21.9 units between two 30-unit labels. The month is the more
 * informative of the two, so it wins. */
ok('and its labels are the measured set',
  longTicks.filter((t) => t.label).map((t) => t.label).join(' ')
    === 'Aug 3 6 9 12 15 18 21 24 27 Sep 1 4');

/* ==> THE TWO COLLISION RULES ARE ASSERTED SEPARATELY FROM THE LADDER,
 * BECAUSE EACH ONE ON ITS OWN LEAVES REAL STORMS BROKEN. <== The ladder alone
 * leaves 28; re-anchoring alone leaves 21; only both give zero. */
ok('a month change re-anchors the count rather than interrupting it',
  !longTicks.filter((t) => t.label).map((t) => t.label).includes('2'));
{
  /* Every storm that crosses a month boundary is the case both rules exist
   * for, so the sweep is over all of them rather than over one example. */
  const crossers = charted.filter((f) => axisTicks(f).some((t, i) => i > 0
    && new Date(t.time).getUTCMonth() !== new Date(axisTicks(f)[i - 1].time).getUTCMonth()));
  ok(`${crossers.length} storms cross a month boundary and none of them clashes`,
    crossers.length > 100 && crossers.every((f) => overlaps(f) === 0));
  /* ==> THE EVICTION WALKS BACK TO THE LAST LABELLED TICK AND THIS IS THE
   * ASSERTION THAT FOUND THAT OUT. <== Looking one tick back finds a BLANK one
   * whenever the ladder is thinning, declines to evict, and prints two wide
   * month labels a step apart. `CP051997` is the case: 23.75 days, every third
   * day labelled, `Nov 29` then a blank `Nov 30` then the change on `Dec 1`.
   *
   * ==> IT IS NOT AN ASSERTION THAT TWO MONTH LABELS NEVER TOUCH. <== The
   * LEFT-END label carries its month as well, so `Aug 30 · Sep 1` is two
   * different kinds of label rather than one printed twice, and it is correct
   * on 100+ storms. The rule is about width, so the test is about width. */
  ok('no two wide labels ever land within one width of each other',
    crossers.every((f) => {
      const g = plotGeometry(f);
      const wide = axisTicks(f).filter((t) => t.label && t.label.includes(' '))
        .map((t) => axisLabelBox(t.label, g.xOf(t.time)));
      return wide.every((b, i) => i === 0 || b.left >= wide[i - 1].right);
    }));
}

ok('the ladder itself thins on the measured steps',
  SEASONS.lifeChartDayLadder.length === 4
  && SEASONS.lifeChartDayLadder[0][1] === 1
  && SEASONS.lifeChartDayLadder[3][1] === 5);

/* ---------------------------------------------------------------------------
 * 6. THE LANDFALL DISCS — they stack rather than merge, and never touch
 * ------------------------------------------------------------------------- */
section('6. no two landfall discs overlap, anywhere in the archive');

let stacked = 0;
let deepest = 0;
let touching = [];
const rowHist = new Map();
for (const f of charted) {
  const g = plotGeometry(f);
  const discs = discRows(f, g);
  if (!discs.length) continue;
  const rows = Math.max(...discs.map((d) => d.row)) + 1;
  rowHist.set(rows, (rowHist.get(rows) || 0) + 1);
  if (rows > 1) stacked++;
  if (rows > deepest) deepest = rows;
  for (const a of discs) {
    for (const b of discs) {
      if (a === b || a.row !== b.row) continue;
      if (Math.abs(a.x - b.x) < SEASONS.lifeChartDiscPx) touching.push(`${f.id} ${a.n}/${b.n}`);
    }
  }
}
ok(`no two discs share a row within one diameter. Touching: `
  + `${touching.slice(0, 3).join(', ') || 'none'}`, touching.length === 0);
ok(`${stacked} storms need a second row and the deepest is ${deepest}`,
  stacked > 100 && deepest === SEASONS.lifeChartMaxDiscRows);
ok(`the row histogram is the measured one: `
  + `${[...rowHist.keys()].sort().map((k) => `${k}:${rowHist.get(k)}`).join(' ')}`,
  rowHist.get(1) === 1199 && rowHist.get(2) === 201
  && rowHist.get(3) === 33 && rowHist.get(4) === 2);

/* ==> THE NUMBER IS THE PLACE IN THE LIST AND NEVER THE PLACE IN A ROW. <==
 * The match to the numbered list under the chart is the entire reason the
 * discs are numbered, and a disc that dropped to row 2 keeping a row-2 number
 * would break it silently — the chart and the list would each be internally
 * consistent and disagree with each other. */
const noelDiscs = discRows(NOEL, plotGeometry(NOEL));
ok('Noel 2007 puts ten landfalls in four rows',
  noelDiscs.length === 10 && Math.max(...noelDiscs.map((d) => d.row)) === 3);
ok('and they are numbered 1..10 in time order regardless of row',
  noelDiscs.map((d) => d.n).join(',') === '1,2,3,4,5,6,7,8,9,10'
  && noelDiscs.every((d, i) => i === 0 || d.time >= noelDiscs[i - 1].time));
ok('every storm numbers its discs against its own landfall list',
  charted.every((f) => {
    const d = discRows(f, plotGeometry(f));
    return d.length === (f.landfalls || []).length
      && d.every((x, i) => x.n === i + 1);
  }));

/* The box grows for the rows it actually used, and only for those. */
ok('Noel\u2019s box is taller than Katrina\u2019s by three disc rows',
  /viewBox="0 0 358 226(\.0)?"/.test(lifeChartHtml(NOEL, { summary: 'x' })));

/* ==> THE YEAR STAMP CLEARS THE DISCS AT EVERY DEPTH, WHICH IS THE FAULT GLASS
 * FOUND ON `NOEL 2007`. <== §57.59i. It used to share a baseline with the
 * deepest disc row, and Noel's ninth landfall lands near the right-hand end
 * where the stamp is anchored, so the disc was drawn straight through the
 * year. The sweep is over the whole archive rather than over Noel, because the
 * collision is a coincidence of one storm's timing and the next storm to have
 * it would be a different one. */
{
  const stampY = (html) => Number(html.match(/y="([\d.]+)" font-size="9\.5" text-anchor="end"/)[1]);
  const hit = [];
  for (const f of charted) {
    const html = lifeChartHtml(f, { summary: 'x' });
    if (!html) continue;
    const y = stampY(html);
    const discs = discRows(f, plotGeometry(f));
    const bottom = discs.length
      ? DISC_ROW_Y + Math.max(...discs.map((d) => d.row)) * DISC_ROW_PITCH
        + SEASONS.lifeChartDiscPx / 2
      : 0;
    if (y <= bottom) hit.push(f.id);
    /* And the box has to be tall enough to hold it. */
    const box = Number(html.match(/viewBox="0 0 358 ([\d.]+)"/)[1]);
    if (box <= y) hit.push(`${f.id} (clipped)`);
  }
  ok(`the year stamp clears every disc on all ${charted.length} storms. `
    + `Colliding: ${hit.slice(0, 3).join(', ') || 'none'}`, hit.length === 0);
  ok('and it drops as the stack deepens',
    stampY(lifeChartHtml(NOEL, { summary: 'x' })) - stampY(kHtml) === 3 * DISC_ROW_PITCH);
}

/* ---------------------------------------------------------------------------
 * 7. A STORM THAT CANNOT BE CHARTED GETS A SENTENCE, NEVER AN EMPTY BOX
 * ------------------------------------------------------------------------- */
section('7. the 32 single-observation storms are refused in words');

const uncharted = ALL.map(withPoints)
  .filter((f) => f.points.filter((p) => Number.isFinite(p.windKt)).length < 2);
ok(`${uncharted.length} storms in the archive hold fewer than two winds`,
  uncharted.length === 32);
ok('every one of them draws no chart at all',
  uncharted.every((f) => lifeChartHtml(f, { summary: 'x' }) === ''));
ok('and each gets a sentence about the record rather than an apology',
  uncharted.every((f) => /single observation/.test(lifeChartAbsenceWords(f))));
/* ==> THE POINT-COUNT GUARD REFUSES EXACTLY THE SAME 32 STORMS THE GEOMETRY
 * GUARD DOES, SO IT IS UNREACHABLE AGAINST TODAY'S ARCHIVE AND IT IS STILL
 * WORTH KEEPING. <== Found by mutation on 2026-08-30: deleting it left all 49
 * assertions green, which is §12's failure exactly. The shape it protects
 * against is a storm with a real lifespan and only one fix carrying a wind —
 * impossible in HURDAT2, where a missing wind is `-999` on a row that still
 * has a position, and entirely possible from the agencies step 13 brings in.
 * Without the guard that storm renders bands, an axis and no line at all: a
 * silent empty box, which is the §5 failure this chart's refusal exists to
 * prevent. So the assertion drives it directly rather than hoping the archive
 * supplies one. */
{
  const oneWind = {
    ...KATRINA,
    points: KATRINA.points.map((p, i) => (i === 0 ? p : { ...p, windKt: null })),
  };
  ok('a storm with a real lifespan and one wind reading still has geometry',
    plotGeometry(oneWind) !== null);
  ok('and it is refused by the point count rather than drawn as an empty box',
    chartPoints(oneWind).length < 2 && lifeChartHtml(oneWind, { summary: 'x' }) === '');
  ok('two wind readings are enough to draw one segment',
    lifeChartHtml({
      ...KATRINA,
      points: KATRINA.points.map((p, i) => (i < 2 ? p : { ...p, windKt: null })),
    }, { summary: 'x' }).includes('class="lifec-line"'));
}

ok('every other storm in the archive does draw one',
  charted.filter((f) => chartPoints(f).length >= 2)
    .every((f) => lifeChartHtml(f, { summary: 'x' }).startsWith('<figure')));

/* ---------------------------------------------------------------------------
 * 8. THE PICTURE IS NOT THE ACCESSIBLE ANSWER
 * ------------------------------------------------------------------------- */
section('8. the label summarises rather than transcribes');

const summary = lifeChartSummary(KATRINA, { peakWords: '173 mph' });
ok('the summary names the peak and the landfall count',
  summary.includes('173 mph') && summary.includes('3 landfalls'));
ok('it is a sentence rather than a coordinate dump', summary.length < 140);
ok('a one-landfall storm is singular',
  lifeChartSummary({ lifespanHours: 48, landfalls: [{}] }).includes('1 landfall marked'));
ok('and a one-day storm is too',
  lifeChartSummary({ lifespanHours: 24, landfalls: [] }).includes('1 day of records'));
ok('the label reaches the rendered SVG',
  lifeChartHtml(KATRINA, { summary }).includes(`aria-label="${summary}"`));

/* ==> AND THE LABEL IS ESCAPED, BECAUSE IT CARRIES A STORM'S NAME. <== */
ok('a quote in the summary cannot close the attribute',
  !lifeChartHtml(KATRINA, { summary: 'a" onload="x' }).includes('onload="x'));

/* ---------------------------------------------------------------------------
 * 9. NO EM DASH, WHICH IS §57.41's SENTINEL GUARD
 * ------------------------------------------------------------------------- */
section('9. the chart never prints an em dash');

const src = readFileSync(join(ROOT, 'ui/season-life-chart.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('no em dash survives in the shipped strings of this file', !src.includes('\u2014'));
ok('nor in anything it renders',
  [KATRINA, SANDY, NOEL, LONGEST].every((f) => !lifeChartHtml(f, { summary: 'x' }).includes('\u2014')));

/* ---------------------------------------------------------------------------
 * 10. ONE OWNER FOR THE NUMBERS — step 6, §57.60
 * ------------------------------------------------------------------------- */
section('10. the chart and the list cannot disagree about which landfall is which');

/* ==> THE FAILURE THIS GUARDS IS SILENT AND SYMMETRICAL. <== §57.59e. Two
 * renderers walking the same array — the chart sorting by time, the list not —
 * would each be internally consistent and point at different landfalls, and
 * nothing on screen would look wrong. `orderedLandfalls` is the one answer both
 * of them read. */
ok('every storm numbers its landfalls 1..N in time order',
  ALL.map(withPoints).every((f) => {
    const o = orderedLandfalls(f);
    return o.every((e, i) => e.n === i + 1)
      && o.every((e, i) => i === 0 || e.mark.time >= o[i - 1].mark.time);
  }));

/* ==> AND EVERY ENTRY POINTS BACK AT ITS OWN MARK IN THE UNSORTED LIST. <==
 * §57.40a. The place names sidecar is index-aligned to `facts.landfalls` in its
 * own order, so a renderer reading these in time order looks a name up by
 * `index`. If that ever stopped identifying the same object, the panel would
 * print one landfall's town beside another's coordinates and read perfectly. */
ok('and each entry points back at its own mark in the unsorted list',
  ALL.map(withPoints).every((f) => orderedLandfalls(f)
    .every((e) => f.landfalls[e.index] === e.mark)));

ok('the discs take their numbers from the same place',
  ALL.map(withPoints).filter((f) => plotGeometry(f)).every((f) => {
    const o = orderedLandfalls(f);
    const d = discRows(f, plotGeometry(f));
    return d.length === o.length && d.every((x, i) => x.n === o[i].n && x.time === o[i].mark.time);
  }));

/* ==> THE ARCHIVE CANNOT SUPPLY AN OUT-OF-ORDER LIST TODAY, SO ONE IS BUILT.
 * <== Measured 2026-08-30: zero of 3,266 storms carry landfalls out of time
 * order, because the coast walk writes them in the order it meets the coast.
 * That is the whole reason the old code agreed with itself — by luck, over a
 * sidecar that happens to be sorted. Step 13 brings other agencies' tracks
 * into this renderer and nothing guarantees the same. Built by reversing a REAL
 * storm's list rather than by inventing landfalls, so the shape stays honest. */
{
  const shuffled = { ...NOEL, landfalls: NOEL.landfalls.slice().reverse() };
  const o = orderedLandfalls(shuffled);
  ok('a reversed landfall list is renumbered by TIME, not by array position',
    o.map((e) => e.n).join(',') === '1,2,3,4,5,6,7,8,9,10'
    && o.every((e, i) => i === 0 || e.mark.time >= o[i - 1].mark.time));
  ok('and landfall 1 is the same MARK it was before the shuffle',
    o[0].mark === orderedLandfalls(NOEL)[0].mark);
  ok('==> AND ITS `index` FOLLOWS THE SHUFFLE, WHICH IS WHAT KEEPS A PLACE '
    + 'NAME WITH ITS OWN LANDFALL. <== Reading the name by `n` instead would '
    + 'print the tenth landfall\u2019s town beside the first',
  o[0].index === shuffled.landfalls.length - 1);
  ok('the discs follow the same order on the shuffled list',
    discRows(shuffled, plotGeometry(shuffled)).map((d) => d.n).join(',')
    === discRows(NOEL, plotGeometry(NOEL)).map((d) => d.n).join(','));
}

/* ==> THE LIST'S BADGE IS THE CHART'S DISC AND CSS CANNOT IMPORT A CONSTANT.
 * <== §57.60. The two are meant to read as one object seen twice, so a reader
 * carries a number down from the plot to the row. A comment asking the next
 * person to keep them in step is the guard this project has already watched
 * fail (`tools/drawer-head-harness.html`), so the drift is a failure here. */
{
  const css = readFileSync(join(ROOT, 'seasons/seasons.css'), 'utf8');
  const declared = css.match(/--season-landfall-n:\s*(\d+(?:\.\d+)?)px/);
  ok('the landfall badge declares its own size in the stylesheet', !!declared);
  ok(`and it is ${SEASONS.lifeChartDiscPx}px, the same as the chart's disc`,
    !!declared && Number(declared[1]) === SEASONS.lifeChartDiscPx);
}


/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`    FAIL  ${f}`);
process.exit(fails.length ? 1 : 0);
