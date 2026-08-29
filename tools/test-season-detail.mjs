/**
 * test-season-detail.mjs — the archive's storm detail panel. §57.15, §57.22,
 * §57.22a, §57.30 step 7.
 *
 * ==> THE THINGS THIS SUITE EXISTS TO CATCH ARE ALL THE SAME SHAPE: A PANEL
 * THAT LOOKS RIGHT AND SAYS SOMETHING FALSE. <== Nothing here is a crash. Every
 * one of them renders cleanly and reads plausibly.
 *
 * 1. **THE HONESTY LINE OVER A SEASON THAT HAS NOT ENDED.** §57.22's sentence
 *    says NOAA's numbers were *finalised after the season*. Said over a storm
 *    from the season still running — whose figures came out of an operational
 *    b-deck and WILL change — it is exactly the false reassurance it exists to
 *    prevent. The two are alternatives, never a stack.
 *
 * 2. **"NO REPORT WAS WRITTEN" WHEN THE LOOKUP SIMPLY FAILED.** §5. A storm
 *    whose report exists, described as having none, because a fetch lost. The
 *    third state is the whole point of `data/season-reports.js`.
 *
 * 3. **AN EMPTY LANDFALL LIST BETWEEN 1971 AND 1982.** §57.7. Everywhere else
 *    that means the storm stayed at sea, which is real information. In those
 *    twelve years it means nobody wrote it down, and a storm that plainly came
 *    ashore in Texas showing "NOAA marked no landfall" is the app stating
 *    something false.
 *
 * 4. **A LANDFALL WEARING THE STORM'S PEAK.** The panel and the globe must
 *    agree, and `map/layers/season-marks.js` already colours a pin by what
 *    arrived rather than by what the storm once was — Katrina peaked at Cat 5
 *    over water and came ashore at Cat 3.
 *
 * 5. **A DASH.** Every value on this panel is a real number or a sentence
 *    about its absence. `Pressure —` is a shrug that looks like a bug, and on
 *    a 19th-century storm most rows would be one.
 *
 * Driven against the real mirrored season files. No invented storms except
 * where a case cannot otherwise be reached, and those are built by editing a
 * REAL storm so the shape stays honest.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installMarkupDocument } from './markup-dom.mjs';

/* ==> A localStorage STAND-IN, BECAUSE WITHOUT ONE THE PERSISTENCE TESTS PASS
 * ON NOTHING. <== §57.44. `lib/section-state.js` wraps every call in a
 * try/catch and degrades to "nothing is collapsed" on a throw, which is the
 * right behaviour for private-mode Safari and exactly the wrong behaviour for
 * a suite: with no `localStorage` at all, every read returns `{}` and every
 * write is swallowed, so a test asserting a fold was remembered would go green
 * against a panel that had remembered nothing. This is the only thing that
 * makes those assertions mean anything. */
const STORE = new Map();
globalThis.localStorage = {
  getItem: (k) => (STORE.has(k) ? STORE.get(k) : null),
  setItem: (k, v) => { STORE.set(k, String(v)); },
  removeItem: (k) => { STORE.delete(k); },
  clear: () => STORE.clear(),
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

installMarkupDocument();

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts, rankInSeason } = await import('../lib/season-facts.js');
const { SEASONS } = await import('../config/constants.js');
const { createSeasonDetailView } = await import('../ui/view-season-detail.js');
/* ==> TWO MODULES BEHIND ONE HANDLE, BECAUSE THE RANK SECTIONS MOVED AND THE
 * ASSERTIONS ABOUT THEM DID NOT NEED TO. <== SPEC.md §12, §57.44. The archive
 * ranking section put `season-detail-markup.js` 124 lines over the ceiling, so
 * `ordinal`, `seasonRankHtml` and `archiveRankHtml` were lifted into
 * `season-rank-markup.js` with no behaviour change. Merging them here keeps
 * this suite's subject "everything the panel draws" rather than "one file",
 * which is what it was always testing. */
const M = {
  ...await import('../ui/season-detail-markup.js'),
  ...await import('../ui/season-rank-markup.js'),
};

const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
const seasonOf = (basin, year) => parseHurdat2(
  readFileSync(join(ROOT, 'seasons', 'data', index.basins[basin].seasons[String(year)]), 'utf8')
).storms;

const atl2005 = seasonOf('atlantic', 2005);
const atl1851 = seasonOf('atlantic', 1851);
const katrina = atl2005.find((s) => s.id === 'AL122005');
const oldOne = atl1851[0];

const entryFor = (storm) => ({ storm, facts: stormFacts(storm) });

/**
 * Collapse whitespace before asserting on words.
 *
 * ==> BECAUSE THE MARKUP IS WRITTEN AS INDENTED TEMPLATE LITERALS AND A
 * BROWSER COLLAPSES THAT. <== "finalised\n        after the season" is the
 * same sentence on screen as "finalised after the season", and a suite that
 * could not see it was testing the source layout rather than what the reader
 * gets. Caught the first time this file ran: two assertions failed over an
 * indent. Every text assertion here goes through this.
 */
const flat = (html) => String(html).replace(/\s+/g, ' ');
const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * Mount the panel and give back what reached the screen.
 *
 * The view binds ONE delegated listener on its body and reads
 * `e.target.closest(...)` out of the event, so `press` fires a real event with
 * a real target rather than reaching past the view and calling its handler.
 */
/** The shipped ranking table, or null when it has not been built. §57.44. */
const RANK_TABLE = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'seasons', 'data', 'rankings-02272026.json'), 'utf8')); }
  catch { return null; }
})();

