/**
 * tools/doc-check.mjs — does the documentation still describe THIS code?
 *
 * ==> WHY THIS EXISTS. <== Every spec file in this repo claims to describe the
 * app as it is right now. That is a promise no tired session keeps by hand. A
 * full audit on 2026-08-11 found the §12 ceiling table wrong on every row, a
 * routes table listing 7 of 24 routes, a file inventory missing 22 files, two
 * module counts off by 22 and 14, and — the expensive one — a spec paragraph
 * naming a function that had been DELETED, presented as as-built.
 *
 * Every one of those is mechanically detectable. So detect it, on every push,
 * instead of rediscovering it in six months.
 *
 * ==> WHAT IT CANNOT DO, STATED SO NOBODY OVER-TRUSTS A GREEN RUN. <== It
 * checks that the NAMES and NUMBERS in the docs correspond to something real.
 * It cannot check that a sentence is true. A paragraph can name a function that
 * exists and still describe behaviour the function does not have. Prose is
 * still read by a human; this only kills the mistakes that are countable.
 *
 * FIVE CHECKS
 *   1. Every file path named in a doc exists on disk.
 *   2. Every code identifier named in a doc exists somewhere in the source.
 *   3. Every §N cited by a doc OR by a code comment resolves in SPEC-INDEX.md.
 *   4. Every line count asserted in SPEC.md §12's ceiling table matches wc -l.
 *   5. Every file over the §12 ceiling appears in that table.
 *
 * Run: node tools/doc-check.mjs        (non-zero exit on any failure)
 *      node tools/doc-check.mjs --list (also print what it checked)
 */

import fs from 'fs';
import path from 'path';

const VERBOSE = process.argv.includes('--list');

const DOCS = [
  'NOW.md', 'README.md', 'CLAUDE.md',
  'SPEC.md', 'SPEC-DATA.md', 'SPEC-MAP.md', 'SPEC-UI.md', 'SPEC-OPS.md',
  'SPEC-NEXT.md', 'SPEC-HOME-PLAN.md', 'SPEC-FLOOD-PLAN.md', 'spec-parameter.md',
];

const SRC_DIRS = [
  'app', 'config', 'data', 'lib', 'map', 'ui',
  'functions', 'worker', 'replay', 'surge', 'tools', 'mockups',
];

const ROOT_FILES = ['main.js', 'index.html', 'sw.js', 'pwa.js', '_headers', 'manifest.webmanifest'];

