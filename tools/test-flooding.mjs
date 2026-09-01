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
  NHC_SURGE_NONE, NHC_SURGE_UNAVAILABLE, NHC_SURGE_PROVENANCE,
  FLOOD_POINTER,
} = await import('../ui/flood-words.js');
const { floodAlertRows, wireFloodAlertRows } = await import('../ui/rain-alerts.js');
const { surgeOnStorm, surgeAtHome } = await import('../lib/surge-locations.js');
const { corridorSummary, trackChains, trackSamples } = await import('../lib/flood.js');
const { projectLocations } = await import('../functions/api/gdacs/surge.js');
const { readAlerts, partitionSurge, alertsForStorm } = await import('../lib/cap.js');
const { _normalizeGdacsEvent } = await import('../data/gdacs.js');
const { normalizeSurge } = await import('../data/surge.js');
const { createCapStorm } = await import('../ui/cap-storm.js');
const { ICON_PATH, iconPathData } = await import('../ui/section-icon.js');

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

/** ==> THE SAME HOUR WITH EVERY ALERT PLACEABLE, AND IT NEEDS A NAME OF ITS
 *  OWN SINCE PHASE 4. <== §56.4. This capture predates the zone join: its three
 *  Flood Watches carry `geometry: null` AND no zone codes, so nothing in this
 *  suite can resolve them the way the app now does. To `corridorSummary` they
 *  are three alerts that could not be placed — and an all-clear is deliberately
 *  WITHHELD while any alert is in that state.
 *
 *  So the all-clear cases below run on the alerts that DID carry a shape, which
 *  is what the app hands them on a day the boundaries resolve. The withheld
 *  case gets its own assertions further down, on the full fixture, because that
 *  behaviour is the point rather than an obstacle. */
