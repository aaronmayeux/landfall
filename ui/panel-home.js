/**
 * panel-home.js — setting and reviewing home (SPEC §8).
 *
 * THE CENTRAL RULE OF THIS PANEL: a geocode result is a GUESS until the user
 * confirms it. Home is the reference point for every distance and every
 * closest-approach figure in the app, and a wrong home poisons all of them
 * silently — the numbers still look like numbers. So nothing here commits a
 * location without an explicit confirm, and every provisional pin is draggable.
 *
 * NEVER PROMPTS ON FIRST LAUNCH. Geolocation fires only from an explicit tap
 * on "Use my location" — a permission dialog before someone knows what the app
 * is gets denied, and iOS makes that very hard to undo (SPEC §8).
 *
 * Three async surfaces, each with all three states (SPEC §5):
 *   search      loading / none_matched / unavailable+retry
 *   geolocation loading / denied-or-failed (with the manual fallback offered)
 *   confirm     always available, never blocked on either of the above
 *
 * Imports: config/, lib/, data/geocode + data/home. Never map/ — main.js wires
 * the camera and the provisional pin in through callbacks.
 */

import { GEOCODE } from '../config/constants.js';
import { createSearcher } from '../data/geocode.js';
import { locateMe, setHome, clearHome, getHome } from '../data/home.js';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root                #panel-home
 * @param {HTMLButtonElement} opts.toggleButton  the Home control-cluster button
 * @param {(lonlat:{lon,lat}, opts?:{zoom?:number}) => void} opts.onPreview
 *        Fly the camera and show a PROVISIONAL pin. Not a commit.
 * @param {() => ({lon,lat}|null)} opts.getProvisional
 *        Current provisional pin position — it moves when the user drags it,
 *        so the panel must read it at confirm time rather than trusting its own
 *        copy from when the result was picked.
 * @param {() => void} opts.onCancelPreview      Clear the provisional pin.
 * @param {(home) => void} opts.onCommit         Home is now real.
 */
