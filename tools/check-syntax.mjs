#!/usr/bin/env node
/**
 * check-syntax.mjs — parse every source file AS AN ES MODULE.
 *
 * WHY THIS EXISTS (a real outage, 2026-07-23):
 * A duplicate `let px` inside one function shipped to production and took the
 * whole app to a blank screen — a SyntaxError means the module never parses, so
 * nothing runs at all. Not one button rendered.
 *
 * It shipped because the pre-push check was `node --check file.js`, and that is
 * SILENTLY USELESS on an ES module. `--check` on a `.js` path parses in SCRIPT
 * mode; the first `import` statement is invalid in a script, so the parse bails
 * there and never reaches the rest of the file. Exit code 0. Every module in
 * this project was being "checked" that way and none of them were.
 *
 *   node --check map/marker-home.js   -> exit 0  (never saw the bug)
 *   node --check map/marker-home.mjs  -> SyntaxError: 'px' has already been declared
 *
 * The lesson generalises past this one bug: a check that cannot fail is worse
 * than no check, because it buys false confidence. Verify the verifier.
 *
 * Run: node tools/check-syntax.mjs
 */

import { parse } from 'acorn';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools']);
const ROOT = path.resolve(import.meta.dirname, '..');

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    /* Scratch/test files are prefixed with `_` and are not shipped. */
    if (entry.name.startsWith('_')) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collect(ROOT);
const failures = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });
  } catch (err) {
    failures.push({
      file: path.relative(ROOT, file),
      message: err.message,
      line: err.loc?.line,
    });
  }
}

if (failures.length) {
  console.error(`\n${failures.length} file(s) failed to parse as ES modules:\n`);
  for (const f of failures) {
    console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}

console.log(`✓ all ${files.length} modules parse cleanly`);
