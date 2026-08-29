/**
 * gazetteer.mjs — turn a point into "Bloomington, Texas, United States".
 * RUNNER ONLY. SPEC-SEASONS-BUILD.md §57.40.
 *
 * ==> THIS FILE MUST NEVER REACH A BROWSER, AND THAT IS WHY IT IS IN `tools/`.
 * <== Same seam as `tools/land-raster.mjs`: `lib/` is shipped code and `tools/`
 * is not, so the boundary is visible in the path. The three sources loaded here
 * total about 58 MB and 135,233 towns. What ships is one short string per
 * landfall — a few KB across the whole archive. The phone does no geometry and
 * downloads no gazetteer.
 *
 * ==> THE TOWN LIST IS THE ONE THE APP ALREADY SHIPS, AND THAT IS DELIBERATE.
 * <== `assets/hazards/population-towns.json` is built by
 * `tools/build-population.mjs` from `all-the-cities`, which is a packaging of
 * GeoNames. That file is stripped to `[lon, lat, pop]` to save bytes; the names
 * are still in the source. Using the same source here means the place named
 * beside a landfall and the dot on the population layer can never disagree
 * about where a town is.
 *
 * ==> A NAME WITHOUT ITS REGION IS A WRONG ANSWER, NOT A SHORT ONE. <== Aaron's
 * call, 2026-08-29. There is a Bloomington in Texas, in Indiana, in Illinois,
 * in Minnesota and in California, and a reader told a storm stalled near
 * "Bloomington" has been told nothing. Every answer this file gives carries as
 * much of `town, region, country` as can be established, and a region that
 * cannot be established is omitted rather than guessed.
 *
 * ==> THE REGION IS LOOKED UP FROM THE TOWN, NOT FROM THE STORM'S POINT. <==
 * This is the whole trick and it is worth spelling out. A landfall position sits
 * exactly ON the coastline by construction, and Natural Earth's admin-1 coast is
 * drawn from a different generalisation than the `ne_10m_land` outline
 * `tools/seasons-landfall.mjs` crosses. Measured 2026-08-29 against fifteen real
 * landfalls: testing the LANDFALL point against admin-1 put six of them outside
 * every polygon on Earth. Testing the nearest TOWN instead — which is by
 * definition inland — put fifteen of fifteen inside a polygon whose country code
 * agreed with GeoNames, with zero disagreements.
 *
 * ==> AND WHERE THE TWO SOURCES DISAGREE, NEITHER IS TRUSTED. <== GeoNames says
 * which country a town is in; Natural Earth says which polygon contains it. When
 * those differ the honest answer is that we do not know the region, so the
 * region is dropped and the country falls back to GeoNames'. Two sources
 * agreeing is evidence; two sources disagreeing is not a tiebreak.
 *
 * Requires `npm install all-the-cities`, the same ad-hoc dependency
 * `tools/build-population.mjs` already asks for. There is no package.json in
 * this repo by design.
 *
 * Imports config/ only. No DOM, no map, nothing shipped.
 */

import { createRequire } from 'node:module';

import { SEASONS } from '../config/constants.js';

const require = createRequire(import.meta.url);

/* ---------------------------------------------------------------------------
 * THE SOURCES
 * ------------------------------------------------------------------------- */

/** Pinned to the same commit as the coastline in `tools/seasons-landfall.mjs`.
 *  ==> IF THESE TWO EVER DIVERGE, A LANDFALL CAN BE COMPUTED AGAINST ONE
 *  COASTLINE AND NAMED AGAINST ANOTHER. <== One ref, imported from there, so
 *  moving the pin moves both or neither. */
export { NE_REF } from './seasons-landfall.mjs';

const NE_ADMIN0 = 'ne_10m_admin_0_countries.geojson';
const NE_ADMIN1 = 'ne_10m_admin_1_states_provinces.geojson';

