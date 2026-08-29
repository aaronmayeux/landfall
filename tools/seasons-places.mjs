/**
 * seasons-places.mjs — name every spot the archive points at, on the runner.
 * SPEC-SEASONS-BUILD.md §57.40, §57.42 Tier 2 item 1.
 *
 * ==> THE GAZETTEER IS 58 MB AND WHAT SHIPS IS A FEW KILOBYTES OF STRINGS.
 * <== The same shape as `tools/seasons-landfall.mjs`: 135,233 towns and 4,596
 * admin-1 polygons are fetched, used and thrown away inside one runner job, and
 * the phone downloads the ANSWERS. It does no geometry and holds no gazetteer.
 *
 * ==> ITS OWN FILE RATHER THAN A FIELD IN THE LANDFALL SIDECAR. <== §57.42.
 * Two jobs must never write one file, and a places failure has to degrade to
 * coordinates without taking landfalls down with it. The landfall sidecar is
 * the one that decides whether a storm came ashore; this one only decides what
 * to CALL the spot, and losing it costs a name rather than a fact.
 *
 * ==> AND IT READS THE LANDFALL SIDECAR RATHER THAN RECOMPUTING LANDFALLS.
 * <== Two reasons and both matter. It means this job needs no 119 MB land mask
 * and runs in seconds. And it means the places array is index-aligned with the
 * list the phone will actually hold, by construction — a second walk against a
 * coastline that had moved would produce a different list and put Cameron's
 * name on a Florida landfall.
 *
 * ==> A STORM ABSENT FROM `storms` MEANS "WE LOOKED AND FOUND NOTHING TO
 * NAME", NOT "WE DID NOT LOOK". <== §5, and it is the same convention the
 * landfall sidecar already uses for a storm that stayed at sea. The FILE being
 * on screen is what carries "this basin was walked"; a missing entry inside it
 * is an answer. `data/seasons.js` keeps the two apart by handing the story
 * `null` when the file did not arrive and an object when it did.
 *
 * RUNNER-ONLY, like `seasons-landfall.mjs` and `seasons-slice.mjs`, and for
 * the same reason: every import in every file ships to every visitor (§12, no
 * build step).
 *
 * Requires `npm install all-the-cities` — the same ad-hoc dependency
 * `tools/build-population.mjs` and `tools/gazetteer.mjs` already ask for.
 *
 * Usage:
 *   node tools/seasons-places.mjs            write the files
 *   node tools/seasons-places.mjs --check    walk and report, write nothing
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SEASONS } from '../config/constants.js';
import { landfallFileName, placesFileName } from '../lib/seasons-sidecar.js';
import { parseHurdat2 } from '../lib/hurdat.js';
import { stallWindow } from '../lib/season-story.js';
import { loadGazetteer, placeLabel } from './gazetteer.mjs';
import { NE_REF } from './seasons-landfall.mjs';

/** Where a basin's names go. Under `seasons/data/` deliberately: that
 *  directory is already `immutable` in `_headers` by a wildcard and already
 *  carries a revision stamp in every filename, so this inherits both rather
 *  than needing a new hand-written header line (§57.16a). */
export const placesFile = (basin, revision) => `seasons/data/${placesFileName(basin, revision)}`;

/**
 * ==> LONGITUDE COMES OUT OF THE ARCHIVE UNWRAPPED AND THE GAZETTEER EXPECTS
 * IT WRAPPED. <== `lib/hurdat.js` carries `lonU`, which runs continuously past
 * ±180 so a track crossing the date line is one line rather than two, and
 * `lib/landfall.js` writes that same unwrapped value into every landfall it
 * records. A Central Pacific storm ashore in the Marshall Islands therefore
 * arrives here at 187°E. Handed to a town index keyed on real longitude that is
 * a point in the middle of the Atlantic, and the answer would be a confident
 * wrong name rather than no name at all.
 */
export function wrapLon(lon) {
  if (!Number.isFinite(lon)) return lon;
  /* ==> A LONGITUDE ALREADY IN RANGE IS RETURNED UNTOUCHED, AND THAT IS NOT AN
   * OPTIMISATION. <== `((x + 180) % 360 + 360) % 360 - 180` is exact in
   * arithmetic and is not in floating point: it turns 179.9 into
   * 179.89999999999998. Every longitude in the archive would be nudged by a
   * few billionths of a degree for no reason, and a value that goes in and
   * comes out unequal to itself is the kind of thing that later reads as a
   * cache miss or a failed comparison with nothing explaining it. */
  if (lon > -180 && lon <= 180) return lon;
  const x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
}

/** `{ name, km }` or null. The gazetteer's own answer carries a population and
 *  a raw region that nothing downstream reads, and shipping them would be
 *  bytes on a phone for a field no sentence uses. */
export function placeEntry(gaz, lat, lon, capKm) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hit = gaz.nearestPlace(lat, wrapLon(lon), capKm);
  const name = placeLabel(hit);
  return name ? { name, km: hit.km } : null;
}

/**
 * One basin, named.
 *
 * ==> THE STALL IS COMPUTED HERE AND WRITTEN DOWN WHOLE, RATHER THAN LEAVING
 * THE PHONE TO RE-DERIVE THE WINDOW AND LOOK UP ONLY THE NAME. <== The phone
 * would have to reproduce this window exactly for the name to belong to it, and
 * nothing would notice if it stopped doing so — a constant moved without a new
 * revision stamp would silently attach the right name to the wrong three days.
 * A self-contained answer cannot drift. `lib/season-story.js` still owns the
 * algorithm and the season in progress still runs it on the device, so there is
 * one implementation either way.
 */
