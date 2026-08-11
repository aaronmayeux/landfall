#!/usr/bin/env node
/**
 * test-heading.mjs — the arrow points where the storm is going, or it is not
 * drawn; and a storm nobody ended does not say "ended".
 *
 * ZERO DEPENDENCIES, plain `node tools/test-heading.mjs`.
 *
 * ==> BOTH HALVES OF THIS FILE EXIST BECAUSE OF ONE SCREENSHOT. <== Aaron,
 * 2026-08-11: PEILOU-26 carrying a ↗ that meant "moving away from your house"
 * and read as a compass bearing, and DOLPHIN-26 sitting in the Finished group
 * on Tuesday afternoon stamped "ended Sun 7:00 AM" — a time at which nothing
 * happened to it, since GDACS still listed it as current when the archive was
 * fetched that same afternoon.
 *
 * THE FIXTURES ARE THE REAL EVENT. DOLPHIN's timings below are its actual
 * ones: last GDACS analysis 2026-08-09T12:00:00Z, our `lapsed` route firing 48
 * hours later. That is what makes the expiry assertions worth anything — a
 * synthetic 25-hour-old record would have passed against the old code too.
 *
 * WHAT THIS CANNOT PROVE: that a 12px arrow reads as a direction at a glance,
 * or that rotating it looks right beside monospace figures. Those are glass.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { motionHeading, headingWords, norm } = await import('../lib/heading.js');
const { endedRowStamp, endedExpired } = await import('../lib/lifecycle.js');
const { MOTION, ENDED } = await import('../config/constants.js');

/* ---------------------------------------------------------------------------
 * THE PUBLISHED HEADING WINS
 * ------------------------------------------------------------------------- */

section('published motion outranks the track');

{
  /* A storm quoting NW while its forecast track runs due east. The agency's
   * number is what the advisory says and what a reader can go and check, so a
   * screen disagreeing with the bulletin it cites is the failure here — not a
   * degree of precision. */
  const storm = { lon: 0, lat: 0, headingDeg: 315 };
  const track = [{ lon: 1, lat: 0 }];
  const h = motionHeading(storm, track);
  ok(h?.deg === 315, 'published headingDeg is used verbatim');
  ok(h?.derived === false, 'a published heading is not flagged derived');
}

{
  const h = motionHeading({ lon: 0, lat: 0, headingDeg: -45 });
  ok(h?.deg === 315, 'a negative published heading is normalised into [0,360)');
}

/* ---------------------------------------------------------------------------
 * THE DERIVED HEADING
 * ------------------------------------------------------------------------- */

section('deriving a heading from the forecast track');

{
  /* One degree of latitude is 60 nm by definition, so a point 0.6° north is
   * 36 nm out — clear of MOTION.minTrackNm (30) and due north. */
  const h = motionHeading({ lon: 0, lat: 0, headingDeg: null }, [{ lon: 0, lat: 0.6 }]);
  ok(h != null, 'a far-enough forecast point defines a heading');
  ok(Math.abs(h.deg - 0) < 0.5, 'due-north track reads as 0°');
  ok(h.derived === true, 'a track-derived heading is flagged derived');
}

{
  const h = motionHeading({ lon: 0, lat: 0, headingDeg: null }, [{ lon: 1, lat: 0 }]);
  ok(Math.abs(h.deg - 90) < 0.5, 'due-east track reads as 90°');
}

{
  /* ==> THE SPIN GUARD, AND IT IS THE REASON minTrackNm EXISTS. <== A first
   * forecast point 6 nm away is two roundings of the same position; the
   * bearing between them swings wildly between polls on a storm that has not
   * turned. The walk must SKIP it and carry on, not fail on it. */
  const near = { lon: 0, lat: 0.1 };   // 6 nm — too close
  const far = { lon: 0.6, lat: 0 };    // 36 nm east
  const h = motionHeading({ lon: 0, lat: 0, headingDeg: null }, [near, far]);
  ok(h != null, 'a too-close first point is skipped, not fatal');
  ok(Math.abs(h.deg - 90) < 1, 'the heading comes from the first point past minTrackNm');
}

{
  /* Every probeable point inside the deadband: the storm is barely moving and
   * gets no arrow rather than one describing next week. */
  const crawl = Array.from({ length: 8 }, (_, i) => ({ lon: 0, lat: 0.01 * (i + 1) }));
  ok(motionHeading({ lon: 0, lat: 0, headingDeg: null }, crawl) === null,
    'a barely-moving track yields no heading at all');
}

{
  /* The walk is bounded. A track whose only far-enough point sits past
   * MOTION.maxProbePoints must not be reached — that bearing describes the end
   * of the forecast, not the storm's current motion. */
  const pts = [];
  for (let i = 0; i < MOTION.maxProbePoints; i += 1) pts.push({ lon: 0, lat: 0.001 * i });
  pts.push({ lon: 5, lat: 0 });
  ok(motionHeading({ lon: 0, lat: 0, headingDeg: null }, pts) === null,
    'the probe stops at MOTION.maxProbePoints and does not read the far future');
}

section('and refusing to invent one');

ok(motionHeading({ lon: 0, lat: 0, headingDeg: null }) === null,
  'no published heading and no track means no heading');
