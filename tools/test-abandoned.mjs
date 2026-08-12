#!/usr/bin/env node
/**
 * test-abandoned.mjs — the storm its source has stopped analysing but has not
 * stopped listing (SPEC §5).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-abandoned.mjs`, like every other
 * suite here.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE FILE FROM test-lifecycle.mjs
 * ===========================================================================
 *
 * ==> IT OWNS THE CLOCK, AND NOTHING ELSE IN THE PROJECT MAY. <==
 *
 * Every bug this file covers is invisible over a single poll and obvious over
 * two days of them. `test-lifecycle.mjs` runs against the real wall clock and
 * injects a `now` into the readers, which is enough for "is this storm ended"
 * and useless for "does this storm come back on Thursday" — the promotion path
 * stamps itself from `new Date()` and cannot be told otherwise. So this suite
 * replaces the global `Date` for its whole run.
 *
 * That is a big enough hammer that it does not belong in a file 138 other
 * assertions share. Here it is the entire point.
 *
 * ===========================================================================
 * THE THREE BUGS, ALL LIVE ON GLASS AT ONCE, ALL FOUND ON DOLPHIN-26
 * ===========================================================================
 *
 * GDACS listed DOLPHIN-26 as `iscurrent: "true"` with its last analysis
 * (`todate`) three days old and `datemodified` eleven minutes old — measured
 * off the archive branch, 2026-08-12. Aaron had been looking at it in
 * **Finished** for two days and it would not leave. Three separate faults,
 * and fixing any one alone leaves a worse app than before:
 *
 *   1. THE STAMP RESET. `promote` had no guard against re-ending a storm
 *      already in the registry. `lapsed` is the one route that fires on a
 *      storm STILL IN ITS SOURCE'S LIST, so it re-fired every poll and
 *      rewrote `ended.confirmedAt` — the very field the display window is
 *      measured from. The 12-hour countdown restarted every 30 minutes.
 *
 *   2. THE BOUNCE. Guard the stamp and the record finally expires — and the
 *      storm is instantly back in the LIVE list, because GDACS is still
 *      listing it. Next poll lapses it again. It flips between Finished and
 *      live forever, which reads worse than the zombie it replaced.
 *      `ENDED.stopListingAfter` is the answer: stop believing the list, not
 *      just the record.
 *
 *   3. THE WORKING-SET LEAK. `observeSource` wrote `seen` before asking
 *      whether the storm was already ended, and the new guard returns BEFORE
 *      the `seen.delete` a successful promotion does. So the storm sat in both
 *      maps, kept accruing absence votes, and resurrected itself twelve hours
 *      after expiry wearing a fresh timestamp. This one only became reachable
 *      because of fix 1, and was found by this suite rather than by reading.
 *
 * ===========================================================================
 * WHAT THIS CANNOT PROVE
 * ===========================================================================
 *
 * That the grey row reads right, that "quiet since Sun 7:00 AM" under a
 * **Finished** heading is coherent English to someone who did not write it, or
 * that a storm vanishing off the globe at hour 60 feels like a decision rather
 * than a glitch. That is glass, and it is Aaron's.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* ---------------------------------------------------------------------------
 * THE CLOCK
 *
 * `Date.now()` and `new Date()` both move; everything else is left alone, so
 * `Date.parse` and `new Date(iso)` behave normally and the modules under test
 * cannot tell. `setTimeout` is deliberately NOT faked — data/relay.js's retry
 * backoff is real time and the stub below never triggers it.
 * ------------------------------------------------------------------------- */
const RealDate = Date;
const HOUR = 3600e3;
let NOW = RealDate.parse('2026-08-09T12:00:00Z'); // DOLPHIN-26's real last fix

