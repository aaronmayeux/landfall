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
  /* `const P = palette()` is the local alias a builder uses when it resolves
   * one. map/style.js no longer does — see the ZERO check below — but
   * map/globe3d.js and map/heightfield.js still do, and they are the files
   * where a `P.geo.coneFyll` would go unnoticed. */
  { pattern: /\bP\.([A-Za-z_$][\w$]*)/g, objs: { DARK, LIGHT } },
];

/* Files the app actually ships. The vendor bundle is not ours. SKIP_FILES is
 * empty and kept: it held the two prototype pages until they were deleted with
 * the Deep rip, and the next scratch page will want it back. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'assets', 'worker']);
const SKIP_FILES = new Set([]);

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

/* ---------------------------------------------------------------------------
 * `gs()` AND `THEME_STATE` MUST AGREE, EXACTLY, BOTH WAYS.
 *
 * `map/theme-state.js` maps a state key to a palette path. `gs('k')` is how a
 * paint property anywhere in map/ asks for one. A key referenced by `gs()` but
 * missing from the map is never published, so the property reads `undefined`
 * — which in MapLibre is not an error and not a warning, it is a SILENTLY
 * REJECTED LAYER, and the first anyone knows is a hole in the globe on a
 * phone. A key in the map that nothing references is dead weight that makes
 * the next reader believe a colour is themed when it is not.
 *
 * The palette PATHS are checked by the `palette().x` pattern above, which
 * cannot see inside a string, so they are resolved here instead — a
 * `geo.coneFyll` typo would otherwise publish `undefined` just as quietly.
 *
 * All derived from the files. The old block here walked `P.x` for world
 * palette coverage; the worlds were cut on 2026-08-08 and `P` went with the
 * global-state conversion. Same job, new spelling.
 * ------------------------------------------------------------------------ */
const stateSrc = stripComments(readFileSync(join(ROOT, 'map/theme-state.js'), 'utf8'));

const declared = new Map(
  [...(stateSrc.match(/export const THEME_STATE = Object\.freeze\(\{([\s\S]*?)^\}\);/m) || [, ''])[1]
    .matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*'([^']+)'/gm)]
    .map((m) => [m[1], m[2]])
);

/* Every gs('key') anywhere in map/, not just style.js — the app's own layers
 * read global state now too. */
const gsKeys = new Set();
for (const f of walk(ROOT)) {
  if (!relative(ROOT, f).startsWith('map/')) continue;
  const text = stripComments(readFileSync(f, 'utf8'));
  for (const m of text.matchAll(/\bgs\('([A-Za-z_$][\w$]*)'\)/g)) gsKeys.add(m[1]);
}

if (!declared.size) {
  failures++;
  console.error('  FAIL map/theme-state.js: THEME_STATE did not parse. The checks below are not running.');
}

for (const k of gsKeys) {
  if (!declared.has(k)) {
    failures++;
    console.error(
      `  FAIL gs('${k}') is not in THEME_STATE, so it is never published to global ` +
        `state. The paint property reads undefined and MapLibre drops the layer.`
    );
  }
}
for (const [k, path] of declared) {
  if (!gsKeys.has(k)) {
    failures++;
    console.error(
      `  FAIL map/theme-state.js: THEME_STATE declares '${k}' but no gs('${k}') ` +
        `references it. Remove it, or the next reader will believe that colour is themed.`
    );
  }
  for (const [pname, P] of [['DARK', DARK], ['LIGHT', LIGHT]]) {
    const dot = path.indexOf('.');
    const val = dot === -1 ? P[path] : P[path.slice(0, dot)]?.[path.slice(dot + 1)];
    if (val === undefined) {
      failures++;
      console.error(
        `  FAIL map/theme-state.js: THEME_STATE.${k} points at '${path}', which does ` +
          `not exist in ${pname}. MapLibre would receive undefined for that colour.`
      );
    }
  }
}

/* ==> THE PALETTE IS RESOLVED IN EXACTLY ONE PLACE, AND IT IS NOT STYLE.JS.
 *
 * This check has moved once and kept its point both times.
 *
 * Originally: every layer builder in map/style.js called `palette()` for
 * itself, which is invisible and correct right up until something changes the
 * palette mid-build. A world's basemap override did exactly that — it reached
 * the sky and nothing else, and the globe kept 18 of its 21 colours blue.
 * Nothing threw. The fix was one call at the top, handed down as a parameter.
 *
 * Now: nothing in map/style.js resolves a palette at all. Colours are
 * `gs('key')` references and the one `palette()` call in the whole basemap
 * path is inside `themeState()`. So the check is stricter — style.js must hold
 * ZERO — and it moved to the file that legitimately holds the one.
 *
 * `themeState()` calling it twice would be the same class of bug in miniature:
 * a theme flip landing between the two reads would build a state block half in
 * each palette.
 * ------------------------------------------------------------------------ */
const styleSrc = stripComments(readFileSync(join(ROOT, 'map/style.js'), 'utf8'));
const stylePaletteCalls = [...styleSrc.matchAll(/\bpalette\(\)/g)].length;
if (stylePaletteCalls !== 0) {
  failures++;
  console.error(
    `  FAIL map/style.js: ${stylePaletteCalls} call(s) to palette(), expected 0. ` +
      `Themed colours are gs('key') references — a resolved palette in this file ` +
      `means a colour is being baked in, and setGlobalState will not repaint it.`
  );
}

const statePaletteCalls = [...stateSrc.matchAll(/\bpalette\(\)/g)].length;
if (statePaletteCalls !== 1) {
  failures++;
  console.error(
    `  FAIL map/theme-state.js: ${statePaletteCalls} calls to palette(), expected exactly 1. ` +
      `Two reads in one build can straddle a theme change and produce a state block ` +
      `half in each palette.`
  );
}

if (failures) {
  console.error(`${failures} unresolved reference(s).`);
  process.exit(1);
}
console.log('Every token reference resolves.');
