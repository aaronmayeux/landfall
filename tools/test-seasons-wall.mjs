/**
 * test-seasons-wall.mjs — the Wall of Years, against the real index.
 * SPEC-SEASONS-BUILD.md §57.29, §57.36, §57.30 step 14.
 *
 * ==> IT READS `seasons/wall.json` AS SHIPPED, NEVER A FIXTURE. <== The file in
 * this repo is what a reader downloads, and the whole feature is arithmetic
 * over it: how many storms a year held, how strong the worst got, which years
 * are empty. A hand-written fixture would inherit whatever the test author
 * assumed those were and pass on the same wrong assumption as the code —
 * the failure SPEC.md §12 calls worse than no test.
 *
 * ==> AND THE FIELD POSITIONS ARE ASSERTED ACROSS THE TWO FILES THAT NAME
 * THEM. <== `tools/seasons-wall.mjs` writes four numbers a storm and
 * `lib/wall-index.js` reads them back. An off-by-one there reads landfall as
 * category: every dot the wrong colour, nothing thrown, nothing to notice.
 *
 * Zero dependencies. `node tools/test-seasons-wall.mjs`
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseBdeck } from '../lib/hurdat.js';
import { stormFacts } from '../lib/season-facts.js';

import { CAT, LANDFALL, ACE, PEAK_KT, DAYS, PRESSURE_MB, NAME, dotSizeFor, liveRow, rowsFor, rowLabel, SATELLITE_ERA_FROM }
  from '../lib/wall-index.js';
import * as gen from './seasons-wall.mjs';
import { SEASONS } from '../config/constants.js';
import { El, installMarkupDocument } from './markup-dom.mjs';

/* The same hand-rolled stand-in `tools/test-seasons-board.mjs` uses, and for
 * the same reason: the view builds html strings and reads them back, so what
 * it needs is a parser and `closest`, not a browser. Installed BEFORE the view
 * is imported — it touches `document` at module scope. */
installMarkupDocument();
const { createSeasonsWallView } = await import('../ui/view-seasons-wall.js');

let passed = 0;
const failures = [];
const ok = (what, cond) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failures.push(what); console.log(`  FAIL  ${what}`); }
};
const eq = (what, got, want) => ok(`${what} — got ${JSON.stringify(got)}`,
  JSON.stringify(got) === JSON.stringify(want));
const section = (t) => console.log(`\n${t}`);

const wall = JSON.parse(readFileSync(new URL('../seasons/wall.json', import.meta.url), 'utf8'));

/* ---------------------------------------------------------------------------
 * 1. THE TWO FILES THAT NAME THE FIELD POSITIONS AGREE.
 * ------------------------------------------------------------------------ */
section('1. The generator and the reader index the same columns');

eq('category is column 0', [gen.CAT, CAT], [0, 0]);
eq('landfall is column 1', [gen.LANDFALL, LANDFALL], [1, 1]);
eq('ace is column 2', [gen.ACE, ACE], [2, 2]);
eq('peak wind is column 3', [gen.PEAK_KT, PEAK_KT], [3, 3]);
/* Step 3's three. `lib/wall-index.js` names them for the browser and
 * `tools/seasons-wall.mjs` names them for the runner, and an off-by-one here
 * reads a pressure as a duration — every threshold filter silently wrong, with
 * nothing thrown and nothing on screen to notice. */
eq('days is column 4', [gen.DAYS, DAYS], [4, 4]);
eq('pressure is column 5', [gen.PRESSURE_MB, PRESSURE_MB], [5, 5]);
eq('name is column 6', [gen.NAME, NAME], [6, 6]);
eq('and the file says so itself', wall.fields,
  ['category', 'landfalls', 'ace', 'peakWindKt', 'days', 'pressureMb', 'name']);

/* ---------------------------------------------------------------------------
 * 2. THE REAL RECORD, AT NUMBERS THAT CAN BE CHECKED AGAINST NOAA.
 * ------------------------------------------------------------------------ */
section('2. Real seasons, real counts');

const atl = rowsFor(wall, 'atlantic');

