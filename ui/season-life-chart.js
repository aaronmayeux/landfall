/**
 * season-life-chart.js — wind at every recorded fix, against time.
 * SPEC-SEASONS-BUILD.md §57.54d, §57.59.
 *
 * ==> IT COLLAPSES SEVEN FACTS THAT WERE SPREAD ACROSS FOUR SECTIONS INTO ONE
 * PICTURE. <== Peak, when the peak was, lifespan, time at each strength, the
 * intensification arc, the landfall timing, and how it ended. It is the one
 * hero of the rebuild and it lands alone, judged alone, before step 6 moves
 * the landfall list under it.
 *
 * ==> THE BANDS ARE THE Y AXIS, WHICH IS WHY THERE IS NO WIND SCALE DOWN THE
 * SIDE. <== A reader does not convert a height into knots and then knots into
 * a grade; they look at which stripe the line is in. That only works if the
 * stripes are in the same place from one storm to the next, which is what
 * `SEASONS.lifeChartTopKt` buys.
 *
 * ==> AND IT SPEAKS THE GLOBE'S COLOUR GRAMMAR RATHER THAN ITS OWN. <== SPEC
 * §6: Saffir-Simpson colours are fixed and are not themeable. The line, the
 * bands and the peak all take `CATEGORY_COLOR`, so a Cat 4 here is the same
 * ink as the Cat 4 dot on the roster, on the globe and in this panel's own
 * header. A system with no grade to claim takes `stormEnded`, which is the
 * decision §57.7g already made on glass for the archive globe's dots — height
 * still says the wind, and the grey says there is no category behind it.
 *
 * ==> IT IS A PROPORTIONALLY SCALED SVG, NOT A STRETCHED ONE, AND THAT IS THE
 * OPPOSITE OF `ui/season-spine.js`. <== The spine sets
 * `preserveAspectRatio="none"` because it is a histogram where only x carries
 * meaning. Here a circle must stay a circle and a dashed line must stay put
 * under its own disc, so the whole box scales together. `ui/chart-home.js` is
 * the precedent and `ui/panels.css` records Aaron judging its text on glass:
 * the answer was to widen the rail, not to restructure the chart.
 *
 * ==> A CHART IS NOT AN ACCESSIBLE ANSWER. <== `ui/chart-home.js` states this
 * rule and it applies unchanged: every fact drawn here is also written in the
 * sections below, and the `aria-label` is a summary rather than a substitute.
 *
 * Imports config/ and lib/. No DOM, no network, no clock — it returns a
 * string, like every other renderer on this panel.
 */

import { SEASONS, CATEGORY_THRESHOLD_KT } from '../config/constants.js';
import { CATEGORY_COLOR } from '../config/tokens.js';
import { categoryFromKt } from '../lib/category.js';
import { esc } from './season-markup-bits.js';

const HOURS = 3600 * 1000;
const DAY = 24 * HOURS;

/* ---------------------------------------------------------------------------
 * THE BOX
 *
 * Every number here is in viewBox units, and at the width this chart is judged
 * at — 358px, the panel inside a 390px phone — one unit is one device pixel.
 * ------------------------------------------------------------------------ */

const W = 358;

/** The plot's left and right edges. The inset leaves room for a mark sitting
 *  exactly on the first or last fix without half of it falling off the box. */
const PAD_X = 4;

/** The top of the plot. Above it is nothing; the highest band starts here. */
const PLOT_TOP = 10;

/** The baseline, which is 0 kt. Below it are the day ticks and their labels. */
const PLOT_BOTTOM = 118;

/** Where the day tick marks stop and where their labels sit. */
const TICK_BOTTOM = 123;
const TICK_LABEL_Y = 133;

/** The first row of landfall discs, and the drop to each row after it.
 *
 *  ==> THE ROW PITCH IS THE DISC PLUS TWO UNITS, SO STACKED DISCS CLEAR EACH
 *  OTHER RATHER THAN TOUCHING. <== A pitch equal to the diameter would put two
 *  rows in contact and read as one tall shape. */
