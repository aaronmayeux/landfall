/**
 * adeck.js — the ATCF a-deck parser (SPEC §4, §14 Phase 6 step 5).
 *
 * PURE. Text in, tracks out. No network, no DOM, no cache — data/adeck.js owns
 * the fetch and map/layers/model-tracks.js owns the drawing, so this file can
 * be exercised against a saved deck without either.
 *
 * THE FORMAT, and every field position here is confirmed against a live deck
 * (`aep012026`, 2026-07, on the HA project). Rows are comma-separated, one per
 * (cycle, tech, forecast hour[, wind-radii threshold]). Zero-based columns this
 * file reads:
 *
 *   [2] DTG      cycle stamp, `YYYYMMDDHH`, UTC
 *   [4] TECH     the model code — `AVNO`, `TVCN`, `UKX`, …
 *   [5] TAU      forecast hour
 *   [6] LAT      TENTHS of a degree with a hemisphere letter: `286N` → 28.6
 *   [7] LON      same: `920W` → -92.0
 *
 * A TAU REPEATS ACROSS WIND-RADII ROWS. The same (cycle, tech, tau) appears
 * once per 34/50/64 kt threshold with identical position, so the first row per
 * tau wins and the rest are ignored. Reading them all would triple every
 * track and produce a line that doubles back on itself.
 *
 * THE COORDINATES ARE NOT DECIMAL DEGREES. `286N` is 28.6, not 286. A parser
 * that reads the digits as a number produces coordinates hundreds of degrees
 * off, which on a globe silently wraps to a plausible-looking wrong place
 * rather than failing — §5's "wrong stated confidently" exactly.
 *
 * Imports: config/ only.
 */

import { MODEL_TRACKS } from '../config/constants.js';
import { MODEL_COLOR, MODEL_FALLBACK_RAMP } from '../config/tokens.js';

/** The techs we draw, as a Set for the row filter. Built once. */
const WANTED = new Set(MODEL_TRACKS.techs.map((m) => m.tech));

/** tech → its manifest entry, for label/pref/group on the way out. */
const BY_TECH = new Map(MODEL_TRACKS.techs.map((m) => [m.tech, m]));

/* ---------------------------------------------------------------------------
 * FIELD PARSING
 * ------------------------------------------------------------------------- */

/**
 * `'286N'` / `'920W'` → signed degrees. Null on anything malformed.
 *
 * The hemisphere letter is the sign and the digits are tenths. Both halves
 * are validated: a token with no letter, or with digits that are not a
 * number, is a null rather than a guess — one junk row must not bend a track.
 */
export function atcfLatLon(token) {
  const t = String(token ?? '').trim();
  if (t.length < 2) return null;
  const hemi = t[t.length - 1].toUpperCase();
  if (hemi !== 'N' && hemi !== 'S' && hemi !== 'E' && hemi !== 'W') return null;
  const v = Number(t.slice(0, -1));
  if (!Number.isFinite(v)) return null;
  const deg = v / 10;
  return hemi === 'W' || hemi === 'S' ? -deg : deg;
}

/**
 * ATCF DTG `'YYYYMMDDHH'` → epoch ms (UTC), or null.
 *
 * PARSED FIELD BY FIELD, NOT BY `Date.parse`. `Date.parse('2026072512')` is
 * not a defined format and engines disagree about what to do with it — some
 * return NaN, some invent a year. The staleness gate below depends on this
 * number, and a gate fed a garbage timestamp either drops every model or
 * keeps a week-old one.
 */
