#!/usr/bin/env node
/**
 * test-cap.mjs — local agency alerts (SPEC §50).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-cap.mjs`, same as every other
 * suite here (§12 — this project has no toolchain by design).
 *
 * ===========================================================================
 * THE FIXTURES ARE REAL BYTES
 * ===========================================================================
 *
 * `samples/cap/capalerts-2026-08-19.json` is the exact payload the archive
 * branch captured: five rows, from three countries, in two languages, with
 * epoch-millisecond dates and a genuine duplicate in it. Nothing here was
 * written from the shape a docs page describes.
 *
 * THAT DUPLICATE IS THE POINT OF HALF THIS FILE. Costa Rica's meteorological
 * institute published one message twice — same event, same area, same expiry,
 * different severity, eight minutes apart. A version of this feature written
 * against a hand-made fixture would never have met it and would print an
 * agency contradicting itself.
 *
 * ALSO REAL: two of the five rows are Environment Canada storm-surge warnings
 * for the YUKON. They are matched by the relay's `where` clause because surge
 * is surge, and the ONLY thing keeping them out of a Philippine storm's panel
 * is the country join. That is asserted below rather than assumed.
 *
 * ===========================================================================
 * THE MUTATION CHECKS
 * ===========================================================================
 *
 * §12: a test that passes on the same wrong assumption as the bug is worse
 * than no test. Every assertion below that guards a rule is paired with a
 * demonstration that the NAIVE implementation gives a DIFFERENT answer — the
 * seconds-vs-milliseconds read really does put every alert in 1970, dropping
 * the country join really does put Yukon under a Philippine typhoon, keeping
 * the most severe duplicate really does pick the other row. If those pairs
 * ever start agreeing, this suite has stopped testing anything.
 *
 * WHAT THIS CANNOT PROVE: that the English sentence reads as reassuring or
 * alarming to a person. That is glass.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const {
  readAlerts, normalizeAlert, plainEnglish, isExpired,
  dedupeAlerts, alertsForStorm, stormCountries,
} = await import('../lib/cap.js');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const FEED = JSON.parse(fs.readFileSync('samples/cap/capalerts-2026-08-19.json', 'utf8'));
const GDACS = JSON.parse(fs.readFileSync('samples/cap/gdacs-storms-2026-08-19.json', 'utf8'));

/** ==> THE CLOCK IS PINNED TO THE FIXTURE'S OWN HOUR. <== Every row in this
 *  feed carries an expiry, and `readAlerts` correctly drops expired ones — so
 *  a suite using the real clock passes on the day of capture and is red
 *  forever after. That is the "a check that is always red teaches you to
 *  ignore the board" failure this repo has a standing rule about. */
const NOW = Date.parse('2026-08-19T01:00:00Z');

/** The normalized storm objects data/gdacs.js would build, for the three
 *  fixture storms — only the fields §50 reads. */
const storm = (name) => {
  const f = GDACS.features.find((x) => x.properties.eventname === name);
  if (!f) throw new Error(`fixture storm missing: ${name}`);
  return {
    id: `gdacs:${f.properties.eventid}`,
    source: 'gdacs',
    countries: f.properties.affectedcountries || null,
  };
};

/* =========================================================================
 * 1. THE FIXTURE IS WHAT WE THINK IT IS
 * ====================================================================== */
section('the archived feed');

ok(FEED.features.length === 5, `expected 5 archived rows, got ${FEED.features.length}`);
ok(
  FEED.features.filter((f) => f.attributes.countryCode === 'ca').length === 2,
  'expected two Environment Canada rows in the fixture'
);
ok(
  FEED.features.some((f) => f.attributes.language === 'es'),
  'expected a non-English row in the fixture'
);

/* =========================================================================
 * 2. DATES ARE MILLISECONDS — AND THE NAIVE READ IS SILENTLY CATASTROPHIC
 * ====================================================================== */
section('epoch units');

const ph = normalizeAlert(
  FEED.features.find((f) => f.attributes.countryCode === 'ph').attributes
);
ok(ph.expires === 1787111712000, `expires read wrong: ${ph.expires}`);
ok(
  new Date(ph.expires).getUTCFullYear() === 2026,
  `expiry should land in 2026, got ${new Date(ph.expires).toISOString()}`
);

/* MUTATION: the seconds reading. It does not throw, it does not warn, and it
 * puts every alert in 1970 — where every one of them is expired and the whole
 * section renders a permanent, confident "no alerts in force". */
const asSeconds = new Date(ph.expires / 1000).getUTCFullYear();
ok(
  asSeconds !== 2026,
  'MUTATION DEAD: dividing by 1000 no longer changes the year — this check is testing nothing'
);
ok(asSeconds === 1970, `expected the naive read to give 1970, got ${asSeconds}`);

