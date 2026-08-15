#!/usr/bin/env node
/**
 * test-kv-keys.mjs — the writer and the readers must agree on every KV key.
 *
 * WHY THIS EXISTS. SPEC §17 Pass B has one writer (`worker/`, a standalone
 * cron Worker) and eight readers (`functions/api/**`, the Pages relay routes),
 * and they are SEPARATE DEPLOYS in separate runtimes. Neither can import the
 * other (§3, no bundler), so the key strings are written down twice, by hand,
 * on opposite sides of a wire.
 *
 * ===> A KEY MISMATCH IS THE WORST KIND OF BUG THIS PASS CAN HAVE. <===
 * Nothing errors. The Worker writes `v1:nhc/advisory/MIATCPAT2` every five
 * minutes and reports success. The route reads `v1:nhc/advisories/MIATCPAT2`,
 * misses, and falls through to upstream exactly as it did before Pass B. Every
 * dashboard is green, the KV namespace fills with data, the bill arrives, and
 * the origin collapse the whole pass was built for never happens. It would
 * survive any amount of testing that only asks "does the app work" — because
 * the app does work, on the fallback path, forever.
 *
 * The project has been here before and knows the shape of the answer: the
 * duplicated `parseSubject` regex in `functions/api/jtwc/storms.js` is allowed
 * to exist ONLY because `tools/test-advisory.mjs` fails when the two copies
 * disagree. Its header says it outright — "a copy nobody checks is how the two
 * drift; a copy with a test that fails when they disagree is just a copy."
 * Same rule, same remedy.
 *
 * WHAT THIS COVERS, STATED HONESTLY:
 *  1. the namespace prefix agrees between writer and reader
 *  2. the derived paths the writer produces, against a frozen fixture
 *  3. the STATIC PREFIX of every reader's key expression, read out of the
 *     actual route source — this is what catches a one-side rename
 *  4. GDACS URL normalisation, which is the subtlest way these two can differ
 *
 * WHAT IT DOES NOT COVER: whether a live NHC feed's `binNumber` still looks
 * like `AT2`, or whether Cloudflare stored what we asked it to. Those need the
 * network and a namespace. This is a contract test between two files.
 *
 * Zero dependencies, like every other tool here (§12 — a guard that only runs
 * where a package happens to be installed is not a guard).
 *
 * Run: node tools/test-kv-keys.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { LIST_FEEDS, nhcDerived, jtwcDerived, gdacsDerived } from '../worker/src/sources.js';
import { KV_PREFIX as WRITER_PREFIX, kvKey as writerKey } from '../worker/src/kv.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
};

/* ---------------------------------------------------------------------------
 * 1. The namespace prefix, on both sides.
 *
 * Read out of the READER's source text rather than imported, because
 * functions/api/_kv-cache.js is a Pages Function module — importing it here
 * would work today and stop working the moment it touches a Workers global.
 * The string is the contract; read the string.
 * ------------------------------------------------------------------------- */

const readerSrc = read('functions/api/_kv-cache.js');
const readerPrefix = (readerSrc.match(/export const KV_PREFIX\s*=\s*'([^']+)'/) || [])[1];
const readerBinding = (readerSrc.match(/export const KV_BINDING\s*=\s*'([^']+)'/) || [])[1];

check('KV_PREFIX agrees between worker/src/kv.js and functions/api/_kv-cache.js',
  readerPrefix, WRITER_PREFIX);

check('kvKey() builds the same string on both sides',
  writerKey('nhc/storms'), `${readerPrefix}:nhc/storms`);

/* The binding name is not duplicated in code — the Worker reads
 * `env.LANDFALL_CACHE` directly and wrangler.toml declares it — so assert all
 * three spellings match. A binding typo resolves to `undefined` and every
 * route silently falls through to upstream forever. */
check('KV_BINDING matches the name the Worker reads',
  /env\.LANDFALL_CACHE/.test(read('worker/src/index.js')) && readerBinding, 'LANDFALL_CACHE');

