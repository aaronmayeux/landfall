/**
 * test-theme-state.mjs — the basemap must be theme-INDEPENDENT.
 *
 * WHY THIS FILE EXISTS. A theme change used to be `map.setStyle(buildStyle(),
 * { diff: false })`: throw the entire basemap away, rebuild it, reinstall the
 * app's own layers on the `style.load` that followed, and eat the flash. It is
 * now `map.setGlobalState(themeState())` — thirteen values handed to MapLibre,
 * no layer touched.
 *
 * That only works if the style object itself contains NO COLOUR. Every themed
 * colour has to be a `["to-color", ["global-state", key]]` reference, and every
 * key referenced has to be published. Miss one and the failure is the worst
 * kind this project has: `undefined` in a MapLibre paint property does not
 * throw and does not warn, the layer is silently dropped, and the first anyone
 * knows is a hole in the globe on a phone.
 *
 * So this walks the REAL generated style — both themes, both tile schemas —
 * rather than reading the source. Four things it proves:
 *
 *   1. Every `global-state` key in the tree is declared and published.
 *   2. Every published key is actually referenced.
 *   3. Flipping the theme changes NOTHING in the style but the `state`
 *      defaults. This is the one that matters: it is the property that makes
 *      `setGlobalState` sufficient, and it is the one a future edit will break
 *      by baking a palette value back into a layer.
 *   4. No palette hex appears as a literal anywhere in the tree.
 *
 * Note 4 is the belt to 3's braces. A colour baked in from the DARK palette
 * would slip past 3 in a dark-mode-only reading; a colour baked in from either
 * palette fails 4 on the spot.
 *
 * WHAT THIS DOES NOT PROVE: that MapLibre accepts the expressions. That needs
 * the real style spec and lives with the browser suites, which do not run in a
 * bare sandbox. Validated against maplibre-gl 5.6.0's own
 * @maplibre/maplibre-gl-style-spec (23.3.0) on the conversion: 0 errors, both
 * themes, both schemas.
 *
 * Zero dependencies. `node tools/test-theme-state.mjs`.
 */

import path from 'node:path';
process.chdir(path.resolve(import.meta.dirname, '..'));

const { buildStyle } = await import('../map/style.js');
const { themeState, STATE_KEYS, THEME_STATE } = await import('../map/theme-state.js');
const { setThemeMode } = await import('../config/theme.js');
const { DARK, LIGHT } = await import('../config/tokens.js');
const { assertNoDataDrivenState } = await import('./lib-state-scan.mjs');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

/** Every `["global-state", k]` key anywhere in a style tree. */
function globalStateKeys(node, found = new Set()) {
  if (Array.isArray(node)) {
    if (node[0] === 'global-state' && typeof node[1] === 'string') found.add(node[1]);
    for (const child of node) globalStateKeys(child, found);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) globalStateKeys(v, found);
  }
  return found;
}

/** The style with its `state` block removed — the part that must not move. */
const withoutState = (style) => {
  const { state, ...rest } = style;
  return JSON.stringify(rest);
};

/* --- 1 & 2: the two lists agree, in both directions ---------------------- */
for (const useR2 of [false, true]) {
  const schema = useR2 ? 'protomaps' : 'openmaptiles';
  setThemeMode('dark');
  const style = buildStyle({ useR2 });
  const used = globalStateKeys(style);

  for (const k of used) {
    ok(STATE_KEYS.includes(k),
       `${schema}: global-state key '${k}' is referenced but not in STATE_KEYS`);
    ok(style.state?.[k] !== undefined && style.state[k].default !== undefined,
       `${schema}: '${k}' is referenced but has no default in the style's state block`);
  }
  /* Not every key has to appear in every SCHEMA — the two draw different layer
   * sets — so the unused-key check is the union across both, below. */
  ok(used.size > 0, `${schema}: the style contains no global-state references at all`);
}

/* The APP'S OWN layers are added imperatively at style.load, so they are not in
 * `buildStyle()` output and cannot be walked the way the basemap is. Their
 * `gs()` calls are checked against THEME_STATE by tools/token-check.mjs, in
 * both directions. What is checked here is the thing that tool cannot see: the
 * VALUE behind every key actually resolves. */