/* =========================================================================
 * 3. EXPIRY IS THE AGENCY'S, NOT OURS
 * ====================================================================== */
section('expiry');

ok(isExpired(ph, ph.expires + 1) === true, 'an alert past its expiry is expired');
ok(isExpired(ph, ph.expires - 1) === false, 'an alert before its expiry is not');
/* A row with no expiry has not ended. Absence of an end time is not an end
 * time — the opposite reading would silently hide an open-ended warning. */
ok(
  isExpired({ ...ph, expires: null }, NOW) === false,
  'an alert with no expiry must not be treated as expired'
);

/* =========================================================================
 * 4. THE DUPLICATE — AND THE RULE THAT PICKS BETWEEN THEM
 * ====================================================================== */
section('duplicates');

const crRows = FEED.features
  .filter((f) => f.attributes.countryCode === 'cr')
  .map((f) => normalizeAlert(f.attributes));
ok(crRows.length === 2, 'fixture should carry the real Costa Rica duplicate');
ok(
  crRows[0].expires === crRows[1].expires && crRows[0].event === crRows[1].event,
  'the two Costa Rica rows should be the same message twice'
);
ok(
  crRows[0].severity !== crRows[1].severity,
  'the two Costa Rica rows should disagree on severity — that is the trap'
);

const deduped = dedupeAlerts(crRows);
ok(deduped.length === 1, `dedupe should leave one Costa Rica alert, left ${deduped.length}`);

const newest = crRows.slice().sort((a, b) => b.sent - a.sent)[0];
ok(
  deduped[0].sent === newest.sent,
  'dedupe must keep the row the agency issued LAST'
);

/* ==> THE REAL FIXTURE CANNOT TELL THE TWO RULES APART, AND THIS IS WRITTEN
 *     DOWN RATHER THAN GLOSSED OVER. <== In Costa Rica's pair the newest row
 * is ALSO the most severe, so "keep the newest" and "keep the scariest" agree
 * and a mutation check against these bytes proves nothing. That is not a
 * reason to skip the check — it is a reason to build the case the bytes do not
 * happen to contain.
 *
 * CONSTRUCTED, and labelled as such: the same message reissued as a
 * DOWNGRADE, which is the ordinary shape of a storm weakening. Recency keeps
 * the downgrade; severity-ranking keeps the superseded warning and tells a
 * reader a threat is worse than the agency now says it is. */
const RANK = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
const downgradePair = [
  { ...crRows[0], severity: 'Severe', sent: 1000, expires: 9e12, agency: 'X', event: 'E', area: 'A' },
  { ...crRows[0], severity: 'Minor', sent: 2000, expires: 9e12, agency: 'X', event: 'E', area: 'A' },
];
const keptByRecency = dedupeAlerts(downgradePair)[0];
ok(keptByRecency.severity === 'Minor', 'a downgrade supersedes the warning it replaces');

const keptBySeverity = downgradePair.slice().sort(
  (a, b) => (RANK[b.severity.toLowerCase()] || 0) - (RANK[a.severity.toLowerCase()] || 0)
)[0];
ok(
  keptBySeverity.severity !== keptByRecency.severity,
  'MUTATION DEAD: severity-ranking now picks the same row as recency — the dedupe rule is untested'
);

/* A row with no `sent` must never displace one that has it. */
const noSent = dedupeAlerts([{ ...crRows[0] }, { ...crRows[1], sent: null }]);
ok(noSent.length === 1 && noSent[0].sent != null, 'an unknown time is not a later time');

/* =========================================================================
 * 5. THE COUNTRY JOIN — THE ONLY THING KEEPING YUKON OUT
 * ====================================================================== */
section('matching a storm to an agency');

const alerts = readAlerts(FEED, NOW);
ok(Array.isArray(alerts), 'readAlerts should return a list for a good body');
ok(alerts.length === 4, `expected 4 alerts after dedupe, got ${alerts.length}`);

const peilou = storm('PEILOU-26');       // Philippines
const onec = storm('ONE-C-26');          // United States
const hernan = storm('HERNAN-26');       // no country — out at sea

ok(stormCountries(peilou).join() === 'PH', `PEILOU should resolve to PH, got ${stormCountries(peilou)}`);
ok(stormCountries(onec).join() === 'US', `ONE-C should resolve to US, got ${stormCountries(onec)}`);
ok(stormCountries(hernan).length === 0, 'HERNAN is offshore and should resolve to no country');

const forPeilou = alertsForStorm(alerts, peilou);
ok(forPeilou.length === 1, `PEILOU should match one alert, got ${forPeilou.length}`);
ok(forPeilou[0].agency === 'PAGASA-DOST', `PEILOU matched the wrong agency: ${forPeilou[0].agency}`);

