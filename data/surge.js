/**
 * surge.js — peak storm surge, normalized to one shape.
 *
 * ==> ONE OUTPUT SHAPE, TWO INPUTS, AND THAT IS THE WHOLE DESIGN. <==
 *
 * Everything downstream — the map layer, the legend, the detail panel — reads
 * exactly five properties per feature:
 *
 *   kind      'polygon' (a flooded area) | 'line' (a coastal reach)
 *   color     blue | yellow | orange | red | purple, rising
 *   severity  0..4, the index of that color
 *   range     "8-12 ft" — NHC's own words, never rewritten
 *   place     "Tampa Bay"
 *
 * The FIXTURE already arrives in that shape (`samples/milton-al142024/surge/`,
 * built by .github/scripts/milton-surge-shape.mjs). The LIVE service does not,
 * and translating it is the only thing this file does that is not plumbing.
 *
 * ==> SURGE IS NOT BANDS ONLY, WHICH IS WHAT EVERY EARLIER PLAN ASSUMED. <==
 * Measured on Milton: every advisory carries a Lines folder beside Polygons,
 * and the lines are real surge — "Suwannee River, FL to Yankeetown, FL...3-5
 * ft", yellow. Roughly half the features. A renderer that draws only the
 * filled bands drops half the product, which is a §5 lie about a coastline.
 *
 * ==> THE COLOR IS A BUCKET; THE RANGE IS THE FORECAST. <== `SURGE_RAMP`
 * labels red "Up to 12 ft". What NHC actually publishes for a red area is
 * 5-10, 6-10 or 8-12 ft depending on the place. Both are kept and the RANGE is
 * what the reader is shown; the ramp label is a fallback for a feature that
 * has no range of its own.
 *
 * ==> DO NOT READ `symbolid`. NOW MEASURED, NOT REASONED. <== SPEC-DATA.md
 * §4.8 said it carries the color class. The service declares it an integer,
 * and on Lala's real bytes (2026-08-16) it is `0` on all eleven features while
 * `popupinfo` carries `{"peak_surge_range": "1-2 ft", "color": "blue"}` on
 * every one of them.
 *
 * THE COST OF GETTING THIS WRONG IS NOT A MISSING LAYER, IT IS A WRONG NUMBER
 * ON A COASTLINE, and there is a live example. The HA integration this app
 * descends from reads `symbolid`, finds no color word in `0`, and falls back
 * to the feature's INDEX in the list — so Lala's eleven bands, every one of
 * them blue at 1-2 ft, painted as blue, yellow, orange, red, and then purple
 * ("Above 12 ft") for the remaining seven, over Honolulu. It looks entirely
 * plausible on a map, which is exactly why the rule is stated this loudly.
 * See config/constants.js SURGE.
 */

import { ENDPOINT, SURGE } from '../config/constants.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

/* ---------------------------------------------------------------------------
 * NORMALIZATION
 * ------------------------------------------------------------------------- */

/** Pull the color word out of whatever the source calls its description.
 *
 *  Accepts an object (the fixture, and the live service if it hands back
 *  parsed JSON), a JSON string, or a bare string that merely CONTAINS a color
 *  word. The last case is the loose one and it is last on purpose: it is how a
 *  popup blob like "Peak surge: 8-12 ft (red)" would still resolve, and it is
 *  also how a place called "Blue Hill Bay" would resolve WRONGLY, so it only
 *  ever runs after the structured attempts have failed.
 *
 *  @returns {{color: string|null, range: string|null, via: string|null}}
 */
function readSurgeDescription(value, fieldName) {
  if (!value) return { color: null, range: null, via: null };

  let obj = null;
  if (typeof value === 'object') obj = value;
  else if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('{')) { try { obj = JSON.parse(s); } catch { obj = null; } }
  }

  if (obj) {
    const color = obj.color ? String(obj.color).toLowerCase().trim() : null;
    const range = obj.peak_surge_range ? String(obj.peak_surge_range).trim() : null;
    if (color && SURGE.colors.includes(color)) {
      return { color, range: range || null, via: `${fieldName}.json` };
    }
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    const hit = SURGE.colors.find((c) => lower.includes(c));
    if (hit) {
      /* Ranges read like "8-12 ft" or "1-2 ft". Only taken alongside a color
       * that was found in the same blob — a number with no severity beside it
       * is not a surge forecast, it is a coincidence. */
      const m = value.match(/(\d+\s*-\s*\d+\s*ft)/i);
      return { color: hit, range: m ? m[1].replace(/\s+/g, '') : null, via: `${fieldName}.text` };
    }
  }

  return { color: null, range: null, via: null };
}

/** "Tampa Bay...8-12 ft" -> "Tampa Bay". Never the depth. */
function placeFromName(name) {
  const s = String(name || '');
  const cut = s.indexOf(SURGE.nameSeparator);
  return (cut >= 0 ? s.slice(0, cut) : s).trim() || null;
}

