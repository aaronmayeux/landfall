#!/usr/bin/env node
/**
 * test-env-health.mjs — the storm health paragraph against real bytes. §47.8.
 *
 * WHAT THIS IS FOR. §47.8 generates English sentences with numbers in them —
 * the single easiest place in the app to be fluently wrong. Its own spec's
 * worked cases were hand-typed wrong twice. So this suite asserts the four
 * acceptance storms FIGURE BY FIGURE, each expected value computed from the
 * fixture by the run that wrote it into the spec — never from memory.
 *
 * ==> THE CLOCK IS PINNED OR THE SUITE IS MEANINGLESS. <== Every time in the
 * paragraph is the reader's local day and part of day; the acceptance cases
 * are computed for US Central. TZ is forced before the first Date is built,
 * and the suite refuses to run if the pin did not take (a CI box that ignores
 * TZ would otherwise pass on times no case ever asserted).
 *
 * Zero dependencies. Run: node tools/test-env-health.mjs
 */

process.env.TZ = 'America/Chicago';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { parseShips } = await import(path.join(ROOT, 'functions/api/nhc/_ships-parse.js'));
const { envHealth } = await import(path.join(ROOT, 'lib/env-health.js'));
const { closeWindParts, windDelta } = await import(path.join(ROOT, 'lib/units.js'));
const { formatDayPart } = await import(path.join(ROOT, 'lib/time.js'));

let failures = 0;
const ok = (label) => console.log(`  \u2713 ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  \u2717 ${label}${detail ? `\n      ${detail}` : ''}`);
};
const truthy = (label, v) => (v ? ok(label) : fail(label));
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(label) : fail(label, `expected ${e}\n      actual   ${a}`);
};
/** The sentence containing a phrase — asserting placement, not just presence
 *  somewhere in the paragraph. */
const inSentence = (label, sentences, index, phrase) => {
  const s = sentences[index] || '';
  s.includes(phrase) ? ok(label) : fail(label, `sentence ${index}: ${JSON.stringify(s)}\n      missing  ${JSON.stringify(phrase)}`);
};
const notIn = (label, sentences, phrase) => {
  const hit = sentences.find((s) => s.includes(phrase));
  hit ? fail(label, `found ${JSON.stringify(phrase)} in ${JSON.stringify(hit)}`) : ok(label);
};

/* The pin check. getTimezoneOffset for CDT in August is 300 minutes. */
if (new Date('2026-08-15T06:00:00Z').getTimezoneOffset() !== 300) {
  console.error('TZ pin did not take — this suite computes US Central times and cannot run.');
  process.exit(1);
}

const load = (id) =>
  parseShips(readFileSync(path.join(ROOT, 'samples', 'ships', `${id}_ships.txt`), 'utf8'));
const paragraph = (run, opts = {}) =>
  envHealth({ status: 'ok', run }, { system: 'imperial', ...opts });

/* ---------------------------------------------------------------------------
 * THE FOUR ACCEPTANCE STORMS, §47.8 — figure by figure, all computed.
 *
 * ==> THE PARAGRAPH AND THE GRID ARE ONE ANSWER AND ARE ASSERTED AS ONE. <==
 * Since the figures left the prose, a build could ship a perfectly readable
 * paragraph whose grid names a factor the sentence never mentions, or whose
 * cells do not add up to the total printed above them. Both read fine. So each
 * storm below asserts the sentences, the grid's hour, its total, every cell in
 * order, and the closure — and the closure is checked by ADDING THE PRINTED
 * CELLS, never by re-deriving them, because a test that recomputes the thing it
 * is checking agrees with the bug.
 * ------------------------------------------------------------------------- */

/** Cell labels in order, e.g. ['Wind shear', 'Rounding']. */
const cellLabels = (out) => out.figures.cells.map((c) => c.label);
/** Cell values in order, as printed. */
const cellValues = (out) => out.figures.cells.map((c) => c.value);

