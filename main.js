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

export { TONE };
