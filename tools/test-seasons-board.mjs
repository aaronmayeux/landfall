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
/* ==> THE STAND-IN DOM MOVED OUT WHEN STEP 7 NEEDED IT TOO. <== §12: a pattern
 * used twice gets extracted before the second use. Nothing about it changed —
 * this suite is the proof of that, because it exercises every branch in there
 * and went on passing unchanged. `tools/markup-dom.mjs` says why it is not
 * `tools/fake-dom.mjs`. */
import { El, installMarkupDocument } from './markup-dom.mjs';

installMarkupDocument();

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
/** ==> WHAT THE LIVE APP IS STILL DRAWING IN COLOUR. §57.21c. <== `null` is
 *  the live feed having NEVER answered, which is a different fact from a feed
 *  that answered with no storms — see the fallback cases below. Lowercased
 *  ATCF ids, the shape `lib/lifecycle.js`'s `reportingStormIds` returns. */
let liveRunning = null;

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
  liveRunning = null;
  liveBroken.clear();
}

/** Build a mounted board and wait for the index and first season to land. */
async function board({ year = null } = {}) {
  const drawn = [];
  const where = [];
  const focus = [];
  const opened = [];
  const view = createSeasonsBoardView({
    seasons,
    live,
    onSelection: (sel) => drawn.push(sel.map((e) => e.storm.id)),
    onFocus: (id) => focus.push(id),
    onWhere: (w) => where.push(w),
    onOpenStorm: (id) => opened.push(id),
    liveRunningIds: () => liveRunning,
  });
  if (year != null) view.setSeason(year);

  /* ==> THE BOARD IS MOUNTED INSIDE THE DRAWER'S OWN CHROME, AND THAT IS THE
   * WHOLE POINT OF THIS SCAFFOLD. §57.22b. <== It used to be a bare `div` with
   * no parent, so `e.target.closest(...)` could never walk past the board's
   * body — and the fault that killed step 7 lived precisely up there.
   * `#drawer` carries `data-open="true"`, so `closest('[data-open]')` from any
   * unhandled click in the roster matched THE SHEET and the board asked to
   * open a storm called `true`. **A suite that mounts a view in isolation
   * cannot see a selector escaping its view**, which is why the real
   * attributes `ui/drawer.js` publishes are reproduced here rather than
   * approximated. */
  const drawer = new El('aside');
  drawer.attrs.id = 'drawer';
  drawer.dataset.open = 'true';
  drawer.dataset.view = 'seasons-board';
  const views = new El('div');
  views.parent = drawer;
  drawer.children.push(views);
  const host = new El('div');
  host.dataset.view = 'seasons-board';
  host.dataset.active = 'true';
  host.parent = views;
  views.children.push(host);

  view.mount(host);
  await settle();
  const body = host.querySelector('#seasons-board-body');
  return { view, host, drawer, body, drawn, where, focus, opened };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const rows = (body) => body.querySelectorAll('[data-storm]');

/* ==> THE YEAR STEPPER IS NOT IN THE BODY ANY MORE. §57.39a. <== It is pinned
 * as a sibling of the scroller so it holds still while the roster moves, which
 * puts it out of reach of `body.querySelector` AND out of reach of the body's
 * delegated click listener — it has its own. These three helpers are the whole
 * difference; every assertion below reads the same things it always did.
 *
 * ==> THE PRESS GOES THROUGH THE STEPPER'S OWN ELEMENT. <== Firing at the body
 * would be testing the suite's idea of the interaction rather than the
 * component's, which is the trap `tools/markup-dom.mjs`'s own notes describe. */
const stepper = (host) => host.querySelector('.seasons-year');
const stepBtn = (host, dir) =>
  host.querySelectorAll('[data-step]').find((b) => b.dataset.step === dir) || null;
const stepYear = (host) => host.querySelector('.seasons-year-now')?.textContent || '';
const pressStep = (host, dir) => stepper(host).fire('click', stepBtn(host, dir));

/* ==> THE STRENGTH AND THE LANDFALL MOVED OFF THE CHECKBOX AND ONTO THE ROW'S
 * OPEN BUTTON. §57.22b. <== The box now says only *"Draw KATRINA on the
 * globe"*, because that is the only thing it does; the button that opens the
 * storm carries what the storm IS. These cases are about which storms a filter
 * leaves on the list, so they read the button. */
const rowLabel = (body, r) =>
  body.querySelectorAll('.seasons-open')
    .find((b) => b.dataset.open === r.dataset.storm)?.attrs['aria-label'] || '';
const text = (body) => body.innerHTML;

/* ---------------------------------------------------------------------------
 * 1. IT OPENS ON A REAL SEASON AND NAMES IT.
 * ------------------------------------------------------------------------ */
{
  const { body, host, view, where } = await board();
  ok('the board opens on a season with storms in it', rows(body).length > 0);
  ok('and the bar is told where it is',
    where.some((w) => w && /Atlantic/.test(w.label)));
  /* ==> THE 175-YEAR `<select>` IS GONE AND THE STEPPER IS WHAT FOCUS LANDS
   * ON. <== §57.36 moved choosing a year to the wall. The assertion is kept
   * rather than deleted because what it was really guarding is that this view
   * has SOMETHING at the top to receive focus (§13) — a screen whose `focus()`
   * returns null drops the reader on the document body. */
  ok('the year stepper is there to focus', stepBtn(host, 'older') !== null);
  ok('and the year it is sitting on is drawn between the two buttons',
    /^\d{4}$/.test(stepYear(host)));
  /* ==> AND IT IS PINNED, NOT SCROLLED. <== Aaron, 2026-08-28. A stepper
   * inside the scroller walks off the top of the sheet on a long roster and
   * has to be hunted for after every press. `.drawer-body` is the scroller and
   * this asserts the control is a SIBLING of it rather than a descendant —
   * which is the whole mechanism, since `.drawer-view` is a flex column and
   * only the body flexes. Moving it back inside makes this fail. */
  ok('and the stepper is pinned outside the scrolling body',
    stepper(host) !== null && body.querySelector('.seasons-year') === null);

  /* ==> AND THE HEADER NAMES THE BASIN, NOT THE YEAR. §57.39a. <== Aaron on
   * glass 2026-08-28: the header said `2020` and the picker one line below
   * said `2020`, at nearly the same size. Of the two the header gave way, so
   * the sheet reads basin-then-year the way the live drawer reads name-then-
   * position. Four digits appearing up there again is the duplication coming
   * back, so this asserts their ABSENCE as well as the basin's presence —
   * checking only for "Atlantic" would pass on "Atlantic 2005". */
  ok('the header names the basin', /Atlantic/.test(view.titleFor()));
  ok('and does not repeat the year the stepper is already showing',
    !/\d{4}/.test(view.titleFor()));
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
  const { body, host, drawn, where } = await board({ year: 2005 });
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
 * 5. ==> A FILTER NARROWS THE LIST, AND CLEARS THE GLOBE WITH IT. <==
 *
 * §57.21b item 5, Aaron's call 2026-08-25, and it REVERSES what this case
 * asserted until then. The old rule kept a ticked storm across a filter change
 * on the argument that a filter narrows what the roster SHOWS and must not
 * un-choose anything. What it produced was a globe drawing storms the list in
 * front of you does not contain. The case that the rule was written to stop —
 * the roster and the globe disagreeing — is now prevented from the other side:
 * they are emptied together.
 *
 * What this case still guards on its own is the NARROWING, which did not
 * change.
 * ------------------------------------------------------------------------ */
{
  const { body, host, drawn, where } = await board({ year: 2005 });

  const weak = rows(body).find((r) => rowLabel(body, r).includes('TS'));
  ok('2005 has a tropical storm to tick', !!weak);
  weak.checked = true;
  body.fire('change', weak);
  const after = drawn[drawn.length - 1];
  eq('one storm is on the globe', after.length, 1);

  const majors = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'majors');
  body.fire('click', majors);

  eq('==> AND THE GLOBE IS EMPTIED IN THE SAME BEAT. <== A wipe that waited '
    + 'for the next poll would look exactly like the tracks failing to draw',
  drawn[drawn.length - 1], []);
  ok('the roster is now shorter', rows(body).length < 31);
  ok('and every remaining row is a major',
    rows(body).every((r) => /Cat [345]/.test(rowLabel(body, r))));

  const all = body.querySelectorAll('[data-filter]').find((b) => b.dataset.filter === 'all');
  body.fire('click', all);
  const back = rows(body).find((r) => r.dataset.storm === weak.dataset.storm);
  ok('the storm is back on the widened list', back !== undefined);
  ok('and it is NOT ticked — a filter change is a clear, not a hide',
    back?.checked !== true);
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
    shown.every((r) => /landfall/.test(rowLabel(body, r))));
}

