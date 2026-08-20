#!/usr/bin/env node
/**
 * text-role-check.mjs — every piece of text in a drawer is one of six roles,
 * and the role decides its size and its colour. Not the component it happens
 * to live in.
 *
 *   node tools/text-role-check.mjs
 *
 * ==> WHAT THIS IS PREVENTING, COUNTED RATHER THAN IMAGINED. <== Before the
 * role table landed, `ui/panels.css`, `ui/home.css` and `ui/nudge.css` between
 * them used EIGHTEEN distinct combinations of type step and text colour. None
 * of the eighteen was a decision about hierarchy; each was a number typed while
 * looking at one component and never held up against the component beside it.
 *
 * The effect on glass was not "slightly inconsistent". Headings were muted and
 * the prose under them was primary, so on every panel the least important line
 * was the brightest. Aaron's words, 2026-08-20: "inconsistent/random text size
 * and color changes throughout the drawers... it makes our text look
 * disjointed."
 *
 * ==> AND WHY IT IS A CHECK AND NOT A COMMENT. <== The eighteen were not added
 * carelessly. They were added one at a time by someone with a box that needed
 * to look right, which is a pressure that will exist again next week. A note at
 * the top of the stylesheet asking the next person to use the table is exactly
 * the guard this project has already watched fail — see the fixture tokens in
 * tools/drawer-head-harness.html, which drifted from the app for two commits
 * under a comment asking them not to. `tools/type-scale-check.mjs` exists for
 * the same reason and this is its sibling: that one holds the SIZES to a scale,
 * this one holds the PAIRINGS to a meaning.
 *
 * ==> IT IS A CONTRACT ON NAMED SELECTORS, NOT A BAN ON EVERYTHING ELSE. <==
 * A selector in the table below must resolve to its role's size and colour. A
 * selector not in the table is ignored. That is deliberate: drawer chrome, list
 * rows and control states are settled components with their own internal
 * hierarchy, and forcing them into six buckets would be inventing a problem.
 * What the table covers is the BODY CONTENT of the drawers, which is what read
 * as disjointed.
 *
 * ==> HOW IT RESOLVES. <== It parses the three stylesheets in load order and
 * walks every rule, recording the last `font-size` and `color` declared for
 * each selector — the same thing the cascade does, at the same specificity,
 * which is why the role table can live in `panels.css` and still govern
 * selectors declared in `home.css`. A later rule re-declaring a property is
 * what breaks a role, and that is precisely the drift being watched for.
 *
 * TONE COLOURS ARE NOT ROLE COLOURS. `--error`, `--stale`, category ink and
 * watch/warning ink are semantic state (§6). A rule may paint one ON TOP of a
 * role — that is what a stale timestamp is — so any colour that is not one of
 * the three neutrals is ignored rather than failed.
 *
 * Exit: 0 clean, 1 on any selector that has drifted off its role or vanished.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Load order, and it matters — this is what makes the cascade resolvable. */
const SHEETS = ['ui/panels.css', 'ui/home.css', 'ui/nudge.css'];

/**
 * The six roles. Size and colour are the WHOLE definition — weight, tracking
 * and case belong to the two heading roles and are checked with them.
 */
const ROLE = Object.freeze({
  heading: { size: 'type-body', color: 'text-primary' },
  sublabel: { size: 'type-micro', color: 'text-secondary' },
  value: { size: 'type-body', color: 'text-primary' },
  valueLabel: { size: 'type-body', color: 'text-secondary' },
  body: { size: 'type-body', color: 'text-secondary' },
  footnote: { size: 'type-small', color: 'text-muted' },
});

/**
 * The contract. A selector here MUST resolve to its role.
 *
 * ==> ROLE 3, THE HEADLINE FIGURE, IS NOT IN THIS TABLE AND THAT IS ON
 * PURPOSE. <== There are four of them, each sized to the block it anchors —
 * a population count and a distance are not the same object and forcing one
 * size on both would be the sprawl this file exists to stop, wearing a
 * uniform. They are listed under `HEADLINE` below and checked only for being
 * PRIMARY, which is the part of role 3 that is actually a rule.
 */