eq('the Atlantic wall runs newest first', [atl[0].year > atl[1].year, atl[0].year], [true, 2025]);
eq('and it reaches back to 1851', atl.at(-1).year, 1851);
eq('175 seasons, one row each', atl.length, 175);

const y2005 = atl.find((r) => r.year === 2005);
eq('2005 held 31 storms', y2005.total, 31);
eq('and its strongest was a Cat 5', y2005.strongest, 6);

/* ==> A YEAR WITH ONE STORM IS THE CASE A COUNTING BUG HIDES IN. <== 1914 is
 * the Atlantic's quietest recorded season and it is a real one, not a gap. A
 * generator that dropped a storm at a file boundary would turn a neighbouring
 * year into this and nothing on screen would say so. */
const y1914 = atl.find((r) => r.year === 1914);
eq('1914 held exactly one storm', y1914.total, 1);
ok('and it is not treated as quiet', y1914.shown.length === 1);

/* ---------------------------------------------------------------------------
 * 3. §5 — A QUIET YEAR AND A MISSING YEAR ARE DIFFERENT ANSWERS.
 * ------------------------------------------------------------------------ */
section('3. Every year between the first and last has a row');

const years = atl.map((r) => r.year);
const gaps = [];
for (let y = 1851; y <= 2025; y++) if (!years.includes(y)) gaps.push(y);
eq('no year between 1851 and 2025 is missing from the file', gaps, []);

eq('fillGaps puts an empty array against an absent year',
  gen.fillGaps({ 1990: [[1, 0, 1, 50]], 1992: [] })[1991], []);

/* ---------------------------------------------------------------------------
 * 4. ACE — NOT MEASURABLE IS NOT ZERO.
 * ------------------------------------------------------------------------ */
section('4. An unmeasurable ACE does not sort as nought');

const fake = {
  basins: { t: { years: {
    1900: [[null, 0, null, null], [null, 0, null, null]],
    1901: [[1, 0, 0, 40]],
  } } },
};
const t = rowsFor(fake, 't');
const r1900 = t.find((r) => r.year === 1900);
const r1901 = t.find((r) => r.year === 1901);
eq('a season nobody could measure reports null ACE', r1900.ace, null);
eq('a season that earned none reports 0', r1901.ace, 0);
ok('and the two are distinguishable', r1900.aceMeasured === false && r1901.aceMeasured === true);

eq('an ungraded storm keeps a null category, never 0',
  gen.wallStorm({ peakCategory: null, landfalls: [], ace: null, peakWindKt: null })[gen.CAT], null);

/* ---------------------------------------------------------------------------
 * 5. THE DOT SCALE IS PER BASIN, NOT PER ROW.
 * ------------------------------------------------------------------------ */
section('5. One dot size across the whole wall');

const d = dotSizeFor(wall, 'atlantic', 300);
ok(`the busiest Atlantic season sets the scale (${d.widest} storms)`, d.widest === 31);
ok(`the dot is inside its bounds (${d.size}px)`,
  d.size >= SEASONS.wallDotMin && d.size <= SEASONS.wallDotMax);

/* A strip with no room at all still returns a drawable dot rather than 0 or a
 * negative radius, which SVG accepts silently and draws as nothing. */
ok('a zero-width strip still yields a visible dot',
  dotSizeFor(wall, 'atlantic', 0).size >= SEASONS.wallDotMin);

/* ==> AND A WIDE RAIL DOES NOT DRAW BEACH BALLS. <== Without the ceiling a
 * sparse basin on a desktop rail would make one quiet year louder than a busy
 * one, which inverts the only thing the screen says. */
ok('a very wide strip is capped',
  dotSizeFor({ basins: { t: { years: { 1900: [[1, 0, 1, 50]] } } } }, 't', 4000).size
    <= SEASONS.wallDotMax);

/* ---------------------------------------------------------------------------
 * 6. THE SPOKEN ROW CARRIES WHAT THE DOTS CARRY.
 * ------------------------------------------------------------------------ */
