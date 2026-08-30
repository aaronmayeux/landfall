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
const { rankingsFileName, rankStorm, RANK_STATS } = await import('../lib/rankings.js');
const { landfallFileName, placesFileName } = await import('../lib/seasons-sidecar.js');
const { SEASONS } = await import('../config/constants.js');
const { createSeasonDetailView } = await import('../ui/view-season-detail.js');
/* ==> THE ICON SET IS IMPORTED SO THE PANEL'S GLYPHS CAN BE COMPARED TO THE
 * REAL SHAPES RATHER THAN TO EACH OTHER. <== §57.61. Counting six distinct
 * glyphs would pass over a call site asking for the wrong one of them, which
 * is the mistake a merge that renames five sections is most likely to make. */
const { iconSvg } = await import('../ui/section-icon.js');
const ICON_BODY = (name) => iconSvg(name).replace(/^<svg[^>]*>|<\/svg>$/g, '');
/* ==> THREE MODULES BEHIND ONE HANDLE, BECAUSE THE PANEL'S RENDERERS HAVE MOVED
 * TWICE AND THE ASSERTIONS ABOUT THEM DID NOT NEED TO. <== SPEC.md §12,
 * §57.44, §57.57. The archive ranking section put `season-detail-markup.js`
 * 124 lines over the ceiling, so `ordinal`, `seasonRankHtml` and the rank
 * renderers were lifted into `season-rank-markup.js`; §57.57 then took
 * `movementHtml` and `windFieldHtml` out to `season-track-markup.js` for the
 * same reason. Merging them here keeps this suite's subject "everything the
 * panel draws" rather than "one file", which is what it was always testing —
 * and it is why neither move needed a single assertion rewritten. */
const { rankMarks } = await import('../ui/season-rank-markup.js');
const M = {
  ...await import('../ui/season-detail-markup.js'),
  ...await import('../ui/season-track-markup.js'),
  ...await import('../ui/season-rank-markup.js'),
};

const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
const seasonOf = (basin, year) => parseHurdat2(
  readFileSync(join(ROOT, 'seasons', 'data', index.basins[basin].seasons[String(year)]), 'utf8')
).storms;

const atl2005 = seasonOf('atlantic', 2005);
const atl1851 = seasonOf('atlantic', 1851);
/* Sandy's season. She is the only storm in reach whose distance rank differs
 * between miles and kilometres, which makes her the one probe that can catch a
 * panel reading the wrong ladder. §57.46. */
const atl2012 = seasonOf('atlantic', 2012);
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
  /* Derived rather than typed — §57.47. A hardcoded name goes stale the day
   * the schema stamp moves, and this one falls back to null, which turns every
   * rank assertion below into a skip nobody sees. */
  try {
    const idx = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
    const { file } = rankingsFileName(idx.basins);
    return JSON.parse(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8'));
  }
  catch { return null; }
})();

/* ==> AND ITS ABSENCE IS A FAILURE HERE TOO. <== §57.47. The loader above
 * catches, which is right — a table that has not been built yet is a real
 * state. But every rank assertion in this file sits behind it, so a null would
 * turn a third of this suite into a skip nobody reads. The first version of
 * this very fix shipped a null, because `rankingsFileName` was not imported
 * and the `catch` ate the ReferenceError. */
