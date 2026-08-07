#!/usr/bin/env node
/**
 * test-volcano-severity.mjs — the three catalog channels, their normalisation,
 * and the two-kinds-of-missing rule (`lib/volcano-severity.js`,
 * `VOLCANO.severity` in `config/volcano.js`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-volcano-severity.mjs`, same as
 * every other suite here (§12 — this project has no toolchain by design).
 *
 * ==> THE LOAD-BEARING HALF OF THIS FILE IS THE DRIFT CHECK. <== Four of the
 * numbers in `VOLCANO.severity` are not opinions, they are MEASUREMENTS of
 * `assets/hazards/volcanoes-holocene.geojson` — two maxima and three medians.
 * The moment the catalog is re-fetched they can go stale, and a stale maximum
 * fails SILENTLY: the score keeps coming out between 0 and 1 and simply ranks
 * the world slightly wrong forever. So this suite recomputes all of them from
 * the shipped file and fails on any disagreement. Same arrangement, and the
 * same reason, as the `VOLCANO` mirror assertion in `test-vaa.mjs`.
 *
 * ==> THE OTHER HALF IS THE FOUR ABSENCE PATHS, AND THEY ARE THE WHOLE POINT
 * OF PHASE D. <== A missing channel scored as zero is an opinion; a
 * never-erupted volcano scored at a midpoint is a DIFFERENT opinion. One
 * blanket rule serves 197 values and misstates 364. The four cases:
 *
 *   no eruption record  → ec 0, vei 0            (364 volcanoes, the FLOOR)
 *   erupted, no VEI     → vei at the median      (162 volcanoes, UNKNOWN)
 *   no exposure figure  → pop30 at the median    ( 35 volcanoes, UNKNOWN)
 *   exposure of zero    → pop30 0, NOT a midpoint (214 volcanoes, MEASURED)
 *
 * The last one is the one that would pass a careless suite: a renderer that
 * treats a measured zero as unknown reports "we don't know" about 214
 * volcanoes it knows exactly the right answer for, and one that treats an
 * unknown as zero reports "nobody lives here" about 35 it knows nothing about.
 * Both directions are asserted.
 *
 * WHAT THIS CANNOT PROVE: that the ranking it produces LOOKS right on a globe.
 * That is a phone question and it belongs to Phase E. What it can prove is
 * that the rule in the spec is the rule in the code, and that both still match
 * the data on disk.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const { VOLCANO } = await import('../config/volcano.js');
const { normaliseChannel, channelMidpoint, severityChannels, severityScore } = await import(
  '../lib/volcano-severity.js'
);

const CH = VOLCANO.severity.channels;

const features = JSON.parse(
  readFileSync('assets/hazards/volcanoes-holocene.geojson', 'utf8')
).features;
const props = features.map((f) => f.properties);

const present = (k) => props.filter((p) => p[k] != null).map((p) => p[k]);
const median = (a) => {
  const v = a.slice().sort((x, y) => x - y);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/* --- the catalog is the shape Phase D was measured against ---------------- */
section('the shipped catalog still has the shape the rule assumes');

ok(features.length === 1196, `catalog holds 1,196 features (holds ${features.length})`);
ok(present('ec').length === 832, `ec present on 832 (present on ${present('ec').length})`);
ok(present('vei').length === 670, `vei present on 670 (present on ${present('vei').length})`);
ok(present('pop30').length === 1161, `pop30 present on 1,161 (present on ${present('pop30').length})`);

/* ==> THE FACT THE ENTIRE FLOOR RULE RESTS ON. <== "ec absent means a recorded
 * zero" is only true because GVP has nothing else on these volcanoes either.
 * If a future catalog ships a volcano with a VEI but no eruption count, the
 * floor rule is substituting 0 for something that was measured — so this
 * assertion is the rule's foundation and not a statistic. */
const noEc = props.filter((p) => p.ec == null);
ok(noEc.length === 364, `364 volcanoes carry no eruption record (found ${noEc.length})`);
ok(
  noEc.every((p) => p.vei == null),
  '==> and NONE of them carries a vei — which is what makes absent-ec a recorded zero'
);
ok(
  noEc.every((p) => p.last == null),
  '==> and NONE of them carries a last — same reason'
);

