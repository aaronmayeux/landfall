/**
 * markup-scan.mjs — the shared reading half of the two gates that compare
 * names in code against names in markup.
 *
 * ==> WHY THIS FILE EXISTS AND IS NOT JUST A SECOND COPY. <== Two checks ask
 * different questions off the same reading:
 *
 *   css-orphan-check.mjs        does the APP look right? A class the app emits
 *                               with no rule renders at the browser's defaults.
 *   selector-contract-check.mjs does the TEST SUITE still test anything? A
 *                               selector a check queries is a contract with the
 *                               markup exactly as a stylesheet rule is.
 *
 * Both need the same directory walk, the same comment stripping, the same
 * "skip anything with `${` in it" rule and the same idea of what the app
 * emits. Two copies of that would drift, and the drift would be silent in
 * exactly the way both gates exist to prevent. §12: a pattern used twice gets
 * extracted before the second use.
 *
 * NOTHING HERE DECIDES ANYTHING. It reads and returns. Every judgement — what
 * is an error, what is exempt and why — lives in the gate that imports it, so
 * that a reader looking for "why is this allowed" finds it in one place.
 */

import fs from 'node:fs';
import path from 'node:path';

/* `mockups/` and `proto/` are skipped ON BOTH SIDES. They are scratch HTML with
 * their own inline styles and no relationship to the shipped app; counting them
 * as either emitters or definitions makes every answer here meaningless. */
export const SKIP = new Set(['vendor', 'node_modules', '.git', 'mockups', 'proto']);

export function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* Block comments, then any line that is only a `//` or a continuation `*`.
 * The second half matters more than it looks: this project documents heavily
 * in comments, and a comment naming a class it used to emit would otherwise
 * count as emitting it — which is how a gate quietly stops finding things. */
/* ==> LINE COUNT IS PRESERVED, DELIBERATELY. <== Comments are blanked, never
 * deleted. A failure message here names a file and a line, and a line number
 * measured against a shortened copy of the file points at the wrong code — in a
 * codebase that comments this heavily, off by eighty lines. Wrong is worse than
 * absent: it sends the reader somewhere confident. */
export const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n');

/* A selector built at runtime is unknowable from here. The whole string is
 * skipped rather than mined for the literal fragments around the hole: a
 * `querySelector('.home-figs-' + cls)` reduced to `.home-figs-` invents a
 * half-name that matches nothing and reports it as missing. */
export const isInterpolated = (s) => /\$\{/.test(s) || /['"`]\s*\+/.test(s);

/**
 * Every class with a rule somewhere: stylesheets, inline <style> in the app's
 * own HTML, and CSS a module builds and injects at runtime.
 *
 * THAT LAST CASE IS NOT AN EDGE CASE — it is how `replay/boot.js` styles its
 * whole bar: `document.createElement('style')` and a template literal into
 * `.textContent`. Reading only literal `<style>` tags reported its five
 * classes as unstyled when they are styled twenty lines below where they are
 * emitted, in the same file.
 */
export function definedClasses(files) {
  const defined = new Map();
  const record = (text, where) => {
    for (const m of stripComments(text).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (!defined.has(m[1])) defined.set(m[1], new Set());
      defined.get(m[1]).add(where);
    }
  };
  for (const f of files) {
    if (f.endsWith('.css')) record(fs.readFileSync(f, 'utf8'), f);
    else if (/\.(html|js)$/.test(f)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) record(m[1], f);
      for (const m of src.matchAll(/\.(?:textContent|innerHTML)\s*=\s*`([\s\S]*?)`/g)) {
        /* Only if it actually looks like a rule block. An arbitrary template
         * assigned to innerHTML is markup, and mining it for `.foo` would let
         * any dotted word in prose count as a definition. */
        if (/\{[^}]*:[^}]*\}/.test(m[1])) record(m[1], f);
      }
    }
  }
  return defined;
}

/* Only what the SHIPPED app emits. `tools/` is harnesses and `functions/` is
 * server-side; both invent markup that no app stylesheet owes anything to. */
export const isAppFile = (f) =>
  /\.(js|mjs|html)$/.test(f) && !f.startsWith('tools/') && !f.startsWith('functions/');

/**
 * Every class the shipped app puts into the DOM, or looks for in it.
 *
 * A class the code LOOKS FOR is a contract too: if `querySelector('.foo')`
 * finds nothing because nothing emits `.foo`, that is the same silence.
 */
export function emittedClasses(files) {
  const used = new Map();
  const add = (c, f) => {
    if (!c) return;
    if (!used.has(c)) used.set(c, new Set());
    used.get(c).add(f);
  };
  for (const f of files) {
    if (!isAppFile(f)) continue;
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    /* A `class="..."` containing `${` is skipped whole: the interpolated part
     * is unknowable here, and guessing at the literal fragments around it
     * invents half-names that match nothing. */
    for (const m of src.matchAll(/class\s*=\s*["']([^"'${}]+)["']/g))
      for (const c of m[1].split(/\s+/)) add(c, f);
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g))
      for (const q of m[1].matchAll(/['"]([\w-]+)['"]/g)) add(q[1], f);
    for (const m of src.matchAll(/className\s*=\s*['"]([^'"]+)['"]/g))
      for (const c of m[1].split(/\s+/)) add(c, f);
    for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]/g))
      for (const q of m[1].matchAll(/\.([\w-]+)/g)) add(q[1], f);
  }
  return used;
}

