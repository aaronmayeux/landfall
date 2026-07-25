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
 * IT NOW ALSO RESOLVES NAMED IMPORTS (a second blank-screen outage,
 * 2026-07-24). `map/markers.js` imported `GLOBE3D` from config/constants.js.
 * There is no such export — the name is `GLOBE`. Every module still PARSED
 * cleanly, this checker printed its tick, and the app died at module LINK time
 * with "does not provide an export named 'GLOBE3D'". Blank page, green check.
 *
 * Parsing is per-file; linking is between files. A per-file checker cannot see
 * a name that does not exist somewhere else, so it has to be taught to look.
 * Same lesson as the first outage, one level up: verify the verifier, and a
 * check that cannot fail the way you actually break things is not a check.
 *
 * Run: node tools/check-syntax.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools']);
const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * ===> `_`-PREFIXED FILES UNDER functions/ ARE SHIPPED CODE. <===
 * TWO CONVENTIONS COLLIDED HERE AND THE CHECKER LOST (found 2026-07-25, while
 * §17 Pass B was being built). In this project a leading `_` has always meant
 * "scratch, not shipped". In Cloudflare Pages Functions it means something
 * completely different: "this file is NOT A ROUTE" — a shared module the real
 * routes import. So `functions/api/_inspect-guard.js`, which gates all four
 * inspect endpoints, and `functions/api/_kv-cache.js`, which every relay route
 * now imports, were the two most-depended-on files under functions/ and the
 * only two this checker never opened.
 *
 * It was worse than a gap in the parse pass. The LINK pass below does
 * `if (!known) continue` for any target it did not collect — so every named
 * import FROM those files was skipped silently too. A typo'd import of
 * `kvRead` would have printed a green tick and blanked the relay.
 *
 * That is precisely the failure this whole file was written about, one level
 * further out: a check that cannot fail the way you actually break things is
 * not a check. Verify the verifier, then verify what the verifier skips.
 */
const isSharedFunctionModule = (full) =>
  path.relative(ROOT, full).split(path.sep)[0] === 'functions';

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    /* Scratch/test files are prefixed with `_` and are not shipped — EXCEPT
     * under functions/, where `_` is Cloudflare's not-a-route marker. */
    if (entry.name.startsWith('_') && !isSharedFunctionModule(full)) continue;
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

/* ---------------------------------------------------------------------------
 * LINK CHECK — does every named import actually exist at the other end?
 * ------------------------------------------------------------------------- */

const EXPORT_RE = /^export\s+(?:async\s+)?(?:const|function|class|let|var)\s+(\w+)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}/gms;
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs;

/** Every name a file exports. Handles `export const x`, `export async function
 *  y`, and `export { a, b as c }` — the last one matters because this project
 *  uses it for test seams (`export { normalizeEvent as _normalizeGdacsEvent }`). */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(EXPORT_RE)) names.add(m[1]);
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const exportMap = new Map([...sources].map(([f, src]) => [f, exportsOf(src)]));
const linkErrors = [];

for (const [file, src] of sources) {
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[2];
    /* Only relative imports are ours to check; bare specifiers are CDN. */
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), spec);
    const known = exportMap.get(target);
    if (!known) continue; // not a file we scan (e.g. an asset)
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && !known.has(name)) {
        linkErrors.push({
          file: path.relative(ROOT, file),
          name,
          from: path.relative(ROOT, target),
        });
      }
    }
  }
}

if (linkErrors.length) {
  console.error(`\n${linkErrors.length} broken named import(s) — these blank the page:\n`);
  for (const e of linkErrors) {
    console.error(`  ${e.file}`);
    console.error(`    imports '${e.name}' — ${e.from} does not export it\n`);
  }
  process.exit(1);
}

if (failures.length) {
  console.error(`\n${failures.length} file(s) failed to parse as ES modules:\n`);
  for (const f of failures) {
    console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}

console.log(`✓ all ${files.length} modules parse and every named import resolves`);
