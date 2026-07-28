#!/usr/bin/env node
/**
 * test-jtwc-wind.mjs — the JTWC intensity parse and the join that uses it.
 *
 * ZERO DEPENDENCIES, like every other tool here: a guard that only runs on the
 * machine which happens to have a package installed is not a guard (§12).
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front:
 *
 *   IT CAN prove the rules. That a real warning's position/wind blocks come
 *   apart correctly, that a month-less date-time group lands on the right day
 *   in both rollover directions, that a forecast ladder crossing a month
 *   boundary walks FORWARD instead of jumping back, that the two guards
 *   (distance, age) refuse the matches they are there to refuse, and — the one
 *   that actually earns its keep — that a GDACS hurricane with a JTWC warning
 *   stops drawing at the ~109 kt class midpoint that started all this.
 *
 *   IT CANNOT prove the cage looks right. THE STANDING RULE: when a fixture
 *   passes and glass fails, the fixture is wrong. Go read the real bytes —
 *   /api/jtwc/storms is permanent and costs nothing idle.
 *
 * THE FIXTURE IS REAL BYTES, not invented. It is the 12W (DOLPHIN) warning
 * read live through the relay on 2026-07-28 — abridged to the lines the parser
 * looks at, with the original spacing, ordering and zero-padding kept exactly
 * as they arrived. That storm is also the one that proved the bug: GDACS
 * labelled its forecast track "HU" while JTWC had it at 45 kt.
 */

import {
  parseSubject,
  parseWarningIntensity,
  resolveDtg,
} from '../functions/api/jtwc/storms.js';
import {
  matchJtwcEntry,
  applyJtwcWind,
  joinJtwcWinds,
  jtwcWindKtAt,
} from '../lib/jtwc-wind.js';
import { representativeKt, categoryFromKt } from '../lib/category.js';

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const HOUR = 3600 * 1000;

/* --- fixture ---------------------------------------------------------------
 * 12W (DOLPHIN), warning 004, read 2026-07-28 through /api/jtwc/warning.
 * ------------------------------------------------------------------------ */

const DOLPHIN = `WTPN31 PGTW 272100
MSGID/GENADMIN/JOINT TYPHOON WRNCEN PEARL HARBOR HI//
SUBJ/TROPICAL STORM 12W (DOLPHIN) WARNING NR 004//
RMKS/
1. TROPICAL STORM 12W (DOLPHIN) WARNING NR 004
   WARNING POSITION:
   271800Z --- NEAR 13.2N 173.7E
   MOVEMENT PAST SIX HOURS - 280 DEGREES AT 15 KTS
   POSITION ACCURATE TO WITHIN 060 NM
   POSITION BASED ON CENTER LOCATED BY A COMBINATION OF SATELLITE
   AND SYNOPTIC DATA
   PRESENT WIND DISTRIBUTION:
   MAX SUSTAINED WINDS - 045 KT, GUSTS 055 KT
   RADIUS OF 034 KT WINDS - 080 NM NORTHEAST QUADRANT
                            070 NM SOUTHEAST QUADRANT
   REPEAT POSIT: 13.2N 173.7E
   MINIMUM CENTRAL PRESSURE AT 271800Z IS 997 MB.
   MAXIMUM SIGNIFICANT WAVE HEIGHT AT 271800Z IS 18 FEET.
2. FORECASTS:
   280600Z --- 13.3N 171.4E
   MAX SUSTAINED WINDS - 060 KT, GUSTS 075 KT
   RADIUS OF 050 KT WINDS - 030 NM NORTHEAST QUADRANT
   RADIUS OF 034 KT WINDS - 080 NM NORTHEAST QUADRANT
   281800Z --- 13.7N 169.6E
   MAX SUSTAINED WINDS - 080 KT, GUSTS 100 KT
   RADIUS OF 064 KT WINDS - 020 NM NORTHEAST QUADRANT
   290600Z --- 14.4N 168.1E
   MAX SUSTAINED WINDS - 105 KT, GUSTS 130 KT
   291800Z --- 15.3N 166.5E
   MAX SUSTAINED WINDS - 130 KT, GUSTS 160 KT
   300600Z --- 16.4N 164.7E
   MAX SUSTAINED WINDS - 145 KT, GUSTS 175 KT
   301800Z --- 17.4N 163.0E
   MAX SUSTAINED WINDS - 145 KT, GUSTS 175 KT
   311800Z --- 19.2N 159.4E
   MAX SUSTAINED WINDS - 135 KT, GUSTS 165 KT
   011800Z --- 21.5N 155.6E
   MAX SUSTAINED WINDS - 135 KT, GUSTS 165 KT
//
NNNN`;

