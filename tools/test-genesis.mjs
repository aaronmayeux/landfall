#!/usr/bin/env node
/**
 * test-genesis.mjs — the areas being watched (SPEC §45).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-genesis.mjs`, same as every other
 * suite here (§12 — this project has no toolchain by design).
 *
 * ===========================================================================
 * THE FIXTURES ARE REAL BYTES, AND THIS FILE WOULD BE WORTHLESS WITHOUT THEM
 * ===========================================================================
 *
 * `samples/genesis/` holds the exact payloads the archive branch captured on
 * 2026-08-09: NHC's five outlook polygons and JTWC's ABPW bulletin, verbatim,
 * hard wrapping and all.
 *
 * THAT WRAPPING IS NOT INCIDENTAL. JTWC breaks at ~70 columns, THROUGH the
 * middle of the probability sentence — "...WITHIN THE NEXT 24 HOURS REMAINS
 * MEDIUM." arrives with a newline inside it, and where that newline falls
 * moves with the length of the system's name. A matcher written against a
 * single-spaced fixture passes here and then silently fails on the next
 * bulletin, which looks exactly like nothing ever brewing in the Western
 * Pacific — the quietest possible bug.
 *
 * The first draft of these patterns was written from §45.3's prose, and THREE
 * OF FOUR MATCHED NOTHING against the real bytes. Every one of them failed
 * silently. That is what this file is for.
 *
 * ===========================================================================
 * THE MUTATION CHECKS
 * ===========================================================================
 *
 * §12: a test that passes on the same wrong assumption as the bug is worse
 * than no test. Several assertions below therefore also demonstrate that the
 * NAIVE implementation gives a DIFFERENT answer — the string sort really does
 * put "100%" between "10%" and "20%", the previous-position pattern really
 * does pick the wrong fix. If those lines ever start agreeing with the real
 * implementation, this suite has stopped testing anything.
 *
 * WHAT THIS CANNOT PROVE: that a hatched patch reads as "nothing here yet"
 * rather than as a storm-shaped thing. That is the one real risk in §45 and it
 * is glass.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* ==> A PROGRAMMABLE RELAY STUB, AND IT IS HERE BECAUSE OF A REAL OUTAGE. <==
 *
 * Every other assertion in this file drives the PARSERS with a fixture already
 * in memory. That covered the hard part and left the easy part naked: the one
 * line that pulls the fixture off the wire. `data/genesis.js` destructured
 * `data` from a relay that resolves `{ json, text }`, so the payload was
 * `undefined`, the parser dutifully found no features, and the app published
 * "nothing is being watched" over five live areas including one at 80%.
 *
 * It shipped. No test failed. §5's worst failure mode, committed by the
 * feature written to prevent it — and the reason was that the seam between two
 * correct pieces was the only thing nobody drove.
 *
 * So the fetch stub answers with the SHAPE data/relay.js really returns, and
 * the suite drives `fetchGenesis()` end to end below. Nothing reaches the
 * network: an unrecognised URL throws rather than falling through. */
/** ==> THE SUITE HAD A TIME BOMB IN IT. <== The ABPW fixture is a real
 *  bulletin with a real timestamp, and `parseAbpw` correctly DROPS a bulletin
 *  older than `ABPW.maxAge` (24 h). So this file passed for one day after the
 *  capture and then went red permanently — which is exactly the "a check that
 *  is always red teaches you to ignore the board" failure this repo has a
 *  standing rule about. The clock is pinned to the fixture's own hour, the
 *  same way the home suite pins its advisory. */
const FIXTURE_NOW = Date.parse('2026-08-09T04:00:00Z');

let RELAY = {};
globalThis.fetch = async (url) => {
  const key = Object.keys(RELAY).find((k) => String(url).includes(k));
  if (!key) throw new Error(`no test in this file may touch the network: ${url}`);
  const r = RELAY[key];
  if (r.throw) throw new Error('network error');
  return {
    ok: r.ok !== false,
    status: r.status ?? 200,
    headers: { get: (h) => (h === 'X-Landfall-Fetched-At' ? '2026-08-09T04:00:00Z' : null) },
    json: async () => r.json,
    text: async () => r.text ?? '',
  };
};

const {
  parsePercent, formatPercent, normalizeRisk, centroidOf, areaTitle,
  normalizeNhcAreas, orderValue, sortAreas, isStaleArea,
} = await import('../lib/genesis.js');
const { parseAbpw, parseHeaderTime } = await import('../lib/abpw.js');
const { fetchGenesis } = await import('../data/genesis.js');
const { GENESIS } = await import('../config/constants.js');

const AREAS_FC = JSON.parse(
  fs.readFileSync('samples/genesis/nhc-genesis-areas.geojson', 'utf8')
);
const ABPW = fs.readFileSync('samples/genesis/jtwc-abpw.txt', 'utf8');

