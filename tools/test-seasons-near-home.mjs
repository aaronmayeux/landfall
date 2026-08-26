#!/usr/bin/env node
/**
 * test-seasons-near-home.mjs — the words, the units, the filter and the cache.
 * SPEC-SEASONS-BUILD.md §57.19, §57.30 step 9.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-seasons-near-home.mjs`.
 *
 * ==> `tools/test-near-home.mjs` ALREADY PROVES THE MEASUREMENT AND THIS FILE
 * DOES NOT RE-PROVE IT. <== That suite owns the one assertion step 9's
 * done-condition names — a storm that hops clean over the circle is still
 * caught — and it is green. What was untested until now is everything BETWEEN
 * that measurement and a reader: which filter is offered, what the row says,
 * which circle a slider value means in two unit systems, and whether a stored
 * answer is still the answer.
 *
 * ==> THE UNIT SYSTEMS ARE WHY HALF OF THIS EXISTS. <== §57.19 fixed the range
 * in miles. This app has a metric reader, and the failure that matters is
 * silent: a slider reading 500 while the filter measures a circle 60% the size,
 * with a roster that looks merely quiet rather than wrong. Every conversion in
 * the feature runs through `radiusToNm`, and this file pins both ends of both
 * ranges against hand-computed nautical miles.
 *
 * ==> AND THE CACHE RULES ARE TESTED WITHOUT A WORKER. <== Nothing in the cloud
 * sandbox can start one. `runPass` takes an injectable `spawn` precisely so the
 * message contract can be driven by a fake — and that seam is NOT a fallback:
 * production has one implementation, and a browser with no Worker gets no
 * standing line at all rather than a two-second parse on the main thread.
 *
 * WHAT THIS CANNOT PROVE: whether the slider feels right under a thumb, whether
 * "Passed 31 mi WSW as a Cat 2" reads well at small type, or whether the
 * standing line is worth its megabyte. All three are glass.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* A localStorage that behaves like the real one, including throwing on demand —
 * Safari private mode is a real device and the guards exist for it. */
let store = new Map();
let throwOnWrite = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (throwOnWrite) throw new Error('QuotaExceededError');
    store.set(k, String(v));
  },
  removeItem: (k) => store.delete(k),
};

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { closestApproach, indexNearHome, within, miToNm } = await import('../lib/near-home.js');
const {
  approachPhrase, radiusToNm, rangeFor, standingCount, standingSentence,
} = await import('../lib/near-home-words.js');
const {
  NEAR_HOME_FILTER, entriesNearHome, nearHomeFilters, radiusFromValue, radiusSliderHtml,
  approachNoteHtml,
} = await import('../ui/seasons-near-home.js');
const { filtersFor, entriesMatching, seasonRosterHtml } =
  await import('../ui/seasons-board-markup.js');
const { emptyRosterHtml } = await import('../ui/seasons-board-furniture.js');
const { stormFacts } = await import('../lib/season-facts.js');
const nearIndex = await import('../data/near-home-index.js');

const storm = (f) => readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8');
const season = (f) => readFileSync(`samples/seasons/seasons/${f}.txt`, 'utf8');
const one = (f) => parseHurdat2(storm(f)).storms[0];
const entriesOf = (f) => parseHurdat2(season(f)).storms
  .map((s) => ({ storm: s, facts: stormFacts(s) }));

const NEW_ORLEANS = { lon: -90.0715, lat: 29.9511 };
const MIAMI = { lon: -80.1918, lat: 25.7617 };
const REYKJAVIK = { lon: -21.94, lat: 64.15 };

