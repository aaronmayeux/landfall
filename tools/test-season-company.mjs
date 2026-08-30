#!/usr/bin/env node
/**
 * test-season-company.mjs — how many other storms were running the same day.
 * SPEC-SEASONS-BUILD.md §57.50, §57.42 Tier 1 item 10.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-company.mjs`.
 *
 * ==> IT WALKS THE WHOLE MIRRORED ARCHIVE, FOR THE REASON
 * `test-storm-shape.mjs` GIVES. <== Every count below is a number a design
 * decision was made on, and a comment holding one goes stale the first time a
 * rule moves with nothing saying so. An assertion goes red:
 *
 * - **1,243 storms were measured and found alone**, and 24 more are the
 *   one-storm seasons nothing can be compared in. Together that is 1,267
 *   silent panels, 38.8%, which is why the sentence says nothing rather than
 *   saying so. A non-event stated on four storms in ten.
 * - **the peak is 6 others**, which is the ceiling the wording has to survive.
 * - **482 storms met more storms across their life than were ever running at
 *   once**, which is the gap between this figure and a whole-life overlap
 *   count, and the reason the smaller number is the one printed. That is 15%
 *   of the archive; a first estimate taken by subtracting two distributions
 *   instead of counting said 5%, which is why it is computed here.
 * - **filtering to cyclone fixes would silence 1,439 rather than 1,267**,
 *   which is why the window is the whole record — the same two stamps
 *   `lifeHtml` prints as `First seen` and `Last seen`.
 *
 * ==> AND THE ARCHIVE FILES READ HERE ARE THE WHOLE-BASIN ONES, NOT A GLOB.
 * <== §57.42. `seasons/data/` holds the per-season slices AND the two
 * whole-basin files, so a glob over `*.txt` counts every storm twice and
 * produces an exact 2x that looks like real data.
 *
 * WHAT THIS CANNOT PROVE: whether the sentence READS well on a phone, or
 * whether it sits right under the two rank rows. That is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2, groupBySeason } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { seasonCompany } = await import('../lib/season-company.js');
const { seasonCompanyHtml } = await import('../ui/season-rank-markup.js');

const FILES = [
  'seasons/data/hurdat2-atlantic-2025-02272026.txt',
  'seasons/data/hurdat2-epacific-2025-02272026.txt',
];

const raw = [];
for (const f of FILES) {
  for (const s of parseHurdat2(readFileSync(f, 'utf8')).storms) raw.push(s);
}

/* ------------------------------------------------------------------ shapes */
section('the shape of the answer');

const at = (t) => Date.UTC(2005, 8, t);
const made = (id, from, to) => ({ id, firstTime: at(from), lastTime: at(to) });

ok(seasonCompany(null, []) === null, 'no storm at all is null');
ok(seasonCompany({ id: 'X' }, [{ id: 'X' }]) === null,
  'a storm with no clock is null rather than zero — nobody could look');
ok(seasonCompany(made('X', 1, 5), [made('X', 1, 5)]) === null,
  '==> A ONE-STORM SEASON IS null, NOT ZERO. <== 24 seasons in the archive '
  + 'hold a single storm, and there is no comparison to make');
ok(seasonCompany(made('X', 1, 5), [made('A', 1, 5), made('B', 2, 3)]) === null,
  'a storm that is not in the list it was handed is null');

const alone = seasonCompany(made('X', 1, 5), [made('X', 1, 5), made('Y', 20, 25)]);
ok(alone && alone.peak === 0 && alone.dayMs === null,
  '==> BUT A STORM GENUINELY ALONE IN A BUSY SEASON IS ZERO, NOT null. <== §5. '
  + 'The two answers are different and must not collapse into each other. '
  + `Got ${JSON.stringify(alone)}`);

/* ------------------------------------------------------------- the counting */
section('the counting');

const one = seasonCompany(made('X', 1, 10), [made('X', 1, 10), made('Y', 5, 7)]);
ok(one?.peak === 1 && one.dayMs === at(5), `one overlapping storm, dated to its start. Got ${JSON.stringify(one)}`);

/* ==> TOUCHING AT THE EDGE COUNTS, BECAUSE A DAY IS A DAY. <== A storm whose
 * last record is the same day as another's first was running on the same day
 * as it, and the sentence says exactly that. */
const edge = seasonCompany(made('X', 1, 5), [made('X', 1, 5), made('Y', 5, 9)]);
ok(edge?.peak === 1, `a storm starting on this one's last day counts. Got ${edge?.peak}`);
const missed = seasonCompany(made('X', 1, 5), [made('X', 1, 5), made('Y', 6, 9)]);
ok(missed?.peak === 0, `and one starting the day after does not. Got ${missed?.peak}`);

