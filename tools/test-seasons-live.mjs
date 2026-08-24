/**
 * test-seasons-live.mjs — the season in progress. §57.30 step 5b, §58.1, §58.2.
 *
 * ==> IT DRIVES THE REAL MODULE AGAINST THE REAL B-DECKS. <== `fetch` is
 * stubbed, because there is no network in the sandbox and NHC is behind the
 * wall besides — but everything behind that stub is the shipped code reading
 * the bytes in `samples/seasons-live/`, which the hourly mirror captured off
 * NOAA. A suite built on an invented b-deck would pass while getting the
 * merge, the name and the basin all wrong.
 *
 * WHAT IT EXISTS TO CATCH, in order of how much they would cost:
 *   1. A season that failed reading as a season that was quiet (§5).
 *   2. Lala and Moke falling off the board because CP is not EP.
 *   3. Storms that would not load vanishing silently instead of being counted.
 *   4. The year being taken off the clock instead of off the filenames.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SAMPLES = join(ROOT, 'samples', 'seasons-live');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);

if (!existsSync(SAMPLES)) {
  console.error(`\n  seasons-live: ${SAMPLES} is missing — the real b-decks are the point of this suite`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * THE WIRE. One stub, driven by a script the test sets per case.
 * ------------------------------------------------------------------------ */

const FILES = readdirSync(SAMPLES).filter((f) => /^b[a-z]{2}\d{6}\.dat$/i.test(f));
const IDS = FILES.map((f) => f.replace(/^b|\.dat$/gi, '').toLowerCase());

/** The listing the live route would have produced from those files.
 *
 * ==> THE CENTRAL PACIFIC IS REAL BYTES NOW, NOT TWO ENTRIES TYPED IN HERE.
 * <== `bcp012026.dat` and `bcp022026.dat` — Lala and Moke — were pulled off
 * the `seasons-live` mirror into `samples/seasons-live/` when this suite grew,
 * and CP is the case a naive basin match drops. A hand-written pair pointing
 * at no file could only ever prove the FILTER, never the load. */
const LIVE_BODY = {
  status: 'ok',
  years: [2026],
  source: 'atcf',
  provisional: true,
  listed: IDS.length,
  storms: IDS.map((id) => ({
    id, basin: id.slice(0, 2).toUpperCase(), number: Number(id.slice(2, 4)), year: 2026,
  })),
  skipped: [],
};

/** What the stub should do. Reset per case. */
let plan;

function resetPlan(over = {}) {
  plan = {
    liveStatus: 200,
    liveBody: LIVE_BODY,
    liveHeaders: {},
    /** ids that should 500 rather than answer */
    failStorms: new Set(),
    /** every URL asked for, in order */
    asked: [],
    /** how many storm fetches were open at the same moment */
    peakOpen: 0,
    ...over,
  };
}

let open = 0;

globalThis.fetch = async (url) => {
  plan.asked.push(url);

  if (url.startsWith('/api/seasons/live')) {
    return {
      ok: plan.liveStatus === 200,
      status: plan.liveStatus,
      headers: { get: (k) => plan.liveHeaders[k] ?? null },
      json: async () => plan.liveBody,
    };
  }

  const id = decodeURIComponent(url.split('id=')[1] || '');
  open++;
  plan.peakOpen = Math.max(plan.peakOpen, open);
  /* A real turn of the event loop, so the concurrency cap is actually
   * exercised rather than every request resolving before the next starts. */
  await new Promise((r) => setTimeout(r, 1));
  open--;

  if (plan.failStorms.has(id) || !FILES.includes(`b${id}.dat`)) {
    return { ok: false, status: 500, headers: { get: () => null }, text: async () => '' };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => readFileSync(join(SAMPLES, `b${id}.dat`), 'utf8'),
  };
};

const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(' ')); };

const {
  loadLiveIndex, loadLiveSeason, liveStormsIn, clearLiveCache,
} = await import('../data/seasons-live.js');
const { SEASONS } = await import('../config/constants.js');

const fresh = async (over) => { resetPlan(over); clearLiveCache(); warns.length = 0; };

/* ---------------------------------------------------------------------------
 * 1. THE INDEX, AND THE YEAR COMES OFF THE FILENAMES.
 * ------------------------------------------------------------------------ */
{
  await fresh();
  const idx = await loadLiveIndex();
  eq('the live index loads', idx.status, 'ok');
  eq('and the season is the newest year the LISTING named, not the clock',
    idx.year, 2026);
  ok('the storms ride along', idx.storms.length === LIVE_BODY.storms.length);
  eq('a fresh answer is not marked stale', idx.stale, false);
}

{
  /* ==> THE CLOCK MUST NOT GET A VOTE. <== A directory still showing last
   * season in January is the ordinary condition, not an error. */
  await fresh({ liveBody: { ...LIVE_BODY, years: [2024, 2025] } });
  const idx = await loadLiveIndex();
  eq('two years in the listing resolves to the newer one', idx.year, 2025);
}

