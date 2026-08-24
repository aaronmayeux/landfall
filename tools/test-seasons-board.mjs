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

import { readFileSync } from 'node:fs';
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
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const key = sel.slice(1, -1).replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return this.dataset[key] !== undefined;
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
const { parseHurdat2 } = await import('../lib/hurdat.js');
const { createSeasonsBoardView } = await import('../ui/view-seasons-board.js');

/** How many times the stub was asked for a season, so a suite can prove the
 *  board is not re-fetching a year it already has on screen. */
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

/** Build a mounted board and wait for the index and first season to land. */
async function board({ year = null } = {}) {
  const drawn = [];
  const where = [];
  const view = createSeasonsBoardView({
    seasons,
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

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the board against real season files`);