/** Parse a printed figure back to a number: "−2 mph" → −2. The real minus
 *  sign is deliberate everywhere in this app, so it is handled here rather
 *  than assumed away. */
const figNum = (text) => Number(String(text).replace('\u2212', '-').replace(/[^\d.-]/g, ''));

/** The whole point of the grid: what is printed adds up to what is printed. */
const closes = (label, out) => {
  const sum = out.figures.cells.reduce((a, c) => a + figNum(c.value), 0);
  const total = figNum(out.figures.total);
  sum === total ? ok(label) : fail(label, `cells sum to ${sum}, total says ${total}`);
};

const noteHas = (label, out, phrase) => {
  const hit = out.notes.some((n) => n.includes(phrase));
  hit ? ok(label) : fail(label, `notes: ${JSON.stringify(out.notes)}\n      missing  ${JSON.stringify(phrase)}`);
};

console.log('\nHernan — 26081506EP0826 — turning against, everything agreeing');
{
  const run = load('26081506EP0826');
  const out = paragraph(run);
  eq('kind', out.kind, 'paragraph');
  const s = out.sentences;
  /* Verdict: shape, peak, time, agreement. −11 kt at +60 h → −13 mph,
   * Sat 06 UTC + 60 h = Mon 1 PM Central. Push 1, pull −12 → ratio 0.85. */
  inSentence('verdict names the turn', s, 0, 'turns against Hernan steadily');
  inSentence('starts about even, not "neutral"', s, 0, 'The environment is about even now');
  inSentence('peak −13 mph', s, 0, 'reaching −13 mph');
  inSentence('peak time Monday afternoon', s, 0, 'by Monday afternoon');
  notIn('no agreement clause on a non-neutral verdict — the next sentence says it better',
    s, 'pulling the same way');
  /* The story sentence carries NO figures — they are all in the grid. */
  eq('story sentence names the lead, then the other side on its own', s[1],
    'Most of that is wind shear. The only thing working in its favor is warm moist air.');
  truthy('no figures in the story sentence', !/[+\u2212]\d/.test(s[1]));
  /* Room at the fix: 30 kt → 35 mph under a 139 kt → 160 mph ceiling. 22% of
   * its ceiling is plenty of room by any reading. Structure at +60: −10 kt. */
  inSentence('plenty of room', s, 2, 'There is plenty of room to grow — 35 mph over water that could hold 160 mph');
  inSentence('structure costs 12', s, 2, 'its own structure costs 12 mph');
  /* Bottom line: V (KT) LAND 30 → 22 kt at +60 → 35 → 25 mph, and the room
   * clause, because nothing above it claimed the slot. */
  inSentence('bottom line falls 35 → 25', s, 3, 'falling from 35 mph to 25 mph');
  inSentence('named in plain words, never "SHIPS"', s, 3, 'The intensity model');
  inSentence('room is there and unused', s, 3, 'so the room is there and nothing is using it');
  notIn('no decay-share clause (8 kt fall, 11 kt env)', s, 'its own decay');
  /* The grid at +60 h ONLY: shear −8 kt → 9 mph, divergence −2, thetaE +1,
   * midRh −1; oceanHeat −1 omitted → "Everything else". */
  eq('grid hour', out.figures.when, 'Monday afternoon');
  eq('grid total', out.figures.total, '\u221213 mph');
  eq('grid labels', cellLabels(out),
    ['Wind shear', 'Air flowing out the top', 'Warm moist air', 'Moisture around it', 'Everything else']);
  eq('grid values', cellValues(out),
    ['\u22129 mph', '\u22122 mph', '+1 mph', '\u22121 mph', '\u22122 mph']);
  closes('grid closes on its own total', out);
  noteHas('headroom has a home now', out, "the sea's ceiling adds 17 mph");
  noteHas('structure beside it', out, "the storm's own structure costs 12 mph");
  noteHas('the note says which hour it belongs to', out, 'At that same hour');
  noteHas('and that neither is in the total above', out, 'not counted above');
  /* ==> NO SIGNED FIGURE MAY REACH A SENTENCE. <== "its own structure +0 mph"
   * shipped and is a number pretending to be information. Signs are the grid's
   * register; a sentence says adds, costs, or counts for nothing. */
  truthy('no signed figures anywhere in the notes',
    !out.notes.some((n) => /[+\u2212]\d/.test(n)));
  noteHas('provenance last', out, "From NHC's SHIPS intensity model.");
}

