#!/usr/bin/env node
/**
 * test-vaa.mjs — the volcano relay's parser, union and failure states.
 *
 * ZERO DEPENDENCIES, like every other suite here. Run: `node tools/test-vaa.mjs`
 *
 * WHY THIS SUITE EXISTS, AND IT IS NOT PARSER PEDANTRY. Every bug this catches
 * has the same shape: **it puts something on a globe that is not happening, or
 * reports a quiet planet when a feed is dead.** Neither one looks like a
 * failure from the inside. A parser that mistakes the WIND for an ash cloud
 * renders an eruption at a volcano whose bulletin exists to say the ash is
 * gone. A relay that lets a 2024 test bulletin through renders a RED eruption
 * that never happened. A union that reports an empty list when VAAC is
 * unreachable shows an all-clear during an outage, which is the one failure
 * this whole app is organised against (§5).
 *
 * The bulletins in samples/vaac/ are REAL, pulled from tgftp on 2026-07-30,
 * one per behaviour. Read that directory's README before adding a case: it
 * records the four things the original Phase C plan got wrong, each with the
 * fixture that disproves it.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { parseStream, parseAdvisory, splitAdvisories, readAshCloud, parseDtg } =
  await import('../functions/api/volcano/_vaa.js');
const { buildPayload, parseWeekly, parseAlerts } =
  await import('../functions/api/volcano/_union.js');
const {
  SLOTS,
  GROUPS,
  ALL_CENTRES,
  TGFTP_BASE,
  slotsInGroup,
  centresInGroup,
  slotUrl,
} = await import('../functions/api/volcano/_slots.js');
const { VOLCANO } = await import('../config/volcano.js');

const fixture = (name) => readFileSync(`samples/vaac/${name}.txt`, 'utf8');
const OPTS = {
  exerciseStatus: VOLCANO.ash.exerciseStatus,
  flightLevelToFeet: VOLCANO.ash.flightLevelToFeet,
};

/* Fixed clock. The age filter is real logic and it must be tested against a
 * known instant, not against whenever the suite happens to run — otherwise
 * every fixture silently ages out and the suite starts passing for the wrong
 * reason. 2026-07-30T04:30Z, minutes after the newest fixture was published. */
const NOW = Date.parse('2026-07-30T04:30:00Z');

/* --- the mirror ----------------------------------------------------------- */
section('the tuning numbers in live.js mirror config/constants.js');

/* Pages Functions cannot import from the app (§3), so live.js carries a copy
 * of the VOLCANO numbers. A copy nobody checks is how two copies drift — the
 * same argument, and the same remedy, as tools/test-kv-keys.mjs. */
{
  const src = readFileSync('functions/api/volcano/live.js', 'utf8');
  const num = (re, what) => {
    const m = re.exec(src);
    ok(!!m, `live.js states ${what}`);
    return m ? m[1] : null;
  };
  ok(
    num(/advisoryMaxAgeHours:\s*(\d+)/, 'advisoryMaxAgeHours') ===
      String(VOLCANO.ash.advisoryMaxAgeHours),
    'advisoryMaxAgeHours agrees with constants.js'
  );
  ok(
    num(/flightLevelToFeet:\s*(\d+)/, 'flightLevelToFeet') ===
      String(VOLCANO.ash.flightLevelToFeet),
    'flightLevelToFeet agrees with constants.js'
  );
  ok(
    /freshSeconds:\s*30\s*\*\s*60/.test(src) &&
      VOLCANO.ash.freshSeconds === 30 * 60,
    'ash freshSeconds agrees with constants.js'
  );
  for (const s of VOLCANO.ash.exerciseStatus) {
    ok(src.includes(`'${s}'`), `live.js carries exercise status ${s}`);
  }
  for (const key of Object.keys(VOLCANO.state)) {
    ok(src.includes(`${key}:`), `live.js carries the ${key} state name`);
  }
}

/* --- record splitting ---------------------------------------------------- */
section('records split on the VA ADVISORY header, not on the = terminator');