section('6. §13 — the strip is decoration and the label is the row');

const label2005 = rowLabel(y2005, { catLabel: (c) => `Category ${c}` });
ok(`2005 names its count and its strongest ("${label2005}")`,
  /2005/.test(label2005) && /31 storms/.test(label2005));
ok('and a modern year does NOT claim to be an undercount',
  !/undercount/.test(label2005));

const y1900 = atl.find((r) => r.year === 1900);
ok('a pre-satellite year says so out loud',
  /undercount/.test(rowLabel(y1900, { catLabel: (c) => `Category ${c}` })));

ok('a quiet year says no storms rather than nothing',
  /no storms recorded/.test(rowLabel({ year: 1800, shown: [], pre: true }, { catLabel: () => '' })));

eq('the era boundary is the one constant, not a literal',
  SATELLITE_ERA_FROM, SEASONS.satelliteEraFrom);

/* ---------------------------------------------------------------------------
 * 7. THE VIEW — THREE STATES, AND A FAILURE IS NOT AN EMPTY WALL.
 * ------------------------------------------------------------------------ */
section('7. §5 in the view');

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The season in progress, out of the REAL b-decks in `samples/seasons-live/`.
 *
 *  ==> INVENTED STORMS PASSED THIS SUITE WHILE THE VIEW DREW NOTHING. <== The
 *  first version of this fixture was three hand-written objects with a
 *  `peakCategory` on them. The view does not read a category off a storm — it
 *  runs `stormFacts` over the track, and `stormFacts` returns null for a storm
 *  with no fixes. So every dot silently vanished and the row reported no
 *  active storms, and the suite went green on both. Real bytes, or the fixture
 *  is testing the fixture. */
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = join(HERE, '..', 'samples', 'seasons-live');
const LIVE_STORMS = readdirSync(LIVE_DIR)
  .filter((f) => /^bal\d{6}\.dat$/i.test(f))
  .map((f) => parseBdeck(readFileSync(join(LIVE_DIR, f), 'utf8'),
    { id: f.replace(/^b|\.dat$/gi, '').toLowerCase() }).storm)
  .filter(Boolean)
  .sort((a, b) => (a.points[0]?.time ?? 0) - (b.points[0]?.time ?? 0));

const LIVE_FACTS = LIVE_STORMS.map(stormFacts).filter(Boolean);

/** The last one to form is the one left running, so the suite's "not drawn"
 *  case is a storm that really is in the file. */
const RUNNING_ID = String(LIVE_FACTS.at(-1).id).toLowerCase();

function mount({ wallResult, indexResult, liveIndex, liveSeason, running = null }) {
  const opened = [];
  const wheres = [];
  const view = createSeasonsWallView({
    seasons: {
      loadWall: async () => wallResult(),
      loadIndex: async () => indexResult(),
      basinsIn: (i) => Object.keys(i?.basins || {}),
      basinLabel: (i, b) => i?.basins?.[b]?.label || b,
    },
    live: {
      loadLiveIndex: async () => (liveIndex
        ? liveIndex()
        : { status: 'ok', year: 2026, storms: [] }),
      loadLiveSeason: async () => (liveSeason
        ? liveSeason()
        : { status: 'ok', storms: LIVE_STORMS, provisional: true }),
    },
    liveRunningIds: () => running,
    onOpenYear: (y, b) => opened.push([y, b]),
    onWhere: (w) => wheres.push(w),
  });
  /* Mounted inside the drawer's own chrome rather than as a bare div, which is
   * the fault `tools/test-seasons-board.mjs` records: `closest()` from an
   * unhandled click has to be able to walk PAST the view's body, or a selector
   * escaping the view is invisible to the suite. */
  const drawer = new El('aside');
  drawer.attrs.id = 'drawer';
  drawer.dataset.open = 'true';
  drawer.dataset.view = 'seasons-wall';
  const views = new El('div');
  views.parent = drawer;
  drawer.children.push(views);
  const host = new El('div');
  host.dataset.view = 'seasons-wall';
  host.parent = views;
  views.children.push(host);

  view.mount(host);
  /* ==> THE LISTENER IS ON THE BODY, SO THE EVENT HAS TO BE FIRED THERE. <==
   * Firing at the host reaches nothing and looks exactly like a button nobody
   * pressed — the same silent lie `markup-dom.mjs` records twice already. The
   * body is also the element whose `innerHTML` the view writes, so it is what
   * the text assertions read. */
  const body = host.querySelector('#seasons-wall-body');
  return { view, host, body, opened, wheres };
}