export function createHomePanel({
  root,
  toggleButton,
  onPreview,
  getProvisional,
  onCancelPreview,
  onCommit,
}) {
  let open = false;
  let pending = null; // the candidate awaiting confirmation

  root.innerHTML = `
    <header class="panel-head">
      <h1 class="panel-title">Home</h1>
      <button class="panel-close" type="button" aria-label="Close home panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </header>
    <div class="panel-body">
      <div class="home-current" data-hidden="true">
        <p class="home-current-label"></p>
        <button class="home-clear" type="button">Remove home</button>
      </div>

      <div class="home-setup">
        <button class="home-locate" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>
          Use my location
        </button>
        <p class="home-locate-error" role="alert" data-hidden="true"></p>

        <div class="home-sep"><span>or</span></div>

        <label class="home-search-label" for="home-search">Search for an address</label>
        <input class="home-search" id="home-search" type="text" inputmode="search"
               autocomplete="off" autocorrect="off" spellcheck="false"
               placeholder="Street, city, or postcode"
               aria-describedby="home-search-status">
        <p class="home-search-status" id="home-search-status" role="status" data-hidden="true"></p>
        <ul class="home-results" role="listbox" aria-label="Address matches" data-hidden="true"></ul>

        <p class="home-hint">You can also drag the pin on the globe to place it exactly.</p>
      </div>

      <div class="home-confirm" data-hidden="true">
        <p class="home-confirm-label"></p>
        <p class="home-confirm-hint"></p>
        <div class="home-confirm-actions">
          <button class="home-confirm-yes" type="button">Set as home</button>
          <button class="home-confirm-no" type="button">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const currentBox = $('.home-current');
  const currentLabel = $('.home-current-label');
  const setupBox = $('.home-setup');
  const searchInput = $('.home-search');
  const statusEl = $('.home-search-status');
  const resultsEl = $('.home-results');
  const locateBtn = $('.home-locate');
  const locateError = $('.home-locate-error');
  const confirmBox = $('.home-confirm');
  const confirmLabel = $('.home-confirm-label');
  const confirmHint = $('.home-confirm-hint');

  const show = (elm, visible) => {
    elm.dataset.hidden = String(!visible);
  };

  /* --- search ------------------------------------------------------------- */

  const searcher = createSearcher((state) => {
    if (state.status === 'idle') {
      show(statusEl, false);
      show(resultsEl, false);
      resultsEl.innerHTML = '';
      return;
    }

    if (state.status === 'loading') {
      statusEl.textContent = 'Searching…';
      statusEl.dataset.tone = 'quiet';
      show(statusEl, true);
      /* Results stay on screen while the next search runs — clearing them
       * makes the list flicker on every keystroke. No partial renders. */
      return;
    }

    if (state.status === 'none_matched') {
      /* Distinct from unavailable, and it must READ distinct: this one sends
       * the user back to their typing, not to the manual pin. */
      statusEl.textContent = `No matches for “${state.query}”. Try a different spelling, or drop a pin on the globe.`;
      statusEl.dataset.tone = 'quiet';
      show(statusEl, true);
      show(resultsEl, false);
      resultsEl.innerHTML = '';
      return;
    }

    if (state.status === 'unavailable') {
      statusEl.textContent = state.message;
      statusEl.dataset.tone = 'error';
      show(statusEl, true);
      show(resultsEl, false);
      resultsEl.innerHTML = '';

      if (state.canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'home-retry';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => searcher.now(searchInput.value));
        statusEl.appendChild(document.createTextNode(' '));
        statusEl.appendChild(retry);
      }
      return;
    }

    // status === 'ok'
    show(statusEl, false);
    renderResults(state.results);
  });

  function renderResults(results) {
    resultsEl.innerHTML = '';
    for (const r of results) {
      const li = document.createElement('li');
      li.setAttribute('role', 'presentation');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'home-result';
      btn.setAttribute('role', 'option');
      btn.dataset.confidence = r.lowConfidence ? 'low' : 'high';

      const name = document.createElement('span');
      name.className = 'home-result-label';
      name.textContent = r.label;
      btn.appendChild(name);

      /* Low-confidence results say so BEFORE the user picks one. Surfacing it
       * only after selection means they've already started trusting it. */
      if (r.lowConfidence) {
        const note = document.createElement('span');
        note.className = 'home-result-note';
        note.textContent = 'approximate — you can drag the pin';
        btn.appendChild(note);
      }

      btn.addEventListener('click', () => pick(r));
      li.appendChild(btn);
      resultsEl.appendChild(li);
    }
    show(resultsEl, results.length > 0);
  }

  searchInput.addEventListener('input', () => searcher.input(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searcher.now(searchInput.value);
    }
    /* Down-arrow into the result list — the list is the keyboard surface, so
     * it has to be reachable without a mouse (SPEC §10). */
    if (e.key === 'ArrowDown') {
      const first = resultsEl.querySelector('.home-result');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  resultsEl.addEventListener('keydown', (e) => {
    const items = [...resultsEl.querySelectorAll('.home-result')];
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (items[i + 1] || items[0]).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0) searchInput.focus();
      else items[i - 1].focus();
    }
  });

  /* --- geolocation -------------------------------------------------------- */

  locateBtn.addEventListener('click', async () => {
    show(locateError, false);
    locateBtn.disabled = true;
    locateBtn.dataset.loading = 'true';
    try {
      const pos = await locateMe();
      pick({
        lon: pos.lon,
        lat: pos.lat,
        label: 'My location',
        /* A GPS fix is still confirmed. Phones report accuracy in the tens of
         * metres outdoors and the hundreds indoors, and the user is the only
         * one who knows which they just got. */
        lowConfidence: pos.accuracyM > 100,
        source: 'geolocation',
      });
    } catch (err) {
      /* The message is already human — locateMe() maps the raw
       * GeolocationPositionError codes so no raw error text reaches here. */
      locateError.textContent = err.message;
      show(locateError, true);
    } finally {
      locateBtn.disabled = false;
      delete locateBtn.dataset.loading;
    }
  });

  /* --- pick → preview → confirm ------------------------------------------- */

  function pick(result) {
    pending = { ...result, source: result.source || 'address' };

    onPreview?.({ lon: result.lon, lat: result.lat }, { zoom: GEOCODE.confirmZoom });

    confirmLabel.textContent = result.label || 'Selected location';
    confirmHint.textContent = result.lowConfidence
      ? 'This is approximate. Drag the pin on the globe to place it exactly, then set it as home.'
      : 'Check the pin on the globe. Drag it if it’s not quite right.';
    confirmHint.dataset.tone = result.lowConfidence ? 'warn' : 'quiet';

    show(setupBox, false);
    show(confirmBox, true);
    $('.home-confirm-yes').focus();
  }

  $('.home-confirm-yes').addEventListener('click', () => {
    if (!pending) return;
    /* Read the pin's CURRENT position, not the geocoded one — the user may
     * have dragged it, and the drag is the whole point of the confirm step. */
    const p = getProvisional?.() || { lon: pending.lon, lat: pending.lat };
    const dragged =
      Math.abs(p.lon - pending.lon) > 1e-6 || Math.abs(p.lat - pending.lat) > 1e-6;

    const home = setHome({
      lon: p.lon,
      lat: p.lat,
      /* A dragged pin is no longer the address that was searched for. Keeping
       * the old label would tell the user their home is somewhere it isn't. */
      label: dragged ? null : pending.label,
      source: dragged ? 'pin' : pending.source,
    });

    pending = null;
    onCancelPreview?.();
    onCommit?.(home);
    renderCurrent();
    setOpen(false);
  });

  $('.home-confirm-no').addEventListener('click', () => {
    pending = null;
    onCancelPreview?.();
    show(confirmBox, false);
    show(setupBox, true);
    searchInput.focus();
  });

  /* --- current home ------------------------------------------------------- */

  $('.home-clear').addEventListener('click', () => {
    clearHome();
    renderCurrent();
    searchInput.focus();
  });

  function renderCurrent() {
    const h = getHome();
    if (h) {
      currentLabel.textContent = h.label
        ? `Home: ${h.label}`
        : `Home: ${h.lat.toFixed(3)}, ${h.lon.toFixed(3)}`;
      show(currentBox, true);
    } else {
      show(currentBox, false);
    }
  }

  /* --- open/close --------------------------------------------------------- */

  root.querySelector('.panel-close').addEventListener('click', () => {
    setOpen(false);
    toggleButton.focus();
  });

  function setOpen(next) {
    open = next;
    root.dataset.open = String(open);
    toggleButton.setAttribute('aria-expanded', String(open));
    if (open) {
      renderCurrent();
      show(confirmBox, false);
      show(setupBox, true);
      searchInput.focus();
    } else {
      /* Leaving with an unconfirmed pin on screen would be a lie — it looks
       * like a home that was never set. Clear it. */
      if (pending) {
        pending = null;
        onCancelPreview?.();
      }
      searcher.input(''); // cancel anything in flight
    }
  }

  toggleButton.addEventListener('click', () => setOpen(!open));

  renderCurrent();

  return {
    isOpen: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    refresh: renderCurrent,
    destroy: () => searcher.destroy(),
  };
}
