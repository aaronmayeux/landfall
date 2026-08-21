/**
 * relay-archive-check.mjs — every relay route the app calls is in the archive,
 * or is named here with a reason why it cannot be.
 *
 * ===========================================================================
 * WHY THIS GATE EXISTS
 * ===========================================================================
 *
 * On 2026-08-21 a storm lost its Saffir-Simpson grading on two devices and kept
 * it on a third. The whole investigation reduced to one question — what did the
 * app actually receive from `/api/jtwc/storms` — and the archive could not
 * answer it. It held JTWC's raw warning products, which proved the upstream was
 * healthy and the parser was correct, and then the trail stopped at the single
 * hop in between.
 *
 * ==> THE APP NEVER READS AN UPSTREAM URL. IT READS OUR RELAY. <==
 * An upstream copy proves what NOAA or the Navy published. It says nothing
 * about what a phone was handed, and what a phone was handed is the only thing
 * a bug report is ever about.
 *
 * At the moment this was written the app called 21 relay routes and the archive
 * captured 7. Nobody decided that. Relay copies had been added one at a time,
 * whenever a specific investigation happened to need one, so the archive
 * covered the routes we had already debugged and not the ones we had not — the
 * exact inversion of what an archive is for.
 *
 * ===========================================================================
 * WHY A TEST AND NOT A NOTE IN THE SPEC
 * ===========================================================================
 *
 * A comments-only rule always fails. The way this drifted the first time is
 * precisely how it would drift again: somebody adds a route, ships the feature,
 * and three months later a session burns an hour proving something the archive
 * should have answered in thirty seconds. The only thing that holds is a check
 * that breaks the push.
 *
 * ===========================================================================
 * WHAT IT DOES
 * ===========================================================================
 *
 * 1. Scans the app for `${ENDPOINT.relay}/...` template literals and reduces
 *    each to a route path — the part before any `?`, with `${...}` segments
 *    collapsed to `*`.
 * 2. Reads tools/archive-fetch.mjs and collects every relay URL it fetches,
 *    static or derived, reduced the same way.
 * 3. Every route in (1) must appear in (2) or in EXCUSED below.
 *
 * ==> AN EXCUSE IS A LINE OF PROSE, NOT A FLAG. <== Each entry states why the
 * route cannot be archived on a fixed schedule. The honest reason is almost
 * always the same one — the URL needs a live storm to address — and the point
 * of writing it out per route is that "needs a parameter" stops being an
 * excuse the moment somebody works out how to derive it, and then the entry
 * reads as a to-do instead of a decision.
 *
 * Zero dependencies. Plain node. Exit 1 on any unarchived route.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FETCHER = 'tools/archive-fetch.mjs';

/* Where app code lives. `functions/` is excluded on purpose: a Pages Function
 * calling another route is a server-side hop, not something a device does. */
const APP_DIRS = ['data', 'lib', 'map', 'ui', 'app', 'config'];
const APP_FILES = ['main.js'];

/* ---------------------------------------------------------------------------
 * THE EXCUSED
 *
 * A route belongs here ONLY when a fixed hourly URL for it does not exist.
 * Every entry names what is missing, so a future session can tell a genuine
 * blocker from an unfinished job.
 * ------------------------------------------------------------------------- */
const EXCUSED = new Map([
  [
    '/gdacs/geometry',
    'Addressed by an upstream GDACS polygon URL that changes per storm and per ' +
      'episode. The archive derives and fetches those URLs directly in phase ' +
      'two and writes them under latest/geometry/, so the BYTES are captured — ' +
      'what is missing is the relay\'s own headers on them. Derivable; not done.',
  ],
  [
    '/gdacs/surge',
    'Needs a GDACS eventid. Derivable from the event list in phase two, the ' +
      'same way the geometry URLs already are. Not done.',
  ],
  [
    '/nhc/advisory',
    'Needs an advisory bin that only exists while a storm is running. Phase ' +
      'two already derives per-storm NHC URLs and could derive this one.',
  ],
  [
    '/nhc/ships',
    'Needs a storm id. The upstream SHIPS files ARE archived per storm in ' +
      'phase two; the relay copy is not.',
  ],
  [
    '/nhc/adeck',
    'Needs a storm id. Same shape as the SHIPS case above.',
  ],
  [
    '/nhc/mapserver',
    'A generic proxy addressed by an arbitrary query string. The specific ' +
      'layers the app asks for ARE archived per storm in phase two under ' +
      'latest/geometry/nhc-*.',
  ],
  [
    '/jtwc/warning',
    'Needs a product key from the JTWC index. The upstream products are ' +
      'archived per storm; the relay copy is not. Derivable from ' +
      'relay-jtwc-storms.json now that it exists.',
  ],
  [
    '/tcgp/adeck',
    'Needs a storm id from the TCGP roster. Derivable from ' +
      'relay-tcgp-storms.json now that it exists.',
  ],
  [
    '/cap/shapes',
    'Needs alert ids from the CAP feed. The equivalent upstream query IS ' +
      'archived as latest/geometry/capalerts-cyclone-shapes.geojson.',
  ],
  [
    '/rain/global',
    'Needs a lat/lon. Archived against a fixed probe point instead, as ' +
      'openmeteo-rain-outside-nws.json.',
  ],
  [
    '/nws/rainfall',
    'Needs a lat/lon. Same as the global rainfall route above.',
  ],
  [
    '/geocode',
    'Needs a search string. Nothing about a geocoder answer decays in a way ' +
      'an hourly snapshot would capture.',
  ],
  [
    '/reverse',
    'Needs a lat/lon. Same as the forward geocoder above.',
  ],
  /* ==> NOT DATA SOURCES. <== These answer questions rather than feeding a
   * layer, and archiving a diagnostic's output hourly would fill the window
   * with copies of answers nobody asked for. Listed individually anyway, so
   * adding a real route and forgetting to archive it cannot hide behind a
   * blanket "inspect routes are fine" rule that a future file might match by
   * accident. */
  ['/gdacs/inspect', 'A read-only probe into GDACS. Diagnostic, not a data source.'],
  ['/jtwc/inspect', 'A read-only probe into JTWC. Diagnostic, not a data source.'],
  ['/nhc/inspect', 'A read-only probe into NHC. Diagnostic, not a data source.'],
  ['/tcgp/inspect', 'A read-only probe into TCGP. Diagnostic, not a data source.'],
  [
    '/imagery/inspect',
    'A read-only probe into the imagery providers. Diagnostic, and the imagery ' +
      'routes it probes are themselves excused below.',
  ],
  [
    '/beacon',
    'THE TELEMETRY SINK, and it runs the other way: the app POSTs to it, ' +
      'nothing is fetched from it. What it collects IS archived, hourly, out ' +
      'of D1 under telemetry/ — which is the right copy, because the database ' +
      'is the artifact and the endpoint is just the door.',
  ],
  [
    '/replay',
    'Serves ARCHIVED bytes back to the app for offline testing. Archiving the ' +
      'archive is circular by construction.',
  ],
  [
    '/imagery/radar',
    'Imagery is tiles and frame indexes addressed by time and viewport. A ' +
      'rolling 72-hour window of image bytes would swamp the repo for a ' +
      'question no session has yet needed to ask.',
  ],
  [
    '/imagery/radar-frames',
    'Same as the radar route above.',
  ],
  [
    '/imagery/radar-coverage',
    'Same as the radar route above.',
  ],
  [
    '/imagery/satellite',
    'Same as the radar route above.',
  ],
]);

