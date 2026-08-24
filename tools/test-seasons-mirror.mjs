#!/usr/bin/env node
/**
 * test-seasons-mirror.mjs — the current-season capture, §57.30 step 3.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-seasons-mirror.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design). No network:
 * every helper under test is pure, which is why they were separated from the
 * run in the first place.
 *
 * ==> THE FOUR ASSERTIONS THAT MATTER ARE THE FOUR SILENT BUGS, AND EACH WAS
 * VERIFIED BY REINTRODUCING IT AND WATCHING THIS SUITE GO RED. <== §12's rule:
 * a test that passes on the same wrong assumption as the code is worse than no
 * test at all.
 *
 *   1. THE §57.13 FILTER. Invests 90-99 reuse their numbers several times in
 *      one season, so an unfiltered mirror stores three systems under one name
 *      and each overwrites the last. Verified red by keeping every `.dat`.
 *   2. THE TWO-DIGIT YEAR. JTWC's product id is `wp1726`, not `wp172026`.
 *      Reading the last four characters as the year files Saudel under 1726.
 *      Verified red by slicing four digits instead of two.
 *   3. DEDUPLICATION. The same warning is served for six hours, so an hourly
 *      job sees it six times. Verified red by appending unconditionally, which
 *      turns one storm into six copies of itself.
 *   4. THE MANIFEST'S TIMESTAMP STRIP. Compare the manifest whole and the
 *      branch takes a commit an hour forever; do not compare it at all and a
 *      source that starts failing is invisible. Verified red both ways —
 *      by comparing whole, and by returning false unconditionally.
 *
 * THE JTWC FIXTURE IS REAL. `samples/seasons/jtwc-storms-2026-08-24.json` is
 * the exact body our own relay served at 14:50Z on 2026-08-24, taken off the
 * `archive` branch. §57.30 step 2 was corrected four times by real bytes
 * disagreeing with remembered ones; this suite does not invent a payload shape.
 *
 * WHAT THIS CANNOT PROVE: that NOAA's directory looks like the sample, that our
 * relay is up, or that the runner can commit. Those are a runner, and step 3 is
 * not done until one has run.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const {
  bdeckFiles, bdeckPath, hrefs, parseProduct,
  jtwcRecord, mergeJsonl, manifestChanged, stableJson,
} = await import('./seasons-mirror.mjs');

/* The directory as NHC actually serves it: an Apache index. The step-0 probe
   measured 18 `.dat` files on 2026-08-24 — 14 storms and 4 invests — so this
   sample carries that shape plus a test system, which the probe did not see
   that day but which NHC's own README says will appear. */
const INDEX_HTML = `
<html><head><title>Index of /atcf/btk</title></head><body>
<h1>Index of /atcf/btk</h1>
<pre><a href="../">Parent Directory</a>
<a href="bal012026.dat">bal012026.dat</a>  24-Aug-2026 12:04  2.1K
<a href="bal022026.dat">bal022026.dat</a>  24-Aug-2026 12:04  4.8K
<a href="bal032026.dat">bal032026.dat</a>  24-Aug-2026 12:04  1.9K
<a href="bal902026.dat">bal902026.dat</a>  24-Aug-2026 12:04  0.6K
<a href="bal942026.dat">bal942026.dat</a>  24-Aug-2026 12:04  0.7K
<a href="bal802026.dat">bal802026.dat</a>  24-Aug-2026 12:04  0.2K
<a href="bcp012026.dat">bcp012026.dat</a>  24-Aug-2026 12:04  19K
<a href="bcp022026.dat">bcp022026.dat</a>  24-Aug-2026 12:04  3.9K
<a href="bep012026.dat">bep012026.dat</a>  24-Aug-2026 12:04  4.9K
<a href="bep992026.dat">bep992026.dat</a>  24-Aug-2026 12:04  0.5K
<a href="README">README</a>              01-Jan-2020 00:00  3.0K
<a href="aal012026.dat">aal012026.dat</a>  24-Aug-2026 12:04  221K
</pre></body></html>`;