console.log('\n94L — 26081506AL9426 — early help, then against; strengthening in spite of it');
{
  const run = load('26081506AL9426');
  const out = paragraph(run, { stormName: '94L' });
  const s = out.sentences;
  /* Early positive excursion into the helping band before the fall. Peak
   * −7 kt first at +96 h → −8 mph, Sat 06 UTC + 96 h = Wed 1 AM Central. */
  inSentence('early help named', s, 0, 'helps 94L mildly for the first day');
  inSentence('then turns against', s, 0, 'then turns against it');
  inSentence('peak −8 mph', s, 0, 'reaching −8 mph');
  inSentence('peak time early Wednesday', s, 0, 'by early Wednesday');
  /* Nothing leads (top term 2 kt of net 7), and the sentence says SO rather
   * than listing four signed figures at the reader. */
  eq('nothing leads, and the noun is supplied', s[1],
    'That cost is spread across several factors rather than one, the largest being cold air above it and moisture around it. The only thing working in its favor is wind shear.');
  /* The noun echoes the verdict's own verb one sentence earlier. */
  truthy('the verdict said costing, so the next sentence says cost',
    s[0].includes('reaching \u22128 mph') && s[1].startsWith('That cost'));
  notIn('never reuses "behind it", which means HELPING one sentence earlier', s, 'is behind it');
  /* Room: 25 kt over a 137 kt ceiling → 29 mph over 158 mph. */
  inSentence('plenty of room', s, 2, 'There is plenty of room to grow — 29 mph over water that could hold 158 mph');
  inSentence('structure costs 5', s, 2, 'its own structure costs 5 mph');
  /* Bottom line: rising to 60 kt at +120 (last drawable) → 69 mph, early
   * Thursday — NOT the +168 h wind the file also publishes. The slows-not-
   * stops clause claims the slot, so no room clause is appended: one clause
   * per sentence. */
  inSentence('bottom line 69 mph', s, 3, 'reaching 69 mph');
  inSentence('bottom line early Thursday', s, 3, 'by early Thursday');
  inSentence('slows-not-stops clause', s, 3, 'slows it rather than stopping it');
  notIn('and no second clause stacked on it', s, 'using some of that room');
  /* Terms at +96 h: tempAloft −2, midRh −2, shear +1, thetaE −1 named;
   * vorticity, divergence, tempAdvection omitted → "Everything else". */
  eq('grid hour', out.figures.when, 'early Wednesday');
  eq('grid total', out.figures.total, '\u22128 mph');
  eq('grid labels', cellLabels(out),
    ['Cold air above it', 'Moisture around it', 'Wind shear', 'Warm moist air', 'Everything else']);
  eq('grid values', cellValues(out),
    ['\u22122 mph', '\u22122 mph', '+1 mph', '\u22121 mph', '\u22124 mph']);
  closes('grid closes on its own total', out);
  noteHas('headroom at that hour', out, "the sea's ceiling adds 45 mph");
  /* §47.6's fourth case: positions stop at +120 while winds run to +168. It
   * is a NOTE now, not a fifth sentence competing with the story. */
  noteHas('partial-track note says what actually runs short', out,
    'publishes wind further along the track than it publishes positions');
  truthy('and it is not in the prose', !s.some((x) => x.includes('stop partway')));
  /* The app's name, not the file header's INVEST. */
  notIn('file header name never leaks', s, 'Invest');
}