/* ---------------------------------------------------------------------------
 * 7. CHANGING YEAR CLEARS THE GLOBE BEFORE THE NEW ONE ARRIVES.
 *
 * ==> OTHERWISE THE BAR NAMES A YEAR THE GLOBE IS NOT SHOWING. <== 2005's
 * tracks left up while 1935 loads is the app contradicting itself for as long
 * as the fetch takes.
 * ------------------------------------------------------------------------ */
{
  const { body, host, drawn, where } = await board({ year: 2005 });
  const box = rows(body)[0];
  box.checked = true;
  body.fire('change', box);
  ok('something is drawn', drawn[drawn.length - 1].length === 1);

  pressStep(host, 'older');
  eq('the globe empties the moment the year changes', drawn[drawn.length - 1], []);
  await settle();
  eq('and the new season draws nothing on its own', drawn[drawn.length - 1], []);
  /* ==> READ OFF THE STEPPER AND OFF THE BAR, NOT OUT OF THE ROSTER. <== The
   * roster prints month and day without a year (§57.18), so `/2004/` over the
   * body only ever matched the picker that used to be inside it. Two
   * independent answers now: what the control says, and what the view told the
   * status pill. A step that moved one and not the other is the panel and the
   * globe disagreeing, which is what this suite is for. */
  eq('the stepper is now sitting on 2004', stepYear(host), '2004');
  ok('and the bar was told the same year',
    /2004/.test(where[where.length - 1]?.label || ''));
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
  const { body, host, where } = await board();

  eq('the board opens on the season in progress', where.at(-1)?.year, 2026);
  /* ==> THE `— this season` OPTION LABEL WENT WITH THE DROPDOWN. §57.36. <==
   * What it was guarding is that a reader looking at the season in progress is
   * TOLD it is in progress, rather than reading working numbers as settled
   * ones. That job is the scorecard's note, which says considerably more than
   * three words on an option ever did — and the moment of CHOOSING is now the
   * wall's pinned row, which is asserted in `tools/test-seasons-wall.mjs`. */
  ok('the board says these are working numbers for a season still running',
    /season still\s+running/.test(text(body)));
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
  const { body, host, where } = await board();

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
    /<span class="seasons-stat-n">—<\/span>\s*<span class="seasons-stat-k">Came ashore/.test(text(body)));
  ok('and it says where the marks come from instead',
    /Landfall marks\s+come with that reviewed record/.test(text(body)));
  ok('no row claims a landfall', !/made landfall/.test(text(body)));
}

