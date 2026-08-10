/**
 * milton-surge-shape.mjs — turn ogrmerge's raw KML dump into the committed
 * surge fixture. Runs on the GitHub Actions runner only (.github/workflows/
 * milton-surge.yml); nothing in the app imports it.
 *
 * THREE JOBS, and the reasoning for each is in the workflow's header:
 *   1. Keep only the Polygons and Lines folders. Breakpoints, Line Labels and
 *      Polygon Labels are Points we never draw.
 *   2. Flatten each feature to the four fields that matter, read from the
 *      description JSON rather than inferred from the style or the name.
 *   3. Simplify to the tolerance the live relay asks ArcGIS for, using the
 *      app's OWN simplifier — so the fixture and the app can never disagree
 *      about what a simplified ring is.
 *
 * Prints a markdown report on stdout; the workflow tees it to BUILD.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { simplifyRing, simplifyPath, countCoordinates } from '../../lib/simplify.js';
import { SURGE } from '../../config/constants.js';

const SRC = '/tmp/gj';
const OUT = 'samples/milton-al142024/surge';

/** ==> READ FROM THE APP, NOT TYPED HERE. <== This is `maxAllowableOffset` —
 *  what the relay asks ArcGIS to generalize to before a byte is sent. It was a
 *  literal in this file for exactly one build, and the first thing that
 *  happened was the app's number being retuned on glass while the fixture kept
 *  the old one. Two copies of a tuning constant is one copy too many (§12). */
const TOLERANCE_DEG = SURGE.offsetDeg;

/** The two folders that carry surge. Everything else in the KML is a label or
 *  a breakpoint marker. Matched on the SUFFIX because ogrmerge prefixes each
 *  layer name with the source filename. */
const KEEP = { Polygons: 'polygon', Lines: 'line' };

/** NHC's five colour classes, rising. The order `SURGE_RAMP` already uses.
 *  A colour outside this list is a schema change, not a feature to guess at. */
const COLORS = ['blue', 'yellow', 'orange', 'red', 'purple'];

/** `description` arrives as an object when the GeoJSON writer recognised the
 *  JSON, and as a string when it did not. Handle both rather than depend on
 *  which GDAL the runner happens to install. */
function readDescription(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
}

/** `Name` is "Tampa Bay...8-12 ft" — place and range joined by an ellipsis.
 *  Only the place is taken from it; the range comes from the description,
 *  which publishes it as its own field and cannot be ambiguous. */
function placeFromName(name) {
  return String(name || '').split('...')[0].trim() || null;
}

const advisories = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.json'))
  .map((f) => path.basename(f, '.json'))
  .sort();

const rows = [];
const rangesByColor = {};
const problems = [];

