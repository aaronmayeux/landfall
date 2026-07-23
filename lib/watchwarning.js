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
 * Deduped, severity-ordered legend entries from a feature list.
 * @returns {Array<{code, label, color}>}
 */
export function wwLegend(features) {
  const seen = new Set();
  for (const f of features || []) {
    const code = wwCodeFromProps(f.properties);
    if (code) seen.add(code);
  }
  return [...seen]
    .sort((a, b) => WW_RANK[a] - WW_RANK[b])
    .map((code) => ({ code, label: WW_LABEL[code], color: wwColor(code) }));
}
