#!/usr/bin/env node
/**
 * test-silence.mjs — the "source stopped publishing" backstop (SPEC §5).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-silence.mjs`, same as every other
 * suite here (§12 — this project has no toolchain by design).
 *
 * THE FIXTURES ARE NOT SYNTHETIC, and that is the point of this file. Every
 * timestamp below is a real one, read off the live feeds on 2026-07-26:
 * Noul's frozen 00:00Z analysis, the 16:37Z `datemodified` that moved without
 * it, and Bertha's ~58-hour freeze from two days earlier. The bug this guards
 * was invisible to a synthetic fixture precisely because nothing failed — the
 * feed answered 200 with well-formed data that was simply old. A made-up
 * storm would have passed every one of these tests while the real one lied.
 *
 * WHAT THIS CANNOT PROVE: that the map actually stops drawing the cone. That
 * is main.js wiring plus MapLibre, and it belongs on glass. What it proves is
 * that the decision is right and that the bundle handed to the map has nothing
 * forward-looking left in it.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const {
  isSilent, silenceAge, silenceBundle, silenceNote, silenceSectionNote,
  silenceHours, sourceName, SILENCED_SLOTS, SILENT_SHORT,
} = await import('../lib/silence.js');
const { SILENCE, ADVISORY_CADENCE } = await import('../config/constants.js');
const { sortStorms } = await import('../data/merge.js');

const HOUR = 3600 * 1000;

/* --- the threshold -------------------------------------------------------- */
section('the threshold');
ok(SILENCE.after === 24 * HOUR, 'silence fires at 24 h');
ok(SILENCE.after === 4 * ADVISORY_CADENCE, 'derived from the cadence, not hand-typed');
ok(silenceHours() === 24, 'the copy helper reports the same 24 the constant carries');

/* --- NOUL-26, the live case ----------------------------------------------
 * GDACS episode 13, analysis 2026-07-26T00:00:00Z, and no episode 14. The
 * storm came ashore in Guangdong and the publisher went quiet at the fix
 * BEFORE landfall, so the cone on screen was a pre-landfall forecast being
 * drawn as a live future. */
section('NOUL-26 (real, 2026-07-26)');
const noul = {
  id: 'gdacs:1001294', source: 'gdacs', name: 'NOUL-26', basin: 'WP',
  observedAt: '2026-07-26T00:00:00Z',
  /* GDACS moved this to 16:37Z on a day it published no new analysis. It is
   * on the fixture so that anything ever reaching for it fails loudly here. */
  raw: { datemodified: '2026-07-26T16:37:09' },
};
const at = (iso) => Date.parse(iso);

ok(silenceAge(noul, at('2026-07-26T17:00:00Z')) === 17 * HOUR, 'age reads off the analysis time');
ok(isSilent(noul, at('2026-07-26T17:00:00Z')) === false, '17 h after the last fix: not yet silent');
ok(isSilent(noul, at('2026-07-26T23:59:00Z')) === false, 'one minute short of 24 h: still not silent');
ok(isSilent(noul, at('2026-07-27T00:01:00Z')) === true, 'just past 24 h: silent');
ok(isSilent(noul, at('2026-07-29T00:00:00Z')) === true, 'three days on: still silent');

/* THE DECOY. `datemodified` is fresher than the analysis on the same payload,
 * and a backstop reading it would never fire — not on Noul, not on Bertha. */
const decoyed = { ...noul, observedAt: noul.raw.datemodified };
ok(
  isSilent(decoyed, at('2026-07-27T12:00:00Z')) === false,
  'DECOY: reading datemodified instead would keep a frozen storm looking live'
);

/* --- BERTHA, the case that exposed the gap --------------------------------
 * NHC retired her entirely; GDACS kept `iscurrent: "true"` with a last
 * analysis of 07-24 03:00Z. `iscurrent` is a "not archived yet" flag, not a
 * liveness flag, and this is the proof. */
section('BERTHA (real, 2026-07-24)');
const bertha = { id: 'gdacs:x', source: 'gdacs', observedAt: '2026-07-24T03:00:00Z' };
ok(isSilent(bertha, at('2026-07-25T03:00:00Z')) === false, 'exactly 24 h: not silent (strictly greater)');
ok(isSilent(bertha, at('2026-07-25T04:00:00Z')) === true, 'caught at 25 h, well inside her 58-hour freeze');

/* --- a live storm must never trip ---------------------------------------- */
section('live storms are untouched');
const live = { id: 'nhc:al052026', source: 'nhc', observedAt: '2026-07-26T15:00:00Z' };
ok(isSilent(live, at('2026-07-26T17:00:00Z')) === false, 'a 2 h old NHC advisory is not silent');
ok(
  isSilent({ source: 'nhc', observedAt: '2026-07-26T05:00:00Z' }, at('2026-07-26T17:00:00Z')) === false,
  'twelve hours — two missed 6 h cycles — is still not silent'
);

/* UNKNOWN IS NOT SILENT. A stamp we could not parse is a fact we do not have;
 * hiding a cone on our own parse failure would be inventing one. */
ok(isSilent({ source: 'gdacs', observedAt: null }) === false, 'null stamp -> not silent');
ok(isSilent({ source: 'gdacs', observedAt: 'not a date' }) === false, 'unparseable stamp -> not silent');
ok(isSilent(null) === false, 'no storm at all -> not silent, no throw');