/* ------------------------------------------------------------------------- */
section('the two ranges cover the same circle, and the conversion is exact');
{
  const mi = rangeFor('imperial');
  const km = rangeFor('metric');

  ok(mi.unit === 'mi' && km.unit === 'km', 'each system names its own unit');

  /* ==> THE POINT OF TWO RANGES IS THAT THEY REACH THE SAME DISTANCE. <== If
   * they ever drift, a reader switching to kilometres silently loses reach and
   * the roster gets shorter for a reason nothing on screen explains. Half a
   * percent is the measured gap between 500 mi and 800 km. */
  const maxMi = radiusToNm(mi.max, 'imperial');
  const maxKm = radiusToNm(km.max, 'metric');
  ok(Math.abs(maxMi - maxKm) / maxMi < 0.01,
    `the two maxima must be the same circle. 500 mi = ${maxMi.toFixed(1)} nm, 800 km = ${maxKm.toFixed(1)} nm`);

  /* Hand-computed: 500 statute miles is 434.49 nm; 800 km is 431.97 nm. */
  ok(Math.abs(maxMi - 434.49) < 0.5, `500 mi must be 434.5 nm, got ${maxMi.toFixed(2)}`);
  ok(Math.abs(maxKm - 431.97) < 0.5, `800 km must be 432.0 nm, got ${maxKm.toFixed(2)}`);

  /* ==> AND THE DEFAULTS TOO, BECAUSE THE STANDING LINE QUOTES ONE OF THEM.
   * <== The door says "within 120 mi" or "within 200 km" and then opens a board
   * whose slider sits on the same number. Two defaults naming different circles
   * would make the door and the board disagree in two taps. */
  const defMi = radiusToNm(mi.default, 'imperial');
  const defKm = radiusToNm(km.default, 'metric');
  ok(Math.abs(defMi - defKm) / defMi < 0.05,
    `the two defaults must be near enough the same circle. ${defMi.toFixed(1)} nm vs ${defKm.toFixed(1)} nm`);

  ok(radiusToNm(NaN, 'imperial') === null, 'a broken slider value converts to null, never NaN miles');
}

/* ------------------------------------------------------------------------- */
section('a slider value is clamped into whichever range is now in play');
{
  /* THE CASE THIS EXISTS FOR: the reader drags to 800 in kilometres, opens
   * Settings, switches to miles, comes back. 800 is off the end of the mile
   * slider, and a stale value would leave the thumb pinned at the maximum while
   * the filter measured a circle 60% larger than the one on screen. */
  const carried = radiusFromValue(800, 'imperial');
  ok(carried.radius === rangeFor('imperial').max,
    `800 carried into imperial must clamp to 500, got ${carried.radius}`);

  /* ==> AND THE OTHER DIRECTION DOES NOT CLAMP, WHICH IS CORRECT. <== 500 is a
   * legal value on the kilometre slider, so a reader who set 500 miles and
   * flipped units gets 500 km — a smaller circle, named honestly by a control
   * that reads 500 km. The number is the reader's number in the reader's units;
   * silently rewriting it to preserve the distance would put a value on the
   * slider they never chose. */
  ok(radiusFromValue(500, 'metric').radius === 500,
    '500 is a real kilometre value and is left alone');

  const low = radiusFromValue(1, 'imperial');
  ok(low.radius === rangeFor('imperial').min, 'below the minimum clamps up rather than measuring a circle of nothing');

  ok(radiusFromValue('120', 'imperial').radius === 120,
    'a string off a DOM input is read as a number — this is how the board reads it');
  ok(radiusFromValue('', 'imperial') === null, 'an empty value is refused rather than read as zero');
  ok(radiusFromValue('abc', 'imperial') === null, 'a non-number is refused');
}

/* ------------------------------------------------------------------------- */
section('==> THE FILTER IS NOT OFFERED WHEN THERE IS NO HOUSE <==');
{
  /* §57.18a's rule: a control that cannot succeed is the same mistake as a
   * Retry button on a year the archive does not hold. With no home, Near home
   * can only ever narrow to nothing. */
  ok(nearHomeFilters(null).length === 0, 'no home, no filter');
  ok(nearHomeFilters({ lon: NaN, lat: 5 }).length === 0, 'a broken coordinate is not a home');
  ok(nearHomeFilters(MIAMI).length === 1, 'a real home offers the filter');

  const withHome = filtersFor(false, MIAMI).map((f) => f.id);
  const without = filtersFor(false, null).map((f) => f.id);
  ok(withHome.length === 4 && withHome[3] === NEAR_HOME_FILTER,
    `a settled season with a home offers four filters, near home last. Got ${withHome.join(',')}`);
  ok(without.length === 3, `no home means three filters. Got ${without.join(',')}`);

  /* The season in progress drops Landfalls and keeps Near home — the two
   * absences have different causes and must not be confused. */
  const live = filtersFor(true, MIAMI).map((f) => f.id);
  ok(live.includes(NEAR_HOME_FILTER) && !live.includes('landfalls'),
    `the season in progress keeps near home and drops landfalls. Got ${live.join(',')}`);
}

