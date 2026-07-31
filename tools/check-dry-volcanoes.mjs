/**
 * check-dry-volcanoes.mjs — IS ANY VOLCANO BEING HANDED A SEAFLOOR IT DOES NOT
 * STAND ON?
 *
 * ==> WHY THIS TOOL EXISTS. <== The catalog has no field anywhere that says
 * whether a volcano is under water, so `lib/volcano-shape.js` carries a short
 * hand-checked list of the ones that are below sea level and still on dry land.
 * A hand-checked list is only honest for as long as somebody re-checks it, and
 * the catalog is refetched. So this re-derives the CANDIDATES from the shipped
 * data and fails if one turns up that the list does not already name.
 *
 * ==> IT PROPOSES, IT DOES NOT DECIDE. <== The test here is "does this point
 * fall inside a landmass in `map/coastline.js`", and that outline is coarse —
 * its points sit a median 63 km apart and it omits small islands entirely. So
 * it is run with a wide margin and its answer is a QUESTION for a human, never
 * an automatic classification. A candidate inside the margin means "go and look
 * at this one", not "add it".
 *
 * That is also exactly why the shipped predicate is a list and not this test:
 * at a margin narrow enough to be useful near a coast it puts the Tjornes
 * Fracture Zone, which is genuinely offshore Iceland, 8 km inland.
 *
 * Run: node tools/check-dry-volcanoes.mjs
 */

import { readFileSync } from 'fs';
import { RINGS } from '../map/coastline.js';
import { isSubmarine } from '../lib/volcano-shape.js';

/** How far inside a landmass a volcano has to sit before this tool will raise
 *  it. Comfortably wider than the coastline's own ~63 km point spacing, so a
 *  candidate is inland by more than the data's error rather than by less. */
const INLAND_MARGIN_KM = 50;

const M_PER_DEG_LAT = 111320;

const gj = JSON.parse(
  readFileSync(new URL('../assets/hazards/volcanoes-holocene.geojson', import.meta.url), 'utf8')
);

function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance in metres to one coastline segment, flat about the query point. */
function segDistM(lon, lat, a, b) {
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const wrap = (d) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);
  const ax = wrap(a[0] - lon) * M_PER_DEG_LAT * cosLat;
  const ay = (a[1] - lat) * M_PER_DEG_LAT;
  const bx = wrap(b[0] - lon) * M_PER_DEG_LAT * cosLat;
  const by = (b[1] - lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? (-ax * dx - ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function nearestCoastKm(lon, lat) {
  let best = Infinity;
  for (const ring of RINGS) {
    for (let i = 1; i < ring.length; i++) {
      const lo = Math.min(ring[i - 1][1], ring[i][1]);
      const hi = Math.max(ring[i - 1][1], ring[i][1]);
      if (lat < lo - 6 || lat > hi + 6) continue;
      const d = segDistM(lon, lat, ring[i - 1], ring[i]);
      if (d < best) best = d;
    }
  }
  return best / 1000;
}

const belowSea = gj.features.filter((f) => Number(f.properties.elev) < 0);

const candidates = [];
for (const f of belowSea) {
  const lon = f.geometry.coordinates[0];
  const lat = f.geometry.coordinates[1];
  let onLand = false;
  for (const ring of RINGS) {
    if (inRing(ring, lon, lat)) {
      onLand = true;
      break;
    }
  }
  if (!onLand) continue;
  const km = nearestCoastKm(lon, lat);
  candidates.push({
    n: Number(f.properties.n),
    name: f.properties.name,
    elev: Number(f.properties.elev),
    country: f.properties.country || '',
    km,
    /* Does the shipped predicate already know this one is dry? */
    handled: !isSubmarine({ n: f.properties.n, elev: f.properties.elev }),
  });
}

candidates.sort((a, b) => b.km - a.km);

console.log(`catalog ${gj.features.length} · below sea level ${belowSea.length}`);
console.log(`inside a landmass in map/coastline.js: ${candidates.length}`);
console.log(`raising anything more than ${INLAND_MARGIN_KM} km inland\n`);

let fail = 0;
for (const c of candidates) {
  const deep = c.km > INLAND_MARGIN_KM;
  let verdict;
  if (c.handled) verdict = 'known dry  ';
  else if (deep) {
    verdict = 'UNHANDLED  ';
    fail++;
  } else verdict = 'inside noise';
  console.log(
    `  ${verdict} ${c.km.toFixed(0).padStart(4)} km inland · ${String(c.elev).padStart(6)} m · ` +
      `${String(c.n).padEnd(7)} ${c.name.padEnd(28)} ${c.country}`
  );
}

/* A named exception that no longer shows up is just as wrong as a missing one:
 * it means the list is describing a catalog that is no longer shipped. */
const namedButAbsent = [221041, 323200].filter(
  (n) => !candidates.some((c) => c.n === n)
);
for (const n of namedButAbsent) {
  console.log(`  STALE        ${n} is named in DRY_BELOW_SEA_LEVEL but is not a candidate any more`);
  fail++;
}

console.log('');
if (fail) {
  console.log(`FAIL — ${fail} volcano(es) need a human decision in lib/volcano-shape.js.`);
  console.log('Look each one up. If it is on dry ground, add its number to');
  console.log('DRY_BELOW_SEA_LEVEL with a one-line note saying where it is.');
  process.exit(1);
}
console.log('PASS — every below-sea-level volcano on land is already accounted for.');