const CONTRACT = Object.freeze({
  heading: [
    '.basin-head',
    '.watch-head',
    '.layer-group-head',
    '.detail-section-head h2',
    '.settings-label',
    '.home-kicker',
  ],
  sublabel: [
    '.model-family-head',
    '.detail-kicker',
    '.detail-env-figs-head',
    '.area-discussion-head',
    '.area-source',
    '.home-figs-k',
  ],
  value: [
    '.detail-figure',
    '.detail-env-fig-v',
    '.area-horizon-value',
    '.home-figs-v',
    '.home-rail-ev',
    '.home-rain-line',
    '.home-surge-line',
  ],
  valueLabel: ['.detail-env-fig-k'],
  body: [
    '.detail-soft',
    '.detail-empty',
    '.detail-env-paragraph',
    '.detail-people-note',
    '.detail-rain-para',
    '.detail-cap-english',
    '.detail-cap-words',
    '.detail-advisory',
    '.settings-note',
    '.list-note',
    '.area-horizon-label',
    '.area-horizon-risk',
    '.area-discussion',
    '.install-steps',
    '.slider-label',
    '.home-where-motion',
    '.home-when',
    '.home-locate-help',
    '.home-edit',
    '.home-rain-peak',
    '.home-surge-worst',
  ],
  footnote: [
    '.detail-env-note',
    '.detail-ww-note',
    '.detail-rain-note',
    '.detail-cap-meta',
    '.detail-cap-note',
    '.detail-cap-toggle',
    '.detail-advisory-from',
    '.detail-stamp',
    '.detail-stamp-detail',
    '.detail-geo-detail',
    '.detail-disclaimer',
    '.env-legend-note',
    '.layer-row-sub',
    '.layer-note',
    '.model-sub',
    '.settings-soft',
    '.area-note',
    '.area-stamp',
    '.rain-alert-until',
    '.home-band',
    '.home-stamp',
    '.home-pressure',
    '.home-figs-s',
    '.home-rail-det',
    '.home-now-coords',
    '.home-confirm-coords',
    '.home-rain-note',
    '.home-surge-note',
  ],
});

/** Role 3. Checked for PRIMARY only — the size is the block's own business. */
const HEADLINE = Object.freeze(['.detail-people-figure', '.area-name', '.home-big']);

/** The three neutrals. Anything else in a `color:` is semantic state (§6). */
const NEUTRALS = new Set(['text-primary', 'text-secondary', 'text-muted']);

/* --- parse ---------------------------------------------------------------
 * Comments out first (a `/* ... *\/` can contain braces and a colour name),
 * then a flat walk of `selectors { declarations }`. No nesting to worry about:
 * this project's CSS has media queries but no nested rules, and a declaration
 * inside a media query is a STATE rather than a role — so blocks whose
 * selector list looks like an at-rule are skipped.
 */
function declarations() {
  /** @type {Map<string, {size: string|null, color: string|null, weight: string|null, transform: string|null, tracking: string|null, where: string}>} */
  const seen = new Map();

  for (const rel of SHEETS) {
    const css = readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const selectors = m[1];
      if (selectors.includes('@')) continue;
      const body = m[2];

      const size = /font-size:\s*var\(--(type-[a-z]+)\)/.exec(body)?.[1] ?? null;
      /* The negative lookbehind keeps `border-right-color` and friends out. */
      const color = /(?<![-\w])color:\s*var\(--([a-z-]+)\)/.exec(body)?.[1] ?? null;
      const weight = /font-weight:\s*(\d+)/.exec(body)?.[1] ?? null;
      const transform = /text-transform:\s*([a-z]+)/.exec(body)?.[1] ?? null;
      const tracking = /letter-spacing:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null;
      if (!size && !color && !weight && !transform && !tracking) continue;

      for (const raw of selectors.split(',')) {
        const sel = raw.trim().replace(/\s+/g, ' ');
        if (!sel) continue;
        const prev = seen.get(sel) || {
          size: null, color: null, weight: null, transform: null, tracking: null, where: rel,
        };
        /* LAST WINS, which is the cascade at equal specificity. A component
         * rule further down the file re-declaring a property is exactly the
         * drift this file watches for, so it must be what the check sees. */
        seen.set(sel, {
          size: size ?? prev.size,
          color: NEUTRALS.has(color) ? color : prev.color,
          weight: weight ?? prev.weight,
          transform: transform ?? prev.transform,
          tracking: tracking ?? prev.tracking,
          where: size || color ? rel : prev.where,
        });
      }
    }
  }
  return seen;
}

