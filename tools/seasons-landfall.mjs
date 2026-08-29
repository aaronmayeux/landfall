/**
 * seasons-landfall.mjs — compute every landfall in the archive, on the runner.
 * SPEC-SEASONS-BUILD.md §57.7a, §57.30 step 14.
 *
 * ==> NOTHING THIS BUILDS REACHES A PHONE, AND THAT IS THE WHOLE SHAPE OF THE
 * FEATURE. <== The land mask is 119 MB. It is fetched, built, used and thrown
 * away inside one runner job; what ships is the ANSWER — a flag per storm in
 * `seasons/wall.json` and a small list per basin in `seasons/data/`. The app
 * gains no bytes on its boot path and does no geometry at run time.
 *
 * ==> THE COASTLINE IS PINNED TO A COMMIT, NOT TO A BRANCH. <== Natural Earth
 * is fetched from the GitHub mirror at a fixed ref below. On `master` the
 * coastline could be revised between two monthly runs and every landfall in
 * 175 years would quietly change with nothing in the diff explaining why.
 * Moving the pin is a deliberate act with a re-measurement attached.
 *
 * ==> AND `map/coastline.js` IS NOT THE SOURCE, THOUGH IT IS RIGHT THERE. <==
 * That file is Natural Earth 1:110m — 126 rings and 5,123 vertices, mean
 * segment about 100 km. Measured 2026-08-27 against it: Barbados is 296 km
 * from the nearest vertex, Dominica 502 km, Grand Cayman 301 km, Bermuda
 * 1,092 km. Maria's Dominica landfall would read as open ocean. It is a
 * DRAWING asset, it is correct for drawing, and it must never be used as a
 * land test. This is the reason a second coastline exists at all.
 *
 * RUNNER-ONLY, like `seasons-slice.mjs` and `seasons-wall.mjs`, and for the
 * same reason: every import in every file ships to every visitor (§12, no
 * build step) and a phone has no use for a scanline rasteriser.
 *
 * Usage:
 *   node tools/seasons-landfall.mjs            write the files
 *   node tools/seasons-landfall.mjs --check    compare against NOAA, write nothing
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SEASONS } from '../config/constants.js';
import { parseHurdat2 } from '../lib/hurdat.js';
import { landfallsFor } from '../lib/landfall.js';
import { landfallFileName } from '../lib/seasons-sidecar.js';
import { buildLandMask } from './land-raster.mjs';

/* ---------------------------------------------------------------------------
 * THE COASTLINE
 * ------------------------------------------------------------------------- */

/** nvkelso/natural-earth-vector, pinned. See the header — a branch here means
 *  175 years of history can change under us between two runs. */
export const NE_REF = 'v5.1.2';

/** ==> BOTH FILES, AND THE SECOND ONE IS NOT OPTIONAL. <== `ne_10m_land` holds
 *  the continents and the large islands; `ne_10m_minor_islands` holds the rest,
 *  and "the rest" in this basin means Barbados, Antigua, Martinique and about
 *  2,800 others. Measured with land alone, several Lesser Antilles landfalls
 *  read as open ocean. */
export const NE_FILES = Object.freeze([
  'ne_10m_land.geojson',
  'ne_10m_minor_islands.geojson',
]);

const NE_URL = (file) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_REF}/geojson/${file}`;

/** Every ring in a GeoJSON FeatureCollection, flattened. Winding is irrelevant
 *  — the scanline fill in `lib/landfall.js` never asks. */
export function ringsFromGeoJson(text) {
  const parsed = JSON.parse(text);
  const out = [];
  for (const feature of parsed?.features || []) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    for (const poly of polys) for (const ring of poly) out.push(ring);
  }
  return out;
}

/**
 * Fetch the coastline.
 *
 * ==> A SHORT FETCH IS A FAILURE, NOT A SMALLER COASTLINE. <== A truncated
 * response still parses if it happens to break on a boundary, and the result
 * would be an archive with a coastline missing from it — landfalls silently
 * absent for a whole ocean, with nothing on screen or in the log saying so.
 * Every file is size-checked against a floor before it is used.
 */
export async function fetchCoastline({ fetchImpl = globalThis.fetch } = {}) {
  const rings = [];
  const seen = [];
  for (const file of NE_FILES) {
    const res = await fetchImpl(NE_URL(file));
    if (!res.ok) throw new Error(`coastline ${file}: HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < 100_000) throw new Error(`coastline ${file}: only ${text.length} bytes, refusing`);
    const got = ringsFromGeoJson(text);
    if (!got.length) throw new Error(`coastline ${file}: parsed to zero rings`);
    rings.push(...got);
    seen.push({ file, bytes: text.length, rings: got.length });
  }
  return { rings, seen, ref: NE_REF };
}

/* ---------------------------------------------------------------------------
 * THE ARCHIVE
 * ------------------------------------------------------------------------- */