function mount({
  storms, loadReport, units = () => 'imperial', onOpen,
  /* ==> DEFAULTS TO NO TABLE, WHICH IS THE STATE EVERY EXISTING CASE HERE WAS
   * WRITTEN AGAINST. <== `Where it ranks` then renders nothing at all, which
   * is the §57.44 behaviour those cases should keep exercising. The one case
   * that cares about the section passes the real table in. */
  archive = () => ({ table: null, basin: null }),
} = {}) {
  const view = createSeasonDetailView({
    entries: () => (storms || []).map(entryFor),
    loadReport: loadReport || (async () => ({ state: 'none' })),
    archive,
    units,
    onOpen,
  });
  const host = document.createElement('div');
  view.mount(host);
  const body = () => host.querySelector('#season-detail-body');
  return {
    view,
    body,
    html: () => body().innerHTML,
    /* ==> A MISSING CONTROL IS A NAMED FAILURE, NOT A THROW. <== It threw
     * until a mutation run on 2026-08-25: deleting the could-not-check branch
     * took the retry button with it, and the suite died with a stack trace
     * instead of saying which rule had been broken. A crash is a failure the
     * gate catches and a human cannot read. */
    press: (sel) => {
      const el = body().querySelector(sel);
      if (!el) {
        fails.push(`nothing matched ${sel} — the control the reader would press is not there`);
        return false;
      }
      body().fire('click', el);
      return true;
    },
  };
}

/* ---------------------------------------------------------------------------
 * 1. THE HONESTY LINE — §57.22, and the reason the panel is safe at all
 * ------------------------------------------------------------------------ */
{
  const settled = M.headHtml({ storm: katrina, facts: stormFacts(katrina), provisional: false });
  ok('a settled storm carries the sentence that stops the whole panel being '
    + 'misread — a best track is hindsight, not what anyone knew on the night',
  flat(settled).includes('finalised after the season')
    && flat(settled).includes('not the forecasts issued at the time'));

  /* ==> AND OVER A SEASON THAT HAS NOT ENDED IT MUST NOT BE SAID. <== §57.11.
   * The figures came out of an operational b-deck and WILL change. Built by
   * flagging a REAL storm provisional rather than by inventing one, so the
   * rest of the shape stays honest. */
  const running = M.headHtml({ storm: katrina, facts: stormFacts(katrina), provisional: true });
  ok('==> A STORM FROM THE SEASON STILL RUNNING NEVER CLAIMS TO BE FINALISED. '
    + '<== That is the false reassurance the sentence exists to prevent',
  !flat(running).includes('finalised after the season'));
  ok('it says the opposite instead, out loud',
    flat(running).includes('still running') && flat(running).includes('will change'));
  ok('and the two are ALTERNATIVES, not a stack — a panel carrying both would '
    + 'contradict itself in consecutive sentences',
  (flat(settled).includes('finalised') ? 1 : 0)
    + (flat(settled).includes('still running') ? 1 : 0) === 1);
}

/* ---------------------------------------------------------------------------
 * 2. NEVER A DASH — §57.25, and most of a 19th-century panel
 * ------------------------------------------------------------------------ */
{
  const facts = stormFacts(oldOne);
  const system = 'imperial';
  const all = [
    M.peakHtml(facts, system),
    M.lifeHtml(facts),
    M.landfallsHtml(facts, system, {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
    }),
    M.changeHtml(facts, system, { windowHours: SEASONS.intensificationWindowHours }),
    M.windFieldHtml(facts, { firstSeason: SEASONS.windFieldFirstSeason }),
  ].join('');

  ok('an 1851 storm\u2019s whole panel contains no em-dash placeholder — every '
    + 'value is a real number or a sentence about its absence',
  !all.includes('>\u2014<') && !all.includes('\u2014</dd>'));
  ok('and no empty value cell', !/<dd>\s*<\/dd>/.test(all));

  /* Its pressure and wind field are both genuinely missing, and each says so
   * in words rather than by leaving a gap. */
  ok('it says why there is no wind field, naming the year rather than shrugging',
    M.windFieldHtml(facts, { firstSeason: SEASONS.windFieldFirstSeason })
      .includes(String(SEASONS.windFieldFirstSeason)));
}

/* ---------------------------------------------------------------------------
 * 3. ZERO IS OMITTED, NOT SHOWN — the row that invites a wrong question
 * ------------------------------------------------------------------------ */
{
  /* A storm that never reached hurricane strength. Found in the real season
   * rather than invented, so "zero hours at hurricane strength" is a case the
   * file actually produces. */
  const weak = atl2005.find((s) => {
    const f = stormFacts(s);
    return f && f.hoursAtHurricane === 0 && Number.isFinite(f.peakWindKt);
  });
  ok('2005 contains a storm that never became a hurricane', !!weak);
  const html = M.lifeHtml(stormFacts(weak));
  ok('==> IT IS NOT "0 hours at hurricane strength". <== That phrasing invites '
    + 'the reader to wonder what went wrong; the storm simply never was one, '
    + 'and the peak figure above already says so',
  !html.includes('At hurricane strength'));
  ok('but its lifespan is still there', html.includes('Lifespan'));

  /* ==> A STORM THAT ONLY EVER WEAKENED, BUILT BY HAND BECAUSE THE RECORD
   * HOLDS NONE. <== Measured 2026-08-25 across all 3,266 mirrored storms: not
   * one has a best 24-hour window that is a loss, so this branch cannot be
   * reached from a real season file and a mutation removing its guard stayed
   * green. It is not dead code — the season STILL RUNNING arrives from ATCF
   * b-decks rather than HURDAT2 (§57.11), and a storm caught mid-decay by an
   * operational feed is exactly this shape. So it is driven directly.
   *
   * The failure it guards is a panel reading "Fastest strengthening: -15 kt in
   * 24 hours", which is a sentence that contradicts itself. */
  const sys = 'imperial';

  /* ==> THE FIRST ASSERTION IS THAT THE SECTION RENDERS AT ALL, AND IT IS HERE
   * BECAUSE THIS SUITE WAS GREEN WHILE IT NEVER DID. <== `stormFacts` writes
   * `fastest24h`; `changeHtml` asked for `fastest`. Every real storm therefore
   * produced an ending sentence and nothing else, from step 7 until Aaron saw
   * Katrina's panel on 2026-08-29 — and this suite passed the whole time,
   * because the only case that exercised the branch HAND-BUILT its facts using
   * the same wrong name. That is §12's failure exactly: a test that agrees with
   * the bug is worse than no test.
   *
   * So the field name is now proved against REAL `stormFacts` output. Katrina
   * gained 50 kt in 24 hours, which is measured off her own rows rather than
   * quoted, and it clears the rapid-intensification threshold. */
  const katrinaFacts = stormFacts(katrina);
  const real = M.changeHtml(katrinaFacts, sys, { windowHours: SEASONS.intensificationWindowHours });
  ok('==> THE SECTION ACTUALLY RENDERS FOR A REAL STORM. <== The field name '
    + 'changeHtml reads must be the one stormFacts writes, and nothing but a '
    + 'real facts object can prove that',
  real.includes('Fastest strengthening'));
  ok(`and it is the measured gain (${Math.round(katrinaFacts.fastest24h.gainKt)} kt), not a typed one`,
    real.includes(`${Math.round(katrinaFacts.fastest24h.gainKt)} kt`));
  ok('and Katrina clears the rapid-intensification threshold, so it is named',
    katrinaFacts.fastest24h.gainKt >= SEASONS.rapidIntensificationKt
      && real.includes('rapid intensification'));
  ok('==> AND THE WINDOW IS SAID IN HOURS, THE SAME UNIT THE SENTENCE UNDER IT '
    + 'USES. <== "50 kt in 1 day" three lines above "the 30 kt in 24 hours that '
    + 'forecasters call rapid intensification" reads as two measurements',
  real.includes(`${Math.round(katrinaFacts.fastest24h.hours)} hours`)
    && !/kt in 1 day/.test(real));

  const decaying = M.changeHtml(
    { fastest24h: { gainKt: -15, fromTime: Date.UTC(2005, 7, 1), toTime: Date.UTC(2005, 7, 2), hours: 24 },
      ending: 'dissipated', year: 2005 },
    sys,
    { windowHours: SEASONS.intensificationWindowHours }
  );
  ok('==> A STORM THAT ONLY WEAKENED IS NOT REPORTED AS \u201Cfastest '
    + 'strengthening\u201D. <== A loss labelled as a gain is a sentence that '
    + 'contradicts itself, and showing it as zero would imply a measurement '
    + 'rather than an absence',
  !decaying.includes('Fastest strengthening'));
  ok('and how it ended is still said', decaying.includes('Dissipated'));
}