const DISC_ROW_Y = 148;
const DISC_ROW_PITCH = SEASONS.lifeChartDiscPx + 2;

/**
 * The year stamp's own line, below everything else.
 *
 * ==> IT USED TO SHARE A BASELINE WITH THE DEEPEST DISC ROW AND `NOEL 2007`
 * DREW ITS NINTH DISC STRAIGHT THROUGH IT. <== §57.59i. Found on glass,
 * 2026-08-30. The stamp is anchored to the right-hand end and a disc lands
 * wherever its landfall fell, so the collision is a coincidence of one storm's
 * timing rather than anything the layout controlled — which is exactly why it
 * gets a line of its own rather than a nudge.
 *
 * `STAMP_DROP` is the baseline's distance below the bottom of the last disc,
 * and `STAMP_TAIL` is the descender plus a little air under it.
 */
const STAMP_DROP = 11;
const STAMP_TAIL = 5;

/** ==> TEXT INSIDE THIS SVG IS SIZED IN USER UNITS, AS AN ATTRIBUTE, WHICH IS
 *  WHY IT IS NOT ON THE `--type-*` SCALE. <== `ui/chart-home.js` does the same
 *  and for the same reason: the box scales with its container, so a label has
 *  to scale with the geometry it is placed against. A rem token would hold the
 *  text still while the ticks it sits under moved, and the labels would start
 *  colliding at exactly the widths this chart was measured to clear.
 *  `tools/type-scale-check.mjs` reads stylesheets, so these are deliberately
 *  out of its reach — the gate that covers them is the browser check. */
const AXIS_SIZE = 9.5;

/** How wide a day label is, in viewBox units.
 *
 *  ==> AN UPPER BOUND RATHER THAN A MEASUREMENT, BECAUSE NOTHING HERE CAN
 *  MEASURE TEXT. <== The axis is `AXIS_SIZE` in the numeric face, so a digit is
 *  about 0.63 of that and a month label like `Sep 1` runs to about 30. Both are
 *  generous on purpose: this feeds the edge rule below, and over-estimating
 *  costs a label a few units of nudge while under-estimating clips it. */
const DIGIT_W = 6;
const MONTH_W = 30;
const BAND_SIZE = 8.5;
const DISC_SIZE = 10;

const PLOT_H = PLOT_BOTTOM - PLOT_TOP;
const PLOT_W = W - PAD_X * 2;

/** Ascending by floor, so each band's ceiling is the next one's floor. Built
 *  from `CATEGORY_THRESHOLD_KT` rather than typed, so moving a breakpoint moves
 *  the bands, the line's colour and the grading in one edit. */
const ASCENDING = [...CATEGORY_THRESHOLD_KT].sort((a, b) => a.min - b.min);

/** The label drawn at the right-hand end of each band. `TD` is deliberately
 *  absent: it is the strip below the tropical-storm floor and every storm has
 *  one, so labelling it spends ink on the least informative band. */
const BAND_LABEL = ['', 'TS', '1', '2', '3', '4', '5'];

/* ---------------------------------------------------------------------------
 * GEOMETRY
 * ------------------------------------------------------------------------ */

/**
 * The two scales this chart needs, or `null` when it has nothing to draw.
 *
 * ==> THE WIND AXIS TOPS OUT AT A FIXED FLOOR AND STRETCHES ONLY FOR A STORM
 * THAT BEATS IT. <== `SEASONS.lifeChartTopKt` carries the measurement. The
 * effect is that the bands are in the same place on 3,231 of 3,266 storms, so
 * a reader stepping through the archive learns one picture rather than a new
 * one per panel.
 *
 * ==> AND THE TIME AXIS IS THE STORM'S OWN LIFE, NOT A CALENDAR. <== Every
 * chart is exactly as wide as the panel, so a two-day storm and a month-long
 * one both fill it. The day ticks are what carry the real duration, which is
 * the whole reason they are day NUMBERS rather than two end labels.
 */
