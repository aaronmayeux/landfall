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

/* ==> AND FROM THE STYLESHEETS THEMSELVES. <== A `.css` file declares its own
 * locals — `--body-end`, `--rail-node-top`, the drawer's measurements — and
 * those are as real a declaration as one on `:root`. Collected here so the
 * widened reference sweep below does not report a file's own variables as
 * missing. */
const CSS_FILES = fs.existsSync('ui') ? walkCss('ui') : [];
for (const f of CSS_FILES) {
  for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(/(^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)) {
    declared.add(m[2]);
  }
}

/* ==> AND THE ONES SET ON AN ELEMENT, WHICH ARE THE WHOLE POINT OF FOUR OF
 * THEM. <== `--swatch`, `--dot-ink`, `--sw` and `--rail-dot` are never on
 * `:root` and never should be: a storm's color is per-row, and putting it on
 * the root is exactly the trap the glow block below exists to forbid. They are
 * written by JS, either as an inline `style="--x: ..."` in a template string or
 * through `setProperty`. Both forms count as a declaration.
 *
 * WITHOUT THIS THE WIDENED SWEEP FAILS ON CORRECT CODE, which would be worse
 * than the hole it closes — a check that cries wolf on the right answer gets
 * loosened, and the next genuinely missing name goes out with it. */
const JS_FILES_ALL = CODE_DIRS.flatMap((d) => (fs.existsSync(d) ? walk(d) : []));
for (const f of JS_FILES_ALL) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/style\s*=\s*[\\"'`][^"'`]*?(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);
  for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)/g)) declared.add(m[1]);
}

/* ---- what is REFERENCED -------------------------------------------------
 * ==> THIS USED TO READ `.js` ONLY, AND THAT WAS AN ODD HOLE IN A SUITE
 * WRITTEN ABOUT EXACTLY THIS FAILURE. <== A fallback-less `var()` living in a
 * STYLESHEET was invisible to it, because the bug that prompted the file
 * (`--kt34`) happened to be in a JS file. Five undeclared names were sitting in
 * `ui/home.css` and `ui/panels.css` the whole time: `--radius-snug`,
 * `--surface-raised`, `--accent`, `--touch-min` and `--space-roomy`. The
 * rainfall alert row had no background and no corner; the rainfall Retry had no
 * color and no 44px minimum, which is §10's touch rule broken by a rule nobody
 * could see was broken. */
const files = [...JS_FILES_ALL, ...CSS_FILES];
ok(JS_FILES_ALL.length > 80, `scanning ${JS_FILES_ALL.length} modules`);
ok(CSS_FILES.length >= 3, `and ${CSS_FILES.length} stylesheets — the hole this file used to have`);

const refs = new Map(); // name -> Set(file)
for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'));
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

/* ==> THE LEGEND'S RAMP, PINNED THE SAME WAY AND FOR THE SAME REASON (§47.11).
 * <== `ui/panels.css` builds the environment legend's bar as a gradient across
 * these three, and `applyTokens()` writes them from the same palette entry
 * `lib/cone-ribbon.js` colors the cone slices from. Delete them there and the
 * gradient resolves to nothing — a legend that is present, blank, and silent.
 *
 * They stay named here even though the sweep now reads stylesheets too. A
 * sweep failure prints a list; these print a sentence saying what goes blank,
 * and the legend's bar going blank is not a thing to work out from a name. */
for (const v of ['--env-ramp-floor', '--env-ramp-lo', '--env-ramp-mid', '--env-ramp-hi', '--env-ramp-out']) {
  ok(declared.has(v),
     `${v} is declared — without it the environment legend's bar renders as nothing`);
}

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

