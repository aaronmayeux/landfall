#!/usr/bin/env node
/**
 * test-section-targets.mjs — every `data-section="X"` a view queries is a
 * section that view actually renders.
 *
 *   node tools/test-section-targets.mjs
 *
 * ==> WHY THIS EXISTS. <== The drawer's sections each have a repaint function
 * that finds its own body and replaces it, so a late fetch never redraws the
 * whole panel and throws away the reader's scroll position:
 *
 *     bodyEl.querySelector('.detail-section[data-section="ww"] .detail-section-body')
 *
 * If that id stops matching the one passed to `section(id, …)`, `querySelector`
 * returns null, the repaint returns early, and **the fetch lands into
 * nothing**. The section sits on its loading sentence forever.
 *
 * THAT IS THE WORST SHAPE A BUG CAN HAVE. Nothing throws. Nothing warns. The
 * section is present, correctly headed, and shows "Checking national
 * agencies…" — which is indistinguishable from a slow network, so a reader
 * waits instead of reporting it. `check-syntax` cannot see it: both strings are
 * valid. `selector-contract-check` cannot see it either — that file's stated
 * premise is that `tools/` is not the app, so it audits selectors in the CHECKS
 * and not in `ui/`.
 *
 * It nearly shipped on 2026-08-20. "Local agency alerts" merged into
 * "Watches and warnings" (§50.11); the section rendering as `local-alerts`
 * ceased to exist, and `renderCapBody` still queried for it. Every one of the
 * 72 suites passed, because not one of them renders that view.
 *
 * Static, zero-dependency, runs in a bare sandbox. It reads source text rather
 * than rendering, which is the only way to check this without a browser.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
};

/* Every `ui/` module. The pattern is the drawer's, and any future view that
 * adopts it is covered without being named here. */
const files = fs
  .readdirSync(path.join(ROOT, 'ui'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `ui/${f}`);

/**
 * `const NAME = 'value'` anywhere in `ui/`, so an id held in a constant
 * resolves whether it is declared locally or imported from a sibling.
 *
 * ==> COLLECTED ACROSS ALL OF `ui/` AND NOT PER FILE, ON PURPOSE. <== The
 * section ids genuinely live in three places: literals at the call site
 * (`'ww'`, `'vitals'`), local constants (`ADVISORY_SECTION`), and constants
 * exported by the controller that owns the section (`RAIN_SECTION`). Following
 * imports properly would mean parsing modules; this is a lookup table and it
 * is enough, because a name that resolves to two different strings in two
 * files would be a worse problem than the one being checked for.
 */
const constants = new Map();
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g)) {
    constants.set(m[1], m[2]);
  }
}

/** A `section(...)` first argument, or a template hole, resolved to a string. */
function resolveId(raw) {
  const t = raw.trim();
  const lit = t.match(/^'([^']*)'$/);
  if (lit) return lit[1];
  if (constants.has(t)) return constants.get(t);
  return null; // an expression — reported rather than assumed safe
}

console.log('\nsection targets — every queried section is a rendered section\n');

let checkedFiles = 0;
let checkedSelectors = 0;

for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  /* What this file RENDERS: the first argument of every `section(` call.
   * Comments are stripped first so a `section('old-id', …)` quoted inside a
   * note explaining why it was removed does not count as a live render. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const rendered = new Set();
  for (const m of code.matchAll(/\bsection\(\s*([^,]+),/g)) {
    const id = resolveId(m[1]);
    if (id) rendered.add(id);
  }

  /* What this file QUERIES. Both spellings the drawer uses: a plain string and
   * a template literal with the id interpolated from a constant. */
  const queried = new Map(); // id -> the source text it came from
  for (const m of code.matchAll(/data-section=\\?"([^"$\\]+)\\?"/g)) {
    queried.set(m[1], m[0]);
  }
  for (const m of code.matchAll(/data-section=\\?"\$\{([^}]+)\}\\?"/g)) {
    const id = resolveId(m[1]);
    if (id) queried.set(id, m[0]);
  }

  if (!rendered.size && !queried.size) continue;
  checkedFiles++;

  /* A file that queries but renders nothing is not a failure — a controller
   * may be handed its host's body. Only a file doing BOTH can contradict
   * itself, and that is exactly the drawer's shape. */
  if (!rendered.size) continue;

  for (const [id, where] of queried) {
    checkedSelectors++;
    ok(
      rendered.has(id),
      `${rel}: queries data-section="${id}" and renders it` +
        (rendered.has(id)
          ? ''
          : ` — NOT RENDERED. This file renders: ${[...rendered].join(', ')}. ` +
            `The repaint at \`${where}\` will find nothing and return silently.`)
    );
  }
}

ok(checkedSelectors > 0, `found section selectors to check (${checkedSelectors} across ${checkedFiles} files)`);

/* ==> THE SPECIFIC PAIRING THAT BROKE, NAMED. <== The loop above is general
 * and would catch this, but a general check reports "some id somewhere" while
 * this one names the two functions a reader has to go and look at. The CAP
 * fetch is asynchronous and lands into `renderCapBody`; the section it lands
 * in is rendered by `wwHtml` under whatever id `renderBody` gave it. */
const detail = fs.readFileSync(path.join(ROOT, 'ui/view-storm-detail.js'), 'utf8');
const detailCode = detail.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const capRepaint = detailCode.match(/function renderCapBody\(\)[\s\S]*?\n {2}\}/);
ok(!!capRepaint, 'renderCapBody() is still present in ui/view-storm-detail.js');
if (capRepaint) {
  const target = capRepaint[0].match(/data-section=\\?"([^"$\\]+)/);
  ok(!!target, 'renderCapBody() queries a literal data-section');
  if (target) {
    ok(
      new RegExp(`\\bsection\\(\\s*'${target[1]}'`).test(detailCode),
      `renderCapBody() repaints "${target[1]}", which renderBody() renders`
    );
    /* The alerts must land in the SAME section that renders them, and the one
     * that renders them is the one whose body calls `wwHtml()`. */
    ok(
      new RegExp(`\\bsection\\(\\s*'${target[1]}'[^)]*wwHtml\\(\\)`).test(detailCode),
      `"${target[1]}" is the section whose body is wwHtml() — the CAP router`
    );
  }
}

console.log(
  failures === 0
    ? '\nOK — no repaint targets a section that is not rendered\n'
    : `\n${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
