/**
 * exposure-block.js — the at-home readouts, as HTML (SPEC §8).
 *
 * ==> A SEPARATE FILE FROM ui/view-home.js ON PURPOSE. <== That view is the
 * SETUP flow — geolocate, search, drop a pin, confirm — and it is already 639
 * lines of one subject. This is a different subject that happens to be shown on
 * the same screen: what the weather is doing to the address once it is set.
 * Bolting it on would push one file past §12's 700-line line while mixing a
 * flow with a readout, and the readout is the piece a second surface (the storm
 * detail panel) is most likely to want next.
 *
 * IT RENDERS AND NOTHING ELSE. No fetch, no state, no timers — a state object
 * in, a string out, plus one binder for the retry buttons. That is what makes
 * every sentence in here testable without a browser.
 *
 * ==> EVERY BRANCH HAS WORDS. THERE IS NO PATH THAT RENDERS NOTHING. <== Five
 * outcomes per row and they are worded to distinguish what is genuinely
 * different (§5):
 *
 *   loading       "Checking…"          we asked, still waiting
 *   unavailable   "…didn't load" + Retry     the fetch died. Never silence.
 *   none          "NHC has not published…"   the source answered with nothing
 *   clear         "No watches or warnings near home"   answered, and it is calm
 *   a result      the figure, with the product's own colour and its own words
 *
 * The two that look alike on a blank screen — "nothing in effect" and "we could
 * not reach NHC" — are the entire reason this file is written out longhand
 * instead of as a loop over rows.
 *
 * ==> WHAT IT MAY NOT SAY. <== NHC issues watches and warnings by county and
 * publishes coastal BREAKPOINT LINES, not the warned area. So no sentence here
 * claims home is inside a warning. It names the product and states the distance
 * to the warned coast, which is what the geometry supports. Surge is the one
 * exception and it is an exception because the shape is different: surge bands
 * are polygons, home is inside one or it is not, and the app can say so.
 *
 * MORE THAN ONE RETRY CAN BE ON SCREEN AT ONCE — surge and arrival can both
 * fail — so retries are bound BY CLASS, never by id (§8, learned the hard way
 * on the detail panel: binding one by id catches whichever comes first in the
 * document and leaves the rest dead).
 *
 * Imports config/ and lib/ only. No data/, no map/.
 */

import { UNITS } from '../config/constants.js';
import { formatDistance, formatBearing, surgeLegendMetric, resolveSystem } from '../lib/units.js';
import { formatAge } from '../lib/time.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/** Distance the way the rest of the app says it: user's units lead, the
 *  source's follow in parentheses (§8). Nautical miles stay as the footnote
 *  because the advisory text quotes them. */
const dist = (nm, sys) =>
  `${esc(formatDistance(nm, sys))} (${Math.round(nm).toLocaleString()} nm)`;

/** A row that failed, with its own retry. `data-retry` names WHICH slot, so a
 *  caller can retry one thing rather than the whole panel. */
const failedRow = (kicker, what, slot) => `
  <div class="detail-kicker">${esc(kicker)}</div>
  <div class="detail-soft">${esc(what)} didn’t load.</div>
  <button type="button" class="detail-retry exposure-retry" data-retry="${esc(slot)}">Retry</button>`;

const softRow = (kicker, text) => `
  <div class="detail-kicker">${esc(kicker)}</div>
  <div class="detail-soft">${esc(text)}</div>`;

/* ---------------------------------------------------------------------------
 * WATCHES AND WARNINGS
 * ------------------------------------------------------------------------- */

