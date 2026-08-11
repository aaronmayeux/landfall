/**
 * row-preview.mjs — render the storm list's rows as TEXT, from real bytes.
 *
 * NOT A TEST. It asserts nothing and is not in the suite. It exists because
 * the row is a LAYOUT, and the one thing no assertion catches is a line that
 * is true, correct, well-tested and reads badly — "closest 120 mi in in 9 hrs"
 * passed every check in this repo.
 *
 * Feed it the archive branch's GDACS payload:
 *   git show origin/archive:latest/gdacs-events.json > /tmp/gdacs.json
 *   node tools/row-preview.mjs /tmp/gdacs.json
 *
 * The DOM is not involved, so this reproduces the row's TEXT rather than its
 * geometry. Column alignment still has to be judged on glass.
 */

import fs from 'node:fs';
import { categoryShortLabel, representativeKt } from '../lib/category.js';
import { formatDistance, formatBearing } from '../lib/units.js';
import { formatAge, formatUntil, ageMs } from '../lib/time.js';
import { FRESHNESS } from '../config/constants.js';
import { isSilent, SILENT_SHORT } from '../lib/silence.js';
import { greatCircleNm, bearingDeg } from '../lib/geo.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/row-preview.mjs <gdacs-events.json>');
  process.exit(2);
}

/* A New Orleans home, the same one every home fixture in this repo uses. */
const HOME = { lon: -90.0715, lat: 29.9511 };
const SYS = 'imperial';

const KMH_PER_KT = 1.852;
const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};

function classOf(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('depression')) return { category: 0, categoryCode: 'TD' };
  if (t.includes('hurricane') || t.includes('typhoon')) return { category: null, categoryCode: 'HU' };
  if (t.includes('storm')) return { category: 1, categoryCode: 'TS' };
  return { category: null, categoryCode: null };
}

const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const storms = (json.features || [])
  .filter((f) => {
    const p = f.properties || {};
    return p.eventtype === 'TC' && String(p.iscurrent).toLowerCase() === 'true';
  })
  .map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry?.coordinates || [];
    const { category, categoryCode } = classOf(p.severitydata?.severitytext);
    return {
      id: `gdacs:${p.eventid}`,
      name: String(p.eventname || '').replace(/-\d\d$/, ''),
      lon, lat,
      windKt: null,
      peakWindKt: num(p.severitydata?.severity) / KMH_PER_KT,
      nature: 'tropical',
      category,
      categoryCode,
      observedAt: `${p.todate}Z`,
    };
  });

const isStale = (s) => {
  const a = ageMs(s.observedAt);
  return a != null && a > FRESHNESS.freshUntil;
};

function stamp(s) {
  if (isSilent(s)) return SILENT_SHORT;
  if (isStale(s)) return formatAge(s.observedAt);
  return '';
}

function where(s) {
  const nm = greatCircleNm(HOME.lon, HOME.lat, s.lon, s.lat);
  return `${formatDistance(nm, SYS)} ${formatBearing(bearingDeg(HOME.lon, HOME.lat, s.lon, s.lat))}`;
}

const rankKt = (s) =>
  Number.isFinite(s.windKt) ? s.windKt : representativeKt(s.category, s.nature, s.categoryCode) ?? -1;

storms.sort((a, b) => {
  const qa = isSilent(a) ? 1 : 0;
  const qb = isSilent(b) ? 1 : 0;
  if (qa !== qb) return qa - qb;
  const na = greatCircleNm(HOME.lon, HOME.lat, a.lon, a.lat);
  const nb = greatCircleNm(HOME.lon, HOME.lat, b.lon, b.lat);
  return na - nb;
});

/* 38 characters is the text width of a 340px rail at the row's 0.78rem
 * monospace face — the narrowest this list is ever drawn. */
const W = 38;
const pad = (l, r) => {
  const gap = Math.max(1, W - l.length - r.length);
  return l + ' '.repeat(gap) + r;
};

console.log(`\nRow preview — home New Orleans, ${SYS}, ${W}-char rail\n`);
console.log('┌' + '─'.repeat(W + 5) + '┐');
for (const s of storms) {
  const badge = categoryShortLabel(s.category, s.nature, s.categoryCode);
  console.log('│ ●  ' + pad(s.name, badge) + ' │');
  console.log('│    ' + pad(where(s), stamp(s)) + ' │');
  console.log('│ ' + ' '.repeat(W + 4) + '│');
}
console.log('└' + '─'.repeat(W + 5) + '┘');

console.log('\nranking key (never displayed):');
for (const s of storms) {
  console.log(
    `  ${s.name.padEnd(12)} rankKt ${String(Math.round(rankKt(s))).padStart(4)}` +
      `   peakWindKt ${String(Math.round(s.peakWindKt)).padStart(4)}  <- the number this used to sort on`
  );
}
console.log('');