ok('==> THE SHIPPED RANKING TABLE LOADS. <== Every rank assertion in this file '
  + 'is guarded by it, so a null here is a silent third of the suite',
RANK_TABLE !== null);

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

  /* ==> AND THE SAME TWO RULES SWEPT ACROSS REAL STORMS FROM BOTH ENDS OF THE
   * RECORD, BECAUSE 1851 ALONE REACHES ALMOST NO BRANCHES. <== §57.55. An
   * 1851 storm has no wind, no pressure, no wind field and no rapid
   * intensification, so the sweep above was proving the absence sentences and
   * nothing else — the empty `<dt>` fault lived for a day and a half inside a
   * branch it could not reach. These storms are picked to light up the
   * opposite: a Cat 5 with three landfalls and a 50 kt gain, a post-tropical
   * landfall, and a storm from the twelve-year landfall hole. */
  const spread = [oldOne, katrina, atl2012.find((s) => s.id === 'AL182012')]
    .filter(Boolean)
    .map((s) => {
      const ff = stormFacts(s);
      return [
        M.peakHtml(ff, system),
        M.lifeHtml(ff),
        M.landfallsHtml(ff, system, {
          markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
          markerHoleTo: SEASONS.landfallMarkerHoleTo,
        }),
        M.changeHtml(ff, system, { windowHours: SEASONS.intensificationWindowHours }),
        M.windFieldHtml(ff, { firstSeason: SEASONS.windFieldFirstSeason }),
      ].join('');
    })
    .join('');
  ok('==> NO PANEL IN THE SPREAD HAS AN EMPTY LABEL CELL. <== `.detail-vitals` '
    + 'is `grid-template-columns: auto 1fr`, so a row with no label puts its '
    + 'whole value in the right-hand column, indented behind whatever width the '
    + 'row above it claimed. On a phone that reads as broken layout',
  !/<dt>\s*<\/dt>/.test(spread));
  ok('and none of them shows a dash where a figure belongs',
    !spread.includes('>\u2014<') && !spread.includes('\u2014</dd>'));
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

  /* -------------------------------------------------------------------------
   * ACE, IN PLAIN ENGLISH — §57.58, §57.54e
   *
   * ==> THE PANEL TAUGHT NOTHING AND THAT WAS THE WHOLE COMPLAINT. <== It
   * printed `ACE 20.0 × 10⁴ kt²` over `From 24 six-hourly observations`: two
   * pieces of jargon, a unit nobody can picture, and no meaning. Every
   * assertion here is driven off REAL `stormFacts` output rather than a
   * hand-built facts object — §12's rule, and the one that let the `fastest24h`
   * bug hide in this very file for a month.
   * --------------------------------------------------------------------- */
  {
    const kat = stormFacts(atl2005.find((st) => st.id.toLowerCase() === 'al122005'));
    const life = M.lifeHtml(kat);

    ok('==> NO ACRONYM ANYWHERE ON THE ROW. <== `ACE` is the thing being '
      + 'explained; a panel that still prints it has explained nothing',
    !/\bACE\b/.test(life));
    ok('the row is labelled in words a reader already owns',
      life.includes('<dt>Power and stamina score</dt>'));

    /* ==> ONE ROW, NOT TWO, AND THE COUNT RIDES IN THE VALUE. <== The `From`
     * row is what made this read as arithmetic. The count itself is the one
     * thing on the row that is about the RECORD rather than the storm — a
     * thinly observed 1885 storm scores low for a reason that is not weather —
     * so it is kept, next to the number it qualifies. */
    ok('Katrina reads `20.0 from 24 readings` as ONE value',
      life.includes('20.0 from 24 readings'));
    ok('and the `From` row is gone rather than reworded',
      !life.includes('<dt>From</dt>'));
    ok('==> AND THE UNIT WENT WITH IT. <== `× 10⁴ kt²` is exact and unreadable, '
      + 'and the bar under the row is the anchor a bare 20.0 never had',
    !life.includes('kt²') && !life.includes('10⁴'));

    /* ==> THE CADENCE IS INTERPOLATED FROM THE CONSTANT THAT PRODUCED THE
     * FIGURE. <== `CLAUDE.md`: a number in prose is computed, never typed. The
     * assertion derives it the same way rather than hardcoding 6, so moving
     * `aceSynopticHours` moves the sentence and this check together. */
    const hours = 24 / SEASONS.aceSynopticHours.length;
    ok(`the gloss says every ${hours} hours, derived from aceSynopticHours`,
      life.includes(`every ${hours} hours`));
    ok('and it names the floor in words rather than in knots',
      life.includes('at least a tropical storm'));
    ok('==> "FOUR TIMES AS MUCH" IS EXACT, BECAUSE THE SUM IS OF WIND SQUARED. '
      + '<== 40 kt gives 0.160 a reading and 80 kt gives 0.640',
    life.includes('four times as much'));
    ok('and it says the thing the statistic exists to say: a brief violent '
      + 'storm can score less than a long steady one',
    life.includes('A brief violent storm can score less than a long steady one'));

    /* ==> THE GLOSS IS UNDER THE ROW, NOT ABOVE IT OR ELSEWHERE IN THE
     * SECTION. <== §57.54e. An explanation the reader meets before the figure
     * it explains is a paragraph they have no reason to read yet. */
    ok('the gloss follows the row it explains',
      life.indexOf('Power and stamina score') < life.indexOf('One score for strength'));
    ok('and it is a quiet note rather than another value',
      /<p class="detail-note">One score for strength/.test(life));

    /* ==> A STORM WITH ONE READING SAYS `reading`, NOT `readings`. <== 44
     * storms in the archive have exactly one, measured 2026-08-30, so this is
     * a real branch rather than a defensive one. */
    const single = [];
    for (const st of atl2005) {
      const f = stormFacts(st);
      if (f?.aceRecords === 1) single.push(f);
    }
    ok('a one-reading storm is singular, not `1 readings`',
      single.length === 0 || M.lifeHtml(single[0]).includes('from 1 reading<'));

    /* ==> AND A STORM WITH NO ACE GETS NO ROW AND NO GLOSS. <== 339 of the
     * archive's 3,266 carry none. A 286-character explanation of a figure that
     * is not on screen is the worst version of this change.
     *
     * ==> IT IS FOUND IN 2005, NOT IN 1851, AND THAT IS THE OPPOSITE OF THE
     * OBVIOUS GUESS. <== Measured 2026-08-30: every 1851 storm carries an ACE,
     * and three 2005 storms do not (`AL102005`, `AL192005`, `AL232005`). ACE
     * needs a synoptic record at 34 kt or more, so what disqualifies a storm is
     * never reaching tropical-storm force — a modern depression — rather than
     * being old. The first draft of this assertion reached for 1851 on the
     * assumption that thin records mean no ACE, and it went red. */
    const noAce = atl2005.map(stormFacts).find((f) => !(f?.aceRecords > 0));
    ok('2005 supplies a storm with no ACE at all', !!noAce);
    if (noAce) {
      const bare = M.lifeHtml(noAce);
      ok('it carries neither the row nor the gloss',
        !bare.includes('Power and stamina score')
        && !bare.includes('One score for strength'));
    }
  }

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

  /* ==> THE RAPID-INTENSIFICATION SENTENCE IS A SENTENCE, NOT A ROW WITH NO
   * LABEL. <== §57.55. It was pushed as `['', 'That meets…']`, `rowsHtml`
   * filters on the value and never the key, and `.detail-vitals` is
   * `grid-template-columns: auto 1fr` — so a full sentence rendered inside the
   * value column, indented behind the width `Fastest strengthening` had
   * claimed. At 390px that is a sentence in a half-width gutter, on 945 of the
   * 3,266 storms. Nothing crashed and nothing was missing; it simply read as
   * broken, which is the whole shape of what this suite exists to catch.
   *
   * Mutation-checked: pushing the sentence back into `rows` turns both of
   * these red. */
  ok('the sentence is a note paragraph, sitting under the figures it explains',
    /<p class="detail-note">That meets the/.test(real));
  ok('==> AND THE PANEL CARRIES NO EMPTY LABEL CELL. <== The mirror of the '
    + '"no empty value cell" rule above, and the half that was missing',
  !/<dt>\s*<\/dt>/.test(real));
  ok('and it is printed before what the storm gave up at the coast, because it '
    + 'belongs to the strengthening figures above it',
  real.indexOf('rapid intensification') < real.indexOf('came ashore a Category 3'));

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
  /* ==> HOW A STORM ENDED IS ITS OWN RENDERER SINCE STEP 7, AND THIS BLOCK
   * FOLLOWED IT. <== §57.54f, §57.61. The sentence belongs under `How long it
   * lasted` next to the lifespan figures rather than under the strengthening
   * ones, and a renderer cannot be composed into two sections while it emits
   * both. `changeHtml` no longer says anything about the ending at all, so
   * asserting through it would assert nothing. */
  ok('and how it ended is still said, by its own renderer',
    M.endingHtml({ ending: 'dissipated' }).includes('Dissipated'));
  ok('and it is a note paragraph, the same shape it had inside the old section',
    /^<p class="detail-note">Dissipated\./.test(M.endingHtml({ ending: 'dissipated' })));
  /* ==> AN ENDING CODE THIS PANEL HAS NO WORDS FOR PRINTS NOTHING, AND 11
   * STORMS ARE ALREADY IN THAT STATE. <== Counted across all 3,266 storms in
   * `seasons/data/`, 2026-08-30: 1,949 dissipated, 804 extratropical, 502
   * remnant low, 11 `unknown` — 10 ending on a `DB` record and 1 on a `WV`.
   * This was written first as a guard against a hypothetical fourth code and
   * the measurement said it is not hypothetical, which is why the real value
   * is the one driven here rather than an invented one.
   *
   * ==> AND THE FIRST COUNT WAS EXACTLY DOUBLE. <== It globbed every `.txt` in
   * `seasons/data/`, which also holds two whole-basin `hurdat2-*.txt` files
   * carrying every storm again. Only `basin-YYYY-` is one storm each. */
  ok('the 11 storms whose ending has no words print nothing at all',
    M.endingHtml({ ending: 'unknown' }) === ''
    && M.endingHtml({}) === '' && M.endingHtml(null) === '');
  ok('and `changeHtml` no longer says anything about the ending',
    !decaying.includes('Dissipated'));

  /* ==> THIS BLOCK IS A CHRONOLOGY AND THE COMEBACK HAS TO LAND INSIDE IT.
   * <== §57.48. It runs strengthening, then what the storm gave up at the
   * coast, then the comeback. The sentence is handed in as an argument rather
   * than appended by the view for exactly this reason: appended, it would sit
   * under whatever the view puts next and describe a hurricane coming back
   * afterwards.
   *
   * ==> A MUTATION RUN IS WHY THIS IS ASSERTED. <== Moving the slot left both
   * this suite and `test-storm-shape.mjs` green — the ordering was a comment
   * and nothing else. §12.
   *
   * ==> IT IS ASSERTED AGAINST THE COASTAL SENTENCE AND AGAINST BEING LAST,
   * BECAUSE THE ENDING IS NO LONGER HERE TO BE ASSERTED AGAINST. <== §57.61.
   * The comeback being the final thing this renderer emits is what guarantees
   * anything the view appends after it — the ending, until step 7 moved it to
   * another section — lands the right way round. */
  const ordered = M.changeHtml(
    {
      year: 2004,
      /* Zero drop, which is the one coastal case that needs no category
       * lookup: `It came ashore at its strongest.` The sentence being present
       * is what this assertion is about; which of the three it is, is
       * `coastalWeakeningWords`'s own business and is covered elsewhere. */
      coastalWeakening: { dropKt: 0, peakWindKt: 150 },
    },
    sys,
    {
      windowHours: SEASONS.intensificationWindowHours,
      comebackHtml: '<p class="detail-note">COMEBACK-MARKER</p>',
    },
  );
  ok('==> THE COMEBACK IS PRINTED AFTER WHAT THE STORM GAVE UP AT THE COAST. '
    + '<== A storm that fell apart and came back did so on its way there',
  ordered.indexOf('COMEBACK-MARKER') > -1
    && ordered.indexOf('ashore') > -1
    && ordered.indexOf('ashore') < ordered.indexOf('COMEBACK-MARKER'));
  ok('and it is the last thing the block says, so anything the view appends '
    + 'after it lands the right way round',
  ordered.trimEnd().endsWith('COMEBACK-MARKER</p>'));

  const noComeback = M.changeHtml({ year: 2004 }, sys,
    { windowHours: SEASONS.intensificationWindowHours });
  ok('and the argument is optional, because 14 storms in 3,266 have a comeback '
    + 'and the other 3,252 must not gain an empty slot',
  !noComeback.includes('COMEBACK-MARKER') && !/<p class="detail-note">\s*<\/p>/.test(noComeback));
}