/** A Southern Hemisphere product — the hemisphere letters are read, never
 *  assumed, and this is the only thing that proves it. Shaped to JTWC's `sh`
 *  format; the parser sees the same three line types either way. */
const SOUTHERN = `WTXS31 PGTW 150300
SUBJ/TROPICAL CYCLONE 05S (ANIKA) WARNING NR 012//
   WARNING POSITION:
   150000Z --- NEAR 18.4S 92.7E
   MAX SUSTAINED WINDS - 075 KT, GUSTS 090 KT
   FORECASTS:
   151200Z --- 19.8S 91.1E
   MAX SUSTAINED WINDS - 085 KT, GUSTS 105 KT`;

/** Read-time clock for the fixture: 2026-07-28T01:00Z, an hour after the
 *  warning above was issued. Passed in explicitly — the parser never reads a
 *  clock of its own, precisely so this can be pinned. */
const NOW = Date.UTC(2026, 6, 28, 1, 0, 0);

/* --- the parse ------------------------------------------------------------ */

section('the intensity parse');

const d = parseWarningIntensity(DOLPHIN, NOW);

ok(d.fix?.windKt === 45, 'the CURRENT wind is 45 kt — not the 145 kt peak below it');
ok(d.fix?.gustKt === 55, 'gusts come off the same line');
ok(d.fix?.pressureMb === 997, 'minimum central pressure is read');
ok(d.fix?.headingDeg === 280 && d.fix?.speedKt === 15, 'movement gives heading and speed');
ok(d.fix?.accuracyNm === 60, 'position accuracy survives its zero padding (060 -> 60)');
ok(Math.abs(d.fix.lat - 13.2) < 1e-9 && Math.abs(d.fix.lon - 173.7) < 1e-9,
  'the fix position parses through the NEAR prefix');

/* THE FAILURE THIS GUARDS. The wind under a position line belongs to THAT
 * position. If block scanning leaked, the fix would take the first forecast's
 * 60 kt (or worse, the 145 kt peak) and every GDACS storm would be overstated
 * again — the same bug in a new place. */
ok(d.forecast.length === 8, 'all eight forecast hours are found');
ok(d.forecast[0].windKt === 60 && d.forecast[0].gustKt === 75,
  'the first tau keeps its own wind');
ok(d.forecast[4].windKt === 145, 'the peak tau is read as a tau, not as the fix');
ok(d.forecast.every((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)),
  'every forecast hour has a position');

section('the message header is not a position line');
/* `WTPN31 PGTW 272100` is six digits in the right shape and would match a
 * looser pattern. It has no `---` and no coordinates. */
ok(d.fix.at === new Date(Date.UTC(2026, 6, 27, 18, 0, 0)).toISOString(),
  'the fix is dated 271800Z, not the 272100 in the header');

section('hemispheres are read, not assumed');
const s = parseWarningIntensity(SOUTHERN, Date.UTC(2026, 0, 15, 4, 0, 0));
ok(s.fix?.lat === -18.4, 'a southern latitude comes back negative');
ok(s.fix?.lon === 92.7, 'an eastern longitude stays positive');
ok(s.fix?.windKt === 75, 'the southern-hemisphere product parses the same way');

section('month-less date-time groups');
/* JTWC publishes DAY-OF-MONTH ONLY. Everything below is the calendar the
 * product does not carry. */
ok(resolveDtg(27, 18, 0, NOW) === Date.UTC(2026, 6, 27, 18, 0, 0),
  'a DTG in the current month resolves to it');
/* Read just after midnight on 1 August: `311800Z` is YESTERDAY, in July. */
ok(resolveDtg(31, 18, 0, Date.UTC(2026, 7, 1, 0, 30, 0)) === Date.UTC(2026, 6, 31, 18, 0, 0),
  'a DTG from the end of last month resolves backwards across the boundary');
/* Read in the last hour of 31 July: `010600Z` is TOMORROW, in August. */
ok(resolveDtg(1, 6, 0, Date.UTC(2026, 6, 31, 23, 30, 0)) === Date.UTC(2026, 7, 1, 6, 0, 0),
  'a DTG from the start of next month resolves forwards across the boundary');
