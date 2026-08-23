/**
 * tools/zone-codes.mjs — the zones a Flood Watch names. §56.4.
 *
 * ==> A SEPARATE FILE BECAUSE `archive-fetch.mjs` RUNS ON IMPORT. <== It is a
 * top-level script: importing it to reach one function executes the whole hourly
 * fetch. So a test could only get at this by regexing the source and `eval`-ing
 * it, which is not a test of the shipped code — it is a test of a copy. §12.
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

/** ==> `Z` AND `C` ARE DIFFERENT GEOGRAPHIES AND NWS SERVES THEM FROM
 *  DIFFERENT PATHS. <== `OHZ011` is a forecast zone and lives at
 *  `/zones/forecast/OHZ011`; `OHC011` is a county and lives at
 *  `/zones/county/OHC011`. Both legitimately appear in a `geocode.UGC` array.
 *
 *  **Feeding a county code to the forecast path builds a URL that 404s** — and
 *  this script's whole premise is that an invented URL failing is
 *  indistinguishable in the manifest from a zone NWS genuinely does not
 *  publish. So they are separated here rather than lumped together, and the
 *  county ones are REPORTED rather than silently dropped.
 *
 *  A mutation test caught this: a regex accepting both passed every assertion,
 *  because every code in the captured watches happens to be a `Z`. */
const FORECAST_ZONE = /^[A-Z]{2}Z\d{3}$/;
const COUNTY_ZONE = /^[A-Z]{2}C\d{3}$/;

/**
 * Every distinct zone named by a live Flood Watch, split by kind.
 *
 * Returns `{ forecast, county, malformed }`.
 *
 * ==> SORTED, AND NOT LEFT IN FEED ORDER. <== File names are built from these.
 * An unsorted set renames every file the moment NWS reorders its list, and a
 * diff across two snapshots then shows churn that is not there.
 *
 * ==> DEDUPLICATED ACROSS WATCHES, NOT JUST WITHIN ONE. <== Two watches from
 * neighbouring offices routinely name the same zone. Fetching it twice in one
 * run is a wasted request at somebody else's server and two identical files.
 *
 * ==> EMPTY IS A REAL ANSWER. <== Most hours have no Flood Watch in force
 * anywhere in the United States. Nothing derived means the weather was quiet,
 * and the calling phase reports it as such rather than as a failure.
 *
 * `malformed` is a COUNT, not a list: it exists so a run that starts dropping
 * everything is visible in the manifest instead of looking like a quiet hour.
 */
export function watchZoneCodes(watchBody) {
  const forecast = new Set();
  const county = new Set();
  let malformed = 0;

  for (const f of watchBody?.features || []) {
    for (const raw of f?.properties?.geocode?.UGC || []) {
      const ugc = String(raw ?? '').trim().toUpperCase();
      if (!ugc) continue;
      if (FORECAST_ZONE.test(ugc)) forecast.add(ugc);
      else if (COUNTY_ZONE.test(ugc)) county.add(ugc);
      else malformed++;
    }
  }

  return {
    forecast: [...forecast].sort(),
    county: [...county].sort(),
    malformed,
  };
}
