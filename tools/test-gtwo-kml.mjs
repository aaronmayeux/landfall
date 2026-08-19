#!/usr/bin/env node
/**
 * test-gtwo-kml.mjs — NHC's Graphical Tropical Weather Outlook, parsed from
 * the KML inside the KMZ.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-gtwo-kml.mjs`.
 *
 * ==> EVERY DOCUMENT HERE IS BYTES NHC ACTUALLY PUBLISHED. <== Provenance is
 * in `samples/genesis/gtwo/README.md`. The same rule as `test-outlook.mjs`,
 * and it matters more here: this parser is a candidate to REPLACE a source
 * that currently works. A parser proven against bytes somebody imagined has no
 * standing to do that.
 *
 * ==> THIS FILE COVERS THE PARSER. THE PROOF THAT IT AGREES WITH THE SOURCE IT
 * WOULD REPLACE IS `tools/gtwo-compare.mjs`, <== which runs the whole thing
 * against all 72 hourly snapshots on the archive branch and checks every
 * vertex. Neither is sufficient alone: this one says the fields are read
 * correctly, that one says the answer matches NOAA's other path.
 *
 * Every assertion below was mutation-checked — the rule it guards was broken
 * on purpose and this file was confirmed to go red.
 */

import fs from 'node:fs';
import path from 'node:path';
import { kmlFromKmz, kmzEntryNames } from '../lib/kmz.js';
import {
  parseGtwoKml, toAreaCollection, parseIssuedAt, parseBasin, titleFromDiscussion,
} from '../lib/gtwo-kml.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const sample = (n) => fs.readFileSync(path.join(ROOT, 'samples/genesis/gtwo', n), 'utf8');

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* ---------------------------------------------------------------------------
 * 1. THE CONTAINER
 * ------------------------------------------------------------------------- */

section('kmz.js — a KMZ is a zip, and this gets the KML out of it');

const kmzBytes = Buffer.from(sample('atlantic.kmz.b64').trim(), 'base64');

{
  const names = kmzEntryNames(kmzBytes);
  ok(names[0] === 'gtwo_atl.kml', `the KML is the first entry — got ${names[0]}`);
  ok(names.length === 5, `five entries, the KML and four icons — got ${names.length}`);

  const kml = await kmlFromKmz(kmzBytes);
  ok(kml.startsWith('<?xml'), 'and it decompresses to XML');
  ok(
    kml.includes('Graphical Tropical Weather Outlook'),
    'which is the outlook and not one of the icons'
  );

  /* THE ICONS ARE 45% OF THE DOWNLOAD AND WE NEVER WANT THEM. Asserting the
   * reader ignores them is asserting the relay does not have to. */
  ok(!kml.includes('PNG'), 'the four PNG icons are not in the returned text');
}

section('kmz.js — it refuses rather than guessing (§5)');

{
  let reason = null;
  try { await kmlFromKmz(new Uint8Array(0)); } catch (e) { reason = e.message; }
  ok(/no bytes/i.test(reason ?? ''), `empty input is refused by name — got ${reason}`);

  reason = null;
  try { await kmlFromKmz(new TextEncoder().encode('this is not a zip at all')); } catch (e) { reason = e.message; }
  ok(/no \.kml entry/i.test(reason ?? ''), `a non-zip is refused by name — got ${reason}`);

  /* BIT 3 IS THE ONE THAT WOULD SILENTLY BREAK THE WALK, so it is the one
   * worth a test. Flip it in a real archive's first header and the reader must
   * stop rather than read an entry of length zero and land inside a PNG. */
  const flagged = Uint8Array.from(kmzBytes);
  flagged[6] |= 0x08;
  reason = null;
  try { await kmlFromKmz(flagged); } catch (e) { reason = e.message; }
  ok(
    /sizes after the data/i.test(reason ?? ''),
    `a zip with trailing sizes is refused rather than misread — got ${reason}`
  );

  /* An entry we cannot decompress must not come back as mojibake. */
  const method = Uint8Array.from(kmzBytes);
  method[8] = 99;
  reason = null;
  try { await kmlFromKmz(method); } catch (e) { reason = e.message; }
  ok(
    /compression method 99/.test(reason ?? ''),
    `an unknown compression method is named in the error — got ${reason}`
  );
}