const PLACEABLE = NATIONAL.filter((a) => a.geometry);

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
  /* NHC's own surge, off the geometry bundle (§56.8). Defaults to "wired, and
   * NHC has nothing out" — the honest common case, and the same
   * wired-but-quiet default every other dep here takes. Pass `nhcSurge: null`
   * to test the section with the dep genuinely absent. */
  nhcSurge = { state: 'ok', slot: { status: 'none', fc: null } },
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
    nhcSurge: nhcSurge
      ? { read: (s2) => (s2?.source === 'nhc' ? nhcSurge : null) }
      : null,
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
  /* ==> IT ANSWERS IN NHC'S TERMS NOW, NOT GDACS'S (§56.8, 2026-09-01). <== The
   * old assertion here was MODEL_NOT_THIS_BASIN — "the global model does not
   * cover this basin". That was the best available answer while an American
   * storm had no surge surface at all. It now has one, so the honest sentence
   * for a US storm is about the product that actually covers it: NHC has
   * nothing out. The old sentence would sit under this one describing a gap
   * that is filled. */
  ok(says(usStorm, NHC_SURGE_NONE),
    'an NHC storm says NHC has no surge forecast out');
  ok(!says(usStorm, MODEL_NOT_THIS_BASIN),
    'and does not also apologise for a different model that never covered it');
  ok(!flat(usStorm).includes('No coastal flooding is modelled for this storm'),
    'and it never states the all-clear it has not earned');
  ok(usStorm.includes('flood alert'), 'while still showing the rows it does have');

  /* ==> THE OLD SENTENCE IS NOT DELETED, IT IS THE FALLBACK. <== With the dep
   * genuinely absent — a drawer built without it — the section must still
   * explain itself rather than going quiet, which is what it did before today
   * and is still the right behaviour when there is no surge surface at all. */
  const usNoDep = await renderStorm({
    storm: nhcStorm,
    summary: corridorSummary(NATIONAL, overIndiana, LIVE, 300),
    nhcSurge: null,
  });
  ok(says(usNoDep, MODEL_NOT_THIS_BASIN),
    'with no surge surface wired, the old coverage sentence still speaks');

  /* The other half: nothing matched the corridor. "No flood alerts within
   * 345 mi" is only an answer for a place NWS forecasts at all. */
  const nothingNear = await renderStorm({
    storm: gdacsStorm,
    summary: corridorSummary(PLACEABLE, LALA_SAMPLES, LIVE, 300),
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
    summary: corridorSummary(PLACEABLE, LALA_SAMPLES, LIVE, 300),
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

  /* ==> AND A MISS IS NOT AN ALL-CLEAR WHILE SOMETHING COULD NOT BE PLACED.
   * <== §56.4. An alert whose zone boundaries did not resolve never reaches the
   * distance test, so "nothing within 345 mi" would be an all-clear assembled
   * out of our own missing geometry — the same mistake `no_track` above exists
   * to prevent, arriving by a different road. It is the worst sentence this
   * feature can print. The full capture has three such watches. */
  const withUnplaceable = corridorSummary(NATIONAL, LALA_SAMPLES, LIVE, 300);
  ok(withUnplaceable.unplaceable === NATIONAL.length - PLACEABLE.length,
    `every shapeless alert is counted rather than forgotten (${withUnplaceable.unplaceable})`);

  const withheld = await renderStorm({ summary: withUnplaceable });
  ok(!flat(withheld).startsWith('No flood alerts are in force within')
    && flat(withheld).includes('could not be placed on the map'),
    'and the all-clear is withheld, with the reason said first');
  ok(says(withheld, NWS_US_ONLY),
    'while the coverage sentence still rides along');

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

  /* ==> THE ALERTS THAT COULD NOT BE PLACED ARE NAMED IN THE SENTENCE TOO, AND
   * THIS REPLACED A CHECK THAT COULD NEVER FIRE. <== §56.4. The old assertion
   * was guarded on `total > drawable` — a difference that is always zero,
   * because nothing shapeless survives the distance test — so it never ran
   * once. `unplaceable` is the number that CAN differ, and it is not guarded:
   * this fixture has three shapeless watches in it and the sentence has to
   * account for them. */
  const s = corridorSummary(NATIONAL, overIndiana, LIVE, 300);
  ok(s.state === 'ok' && s.total > 0, 'the probe actually matches something');
  ok(s.unplaceable === NATIONAL.length - PLACEABLE.length,
    `and the shapeless ones are counted, not dropped (${s.unplaceable})`);
  ok(flat(matched).includes('could not be placed on the map'),
    'the sentence admits the alerts the globe cannot show');
  ok(flat(matched).includes(`${s.unplaceable} more are`),
    'and says how many, because a vague admission is not one');
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
section('§56.8 — NHC’s own surge, in the section that keeps water');

{
  /* The bytes a real advisory produces, through the real normalizer. */
  const raw = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'samples/lala-cp012026/surge/peaksurge-polygons.geojson'), 'utf8'));
  const fc = normalizeSurge(raw, { fromFixture: false }).fc;
  const okSlot = { state: 'ok', slot: { status: 'ok', fc } };

  const drawn = await renderStorm({ storm: nhcStorm, nhcSurge: okSlot });

  /* ==> THE MECHANISM IS THE WATCH LIST'S, AND THE TEST SAYS SO IN MARKUP.
   * <== Aaron's call, 2026-09-01. If a later pass grows this a bespoke list
   * class or a swatch of its own, the two coastal legends have drifted apart
   * and this goes red — which is the whole point of asserting on the class
   * names rather than on the words. */
  ok(drawn.includes('<ul class="detail-ww">'),
    'the surge legend is the watch list’s list');
  ok(drawn.includes('class="row-swatch"'),
    'and the watch list’s glowing dot');
  ok(drawn.includes('--swatch:#64B5F6'),
    'wearing the ramp’s own blue, not an invented colour');

  /* ONLY THE ACTIVE ROWS. Lala forecast 1-2 ft everywhere — one rung. A legend
   * printing the palette would show five. */
  ok((drawn.match(/<li>/g) || []).length === 1,
    'one rung was forecast, so exactly one row is drawn — not the whole palette');
  ok(flat(drawn).includes('1-2 ft'),
    'labelled with NHC’s own range');
  ok(says(drawn, NHC_SURGE_PROVENANCE),
    'and the datum is stated — feet ABOVE GROUND, never a tide height');

  /* ==> THE DISCLAIMER ABOUT THE OTHER MODEL MUST NOT SIT UNDER THIS. <== It
   * says there is no figure and that this is a gap in what the app can show.
   * Printed beneath a list of NHC depths it contradicts the rows above it. */
  ok(!says(drawn, MODEL_NOT_THIS_BASIN),
    'and no sentence claiming a gap that these rows just filled');

  /* ==> IT IS FIRST IN THE SECTION, AND THAT IS A GLASS CALL WITH A REASON.
   * <== Aaron, 2026-09-01, looking at Edouard on a phone: six Flood Watches
   * each carrying a full county roster had pushed the one surge row and its
   * datum off the bottom of the screen — in the section a reader opens to find
   * out how deep the water gets. It had also landed directly under
   * NWS_NOT_ATTRIBUTED, so NWS's "may have another cause" caveat read as
   * attached to NHC's forecast.
   *
   * Asserted by POSITION rather than by presence, because the version that
   * shipped had it present and last, and every other assertion in this block
   * passed on it. MUTATION-TESTED: restoring the old order fails both lines. */
  const withRows = await renderStorm({
    storm: nhcStorm,
    nhcSurge: okSlot,
    summary: corridorSummary(NATIONAL, overIndiana, LIVE, 300),
  });
  ok(withRows.includes('flood alert'),
    'the corridor rows are still there to be ordered against');
  ok(flat(withRows).indexOf('1-2 ft') !== -1
     && flat(withRows).indexOf('1-2 ft') < flat(withRows).indexOf('flood alert'),
    'the surge row comes before the alert list, not after it');
  ok(flat(withRows).indexOf(flat(NHC_SURGE_PROVENANCE))
     < flat(withRows).indexOf(flat(NWS_NOT_ATTRIBUTED)),
    'and its datum is never left sitting under NWS’s not-attributed caveat');

  /* --- THE THREE STATES THAT ARE NOT ROWS, AND WHY THEY MUST DIFFER (§5). --- */

  const failed = await renderStorm({
    storm: nhcStorm,
    nhcSurge: { state: 'ok', slot: { status: 'unavailable', fc: null } },
  });
  ok(says(failed, NHC_SURGE_UNAVAILABLE), 'a failed surge fetch says it failed');
  ok(!says(failed, NHC_SURGE_NONE),
    'and never the all-clear — this is the exact pair that shipped as one');

  const loading = await renderStorm({
    storm: nhcStorm, nhcSurge: { state: 'loading', slot: null },
  });
  ok(flat(loading).includes('Checking peak storm surge'), 'loading says it is loading');
  ok(!says(loading, NHC_SURGE_NONE) && !says(loading, NHC_SURGE_UNAVAILABLE),
    'and claims neither of the settled answers while it is still asking');

  /* ==> `ok` WITH NOTHING READABLE IS ITS OWN STATE. <== Features arrived and
   * none carried a severity this app knows. Reporting the all-clear there
   * turns a schema change into a statement about a coastline. */
  const unreadable = await renderStorm({
    storm: nhcStorm,
    nhcSurge: { state: 'ok', slot: { status: 'ok', fc: { features: [{ properties: {} }] } } },
  });
  ok(flat(unreadable).includes('could not read'),
    'features with no readable severity are reported as unreadable');
  ok(!says(unreadable, NHC_SURGE_NONE), 'and not as an absence of surge');

  /* --- NOT A US STORM, NOT THIS HALF. --- */
  const foreign = await renderStorm({ storm: gdacsStorm, nhcSurge: okSlot });
  ok(!says(foreign, NHC_SURGE_PROVENANCE) && !flat(foreign).includes('1-2 ft'),
    'a GDACS storm is never handed NHC’s forecast');
}

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

  /* ==> AND THE GLOBE DRAWS THIS SHAPE, NOT A COPY OF IT. <== §56.10 committed
   * to that in Phase 2 — *the same path data, not a redrawn one* — and Slice B
   * shipped a blank rounded square anyway. **No gate in this repo noticed; Aaron
   * did, on a phone, on 2026-08-23.** These three assertions are that gate.
   *
   * MUTATION-VERIFIED: paste the wave `d` strings into `map/layers/flood.js` and
   * delete the import, and the second and third go red together. Change the
   * heading's waves and the first still passes — which is correct, because the
   * point is that the two move TOGETHER, not that either one is frozen. */
  const d = iconPathData('flood');
  ok(d.length === 3 && d.every((x) => x.startsWith('M')),
    'the waves are readable as raw path data, which is what a canvas needs');

  /* ==> BOTH MAP FILES ARE READ, AND THAT IS WHAT SURVIVING SLICE C'S SPLIT
   * MEANS. <== The chip moved to `map/layers/flood-chip.js`. Reading only the
   * file this gate was written against would have gone quietly green on an
   * empty check — the import it looks for would simply not be in the file any
   * more, which is the failure mode of every assertion pinned to a path. So it
   * reads the pair and asks the question of the PAIR: somewhere in what the
   * globe draws with, the shape is imported, and nowhere in it is the shape
   * copied. */
  const mapSrc = ['../map/layers/flood.js', '../map/layers/flood-chip.js']
    .map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
  ok(mapSrc.some((s) => /iconPathData/.test(s) && /section-icon\.js/.test(s)),
    'and the map layer takes them from ui/section-icon.js');
  ok(!mapSrc.some((s) => d.some((x) => s.includes(x))),
    'and carries no copy of its own — one shape, two surfaces');
}