/* ---------------------------------------------------------------------------
 * TWO FACES IN ONE ROW MUST SIT ON ONE BASELINE
 *
 * ==> THE STORM DRAWER'S VITALS LIST PRINTED EVERY LABEL A HAIR BELOW ITS OWN
 * VALUE, ON EVERY ROW, AND NOTHING WAS WRONG WITH ANY OF IT. <==
 *
 * `.detail-vitals` is a two-column grid: the label is in the UI face, the
 * value is in `--font-numeric`. A grid item defaults to `stretch`, which
 * agrees the two cells' EDGES and says nothing about where the glyphs sit
 * inside them — and two faces at one font-size put their baseline at
 * different heights in the line box. Measured in Chromium: the text ends up
 * a pixel apart with the substitute faces a Linux box has, and further apart
 * with a real UI/mono pair like SF Pro against SF Mono, which is why Aaron
 * saw it on a desktop before anyone saw it on a phone.
 *
 * `.area-facts`, `.row-head`, `.watch-head` and `.slider-label` all already
 * carried `align-items: baseline`. The rule was known; one grid missed it,
 * and nothing could tell.
 *
 * WHAT THIS CHECKS: any flex or grid container whose own children are given
 * two different `font-family` or `font-size` values has an explicit
 * `align-items`. It does NOT prove the text lines up — that is a browser and
 * ultimately glass. It closes the hole where the question was never asked.
 *
 * Read as text: there is no CSS parser here and none is worth adding.
 * ------------------------------------------------------------------------- */
{
  const cssText = walkCss('ui').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  /* Comments out first — several of them quote `display: grid` in prose. */
  const css = strip(cssText);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim().split('\n').pop().trim(),
    body: m[2],
  }));

  const containers = rules.filter(
    (r) => /display:\s*(grid|flex)/.test(r.body) && /^\.[\w-]+$/.test(r.sel)
  );

  const offenders = [];
  for (const c of containers) {
    if (/align-items/.test(c.body)) continue;
    /* Rules targeting something INSIDE this container. A descendant two levels
     * down is not a sibling of anything and cannot misalign against one, so
     * only the immediate children pattern (`.x dt`, `.x > *`, `.x .y`) counts
     * — which over-collects slightly and is the safe direction for a check
     * that fails loudly. */
    const kids = rules.filter((r) => r.sel.startsWith(`${c.sel} `) || r.sel.startsWith(`${c.sel}>`));
    const faces = new Set();
    const sizes = new Set();
    for (const k of kids) {
      const f = /font-family:\s*([^;]+)/.exec(k.body);
      const s = /font-size:\s*([^;]+)/.exec(k.body);
      if (f) faces.add(f[1].trim());
      if (s) sizes.add(s[1].trim());
    }
    /* ONE declared face beside the inherited one is already two faces in the
     * row. Same for size. */
    if (faces.size >= 1 || sizes.size >= 1) {
      if (kids.length > 1) offenders.push(`${c.sel} (faces: ${[...faces].join(', ') || 'inherited'})`);
    }
  }
  ok(
    offenders.length === 0,
    'every flex/grid row whose children change face or size states its '
    + `align-items — these do not: ${offenders.join('; ')}`
  );

  /* The one that actually broke, pinned by name so the general sweep above
   * cannot be loosened out from under it. */
  const vitals = /\.detail-vitals\s*\{([^}]*)\}/.exec(css)?.[1] || '';
  ok(
    /align-items:\s*baseline/.test(vitals),
    '.detail-vitals is baseline-aligned — its labels are in the UI face and '
    + 'its values are in the monospace one, and `stretch` lines up the boxes '
    + 'rather than the text'
  );
}

/* ---------------------------------------------------------------------------
 * THE SCROLLER STOPS AT THE PANEL'S ROUNDED CORNER
 *
 * The wide rail is rounded on its right edge and the scrollbar lives on that
 * same edge, so a scroller filling the panel to the last pixel put the bar's
 * final 16px where the glass had already curved away. A scrollbar cannot be
 * shortened on its own — it always fills its scroller — so the scroller ends
 * early instead, via a transparent bottom border of exactly `--radius-large`.
 *
 * ==> AND THE FIRST ATTEMPT SILENTLY DID NOTHING. <== The default lives on
 * `.drawer-body`; the wide override sits ~200 lines earlier in the same file.
 * A media query adds NO specificity, so a bare `.drawer-body` inside it tied
 * with the default and lost on source order — computed value `0px`, corner
 * exactly as broken, fix apparently in place. Caught only by reading the
 * computed style out of a browser instead of trusting the diff.
 * ------------------------------------------------------------------------- */
{
  const panels = strip(fs.readFileSync('ui/panels.css', 'utf8'));
  ok(
    /--body-end:\s*0px/.test(panels),
    'the scroller has a zero default inset — the phone sheet has square bottom '
    + 'corners and must not lose the room'
  );
  ok(
    /#drawer\s+\.drawer-body\s*\{\s*--body-end:\s*var\(--radius-large\)/.test(panels),
    'the wide rail insets the scroller by its OWN corner radius, and does it '
    + 'through an id so the rule cannot lose to the later default on source '
    + 'order — a media query carries no specificity of its own'
  );
  ok(
    /border-bottom:\s*var\(--body-end\)\s+solid\s+transparent/.test(panels),
    'and it does it with a transparent border, which is the only thing that '
    + 'moves a scrollbar track without an extra wrapper element'
  );
  ok(
    (panels.match(/transparent calc\(100% - var\(--body-end\)\)/g) || []).length === 2,
    'both mask declarations back their bottom fade off by the same inset — the '
    + 'mask is measured from the BORDER box, so a fade ending at 100% would '
    + 'land inside the transparent border where nothing paints, and the content '
    + 'would be guillotined mid-glass instead'
  );
}

