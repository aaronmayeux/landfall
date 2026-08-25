/**
 * chrome-avoid.js — keeping screen-space overlays out from under the UI.
 *
 * The globe is covered in chrome: the control cluster, the storm pill, the
 * status strip, and whichever panel is open. Anything positioned freely over
 * the map (today the home pointer; tomorrow storm callouts) has to answer two
 * different questions about that chrome:
 *
 *   CAN THE USER SEE IT?    occludedByChrome() — a visibility test
 *   WHERE MAY IT SIT?       avoidChrome() — a placement solver
 *
 * These are deliberately separate, with different padding, because conflating
 * them is a bug: overshooting the visibility test hides a marker that is
 * plainly on screen.
 *
 * Obstacles are MEASURED from the live DOM rather than hardcoded, because they
 * move: safe-area insets differ per device, the pill hides when the panel
 * opens, the panel docks left when wide and bottom when narrow. A table of
 * coordinates here would be wrong on the first phone that isn't Aaron's.
 *
 * PERFORMANCE CONTRACT: measureChrome() calls getBoundingClientRect(), which is
 * a layout read and is forbidden more than once per animation frame. Callers
 * cache the result per frame — see `chromeCache` in marker-home.js. Chrome does
 * not move between frames except on resize or a panel toggle.
 *
 * Imports: nothing. This is DOM measurement and rectangle maths.
 */

/* ==> THESE SELECTORS ROT SILENTLY, AND THEY DID. <==
 *
 * Both lists named `#panel-storms` and `#panel-home` for three weeks after
 * those two elements were replaced by the single `#drawer`. Nothing failed:
 * `querySelectorAll` on a dead selector returns an empty list, so the drawer
 * simply stopped being an obstacle and stopped being an occluder, and the home
 * marker slid under an open sheet with no pointer ever appearing.
 *
 * A selector is a contract with markup written in a different file. Nothing in
 * the language checks it, so `tools/test-chrome-avoid.mjs` checks it instead:
 * every id named here must exist in index.html or the suite fails.
 */

/* Everything an interactive overlay must not sit under. Anything that would
 * swallow a tap belongs here — including the small attribution button. */
export const CHROME_SELECTORS = [
  '#controls',
  '#storm-pill:not([data-hidden="true"])',
  '#status .chip[data-visible="true"]',
  '#drawer[data-open="true"]',
  '#attrib-host',
];

/* Everything that genuinely HIDES a marker — a subset, and the difference
 * matters. `#attrib-host` is a small corner button: a marker passing behind it
 * is a momentary clip, and flipping to the off-screen pointer for that would
 * make the marker disappear while it is plainly on screen. Worse than the bug
 * it fixes. Only surfaces large and opaque enough to actually conceal a point
 * get to trigger a handoff. */
export const OCCLUDING_SELECTORS = [
  '#controls',
  '#storm-pill:not([data-hidden="true"])',
  '#drawer[data-open="true"]',
];

/* ==> EVERYTHING A TAP ON THE MAP MUST NOT BE ANSWERED THROUGH. <== §57.21d.
 *
 * The archive minimises its sheet when a tap lands on the globe rather than on
 * the furniture, and "on the furniture" is MEASURED here rather than compared
 * against a height — which is what lets one rule cover both shapes the drawer
 * takes. On a phone it is docked to the bottom, so outside it means above it;
 * on a wide screen it is docked left, so outside it means beside it. A
 * hardcoded height would have been wrong on the second one, and wrong again
 * the moment `--seasons-sheet-h` moved.
 *
 * ==> IT IS BELT AND BRACES RATHER THAN A FIX, AND SAYING SO IS THE POINT.
 * <== `#drawer` and `#seasons-bar` are SIBLINGS of `#globe`, not children, so
 * a press on either never reaches MapLibre's own listener and never becomes a
 * map click at all. That is a property of `index.html`'s structure, and
 * nothing in this file or in the tap handler would notice it changing. The
 * list exists so that the day somebody nests a panel inside the map container,
 * the archive does not start dismissing its own sheet.
 *
 * ==> `#seasons-bar` IS THE ONE ID `index.html` DOES NOT CARRY. <== It is
 * created at runtime by `seasons/bar.js`, because the archive's furniture is
 * loaded with the archive and must not be on the boot path. The selector
 * contract still holds — it is just a contract with a different file, and
 * `tools/test-chrome-avoid.mjs` checks it against that one.
 */
export const TAP_BLOCKING_SELECTORS = [
  '#controls',
  '#drawer[data-open="true"]',
  '#seasons-bar',
];

