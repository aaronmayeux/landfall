/**
 * /api/jtwc/abio — the Indian Ocean Significant Tropical Weather Advisory,
 * forwarded. SPEC §45.3.
 *
 * Covers the NORTH INDIAN OCEAN (Malay Peninsula west to the coast of Africa)
 * and the SOUTH INDIAN OCEAN (135E west to the coast of Africa). Its Pacific
 * twin is `abpw.js` next door; the behaviour they share lives in
 * `_area-bulletin.js`.
 *
 * ==> WHY IT EXISTS: WITHOUT IT THE WATCH LIST HAD A HOLE THE SIZE OF AN
 * OCEAN. <== `abpwweb.txt` is the Pacific bulletin and contains no Indian
 * Ocean at all, so an Arabian Sea, Bay of Bengal or Mozambique Channel
 * disturbance never appeared under `Being watched` — it showed up only once it
 * had already become a storm. STORMS THERE WERE NEVER AFFECTED: GDACS is
 * global and JTWC's own `io####`/`sh####` warnings match `warning.js`'s
 * `PRODUCT_RE` and always flowed. This closes the genesis half.
 *
 * WITH THIS ROUTE, THE MAP HAS NO HOLE LEFT. NHC covers the North Atlantic and
 * everything east of 180 in the North Pacific; these two bulletins cover the
 * rest. The one basin nobody publishes a genesis outlook for is the South
 * Atlantic, where a tropical cyclone is a once-a-decade event.
 *
 * SAME NO-PARAMETER GUARD as `abpw.js` — see the note there.
 */

import { serveAreaBulletin } from './_area-bulletin.js';

const PRODUCT = Object.freeze({
  slug: 'abio',
  upstream: 'https://www.metoc.navy.mil/jtwc/products/abioweb.txt',
  headerRe: /^ABIO\d{2}\s+\w{4}\s+\d{6}/m,
  label: 'ABIO',
});

export async function onRequestGet(context) {
  return serveAreaBulletin(context, PRODUCT);
}
