#!/usr/bin/env node
/**
 * test-emissions.mjs — what comes OUT of a volcano, and what must never be
 * drawn coming out of one.
 *
 * ZERO DEPENDENCIES, like every other suite here. Run:
 * `node tools/test-emissions.mjs`
 *
 * Three faults are guarded here and all three put something on the globe that
 * is not happening:
 *
 * 1. **A grey ash column over a volcano that is quietly steaming.** Gas and
 *    steam is the most common thing a volcano does and it is white.
 * 2. **An eruption drawn from resuspended ash.** Wind lifting old deposits off
 *    a plain is a real ash cloud and a real aviation hazard, and no volcano is
 *    doing anything. Measured live on 2026-07-31: Sabancaya arrived named,
 *    numbered and 21,000 ft tall, saying `NO ERUPTION - RESUSPENDED VA`.
 * 3. **Mojibake in the one text channel that names any of this.** The weekly
 *    feed declares ISO-8859-1; reading it as UTF-8 replaces every accented
 *    character and the classification runs on damaged text.
 *
 * The narrative snippets below are VERBATIM from the Smithsonian / USGS Weekly
 * Volcanic Activity Report, issues 16–22 July 2026 and 23–29 July 2026, read
 * from the live feed on 2026-07-31.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const { classifyEmissions } = await import('../functions/api/volcano/_emissions.js');
const { parseAdvisory } = await import('../functions/api/volcano/_vaa.js');
const { parseWeekly } = await import('../functions/api/volcano/_union.js');
const { decodeDeclared } = await import('../functions/api/volcano/live.js');
const { VOLCANO } = await import('../config/constants.js');

const fixture = (name) => readFileSync(`samples/vaac/${name}.txt`, 'utf8');
const OPTS = {
  exerciseStatus: VOLCANO.ash.exerciseStatus,
  flightLevelToFeet: VOLCANO.ash.flightLevelToFeet,
};

/* --- classification, against real report text ---------------------------- */
section('emission classes, from live report narratives');

{
  const greatSitkin =
    'The Alaska Volcano Observatory (AVO) reported that slow lava effusion ' +
    'continued to feed a thick flow in Great Sitkin\u2019s summit crater during ' +
    '22-29 July. Minor earthquakes were detected daily. Elevated surface ' +
    'temperatures were identified in satellite images during 25-29 July.';
  ok(
    same(classifyEmissions(greatSitkin), ['lava']),
    'lava-only eruption classifies as lava and NOT as ash'
  );
}

{
  const krakatau =
    'A white, gray, and black ash plume rose as high as 300 m above the summit ' +
    'on 25 July and a white-and-gray ash plume rose 100 m above the summit.';
  ok(same(classifyEmissions(krakatau), ['ash']), 'an ash plume classifies as ash');
}

{
  /* ==> THE CASE THE WHOLE FILE EXISTS FOR. <== Katmai, 24 July 2026: 1912 ash
   * in the air, nothing erupting. Both classes are true at once and the
   * renderer needs both — it IS ash, and it is NOT an eruption. */
  const katmai =
    'strong winds in the vicinity of Katmai and the Valley of Ten Thousand ' +
    'Smokes dispersed unconsolidated ash up to 1.8 km (6,000 ft) a.s.l. to the ' +
    'SE. The ash was originally deposited during the Novarupta-Katmai eruption ' +
    'in 1912.';
  ok(
    same(classifyEmissions(katmai), ['ash', 'resuspended']),
    'wind-lifted 1912 ash is BOTH ash and resuspended'
  );
}

{
  /* The published typo. One letter, and without it this report loses its only
   * emission class. */
  const rincon =
    'a phreatic eruption that lasted around two minutes ejected ballistics 200 m ' +
    'above the lake\u2019s surface and generated a gas-and-stream plume that rose ' +
    '400 m and drifted W. Notably, there were 38 phreatic eruptions during 2-24 ' +
    'July, three of which generated lahars on the N flank.';
  ok(
    same(classifyEmissions(rincon), ['steam', 'lahar']),
    'gas-and-stream (published typo for gas-and-steam) still classifies as steam'
  );
}