/* ---------------------------------------------------------------------------
 * 4. LANDFALLS — the strength at the coast, and the twelve-year hole
 * ------------------------------------------------------------------------ */
{
  const facts = stormFacts(katrina);
  const html = M.landfallsHtml(facts, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
  });
  eq('Katrina has three landfalls', facts.landfalls.length, 3);

  /* ==> THE PANEL AND THE GLOBE HAVE TO AGREE. <== `season-marks.js` colours a
   * pin by what ARRIVED. Katrina peaked at Cat 5 over open water and came
   * ashore in Louisiana at Cat 3; a panel showing Cat 5 beside a Cat 3 pin is
   * one of them lying, and the one that would be lying is the panel. */
  eq('her peak is Cat 5', facts.peakCategory, 6);
  const coastCats = facts.landfalls.map((l) => l.category);
  ok('and no landfall wears her peak — these are the strengths at the coast',
    coastCats.every((c) => c !== 6));
  ok('the strongest of them renders as Cat 3, not Cat 5',
    html.includes('Cat 3') && !html.includes('Cat 5'));

  /* ==> THE PLACE NAME, WHICH IS WHAT AARON WENT LOOKING FOR ON GLASS AND DID
   * NOT FIND. <== §57.40a. The names arrive from the places sidecar, aligned by
   * index against the COMPUTED landfall list. */
  const marks = JSON.parse(readFileSync(
    join(ROOT, 'seasons', 'data', 'atlantic-landfalls-02272026.json'), 'utf8')).storms;
  const placeFile = JSON.parse(readFileSync(
    join(ROOT, 'seasons', 'data', 'atlantic-places-02272026.json'), 'utf8')).storms;
  const withMarks = { ...katrina, landfallsComputed: marks.AL122005 };
  const computed = stormFacts(withMarks);
  const named = M.landfallsHtml(computed, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
    places: placeFile.AL122005,
  });
  ok('==> KATRINA\u2019S LOUISIANA LANDFALL IS NAMED, NOT JUST PLOTTED. <== The '
    + 'panel read 29.3\u00b0N 89.6\u00b0W after \u00a757.40 had already worked out it was '
    + 'Port Sulphur',
  named.includes('Port Sulphur, Louisiana, United States'));
  ok('and the coordinates stay under it \u2014 they are exact where a name 22 km '
    + 'away is an orientation',
  named.includes('29.3') && named.includes('89.6'));
  ok('every landfall gets its own place line', (named.match(/season-landfall-where/g) || []).length === 3);

  /* ==> AND THE NAMES ARE REFUSED WHEN THEY CANNOT BE ALIGNED. <== A sidecar of
   * a different length is a different list. Lining it up against NOAA's sparser
   * `L` markers would print Port Sulphur beside a Florida landfall. */
  const misaligned = M.landfallsHtml(computed, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
    places: { landfalls: [{ name: 'Somewhere Else', km: 1 }] },
  });
  ok('a places array of the wrong length names nothing at all',
    !misaligned.includes('Somewhere Else') && !misaligned.includes('season-landfall-where'));

  const noaaSourced = M.landfallsHtml(facts, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
    places: placeFile.AL122005,
  });
  ok('==> AND WHEN THE LANDFALLS ARE NOAA\u2019S RATHER THAN OURS, THE NAMES ARE '
    + 'REFUSED EVEN AT THE SAME LENGTH. <== Two lists that happen to be the same '
    + 'size are still two lists, and `landfallSource` is the only honest test',
  !noaaSourced.includes('season-landfall-where'));

  ok('and a landfall with no town inside the cap simply has no place line',
    !M.landfallsHtml(computed, 'imperial', {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
      places: { landfalls: [null, null, null] },
    }).includes('season-landfall-where'));

  /* ==> THE 1971-1982 HOLE. <== The one absence in this archive that LOOKS
   * LIKE A FACT. Driven by moving a real storm into the window rather than by
   * inventing one, so the rest of the shape is real. */
  const inHole = { ...stormFacts(katrina), landfalls: [], year: 1975 };
  const holeHtml = M.landfallsHtml(inHole, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
  });
  ok('==> A 1975 STORM WITH NO LANDFALLS SAYS NOBODY WROTE THEM DOWN. <== '
    + '"NOAA marked no landfall" would be the app stating something false '
    + 'about a storm that may well have come ashore',
  flat(holeHtml).includes('did not mark landfalls')
    && holeHtml.includes(String(SEASONS.landfallMarkerHoleFrom)));
  ok('and it does NOT claim the storm stayed at sea',
    !flat(holeHtml).includes('marked no landfall for this storm'));

  /* Outside the window the plain answer is correct and must still be given —
   * an archive that hedged on every empty list would teach the reader to
   * distrust the true ones. */
  const outside = { ...stormFacts(katrina), landfalls: [], year: 1995 };
  ok('outside the window an empty list is real information and says so plainly',
    M.landfallsHtml(outside, 'imperial', {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
    }).replace(/\s+/g, ' ').includes('marked no landfall'));
}