{
  /* Washington's bulletin has NO terminating `=` at all. Splitting on `=`
   * loses it, or worse fuses the next advisory onto it — and a fused record
   * parses cleanly while reporting the WRONG volcano. */
  const noTerminator = fixture('washington-santa-maria-close');
  ok(!/=\s*$/.test(noTerminator.trim()), 'the Washington fixture really has no = terminator');
  ok(splitAdvisories(noTerminator).length === 1, 'a bulletin with no = still yields one record');

  /* London's `=` is on its own line. */
  ok(
    splitAdvisories(fixture('london-krysuvik-exer')).length === 1,
    'a bulletin whose = is on its own line yields one record'
  );

  /* Concatenated, as the BoM page and the joined transports deliver them. */
  const three = [
    fixture('toulouse-etna-active'),
    fixture('washington-santa-maria-close'),
    fixture('tokyo-sheveluch-close'),
  ].join('\n');
  ok(splitAdvisories(three).length === 3, 'three concatenated bulletins split into three');

  ok(splitAdvisories('').length === 0, 'an empty stream yields no records');
  ok(splitAdvisories('nothing here at all').length === 0, 'unrelated text yields no records');

  /* ==> THE BUG THE FIRST LIVE DEPLOY FOUND AND THESE FIXTURES COULD NOT. <==
   * Every bulletin opens with a WMO heading (`FVPS02 NZKL 151845`) that sits
   * ABOVE the `VA ADVISORY` line the splitter cuts on, so each record ended
   * with the NEXT bulletin's heading and the last field parsed absorbed it.
   * Live payload read `nextAdvisory: "NO FURTHER ADVISORIES= FVPS02 NZKL 151845"`.
   * A single-bulletin fixture has no next bulletin, which is why every test
   * here that matters concatenates. */
  {
    const joined = [fixture('wellington-ambae-close'), fixture('tokyo-sheveluch-close')].join('\n');
    const recs = parseStream(joined, OPTS);
    ok(recs.advisories.length === 2, 'two concatenated bulletins yield two advisories');
    for (const a of recs.advisories) {
      ok(
        !/\bFV[A-Z]{2}\d{2}\s+[A-Z]{4}\s+\d{6}/.test(a.nextAdvisory || ''),
        `the next bulletin's WMO heading does not leak into ${a.vaacName}'s last field`
      );
      ok(
        !/\bFV[A-Z]{2}\d{2}\s+[A-Z]{4}\s+\d{6}/.test(a.eruptionDetails || ''),
        `nor into ${a.vaacName}'s eruption details`
      );
    }
    const ambae = recs.advisories.find((a) => a.n === 257030);
    ok(
      ambae.nextAdvisory === 'NO FURTHER ADVISORIES',
      'the last field is exactly what the centre wrote, with nothing appended'
    );
  }
}

/* --- the label scan ------------------------------------------------------ */
section('fields survive every whitespace habit the nine centres have');

{
  /* Toulouse wraps ERUPTION DETAILS and OBS VA CLD at column ZERO, so an
   * indentation-based continuation rule drops half of both — on the one
   * bulletin that day describing a real eruption. */
  const etna = parseAdvisory(fixture('toulouse-etna-active'), OPTS);
  ok(etna.ok, 'the live Etna advisory parses');
  ok(etna.n === 211060, 'Etna joins on GVP number 211060');
  ok(
    /CLOUD UP TO 7KM/.test(etna.eruptionDetails),
    'an unindented continuation line is kept (Toulouse wraps at column zero)'
  );
  ok(
    /N3806 E01442 MOV NW 10KT/.test(etna.ashCloudRaw),
    'the ash cloud continuation line is kept, position list and all'
  );
  ok(etna.colour === 'RED', 'the aviation colour code is read (RED)');
  ok(etna.advisoryNr === '2026/1', 'the advisory number is read verbatim');
  ok(etna.vaac === 'TOULOUSE', 'the issuing centre is read');
  ok(etna.observed === true, 'OBS VA CLD is recorded as observed, not estimated');

  /* Wellington indents eight spaces — the opposite habit, same requirement. */
  const ambae = parseAdvisory(fixture('wellington-ambae-close'), OPTS);
  ok(ambae.ok && ambae.n === 257030, 'the Wellington Ambae advisory parses');
  ok(
    /RECENT ACTIVITY/.test(ambae.eruptionDetails),
    'an eight-space-indented continuation line is kept'
  );

  /* Washington puts a blank line between every field and writes `+6HR`. */
  const santaMaria = parseAdvisory(fixture('washington-santa-maria-close'), OPTS);
  ok(santaMaria.ok && santaMaria.n === 342030, 'blank lines between fields do not break the scan');
  ok(
    santaMaria.eruptionDetails === 'VA EMS ENDED',
    'a field followed by a blank line ends at the next label, not at the blank'
  );

  /* Buenos Aires writes SUMMIT ELEV where the others write SOURCE ELEV, and
   * `NOT GIVEN` for a colour it declined to state. */
  const sabancaya = parseAdvisory(fixture('buenosaires-sabancaya-quiet'), OPTS);
  ok(sabancaya.ok && sabancaya.n === 354006, 'SUMMIT ELEV instead of SOURCE ELEV still parses');
  ok(
    sabancaya.colour === 'NOT GIVEN',
    'a declined colour stays the string the centre wrote, not null'
  );

  /* `DTG` must not match inside `OBS VA DTG`. */
  ok(etna.dtg === '2026-07-30T03:50:00.000Z', 'DTG is the advisory time, not the observation time');
  ok(parseDtg('20260730/0350Z') === '2026-07-30T03:50:00.000Z', 'a DTG becomes an ISO instant');
  ok(parseDtg('20261930/0350Z') === null, 'an impossible month is rejected, not rolled forward');
  ok(parseDtg('UNKNOWN') === null, 'UNKNOWN is not a date');
  ok(parseDtg('') === null && parseDtg(null) === null, 'an absent DTG is null');
}

/* --- the WIND trap ------------------------------------------------------- */
section('the WIND flight level is not an ash cloud');

