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

/* ==> COMMENTS ARE STRIPPED BEFORE ANYTHING IS SCANNED. <== This file's own
 * prose quotes the broken pattern it exists to forbid, and the first version
 * of the trap check below matched that quotation and failed on a file that was
 * correct. The same flaw runs the other way and is worse: a variable mentioned
 * only in a comment would have counted as DECLARED, and the sweep at the end
 * would have passed over a genuinely missing one — which is the exact bug this
 * whole suite was written for. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ');
const html = strip(fs.readFileSync('index.html', 'utf8'));
for (const m of html.matchAll(/(^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[2]);

const themeSwitch = strip(fs.readFileSync('app/theme-switch.js', 'utf8'));
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

/* ---- THE GLOW ----------------------------------------------------------
 * ==> IT WAS NOT DULL. IT WAS ABSENT, AND THAT TOOK THREE PASSES TO SEE. <==
 *
 * A colored dot means the same thing wherever it appears (§6), so the halo's
 * radius is shared. What CANNOT be shared is the whole shadow. Declaring
 * `--dot-glow: 0 0 8px var(--dot-ink)` on `:root` and setting `--dot-ink` per
 * element looks like the obvious consolidation and does not work: a custom
 * property containing `var()` is substituted at computed-value time ON THE
 * ELEMENT WHERE IT IS DECLARED. `:root` has no `--dot-ink`, so the property
 * computes to `0 0 8px transparent` and every descendant inherits THAT.
 *
 * It fails silently and it fails completely — background intact, halo gone.
 * Three rounds were spent tuning ring, spread and opacity on a shadow that had
 * been transparent since the first line of it was written. Nothing in a diff
 * shows it and no parser complains.
 *
 * So: the radius is a token, the ink is composed locally, and this pins both
 * halves plus the trap by name.
 * --------------------------------------------------------------------- */
{
  const cssFiles = fs.existsSync('ui') ? walkCss('ui') : [];
  ok(cssFiles.length > 0, `scanning ${cssFiles.length} stylesheets`);

  ok(declared.has('--dot-glow-blur'), 'the shared glow radius is declared');

  /* ==> THE TRAP, BY NAME AND BY SHAPE. <== Not just the old name: ANY custom
   * property whose value is a length followed by a `var()` this file does not
   * also declare is the same mistake wearing a different label. */
  const rootDecls = [...html.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)];
  const traps = rootDecls.filter(([, , v]) => {
    if (!/\d+px/.test(v)) return false;
    const refs = [...v.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
    return refs.some((r) => !declared.has(r));
  });
  ok(traps.length === 0,
     traps.length
       ? `a whole shadow on :root referencing a per-element property — it will ` +
         `compute against :root and come out transparent: ` +
         traps.map(([, k]) => k).join(', ')
       : 'and no custom property composes a shadow from a per-element variable');

  /* Every glow in the app uses the shared radius and composes its own ink. */
  const glows = [];
  const bare = [];
  for (const f of cssFiles) {
    for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(/box-shadow:\s*([^;]+);/g)) {
      const v = m[1].replace(/\s+/g, ' ').trim();
      for (const part of v.split(/,(?![^(]*\))/)) {
        const p2 = part.trim();
        if (!/^0 0 (?!0\b)/.test(p2)) continue; // insets, rings and offsets are other things
        glows.push(`${f}: ${p2}`);
        if (!/var\(--dot-glow-blur\)/.test(p2)) bare.push(`${f}: ${p2}`);
      }
    }
  }
  ok(glows.length >= 3, `${glows.length} glows found across the app`);
  ok(bare.length === 0,
     bare.length
       ? `a glow with a hand-written radius — use var(--dot-glow-blur): ${bare.join(' | ')}`
       : 'every one of them takes its radius from the shared token');

  /* And each composes a REAL ink, not a fallback that renders nothing. */
  const inkless = glows.filter((g) => /transparent\)?$/.test(g));
  ok(inkless.length === 0,
     inkless.length ? `a glow with no ink: ${inkless.join(' | ')}` : 'and each carries a real ink');

  /* The storm list's, specifically, because it is the one that is right and
   * the one everything else was consolidated onto. */
  const panels = strip(fs.readFileSync('ui/panels.css', 'utf8'));
  ok(/\.row-swatch\s*\{[^}]*box-shadow: 0 0 var\(--dot-glow-blur\) var\(--swatch\)/s.test(panels),
     'the storm list dot is 0 0 <shared radius> of its own swatch color, as it always was');
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
/* ---------------------------------------------------------------------------
 * THE TIMELINE RAIL'S ARITHMETIC
 *
 * ==> THE NODES SAT 2.5px BELOW THEIR OWN TEXT AND THREE PASSES OVER THAT
 * BLOCK MISSED IT. <== Not a `var()` problem, so the check above could never
 * have seen it — but it is the same failure shape: a number that is silently
 * wrong and looks almost right. Two specific regressions are pinned, both of
 * which were the actual cause at some point.
 *
 * A browser is what would prove the alignment; this proves the two conditions
 * that made it impossible to get right by eye. `home.css` is read as text
 * because there is no CSS parser here and none is worth adding for this.
 * ------------------------------------------------------------------------- */
{
  const home = fs.readFileSync(path.join(ROOT, 'ui/home.css'), 'utf8');

  /* ==> AN UNDECLARED LINE-HEIGHT IS WHY THIS KEPT COMING BACK. <== Inheriting
   * `normal` lets the FONT choose the lead's line box, so it is one height in
   * Chromium and another in Safari's ui-monospace — and any offset tuned by
   * eye on one platform is wrong on the other. */
  /* Anchored at line start: `.home-rail li[data-key="held"] .home-rail-lead`
   * appears earlier and matches an unanchored pattern first. */
  const lead = /^\.home-rail-lead\s*\{([^}]*)\}/m.exec(home)?.[1] || '';
  ok(/line-height\s*:/.test(lead),
    '.home-rail-lead declares its line-height rather than inheriting `normal`');
  ok(/font-size\s*:\s*var\(--rail-lead-size\)/.test(lead)
     && /line-height\s*:\s*var\(--rail-lead-line\)/.test(lead),
    'the lead reads the same size and line box the node offset is computed from');

  /* The node's vertical offset must be DERIVED from that line box, not a
   * literal tuned against it. A literal here is the bug, restored. */
  const rail = /^\.home-rail\s*\{([^}]*)\}/m.exec(home)?.[1] || '';
  const nodeTop = /--rail-node-top\s*:\s*([^;]+);/.exec(rail)?.[1] || '';
  ok(/calc\(/.test(nodeTop),
    '--rail-node-top is computed, not a guessed pixel value');
  ok(/--rail-lead-size/.test(nodeTop) && /--rail-lead-line/.test(nodeTop)
     && /--rail-node/.test(nodeTop),
    'and it is computed from the lead line box and the node size');

  /* The node must be border-box: with the default `content-box` a 12px node
   * with a 1.6px border renders 15.2px and every offset above is a lie. */
  const dot = /^\.home-rail li::before\s*\{([^}]*)\}/m.exec(home)?.[1] || '';
  ok(/box-sizing\s*:\s*border-box/.test(dot),
    'the rail node is border-box, so its declared size is its real size');
}

console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed — ${refs.size} custom properties, all declared`
);
process.exit(failures.length ? 1 : 0);
