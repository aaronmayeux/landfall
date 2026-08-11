#!/usr/bin/env node
/**
 * test-storm-row.mjs — the storm list row says the SAME THINGS about every
 * storm on earth, and ranks them on a number that means one thing.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-storm-row.mjs`.
 *
 * ==> THE FIXTURES ARE THE LIVE FEED, NOT AN INVENTION. <== Every storm below
 * was read off the archive branch's GDACS payload on 2026-08-10, when NHC was
 * empty (`CurrentStorms.json` was 24 bytes) and four GDACS storms were up with
 * JTWC warning on exactly three of them. That fourth storm — DOLPHIN, the
 * strongest thing on the globe, silent for 35 hours, no JTWC warning behind it
 * — is the whole reason this file exists, and no synthetic fixture would have
 * produced it: it is not a malformed record or a failed fetch, it is a
 * perfectly healthy storm that two agencies happen to disagree about how much
 * to say.
 *
 * TWO RULES ARE PINNED HERE.
 *
 *   1. THE RANKING KEY IS ONE QUANTITY. `peakWindKt` is GDACS's maximum
 *      expected over a storm's whole LIFE, so ranking on it compared an
 *      unmatched storm's future against every other storm's present.
 *   2. NOTHING NON-UNIVERSAL COMES BACK ONTO THE ROW. Wind, gusts, pressure
 *      and dead-reckoned motion are absent for any storm JTWC has not matched,
 *      and JTWC picks storms up and drops them, so "which agency" is not a
 *      thing a column can be designed around.
 *
 * WHAT THIS CANNOT PROVE: that the two columns actually line up, that three
 * lines is not too tall on a phone, or that the arrow reads as a direction.
 * Those are glass. `tools/row-preview.mjs` renders the text for a read-through.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { sortStorms } = await import('../data/merge.js');
const { isSilent } = await import('../lib/silence.js');

/* ---------------------------------------------------------------------------
 * FIXTURES — 2026-08-10, verbatim from origin/archive:latest/gdacs-events.json
 * plus the JTWC RSS from the same run.
 * ------------------------------------------------------------------------- */

const KMH_PER_KT = 1.852;

/** DOLPHIN-26. `severity` 268.5168 km/h. No JTWC warning in the RSS that hour,
 *  so `windKt` is null and the classification is GDACS's ceiling word. */
const dolphin = Object.freeze({
  id: 'gdacs:1001297',
  name: 'DOLPHIN-26',
  source: 'gdacs',
  basin: 'westPacific',
  lon: 120.6, lat: 27.9,
  windKt: null,
  peakWindKt: 268.5168 / KMH_PER_KT, // ~145 kt
  nature: 'tropical',
  category: null,
  categoryCode: 'HU', // "Hurricane/Typhoon > 74 mph"
  observedAt: '2026-08-09T12:00:00Z',
});

/** A measured Cat 4 in the same basin. Not from this snapshot — NHC was empty
 *  — but 130 kt is an ordinary major hurricane and the point of the assertion
 *  is the COMPARISON, which needs one of each kind. */
const cat4 = Object.freeze({
  id: 'nhc:wp992026',
  name: 'Measured',
  source: 'nhc',
  basin: 'westPacific',
  lon: 130.0, lat: 20.0,
  windKt: 130,
  nature: 'tropical',
  category: 5, // index: 0=TD, 1=TS, 2..6 = Cat 1..5
  categoryCode: 'HU',
  observedAt: '2026-08-10T18:00:00Z',
});

/** CHAN-HOM-26, JTWC-matched (14W, Warning #16), so it carries a real wind. */
const chanhom = Object.freeze({
  id: 'gdacs:1001299',
  name: 'CHAN-HOM-26',
  source: 'gdacs',
  basin: 'westPacific',
  lon: 145.9, lat: 36.8,
  windKt: 45,
  peakWindKt: 83.3328 / KMH_PER_KT,
  nature: 'tropical',
  category: 1,
  categoryCode: 'TS',
  observedAt: '2026-08-10T18:00:00Z',
});