/**
 * Turn one source feature into the shared shape, or null if it carries no
 * severity at all.
 *
 * A FEATURE WITH NO RECOGNIZABLE COLOR IS DROPPED, NOT PAINTED A DEFAULT.
 * Guessing a severity for a surge polygon is the §5 lie in miniature: every
 * wrong guess is a coastline told the wrong depth. The caller counts what was
 * dropped so a schema change is loud rather than a quietly thinner map.
 */
function normalizeFeature(f, { fromFixture }) {
  const p = f?.properties || {};
  if (!f?.geometry) return null;

  /* The fixture is already normalized and is the verified path — read it
   * straight rather than re-deriving fields we built ourselves. */
  if (fromFixture) {
    if (!SURGE.colors.includes(p.color)) return null;
    return { feature: f, via: 'fixture' };
  }

  let found = { color: null, range: null, via: null };
  for (const field of SURGE.liveColorFields) {
    found = readSurgeDescription(p[field], field);
    if (found.color) break;
  }
  if (!found.color) return null;

  const kind = f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'
    ? 'line'
    : 'polygon';

  return {
    via: found.via,
    feature: {
      type: 'Feature',
      properties: {
        kind,
        color: found.color,
        severity: SURGE.colors.indexOf(found.color),
        range: found.range,
        place: placeFromName(p.name ?? p.Name),
      },
      geometry: f.geometry,
    },
  };
}

/**
 * Normalize a FeatureCollection from either source.
 *
 * @returns {{fc: object, dropped: number, via: string|null}} `via` names the
 *   field that actually answered — logged once per fetch so the FIRST LIVE
 *   STORM settles which candidate in `SURGE.liveColorFields` was right,
 *   instead of the question staying open forever.
 */
export function normalizeSurge(fc, { fromFixture = false } = {}) {
  const features = [];
  let dropped = 0;
  let via = null;

  for (const f of fc?.features || []) {
    const out = normalizeFeature(f, { fromFixture });
    if (!out) { dropped++; continue; }
    via ||= out.via;
    features.push(out.feature);
  }

  return { fc: { type: 'FeatureCollection', features }, dropped, via };
}

/* ---------------------------------------------------------------------------
 * FETCH
 * ------------------------------------------------------------------------- */

/** The storm id the fixture rides under.
 *
 *  ==> IT IS NAMED HERE BECAUSE THE AMBIENT PRUNE HAS TO KNOW IT. <== The
 *  engine drops any ambient bundle whose id is not in the live storm list, and
 *  it runs on every poll — so a synthetic bundle painted at boot was silently
 *  deleted about thirty seconds later, which looked exactly like a layer that
 *  never drew. main.js keeps this id in the live set while the fixture is on. */
export const FIXTURE_STORM_ID = '__milton-surge-fixture';

/** The harness sets this (surge/boot.js) to an advisory id like '017'. Unset
 *  in the shipping app, which is what makes this file inert there. */
export function fixtureAdvisory() {
  return globalThis.__LANDFALL_SURGE_FIXTURE__ || null;
}

/** Load one advisory of Milton's published surge. */
export async function fetchSurgeFixture(adv) {
  const url = `/samples/milton-al142024/surge/${adv}/peaksurge.geojson`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.type !== 'FeatureCollection') throw new Error('not a FeatureCollection');
  return normalizeSurge(json, { fromFixture: true });
}

/* ---------------------------------------------------------------------------
 * THE ENVELOPE, WHICH LIVES HERE RATHER THAN IN THE QUERY
 *
 * ==> THE RELAY ROUTE TAKES NO POSITION, AND THIS IS THE OTHER HALF OF THAT
 *     DECISION. <== `functions/api/nhc/surge.js` carries the argument in full:
 * a position in the query is a position in the cache key, and the cron Worker
 * and the reader cannot be made to agree on one, because the storm moves
 * between the warm cycle and the tap. So the route serves everything NHC
 * publishes anywhere, warmed under one fixed key, and the per-storm filter is
 * done here — arithmetic over bytes already in memory.
 *
 * TWO FILTERS, IN ORDER: the storm id the service publishes on each feature
 * (`idp_subset` — see `matchesStormId`, and note that this file used to say
 * flatly that no such field existed), then the spatial box for anything that
 * states no id. With one storm publishing surge neither changes the answer;
 * with two, they are what stops one storm's panel showing the other's coast.
 * ------------------------------------------------------------------------- */

/** Every coordinate in a GeoJSON geometry, however deeply nested. Surge
 *  arrives as Polygon, MultiPolygon, LineString and MultiLineString in one
 *  collection, so walking the arrays is simpler and safer than four cases. */
function* coordsOf(node) {
  if (!Array.isArray(node)) return;
  if (typeof node[0] === 'number' && typeof node[1] === 'number') {
    yield node;
    return;
  }
  for (const child of node) yield* coordsOf(child);
}