/* ---------------------------------------------------------------------------
 * 5. THE REPORT — three states, and they say three different things
 * ------------------------------------------------------------------------ */
{
  const has = M.reportHtml(
    { state: 'has', url: 'https://www.nhc.noaa.gov/data/tcr/AL122005_Katrina.pdf', via: 'id' },
    2005, SEASONS.reportsFirstSeason
  );
  ok('a storm with a report gets a link to it', has.includes('AL122005_Katrina.pdf'));
  ok('which opens in a new tab, said in words for a screen reader as well as '
    + 'drawn as an arrow', flat(has).includes('new tab') && flat(has).includes('noopener'));

  const none = M.reportHtml({ state: 'none' }, 2005, SEASONS.reportsFirstSeason);
  ok('a modern storm without one says NOAA did not write one — not that none '
    + 'exists for its era', flat(none).includes('did not write a report'));
  ok('and it offers no retry, because pressing it could never work',
    !none.includes('data-retry'));

  const old = M.reportHtml({ state: 'none' }, 1900, SEASONS.reportsFirstSeason);
  ok('a storm from before NOAA wrote these gets the ERA sentence, which '
    + 'teaches something true about the record',
  flat(old).includes(String(SEASONS.reportsFirstSeason)) && flat(old).includes('did not begin'));

  /* ==> AND THE ONE THAT MATTERS. <== §5. */
  const unknown = M.reportHtml({ state: 'unknown', reason: 'offline' }, 2005, SEASONS.reportsFirstSeason);
  ok('==> A FAILED LOOKUP NEVER SAYS "NO REPORT WAS WRITTEN". <== That would '
    + 'state something false about a storm whose report exists — the '
    + 'all-clear-during-an-outage bug at the size of one link',
  !flat(unknown).includes('did not write') && !flat(unknown).includes('did not begin'));
  ok('it says the list could not be reached', flat(unknown).includes('could not be'));
  ok('and it DOES offer a retry, because this one can actually succeed',
    unknown.includes('data-retry="report"'));

  /* ==> THE WAITING LINE'S DOTS ARE MARKUP, NOT TEXT THAT LOOKS LIKE MARKUP.
   * <== `absenceHtml` escapes its argument, so the first version of this panel
   * — `absenceHtml(dotted('Checking…'))` — would have handed `<span
   * class="dots">` to `esc()` and drawn visible angle brackets on screen. It
   * was never seen, because step 7 was reverted before anybody opened the
   * panel. The order is now fixed inside `absenceHtml` (escape, THEN animate),
   * which is why this asserts on the rendered string rather than on the call. */
  const waiting = M.reportHtml({ state: 'loading' }, 2005, SEASONS.reportsFirstSeason);
  ok('the waiting line says what it is checking', flat(waiting).includes('Checking whether'));
  ok('==> ITS DOTS ARE A REAL ELEMENT. <== A static ellipsis is '
    + 'indistinguishable from a sentence that gave up (ui/loading-dots.js)',
  waiting.includes('<span class="dots"'));
  ok('and NOT escaped into visible angle brackets, which is what the first '
    + 'version of this panel would have drawn',
  !waiting.includes('&lt;span') && !waiting.includes('&quot;dots&quot;'));
  ok('the ellipsis character itself is gone, replaced rather than doubled',
    !waiting.includes('…'));
}

/* ---------------------------------------------------------------------------
 * 6. THE VIEW — mounting, the three report states end to end, and the retry
 * ------------------------------------------------------------------------ */
{
  const p = mount({ storms: atl2005, loadReport: async () => ({ state: 'none' }) });
  p.view.onEnter('AL122005');
  await settle();
  ok('the panel names the storm', p.html().includes('KATRINA'));
  ok('and draws its sections', p.html().includes('Strongest') && p.html().includes('Landfalls'));
  /* ==> THE DRAWER'S TITLE CONTRACT, ASSERTED THE WAY THE DRAWER READS IT.
   * <== `ui/drawer.js` does `def.titleFor ? def.titleFor(arg) : def.title` and
   * then puts the answer on screen ONLY if it is a string or a node. The first
   * version of this view exported `title` AS A FUNCTION, which satisfies
   * neither arm — the panel would have opened with an empty header. It threw
   * no error and every other view was fine, so the only thing that could have
   * caught it is an assertion shaped like the consumer. This is that shape. */
  eq('`title` is a plain string, because a function falls through both arms of '
    + 'the drawer\'s check and leaves the header empty',
  typeof p.view.title, 'string');
  eq('`titleFor` is the function, and it names the storm rather than a generic '
    + 'word', p.view.titleFor('AL122005'), 'KATRINA');
  eq('a title built the way ui/drawer.js builds it is a string on screen',
    typeof (p.view.titleFor ? p.view.titleFor('AL122005') : p.view.title), 'string');
  eq('and an unknown storm still yields a string rather than undefined',
    typeof p.view.titleFor('NOPE'), 'string');

  /* ==> THE FIRST STOP IS FOCUSABLE, WHICH AN `<h1>` IS NOT BY DEFAULT. <==
   * The drawer does `v.def.focus?.() || backBtn` — a truthy heading beats the
   * fallback, and `.focus()` on a heading with no tabindex is a silent no-op.
   * A keyboard reader pressing the chevron would have been left focused on a
   * button the drawer had just hidden (§13). */
  const firstStop = p.body().querySelector('.season-detail-name');
  ok('the panel nominates a first stop', !!firstStop);
  eq('and it carries tabindex="-1", or focusing it does nothing at all',
    firstStop?.getAttribute('tabindex'), '-1');

  /* ==> A STORM THE SEASON DOES NOT HOLD. <== Reachable from a stale deep link
   * and from a year change with a panel open. It must say so rather than
   * rendering an empty shell. */
  p.view.onEnter('AL011851');
  await settle();
  ok('a storm this season does not hold says so', flat(p.html()).includes('not in this season'));
}

