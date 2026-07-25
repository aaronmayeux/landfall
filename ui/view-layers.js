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

import { layerGroups, isLive, modelSelectorGroups } from '../config/layers.js';
import { MODEL_GROUP_LABEL } from '../config/constants.js';
import { modelColor } from '../lib/adeck.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {object} opts
 * @param {object} opts.prefs   injected layer-prefs facade:
 *        { get, pairValue, toggleOn, setPair, setToggle, resetLayers,
 *          isDefault, subscribe, pairLiveOptions,
 *          modelChecked, modelsOnCount, setModel }
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
     * A note on a live pair means "true whenever this is on", NOT "not built
     * yet" — a standing limitation the user should know about while using a
     * working control.
     *
     * The example that used to sit here was the wind field, "live but NHC
     * only". It is no longer true (GDACS bands confirmed 2026-07-24) and the
     * note is gone. Keeping the mechanism, dropping the example: a caveat
     * that outlives the limitation it described tells the user a working
     * layer is broken, which is its own §5 failure. */
    /* A PAIR REPORTS ITS OWN STATE, exactly as the toggles do (§7: "every row
     * shows its own state"). The pairs went without this until imagery landed
     * because nothing they drew could fail on its own — wind bands and the
     * coastal stripe ride the geometry bundle, whose failures surface on the
     * storm. Imagery fetches per storm from an outside vendor, so it can fail
     * while everything around it is fine, and a segmented control that quietly
     * drew nothing would be the §5 silence-on-failure bug wearing a switch.
     *
     * Same precedence the toggles use: error, then empty, then the standing
     * note. An error outranks a caveat. */
    const status = (getLayerStatus?.() || {})[pair.id];
    let sub = pair.note || '';
    let tone = pair.note ? 'quiet' : '';
    if (!usable) {
      sub = pair.note || 'Not available yet.';
      tone = 'quiet';
    } else if (status?.state === 'loading') {
      sub = 'Loading…';
      tone = 'loading';
    } else if (status?.state === 'error') {
      /* Human language, near its source, never raw exception text (§5).
       * Re-tapping the live segment is the retry — no second button. */
      sub = status.message || `${pair.label} unavailable — tap to retry`;
      tone = 'error';
    } else if (status?.state === 'empty') {
      /* NOT an error. "No radar coverage for these storms" is true and useful;
       * a retry button for it could never work. */
      sub = status.message || '';
      tone = 'quiet';
    }

    const note = sub ? `<p class="layer-note" data-tone="${esc(tone)}">${esc(sub)}</p>` : '';

    return `
      <div class="layer-row layer-row-pair" data-usable="${String(usable)}"
           data-tone="${esc(tone)}">
        <div class="layer-row-label" id="lbl-${esc(pair.id)}">${esc(pair.label)}</div>
        <div class="seg-group" role="radiogroup" aria-labelledby="lbl-${esc(pair.id)}">
          ${segs}
        </div>
        ${note}
      </div>`;
  }

  /**
   * The per-model selector, EXPANDED IN PLACE beneath its parent row (§7).
   *
   * Never a second panel: §16 allows one view at a time, so there is no stack
   * to push onto and a sub-panel would have to be invented rather than used.
   *
   * SWATCHES MAKE THE CONTROL AND THE LEGEND THE SAME OBJECT. A separate map
   * legend would be a second surface listing the same five things, free to
   * drift out of step with what is actually drawn. Here the row IS the key:
   * the colour beside "GFS" is the colour of the GFS line, because both come
   * from the same function.
   *
   * ONLY RENDERED WHEN THE PARENT IS ON. A selector for a layer that is not
   * drawing is five controls that visibly do nothing — and the parent toggle
   * is one tap away, so nothing is hidden that the user cannot reach.
   */
  function modelSelectorHtml() {
    const groups = modelSelectorGroups()
      .map((g) => {
        const rows = g.rows
          .map((m) => {
            const checked = prefs.modelChecked(m.pref);
            /* The last remaining model cannot be switched off — the store
             * refuses it (a layer on with nothing selected draws silence).
             * The control says so by disabling rather than by accepting the
             * tap and quietly not changing, which reads as a broken switch. */
            const isLast = checked && prefs.modelsOnCount() <= 1;
            return `
              <button class="model-row" type="button" role="checkbox"
                      aria-checked="${String(checked)}"
                      data-model="${esc(m.pref)}"
                      ${isLast ? 'disabled aria-disabled="true"' : ''}>
                <span class="model-swatch" aria-hidden="true"
                      style="--swatch:${esc(modelColor(m.tech))}"></span>
                <span class="model-text">
                  <span class="model-label">${esc(m.label)}</span>
                  ${m.sub ? `<span class="model-sub">${esc(m.sub)}</span>` : ''}
                </span>
                <span class="model-check" aria-hidden="true"></span>
              </button>`;
          })
          .join('');
        return `
          <div class="model-group">
            <p class="model-group-head">${esc(MODEL_GROUP_LABEL[g.id] || '')}</p>
            ${rows}
          </div>`;
      })
      .join('');

    /* A real group label, so a screen-reader user hears the five checkboxes
     * as one set belonging to the row above rather than as loose controls. */
    return `
      <div class="model-selector" role="group" aria-label="Which models to draw">
        ${groups}
      </div>`;
  }

  function toggleHtml(t) {
    const live = isLive(t);
    const on = prefs.toggleOn(t.key);
    const status = (getLayerStatus?.() || {})[t.key];

    /* Row state, in precedence order. An error outranks a note: a layer that
     * exists and broke is more urgent than one that has not shipped.
     *
     * A NOTE ON A LIVE ROW IS A STANDING CAVEAT, not a not-built-yet message
     * — the same precedence the pairs already use. Model tracks is the first
     * additive layer to carry one ("NHC storms only"), and it is true
     * whenever the layer is on rather than something a later phase removes.
     * The old branch here only showed notes on DEAD rows, so a live row's
     * caveat would have been silently dropped. */
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
    } else if (live && status?.state === 'empty') {
      /* NOT an error, and the distinction is §5's whole point: "no guidance
       * has been published for this storm yet" is a true and useful thing to
       * say, and offering a retry for it would be a button that cannot work. */
      sub = status.message || '';
      tone = 'quiet';
    } else if (t.note) {
      sub = t.note;
      tone = 'quiet';
    }

    const expanded = live && on && t.expands ? modelSelectorHtml() : '';

    return `
      <div class="layer-row-wrap">
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
        </button>
        ${expanded}
      </div>`;
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
        const pairId = el.dataset.pair;
        const value = el.dataset.value;
        /* TAPPING THE SEGMENT THAT IS ALREADY ON MEANS RETRY. The toggle is
         * the recovery (§7), and for a pair the "toggle" is the live segment
         * — setPair with the value it already holds is a no-op, so without
         * this an errored imagery row would be untappable and the user would
         * have to bounce through Off to try again. */
        if (prefs.pairValue(pairId) === value) {
          onRetry?.(pairId);
          return;
        }
        prefs.setPair(pairId, value);
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

    host.querySelectorAll('[data-model]').forEach((el) => {
      el.addEventListener('click', () => {
        /* No manual re-render here either — setModel commits to the layer
         * store and the subscription redraws, so the selector and the map
         * can never disagree about which models are on. */
        prefs.setModel(el.dataset.model, el.getAttribute('aria-checked') !== 'true');
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
      return host?.querySelector(
        '.seg:not([disabled]), [data-toggle]:not([disabled]), [data-model]:not([disabled])'
      );
    },

    /** Called by main.js when a layer's runtime status changes. */
    refresh: () => render(),

    destroy() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
