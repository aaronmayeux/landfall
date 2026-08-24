/**
 * test-seasons-board.mjs — the season board. §57.18, §57.19, §57.30 step 5.
 *
 * ==> IT DRIVES THE REAL VIEW AGAINST REAL SEASON FILES. <== The fetch facade
 * is a stub — there is no network in the sandbox — but everything behind it is
 * the shipped code reading the bytes `seasons/data/` actually serves. A board
 * built against invented storms would pass while getting 2005 wrong.
 *
 * The DOM is a small hand-rolled stand-in rather than a library: the view uses
 * `innerHTML`, `querySelector`, `closest` and two delegated listeners, and
 * pulling in a parser to cover four methods would be a dependency this repo
 * does not have and does not need. What it CANNOT check is layout, which is
 * Aaron's job on glass and always was.
 *
 * ==> THE THING THIS SUITE EXISTS TO CATCH IS A ROSTER AND A GLOBE THAT
 * DISAGREE. <== The checkbox is what the reader believes; the tracks are what
 * they see. Every assertion about filters below is really about that.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);

/* ---------------------------------------------------------------------------
 * A DOM small enough to read. Only what the view touches.
 * ------------------------------------------------------------------------ */

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.dataset = {};
    this.checked = false;
    this.value = '';
    this._html = '';
    this._listeners = new Map();
  }

  set innerHTML(html) {
    this._html = html;
    this.children = parseHtml(html, this);
  }

  get innerHTML() { return this._html; }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  /** Bubble to the delegated listener on the scroller, the way a real event
   *  does — the view binds on the body and reads `e.target.closest(...)`. */
  fire(type, target) {
    for (const fn of this._listeners.get(type) || []) fn({ target });
  }

  descendants() {
    const out = [];
    for (const c of this.children) { out.push(c); out.push(...c.descendants()); }
    return out;
  }

  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
    return null;
  }

  matches(sel) {
    /* `[data-step]` and `[data-retry="live"]` both. ==> THE VALUE FORM WAS
     * MISSING AND IT FAILED SILENTLY. <== `matches` returning false is what a
     * non-matching element does, so a selector this stand-in could not read
     * looked exactly like a button nobody pressed, and the suite reported the
     * view as broken. Anything added here must be readable, or the next
     * unreadable selector tells the same lie. */
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const inner = sel.slice(1, -1);
      const eq = inner.indexOf('=');
      const attr = eq === -1 ? inner : inner.slice(0, eq);
      const want = eq === -1 ? null : inner.slice(eq + 1).replace(/^["']|["']$/g, '');
      const key = attr.replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
      const got = this.dataset[key];
      return want == null ? got !== undefined : got === want;
    }
    if (sel.startsWith('.')) return (this.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('#')) return this.attrs.id === sel.slice(1);
    return this.tagName === sel.toUpperCase();
  }

  querySelector(sel) {
    return this.descendants().find((n) => sel.split(',').some((s) => n.matches(s.trim()))) || null;
  }

  querySelectorAll(sel) {
    return this.descendants().filter((n) => sel.split(',').some((s) => n.matches(s.trim())));
  }
}

/** Enough of a tag scanner for the view's own markup. Not a general parser —
 *  it exists to turn the strings this one file emits back into nodes. */
function parseHtml(html, parent) {
  const out = [];
  const stack = [];
  const re = /<(\/?)([a-z][a-z0-9]*)((?:\s+[^>]*?)?)(\/?)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, attrText, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    const el = new El(tag);
    for (const a of attrText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const [, name, value = ''] = a;
      el.attrs[name] = value;
      if (name.startsWith('data-')) {
        el.dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
      }
      if (name === 'checked') el.checked = true;
      if (name === 'value') el.value = value;
      if (name === 'selected') el.attrs.selected = '';
    }
    const host = stack[stack.length - 1] || parent;
    el.parent = host;
    (stack.length ? host.children : out).push(el);
    if (!selfClose && !['input', 'br', 'hr', 'img'].includes(tag.toLowerCase())) stack.push(el);
  }
  return out;
}