{
  /* ==> AND THE FILTER COMES BACK ON A SETTLED YEAR. <== A control removed for
   * one season and never restored is the same bug wearing the opposite face. */
  freshLive();
  const { body, view } = await board();
  /* The wall's road in: it hands the board a year and the board loads it.
   * There is no in-board control that jumps 21 years any more. */
  view.setSeason(2005);
  await settle();

  const filters = body.querySelectorAll('[data-filter]').map((b) => b.dataset.filter);
  eq('a settled year offers all three again', filters, ['all', 'majors', 'landfalls']);
  ok('and its landfall count is a real number',
    /<span class="seasons-stat-n">\d+<\/span>\s*<span class="seasons-stat-k">Came ashore/.test(text(body)));

  /* ==> AND IT COUNTS STORMS, NOT COAST CROSSINGS. §57.39b. <== Aaron on glass
   * 2026-08-28. The cell used to print `score.landfalls`, which is every time a
   * centre crossed a coast — 2005 Atlantic is 22 storms and 45 crossings, and
   * the tile said 45 while the filter beside it listed 22 rows and the Wall of
   * Years said `22 of 31`. Both figures are real; only one answers a question
   * about a SEASON (§57.7a — counting crossings ranks archipelagos).
   *
   * ==> THE ASSERTION IS AGAINST THE ROSTER, NOT AGAINST A TYPED NUMBER. <==
   * Switching the cell back to crossings makes this fail, and so does any
   * arithmetic that drifts from the list the reader can count for themselves.
   * A literal here would only prove the cell still says what it said. */
  const ashore = Number(text(body).match(
    /<span class="seasons-stat-n">(\d+)<\/span>\s*<span class="seasons-stat-k">Came ashore/)?.[1]);
  const withMark = body.querySelectorAll('.seasons-open')
    .filter((b) => /made(\s+\d+)?\s+landfall/.test(b.attrs['aria-label'] || '')).length;
  eq('the cell counts storms that came ashore, not crossings', ashore, withMark);
  ok('and 2005 really does have more crossings than storms — or this proves nothing',
    withMark > 0 && withMark < 45);
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
  const { body, view } = await board();
  /* ==> THE BASIN SWITCH LEFT THIS SCREEN WITH THE YEAR PICKER. <== §57.36 —
   * the wall owns the basin, because changing it there happens while no year
   * is open. `setBasin` is the road the wall uses, and it is what this drives
   * now that there is no segment to press. */
  view.setBasin('epacific');
  await settle();
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
  const { body, host, where } = await board();

  ok('the board still opens on a settled year', where.at(-1)?.year === 2025);
  ok('and says the season still running could not be reached',
    /could not\s+be reached/.test(text(body)));
  ok('with a way to try again', /data-retry="live"/.test(text(body)));
  /* ==> WITH THE DROPDOWN GONE, "2026 IS NOT OFFERED" IS A FACT ABOUT THE
   * STEPPER. §57.36. <== Asserting that the string 2026 is absent from the
   * body passes trivially now that no list of years is drawn, which is a check
   * that can no longer fail. The observable is that there is nowhere newer to
   * step: 2025 is the newest year the board knows while the live index is
   * down. */
  ok('and there is nowhere newer to step to',
    stepBtn(host, 'newer')?.attrs.disabled !== undefined);

  /* The recovery actually recovers, and it does not disturb the year on
   * screen while doing it. */
  liveIndexFails = null;
  const retry = body.querySelectorAll('[data-retry]')[0];
  body.fire('click', retry);
  await settle();
  await settle();

  /* The recovery is observable as the step forward becoming possible again:
   * the season in progress is back in the years the board knows, so 2026 is
   * one press away. */
  ok('retrying puts the season in progress back within reach',
    stepBtn(host, 'newer')?.attrs.disabled === undefined);
  ok('and the year on screen did not change', where.at(-1)?.year === 2025);
}

/* ---------------------------------------------------------------------------
 * ==> SELECTION. §57.21 ITEM 2, §57.30 STEP 6. <==
 *
 * The board OWNS which storm is open in full detail. Everything here is about
 * the roster and the globe never being allowed to disagree about that — the
 * same rule the whole-set tick contract exists to keep, applied to the second
 * thing a reader can change.
 *
 * ==> AND THE FIRST ASSERTION IS THE INVERSE OF WHAT IT USED TO BE. <==
 * Ticking used to select. Aaron, 2026-08-25: a reader comparing four storms of
 * 2005 ticked four and watched three drop to ghosts, with whichever one they
 * happened to touch last arbitrarily bright. Checking now means "put this on
 * the globe" and nothing else.
 * ------------------------------------------------------------------------ */
{
  const { view, body, focus, drawn } = await board({ year: 2005 });
  const boxes = rows(body);
  const first = boxes[0];
  const second = boxes[1];

  first.checked = true;
  body.fire('change', first);
  ok('the globe was given the geometry', drawn.at(-1).includes(first.dataset.storm));
  eq('==> TICKING A STORM DOES NOT SELECT IT. <== Four ticks are four tracks, '
    + 'all equal — no storm is arbitrarily bright and no others are ghosted',
  focus.at(-1) ?? null, null);

  const focusedRow = () => body.querySelectorAll('.seasons-row-focus');
  eq('and no row is marked', focusedRow().length, 0);

  /* ==> ENTER ON A TICKED ROW IS THE KEYBOARD'S WAY IN. <== A pointer selects
   * by tapping the track on the globe, which a keyboard cannot reach at all.
   * Space already ticks the row's checkbox and Enter does nothing on a native
   * checkbox in any browser, so there is nothing for this to collide with. */
  body.fire('keydown', first, { key: 'Enter' });
  eq('Enter on a ticked row opens that storm', focus.at(-1), first.dataset.storm);
  eq('exactly one row is marked', focusedRow().length, 1);
  eq('and it is that storm\'s row', focusedRow()[0].dataset.row, first.dataset.storm);
  eq('screen readers are told which one, in the ordinary way',
    focusedRow()[0].getAttribute('aria-current'), 'true');

  /* ==> AND IT TOGGLES, WHICH IS THE KEYBOARD'S WAY BACK OUT. <== Tapping open
   * water is unreachable without a pointer. */
  body.fire('keydown', first, { key: 'Enter' });
  eq('Enter again on the open storm closes it', focus.at(-1), null);
  eq('no row is marked', focusedRow().length, 0);

  /* ==> ENTER ON AN UNTICKED ROW DOES NOTHING. <== The globe only draws ticked
   * storms, so this would dim every visible track for a storm not on screen. */
  body.fire('keydown', second, { key: 'Enter' });
  eq('Enter on a storm that is not on the globe is refused',
    focus.at(-1) ?? null, null);

  /* ==> AND "NOTHING" MEANS NOTHING, NOT "CLOSE WHATEVER WAS OPEN". <== This
   * is the assertion the guard in `onKeydown` actually earns. Without it,
   * Enter on an unticked row reaches `setFocus`, which refuses the id and
   * resolves to null — so tabbing past a storm you did not tick and pressing
   * Enter would silently close the storm you were reading. A mutation removing
   * that guard passes every other test in this block. */
  first.checked = true;
  body.fire('change', first);
  body.fire('keydown', first, { key: 'Enter' });
  eq('with one storm open', focus.at(-1), first.dataset.storm);
  body.fire('keydown', second, { key: 'Enter' });
  eq('Enter on an UNTICKED row leaves the open storm alone',
    focus.at(-1), first.dataset.storm);
  body.fire('keydown', first, { key: 'Enter' });
  eq('closed again', focus.at(-1), null);
  first.checked = false;
  body.fire('change', first);

  /* Selection MOVES rather than accumulating. */
  second.checked = true;
  body.fire('change', second);
  body.fire('keydown', first, { key: 'Enter' });
  body.fire('keydown', second, { key: 'Enter' });
  eq('opening a second storm moves the selection to it',
    focus.at(-1), second.dataset.storm);
  eq('and still exactly one row is marked', focusedRow().length, 1);
  eq('the first row let go of it', focusedRow()[0].dataset.row, second.dataset.storm);

  /* Unticking any OTHER storm must not touch the selection. */
  first.checked = false;
  body.fire('change', first);
  eq('unticking a storm that was not open leaves the selection alone',
    focus.at(-1), second.dataset.storm);

  second.checked = false;
  body.fire('change', second);
  eq('==> UNTICKING THE OPEN STORM CLOSES IT. <== A selection left on a storm '
    + 'that is no longer drawn would ghost every visible track in favour of '
    + 'one nobody can see', focus.at(-1), null);
  eq('no row is marked', focusedRow().length, 0);
}