/* ==> THE ONE CASE WHERE "DAY" AND "MOMENT" GIVE DIFFERENT ANSWERS, DRIVEN
 * THROUGH THE REAL FUNCTION. <== X's record stops at midnight on the 5th and
 * Y's begins at six that evening. As moments they never coexist; as days they
 * were both running on 5 September, and the sentence this feeds says "day".
 * The archive-wide figure below says what the choice is worth across 3,266
 * storms — this is the assertion that catches the rule being changed, because
 * it is the only one whose answer flips. */
const hour = (d, h) => Date.UTC(2005, 8, d, h);
const sameDay = seasonCompany(
  { id: 'X', firstTime: hour(1, 18), lastTime: hour(5, 0) },
  [
    { id: 'X', firstTime: hour(1, 18), lastTime: hour(5, 0) },
    { id: 'Y', firstTime: hour(5, 18), lastTime: hour(9, 0) },
  ],
);
ok(sameDay?.peak === 1,
  '==> TWO STORMS THAT NEVER COEXIST AS MOMENTS BUT SHARE A DAY COUNT AS ONE. '
  + `<== Counting instants gives 0 here. Got ${sameDay?.peak}`);

/* ==> THE PEAK IS SIMULTANEOUS, NOT CUMULATIVE. <== Three storms in sequence,
 * never two at once, is one — and this is the assertion that separates this
 * figure from a whole-life overlap count. */
const sequential = seasonCompany(made('X', 1, 20), [
  made('X', 1, 20), made('A', 2, 3), made('B', 6, 7), made('C', 10, 11),
]);
ok(sequential?.peak === 1,
  '==> THREE STORMS ONE AFTER ANOTHER IS ONE AT A TIME, NOT THREE. <== '
  + `Got ${sequential?.peak}`);

const together = seasonCompany(made('X', 1, 20), [
  made('X', 1, 20), made('A', 2, 12), made('B', 6, 14), made('C', 10, 11),
]);
ok(together?.peak === 3 && together.dayMs === at(10),
  `three at once, on the day the third begins. Got ${JSON.stringify(together)}`);

/* ==> TIES GO TO THE EARLIER DAY, THE SAME RULE `stormFacts` APPLIES TO A PEAK
 * WIND HELD FOR EIGHTEEN HOURS. <== Two separate days both carrying two
 * others; the first is the one reported. */
const tied = seasonCompany(made('X', 1, 30), [
  made('X', 1, 30), made('A', 3, 6), made('B', 4, 6), made('C', 20, 24), made('D', 21, 24),
]);
ok(tied?.peak === 2 && tied.dayMs === at(4),
  `a tied busiest day reports the earlier one. Got ${JSON.stringify(tied)}`);

/* ==> A COUNT IS ONLY TAKEN OVER DAYS INSIDE THIS STORM'S OWN LIFE. <== Two
 * storms overlapping each other after this one has finished are not company
 * it kept, however busy the season got. */
const after = seasonCompany(made('X', 1, 4), [
  made('X', 1, 4), made('A', 3, 20), made('B', 10, 20), made('C', 11, 20),
]);
ok(after?.peak === 1,
  '==> THE SEASON GETTING BUSY AFTER THIS STORM ENDED IS NOT ITS COMPANY. <== '
  + `Got ${after?.peak}`);

/* ==> AND A STORM ALREADY UNDER WAY WHEN THIS ONE BEGINS IS COUNTED, WHICH IS
 * WHY THE SWEEP SEEDS ITSELF WITH THIS STORM'S FIRST DAY. <== Without that
 * seed a storm whose only company started earlier reads as alone. */
const earlier = seasonCompany(made('X', 10, 12), [made('X', 10, 12), made('Y', 1, 30)]);
ok(earlier?.peak === 1 && earlier.dayMs === at(10),
  `company already running at the start is counted, dated to the start. Got ${JSON.stringify(earlier)}`);

/* -------------------------------------------------------------- the archive */
section('the whole archive');

const facts = new Map();
for (const s of raw) {
  const f = stormFacts(s);
  if (f) facts.set(s.id, f);
}
ok(facts.size === 3266, `3,266 storms in the mirrored archive. Got ${facts.size}`);

const seasons = groupBySeason(raw);
const answers = new Map();
for (const [, season] of seasons) {
  const all = season.storms.map((s) => facts.get(s.id)).filter(Boolean);
  for (const f of all) answers.set(f.id, seasonCompany(f, all));
}

const nulls = [...answers.values()].filter((a) => a === null);
ok(nulls.length === 24,
  `==> 24 STORMS GET null, AND THEY ARE THE 24 ONE-STORM SEASONS. <== Got ${nulls.length}`);

