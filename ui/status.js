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
 * Imports nothing but the DOM it owns. Nothing in ui/ is imported by map/
 * or data/ — the arrow points one way.
 */

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

/** Clears the strip. Named separately because `setStatus(null)` at a call site
 *  reads like a bug. */
export function clearStatus() {
  setStatus(null);
}

/**
 * Source health → the strip's message, in human language, naming the failed
 * source (SPEC §5). Returns {message, tone} or null when everything is clean —
 * the strip is SILENT when there is nothing to say. Precedence against other
 * messages (tile errors, placeholder notices) is main.js's call, not ours.
 */
export function sourceHealthMessage(sources) {
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
  /* The relay served its last-good copy because NHC itself was down — data on
   * screen is real but aging. Named, never silent (SPEC §5). */
  if (sources.nhc.relayStale) {
    return { message: 'NHC feed delayed — showing last good data', tone: TONE.STALE };
  }
  return null;
}

export { TONE };
