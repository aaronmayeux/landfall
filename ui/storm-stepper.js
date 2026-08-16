/**
 * storm-stepper.js — the chevrons that walk between storms (SPEC-UI §16.5).
 *
 * ==> ONE CONTROL, TWO DRAWERS. <== The home dashboard and the storm detail
 * panel both step through storms, and they used to do it with two hand-built
 * copies that had already drifted: different markup, different wrap arithmetic,
 * and only one of them handled keyboard focus. Two copies of a control is two
 * chances for the thumb to learn one behaviour and meet another. §12's rule —
 * any pattern used twice gets extracted before the second use — was already
 * overdue here.
 *
 * WHAT IT IS: a tight centred cluster, `‹ 2 of 7 ›`, pinned directly under the
 * drawer header on both surfaces.
 *
 * ==> TIGHT AND CENTRED IS THE WHOLE POINT, NOT A STYLE CHOICE. <== The first
 * cut pinned the arrows to the panel's two outer edges, which put the prev
 * chevron a thumb's width below the drawer's Back chevron — same glyph, same
 * size, same color — and the next chevron directly below Close. Aaron on glass
 * 2026-08-12: the left pair are indistinguishable and the right pair means a
 * mis-aimed step dismisses the panel. Pulling the cluster into the middle puts
 * roughly 125px between each arrow and the chrome above it. The other half of
 * that fix is the Back button carrying its destination in words, which is in
 * ui/drawer.js.
 *
 * ==> IT WRAPS, SO NEITHER ARROW IS EVER DEAD. <== A chevron that is present
 * but disabled is a control you have to look at to rule out. At two storms both
 * arrows reach the other one, which is correct. Below two it hides entirely: a
 * stepper through a list of one is furniture, and on a 60vh sheet it would cost
 * pinned height for nothing.
 *
 * ==> THE BUTTONS ARE BUILT ONCE AND NEVER REPLACED. <== They are the only
 * controls in the app that survive their own activation — press next and the
 * drawer re-enters with a different storm — and the drawer moves focus on the
 * next line. A rebuilt button means focus lands on a detached node and gets
 * dumped at the top of the panel on every single press, so walking seven storms
 * by keyboard would be seven trips through the tab order. Only text and labels
 * are rewritten, and `takeFocus()` hands back the button just pressed, once.
 *
 * Imports: nothing. Both callers inject their own list and their own step.
 */

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const CHEVRON = {
  prev: 'M15 5 8 12l7 7',
  next: 'M9 5l7 7-7 7',
};

/**
 * @param {object} o
 * @param {() => Array} o.siblings  every storm, in the order the storm list
 *        draws them. A FUNCTION, not an array: the list re-sorts on every poll
 *        and on every home change, and a captured snapshot would step through
 *        an order that stopped being true minutes ago.
 * @param {() => object|null} o.current  the storm on screen right now.
 * @param {(storm) => void} o.onStep  what a press means. This is where the two
 *        callers differ and the only place they do: the detail panel selects
 *        (camera + panel), the home dashboard focuses (camera only, stay put).
 * @returns {{el:HTMLElement, render:Function, takeFocus:Function}}
 */
export function createStormStepper({ siblings, current, onStep }) {
  const el = document.createElement('div');
  el.className = 'storm-step';
  el.hidden = true;

  const button = (dir) => `
    <button class="storm-step-arrow" type="button" data-step="${dir}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="${CHEVRON[dir]}"/></svg>
    </button>`;

  el.innerHTML = `
    ${button('prev')}
    <span class="storm-step-count"></span>
    ${button('next')}
  `;

  const arrow = (dir) => el.querySelector(`.storm-step-arrow[data-step="${dir}"]`);
  const countEl = el.querySelector('.storm-step-count');

  /** Where each chevron goes right now. Held rather than re-derived in the
   *  click handler, so a button can never announce one storm and navigate to
   *  another. */
  let targets = { prev: null, next: null };

  /** Set on press, consumed by takeFocus(). */
  let pendingFocus = null;

  el.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-step]');
    if (!btn) return;
    const target = targets[btn.dataset.step];
    if (!target) return;
    pendingFocus = btn.dataset.step;
    onStep?.(target);
  });

  /**
   * Recompute position, labels and visibility.
   *
   * ==> CALL IT SYNCHRONOUSLY ON ENTRY, NOT FROM A COALESCED RENDER. <== Both
   * drawers defer their body rebuild, and ui/drawer.js calls `focus()` on the
   * line after `onEnter` returns — before any microtask drains. Anything the
   * reader is handed at that instant has to already be about the storm they
   * just stepped to, or a keyboard user gets a button announcing the one they
   * left. It is three text writes; the coalescing exists to protect the body,
   * not this.
   */
  function render() {
    const storm = current?.() || null;
    const all = (siblings?.() || []).filter(Boolean);
    const i = storm ? all.findIndex((s) => s.id === storm.id) : -1;

    /* A GHOST STORM IS NOT IN THE LIST ANY MORE, so `i` is -1 and the row
     * hides. Correct: stepping "next" from a storm that has left the feed has
     * no defined meaning, and the panel is already saying so. */
    if (i < 0 || all.length < 2) {
      targets = { prev: null, next: null };
      el.hidden = true;
      return;
    }

    /* Modulo both ways so neither end is a dead stop. */
    targets = {
      prev: all[(i - 1 + all.length) % all.length],
      next: all[(i + 1) % all.length],
    };
    el.hidden = false;
    countEl.textContent = `${i + 1} of ${all.length}`;

    /* ==> THE ARROW NAMES ITS DESTINATION TO A SCREEN READER. <== "Next storm"
     * is what a sighted reader infers from position; a reader with no position
     * gets the name instead, which is strictly more and costs nothing. */
    for (const dir of ['prev', 'next']) {
      arrow(dir).setAttribute('aria-label', `Show ${esc(targets[dir].name)}`);
    }
  }

  /**
   * The chevron that was just pressed, or null.
   *
   * ONE-SHOT, and that is what makes it correct rather than sticky. Arriving
   * any other way — a list row, a dot on the globe, a return from Layers —
   * still starts at the drawer's Back button, which is the right first stop
   * for those.
   */
  function takeFocus() {
    if (!pendingFocus) return null;
    const btn = arrow(pendingFocus);
    pendingFocus = null;
    return el.hidden ? null : btn;
  }

  return { el, render, takeFocus };
}