/* ---------------------------------------------------------------------------
 * THE PERCENT STRINGS — the single most likely bug in this feature
 * ------------------------------------------------------------------------- */
section('probabilities are STRINGS with a percent sign');

ok(parsePercent('40%') === 40, '"40%" parses to 40');
ok(parsePercent('0%') === 0, '"0%" parses to 0, not to null');
ok(parsePercent('100%') === 100, '"100%" parses to 100');
ok(parsePercent('') === null, 'an empty string is "not stated", not zero');
ok(parsePercent(null) === null, 'a missing field is "not stated", not zero');
ok(parsePercent('n/a') === null, 'junk is "not stated", never a number');
ok(parsePercent('140%') === null, 'out of range is refused rather than clamped');

ok(
  parsePercent('0%') !== null && parsePercent('') === null,
  'ZERO AND NOT-STATED ARE DIFFERENT FACTS. NHC saying "0% in two days" and '
  + 'NHC leaving the field blank must not render as the same sentence (§5)'
);

/* THE MUTATION CHECK. If this ever stops being true, the sort is no longer
 * being protected by anything. */
const naive = ['10%', '100%', '20%'].slice().sort();
ok(
  naive[1] === '100%',
  'MUTATION: a plain string sort really does put "100%" between "10%" and '
  + '"20%" — so the numeric parse below is load-bearing, not decorative'
);
const parsed = ['10%', '100%', '20%'].map(parsePercent).sort((a, b) => a - b);
ok(
  parsed[0] === 10 && parsed[1] === 20 && parsed[2] === 100,
  'and parsed numerically they sort 10, 20, 100'
);

ok(formatPercent(40) === '40%', 'and one place turns a number back into text');
ok(formatPercent(null) === null, 'a null probability formats to null, never "0%"');

/* ---------------------------------------------------------------------------
 * THE RISK WORDS
 * ------------------------------------------------------------------------- */
section('risk words, and the unfamiliar one');

ok(normalizeRisk('Low') === 'LOW', "NHC's \"Low\" normalises");
ok(normalizeRisk('MEDIUM') === 'MEDIUM', "JTWC's shouted MEDIUM normalises");
ok(normalizeRisk('  high  ') === 'HIGH', 'whitespace and case are forgiven');
ok(
  normalizeRisk('Very High') === GENESIS.riskFallback,
  'AN UNRECOGNISED WORD FALLS BACK RATHER THAN DROPPING THE AREA. Losing a '
  + 'watched area because of an unfamiliar adjective is §5 pointed inward'
);
ok(normalizeRisk(undefined) === GENESIS.riskFallback, 'and so does a missing one');

/* ---------------------------------------------------------------------------
 * §45.2's [VERIFY] — the `basin` field
 * ------------------------------------------------------------------------- */
section('§45.2 [VERIFY] — an unexpected `basin` value cannot hurt anything');

const seen = new Set(AREAS_FC.features.map((f) => f.properties.basin));
ok(
  [...seen].every((b) => b === 'Atlantic' || b === 'Pacific'),
  'MEASURED 2026-08-09: the live field really is only "Atlantic" | "Pacific" '
  + `— saw ${[...seen].join(', ')}`
);

/* The answer to the [VERIFY] is not "we handled the values we saw". It is that
 * NOTHING STRUCTURAL READS THE FIELD AT ALL, so there is no branch for a
 * surprise to take. These two fabricated features prove it. */
const weird = normalizeNhcAreas({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        objectid: 90, basin: 'Central Pacific',
        prob2day: '0%', risk2day: 'Low', prob7day: '30%', risk7day: 'Low',
      },
      geometry: { type: 'Polygon', coordinates: [[[-150, 10], [-140, 10], [-140, 18], [-150, 18], [-150, 10]]] },
    },
    {
      type: 'Feature',
      properties: {
        objectid: 91, basin: 'Sea of Tranquility',
        prob2day: '0%', risk2day: 'Low', prob7day: '10%', risk7day: 'Low',
      },
      geometry: { type: 'Polygon', coordinates: [[[-40, 10], [-30, 10], [-30, 18], [-40, 18], [-40, 10]]] },
    },
  ],
});
ok(weird.length === 2, 'a basin value nobody has ever seen does NOT drop the area');
ok(
  weird[0].basin === 'centralPacific' && weird[1].basin === 'atlantic',
  'the canonical basin comes from the CENTROID, so both are filed correctly '
  + 'whatever the field said'
);
ok(
  weird[1].sourceBasin === 'Sea of Tranquility',
  "and the source's own word survives as provenance rather than being discarded"
);
ok(
  weird[0].title === 'Central Pacific' && weird[1].title === 'Eastern Atlantic',
  'and the title is computed too, so it cannot inherit a wrong basin word'
);

/* ---------------------------------------------------------------------------
 * GEOMETRY
 * ------------------------------------------------------------------------- */
section('centroids, including across the antimeridian');

