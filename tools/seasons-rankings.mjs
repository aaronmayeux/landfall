/**
 * seasons-rankings.mjs — every storm's place in the whole archive, reduced to
 * a table small enough for a phone. SPEC-SEASONS-BUILD.md §57.44, §57.42
 * Tier 1 item 11.
 *
 * ==> IT SHIPS DISTINCT VALUES AND COUNTS, NOT STORMS. <== A rank is
 * "how many storms are better than mine, plus one", and answering that needs
 * only the sorted distinct values and how many storms sit on each. 3,266
 * storms reduce to a few hundred numbers a statistic. Shipping the storms
 * themselves would mean shipping the archive to rank one storm against it.
 *
 * ==> IT READS THE WHOLE-BASIN FILES AND NOT `seasons/data/*.txt`. <== §57.42.
 * That directory holds the per-season slices AND the two cumulative
 * `hurdat2-*.txt` files, so a glob over it visits every storm twice — the
 * exact 2x that stopped this item being built for a week. The two sets agree
 * at 3,266 storms each; this walk takes the cumulative pair, which is what
 * §57.35 FIX 12 kept them for.
 *
 * ==> AND `cat`-ING THEM TOGETHER LOSES A STORM, SILENTLY. <== The Atlantic
 * file has no trailing newline, so concatenating the two glues its last data
 * row onto the East Pacific's first header and EP011949 disappears. Measured
 * 2026-08-29 while building this: 3,265 against 3,266. Each file is read and
 * parsed on its own here, and the count is asserted at the end.
 *
 * ==> EVERY STATISTIC IS QUANTIZED TO THE PRECISION THE PANEL PRINTS IT AT.
 * <== ACE renders as one decimal and lifespan as whole hours, so two storms
 * showing 12.4 must not show different ranks. Ranking at full float precision
 * would produce exactly that, and it reads as a bug because it is one.
 *
 * Node only. Reads the repo, writes one JSON file. No network.
 *
 *   node tools/seasons-rankings.mjs
 *   node tools/seasons-rankings.mjs --check     (report, write nothing)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';


import { parseHurdat2 } from '../lib/hurdat.js';
import { stormFacts } from '../lib/season-facts.js';
import {
  RANK_STATS, countsAgree, meetsFloor, rankingsFileName, scopeOrder, toRung,
} from '../lib/rankings.js';

const DATA_DIR = 'seasons/data';
const INDEX_FILE = 'seasons/index.json';

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');

/* ---------------------------------------------------------------------------
 * READING THE ARCHIVE
 * ------------------------------------------------------------------------- */

/**
 * The cumulative file for one basin, off the index rather than off a glob.
 *
 * The index names it in `basins[b].file`, which is the same string `_headers`
 * makes immutable and the same one the browser fetches. Deriving it here from
 * a directory listing would be a second opinion about which file is current.
 */
function basinFiles() {
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const out = [];
  for (const [basin, meta] of Object.entries(index.basins || {})) {
    if (!meta?.file) {
      throw new Error(`the index carries no cumulative file for ${basin}`);
    }
    out.push({
      basin,
      label: meta.label || basin,
      /* ==> `file` IS A SITE PATH AND `seasons[year]` IS A BARE FILENAME, AND
       * THEY ARE NOT THE SAME KIND OF STRING. <== The index writes
       * `/seasons/data/hurdat2-...` for the cumulative file and `atlantic-2005-...`
       * for a slice. Joining the first onto the data directory produces
       * `seasons/data/seasons/data/...`, which is how this was got wrong once.
       * The leading slash is what makes it a site path, so dropping it is what
       * turns it into a repo path. */
      file: meta.file.startsWith('/') ? meta.file.slice(1) : join(DATA_DIR, meta.file),
      revision: meta.revision || null,
      firstSeason: meta.firstSeason ?? null,
      lastSeason: meta.lastSeason ?? null,
    });
  }
  if (!out.length) throw new Error('the index names no basins');
  return out;
}