const peaks = [...answers.values()].filter(Boolean).map((a) => a.peak);
const countAt = (n) => peaks.filter((p) => p === n).length;

/* ==> 1,243 MEASURED ZEROS PLUS THE 24 nullS IS 1,267 SILENT PANELS, 38.8%.
 * <== The two are asserted separately on purpose. They render identically and
 * they mean opposite things — one storm was looked at and was alone, the other
 * could not be looked at — and this file's job is to keep them from collapsing
 * into each other. A change that turned every null into a zero would leave the
 * silence count untouched and only this pair would notice. */
ok(countAt(0) === 1243,
  '==> 1,243 STORMS WERE MEASURED AND FOUND ALONE. <== With the 24 one-storm '
  + `seasons that is 1,267 silent panels, 38.8% of the archive. Got ${countAt(0)}`);
ok(countAt(0) + nulls.length === 1267,
  `1,267 storms get no sentence at all. Got ${countAt(0) + nulls.length}`);
ok(countAt(1) === 1193, `1,193 storms had exactly one other running. Got ${countAt(1)}`);
ok(countAt(2) === 566, `566 had two. Got ${countAt(2)}`);
ok(countAt(3) === 177, `177 had three. Got ${countAt(3)}`);
ok(countAt(4) === 48, `48 had four. Got ${countAt(4)}`);
ok(countAt(5) === 1, `1 had five. Got ${countAt(5)}`);
ok(countAt(6) === 14, `14 had six. Got ${countAt(6)}`);
ok(Math.max(...peaks) === 6,
  `==> SIX IS THE ARCHIVE'S CEILING AND THE WORDING HAS TO SURVIVE IT. <== Got ${Math.max(...peaks)}`);

/* ==> THE GAP BETWEEN THIS FIGURE AND A WHOLE-LIFE OVERLAP COUNT IS ASSERTED
 * RATHER THAN DESCRIBED. <== 170 storms met two or more one after another and
 * never two at once. If a later change quietly swapped the peak for a
 * cumulative total this number would collapse to zero and every count above
 * would still look plausible. */
let sequentialOnly = 0;
for (const [, season] of seasons) {
  const all = season.storms.map((s) => facts.get(s.id)).filter(Boolean);
  const DAY = 86400000;
  const dayOf = (ms) => Math.floor(ms / DAY);
  for (const f of all) {
    const a = answers.get(f.id);
    if (!a) continue;
    const total = all.filter((o) => o.id !== f.id
      && dayOf(o.firstTime) <= dayOf(f.lastTime)
      && dayOf(o.lastTime) >= dayOf(f.firstTime)).length;
    if (total > a.peak) sequentialOnly++;
  }
}
ok(sequentialOnly === 482,
  '==> 482 STORMS MET MORE STORMS ACROSS THEIR LIFE THAN WERE EVER RUNNING AT '
  + 'ONCE. <== The peak is the smaller and truer number for every one of them, '
  + `and it is 15% of the archive rather than the 5% a first estimate gave. Got ${sequentialOnly}`);

/* ==> DAYS RATHER THAN INSTANTS, ASSERTED AS A NUMBER RATHER THAN LEFT TO A
 * CRASH. <== Replacing `dayOf` with the identity makes this suite throw a
 * RangeError out of `utcDay`, because the returned stamp is then a moment
 * multiplied by a day. That DOES fail the run, but a crash is an unanswered
 * question rather than a caught bug, and §12's rule is that a test has to bite
 * for the reason the rule exists.
 *
 * ==> THE ASSERTION THAT CATCHES IT IS THE SYNTHETIC ONE ABOVE, NOT THIS ONE.
 * <== This figure is computed straight off the facts rather than through
 * `seasonCompany`, so it CANNOT see the rule change — it is here to record
 * what the choice is worth across the whole archive, which is 63 storms. Both
 * are kept and the division of labour is written down, because a suite that
 * looks like it covers a rule and does not is §12's worst outcome. */
let instantSilent = 0;
for (const [, season] of seasons) {
  const ws = season.storms.map((s) => facts.get(s.id)).filter(Boolean)
    .map((f) => ({ id: f.id, a: f.firstTime, b: f.lastTime }))
    .filter((w) => Number.isFinite(w.a) && Number.isFinite(w.b));
  for (const me of ws) {
    if (!ws.some((o) => o.id !== me.id && o.a <= me.b && o.b >= me.a)) instantSilent++;
  }
}
ok(instantSilent === 1330,
  '==> COUNTING INSTANTS RATHER THAN DAYS WOULD SILENCE 1,330 STORMS RATHER '
  + `THAN 1,267. <== 63 storms turn on the word "day". Got ${instantSilent}`);

