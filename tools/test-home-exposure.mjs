#!/usr/bin/env node
/**
 * test-home-exposure.mjs — the at-home exposure block (SPEC §8).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-home-exposure.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ===========================================================================
 * WHAT THIS SUITE IS ACTUALLY GUARDING
 * ===========================================================================
 *
 * Not arithmetic. Every function under test returns a number that LOOKS
 * plausible whatever it does wrong, and the failure mode of this whole feature
 * is a true-looking sentence about somebody's house. So the assertions are
 * written against the SENTENCE, not the calculation:
 *
 *   - a Hurricane Warning 20 nm away must outrank a Tropical Storm Watch 2 nm
 *     away, because the headline has to be the worst thing being said about
 *     this address rather than the closest;
 *   - a home inside the "Above 12 ft" surge band must never be reported as
 *     "Up to 3 ft" because the bands nest and the shallow one also contains it;
 *   - a fetch that failed and a source that published nothing must not collapse
 *     into the same state (§5);
 *   - a warning line on the far side of the antimeridian must not read as
 *     14,000 nm away.
 *
 * ===========================================================================
 * THE MUTATION CHECKS
 * ===========================================================================
 *
 * §12: a test that passes on the same wrong assumption as the bug is worse than
 * no test. Several assertions below ALSO demonstrate that the naive
 * implementation gives a different answer — raw longitude subtraction really
 * does cross the planet, first-hit-wins on nested bands really does report the
 * shallowest, and no-cos(lat) distance really is 15% long at Gulf latitudes. If
 * those lines ever start agreeing with the real implementation, this suite has
 * stopped testing anything.
 *
 * WHAT IT CANNOT PROVE: that a coloured ring on the floating house reads as
 * "something is in effect here" rather than as decoration, and that the words
 * chosen are the words a person under a warning wants. Both are glass.
 */

