/**
 * genesis.js — the areas being watched, normalized (SPEC §45).
 *
 * Turns NHC's outlook polygons into the objects the map layer and the drawer
 * both read. Pure functions plus one theme lookup; no fetching, no DOM.
 *
 * ==> THREE THINGS IN HERE ARE LOAD-BEARING AND EASY TO UNDO BY ACCIDENT. <==
 *
 * 1. THE PROBABILITIES ARE STRINGS WITH A PERCENT SIGN. `"40%"`, not `40`.
 *    Sorted as text, `"100%"` lands between `"10%"` and `"20%"` — the single
 *    most likely bug in this file, and the reason `parsePercent` exists and is
 *    tested against exactly that case.
 *
 * 2. NOTHING STRUCTURAL READS NHC'S `basin` FIELD. §45.2 carries a `[VERIFY]`:
 *    only `"Atlantic"` and `"Pacific"` have ever been seen live, and whether
 *    Central Pacific is ever distinguished is untested. Rather than guess, the
 *    canonical basin comes from the POLYGON'S OWN CENTROID through
 *    `basinFromPosition()` — the same function every storm in the app is
 *    placed by. An unexpected `basin` value therefore cannot drop an area,
 *    cannot misfile it, and cannot mistitle it, because no code path depends
 *    on it. The raw string is carried through as `sourceBasin`, which the
 *    outlook arbiter groups by so each basin is judged against its own
 *    bulletin (data/genesis.js). THIS IS STRONGER THAN A FALLBACK: a fallback
 *    still has a wrong branch to take.
 *
 *    It is NOT shown on the detail panel. It was, beside our own filing, until
 *    2026-08-12: the two agree for every Atlantic area by construction, and
 *    where they differ — NHC files the whole ocean as "Pacific", we split it
 *    at 140°W — ours is the sharper answer. A vaguer word printed beside a
 *    sharper one only asks the reader which to believe.
 *
 * 3. THE TITLE IS OURS, NOT NHC'S, AND THE CODE SAYS SO. NHC publishes no name
 *    for these areas — the layer has a basin, four probability strings, a
 *    source and a date, and that is all. "Eastern Pacific" is a description we
 *    computed from the centroid. It is descriptive, not predictive, and the
 *    detail view carries the centroid coordinates underneath it as the
 *    checkable fact. Do not let this drift into anything that sounds like a
 *    designation.
 *
 * Imports config/ and lib/ only. Never data/, never map/, never ui/.
 */

import { GENESIS } from '../config/constants.js';
import { GENESIS_COLOR, GENESIS_COLOR_LIGHT } from '../config/tokens.js';
import { isLight } from '../config/theme.js';
import { basinFromPosition, BASIN_LABEL } from './basin.js';

/* --- the percent strings --------------------------------------------------- */

/**
 * `"40%"` → `40`. Anything that is not a percentage → `null`.
 *
 * NULL IS NOT ZERO. A missing probability means the source did not say; zero
 * means the source said zero. They render differently and they sort
 * differently, and collapsing them would put "0%" on screen over a field NHC
 * left blank — a small invention, but §5 does not have a size threshold.
 */
