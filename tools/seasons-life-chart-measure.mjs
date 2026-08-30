/**
 * seasons-life-chart-measure.mjs — the two numbers §57.54d demands BEFORE a
 * line of the life chart is written. SPEC-SEASONS-BUILD.md §57.54d, §57.59.
 *
 * ==> IT PRINTS ARITHMETIC AND SHIPS NOTHING. <== Same job as
 * `tools/near-home-size.mjs` and `tools/seasons-height-measure.mjs`: a figure
 * that ends up in the spec or in a constant's comment is produced by running
 * this against the real archive, never written from memory. `CLAUDE.md`.
 *
 * The two questions, both named in §57.54d as unmeasured:
 *
 * 1. **COLLIDING LANDFALL DISCS.** Two landfalls six hours apart put two
 *    numbered discs on top of each other at 358px wide. Nobody had counted how
 *    many storms are in that position, and the lever depends entirely on the
 *    answer: a handful means a minimum separation with a shared disc, hundreds
 *    means a second row.
 *
 * 2. **THE DAY AXIS ON THE LONGEST TRACK.** `Storm 3 1899` runs 786 hours.
 *    §57.54d's thinning ladder has to leave labels that fit rather than
 *    collide, and 33 days of ticks across 358px is under 11px a day.
 *
 * ==> IT DELIBERATELY IMPORTS NOTHING FROM `ui/season-life-chart.js`. <== The
 * whole point of measuring first is that the collision count DECIDES the disc
 * design, so a measurement that ran through the renderer would be answering a
 * question with the answer. The one piece of geometry it needs — a fix's time
 * as a fraction of the storm's own life — is stated here in one line, and the
 * renderer is asserted against these figures afterwards by
 * `tools/test-season-life-chart.mjs`.
 *
 * Node only. Reads the repo, writes nothing, no network.
 *
 *   node tools/seasons-life-chart-measure.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHurdat2 } from '../lib/hurdat.js';
import { stormFacts } from '../lib/season-facts.js';
import { landfallFileName } from '../lib/seasons-sidecar.js';

const DATA_DIR = 'seasons/data';
const INDEX_FILE = 'seasons/index.json';

/* ==> THE WIDTH EVERY PIXEL FIGURE BELOW IS QUOTED AT. <== 358px is the
 * panel's inner width inside a 390px phone, which is the width §57.65 already
 * measures the distribution bar's seam at. One number, one place, and the
 * narrowest the chart is ever drawn at. */
const PANEL_PX = 358;

const HOURS = 3600 * 1000;

/* ---------------------------------------------------------------------------
 * READING THE ARCHIVE — the cumulative pair, never a glob
 * ------------------------------------------------------------------------- */

/**
 * ==> THE WHOLE-BASIN FILES, NOT `seasons/data/*.txt`. <== That directory
 * holds the per-season slices AND the two cumulative files, so a glob visits
 * every storm twice. `tools/seasons-rankings.mjs` carries the same warning and
 * the same 2x that cost it a week.
 */
function basins() {
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const out = [];
  for (const [basin, meta] of Object.entries(index.basins || {})) {
    if (!meta?.file) throw new Error(`the index carries no cumulative file for ${basin}`);
    out.push({
      basin,
      file: meta.file.startsWith('/') ? meta.file.slice(1) : join(DATA_DIR, meta.file),
      /* The sidecar's name is built by the same helper the app builds it with,
       * so a revision bump moves both together. */
      marks: meta.revision ? join(DATA_DIR, landfallFileName(basin, meta.revision)) : null,
    });
  }
  if (!out.length) throw new Error('the index names no basins');
  return out;
}

/**
 * Every storm in the archive, with the computed landfall sidecar attached the
 * way `data/seasons.js` attaches it on the phone.
 *
 * ==> IT MUST BE THE COMPUTED LIST AND NOT NOAA'S. <== §57.7a. NOAA marked 839
 * storms and the walk finds 1,435, and the extra ones are exactly the storms a
 * disc has to be drawn for. Measuring collisions against the fallback would
 * count a fraction of the real cases and under-size the problem.
 */