const eruptedNoVei = props.filter((p) => p.ec != null && p.vei == null);
ok(eruptedNoVei.length === 162, `162 erupted with no VEI recorded (found ${eruptedNoVei.length})`);
const noPop = props.filter((p) => p.pop30 == null);
ok(noPop.length === 35, `35 carry no exposure figure (found ${noPop.length})`);
const zeroPop = props.filter((p) => p.pop30 === 0);
ok(zeroPop.length === 214, `214 carry a MEASURED exposure of zero (found ${zeroPop.length})`);

/* --- drift: every measured constant, recomputed --------------------------- */
section('the constants are still what the catalog measures');

const ecMax = Math.max(...present('ec'));
const veiMax = Math.max(...present('vei'));
const popMax = Math.max(...present('pop30'));
ok(CH.ec.max === ecMax, `ec.max ${CH.ec.max} agrees with the catalog (${ecMax})`);
ok(CH.vei.max === veiMax, `vei.max ${CH.vei.max} agrees with the catalog (${veiMax})`);
ok(CH.pop30.max === popMax, `pop30.max ${CH.pop30.max} agrees with the catalog (${popMax})`);

const ecMed = median(present('ec'));
const veiMed = median(present('vei'));
const popMed = median(present('pop30'));
ok(CH.ec.median === ecMed, `ec.median ${CH.ec.median} agrees with the catalog (${ecMed})`);
ok(CH.vei.median === veiMed, `vei.median ${CH.vei.median} agrees with the catalog (${veiMed})`);
ok(CH.pop30.median === popMed, `pop30.median ${CH.pop30.median} agrees with the catalog (${popMed})`);

/* The vei midpoint is described as "the same median either way" because every
 * volcano with a vei also has an ec. If that ever stops being true the prose
 * in constants.js is wrong even though the number might still be right. */
const veiMedAmongErupted = median(props.filter((p) => p.ec != null && p.vei != null).map((p) => p.vei));
ok(
  veiMedAmongErupted === veiMed,
  'the vei median is the same measured over all volcanoes and over erupted-only'
);

/* --- the transforms ------------------------------------------------------- */
section('the transform is per channel, and vei is linear');

ok(CH.ec.transform === 'log1p', 'ec is log1p — 1 to 198 with a median of 4');
ok(CH.pop30.transform === 'log1p', 'pop30 is log1p — 0 to 6.7M with a median of 5,725');
ok(
  CH.vei.transform === 'linear',
  '==> vei is LINEAR. VEI is already a log scale; logging it twice halves a real 10x'
);

ok(near(normaliseChannel('ec', 0), 0), 'ec 0 normalises to the floor');
ok(near(normaliseChannel('ec', CH.ec.max), 1), 'ec at maximum normalises to 1');
ok(near(normaliseChannel('vei', 0), 0), 'a measured VEI of 0 normalises to the floor');
ok(near(normaliseChannel('vei', 7), 1), 'VEI 7 normalises to 1');
ok(near(normaliseChannel('pop30', 0), 0), 'a measured exposure of zero normalises to the floor');
ok(near(normaliseChannel('pop30', CH.pop30.max), 1), 'the largest exposure normalises to 1');

/* Linear would put VEI 4 at 4/7 = 0.571 and log1p would put it at 0.805. The
 * point of asserting the number rather than the flag is that someone "fixing"
 * the transform for consistency fails HERE, with the reason in the message. */
ok(
  near(normaliseChannel('vei', 4), 4 / 7),
  '==> VEI 4 sits at 4/7 = 0.571, not at log1p(4)/log1p(7) = 0.805'
);

/* Saturation rather than overflow, in case a re-fetched catalog outruns a
 * maximum before anyone re-runs this suite. */
ok(normaliseChannel('ec', CH.ec.max * 10) === 1, 'a value past the maximum saturates at 1');
ok(normaliseChannel('pop30', -5) === 0, 'a negative value clamps to the floor');

/* --- the four absence paths ----------------------------------------------- */
section('the two kinds of missing, and the measured zero that is neither');

const neverErupted = severityChannels({ pop30: 1000 });
ok(neverErupted.ec === 0, 'no eruption record => ec at the FLOOR, not a midpoint');
ok(neverErupted.vei === 0, 'no eruption record => vei at the FLOOR, not a midpoint');
ok(
  neverErupted.known.ec === false && neverErupted.known.vei === false,
  'and both are reported as not measured, so a surface can say so'
);

const unsized = severityChannels({ ec: 5, pop30: 1000 });
ok(
  near(unsized.vei, channelMidpoint('vei')),
  'erupted with no VEI => vei at the channel MIDPOINT, not the floor'
);
ok(near(channelMidpoint('vei'), 3 / 7), 'and that midpoint is the median 3/7 = 0.429, not 0.5');
ok(unsized.known.vei === false, 'and it is reported as not measured');