{
  /* THE BUG THIS PREVENTS: Tokyo's Sheveluch close carries
   * `OBS VA CLD: VA NOT IDENTIFIABLE FM SATELLITE DATA WIND FL180 340/15KT`.
   * A scan for FL\d+ finds FL180 and puts an 18,000 ft plume on a volcano
   * whose bulletin exists to say the ash is gone. */
  const tokyo = parseAdvisory(fixture('tokyo-sheveluch-close'), OPTS);
  ok(tokyo.ok && tokyo.n === 300270, 'the Tokyo Sheveluch advisory parses');
  ok(/FL180/.test(tokyo.ashCloudRaw), 'the fixture really does contain FL180 (as the wind)');
  ok(tokyo.ash === false, 'WIND FL180 is NOT read as an ash cloud');
  ok(tokyo.plumeTopFeet === null, 'no plume height is invented from the wind');
  ok(tokyo.status === 'closing', 'Sheveluch reads as closing, not active');

  /* Same trap, two more centres. */
  const ambae = parseAdvisory(fixture('wellington-ambae-close'), OPTS);
  ok(ambae.ash === false, 'Wellington WIND FL010/020 is not an ash cloud');
  ok(ambae.status === 'closing', 'Ambae reads as closing');

  /* And the real thing, which must survive all of that scepticism. */
  const etna = parseAdvisory(fixture('toulouse-etna-active'), OPTS);
  ok(etna.ash === true, 'SFC/FL230 with a position list IS an ash cloud');
  ok(etna.plumeTopFeet === 23000, 'FL230 becomes 23,000 ft');
  ok(etna.status === 'active', 'Etna reads as active');

  /* Unit behaviour, directly. */
  ok(readAshCloud('SFC/FL150 N1234 E01234', 100).topFeet === 15000, 'FL150 -> 15,000 ft');
  ok(
    readAshCloud('FL150/230 N1234 E01234', 100).topFeet === 23000,
    'a banded cloud reports its TOP, which is what a plume height is'
  );
  ok(readAshCloud('VA NOT IDENTIFIABLE', 100).ash === false, 'an explicit denial means no ash');
  ok(readAshCloud('NO VA EXP', 100).ash === false, 'NO VA EXP means no ash');
  ok(readAshCloud('NOT PROVIDED', 100).ash === false, 'NOT PROVIDED means no ash');
  ok(readAshCloud('', 100).ash === false, 'an empty cloud field means no ash');
  ok(
    readAshCloud('N1234 E01234 - N1235 E01235 MOV NW 10KT', 100).ash === true,
    'ash asserted with a position but no level is still ash'
  );
  ok(
    readAshCloud('N1234 E01234 - N1235 E01235 MOV NW 10KT', 100).topFeet === null,
    'and its height is null rather than a made-up number'
  );
}

/* --- an advisory is not an eruption -------------------------------------- */
section('closes are closes: three of the newest bulletins on the wire');

{
  /* Counting bulletins instead of reading them would put all three of these
   * dead events on the globe. */
  for (const [file, n, label] of [
    ['tokyo-sheveluch-close', 300270, 'Sheveluch (VA IS NOT IDENTIFIABLE)'],
    ['washington-santa-maria-close', 342030, 'Santa Maria (VA EMS ENDED)'],
    ['wellington-ambae-close', 257030, 'Ambae (ash no longer observable)'],
    ['buenosaires-sabancaya-quiet', 354006, 'Sabancaya (NO VA EMISSION)'],
  ]) {
    const rec = parseAdvisory(fixture(file), OPTS);
    ok(rec.ok && rec.n === n, `${label} parses`);
    ok(rec.status !== 'active', `${label} does NOT read as active`);
    ok(rec.status === 'closing', `${label} reads as closing`);
  }

  /* `quiet` is the fifth state and it is neither of the other two: no ash in
   * this bulletin, but the centre has scheduled another one, so it is still
   * watching. Collapsing it into `closing` would have the app announce an
   * ending the centre did not announce. */
  const quiet = parseAdvisory(
    fixture('toulouse-etna-active').replace(
      /OBS VA CLD:[\s\S]*?FCST VA CLD \+6 HR:/,
      'OBS VA CLD: VA NOT IDENTIFIABLE FM SATELLITE DATA\nFCST VA CLD +6 HR:'
    ),
    OPTS
  );
  ok(quiet.ok, 'the derived no-ash bulletin parses');
  ok(quiet.ash === false, 'and carries no ash');
  ok(
    quiet.status === 'quiet',
    'no ash but a scheduled next advisory is `quiet`, not `closing` and not `active`'
  );
}

/* --- the three guards --------------------------------------------------- */
section('exercise, test and unjoinable traffic never reaches the globe');

{
  /* Declared exercise. */
  const exer = parseAdvisory(fixture('london-krysuvik-exer'), OPTS);
  ok(exer.ok === false, 'STATUS: EXER is rejected');
  ok(exer.reason === 'exercise', 'and rejected for being an exercise');

  /* ==> THE ONE THE PLAN GOT WRONG. <== Toulouse's test bulletin has NO
   * STATUS line, carries AVIATION COLOUR CODE: RED and an ERUPTION AT time.
   * "Absence of a STATUS line means operational" would publish it. */
  const raw = fixture('toulouse-test-unknown');
  ok(!/^STATUS:/m.test(raw), 'the Toulouse test bulletin really has no STATUS line');
  ok(/AVIATION COLOUR CODE: RED/.test(raw), 'and really does claim colour code RED');
  const test = parseAdvisory(raw, OPTS);
  ok(test.ok === false, 'it is rejected anyway');
  ok(
    test.reason === 'unknown_volcano',
    'caught by VOLCANO: UNKNOWN — the guard that covers the STATUS hole'
  );

  /* `600000` is number-shaped, so the unknown test must read the NAME. */
  ok(
    /VOLCANO: UNKNOWN 600000/.test(raw),
    'and VOLCANO: UNKNOWN still carries a number-shaped id, so the name is what is tested'
  );

  /* A bulletin with no usable DTG cannot be aged or deduped. */
  const noDtg = parseAdvisory(
    fixture('toulouse-etna-active').replace('DTG: 20260730/0350Z', 'DTG: UNKNOWN'),
    OPTS
  );
  ok(noDtg.ok === false && noDtg.reason === 'no_dtg', 'an unusable DTG is rejected');
}