const index = {
  basins: {
    atlantic: { label: 'Atlantic' },
    epacific: { label: 'East Pacific' },
  },
};

{
  const m = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
  });
  await settle(); await settle();

  const rows = m.host.querySelectorAll('.wall-row');
  ok(`the wall drew rows (${rows.length})`, rows.length > 0);
  /* The pinned live row sits above the record and is not part of it (§57.11),
   * so the newest SETTLED year is the first row that is not it. */
  const settled = rows.filter((r) => r.dataset.live !== '1');
  ok('and the newest settled year is a real one', settled[0].dataset.year === '2025');
  ok('the tally is on screen under every combination',
    /seasons shown/.test(m.body.innerHTML));
  ok('the era line is drawn once', (m.body.innerHTML.match(/wall-era/g) || []).length === 1);

  /* ==> EVERY PRE-SATELLITE ROW CARRIES THE MARK, NOT JUST A BAND BEHIND
   * THEM. <== The shaded band was invisible on glass, and it could never have
   * survived step 3's sorts scattering these rows anyway. */
  const starred = m.host.querySelectorAll('.wall-row[data-pre="1"]');
  ok(`every pre-1966 row is starred (${starred.length})`,
    starred.length > 0 && starred.every((r) => r.querySelector('.wall-star')));
  ok('and no satellite-era row is',
    m.host.querySelectorAll('.wall-row').filter((r) => r.dataset.pre !== '1')
      .every((r) => !r.querySelector('.wall-star')));
  ok('and the pill is told which basin', m.wheres.at(-1)?.basin === 'atlantic');

  /* Tapping a year hands over a NUMBER and a basin, and nothing else — the
   * wall never loads a season file. */
  m.body.fire('click', m.host.querySelector('.wall-row[data-year="2005"]'));
  eq('a year row reports its year and its basin', m.opened.at(-1), [2005, 'atlantic']);
}

{
  /* ==> A FAILED FETCH IS NOT AN EMPTY WALL. <== The two are the same picture
   * and only one of them has ever been true. */
  let fail = true;
  const m = mount({
    wallResult: () => (fail ? { status: 'unavailable', reason: 'answered 503' } : { status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
  });
  await settle(); await settle();

  ok('a failure says so', /could not be read/.test(m.body.innerHTML));
  ok('and names the reason', /503/.test(m.body.innerHTML));
  ok('and draws no year rows at all', m.host.querySelectorAll('.wall-row').length === 0);

  /* ==> AND RETRY IS A REAL RETRY. <== A button that re-renders the same
   * failure is a control that appears to do nothing. */
  fail = false;
  m.body.fire('click', m.host.querySelector('[data-retry]'));
  await settle(); await settle();
  ok('==> pressing Try again re-fetches and the wall appears <==',
    m.host.querySelectorAll('.wall-row').length > 0);
}

{
  /* A wall with storms but no basin labels would put `atlantic` in a heading.
   * Both halves are required. */
  const m = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'unavailable', reason: 'index 404' }),
  });
  await settle(); await settle();
  /* ==> AND IT MUST NAME THE INDEX, NOT FALL DOWN A DIFFERENT ROAD. <== The
   * first version of this assertion asked only for "could not be read" and
   * SURVIVED a mutation that deleted the index check entirely: an undefined
   * index yields no basins, so the view failed anyway with the wrong reason.
   * A test that passes for the wrong reason is worse than no test (§12), so
   * this reads the sentence rather than the state. */
  ok('a missing index is a failure too, not a half-drawn wall',
    /index 404/.test(m.body.innerHTML)
    && m.host.querySelectorAll('.wall-row').length === 0);
}

