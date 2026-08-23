#!/usr/bin/env node
/**
 * test-flooding.mjs — the Flooding section, on both screens. SPEC §56.7,
 * §56.8.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-flooding.mjs`.
 *
 * ===========================================================================
 * WHAT THIS SUITE IS ACTUALLY GUARDING
 * ===========================================================================
 *
 * §56.7 merged two sections into one, and the whole cost of the merge is a §5
 * problem it created: **one section now carries two coverage gaps, and each
 * one reads as an all-clear if it is silent.**
 *
 *   NWS flood alerts   the United States, and nowhere else. No global
 *                      equivalent exists.
 *   the GDACS model    everywhere EXCEPT NHC's basins, which it declines by
 *                      design (§51.5).
 *
 * So a US storm shows rows and no modelled figure, and a Japan typhoon shows a
 * modelled figure and no rows. **Neither absence is a forecast**, and a reader
 * who meets an empty half with nothing beside it will read safety into it.
 *
 * ==> EVERY ONE OF THOSE FAILURES IS A BLANK SPACE, WHICH IS THE HARDEST THING
 * IN THIS APP TO NOTICE. <== Nothing throws. Nothing parses wrong. The section
 * renders, correctly headed, missing the sentence that was the whole point. So
 * these assert the RENDERED STRING and they assert absences as hard as they
 * assert presences.
 *
 * ===========================================================================
 * THE FIXTURES ARE REAL BYTES
 * ===========================================================================
 *
 *   samples/flood/alerts-national.json     every US flood alert in force in
 *                                          one real hour (§56.2).
 *   samples/surge-locations/getlocations-* three real GDACS runs — Lala's 47
 *                                          towns, Saudel's 2, Hernán's none.
 *   samples/cap/capalerts-2026-08-19.json  five real CAP rows, two of them
 *                                          Environment Canada storm-surge
 *                                          warnings for the Yukon.
 *
 * The controllers are string building with no DOM, so this runs on plain node.
 */

import path from 'node:path';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const { createFloodingStorm } = await import('../ui/flooding-storm.js');
const { createFloodingHome } = await import('../ui/flooding-home.js');
const {
  NWS_US_ONLY, MODEL_NOT_THIS_BASIN, GDACS_PROVENANCE, NWS_NOT_ATTRIBUTED,
  FLOOD_POINTER,
} = await import('../ui/flood-words.js');
const { surgeOnStorm, surgeAtHome } = await import('../lib/surge-locations.js');
const { corridorSummary, trackChains, trackSamples } = await import('../lib/flood.js');
const { projectLocations } = await import('../functions/api/gdacs/surge.js');
const { readAlerts, partitionSurge, alertsForStorm } = await import('../lib/cap.js');
const { _normalizeGdacsEvent } = await import('../data/gdacs.js');
const { createCapStorm } = await import('../ui/cap-storm.js');
const { ICON_PATH } = await import('../ui/section-icon.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
/** Whitespace-normalised. Every sentence in these controllers is wrapped
 *  across source lines, so a raw-string match would break the next time
 *  somebody rewraps a paragraph rather than when the rule changed. */
const flat = (h) => String(h).replace(/\s+/g, ' ');
/** A sentence from `ui/flood-words.js`, matched the way it renders. The
 *  controllers escape it, so the apostrophes are ASCII in both. */
const says = (html, words) => flat(html).includes(flat(words));

/* ---------------------------------------------------------------------------
 * FIXTURES
 * ------------------------------------------------------------------------- */

const NATIONAL = load('samples/flood/alerts-national.json').alerts;
/** A moment they were all live, taken off the capture rather than typed. */
const LIVE = Date.parse(NATIONAL[0].onset);

/** Lala's real published track — fourteen past LineStrings plus a forecast. */
const LALA_SAMPLES = trackSamples(trackChains(
  load('samples/flood/track-lala-cp2-past.geojson'),
  load('samples/flood/track-lala-cp2-forecast.geojson')));

/** ==> A TRACK OVER THE ONE PLACE THIS SNAPSHOT HAS ALERTS. <== The national
 *  set is a quiet day whose alerts sit along the Wabash valley in Indiana and
 *  Illinois (§56.2), and Lala is a Central Pacific storm 2,000 nm from any of
 *  them. A probe over the cluster is what puts the `ok` branch on screen. */
const overIndiana = trackSamples(trackChains({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-87.6, 38.0], [-87.6, 40.0]] } }],
}));