function archive() {
  const storms = [];
  for (const b of basins()) {
    const parsed = parseHurdat2(readFileSync(b.file, 'utf8'), { basin: b.basin });
    let marks = null;
    if (b.marks) {
      try {
        marks = JSON.parse(readFileSync(b.marks, 'utf8'));
      } catch {
        marks = null;
      }
    }
    if (!marks?.storms) throw new Error(`no computed landfalls for ${b.basin} — measure would lie`);
    for (const s of parsed.storms || []) {
      s.landfallsComputed = marks.storms[s.id] || [];
      storms.push(s);
    }
  }
  return storms;
}

/* ---------------------------------------------------------------------------
 * QUESTION 1 — colliding landfall discs
 * ------------------------------------------------------------------------- */

/**
 * Where a moment sits along the plot, in device pixels.
 *
 * ==> A COLLISION IS ABOUT THE STORM'S OWN LIFE AND NOT ABOUT THE CLOCK. <==
 * Two landfalls six hours apart collide on a two-day storm and do not on a
 * month-long one, because the x axis is the storm from birth to last fix. That
 * is the whole of the geometry this question needs.
 */
const xOf = (facts, time, width) => {
  const span = facts.lastTime - facts.firstTime;
  if (!(span > 0)) return null;
  return ((time - facts.firstTime) / span) * width;
};

function collisions(facts) {
  const perStorm = [];
  let withTwo = 0;
  let totalDiscs = 0;
  let withAny = 0;

  for (const f of facts) {
    const marks = f.landfalls || [];
    totalDiscs += marks.length;
    if (marks.length) withAny++;
    if (marks.length < 2) continue;
    withTwo++;

    const xs = marks
      .map((m) => xOf(f, m.time, PANEL_PX))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
    if (xs.length < 2) continue;

    let closest = Infinity;
    let closestHours = Infinity;
    const times = marks.map((m) => m.time).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      if (gap < closest) {
        closest = gap;
        closestHours = (times[i] - times[i - 1]) / HOURS;
      }
    }
    perStorm.push({
      id: f.id, name: f.name, year: f.year, n: marks.length, closest, closestHours,
    });
  }

  return { perStorm, withTwo, totalDiscs, withAny };
}

/**
 * How many ROWS a storm's discs need if a colliding disc drops to the row
 * below rather than merging with its neighbour.
 *
 * ==> THIS IS THE SECOND HALF OF QUESTION 1 AND THE FIRST HALF FORCED IT. <==
 * §57.54d named two levers — a shared disc, or a second row — and the
 * collision count rules the shared disc out on its own: merging two landfalls
 * into one mark on 206 storms breaks the 1:1 match to the numbered list, which
 * is the entire reason the numbering exists. So the only question left is how
 * DEEP the stack has to go, and that decides how much height the chart spends.
 *
 * Greedy, first fit: a disc takes the topmost row where it clears everything
 * already on it.
 */
