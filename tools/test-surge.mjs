/**
 * test-surge.mjs — peak storm surge normalization, against the real bytes.
 *
 * Runs on plain node, no dependencies, no browser:  node tools/test-surge.mjs
 *
 * ==> IT ASSERTS AGAINST THE ARCHIVE, NOT AGAINST A FIXTURE WE INVENTED. <==
 * Every expectation below was read out of Hurricane Milton's 22 published
 * advisories in `samples/milton-al142024/surge/`. Where a number appears it is
 * a count of NHC's own features, not a round figure that looked plausible.
 *
 * ==> AND IT PINS THE BUG THAT MOTIVATED THE WHOLE MODULE. <== SPEC-DATA.md
 * §4.8 said `symbolid` carries the colour class; the live service declares it
 * an integer. The HA project searched that integer for the substring "blue",
 * never matched, and silently coloured bands by ARRIVAL ORDER. The last group
 * here fails if anything ever resolves a severity from `symbolid` again.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSurge } from '../data/surge.js';
import { SURGE } from '../config/constants.js';
import { SURGE_RAMP } from '../config/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'samples/milton-al142024/surge');

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const load = (adv) => JSON.parse(fs.readFileSync(path.join(DIR, adv, 'peaksurge.geojson'), 'utf8'));

/* ---- the fixture itself ---------------------------------------------------- */

eq('fixture holds 22 advisories', index.advisories.length, 22);
eq('fixture records its tolerance', index.simplifiedToleranceDeg, SURGE.offsetDeg);
ok('fixture and app simplify at the same tolerance',
   index.simplifiedToleranceDeg === SURGE.offsetDeg,
   'a fixture generalized differently from production is prettier than production');

/* ---- normalization of the fixture path ------------------------------------- */

for (const row of index.advisories) {
  const { fc, dropped } = normalizeSurge(load(row.advisory), { fromFixture: true });
  eq(`adv ${row.advisory}: nothing dropped`, dropped, 0);
  eq(`adv ${row.advisory}: polygon count`,
     fc.features.filter((f) => f.properties.kind === 'polygon').length, row.polygons);
  eq(`adv ${row.advisory}: line count`,
     fc.features.filter((f) => f.properties.kind === 'line').length, row.lines);

  for (const f of fc.features) {
    ok(`adv ${row.advisory}: colour is one of the five`,
       SURGE.colors.includes(f.properties.color), String(f.properties.color));
    eq(`adv ${row.advisory}: severity matches colour`,
       f.properties.severity, SURGE.colors.indexOf(f.properties.color));
    ok(`adv ${row.advisory}: place is not a depth`,
       !/\d\s*-\s*\d+\s*ft/i.test(String(f.properties.place || '')),
       `place read as "${f.properties.place}"`);
  }
}

/* ==> SURGE IS NOT BANDS ONLY. <== Every plan before the archive was read
 * assumed polygons. If a future change filters lines out, this goes red. */
{
  const { fc } = normalizeSurge(load('017'), { fromFixture: true });
  const lines = fc.features.filter((f) => f.properties.kind === 'line');
  ok('advisory 017 carries coastal reaches, not just bands', lines.length === 13,
      `got ${lines.length} lines`);
  ok('a reach carries its own depth', lines.every((f) => f.properties.range),
      'a line with no range is a coast told nothing');
}

/* Milton's worst: 10-15 ft into Tampa Bay, purple, at advisory 017. If this
 * ever stops being true the fixture changed under us. */
{
  const { fc } = normalizeSurge(load('017'), { fromFixture: true });
  const tampa = fc.features.find((f) => f.properties.place === 'Tampa Bay');
  ok('Tampa Bay is present at advisory 017', !!tampa);
  eq('Tampa Bay is purple', tampa?.properties.color, 'purple');
  eq('Tampa Bay severity is 4', tampa?.properties.severity, 4);
  eq('Tampa Bay range is NHC\'s own words', tampa?.properties.range, '10-15 ft');
}