/* ==> THE WINDOW IS THE WHOLE RECORD AND NOT THE CYCLONE FIXES, AND THIS
 * ASSERTS WHAT THAT CHOICE IS WORTH. <== Filtering would silence 1,439 storms
 * rather than 1,267 — 172 storms, a real difference. The whole record is what
 * `lifeHtml` prints two rows away as `First seen` and `Last seen`. */
const { SEASONS } = await import('../config/constants.js');
const isCyc = (st) => SEASONS.cycloneStatuses.includes(String(st || '').toUpperCase());
let cycloneSilent = 0;
for (const [, season] of seasons) {
  const DAY = 86400000;
  const win = (s) => {
    const t = (s.points || []).filter((p) => Number.isFinite(p.time) && isCyc(p.status))
      .map((p) => Math.floor(p.time / DAY));
    return t.length ? { a: Math.min(...t), b: Math.max(...t) } : null;
  };
  const ws = season.storms.map((s) => ({ id: s.id, w: win(s) })).filter((x) => x.w);
  for (const me of ws) {
    const others = ws.filter((o) => o.id !== me.id && o.w.a <= me.w.b && o.w.b >= me.w.a);
    if (!others.length) cycloneSilent++;
  }
}
ok(cycloneSilent === 1439,
  '==> A CYCLONE-ONLY WINDOW WOULD SILENCE 1,439 STORMS RATHER THAN 1,267. <== '
  + `172 storms turn on this choice, so it is a measurement and not a tidy-up. Got ${cycloneSilent}`);

/* Two storms whose numbers were read off the archive by hand and printed in
 * the spec. If either moves, the spec is wrong and this says so. */
const busiest = [...answers.entries()].filter(([, a]) => a?.peak === 6).map(([id]) => id);
ok(busiest.length === 14 && busiest.some((id) => id.startsWith('AL') && id.endsWith('1971')),
  `the 14 busiest storms include 1971 Atlantic ones. Got ${busiest.slice(0, 4).join(',')}`);

/* --------------------------------------------------------------- the words */
section('the sentence');

ok(seasonCompanyHtml(null) === '', 'nothing to say for a null answer');
ok(seasonCompanyHtml({ peak: 0, dayMs: null, of: 20 }) === '',
  '==> AND NOTHING FOR A REAL ZERO EITHER. <== The lib keeps the two apart; the '
  + 'panel has the same nothing to say about both');
ok(seasonCompanyHtml({ peak: 3, dayMs: null, of: 20 }) === '',
  'a count with no day to name is not printed — the date is what makes it checkable');

const s1 = seasonCompanyHtml({ peak: 1, dayMs: at(13), of: 20 });
ok(s1.includes('One other storm') && s1.includes('was running'),
  `==> ONE IS SINGULAR ALL THE WAY THROUGH THE SENTENCE. <== Got ${s1}`);
ok(!s1.includes('storms'), `and never says "storms". Got ${s1}`);

const s5 = seasonCompanyHtml({ peak: 5, dayMs: at(13), of: 20 });
ok(s5.includes('Five other storms') && s5.includes('were running'),
  `==> AND THE COUNT IS A WORD, NOT A DIGIT. <== Aaron's rule. Got ${s5}`);
ok(!/\b5\b/.test(s5), `no bare digit for a count. Got ${s5}`);
ok(s5.includes('Sep 13, 2005'), `the day is named. Got ${s5}`);
ok(s5.includes('in the same basin'),
  '==> AND THE CLAIM IS SCOPED TO THE BASIN. <== Unqualified it is a statement '
  + `about the whole planet and it is false. Got ${s5}`);

/* ==> NO EM DASH ANYWHERE. <== `lib/units.js` uses a bare em dash as its
 * missing-value sentinel, so one inside a sentence is a clause that can be
 * mistaken for an absent figure. */
for (const s of [s1, s5]) ok(!s.includes('\u2014'), `no em dash in a clause. Got ${s}`);

/* Every real sentence in the archive renders without an undefined in it. */
let rendered = 0;
let bad = 0;
for (const a of answers.values()) {
  const html = seasonCompanyHtml(a);
  if (!html) continue;
  rendered++;
  if (/undefined|null|NaN/.test(html)) bad++;
}
ok(bad === 0, `no rendered sentence carries undefined, null or NaN. Got ${bad}`);
ok(rendered === 1999,
  `==> THE SENTENCE APPEARS ON 1,999 OF 3,266 STORMS, 61%. <== Got ${rendered}`);

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