{
  await fresh({ liveBody: { ...LIVE_BODY, years: [] } });
  const idx = await loadLiveIndex();
  eq('a listing naming no year has no live season rather than a guessed one',
    idx.year, null);
}

{
  await fresh({ liveStatus: 502 });
  const idx = await loadLiveIndex();
  eq('a failed route is unavailable, never an empty season', idx.status, 'unavailable');
  ok('and it says why', String(idx.reason).includes('502'));
}

{
  await fresh({ liveHeaders: { 'X-Landfall-Stale': 'true' } });
  const idx = await loadLiveIndex();
  eq('a stored answer is carried through as stale', idx.stale, true);
}

/* ---------------------------------------------------------------------------
 * 2. THE CENTRAL PACIFIC RIDES WITH THE EAST PACIFIC.
 *
 * Measured, not assumed: this repo's own `epacific-2024` holds CP012024 and
 * `epacific-2025` holds CP012025 and CP022025, so NOAA files them together and
 * the live half has to agree or Lala and Moke fall off the board.
 * ------------------------------------------------------------------------ */
{
  await fresh();
  const idx = await loadLiveIndex();

  const atl = liveStormsIn(idx, 'atlantic', 2026).map((s) => s.id);
  const pac = liveStormsIn(idx, 'epacific', 2026).map((s) => s.id);

  ok('the Atlantic takes only AL', atl.every((id) => id.startsWith('al')));
  ok('and it takes all of them', atl.length === IDS.filter((i) => i.startsWith('al')).length);
  ok('the Pacific takes EP', pac.some((id) => id.startsWith('ep')));
  ok('==> AND IT TAKES CP, WHICH IS THE WHOLE POINT <==',
    pac.includes('cp012026') && pac.includes('cp022026'));
  ok('no storm lands in both basins', atl.every((id) => !pac.includes(id)));

  eq('a basin with no live half gets nothing rather than everything',
    liveStormsIn(idx, 'westpac', 2026), []);
  eq('and a different year gets nothing', liveStormsIn(idx, 'atlantic', 2025), []);

  /* The settled files are the authority for this, so read them rather than
   * restating the claim. */
  const dir = join(ROOT, 'seasons', 'data');
  const ep25 = readdirSync(dir).find((f) => /^epacific-2025-/.test(f));
  ok('the settled record files CP under epacific, which is why the above is right',
    ep25 ? /^CP\d{6}/m.test(readFileSync(join(dir, ep25), 'utf8')) : false);
}

/* ---------------------------------------------------------------------------
 * 3. A SEASON LOADS, AND IT IS THE REAL BYTES.
 * ------------------------------------------------------------------------ */
{
  await fresh();
  const idx = await loadLiveIndex();
  const res = await loadLiveSeason(idx, 'atlantic', 2026);

  eq('the Atlantic season loads', res.status, 'ok');
  eq('it is stamped provisional, because §57.11 needs the app to say which record', res.provisional, true);
  eq('nothing was unreadable', res.unreadable, 0);
  eq('the three Atlantic storms are there',
    res.storms.map((s) => s.name), ['ARTHUR', 'BERTHA', 'CRISTOBAL']);
  ok('every storm carries points', res.storms.every((s) => s.points.length > 0));
  ok('and every storm is itself marked provisional by the parser',
    res.storms.every((s) => s.provisional === true));

  /* Chronological by when each storm BEGAN — the order §57.18 says the roster
   * is. Storm number is nearly the same thing and not reliably so. */
  const starts = res.storms.map((s) => s.points[0].time);
  ok('the season is in the order it happened',
    starts.every((t, i) => i === 0 || t >= starts[i - 1]));

  /* ==> THE B-DECK CARRIES NO LANDFALL MARK, AND THE BOARD'S DASH DEPENDS ON
   * IT. <== ATCF's twenty-third column is the SUBREGION letter — an `L` on
   * every Atlantic row that means nothing of the kind — so a parser reading it
   * as a landfall would fill the archive with hundreds of false marks. */
  const marks = res.storms.flatMap((s) => s.points)
    .filter((p) => String(p.marker || '').toUpperCase() === 'L');
  eq('no b-deck point is read as a landfall', marks.length, 0);
}

{
  await fresh();
  const idx = await loadLiveIndex();
  const res = await loadLiveSeason(idx, 'epacific', 2026);
  eq('the Pacific season loads', res.status, 'ok');
  ok('and it is the bigger one', res.storms.length >= 9);
  ok('Genevieve is in it', res.storms.some((s) => s.name === 'GENEVIEVE'));

  /* ==> LALA AND MOKE ARRIVE AS TRACKS, NOT JUST AS IDS THAT PASSED A FILTER.
   * <== Section 2 proves the mapping keeps them; this proves the bytes behind
   * them parse and reach the board. They are the only Central Pacific storms
   * in the record this year, so a basin match that dropped CP would take this
   * whole ocean off the archive with nothing on screen saying so. */
  const cp = res.storms.filter((s) => s.basin === 'CP');
  eq('both Central Pacific storms load with the rest',
    cp.map((s) => s.name).sort(), ['LALA', 'MOKE']);
  ok('and they carry real tracks', cp.every((s) => s.points.length > 10));
}