ok(resolveDtg(31, 0, 0, Date.UTC(2026, 8, 15, 0, 0, 0)) === Date.UTC(2026, 7, 31, 0, 0, 0),
  'day 31 in a 30-day month is rejected rather than rolling into the next one');
ok(resolveDtg(0, 12, 0, NOW) === null, 'day zero is not a day');
ok(resolveDtg(15, 24, 0, NOW) === null, 'hour 24 is not an hour');

section('the forecast ladder walks forward across a month boundary');
/* THE BUG THIS PREVENTS: the last two taus are `311800Z` and `011800Z`.
 * Resolved independently against a 28 July clock, `011800Z` would land on
 * 1 JULY — a forecast point 27 days in the PAST, which sorts into the history
 * window and lifts the cage in the wrong hemisphere of the storm's life. */
const times = d.forecast.map((f) => Date.parse(f.at));
ok(times.every((t, i) => i === 0 || t > times[i - 1]),
  'every forecast hour is later than the one before it');
ok(d.forecast[7].at === new Date(Date.UTC(2026, 7, 1, 18, 0, 0)).toISOString(),
  '011800Z after 311800Z is 1 AUGUST, not 1 July');

section('a product that will not parse costs an intensity, never a storm');
ok(parseSubject(DOLPHIN)?.name === 'DOLPHIN', 'the subject line still parses');
const junk = parseWarningIntensity('NOTHING USEFUL HERE AT ALL', NOW);
ok(junk.fix === null && junk.forecast.length === 0,
  'unparseable text yields a null fix, not a throw and not a fake zero');
ok(parseWarningIntensity('', NOW).fix === null, 'empty input is handled');
ok(parseWarningIntensity(null, NOW).fix === null, 'null input is handled');

/* --- the join ------------------------------------------------------------- */

const ENTRY = {
  kind: 'TROPICAL STORM',
  designation: '12W',
  name: 'DOLPHIN',
  warningNumber: '004',
  product: 'wp1226',
  fix: d.fix,
  forecast: d.forecast,
};

/** A GDACS storm as data/gdacs.js actually emits one: no wind, no pressure,
 *  no motion, a three-word classification and a forecast peak. */
const gdacsStorm = (over = {}) => ({
  id: 'gdacs:1001297',
  source: 'gdacs',
  name: 'DOLPHIN-26',
  basin: 'northwest-pacific',
  lat: 13.2,
  lon: 173.7,
  windKt: null,
  peakWindKt: 145,
  pressureMb: null,
  headingDeg: null,
  speedKt: null,
  nature: 'tropical',
  category: null,
  categoryCode: 'HU',
  categorySource: 'reported',
  observedAt: '2026-07-27T18:00:00.000Z',
  advisoryKey: 'gdacs:1001297:6',
  ...over,
});

section('the join');
ok(matchJtwcEntry(gdacsStorm(), [ENTRY], NOW).entry === ENTRY,
  'a GDACS name finds its JTWC warning');

const applied = applyJtwcWind(gdacsStorm(), ENTRY);
ok(applied.windKt === 45, 'the storm gets a MEASURED current wind');
ok(applied.category === categoryFromKt(45), 'the category is derived from that wind');
ok(applied.categorySource === 'derived',
  'labelled derived — "reported" is for a source that states the number itself');
ok(applied.pressureMb === 997 && applied.speedKt === 15,
  'pressure and motion fill in where GDACS had nothing');
ok(applied.windSource === 'jtwc' && applied.windObservedAt === d.fix.at,
  'provenance travels with the number');

section('THE BUG: a GDACS hurricane no longer stands taller than a Cat 3');
/* The whole reason this exists. `representativeKt(null, 'tropical', 'HU')` is
 * the middle of the entire hurricane range, and it was every GDACS
 * hurricane's height regardless of actual strength. */
const midpoint = representativeKt(null, 'tropical', 'HU');
ok(midpoint > 100,
  `the old fallback really was ~${Math.round(midpoint)} kt for every GDACS hurricane`);
ok(applied.windKt < midpoint,
  'a 45 kt tropical storm now lifts the cage by 45 kt, not by the class midpoint');
ok(gdacsStorm().windKt === null,
  'and an UNMATCHED storm still falls back to that midpoint — degraded, not broken');

section('the storm object is never mutated');
const original = gdacsStorm();
applyJtwcWind(original, ENTRY);
ok(original.windKt === null,
  'applyJtwcWind returns a new object — the store keeps last-good lists');

