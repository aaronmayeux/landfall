#!/usr/bin/env node
/**
 * test-coastal-paint.mjs — the two new coastal stripes actually reach the map,
 * and a routine engine push does not re-read the basemap. §50.11, §51.4.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * Both layers shipped on 2026-08-19 unable to paint one metre of coast, and
 * every suite passed the whole time.
 *
 *   `cap-coast.js` handed `areaSelect()` the WRAPPER `coastRings()` returns —
 *   `{schema, rings, vertexCount}` — where the rings ARRAY was wanted. Reading
 *   `.length` off an object gives `undefined`, so every call took the
 *   `no-coastline` exit.
 *
 *   `gdacs-surge-coast.js` did that AND handed a single ring where a LIST of
 *   rings was wanted, so every element the filter looked at was a `[lon, lat]`
 *   pair of length two, all were discarded as too short, and every call took
 *   the `degenerate-area` exit.
 *
 * `tools/test-cap.mjs` calls `areaSelect` directly, with the right shapes, and
 * proves it works. That is a test agreeing with the bug: it asserts the
 * function is correct, which it was, and never asks whether the caller speaks
 * to it correctly. The only question that catches this is the one below — run
 * the REAL layer through the REAL engine and ask whether anything landed on
 * the map.
 *
 * ===========================================================================
 * AND THE SECOND HALF IS ABOUT COST, WHICH IS ALSO CORRECTNESS HERE
 * ===========================================================================
 *
 * `coastRings()` decodes every loaded basemap tile on the main thread. Both
 * layers' first memo was keyed on `coastGeneration()`, which bumps on every
 * basemap `sourcedata` — continuously, while tiles stream — so the memo never
 * hit, and the layer engine's routine pushes each paid a full decode. Field
 * telemetry, one four-minute Windows visit: 421 blocked-thread events totalling
 * 38.7 seconds, against four to fifteen on the same laptop the day before.
 *
 * So this counts `querySourceFeatures` calls. A repeat push with the same data
 * must cost ZERO of them; a settled camera must cost one. That is the whole
 * contract, and asserting the count is the only way it stays true — the fast
 * version and the slow version paint identical pixels.
 *
 * MUTATION-CHECKED 2026-08-19. Each assertion below was confirmed to FAIL with
 * the corresponding line reverted:
 *   - `coastRings(map)` in place of `{ rings }`      -> paint assertions fail
 *   - `ringAround(...)` in place of `[ringAround(...)]` -> surge paint fails
 *   - `memo = null` restored in `update()`           -> decode-count fails
 *   - `repaint(map)` in place of `repaint(map, true)` on moveend -> fails
 *
 * Zero dependencies. Run: node tools/test-coastal-paint.mjs
 */

import path from 'node:path';
process.chdir(path.resolve(import.meta.dirname, '..'));

let pass = 0;
const failures = [];
const ok = (cond, msg) => { cond ? pass++ : failures.push(msg); };
const section = (n) => console.log(`\n  ${n}`);

/* ---------------------------------------------------------------------------
 * THE FIXTURES
 *
 * A north-south shoreline at 121.0E running through the latitudes Luzon
 * occupies, quantized finely enough to look like real decoded tile geometry.
 * The alert area and the surge town both sit on it.
 * ------------------------------------------------------------------------ */

const COAST = [];
for (let i = 0; i <= 400; i++) {
  COAST.push([121 + Math.sin(i / 30) * 0.02, 13 + i * 0.005]);
}

/** One CAP alert area: a box over the shoreline's southern half. */
const ALERT_RINGS = [[[120.8, 13.2], [121.3, 13.2], [121.3, 14.2], [120.8, 14.2], [120.8, 13.2]]];

/** ArcGIS attribute names, because that is what `readAlerts()` parses — the
 *  normalized object is built INSIDE the code under test and a fixture in the
 *  normalized shape would skip the half of the pipeline this is about. */
const ALERT_ATTRS = {
  OBJECTID: 7001,
  senderName: 'PAGASA',
  event: 'Tropical Cyclone Wind Signal',
  headline: 'Wind Signal No. 3 raised over Quezon',
  severity: 'Severe',
  status: 'Actual',
  msgType: 'Alert',
  countryCode: 'PH',
  sent: Date.now() - 3600e3,
  expires: Date.now() + 6 * 3600e3,
};

/** One surge town, on the shoreline, deep enough to earn a colour. */
const TOWN = { city: 'Infanta', country: 'Philippines', lat: 14.75, lon: 121.02, heightM: 1.4 };

