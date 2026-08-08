/**
 * test-maplibre-api.mjs — every MapLibre method we call has to exist.
 *
 * ==> WHY THIS FILE EXISTS. <== On 2026-08-08 the theme switch shipped calling
 * `map.setGlobalState(themeState())`. There is no such method on MapLibre's
 * Map. `setGlobalState` exists on the STYLE, takes a different shape, and does
 * not mark the style dirty. The Map's method is `setGlobalStateProperty`.
 *
 * Every check in this repo passed. `check-syntax` parses modules and resolves
 * OUR imports; it cannot know what a vendored UMD bundle exposes.
 * `token-check` resolves palette keys. The style validator validated the style,
 * which was fine — the bug was in the code that CHANGES it. Nothing here has
 * ever been able to see a plausible-looking method that does not exist, and
 * that is the single most likely mistake anyone makes against a large API they
 * are reading about rather than reading.
 *
 * The symptom was also quiet in the worst way: the call threw inside a settings
 * subscriber, so the chrome and the 3D globe (which retheme first) changed and
 * the map did not. It looked like a repaint bug, not a TypeError.
 *
 * HOW IT WORKS. Collect every `map.NAME(` / `this.map.NAME(` call site in the
 * app, then check NAME appears as a method definition in the vendored bundle.
 * The bundle is minified, so the test is textual: `NAME(` preceded by something
 * that is not a dot. That is loose — it proves the name EXISTS somewhere in
 * MapLibre, not that it is on Map — but the failure it is built for is a name
 * that exists NOWHERE, which is what a made-up API looks like.
 *
 * KNOWN LIMIT, STATED SO NOBODY TRUSTS IT TOO FAR: a real method on the wrong
 * class still passes. `map.setGlobalState` would NOT have been caught by the
 * existence half of this test, because Style really does have it — which is
 * precisely how it got written. So the explicit block at the bottom does the
 * rest of the job for the one case that bit us, and any future case where a
 * method exists on Style but not on Map should be added there.
 *
 * Zero dependencies. `node tools/test-maplibre-api.mjs`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/maplibre-gl-5.6.0.js'), 'utf8');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

const SKIP = new Set(['node_modules', '.git', 'vendor', 'tools', 'samples', 'assets', 'worker', 'functions']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* Ours, not MapLibre's. Every entry is a local object that happens to be named
 * `map` or a method we define on a wrapper — a name here is a promise that it
 * is not a MapLibre call, so keep it short and keep it honest. */
const NOT_MAPLIBRE = new Set(['forEach', 'has', 'get', 'set', 'delete', 'clear', 'keys', 'values', 'entries', 'size']);

const calls = new Map(); // method -> Set(file)
for (const file of walk(ROOT)) {
  const text = stripComments(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);
  for (const m of text.matchAll(/\bmap\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (NOT_MAPLIBRE.has(m[1])) continue;
    if (!calls.has(m[1])) calls.set(m[1], new Set());
    calls.get(m[1]).add(rel);
  }
}

ok(calls.size > 20, `only ${calls.size} map.* call sites found — the walker is not finding the app`);

for (const [name, files] of [...calls].sort()) {
  /* `NAME(` not preceded by a dot: a definition rather than another call. */
  const defined = new RegExp(`[^.\\w$]${name}\\s*\\(`).test(BUNDLE);
  ok(defined,
     `map.${name}() does not exist anywhere in maplibre-gl 5.6.0 — called from ${[...files].join(', ')}`);
}

/* ------------------------------------------------------------------------
 * THE EXPLICIT HALF. Methods that are real, but on the wrong object.
 *
 * `Style.setGlobalState` exists. `Map.setGlobalState` does not, and the
 * existence check above cannot tell them apart. This is the list of names we
 * have actually been burned by; it is not a general solution and does not
 * pretend to be.
 * --------------------------------------------------------------------- */
const STYLE_ONLY = {
  setGlobalState:
    'exists on Style, not Map, and takes { key: { default } } rather than a flat map. ' +
    'Use map.setGlobalStateProperty(key, value) — it also calls _update(true), which is ' +
    'what marks the style dirty so paint properties re-evaluate.',
};
for (const [name, why] of Object.entries(STYLE_ONLY)) {
  ok(!calls.has(name),
     `map.${name}() is called from ${[...(calls.get(name) || [])].join(', ')} — ${why}`);
}

/* AND THE ONE WE REPLACED IT WITH IS THE MAP'S, AND CALLS `_update(true)`.
 *
 * That second half is the whole reason it is the right method: `_update(true)`
 * sets `_styleDirty`, which is what makes MapLibre re-evaluate the paint
 * properties reading the changed key. The Style method writes the value and
 * stops, which repaints nothing — swap one for the other and the theme change
 * goes silent again in exactly the way it already did once.
 *
 * Pinned against the minified body because that is the only place the fact
 * lives. If a vendor bump changes the shape, this fails and someone re-reads
 * it, which is the correct outcome — it is not a promise that MapLibre will
 * never refactor. */
const MINIFIED = BUNDLE.replace(/\s+/g, '');
ok(MINIFIED.includes('setGlobalStateProperty(e,t){returnthis.style.setGlobalStateProperty(e,t),this._update(!0)}'),
   'Map.setGlobalStateProperty is no longer "write the value, then _update(true)". ' +
   'Re-read the bundle before trusting the theme switch — this is the call that repaints the basemap.');

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed (${calls.size} distinct map.* methods)`);
process.exit(failures.length ? 1 : 0);