/* ---------------------------------------------------------------------------
 * FOCUS: THE OTHER THREE DOORS — the globe, the button, and a year change.
 * ------------------------------------------------------------------------ */
{
  const { view, body, focus } = await board({ year: 2005 });
  const boxes = rows(body);
  const id = boxes[0].dataset.storm;

  /* ==> A TAP ON THE GLOBE COMES IN HERE, NOT STRAIGHT TO THE MAP. <== The
   * roster has to agree with what is bright, so `seasons/index.js` routes the
   * tap through the view rather than calling the globe directly. */
  boxes[0].checked = true;
  body.fire('change', boxes[0]);
  eq('ticking alone leaves nothing selected', focus.at(-1) ?? null, null);

  view.setFocus(id);
  eq('a tap on a drawn track opens it', focus.at(-1), id);
  eq('the roster follows the globe, not just the other way round',
    body.querySelectorAll('.seasons-row-focus').length, 1);

  view.setFocus(null);
  eq('a tap on open water closes it', focus.at(-1), null);

  /* ==> A FOCUS NOBODY HAS TICKED IS REFUSED, NOT HONOURED. <== The globe only
   * draws ticked storms. Lighting an unticked one would dim every visible
   * track for a highlight that is not on screen — which reads as the archive
   * breaking rather than as emphasis. */
  view.setFocus('AL991899');
  eq('an id nobody has ticked clears rather than lights an invisible storm',
    focus.at(-1), null);

  /* THE KEYBOARD'S WAY OUT. Tapping ocean is unreachable without a pointer, so
   * Enter on the open storm carries the same action (§13). */
  view.setFocus(id);
  body.fire('keydown', boxes[0], { key: 'Enter' });
  eq('Enter on the open storm closes it', focus.at(-1), null);

  /* A year change wipes the ticks, and the focus has to go with them: ids do
   * not repeat across seasons, so one left standing would ghost every track in
   * the new year in favour of a storm that is not in it. */
  view.setFocus(id);
  view.setSeason(1935);
  await settle();
  await settle();
  eq('changing the year drops the focus with the ticks', focus.at(-1), null);
  eq('and nothing in the new season is marked',
    body.querySelectorAll('.seasons-row-focus').length, 0);
}

/* ---------------------------------------------------------------------------
 * A FILTER CHANGE CLEARS THE CHECKS, AND THE GLOBE EMPTIES WITH THEM.
 *
 * ==> THIS REVERSES WHAT THIS SUITE ASSERTED UNTIL 2026-08-25. <== §57.21b
 * item 5, Aaron's call. The old rule was that a filter narrows what the roster
 * SHOWS and must not un-choose a storm the reader deliberately ticked. What
 * that produced was a globe carrying tracks the list in front of you does not
 * contain — switch to Majors and three tropical storms stay drawn with no row
 * to point at, which is the panel and the map disagreeing, arriving from the
 * other side of the rule written to prevent it.
 *
 * The clearing has to be VISIBLE: `onSelection` fires with an empty set in the
 * same beat, because a wipe that waited for the next poll would look exactly
 * like the tracks having failed to draw (§5).
 * ------------------------------------------------------------------------ */
{
  const { body, drawn, focus } = await board({ year: 2005 });

  const filterBtn = (id) => body.querySelectorAll('[data-filter]')
    .find((n) => n.dataset.filter === id);

  const first = rows(body)[0];
  first.checked = true;
  body.fire('change', first);
  const id = first.dataset.storm;
  body.fire('keydown', first, { key: 'Enter' });
  eq('a storm is ticked and open before the filter moves', focus.at(-1), id);
  eq('and the globe has it', drawn.at(-1), [id]);

  body.fire('click', filterBtn('majors'));

  eq('==> CHANGING A FILTER CLEARS THE CHECKS. <== A globe drawing storms the '
    + 'roster is not showing is the panel and the map disagreeing',
  drawn.at(-1), []);
  eq('the selection goes with them, because a focus nobody has ticked would '
    + 'ghost every remaining track for a storm that is not on the globe',
  focus.at(-1), null);
  eq('and no row comes back marked',
    body.querySelectorAll('.seasons-row-focus').length, 0);
  ok('nothing on the narrowed list is ticked either',
    rows(body).every((n) => n.checked !== true));

  body.fire('click', filterBtn('all'));
  eq('widening again does not bring the old ticks back — a filter change is '
    + 'a clear, not a hide', drawn.at(-1), []);
}