/* ---------------------------------------------------------------------------
 * 1. THE RANKING KEY
 *
 * ==> THE FIRST CUT OF THIS SECTION PASSED AGAINST THE BUG, AND THE MUTATION
 * RUN IS THE ONLY REASON THAT IS NOT STILL TRUE. <== DOLPHIN's real timestamp
 * is 35 hours old, `SILENCE.after` is 24, and silence sinks a storm BEFORE
 * `sortStorms` ever consults intensity. So every assertion below passed with
 * the old `windKt ?? peakWindKt` still in place — the right answer, arrived at
 * by a rule that had nothing to do with the thing being tested.
 *
 * The ranking fixtures therefore carry a FRESH stamp. Everything else about
 * them is DOLPHIN's real record: its 268.5 km/h severity, its null wind, its
 * bare "HU" class. The silence that was masking this is asserted separately
 * just below, so the substitution cannot quietly become a fiction.
 * ------------------------------------------------------------------------- */

section('Ranking — one quantity, and a measured wind always wins');

const NOW = Date.parse('2026-08-10T18:00:00Z');

{
  ok(
    isSilent(dolphin, NOW),
    "DOLPHIN's real 2026-08-09T12:00Z fix IS silent at this clock — which is " +
      'exactly why the ranking fixtures below cannot use it unchanged'
  );
  ok(
    !isSilent({ ...dolphin, observedAt: '2026-08-10T18:00:00Z' }, NOW),
    'and the freshened copy is not silent, so intensity is genuinely reached'
  );
}

/** DOLPHIN's record with a fresh stamp, so the comparator gets past silence. */
const dolphinFresh = { ...dolphin, observedAt: '2026-08-10T18:00:00Z' };

{
  const order = sortStorms([dolphinFresh, cat4], NOW);

  /* THE ASSERTION THIS FILE WAS WRITTEN FOR. Before the fix, `windKt ??
   * peakWindKt` gave DOLPHIN 145 against the Cat 4's 130 and put a storm with
   * no measurement behind it at the top of the basin. */
  ok(
    order[0].id === cat4.id,
    `a measured 130 kt Cat 4 must outrank DOLPHIN's 145 kt FORECAST PEAK — got ${order[0].name} first`
  );

  /* ==> AND IT MUST NOT OVERCORRECT. <== The cheap "fix" is to rank an
   * unmatched storm at -1 and bury it. GDACS said HURRICANE, and burying a
   * hurricane under a tropical storm because our preferred agency happens to
   * be quiet is the §5 failure pointing the other way. */
  const vsTs = sortStorms([chanhom, dolphinFresh], NOW);
  ok(
    vsTs[0].id === dolphinFresh.id,
    'an unmatched HURRICANE must still outrank a measured 45 kt tropical storm — ' +
      `got ${vsTs[0].name} first`
  );
}

{
  /* THE STAND-IN IS REACHED ONLY WHEN THERE IS NO MEASUREMENT.
   *
   * ==> THIS FIXTURE HAD TO BE REBUILT BEFORE IT COULD FAIL. <== The first
   * version compared two storms in DIFFERENT classes, so swapping the
   * precedence changed nothing — the midpoint and the measured wind pointed
   * the same way and the assertion passed either way. These two are in the
   * SAME class, where the midpoint is by definition identical for both, so
   * only a real wind can separate them. Named so that the tie-break on name
   * gives the WRONG order: if the measurement stops winning, Alpha surfaces.
   *
   * Both are ordinary tropical storms. 35 kt is just above the TS floor and
   * 60 kt just below the hurricane one; the class midpoint is 49 for each. */
  const alpha = {
    id: 'nhc:al012026', name: 'Alpha', source: 'nhc', basin: 'atlantic',
    lon: -40, lat: 20, windKt: 35, nature: 'tropical',
    category: 1, categoryCode: 'TS', observedAt: '2026-08-10T18:00:00Z',
  };
  const bravo = { ...alpha, id: 'nhc:al022026', name: 'Bravo', windKt: 60 };

  const order = sortStorms([alpha, bravo], NOW);
  ok(
    order[0].id === bravo.id,
    'a measured 60 kt must outrank a measured 35 kt in the same class — the ' +
      `stand-in is a fallback, never a replacement. Got ${order[0].name} first`
  );
}