const relayed = (name) =>
  projectLocations(load(`samples/surge-locations/${name}.json`));
const LALA_SURGE = relayed('getlocations-lala-1001303');
const SAUDEL_SURGE = relayed('getlocations-saudel-1001305');
const HERNAN_SURGE = relayed('getlocations-hernan-1001304');

const CAP_FEED = load('samples/cap/capalerts-2026-08-19.json');
const CAP_GDACS = load('samples/cap/gdacs-storms-2026-08-19.json');
const CAP_NOW = Date.parse('2026-08-19T01:00:00Z');
const CAP_ALERTS = readAlerts(CAP_FEED, CAP_NOW);

/** ==> A STORM AFFECTING CANADA, BUILT BY THE REAL NORMALIZER WITH ONE FIELD
 *  SWAPPED. <== The archived surge rows are Environment Canada's, and no
 *  archived storm is attributed to Canada — which is exactly the country join
 *  doing its job (`tools/test-cap.mjs` asserts that separately). To see a
 *  surge row REACH a section at all, one storm has to be attributed there. The
 *  swap is on `affectedcountries` and nothing else, so every other field is
 *  still GDACS's own bytes through `data/gdacs.js`. Hand-building the object
 *  is what made `test-cap.mjs` green over a feature that had never run. */
const canadaStorm = (() => {
  const f = CAP_GDACS.features.find((x) => x.properties.eventname === 'HERNAN-26');
  const clone = JSON.parse(JSON.stringify(f));
  clone.properties.iscurrent = 'true';
  clone.properties.affectedcountries = [{ iso2: 'CA', countryname: 'Canada' }];
  return _normalizeGdacsEvent(clone);
})();

/** A storm object the GDACS surge facade will answer for. `gdacsEventIdOf`
 *  reads `source` and `sourceId`, which is what `data/gdacs.js` sets. */
const gdacsStorm = { id: 'g1', source: 'gdacs', sourceId: '1001303' };
const nhcStorm = { id: 'n1', source: 'nhc', sourceId: 'cp012026' };

/* ---------------------------------------------------------------------------
 * RENDER HELPERS
 * ------------------------------------------------------------------------- */

/** The storm drawer's Flooding section. Every dep defaults to "wired but with
 *  nothing to say", so a case naming one dep is a case about that dep. */
async function renderStorm({
  storm = gdacsStorm, summary = null, surgePayload = null, surgeStatus = 'ok',
  cap = null,
} = {}) {
  const c = createFloodingStorm({
    flood: { summaryFor: () => summary, retry: async () => {} },
    cap: cap ? { waterFor: () => cap, retry: async () => {} } : null,
    surge: {
      loadSurge: async () => (surgeStatus === 'ok'
        ? { status: 'ok', payload: surgePayload }
        : { status: surgeStatus }),
      retrySurge: async () => ({ status: 'unavailable' }),
    },
    units: () => 'imperial',
  });
  await c.ensure(storm, () => {});
  return c.html(storm);
}

/** The home dashboard's Flooding section. */
async function renderHome({
  storm = null, rainPayload = null, rainStatus = 'ok',
  surgePayload = null, home = { lat: 19.72, lon: -155.08 },
} = {}) {
  const c = createFloodingHome({
    rain: {
      loadRainfall: async () => (rainStatus === 'ok'
        ? { status: 'ok', payload: rainPayload }
        : { status: rainStatus }),
      retryRainfall: async () => ({}),
    },
    surge: {
      loadSurge: async () => ({ status: 'ok', payload: surgePayload }),
      retrySurge: async () => ({}),
    },
    units: () => 'imperial',
    now: () => LIVE,
  });
  await c.ensure(storm, home, () => {});
  return c.inner(storm, home, '<HEAD>');
}