/* ------------------------------------------------------------------------- */
section('the directory listing, read rather than assumed');
{
  const links = hrefs(INDEX_HTML);
  ok(links.includes('bal012026.dat'), 'hrefs finds a b-deck');
  ok(links.includes('../'), 'hrefs finds the parent link too — filtering is a later step');

  const { kept, skipped } = bdeckFiles(INDEX_HTML);
  const files = kept.map((k) => k.file);

  ok(files.length === 6, `six real storms survive, got ${files.length}`);
  ok(files.includes('bal012026.dat'), 'AL01 kept');
  ok(files.includes('bcp012026.dat'), 'CP01 kept');
  ok(files.includes('bep012026.dat'), 'EP01 kept');

  /* ==> SILENT BUG 1. <== */
  ok(!files.includes('bal902026.dat'), 'invest 90 is dropped');
  ok(!files.includes('bal942026.dat'), 'invest 94 is dropped');
  ok(!files.includes('bal802026.dat'), 'test system 80 is dropped');
  ok(!files.includes('bep992026.dat'), 'invest 99 is dropped');

  ok(!files.includes('aal012026.dat'), 'the a-deck is not a b-deck and is not ours to mirror here');
  ok(!files.includes('README'), 'a non-.dat file is not mistaken for a storm');

  const why = Object.fromEntries(skipped.map((s) => [s.file, s.why]));
  ok(/invest/i.test(why['bal902026.dat'] || ''), 'an invest says it is an invest');
  ok(/test/i.test(why['bal802026.dat'] || ''), 'a test system says it is a test system');
  ok(skipped.length === 4, `four rejections are reported, got ${skipped.length}`);

  const first = kept[0];
  ok(first.id === 'BAL012026'.slice(1) || first.id === 'AL012026',
    `the id drops the leading b, got ${first.id}`);
  ok(first.year === 2026 && first.number === 1 && first.basin === 'AL',
    'the id is decomposed correctly');
}

/* ------------------------------------------------------------------------- */
section('where a b-deck is stored');
{
  ok(bdeckPath('bal022026.dat') === 'btk/2026/bal022026.dat', 'foldered by year');
  ok(bdeckPath('BAL022026.DAT') === 'btk/2026/bal022026.dat', 'case is normalised');
  ok(bdeckPath('bal012021.dat') === 'btk/2021/bal012021.dat', 'a past year lands in its own folder');
  ok(bdeckPath('README') === null, 'a non-b-deck has no path');
}

/* ------------------------------------------------------------------------- */
section('JTWC product ids — the two-digit year');
{
  /* ==> SILENT BUG 2. <== */
  const wp = parseProduct('wp1726');
  ok(wp !== null, 'wp1726 parses');
  ok(wp.basin === 'WP' && wp.number === 17, 'basin and number read');
  ok(wp.year === 2026, `the year is 2026, not 1726 — got ${wp?.year}`);

  ok(parseProduct('cp0126').year === 2026, 'a central Pacific product parses the same way');
  ok(parseProduct('cp0126').basin === 'CP', 'CP is a JTWC basin too and is kept');

  ok(parseProduct('') === null, 'an empty product is refused, not guessed');
  ok(parseProduct('wp172026') === null, 'a four-digit year is refused rather than misread');
  ok(parseProduct(undefined) === null, 'a missing product is refused');
}

/* ------------------------------------------------------------------------- */
section('the real relay payload');
{
  const raw = readFileSync('samples/seasons/jtwc-storms-2026-08-24.json', 'utf8');
  const payload = JSON.parse(raw);

  ok(payload.state === 'ok', 'the fixture is a healthy response');
  ok(Array.isArray(payload.storms) && payload.storms.length > 0, 'it carries storms');

  const saudel = payload.storms.find((s) => s.name === 'SAUDEL');
  ok(!!saudel, 'Saudel is in the fixture');
  ok(saudel.product === 'wp1726', `Saudel's product is wp1726, got ${saudel?.product}`);
  ok(saudel.fix && saudel.fix.windKt === 100, 'her fix is 100 kt');
  ok(Array.isArray(saudel.forecast) && saudel.forecast.length > 0, 'she carries a forecast');

  /* ==> THE FORECAST IS STORED, NOT TRIMMED. <== §57.1 item 16: forecast
     against reality is the reason this feature exists, and JTWC deletes the
     warning within days, so a field dropped here cannot be recovered. */
  const rec = jtwcRecord(saudel, '2026-08-24T14:50:15.915Z');
  const stored = JSON.parse(rec.line);
  ok(Array.isArray(stored.forecast) && stored.forecast.length === saudel.forecast.length,
    'every forecast point survives the round trip');
  ok(stored.fix.pressureMb === saudel.fix.pressureMb, 'the fix survives whole');
  ok(stored.capturedAt === '2026-08-24T14:50:15.915Z', 'the capture time is recorded');
}

