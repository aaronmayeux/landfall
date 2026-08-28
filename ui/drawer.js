/**
 * drawer.js — THE ONE DRAWER (SPEC §16, "one panel system").
 *
 * There is exactly one panel element on screen. Storms, storm detail, layers,
 * home, and settings are VIEWS INSIDE IT, not sibling panels. The drawer
 * slides in once and does not re-animate when you move between views; only
 * the body crossfades. Three sibling <aside>s alternated by JS (storms,
 * detail, home) read as a stack of drawers fighting each other — which is
 * what this replaces. Layers and Settings never existed as panels at all;
 * they were built as views from the start.
 *
 * NAVIGATION MODEL
 *   - Cluster buttons ENTER a view (storms / layers / home / settings).
 *   - Back means "where I just was", from a real history stack:
 *       storms → detail → layers   ⇒ back lands on that storm's detail,
 *       not on the list. Opening Layers from a storm is a side trip, and
 *       the storm survives it.
 *
 *   ==> AND THE SIDE TRIP IS A PROPERTY OF *WHICH* CLUSTER BUTTON, NOT OF
 *   PRESSING ONE. <== That line above described the app for a month without
 *   being true of it. The detail panel's own Layers shortcut was deleted on
 *   2026-07-25 (one door per layer), which left the floating Layers button as
 *   the only way in — and it called `go`, which throws the stack away. So the
 *   documented route existed nowhere in the running code, and a reader who
 *   opened Layers from a storm got no Back at all.
 *
 *   `clusterAction` below is the whole rule, in one place:
 *
 *     Layers and Settings are SIDE TRIPS. Open one while the drawer is
 *     already showing something and it PUSHES — you went to look at a
 *     setting, and the thing you were reading is still underneath.
 *
 *     Storms and Home are DESTINATIONS. They always `go`. Pressing Home is a
 *     fresh ask by definition (see `fresh` below — the dashboard forgets
 *     which storm you stepped to), and a pushed Home would also lose its
 *     eyebrow, leaving a header that names a storm with nothing saying which
 *     drawer you are in. Both are behaviour, not decoration.
 *
 *     One side trip on top of another SWAPS rather than stacks. Layers then
 *     Settings is not two steps away from the storm, it is one step with a
 *     change of mind, and Back should still be one press. This is what caps
 *     the stack at three: destination → detail → side trip.
 *
 *   - At phone width the cluster is hidden (and untabbable) behind an open
 *     drawer, so none of this arises there; it is the wide layout, where the
 *     drawer is a left rail and the buttons stay in the corner, that needs it.
 *   - Close dismisses the drawer. Per §16 the camera and drawn geometry HOLD;
 *     recenter (button, or Esc twice) is the one way off a selection.
 *   - NO TAB ROW. Home and Settings are configuration — you arrive, you set,
 *     you leave — and nobody switches to them mid-storm. A persistent nav
 *     would cost ~44px of a 60vh sheet forever to duplicate cluster buttons.
 *     Which is also why the cluster hiding itself behind an open sheet
 *     (panels.css, narrow widths) is harmless: while the drawer is open the
 *     only navigation anyone wants is Back, and Back is in the header.
 *
 * WHAT A VIEW IS
 *   { id, title, mount(host), onEnter?(arg, { fresh }), onLeave?(), focus?(),
 *     titleFor?(arg), eyebrow?(), backLabelFor?(arg) }
 *   `fresh` on onEnter means THIS IS A NEW VISIT, not a return: it is true
 *   only for `go`, which clears the history stack, and false for `push` and
 *   for `back`. A view that remembers a choice the reader made inside it —
 *   the home dashboard remembers which storm you stepped to — needs the
 *   difference. Pressing the Home button is a fresh ask and starts over;
 *   coming back from a storm's detail panel is the same visit continuing and
 *   must land where you left it.
 *   `titleFor` lets a view name itself from its argument — the detail panel is
 *   titled with the storm, not the word "Detail". `eyebrow` is for the view
 *   that gives its centre away to something else: the home dashboard titles
 *   itself with the STORM, so it names the drawer in the lead slot instead.
 *   It is only honoured while the view is a root (see renderChrome).
 *   `backLabelFor` is how a view that titles itself with a NODE puts a NAME on
 *   the button pointing back at it. The storm detail's title is a swatch, a
 *   heading and a subtitle — there is no string in it — so the fallback was
 *   the bare word "Storm", and `‹ Storm` from the Layers panel does not say
 *   which storm survived the side trip, which is the entire promise of the
 *   side trip. It returns a plain string or nothing.
 *   mount() is called ONCE, lazily, the first time the view is shown; the
 *   host element is then kept and re-shown. Views own their own DOM and
 *   never touch the drawer chrome.
 *
 * HARD-WON RULES THIS FILE MUST NOT BREAK (SPEC §13)
 *   - A closed panel animated with transform+opacity STAYS FOCUSABLE. Tab
 *     walks through invisible rows. Visibility is handled in panels.css with
 *     a delayed `visibility` transition; this file only flips data-open.
 *   - Hidden views are `hidden` (not merely transparent) for the same reason:
 *     an inactive view's controls must leave the tab order entirely.
 *   - Focus returns to the control that opened the drawer on close, or a
 *     keyboard user is dumped at the top of the document with no idea where
 *     they were.
 *
 * Imports: nothing. main.js wires views in.
 */