function rowsNeeded(facts, disc) {
  const rows = [];
  for (const f of facts) {
    const marks = (f.landfalls || []).slice().sort((a, b) => a.time - b.time);
    if (!marks.length) continue;
    const placed = [];
    let deepest = 1;
    for (const m of marks) {
      const x = xOf(f, m.time, PANEL_PX);
      if (x === null) continue;
      let row = 0;
      while (placed.some((p) => p.row === row && Math.abs(p.x - x) < disc)) row++;
      placed.push({ row, x });
      if (row + 1 > deepest) deepest = row + 1;
    }
    rows.push({ id: f.id, name: f.name, year: f.year, n: marks.length, deepest });
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * QUESTION 2 — the day axis on the longest track
 * ------------------------------------------------------------------------- */

/**
 * §57.54d's thinning ladder, stated here rather than imported for the reason
 * at the top of this file: it is one of the things being checked.
 *
 * Every day up to 10, every second to 20, every third to 34, every fifth
 * beyond.
 */
function everyNth(days) {
  if (days <= 10) return 1;
  if (days <= 20) return 2;
  if (days <= 34) return 3;
  return 5;
}

const MONTH_WINS = !process.argv.includes('--no-monthwins');
const RE_ANCHOR = !process.argv.includes('--no-reanchor');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The ticks the ladder produces for one storm: one at every UTC midnight
 * inside the track, labelled with the day number, and with the month spelled
 * out at the left end and wherever it changes.
 */
function ticksFor(facts) {
  const first = new Date(facts.firstTime);
  const out = [];
  /* The first midnight at or after the storm's first fix. */
  const t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  let cursor = t < facts.firstTime ? t + 24 * HOURS : t;
  let n = 0;
  let lastMonth = first.getUTCMonth();
  const step = everyNth(facts.lifespanHours / 24);
  while (cursor <= facts.lastTime) {
    const d = new Date(cursor);
    const monthChanged = d.getUTCMonth() !== lastMonth;
    lastMonth = d.getUTCMonth();
    /* ==> A MONTH CHANGE RE-ANCHORS THE LADDER RATHER THAN INTERRUPTING IT.
     * <== Measured: without this, `Storm 3 1899` prints `Aug 30 · Sep 1 · 2` —
     * the month label is forced on the 1st and the ladder's own next tick
     * lands on the 2nd, one day and eleven pixels later. Resetting the count
     * at the forced label means the next one is a full step away. */
    if (monthChanged && RE_ANCHOR) n = 0;
    const show = n % step === 0 || monthChanged;
    /* ==> AND A MONTH LABEL EVICTS THE ONE BEFORE IT WHEN THEY ARE CROWDED.
     * <== Every one of the 21 remaining overlaps is the same shape, measured
     * rather than guessed: `Aug 31 · Sep 1`, a wide month label one day after
     * a narrow ladder tick. The month change is the more informative of the
     * two, so it wins and the neighbour is dropped. */
    if (monthChanged && MONTH_WINS && out.length) {
      const prev = out[out.length - 1];
      if (prev.label && cursor - prev.time <= step * 24 * HOURS) prev.label = '';
    }
    out.push({
      time: cursor,
      label: show
        ? ((out.length === 0 || monthChanged)
          ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
          : String(d.getUTCDate()))
        : '',
    });
    n++;
    cursor += 24 * HOURS;
  }
  return out;
}

/**
 * ==> THE WIDTH IS AN UPPER BOUND RATHER THAN A RENDER. <== Nothing in node
 * can measure text. The axis is `--type-micro` at 10px in `--font-numeric`, so
 * a digit is about 0.6em — 6px — and a month label like `Sep 1` is about 30px.
 * Both are quoted here as bounds, and the real answer comes off a browser in
 * `tools/seasons-life-chart-check.mjs`.
 */
const DIGIT_PX = 6;
const MONTH_PX = 30;

function axisReport(facts) {
  const ticks = ticksFor(facts);
  const labelled = ticks.filter((t) => t.label);
  let widest = 0;
  let overlaps = 0;
  let prevRight = -Infinity;
  for (const t of labelled) {
    const w = t.label.includes(' ') ? MONTH_PX : t.label.length * DIGIT_PX;
    if (w > widest) widest = w;
    const x = xOf(facts, t.time, PANEL_PX);
    if (x === null) continue;
    if (x - w / 2 < prevRight) overlaps++;
    prevRight = x + w / 2;
  }
  return {
    hours: facts.lifespanHours,
    days: facts.lifespanHours / 24,
    step: everyNth(facts.lifespanHours / 24),
    ticks: ticks.length,
    labelled: labelled.length,
    pitchPx: ticks.length > 1 ? PANEL_PX / (facts.lifespanHours / 24) : PANEL_PX,
    widest,
    overlaps,
    labels: labelled.map((t) => t.label),
  };
}

/* ---------------------------------------------------------------------------
 * REPORT
 * ------------------------------------------------------------------------- */

const storms = archive();
const facts = storms.map((s) => stormFacts(s)).filter(Boolean);
console.log(`archive: ${storms.length} storms parsed, ${facts.length} with facts`);
console.log(`plot width quoted at ${PANEL_PX}px — the panel inside a 390px phone\n`);

const { perStorm, withTwo, totalDiscs, withAny } = collisions(facts);
console.log('--- 1. COLLIDING LANDFALL DISCS -------------------------------');
console.log(`storms with any landfall: ${withAny}`);
console.log(`landfall marks in total:  ${totalDiscs}`);
console.log(`storms with 2 or more:    ${withTwo}`);
console.log(`  of those, measurable:   ${perStorm.length}\n`);

for (const d of [8, 10, 12, 14, 16, 18, 20, 24]) {
  const hit = perStorm.filter((s) => s.closest < d);
  console.log(
    `  disc ${String(d).padStart(2)}px: ${String(hit.length).padStart(4)} storms collide`
    + ` — ${((hit.length / facts.length) * 100).toFixed(2)}% of the archive,`
    + ` ${((hit.length / withTwo) * 100).toFixed(1)}% of the multi-landfall storms`,
  );
}

const tightest = perStorm.slice().sort((a, b) => a.closest - b.closest).slice(0, 10);
console.log('\n  the ten tightest pairs in the archive:');
for (const s of tightest) {
  console.log(
    `    ${s.id} ${String(s.name).padEnd(12)} ${s.year} — ${s.n} landfalls,`
    + ` closest ${s.closest.toFixed(2)}px (${s.closestHours.toFixed(1)} h apart)`,
  );
}

const gaps = perStorm.map((s) => s.closest).sort((a, b) => a - b);
const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor((p / 100) * gaps.length))];
console.log('\n  closest-gap percentiles across the multi-landfall storms:');
console.log(`    p5 ${pct(5).toFixed(1)}px · p25 ${pct(25).toFixed(1)}px · median ${pct(50).toFixed(1)}px`
  + ` · p75 ${pct(75).toFixed(1)}px · p95 ${pct(95).toFixed(1)}px`);