/* --- check ---------------------------------------------------------------- */

const seen = declarations();
const problems = [];

for (const [roleName, selectors] of Object.entries(CONTRACT)) {
  const want = ROLE[roleName];
  for (const sel of selectors) {
    const got = seen.get(sel);
    if (!got) {
      problems.push(
        `${sel} — in the ${roleName} contract but nothing in ui/ sets its type. ` +
          'Renamed? Update the table in tools/text-role-check.mjs AND the grouped ' +
          'selector in ui/panels.css; a selector in one and not the other is the ' +
          'drift starting again.'
      );
      continue;
    }
    if (got.size !== want.size) {
      problems.push(
        `${sel} — role ${roleName} is --${want.size}, resolves to ` +
          `${got.size ? `--${got.size}` : 'no size at all'}. Last set in ${got.where}.`
      );
    }
    if (got.color !== want.color) {
      problems.push(
        `${sel} — role ${roleName} is --${want.color}, resolves to ` +
          `${got.color ? `--${got.color}` : 'no colour at all'}. Last set in ${got.where}.`
      );
    }
  }
}

/* The two heading roles own their case, weight and tracking too — a heading
 * that is the right size and colour but sentence case is not this app's
 * heading, and Settings spent months being exactly that. */
for (const sel of CONTRACT.heading) {
  const got = seen.get(sel);
  if (!got) continue;
  if (got.weight !== '700') problems.push(`${sel} — a section heading is weight 700, got ${got.weight || 'none'}.`);
  if (got.transform !== 'uppercase') problems.push(`${sel} — a section heading is uppercase, got ${got.transform || 'none'}.`);
  if (got.tracking !== '0.06em') problems.push(`${sel} — a section heading tracks 0.06em, got ${got.tracking || 'none'}.`);
}
for (const sel of CONTRACT.sublabel) {
  const got = seen.get(sel);
  if (!got) continue;
  if (got.weight !== '700') problems.push(`${sel} — a sub-label is weight 700, got ${got.weight || 'none'}.`);
  if (got.transform !== 'uppercase') problems.push(`${sel} — a sub-label is uppercase, got ${got.transform || 'none'}.`);
  if (got.tracking !== '0.09em') problems.push(`${sel} — a sub-label tracks 0.09em, got ${got.tracking || 'none'}.`);
}

for (const sel of HEADLINE) {
  const got = seen.get(sel);
  if (!got) {
    problems.push(`${sel} — listed as a headline figure but nothing in ui/ sets its type.`);
    continue;
  }
  if (got.color !== 'text-primary') {
    problems.push(
      `${sel} — a headline figure is --text-primary, resolves to ` +
        `${got.color ? `--${got.color}` : 'no colour at all'}. It is the number the ` +
        'section exists to state; it does not get to be quieter than the prose beside it.'
    );
  }
}

const total =
  Object.values(CONTRACT).reduce((n, a) => n + a.length, 0) + HEADLINE.length;

if (problems.length) {
  console.error(`\n  ${problems.length} selector(s) off their text role:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\n  Six roles, and a piece of text is one of them or it is a bug. The table\n' +
      '  is the grouped selectors at the head of ui/panels.css; this file is the\n' +
      '  guard. Fix the stylesheet, or move the selector to the role it really is.\n'
  );
  process.exit(1);
}

console.log(`✓ ${total} selectors hold their text role — six roles, no eighteenth pairing`);
