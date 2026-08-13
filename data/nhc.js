/**
 * nhc.js — CurrentStorms.json (via the relay) → normalized storm objects.
 *
 * NHC/CPHC is the native, full-fidelity source: Atlantic, East Pacific,
 * Central Pacific (SPEC §4). Reaches us through /api/nhc/storms because
 * www.nhc.noaa.gov sends no CORS header.
 *
 * VERIFIED against the live feed 2026-07-23 (storms Bertha al022026 and Fausto
 * ep062026). Field names below are confirmed, not assumed:
 *   - intensity is KNOTS, pressure mb, latitudeNumeric/longitudeNumeric present
 *   - movementSpeed is KNOTS (Bertha 10, Fausto 13)
 *   - publicAdvisory.advNum is a ZERO-PADDED STRING ("017", "019"). Never
 *     parseInt it: "017" -> 17 breaks every cache key built from it.
 *   - there is NO final-advisory flag anywhere in the feed. §5's ghost wording
 *     must therefore always be the cautious form ("no longer in the NHC feed").
 *   - windWatchesWarnings is null when none are in effect (see `can` below).
 * Parsing stays defensive regardless: any missing field degrades to null,
 * never to a crash or a fake zero.
 *
 * NOTE for Phase 4: the MapServer GEOMETRY uses 9999 as a missing-value
 * sentinel (mslp/tcdir/tcspd on forecast points beyond tau=0). That sentinel
 * does NOT appear in this feed and is deliberately not handled here — it
 * belongs in the geometry parser that reads those layers.
 *
 * No DOM, ever. Imports: config/, lib/, data/relay.js.
 */

import { ENDPOINT } from '../config/constants.js';
import { categoryFromKt } from '../lib/category.js';
import { BASIN_BY_PREFIX } from '../lib/basin.js';
import { fetchFeed } from './relay.js';

/** NHC classification code → normalized `nature` (SPEC §4: trust NHC's own
 *  label for what kind of thing it is; derive only the number).
 *  Codes seen live: TS (Bertha), HU (Fausto), TD (Cristobal), and **`PC`
 *  (One-C, 2026-08-13)** — which was NOT in this table and is the reason it is
 *  worth reading twice.
 *
 *  ==> WHAT `PC` COST WHILE IT WAS MISSING. <== An unrecognised code falls
 *  through to `'tropical'`, which then derives a Saffir-Simpson category from
 *  the wind. One-C is a POTENTIAL CYCLONE — NHC issues advisories on it
 *  precisely because it is not yet a cyclone and may still reach land — and the
 *  app was drawing it as a 35 kt tropical storm, in TS green, with a category
 *  NHC has pointedly not assigned. That is a §5 claim the source never made.
 *
 *  `PTC` was in this table from the start and has never been observed; `PC` is
 *  what the feed actually publishes. Both stay, because a table that guesses
 *  which spelling a source uses is the mistake this app has now made twice
 *  (see lib/track-point.js on `stormtype` codes versus `tcdvlp` words).
 *
 *  THE `'tropical'` DEFAULT IS DELIBERATE AND IS A TRADE. A code we do not
 *  recognise on a feed of active cyclones is more likely a cyclone than not,
 *  and grading it from its own wind degrades honestly. The cost is exactly what
 *  `PC` demonstrated: a non-cyclone quietly graded. Anything added here should
 *  be added because it was OBSERVED, not because it appears in a document. */
const NATURE_BY_CLASSIFICATION = {
  TD: 'tropical', TS: 'tropical', HU: 'tropical', MH: 'tropical',
  SD: 'subtropical', SS: 'subtropical',
  STD: 'subtropical', STS: 'subtropical',
  PC: 'potential',  // observed live 2026-08-13 on One-C (cp012026)
  PTC: 'potential', // "Potential Tropical Cyclone Five" — real advisories, no category
  PT: 'post-tropical', EX: 'post-tropical',
  LO: 'remnant', DB: 'remnant', WV: 'remnant',
};

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};

