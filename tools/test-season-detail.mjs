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
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS } = await import('../config/constants.js');
const { createSeasonDetailView } = await import('../ui/view-season-detail.js');
const M = await import('../ui/season-detail-markup.js');

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
function mount({ storms, loadReport, units = () => 'imperial', onOpen } = {}) {
  const view = createSeasonDetailView({
    entries: () => (storms || []).map(entryFor),
    loadReport: loadReport || (async () => ({ state: 'none' })),
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
  const decaying = M.changeHtml(
    { fastest: { gainKt: -15, fromTime: Date.UTC(2005, 7, 1), toTime: Date.UTC(2005, 7, 2), hours: 24 },
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
  eq('the drawer titles itself from the storm, not from a generic word',
    p.view.title('AL122005'), 'KATRINA');

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

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n\u2717 ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\u2713 ${pass} assertions pass — the archive's storm panel, and the `
  + 'three ways it could look right and say something false');
