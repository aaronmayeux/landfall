#!/usr/bin/env node
/**
 * test-ended-backfill.mjs — a finished storm that arrived without a trail goes
 * and gets one (SPEC §5, data/ended-track.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-ended-backfill.mjs`.
 *
 * ===========================================================================
 * THE FIRST ASSERTION IS THE BUG ITSELF, AND IT MUST KEEP PASSING
 * ===========================================================================
 *
 * Section 1 does not test the fix. It reproduces the fault the fix exists for:
 * one poll, one storm already silent past `lapsedAfter`, and the record lands
 * with an EMPTY track. If that assertion ever stops holding, something upstream
 * changed and the rest of this file is testing a scenario that can no longer
 * happen — which is the failure mode where a suite goes green while the feature
 * it guards has quietly become unreachable.
 *
 * ===========================================================================
 * THE FIXTURE IS REAL BYTES
 * ===========================================================================
 *
 * `samples/gdacs/geometry-TC.json` is a real GDACS payload already in the repo,
 * fed through the REAL `fetchGdacsGeometry` via a stubbed network. Nothing here
 * hand-builds a bundle: a fixture shaped the way we imagine GDACS to be is
 * exactly how the missing `_catCode` shipped flat ridges to a phone.
 *
 * ===========================================================================
 * MUTATION-TESTED (project rule: a test that cannot fail is worse than none)
 * ===========================================================================
 *
 * Verified to FAIL when each of these is broken individually, 2026-08-12:
 *   - `endedNeedsTrack`'s `reason !== 'lapsed'` gate removed
 *       → "refuses to call it repairable", "NO request was made"
 *   - `backfillEndedTracks`'s attempt cap removed
 *       → "six polls made exactly 3 requests" (6, not 3)
 *   - `fillEndedTrack`'s only-ever-improves guard reduced to a length-2 floor
 *       → "the clipped answer is then REFUSED", "the held track survives it"
 *
 * The first draft of the only-ever-improves check re-ran the SAME fixture and
 * could not fail, because an equal-length rewrite leaves the same number on both
 * sides of the assertion. It is now driven with a genuinely clipped payload.
 * Recorded because that is the exact shape of test this project calls worse than
 * no test at all, and it got written here first time round.
 *
 * NOT COVERED HERE: that main.js actually calls `backfillEndedTracks` on a poll.
 * That is one line of wiring in a file this suite does not import, and claiming
 * it would be the same lie.
 *
 * WHAT THIS CANNOT PROVE: that the recovered trail looks right on a globe, or
 * that a real phone on real GDACS bytes recovers within one poll. That is glass.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); console.log(`  ${c ? '✓' : '✗'} ${m}`); };
const section = (n) => console.log(`\n  ${n}`);

/* --- a localStorage stand-in, same as tools/test-lifecycle.mjs ------------ */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

/* --- the network, entirely under this file's control ---------------------- */
const SAMPLE = JSON.parse(readFileSync('samples/gdacs/geometry-TC.json', 'utf8'));

/** The SAME payload with most of its centre dots removed — a half-published or
 *  clipped answer, which is the only way a later fetch can be WORSE than one we
 *  already have. Built by subtraction from the real bytes rather than written by
 *  hand, so it stays a real GDACS response in every other respect. */
const TRUNCATED = {
  ...SAMPLE,
  features: SAMPLE.features.filter((f) => {
    const cls = String(f?.properties?.Class || '');
    if (!cls.startsWith('Point_Polygon_Point_')) return true;
    /* By the dot's OWN index, not by file order — the payload lists them
     * 21, 22, 0, 1, 2 …, so "the first few in the file" is not "the first few
     * in time" and would have cut an arbitrary set. */
    return Number(cls.slice('Point_Polygon_Point_'.length)) <= 8;
  }),
};

