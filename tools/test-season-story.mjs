#!/usr/bin/env node
/**
 * test-season-story.mjs — the storm's life, in a paragraph. §57.41.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-story.mjs`.
 *
 * ==> HARVEY IS THE WHOLE REASON THIS SUITE EXISTS. <== The obvious stall
 * measurement — how far has the storm drifted from where this window started —
 * is green on every test anybody would think to write, and reports NOTHING for
 * the one storm the clause was built for. Harvey went inland near Rockport,
 * back out over the Gulf and ashore again near Cameron; each leg breaks a
 * window anchored on its own first point. So the first assertion below is that
 * Harvey has a stall at all, and the second is that it is measured in days
 * rather than hours.
 *
 * ==> AND SANDY IS THE SECOND ONE. <== She used to be here because a correct
 * rule looked like a bug: the app declined a landfall by a system that had
 * already gone extratropical, so the only thing anybody remembers about her was
 * missing and the paragraph carried a sentence apologising for it. §57.7c made
 * that landfall count. The section is kept, pointed the other way, because the
 * assertions that guarded the old behaviour are exactly the ones that would let
 * it come back.
 *
 * ==> EVERY PLACES OBJECT HERE IS HAND-WRITTEN, NOT GENERATED. <== A fixture
 * produced by the code under test proves the code agrees with itself. These are
 * typed from §57.40's own measured table, which was hand-checked against each
 * storm's history.
 *
 * WHAT THIS CANNOT PROVE: whether the paragraph READS well. That is glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { landfallFileName } = await import('../lib/seasons-sidecar.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS } = await import('../config/constants.js');
const {
  storyClauses, stallWindow, hoursToHurricane, spanPhrase, countWord, categoryPhrase,
} = await import('../lib/season-story.js');
const { storyHtml } = await import('../ui/season-detail-markup.js');

const raw = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const one = (f) => parseHurdat2(raw(f)).storms[0];

/** The real computed landfalls for a fixture storm, off the shipped sidecar,
 *  so `landfallSource` is `computed` exactly as it is in the app.
 *
 *  ==> THE NAME IS BUILT, NEVER TYPED. <== §57.7c bumped
 *  `SEASONS.landfallsSchema` and three suites went red on a filename they had
 *  spelled out by hand. `landfallFileName` is the same function the app and
 *  the runner use, so a future bump moves this with them. */
const INDEX = JSON.parse(readFileSync('seasons/index.json', 'utf8'));
const MARKS = JSON.parse(readFileSync(
  `seasons/data/${landfallFileName('atlantic', INDEX.basins.atlantic.revision)}`, 'utf8')).storms;
function factsFor(file) {
  const s = one(file);
  s.landfallsComputed = MARKS[s.id] || [];
  return { storm: s, facts: stormFacts(s) };
}
const story = (file, opts = {}) => {
  const { storm, facts } = factsFor(file);
  return storyClauses(facts, { name: storm.name, points: storm.points, system: 'imperial', ...opts });
};
const para = (file, opts) => story(file, opts).join(' ');

/* ------------------------------------------------------------------------- */
section('HARVEY — the stall the obvious implementation misses');
{
  const { storm } = factsFor('al092017');
  const w = stallWindow(storm.points);

  ok(w !== null,
    '==> THE ENTIRE POINT. <== Harvey doubles back on himself, so a window measured from its '
    + 'own FIRST FIX finds nothing. Measured from the window CENTROID he has a stall.');
  ok(w && w.hours >= 48,
    `and it clears SEASONS.stallMinHours (${SEASONS.stallMinHours}). Got ${w && w.hours}`);
  ok(w && w.lat > 27 && w.lat < 30 && w.lon > -98 && w.lon < -95,
    `and the centre is the Texas coastal bend, not the middle of his track. Got ${w && w.lat},${w && w.lon}`);

  const p = para('al092017');
  ok(/barely moved for 3 days/.test(p), `the sentence says 3 days. Got: ${p}`);
  ok(/staying within about 90 mi/.test(p),
    '==> THE RADIUS IS INTERPOLATED FROM THE CONSTANT, NOT TYPED. <== The prototype said '
    + `"within 100 km" while stallRadiusKm was ${SEASONS.stallRadiusKm}. Got: ${p}`);
  ok(/reached hurricane strength 9 days later, far longer than a storm usually takes/.test(p),
    `Harvey is well past 2x the median, so the comparison fires. Got: ${p}`);
  ok(/came ashore four times/.test(p), `four landfalls, said as a word. Got: ${p}`);
}