console.log('\n  rows needed if a colliding disc drops to the row below:');
for (const disc of [12, 14, 16]) {
  const rows = rowsNeeded(facts, disc);
  const hist = new Map();
  for (const r of rows) hist.set(r.deepest, (hist.get(r.deepest) || 0) + 1);
  const keys = [...hist.keys()].sort((a, b) => a - b);
  const spread = keys.map((k) => `${k} row${k > 1 ? 's' : ''}: ${hist.get(k)}`).join(' · ');
  console.log(`    disc ${disc}px — ${spread}`);
  const worstRow = rows.slice().sort((a, b) => b.deepest - a.deepest)[0];
  console.log(`      deepest: ${worstRow.id} ${worstRow.name} ${worstRow.year}`
    + ` — ${worstRow.n} landfalls in ${worstRow.deepest} rows`);
}

console.log('\n--- 2. THE DAY AXIS -------------------------------------------');
const byLife = facts.slice().sort((a, b) => b.lifespanHours - a.lifespanHours);
const longest = byLife[0];
const shortest = facts
  .filter((f) => f.landfalls.length && f.lifespanHours >= 36)
  .sort((a, b) => a.lifespanHours - b.lifespanHours)[0];

for (const f of [longest, byLife[1], shortest].filter(Boolean)) {
  const r = axisReport(f);
  console.log(`\n  ${f.id} ${f.name} ${f.year} — ${r.hours.toFixed(0)} h (${r.days.toFixed(2)} days)`);
  console.log(`    every ${r.step} day(s) labelled`);
  console.log(`    ticks drawn:    ${r.ticks}`);
  console.log(`    labels printed: ${r.labelled}`);
  console.log(`    day pitch:      ${r.pitchPx.toFixed(2)}px`);
  console.log(`    widest label:   ~${r.widest}px (bound, not a render)`);
  console.log(`    overlaps:       ${r.overlaps}`);
  console.log(`    labels:         ${r.labels.join(' · ')}`);
}