{
  const merapi =
    'the eruption at Merapi (on Java) continued with daily lava avalanches ' +
    'produced by the active lava dome on the upper SW flank. One pyroclastic ' +
    'flow traveled 2 km down the Boyong drainage (S flank) on 28 July.';
  ok(same(classifyEmissions(merapi), ['lava', 'pdc']), 'lava plus pyroclastic flow');
}

{
  /* Kilauea only says the word "lava" late; for whole paragraphs it is
   * "fountaining". A classifier keyed on `lava` alone reads this as ash-only. */
  const kilauea =
    'the eruption within Kilauea\u2019s Kaluapele summit caldera, characterized by ' +
    'episodic fountaining, incandescence, and intermittent spatter, continued. ' +
    'The episode ended after around 7.4 hours of continuous fountaining from ' +
    'the N vent. Fine ash was observed within public areas of the park.';
  ok(
    same(classifyEmissions(kilauea), ['ash', 'lava']),
    'fountaining counts as lava with no adjacent "lava"'
  );
}

{
  /* ==> AN EMPTY ANSWER IS A REAL ANSWER (SPEC.md §5). <== Restless volcano,
   * nothing emitted. This must be an empty list, never a default class. */
  const kuchinoerabujima =
    'further analysis of seismic data at Kuchinoerabujima from 9 July and ' +
    'results from field visits indicated that there likely was no increase in ' +
    'volcanic unrest. At 1550 on 17 July the Alert Level was lowered to 1.';
  ok(
    classifyEmissions(kuchinoerabujima).length === 0,
    'unrest with no emission classifies as nothing at all'
  );
  ok(classifyEmissions(null).length === 0, 'a missing narrative is an empty list');
  ok(classifyEmissions('').length === 0, 'an empty narrative is an empty list');
}

{
  /* ==> A KNOWN LIMIT, ASSERTED SO IT CANNOT BE FORGOTTEN. <== Bulusan's report
   * warns pilots about the POTENTIAL for ash plumes; no ash was observed. The
   * classifier cannot tell a hazard warning from an observation and returns
   * `ash`. That is why `emissions` selects a COLOUR and never, on its own,
   * decides that something is erupting — the erupting judgement is the report
   * category and the ash advisories. */
  const bulusan =
    'Weak-to-moderate gas emissions rose from the summit crater and active ' +
    'vents. Pilots were warned not to fly close to the summit because of the ' +
    'potential of ash plumes from phreatic eruptions.';
  ok(
    same(classifyEmissions(bulusan), ['ash', 'steam']),
    'KNOWN LIMIT: a warning about potential ash reads as ash'
  );
}

/* --- the weekly parser carries the classes ------------------------------- */
section('parseWeekly threads the classification through');

{
  const xml =
    '<rss><channel><item>' +
    '<title>Great Sitkin (United States) - Report for 23 July-29 July 2026 - ' +
    'Continuing Eruptive Activity</title>' +
    '<guid>https://volcano.si.edu/reports_weekly.cfm#vn_311120</guid>' +
    '<description><![CDATA[slow lava effusion continued to feed a thick flow ' +
    'in the summit crater.]]></description>' +
    '</item></channel></rss>';
  const { reports } = parseWeekly(xml);
  ok(reports.length === 1, 'one item parses to one report');
  ok(same(reports[0].emissions, ['lava']), 'and carries its emission classes');
  ok(reports[0].erupting === true, 'without disturbing the erupting judgement');
}

{
  const noDescription =
    '<rss><channel><item>' +
    '<title>Ahyi (United States) - Report for 16 July-22 July 2026 - ' +
    'New Eruptive Activity</title>' +
    '<guid>https://volcano.si.edu/reports_weekly.cfm#vn_284141</guid>' +
    '</item></channel></rss>';
  const { reports } = parseWeekly(noDescription);
  ok(
    reports.length === 1 && reports[0].emissions.length === 0,
    'an item with no description still parses, with no classes'
  );
}

/* --- resuspension on the ash channel ------------------------------------- */
section('resuspended ash is flagged, not silently drawn');

