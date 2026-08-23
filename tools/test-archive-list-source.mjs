#!/usr/bin/env node
/**
 * test-archive-list-source.mjs — phase two reads the copy that survives.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-archive-list-source.mjs` (§12).
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS FOR (2026-08-23T22:05Z, measured on that exact run)
 *
 * Every GDACS-derived phase in `tools/archive-fetch.mjs` read
 * `gdacs-events.json` — the copy taken straight from gdacs.org. In one run, one
 * runner, one moment:
 *
 *     gdacs-events.json        (straight to gdacs.org)   ABORTED at 30,003 ms
 *     relay-gdacs-events.json  (through our relay)       200 OK in 165 ms
 *
 * Same hundred rows, same six current storms, every one carrying its own
 * `url.geometry`. The upstream file was never written, so `geometry`,
 * `relay-geometry` and `gdacs-event-detail` all threw and the hour recorded
 * NOTHING about GDACS — on an hour whose entire point was that GDACS was
 * unwell. **The archive failed on precisely the day it was needed and worked
 * on all the days it was not.**
 *
 * ==> IT IS THE SAME MISTAKE THE APP MADE THE SAME MORNING. <== The relay route
 * had a correct fallback that could never execute; this had a correct fallback
 * source it never looked at. A cache exists so that upstream being down stops
 * mattering, and reaching past it to the origin opts out of the protection you
 * are standing next to.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS STATIC, LIKE `test-archive-dirs.mjs` BESIDE IT
 *
 * Proving this at runtime means running the fetcher, and the fetcher needs the
 * open internet this sandbox does not have (§18). It is also a top-level script
 * rather than a module — importing it would START a full archive run. So the
 * function is LIFTED OUT BY TEXT and executed against temp directories. That is
 * fragile in one specific way and it fails loudly rather than quietly: if the
 * function is renamed or restructured past recognition, the lift returns
 * nothing and the first assertion goes red naming it.
 */

import path from 'node:path';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; return; }
  failures.push(msg);
  console.error(`  FAIL  ${msg}`);
}

const SRC = 'tools/archive-fetch.mjs';
const src = readFileSync(SRC, 'utf8');

/* --------------------------------------------------------------------------
 * PART 1 — no GDACS phase may read the upstream file directly any more
 * ------------------------------------------------------------------------ */

console.log('\n  every GDACS-derived phase goes through one reader\n');

/* The literal that WAS in four places. Its only legitimate home now is inside
 * `gdacsEventList()`'s own preference list, which spells it in an array
 * alongside the relay copy — a shape this pattern does not match. */