/* ------------------------------------------------------------------------- */
section('the season filter, on the real 2005 Atlantic');
{
  const entries = entriesOf('al-2005');
  ok(entries.length > 20, `the 2005 fixture must actually hold a season. Got ${entries.length}`);

  const nm = radiusToNm(100, 'imperial');
  const near = entriesNearHome(entries, NEW_ORLEANS, nm);

  ok(near.length > 0 && near.length < entries.length,
    `2005 within 100 mi of New Orleans must be some of the season, not all or none. Got ${near.length} of ${entries.length}`);

  /* ==> KATRINA IS THE HAND-CHECK. <== §57.19 names her by name: 24.4 nm
   * measured against the line, 30.1 nm measured at the records, and the two
   * fall on opposite sides of a 30-mile circle. She must be in a 100-mile list
   * of New Orleans by either method, which is what makes her a safe anchor for
   * everything else this section asserts. */
  const katrina = near.find((e) => e.storm.name === 'KATRINA');
  ok(Boolean(katrina), 'Katrina must be within 100 miles of New Orleans in 2005');
  ok(katrina && katrina.near.nm < nm, 'and her measurement must actually be inside the circle she was let through on');

  /* ==> SORTED BY DISTANCE, WHICH IS THIS FILTER'S OWN RULE. <== §57.18 keeps
   * the roster chronological everywhere else; this list answers "what came near
   * my house" and the closest is what a reader wants first.
   *
   * ==> AND NEW ORLEANS CANNOT PROVE IT, WHICH IS THE FINDING. <== Deleting the
   * sort left this section GREEN on the first pass: 2005 gives New Orleans two
   * storms, Cindy then Katrina, and they arrive in chronological order that
   * happens to already be ascending by distance. A fixture that cannot show the
   * thing is worse than no assertion, because it reads as coverage.
   *
   * Miami in the same season is the shape that can: five storms within 150
   * miles whose chronological order is Katrina 10, Ophelia 86, Rita 123, Tammy
   * 96, Wilma 49 — Rita before Tammy and Wilma last are both out of order, so a
   * list left in season order fails this and a sorted one passes. */
  const miami = entriesNearHome(entries, MIAMI, radiusToNm(150, 'imperial'));
  ok(miami.length === 5, `Miami 2005 within 150 mi must be the five-storm fixture. Got ${miami.length}`);
  const chronological = entries
    .filter((e) => miami.some((m) => m.storm.id === e.storm.id))
    .map((e) => closestApproach(e.storm, MIAMI).nm);
  ok(!chronological.every((v, i, a) => i === 0 || a[i - 1] <= v),
    'the fixture must NOT already be in distance order, or this assertion proves nothing');
  ok(miami.every((e, i, a) => i === 0 || a[i - 1].near.nm <= e.near.nm),
    `the near-home list is nearest first. Got ${miami.map((e) => e.storm.name).join(', ')}`);

  ok(near.every((e, i, a) => i === 0 || a[i - 1].near.nm <= e.near.nm),
    'and the New Orleans list too');

  /* Every row carries its own measurement, so the caption cannot disagree with
   * the filter that let it through. */
  ok(near.every((e) => Number.isFinite(e.near?.nm)), 'every row carries the measurement that admitted it');

  /* Shrinking the circle can only ever shrink the list. */
  const tighter = entriesNearHome(entries, NEW_ORLEANS, radiusToNm(30, 'imperial'));
  ok(tighter.length <= near.length, 'a smaller radius cannot return more storms');
  ok(tighter.every((e) => near.some((n) => n.storm.id === e.storm.id)),
    'and everything in the smaller circle is in the bigger one');

  /* Reykjavik is the empty case and it is a real answer, not a failure. */
  ok(entriesNearHome(entries, REYKJAVIK, radiusToNm(100, 'imperial')).length === 0,
    'no 2005 Atlantic storm came within 100 miles of Reykjavik');

  ok(entriesNearHome(entries, null, nm).length === 0, 'no home measures nothing');
  ok(entriesNearHome(entries, NEW_ORLEANS, null).length === 0, 'no radius measures nothing');
}