export function parsePercent(raw) {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^(\d{1,3})\s*%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** `40` → `"40%"`. The one place a probability becomes text, so the app cannot
 *  print the same number two ways. */
export const formatPercent = (n) => (n == null ? null : `${n}%`);

/* --- the risk words -------------------------------------------------------- */

/**
 * `"Medium"` → `'MEDIUM'`. Anything unrecognised → `GENESIS.riskFallback`.
 *
 * Both sources use the same three rungs in different casing — NHC writes
 * "Low"/"Medium"/"High", JTWC shouts LOW/MEDIUM/HIGH — so one vocabulary
 * covers both. An unfamiliar word takes the quietest treatment rather than
 * removing the area from the list: dropping a watched area because of an
 * adjective is the §5 failure pointed inward.
 */
export function normalizeRisk(raw) {
  const w = String(raw ?? '').trim().toUpperCase();
  return GENESIS.RISK[w] || GENESIS.riskFallback;
}

/**
 * The patch color for a risk word, resolved against the live theme.
 *
 * ASK THIS, NEVER THE TABLES. A hatched area carries no halo and cannot have
 * one, so the dark set is very nearly the luminance of the daylight ocean —
 * the same measured failure the model tracks hit. See the note above
 * `GENESIS_COLOR` in config/tokens.js.
 */
export function genesisColor(risk) {
  const key = normalizeRisk(risk);
  return (isLight() ? GENESIS_COLOR_LIGHT : GENESIS_COLOR)[key];
}

/* --- geometry -------------------------------------------------------------- */

/**
 * Area-weighted centroid of a GeoJSON Polygon or MultiPolygon's LARGEST outer
 * ring, or null when the geometry is unusable.
 *
 * THE ANTIMERIDIAN IS HANDLED BY UNWRAPPING, and it has to be: a Pacific
 * development region straddling 180° would otherwise average its vertices to
 * somewhere near 0° longitude — the Gulf of Guinea — and the area would be
 * titled, basin-sorted and flown to on the wrong side of the planet. Vertices
 * are shifted to be continuous with the first one, the centroid is computed in
 * that unwrapped space, and the result is normalized back into [-180, 180).
 */
export function centroidOf(geometry) {
  const rings = outerRings(geometry);
  if (!rings.length) return null;

  let best = null;
  let bestAbsArea = -1;
  for (const ring of rings) {
    const c = ringCentroid(ring);
    if (c && c.absArea > bestAbsArea) {
      bestAbsArea = c.absArea;
      best = c;
    }
  }
  if (!best) return null;
  return { lon: normalizeLon(best.lon), lat: best.lat };
}

function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return Array.isArray(geometry.coordinates?.[0]) ? [geometry.coordinates[0]] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || [])
      .map((poly) => poly?.[0])
      .filter((r) => Array.isArray(r) && r.length);
  }
  return [];
}

function ringCentroid(ring) {
  const pts = unwrap(ring);
  if (pts.length < 3) return null;

  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [x0, y0] = pts[j];
    const [x1, y1] = pts[i];
    const f = x0 * y1 - x1 * y0;
    twiceArea += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }

  /* A DEGENERATE RING FALLS BACK TO THE VERTEX MEAN rather than dividing by
   * zero. A collapsed or self-cancelling polygon is not something to throw
   * over — it is one area whose title is approximate, on a globe where the
   * patch itself is still drawn from the real geometry. */
  if (Math.abs(twiceArea) < 1e-12) {
    const sx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const sy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return { lon: sx, lat: sy, absArea: 0 };
  }

  const area = twiceArea / 2;
  return { lon: x / (6 * area), lat: y / (6 * area), absArea: Math.abs(area) };
}

/** Shift each longitude to within 180° of the previous one, so a ring crossing
 *  the antimeridian is continuous instead of jumping the width of the world. */
function unwrap(ring) {
  const out = [];
  let prev = null;
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    let lon = p[0];
    if (prev != null) {
      while (lon - prev > 180) lon -= 360;
      while (prev - lon > 180) lon += 360;
    }
    prev = lon;
    out.push([lon, p[1]]);
  }
  return out;
}

const normalizeLon = (lon) => (((lon % 360) + 540) % 360) - 180;