/* ---------------------------------------------------------------------------
 * 2. THE ORDINARY CASE — TWO AREAS BEING WATCHED
 * ------------------------------------------------------------------------- */

section('epacific, 19 Aug 05:25Z — two watched areas');

const pac = parseGtwoKml(sample('epacific-two-areas.kml'));

{
  ok(pac.state === 'ok', 'it parses');
  ok(pac.basin === 'epacific', `basin from the document title — got ${pac.basin}`);
  ok(pac.areas.length === 2, `two areas — got ${pac.areas.length}`);
  ok(pac.formationNotExpected === false, 'and it does not claim an all-clear');

  /* ==> THE TIME IS UTC AND MUST BE PARSED AS SUCH. <== The string carries no
   * zone. Handing it to `Date.parse` on a phone in Honolulu dates the outlook
   * ten hours late and makes every fresh one look stale. Layer 3 stamped this
   * same run `gtwo_areas_202608190525`. */
  ok(
    pac.issuedAt === Date.UTC(2026, 7, 19, 5, 25, 8),
    `issued 2026-08-19T05:25:08Z — got ${new Date(pac.issuedAt).toISOString()}`
  );
}

section('the two facts layer 3 does not publish at all');

{
  /* 1. NHC'S OWN NAME. `lib/genesis.js` invents a description from the
   *    centroid because layer 3 has no name in it. This one is NHC's. */
  ok(
    pac.areas[0].title === 'South-Southwest of Mexico',
    `NHC's own name for the first area — got ${JSON.stringify(pac.areas[0].title)}`
  );
  ok(
    pac.areas[1].title === 'Central Pacific',
    `and for the second — got ${JSON.stringify(pac.areas[1].title)}`
  );

  /* The leading disturbance number is stripped. Printed, "1." in front of a
   * name reads as a rank, and the number is already carried as a field. */
  ok(!/^\d/.test(pac.areas[0].title), 'the leading number is not part of the name');

  /* 2. THE FORECASTER'S PARAGRAPH, whole. It ends with the two formation
   *    chance lines, so a truncated read is visible from the tail. */
  ok(
    /Formation chance through 7 days\.\.\.high\.\.\.80 percent/.test(pac.areas[0].discussion),
    'the discussion runs to the end of the paragraph'
  );
  ok(
    pac.areas[0].discussion.includes('remaining well offshore')
    && pac.areas[0].discussion.includes('Mexico'),
    'and carries the body, not just the headline'
  );
}

section('the disturbance number — the join layer 2 could not offer');

{
  ok(pac.areas[0].disturbance === 1 && pac.areas[1].disturbance === 2, 'areas are numbered');
  ok(pac.anchors.length === 1, `one area has a current position — got ${pac.anchors.length}`);

  /* ==> THIS IS THE WHOLE REASON THE KMZ IS INTERESTING. <==
   * `GENESIS.anchorLayer` records layer 2 as not fetched because a point
   * cannot be matched to a polygon: anchor 1 carried polygon 2's attributes
   * while sitting inside polygon 1. Here NHC publishes the answer. The point
   * in this document belongs to disturbance 2, NOT to the first area. */
  ok(
    pac.anchors[0].disturbance === 2,
    `the point belongs to disturbance 2 — got ${pac.anchors[0].disturbance}`
  );
  ok(
    Math.abs(pac.anchors[0].lon - -135.20886508327948) < 1e-9
    && Math.abs(pac.anchors[0].lat - 10.107595520544631) < 1e-9,
    'and it sits where NHC put it'
  );
}

section('probabilities arrive as NHC spells them, untouched');

{
  /* Strings with a percent sign, the same shape layer 3 publishes, so
   * `parsePercent` in lib/genesis.js keeps working unchanged. A "0%" that
   * became null here would turn "not in this window" into "not stated". */
  ok(pac.areas[0].prob2day === '0%', `a genuine zero survives — got ${pac.areas[0].prob2day}`);
  ok(pac.areas[0].risk2day === 'Low', 'with its word');
  ok(pac.areas[1].prob2day === '50%' && pac.areas[1].risk7day === 'High', 'and the second area reads');
}

