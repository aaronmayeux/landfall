/**
 * _emissions.js — what the Smithsonian weekly report says is coming OUT.
 *
 * Pure. No fetch, no DOM, no imports, per §3.
 *
 * ==> WHY THIS EXISTS. <== Seven things come out of a volcano and our feeds
 * distinguish three (`SPEC-GLOBES.md` §42.1.9). The ash advisories tell us
 * about ash and nothing else. The weekly report's NARRATIVE is the only text on
 * any feed that names gas-and-steam, lava, pyroclastic flows and lahars — and
 * we were downloading it and reading only the headline.
 *
 * **Gas and steam is the most common thing a volcano does, and it is white.**
 * Drawing a grey ash column over a volcano that is quietly steaming is the same
 * class of error as an all-clear during an outage (SPEC.md §5). This is the
 * field that stops it.
 *
 * ==> THE NARRATIVE ITSELF IS STILL NOT SHIPPED, AND THAT IS DELIBERATE. <==
 * It was, on the first Phase C deploy, and it cost ~26 KB of prose that nothing
 * renders — on a globe on a phone, where the performance lens is the overriding
 * one (§1). This function runs at the EDGE and ships a handful of short strings
 * instead. If a surface ever needs the prose itself, that is a decision to take
 * on its own merits, not a side effect of wanting the classification.
 *
 * ==> WHAT THIS IS NOT. <== It is not a height parser and it is not a direction
 * parser. Heights come from the ash advisories, which state one on every
 * advisory that reports ash — measured 10 of 10 on the live wire 2026-07-31, so
 * the long-standing "6 of 22" worry was counting the wrong channel. Directions
 * are stated in this prose but sit inside multi-clause sentences
 * (*"traveled 2 km down the Sat/Putih drainage on the W flank"*), and a
 * plausible-looking wrong bearing is worse here than no bearing at all.
 */

/**
 * Each class, with the phrasings actually observed in the 16–22 July and
 * 23–29 July 2026 issues. Order in the output is this order, so a caller can
 * rely on it without sorting.
 *
 * Two live details worth keeping rather than tidying away:
 *
 * 1. **`gas-and-stream`** — a typo for `gas-and-steam`, published live in the
 *    Rincón de la Vieja report for 23–29 July 2026. It is one letter and it
 *    would silently drop a steam classification. Matched deliberately.
 * 2. **`fountain` counts as lava with no `lava` next to it.** Kilauea's report
 *    says *"episodic fountaining"* for paragraphs before it says *"lava
 *    fountain"*, and on the day the eruption is only fountaining, the word
 *    `lava` can be absent from the sentence entirely.
 */
const CLASSES = [
  {
    id: 'ash',
    /* `ash-and-gas` and `gas-and-ash` are both live; so is bare `ash plume`,
     * `ash emission`, `ash cloud` and `ashfall`. */
    re: /\bash\b|\bashfall\b|\btephra\b/i,
  },
  {
    id: 'steam',
    re: /gas-and-str?eam|str?eam-and-gas|str?eam\s+plume|gas\s+plume|gas\s+emission|gas\s+release|white\s+plume|degassing|fumarol/i,
  },
  {
    id: 'lava',
    re: /\blava\b|\beffusi(?:on|ve)\b|\bfountain/i,
  },
  {
    id: 'pdc',
    /* `PDC` is the report's own abbreviation and appears without expansion
     * after its first use. */
    re: /pyroclastic|\bPDCs?\b/,
  },
  {
    id: 'lahar',
    re: /\blahars?\b/i,
  },
  {
    id: 'resuspended',
    /* Not an eruption. Wind lifting old deposits — Katmai's 1912 ash was in
     * the air on 24 July 2026 and nothing at Katmai was erupting. Same rule as
     * the ash advisories' `resuspended` flag (§42.1.9). */
    re: /resuspend|unconsolidated\s+ash|(?:originally|previously)\s+deposited/i,
  },
];

/**
 * Classify one report narrative.
 *
 * @param {string|null} text the weekly report body for one volcano
 * @returns {string[]} zero or more of
 *   `ash` `steam` `lava` `pdc` `lahar` `resuspended`, in that order
 *
 * **An empty array is a real answer and must not be read as "nothing is
 * happening"** (SPEC.md §5). Plenty of reports describe only seismicity,
 * deformation or an alert-level change — a volcano can be unmistakably
 * restless while emitting nothing at all. Absence of a class means the text did
 * not say so, never that the thing is not occurring.
 */
export function classifyEmissions(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const c of CLASSES) if (c.re.test(text)) out.push(c.id);
  return out;
}
