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
 * ==> AND THE PROSE IS NOT FETCHED EITHER. <== NWS ships a `description` and an
 * `instruction` with every alert, and the relay drops both: that projection
 * takes 34,369 stored bytes down to 2,607 and a suite asserts the ratio.
 * Putting them back would blow that on every phone, on every poll, for a field
 * most readers never open. If this panel reads thin on glass the answer is to
 * fetch the ONE alert on demand — never to widen the list.
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

export function createFloodDetailView() {
  let host = null;
  let visible = false;
  let alert = null;

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
      : `<p class="flood-detail-area flood-detail-area--none">The agency did not
           attach a list of areas to this alert.</p>`;

    host.innerHTML = `
      <div class="drawer-body">
        <h2 class="flood-detail-name" tabindex="-1">${esc(alert.event)}</h2>
        <p class="flood-detail-when">${esc(windowWords(alert))}</p>
        ${left}
        ${area}

        <!-- ==> THE PROVENANCE, BECAUSE THIS APP DID NOT DECIDE ANY OF IT.
             <== Every other number in this drawer is our arithmetic on a
             forecast. This panel is somebody else's published decision,
             reprinted, and the line that says so is what stops a reader
             treating the two as the same kind of claim. It also carries the
             one honest limit of the whole layer (§56.19): NWS is a United
             States agency, so a reader watching a typhoon gets an empty globe
             from this switch, and the note on the switch is not the only place
             that should be sayable. -->
        <p class="flood-detail-source">Issued by the US National Weather
          Service. Landfall reprints it and does not decide it.</p>
      </div>
    `;
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
    },

    onLeave() {
      visible = false;
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