/* --- dedupe ------------------------------------------------------------- */
section('dedupe on GVP number + DTG, newest per volcano wins');

{
  /* BoM and the Wellington slots overlap on purpose, and centres issue on each
   * other's behalf, so the same eruption really does arrive twice. */
  const doubled = [fixture('toulouse-etna-active'), fixture('toulouse-etna-active')].join('\n');
  const r = parseStream(doubled, OPTS);
  ok(r.seen === 2, 'two copies were read');
  ok(r.advisories.length === 1, 'and reduced to one advisory');

  /* Newest per volcano — and NOT most-severe. A close published after an
   * eruption is the current truth; taking a max over severity would pin a
   * volcano to its worst moment forever. */
  const older = fixture('toulouse-etna-active')
    .replace('DTG: 20260730/0350Z', 'DTG: 20260730/0250Z')
    .replace(/OBS VA CLD:[\s\S]*?FCST VA CLD \+6 HR:/, 'OBS VA CLD: SFC/FL350 N3806 E01442\nFCST VA CLD +6 HR:');
  const newerClose = fixture('toulouse-etna-active')
    .replace(/OBS VA CLD:[\s\S]*?FCST VA CLD \+6 HR:/, 'OBS VA CLD: VA NOT IDENTIFIABLE\nFCST VA CLD +6 HR:')
    .replace('NXT ADVISORY: NO LATER THAN 20260730/0445Z', 'NXT ADVISORY: NO FURTHER ADVISORIES');
  const seq = parseStream([older, newerClose].join('\n'), OPTS);
  ok(seq.advisories.length === 1, 'two DTGs for one volcano reduce to one record');
  ok(
    seq.advisories[0].status === 'closing',
    'the NEWER close wins over the older, more alarming eruption'
  );

  /* Everything at once, as the relay actually sees it. */
  const all = parseStream(
    [
      'toulouse-etna-active',
      'washington-santa-maria-close',
      'tokyo-sheveluch-close',
      'wellington-ambae-close',
      'buenosaires-sabancaya-quiet',
      'london-krysuvik-exer',
      'toulouse-test-unknown',
    ]
      .map(fixture)
      .join('\n'),
    OPTS
  );
  ok(all.seen === 7, 'all seven bulletins are read');
  ok(all.advisories.length === 5, 'five are publishable');
  ok(all.rejected.exercise === 1, 'one exercise rejected');
  ok(all.rejected.unknown_volcano === 1, 'one unjoinable rejected');
  ok(
    all.advisories.filter((a) => a.status === 'active').length === 1,
    'exactly one is an active eruption'
  );
  ok(all.advisories[0].n === 211060, 'and the newest is Etna');
}

/* --- the age filter ----------------------------------------------------- */
section('an old bulletin is not current ash');

{
  /* The latest-only tgftp slots answer 200 with whatever was last written to
   * them. `fvxx02.lfpw` holds a 2024 TEST bulletin. Even if the UNKNOWN guard
   * were removed, age must stop it. */
  const twoYears = fixture('toulouse-etna-active').replace(
    'DTG: 20260730/0350Z',
    'DTG: 20241114/1013Z'
  );
  const parsed = parseStream(twoYears, OPTS);
  ok(parsed.advisories.length === 1, 'the old bulletin parses fine (age is not the parser`s job)');

  const payload = buildPayload(
    { ash: { ok: true, fetchedAt: 'x', parsed }, weekly: { ok: false }, alerts: { ok: false } },
    VOLCANO,
    NOW
  );
  ok(payload.sources.ash.count === 0, 'and is filtered out of the ash channel');
  ok(payload.sources.ash.droppedStale === 1, 'the drop is COUNTED, not silent');
  ok(
    payload.sources.ash.state === VOLCANO.state.clear,
    'a channel that fetched fine and found nothing current is `clear`'
  );
  ok(payload.volcanoes.length === 0, 'and no volcano is reported from it');

  /* The live one must survive the same filter. */
  const live = buildPayload(
    {
      ash: { ok: true, fetchedAt: 'x', parsed: parseStream(fixture('toulouse-etna-active'), OPTS) },
      weekly: { ok: false },
      alerts: { ok: false },
    },
    VOLCANO,
    NOW
  );
  ok(live.sources.ash.count === 1, 'a 40-minute-old advisory is kept');
  ok(live.sources.ash.droppedStale === 0, 'and nothing is dropped');
  ok(live.volcanoes[0].live.ash.status === 'active', 'and Etna reaches the payload as active');
}

