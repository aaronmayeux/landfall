/**
 * cap-storm.js (ui) — the "Local agency alerts" section of the storm detail
 * drawer. SPEC §50.5.
 *
 * A SELF-CONTAINED CONTROLLER, same shape as `ui/rain-storm.js` and
 * `ui/env-health.js`, because `ui/view-storm-detail.js` is past §12's file
 * ceiling and takes only seams now.
 *
 * ==> IT SHOWS THE AGENCY'S WORDS AND AN ENGLISH SENTENCE THAT IS NOT A
 * TRANSLATION OF THEM. <== §50.4. The English line is built entirely from
 * CAP's coded fields — severity, urgency, certainty — which mean the same
 * thing in every language. The agency's own `event` and `headline` are printed
 * verbatim below it, labelled with their language when it is not English. We
 * do not machine-translate a safety message we cannot check.
 *
 * ==> THE HEADER IS A WEAKER CLAIM THAN "THIS ALERT IS ABOUT THIS STORM". <==
 * §50.1. The match is by country, because the shapes are national outlines and
 * basin-sized boxes (§50.2). So the section says these agencies cover the
 * countries this storm is affecting and currently have a cyclone alert out —
 * which is true — and never that the alert was issued for this storm, which we
 * cannot know.
 *
 * ==> NOTHING HERE PAINTS. <== The globe's watch/warning stripe is §7.7 and is
 * NHC-only, for the reason above: a CAP area is an administrative polygon, and
 * a whole province shaded because a depression exists somewhere inside it is
 * a worse lie than an unpainted coast.
 *
 * Imports: lib/ and ui/ siblings, never data/ — the fetch arrives injected
 * (§12).
 */

import { alertsForStorm, plainEnglish, stormCountries } from '../lib/cap.js';
import { formatUntil } from '../lib/time.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CAP_SECTION = 'local-alerts';

/** Is this language tag English? CAP publishes RFC-5646 tags, so the archived
 *  rows read `en-CA`, `es` and `en` — the base subtag is the answer and the
 *  region is not. A missing tag is treated as English rather than labelled,
 *  because labelling text we have no evidence about would put a wrong
 *  language name under an agency's words. */
const isEnglish = (tag) => !tag || String(tag).toLowerCase().split('-')[0] === 'en';

/**
 * @param {{ loadAlerts: (opts?:object)=>Promise<object> }} deps
 *   injected by ui/view-storm-detail.js. ONE facade over `data/cap.js`, whose
 *   own cache makes every storm after the first one free.
 */
export function createCapStorm({ loadAlerts }) {
  let state = { phase: 'idle', slot: null, forId: null };
  let seq = 0;

  const isCurrent = (storm) => !!storm && state.forId === storm.id;

  /** One alert, as a block. The English line first because it is the line the
   *  reader can actually read; the agency's own words under it. */
  function alertHtml(alert, now) {
    const english = plainEnglish(alert);
    const words = alert.headline || alert.event;
    const langNote = isEnglish(alert.language)
      ? ''
      : `<span class="detail-cap-lang">${esc(alert.language)}</span>`;

    /* An expiry the reader can act on. `formatUntil` is the same helper the
     * rest of the drawer ages things with, so an alert and an advisory never
     * describe time two different ways. */
    const until = alert.expires != null ? formatUntil(alert.expires, now) : null;

    return `<div class="detail-cap-alert">
      ${english ? `<div class="detail-cap-english">${esc(english)}</div>` : ''}
      ${words ? `<div class="detail-cap-words" lang="${esc(alert.language || 'en')}">${esc(words)}${langNote}</div>` : ''}
      <div class="detail-cap-meta">${esc(alert.agency || 'An agency')}${
        alert.area ? ` · ${esc(alert.area)}` : ''
      }${until ? ` · ends ${esc(until)}` : ''}</div>
    </div>`;
  }

  /** The section body's inner HTML for the current state. Pure of the DOM. */
  function html(storm, now = Date.now()) {
    if (!storm) return '';

    /* ==> AN NHC STORM IS ANSWERED WITHOUT A FETCH, AND POINTED AT THE ANSWER
     * IT ALREADY HAS. <== §50.3. NHC storms carry a basin and no country, so
     * there is nothing to match on — but they are also the only storms whose
     * watches and warnings we DO paint, in "In effect" above and on the globe.
     * Saying "unavailable" here would be false; saying nothing would be
     * §5-silence. It says where the answer is. */
    if (storm.source !== 'gdacs') {
      return `<div class="detail-soft">The National Hurricane Center's own
        watches and warnings for this storm are in <strong>In effect</strong>
        above, and painted on the coast.</div>`;
    }

    if (!isCurrent(storm) || state.phase === 'idle' || state.phase === 'loading') {
      return `<div class="detail-soft">Checking national agencies${DOTS}</div>`;
    }

    const slot = state.slot || { state: 'unavailable' };

    if (slot.state !== 'ok') {
      /* OUR PROBLEM, WORDED AS OURS. The reader must not read a failed fetch
       * as "no country has warned anybody" (§5). */
      return `<div class="detail-soft">The list of national alerts didn't load,
        so there is nothing to show here. This does not mean no alert is in
        force.
        <button class="detail-retry" type="button" data-retry="local-alerts">Retry</button></div>`;
    }

    /* THE STORM IS OUT AT SEA. 35 of 98 storms in the archived GDACS list have
     * no country against them, and for those this is the truth rather than a
     * gap — no agency has claimed the storm because it is not near anyone. */
    if (!stormCountries(storm).length) {
      return `<div class="detail-soft">No country is currently listed as
        affected by this storm, so there are no national alerts to look up.</div>`;
    }

    const mine = alertsForStorm(slot.alerts, storm);

    /* ANSWERED, AND NOTHING MATCHED. Completely different from the failure
     * above and worded so (§50.6). */
    if (!mine.length) {
      return `<div class="detail-soft">No national weather agency in the
        affected countries currently has a tropical cyclone alert in force.</div>`;
    }

    const stale = slot.stale
      ? `<div class="detail-cap-note">Showing the last list we could fetch — it
         may be out of date.</div>`
      : '';

    return `${stale}${mine.map((a) => alertHtml(a, now)).join('')}
      <div class="detail-cap-note">Issued by national weather agencies for the
      countries this storm is affecting — not by the forecast centre tracking
      it, and not necessarily about this storm. Wording is each agency's own
      and is not translated.</div>`;
  }

  /**
   * Dispatch the feed fetch if what we hold is not this storm's.
   *
   * Cheap to call on every render — the guard makes it idempotent and
   * `data/cap.js` holds one list for every storm, so stepping between storms
   * costs nothing after the first.
   */
  async function ensure(storm, repaint) {
    if (!storm || storm.source !== 'gdacs') return;
    if (isCurrent(storm) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', slot: null, forId: storm.id };
    const slot = await loadAlerts();
    if (mySeq !== seq) return; // a newer storm took over mid-flight
    state = { phase: 'done', slot, forId: storm.id };
    repaint?.();
  }

  /** Bind the retry inside an already-rendered body. `data-retry` scopes the
   *  button so the host view's geometry retry binding never collects it. */
  function wire(bodyEl, storm, repaint) {
    const btn = bodyEl?.querySelector?.('[data-retry="local-alerts"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!storm) return;
      const mySeq = ++seq;
      state = { phase: 'loading', slot: null, forId: storm.id };
      repaint?.();
      const slot = await loadAlerts({ retry: true });
      if (mySeq !== seq) return;
      state = { phase: 'done', slot, forId: storm.id };
      repaint?.();
    });
  }

  return { html, ensure, wire };
}
