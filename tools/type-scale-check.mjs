#!/usr/bin/env node
/**
 * type-scale-check.mjs — every piece of text in the interface is set at one of
 * the seven sizes on the scale, and the scale is the one in index.html.
 *
 * ==> WHAT THIS IS PREVENTING, MEASURED RATHER THAN IMAGINED. <== Before the
 * scale landed, `ui/panels.css` and `ui/home.css` between them declared
 * TWENTY-FIVE distinct font sizes: 0.72, 0.73, 0.74, 0.75, 0.76, 0.78, 0.8,
 * 0.82, 0.85, 0.875, 0.88, 0.9, 0.9375, 0.95, 1.05, 1.25, 1.6 and more, plus a
 * raw `13px` in the nudge. Almost none of those were decisions — each was a
 * number typed while writing one component and never held up against the
 * component next to it.
 *
 * The effect on glass is not "slightly inconsistent". Two sizes 2% apart do
 * not read as a hierarchy, they read as a DIFFERENT TYPEFACE — which is
 * exactly how Aaron described it: "three or four different fonts", in an app
 * that has only ever loaded two.
 *
 * ==> AND WHY IT IS A CHECK AND NOT A COMMENT. <== The old sizes were not
 * added maliciously or carelessly; they were added one at a time by someone
 * with a box that needed to look right, which is a pressure that will exist
 * again next week. A note at the top of the stylesheet asking the next person
 * to use the scale is exactly the guard this project already watched fail —
 * see the fixture tokens in tools/drawer-head-harness.html, which drifted from
 * the app for two commits under a comment asking them not to.
 *
 * IT READS index.html FOR THE SCALE rather than hard-coding the names, so
 * adding an eighth step is a deliberate act with a visible diff, and deleting
 * one fails every rule that still uses it.
 *
 * Run:  node tools/type-scale-check.mjs
 * Exit: 0 clean, 1 on any raw size outside the allow-list.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ==> A NEW STYLESHEET HAS TO BE ADDED HERE BY HAND, AND NOTHING CATCHES THE
 * OMISSION. <== The list is explicit rather than a directory walk so that
 * bringing a sheet under the gate is a deliberate, visible act — but the cost
 * is that a sheet nobody adds is a sheet this tool reports clean without
 * having read. `seasons/seasons.css` (§57.16) is the first one outside `ui/`. */
const SHEETS = ['ui/panels.css', 'ui/home.css', 'ui/nudge.css', 'seasons/seasons.css'];

/**
 * The few places a raw size is the RIGHT answer. Each one is here because the
 * scale genuinely cannot express it, not because it was inconvenient to
 * convert — an exemption without a reason is just the old sprawl with
 * paperwork.
 */
const ALLOWED_RAW = new Map([
  [
    '1.25em',
    'the heading arrow, sized in EM against whatever text it sits beside — it ' +
      'is a glyph scaled to its line, not a type size of its own',
  ],
  [
    'max(1rem, 16px)',
    'the home search input. Below 16px iOS Safari zooms the whole page when ' +
      'the field is focused, which throws the map away mid-search. A floor, ' +
      'not a style choice',
  ],
  [
    'var(--rail-lead-size)',
    'the countdown rail lead, which is `var(--type-small)` indirected through ' +
      'a local name because the rail multiplies it by a line height to place ' +
      'its nodes',
  ],
]);

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

/* --- the scale itself ----------------------------------------------------- */

const appSrc = readFileSync(join(ROOT, 'index.html'), 'utf8');
const scale = new Set(
  [...appSrc.matchAll(/(--type-[a-z0-9-]+)\s*:/g)].map(([, k]) => k)
);

ok(
  scale.size >= 5,
  `index.html declares a real type scale (found ${scale.size} steps: ` +
    `${[...scale].join(', ') || 'none'})`
);

/* ==> AN UPPER BOUND, WHICH IS THE HALF THAT ACTUALLY BITES. <== A check that
 * only demands "use a token" is satisfied by inventing a new token per
 * component, which is the same sprawl with `var()` wrapped round it. The point
 * of a scale is that it is SHORT. Seven is the agreed size; an eighth step is
 * a design decision and should have to argue for itself here. */
ok(
  scale.size <= 7,
  `and it is still a SCALE rather than a collection — ${scale.size} steps ` +
    `where 7 is the agreed ceiling. Adding one means two adjacent steps are ` +
    `now close enough to read as a wobble rather than a hierarchy, which is ` +
    `the condition this whole pass existed to remove`
);

/* --- every declaration in every sheet ------------------------------------- */

for (const rel of SHEETS) {
  const css = readFileSync(join(ROOT, rel), 'utf8')
    /* Comments are stripped first: this file's own prose quotes the old sizes
     * at length, and a check that fails on its own explanation is a check
     * nobody can keep. */
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const lines = css.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/font-size:\s*([^;]+);/);
    if (!m) return;
    const value = m[1].trim();

    if (value.startsWith('var(--type-')) {
      const name = value.slice(4, value.indexOf(')'));
      ok(
        scale.has(name),
        `${rel}:${i + 1} uses ${name}, which index.html does not declare — an ` +
          `unresolvable var() in a font-size does not warn and does not fall ` +
          `back, it silently inherits`
      );
      return;
    }

    if (ALLOWED_RAW.has(value)) { pass++; return; }

    failures.push(
      `${rel}:${i + 1} sets a raw font-size of ${value}. Every size is a step ` +
        `on the scale (${[...scale].join(', ')}). Pick the step by what the ` +
        `text IS — a heading, a body line, a caption — not by how big it needs ` +
        `to look in one box. If no step fits, the box is wrong, not the scale`
    );
  });
}

/* --- the exemptions have to still be real --------------------------------- */

/* An allow-list that outlives the thing it excuses is how a check quietly
 * stops meaning what it says. If an exemption is no longer used anywhere, it
 * goes — otherwise the next raw value that happens to match it sails through
 * on a reason that expired. */
const allSrc = SHEETS.map((rel) => readFileSync(join(ROOT, rel), 'utf8')).join('\n');
for (const [value, why] of ALLOWED_RAW) {
  ok(
    allSrc.includes(`font-size: ${value}`),
    `the exemption for "${value}" (${why}) is no longer used by any rule — ` +
      `delete it rather than leaving a hole open`
  );
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`✓ ${pass} type-scale assertions pass — every size is on the scale`);