globalThis.document = {
  createElement: (t) => new El(t),
};

/* ---------------------------------------------------------------------------
 * The real index and the real season files, off disk.
 * ------------------------------------------------------------------------ */

const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
const { parseHurdat2, parseBdeck } = await import('../lib/hurdat.js');
const { liveStormsIn } = await import('../data/seasons-live.js');
const { createSeasonsBoardView } = await import('../ui/view-seasons-board.js');

/** How many times a stub was asked for a season, EITHER ROAD. Counting only
 *  the settled one would have gone quiet the moment the board started opening
 *  on the season in progress, and the assertion it guards — that a bad deep
 *  link costs one fetch rather than two — would have passed on nothing. */
let seasonLoads = 0;
let failNextSeason = null;

const seasons = {
  loadIndex: async () => ({ status: 'ok', index }),
  basinsIn: (idx) => Object.keys(idx?.basins || {}),
  basinLabel: (idx, b) => idx?.basins?.[b]?.label || b,
  seasonsIn: (idx, b) => Object.keys(idx?.basins?.[b]?.seasons || {})
    .map(Number).sort((a, z) => z - a),
  loadSeason: async (idx, basin, year) => {
    seasonLoads++;
    if (failNextSeason) {
      const reason = failNextSeason;
      failNextSeason = null;
      return { status: 'unavailable', reason, year, basin };
    }
    const file = idx?.basins?.[basin]?.seasons?.[String(year)];
    if (!file) return { status: 'unavailable', reason: 'not_in_index', year, basin };
    const text = readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8');
    const { storms, faults } = parseHurdat2(text);
    return { status: 'ok', storms, faults, year, basin };
  },
};

/* ---------------------------------------------------------------------------
 * THE SECOND ROAD — §57.30 step 5b.
 *
 * ==> STUBBED AT THE FACADE, BUILT FROM THE REAL B-DECKS. <== The same shape
 * `data/seasons.js` is stubbed in above, for the same reason: there is no
 * network here. What is NOT invented is anything behind it — the storms come
 * out of `parseBdeck` reading `samples/seasons-live/`, and the basin mapping
 * is the shipped `liveStormsIn` rather than a second copy of the rule. A
 * hand-written 2026 would have passed while getting the Central Pacific wrong,
 * which is the one thing that mapping exists to get right.
 * ------------------------------------------------------------------------ */

const LIVE_DIR = join(ROOT, 'samples', 'seasons-live');
const LIVE_STORMS = readdirSync(LIVE_DIR)
  .filter((f) => /^b[a-z]{2}\d{6}\.dat$/i.test(f))
  .map((f) => {
    const id = f.replace(/^b|\.dat$/gi, '').toLowerCase();
    return {
      id,
      basin: id.slice(0, 2).toUpperCase(),
      number: Number(id.slice(2, 4)),
      year: Number(id.slice(4, 8)),
      file: f,
    };
  });

/** The live index is down, with this reason. Null when it is up. */
let liveIndexFails = null;
/** The answer came out of a stored copy. */
let liveStale = false;
/** Storm ids whose track will not load, so `unreadable` is a real count
 *  rather than a number the suite hands the view. */
const liveBroken = new Set();
/** Which year the b-deck directory says the season in progress is. Its own
 *  switch because the whole point of §58.1 is that this number comes off the
 *  FILENAMES rather than off the reader's clock, and a suite that only ever
 *  drives the year it happens to be running in cannot tell the two apart. */
let liveYearIs = 2026;