check('KV_BINDING matches wrangler.toml',
  (read('worker/wrangler.toml').match(/binding\s*=\s*"([^"]+)"/) || [])[1], readerBinding);

/* ---------------------------------------------------------------------------
 * 2. Derived paths, against a frozen fixture.
 *
 * The fixtures are the SHAPES these feeds actually publish (§4's field audit,
 * 2026-07-24), trimmed to the fields the derivation reads. Junk entries are
 * included on purpose: a malformed id must be skipped, not turned into a
 * request that 400s every five minutes forever.
 * ------------------------------------------------------------------------- */

const nhcFixture = {
  activeStorms: [
    { id: 'al012026', binNumber: 'AT1', name: 'Bertha' },
    { id: 'EP052026', binNumber: 'EP2', name: 'Fausto' },   // upper case in, lower out
    { id: 'nonsense', binNumber: 'AT9' },                   // bad id, good bin
    { id: 'cp012026', binNumber: 'BOGUS' },                 // good id, bad bin
    {},                                                     // empty entry
    /* ==> A CENTRAL PACIFIC BIN, AND IT IS THE POINT OF THIS FIXTURE NOW. <==
     * The office prefix was hardcoded `MIA` in BOTH the route and the cron, so
     * the two agreed with each other and both were wrong: `MIATCPCP1` does not
     * exist, the route 502'd on it, and the cron faithfully warmed a key for a
     * URL that 404s. This suite could not catch it because it only ever tested
     * AT and EP bins — an agreement test proves the two strings MATCH, never
     * that they are RIGHT, so it needs a case for every basin whose office
     * differs. Measured 2026-07-28: `HFOTCPCP1` is the live product. */
    { id: 'cp022026', binNumber: 'CP1', name: 'Fausto' },
  ],
};

check('nhcDerived: skips junk, lower-cases ids, mirrors the advisory slot',
  nhcDerived(nhcFixture).map((d) => d.path),
  [
    'nhc/adeck/al012026',
    'nhc/ships/AL0126',
    'nhc/advisory/MIATCPAT1',
    'nhc/adeck/ep052026',
    'nhc/ships/EP0526',
    'nhc/advisory/MIATCPEP2',
    'nhc/advisory/MIATCPAT9',
    'nhc/adeck/cp012026',
    'nhc/ships/CP0126',
    'nhc/adeck/cp022026',
    'nhc/ships/CP0226',
    'nhc/advisory/HFOTCPCP1',   // <-- Honolulu, not Miami
  ]);

/* ==> THE SHIPS SLOT IS THE ATCF FILENAME'S ID, NOT THE APP'S. <== §47.2. The
 * app holds `ep082026`; the file is `EP0826`. The cron and the route each
 * build that string from the app id independently — a Worker cannot import a
 * Pages Function — so this reads the route's own function out of its source
 * and runs it against the same inputs. An agreement test that compared two
 * copies of the same mistake would pass; this compares against the definition.
 *
 * Wrong-shaped ids are the failure this catches: dropping the century gives
 * `EP08206`, taking the year from the wrong offset gives `EP0820`, and both
 * warm a key nothing ever reads while looking perfectly healthy in the logs. */
{
  const routeSrc = read('functions/api/nhc/ships.js');
  const body = (routeSrc.match(/function shipsStormId\([^)]*\)\s*\{([\s\S]*?)\n\}/) || [])[1];
  const shipsStormId = new Function('basin', 'number', 'year', body);
  const slotFor = (id) =>
    `nhc/ships/${shipsStormId(id.slice(0, 2), id.slice(2, 4), id.slice(4, 8))}`;

  for (const id of ['al012026', 'ep082026', 'cp012026', 'ep122099']) {
    check(`ships slot for ${id} matches the route's shipsStormId()`,
      nhcDerived({ activeStorms: [{ id }] }).map((d) => d.path).filter((p) => p.includes('ships')),
      [slotFor(id)]);
  }
}

check('jtwcDerived: one warning per product, junk skipped',
  jtwcDerived({ storms: [{ product: 'wp1126' }, { product: 'IO0326' }, { product: 'nope' }, {}] })
    .map((d) => d.path),
  ['jtwc/warning/wp1126', 'jtwc/warning/io0326']);