function wwHtml(ww, sys) {
  if (!ww) return '';
  switch (ww.state) {
    case 'idle':
    case 'loading':
      return softRow('Watches and warnings', 'Checking watches and warnings…');
    case 'unavailable':
      return failedRow('Watches and warnings', 'Watches and warnings', 'watchWarning');
    case 'none':
      /* The layer answered and this storm has none in effect anywhere. That is
       * NHC's answer, not ours, and it is said as NHC's answer. */
      return softRow('Watches and warnings', 'No watches or warnings in effect for this storm.');
    case 'clear':
      return softRow('Watches and warnings', 'No watches or warnings near home.');
    default:
      break;
  }

  /* ==> THE SWATCH IS THE PRODUCT'S OWN COLOUR, FROM §6.1, AND IT IS INLINE
   *     ON PURPOSE. <== The 111 NWS product colours are a fixed contract: a
   *     Hurricane Warning is the same red here as on television, because the
   *     reader is matching it against something they already saw. It cannot
   *     come from a CSS token — tokens are themed and this must not be — so it
   *     is set from the value `lib/watchwarning.js` read out of the contract.
   *     This is the documented exception to "zero hardcoded colour in feature
   *     code" (§9.1): the colour is not hardcoded here, it is carried here. */
  const swatch = ww.color
    ? `<span class="exposure-swatch" style="--swatch:${esc(ww.color)}"></span>`
    : '';

  const where =
    ww.state === 'at-home'
      ? 'for your area'
      : `${dist(ww.nm, sys)} ${esc(formatBearing(ww.bearing))}`;

  /* The lead is the SEVEREST product near home, not the nearest — a Hurricane
   * Warning 20 nm away outranks a Tropical Storm Watch 2 nm away, because the
   * headline has to be the worst thing being said about this address. */
  const rest = ww.others && ww.others.length
    ? `<div class="detail-soft">Also near home: ${ww.others
        .map((o) => `${esc(o.label)}, ${dist(o.nm, sys)}`)
        .join(' · ')}</div>`
    : '';

  return `
    <div class="detail-kicker">Watches and warnings</div>
    <div class="detail-figure exposure-lead">${swatch}${esc(ww.label)}</div>
    <div class="detail-soft">${where}${
      ww.state === 'at-home'
        ? ` — nearest warned coast ${dist(ww.nm, sys)}`
        : ''
    }</div>
    ${rest}`;
}

/* ---------------------------------------------------------------------------
 * SURGE
 * ------------------------------------------------------------------------- */

function surgeHtml(surge, sys) {
  if (!surge) return '';
  switch (surge.state) {
    case 'idle':
    case 'loading':
      return softRow('Storm surge', 'Checking peak storm surge…');
    case 'unavailable':
      return failedRow('Storm surge', 'Peak storm surge', 'surge');
    case 'none':
      return softRow('Storm surge', 'NHC has not published a peak surge forecast near this storm.');
    case 'outside':
      /* Deliberately states the distance. "Not in a band" alone reads as an
       * all-clear for the street; with a number beside it, a reader two miles
       * from the edge can see how close the water gets. */
      return softRow(
        'Storm surge',
        `Your address is not inside a published surge band. Nearest band ${formatDistance(surge.nm, sys)} away.`
      );
    default:
      break;
  }

  if (surge.state === 'near') {
    const named = surge.nearest && surge.nearest.label ? ` (${surge.nearest.label})` : '';
    return `
      <div class="detail-kicker">Storm surge</div>
      <div class="detail-soft">Just outside a surge band — ${dist(surge.nm, sys)} to the nearest${esc(named)}.</div>`;
  }

  if (surge.state === 'in-band-unclassified') {
    /* Standing in a published band whose depth class could not be read. The
     * one thing that must not happen is falling through to "not in a band";
     * the honest sentence names what is known and what is not. */
    return softRow(
      'Storm surge',
      'Your address is inside a published surge band. NHC’s depth class for it could not be read.'
    );
  }

  const band = surge.band;
  if (!band) return '';

  /* NHC'S OWN LEGEND TEXT, VERBATIM, with the metric conversion in
   * parentheses (§8). Rewriting an official legend is the same class of error
   * as curving official geometry. */
  const metric = resolveSystem(sys) === UNITS.METRIC ? surgeLegendMetric(band.label) : null;
  const place = band.name ? `<div class="detail-soft">${esc(band.name)}</div>` : '';

  return `
    <div class="detail-kicker">Storm surge <span class="detail-soft">peak, above ground</span></div>
    <div class="detail-figure exposure-lead"><span class="exposure-swatch" style="--swatch:${esc(band.color)}"></span>${esc(band.label)}${
      metric ? ` <span class="detail-soft">(${esc(metric)})</span>` : ''
    }</div>
    <div class="detail-soft">Your address is inside this band.</div>
    ${place}`;
}

/* ---------------------------------------------------------------------------
 * WIND ARRIVAL
 * ------------------------------------------------------------------------- */