/* ---------------------------------------------------------------------------
 * HOVER IS ITS OWN TOKEN, NOT A PANEL COLOR
 *
 * Row hovers were painted with `--glass-raised`, which is the color of a
 * RAISED PANEL — in the dark theme a dark blue, laid over a drawer that is
 * already dark blue over a near-black ocean. Measured composite moved from
 * rgb(7,15,26) to rgb(10,21,35): real on paper, invisible on a screen, and
 * hover only exists on a desktop where that screen is biggest.
 *
 * `--hover` is a light wash in the dark theme and a dark one in the light
 * theme. The mistake is easy to make again precisely because `--glass-raised`
 * is the obviously-adjacent name.
 * ------------------------------------------------------------------------- */
{
  const wrong = [];
  for (const f of walkCss('ui')) {
    const css = strip(fs.readFileSync(f, 'utf8'));
    for (const m of css.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)) {
      if (/background:\s*var\(--glass(-raised)?\)/.test(m[2])) {
        wrong.push(`${path.basename(f)}: ${m[1].trim().split('\n').pop().trim()}`);
      }
    }
  }
  ok(
    wrong.length === 0,
    'a hover background uses `--hover`, never a glass panel color — these do '
    + `not: ${wrong.join('; ')}`
  );

  /* And the token has to exist in EVERY palette, or one theme has no hover at
   * all and nothing throws.
   *
   * ==> THIS USED TO ASSERT THE COUNT WAS EXACTLY TWO, AND SEASONS §57.30 STEP
   * 1 TURNED IT RED BY DOING THE RIGHT THING. <== It added SEPIA as a third
   * palette, correctly declaring `hover` along with everything else — so a
   * suite counting to two failed on a file that was fine. A hardcoded count is
   * a test that goes off every time the app grows, which trains people to
   * ignore it.
   *
   * So the palettes are DISCOVERED rather than named: every exported object
   * carrying a `focusRing` is one, because a palette is exactly the thing that
   * has to answer "where is the keyboard". The next palette is covered the day
   * it is written, and nobody has to remember this line exists.
   *
   * ==> AND HERE IS WHAT IT CANNOT CATCH, MEASURED RATHER THAN ASSUMED. <==
   * Deleting SEPIA's `hover` leaves this GREEN, because `SEPIA` opens with
   * `...DARK` and simply inherits it. That is not a hole — a palette built by
   * spreading another cannot lose a token, so there is nothing there to catch.
   * The palettes at risk are the ones written from scratch, and `LIGHT` is the
   * only one today. Verified by deleting `hover` from `LIGHT` and from `DARK`
   * in turn: both go red and both name the palette. If a future palette spreads
   * nothing, it joins the set this actually protects. */
  const tokens = await import('../config/tokens.js');
  const palettes = Object.entries(tokens).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && 'focusRing' in v
  );
  ok(palettes.length >= 2, `at least two palettes were found, got ${palettes.length}`);
  const noHover = palettes
    .filter(([, v]) => !/^rgba/.test(String(v.hover || '')))
    .map(([k]) => k);
  ok(
    noHover.length === 0,
    'every palette declares a `hover` color — an undeclared one resolves to '
    + `nothing and the row simply stops responding to the pointer: ${noHover.join(', ')}`
  );
}

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