/**
 * The two views that are somewhere you STEP ASIDE TO, not somewhere you go.
 *
 * The test is not "is it configuration" — Home is configuration too. It is
 * whether arriving there means you have finished with what you were reading.
 * You open Layers to change what is drawn ON the storm you are looking at, and
 * Settings to change units or theme while you are mid-anything. Neither is a
 * subject in its own right, and both are one press from the corner at every
 * width where they can be reached at all.
 */
export const SIDE_TRIP_VIEWS = new Set(['layers', 'settings']);

/**
 * What a control-cluster press means, given what is already on screen.
 *
 * ==> A PURE FUNCTION, AND THAT IS THE POINT. <== The rule it encodes has four
 * branches and every one of them is invisible when wrong: a `go` where a `push`
 * belonged does not throw, it just quietly loses the Back button, which is
 * exactly the bug this shipped to fix and exactly the bug that hid for a month.
 * Inside main.js's boot closure there was no way to write an assertion about
 * it. Out here, tools/test-drawer-nav.mjs states all four in a table.
 *
 * @returns {'close'|'go'|'push'|'swap'}
 *   close — this view is already showing; the button that opened it dismisses it
 *   go    — enter as a fresh root, throwing the history away
 *   push  — a side trip onto whatever is open; Back returns to it
 *   swap  — a side trip replacing another side trip; the stack does not grow
 */
export function clusterAction(viewId, { open, currentId } = {}) {
  if (open && currentId === viewId) return 'close';
  if (!open || !SIDE_TRIP_VIEWS.has(viewId)) return 'go';
  return SIDE_TRIP_VIEWS.has(currentId) ? 'swap' : 'push';
}

