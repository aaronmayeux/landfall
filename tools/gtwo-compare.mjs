#!/usr/bin/env node
/**
 * tools/gtwo-compare.mjs — does the KMZ say the same thing GIS layer 3 says?
 *
 * ZERO DEPENDENCIES. Needs only the `archive` branch fetched:
 *     git fetch origin archive && node tools/gtwo-compare.mjs
 *
 * ==> WHY THIS EXISTS. <== Replacing a working source during cyclone season is
 * only defensible if the replacement is proven against the thing it replaces,
 * on real bytes, before anything ships. The archive branch holds 72 hourly
 * snapshots of BOTH paths taken at the same moment. That is 72 free
 * comparisons, offline, with no guessing — so take all 72 rather than eyeball
 * one and call it settled.
 *
 * ==> WHAT COUNTS AS A FAILURE, AND WHAT DOES NOT. <== A failure is the two
 * paths disagreeing about something the app draws or prints: how many areas
 * are being watched, where their edges are, or what the probabilities say.
 * Those exit non-zero.
 *
 * Two differences are EXPECTED and are reported without failing, because they
 * are the reason for the swap rather than an argument against it:
 *   - the KMZ carries a name and a paragraph per area; layer 3 carries none;
 *   - the KMZ's issue time is the FORECASTER'S, layer 3's `idp_filedate` is
 *     NOAA's ingest, a couple of minutes later. Ours is the sharper stamp.
 *
 * Areas are paired by GEOMETRY, never by id. Layer 3 numbers rows and the KMZ
 * numbers disturbances, and assuming those correspond is exactly the mistake
 * `GENESIS.anchorLayer` records about layer 2.
 */

import { execFileSync } from 'node:child_process';
import { kmlFromKmz } from '../functions/api/nhc/_kmz.js';
import { parseGtwoKml } from '../functions/api/nhc/_gtwo-kml.js';

const VERBOSE = process.argv.includes('--list');

/** Vertices this close are the same vertex. Nine decimal places is what was
 *  measured; a millionth of a degree is about ten centimetres, which is nine
 *  orders of magnitude finer than a development region's edge is meaningful
 *  to. Set this loose and the check stops proving anything. */
const VERTEX_TOLERANCE_DEG = 1e-6;

const show = (path) => execFileSync('git', ['show', `origin/archive:${path}`], {
  maxBuffer: 64 * 1024 * 1024,
});

const showText = (path) => show(path).toString('utf8');

function snapshots() {
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/archive'], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8').split('\n');

  const dirs = new Set();
  for (const n of names) {
    const m = n.match(/^history\/([^/]+)\//);
    if (m) dirs.add(`history/${m[1]}`);
  }
  return [...dirs].sort().concat('latest');
}

/* --- comparison ------------------------------------------------------------ */

const near = (a, b) => Math.abs(a - b) <= VERTEX_TOLERANCE_DEG;

/** Ring → its first vertex, which is how a KMZ area finds its layer 3 twin. */
const head = (ring) => ring[0];

/**
 * ==> THE TWO PATHS WIND THEIR RINGS IN OPPOSITE DIRECTIONS. <== Measured
 * here: the KMZ and layer 3 start at the same vertex and then walk the same
 * outline the other way round. It is the same shape and every renderer in this
 * app draws it identically, so it is not a disagreement — but a comparator
 * that did not know it would report 300 differing vertices per area and look
 * like a catastrophe.
 *
 * It is not cosmetic everywhere, though, and it is recorded rather than
 * shrugged off: the 3D land fill planned in NOW.md triangulates rings, and
 * winding is what tells a triangulator which side is inside.
 */
function ringsMatch(a, b) {
  if (a.length !== b.length) return null;
  const walk = (get) => {
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
      const [x, y] = get(i);
      worst = Math.max(worst, Math.abs(a[i][0] - x), Math.abs(a[i][1] - y));
      if (worst > VERTEX_TOLERANCE_DEG) return null;
    }
    return worst;
  };
  const forward = walk((i) => b[i]);
  if (forward != null) return { order: 'same', worst: forward };
  const reversed = walk((i) => b[b.length - 1 - i]);
  if (reversed != null) return { order: 'reversed', worst: reversed };
  return null;
}