/**
 * Every id the shipped app puts into the DOM. Same question as a class, and
 * the same silence when it goes wrong: `map/chrome-avoid.js` went on naming
 * `#panel-storms` and `#panel-home` after both panels became one `#drawer`,
 * so the home marker could not see the sheet at all. A dead id selector
 * matches nothing and raises nothing.
 */
export function emittedIds(files) {
  const ids = new Map();
  const add = (c, f) => {
    if (!c) return;
    if (!ids.has(c)) ids.set(c, new Set());
    ids.get(c).add(f);
  };
  for (const f of files) {
    if (!isAppFile(f)) continue;
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\bid\s*=\s*["']([^"'${}\s]+)["']/g)) add(m[1], f);
    for (const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) add(m[1], f);
    for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([\w-]+)['"]/g)) add(m[1], f);
  }
  return ids;
}

/**
 * The names a single file defines FOR ITSELF: markup it writes and CSS it
 * writes. `tools/area-shot.mjs` builds its own preview page with a `.frame`
 * wrapper it styles twenty lines above; `tools/home-figs-check.mjs` builds a
 * fixture out of `.home-figs-*`. Those are the file talking to itself and are
 * not a contract with the app at all.
 *
 * Deliberately loose — a false "this is its own" costs a missed phantom in one
 * file, while a false "this is the app's" costs a wrong failure on a check
 * that is working perfectly.
 */
export function selfDefinedNames(raw) {
  const names = new Set();
  const src = stripComments(raw);
  /* markup the file writes, including escaped quotes inside a JS string */
  for (const m of src.matchAll(/class\s*=\s*\\?["']([^"'`\\${}]+)/g))
    for (const c of m[1].split(/\s+/)) names.add(c);
  for (const m of src.matchAll(/\bid\s*=\s*\\?["']([^"'`\\${}\s]+)/g)) names.add('#' + m[1]);
  /* CSS the file writes: any `.foo {` or `#foo {` rule head */
  for (const m of src.matchAll(/\.(-?[_a-zA-Z][\w-]*)[^\n{;]*\{/g)) names.add(m[1]);
  for (const m of src.matchAll(/#([\w-]+)[^\n{;]*\{/g)) names.add('#' + m[1]);
  return names;
}

/* Every call that takes a CSS selector string. Playwright's page-level helpers
 * are in here alongside the DOM ones because `page.click('.foo')` is exactly
 * as much of a contract with the markup as `querySelector('.foo')` is, and it
 * fails the same way — on a timeout rather than a null, which is slower to
 * read, not better. */
const SELECTOR_CALL =
  /(?:querySelectorAll|querySelector|closest|matches|waitForSelector|locator|\$\$eval|\$eval|\$\$|\$|click|getAttribute|textContent|innerText|isVisible|fill|focus|hover|type|press|inputValue|boundingBox)\s*\(\s*(['"`])([^'"`\n]*)\1/g;

/** Every literal selector string in a source file, with its line number. */
export function selectorLiterals(raw) {
  const src = codeOnly(raw);
  const out = [];
  for (const m of src.matchAll(SELECTOR_CALL)) {
    const sel = m[2];
    /* A selector has to look like one. `click('button')` on a bare tag name is
     * real but names nothing this gate can check; `textContent('hello')` is a
     * string that happens to sit in a matching call. Only strings carrying a
     * `.` or `#` are our business. */
    if (!/[.#]/.test(sel)) continue;
    out.push({ selector: sel, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/* ==> IDS ARE SCANNED EVERYWHERE, CLASSES ONLY INSIDE A QUERY CALL. <== That
 * asymmetry is not laziness, it is the only honest line available.
 *
 * The `#panel-storms` rot did NOT live in a `querySelector()` call. It lived in
 * an exported array of selector strings in `map/chrome-avoid.js`, handed to
 * `querySelectorAll(sel)` a hundred lines later — invisible to any scan that
 * only reads the argument at the call site. So string literals have to be read
 * wherever they sit.
 *
 * For ids that is free: `#drawer` cannot be mistaken for anything else once
 * hex colors are excluded, and a sweep of the whole repo found exactly ONE
 * unmatched id literal, which was a preview tool's own markup.
 *
 * For classes it is impossible. A bare `.foo` literal is indistinguishable
 * from a file extension, and the same sweep produced `.js`, `.css`, `.json`,
 * `.png`, `.git`, `.md`, `.mjs`, `.svg`, `.cgi` and `.pmtiles` as "phantom
 * classes". An exclusion list of extensions is whack-a-mole that goes stale
 * silently — which is the exact failure this whole file exists to prevent — so
 * classes stay inside query calls, where the intent is unambiguous.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Every id-selector string literal in a file, wherever it sits. */
export function idSelectorLiterals(raw) {
  const src = codeOnly(raw);
  const out = [];
  for (const m of src.matchAll(/(['"`])(#[a-zA-Z][\w-]*(?:[^'"`\n]*)?)\1/g)) {
    const sel = m[2];
    if (HEX_COLOR.test(sel)) continue;
    out.push({ selector: sel, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** The class and id names inside one selector string. Ids keep their `#`. */
export function namesIn(selector) {
  const names = [];
  for (const m of selector.matchAll(/([.#])([\w-]+)/g))
    names.push(m[1] === '#' ? '#' + m[2] : m[2]);
  return names;
}

export const readFile = (f) => fs.readFileSync(f, 'utf8');