const box = centroidOf({
  type: 'Polygon',
  coordinates: [[[-10, 0], [10, 0], [10, 10], [-10, 10], [-10, 0]]],
});
ok(
  Math.abs(box.lon) < 1e-6 && Math.abs(box.lat - 5) < 1e-6,
  'a plain box centroids at its middle'
);

/* THE ONE THAT MATTERS. A Pacific development region straddling 180° whose
 * vertices are averaged naively lands in the Gulf of Guinea — wrong ocean,
 * wrong basin, wrong title, and a flyTo to the other side of the planet. */
const straddle = [[170, 10], [-170, 10], [-170, 18], [170, 18], [170, 10]];
const acrossLine = centroidOf({ type: 'Polygon', coordinates: [straddle] });
ok(
  Math.abs(Math.abs(acrossLine.lon) - 180) < 1,
  `an area straddling the dateline centroids near 180°, got ${acrossLine.lon.toFixed(1)}`
);
const naiveLon = straddle.slice(0, 4).reduce((a, p) => a + p[0], 0) / 4;
ok(
  Math.abs(naiveLon) < 1,
  'MUTATION: the naive vertex mean really does land near 0° — the Gulf of '
  + 'Guinea — so the unwrap is load-bearing'
);

ok(centroidOf(null) === null, 'no geometry is null, not a crash');
ok(centroidOf({ type: 'Point', coordinates: [0, 0] }) === null, 'and so is a point');

section('the title is ours, and it says where the area is');
ok(areaTitle(-70, 20) === 'Western Atlantic', 'west of 65W is the western Atlantic');
ok(areaTitle(-45, 12) === 'Central Atlantic', 'the middle is the middle');
ok(areaTitle(-25, 12) === 'Eastern Atlantic', 'east of 35W is the deep tropics');
ok(
  areaTitle(-148, 14) === 'Central Pacific',
  'the Pacific basins already carry a compass word and are not subdivided '
  + 'again — "Eastern East Pacific" is nobody’s idea of a place'
);
ok(areaTitle(NaN, 10) === 'Watched area', 'an unusable position still gets a name');

/* ---------------------------------------------------------------------------
 * THE REAL NHC PAYLOAD
 * ------------------------------------------------------------------------- */
section('the live outlook, parsed');

const areas = normalizeNhcAreas(AREAS_FC).sort(sortAreas);
ok(areas.length === 5, 'five watched areas, as measured');
ok(
  areas[0].prob7day === 80 && areas[0].risk7day === 'HIGH',
  'the strongest is the 80% High area'
);
ok(
  areas.map((a) => a.prob7day).join(',') === '80,50,40,20,20',
  `sorted by probability descending: got ${areas.map((a) => a.prob7day).join(',')}`
);
ok(
  areas[0].globeProb === areas[0].prob7day,
  '§45.6: the number bound for the GLOBE is the SEVEN-day one, because the '
  + 'polygon is the seven-day area'
);
ok(
  areas[0].prob2day === 20 && areas[0].globeProb === 80,
  'and the two-day figure travels with the object for the drawer without ever '
  + 'being the one on the shape'
);
ok(
  areas.every((a) => Number.isFinite(a.issuedAt)),
  'every area carries the publisher’s own idp_filedate stamp (§17.7 — no '
  + 'third clocks)'
);
ok(
  !isStaleArea(areas[0], areas[0].issuedAt + 1000),
  'freshly published is not stale'
);
ok(
  isStaleArea(areas[0], areas[0].issuedAt + GENESIS.staleAfter + 1000),
  'past the staleness window it is'
);
ok(
  !isStaleArea({ issuedAt: null }, Date.now()),
  'A MISSING STAMP IS AN UNKNOWN, NOT A DELAY. A layer that shouts at an '
  + 'absent field is a layer people learn to ignore'
);

/* ---------------------------------------------------------------------------
 * ORDERING ACROSS TWO SCALES
 * ------------------------------------------------------------------------- */
section('§45.8 — one list, two vocabularies');

const jtwcHigh = { id: 'j1', source: 'JTWC', risk: 'HIGH', title: 'Invest 99W' };
const jtwcLow = { id: 'j2', source: 'JTWC', risk: 'LOW', title: 'Invest 90B' };
ok(orderValue(jtwcHigh) === GENESIS.orderWeight.HIGH, 'JTWC HIGH sorts at its agreed weight');
ok(orderValue(areas[0]) === 80, 'an NHC area sorts on its published percentage');

const mixed = [jtwcLow, areas[0], jtwcHigh, areas[4]].sort(sortAreas);
ok(
  mixed[0].id === areas[0].id && mixed[1].id === 'j1',
  'an 80% NHC area outranks a JTWC HIGH, which outranks a 20% NHC area'
);
ok(
  mixed[3].id === 'j2',
  'and a JTWC LOW sorts below a 20% NHC area (10 < 20)'
);

