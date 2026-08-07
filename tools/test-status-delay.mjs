#!/usr/bin/env node
/**
 * test-status-delay.mjs — when the status strip says a feed is delayed
 * (ui/status.js, `sourceHealthMessage`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-status-delay.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> WHY THIS SUITE EXISTS: THIS SURFACE SHIPPED WRONG AND WENT LIVE. <==
 * The strip fired on `X-Landfall-Stale`, a flag that meant "upstream failed"
 * until the storm-list routes started serving expired copies ON PURPOSE and
 * refreshing behind the response. The moment that landed, a routine
 * 31-minute-old cache started rendering as a NOAA outage on a healthy feed,
 * caught on a phone rather than by anything here.
 *
 * A FALSE ALARM IS NOT A COSMETIC BUG ON THIS STRIP. §5's rule is that a feed
 * outage must never be silent; the corollary nobody wrote down is that an
 * alarm which fires during normal operation is one people stop reading, which
 * costs us the outage it exists for. Both directions are asserted below.
 *
 * WHAT THIS CANNOT PROVE: that 90 minutes is the right number. That is a
 * judgement about how long a broken pipeline may go unmentioned, and it is
 * argued in `RELAY_AGE` in config/constants.js.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { sourceHealthMessage } = await import('../ui/status.js');
const { RELAY_AGE } = await import('../config/constants.js');

const NOW = Date.parse('2026-08-07T12:00:00Z');
const MIN = 60 * 1000;

/** A healthy source slot, fetched `agoMin` minutes ago. */
const slot = (agoMin, extra = {}) => ({
  status: 'ok',
  fetchedAt: new Date(NOW - agoMin * MIN).toISOString(),
  error: null,
  relayStale: false,
  ...extra,
});

const sources = (nhc, gdacs) => ({ nhc, gdacs });
const msg = (s) => sourceHealthMessage(s, NOW);

/* ------------------------------------------------------------------ */
section('Healthy — the strip stays silent');

{
  ok(msg(sources(slot(0), slot(0))) === null, 'just fetched: silent');
  ok(msg(sources(slot(5), slot(5))) === null, '5 minutes old: silent');
}

{
  /* THE REGRESSION THIS SUITE IS REALLY FOR. 35 minutes is the healthy worst
   * case — a 30-minute relay window plus a poll landing just after it turns
   * over — and it is served by the serve-then-refresh path with the stale flag
   * SET. The old code raised a NOAA-outage alarm on exactly this. */
  const s = sources(slot(35, { relayStale: true }), slot(35, { relayStale: true }));
  ok(msg(s) === null, 'expired-but-refreshing at 35 min: silent despite relayStale');
}

{
  /* Right up to the line. */
  const justUnder = RELAY_AGE.delayedAfter / MIN - 1;
  ok(msg(sources(slot(justUnder), slot(0))) === null, 'one minute under the line: silent');
}

/* ------------------------------------------------------------------ */
section('Genuinely old — the strip speaks');

{
  const over = RELAY_AGE.delayedAfter / MIN + 1;
  const m = msg(sources(slot(over), slot(0)));
  ok(m !== null && /NHC/.test(m.message), 'NHC past the line: named');
  ok(m && m.tone === 'stale', 'and it is the stale tone, not error');
}

{
  const over = RELAY_AGE.delayedAfter / MIN + 1;
  const m = msg(sources(slot(0), slot(over)));
  ok(m !== null && /GDACS/.test(m.message), 'GDACS past the line: named');
}

{
  /* BOTH DELAYED IS ITS OWN MESSAGE. Naming one of two dead feeds is worse
   * than naming neither, and the strip shows one line. */
  const over = RELAY_AGE.delayedAfter / MIN + 1;
  const m = msg(sources(slot(over), slot(over)));
  ok(m !== null && !/NHC|GDACS/.test(m.message), 'both delayed: neither named alone');
  ok(m !== null && /feeds/.test(m.message), 'both delayed: says feeds, plural');
}

/* ------------------------------------------------------------------ */
section('Outage still outranks delay');

{
  const over = RELAY_AGE.delayedAfter / MIN + 1;
  const down = { status: 'unavailable', fetchedAt: null, error: 'failed', relayStale: false };
  const m = msg(sources(down, slot(over)));
  ok(m.tone === 'error', 'a dead source outranks a delayed one');
  ok(/not responding/.test(m.message), 'and says not responding, not delayed');
}

{
  const down = { status: 'unavailable', fetchedAt: null, error: 'failed', relayStale: false };
  const m = msg(sources(down, down));
  ok(m.tone === 'error' && /feeds/.test(m.message), 'both dead: one plural error');
}

/* ------------------------------------------------------------------ */
section('Unknown is not an alarm');

{
  /* A MISSING STAMP MUST NOT SHOUT. An unknown age is an unknown, and a strip
   * that fires on a parse failure is one people learn to ignore. */
  const noStamp = { status: 'ok', fetchedAt: null, error: null, relayStale: false };
  ok(msg(sources(noStamp, slot(0))) === null, 'null timestamp: silent');
}

{
  const junk = { status: 'ok', fetchedAt: 'not a date', error: null, relayStale: false };
  ok(msg(sources(junk, slot(0))) === null, 'unparseable timestamp: silent');
}

{
  /* Clock skew between the datacentre that stamped and the phone that read it
   * puts the fetch in the future. That is not a fault and not a delay. */
  const future = slot(-30);
  ok(msg(sources(future, slot(0))) === null, 'timestamp in the future: silent');
}

/* ------------------------------------------------------------------ */
section('relayStale alone can no longer raise an alarm');

{
  /* The flag stays on the source slot and stays honest on the detail panel.
   * It simply does not drive this strip any more. */
  const flagged = slot(1, { relayStale: true });
  ok(msg(sources(flagged, flagged)) === null,
    'relayStale on a one-minute-old copy: silent');
}

/* ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
