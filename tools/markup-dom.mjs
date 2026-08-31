/**
 * markup-dom.mjs — a DOM small enough to read, for the view suites that need
 * to PARSE what a view emitted and then press something in it.
 *
 * ==> IT IS NOT `tools/fake-dom.mjs` AND THE TWO ARE NOT REDUNDANT. <== That
 * one is an honest lookup table: nodes are dumb bags of properties and
 * `querySelector` answers a fixed registry of selectors. It is exactly right
 * for the home suites, which assert on one `innerHTML` string and never touch
 * anything. It cannot fire a click, cannot answer `closest`, and has no idea
 * what a row is.
 *
 * This one turns a view's own markup back into nodes, so a suite can find the
 * button the reader would press and press it — with an event whose target
 * answers `closest` the way a real one does. That matters because the views it
 * drives bind ONE delegated listener on their body and read
 * `e.target.closest('[data-open]')` out of the event: a suite that reached past
 * that and called the handler directly would be testing its own idea of the
 * interaction rather than the view's.
 *
 * ==> EXTRACTED WHEN IT WAS ABOUT TO BE USED TWICE, WHICH IS §12'S RULE. <==
 * It lived inside `tools/test-seasons-board.mjs` until the archive's storm
 * detail panel (§57.22, step 7) needed the same thing. That suite is the proof
 * the extraction changed nothing: it exercises every branch below and it went
 * on passing unchanged.
 *
 * ==> IT IS DELIBERATELY NOT A GENERAL PARSER, AND EVERY GAP IN IT HAS LIED AT
 * LEAST ONCE. <== The notes below are that history. A selector this cannot
 * read does not throw — it returns false, which is indistinguishable from an
 * element that simply does not match, so the suite reports the VIEW as broken.
 * Anything added here must be made readable rather than worked around in the
 * view.
 *
 * Zero dependencies. Imported by suites, never by the app.
 */