/* =========================================================================
 * 1. THE STORM-LEVEL FIGURE — §56.9 KEEPS THE HOUSE OUT OF THE STORM DRAWER
 * ====================================================================== */
section('§56.9 — the modelled figure with no house in it');

{
  const out = surgeOnStorm(LALA_SURGE, { system: 'imperial' });
  ok(out.state === 'ok', `Lala should produce a storm-level figure, got ${out.state}`);
  ok(out.worst?.city === 'Hookena', `Lala's deepest is Hookena, got ${out.worst?.city}`);

  /* ==> THE DEEPEST, NOT MERELY THE FIRST. <== The relay sorts deepest-first
   * and this reads `places[0]`, which is free and correct — and would go on
   * being free and quietly wrong the day anything downstream re-sorted. This
   * is the assertion that would notice. */
  const trueMax = Math.max(...LALA_SURGE.places.map((p) => p.heightM));
  ok(out.worst?.heightM === trueMax,
    `worst must be the maximum height (${trueMax}), got ${out.worst?.heightM}`);

  /* THE ONE ALL-CLEAR THIS HALF IS ALLOWED. Hernán, mid-Pacific: the model ran
   * across the whole storm and found no populated place in reach of any
   * water. A fact about where the storm is. */
  ok(surgeOnStorm(HERNAN_SURGE).state === 'none_matched',
    'a storm with no modelled town at all is none_matched');

  /* ==> AND IT IS NOT `surgeAtHome` WITH A NULL HOUSE. <== That function's
   * `out_of_range` means "the model ran and nothing is near YOU", a fact about
   * an address. Reached with no address it is meaningless, and a storm panel
   * has no business rendering a sentence about the reader's house (§56.9). The
   * two functions must not be able to answer as each other. */
  ok(surgeAtHome(LALA_SURGE, null).state === 'out_of_range',
    'surgeAtHome with no house reaches the address-shaped state, which is the '
    + 'shape a storm panel must never render');
  ok(!('here' in out) && out.state !== 'out_of_range',
    'surgeOnStorm has no address-shaped state at all');
}

/* =========================================================================
 * 2. THE TWO COVERAGE GAPS — THE §5 COST OF THE MERGE
 * ====================================================================== */
section('§56.7 — the two coverage gaps');

{
  /* A US storm: rows, and NO modelled figure. That must not read as "no
   * coastal flooding expected" — it means this model does not cover this
   * basin (§51.5). */
  const usStorm = await renderStorm({
    storm: nhcStorm,
    summary: corridorSummary(NATIONAL, overIndiana, LIVE, 300),
  });
  ok(says(usStorm, MODEL_NOT_THIS_BASIN),
    'an NHC storm says why there is no modelled figure');
  ok(!flat(usStorm).includes('No coastal flooding is modelled for this storm'),
    'and it never states the all-clear it has not earned');
  ok(usStorm.includes('flood alert'), 'while still showing the rows it does have');

  /* The other half: nothing matched the corridor. "No flood alerts within
   * 345 mi" is only an answer for a place NWS forecasts at all. */
  const nothingNear = await renderStorm({
    storm: gdacsStorm,
    summary: corridorSummary(NATIONAL, LALA_SAMPLES, LIVE, 300),
    surgePayload: LALA_SURGE,
  });
  ok(flat(nothingNear).includes('No flood alerts are in force within'),
    'a measured miss says so');
  ok(says(nothingNear, NWS_US_ONLY),
    'and says the list is a US list, so the empty result is not an answer for '
    + 'anywhere else');
  /* ==> AND IT NAMES THE DISTANCE. <== §56.3. A corridor is entirely ours, so
   * the copy hands the reader the radius and lets them judge it. An unnamed
   * proximity is a claim wearing a measurement's clothes. */
  ok(/\d/.test(flat(nothingNear).split('No flood alerts are in force within')[1]?.slice(0, 20) || ''),
    'and the sentence carries the actual radius, not a vague "nearby"');
}