for (const adv of advisories) {
  const src = JSON.parse(fs.readFileSync(path.join(SRC, `${adv}.json`), 'utf8'));
  const features = [];
  let before = 0;
  let after = 0;
  let dropped = 0;

  for (const f of src.features || []) {
    const folder = String(f.properties?.kml_folder || '');
    const suffix = Object.keys(KEEP).find((k) => folder.endsWith(`_${k}`));
    if (!suffix) { dropped++; continue; }

    const desc = readDescription(f.properties?.description);
    const color = desc?.color ? String(desc.color).toLowerCase() : null;
    const range = desc?.peak_surge_range ? String(desc.peak_surge_range).trim() : null;

    /* A surge feature with no colour has no severity, and guessing one is the
     * §5 lie in miniature. Record it and keep it OUT rather than paint it a
     * plausible shade. Nothing in Milton hits this; the check exists so a
     * future storm's schema change is loud instead of silent. */
    if (!color || !COLORS.includes(color)) {
      problems.push(`${adv}: feature with unrecognised colour ${JSON.stringify(color)}`);
      continue;
    }
    if (!range) problems.push(`${adv}: ${placeFromName(f.properties?.Name)} has a colour but no range`);

    const geom = f.geometry;
    if (!geom) { problems.push(`${adv}: feature with no geometry`); continue; }
    before += countCoordinates(geom);

    let simplified;
    if (geom.type === 'Polygon') {
      simplified = { type: 'Polygon', coordinates: geom.coordinates.map((r) => simplifyRing(r, TOLERANCE_DEG)) };
    } else if (geom.type === 'MultiPolygon') {
      simplified = { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map((r) => simplifyRing(r, TOLERANCE_DEG))) };
    } else if (geom.type === 'LineString') {
      /* simplifyGeometry() passes LineStrings straight through — its comment
       * says lines "are 2-point track segments with nothing to simplify",
       * which is true of tracks and NOT true of a surge coastline. So the path
       * simplifier is called explicitly here rather than by widening a shared
       * helper that every track in the app also goes through. */
      simplified = { type: 'LineString', coordinates: simplifyPath(geom.coordinates, TOLERANCE_DEG) };
    } else if (geom.type === 'MultiLineString') {
      simplified = { type: 'MultiLineString', coordinates: geom.coordinates.map((l) => simplifyPath(l, TOLERANCE_DEG)) };
    } else {
      problems.push(`${adv}: unexpected geometry ${geom.type}`);
      continue;
    }
    after += countCoordinates(simplified);

    (rangesByColor[color] ||= {})[range || '(none)'] = (rangesByColor[color]?.[range || '(none)'] || 0) + 1;

    features.push({
      type: 'Feature',
      properties: {
        kind: KEEP[suffix],       // 'polygon' — a flooded area | 'line' — a coastal reach
        color,                    // blue | yellow | orange | red | purple, rising
        severity: COLORS.indexOf(color),
        range,                    // "8-12 ft", NHC's own words. Never rewritten.
        place: placeFromName(f.properties?.Name),
      },
      geometry: simplified,
    });
  }

  const dir = path.join(OUT, adv);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'peaksurge.geojson');
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }) + '\n');

  rows.push({
    advisory: adv,
    file: `${adv}/peaksurge.geojson`,
    polygons: features.filter((f) => f.properties.kind === 'polygon').length,
    lines: features.filter((f) => f.properties.kind === 'line').length,
    verticesBefore: before,
    verticesAfter: after,
    bytes: fs.statSync(file).size,
    droppedLabelFeatures: dropped,
  });
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  storm: 'AL142024',
  product: 'PeakStormSurge',
  source: 'https://www.nhc.noaa.gov/gis/peakSurge/',
  simplifiedToleranceDeg: TOLERANCE_DEG,
  simplifiedWith: 'lib/simplify.js',
  advisories: rows,
}, null, 2) + '\n');

/* ---- the report ---------------------------------------------------------- */
const totBefore = rows.reduce((s, r) => s + r.verticesBefore, 0);
const totAfter = rows.reduce((s, r) => s + r.verticesAfter, 0);
const totBytes = rows.reduce((s, r) => s + r.bytes, 0);

const out = [];
out.push('# Milton peak surge — built fixture');
out.push('');
out.push(`Simplified to **${TOLERANCE_DEG}°** with \`lib/simplify.js\`, matching the`);
out.push('`maxAllowableOffset` the live relay asks ArcGIS for (SPEC-DATA.md §4.8).');
out.push('');
out.push(`**${rows.length} advisories.** Vertices ${totBefore.toLocaleString()} → ` +
         `**${totAfter.toLocaleString()}** (${(100 - (100 * totAfter) / totBefore).toFixed(1)}% removed). ` +
         `Total ${(totBytes / 1048576).toFixed(2)} MB.`);
out.push('');
out.push('| adv | polys | lines | vertices before | after | KB |');
out.push('|---|---|---|---|---|---|');
for (const r of rows) {
  out.push(`| ${r.advisory} | ${r.polygons} | ${r.lines} | ${r.verticesBefore.toLocaleString()} | ` +
           `${r.verticesAfter.toLocaleString()} | ${(r.bytes / 1024).toFixed(0)} |`);
}
out.push('');
out.push('## Colour → every range NHC published with it');
out.push('');
out.push('The colour is a bucket; the range is the forecast for that place. Both are kept.');
out.push('');
out.push('| colour | ranges |');
out.push('|---|---|');
for (const c of COLORS) {
  const seen = rangesByColor[c];
  out.push(`| ${c} | ${seen ? Object.entries(seen).map(([r, n]) => `${r} (×${n})`).join(', ') : '—'} |`);
}
out.push('');
if (problems.length) {
  out.push('## Problems');
  out.push('');
  for (const p of problems.slice(0, 40)) out.push(`- ${p}`);
  if (problems.length > 40) out.push(`- …and ${problems.length - 40} more`);
} else {
  out.push('No unrecognised colours, missing ranges or unexpected geometries.');
}
console.log(out.join('\n'));
