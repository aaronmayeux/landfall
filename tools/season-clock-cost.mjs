/**
 * season-clock-cost.mjs — what the season clock costs, counted off the real
 * 2005 file. §57.23, §57.35 fault 3.
 *
 * ==> IT PRINTS NUMBERS RATHER THAN PASSING OR FAILING, AND IT IS NOT A GATE.
 * <== Every figure in the spec about this feature has to come from running
 * this against the real bytes, never from arithmetic in somebody's head —
 * CLAUDE.md's first rule. Three of the sentences in §57.23a were wrong until
 * this was written, including a claim that the trail "grows in chunks" which
 * is true for four storms and flatly false for one.
 *
 * ==> AND EVERY NUMBER IT PRINTS IS A NODE NUMBER. <== The cut arithmetic is
 * ours and node measures it honestly. What it says NOTHING about is MapLibre
 * parsing and re-indexing the pushed geometry, style recalculation, or paint —
 * which is where a phone actually spends its time, and which this sandbox
 * cannot measure at all because the basemap is blocked. The vertex counts
 * below are the useful half: they are the SIZE of what gets handed over, and
 * that is the thing to argue about when the frame rate is judged on glass.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseHurdat2 } = await import(`${R}/lib/hurdat.js`);
const { buildTimeline, cutTimeline, clockSpan, msPerStep, trailFingerprint } =
  await import(`${R}/lib/season-clock.js`);
const { SEASONS } = await import(`${R}/config/constants.js`);

const { storms } = parseHurdat2(readFileSync(`${R}/samples/seasons/seasons/al-2005.txt`, 'utf8'));
console.log(`2005 Atlantic: ${storms.length} storms parsed`);

for (const n of [1, 4, storms.length]) {
  const set = storms.slice(0, n);
  const t0 = performance.now();
  const tracks = set.map((s) => ({ s, timeline: buildTimeline(s) }));
  const buildMs = performance.now() - t0;

  const live = tracks.filter((t) => t.timeline);
  const span = clockSpan(live);
  if (!span) { console.log(`  ${n}: no span`); continue; }

  const stormStep = msPerStep(SEASONS.clockDaysPerSecond, SEASONS.clockStepsPerSecond);
  const verts = live.reduce((a, t) => a + t.timeline.coords.length, 0);

  let steps = 0, pushes = 0, last = '', cutMs = 0, maxDrawn = 0;
  const c0 = performance.now();
  for (let t = span.startMs; t <= span.endMs; t += stormStep) {
    const cuts = live.map((x) => ({ id: x.s.id, ...cutTimeline(x.timeline, t) }));
    const drawn = cuts.reduce((a, c) => a + (c.coords?.length || 0), 0);
    if (drawn > maxDrawn) maxDrawn = drawn;
    const p = trailFingerprint(cuts);
    steps++;
    if (p !== last) pushes++;
    last = p;
  }
  cutMs = performance.now() - c0;

  console.log(`  ${String(n).padStart(2)} ticked: build ${buildMs.toFixed(1)}ms, ` +
    `${verts} vertices held, ${steps} steps over ${(span.endMs-span.startMs)/86400000|0}d, ` +
    `${pushes} trail pushes (${(100*pushes/steps).toFixed(0)}%), ` +
    `cut arithmetic ${(cutMs/steps).toFixed(3)}ms/step, peak ${maxDrawn} vertices drawn`);
}
