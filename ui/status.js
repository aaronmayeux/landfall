/**
 * status.js — the status strip (SPEC §16).
 *
 * Top edge. Source health, stale flags, "GDACS is not responding."
 * SILENT WHEN EVERYTHING IS CLEAN. Chrome earns its pixels or it goes.
 *
 * Rules this file enforces:
 *   - Human language only. Never raw exception text.
 *   - Errors surface near their source. FEED-level errors live here;
 *     LAYER errors live on the layer (SPEC §4). This is not a catch-all.
 *   - aria-live="polite" on the container, so a screen reader announces a
 *     source going down without interrupting whatever is being read.
 *
 * Imports `RELAY_AGE` and otherwise nothing but the DOM it owns. Nothing in
 * ui/ is imported by map/ or data/ — the arrow points one way.
 */

import { RELAY_AGE } from '../config/constants.js';

const TONE = Object.freeze({
  INFO: 'info',
  STALE: 'stale',
  ERROR: 'error',
});

let chip = null;

function el() {
  if (!chip) chip = document.getElementById('status-chip');
  return chip;
}

/**
 * Shows a message in the status strip.
 *
 * @param {string|null} message - null or empty hides the strip entirely.
 * @param {'info'|'stale'|'error'} [tone]
 */
export function setStatus(message, tone = TONE.INFO) {
  const node = el();
  if (!node) return;

  if (!message) {
    node.dataset.visible = 'false';
    /* Text is cleared AFTER the fade so it doesn't visibly empty first.
     * Matches --duration-base. */
    setTimeout(() => {
      if (node.dataset.visible === 'false') node.textContent = '';
    }, 240);
    return;
  }

  node.textContent = message;
  node.dataset.tone = tone;
  node.dataset.visible = 'true';
}

/* `clearStatus()` used to live here as a friendlier spelling of
 * `setStatus(null)`. Nothing ever called it: the strip has exactly one writer
 * now — main.js's arbiter — and that writer clears by rendering the quiet case,
 * not by calling out to a second function. Retired rather than kept "in case",
 * because an exported helper with no callers reads as a supported way to do
 * something and invites a second writer onto a strip that must only have one. */

/**
 * How long since we last successfully reached this source's upstream, in ms,
 * or null when there is no usable timestamp.
 *
 * A MISSING OR UNPARSEABLE STAMP IS NOT A DELAY. It is an unknown, and an
 * unknown must not raise an alarm — a strip that shouts at a parse failure is
 * a strip people learn to ignore, which costs us the one outage it exists for.
 * A negative age (clock skew between the datacentre that stamped and the phone
 * that read) is clamped to zero rather than treated as a fault.
 */
function sourceAgeMs(slot, now) {
  const ms = Date.parse(slot?.fetchedAt || '');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, now - ms);
}

/** Is this source's copy old enough to say so? */
function isDelayed(slot, now) {
  const age = sourceAgeMs(slot, now);
  return age != null && age > RELAY_AGE.delayedAfter;
}

/**
 * Source health → the strip's message, in human language, naming the failed
 * source (SPEC §5). Returns {message, tone} or null when everything is clean —
 * the strip is SILENT when there is nothing to say. Precedence against other
 * messages (tile errors, placeholder notices) is main.js's call, not ours.
 */
export function sourceHealthMessage(sources, now = Date.now()) {
  const nhcDown = sources.nhc.status === 'unavailable';
  const gdacsDown = sources.gdacs.status === 'unavailable';

  if (nhcDown && gdacsDown) {
    return { message: 'Storm feeds are not responding', tone: TONE.ERROR };
  }
  if (nhcDown) {
    return {
      message: 'NHC is not responding — Atlantic and East Pacific storms may be missing',
      tone: TONE.ERROR,
    };
  }
  if (gdacsDown) {
    return {
      message: 'GDACS is not responding — Northwest Pacific and Indian Ocean storms may be missing',
      tone: TONE.ERROR,
    };
  }

  /* ==> DELAY IS JUDGED BY AGE, NEVER BY `relayStale`. <== That flag used to
   * mean "upstream failed and this is the last good copy", and it was the right
   * thing to shout about. It does not mean that any more: both storm-list
   * routes now hand over an expired copy IMMEDIATELY and refresh behind the
   * response, on purpose, on a healthy feed — so the flag covers a routine
   * 31-minute-old cache alongside a genuine NOAA outage and cannot tell them
   * apart. It still reads honestly on the storm detail panel ("served from
   * cache"), where it is a fact rather than an alarm.
   *
   * Age is true whichever code path served the bytes, and it is the same
   * question on both sources.
   *
   * ==> THAT SECOND HALF IS ONLY TRUE BECAUSE BOTH STAMPS NOW COME FROM THE
   *     RELAY. <== `data/gdacs.js` used to mint its own from the device clock,
   *     which is always zero seconds old — so every branch below was
   *     unreachable for GDACS and NHC was silently the only feed that could
   *     trip this banner. Both sources read `X-Landfall-Fetched-At` now. If a
   *     third source is ever added, that is the thing to check first: a stamp
   *     taken on the device makes this whole function a no-op for it, and it
   *     fails quietly and looks perfect.
   *
   * BOTH DELAYED IS ITS OWN MESSAGE. Two stacked strips is not a thing this
   * component can show, and naming only one of two dead feeds is worse than
   * naming neither. */
  const nhcLate = isDelayed(sources.nhc, now);
  const gdacsLate = isDelayed(sources.gdacs, now);

  if (nhcLate && gdacsLate) {
    return { message: 'Storm feeds delayed — showing last good data', tone: TONE.STALE };
  }
  if (nhcLate) {
    return { message: 'NHC feed delayed — showing last good data', tone: TONE.STALE };
  }
  if (gdacsLate) {
    return { message: 'GDACS feed delayed — showing last good data', tone: TONE.STALE };
  }
  return null;
}

export { TONE };
