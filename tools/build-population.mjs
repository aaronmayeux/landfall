/**
 * build-population.mjs — REGENERATE assets/hazards/population-towns.json.
 *
 * ==> THIS IS NOT PART OF THE APP AND NEVER RUNS IN A BROWSER. <== It is a
 * one-off recipe, kept in the repo so the shipped file can be rebuilt and
 * audited rather than being a binary blob nobody can account for.
 *
 * The no-build-step rule is untouched: nothing imports this, the app ships
 * the JSON, and a person who never runs node still gets the whole feature.
 *
 * RUN IT:
 *   npm install all-the-cities
 *   node tools/build-population.mjs
 *
 * SOURCE: `all-the-cities` (MIT), which is a packaging of the GeoNames
 * gazetteer (CC BY 4.0). GeoNames is credited in map/attribution.js — that
 * credit is a licence requirement, not a courtesy. Do not remove it.
 *
 * --- THE FILTER, AND WHY EACH RULE EXISTS ---------------------------------
 *
 * 1. population >= 1000. The package advertises "at least 1000" and is wrong
 *    about its own contents: entries exist with a population of 0, meaning
 *    GeoNames holds the place but no figure for it. Those are `unavailable`,
 *    not zero (SPEC.md §5), and a sum is the one place the two genuinely
 *    cannot be told apart — so they are dropped rather than counted as zero.
 *
 * 2. ==> PPLX IS DROPPED AND THAT IS THE MOST IMPORTANT LINE HERE. <==
 *    PPLX is "section of populated place" — Villa Lugano inside Buenos Aires,
 *    and 4,816 others. Their populations are ALREADY inside their parent
 *    city's figure. Keeping them added 91,027,545 people to the world total
 *    who do not exist, concentrated in exactly the dense coastal cities a
 *    hurricane app cares about most.
 *
 * 3. PPLQ / PPLW / PPLH / PPLCH dropped: abandoned, destroyed, historical,
 *    and historical-capital. Nobody lives in them now.
 *
 * Everything else is kept, including PPLF (farm village), PPLL (locality),
 * PPLR (religious) and PPLG (seat of government) — those are real places
 * with real residents.
 *
 * --- THE OUTPUT SHAPE ------------------------------------------------------
 *
 * ONE FLAT ARRAY OF NUMBERS: [lon, lat, pop, lon, lat, pop, …]. Not GeoJSON,
 * and not an array of triples. Measured on the real set:
 *
 *   GeoJSON FeatureCollection   ~15 MB raw
 *   array of [lon,lat,pop]      2.29 MB raw   809 KB gzipped
 *   one flat array (shipped)    1.87 MB raw   670 KB gzipped
 *
 * The flat form also parses faster and lets the in-path count walk the
 * numbers directly, allocating nothing. GeoJSON is built from it at runtime
 * ONLY when the heat layer is switched on — the count never builds any.
 *
 * COORDINATES ARE ROUNDED TO 2 DECIMAL PLACES (~1.1 km). Both consumers are
 * coarse by nature: the heat layer blurs over tens of kilometres, and a wind
 * swath is hundreds of kilometres across. Storing six decimals would be
 * storing a precision neither reader can use, at roughly double the bytes.
 *
 * SORTED BY LATITUDE, then longitude. Nothing depends on the order today;
 * it exists so the file diffs sanely when it is regenerated, and so a future
 * reader can bisect by latitude if the linear scan ever stops being fast
 * enough (it is fast enough — see lib/population-count.js).
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Feature codes whose residents are counted somewhere else, or nowhere. */
const DROP = new Set(['PPLX', 'PPLQ', 'PPLW', 'PPLH', 'PPLCH']);

/** Below this, GeoNames coverage is too patchy to be worth the bytes — and
 *  the package claims this is its floor already. Stated here anyway, because
 *  the claim is not true of the data and a silent assumption is how a filter
 *  rots. */
const MIN_POPULATION = 1000;

const OUT = 'assets/hazards/population-towns.json';

function build() {
  const cities = require('all-the-cities');
  const rows = [];
  let dropped = 0;

  for (const c of cities) {
    if (!(c.population >= MIN_POPULATION)) { dropped += 1; continue; }
    if (DROP.has(c.featureCode)) { dropped += 1; continue; }
    const [lon, lat] = c.loc.coordinates;
    rows.push([
      Math.round(lon * 100) / 100,
      Math.round(lat * 100) / 100,
      c.population,
    ]);
  }

  rows.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const flat = [];
  let people = 0;
  for (const [lon, lat, pop] of rows) {
    flat.push(lon, lat, pop);
    people += pop;
  }

  writeFileSync(OUT, JSON.stringify(flat));

  console.log(`${OUT}`);
  console.log(`  kept    ${rows.length.toLocaleString()} towns`);
  console.log(`  dropped ${dropped.toLocaleString()} records`);
  console.log(`  people  ${people.toLocaleString()}`);
  console.log(
    '  NOTE: that total is an UNDERCOUNT of world population by design — it is'
  );
  console.log(
    '  everyone living in a named town of 1,000+, and nobody else. Say so in the UI.'
  );
}

build();
