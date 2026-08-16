#!/usr/bin/env node
/**
 * test-relay-mirrors.mjs — the app's config and the relay's hand-copies must agree.
 *
 * WHY THIS EXISTS. A Pages Function runs in its own workerd runtime and cannot
 * import `config/constants.js` (§3 — that would couple a static deploy to a
 * bundler step this project must never have). So six facts are written down
 * TWICE, by hand, on opposite sides of a wire: the model codes the relay keeps,
 * the satellite endpoints it forwards to, the geocode limits it enforces, and
 * four cache lifetimes.
 *
 * ===> EVERY ONE OF THESE DRIFTS SILENTLY, AND THE APP LOOKS HEALTHY WHILE IT
 * DOES. <=== The routes say so themselves, in their own headers. Add a model to
 * `MODEL_TRACKS.techs` and not to `KEEP_TECHS`, and the app asks for guidance
 * the relay has already thrown away: the request 200s, the row draws nothing,
 * nothing errors anywhere. Repoint a satellite in `SATELLITES` and not in
 * `BIRDS`, and that bird 400s upstream while three others keep working. Both
 * are §5 silent failures — the exact class this project treats as the worst
 * kind, because no amount of "does the app work" testing finds them.
 *
 * The project already knows the shape of the answer. `tools/test-kv-keys.mjs`
 * exists for the identical reason on the KV side, and its rule is quoted from
 * `test-advisory.mjs`: a copy nobody checks is how the two drift; a copy with a
 * test that fails when they disagree is just a copy. Same rule, same remedy,
 * applied to the four mirrors that had no guard at all.
 *
 * HOW IT READS THE RELAY SIDE. By parsing the route's source text, not by
 * importing it. Importing a Pages Function module works today and stops working
 * the moment it touches a Workers global — and the string in the file IS the
 * contract, so read the string.
 *
 * WHAT THIS DOES NOT COVER: whether GIBS still serves that layer name, or
 * whether NHC still publishes that model. Those need the network. This is a
 * contract test between two files.
 *
 * Zero dependencies (§12).
 *
 * Run: node tools/test-relay-mirrors.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { MODEL_TRACKS, SATELLITES, GEOCODE, CACHE } from '../config/constants.js';
import { MODEL_FAMILY } from '../config/constants.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`  ✗ ${label}\n      config says  ${e}\n      relay says   ${a}`);
};

/** The contents of a `new Set([...])` literal assigned to `name`, as an array
 *  in source order. Deliberately narrow: it matches the one form the routes
 *  actually use, and returns null rather than guessing if that form changes. */
function setLiteral(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`));
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** A `const NAME = <number expression>;` evaluated. Handles `15 * 60`. */
function numberConst(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([0-9*+ ]+);`));
  if (!m) return null;
  return m[1].split('*').map((n) => Number(n.trim())).reduce((a, b) => a * b, 1);
}

/* ---------------------------------------------------------------------------
 * 1. MODEL CODES — two decks, two routes, one shortlist.
 *
 * `MODEL_TRACKS.techs` is one list carrying both families; `family` is what
 * splits it. The NHC route keeps the NHC-family codes, the TCGP route keeps the
 * global-family ones, and neither may keep a code the app does not draw — an
 * extra code there is bytes forwarded to every client for a row nothing renders.
 * ORDER IS NOT CHECKED: the routes filter with a Set, so order carries no
 * meaning on that side. Membership is the contract.
 * ------------------------------------------------------------------------- */

const techsFor = (family) =>
  MODEL_TRACKS.techs.filter((t) => t.family === family).map((t) => t.tech).sort();

const sorted = (list) => (list ? [...list].sort() : list);

check('functions/api/nhc/adeck.js KEEP_TECHS mirrors the NHC-family techs',
  sorted(setLiteral(read('functions/api/nhc/adeck.js'), 'KEEP_TECHS')),
  techsFor(MODEL_FAMILY.NHC));

check('functions/api/tcgp/adeck.js KEEP_TECHS mirrors the global-family techs',
  sorted(setLiteral(read('functions/api/tcgp/adeck.js'), 'KEEP_TECHS')),
  techsFor(MODEL_FAMILY.GLOBAL));

/* ---------------------------------------------------------------------------
 * 2. SATELLITES — id, endpoint, layer and WMS version, all four.
 *
 * The relay's `BIRDS` table is also the ALLOWLIST — the endpoint is never a
 * caller-supplied parameter, or the route is an open proxy. So a bird missing
 * from it is not merely a drifted copy: it is a request the relay refuses. The
 * client table carries more (longitude ownership, enhancement, grey anchors);
 * only these four fields cross the wire and only these four are checked.
 * ------------------------------------------------------------------------- */

const satSrc = read('functions/api/imagery/satellite.js');
const birdsBlock = satSrc.slice(satSrc.indexOf('const BIRDS = {'), satSrc.indexOf('\n};', satSrc.indexOf('const BIRDS = {')));