/**
 * Does any part of this feature fall inside the box around the storm?
 *
 * ==> ANY VERTEX, NOT THE CENTROID. <== A coastal reach can be 200 km long. A
 * band whose middle sits outside the envelope while its end touches the storm
 * is still that storm's forecast, and dropping it would take a real piece of
 * coast off the map — the §5 failure this whole file is arranged around.
 *
 * NO ANTIMERIDIAN HANDLING, AND IT IS DELIBERATE RATHER THAN FORGOTTEN. This
 * product covers US coasts; the widest case is Hawaii, where a 12° box around
 * 160°W spans 172°W to 148°W and never approaches the seam. A Guam or Wake
 * surge product would need it, NHC does not publish one, and a wrap written
 * against no real bytes would be a guess sitting in the path of every storm.
 */
function withinEnvelope(feature, lat, lng, deg) {
  for (const [x, y] of coordsOf(feature?.geometry?.coordinates)) {
    if (Math.abs(y - lat) <= deg && Math.abs(x - lng) <= deg) return true;
  }
  return false;
}

/**
 * ==> THE SERVICE DOES CARRY A STORM ID, AND EVERY NOTE IN THIS PROJECT SAID
 *     IT DID NOT. <== Measured on Lala's real bytes, 2026-08-16
 *     (`origin/archive:latest/nhc-peaksurge-polygons.geojson`): every feature
 *     carries `idp_subset: "cp012026"` — the app's own storm id, same case,
 *     same shape. `folderpath` carries it too, alongside the advisory number.
 *
 * The "no stormid, so filter spatially" rule came from reading the field list
 * for a field literally named `stormid`, finding none, and stopping. It is the
 * same mistake as trusting the layer extent: a question answered from metadata
 * rather than from rows. The HA integration this app descends from carries the
 * identical assumption in its own comments.
 *
 * SO THE ID IS TRIED FIRST AND THE BOX IS THE FALLBACK, not the other way
 * round. An id match is exact; a 12° box around a storm sitting off a crowded
 * coast will happily hand one storm's panel a neighbour's bands. But the id
 * is one storm's worth of evidence, so a feature that carries no `idp_subset`
 * at all still gets the spatial test rather than being silently dropped —
 * losing a real band is worse than including a distant one.
 *
 * @returns {boolean|null} true/false when the feature states an id, null when
 *   it states none and the caller should fall back to geometry.
 */
function matchesStormId(feature, stormId) {
  if (!stormId) return null;
  const sub = feature?.properties?.idp_subset;
  if (typeof sub !== 'string' || !sub.trim()) return null;
  return sub.trim().toLowerCase() === String(stormId).trim().toLowerCase();
}

/**
 * Narrow the whole published product down to one storm's features.
 *
 * PURE, AND EXPORTED FOR THAT REASON — this is the only piece of the live path
 * that makes a judgement, so it is the only piece worth a test, and a test that
 * needs a network fetch is a test nobody runs.
 *
 * @returns {{fc: object, byId: number, byBox: number}} the counts say WHICH
 *   filter answered, which is what turns the first live storm into a
 *   measurement instead of another entry on the open-questions list.
 */
export function selectForStorm(fc, { lat, lng, stormId = null } = {}) {
  let byId = 0;
  let byBox = 0;
  const features = (fc?.features || []).filter((f) => {
    const idSays = matchesStormId(f, stormId);
    if (idSays !== null) {
      if (idSays) byId++;
      return idSays;
    }
    const inBox = withinEnvelope(f, lat, lng, SURGE.envelopeDeg);
    if (inBox) byBox++;
    return inBox;
  });
  return { fc: { type: 'FeatureCollection', features }, byId, byBox };
}

/**
 * Live surge near a storm's current position.
 *
 * Fetches the whole published product from the warmed relay route and narrows
 * it here. Throws on anything that is not an answer, which the caller turns
 * into an honest `unavailable` — never an empty map, which would read as no
 * surge forecast rather than no answer (§5). An answer that genuinely contains
 * nothing for this storm comes back as an empty collection, which is
 * `none_matched`, and the two must never look alike.
 */
export async function fetchSurgeLive(lat, lng, stormId = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('surge: no position to filter on');
  }
  const res = await fetch(`${ENDPOINT.relay}/nhc/surge`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'surge query error');
  if (json?.type !== 'FeatureCollection') throw new Error('not a FeatureCollection');

  const published = json.features?.length || 0;
  const { fc: near, byId, byBox } = selectForStorm(json, { lat, lng, stormId });
  const out = normalizeSurge(near, { fromFixture: false });
  /* ==> THE ONE LINE THAT ANSWERS THE OPEN QUESTION. <== Printed rather than
   * rendered: it is a note to whoever is watching the console during the first
   * storm, and it turns `SURGE.liveColorFields` from a list of guesses into a
   * measurement. */
  console.info(
    `[landfall] surge: ${published} published, ${near.features.length} for this storm ` +
    `(${byId} by id, ${byBox} by ${SURGE.envelopeDeg}° box), ${out.fc.features.length} kept, ` +
    `color read from ${out.via || '(nothing — every candidate field missed)'}` +
    (out.dropped ? `, ${out.dropped} dropped for no recognizable color` : '')
  );
  return out;
}

export { EMPTY as EMPTY_SURGE };
