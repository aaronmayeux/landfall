/**
 * zones.js — the zone codes an NWS alert names, split by geography. §56.4.
 *
 * ==> A FLOOD WATCH IS ISSUED FOR A LIST OF ZONES, NOT FOR A DRAWN BOX. <== It
 * arrives with `geometry: null`, so it cannot be drawn and — since §56.3 made
 * the match a distance from the storm's track — it cannot be matched either.
 * There is nothing to measure a distance from. The zones it names are the only
 * route back to a shape, and they live in one field: `geocode.UGC`.
 *
 * ==> AND THE STATE LIVES NOWHERE ELSE EITHER. <== §56.2 measured it: a watch's
 * `areaDesc` reads `Cuyahoga; Lake; Geauga; Ashtabula Inland; …` — zone names
 * with no state anywhere in the string. Parsing a state out of that text, which
 * was the obvious cheap route, is not possible. `OHZ011` is the only place the
 * app can learn that those counties are in Ohio.
 *
 * ==> `Z` AND `C` ARE DIFFERENT GEOGRAPHIES AND NWS SERVES THEM FROM DIFFERENT
 * PATHS. <== `OHZ011` is a forecast zone at `/zones/forecast/OHZ011`; `OHC011`
 * is a county at `/zones/county/OHC011`. Both legitimately appear in one `UGC`
 * array. **Feeding a county code to the forecast path builds a URL that 404s**,
 * and a 404 is indistinguishable from a zone NWS genuinely does not publish —
 * so a lumped-together resolver fails in the one way nothing can diagnose. They
 * are separated here, and the county codes are REPORTED rather than dropped.
 *
 * A mutation test caught that: a pattern accepting both passed every assertion,
 * because every code in the captured watches happens to be a `Z`.
 *
 * ==> THIS FILE IS ONE HALF OF A HAND-COPIED PAIR. <== A Pages Function runs in
 * its own workerd runtime and cannot import from `lib/` (§4.13), so
 * `functions/api/nws/flood.js` carries the same two patterns written out again.
 * `tools/test-relay-mirrors.mjs` fails when they stop agreeing. Do not "fix"
 * the duplication by importing across that wall; there is no bundler here and
 * there is never going to be one.
 *
 * Pure. No DOM, no network, no clock. Imports nothing.
 */

/** A forecast zone: two-letter state, `Z`, three digits. `/zones/forecast/…`. */
export const UGC_FORECAST_ZONE = /^[A-Z]{2}Z\d{3}$/;

/** A county: two-letter state, `C`, three digits. `/zones/county/…`. */
export const UGC_COUNTY = /^[A-Z]{2}C\d{3}$/;

/**
 * Split a raw `geocode.UGC` array into the two geographies plus a count of
 * what fitted neither.
 *
 * Returns `{ forecast, county, malformed }`.
 *
 * ==> SORTED, AND NOT LEFT IN FEED ORDER. <== File names and cache keys are
 * built from these. An unsorted set renames every one of them the moment NWS
 * reorders its list, and a diff across two snapshots then shows churn that is
 * not there.
 *
 * ==> DEDUPLICATED. <== Two watches from neighbouring offices routinely name
 * the same zone. Resolving it twice is a wasted request at somebody else's
 * server and two identical copies of one boundary.
 *
 * ==> EMPTY IS A REAL ANSWER. <== Most hours have no Flood Watch in force
 * anywhere in the United States, and a warning carries a polygon instead of a
 * zone list. Nothing here means the alert had nothing to say, never a fault.
 *
 * `malformed` is a COUNT, not a list: it exists so a feed that starts handing
 * out codes in a shape this app cannot read is VISIBLE rather than looking
 * exactly like a quiet hour (§5).
 */
export function splitUgc(codes) {
  const forecast = new Set();
  const county = new Set();
  let malformed = 0;

  for (const raw of codes || []) {
    const ugc = String(raw ?? '').trim().toUpperCase();
    if (!ugc) continue;
    if (UGC_FORECAST_ZONE.test(ugc)) forecast.add(ugc);
    else if (UGC_COUNTY.test(ugc)) county.add(ugc);
    else malformed++;
  }

  return {
    forecast: [...forecast].sort(),
    county: [...county].sort(),
    malformed,
  };
}