console.log('\nLala — 26081506CP0126 — brief dip, then turning for');
{
  const run = load('26081506CP0126');
  const out = paragraph(run);
  const s = out.sentences;
  /* Dip −4 kt at +24 h → Sunday; peak +12 kt at +120 h → +14 mph, early
   * Thursday. Push 16, pull 4 → ratio 0.6 → disagreement clause. */
  inSentence('dip named day-only', s, 0, 'works against Lala briefly on Sunday');
  inSentence('then swings behind', s, 0, 'then swings behind it');
  inSentence('peak +14 mph', s, 0, 'reaching +14 mph');
  inSentence('peak time early Thursday', s, 0, 'by early Thursday');
  notIn('no disagreement clause either', s, 'not everything agrees');
  eq('one factor carries it', s[1],
    'Almost all of that is cold air above it. The only thing working against it is moisture around it.');
  /* Room: 55 kt over 140 kt → 63 mph over 161 mph. 39% of the ceiling.
   *
   * ==> THIS IS THE SENTENCE THE OLD CUT POINTS GOT WRONG. <== At 0.3/0.7 a
   * storm at 39% of its ceiling was told it was "fairly close to its ceiling"
   * and had "less room to grow", which is false in plain English. */
  inSentence('plenty of room at 39% of the ceiling', s, 2,
    'There is plenty of room to grow — 63 mph over water that could hold 161 mph');
  notIn('never "close to its ceiling" at 39%', s, 'close to its ceiling');
  inSentence('structure adds 8', s, 2, 'its own structure adds 8 mph');
  /* Bottom line: 72 kt at +120 → 83 mph early Thursday, rising with room to
   * spare — the one storm here that is actually using it. */
  inSentence('bottom line 83 mph early Thursday', s, 3, 'reaching 83 mph by early Thursday');
  inSentence('and it is using the room', s, 3, 'using some of that room');
  notIn('no spurious clause', s, 'slows it rather than');
  eq('grid hour', out.figures.when, 'early Thursday');
  eq('grid total', out.figures.total, '+14 mph');
  eq('grid labels', cellLabels(out),
    ['Cold air above it', 'Wind shear', 'Moisture around it', 'Warm moist air', 'Everything else']);
  eq('grid values', cellValues(out),
    ['+14 mph', '+3 mph', '\u22122 mph', '+1 mph', '\u22122 mph']);
  closes('grid closes on its own total', out);
}

