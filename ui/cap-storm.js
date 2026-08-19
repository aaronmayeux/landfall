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
 * ==> NOTHING IN THIS FILE PAINTS, BUT THE ALERTS DO. <== §50.9. The stripe
 * is drawn by `map/layers/cap-coast.js`, which bands a CAP area onto the
 * coastline through the same selector and the same widths as §7.7's NHC one —
 * so the polygon never reaches the globe as a polygon. What that layer paints
 * and what this section lists differ on purpose: only alerts IN FORCE reach
 * the coast, while a cancellation is worth reading and appears here.
 *
 * Imports: lib/ and ui/ siblings, never data/ — the fetch arrives injected
 * (§12).
 */

import { alertKey, alertsForStorm, isInForce, plainEnglish, stormCountries } from '../lib/cap.js';
import { formatUntil } from '../lib/time.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A short, DOM-safe id from an alert key.
 *
 *  ==> THE KEY ITSELF CANNOT BE AN `id`. <== It is built from an agency name,
 *  an event name and an area description — real values contain spaces,
 *  accents, commas and a NUL separator, and `aria-controls` takes an id
 *  reference, not arbitrary text. A hash is stable across repaints, which is
 *  all `aria-controls` needs it to be. */
function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export const CAP_SECTION = 'local-alerts';

/** Is this language tag English? CAP publishes RFC-5646 tags, so the archived
 *  rows read `en-CA`, `es` and `en` — the base subtag is the answer and the
 *  region is not. A missing tag is treated as English rather than hidden,
 *  because collapsing text we have no evidence about would put an agency's
 *  words behind a tap on the strength of a guess. */
const isEnglish = (tag) => !tag || String(tag).toLowerCase().split('-')[0] === 'en';

/** The language's name in English, for the disclosure's label — "Spanish
 *  wording", not "es wording".
 *
 *  ==> `Intl.DisplayNames` IS THE PLATFORM'S TABLE, NOT OURS. <== Shipping a
 *  language-name list would be a few hundred rows every visitor downloads to
 *  render one label. Every browser this app supports has had this since 2021.
 *  It is still wrapped, because a runtime that lacks it must degrade to the
 *  raw tag rather than throw inside a render. */
function languageName(tag) {
  if (!tag) return null;
  try {
    const base = String(tag).split('-')[0];
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(base);
    /* `of()` echoes the input back for a tag it does not know, which would
     * print "es wording" — no better than the tag alone, so say nothing. */
    return name && name.toLowerCase() !== base.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ loadAlerts: (opts?:object)=>Promise<object> }} deps
 *   injected by ui/view-storm-detail.js. ONE facade over `data/cap.js`, whose
 *   own cache makes every storm after the first one free.
 */
