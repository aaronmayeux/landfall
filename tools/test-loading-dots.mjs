#!/usr/bin/env node
/**
 * test-loading-dots.mjs — the waiting dots actually move, everywhere.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-loading-dots.mjs`.
 *
 * ===========================================================================
 * WHAT THIS IS DEFENDING
 * ===========================================================================
 *
 * Every "Checking…" / "Loading…" / "Searching…" in the app used to end in a
 * static `…`. On glass that is indistinguishable from a sentence that has
 * finished and trailed off, so a live fetch and a screen that has quietly
 * stopped looked the same. The fix is three dots that fade in sequence.
 *
 * The regression this is really written against is NOT "someone deletes the
 * CSS". It is someone adding a NEW waiting string in a view file and typing a
 * bare `…`, which looks completely correct in the source and is dead on the
 * phone. Section 3 below is the only assertion here that would have caught
 * that, and it is why this file greps source rather than only calling the
 * helper.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * Whether the pulse READS as thinking rather than as a fault — the rate, the
 * rest opacity, whether three lights on a strip is calmer than one dot
 * sliding. That is glass, on a phone, and it stays Aaron's.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) pass++;
  else failures.push(msg);
};

/* --- 1. the helper itself ------------------------------------------------- */
const { DOTS, dotted } = await import('../ui/loading-dots.js');

ok(/class="dots"/.test(DOTS), 'the markup carries the class the stylesheet targets');
ok((DOTS.match(/<i>/g) || []).length === 3, 'three dots, not two and not four');
ok(/aria-hidden="true"/.test(DOTS), 'and a screen reader is not read three periods');

ok(dotted('Checking…') === 'Checking' + DOTS, 'a trailing ellipsis becomes the animated dots');
ok(dotted('Checking') === 'Checking', 'a sentence without one is left completely alone');
ok(
  dotted('Storm data unavailable') === 'Storm data unavailable',
  'and so is an error message — dots on a dead state would be a lie',
);
ok(
  dotted('Reaching… the feeds') === 'Reaching… the feeds',
  'only a TRAILING ellipsis counts; one mid-sentence is punctuation',
);

/* --- 2. the stylesheet and the one duration ------------------------------- */
const css = read('ui/panels.css');
ok(/@keyframes dots-pulse/.test(css), 'the keyframes exist');
ok(
  /@keyframes dots-pulse[\s\S]{0,400}?opacity/.test(css) &&
    !/@keyframes dots-pulse[\s\S]{0,400}?(width|height|top|left|filter):/.test(css),
  'and animate opacity only — lens 4, this is a globe on a phone',
);
ok(
  /prefers-reduced-motion[\s\S]{0,400}?\.dots > i[\s\S]{0,200}?animation: none/.test(css),
  'reduced motion drops the pulse rather than being ignored',
);

/* THE DURATION IS RESTATED IN TWO PLACES BY DESIGN — the keyframe is CSS and
 * nothing writes the duration tokens from JS. Restated is fine; DRIFTED is
 * not, and drift is invisible on glass because both values are plausible. */
const motion = read('config/motion.js');
const html = read('index.html');
const jsMs = /pulse:\s*(\d+)/.exec(motion)?.[1];
const cssMs = /--duration-pulse:\s*(\d+)ms/.exec(html)?.[1];
ok(jsMs != null, 'DURATION.pulse is declared in the one motion file');
ok(cssMs != null, '--duration-pulse is declared beside the other CSS durations');
ok(jsMs === cssMs, `the two agree (motion.js ${jsMs}, index.html ${cssMs})`);

/* --- 3. no view ships a bare, un-animated ellipsis ------------------------ */
/* Comments talk ABOUT these strings constantly, so lines that are comment
 * continuations or contain no quote at all are skipped. What is left is
 * user-facing copy. */
/* `waitingHtml(` is `ui/seasons-board-markup.js`'s one-line front door onto
 * `dotted()` — the season board hands it a sentence and gets the animated
 * version back. It was added when the board's markup was split out (§57.18b):
 * the view kept the sentences and the markup file kept the import, so the view
 * had ellipses and no helper in sight and this check called it a stray. It was
 * right to. The wrapper counts because it IS the route, not because naming it
 * here makes the warning go away — the day something types a bare `…` and
 * calls nothing, this must still bite. */
const HELPERS = /dotted\(|dotsEl\(|setDottedText\(|waitingHtml\(|DOTS|endsWith\('…'\)/;
const stray = [];

for (const file of readdirSync(join(ROOT, 'ui')).filter((f) => f.endsWith('.js'))) {
  if (file === 'loading-dots.js') continue;
  const src = read(join('ui', file));
  const lines = src.split('\n');
  const usesHelper = HELPERS.test(src);

  lines.forEach((line, i) => {
    if (!line.includes('…')) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    if (!/['"`]/.test(line)) return;
    /* The string is fine IF this file routes its waiting copy through one of
     * the helpers. A file that types `…` and imports nothing is the bug. */
    if (!usesHelper) stray.push(`ui/${file}:${i + 1}`);
  });
}
ok(
  stray.length === 0,
  `every view with waiting copy routes it through loading-dots.js (stray: ${stray.join(', ') || 'none'})`,
);

/* index.html's first-paint pill has no JS to route through, so it must carry
 * the markup literally — and it is the one a cold start stares at longest. */
ok(
  /pill-text[\s\S]{0,120}class="dots"/.test(html),
  'the pill\u2019s first-paint label ships the dots as markup, not as a character',
);
ok(!/pill-text">[^<]*…/.test(html), 'and not as a bare ellipsis alongside it');

/* --- 4. the four call sites that matter most ------------------------------ */
const home = read('ui/view-home.js');
ok(/dotted\(esc\(msg\)\)/.test(home), 'the home drawer\u2019s waiting paragraph is animated');
ok(/dotted\(esc\(word\)\)/.test(home), 'and so is the chip beside the storm name');
ok(/dotted\(esc\(why\)\)/.test(home), 'and the headline sentence under the distance');
ok(
  /dotted\(esc\(sub\)\)/.test(read('ui/view-layers.js')),
  'and the layer rows\u2019 own loading note',
);

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed`
    : `\n✓ ${pass} assertions passed`,
);
console.log('  (whether the pulse READS as thinking is glass)');
process.exit(failures.length ? 1 : 0);