{
  /* ==> PROVENANCE, STATED. <== The full bulletin for this advisory was NOT
   * captured — tgftp was serving an older message in the Buenos Aires slots
   * when it was looked for. What IS real is the `ERUPTION DETAILS` value, read
   * off the live relay payload on 2026-07-31 (Sabancaya 354006, advisory
   * 2026/472, 21,000 ft). It is spliced into the captured quiet bulletin so the
   * surrounding shape is a genuine Buenos Aires message. **If a real
   * resuspension bulletin is ever captured, replace this and delete the
   * splice.** */
  const body = fixture('buenosaires-sabancaya-quiet').replace(
    'ERUPTION DETAILS: NO VA EMISSION',
    'ERUPTION DETAILS: NO ERUPTION - RESUSPENDED VA'
  );
  ok(body.includes('RESUSPENDED'), 'the splice landed');

  const r = parseAdvisory(body, OPTS);
  ok(r && r.ok !== false, 'a resuspension advisory is still parsed, not rejected');
  ok(r.resuspended === true, 'and is flagged resuspended');
  ok(r.n === 354006, 'while keeping its join key — it is a real cloud at a real place');
}

{
  const etna = parseAdvisory(fixture('toulouse-etna-active'), OPTS);
  ok(etna.resuspended === false, 'a genuine eruption is not flagged resuspended');

  const quiet = parseAdvisory(fixture('buenosaires-sabancaya-quiet'), OPTS);
  ok(
    quiet.resuspended === false,
    '`NO VA EMISSION` is not `NO ERUPTION` and must not trip the flag'
  );
}

/* --- the two newly captured active bulletins ----------------------------- */
section('active bulletins carry geometry the payload does not yet use');

{
  const dukono = parseAdvisory(fixture('darwin-dukono-active'), OPTS);
  ok(dukono.n === 268010, 'Darwin active bulletin joins on its GVP number');
  ok(dukono.ash === true, 'and reports ash');
  ok(dukono.plumeTopFeet === 7000, 'at a top read from SFC/FL070');
  ok(dukono.status === 'active', 'and classifies as active');
  ok(
    fixture('darwin-dukono-active').includes('MOV NE'),
    'the drift bearing is present in the bulletin (unparsed — Phase H3)'
  );
}

{
  const reventador = parseAdvisory(fixture('washington-reventador-active'), OPTS);
  ok(reventador.n === 352010, 'Washington active bulletin joins on its GVP number');
  ok(reventador.plumeTopFeet === 14000, 'and reads its top through hard line wraps');
  ok(
    fixture('washington-reventador-active').includes('MOV\nNW 15KT'),
    'whose drift bearing survives a wrap mid-phrase (unparsed — Phase H3)'
  );
}

/* --- the charset decode -------------------------------------------------- */
section('a body is decoded as the character set it declares');

{
  /* `Puracé` in ISO-8859-1: the accented character is the single byte 0xE9.
   * Read as UTF-8 that byte is invalid and becomes U+FFFD, which is the exact
   * corruption that pulled the narrative from the payload on the first deploy. */
  const latin1 = new Uint8Array([
    0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f,
    0x6e, 0x3d, 0x22, 0x31, 0x2e, 0x30, 0x22, 0x20, 0x65, 0x6e, 0x63, 0x6f,
    0x64, 0x69, 0x6e, 0x67, 0x3d, 0x22, 0x49, 0x53, 0x4f, 0x2d, 0x38, 0x38,
    0x35, 0x39, 0x2d, 0x31, 0x22, 0x3f, 0x3e,
    0x50, 0x75, 0x72, 0x61, 0x63, 0xe9,
  ]).buffer;

  ok(decodeDeclared(latin1).endsWith('Purac\u00e9'), 'ISO-8859-1 decodes correctly');
  ok(
    !decodeDeclared(latin1).includes('\ufffd'),
    'and produces no replacement characters'
  );
  ok(
    new TextDecoder('utf-8').decode(latin1).includes('\ufffd'),
    'where the previous UTF-8 decode of the same bytes does — the fault, reproduced'
  );
}

{
  const utf8 = new TextEncoder().encode('<?xml version="1.0"?>Purac\u00e9').buffer;
  ok(decodeDeclared(utf8) === '<?xml version="1.0"?>Purac\u00e9', 'undeclared falls back to UTF-8');

  const bogus = new TextEncoder().encode('<?xml encoding="not-a-charset"?>ok').buffer;
  ok(
    decodeDeclared(bogus).endsWith('ok'),
    'an unknown encoding label falls back rather than throwing'
  );
}

/* --- report -------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