/* =========================================================================
 * 3. THE THREE EMPTY STATES ARE THREE DIFFERENT SENTENCES (§5)
 * ====================================================================== */
section('§5 — unavailable is not none_matched is not no_track');

{
  const unavailable = await renderStorm({ summary: { state: 'unavailable' } });
  const noTrack = await renderStorm({ summary: { state: 'no_track' } });
  const noneMatched = await renderStorm({
    summary: corridorSummary(NATIONAL, LALA_SAMPLES, LIVE, 300),
  });

  ok(flat(unavailable).includes('couldn’t be checked'),
    'a failed list says it failed');
  ok(!flat(unavailable).includes('No flood alerts are in force'),
    'and a failed list NEVER reads as an all-clear — this is the §5 assertion');
  ok(unavailable.includes('data-retry="flood"'),
    'and it offers a Retry, because a fresh fetch is the fix');

  ok(flat(noTrack).includes('no published track'),
    'a storm with no track says that is why');
  ok(!flat(noTrack).includes('No flood alerts are in force'),
    'and never derives an all-clear from our own missing geometry');

  ok(flat(noneMatched).includes('No flood alerts are in force within'),
    'a measured miss IS an all-clear, and says so plainly');

  /* THE PROPERTY, NOT THE THREE STRINGS: no two of them may read the same. */
  const three = [unavailable, noTrack, noneMatched].map(flat);
  ok(new Set(three).size === 3, 'the three empty states render three different bodies');
}

/* =========================================================================
 * 4. THE ROWS ARE NOT ATTRIBUTED TO THE STORM (§48.21)
 * ====================================================================== */
section('§48.21 — a geographic match is not a causal claim');

{
  const matched = await renderStorm({
    summary: corridorSummary(NATIONAL, overIndiana, LIVE, 300),
    surgePayload: SAUDEL_SURGE,
  });
  ok(matched.includes('Flash Flood Warning') || matched.includes('Flood Warning'),
    'the matched rows reach the section');
  ok(says(matched, NWS_NOT_ATTRIBUTED),
    'and the section says the app matched them by distance, not NWS by cause');
  /* ==> THE WORDING IS THE WHOLE SAFETY PROPERTY. <== A stalled front can flood
   * a county while the hurricane goes out to sea. */
  ok(!/this storm’s flooding|caused by this storm/i.test(flat(matched)),
    'and never claims the storm caused any of them');

  /* THE COUNT OF ALERTS IS NOT THE COUNT OF SHAPES, and both get said. */
  const s = corridorSummary(NATIONAL, overIndiana, LIVE, 300);
  ok(s.state === 'ok' && s.total > 0, 'the probe actually matches something');
  if (s.total > s.drawable) {
    ok(flat(matched).includes('no shape to draw on the map'),
      'an undrawable alert is named, because the globe cannot say it');
  }
}

/* =========================================================================
 * 5. ORDER, AND THE SEAM BETWEEN AN ORDER AND A MODEL
 * ====================================================================== */
section('§56.7 — rows above prose, and a rule only between them');

{
  const both = await renderStorm({
    summary: corridorSummary(NATIONAL, overIndiana, LIVE, 300),
    surgePayload: SAUDEL_SURGE,
  });
  /* ==> AN ALERT IS SOMEBODY ELSE'S ORDER; A MODELLED HEIGHT IS OUR READING OF
   * A SIMULATION. <== Given one look the model borrows the authority of the
   * order, so the order leads and the model is prose underneath. */
  ok(both.indexOf('rain-alerts') < both.indexOf('flood-model'),
    'the rows render above our modelled figure');
  ok(both.includes('flood-model--after-rows'),
    'and a hairline separates the two kinds of statement');

  /* THE SEAM IS NOT DRAWN UNDER NOTHING. With no rows above it, a rule is a
   * line across an empty section. */
  const modelOnly = await renderStorm({ summary: null, surgePayload: SAUDEL_SURGE });
  ok(modelOnly.includes('flood-model') && !modelOnly.includes('flood-model--after-rows'),
    'with no rows above it, the model half draws no rule');
}

