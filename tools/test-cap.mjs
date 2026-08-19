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
  isActual, isRetracted, isAllClear, isInForce, severityRung,
} = await import('../lib/cap.js');
const { areaBand, areaSelect } = await import('../map/coast-band.js');
const { projectShapes, parseIds } = await import('../functions/api/cap/shapes.js');

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

/* =========================================================================
 * 9. THE DISCLOSURE — ENGLISH LEADS, THE AGENCY'S WORDS ARE BEHIND A CHEVRON
 *
 * Rendered through the real controller with a stubbed loader, because the
 * whole point of §50.4's layout is WHICH text is visible on arrival and no
 * assertion about the parser can reach that.
 * ====================================================================== */
section('the wording disclosure');

const { createCapStorm } = await import('../ui/cap-storm.js');

const capUi = createCapStorm({
  loadAlerts: async () => ({ state: 'ok', alerts, stale: false }),
});
await capUi.ensure(peilou, () => {});
const phHtml = capUi.html(peilou, NOW);

/* PAGASA writes in English, so there is nothing to hide and no chevron. */
ok(
  !phHtml.includes('data-cap-toggle'),
  'an English alert must not get a disclosure — hiding readable text buys nothing'
);
ok(
  phHtml.includes('Neneng'),
  "PAGASA's own English wording should be visible without a tap"
);

/* Now the Spanish one. Costa Rica is not among the fixture storms' countries,
 * so the alert is fed through a storm constructed for it — the country join
 * is asserted in section 5 and is not what this section is testing. */
const crStorm = { id: 'gdacs:test-cr', source: 'gdacs', countries: [{ iso2: 'CR' }] };
const capUi2 = createCapStorm({
  loadAlerts: async () => ({ state: 'ok', alerts, stale: false }),
});
await capUi2.ensure(crStorm, () => {});
const esHtml = capUi2.html(crStorm, NOW);

ok(esHtml.includes('data-cap-toggle'), 'a non-English alert must get a disclosure');
ok(
  esHtml.includes('aria-expanded="false"'),
  'the disclosure must arrive CLOSED — English is the default view (§50.4)'
);
ok(
  /<div class="detail-cap-words"[^>]*\shidden>/.test(esHtml),
  "the agency's Spanish wording must be hidden on arrival, not merely styled small"
);
ok(
  esHtml.includes('Spanish wording'),
  `the label should name the language in English; got: ${esHtml.slice(0, 0) || 'no match'}`
);
ok(esHtml.includes('aria-controls='), 'the disclosure must be wired for a screen reader');

/* THE ENGLISH LINE IS STILL THERE AND IS STILL NOT A TRANSLATION. This is the
 * tradeoff §50.4 accepts written as an assertion: with the wording collapsed,
 * the visible text names a severity and NOT a hazard. If a future pass adds
 * real translation, this is the assertion that should change. */
const visible = esHtml.replace(/<div class="detail-cap-words"[\s\S]*?<\/div>/g, '');
ok(
  !visible.includes('Onda Tropical'),
  "the agency's words must not leak into the visible half"
);
ok(
  /threat/.test(visible),
  'the coded English line must still lead the block'
);

/* =====================================================================
 * §50.8 — A WARNING, A STAND-DOWN AND A DRILL ARE THREE DIFFERENT THINGS
 *
 * ==> THE FIXTURE FOR THIS HALF IS SYNTHESISED AND SAYS SO. <== The captured
 * bytes predate the relay asking for these fields, so no real row in
 * `samples/` carries one. What IS real and was read off the service's own
 * schema (2026-08-19) is the vocabulary: `status` is Actual|Exercise|System|
 * Test|Draft, `msgType` is Alert|Update|Cancel|Ack|Error, `responseType`
 * includes AllClear. The rows below are the archived Costa Rica alert with
 * those fields set to values the schema defines.
 *
 * When the archive next runs, real rows carrying them land in
 * `capalerts-cyclone.json` and this fixture should be replaced with them.
 * Until then the vocabulary is verified and the ROWS are not, which is worth
 * less than real bytes and more than nothing (§48.11 makes the same trade).
 * ===================================================================== */
section('§50.8  in force vs stood down vs drill');

const baseRow = FEED.features.find((f) => f.attributes.countryCode === 'cr').attributes;
const withFields = (extra) => normalizeAlert({ ...baseRow, ...extra });
const NOW_50_6 = 0; /* nothing here has an expiry in the past at epoch 0 */

/* ==> A MISSING `status` IS ACTUAL, AND THAT IS LOAD-BEARING. <== CAP's own
 * default is Actual. If this flipped, every agency that omits the field would
 * have its live warnings silently discarded — the §5 failure, arrived at by
 * being careful. Asserted against a REAL row, which is exactly the case:
 * the captured fixture has no `status` at all. */