const noExposure = severityChannels({ ec: 5, vei: 3 });
ok(
  near(noExposure.pop30, channelMidpoint('pop30')),
  'no exposure figure => pop30 at the channel MIDPOINT'
);
ok(noExposure.known.pop30 === false, 'and it is reported as not measured');

const measuredZero = severityChannels({ ec: 5, vei: 3, pop30: 0 });
ok(
  measuredZero.pop30 === 0,
  '==> a MEASURED exposure of zero stays at the floor and never becomes the midpoint'
);
ok(
  measuredZero.known.pop30 === true,
  '==> and it is reported as MEASURED — Great Sitkin knows its answer is nobody'
);
ok(
  measuredZero.pop30 !== noExposure.pop30,
  '==> so absent and zero produce different scores, which is SPEC.md §5 in one line'
);

/* --- the composite -------------------------------------------------------- */
section('the composite stays on the scale and ranks the world plausibly');

const w = VOLCANO.severity.weights;
ok(near(w.ec + w.vei + w.pop30, 1), 'the three weights sum to 1');
ok(w.ec === w.vei && w.vei === w.pop30, 'and they are equal thirds');

const scored = features
  .map((f) => ({ name: f.properties.name, s: severityScore(f.properties) }))
  .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));

ok(
  scored.every((r) => r.s >= 0 && r.s <= 1),
  'every volcano in the catalog scores inside 0–1'
);
/* ==> AN EMPTY PROPERTY BAG IS NOT A ZERO SCORE, AND THAT IS DELIBERATE. <==
 * Nothing known means floor on both history channels (no eruption record) but
 * the MIDPOINT on exposure, because an absent exposure figure is an unknown
 * rather than an empty valley. A suite that asserted 0 here would be enforcing
 * exactly the collapse §42.1.8 forbids. */
ok(severityScore({}) > 0, 'a volcano with nothing known does NOT score zero');
ok(
  near(severityScore({}), channelMidpoint('pop30') / 3),
  'an empty property bag scores only its exposure midpoint — floor on both history channels'
);

const rank = (n) => scored.findIndex((r) => r.name === n) + 1;
ok(rank('Etna') === 1, `Etna ranks 1 (ranks ${rank('Etna')})`);
ok(rank('Vesuvius') <= 15, `Vesuvius ranks inside the top 15 (ranks ${rank('Vesuvius')})`);
ok(rank('Merapi') <= 15, `Merapi ranks inside the top 15 (ranks ${rank('Merapi')})`);

/* ==> THE ARGUMENT FOR THE EXPOSURE CHANNEL, ASSERTED. <== Merapi and Great
 * Sitkin are BOTH erupting and mean completely different things. If these two
 * ever converge the channel has stopped doing its job. */
const merapi = severityScore(props.find((p) => p.name === 'Merapi'));
const greatSitkin = severityScore(props.find((p) => p.name === 'Great Sitkin'));
ok(
  merapi - greatSitkin > 0.4,
  `Merapi outscores Great Sitkin by more than 0.4 (${(merapi - greatSitkin).toFixed(3)})`
);
ok(
  greatSitkin > 0,
  '==> and Great Sitkin still scores above zero — a low score is never an absence'
);

/* --- the anti-filter rule -------------------------------------------------- */
section('the score ranks the quiet and cannot be read as a live filter');

/* §42.1.1: 6 of the 22 volcanoes erupting on 2026-07-30 sit outside the
 * 128-volcano activity tier. A severity threshold is the shape someone reaches
 * for in Phase E, so measure what one would actually cost. */
const eruptingOn20260730 = [
  'Ambae', 'Dukono', 'Great Sitkin', 'Ibu', 'Lewotolok', 'Sabancaya',
  'Merapi', 'Semeru', 'Kilauea', 'Sheveluch', 'Etna', 'Ahyi',
];
const hidden = eruptingOn20260730.filter((n) => {
  const p = props.find((q) => q.name === n);
  return p && severityScore(p) < 0.5;
});
ok(
  hidden.length > 0,
  `==> a 0.5 severity cut would hide ${hidden.length} volcanoes erupting today (${hidden.join(', ')}) — ` +
    'this is why §42.1.1 says the erupting set is a union, never a filter'
);

/* --- done ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
