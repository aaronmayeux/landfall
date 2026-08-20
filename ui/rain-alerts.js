/**
 * rain-alerts.js (ui) — flood warnings in force, as rows. SPEC §48.6, §48.16.
 *
 * ==> EXTRACTED BECAUSE IT IS NOW USED TWICE. <== §12's rule: any pattern used
 * twice gets pulled out BEFORE the second use. The home dashboard's Rain
 * section (§48.8) had this inline and the storm drawer's house block (§48.17)
 * needed exactly the same rows. Two copies of a warning row is two places for
 * "Immediate" to stop meaning "happening now", and the one that drifts is the
 * one nobody is looking at.
 *
 * ==> A WARNING IS A DIFFERENT KIND OF THING FROM A TOTAL, AND LOOKS LIKE IT.
 * <== §48.6. A flood warning is a fact about NOW, published by somebody else,
 * with an expiry attached; a total is our arithmetic on a forecast. Given the
 * same styling they read as one list of similar things and the one that matters
 * loses. So these are bordered rows with their own ink, and the number is prose
 * underneath them.
 *
 * ==> THE EXPIRY IS IN THE READER'S OWN CLOCK, NEVER UTC. <== These expire in
 * minutes — Hilo's ran out 52 minutes after it was issued — so a time in the
 * wrong zone is not a cosmetic error here, it is the difference between "this
 * is over" and "this has two hours to run".
 *
 * Imports: lib/ and ui/ siblings only. No DOM, no fetch, no clock of its own —
 * the expiry filtering happens in `lib/rainfall.js` `floodAlerts()`, which is
 * handed a moment somebody can choose.
 */

import { formatClockDay } from '../lib/time.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * One row: what it is, and when it runs out.
 *
 * `data-urgency` and not severity — a Flood Watch and a Flash Flood Warning are
 * BOTH `Severe`, so the word cannot separate them. `Immediate` is happening,
 * `Expected` and `Future` are not, and the two must not read the same.
 */
function alertRow(a) {
  const until = a.untilMs ? `until ${formatClockDay(a.untilMs)}` : 'no end time given';
  return `<li class="rain-alert" data-urgency="${a.immediate ? 'now' : 'later'}">
    <span class="rain-alert-name">${esc(a.event)}</span>
    <span class="rain-alert-until">${esc(until)}</span>
  </li>`;
}

/**
 * The whole block, or '' when nothing is in force.
 *
 * ==> AN EMPTY LIST IS NOT A CLAIM. <== '' here means "nothing to draw", never
 * "nothing is in force" — the difference between those two is `alertsKnown`
 * (§48.16), and it belongs to the caller because the SENTENCE about it differs
 * between the two surfaces. This function only ever draws what it was given.
 *
 * @param {Array} alerts already filtered and sorted by `lib/rainfall.js`
 *   `floodAlerts()` — expired ones removed, immediate ones first.
 */
export function floodAlertRows(alerts) {
  if (!alerts?.length) return '';
  return `<ul class="rain-alerts">${alerts.map(alertRow).join('')}</ul>`;
}