{
  /* A storm with nothing at all sorts last rather than throwing or landing
   * mid-list on a NaN. `representativeKt` returns null for an unknown class
   * and the comparator has to survive it. */
  const blank = {
    id: 'gdacs:0', name: 'Blank', source: 'gdacs', basin: 'westPacific',
    lon: 150, lat: 10, windKt: null, nature: 'tropical',
    category: null, categoryCode: null, observedAt: '2026-08-10T18:00:00Z',
  };
  const order = sortStorms([blank, chanhom], NOW);
  ok(order[0].id === chanhom.id, 'a storm with no class at all sorts below one with a class');
  ok(order.length === 2, 'nothing is dropped by the comparator');
}

/* ---------------------------------------------------------------------------
 * 2. THE ROW STAYS UNIVERSAL
 *
 * Source-text assertions, in the style of test-overall-status.mjs. The row is
 * assembled into innerHTML inside a closure with no DOM here, so what CAN be
 * checked is that the non-universal formatters are not reachable from it —
 * which is the rule, stated as the import list.
 * ------------------------------------------------------------------------- */

section('The row is built only from facts every storm carries');

{
  const src = fs.readFileSync('ui/view-storms.js', 'utf8');

  /* ==> CHECKED AGAINST CODE, NOT PROSE. <== The first cut of this suite read
   * the raw file and went red on its own explanation — the comment saying
   * `peakWindKt` is the wrong quantity tripped the check forbidding
   * `peakWindKt`. A rule about what executes has to be asked of what executes,
   * or the file cannot document the very thing it is enforcing. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');

  ok(
    !/\bformatWind\b/.test(code),
    'ui/view-storms.js must not use formatWind — wind is absent for any storm ' +
      'JTWC has not matched, and printing the forecast peak instead put two ' +
      'different quantities in one column'
  );
  ok(
    !/\bpeakWindKt\b/.test(code),
    'ui/view-storms.js must not read peakWindKt — it is a whole-life maximum and ' +
      'nothing on a glance surface may compare it against a present-tense number'
  );
  ok(
    !/\bmotionTrend\b/.test(code),
    'the row must not use motionTrend — it needs headingDeg and speedKt, which ' +
      'GDACS never publishes, so it was blank on every unmatched storm'
  );
  ok(
    /approachTo/.test(code),
    'the row must use approachTo — the track minimum is the trend BOTH sources answer'
  );

  /* The accessible name has to carry what the badge column and the arrow
   * carry, or this surface says less to a screen reader than it shows. */
  const at = code.indexOf('function rowLabel');
  ok(at !== -1, 'rowLabel still exists');
  const label = code.slice(at, at + 900);
  ok(/categoryShortLabel/.test(label), 'rowLabel must speak the category badge');
  ok(/whereText/.test(label), 'rowLabel must speak the distance column');
  ok(/trackFacts/.test(label), 'rowLabel must speak the trajectory the arrow stands for');
}

{
  const css = fs.readFileSync('ui/panels.css', 'utf8');

  /* ==> THE BADGE MUST NOT BE TINTED. <== The swatch beside it already carries
   * the hue, and Cat 1's #FFE14D at 0.68rem cannot meet AA on the light
   * theme's background at any weight. */
  const badge = css.slice(css.indexOf('.row-badge {'), css.indexOf('.row-badge {') + 400);
  ok(
    /color:\s*var\(--text-primary\)/.test(badge),
    '.row-badge must use a neutral token, never a category colour'
  );

  for (const dead of ['.row-sep', '.row-stale ', '.row-silent ', '.row-ended ']) {
    ok(
      !css.includes(dead + '{') && !css.includes(dead + ' {'),
      `${dead.trim()} is retired and its rule must be deleted, not left behind`
    );
  }

  ok(
    /\.row-stamp\[data-tone='silent'\]/.test(css) &&
      /\.row-stamp\[data-tone='ended'\]/.test(css) &&
      /\.row-stamp\[data-tone='stale'\]/.test(css),
    'the freshness slot keeps all three tones — they are three different facts'
  );
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed\n`);