export function createDrawer({ root }) {
  /** @type {Map<string, {def:object, host:HTMLElement, mounted:boolean}>} */
  const views = new Map();

  /** History of {id, arg, from}. Last entry is the current view. Empty = closed.
   *
   *  ==> `from` LIVES ON THE ENTRY, NOT IN ONE VARIABLE BESIDE THE STACK. <==
   *  It is the control that put you on THIS step, and it is what focus returns
   *  to on close (§13 — a keyboard user must land back on the thing they
   *  pressed, not at the top of the document). A single `opener` was correct
   *  while only a cluster button could start a session and nothing else ever
   *  recorded one. Now Layers pushes from its own button on top of a storm, so
   *  there are two answers live at once, and closing from the side trip should
   *  return to the side trip's button. Entries pushed from a row tap carry no
   *  `from` at all, so the lookup walks DOWN to the nearest one that does. */
  let stack = [];
  let open = false;
  /** Change subscribers. The drawer REPORTS navigation rather than each
   *  caller remembering to sync — five call sites means one eventually gets
   *  missed. */
  const changeListeners = new Set();

  function notifyChange() {
    for (const fn of changeListeners) {
      try { fn(); } catch (e) { console.warn('[landfall] drawer subscriber failed:', e); }
    }
  }

  /**
   * ==> THE BACK BUTTON SAYS WHERE IT GOES, IN WORDS. <==
   *
   * It was a bare `‹`. So is the storm stepper's prev chevron, which pins
   * directly underneath it — same glyph, same size, same color, a thumb's
   * width apart. On glass 2026-08-12 they were indistinguishable, and the
   * consequence of missing is not symmetrical: press prev instead of Back and
   * you step a storm, press Back instead of prev and you are out of the panel.
   *
   * The destination was already computed here for the `aria-label`. Putting it
   * on screen costs a few characters of header width, kills the ambiguity
   * outright, and answers a question the icon never could — Back to WHAT. The
   * detail panel is reachable from both the storm list and the home dashboard,
   * so that answer genuinely varies.
   *
   * ==> AND THE LEAD SLOT HOLDS AN EYEBROW WHEN THERE IS NO BACK. <== The home
   * dashboard's title is now the STORM, not the word Home, and a drawer whose
   * header names a storm with nothing saying which drawer you are in reads as
   * the detail panel. The eyebrow is deliberately small and muted rather than
   * title-weight: two things at title weight in one bar is two titles arguing.
   */
  root.innerHTML = `
    <header class="drawer-head">
      <div class="drawer-lead">
        <button class="drawer-back" type="button" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
          <span class="drawer-back-text"></span>
        </button>
        <span class="drawer-eyebrow" hidden></span>
      </div>
      <div class="drawer-title-slot" id="drawer-title"></div>
      <button class="drawer-close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </header>
    <div class="drawer-views" id="drawer-views"></div>
  `;

  const backBtn = root.querySelector('.drawer-back');
  const backTextEl = root.querySelector('.drawer-back-text');
  const eyebrowEl = root.querySelector('.drawer-eyebrow');
  const closeBtn = root.querySelector('.drawer-close');
  const titleEl = root.querySelector('#drawer-title');
  const headEl = root.querySelector('.drawer-head');
  const viewsEl = root.querySelector('#drawer-views');

  const current = () => (stack.length ? stack[stack.length - 1] : null);

  function entry(id) {
    const v = views.get(id);
    if (!v) throw new Error(`[drawer] unknown view: ${id}`);
    return v;
  }

  /** Mount lazily. A view nobody opens costs nothing but its registration. */
  function ensureMounted(v) {
    if (v.mounted) return;
    v.def.mount?.(v.host);
    v.mounted = true;
  }

  function renderChrome() {
    const cur = current();
    if (!cur) return;
    const { def } = entry(cur.id);
    /* titleFor lets a view name itself from its argument — the detail view
     * is titled with the storm, not the word "Detail". */
    const title = def.titleFor ? def.titleFor(cur.arg) : def.title;
    titleEl.innerHTML = '';
    if (typeof title === 'string') {
      const h = document.createElement('h1');
      h.className = 'drawer-title';
      h.textContent = title;
      titleEl.appendChild(h);
    } else if (title && typeof title.nodeType === 'number') {
      /* Duck-typed rather than `instanceof Node`: the bare global is not
       * guaranteed to exist in every context this module is loaded in, and a
       * ReferenceError here would take out the header for every view. */
      titleEl.appendChild(title); // a view may supply richer identity markup
    }

    /* ==> THE ACTIVE VIEW'S NAME, PUBLISHED ON THE ROOT. <== A view's own host
     * already carries `data-view`, but that is a CHILD of the sheet, and the
     * sheet's own height cannot be styled from inside it. The home dashboard
     * needs a fixed height (see the note in panels.css), which is a rule about
     * `#drawer` itself, so the id has to be readable here. */
    root.dataset.view = def.id;

    const canGoBack = stack.length > 1;
    backBtn.hidden = !canGoBack;
    if (canGoBack) {
      const prev = stack[stack.length - 2];
      const prevDef = entry(prev.id).def;
      /* ==> ASK FOR A LABEL BEFORE ASKING FOR A TITLE. <== `titleFor` may
       * return a NODE (the storm identity block: swatch, heading, subtitle),
       * and there is no string in a node to put on a button — which is why
       * this fell through to the plain `title` and read `‹ Storm`. That was
       * tolerable while Back from the detail panel only ever went UP to the
       * list; it is not tolerable now that Layers pushes on TOP of a storm,
       * because "the storm survives the side trip" is the whole promise and
       * `‹ Storm` does not say which one survived.
       *
       * `backLabelFor` is the view's own answer and takes precedence.
       * Otherwise a string title, otherwise the plain name. NEVER the node.
       *
       * ==> AND IT SHORT-CIRCUITS, WHICH IS NOT AN OPTIMISATION. <==
       * `titleFor` is not guaranteed to be free of side effects — the detail
       * panel's assigns its `storm` from the argument, deliberately, so the
       * header can title itself from its own arg. Calling it to label a button
       * pointing at a view that is not on screen would reach into that view's
       * state to produce a string we are about to throw away, and it builds a
       * whole identity node to do it, on every chrome render. */
      let dest = prevDef.backLabelFor?.(prev.arg);
      if (!dest) {
        const prevTitle = prevDef.titleFor
          ? prevDef.titleFor(prev.arg)
          : prevDef.title;
        dest = typeof prevTitle === 'string' ? prevTitle : prevDef.title;
      }
      backTextEl.textContent = dest;
      backBtn.setAttribute('aria-label', `Back to ${dest}`);
    }

    /* THE EYEBROW AND THE BACK BUTTON ARE MUTUALLY EXCLUSIVE, and the reason
     * is not tidiness: they occupy the same slot, and both at once would be
     * two competing answers to "where am I". A view asked for an eyebrow only
     * gets it while it is a root — pushed onto something, its own name is
     * already implied by the button pointing back out. */
    const eyebrow = canGoBack ? null : def.eyebrow?.() || null;
    eyebrowEl.hidden = !eyebrow;
    eyebrowEl.textContent = eyebrow || '';

    /* ==> EVERY HEADER IN THIS APP CARRIES THE SAME X. <== Aaron on glass,
     * 2026-08-28, reversing §57.21b items 5 and 6. The seasons drawer had a
     * minimise chevron, a hover highlight across the whole bar, and a press
     * anywhere on it dismissed the sheet. All three are gone; the archive's
     * header is the storms list's header now, and this function no longer has
     * a per-view branch in it at all.
     *
     * ==> THE THREE WENT TOGETHER BECAUSE THEY WERE ONE THING. <== The hover
     * was the mouse's affordance FOR the press-anywhere target. Removing the
     * highlight and keeping the target leaves a surface that dismisses on a
     * tap and gives no sign that it will, which is the hidden gesture §13
     * forbids — so asking for the highlight to go is asking for the gesture to
     * go with it.
     *
     * ==> AND THE ORIGINAL OBJECTION TO THE X IS ANSWERED BY STEP 5. <== It
     * was that an X reads as "leave", and a reader who presses it expecting to
     * leave and finds themselves still in 2005 has been told the wrong thing.
     * That held while the sheet was the only archive furniture on screen. It
     * is not any more: `‹ Live storms` sits at the top of the globe naming the
     * exit, so the X can mean here what it means everywhere else — dismiss
     * this panel — without being mistaken for the way out. */
  }

  /** Show one view's host, hide the rest. `hidden` (not opacity) so the
   *  inactive views leave the tab order and the accessibility tree. */
  function showOnly(id) {
    for (const [key, v] of views) {
      const active = key === id;
      v.host.hidden = !active;
      v.host.dataset.active = String(active);
    }
  }

  /** `fresh` says HOW the reader got here, and only `go` sets it. See the view
   *  contract at the top of this file: it is the difference between opening a
   *  view and returning to one, which is a difference no view can work out for
   *  itself from the argument alone — `go('home')` and `back()` onto the same
   *  root both arrive with `arg` undefined. */
  function enter(id, arg, { focus = true, fresh = false } = {}) {
    const v = entry(id);
    ensureMounted(v);
    showOnly(id);
    renderChrome();
    v.def.onEnter?.(arg, { fresh });

    /**
     * ==> EVERY VIEW OPENS AT ITS TOP. <== A drawer view is never destroyed —
     * it is `hidden`, which preserves its scroll offset — so re-opening one
     * put the reader wherever they had left it, sometimes days earlier. On
     * glass 2026-08-11 that meant the Home drawer opened with the storm's name
     * half under the title fade, and Layers and Settings both opened with
     * their first segmented control sliced through the middle. It reads as a
     * rendering fault, and worse, the reader cannot tell that there is
     * anything above what they can see.
     *
     * AFTER `onEnter`, NOT BEFORE. A view that rebuilds its body on entry —
     * which the home dashboard does on every render — would have its content
     * replaced immediately after the reset, and a taller body than last time
     * restores the old offset. Resetting afterwards is the only order that
     * survives that.
     *
     * ==> IT IS `.drawer-body` THAT SCROLLS, NOT THE HOST. <== `.drawer-view`
     * is a flex column with no overflow of its own; the body inside it carries
     * `overflow-y: auto` and the mask. Setting `scrollTop` on the host is a
     * silent no-op — it assigns to a property that exists on every element and
     * does nothing on one that cannot scroll, so the wrong version of this
     * would have looked correct in review and changed nothing on glass.
     *
     * ALL OF THEM, and the host too. A view may mount more than one scrolling
     * body — the storm detail mounts its own — and the host itself is reset in
     * case a view is ever styled to scroll directly. Cheap, and it removes the
     * need for this to know each view's internals.
     */
    if (v.host) {
      v.host.scrollTop = 0;
      v.host.querySelectorAll('.drawer-body, .detail-body').forEach((el) => {
        el.scrollTop = 0;
      });
    }
    if (focus) {
      /* A view may nominate its own first stop (the storm list focuses its
       * first row). Otherwise the back button, which is the thing a keyboard
       * user most likely wants next. */
      const target = v.def.focus?.() || (backBtn.hidden ? closeBtn : backBtn);

      /**
       * ==> `preventScroll`, OR THE RESET ABOVE IS UNDONE ON THE SAME FRAME. <==
       * Focusing an element scrolls it into view. The Home drawer nominated its
       * Edit-home button, which is the LAST section of the dashboard, so every
       * open ran: reset to top, then focus, then the browser scrolled the body
       * back to the bottom. On glass that looked exactly like the reset never
       * happening — and the reset is not where the bug was.
       *
       * THE ORDER CANNOT BE SWAPPED INSTEAD. Resetting after focus would fix
       * the offset and put the focus ring somewhere off screen, which is worse:
       * a keyboard user would be typing at a control they cannot see. The right
       * answer is that a view's first stop belongs near the top of its body,
       * and this flag is the backstop for any view that ever forgets.
       *
       * Supported everywhere this app runs (Safari 15+, all Chromium, Firefox).
       * A browser that ignores the option simply behaves as it did before.
       */
      target?.focus?.({ preventScroll: true });
    }
  }

  function leaveCurrent() {
    const cur = current();
    if (!cur) return;
    entry(cur.id).def.onLeave?.();
  }

  function setOpenState(next) {
    open = next;
    root.dataset.open = String(open);
  }

  /* --- public navigation ---------------------------------------------------
   * go()   — enter a view as a fresh root (cluster buttons). Clears history.
   * push() — enter a view keeping history (storms→detail, detail→layers).
   * back() — pop one level.
   * ---------------------------------------------------------------------- */

  /** The nearest control below the current step that recorded itself, for
   *  focus return on close. Walks DOWN because the steps in between may have
   *  come from a row tap, which has no button to go back to. */
  function currentOpener() {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].from) return stack[i].from;
    }
    return null;
  }

  function go(id, arg, { from } = {}) {
    leaveCurrent();
    stack = [{ id, arg, from }];
    setOpenState(true);
    /* ==> THE ONE FRESH ENTRY. <== `go` throws the history away, which is the
     * definition of starting over, so it is the only door that tells a view to
     * forget what the reader chose last time they were inside it. */
    enter(id, arg, { fresh: true });
    notifyChange();
  }

  /**
   * @param {object} [opts]
   * @param {HTMLElement} [opts.from] the control that pushed this step, for
   *   focus return. A row tap passes nothing.
   * @param {boolean} [opts.replaceTop] TAKE THE CURRENT STEP'S PLACE rather
   *   than sitting on top of it. This is `clusterAction`'s `swap`: Layers then
   *   Settings from the corner is one change of mind, not two steps away from
   *   the storm, and Back has to stay one press. Without it the stack has no
   *   ceiling — four buttons in a corner that always push is a stack a reader
   *   can grow all afternoon and then have to unwind.
   */
  function push(id, arg, { from, replaceTop = false } = {}) {
    /* Re-pushing the view you are already on is a no-op, not a duplicate
     * stack entry — otherwise Back walks through the same view twice. */
    const cur = current();
    if (cur && cur.id === id) {
      stack[stack.length - 1] = { id, arg, from: from || cur.from };
      enter(id, arg);
      notifyChange();
      return;
    }
    leaveCurrent();
    const step = { id, arg, from };
    if (replaceTop && stack.length) stack[stack.length - 1] = step;
    else stack.push(step);
    setOpenState(true);
    enter(id, arg);
    notifyChange();
  }

  function back() {
    if (stack.length <= 1) return false;
    leaveCurrent();
    stack.pop();
    const cur = current();
    enter(cur.id, cur.arg);
    notifyChange();
    return true;
  }

  function close({ restoreFocus = true } = {}) {
    if (!open) return;
    leaveCurrent();
    /* READ BEFORE CLEARING — the opener lives on the stack now, so a `stack =
     * []` above this line would silently drop focus on the floor and a
     * keyboard user would land at the top of the document (§13). */
    const back = currentOpener();
    setOpenState(false);
    stack = [];
    /* Focus must not be left on a control inside a panel that is now
     * off-screen and untabbable (§13). */
    if (restoreFocus) back?.focus?.();
    notifyChange();
  }

  backBtn.addEventListener('click', () => back());
  closeBtn.addEventListener('click', () => close());

  /* Escape is NOT handled here — it is one global contract owned by
   * attachEscape() in map/globe.js (§10, §13). main.js routes it in. */

  return {
    /** Register a view. Call before any navigation. */
    register(def) {
      const host = document.createElement('div');
      host.className = 'drawer-view';
      host.dataset.view = def.id;
      host.hidden = true;
      viewsEl.appendChild(host);
      views.set(def.id, { def, host, mounted: false });
    },

    go,
    push,
    back,
    close,

    /** Fires after any navigation: open, view change, back, or close. */
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },

    isOpen: () => open,
    currentId: () => current()?.id || null,
    currentArg: () => current()?.arg,

    /** True when there is somewhere to go back to — Escape uses this to
     *  decide between stepping back and dismissing outright. */
    canGoBack: () => stack.length > 1,

    /** Re-render the header for the current view — used when a view's title
     *  changes underneath it (a storm's name/category updating on a poll). */
    refreshChrome: renderChrome,

    /** The drawer's real box, for the flyTo offset (§16). offsetWidth/Height
     *  ignore the slide transform, so these are stable mid-animation — a
     *  transformed measurement would lie (§13). */
    box: () => ({ width: root.offsetWidth || 0, height: root.offsetHeight || 0 }),
  };
}