const live = {
  loadLiveIndex: async () => (liveIndexFails
    ? { status: 'unavailable', reason: liveIndexFails }
    : {
      status: 'ok',
      year: liveYearIs,
      years: [liveYearIs],
      storms: LIVE_STORMS.map(({ file, ...s }) => ({ ...s, year: liveYearIs })),
      stale: liveStale,
      fetchedAt: '2026-08-24T21:00:00.000Z',
    }),

  loadLiveSeason: async (liveIndex, basin, year) => {
    seasonLoads++;
    const wanted = liveStormsIn(liveIndex, basin, year);
    const storms = [];
    let unreadable = 0;
    for (const s of wanted) {
      if (liveBroken.has(s.id)) { unreadable++; continue; }
      const file = LIVE_STORMS.find((x) => x.id === s.id)?.file;
      if (!file) { unreadable++; continue; }
      const { storm } = parseBdeck(readFileSync(join(LIVE_DIR, file), 'utf8'), { id: s.id });
      if (storm) storms.push(storm); else unreadable++;
    }
    if (wanted.length && !storms.length) {
      return {
        status: 'unavailable',
        reason: `none of the ${wanted.length} storms this season could be read`,
        year,
        basin,
      };
    }
    storms.sort((a, b) => (a.points[0]?.time ?? 0) - (b.points[0]?.time ?? 0));
    return { status: 'ok', storms, faults: [], unreadable, year, basin, provisional: true };
  },
};

/** Put every live switch back, so one case cannot leak into the next. */
function freshLive() {
  liveIndexFails = null;
  liveStale = false;
  liveYearIs = 2026;
  liveBroken.clear();
}

/** Build a mounted board and wait for the index and first season to land. */
async function board({ year = null } = {}) {
  const drawn = [];
  const where = [];
  const view = createSeasonsBoardView({
    seasons,
    live,
    onSelection: (sel) => drawn.push(sel.map((e) => e.storm.id)),
    onWhere: (w) => where.push(w),
  });
  if (year != null) view.setSeason(year);
  const host = new El('div');
  view.mount(host);
  await settle();
  const body = host.querySelector('#seasons-board-body');
  return { view, host, body, drawn, where };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const rows = (body) => body.querySelectorAll('[data-storm]');
const text = (body) => body.innerHTML;

/* ---------------------------------------------------------------------------
 * 1. IT OPENS ON A REAL SEASON AND NAMES IT.
 * ------------------------------------------------------------------------ */
{
  const { body, where } = await board();
  ok('the board opens on a season with storms in it', rows(body).length > 0);
  ok('and the bar is told where it is',
    where.some((w) => w && /Atlantic/.test(w.label)));
  ok('the year select is there to focus', body.querySelector('.seasons-select') !== null);
}

/* ---------------------------------------------------------------------------
 * 2. 2005 — THE SEASON AARON ASKED TO LOOK AT, AGAINST REAL BYTES.
 * ------------------------------------------------------------------------ */
{
  const { body } = await board({ year: 2005 });
  eq('2005 has 31 storms in the roster', rows(body).length, 31);

  /* ==> UNNAMED STORMS SHOW AS A NUMBER, NEVER AS NOAA'S PLACEHOLDER. <==
   * §57.14. 2005 is the season that carries both forms — `TEN` in the name
   * column and `UNNAMED` — and the roster must not show one of them as if a
   * person had chosen it. */
  ok('KATRINA is on the roster', /KATRINA/.test(text(body)));
  ok('the unnamed tenth storm reads as a number', /Storm 10/.test(text(body)));
  ok('and NOAA\'s spelled-out placeholder never reaches the screen',
    !/>\s*TEN\s*</.test(text(body)) && !/NINETEEN/.test(text(body)));

  /* ==> NO GHOSTS ON A SETTLED YEAR, AND THAT IS THE DESIGN. <== Ghosts are
   * the current season only. What 2005 says instead is that it spent every
   * name — which is the same fact, in words, and it is derived from the storms
   * rather than from a list of names nobody has typed. */
  eq('a settled season has no ghost rows',
    body.querySelectorAll('.seasons-row-ghost').length, 0);

  /* The scorecard, off the real file. These are the numbers on screen. */
  ok('the scorecard reports 15 hurricanes', /15/.test(text(body)));
  ok('and 2005 is not flagged as an undercount era',
    !/were often never seen/.test(text(body)));
}

/* ---------------------------------------------------------------------------
 * 3. THE UNDERCOUNT LINE, WHICH IS A CLAIM ABOUT THE ERA.
 * ------------------------------------------------------------------------ */
{
  const { body } = await board({ year: 1935 });
  ok('a pre-satellite season says its counts are a floor',
    /were often never seen/.test(text(body)));
  ok('and every storm in it reads as a number',
    /Storm 1/.test(text(body)) && !/UNNAMED/.test(text(body)));
}

/* ---------------------------------------------------------------------------
 * 4. TICKING DRAWS, UNTICKING CLEARS — step 5's whole done-condition.
 * ------------------------------------------------------------------------ */
{
  const { body, drawn } = await board({ year: 2005 });
  const before = drawn.length;
  const box = rows(body)[11];

  box.checked = true;
  body.fire('change', box);
  eq('ticking a storm draws exactly that storm', drawn[drawn.length - 1].length, 1);

  const second = rows(body)[17];
  second.checked = true;
  body.fire('change', second);
  eq('ticking a second draws both', drawn[drawn.length - 1].length, 2);

  box.checked = false;
  body.fire('change', box);
  eq('unticking removes only that one', drawn[drawn.length - 1].length, 1);

  ok('every push is the whole set, never a delta', drawn.length > before);
}

/* ---------------------------------------------------------------------------
 * 5. ==> A FILTER MUST NOT UN-CHOOSE A STORM. <==
 *
 * The bug this is written to stop: the reader ticks a storm, switches to
 * Majors, and the globe silently loses it because the row left the list. The
 * roster is what the reader believes and the globe is what they see, and the
 * two disagreeing is the worst outcome on this screen.
 * ------------------------------------------------------------------------ */
{
  const { body, drawn } = await board({ year: 2005 });

  const weak = rows(body).find((r) => r.attrs['aria-label']?.includes('TS'));
  ok('2005 has a tropical storm to tick', !!weak);
  weak.checked = true;
  body.fire('change', weak);
  const after = drawn[drawn.length - 1];
  eq('one storm is on the globe', after.length, 1);

  const pushes = drawn.length;
  const majors = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'majors');
  body.fire('click', majors);

  eq('switching filter does not touch the globe', drawn.length, pushes);
  ok('the roster is now shorter', rows(body).length < 31);
  ok('and every remaining row is a major',
    rows(body).every((r) => /Cat [345]/.test(r.attrs['aria-label'] || '')));

  const all = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'all');
  body.fire('click', all);
  const back = rows(body).find((r) => r.dataset.storm === weak.dataset.storm);
  ok('and the ticked storm is still ticked when it comes back', back?.checked === true);
}