/* ------------------------------------------------------------------------- */
section('HARVEY — the places sidecar changes what can be said, in three ways');
{
  const places = {
    genesis: null,
    landfalls: [
      { name: 'Crane, Barbados', km: 3 },
      { name: 'Biabou, Saint George, Saint Vincent and the Grenadines', km: 1 },
      { name: 'Fulton, Texas, United States', km: 11 },
      { name: 'Cameron, Louisiana, United States', km: 18 },
    ],
    stall: { at: 1503705600000, hours: 66, name: 'Bloomington, Texas, United States', km: 9 },
  };

  const withPlaces = para('al092017', { places });
  const without = para('al092017');
  const nulls = para('al092017', { places: { genesis: null } });

  ok(/first seen on August 16, 2017, out over open water/.test(withPlaces),
    `a null genesis inside a real entry IS an answer — open water. Got: ${withPlaces}`);
  ok(/first seen on August 16, 2017\./.test(without) && !/open water/.test(without),
    '==> AND A MISSING SIDECAR IS NOT THE SAME ANSWER. <== §5. `places: null` means nobody '
    + `looked, so the paragraph claims nothing about where. Got: ${without}`);
  ok(/staying within about 90 mi of Bloomington, Texas, United States/.test(withPlaces),
    `the stall takes its name from the sidecar. Got: ${withPlaces}`);
  ok(/Crane, Barbados; .*and Cameron, Louisiana, United States/.test(withPlaces),
    `all four named, so the list is printed in full. Got: ${withPlaces}`);
  ok(/came ashore four times: Crane/.test(withPlaces),
    '==> THE ROLL-CALL TAKES A COLON, NOT AN EM DASH. <== lib/units.js returns a bare em dash '
    + `when a figure fails to resolve, and this suite can only ban the character if no clause `
    + `uses one decoratively. Got: ${withPlaces}`);
  ok(/The hardest was near Fulton on August 26/.test(withPlaces),
    '==> AND IT DROPS TO THE TOWN ALONE, BECAUSE THE FULL LABEL IS ONE SENTENCE BACK. <== '
    + `§57.40 forbids an AMBIGUOUS name, not a repeated one. Got: ${withPlaces}`);
  ok(!/of anywhere/.test(nulls) === false || /of anywhere, out over open water/.test(nulls),
    `a stall with no town, computed on the device against a loaded sidecar, says so. Got: ${nulls}`);
}

/* ------------------------------------------------------------------------- */
section('HARVEY — a partly named landfall list is dropped whole');
{
  const partial = {
    landfalls: [
      { name: 'Crane, Barbados', km: 3 },
      null,
      { name: 'Fulton, Texas, United States', km: 11 },
      null,
    ],
  };
  const p = para('al092017', { places: partial });
  ok(/came ashore four times\. The hardest was near Fulton, Texas, United States/.test(p),
    '==> FOUR LANDFALLS AND TWO NAMES READS AS A MISCOUNT. <== §57.41: the list goes, the '
    + `count and the hardest one stay. Got: ${p}`);
  ok(!/Crane/.test(p), `and no partial list leaks through. Got: ${p}`);
  ok(/near Fulton, Texas, United States/.test(p),
    '==> AND WITH NO LIST ABOVE IT, THE HARDEST ONE KEEPS ITS FULL LABEL. <== The shortening '
    + 'is only safe when the same paragraph has already spelled the place out');
}