/** Where each basin's answers go. Under `seasons/data/` deliberately: that
 *  directory is already `immutable` in `_headers` and already carries a
 *  revision stamp in every filename, so this inherits both rather than needing
 *  a new rule and a new hand-written header line (§57.16a). */
export const landfallFile = (basin, revision) => `seasons/data/${landfallFileName(basin, revision)}`;

/**
 * One basin, walked.
 *
 * ==> KEYED BY STORM ID, NOT BY YEAR. <== The Central Pacific rides inside the
 * East Pacific file and `seasons-wall.mjs` records what happened the last time
 * something keyed those two on year and basin — 82 storms overwritten, and a
 * season drawing as a single dot. An ATCF id is unique across both.
 *
 * ==> A STORM WITH NO LANDFALL IS ABSENT, NOT AN EMPTY ARRAY. <== It is the
 * overwhelmingly common case — 1,923 of 3,266 — and the reader's lookup
 * already has to handle "this id is not in the file" for a storm the walk
 * never saw. Writing 1,923 empty arrays would be about 40 KB saying nothing.
 */
export function basinLandfalls(text, isLand) {
  const parsed = parseHurdat2(String(text ?? ''));
  const out = {};
  const refused = {};
  let storms = 0;
  let events = 0;
  let ashore = 0;
  let declinedEvents = 0;
  for (const storm of parsed?.storms || []) {
    storms++;
    /* ==> THE REFUSALS COME OUT OF THE SAME WALK, NOT A SECOND ONE. <== §57.7e.
     * `lib/landfall.js` fills this array at the one point where a real coast
     * crossing stops being a landfall. Counting them from outside would be a
     * second opinion about the same question. */
    const declined = [];
    const list = landfallsFor(storm.points, isLand, { declined });
    /* ==> A COUNT RATHER THAN THE RECORDS, AND THAT IS A SIZE DECISION. <== The
     * panel says one sentence about these; it never lists them. Shipping 135
     * position records to say "one more crossing did not count" would be bytes
     * on every phone for a number. */
    if (declined.length) {
      refused[storm.id] = declined.length;
      declinedEvents += declined.length;
    }
    if (!list.length) continue;
    ashore++;
    events += list.length;
    out[storm.id] = list;
  }
  return { landfalls: out, declined: refused, storms, events, ashore, declinedEvents };
}

/**
 * How well this agrees with NOAA, over one basin.
 *
 * ==> IT IS MEASURED EVERY RUN RATHER THAN QUOTED FROM A COMMIT MESSAGE. <==
 * The pinned coastline can move, the parser can change, and the archive gains
 * a season every February. A figure in a header goes stale silently; this one
 * is printed by the job that produced it.
 *
 * The per-STORM question is the one reported, because the per-EVENT one cannot
 * be answered honestly: 600 of NOAA's 1,314 markers sit on water against any
 * global coastline (§57.7a), so an event-level score measures the rounding in
 * NOAA's own positions more than it measures this code.
 *
 * ==> AND A DELIBERATE DIFFERENCE IS NOT A MISS. <== NOAA marks landfall for a
 * system that has already gone EXTRATROPICAL — Ophelia on Ireland in 2017 and
 * Lee on Nova Scotia in 2023 are both stamped `EX` at their own `L` record.
 * This app does not call that a tropical cyclone landfall anywhere else, so it
 * does not here either, and counting those as failures would hide the real
 * ones. They are reported separately and the headline score excludes them from
 * neither side — it simply names which is which.
 */
export function agreementWithNoaa(text, isLand) {
  const parsed = parseHurdat2(String(text ?? ''));
  let bothYes = 0, noaaOnly = 0, oursOnly = 0, bothNo = 0;
  const missed = [];
  const extratropical = [];
  for (const storm of parsed?.storms || []) {
    const pts = storm.points || [];
    const marks = pts.filter((p) => String(p.marker || '').toUpperCase() === 'L');
    const ours = landfallsFor(pts, isLand).length > 0;
    const label = `${storm.id} ${storm.name || '(unnamed)'}`;
    if (marks.length && ours) bothYes++;
    else if (marks.length && !ours) {
      noaaOnly++;
      /* Every one of NOAA's marks on a system we no longer call a cyclone. */
      const allEx = marks.every((p) => !SEASONS.cycloneStatuses.includes(String(p.status || '').toUpperCase()));
      (allEx ? extratropical : missed).push(label);
    } else if (!marks.length && ours) oursOnly++;
    else bothNo++;
  }
  return { bothYes, noaaOnly, oursOnly, bothNo, missed, extratropical };
}

/**
 * Write one basin's file, and say whether anything changed.
 *
 * Compared as a whole rather than by timestamp: this file carries no stamp at
 * all, so an unchanged archive produces a byte-identical file and the runner
 * commits nothing. Same rule `syncWall` follows, reached more cheaply because
 * there is no field to strip.
 */