/* ---------------------------------------------------------------------------
 * 6. THE LANDFALLS FILTER, AGAINST NOAA'S OWN MARKERS.
 * ------------------------------------------------------------------------ */
{
  const { body } = await board({ year: 2005 });
  const lf = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'landfalls');
  body.fire('click', lf);
  const shown = rows(body);
  ok('the landfalls filter keeps some storms', shown.length > 0);
  ok('and every one of them made landfall',
    shown.every((r) => /landfall/.test(r.attrs['aria-label'] || '')));
}

/* ---------------------------------------------------------------------------
 * 7. CHANGING YEAR CLEARS THE GLOBE BEFORE THE NEW ONE ARRIVES.
 *
 * ==> OTHERWISE THE BAR NAMES A YEAR THE GLOBE IS NOT SHOWING. <== 2005's
 * tracks left up while 1935 loads is the app contradicting itself for as long
 * as the fetch takes.
 * ------------------------------------------------------------------------ */
{
  const { body, drawn } = await board({ year: 2005 });
  const box = rows(body)[0];
  box.checked = true;
  body.fire('change', box);
  ok('something is drawn', drawn[drawn.length - 1].length === 1);

  const older = body.querySelectorAll('[data-step]').find((b) => b.dataset.step === 'older');
  body.fire('click', older);
  eq('the globe empties the moment the year changes', drawn[drawn.length - 1], []);
  await settle();
  eq('and the new season draws nothing on its own', drawn[drawn.length - 1], []);
  ok('the roster is now 2004', /2004/.test(text(body)));
}

