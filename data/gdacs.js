/**
 * gdacs.js — the GDACS event list (direct browser fetch) → normalized storms.
 *
 * GDACS (EU/JRC) is the coarser source covering the basins NHC doesn't:
 * Northwest Pacific, North Indian, Southwest Indian, Australian, South
 * Pacific (SPEC §4). The list endpoint is CORS-open (verified in-browser
 * 2026-07-22) — no relay involved. Its slow sibling, per-event GEOMETRY, is a
 * later phase and IS relay-cached.
 *
 * Field knowledge here is inherited from the HA project and from the Phase 1
 * severity seam that ran live: features[] with properties.eventtype "TC",
 * geometry Point coordinates, severitydata.severity in km/h, episodeid
 * incrementing per update, alertlevel Green/Orange/Red.
 *
 * No DOM, ever. Imports: config/, lib/, data/relay.js.
 */

import { ENDPOINT } from '../config/constants.js';
import { categoryFromKt } from '../lib/category.js';
import { basinFromPosition } from '../lib/basin.js';
import { fetchFeed } from './relay.js';

const KMH_PER_KT = 1.852;

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};

/** One GDACS feature → normalized storm, or null without id + position. */
function normalizeEvent(feat) {
  const pr = feat?.properties || {};
  if ((pr.eventtype || '') !== 'TC') return null;

  const eventId = pr.eventid != null ? String(pr.eventid) : null;
  const coords = feat.geometry?.coordinates || [pr.longitude, pr.latitude];
  const lon = num(coords?.[0]);
  const lat = num(coords?.[1]);
  if (!eventId || lon == null || lat == null) return null;

  /* GDACS severity is wind in km/h. Stored in KNOTS like everything else —
   * this is the one conversion, done at ingest because km/h is the source's
   * unit, not ours (SPEC §8: knots in storage, always). */
  const kmh = num(pr.severitydata?.severity);
  const windKt = kmh == null ? null : kmh / KMH_PER_KT;

  /* Category is computed from wind and marked derived. NEVER from alertlevel —
   * Green/Orange/Red is a humanitarian impact estimate, not an intensity
   * (SPEC §4, non-negotiable). */
  const category = categoryFromKt(windKt);

  /* Advisory identity: episodeid increments per update. Fallback: event
   * last-modified date. */
  const episodeId = pr.episodeid != null ? String(pr.episodeid) : null;
  const observedAt = pr.todate || pr.fromdate || null;

  return {
    id: `gdacs:${eventId}`,
    source: 'gdacs',
    sourceId: eventId,
    name: pr.eventname || pr.name || `TC ${eventId}`,
    basin: basinFromPosition(lon, lat),

    lat,
    lon,

    windKt,
    pressureMb: null, // GDACS does not publish pressure. Omitted, not zeroed.
    headingDeg: null,
    speedKt: null,

    nature: 'tropical', // GDACS only lists active tropical cyclones
    category,
    categorySource: category == null ? null : 'derived',

    observedAt,
    advisoryKey: `gdacs:${eventId}:${episodeId || observedAt || 'unknown'}`,

    /** GDACS offers far less geometry: track + wind bands via its (slow,
     *  relay-cached) geometry endpoint. No cone, no forecast, no watches —
     *  this block is why those layer rows dim instead of lying (SPEC §4). */
    can: {
      cone: false, forecastTrack: false, forecastPoints: false,
      pastTrack: true, watchWarning: false, windRadii: false,
      surge: false, models: false, windBands: true,
    },

    raw: {
      alertLevel: pr.alertlevel || null,
      countries: pr.country || null,
      episodeId,
    },
  };
}

/**
 * Fetches and normalizes the GDACS event list.
 *
 * @returns {Promise<{storms: object[], fetchedAt: string, relayStale: boolean}>}
 */
export async function fetchGdacsStorms() {
  const { json } = await fetchFeed(ENDPOINT.gdacsEventList);
  const feats = Array.isArray(json?.features) ? json.features : [];
  return {
    storms: feats.map(normalizeEvent).filter(Boolean),
    fetchedAt: new Date().toISOString(),
    relayStale: false,
  };
}

export { normalizeEvent as _normalizeGdacsEvent }; // exposed for fixture tests
