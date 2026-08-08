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
 * WHAT MAP/STYLE.JS READS OFF THE PALETTE.
 *
 * This block used to serve world palette coverage: every alternate world had to
 * answer for every key style.js reads, or it silently kept the app's blue. The
 * worlds were cut on 2026-08-08 and that walker went with them. The key set is
 * still derived here because the palette-once check below needs it.
 *
 * The key list is DERIVED FROM THE FILE, never restated here. A second list
 * would be a second thing to keep in step, and this tool's whole premise is
 * that hand-maintained parallel lists drift.
 * ------------------------------------------------------------------------ */
const styleSrc = stripComments(readFileSync(join(ROOT, 'map/style.js'), 'utf8'));
const styleKeys = new Set(
  [...styleSrc.matchAll(/\bP\.([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .filter((k) => k !== 'geo')
);

/* ==> STYLE.JS MUST RESOLVE THE PALETTE EXACTLY ONCE. <==
 *
 * This is not tidiness. `buildStyle()` resolves the palette once and hands the
 * RESULT to its layer builders. A builder that calls `palette()` for itself
 * gets its own copy, and any change made between the two — a world override
 * when worlds existed, a theme flip mid-build now — reaches only part of the
 * style. The failure is silent and partial: when this check was written six
 * builders were doing exactly that, and an override repainted the sky while
 * eighteen of twenty-one colours stayed blue. Nothing threw.
 *
 * ==> THIS CHECK OUTLIVED THE FEATURE THAT MOTIVATED IT, DELIBERATELY. <==
 * The worlds are gone, so the specific bug it caught cannot recur today. One
 * resolved palette threaded through the builders is still the right shape, and
 * a second `palette()` call is still the seam a future theme bug walks in
 * through. Re-decide it when `map/style.js` is cut down (Deep rip, pass two),
 * not before.
 *
 * One call, at the top of buildStyle. Everything downstream takes a parameter.
 */
const paletteCalls = [...styleSrc.matchAll(/\bpalette\(\)/g)].length;
if (paletteCalls !== 1) {
  failures++;
  console.error(
    `  FAIL map/style.js: ${paletteCalls} calls to palette(), expected exactly 1. ` +
      `Layer builders must take the resolved palette as a parameter, or a world's ` +
      `basemap override reaches only part of the style.`
  );
}

if (failures) {
  console.error(`${failures} unresolved reference(s).`);
  process.exit(1);
}
console.log('Every token reference resolves.');