ok(motionHeading({ lon: 0, lat: 0, headingDeg: null }, []) === null,
  'an empty forecast array is not a heading');
ok(motionHeading({ lon: null, lat: null, headingDeg: null }, [{ lon: 1, lat: 1 }]) === null,
  'a storm with no position cannot have a derived heading');
ok(motionHeading(null) === null, 'no storm, no heading');
ok(motionHeading({ lon: 0, lat: 0, headingDeg: null }, [{ lon: null, lat: 0.6 }]) === null,
  'a forecast point with no coordinates is skipped rather than trusted');

/* ---------------------------------------------------------------------------
 * THE SPOKEN FORM
 * ------------------------------------------------------------------------- */

section('the arrow is spoken, because a rotation is not');

ok(headingWords(0) === 'north', '0° speaks as north');
ok(headingWords(315) === 'northwest', '315° speaks as northwest');
ok(headingWords(22.5) === 'north-northeast', 'the 16-point compass is spelled out');
ok(headingWords(null) === null, 'no heading, nothing spoken');
ok(!/^[NSEW]{1,3}$/.test(headingWords(292.5) || ''),
  'the spoken form is words, never the WNW abbreviation a reader hears letter by letter');
ok(norm(-1) === 359 && norm(721) === 1, 'norm wraps in both directions');

/* ---------------------------------------------------------------------------
 * THE ENDED ROW STAMP — DOLPHIN'S ACTUAL CASE
 * ------------------------------------------------------------------------- */

section('a storm nobody ended does not say "ended"');

const HOUR = 3600 * 1000;
/* The real event. Last GDACS analysis Sunday 12:00 UTC; the `lapsed` route
 * fires at ENDED.lapsedAfter (48 h) and stamps confirmedAt then. */
const lastFix = Date.parse('2026-08-09T12:00:00Z');
const dolphin = {
  id: 'gdacs:1001297',
  observedAt: new Date(lastFix).toISOString(),
  ended: {
    reason: 'lapsed',
    by: null,
    at: new Date(lastFix).toISOString(),
    confirmedAt: new Date(lastFix + ENDED.lapsedAfter).toISOString(),
  },
};

{
  const s = endedRowStamp(dolphin);
  ok(s.word === 'quiet since', 'a lapsed storm reads "quiet since", not "ended"');
  ok(!/ended/i.test(s.word), 'the word "ended" does not appear on a lapsed row');
  ok(typeof s.when === 'string' && s.when.length > 0, 'the clock is still shown');
}

{
  const declared = { ended: { reason: 'declared', by: 'jtwc', at: '2026-08-11T18:00:00Z' } };
  ok(endedRowStamp(declared).word === 'ended', 'a declared ending still reads "ended"');
  const absent = { ended: { reason: 'absent', by: 'nhc', at: '2026-08-11T18:00:00Z' } };
  ok(endedRowStamp(absent).word === 'ended', 'an absent ending still reads "ended"');
}

{
  /* No clock, no dangling preposition. "quiet since" on its own is a fragment
   * waiting for a word that is not coming. */
  const noClock = { ended: { reason: 'lapsed', at: null, confirmedAt: null } };
  ok(endedRowStamp(noClock).word === 'quiet', 'with no clock the lapsed word is the bare adjective');
}

ok(endedRowStamp({}) === null, 'a live storm has no ended stamp');

/* ---------------------------------------------------------------------------
 * THE SHORTER HOLD
 * ------------------------------------------------------------------------- */

section('a lapsed storm clears sooner than a declared one');

{
  /* Tuesday 15:20 local in the screenshot — 20:20 UTC, roughly 8 h after the
   * lapse fired. Inside the OLD 24 h window and outside the new 12 h one. */
  const seenAt = lastFix + ENDED.lapsedAfter + 8 * HOUR;
  ok(endedExpired(dolphin, seenAt) === false,
    'eight hours after the lapse it is still shown — the grey period is real');

  const later = lastFix + ENDED.lapsedAfter + 13 * HOUR;
  ok(endedExpired(dolphin, later) === true,
    'thirteen hours after the lapse it is gone — this FAILS if holdForLapsed is dropped');

  /* The guard against over-correcting: it must not vanish on the poll that
   * ended it, which is the disappearing-storm failure the hold exists for. */
  ok(endedExpired(dolphin, lastFix + ENDED.lapsedAfter + 60 * 1000) === false,
    'it does not vanish on the same poll that ended it');
}

{
  /* Same age, declared instead of lapsed: still on screen, because that day of
   * grey is the reader's only chance to see what happened. */
  const declaredAt = Date.parse('2026-08-11T13:00:00Z');
  const chanhom = {
    ended: {
      reason: 'declared',
      by: 'jtwc',
      at: new Date(declaredAt).toISOString(),
      confirmedAt: new Date(declaredAt).toISOString(),
    },
  };
  ok(endedExpired(chanhom, declaredAt + 13 * HOUR) === false,
    'a declared ending keeps the full 24 h — the shorter hold is lapsed-only');
  ok(endedExpired(chanhom, declaredAt + 25 * HOUR) === true,
    'and still expires at 24 h');
}

ok(ENDED.holdForLapsed < ENDED.holdFor,
  'the lapsed hold is genuinely shorter, not an alias for the same number');

/* ------------------------------------------------------------------------- */

console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
