/**
 * season-focus.js — one storm brightens, the rest drop to a ghost.
 * §57.21 item 2, §57.30 step 6.
 *
 * ==> THIS FILE IS FORTY LINES AND IT EXISTS ANYWAY, BECAUSE TWO LAYER FILES
 * HAVE TO AGREE ABOUT WHAT "DIMMED" MEANS. <== The tracks live in
 * `season-tracks.js` and the dots live in `season-points.js`, and a
 * focus that brightened one but not the other would be worse than no focus at
 * all — a dimmed track still wearing a full-strength landfall pin reads as a
 * rendering fault, not as emphasis. Putting the expression in either of those
 * files would make the other import it, which is the wrong dependency: the
 * marks do not depend on the tracks, they are siblings that share one rule.
 *
 * ==> IT IS AN EXPRESSION, NOT A LOOP OVER FEATURES. <== The alternative is
 * stamping an `_opacity` property onto every feature and re-pushing the whole
 * GeoJSON on every focus change. That works and it is the slow way round: a
 * `setData` re-tiles the source in the worker, and focus moves on every tap.
 * A paint property swap is evaluated on the GPU against data MapLibre already
 * holds, which is the difference between a repaint and a rebuild.
 *
 * ==> NO THEMED COLOUR MAY EVER ENTER AN EXPRESSION BUILT HERE. <== These read
 * feature data (`['get', 'id']`), and `map/theme-state.js` rule 1b is that a
 * paint property mixing a feature read with a `global-state` reference is
 * evaluated in the worker, which never receives the global state, and silently
 * resolves the colour to BLACK. Opacity is a number and carries no such risk —
 * but a future hand reaching in here to add a colour would find that out on a
 * phone. Opacity only.
 *
 * Imports config only. Nothing imports this but the two season layer files.
 */

import { ARCHIVE_GEO } from '../../config/tokens.js';

/**
 * The opacity a season feature should draw at.
 *
 * @param {string|null} focusId  the storm the reader is looking at, or null
 * @param {number} [full]        what the focused storm draws at
 * @param {number} [dim]         what everything else drops to
 * @returns {number|Array} a plain number when nothing is focused, an
 *   expression when something is
 */
export function focusOpacity(focusId, full = ARCHIVE_GEO.focusedOpacity, dim = ARCHIVE_GEO.dimmedOpacity) {
  /* ==> NO FOCUS IS A PLAIN NUMBER, NOT AN EXPRESSION THAT ALWAYS ANSWERS THE
   * SAME. <== `['case', ['==', ['get','id'], null], …]` would evaluate per
   * feature per frame for the whole time nobody has tapped anything, which is
   * most of the time anyone spends in the archive. It also makes "nothing is
   * focused" a state MapLibre has to compute rather than one it is simply
   * told, and the difference shows up in exactly the place this project cares
   * about: a phone holding frame rate over a season with forty tracks on it. */
  if (!focusId) return full;

  return ['case', ['==', ['get', 'id'], focusId], full, dim];
}