export class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.dataset = {};
    this.checked = false;
    /* ==> THE MASTER BOX'S THIRD STATE, AND IT DEFAULTS TO FALSE RATHER THAN
     * UNDEFINED. <== §57.21b item 4. `indeterminate` is a property and not an
     * attribute, so it cannot arrive through `parseHtml` — the view sets it
     * after every render. Left undefined here, a suite asserting "not the
     * middle state" would be asserting against a value the app never wrote,
     * which passes whether or not the app is doing its job. */
    this.indeterminate = false;
    this.value = '';
    this._html = '';
    this._listeners = new Map();
  }

  set innerHTML(html) {
    this._html = html;
    this.children = parseHtml(html, this);
  }

  get innerHTML() { return this._html; }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  /* ==> ADDED FOR STEP 6'S FOCUS, WHICH PATCHES ROWS INSTEAD OF RE-RENDERING.
   * <== The view deliberately does NOT rebuild the roster when focus moves —
   * that would cost the reader their scroll position and their focus ring on
   * the feature's most frequent interaction — so it reaches for `classList`
   * and `setAttribute` on the rows that already exist. Without these the
   * assertions below would be testing a stand-in that silently does nothing,
   * which is exactly the failure the note on `matches` above describes. */
  get classList() {
    const el = this;
    const read = () => (el.attrs.class || '').split(/\s+/).filter(Boolean);
    const write = (list) => { el.attrs.class = list.join(' '); };
    return {
      contains: (c) => read().includes(c),
      add(c) { const l = read(); if (!l.includes(c)) { l.push(c); write(l); } },
      remove(c) { write(read().filter((x) => x !== c)); },
      toggle(c, on) {
        if (on === undefined) on = !read().includes(c);
        if (on) this.add(c); else this.remove(c);
      },
    };
  }

  /* ==> ADDED FOR §57.21b ITEM 6, AND IT RECORDS RATHER THAN PRETENDS. <== A
   * tap on a track marks the row AND scrolls to it, because with a 28-row
   * roster the marked row is usually off-screen. There is no layout in here to
   * scroll, so the call is remembered instead — a stand-in that silently
   * absorbed it would let a mutation deleting the scroll pass green, which is
   * the failure §12 calls worse than no test. */
  scrollIntoView(opts) {
    this.scrolledIntoView = opts || {};
  }

  /** ==> ADDED WITH `prepend` BELOW, AND FOR THE SAME COMPONENT. <== The year
   *  stepper builds its three children rather than parsing them out of a
   *  string, which is the right shape for a persistent control — see the note
   *  at the top of `ui/year-stepper.js`. `parent` is set because `closest`
   *  walks that chain. */
  append(...kids) {
    for (const k of kids) k.parent = this;
    this.children.push(...kids);
  }

  /** ==> ADDED FOR THE ARCHIVE'S PINNED YEAR STEPPER (§57.39a). <== That
   *  control is a persistent element attached ABOVE the scrolling body rather
   *  than part of its `innerHTML` — its two buttons have to survive their own
   *  activation, so they cannot be rebuilt on every render. `ui/drawer.js`'s
   *  live steppers use the same call. Without this the view threw on mount and
   *  the whole suite reported a broken board.
   *
   *  It sets `parent`, which is not optional: `closest` walks that chain, and
   *  a stepper whose buttons had no parent would answer null to the very
   *  selector its own listener reads out of the event. */
  prepend(...kids) {
    for (const k of kids) k.parent = this;
    this.children.unshift(...kids);
  }

  /* ==> `className` IS THE SAME THING AS THE `class` ATTRIBUTE, AND THIS STOOD
   *  IN AS A PLAIN PROPERTY UNTIL §57.39a. <== Markup parsed out of a template
   *  lands in `attrs.class`, which is what `matches` reads — but a component
   *  that BUILDS its element writes `el.className`, and the archive's pinned
   *  year stepper is the first one this suite drives. Left unmapped it set an
   *  own property nothing consults, so `.seasons-year` matched nothing and the
   *  suite reported a view that was working. That is the fourth time this
   *  stand-in has told that particular lie; see the notes on `matches`. */
  /* ==> `disabled` REFLECTS TO THE ATTRIBUTE, BECAUSE ON A REAL BUTTON IT
   *  DOES. <== Markup carrying a bare `disabled` lands in `attrs`; a component
   *  that toggles the state at runtime writes the PROPERTY, and the browser
   *  keeps the two in step. This stand-in did not, so the archive's year
   *  stepper disabling its `−` at 1851 was invisible to every assertion that
   *  reads `attrs.disabled` — the control was working and the suite could not
   *  see it. Same lie as `className` above, in the other direction. */
  get disabled() { return this.attrs.disabled !== undefined; }

  set disabled(on) {
    if (on) this.attrs.disabled = '';
    else delete this.attrs.disabled;
  }

  get className() { return this.attrs.class || ''; }

  set className(v) { this.attrs.class = String(v); }

  /* ==> `id` AND `hidden` REFLECT TO ATTRIBUTES FOR THE REASON `className` AND
   *  `disabled` ABOVE DO, AND THEY TOLD THE SAME LIE. <== A component that
   *  BUILDS its element writes the property — `el.id = 'btn-season-clock'`,
   *  `el.hidden = true` — while markup parsed out of a template lands in
   *  `attrs`. Unmapped, `id` set an own property nothing consults, so
   *  `getElementById` found nothing and the suite reported a control that had
   *  never mounted. That is the fifth time this stand-in has told that
   *  particular lie; see every note on `matches`. */
  get id() { return this.attrs.id || ''; }

  set id(v) { this.attrs.id = String(v); }

  get hidden() { return this.attrs.hidden !== undefined; }

  set hidden(on) {
    if (on) this.attrs.hidden = '';
    else delete this.attrs.hidden;
  }

  setAttribute(name, value) { this.attrs[name] = String(value); }

  removeAttribute(name) { delete this.attrs[name]; }

  getAttribute(name) { return this.attrs[name] ?? null; }

  /** Bubble to the delegated listener on the scroller, the way a real event
   *  does — the view binds on the body and reads `e.target.closest(...)`.
   *
   *  ==> `init` AND `preventDefault` WERE ADDED FOR THE KEYBOARD SELECT PATH.
   *  <== The board listens for `keydown` and reads `e.key`, then swallows the
   *  event. A stand-in firing a bare `{ target }` gave the view `undefined`
   *  for the key and threw on `preventDefault`, which is the same class of
   *  silent lie the notes below describe: the stand-in has to be able to say
   *  what a real event says, or the suite tests something the app never does. */
  fire(type, target, init = {}) {
    const e = { target, preventDefault() {}, stopPropagation() {}, ...init };
    for (const fn of this._listeners.get(type) || []) fn(e);
  }

  /** ==> A NO-OP, BUT IT HAS TO EXIST. <== A view that moves focus after a
   *  repaint is doing the right thing (§13), and a stand-in without this
   *  throws a TypeError in the middle of a click handler — which reads as the
   *  VIEW being broken rather than as the scaffold being thin. Same rule as
   *  the compound-selector note above: anything the stand-in cannot do gets
   *  made readable here rather than worked around in the app. Nothing asserts
   *  on focus in `node`; where focus matters it is a real-browser check. */
  focus() {}

  /** ==> ADDED FOR THE SEASON CLOCK, WHICH TEARS ITS OWN CONTROLS DOWN
   *  (§57.67 slice C). <== That component mounts a button into `#controls` and
   *  a pill onto the body and removes both on the way out of the archive, and
   *  `unmount` is half of what its suite has to be able to check — a stand-in
   *  without this threw inside the teardown, which reads as the COMPONENT
   *  failing to unmount rather than as the scaffold being thin. Same rule as
   *  every note above it: what this cannot do gets made readable here rather
   *  than worked around in the app. */
  /** ==> `appendChild` IS NOT A SYNONYM ANYBODY CHOSE, IT IS WHAT THE ARCHIVE'S
   *  CHROME ALREADY CALLS. <== `seasons/pill.js`, `seasons/status-pill.js` and
   *  the season clock all mount with `document.body.appendChild(el)`, which is
   *  the older single-node form. Teaching the app to say `append` instead so a
   *  stand-in could read it would be working around the scaffold in the app,
   *  which is the one thing every note in this file says not to do. */
  appendChild(kid) {
    this.append(kid);
    return kid;
  }

  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i !== -1) this.parent.children.splice(i, 1);
    this.parent = null;
  }

  descendants() {
    const out = [];
    for (const c of this.children) { out.push(c); out.push(...c.descendants()); }
    return out;
  }

  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
    return null;
  }

  matches(sel) {
    /* ==> A COMPOUND SELECTOR IS SPLIT AND EVERY PART MUST MATCH. <== Added
     * with step 6's focus, and for the reason the note below already gives:
     * `.seasons-row[data-row]` fell through to the tag-name comparison and
     * returned false for every element in the document, so the view looked
     * like it had simply never marked a row. The stand-in has now told this
     * lie twice; anything it cannot read must be made readable rather than
     * worked around in the view. */
    const parts = sel.match(/(?:\[[^\]]*\]|[.#]?[\w-]+)/g) || [sel];
    if (parts.length > 1) return parts.every((p) => this.matches(p));

    /* `[data-step]` and `[data-retry="live"]` both. ==> THE VALUE FORM WAS
     * MISSING AND IT FAILED SILENTLY. <== `matches` returning false is what a
     * non-matching element does, so a selector this stand-in could not read
     * looked exactly like a button nobody pressed, and the suite reported the
     * view as broken. Anything added here must be readable, or the next
     * unreadable selector tells the same lie. */
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const inner = sel.slice(1, -1);
      const eq = inner.indexOf('=');
      const attr = eq === -1 ? inner : inner.slice(0, eq);
      const want = eq === -1 ? null : inner.slice(eq + 1).replace(/^["']|["']$/g, '');
      const key = attr.replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
      /* ==> IT READS `attrs` AS WELL AS `dataset`, AND THAT IS THE THIRD TIME
       * THIS STAND-IN HAS TOLD THE SAME LIE. <== It only ever consulted
       * `dataset`, so `[type="checkbox"]` — an ordinary attribute, not a data
       * one — matched nothing in the document and `querySelectorAll` came back
       * empty. Which is indistinguishable from a view that never rendered a
       * checkbox, and that is precisely how §57.21c's disabled-box assertions
       * first failed against a view that was doing the right thing.
       *
       * `dataset` is tried first so `[data-storm]` keeps working through the
       * camel-cased key; `attrs` is the fallback and covers the bare-attribute
       * form (`[disabled]`), which the tag scanner stores as an empty string. */
      const got = this.dataset[key] !== undefined ? this.dataset[key] : this.attrs[attr];
      return want == null ? got !== undefined : got === want;
    }
    if (sel.startsWith('.')) return (this.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('#')) return this.attrs.id === sel.slice(1);
    return this.tagName === sel.toUpperCase();
  }

  /**
   * ==> A DESCENDANT COMBINATOR IS A WALK, NOT A COMPOUND. <== Added
   * 2026-08-29, and it is the FOURTH lie this stand-in has told in the same
   * shape. `matches()` splits a selector into parts and demands every part
   * match ONE element, which is right for `.a[data-b]` and completely wrong
   * for `.a .b` — the space means "inside", so the parts belong to different
   * elements. Handed `.detail-section[data-section="peak"] .detail-section-head`
   * it required one element to be both, found none, and returned null.
   *
   * ==> WHICH IS INDISTINGUISHABLE FROM THE VIEW NEVER RENDERING THE HEAD.
   * <== Same failure as the three recorded above it: a selector this file
   * cannot read looks exactly like markup the app did not draw, so the suite
   * reports a working view as broken and the next session goes looking in the
   * wrong file. `NOW.md`'s rule is that anything this stand-in cannot read is
   * made readable here rather than worked around in the view or in the test.
   *
   * Right-to-left, which is how a browser does it and is also the cheap way:
   * find the elements matching the LAST step, then walk each one's ancestors
   * satisfying the earlier steps in reverse. Child (`>`), sibling and
   * pseudo-class combinators are still unsupported and will fall through to
   * `matches` as one compound — if one is ever needed, add it here.
   */
  matchesPath(sel) {
    const steps = sel.trim().split(/\s+/);
    if (steps.length === 1) return this.matches(sel.trim());
    if (!this.matches(steps[steps.length - 1])) return false;
    let n = this.parent;
    let i = steps.length - 2;
    while (n && i >= 0) {
      if (n.matches(steps[i])) i--;
      n = n.parent;
    }
    return i < 0;
  }

  querySelector(sel) {
    return this.descendants()
      .find((n) => sel.split(',').some((s) => n.matchesPath(s.trim()))) || null;
  }

  querySelectorAll(sel) {
    return this.descendants().filter((n) => sel.split(',').some((s) => n.matchesPath(s.trim())));
  }
}

/** Enough of a tag scanner for the view's own markup. Not a general parser —
 *  it exists to turn the strings this one file emits back into nodes. */
export function parseHtml(html, parent) {
  const out = [];
  const stack = [];
  const re = /<(\/?)([a-z][a-z0-9]*)((?:\s+[^>]*?)?)(\/?)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, attrText, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    const el = new El(tag);
    for (const a of attrText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const [, name, value = ''] = a;
      el.attrs[name] = value;
      if (name.startsWith('data-')) {
        el.dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
      }
      if (name === 'checked') el.checked = true;
      if (name === 'value') el.value = value;
      if (name === 'selected') el.attrs.selected = '';
    }
    const host = stack[stack.length - 1] || parent;
    el.parent = host;
    (stack.length ? host.children : out).push(el);
    if (!selfClose && !['input', 'br', 'hr', 'img'].includes(tag.toLowerCase())) stack.push(el);
  }
  return out;
}


/**
 * Install a global `document` these views can build against.
 *
 * ==> IT GREW A `body`, A `documentElement`, `getElementById` AND
 * `createElementNS` FOR THE SEASON CLOCK (§57.67 slice C). <== That component
 * is the first one these suites drive that reaches OUT of its own subtree: it
 * prepends its button into `#controls`, appends its pill to the body, and flags
 * the root element so a stylesheet rule can take the archive's caption pill off
 * screen. All four are real calls on a real path, and a document without them
 * threw inside `mount` — which reads as a broken component rather than as a
 * thin stand-in, the same lie every note on `El.matches` records.
 *
 * `getElementById` walks the body rather than consulting a registry, so a
 * suite has to actually attach the host it expects the component to find. A
 * registry would have let a component that looked up the wrong id pass.
 *
 * @returns {() => void} remove it again
 */
export function installMarkupDocument() {
  const had = globalThis.document;
  const body = new El('body');
  const root = new El('html');

  /* ==> AND IT GREW AN EVENT SYSTEM OF ITS OWN FOR §57.67 SLICE D. <== The
   * season clock binds `keydown` on the DOCUMENT, because Space has to play and
   * pause with focus anywhere — on the globe, on a roster row, on nothing —
   * which is the same argument `attachEscape` in `map/globe.js` makes. A
   * document without `addEventListener` threw inside `mount`, which is the
   * sixth time this file has read as a broken component rather than as a thin
   * stand-in.
   *
   * `visibilityState` is here for the same component and is deliberately
   * `visible` and settable: the clock pauses itself when the page goes away,
   * and a suite that could not put the page away could not check that it does. */
  const listeners = new Map();

  globalThis.document = {
    body,
    documentElement: root,
    visibilityState: 'visible',
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    /* ==> NOT `dispatchEvent`, AND THE NAME IS THE POINT. <== `El.fire` is what
     * every suite in here already calls, and a document that answered to a
     * different verb for the same act would be one more thing to remember. */
    fire(type, init = {}) {
      const e = { target: null, preventDefault() {}, stopPropagation() {}, ...init };
      for (const fn of [...(listeners.get(type) || [])]) fn(e);
    },
    createElement: (t) => new El(t),
    /* SVG elements are ordinary nodes here. Nothing in these suites asks a
     * stand-in about namespaces, and a component building `<svg>` through
     * `createElementNS` — which every one of ours does, because markup
     * assigned as a string cannot be checked against its own file — needs the
     * call to exist and return something with `setAttribute` on it. */
    createElementNS: (_ns, t) => new El(t),
    getElementById: (id) => body.descendants().find((n) => n.attrs.id === id) || null,
  };
  return () => { globalThis.document = had; };
}