export function parseDtg(dtg) {
  const s = String(dtg ?? '').trim();
  if (!/^\d{10}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return null;
  const ms = Date.UTC(year, month - 1, day, hour);
  return Number.isFinite(ms) ? ms : null;
}

/* ---------------------------------------------------------------------------
 * THE STALE BACK HALF
 * ------------------------------------------------------------------------- */

/**
 * Drop the leading points that sit BEHIND the storm's current position, then
 * anchor the line at that position so every model radiates from the one dot
 * the user is looking at.
 *
 * WHY THIS IS GEOMETRIC AND NOT A TIMESTAMP TRIM, and it is the whole reason
 * the function exists: raw models analyse the storm slightly behind NHC's
 * official current position even on the matching cycle. Their tau-0 point is
 * where the model THINKS the storm is, which is a little way back along the
 * track. A time-based trim cannot catch those points — they are stamped
 * "now" — so five models each trail a short tail into the past and the
 * current position sprouts a beard.
 *
 * "Behind" means the far side of the plane through the current position
 * perpendicular to the storm's motion. With no usable heading the fallback is
 * the nearest point, which is weaker but never wrong in a way that invents
 * geometry.
 *
 * @param {Array<[number, number]>} pts  [lon, lat], ordered by forecast hour
 * @param {{lon:number, lat:number}|null} cur  current storm position
 * @param {number|null} headingDeg  compass heading of storm motion
 */
export function clipBehind(pts, cur, headingDeg) {
  if (!cur || !Number.isFinite(cur.lon) || !Number.isFinite(cur.lat)) return pts;
  if (!Array.isArray(pts) || pts.length < 2) return pts;

  /* Longitude degrees shrink with latitude, so an east-west offset has to be
   * scaled before it can be compared with a north-south one. Without this the
   * half-plane test is wrong everywhere except the equator — and wrong in the
   * direction of keeping points it should drop. */
  const cosLat = Math.cos((cur.lat * Math.PI) / 180) || 1;

  let heading = null;
  if (Number.isFinite(headingDeg)) {
    const r = (Number(headingDeg) * Math.PI) / 180;
    heading = [Math.sin(r), Math.cos(r)]; // [east, north] unit vector
  }

  let kept;
  if (heading) {
    let i = 0;
    while (i < pts.length) {
      const east = (pts[i][0] - cur.lon) * cosLat;
      const north = pts[i][1] - cur.lat;
      /* At or ahead of the plane — stop trimming. Everything from here on is
       * forecast, including any point that loops back later: a stalling storm
       * genuinely doubles back and that is data, not staleness. */
      if (east * heading[0] + north * heading[1] >= 0) break;
      i++;
    }
    kept = pts.slice(i);
  } else {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < pts.length; i++) {
      const east = (pts[i][0] - cur.lon) * cosLat;
      const north = pts[i][1] - cur.lat;
      const d = east * east + north * north;
      if (d < best) { best = d; bi = i; }
    }
    kept = pts.slice(bi);
  }

  if (!kept.length) return [];

  const anchor = [round2(cur.lon), round2(cur.lat)];
  if (kept[0][0] !== anchor[0] || kept[0][1] !== anchor[1]) kept = [anchor, ...kept];
  return kept;
}

const round2 = (v) => Math.round(v * 100) / 100;

/* ---------------------------------------------------------------------------
 * THE PARSE
 * ------------------------------------------------------------------------- */

/**
 * a-deck text → one track per model, in manifest order.
 *
 * @param {string} text  the decompressed deck
 * @param {object} [opts]
 * @param {{lon:number, lat:number}|null} [opts.cur]  current storm position
 * @param {number|null} [opts.headingDeg]  storm motion, compass degrees
 * @returns {Array<{tech, label, pref, group, cycle, points: Array<[number,number]>}>}
 *
 * PER-TECH LATEST CYCLE, then a freshness gate against the deck's newest
 * cycle. See MODEL_TRACKS.staleHours for why those are two separate rules
 * rather than one.
 *
 * Returns [] on an empty or unparseable deck — that is `none_matched`, and
 * the caller is what turns it into the honest empty state (§5). This function
 * never throws on bad input: a deck with one corrupt row should lose that
 * row, not the layer.
 */