{
  /* THE RETRY IS A REAL SECOND ATTEMPT, not a replay of the failure. */
  let calls = 0;
  const p = mount({
    storms: atl2005,
    loadReport: async () => {
      calls += 1;
      return calls === 1
        ? { state: 'unknown', reason: 'offline' }
        : { state: 'has', url: 'https://www.nhc.noaa.gov/data/tcr/AL122005_Katrina.pdf', via: 'id' };
    },
  });
  p.view.onEnter('AL122005');
  await settle();
  ok('a failed lookup shows the retry', p.html().includes('data-retry="report"'));
  p.press('[data-retry="report"]');
  await settle();
  await settle();
  eq('pressing it asks again', calls, 2);
  ok('and the second answer replaces the first', p.html().includes('AL122005_Katrina.pdf'));
}

{
  /* ==> A THROW FROM THE FACADE IS STILL AN ANSWER. <== A panel whose report
   * section rendered nothing at all would be the silence §5 forbids,
   * whichever layer failed. */
  const p = mount({ storms: atl2005, loadReport: async () => { throw new Error('boom'); } });
  p.view.onEnter('AL122005');
  await settle();
  await settle();
  ok('a facade that throws still produces the could-not-check state, never an '
    + 'empty section', flat(p.html()).includes('could not be'));
}

{
  /* ==> THE SECOND STORM MUST NOT INHERIT THE FIRST ONE'S ANSWER. <== The
   * reader can open Katrina and then Rita while the first lookup is in the
   * air, and without a token the slower answer wins and lands on the wrong
   * panel. Driven by making the FIRST lookup slower than the second. */
  const p = mount({
    storms: atl2005,
    loadReport: async (id) => {
      if (id === 'AL122005') {
        await new Promise((r) => setTimeout(r, 20));
        return { state: 'has', url: '/data/tcr/AL122005_Katrina.pdf', via: 'id' };
      }
      return { state: 'none' };
    },
  });
  p.view.onEnter('AL122005');
  p.view.onEnter('AL182005');
  await new Promise((r) => setTimeout(r, 40));
  ok('opening a second storm while the first lookup is in the air does not '
    + "land the first storm's report on the second storm's panel",
  !p.html().includes('AL122005_Katrina.pdf'));
}

{
  /* Opening a storm focuses it on the globe — §57.21a's rule that the roster
   * and the map must never disagree, one screen further out. */
  const seen = [];
  const p = mount({ storms: atl2005, onOpen: (id) => seen.push(id) });
  p.view.onEnter('AL122005');
  await settle();
  eq('opening a storm tells the globe to focus it', seen, ['AL122005']);
}

/* ---------------------------------------------------------------------------
 * 7. UNITS — resolved at call time, not captured
 * ------------------------------------------------------------------------ */
{
  let system = 'imperial';
  const p = mount({ storms: atl2005, units: () => system });
  p.view.onEnter('AL122005');
  await settle();
  ok('imperial reads in mph', /\bmph\b/.test(p.html()));
  system = 'metric';
  p.view.onEnter('AL122005');
  await settle();
  ok('==> AND CHANGING THE PREFERENCE TAKES EFFECT WITHOUT RE-ENTERING THE '
    + 'ARCHIVE. <== The view asks at call time rather than capturing, the same '
    + 'as `app/views.js`', /\bkm\/h\b/.test(p.html()));
  ok('and knots are shown alongside either way, because that is the unit the '
    + 'record is actually in', p.html().includes('kt)'));
}

/* ---------------------------------------------------------------------------
 * 8. THE FACADE — the three states come out of a real reports.json
 * ------------------------------------------------------------------------ */
{
  /* ==> DRIVEN AGAINST THE FILE THAT ACTUALLY SHIPPED, NOT A FIXTURE. <== The
   * index is generated by a runner from NOAA's own pages, so a fixture here
   * would be a second idea of its shape that could drift from the real one
   * silently. `fetch` is stubbed; the bytes are real. */
  const real = readFileSync(join(ROOT, 'seasons', 'reports.json'), 'utf8');
  const { reportFor, forgetReports } = await import('../data/season-reports.js');

  const withFetch = async (impl, fn) => {
    const had = globalThis.fetch;
    globalThis.fetch = impl;
    try { return await fn(); } finally {
      globalThis.fetch = had;
      forgetReports();
    }
  };

  const okFetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(real) });

  await withFetch(okFetch, async () => {
    const k = await reportFor('AL122005');
    eq('Katrina resolves to her real report', k.state, 'has');
    ok('at a full url built from the origin the file states once rather than '
      + 'on every one of its rows', k.url.startsWith('https://www.nhc.noaa.gov/'));
    ok('and it records which road it came by, so a wrong link can be audited '
      + 'as read or inferred', k.via === 'id' || k.via === 'name');

    const old = await reportFor('AL011851');
    eq('an 1851 storm has none — a real answer, not a failure', old.state, 'none');
  });

  /* ==> AND THE ONE THAT §5 IS ABOUT. <== */
  await withFetch(async () => ({ ok: false, status: 503 }), async () => {
    const k = await reportFor('AL122005');
    eq('==> AN UNREACHABLE INDEX IS `unknown`, NEVER `none`. <== Katrina HAS a '
      + 'report; answering "none" here would state something false about it',
    k.state, 'unknown');
  });

  /* A failure must fall out of the cache, or one bad moment on a train breaks
   * the lookup for the rest of the session. */
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return calls === 1 ? { ok: false, status: 503 } : okFetch();
  }, async () => {
    await reportFor('AL122005');
    const second = await reportFor('AL122005');
    eq('a failed lookup is not cached, so the next ask is a real retry',
      second.state, 'has');
    eq('and it really did ask again', calls, 2);
  });
}