/* ------------------------------------------------------------------------- */
section('==> A MISSING RADIUS SHOWS EVERYTHING, NOT NOTHING <==');
{
  /* §5's shape applied to a parameter. A caller that forgot the measurement is
   * a bug either way — but too many rows is visibly wrong, and a roster that
   * empties looks exactly like a season with no storms in it. */
  const entries = entriesOf('al-2005');
  ok(entriesMatching(entries, NEAR_HOME_FILTER, null).length === entries.length,
    'near home with no measurement falls back to the whole season');
  ok(entriesMatching(entries, NEAR_HOME_FILTER, { home: MIAMI }).length === entries.length,
    'and a bundle with a home but no radius does the same');

  const good = entriesMatching(entries, NEAR_HOME_FILTER,
    { home: NEW_ORLEANS, nm: radiusToNm(100, 'imperial') });
  ok(good.length < entries.length, 'a complete bundle actually narrows');

  /* The other three filters are untouched by the new argument. */
  ok(entriesMatching(entries, 'all').length === entries.length, 'All still shows all');
  ok(entriesMatching(entries, 'majors').length < entries.length, 'Majors still narrows');
}

/* ------------------------------------------------------------------------- */
section('what a row says about how close it came');
{
  const ida = one('al092021');
  const near = closestApproach(ida, NEW_ORLEANS);

  const mi = approachPhrase(near, NEW_ORLEANS, 'imperial');
  const km = approachPhrase(near, NEW_ORLEANS, 'metric');
  ok(mi.includes('mi'), `the imperial phrase speaks miles. Got "${mi}"`);
  ok(km.includes('km'), `the metric phrase speaks kilometres. Got "${km}"`);
  ok(mi !== km, 'and the two are not the same string');

  /* ==> THE COMPASS WORD IS THE APP'S OWN SIXTEEN-POINT ONE. <== Ida passed to
   * the west of New Orleans, so the phrase must carry a westerly bearing rather
   * than an easterly one — this is the assertion that catches the two points
   * being handed to `bearingDeg` the wrong way round, which reads perfectly
   * well and points at the wrong half of the map. */
  ok(/\bW|WSW|WNW|SW|NW\b/.test(mi), `Ida passed west of New Orleans. Got "${mi}"`);

  /* ==> A STRENGTH IS ONLY CLAIMED WHEN THE RECORD SUPPORTS ONE. <== §6. */
  const graded = approachPhrase(
    { nm: 20, lon: -90.5, lat: 29.9, windKt: 90, status: 'HU' }, NEW_ORLEANS, 'imperial');
  ok(graded.includes('as a Cat 2'), `90 kt at a hurricane record is a Cat 2. Got "${graded}"`);

  const extratropical = approachPhrase(
    { nm: 20, lon: -90.5, lat: 29.9, windKt: 90, status: 'EX' }, NEW_ORLEANS, 'imperial');
  ok(!extratropical.includes('Cat'),
    `an extratropical record must not be given a Saffir-Simpson grade. Got "${extratropical}"`);
  ok(extratropical.includes('mi'), 'but it still says how far away it was');

  const nowind = approachPhrase(
    { nm: 20, lon: -90.5, lat: 29.9, windKt: null, status: 'HU' }, NEW_ORLEANS, 'imperial');
  ok(!nowind.includes('—') && !nowind.includes('as a'),
    `an ungradeable wind drops the clause rather than printing a dash. Got "${nowind}"`);

  /* A direct hit has no meaningful direction and must not invent one. */
  const onTop = approachPhrase(
    { nm: 0, lon: NEW_ORLEANS.lon, lat: NEW_ORLEANS.lat, windKt: 80, status: 'HU' },
    NEW_ORLEANS, 'imperial');
  ok(!/\b(N|NE|E|SE|S|SW|W|NW)\b/.test(onTop),
    `a storm that passed over the house gets no direction. Got "${onTop}"`);

  ok(approachPhrase(null, NEW_ORLEANS, 'imperial') === '', 'no measurement, no phrase');
  ok(approachNoteHtml(null, NEW_ORLEANS, 'imperial') === '',
    'and no phrase means no element at all rather than an empty one');
  ok(approachNoteHtml(near, NEW_ORLEANS, 'imperial').includes('seasons-approach'),
    'a real measurement draws the row line');
}