let failures = 0;
const fail = (check, msg) => { failures++; console.log(`  FAIL  [${check}] ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

/* ------------------------------------------------------------------ sources */

const sourceFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs|json|html|css|sh|toml|webmanifest)$/.test(e.name)) sourceFiles.push(p);
  }
};
for (const d of SRC_DIRS) if (fs.existsSync(d)) walk(d);
for (const f of ROOT_FILES) if (fs.existsSync(f)) sourceFiles.push(f);

/* One haystack of every byte of source we ship or test with. Checking
 * "does this name appear anywhere" rather than "is it exported from that exact
 * file" is deliberate: the stricter test produces false alarms on every helper
 * that moved file, and the whole value here is that a red run means something. */
let HAY = '';
for (const f of sourceFiles) {
  try { HAY += fs.readFileSync(f, 'utf8') + '\n'; } catch { /* unreadable, skip */ }
}

/* THE VENDORED LIBRARIES COUNT AS SOURCE FOR THIS CHECK. The spec legitimately
 * names MapLibre and Three internals — `_checkLoaded`, `promoteId`,
 * `texImage2D` — usually to record a trap that cost a day. Those are real
 * names in code we ship; flagging them would train the reader to skim the
 * output, which is the only way this tool actually fails. */
for (const v of fs.readdirSync('vendor')) {
  if (v.endsWith('.js')) HAY += fs.readFileSync(path.join('vendor', v), 'utf8') + '\n';
}

/* --------------------------------------------- 1. file paths named in docs */

/* Upstream URLs and third-party filenames are not ours to have on disk. Each
 * entry here is a thing a doc legitimately names that this repo does not
 * contain — keep it short, and never add one to silence a real miss. */
const NOT_OURS = new Set([
  'CurrentStorms.json',              // NHC's file, at NOAA
  'www.nhc.noaa.gov/CurrentStorms.json',
  'geometry.py',                     // a Census/GIS script referenced by name only
  'ww_wwlin.geojson',                // an NHC GIS layer's own filename
  'package.json',                    // deliberately absent at the repo root (no build step)
  'wrangler.toml',                   // exists at worker/, referenced bare in prose
]);

/* A doc may point at a file preserved on another branch. That is not drift —
 * it is the archive doing its job — but it MUST say where. */
/* ==> A DOC LINE THAT SAYS SOMETHING IS GONE IS NOT CLAIMING IT EXISTS. <==
 * The spec's job includes recording what was removed and why, so that nobody
 * re-adds it. Flagging "`VOLCANO` was deleted outright" as drift would punish
 * exactly the writing this project wants and teach the reader to skim the
 * output. Same for a pointer at a preserved branch, or a name a doc PROPOSES
 * for a file that does not exist yet. */
const documentsAnAbsence = (line) => /worlds-v1|worlds` branch|`archive`|git show|deleted|removed|retired|no longer exist|was cut|were cut|if it is ever taken|does not exist/i.test(line);
const branchPointer = documentsAnAbsence;

const byBasename = new Set(sourceFiles.map((f) => path.basename(f)));
for (const v of fs.readdirSync('vendor')) byBasename.add(v);
for (const f of fs.readdirSync('.')) if (/\.md$/.test(f)) byBasename.add(f);

/* ==> SAMPLES ARE NAMED BY NAME AND THE GATE COULD NOT SEE THEM. <== `samples`
 * is deliberately absent from `SRC_DIRS`, and rightly: those files are captured
 * bytes rather than source, and folding them into `HAY` would let a fixture
 * that happens to contain a word vouch for a symbol the code no longer exports
 * — the gate would go quiet on exactly the drift it exists to catch.
 *
 * But the spec cites fixtures constantly and BY PATH, because a suite is only
 * checkable if a reader can find what it runs against. Before this, every one
 * of those citations was invisible to the check: a renamed or deleted fixture
 * left a dead reference in the spec and nothing went red. So the names go into
 * `byBasename` ONLY, which answers "does this file exist" and feeds nothing
 * else. Found while adding §56.14's captures, which failed here while sitting
 * on disk. */
const walkNames = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkNames(p);
    else byBasename.add(e.name);
  }
};
if (fs.existsSync('samples')) walkNames('samples');

const pathRe = /`([A-Za-z0-9_./\-[\]]+\.(?:js|mjs|json|html|md|css|sh|toml|webmanifest|py|geojson))`/g;

/* A sentence spans lines. "was deleted with the three-globe cut" can sit one
 * line below the filename it is about, so judge the neighbourhood, not the
 * line — a paragraph is the unit a human reads. */
const nearby = (lines, i) => lines.slice(Math.max(0, i - 2), i + 3).join(' ');

for (const doc of DOCS) {
  const lines = fs.readFileSync(doc, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (documentsAnAbsence(nearby(lines, i))) return;
    for (const m of line.matchAll(pathRe)) {
      const p = m[1];
      if (NOT_OURS.has(p)) continue;
      if (branchPointer(line)) continue;
      /* Prose names a file the short way — `style.js`, not `map/style.js` —
       * and that is good writing, not drift. Resolve by basename anywhere in
       * the tree, and by suffix so `layers/cone.js` finds
       * `map/layers/cone.js`. What this still catches is the thing that
       * matters: a name that matches NOTHING, which means the file was
       * deleted or renamed and the doc was never told. */
      if (fs.existsSync(p)) continue;
      if (byBasename.has(path.basename(p))) continue;
      if (sourceFiles.some((f) => f.endsWith('/' + p))) continue;
      fail('path', `${doc}:${i + 1} names \`${p}\`, which is not on disk`);
    }
  });
}