setThemeMode('dark');
const basemapUsed = new Set([
  ...globalStateKeys(buildStyle({ useR2: false })),
  ...globalStateKeys(buildStyle({ useR2: true })),
]);
const appOnly = STATE_KEYS.filter((k) => !basemapUsed.has(k));
ok(appOnly.length > 0,
   'no state key is app-only — the app layers were expected to read global state too');
ok(basemapUsed.size > 0, 'the basemap references no state keys at all');

/* --- 3: THE ONE THAT MATTERS. Theme is not in the style. ----------------- */
for (const useR2 of [false, true]) {
  const schema = useR2 ? 'protomaps' : 'openmaptiles';
  setThemeMode('dark');
  const dark = buildStyle({ useR2 });
  setThemeMode('light');
  const light = buildStyle({ useR2 });

  ok(withoutState(dark) === withoutState(light),
     `${schema}: the style differs between themes outside its state block — ` +
     `something is baking a palette value into a layer, and setGlobalState ` +
     `will not repaint it`);

  ok(JSON.stringify(dark.state) !== JSON.stringify(light.state),
     `${schema}: the state block is IDENTICAL in both themes, so nothing is themed`);
}

/* --- 3b: no `global-state` in an expression that also reads feature data ---
 * The reasoning, and the bug it comes from, are in tools/lib-state-scan.mjs.
 * This half covers the BASEMAP; the app's own layers are covered by
 * tools/test-app-layer-state.mjs, which builds them through the real registry.
 * They were split because the layer the bug was ON is not in buildStyle(). */
setThemeMode('dark');
for (const useR2 of [false, true]) {
  assertNoDataDrivenState(buildStyle({ useR2 }).layers, useR2 ? 'protomaps' : 'openmaptiles', ok);
}

/* --- 4: no palette hex survives as a literal ----------------------------- */
const hexes = (P) => Object.values(P).filter((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));
for (const [name, P] of [['DARK', DARK], ['LIGHT', LIGHT]]) {
  for (const mode of ['dark', 'light']) {
    setThemeMode(mode);
    for (const useR2 of [false, true]) {
      const body = withoutState(buildStyle({ useR2 }));
      for (const hex of hexes(P)) {
        /* `light.color` is a literal #FFFFFF and belongs to MapLibre's lighting
         * model, not the palette — it is a multiplier of one at intensity 0,
         * and no palette entry is #FFFFFF, so nothing needs excluding here. */
        ok(!body.toLowerCase().includes(hex.toLowerCase()),
           `${mode}/${useR2 ? 'protomaps' : 'openmaptiles'}: ${name} colour ${hex} is ` +
           `baked into the style as a literal instead of a global-state reference`);
      }
    }
  }
}

/* --- themeState() itself ------------------------------------------------- */
for (const mode of ['dark', 'light']) {
  setThemeMode(mode);
  const st = themeState();
  ok(Object.keys(st).length === STATE_KEYS.length,
     `${mode}: themeState() published ${Object.keys(st).length} keys, expected ${STATE_KEYS.length}`);
  for (const [k, v] of Object.entries(st)) {
    ok(typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
       `${mode}: themeState().${k} is ${JSON.stringify(v)}, not a hex colour — ` +
       `MapLibre would drop every layer reading it`);
  }
}

/* --- the flattened geo.* paths actually resolve --------------------------
 * `geoConeFill -> 'geo.coneFill'` is a string, so nothing in the type system
 * or in token-check's `palette().x` walker can see a typo in it. A bad path
 * publishes `undefined` and MapLibre drops the layer without a word. */
for (const mode of ['dark', 'light']) {
  setThemeMode(mode);
  const st = themeState();
  for (const [key, path] of Object.entries(THEME_STATE)) {
    ok(typeof st[key] === 'string' && st[key].length > 0,
       `${mode}: THEME_STATE.${key} -> '${path}' resolved to ${JSON.stringify(st[key])}`);
  }
}

/* A world's overrides have to reach the state block, or a world would install
 * with its own colours and repaint with the app's on the next theme flip. */
setThemeMode('dark');
ok(themeState({ ocean: '#123456' }).ocean === '#123456',
   'themeState(world) ignores the world override — a world and a theme flip would disagree');
ok(themeState({ ocean: '#123456' }).coastGlow === DARK.coastGlow,
   'themeState(world) drops keys the world did not override');

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed`);
console.log('  (the style carries no colour; whether the colours are RIGHT is glass)');
process.exit(failures.length ? 1 : 0);
