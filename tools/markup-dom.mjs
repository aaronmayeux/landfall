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

  querySelector(sel) {
    return this.descendants().find((n) => sel.split(',').some((s) => n.matches(s.trim()))) || null;
  }

  querySelectorAll(sel) {
    return this.descendants().filter((n) => sel.split(',').some((s) => n.matches(s.trim())));
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
 * @returns {() => void} remove it again
 */
export function installMarkupDocument() {
  const had = globalThis.document;
  globalThis.document = { createElement: (t) => new El(t) };
  return () => { globalThis.document = had; };
}