/* ---------------------------------------------------------------------------
 * 8. THE BASIN SWITCH.
 * ------------------------------------------------------------------------ */
section('8. Switching basin redraws the wall and re-announces');

{
  const m = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
  });
  await settle(); await settle();

  const before = m.host.querySelectorAll('.wall-row').length;
  m.body.fire('click',
    m.host.querySelectorAll('[data-basin]').find((b) => b.dataset.basin === 'epacific'));

  const after = m.host.querySelectorAll('.wall-row').length;
  ok(`the East Pacific has a different number of seasons (${before} -> ${after})`,
    after > 0 && after !== before);
  ok('and the pill is told', m.wheres.at(-1)?.basin === 'epacific');

  /* The Pacific record opens in 1949, so it never crosses 1966 going up from
   * its own start — but it does going DOWN from 2025, so it still draws the
   * line exactly once. */
  ok('the era line is still drawn once', (m.body.innerHTML.match(/wall-era/g) || []).length === 1);

  m.body.fire('click',
    m.host.querySelectorAll('[data-basin]').find((b) => b.dataset.basin === 'atlantic'));
  ok('and switching back restores the Atlantic',
    m.host.querySelectorAll('.wall-row').length === before);
}


/* ---------------------------------------------------------------------------
 * 9. THE SEASON IN PROGRESS — DOTS FOR WHAT ENDED, WORDS FOR WHAT HAS NOT.
 *
 * ==> IT IS THE ONE ROW THE RUNNER CANNOT BUILD. <== `seasons/wall.json` comes
 * out of HURDAT2, NOAA's reviewed record, which does not hold the current year
 * until the following spring (§57.11). Before this row existed the wall's
 * newest year was last year and the season actually happening had no road to
 * it at all.
 * ------------------------------------------------------------------------ */
section('9. The season in progress');

{
  const running = new Set([RUNNING_ID]);
  const r = liveRow({ year: 2026, facts: LIVE_FACTS, running });
  const all = liveRow({ year: 2026, facts: LIVE_FACTS, running: new Set() });

  eq('a storm still running is not drawn as a dot', r.shown.length, LIVE_FACTS.length - 1);
  eq('it is counted in words instead', r.active, 1);
  eq('and the season total is both halves', r.total, LIVE_FACTS.length);

  /* ==> THE FINISHED FIGURES ARE THE FINISHED ONES, NOT THE SEASON'S. <== A
   * row that quietly folded the running storm in would report a season that
   * has not happened yet. Compared against the same row with nothing running,
   * so the assertion is about the EXCLUSION rather than about whichever
   * numbers the sample happens to hold. */
  ok(`the drawn ACE excludes the running storm (${r.ace} < ${all.ace})`, r.ace < all.ace);
  ok('and its strongest is no stronger than the whole season\'s',
    r.strongest <= all.strongest);

  /* ==> §57.18b, MEASURED ON THE REAL 2026 B-DECKS. <== The working best track
   * carries no landfall marker, so 0 here means "not recorded yet" and step 4
   * must not draw the absence as a fact. */
  eq('landfalls are flagged unknown, not reported as none', r.landfallsKnown, false);
}

{
  /* ==> A SILENT LIVE FEED IS "CANNOT ASK", NOT "NOTHING IS RUNNING". <== §5,
   * §57.21c. Treating every storm as finished would draw a season as over that
   * may not be. */
  const r = liveRow({ year: 2026, facts: LIVE_FACTS, running: null });
  eq('with no answer from the feed, no storm is called active', r.active, 0);
  eq('and the row says the count is not knowable', r.activeKnown, false);
  eq('every storm is still drawn', r.shown.length, LIVE_FACTS.length);
}