section('guard 1: distance');
/* The frozen-GDACS case, live on Noul 2026-07-26. GDACS stops publishing, JTWC
 * keeps warning, the two positions walk apart — and a live wind must NOT be
 * pasted onto a two-day-old position. */
const drifted = matchJtwcEntry(gdacsStorm({ lat: 22.9, lon: 114.5 }), [ENTRY], NOW);
ok(drifted.entry === null && drifted.reason === 'too_far_apart',
  'a fix a basin away is refused even though the name matches');
ok(matchJtwcEntry(gdacsStorm({ lat: 14.0, lon: 174.5 }), [ENTRY], NOW).entry === ENTRY,
  'a normal cycle of separation is still accepted');

section('guard 2: age');
const stale = matchJtwcEntry(gdacsStorm(), [ENTRY], NOW + 20 * HOUR);
ok(stale.entry === null && stale.reason === 'fix_too_old',
  'a fix past two warning cycles is not "the wind now"');
/* NOW is already 7 h past the fix, so +4 h is an 11 h-old fix: one missed
 * warning cycle, still inside the two-cycle limit. */
ok(matchJtwcEntry(gdacsStorm(), [ENTRY], NOW + 4 * HOUR).entry === ENTRY,
  'one missed cycle is normal and still accepted');

section('guard 3: the index has to be believable');
ok(matchJtwcEntry(gdacsStorm(), [], NOW).reason === 'no_index',
  'an empty index matches nothing');
ok(matchJtwcEntry(gdacsStorm({ name: 'MAYSAK-26' }), [ENTRY], NOW).reason === 'none_matched',
  'an unmatched name returns null, not a best guess');
ok(matchJtwcEntry(gdacsStorm(), [{ ...ENTRY, fix: null }], NOW).reason === 'no_fix',
  'an entry whose intensity would not parse is skipped, not guessed at');
ok(
  matchJtwcEntry(gdacsStorm(), [{ ...ENTRY, fix: { ...d.fix, windKt: null } }], NOW)
    .reason === 'no_fix',
  'a fix with a position but no wind is no use here'
);

section('a failed index is not an empty index');
/* data/jtwc-index.js's first rule, enforced at the consumer. */
const down = joinJtwcWinds([gdacsStorm()], { state: 'unavailable', storms: [] }, NOW);
ok(down.storms[0].windKt === null && down.matched === 0,
  'state=unavailable leaves every storm exactly as it was');
const partial = joinJtwcWinds([gdacsStorm()], { state: 'partial', storms: [ENTRY] }, NOW);
ok(partial.storms[0].windKt === 45,
  'state=partial is still used — a short index can cost a match, never fake one');

section('NHC storms are left alone');
/* NHC publishes its own measured wind. JTWC warns on East Pacific systems too
 * (FAUSTO and GENEVIEVE were both in its live index on 2026-07-28), so this is
 * a real condition, not a hypothetical: two agencies' numbers for one storm are
 * two answers free to disagree in front of a user. */
const nhc = { source: 'nhc', name: 'DOLPHIN', lat: 13.2, lon: 173.7, windKt: 90 };
const mixed = joinJtwcWinds([nhc, gdacsStorm()], { state: 'ok', storms: [ENTRY] }, NOW);
ok(mixed.storms[0].windKt === 90, 'the NHC storm keeps its own wind');
ok(mixed.considered === 1, 'and was never even considered for the join');

section('per-point winds for the cage');
const fixMs = Date.parse(d.fix.at);
ok(jtwcWindKtAt(applied, fixMs) === 45, 'the analysis hour returns the fix wind');
ok(jtwcWindKtAt(applied, Date.parse(d.forecast[4].at)) === 145,
  'a forecast hour returns the wind published for that hour');
ok(jtwcWindKtAt(applied, fixMs + 6 * HOUR) === null,
  'an hour BETWEEN taus returns null — never interpolated into a number nobody published');
/* A JTWC warning carries no history. Letting the tolerance stretch the tau-0
 * fix backwards would paint a storm's whole past at its present strength. */
ok(jtwcWindKtAt(applied, fixMs - 24 * HOUR) === null,
  'a PAST hour returns null — the warning has no history in it');
ok(jtwcWindKtAt(gdacsStorm(), fixMs) === null,
  'a storm with no JTWC data returns null rather than throwing');

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (fixtures are real bytes — they still cannot tell you the cage reads right on a phone)');