/* ---------------------------------------------------------------------------
 * 9. §57.43 — the three new figures, and the sentences they turn into
 * ------------------------------------------------------------------------ */
{
  const sys = 'imperial';
  const kf = stormFacts(katrina);
  const speedOpts = {
    floorKt: SEASONS.trackSpeedFloorKt,
    maxLegHours: SEASONS.trackSpeedMaxLegHours,
  };

  /* --- HOW MUCH IT WEAKENED BEFORE THE COAST ---------------------------- */

  const chg = flat(M.changeHtml(kf, sys, { windowHours: SEASONS.intensificationWindowHours }));
  ok('==> KATRINA\u2019S PANEL SAYS THE THING PEOPLE GET WRONG. <== A Category 5 '
    + 'that arrived a Category 3, said in one sentence because the two numbers '
    + 'only mean anything next to each other',
  chg.includes('had been a Category 5') && chg.includes('came ashore a Category 3'));
  ok(`and the figure is the measured gap (${Math.round(kf.coastalWeakening.dropKt)} kt), not a typed one`,
    chg.includes(`${Math.round(kf.coastalWeakening.dropKt * 1.15078)} mph weaker`));
  ok('==> AND IT IS NOT AN EM DASH BESIDE A WIND FIGURE. <== `lib/units.js` '
    + 'returns a bare em dash as its MISSING sentinel, so one written for '
    + 'punctuation is a place a failed conversion could hide',
  !/\u2014\s*\d+\s*mph weaker/.test(chg));

  /* ==> ZERO IS A SENTENCE, NOT A DROPPED ROW. <== §57.25 bans a value cell
   * reading `0`; it does not ban the fact. "It came ashore at its strongest"
   * is the most alarming thing this section can say and it is the case for 703
   * of the 1,341 storms in the archive that came ashore gradeably. */
  const harvey = M.coastalWeakeningWords({
    dropKt: 0, peakWindKt: 115, peakCategory: 5, landfallWindKt: 115,
    landfallCategory: 5, categoriesDropped: 0, landfallIndex: 0,
  }, sys);
  ok('a storm that did not weaken says so out loud rather than showing nothing',
    /came ashore at its strongest/.test(harvey));
  ok('and never as a zero', !/\b0\b/.test(harvey));

  /* ==> THE MIDDLE CASE, BECAUSE A DROP IN WIND IS NOT ALWAYS A DROP IN
   * CATEGORY. <== 150 kt to 140 kt is ten knots gone and still a Category 5 at
   * the coast. Naming the same category twice in one sentence reads as a
   * misprint. */
  const sameCat = M.coastalWeakeningWords({
    dropKt: 10, peakWindKt: 150, peakCategory: 6, landfallWindKt: 140,
    landfallCategory: 6, categoriesDropped: 0, landfallIndex: 0,
  }, sys);
  ok('a storm that weakened without changing category states the wind and the '
    + 'category it kept, rather than naming Category 5 twice',
  /still a Category 5/.test(sameCat)
    && !/had been a Category 5 before/.test(sameCat));

  ok('and a storm with no landfall contributes no sentence at all',
    M.coastalWeakeningWords(null, sys) === null);

  /* --- HOW IT MOVED ------------------------------------------------------ */

  const moved = flat(M.movementHtml(kf, sys, speedOpts));
  ok('==> THE SECTION RENDERS FOR A REAL STORM. <== The field name the markup '
    + 'reads must be the one `stormFacts` writes, and only real output can '
    + 'prove that \u2014 §57.43 exists partly because `fastest24h` versus '
    + '`fastest` went unseen for a month',
  moved.includes('Fastest') && moved.includes('Slowest'));
  ok('with the measured figures, not typed ones',
    moved.includes(`${Math.round(kf.forwardSpeed.fastestKt * 1.15078)} mph`)
      && moved.includes(`${Math.round(kf.forwardSpeed.slowestKt * 1.15078)} mph`));
  ok('==> AND THE NOTE SAYS THESE ARE AVERAGES OVER A LEG, NOT TOP SPEEDS. <== '
    + 'A reader comparing against an advisory\u2019s instantaneous "moving NW at '
    + '12 mph" is entitled to know which of the two they are looking at',
  moved.includes('average over') && moved.includes('rather than a top speed'));
  ok(`and the window in that sentence is the constant (${SEASONS.trackSpeedMaxLegHours}), `
    + 'interpolated rather than written as a word that a later change would leave behind',
  moved.includes(`${SEASONS.trackSpeedMaxLegHours}-hourly`));

  /* ==> BELOW THE RECORD'S OWN PRECISION IT IS WORDS. <== Positions are
   * written to a tenth of a degree, about a knot over six hours, so 100 storms
   * in the archive would otherwise print `Slowest 0 mph` — the dash §57.25
   * forbids, wearing a number. */
  const crawler = {
    ...kf,
    forwardSpeed: { ...kf.forwardSpeed, slowestKt: 0 },
  };
  const crawl = flat(M.movementHtml(crawler, sys, speedOpts));
  ok('==> A STORM THE RECORD CANNOT TELL FROM STATIONARY IS NOT "0 mph". <==',
    crawl.includes('barely moving') && !/Slowest[^|]*0 mph/.test(crawl));
  ok('and the note then explains why, naming the precision rather than shrugging',
    crawl.includes('tenth of a degree'));
  ok('while a storm above the floor gets no such sentence, so it is not boilerplate',
    !moved.includes('tenth of a degree'));

  /* A storm seen once has no speed, and the section says which kind of nothing
   * that is rather than rendering empty. §5, §57.25 rule 2. */
  const once = flat(M.movementHtml({ forwardSpeed: null }, sys, speedOpts));
  ok('a storm never seen twice on the clock is told, not left blank',
    once.includes('never seen twice'));
  ok('and that answer is never a dash', !once.includes('\u2014'));

  /* --- WHERE IT STOOD IN ITS OWN SEASON ---------------------------------- */

  const all2005 = atl2005.map(stormFacts);
  const rankOf = (id) => rankInSeason(all2005.find((f) => f.id === id), all2005);
  const kr = flat(M.seasonRankHtml(rankOf('AL122005')));
  ok('Katrina reads as third strongest of the 31 storms of 2005',
    kr.includes('3rd strongest of 31'));
  const wr = flat(M.seasonRankHtml(rankOf('AL252005')));
  ok('==> AND AN OUTRIGHT WINNER IS "Strongest", NOT "1st strongest". <== '
    + 'Nobody says a storm came first out of thirty-one',
  wr.includes('Strongest of 31') && !wr.includes('1st strongest'));

  /* ==> A DRAW IS SAID AS A DRAW, AND 54 OF 294 SEASONS ARE ONE. <== */
  const tied = flat(M.seasonRankHtml({
    storms: 10,
    strength: { rank: 1, tied: 2, of: 10 },
    lifespan: { rank: 4, tied: 1, of: 10 },
    majors: 3, onlyMajor: false,
  }));
  ok('two storms drawing at the top are "Tied strongest", not both "Strongest"',
    tied.includes('Tied strongest of 10'));
  ok('and a draw further down keeps its ordinal',
    flat(M.seasonRankHtml({
      storms: 10, strength: { rank: 3, tied: 2, of: 10 }, lifespan: null,
      majors: 1, onlyMajor: false,
    })).includes('Tied 3rd strongest of 10'));

  ok('==> THE ONLY-MAJOR SENTENCE APPEARS ONLY WHEN IT IS TRUE. <==',
    flat(M.seasonRankHtml({
      storms: 8, strength: { rank: 1, tied: 1, of: 8 }, lifespan: null,
      majors: 1, onlyMajor: true,
    })).includes('only major hurricane of its season')
    && !kr.includes('only major hurricane'));

  ok('and a season with no ranking to give draws nothing at all, not an empty tag',
    M.seasonRankHtml(null) === '');

  /* The teens are the whole reason `ordinal` is a function. */
  eq('ordinals: 1, 2, 3', [M.ordinal(1), M.ordinal(2), M.ordinal(3)], ['1st', '2nd', '3rd']);
  eq('==> AND 11, 12, 13 ARE NOT 11st, 12nd, 13rd. <== A 31-storm season '
    + 'reaches every one of them',
  [M.ordinal(11), M.ordinal(12), M.ordinal(13)], ['11th', '12th', '13th']);
  eq('while 21, 22, 23 go back to st/nd/rd',
    [M.ordinal(21), M.ordinal(22), M.ordinal(23)], ['21st', '22nd', '23rd']);

  /* --- AND ALL THREE ARE ACTUALLY ON THE MOUNTED PANEL -------------------
   *
   * ==> A MUTATION SAID THIS WAS MISSING BEFORE A READING DID: DELETING THE
   * WHOLE `How it moved` SECTION FROM THE VIEW LEFT EVERY ASSERTION ABOVE
   * GREEN. <== That is exactly the shape of the `fastest24h` fault — markup
   * that was correct, tested, and never called — which ran unseen for a month
   * across 175 years of storms until Aaron read a panel. Testing a markup
   * function proves the function; only mounting proves the panel.
   * -------------------------------------------------------------------- */
  {
    const m = mount({ storms: atl2005 });
    m.view.onEnter('AL122005');
    const panel = flat(m.html());
    ok('the panel really carries a `How it moved` section', panel.includes('How it moved'));
    ok('and an `In its season` section', panel.includes('In its season'));
    ok('with Katrina\u2019s measured rank inside it, so the view is passing the '
      + 'whole season and not an empty list', panel.includes('3rd strongest of 31'));
    ok('and her forward speed inside the other one',
      panel.includes('Fastest') && panel.includes('Slowest'));
    ok('and the weakening sentence is on it too, under `How it changed`',
      panel.includes('came ashore a Category 3'));
  }

  /* --- THE WHOLE PANEL, STILL NEVER A DASH ------------------------------- */

  const oldFacts = stormFacts(oldOne);
  const oldAll = atl1851.map(stormFacts);
  const everything = [
    M.changeHtml(oldFacts, sys, { windowHours: SEASONS.intensificationWindowHours }),
    M.movementHtml(oldFacts, sys, speedOpts),
    M.seasonRankHtml(rankInSeason(oldFacts, oldAll)),
  ].join('');
  ok('==> AN 1851 STORM\u2019S THREE NEW SECTIONS CARRY NO PLACEHOLDER DASH AND '
    + 'NO EMPTY CELL. <== §57.25, extended to everything §57.43 added',
  !everything.includes('>\u2014<') && !everything.includes('\u2014</dd>')
    && !/<dd>\s*<\/dd>/.test(everything));
}

