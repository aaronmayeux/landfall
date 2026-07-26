/**
 * token-check.mjs — every token reference in the app resolves to a real token.
 *
 * Run:  node tools/token-check.mjs
 * Exit: 0 if every reference resolves, 1 otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, precisely.
 *
 * On 2026-07-26 the light-mode pass moved the themed half of STORM_GEO into
 * the palette with a find-and-replace on `STORM_GEO.coneFill`. That string is
 * a PREFIX of `STORM_GEO.coneFillOpacity`, so three values that never moved —
 * coneFillOpacity, coneLineOpacity, coneLineWidth — were rewritten to point at
 * a palette that has no such keys. They evaluated to `undefined`.
 *
 * Nothing caught it:
 *   - `check-syntax.mjs` passed. The code is syntactically perfect and every
 *     named IMPORT resolves; it is the property access that is wrong.
 *   - `contrast-check.mjs` passed. It reads the token files, not the call sites.
 *   - The headless run passed, because MapLibre reports a rejected layer on the
 *     map's `error` event rather than throwing, and the check was watching for
 *     thrown errors and console errors.
 *
 * The symptom was the forecast cone silently not drawing — and, because
 * main.js treated any map error as a tile error, a permanent and completely
 * false "Basemap tiles are not loading" banner over a working map.
 *
 * A typo'd token is invisible in JS: `undefined` is a legal value right up to
 * the moment something downstream demands a number. This walks the actual call
 * sites and checks each one against the actual objects.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT CANNOT SEE. Only STATIC dotted access — `SIZE.radius`,
 * `palette().geo.coneFill`. A computed lookup (`SIZE[name]`) is invisible to
 * it, by design: chasing those would mean evaluating the program. If a token
 * group ever grows a computed access pattern, that group needs a real test,
 * not a bigger regex here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const tokens = await import('../config/tokens.js');
const { DARK, LIGHT } = tokens;

/* Each entry: how the app writes the reference, and the object(s) it must
 * resolve against. A palette key must exist in BOTH palettes — a token present
 * in dark and missing in light is exactly the bug that ships as "fine on my
 * machine" and breaks for whoever switched themes. */
const GROUPS = [
  { pattern: /\bSTORM_GEO\.([A-Za-z_$][\w$]*)/g,        objs: { STORM_GEO: tokens.STORM_GEO } },
  { pattern: /\bSIZE\.([A-Za-z_$][\w$]*)/g,             objs: { SIZE: tokens.SIZE } },
  { pattern: /\bOPACITY\.([A-Za-z_$][\w$]*)/g,          objs: { OPACITY: tokens.OPACITY } },
  { pattern: /\bSPACE\.([A-Za-z_$][\w$]*)/g,            objs: { SPACE: tokens.SPACE } },
  { pattern: /\bTYPE\.([A-Za-z_$][\w$]*)/g,             objs: { TYPE: tokens.TYPE } },
  { pattern: /\bFONT\.([A-Za-z_$][\w$]*)/g,             objs: { FONT: tokens.FONT } },
  { pattern: /\bZ\.([A-Za-z_$][\w$]*)/g,                objs: { Z: tokens.Z } },
  { pattern: /\bCATEGORY_COLOR\.([A-Za-z_$][\w$]*)/g,   objs: { CATEGORY_COLOR: tokens.CATEGORY_COLOR } },
  { pattern: /\bWATCH_WARNING_COLOR\.([A-Za-z_$][\w$]*)/g, objs: { WATCH_WARNING_COLOR: tokens.WATCH_WARNING_COLOR } },
  { pattern: /\bWIND_BAND_COLOR\.([A-Za-z_$][\w$]*)/g,  objs: { WIND_BAND_COLOR: tokens.WIND_BAND_COLOR } },
  { pattern: /\bMODEL_COLOR\.([A-Za-z_$][\w$]*)/g,      objs: { MODEL_COLOR: tokens.MODEL_COLOR } },

  /* THE PALETTE, both spellings. `palette().geo.x` is matched FIRST and its
   * matches are removed from the text before `palette().x` runs, or every
   * `.geo.` hit would also register as a bare palette key called `geo`. */
  { pattern: /\bpalette\(\)\.geo\.([A-Za-z_$][\w$]*)/g,
    objs: { 'DARK.geo': DARK.geo, 'LIGHT.geo': LIGHT.geo }, consume: true },
  { pattern: /\bpalette\(\)\.([A-Za-z_$][\w$]*)/g,
    objs: { DARK, LIGHT } },
  { pattern: /\bP\.geo\.([A-Za-z_$][\w$]*)/g,
    objs: { 'DARK.geo': DARK.geo, 'LIGHT.geo': LIGHT.geo }, consume: true },
  /* `const P = palette()` is the local alias style.js uses. */
  { pattern: /\bP\.([A-Za-z_$][\w$]*)/g, objs: { DARK, LIGHT } },
];

/* Files the app actually ships. Prototypes are scratch and the vendor bundle
 * is not ours. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'assets', 'worker']);
const SKIP_FILES = new Set(['proto-globe.html', 'proto-transition.html']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js') && !full.includes('/tools/')) out.push(full);
  }
  return out;
}

/* Comments are prose. `DARK.node vs DARK.mesh` in a design note is not a call
 * site, and failing the run over one would train everyone to ignore this. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

let failures = 0;
let checked = 0;

for (const file of walk(ROOT)) {
  let text = stripComments(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);

  for (const { pattern, objs, consume } of GROUPS) {
    const hits = [...text.matchAll(pattern)];
    for (const m of hits) {
      const key = m[1];
      checked++;
      for (const [objName, obj] of Object.entries(objs)) {
        if (obj && Object.prototype.hasOwnProperty.call(obj, key)) continue;
        failures++;
        console.error(`  FAIL ${rel}: ${m[0]} — no "${key}" in ${objName}`);
      }
    }
    if (consume) text = text.replace(pattern, 'x');
  }
}

console.log(`\nChecked ${checked} token references across the app.`);
if (failures) {
  console.error(`${failures} unresolved reference(s).`);
  process.exit(1);
}
console.log('Every token reference resolves.');
