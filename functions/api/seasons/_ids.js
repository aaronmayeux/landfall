/**
 * _ids.js — which storm ids the seasons routes will accept, and which files in
 * NHC's b-deck directory are real storms. SPEC-SEASONS-BUILD.md §57.13,
 * SPEC-DATA.md §58.
 *
 * ==> THIS IS A SECOND COPY OF `isRealStorm` AND THAT IS FORCED, NOT LAZY. <==
 * The first copy is `lib/hurdat.js`, which the app and the mirror both import.
 * Pages Functions run in their own workerd runtime and every file under
 * `functions/` is self-contained (§3) — it cannot reach into `lib/`, and a
 * route that tried would be importing the whole `config/constants.js` graph
 * into a request path that renders nothing.
 *
 * The project has been here before and knows the shape of the bug: two copies
 * of a regex that both look plausible, drifting silently across a deploy
 * boundary. `parseSubject` in `functions/api/jtwc/storms.js` is the precedent,
 * and it survived only because a test holds the two against each other. So:
 * **`tools/test-seasons-ids.mjs` drives this file and `lib/hurdat.js` over
 * every basin token and every storm number 0-99 and fails on the first
 * disagreement.** A copy nobody checks is how the two drift.
 *
 * ==> AND WHY THE FILTER MATTERS AT ALL. <== Numbers 90-99 are invests, and
 * NHC REUSES those numbers several times inside one season. An unfiltered
 * directory listing therefore files three different systems under one name and
 * each one overwrites the last. 80-89 are internal test systems. Measured
 * 2026-08-24 on the real directory: 18 files, 14 real storms, 4 invests.
 *
 * Nothing here fetches, parses a track, or knows what a storm IS. It reads
 * filenames and query strings.
 */

/**
 * The basins NHC's own b-deck directory covers. Mirrors `SEASONS.nhcBasins`.
 * Anything else in that directory is not ours to serve from here — §57.30
 * step 13 owns the rest of the world.
 */
export const NHC_BASINS = Object.freeze(['al', 'ep', 'cp']);

/**
 * Real storm numbers. Mirrors `SEASONS.realStormNumberMin/Max`. The ceiling is
 * 49 rather than 30 because a season can run past thirty — 2005 reached AL31 —
 * and it is below 80 so nothing in either reserved band can slip through.
 */
export const REAL_MIN = 1;
export const REAL_MAX = 49;

/**
 * An ATCF storm id — `al012026`. **Anchored at both ends, and that is the
 * load-bearing part of this file.**
 *
 * ==> THIS IS THE SECOND ROUTE IN THE APP THAT BUILDS AN UPSTREAM URL OUT OF
 * CLIENT INPUT. <== `functions/api/nws/alert.js` is the first, and its header
 * carries the full argument. Unanchored, a value like
 * `https://evil.example/?ok=al012026` passes a `.test()` and the function then
 * fetches it from inside Cloudflare's network under our User-Agent. The anchors
 * are what stop that, so `tools/test-seasons-ids.mjs` verifies them by
 * removing each one and confirming the refusal cases go green.
 */
const STORM_ID_RE = /^([a-z]{2})(\d{2})(\d{4})$/;

/** A b-deck filename as the directory lists it — `bal012026.dat`. */
const BDECK_FILE_RE = /^b([a-z]{2}\d{6})\.dat$/i;

/**
 * `al012026` → `{ basin, number, year }`, or null.
 *
 * Returns null for anything that is not exactly the eight characters, so a
 * caller cannot get a partial answer out of a malformed id and carry on.
 */
export function parseStormId(id) {
  const m = STORM_ID_RE.exec(String(id || '').toLowerCase());
  if (!m) return null;
  return { basin: m[1], number: Number(m[2]), year: Number(m[3]) };
}

/** True when this id names a real storm rather than an invest or a test. */
export function isRealStorm(id) {
  const p = parseStormId(id);
  if (!p) return false;
  if (!NHC_BASINS.includes(p.basin)) return false;
  return p.number >= REAL_MIN && p.number <= REAL_MAX;
}

/**
 * `bal012026.dat` → `al012026`, or null when the name is not a b-deck at all.
 * Case-insensitive on the way in, lower on the way out, so the id that keys a
 * cache is always the same characters.
 */
export function idFromFilename(name) {
  const m = BDECK_FILE_RE.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** `al012026` → `bal012026.dat`. The inverse, so no caller builds it by hand. */
export const filenameFromId = (id) => `b${String(id).toLowerCase()}.dat`;

/**
 * Why a listed file was dropped, in words rather than as a silent absence.
 *
 * ==> AN UNEXPLAINED REJECTION IS ONE NOBODY CAN CHECK (§5). <== The mirror's
 * manifest names every file it dropped and why, and this route says the same
 * thing on the wire for the same reason: a reader comparing the route against
 * `seasons-live` should be able to see that both dropped the same four files,
 * not just that both ended up with fourteen.
 */
export function rejectionReason(name) {
  const id = idFromFilename(name);
  if (!id) return 'not a b-deck filename';
  const p = parseStormId(id);
  if (!p) return 'not an ATCF storm id';
  if (!NHC_BASINS.includes(p.basin)) return `basin ${p.basin.toUpperCase()} is not an NHC basin`;
  if (p.number > REAL_MAX) return 'invest or test system — number is reused within a season';
  if (p.number < REAL_MIN) return 'storm number 00 is not a storm';
  return null;
}

/**
 * Every `href` in a directory listing, however it is quoted. NHC serves an
 * Apache-style index and the quoting has changed before; matching on the
 * attribute rather than on the surrounding markup is what survives a restyle.
 */
export function hrefs(html) {
  return [...String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

/**
 * A directory listing → the season index this route serves.
 *
 * ==> SEPARATED FROM THE FETCH SO IT CAN BE TESTED AGAINST THE REAL BYTES. <==
 * A Pages Function is not reachable from the sandbox and neither is its
 * upstream, so the only way this logic is ever exercised before it deploys is
 * `tools/test-seasons-ids.mjs` running it over the real listing captured on
 * `seasons-probe-results`. Pure: no fetch, no cache, no clock.
 */
export function indexFromListing(html) {
  const seen = new Set();
  const storms = [];
  const skipped = [];
  let listed = 0;

  for (const href of hrefs(html)) {
    /* A directory listing links its parent and its sort columns too. Only
     * things shaped like a b-deck are counted as listed at all. */
    const name = href.split('/').pop();
    if (!/^b.*\.dat$/i.test(name || '')) continue;
    listed++;

    const id = idFromFilename(name);
    const reason = rejectionReason(name);
    if (reason) {
      skipped.push({ file: name, reason });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    const p = parseStormId(id);
    storms.push({ id, basin: p.basin.toUpperCase(), number: p.number, year: p.year });
  }

  /* Year, then basin, then number — the order a season reads in. */
  storms.sort((a, b) =>
    a.year - b.year || a.basin.localeCompare(b.basin) || a.number - b.number);
  skipped.sort((a, b) => a.file.localeCompare(b.file));

  return { listed, storms, skipped };
}