export function plotGeometry(facts, width = W) {
  const span = (facts?.lastTime ?? 0) - (facts?.firstTime ?? 0);
  if (!Number.isFinite(span) || span <= 0) return null;
  const peak = Number.isFinite(facts.peakWindKt) ? facts.peakWindKt : 0;
  const topKt = Math.max(SEASONS.lifeChartTopKt, peak);
  const plotW = width - PAD_X * 2;
  return {
    topKt,
    span,
    xOf: (time) => PAD_X + ((time - facts.firstTime) / span) * plotW,
    yOf: (kt) => PLOT_BOTTOM - (Math.max(0, Math.min(topKt, kt)) / topKt) * PLOT_H,
  };
}

/**
 * ==> THE FIXES THIS CHART CAN DRAW, AND THE GRADE EACH ONE CARRIES. <== A
 * fix with no wind is skipped rather than drawn at zero: HURDAT2 records a
 * missing wind as `-999` and `lib/hurdat.js` turns that into `null`, and a
 * line dropping to the baseline would state that the storm had stopped blowing.
 *
 * `graded` is false for a system that was not a tropical cyclone at this fix —
 * a wave or a low before genesis, an extratropical system after it. §57.7g:
 * neither has a severity to claim, so neither gets a Saffir-Simpson hue.
 */
export function chartPoints(facts) {
  const pts = (facts?.points || [])
    .filter((p) => Number.isFinite(p?.time) && Number.isFinite(p?.windKt))
    .sort((a, b) => a.time - b.time);
  if (pts.length < 2) return [];
  /* ==> A PRE-GENESIS FIX AND A POST-TROPICAL ONE ARE DRAWN IDENTICALLY HERE,
   * WHICH IS A DEPARTURE FROM §57.7g AND A DELIBERATE ONE. <== That section
   * splits the two by SIZE on the globe, because a small blank dot says "this
   * was never a storm" and a full lettered one says "it was". A line has no
   * size to split: both stretches are one stroke width, and the difference is
   * already carried by WHERE they sit — before the colour starts or after it
   * ends. Adding a second grey would be a distinction the eye cannot use. */
  return pts.map((p) => {
    const status = String(p.status || '').toUpperCase();
    const graded = SEASONS.cycloneStatuses.includes(status);
    return {
      time: p.time,
      windKt: p.windKt,
      graded,
      /* ==> A NON-CYCLONE FIX IS GREY WHATEVER ITS WIND. <== Sandy crossed New
       * Jersey at 80 kt as an `EX`, which is a real measured wind and not a
       * Category 1. The line still climbs to 80; only the ink changes. */
      color: graded ? CATEGORY_COLOR[gradeKey(p.windKt)] : null,
    };
  });
}

/** Wind to a `CATEGORY_COLOR` key. One function, so the bands and the line
 *  cannot disagree about where Cat 3 starts. */
function gradeKey(windKt) {
  const idx = categoryFromKt(windKt);
  return ['TD', 'TS', 'CAT1', 'CAT2', 'CAT3', 'CAT4', 'CAT5'][idx ?? 0];
}

/* ---------------------------------------------------------------------------
 * THE DAY AXIS
 * ------------------------------------------------------------------------ */

/** How often the ladder labels a day, for a track of this many days. */
function everyNth(days) {
  for (const [maxDays, step] of SEASONS.lifeChartDayLadder) {
    if (days <= maxDays) return step;
  }
  return 1;
}

/**
 * Where a day label is drawn.
 *
 * ==> A LABEL CENTRED ON A TICK AT THE EDGE OF THE PLOT LOSES HALF OF ITSELF.
 * <== Found on glass, 2026-08-30, on `Storm 3 1899`: its first tick sits at
 * x=4 and its label is the widest kind there is, so `Aug 3` rendered as `g 3`
 * with the month sheared off by the SVG's own boundary. The chart's time axis
 * was mislabelled at the one end a reader starts from, nothing threw, and it
 * looked deliberate.
 *
 * ==> IT CLAMPS THE CENTRE RATHER THAN PINNING TO AN EDGE, WHICH IS THE
 * SMALLER MOVE OF THE TWO. <== Pinning the label's own end to its tick is what
 * `ui/season-spine.js` does, and here it would shift a label by half its width
 * even when it overhung by three units. Clamping moves each one by exactly as
 * much as it has to and leaves one anchor for every label on the axis.
 *
 * @returns {{x:number, left:number, right:number}}
 */