/* ---------------------------------------------------------------------------
 * 9. THE SECTIONS FOLD, THEY REMEMBER, AND THE ORDER PUTS THE COMPARISON
 *    FIRST — Aaron's calls, 2026-08-29
 * ------------------------------------------------------------------------ */
{
  STORE.clear();
  const p = mount({
    storms: atl2005,
    loadReport: async () => ({ state: 'none' }),
    archive: () => ({ table: RANK_TABLE, basin: 'atlantic' }),
  });
  p.view.onEnter('AL122005');
  await settle();

  ok('the archive ranking section needs its table to draw at all, and has one here',
    RANK_TABLE !== null && p.html().includes('data-section="rank-archive"'));

  /* ==> BOTH RANK SECTIONS SIT ABOVE `Strongest`. <== The reader is given the
   * comparison before the storm's own numbers, so a peak wind arrives already
   * placed. The two are moved TOGETHER because they answer one question at two
   * sizes (§57.44); splitting them leaves the wide one orphaned mid-panel with
   * nothing leading into it. */
  const order = (id) => p.html().indexOf(`data-section="${id}"`);
  ok('`In its season` comes before `Strongest`',
    order('rank-season') !== -1 && order('rank-season') < order('peak'));
  ok('and `Where it ranks` stays directly with it, narrow comparison then wide',
    order('rank-archive') > order('rank-season') && order('rank-archive') < order('peak'));
  ok('everything else keeps its order — life, landfalls, change, movement',
    order('life') < order('landfalls') && order('landfalls') < order('change')
    && order('change') < order('movement'));

  /* ==> THE TWO RANK SECTIONS OPEN AND THE REST FOLD. <== The panel has nine
   * sections; a reader wants where a storm SITS before its arithmetic. */
  const shutQ = (id) => p.body()
    .querySelector(`.detail-section[data-section="${id}"]`).dataset.collapsed === 'true';
  ok('a fresh reader gets `In its season` open', !shutQ('rank-season'));
  ok('and `Where it ranks` open', !shutQ('rank-archive'));
  ok('and every other section folded, heading still on screen',
    shutQ('peak') && shutQ('life') && shutQ('landfalls') && shutQ('change')
    && shutQ('movement') && shutQ('windfield') && shutQ('report'));

  /* ==> THE HEAD IS A REAL BUTTON, WHICH IS WHAT BUYS THE KEYBOARD. <== §13.
   * A `<div>` with a click handler is unreachable by Tab and does nothing on
   * Enter, and this panel rendered exactly that until now. Nothing about the
   * appearance changed — `ui/panels.css` has styled `.detail-section-head` as
   * a button all along and this panel was only ever getting the type rules. */
  ok('every section head is a <button>, not a div with a click handler',
    !/<div class="detail-section-head"/.test(p.html())
    && /<button class="detail-section-head" type="button"/.test(p.html()));
  ok('the chevron is hidden from the reader, being decoration',
    p.html().includes('<span class="detail-chevron" aria-hidden="true">'));

  const ariaOf = (id) => p.body()
    .querySelector(`.detail-section[data-section="${id}"] .detail-section-head`)
    .attrs['aria-expanded'];
  ok('an open section announces itself expanded', ariaOf('rank-season') === 'true');
  ok('and a folded one announces itself collapsed', ariaOf('peak') === 'false');

  /* Pressing a head opens it, and pressing again folds it. */
  p.press('.detail-section[data-section="peak"] .detail-section-head');
  ok('pressing a folded head opens that section', !shutQ('peak'));
  ok('and says so to a screen reader', ariaOf('peak') === 'true');
  ok('==> AND ONLY THAT SECTION. <== Opening one must not open its neighbours',
    shutQ('life'));

  p.press('.detail-section[data-section="peak"] .detail-section-head');
  ok('pressing it again folds it', shutQ('peak'));
}

