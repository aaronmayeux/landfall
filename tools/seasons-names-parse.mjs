/**
 * seasons-names-parse.mjs — turn NHC's names page into two rosters per year.
 *
 * ==> WHY THIS LIVES IN tools/ AND NOT lib/. <== §12: every import in lib/
 * ships to every visitor. Nothing in the browser ever parses this page — the
 * browser reads `lib/season-names-data.js`, which is the OUTPUT of this file.
 * Shipping an HTML scraper to a phone that will never run it is dead weight on
 * the boot path for no gain.
 *
 * ==> IT IS PURE ON PURPOSE. <== No fetch, no fs, no clock. `seasons-names.mjs`
 * does the fetching and the writing; this does nothing but read a string. That
 * split is what lets `tools/test-seasons-names-parse.mjs` run the real parser
 * against real archived bytes with no network, which is the only way a session
 * inside the wall can prove it works.
 *
 * WHAT THE PAGE ACTUALLY LOOKS LIKE — measured 2026-08-24 from real bytes
 * (`samples/nhc-names/`), not assumed:
 *
 *     <a name="atl"></a>
 *     <h3>Atlantic Names</h3>
 *     <table ...>
 *     <tr><th id="a1">2026</th><th id="a2">2027</th>...
 *     <tr><td headers="a1">
 *     Arthur<br>
 *     Bertha<br>
 *     ...
 *     Wilfred
 *     </td><td headers="a2">...
 *
 * Three tables: Atlantic under `atl`, East Pacific under `enp`, and Central
 * Pacific under `cnp`. The `<tr>` tags are never closed and the header row runs
 * straight into the body row, which is fine — nothing here needs a tree.
 *
 * ==> THE COLUMN IS MATCHED BY ID, NOT BY POSITION. <== Each `<td>` carries
 * `headers="a1"` naming the `<th id="a1">` it belongs to. Reading the year off
 * that link rather than counting columns is the difference between "NOAA added
 * a column and we silently shifted every list by one year" and a loud failure.
 * If a cell's `headers` does not name a header we found, this refuses.
 *
 * ==> CENTRAL PACIFIC IS PARSED AND THEN DISCARDED. <== §57.12. Its four lists
 * run one after another across season boundaries, so "the names for 2026" has
 * no answer there and a roster with ghosts on it would invent a structure the
 * basin does not have. It is read only so a fault in that table is visible
 * rather than mistaken for a missing section.
 */

/** Atlantic skips Q, U, X, Y and Z — 21 names. */
export const ATLANTIC_LETTERS = 'ABCDEFGHIJKLMNOPRSTVW';
/** East Pacific skips only Q and U — 24 names. */
export const EPACIFIC_LETTERS = 'ABCDEFGHIJKLMNOPRSTVWXYZ';

/** Anchor name on the page -> the basin key `seasons/index.json` uses. */
const SECTIONS = Object.freeze([
  { anchor: 'atl', basin: 'atlantic', letters: ATLANTIC_LETTERS },
  { anchor: 'enp', basin: 'epacific', letters: EPACIFIC_LETTERS },
]);

/* The handful of entities NOAA's page actually uses. Deliberately not a full
 * decoder — an unknown entity should survive as text and fail the name shape
 * check loudly, rather than be silently mangled into something plausible. */
const ENTITIES = { '&amp;': '&', '&nbsp;': ' ', '&#39;': "'", '&apos;': "'", '&quot;': '"' };

function decode(s) {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => (e in ENTITIES ? ENTITIES[e] : e));
}