/* --- the weekly feed ---------------------------------------------------- */
section('the Smithsonian weekly RSS');

{
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Ahyi (United States) - Report for 16 July-22 July 2026 - New Eruptive Activity</title>
      <description>A plume was observed.</description>
      <guid>https://volcano.si.edu/reports_weekly.cfm#vn_284141</guid>
      <georss:point>20.4370 145.0300</georss:point></item>
    <item><title>Atka Volcanic Complex (United States) - Report for 16 July-22 July 2026 - Ongoing Activity</title>
      <description><![CDATA[Lava effusion continued.]]></description>
      <guid>https://volcano.si.edu/reports_weekly.cfm#vn_311160</guid></item>
    <item><title>Malformed with no guid number</title><guid>nothing</guid></item>
  </channel></rss>`;

  const w = parseWeekly(xml);
  ok(w.reports.length === 2, 'items without a vn_ number are skipped, not guessed at');
  ok(w.reports[0].n === 284141, 'the vn_ number is the join key');
  ok(w.window === '16 July-22 July 2026', 'the report WINDOW is carried, not "now"');
  ok(w.reports[0].activity === 'New Eruptive Activity', 'the activity type is read');
  ok(w.reports[1].activity === 'Ongoing Activity', 'both activity types are read');
  ok(
    w.reports[1].weeklyName === 'Atka Volcanic Complex',
    'a name containing spaces survives the title split'
  );
  /* ==> ALL FOUR CATEGORIES OBSERVED LIVE, AND `New Unrest` IS NOT AN ERUPTION.
   * <== The live payload carried four types where the plan assumed two. The
   * client filter excluded `New Unrest` correctly and by accident, because that
   * phrase happens not to contain the word "Activity" — a right answer reached
   * by coincidence, which breaks the first time a category is named
   * "Unrest Activity". The judgement is a field now, asserted here. */
  {
    const four = (activity, n) =>
      `<item><title>X (Y) - Report for 16 July-22 July 2026 - ${activity}</title><guid>#vn_${n}</guid></item>`;
    const cats = parseWeekly(
      `<rss><channel>${four('New Eruptive Activity', 100001)}${four('Continuing Eruptive Activity', 100002)}${four('Ongoing Activity', 100003)}${four('New Unrest', 100004)}</channel></rss>`
    );
    ok(cats.reports.length === 4, 'all four live activity categories parse');
    const by = new Map(cats.reports.map((r) => [r.n, r]));
    ok(by.get(100001).erupting === true, 'New Eruptive Activity is an eruption');
    ok(by.get(100002).erupting === true, 'Continuing Eruptive Activity is an eruption');
    ok(by.get(100003).erupting === true, 'Ongoing Activity is an eruption');
    ok(
      by.get(100004).erupting === false,
      '==> New Unrest is NOT an eruption, and not by accident of a regex <=='
    );
  }

  /* The narrative is deliberately absent from the payload — see parseWeekly. */
  ok(
    !('report' in w.reports[0]),
    'the report narrative is not carried (~26 KB of prose nothing renders)'
  );
  ok(parseWeekly('').reports.length === 0, 'an empty body yields no reports');
  ok(parseWeekly(null).reports.length === 0, 'a null body yields no reports');
}

/* --- HANS -------------------------------------------------------------- */
section('USGS HANS, and its 200-with-an-error-body');

{
  const real = [
    {
      volcano_name: 'Great Sitkin',
      vnum: '311120',
      color_code: 'ORANGE',
      alert_level: 'WATCH',
      obs_abbr: 'avo',
      sent_utc: '2026-07-09 19:28:12',
    },
  ];
  const a = parseAlerts(real);
  ok(a.length === 1, 'a real HANS array parses');
  ok(a[0].n === 311120 && typeof a[0].n === 'number', 'the STRING vnum is coerced to a number');
  ok(a[0].colour === 'ORANGE' && a[0].alertLevel === 'WATCH', 'colour and level are read');
  ok(
    a[0].levelSince === '2026-07-09 19:28:12',
    'sent_utc is carried as CONTENT — when the level changed, not how fresh the feed is'
  );

  ok(parseAlerts([]).length === 0, 'an empty array is a valid empty result');

  /* ==> THE DANGEROUS ONE. Measured: appending ?cb= to HANS returns HTTP 200
   * with an error object. Array.isArray is all that stands between that and
   * the app reporting a calm, empty United States. */
  ok(parseAlerts({ error: 'Did not find volcano/getElevatedVolcanoes?cb=x' }) === null,
    'a 200-with-an-error-body is a FAILURE, not an empty result');
  ok(parseAlerts(null) === null, 'a null body is a failure');
  ok(parseAlerts('not json') === null, 'a string body is a failure');
  ok(parseAlerts([{ vnum: 'nonsense' }]).length === 0, 'an unparseable vnum is dropped');
}

/* --- the union --------------------------------------------------------- */
section('the union is a union — three feeds, none of them filtered by another');

