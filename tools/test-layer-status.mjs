#!/usr/bin/env node
/**
 * test-layer-status.mjs — what each Layers row says about itself.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * WHY THIS SUITE EXISTS. These decisions lived inside boot()'s closure, where
 * nothing could reach them, and in that state they produced TWO of the §5
 * silences this project is built to prevent — a row that said nothing at all
 * with a typhoon on screen, and a row that swallowed a partial outage because
 * something else was drawing. Both were reasoning errors in pure logic that no
 * test could see. Every assertion below is one of those, or a neighbour of one.
 *
 * WHAT IT CANNOT PROVE: that the row LOOKS right, or that the retry button
 * actually refetches. Those are glass.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const {
  rowForOneDeck,
  rowForAllDecks,
  deckCandidates,
  modelTracksRow,
  rowForOneShips,
  rowForAllShips,
  shipsCandidates,
  environmentRow,
  createLayerStatus,
} = await import('../app/layer-status.js');

/* Storms, in the shape lib/lifecycle.js reads. */
const live = (id, source = 'nhc') => ({ id, source, advisoryKey: `${id}-1` });
const ended = (id, source = 'nhc') => ({
  id, source, advisoryKey: `${id}-1`,
  ended: { reason: 'declared', by: 'NHC', at: Date.now() },
});

/* --- one storm ----------------------------------------------------------- */
section('one storm');
ok(rowForOneDeck(undefined).state === 'loading',
   'a deck nobody has asked for yet is LOADING, not empty');
ok(rowForOneDeck({ status: 'ok' }) === null,
   'a healthy deck says nothing — the lines on screen are the message');
ok(rowForOneDeck({ status: 'unavailable' }).state === 'error',
   'a failed fetch is an error');
ok(/retry/i.test(rowForOneDeck({ status: 'unavailable' }).message),
   'an error offers the retry');
ok(rowForOneDeck({ status: 'unsupported' }).state === 'empty',
   'a basin nobody files a deck for is EMPTY, not an error');
ok(!/retry/i.test(rowForOneDeck({ status: 'unsupported' }).message),
   'a coverage gap offers no retry — none would help');
ok(!/no model/i.test(rowForOneDeck({ status: 'unsupported' }).message),
   'coverage wording never claims no model forecasts the storm');
ok(rowForOneDeck({ status: 'none' }).state === 'empty',
   'a deck that exists and holds nothing is empty');

/* --- the whole set -------------------------------------------------------
 * ===> THE SILENCE THAT SHIPPED. <=====================================
 * This returned null the moment ANY deck was ok. Two feeds fail independently,
 * so "some ok, some broken" is the NORMAL shape of an outage here — and it was
 * the one shape guaranteed to be swallowed. */
section('the whole set');
ok(rowForAllDecks([{ status: 'ok' }, { status: 'unavailable' }])?.state === 'error',
   'ONE broken deck among healthy ones still reports — a healthy storm does not excuse a broken one');
ok(/some storms/i.test(rowForAllDecks([{ status: 'ok' }, { status: 'unavailable' }]).message),
   'a partial failure says SOME, not all');
ok(/retry/i.test(rowForAllDecks([{ status: 'ok' }, { status: 'unavailable' }]).message),
   'a partial failure keeps the retry — the network is demonstrably fine');

ok(rowForAllDecks([{ status: 'ok' }, { status: 'unsupported' }]) === null,
   'a coverage gap beside a drawing deck is not worth interrupting the row');
ok(rowForAllDecks([{ status: 'ok' }, undefined]) === null,
   'a deck still in flight beside a drawing one is not a fault');

ok(rowForAllDecks([undefined, { status: 'none' }]).state === 'loading',
   'nothing drawing and something still in flight is loading');
ok(rowForAllDecks([{ status: 'unavailable' }, { status: 'unavailable' }]).state === 'error',
   'every deck failed is a total error');
ok(rowForAllDecks([{ status: 'unsupported' }, { status: 'unsupported' }]).state === 'empty',
   'every storm in an unfiled basin is a coverage statement');
ok(!/retry/i.test(rowForAllDecks([{ status: 'unsupported' }, { status: 'unsupported' }]).message),
   'a total coverage gap still offers no retry');
ok(rowForAllDecks([{ status: 'none' }, { status: 'unsupported' }]).state === 'empty',
   'a mix of nothing-published and unfiled is empty, not an error');
ok(rowForAllDecks([]) === null, 'no candidates -> nothing to say');
ok(rowForAllDecks(null) === null, 'null -> nothing to say, not a throw');

/* --- candidates ---------------------------------------------------------- */
section('who can carry a deck');
ok(deckCandidates([live('a'), live('b', 'gdacs')]).length === 2,
   'BOTH feeds are candidates — TCGP covers the GDACS basins');