/* --- the bundle ----------------------------------------------------------- */
section('bundle: history kept, future dropped');
const slot = (n) => ({ status: 'ok', fc: { type: 'FeatureCollection', features: new Array(n).fill({}) }, error: null });
const full = {
  layers: {
    cone: slot(1), forecastTrack: slot(1), forecastPoints: slot(11),
    watchWarning: slot(3), modelTracks: slot(5), windCurrent: slot(3),
    pastTrack: slot(1), windSwath: slot(1),
  },
  forecast: [{ lon: 114, lat: 23, time: '2026-07-26T12:00:00Z' }],
  stamp: { advisnum: '13', filedate: '2026-07-26T00:00:00Z' },
};
const quiet = silenceBundle(full);

for (const k of SILENCED_SLOTS) {
  ok(quiet.layers[k].status === 'none', `${k} is emptied`);
  ok(quiet.layers[k].fc === null, `${k} carries no features`);
}
ok(quiet.layers.pastTrack.status === 'ok', 'pastTrack SURVIVES — a day-old record of the past is still true');
ok(quiet.layers.windSwath.status === 'ok', 'windSwath SURVIVES — it describes winds already laid down');
ok(quiet.forecast.length === 0, 'forecast points cleared, so closest-approach has nothing to compute');
ok(quiet.stamp.advisnum === '13', 'stamp preserved — the panel still names the surviving advisory');

/* `none`, never `unavailable`: nothing failed here, and a layer row reporting
 * a fault it did not have sends someone hunting a healthy endpoint. */
ok(
  SILENCED_SLOTS.every((k) => quiet.layers[k].status !== 'unavailable'),
  'emptied slots read as none, not as a failed fetch'
);

/* NO MUTATION. The bundle is a cached object shared with the ambient
 * collections; writing into it would silence a storm permanently, including
 * after a fresh advisory arrives and un-silences it. */
ok(full.layers.cone.status === 'ok', 'the original bundle is not mutated');
ok(full.forecast.length === 1, 'the original forecast array is not mutated');
ok(silenceBundle(null) === null, 'null bundle passes through');
ok(silenceBundle({ error: 'boom' }).error === 'boom', 'a bundle with no layers passes through untouched');

/* --- the copy ------------------------------------------------------------- */
section('copy');
const note = silenceNote(noul, at('2026-07-27T02:00:00Z'));
ok(note !== null, 'a silent storm produces a note');
ok(note.headline.startsWith('No updates from GDACS since '), 'headline names the agency and leads with the fact');
ok(note.detail.includes('24 hours'), 'detail states the threshold, derived from the constant');
ok(note.detail.includes('may no longer be active'), 'detail hedges — we know the publisher stopped, not that the storm did');
ok(/hidden/i.test(note.detail), 'detail ACCOUNTS for the removed forecast, so a missing cone is not read as a broken app');
ok(!/dissipat|ended|over|retired/i.test(note.headline + note.detail), 'no wording claims the storm is finished');

ok(silenceNote(live, at('2026-07-26T17:00:00Z')) === null, 'a live storm produces no note');
ok(
  silenceNote({ source: 'gdacs', observedAt: '2020-01-01T00:00:00Z' }).headline.includes('since'),
  'an old-but-parseable stamp still gets an absolute time'
);
ok(
  silenceNote({ source: 'nhc', observedAt: '2020-01-01T00:00:00Z' }).headline
    .includes('the National Hurricane Center'),
  'NHC gets its own name — the template is source-agnostic'
);
ok(sourceName('what') === 'this storm’s source', 'an unknown source credits nobody');

const secNote = silenceSectionNote(noul, at('2026-07-27T02:00:00Z'));
ok(/^Hidden — no update from GDACS/.test(secNote), 'section note says HIDDEN, never "none"');
ok(
  !/none|no watches|no wind|clear/i.test(secNote),
  'THE ALL-CLEAR TRAP: a hidden watch/warning must never read as nothing in effect'
);
ok(silenceSectionNote(live, at('2026-07-26T17:00:00Z')) === null, 'live storms get no section note');
ok(SILENT_SHORT === 'not updating', 'the short form is the agreed wording');

/* --- ordering ------------------------------------------------------------- */
section('sort: silent sinks');
const wp = (name, kt, obs) => ({
  id: name, name, source: 'gdacs', basin: 'WP', windKt: kt, observedAt: obs,
});
const now = at('2026-07-27T12:00:00Z');
/* The silent storm is the STRONGEST in the basin, which is exactly the case
 * that used to float a dead typhoon to the top of the list. */
const order = sortStorms([
  wp('WEAK-LIVE', 40, '2026-07-27T09:00:00Z'),
  wp('STRONG-SILENT', 120, '2026-07-26T00:00:00Z'),
  wp('MID-LIVE', 70, '2026-07-27T06:00:00Z'),
], now).map((s) => s.name);
ok(order[2] === 'STRONG-SILENT', 'a silent typhoon sorts BELOW every live storm in its basin');
ok(order[0] === 'MID-LIVE' && order[1] === 'WEAK-LIVE', 'live storms keep strongest-first among themselves');

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (fixtures are REAL timestamps from Noul and Bertha — but the map still needs a look on glass)');
