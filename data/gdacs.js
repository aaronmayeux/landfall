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
import { basinFromPosition } from '../lib/basin.js';
import { fetchFeed } from './relay.js';

const KMH_PER_KT = 1.852;

/**
 * GDACS `severitytext` → its own classification.
 *
 * Measured forms, live 2026-07-24:
 *   "Tropical Depression (maximum wind speed of 185 km/h)"
 *   "Tropical Storm (maximum wind speed of 157 km/h)"
 *   "Hurricane/Typhoon > 74 mph (maximum wind speed of 167 km/h)"
 *
 * ORDER MATTERS. Depression is tested first and hurricane before storm, so
 * "Tropical Storm" cannot be swallowed by a looser test and "Hurricane" is
 * never mistaken for one. Anything unrecognised returns nulls — no claim
 * beats a guessed severity (§6).
 */
function classifyGdacs(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return { category: null, categoryCode: null };
  if (t.includes('depression')) return { category: 0, categoryCode: 'TD' };
  if (t.includes('hurricane') || t.includes('typhoon')) {
    return { category: null, categoryCode: 'HU' };
  }
  if (t.includes('storm')) return { category: 1, categoryCode: 'TS' };
  return { category: null, categoryCode: null };
}

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

  /* `severity` IS THE FORECAST PEAK, NOT THE CURRENT WIND — proven
   * 2026-07-24, four ways, on NOUL-26:
   *   - it reported 157 km/h while its own `severitytext` said Tropical Storm
   *   - the 120 km/h band does not reach the analysis position; it begins
   *     twelve hours out (measured off the published red swath)
   *   - the track leg ARRIVING at the current position is labelled TS
   *   - on glass, the storm sat outside its own hurricane-force wind field
   * Three of four live storms showed the same disagreement in one read.
   *
   * Deriving a category from this number drew every GDACS storm at its
   * forecast peak — a Cat 2 badge on a tropical storm, which is the §6 lie
   * the fixed colors exist to prevent. Stored as PEAK and named as such.
   * Still converted to knots at ingest (SPEC §8: knots in storage, always). */
  const kmh = num(pr.severitydata?.severity);
  const peakWindKt = kmh == null ? null : kmh / KMH_PER_KT;

  /* CURRENT intensity comes from GDACS's OWN CLASSIFICATION, not from a
   * number we reinterpret. `severitytext` reads "Tropical Storm (maximum wind
   * speed of 157 km/h)" — the prefix is the classification now, the
   * parenthetical is the peak.
   *
   * Three buckets is the ceiling and it is the source's, not ours: GDACS's
   * strongest wind band is 120 km/h = the Cat 1 floor, so it cannot
   * distinguish a Cat 1 from a Cat 5 in anything it publishes. A hurricane
   * therefore carries `categoryCode: 'HU'` and NO category index — honest
   * about strength, silent about the number. NEVER from alertlevel, which is
   * a humanitarian impact estimate (SPEC §4, non-negotiable). */
  const { category, categoryCode } = classifyGdacs(pr.severitydata?.severitytext);

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

    /* NULL ON PURPOSE: GDACS publishes no CURRENT wind number, and the one it
     * does publish is the peak (above). A field named windKt holding a peak
     * would be read as "now" by every consumer.
     *
     * The two consumers that need a number diverge deliberately:
     *   - SORTING (data/merge.js, ui/view-storms.js) falls back to
     *     peakWindKt. A list is a ranking, and "how big is this storm" is the
     *     honest question there — a typhoon must not sort under a TS.
     *   - THE CAGE'S ELEVATION (main.js) does NOT. It asks "how bad is it
     *     right now", and it sits beside a node color drawn from the CURRENT
     *     classification, so a peak-driven height would make the two channels
     *     disagree. It uses the middle of the stated class's wind range
     *     instead (lib/category.js `representativeKt`). */
    windKt: null,
    peakWindKt,
    pressureMb: null, // GDACS does not publish pressure. Omitted, not zeroed.
    headingDeg: null,
    speedKt: null,

    nature: 'tropical', // GDACS only lists active tropical cyclones
    category,
    /** 'TD' | 'TS' | 'HU' | null — GDACS's own classification. Carries the
     *  hurricane case, which has no category index to carry it. */
    categoryCode,
    /* REPORTED, not derived: these are the source's own words now, where
     * they used to be our arithmetic on a number that meant something else. */
    categorySource: categoryCode == null ? null : 'reported',

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