/* ---------------------------------------------------------------------------
 * THE LADDER
 * ------------------------------------------------------------------------- */

/**
 * Distinct values, best first, with a count on each.
 *
 * `direction` says which end is rank 1: `high` for wind, `low` for pressure.
 * The ladder is stored in RANK ORDER rather than in numeric order so a reader
 * walks it forwards and stops, and so nothing on the phone has to know which
 * way round a statistic runs.
 */
function ladder(values, direction, quantize) {
  const counts = new Map();
  for (const raw of values) {
    /* ==> ROUNDED BY THE PANEL'S OWN OPERATION, NAMED IN `QUANTIZERS`. <== Not
     * by arithmetic chosen here that happens to look equivalent: five storms
     * printed one ACE and ranked at another when it was. */
    const key = toRung(quantize, raw);
    if (key === null) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const keys = [...counts.keys()].sort((a, b) => (direction === 'low' ? a - b : b - a));
  return {
    direction,
    quantize,
    of: [...counts.values()].reduce((a, b) => a + b, 0),
    values: keys,
    counts: keys.map((k) => counts.get(k)),
  };
}

/** Every statistic's ladder for one set of storms. */
function statsFor(factsList) {
  const out = {};
  for (const [key, def] of Object.entries(RANK_STATS)) {
    const values = factsList.map(def.read).filter((v) => Number.isFinite(v));
    /* ==> A STATISTIC NOBODY IN THIS SCOPE HAS IS OMITTED, NOT SHIPPED EMPTY.
     * <== An empty ladder and a missing key both mean "no rank available", but
     * only one of them costs bytes on every phone. §5's three states live in
     * the reader (`rankOf` answers null), not in a hollow shape here. */
    if (!meetsFloor(values.length)) continue;
    out[key] = ladder(values, def.direction, def.quantize);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * BUILD
 * ------------------------------------------------------------------------- */

function build() {
  const basins = basinFiles();
  const perBasin = [];
  let total = 0;

  for (const b of basins) {
    const text = readFileSync(b.file, 'utf8');
    const { storms, faults } = parseHurdat2(text);
    const facts = storms.map(stormFacts).filter(Boolean);
    total += storms.length;
    perBasin.push({ ...b, storms, facts, faults });
    process.stderr.write(
      `${b.basin}: ${storms.length} storms, ${facts.length} with facts, ${faults.length} faults\n`,
    );
  }

  /* ==> THE COUNT IS ASSERTED RATHER THAN REPORTED. <== The two ways this walk
   * has already been got wrong both show up here and nowhere else: reading the
   * per-season slices as well doubles it, and concatenating the files loses
   * one. A number that only gets printed is a number nobody reads. */
  const slices = readdirSync(DATA_DIR).filter((f) => f.endsWith('.txt') && !f.startsWith('hurdat2-'));
  let sliceStorms = 0;
  for (const f of slices) {
    sliceStorms += parseHurdat2(readFileSync(join(DATA_DIR, f), 'utf8')).storms.length;
  }
  if (!countsAgree(total, sliceStorms)) {
    throw new Error(
      `the cumulative files hold ${total} storms and the per-season slices hold `
      + `${sliceStorms}. They describe the same archive and must agree.`,
    );
  }

  const scopes = {};

  for (const b of perBasin) {
    scopes[b.basin] = {
      label: b.label,
      /* ==> THE ARTICLE IS PART OF THE LABEL, BECAUSE THE SENTENCE NEEDS ONE
       * AND ONLY THIS FILE KNOWS WHICH. <== "3rd lowest in the Atlantic" takes
       * one; a basin named "Australia" would not. A renderer gluing `in the`
       * onto whatever arrives would be writing "in the Australia" the day the
       * world lands. */
      inWords: `the ${b.label}`,
      storms: b.storms.length,
      firstSeason: b.firstSeason,
      lastSeason: b.lastSeason,
      stats: statsFor(b.facts),
    };
  }

  /* ==> `all` IS COMPUTED FROM THE BASINS PRESENT AND NAMES THEM. <== §57.44.
   * It must never be worded "on record" by the renderer, because the set it
   * describes will quadruple the day step 13 lands and a reader who saw "3rd
   * lowest on record" last year would read "31st lowest on record" for the
   * same storm and conclude the app broke. It carries its own membership so
   * the sentence widens when the data does. */
  const everyFact = perBasin.flatMap((b) => b.facts);
  const members = perBasin.map((b) => b.basin);
  scopes.all = {
    label: perBasin.map((b) => b.label).join(' and '),
    inWords: `the ${perBasin.map((b) => b.label).join(' and ')}`,
    members,
    /* ==> THE MEMBERSHIP IS SPELLED OUT IN THE FILE, NOT REASSEMBLED BY THE
     * RENDERER. <== §57.44. The panel only ever receives the storm's OWN basin
     * plus this scope — it never sees the others — so a note built from what
     * reached the renderer would name one basin and claim to name them all.
     * Measured the hard way: the first version printed "every storm in the
     * settled record: 2,004 Atlantic" under a rank taken against 3,266.
     * Writing it here also means the sentence widens on the day a basin is
     * added, with no edit in the renderer at all. */
    parts: perBasin.map((b) => ({ label: b.label, storms: b.storms.length })),
    storms: total,
    firstSeason: Math.min(...perBasin.map((b) => b.firstSeason).filter(Number.isFinite)),
    lastSeason: Math.max(...perBasin.map((b) => b.lastSeason).filter(Number.isFinite)),
    stats: statsFor(everyFact),
  };

  /* ==> WIND IS RANKED ACROSS BASINS TODAY AND MUST NOT BE THE DAY THE WORLD
   * ARRIVES WITHOUT A DECISION FIRST. <== §57.44. Both basins here are NHC's,
   * so every wind in this file is a one-minute sustained average and comparing
   * them is comparing like with like. IBTrACS carries twelve agencies'
   * separate opinions of the same storm (§57.31) and most of the world reports
   * a ten-minute average, which reads lower for the identical storm. Mixing
   * the two in one ladder would quietly sink every typhoon below hurricanes it
   * actually beat. `windComparable` is that fact, written into the file rather
   * than assumed by the reader, so the day a scope carries mixed averaging
   * periods it says so and the renderer can decline. */
  for (const s of Object.values(scopes)) s.windComparable = true;

  return {
    generated: new Date().toISOString(),
    revision: rankingsFileName(
      Object.fromEntries(perBasin.map((b) => [b.basin, { revision: b.revision }])),
    ).revision,
    scopeOrder: scopeOrder(members),
    scopes,
  };
}

/* ---------------------------------------------------------------------------
 * MAIN
 * ------------------------------------------------------------------------- */

const payload = build();
const json = `${JSON.stringify(payload)}\n`;
const raw = Buffer.byteLength(json);
const gz = gzipSync(json).length;

process.stderr.write(
  `\nscopes: ${Object.keys(payload.scopes).join(', ')}\n`
  + `${raw} bytes raw, ${gz} bytes gzipped\n`,
);

for (const [name, scope] of Object.entries(payload.scopes)) {
  const rungs = Object.entries(scope.stats)
    .map(([k, l]) => `${k}=${l.values.length}/${l.of}`)
    .join(' ');
  process.stderr.write(`  ${name}: ${scope.storms} storms · ${rungs}\n`);
}

if (CHECK_ONLY) {
  process.stderr.write('\n--check: nothing written\n');
} else {
  const { file } = rankingsFileName(
    Object.fromEntries(Object.entries(payload.scopes)
      .filter(([k]) => k !== 'all')
      .map(([k]) => [k, { revision: payload.revision }])),
  );
  const out = join(DATA_DIR, file);
  writeFileSync(out, json);
  process.stderr.write(`\nwrote ${out}\n`);
}
