/**
 * view-home.js — setting and reviewing home, as a DRAWER VIEW (SPEC §8).
 *
 * WAS A PANEL, IS NOW A VIEW. The drawer owns the header and the close
 * button; this file owns the setup flow. Home is CONFIGURATION — you arrive,
 * you set it, you leave — which is exactly why it needs no navigation of its
 * own and why the drawer carries no tab row to reach it mid-storm.
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
 * @param {(lonlat:{lon,lat}, opts?:{zoom?:number}) => void} opts.onPreview
 *        Fly the camera and show a PROVISIONAL pin. Not a commit.
 * @param {() => ({lon,lat}|null)} opts.getProvisional
 *        Current provisional pin position — it moves when the user drags it,
 *        so the view must read it at confirm time rather than trusting its own
 *        copy from when the result was picked.
 * @param {() => void} opts.onCancelPreview      Clear the provisional pin.
 * @param {(home) => void} opts.onCommit         Home is now real.
 * @param {() => void} opts.onDone               Close the drawer (home is set).
 * @param {() => ({lon,lat}|null)} opts.getViewCenter
 *        Where the camera is pointed right now — the drop-a-pin path puts the
 *        pin there. Injected rather than read from the map, because ui/ never
 *        imports map/ (§12).
 */
export function createHomeView({
  onPreview,
  getProvisional,
  onCancelPreview,
  onCommit,
  onDone,
  getViewCenter,
}) {
  let host = null;
  let visible = false;
  let pending = null; // the candidate awaiting confirmation

  function buildSkeleton(hostEl) {
    host = hostEl;
    host.innerHTML = `
    <div class="drawer-body">
      <!-- ONE LINE. This was a stacked block: the full address wrapping over
           three lines, with a full-width "Remove home" button underneath. Two
           thirds of the setup screen went to restating something the user
           already knows, and the destructive action was the largest control on
           it. Now the address truncates to one line and delete is a 44px icon
           at the trailing edge — present, reachable, and no longer the most
           prominent thing in the drawer. -->
      <div class="home-current" data-hidden="true">
        <p class="home-current-label"></p>
        <button class="home-clear" type="button" aria-label="Remove home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 7h16"/>
            <path d="M9 7V4.8h6V7"/>
            <path d="M6.5 7l.9 12.2h9.2L17.5 7"/>
            <path d="M10.2 10.5v6M13.8 10.5v6"/>
          </svg>
        </button>
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

        <div class="home-sep"><span>or</span></div>

        <!-- THE THIRD DOOR. Geolocation needs permission, search needs the
             address to be findable, and neither helps someone who lives down a
             road the geocoder puts in the wrong parish. Dropping a pin at the
             middle of the view and dragging it is the path that always works,
             and it was previously only reachable AFTER a successful search —
             the one situation where you least need it. -->
        <button class="home-drop" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 21s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z"/>
            <circle cx="12" cy="11" r="2.2"/>
          </svg>
          Drop a pin on the globe
        </button>
        <p class="home-hint">
          Puts a pin at the middle of the view. Drag it anywhere, then set it as
          your home.
        </p>
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
    wire();
  }

  const $ = (sel) => host?.querySelector(sel);

  /* Elements are LOOKED UP ON ACCESS rather than captured at build time.
   * The view mounts lazily — the searcher's callback and the home
   * subscription can both fire before this view has ever been shown, and a
   * captured reference would be null forever. Every consumer below is
   * null-guarded, so an early fire is a no-op instead of a crash. */
  const el = {
    get currentBox() { return $('.home-current'); },
    get currentLabel() { return $('.home-current-label'); },
    get setupBox() { return $('.home-setup'); },
    get searchInput() { return $('.home-search'); },
    get statusEl() { return $('.home-search-status'); },
    get resultsEl() { return $('.home-results'); },
    get locateBtn() { return $('.home-locate'); },
    get locateError() { return $('.home-locate-error'); },
    get dropBtn() { return $('.home-drop'); },
    get confirmBox() { return $('.home-confirm'); },
    get confirmLabel() { return $('.home-confirm-label'); },
    get confirmHint() { return $('.home-confirm-hint'); },
  };

  const show = (elm, on) => {
    if (elm) elm.dataset.hidden = String(!on);
  };

  const escHtml = (t) =>
    String(t).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Was this a REFUSAL rather than a failure? A timeout or a position-
   *  unavailable error is worth retrying and must not be answered with
   *  permission instructions — that would send someone into Settings to fix a
   *  setting that was never wrong. `locateMe` maps the codes to human text, so
   *  the shape of the message is what is left to test; a `code` is passed
   *  through where the platform gives one. */
  const isDenied = (err) =>
    err?.code === 1 || /denied|permission/i.test(err?.message || '');

  /** The actual tap path, per platform, plus the door that needs no
   *  permission. `standalone` on navigator is iOS Safari's own marker —
   *  capability, never a user-agent parse (§10). */
  function deniedHelpHtml() {
    const ios = 'standalone' in window.navigator;
    const steps = ios
      ? 'On iPhone: open Settings, tap Apps, then Safari, then Location, and ' +
        'set it to Ask or Allow. If you installed Landfall to your home ' +
        'screen, look for Landfall in the Settings app instead.'
      : 'Open the site settings for this page — the icon at the left of the ' +
        'address bar — and set Location to Allow, then try again.';
    return `${escHtml(steps)} <b>Or skip it entirely: drop a pin on the globe below.</b>`;
  }

  /* --- search ------------------------------------------------------------- */

  const searcher = createSearcher((state) => {
    if (state.status === 'idle') {
      show(el.statusEl, false);
      show(el.resultsEl, false);
      el.resultsEl.innerHTML = '';
      return;
    }

    if (state.status === 'loading') {
      el.statusEl.textContent = 'Searching…';
      el.statusEl.dataset.tone = 'quiet';
      show(el.statusEl, true);
      /* Results stay on screen while the next search runs — clearing them
       * makes the list flicker on every keystroke. No partial renders. */
      return;
    }

    if (state.status === 'none_matched') {
      /* Distinct from unavailable, and it must READ distinct: this one sends
       * the user back to their typing, not to the manual pin. */
      el.statusEl.textContent = `No matches for “${state.query}”. Try a different spelling, or drop a pin on the globe.`;
      el.statusEl.dataset.tone = 'quiet';
      show(el.statusEl, true);
      show(el.resultsEl, false);
      el.resultsEl.innerHTML = '';
      return;
    }

    if (state.status === 'unavailable') {
      el.statusEl.textContent = state.message;
      el.statusEl.dataset.tone = 'error';
      show(el.statusEl, true);
      show(el.resultsEl, false);
      el.resultsEl.innerHTML = '';

      if (state.canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'home-retry';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => searcher.now(el.searchInput.value));
        el.statusEl.appendChild(document.createTextNode(' '));
        el.statusEl.appendChild(retry);
      }
      return;
    }

    // status === 'ok'
    show(el.statusEl, false);
    renderResults(state.results);
  });

  function renderResults(results) {
    el.resultsEl.innerHTML = '';
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
      el.resultsEl.appendChild(li);
    }
    show(el.resultsEl, results.length > 0);
  }

  /* --- pick → preview → confirm --------------------------------------------
   *
   * ==> THIS FUNCTION LIVED INSIDE wire() AND THAT WAS A LIVE BUG <==
   *
   * When the event listeners were gathered into `wire()`, `pick` was swallowed
   * into that function's scope along with them. `renderResults()` sits OUTSIDE
   * wire() and calls `pick(r)` from each result button, so every tap on a
   * search result threw `ReferenceError: pick is not defined` — into the
   * console, where nobody using a phone would ever see it. From the outside it
   * looked exactly like the app ignoring the tap: results listed, nothing
   * happened, no way to set a home by address at all.
   *
   * Diagnosed on the live site 2026-07-25 (view-home.js:203). It is declared
   * here, at the view's own scope, alongside everything else that both the
   * searcher callback and the listeners need to reach. Keep it here.
   * ---------------------------------------------------------------------- */

  /** Coordinates, for anything with no address to print. Three decimals is
   *  about 100 m — enough to tell two candidate pins apart, not so much that
   *  it reads as false precision on a dragged marker. */
  const coordText = ({ lat, lon }) => `${lat.toFixed(3)}, ${lon.toFixed(3)}`;

  /**
   * @param {object} result   {lon, lat, label, lowConfidence, source}
   * @param {object} [opts]
   * @param {boolean} [opts.keepZoom]  Leave the camera's zoom alone. A dropped
   *        pin sits at the middle of the view the user framed, so pulling the
   *        camera to a fixed "confirm zoom" would move the ground out from
   *        under the thing they just placed. A geocode result is somewhere
   *        else entirely and does want the zoom.
   */
  function pick(result, { keepZoom = false } = {}) {
    pending = { ...result, source: result.source || 'address' };

    onPreview?.(
      { lon: result.lon, lat: result.lat },
      {
        ...(keepZoom ? {} : { zoom: GEOCODE.confirmZoom }),
        /* THE LABEL FOLLOWS THE PIN. Once it has been dragged this is no
         * longer the address that was searched for, and commit() already
         * refuses to store the old label in that case — so the confirm step
         * must stop showing it too, or the user reads a street name, taps
         * "Set as home", and gets a home with no label at all. Coordinates
         * are the honest stand-in while the pin is somewhere the geocoder
         * never named. */
        onMove: (p) => {
          if (!pending) return;
          const moved =
            Math.abs(p.lon - pending.lon) > 1e-6 ||
            Math.abs(p.lat - pending.lat) > 1e-6;
          if (el.confirmLabel) {
            el.confirmLabel.textContent = moved
              ? coordText(p)
              : pending.label || coordText(pending);
          }
        },
      }
    );

    el.confirmLabel.textContent = result.label || coordText(result);
    el.confirmHint.textContent = result.lowConfidence
      ? 'This is approximate. Drag the pin on the globe to place it exactly, then set it as home.'
      : 'Check the pin on the globe. Drag it if it’s not quite right.';
    el.confirmHint.dataset.tone = result.lowConfidence ? 'warn' : 'quiet';

    show(el.setupBox, false);
    show(el.confirmBox, true);
    $('.home-confirm-yes')?.focus();
  }

  /**
   * Drop a pin at the middle of the current view and go straight to confirm.
   *
   * NO ZOOM CHANGE, deliberately. The user framed this view; the pin belongs
   * where they are looking, and yanking the camera to a "confirm zoom" would
   * move the ground out from under the pin they just asked for. It is marked
   * `lowConfidence` because a view centre is a guess by definition — which is
   * what makes the confirm copy tell them to drag it.
   */
  function dropPin() {
    const c = getViewCenter?.();
    if (!c || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) return;
    pick(
      {
        lon: c.lon,
        lat: c.lat,
        /* NO LABEL. A dropped pin is not an address and inventing one
         * ("Dropped pin") would put a made-up name where the app elsewhere
         * prints the street you searched for. The confirm step and the home
         * box both fall back to coordinates, which is the true thing. */
        label: null,
        lowConfidence: true,
        source: 'pin',
      },
      { keepZoom: true }
    );
  }

  /* Listeners bind at MOUNT, not at construction — the elements do not exist
   * until the drawer hands this view its host. */
  function wire() {
  el.searchInput.addEventListener('input', () => searcher.input(el.searchInput.value));
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searcher.now(el.searchInput.value);
    }
    /* Down-arrow into the result list — the list is the keyboard surface, so
     * it has to be reachable without a mouse (SPEC §10). */
    if (e.key === 'ArrowDown') {
      const first = el.resultsEl.querySelector('.home-result');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  el.resultsEl.addEventListener('keydown', (e) => {
    const items = [...el.resultsEl.querySelectorAll('.home-result')];
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (items[i + 1] || items[0]).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0) el.searchInput.focus();
      else items[i - 1].focus();
    }
  });

  /* --- drop a pin --------------------------------------------------------- */

  el.dropBtn.addEventListener('click', dropPin);

  /* --- geolocation -------------------------------------------------------- */

  el.locateBtn.addEventListener('click', async () => {
    show(el.locateError, false);
    el.locateBtn.disabled = true;
    el.locateBtn.dataset.loading = 'true';
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
       * GeolocationPositionError codes so no raw error text reaches here.
       *
       * A DENIAL IS NOT A DEAD END, and it was being presented as one.
       * "Location permission was denied" is true and completely unactionable:
       * the user cannot re-grant it from this page, because once Safari or
       * Chrome has recorded a denial for an origin the browser stops even
       * asking. So the message is followed by the actual tap path.
       *
       * WE CANNOT OPEN iOS SETTINGS FOR THEM. There is no URL scheme a web
       * page is allowed to use for that — `App-Prefs:` was closed to web
       * content years ago, and anything claiming otherwise is describing a
       * native app. Directions are the whole of what is possible, so the
       * directions had better be right.
       *
       * And the last line is the real answer: the drop-a-pin door needs no
       * permission at all, and it is three inches below this message. */
      el.locateError.innerHTML =
        `<span>${escHtml(err.message)}</span>` +
        (isDenied(err) ? `<span class="home-locate-help">${deniedHelpHtml()}</span>` : '');
      show(el.locateError, true);
    } finally {
      el.locateBtn.disabled = false;
      delete el.locateBtn.dataset.loading;
    }
  });

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
    /* Home is set — the job this view exists for is done, so leave. Closing
     * the drawer rather than sitting on a completed form is the difference
     * between a setup flow and a screen you have to dismiss yourself. */
    onDone?.();
  });

  $('.home-confirm-no').addEventListener('click', () => {
    pending = null;
    onCancelPreview?.();
    show(el.confirmBox, false);
    show(el.setupBox, true);
    el.searchInput.focus();
  });

  /* --- current home ------------------------------------------------------- */

  $('.home-clear').addEventListener('click', () => {
    clearHome();
    renderCurrent();
    el.searchInput.focus();
  });
  }

  function renderCurrent() {
    if (!host) return;
    const h = getHome();
    if (h) {
      /* NO "Home:" PREFIX any more — the drawer is titled Home and this box is
       * the only thing in it, so the word was being said three times on one
       * screen. The address alone, ellipsised by CSS at one line, with the
       * full text on the title attribute for anyone who needs to read it. */
      const text = h.label || `${h.lat.toFixed(3)}, ${h.lon.toFixed(3)}`;
      el.currentLabel.textContent = text;
      el.currentLabel.title = text;
      show(el.currentBox, true);
    } else {
      show(el.currentBox, false);
    }
  }

  /* --- the drawer view contract -------------------------------------------- */

  return {
    id: 'home',
    title: 'Home',

    mount(hostEl) {
      buildSkeleton(hostEl);
      renderCurrent();
    },

    onEnter() {
      visible = true;
      renderCurrent();
      show(el.confirmBox, false);
      show(el.setupBox, true);
    },

    onLeave() {
      visible = false;
      /* Leaving with an unconfirmed pin on screen would be a lie — it looks
       * like a home that was never set. Clear it. */
      if (pending) {
        pending = null;
        onCancelPreview?.();
      }
      searcher.input(''); // cancel anything in flight
    },

    /** The search box is the first stop — it is the path most people take,
     *  and focusing it means a keyboard user can start typing immediately. */
    focus() {
      return el.searchInput;
    },

    refresh: renderCurrent,
    isVisible: () => visible,
    destroy: () => searcher.destroy(),
  };
}
