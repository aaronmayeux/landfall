/**
 * view-flood-alert.js — one NWS flood alert, as a DRAWER VIEW. SPEC §56.6.
 *
 * ==> IT IS THE OTHER END OF TWO DIFFERENT ROADS, AND THAT IS THE WHOLE
 * REASON IT IS A PANEL RATHER THAN AN EXPANDER. <== A chip tapped on the globe
 * and a row pressed in the `Flooding` section have to arrive at the SAME
 * thing. An in-row expander cannot be opened from the map, and a popup on the
 * map cannot be opened from a keyboard — so the one surface both can reach is
 * a drawer panel, which is also the surface this app already knows how to make
 * focusable, dismissable and back-navigable.
 *
 * ==> IT SHOWS WHAT THE RELAY ALREADY CARRIES AND NOT ONE FIELD MORE. <==
 * §56.6 is explicit: do not widen the relay projection to bring NWS's
 * `description` and `instruction` across. That projection takes the national
 * alert list from tens of kilobytes to a couple, and putting the prose back
 * blows it on every phone for a field most readers never open. If this panel
 * reads thin on glass the answer is to fetch that ONE alert on demand — never
 * to widen the list.
 *
 * ==> AND §56.6 NAMED ONE FIELD THE RELAY DOES NOT ACTUALLY CARRY. <== It
 * lists "the issuing office" among what is already in hand. It is not:
 * `functions/api/nws/flood.js` projects id, event, areaDesc, severity,
 * urgency, onset, expires, ends, geometry, drawable, zones and counties, and
 * `senderName` is not among them. Rather than widen the projection inside a
 * phase that was not about the relay, this panel does not print an office and
 * §56.6 has been corrected to match what is built. **Adding it is a small,
 * separate change and it is Aaron's to call.**
 *
 * ==> THE WORDING IS `lib/rainfall.js`'s, NOT A SECOND COPY. <== The row in
 * the section and this panel run the same alert through the same
 * `floodAlerts()`, so "in force until 6:00 PM" cannot say one thing in the
 * list and another in the detail. That function also filters by expiry, which
 * is why an alert that ran out while the panel was open renders as ended
 * rather than as a live warning nobody has revisited.
 *
 * Imports config/ and lib/. Never data/ or map/ (§12) — the alert arrives as
 * the drawer's pushed argument.
 */

import { NWS_US_ONLY } from './flood-words.js';
import { floodAlerts } from '../lib/rainfall.js';
import { formatClockDay } from '../lib/time.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {{ now?: () => number }} [deps]
 */
export function createFloodAlertView({ now = () => Date.now() } = {}) {
  let host = null;
  let alert = null;
  let visible = false;

  /**
   * The alert as the list words it, or null when it has run out.
   *
   * `floodAlerts` takes and returns an array because that is how both sections
   * use it; one row in, one row out.
   */
  const derived = () => (alert ? floodAlerts([alert], now())[0] || null : null);

  function body() {
    if (!alert) return '<p class="detail-soft">No alert selected.</p>';

    const d = derived();

    /* ==> AN EXPIRED ALERT IS SAID, NOT BLANKED. <== §5: content is never
     * replaced by an absence. Somebody reading this panel when the warning
     * runs out needs to be told it has ended — closing the panel under them,
     * or leaving the old times up as though they were live, are both worse
     * than one plain sentence. The name stays, because that is what they came
     * here to read about. */
    if (!d) {
      return `
        <h2 class="flood-alert-name" tabindex="-1">${esc(alert.event || 'Flood alert')}</h2>
        <p class="flood-line">This alert has ended.</p>
        <p class="flood-note">${esc(NWS_US_ONLY)}</p>`;
    }

    /* THE SAME THREE SHAPES THE ROW USES, for the same reason: already running
     * with a known end, not yet started, or running with no end published —
     * which is a real shape rather than a gap and is stated as one. */
    const started = d.begun
      ? d.onsetMs
        ? `Began ${esc(formatClockDay(d.onsetMs))}`
        : 'In force now'
      : d.onsetMs
        ? `Begins ${esc(formatClockDay(d.onsetMs))}`
        : 'Not yet in force';

    const ending = d.untilMs
      ? `Ends ${esc(formatClockDay(d.untilMs))}`
      : /* NOT "unknown" AND NOT LEFT OFF. NWS publishes some products with no
         * end time, which is a fact about the product rather than a hole in
         * our data, and a reader planning around it has to know which. */
        'No end time published';

    const left = d.remaining
      ? `<p class="flood-alert-left">${esc(d.remaining)} left</p>`
      : '';

    /* WHOLE AND UNSHORTENED. The reader is hunting for their own zone in this
     * list — the captured Flood Watch names thirteen — and truncating it is
     * how you hide it from them. */
    const area = d.area
      ? `<div class="detail-kicker">Where it applies</div>
         <p class="flood-alert-area">${esc(d.area)}</p>`
      : '';

    /* ==> WHETHER IT IS ON THE MAP, SAID OUT LOUD. <== §5. A reader who
     * arrived here from the section rather than from the globe has no way to
     * tell whether this alert is one of the shapes in front of them. A watch
     * whose zone boundaries never came back (§56.4) is exactly the alert that
     * is invisible on the map, and it is the one where the absence matters. */
    const drawn = alert.geometry
      ? ''
      : `<p class="flood-note">This alert was issued by zone and its boundary
           could not be fetched, so it is not drawn on the globe.</p>`;

    return `
      <h2 class="flood-alert-name" tabindex="-1">${esc(d.event)}</h2>
      <p class="flood-alert-when">${started} &middot; ${ending}</p>
      ${left}
      ${area}
      ${drawn}
      <p class="flood-note">${esc(NWS_US_ONLY)}</p>`;
  }

  function render() {
    if (!host) return;
    host.innerHTML = `<div class="flood-alert-detail">${body()}</div>`;
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

    /** ==> THE HEADING, AND IT CARRIES `tabindex="-1"` FOR A REASON THE AREA
     *  PANEL LEARNT THE HARD WAY. <== An `<h2>` is not focusable by default,
     *  so `.focus()` on it is a silent no-op — and because this method returns
     *  a truthy element the drawer's `|| backBtn` fallback never fires either.
     *  The result is a panel that opens with focus left behind on whatever row
     *  or chip launched it, which for the keyboard reader is the panel not
     *  opening at all. */
    focus() {
      return host?.querySelector('.flood-alert-name');
    },

    /** A poll landed. Nothing to do: an alert is a fixed statement with an
     *  expiry, not a figure that gets revised — NWS issues a NEW alert rather
     *  than editing one. What DOES move is whether it is still in force, and
     *  `derived()` reads the clock on every render, so re-rendering is enough.
     */
    update() {
      if (visible) render();
    },

    isVisible: () => visible,
  };
}