const twice = [jtwcLow, areas[0], jtwcHigh, areas[4]].sort(sortAreas).map((a) => a.id);
const again = [areas[4], jtwcHigh, areas[0], jtwcLow].sort(sortAreas).map((a) => a.id);
ok(
  twice.join() === again.join(),
  'THE COMPARATOR IS TOTAL AND STABLE. An unstable one makes rows jump '
  + 'between polls, which on a 30-minute tick reads as data changing when it '
  + 'has not'
);

/* THE WEIGHTS ARE FOR ORDERING AND MUST NEVER BE RENDERED. Presenting 70% as
 * though JTWC had published it is precisely the invention §45.3 forbids. */
const uiSrc = fs.readFileSync('ui/view-storms.js', 'utf8')
  + fs.readFileSync('ui/view-area-detail.js', 'utf8');
ok(
  !/orderWeight/.test(uiSrc),
  'no UI file reads GENESIS.orderWeight — the numbers cannot reach the screen'
);

/* ---------------------------------------------------------------------------
 * THE JTWC BULLETIN — real bytes, real wrapping
 * ------------------------------------------------------------------------- */
section('§45.3 — the ABPW bulletin');

const NOW = Date.parse('2026-08-09T04:30:00Z');
const b = parseAbpw(ABPW, { now: NOW });

ok(b.status === 'ok', `the live bulletin parses: got ${b.status}`);
ok(
  b.issuedAt === Date.parse('2026-08-09T03:00:00Z'),
  'the WMO header 090300 is the stamp — not the fetch time (§17.7)'
);
ok(b.systems.length === 1, `exactly one disturbance, got ${b.systems.length}`);

const inv = b.systems[0];
ok(inv.title === 'Invest 98W', `named from JTWC’s own designator: ${inv.title}`);
ok(inv.risk === 'MEDIUM', 'MEDIUM, read from "...REMAINS MEDIUM." across a line break');
ok(inv.horizon === GENESIS.HORIZON.jtwc, 'over 24 hours, in JTWC’s own terms');
ok(
  inv.prob7day === null && inv.prob2day === null,
  'NO INVENTED PERCENTAGE. §45.3 forbids mapping HIGH onto a number, and the '
  + 'object has nowhere to put one'
);
ok(
  Math.abs(inv.centroid.lat - 20.5) < 1e-6 && Math.abs(inv.centroid.lon - 152.3) < 1e-6,
  `the CURRENT fix, 20.5N 152.3E — got ${inv.centroid.lat}, ${inv.centroid.lon}`
);
ok(
  /PREVIOUSLY LOCATED NEAR\s+19\.6N/.test(ABPW.replace(/\s+/g, ' ')),
  'MUTATION: the same sentence really does open with a PREVIOUS fix of 19.6N '
  + '150.5E, so anchoring on "NOW LOCATED" is load-bearing — without it the '
  + 'system draws ~100 nm behind where JTWC says it is'
);
ok(inv.basin === 'westPacific', 'and its basin comes from that position');

ok(
  !b.systems.some((s) => /13W/.test(s.title)),
  'REMNANTS 13W IS DROPPED. It reads "IS NOW THE SUBJECT OF A TROPICAL CYCLONE '
  + 'WARNING" and is warned as TD 13W (KUJIRA) in section A of the SAME '
  + 'bulletin — showing it here would put one system on screen twice, once as '
  + 'a storm and once as a thing that might become one'
);
ok(
  /TROPICAL DEPRESSION 13W \(KUJIRA\)/.test(ABPW),
  'MUTATION: 13W really is warned in this very bulletin, so the drop above is '
  + 'preventing a real double-count and not a hypothetical one'
);

/* ==> THE ASSERTION ABOVE WAS PASSING FOR THE WRONG REASON, AND THAT IS WHY
 *     THIS BLOCK EXISTS. <==
 *
 * Caught by deliberately deleting the `upgradedPattern` guard on 2026-08-09:
 * the suite still passed. In the live bulletin, item (2) reads "PREVIOUSLY
 * LOCATED NEAR 22.5N 140.9E IS NOW THE SUBJECT OF A TROPICAL CYCLONE WARNING"
 * — it has no CURRENT position and no probability sentence, so it is already
 * dropped by two other conditions before the guard is ever consulted. The
 * guard was therefore untested, and an untested guard is a guard that quietly
 * stops working.
 *
 * §12: a test that passes on the same wrong assumption as the bug is worse
 * than no test. So this fixture is an upgraded item that WOULD otherwise parse
 * perfectly — current fix, probability sentence, the lot — leaving the guard
 * as the only thing standing between it and a double-counted storm. JTWC has
 * no obligation to keep wording these items the way it did on the day the
 * archive happened to snapshot them. */