/* ------------------------------------------------------------------------- */
section('the roster prints the line under near home and nowhere else');
{
  const entries = entriesOf('al-2005');
  const bundle = { home: NEW_ORLEANS, nm: radiusToNm(100, 'imperial') };
  const rows = entriesMatching(entries, NEAR_HOME_FILTER, bundle);

  const withNear = seasonRosterHtml({
    state: 'ok', reason: '', year: 2005, provisional: false, rows,
    anyEntries: true, ticked: new Set(), ghosts: null,
    home: NEW_ORLEANS, system: 'imperial', filter: NEAR_HOME_FILTER, radiusWords: '100 mi',
  });
  ok(withNear.includes('seasons-approach'), 'the near-home roster carries the approach line');
  ok(withNear.includes('Passed'), 'and it reads as a sentence');

  const asAll = seasonRosterHtml({
    state: 'ok', reason: '', year: 2005, provisional: false,
    rows: entriesMatching(entries, 'all'),
    anyEntries: true, ticked: new Set(), ghosts: null,
    home: NEW_ORLEANS, system: 'imperial', filter: 'all', radiusWords: '',
  });
  ok(!asAll.includes('seasons-approach'),
    'and the All roster does not — the measurement rides on the entry, so there is nothing to print');
}

/* ------------------------------------------------------------------------- */
section('==> AN EMPTY NEAR-HOME LIST IS AN ANSWER, IN ITS OWN WORDS <==');
{
  /* This is the §5 assertion of the whole step. "No storms match that filter"
   * is true and useless; under this filter the empty result IS what somebody
   * asked for, and it has to name the circle they chose. */
  const words = emptyRosterHtml({
    year: 1997, filtered: true, provisional: false,
    filter: NEAR_HOME_FILTER, radiusWords: '50 mi',
  });
  ok(words.includes('came within'), `the near-home empty state says nothing came near. Got: ${words}`);
  ok(words.includes('50 mi'), 'and it names the circle the reader chose');
  ok(!words.includes('match that filter'), 'it does not fall through to the generic filter sentence');

  const generic = emptyRosterHtml({ year: 1997, filtered: true, provisional: false });
  ok(generic.includes('match that filter'), 'the other filters keep the generic sentence');

  const quiet = emptyRosterHtml({ year: 1914, filtered: false, provisional: false });
  ok(quiet.includes('no storms for'), 'a genuinely quiet year is still a different sentence again');
}

/* ------------------------------------------------------------------------- */
section('the slider markup');
{
  const html = radiusSliderHtml(120, 'imperial');
  ok(html.includes('type="range"'), 'it is a real range input, so keyboard and screen reader come free');
  ok(html.includes('data-radius'), 'and it carries the hook the board delegates on');
  ok(html.includes('min="10"') && html.includes('max="500"') && html.includes('step="10"'),
    'the imperial range is on the element');
  ok(html.includes('class="slider"'), 'it uses the app\'s own slider class, not a second one');
  ok(html.includes('120 mi'), 'the readout names the value AND the unit');
  ok(html.includes('aria-valuetext="120 mi"'),
    'and a screen reader is told the same string a sighted reader sees, not a bare number');

  const metric = radiusSliderHtml(200, 'metric');
  ok(metric.includes('max="800"') && metric.includes('200 km'), 'the metric range and readout are its own');

  const fallback = radiusSliderHtml(undefined, 'imperial');
  ok(fallback.includes(`value="${rangeFor('imperial').default}"`),
    'a missing value falls back to the default rather than to zero');
}

