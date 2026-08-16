/**
 * watchwarning.js — NHC watch/warning (TCWW) codes: detection, labels, order.
 *
 * These are watch/warning PRODUCTS — never the word "advisory" in UI copy
 * (SPEC §6). All four are wind-threshold products: 34 kt tropical-storm
 * force, 64 kt hurricane force.
 *
 * Pure functions. Imports: config/ only.
 */

import { WATCH_WARNING_COLOR } from '../config/tokens.js';

/** Display label per TCWW code. */
export const WW_LABEL = Object.freeze({
  TWA: 'Tropical Storm Watch',
  TWR: 'Tropical Storm Warning',
  HWA: 'Hurricane Watch',
  HWR: 'Hurricane Warning',
});

/** Severity order for the deduped legend — warnings above watches, hurricane
 *  above tropical storm. The legend dedupes BY TYPE (SPEC §7): after coast
 *  tracing one warning emits several segments, and iterating naively stacks
 *  five identical rows. */
const WW_RANK = Object.freeze({ HWR: 0, HWA: 1, TWR: 2, TWA: 3 });

const CODES = new Set(Object.keys(WW_LABEL));

/** The field that carries the code. Recorded live off Bertha's segment,
 *  2026-07-23 — before that the name was genuinely unknown and the value
 *  scan below was the only option. */
const CODE_FIELD = 'tcww';

/**
 * Find the TCWW code on a GeoJSON feature's properties.
 *
 * NAMED FIELD FIRST. `tcww` is now confirmed live, so read it directly.
 * That matters beyond tidiness: the value scan walks EVERY property, so any
 * future descriptive field containing the text "HWR" could win and paint a
 * Tropical Storm Warning in Hurricane Warning red. Those colors are the §6
 * fixed safety contract — a wrong one is a safety-adjacent bug, not a
 * cosmetic one.
 *
 * The scan is KEPT as a fallback, not deleted. It cost nothing, it is the
 * only thing that would survive NHC renaming the field, and it was load-
 * bearing for real until this week. Returns null when neither finds a code,
 * which renders generic rather than wrong.
 */
export function wwCodeFromProps(props) {
  if (!props) return null;

  const named = props[CODE_FIELD];
  if (typeof named === 'string' && CODES.has(named.trim().toUpperCase())) {
    return named.trim().toUpperCase();
  }

  for (const v of Object.values(props)) {
    if (typeof v === 'string' && CODES.has(v.trim().toUpperCase())) {
      return v.trim().toUpperCase();
    }
  }
  return null;
}

export function wwColor(code) {
  return WATCH_WARNING_COLOR[code] || null;
}

/**
 * Render stacking order for overlapping coastal paint: higher = drawn on
 * top. NHC routinely issues overlapping products (a Hurricane Watch atop a
 * Tropical Storm Warning on the same coast); with the band select both paint
 * the same segments, and the SEVERER product must win the pixels — a
 * Hurricane Warning hidden under watch yellow is a §6 safety bug. Feeds
 * MapLibre `line-sort-key`. Unknown codes get 0: generic paint sits under
 * everything real.
 */
export function wwSortKey(code) {
  return code in WW_RANK ? 4 - WW_RANK[code] : 0;
}

/**
 * Does this feature carry a line the map can actually draw?
 *
 * ==> NHC PUBLISHES WATCHES WITH NO SHAPE, AND THIS IS NOT A PARSE FAILURE.
 *     <== Measured live on Lala, advisory 5A, 2026-08-13: layer 8 answered
 * with one feature carrying `tcww: "HWA"`, the storm's name, the advisory
 * number — and `geometry: null`, `shape: null`, `st_length(shape): null`. The
 * row's own `idp_source` names the LINE shapefile it came from, so the
 * geometry exists somewhere upstream and was lost before the MapServer. We
 * ask for it (`returnGeometry: true`) and layer 8 is not simplified, so
 * nothing on our side could have dropped it.
 *
 * WHAT THAT COSTS IF NOBODY CHECKS. The legend reads properties, so the panel
 * says "Hurricane Watch" correctly. The map paints geometry, so the coast
 * draws in its ordinary color. A Hurricane Watch in force and a coast with
 * no watch on it are then PIXEL-IDENTICAL, which is the §5 failure with the
 * worst consequence in the app. The coastal band select already tags these
 * `_bandReason: 'not-a-line'` and nothing has ever read that field.
 *
 * An empty coordinate array counts as undrawable too: a LineString with no
 * points is a shape in name only.
 */
export function wwHasOutline(feature) {
  const g = feature?.geometry;
  if (!g) return false;
  if (g.type === 'LineString') return (g.coordinates?.length || 0) >= 2;
  if (g.type === 'MultiLineString') {
    return (g.coordinates || []).some((part) => (part?.length || 0) >= 2);
  }
  return false;
}

/**
 * Deduped, severity-ordered legend entries from a feature list.
 *
 * `drawn` is false when NOT ONE feature carrying that code has an outline, so
 * a product that is partly drawable does not get flagged as missing — half a
 * warning on the coast is a different and much smaller problem than none of
 * it, and calling both "not drawn" would make the honest note untrustworthy
 * on the case it matters for.
 *
 * @returns {Array<{code, label, color, drawn}>}
 */
export function wwLegend(features) {
  /** code -> has at least one drawable feature */
  const seen = new Map();
  for (const f of features || []) {
    const code = wwCodeFromProps(f.properties);
    if (!code) continue;
    seen.set(code, (seen.get(code) || false) || wwHasOutline(f));
  }
  return [...seen.keys()]
    .sort((a, b) => WW_RANK[a] - WW_RANK[b])
    .map((code) => ({
      code,
      label: WW_LABEL[code],
      color: wwColor(code),
      drawn: seen.get(code),
    }));
}
