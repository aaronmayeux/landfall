#!/usr/bin/env node
/**
 * test-attribution.mjs — is the credits panel still describing THIS app?
 *
 *   node tools/test-attribution.mjs
 *
 * ==> WHY THIS EXISTS. <== `map/attribution.js` is our own control rather than
 * MapLibre's, and the whole reason MapLibre's was dropped is recorded in that
 * file and in SPEC.md. The trade it made is one sentence long: MapLibre derived
 * its credits from the style's sources automatically, and OURS DOES NOT. The
 * credits are a hand-maintained list, and the file's own note calls that "the
 * one way this file can silently go wrong."
 *
 * A note asking the next person to keep a list current is exactly the guard
 * this project has already watched fail — see `tools/drawer-head-harness.html`,
 * whose fixture tokens drifted from the app for two commits under a comment
 * asking them not to. So this makes it mechanical.
 *
 * ==> WHAT IT ACTUALLY CHECKS, AND WHAT IT CANNOT. <== It collects every
 * external host the app can reach — from the exported constants the client
 * fetches through, and from the `https://` literals in the Pages Functions and
 * the cron Worker — and requires each one to appear in `CREDIT_HOSTS`, mapped
 * either to a credit that really is in the panel, or to `null`. It CANNOT tell
 * whether a credit's wording satisfies a licence; a lawyer reads that, not a
 * script. What it kills is the countable mistake: a feed wired up and never
 * credited, or a credit left behind after its feed was deleted.
 *
 * `null` is a DECISION, not a skip. Landing a new host makes this red, and the
 * only way to green is to write down which it is. That moment — someone
 * choosing — is the entire product of this file.
 *
 * FOUR CHECKS
 *   1. Every host reachable from config/constants.js is in CREDIT_HOSTS.
 *   2. Every host named in functions/ and worker/ is in CREDIT_HOSTS.
 *   3. Every non-null CREDIT_HOSTS value is a label that exists in the panel.
 *   4. Every credit in the panel is claimed by at least one host, OR is on the
 *      short list of credits that answer to no hostname (bundled data, and the
 *      basemap's underlying data rather than its server).
 *
 * Exit: 0 clean, 1 on any failure.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

const { CREDIT_HOSTS, CREDIT_LABELS } = await import('../map/attribution.js');

/* ==> CREDITS THAT ANSWER TO NO HOSTNAME, AND WHY EACH ONE DOES NOT. <== Check
 * 4 would otherwise call these orphans and push somebody to delete a credit
 * that is a live licence condition — the worst possible outcome for this file.
 * The list is short on purpose; anything added to it needs a reason of the same
 * kind, which is "the bytes do not arrive over a URL this app names". */
const NO_HOST = Object.freeze({
  /* The basemap's DATA, as distinct from the server that renders it. OSM is
   * upstream of OpenFreeMap and is credited in its own right because the ODbL
   * requires the data to be credited, not merely the tile host. */
  'OpenStreetMap contributors': 'upstream of the tile host, credited by licence',
  /* Shipped in the repo as a static file, not fetched from geonames.org. CC BY
   * 4.0 applies to the bytes wherever they came from. */
  'GeoNames — town populations': 'bundled in the build, no runtime host',
});

/* ------------------------------------------------------------------------ *
 * Collecting the hosts
 * ------------------------------------------------------------------------ */