/* =========================================================================
 * 6. THE SURGE ROWS MOVED, AND THEY MOVED ONCE (§56.8)
 * ====================================================================== */
section('§56.8 — storm surge leaves Watches and warnings');

{
  const capUi = createCapStorm({ loadAlerts: async () => ({ state: 'ok', alerts: CAP_ALERTS }) });
  await capUi.ensure(canadaStorm, () => {});

  const ww = capUi.html(canadaStorm, CAP_NOW);
  const water = capUi.waterHtml(canadaStorm, CAP_NOW);

  /* THE FIXTURE HAS TO ACTUALLY CARRY THE ROW, or everything below passes for
   * the wrong reason. */
  const mine = alertsForStorm(CAP_ALERTS, canadaStorm);
  const { surge: mySurge } = partitionSurge(mine);
  ok(mySurge.length > 0,
    'MUTATION DEAD: the Canada probe matches no surge row, so this section is '
    + 'asserting nothing');

  ok(water?.state === 'ok' && water.alerts.length === mySurge.length,
    'every surge row reaches the Flooding section');
  ok(!/storm surge/i.test(ww),
    'and none of them is left in Watches and warnings');

  /* ==> A ROW IN BOTH IS AS BAD AS A ROW IN NEITHER. <== One is the app saying
   * the same thing twice under two headings; the other is §5's silence with a
   * filing system over it. */
  ok(mine.length === water.alerts.length + partitionSurge(mine).rest.length,
    'every matched row lands in exactly one of the two sections');

  /* THE SECTION RENDERS THEM. A partition that is right and markup that is
   * empty is the same blank space to a reader. */
  const withCap = await renderStorm({ storm: gdacsStorm, cap: water, surgePayload: LALA_SURGE });
  ok(/storm surge/i.test(withCap), 'and the Flooding section actually prints them');

  /* A FAILED CAP FETCH IS NOT AN ALL-CLEAR HERE EITHER. */
  const capDown = await renderStorm({ cap: { state: 'unavailable' }, surgePayload: LALA_SURGE });
  ok(flat(capDown).includes('couldn’t be checked') && capDown.includes('data-retry="flood-cap"'),
    'a failed CAP fetch says so, with its own Retry');
}

/* =========================================================================
 * 7. THE POINTER LINE (§56.8)
 * ====================================================================== */
section('§56.8 — Watches and warnings points at Flooding');

{
  const view = fs.readFileSync('ui/view-storm-detail.js', 'utf8');

  /* ==> IT NAMES THE SECTION BY THE HEADING THE VIEW ACTUALLY RENDERS. <== A
   * pointer to a heading that does not exist is worse than no pointer: the
   * reader goes looking and concludes the app lost the alert, which is the
   * exact failure this line was written to prevent. Renaming the section
   * without this test is a one-word change with no failing check anywhere. */
  const heading = view.match(/section\(FLOOD_SECTION, '([^']+)'/)?.[1];
  ok(heading === 'Flooding', `the section's heading should be Flooding, got ${heading}`);
  ok(FLOOD_POINTER.includes(`<strong>${heading}</strong>`),
    'the pointer names the section by the heading the view renders');

  /* ==> IT IS APPENDED IN THE VIEW, NOT IN EITHER HALF. <== That section has
   * two bodies — NHC's own legend and `ui/cap-storm.js` — and a line written
   * into one of them would be missing from the other half of its own section,
   * which is a blank space and therefore invisible. */
  ok(/return `\$\{wwBody\(\)\}\$\{FLOOD_POINTER\}`/.test(view),
    'wwHtml appends the pointer to whichever half rendered');
  ok(!fs.readFileSync('ui/cap-storm.js', 'utf8').includes('Flooding</strong>'),
    'and the CAP half emits no pointer of its own, so it is never said twice');

  /* NOT ON A WITHHELD STORM: the whole section is replaced by one sentence
   * saying why nothing in it can be trusted, and a signpost under that is
   * furniture on a notice. */
  ok(/if \(silenced\) return `<div class="detail-soft">\$\{esc\(silenced\)\}<\/div>`;\n\s*\/\* ==> THE POINTER/.test(view),
    'a withheld storm returns before the pointer is appended');
}

