/**
 * view-layers.js — the Layers view (SPEC §7).
 *
 * THE ONE PLACE ANY LAYER IS TOGGLED. The storm detail view links here rather
 * than carrying its own switches: two controls for one state drift apart, and
 * §7's "the toggle is the recovery" only means something if there is exactly
 * one toggle per layer.
 *
 * Rules this file implements:
 *  - Three groups, headers are real <h2>s so screen-reader users jump by
 *    heading. Headers are NOT focusable; rows are.
 *  - EXCLUSIVE PAIRS ARE SEGMENTED CONTROLS, NEVER TWO SWITCHES. Two switches
 *    imply both-on is possible; a segment shows one is chosen. Imagery gets a
 *    third Off segment because, unlike the other pairs, neither-on is its
 *    normal state.
 *  - ROWS DIM, THEY NEVER DISAPPEAR. A missing toggle looks like a bug; a
 *    dimmed one with a stated reason is information. Layers whose phase has
 *    not shipped render with their reason as a subtitle.
 *  - 44px rows; the WHOLE ROW is the hit target, not just the switch.
 *  - Reset to defaults at the bottom.
 *
 * The row STATE machinery (loading / error / unsupported) is built here but
 * mostly unexercised: the only layers live today are pure render toggles that
 * fetch nothing, so no row can currently go amber. It is wired now so the
 * fetching layers land into a row that already knows how to fail (§5: every
 * async surface handles loading, empty, and error-with-recovery explicitly).
 *
 * Imports: config/ only. Layer state arrives through an injected facade from
 * main.js — ui/ never imports data/ (SPEC §12, one-directional imports).
 */

import { layerGroups, isLive } from '../config/layers.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {object} opts
 * @param {object} opts.prefs   injected layer-prefs facade:
 *        { get, pairValue, toggleOn, setPair, setToggle, resetLayers,
 *          isDefault, subscribe, pairLiveOptions }
 * @param {() => object} opts.getLayerStatus
 *        Per-layer runtime status, keyed by layer key:
 *        { [key]: {state:'loading'|'error'|'ok', message?} }. Absent = ok.
 * @param {(key:string) => void} opts.onRetry
 *        Re-toggling an errored row means "try again" (§7) — the toggle IS
 *        the recovery, so there is no second button.
 */
