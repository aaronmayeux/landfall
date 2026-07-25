/**
 * view-storms.js — the storm list, as a DRAWER VIEW (SPEC §16).
 *
 * THE LIST IS THE ACCESSIBILITY SURFACE. The WebGL canvas is aria-hidden;
 * this one visible list is simultaneously the click target, the Tab order,
 * and the screen-reader view of the globe. Not a hidden duplicate — those rot.
 *
 * WAS A PANEL, IS NOW A VIEW. It no longer owns an <aside>, a header, or its
 * own open/close state — ui/drawer.js owns all three, and this file owns only
 * its contents. The collapsed PILL survives as its own element outside the
 * drawer, because it is the narrow-width entry point rather than part of the
 * panel it opens.
 *
 * Shape:
 *   - Narrow: collapsed pill ("6 active storms") above the thumb zone; tap
 *     opens the drawer on this view.
 *   - Wide: the drawer opens on this view at boot. CSS docks the SAME drawer
 *     as a rail — docking adapts to width, never to device (SPEC §16).
 *   - NO HOME: strongest-first within canonical basin order, no distance.
 *   - HOME SET: nearest-first within basin order, distance on every row.
 *   - Basin headers are real <h2>s, only when more than one basin is present.
 *   - Three empty states, never conflated: loading / clear / unavailable.
 *   - NO RE-SORT WHILE VISIBLE: presence changes rebuild; a poll that only
 *     changed numbers patches rows in place (SPEC §16, §13).
 *
 * ==> TWO LINES PER ROW, AND THE SCOPE FILTER IS GONE (2026-07-25) <==
 *
 * The row used to be one line — swatch, name, then all the metadata pushed
 * right. On a 340px rail with a home set, "Cat 2 · 85 kt · closing · 9,901 mi"
 * is most of the width, so the NAME took whatever was left and ellipsised.
 * Storm names are the one thing on this surface that must never be truncated:
 * the name is how you refer to the thing, how you find it in a forecast, and
 * how a stranger arriving by shared link knows what they are looking at. The
 * name now owns its own line and the metadata sits under it, quieter.
 *
 * The scope filter (All / My basin / Near me) was removed with it. Three
 * buttons pinned above a list that has never held more than nine rows is a
 * filter that saves no work, and it cost a row of chrome at the top of the one
 * surface that is also the app's whole accessibility layer. Home still sorts
 * nearest-first and still puts a distance on every row — that was the part
 * carrying its weight. `SCOPE`, `SCOPE_RADIUS_NM`, `filterByScope`, and
 * `availableScopes` were deleted rather than left behind as dead exports.
 *
 * Row activation (tap/Enter) calls the injected onSelect(storm), which pushes
 * the detail view onto the drawer's stack and flies the camera.
 *
 * Imports: config/, lib/. Never map/ or data/ — main.js wires the store in.
 */

import { BASIN_LABEL, basinRank } from '../lib/basin.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, ageMs } from '../lib/time.js';
import { formatDistance } from '../lib/units.js';
import { FRESHNESS } from '../config/constants.js';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.pill      #storm-pill (narrow-width collapsed form)
 * @param {(storm: object) => void} opts.onSelect
 * @param {() => void} opts.onRetry    manual retry for the total-failure state
 * @param {object} opts.home           the home module's read API, injected so
 *        this file never imports data/ directly (one-directional imports).
 *        Shape: { get, distanceTo, motionTrend }
 */
