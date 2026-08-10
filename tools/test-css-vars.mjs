#!/usr/bin/env node
/**
 * test-css-vars.mjs — every `var(--x)` the app writes has an `--x` to read.
 *
 * ==> THIS EXISTS BECAUSE THE HOME DASHBOARD'S HERO RENDERED THREE BLACK
 * SHAPES ON A BLACK GLOBE AND NOTHING SAID A WORD. <==
 *
 * `ui/chart-home.js` fills its 34, 50 and 64 kt wind bands with `var(--kt34)`
 * and friends. Nothing in the app ever defined them. They existed only in
 * `mockups/home-corridor.html`, which declares its own copy because it is a
 * standalone page — so the ONE place the chart could be looked at was the one
 * place the bug could not occur, and that is where it was signed off.
 *
 * WHY IT IS SILENT, WHICH IS THE WHOLE POINT. An unresolvable `var()` in an
 * SVG presentation attribute is not an error and does not fall back. The
 * declaration is invalid at computed-value time, the property reverts to its
 * initial value, and `fill`'s initial value is BLACK. There is no console
 * warning, no missing element, nothing to notice — the chart just quietly
 * stops carrying its meaning. A wind band that reads as a shadow instead of as
 * "hurricane-force wind is on your house" is a §5 failure with a paint job.
 *
 * WHAT IT DOES NOT COVER, stated so nobody trusts it further than it goes: it
 * proves a name is DEFINED somewhere, not that the value is right, not that
 * it is set before first paint, and not that anything is legible. Those are
 * glass. It only closes the specific hole where a name is referenced and never
 * declared at all.
 *
 * `tools/token-check.mjs` is a different check — it walks JS token and global-
 * state references. Neither one could see the other's failure.
 *
 * Zero dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

/** Where the app's own code lives. `mockups/` is deliberately NOT here: a
 *  mockup declares its own variables and is allowed to, which is exactly the
 *  blind spot this file was written for. */
const CODE_DIRS = ['app', 'ui', 'map', 'data', 'lib', 'config'];

function walkCss(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkCss(p, out);
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* ---- what is DECLARED ---------------------------------------------------
 * Two sources, and both are real: the stylesheet in index.html declares the
 * static ones, and applyTokens() writes the themed ones onto the root element
 * at boot. A name is satisfied by either. */
const declared = new Set();

const html = fs.readFileSync('index.html', 'utf8');
for (const m of html.matchAll(/(^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[2]);

const themeSwitch = fs.readFileSync('app/theme-switch.js', 'utf8');
for (const m of themeSwitch.matchAll(/setProperty\(\s*'(--[a-zA-Z0-9-]+)'/g)) declared.add(m[1]);

ok(declared.size > 40, `index.html and applyTokens declare ${declared.size} custom properties`);
ok(declared.has('--ocean') && declared.has('--text-primary'),
   'the scan found the obvious ones, so the parse is not silently empty');

/* ---- what is REFERENCED ------------------------------------------------- */
const files = CODE_DIRS.flatMap((d) => (fs.existsSync(d) ? walk(d) : []));
ok(files.length > 80, `scanning ${files.length} modules`);

const refs = new Map(); // name -> Set(file)
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,|\))/g)) {
    /* `var(--x, fallback)` carries its own answer and cannot go black. */
    if (m[2] === ',') continue;
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(f);
  }
}
/* Deliberately a low bar. Most `var()` in this app already carries a fallback
 * and is skipped above — the ones counted here are the ones that can go black,
 * and there are only a handful. The assertion exists so a broken regex reads
 * as a failure rather than as a clean sweep of nothing. */
ok(refs.size >= 8, `${refs.size} fallback-less custom properties are referenced from JS`);

/* ==> THE THREE THAT WERE MISSING, BY NAME. <== Named individually rather than
 * left to the sweep below, so that deleting them from applyTokens fails with a
 * sentence that says what broke rather than with a list. */
for (const kt of ['--kt34', '--kt50', '--kt64']) {
  ok(declared.has(kt),
     `${kt} is declared — without it the wind bands fill BLACK, silently`);
}
ok(refs.has('--kt34'), 'and the chart does reference them, so this is not testing thin air');

/* ---- ONE GLOW RECIPE, NOT THREE -----------------------------------------
 * ==> A COLOURED DOT MEANS THE SAME THING WHEREVER IT APPEARS (§6). <== The
 * halo had drifted into three recipes with three different blurs across two
 * stylesheets — `.home-swatch`, the storm list's `.row-swatch`, and the
 * countdown rail — because each was written next to the thing that needed it
 * rather than reached for. Three copies of a severity signal is how two of
 * them quietly stop matching, and nobody notices because they are never on
 * screen together.
 *
 * The numbers now live once, in index.html, as `--dot-glow` and
 * `--dot-glow-soft`; a site sets `--dot-ink` and applies the shadow. This
 * fails if a fourth copy is written. */
{
  const cssFiles = fs.existsSync('ui') ? walkCss('ui') : [];
  ok(cssFiles.length > 0, `scanning ${cssFiles.length} stylesheets`);
  const handRolled = [];
  for (const f of cssFiles) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/box-shadow:\s*([^;]+);/g)) {
      const v = m[1].replace(/\s+/g, ' ').trim();
      /* A glow is a blurred shadow with no offset. Insets, borders-as-shadows
       * and offset drop shadows are other things and are left alone. */
      if (/^0 0 (?!0 )/.test(v) || /color-mix/.test(v)) handRolled.push(`${f}: ${v}`);
    }
  }
  ok(handRolled.length === 0,
     handRolled.length
       ? `a hand-rolled glow is back — use var(--dot-glow): ${handRolled.join(' | ')}`
       : 'no stylesheet rolls its own glow');
  ok(declared.has('--dot-glow') && declared.has('--dot-glow-soft'),
     'and the canonical recipe is declared');
  const users = cssFiles.filter((f) => /--dot-ink:/.test(fs.readFileSync(f, 'utf8')));
  ok(users.length >= 2, `at least two stylesheets read it (${users.length})`);
}

/* ---- the sweep ---------------------------------------------------------- */
const missing = [...refs.entries()].filter(([name]) => !declared.has(name));
for (const [name, where] of missing) {
  failures.push(
    `${name} is used in ${[...where].join(', ')} and never declared. ` +
    `An unresolved var() in a presentation attribute renders BLACK without warning.`
  );
}
ok(missing.length === 0, `every referenced custom property resolves (${refs.size} checked)`);

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed — ${refs.size} custom properties, all declared`
);
process.exit(failures.length ? 1 : 0);