function stripTags(s) {
  return decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * The slice of the page belonging to one anchor: from `<a name="X">` up to the
 * next `<a name=`. Bounded rather than open-ended, so a missing following
 * anchor cannot swallow the rest of the document and pick up a stray table.
 */
function sectionOf(html, anchor) {
  const start = html.search(new RegExp(`<a\\s+name=["']${anchor}["']`, 'i'));
  if (start < 0) return null;
  const rest = html.slice(start + 1);
  const next = rest.search(/<a\s+name=["'][a-z0-9_-]+["']/i);
  return next < 0 ? rest : rest.slice(0, next);
}

function firstTable(section) {
  const open = section.search(/<table\b/i);
  if (open < 0) return null;
  const after = section.slice(open);
  const close = after.search(/<\/table>/i);
  return close < 0 ? null : after.slice(0, close);
}

/**
 * Parse one basin's table into `{ '2026': ['ARTHUR', ...], ... }`.
 * Returns `{ years, faults }` — faults is the finding, never an exception, so
 * the caller can report every problem in one run instead of the first one.
 */
function parseTable(table, letters, basin) {
  const faults = [];
  const years = {};

  /* Headers: id -> the text in the cell. */
  const heads = new Map();
  for (const m of table.matchAll(/<th\s+([^>]*)>([\s\S]*?)<\/th>/gi)) {
    const id = /id=["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!id) { faults.push(`${basin}: a header cell has no id`); continue; }
    heads.set(id, stripTags(m[2]));
  }
  if (!heads.size) faults.push(`${basin}: the table has no header cells at all`);

  for (const m of table.matchAll(/<td\s+([^>]*)>([\s\S]*?)<\/td>/gi)) {
    const key = /headers=["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!key) { faults.push(`${basin}: a name column has no headers= attribute`); continue; }
    if (!heads.has(key)) {
      faults.push(`${basin}: column "${key}" names a header that does not exist`);
      continue;
    }

    const label = heads.get(key);
    if (!/^\d{4}$/.test(label)) {
      faults.push(`${basin}: column "${key}" is headed "${label}", which is not a year`);
      continue;
    }
    const year = Number(label);

    /* Names are separated by <br>. Split on it FIRST, so a missing <br> shows
     * up as one impossible run-together name rather than being papered over by
     * splitting on whitespace. */
    const names = m[2].split(/<br\s*\/?>/i)
      .map((c) => stripTags(c).replace(/\*+$/, '').trim())
      .filter(Boolean)
      .map((n) => n.toUpperCase());

    if (year in years) faults.push(`${basin}: ${year} appears twice`);
    years[year] = names;

    /* Shape, per column, so the message names the year that is wrong. */
    if (names.length !== letters.length) {
      faults.push(`${basin} ${year}: ${names.length} names, expected ${letters.length}`);
    }
    const initials = names.map((n) => n[0]).join('');
    if (initials !== letters.slice(0, initials.length)) {
      faults.push(`${basin} ${year}: initials read "${initials}", expected "${letters}"`);
    }
    for (const n of names) {
      if (!/^[A-Z][A-Z'-]*$/.test(n)) faults.push(`${basin} ${year}: "${n}" is not a name`);
    }
    if (new Set(names).size !== names.length) {
      faults.push(`${basin} ${year}: the same name appears twice`);
    }
  }

  const found = Object.keys(years).map(Number).sort((a, b) => a - b);
  if (!found.length) faults.push(`${basin}: no year columns were found`);
  /* NOAA publishes a consecutive six-year window. A gap means we misread a
   * header, and a misread header is exactly how a list lands on the wrong
   * season. */
  for (let i = 1; i < found.length; i++) {
    if (found[i] !== found[i - 1] + 1) {
      faults.push(`${basin}: years jump from ${found[i - 1]} to ${found[i]}`);
    }
  }

  return { years, faults };
}

/**
 * @param {string} html  the exact bytes of aboutnames.shtml
 * @returns {{ rosters: Record<string, Record<number, string[]>>, faults: string[] }}
 */
export function parseNamesPage(html) {
  const rosters = {};
  const faults = [];

  for (const { anchor, basin, letters } of SECTIONS) {
    const section = sectionOf(String(html || ''), anchor);
    if (!section) { faults.push(`${basin}: no <a name="${anchor}"> on the page`); continue; }
    const table = firstTable(section);
    if (!table) { faults.push(`${basin}: the ${anchor} section has no table`); continue; }
    const r = parseTable(table, letters, basin);
    rosters[basin] = r.years;
    faults.push(...r.faults);
  }

  /* Central Pacific: presence only. §57.12 — we never build a roster from it,
   * but if that section vanishes the page has changed enough to look at. */
  const cnp = sectionOf(String(html || ''), 'cnp');
  if (!cnp || !firstTable(cnp)) {
    faults.push('the Central Pacific section is missing — the page has been restructured');
  }

  return { rosters, faults };
}