/* ---------------------------------------------------------------------------
 * 4. THE CONCURRENCY CAP IS REAL.
 * ------------------------------------------------------------------------ */
{
  await fresh();
  const idx = await loadLiveIndex();
  await loadLiveSeason(idx, 'epacific', 2026);
  ok(`no more than ${SEASONS.liveFetchConcurrency} storm fetches are open at once (peak ${plan.peakOpen})`,
    plan.peakOpen <= SEASONS.liveFetchConcurrency);
  ok('and it actually reached the cap rather than never trying',
    plan.peakOpen === SEASONS.liveFetchConcurrency);
}

/* ---------------------------------------------------------------------------
 * 5. §5 — THE THREE STATES, AND THE ONE THAT MATTERS.
 * ------------------------------------------------------------------------ */
{
  /* A basin with no storms yet is a REAL answer. In January it is simply true,
   * and it must not read as a failure. */
  await fresh();
  const idx = await loadLiveIndex();
  const res = await loadLiveSeason(idx, 'atlantic', 2025);
  eq('a basin-year the season has no storms for is ok, not unavailable', res.status, 'ok');
  eq('with an empty list', res.storms.length, 0);
  eq('and it did not ask the network for anything',
    plan.asked.filter((u) => u.includes('storm?id=')).length, 0);
}

{
  /* ==> EVERY STORM FAILING IS AN OUTAGE, NOT A QUIET SEASON. <== The purest
   * form of the bug §5 exists to forbid. */
  await fresh({ failStorms: new Set(IDS.filter((i) => i.startsWith('al'))) });
  const idx = await loadLiveIndex();
  const res = await loadLiveSeason(idx, 'atlantic', 2026);
  eq('every storm failing is unavailable, never an empty season', res.status, 'unavailable');
  ok('and it names the scale of it', /3 storms/.test(String(res.reason)));
}

{
  /* Partial. The gap is COUNTED and served, because twelve of fifteen is a
   * useful answer and a silent twelve is not. */
  await fresh({ failStorms: new Set(['al022026']) });
  const idx = await loadLiveIndex();
  const res = await loadLiveSeason(idx, 'atlantic', 2026);
  eq('one storm failing still serves the rest', res.status, 'ok');
  eq('the survivors are there', res.storms.map((s) => s.name), ['ARTHUR', 'CRISTOBAL']);
  eq('==> AND THE GAP IS COUNTED RATHER THAN SWALLOWED <==', res.unreadable, 1);
  ok('and named in the console for the next session',
    warns.some((w) => w.includes('al022026')));
}

/* ---------------------------------------------------------------------------
 * 6. A FAILURE IS RETRYABLE.
 *
 * A rejected promise left in the cache turns one bad moment on a train into a
 * permanently broken season, and the Retry button into a lie.
 * ------------------------------------------------------------------------ */
{
  await fresh({ failStorms: new Set(['al012026']) });
  const idx = await loadLiveIndex();
  const first = await loadLiveSeason(idx, 'atlantic', 2026);
  eq('the first attempt is short one storm', first.unreadable, 1);

  plan.failStorms = new Set();
  const second = await loadLiveSeason(idx, 'atlantic', 2026);
  eq('==> AND A SECOND ATTEMPT IS A REAL SECOND ATTEMPT <==', second.unreadable, 0);
  eq('so the storm comes back', second.storms.map((s) => s.name),
    ['ARTHUR', 'BERTHA', 'CRISTOBAL']);
}

{
  /* The other half: a SUCCESS is shared rather than refetched, so two callers
   * asking at once cost one request. */
  await fresh();
  const idx = await loadLiveIndex();
  await loadLiveSeason(idx, 'atlantic', 2026);
  const firstCount = plan.asked.filter((u) => u.includes('storm?id=')).length;
  await loadLiveSeason(idx, 'atlantic', 2026);
  eq('a season already held costs no second request',
    plan.asked.filter((u) => u.includes('storm?id=')).length, firstCount);
}

/* ------------------------------------------------------------------------ */

console.warn = realWarn;

if (fails.length) {
  console.error(`\n  seasons-live: ${fails.length} FAILED, ${pass} passed\n`);
  for (const f of fails) console.error(`   ✗ ${f}`);
  process.exit(1);
}
console.log(`\n  ok    seasons-live — ${pass} assertions over the real 2026 b-decks\n`);
