/**
 * css-orphan-check.mjs — the two ways markup and stylesheet drift apart.
 *
 *   node tools/css-orphan-check.mjs
 *
 * ==> WHY THIS EXISTS. <== `ui/view-area-detail.js` shipped with markup and no
 * stylesheet. Every class it emitted — `.area-head`, `.area-name`,
 * `.area-horizons`, `.area-facts`, `.area-note` — resolved to nothing, and the
 * browser fell back to its own defaults: an oversized heading, values indented
 * under labels like a dictionary entry, and a color swatch that did not
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
import {
  walk,
  definedClasses,
  emittedClasses,
} from './markup-scan.mjs';

/* ==> THE READING HALF LIVES IN markup-scan.mjs. <== The directory walk, the
 * comment stripping, what counts as a definition and what counts as an emitted
 * class are shared with `tools/selector-contract-check.mjs`, which asks the
 * other question: whether the selectors the CHECKS query still name anything.
 * Two copies of that reading would drift, and the drift would be silent in
 * exactly the way both gates exist to prevent. Everything below is judgement,
 * which stays here.
 *
 * ==> CLASSES THAT ARE ALLOWED TO HAVE NO RULE, EACH WITH ITS REASON. <==
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