/* ---------------------------------------------------------------------------
 * THE MASTER CHECKBOX, AND FOCUS SURVIVING A REBUILD OF THE ROWS.
 *
 * ==> TWO THINGS IN ONE CASE BECAUSE THE MASTER BOX IS NOW THE ONLY REBUILD
 * THAT KEEPS A SELECTION. <== A filter change used to be how this suite proved
 * `render()` re-applies the focus class, and as of the case above it clears the
 * focus instead. Ticking everything from the master box rebuilds the roster
 * wholesale AND leaves the open storm ticked, so it is the trigger that still
 * exercises the repaint. Without it the reader opens a storm, presses the
 * master box, and the list comes back unmarked while the globe still has that
 * track bright.
 *
 * ==> AND THE MASTER BOX WORKS ON THE FILTERED LIST, WHICH IS THE
 * SPREADSHEET'S RULE. <== §57.21b item 4. Reaching past the filter would put
 * storms on the globe the roster is not showing.
 * ------------------------------------------------------------------------ */
{
  const { view, body, drawn, focus } = await board({ year: 2005 });

  const master = () => body.querySelector('[data-check-all]');
  const filterBtn = (id) => body.querySelectorAll('[data-filter]')
    .find((n) => n.dataset.filter === id);

  ok('the roster carries a master box', master() !== null);
  eq('empty to start, because nothing is ticked', master().checked, false);
  eq('and not the middle state either', master().indeterminate, false);

  const first = rows(body)[0];
  first.checked = true;
  body.fire('change', first);
  const id = first.dataset.storm;
  body.fire('keydown', first, { key: 'Enter' });
  eq('one storm is open', focus.at(-1), id);
  eq('==> SOME BUT NOT ALL PUTS THE MASTER BOX IN THE MIDDLE STATE. <== '
    + 'A spreadsheet says so with a bar and a reader already knows what it '
    + 'means; an empty box would say nothing is drawn, which is false',
  master().indeterminate, true);
  eq('and it says so to a screen reader too', master().getAttribute('aria-checked'), 'mixed');

  const all = rows(body).length;
  body.fire('change', master());

  eq('pressing it ticks every storm on the list', drawn.at(-1).length, all);
  eq('the box is now full', master().checked, true);
  eq('and no longer mixed', master().indeterminate, false);
  eq('==> AFTER A REBUILD THE OPEN STORM IS STILL MARKED. <== `render()` '
    + 'replaces every node, so the class has to be re-applied or the roster '
    + 'silently stops agreeing with the globe',
  body.querySelectorAll('.seasons-row-focus').length, 1);
  eq('and on the right storm',
    body.querySelectorAll('.seasons-row-focus')[0]?.dataset?.row, id);
  eq('the globe was never told the selection changed, because it did not',
    focus.at(-1), id);

  body.fire('change', master());
  eq('pressing a full box clears the list', drawn.at(-1), []);
  eq('and the selection goes with it, because it is no longer ticked',
    focus.at(-1), null);

  /* Narrow, then fill. The count has to be the NARROWED one. */
  body.fire('click', filterBtn('majors'));
  const majors = rows(body).length;
  ok('2005 has fewer majors than storms', majors < all);
  body.fire('change', master());
  eq('the master box ticks what is SHOWN, not the whole season',
    drawn.at(-1).length, majors);
  /* ==> AND THE BOX HAS TO LOOK FULL, WHICH IS A SECOND COUNT IN A SECOND
   * PLACE. <== The line above proves the HANDLER narrowed; this proves the
   * PAINT did. They are different code — `onChange` counts the filtered rows
   * to decide what to tick, and `paintCheckAll` counts them again to decide
   * what the box should show — so a paint that reached past the filter would
   * leave the box stuck in the middle state over a list where every row is
   * ticked, with the handler behaving perfectly. Found by mutation on
   * 2026-08-25: blinding the paint's count to the filter left this whole
   * section green, which is the failure §12 calls worse than no test. */
  eq('and the box PAINTS as full, counting the narrowed list and not the season',
    master().checked, true);
  eq('so it is not left in the middle state over a fully ticked list',
    master().indeterminate, false);
  /* ==> AND THE MIDDLE STATE SURVIVES A REBUILD, WHICH IS THE HALF THE MARKUP
   * CANNOT CARRY. <== `checked` is an attribute and comes back with the
   * roster; `indeterminate` is a property and does not. Re-entering the board
   * from the bar is the real path — the reader closes it, the globe still has
   * their storms on it, and they open it again. Without the repaint the master
   * box comes back EMPTY over a globe with tracks on it. */
  body.fire('change', master());
  const one = rows(body)[0];
  one.checked = true;
  body.fire('change', one);
  view.onEnter();
  eq('after a rebuild the master box is still in the middle state',
    master().indeterminate, true);
  eq('and still says so to a screen reader',
    master().getAttribute('aria-checked'), 'mixed');
}