/**
 * Is this element actually on screen, or merely laid out?
 *
 * ==> A FADED CONTROL IS NOT AN OBSTACLE. <== On a phone the control cluster
 * steps aside the moment the drawer opens — `opacity: 0`, `pointer-events:
 * none` (ui/panels.css). It is still laid out, so `getBoundingClientRect`
 * still returns its full box, and without this test the marker was hiding
 * behind buttons that were not on the screen and the pointer was dodging empty
 * air. `display: none` needs no test here; it already measures 0 x 0.
 *
 * A THRESHOLD, NOT `=== '0'`, because the cluster fades over a quarter of a
 * second and spends that time at fractional opacity. Anything under 5% conceals
 * nothing and should not banish a marker mid-transition.
 *
 * ==> THE COST IS ONE COMPUTED-STYLE READ PER OBSTACLE PER FRAME. <== That is
 * acceptable here and only here: `getBoundingClientRect` two lines below has
 * already flushed style and layout, so these reads are served from the same
 * pass, and the caller caches the whole result per frame. Do not lift this
 * helper into anything that runs more often.
 */
function isVisible(node) {
  const cs = (node.ownerDocument?.defaultView || globalThis).getComputedStyle?.(node);
  if (!cs) return true; // no style engine (test shim) — trust the rect
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  return !(parseFloat(cs.opacity) < 0.05);
}

/** Rects of everything currently on screen that an overlay must dodge.
 *
 *  getBoundingClientRect() is a layout read, which is normally forbidden in a
 *  render loop — so this is called at most once per animation frame and the
 *  result is cached by the caller. */
export function measureChrome(pad, selectors = CHROME_SELECTORS) {
  const rects = [];
  for (const sel of selectors) {
    for (const node of document.querySelectorAll(sel)) {
      if (!isVisible(node)) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      rects.push({
        left: r.left - pad,
        right: r.right + pad,
        top: r.top - pad,
        bottom: r.bottom + pad,
      });
    }
  }
  return rects;
}

const inRect = (x, y, r) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * Is this screen point hidden behind on-screen chrome?
 *
 * "Off screen" is not the same question as "can the user see it." A marker
 * sliding under the storm drawer is invisible, but it is still inside the
 * viewport rectangle — so a bounds test alone leaves it officially visible
 * while it sits behind an opaque panel, and no pointer ever appears. That was
 * the bug: the pointer only popped up once home crossed the actual screen edge.
 *
 * Callers pass rects measured with the SMALLER occlusion padding: this asks
 * whether the user can SEE the point, not where a control is allowed to sit.
 */
export const occludedByChrome = (x, y, rects) => rects.some((r) => inRect(x, y, r));

/**
 * Slide a point out of any obstacle it has landed in.
 *
 * Pushes along the axis of SHALLOWEST penetration — the shortest move that
 * clears the obstacle, which keeps the point as close as possible to the
 * direction it is trying to indicate. Repeated a few times because escaping one
 * rect can land inside a neighbour (the control cluster is a column of them).
 *
 * Deliberately NOT a general solver: a handful of axis-aligned rects, a few
 * passes, done. Anything cleverer is complexity nobody asked for.
 */
export function avoidChrome(x, y, rects, bounds) {
  /* A hair past the edge, so the escaped point is strictly OUTSIDE rather than
   * exactly on the boundary (where the next pass would find it inside again). */
  const EPS = 0.5;

  const clampX = (v) => Math.max(bounds.min, Math.min(bounds.maxX, v));
  const clampY = (v) => Math.max(bounds.min, Math.min(bounds.maxY, v));

  let px = x;
  let py = y;

  for (let pass = 0; pass < 6; pass++) {
    let moved = false;

    for (const r of rects) {
      if (!inRect(px, py, r)) continue;

      /* Four ways out, cheapest first. Each is CLAMPED to the viewport before
       * being considered, because an escape that lands under the OS gesture
       * band is not an escape — and clamping afterwards (the first attempt)
       * silently pushed the point straight back inside the obstacle it had
       * just left. Candidates that survive clamping without re-entering the
       * rect are the only real options. */
      const candidates = [
        { x: clampX(r.left - EPS), y: py, cost: px - r.left },
        { x: clampX(r.right + EPS), y: py, cost: r.right - px },
        { x: px, y: clampY(r.top - EPS), cost: py - r.top },
        { x: px, y: clampY(r.bottom + EPS), cost: r.bottom - py },
      ].filter((c) => !inRect(c.x, c.y, r));

      if (candidates.length === 0) {
        /* Boxed in on every side — the obstacle spans the usable viewport in
         * both axes. Nothing sensible to do; leave the point and let the
         * caller's own clamp have the last word. */
        continue;
      }

      candidates.sort((a, b) => a.cost - b.cost);
      px = candidates[0].x;
      py = candidates[0].y;
      moved = true;
    }

    if (!moved) break;
  }

  return { x: clampX(px), y: clampY(py) };
}