export function createLayersView({ prefs, getLayerStatus, onRetry }) {
  let host = null;
  let unsubscribe = null;

  /* --- markup --------------------------------------------------------------
   * Rebuilt wholesale on state change. The view is small and static in shape,
   * and a full rebuild keeps one render path rather than a patch path that
   * can drift from it. (The storm LIST patches instead, because its rows move
   * under a thumb — these do not.)
   * ---------------------------------------------------------------------- */

  function pairHtml(pair) {
    const live = prefs.pairLiveOptions(pair);
    const value = prefs.pairValue(pair.id);
    /* A segmented control with fewer than two usable segments is not a
     * choice. It still renders — dimmed, with its reason — because a row
     * that vanishes reads as a bug (§7). */
    const usable = live.length >= 2;

    const segs = pair.options
      .map((o) => {
        const ok = isLive(o);
        return `
          <button class="seg" type="button" role="radio"
                  data-pair="${esc(pair.id)}" data-value="${esc(o.value)}"
                  aria-checked="${String(o.value === value)}"
                  ${ok ? '' : 'disabled aria-disabled="true"'}>
            ${esc(o.label)}
          </button>`;
      })
      .join('');

    /* Note precedence:
     *   unusable pair       → its reason, always.
     *   partly-unshipped    → the note names the missing half.
     *   fully live + note   → a STANDING caveat, still shown.
     * That last case is not hypothetical and is easy to lose: the wind field
     * has both segments live but only draws for NHC storms, and a note that
     * disappeared the moment the layer shipped would leave other basins
     * silently blank — §5's "never ship silence" wearing a working control.
     * A note on a live pair therefore means "true whenever this is on",
     * not "not built yet". */
    const note = !usable
      ? `<p class="layer-note">${esc(pair.note || 'Not available yet.')}</p>`
      : pair.note
        ? `<p class="layer-note">${esc(pair.note)}</p>`
        : '';

    return `
      <div class="layer-row layer-row-pair" data-usable="${String(usable)}">
        <div class="layer-row-label" id="lbl-${esc(pair.id)}">${esc(pair.label)}</div>
        <div class="seg-group" role="radiogroup" aria-labelledby="lbl-${esc(pair.id)}">
          ${segs}
        </div>
        ${note}
      </div>`;
  }

  function toggleHtml(t) {
    const live = isLive(t);
    const on = prefs.toggleOn(t.key);
    const status = (getLayerStatus?.() || {})[t.key];

    /* Row state, in precedence order. An error outranks a note: a layer that
     * exists and broke is more urgent than one that has not shipped. */
    let sub = '';
    let tone = '';
    if (live && status?.state === 'loading') {
      sub = 'Loading…';
      tone = 'loading';
    } else if (live && status?.state === 'error') {
      /* Named in human language, near its source, never raw exception text
       * (§5). Re-tapping the row is the retry. */
      sub = status.message || `${t.label} unavailable — tap to retry`;
      tone = 'error';
    } else if (!live && t.note) {
      sub = t.note;
      tone = 'quiet';
    }

    return `
      <button class="layer-row layer-row-toggle switch-row" type="button"
              role="switch" aria-checked="${String(on)}"
              data-toggle="${esc(t.key)}"
              data-tone="${esc(tone)}"
              ${live ? '' : 'disabled aria-disabled="true"'}>
        <span class="layer-row-text">
          <span class="layer-row-label">${esc(t.label)}</span>
          ${sub ? `<span class="layer-row-sub">${esc(sub)}</span>` : ''}
        </span>
        <span class="switch-track" aria-hidden="true"></span>
      </button>`;
  }

  function render() {
    if (!host) return;

    const groups = layerGroups()
      .map((g) => {
        const rows = [
          ...g.pairs.map(pairHtml),
          ...g.toggles.map(toggleHtml),
        ].join('');
        if (!rows) return '';
        return `
          <section class="layer-group">
            <h2 class="layer-group-head">${esc(g.label)}</h2>
            ${rows}
          </section>`;
      })
      .join('');

    host.innerHTML = `
      <div class="drawer-body">
        ${groups}
        <div class="layer-reset-wrap">
          <button class="layer-reset" type="button" ${prefs.isDefault() ? 'disabled' : ''}>
            Reset to defaults
          </button>
        </div>
      </div>`;

    wire();
  }

  function wire() {
    host.querySelectorAll('.seg').forEach((el) => {
      el.addEventListener('click', () => {
        prefs.setPair(el.dataset.pair, el.dataset.value);
        /* No manual re-render: the prefs subscription drives it, so there is
         * exactly one path from state to pixels. */
      });
    });

    host.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.toggle;
        /* An errored row's tap means RETRY, not toggle-off — the toggle is
         * the recovery (§7). Leaving it as a plain toggle would turn a
         * failed layer off and look like the user meant to. */
        if (el.dataset.tone === 'error') {
          onRetry?.(key);
          return;
        }
        prefs.setToggle(key, el.getAttribute('aria-checked') !== 'true');
      });
    });

    host.querySelector('.layer-reset')?.addEventListener('click', () => {
      prefs.resetLayers();
    });
  }

  return {
    id: 'layers',
    title: 'Layers',

    mount(el) {
      host = el;
      render();
      /* Re-render on every state change, whatever caused it — including a
       * change made somewhere else in the app. One subscription, one render
       * path. */
      unsubscribe = prefs.subscribe(() => render());
    },

    /** Runtime layer status may have changed while the view was elsewhere. */
    onEnter() {
      render();
    },

    /** First stop is the first interactive row, not the back button — a
     *  keyboard user entering Layers wants a layer. */
    focus() {
      return host?.querySelector('.seg:not([disabled]), [data-toggle]:not([disabled])');
    },

    /** Called by main.js when a layer's runtime status changes. */
    refresh: () => render(),

    destroy() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
