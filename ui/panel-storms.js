/**
 * panel-storms.js — the storm list (SPEC §16).
 *
 * THE LIST IS THE ACCESSIBILITY SURFACE. The WebGL canvas is aria-hidden;
 * this one visible list is simultaneously the click target, the Tab order,
 * and the screen-reader view of the globe. Not a hidden duplicate — those rot.
 *
 * Phase 2 shape:
 *   - Narrow: collapsed pill ("6 active storms") above the thumb zone; tap
 *     expands to a bottom sheet. Same component collapsed and expanded.
 *   - Wide: left rail, open by default. CSS moves the SAME DOM element —
 *     docking adapts to width, never to device (SPEC §16).
 *   - Strongest-first within canonical basin order (no home yet, so no
 *     distance and no scope filter — absent, not disabled).
 *   - Basin headers are real <h2>s, only when more than one basin is present.
 *   - Three empty states, never conflated: loading / clear / unavailable.
 *   - NO RE-SORT WHILE OPEN: presence changes rebuild; a poll that only
 *     changed numbers patches rows in place (SPEC §16, §13).
 *
 * Row activation (tap/Enter) calls the injected onSelect(storm) — today that
 * flies the camera; the Phase 4 detail panel will ride the same hook.
 *
 * Imports: config/, lib/. Never map/ or data/ — main.js wires the store in.
 */

import { BASIN_LABEL, basinRank } from '../lib/basin.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, ageMs } from '../lib/time.js';
import { FRESHNESS } from '../config/constants.js';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root      #panel-storms
 * @param {HTMLElement} opts.pill      #storm-pill (narrow-width collapsed form)
 * @param {HTMLButtonElement} opts.toggleButton  the Storms control-cluster button
 * @param {(storm: object) => void} opts.onSelect
 * @param {() => void} opts.onRetry    manual retry for the total-failure state
 */
export function createStormsPanel({ root, pill, toggleButton, onSelect, onRetry }) {
  let lastState = null;
  let renderedIds = ''; // presence fingerprint — decides rebuild vs patch
  let open = window.matchMedia('(min-width: 720px)').matches; // wide: open (SPEC §16)

  /* --- static skeleton ---------------------------------------------------- */
  root.innerHTML = `
    <header class="panel-head">
      <h1 class="panel-title">Storms</h1>
      <button class="panel-close" type="button" aria-label="Close storm list">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </header>
    <div class="panel-body" id="storm-list" role="list" aria-label="Active storms"></div>
  `;
  const body = root.querySelector('#storm-list');
  root.querySelector('.panel-close').addEventListener('click', () => setOpen(false));

  function setOpen(next) {
    open = next;
    root.dataset.open = String(open);
    pill.dataset.hidden = String(open);
    toggleButton.setAttribute('aria-expanded', String(open));
    if (open) {
      renderList(lastState, { force: true }); // sort on open (SPEC §16)
      body.querySelector('.storm-row')?.focus();
    }
  }

  pill.addEventListener('click', () => setOpen(true));
  toggleButton.addEventListener('click', () => setOpen(!open));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      toggleButton.focus();
    }
  });

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
  function rowHtml(s) {
    const swatch = categoryColor(s.category, s.nature);
    const label = categoryShortLabel(s.category, s.nature);
    const wind = s.windKt != null ? `${Math.round(s.windKt)} kt` : null;
    const meta = [label, wind].filter(Boolean).join(' · ');
    const stale = isStale(s) ? `<span class="row-stale">${formatAge(s.observedAt)}</span>` : '';
    return `
      <button class="storm-row" type="button" role="listitem" data-id="${s.id}"
              aria-label="${esc(s.name)}, ${esc(meta)}">
        <span class="row-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
        <span class="row-name">${esc(s.name)}</span>
        <span class="row-meta">${esc(meta)}${stale}</span>
      </button>
    `;
  }

  const isStale = (s) => {
    const a = ageMs(s.observedAt);
    return a != null && a > FRESHNESS.freshUntil;
  };

  const esc = (t) =>
    String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  /* --- list states --------------------------------------------------------- */
  function renderList(state, { force = false } = {}) {
    if (!state) return;
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

    /* Storms present. Rebuild only when PRESENCE changed or on (re)open —
     * otherwise patch text in place so rows never move under a thumb. */
    const ids = state.storms.map((s) => s.id).join('|');
    if (!force && ids === renderedIds) {
      patchRows(state);
      renderPartialNote(state);
      return;
    }
    renderedIds = ids;

    const basins = [...new Set(state.storms.map((s) => s.basin))].sort(
      (a, b) => basinRank(a) - basinRank(b)
    );
    const showHeaders = basins.length > 1; // a lone header over two rows is noise

    body.innerHTML = basins
      .map((basin) => {
        const rows = state.storms.filter((s) => s.basin === basin).map(rowHtml).join('');
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
    for (const s of state.storms) {
      const el = body.querySelector(`.storm-row[data-id="${CSS.escape(s.id)}"]`);
      if (!el) continue;
      const label = categoryShortLabel(s.category, s.nature);
      const wind = s.windKt != null ? `${Math.round(s.windKt)} kt` : null;
      const meta = [label, wind].filter(Boolean).join(' · ');
      const stale = isStale(s) ? `<span class="row-stale">${formatAge(s.observedAt)}</span>` : '';
      el.querySelector('.row-meta').innerHTML = `${esc(meta)}${stale}`;
      el.querySelector('.row-swatch').style.setProperty('--swatch', categoryColor(s.category, s.nature));
    }
  }

  /** Partial outage: show what we have PLUS name what may be missing (§16).
   *  Feed-level detail lives in the status strip; this is the list's own
   *  honesty note, because a filtered-looking list must explain itself. */
  function renderPartialNote(state) {
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

  /* --- public ------------------------------------------------------------- */
  setOpen(open);

  return {
    update(state) {
      lastState = state;
      renderPill(state);
      renderList(state);
    },
    isOpen: () => open,
    close: () => setOpen(false),
  };
}
