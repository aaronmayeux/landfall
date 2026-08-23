/**
 * view-flood-detail.js — one flood alert, as a DRAWER VIEW. SPEC-FLOOD-PLAN.md
 * §56.6.
 *
 * ==> DELIBERATELY SMALL, AND THE REASON IS THE SAME ONE `view-area-detail.js`
 * GIVES. <== A storm's panel is 1,900 lines because a storm has a cone, a
 * track, wind radii, watches, warnings, surge, model guidance and advisory
 * prose. A flood alert has FOUR FACTS — what it is, where it applies, when it
 * runs, and how long is left — and every one of them is already in the relay's
 * projection. Anything added here that the projection does not carry is
 * something this app invented.
 *
 * ==> WHICH IS WHY THERE IS NO ISSUING OFFICE ON IT, AND §56.6 USED TO SAY
 * THERE WOULD BE. <== Checked on the real route: `functions/api/nws/flood.js`
 * projects id, event, areaDesc, severity, urgency, onset, expires, ends,
 * geometry, drawable, zones and counties. **`senderName` is not among them.**
 * The office is not in hand, so this panel does not print one. Adding it is a
 * separate and deliberate decision about the projection, not something to slip
 * in here because a spec line named it by mistake.
 *
 * ==> THE PROSE IS FETCHED ONE ALERT AT A TIME, WHICH IS WHAT THAT NOTE SAID
 * TO DO. <== NWS ships a `description` and an `instruction` with every alert
 * and the relay drops both, because that projection takes 34,369 stored bytes
 * to 2,607 and a suite asserts the ratio. Widening the list would put roughly
 * two kilobytes an alert on every phone on every poll. So `/api/nws/alert`
 * serves ONE, `data/flood-alert.js` asks for it when this panel opens, and it
 * is memoized per id — a CAP URN carries a content hash, so the text behind one
 * id cannot change.
 *
 * ==> THE INSTRUCTION IS THE HALF THAT WAS MISSING AND IT LEADS. <== Until now
 * this app could say when a flood warning expired and not what to do about it.
 * NWS writes the actionable sentence in `instruction` — *This is a life
 * threatening situation*, *monitor later forecasts and be prepared to take
 * action* — and it is printed above the description, because somebody who
 * opened a hazard panel wants the instruction first and the meteorology second.
 *
 * ==> ALL THREE ASYNC STATES ARE EXPLICIT (§5). <== Loading says it is
 * checking; a failure says so and offers a Retry; `gone` — NWS dropping an
 * expired alert from its store — is a durable fact about the alert rather than
 * about the network, so it says so and offers NO retry. None of the three may
 * ever render as "this alert has no instructions".
 *
 * ==> IT IS REACHED TWO WAYS AND RENDERS ONE THING. <== A chip on the globe and
 * a row in the `Flooding` section both push this view with the same
 * `floodAlertFacts` object (`lib/rainfall.js`), which is the whole reason that
 * function was extracted. §56.6's rule is that an icon reachable only by
 * tapping the globe does not exist for a keyboard user — the rows are the
 * keyboard path, and they only satisfy it if they open the SAME panel.
 *
 * ==> THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency`. <== Measured on the
 * captured set: a Flood Watch reads `urgency: Future` with an `onset` four
 * hours in the PAST, because urgency describes when the HAZARD is expected and
 * onset describes when the MESSAGE took effect. `begun` is the comparison
 * against the reader's own moment and it is what this file reads.
 *
 * Imports `lib/` only. No DOM beyond its own host, no fetch, no clock of its
 * own — `app/views.js` hands down an already-normalized object.
 */

import { formatClockDay } from '../lib/time.js';
import { DOTS } from './loading-dots.js';
import { FLOOD_NOT_DRAWN, watchOrWarningMeans } from './flood-words.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The window, in the reader's own clock.
 *
 * ==> NEVER UTC, AND ON THIS FAMILY THAT IS NOT COSMETIC. <== These expire in
 * minutes — the captured Hilo warning ran fifty-two — so a time in the wrong
 * zone is the difference between "this is over" and "this has two hours to
 * run". `formatClockDay` is the app's one answer to that and it is the same
 * function the rows use, so the panel and the row it was opened from can never
 * print two different times for one alert.
 *
 * THREE SHAPES, AND EACH IS A DIFFERENT FACT: not yet started; running with a
 * known end; running with no end published — which is a real shape rather than
 * a gap, so it is stated rather than guessed at.
 */