ok(deckCandidates([live('a'), ended('b')]).length === 1,
   'an ended storm is not a candidate — it has no deck and never will');
ok(deckCandidates([live('a'), { id: 'x', source: 'test' }]).length === 1,
   'a storm from neither feed is left out');
ok(deckCandidates(null).length === 0, 'null storms -> [], not a throw');

/* ===> THE OTHER SILENCE THAT SHIPPED. <================================
 * This filtered to NHC storms, which was a true description of coverage until
 * TCGP arrived. With only a typhoon on screen the row then returned null and
 * said NOTHING AT ALL — not loading, not empty, not an error. */
section('the coverage filter that became a silence');
const typhoonOnly = [live('t1', 'gdacs'), live('t2', 'gdacs')];
ok(modelTracksRow(null, typhoonOnly, () => undefined)?.state === 'loading',
   'a map of GDACS storms alone still reports a state');
ok(modelTracksRow(null, typhoonOnly, () => ({ status: 'unavailable' }))?.state === 'error',
   'a GDACS-only outage is reported, not swallowed');

/* --- selection ----------------------------------------------------------- */
section('with a storm selected');
const sel = live('s1');
ok(modelTracksRow(sel, [sel], () => ({ status: 'none' }))?.message.includes('this storm'),
   'a selection describes THAT storm, not a count');

/* An ended selection must not sit on a spinner forever: nothing warms its deck,
 * so the lookup returns undefined and the naive answer is `loading`. */
const dead = ended('s2');
const deadRow = modelTracksRow(dead, [dead], () => undefined);
ok(deadRow.state === 'empty', 'an ended selection is EMPTY, never a permanent spinner');

/* ==> A SILENT SELECTION IS THE SAME ANSWER, AND LEAVING IT OUT WAS THE ROW
 * LYING. <== `withoutFuture` empties the modelTracks slot for a silent storm
 * exactly as it does for an ended one, but only the ended case was answered
 * here — so a silent storm fell through to its DECK's status, which is very
 * often a healthy `ok`. The map drew no guidance while this row said guidance
 * was fine: two answers to one question on one screen, and the reassuring one
 * was wrong. */
const quiet = {
  id: 's3', source: 'gdacs', advisoryKey: 's3-1',
  observedAt: new Date(Date.now() - 40 * 3600 * 1000).toISOString(),
};
const quietRow = modelTracksRow(quiet, [quiet], () => ({ status: 'ok', tracks: [{}, {}] }));
ok(quietRow.state === 'empty',
   'a SILENT selection is EMPTY even when its own deck came back healthy');
ok(/no update/i.test(quietRow.message),
   'and it says WHY — no update, not a bare blank');

/* Ended wins over silent, which is §5's precedence rule: a storm that went
 * quiet and was then confirmed over is both, and "may resume" is the weaker
 * sentence to show about it. */
const both = { ...ended('s4'), observedAt: new Date(Date.now() - 40 * 3600 * 1000).toISOString() };
ok(/ended/i.test(modelTracksRow(both, [both], () => undefined).message),
   'a storm that is both silent AND ended reads as ended');
ok(!/retry/i.test(deadRow.message), 'an ended selection offers no retry — the deck is gone');
ok(/ended/i.test(deadRow.message), 'and it says why');

/* --- the environment ribbon (§47.6, §47.9) -------------------------------
 *
 * ==> FOUR ABSENCES THAT LOOK IDENTICAL ON THE MAP. <== An uncolored cone is
 * an uncolored cone whichever way it got there, so this row is the ONLY thing
 * that can tell a reader which. Collapsing any two of them is the §5 silence,
 * and it is the failure this block exists to make impossible.
 * ------------------------------------------------------------------------- */
section('the environment row — four kinds of nothing');

const okRun = { status: 'ok', run: { drawableHours: 12 } };

ok(rowForOneShips(undefined).state === 'loading',
   'nothing warmed yet is LOADING, not empty — asked-for-and-nothing-came is a different fact');
ok(rowForOneShips(okRun) === null,
   'a run that paints says nothing beyond the row\'s standing note');

ok(rowForOneShips({ status: 'basin' }).state === 'empty',
   'a basin SHIPS does not cover is EMPTY, not an error');
ok(!/retry/i.test(rowForOneShips({ status: 'basin' }).message),
   'and offers no retry — a typhoon is not going to change ocean');
ok(/basin/i.test(rowForOneShips({ status: 'basin' }).message),
   'and names the basin as the reason, so a flat cone never reads as a calm environment');