export function createStormsView({ pill, onSelect, onRetry, home }) {
  let host = null;      // the drawer-supplied view host
  let visible = false;  // is this the drawer's current view?
  let lastState = null;
  let renderedIds = ''; // presence fingerprint — decides rebuild vs patch

  /* --- view skeleton ------------------------------------------------------
   * No header and no close button: the drawer owns its chrome. This view
   * renders the list and nothing else — the scope filter that used to sit
   * above it is gone (see the header note).
   * ---------------------------------------------------------------------- */
  let body = null;

  function buildSkeleton(el) {
    host = el;
    host.innerHTML = `
      <div class="drawer-body" id="storm-list" role="list" aria-label="Active storms"></div>
    `;
    body = host.querySelector('#storm-list');
  }

  /* Escape is NOT handled here. It is a global contract owned by attachEscape()
   * in map/globe.js (SPEC §10) — a panel-scoped listener only fired when focus
   * was already inside the panel. The drawer restores focus on close, so the
   * global handler gets the same behavior from anywhere. */

  /* --- pill text ---------------------------------------------------------- */
  function renderPill(state) {
    const n = state.storms.length;
    const status = overall(state);
    pill.textContent =
      status === 'loading' ? 'Checking the oceans…'
      : status === 'unavailable' && n === 0 ? 'Storm data unavailable'
      : n === 0 ? 'No active storms'
      : `${n} active storm${n === 1 ? '' : 's'}`;
    pill.dataset.tone = status === 'unavailable' && n === 0 ? 'error' : 'normal';
  }

  /** Local restatement of the store's overall logic is a cycle risk — so the
   *  store's status is not imported; it is DERIVED the same way from the state
   *  object we're handed. Keep in lockstep with data/store.js overallStatus. */
  function overall(state) {
    const st = [state.sources.nhc.status, state.sources.gdacs.status];
    if (st.every((x) => x === 'loading')) return 'loading';
    if (state.storms.length > 0) return 'ok';
    if (st.every((x) => x === 'ok')) return 'clear';
    return 'unavailable';
  }

  /* --- rows --------------------------------------------------------------- */
  /** Distance text for a row, or null when there is no home. Returns the
   *  formatted string only — the timestamp that came with it is used by the
   *  detail panel (Phase 4); the list row is a glance surface. */
  function rowDistance(s) {
    const d = home?.distanceTo(s);
    return d ? formatDistance(d.nm) : null;
  }

  /* The one word a row has space for. Wording lives here so it can be changed
   * in one place; the VALUES it maps come from data/home.js and are not
   * cosmetic. A storm with no published motion, a stationary one, or one too
   * far away for the question to matter returns null and gets no word — three
   * different silences that all honestly mean "not stated" (SPEC §5). */
  const TREND_WORD = Object.freeze({ closing: 'closing', receding: 'receding' });

  /** Trend text for a row, or null. Placed BEFORE the distance in the meta
   *  line: after it, "340 mi receding" reads as a measurement rather than a
   *  direction of travel. */
  function rowTrend(s) {
    const t = home?.motionTrend?.(s);
    return t ? TREND_WORD[t] || null : null;
  }

  /** Wind for a row. A source with no CURRENT wind number shows its PEAK,
   *  labelled — GDACS publishes only the forecast maximum, and printing that
   *  bare would read as the storm's wind right now. */
  function windText(s) {
    if (s.windKt != null) return `${Math.round(s.windKt)} kt`;
    if (s.peakWindKt != null) return `peak ${Math.round(s.peakWindKt)} kt`;
    return null;
  }

  /** The metadata line, assembled once so the row builder and the in-place
   *  patcher below can never produce different text from the same storm. */
  function metaText(s) {
    const label = categoryShortLabel(s.category, s.nature, s.categoryCode);
    return [label, windText(s), rowTrend(s), rowDistance(s)]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * TWO LINES: the name, then everything else beneath it.
   *
   * The name is never truncated and never competes for width — see the header
   * note. The metadata keeps the monospace treatment because it is figures
   * being compared down a column, and it drops to secondary colour so the
   * eye lands on the names first when scanning the list.
   */
  function rowHtml(s) {
    const swatch = categoryColor(s.category, s.nature, s.categoryCode);
    const meta = metaText(s);
    const stale = isStale(s) ? `<span class="row-stale">${formatAge(s.observedAt)}</span>` : '';
    return `
      <button class="storm-row" type="button" role="listitem" data-id="${s.id}"
              aria-label="${esc(s.name)}, ${esc(meta)}">
        <span class="row-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
        <span class="row-text">
          <span class="row-name">${esc(s.name)}</span>
          <span class="row-meta">${esc(meta)}${stale}</span>
        </span>
      </button>
    `;
  }

  /** Within a basin: NEAREST-first once home exists, strongest-first without
   *  it (SPEC §14 Phase 3). Distance is the more useful ordering the moment
   *  there is a reference point — the strongest storm in the basin is not
   *  necessarily the one that matters to you.
   *
   *  Ties and missing values fall back to intensity so the order is always
   *  total and stable; an unstable comparator makes rows jump between polls. */
  function sortWithinBasin(a, b) {
    if (home?.get()) {
      const da = home.distanceTo(a);
      const db = home.distanceTo(b);
      if (da && db && da.nm !== db.nm) return da.nm - db.nm;
    }
    return (b.windKt ?? b.peakWindKt ?? -1) - (a.windKt ?? a.peakWindKt ?? -1);
  }

  const isStale = (s) => {
    const a = ageMs(s.observedAt);
    return a != null && a > FRESHNESS.freshUntil;
  };

  const esc = (t) =>
    String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  /* --- list states ---------------------------------------------------------
   * Every path guards on `body`: the view mounts lazily, so a store emit can
   * land before this view has ever been shown. The pill still updates — it
   * lives outside the drawer and is the narrow-width entry point.
   * ---------------------------------------------------------------------- */
  function renderList(state, { force = false } = {}) {
    if (!state || !body) return;
    const status = overall(state);

    if (status === 'loading') {
      renderedIds = '';
      body.innerHTML = `<p class="list-note">Checking the oceans…</p>`;
      return;
    }

    if (status === 'clear') {
      renderedIds = '';
      /* The only true all-clear: every source clean AND zero storms (§5). */
      body.innerHTML = `<p class="list-note">No active storms. All feeds reporting clean.</p>`;
      return;
    }

    if (status === 'unavailable' && state.storms.length === 0) {
      renderedIds = '';
      body.innerHTML = `
        <p class="list-note list-error">Storm feeds are not responding. This does not mean the ocean is clear.</p>
        <button class="retry" type="button">Retry</button>
      `;
      body.querySelector('.retry').addEventListener('click', onRetry);
      return;
    }

    /* Every storm, always. There is no longer a filter that can empty this
     * list while storms exist, so the old `none_matched` branch went with the
     * scope control — the three honest states above are the only ones left. */
    const visible = state.storms;

    /* Storms present. Rebuild only when PRESENCE changed or on (re)open —
     * otherwise patch text in place so rows never move under a thumb. */
    const ids = visible.map((s) => s.id).join('|');
    if (!force && ids === renderedIds) {
      patchRows({ ...state, storms: visible });
      renderPartialNote(state);
      return;
    }
    renderedIds = ids;

    const basins = [...new Set(visible.map((s) => s.basin))].sort(
      (a, b) => basinRank(a) - basinRank(b)
    );
    const showHeaders = basins.length > 1; // a lone header over two rows is noise

    body.innerHTML = basins
      .map((basin) => {
        const rows = visible
          .filter((s) => s.basin === basin)
          .sort(sortWithinBasin)
          .map(rowHtml)
          .join('');
        return showHeaders
          ? `<section class="basin-group"><h2 class="basin-head">${esc(BASIN_LABEL[basin] || basin)}</h2>${rows}</section>`
          : rows;
      })
      .join('');

    renderPartialNote(state);

    body.querySelectorAll('.storm-row').forEach((el) => {
      el.addEventListener('click', () => {
        const storm = lastState?.storms.find((s) => s.id === el.dataset.id);
        if (storm) onSelect(storm);
      });
    });
  }

  function patchRows(state) {
    if (!body) return;
    for (const s of state.storms) {
      const el = body.querySelector(`.storm-row[data-id="${CSS.escape(s.id)}"]`);
      if (!el) continue;
      const meta = metaText(s);
      const stale = isStale(s) ? `<span class="row-stale">${formatAge(s.observedAt)}</span>` : '';
      el.querySelector('.row-meta').innerHTML = `${esc(meta)}${stale}`;
      /* The accessible name carries the same text, so a screen reader is never
       * told a category the visible row stopped showing two polls ago. */
      el.setAttribute('aria-label', `${s.name}, ${meta}`);
      el.querySelector('.row-swatch').style.setProperty('--swatch', categoryColor(s.category, s.nature, s.categoryCode));
    }
  }

  /** Partial outage: show what we have PLUS name what may be missing (§16).
   *  Feed-level detail lives in the status strip; this is the list's own
   *  honesty note, because a filtered-looking list must explain itself. */
  function renderPartialNote(state) {
    if (!body) return;
    body.querySelector('.list-partial')?.remove();
    const notes = [];
    if (state.sources.nhc.status === 'unavailable') {
      notes.push('NHC is not responding — Atlantic and East Pacific storms may be missing or stale.');
    }
    if (state.sources.gdacs.status === 'unavailable') {
      notes.push('GDACS is not responding — Northwest Pacific and Indian Ocean storms may be missing or stale.');
    }
    if (notes.length) {
      const p = document.createElement('p');
      p.className = 'list-note list-error list-partial';
      p.textContent = notes.join(' ');
      body.appendChild(p);
    }
  }

  /* --- the drawer view contract -------------------------------------------
   * mount() runs once, lazily. onEnter() runs every time this becomes the
   * drawer's visible view — that is where the SORT-ON-OPEN rule lives (§16:
   * sort on open, on scope change, and on reopen; never on poll).
   * ---------------------------------------------------------------------- */

  return {
    id: 'storms',
    title: 'Storms',

    mount(el) {
      buildSkeleton(el);
      renderList(lastState, { force: true });
    },

    onEnter() {
      visible = true;
      pill.dataset.hidden = 'true';
      /* force: re-sort on open. Storms move slowly enough that nobody will
       * notice the order settling, and it is the one moment re-sorting is
       * safe — no thumb is mid-tap on a row that has not been drawn yet. */
      renderList(lastState, { force: true });
    },

    onLeave() {
      visible = false;
      /* The pill is the narrow-width entry point, so it returns whenever the
       * list is not on screen. It is hidden by CSS at wide widths. */
      pill.dataset.hidden = 'false';
    },

    /** First stop is the first storm, not the drawer chrome — a keyboard
     *  user opening the list wants a storm. */
    focus() {
      return body?.querySelector('.storm-row');
    },

    /* --- driven by main.js ------------------------------------------------ */

    update(state) {
      lastState = state;
      renderPill(state);
      /* The pill updates whether or not this view is on screen; the list only
       * matters once mounted, and renderList guards on that itself. */
      renderList(state);
    },

    /** Home was set, moved, or cleared. That changes the sort order and every
     *  distance on screen, so this is always a full rebuild — patching would
     *  leave stale distances in place. */
    homeChanged() {
      renderList(lastState, { force: true });
    },

    isVisible: () => visible,
  };
}
