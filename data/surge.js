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
 *   severity  0..4, the index of that colour
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
 * ==> THE COLOUR IS A BUCKET; THE RANGE IS THE FORECAST. <== `SURGE_RAMP`
 * labels red "Up to 12 ft". What NHC actually publishes for a red area is
 * 5-10, 6-10 or 8-12 ft depending on the place. Both are kept and the RANGE is
 * what the reader is shown; the ramp label is a fallback for a feature that
 * has no range of its own.
 *
 * ==> DO NOT READ `symbolid`. <== SPEC-DATA.md §4.8 said it carries the colour
 * class. The service declares it as an integer. See config/constants.js SURGE.
 */

import { ENDPOINT, SURGE } from '../config/constants.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

/* ---------------------------------------------------------------------------
 * NORMALIZATION
 * ------------------------------------------------------------------------- */

/** Pull the colour word out of whatever the source calls its description.
 *
 *  Accepts an object (the fixture, and the live service if it hands back
 *  parsed JSON), a JSON string, or a bare string that merely CONTAINS a colour
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
      /* Ranges read like "8-12 ft" or "1-2 ft". Only taken alongside a colour
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
 * A FEATURE WITH NO RECOGNIZABLE COLOUR IS DROPPED, NOT PAINTED A DEFAULT.
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

/**
 * Live surge near a storm's current position.
 *
 * NOT WIRED TO A ROUTE YET, and deliberately so: the relay route this calls is
 * one adapter that can only be written correctly against a real storm's bytes,
 * and there has been none since the layer was built. Calling it today throws,
 * which the caller turns into an honest `unavailable` — never an empty map,
 * which would read as no surge forecast rather than no answer (§5).
 */
export async function fetchSurgeLive(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('surge: no position to filter on');
  }
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  const res = await fetch(`${ENDPOINT.relay}/nhc/surge?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'surge query error');
  if (json?.type !== 'FeatureCollection') throw new Error('not a FeatureCollection');

  const out = normalizeSurge(json, { fromFixture: false });
  /* ==> THE ONE LINE THAT ANSWERS THE OPEN QUESTION. <== Printed rather than
   * rendered: it is a note to whoever is watching the console during the first
   * storm, and it turns `SURGE.liveColorFields` from a list of guesses into a
   * measurement. */
  console.info(
    `[landfall] surge: ${out.fc.features.length} features, colour read from ` +
    `${out.via || '(nothing — every candidate field missed)'}` +
    (out.dropped ? `, ${out.dropped} dropped for no recognizable colour` : '')
  );
  return out;
}

export { EMPTY as EMPTY_SURGE };