/* ------------------------------------------------------------------------- */
section('the standing line');
{
  const idx = [
    { nm: miToNm(10), year: 1900 },
    { nm: miToNm(50), year: 2024 },
    { nm: miToNm(400), year: 2010 },
  ];
  const { count, lastYear } = standingCount(idx, miToNm(100));
  ok(count === 2, `two of those three are inside 100 miles. Got ${count}`);
  ok(lastYear === 2024, `the most recent inside the circle is 2024, not 2010. Got ${lastYear}`);

  /* ==> THE LAST YEAR MUST COME FROM INSIDE THE CIRCLE. <== Reading it off the
   * whole index instead would report a storm that never came near, in a
   * sentence whose whole subject is storms that did. */
  const tight = standingCount(idx, miToNm(20));
  ok(tight.count === 1 && tight.lastYear === 1900,
    `inside 20 miles only 1900 qualifies. Got ${tight.count} / ${tight.lastYear}`);

  ok(standingCount(idx, null).count === 0, 'no radius counts nothing rather than everything');
  ok(standingCount(null, miToNm(100)).count === 0, 'a null index counts nothing rather than throwing');

  const s = standingSentence({ count: 143, lastYear: 2024, radius: 120, unit: 'mi', firstSeason: 1851 });
  ok(s.includes('143 storms have passed'), `the sentence leads with the count. Got: ${s}`);
  ok(s.includes('within 120 mi'), 'it names the circle');
  ok(s.includes('since 1851'), 'and the year the record opens');
  ok(s.includes('The last was 2024.'), 'and when the most recent one was');

  /* ==> ZERO GETS WORDS OF ITS OWN AND THEY ARE NOT "0 storms". <== A count of
   * none is a real and interesting answer for an inland house. */
  const none = standingSentence({ count: 0, lastYear: null, radius: 120, unit: 'mi', firstSeason: 1851 });
  ok(!none.includes('0 storms'), `zero must not read as a tally. Got: ${none}`);
  ok(none.includes('No storm on record'), 'it reads as an answer');

  ok(standingSentence({ count: 1, lastYear: 1999, radius: 50, unit: 'mi', firstSeason: 1851 })
    .includes('1 storm has'), 'one storm is singular');

  /* The first season is read off the archive, so a missing one drops the clause
   * rather than printing a year nothing supports. */
  const noYear = standingSentence({ count: 5, lastYear: 2000, radius: 120, unit: 'mi', firstSeason: null });
  ok(!noYear.includes('since'), `an unknown first season drops the clause. Got: ${noYear}`);
}

/* ------------------------------------------------------------------------- */
section('==> THE STORED ANSWER, AND WHEN IT STOPS BEING THE ANSWER <==');
{
  const { revisionOf, firstSeasonOf, recordMatches } = nearIndex;

  const index = {
    basins: {
      atlantic: { revision: '02272026', firstSeason: 1851, file: '/seasons/data/a.txt' },
      epacific: { revision: '02272026', firstSeason: 1949, file: '/seasons/data/e.txt' },
    },
  };

  ok(revisionOf(index) === 'atlantic:02272026|epacific:02272026',
    `the revision key names both basins. Got ${revisionOf(index)}`);
  ok(firstSeasonOf(index) === 1851, 'the first season is the earliest across every basin');
  ok(revisionOf({ basins: {} }) === null, 'an index with no basins has no revision');

  const record = { home: { lon: -90.0715, lat: 29.9511 }, rev: revisionOf(index), first: 1851, index: [] };

  ok(recordMatches(record, NEW_ORLEANS, revisionOf(index)), 'the same house and the same files still match');

  /* ==> A REVISED RECORD INVALIDATES IT, AND THIS IS THE ASSERTION THAT MATTERS.
   * <== NOAA republishes seasons it has already published — the real directory
   * carries five revisions of the 2022 Atlantic file — and a correction can move
   * a storm across the reader's radius. Keyed on the year alone, a house would
   * hold an answer computed from a file NOAA has withdrawn, silently, forever. */
  const revised = { basins: { ...index.basins, atlantic: { ...index.basins.atlantic, revision: '05012026' } } };
  ok(!recordMatches(record, NEW_ORLEANS, revisionOf(revised)),
    'a revised archive throws the stored answer away');

  ok(!recordMatches(record, MIAMI, revisionOf(index)), 'moving house throws it away');
  ok(!recordMatches(null, NEW_ORLEANS, revisionOf(index)), 'nothing stored is not a match');
  ok(!recordMatches({ ...record, index: null }, NEW_ORLEANS, revisionOf(index)),
    'a record with no index in it is not a match, however good its stamps look');
}

