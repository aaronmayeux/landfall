/**
 * view-storm-detail.js — the storm detail view (SPEC §16).
 *
 * A VIEW INSIDE THE ONE DRAWER, pushed onto the stack by the storm list. The
 * drawer owns the header, the back button, and the close button; this file
 * owns the storm. Back returns to wherever you came from — the list normally,
 * and Layers if you took the side trip to turn something on.
 *
 * IDENTITY LIVES IN THE DRAWER HEADER. The storm's name is the view's title,
 * supplied through titleFor(), so the pinned identity is the drawer's own
 * chrome rather than a second header stacked under it. The category swatch
 * rides with it — category color is the SWATCH, never the text color (§6).
 *
 * Structure rules it implements:
 *  - The timestamp PINS below the header; the body scrolls under it. You must
 *    never lose track of which storm and how old while reading.
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
 *    identity, last-known vitals, the notice. No home block, no layer link.
 *
 * THE LAYERS SECTION IS A SHORTCUT, NOT A CONTROL SURFACE. §16 sketched
 * inline toggles here; that was reconsidered. Two controls for one layer is
 * how a state drifts, and §7's "the toggle IS the recovery" only means
 * something when there is exactly one toggle per layer. So this section says
 * what is currently drawn for this storm and pushes into the Layers view —
 * which is one tap further for the common case, and worth it for a single
 * source of truth. If that friction bites on glass, the fix is narrowing the
 * exception (the wind field pair alone, say), never re-adding a full set of
 * duplicate switches.
 *
 * Imports: config/, lib/ only. Home, geometry, and layer state arrive through
 * injected facades from main.js — ui/ never imports data/ (SPEC §12).
 */

import { FRESHNESS, STORAGE_KEY } from '../config/constants.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, formatUntil, formatClockDay, ageMs } from '../lib/time.js';
import {
  formatWind, formatSpeed, formatDistance, formatPressure, formatBearing,
} from '../lib/units.js';
import { wwLegend } from '../lib/watchwarning.js';
import { windThresholdFromProps, windColor, WIND_LABEL } from '../lib/wind.js';

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
  /* Hurricane strength with no category behind it — GDACS's ceiling, not a
   * gap in our parse. Named plainly rather than shown as a bare cyclone. */
  if (storm.category == null && storm.categoryCode === 'HU') return 'Hurricane / Typhoon';
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

/** The storm's own source, in the words the user should see.
 *
 *  The ghost note used to say "the NHC feed" for every storm regardless of
 *  where it came from, and `ghost` is set for BOTH sources. Bertha is the
 *  live case — she left NHC while GDACS still carried her, so the reverse
 *  will happen too and the note would have credited the wrong agency for a
 *  storm's disappearance. An unknown source degrades to the generic wording
 *  rather than guessing (§5). */
