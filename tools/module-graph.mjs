/**
 * module-graph.mjs — walk the real ES module graph from the page's entry points.
 *
 * WHY THIS IS ITS OWN FILE. Two things need the same answer to "what does the
 * browser actually download, and in what order": `check-syntax.mjs`, which
 * link-checks named imports, and `load-probe.mjs`, which measures the cold-load
 * staircase. Two walkers would drift, and the one that drifts silently is the
 * one that stops catching things.
 *
 * ===> THE WAVE NUMBER IS THE WHOLE POINT. <===
 * A browser cannot know a module exists until it has PARSED the module that
 * imports it. So the graph is not downloaded as a flat list of N files — it is
 * downloaded in waves, and each wave costs a full network round trip no matter
 * how small the files are. Wave 0 is main.js; wave 1 is everything main.js
 * imports; wave 2 is everything THOSE import that was not already seen. On a
 * phone on cell data a round trip is ~100-300ms, so the depth of this graph is
 * a bigger lever than its total size.
 *
 * A module's wave is its SHORTEST path from an entry point, because the browser
 * discovers it the first time any parent names it.
 *
 * THREE IMPORT FORMS, ALL OF WHICH FETCH:
 *   import { a } from './x.js'    named
 *   import './x.js'               bare / side-effect  <-- map/layers/index.js
 *   export { a } from './x.js'    re-export
 * A regex that only knows the first form drops `map/layers/cone.js` and its six
 * siblings on the floor. They are pulled in exclusively by bare imports, so a
 * preload list built from a named-import-only walk would be missing the seven
 * heaviest map layers — the exact files most worth preloading. Verify the
 * verifier; a walker that cannot see how you actually import is not a walker.
 *
 * Relative specifiers only. Bare specifiers would be CDN, and this project has
 * none — everything third-party is vendored as a classic <script> (§17 A3),
 * which is why /vendor/ never appears in this graph.
 */

import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** The module entry points named by <script type="module"> in index.html. */
export const ENTRY_POINTS = ['main.js', 'pwa.js'];

/* One regex, three forms. The leading group makes the `{...}` / `* as x` /
 * default clause optional so a bare `import './x.js'` still matches, and
 * accepts `export` as well as `import` so re-exports are counted. */
const SPECIFIER_RE =
  /(?:^|\n)\s*(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"]+)['"]/g;

/** Every relative specifier a source file fetches, resolved to a repo path. */
export function importsOf(file, src) {
  const out = [];
  for (const m of src.matchAll(SPECIFIER_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    out.push(path.relative(ROOT, path.resolve(path.dirname(file), spec)));
  }
  return out;
}

/**
 * Breadth-first from the entry points. Returns one record per module:
 *   { file, wave, bytes, importedBy }
 * plus the wave count, which is the number of sequential round trips a cold
 * load pays before the last module has even been requested.
 */
export function buildGraph(entries = ENTRY_POINTS) {
  const seen = new Map();
  let frontier = entries.map((e) => path.normalize(e));
  let wave = 0;

  for (const f of frontier) seen.set(f, { file: f, wave: 0, importedBy: [] });

  while (frontier.length) {
    const next = [];
    for (const file of frontier) {
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) continue;
      const src = fs.readFileSync(full, 'utf8');
      seen.get(file).bytes = Buffer.byteLength(src);
      for (const child of importsOf(full, src)) {
        if (seen.has(child)) {
          seen.get(child).importedBy.push(file);
          continue;
        }
        seen.set(child, { file: child, wave: wave + 1, importedBy: [file] });
        next.push(child);
      }
    }
    if (next.length) wave += 1;
    frontier = next;
  }

  const modules = [...seen.values()].sort(
    (a, b) => a.wave - b.wave || a.file.localeCompare(b.file)
  );
  return { modules, waves: wave + 1 };
}

/* Run directly for a readable dump. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { modules, waves } = buildGraph();
  const byWave = new Map();
  let bytes = 0;
  for (const m of modules) {
    if (!byWave.has(m.wave)) byWave.set(m.wave, []);
    byWave.get(m.wave).push(m);
    bytes += m.bytes || 0;
  }
  console.log(`\n${modules.length} modules, ${waves} waves, ${(bytes / 1024).toFixed(0)} KB of our own JS\n`);
  for (const [w, list] of [...byWave].sort((a, b) => a[0] - b[0])) {
    const kb = (list.reduce((n, m) => n + (m.bytes || 0), 0) / 1024).toFixed(0);
    console.log(`  wave ${w}: ${String(list.length).padStart(3)} modules  ${kb.padStart(4)} KB`);
    if (w >= waves - 2) for (const m of list) console.log(`            ${m.file}  <- ${m.importedBy[0]}`);
  }
  console.log('');
}