/* ---------------------------------------------------------------------------
 * A TAP ON A TRACK SCROLLS THE ROSTER TO THAT STORM'S ROW.
 *
 * ==> §57.21b ITEM 6, AND THE FAILURE IT FIXES IS SILENT. <== Tapping a track
 * already marked the row; it did not bring it into view, and with a 28-row
 * roster the marked row is usually off-screen — so the globe lit a storm up
 * and the panel looked like nothing had happened.
 * ------------------------------------------------------------------------ */
{
  const { view, body } = await board({ year: 2005 });

  /* A storm well down the list, so the case is a real scroll rather than one
   * that would have been on screen anyway. */
  const list = rows(body);
  const target = list[list.length - 1];
  target.checked = true;
  body.fire('change', target);
  const id = target.dataset.storm;

  view.setFocus(id);

  const row = body.querySelectorAll('.seasons-row-focus')[0];
  ok('the row is marked', row !== undefined);
  ok('==> AND IT WAS BROUGHT INTO VIEW. <== A marked row the reader cannot '
    + 'see is the panel and the map disagreeing',
  row?.scrolledIntoView !== undefined);
  eq('no further than it has to be — a row already on screen must not be '
    + 'yanked out from under a thumb on a repaint',
  row?.scrolledIntoView?.block, 'nearest');
}

/* ---------------------------------------------------------------------------
 * THE CHEVRON, AND THE STORM PANEL'S WAY BACK TO THE GLOBE. §57.22b.
 *
 * ==> THIS IS THE MARKUP THAT WAS UNDER SUSPICION FOR A DAY. <== Step 7 added
 * a per-row `<button>`, glass reported every tap target in the drawer
 * misbehaving, and the whole step was reverted with the cause unknown. The row
 * was then rebuilt from scratch and confirmed on glass, which cleared it. What
 * this suite can prove is the part a browser is not needed for: that the
 * chevron does its own job and NOT the label's.
 * ------------------------------------------------------------------------ */
{
  const { view, body, opened, focus, drawn } = await board({ year: 2005 });
  const first = rows(body)[0];
  const id = first.dataset.storm;
  const chevron = body.querySelector(`[data-open="${id}"]`);

  ok('every row carries a button that opens the storm', chevron !== null);
  ok('and it is a real button, so Tab reaches it and Enter presses it (§13)',
    String(chevron?.tagName || '').toLowerCase() === 'button');
  ok('named for a screen reader, because a bare chevron is a control called '
    + 'nothing', /^Open /.test(chevron?.getAttribute('aria-label') || ''));

  /* ==> THE ROW IS THE DOOR, NOT JUST THE CHEVRON. <== Aaron on glass,
   * 2026-08-25. The name, the badge and the dates are all inside the button,
   * so a tap anywhere across the row opens the storm — the chevron is the
   * glyph on the end of it rather than a control of its own. */
  ok('the storm\u2019s NAME is inside that button, so tapping the row opens it',
    chevron?.querySelectorAll?.('.seasons-name').length === 1);
  ok('and so are the dates, so there is no inert strip in the middle of a row',
    chevron?.querySelectorAll?.('.seasons-when').length === 1);
  eq('there is exactly ONE open control per row, not a row and a chevron both',
    body.querySelectorAll('.seasons-open').length, rows(body).length);

  /* ==> IT SITS OUTSIDE THE `<label>`, AND THAT IS THE ASSERTION. <== Nested
   * inside, every press would ALSO toggle the checkbox it was nested in,
   * because that is a label's whole job — so opening a storm would silently
   * draw or undraw its track on the way past. The markup cannot say this in a
   * comment and be believed; this says it. */
  ok('==> AND IT IS NOT INSIDE THE ROW\'S LABEL. <== Nested there, opening a '
    + 'storm would silently tick or untick it on the way past',
  chevron?.closest?.('label') == null);

  /* ==> AND THE TICK BOX IS STILL ITS OWN CONTROL. <== A reader comparing four
   * storms on the globe must be able to draw one without a panel opening. */
  const box = body.querySelector(`[data-storm="${id}"]`);
  ok('the checkbox is not inside the open button', box?.closest?.('.seasons-open') == null);
  ok('and it says only what it does \u2014 draw the storm', 
    /^Draw /.test(box?.getAttribute('aria-label') || ''));

  const before = drawn.length;
  body.fire('click', chevron);
  eq('pressing it asks the caller to open that storm', opened.at(-1), id);
  eq('and the board itself does not tick anything on the press — the panel '
    + 'owns that, so there is one path rather than two', drawn.length, before);

  /* ==> `showStorm` IS WHAT MAKES THE GLOBE AGREE, AND `setFocus` ALONE
   * CANNOT. <== `setFocus` refuses an id nobody has ticked, on purpose. The
   * first version of step 7 routed the panel's `onOpen` straight at it, so
   * opening an unticked storm would have drawn a panel full of Katrina's
   * figures over a globe with no Katrina on it. */
  eq('nothing is drawn yet', drawn.at(-1) ?? [], []);
  view.showStorm(id);
  ok('==> OPENING AN UNTICKED STORM DRAWS IT. <== A panel about a storm the '
    + 'globe is not showing is the panel and the map disagreeing',
  (drawn.at(-1) || []).includes(id));
  eq('and focuses it, so it is the bright one', focus.at(-1), id);
  eq('the row\'s own box is ticked to match, so Back lands on a roster that '
    + 'agrees with the globe', body.querySelector(`[data-storm="${id}"]`).checked, true);

  /* Opening a storm that is ALREADY ticked must not re-push a season's worth
   * of geometry — focus is a repaint and a tick is a rebuild (§57.21). */
  const settled = drawn.length;
  view.showStorm(id);
  eq('opening it again pushes no new geometry', drawn.length, settled);

  /* A storm this season does not hold is refused rather than half-applied. */
  view.showStorm('AL011851');
  eq('a storm the season does not hold changes nothing', drawn.length, settled);
  eq('and does not steal the focus', focus.at(-1), id);
}

