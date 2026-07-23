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

/**
 * Find the TCWW code on a GeoJSON feature's properties.
 *
 * The 2026-07-23 probe confirmed the watch-warning layer returns real
 * geometry but did NOT record which property carries the code, and the live
 * service can't be probed from every environment. So instead of betting on
 * one field name, scan the property VALUES for one of the four codes — the
 * codes themselves are the stable contract. Returns null when absent, which
 * renders as an unclassified (generic) segment rather than a wrong color.
 */
export function wwCodeFromProps(props) {
  if (!props) return null;
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
