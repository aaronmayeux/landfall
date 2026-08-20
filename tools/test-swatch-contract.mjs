#!/usr/bin/env node
/**
 * test-swatch-contract.mjs — a glowing dot takes its colour as a custom
 * property, never as an inline `background`.
 *
 *   node tools/test-swatch-contract.mjs
 *
 * ==> WHY THIS EXISTS, AND WHY IT HAD TO BE A GATE RATHER THAN A LOOK. <==
 * `.row-swatch` and `.drawer-identity-dot` both compose their glow from the
 * colour they are handed:
 *
 *     box-shadow: 0 0 var(--dot-glow-blur) var(--swatch);
 *
 * A caller that passes the colour as a plain `style="background:#abc"` sets the
 * fill and leaves `--swatch` undefined. CSS then discards the WHOLE
 * `box-shadow` declaration as invalid — silently, by design — and the dot
 * renders as a flat disc on a panel where every other dot is a light (§6).
 *
 * THAT IS THE WORST SHAPE A BUG CAN HAVE HERE. It does not throw, it does not
 * warn, the element is present, the colour is right, and the only symptom is an
 * absence you have to already know to look for. It shipped once in the drawer
 * header (found on glass, 2026-08-12), and the identical construction then sat
 * in two more callers in `ui/view-storm-detail.js` for a week because nothing
 * could see it. `tools/test-css-vars.mjs` cannot: an inline `background` is
 * perfectly valid CSS referencing no variable at all, so there is no undeclared
 * name for it to catch. The bug is the ABSENCE of a name.
 *
 * So the rule is stated positively and checked statically: if an element in app
 * code carries one of the glow classes, its inline style hands over a custom
 * property. Static, zero-dependency, and it runs in a bare sandbox.
 */

import fs from 'node:fs';
import path from 'node:path';

/* The classes whose stylesheet rule composes a glow from a custom property.
 * Adding a fourth glowing dot means adding it here — that is the point. */
const GLOW_CLASSES = ['row-swatch', 'drawer-identity-dot'];

/* `tools/` is not the app. Fixtures build their own throwaway markup and are
 * not bound by the app's visual contract. */
const CODE_DIRS = ['ui', 'map', 'data', 'lib', 'app'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && p.endsWith('.js') ? [p] : [];
  });
}

/* Every `class="..."` and the `style="..."` that follows it on the same tag.
 * Templates here are single-line span emissions, so a tag-shaped match is
 * enough; anything it cannot parse is reported rather than skipped. */
const TAG = /<span\b([^>]*)>/g;

const failures = [];

for (const file of CODE_DIRS.flatMap(walk)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    for (const m of line.matchAll(TAG)) {
      const attrs = m[1];
      const cls = /class\s*=\s*["'`]([^"'`]*)/.exec(attrs)?.[1] ?? '';
      const hit = GLOW_CLASSES.find((c) => cls.split(/\s+/).includes(c));
      if (!hit) continue;

      const style = /style\s*=\s*["'`]([^"'`]*)/.exec(attrs)?.[1] ?? '';

      /* No inline style at all is fine — `setProperty` elsewhere is a real and
       * used path (`ui/view-storms.js` does exactly that on re-render). */
      if (!style.trim()) continue;

      const setsCustomProp = /--[a-zA-Z0-9-]+\s*:/.test(style);
      const setsBackground = /(^|;)\s*background(-color)?\s*:/.test(style);

      if (setsBackground && !setsCustomProp) {
        failures.push(
          `${file}:${i + 1} — .${hit} is handed its colour as an inline ` +
            `\`background\`, so its glow's var() resolves to nothing and the ` +
            `whole box-shadow computes to none. Pass \`--swatch\` (or ` +
            `\`--dot-ink\`) instead.\n      ${line.trim().slice(0, 150)}`
        );
      }
    }
  });
}

if (failures.length) {
  console.error(`\ntest-swatch-contract: ${failures.length} flat dot(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}

console.log('test-swatch-contract: ok — every glow class is handed a custom property');
