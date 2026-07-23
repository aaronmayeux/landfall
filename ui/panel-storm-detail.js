/**
 * panel-storm-detail.js — the storm detail panel (SPEC §16).
 *
 * Replaces the storm LIST in the same slot, back button top-left. One panel
 * open at a time is enforced by main.js wiring — this file only manages its
 * own contents.
 *
 * Structure rules it implements:
 *  - Identity and the timestamp PIN to the top; the body scrolls under them.
 *    You must never lose track of which storm and how old while reading.
 *  - The timestamp is the load-bearing element: three freshness bands
 *    (fresh / aging / stale, thresholds in FRESHNESS), and a SEPARATE
 *    geometry line that exists only when the MapServer lags the feed by more
 *    than one advisory cycle — silence means synchronized.
 *  - Nulls are omitted, not zeroed. A missing pressure row is honest;
 *    "0 mb" is a lie.
 *  - Native unit first, converted in parentheses (knots is what NHC says).
 *  - Sections collapse per user, persisted (STORAGE_KEY.sections).
 *  - Watch/warning wording: "None in effect" vs "Watches and warnings
 *    unavailable" are two different strings, by design. Never "advisory".
 *  - Storm leaves the feed while open → the reduced ghost form in place:
 *    identity, last-known vitals, the notice. No home block, no toggles.
 *
 * Imports: config/, lib/ only. Home and geometry arrive through injected
 * facades from main.js — ui/ never imports data/ (SPEC §12).
 */

import { FRESHNESS, STORAGE_KEY } from '../config/constants.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, formatUntil, formatClockDay, ageMs } from '../lib/time.js';
import {
  formatWind, formatSpeed, formatDistance, formatPressure, formatBearing,
} from '../lib/units.js';
import { wwLegend } from '../lib/watchwarning.js';

/* --- small helpers --------------------------------------------------------- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "Hurricane · Category 2" — the second identity line. Trusts NHC's own
 *  label for what kind of thing it is (§4); derives only the number. */
function natureLine(storm) {
  const n = storm.nature;
  if (n === 'post-tropical') return 'Post-Tropical Cyclone';
  if (n === 'potential') return 'Potential Tropical Cyclone';
  if (n === 'remnant') return 'Remnant Low';
  const sub = n === 'subtropical';
  if (storm.category == null) return sub ? 'Subtropical Cyclone' : 'Tropical Cyclone';
  if (storm.category === 0) return sub ? 'Subtropical Depression' : 'Tropical Depression';
  if (storm.category === 1) return sub ? 'Subtropical Storm' : 'Tropical Storm';
  return `Hurricane · Category ${storm.category - 1}`;
}

function positionText(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const la = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}

/** Advisory string out of the advisoryKey ("nhc:al052026:12A" → "12A"). */
function advFromKey(key) {
  const parts = String(key || '').split(':');
  return parts.length >= 3 ? parts[2] : null;
}

/* --- section collapse persistence ------------------------------------------ */

