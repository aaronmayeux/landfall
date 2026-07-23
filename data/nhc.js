/**
 * nhc.js — CurrentStorms.json (via the relay) → normalized storm objects.
 *
 * NHC/CPHC is the native, full-fidelity source: Atlantic, East Pacific,
 * Central Pacific (SPEC §4). Reaches us through /api/nhc/storms because
 * www.nhc.noaa.gov sends no CORS header.
 *
 * [VERIFY] Field names below follow NHC's published CurrentStorms format
 * (intensity in KNOTS, pressure in mb, latitudeNumeric/longitudeNumeric,
 * publicAdvisory.advNum) but have NOT been read from a live feed by this
 * project yet — the sandbox can't reach NOAA. Parsing is defensive: any
 * missing field degrades to null, never to a crash or a fake zero. Confirm
 * against a live storm and delete this paragraph.
 *
 * No DOM, ever. Imports: config/, lib/, data/relay.js.
 */

import { ENDPOINT } from '../config/constants.js';
import { categoryFromKt } from '../lib/category.js';
import { BASIN_BY_PREFIX } from '../lib/basin.js';
import { fetchFeed } from './relay.js';

/** NHC classification code → normalized `nature` (SPEC §4: trust NHC's own
 *  label for what kind of thing it is; derive only the number).
 *  [VERIFY] against live codes — defensively defaulted to 'tropical'. */
const NATURE_BY_CLASSIFICATION = {
  TD: 'tropical', TS: 'tropical', HU: 'tropical', MH: 'tropical',
  SD: 'subtropical', SS: 'subtropical',
  STD: 'subtropical', STS: 'subtropical',
  PTC: 'potential', // "Potential Tropical Cyclone Five" — real advisories, no category
  PT: 'post-tropical', EX: 'post-tropical',
  LO: 'remnant', DB: 'remnant', WV: 'remnant',
};

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};

/** One raw activeStorms entry → the normalized shape (SPEC §4), or null if it
 *  lacks the minimum a storm needs to exist: an id and a position. */
function normalizeStorm(raw) {
  const sourceId = String(raw.id || '').toLowerCase();
  const lat = num(raw.latitudeNumeric);
  const lon = num(raw.longitudeNumeric);
  if (!sourceId || lat == null || lon == null) return null;

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
    speedKt: num(raw.movementSpeed), // [VERIFY] units on live feed (kt assumed)

    nature,
    category,
    categorySource: category == null ? null : 'derived',

    observedAt,
    advisoryKey,

    /** What this source can offer (SPEC §4). NHC storms support the full
     *  geometry set; wind BANDS are the GDACS-style product NHC doesn't ship. */
    can: {
      cone: true, forecastTrack: true, forecastPoints: true,
      pastTrack: true, watchWarning: true, windRadii: true,
      surge: true, models: true, windBands: false,
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
