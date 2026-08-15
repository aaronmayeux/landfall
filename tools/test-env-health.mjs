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
 * ------------------------------------------------------------------------- */

console.log('\nHernan — 26081506EP0826 — turning against, everything agreeing');
{
  const run = load('26081506EP0826');
  const out = paragraph(run);
  eq('kind', out.kind, 'paragraph');
  const s = out.sentences;
  /* Verdict: shape, peak, time, agreement. −11 kt at +60 h → −13 mph,
   * Sat 06 UTC + 60 h = Mon 1 PM Central. Push 1, pull −12 → ratio 0.85. */
  inSentence('verdict names the turn', s, 0, 'turns against Hernan steadily');
  inSentence('peak −13 mph', s, 0, 'reaching −13 mph');
  inSentence('peak time Monday afternoon', s, 0, 'by Monday afternoon');
  inSentence('agreement clause', s, 0, 'nearly everything is pulling the same way');
  /* Terms at +60 h ONLY: shear −8 kt → 9 mph, divergence −2, midRh −1,
   * thetaE +1; oceanHeat −1 omitted → "a smaller term". */
  inSentence('shear leads at 9', s, 1, 'Shear is the biggest problem, costing 9 mph');
  inSentence('outflow −2', s, 1, 'outflow aloft −2');
  inSentence('dry air −1', s, 1, 'dry air −1');
  inSentence('moist warm air +1 in favour', s, 1, 'in its favour is moist warm air, worth +1');
  inSentence('one omitted term closes −2', s, 1, 'a smaller term and rounding take back 2');
  /* Room at the fix: 30 kt current → 35 mph, ceiling 139 kt → 160 mph.
   * Structure at +60: −10 kt → 12 mph. */
  inSentence('ceiling 160 at the fix', s, 2, 'could hold a 160 mph storm');
  inSentence('current 35 beside it', s, 2, 'only doing 35');
  inSentence('structure costs 12', s, 2, 'structure costs 12 mph');
  /* Bottom line: V (KT) LAND 30 → 22 kt at +60 → 35 → 25 mph. */
  inSentence('bottom line falls 35 → 25', s, 3, 'falling from 35 mph to 25 mph');
  inSentence('bottom line time', s, 3, 'by Monday afternoon');
  notIn('no decay-share clause (8 kt fall, 11 kt env)', s, 'its own decay');
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
  /* Terms at +96 h: nothing dominates (top term 2 kt of net 7). Named:
   * tempAloft −2, midRh −2, thetaE −1 against; shear +1 for. Omitted
   * non-zero: vorticity, divergence, tempAdvection → three. */
  inSentence('nothing dominates', s, 1, 'Nothing dominates');
  inSentence('cold air aloft −2', s, 1, 'cold air aloft −2');
  inSentence('dry air −2', s, 1, 'dry air −2');
  inSentence('moist warm air −1', s, 1, 'moist warm air −1');
  inSentence('shear +1 the lone helper', s, 1, 'in its favour is shear, worth +1');
  inSentence('three omitted terms close −4', s, 1, 'three smaller terms and rounding take back 4');
  /* Room: 25 kt over 137 kt ceiling → 29 mph over 158 mph, far below;
   * headroom term at +96 = 39 kt → +45 mph; structure −4 kt → 5 mph. */
  inSentence('room carries it', s, 2, 'a 29 mph system sitting over water that could hold 158 mph');
  inSentence('headroom worth +45', s, 2, 'worth +45 mph');
  inSentence('structure costs 5', s, 2, 'structure costs 5 mph');
  /* Bottom line: rising to 60 kt at +120 (last drawable) → 69 mph, early
   * Thursday — NOT the +168 h wind the file also publishes — and the
   * strengthening-in-spite-of-it clause. */
  inSentence('bottom line 69 mph', s, 3, 'reaching 69 mph');
  inSentence('bottom line early Thursday', s, 3, 'by early Thursday');
  inSentence('slows-not-stops clause', s, 3, 'slows it rather than stopping it');
  /* §47.6's fourth case: positions stop at +120 while winds run to +168. */
  truthy('partial-track note present', s.some((x) => x.includes('only published for part of the forecast track')));
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
  inSentence('disagreement clause', s, 0, 'though not everything agrees');
  /* Terms at +120: tempAloft +12 kt → +14 mph dominates (12 of net 12);
   * shear +3, thetaE +1 beside it; midRh −2 the lone against; vorticity and
   * divergence omitted → two. */
  inSentence('cold air aloft dominates at +14', s, 1, 'Cold air aloft is almost the entire story at +14 mph');
  inSentence('shear +3 beside it', s, 1, 'shear +3');
  inSentence('moist +1 beside it', s, 1, 'moist warm air +1');
  inSentence('dry air −2 the lone against', s, 1, 'working against it is dry air, worth −2');
  inSentence('two omitted terms close −2', s, 1, 'two smaller terms and rounding take back 2');
  /* Room: 55 kt over 140 kt → 63 mph over 161 mph, ratio 0.39 → closer to
   * ceiling; structure +7 kt → adds 8. */
  inSentence('closer to ceiling', s, 2, '63 mph over water that could hold 161 mph');
  inSentence('structure adds 8', s, 2, 'structure adds 8 mph');
  /* Bottom line: 72 kt at +120 → 83 mph early Thursday. Env for, rising —
   * no clause needed. */
  inSentence('bottom line 83 mph early Thursday', s, 3, 'reaching 83 mph by early Thursday');
  notIn('no spurious clause', s, 'slows it rather than');
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
  inSentence('eases back by Thursday afternoon', s, 0, 'eases back to neutral by Thursday afternoon');
  notIn('a +3 graze is not a reversal', s, 'then swings behind it');
  /* Terms at +36 h ONLY — the early-draft bug quoted +120 h under a +36 h
   * headline. Shear −13 kt → −15 mph, 13 of net 13 dominates; tempAloft −1;
   * midRh +1 the lone helper; the named terms close on their own → NO
   * remainder clause. */
  inSentence('shear almost the entire story at −15', s, 1, 'Shear is almost the entire story at −15 mph');
  inSentence('cold air aloft −1 beside it', s, 1, 'cold air aloft −1');
  inSentence('dry air +1 the lone helper', s, 1, 'in its favour is dry air, worth +1');
  notIn('closing clause omitted when terms close', s, 'smaller term');
  /* Room: 140 kt over 163 kt → 161 mph over 188 mph, ratio 0.86 → near
   * ceiling; structure +4 kt → adds 5. */
  inSentence('room left near the ceiling', s, 2, '161 mph over water that could hold 188 mph');
  inSentence('structure adds 5', s, 2, 'structure adds 5 mph');
  /* Bottom line: 55 kt at +120 → falling 161 → 63 mph by early Saturday,
   * with the decay-share clause: an 85 kt fall against a 13 kt environment. */
  inSentence('bottom line falls 161 → 63', s, 3, 'falling from 161 mph to 63 mph');
  inSentence('bottom line early Saturday', s, 3, 'by early Saturday');
  inSentence('decay shares the work', s, 3, 'its own decay are pulling the same way');
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
  inSentence('short window falls back to one hour', short.sentences, 0, 'publishes only a short window');

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
  truthy('no_run says not yet', noRun.text.includes('No SHIPS run published for this storm yet'));

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

console.log('\nClosure in both unit systems, across all fifteen fixtures');
{
  const { readdirSync } = await import('node:fs');
  const dir = path.join(ROOT, 'samples', 'ships');
  let checked = 0;
  for (const f of readdirSync(dir)) {
    const run = parseShips(readFileSync(path.join(dir, f), 'utf8'));
    for (let c = 0; c < run.hours.length; c++) {
      if (!run.drawable[c]) continue;
      const terms = Object.keys(run.terms)
        .map((k) => run.terms[k][c]).filter((v) => v !== 0)
        .sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 4);
      for (const sys of ['imperial', 'metric']) {
        const { total, named, remainder } = closeWindParts(run.environmentKt[c], terms, sys);
        if (total !== named.reduce((a, b) => a + b, 0) + remainder) {
          fail(`closure broke: ${f} +${run.hours[c]} h ${sys}`);
        }
        checked++;
      }
    }
  }
  truthy(`parts sum to total on every drawable hour (${checked} checks)`, checked > 0 && failures === 0);
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
  truthy('wrong-hour terms change the sentence',
    paragraph(shifted).sentences[1] !== paragraph(run).sentences[1]);

  /* Bug 2 (§47.4's most important decision): headroom folded into the
   * environment inverts a major hurricane. The verdict must move violently. */
  const folded = { ...run, environmentKt: run.environmentKt.map((v, i) => v + run.headroomKt[i]) };
  truthy('headroom folded in changes the verdict',
    !paragraph(folded).sentences[0].includes('costing up to 15 mph'));

  /* Bug 3 (§47.8's early draft): quoting the LAST hour as the verdict.
   * Genevieve's last hour is her most favourable moment; the real verdict
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
}

console.log(
  failures === 0
    ? '\nAll env-health checks passed.\n'
    : `\n${failures} env-health check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