/* ---------------------------------------------------------------------------
 * ==> THE FAULT THAT KILLED STEP 7, REPRODUCED AND THEN FIXED. §57.22b. <==
 *
 * Aaron on glass, 2026-08-25: *"pretty much anywhere I touch closes the drawer
 * or does something I don't intend."* The cause was `closest('[data-open]')`
 * in the board's click handler. **`#drawer` carries `data-open="true"`** —
 * `ui/drawer.js` publishes the sheet's open state there — and the board's
 * body is inside it, so any click no earlier branch claimed walked up past the
 * roster, matched THE SHEET, and the board asked to open a storm called
 * `true`. The panel then said *"That storm is not in this season."*
 *
 * **NOTHING COULD HAVE CAUGHT THIS BEFORE, BECAUSE THE SUITE MOUNTED THE BOARD
 * IN A BARE `div` WITH NO PARENT.** `closest` had nowhere to walk. The harness
 * now reproduces the drawer's real chrome above the view, which is the only
 * shape in which a selector escaping its own view is visible at all.
 * ------------------------------------------------------------------------ */
{
  const { body, drawer, opened, drawn, focus } = await board({ year: 2005 });

  eq('the harness really does put the sheet above the board, or this proves '
    + 'nothing', drawer.dataset.open, 'true');
  ok('and the board\u2019s body really is inside it',
    body.closest('#drawer') === drawer);

  /* Inert text: the roster's own heading area, which is not a control and must
   * not behave like one. */
  const inert = body.querySelector('.seasons-roster') || body;
  body.fire('click', inert);
  eq('==> A TAP ON INERT ROSTER SPACE OPENS NOTHING. <== It used to resolve to '
    + 'the DRAWER\u2019S OWN data-open and ask for a storm called "true"',
  opened.length, 0);
  eq('and draws nothing', drawn.at(-1) ?? [], []);
  eq('and focuses nothing', focus.at(-1) ?? null, null);

  /* The scorecard: real markup, no handler of its own, well inside the sheet. */
  const score = body.querySelector('.seasons-score');
  if (score) {
    body.fire('click', score);
    eq('nor does a tap on the scorecard', opened.length, 0);
  }

  /* ==> AND THE ONE THING THAT MUST STILL WORK. <== A scoped selector that
   * matched nothing would pass every assertion above and break the feature. */
  const btn = body.querySelectorAll('.seasons-open')[0];
  body.fire('click', btn);
  eq('but a tap on a row still opens that row\u2019s storm',
    opened.at(-1), btn.dataset.open);
  ok('and never the string the drawer would have handed it',
    opened.every((x) => x !== 'true'));
}

/* ---------------------------------------------------------------------------
 * A STORM THAT IS STILL HAPPENING STAYS ON THE ROSTER AND OFF THE GLOBE.
 * §57.21c, Aaron's item 1.
 *
 * ==> THE RULE IS THE LIVE APP'S, NOT A CLOCK'S. <== `liveRunningIds` is
 * injected by main.js and built on the same `noCurrentReading` that greys a
 * storm dot on the live globe. Here it is a switch, because what this suite
 * owns is what the BOARD does with the answer — that main.js computes the
 * answer correctly is `tools/test-lifecycle.mjs`'s job.
 * ------------------------------------------------------------------------ */

{
  freshLive();
  /* ==> A REAL 2026 FIXTURE, AND AN ATLANTIC ONE BECAUSE THAT IS THE BASIN THE
   * BOARD OPENS ON. <== Bertha, AL022026, out of `samples/seasons-live/`.
   *
   * The set is LOWERCASE and the roster's id is UPPERCASE (`AL022026`), which
   * is not an accident of this fixture — `/api/seasons/live` keys off NOAA's
   * b-deck filenames and the parser upper-cases what it emits. The join has to
   * survive that, so driving it with a matching case would prove nothing. */
  liveRunning = new Set(['al022026']);
  const { body, drawn, view, focus } = await board({ year: 2026 });

  const running = rows(body).find((r) => r.dataset.storm === 'AL022026');
  ok('a still-running storm is STILL ON THE ROSTER \u2014 it is not hidden', !!running);

  if (running) {
    const box = body.querySelectorAll('input[type="checkbox"]')
      .find((b) => b.dataset.storm === 'AL022026');
    ok('  its checkbox is present but DISABLED', !!box && box.attrs.disabled != null);
    /* ==> PRESENT, NOT ABSENT, AND THAT WAS A DELIBERATE CALL. <== A row
     * silently missing a control every other row has reads as a rendering
     * fault rather than as a rule, so the box stays and the reason rides in
     * its label. */
    ok('  and the reason is in the label, not left to be guessed',
      /active|still|running/i.test(box?.attrs['aria-label'] || ''));
  }

  ok('the date cell keeps the START date beside the word',
    /\u2013\s*active|- active/i.test(text(body)));

  /* ==> AND THE HALF THAT MATTERS: IT NEVER REACHES THE GLOBE. <== */
  const master = body.querySelector('[data-check-all]');
  if (master) {
    body.fire('change', master);
    await settle();
    const sel = drawn.at(-1) || [];
    ok('ticking EVERYTHING draws the rest of the season', sel.length > 0);
    ok('  and still never draws the running storm', !sel.includes('AL022026'));

    /* ==> AND ITS BOX MUST NOT COME BACK TICKED. <== The globe declining a
     * storm is only half the rule; a checkbox showing ticked over a globe
     * that is not drawing it is the roster and the map disagreeing, which is
     * the one failure this view is careful about everywhere. Deleting the
     * master box's own filter SURVIVED a test that only watched `drawn`,
     * because `selectedEntries` catches it downstream — the visible symptom
     * is here, on the row. */
    const after = body.querySelectorAll('input[type="checkbox"]')
      .find((b) => b.dataset.storm === 'AL022026');
    ok('  and its checkbox does not come back ticked either', !after?.checked);
  }

  /* ==> AND THE MASTER BOX COUNTS ONLY WHAT CAN BE DRAWN. <== Counting the
   * running storm in the total would make a fully-ticked list read as partial
   * forever: the bar could never fill and pressing the box could never show a
   * tick, which is a control whose state is unreachable. Asserted on the
   * rendered count rather than on behaviour, because that is where it shows. */
  const shownCount = body.querySelector('[data-check-all]')?.attrs['aria-label'] || '';
  const total = rows(body).length;
  ok(`the master box speaks for ${total - 1} drawable rows, not all ${total}`,
    new RegExp(`\\b${total - 1}\\b`).test(shownCount)
    && !new RegExp(`\\b${total}\\b`).test(shownCount));

  /* `showStorm` is the panel's way in and it ticks on the storm's behalf, so
   * it is a second door onto the globe that the disabled box does not close.
   *
   * ==> ASSERTED ON THE FOCUS, NOT ON WHAT IS DRAWN. <== The first version of
   * this checked `drawn`, and deleting showStorm's guard SURVIVED it —
   * `selectedEntries` drops the storm on the way out regardless, so the globe
   * looked right whether the guard existed or not. The guard's real job is
   * stopping the FOCUS, which would ghost every visible track in favour of a
   * storm that is deliberately not on this globe. */
  const focusBefore = focus.at(-1) ?? null;
  view.showStorm('AL022026');
  await settle();
  ok('opening its panel does not tick it onto the globe',
    !(drawn.at(-1) || []).includes('AL022026'));
  eq('  and does not focus it, which would ghost everything else for nothing',
    focus.at(-1) ?? null, focusBefore);
  /* ==> THE ASSERTION THAT ACTUALLY CATCHES IT. <== `selectedEntries` and
   * `setFocus` both refuse a running storm on their own, so removing
   * showStorm's guard changes nothing about the globe and a test watching
   * `drawn` or `focus` stays green. What it DOES change is `ticked` — the row
   * paints a tick for a storm the globe is declining, and the reader believes
   * the checkbox. */
  const boxAfterShow = body.querySelectorAll('input[type="checkbox"]')
    .find((b) => b.dataset.storm === 'AL022026');
  ok('  and above all does not tick its box behind the reader\u2019s back',
    !boxAfterShow?.checked);
}

