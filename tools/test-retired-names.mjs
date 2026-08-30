#!/usr/bin/env node
/**
 * test-retired-names.mjs — every retired name points at a real storm.
 *
 * ==> THE LIST IS DERIVED NOW, AND THIS SUITE IS THE CHECK THE DERIVATION
 * CANNOT DO ON ITSELF. <== §57.51. `tools/seasons-retired.mjs` computes the
 * answer from the record and the lists in service, and its own gates are about
 * that arithmetic. This is the outside opinion: does the answer agree with
 * figures published by people who were in the room.
 *
 * ==> THE DECADE CHECKSUM SURVIVED THE MOVE FROM TRANSCRIPTION TO DERIVATION
 * AND IS MORE VALUABLE THAN IT WAS. <== It used to catch a typing slip. It now
 * catches the derivation drifting — a floor moved, an exclusion mis-set, an
 * active list half-parsed — against numbers this repo did not compute. A check
 * that only re-ran our own arithmetic would go green on our own mistake.
 *
 * ==> THE ATLANTIC SUMS COUNT THE GREEK PAIR. <== Eta and Iota are exported
 * separately because the copy about them has to read differently (they were
 * retired by description, not by name), but the WMO counts them among the
 * Atlantic retirements and so must this. Leaving them out drops the 2020s from
 * 10 to 8 and the total from 100 to 98.
 *
 * ==> WRITING THIS CAUGHT TWO REAL ERRORS ON ITS FIRST RUN, BACK WHEN THE LIST
 * WAS TYPED. <== KNUT was entered as 1988 from NOAA's own table; HURDAT2 has
 * KNUT in 1981 and 1987 and nothing in 1988, so NOAA's page is wrong and the
 * archive settled it. ISRAEL 2001 matched nothing at all and moved to
 * RETIRED_NEVER_USED. Neither would have been visible on glass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseHurdat2 } from '../lib/hurdat.js';
import {
  RETIRED_ATLANTIC, RETIRED_EPACIFIC, RETIRED_CPACIFIC,
  RETIRED_BY_DESCRIPTION, RETIRED_UNSURE, RETIRED_NEVER_USED,
} from '../data/retired-names.js';
import { ROOT } from './module-graph.mjs';

/** The decade counts the WMO and Wikipedia both publish in prose. A
 *  transcription slip breaks exactly one of these sums, which is why they are
 *  asserted separately rather than only checking the total. */
const DECADES = { '1954-59': 8, '1960s': 11, '1970s': 9, '1980s': 7,
                  '1990s': 15, '2000s': 24, '2010s': 16, '2020s': 10 };

let failed = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };

function keysFor(file) {
  const dir = path.join(ROOT, 'seasons', 'data');
  const match = fs.readdirSync(dir).find((f) => f.startsWith(file));
  if (!match) { bad(`no whole-basin file starting "${file}"`); return new Set(); }
  const { storms } = parseHurdat2(fs.readFileSync(path.join(dir, match), 'utf8'));
  return new Set(storms.map((s) => `${(s.name || '').toUpperCase()}|${s.year}`));
}

/** Every Atlantic retirement the WMO would count, including the Greek pair. */
const ATLANTIC_ALL = [...RETIRED_ATLANTIC,
  ...RETIRED_BY_DESCRIPTION.filter(([, , b]) => b === 'atlantic').map(([n, y]) => [n, y])];

const atl = keysFor('hurdat2-atlantic-');
const pac = keysFor('hurdat2-epacific-');

/* 1. Every entry joins to a storm that actually exists. */
for (const [label, list, have] of [['Atlantic', ATLANTIC_ALL, atl],
                                   ['E Pacific', RETIRED_EPACIFIC, pac],
                                   ['C Pacific', RETIRED_CPACIFIC, pac]]) {
  for (const [name, year] of list) {
    if (!have.has(`${name}|${year}`)) bad(`${label}: ${name} ${year} matches no storm in the record`);
  }
}

/* 2. The decade checksum. */
const dec = {};
for (const [, y] of ATLANTIC_ALL) {
  const k = y < 1960 ? '1954-59' : `${Math.floor(y / 10) * 10}s`;
  dec[k] = (dec[k] || 0) + 1;
}
for (const [k, want] of Object.entries(DECADES)) {
  if (dec[k] !== want) bad(`Atlantic ${k}: ${dec[k] || 0} entries, WMO publishes ${want}`);
}
if (ATLANTIC_ALL.length !== 100) bad(`Atlantic total is ${ATLANTIC_ALL.length}, published figure is 100`);

/* 3. No duplicates — a name+year twice would double-count a decade and could
 *    mask a missing entry, leaving the checksum green while the list is wrong. */
for (const [label, list] of [['Atlantic', ATLANTIC_ALL], ['E Pacific', RETIRED_EPACIFIC],
                             ['C Pacific', RETIRED_CPACIFIC]]) {
  const seen = new Set();
  for (const [n, y] of list) {
    if (seen.has(`${n}|${y}`)) bad(`${label}: ${n} ${y} listed twice`);
    seen.add(`${n}|${y}`);
  }
}

/* 4. A never-used name must NOT also appear in a basin list. Both states at
 *    once means somebody "fixed" an omission that was deliberate. */
const all = [...ATLANTIC_ALL, ...RETIRED_EPACIFIC, ...RETIRED_CPACIFIC];
for (const n of RETIRED_NEVER_USED) {
  if (all.some(([x]) => x === n)) bad(`${n} is in RETIRED_NEVER_USED and also in a basin list`);
}

/* 5. Every `unsure` key names an entry that is actually present. A stale note
 *    about a row that no longer exists is worse than no note — it makes the
 *    list look less trustworthy than it is. */
const allKeys = new Set(all.map(([n, y]) => `${n}|${y}`));
for (const k of Object.keys(RETIRED_UNSURE)) {
  if (!allKeys.has(k)) bad(`RETIRED_UNSURE names "${k}", which is not in any list`);
}

if (failed) { console.error(`\n✗ ${failed} problem(s) with the retired-names shelf`); process.exit(1); }
console.log(`✓ ${all.length} retired names, all joining a real storm — `
  + `100 Atlantic across 8 matching decade sums, ${RETIRED_EPACIFIC.length} E Pacific, `
  + `${RETIRED_CPACIFIC.length} C Pacific, ${Object.keys(RETIRED_UNSURE).length} flagged unsure`);