const relayBirds = {};
for (const m of birdsBlock.matchAll(/['"]?([a-z0-9-]+)['"]?:\s*\{([^}]*)\}/g)) {
  const body = m[2];
  const field = (n) => (body.match(new RegExp(`${n}:\\s*['"]([^'"]+)['"]`)) || [])[1];
  relayBirds[m[1]] = { endpoint: field('endpoint'), layer: field('layer'), wms: field('wms') };
}

const configBirds = {};
for (const s of SATELLITES) configBirds[s.id] = { endpoint: s.endpoint, layer: s.layer, wms: s.wms };

check('functions/api/imagery/satellite.js BIRDS covers exactly the SATELLITES ids',
  Object.keys(relayBirds).sort(), Object.keys(configBirds).sort());

for (const id of Object.keys(configBirds)) {
  check(`BIRDS['${id}'] endpoint/layer/wms match SATELLITES`,
    relayBirds[id], configBirds[id]);
}

/* ---------------------------------------------------------------------------
 * 3. GEOCODE limits — the server enforces them because anyone can call it.
 *
 * The client's debounce is a cost control; the route's copy is the real bound.
 * If `minChars` rises in config and not here, the route answers two-character
 * queries the app will never send — free money spent for nobody.
 * ------------------------------------------------------------------------- */

const geoSrc = read('functions/api/geocode.js');
check('functions/api/geocode.js MAX_RESULTS mirrors GEOCODE.maxResults',
  numberConst(geoSrc, 'MAX_RESULTS'), GEOCODE.maxResults);
check('functions/api/geocode.js MIN_CHARS mirrors GEOCODE.minChars',
  numberConst(geoSrc, 'MIN_CHARS'), GEOCODE.minChars);

/* ---------------------------------------------------------------------------
 * 4. CACHE LIFETIMES — milliseconds in the app, SECONDS at the edge.
 *
 * ==> THE UNITS DIFFER AND THAT IS THE WHOLE HAZARD. <== The app polls on
 * `CACHE.adeckFresh` in ms; the route sets `s-maxage` in seconds. Written down
 * separately in two units, a change to one is invisible in the other, and the
 * failure is not an error — it is the client polling faster than the edge
 * refreshes, so every other request is served the same bytes it already had,
 * or slower, so the edge holds data the client has already given up on.
 *
 * Only the pairs the routes THEMSELVES claim to match are checked. The rest of
 * the `FRESH_SECONDS` constants have no config counterpart and are the route's
 * own business; asserting an accidental equality would invent a contract.
 * ------------------------------------------------------------------------- */

const ms = (seconds) => seconds * 1000;

check('nhc/adeck.js FRESH_SECONDS matches CACHE.adeckFresh',
  ms(numberConst(read('functions/api/nhc/adeck.js'), 'FRESH_SECONDS')), CACHE.adeckFresh);

check('tcgp/adeck.js FRESH_SECONDS matches CACHE.adeckFresh',
  ms(numberConst(read('functions/api/tcgp/adeck.js'), 'FRESH_SECONDS')), CACHE.adeckFresh);

check('nhc/genesis.js FRESH_SECONDS matches CACHE.genesisFresh',
  ms(numberConst(read('functions/api/nhc/genesis.js'), 'FRESH_SECONDS')), CACHE.genesisFresh);

check('nhc/outlook.js FRESH_SECONDS matches CACHE.outlookFresh',
  ms(numberConst(read('functions/api/nhc/outlook.js'), 'FRESH_SECONDS')), CACHE.outlookFresh);

check('jtwc/abpw.js FRESH_SECONDS matches CACHE.abpwFresh',
  ms(numberConst(read('functions/api/jtwc/abpw.js'), 'FRESH_SECONDS')), CACHE.abpwFresh);

check('nhc/mapserver.js EMPTY_FRESH_SECONDS matches CACHE.geometryRetryMs',
  ms(numberConst(read('functions/api/nhc/mapserver.js'), 'EMPTY_FRESH_SECONDS')), CACHE.geometryRetryMs);

/* ---------------------------------------------------------------------------
 * 5. THE PARSERS THEMSELVES — a check that reads nothing reports nothing.
 *
 * Every extractor above returns null when the source no longer matches the form
 * it expects. A null compared against a null passes, which would turn this
 * whole suite into a green light for a file it can no longer read. So assert
 * that each one found something.
 * ------------------------------------------------------------------------- */

const found = {
  'nhc KEEP_TECHS': setLiteral(read('functions/api/nhc/adeck.js'), 'KEEP_TECHS'),
  'tcgp KEEP_TECHS': setLiteral(read('functions/api/tcgp/adeck.js'), 'KEEP_TECHS'),
  'BIRDS table': Object.keys(relayBirds).length ? relayBirds : null,
  'geocode MAX_RESULTS': numberConst(geoSrc, 'MAX_RESULTS'),
  'mapserver EMPTY_FRESH_SECONDS': numberConst(read('functions/api/nhc/mapserver.js'), 'EMPTY_FRESH_SECONDS'),
};
for (const [label, value] of Object.entries(found)) {
  if (value !== null && value !== undefined) continue;
  failures++;
  console.error(`  ✗ could not read ${label} out of the route source — this suite is blind, not passing`);
}

/* ------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n${failures} mirror(s) out of sync. The app and the relay disagree, and neither will say so at runtime.\n`);
  process.exit(1);
}
console.log('✓ relay mirrors hold: 6 hand-copied facts, config and relay agree');