/* THE ASSERTION THIS SECTION EXISTS FOR. */
ok(
  !forPeilou.some((a) => a.country === 'CA'),
  'a Yukon storm-surge warning must never appear under a Philippine typhoon'
);

/* MUTATION: no country join — every alert on earth under every storm. The
 * Canadian rows come through, which is the bug this guards. */
ok(
  alerts.some((a) => a.country === 'CA'),
  'MUTATION DEAD: the Canadian rows are gone from the feed, so the join is proving nothing'
);

/* A storm with no country matches nothing — and that is a TRUE answer, not a
 * failure. The UI words it as such (§50.5). */
ok(alertsForStorm(alerts, hernan).length === 0, 'an offshore storm matches no agency');

/* Case: the feed publishes lowercase country codes, GDACS uppercase. If the
 * normalizer stops folding case, this goes to zero silently. */
ok(
  FEED.features.find((f) => f.attributes.countryCode === 'ph'),
  'fixture country codes should be lowercase — the case fold is load-bearing'
);

/* =========================================================================
 * 6. UNREADABLE IS NOT EMPTY — THE §5 ASSERTION
 * ====================================================================== */
section('an outage is never an all-clear');

ok(readAlerts(null, NOW) === null, 'a missing body is unreadable, not empty');
ok(readAlerts({}, NOW) === null, 'a body with no features is unreadable, not empty');
ok(
  readAlerts({ error: { code: 400, message: 'refused' } }, NOW) === null,
  "ArcGIS's HTTP-200-with-an-error must be unreadable, not empty"
);
/* And the true empty answer is a LIST, so the caller can tell them apart. */
const empty = readAlerts({ features: [] }, NOW);
ok(Array.isArray(empty) && empty.length === 0, 'a genuinely empty feed is an empty list');

/* MUTATION: the collapsing version — `(json?.features || [])` — answers the
 * same thing for both, which is how a refused query becomes a published
 * all-clear. */
const naive = (j) => (j && j.features) || [];
ok(
  naive({ error: { code: 400 } }).length === naive({ features: [] }).length,
  'MUTATION DEAD: the naive read now distinguishes the two cases'
);

/* =========================================================================
 * 7. THE ENGLISH SENTENCE IS NOT A TRANSLATION
 * ====================================================================== */
section('plain English');

const es = alerts.find((a) => a.language === 'es');
ok(!!es, 'expected the Spanish alert to survive to this point');

const line = plainEnglish(es);
ok(typeof line === 'string' && line.length > 0, 'a coded alert should produce a sentence');

/* THE RULE: not one word of the agency's own text may appear in our sentence.
 * Checked against the actual words rather than asserted in a comment. */
const agencyWords = `${es.event} ${es.headline}`
  .toLowerCase()
  .split(/[^a-záéíóúñ]+/i)
  .filter((w) => w.length > 3);
const leaked = agencyWords.filter((w) => line.toLowerCase().includes(w));
ok(
  leaked.length === 0,
  `our English line must contain none of the agency's words; leaked: ${leaked.join(', ')}`
);

/* Every code in the fixture resolves — no row falls through to the unknown
 * wording by accident. */
for (const a of alerts) {
  const s = plainEnglish(a);
  ok(
    s && !s.includes('do not recognise'),
    `unrecognised CAP code in a real row: ${a.severity}/${a.urgency}/${a.certainty}`
  );
}

/* An unknown code is NAMED, never dropped — a reader must not think an alert
 * had no urgency when it had an unreadable one. */
const weird = plainEnglish({ severity: 'Severe', urgency: 'Sideways', certainty: 'Likely' });
ok(
  weird.includes('Sideways'),
  `an unrecognised code must survive into the sentence, got: ${weird}`
);

/* A row with no codes at all produces nothing rather than an empty dash
 * sandwich — the UI then shows only the agency's words. */
ok(
  plainEnglish({ severity: null, urgency: null, certainty: null }) === null,
  'no codes should produce no sentence, not a stray separator'
);

/* =========================================================================
 * 8. A ROW WITH NOTHING TO SAY IS NOT AN ALERT
 * ====================================================================== */
section('empty rows');

ok(normalizeAlert(null) === null, 'a missing row is not an alert');
ok(
  normalizeAlert({ severity: 'Severe', urgency: 'Immediate', certainty: 'Observed' }) === null,
  'coded fields with no event and no headline name no hazard and must be dropped'
);
ok(
  normalizeAlert({ event: 'Typhoon Warning' }) !== null,
  'an event with no headline is still an alert'
);

/* ===================================================================== */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
