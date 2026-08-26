#!/usr/bin/env node
/**
 * test-retired-names.mjs — every retired name points at a real storm.
 *
 * ==> THE SHELF LIST IS HAND-MAINTAINED AND HAND-MAINTAINED LISTS ROT. <==
 * §57.17 chose a typed file over a scraper on purpose: NOAA publishes this as
 * a web page and one restyle would silently empty the shelf. The cost of that
 * choice is a typo nobody notices, because a name that matches no storm just
 * quietly never shows a badge. That failure is INVISIBLE — the shelf still
 * renders, it is simply missing an entry — which is exactly the shape §5 says
 * to refuse.
 *
 * ==> WRITING THIS CAUGHT TWO REAL ERRORS ON ITS FIRST RUN. <== KNUT was
 * entered as 1988 from NOAA's own table; HURDAT2 has KNUT in 1981 and 1987 and
 * nothing in 1988, so NOAA's page is wrong and the archive settled it. ISRAEL
 * 2001 matched nothing at all and moved to RETIRED_NEVER_USED. Neither would
 * have been visible on glass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseHurdat2 } from '../lib/hurdat.js';
import {
  RETIRED_ATLANTIC, RETIRED_EPACIFIC, RETIRED_CPACIFIC,
  RETIRED_UNSURE, RETIRED_NEVER_USED,
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

const atl = keysFor('hurdat2-atlantic-');
const pac = keysFor('hurdat2-epacific-');

/* 1. Every entry joins to a storm that actually exists. */
for (const [label, list, have] of [['Atlantic', RETIRED_ATLANTIC, atl],
                                   ['E Pacific', RETIRED_EPACIFIC, pac],
                                   ['C Pacific', RETIRED_CPACIFIC, pac]]) {
  for (const [name, year] of list) {
    if (!have.has(`${name}|${year}`)) bad(`${label}: ${name} ${year} matches no storm in the record`);
  }
}

/* 2. The decade checksum. */
const dec = {};
for (const [, y] of RETIRED_ATLANTIC) {
  const k = y < 1960 ? '1954-59' : `${Math.floor(y / 10) * 10}s`;
  dec[k] = (dec[k] || 0) + 1;
}
for (const [k, want] of Object.entries(DECADES)) {
  if (dec[k] !== want) bad(`Atlantic ${k}: ${dec[k] || 0} entries, WMO publishes ${want}`);
}
if (RETIRED_ATLANTIC.length !== 100) bad(`Atlantic total is ${RETIRED_ATLANTIC.length}, published figure is 100`);

/* 3. No duplicates — a name+year twice would double-count a decade and could
 *    mask a missing entry, leaving the checksum green while the list is wrong. */
for (const [label, list] of [['Atlantic', RETIRED_ATLANTIC], ['E Pacific', RETIRED_EPACIFIC],
                             ['C Pacific', RETIRED_CPACIFIC]]) {
  const seen = new Set();
  for (const [n, y] of list) {
    if (seen.has(`${n}|${y}`)) bad(`${label}: ${n} ${y} listed twice`);
    seen.add(`${n}|${y}`);
  }
}

/* 4. A never-used name must NOT also appear in a basin list. Both states at
 *    once means somebody "fixed" an omission that was deliberate. */
const all = [...RETIRED_ATLANTIC, ...RETIRED_EPACIFIC, ...RETIRED_CPACIFIC];
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