class FakeDate extends RealDate {
  constructor(...a) { a.length === 0 ? super(NOW) : super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;

const at = (hoursAfterLastFix) => {
  NOW = RealDate.parse('2026-08-09T12:00:00Z') + hoursAfterLastFix * HOUR;
};

/* ---------------------------------------------------------------------------
 * THE STORE AND THE WIRE
 * ------------------------------------------------------------------------- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

/* DOLPHIN-26's row, field for field off `origin/archive:latest/gdacs-events.json`
 * (fetched 2026-08-12T11:53Z). The `iscurrent` STRING and the zoneless
 * `todate` are both load-bearing and both exactly as GDACS publishes them. */
const feature = {
  properties: {
    eventtype: 'TC',
    eventid: 1001297,
    episodeid: 55,
    iscurrent: 'true',
    eventname: 'DOLPHIN-26',
    fromdate: '2026-07-27T00:00:00',
    todate: '2026-08-09T12:00:00',
    datemodified: '2026-08-12T11:50:19',
    alertlevel: 'Orange',
    severitydata: {
      severity: 269,
      severitytext: 'Hurricane/Typhoon > 74 mph (maximum wind speed of 269 km/h)',
    },
  },
  geometry: { type: 'Point', coordinates: [128.4, 26.1] },
};

/* ==> EVERY STUBBED ANSWER IS A CLEAN 200, INCLUDING THE ONES WE DO NOT CARE
 * ABOUT. <== data/relay.js treats a network error as retryable and sleeps
 * 5 s / 15 s / 45 s before giving up, in REAL time, per call. A throwing stub
 * turns a fifteen-poll scenario into a fifteen-minute test run that looks like
 * a hang. Learned the expensive way. */
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.includes('/gdacs/events') ? { features: [feature] } : {};
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
};

const { fetchGdacsStorms } = await import('../data/gdacs.js');
const { observeSource, endedStorms, resetLifecycle } = await import('../data/lifecycle.js');
const { mergeWithEnded } = await import('../data/merge.js');
const { ENDED, SILENCE } = await import('../config/constants.js');
const { isSilent } = await import('../lib/silence.js');

/* The console is noisy by design in this state — the app narrates every drop.
 * Muted so a passing run is readable; failures still print. */
const realInfo = console.info;
const realWarn = console.warn;
console.info = () => {};
console.warn = () => {};

/** One full poll cycle, exactly as data/store.js runs it: fetch, observe,
 *  sweep, merge. Returns what the storm list would show. */
async function poll() {
  const { storms } = await fetchGdacsStorms();
  observeSource('gdacs', storms);
  const dead = endedStorms();
  const shown = mergeWithEnded([], storms, dead);
  return {
    feedCount: storms.length,
    live: shown.filter((s) => !s.ended).map((s) => s.name),
    finished: shown.filter((s) => s.ended).map((s) => s.name),
    record: dead[0]?.ended || null,
  };
}

/* ---------------------------------------------------------------------------
 * 1. THE WHOLE ARC
 * ------------------------------------------------------------------------- */
section('a storm nobody is analysing: the whole arc, hour by hour');

resetLifecycle();

at(6);
let r = await poll();
ok(r.live.includes('DOLPHIN-26'), 'fix + 6 h: live, as any storm between advisories is');

at(SILENCE.after / HOUR + 1);
r = await poll();
ok(
  r.live.includes('DOLPHIN-26'),
  'fix + 25 h: STILL LIVE — silence is a hedge with a life, not a death'
);
ok(
  isSilent({ observedAt: feature.properties.todate + 'Z' }, NOW),
  'and it is wearing the silent badge by now, which is the whole point of the hedge'
);

at(ENDED.lapsedAfter / HOUR - 1);
r = await poll();
ok(r.live.includes('DOLPHIN-26'), 'fix + 47 h: one hour short of lapsing, still live');

at(ENDED.lapsedAfter / HOUR + 1);
r = await poll();
ok(r.finished.includes('DOLPHIN-26'), 'fix + 49 h: lapsed, and now in Finished');
ok(r.record.reason === 'lapsed', 'by the lapsed route');
ok(r.record.by === null, 'attributed to nobody, because nobody said anything');
ok(r.feedCount === 1, 'and GDACS is still listing it as current the whole time');

const firstConfirmedAt = r.record.confirmedAt;

at(ENDED.stopListingAfter / HOUR - 1);
r = await poll();
ok(r.finished.includes('DOLPHIN-26'), 'fix + 59 h: still in Finished, inside its grey window');
ok(
  r.record.confirmedAt === firstConfirmedAt,
  'and the confirmation stamp has not moved across ten hours of polling'
);

/* PAST THE BOUNDARY, NOT ON IT. The lapse was confirmed on the hour-49 poll,
 * not at hour 48, so its grey window closes at hour 61 — and `endedExpired`
 * uses `>` rather than `>=`, so hour 61 exactly is still inside it. Sampling
 * on the edge tested arithmetic instead of behaviour. */
at(ENDED.stopListingAfter / HOUR + 2);
r = await poll();
ok(
  !r.finished.includes('DOLPHIN-26') && !r.live.includes('DOLPHIN-26'),
  'fix + 62 h: GONE — off the list and out of the registry'
);
ok(r.feedCount === 0, 'because the parse cutoff stopped believing the feed row too');

/* ---------------------------------------------------------------------------
 * 2. IT STAYS GONE
 *
 * ==> THE ASSERTION THE WHOLE FILE EXISTS FOR. <== GDACS keeps publishing this
 * row, unchanged, for as long as it likes. Nothing about the passage of time
 * may put the storm back.
 * ------------------------------------------------------------------------- */
section('and it stays gone, however long GDACS keeps the row up');

let reappearances = 0;
for (let h = ENDED.stopListingAfter / HOUR + 2; h <= 24 * 7; h += 0.5) {
  at(h);
  const p = await poll();
  if (p.live.length || p.finished.length) reappearances++;
}
ok(
  reappearances === 0,
  `seven days of polling every 30 minutes and it never comes back ` +
    `(came back ${reappearances} time(s))`
);

/* ---------------------------------------------------------------------------
 * 3. IT NEVER GOES BACKWARDS
 *
 * The bounce, stated as the invariant it breaks: once a storm has been shown
 * as Finished, it must never be shown as LIVE again unless its source
 * publishes a new analysis. A storm that returns to the live list after the
 * app has said it stopped tracking it is a worse lie than never ending it.
 * ------------------------------------------------------------------------- */
section('once Finished, never silently live again');

resetLifecycle();
let everFinished = false;
let wentBackwards = 0;
for (let h = 40; h <= 24 * 4; h += 0.5) {
  at(h);
  const p = await poll();
  if (p.finished.includes('DOLPHIN-26')) everFinished = true;
  if (everFinished && p.live.includes('DOLPHIN-26')) wentBackwards++;
}
ok(everFinished, 'the storm did reach Finished during the run (the scenario is real)');
ok(
  wentBackwards === 0,
  `and never flipped back to the live list afterwards (flipped ${wentBackwards} time(s))`
);

/* ---------------------------------------------------------------------------
 * 4. THE STAMP IS WRITTEN ONCE
 *
 * Separated from the arc above because it is the direct statement of bug 1,
 * and because it must hold across a lot of polls rather than a few.
 * ------------------------------------------------------------------------- */
section('the confirmation stamp is written once and never rewritten');

resetLifecycle();
at(ENDED.lapsedAfter / HOUR + 1);
let p = await poll();
const stamp = p.record.confirmedAt;
ok(!!stamp, 'the lapse records a confirmation time');

const stamps = new Set([stamp]);
for (let h = ENDED.lapsedAfter / HOUR + 1.5; h < ENDED.stopListingAfter / HOUR; h += 0.5) {
  at(h);
  p = await poll();
  if (p.record) stamps.add(p.record.confirmedAt);
}
ok(
  stamps.size === 1,
  `one stamp across the whole grey window, not one per poll (saw ${stamps.size})`
);

/* And the consequence, stated as the thing a reader would notice: the window
 * really is `holdForLapsed` long, measured end to end, rather than unbounded. */
resetLifecycle();
at(ENDED.lapsedAfter / HOUR + 1);
await poll();
const shownFor = [];
for (let h = ENDED.lapsedAfter / HOUR + 1; h <= ENDED.lapsedAfter / HOUR + 40; h += 0.5) {
  at(h);
  const q = await poll();
  if (q.finished.includes('DOLPHIN-26')) shownFor.push(h);
}
const windowHours = shownFor.length ? shownFor[shownFor.length - 1] - shownFor[0] : 0;
ok(
  windowHours <= ENDED.holdForLapsed / HOUR,
  `the grey window lasts at most ${ENDED.holdForLapsed / HOUR} h end to end ` +
    `(measured ${windowHours} h)`
);

/* ---------------------------------------------------------------------------
 * 5. A FRESH FIX UNDOES ALL OF IT
 *
 * ==> THE DIRECTION THAT MATTERS MOST. <== Everything above is the app giving
 * up on a storm. Storms regenerate, and GDACS resumes analysing them. If any
 * of this were sticky, a grey "we stopped tracking this" state would sit on a
 * live typhoon — §5's worst failure, an all-clear over a real storm.
 * ------------------------------------------------------------------------- */
section('a single fresh analysis puts it straight back');

resetLifecycle();
at(ENDED.lapsedAfter / HOUR + 1);
await poll();
ok((await poll()).finished.includes('DOLPHIN-26'), 'lapsed first');

feature.properties.todate = '2026-08-11T15:00:00'; // GDACS analyses it again
feature.properties.episodeid = 56;
r = await poll();
ok(r.live.includes('DOLPHIN-26'), 'a new fix revives it into the live list on the same poll');
ok(r.finished.length === 0, 'and it is not in Finished at the same time');

/* The same, from the far side of the parse cutoff: a storm dropped from the
 * list entirely comes back the moment the row carries a current analysis.
 * Nothing has to be unwound, because the cutoff holds no state. */
resetLifecycle();
feature.properties.todate = '2026-08-09T12:00:00';
at(24 * 5);
ok((await poll()).feedCount === 0, 'five days silent: not in the parsed list at all');
feature.properties.todate = '2026-08-14T09:00:00';
const back = await poll();
ok(back.feedCount === 1, 'and one fresh fix puts the row straight back into the list');
ok(back.live.includes('DOLPHIN-26'), 'live, with no residue of having been dropped');

/* ---------------------------------------------------------------------------
 * 6. THE CUTOFF REFUSES TO ACT ON WHAT IT CANNOT READ
 * ------------------------------------------------------------------------- */
section('an unreadable date is not evidence of anything');

resetLifecycle();
feature.properties.todate = 'not a date';
feature.properties.fromdate = 'not a date either';
at(24 * 5);
ok(
  (await poll()).feedCount === 1,
  'a storm with no readable fix time is KEPT — one malformed field must not ' +
    'delete a live typhoon'
);
feature.properties.todate = '2026-08-09T12:00:00';
feature.properties.fromdate = '2026-07-27T00:00:00';

/* ---------------------------------------------------------------------------
 * 7. THE DEVICE THAT IS ALREADY BROKEN
 *
 * ==> THIS IS AARON'S PHONE, AND IT IS THE ONLY REASON `promote`'s GUARD
 * SURVIVED REVIEW. <== Everything above is about a clean device. The build
 * being replaced wrote the storm into BOTH maps at once — `ended` because it
 * had lapsed, `seen` because the code refreshed the working set before asking
 * whether the storm was already finished. Both are persisted, so every phone
 * that has run the app this week is carrying that state right now.
 *
 * On upgrade, the parse cutoff drops the storm before `observeSource` ever
 * sees it, so the `seen.delete` in step 1 — which only runs for storms IN the
 * list — never fires. The stale entry sits there, collects three absence
 * votes, and promotes the storm a second time as `absent`: a fresh 24-hour
 * window, and "GDACS stopped listing this system" on screen for something
 * this app did itself. Two lies for the price of one.
 *
 * The guard is what makes the upgrade safe. It is the ONLY path that reaches
 * it — every other caller of `promote` already skips registry members — which
 * is worth knowing before anyone deletes it as belt-and-braces.
 * ------------------------------------------------------------------------- */
section('a phone carrying the broken state upgrades quietly');

{
  const KEY = 'landfall.ended';
  at(24 * 5); // five days past the last fix: the cutoff drops the row at parse

  const stale = {
    id: 'gdacs:1001297',
    name: 'DOLPHIN-26',
    source: 'gdacs',
    basin: 'NW Pacific',
    observedAt: '2026-08-09T12:00:00Z',
  };
  const lapsedRecord = {
    ...stale,
    ended: {
      reason: 'lapsed',
      by: null,
      at: '2026-08-09T12:00:00Z',
      confirmedAt: new Date(NOW - 2 * HOUR).toISOString(),
      became: null,
      key: '2026-08-09T12:00:00Z',
    },
  };

  mem.set(
    KEY,
    JSON.stringify({
      v: 2,
      ended: [{ storm: lapsedRecord, track: [], at: NOW - 2 * HOUR }],
      /* The same storm, in the working set, exactly as the old code left it. */
      seen: {
        'gdacs:1001297': {
          storm: stale, track: [], absent: 0, source: 'gdacs', at: NOW - HOUR,
        },
      },
      /* Zero, so the truncation guard cannot be what saves us here — an empty
       * list against a zero baseline is credible and DOES get to vote. */
      baseline: { gdacs: 0, nhc: 0 },
    })
  );

  const fresh = await import('../data/lifecycle.js?migration');

  let record = null;
  for (let i = 0; i < ENDED.absentConfirmations + 2; i++) {
    const { storms } = await fetchGdacsStorms();
    fresh.observeSource('gdacs', storms);
    record = fresh.endedStorms()[0]?.ended || null;
  }

  ok(
    record === null || record.reason === 'lapsed',
    `the stale working-set entry never re-ends the storm as 'absent' ` +
      `(got ${record ? record.reason : 'nothing'})`
  );
  ok(
    record === null || record.confirmedAt === lapsedRecord.ended.confirmedAt,
    'and it never gets a fresh confirmation stamp, so its window still closes on time'
  );

  at(24 * 5 + 24);
  ok(
    fresh.endedStorms().length === 0,
    'twenty-four hours later the upgraded device is clean'
  );

  mem.delete(KEY);
}

/* ---------------------------------------------------------------------------
 * 8. THE TWO HALVES CANNOT BE EDITED APART
 * ------------------------------------------------------------------------- */
section('the registry and the parser agree on one number by construction');

ok(
  ENDED.stopListingAfter === ENDED.lapsedAfter + ENDED.holdForLapsed,
  'the parse cutoff is the SUM of the two registry durations, not a third number'
);
ok(
  ENDED.lapsedAfter === 2 * SILENCE.after,
  'and lapsing is still exactly twice the silence threshold'
);

/* ------------------------------------------------------------------------- */
console.info = realInfo;
console.warn = realWarn;
globalThis.Date = RealDate;

if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (none of them can tell you whether a storm vanishing at hour 60');
console.log('   reads as a decision or as a glitch — that is glass)');
