/**
 * view-area-detail.js — one watched area, as a DRAWER VIEW. SPEC §45.
 *
 * ==> DELIBERATELY SMALL, AND IT WILL STAY SMALL. <== The storm detail view is
 * 1,300 lines because a storm has a cone, a track, wind radii, watches,
 * warnings, surge, model guidance and advisory prose. A watched area has FIVE
 * FACTS and no geometry beyond the polygon already on the globe. Anything
 * added here that a storm's panel does not already own is almost certainly an
 * invention — there is no advisory to quote, no forecast track to draw, and no
 * intensity to chart, because the thing being described does not exist yet.
 *
 * IT EXISTS FOR ONE REASON: TO BE THE HONEST HOME OF THE TWO-DAY NUMBER.
 * §45.6's decision put only the SEVEN-day figure on the globe, because the
 * polygon is the seven-day area and a two-day number on it would be a lie. The
 * drawer row shows the two-day figure only once it is above zero. This panel
 * is where BOTH horizons are always stated, including a genuine "0%" and a
 * genuine "not stated", which are different facts and must not look alike.
 *
 * IT ALSO CARRIES THE PROVENANCE FOR THE NAME. The row's title — "Central
 * Atlantic" — is OURS; NHC publishes no name for these areas. The CENTROID is
 * printed here as the checkable fact underneath the description we computed,
 * and it is the right one, because the description is computed from it.
 *
 * Imports config/ and lib/. Never data/ or map/ (§12) — main.js wires the
 * camera in through the drawer's argument.
 */

import { GENESIS } from '../config/constants.js';
import { genesisColor, formatPercent, isStaleArea } from '../lib/genesis.js';
import { BASIN_LABEL } from '../lib/basin.js';
import { formatAge } from '../lib/time.js';

const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A coordinate as a person reads it: `12.6°N 36.3°W`. Whole tenths — the
 *  centroid of a fuzzy region does not deserve four decimal places, and
 *  printing them would imply a precision the polygon never had. */
function coords({ lon, lat }) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/**
 * One horizon's row.
 *
 * THREE OUTCOMES, AND THEY ARE THREE DIFFERENT SENTENCES (§5). A probability
 * of 40% is a number. A probability of 0% is the source saying "not in this
 * window" and is printed as `0%`, not hidden. A missing field is "not stated"
 * — NHC left it blank — and printing that as `0%` would put a forecast in the
 * source's mouth. The first draft of `parsePercent` returning 0 for a missing
 * value is exactly the bug this row is shaped to expose.
 *
 * THE FIGURE AND THE WORD ARE SEPARATE ELEMENTS because they are different
 * kinds of fact and want different type. The percentage is a measurement and
 * carries tabular figures so 0%, 40% and 100% stack in one column; the risk
 * word is prose and sits quieter beside it. Rendered as one string they came
 * out in a single face, which made "Not stated" look like a value from a
 * machine rather than a sentence about a blank field.
 */
function horizonRow(label, prob, risk) {
  const value = prob == null ? 'Not stated' : formatPercent(prob);
  const word = prob == null ? '' : `${risk.charAt(0)}${risk.slice(1).toLowerCase()}`;
  return `
    <div class="area-horizon">
      <span class="area-horizon-label">${esc(label)}</span>
      <span class="area-horizon-value">${esc(value)}${
        word ? `<span class="area-horizon-risk">${esc(word)}</span>` : ''
      }</span>
    </div>`;
}