const wouldParse = parseAbpw(
  'ABPW10 PGTW 090300\nRMKS/\n1. WESTERN NORTH PACIFIC AREA:\n'
  + '   B. TROPICAL DISTURBANCE SUMMARY:\n'
  + '      (1) THE AREA OF CONVECTION (INVEST 97W) IS NOW LOCATED NEAR \n'
  + '18.0N 130.0E. THE POTENTIAL FOR THE DEVELOPMENT OF A SIGNIFICANT \n'
  + 'TROPICAL CYCLONE WITHIN THE NEXT 24 HOURS IS HIGH. THIS SYSTEM IS NOW \n'
  + 'THE SUBJECT OF A TROPICAL CYCLONE WARNING.\n'
  + '      (2) NO OTHER SUSPECT AREAS.\n   C. NONE.\n',
  { now: NOW }
);
ok(
  wouldParse.systems.length === 0,
  'AN UPGRADED ITEM IS DROPPED EVEN WHEN IT CARRIES A CURRENT FIX AND A '
  + 'PROBABILITY — the warning sentence is the only thing refusing it here, '
  + 'so this is the assertion that actually tests the guard'
);
ok(
  wouldParse.status === 'none_matched',
  'and the bulletin is then `none_matched`, not `unavailable` — it parsed '
  + 'fine, there was simply nothing left to show'
);
ok(
  !b.systems.some((s) => /12W|14W/.test(s.title)),
  'and section A’s three active storms are not parsed as disturbances at all'
);

section('§45.5 — the ABPW failure states are three, not two');

const junk = parseAbpw('<html>404 not found</html>', { now: NOW });
ok(
  junk.status === 'unavailable',
  'AN UNREADABLE BULLETIN IS `unavailable`, NEVER `none_matched`. JTWC serves '
  + 'an HTML error page rather than a 404, and reading that as "nothing is '
  + 'brewing" is a false all-clear over the busiest cyclone basin on earth'
);
ok(junk.systems.length === 0, 'and it carries no systems');

const quiet = parseAbpw(
  'ABPW10 PGTW 090300\nRMKS/\n1. WESTERN NORTH PACIFIC AREA:\n'
  + '   B. TROPICAL DISTURBANCE SUMMARY:\n      (1) NO SUSPECT AREAS.\n   C. NONE.\n',
  { now: NOW }
);
ok(
  quiet.status === 'none_matched',
  'A BULLETIN THAT SAYS "NO SUSPECT AREAS" IS `none_matched` — JTWC looked and '
  + 'there is nothing, which is a real and different answer'
);

const old = parseAbpw(ABPW, { now: Date.parse('2026-08-11T04:30:00Z') });
ok(
  old.status === 'unavailable',
  'a bulletin over a day old is unavailable — reissued several times daily, so '
  + 'a full day of silence is a broken product, and a day-old HIGH is worse '
  + 'than an honest gap'
);

section('the header time, including month rollover');
const jan1 = new Date(Date.UTC(2026, 0, 1, 6, 0, 0));
const rolled = parseHeaderTime('31', '18', '00', jan1);
ok(
  new Date(rolled).getUTCMonth() === 11 && new Date(rolled).getUTCFullYear() === 2025,
  'a bulletin dated the 31st, read on the 1st, is LAST month — a bulletin can '
  + 'be hours old, never days in the future'
);
ok(parseHeaderTime('32', '00', '00', jan1) === null, 'an impossible day is refused');
ok(parseHeaderTime('09', '25', '00', jan1) === null, 'and an impossible hour');

/* ---------------------------------------------------------------------------
 * THE SEAM — data/genesis.js against a relay that returns the real shape
 *
 * THIS IS THE SECTION THAT WOULD HAVE CAUGHT THE BUG THAT SHIPPED. Everything
 * above proves the parsers are right. These prove the parsers are actually
 * being HANDED the payload.
 * ------------------------------------------------------------------------- */
section('the seam between the relay and the parser');

RELAY = {
  '/api/nhc/genesis': { json: AREAS_FC },
  '/api/jtwc/abpw': { text: ABPW },
};
const live = await fetchGenesis({ now: FIXTURE_NOW });

ok(
  live.sources.nhc.status === 'ok',
  `NHC's five areas survive the trip from the relay: got ${live.sources.nhc.status}`
);
ok(
  live.sources.nhc.areas.length === 5,
  `and all five arrive — got ${live.sources.nhc.areas.length}. THIS IS THE `
  + 'ASSERTION THAT WAS MISSING. It fails the moment the destructured property '
  + 'name and the relay disagree, which is exactly how a false all-clear was '
  + 'published on 2026-08-09'
);
ok(live.sources.jtwc.areas.length === 1, 'and JTWC\'s one disturbance with it');
ok(live.areas.length === 6, 'merged into one list of six');
ok(
  live.areas[0].prob7day === 80,
  'ordered across both sources, strongest first'
);
ok(live.status === 'ok', 'and the section as a whole reports ok');

