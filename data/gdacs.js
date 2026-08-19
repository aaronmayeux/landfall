/**
 * gdacs.js — the GDACS event list (via the relay) → normalized storms.
 *
 * GDACS (EU/JRC) is the coarser source covering the basins NHC doesn't:
 * Northwest Pacific, North Indian, Southwest Indian, Australian, South
 * Pacific (SPEC §4).
 *
 * THIS FEED WENT THROUGH THE RELAY IN §17 PASS B, AND IT IS NOT A CORS FIX.
 * The endpoint is CORS-open (verified in-browser 2026-07-22) and the direct
 * fetch worked fine — at one user. On a shared link during a landfall it is
 * one request per phone per poll, from thousands of client IPs, with no
 * shared cache anywhere in the path: a firehose pointed at a public-good
 * European endpoint. **CORS-open is a permission, not a capacity plan.**
 * `functions/api/gdacs/events.js` carries the full reasoning.
 *
 * Nothing below this line changed. The relay is forward-and-cache only and
 * every field rule here still runs client-side, unchanged.
 *
 * Field knowledge here is inherited from the HA project and from the Phase 1
 * severity seam that ran live: features[] with properties.eventtype "TC",
 * geometry Point coordinates, severitydata.severity in km/h, episodeid
 * incrementing per update, alertlevel Green/Orange/Red.
 *
 * No DOM, ever. Imports: config/, lib/, data/relay.js.
 */

import { ENDED, ENDPOINT } from '../config/constants.js';
import { basinFromPosition } from '../lib/basin.js';
import { parseGdacsStamp } from '../lib/time.js';
import { fetchFeed } from './relay.js';
import { withJtwcWinds } from './jtwc-wind.js';
import { withCarqHistory } from './carq.js';

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

/** GDACS's own live flag, published as the STRING "true" / "false" (not a
 *  boolean — checked on the live payload). Both forms are accepted here
 *  because a source that changes its mind about the type should not resurrect
 *  a year of dead storms.
 *
 *  ONLY LOAD-BEARING SINCE 2026-07-26. The old `EVENTS4APP` list contained
 *  active events only, so every row was current by construction and this test
 *  would have been dead code. The cyclone-only list it was replaced with
 *  (see `functions/api/gdacs/events.js` for why) carries roughly a year of
 *  finished storms alongside the live ones. Without this filter the globe
 *  paints a hundred cyclones, most of them months dead, which is a worse lie
 *  than the missing-storm bug the switch fixed. */
const isCurrent = (v) => v === true || String(v).toLowerCase() === 'true';