/* ---------------------------------------------------------------------------
 * THE NETWORK, ANSWERED IN MEMORY
 *
 * Stubbed at `globalThis.fetch` rather than by injecting a seam into the data
 * modules: the layers reach their own data (that is the documented shape of
 * both of them), so a seam would be a hole cut for the test to climb through.
 * ------------------------------------------------------------------------ */

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/cap/shapes')) {
    return jsonResponse({ features: [{ id: ALERT_ATTRS.OBJECTID, rings: ALERT_RINGS }] });
  }
  if (u.includes('/cap/alerts')) {
    return jsonResponse({ features: [{ attributes: ALERT_ATTRS }] });
  }
  if (u.includes('/gdacs/surge')) {
    return jsonResponse({ status: 'ok', places: [TOWN] });
  }
  throw new Error(`unexpected fetch in test: ${u}`);
};

/* ---------------------------------------------------------------------------
 * THE STUB MAP
 *
 * `querySourceFeatures` is the expensive call. It is COUNTED, because the
 * second half of this suite is entirely about how often it runs.
 * ------------------------------------------------------------------------ */

function stubMap() {
  const sources = new Map();
  const layers = new Map();
  const handlers = new Map();
  const map = {
    decodes: 0,
    sources,
    layers,
    getSource: (id) => sources.get(id),
    addSource: (id) => sources.set(id, {
      data: { type: 'FeatureCollection', features: [] },
      setData(fc) { this.data = fc; },
    }),
    getLayer: (id) => layers.get(id),
    addLayer: (l) => layers.set(l.id, { ...l, visibility: 'visible' }),
    setLayoutProperty: (id, _prop, value) => {
      const l = layers.get(id);
      if (l) l.visibility = value;
    },
    on: (evt, fn) => {
      if (!handlers.has(evt)) handlers.set(evt, []);
      handlers.get(evt).push(fn);
    },
    emit: (evt, e) => { for (const fn of handlers.get(evt) || []) fn(e); },
    querySourceFeatures: (_src, opts) => {
      /* The OpenMapTiles branch of map/coast-source.js is the live one; the
       * Protomaps branch must miss, exactly as it does against OpenFreeMap. */
      if (opts?.sourceLayer !== 'water') return [];
      map.decodes++;
      return [{ geometry: { type: 'LineString', coordinates: COAST } }];
    },
  };
  return map;
}

const featureCount = (map, id) => map.getSource(id)?.data?.features?.length ?? 0;

/** ==> TILES STREAMING, WHICH IS THE WHOLE REASON THE FIRST MEMO FAILED. <==
 *  `map/coast-source.js` bumps its generation counter on every basemap
 *  `sourcedata`, and a live map fires that continuously. A stub that never
 *  fires it would let coast-source's own per-generation memo absorb every
 *  repeat call, and this suite would pass with the bug fully present. */
const tiles = (map) => map.emit('sourcedata', { sourceId: 'basemap' });

/* The layers' moveend handlers are debounced on COAST_BAND.reselectDebounceMs;
 * this waits past it so a settled camera actually re-selects. */
const { COAST_BAND } = await import('../config/constants.js');
const settle = () => new Promise((r) => setTimeout(r, COAST_BAND.reselectDebounceMs + 40));
/* Long enough for loadAlerts -> loadShapes, which is two awaited stub fetches
 * plus the microtasks between them. */
const landed = () => new Promise((r) => setTimeout(r, 30));

await import('../map/layers/cap-coast.js');
await import('../map/layers/gdacs-surge-coast.js');
const { createLayerEngine } = await import('../map/layers/registry.js');

/** A GDACS storm — both layers need the event id (§50.3, §51.5). */
const storm = {
  id: 'gdacs-1001303',
  /* `gdacsEventIdOf` reads `source` and `sourceId`; `stormCountries` reads
   * `raw.countries[].iso2`.
   *
   * ==> THE COMMENT HERE USED TO CLAIM THESE WERE "CHECKED AGAINST
   * data/gdacs.js RATHER THAN INVENTED FOR THE FIXTURE", AND THE COUNTRY ONE
   * WAS INVENTED. <== It sat at the top level, where `data/gdacs.js` has never
   * put it, and matched `lib/cap.js`'s own wrong path — so the eight
   * assertions below passed against a stripe that had never painted. A comment
   * asserting a fact nobody checked is worse than no comment: it stops the
   * next reader checking too.
   *
   * The CAP coastal stripe was therefore dark for the same reason the alert
   * rows were, and `raw` is the shape the normalizer really builds. */
  source: 'gdacs',
  sourceId: '1001303',
  name: 'Lala',
  raw: { countries: [{ iso2: 'PH', countryname: 'Philippines' }] },
};

/* ===========================================================================
 * 1. THE STRIPES REACH THE MAP
 * ======================================================================== */

section('the foreign-warning stripe paints');

const map = stubMap();
const engine = createLayerEngine(map);
engine.attach();
engine.setBundle(storm, { layers: {} });
await landed();

ok(featureCount(map, 'sel-cap') > 0,
  'a CAP alert with an area over loaded coastline must put a feature on the map');

