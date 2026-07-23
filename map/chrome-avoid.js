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

/* Everything an interactive overlay must not sit under. Anything that would
 * swallow a tap belongs here — including the small attribution button. */
export const CHROME_SELECTORS = [
  '#controls',
  '#storm-pill:not([data-hidden="true"])',
  '#status .chip[data-visible="true"]',
  '#panel-storms[data-open="true"]',
  '#panel-home[data-open="true"]',
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
  '#panel-storms[data-open="true"]',
  '#panel-home[data-open="true"]',
];

/** Rects of everything currently on screen that an overlay must dodge.
 *
 *  getBoundingClientRect() is a layout read, which is normally forbidden in a
 *  render loop — so this is called at most once per animation frame and the
 *  result is cached by the caller. */
export function measureChrome(pad, selectors = CHROME_SELECTORS) {
  const rects = [];
  for (const sel of selectors) {
    for (const node of document.querySelectorAll(sel)) {
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
