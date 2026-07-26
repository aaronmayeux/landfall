#!/usr/bin/env node
/**
 * test-adeck.mjs — the model-guidance layer's parse, filter and state rules.
 *
 * ZERO DEPENDENCIES, like tools/check-syntax.mjs and for the same reason: a
 * guard that only runs on the machine which happens to have a package
 * installed is not a guard (§12 — this project has no toolchain by design).
 * Plain `node tools/test-adeck.mjs`, nothing to install.
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front because this project has
 * been burned by the difference twice (§15's wind-swath day, and the four
 * failed spoke-axis fixes):
 *
 *   IT CAN prove the parse rules — the tenths-of-a-degree coordinates, the
 *   repeated wind-radii taus, per-tech latest cycle, the staleness gate, the
 *   HCCA/TVCN slot, the back-half clip, and that the store refuses to switch
 *   off the last model.
 *
 *   IT CANNOT prove the layer is right. Every fixture below is SYNTHETIC. A
 *   real deck will differ in ways nothing here imagines, and the standing
 *   rule is: WHEN A FIXTURE PASSES AND GLASS FAILS, THE FIXTURE IS WRONG —
 *   stop building fixtures and go read the real bytes (`?full=1` on the
 *   relay route returns an unfiltered deck for exactly this).
 *
 * A browser pass (Playwright + a stubbed relay) was run once on 2026-07-25
 * and is deliberately NOT kept here: it needs npm packages, which is the
 * toolchain this project refuses. It caught one real bug worth recording —
 * the manifest's missing `engineKey`, which left the toggle flipping state
 * that never reached the map. Rebuild it from that note if a later change
 * needs it.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* localStorage stub — data/layer-prefs.js reads at module load. */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { parseAdeck, atcfLatLon, parseDtg, clipBehind, tracksToFeatures, modelColor } =
  await import('../lib/adeck.js');

/* --- field parsing -------------------------------------------------------
 * `286N` is 28.6, NOT 286. Reading the digits as degrees produces positions
 * that wrap to a plausible wrong place on a globe rather than failing. */
section('ATCF field parsing');
ok(atcfLatLon('286N') === 28.6, 'lat: tenths of a degree, north positive');
ok(atcfLatLon('920W') === -92.0, 'lon: west is negative');
ok(atcfLatLon('150S') === -15.0, 'lat: south is negative');
ok(atcfLatLon('1750E') === 175.0, 'lon: east positive, three digits');
ok(atcfLatLon('286') === null, 'no hemisphere letter -> null, not a guess');
ok(atcfLatLon('') === null, 'empty -> null');
ok(atcfLatLon('ABCN') === null, 'non-numeric digits -> null');
ok(parseDtg('2026072512') === Date.UTC(2026, 6, 25, 12), 'DTG parses as UTC');
ok(parseDtg('20260725') === null, 'short DTG -> null');
ok(parseDtg('2026139912') === null, 'impossible month -> null');
ok(parseDtg('not a date') === null, 'junk DTG -> null');

/* --- a realistic deck ---------------------------------------------------- */
section('deck parsing');
const row = (dtg, tech, tau, lat, lon, rad = 34) =>
  `AL, 05, ${dtg}, 03, ${tech}, ${tau}, ${lat}, ${lon}, 65, 990, HU, ${rad}, NEQ, 80, 60, 40, 70`;

const NEW = '2026072512';
const LAG = '2026072506';  // one cycle behind — raw models do this, must survive
const DEAD = '2026072312'; // two days behind — stopped running, must be dropped

const deck = [
  row(NEW, 'TVCN', 0, '250N', '800W', 34),
  row(NEW, 'TVCN', 0, '250N', '800W', 50),
  row(NEW, 'TVCN', 0, '250N', '800W', 64),
  row(NEW, 'TVCN', 12, '260N', '810W'),
  row(NEW, 'TVCN', 24, '270N', '820W'),
  row(LAG, 'AVNO', 0, '249N', '799W'),
  row(LAG, 'AVNO', 12, '265N', '818W'),
  row(LAG, 'AVNO', 24, '282N', '838W'),
  row(DEAD, 'UKX', 0, '200N', '700W'),
  row(DEAD, 'UKX', 12, '210N', '710W'),
  row(NEW, 'HCCA', 0, '251N', '801W'),
  row(NEW, 'HCCA', 12, '261N', '811W'),
  row(NEW, 'OFCL', 0, '250N', '800W'),
  row(NEW, 'EMXI', 0, '250N', '800W'),
  'garbage line with no commas',
  'AL, 05, BADDTG, 03, HFSA, 0, 250N, 800W, 65, 990, HU, 34, NEQ',
  row(NEW, 'HFSA', 0, '0N', '0W'),
  row(NEW, 'HFSA', 12, '999N', '800W'),
  row(NEW, 'HFSA', 24, '265N', '815W'),
  row(NEW, 'HFSA', 36, '275N', '825W'),
  row(NEW, 'HFSA', 999, '900N', '900W'),
].join('\n');