const hostOf = (s) => {
  const m = /^https?:\/\/([^/'"`\s]+)/.exec(s);
  return m ? m[1] : null;
};

/** Every URL string reachable from the client's exported constants. Walked as
 *  live objects rather than parsed out of the text, so a host assembled into a
 *  frozen object is found and a host mentioned in a comment is not. */
async function hostsFromConstants() {
  const mod = await import('../config/constants.js');
  const found = new Map(); // host -> where
  const seen = new Set();
  const walk = (v, trail) => {
    if (typeof v === 'string') {
      const h = hostOf(v);
      if (h && !found.has(h)) found.set(h, trail);
      return;
    }
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    for (const k of Object.keys(v)) walk(v[k], `${trail}.${k}`);
  };
  for (const k of Object.keys(mod)) walk(mod[k], k);
  return found;
}

/** Every quoted URL in the server-side code.
 *
 *  ==> COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT FUSSINESS. <== These files
 *  cite upstream documentation in prose constantly — every second block comment
 *  has a URL in it — and a check that treats a doc link as a fetched endpoint
 *  reports a licence gap that is not there. A check that cries wolf is a check
 *  people learn to force past. The stripper is rough (it does not understand a
 *  `//` inside a string) but it errs toward keeping code, which is the safe
 *  direction: a false POSITIVE here is a host somebody has to write one line
 *  about, and a false negative is a licence breach. */
function hostsFromServer() {
  const found = new Map();
  const walkDir = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walkDir(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
      for (const m of src.matchAll(/['"`](https?:\/\/[^'"`\s]+)/g)) {
        const h = hostOf(m[1]);
        if (h && !found.has(h)) found.set(h, p);
      }
    }
  };
  for (const d of ['functions', 'worker']) if (fs.existsSync(d)) walkDir(d);
  return found;
}

/* ------------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------------ */

const fromConstants = await hostsFromConstants();
const fromServer = hostsFromServer();

console.log(`\n  ${fromConstants.size} host(s) reachable from config/constants.js`);
console.log(`  ${fromServer.size} host(s) named in functions/ and worker/`);

ok(fromConstants.size > 5, `constants really were walked (${fromConstants.size} hosts)`);
ok(fromServer.size > 5, `the server files really were read (${fromServer.size} hosts)`);

for (const [host, where] of fromConstants) {
  ok(Object.hasOwn(CREDIT_HOSTS, host),
     `${host} (config/constants.js ${where}) is not in CREDIT_HOSTS — ` +
     `decide whether it needs a credit, then say so there`);
}
for (const [host, where] of fromServer) {
  ok(Object.hasOwn(CREDIT_HOSTS, host),
     `${host} (${where}) is not in CREDIT_HOSTS — ` +
     `decide whether it needs a credit, then say so there`);
}

/* A named credit must actually be in the panel. This is the half that catches
 * a credit deleted or reworded while a host still points at its old name. */
for (const [host, label] of Object.entries(CREDIT_HOSTS)) {
  if (label === null) continue;
  ok(CREDIT_LABELS.includes(label),
     `${host} claims the credit "${label}", which is not in the panel`);
}

/* And the other way: a credit nothing points at is a source we stopped using
 * and forgot to stop crediting. Not a licence problem, but it makes the panel
 * a claim about the app that is no longer true. */
const claimed = new Set(Object.values(CREDIT_HOSTS).filter(Boolean));
for (const label of CREDIT_LABELS) {
  ok(claimed.has(label) || Object.hasOwn(NO_HOST, label),
     `the panel credits "${label}" but no host maps to it — either the feed is ` +
     `gone and the credit should go with it, or it belongs in NO_HOST with a reason`);
}

/* ==> THE PREVIEW FIXTURE DRAWS THE SAME GLYPH THE APP DOES. <== The "i" is a
 * hand-drawn path that can only be reviewed by looking at it, and
 * tools/attrib-glyph-preview.html is where a session looks. It duplicates the
 * markup because importing the control would drag in its document listeners
 * and its measurement. A duplicate is fine; a duplicate that drifts is a
 * preview of a different letter. */
{
  const app = fs.readFileSync('map/attribution.js', 'utf8');
  const fixture = fs.readFileSync('tools/attrib-glyph-preview.html', 'utf8');
  const paths = (s) => [...s.matchAll(/<(?:path d|circle cx)="[^"]*"[^>]*\/>/g)].map((m) => m[0].trim());
  const appGlyph = paths(app.slice(app.indexOf('<svg viewBox="0 0 24 24"')));
  const fixGlyph = paths(fixture.slice(fixture.indexOf('<svg viewBox="0 0 24 24"')));
  ok(appGlyph.length === 4, `the glyph is four shapes in the app (got ${appGlyph.length})`);
  ok(appGlyph.join('|') === fixGlyph.join('|'),
     'and the preview fixture draws exactly the same four');
}

/* ------------------------------------------------------------------------ */

console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(
  failures.length
    ? `\n  ${pass} passed, ${failures.length} failed\n`
    : `\n✓ ${pass} assertions passed\n  (whether the WORDING satisfies a licence is a human's call, not this file's)\n`
);
process.exit(failures.length ? 1 : 0);