import {
  pointInGeometry, nmToGeometry, nearestFeature, unwrapLon,
} from '../lib/hittest.js';
import { surgeBandIndex, readSurgeFeature, severestSurge } from '../lib/surge.js';
import {
  watchWarningAtHome, surgeAtHome, arrivalAtHome, exposureLevel,
  homeExposure, worstExposure, exposureLabel,
} from '../lib/home-exposure.js';
import { HOME_THREAT } from '../config/constants.js';
import { greatCircleNm } from '../lib/geo.js';

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const near = (a, b, tol, m) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`);
const section = (n) => console.log(`\n  ${n}`);

/* Somewhere real, so a wrong answer looks wrong: Grand Isle, Louisiana. */
const HOME = { lon: -89.98, lat: 29.24 };

const poly = (ring, ...holes) => ({ type: 'Polygon', coordinates: [ring, ...holes] });
const line = (coords) => ({ type: 'LineString', coordinates: coords });
const feat = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const box = (w, s, e, n) => poly([[w, s], [e, s], [e, n], [w, n], [w, s]]);

/* =========================================================================
 * 1. HIT TESTING
 * ========================================================================= */
section('hittest — inside, holes, and the antimeridian');

ok(pointInGeometry(-89.98, 29.24, box(-91, 28, -89, 30)), 'a point inside a box is inside it');
ok(!pointInGeometry(-95, 29.24, box(-91, 28, -89, 30)), 'and a point west of it is not');

/* HOLES FLIP. A surge band with a pocket of high ground inside it publishes
 * that pocket as a second ring, and a home standing in the pocket is NOT in
 * the band. Treating every ring as an outer boundary reports the opposite. */
const holed = poly(
  [[-91, 28], [-89, 28], [-89, 30], [-91, 30], [-91, 28]],
  [[-90.5, 28.5], [-89.5, 28.5], [-89.5, 29.5], [-90.5, 29.5], [-90.5, 28.5]]
);
ok(pointInGeometry(-90.8, 28.2, holed), 'inside the outer ring, outside the hole: inside');
ok(!pointInGeometry(-90, 29, holed), 'inside the hole: NOT inside the polygon');

/* A vertex exactly at the test latitude must not flicker. The half-open
 * comparison is what makes this stable; a `>=` on both sides double-counts. */
ok(
  pointInGeometry(-90, 29, box(-91, 28, -89, 30)) === true &&
  pointInGeometry(-90, 28, box(-91, 28, -89, 30)) === pointInGeometry(-90, 28, box(-91, 28, -89, 30)),
  'a point level with a ring vertex returns one stable answer'
);

/* THE ANTIMERIDIAN. A West Pacific warning line straddling the date line, and
 * a home just the other side of it. */
const wpacLine = line([[178, 12], [179.5, 12], [-179, 12]]);
const wpacHome = { lon: -179.5, lat: 12 };
const acrossNm = nmToGeometry(wpacHome.lon, wpacHome.lat, wpacLine).nm;
ok(acrossNm < 60, `a line across the date line is close, not a planet away (got ${acrossNm.toFixed(1)} nm)`);

/* MUTATION: the naive version. Raw subtraction reads 178 vs -179.5 as 357.5
 * degrees of separation — most of the way round the world. If this ever stops
 * disagreeing with the line above, the unwrap has been removed. */
const naiveDegGap = Math.abs(178 - wpacHome.lon);
ok(naiveDegGap > 300, 'raw longitude subtraction really does cross the planet (the bug this prevents)');
ok(Math.abs(unwrapLon(178, -179.5) - (-182)) < 1e-9, 'unwrapLon shifts 178E to -182 beside -179.5');

/* ZERO WHEN INSIDE. Not the distance to the boundary — a home standing in a
 * band is in the band, and "surge band 2 mi away" about it is a lie. */
ok(nmToGeometry(-90, 29, box(-91, 28, -89, 30)).nm === 0, 'a point inside a polygon is 0 nm from it');

/* LATITUDE SQUEEZE. One degree of longitude at 29N is ~52 nm, not 60. */
const eastNm = nmToGeometry(-90, 29, line([[-89, 28], [-89, 30]])).nm;
near(eastNm, 52.5, 1.5, 'one degree of longitude at 29N measures ~52 nm');
ok(Math.abs(eastNm - 60) > 5, 'and a no-cos(lat) implementation would say 60 (the bug this prevents)');

/* =========================================================================
 * 2. READING A SURGE FEATURE
 * ========================================================================= */
section('surge — the band comes out of popupinfo, and nesting is respected');

/* The shape NHC's own renderer parses: Split(PopupInfo,'"')[7]. */
const popup = (word) => `<div><b>Peak Storm Surge</b> class="${word}" scale="ft"</div>`;

ok(surgeBandIndex({ popupinfo: popup('yellow') }) === 1, 'yellow reads as band 1');
ok(surgeBandIndex({ popupinfo: popup('purple') }) === 4, 'purple reads as band 4');
ok(surgeBandIndex({ popupinfo: 'no colour word anywhere' }) === null, 'an unreadable popupinfo is null, not band 0');
ok(surgeBandIndex({ symbolid: 3 }) === null, 'symbolid alone is NOT read as a band');

const b = readSurgeFeature(feat(box(-91, 28, -89, 30), { popupinfo: popup('orange'), name: 'Vermilion Bay' }));
ok(b.label === 'Up to 9 ft', "NHC's own legend text is carried verbatim");
ok(b.name === 'Vermilion Bay', 'the place label survives');
ok(!/\d/.test(b.name), 'and the place label is not a number anybody could mistake for a depth');

/* NESTING. Every band contains the deeper ones, so a home in 12 ft of water is
 * inside all five polygons. Highest index must win. */
const nested = [
  feat(box(-92, 27, -88, 31), { popupinfo: popup('blue') }),
  feat(box(-91, 28, -89, 30), { popupinfo: popup('red') }),
  feat(box(-90.5, 28.5, -89.5, 29.5), { popupinfo: popup('purple') }),
];
ok(severestSurge(nested).label === 'Above 12 ft', 'the severest nested band wins');
/* MUTATION: first-hit-wins reports the shallowest. */
ok(readSurgeFeature(nested[0]).label === 'Up to 3 ft', 'and first-hit-wins would have said "Up to 3 ft" (the bug this prevents)');

/* =========================================================================
 * 3. WATCHES AND WARNINGS AT HOME
 * ========================================================================= */
section('watch/warning — severest first, and the five states stay apart');

const wwSlot = (features) => ({ status: 'ok', fc: { type: 'FeatureCollection', features } });

/* A Hurricane Warning up the coast and a Tropical Storm Watch on the doorstep.
 * SEVEREST LEADS. The headline is the worst thing being said about this
 * address, not the closest thing. */
const mixed = wwSlot([
  feat(line([[-90.5, 29.5], [-90.0, 29.6]]), { tcww: 'HWR' }),   // ~20 nm north
  feat(line([[-89.99, 29.25], [-89.97, 29.26]]), { tcww: 'TWA' }), // ~1 nm away
]);
const ww = watchWarningAtHome(HOME, mixed);
ok(ww.code === 'HWR', 'a Hurricane Warning 20 nm off leads a Tropical Storm Watch 1 nm off');
ok(ww.others.length === 1 && ww.others[0].code === 'TWA', 'and the watch is still listed');
/* MUTATION: sorting by distance alone picks the watch. */
ok(
  [...mixed.fc.features].sort((a, c) =>
    greatCircleNm(HOME.lon, HOME.lat, a.geometry.coordinates[0][0], a.geometry.coordinates[0][1]) -
    greatCircleNm(HOME.lon, HOME.lat, c.geometry.coordinates[0][0], c.geometry.coordinates[0][1])
  )[0].properties.tcww === 'TWA',
  'a nearest-first sort really would have led with the watch (the bug this prevents)'
);

/* ONE PRODUCT, SEVERAL SEGMENTS, ONE ROW. NHC publishes a single warning as
 * many line features; listing each would print the same words five times. */
const segmented = wwSlot([
  feat(line([[-90.2, 29.3], [-90.1, 29.3]]), { tcww: 'HWR' }),
  feat(line([[-90.1, 29.3], [-90.0, 29.3]]), { tcww: 'HWR' }),
  feat(line([[-90.0, 29.3], [-89.9, 29.3]]), { tcww: 'HWR' }),
]);
ok(watchWarningAtHome(HOME, segmented).others.length === 0, 'one product published as three segments is one row');

/* THE FIVE STATES DO NOT COLLAPSE (§5). */
ok(watchWarningAtHome(HOME, { status: 'unavailable' }).state === 'unavailable', 'a failed fetch stays "unavailable"');
ok(watchWarningAtHome(HOME, { status: 'none' }).state === 'none', 'a source publishing nothing stays "none"');
ok(watchWarningAtHome(HOME, { status: 'loading' }).state === 'loading', 'in flight stays "loading"');
ok(watchWarningAtHome(HOME, undefined).state === 'idle', 'and nothing asked for yet is "idle", not "none"');
ok(
  watchWarningAtHome(HOME, wwSlot([feat(line([[-70, 40], [-71, 41]]), { tcww: 'HWR' })])).state === 'clear',
  'a real warning 1,000 nm away reads as CLEAR near home, not as a warning'
);

/* THE AT-HOME / NEARBY BOUNDARY IS THE SENTENCE BOUNDARY. */
const atEdge = (nm) => {
  /* nm north of home, in degrees of latitude: 1 nm = 1 minute of arc. */
  const lat = HOME.lat + nm / 60;
  return wwSlot([feat(line([[HOME.lon - 0.2, lat], [HOME.lon + 0.2, lat]]), { tcww: 'HWA' })]);
};
ok(watchWarningAtHome(HOME, atEdge(HOME_THREAT.wwAtHomeNm - 3)).state === 'at-home', 'inside the corridor: "for your area"');
ok(watchWarningAtHome(HOME, atEdge(HOME_THREAT.wwAtHomeNm + 5)).state === 'nearby', 'outside it: named with a distance');
ok(watchWarningAtHome(HOME, atEdge(HOME_THREAT.wwNearbyNm + 20)).state === 'clear', 'past the nearby radius: not mentioned');

/* =========================================================================
 * 4. SURGE AT HOME
 * ========================================================================= */
section('surge at home — inside, just outside, and far');

const surgeSlot = (features) => ({ status: 'ok', fc: { type: 'FeatureCollection', features } });

const inside = surgeAtHome(HOME, surgeSlot(nested));
ok(inside.state === 'in-band' && inside.band.label === 'Above 12 ft', 'a home in the deepest nested band reports the deepest');
ok(inside.nm === 0, 'and its distance is zero, not a boundary distance');

const unclassified = surgeAtHome(HOME, surgeSlot([feat(box(-91, 28, -89, 30), { popupinfo: 'nothing readable' })]));
ok(unclassified.state === 'in-band-unclassified', 'a band we are standing in with no readable class says so');
ok(unclassified.state !== 'outside', 'and never falls through to "not in a band" (the bug this prevents)');

const justOut = surgeAtHome(HOME, surgeSlot([feat(box(-89.8, 29.1, -89.5, 29.4), { popupinfo: popup('red') })]));
ok(justOut.state === 'near' && justOut.nm > 0, 'a band a few miles away is "near" with a distance');

const wayOut = surgeAtHome(HOME, surgeSlot([feat(box(-75, 35, -74, 36), { popupinfo: popup('red') })]));
ok(wayOut.state === 'outside', 'a band in another state is "outside"');
ok(wayOut.nm > HOME_THREAT.surgeNearbyNm, 'and carries the distance so it cannot read as an all-clear for the street');

ok(surgeAtHome(HOME, { status: 'unavailable' }).state === 'unavailable', 'a failed surge fetch stays "unavailable"');
ok(surgeAtHome(HOME, { status: 'none' }).state === 'none', 'and no published surge product is "none", not "outside"');

/* =========================================================================
 * 5. WIND ARRIVAL
 * ========================================================================= */
section('wind arrival — the nearest contour, never an interpolation');

const arrSlot = (features) => ({ status: 'ok', fc: { type: 'FeatureCollection', features } });
const contour = (latOffsetNm, text) =>
  feat(line([[HOME.lon - 1, HOME.lat + latOffsetNm / 60], [HOME.lon + 1, HOME.lat + latOffsetNm / 60]]),
       { arrival_time: text });

const arr = arrivalAtHome(HOME, arrSlot([contour(20, '8 PM Mon'), contour(-60, '2 AM Tue')]));
ok(arr.state === 'ok' && arr.text === '8 PM Mon', "the nearest contour's own text is what is reported");
ok(arr.nm > 0 && arr.nm < HOME_THREAT.arrivalNearNm, 'with the distance to it, so the reader can see how much it speaks for them');
/* NOT INTERPOLATED — §4 says arrival is fetched, never computed. The answer is
 * one of the published strings, verbatim, and never a blend of two. */
ok(['8 PM Mon', '2 AM Tue'].includes(arr.text), 'and it is one of the published strings, never a blend');

const farArr = arrivalAtHome(HOME, arrSlot([contour(600, '8 PM Mon')]));
ok(farArr.state === 'far' && farArr.text === null, 'a contour 600 nm away says nothing rather than something invented');
ok(arrivalAtHome(HOME, { status: 'idle' }).state === 'idle', 'a GDACS storm with no arrival product is idle, not unavailable');

/* =========================================================================
 * 6. THE LEVEL THE GLOBE WEARS
 * ========================================================================= */
section('exposure level — surge outranks wind only at the top');

const lvl = (ww2, surge2) => exposureLevel({ ww: ww2, surge: surge2 });

ok(lvl({ state: 'at-home', code: 'HWR', color: '#E03030' }, null).level === 4, 'a Hurricane Warning for your area is level 4');
ok(lvl({ state: 'nearby', code: 'HWR', color: '#E03030' }, null).level === 3, 'the same warning up the coast drops a step');
ok(lvl({ state: 'clear' }, { state: 'outside' }).level === 0, 'nothing near home is level 0');

const deep = { state: 'in-band', band: { index: 4, color: '#AB47BC', label: 'Above 12 ft' } };
const surgeWins = lvl({ state: 'nearby', code: 'HWR', color: '#E03030' }, deep);
ok(surgeWins.level === 4, 'standing in a 12 ft band is level 4');
ok(surgeWins.color === '#AB47BC' && surgeWins.source === 'surge', 'and the mark wears the surge colour, because the water is at THIS house');

const windWins = lvl({ state: 'at-home', code: 'HWR', color: '#E03030' }, { state: 'near' });
ok(windWins.source === 'watch-warning' && windWins.color === '#E03030', 'a warning for your area beats a surge band two streets over');

/* THE COLOUR IS ALWAYS A §6 FIXED HEX, NEVER A THEME TOKEN. */
ok(/^#[0-9A-F]{6}$/i.test(surgeWins.color) && /^#[0-9A-F]{6}$/i.test(windWins.color), 'both colours are literal product hexes, not tokens');

/* =========================================================================
 * 7. THE WHOLE OBJECT, AND THE WORST OF SEVERAL STORMS
 * ========================================================================= */
section('homeExposure — the stamp rides along, and the worst storm wins');

const full = homeExposure(
  HOME,
  { watchWarning: mixed, surge: surgeSlot(nested), arrivalLikely: arrSlot([contour(20, '8 PM Mon')]) },
  { stormId: 'nhc:al092026', stormName: 'Ida', observedAt: '2026-08-09T15:00:00Z', advisoryKey: 'al092026#21' }
);
ok(full.observedAt === '2026-08-09T15:00:00Z', 'the advisory time is on the same object as the figures (§8)');
ok(full.advisoryKey === 'al092026#21', 'and so is the advisory key');
ok(full.level === 4 && full.source === 'surge', 'the level and its source come out together');
ok(homeExposure(null, {}) === null, 'no home is null, never a zero');

const worse = { level: 4, ww: { nm: 5 }, stormId: 'a' };
const milder = { level: 2, ww: { nm: 1 }, stormId: 'b' };
ok(worstExposure([milder, worse]).stormId === 'a', 'the severest storm wins, not the nearest');
ok(worstExposure([{ level: 0 }, { level: 0 }]) === null, 'and nothing in effect anywhere is null');

/* THE LABEL NAMES THE PRODUCT, NEVER OUR LEVEL NUMBER. */
const label = exposureLabel(full);
ok(typeof label === 'string' && /ft|Warning|Watch|surge/i.test(label), `the marker label names the product ("${label}")`);
ok(!/level/i.test(label || ''), 'and never says "level 4", which means nothing to anybody');
ok(exposureLabel({ level: 0 }) === null, 'nothing in effect has no label, so the plain one goes back');

/* =========================================================================
 * 8. THE PRIVACY SEAM — WHAT ACTUALLY GOES ON THE WIRE
 * =========================================================================
 *
 * ==> THIS IS THE MOST IMPORTANT ASSERTION IN THE FILE. <== Home coordinates
 * are the most sensitive thing this app touches and they never leave the
 * device (§8, §17). The surge query is the ONE place that rule is easy to
 * break by accident, because a tight envelope around the user's house would be
 * a smaller, faster query and would look like an optimisation in review.
 *
 * `tools/privacy-check.mjs` drives a real browser and needs Playwright, so it
 * does not run in a bare sandbox. This does, on plain node, by stubbing the
 * fetch and reading the URL that was built.
 */
section('privacy — the storm goes in the URL, the house never does');

const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  seen.push(String(url));
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ type: 'FeatureCollection', features: [] }),
  };
};

const { fetchSurge, surgeKey, forgetSurge } = await import('../data/surge.js');

/* A storm at a fractional position, and a home at a DIFFERENT fractional
 * position. Neither exact number may appear in the request. */
forgetSurge();
await fetchSurge(-89.4137, 28.6612);
globalThis.fetch = realFetch;

const url = seen[0] || '';
ok(seen.length === 1, 'one request was made');
ok(/lon=-89(&|$)/.test(url) && /lat=29(&|$)/.test(url), `the storm position is rounded to whole degrees (${url})`);
ok(!url.includes('89.4137') && !url.includes('28.6612'), 'the exact storm position is not in the URL either');
ok(!url.includes(String(HOME.lon)) && !url.includes(String(HOME.lat)), "and the HOME coordinates are nowhere in it");
ok(!/home/i.test(url), 'nothing in the URL is even named "home"');

/* Math.round, not trunc — trunc pulls toward zero, so a storm at -89.6 and one
 * at 89.6 would round in opposite directions relative to the ground. */
ok(surgeKey(-89.6, 28.6).lon === -90, 'a western storm rounds away from zero, like an eastern one');
ok(Math.trunc(-89.6) === -89, 'and trunc really would have gone the other way (the bug this prevents)');

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`
);
console.log('  (the geometry is right; whether a coloured ring on the house reads');
console.log('   as "in effect here" rather than decoration is glass)');
process.exit(failures.length ? 1 : 0);
