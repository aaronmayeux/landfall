/**
 * water-at.js — is this point on water? (SPEC-MAP §9.11, SPEC-UI §8.)
 *
 * ==> WHY THIS IS NOT A NETWORK CALL. <== The obvious instinct is to ask the
 * geocoder, and the geocoder cannot answer. Mapbox has no marine gazetteer: a
 * point in the open Atlantic matches no polygon and comes back empty, which is
 * exactly what the middle of the Sahara comes back as. "Nobody named this" and
 * "this is water" are different facts and only one source on the phone knows
 * the second one — the basemap, which has already been downloaded, decoded and
 * drawn on the screen the user is looking at.
 *
 * So the answer is free, instant, works with the network down, and is by
 * construction the same answer the user's own eyes are getting from the globe.
 * A pin sitting visibly in blue can never be described as land.
 *
 * ==> BOTH SCHEMAS, INVERTED — THE SAME INVERSION map/style.js AND
 *     map/coast-source.js BOTH DOCUMENT. <==
 *
 *   OpenMapTiles (OpenFreeMap, live today) has NO land polygon. Land is the
 *     background and the ocean is a `fill` painted on top. A hit on `ocean`
 *     means water; no hit means land.
 *   Protomaps (R2, if TILES.useR2 is ever flipped) is the other way up. The
 *     ocean is the background and `land` is a real `fill`. A hit on `land`
 *     means land; no hit means water.
 *
 * READING THE ANSWER OFF "no hit" REQUIRES KNOWING WHICH WAY UP WE ARE, and
 * guessing is how this returns confidently wrong answers on the day the tiles
 * flip. So the schema is DETECTED, not assumed: whichever of the two ids is
 * present as a queryable `fill` layer is the one that decides. If neither is,
 * the answer is `unknown` — never a coin toss (§5: no state may quietly
 * impersonate another).
 *
 * ==> AND IT WAITS FOR THE TILES. <== `queryRenderedFeatures` sees only what
 * is decoded right now. Asked one frame after a `flyTo` it reports empty
 * ocean everywhere, because nothing has arrived yet — an answer that looks
 * exactly like a real one. So a probe waits for the map to go idle before it
 * reads, and gives up with `unknown` rather than reading early.
 *
 * Imports: config/ only. No DOM beyond the map object it is handed.
 */

import { GEOCODE } from '../config/constants.js';

/** Inland water counts. A pin on Lake Pontchartrain is over water by every
 *  meaning the user has in mind, and saying "Unnamed location" there while the
 *  screen shows blue would read as a bug. Ordered most-specific first only for
 *  readability; a hit on either is water. */
const WATER_LAYERS = Object.freeze(['ocean', 'water-inland']);

/** The one layer whose presence as a fill tells us the polarity of the tiles. */
const LAND_LAYER = 'land';

/**
 * Which way up is this style? Returns 'land-drawn' (Protomaps: land is a real
 * polygon), 'water-drawn' (OpenMapTiles: ocean is a real polygon), or null if
 * neither can be established.
 *
 * A `background` layer is not queryable and MapLibre returns nothing for it,
 * which is precisely the trap: on OpenMapTiles `land` EXISTS as an id and can
 * never be hit. The `type` check is what tells the two apart.
 */
function polarity(map) {
  const land = map?.getLayer?.(LAND_LAYER);
  if (land && land.type === 'fill') return 'land-drawn';
  const ocean = map?.getLayer?.('ocean');
  if (ocean && ocean.type === 'fill') return 'water-drawn';
  return null;
}

/** Layer ids that exist on this style, so MapLibre is never handed a name it
 *  will warn about. */
const present = (map, ids) => ids.filter((id) => map?.getLayer?.(id));

/**
 * Resolve once the map has stopped loading tiles, or once the wait runs out.
 * Never rejects.
 */
function whenSettled(map, timeoutMs) {
  if (map?.areTilesLoaded?.() && !map.isMoving?.()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let done = false;
    const finish = (settled) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map?.off?.('idle', onIdle);
      resolve(settled);
    };
    const onIdle = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    map?.once?.('idle', onIdle);
  });
}

/**
 * Is this point on water?
 *
 * @param {object} map        the MapLibre map
 * @param {{lon:number, lat:number}} at
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] how long to wait for tiles before giving up
 * @returns {Promise<'water'|'land'|'unknown'>}
 *
 * `unknown` is a real answer and callers must handle it — it is what comes
 * back offline, before the tiles land, or on a style this file does not
 * recognise. Rendering it as either "land" or "water" would be the silent
 * failure §5 exists to prevent.
 */
export async function waterAt(map, at, { timeoutMs = GEOCODE.waterProbeMs } = {}) {
  if (!map?.project || !at || !Number.isFinite(at.lon) || !Number.isFinite(at.lat)) {
    return 'unknown';
  }

  const settled = await whenSettled(map, timeoutMs);
  if (!settled) return 'unknown';

  const dir = polarity(map);
  if (!dir) return 'unknown';

  let point;
  try {
    point = map.project([at.lon, at.lat]);
  } catch {
    return 'unknown';
  }
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return 'unknown';

  /* OFF-SCREEN IS NOT UNKNOWN-BY-DEFAULT, IT IS UNKNOWN-IN-FACT. Only rendered
   * pixels can be queried, so a point the camera is not showing has no answer
   * here. Every caller flies to the point first, so this is a guard rather
   * than a case — but a silent wrong answer is what it prevents. */
  const canvas = map.getCanvas?.();
  if (canvas && (point.x < 0 || point.y < 0 || point.x > canvas.clientWidth || point.y > canvas.clientHeight)) {
    return 'unknown';
  }

  const hit = (ids) => {
    const layers = present(map, ids);
    if (!layers.length) return null;
    try {
      return map.queryRenderedFeatures(point, { layers }).length > 0;
    } catch {
      return null;
    }
  };

  if (dir === 'land-drawn') {
    /* Ocean is the background here, so LAND is the thing that can be hit and
     * inland water is drawn on top of it — check the water first, or a lake
     * reports as the land polygon underneath it. */
    const onWater = hit(['water-inland']);
    if (onWater === true) return 'water';
    const onLand = hit([LAND_LAYER]);
    if (onLand === null) return 'unknown';
    return onLand ? 'land' : 'water';
  }

  const onWater = hit(WATER_LAYERS);
  if (onWater === null) return 'unknown';
  return onWater ? 'water' : 'land';
}