function sourceLabel(source) {
  if (source === 'nhc') return 'the NHC feed';
  if (source === 'gdacs') return 'the GDACS feed';
  return 'the feed it came from';
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
 * @param {object}      opts.home                injected: {get, distanceTo, closestApproach}
 * @param {() => void}  opts.onOpenLayers        push the Layers view
 * @param {() => string[]} opts.activeLayerLabels  what is drawn for this storm
 * @param {(storm) => void}      opts.onRetryGeometry
 */
export function createStormDetailView({
  home, onOpenLayers, activeLayerLabels, onRetryGeometry,
}) {
  let host = null;
  let visible = false;
  let storm = null;        // last-known storm object (survives feed exit → ghost)
  let ghost = false;
  let geo = { state: 'idle' }; // 'idle'|'loading'|'ok'|'error', bundle?, error?
  let collapsed = readSections();
  /* The drawer re-renders its header when a view asks it to — a poll can
   * change a storm's category, and the title carries the swatch. */
  let requestChrome = null;

  let stampEl = null;
  let bodyEl = null;

  function buildSkeleton(el) {
    host = el;
    /* No header and no back button: the drawer owns both. The stamp pins
     * directly under the drawer's header; the body scrolls beneath it. */
    host.innerHTML = `
      <div class="detail-stamp" id="detail-stamp"></div>
      <div class="drawer-body detail-body" id="detail-body"></div>
    `;
    stampEl = host.querySelector('#detail-stamp');
    bodyEl = host.querySelector('#detail-body');
  }

  /* --- render pieces ------------------------------------------------------- */

  /** The drawer header's title for this view: swatch + name + nature. Built
   *  as a Node rather than a string because the drawer accepts either, and
   *  this one carries a colored swatch that must not be escaped away. */
  function titleNode() {
    const wrap = document.createElement('div');
    wrap.className = 'detail-identity';
    if (!storm) {
      wrap.textContent = 'Storm';
      return wrap;
    }
    wrap.innerHTML = `
      <div class="detail-name">
        <span class="row-swatch" style="background:${categoryColor(storm.category, storm.nature, storm.categoryCode)}"></span>
        <h1 class="drawer-title">${esc(storm.name)}</h1>
      </div>
      <div class="detail-nature">${esc(natureLine(storm))}</div>
    `;
    return wrap;
  }

  function renderStamp() {
    if (!stampEl || !storm) return;
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
    } else if (Number.isFinite(storm.peakWindKt)) {
      /* NAMED AS A FORECAST, because it is one. GDACS publishes no current
       * wind — only the maximum expected over the storm's life. Labelling
       * this "Winds" is what put a Cat 2 on a tropical storm. */
      rows.push([
        'Forecast peak',
        `${Math.round(storm.peakWindKt)} kt (${formatWind(storm.peakWindKt)})`,
      ]);
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
     * geometry bundle's normalized points; the store's objects stay pure.
     *
     * THREE SENTENCES, FROM TWO ORTHOGONAL FLAGS. Each is checked against
     * what it actually claims, because the failure this block exists to
     * prevent is a true number under a false heading:
     *
     *   closing + near   → an approach. Give it a number and a time.
     *   receding         → the track never beats where it is now. Say that.
     *   closing + far    → it does get closer, so "never closer than current
     *                      position" would be measurably WRONG (NOUL-26 gains
     *                      230 nm of 7,315, over the pole). Claim only what
     *                      holds: it never comes near home. */
    if (geo.state === 'ok' && geo.bundle?.forecast?.length) {
      const ca = home.closestApproach({ ...storm, forecast: geo.bundle.forecast });
      if (ca && ca.trend === 'closing' && ca.relevant) {
        const when = ca.time
          ? ` · ${esc(formatClockDay(ca.time))}${formatUntil(ca.time) ? ` (${esc(formatUntil(ca.time))})` : ''}`
          : '';
        html += `
          <div class="detail-kicker">Closest approach <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${Math.round(ca.nm).toLocaleString()} nm (${esc(formatDistance(ca.nm))})${when}</div>`;
      } else if (ca && ca.trend === 'receding') {
        html += `
          <div class="detail-kicker">Nearest point <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${Math.round(ca.nm).toLocaleString()} nm (${esc(formatDistance(ca.nm))})</div>
          <div class="detail-soft">Moving away, never closer than current position.</div>`;
      } else if (ca) {
        html += `
          <div class="detail-kicker">Nearest point <span class="detail-soft">forecast</span></div>
          <div class="detail-figure">${Math.round(ca.nm).toLocaleString()} nm (${esc(formatDistance(ca.nm))})</div>
          <div class="detail-soft">Moving away — never comes near home.</div>`;
      }
    } else if (
      (geo.state === 'loading' || geo.state === 'idle') &&
      storm.can?.forecastPoints
    ) {
      /* `idle` is the moment before the fetch is dispatched — it is pre-load,
       * not a third outcome, so it says the same thing. Naming it explicitly
       * is what keeps the chain below from having a silent fall-through. */
      html += `<div class="detail-kicker">Closest approach</div><div class="detail-soft">Loading forecast track…</div>`;
    } else if (!storm.can?.forecastPoints) {
      /* UNSUPPORTED, not broken. Same three-way distinction the watch/warning
       * and wind-field blocks make (§4): a source that never publishes a
       * forecast track has not failed at anything. */
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">This source doesn’t publish a forecast track.</div>`;
    } else if (geo.state === 'error') {
      /* BROKEN, and it says so with a way out. Distance above is still true —
       * it comes from the storm's own position, not the geometry — so this
       * names only what is actually missing. */
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-geo-error">
          The forecast track didn’t load, so there’s no approach figure.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    } else if (geo.state === 'ok') {
      /* Bundle arrived, no usable track in it — and the two reasons for that
       * are DIFFERENT FACTS, so they get different sentences. The slot's own
       * status is what knows: `unavailable` means that one layer's fetch died
       * while the rest of the bundle survived; anything else means the source
       * genuinely published no points this advisory. Printing "none
       * published" over a failed fetch would be the §5 lie in miniature. */
      const slot = geo.bundle?.layers?.forecastPoints;
      html +=
        slot?.status === 'unavailable'
          ? `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-geo-error">
          The forecast track didn’t load, so there’s no approach figure.
          <button class="detail-retry" type="button">Retry</button>
        </div>`
          : `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">No forecast track in this advisory.</div>`;
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

  /**
   * Wind field — the size readout, and the ONE place a GDACS storm is told
   * why it has no bands (§14 both-sources rule).
   *
   * This section exists mostly for that sentence. On the map, a GDACS storm
   * with the wind layer on simply shows nothing — and nothing is exactly what
   * a storm with no dangerous wind would show. Identical pixels, opposite
   * meanings, which is the §5 failure. The map cannot say "not available" in
   * empty ocean; this panel can, so it does.
   */
  function windHtml() {
    if (storm.source !== 'nhc' && storm.source !== 'gdacs') {
      return '<div class="detail-soft">Not available for this source.</div>';
    }
    if (geo.state === 'loading') return '<div class="detail-soft">Checking…</div>';

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.windCurrent : null;
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      return '<div class="detail-soft">Wind field unavailable.</div>';
    }
    if (!slot || slot.status === 'none') {
      return '<div class="detail-soft">No wind field published for this advisory.</div>';
    }

    /* Which thresholds this storm actually has. A weak system publishes only
     * a 34 kt band; listing the two it lacks would read as missing data. */
    const present = new Map();
    for (const f of slot.fc?.features || []) {
      const kt = windThresholdFromProps(f.properties);
      if (!kt) continue;
      /* GDACS bands are drawn in the same three severity colors as NHC's,
       * but they are NOT the same numbers: GDACS publishes round metric
       * thresholds (60/90/120 km/h ≈ 32/49/65 kt), confirmed live
       * 2026-07-24. `_gdacsKmh` carries what the source actually said, and
       * it is what gets shown — relabelling those bands "34 kt" would be
       * putting NHC's words in GDACS's mouth. Same colors, honest numbers. */
      if (!present.has(kt)) present.set(kt, f.properties?._gdacsKmh ?? null);
    }
    if (!present.size) return '<div class="detail-soft">No wind field published for this advisory.</div>';

    const rows = [...present.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([kt, kmh]) => {
        const label = kmh != null ? `${WIND_LABEL[kt]} (${Math.round(kmh)} km/h)` : WIND_LABEL[kt];
        return `<li><span class="row-swatch" style="background:${windColor(kt)}"></span>${esc(label)}</li>`;
      })
      .join('');

    /* No source-limitation note for GDACS any more. The spec inherited a
     * claim that GDACS publishes ONE radius and therefore draws circles;
     * the live payload disproved it on glass (2026-07-24) — its bands are
     * quadrant-shaped, same as NHC's. Saying otherwise in the panel would
     * be an apology for a limitation that does not exist. */
    const note = '';

    return `<ul class="detail-ww">${rows}</ul>${note}`;
  }

  /** Which map layers this storm SHOULD have but doesn't, in human words.
   *  §16: storm in feed, geometry failed → the failure is named on the
   *  layer. The Layers panel proper is Phase 6; until then this section is
   *  the layer surface, so the naming lives here. */
  const LAYER_LABEL = {
    cone: 'cone', forecastTrack: 'forecast track', forecastPoints: 'forecast points',
    pastTrack: 'past track',
    windCurrent: 'wind field', windSwath: 'wind swath',
  };
  function failedLayerNames() {
    if (geo.state !== 'ok' || !geo.bundle?.layers) return [];
    return Object.entries(LAYER_LABEL)
      .filter(([k]) => geo.bundle.layers[k]?.status === 'unavailable')
      .map(([, label]) => label);
  }

  /** THE SHORTCUT, NOT A CONTROL SURFACE (see the file header). States what is
   *  drawn for this storm and pushes into Layers. No switches live here. */
  function layersHtml() {
    let problem = '';
    if (geo.state === 'error') {
      /* The detail line is our own short human-written message (never a
       * stack trace) — on a phone, this panel IS the console. */
      problem = `
        <div class="detail-geo-error">
          Storm geometry unavailable — the map is missing this storm's cone and tracks.
          ${geo.error ? `<div class="detail-geo-detail">${esc(geo.error)}</div>` : ''}
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    } else {
      const failed = failedLayerNames();
      if (failed.length) {
        problem = `
          <div class="detail-geo-error">
            Unavailable on the map: ${esc(failed.join(', '))}.
            <button class="detail-retry" type="button">Retry</button>
          </div>`;
      }
    }

    /* Naming what is ON is the point of the shortcut — otherwise the row is
     * just a navigation stub and the user has to open Layers to find out
     * whether anything is drawn at all. */
    const labels = activeLayerLabels?.() || [];
    const summary = labels.length
      ? esc(labels.join(' · '))
      : 'Nothing extra drawn';

    return `
      <button class="detail-link" type="button" id="detail-open-layers">
        <span class="detail-link-text">
          <span class="detail-link-label">Layers</span>
          <span class="detail-link-sub">${summary}</span>
        </span>
        <svg class="detail-link-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>
      ${problem}`;
  }

  function renderBody() {
    if (!bodyEl || !storm) return;
    if (ghost) {
      /* Reduced ghost form: no home block (distance to a storm that is not
       * there is meaningless) and no layer link. */
      bodyEl.innerHTML = `
        <div class="detail-ghost-note">This storm is no longer in ${sourceLabel(storm.source)}.
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
      section('wind', 'Wind field', windHtml()),
      section('layers', 'Layers', layersHtml()),
    ].join('');
    wireSections();

    bodyEl.querySelector('#detail-open-layers')?.addEventListener('click', () => {
      onOpenLayers?.();
    });
    /* ALL of them, by class. There is more than one Retry on this panel now
     * — the Home block grew its own when the forecast track fails — and
     * querySelector by id bound only whichever came first in the document,
     * silently leaving the other dead. */
    for (const btn of bodyEl.querySelectorAll('.detail-retry')) {
      btn.addEventListener('click', () => {
        if (storm) onRetryGeometry(storm);
      });
    }
  }

  function wireSections() {
    if (!bodyEl) return;
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
    renderStamp();
    renderBody();
    /* The header carries the identity, so a category change has to reach the
     * drawer's chrome — not just this view's body. */
    requestChrome?.();
  }

  /* --- the drawer view contract -------------------------------------------- */

  return {
    id: 'detail',
    title: 'Storm',

    /** The drawer titles this view from its argument, so the storm's name is
     *  the header rather than the word "Detail". */
    titleFor: (s) => {
      if (s && s !== storm) storm = s;
      return titleNode();
    },

    mount(el) {
      buildSkeleton(el);
      renderAll();
    },

    /** Entered with a storm — a fresh selection, or a return from Layers. */
    onEnter(s) {
      visible = true;
      if (s && s.id !== storm?.id) {
        storm = s;
        ghost = false;
        geo = { state: 'loading' };
      } else if (s) {
        storm = s;
      }
      renderAll();
    },

    onLeave() {
      visible = false;
    },

    focus() {
      return null; // the drawer's back button is the right first stop here
    },

    /** The drawer hands this in at mount so the view can ask for a header
     *  re-render when its title data changes. */
    setChromeRefresh(fn) {
      requestChrome = fn;
    },

    /* --- driven by main.js ------------------------------------------------ */

    /** Poll tick / home change: refresh in place. If the selected storm has
     *  left a CLEAN feed it becomes the ghost form here — never a blank, no
     *  forced navigation (§16). A source ERROR holds the view as stale
     *  instead; the stamp bands already say so. */
    update(state) {
      if (!storm) return;
      const live = state?.storms?.find((s) => s.id === storm.id);
      if (live) {
        storm = live;
        ghost = false;
      } else if (state && storm.source && state.sources?.[storm.source]?.status === 'ok') {
        ghost = true;
      }
      if (visible) renderAll();
    },

    /** Geometry fetch lifecycle from main.js:
     *  {state:'loading'} | {state:'ok', bundle, lagged} | {state:'error', error} */
    setGeometry(next) {
      geo = next;
      if (visible && storm) renderAll();
    },

    /** Layer state changed elsewhere — the shortcut's summary line is stale. */
    layersChanged() {
      if (visible && storm) renderBody();
    },

    isVisible: () => visible,
    current: () => storm,
  };
}