{
  /* ==> A STORM CAN GO FROM FINISHED TO RUNNING UNDER A TICK THAT IS ALREADY
   * SET, AND THAT IS WHY THE FILTER IS IN `selectedEntries` AND NOT ONLY ON
   * THE CHECKBOX. <== The archive can be open for an hour. The disabled box
   * stops a reader ticking a running storm; it does nothing about one ticked
   * while it was finished.
   *
   * The first version of this suite could not see that at all: every path it
   * drove went through the master box, which filters running storms out before
   * ticking, so deleting the guard in `selectedEntries` left it green. */
  freshLive();
  liveRunning = new Set();
  const { body, drawn } = await board({ year: 2026 });

  const box = body.querySelectorAll('input[type="checkbox"]')
    .find((b) => b.dataset.storm === 'AL022026');
  box.checked = true;
  body.fire('change', box);
  await settle();
  ok('a finished storm ticks onto the globe', (drawn.at(-1) || []).includes('AL022026'));

  /* NHC files another advisory on it. Nothing about the record changed and
   * nothing on screen was touched — only what the live app is publishing. */
  liveRunning = new Set(['al022026']);
  const other = body.querySelectorAll('input[type="checkbox"]')
    .find((b) => b.dataset.storm === 'AL012026');
  other.checked = true;
  body.fire('change', other);
  await settle();
  ok('  and the moment it starts running again it leaves the globe',
    !(drawn.at(-1) || []).includes('AL022026'));
  ok('  while the storm ticked beside it is unaffected',
    (drawn.at(-1) || []).includes('AL012026'));
}

{
  /* ==> THE STORM FINISHES AND THE SAME ROW BECOMES DRAWABLE. <== The whole
   * point of tying this to the live app rather than to a clock: nothing about
   * the record changed, only what NHC is still publishing. */
  freshLive();
  liveRunning = new Set();
  const { body, drawn } = await board({ year: 2026 });
  const box = body.querySelectorAll('input[type="checkbox"]')
    .find((b) => b.dataset.storm === 'AL022026');
  ok('with nothing running, that same storm\u2019s box is enabled',
    !!box && box.attrs.disabled == null);
  if (box) {
    /* The stand-in does not flip `checked` for us — the browser does that, and
     * the view reads it — so the suite sets it the way every other tick case
     * here does. */
    box.checked = true;
    body.fire('change', box);
    await settle();
    ok('  and it draws', (drawn.at(-1) || []).includes('AL022026'));
  }
  ok('and no row says "active" any more', !/\u2013\s*active/i.test(text(body)));
}

{
  /* ==> AN EMPTY SET AND A NULL ARE OPPOSITE FACTS. §5. <== Empty means the
   * feed answered and nothing is running. Null means it has never answered —
   * a deep link landing before the first poll — and the honest reading of
   * "we cannot ask" is not "everything has finished". The board falls back to
   * the b-deck age test, which is the only case that test still serves.
   *
   * The fixtures are archived bytes from August 2026 and this suite runs
   * whenever it runs, so the fallback marks nothing active by now. What is
   * asserted is that the board did not CRASH and did not throw the season
   * away — the distinction itself is asserted in test-lifecycle.mjs, where
   * the answer is computed. */
  freshLive();
  liveRunning = null;
  const { body } = await board({ year: 2026 });
  ok('a live feed that has never answered still renders a roster',
    rows(body).length > 0);
}


/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n✗ ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} assertions pass — the board against real season files`);