{
  const ash = parseStream(fixture('toulouse-etna-active'), OPTS);
  const weekly = parseWeekly(`<rss><channel>
    <item><title>Great Sitkin (United States) - Report for 16 July-22 July 2026 - Ongoing Activity</title>
      <guid>#vn_311120</guid></item>
    <item><title>Kilauea (United States) - Report for 16 July-22 July 2026 - Ongoing Activity</title>
      <guid>#vn_332010</guid></item>
  </channel></rss>`);
  const alerts = parseAlerts([
    { vnum: '311120', color_code: 'ORANGE', alert_level: 'WATCH', sent_utc: '2026-07-09 19:28:12' },
  ]);

  const p = buildPayload(
    {
      ash: { ok: true, fetchedAt: 'a', parsed: ash },
      weekly: { ok: true, fetchedAt: 'b', parsed: weekly },
      alerts: { ok: true, fetchedAt: 'c', parsed: alerts },
    },
    VOLCANO,
    NOW
  );

  /* ==> THE MEASURED POINT OF THE WHOLE UNION. <== Etna is in the ash feed and
   * nowhere else. Great Sitkin and Kilauea are erupting LAVA and appear in no
   * ash advisory anywhere on Earth. Intersect, or prefer VAAC because it is
   * fresher, and two live eruptions vanish. */
  ok(p.volcanoes.length === 3, 'three volcanoes from three feeds, none suppressing another');
  const byN = new Map(p.volcanoes.map((v) => [v.n, v]));
  ok(!!byN.get(211060)?.live.ash, 'Etna arrives via ash only');
  ok(!byN.get(211060)?.live.report, 'and is in no weekly report');
  ok(!!byN.get(332010)?.live.report, 'Kilauea arrives via the weekly feed only');
  ok(!byN.get(332010)?.live.ash, 'and is in no ash advisory — it is erupting lava');
  ok(
    !!byN.get(311120)?.live.report && !!byN.get(311120)?.live.alert,
    'Great Sitkin arrives on two channels and they merge onto one volcano'
  );
  ok(!byN.get(311120)?.live.ash, 'and it too is in no ash advisory');

  ok(p.sources.ash.state === VOLCANO.state.ok, 'ash reports ok');
  ok(p.sources.weekly.state === VOLCANO.state.ok, 'weekly reports ok');
  ok(p.sources.alerts.state === VOLCANO.state.ok, 'alerts report ok');
  ok(p.sources.weekly.window === '16 July-22 July 2026', 'the weekly window reaches the payload');
  ok(
    p.sources.alerts.coverage === 'us_observatories_only',
    'the US-only limit is stated in the payload, so no surface can forget it'
  );
  ok(p.sources.ash.centres.includes('TOULOUSE'), 'the contributing centres are named');
  ok(p.volcanoes[0].n === 211060, 'the volcano with the newest ash sorts first');
}

/* --- KILLING FEEDS ----------------------------------------------------- */
section('==> A DEAD FEED NEVER READS AS AN EMPTY SKY <==');

{
  const good = {
    ash: { ok: true, fetchedAt: 'a', parsed: parseStream(fixture('toulouse-etna-active'), OPTS) },
    weekly: {
      ok: true,
      fetchedAt: 'b',
      parsed: parseWeekly(
        '<rss><channel><item><title>Kilauea (United States) - Report for 16 July-22 July 2026 - Ongoing Activity</title><guid>#vn_332010</guid></item></channel></rss>'
      ),
    },
    alerts: { ok: true, fetchedAt: 'c', parsed: parseAlerts([{ vnum: '311120', alert_level: 'WATCH' }]) },
  };

  /* Kill each channel in turn. Every other channel must be untouched — §5's
   * "one source down must not blind the other" — and the dead one must say so
   * rather than come back empty. */
  for (const dead of ['ash', 'weekly', 'alerts']) {
    const channels = { ...good, [dead]: { ok: false, error: 'HTTP 503' } };
    const p = buildPayload(channels, VOLCANO, NOW);

    ok(
      p.sources[dead].state === VOLCANO.state.unavailable,
      `a dead ${dead} channel reports unavailable`
    );
    ok(
      p.sources[dead].state !== VOLCANO.state.clear,
      `==> a dead ${dead} channel is NEVER \`clear\` <==`
    );
    ok(p.sources[dead].count === 0, `a dead ${dead} channel reports no results`);
    ok(p.sources[dead].error === 'HTTP 503', `a dead ${dead} channel names its error`);

    for (const alive of ['ash', 'weekly', 'alerts'].filter((k) => k !== dead)) {
      ok(
        p.sources[alive].state === VOLCANO.state.ok,
        `${alive} still reports ok while ${dead} is down`
      );
      ok(p.sources[alive].count > 0, `${alive} still returns its results while ${dead} is down`);
    }
    ok(p.volcanoes.length === 2, `two channels' volcanoes still reach the client with ${dead} down`);
  }

  /* Every channel down. The one case a naive implementation renders as calm. */
  const allDown = buildPayload(
    {
      ash: { ok: false, error: 'timeout' },
      weekly: { ok: false, error: 'HTTP 403' },
      alerts: { ok: false, error: 'network error' },
    },
    VOLCANO,
    NOW
  );
  ok(allDown.volcanoes.length === 0, 'with everything down the volcano list is empty');
  ok(
    Object.values(allDown.sources).every((s) => s.state === VOLCANO.state.unavailable),
    '==> AND ALL THREE CHANNELS SAY `unavailable`, SO THE EMPTY LIST CANNOT BE READ AS CALM <=='
  );
  ok(
    !Object.values(allDown.sources).some((s) => s.state === VOLCANO.state.clear),
    'nothing anywhere in the payload says `clear`'
  );
  ok(allDown.sources.weekly.error === 'HTTP 403', 'each channel names its own failure');
  ok(
    allDown.sources.ash.error === 'timeout' && allDown.sources.alerts.error === 'network error',
    'three different failures are reported as three different failures'
  );

  /* A channel not even attempted must not look healthy either. */
  const missing = buildPayload({}, VOLCANO, NOW);
  ok(
    Object.values(missing.sources).every((s) => s.state === VOLCANO.state.unavailable),
    'a channel that was never attempted is unavailable, not clear'
  );

  /* ==> AND THE OPPOSITE MISTAKE, WHICH IS JUST AS REAL. <== "No ash anywhere
   * on Earth today" is a common and CORRECT state. It must not be worded like
   * an outage — an app that cries wolf on a quiet planet is an app nobody
   * believes on the day it matters. */
  const quietSky = buildPayload(
    {
      ash: { ok: true, fetchedAt: 'a', parsed: { advisories: [], rejected: {}, seen: 0 } },
      weekly: good.weekly,
      alerts: good.alerts,
    },
    VOLCANO,
    NOW
  );
  ok(
    quietSky.sources.ash.state === VOLCANO.state.clear,
    '==> a successful fetch finding no ash anywhere is `clear`, not `unavailable` <=='
  );
  ok(quietSky.sources.ash.error === null, 'and it reports no error, because nothing failed');
  ok(quietSky.volcanoes.length === 2, 'while the other two channels still report their eruptions');

  /* Serve-stale, which is a third thing again: the fetch failed and we are
   * showing an older copy. §5 wants that visible with an age, not hidden. */
  const stale = buildPayload(
    { ...good, ash: { ...good.ash, stale: true } },
    VOLCANO,
    NOW
  );
  ok(stale.sources.ash.state === VOLCANO.state.stale, 'a served-stale channel says `stale`');
  ok(stale.sources.ash.count === 1, 'and still carries its data');
  ok(
    stale.sources.ash.state !== VOLCANO.state.ok,
    'stale is not ok — the reader is told the copy is old'
  );
}