export function parseAdeck(text, { cur = null, headingDeg = null } = {}) {
  /* rows[tech][dtg][tau] = [lon, lat] — first row per tau wins (see the
   * wind-radii note in the header). */
  const rows = new Map();

  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const f = line.split(',');
    if (f.length < 9) continue;

    const tech = f[4].trim();
    if (!WANTED.has(tech)) continue;

    const tau = Number(f[5]);
    if (!Number.isInteger(tau) || tau < 0 || tau > MODEL_TRACKS.maxTau) continue;

    const lat = atcfLatLon(f[6]);
    const lon = atcfLatLon(f[7]);
    if (lat == null || lon == null) continue;
    /* 0,0 in a deck is a null position, not the Gulf of Guinea. Unlike the
     * storm feed (§4, where 0,0 is a real place a storm could occupy), a
     * model that has not produced a position for this tau writes zeroes. */
    if (lat === 0 && lon === 0) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const dtg = f[2].trim();
    if (!parseDtg(dtg)) continue;

    let byCycle = rows.get(tech);
    if (!byCycle) { byCycle = new Map(); rows.set(tech, byCycle); }
    let byTau = byCycle.get(dtg);
    if (!byTau) { byTau = new Map(); byCycle.set(dtg, byTau); }
    if (!byTau.has(tau)) byTau.set(tau, [round2(lon), round2(lat)]);
  }

  if (!rows.size) return [];

  /* The deck's newest cycle across every tech — the yardstick each model's
   * own latest cycle is measured against. */
  let newest = null;
  for (const byCycle of rows.values()) {
    for (const dtg of byCycle.keys()) {
      const ms = parseDtg(dtg);
      if (ms != null && (newest == null || ms > newest)) newest = ms;
    }
  }
  const staleMs = MODEL_TRACKS.staleHours * 3600 * 1000;

  const out = [];
  /* TVCN wins the consensus slot; HCCA only fills in when TVCN is absent —
   * they are the same slot in the same color and drawing both would double a
   * line the user chose once. */
  const haveTvcn = rows.has('TVCN');

  for (const model of MODEL_TRACKS.techs) {
    if (model.tech === 'HCCA' && haveTvcn) continue;

    const byCycle = rows.get(model.tech);
    if (!byCycle) continue;

    /* This tech's own latest cycle. DTGs are fixed-width YYYYMMDDHH, so a
     * plain string max is chronological — but the freshness comparison below
     * goes through real timestamps, because subtracting two of these as
     * integers is only meaningful within a single day. */
    let cycle = null;
    for (const dtg of byCycle.keys()) if (cycle == null || dtg > cycle) cycle = dtg;

    const cycleMs = parseDtg(cycle);
    if (newest == null || cycleMs == null || newest - cycleMs > staleMs) continue;

    const byTau = byCycle.get(cycle);
    const ordered = [...byTau.keys()].sort((a, b) => a - b).map((t) => byTau.get(t));
    const points = clipBehind(ordered, cur, headingDeg).slice(0, MODEL_TRACKS.maxPoints);

    if (points.length < MODEL_TRACKS.minPoints) continue;

    out.push({
      tech: model.tech,
      label: model.label,
      pref: model.pref,
      group: model.group,
      cycle,
      points,
    });
  }

  return out;
}

/**
 * Tracks → a GeoJSON FeatureCollection the map layer hands straight to a
 * source. Kept here rather than in the layer file so the parse and its render
 * shape stay in one place; the layer decides paint, not schema.
 *
 * `isOn(pref)` applies the user's per-model selection. IT FILTERS HERE, NOT
 * IN A MAPLIBRE EXPRESSION, on purpose: a style filter would leave the
 * deselected geometry loaded and re-evaluated every frame, and this layer's
 * whole risk is drawing too much on a phone. Dropping the feature is the
 * version that actually costs nothing. Omit the predicate to keep everything.
 *
 * The colour is resolved per feature and baked into the properties, so the
 * paint is a plain `['get', '_color']` rather than a match expression that
 * would have to be rebuilt whenever the shortlist changes.
 */
export function tracksToFeatures(tracks, isOn = null) {
  const features = [];
  for (const t of tracks || []) {
    if (isOn && !isOn(t.pref)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: t.points },
      properties: {
        _tech: t.tech,
        _label: t.label,
        _pref: t.pref,
        _cycle: t.cycle,
        _color: modelColor(t.tech),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The identity colour for one model.
 *
 * The shortlist carries fixed hexes from §6 — a GFS line must read as GFS on
 * any theme, the same contract the category ramp keeps. Anything outside the
 * shortlist takes a colour from the low-chroma fallback ramp by position, so
 * a model added to the manifest without a hex still draws, distinctly, and
 * never silently shares a named model's colour.
 */
export function modelColor(tech) {
  const named = MODEL_COLOR[tech];
  if (named) return named;
  const i = MODEL_TRACKS.techs.findIndex((m) => m.tech === tech);
  const ramp = MODEL_FALLBACK_RAMP;
  return ramp[(i < 0 ? 0 : i) % ramp.length];
}

/** The manifest entry for a tech, or undefined. Exported so the selector and
 *  the layer both ask one place rather than each holding a copy. */
export const modelByTech = (tech) => BY_TECH.get(tech);