function arrivalRow(label, a, sys) {
  if (!a) return '';
  if (a.state === 'idle') return '';
  if (a.state === 'loading') return `<dt>${esc(label)}</dt><dd>Checking…</dd>`;
  if (a.state === 'unavailable') return `<dt>${esc(label)}</dt><dd>Didn’t load</dd>`;
  if (a.state === 'none') return `<dt>${esc(label)}</dt><dd>Not published</dd>`;
  if (a.state === 'far') {
    return `<dt>${esc(label)}</dt><dd>No contour near home (nearest ${esc(formatDistance(a.nm, sys))})</dd>`;
  }
  /* NHC's own string, rendered as text and never parsed into a clock. A time
   * we cannot parse is still a time NHC wrote; a time we parse wrongly is a
   * lie with a clock face on it. */
  return `<dt>${esc(label)}</dt><dd>${esc(a.text)} <span class="detail-soft">contour ${esc(
    formatDistance(a.nm, sys)
  )} away</span></dd>`;
}

function arrivalHtml(arrival, sys) {
  if (!arrival) return '';
  const { likely, earliest } = arrival;

  const bothOut =
    (!likely || likely.state === 'idle') && (!earliest || earliest.state === 'idle');
  if (bothOut) return '';

  if (likely?.state === 'unavailable' && earliest?.state === 'unavailable') {
    return failedRow('Tropical-storm-force winds', 'Wind arrival times', 'arrival');
  }

  const rows = `${arrivalRow('Most likely', likely, sys)}${arrivalRow('Earliest reasonable', earliest, sys)}`;
  if (!rows) return '';

  /* BOTH NUMBERS, ALWAYS, AND IN THIS ORDER. "Earliest reasonable" is the
   * plan-by time — NHC's own guidance is to prepare for the earliest, not the
   * likeliest. Showing only the likely one deletes the safety margin the
   * product exists to publish; showing only the earliest reads as alarmism. */
  return `
    <div class="detail-kicker">Tropical-storm-force winds <span class="detail-soft">39 mph, arriving</span></div>
    <dl class="detail-vitals exposure-arrival">${rows}</dl>`;
}

/* ---------------------------------------------------------------------------
 * THE BLOCK
 * ------------------------------------------------------------------------- */

/**
 * One storm's exposure, as HTML.
 * @param {object} exposure  from lib/home-exposure.js
 * @param {string} sys       resolved unit system
 */
export function exposureHtml(exposure, sys) {
  if (!exposure) return '';

  /* ==> THE ADVISORY STAMP IS PART OF THE BLOCK, NOT A NICETY (§8). <== Every
   * figure above came out of one advisory, and "inside the Up to 9 ft band"
   * from a six-hour-old advisory is a different sentence from the same words
   * on a fresh one. This is the one screen where somebody may make a real
   * decision, so stale gets labelled stale. */
  const age = exposure.observedAt ? formatAge(exposure.observedAt) : null;

  return `
    <section class="exposure" data-storm="${esc(exposure.stormId || '')}">
      <h3 class="exposure-title">${esc(exposure.stormName || 'This storm')}${
        age ? ` <span class="detail-soft">advisory ${esc(age)}</span>` : ''
      }</h3>
      ${wwHtml(exposure.ww, sys)}
      ${surgeHtml(exposure.surge, sys)}
      ${arrivalHtml(exposure.arrival, sys)}
    </section>`;
}

/**
 * The whole at-home section, for every storm near home.
 *
 * @param {object} state  from data/home-threat.js
 * @param {string} sys    resolved unit system
 */
export function exposureSectionHtml(state, sys) {
  if (!state || state.status === 'no-home') return '';

  if (state.status === 'loading' && !state.exposures.length) {
    return `<div class="exposure-empty detail-soft">Checking what this means for home…</div>`;
  }

  if (!state.exposures.length) {
    /* NOT AN ALL-CLEAR ABOUT THE WEATHER. It is a statement about DISTANCE:
     * nothing is close enough to home for any of these products to be about
     * it. The storm list above is still the authority on what exists. */
    return `<div class="exposure-empty detail-soft">No storm is close enough to home for watches, surge or wind timing to apply.</div>`;
  }

  return state.exposures.map((e) => exposureHtml(e, sys)).join('');
}

/**
 * Wire every retry button in a host element. BY CLASS, never by id — surge and
 * arrival can both be failing at once and binding one id leaves the other
 * button dead (§8).
 *
 * @param {Element} host
 * @param {(slot:string) => void} onRetry
 */
export function bindExposureRetries(host, onRetry) {
  if (!host) return;
  for (const btn of host.querySelectorAll('.exposure-retry')) {
    btn.addEventListener('click', () => onRetry(btn.dataset.retry || null));
  }
}