ok(isActual(normalizeAlert(baseRow)), 'a row with no status must count as Actual');
ok(
  readAlerts(FEED, Date.parse('2026-08-19T00:00:00Z')) !== null,
  'the real captured feed must still read after the filter was added'
);

ok(isActual(withFields({ status: 'Actual' })), 'Actual is actual');
ok(!isActual(withFields({ status: 'Exercise' })), 'an exercise is not a real alert');
ok(!isActual(withFields({ status: 'Test' })), 'a test is not a real alert');
ok(!isActual(withFields({ status: 'Draft' })), 'a draft is not a real alert');
ok(isActual(withFields({ status: 'ACTUAL' })), 'the status match must be case-insensitive');

ok(!isRetracted(withFields({ msgType: 'Alert' })), 'an Alert is not retracted');
ok(!isRetracted(withFields({ msgType: 'Update' })), 'an Update is not retracted');
ok(isRetracted(withFields({ msgType: 'Cancel' })), 'a Cancel retracts the alert');
ok(isRetracted(withFields({ msgType: 'Error' })), 'an Error disowns the alert');

ok(isAllClear(withFields({ responseType: 'AllClear' })), 'AllClear is an all-clear');
ok(
  isAllClear(withFields({ responseType: 'Monitor,AllClear' })),
  'responseType is a LIST — an all-clear among other values still counts'
);
ok(!isAllClear(withFields({ responseType: 'Prepare' })), 'Prepare is not an all-clear');

/* ==> THE COSTA RICA CASE, WHICH IS THE WHOLE REASON THIS EXISTS. <== The
 * agency said the tropical wave had PASSED and tagged it Severe. Painting a
 * coast off that row would light up both Costa Rican coastlines for a storm
 * that had already gone. */
const standDown = withFields({ status: 'Actual', msgType: 'Alert', responseType: 'AllClear' });
ok(
  standDown.event.includes('Fin de Influencia'),
  'the stand-down fixture must be the real archived row, not an invented one'
);
ok(standDown.severity === 'Severe', 'and it must keep the Severe tag that made it dangerous');
ok(!isInForce(standDown, NOW_50_6), 'a stand-down tagged Severe must NOT be in force');
ok(
  !isInForce(withFields({ status: 'Exercise', msgType: 'Alert' }), NOW_50_6),
  'a drill must not be in force'
);
ok(
  !isInForce(withFields({ msgType: 'Cancel' }), NOW_50_6),
  'a cancellation must not be in force'
);
ok(
  isInForce(withFields({ status: 'Actual', msgType: 'Alert', responseType: 'Prepare' }), NOW_50_6),
  'a live Actual/Alert row MUST be in force — the filter must not reject everything'
);

/* A CANCELLATION IS STILL READABLE. §50.8 keeps it in the list on purpose:
 * "the wave has passed" is what a reader watching a departing storm wants.
 * Only the PAINT is withheld. */
const readBack = readAlerts(
  { features: [{ attributes: { ...baseRow, msgType: 'Cancel' } }] },
  Date.parse('2026-08-19T00:00:00Z')
);
ok(readBack?.length === 1, 'a cancellation must survive readAlerts as readable text');

/* A DRILL IS NOT. Dropped at the read so no surface downstream can render one. */
const drillRead = readAlerts(
  { features: [{ attributes: { ...baseRow, status: 'Exercise' } }] },
  Date.parse('2026-08-19T00:00:00Z')
);
ok(drillRead?.length === 0, 'a drill must be dropped by readAlerts entirely');

/* =====================================================================
 * §50.9 — SEVERITY ONTO THE NHC COLOUR RUNGS
 * ===================================================================== */
section('§50.9  severity -> colour rung');

ok(severityRung({ severity: 'Extreme' }) === 'HWR', 'Extreme takes the top rung');
ok(severityRung({ severity: 'Severe' }) === 'HWA', 'Severe takes the second rung');
ok(severityRung({ severity: 'Moderate' }) === 'TWR', 'Moderate takes the third rung');
ok(severityRung({ severity: 'Minor' }) === 'TWA', 'Minor takes the bottom rung');
ok(severityRung({ severity: 'minor' }) === 'TWA', 'the rung match must be case-insensitive');

/* ==> AN UNSTATED SEVERITY IS NOT A RUNG. <== Picking one would make this the
 * only fact the paint depends on, invented. */
ok(severityRung({ severity: 'Unknown' }) === null, 'Unknown maps to no rung');
ok(severityRung({ severity: null }) === null, 'a missing severity maps to no rung');
ok(severityRung({}) === null, 'a row with no severity at all maps to no rung');