/* ------------------------------------------------------------------------- */
section('HARVEY — a misaligned places array is refused rather than guessed at');
{
  const short = { landfalls: [{ name: 'Somewhere Else', km: 1 }] };
  const p = para('al092017', { places: short });
  ok(!/Somewhere Else/.test(p),
    '==> THE NAMES ARE INDEX-ALIGNED AGAINST THE COMPUTED LANDFALLS. <== A places array of a '
    + `different length is a different list, and lining them up puts a name on the wrong coast. Got: ${p}`);
  ok(/came ashore four times/.test(p), `the count still comes off the facts. Got: ${p}`);
}

/* ------------------------------------------------------------------------- */
section('SANDY — the post-tropical landfall counts. §57.7c');
{
  const { facts } = factsFor('al182012');
  const p = para('al182012');

  ok(/came ashore four times/.test(p),
    '==> NEW JERSEY IS IN THE COUNT. <== Jamaica, Cuba, the Bahamas and Brigantine. Three of '
    + `these was the old answer and it was the one thing everybody would have checked. Got: ${p}`);

  const nj = facts.landfalls.find((l) => l.nature === 'post-tropical');
  ok(nj && nj.windKt >= 60, `and it is stamped post-tropical. Got: ${JSON.stringify(nj)}`);
  ok(nj && nj.category === null,
    'with no Saffir-Simpson number on it, which is what the app does everywhere else for a '
    + `system that has lost its tropical structure. Got: ${JSON.stringify(nj)}`);

  ok(!/so it is not in the list above/.test(p),
    '==> AND THE APOLOGY IS GONE, NOT SOFTENED. <== The paragraph used to explain why the '
    + `landfall was missing. It is not missing. Got: ${p}`);

  /* Her HARDEST landfall is Cuba at 100 kt, not New Jersey, so the ordinary
   * category wording is what should appear here. The post-tropical phrasing
   * has its own storm below. */
  ok(/The hardest was on October 25, a Category 3/.test(p),
    `the hardest is still Cuba, graded normally. Got: ${p}`);
}

/* ------------------------------------------------------------------------- */
section('OPHELIA — a storm whose ONLY landfalls are post-tropical. §57.7c');
{
  const { facts } = factsFor('al172017');
  ok(facts.landfalls.length > 0,
    '==> SHE USED TO COME ASHORE NOWHERE AT ALL. <== Ophelia crossed Ireland at 65 kt and the '
    + `archive said she stayed at sea. Got: ${JSON.stringify(facts.landfalls)}`);
  ok(facts.landfalls.every((l) => l.nature === 'post-tropical'),
    'and every one of them is post-tropical, which is why she was invisible');

  const p = para('al172017');
  ok(!/It never came ashore/.test(p), `so the paragraph no longer says she did not. Got: ${p}`);
  ok(/by then a post-tropical storm/.test(p),
    '==> AND THE HARDEST ONE SAYS WHAT IT WAS INSTEAD OF WHAT IT SCORED. <== It has no '
    + `category, so without this clause the sentence would go quiet on the whole point. Got: ${p}`);
  ok(!/hardest[^.]*after it had lost its tropical structure/.test(p),
    '==> AND IT DOES NOT DATE THE TRANSITION A SECOND TIME. <== The closing sentence stamps '
    + `the transition with the end of the RECORD, and Ophelia printed two dates for it. Got: ${p}`);
}

/* ------------------------------------------------------------------------- */
section('KATRINA — the storm with no stall, and the peak that is not the landfall');
{
  const { storm, facts } = factsFor('al122005');
  ok(stallWindow(storm.points) === null,
    'Katrina never stopped moving, so there is no stall clause to write');

  const p = para('al122005');
  ok(!/barely moved/.test(p), `and the clause is absent rather than zeroed. Got: ${p}`);
  ok(/peaked at 173 mph on August 28, a Category 5/.test(p), `the peak. Got: ${p}`);
  ok(/The hardest was on August 29, a Category 3/.test(p),
    '==> THE STRENGTH AT THE COAST, NOT THE PEAK. <== Katrina peaked Cat 5 over water and '
    + `landed Cat 3, and that gap is the fact people get wrong. Got: ${p}`);
  ok(facts.peakCategory === 6 && p.includes('Category 5'),
    'the prose label is derived from the same category index as everything else');
}