/** The minute an outlook was issued, as both paths spell it. Layer 3 encodes
 *  it in `idp_source` (`gtwo_areas_202608190525`); the KMZ writes it in the
 *  document name. Comparing two different runs would be comparing two
 *  different forecasts. */
const layer3Minute = (feature) =>
  String(feature?.properties?.idp_source ?? '').match(/(\d{12})$/)?.[1] ?? null;

const kmzMinute = (issuedAt) =>
  issuedAt == null ? null : new Date(issuedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '');

/**
 * Pair each KMZ area with the layer 3 feature holding the same shape.
 *
 * Nearest first-vertex wins, and the pairing is REJECTED unless that vertex is
 * within tolerance — a "closest match" that is half an ocean away is not a
 * match, it is two different areas and the comparison must say so.
 */
function pair(kmzAreas, layer3) {
  const taken = new Set();
  return kmzAreas.map((area) => {
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < layer3.length; i++) {
      if (taken.has(i)) continue;
      const ring = layer3[i].geometry?.coordinates?.[0];
      if (!ring?.length) continue;
      const d = Math.hypot(head(ring)[0] - head(area.ring)[0], head(ring)[1] - head(area.ring)[1]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best != null && bestDist <= VERTEX_TOLERANCE_DEG) {
      taken.add(best);
      return { area, feature: layer3[best] };
    }
    return { area, feature: null };
  });
}

const problems = [];
const notes = {
  namesGained: 0, prosePassages: 0, tracks: 0, stampDeltas: [],
  sameWinding: 0, reversedWinding: 0, straddled: 0,
};
let hours = 0;
let areasCompared = 0;
let maxVertexDelta = 0;