console.log('\nGenevieve — 26072706EP0726 — a bad patch, a Cat 5 coming apart');
{
  const run = load('26072706EP0726');
  const out = paragraph(run);
  const s = out.sentences;
  /* THE SHAPE TEST THIS STORM EXISTS FOR: last hour +3 kt sits on the
   * helping boundary, and last-hour or end-vs-start reasoning calls a Cat 5
   * coming apart "turning for". Peak −13 kt first at +36 h → 15 mph,
   * Mon 06 UTC + 36 h = Tue 1 PM Central. Back inside neutral at +84 h →
   * Thu 1 PM. The +3 finish is a boundary graze, NOT a reversal. */
  inSentence('bad patch, hard', s, 0, 'turns hard against Genevieve through Tuesday afternoon');
  inSentence('costing up to 15', s, 0, 'costing up to 15 mph');
  inSentence('eases back by Thursday afternoon', s, 0, 'eases back to about even by Thursday afternoon');
  notIn('a +3 graze is not a reversal', s, 'then swings behind it');
  eq('shear is the whole story', s[1],
    'Almost all of that is wind shear. The only thing working in its favor is moisture around it.');
  /* Room: 140 kt over 163 kt → 161 mph over 188 mph, 86% of the ceiling —
   * the one acceptance storm that really is near it. */
  inSentence('close to the ceiling at 86%', s, 2,
    'Genevieve is close to its ceiling — 161 mph over water that could hold 188 mph');
  inSentence('and says what that means', s, 2, 'not much room left to grow');
  inSentence('structure adds 5', s, 2, 'its own structure adds 5 mph');
  /* Bottom line: 55 kt at +120 → falling 161 → 63 mph by early Saturday,
   * with the decay-share clause: an 85 kt fall against a 13 kt environment. */
  inSentence('bottom line falls 161 → 63', s, 3, 'falling from 161 mph to 63 mph');
  inSentence('bottom line early Saturday', s, 3, 'by early Saturday');
  inSentence('decay shares the work', s, 3, 'its own decay are pulling the same way');
  /* Terms at +36 h ONLY — the early-draft bug quoted +120 h under a +36 h
   * headline. Shear −13 kt → −15 mph; tempAloft −1; midRh +1. They close on
   * their own, so THERE IS NO FIFTH CELL: the closing cell is written when it
   * is needed and never as a zero. */
  eq('grid hour', out.figures.when, 'Tuesday afternoon');
  eq('grid total', out.figures.total, '\u221215 mph');
  eq('grid labels', cellLabels(out), ['Wind shear', 'Cold air above it', 'Moisture around it']);
  eq('grid values', cellValues(out), ['\u221215 mph', '\u22121 mph', '+1 mph']);
  closes('grid closes with no closing cell at all', out);
  truthy('no zero-valued closing cell', !cellLabels(out).includes('Rounding'));
  /* Headroom on a major hurricane is NEGATIVE — the number §47.4 excludes
   * from the colour precisely because it reports the storm back to itself. */
  noteHas('a Cat 5 has negative headroom, and it is shown', out, "the sea's ceiling costs 20 mph");
  /* ==> THE NOTE NAMES THE QUANTITY, NEVER THE STATE. <== It reads at the
   * VERDICT hour while the room sentence reads at the FIX, so a note asserting
   * a state can contradict the sentence above it — Lala's 06 UTC run says
   * "plenty of room to grow" at hour 0 and her headroom is negative at +120 h.
   * Both true, and read together they argue. */
  {
    const lala06 = paragraph(load('26081506CP0126'));
    truthy('a negative headroom never claims the storm is at its ceiling',
      lala06.sentences[2].includes('plenty of room to grow') &&
      lala06.notes.some((n) => n.includes("the sea's ceiling costs 2")) &&
      !lala06.notes.some((n) => /up against its ceiling|no room left/.test(n)));
  }
}

/* ---------------------------------------------------------------------------
 * THE REVERSAL SHAPES — measured on the corpus (34 of 337 runs), asserted on
 * promoted real bytes via synthetic runs built FROM a real fixture so the
 * assertion cannot drift from the parser's shape.
 * ------------------------------------------------------------------------- */

console.log('\nReversals and edges — synthetic tracks on a real run\u2019s chassis');
{
  const base = load('26081506CP0126');
  const synth = (envKt, extra = {}) => ({
    ...base,
    environmentKt: envKt.concat(Array(16 - envKt.length).fill(0)),
    drawable: envKt.map(() => true).concat(Array(16 - envKt.length).fill(false)),
    ...extra,
  });

  /* Helps then turns against — 26060218EP0126's real series. */
  const down = paragraph(synth([1, 4, 3, 6, 8, 7, 8, 7, 1, -2, -7, -7]));
  inSentence('rise named with its figure', down.sentences, 0, 'swings behind Lala');
  inSentence('reversal ending named', down.sentences, 0, 'then turns against it, reaching −8 mph');

  /* Hurts then swings behind — 26072500EP0626's real series ends +5..+3;
   * the ending-side extreme +5 clears the hysteresis. */
  const up = paragraph(synth([0, -3, -5, -5, -7, -6, -5, -4, -1, 5, 4, 3]));
  inSentence('dip named with its figure', up.sentences, 0, 'against Lala');
  inSentence('mirror reversal ending', up.sentences, 0, 'then swings behind it, reaching +6 mph');

  /* Steady inside neutral — the REQUIRED agreement sentence, loud variant:
   * a net near zero with heavy push and pull. */
  const loud = synth([1, 0, -1, 1, 0, -1, 1, 0].map((v) => v));
  loud.pushKt = loud.environmentKt.map(() => 10);
  loud.pullKt = loud.environmentKt.map(() => -10);
  const loudOut = paragraph(loud);
  inSentence('steady stays out of it', loudOut.sentences, 0, 'stays out of it');
  inSentence('loud neutral is named', loudOut.sentences, 0, 'a great deal is pulling in both directions');

  const quiet = synth([1, 0, -1, 1, 0, -1, 1, 0]);
  quiet.pushKt = quiet.environmentKt.map(() => 1);
  quiet.pullKt = quiet.environmentKt.map(() => -1);
  inSentence('quiet neutral is named', paragraph(quiet).sentences, 0, 'nothing much is acting on it');

  /* The fallback: fewer than three drawable hours. */
  const short = paragraph(synth([-5, -6]));
  inSentence('short window falls back to one hour', short.sentences, 0, 'Only a short window is published');

  /* A turning-against track whose biggest number is on the WRONG side: starts
   * fed at +10, peaks +14, ends −6. The headline must be the furthest point
   * on the ENDING side — "reaching −7" — never the global extreme, which
   * would put "+16" in a sentence about the environment turning hostile. */
  const wrongSide = paragraph(synth([10, 12, 14, 8, 2, -3, -6, -6]));
  inSentence('turning verdict headlines the ending side', wrongSide.sentences, 0, 'reaching −7 mph');
  notIn('never the opposite-side extreme', wrongSide.sentences, '+16 mph');
}