/* ---------------------------------------------------------------------------
 * SCANNING
 *
 * ==> THE ROUTE LIST COMES OFF DISK, NOT OUT OF THE CALL SITES. <==
 *
 * The first version of this gate scanned the app for `${ENDPOINT.relay}/...`
 * and reported 18 routes. It was wrong, and it was wrong in the direction that
 * matters: the app addresses its relay THREE different ways — that template,
 * a bare path handed to a helper that prepends the base (`ask('/nws/rainfall')`
 * in data/rainfall.js), and a plain literal (`'/api/geocode'` in
 * data/geocode.js). A scanner that knows one of those three reports a clean
 * bill of health over the two it cannot see, which is worse than no gate.
 *
 * So the question is asked the other way round. `functions/api/` IS the list of
 * routes that exist. Every one of them is archived, or excused here in a
 * sentence. Whether the app currently calls a given route is not consulted,
 * deliberately: a route nobody calls is dead code and the project rule is that
 * deleted code is deleted, so "unused" is not a state this check needs to model.
 * ------------------------------------------------------------------------- */

/** Every route file under functions/api/, as a route path.
 *
 *  `functions/api/jtwc/storms.js`      → `/jtwc/storms`
 *  `functions/api/replay/[[route]].js` → `/replay`
 *
 *  Files whose name starts with `_` are shared helpers, not routes. */
function routesOnDisk(dir = 'functions/api', out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      routesOnDisk(rel, out);
      continue;
    }
    if (e.startsWith('_') || extname(e) !== '.js') continue;
    const path = rel.replace(/^functions\/api/, '').replace(/\.js$/, '');
    /* A catch-all segment is the route, not a child of it. */
    out.push(path.replace(/\/\[\[?[^\]]*\]\]?$/, ''));
  }
  return out;
}

/** Relay routes the ARCHIVE fetches. */
function archivedRoutes() {
  const src = readFileSync(join(ROOT, FETCHER), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/landfall\.getgravitate\.app\/api(\/[^'"`\s)?]*)/g)) {
    const route = String(m[1]).replace(/\/+$/, '');
    if (route) out.add(route);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * THE CHECK
 * ------------------------------------------------------------------------- */

const wanted = routesOnDisk().sort();
const have = archivedRoutes();

const missing = wanted.filter((r) => !have.has(r) && !EXCUSED.has(r));

/* An excuse for a route that no longer exists is dead weight and hides the next
 * real gap. Flagged, not fatal — deleting a route and its excuse in one pass is
 * fine and should not need two commits. */
const stale = [...EXCUSED.keys()].filter((r) => !wanted.includes(r));

console.log(
  `relay-archive-check: ${wanted.length} relay route(s) on disk, ` +
    `${wanted.filter((r) => have.has(r)).length} archived, ` +
    `${wanted.filter((r) => !have.has(r) && EXCUSED.has(r)).length} excused`
);

if (stale.length) {
  console.log(
    `\nnote: ${stale.length} excused route(s) no longer exist — ` +
      `remove from EXCUSED:\n  ${stale.join('\n  ')}`
  );
}

if (missing.length) {
  console.error(
    `\nFAIL: ${missing.length} relay route(s) are neither archived nor excused.\n`
  );
  for (const route of missing) console.error(`  ${route}`);
  console.error(
    `\nAdd each to SOURCES in ${FETCHER}, or add it to EXCUSED in this file\n` +
      `with a sentence saying why a fixed hourly URL for it does not exist.\n` +
      `==> AN UPSTREAM COPY DOES NOT SATISFY THIS. THE APP READS THE RELAY. <==\n`
  );
  process.exit(1);
}

console.log('relay-archive-check: ok');
