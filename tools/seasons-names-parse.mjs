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
 * ==> CENTRAL PACIFIC IS PARSED AS FOUR FLAT LISTS AND NEVER AS A ROSTER.
 * <== §57.12 still stands: its four lists run one after another across season
 * boundaries, so "the names for 2026" has no answer there and a per-year
 * roster would invent a structure the basin does not have. What IS well
 * defined is the flat set of 48 names currently in service, and §57.51 needs
 * exactly that — a name in service somewhere cannot be a retired name, and
 * without this set every Central Pacific name that ever crossed into the east
 * Pacific record falls out of the subtraction looking retired.
 */

/** Atlantic skips Q, U, X, Y and Z — 21 names. */
export const ATLANTIC_LETTERS = 'ABCDEFGHIJKLMNOPRSTVW';
/** East Pacific skips only Q and U — 24 names. */
export const EPACIFIC_LETTERS = 'ABCDEFGHIJKLMNOPRSTVWXYZ';
/**
 * Central Pacific uses Hawaiian names on twelve letters, in this order, on
 * every one of its four lists. Measured off the real page 2026-08-24, not
 * assumed — the sequence is not alphabetical past the first few and there is
 * no rule to derive it from.
 */
export const CPACIFIC_LETTERS = 'AEHIKLMNOPUW';
/** Four lists, twelve names each. Both figures are gates, not descriptions. */
export const CPACIFIC_LIST_COUNT = 4;

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

  const cp = parseCentralPacific(String(html || ''));
  faults.push(...cp.faults);

  return { rosters, cpacific: cp.lists, faults };
}

/**
 * The four Central Pacific lists, in page order.
 *
 * ==> THE COLUMNS ARE HEADED "List 1".."List 4", NOT YEARS. <== That is the
 * whole difference from the two rosters above and it is why this cannot reuse
 * `parseTable`: there is no year to key on and no year to sanity-check, so the
 * gates have to be the shape instead — four columns, twelve names each, the
 * measured initial sequence, and no name appearing on two lists.
 *
 * @param {string} html  the exact bytes of aboutnames.shtml
 * @returns {{ lists: string[][], faults: string[] }}
 */
export function parseCentralPacific(html) {
  const faults = [];
  const section = sectionOf(String(html || ''), 'cnp');
  if (!section) {
    faults.push('the Central Pacific section is missing — the page has been restructured');
    return { lists: [], faults };
  }
  const table = firstTable(section);
  if (!table) {
    faults.push('the Central Pacific section has no table');
    return { lists: [], faults };
  }

  /* Same id-not-position rule the rosters use: a column is matched to its
   * header by `headers=`, so a column added or reordered fails loudly instead
   * of shifting a whole list one place along. */
  const heads = new Map();
  for (const m of table.matchAll(/<th\s+([^>]*)>([\s\S]*?)<\/th>/gi)) {
    const id = /id=["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!id) { faults.push('cpacific: a header cell has no id'); continue; }
    heads.set(id, stripTags(m[2]));
  }

  const byLabel = new Map();
  for (const m of table.matchAll(/<td\s+([^>]*)>([\s\S]*?)<\/td>/gi)) {
    const key = /headers=["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!key) { faults.push('cpacific: a name column has no headers= attribute'); continue; }
    if (!heads.has(key)) {
      faults.push(`cpacific: column "${key}" names a header that does not exist`);
      continue;
    }
    const label = heads.get(key);
    const n = /^List\s+(\d+)$/i.exec(label);
    if (!n) {
      faults.push(`cpacific: column "${key}" is headed "${label}", which is not a list number`);
      continue;
    }
    /* The asterisk marks the name this season starts on. It is page furniture
     * and is stripped by the same rule the rosters use. */
    const names = m[2].split(/<br\s*\/?>/i)
      .map((c) => stripTags(c).replace(/\*+$/, '').trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());

    const idx = Number(n[1]);
    if (byLabel.has(idx)) faults.push(`cpacific: list ${idx} appears twice`);
    byLabel.set(idx, names);

    if (names.length !== CPACIFIC_LETTERS.length) {
      faults.push(`cpacific list ${idx}: ${names.length} names, expected ${CPACIFIC_LETTERS.length}`);
    }
    const initials = names.map((s) => s[0]).join('');
    if (initials !== CPACIFIC_LETTERS.slice(0, initials.length)) {
      faults.push(`cpacific list ${idx}: initials read "${initials}", expected "${CPACIFIC_LETTERS}"`);
    }
    for (const s of names) {
      if (!/^[A-Z][A-Z'-]*$/.test(s)) faults.push(`cpacific list ${idx}: "${s}" is not a name`);
    }
  }

  const nums = [...byLabel.keys()].sort((a, b) => a - b);
  if (nums.length !== CPACIFIC_LIST_COUNT) {
    faults.push(`cpacific: ${nums.length} lists, expected ${CPACIFIC_LIST_COUNT}`);
  }
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) { faults.push(`cpacific: the lists are numbered ${nums.join(', ')}`); break; }
  }

  const lists = nums.map((i) => byLabel.get(i));
  /* One name on two lists would be a misread column, and it would also make
   * the "in service" set smaller than it looks. */
  const flat = lists.flat();
  if (new Set(flat).size !== flat.length) {
    faults.push('cpacific: the same name appears on more than one list');
  }

  return { lists, faults };
}
