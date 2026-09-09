#!/usr/bin/env node
/**
 * test-perf-budget.mjs — THE AUDIT'S OWN GATE, TESTED.
 *
 * ===> WHY THIS EXISTS. <=== `perf-audit` failed 25 nightly runs in a row, 21
 * August to 9 September, without ever once measuring a real regression. Two
 * causes, both in this file's blast radius:
 *
 *   1. `styleLoaded` was sampled once at the end of the settle window rather
 *      than latched. MapLibre reports a style as not-loaded while any tile is
 *      in flight, and the globe drifts every frame, so the sample was a coin
 *      toss — and the budget treats a false there as "nothing was measured" and
 *      fails the whole run.
 *   2. `blockedMs` summed long tasks across the entire 14-second window, twelve
 *      seconds of which is a drifting globe on a GPU-less runner, and was then
 *      checked against a threshold that meant the load.
 *
 * ===> AND WHY IT CHECKS THE FAILURES, NOT JUST THE PASSES. <=== A gate is only
 * worth having if it goes red on the thing it is there to catch. Every case
 * below that asserts a pass is paired with one that asserts the same input,
 * pushed over the line, fails. `node tools/test-perf-budget.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitBlocked, mapBuildFromMarks } from './perf-instrument.mjs';
import { checkBudget } from './perf-audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function ok(label, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}`);
  if (!cond) failures++;
}

/* --------------------------------------------------------------------------
 * splitBlocked
 * ------------------------------------------------------------------------ */

{
  /* A load that blocks for 800 ms, then a globe that pins the thread for the
   * rest of the window — the exact shape of every recorded run. */
  const tasks = [
    { start: 200, dur: 300 },
    { start: 1200, dur: 500 },
    { start: 6000, dur: 4000 },
    { start: 10500, dur: 3400 },
  ];
  const s = splitBlocked(tasks, 5000);

  ok('total is every task', s.blockedMs === 8200);
  ok('load half counts only tasks starting inside the window', s.blockedLoadMs === 800);
  ok('load half counts its tasks', s.blockedLoadTaskCount === 2);
  ok('the rest is attributed after', s.blockedAfterMs === 7400);
  ok('the two halves reconstruct the total', s.blockedLoadMs + s.blockedAfterMs === s.blockedMs);
  ok('the window travels with the number', s.blockedWindowMs === 5000);

  /* ==> THIS IS THE BUG, REINTRODUCED. <== Before the split, the whole 8,200 ms
   * was the number checked against a load budget. If `blockedLoadMs` ever again
   * equals the total, the split has silently stopped splitting. */
  ok('the load half is NOT just the total again', s.blockedLoadMs !== s.blockedMs);

  /* A task straddling the boundary belongs to the load, whole. */
  const straddle = splitBlocked([{ start: 4900, dur: 2000 }], 5000);
  ok('a straddling task counts whole against the load', straddle.blockedLoadMs === 2000);

  ok('no tasks is zero, not a crash', splitBlocked([], 5000).blockedMs === 0);
  ok('a missing list is zero, not a crash', splitBlocked(undefined, 5000).blockedMs === 0);
}

/* --------------------------------------------------------------------------
 * mapBuildFromMarks
 * ------------------------------------------------------------------------ */

{
  /* MapLibre's real marks off the 9 Sep runner run. */
  const warm = mapBuildFromMarks({ create: 1268.59, load: 10421.59 });
  ok('a map that loaded is built', warm.styleLoaded === true);
  ok('  ...at MapLibre\'s own load mark, rounded', warm.mapLoadedAtMs === 10422);
  ok('  ...and its creation is reported too', warm.mapCreated === true && warm.mapCreatedAtMs === 1269);
}

{
  /* The radar arm, 9 Sep: created, never finished inside the window. */
  const partial = mapBuildFromMarks({ create: 2559.89 });
  ok('a map created but never loaded is NOT built', partial.styleLoaded === false);
  ok('  ...and has no build time', partial.mapLoadedAtMs === null);
  ok('  ...but is still known to have been created', partial.mapCreated === true);
}

{
  const none = mapBuildFromMarks({});
  ok('no marks at all is not built', none.styleLoaded === false);
  ok('  ...and says the map was never created either', none.mapCreated === false);
  ok('missing marks object does not crash', mapBuildFromMarks(undefined).styleLoaded === false);
}