for (const dir of snapshots()) {
  let layer3;
  let anchorsLayer;
  const kmzAreas = [];
  const kmzAnchors = [];
  let parsedAny = false;
  /* One basin catching a republication makes the WHOLE hour uncomparable —
   * the counts below are across both basins. */
  let straddled = false;

  try {
    layer3 = JSON.parse(showText(`${dir}/nhc-genesis-areas.geojson`)).features || [];
    anchorsLayer = JSON.parse(showText(`${dir}/nhc-genesis-anchors.geojson`)).features || [];
  } catch {
    continue; // a snapshot without the GIS layers has nothing to compare against
  }

  for (const [file, label] of [
    ['nhc-gtwo-atlantic.kmz.b64', 'atlantic'],
    ['nhc-gtwo-epacific.kmz.b64', 'epacific'],
  ]) {
    let parsed;
    try {
      const kml = await kmlFromKmz(Buffer.from(showText(`${dir}/${file}`).trim(), 'base64'));
      parsed = parseGtwoKml(kml);
    } catch (err) {
      problems.push(`${dir} ${label}: could not read the KMZ — ${err.message}`);
      continue;
    }
    if (parsed.state !== 'ok') {
      problems.push(`${dir} ${label}: ${parsed.reason}`);
      continue;
    }
    parsedAny = true;

    if (parsed.basin !== label) {
      problems.push(`${dir} ${label}: the document names basin "${parsed.basin}"`);
    }
    if (parsed.issuedAt == null) {
      problems.push(`${dir} ${label}: no issue time in the document name`);
    }
    if (parsed.areas.length === 0 && !parsed.formationNotExpected) {
      problems.push(`${dir} ${label}: no areas AND no all-clear sentence — silence (§5)`);
    }

    /* ==> ONLY COMPARE THE SAME RUN. <== The archive fetches the two paths
     * seconds apart. When NHC republishes in that gap, one snapshot is the new
     * outlook and the other is the old one, and every difference between them
     * is NHC changing its mind rather than the paths disagreeing. Counting
     * that as a failure would be the classic bad test: red for a reason that
     * has nothing to do with the thing under test. */
    const stampedSameRun = layer3
      .map(layer3Minute)
      .every((m) => m == null || m === kmzMinute(parsed.issuedAt));
    if (!stampedSameRun) {
      notes.straddled++;
      straddled = true;
      continue;
    }

    kmzAreas.push(...parsed.areas);
    kmzAnchors.push(...parsed.anchors);
    notes.tracks += parsed.tracks.length;

    for (const a of parsed.areas) {
      if (a.title) notes.namesGained++;
      if (a.discussion) notes.prosePassages++;
      if (parsed.issuedAt != null) {
        const twin = layer3.find((f) => Number.isFinite(Number(f.properties?.idp_filedate)));
        if (twin) {
          notes.stampDeltas.push(Number(twin.properties.idp_filedate) - parsed.issuedAt);
        }
      }
    }
  }

  if (!parsedAny || straddled) continue;
  hours++;

  /* 1. THE COUNT. The number of areas being watched is the headline fact and
   *    the one the 2026-08-11 incident got wrong. */
  if (kmzAreas.length !== layer3.length) {
    problems.push(
      `${dir}: KMZ has ${kmzAreas.length} areas, layer 3 has ${layer3.length}`
    );
  }

  /* 2. THE SHAPES AND THE NUMBERS, area by area. */
  for (const { area, feature } of pair(kmzAreas, layer3)) {
    if (!feature) {
      problems.push(`${dir}: a KMZ area at ${head(area.ring).map((n) => n.toFixed(2))} has no twin in layer 3`);
      continue;
    }
    areasCompared++;
    const ring = feature.geometry.coordinates[0];
    const p = feature.properties || {};

    if (ring.length !== area.ring.length) {
      problems.push(`${dir}: vertex count ${area.ring.length} vs layer 3's ${ring.length}`);
      continue;
    }
    const match = ringsMatch(area.ring, ring);
    if (!match) {
      problems.push(
        `${dir}: the outlines differ — first mismatch near ${head(area.ring).map((n) => n.toFixed(2))}`
      );
    } else {
      maxVertexDelta = Math.max(maxVertexDelta, match.worst);
      if (match.order === 'reversed') notes.reversedWinding++; else notes.sameWinding++;
    }
    for (const field of ['prob2day', 'risk2day', 'prob7day', 'risk7day']) {
      if (String(area[field]).trim() !== String(p[field]).trim()) {
        problems.push(`${dir}: ${field} is "${area[field]}" in the KMZ, "${p[field]}" in layer 3`);
      }
    }
  }

  /* 3. THE ANCHORS. Same count, same positions — and unlike layer 3, the KMZ
   *    says which area each one belongs to, which is checked separately by
   *    the unit tests because layer 3 has nothing to check it against. */
  if (kmzAnchors.length !== anchorsLayer.length) {
    problems.push(
      `${dir}: KMZ has ${kmzAnchors.length} disturbance points, layer 2 snapshot has ${anchorsLayer.length}`
    );
  } else {
    for (const anchor of kmzAnchors) {
      const hit = anchorsLayer.some((f) => {
        const c = f.geometry?.coordinates;
        return c && near(c[0], anchor.lon) && near(c[1], anchor.lat);
      });
      if (!hit) problems.push(`${dir}: disturbance point ${anchor.lon},${anchor.lat} is not in the layer 2 snapshot`);
    }
  }

  if (VERBOSE) {
    console.log(`  ${dir}  areas ${kmzAreas.length}  points ${kmzAnchors.length}`);
  }
}

/* --- the report ------------------------------------------------------------ */

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

console.log(`\n  ${hours} snapshots compared, ${areasCompared} areas paired`);
console.log(`  largest vertex disagreement: ${maxVertexDelta.toExponential(2)}°`);
console.log(`  names the KMZ published and layer 3 did not: ${notes.namesGained}`);
console.log(`  forecaster paragraphs carried with a shape: ${notes.prosePassages}`);
console.log(`  unlabelled LineStrings seen: ${notes.tracks}`);
console.log(`  ring winding: ${notes.sameWinding} same, ${notes.reversedWinding} reversed`);
console.log(`  basin-snapshots skipped because the two paths caught different runs: ${notes.straddled}`);
const delta = median(notes.stampDeltas);
if (delta != null) {
  console.log(`  layer 3's idp_filedate runs ${Math.round(delta / 1000)}s behind the forecaster's issue time (median)`);
}

if (problems.length) {
  console.log(`\n✗ ${problems.length} disagreements\n`);
  for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  if (problems.length > 40) console.log(`  ...and ${problems.length - 40} more`);
  console.log('');
  process.exit(1);
}
console.log('\n✓ the two paths agree on every area, every vertex and every probability\n');
