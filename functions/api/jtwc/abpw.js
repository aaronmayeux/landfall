/**
 * /api/jtwc/abpw — the Pacific Significant Tropical Weather Advisory,
 * forwarded. SPEC §45.3.
 *
 * Covers the WESTERN NORTH PACIFIC (180 to the Malay Peninsula) and the SOUTH
 * PACIFIC (west coast of South America to 135E). Its Indian Ocean twin is
 * `abio.js` next door; the behaviour they share lives in `_area-bulletin.js`.
 *
 * WHY THIS PRODUCT AND NOT A BETTER ONE. It is the only genesis product found
 * outside NHC that carries a probability at all. RSMC Nadi, Météo-France La
 * Réunion and IMD publish narrative bulletins with no structured formation
 * odds, so there is nothing better to reach for — this is not a placeholder
 * for something we intend to replace.
 *
 * IT IS NOT A `warning.js` PRODUCT AND CANNOT BE ONE. That route's
 * `PRODUCT_RE` is `/^[a-z]{2}\d{4}$/`, which excludes the area advisories
 * (`abpw`, `abio`) BY CONSTRUCTION rather than by accident — it builds a path
 * from a query parameter and the pattern is the guard. This file takes no
 * parameters at all, which is the cheapest possible version of that guard.
 */

import { serveAreaBulletin } from './_area-bulletin.js';

const PRODUCT = Object.freeze({
  slug: 'abpw',
  upstream: 'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt',
  headerRe: /^ABPW\d{2}\s+\w{4}\s+\d{6}/m,
  label: 'ABPW',
});

export async function onRequestGet(context) {
  return serveAreaBulletin(context, PRODUCT);
}