export function createCapStorm({ loadAlerts }) {
  let state = { phase: 'idle', slot: null, forId: null };
  let seq = 0;

  /** Which alerts the reader has opened, by `alertKey`.
   *
   *  ==> IN MEMORY, AND DELIBERATELY NOT PERSISTED. <== The drawer's own
   *  sections remember their collapsed state across sessions because a section
   *  is a permanent fixture with a stable name. An alert is not: it expires,
   *  the agency reissues it, and the list is different tomorrow. A stored key
   *  would accumulate forever and match nothing. It survives a repaint, which
   *  is the only thing it has to survive — otherwise the retry button or the
   *  next poll would silently close what the reader just opened. */
  const expanded = new Set();

  /** DOM id -> alert key, so the markup never has to carry the key itself.
   *  Rebuilt on every render, which is also what keeps it from growing: the
   *  ids in it are exactly the ids currently on screen. */
  const keyById = new Map();

  const isCurrent = (storm) => !!storm && state.forId === storm.id;

  /** One alert, as a block. The English line leads because it is the line the
   *  reader can actually read; the agency's own words are behind a chevron
   *  when they are not in English (§50.4). */
  function alertHtml(alert, now) {
    const english = plainEnglish(alert);
    const words = alert.headline || alert.event;
    const key = alertKey(alert);

    /* An expiry the reader can act on. `formatUntil` is the same helper the
     * rest of the drawer ages things with, so an alert and an advisory never
     * describe time two different ways. */
    const until = alert.expires != null ? formatUntil(alert.expires, now) : null;

    const meta = `<div class="detail-cap-meta">${esc(alert.agency || 'An agency')}${
      alert.area ? ` · ${esc(alert.area)}` : ''
    }${until ? ` · ends ${esc(until)}` : ''}</div>`;

    /* ==> ENGLISH TEXT GETS NO CHEVRON. <== The disclosure exists to keep a
     * language the reader cannot read from leading the block. PAGASA writes in
     * English, so hiding its words behind a tap would cost a reader the one
     * line that names the hazard and buy nothing. */
    if (!words) return `<div class="detail-cap-alert">${english ? `<div class="detail-cap-english">${esc(english)}</div>` : ''}${meta}</div>`;

    if (isEnglish(alert.language)) {
      return `<div class="detail-cap-alert">
        ${english ? `<div class="detail-cap-english">${esc(english)}</div>` : ''}
        <div class="detail-cap-words">${esc(words)}</div>
        ${meta}
      </div>`;
    }

    const open = expanded.has(key);
    /* ==> THE DOM CARRIES THE HASH, NEVER THE KEY. <== The key is built from
     * the agency name, the event name and the area description — the agency's
     * own untranslated words. Put in a `data-` attribute they are out of the
     * visible half but still in the markup, which is the same text in a place
     * nobody thought about. The id is enough to find the row again; the
     * mapping lives in JS. `tools/test-cap.mjs` asserts the leak stays shut. */
    const id = String(Math.abs(hashKey(key)));
    keyById.set(id, key);
    const name = languageName(alert.language);
    /* THE LABEL NAMES WHAT IS BEHIND IT. "Spanish wording" tells a reader both
     * that there is more and that they may not be able to read it — which is
     * the honest offer, since we are not translating it (§50.4). */
    const label = name ? `${name} wording` : 'The agency’s own wording';
    const bodyId = `cap-words-${id}`;

    return `<div class="detail-cap-alert">
      ${english ? `<div class="detail-cap-english">${esc(english)}</div>` : ''}
      <button class="detail-cap-toggle" type="button"
              aria-expanded="${open}" aria-controls="${bodyId}"
              data-cap-toggle="${id}">
        <span class="detail-cap-toggle-label">${esc(label)}</span>
        <span class="detail-cap-chevron" aria-hidden="true"></span>
      </button>
      <div class="detail-cap-words" id="${bodyId}" lang="${esc(alert.language)}"
           ${open ? '' : 'hidden'}>${esc(words)}</div>
      ${meta}
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

    /* ==> NO COUNTRY IS TWO DIFFERENT SITUATIONS AND THEY MUST NOT SHARE A
     * SENTENCE. <== §50.12. The match runs on GDACS's `affectedcountries`, so
     * a storm with none is unmatchable — but WHY that matters depends entirely
     * on whether any agency has an alert out at all.
     *
     * MEASURED 2026-08-19, every hourly snapshot in the archive window: GDACS
     * carried three live storms and attributed a country to exactly ONE, the
     * American one. Saudel (17W) and Hernán carried none in any snapshot,
     * while PAGASA had a Tropical Cyclone Alert in force for Tropical
     * Depression Neneng. Neneng is NOT either of them — it is one of the
     * Philippine-basin invests, and GDACS lists no live storm for it at all,
     * which is the harsher of the two ways this join fails. Either way both
     * unattributed storms rendered an all-clear during an hour an agency was
     * warning somebody.
     *
     * The 63-of-98 figure this branch used to cite counts every row in the
     * list including ENDED storms, which is where the countries accumulate.
     * Among storms actually live it was one in three. */
    if (!stormCountries(storm).length) {
      const loose = (slot.alerts || []).filter((a) => isInForce(a, now)).length;

      /* NOTHING IS IN FORCE ANYWHERE. The old wording, and here it is the
       * whole truth: no country is listed, and there is nothing we would have
       * found even if one were. */
      if (!loose) {
        return `<div class="detail-soft">No country is currently listed as
          affected by this storm, so there are no national alerts to look up,
          and no agency anywhere has a cyclone alert in force right now.</div>`;
      }

      /* ==> A GAP, AND IT SAYS SO IN THOSE WORDS. <== The count is of alerts
       * in force WORLDWIDE, not near this storm — we cannot narrow it, which
       * is precisely the thing being reported. Claiming one of them covers
       * this storm would be the causal assertion §50.5 forbids; staying
       * silent would be §5. So it states what is missing and stops. */
      const n = loose === 1
        ? 'One national cyclone alert is in force elsewhere in the world, and\n        we can\u2019t tell whether it covers'
        : `${loose} national cyclone alerts are in force elsewhere in the
        world, and we can\u2019t tell whether any of them covers`;
      return `<div class="detail-soft">No country is listed as affected by this
        storm yet, so we can't look up national alerts for it. ${n}
        this storm. <strong>This is a gap in what we know, not an
        all-clear.</strong></div>`;
    }

    const mine = alertsForStorm(slot.alerts, storm);
    /* Cleared per render so the id map holds only what is on screen. */
    keyById.clear();

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

  /** Bind the retry and the wording disclosures inside an already-rendered
   *  body. `data-retry` scopes the button so the host view's geometry retry
   *  binding never collects it. */
  function wire(bodyEl, storm, repaint) {
    /* ==> THE DISCLOSURE FLIPS THE DOM IN PLACE AND DOES NOT REPAINT. <== A
     * repaint rebuilds the section from `html()`, which throws away the
     * reader's scroll position — the same reason every section in this drawer
     * has its own render function. Opening a line of text is not a state
     * change worth redrawing a panel for. `expanded` is still updated so the
     * open state survives a repaint driven by something else. */
    for (const btn of bodyEl?.querySelectorAll?.('[data-cap-toggle]') || []) {
      btn.addEventListener('click', () => {
        const key = keyById.get(btn.getAttribute('data-cap-toggle'));
        if (!key) return;
        const words = bodyEl.querySelector(`#${CSS.escape(btn.getAttribute('aria-controls'))}`);
        const next = !expanded.has(key);
        if (next) expanded.add(key); else expanded.delete(key);
        btn.setAttribute('aria-expanded', String(next));
        if (words) words.hidden = !next;
      });
    }

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
