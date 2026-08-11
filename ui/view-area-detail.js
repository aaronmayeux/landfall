/**
 * view-area-detail.js — one watched area, as a DRAWER VIEW. SPEC §45.
 *
 * ==> DELIBERATELY SMALL, AND IT WILL STAY SMALL. <== The storm detail view is
 * 1,300 lines because a storm has a cone, a track, wind radii, watches,
 * warnings, surge, model guidance and advisory prose. A watched area has SIX
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
 * Atlantic" — is OURS; NHC publishes no name for these areas. So the centroid
 * and NHC's own basin word are printed here as the checkable facts underneath
 * the description we computed.
 *
 * Imports config/ and lib/. Never data/ or map/ (§12) — main.js wires the
 * camera in through the drawer's argument.
 */

import { GENESIS } from '../config/constants.js';
import { genesisColor, formatPercent, isStaleArea } from '../lib/genesis.js';
import { BASIN_LABEL } from '../lib/basin.js';
import { formatAge } from '../lib/time.js';
/* Moved to lib/units.js when the storms list needed the same formatter at a
 * coarser precision (§12). Tenths here: this panel is stating where an area
 * IS, and that is what the centroid of a fuzzy region can honestly carry. */
import { formatCoords } from '../lib/units.js';

const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * One horizon's row.
 *
 * THREE OUTCOMES, AND THEY ARE THREE DIFFERENT SENTENCES (§5). A probability
 * of 40% is a number. A probability of 0% is the source saying "not in this
 * window" and is printed as `0%`, not hidden. A missing field is "not stated"
 * — NHC left it blank — and printing that as `0%` would put a forecast in the
 * source's mouth. The first draft of `parsePercent` returning 0 for a missing
 * value is exactly the bug this row is shaped to expose.
 */
function horizonRow(label, prob, risk) {
  const value = prob == null ? 'Not stated' : formatPercent(prob);
  const word = prob == null ? '' : ` · ${risk.charAt(0)}${risk.slice(1).toLowerCase()}`;
  return `
    <div class="area-horizon">
      <span class="area-horizon-label">${esc(label)}</span>
      <span class="area-horizon-value">${esc(value)}${esc(word)}</span>
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
    const swatch = genesisColor(jtwc ? area.risk : area.globeRisk);

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

    host.innerHTML = `
      <div class="drawer-body">
        <div class="area-head">
          <span class="row-swatch watch-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
          <div class="area-head-text">
            <h2 class="area-name">${esc(area.title)}</h2>
            <p class="area-source">${esc(area.source)}${
              isStaleArea(area) ? ' · <span class="area-stale">update overdue</span>' : ''
            }</p>
          </div>
        </div>

        <div class="area-horizons">${horizons}</div>

        <p class="area-stamp">${esc(issued)}</p>

        <!-- ==> THE PROVENANCE BLOCK. The name above is OURS. <==
             NHC publishes no name for these areas — the source gives a basin
             word, four probability strings and a date. "Central Atlantic" is a
             description computed from the centroid, so the centroid and the
             source's own word are printed here as the facts a reader can check
             it against. Do not let the heading above drift into anything that
             sounds like an official designation. -->
        <dl class="area-facts">
          <dt>Centre of the area</dt>
          <dd>${esc(formatCoords(area.centroid?.lon, area.centroid?.lat))}</dd>
          ${
            area.sourceBasin
              ? `<dt>Basin, as the source names it</dt><dd>${esc(area.sourceBasin)}</dd>`
              : ''
          }
          ${
            area.basin
              ? `<dt>Basin, as this app files it</dt><dd>${esc(BASIN_LABEL[area.basin] || area.basin)}</dd>`
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
     *  own Back button and skipping the content entirely. */
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