const directReads = [...src.matchAll(/readFileSync\(join\(OUT, 'gdacs-events\.json'\)/g)];
ok(
  directReads.length === 0,
  `${SRC}: ${directReads.length} phase(s) still read gdacs-events.json directly. `
    + 'Every GDACS-derived phase must go through gdacsEventList(), which prefers '
    + 'the relay copy — otherwise the phase dies whenever gdacs.org is slow, '
    + 'which is exactly when its output matters.'
);

ok(
  /function gdacsEventList\(\)/.test(src),
  `${SRC}: gdacsEventList() exists`
);

/* Order is the behaviour, not merely presence. Upstream-first with a relay
 * fallback would still have failed the 22:05Z run — the upstream file was
 * absent, not corrupt, and a preference list read the other way round would
 * have found nothing to prefer. */
const prefList = src.match(/for \(const file of \[([^\]]+)\]\)/);
ok(!!prefList, `${SRC}: gdacsEventList() has a preference list`);
if (prefList) {
  const order = prefList[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  ok(
    order[0] === 'relay-gdacs-events.json',
    `${SRC}: the RELAY copy is read first (got '${order[0]}'). It is both the `
      + 'copy that survives an upstream outage and the one the app itself reads.'
  );
  ok(
    order.includes('gdacs-events.json'),
    `${SRC}: the upstream copy is still the fallback`
  );
}

/* --------------------------------------------------------------------------
 * PART 2 — behaviour, against real archived bytes
 * ------------------------------------------------------------------------ */

console.log('\n  the reader, driven against the run that captured nothing\n');

function liftFunction(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) return null;
  let depth = 0;
  let started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

const lifted = liftFunction('gdacsEventList');
ok(!!lifted, `${SRC}: gdacsEventList() could be lifted for execution`);

if (lifted) {
  const make = (OUT) =>
    new Function('readFileSync', 'join', 'OUT', 'console',
      `${lifted}\nreturn gdacsEventList;`)(readFileSync, join, OUT, { log: () => {} });

  /* ==> READ THE RESULT DEFENSIVELY, BECAUSE THE THING UNDER TEST IS THE THING
   * THAT RETURNS IT. <== A first draft did `got.features[0].properties.tag` and
   * a mutation that made the reader accept a body with no `features` array
   * turned this suite into a TypeError stack trace pointing at its own line
   * 170. A crash blames the test; only a named assertion blames the code. */
  const tagOf = (v) => v?.features?.[0]?.properties?.tag ?? `<no features: ${JSON.stringify(v)?.slice(0, 60)}>`;

  const dir = mkdtempSync(join(tmpdir(), 'landfall-archive-'));
  const RELAY_BODY = JSON.stringify({ features: [{ properties: { tag: 'relay' } }] });
  const UPSTREAM_BODY = JSON.stringify({ features: [{ properties: { tag: 'upstream' } }] });

  try {
    /* ==> THE 22:05Z RUN EXACTLY: relay landed, upstream did not. <== This is
     * the case that used to throw three times and record nothing. */
    writeFileSync(join(dir, 'relay-gdacs-events.json'), RELAY_BODY);
    let got = null;
    try { got = make(dir)(); } catch (e) { got = e; }
    ok(
      tagOf(got) === 'relay',
      'upstream missing, relay present -> the relay copy is used (this is the '
        + `run that recorded nothing about GDACS on the hour GDACS was down). Got: ${tagOf(got)}`
    );

    /* Preference, not just survival: the relay copy wins even when both exist,
     * because it is what a phone would have been handed. */
    writeFileSync(join(dir, 'gdacs-events.json'), UPSTREAM_BODY);
    got = make(dir)();
    ok(
      tagOf(got) === 'relay',
      `both present -> the relay copy still wins. Got: ${tagOf(got)}`
    );

    /* A relay copy that is present but unusable must not poison the run. A
     * truncated or non-JSON body is a different failure from an absent one and
     * the upstream copy is a real answer to it. */
    writeFileSync(join(dir, 'relay-gdacs-events.json'), '{ this is not json');
    got = make(dir)();
    ok(
      tagOf(got) === 'upstream',
      `relay copy unparseable -> falls back to the upstream copy. Got: ${tagOf(got)}`
    );

    /* A relay copy that parses but carries no `features` array is ALSO
     * unusable, and it is the shape an error page serialises to. Checked
     * separately because `JSON.parse` succeeds on it. */
    writeFileSync(join(dir, 'relay-gdacs-events.json'), '{"error":"rate_limited"}');
    got = make(dir)();
    ok(
      tagOf(got) === 'upstream',
      `relay copy has no features array -> falls back to the upstream copy. Got: ${tagOf(got)}`
    );

    /* ==> BOTH GONE MUST THROW, AND THE REASON MUST NAME BOTH. <== The phases
     * catch and record into `derivedFailures`, which is all a session ever
     * reads. A message naming only one copy cannot distinguish "GDACS is down"
     * from "our relay is down too" — and those are opposite emergencies. */
    rmSync(join(dir, 'relay-gdacs-events.json'));
    rmSync(join(dir, 'gdacs-events.json'));
    let threw = null;
    try { make(dir)(); } catch (e) { threw = e; }
    ok(!!threw, 'both copies missing -> throws rather than returning empty');
    if (threw) {
      ok(
        /relay-gdacs-events\.json/.test(threw.message)
          && /gdacs-events\.json/.test(threw.message),
        `both copies missing -> the reason names BOTH (got: ${threw.message})`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* --------------------------------------------------------------------------
 * PART 3 — the manifest counters say which half of phase two is missing
 * ------------------------------------------------------------------------ */

console.log('\n  two phases, two counters\n');

/* ==> `geometryStorms` WAS INCREMENTED BY THE GDACS PHASE AND THE NHC PHASE.
 * <== So a run capturing ZERO GDACS storms reported 27 — the NHC track layers —
 * under a name that reads as GDACS coverage, and a session reading it across
 * `history/` to judge exactly that believed it. The phases fail independently
 * by design; the numbers have to as well. */
ok(
  !/geometryStorms:/.test(src),
  `${SRC}: the shared 'geometryStorms' key is gone — it counted two independent `
    + 'phases under one GDACS-sounding name'
);
ok(
  /gdacsGeometryStorms:\s*gdacsGeometryCount/.test(src),
  `${SRC}: the manifest reports gdacsGeometryStorms from its own counter`
);
ok(
  /nhcTrackLayers:\s*nhcTrackCount/.test(src),
  `${SRC}: the manifest reports nhcTrackLayers from its own counter`
);

/* Neither counter may be incremented by the other's phase — the actual fault,
 * rather than the naming that hid it. */
for (const [counter, limit] of [['gdacsGeometryCount', 1], ['nhcTrackCount', 1]]) {
  const bumps = [...src.matchAll(new RegExp(`${counter}\\+\\+`, 'g'))].length;
  ok(
    bumps === limit,
    `${SRC}: ${counter} is incremented in exactly one phase (found ${bumps})`
  );
}

/* ------------------------------------------------------------------------- */

console.log(`\n  ${pass} assertions passed, ${failures.length} failed\n`);
if (failures.length) process.exit(1);