export function createAreaDetailView() {
  let host = null;
  let visible = false;
  let area = null;

  function render() {
    if (!host) return;
    if (!area) {
      host.innerHTML = `<div class="drawer-body"><p class="list-note">Nothing selected.</p></div>`;
      return;
    }

    const jtwc = area.source === 'JTWC';
    /* `globeRisk ?? risk` is THE idiom for "what risk is this area", used
     * identically in map/layers/genesis.js and map/watch-marks.js. It was a
     * branch on the source name here, which is behaviourally the same and one
     * more place that has to be remembered when a source is added — the patch
     * layer had its own third spelling and drew every JTWC area as LOW for it. */
    const swatch = genesisColor(area.globeRisk ?? area.risk);

    /* JTWC AND NHC GET DIFFERENT BODIES, NOT ONE BODY WITH BLANKS. JTWC
     * publishes a word over 24 hours and no percentage at all; rendering it
     * through the two-horizon layout would print "Not stated" twice under a
     * source that stated its answer perfectly clearly, which reads as a
     * failure rather than as a different vocabulary (§45.3). */
    const horizons = jtwc
      ? `<div class="area-horizon">
           <span class="area-horizon-label">${esc(GENESIS.HORIZON.jtwc)}</span>
           <span class="area-horizon-value">${esc(
             area.risk.charAt(0) + area.risk.slice(1).toLowerCase()
           )}</span>
         </div>`
      : horizonRow(GENESIS.HORIZON.twoDay, area.prob2day, area.risk2day) +
        horizonRow(GENESIS.HORIZON.sevenDay, area.prob7day, area.risk7day);

    /* THE STAMP IS THE PUBLISHER'S, NOT THE PHONE'S (§17.7). `idp_filedate`
     * for NHC, the WMO header's date-time group for JTWC. A missing stamp says
     * so rather than falling back to "now", which would make every area look
     * freshly published. */
    const issued = Number.isFinite(area.issuedAt)
      ? `Published ${formatAge(new Date(area.issuedAt).toISOString())}`
      : 'Publication time not stated';

    /* ==> THE FORECASTER'S OWN WORDS, WHEN THERE ARE ANY. <== NHC's outlook
     * KMZ attaches the discussion paragraph to the polygon it describes, so
     * this is the one place in the feature where a reader learns WHY an area
     * is on the board rather than only how likely it is. It is printed
     * verbatim: never trimmed to a sentence, never summarised, because a
     * paraphrase of a forecast is a forecast we wrote.
     *
     * The two formation-chance lines at the end are DROPPED, and only those.
     * They restate the two rows already sitting directly above this paragraph,
     * in a second vocabulary — printing them again gives a reader two numbers
     * to reconcile that were always the same number.
     *
     * ABSENT IS SILENT, NOT EMPTY. JTWC areas have no discussion at all, and
     * an NHC document may arrive without one; a heading over nothing reads as
     * a section that failed to load (§5). */
    const body = area.discussion
      ? area.discussion
        .split('\n')
        .filter((line) => !/^\s*\*?\s*Formation chance/i.test(line))
        .join('\n')
        .trim()
      : '';
    /* ==> THE HEADING NAMES WHOSE WORDS THESE ARE, NOT WHAT THEY ARE ABOUT.
     * <== Repeating the area's name here would be the third time it appears in
     * one panel. What the paragraph actually needs labelling is its
     * PROVENANCE: everything above this point is figures, the standing note
     * below it is ours, and without a heading the forecaster's prose simply
     * starts mid-panel with nothing marking the change of voice.
     *
     * JTWC areas have no discussion, so the heading appears with the paragraph
     * or not at all — a heading over nothing reads as a section that failed to
     * load (§5). */
    const discussion = body
      ? `<h3 class="area-discussion-head">${esc(GENESIS.DISCUSSION_HEAD)}</h3>
         <p class="area-discussion">${esc(body)}</p>`
      : '';

    host.innerHTML = `
      <div class="drawer-body area-detail">
        <div class="area-head">
          <span class="row-swatch watch-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
          <div class="area-head-text">
            <h2 class="area-name" tabindex="-1">${esc(area.title)}</h2>
            <p class="area-source">${esc(area.source)}${
              isStaleArea(area) ? ' · <span class="area-stale">update overdue</span>' : ''
            }</p>
          </div>
        </div>

        <div class="area-horizons">${horizons}</div>

        <p class="area-stamp">${esc(issued)}</p>
${discussion}

        <!-- ==> THE PROVENANCE BLOCK. The name above may be OURS. <==
             NHC publishes no name for these areas — the source gives a basin
             word, four probability strings and a date. "Central Atlantic" is a
             description computed from the centroid, so the centroid is printed
             here as the fact a reader can check it against. Do not let the
             heading above drift into anything that sounds like an official
             designation.

             ==> ONE BASIN ROW, AND IT IS OURS. <== This was two rows: NHC's
             own word and the app's filing, side by side. They are IDENTICAL
             for every Atlantic area by construction, so the pair read as
             pointless duplication almost all the time — and in the one case
             they do differ, ours is strictly the better answer. NHC files the
             entire ocean under "Pacific"; this app splits it at 140°W into
             East and Central Pacific, the same boundary CPHC works to. Showing
             both put a vaguer word beside a sharper one and made the reader
             decide which to believe.

             The source's word is NOT discarded — sourceBasin still rides on
             every area and the outlook arbiter groups by it, so each basin is
             judged against its own bulletin (data/genesis.js). It is simply
             not a row on this panel any more. What checks our filing is the
             centroid directly above it, which is what the filing is computed
             from in the first place.

             (No backticks in this comment. It sits inside a template literal,
             so one would close the string and the module would stop parsing —
             which is exactly what happened while writing it.) -->
        <dl class="area-facts">
          <dt>Center of the area</dt>
          <dd class="area-coords">${esc(coords(area.centroid))}</dd>
          ${
            area.basin
              ? `<dt>Basin</dt><dd>${esc(BASIN_LABEL[area.basin] || area.basin)}</dd>`
              : ''
          }
        </dl>

        <p class="area-note">
          This is an area being watched for development, not a storm. Nothing has
          formed here yet, and it may not.
        </p>

        <!-- ==> THE OTHER HALF OF KEEPING THE JTWC CIRCLE HONEST. <==
             JTWC states a position and no extent, so the shape on the globe is
             ours — a circle at the mean size of NHC's real published areas
             (GENESIS.jtwcRadiusDeg). A drawn boundary reads as a measurement,
             and this one is not one, so the panel says so in words rather than
             leaving the edge to imply something nobody published. NHC areas
             get no such line, because theirs is a real polygon. -->
        ${
          jtwc
            ? `<p class="area-note area-note-shape">JTWC gives a position for this
                 system, not an outline. The shape drawn on the globe is
                 indicative — it marks roughly where and how large a watched
                 area is, not a boundary anyone has published.</p>`
            : ''
        }
      </div>
    `;
  }

  return {
    id: 'area',
    title: 'Being watched',

    mount(el) {
      host = el;
      render();
    },

    /** The drawer passes the pushed argument straight through. */
    onEnter(arg) {
      visible = true;
      if (arg) area = arg;
      render();
    },

    onLeave() {
      visible = false;
    },

    /** First stop is the heading — there is nothing actionable on this panel,
     *  so sending focus to a control would mean sending it to the drawer's
     *  own Back button and skipping the content entirely.
     *
     *  THE HEADING CARRIES `tabindex="-1"` AND IT IS LOAD-BEARING. An <h2> is
     *  not focusable by default, so `.focus()` on it is a silent no-op — and
     *  because this method returned a truthy element, the drawer's
     *  `|| backBtn` fallback never fired either. The result was a panel that
     *  opened with focus left behind on whatever row launched it. -1 keeps the
     *  heading out of the Tab order while making it a legal focus target. */
    focus() {
      return host?.querySelector('.area-name');
    },

    /** A poll landed. The area may have been republished with new numbers, or
     *  may have gone entirely — NHC drops a region the moment it develops or
     *  fizzles. A REPUBLISHED AREA UPDATES IN PLACE; A VANISHED ONE KEEPS ITS
     *  LAST KNOWN FIGURES rather than blanking the panel under someone who is
     *  reading it (§5: content is never replaced by an absence). */
    update(state) {
      if (!area) return;
      const next = state?.genesis?.areas?.find((a) => a.id === area.id);
      if (next) {
        area = next;
        render();
      }
    },

    isVisible: () => visible,
  };
}