function readSections() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY.sections)) || {}; }
  catch { return {}; }
}
function writeSections(s) {
  try { localStorage.setItem(STORAGE_KEY.sections, JSON.stringify(s)); } catch { /* session-only */ }
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root                #panel-detail
 * @param {() => void}  opts.onBack              back to the storm list
 * @param {object}      opts.home                injected: {get, distanceTo, closestApproach}
 * @param {(on:boolean) => void} opts.onToggleForecastTimes
 * @param {() => boolean}        opts.getForecastTimesOn
 * @param {(storm) => void}      opts.onRetryGeometry
 */
export function createStormDetailPanel({
  root, onBack, home, onToggleForecastTimes, getForecastTimesOn, onRetryGeometry,
}) {
  let open = false;
  let storm = null;        // last-known storm object (survives feed exit → ghost)
  let ghost = false;
  let geo = { state: 'idle' }; // 'idle'|'loading'|'ok'|'error', bundle?, error?
  let collapsed = readSections();

  root.innerHTML = `
    <header class="panel-head detail-head">
      <button class="panel-close detail-back" type="button" aria-label="Back to storm list">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <div class="detail-identity" id="detail-identity"></div>
    </header>
    <div class="detail-stamp" id="detail-stamp"></div>
    <div class="panel-body detail-body" id="detail-body"></div>
  `;
  const identityEl = root.querySelector('#detail-identity');
  const stampEl = root.querySelector('#detail-stamp');
  const bodyEl = root.querySelector('#detail-body');
  root.querySelector('.detail-back').addEventListener('click', () => onBack());

  /* --- render pieces ------------------------------------------------------- */

  function renderIdentity() {
    identityEl.innerHTML = `
      <div class="detail-name">
        <span class="row-swatch" style="background:${categoryColor(storm.category, storm.nature)}"></span>
        <h1 class="panel-title">${esc(storm.name)}</h1>
      </div>
      <div class="detail-nature">${esc(natureLine(storm))}</div>
    `;
  }

  function renderStamp() {
    const a = ageMs(storm.observedAt);
    const band =
      a == null ? 'stale'
      : a <= FRESHNESS.freshUntil ? 'fresh'
      : a <= FRESHNESS.agingUntil ? 'aging'
      : 'stale';
    const adv = advFromKey(storm.advisoryKey);
    const clock = formatClockDay(storm.observedAt);
    const age = formatAge(storm.observedAt);
    const line = [
      adv ? `Advisory ${esc(adv)}` : null,
      clock ? `${esc(clock)}${age ? ` (${esc(age)})` : ''}` : null,
    ].filter(Boolean).join(' · ');

    /* Geometry line exists ONLY when lagged — silence means synchronized. */
    let geoLine = '';
    if (geo.state === 'ok' && geo.lagged && geo.bundle?.stamp) {
      const gAdv = geo.bundle.stamp.advisnum;
      const gAge = formatAge(geo.bundle.stamp.filedate);
      geoLine = `<div class="detail-stamp-geo">Cone and tracks from ${
        gAdv ? `advisory ${esc(gAdv)}` : 'an earlier advisory'
      }${gAge ? ` · ${esc(gAge)}` : ''}</div>`;
    }
    stampEl.dataset.band = band;
    stampEl.innerHTML = `<div>${band === 'stale' ? '⚠ ' : ''}${line || 'No timestamp'}</div>${geoLine}`;
  }

  function section(id, title, innerHtml) {
    const isCollapsed = !!collapsed[id];
    return `
      <section class="detail-section" data-section="${id}" data-collapsed="${isCollapsed}">
        <button class="detail-section-head" type="button" aria-expanded="${!isCollapsed}">
          <h2>${esc(title)}</h2>
          <span class="detail-chevron" aria-hidden="true"></span>
        </button>
        <div class="detail-section-body">${innerHtml}</div>
      </section>`;
  }

  /** Nulls are omitted, not zeroed — rows only exist when there is a value. */
  function vitalsHtml() {
    const rows = [];
    if (Number.isFinite(storm.windKt)) {
      rows.push(['Winds', `${Math.round(storm.windKt)} kt (${formatWind(storm.windKt)})`]);
    }
    if (Number.isFinite(storm.pressureMb)) rows.push(['Pressure', formatPressure(storm.pressureMb)]);
    if (Number.isFinite(storm.headingDeg) && Number.isFinite(storm.speedKt)) {
      rows.push(['Moving', `${formatBearing(storm.headingDeg)} at ${Math.round(storm.speedKt)} kt (${formatSpeed(storm.speedKt)})`]);
    }
    const pos = positionText(storm.lat, storm.lon);
    if (pos) rows.push(['Position', pos]);
    if (!rows.length) return '<div class="detail-empty">No current vitals.</div>';
    return `<dl class="detail-vitals">${rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
      .join('')}</dl>`;
  }

  function homeHtml() {
    const d = home.distanceTo(storm);
    if (!d) return null;
    let html = `
      <div class="detail-kicker">Distance</div>
      <div class="detail-figure">${Math.round(d.nm).toLocaleString()} nm (${formatDistance(d.nm)}) ${esc(formatBearing(d.bearing))} of home</div>`;

    /* closestApproach reads storm.forecast — decorate a copy with the
     * geometry bundle's normalized points; the store's objects stay pure. */
    if (geo.state === 'ok' && geo.bundle?.forecast?.length) {
      const ca = home.closestApproach({ ...storm, forecast: geo.bundle.forecast });
      if (ca) {
        const when = ca.time
          ? ` · ${esc(formatClockDay(ca.time))}${formatUntil(ca.time) ? ` (${esc(formatUntil(ca.time))})` : ''}`
          : '';
        html += `
          <div class="detail-kicker">Closest approach <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${Math.round(ca.nm).toLocaleString()} nm${when}</div>`;
      }
    } else if (geo.state === 'loading' && storm.can?.forecastPoints) {
      html += `<div class="detail-kicker">Closest approach</div><div class="detail-soft">Loading forecast track…</div>`;
    }
    return html;
  }

  function wwHtml() {
    /* `can` distinguishes "this source never had it" from "the fetch died"
     * (§4). GDACS publishes no watch/warning product — that is unsupported,
     * not clear and not broken. Three strings, all different, by design. */
    if (storm.source !== 'nhc') {
      return '<div class="detail-soft">Not available for GDACS storms.</div>';
    }
    const slot = geo.state === 'ok' ? geo.bundle?.layers?.watchWarning : null;
    if (geo.state === 'loading') return '<div class="detail-soft">Checking…</div>';
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      /* The failure is named here because this IS the layer's surface; the
       * map simply lacks the stripe. Two strings by design (§16). */
      return '<div class="detail-soft">Watches and warnings unavailable.</div>';
    }
    if (!slot || slot.status === 'none') return '<div class="detail-soft">None in effect.</div>';
    const legend = wwLegend(slot.fc.features);
    if (!legend.length) return '<div class="detail-soft">None in effect.</div>';
    return `<ul class="detail-ww">${legend
      .map((e) => `<li><span class="row-swatch" style="background:${e.color}"></span>${esc(e.label)}</li>`)
      .join('')}</ul>`;
  }

  /** Which map layers this storm SHOULD have but doesn't, in human words.
   *  §16: storm in feed, geometry failed → the failure is named on the
   *  layer. The Layers panel proper is Phase 6; until then this section is
   *  the layer surface, so the naming lives here. */
  const LAYER_LABEL = {
    cone: 'cone', forecastTrack: 'forecast track', forecastPoints: 'forecast points',
    pastTrack: 'past track',
  };
  function failedLayerNames() {
    if (geo.state !== 'ok' || !geo.bundle?.layers) return [];
    return Object.entries(LAYER_LABEL)
      .filter(([k]) => geo.bundle.layers[k]?.status === 'unavailable')
      .map(([, label]) => label);
  }

  function layersHtml() {
    const on = getForecastTimesOn();
    let problem = '';
    if (geo.state === 'error') {
      /* The detail line is our own short human-written message (never a
       * stack trace) — on a phone, this panel IS the console. */
      problem = `
        <div class="detail-geo-error">
          Storm geometry unavailable — the map is missing this storm's cone and tracks.
          ${geo.error ? `<div class="detail-geo-detail">${esc(geo.error)}</div>` : ''}
          <button class="detail-retry" type="button" id="detail-geo-retry">Retry</button>
        </div>`;
    } else {
      const failed = failedLayerNames();
      if (failed.length) {
        problem = `
          <div class="detail-geo-error">
            Unavailable on the map: ${esc(failed.join(', '))}.
            <button class="detail-retry" type="button" id="detail-geo-retry">Retry</button>
          </div>`;
      }
    }
    return `
      <button class="detail-toggle" type="button" id="toggle-ftimes" role="switch" aria-checked="${on}">
        <span>Forecast times</span><span class="detail-switch" aria-hidden="true"></span>
      </button>
      ${problem}`;
  }

  function renderBody() {
    if (!storm) return;
    if (ghost) {
      bodyEl.innerHTML = `
        <div class="detail-ghost-note">This storm is no longer in the NHC feed.
        Last known information is shown below.</div>
        ${section('vitals', 'Last known', vitalsHtml())}`;
      wireSections();
      return;
    }
    const homeBlock = homeHtml();
    bodyEl.innerHTML = [
      section('vitals', 'Vitals', vitalsHtml()),
      homeBlock ? section('home', 'Home', homeBlock) : '',
      section('ww', 'In effect', wwHtml()),
      section('layers', 'Layers', layersHtml()),
    ].join('');
    wireSections();

    bodyEl.querySelector('#toggle-ftimes')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      onToggleForecastTimes(next);
    });
    bodyEl.querySelector('#detail-geo-retry')?.addEventListener('click', () => {
      if (storm) onRetryGeometry(storm);
    });
  }

  function wireSections() {
    for (const head of bodyEl.querySelectorAll('.detail-section-head')) {
      head.addEventListener('click', () => {
        const sec = head.closest('.detail-section');
        const id = sec.dataset.section;
        const next = sec.dataset.collapsed !== 'true';
        sec.dataset.collapsed = String(next);
        head.setAttribute('aria-expanded', String(!next));
        collapsed[id] = next;
        writeSections(collapsed);
      });
    }
  }

  function renderAll() {
    if (!storm) return;
    renderIdentity();
    renderStamp();
    renderBody();
  }

  /* --- public API ---------------------------------------------------------- */

  function setOpen(next) {
    open = next;
    root.dataset.open = String(open);
    if (open) root.querySelector('.detail-back')?.focus();
  }

  return {
    isOpen: () => open,
    close: () => setOpen(false),

    /** New selection. Geometry status arrives separately via setGeometry. */
    open(s) {
      storm = s;
      ghost = false;
      geo = { state: 'loading' };
      renderAll();
      setOpen(true);
    },

    /** Poll tick / home change: refresh in place. If the selected storm has
     *  left a CLEAN feed it becomes the ghost form here — never a blank, no
     *  forced navigation (§16). A source ERROR holds the panel as stale
     *  instead; the stamp bands already say so. */
    update(state) {
      if (!open || !storm) return;
      const live = state?.storms?.find((s) => s.id === storm.id);
      if (live) {
        storm = live;
        ghost = false;
      } else if (state && storm.source && state.sources?.[storm.source]?.status === 'ok') {
        ghost = true;
      }
      renderAll();
    },

    /** Geometry fetch lifecycle from main.js:
     *  {state:'loading'} | {state:'ok', bundle, lagged} | {state:'error', error} */
    setGeometry(next) {
      geo = next;
      if (open && storm) renderAll();
    },

    current: () => storm,
  };
}