ok(/yet/i.test(rowForOneShips({ status: 'no_run' }).message),
   'no run published yet reads as a WAIT, which is what it is — hours, not permanent');

/* §47.6's fourth case, and the season says it is not rare: 23 files carried a
 * full contribution table and forecast winds with no forecast POSITION past
 * hour 0. The file is healthy; there is nowhere to put the color. */
const barren = rowForOneShips({ status: 'ok', run: { drawableHours: 0 } });
ok(barren && barren.state === 'empty',
   'a HEALTHY run with nothing drawable still speaks — a ribbon that ends with no explanation is the silence §5 forbids');
ok(!/retry/i.test(barren.message), 'and offers no retry, because nothing failed');

ok(rowForOneShips({ status: 'unavailable' }).state === 'error',
   'only a real failure is an error');
ok(/retry/i.test(rowForOneShips({ status: 'unavailable' }).message),
   'and it is the only one of the four that offers a retry');

{
  const msgs = ['basin', 'no_run', 'unavailable'].map((s) => rowForOneShips({ status: s }).message);
  msgs.push(barren.message);
  ok(new Set(msgs).size === 4, 'all four sentences are DISTINCT — none of them collapses into another');
}

section('the environment row across the whole map');

ok(rowForAllShips([okRun, { status: 'basin' }]) === null,
   'an Atlantic hurricane drawing beside a typhoon that cannot is the NORMAL state of an NHC-only layer, not a fault worth a sentence');
ok(rowForAllShips([okRun, { status: 'unavailable' }]).state === 'error',
   'but a healthy storm does NOT excuse a broken one — the rule rowForAllDecks learned twice');
ok(rowForAllShips([{ status: 'basin' }, { status: 'basin' }]).state === 'empty',
   'every storm outside coverage is a coverage statement');
ok(/basins/i.test(rowForAllShips([{ status: 'basin' }, { status: 'basin' }]).message),
   'phrased for several storms');
ok(rowForAllShips([{ status: 'basin' }, { status: 'no_run' }]).state === 'empty',
   'two different absences fall back to a plain count rather than picking one and being wrong about the other');
ok(rowForAllShips([undefined, { status: 'basin' }]).state === 'loading',
   'and anything still in flight is loading');

/* A run that came back ok but paints nothing must NOT count as "something is
 * drawing" — that is how a whole map of barren runs would go silent. */
ok(rowForAllShips([{ status: 'ok', run: { drawableHours: 0 } }, { status: 'unavailable' }]).state === 'error',
   'a run with nothing drawable does not count as drawing, so it cannot silence a real failure beside it');

ok(shipsCandidates([live('a'), ended('b')]).length === 1,
   'an ended storm is not a candidate — nothing warms its run, so it would hold the row on loading forever');

section('the environment row with a storm selected');

ok(/this storm/i.test(environmentRow(sel, [sel], () => ({ status: 'no_run' })).message),
   'a selection describes THAT storm, not a count');
ok(environmentRow(dead, [dead], () => undefined).state === 'empty',
   'an ended selection is EMPTY, never a permanent spinner');
ok(/ended/i.test(environmentRow(dead, [dead], () => undefined).message), 'and says why');
ok(environmentRow(quiet, [quiet], () => okRun).state === 'empty',
   'a SILENT selection is EMPTY even when its own run came back healthy — the cone it would paint inside is already gone');
ok(/no update/i.test(environmentRow(quiet, [quiet], () => okRun).message),
   'and it says WHY, not a bare blank');
ok(/ended/i.test(environmentRow(both, [both], () => undefined).message),
   'a storm that is both silent AND ended reads as ended — §5\'s precedence rule');

/* --- the store ----------------------------------------------------------- */
section('the store');
let notified = 0;
const st = createLayerStatus(() => { notified++; });
ok(Object.keys(st.value()).length === 0, 'starts empty');

st.refreshModelTracks({ on: false, selected: null, storms: [live('a')], deckFor: () => undefined });
ok(!('modelTracks' in st.value()), 'a layer that is switched OFF reports nothing');

st.refreshModelTracks({ on: true, selected: null, storms: [live('a')], deckFor: () => undefined });
ok(st.value().modelTracks?.state === 'loading', 'switched on, it reports');

const held = st.value();
st.setImagery({ state: 'info', message: 'Downloaded 4 min ago' });
ok(st.value() !== held, 'the object is REPLACED, never mutated — the view compares identity');
ok(st.value().modelTracks && st.value().imagery, 'the two rows do not clobber each other');

st.setImagery(null);
ok(!('imagery' in st.value()), 'a null imagery row is removed, not stored as null');
ok(notified === 4, 'every change notifies exactly once');

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (pure logic only — whether the row LOOKS right is glass)');