/* ------------------------------------------------------------------------- */
section('storage that throws, and a pass that fails');
{
  const { __internals } = nearIndex;

  store = new Map();
  throwOnWrite = false;
  __internals.writeRecord({ home: MIAMI, rev: 'x', first: 1851, index: [] });
  ok(__internals.readRecord()?.rev === 'x', 'an ordinary write round-trips');

  /* ==> A FULL STORE MUST NOT TAKE THE ANSWER DOWN WITH IT. <== The index is
   * already in memory by then; all that is lost is the saving on the next
   * visit. */
  throwOnWrite = true;
  let threw = false;
  try { __internals.writeRecord({ home: MIAMI, rev: 'y', first: 1851, index: [] }); } catch { threw = true; }
  ok(!threw, 'a quota-exceeded write is swallowed rather than thrown');
  throwOnWrite = false;

  store.set('landfall.nearHome', '{not json');
  ok(__internals.readRecord() === null, 'a corrupt record reads as nothing stored rather than throwing');
  store = new Map();

  /* ==> A BROWSER WITH NO WORKER GETS NO LINE, NOT A FROZEN APP. <== There is
   * deliberately no main-thread fallback: running a two-second parse in front
   * of a globe to fill in one sentence is §57.35 FAULT 1 happening on purpose. */
  const noWorker = await __internals.runPass({ files: [], home: MIAMI, spawn: () => null });
  ok(noWorker.ok === false, 'no Worker means no answer');
  ok(/Web Worker/.test(noWorker.reason), `and it says why. Got: ${noWorker.reason}`);

  const refused = await __internals.runPass({
    files: [], home: MIAMI, spawn: () => { throw new Error('blocked'); },
  });
  ok(refused.ok === false && /blocked/.test(refused.reason),
    'a worker that refuses to start is reported rather than left hanging');

  /* ==> A WORKER THAT THROWS MUST STILL SETTLE THE PROMISE. <== An unhandled
   * `onerror` is a caller waiting forever for a sentence that is never coming. */
  const fake = () => {
    const w = { terminate() { w.dead = true; }, postMessage() { setTimeout(() => w.onerror(new Error('boom')), 0); } };
    return w;
  };
  const errored = await __internals.runPass({ files: [], home: MIAMI, spawn: fake });
  ok(errored.ok === false && /boom/.test(errored.reason), 'an uncaught worker error settles as a failure');

  /* And a good answer comes back, with the worker terminated behind it. */
  let built;
  const good = () => {
    built = { terminate() { built.dead = true; }, postMessage(msg) { built.sent = msg; setTimeout(() => built.onmessage({ data: { ok: true, index: [{ nm: 1, year: 2000 }] } }), 0); } };
    return built;
  };
  const out = await __internals.runPass({ files: [{ basin: 'atlantic', url: '/a.txt' }], home: MIAMI, spawn: good });
  ok(out.ok === true && out.index.length === 1, 'a good answer comes back');
  ok(built.dead === true, 'and the worker is terminated — a live one holds a parsed archive in heap');
  ok(built.sent?.files?.[0]?.url === '/a.txt' && built.sent?.home === MIAMI,
    'the job actually carried the files and the house');
}

/* ------------------------------------------------------------------------- */
section('the trim the worker applies before anything crosses');
{
  /* ==> `nearHomeKeepMi` IS WHAT MAKES THIS FEATURE STORABLE. <== The full
   * index is one entry per storm — 3,266 of them, 554 KB of JSON, measured. The
   * slider cannot ask past the keep radius, so everything beyond it is weight
   * with no question behind it. This is the same call the worker makes. */
  const { SEASONS } = await import('../config/constants.js');
  const all = parseHurdat2(season('al-2005')).storms;
  const full = indexNearHome(all, NEW_ORLEANS);
  const kept = within(full, SEASONS.nearHomeKeepMi);

  ok(kept.length < full.length, `the trim must actually drop something. ${full.length} -> ${kept.length}`);
  ok(kept.every((e) => e.mi <= SEASONS.nearHomeKeepMi), 'and nothing kept is outside the keep radius');

  /* The keep radius has to cover the furthest either slider can reach, or a
   * reader at maximum range would be filtering against a truncated index and
   * the roster would simply be short. */
  const reach = Math.max(radiusToNm(rangeFor('imperial').max, 'imperial'),
    radiusToNm(rangeFor('metric').max, 'metric'));
  ok(miToNm(SEASONS.nearHomeKeepMi) >= reach,
    `the keep radius must cover both sliders. keep ${miToNm(SEASONS.nearHomeKeepMi).toFixed(1)} nm, reach ${reach.toFixed(1)} nm`);
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
