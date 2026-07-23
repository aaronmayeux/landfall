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
 * ZERO DEPENDENCIES ON PURPOSE. The first version of this file used acorn, and
 * that made it useless the moment node_modules was cleaned — a guard that only
 * runs on the machine that happens to have a package installed is not a guard.
 * This project has no toolchain by design (§12), so the checker has none
 * either. It copies each file to a temporary `.mjs` path and runs Node's own
 * `--check`, which parses in MODULE mode for that extension.
 *
 * Run: node tools/check-syntax.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

/* The whole trick: Node decides script-vs-module from the EXTENSION, so the
 * same bytes under a `.mjs` name get parsed as a module and the duplicate
 * declaration surfaces. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landfall-syntax-'));

try {
  for (const file of files) {
    const probe = path.join(tmpDir, 'probe.mjs');
    fs.copyFileSync(file, probe);
    try {
      execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' });
    } catch (err) {
      const text = String(err.stderr || err.stdout || err.message);
      const msg =
        text.split('\n').find((l) => /Error:/.test(l))?.trim() || text.trim();
      const line = text.match(/probe\.mjs:(\d+)/)?.[1];
      failures.push({
        file: path.relative(ROOT, file),
        message: msg,
        line: line ? Number(line) : undefined,
      });
    }
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