/**
 * A closed ring approximating a small circle of `radiusDeg` around a point.
 *
 * ==> THIS SHAPE IS OURS. NOBODY PUBLISHED IT. <== It exists for JTWC, which
 * states a position and no extent, and it is the one piece of geometry in §45
 * that is not transcribed from a source. Aaron asked for it knowingly on
 * 2026-08-09, having heard the argument against: a shape on a map reads as a
 * measurement, and this one is not one.
 *
 * TWO THINGS KEEP IT HONEST. The radius is a MEASURED constant rather than a
 * pleasing number — `GENESIS.jtwcRadiusDeg` is the mean equivalent radius of
 * NHC's real published areas, so a JTWC circle is the size a watched area
 * actually is. And the area panel says in words that the shape is indicative,
 * so nobody reads the edge as a boundary somebody drew.
 *
 * IT DOES NOT SCALE WITH RISK. Size means extent everywhere else on this
 * globe, and JTWC publishes no percentage to scale by regardless — the only
 * numbers available would be `GENESIS.orderWeight`, which exist for sorting
 * and are forbidden from reaching the screen (§45.3).
 *
 * LONGITUDES COME OUT UNWRAPPED, ON PURPOSE. A circle near the dateline that
 * wrapped through ±180 would be drawn by MapLibre as a band stretching the
 * width of the world — the same failure `centroidOf` unwraps to avoid, in the
 * other direction. Renderers accept longitudes outside [-180, 180) and handle
 * the seam themselves; a polygon that jumps 360° mid-ring is what they cannot
 * handle. `98W` sits at 152°E today, twenty-eight degrees from the seam, which
 * is exactly the kind of margin that disappears without warning.
 *
 * The longitude offset is divided by cos(lat) so the ring is a circle ON THE
 * GLOBE rather than in degrees — at 20°N an undivided offset draws something
 * six per cent too narrow, and nearer the poles it becomes a lens.
 */
export function circleAround({ lon, lat }, radiusDeg, steps = 64) {
  const ring = [];
  /* Clamped so a high-latitude system cannot divide by a cosine near zero and
   * produce a ring wrapping the planet several times. Above ~80° the circle
   * stops being meaningful anyway; a wide shape is better than an infinite
   * one. */
  const shrink = Math.max(0.2, Math.cos(lat * (Math.PI / 180)));
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    ring.push([lon + (radiusDeg * Math.cos(t)) / shrink, lat + radiusDeg * Math.sin(t)]);
  }
  /* Explicitly closed: GeoJSON requires first === last, and a renderer that
   * silently closes it for you is not one to depend on. */
  ring[ring.length - 1] = [...ring[0]];
  return { type: 'Polygon', coordinates: [ring] };
}

/* --- the title ------------------------------------------------------------- */

/**
 * A readable description of where an area is, computed from its centroid.
 *
 * ==> THESE WORDS ARE OURS. NHC PUBLISHES NO NAME. <== See the file header.
 *
 * The Pacific basins already carry their own compass word in `BASIN_LABEL`
 * ("East Pacific", "Central Pacific", "Northwest Pacific"), so they are used
 * as-is — "Eastern East Pacific" is nobody's idea of a place. Only the
 * Atlantic, which spans a third of the planet under one word, gets subdivided,
 * and the thirds are the plain ones a reader would draw: west of 65°W is the
 * Caribbean and the US coast, east of 35°W is the deep tropical Atlantic where
 * Cabo Verde systems spin up, and the middle is the middle.
 */
export function areaTitle(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'Watched area';
  const basin = basinFromPosition(lon, lat);
  if (basin !== 'atlantic') return BASIN_LABEL[basin] || 'Watched area';

  const L = normalizeLon(lon);
  if (L < -65) return 'Western Atlantic';
  if (L < -35) return 'Central Atlantic';
  return 'Eastern Atlantic';
}

/* --- normalization --------------------------------------------------------- */

/**
 * NHC's layer 3 FeatureCollection → the app's area objects.
 *
 * ==> THE LABEL GOES AT OUR OWN CENTROID, AND LAYER 2 IS NOT CONSULTED. <==
 *
 * The design was to hang each percentage on NHC's published label anchor —
 * their point, their number. Real bytes killed it. Measured 2026-08-09: five
 * polygons, THREE anchors. Layer 2 is the current location of a DISTURBANCE,
 * which only some watched areas have, and the two areas with no point included
 * the second-likeliest on the board. Worse, the two layers cannot be matched —
 * anchor 1 carries polygon 2's attributes while sitting inside polygon 1's
 * footprint, so attribute matching and nearest-centroid matching disagree on
 * the very first feature. Either one would silently print one area's
 * probability on another area's shape, which is a §5 failure that looks
 * perfect on screen.
 *
 * The centroid is computed from the SAME feature the probability came off. It
 * is not where NHC would have put it, and it cannot be wrong about which area
 * it belongs to. The full measurement is in `GENESIS.anchorLayer`'s note in
 * config/constants.js.
 *
 * (A centroid can fall outside a sufficiently concave ring. On these shapes —
 * broad convex development regions, measured 8-22° across — it does not, and
 * a label sitting slightly off-centre is cosmetic. A label on the wrong area
 * is not. That trade is the whole reason this function looks the way it does.)
 */