/* ------------------------------------------------------------------------- */
section('THE HURRICANE CLOCK — three different answers, and 1851 is why');
{
  const born = one('al011851');
  const clock = hoursToHurricane(born.points);
  ok(clock.state === 'born_hurricane',
    '==> THE FIRST VERSION REPORTED DOZENS OF 1851 STORMS TIED AT "0 HOURS TO HURRICANE". '
    + '<== Their first record was already a hurricane. That is not a fast-forming storm, it is '
    + `a storm nobody saw until it was big. Got ${clock.state}`);

  const p = storyClauses(stormFacts(born), { name: 'Unnamed', points: born.points }).join(' ');
  ok(/already a hurricane when it was first spotted, so nobody saw it form/.test(p),
    `and it says so rather than printing a zero. Got: ${p}`);
  ok(!/reached hurricane strength/.test(p), 'and the timing clause does not also fire');

  const harvey = one('al092017');
  ok(hoursToHurricane(harvey.points).state === 'formed',
    'a storm first seen as a low is measurable and is measured');

  /* A storm already at tropical-storm strength but not a hurricane is neither
   * sentence: we did not watch it form, and it was not a hurricane either. */
  const mid = { points: [
    { time: 0, windKt: 45 }, { time: 6 * 3600e3, windKt: 70 },
  ] };
  ok(hoursToHurricane(mid.points).state === 'unsayable',
    '==> AND THE MIDDLE CASE SAYS NOTHING AT ALL. <== Neither sentence is true for a storm '
    + 'first seen at 45 kt, and the peak clause already covers it');
}

/* ------------------------------------------------------------------------- */
section('THE COMPARISON FIRES ONLY AT THE EXTREMES');
{
  const median = SEASONS.medianHoursToHurricane;
  const build = (hours) => ({ points: [
    { time: 0, windKt: 25, status: 'TD', lat: 20, lonU: -50 },
    { time: hours * 3600e3, windKt: 70, status: 'HU', lat: 21, lonU: -51 },
  ] });
  const say = (hours) => {
    const s = build(hours);
    return storyClauses(stormFacts({ ...s, id: 'X', name: 'X', year: 2000 }),
      { name: 'X', points: s.points }).join(' ');
  };

  ok(/far faster than a storm usually takes/.test(say(median * 0.5)), 'well under the median');
  ok(/far longer than a storm usually takes/.test(say(median * 3)), 'well over it');
  ok(!/usually takes/.test(say(median)),
    '==> AND NOTHING AT THE MIDDLE. <== "slightly above average" is not a fact worth a '
    + 'reader\'s attention, and printing it on every storm is how the paragraph reads as filler');
  ok(!/usually takes/.test(say(median * 1.9)), 'nor just inside the upper bound');
}