/* ------------------------------------------ 2. identifiers named in docs */

/* spec-parameter.md §27–§37 is a FIELD REFERENCE for what NHC and GDACS
 * publish. Those names are upstream's, not ours, and must not be checked
 * against our source. */
const UPSTREAM_FIELD_DOCS = new Set(['spec-parameter.md']);

/* SPEC-DATA.md also describes upstream JSON in places — these are ArcGIS's and
 * GDACS's own field names, documented so a reader knows what the wire carries.
 * They are not ours and never will be in our source. Keep this list short;
 * a name only belongs here if the upstream service publishes it. */
const UPSTREAM_FIELDS = new Set(['fullExtent', 'editingInfo', 'timeInfo', 'promoteId',
  /* NWS gridpoint field, named in §48.7 only to say how big it is and that we
   * throw it away. The fields we DO read appear in tools/rain-probe.mjs and so
   * resolve normally; this one is here precisely because we never touch it. */
  'relativeHumidity']);

const idRe = /`([A-Za-z_$][A-Za-z0-9_$]{3,})(\(\))?`/g;

for (const doc of DOCS) {
  if (UPSTREAM_FIELD_DOCS.has(doc)) continue;
  const lines = fs.readFileSync(doc, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (branchPointer(line)) return;
    for (const m of line.matchAll(idRe)) {
      const id = m[1];
      const calledAsFn = Boolean(m[2]);
      const camel = /^[a-z][a-z0-9]*[A-Z]/.test(id);
      const konst = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(id);
      /* Only things that unambiguously look like OUR code. A bare lowercase
       * word in backticks is prose emphasis far more often than a symbol. */
      if (!calledAsFn && !camel && !konst) continue;
      if (HAY.includes(id)) continue;
      if (UPSTREAM_FIELDS.has(id)) continue;
      fail('identifier', `${doc}:${i + 1} names \`${id}\`, which is nowhere in the source`);
    }
  });
}

/* ------------------------------------------------ 3. section addresses */

const index = fs.readFileSync('SPEC-INDEX.md', 'utf8');
const known = new Set([...index.matchAll(/^\| `([0-9]+(?:\.[0-9]+)*)`/gm)].map((m) => m[1]));

/* Retired ranges keep their numbers forever — §-numbers are permanent
 * addresses (SPEC.md), so a stub with no heading is still a valid target.
 * Parsed out of SPEC.md's own table so this list can never disagree with it. */
const retired = new Set();
for (const m of fs.readFileSync('SPEC.md', 'utf8').matchAll(/^\| (\d+)(?:[–-](\d+))? \| \*retired\*/gm)) {
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  for (let n = from; n <= to; n++) retired.add(String(n));
}
/* §37 IS A NUMBERED LIST WHOSE ITEMS ARE ADDRESSES. Code cites `§37.5` meaning
 * item 5 — see spec-parameter.md §37's own header. The index only knows about
 * headings, so resolve these against the real length of the list. Any other
 * section's `.N` still has to be a real heading. */
const param = fs.readFileSync('spec-parameter.md', 'utf8');
const sec37 = param.slice(param.indexOf('## 37.'));
const listItems = [...sec37.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
const maxItem37 = listItems.length ? Math.max(...listItems) : 0;

const resolves = (s) => {
  if (known.has(s) || retired.has(s) || retired.has(s.split('.')[0])) return true;
  const [sec, item] = s.split('.');
  if (sec === '37' && item && Number(item) >= 1 && Number(item) <= maxItem37) return true;
  return false;
};

for (const doc of DOCS) {
  const lines = fs.readFileSync(doc, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/§\s*([0-9]+(?:\.[0-9]+)*)/g)) {
      if (resolves(m[1])) continue;
      fail('section', `${doc}:${i + 1} cites §${m[1]}, which is not in SPEC-INDEX.md`);
    }
  });
}