export function normalizeNhcAreas(collection) {
  const feats = Array.isArray(collection?.features) ? collection.features : [];

  const out = [];
  for (const f of feats) {
    const centroid = centroidOf(f?.geometry);
    if (!centroid) continue; // no position means no basin, no title, no flyTo

    const p = f.properties || {};
    const prob2 = parsePercent(p.prob2day);
    const prob7 = parsePercent(p.prob7day);

    out.push({
      /* ArcGIS's own row id. NOT ideal — it is a service row number and NHC
       * may renumber it when the outlook republishes — but it is the only
       * identifier either layer publishes, and it beats the alternative that
       * was here first: a composite of the rounded centroid, which changes
       * whenever a forecaster redraws the shape by a degree. Selection
       * surviving a poll matters more than surviving a republication. */
      id: `nhc-genesis-${p.objectid ?? out.length}`,
      source: 'NHC',
      /* CANONICAL BASIN FROM THE CENTROID, never from the field. See header. */
      basin: basinFromPosition(centroid.lon, centroid.lat),
      /* Provenance only. Nothing branches on this. */
      sourceBasin: p.basin == null ? null : String(p.basin),
      title: areaTitle(centroid.lon, centroid.lat),
      centroid,
      geometry: f.geometry,

      prob2day: prob2,
      risk2day: normalizeRisk(p.risk2day),
      prob7day: prob7,
      risk7day: normalizeRisk(p.risk7day),

      /* THE HORIZON THE GLOBE DRAWS. The polygon IS the seven-day area, so the
       * seven-day number is the only one that may sit on it (§45.6, Aaron's
       * call 2026-08-09). The two-day figure travels with the object and is
       * rendered only in the drawer, where it can be labelled. */
      globeProb: GENESIS.globeHorizon === 'sevenDay' ? prob7 : prob2,
      globeRisk: normalizeRisk(GENESIS.globeHorizon === 'sevenDay' ? p.risk7day : p.risk2day),

      /* The PUBLICATION stamp, not the fetch time — §17.7 forbids a third
       * clock. Epoch milliseconds on the wire. */
      issuedAt: Number.isFinite(Number(p.idp_filedate)) ? Number(p.idp_filedate) : null,
      idpSource: p.idp_source == null ? null : String(p.idp_source),
    });
  }
  return out;
}

/* --- ordering -------------------------------------------------------------- */

/**
 * The number an area sorts by. NEVER RENDERED — see `GENESIS.orderWeight`.
 *
 * An NHC area sorts on its published seven-day percentage. A JTWC system has
 * no percentage, so it sorts on the agreed weight for its word. Mapping HIGH
 * onto an invented percentage for DISPLAY would be inventing data; using one
 * to decide which row is first is a comparator, and a comparator has to say
 * something.
 */
export function orderValue(area) {
  if (area?.source === 'NHC' && area.prob7day != null) return area.prob7day;
  return GENESIS.orderWeight[normalizeRisk(area?.risk7day || area?.risk)] ?? 0;
}

/** Probability descending across both sources, then title, so the order is
 *  total and stable — an unstable comparator makes rows jump between polls. */
export function sortAreas(a, b) {
  const d = orderValue(b) - orderValue(a);
  if (d) return d;
  return String(a?.title || '').localeCompare(String(b?.title || ''));
}

/** Is this area's publication stamp old enough to say so? Null stamps are an
 *  UNKNOWN, never a delay — a layer that shouts at a missing field is a layer
 *  people learn to ignore. */
export function isStaleArea(area, now = Date.now()) {
  if (!Number.isFinite(area?.issuedAt)) return false;
  return now - area.issuedAt > GENESIS.staleAfter;
}