export function axisLabelBox(label, tickX, width = W) {
  const w = label.includes(' ') ? MONTH_W : label.length * DIGIT_W;
  const lo = PAD_X + w / 2;
  const hi = width - PAD_X - w / 2;
  const x = hi < lo ? width / 2 : Math.min(hi, Math.max(lo, tickX));
  return { x, left: x - w / 2, right: x + w / 2 };
}

/**
 * The labels the axis actually draws, laid out and de-conflicted.
 *
 * ==> CLAMPING A LABEL INWARDS CAN PUSH IT INTO ITS NEIGHBOUR, SO THE TWO
 * RULES HAVE TO RUN TOGETHER. <== Measured 2026-08-30: fixing the clipped
 * `Aug 3` on its own put a fresh collision on `AL051856`, `AL031871`,
 * `AL051880` and others, because the widest label on the axis is the one that
 * moves furthest and it moves toward the next one.
 *
 * ==> AND WHEN TWO STILL COLLIDE, THE EARLIER ONE WINS. <== It is the one
 * carrying the month, at the end of the axis a reader starts from. That agrees
 * with `axisTicks`'s own month-evicts-a-neighbour rule rather than fighting
 * it — both say the more informative label keeps its place.
 *
 * This is the only thing that should draw a day label. It guarantees by
 * construction what `tools/test-season-life-chart.mjs` then verifies across
 * the archive: nothing clipped, nothing overlapping.
 */