/* ---------------------------------------------------------------------------
 * 3b. THE LOOP — §57.49, in `How it moved` and above the birthplace
 * ------------------------------------------------------------------------- */
{
  /* ==> DRIVEN THROUGH THE MOUNTED VIEW RATHER THAN THROUGH `loopHtml`. <==
   * Both §57.49 sentences are APPENDED by the view, so their order is a fact
   * about `view-season-detail.js` and nothing in `season-shape-markup.js` can
   * see it. §57.48 shipped exactly this kind of ordering as a comment and a
   * mutation run walked straight through it. */
  const atl2004 = seasonOf('atlantic', 2004);
  const jeanne = atl2004.find((s) => s.id === 'AL112004');
  const m = mount({ storms: [jeanne] });
  m.view.onEnter('AL112004');
  const html = m.html();

  ok('==> JEANNE 2004 GETS THE LOOP SENTENCE. <== She turned a full circle east of the '
    + 'Bahamas and came back over the same water', html.includes('It looped.'));
  ok('and it names the width in the reader\u2019s own units, so it agrees with the '
    + 'distance rows in the same section', html.includes('157 mi'));

  /* ==> ABOVE THE BIRTHPLACE, AND THAT IS THE DECISION WORTH ASSERTING. <==
   * §57.49. The origin sentence fires on 1,993 of 2,004 Atlantic storms and
   * reads as background; the loop fires on 120 of 3,266 and is the reason a
   * reader stops. A rare fact printed under a near-universal one is a rare
   * fact nobody sees. */
  const loopAt = html.indexOf('It looped.');
  const originAt = html.indexOf('It formed inside the basin');
  ok('==> AND IT IS PRINTED ABOVE THE BIRTHPLACE SENTENCE, NOT BELOW IT. <== The rare '
    + 'fact leads; the one nearly every Atlantic storm carries follows',
  loopAt > -1 && originAt > -1 && loopAt < originAt);

  /* ==> AND THE SAME PANEL IN KILOMETRES, WHICH IS THE ASSERTION A MUTATION
   * RUN ADDED. <== Dropping `system` from the view's call left every other
   * case green: `formatDistance` falls back to the device locale, which in a
   * sandbox is imperial, so the miles assertion above still passed while a
   * metric reader would have been shown miles. The unit has to be proven to
   * TRAVEL, not merely to be right on the default. */
  const metric = mount({ storms: [jeanne], units: () => 'metric' });
  metric.view.onEnter('AL112004');
  ok('==> A METRIC READER IS SHOWN THE LOOP IN KILOMETRES. <== The preference has to '
    + 'reach the sentence from the view, not be assumed by it',
  metric.html().includes('252 km'));

  /* Katrina never crosses her own track, so the slot must vanish rather than
   * render empty. §57.25: a value that shrugs is worse than no row. */
  const k = mount({ storms: [katrina] });
  k.view.onEnter('AL122005');
  ok('and a storm that never crossed its own track gains nothing at all',
    !k.html().includes('It looped'));
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
  /* ==> BOTH NAMES ARE BUILT RATHER THAN TYPED. <== §57.7c bumped both schema
   * versions and this suite went red on two hand-spelled filenames. */
  const idx2 = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const rev2 = idx2.basins.atlantic.revision;
  const marks = JSON.parse(readFileSync(
    join(ROOT, 'seasons', 'data', landfallFileName('atlantic', rev2)), 'utf8')).storms;
  const placeFile = JSON.parse(readFileSync(
    join(ROOT, 'seasons', 'data', placesFileName('atlantic', rev2)), 'utf8')).storms;
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

  /* ==> THE ELEMENT ITSELF, BECAUSE A MUTATION SURVIVED WITHOUT THIS. <==
   * §57.60c. Swapping the `<ol>` back to a `<ul>` left all 210 assertions
   * green. The order of these rows is load bearing since step 6 — it is what
   * the chart's numbers refer to — and that is the entire distinction between
   * the two elements. */
  ok('the numbered landfalls are an ordered list',
    named.includes('<ol class="season-landfalls">') && named.includes('</ol>'));

  /* ==> EVERY ROW CARRIES THE NUMBER ITS DISC CARRIES ON THE CHART ABOVE. <==
   * §57.60, step 6. The chart's caption tells the reader the numbered marks are
   * the landfalls listed here, so a row without its number leaves a mark
   * pointing at nothing. */
  ok('every landfall row carries a number badge',
    (named.match(/season-landfall-n"/g) || []).length === 3);
  ok('and they read 1, 2, 3 down the page',
    named.indexOf('>1<') < named.indexOf('>2<') && named.indexOf('>2<') < named.indexOf('>3<'));
  ok('==> AND THE BADGE IS HIDDEN FROM A SCREEN READER, WHICH GETS A WORD. <== '
    + 'A bare digit announced ahead of a place name reads as a list index the '
    + 'reader cannot act on',
  named.includes('<span class="visually-hidden">Landfall 1.</span>')
    && named.includes('class="season-landfall-n" aria-hidden="true"'));

  /* ==> A LIST THAT ARRIVES OUT OF TIME ORDER IS RENUMBERED, AND ITS NAMES GO
   * WITH THEIR OWN MARKS. <== §57.60. No storm in the archive is out of order
   * today, so the case is built by reversing Katrina's — the failure it guards
   * is the same one the length check above guards from a different road:
   * Port Sulphur printed beside a Florida landfall, reading perfectly. */
  const reversed = M.landfallsHtml(
    { ...computed, landfalls: computed.landfalls.slice().reverse() },
    'imperial',
    {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
      places: { ...placeFile.AL122005, landfalls: placeFile.AL122005.landfalls.slice().reverse() },
    },
  );
  ok('a reversed landfall list renders in the same order as the sorted one',
    flat(reversed) === flat(named));

  ok('and a landfall with no town inside the cap simply has no place line',
    !M.landfallsHtml(computed, 'imperial', {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
      places: { landfalls: [null, null, null] },
    }).includes('season-landfall-where'));

  /* ==> WHAT THE WALK REFUSED GETS A SENTENCE. <== §57.7e, §5. 135 real coast
   * crossings across the archive are not landfalls, and for 26 storms that is
   * every crossing they have — so this panel said "this storm did not come
   * ashore" over a track that plainly touched land.
   *
   * ==> DRIVEN OFF THE REAL SIDECAR RATHER THAN A HAND-BUILT COUNT. <== §12:
   * the `How it changed` section was green for weeks because its only case
   * built its own facts object with the same wrong field name the bug had.
   * These read `declined` out of the file the runner wrote. */
  const declinedFile = JSON.parse(readFileSync(
    join(ROOT, 'seasons', 'data', landfallFileName('atlantic', rev2)), 'utf8')).declined;
  const refusedId = Object.keys(declinedFile).find((id) => !marks[id]);
  ok('==> THE ARCHIVE REALLY HAS STORMS WHOSE ONLY CROSSING WAS REFUSED. <== '
    + 'If this ever finds none, the sentence below is guarding nothing',
  Boolean(refusedId));

  const refusedFacts = {
    ...stormFacts(katrina), landfalls: [], year: 1995,
    landfallSource: 'computed', crossingsDeclined: declinedFile[refusedId],
  };
  const refusedHtml = flat(M.landfallsHtml(refusedFacts, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
  }));
  ok('a storm with no landfalls but a refused crossing still says it did not come ashore',
    refusedHtml.includes('did not come ashore'));
  ok('==> AND NO LONGER STOPS THERE, WHICH IS THE WHOLE POINT. <== The track '
    + 'touched land and the panel used to be silent about it',
  refusedHtml.includes('crossed a coast'));
  ok('and it says WHY in plain English rather than naming a status code',
    refusedHtml.includes('not a tropical cyclone')
      && !refusedHtml.includes('EX') && !refusedHtml.includes('LO'));

  /* The count is spelled as a word, per §57.41's rule that counts are words. */
  ok('one refusal reads as "one other time"',
    flat(M.landfallsHtml({ ...refusedFacts, crossingsDeclined: 1 }, 'imperial', {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
    })).includes('one other time'));
  ok('and three reads as "three other times", not "3"',
    flat(M.landfallsHtml({ ...refusedFacts, crossingsDeclined: 3 }, 'imperial', {
      markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
      markerHoleTo: SEASONS.landfallMarkerHoleTo,
    })).includes('three other times'));

  /* ==> AND IT SITS UNDER A REAL LIST TOO. <== 66 of the 92 storms with a
   * refusal DID come ashore somewhere else, so a sentence that only appeared
   * on empty lists would miss most of them. */
  const bothHtml = flat(M.landfallsHtml({ ...computed, crossingsDeclined: 2 }, 'imperial', {
    markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
    markerHoleTo: SEASONS.landfallMarkerHoleTo,
  }));
  ok('a storm that came ashore AND had a crossing refused still lists all three landfalls',
    (bothHtml.match(/season-landfall-when/g) || []).length === 3);
  ok('the refusal note follows the list rather than replacing it',
    bothHtml.includes('season-landfalls') && bothHtml.includes('two other times'));

  /* ==> ZERO AND `null` ARE BOTH SILENT, FOR DIFFERENT REASONS. <== Zero is
   * "the walk ran and refused nothing"; null is "nobody walked", which is the
   * NOAA fallback. Neither has anything to disclose, and a sentence on either
   * would be the app inventing a caveat. */
  for (const [what, value] of [['zero refusals', 0], ['an unwalked storm', null]]) {
    ok(`${what} says nothing about crossings`,
      !flat(M.landfallsHtml({ ...refusedFacts, crossingsDeclined: value }, 'imperial', {
        markerHoleFrom: SEASONS.landfallMarkerHoleFrom,
        markerHoleTo: SEASONS.landfallMarkerHoleTo,
      })).includes('crossed a coast'));
  }

  /* ==> MUTATION: dropping `refusedNote` from the empty branch turns the
   * "crossed a coast" case red; dropping it from the list branch turns the
   * "follows the list" case red; printing the digit instead of the word turns
   * the two counting cases red; treating `null` as 0 leaves everything green
   * BUT treating 0 as truthy turns the zero case red. All four were run. */


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
  ok('and draws its sections',
    p.html().includes('How hard it blew') && p.html().includes('Landfalls'));
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
  /* ==> THE REAL CONSTANTS, NOT NUMBERS TYPED HERE. <== A suite carrying its
   * own copy of a threshold goes on passing after somebody moves the shipped
   * one, which is the §12 failure at the size of a literal. */
  const speedOpts = {
    floorKt: SEASONS.trackSpeedFloorKt,
    maxLegHours: SEASONS.trackSpeedMaxLegHours,
    distanceFloorNm: SEASONS.trackDistanceFloorNm,
    cycloneShareMax: SEASONS.trackDistanceCycloneShareMax,
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

  /* --- HOW FAR IT WENT — §57.45 ------------------------------------------ */

  const moved = flat(M.movementHtml(kf, sys, speedOpts));

  ok('==> THE DISTANCE ROW RENDERS FOR A REAL STORM, FROM THE FIELD '
    + '`stormFacts` ACTUALLY WRITES. <== The `fastest24h` versus `fastest` '
    + 'fault ran unseen for a month, and only real output can prove the name',
  moved.includes('Distance travelled') && moved.includes('2,106 mi'));

  ok('==> AND IT LEADS THE SECTION, ABOVE THE SPEEDS. <== A reader wants the '
    + 'length of the line before its pace, and 19 mph means something '
    + 'different on a 300-mile track than on a 5,000-mile one',
  moved.indexOf('Distance travelled') < moved.indexOf('Fastest'));

  /* ==> THE READER'S OWN UNITS, THROUGH `formatDistance` AND NOTHING ELSE.
   * <== Aaron's requirement on this pass. `ui/view-season-detail.js` resolves
   * the Settings preference per render and hands it down as `system`, so the
   * only way this row can be wrong is arithmetic written at the call site.
   * The same facts rendered twice is what catches that: a hardcoded
   * conversion, or a dropped `system` argument, gives the same string twice. */
  const movedKm = flat(M.movementHtml(kf, 'metric', speedOpts));
  ok('the same storm in metric gives kilometres', movedKm.includes('3,388 km'));
  ok('==> AND NOT A TRACE OF THE IMPERIAL FIGURE, SO THE PREFERENCE IS REALLY '
    + 'REACHING THE ROW. <== A conversion hardcoded here rather than taken '
    + 'from `formatDistance` renders identically in both systems',
  !movedKm.includes('2,106 mi') && !movedKm.includes(' mi<') && movedKm !== moved);

  /* ==> KATRINA IS THE BOUNDARY CASE AND SHE IS ON THE RIGHT SIDE OF IT. <==
   * She was a tropical cyclone for 92.2% of her track, just above
   * `trackDistanceCycloneShareMax`, so the second row stays off her. This is
   * the assertion that goes red if somebody widens the threshold to "any
   * difference at all" and turns the row into boilerplate. */
  ok('a storm that was a cyclone for nearly all of its track shows one '
    + 'distance, not two', !moved.includes('As a tropical cyclone'));
  ok('and no sentence explaining a gap the reader cannot see',
    !moved.includes('before it became a tropical cyclone'));

  /* ==> HARVEY IS THE OTHER SIDE, AND HE IS THE REASON THE ROW EXISTS. <== He
   * crossed the Caribbean as a wave: 5,006 miles of track, 2,644 of them as a
   * tropical cyclone. */
  const harveyMoved = flat(M.movementHtml(
    stormFacts(seasonOf('atlantic', 2017).find((s) => s.id === 'AL092017')),
    sys, speedOpts,
  ));
  ok('==> A STORM THAT SPENT HALF ITS TRACK AS A WAVE SHOWS BOTH FIGURES. <==',
    harveyMoved.includes('5,006 mi') && harveyMoved.includes('As a tropical cyclone')
    && harveyMoved.includes('2,644 mi'));
  ok('and the note says what the gap between them is, rather than leaving the '
    + 'reader to guess why one number is half the other',
  harveyMoved.includes('before it became a tropical cyclone')
    && harveyMoved.includes('extratropical'));

  /* ==> A STORM THE RECORD NEVER MOVES PRINTS WORDS, NOT `0 mi`. <== Three of
   * 3,234 storms, measured: AL051851 sits at 32.5N 73.5W for sixteen fixes.
   * §57.25 forbids the dashed shrug wearing a number. */
  const stuck = {
    ...kf,
    trackDistance: { totalNm: 0, cycloneNm: 0, legs: 3 },
    forwardSpeed: { ...kf.forwardSpeed, fastestKt: 0, slowestKt: 0 },
  };
  const stuckHtml = flat(M.movementHtml(stuck, sys, speedOpts));
  ok('the distance reads as words', stuckHtml.includes('no movement recorded'));
  ok('and nowhere on the section is a zero wearing a unit',
    !/\b0(\.0)? (mi|km|mph|km\/h)\b/.test(stuckHtml));

  /* ==> AND THIS ONE WAS A LIVE FAULT ON `main` UNTIL §57.45. <== §57.43 put
   * its floor on the SLOWEST row alone, so those same three storms have been
   * printing `Fastest 0 mph`. Both rows go rather than both reading `barely
   * moving`: two rows exist to show a range, and there is none. */
  ok('==> A STORM WITH NO MEASURABLE LEG AT EITHER END SHOWS NO SPEED ROWS AT '
    + 'ALL, RATHER THAN `Fastest 0 mph`. <==',
  !stuckHtml.includes('Fastest') && !stuckHtml.includes('Slowest'));
  ok('and the note says so in words instead, so nothing is silently dropped',
    stuckHtml.includes('no speed to give'));
  ok('==> AND IT SAYS IT ONCE. <== Both floors trip on the same three storms, '
    + 'so the two explanations would otherwise sit in adjacent sentences '
    + 'saying one thing twice',
  !stuckHtml.includes('no fastest or slowest to give'));

  /* --- HOW FAST IT WAS MOVING -------------------------------------------- */

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
    ok('the panel really carries a `Where it went` section', panel.includes('Where it went'));
    ok('and an `In its season` section', panel.includes('In its season'));
    ok('with Katrina\u2019s measured rank inside it, so the view is passing the '
      + 'whole season and not an empty list', panel.includes('3rd strongest of 31'));
    ok('and her forward speed inside the other one',
      panel.includes('Fastest') && panel.includes('Slowest'));
    /* ==> AND THE DISTANCE ROW, FOR THE SAME REASON EVERY OTHER FIGURE HERE
     * IS CHECKED ON THE MOUNTED PANEL. <== §57.45 added two constants to the
     * view's call, and a renderer given no `distanceFloorNm` still returns
     * markup — it simply compares against `undefined`, which is false, so
     * every storm would silently lose the floor. Only mounting drives the
     * real argument list. */
    ok('==> AND HER DISTANCE TRAVELLED, IN THE READER’S UNITS. <== The '
      + 'markup assertions above prove the function; this proves the view '
      + 'calls it with the whole option set',
    panel.includes('Distance travelled') && panel.includes('2,106 mi'));
    ok('and the weakening sentence is on it too, under `How it changed`',
      panel.includes('came ashore a Category 3'));
  }

  /* ==> AND HARVEY IS MOUNTED TOO, BECAUSE KATRINA CANNOT CATCH A DROPPED
   * CONSTANT. <== A mutation removing `distanceFloorNm` and `cycloneShareMax`
   * from the view's call survived every assertion above. Both then compare
   * against `undefined`, which is false, so the floor and the second row
   * quietly stop existing — and Katrina's panel is byte-identical either way,
   * because she sits above both thresholds. A branch asserted against a storm
   * that cannot take it is green over the bug, which is §12's whole point.
   *
   * Harvey can take it: he crossed the Caribbean as a wave, so his second row
   * appears at all only if `cycloneShareMax` really arrived. */
  {
    const m = mount({ storms: seasonOf('atlantic', 2017) });
    m.view.onEnter('AL092017');
    const panel = flat(m.html());
    ok('==> HARVEY\u2019S SECOND DISTANCE ROW REACHES THE MOUNTED PANEL. <== '
      + 'The only road to it is the view passing `cycloneShareMax` down',
    panel.includes('5,006 mi') && panel.includes('As a tropical cyclone')
      && panel.includes('2,644 mi'));
  }

  /* ==> THE FLOOR IS ASSERTED AGAINST THE SHIPPED SOURCE, BECAUSE NO REAL
   * SEASON CAN DRIVE IT THROUGH A MOUNT. <== The three storms the record never
   * moves are 1851, 1857 and 1864, none of them a fixture here, and a
   * hand-built storm cannot be fed to this view — it loads a real season file.
   * Blunt, and the right instrument for the same reason §57.44 read the
   * shipped module to prove `stitchSeams` sat on the fetch path: a constant
   * nobody passes is exactly the state being guarded, and it has no symptom.
   *
   * ==> IT MATCHES THE NAMES, NOT THE FORMATTING. <== A reordered option list
   * or a whitespace change must not turn this red; only the constant going
   * missing may. */
  {
    const src = readFileSync(join(ROOT, 'ui', 'view-season-detail.js'), 'utf8');
    ok('==> THE VIEW REALLY PASSES `distanceFloorNm` FROM THE CONSTANTS. <== '
      + 'Dropped, every storm silently loses the floor and `no movement '
      + 'recorded` goes back to being `0 mi`',
    /distanceFloorNm:\s*SEASONS\.trackDistanceFloorNm/.test(src));
    ok('and `cycloneShareMax` from the constants, never a number typed at the '
      + 'call site', /cycloneShareMax:\s*SEASONS\.trackDistanceCycloneShareMax/.test(src));
  }

  /* ==> AND SANDY IS MOUNTED IN BOTH UNIT SYSTEMS, BECAUSE THE RANK ROW IS
   * THE ONE PLACE THE PREFERENCE CAN GO MISSING WITHOUT LOOKING WRONG. <==
   * §57.46. Distance ranks against two ladders — one rounded to miles, one to
   * kilometres — because a rung has to be the number the row above it prints,
   * and `rankStorm` needs the reader's system to pick. A mutation dropping
   * that argument from the view survived every other assertion here: the row
   * still appears, still carries the right label, and simply ranks against the
   * wrong ladder.
   *
   * ==> SANDY IS THE PROBE AND SHE IS THE ONLY FIXTURE THAT IS. <== She is
   * 609th longest track in the Atlantic by miles and 610th by kilometres —
   * every other storm in `samples/seasons/storms/` gives the same number in
   * both, which is exactly why a spot check on Katrina or Harvey proves
   * nothing here. Measured against the shipped table, not chosen. */
  {
    ok('==> AND THE SHIPPED TABLE IS REALLY LOADED, OR THE TWO BELOW PROVE '
      + 'NOTHING. <== A missing table draws no rank section at all, and an '
      + 'assertion on an absent row is an assertion on nothing',
    RANK_TABLE !== null);
    for (const [system, want] of [['imperial', '609th'], ['metric', '610th']]) {
      const m = mount({
        storms: atl2012,
        units: () => system,
        archive: () => ({ table: RANK_TABLE, basin: 'atlantic' }),
      });
      m.view.onEnter('AL182012');
      const panel = flat(m.html());
      ok(`==> SANDY\u2019S DISTANCE RANK FOLLOWS THE ${system.toUpperCase()} `
        + `READER TO ${want} IN THE ATLANTIC. <== The label is identical either `
        + 'way, so only the number can catch the wrong ladder',
      panel.includes(`${want} longest track in the Atlantic`));
    }
  }

  /* ==> EVERY RANKED STATISTIC REACHES A ROW, AND THIS IS THE ONLY GATE THAT
   * CAN SEE A MISSPELLED KEY. <== §57.57b. Since step 3 a section says only
   * *this row is the peak wind figure* by naming its `RANK_STATS` key, and
   * `figureRowsHtml` does the lookup. A typo in that key costs the rank and
   * the bar SILENTLY: the row still prints, still carries the right label,
   * still shows the right figure, and simply has nothing under it. Nothing
   * throws and nothing looks broken.
   *
   * ==> SO THE ASSERTION IS AGAINST `rankMarks`, NOT AGAINST A LIST WRITTEN
   * HERE. <== A list of expected keys in this file would be a second copy of
   * `RANK_STATS`, free to go stale in the same direction as the bug. This
   * mounts Katrina — who ranks on every statistic the archive has — and
   * demands that every mark the lookup produced is claimed by exactly one row
   * in the panel it drew. */
  {
    ok('==> AND THE SHIPPED TABLE IS LOADED, OR THE COVERAGE CHECK BELOW '
      + 'PROVES NOTHING. <== No table means no marks, and "zero marks all '
      + 'reached a row" is true and worthless',
    RANK_TABLE !== null);
    if (RANK_TABLE) {
      const kat = mount({
        storms: atl2005,
        archive: () => ({ table: RANK_TABLE, basin: 'atlantic' }),
      });
      kat.view.onEnter('AL122005');
      const drawn = flat(kat.html());
      const marks = rankMarks(
        rankStorm(stormFacts(katrina), RANK_TABLE, 'atlantic', 'imperial'),
        { system: 'imperial' },
      );
      /* The alias is one fact under two names (§57.46) and would double-count. */
      const keys = [...marks.keys()].filter((k) => k !== 'trackDistance');
      ok(`Katrina ranks on every statistic the archive holds \u2014 ${keys.length} `
        + `marks against ${Object.keys(RANK_STATS).length} entries, the distance `
        + 'pair being one fact',
      keys.length === Object.keys(RANK_STATS).length - 1);

      const missing = keys.filter((k) => !drawn.includes(marks.get(k).rank));
      ok('==> EVERY ONE OF THEM REACHES A ROW ON THE PANEL. <== A key '
        + `misspelled in a section loses its rank and its bar in silence. `
        + `Unclaimed: ${missing.join(', ') || 'none'}`,
      missing.length === 0);

      const cells = (drawn.match(/class="has-rank"/g) || []).length;
      ok(`and each one lands in exactly ONE cell, never two \u2014 ${cells} `
        + `marked cells against ${keys.length} marks`,
      cells === keys.length);

      /* ==> AND THE BAR GOES WITH THE RANK, NOT SOMEWHERE ELSE ON THE PANEL.
       * <== §57.54b's whole claim is that label, figure, rank and bar are one
       * fact. A bar drawn outside a marked cell would be the disjointedness
       * this build exists to remove, wearing the new markup. */
      const bars = (drawn.match(/season-spine-plot/g) || []).length;
      ok(`every marked cell carries its bar \u2014 ${bars} bars`, bars === cells);

      ok('==> AND `Where it ranks` STATES NOTHING TWICE. <== The section is '
        + 'deleted, so no figure on this panel carries its rank in two places',
      !drawn.includes('Where it ranks'));
    }
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

  /* Read off her own record rather than typed, so the assertion below cannot
   * drift from what `lib/season-facts.js` actually computes. */
  const katrinaEnding = stormFacts(atl2005.find((s) => s.id === 'AL122005')).ending;

  /* ==> `Where it ranks` IS GONE AND ITS ABSENCE IS ASSERTED RATHER THAN
   * ASSUMED. <== §57.57b. A section deleted from the view but still reachable
   * through some other path would print every ranked figure twice, which is
   * the exact fault this step exists to remove. */
  ok('the rankings table is loaded here, so an archive rank can be drawn at all',
    RANK_TABLE !== null);
  ok('and `Where it ranks` no longer exists as a section',
    !p.html().includes('data-section="rank-archive"'));

  /* ==> THE PANEL IS SIX SECTIONS, IN §57.54f's ORDER, AND THE ORDER IS A
   * NARRATIVE RATHER THAN A PREFERENCE. <== §57.61. Landfalls under the chart
   * it is numbered against, then where the storm came among its season, then
   * how hard it blew, how long it lasted, where it went, and what NOAA wrote.
   * Orientation at the top, detail at the bottom.
   *
   * ==> ASSERTED AS A WHOLE SEQUENCE, NOT AS A HANDFUL OF PAIRS. <== The old
   * version checked three relationships between seven ids and a merge could
   * satisfy all three while dropping a section entirely. This drives the
   * rendered order out of the markup and compares it to the list. */
  const order = (id) => p.html().indexOf(`data-section="${id}"`);
  const SECTIONS = ['landfalls', 'rank-season', 'blew', 'lasted', 'went', 'report'];
  const drawn = [...p.html().matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
  ok('==> NINE SECTIONS ARE SIX. <== §57.54f, step 7',
    drawn.length === 6);
  ok(`and they are in the planned order — ${SECTIONS.join(', ')}`,
    drawn.join(',') === SECTIONS.join(','));

  /* ==> THE FIVE RETIRED IDS ARE ASSERTED ABSENT RATHER THAN ASSUMED GONE.
   * <== §57.61b. A section still reachable through some other path would print
   * every figure in it twice, which is the fault this whole rebuild exists to
   * remove — and it is exactly how `Where it ranks` would have failed at step
   * 3 had its deletion not been asserted. */
  ok('and `peak`, `life`, `change`, `movement` and `windfield` are gone as ids',
    ['peak', 'life', 'change', 'movement', 'windfield']
      .every((id) => order(id) === -1));

  /* ==> `Landfalls` LEADS, DIRECTLY UNDER THE CHART. <== §57.60, step 6. The
   * chart's discs are numbered and this list carries the matching numbers;
   * sections apart they are a puzzle rather than a reference. The chart is not
   * a `section()`, so the assertion is that nothing else comes before this
   * one. */
  ok('`Landfalls` is the first section on the panel, under the chart',
    order('landfalls') !== -1
    && SECTIONS.slice(1).every((id) => order('landfalls') < order(id)));

  /* ==> THE MERGED HEADINGS ARE ON SCREEN AND THE OLD ONES ARE NOT. <== An id
   * is stable and a title is copy, so both are asserted: a merge that moved
   * the ids but left `Strongest` printed above the rows would pass every
   * assertion above this one. */
  for (const [id, title] of [['blew', 'How hard it blew'],
    ['lasted', 'How long it lasted'], ['went', 'Where it went']]) {
    ok(`\`${title}\` is the heading on \`${id}\``,
      new RegExp(`data-section="${id}"[\\s\\S]*?<span>${title}</span>`).test(p.html()));
  }
  ok('and no heading the merge replaced survives anywhere on the panel',
    ['Strongest', 'How it changed', 'Its life', 'How it moved', 'Wind footprint']
      .every((t) => !p.html().includes(`<span>${t}</span>`)));

  /* ==> THREE OPEN AND THREE FOLDED, WHICH IS §57.54f's SET. <== §57.61. The
   * seven distribution bars are spread across three sections since step 3, so
   * `How hard it blew` carries the open slot `Where it ranks` gave up —
   * without it a reader sees no rank and no bar anywhere until they tap. */
  const shutQ = (id) => p.body()
    .querySelector(`.detail-section[data-section="${id}"]`).dataset.collapsed === 'true';
  ok('a fresh reader gets `In its season` open', !shutQ('rank-season'));
  ok('and `How hard it blew` open, so the merged rows are on screen without a tap',
    !shutQ('blew'));
  /* ==> AND `Landfalls` OPEN, BECAUSE FOLDED IT MAKES THE CHART LIE. <==
   * §57.60. The chart's caption tells the reader the numbered marks are the
   * landfalls listed below. Over a folded section that sentence points at a
   * list that is not on screen. */
  ok('and `Landfalls` open, so the numbered discs have their list under them',
    !shutQ('landfalls'));
  ok('and the other three folded, heading still on screen',
    shutQ('lasted') && shutQ('went') && shutQ('report'));

  /* ==> THE ENDING SENTENCE IS ON THE PANEL, INSIDE `How long it lasted`, AND
   * A MUTATION SAID THIS WAS MISSING BEFORE A READING DID. <== §57.61b.
   * Deleting `endingHtml(facts)` from the view's call site left all 221
   * assertions green: `endingHtml` itself was covered, and nothing checked
   * that anything CALLED it. That is the `fastest24h` fault exactly — markup
   * that was correct, tested and never reached, running unseen across 175
   * years of storms until Aaron read a panel. Katrina became extratropical,
   * which is read off her own facts rather than typed. */
  const lasted = p.html().slice(order('lasted'), order('went'));
  ok('==> KATRINA\u2019S ENDING IS DRAWN, AND IT IS DRAWN INSIDE `How long it '
    + 'lasted`. <== Testing the renderer proves the renderer; only the mounted '
    + 'panel proves the call site',
  lasted.includes(M.endingHtml({ ending: katrinaEnding }).replace(/^<p[^>]*>|<\/p>$/g, ''))
    && M.endingHtml({ ending: katrinaEnding }) !== '');
  ok('and it is the last thing that section says, after the lifespan figures '
    + 'and the score, because it is the last thing that happened',
  lasted.lastIndexOf('Power and stamina score') < lasted.indexOf('Became extratropical'));
  ok('and nothing about the ending is left in `How hard it blew`',
    !p.html().slice(order('blew'), order('lasted')).includes('Became extratropical'));

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

  /* ==> EVERY SECTION CARRIES AN ICON, AND EVERY ICON IS A REAL ONE. <==
   * `iconSvg` answers '' for a name that is not in the set, which is the right
   * failure for a drawer and the wrong one for a suite: a typo in a call site
   * costs the glyph silently and the heading just looks slightly wrong. This
   * counts them instead. */
  const heads = p.body().querySelectorAll('.detail-section-head');
  /* ==> SIX, NOT NINE. <== §57.57b deleted `Where it ranks` — 33.2% of the
   * panel measured across all 3,266 storms, every row of it duplicating a
   * label three to five sections away — and §57.61 merged the eight that were
   * left into six. */
  ok('six sections are on the panel', heads.length === 6);
  ok('and every one of them drew an icon, so no call site has a typo in the name',
    (p.html().match(/class="sect-ico"/g) || []).length === heads.length);
  ok('the icon is hidden from a screen reader, the heading beside it being the name',
    !/<svg class="sect-ico"(?![^>]*aria-hidden="true")/.test(p.html()));

  /* ==> NO TWO ADJACENT SECTIONS SHARE A GLYPH. <== The icons exist for
   * SCANNING — a shape at the left edge is what the eye uses to find its place
   * — and two neighbours wearing the same mark is the one arrangement that
   * defeats it. It was a live risk while `In its season` and `Where it ranks`
   * sat adjacent — the same idea at two scales, which "one name, one shape"
   * would otherwise have argued into one glyph. The second of those is gone
   * (§57.57b) and the rule still holds for the six that remain. */
  const glyphs = [...p.html().matchAll(/data-section="([^"]+)"[\s\S]*?<svg class="sect-ico"[^>]*>(.*?)<\/svg>/g)]
    .map((m) => m[2]);
  ok('every section drew a distinguishable glyph', glyphs.length === 6);
  ok('and no two neighbours share one',
    glyphs.every((g, i) => i === 0 || g !== glyphs[i - 1]));
  ok('==> AND ALL SIX ARE DIFFERENT, WHICH IS STRICTER THAN THE RULE NEEDS '
    + 'AND IS THE STATE WORTH DEFENDING. <== Nothing on this panel is the same '
    + 'idea as anything else on it',
  new Set(glyphs).size === 6);
  /* ==> AND NO NEW GLYPH WAS DRAWN FOR STEP 7. <== §57.54f. All six existed
   * before the merge; `podium` and `trend` lost their last callers and stay in
   * `ui/section-icon.js`, because deleting a shape because its caller moved is
   * a second decision riding on the first. */
  ok('the six are the six §57.54f named, taken from the existing set',
    ['pin', 'calendar', 'gauge', 'clock', 'track', 'doc']
      .every((n) => glyphs.includes(ICON_BODY(n))));

  const ariaOf = (id) => p.body()
    .querySelector(`.detail-section[data-section="${id}"] .detail-section-head`)
    .attrs['aria-expanded'];
  ok('an open section announces itself expanded', ariaOf('rank-season') === 'true');
  ok('and a folded one announces itself collapsed', ariaOf('lasted') === 'false');

  /* Pressing a head opens it, and pressing again folds it. `How long it
   * lasted` rather than `How hard it blew`, which opens by default (§57.61). */
  p.press('.detail-section[data-section="lasted"] .detail-section-head');
  ok('pressing a folded head opens that section', !shutQ('lasted'));
  ok('and says so to a screen reader', ariaOf('lasted') === 'true');
  ok('==> AND ONLY THAT SECTION. <== Opening one must not open its neighbours',
    shutQ('went'));

  p.press('.detail-section[data-section="lasted"] .detail-section-head');
  ok('pressing it again folds it', shutQ('lasted'));
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

  /* ==> `Where it went` RATHER THAN `Landfalls`, WHICH OPENS BY DEFAULT. <==
   * §57.60. Pressing a section that already opened would test the fold
   * surviving rather than the open, and the two are not the same assertion:
   * the default is what a reader gets with no record at all, and this is about
   * the record being read back. */
  p.press('.detail-section[data-section="went"] .detail-section-head');
  const open = () => p.body()
    .querySelector('.detail-section[data-section="went"]').dataset.collapsed !== 'true';
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
  /* One default of each kind, so a stored choice for one section cannot be
   * mistaken for the defaults still working. `How long it lasted` folds by
   * default and `How hard it blew` opens (§57.61). */
  ok('and a section the reader never touched still gets its default',
    second.body().querySelector('.detail-section[data-section="lasted"]')
      .dataset.collapsed === 'true'
    && second.body().querySelector('.detail-section[data-section="blew"]')
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

/* ---------------------------------------------------------------------------
 * 12. THE EM DASH, SWEPT AT SOURCE — §57.41, §57.55b
 * ------------------------------------------------------------------------ */
{
  /* ==> §57.41 BANS THE CHARACTER AS A GUARD, NOT AS TYPOGRAPHY. <==
   * `lib/units.js` returns a bare em dash as its MISSING sentinel, so one in
   * rendered text is the cheapest available signal that a figure failed to
   * resolve and got printed anyway. **That guard only works if nothing uses
   * the character decoratively**, and until 2026-08-30 nothing checked: the
   * sweep in `tools/test-season-story.mjs` reads `lib/season-story.js` and
   * stops there, so `ui/season-detail-markup.js` carried four decorative em
   * dashes, one of them on 804 storms.
   *
   * ==> THIS READS SOURCE RATHER THAN OUTPUT, AND THAT IS THE POINT. <== A
   * rendered sweep only sees the branches some fixture happens to reach, which
   * is exactly how the ending sentence survived — it rendered on a quarter of
   * the archive and no assertion ever looked at it. Reading the file reaches
   * every branch, including ones no storm in the record can produce.
   *
   * The rendered sweep in section 2 stays: it catches a SENTINEL that reached
   * the screen, which source cannot see. Two nets, different holes, on
   * purpose. */
  const FAMILY = [
    'ui/season-detail-markup.js', 'ui/season-markup-bits.js',
    'ui/season-rank-markup.js', 'ui/season-shape-markup.js',
    'ui/view-season-detail.js', 'lib/season-story.js', 'lib/season-facts.js',
    'lib/season-company.js', 'lib/season-names.js', 'lib/season-nature.js',
    'lib/season-years.js', 'lib/season-windswath.js',
  ];
  for (const rel of FAMILY) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    /* Comments are where this project explains itself and they are not
     * rendered. The bare string `'\u2014'` is the sentinel being COMPARED
     * against rather than printed (`shortLabel !== '\u2014'`), which is the
     * one legitimate use and the only exemption. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .split("'\u2014'").join('SENTINEL');
    const hit = code.match(/.{0,60}\u2014.{0,60}/);
    ok(`${rel} prints no em dash. \u00A7 57.41 keeps the character free so a `
      + 'failed unit conversion reaching the screen is unmistakable, and a '
      + `decorative one makes that signal useless.${hit ? ` Got: ${hit[0].trim()}` : ''}`,
    !hit);
  }

  /* ==> AND THE SWEEP IS PROVED TO BITE. <== §12: a test that never could go
   * red is decoration. This is the exact string that shipped on 804 storms. */
  const wouldFail = "const s = 'Became extratropical \u2014 it lost its structure.';"
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split("'\u2014'").join('SENTINEL');
  ok('the sweep\u2019s own rule catches the sentence that shipped, and does not '
    + 'catch the sentinel comparison beside it',
  /\u2014/.test(wouldFail)
    && !/\u2014/.test("if (cat !== '\u2014') return cat;".split("'\u2014'").join('SENTINEL')));
}

/* ------------------------------------------------------------------------ */

if (fails.length) {
  console.error(`\n\u2717 ${fails.length} failed, ${pass} passed\n`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\u2713 ${pass} assertions pass — the archive's storm panel, and the `
  + 'three ways it could look right and say something false');
