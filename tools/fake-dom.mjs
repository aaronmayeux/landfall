/**
 * fake-dom.mjs — the smallest DOM the headless view suites can run against.
 *
 * ==> WHAT IT IS FOR, AND WHAT IT CANNOT PROVE. <== tools/test-home.mjs and
 * tools/test-home-ida.mjs drive ui/view-home.js's five render paths on plain
 * node, with no browser. That is worth doing for one assertion above all
 * others: that a source outage never renders the word "clear" (§5). The view is
 * string building over a single innerHTML write, so a fake element with an
 * innerHTML property is a real test of what reaches the screen.
 *
 * It says NOTHING about layout, styling, focus, or events. Anything that is a
 * question about pixels belongs in a Playwright check
 * (tools/drawer-head-check.mjs, tools/stepper-check.mjs) or on glass.
 *
 * ==> IT EXISTS BECAUSE THE VIEW GREW A SECOND DOM DEPENDENCY, NOT TO PAPER
 * OVER ONE. <== The home dashboard used to need exactly one capability: a host
 * with an `innerHTML` and a `querySelector` that answers `.home-dash`. It now
 * also pins ui/storm-stepper.js above that body, which builds a persistent
 * element with `document.createElement` and attaches it with `host.prepend`.
 * The element has to persist across renders — that is the whole reason the
 * stepper's buttons survive their own activation — so it genuinely cannot be
 * part of the innerHTML string. The stub grew to match; it did not grow to
 * hide anything.
 *
 * Nodes here are dumb bags of properties. `querySelector` walks a flat
 * registry keyed by the selectors the code under test actually asks for, which
 * is honest about being a lookup table rather than pretending to be a parser.
 */

/**
 * A single fake element. Enough for building, labelling, hiding, and firing
 * ONE click.
 *
 * ==> THE CLICK IS NOT DECORATION. <== The stepper attaches a real listener to
 * its own element and reads `e.target.closest('[data-step]')` out of the
 * event. A stub whose `addEventListener` swallowed the handler would force the
 * suite to reach past the component and poke `pickedId` directly, which would
 * test the suite's idea of stepping rather than the component's. `dispatch`
 * fires the handler the component actually registered, with a target that
 * answers `closest` the way a real button would.
 */
function fakeNode(tag = 'div') {
  const listeners = {};

  /** One of the stepper's two chevrons: enough of a button to be an event
   *  target that survives `closest('[data-step]')`. */
  const arrowNode = (dir) => ({
    dataset: { step: dir },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    closest(sel) { return sel === '[data-step]' ? this : null; },
    focus() {},
  });

  const node = {
    tagName: tag.toUpperCase(),
    className: '',
    hidden: false,
    innerHTML: '',
    textContent: '',
    dataset: {},
    children: [],
    attrs: {},
    style: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    append(...kids) { this.children.push(...kids); },
    prepend(...kids) { this.children.unshift(...kids); },
    /** Fire a registered handler. Returns false if nothing was listening,
     *  which is itself worth asserting — a component that stopped wiring its
     *  listener would otherwise look like a component that did nothing. */
    dispatch(type, ev) {
      const fns = listeners[type] || [];
      for (const fn of fns) fn(ev);
      return fns.length > 0;
    },
    /* Nothing here parses selectors. It recognises the handful the code under
     * test actually asks for and returns null for anything else, which is the
     * honest answer for a lookup table pretending to be nothing more. */
    querySelector(sel) {
      if (sel.includes('data-step="prev"')) return node._prev;
      if (sel.includes('data-step="next"')) return node._next;
      if (sel.includes('storm-step-count')) return node._count;
      return null;
    },
    querySelectorAll() { return []; },
    focus() {},
    click() { node.dispatch('click', { target: node }); },
  };

  node._prev = arrowNode('prev');
  node._next = arrowNode('next');
  node._count = { textContent: '' };

  /** Press a chevron the way a thumb would. */
  node.press = (dir) =>
    node.dispatch('click', { target: dir === 'next' ? node._next : node._prev });

  return node;
}

/**
 * Install a global `document` for the duration of a suite. Idempotent, and it
 * leaves a real browser's `document` alone if one somehow exists — these
 * suites run on node, but a stub that clobbered a real DOM would be a trap for
 * whoever next tries to run one of them in a browser.
 *
 * @returns {() => void} remove it again
 */
export function installFakeDocument() {
  if (globalThis.document) return () => {};
  globalThis.document = {
    createElement: (tag) => fakeNode(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  return () => { delete globalThis.document; };
}

/**
 * A host element for a drawer view: one inner `.home-dash` whose innerHTML is
 * what the assertions read, plus the `prepend` the pinned stepper needs.
 *
 * @returns {{innerHTML:string, querySelector:Function, read:() => string}}
 */
export function fakeHost() {
  const inner = { innerHTML: '' };
  return {
    innerHTML: '',
    children: [],
    querySelector: (sel) => (sel === '.home-dash' ? inner : null),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    prepend(...kids) { this.children.unshift(...kids); },
    append(...kids) { this.children.push(...kids); },
    /** What actually reached the screen. */
    read: () => inner.innerHTML,
  };
}
