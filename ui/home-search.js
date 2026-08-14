/**
 * home-search.js — the "Search for an address" choice, whole (SPEC-UI §8).
 *
 * ==> ONE OF THREE PEERS, AND THE ONLY ONE WITH A SUB-FLOW. <== Geolocation is
 * a tap and a permission dialog; dropping a pin is a tap. This one is a tap, a
 * keyboard, a debounced request, three response states, a result list that has
 * to be reachable by arrow key, and a keyboard that covers the answers unless
 * something moves them. That is a whole concern, and leaving it inline is what
 * pushed `ui/view-home-setup.js` past the §12 ceiling.
 *
 * IT OWNS ITS OWN MARKUP AS WELL AS ITS BEHAVIOUR. A split where the parent
 * writes the HTML and this file wires it is two files that have to agree about
 * class names forever. `html()` and `mount()` are the same concern.
 *
 * ==> IT IS A CHOICE YOU OPEN, NOT A FIELD SITTING OPEN. <== The panel used to
 * focus this input the instant it appeared, so a phone threw a keyboard over
 * the other two ways to set a home before anything had been read. The box now
 * appears — and takes focus — only on an explicit tap. `aria-expanded` is the
 * accessibility half of that same fact.
 *
 * Imports: data/geocode, ./keyboard, ./loading-dots. Knows nothing about home,
 * the map, or what happens to a result once it is picked.
 */

import { createSearcher } from '../data/geocode.js';
import { revealAboveKeyboard, onKeyboardInset } from './keyboard.js';
import { setDottedText } from './loading-dots.js';

/** The choice row plus its collapsed panel. A template string rather than DOM
 *  building because the parent assembles one `innerHTML` for the whole view. */
export function addressSearchHtml() {
  return `
          <li class="home-choice-item">
            <button class="home-choice" type="button" data-choice="search"
                    aria-expanded="false" aria-controls="home-search-block">
              <span class="home-choice-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                     stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>
                </svg>
              </span>
              <span class="home-choice-text">
                <span class="home-choice-title">Search for an address</span>
                <span class="home-choice-sub">Street, town, or postcode.</span>
              </span>
              <span class="home-choice-chev" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                     stroke-linecap="round" stroke-linejoin="round"><path d="m8 10 4 4 4-4"/></svg>
              </span>
            </button>

            <!-- ONE BLOCK: box, status, results. Grouped because the group is
                 what has to come into view when the keyboard opens — scrolling
                 the input alone puts the results list under the keyboard,
                 which is where the answers are. -->
            <div class="home-search-block" id="home-search-block" data-hidden="true">
              <!-- type="search", NOT type="text", AND THAT IS THE WHOLE FIX
                   for the credit-card menu.

                   Browsers do not honour autocomplete="off" on anything their
                   heuristics read as an address field, and this is a bullseye:
                   a placeholder saying "Street, city, or postcode". Safari and
                   Chrome then offer the user's saved ADDRESSES — and saved
                   addresses live on the same record as saved cards, because a
                   card carries a billing address. Hence a card menu over a
                   hurricane app.

                   A search field is excluded from that machinery by both
                   engines. The name is deliberately not address-shaped for the
                   same reason — Chrome reads name and id as well as the label.
                   The data-* pairs are the opt-outs the password managers
                   respect (1Password, LastPass, Bitwarden, Dashlane); none is
                   a standard, all are one attribute, and between them they
                   cover what people actually have installed. -->
              <input class="home-search" id="home-search" name="place-query"
                     type="search" inputmode="search" enterkeyhint="search"
                     autocomplete="off" autocorrect="off" autocapitalize="off"
                     spellcheck="false"
                     data-1p-ignore data-lpignore="true" data-bwignore="true"
                     data-form-type="other"
                     aria-label="Search for an address"
                     placeholder="Street, city, or postcode"
                     aria-describedby="home-search-status">
              <p class="home-search-status" id="home-search-status" role="status" data-hidden="true"></p>
              <ul class="home-results" role="listbox" aria-label="Address matches" data-hidden="true"></ul>
            </div>
          </li>`;
}

/**
 * @param {object} opts
 * @param {(result:object) => void} opts.onPick  A candidate was chosen. The
 *        caller owns everything after that — the camera, the pin, the confirm.
 */
