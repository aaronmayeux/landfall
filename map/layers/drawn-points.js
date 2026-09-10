/**
 * drawn-points.js — WHICH STORMS CURRENTLY HAVE FORECAST DOTS ON THE MAP.
 *
 * ==> AT MAP ZOOM A LIVE STORM'S POSITION DOT IS ITS TAU-0 FORECAST POINT,
 * AND WHEN THERE ARE NO FORECAST POINTS THERE IS NO DOT AT ALL. <== That is
 * the whole reason this file exists. NHC publishes an advisory minutes to
 * hours before it publishes the matching shapefiles, and in that window a
 * storm on a phone at basin zoom was a NAME floating over empty ocean — the
 * storm drawer said "the map has this storm's position" and the map did not.
 * Aaron caught it on glass, 2026-09-10. `map/markers.js` draws a stand-in
 * position dot for exactly the storms NOT named here (SPEC-MAP §9), so it
 * needs to know which those are.
 *
 * IT IS "NOTHING WAS DRAWN", NOT "NHC HAS NOT PUBLISHED". A storm whose
 * geometry fetch died outright is in the identical state on screen, so the
 * signal is read off what actually reached the map rather than off any
 * upstream status. One condition, both causes, and neither can be forgotten
 * separately.
 *
 * ==> ITS OWN FILE RATHER THAN A BLOCK INSIDE points-forecast.js, AND §12 IS
 * WHY. <== That file was already 151 lines past the 700 ceiling with a cut
 * owed; adding this to it is exactly the growth the ceiling exists to stop.
 * The concern is also genuinely separate — one module WRITES the set from
 * what it drew, another READS it to decide what to draw instead, and neither
 * of them is this bookkeeping. Both import here; nothing here imports either
 * of them, so the one-directional rule holds and there is no cycle.
 *
 * PURE apart from the listener set. No DOM, no MapLibre, no config.
 */

/** sourceId -> Set(stormId) currently drawn from that source. */
const drawnStorms = new Map();
const listeners = new Set();

/**
 * Storm ids present in a collection of drawn point features.
 *
 * An UNATTRIBUTABLE point is skipped: a dot we cannot tie to a storm cannot
 * vouch for that storm having one. Same rule the label spoke and the first-fix
 * ring already follow, and the `basin`+`stormnum` pair those use for GROUPING
 * is deliberately not accepted here — it is not the id `map/markers.js` keys
 * its features on, so honouring it would answer a question nobody asked.
 */
export function stormIdsIn(features) {
  const ids = new Set();
  for (const f of features || []) {
    const id = f?.properties?._stormId ?? f?.properties?._stormKey;
    if (id != null && id !== '') ids.add(String(id));
  }
  return ids;
}

function sameIds(a, b) {
  if (!a || a.size !== b.size) return false;
  for (const k of b) if (!a.has(k)) return false;
  return true;
}

/**
 * Record what one source is showing, and wake the subscribers only if the set
 * actually moved. Placement reruns on every settled camera move and the drawn
 * set does not change then — waking `markers.js` for that would put a
 * `setData` on the storm source at the end of every pan, which the
 * performance lens settles the other way.
 *
 * @param {string} sourceId  the MapLibre source these features were written to
 * @param {Array}  features  what was written, or null/empty for "nothing"
 */
export function noteDrawn(sourceId, features) {
  const ids = stormIdsIn(features);
  if (sameIds(drawnStorms.get(sourceId), ids)) return;
  drawnStorms.set(sourceId, ids);
  for (const fn of listeners) fn();
}

/**
 * Subscribe to the drawn set changing. Called by `map/markers.js`.
 * @returns {() => void} unsubscribe
 */
export function onForecastPointsDrawn(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Does this storm have forecast dots on the map right now?
 *
 * EITHER SOURCE COUNTS. The selected storm's points ride `sel-fpoints` and
 * every other warmed storm's ride `amb-fpoints`; a storm moving between the
 * two on selection must never read as having lost its dots, or the stand-in
 * would flash on for the moment between one source dropping it and the other
 * picking it up.
 */
export function hasForecastPoints(stormId) {
  if (stormId == null) return false;
  const key = String(stormId);
  for (const ids of drawnStorms.values()) if (ids.has(key)) return true;
  return false;
}