/* ------------------------------------------------------------------------- */
section('THE STALL WINDOW ITSELF');
{
  const at = (h, lat, lon) => ({ time: h * 3600e3, lat, lonU: lon, status: 'TS', windKt: 40 });

  /* Parked for four days, well inside the radius. */
  const parked = [at(0, 20, -60), at(24, 20.2, -60.1), at(48, 20.1, -60.3),
    at(72, 20.3, -60.2), at(96, 20.2, -60.1)];
  ok(stallWindow(parked)?.hours === 96, 'a genuinely parked storm reports its whole window');

  /* Racing. Same number of fixes, far apart. */
  const racing = [at(0, 20, -60), at(24, 24, -66), at(48, 28, -72), at(72, 32, -78)];
  ok(stallWindow(racing) === null, 'a moving storm reports nothing');

  /* ==> AN EXCURSION IN THE MIDDLE MUST NOT END THE SEARCH FROM THAT START.
   * <== Adding a far fix moves the centroid; a LATER fix on the other side can
   * pull it back so everything fits again. Constructed so the two answers are
   * different numbers rather than a pass either way: over 0..4 the centroid is
   * 20.4 and the excursion sits 178 km out, which bursts; over 0..8 it is 20.89
   * and everything is inside 124 km. A loop that broke at the first burst would
   * report the 168-hour window starting one fix later. */
  const outAndBack = [
    at(0, 20.0, -60), at(24, 20.0, -60), at(48, 20.0, -60), at(72, 20.0, -60),
    at(96, 22.0, -60),
    at(120, 21.5, -60), at(144, 21.5, -60), at(168, 21.5, -60), at(192, 21.5, -60),
  ];
  ok(stallWindow(outAndBack)?.hours === 192,
    'a storm that wanders out and comes back is one stall over the whole window. '
    + `Got ${stallWindow(outAndBack)?.hours}`);

  /* ==> THE DATE LINE. <== `lonU` runs past ±180. A centroid taken from raw
   * longitude would put the middle of this storm at 0°E, off Africa, and every
   * fix would then read as thousands of km from its own centre. */
  const seam = [at(0, 20, 179), at(24, 20.2, 180.3), at(48, 20.1, 180.6), at(72, 20.2, 180.2)];
  ok(stallWindow(seam)?.hours === 72,
    'a stall sitting on the date line is one stall, not none');

  /* Contiguity: a wave in the middle breaks the run rather than being skipped. */
  const gap = [at(0, 20, -60), at(24, 20.2, -60.1),
    { time: 48 * 3600e3, lat: 30, lonU: -70, status: 'WV' },
    at(72, 20.1, -60.2), at(96, 20.3, -60.1)];
  const g = stallWindow(gap);
  ok(g === null || g.hours <= 24,
    '==> DROPPING NON-CYCLONE FIXES FROM A FLAT LIST SILENTLY JOINS THE TWO SIDES OF A GAP. '
    + `<== The storm crossed an ocean in between. Got ${g && g.hours}`);
}

/* ------------------------------------------------------------------------- */
section('THE SMALL FORMATTERS');
{
  ok(countWord(4) === 'four' && countWord(1) === 'one', 'counts are words');
  ok(countWord(40) === '40',
    'above twelve the word is longer than the number is useful, so digits are the fallback');
  ok(spanPhrase(66) === '3 days' && spanPhrase(12) === '12 hours',
    '==> DURATIONS ARE DIGITS EVEN THOUGH COUNTS ARE WORDS. <== "twelve days" beside '
    + '"22 days" makes two facts of the same kind look like two different kinds');
  ok(spanPhrase(1) === '1 hour', 'and the singular has no s');
  ok(spanPhrase(24) === '24 hours',
    '==> A DAY IS NEVER PRINTED SINGULAR AND THAT IS THE CUTOFF DOING ITS JOB. <== Anything '
    + 'under 36 hours reads in hours, because "1 day" for 30 hours throws away six of them');
  ok(spanPhrase(0) === null && spanPhrase(null) === null, 'and nothing is never zero');
  ok(categoryPhrase(6) === 'a Category 5' && categoryPhrase(1) === 'a tropical storm',
    'the prose label reads as a sentence where categoryShortLabel reads as a list row');
  ok(categoryPhrase(null) === null, 'and an ungraded storm gets no label rather than a dash');
}

/* ------------------------------------------------------------------------- */
section('THE MARKUP ESCAPES AND NEVER DRAWS AN EMPTY PARAGRAPH');
{
  ok(storyHtml([]) === '', 'nothing to say draws nothing at all, not an empty tag');
  ok(storyHtml([null, '  ']) === '', 'and blank clauses are not something to say');
  ok(storyHtml(['a & b <c>']).includes('&amp;') && !storyHtml(['a & b <c>']).includes('<c>'),
    '==> A STORM NAME REACHES THIS STRING. <== Escaped here so no call site can forget');
  ok(/^<p class="season-story">A\. B\.<\/p>$/.test(storyHtml(['A.', 'B.'])),
    'sentences are joined with one space inside one paragraph');
}