export function axisLayout(facts, geo) {
  if (!geo) return [];
  const out = [];
  let prevRight = -Infinity;
  for (const t of axisTicks(facts)) {
    if (!t.label) continue;
    const box = axisLabelBox(t.label, geo.xOf(t.time));
    if (box.left < prevRight) continue;
    prevRight = box.right;
    out.push({ time: t.time, label: t.label, ...box });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A tick at every UTC midnight inside the track, labelled by the ladder.
 *
 * ==> THE LADDER ALONE LEAVES 28 STORMS WITH LABELS ON TOP OF EACH OTHER, AND
 * BOTH FIXES BELOW WERE FOUND BY READING THE FAILURES. <== Measured over all
 * 3,266 storms, 2026-08-30. Every one of the 28 was the identical shape: a
 * wide `Sep 1` printed one day after a narrow `31`, because a month change
 * forces a label out of the ladder's turn.
 *
 * 1. **A MONTH CHANGE RE-ANCHORS THE COUNT.** Without it `Storm 3 1899` prints
 *    `Aug 30 · Sep 1 · 2` — the forced label and then the ladder's own next
 *    tick, one day and eleven pixels later. Resetting at the forced label puts
 *    the next one a full step away. That alone takes 28 storms down to 21.
 * 2. **A MONTH LABEL EVICTS A CROWDED NEIGHBOUR.** The month change is the
 *    more informative of the two, so when the previous label is inside one
 *    step it loses its own. That takes 21 to **zero**.
 *
 * ==> THE SECOND RULE IS A COLLISION RULE AND IT LIVES HERE RATHER THAN IN THE
 * CONSTANT. <== `lifeChartDayLadder` is about cadence — how often a reader
 * wants a date — and it would still be the right ladder on a chart twice this
 * wide. These two are about 358 pixels.
 */
export function axisTicks(facts) {
  const span = (facts?.lastTime ?? 0) - (facts?.firstTime ?? 0);
  if (!Number.isFinite(span) || span <= 0) return [];

  const first = new Date(facts.firstTime);
  const midnight = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  let cursor = midnight < facts.firstTime ? midnight + DAY : midnight;

  const step = everyNth(span / DAY);
  const out = [];
  let n = 0;
  let lastMonth = first.getUTCMonth();

  while (cursor <= facts.lastTime) {
    const d = new Date(cursor);
    const monthChanged = d.getUTCMonth() !== lastMonth;
    lastMonth = d.getUTCMonth();
    if (monthChanged) n = 0;
    const show = n % step === 0 || monthChanged;
    if (monthChanged) {
      /* ==> IT WALKS BACK TO THE LAST LABELLED TICK, NOT TO THE LAST TICK.
       * <== Found by `tools/test-season-life-chart.mjs` rather than by
       * reasoning. `CP051997` runs 23.75 days, so the ladder labels every
       * third day: its ticks are `Nov 29` (labelled), `Nov 30` (blank), then
       * the month change on `Dec 1`. Looking one tick back found the BLANK
       * one, declined to evict anything, and printed two 30-unit month labels
       * 29.5 units apart. Every unlabelled tick in between has to be stepped
       * over, because a blank tick occupies no width. */
      for (let k = out.length - 1; k >= 0; k--) {
        if (!out[k].label) continue;
        if (cursor - out[k].time <= step * DAY) out[k].label = '';
        break;
      }
    }
    out.push({
      time: cursor,
      /* The month is spelled at the left end and wherever it changes, and
       * nowhere else — a column of `Aug 24 · Aug 25 · Aug 26` spends three
       * times the width to say one thing. */
      label: show
        ? ((out.length === 0 || monthChanged)
          ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
          : String(d.getUTCDate()))
        : '',
    });
    n++;
    cursor += DAY;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * THE LANDFALL DISCS
 * ------------------------------------------------------------------------ */

/**
 * The landfalls in the order they are numbered, with each one's place in
 * `facts.landfalls` carried alongside it.
 *
 * ==> THIS IS THE ONE PLACE THE NUMBERS ARE DECIDED, AND THAT IS THE WHOLE
 * POINT OF IT EXISTING. <== §57.60. The chart draws numbered discs and the
 * list under it prints the same numbers, and until step 6 those were two
 * independent walks over the same array: the chart sorted by time, the list
 * did not. **Measured across all 3,266 storms, 2026-08-30: zero storms carry
 * an out-of-order landfall list today**, so the two agreed — by luck, over a
 * sidecar that is written in time order because that is how the coast walk
 * meets the coast. Step 13 brings other agencies' tracks into the same
 * renderer and nothing guarantees they arrive sorted.
 *
 * The failure that would follow is silent and symmetrical (§57.59e): the
 * chart's discs and the list's numbers would each be internally consistent
 * and point at different landfalls, and nothing on screen would look wrong.
 * One function answers it for both.
 *
 * ==> `index` IS CARRIED BECAUSE THE PLACE NAMES ARE INDEX-ALIGNED TO THE
 * UNSORTED LIST. <== §57.40a. `places.landfalls` is written against
 * `facts.landfalls` in its own order, so a caller reading these in time order
 * must look a name up by where the mark came from rather than by where it now
 * sits. Reordering without that would print Port Sulphur beside a Florida
 * landfall — the exact fault §57.40a's length guard exists to prevent.
 *
 * The sort is stable (ES2019), so two landfalls stamped at the identical
 * minute keep the order the record put them in rather than swapping between
 * renders.
 *
 * @param {object} facts  `stormFacts`
 * @returns {Array<{mark: object, index: number, n: number}>} time order
 */
export function orderedLandfalls(facts) {
  const list = Array.isArray(facts?.landfalls) ? facts.landfalls : [];
  return list
    .map((mark, index) => ({ mark, index }))
    .sort((a, b) => a.mark.time - b.mark.time)
    .map((e, i) => ({ mark: e.mark, index: e.index, n: i + 1 }));
}

/**
 * Which row each numbered disc sits on, greedy first fit.
 *
 * ==> STACKING RATHER THAN SHARING, AND THE MEASUREMENT IS WHAT DECIDED IT.
 * <== §57.54d offered a shared disc at a minimum separation as the alternative.
 * Measured 2026-08-30, **206 storms of the 688 with two or more landfalls have
 * a pair closer than one disc width** — a quarter of them, with the tightest
 * at 0.95px on `ALBERTO 2000`. Merging on that many storms breaks the 1:1
 * match to the numbered list under the chart, and that match is the only
 * reason the numbering exists.
 *
 * ==> THE NUMBER IS THE LANDFALL'S PLACE IN THE LIST, NEVER ITS PLACE IN A
 * ROW. <== A disc that dropped to row 2 keeps the number it had, so the list
 * below reads 1, 2, 3 down the page whatever the chart had to do to fit them.
 */
export function discRows(facts, geo) {
  const marks = orderedLandfalls(facts);
  if (!marks.length || !geo) return [];
  const placed = [];
  for (let i = 0; i < marks.length; i++) {
    const x = geo.xOf(marks[i].mark.time);
    if (!Number.isFinite(x)) continue;
    let row = 0;
    while (
      row < SEASONS.lifeChartMaxDiscRows - 1
      && placed.some((p) => p.row === row && Math.abs(p.x - x) < SEASONS.lifeChartDiscPx)
    ) row++;
    /* ==> PAST THE LAST ROW A DISC IS CROWDED RATHER THAN DROPPED. <== §5.
     * Nothing in the archive reaches this today — four rows is the measured
     * maximum — but losing a landfall off the bottom of the chart while the
     * list below still numbers it would be a silence with a contradiction
     * attached. */
    placed.push({ n: marks[i].n, x, row, time: marks[i].mark.time });
  }
  return placed;
}

/* ---------------------------------------------------------------------------
 * THE MARKUP
 * ------------------------------------------------------------------------ */

const f1 = (n) => Number(n).toFixed(1);

/**
 * The whole chart, or `''` when this storm cannot carry one.
 *
 * ==> 32 STORMS IN THE ARCHIVE GET NOTHING, AND THE CALLER SAYS SO IN WORDS.
 * <== Measured 2026-08-30: 32 storms carry exactly one fix with a wind and a
 * zero-hour lifespan, so there is not one segment to draw. §57.25 rule 2 —
 * where the record is silent the panel says why, and an empty box would be the
 * shrug that rule exists to forbid. Returning `''` lets `section()`'s existing
 * empty-content rule do the rest.
 *
 * @param {object} facts   `stormFacts`, plus `points` from the storm
 * @param {object} opts
 * @param {string} [opts.summary]  the `aria-label`; the row's own words
 * @returns {string} HTML, or '' when there is no chart to draw
 */
export function lifeChartHtml(facts, { summary = '' } = {}) {
  const geo = plotGeometry(facts);
  if (!geo) return '';
  const pts = chartPoints(facts);
  if (pts.length < 2) return '';

  const parts = [];

  /* --- the Saffir-Simpson bands ---------------------------------------
   * ==> DRAWN AT A LOW OPACITY OUT OF THE REAL CATEGORY COLOURS, WHICH IS
   * BOTH THE RULE AND THE BETTER-LOOKING ANSWER. <== §6 forbids a second
   * Saffir-Simpson palette outright. Measured 2026-08-30, it costs nothing
   * either: composited at this opacity over the sepia panel the real colours
   * land within 15 of a re-themed set on a 442-point scale, and as the LINE
   * they are more legible, not less — Cat 5 goes from 4.13:1 to 5.85:1. */
  for (let i = 1; i < ASCENDING.length; i++) {
    const floor = ASCENDING[i].min;
    if (floor >= geo.topKt) break;
    const ceil = i + 1 < ASCENDING.length ? ASCENDING[i + 1].min : geo.topKt;
    const top = geo.yOf(Math.min(ceil, geo.topKt));
    const bottom = geo.yOf(floor);
    const h = bottom - top;
    if (h <= 0) continue;
    const key = ['TD', 'TS', 'CAT1', 'CAT2', 'CAT3', 'CAT4', 'CAT5'][i];
    parts.push(
      `<rect class="lifec-band" x="${PAD_X}" y="${f1(top)}" width="${PLOT_W}" `
      + `height="${f1(h)}" fill="${CATEGORY_COLOR[key]}"/>`,
    );
    /* The band's own name at its right-hand end. Skipped when the band is too
     * short to hold the glyph — which is what the top band is on almost every
     * storm, since `lifeChartTopKt` deliberately leaves Cat 5 a sliver. */
    if (h >= 9 && BAND_LABEL[i]) {
      parts.push(
        `<text class="lifec-band-label" x="${W - PAD_X - 3}" y="${f1(bottom - 2.5)}" `
        + `font-size="${BAND_SIZE}" fill="${CATEGORY_COLOR[key]}" `
        + `text-anchor="end">${BAND_LABEL[i]}</text>`,
      );
    }
  }

  /* --- the day axis ---------------------------------------------------- */
  /* Every midnight gets a tick; only some get a label. The ticks are what
   * carry the real duration, so thinning the labels never thins the grid. */
  for (const t of axisTicks(facts)) {
    const x = f1(geo.xOf(t.time));
    parts.push(
      `<line class="lifec-tick" x1="${x}" y1="${PLOT_BOTTOM}" x2="${x}" y2="${TICK_BOTTOM}"/>`,
    );
  }
  for (const l of axisLayout(facts, geo)) {
    parts.push(
      `<text class="lifec-axis" x="${f1(l.x)}" y="${TICK_LABEL_Y}" `
      + `font-size="${AXIS_SIZE}" text-anchor="middle">${esc(l.label)}</text>`,
    );
  }
  parts.push(
    `<line class="lifec-baseline" x1="${PAD_X}" y1="${PLOT_BOTTOM}" `
    + `x2="${W - PAD_X}" y2="${PLOT_BOTTOM}"/>`,
  );

  /* --- the line -------------------------------------------------------
   * ==> ONE `<line>` PER SEGMENT, COLOURED BY THE FIX IT LEAVES. <== A single
   * path cannot change colour partway, and a gradient would invent grades
   * between two measurements. Colouring by the START point means a segment
   * describes the strength the storm actually held over that stretch — the
   * grade it arrives at is the next segment's business. */
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    parts.push(
      /* ==> THE TWO CLASS NAMES ARE WRITTEN OUT IN FULL RATHER THAN BUILT
       * FROM THE FLAG. <== §57.56c learned this one commit ago:
       * `class="lifec-line${x}"` is shorter and `tools/css-orphan-check.mjs`
       * cannot see it, so it reported the rule as dead CSS — the check working
       * exactly as intended. A class a tool cannot grep is a class nobody can
       * find from the stylesheet either. */
      `<line class="${a.graded ? 'lifec-line' : 'lifec-line lifec-line-ungraded'}" `
      + `x1="${f1(geo.xOf(a.time))}" y1="${f1(geo.yOf(a.windKt))}" `
      + `x2="${f1(geo.xOf(b.time))}" y2="${f1(geo.yOf(b.windKt))}"`
      + (a.color ? ` stroke="${a.color}"` : '')
      + '/>',
    );
  }

  /* --- the peak -------------------------------------------------------
   * It is already the highest point on the line, so the dot is not telling
   * the reader something new — it is telling them WHICH of two similar humps
   * the panel's `Peak winds` row is about. */
  const peak = pts.reduce((best, p) => (!best || p.windKt > best.windKt ? p : best), null);
  if (peak) {
    parts.push(
      `<circle class="lifec-peak" cx="${f1(geo.xOf(peak.time))}" `
      + `cy="${f1(geo.yOf(peak.windKt))}" r="3.8"`
      + (peak.color ? ` fill="${peak.color}"` : '')
      + '/>',
    );
  }

  /* --- the landfalls --------------------------------------------------- */
  const discs = discRows(facts, geo);
  let deepest = 0;
  for (const d of discs) {
    if (d.row > deepest) deepest = d.row;
    const x = f1(d.x);
    const cy = DISC_ROW_Y + d.row * DISC_ROW_PITCH;
    parts.push(
      `<line class="lifec-drop" x1="${x}" y1="${PLOT_TOP}" x2="${x}" y2="${PLOT_BOTTOM}"/>`,
      `<circle class="lifec-disc" cx="${x}" cy="${cy}" r="${SEASONS.lifeChartDiscPx / 2}"/>`,
      `<text class="lifec-disc-n" x="${x}" y="${cy + 3.5}" font-size="${DISC_SIZE}" `
      + `text-anchor="middle">${d.n}</text>`,
    );
  }

  /* The year and the clock, once, bottom right. Every date on the axis is a
   * day number, so the year has to be stated somewhere or the chart is the
   * only thing on the panel that does not say when it happened.
   *
   * ==> IT GETS A LINE BELOW EVERYTHING, AT EVERY DEPTH OF DISC STACK. <==
   * §57.59i. The bottom of the drawing is the deepest disc row when there are
   * discs and the day labels when there are none, and the stamp clears
   * whichever it is. Placing it against a fixed y would put it back inside the
   * stack the moment a storm needed one more row. */
  const drawnBottom = discs.length
    ? DISC_ROW_Y + deepest * DISC_ROW_PITCH + SEASONS.lifeChartDiscPx / 2
    : TICK_LABEL_Y + 4;
  const stampY = drawnBottom + STAMP_DROP;
  parts.push(
    `<text class="lifec-axis" x="${W - PAD_X}" y="${f1(stampY)}" font-size="${AXIS_SIZE}" `
    + `text-anchor="end">${esc(String(facts.year ?? ''))} · UTC</text>`,
  );

  const height = stampY + STAMP_TAIL;

  return '<figure class="lifec">'
    + `<svg class="lifec-plot" viewBox="0 0 ${W} ${f1(height)}" role="img" `
    + `aria-label="${esc(summary || 'wind speed over the storm\u2019s life')}">`
    + parts.join('')
    + '</svg>'
    + '<figcaption class="detail-note">Wind at every recorded position. The bands '
    + 'are the Saffir-Simpson grades'
    + (discs.length ? '; the numbered marks are the landfalls listed below.' : '.')
    + '</figcaption>'
    + '</figure>';
}

/**
 * The chart's `aria-label`, in the same words the sections below use.
 *
 * ==> IT IS A SUMMARY AND NOT A TRANSCRIPT. <== A screen reader handed forty
 * coordinates reads a shape it cannot use. Every fact the picture carries is
 * written out in `How hard it blew`, `Landfalls` and the paragraph above, so
 * this says what KIND of thing the reader is looking at and what its shape is.
 */
export function lifeChartSummary(facts, { peakWords = '' } = {}) {
  const days = Math.round((facts?.lifespanHours ?? 0) / 24);
  const bits = ['Wind over the storm\u2019s life'];
  if (days >= 1) bits.push(`${days} day${days === 1 ? '' : 's'} of records`);
  if (peakWords) bits.push(`peaking at ${peakWords}`);
  const n = (facts?.landfalls || []).length;
  if (n) bits.push(`${n} landfall${n === 1 ? '' : 's'} marked`);
  return `${bits.join(', ')}.`;
}

/**
 * What the panel says instead of a chart. §5, §57.25 rule 2.
 *
 * ==> THE SENTENCE TEACHES SOMETHING TRUE ABOUT THE RECORD RATHER THAN
 * APOLOGISING. <== These 32 storms are single-observation entries: somebody
 * saw the system once and it was never seen again. That is a fact about 19th
 * and early 20th century observation, and it is more interesting than a blank
 * box would have been honest.
 */
export function lifeChartAbsenceWords(facts) {
  const n = (facts?.points || []).filter((p) => Number.isFinite(p?.windKt)).length;
  if (n <= 1) {
    return 'The record holds a single observation of this storm, so there is no '
      + 'course of its life to chart. It was seen once and not again.';
  }
  return 'The record does not hold enough of this storm\u2019s life to chart it.';
}

export { W as LIFE_CHART_WIDTH, PLOT_TOP, PLOT_BOTTOM, PAD_X };
