/**
 * surge-legend.js — NHC peak storm surge: the deduped legend for the panel.
 *
 * ==> THE SAME MECHANISM AS `wwLegend`, AND THAT IS AARON'S CALL, NOT A
 *     CONVENIENCE. <== `lib/watchwarning.js` turns many coast segments into a
 *     short list of the products actually in force, severest first, one row
 *     each, and `ui/view-storm-detail.js` paints each row as a glowing dot and
 *     a label. Surge arrives in exactly the same shape — many features, few
 *     distinct severities — so it gets the same treatment rather than a second
 *     idea about how a coastal legend should read.
 *
 * ==> ONLY THE ACTIVE ROWS. <== The five-rung ramp in `config/tokens.js` is the
 *     full palette, and printing all five would put four empty promises under a
 *     storm forecast to flood one. A rung appears here only when a real feature
 *     carries it, exactly as a watch code appears only when NHC has one out.
 *
 * ==> DEEPEST FIRST. <== `wwLegend` puts warnings above watches because the
 *     severer product is the one a reader must not miss. Same reasoning, same
 *     direction: the purple 12-foot reach goes above the blue 2-foot one.
 *
 * Input is ALREADY NORMALIZED — `normalizeSurge()` in `data/surge.js` has run,
 * so every feature carries `severity`, `color` and NHC's own `range`. This file
 * never parses a source field.
 *
 * Pure functions. Imports: config/ only.
 */

import { SURGE_RAMP } from '../config/tokens.js';

/**
 * The distinct surge severities present, deepest first.
 *
 * ==> THE LABEL RULE IS DECIDED FOR THE WHOLE LIST, NOT PER ROW, AND THAT WAS
 *     A CORRECTION. <== SPEC-DATA.md §4.8 settled that the colour is a BUCKET
 *     and the range is the FORECAST: NHC's red covers 5-10, 6-10 and 8-12 ft
 *     depending on the place, so a red row holding several ranges cannot
 *     honestly print any one of them and has to fall back to the ramp's own
 *     words. Deciding that per row is what the first version did, and measured
 *     against Milton advisory 017 it produced this list:
 *
 *         ● Above 12 ft   ● 8-12 ft   ● Up to 9 ft   ● Up to 6 ft   ● 1-3 ft
 *
 *     Rows two and three are two different KINDS of statement stacked on each
 *     other, and read together they look like overlapping depths in the wrong
 *     order. So: if every rung on this storm carries exactly one range, the
 *     list is NHC's ranges throughout — Edouard's yellow reach says "3-5 ft",
 *     which is the precise thing NHC published and worth more than "Up to
 *     6 ft". If any rung carries several, the list is the ramp's labels
 *     throughout, which is the only wording true of every feature in every
 *     bucket.
 *
 *     Neither is ever rewritten, re-rounded, or merged into a span. NHC's
 *     legend and NHC's forecast are both quoted; inventing "4-8 ft" to cover
 *     a bucket holding 4-7 and 5-8 would be this app forecasting a depth.
 *
 * @param {Array<object>} features normalized surge features.
 * @returns {Array<{severity:number, color:string, label:string, count:number}>}
 *   `count` is how many features sit on that rung — not rendered today, and
 *   carried because the caller needs to distinguish "one reach" from "eleven"
 *   without re-walking the collection.
 */
export function surgeLegend(features) {
  /** severity -> set of distinct non-empty ranges, plus a tally */
  const buckets = new Map();

  for (const f of features || []) {
    const sev = f?.properties?.severity;
    if (!Number.isInteger(sev) || sev < 0 || sev >= SURGE_RAMP.length) continue;
    if (!buckets.has(sev)) buckets.set(sev, { ranges: new Set(), count: 0 });
    const b = buckets.get(sev);
    b.count += 1;
    const range = f.properties.range;
    if (typeof range === 'string' && range.trim()) b.ranges.add(range.trim());
  }

  const useRanges = [...buckets.values()].every((b) => b.ranges.size === 1);

  return [...buckets.keys()]
    .sort((a, b) => b - a)
    .map((severity) => {
      const { ranges, count } = buckets.get(severity);
      return {
        severity,
        color: SURGE_RAMP[severity].color,
        label: useRanges ? [...ranges][0] : SURGE_RAMP[severity].label,
        count,
      };
    });
}