ok(
  live.sources.jtwc.areas[0].issuedAt === Date.parse('2026-08-09T03:00:00Z'),
  'EVERY JTWC SYSTEM CARRIES THE BULLETIN\'S OWN ISSUE TIME. It lived only on '
  + 'the slot, so the area panel printed "Publication time not stated" under a '
  + 'bulletin that states it in its first line (seen on glass 2026-08-09)'
);
ok(
  live.areas.every((a) => Number.isFinite(a.issuedAt)),
  'and so does every area from either source, so one panel can ask both the '
  + 'same question'
);

section('a broken NHC half is an OUTAGE, never an empty sky');

RELAY = {
  '/api/nhc/genesis': { json: { type: 'Nonsense' } },
  '/api/jtwc/abpw': { text: ABPW },
};
const wrongShape = await fetchGenesis({ now: FIXTURE_NOW });
ok(
  wrongShape.sources.nhc.status === 'unavailable',
  'A BODY THAT IS NOT A FEATURECOLLECTION IS `unavailable`, NOT '
  + '`none_matched`. This is the general form of the bug: anything unreadable '
  + 'must say "we could not look", never "there is nothing to see"'
);
ok(
  wrongShape.status === 'ok' && wrongShape.areas.length === 1,
  'and the JTWC half still shows — one source down is not both down'
);

RELAY = {
  '/api/nhc/genesis': { json: { error: { code: 400 } } },
  '/api/jtwc/abpw': { text: ABPW },
};
const refused = await fetchGenesis({ now: FIXTURE_NOW });
ok(
  refused.sources.nhc.status === 'unavailable',
  "ArcGIS's 200-with-an-error-body is an outage too — it is forwarded verbatim "
  + 'by the relay precisely so this can be told apart from an empty answer'
);

RELAY = {
  '/api/nhc/genesis': { throw: true },
  '/api/jtwc/abpw': { throw: true },
};
const bothDown = await fetchGenesis({ now: FIXTURE_NOW });
ok(
  bothDown.status === 'unavailable',
  'both sources unreachable is `unavailable` — the one state where the section '
  + 'must refuse to imply anything about the sky'
);
ok(bothDown.areas.length === 0, 'with no areas to draw');

RELAY = {
  '/api/nhc/genesis': { json: { type: 'FeatureCollection', features: [] } },
  '/api/jtwc/abpw': { text: 'ABPW10 PGTW 090300\nRMKS/\n1. AREA:\n   B. TROPICAL DISTURBANCE SUMMARY:\n      (1) NO SUSPECT AREAS.\n   C. NONE.\n' },
};
const quietWorld = await fetchGenesis({ now: FIXTURE_NOW });
ok(
  quietWorld.status === 'none_matched',
  'BOTH SOURCES ANSWERING WITH NOTHING IS `none_matched` — the real quiet day, '
  + 'and the only one that earns an all-clear'
);

/* ---------------------------------------------------------------------------
 * THE PLANET-BAND RINGS LAND WHERE THE PATCHES DO
 *
 * This section exists because they did not. `map/watch-marks.js` rolled its own
 * spherical conversion — the textbook phi/theta form — and put every ring
 * NINETY DEGREES EAST of its area. Central Pacific at 147°W drew at 57°W, in
 * the Atlantic. The globe's axis convention is +Y north with the prime meridian
 * facing +Z, which is not the textbook one, so a formula that reads correctly
 * in the abstract is wrong here.
 *
 * It was caught on glass only because the COUNT gave it away — three rings over
 * two Atlantic patches. A single misplaced area would have looked entirely
 * plausible. That is the whole argument for this test.
 * ------------------------------------------------------------------------- */
section('the planet-band ring lands on its own area');

/* A THREE stub. Only the four things watch-marks.js touches, and `Color` has to
 * actually parse a hex — a stub that returned zeros would let a colour bug
 * through while proving the positions right. */
const THREE = {
  BufferGeometry: class {
    constructor() { this.attributes = {}; }
    setAttribute(n, a) { this.attributes[n] = a; }
    setDrawRange() {}
    computeBoundingSphere() {}
  },
  BufferAttribute: class {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  },
  PointsMaterial: class { constructor(o) { Object.assign(this, o); } },
  Points: class { constructor(g, m) { this.geometry = g; this.material = m; } },
  Color: class {
    set(hex) {
      const h = String(hex).replace('#', '');
      this.r = parseInt(h.slice(0, 2), 16) / 255;
      this.g = parseInt(h.slice(2, 4), 16) / 255;
      this.b = parseInt(h.slice(4, 6), 16) / 255;
      return this;
    }
  },
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  },
};

/* `lib/geo.js` reads a GLOBAL `THREE` — index.html loads the vendored build by
 * relative script tag, so that module has no import to give it one. The stub
 * therefore has to be published globally as well as passed in, and the fact
 * that it has to be is worth knowing: anything importing lib/geo.js outside a
 * browser needs this line. */