/* ---------------------------------------------------------------------------
 * THE FOUR ABSENCES — replaced, never dropped (§5), and only one retryable.
 * ------------------------------------------------------------------------- */

console.log('\nAbsences');
{
  const basin = envHealth({ status: 'basin', run: null });
  eq('basin is replaced', basin.kind, 'replaced');
  truthy('basin names the coverage', basin.text.includes('Not published for storms in this basin'));
  eq('basin is not retryable', basin.retryable, false);

  const noRun = envHealth({ status: 'no_run', run: null });
  truthy('no_run says not yet, without naming a model nobody knows',
    noRun.text.includes('No intensity model run published for this storm yet'));
  truthy('no absence text says SHIPS at the reader', !noRun.text.includes('SHIPS')
    && !basin.text.includes('SHIPS'));

  const unavailable = envHealth({ status: 'unavailable', run: null });
  eq('unavailable is retryable', unavailable.retryable, true);

  const run = load('26081506EP0826');
  const noTrack = envHealth({
    status: 'ok',
    run: { ...run, drawable: run.drawable.map(() => false) },
  });
  eq('no drawable track is replaced', noTrack.kind, 'replaced');
  truthy('and says why', noTrack.text.includes('no forecast track'));

  eq('nothing fetched is replaced', envHealth(null).kind, 'replaced');
}

/* ---------------------------------------------------------------------------
 * THE SUM CLOSES IN BOTH UNIT SYSTEMS — §47.4's whole requirement.
 * ------------------------------------------------------------------------- */

console.log('\nClosure in both unit systems, across every fixture');
{
  /* ==> THE CLOSURE IS CHECKED ON WHAT THE GRID PRINTS, NOT ON A SECOND
   * DERIVATION OF IT. <== The previous version of this block ranked and
   * converted the terms itself and compared the result to `closeWindParts` —
   * which is checking one function against a copy of itself, and would pass
   * happily while the grid on screen showed a different set of cells. Now it
   * runs the real generator, adds up the figures it actually emits, and
   * compares them to the total it actually prints above them. */
  const { readdirSync } = await import('node:fs');
  const dir = path.join(ROOT, 'samples', 'ships');
  let checked = 0;
  const broke = [];
  for (const f of readdirSync(dir)) {
    const run = parseShips(readFileSync(path.join(dir, f), 'utf8'));
    for (const sys of ['imperial', 'metric']) {
      const out = envHealth({ status: 'ok', run }, { system: sys });
      if (out.kind !== 'paragraph') continue;
      const sum = out.figures.cells.reduce((a, c) => a + figNum(c.value), 0);
      const total = figNum(out.figures.total);
      if (sum !== total) broke.push(`${f} ${sys}: cells ${sum} vs total ${total}`);
      checked++;
    }
  }
  truthy(`every fixture's grid adds up in both unit systems (${checked} paragraphs)`,
    checked > 0 && broke.length === 0);
  if (broke.length) fail('closure detail', broke.join('\n      '));

  /* And the mutation that proves the check bites: drop the closing cell and
   * the sum must stop matching on a storm that needs one. */
  const hernan = paragraph(load('26081506EP0826'));
  const mutant = { ...hernan.figures, cells: hernan.figures.cells.slice(0, -1) };
  truthy('dropping the closing cell breaks the sum',
    mutant.cells.reduce((a, c) => a + figNum(c.value), 0) !== figNum(hernan.figures.total));
}