export function basinPlaces(text, marks, gaz) {
  const parsed = parseHurdat2(String(text ?? ''));
  const out = {};
  let storms = 0;
  let named = 0;
  let landfallMarks = 0;
  let landfallNamed = 0;
  let stalls = 0;
  let stallsNamed = 0;

  for (const storm of parsed?.storms || []) {
    storms++;
    const pts = storm.points || [];
    const first = pts[0];

    const genesis = first
      ? placeEntry(gaz, first.lat, first.lonU ?? first.lon, SEASONS.placeFarKm)
      : null;

    const list = marks?.[storm.id] || [];
    landfallMarks += list.length;
    const landfalls = list.map((lf) => {
      const p = placeEntry(gaz, lf.lat, lf.lon, SEASONS.placeNearKm);
      if (p) landfallNamed++;
      return p;
    });

    const window = stallWindow(pts);
    let stall = null;
    if (window) {
      stalls++;
      const p = placeEntry(gaz, window.lat, window.lon, SEASONS.placeFarKm);
      if (p) stallsNamed++;
      stall = {
        at: window.startTime,
        hours: Math.round(window.hours),
        name: p ? p.name : null,
        km: p ? p.km : null,
      };
    }

    /* Nothing to say about this storm, so it is not in the file. See the
     * header: the file's presence is what says the basin was walked. */
    if (!genesis && !stall && !landfalls.some(Boolean)) continue;
    named++;
    const entry = {};
    if (genesis) entry.genesis = genesis;
    if (landfalls.length) entry.landfalls = landfalls;
    if (stall) entry.stall = stall;
    out[storm.id] = entry;
  }

  return { places: out, storms, named, landfallMarks, landfallNamed, stalls, stallsNamed };
}

/**
 * Write one basin's file, and say whether anything changed.
 *
 * Compared whole rather than by timestamp, the same way `syncLandfalls` does
 * and for the same reason: this file carries no stamp of its own, so an
 * unchanged archive produces byte-identical output and the runner commits
 * nothing.
 */
export function syncPlaces(root, basin, revision, payload) {
  const path = join(root, placesFile(basin, revision));
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

  console.log(`gazetteer: natural-earth-vector @ ${NE_REF} + all-the-cities (GeoNames)`);
  const t0 = Date.now();
  const gaz = await loadGazetteer();
  console.log(`  ${gaz.towns.toLocaleString()} towns, ${gaz.regions.toLocaleString()} regions, loaded in ${Date.now() - t0} ms`);

  let wrote = 0;
  let totals = { storms: 0, named: 0, landfallMarks: 0, landfallNamed: 0, stalls: 0, stallsNamed: 0 };

  for (const [basin, entry] of Object.entries(index?.basins || {})) {
    const name = String(entry?.file || '').split('/').pop();
    if (!name) continue;
    const path = join(root, 'seasons/data', name);
    if (!existsSync(path)) {
      console.error(`  ${basin}: ${name} is not on disk — refusing to write a partial archive`);
      return 1;
    }

    /* ==> THE LANDFALL SIDECAR IS REQUIRED, NOT OPTIONAL. <== Without it every
     * landfall in the basin would come back unnamed, and the file would be
     * indistinguishable from a basin whose landfalls are all in open country.
     * That is exactly the "unavailable read as none_matched" confusion §5
     * forbids, written into a static file where nothing can correct it. */
    const marksName = landfallFileName(basin, entry.revision);
    const marksPath = join(root, 'seasons/data', marksName);
    if (!existsSync(marksPath)) {
      console.error(`  ${basin}: ${marksName} is not on disk`);
      console.error('    run tools/seasons-landfall.mjs first — naming landfalls needs the list of them');
      return 1;
    }
    const marks = JSON.parse(readFileSync(marksPath, 'utf8'))?.storms || {};

    const t = Date.now();
    const r = basinPlaces(readFileSync(path, 'utf8'), marks, gaz);
    const walkMs = Date.now() - t;

    for (const k of Object.keys(totals)) totals[k] += r[k];

    const payload = {
      basin,
      revision: entry.revision,
      gazetteer: `natural-earth-vector@${NE_REF} + all-the-cities`,
      nearKm: SEASONS.placeNearKm,
      farKm: SEASONS.placeFarKm,
      stallRadiusKm: SEASONS.stallRadiusKm,
      stallMinHours: SEASONS.stallMinHours,
      /* Said in the file rather than only in a spec section, the same as the
       * landfall sidecar: a reader of this JSON in two years should not have to
       * find §57.40 to learn these names were derived rather than published. */
      source: 'computed',
      storms: r.places,
    };

    console.log(`  ${basin}: ${r.storms} storms, ${r.named} with a name to give, `
      + `${r.landfallNamed}/${r.landfallMarks} landfalls named, `
      + `${r.stallsNamed}/${r.stalls} stalls named, walked in ${walkMs} ms`);

    if (!check) {
      const w = syncPlaces(root, basin, entry.revision, payload);
      if (w.written) wrote++;
      console.log(`    ${w.written ? 'wrote' : 'unchanged'} ${placesFile(basin, entry.revision)} (${(w.bytes / 1024).toFixed(1)} KB)`);
    }
  }

  console.log(`\narchive: ${totals.storms} storms, ${totals.named} carry at least one name`);
  console.log(`  landfalls named: ${totals.landfallNamed} of ${totals.landfallMarks}`
    + ` (${(100 * totals.landfallNamed / Math.max(1, totals.landfallMarks)).toFixed(1)}%, cap ${SEASONS.placeNearKm} km)`);
  console.log(`  stalls named: ${totals.stallsNamed} of ${totals.stalls}`
    + ` (cap ${SEASONS.placeFarKm} km)`);

  if (check) console.log('\n--check: nothing written');
  else console.log(`\n${wrote} file${wrote === 1 ? '' : 's'} written`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
