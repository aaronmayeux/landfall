/**
 * plate-seams.js — fetch the plate boundary file ONCE, and hand the same derived
 * geometry to both renderers.
 *
 * ==> WHY THIS FILE EXISTS AT ALL. <== It used to be two independent readers of
 * one URL. `map/style.js` pointed a MapLibre geojson source straight at
 * `GLOBE.plateBoundariesUrl` and let MapLibre fetch it; `proto/world-deep.js`
 * fetched the same URL itself and built its own line segments. That worked, and
 * it was still wrong: the two copies are pixel-locked to each other through the
 * dive (`map/globe-follow.js`), so any change to how one of them turns
 * coordinates into a line silently unlocks them. Nobody would notice until the
 * crossfade looked slightly soft in the middle — which, per NOW.md, is exactly
 * the class of bug this globe already has one of.
 *
 * Now there is one fetch, one `buildPlateLines`, and one shape. This module owns:
 *
 *   - THE FETCH, and the promise cache in front of it, so the Three globe and
 *     MapLibre share a single request no matter which asks first.
 *   - THE STATUS, in the three states §5 requires: `loading`, `ok` with a count,
 *     and `error` with something a person can read. `empty` is a real fourth
 *     state here — a file that parses to zero boundaries is NOT the same as one
 *     that failed to arrive, and reporting them the same way is how "All Clear
 *     during an outage" happens.
 *   - PUSHING THE DATA IN on every `style.load`, because `map.setStyle()` on a
 *     world switch throws every source's data away and only the declarations
 *     come back.
 *
 * IT DOES NOT OWN THE GEOMETRY. That is `lib/plate-lines.js`, which is pure and
 * testable and knows nothing about maps. Splitting them that way is what lets
 * `tools/test-plate-lines.mjs` check the side-of-the-line rule without a browser.
 *
 * Imports config/ and lib/ and nothing from ui/ — ever.
 */

import { GLOBE } from '../config/constants.js';
import { buildPlateLines } from '../lib/plate-lines.js';
import { PLATE_LABEL_SOURCE } from './style.js';

/** The single in-flight-or-settled request. A module-level promise rather than a
 *  flag plus a value: two callers arriving in the same tick both get this one
 *  promise, which is the whole point, and a flag cannot express "in flight". */
let pending = null;

/**
 * The derived plate network, fetched at most once per session.
 *
 * REJECTS RATHER THAN RETURNING AN EMPTY SHAPE. A caller has to be able to tell
 * "the file is not there" from "the file is there and has nothing in it", and a
 * resolved-but-empty result collapses those two into one. The cache is NOT
 * poisoned by a rejection — `pending` is cleared, so a later caller retries
 * rather than inheriting a failure from whoever went first.
 *
 * @returns {Promise<{seams: object, labels: object, stats: object}>}
 */
export function loadPlateLines() {
  if (!pending) {
    pending = fetch(GLOBE.plateBoundariesUrl)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(buildPlateLines)
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}

/**
 * Fill the two plate sources, and keep filling them across style rebuilds.
 *
 * @param {object} map — the MapLibre map.
 * @param {(state: 'loading'|'ok'|'empty'|'error', message: string) => void} onStatus
 *   Called with every state change. §5: three states minimum, and the error one
 *   carries something readable rather than an exception.
 *
 * ==> REGISTERED ON `style.load`, NOT CALLED ONCE. <== `setStyle` on a world
 * switch destroys source data. The declarations come back with the new style
 * (they are in the style object), the DATA does not, so this has to run again
 * every time. The same reasoning `proto/shell.js` already applies to the
 * graticule, and the same ordering: registered synchronously with the map, so it
 * cannot miss the first event.
 *
 * A WORLD THAT DRAWS NO PLATES HAS NO SOURCES, and `getSource` returns undefined
 * rather than throwing — so this is a no-op on Sky and needs no flag of its own.
 * The fetch still only happens if a source is actually there to fill.
 */
export function attachPlateSeams(map, onStatus = () => {}) {
  const fill = () => {
    const seamSrc = map.getSource('plates');
    const labelSrc = map.getSource(PLATE_LABEL_SOURCE);
    if (!seamSrc || !labelSrc) return;

    onStatus('loading', 'Plate boundaries loading…');
    loadPlateLines().then(
      ({ seams, labels, stats }) => {
        /* Re-checked after the await: a world switch during the fetch can have
         * taken these sources away underneath us, and setData on a dead source
         * throws. */
        const s = map.getSource('plates');
        const l = map.getSource(PLATE_LABEL_SOURCE);
        if (!s || !l) return;
        s.setData(seams);
        l.setData(labels);
        if (!stats.boundaries) {
          onStatus('empty', 'Plate boundaries: file loaded, no lines in it');
          return;
        }
        onStatus(
          'ok',
          `${stats.boundaries} plate boundaries, ${stats.plates} plates named`
        );
      },
      (e) => onStatus('error', 'Plate boundaries unavailable — ' + e.message)
    );
  };

  map.on('style.load', fill);
  /* The first style may already be in before this is called — `createGlobe`
   * builds the map with its style inline, so `style.load` can have fired in an
   * earlier tick. `isStyleLoaded` is the only way to tell, and skipping this
   * check is a globe with no seams on it and no error to explain why. */
  if (map.isStyleLoaded()) fill();
}
