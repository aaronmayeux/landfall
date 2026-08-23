/**
 * rain-alerts.js (ui) — flood warnings in force, as rows. SPEC §48.6, §48.16.
 *
 * ==> EXTRACTED BECAUSE IT IS USED TWICE. <== §12's rule: any pattern used
 * twice gets pulled out BEFORE the second use. It is the `Flooding` section's
 * row on both screens now (§56.7) — the home dashboard's and the storm
 * drawer's. Two copies of a warning row is two places for "Immediate" to stop
 * meaning "happening now", and the one that drifts is the one nobody is
 * looking at.
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
 * One row: what it is, where it applies, and how long it has to run.
 *
 * ==> THE URGENCY IS IN THE WORDS NOW, NOT IN THE COLOUR. <== These shipped as
 * filled rows with a red name for `Immediate` and an amber one for everything
 * else, and Aaron's verdict on glass was that the highlight and the colour
 * shifts read as decoration rather than as information — two tinted boxes in
 * the middle of a section of plain prose, competing with the Saffir-Simpson dot
 * a few inches above.
 *
 * ==> BUT §48.6's RULE SURVIVED THE RESTYLE, WHICH IS THE WHOLE POINT. <== A
 * Flood Watch and a Flash Flood Warning are BOTH `Severe`, so severity cannot
 * separate them; `urgency` is what does, and "happening now" must never read
 * the same as "later today". Deleting the colour without replacing the signal
 * would have quietly deleted the distinction as well. So `Immediate` says *in
 * force* in the sentence itself, which survives a stylesheet, a screen reader
 * and a colour-blind reader — none of which the red ever did on its own.
 *
 * ==> THE AREA IS THE LINE THAT WAS MISSING (§56.7). <== A warning with no
 * area attached asks the reader to assume it is about them. On the flood
 * family that is the one assumption worth not making: the captured Flood Watch
 * covers thirteen named zones and the Flash Flood Warning covers one. Printed
 * WHOLE and never shortened — the reader is hunting for their own zone in that
 * list, and truncating it is how you hide it from them.
 *
 * ==> AND THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency`. <== The
 * captured Flood Watch reads `urgency: Future` with an `onset` four hours in
 * the PAST, because the urgency is about when the HAZARD is expected and the
 * onset is about when the MESSAGE took effect. `begun` is the comparison
 * against the reader's own moment; see `lib/rainfall.js` `floodAlerts()`.
 *
 * `data-urgency` stays on the element. Nothing paints off it any more, but it
 * is what `tools/test-rainfall.mjs` asserts against, and an attribute is the
 * cheapest place for a test to find a fact that the prose also carries.
 */
function alertRow(a) {
  const until = a.untilMs ? formatClockDay(a.untilMs) : null;

  /* THREE SHAPES, AND EACH ONE IS A DIFFERENT FACT. Already running with a
   * known end; not yet started; running with no end published — which is a
   * real shape rather than a gap, so it is stated rather than guessed at. */
  const when = !a.begun && a.onsetMs
    ? (until
      ? `from ${formatClockDay(a.onsetMs)} until ${until}`
      : `from ${formatClockDay(a.onsetMs)}`)
    : a.immediate
      ? (until ? `in force until ${until}` : 'in force now, no end time given')
      : (until ? `until ${until}` : 'no end time given');

  /* HOW LONG IS LEFT, beside when it ends and not instead of it. A clock time
   * is what somebody plans against; a duration is what tells them whether to
   * move now. Omitted rather than faked when there is no end time. */
  const left = a.remaining ? `<span class="rain-alert-left">${esc(a.remaining)}</span>` : '';

  const area = a.area
    ? `<p class="rain-alert-area">${esc(a.area)}</p>`
    : '';

  const body = `<p class="rain-alert-head">
      <span class="rain-alert-name">${esc(a.event)}</span>
      <span class="rain-alert-until">${esc(when)}</span>
    </p>
    ${area}${left}`;

  /* ==> WITH AN ID THE ROW IS A BUTTON, AND THAT IS §56.6's KEYBOARD PATH.
   * <== The map draws a chip per alert and a tap on it opens the detail. An
   * icon reachable only by tapping the globe DOES NOT EXIST for a keyboard
   * user — §10 — so this row opens the same panel, by Tab and Enter, with no
   * pointer anywhere near it. A phase that shipped the chip without this would
   * have shipped a gesture-only feature.
   *
   * ==> WITHOUT ONE IT STAYS INERT, RATHER THAN BECOMING A BUTTON THAT OPENS
   * NOTHING. <== The relay always sends an id, so this is the belt to that
   * braces: a control that looks pressable and does nothing is worse than
   * plain text, and it is worse specifically for the reader using the keyboard,
   * who cannot tell by looking that the press was swallowed.
   *
   * The `<li>` keeps `data-urgency` either way — `tools/test-rainfall.mjs`
   * asserts against it, and an attribute is the cheapest place for a test to
   * find a fact the prose also carries. */
  const inner = a.id
    ? `<button type="button" class="rain-alert-open" data-flood-alert="${esc(a.id)}">${body}</button>`
    : body;

  return `<li class="rain-alert" data-urgency="${a.immediate ? 'now' : 'later'}">
    ${inner}
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