/* =====================================================================
 * §56.6 — THE ROWS ARE THE KEYBOARD PATH INTO THE DETAIL PANEL
 *
 * ==> A PHASE THAT SHIPS THE ICON WITHOUT THE ROWS HAS SHIPPED A GESTURE-ONLY
 * FEATURE. <== §56.6 says it in those words and §10 does not treat it as a
 * limitation — an icon reachable only by tapping a globe does not EXIST for a
 * keyboard user. These assertions are that rule's gate.
 *
 * Every one below was mutation-verified against `ui/rain-alerts.js`.
 * ================================================================== */
{
  section('§56.6 — the rows open the same panel the chip does');

  const ALERTS = [
    { id: 'urn:oid:a', event: 'Flash Flood Warning', area: 'Hawaii in Hawaii, HI',
      immediate: true, begun: true, untilMs: Date.now() + 3_600_000, remaining: '1 hour left' },
    { id: 'urn:oid:b', event: 'Flood Watch', area: 'Maui Windward West',
      immediate: false, begun: true, untilMs: Date.now() + 7_200_000, remaining: '2 hours left' },
  ];
  const html = floodAlertRows(ALERTS);

  ok(/<button[^>]+type="button"/.test(html),
    'each row is a real <button>, so Enter and Space work with no ARIA at all');

  /* ==> AND IT CARRIES NO `<p>`, WHICH IS NOT A STYLE POINT. <== A <p> is not
   * valid inside a <button>: browsers close the button early and re-parent the
   * rest of the row OUTSIDE it, so one pressable row becomes a button with a
   * fragment beside it — half the row goes dead and nothing says so.
   * MUTATION-VERIFIED: put the <p> back on `.rain-alert-head` and this fails. */
  const btnBody = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
  ok(!/<p[\s>]/.test(btnBody),
    'and holds no <p>, which a browser would silently close the button around');

  ok((html.match(/data-alert-index="/g) || []).length === ALERTS.length,
    'every row carries the index the handler resolves it by');
  ok(html.includes('data-alert-index="0"') && html.includes('data-alert-index="1"'),
    'and the indexes are positional, matching the array that drew them');

  /* THE ROW STILL SAYS EVERYTHING IT SAID BEFORE. Slice C made it pressable and
   * was not allowed to change what it reads as — the preceding restyle exists
   * because a row that looked like a widget was reverted once already. */
  ok(html.includes('Hawaii in Hawaii, HI') && html.includes('Maui Windward West'),
    'the area is still printed whole on every row');
  ok(/in force until/.test(html) && !/Flood Watch<\/span>\s*<span class="rain-alert-until">in force/.test(html),
    'and the immediate/later distinction still lives in the words');

  /* --- the delegation ---------------------------------------------------
   * A scope that behaves the way the real one does for the three things the
   * handler actually uses. Deliberately NOT tools/fake-dom.mjs: that is a
   * flat selector lookup table, and this is a question about event bubbling. */
  function scopeStub() {
    let handler = null;
    const buttons = new Map();
    return {
      listeners: 0,
      addEventListener(type, fn) { if (type === 'click') { handler = fn; this.listeners++; } },
      contains: (el) => buttons.has(el),
      button(i) {
        const el = { dataset: { alertIndex: String(i) } };
        el.closest = (sel) => (sel === '[data-alert-index]' ? el : null);
        buttons.set(el, true);
        return el;
      },
      /** Something in the section that is not a row — the Retry button. */
      stray() {
        const el = { dataset: {} };
        el.closest = () => null;
        return el;
      },
      click(el) { handler?.({ target: el }); },
    };
  }

  {
    const scope = scopeStub();
    const opened = [];
    wireFloodAlertRows(scope, () => ALERTS, (a) => opened.push(a));

    /* ==> ONE LISTENER, WHATEVER THE LIST LENGTH. <== A quiet national day is
     * 36 alerts and the sections repaint on every poll; binding per row would
     * add that many listeners each time. MUTATION-VERIFIED: bind per row and
     * this goes red. */
    ok(scope.listeners === 1,
      'one delegated listener on the container, never one per row');

    scope.click(scope.button(1));
    ok(opened.length === 1 && opened[0] === ALERTS[1],
      'pressing a row opens THAT row’s alert, resolved by index');

    scope.click(scope.stray());
    ok(opened.length === 1,
      'and a press on something else in the section opens nothing');
  }

  /* ==> THE ARRAY IS READ THROUGH A GETTER, NEVER CAPTURED. <== Both sections
   * repaint on every poll. A captured array would open the panel on whatever
   * was in force one poll ago — a stale expiry shown to somebody deciding
   * whether to move. MUTATION-VERIFIED: take the array by value instead of by
   * function and this goes red. */
  {
    const scope = scopeStub();
    const opened = [];
    let current = ALERTS;
    wireFloodAlertRows(scope, () => current, (a) => opened.push(a));

    const REPLACED = [{ id: 'urn:oid:c', event: 'Areal Flood Warning' }];
    current = REPLACED;
    scope.click(scope.button(0));
    ok(opened.length === 1 && opened[0] === REPLACED[0],
      'a press after a repaint opens the CURRENT list, not the one drawn earlier');
  }

  /* A row whose alert has gone does nothing rather than opening an empty
   * panel. Reachable when the list shrinks between the paint and the press. */
  {
    const scope = scopeStub();
    const opened = [];
    wireFloodAlertRows(scope, () => [], (a) => opened.push(a));
    scope.click(scope.button(3));
    ok(opened.length === 0, 'and a row whose alert is gone opens nothing rather than a blank');
  }

  /* No callback, no crash: both sections default `openAlert` to null, so a
   * caller that has not been updated still renders rows that simply do not
   * open rather than taking the whole screen down. */
  {
    const scope = scopeStub();
    wireFloodAlertRows(scope, () => ALERTS, null);
    ok(scope.listeners === 0, 'with no open callback it binds nothing at all');
  }
}

/* ===================================================================== */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
