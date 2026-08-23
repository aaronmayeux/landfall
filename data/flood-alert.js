/**
 * flood-alert.js (data) — ONE flood alert's own words, fetched when somebody
 * opens it. §56.6.
 *
 * ==> IT IS A SEPARATE FETCH FROM THE LIST ON PURPOSE, AND THE SPEC ASKED FOR
 * IT THIS WAY. <== `/api/nws/flood` drops `description` and `instruction` from
 * every alert because they are the entire payload: measured on the archived
 * national bytes, about 900 bytes of description and 100–750 of instruction per
 * alert, against roughly 70 bytes for everything else the list carries.
 * Widening the list would put two kilobytes an alert on every phone on every
 * poll for a field most readers never open. This asks for one alert, once,
 * when a panel opens.
 *
 * ==> THE MEMO IS KEYED ON THE ALERT ID AND NEVER EXPIRES WITHIN A SESSION.
 * <== A CAP URN carries a content hash, so the prose behind one id cannot
 * change — a corrected alert is issued under a new id. That makes an id a
 * permanent handle on one piece of text, exactly as it is a permanent handle
 * on one shape in `lib/flood-features.js`. Re-opening the same alert is free.
 *
 * ==> AND AN IN-FLIGHT REQUEST IS MEMOIZED TOO, NOT ONLY A FINISHED ONE. <==
 * Tapping the same chip twice while the first request is still out would fire
 * two. The promise goes in the map immediately, so the second tap awaits the
 * first request instead of starting another.
 *
 * ==> A FAILURE IS NOT MEMOIZED. <== Every other memo in this app holds what it
 * got; this one deletes a failed entry on the way out, because the panel offers
 * a Retry and a cached failure would make that button do nothing while looking
 * like it worked. Same call `data/rainfall.js` makes about its evictions.
 *
 * THE THREE STATES ARE KEPT APART (§5):
 *   unavailable  the fetch or the parse failed. Retryable, and the panel says
 *                so — it must never render as "this alert has no instructions".
 *   gone         NWS no longer has this alert. A real, durable fact about the
 *                alert rather than about the network, so no Retry is offered.
 *   ok           it answered. `instruction` may legitimately be null, which
 *                means the forecaster wrote none.
 *
 * Imports config/ only. No DOM, no ui/.
 */

import { ENDPOINT } from '../config/constants.js';

const url = (id) => `${ENDPOINT.relay}/nws/alert?id=${encodeURIComponent(id)}`;

/** id -> Promise of a settled record. See the header for why a failure is
 *  deleted rather than kept. */
const memo = new Map();

/** How many requests have actually gone out. See `floodAlertPulls`. */
let pulls = 0;

async function pull(id) {
  pulls++;
  let res;
  try {
    res = await fetch(url(id));
  } catch (e) {
    return { status: 'unavailable', reason: String(e?.message || e) };
  }

  /* ==> A 404 IS THE ALERT BEING GONE, WHICH IS NOT AN OUTAGE. <== The relay
   * distinguishes them and this keeps them apart, because one is worth a Retry
   * and the other is not. NWS drops an alert from its store a while after it
   * expires, so a reader holding a panel open across that moment hits this. */
  if (res.status === 404) return { status: 'gone' };

  if (!res.ok) return { status: 'unavailable', reason: `HTTP ${res.status}` };

  try {
    const body = await res.json();
    if (body?.error) return { status: 'unavailable', reason: body.error };
    return {
      status: 'ok',
      description: body.description || null,
      instruction: body.instruction || null,
      senderName: body.senderName || null,
    };
  } catch (e) {
    return { status: 'unavailable', reason: String(e?.message || e) };
  }
}

/**
 * One alert's prose. Resolves to a record, never throws, never rejects.
 *
 * @param {string} id the alert's CAP URN
 * @param {{retry?: boolean}} [opts] `retry` drops any held answer first, so a
 *   press genuinely goes back to the network rather than re-reading a memo.
 */
export function loadFloodAlertText(id, { retry = false } = {}) {
  if (!id) return Promise.resolve({ status: 'unavailable', reason: 'no id' });
  if (retry) memo.delete(id);

  const held = memo.get(id);
  if (held) return held;

  const p = pull(id).then((rec) => {
    /* A failure leaves nothing behind, so the Retry button has something to do.
     * `gone` IS kept: it is a durable fact and re-asking cannot change it. */
    if (rec.status === 'unavailable') memo.delete(id);
    return rec;
  });

  memo.set(id, p);
  return p;
}

/** Test seam. The module holds answers across calls. */
export function resetFloodAlertText() {
  memo.clear();
  pulls = 0;
}

/** Test seam — how many requests actually went out.
 *
 *  ==> IT COUNTS THE WORK, BECAUSE THE OBVIOUS TEST OF A MEMO CANNOT FAIL. <==
 *  Asserting that two calls return the same text passes with the memo deleted,
 *  since a second fetch returns the same bytes. §12's rule: a test agreeing
 *  with the bug is worse than no test. Nothing in the app reads this. */
export function floodAlertPulls() {
  return pulls;
}