const tracks = parseAdeck(deck, { cur: { lon: -80.0, lat: 25.0 }, headingDeg: 315 });
const byTech = Object.fromEntries(tracks.map((t) => [t.tech, t]));

ok(byTech.TVCN?.points.length === 3, 'a tau repeated across wind-radii rows counts once');
ok(byTech.AVNO?.cycle === LAG, 'each model uses its OWN latest cycle, not a shared one');
ok(!byTech.UKX, 'a model 48 h behind the deck is dropped, not drawn as current');
ok(!byTech.HCCA, 'HCCA suppressed while TVCN holds the consensus slot');
ok(!byTech.OFCL, 'OFCL never drawn — it IS the official track');
ok(!byTech.EMXI, 'EMXI never drawn — its public rows are blank');
ok(!!byTech.HFSA, 'a model survives junk rows around it');
ok(!byTech.HFSA.points.some(([lo, la]) => la > 90 || (lo === 0 && la === 0)),
   '0,0 and out-of-range positions dropped');

const noTvcn = parseAdeck(deck.split('\n').filter((l) => !l.includes('TVCN')).join('\n'),
  { cur: { lon: -80, lat: 25 }, headingDeg: 315 });
ok(noTvcn.some((t) => t.tech === 'HCCA'), 'HCCA fills the consensus slot when TVCN is absent');

ok(parseAdeck('').length === 0, 'empty deck -> [], not a throw');
ok(parseAdeck('<html>404</html>').length === 0, 'an error page -> [], not a throw');
ok(parseAdeck(null).length === 0, 'null -> [], not a throw');

/* --- the back-half clip --------------------------------------------------
 * Raw models analyse the storm slightly BEHIND NHC's position even on the
 * matching cycle, so without this every model trails its own short tail and
 * the current dot sprouts a beard. */
section('stale back-half clip');
const pts = [[-79.0, 24.0], [-79.5, 24.5], [-80.5, 25.5], [-81.0, 26.0]];
const clipped = clipBehind(pts, { lon: -80, lat: 25 }, 315);
ok(clipped[0][0] === -80 && clipped[0][1] === 25, 'line is anchored at the current position');
ok(!clipped.some(([lo, la]) => lo === -79.0 && la === 24.0), 'point behind the storm is dropped');
ok(clipped.length === 3, 'anchor plus the two forward points');
ok(clipBehind(pts, { lon: -80, lat: 25 }, null).length >= 2, 'no heading -> nearest-point fallback');
ok(clipBehind(pts, null, 315).length === 4, 'no current position -> no clip');
ok(clipBehind([[1, 1]], { lon: 0, lat: 0 }, 0).length === 1, 'a single point is left alone');

