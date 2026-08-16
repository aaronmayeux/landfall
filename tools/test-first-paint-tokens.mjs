/**
 * test-first-paint-tokens.mjs — index.html's fallbacks must restate tokens.js.
 *
 * `index.html` carries a `:root` and a `:root[data-theme="light"]` block of CSS
 * custom properties, so a device opening a shared link during a storm gets a
 * correctly-colored app on the FIRST paint rather than after a module load
 * over cell data. Both blocks say so in their own comments: they are a
 * RESTATEMENT of tokens.js, not a second source of truth.
 *
 * ==> AND A RESTATEMENT DRIFTS. THIS HAS HAPPENED TWICE. <==
 *
 * Once by omission — the greyscale pass moved `--space-near` / `--space-far`
 * in tokens.js and left the near-white originals in the fallback, so a cold
 * load in light mode would have flashed the old white backdrop for a frame.
 * Once silently — `--text-muted` in the dark block sat at `#647C93` against
 * tokens' `#7089A5`, origin unknown, caught only because the first fault sent
 * someone looking.
 *
 * Neither is catastrophic: `applyTokens()` overwrites every one of them within
 * a frame of boot. Both are exactly the class of thing that is invisible in
 * review, invisible in testing, and shows up as a flicker on somebody's phone.
 *
 * THE MAPPING IS DERIVED, NEVER RESTATED. `app/theme-switch.js` is the only
 * thing that knows which CSS variable carries which palette key, so this reads
 * its `setProperty` calls rather than keeping a third list — a hand-maintained
 * one here would be the same bug wearing a test's clothes.
 *
 * A variable present in tokens but ABSENT from a fallback block is fine. The
 * fallback is deliberately a subset: only what the first paint needs.
 *
 * Zero dependencies. `node tools/test-first-paint-tokens.mjs`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const { DARK, LIGHT } = await import('../config/tokens.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

/* --- the mapping, read out of applyTokens() -------------------------------- */
const switchSrc = readFileSync(path.join(ROOT, 'app/theme-switch.js'), 'utf8');
const VAR_TO_KEY = new Map(
  [...switchSrc.matchAll(/setProperty\('(--[\w-]+)',\s*P\.(\w+)\)/g)].map((m) => [m[1], m[2]])
);
ok(VAR_TO_KEY.size > 15,
   `only ${VAR_TO_KEY.size} palette variables found in applyTokens() — the parser is stale`);

/* --- the two fallback blocks ----------------------------------------------- */
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function block(selector) {
  const i = html.indexOf(selector);
  if (i === -1) return null;
  return html.slice(i, html.indexOf('\n}', i));
}

for (const [selector, palette, name] of [
  [':root {', DARK, 'dark'],
  [':root[data-theme="light"] {', LIGHT, 'light'],
]) {
  const body = block(selector);
  ok(body !== null, `index.html has no ${name} fallback block (${selector})`);
  if (!body) continue;

  let declared = 0;
  for (const [cssVar, key] of VAR_TO_KEY) {
    const m = body.match(new RegExp(`\\${cssVar}:\\s*([^;]+);`));
    if (!m) continue;               // absent is legal — the fallback is a subset
    declared++;
    const want = String(palette[key]);
    const got = m[1].trim();
    ok(got.toLowerCase() === want.toLowerCase(),
       `index.html ${name} fallback: ${cssVar} is ${got}, tokens.js ${name === 'dark' ? 'DARK' : 'LIGHT'}.${key} ` +
       `is ${want}. The fallback is a restatement — a device sees this value for one frame on a cold load.`);
  }
  ok(declared > 10, `${name} fallback declares only ${declared} palette variables — did the block move?`);
}

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed (${VAR_TO_KEY.size} themed variables)`);
process.exit(failures.length ? 1 : 0);