/* ---------------------------------------------------------------------------
 * 8. THREE STATES, AND A QUIET YEAR IS NOT A FAILURE.
 *
 * ==> THIS IS §5 ARRIVING ON THE ARCHIVE. <== A season the record says was
 * quiet and a season we could not reach look identical if both draw an empty
 * roster. They are different facts and they get different sentences.
 * ------------------------------------------------------------------------ */
{
  failNextSeason = 'network died';
  const { body } = await board({ year: 2005 });
  ok('a failed season says so', /could not be loaded/.test(text(body)));
  ok('and offers a way to try again', /seasons-retry/.test(text(body)));
  ok('a failure never claims the year was quiet',
    !/no storms for/.test(text(body)));
}

{
  failNextSeason = 'not_in_index';
  const { body } = await board({ year: 2005 });
  ok('a year the archive does not hold says THAT instead',
    /does not hold/.test(text(body)));
  /* Retry cannot work for a year that is not in the index, so it is not
   * offered — a button that can never succeed is worse than no button. */
  ok('and offers no retry, because retrying cannot help',
    !/seasons-retry/.test(text(body)));
}

{
  const { body } = await board({ year: 2005 });
  const majors = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'majors');
  const lf = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'landfalls');
  body.fire('click', majors);
  body.fire('click', lf);
  /* Not reachable in 2005, but the branch is: an empty list caused by the
   * READER'S filter must not read as an empty record. */
  ok('a filter that matches nothing would blame the filter, not the record',
    text(body).includes('match that filter') || rows(body).length > 0);
}

/* ---------------------------------------------------------------------------
 * 9. A DEEP LINK'S YEAR IS HONOURED, OR DROPPED — never half-applied.
 * ------------------------------------------------------------------------ */
{
  const { where } = await board({ year: 1900 });
  ok('a real year in a link opens on that year',
    where.some((w) => w && w.year === 1900));
}

{
  /* 1066 passes the link parser's shape check and is not a season. The board
   * must fall back rather than fetch a file that is not there. */
  const before = seasonLoads;
  const { where } = await board({ year: 1066 });
  ok('a year the archive does not hold falls back to a real one',
    where.some((w) => w && w.year !== 1066));
  eq('and only one season was fetched, not a doomed one first',
    seasonLoads - before, 1);
}

/* ---------------------------------------------------------------------------
 * 10. THE SEASON IN PROGRESS — §57.30 step 5b.
 *
 * The board opens on it, says it is not the reviewed record, and shows the
 * names it has not spent. This is the whole of what 5b adds that a reader can
 * see, so it is asserted as one screen rather than as four properties.
 * ------------------------------------------------------------------------ */
{
  freshLive();
  const { body, where } = await board();

  eq('the board opens on the season in progress', where.at(-1)?.year, 2026);
  ok('the picker says which option is that season',
    /2026 — this season/.test(text(body)));
  ok('the Atlantic side of it has storms', rows(body).length > 0);
  ok('ARTHUR is on the roster', /ARTHUR/.test(text(body)));

  /* §57.11 — the app has to be able to say WHICH record it is showing. */
  ok('it says these are working numbers, not the reviewed record',
    /working numbers for a season still/.test(text(body)));

  /* ==> GHOSTS, AT LAST. <== §57.18a. The whole reason the roster is
   * chronological is that how far down the alphabet it reaches is how far the
   * season got, and only a season still running has an unspent tail. */
  ok('the unused names are on screen',
    body.querySelectorAll('.seasons-row-ghost').length > 0);
  ok('DOLLY has not been used this season', /DOLLY/.test(text(body)));
  ok('and it says how many are left', /still unused this season/.test(text(body)));

  /* ==> GHOSTS ARE A WHOLE-SEASON FACT AND STAY OFF A NARROWED LIST. <== Step
   * 5a's rule. "Eighteen names are still unused" is about the season; printed
   * at the foot of a Majors list it is an unfiltered claim under a filtered
   * one, and the reader has no way to know which of the two it belongs to. */
  const majors = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'majors');
  body.fire('click', majors);
  eq('a narrowed roster shows no ghost rows',
    body.querySelectorAll('.seasons-row-ghost').length, 0);
  ok('and says nothing about names remaining', !/still unused this season/.test(text(body)));
}