console.log('\nDay-and-part buckets, US Central');
{
  eq('1 AM is early', formatDayPart(Date.parse('2026-08-20T06:00:00Z')), 'early Thursday');
  eq('7 AM is morning', formatDayPart(Date.parse('2026-08-20T12:00:00Z')), 'Thursday morning');
  eq('1 PM is afternoon', formatDayPart(Date.parse('2026-08-17T18:00:00Z')), 'Monday afternoon');
  eq('7 PM is evening', formatDayPart(Date.parse('2026-08-18T00:00:00Z')), 'Monday evening');
  eq('day only drops the part', formatDayPart(Date.parse('2026-08-16T06:00:00Z'), { dayOnly: true }), 'Sunday');
  eq('windDelta keeps the sign', windDelta(-11, 'imperial'), -13);
}

/* ---------------------------------------------------------------------------
 * MUTATIONS. A rule whose test cannot be made to fail is decoration. Each
 * block below re-runs a case through a corrupted input that reintroduces a
 * named historical bug, and asserts the suite WOULD have caught it — the
 * assertions above must disagree with the mutant's output.
 * ------------------------------------------------------------------------- */

console.log('\nMutations — each historical bug must change the output');
{
  const run = load('26072706EP0726');
  const good = paragraph(run).sentences.join(' ');

  /* Bug 1 (§47.8's early draft): terms quoted from the wrong hour. Shift the
   * term columns by one and the terms sentence must change. */
  const shifted = { ...run, terms: Object.fromEntries(
    Object.entries(run.terms).map(([k, v]) => [k, [...v.slice(1), 0]])
  ) };
  truthy('wrong-hour terms change the grid',
    JSON.stringify(paragraph(shifted).figures.cells) !==
    JSON.stringify(paragraph(run).figures.cells));

  /* Bug 2 (§47.4's most important decision): headroom folded into the
   * environment inverts a major hurricane. The verdict must move violently. */
  const folded = { ...run, environmentKt: run.environmentKt.map((v, i) => v + run.headroomKt[i]) };
  truthy('headroom folded in changes the verdict',
    !paragraph(folded).sentences[0].includes('costing up to 15 mph'));

  /* Bug 3 (§47.8's early draft): quoting the LAST hour as the verdict.
   * Genevieve's last hour is her most favorable moment; the real verdict
   * must not read as helping. */
  truthy('a Cat 5 coming apart never reads as helping',
    !good.includes('swings behind Genevieve'));

  /* Bug 4 (§47.8's early draft): the ceiling read five days out instead of
   * at the fix. Genevieve's +120 h POT. INT. is 108 kt → 124 mph; the fix is
   * 163 → 188. The paragraph must quote the fix. */
  truthy('ceiling quoted at the fix, not down the track', good.includes('188 mph') && !good.includes('124 mph'));

  /* Bug 5: direction inferred from the environment. 94L gains 35 kt while
   * its environment is against it — the bottom line must say reaching, and
   * the against-verdict must coexist with it. */
  const al = paragraph(load('26081506AL9426'), { stormName: '94L' }).sentences;
  truthy('direction comes from V (KT) LAND alone',
    al[0].includes('turns against') && al[3].includes('reaching 69 mph'));

  /* Bug 6 (this build's own): the room bands cut so that a storm at half its
   * ceiling was told it was close to it. Push Lala's ceiling down until she
   * really IS near it and the sentence has to change; leave it alone and it
   * must not. Both directions, because a band test that only fires one way is
   * half a test. */
  const lala = load('26081506CP0126');
  const near = { ...lala, potIntNowKt: Math.round(lala.currentWindKt / 0.9) };
  truthy('a storm at 90% of its ceiling is told so',
    paragraph(near).sentences[2].includes('close to its ceiling'));
  truthy('and one at 39% is not',
    paragraph(lala).sentences[2].includes('plenty of room to grow'));

  /* Bug 7 (this build's own): the room-being-used clause inferred from the
   * environment instead of from the published forecast.
   *
   * ==> ISOLATED ON A FLAT ENVIRONMENT, AND THAT IS THE ONLY HONEST WAY TO
   * TEST IT. <== The room clause is appended only where no other clause
   * claimed the slot, so on Lala's real numbers the environment-is-not-what-
   * brings-it-down clause wins and the room clause never runs — a true
   * sentence about a different question. Flattening the environment to zero
   * silences every other clause, leaving the published wind forecast as the
   * only thing that can move this one. Then move it both ways. */
  const flat = { ...lala, environmentKt: lala.environmentKt.map(() => 0) };
  const setWind = (run, kt) => ({
    ...run,
    vLandKt: run.vLandKt.map(() => kt),
    /* BOTH wind rows together. Moving only the land-decayed one opens a gap
     * between the two forecasts, which correctly fires the land-decay clause
     * instead and would make this read as a failure of the room clause. */
    vNoLandKt: run.vNoLandKt.map(() => kt),
  });
  const sinking = paragraph(setWind(flat, lala.currentWindKt - 20)).sentences[3];
  const climbing = paragraph(setWind(flat, lala.currentWindKt + 20)).sentences[3];
  truthy('a falling forecast leaves the room unused',
    sinking.includes('the room is there and nothing is using it'));
  truthy('a rising one uses it, with the environment identical',
    climbing.includes('using some of that room'));

  /* Bug 9 (this build's own): "behind it" carrying two opposite meanings in
   * one paragraph. The verdict uses it for HELPING — "swings behind it" — so
   * no later sentence may use it for CAUSATION. Swept across every fixture,
   * because the collision only appears on the storms that happen to get both
   * phrasings and would never show up on a single hand-picked case. */
  {
    const { readdirSync } = await import('node:fs');
    const dir = path.join(ROOT, 'samples', 'ships');
    const clashes = [];
    for (const f of readdirSync(dir)) {
      const r = parseShips(readFileSync(path.join(dir, f), 'utf8'));
      const o = envHealth({ status: 'ok', run: r }, { system: 'imperial' });
      if (o.kind !== 'paragraph') continue;
      for (const line of o.sentences.slice(1)) {
        if (line.includes('behind it')) clashes.push(`${f}: ${line}`);
      }
    }
    truthy('"behind it" never means causation after the verdict has used it for help',
      clashes.length === 0);
    if (clashes.length) fail('behind-it collision', clashes.join('\n      '));
  }

  /* Bug 8 (this build's own): a name that is only honest at one sign. The
   * humidity row is POSITIVE when the air is moist, and the old name for it
   * was "dry air" — so a helping hour printed "dry air +2", which says the
   * opposite of the file. No name in the grid may be a one-signed word. */
  const genevieve = paragraph(load('26072706EP0726'));
  truthy('the humidity row is named for the quantity, not one end of it',
    cellLabels(genevieve).includes('Moisture around it') &&
    !cellLabels(genevieve).some((l) => /dry air/i.test(l)));
}

console.log(
  failures === 0
    ? '\nAll env-health checks passed.\n'
    : `\n${failures} env-health check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