/* ------------------------------------------------------------------------- */
section('the same warning, seen six times');
{
  const storm = {
    product: 'wp1726', designation: '17W', name: 'SAUDEL', warningNumber: '025',
    fix: { at: '2026-08-24T12:00:00.000Z', windKt: 100 },
  };

  /* ==> SILENT BUG 3. <== A JTWC warning stands for six hours and this job runs
     hourly, so the SAME warning is served six times. Appending each sighting
     turns one position into six identical ones — a track that looks fine and is
     six times too dense, with no error anywhere. */
  const a = jtwcRecord(storm, '2026-08-24T13:00:00.000Z');
  const b = jtwcRecord(storm, '2026-08-24T14:00:00.000Z');
  ok(a.key === b.key, 'the same warning at a different capture hour is one warning');

  let file = mergeJsonl('', [a]);
  ok(file.added === 1 && file.text.split('\n').filter(Boolean).length === 1, 'first sighting stores one line');

  file = mergeJsonl(file.text, [b]);
  ok(file.added === 0, 'the second sighting adds nothing');
  ok(file.text.split('\n').filter(Boolean).length === 1, 'the file still holds one line');

  const next = jtwcRecord({ ...storm, warningNumber: '026', fix: { at: '2026-08-24T18:00:00.000Z', windKt: 95 } },
    '2026-08-24T19:00:00.000Z');
  ok(next.key !== a.key, 'the NEXT warning is a different warning');

  file = mergeJsonl(file.text, [next]);
  ok(file.added === 1 && file.text.split('\n').filter(Boolean).length === 2, 'a real new warning is appended');

  /* Append-only: the first line must be untouched, byte for byte. A file that
     only grows at the end is a file whose commit diffs are readable. */
  ok(file.text.split('\n')[0] === a.line, 'the existing line is not rewritten');

  /* A corrupt line is kept rather than silently dropped — losing a captured
     warning to a parse error is exactly the loss this whole job prevents. */
  const withJunk = mergeJsonl(`not json\n${a.line}\n`, [b]);
  ok(withJunk.text.startsWith('not json\n'), 'an unreadable existing line survives');
  ok(withJunk.added === 0, 'and dedupe still works around it');
}

/* ------------------------------------------------------------------------- */
section('when a run is worth a commit');
{
  const base = {
    runAt: '2026-08-24T15:00:00.000Z',
    sources: { btk: { status: 'ok', stored: 0, unchanged: 14 }, jtwc: { status: 'ok', linesAdded: 0 } },
  };
  const anHourLater = { ...base, runAt: '2026-08-24T16:00:00.000Z' };

  /* ==> SILENT BUG 4, FIRST HALF. <== */
  ok(!manifestChanged(base, anHourLater),
    'a run where nothing happened is not a commit, however new the clock is');

  /* ==> SILENT BUG 4, SECOND HALF. §5: silence is not a status. <== */
  const nhcDown = {
    runAt: '2026-08-24T16:00:00.000Z',
    sources: { btk: { status: 'unavailable', reason: 'HTTP 503' }, jtwc: { status: 'ok', linesAdded: 0 } },
  };
  ok(manifestChanged(base, nhcDown),
    'a source that started failing IS a commit — an outage must not read as a quiet hour');

  const stored = {
    runAt: '2026-08-24T16:00:00.000Z',
    sources: { btk: { status: 'ok', stored: 2, unchanged: 12 }, jtwc: { status: 'ok', linesAdded: 0 } },
  };
  ok(manifestChanged(base, stored), 'new bytes are a commit');
  ok(manifestChanged(null, base), 'the very first run is a commit');

  /* Key order must not decide this. A manifest rebuilt from scratch every run
     can carry the same facts in a different order, and a naive string compare
     would call that a change every single time. */
  const reordered = {
    sources: { jtwc: { linesAdded: 0, status: 'ok' }, btk: { unchanged: 14, stored: 0, status: 'ok' } },
    runAt: '2026-08-24T17:00:00.000Z',
  };
  ok(!manifestChanged(base, reordered), 'key order is not a change');
  ok(stableJson({ b: 1, a: 2 }) === stableJson({ a: 2, b: 1 }), 'stableJson sorts keys');
  ok(stableJson([{ b: 1, a: 2 }]) === '[{"a":2,"b":1}]', 'and sorts inside arrays');
}

/* ------------------------------------------------------------------------- */
console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — ${pass} assertions, ${failures.length} failures`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
