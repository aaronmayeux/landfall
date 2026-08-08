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
 *    imply both-on is possible; a segment shows one is chosen. EVERY pair
 *    carries an Off segment as of 2026-07-26 — it was imagery's alone on the
 *    reasoning that one sibling of the others is always drawn, which described
 *    their defaults rather than a rule. This view needs no knowledge of that:
 *    it renders whatever `options` the manifest declares, so the Off segments
 *    arrived here as a config change and nothing else.
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
 * Imports: config/ and lib/ only. Layer state arrives through an injected facade
 * from main.js — ui/ never imports data/ (SPEC §12, one-directional imports).
 * (This said "config/ only" while already importing lib/adeck.js for the model
 * swatches; corrected rather than left as a rule the file was breaking.)
 */

import { layerGroups, isLive } from '../config/layers.js';
import { modelColor } from '../lib/adeck.js';
import { formatAge } from '../lib/time.js';

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
  /* The SCROLL CONTAINER, built once and never replaced.
   *
   * This used to be part of the markup that `render()` threw away on every
   * state change, and that is why the panel snapped back to the top every
   * time you touched a switch — the element holding the scroll position was
   * being destroyed along with the rows. Worst on a phone, where the whole
   * panel is 60vh and the Reference group is below the fold: flip City names off
   * and you are back at Wind field, hunting for the row you just used.
   *
   * Keeping the container stable also means scrollTop is a real number to
   * save and put back, rather than something that has to be recomputed from
   * a fresh element that has never been scrolled. */
  let bodyEl = null;
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
    } else if (status?.state === 'info' && status.at != null) {
      /* HOW OLD IS THE PICTURE. Ranked below error and empty — a fault outranks
       * a qualification — and ABOVE the standing caveat, because once frames are
       * drawing, their age is the more useful of the two things this line could
       * say. Aaron asked for it always visible rather than only once stale:
       * "fresh" and "no idea" look identical when the only signal is the absence
       * of a warning.
       *
       * FORMATTED HERE, AT RENDER, from a raw timestamp. map/imagery.js reports
       * on events and its slowest is the five-minute poll, so a sentence built
       * there would sit frozen — a four-minute-old frame still reading "just
       * now", since formatAge flips at two. This row re-renders on panel entry
       * and on every state change, so formatting late is what keeps it true.
       *
       * "Downloaded", never "old". We send no TIME parameter to the vendors, so
       * the frame's own observation time is something we are never told — this
       * is when WE got the bytes, and the picture may already have been older.
       * Wording it as frame age would be a §5 confident wrong answer. */
      sub = `Downloaded ${formatAge(status.at)}`;
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
    /* NO HEADINGS OVER THE *VISUAL* GROUPS. Consensus / globals / hurricane
     * models still order and separate the rows, but the three uppercase
     * labels were a third level of type inside a control already indented
     * under its parent toggle, and every row carries its own second line. The
     * grouping survives as spacing; the words went (2026-07-25).
     *
     * FAMILY HEADINGS ARE A DIFFERENT THING AND DO EARN THEIR PLACE. The old
     * headings named a taxonomy the rows already explained. These name WHICH
     * STORMS A GROUP APPLIES TO — with a hurricane and a typhoon both up,
     * seven rows with no headings is seven controls where four silently do
     * nothing to the storm you are looking at. And they appear only when both
     * families are present, so the single-basin case is unchanged. */
    const families = prefs.modelSelectorGroups();

    const blocks = families.map((fam) => {
      const groups = fam.groups
        .map((g) => {
          const rows = g.rows
            .map((m) => {
              const checked = prefs.modelChecked(m.pref);
              /* The last remaining model IN THIS FAMILY cannot be switched
               * off — the store refuses it, because a family with nothing
               * selected draws silence on every storm it covers. Counting
               * across both families would let this group empty completely
               * while the control still looked live. The button says so by
               * disabling rather than accepting the tap and quietly not
               * changing, which reads as a broken switch. */
              const isLast = checked && prefs.modelsOnInFamily(fam.family) <= 1;
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
          return `<div class="model-group">${rows}</div>`;
        })
        .join('');

      /* The heading is the group's accessible name whether or not it is shown,
       * so a screen-reader user always hears which storms a set of checkboxes
       * applies to — the list is this app's accessibility surface (§16) and a
       * visual-only grouping would not reach it. */
      return `
        <div class="model-family" role="group" aria-label="${esc(fam.label)}">
          ${fam.showHeader && fam.label
            ? `<h3 class="model-family-head">${esc(fam.label)}</h3>` : ''}
          ${groups}
        </div>`;
    }).join('');

    /* A real group label, so a screen-reader user hears the checkboxes as one
     * set belonging to the row above rather than as loose controls. */
    return `
      <div class="model-selector" role="group" aria-label="Which models to draw">
        ${blocks}
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

  /* --- keeping your place across a rebuild ---------------------------------
   *
   * The view still rebuilds wholesale on every state change — one render
   * path, no patch path to drift from it, which is the right call for a
   * screen of static-shaped rows. What was wrong was throwing away the user's
   * position along with the markup. Two things have to survive:
   *
   *   SCROLL, or every toggle bounces you to the top of the panel.
   *   FOCUS, or a keyboard user is dumped at the start of the document the
   *   instant they flip a switch, which is the same class of bug as the
   *   closed-panel tab trap (§13).
   *
   * Focus is restored BY IDENTITY, not by index. Rows appear and disappear —
   * the model selector expands under its parent, a pair's note grows a second
   * line — so "the fourth control" is a different control after a rebuild.
   * The pref key is stable and is what the user actually pointed at.
   * ---------------------------------------------------------------------- */

  /** A selector that will find this control again after the rebuild, or null
   *  if focus was not on something rebuildable. */
  function focusKeyOf(node) {
    if (!node || !bodyEl || !bodyEl.contains(node)) return null;
    const d = node.dataset || {};
    if (d.toggle) return `[data-toggle="${CSS.escape(d.toggle)}"]`;
    if (d.model) return `[data-model="${CSS.escape(d.model)}"]`;
    if (d.pair) {
      return `.seg[data-pair="${CSS.escape(d.pair)}"][data-value="${CSS.escape(d.value)}"]`;
    }
    if (node.classList?.contains('layer-reset')) return '.layer-reset';
    return null;
  }

  function render() {
    if (!bodyEl) return;

    /* Read BEFORE the innerHTML write — after it, both are gone. */
    const scrollTop = bodyEl.scrollTop;
    const focusKey = focusKeyOf(document.activeElement);

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

    bodyEl.innerHTML = `
      ${groups}
      <div class="layer-reset-wrap">
        <button class="layer-reset" type="button" ${prefs.isDefault() ? 'disabled' : ''}>
          Reset to defaults
        </button>
      </div>`;

    wire();

    /* Put it back. Order matters: scroll first, then focus with
     * `preventScroll` — a plain focus() scrolls its target into view, which
     * would undo the line above and land the user somewhere else again. */
    bodyEl.scrollTop = scrollTop;
    if (focusKey) {
      const again = bodyEl.querySelector(focusKey);
      /* A control can legitimately come back DISABLED — Reset disables itself
       * the moment it succeeds, and the last remaining model locks on. Focus
       * would be silently dropped to <body> there, so fall back to the first
       * live control rather than losing the keyboard user entirely. */
      const target =
        again && !again.disabled
          ? again
          : bodyEl.querySelector(
              '.seg:not([disabled]), [data-toggle]:not([disabled]), [data-model]:not([disabled])'
            );
      target?.focus?.({ preventScroll: true });
    }
  }

  function wire() {
    bodyEl.querySelectorAll('.seg').forEach((el) => {
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

    bodyEl.querySelectorAll('[data-toggle]').forEach((el) => {
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

    bodyEl.querySelectorAll('[data-model]').forEach((el) => {
      el.addEventListener('click', () => {
        /* No manual re-render here either — setModel commits to the layer
         * store and the subscription redraws, so the selector and the map
         * can never disagree about which models are on. */
        prefs.setModel(el.dataset.model, el.getAttribute('aria-checked') !== 'true');
      });
    });

    bodyEl.querySelector('.layer-reset')?.addEventListener('click', () => {
      prefs.resetLayers();
    });
  }

  return {
    id: 'layers',
    title: 'Layers',

    mount(el) {
      host = el;
      /* The scroll container is the ONE piece of this view's DOM that outlives
       * a render. Everything inside it is disposable; it is not. */
      host.innerHTML = '<div class="drawer-body" id="layers-body"></div>';
      bodyEl = host.querySelector('#layers-body');
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
      return bodyEl?.querySelector(
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