/* --- the slot table ------------------------------------------------------ */
section('all nine centres, and the split that fits a 50-fetch budget');

{
  /* ==> THE ARITHMETIC IS THE WHOLE REASON THIS FILE EXISTS, SO IT IS
   * ASSERTED. <== Cloudflare's free plan allows 50 EXTERNAL subrequests per
   * invocation and 50 is the free maximum. Reading every VAAC centre costs 62
   * fetches, so /api/volcano/live splits the read across two sibling routes,
   * each with its own budget. If a future edit pushes a group past the cap, the
   * failure in production is a silently truncated read of the sky — the exact
   * class of bug this layer exists to prevent — so it fails here instead. */
  const FREE_TIER_SUBREQUEST_CAP = 50;
  /* live.js spends two fetches on the groups plus weekly plus HANS. */
  const LIVE_OWN_FETCHES = 4;

  ok(SLOTS.length === 62, 'the table carries all 62 bulletin slots');
  ok(ALL_CENTRES.length === 9, 'all nine VAAC centres are represented');
  ok(LIVE_OWN_FETCHES < FREE_TIER_SUBREQUEST_CAP, 'live.js fits its own budget');

  const files = SLOTS.map((s) => s.file);
  ok(new Set(files).size === files.length, 'no slot is listed twice');

  for (const g of GROUPS) {
    const n = slotsInGroup(g).length;
    ok(n > 0, `group ${g} has slots`);
    ok(
      n < FREE_TIER_SUBREQUEST_CAP,
      `==> group ${g} costs ${n} fetches, under the ${FREE_TIER_SUBREQUEST_CAP} free-tier cap <==`
    );
  }

  ok(
    GROUPS.reduce((t, g) => t + slotsInGroup(g).length, 0) === SLOTS.length,
    'every slot belongs to exactly one group'
  );

  /* ==> NO CENTRE MAY SPAN BOTH GROUPS. <== The coverage report names
   * unreachable CENTRES, and it derives them from the group that failed. A
   * centre split across groups would be reported as unreachable while half its
   * slots were answering — a false alarm, which costs trust the same way a
   * missed eruption costs safety. */
  const a = centresInGroup('a');
  const b = centresInGroup('b');
  ok(a.filter((c) => b.includes(c)).length === 0, 'no centre spans both groups');
  ok(new Set([...a, ...b]).size === 9, 'the two groups together cover all nine centres');

  /* ==> CENTRE ATTRIBUTION COMES FROM THE WMO ORIGINATOR, NEVER THE SLOT
   * NUMBER. <== These four are the traps: Wellington issues on Australian slot
   * numbers, and Anchorage and Buenos Aires both appear on `fvxx` slots that
   * otherwise belong to London, Toulouse and Washington. A rule keyed on the
   * filename prefix files them under the wrong centre and then reports the
   * wrong centre as dark. */
  const centreOf = (file) => SLOTS.find((s) => s.file === file)?.centre;
  ok(centreOf('fvau04.nzkl..txt') === 'WELLINGTON', 'fvau04.nzkl is Wellington, not Darwin');
  ok(centreOf('fvau05.nzkl..txt') === 'WELLINGTON', 'fvau05.nzkl is Wellington, not Darwin');
  ok(centreOf('fvxx21.pawu..txt') === 'ANCHORAGE', 'fvxx21.pawu is Anchorage, not Washington');
  ok(centreOf('fvxx01.sabm..txt') === 'BUENOS AIRES', 'fvxx01.sabm is Buenos Aires, not London');
  ok(centreOf('fvxx05.lfpw..txt') === 'TOULOUSE', "fvxx05.lfpw is Toulouse — Etna's centre");

  /* Every slot is reachable as a URL on the one fixed host, and nothing in the
   * table can point somewhere else. */
  for (const s of SLOTS) {
    ok(slotUrl(s.file).startsWith(TGFTP_BASE), `${s.file} resolves on the tgftp host`);
  }
  ok(!SLOTS.some((s) => /bom\.gov\.au/.test(slotUrl(s.file))), '==> BoM is gone from the table <==');
}

