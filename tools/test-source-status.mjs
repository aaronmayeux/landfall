#!/usr/bin/env node
/**
 * test-source-status.mjs — the two judgements the store subscription makes.
 *
 * ZERO DEPENDENCIES, like every other suite here.
 *
 * WHY THIS SUITE EXISTS. Both of these were closure-bound inside boot(), and
 * both are the kind of thing that fails SILENTLY: a reporter that sends too
 * much just costs money, but a reporter that sends too LITTLE means the day
 * NHC goes down nobody ever hears about it — and the app looks fine from the
 * inside either way. Same for the milestone: get it wrong and a healthy quiet
 * day is recorded as a hang, which then gets chased.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { anySourceResolved, createSourceReporter } = await import('../app/source-status.js');

/* --- anySourceResolved ---------------------------------------------------- */
section('anySourceResolved — the `data` milestone');

ok(anySourceResolved(null) === false, 'no sources at all is not resolved');
ok(anySourceResolved({}) === false, 'an empty source map is not resolved');
ok(anySourceResolved({ nhc: { status: 'loading' }, gdacs: { status: 'loading' } }) === false,
  'both still loading is not resolved');
ok(anySourceResolved({ nhc: { status: 'loading' }, gdacs: { status: 'ok' } }) === true,
  'ONE resolved source is enough — the milestone is "an answer arrived", not "everything arrived"');

ok(anySourceResolved({ nhc: { status: 'clear' } }) === true,
  'AN EMPTY BASIN IS AN ANSWER. Treating "no storms" as "still waiting" would record every healthy quiet day as a hang');
ok(anySourceResolved({ nhc: { status: 'unavailable', error: 'relay 502' } }) === true,
  'so is an outage — a fast failure is a fast answer, and blaming the network for our own slow render is what these two milestones exist to prevent');

ok(anySourceResolved({ nhc: {} }) === false, 'a source with no status yet has told us nothing');
ok(anySourceResolved({ nhc: null }) === false, 'a null source does not throw and does not count');

/* --- createSourceReporter -------------------------------------------------- */
section('createSourceReporter — transitions only');

const sent = [];
const r = createSourceReporter((name, status, error) => sent.push([name, status, error]));

r.update({ nhc: { status: 'loading' }, gdacs: { status: 'loading' } });
ok(sent.length === 2, 'the boot state is two real transitions — the store fires on subscribe and that first pair is the seed');

r.update({ nhc: { status: 'ok' }, gdacs: { status: 'loading' } });
ok(sent.length === 3 && sent[2][0] === 'nhc' && sent[2][1] === 'ok',
  'loading -> ok is reported, and it is the cheapest confirmation the app works for somebody who is not Aaron');

for (let i = 0; i < 20; i++) r.update({ nhc: { status: 'ok' }, gdacs: { status: 'loading' } });
ok(sent.length === 3,
  'TWENTY UNCHANGED POLLS SEND NOTHING — the store fires every five minutes, and "nhc is still down" a hundred times buries the moment it broke');

r.update({ nhc: { status: 'unavailable', error: 'relay 502' }, gdacs: { status: 'loading' } });
ok(sent.length === 4 && sent[3][2] === 'relay 502', 'a failure carries its reason through');

r.update({ nhc: { status: 'ok' }, gdacs: { status: 'loading' } });
ok(sent.length === 5 && sent[4][1] === 'ok', 'and the RECOVERY is reported too — a failure with no recovery event reads as a permanent outage');

section('createSourceReporter — a missing status is not a transition');

const sent2 = [];
const r2 = createSourceReporter((...a) => sent2.push(a));
r2.update({ nhc: { status: 'ok' } });
ok(sent2.length === 1, 'first real status reported');

r2.update({ nhc: {} });
ok(sent2.length === 1, 'a source that arrives with no status sends nothing');
ok(r2.value().nhc === 'ok',
  'AND DOES NOT OVERWRITE THE LAST REAL ONE — if it did, the genuine change that follows would compare against a blank and the outage would go unreported');

r2.update({ nhc: { status: 'ok' } });
ok(sent2.length === 1, 'so the unchanged status that follows is still correctly silent');

r2.update(null);
ok(sent2.length === 1, 'a null source map is a no-op, not a throw');

section('createSourceReporter — sources are independent');

const sent3 = [];
const r3 = createSourceReporter((...a) => sent3.push(a));
r3.update({ nhc: { status: 'ok' }, gdacs: { status: 'ok' } });
sent3.length = 0;
r3.update({ nhc: { status: 'unavailable' }, gdacs: { status: 'ok' } });
ok(sent3.length === 1 && sent3[0][0] === 'nhc',
  'ONE FEED FAILING DOES NOT RE-REPORT THE HEALTHY ONE — the two fail independently and that is the normal shape of an outage here');

/* --- report -------------------------------------------------------------- */
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed:`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the decisions only — whether the event reaches D1 is the wiring check)');