export function createAddressSearch({ onPick }) {
  let host = null;
  let open = false;
  const unwire = [];

  const $ = (sel) => host?.querySelector(sel);
  const el = {
    get btn() { return $('.home-choice[data-choice="search"]'); },
    get input() { return $('.home-search'); },
    get block() { return $('.home-search-block'); },
    get status() { return $('.home-search-status'); },
    get results() { return $('.home-results'); },
  };

  const show = (elm, on) => { if (elm) elm.dataset.hidden = String(!on); };

  const searcher = createSearcher((state) => {
    if (!el.status || !el.results) return;

    if (state.status === 'idle') {
      show(el.status, false);
      show(el.results, false);
      el.results.innerHTML = '';
      return;
    }

    if (state.status === 'loading') {
      setDottedText(el.status, 'Searching…');
      el.status.dataset.tone = 'quiet';
      show(el.status, true);
      /* Results stay on screen while the next search runs — clearing them
       * makes the list flicker on every keystroke. No partial renders (§5). */
      return;
    }

    if (state.status === 'none_matched') {
      /* Distinct from unavailable, and it must READ distinct: this one sends
       * the user back to their typing, not to the manual pin. */
      el.status.textContent = `No matches for “${state.query}”. Try a different spelling, or drop a pin on the globe.`;
      el.status.dataset.tone = 'quiet';
      show(el.status, true);
      show(el.results, false);
      el.results.innerHTML = '';
      return;
    }

    if (state.status === 'unavailable') {
      el.status.textContent = state.message;
      el.status.dataset.tone = 'error';
      show(el.status, true);
      show(el.results, false);
      el.results.innerHTML = '';

      if (state.canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'home-retry';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => searcher.now(el.input.value));
        el.status.appendChild(document.createTextNode(' '));
        el.status.appendChild(retry);
      }
      return;
    }

    show(el.status, false);
    renderResults(state.results);
  });

  function renderResults(results) {
    el.results.innerHTML = '';
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
       * only after selection means they have already started trusting it. */
      if (r.lowConfidence) {
        const note = document.createElement('span');
        note.className = 'home-result-note';
        note.textContent = 'approximate — you can drag the pin';
        btn.appendChild(note);
      }

      btn.addEventListener('click', () => onPick?.(r));
      li.appendChild(btn);
      el.results.appendChild(li);
    }
    show(el.results, results.length > 0);

    /* THE ANSWERS ARE THE POINT, so put them on screen. The sheet is short
     * with the keyboard up, and a list that appears below the fold has not
     * appeared. Guarded on focus so a late response cannot yank the view
     * while the user has moved on to the pin. */
    if (results.length && document.activeElement === el.input) {
      revealAboveKeyboard(el.block);
    }
  }

  function setOpen(next, { focusInput = true } = {}) {
    open = next;
    show(el.block, next);
    el.btn?.setAttribute('aria-expanded', String(next));
    if (next) {
      if (focusInput) el.input?.focus();
      revealAboveKeyboard(el.block);
    } else {
      /* Closing throws away the query as well as the box. Leaving a stale
       * result list behind a collapsed row means re-opening it shows answers
       * to a question from ten minutes ago. */
      if (el.input) el.input.value = '';
      searcher.input('');
    }
  }

  return {
    /** Wire listeners. The elements must already be in the document. */
    mount(hostEl) {
      host = hostEl;

      /* THE KEYBOARD EATS THIS BOX unless somebody moves it. panels.css lifts
       * the sheet clear using ui/keyboard.js's measurement; this scrolls the
       * group to the top of the sheet so the results have somewhere to appear.
       *
       * ==> ONE TRIGGER NOW, NOT TWO. <== There used to be a second, on
       * `focus`, because the drawer focused this field the instant the view
       * opened and the keyboard was already rising before any listener could
       * run. Nothing focuses it unbidden any more, and `setOpen` reveals it on
       * the tap that opens it. What is left is the keyboard changing height
       * after the fact, which is the only case a listener is still first to
       * know about. */
      unwire.push(onKeyboardInset((px) => {
        /* Only on the way UP, and only for this field. Scrolling on the way
         * down would yank the view out from under somebody who just dismissed
         * the keyboard to look at the globe. */
        if (px > 0 && document.activeElement === el.input) {
          revealAboveKeyboard(el.block);
        }
      }));

      el.btn.addEventListener('click', () => setOpen(!open));
      el.input.addEventListener('input', () => searcher.input(el.input.value));

      el.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          searcher.now(el.input.value);
        }
        /* Down-arrow into the result list — the list is a keyboard surface, so
         * it has to be reachable without a mouse (SPEC §10). */
        if (e.key === 'ArrowDown') {
          const first = el.results.querySelector('.home-result');
          if (first) { e.preventDefault(); first.focus(); }
        }
        /* Esc collapses the choice rather than closing the whole drawer. The
         * drawer's own Esc still works from anywhere else in the panel; this
         * is the narrower escape from the one thing just opened. */
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false, { focusInput: false });
          el.btn.focus();
        }
      });

      el.results.addEventListener('keydown', (e) => {
        const items = [...el.results.querySelectorAll('.home-result')];
        const i = items.indexOf(document.activeElement);
        if (i === -1) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (items[i + 1] || items[0]).focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (i === 0) el.input.focus();
          else items[i - 1].focus();
        }
      });
    },

    isOpen: () => open,
    close: () => setOpen(false, { focusInput: false }),

    /** Cancel anything in flight without touching the open/closed state. */
    reset: () => searcher.input(''),

    destroy() {
      searcher.destroy();
      for (const off of unwire.splice(0)) off();
    },
  };
}