const worst = facts
  .map((f) => ({ f, r: axisReport(f) }))
  .sort((a, b) => b.r.overlaps - a.r.overlaps)[0];
console.log(`\n  worst overlap in the whole archive: ${worst.f.id} ${worst.f.name} ${worst.f.year}`
  + ` — ${worst.r.overlaps} overlapping labels over ${worst.r.days.toFixed(1)} days`);
const anyOverlap = facts.map((f) => axisReport(f)).filter((r) => r.overlaps > 0).length;
console.log(`  storms with ANY overlapping label: ${anyOverlap} of ${facts.length}`);

/* The stragglers, named rather than counted, because 21 is small enough to
 * read and a pattern in them is the difference between a rule to add and a
 * cost to accept. */
console.log('\n  every storm with an overlapping label:');
for (const f of facts) {
  const r = axisReport(f);
  if (!r.overlaps) continue;
  console.log(`    ${f.id} ${String(f.name).padEnd(12)} ${f.year} — ${r.days.toFixed(2)} d,`
    + ` step ${r.step}, pitch ${r.pitchPx.toFixed(1)}px: ${r.labels.join(' · ')}`);
}

/* ==> THE SHORT END, WHICH IS WHERE AN AXIS SAYS NOTHING RATHER THAN TOO MUCH.
 * <== A storm shorter than one UTC day can contain no midnight at all, so the
 * ladder produces an EMPTY axis and the reader gets a chart with no time on
 * it. §5 at the size of an axis: count them rather than discover it on glass. */
const tickCounts = new Map();
for (const f of facts) {
  const n = ticksFor(f).filter((t) => t.label).length;
  tickCounts.set(n, (tickCounts.get(n) || 0) + 1);
}
console.log('\n  labels printed, across the whole archive:');
for (const n of [...tickCounts.keys()].sort((a, b) => a - b).slice(0, 6)) {
  console.log(`    ${n} label(s): ${tickCounts.get(n)} storms`);
}
const bare = facts.filter((f) => ticksFor(f).filter((t) => t.label).length === 0);
console.log(`  storms whose axis would be COMPLETELY EMPTY: ${bare.length}`);
if (bare.length) {
  const b = bare.slice().sort((a, b2) => a.lifespanHours - b2.lifespanHours);
  console.log(`    shortest ${b[0].id} ${b[0].year} at ${b[0].lifespanHours} h;`
    + ` longest ${b[b.length - 1].id} ${b[b.length - 1].year} at ${b[b.length - 1].lifespanHours} h`);
}

/* ==> AND THE STORMS THAT CANNOT BE CHARTED AT ALL, WHICH IS A REFUSAL RATHER
 * THAN AN EMPTY BOX. <== §5, §57.25 rule 2. A chart needs two fixes carrying a
 * wind to draw one segment. Fewer than that is a sentence about the record,
 * the way every other absence on this panel is. */
let noWind = 0;
let oneWind = 0;
let zeroSpan = 0;
for (const s of storms) {
  const pts = (s.points || []).filter((p) => Number.isFinite(p?.time));
  const w = pts.filter((p) => Number.isFinite(p.windKt));
  if (!w.length) noWind++;
  else if (w.length === 1) oneWind++;
  const f = stormFacts(s);
  if (f && f.lifespanHours === 0) zeroSpan++;
}
console.log('\n  storms a line cannot be drawn for:');
console.log(`    no wind on any fix:      ${noWind}`);
console.log(`    exactly one wind fix:    ${oneWind}`);
console.log(`    zero-hour lifespan:      ${zeroSpan}`);
