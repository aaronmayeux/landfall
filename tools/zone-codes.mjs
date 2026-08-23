/**
 * tools/zone-codes.mjs — the zones a Flood Watch names, across a whole feed. §56.4.
 *
 * ==> A SEPARATE FILE BECAUSE `archive-fetch.mjs` RUNS ON IMPORT. <== It is a
 * top-level script: importing it to reach one function executes the whole hourly
 * fetch. So a test could only get at this by regexing the source and `eval`-ing
 * it, which is not a test of the shipped code — it is a test of a copy. §12.
 *
 * ==> THE SPLIT ITSELF IS NOT HERE. <== It lives in `lib/zones.js`, because the
 * app needs it too and a rule with two homes has none. This file is the part
 * that is only ever a runner's business: walking a whole feed of watches and
 * pooling their codes into one deduplicated set of URLs to ask for.
 *
 * ==> AND IT IS THE ONLY PART OF THE ZONE PHASE A SANDBOX CAN PROVE ANYTHING
 * ABOUT. <== The fetch cannot run here; `api.weather.gov` is outside the wall.
 * The zone BOUNDARY — its envelope, its geometry type, its vertex count, its
 * byte cost — is asserted nowhere in this project because nothing here has ever
 * seen one. What CAN be proven, against real archived bytes, is which codes come
 * out of a real watch, and that decides which URLs the runner asks for.
 *
 * Pure. No fetch, no clock, no filesystem.
 */

import { splitUgc } from '../lib/zones.js';

/**
 * Every distinct zone named by every watch in a feed, split by kind.
 *
 * Returns `{ forecast, county, malformed }` — the same shape `splitUgc` returns
 * for one alert, pooled across all of them.
 *
 * ==> DEDUPLICATED ACROSS WATCHES, NOT JUST WITHIN ONE. <== Two watches from
 * neighbouring offices routinely name the same zone. Fetching it twice in one
 * run is a wasted request at somebody else's server and two identical files.
 *
 * ==> EMPTY IS A REAL ANSWER. <== Most hours have no Flood Watch in force
 * anywhere in the United States. Nothing derived means the weather was quiet,
 * and the calling phase reports it as such rather than as a failure.
 */
export function watchZoneCodes(watchBody) {
  const forecast = new Set();
  const county = new Set();
  let malformed = 0;

  for (const f of watchBody?.features || []) {
    const split = splitUgc(f?.properties?.geocode?.UGC);
    for (const z of split.forecast) forecast.add(z);
    for (const c of split.county) county.add(c);
    malformed += split.malformed;
  }

  return {
    forecast: [...forecast].sort(),
    county: [...county].sort(),
    malformed,
  };
}