/** One GDACS feature → normalized storm, or null without id + position. */
function normalizeEvent(feat) {
  const pr = feat?.properties || {};
  if ((pr.eventtype || '') !== 'TC') return null;
  if (!isCurrent(pr.iscurrent)) return null;

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

  /* NORMALIZED TO UTC HERE, AT INGEST — never at render. GDACS publishes
   * `todate`/`fromdate` ISO-SHAPED BUT WITH NO ZONE MARKER
   * ("2026-07-24T21:00:00"), and JavaScript reads a zoneless date-TIME as
   * LOCAL. Passing the raw string through shifted every GDACS age badge and
   * freshness band by the device's UTC offset — five hours in Chicago — while
   * NHC's stamps, which carry an explicit Z, stayed correct. Two feeds
   * disagreeing on the same clock is the §5 failure: a confident timestamp
   * that is wrong is worse than none.
   *
   * The fix lives here rather than in lib/time.js's formatters because the
   * render path is SHARED with NHC. A parse that special-cases the source is
   * exactly the inconsistency that created this. Everything downstream sees
   * one format from both feeds: a UTC ISO string with a Z.
   *
   * An unparseable stamp falls through to the other field and then to null —
   * `formatAge` renders null as "—", which is the honest answer. */
  const observedMs = parseGdacsStamp(pr.todate) ?? parseGdacsStamp(pr.fromdate);
  const observedAt = observedMs == null ? null : new Date(observedMs).toISOString();

  /* THE YEAR SUFFIX IS FILING, NOT NAMING. GDACS publishes `DOLPHIN-26`;
   * every other surface in the world — JTWC, NHC, the news — calls the storm
   * DOLPHIN. Stripped once, at ingest, so the list row, the map label and the
   * detail title all agree without three renderers each owning a trim.
   * Matching was never at risk: `stormNameKey` (lib/advisory.js) already
   * strips the suffix on both sides of every join, and `data/merge.js`
   * dedupes by basin, not name. The guard keeps a name that IS only a suffix
   * (nothing observed publishes one, but an empty display name is worse than
   * an ugly one). */
  const rawName = pr.eventname || pr.name || `TC ${eventId}`;
  const trimmed = rawName.replace(/-\d+\s*$/, '');

  return {
    id: `gdacs:${eventId}`,
    source: 'gdacs',
    sourceId: eventId,
    name: trimmed || rawName,
    basin: basinFromPosition(lon, lat),

    lat,
    lon,

    /* NULL OUT OF THIS PARSER, ON PURPOSE: GDACS publishes no CURRENT wind
     * number, and the one it does publish is the peak (above). A field named
     * windKt holding a peak would be read as "now" by every consumer.
     *
     * FILLED IN LATER WHERE JTWC HAS A WARNING. `fetchGdacsStorms` runs the
     * list through `withJtwcWinds` before returning it, so a storm JTWC is
     * warning on leaves this module with a real measured wind in this field
     * (lib/jtwc-wind.js carries the reasoning and the guards). This line is
     * still the honest default and still what a storm gets when JTWC has
     * nothing to say — it is no longer the final answer for every GDACS storm.
     *
     * The two consumers that need a number diverge deliberately, and both
     * rules still hold for an UNMATCHED storm:
     *   - SORTING (data/merge.js, ui/view-storms.js) falls back to
     *     peakWindKt. A list is a ranking, and "how big is this storm" is the
     *     honest question there — a typhoon must not sort under a TS.
     *   - THE CAGE'S ELEVATION (map/storm-mesh.js) does NOT. It asks "how bad
     *     is it right now", and it sits beside a node color drawn from the
     *     CURRENT classification, so a peak-driven height would make the two
     *     channels disagree. It uses the middle of the stated class's wind
     *     range instead (lib/category.js `representativeKt`) — which is
     *     exactly the ~109 kt-for-every-hurricane problem the JTWC join was
     *     built to remove, and which remains the fallback when it cannot. */
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
      /* ==> TRUE SINCE §51, AND THE FLAG WAS WRONG THE MOMENT THAT SHIPPED.
       * <== It meant "GDACS publishes no storm surge", which was believed
       * because the product named `cyclonesurge` on the event record resolves
       * to cards with `geometry: null` and no places in them. The surge is on
       * the same record under `impacts` → `getlocations`: named towns, a
       * modelled height in metres, an arrival hour and a peak hour. Measured
       * 2026-08-19 — Lala 47 towns, Saudel 2, Hernán none.
       *
       * Recorded here even though — like `can.models` above — nothing reads
       * it, and for the identical reason that comment gives: a capability map
       * that is only correct where something happens to consult it is a trap.
       * The next gate written against this flag would have deleted the entire
       * non-American half of surge without failing anything. */
      surge: true,
      /* ==> TRUE, AND IT WAS FALSE FOR WEEKS AFTER IT STOPPED BEING. <== The
       * flag predates the TCGP join. `data/adeck.js` resolves a GDACS storm to
       * a deck by NAME through `data/tcgp-index.js` and has done since the
       * Noul final-warning fix, so these storms carry model tracks today.
       *
       * Nothing reads this flag right now — `can.forecastPoints` and
       * `can.watchWarning` are the only two consulted anywhere — which is
       * exactly why it was wrong for so long and exactly why it matters that
       * it is right: the next gate written against `can.models` would have
       * silently deleted guidance for every storm outside NHC's basins. A
       * capability map that is only correct where something happens to read it
       * is a trap, not a map. */
      models: true,
    },

    raw: {
      alertLevel: pr.alertlevel || null,
      /** THE REAL FORECAST OFFICE, in GDACS's own words — `source` on the
       *  live list reads `JTWC` for Northwest Pacific storms and `NOAA` for
       *  the ones GDACS mirrors out of NHC's basins (measured 2026-08-14,
       *  seven live storms). GDACS is an aggregator; crediting it for a
       *  warning centre's analysis was both wrong and less trustworthy-
       *  looking. Kept verbatim rather than mapped through a lookup: an
       *  agency string we have never seen (BOM, IMD, Météo-France are all
       *  plausible) should reach the screen as itself, not as null. */
      agency: pr.source || null,
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
  const { json, relayStale, fetchedAt } = await fetchFeed(`${ENDPOINT.relay}/gdacs/events`);
  const feats = Array.isArray(json?.features) ? json.features : [];
  const storms = feats.map(normalizeEvent).filter(Boolean);

  /* THE FAILURE THAT MADE THIS NECESSARY WAS SILENT, AND THAT WAS THE REAL
   * BUG. When the old list feed got crowded out (see the relay route), the app
   * did not error, did not warn, and did not render a stale copy — it rendered
   * a correct-looking empty West Pacific. Nothing anywhere said "we asked for
   * storms and got a list that could not contain them." That is §5's
   * All-Clear-during-an-outage in a different costume: a confident empty state
   * standing in for a fact we did not actually have.
   *
   * A list with features in it and no CURRENT cyclones among them is the
   * fingerprint. It is not proof of a fault — the globe really is quiet
   * sometimes, and in a deep off-season this warns on a true empty. That trade
   * is deliberate and it is one-sided: a warning nobody needed costs a console
   * line, and a missing typhoon costs the whole point of the app.
   *
   * A console warning is the right size for it. There is no user-facing claim
   * to make here — `none_matched` is already what the store and the status
   * strip render, and it is the honest answer for a genuinely quiet basin. The
   * gap this closes is diagnostic: whoever reads the console next sees the
   * difference between "quiet" and "our feed cannot answer the question". */
  if (storms.length === 0 && feats.length > 0) {
    console.warn(
      `[landfall] GDACS list parsed to zero current cyclones from ${feats.length}` +
        ' features — quiet basins, or a list that cannot carry them (SPEC §4)'
    );
  }

  /* ==> `iscurrent` IS NOT A LIVENESS FLAG, AND THIS IS THE SECOND FILTER IT
   * TAKES TO GET A LIVE LIST OUT OF GDACS. <==
   *
   * `isCurrent` above drops a year of finished storms. What it cannot drop is
   * the storm GDACS has ABANDONED: still flagged current, still updating its
   * `datemodified`, and not analysed for days. DOLPHIN-26 measured live on
   * 2026-08-12 — `iscurrent: "true"`, `datemodified` eleven minutes old, last
   * fix (`todate`) three days earlier. GDACS's flag means "not archived yet",
   * which is a filing state, not a weather one.
   *
   * ==> WHY THE CUTOFF IS HERE AND NOT IN THE LIFECYCLE REGISTRY. <== The
   * registry is where the app decides a storm is over and says so, and it does
   * that well — `lapsed` catches this exact case at 48 hours and shows the
   * reader a grey row explaining it. What the registry cannot do is stay
   * decided, because its record expires and this feed's row does not. The
   * moment the record goes, the storm is back in the live list looking alive.
   * A cutoff on the bytes needs no memory to hold, survives a cleared phone,
   * and cannot disagree with itself. `ENDED.stopListingAfter` carries the full
   * argument and is deliberately the SUM of the two registry durations.
   *
   * DROPPED AFTER THE WARNING ABOVE ON PURPOSE. That warning is about a list
   * that could not carry the storms; a list whose storms have all been
   * abandoned is a real quiet, and warning on it would cry wolf every deep
   * off-season.
   *
   * A storm with no readable stamp is KEPT. `observedAt` is null when GDACS's
   * dates were unparseable, and "we cannot read the clock" is not evidence of
   * anything — dropping on it would let one malformed field delete a live
   * typhoon (§6). */
  const now = Date.now();
  const live = storms.filter((s) => {
    const observed = s.observedAt ? Date.parse(s.observedAt) : NaN;
    if (!Number.isFinite(observed)) return true;
    const age = now - observed;
    if (age <= ENDED.stopListingAfter) return true;
    console.info(
      `[landfall] ${s.name}: GDACS still lists it, last analysed ` +
        `${Math.round(age / 3600000)} h ago — dropped from the list (SPEC §5)`
    );
    return false;
  });

  /* ==> THE WIND COMES FROM SOMEWHERE ELSE, AND IT HAS TO HAPPEN HERE <==
   *
   * GDACS has no current wind to give (see `windKt` above). JTWC does, for the
   * same basins, in the same one-minute-sustained convention NHC uses — and
   * /api/jtwc/storms already fetches every active warning for the name index,
   * so reading the intensity out costs no extra upstream request. The full
   * argument, the two guards, and why JTWC is not a replacement for this list
   * are all in lib/jtwc-wind.js.
   *
   * WHY IT SITS INSIDE THE ROSTER FETCH rather than in the store: this
   * function's contract is "the storm list for the basins NHC does not cover,
   * fully resolved". Every surface in the app reads `windKt` — the list row,
   * the detail panel, the marker color, the cage — and a half-resolved list
   * would mean each of them owning a piece of this join. One place, before
   * anybody sees the storms.
   *
   * IT CANNOT FAIL THE FETCH. `withJtwcWinds` swallows everything and returns
   * the list untouched; a storm with no JTWC match keeps exactly the behaviour
   * it had before this existed. The roster is never at risk for a wind. */
  const enriched = await withJtwcWinds(live);

  /* ==> AND THE OTHER HALF OF THE SAME PROBLEM: THE STORM'S PAST. <===========
   *
   * The join above fixes the head and the forecast beads. It cannot touch the
   * past, because a JTWC warning has no history in it — so every past bead on a
   * GDACS storm still fell back to the middle of a three-word class, about
   * 110 kt for anything called a hurricane whatever the storm actually was.
   *
   * TCGP's a-deck carries `CARQ` rows: JTWC's own analysed history, negative
   * forecast hours, a real wind at each one. DOLPHIN's reads 20 → 25 → 30 → 35
   * → 60 → 75 → 100 kt across three days — a ridge with a shape, against a flat
   * slab of guesses.
   *
   * SAME PLACE AND SAME REASONS AS THE LINE ABOVE: one join, before anybody
   * sees the storms, so no surface owns a piece of it. Same guarantee too —
   * `withCarqHistory` swallows everything and returns the list untouched, so
   * this can cost a wind number and never a typhoon. */
  const withHistory = await withCarqHistory(enriched);

  /* ==> THE STAMP IS THE RELAY'S, NOT THIS DEVICE'S. <==
   *
   * This used to read `new Date().toISOString()` — the phone's own clock, at
   * the moment the fetch finished. That is not a measurement of anything. It
   * says the phone just asked; it says nothing about when the data behind the
   * answer was pulled from GDACS, which is the only question the freshness
   * banner is asking.
   *
   * ==> THE CONSEQUENCE WAS A WHOLE BRANCH OF THE UI THAT COULD NOT FIRE. <==
   * `ui/status.js` judges "feed delayed" purely on the age of this stamp. A
   * stamp minted on the device is always zero seconds old, so GDACS could not
   * report a delay under ANY outage, ever — cached, stale, or served hours late
   * off the last-good slot. "Storm feeds delayed" and "GDACS feed delayed" were
   * unreachable code, and NHC was silently the only source able to trip the
   * banner. That is §5's silence-on-failure wearing a timestamp as a disguise.
   *
   * The relay has been sending the real value on every one of its five answer
   * paths this whole time (`X-Landfall-Fetched-At`, read by `fetchFeed`); this
   * function was throwing it away. `relayStale` was hardcoded `false` for the
   * same reason and is now the header's answer too.
   *
   * The fallback to the local clock stays for the case where the header is
   * genuinely absent — an old cached relay response, or a proxy that strips
   * it. Identical to `data/nhc.js`, deliberately: both sources, every feature,
   * and the render path must not be able to tell which source it is holding. */
  return {
    storms: withHistory,
    fetchedAt: fetchedAt || new Date().toISOString(),
    relayStale,
  };
}

export { normalizeEvent as _normalizeGdacsEvent }; // exposed for fixture tests