/* ==> A FOLD MUST SURVIVE THE REPORT ARRIVING, AND THIS IS THE SILENT FAILURE.
 * <== The panel re-renders when NOAA's report lands, a beat after it paints.
 * If the state lived only in the DOM, the reader's section would spring shut
 * under them a second after they opened it — and only on the storms that have
 * a report, which is 47% of the archive and the half nobody would test. */
{
  STORE.clear();
  let release;
  const held = new Promise((r) => { release = r; });
  const p = mount({
    storms: atl2005,
    loadReport: async () => { await held; return { state: 'none' }; },
  });
  p.view.onEnter('AL122005');
  await settle();

  p.press('.detail-section[data-section="landfalls"] .detail-section-head');
  const open = () => p.body()
    .querySelector('.detail-section[data-section="landfalls"]').dataset.collapsed !== 'true';
  ok('a section is opened while the report is still in the air', open());

  release();
  await settle();
  ok('==> AND IT IS STILL OPEN AFTER THE REPORT ARRIVES AND THE PANEL REDRAWS.'
    + ' <== The state is read from the record on every paint, never off the DOM', open());
  ok('and the report section itself drew, so the redraw really happened',
    p.html().includes('data-section="report"'));

  /* ==> AND IT MUST NOW SURVIVE A SECOND STORM, WHICH IS THE REVERSE OF WHAT
   * THIS PANEL DID THIS MORNING. <== A reader stepping through 1851 to 2025 is
   * doing the same thing over and over, and re-folding six sections on every
   * storm is a tax the old "opened, read and left" reasoning missed. */
  p.view.onEnter('AL252005');
  await settle();
  ok('opening a second storm keeps the reader\u2019s choice', open());
}

/* ==> AND IT SURVIVES THE APP BEING CLOSED, WHICH IS THE POINT OF PERSISTING
 * IT AT ALL. <== A whole new view instance, reading the record back off
 * storage exactly as a reload does. */
{
  STORE.clear();
  const withTable = { table: RANK_TABLE, basin: 'atlantic' };
  const first = mount({ storms: atl2005, archive: () => withTable });
  first.view.onEnter('AL122005');
  await settle();
  first.press('.detail-section[data-section="rank-season"] .detail-section-head');
  ok('the reader folds a section that is open by default',
    first.body().querySelector('.detail-section[data-section="rank-season"]')
      .dataset.collapsed === 'true');
  ok('and something was actually written, rather than swallowed by a stub',
    STORE.size > 0);

  const second = mount({ storms: atl2005, archive: () => withTable });
  second.view.onEnter('AL122005');
  await settle();
  ok('==> A FRESH VIEW READS IT BACK. <== The default is overridden by the '
    + 'reader\u2019s own choice, which is what `hasChoice` in lib/section-state.js '
    + 'exists to tell apart from "never touched"',
  second.body().querySelector('.detail-section[data-section="rank-season"]')
    .dataset.collapsed === 'true');
  ok('and a section the reader never touched still gets its default',
    second.body().querySelector('.detail-section[data-section="peak"]')
      .dataset.collapsed === 'true'
    && second.body().querySelector('.detail-section[data-section="rank-archive"]')
      .dataset.collapsed !== 'true');

  /* ==> THE KEYS ARE NAMESPACED, BECAUSE THE RECORD IS SHARED WITH THE LIVE
   * PANEL AND IS FLAT. <== Two panels writing a bare `wind` would fold each
   * other's sections, and it would read as the app forgetting a choice rather
   * than as a collision. */
  const keys = JSON.parse(STORE.get([...STORE.keys()][0]));
  ok('every key this panel writes is namespaced',
    Object.keys(keys).length > 0
    && Object.keys(keys).every((k) => k.startsWith('season:')));
  ok('and none of them is a bare id the live panel could also write',
    !Object.keys(keys).some((k) => ['wind', 'vitals', 'ww', 'home', 'advisory',
      'environment', 'flooding', 'people', 'rainfall'].includes(k)));
  STORE.clear();
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n\u2717 ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\u2713 ${pass} assertions pass — the archive's storm panel, and the `
  + 'three ways it could look right and say something false');