const NE_URL = (ref, file) =>
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${ref}/geojson/${file}`;

/* ---------------------------------------------------------------------------
 * GEOMETRY
 * ------------------------------------------------------------------------- */

const R_KM = 6371;
const RAD = Math.PI / 180;

/** Great-circle kilometres. Haversine, because the alternative — flat
 *  Pythagoras on degrees — is wrong by a factor of `cos(lat)` in longitude, and
 *  at the latitude of Nova Scotia that is a 25% error in the distance that
 *  decides whether a town is close enough to name. */
export function haversineKm(latA, lonA, latB, lonB) {
  const dLat = (latB - latA) * RAD;
  const dLon = (lonB - lonA) * RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(latA * RAD) * Math.cos(latB * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

/** Even-odd ray cast. Winding is not consulted, so a ring's direction does not
 *  matter — the same choice `lib/landfall.js` makes for the same reason. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xk = ring[k][0], yk = ring[k][1];
    if (((yi > y) !== (yk > y)) && (x < (xk - xi) * (y - yi) / (yk - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. ==> THE HOLES ARE NOT
 *  DECORATION. <== Without them a point in Lesotho reads as South Africa and a
 *  point in the Vatican reads as Italy; closer to home, the Great Lakes are
 *  holes in several state polygons. */
function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}

/* ---------------------------------------------------------------------------
 * LOADING
 * ------------------------------------------------------------------------- */

/**
 * ISO 3166-1 alpha-2 to a country name a person would say.
 *
 * ==> `NAME_LONG` RATHER THAN `NAME`, AND THAT IS NOT A STYLE PREFERENCE. <==
 * Natural Earth's `NAME` field is abbreviated for map labels: Saint Vincent and
 * the Grenadines is `St. Vin. and Gren.`, Antigua and Barbuda is
 * `Antigua and Barb.`, the Dominican Republic is `Dominican Rep.`. Those are
 * cartographer's contractions sized to fit a label box, and this app is writing
 * a sentence. Measured across all 237 codes on 2026-08-29: `NAME_LONG` is
 * spelled out everywhere `NAME` is not.
 *
 * ==> AND `ISO_A2_EH` IS ASKED FIRST BECAUSE `ISO_A2` IS `-99` FOR FRANCE. <==
 * A known Natural Earth quirk affecting France, Norway and a handful of others,
 * where the sovereignty question is encoded by refusing to answer. `_EH` is the
 * field that answers.
 */
export function countryNames(geojsonText) {
  const parsed = JSON.parse(geojsonText);
  const map = new Map();
  for (const feature of parsed?.features || []) {
    const p = feature?.properties || {};
    const iso = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
    if (!iso || iso === '-99') continue;
    const name = p.NAME_LONG || p.NAME || p.ADMIN;
    if (name && !map.has(iso)) map.set(iso, name);
  }
  return map;
}

/**
 * Admin-1 polygons, each reduced to what a lookup needs plus a bounding box.
 *
 * ==> THE BOX IS THE WHOLE REASON THIS IS FAST. <== 4,596 polygons against
 * roughly 5,800 lookups is 27 million polygon tests done naively, each one
 * walking thousands of edges. A box rejection is four comparisons and throws
 * away better than 99% of the candidates before any ray is cast.
 *
 * ==> AND THE GEOMETRY IS DROPPED FROM THE PARSED TREE ON PURPOSE. <== The
 * admin-1 file is about 40 MB of JSON and holds thirty-odd properties per
 * feature that this job never reads. Keeping the parsed tree alive alongside the
 * town list is what pushed an earlier draft into a heap flag.
 */
export function adminRegions(geojsonText) {
  const parsed = JSON.parse(geojsonText);
  const out = [];
  for (const feature of parsed?.features || []) {
    const g = feature?.geometry;
    const p = feature?.properties || {};
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polys.length) continue;

    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const iso = p.iso_a2 && p.iso_a2 !== '-99' ? p.iso_a2 : null;
    out.push({ name: p.name || null, admin: p.admin || null, iso, polys, minX, minY, maxX, maxY });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * THE LOOKUP
 * ------------------------------------------------------------------------- */

/**
 * Build the answering machine.
 *
 * The town index is a one-degree grid. ==> A GRID AND NOT A LINEAR SCAN,
 * BECAUSE THE LINEAR SCAN IS THE JOB. <== 135,233 towns times roughly 5,800
 * points is 784 million haversines, which is minutes. The grid turns each
 * lookup into a handful of buckets.
 *
 * ==> THE SEARCH GROWS OUTWARD IN RINGS AND DOES NOT STOP AT THE FIRST HIT.
 * <== A town found in the ring at radius 1 can still be further away than one
 * in the ring at radius 2, because a bucket is a square and distance is a
 * circle. The walk continues until the ring's own inner edge is further than
 * the best answer so far, which is the point at which nothing further out can
 * win.
 */
export function createGazetteer({ cities, countries, regions }) {
  const grid = new Map();
  const key = (la, lo) => `${Math.floor(la)}|${Math.floor(lo)}`;
  for (const c of cities) {
    const [lon, lat] = c.loc.coordinates;
    const k = key(lat, lon);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push({ name: c.name, iso: c.country, lat, lon, pop: c.population });
  }

  /** Degrees of latitude per kilometre, used to size the ring walk. Longitude
   *  buckets are narrower away from the equator, which only ever makes the
   *  search MORE conservative, so one degree is the safe bound in both. */
  const KM_PER_DEGREE = 111.32;

  function region(lat, lon) {
    for (const r of regions) {
      if (lon < r.minX || lon > r.maxX || lat < r.minY || lat > r.maxY) continue;
      for (const poly of r.polys) if (pointInPolygon(lon, lat, poly)) return r;
    }
    return null;
  }

  /**
   * The nearest named town, or null when the nearest is further than the cap.
   *
   * ==> BEYOND THE CAP THE ANSWER IS NOTHING, NOT THE FAR-AWAY TOWN. <== §5's
   * shape. "Came ashore near Nouakchott" for a point 400 km down an empty
   * Mauritanian coast is a sentence that reads as a fact and is not one. The
   * caller renders coordinates instead, which is what the panel did before this
   * file existed and is never wrong.
   */
  function nearestPlace(lat, lon, capKm = SEASONS.placeNearKm) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const maxRing = Math.ceil(capKm / KM_PER_DEGREE) + 1;
    let best = null;

    for (let ring = 0; ring <= maxRing; ring++) {
      /* Nothing in this ring or beyond can beat what we already have. */
      if (best && (ring - 1) * KM_PER_DEGREE > best.km) break;
      for (let i = -ring; i <= ring; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          for (const t of grid.get(key(lat + i, lon + j)) || []) {
            const km = haversineKm(lat, lon, t.lat, t.lon);
            if (!best || km < best.km) best = { ...t, km };
          }
        }
      }
    }
    if (!best || best.km > capKm) return null;

    /* The region comes from the TOWN's position — see the header. */
    const r = region(best.lat, best.lon);
    const agrees = r && r.iso && best.iso && r.iso === best.iso;

    return {
      name: best.name,
      /* Dropped, never guessed, when the two sources disagree about the
       * country the town is in. */
      region: agrees ? r.name : null,
      /* ==> THE COUNTRY NAME COMES FROM THE ADMIN-0 FILE EVEN WHEN THE ADMIN-1
       * POLYGON OFFERS ONE. <== They are different fields with different
       * jobs: admin-1's `admin` is the sovereignty label and reads
       * "United States of America", while admin-0's `NAME_LONG` is the plain
       * form and reads "United States". This goes in a sentence, so the plain
       * form wins. The polygon's own answer is the fallback, and GeoNames'
       * code is what resolves it either way. */
      country: countries.get(best.iso) || (agrees ? r.admin : null) || null,
      km: Math.round(best.km),
      pop: best.pop,
    };
  }

  return { nearestPlace, region, towns: cities.length, regions: regions.length };
}

/**
 * Fetch and assemble. The network half, kept apart from the pure half above so
 * a suite can drive `createGazetteer` with three small fixtures.
 *
 * ==> A SHORT FETCH IS A FAILURE, NOT A SMALLER WORLD. <== The same rule and
 * the same reason as `fetchCoastline`: a truncated GeoJSON that happens to
 * break on a boundary still parses, and the result would be an archive missing
 * every region in half a hemisphere with nothing saying so.
 */
export async function loadGazetteer({ ref, fetchImpl = globalThis.fetch } = {}) {
  const { NE_REF } = await import('./seasons-landfall.mjs');
  const useRef = ref || NE_REF;

  const grab = async (file, floor) => {
    const res = await fetchImpl(NE_URL(useRef, file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < floor) throw new Error(`${file}: only ${text.length} bytes, refusing`);
    return text;
  };

  const [a0, a1] = await Promise.all([
    grab(NE_ADMIN0, 1_000_000),
    grab(NE_ADMIN1, 1_000_000),
  ]);

  let cities;
  try {
    cities = require('all-the-cities');
  } catch {
    throw new Error('all-the-cities is not installed — run: npm install all-the-cities');
  }
  if (!Array.isArray(cities) || cities.length < 100_000) {
    throw new Error(`all-the-cities returned ${cities?.length} towns, refusing`);
  }

  const countries = countryNames(a0);
  const regions = adminRegions(a1);
  if (countries.size < 200) throw new Error(`only ${countries.size} countries parsed, refusing`);
  if (regions.length < 3000) throw new Error(`only ${regions.length} regions parsed, refusing`);

  return createGazetteer({ cities, countries, regions });
}

/* ---------------------------------------------------------------------------
 * WRITING IT DOWN
 * ------------------------------------------------------------------------- */

/**
 * `town, region, country` as one string, with the parts that are missing simply
 * absent.
 *
 * ==> A REGION EQUAL TO ITS COUNTRY IS SAID ONCE. <== Several small states are
 * their own admin-1 unit, so the raw answer for a Barbados landfall is
 * `Crane, Barbados, Barbados`. That reads as a bug and is one repetition away
 * from being one.
 */
export function placeLabel(place) {
  if (!place?.name) return null;
  const parts = [place.name];
  if (place.region && place.region !== place.name && place.region !== place.country) {
    parts.push(place.region);
  }
  if (place.country && place.country !== place.name) parts.push(place.country);
  return parts.join(', ');
}