/* THE ORDER MUST MATCH THE PAINT ORDER. If these ever disagree, a foreign
 * Extreme alert would draw UNDER a Minor one on the same coast, which is the
 * §6 stacking bug in a new place. */
const { wwSortKey } = await import('../lib/watchwarning.js');
const rungOrder = ['Extreme', 'Severe', 'Moderate', 'Minor'].map(
  (s) => wwSortKey(severityRung({ severity: s }))
);
ok(
  rungOrder.every((v, i) => i === 0 || v < rungOrder[i - 1]),
  `severity must map onto strictly descending paint order; got ${rungOrder.join(',')}`
);

/* =====================================================================
 * §50.11 — THE WARNING AREA AS A COAST SELECTOR
 *
 * REAL BYTES: the archived PAGASA polygon, captured 2026-08-19. Seven
 * vertices covering the Philippine Area of Responsibility.
 * ===================================================================== */
section('§50.11  the area band');

const PAR = JSON.parse(
  fs.readFileSync('samples/cap/capalerts-shapes-2026-08-19.geojson', 'utf8')
);
const parRings = PAR.features[0].geometry.coordinates;

ok(parRings[0].length === 7, 'the PAR fixture must be the real 7-vertex polygon');

const band5 = areaBand(parRings, 5);
ok(band5 !== null, 'a real polygon must produce a band');
ok(band5.inBand([121.0, 14.6]), 'Manila is inside the Philippine Area of Responsibility');
ok(band5.inBand([126, 15]), 'open water inside the area counts as inside');
ok(!band5.inBand([139.7, 35.7]), 'Tokyo is outside the area');
ok(!band5.inBand([-155.09, 19.72]), 'Hawaii is outside the area');

/* ==> THE DILATION IS THE THING AARON ASKED FOR AND IT IS ASSERTED IN KM.
 * <== A degree of longitude is 108.89 km at 12N, so a test written in degrees
 * would silently assert the wrong distance — the first version of this probe
 * did exactly that and "failed" on correct code. */
const kmLonAt12 = 111.32 * Math.cos((12 * Math.PI) / 180);
const westOfEdge = (km) => [113 - km / kmLonAt12, 12];

ok(band5.inBand(westOfEdge(4.9)), '4.9 km outside the boundary is within a 5 km pad');
ok(!band5.inBand(westOfEdge(5.1)), '5.1 km outside the boundary is beyond a 5 km pad');

const band25 = areaBand(parRings, 25);
ok(band25.inBand(westOfEdge(24)), 'a 25 km pad reaches 24 km out');
ok(!band25.inBand(westOfEdge(26)), 'a 25 km pad stops before 26 km');

/* A ZERO PAD IS LEGITIMATE AND MUST NOT HANG. The grid cell has a floor for
 * exactly this; without it the cell size is zero and the column count is
 * infinite. */
const band0 = areaBand(parRings, 0);
ok(band0 !== null, 'a zero pad must still build a band');
ok(band0.inBand([121.0, 14.6]), 'a zero pad still contains points genuinely inside');
ok(!band0.inBand(westOfEdge(1)), 'a zero pad reaches nowhere outside the boundary');

ok(areaBand([], 5) === null, 'no rings is not a band');
ok(areaBand([[[1, 1], [2, 2]]], 5) === null, 'a two-point ring is not an area');

/* ==> THE THREE OUTCOMES ARE DISTINGUISHABLE, WHICH IS THE §5 POINT. <==
 * "no coastline loaded" and "no coast in this warning area" both paint
 * nothing and mean opposite things. */
ok(areaSelect(parRings, []).reason === 'no-coastline', 'no coastline must say so');
ok(areaSelect([], [[[121, 14], [121, 15]]]).reason === 'degenerate-area',
  'an unusable area must say so');

/* A synthetic coastline crossing the western boundary: half in, half out.
 * Not real coast — the real coastline only exists inside a browser, off
 * loaded basemap tiles — so this asserts the WIRING, and glass asserts the
 * look.
 *
 * ==> IT WIGGLES, AND THE FIRST VERSION OF THIS TEST DID NOT. <== A dead
 * straight line of constant latitude is EXACTLY what `isTileEdge` exists to
 * discard: tile boundaries are meridians and parallels, and a long
 * axis-aligned run is one. Every segment was dropped and the test failed
 * against correct code. Real coastline is never axis-aligned for 200 km, so
 * the fixture was wrong rather than the selector — recorded here because the
 * same trap will catch the next person who writes a straight test coast. */