/* ---------------------------------------------------------------------------
 * TURNING A ZONE LIST INTO A SHAPE
 *
 * ==> THIS IS THE JOIN, AND IT IS THE WHOLE OF PHASE 4. <== The alert list and
 * the boundaries are two fetches with two lifetimes (§56.4) — fifteen minutes
 * against thirty days — so nothing upstream can hand them over already joined.
 * They meet here, in a pure function, which is why the join is testable against
 * real archived bytes with no browser and no network.
 * ------------------------------------------------------------------------- */

/**
 * Every zone code that would have to be resolved to give the shapeless alerts
 * in `alerts` a boundary.
 *
 * ==> ONLY THE ONES WITH NO SHAPE. <== A warning already carries the polygon
 * its forecaster drew; asking for its county's boundary as well would replace a
 * precise shape with a coarse one and spend a request doing it.
 *
 * ==> AND THE COUNTIES COUNT. <== The captured Flash Flood Warning is geocoded
 * to `HIC001` — a county — so "watches name zones, warnings name counties" is
 * a tendency and not a rule, and a shapeless alert naming only counties is
 * resolvable through exactly the same lookup.
 */
export function zonesNeeded(alerts) {
  const want = new Set();
  for (const a of alerts || []) {
    if (a?.geometry) continue;
    for (const z of a?.zones || []) want.add(z);
    for (const c of a?.counties || []) want.add(c);
  }
  return [...want].sort();
}

/**
 * The same alerts, with a boundary on every one whose zones resolved.
 *
 * `zoneMap` is `{ HIZ023: { name, state, geometry }, … }` — what
 * `/api/nws/zone` returns. Alerts that already had a shape are returned
 * untouched, by identity.
 *
 * ==> THE SHAPE IS THE UNION OF NWS's OWN BOUNDARIES AND NOTHING ELSE IS ADDED.
 * <== A watch is issued FOR those zones, so their polygons together are its
 * area — no centroid, no circle, no convex hull, nothing this app drew. §48.21's
 * rule against giving a shapeless watch a shape is about inventing one, and
 * this invents nothing. The polygons are collected into a MultiPolygon rather
 * than dissolved: a real union would need a polygon-clipping library, would put
 * a computed line where two zones meet, and buys nothing — a distance test
 * reads the vertices either way, and MapLibre paints overlapping rings the
 * same colour.
 *
 * ==> A PARTIAL RESOLVE IS MARKED, NEVER SMOOTHED OVER. <== Seventeen zones of
 * which fourteen answered draws a shape smaller than the watch's real area.
 * That is the §5 failure this whole feature is trying not to commit, so
 * `zonesUnresolved` names the ones that did not answer and the UI is required
 * to say so rather than presenting a partial outline as the whole.
 *
 * ==> AND AN ALERT WHOSE ZONES ALL FAILED KEEPS ITS NULL. <== Said and not
 * drawn (§56.4). It stays in the list with its area text, and nothing about it
 * pretends to a location.
 */
export function applyZones(alerts, zoneMap) {
  const map = zoneMap || {};
  const out = [];

  for (const a of alerts || []) {
    if (!a || a.geometry) { out.push(a); continue; }

    const codes = [...(a.zones || []), ...(a.counties || [])];
    if (!codes.length) { out.push(a); continue; }

    const polygons = [];
    const unresolved = [];
    for (const code of codes) {
      const g = map[code]?.geometry;
      if (!g) { unresolved.push(code); continue; }
      if (g.type === 'Polygon') polygons.push(g.coordinates);
      else if (g.type === 'MultiPolygon') polygons.push(...g.coordinates);
      else unresolved.push(code);
    }

    if (!polygons.length) {
      out.push({ ...a, zonesUnresolved: unresolved, placedFromZones: false });
      continue;
    }

    out.push({
      ...a,
      geometry: { type: 'MultiPolygon', coordinates: polygons },
      drawable: true,
      /* ==> STATED, BECAUSE THIS SHAPE DID NOT COME OFF THE ALERT. <== A
       * forecaster drew a warning's polygon for that warning. This one is the
       * zones the alert named, fetched separately and joined here, and any
       * surface that wants to word that difference needs to be able to see it. */
      placedFromZones: true,
      zonesUnresolved: unresolved,
    });
  }

  return out;
}