function windowWords(a) {
  const until = a.untilMs ? formatClockDay(a.untilMs) : null;

  if (!a.begun && a.onsetMs) {
    return until
      ? `From ${formatClockDay(a.onsetMs)} until ${until}`
      : `From ${formatClockDay(a.onsetMs)}`;
  }
  if (a.immediate) {
    return until ? `In force until ${until}` : 'In force now, no end time given';
  }
  return until ? `Until ${until}` : 'No end time given';
}

export function createFloodDetailView({ text = null, onShowOnMap = null } = {}) {
  let host = null;
  let visible = false;
  let alert = null;

  /** The prose fetch's own record, and a sequence so a slow answer for the
   *  alert the reader has already navigated away from cannot land. */
  let textState = { phase: 'idle', result: null, forId: null };
  let textSeq = 0;

  /**
   * NWS's paragraphs → HTML, escaped.
   *
   * ==> THE RELAY ALREADY UNDID THE TELETYPE WRAPPING; THIS ONLY SPLITS
   * PARAGRAPHS. <== `unwrapNws` joins the ~66-column wraps and keeps the blank
   * lines, so what arrives is real paragraphs separated by a blank line and
   * bullet lines separated by a single one. Escaped first and marked up second,
   * which is the only safe order.
   */
  function proseHtml(t, cls) {
    return String(t)
      .split(/\n\n+/)
      .map((para) => `<p class="${cls}">${esc(para).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  /** The forecaster's own words, in four states (§5). */
  function textBody() {
    if (!alert?.id) return '';

    if (textState.phase !== 'done' || textState.forId !== alert.id) {
      return `<p class="detail-soft">Checking what the forecaster said${DOTS}</p>`;
    }

    const res = textState.result || { status: 'unavailable' };

    /* ==> GONE IS A FACT ABOUT THE ALERT, SO NO RETRY. <== NWS drops an alert
     * from its store a while after it expires. Pressing again cannot change
     * that, and a button that cannot work is worse than none. */
    if (res.status === 'gone') {
      return `<p class="detail-soft">The weather service no longer holds the full
        text of this alert.</p>`;
    }

    if (res.status !== 'ok') {
      /* NEVER silence, and never an implication that there were no
       * instructions. The fetch failing and the forecaster writing none are
       * opposite facts that would look identical as a blank (§5). */
      return `<p class="detail-soft">The full text couldn’t be loaded.</p>
        <button class="retry" type="button" data-retry="flood-text">Retry</button>`;
    }

    /* ==> THE INSTRUCTION LEADS. <== It is the actionable half and the reason
     * this fetch exists. A reader who opened a hazard panel wants what to do
     * before why. Null is real — not every product carries one — and is simply
     * absent rather than announced. */
    const instruction = res.instruction
      ? `<h3 class="flood-detail-sub">What to do</h3>
         ${proseHtml(res.instruction, 'flood-detail-instruction')}`
      : '';

    const description = res.description
      ? `<h3 class="flood-detail-sub">What the forecaster said</h3>
         ${proseHtml(res.description, 'flood-detail-desc')}`
      : '';

    return instruction + description;
  }

  function render() {
    if (!host) return;

    /* ==> A PANEL WITH NOTHING IN IT SAYS SO. <== Reachable: a poll can drop
     * an alert between the tap and the push. §5 — an empty body is the silence
     * this project forbids, and "nothing selected" is at least an honest
     * sentence about what happened. */
    if (!alert) {
      host.innerHTML =
        `<div class="drawer-body"><p class="list-note">No alert selected.</p></div>`;
      return;
    }

    /* HOW LONG IS LEFT, BESIDE WHEN IT ENDS AND NOT INSTEAD OF IT. A clock time
     * is what somebody plans against; a duration is what tells them whether to
     * move now. Omitted rather than faked when there is no end time. */
    const left = alert.remaining
      ? `<p class="flood-detail-left">${esc(alert.remaining)}</p>`
      : '';

    /* ==> THE AREA IS THE WHOLE POINT OF THIS PANEL AND IT IS NEVER SHORTENED.
     * <== The captured Flood Watch names thirteen zones and the Flash Flood
     * Warning names one. The reader is hunting this list for their OWN zone and
     * we do not know which one it is, so truncating it is how you hide it from
     * them. It is the reason a chip is worth tapping at all: the row on the map
     * says a hazard is here, and this says whether "here" includes you. */
    const area = alert.area
      ? `<h3 class="flood-detail-sub">Where it applies</h3>
         <p class="flood-detail-area">${esc(alert.area)}</p>`
      : `<p class="flood-detail-area flood-detail-area--none">The National Weather
           Service did not attach a list of areas to this alert.</p>`;

    /* ==> WHAT THE TWO WORDS MEAN, BECAUSE NOTHING IN THE PAYLOAD SEPARATES
     * THEM. <== A Flood Watch and a Flash Flood Warning are both
     * `severity: Severe` (§48.6). The whole app leans on the distinction — the
     * chip's shade, the row saying *in force*, a cluster counting as a warning
     * if it holds one — and all of it assumes a reader who already knows the
     * vocabulary. This is the one place that stops assuming. */
    const meaning = `<p class="flood-detail-means">${esc(
      watchOrWarningMeans(/watch/i.test(alert.event || ''))
    )}</p>`;

    /* ==> AN ALERT WITH NO SHAPE SAYS SO, OR THE READER HUNTS THE MAP FOR IT.
     * <== §56.4 resolves most watches to real boundaries, but a zone that did
     * not come back leaves an alert in force, listed here, and invisible on the
     * globe. Its absence would otherwise read as an all-clear (§5). */
    const notDrawn = alert.drawn === false
      ? `<p class="flood-detail-nodraw">${esc(FLOOD_NOT_DRAWN)}</p>`
      : '';

    /* ==> A WAY BACK TO THE MAP, BECAUSE HALF THE ENTRANCES DO NOT COME FROM
     * IT. <== A row in the `Flooding` section opens this panel without moving
     * the camera, so a reader arriving that way is reading about somewhere they
     * cannot see. The watched-area panel has always had this; this one is
     * catching up rather than inventing anything. Offered only when there IS a
     * shape to fly to — a button that cannot work is worse than none. */
    const showBtn = onShowOnMap && alert.drawn !== false && alert.id
      ? `<button class="flood-detail-show" type="button" data-show-on-map>Show on the globe</button>`
      : '';

    /* ==> THE OFFICE, WHICH §56.6 PROMISED AND COULD NOT DELIVER UNTIL NOW.
     * <== The relay did not project `senderName`; it does now. It matters
     * because a flood warning is a named forecaster's judgement about a
     * specific valley, and printing who made it is the difference between a
     * fact with an author and a number out of a machine. */
    const office = alert.senderName
      ? `<p class="flood-detail-source">Issued by ${esc(alert.senderName)}.
           Landfall reprints it and does not decide it.</p>`
      : `<p class="flood-detail-source">Issued by the US National Weather
           Service. Landfall reprints it and does not decide it.</p>`;

    host.innerHTML = `
      <div class="drawer-body">
        <h2 class="flood-detail-name" tabindex="-1">${esc(alert.event)}</h2>
        <p class="flood-detail-when">${esc(windowWords(alert))}</p>
        ${left}
        ${meaning}
        ${textBody()}
        ${area}
        ${notDrawn}
        ${showBtn}

        <!-- ==> THE PROVENANCE, BECAUSE THIS APP DID NOT DECIDE ANY OF IT.
             <== Every other number in this drawer is our arithmetic on a
             forecast. This panel is somebody else's published decision,
             reprinted, and the line that says so is what stops a reader
             treating the two as the same kind of claim. -->
        ${office}
      </div>
    `;
  }

  /**
   * Fetch this alert's prose if what we hold is not this alert's.
   *
   * ==> THE SEQUENCE IS WHY THIS IS NOT JUST AN `await`. <== A reader can tap a
   * chip, go back, and tap another before the first answer lands. Without the
   * guard the slow first answer would paint over the second alert's panel —
   * the same shape every other async section in this app uses.
   */
  async function ensureText() {
    if (!alert?.id || !text?.load) return;
    if (textState.forId === alert.id && textState.phase !== 'idle') return;

    const mySeq = ++textSeq;
    textState = { phase: 'loading', result: null, forId: alert.id };
    render();

    const result = await text.load(alert.id);
    if (mySeq !== textSeq) return; // the reader moved on mid-flight
    textState = { phase: 'done', result, forId: alert.id };
    render();
    wire();
  }

  /** Bind the two buttons inside an already-rendered panel. Re-bound after
   *  every render, because `innerHTML` replaced the elements they were on. */
  function wire() {
    const retry = host?.querySelector?.('[data-retry="flood-text"]');
    if (retry && text?.retry) {
      retry.addEventListener('click', async () => {
        if (!alert?.id) return;
        const mySeq = ++textSeq;
        textState = { phase: 'loading', result: null, forId: alert.id };
        render();
        wire();
        const result = await text.retry(alert.id);
        if (mySeq !== textSeq) return;
        textState = { phase: 'done', result, forId: alert.id };
        render();
        wire();
      });
    }

    const show = host?.querySelector?.('[data-show-on-map]');
    if (show && onShowOnMap) {
      show.addEventListener('click', () => onShowOnMap(alert));
    }
  }

  return {
    id: 'flood-alert',
    title: 'Flood alert',

    mount(el) {
      host = el;
      render();
    },

    /** The drawer passes the pushed argument straight through. */
    onEnter(arg) {
      visible = true;
      if (arg) alert = arg;
      render();
      /* ==> THE FETCH STARTS HERE AND NOWHERE ELSE. <== Not on construction,
       * not on a poll, not when the rows are drawn — only when somebody has
       * actually opened one alert. That is the whole reason the prose is off
       * the list. */
      ensureText();
      wire();
    },

    onLeave() {
      visible = false;
      /* ==> THE SEQUENCE IS BUMPED ON THE WAY OUT. <== An answer still in
       * flight when the reader leaves must not land on a panel they have
       * navigated away from — and must not leave `loading` behind for the next
       * alert to inherit. */
      textSeq++;
      textState = { phase: 'idle', result: null, forId: null };
    },

    /** ==> FIRST STOP IS THE HEADING, AND THE `tabindex="-1"` ON IT IS
     *  LOAD-BEARING. <== There is nothing actionable on this panel, so sending
     *  focus to a control means sending it to the drawer's own Back button and
     *  skipping the content entirely. An `<h2>` is not focusable by default, so
     *  `.focus()` on it is a silent no-op — and because this method returns a
     *  truthy element, the drawer's `|| backBtn` fallback would not fire
     *  either, leaving focus behind on whatever row launched it. -1 keeps the
     *  heading out of the Tab order while making it a legal focus target. That
     *  is the exact bug `ui/view-area-detail.js` records; this panel is the
     *  same shape and inherits the fix rather than rediscovering it. */
    focus() {
      return host?.querySelector('.flood-detail-name');
    },

    /** A poll landed.
     *
     *  ==> IT DOES NOT RE-RENDER, AND THAT IS THE PERFORMANCE DECISION IN THIS
     *  FILE. <== The drawer calls `update` on every registered view on every
     *  poll. §56.15's whole diagnosis was work landing on a path that runs
     *  whether or not anybody is looking at it, so this returns immediately
     *  unless this panel is the one on screen.
     *
     *  ==> AND WHAT IS ON SCREEN IS NEVER BLANKED UNDER SOMEBODY READING IT.
     *  <== The alert list turns over every three minutes and an alert can
     *  expire mid-read. §5's rule is that content is never replaced by an
     *  absence: the facts hold, and the countdown going stale is a smaller lie
     *  than an empty panel appearing under a reader who is deciding whether to
     *  move. `ui/view-area-detail.js` made the same call for the same reason. */
    update() {},

    isVisible: () => visible,
  };
}