/* TWO FILTERS. The eventtype test is inherited: the old EVENTS4APP list was
 * ~96% non-cyclone payload (§4 audit), and warming without it spent the whole
 * write budget on earthquakes and floods this app never draws.
 *
 * The iscurrent test guards the 2026-07-26 switch to the cyclone-only list,
 * which carries about a year of FINISHED storms. Its failure mode is not a
 * wrong key, it is a hundred right-shaped keys for storms that dissipated
 * months ago — a budget drained quietly, which is exactly the kind of thing
 * that never shows up on glass. The dead-storm row below is the whole point of
 * this case now. */
const gdacsGeom = 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1000123&episodeid=7';
check('gdacsDerived: current cyclones only, published URL only',
  gdacsDerived({
    features: [
      { properties: { eventtype: 'TC', iscurrent: 'true', url: { geometry: gdacsGeom } } },
      { properties: { eventtype: 'TC', iscurrent: 'false', url: { geometry: gdacsGeom } } }, // dissipated
      { properties: { eventtype: 'TC', url: { geometry: gdacsGeom } } },        // no flag at all
      { properties: { eventtype: 'EQ', iscurrent: 'true', url: { geometry: gdacsGeom } } },  // not a cyclone
      { properties: { eventtype: 'TC', iscurrent: 'true', url: { geometry: 'https://evil.example/gdacsapi/api/polygons/getgeometry' } } }, // wrong host
      { properties: { eventtype: 'TC', iscurrent: 'true' } },                    // no URL
    ],
  }).map((d) => d.path),
  [`gdacs/geometry/${encodeURIComponent(gdacsGeom)}`]);

/* ---------------------------------------------------------------------------
 * 3. THE READERS' OWN KEY EXPRESSIONS, read out of the route source.
 *
 * This is the check that actually catches a one-sided rename. Each route
 * builds its path inline; the static prefix of that expression is extracted
 * and compared against what the writer produces. Renaming `nhc/advisory` on
 * one side and not the other fails HERE, at the only moment it is cheap.
 * ------------------------------------------------------------------------- */

const READER_KEYS = [
  ['functions/api/nhc/storms.js', 'nhc/storms'],
  ['functions/api/jtwc/storms.js', 'jtwc/storms'],
  ['functions/api/gdacs/events.js', 'gdacs/events'],
  ['functions/api/gdacs/geometry.js', 'gdacs/geometry/'],
  ['functions/api/nhc/adeck.js', 'nhc/adeck/'],
  ['functions/api/nhc/advisory.js', 'nhc/advisory/'],
  ['functions/api/jtwc/warning.js', 'jtwc/warning/'],
  ['functions/api/nhc/genesis.js', 'nhc/genesis/'],
  ['functions/api/nhc/outlook.js', 'nhc/outlook/'],
];

for (const [file, expected] of READER_KEYS) {
  const src = read(file);
  /* Matches both forms the routes use: a plain `const KV_PATH = '...'` for the
   * fixed feeds and a `const kvPath = \`...${slot}\`` for the parameterised
   * ones. The static head of the template is what is compared. */
  const m =
    src.match(/const KV_PATH\s*=\s*'([^']+)'/) ||
    src.match(/const kvPath\s*=\s*`([^`$]*)/) ||
    /* A third form: genesis builds its two paths from `part`, which is a
     * closed table rather than a caller's string, so it is a small function
     * instead of a const. Same static head, same comparison. */
    src.match(/const kvPathFor\s*=\s*\([^)]*\)\s*=>\s*`([^`$]*)/);
  check(`${file} keys its KV read on the path the Worker writes`, m && m[1], expected);
}

/* Every reader must actually consult KV and honour the warm bypass. A route
 * that imports the helper and forgets to call it is a route that quietly never
 * benefits from any of this. */
