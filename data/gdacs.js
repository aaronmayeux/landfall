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

/** A position is only usable if it is IN RANGE. Finite is not enough: GDACS
 *  publishes placeholder and malformed geometry on events whose position is not
 *  yet resolved, and a latitude of 91 (or 999) sails through an isFinite check
 *  and comes out of the sphere math as a confident marker near the pole. A
 *  storm drawn in the wrong hemisphere is worse than a storm not drawn — it is
 *  the §5 failure with extra steps. Out of range means we do not know where it
 *  is, so the event is dropped like any other positionless one. */
const inRange = (lon, lat) =>
  lon != null && lat != null &&
  lon >= -180 && lon <= 180 &&
  lat >= -90 && lat <= 90;

/** One GDACS feature → normalized storm, or null without id + position. */
function normalizeEvent(feat) {
  const pr = feat?.properties || {};
  if ((pr.eventtype || '') !== 'TC') return null;

  const eventId = pr.eventid != null ? String(pr.eventid) : null;
  const coords = feat.geometry?.coordinates || [pr.longitude, pr.latitude];
  const lon = num(coords?.[0]);
  const lat = num(coords?.[1]);
  if (!eventId || !inRange(lon, lat)) return null;

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

    /** WHAT GDACS ACTUALLY PUBLISHES — corrected 2026-07-24 from a live read
     *  of its geometry endpoint (/api/gdacs/inspect, NOUL-26). This block was
     *  previously wrong on three counts, all inherited from the HA project:
     *  it declared cone, forecastTrack and pastTrack false. GDACS publishes
     *  all three — an uncertainty cone polygon, and intensity-labelled track
     *  segments split past vs forecast. Every row here now corresponds to
     *  something confirmed present or confirmed absent in that payload. */
    can: {
      cone: true,             // Poly_Cones, one polygon, "Uncertainty Cones"
      forecastTrack: true,    // Line_* segments with forecast === "true"
      pastTrack: true,        // Line_* segments with forecast === "false"
      windBands: true,        // Poly_Green/Orange/Red, 60/90/120 km/h
      /* Genuinely absent from the payload. Not pessimism — checked. */
      /* TRUE as of 2026-07-24. The 11 Point_Polygon_Point_N dots each carry
       * `key` ("07241200", MMDDHHMM) and a matching human `polygonlabel`, so
       * GDACS storms have a timestamped forecast track just as NHC storms
       * do. The long-standing "centre dots carry no forecast times" claim
       * came from reading `polygondate`, which is the ISSUE time and
       * therefore identical on all eleven. Parsed in data/gdacs-points.js. */
      forecastPoints: true,
      watchWarning: false,    // GDACS publishes no watch/warning product
      /* The bands ARE quadrant-shaped — confirmed on glass 2026-07-24. The
       * old comment here claimed "one radius, no quadrant breakdown" and was
       * inherited, not measured. This flag stays false anyway, but for the
       * REAL reason: GDACS publishes a drawn footprint, not the four
       * per-quadrant RADII in nautical miles that NHC's `ne/se/sw/nw` give.
       * Consumers wanting numbers still get nothing here; consumers wanting
       * a shape use the band polygons. */
      windRadii: false,
      surge: false,
      models: false,
    },

    raw: {
      alertLevel: pr.alertlevel || null,
      /** `country` is a DISPLAY string ("Philippines, China");
       *  `affectedcountries` is the structured list. The old code read
       *  `country` into a field named `countries`, which is why the panel
       *  never had a real list to work with. */
      countries: pr.affectedcountries || null,
      countryLabel: pr.country || null,
      /** The human sentence naming the storm type ("Tropical Storm (maximum
       *  wind speed of 157 km/h)"). Was discarded; the detail panel wants it,
       *  and it is GDACS's own words rather than our derivation. */
      severityText: pr.severitydata?.severitytext || null,
      /** The PUBLISHED geometry URL. Preferred over any URL we build — if
       *  GDACS moves the endpoint a published link keeps working. */
      geometryUrl: pr.url?.geometry || null,
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
