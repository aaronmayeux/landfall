/**
 * css-orphan-check.mjs — the two ways markup and stylesheet drift apart.
 *
 *   node tools/css-orphan-check.mjs
 *
 * ==> WHY THIS EXISTS. <== `ui/view-area-detail.js` shipped with markup and no
 * stylesheet. Every class it emitted — `.area-head`, `.area-name`,
 * `.area-horizons`, `.area-facts`, `.area-note` — resolved to nothing, and the
 * browser fell back to its own defaults: an oversized heading, values indented
 * under labels like a dictionary entry, and a colour swatch that did not
 * appear at all, because an inline <span> ignores width and height.
 *
 * NOTHING CAUGHT IT, AND NOTHING COULD HAVE. The JS was correct, the strings
 * were correct, `check-syntax` passed, all forty suites passed. The failure was
 * that a name in the markup had no counterpart in the CSS, which is not a
 * runtime error in a browser — it is silence, and §5's rule about silence
 * applies to the stylesheet exactly as it does to the feed.
 *
 * The same sweep found `.detail-geo-block`, emitted on every geometry notice in
 * the storm panel and never authored, and 47 lines of `.detail-link*` left
 * behind when the Layers shortcut was removed.
 *
 * TWO DIRECTIONS, AND THEY ARE DIFFERENT BUGS:
 *
 *   EMITTED, NEVER STYLED   a visible defect. The markup asks for a look that
 *                           does not exist and the user sees the fallback.
 *   STYLED, NEVER EMITTED   dead weight. It ships to every visitor, and it
 *                           lies to the next reader about what the app draws.
 *
 * ==> IT IS A TEXT SCAN, AND IT IS DELIBERATELY BLUNT. <== It cannot see a
 * class assembled at runtime (`\`row-\${tone}\``) and it does not try. The
 * cost of that is a false alarm, which a human resolves in ten seconds by
 * adding a line to HOOKS below. The cost of the alternative — being clever
 * enough to miss a real one — is another unstyled panel shipping to a phone.
 * When in doubt this shouts.
 */

import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['vendor', 'node_modules', '.git', 'mockups', 'proto']);

/* `mockups/` and `proto/` are skipped ON BOTH SIDES. They are scratch HTML with
 * their own inline styles and no relationship to the shipped app; counting them
 * as either emitters or definitions makes every answer here meaningless. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* ==> CLASSES THAT ARE ALLOWED TO HAVE NO RULE, EACH WITH ITS REASON. <==
 * A class in this list is a HOOK: something the code finds or labels with,
 * never something it paints with. Adding a name here is a claim that it is
 * meant to be invisible — so it takes a reason, and the reason is read by
 * whoever is deciding whether the next one belongs. */
const HOOKS = new Map([
  ['home-dash', 'query hook — view-home.js finds its own body with it'],
  ['list-partial', 'query hook — view-storms.js removes the old note by it'],
  ['home-pin-provisional', 'identity only; the pin sets every property inline'],
  ['home-result-label', 'the parent .home-result carries the whole layout'],
  ['watch-rows', 'role="list" wrapper; .watch-row does the painting'],
  ['watch-title', 'span inside .watch-head, which styles the whole heading'],
]);

/* Stylesheets, plus every inline <style> in the app's own HTML, plus CSS a
 * module builds and injects at runtime.
 *
 * THAT LAST CASE IS NOT AN EDGE CASE — it is how `replay/boot.js` styles its
 * whole bar: `document.createElement('style')` and a template literal into
 * `.textContent`. Reading only literal `<style>` tags reported its five
 * classes as unstyled when they are styled twenty lines below where they are
 * emitted, in the same file. */