/* ---------------------------------------------------------------------------
 * 3. THE ALL-CLEAR — SAID IN WORDS, WHICH IS THE POINT
 * ------------------------------------------------------------------------- */

section('atlantic, 19 Aug 05:25Z — nothing being watched');

const atl = parseGtwoKml(sample('atlantic-all-clear.kml'));

{
  ok(atl.state === 'ok', 'a quiet basin still parses');
  ok(atl.basin === 'atlantic', `basin — got ${atl.basin}`);
  ok(atl.areas.length === 0, `no areas — got ${atl.areas.length}`);

  /* ==> AN EMPTY FEATURECOLLECTION IS UNSTAMPED. <== "NHC is watching
   * nothing" and "NHC's layer is broken" are the same bytes, which is the
   * 2026-08-11 incident in one sentence. This document says it in a sentence
   * instead, so the two stop looking alike. */
  ok(
    atl.formationNotExpected === true,
    'and the document STATES the all-clear rather than merely omitting areas'
  );
  ok(atl.issuedAt === Date.UTC(2026, 7, 19, 5, 25, 8), 'and it is dated');

  /* The all-clear is drawn as two label placemarks holding a sentence and no
   * data. They carry coordinates and must not become disturbance points. */
  ok(atl.anchors.length === 0, `the label placemarks are not points — got ${atl.anchors.length}`);
}

/* ---------------------------------------------------------------------------
 * 4. THE UNLABELLED LINESTRING
 * ------------------------------------------------------------------------- */

section('the LineString is carried through and named nothing');

const track = parseGtwoKml(sample('epacific-with-track.kml'));

{
  ok(track.state === 'ok', 'the 18 Aug 17:26Z document parses');
  ok(track.tracks.length === 1, `one LineString — got ${track.tracks.length}`);
  /* Read defensively. A mutation that files the LineString as an area should
   * turn this section red, not crash the run and hide everything below it. */
  const line = track.tracks[0] ?? {};
  ok(line.line?.length === 300, `with its 300 vertices — got ${line.line?.length}`);

  /* ==> IT IS NOT A TRACK UNTIL SOMETHING SAYS IT IS. <== No name, no
   * ExtendedData, no disturbance number. In the four hours examined it was
   * present exactly when a disturbance's current position sat outside its own
   * watched area. FOUR SAMPLES, ONE DISTURBANCE, ONE BASIN — a hypothesis, and
   * this assertion exists so nobody quietly promotes it to a fact. */
  ok(
    !('disturbance' in line) && !('title' in line),
    'and no claim about what it means'
  );

  /* It must not have been mistaken for an area or a point. */
  ok(track.areas.length === 2, `still two areas — got ${track.areas.length}`);
  ok(track.anchors.length === 1, `still one point — got ${track.anchors.length}`);
}

/* ---------------------------------------------------------------------------
 * 5. UNREADABLE INPUT IS A STATE, NOT AN EXCEPTION
 * ------------------------------------------------------------------------- */

section('it never throws — the caller needs to tell empty from broken');

{
  ok(parseGtwoKml('').state === 'unreadable', 'empty text');
  ok(parseGtwoKml(null).state === 'unreadable', 'null');
  ok(parseGtwoKml('<html><body>404</body></html>').state === 'unreadable', 'an error page');
  ok(
    typeof parseGtwoKml('<html>404</html>').reason === 'string',
    'and each one says why in a sentence'
  );

  /* A truncated document is the dangerous case: it still looks like KML. It
   * must come back with FEWER areas, never with a half-built one. */
  const cut = sample('epacific-two-areas.kml').slice(0, 4000);
  const partial = parseGtwoKml(cut);
  ok(partial.state === 'ok', 'a truncated document still parses as far as it got');
  ok(partial.areas.length < 2, `and reports fewer areas, not a broken one — got ${partial.areas.length}`);
  for (const a of partial.areas) ok(a.ring.length >= 3, 'every area it does report has a real ring');
}