{
  const m = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
    running: new Set([RUNNING_ID]),
  });
  await settle(); await settle(); await settle(); await settle();

  ok('the pinned row is on the wall', m.body.innerHTML.includes('wall-row-live'));

  /* ==> THE WAITING ROW ANIMATES INSTEAD OF PRINTING ITS OWN MARKUP. <== Aaron
   * on glass, 2026-08-26: switching basin briefly put a tag on screen as
   * literal text, because the caller handed HTML to a function that escaped
   * everything it was given. Both halves are asserted — the dots are real
   * elements, and no escaped tag reaches the reader. */
  const waiting = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
    liveSeason: () => new Promise(() => {}),
  });
  await settle(); await settle(); await settle();
  ok('the pinned row animates while it counts',
    /class="dots"/.test(waiting.body.innerHTML));
  ok('==> AND NO MARKUP IS PRINTED AT THE READER <==',
    !/&lt;span/.test(waiting.body.innerHTML));

  /* ==> AND WITH NOTHING RUNNING IT STILL NAMES THE BASIN. <== The zero case
   * is the one that read wrong on glass, so it is the one asserted. */
  const quiet = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
    running: new Set(),
  });
  await settle(); await settle(); await settle(); await settle();
  ok('a basin with nothing running says so about that basin, not the world',
    /nothing active in the region/.test(quiet.body.innerHTML));
  ok('and it names the current year',
    m.host.querySelector('.wall-row[data-live="1"]')?.dataset.year === '2026');
  /* ==> AND IT NAMES THE BASIN, BECAUSE LEAVING IT OUT READ AS A LIE. <==
   * The Atlantic row said "nothing active right now" while Iselle and Lala
   * were running in the Pacific. The count was right and the sentence claimed
   * the whole world. */
  ok('==> AND IT SAYS HOW MANY STORMS ARE STILL ACTIVE <==',
    /1 active in the region/.test(m.body.innerHTML));

  /* ==> THE COUNT IS THE LAST THING IN THE ROW, IN EVERY ROW. <== It read as
   * `10 2 active…` on glass — two numbers jammed together, the count adrift
   * from the column the other 175 rows keep it in. */
  const liveEl = m.host.querySelector('.wall-row[data-live="1"]');
  const kids = liveEl.children.map((c) => c.attrs.class);
  eq('the count is the last cell in the pinned row', kids.at(-1), 'wall-count');
  ok('and the note comes before it', kids.at(-2) === 'wall-live-note');

  /* It sits ABOVE the record, not inside it — a row in the run of years would
   * say the season was settled. */
  const html = m.body.innerHTML;
  ok('the pinned row comes before 2025',
    html.indexOf('wall-row-live') < html.indexOf('data-year="2025"'));

  m.body.fire('click', m.host.querySelector('.wall-row[data-live="1"]'));
  eq('and tapping it opens that season', m.opened.at(-1), [2026, 'atlantic']);
}

{
  /* ==> A ROW THAT VANISHES ON FAILURE READS AS "THERE IS NO CURRENT SEASON".
   * <== §5, and it is the one claim this row exists to deny. */
  const m = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
    liveSeason: () => ({ status: 'unavailable', reason: 'the relay answered 502' }),
  });
  await settle(); await settle(); await settle(); await settle();

  ok('a live season that would not load keeps its row',
    m.body.innerHTML.includes('wall-row-live'));
  ok('and says why', /502/.test(m.body.innerHTML));

  /* ==> AND A REASON OFF THE WIRE IS STILL ESCAPED. <== The fix below made the
   * placeholder take TEXT rather than markup, and the way that goes wrong in
   * the other direction is a relay message with a bracket in it reaching the
   * page as live markup. */
  const hostile = mount({
    wallResult: () => ({ status: 'ok', wall }),
    indexResult: () => ({ status: 'ok', index }),
    liveSeason: () => ({ status: 'unavailable', reason: '<img src=x> broke' }),
  });
  await settle(); await settle(); await settle(); await settle();
  ok('a reason carrying markup is escaped, not rendered',
    /&lt;img/.test(hostile.body.innerHTML) && !/<img/.test(hostile.body.innerHTML));
  ok('and the settled wall is unaffected', m.host.querySelectorAll('.wall-row').length > 100);
}

console.log(`\ntest-seasons-wall: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