for (const f of sourceFiles) {
  if (f.startsWith('mockups/')) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/§\s*([0-9]+(?:\.[0-9]+)*)/g)) {
      if (resolves(m[1])) continue;
      fail('section', `${f}:${i + 1} cites §${m[1]}, which is not in SPEC-INDEX.md`);
    }
  });
}

/* ------------------------------------- 4 & 5. the §12 ceiling inventory */

/* The ceiling is a rule with a table under it, and a stale table is worse than
 * no table: it says a file was looked at and judged when it was not. */
const CEILING = 700;
const spec = fs.readFileSync('SPEC.md', 'utf8');
/* Find the table itself, not "whatever follows the heading" — prose gets added
 * between the two and an adjacency match then silently finds nothing, which
 * reads as "table is fine" and is the exact failure this file exists to stop. */
const tableMatch = spec
  .slice(spec.indexOf('### Ceiling inventory'))
  .match(/(\n\| `[\s\S]*?)\n\n/);

const countable = [];
const walkCount = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkCount(p);
    else if (/\.(js|css)$/.test(e.name)) countable.push(p);
  }
};
for (const d of ['app', 'config', 'data', 'lib', 'map', 'ui', 'functions', 'worker', 'replay', 'surge']) {
  if (fs.existsSync(d)) walkCount(d);
}
countable.push('main.js');

const lineCount = (f) => fs.readFileSync(f, 'utf8').split('\n').length - 1;
const over = countable.filter((f) => lineCount(f) > CEILING).sort((a, b) => lineCount(b) - lineCount(a));

if (!tableMatch) {
  fail('ceiling', 'SPEC.md has no "### Ceiling inventory" table to check');
} else {
  const rows = new Map();
  for (const m of tableMatch[1].matchAll(/^\| `([^`]+)` \| ([0-9,]+) \|/gm)) {
    rows.set(m[1], Number(m[2].replace(/,/g, '')));
  }

  /* ==> A TOLERANCE, AND WHY IT IS NOT SLOPPINESS. <== An exact match goes red
   * when somebody adds two lines of comment, and a check that cries wolf on
   * every edit gets bypassed with --no-verify, which is worse than no check.
   * 5% is wide enough to absorb ordinary editing and far too narrow to hide
   * what actually went wrong here: main.js recorded at 896 while sitting at
   * 1,142 is 27% out, and tokens.js at 892 against 1,910 is 114%. */
  const TOLERANCE = 0.05;

  for (const [file, claimed] of rows) {
    if (!fs.existsSync(file)) { fail('ceiling', `§12 table lists \`${file}\`, which is not on disk`); continue; }
    const real = lineCount(file);
    const drift = Math.abs(real - claimed) / real;
    if (drift > TOLERANCE) {
      fail('ceiling', `§12 table says \`${file}\` is ~${claimed} lines; it is ${real} (${Math.round(drift * 100)}% out)`);
    }
  }

  for (const f of over) {
    if (!rows.has(f)) {
      fail('ceiling', `\`${f}\` is ${lineCount(f)} lines, over the ${CEILING} ceiling, and is not in the §12 table`);
    }
  }

  if (VERBOSE) {
    console.log(`\n  files over the ${CEILING}-line ceiling:`);
    for (const f of over) console.log(`    ${String(lineCount(f)).padStart(5)}  ${f}`);
    console.log('');
  }
}

/* ----------------------------------------------------------------- verdict */

console.log('');
if (failures === 0) {
  ok(`documentation matches the code — ${DOCS.length} docs, ${sourceFiles.length} source files checked`);
  process.exit(0);
}
console.log(`\n${failures} documentation mismatch${failures === 1 ? '' : 'es'}.`);
console.log('The spec describes the app as it IS. Fix the doc, or fix the code, then push.');
process.exit(1);