for (const [file] of READER_KEYS) {
  const src = read(file);
  const wired = /\bkvRead\s*\(/.test(src) && /\bisWarmRequest\s*\(/.test(src);
  check(`${file} calls kvRead and isWarmRequest`, wired, true);
}

/* ---------------------------------------------------------------------------
 * 3b. THE GENESIS PAIR, BOTH KEYS, END TO END.
 *
 * This is the only entry where ONE fetch writes TWO keys, and where the writer
 * can refuse to write at all. The `.../last-good` key is the memory that
 * decides whether an empty outlook layer is an all-clear or an outage, so a
 * one-sided rename here does not degrade to "fetch upstream a bit more often"
 * like every other miss in this file — it degrades to the app announcing that
 * nothing is being watched while NHC publishes a 70% development area. Both
 * literals are compared, not just the shared head.
 * ------------------------------------------------------------------------- */

/* The text outlook is warmed per basin, ungated: a bulletin's trustworthiness
 * comes from the issue time inside it, not from anything the warm loop knows. */
for (const b of ['atlantic', 'epacific']) {
  const e = LIST_FEEDS.find((f) => f.path === `nhc/outlook/${b}`);
  check(`the writer warms the ${b} text outlook`, !!e, true);
  check(`and does not gate it`, !!(e && !e.store && !e.lastGood), true);
}

const genesisEntry = LIST_FEEDS.find((f) => f.path.startsWith('nhc/genesis'));
check('the writer warms the genesis outlook', !!genesisEntry, true);
check('the writer keys the outlook as the route reads it',
  genesisEntry && genesisEntry.path, 'nhc/genesis/areas');
check('the writer keys the last-good memory as the route reads it',
  genesisEntry && genesisEntry.lastGood && genesisEntry.lastGood.path,
  'nhc/genesis/areas/last-good');

{
  const src = read('functions/api/nhc/genesis.js');
  const lg = src.match(/const kvLastGoodPathFor\s*=\s*\([^)]*\)\s*=>\s*`([^`$]*)/);
  const tail = src.match(/const kvLastGoodPathFor[^`]*`[^`]*`/);
  check('the route builds the last-good path from the same head', lg && lg[1], 'nhc/genesis/');
  check('and ends it with /last-good', !!(tail && tail[0].includes('/last-good')), true);
}

/* ==> THE GATES ARE THE CLOCK, SO THEY ARE PINNED HERE TOO. <==
 * If `store` ever returns true for a held response, the held body is written
 * back, `kv.js` re-stamps its age on every cycle, and HELD_SECONDS never
 * lapses — the outlook freezes on its last real answer permanently and it
 * looks exactly like the feature working. Nothing else in the system would go
 * red. These four assertions are the whole guard. */
{
  const hdr = (o) => ({ get: (k) => (k in o ? String(o[k]) : null) });
  const held = hdr({ 'X-Landfall-Held': 'upstream-empty', 'X-Landfall-Genesis-Areas': '5' });
  const areas = hdr({ 'X-Landfall-Genesis-Areas': '5' });
  const allClear = hdr({ 'X-Landfall-Genesis-Areas': '0' });

  check('a held body is never warmed', genesisEntry.store(held), false);
  check('a real answer is warmed', genesisEntry.store(areas), true);
  check('a genuine all-clear IS warmed — it is a real answer',
    genesisEntry.store(allClear), true);
  check('a held body never becomes the last-good memory',
    genesisEntry.lastGood.store(held), false);
  check('an all-clear never becomes the last-good memory',
    genesisEntry.lastGood.store(allClear), false);
  check('an answer with areas does become the last-good memory',
    genesisEntry.lastGood.store(areas), true);
}

/* ---------------------------------------------------------------------------
 * 4. GDACS URL NORMALISATION — the subtlest way the two sides can differ.
 *
 * functions/api/gdacs/geometry.js keys its cache on `new URL(raw).toString()`,
 * the PARSER'S output, not the caller's input string. The Worker must
 * normalise identically or the two spellings are two different keys and the
 * reader misses every entry the writer creates — silently, forever.
 * ------------------------------------------------------------------------- */

const unnormalised =
  'https://www.gdacs.org:443/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1000123';
check('gdacsDerived normalises through new URL(), as the route does',
  gdacsDerived({ features: [{ properties: { eventtype: 'TC', iscurrent: 'true', url: { geometry: unnormalised } } }] })[0].path,
  `gdacs/geometry/${encodeURIComponent(new URL(unnormalised).toString())}`);

/* ------------------------------------------------------------------------- */

if (failures) {
  console.error(`\n${failures} KV key contract failure(s) — the warm loop would run and do nothing.\n`);
  process.exit(1);
}
console.log('✓ KV key contract holds: one writer, eight readers, same strings');