const capFeature = map.getSource('sel-cap')?.data?.features?.[0];
ok(capFeature?.geometry?.type === 'MultiLineString',
  'the painted CAP feature is coast runs, not the country outline');
ok((capFeature?.geometry?.coordinates?.[0]?.length ?? 0) >= 2,
  'a painted run is at least two coastline vertices');
ok(capFeature?.properties?._banded === true,
  'the CAP feature draws through the banded filter lineLayers() uses');
ok(capFeature?.properties?._capAgency === 'PAGASA',
  'the painted feature carries the issuing agency');

section('the modelled-surge stripe paints');

/* It joins the coastal pair's SURGE segment, which is not the default. */
for (const d of [null]) void d;
engine.setPair?.('coastal', 'surge');
await landed();

ok(featureCount(map, 'sel-gdacs-surge') > 0,
  'a surge town on loaded coastline must put a feature on the map');

const surgeFeature = map.getSource('sel-gdacs-surge')?.data?.features?.[0];
ok(surgeFeature?.geometry?.type === 'MultiLineString',
  'the painted surge feature is coast runs, not the point');
ok(surgeFeature?.properties?._surgeCity === 'Infanta',
  'the painted feature names the town it came from');

/* ===========================================================================
 * 2. A ROUTINE PUSH IS FREE; A SETTLED CAMERA IS NOT
 * ======================================================================== */

section('repeat engine pushes do not re-read the basemap');

const before = map.decodes;
ok(before > 0, 'the first paint did read the basemap — otherwise nothing below means anything');

for (let i = 0; i < 20; i++) {
  tiles(map);
  engine.setBundle(storm, { layers: {} });
  await landed();
}

ok(map.decodes === before,
  `twenty engine pushes with the same alerts and towns must cost zero basemap ` +
  `decodes, even with tiles streaming throughout (was ${before}, now ${map.decodes})`);

ok(featureCount(map, 'sel-gdacs-surge') > 0,
  'and the stripe is still on the map afterwards — a memo that goes silent is ' +
  'not a saving');

section('a settled camera does look again');

const beforeMove = map.decodes;
tiles(map);
map.emit('moveend', {});
await settle();

ok(map.decodes > beforeMove,
  'moveend must re-select, because that is how coastline loaded since the ' +
  'last look reaches the stripe');

section('the same is true of the foreign-warning stripe');

/* ==> THE SECTION ABOVE COVERS ONE LAYER, NOT BOTH, AND THAT WAS FOUND BY
 * MUTATION RATHER THAN BY READING. <== The pair is on SURGE by then, so
 * `cap-coast.js` is drawing off and its `repaint` returns an empty collection
 * without ever consulting its memo. Breaking that memo deliberately left this
 * suite green. The two layers hold separate module state and must each be
 * asked, so the pair goes back to watch/warning and the count is taken again. */
engine.setPair?.('coastal', 'watchWarning');
await landed();

ok(featureCount(map, 'sel-cap') > 0,
  'the CAP stripe is back on the map, so the count below means something');

const beforeCap = map.decodes;
for (let i = 0; i < 20; i++) {
  tiles(map);
  engine.setBundle(storm, { layers: {} });
  await landed();
}

ok(map.decodes === beforeCap,
  `twenty engine pushes with the same alerts must cost zero basemap decodes ` +
  `on the CAP stripe too (was ${beforeCap}, now ${map.decodes})`);

ok(featureCount(map, 'sel-cap') > 0,
  'and the CAP stripe survived them — a memo that goes silent is not a saving');

section('a select that saw no coastline is not held');

/* Nothing loaded — the honest §5 case. The next push must try again rather
 * than serve an empty stripe over a warned coast for the rest of the visit. */
const bare = stubMap();
bare.querySourceFeatures = (_src, opts) => {
  if (opts?.sourceLayer !== 'water') return [];
  bare.decodes++;
  return [];
};
const bareEngine = createLayerEngine(bare);
bareEngine.attach();
/* ==> THE HELD SELECT IS MODULE STATE, NOT PER-MAP. <== One map per session in
 * the app, so this is only ever a test concern — but without the clear, the
 * good map's result above would answer for this one and the assertion below
 * would pass on the wrong evidence. `clearSelection` is the app's own way to
 * drop it, so this uses that rather than reaching into the module. */
bareEngine.clearSelection();
bareEngine.setBundle(storm, { layers: {} });
await landed();
const bareFirst = bare.decodes;
tiles(bare);
bareEngine.setBundle(storm, { layers: {} });
await landed();

ok(bareFirst > 0 && bare.decodes > bareFirst,
  'with no coastline loaded, a repeat push must look again rather than cache ' +
  'an empty stripe');
ok(featureCount(bare, 'sel-cap') === 0,
  'and it paints nothing meanwhile, rather than approximating the coast');

/* ------------------------------------------------------------------------ */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