/* --- features and colour -------------------------------------------------- */
section('render shape');
const fc = tracksToFeatures(tracks);
ok(fc.type === 'FeatureCollection', 'emits a FeatureCollection');
ok(fc.features.every((f) => f.geometry.type === 'LineString'), 'every track is a LineString');
ok(fc.features.every((f) => /^#[0-9A-F]{6}$/i.test(f.properties._color)),
   'colour is baked per feature, not resolved in a style expression');
const one = tracksToFeatures(tracks, (p) => p === 'avno');
ok(one.features.length === 1 && one.features[0].properties._tech === 'AVNO',
   'the selection filter drops geometry rather than hiding it');
ok(tracksToFeatures(tracks, () => false).features.length === 0, 'all off -> no features');
ok(modelColor('TVCN') === modelColor('HCCA'), 'the consensus pair shares one identity colour');
ok(modelColor('AVNO') !== modelColor('TVCN'), 'distinct models get distinct colours');
ok(/^#/.test(modelColor('NOPE')), 'an unlisted model falls back to the ramp, never to nothing');

/* --- the relay row filter -------------------------------------------------
 * Loaded out of the Pages Function by text: it runs in workerd and cannot be
 * imported here, but the filter is the load-bearing part and an untested
 * filter that drops the wrong rows fails SILENTLY (§5). */
section('relay row filter');
const fnSrc = fs.readFileSync('functions/api/nhc/adeck.js', 'utf8');
const slice = fnSrc.slice(fnSrc.indexOf('const STORM_ID'), fnSrc.indexOf('export async function onRequestGet'));
const relay = await import('data:text/javascript,' +
  encodeURIComponent(slice + '\nexport { filterTechs, STORM_ID };'));

const mixed = [
  'AL, 05, 2026072512, 03, TVCN,   0, 250N,  800W,  65, 990, HU',
  'AL, 05, 2026072512, 03, AVNO,  12, 260N,  810W,  70, 985, HU',
  'AL, 05, 2026072512, 03, OFCL,   0, 250N,  800W,  65, 990, HU',
  'AL, 05, 2026072512, 03, EMXI,   0,     ,      ,    ,    ,   ',
  'AL, 05, 2026072512, 03, CTCX,   0, 250N,  800W,  65, 990, HU',
  'AL, 05, 2026072512, 03, HFSA,  24, 270N,  820W,  80, 975, HU',
  'AL, 05, 2026072512, 03, UKX,   36, 280N,  830W,  75, 980, HU',
  'AL, 05, 2026072512, 03, HCCA,   0, 251N,  801W,  65, 990, HU',
  'AL, 05, 2026072512, 03, AEMN,   0, 250N,  800W,  65, 990, HU',
  'short,row',
].join('\n');
const kept = relay.filterTechs(mixed).split('\n').filter(Boolean);
ok(kept.length === 5, 'keeps exactly the five shortlist rows');
ok(kept[0] === 'AL, 05, 2026072512, 03, TVCN,   0, 250N,  800W,  65, 990, HU',
   'kept rows are byte-identical — the filter deletes lines, it never rewrites them');
ok(!relay.filterTechs(mixed).match(/OFCL|EMXI|CTCX|AEMN/), 'everything outside the shortlist is dropped');
ok(relay.filterTechs('') === '', 'empty in, empty out');

const hundred = Array.from({ length: 100 }, (_, i) =>
  `AL, 05, 2026072512, 03, M${String(i).padStart(3, '0')}, 0, 250N, 800W, 65, 990, HU`).join('\n');
const ratio = relay.filterTechs(hundred + '\n' + mixed).length / (hundred + '\n' + mixed).length;
ok(ratio < 0.10, `the filter cuts >90% of a hundred-model deck (kept ${(ratio * 100).toFixed(1)}%)`);

/* The storm id builds an UPSTREAM PATH from a query parameter, so the shape
 * is an allowlist rather than an escape. */
section('storm id allowlist');
ok(relay.STORM_ID.test('al052026'), 'atlantic id accepted');
ok(relay.STORM_ID.test('ep012026'), 'east pacific id accepted');
ok(relay.STORM_ID.test('cp112026'), 'central pacific id accepted');
ok(!relay.STORM_ID.test('../../etc/passwd'), 'path traversal refused');
ok(!relay.STORM_ID.test('al052026/../x'), 'embedded traversal refused');
ok(!relay.STORM_ID.test('wp052026'), 'a basin NHC does not serve is refused');
ok(!relay.STORM_ID.test('al52026'), 'malformed number refused');
ok(!relay.STORM_ID.test(''), 'empty refused');

/* --- TCGP's storm index → deck identity -----------------------------------
 * THE JOIN IS POSITION. Two earlier versions keyed on the NAME and both broke
 * on the same storm the same day: JTWC dropped Noul when it stopped warning,
 * and TCGP relabelled her "ELEVEN (WP11)" when she decayed, while GDACS held
 * "NOUL-26" throughout. The fixtures below use those REAL labels so the
 * regression is pinned by the thing that actually happened.
 * ------------------------------------------------------------------------ */
section('TCGP storm index');
const { parseTcgpIndex, lastFixFromBdeck } = await import('../functions/api/tcgp/storms.js');
const { matchDeckByPosition } = await import('../data/adeck.js');

const page = `
<a href="https://verif.rap.ucar.edu/jntweb/hurricanes-beta/realtime/plots/northindian/2026/io932026/" title="x">DEPRESSION INVEST 93 (IO93)</a>
<a href="/jntweb/hurricanes-beta/realtime/plots/northwestpacific/2026/wp112026/" title="x">ELEVEN (WP11)</a>
<a href="https://verif.rap.ucar.edu/jntweb/hurricanes-beta/realtime/plots/northwestpacific/2026/wp112026/">ELEVEN (WP11)</a>
<a href="https://verif.rap.ucar.edu/jntweb/hurricanes-beta/realtime/plots/northeastpacific/2026/ep072026/" title="x">HURRICANE GENEVIEVE (EP07)</a>
<a href="https://verif.rap.ucar.edu/jntweb/hurricanes-beta/about/">About</a>
`;
const idx = parseTcgpIndex(page);
ok(idx.length === 2, 'two storms kept from a page listing three plus furniture');
ok(!idx.some((s) => s.basin === 'ep'),
   'EAST PACIFIC DROPPED - NOAA owns that basin and two sources may not disagree');
ok(idx.filter((s) => s.id === 'wp112026').length === 1, 'the storm linked twice appears once');
ok(idx.find((s) => s.id === 'wp112026').name === 'ELEVEN',
   'the real decayed label parses - and is NOT used as the key');

/* b-deck: history file, oldest first, so the LAST parseable row is the fix. */
const bdeck = [
  'WP, 11, 2026072600, , BEST,   0, 229N, 1145E,  75,  976, TY,',
  'WP, 11, 2026072606, , BEST,   0, 238N, 1140E,  45,  990, TS,',
  'WP, 11, 2026072618, , BEST,   0, 251N, 1142E,  20, 1000, TD,',
  '',
].join('\n');
const fix = lastFixFromBdeck(bdeck);
ok(fix.lat === 25.1 && fix.lon === 114.2, 'last row wins, tenths of a degree, E is positive');
ok(fix.at === '2026072618', 'and it carries its own analysis time');
ok(lastFixFromBdeck('garbage\nnot,a,deck') === null, 'junk yields null, never a guessed position');

/* THE CASE BOTH NAME JOINS FAILED. GDACS still says NOUL-26; TCGP says
 * ELEVEN. The positions agree, so the storms are the same storm. */
const listed = [{ id: 'wp112026', name: 'ELEVEN', basin: 'wp', lat: 25.1, lon: 114.2 }];
ok(matchDeckByPosition(listed, { name: 'NOUL-26', lat: 24.8, lon: 114.6 })?.id === 'wp112026',
   'NOUL-26 matches ELEVEN by position, with no name in common at all');
ok(matchDeckByPosition(listed, { name: 'NOUL-26', lat: 10.0, lon: 150.0 }) === null,
   'a storm on the other side of the basin does not match');
ok(matchDeckByPosition(listed, { name: 'NOUL-26' }) === null,
   'a storm with no position is unmatchable rather than matched to the only candidate');
ok(matchDeckByPosition([{ id: 'wp112026', lat: null, lon: null }],
   { lat: 25, lon: 114 }) === null, 'a deck whose b-deck failed to load is skipped, not guessed');

/* REFUSES rather than picking the nearer one: a confident five-day forecast
 * drawn for the wrong cyclone is the worst thing this layer can do. */
const twoClose = [
  { id: 'wp112026', lat: 25.1, lon: 114.2 },
  { id: 'wp122026', lat: 25.4, lon: 114.9 },
];
ok(matchDeckByPosition(twoClose, { lat: 25.1, lon: 114.2 }) === null,
   'two candidates inside the radius REFUSE - never guess between two storms');

/* --- the picker's grouping ------------------------------------------------
 * Pure config, so it is testable without a browser — which matters because
 * the visual half of this control cannot be checked anywhere but glass. What
 * CAN be pinned here is which rows land in which group and when the headers
 * appear, and those decide whether a user sees four controls that silently do
 * nothing to the storm in front of them.
 * ------------------------------------------------------------------------ */
section('model picker grouping');
const L = await import('../config/layers.js');

const nhcOnly = L.modelSelectorGroups(new Set(['nhc']));
ok(nhcOnly.length === 1, 'one family up -> one block');
ok(nhcOnly[0].showHeader === false,
   'NO HEADER over the only group - same rule the storm list uses for basins');
ok(nhcOnly[0].groups.flatMap((g) => g.rows).length === 4,
   'and the four NHC prefs, exactly as before TCGP existed');

const globalOnly = L.modelSelectorGroups(new Set(['global']));
ok(globalOnly.length === 1 && globalOnly[0].showHeader === false, 'same for a typhoon alone');
const gRows = globalOnly[0].groups.flatMap((g) => g.rows);
ok(gRows.length === 3, 'three ensemble means');
ok(gRows.map((r) => r.label).join(',') === 'GEFS,NAVGEM,GEPS',
   'labelled with the abbreviations, in deck order');
ok(gRows.every((r) => !/accurate|best|reliable/i.test(r.sub || '')),
   'NO ACCURACY CLAIM on any of them - no verification source was found');

const both = L.modelSelectorGroups(new Set(['nhc', 'global']));
ok(both.length === 2, 'a hurricane and a typhoon -> two blocks');
ok(both.every((f) => f.showHeader === true),
   'HEADERS APPEAR, because now four of the seven rows do nothing to either storm');
ok(both.every((f) => !f.note),
   'headers carry a LABEL ONLY - the coverage sentence was cut and stays cut');

/* A selector that vanishes reads as a broken panel, and an empty control is
 * exactly what a naive filter produces in the moment before the first feed
 * lands. Absence must never be silent. */
ok(L.modelSelectorGroups(new Set()).length === 2, 'no storms yet -> show everything, not nothing');
ok(L.modelSelectorGroups(null).length === 2, 'and the same for an unknown caller');
ok(L.modelSelectorGroups(new Set(['nonsense'])).length === 2,
   'an unrecognised family falls back to everything rather than emptying');

/* --- per-model selection state -------------------------------------------- */
section('per-model selection');
const P = await import('../data/layer-prefs.js');
ok(P.toggleOn('modelTracks') === false, 'the layer ships OFF');
ok(P.modelsOnCount() === 7, 'every model starts selected — the spread is the point');
ok(P.modelsOnInFamily('nhc') === 4, 'four NHC prefs (TVCN and HCCA share one)');
ok(P.modelsOnInFamily('global') === 3, 'three TCGP ensemble means');
ok(P.modelOn('avno') === false, 'modelOn stays false while the parent layer is off');
ok(P.isDefault() === true, 'a fresh state compares equal to defaults');

P.setToggle('modelTracks', true);
ok(P.modelOn('avno') === true, 'models draw once the layer is on');
ok(P.setModel('avno', false) === true, 'a model can be switched off');
P.setModel('ukx', false);
P.setModel('hfsa', false);
ok(P.setModel('consensus', false) === false,
   'REFUSES to switch off the last model — a layer on with nothing drawn is silence');
ok(P.modelsOnInFamily('nhc') === 1, 'and the refusal actually holds');

/* THE REFUSAL IS PER FAMILY. The Pacific set is untouched and fully on, so a
 * global counter would have allowed the NHC set to empty completely — a layer
 * drawing nothing on an Atlantic hurricane while reporting itself healthy.
 * This is the assertion that caught it. */
ok(P.modelsOnInFamily('global') === 3, 'the other family is untouched by all that');
ok(P.setModel('aemn', false) === true, 'and its own models still switch off freely');
P.setModel('nemn', false);
ok(P.setModel('cemn', false) === false, 'until IT reaches its own last model');
ok(P.modelsOnInFamily('global') === 1, 'which is refused independently');

ok(P.setModel('nonsense', true) === false, 'an unknown model is refused');

P.resetLayers();
ok(P.modelsOnCount() === 7 && P.toggleOn('modelTracks') === false, 'reset restores both levels');
ok(P.isDefault() === true, 'and the reset control disables itself again');

P.setToggle('modelTracks', true);
P.setModel('ukx', false);
ok(JSON.parse(mem.get('landfall.layers')).models.ukx === false,
   'model state persists nested inside the layer record');
ok(mem.get('landfall.models') === undefined, 'there is NO separate models storage key');

mem.set('landfall.layers', JSON.stringify({
  modelTracks: true,
  models: { avno: false, ukx: 'yes', ghost: true },
}));
const P2 = await import('../data/layer-prefs.js?reload=1');
ok(P2.modelChecked('avno') === false, 'a valid stored value is honoured');
ok(P2.modelChecked('ukx') === true, 'a non-boolean is rejected and falls back to the default');
ok(P2.modelChecked('ghost') === false, 'a model no longer in the shortlist is dropped, not carried');

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (synthetic fixtures — they cannot tell you the layer looks right on glass)');