globalThis.THREE = THREE;

const { createWatchMarks } = await import('../map/watch-marks.js');
const { circleAround } = await import('../lib/genesis.js');
const { palette } = await import('../config/theme.js');
const { vec3ToLonLat } = await import('../lib/geo.js');
const { DIVE } = await import('../config/constants.js');

const marks = createWatchMarks(THREE, { palette });

/* One area per risk level so every Points object is exercised — a bug that
 * only hit the MEDIUM bucket would otherwise pass. */
const placed = [
  { id: 'a', globeRisk: 'HIGH', centroid: { lon: -147.8, lat: 14.3 } },
  { id: 'b', globeRisk: 'MEDIUM', centroid: { lon: -36.3, lat: 12.6 } },
  { id: 'c', globeRisk: 'LOW', centroid: { lon: 152.3, lat: 20.5 } },
];
marks.setAreas(placed);

/* Read each ring's vertex back out and turn it into lon/lat again. A ring that
 * round-trips to its own area's coordinates is on its own area. */
const readBack = [];
for (const obj of marks.objects) {
  const a = obj.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i += 3) {
    const r = DIVE.stormDotRadius;
    const [lon, lat] = vec3ToLonLat({ x: a[i] / r, y: a[i + 1] / r, z: a[i + 2] / r });
    readBack.push({ lon, lat });
  }
}

ok(readBack.length === 3, `three rings placed, got ${readBack.length}`);

for (const want of placed) {
  const hit = readBack.find(
    (p) => Math.abs(p.lon - want.centroid.lon) < 0.05 && Math.abs(p.lat - want.centroid.lat) < 0.05
  );
  ok(
    !!hit,
    `a ring sits at ${want.centroid.lon}, ${want.centroid.lat} — the ${want.globeRisk} area's `
    + 'own position. THIS IS THE ASSERTION THAT WAS MISSING: the first version '
    + 'drew it 90° east of here'
  );
}

/* THE MUTATION CHECK, stated rather than run: the textbook conversion really
 * does disagree with this globe's convention, so the round-trip above is
 * testing something. */
const bad = (() => {
  const D = Math.PI / 180;
  const lon = -147.8;
  const lat = 14.3;
  const phi = (90 - lat) * D;
  const th = (lon + 180) * D;
  return vec3ToLonLat({
    x: -Math.sin(phi) * Math.cos(th),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(th),
  })[0];
})();
ok(
  Math.abs(bad - (-57.8)) < 0.5,
  `MUTATION: the textbook phi/theta form really does put 147.8°W at ${bad.toFixed(1)}° `
  + '— in the Atlantic. It is not a rounding difference, it is a different ocean'
);

/* AN AREA WITH NO POSITION IS SKIPPED, NOT PLACED AT THE ORIGIN. A vertex at
 * (0,0,0) is the centre of the globe, which renders as a mark at whatever point
 * happens to face the camera — a watched area that follows you around. */
marks.setAreas([{ id: 'x', globeRisk: 'HIGH', centroid: null }, ...placed]);
let total = 0;
for (const obj of marks.objects) total += obj.geometry.attributes.position.array.length / 3;
ok(total === 3, `an area with no centroid is dropped, not placed at the origin (got ${total})`);

/* ---------------------------------------------------------------------------
 * THE ONE SHAPE IN §45 THAT NOBODY PUBLISHED
 *
 * JTWC states a position and no extent. Before this, a watched system in the
 * Western Pacific drew nothing at close zoom — tapping its row flew the camera
 * to empty ocean. Aaron asked for a shape on 2026-08-09 having heard the
 * argument against inventing one, so what these assertions guard is not
 * whether the circle exists but whether it stays DEFENSIBLE: the right size,
 * measured from real areas, and geometrically sound at the edges.
 * ------------------------------------------------------------------------- */
section('the JTWC circle');

const jt = b.systems[0];
ok(jt.geometry?.type === 'Polygon', 'a JTWC system now carries a polygon');

const jring = jt.geometry.coordinates[0];
ok(
  JSON.stringify(jring[0]) === JSON.stringify(jring[jring.length - 1]),
  'the ring is explicitly closed — GeoJSON requires first === last, and a '
  + 'renderer that silently closes it for you is not one to depend on'
);

/* THE SIZE IS THE ARGUMENT. A circle at a pleasing number would be an
 * invention; a circle at the mean equivalent radius of NHC's own published
 * areas is the size a watched area actually is. */
const nhcRadii = AREAS_FC.features.map((f) => Math.sqrt(f.properties['st_area(shape)'] / Math.PI));
const meanR = nhcRadii.reduce((a, x) => a + x, 0) / nhcRadii.length;
ok(
  Math.abs(GENESIS.jtwcRadiusDeg - meanR) < 0.05,
  `GENESIS.jtwcRadiusDeg is the MEASURED mean equivalent radius of NHC's real `
  + `areas (${meanR.toFixed(2)}°), not a chosen number. If this drifts, the `
  + 'circle has stopped being defensible and is just a circle'
);