/* ---------------------------------------------------------------------------
 * 6. THE SMALL PIECES, ON THEIR OWN
 * ------------------------------------------------------------------------- */

section('the header readers');

{
  ok(parseIssuedAt('... - Wed Aug 19 05:25:08 2026') === Date.UTC(2026, 7, 19, 5, 25, 8), 'a date reads');
  ok(parseIssuedAt('no date here') === null, 'and a missing one is null, never now()');
  ok(parseIssuedAt('- Wed Xxx 19 05:25:08 2026') === null, 'an unknown month is null, not month zero');

  ok(parseBasin('... - North Atlantic basin - ...') === 'atlantic', 'Atlantic');
  ok(parseBasin('... - eastern North Pacific basin - ...') === 'epacific', 'east Pacific');
  ok(parseBasin('... - Indian Ocean basin - ...') === null, 'an unknown ocean is null, never guessed');
}

section('the title reader');

{
  ok(titleFromDiscussion('1. South of Mexico: An area...') === 'South of Mexico', 'the template');
  ok(titleFromDiscussion('12. Central Atlantic: Something') === 'Central Atlantic', 'two digits');
  ok(titleFromDiscussion('An area of low pressure...') === null, 'no number, no name — null, not a guess');
  ok(titleFromDiscussion(null) === null, 'and null in, null out');
}

/* ---------------------------------------------------------------------------
 * 7. THE SHAPE THE REST OF THE APP ALREADY READS
 * ------------------------------------------------------------------------- */

section('toAreaCollection — what normalizeNhcAreas would receive');

{
  const fc = toAreaCollection(pac);
  ok(fc.type === 'FeatureCollection' && fc.features.length === 2, 'two features');
  ok(fc.features[0].geometry.type === 'Polygon', 'as polygons');
  ok(fc.features[0].geometry.coordinates[0].length === 300, 'with every vertex');

  /* ==> IDS ARE NAMESPACED BY BASIN. <== Layer 3 answered both basins from one
   * query so its row numbers happened to be unique. The KMZ is published per
   * basin and both documents number from 1, so a bare number would let an
   * Atlantic area and a Pacific area share an id and replace each other in any
   * map keyed on it. */
  const atlFc = toAreaCollection(parseGtwoKml(sample('epacific-two-areas.kml').replace(
    'eastern North Pacific basin', 'North Atlantic basin'
  )));
  const pacIds = fc.features.map((f) => f.properties.objectid);
  const atlIds = atlFc.features.map((f) => f.properties.objectid);
  ok(pacIds.join(',') === 'epac-1,epac-2', `Pacific ids — got ${pacIds.join(',')}`);
  ok(
    atlIds.every((id) => !pacIds.includes(id)),
    `an Atlantic disturbance 1 cannot collide with a Pacific one — got ${atlIds.join(',')}`
  );

  /* The stamp is honest about being ours. Spelling it `gtwo_areas_...` the way
   * layer 3 does would make a synthesised value indistinguishable from a
   * published one. */
  ok(
    fc.features[0].properties.idp_source === 'gtwo_kml_202608190525',
    `the stamp names its own source — got ${fc.features[0].properties.idp_source}`
  );
  ok(
    fc.features[0].properties.idp_filedate === Date.UTC(2026, 7, 19, 5, 25, 8),
    'and the date is the forecaster’s issue time'
  );

  /* The probability fields keep layer 3's names so nothing downstream changes. */
  ok(fc.features[0].properties.prob7day === '80%', 'probabilities keep their field names');
  ok(fc.features[0].properties.nhcTitle === 'South-Southwest of Mexico', 'and the new name rides along');

  /* An unreadable document yields an empty collection, never a throw and never
   * a partial one — the caller decides what empty means. */
  ok(toAreaCollection(parseGtwoKml('nonsense')).features.length === 0, 'unreadable in, empty out');
  ok(toAreaCollection(null).features.length === 0, 'and null in, empty out');
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed\n`);