function definedClasses(files) {
  const defined = new Map();
  const record = (text, where) => {
    for (const m of stripComments(text).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (!defined.has(m[1])) defined.set(m[1], new Set());
      defined.get(m[1]).add(where);
    }
  };
  for (const f of files) {
    if (f.endsWith('.css')) record(fs.readFileSync(f, 'utf8'), f);
    else if (/\.(html|js)$/.test(f)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) record(m[1], f);
      for (const m of src.matchAll(/\.(?:textContent|innerHTML)\s*=\s*`([\s\S]*?)`/g)) {
        /* Only if it actually looks like a rule block. An arbitrary template
         * assigned to innerHTML is markup, and mining it for `.foo` would let
         * any dotted word in prose count as a definition. */
        if (/\{[^}]*:[^}]*\}/.test(m[1])) record(m[1], f);
      }
    }
  }
  return defined;
}

/* Only what the SHIPPED app emits. `tools/` is harnesses and `functions/` is
 * server-side; both invent markup that no app stylesheet owes anything to. */
function emittedClasses(files) {
  const used = new Map();
  const add = (c, f) => {
    if (!c) return;
    if (!used.has(c)) used.set(c, new Set());
    used.get(c).add(f);
  };
  for (const f of files) {
    if (!/\.(js|mjs|html)$/.test(f)) continue;
    if (f.startsWith('tools/') || f.startsWith('functions/')) continue;
    let src = fs.readFileSync(f, 'utf8');
    src = stripComments(src);
    src = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    /* A `class="..."` containing `${` is skipped whole: the interpolated part
     * is unknowable here, and guessing at the literal fragments around it
     * invents half-names that match nothing. */
    for (const m of src.matchAll(/class\s*=\s*["']([^"'${}]+)["']/g))
      for (const c of m[1].split(/\s+/)) add(c, f);
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g))
      for (const q of m[1].matchAll(/['"]([\w-]+)['"]/g)) add(q[1], f);
    for (const m of src.matchAll(/className\s*=\s*['"]([^'"]+)['"]/g))
      for (const c of m[1].split(/\s+/)) add(c, f);
    /* A class the code LOOKS FOR is a contract too: if `querySelector('.foo')`
     * finds nothing because nothing emits `.foo`, that is the same silence. */
    for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]/g))
      for (const q of m[1].matchAll(/\.([\w-]+)/g)) add(q[1], f);
  }
  return used;
}

const files = walk('.');
const defined = definedClasses(files);
const emitted = emittedClasses(files);

/* For the reverse direction, ANY mention in any source counts as emitting —
 * far looser than the forward scan. Calling a live rule dead would delete
 * working style, so this half errs hard toward silence. */
const allSource = files
  .filter((f) => /\.(js|mjs|html)$/.test(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

const unstyled = [...emitted.entries()]
  .filter(([c]) => !defined.has(c) && !HOOKS.has(c))
  .sort();

const dead = [...defined.entries()]
  .filter(([c]) => {
    if (emitted.has(c) || HOOKS.has(c)) return false;
    return !new RegExp(`['"\\s.>]${c.replace(/-/g, '\\-')}['"\\s\`,)]`).test(allSource);
  })
  .sort();

/* A hook that has since been given a real rule is not an error, but the entry
 * is now a lie about why the class exists — so it is reported, quietly. */
const staleHooks = [...HOOKS.keys()].filter((c) => defined.has(c));

for (const [c, where] of unstyled)
  console.log(`  FAIL  [unstyled] .${c} is emitted by ${[...where].join(', ')} and no rule defines it`);
for (const [c, where] of dead)
  console.log(`  FAIL  [dead] .${c} is defined in ${[...where].join(', ')} and nothing emits it`);
for (const c of staleHooks)
  console.log(`  note  .${c} is listed as a hook but now has a rule — drop it from HOOKS`);

const failures = unstyled.length + dead.length;
if (failures) {
  console.log(
    `\n${failures} orphan${failures === 1 ? '' : 's'}.\n` +
      `An emitted class with no rule renders at the browser's defaults and the user sees it.\n` +
      `A rule with nothing to match ships to every visitor for nothing.\n` +
      `If the class is a hook and is meant to be invisible, add it to HOOKS with a reason.`
  );
  process.exit(1);
}

console.log(
  `\n  ok    markup and stylesheets agree — ` +
    `${emitted.size} classes emitted, ${defined.size} defined, ${HOOKS.size} hooks exempt`
);