/** A position is only usable if it is IN RANGE — finite is not enough. Same
 *  guard as the GDACS parser, for the same reason: an out-of-range latitude
 *  survives an isFinite check and comes out of the sphere math as a confident
 *  marker near the pole, which is a §5 failure with extra steps. NHC is the
 *  more reliable feed and this has not been seen from it, but the cost of the
 *  check is nothing and the cost of a misplaced storm is trust. */
const inRange = (lon, lat) =>
  lon != null && lat != null &&
  lon >= -180 && lon <= 180 &&
  lat >= -90 && lat <= 90;

/** One raw activeStorms entry → the normalized shape (SPEC §4), or null if it
 *  lacks the minimum a storm needs to exist: an id and a position. */
function normalizeStorm(raw) {
  const sourceId = String(raw.id || '').toLowerCase();
  const lat = num(raw.latitudeNumeric);
  const lon = num(raw.longitudeNumeric);
  if (!sourceId || !inRange(lon, lat)) return null;

  const windKt = num(raw.intensity); // NHC intensity is knots — native unit
  const nature =
    NATURE_BY_CLASSIFICATION[String(raw.classification || '').toUpperCase()] ||
    'tropical';

  /* Advisory identity (SPEC §4): advisory number is a STRING (intermediates
   * are "5A"). Fallback: issuance timestamp. */
  const advNum = raw.publicAdvisory?.advNum != null ? String(raw.publicAdvisory.advNum) : null;
  const observedAt = raw.lastUpdate || raw.publicAdvisory?.issuance || null;
  const advisoryKey = `nhc:${sourceId}:${advNum || observedAt || 'unknown'}`;

  /* Category: CurrentStorms carries no explicit Saffir-Simpson number, so it
   * is computed from NHC's own official wind — exact, since both the wind and
   * the thresholds are in knots. Marked "derived" honestly; "reported" is
   * reserved for a source that states the number itself. */
  const category = ['tropical', 'subtropical'].includes(nature)
    ? categoryFromKt(windKt)
    : null;

  return {
    id: `nhc:${sourceId}`,
    source: 'nhc',
    sourceId,
    name: raw.name || sourceId.toUpperCase(),
    basin: BASIN_BY_PREFIX[sourceId.slice(0, 2)] || 'atlantic',

    lat,
    lon,

    windKt,
    pressureMb: num(raw.pressure),
    headingDeg: num(raw.movementDir),
    speedKt: num(raw.movementSpeed), // knots — confirmed live 2026-07-23

    nature,
    category,
    categorySource: category == null ? null : 'derived',

    observedAt,
    advisoryKey,

    /** What this source can offer (SPEC §4). NHC storms support the full
     *  geometry set; wind BANDS are the GDACS-style product NHC doesn't ship.
     *
     *  watchWarning is READ FROM THE FEED, not assumed. Confirmed live
     *  2026-07-23: Fausto (ep062026), a hurricane in open ocean, carries
     *  `windWatchesWarnings: null` while Bertha carries a populated object —
     *  and Fausto's MapServer watch-warning layer returns an empty
     *  FeatureCollection to match. Hardcoding true here would light up a layer
     *  toggle (§7) for a layer with nothing behind it, which is exactly the
     *  "toggles that do nothing" failure the `can` block exists to prevent. */
    can: {
      cone: true, forecastTrack: true, forecastPoints: true,
      pastTrack: true, watchWarning: raw.windWatchesWarnings != null,
      windRadii: true, surge: true, models: true, windBands: false,
    },

    raw: { classification: raw.classification, binNumber: raw.binNumber, advNum },
  };
}

/**
 * Fetches and normalizes the NHC storm list.
 *
 * @returns {Promise<{storms: object[], fetchedAt: string, relayStale: boolean}>}
 */
export async function fetchNhcStorms() {
  const { json, relayStale, fetchedAt } = await fetchFeed(
    `${ENDPOINT.relay}/nhc/storms`
  );
  const list = Array.isArray(json?.activeStorms) ? json.activeStorms : [];
  return {
    storms: list.map(normalizeStorm).filter(Boolean),
    fetchedAt: fetchedAt || new Date().toISOString(),
    relayStale,
  };
}

export { normalizeStorm as _normalizeNhcStorm }; // exposed for fixture tests