/* ---- the ramp and the data agree ------------------------------------------- */

eq('ramp has one entry per colour', SURGE_RAMP.length, SURGE.colors.length);
ok('every colour in the archive has a ramp entry',
   SURGE.colors.every((_, i) => typeof SURGE_RAMP[i]?.color === 'string'));

/* ==> THE COLOUR IS A BUCKET, NOT THE DEPTH. <== The ramp labels red "Up to
 * 12 ft"; the archive publishes 5-10, 6-10 AND 8-12 ft as red. This asserts
 * the disagreement is real, so nobody "fixes" it by rewriting NHC's range to
 * match a legend rung. */
{
  const seen = new Map();
  for (const row of index.advisories) {
    const { fc } = normalizeSurge(load(row.advisory), { fromFixture: true });
    for (const f of fc.features) {
      if (!seen.has(f.properties.color)) seen.set(f.properties.color, new Set());
      seen.get(f.properties.color).add(f.properties.range);
    }
  }
  ok('red carries more than one published range',
     (seen.get('red')?.size || 0) > 1,
     `red ranges: ${[...(seen.get('red') || [])].join(', ')}`);
  ok('all five colours appear somewhere in the archive',
     SURGE.colors.every((c) => seen.has(c)),
     `missing: ${SURGE.colors.filter((c) => !seen.has(c)).join(', ')}`);
}

/* ---- the live path, and the trap it must not fall into --------------------- */

{
  /* Shaped like the live service: popupinfo carries the description JSON, and
   * `symbolid` is an INTEGER that must never be read as a colour. */
  const live = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: 'Tampa Bay...8-12 ft',
        symbolid: 3,
        popupinfo: '{"peak_surge_range": "8-12 ft", "color": "red"}',
      },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }],
  };
  const { fc, via } = normalizeSurge(live, { fromFixture: false });
  eq('live: one feature normalized', fc.features.length, 1);
  eq('live: colour read from popupinfo', via, 'popupinfo.json');
  eq('live: severity is red\'s', fc.features[0].properties.severity, 3);
  eq('live: range preserved verbatim', fc.features[0].properties.range, '8-12 ft');
  eq('live: place stripped of its depth', fc.features[0].properties.place, 'Tampa Bay');
}

{
  /* ==> THE HA BUG, PINNED. <== A feature whose ONLY severity hint is an
   * integer `symbolid` must yield nothing — not a default colour, and above
   * all not a colour derived from its position in the list. */
  const trap = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Somewhere...5-10 ft', symbolid: 4 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: 'Feature', properties: { name: 'Elsewhere...1-3 ft', symbolid: 0 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ],
  };
  const { fc, dropped } = normalizeSurge(trap, { fromFixture: false });
  eq('symbolid alone yields no features', fc.features.length, 0);
  eq('and they are counted as dropped, not silently missing', dropped, 2);
}

{
  /* A colour word in a plain string still resolves — that is the loose path,
   * and it must stay LAST so a place called "Blue Hill Bay" cannot beat a
   * structured field. */
  const loose = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'Blue Hill Bay...1-3 ft', snippet: 'Peak surge 1-3 ft (blue)' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }],
  };
  const { fc, via } = normalizeSurge(loose, { fromFixture: false });
  eq('loose match resolves a colour', fc.features[0]?.properties.color, 'blue');
  eq('and reports which field answered', via, 'snippet.text');
  eq('a LineString normalizes as a reach', fc.features[0]?.properties.kind, 'line');
}

{
  const { fc, dropped } = normalizeSurge({ type: 'FeatureCollection', features: [] });
  eq('empty in, empty out', fc.features.length, 0);
  eq('and nothing claimed dropped', dropped, 0);
}

/* ---------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n✗ test-surge: ${failures.length} failed, ${pass} passed\n`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  if (failures.length > 30) console.error(`  …and ${failures.length - 30} more`);
  process.exit(1);
}
console.log(`✓ test-surge: ${pass} assertions against Milton's published bytes`);