/* --- coverage honesty ---------------------------------------------------- */
section('==> A PARTIAL SKY NEVER READS AS A QUIET ONE <==');

{
  /* ==> THIS IS THE REGRESSION TEST FOR THE BUG THAT HID AN ERUPTION. <== On
   * 2026-07-30 the ash channel reported `state: ok` while reading three
   * Wellington bulletin slots — Vanuatu, Tonga and the Kermadecs, three percent
   * of the planet — because BoM had begun refusing the relay with HTTP 403.
   * Etna erupted at AVIATION COLOUR CODE RED with ash to FL230 and appeared
   * nowhere in the channel. The fetch was healthy and the world was not, and
   * `ok` could not tell those apart. */
  const parsed = parseStream(fixture('wellington-ambae-close'), OPTS);
  const base = { ok: true, fetchedAt: 'a', parsed };

  const global = buildPayload(
    { ash: { ...base, coverage: { level: 'global', centresUnreachable: [] } } },
    VOLCANO,
    NOW
  );
  ok(global.sources.ash.coverage.level === 'global', 'whole coverage is reported as global');
  ok(
    global.sources.ash.state !== VOLCANO.state.degraded,
    'whole coverage is not degraded'
  );

  /* The exact shape of the live bug: Wellington answering, eight centres dark. */
  const eightDark = [
    'ANCHORAGE',
    'BUENOS AIRES',
    'DARWIN',
    'LONDON',
    'MONTREAL',
    'TOKYO',
    'TOULOUSE',
    'WASHINGTON',
  ];
  const partial = buildPayload(
    { ash: { ...base, coverage: { level: 'partial', centresUnreachable: eightDark } } },
    VOLCANO,
    NOW
  );
  ok(
    partial.sources.ash.state === VOLCANO.state.degraded,
    '==> eight of nine centres dark reports DEGRADED, not ok <=='
  );
  ok(
    partial.sources.ash.state !== VOLCANO.state.ok,
    '==> the 2026-07-30 bug cannot come back: partial coverage is never ok <=='
  );
  ok(
    partial.sources.ash.state !== VOLCANO.state.clear,
    'partial coverage is never `clear` either — a smaller sky is not a quiet one'
  );
  ok(
    partial.sources.ash.coverage.centresUnreachable.includes('TOULOUSE'),
    "==> and it NAMES Toulouse, the centre that had Etna's advisory <=="
  );
  ok(
    partial.sources.ash.coverage.centresUnreachable.length === 8,
    'all eight dark centres are named, not counted'
  );

  /* An EMPTY read under partial coverage is the nastiest case: it looks exactly
   * like a calm planet and it is not one. */
  const emptyPartial = buildPayload(
    {
      ash: {
        ok: true,
        fetchedAt: 'a',
        parsed: { advisories: [], rejected: null, seen: 0 },
        coverage: { level: 'partial', centresUnreachable: eightDark },
      },
    },
    VOLCANO,
    NOW
  );
  ok(
    emptyPartial.sources.ash.state === VOLCANO.state.degraded,
    '==> AN EMPTY READ OF A PARTIAL WORLD IS DEGRADED, NEVER CLEAR <=='
  );
  ok(emptyPartial.sources.ash.count === 0, 'and it still honestly reports no advisories');

  /* No transport at all outranks everything, even a successful-looking fetch. */
  const none = buildPayload(
    { ash: { ...base, coverage: { level: 'none', centresUnreachable: ALL_CENTRES.slice() } } },
    VOLCANO,
    NOW
  );
  ok(
    none.sources.ash.state === VOLCANO.state.unavailable,
    'no reachable centre reports unavailable, not degraded'
  );

  /* Backward compatibility: a channel with no coverage field behaves exactly as
   * before, so the weekly and alerts channels are untouched by all of this. */
  const noCoverage = buildPayload({ ash: base }, VOLCANO, NOW);
  ok(
    noCoverage.sources.ash.state === VOLCANO.state.ok,
    'a channel that states no coverage is unchanged'
  );
  ok(noCoverage.sources.ash.coverage === null, 'and its coverage field is explicitly null');
}

/* --- report ------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