/* ------------------------------------------------------------------------- */
section('EVERY STORM IN THE ARCHIVE GETS A PARAGRAPH, INCLUDING 1851');
{
  for (const f of ['al011851', 'al031935', 'al021971', 'al041992', 'al052019', 'al092021']) {
    const cl = story(f);
    ok(cl.length >= 2, `${f}: a paragraph, not a fragment. Got ${cl.length} clauses`);
    ok(cl.every((s) => /\.$/.test(s.trim())), `${f}: every clause ends as a sentence`);
    ok(!/undefined|NaN|null|—/.test(cl.join(' ')),
      `${f}: ==> A CLAUSE WITH NO FIGURE BEHIND IT IS DROPPED, NOT SOFTENED. <== The em dash `
      + `is banned because lib/units.js returns a bare one when a figure fails to resolve, so `
      + `it is the cheapest signal that a number was printed anyway. Got: ${cl.join(' ')}`);
  }

  /* ==> THE 1971 STORM HAS A `-99` INTENSITY ON ITS LAST ROW AND FOUR REAL ONES
   * ABOVE IT, WHICH IS THE CASE WORTH ASSERTING. <== A parser that read -99 as
   * a number would make it the peak, and "peaked at -114 mph" is the fluent
   * wrong figure this project keeps writing down. It is NOT a storm with no
   * wind at all — measured 2026-08-29, `missing.wind` is false — so it does not
   * exercise the absence branch, and a test claiming it did would be green for
   * the wrong reason. */
  const p = para('al021971');
  ok(/peaked at 29 mph on July 7, a tropical depression/.test(p),
    `the -99 row is not the peak. Got: ${p}`);
  ok(/first seen on/.test(p) && /(faded out|lost its tropical structure|weakened|record ends)/.test(p),
    `and clauses 1 and 6, which are never dropped. Got: ${p}`);

  /* The absence branch itself, driven directly, because no storm in the
   * archive reaches it — HURDAT2 carries a wind on essentially every row back
   * to 1851. */
  const windless = {
    id: 'XX011900', name: 'NOWIND', year: 1900, basin: 'AL',
    points: [
      { time: 0, lat: 20, lon: -60, lonU: -60, status: 'TD', windKt: null, pressureMb: null },
      { time: 24 * 3600e3, lat: 21, lon: -61, lonU: -61, status: 'TD', windKt: null, pressureMb: null },
    ],
  };
  const wp = storyClauses(stormFacts(windless), { name: 'NOWIND', points: windless.points }).join(' ');
  ok(!/peaked at/.test(wp), `a storm with no wind ever recorded gets no peak clause. Got: ${wp}`);
  ok(/first seen on/.test(wp) && /after it was first seen/.test(wp),
    `and still gets a paragraph. Got: ${wp}`);
}