const jys = jring.map((p) => p[1]);
ok(
  Math.abs((Math.max(...jys) - Math.min(...jys)) / 2 - GENESIS.jtwcRadiusDeg) < 0.05,
  'and the drawn ring is actually that radius in latitude'
);

/* A CIRCLE ON THE GLOBE, NOT A CIRCLE IN DEGREES. Without the cos(lat)
 * division a ring at 20°N draws six per cent too narrow, and it gets worse
 * toward the poles until it is a lens rather than a circle. */
const jxs = jring.map((p) => p[0]);
const wideBy = (Math.max(...jxs) - Math.min(...jxs)) / (Math.max(...jys) - Math.min(...jys));
ok(
  wideBy > 1.02,
  `at 20.5°N the ring is wider in longitude than in latitude (x${wideBy.toFixed(3)}) — `
  + 'MUTATION: without the cos(lat) division this ratio would be exactly 1.000 '
  + 'and the shape would be a lens on the globe'
);

/* THE DATELINE. A ring that wrapped through ±180 would be drawn as a band the
 * width of the world — the same failure `centroidOf` unwraps to avoid, in the
 * other direction. 98W sits 28° from the seam today, which is exactly the kind
 * of margin that disappears without warning. */
const nearSeam = circleAround({ lon: 178, lat: 12 }, GENESIS.jtwcRadiusDeg);
const seamXs = nearSeam.coordinates[0].map((p) => p[0]);
ok(
  Math.max(...seamXs) - Math.min(...seamXs) < 20,
  `a circle at 178°E stays continuous instead of wrapping — span `
  + `${(Math.max(...seamXs) - Math.min(...seamXs)).toFixed(1)}°, not ~360°`
);
ok(
  Math.max(...seamXs) > 180,
  'and it does so by running PAST 180 rather than jumping to -180. Renderers '
  + 'handle an out-of-range longitude; they cannot handle a ring that leaps '
  + '360° mid-edge'
);

/* A pole-adjacent system must not divide by a cosine near zero and produce a
 * ring that wraps the planet several times. */
const polar = circleAround({ lon: 0, lat: 88 }, GENESIS.jtwcRadiusDeg);
const polarXs = polar.coordinates[0].map((p) => p[0]);
ok(
  Math.max(...polarXs) - Math.min(...polarXs) < 90,
  `a system at 88°N draws a wide ring, not an infinite one — span `
  + `${(Math.max(...polarXs) - Math.min(...polarXs)).toFixed(1)}°`
);

/* AND THE PANEL SAYS THE SHAPE IS OURS. The size argument is half of keeping
 * this honest; the words are the other half. A drawn boundary reads as a
 * measurement, and this one is not one. */
const panelSrc = fs.readFileSync('ui/view-area-detail.js', 'utf8');
ok(
  /indicative/.test(panelSrc),
  'the area panel tells the reader the JTWC shape is indicative rather than a '
  + 'published boundary'
);

/* ---------------------------------------------------------------------------
 * WHAT EACH PATCH SAYS ON THE GLOBE
 *
 * A JTWC patch drew with NO label at all — `globeProb` is null for every JTWC
 * system and the label builder skipped the whole feature — so a hatched shape
 * sat on the globe with no indication of how likely it was, beside NHC patches
 * that all carried figures. Seen on glass 2026-08-09.
 * ------------------------------------------------------------------------- */
section('§45.4 — every patch is labelled in its own source’s vocabulary');

const layerSrc = fs.readFileSync('map/layers/genesis.js', 'utf8');
ok(
  /titleCase\(normalizeRisk\(a\.risk\)\)/.test(layerSrc),
  'a JTWC patch is labelled with its RISK WORD, because that is what JTWC '
  + 'published — a patch with nothing on it beside patches carrying numbers '
  + 'reads as a rendering failure'
);
ok(
  !/orderWeight/.test(layerSrc),
  'and NOT with a number. Mapping HIGH onto an invented percentage is what '
  + '§45.3 forbids in as many words, and the map layer must not be the place '
  + 'it quietly happens'
);

/* The two vocabularies have to stay distinguishable. A reader tells them apart
 * because one is a figure and one is a word — that is the whole reason it is
 * safe to put both on one globe. */
ok(
  live.areas.filter((a) => a.source === 'NHC').every((a) => a.globeProb != null),
  'every NHC area carries a number for its patch'
);
ok(
  live.areas.filter((a) => a.source === 'JTWC').every((a) => a.globeProb == null && a.risk),
  'and every JTWC area carries a word and no number'
);

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the data is right; whether a hatched patch reads as "nothing');
console.log('   here yet" rather than as a storm is glass)');
process.exit(failures.length ? 1 : 0);