export function syncLandfalls(root, basin, revision, payload) {
  const path = join(root, landfallFile(basin, revision));
  const next = `${JSON.stringify(payload)}\n`;
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (prev === next) return { written: false, bytes: next.length, path };
  writeFileSync(path, next);
  return { written: true, bytes: next.length, path };
}

/* ---------------------------------------------------------------------------
 * THE JOB
 * ------------------------------------------------------------------------- */

export async function main(argv = []) {
  const root = process.cwd();
  const check = argv.includes('--check');

  const indexPath = join(root, 'seasons/index.json');
  if (!existsSync(indexPath)) {
    console.error('seasons/index.json is missing — run tools/seasons-hurdat.mjs first');
    return 1;
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));

  console.log(`coastline: natural-earth-vector @ ${NE_REF}`);
  const coast = await fetchCoastline();
  for (const s of coast.seen) console.log(`  ${s.file}  ${(s.bytes / 1e6).toFixed(1)} MB  ${s.rings} rings`);

  const t0 = Date.now();
  const mask = buildLandMask(coast.rings);
  console.log(`  mask ${mask.width}x${mask.height} @ ${mask.step}°  ${(mask.cells / 1e6).toFixed(0)} MB  built in ${Date.now() - t0} ms`);

  let totalStorms = 0, totalEvents = 0, totalAshore = 0, wrote = 0;
  let agBothYes = 0, agNoaaOnly = 0, agOursOnly = 0;
  const allMissed = [];
  const allEx = [];

  for (const [basin, entry] of Object.entries(index?.basins || {})) {
    const name = String(entry?.file || '').split('/').pop();
    if (!name) continue;
    const path = join(root, 'seasons/data', name);
    if (!existsSync(path)) {
      console.error(`  ${basin}: ${name} is not on disk — refusing to write a partial archive`);
      return 1;
    }
    const text = readFileSync(path, 'utf8');

    const t = Date.now();
    const { landfalls, declined, storms, events, ashore, declinedEvents } = basinLandfalls(text, mask.isLand);
    const walkMs = Date.now() - t;

    const ag = agreementWithNoaa(text, mask.isLand);
    agBothYes += ag.bothYes; agNoaaOnly += ag.noaaOnly; agOursOnly += ag.oursOnly;
    allMissed.push(...ag.missed);
    allEx.push(...ag.extratropical);

    totalStorms += storms; totalEvents += events; totalAshore += ashore;

    const payload = {
      basin,
      revision: entry.revision,
      coastline: `natural-earth-vector@${NE_REF}`,
      maskStep: SEASONS.landfallMaskStep,
      sampleKm: SEASONS.landfallSampleKm,
      separationKm: SEASONS.landfallSeparationKm,
      /* ==> SAID IN THE FILE, NOT ONLY IN A SPEC SECTION. <== A reader of this
       * JSON in two years should not have to find §57.7a to learn these are
       * ours rather than NOAA's. */
      source: 'computed',
      storms: landfalls,
      /* ==> A SIBLING MAP RATHER THAN A FIELD INSIDE EACH ENTRY. <== §57.7e.
       * `storms` is keyed id -> array-of-landfalls and four readers index it
       * that way. Turning each value into an object would move all four for a
       * number that belongs to the STORM rather than to any one landfall — and
       * the 26 storms that most need this have an empty array to hang it on.
       * A key absent here means zero, not unknown: the walk ran for every
       * storm in this file, which is what `source: 'computed'` above states. */
      declined,
    };

    console.log(`  ${basin}: ${storms} storms, ${ashore} came ashore, ${events} landfalls, ${declinedEvents} crossings refused, walked in ${walkMs} ms`);

    if (!check) {
      const r = syncLandfalls(root, basin, entry.revision, payload);
      if (r.written) wrote++;
      console.log(`    ${r.written ? 'wrote' : 'unchanged'} ${landfallFile(basin, entry.revision)} (${(r.bytes / 1024).toFixed(1)} KB)`);
    }
  }

  const marked = agBothYes + agNoaaOnly;
  console.log(`\narchive: ${totalStorms} storms, ${totalAshore} came ashore, ${totalEvents} landfalls`);
  console.log(`agreement with NOAA, per storm, over the ${marked} NOAA marked at all: ${(100 * agBothYes / marked).toFixed(1)}%`);
  console.log(`  NOAA marked and we do not: ${agNoaaOnly}`);
  console.log(`    of those, extratropical at NOAA's mark — a deliberate difference: ${allEx.length}`);
  if (allEx.length) console.log(`      ${allEx.join(', ')}`);
  console.log(`    genuine misses, at the 0.1° position floor: ${allMissed.length}`);
  if (allMissed.length) console.log(`      ${allMissed.join(', ')}`);
  console.log(`  we mark and NOAA never did: ${agOursOnly}`);

  if (check) console.log('\n--check: nothing written');
  else console.log(`\n${wrote} file${wrote === 1 ? '' : 's'} written`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