let geometryRequests = 0;   // how many geometry fetches were actually made
let geometryGone = false;   // the event is retired — a 404, which it does not
let geometryShort = false;  // the payload came back with most of its past cut off

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/gdacs/geometry')) {
    geometryRequests++;
    if (geometryGone) {
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'gone' };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => (geometryShort ? TRUNCATED : SAMPLE),
      text: async () => JSON.stringify(geometryShort ? TRUNCATED : SAMPLE),
    };
  }
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
};

const { ENDED } = await import('../config/constants.js');
const {
  observeSource, endedStorms, endedBundle, resetLifecycle,
  endedNeedsTrack, onLifecycleChange,
} = await import('../data/lifecycle.js');
const { backfillEndedTracks, _resetBackfill } = await import('../data/ended-track.js');
const { fillEndedTrack } = await import('../data/lifecycle.js');
const { fetchGdacsGeometry } = await import('../data/gdacs-geometry.js');

/* ---------------------------------------------------------------------------
 * FIXTURES
 * ------------------------------------------------------------------------- */

const HOUR = 3600 * 1000;

/** A GDACS storm whose last analysis is past `lapsedAfter` but inside the parse
 *  cutoff — the exact window in which a cold device still receives the row and
 *  lapses it on sight. */
const lapsedStorm = (over = 1) => ({
  id: 'gdacs:1001297',
  source: 'gdacs',
  sourceId: '1001297',
  name: 'DOLPHIN-26',
  basin: 'westpacific',
  lat: 27.9,
  lon: 120.6,
  windKt: 45,
  observedAt: new Date(Date.now() - (ENDED.lapsedAfter + over * HOUR)).toISOString(),
  advisoryKey: 'gdacs:1001297:55',
  raw: { geometryUrl: 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001297&episodeid=55', episodeId: '55' },
});

/** The same storm, freshly analysed — used to build an `absent` ending, which
 *  is the case the fetch gate must refuse. */
const liveStorm = (id = 'gdacs:1001300', name = 'FIFTEEN-26') => ({
  id,
  source: 'gdacs',
  sourceId: '1001300',
  name,
  basin: 'westpacific',
  lat: 15.0,
  lon: 130.0,
  windKt: 40,
  observedAt: new Date().toISOString(),
  advisoryKey: `${id}:5`,
  raw: { geometryUrl: 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001300&episodeid=5', episodeId: '5' },
});

const clean = () => {
  resetLifecycle();
  _resetBackfill();
  geometryRequests = 0;
  geometryGone = false;
};

const trackPointsOf = (id) => {
  const raw = JSON.parse(localStorage.getItem('landfall.ended') || '{}');
  const rec = (raw.ended || []).find((r) => r?.storm?.id === id);
  return rec?.track?.length ?? null;
};

const trailVerticesOf = (id) => {
  const b = endedBundle(id);
  const slot = b?.layers?.pastTrack;
  if (slot?.status !== 'ok') return 0;
  return slot.fc?.features?.[0]?.geometry?.coordinates?.length ?? 0;
};

/* ===========================================================================
 * 1. THE BUG, REPRODUCED
 * ======================================================================== */
section('a device that arrives after the storm went quiet gets no trail');
clean();
observeSource('gdacs', [lapsedStorm()]);

const filedList = endedStorms();
ok(filedList.length === 1, `the storm is filed as finished on the first poll (${filedList.length})`);
ok(filedList[0]?.ended?.reason === 'lapsed', `and the reason is a lapse ("${filedList[0]?.ended?.reason}")`);
ok(trackPointsOf('gdacs:1001297') === 0, `THE FAULT: zero track points were captured (${trackPointsOf('gdacs:1001297')})`);
ok(trailVerticesOf('gdacs:1001297') === 0, 'so the map has no trail to draw at all');
ok(endedNeedsTrack('gdacs:1001297'), 'and the registry knows it is repairable');
ok(geometryRequests === 0, `nothing was fetched on the way in (${geometryRequests})`);

/* ===========================================================================
 * 2. THE REPAIR
 * ======================================================================== */
section('the backfill goes and gets it');
const repaired = await backfillEndedTracks([lapsedStorm()]);

ok(repaired === 1, `one record was repaired (${repaired})`);
ok(geometryRequests === 1, `with exactly one request (${geometryRequests})`);
const filled = trackPointsOf('gdacs:1001297');
ok(filled >= 2, `the record now holds a real track (${filled} points)`);
ok(filled <= ENDED.maxTrackPoints, `and respects the cap (${filled} <= ${ENDED.maxTrackPoints})`);
ok(trailVerticesOf('gdacs:1001297') >= 2, `the map now has a trail (${trailVerticesOf('gdacs:1001297')} vertices)`);
ok(!endedNeedsTrack('gdacs:1001297'), 'and the registry no longer asks for one');

/* THE REPAIR HAS TO REACH THE SCREEN. `fillEndedTrack` fires the lifecycle
 * listeners, which is what data/store.js re-emits on — without that the track
 * would sit correct in storage and the globe would stay blank until the next
 * poll, or until a reload. */
section('and it tells the app to redraw');
clean();
let notified = 0;
const stop = onLifecycleChange(() => { notified++; });
observeSource('gdacs', [lapsedStorm()]);
const beforeNotify = notified;
await backfillEndedTracks([lapsedStorm()]);
ok(notified > beforeNotify, `the lifecycle listeners fired on the repair (${beforeNotify} → ${notified})`);
stop();

/* ===========================================================================
 * 3. IT DOES NOT KEEP ASKING ONCE IT HAS ONE
 * ======================================================================== */
section('a storm that already has its trail is left alone');
const requestsAfterRepair = geometryRequests;
const again = await backfillEndedTracks([lapsedStorm()]);
ok(again === 0, `a second pass repairs nothing (${again})`);
ok(geometryRequests === requestsAfterRepair, `and makes no request (${geometryRequests - requestsAfterRepair} extra)`);

/* AND A SHORTER ANSWER MUST NEVER OVERWRITE A LONGER ONE — the same
 * only-ever-improves rule the live path follows.
 *
 * DRIVEN THROUGH `fillEndedTrack` DIRECTLY, not through the backfill. Once any
 * track lands the backfill correctly stops asking (the record has a trail, which
 * is the whole point), so the only way to reach the write rule is to call it —
 * and it has to be reachable, because `observeSource` calls it on the live path
 * every poll with whatever geometry happens to be cached.
 *
 * Both payloads are real bytes through the real parser. The clipped one is the
 * same response with most of its centre dots removed: a half-published or
 * mid-update answer, which is the only realistic way a LATER fetch is worse than
 * one already held. */
section('a shorter answer never overwrites a longer one');
const heldPoints = trackPointsOf('gdacs:1001297');   // the full fixture's count
clean();
observeSource('gdacs', [lapsedStorm()]);

geometryShort = true;
const shortBundle = await fetchGdacsGeometry(lapsedStorm());
geometryShort = false;
const fullBundle = await fetchGdacsGeometry(lapsedStorm());

ok(fillEndedTrack('gdacs:1001297', shortBundle), 'the clipped answer fills an empty record');
const shortPoints = trackPointsOf('gdacs:1001297');
ok(shortPoints > 1 && shortPoints < heldPoints, `with a genuinely shorter track (${shortPoints} vs ${heldPoints})`);

ok(fillEndedTrack('gdacs:1001297', fullBundle), 'a longer answer replaces it');
ok(trackPointsOf('gdacs:1001297') === heldPoints, `and the record grows (${shortPoints} → ${trackPointsOf('gdacs:1001297')})`);

ok(!fillEndedTrack('gdacs:1001297', shortBundle), 'the clipped answer is then REFUSED');
ok(trackPointsOf('gdacs:1001297') === heldPoints, `and the held track survives it (${trackPointsOf('gdacs:1001297')} points)`);

/* ===========================================================================
 * 4. THE GATE: ONLY A LAPSE IS FETCHABLE
 * ======================================================================== */
section('a storm that LEFT its feed is never fetched');
clean();
const gone = liveStorm();
observeSource('gdacs', [gone]);                       // seen alive, baseline 1
for (let i = 0; i < ENDED.absentConfirmations; i++) {
  observeSource('gdacs', [liveStorm('gdacs:9999', 'OTHER-26')]); // it is missing
}
const absentRec = endedStorms().find((s) => s.id === gone.id);
ok(!!absentRec, 'the absent storm is filed as finished');
ok(absentRec?.ended?.reason === 'absent', `by absence, not by lapse ("${absentRec?.ended?.reason}")`);
ok(!endedNeedsTrack(gone.id), 'and the registry refuses to call it repairable');

geometryRequests = 0;
const absentRepaired = await backfillEndedTracks([gone]);
ok(absentRepaired === 0, `nothing was repaired (${absentRepaired})`);
ok(geometryRequests === 0, `and NO request was made for a storm out of the feed (${geometryRequests})`);

/* ===========================================================================
 * 5. FAILURE IS BOUNDED
 * ======================================================================== */
/* A RETIRED EVENT ANSWERS 404, WHICH data/relay.js DOES NOT RETRY. One request
 * per attempt, capped at three, and then this device stops asking for good —
 * the cheapest possible ending for the case that will actually happen most:
 * GDACS finally archives the storm while we are still showing it. */
section('a retired event costs one request per attempt and then stops');
clean();
observeSource('gdacs', [lapsedStorm()]);
geometryGone = true;
geometryRequests = 0;

for (let poll = 0; poll < 6; poll++) {
  const n = await backfillEndedTracks([lapsedStorm()]);
  ok(n === 0, `poll ${poll + 1} repaired nothing, as expected`);
}
ok(
  geometryRequests === ENDED.trackBackfillAttempts,
  `six polls made exactly ${ENDED.trackBackfillAttempts} requests (${geometryRequests})`
);

/* ==> THE FLAKY-NETWORK SHAPE IS DELIBERATELY NOT EXERCISED HERE. <== A
 * RETRYABLE failure (dropped connection, 5xx) additionally pays data/relay.js's
 * own retry ladder INSIDE each attempt — 5 s, 15 s, then 45 s — so three
 * attempts is 65 seconds of real sleeping apiece and over three minutes of
 * suite. It was written, it passed, and it was cut: it exercises the same
 * `spent >= ENDED.trackBackfillAttempts` counter the 404 case above already
 * proves, and a suite nobody will sit through is a suite that stops being run.
 *
 * What that measurement DID establish, and is recorded here rather than
 * re-measured every time: a flaky network costs 4 requests per attempt (one
 * initial plus the three ladder steps), so 12 in the worst session — against
 * exactly 3 for a retired event, which is the case that will actually happen.
 * Both are bounded by the same counter. */
ok(endedNeedsTrack('gdacs:1001297'), 'and the storm is still marked repairable for the next session');
ok(trailVerticesOf('gdacs:1001297') === 0, 'the storm keeps its grey mark and no trail — never an error state');

/* A FAILED BACKFILL MUST NOT DAMAGE THE RECORD. The storm is still on screen,
 * still finished, still says what ended it. */
const survivor = endedStorms().find((s) => s.id === 'gdacs:1001297');
ok(!!survivor, 'the finished storm is still listed after three failures');
ok(survivor?.ended?.reason === 'lapsed', 'and still knows how it ended');

/* ===========================================================================
 * 6. AN UNKNOWN SOURCE IS NOT GUESSED AT
 * ======================================================================== */
section('a storm from a source with no fetcher is skipped, not guessed');
clean();
observeSource('gdacs', [lapsedStorm()]);
geometryRequests = 0;
const odd = { ...lapsedStorm(), source: 'somethingelse' };
const oddResult = await backfillEndedTracks([odd]);
ok(oddResult === 0, `nothing repaired (${oddResult})`);
ok(geometryRequests === 0, `and nothing fetched (${geometryRequests})`);

/* ------------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`    ✗ ${f}`);
  process.exit(1);
}