/* =========================================================================
 * 8. THE HOME DASHBOARD'S HALF
 * ====================================================================== */
section('§56.7 — the same section, the house’s question');

{
  /* NO STORM ON SCREEN IS NOT A FAILED MODEL. On a calm day nobody has asked
   * this model anything — it reports per storm and there is no storm. §5
   * governs a source that FAILED, not a question nobody put. */
  const calm = await renderHome({ storm: null, rainStatus: 'unavailable' });
  ok(!says(calm, MODEL_NOT_THIS_BASIN) && !says(calm, GDACS_PROVENANCE),
    'with no storm on screen the section says nothing about a model');
  ok(flat(calm).includes('couldn’t be checked'),
    'but a failed alert fetch still says so — that source WAS asked');

  /* AN NHC STORM ON THE STEPPER STILL EXPLAINS THE MISSING FIGURE. */
  const nhcOnScreen = await renderHome({ storm: nhcStorm, rainStatus: 'unavailable' });
  ok(says(nhcOnScreen, MODEL_NOT_THIS_BASIN),
    'an NHC storm on screen says why there is no modelled figure');

  /* THE PROVENANCE IS NOT OPTIONAL. It names the modeller, which is the only
   * thing on screen explaining why this storm's figure is centimetres where an
   * American storm's is feet (§51.1). */
  const modelled = await renderHome({
    storm: gdacsStorm, rainStatus: 'unavailable', surgePayload: LALA_SURGE,
  });
  ok(says(modelled, GDACS_PROVENANCE),
    'a modelled figure always names the modeller and says "modelled"');

  /* ==> `out_of_range` IS NOT AN ALL-CLEAR AND MUST NEVER READ AS ONE. <== The
   * model produced towns; none is near this house. Nobody looked here. */
  const far = await renderHome({
    storm: gdacsStorm, rainStatus: 'unavailable', surgePayload: LALA_SURGE,
    home: { lat: 40.0, lon: -75.0 },
  });
  ok(flat(far).includes('gap in what we know rather than an all-clear'),
    'a house outside the modelled towns is told nobody looked, not that it is dry');

  /* NO HOUSE, NO SECTION. Both halves are questions about an address; with no
   * pin there is no question to put, and §5 does not require announcing that. */
  ok(await renderHome({ home: null }) === '',
    'with no home set the section does not render at all');
}

/* =========================================================================
 * 9. THE GLYPH (§56.10)
 * ====================================================================== */
section('§56.10 — one water mark, and only one');

{
  ok(typeof ICON_PATH.flood === 'string' && ICON_PATH.flood.length > 0,
    'the Flooding glyph exists');
  ok((ICON_PATH.flood.match(/<path/g) || []).length === 3,
    'and it is three stacked waves');
  /* ==> `surge` WENT WITH ITS SECTION. <== Its own comment said it existed
   * solely to separate `Coastal flooding` from `Rain` at a glance. That
   * section is gone, so the mark has no job — and two water glyphs would teach
   * a reader that the difference between them means something, which is the
   * finding §56.7 is built on. */
  ok(!('surge' in ICON_PATH), 'and the old surge crest is deleted, not kept beside it');
}

/* ===================================================================== */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