const synthCoast = [[
  [110, 12.0], [111, 12.3], [112, 11.9], [114, 12.4], [116, 11.8], [118, 12.2],
]];
const sel = areaSelect(parRings, synthCoast, 5);
ok(sel.reason === null, 'a coastline crossing the area must produce runs');
ok(sel.runs.length >= 1, 'and at least one run');
ok(
  sel.runs.flat().every(([lon]) => lon >= 113 - 5 / kmLonAt12),
  'no selected vertex may sit west of the padded boundary'
);

/* =====================================================================
 * §50.10 — THE SHAPE ROUTE'S PROJECTION
 * ===================================================================== */
section('§50.10  shape route');

ok(parseIds('12,7,12').join(',') === '7,12', 'ids are deduped and sorted');
ok(parseIds('').length === 0, 'no ids is no ids');
ok(parseIds('3; DROP TABLE').length === 0, 'a non-numeric id is refused, not passed upstream');
ok(parseIds('4,abc,9').join(',') === '4,9', 'a bad id does not poison the good ones');

const projected = projectShapes({
  features: [
    { attributes: { OBJECTID: 5 }, geometry: { rings: [[[1, 1], [2, 2], [1, 2]]] } },
    { attributes: { OBJECTID: 6 }, geometry: null },
    { attributes: {}, geometry: { rings: [[[1, 1], [2, 2], [1, 2]]] } },
  ],
});
ok(projected.features.length === 1, 'a row with no geometry and a row with no id are both dropped');
ok(projected.features[0].id === 5, 'the surviving row keeps its join key');
ok(Array.isArray(projected.features[0].rings), 'and its rings arrive as a flat list');

/* =====================================================================
 * §50.11 — WHAT REACHES THE COAST
 *
 * The layer itself needs a map, so what is asserted here is the DECISION it
 * makes: which alerts out of a storm's list are allowed to paint. That
 * decision is the safety-bearing half — a drill or a stand-down reaching the
 * coast is the failure this whole pass exists to prevent — and it is pure.
 * ===================================================================== */
section('§50.11  what reaches the coast');

/** The layer's gate, as one predicate. Mirrors `map/layers/cap-coast.js`;
 *  if that file's filter changes, this must change with it. */
const paints = (alert, now) =>
  isInForce(alert, now) && alert.objectId != null && severityRung(alert) !== null;

const NOW_PAINT = Date.parse('2026-08-19T00:00:00Z');
const alertRow = (extra) => normalizeAlert({
  ...baseRow,
  OBJECTID: 900,
  status: 'Actual',
  msgType: 'Alert',
  responseType: 'Prepare',
  severity: 'Severe',
  expires: Date.parse('2026-08-20T00:00:00Z'),
  ...extra,
});

ok(paints(alertRow({}), NOW_PAINT), 'a live Severe alert with an id must paint');
ok(!paints(alertRow({ status: 'Exercise' }), NOW_PAINT), 'a drill must never reach the coast');
ok(!paints(alertRow({ status: 'Test' }), NOW_PAINT), 'a test must never reach the coast');
ok(!paints(alertRow({ msgType: 'Cancel' }), NOW_PAINT), 'a cancellation must never paint');
ok(
  !paints(alertRow({ responseType: 'AllClear' }), NOW_PAINT),
  'an all-clear must never paint — this is the Costa Rica case'
);
ok(
  !paints(alertRow({ expires: Date.parse('2026-08-18T00:00:00Z') }), NOW_PAINT),
  'an expired alert must never paint'
);

/* ==> AN UNSTATED SEVERITY PAINTS NOTHING, AND THAT IS NOT THE SAME CALL THE
 * NHC LAYER MAKES. <== There, an unreadable code still draws in the generic
 * hue, because the FACT of a warning is certain and only its class is unknown.
 * Here the area is a whole country and an unstated severity could be anything,
 * so neutral paint would still assert "this coast is under warning" at a
 * confidence the row does not carry. */
ok(!paints(alertRow({ severity: 'Unknown' }), NOW_PAINT), 'Unknown severity paints nothing');
ok(!paints(alertRow({ severity: null }), NOW_PAINT), 'a missing severity paints nothing');

/* NO ROW ID MEANS NO SHAPE CAN BE FETCHED. Not an error — just nothing to
 * draw, and the panel still shows the alert as text. */
ok(!paints(alertRow({ OBJECTID: null }), NOW_PAINT), 'an alert with no row id cannot paint');

/* THE ONE THAT MUST NOT OVER-FILTER. If every branch above were true at once
 * the layer would be permanently blank, which looks identical to working. */
ok(
  [alertRow({ severity: 'Extreme' }), alertRow({ severity: 'Minor' })]
    .every((a) => paints(a, NOW_PAINT)),
  'the gate must let ordinary live alerts through at both ends of the scale'
);

/* ===================================================================== */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