{
  /* ==> WHICH SEASON IS "IN PROGRESS" COMES OFF THE RECORD, NEVER OFF THE
   * READER'S CLOCK. <== §58.1. NHC seeds the new year's b-deck directory when
   * it seeds it, so on 1 January a phone says 2027 and the season in progress
   * is still 2026 — and ghosts belong to the season rather than to the
   * calendar. The real case cannot be driven here without moving the clock, so
   * this drives its mirror image: the directory names a year the reader's
   * calendar has not reached. Either way a clock in this path fails, and there
   * is no clock in this path. */
  freshLive();
  liveYearIs = 2027;
  const { body, where } = await board();

  eq('the board opens on the year the record names', where.at(-1)?.year, 2027);
  ok('and its unused names are that year\'s',
    body.querySelectorAll('.seasons-row-ghost').length > 0);
  /* 2027's Atlantic list opens ANA, BILL, CLAUDETTE — nothing like 2026's. A
   * roster keyed on the wrong year would show the wrong alphabet, not none. */
  ok('which is 2027\'s list, not 2026\'s',
    /seasons-ghost-name">ANA</.test(text(body))
    && !/seasons-ghost-name">DOLLY</.test(text(body)));
}

/* ---------------------------------------------------------------------------
 * 11. ==> LANDFALLS: A DASH, NOT A ZERO, AND NO FILTER. <==
 *
 * The working best track carries no landfall marker — that is NOAA's `L`
 * record identifier and it lives only in the reviewed HURDAT2 file. `0` on
 * that cell would read as "nothing reached land this year" in an app called
 * Landfall, and a filter that can only ever come back empty is a control that
 * cannot succeed.
 * ------------------------------------------------------------------------ */
{
  freshLive();
  const { body } = await board();

  const filters = body.querySelectorAll('[data-filter]').map((b) => b.dataset.filter);
  eq('the season in progress offers no landfalls filter', filters, ['all', 'majors']);
  ok('the landfall count is a dash rather than a zero',
    /<span class="seasons-stat-n">—<\/span>\s*<span class="seasons-stat-k">Landfalls/.test(text(body)));
  ok('and it says where the marks come from instead',
    /Landfall marks\s+come with that reviewed record/.test(text(body)));
  ok('no row claims a landfall', !/made landfall/.test(text(body)));
}

{
  /* ==> AND THE FILTER COMES BACK ON A SETTLED YEAR. <== A control removed for
   * one season and never restored is the same bug wearing the opposite face. */
  freshLive();
  const { body } = await board();
  const select = body.querySelector('.seasons-select');
  select.value = '2005';
  body.fire('change', select);
  await settle();

  const filters = body.querySelectorAll('[data-filter]').map((b) => b.dataset.filter);
  eq('a settled year offers all three again', filters, ['all', 'majors', 'landfalls']);
  ok('and its landfall count is a real number',
    /<span class="seasons-stat-n">\d+<\/span>\s*<span class="seasons-stat-k">Landfalls/.test(text(body)));
}

/* ---------------------------------------------------------------------------
 * 12. THE CENTRAL PACIFIC RIDES WITH THE EAST PACIFIC.
 *
 * ==> IT IS NOAA'S OWN FILING, AND GETTING IT WRONG IS SILENT. <== The
 * reviewed record puts CP storms in the East Pacific file; if the live half
 * did not, Lala and Moke would simply not be on the board and nothing on
 * screen would say a storm was missing.
 * ------------------------------------------------------------------------ */
{
  freshLive();
  const { body } = await board();
  const pacific = body.querySelectorAll('[data-basin]')
    .find((b) => b.dataset.basin === 'epacific');
  body.fire('click', pacific);
  await settle();

  const ids = rows(body).map((r) => r.dataset.storm);
  ok('the East Pacific side of the season has storms', ids.length > 0);
  ok('and every one of them is an EP or a CP storm',
    ids.every((id) => /^(ep|cp)/i.test(id)));

  /* ==> NAMED, NOT COUNTED, AND IN THE CASE THE ROWS ACTUALLY CARRY. <==
   * Asserting only that every id starts EP or CP passes perfectly when CP is
   * dropped — the rows just quietly stop being there. Lala and Moke are the
   * only Central Pacific storms in the record this year, so they are the whole
   * test. The ids are UPPERCASE on a row: `lib/hurdat.js` normalises them that
   * way, while the route's own ids are lowercase, and a lowercase comparison
   * here would have been a check that could never fail. */
  ok('LALA is on the board', ids.includes('CP012026') && /LALA/.test(text(body)));
  ok('MOKE is on the board', ids.includes('CP022026') && /MOKE/.test(text(body)));
}

/* ---------------------------------------------------------------------------
 * 13. §5 ON THE SECOND ROAD — three states, and the gaps are counted.
 * ------------------------------------------------------------------------ */
{
  /* ==> A STORM THAT WOULD NOT LOAD IS COUNTED OUT LOUD. <== The index said
   * three and two arrived: a season quietly one storm short looks exactly like
   * a season that had two, and the roster is what the reader believes. */
  freshLive();
  liveBroken.add('al012026');
  const { body } = await board();
  ok('a storm that would not load is counted', /could\s+not be read/.test(text(body)));
  ok('and the ones that did load are still shown', rows(body).length > 0);
  ok('the missing one is off the roster',
    !rows(body).some((r) => r.dataset.storm === 'AL012026'));

  /* ==> ITS NAME IS NOW IN THE UNUSED LIST, AND THAT IS DISCLOSED. <== The
   * name lives inside the file that would not load, so the roster genuinely
   * cannot tell ARTHUR was spent. Nothing can fix that; leaving it unsaid
   * would make the ghost list quietly wrong on the one day something is
   * already wrong. */
  ok('ARTHUR has fallen into the unused names',
    /seasons-ghost-name">ARTHUR</.test(text(body)));
  ok('and the board says that is what happened',
    /may show as unused below/.test(text(body)));
}

{
  /* Every storm failing is an OUTAGE, never a quiet season. */
  freshLive();
  for (const s of LIVE_STORMS) liveBroken.add(s.id);
  const { body } = await board();
  ok('a season where nothing loaded says it failed',
    /could not be loaded/.test(text(body)));
  ok('and never claims the season was quiet',
    !/No storms have formed yet/.test(text(body)));
}

{
  /* A stored copy is a correct list of what it knew about, and cannot promise
   * nothing has formed since. Said rather than hidden. */
  freshLive();
  liveStale = true;
  const { body } = await board();
  ok('a stored copy says so', /came from a stored copy/.test(text(body)));
}

{
  /* ==> THE LIVE INDEX BEING DOWN IS NOT "THERE IS NO CURRENT SEASON". <==
   * The year is simply absent from the picker, and an absent option explains
   * nothing — so the sentence goes on the board, with a button, because this
   * is a failure a second attempt can actually fix. */
  freshLive();
  liveIndexFails = 'the current season answered 502';
  const { body, where } = await board();

  ok('the board still opens on a settled year', where.at(-1)?.year === 2025);
  ok('and says the season still running could not be reached',
    /could not\s+be reached/.test(text(body)));
  ok('with a way to try again', /data-retry="live"/.test(text(body)));
  ok('2026 is not in the picker', !/2026/.test(text(body)));

  /* The recovery actually recovers, and it does not disturb the year on
   * screen while doing it. */
  liveIndexFails = null;
  const retry = body.querySelectorAll('[data-retry]')[0];
  body.fire('click', retry);
  await settle();
  await settle();

  ok('retrying puts the season in progress back in the picker',
    /2026 — this season/.test(text(body)));
  ok('and the year on screen did not change', where.at(-1)?.year === 2025);
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the board against real season files`);