/* ------------------------------------------------------------------------- */
section('THE NAME — §57.52, and it speaks only when the answer is yes');
{
  const { retirementClauses } = (await import('../lib/season-story.js')).__internals;
  const { retirementFor } = await import('../data/retired-lookup.js');

  /* Driven through the REAL lookup on a real fixture, so the join and the
   * wording are proven together rather than each against a stub of the other. */
  const ida = one('al092021');
  const idaPara = para('al092021', { retirement: retirementFor(ida.name, ida.year, ida.basin) });
  ok(/The name IDA was retired after this storm and will never be used again\.$/.test(idaPara),
    `Ida 2021 closes on its retirement. Got: ${idaPara}`);

  /* ==> AND THE PARAGRAPH IS UNCHANGED WITHOUT IT. <== The clause is the last
   * thing in the paragraph and every other clause has to be identical with and
   * without it, or this pass moved something it was not asked to move. */
  const without = story('al092021');
  const withIt = story('al092021', { retirement: retirementFor(ida.name, ida.year, ida.basin) });
  ok(withIt.length === without.length + 1, `exactly one clause is added. Got ${withIt.length} vs ${without.length}`);
  ok(without.every((s, i) => s === withIt[i]), 'and nothing above it changed');

  /* ==> A STORM WHOSE NAME IS STILL IN SERVICE SAYS NOTHING. <== §5. There is
   * no negative sentence and there must not be one: below a basin's floor
   * nothing separates "not retired" from "never assessed", so silence is what
   * keeps the app from stating a thing it cannot stand behind. */
  const hugo = one('al111989');
  const sandy = one('al182012');
  ok(retirementClauses(null, 'ANYNAME').length === 0, 'no retirement, no clause');
  /* ==> JEANNE 2004 IS RETIRED AND STILL GETS NOTHING WITHOUT A LOOKUP. <==
   * The clause is driven ENTIRELY by the injected fact, never by the storm —
   * which is what keeps `lib/season-story.js` pure and keeps one join in one
   * place. A story module that reached for the list itself would be a second
   * join to drift. */
  ok(!/retired/.test(para('al112004')), 'a storm with no retirement passed in says nothing');
  ok(!!retirementFor('JEANNE', 2004, 'AL'), 'even though Jeanne 2004 is genuinely retired');
  ok(!!retirementFor(hugo.name, hugo.year, hugo.basin), 'Hugo 1989 IS retired (control)');
  ok(!!retirementFor(sandy.name, sandy.year, sandy.basin), 'Sandy 2012 IS retired (control)');

  /* ==> THE GREEK PAIR. TWO SENTENCES, AND NEITHER SAYS THE NAME WAS RETIRED.
   * <== §57.51. No Eta or Iota fixture exists, so the shape is driven directly
   * — the join itself is proven against the real archive in
   * `tools/test-retired-lookup.mjs`. */
  const greek = retirementClauses({ kind: 'description', datedToThisStorm: true }, 'ETA');
  ok(greek.length === 2, `the Greek case is two sentences. Got ${greek.length}`);
  ok(/^ETA was retired after this storm\.$/.test(greek[0]), `first sentence. Got: ${greek[0]}`);
  ok(!/The name ETA was retired/.test(greek.join(' ')),
    '==> AND IT MUST NOT SAY THE NAME WAS RETIRED. <== The letter was not '
    + 'withdrawn as a name; the alphabet was abolished. §57.51.');
  ok(/no longer used for storm names/.test(greek[1]) && /the storm and its year/.test(greek[1]),
    `second sentence explains why. Got: ${greek[1]}`);
  ok(!/never be used again/.test(greek.join(' ')),
    'and it never borrows the ordinary sentence, which is false for these two');

  /* ==> AN UNCERTAIN YEAR DROPS THE CLAUSE CARRYING IT RATHER THAN HEDGING.
   * <== §57.41's rule applied to a fact. Carol was retired, brought back and
   * retired again; the name IS withdrawn and WHICH storm earned it is not
   * settled, so `after this storm` goes and nothing is softened in its place. */
  const unsure = retirementClauses({ kind: 'name', datedToThisStorm: false }, 'CAROL');
  ok(unsure.length === 1 && /^The name CAROL was retired and will never be used again\.$/.test(unsure[0]),
    `the undated version. Got: ${unsure[0]}`);
  ok(!/after this storm/.test(unsure[0]), 'the year clause is dropped');
  ok(!/(probably|possibly|may have|thought to|appears)/i.test(unsure[0]),
    '==> AND NOT SOFTENED. <== §57.41 drops a clause it cannot back; it does not hedge it.');

  /* An unnamed storm cannot have had a name withdrawn, and the paragraph's
   * `This storm` fallback must never end up inside this sentence as if it were
   * a name. */
  ok(retirementClauses({ kind: 'name', datedToThisStorm: true }, null).length === 0,
    'no name, no clause');
  ok(retirementClauses({ kind: 'name', datedToThisStorm: true }, '').length === 0,
    'and an empty name is the same answer');

  /* ==> THE EM DASH BAN REACHES THE NEW CLAUSE TOO. <== §57.41. Every branch,
   * not just the one a fixture happens to take. */
  const branches = [
    retirementClauses({ kind: 'name', datedToThisStorm: true }, 'KATRINA'),
    retirementClauses({ kind: 'name', datedToThisStorm: false }, 'CAROL'),
    retirementClauses({ kind: 'description', datedToThisStorm: true }, 'IOTA'),
  ].flat();
  ok(branches.length === 4, `all three branches produce sentences. Got ${branches.length}`);
  ok(!branches.some((s) => /[—–]|undefined|NaN|null/.test(s)),
    `no clause carries an em dash or an unresolved figure. Got: ${branches.join(' ')}`);
  ok(branches.every((s) => /\.$/.test(s.trim())), 'and every one ends as a sentence');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