{
  /* ==> A BUILD AT TIME ZERO IS STILL A BUILD. <== `load: 0` is falsy, and a
   * truthiness check here would report a map that built instantly as one that
   * never built at all. */
  const instant = mapBuildFromMarks({ create: 0, load: 0 });
  ok('a mark of 0 is a real mark, not a missing one', instant.styleLoaded === true);
  ok('  ...and reads as 0 ms, not null', instant.mapLoadedAtMs === 0);
}

{
  /* ==> `fullLoad` IS NOT THE SIGNAL AND MUST NOT BECOME IT. <== It needs the
   * map to fall idle, which a permanently drifting globe may never do — the
   * same trap as isStyleLoaded, one step further along. A map that loaded but
   * never went fully idle is built. */
  const drifting = mapBuildFromMarks({ create: 1000, load: 9000 });
  ok('a map that never falls idle is still built', drifting.styleLoaded === true);
}

/* --------------------------------------------------------------------------
 * checkBudget
 * ------------------------------------------------------------------------ */

/** Last night's real warm-sw numbers, off the perf-history branch, 8 Sep. */
function warmArm(over = {}) {
  return {
    arm: 'warm-sw',
    styleLoaded: true,
    mapLoadedAtMs: 10422,
    ourModules: 213,
    ourWaves: 4,
    staircaseMs: 603,
    blockedMs: 13915,
    blockedLoadMs: 900,
    transferKB: 206,
    colorNullsMainThread: 0,
    data: { depth: 2 },
    ...over,
  };
}
const radar = { radarOnPan: 3 };
const LIVE = JSON.parse(fs.readFileSync(path.join(HERE, 'perf-budget.json'), 'utf8'));

{
  const r = checkBudget([warmArm()], radar, LIVE);
  ok('last night\'s real numbers now pass the shipped budget', r.ok === true);
  ok('  ...and it did check things, it did not skip them',
    r.notes.filter((n) => n.startsWith('ok   ')).length >= 5);
}

{
  /* ==> THE REGRESSION IT EXISTS TO CATCH. <== 240 modules is the ceiling; 241
   * must be red, or the number is decoration. */
  const r = checkBudget([warmArm({ ourModules: 241 })], radar, LIVE);
  ok('one module over the ceiling fails', r.ok === false);
  ok('  ...and says which one', r.notes.some((n) => n.startsWith('FAIL ourModules')));
}

{
  const r = checkBudget([warmArm({ transferKB: 901 })], radar, LIVE);
  ok('a transfer regression fails', r.ok === false);
}

{
  const r = checkBudget([warmArm({ data: { depth: 7 } })], radar, LIVE);
  ok('a deeper data waterfall fails', r.ok === false);
}

{
  const r = checkBudget([warmArm()], { radarOnPan: 121 }, LIVE);
  ok('a radar tile storm on pan fails', r.ok === false);
}

{
  /* A null budget MEASURES and REPORTS and cannot fail — but it must not go
   * quiet, because a null is a debt somebody has to come back and pay. */
  const r = checkBudget([warmArm({ blockedMs: 999999 })], radar, LIVE);
  ok('a null budget cannot fail the run', r.ok === true);
  ok('  ...but it still prints its number', r.notes.some((n) => n.includes('blockedMs: 999999')));
  ok('  ...and marks itself uncalibrated', r.notes.some((n) => n.includes('no budget yet')));
}

{
  /* ==> THE OTHER HALF OF THE THREE-WEEK FAILURE. <== A false styleLoaded still
   * has to fail — the fix was to stop producing a spurious one, NOT to stop
   * caring. A map that genuinely never builds must still turn the job red. */
  const r = checkBudget([warmArm({ styleLoaded: false })], radar, LIVE);
  ok('a map that never built still fails', r.ok === false);
  ok('  ...and says so in words', r.notes.some((n) => n.includes('FAIL styleLoaded')));
}

{
  const r = checkBudget([], radar, LIVE);
  ok('no arm at all fails rather than passing on silence', r.ok === false);
}

{
  /* The shipped budget must not drift into being unpassable again. Every
   * non-null ceiling has to sit at or above what the runner actually measured
   * on 8 Sep, or this file is back where it started. */
  const observed = warmArm();
  const tooTight = Object.entries(LIVE.max)
    .filter(([k, v]) => v !== null && typeof observed[k] === 'number' && observed[k] > v);
  ok(`no shipped ceiling sits below the 8 Sep measurement${tooTight.length ? ' — ' + JSON.stringify(tooTight) : ''}`,
    tooTight.length === 0);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
