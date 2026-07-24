/**
 * markers.js — storm glyphs on the MapLibre globe (SPEC §9).
 *
 * The glyph contract:
 *   - Simplified TWO-ARM SPIRAL, rotated by hemisphere — counterclockwise
 *     north, clockwise south. Physically real, free to implement.
 *   - SIZE-scaled by category, never shape-scaled. A Cat 5 is a bigger glyph,
 *     not a more elaborate one.
 *   - Non-tropical `nature` gets a plain dot in the GENERIC color — the
 *     spiral means "this is a cyclone."
 *   - Constant in SCREEN pixels. A position marker is not an area.
 *   - Category color, glyph, and position never change with zoom. The one
 *     as-built exception: at the PLANET band storms are uniform grey dots and
 *     color fades in by the basin band (§9 zoom ladder).
 *
 * Names arrive at the basin band — no labels at z0–2 (§9).
 *
 * Imports: config/, map/ siblings. Never ui/ or data/ — main.js pushes storm
 * lists in via update().
 */

import { ZOOM, GLOBE3D } from '../config/constants.js';
import { DARK, SIZE } from '../config/tokens.js';
import { categoryColor } from '../lib/category.js';
import { byZoom } from './style-dark.js';

const SOURCE_ID = 'storms';
const LAYER_DOT = 'storm-dot-planet';
const LAYER_NAME = 'storm-name';

/** Forecast point layers, tappable alongside the storm's own position so the
 *  whole track selects its storm. Named here rather than imported to keep the
 *  one-directional rule — map/layers/* must not depend on markers.js. */
const FPOINT_LAYERS = ['sel-fpoints', 'amb-fpoints'];

/* ---------------------------------------------------------------------------
 * Glyph rendering — RETIRED 2026-07-24.
 *
 * The canvas image machinery (registerGlyphs / makeImage / drawDot / iconFor)
 * lived here solely to feed the MapLibre symbol layer's `icon-image`. That
 * layer is gone — the 3D node mesh owns the spiral now — so the images had no
 * consumer and are deleted rather than left registered and unused.
 *
 * `map/glyph.js` itself STAYS. It is shared, and map/globe3d.js still stamps
 * the same spiral as a Points sprite. Only this engine's copy is retired.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Layers
 * ------------------------------------------------------------------------- */

function toFeatureCollection(storms) {
  return {
    type: 'FeatureCollection',
    features: storms.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        category: s.category,
        /* Resolved here so the dot carries §6 severity straight off the FEED,
         * with no geometry required. Includes the hurricane-unknown rose. */
        color: categoryColor(s.category, s.nature, s.categoryCode),
      },
    })),
  };
}

/**
 * Adds the storm source + three layers. Call once, after style load.
 * Layers go on top of the stack — draw order (SPEC §13) puts the storm dot
 * above every shape layer, and labels above the dot.
 *
 * @returns {{ update: (storms: object[]) => void }}
 */
export function addStormMarkers(map) {
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: toFeatureCollection([]),
  });

  /* Planet band: uniform grey position dots. Fades out across the basin floor
   * as the spiral fades in. Radius rides the category scale so "bigger storm"
   * survives even in grey. */
  /* THE HIT TARGET. Draws nothing; exists so a storm is always selectable.
   *
   * Was a visible grey position dot that stopped at z3.4. It is now
   * transparent and carries NO maxzoom, because it is the one thing
   * guaranteeing selection works:
   *  - in GLOBE view, where the mesh draws the spiral and MapLibre draws no
   *    symbol at all — this circle is what makes that mesh glyph tappable;
   *  - on a COLD LOAD, where the feed has landed but geometry has not, so a
   *    storm has no forecast points to tap yet;
   *  - after a FAILED geometry fetch, where it never will.
   *
   * Selection must never depend on a network round trip completing.
   *
   * Radius still rides the category scale so a bigger storm keeps a bigger
   * target, and it is floored at the §9 44 px touch minimum — the query box
   * in stormAtPoint enforces that too, but a target smaller than the finger
   * pressing it should not exist in the first place.
   *
   * ZERO OPACITY IS THE ONE THING TO CONFIRM ON GLASS. MapLibre returns
   * fully-transparent layers from queryRenderedFeatures (unlike
   * `visibility: none`, which it excludes), so this should behave. If taps
   * stop selecting, that assumption is why — raise the opacity a hair rather
   * than restoring the glyph. */
  map.addLayer({
    id: LAYER_DOT,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      /* DRAWN size, ~5-10 px, riding the category scale so a bigger storm
       * keeps a bigger dot. NOT floored to the 44 px touch minimum: the rule
       * is about the HIT AREA, and `stormAtPoint` enforces it with a 44 px
       * query box regardless of what is drawn (§9 — "the visible mark may be
       * smaller, the query box never is"). Flooring the drawn radius instead
       * put a 44 px blob on every storm. */
      'circle-radius': [
        'interpolate', ['linear'], ['coalesce', ['get', 'category'], 1],
        0, (SIZE.glyphBase / 2) * SIZE.glyphScale[0] * 0.55,
        6, (SIZE.glyphBase / 2) * SIZE.glyphScale[6] * 0.55,
      ],
      /* VISIBLE ONLY ONCE THE MESH HAS HANDED OFF, and this is a fix for a
       * regression I introduced: with the spiral retired, a storm had NO mark
       * at its position until its geometry arrived. NHC fetches its layers
       * directly and lands fast; GDACS geometry is relay-cached and 224 kB, so
       * NOUL visibly popped in seconds after the page settled while the NHC
       * storms were instant. The storm was in the feed the whole time — only
       * its picture was late.
       *
       * Below zHandoff the 3D mesh draws the storm from feed data, so there
       * is no gap there and a MapLibre dot would just be the second copy that
       * caused the smearing in the first place. Above it, this dot is the
       * storm until the geometry catches up, and the analysis forecast point
       * then lands on top of it in the same color.
       *
       * OPACITY DOES NOT GATE HIT TESTING — the layer answers
       * queryRenderedFeatures at every zoom regardless, which is what keeps
       * the mesh glyph tappable in globe view. */
      'circle-color': ['coalesce', ['get', 'color'], DARK.stormPlanetDot],
      'circle-opacity': byZoom([
        [GLOBE3D.zHandoff - 0.2, 0],
        [GLOBE3D.zHandoff + 0.4, 0.95],
      ]),
      'circle-pitch-alignment': 'map',
    },
  });

  /* Basin band and closer: the category-colored spiral. Always drawn —
   * overlap between two storms is information, not clutter, and a hidden
   * hurricane is a §5 violation. */
  /* THE SPIRAL GLYPH LAYER IS GONE, DELIBERATELY (2026-07-24).
   *
   * BOTH ENGINES DREW THE SAME SPIRAL. `map/glyph.js` is shared: the 3D node
   * mesh stamps it as a sprite, MapLibre stamped it as a symbol here. The
   * zoom bands guaranteed they overlapped — this layer reached full opacity
   * at z3.4 while the mesh does not finish handing off until z5.0, so for
   * 1.6 zoom levels two copies of one glyph were drawn at slightly different
   * projected positions and sizes. That is the smeared look during zoom, and
   * it was structural rather than tunable.
   *
   * ONE ENGINE OWNS THE SPIRAL AND IT IS THE MESH. `glyph.js` stays; only
   * this stamping of it is retired. At map zooms the storm is carried by its
   * geometry — track, cone, wind field, and the forecast points, whose first
   * dot sits on the current position with the category color and code.
   *
   * SELECTION DID NOT GO WITH IT. It never lived on this layer alone
   * (`stormAtPoint` always queried the dot too), and the dot above is now a
   * transparent hit target at every zoom — which is what keeps the MESH
   * glyph tappable in globe view, where no MapLibre symbol was ever drawn. */

  /* Names arrive once you've committed to a region (§9: no labels at z0–2).
   * MapLibre's own collision handling may hide a colliding NAME — never the
   * glyph, which is why name and glyph are separate layers. */
  map.addLayer({
    id: LAYER_NAME,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: ZOOM.basin,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': SIZE.stormLabelPx,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
    },
    paint: {
      'text-color': DARK.textSecondary,
      'text-halo-color': DARK.ocean,
      'text-halo-width': SIZE.stormLabelHaloPx,
      'text-opacity': byZoom([
        [ZOOM.basin, 0],
        [ZOOM.basin + 0.6, 0.95],
      ]),
    },
  });

  return {
    update(storms) {
      /* Patch in place: setData swaps the source's content without touching
       * layers — the 30-min poll never makes the map blink (SPEC §13). */
      map.getSource(SOURCE_ID).setData(toFeatureCollection(storms));
    },
  };
}

/**
 * Which storm (if any) sits under a screen point.
 *
 * Honors the 44 px hit rule (§9): the drawn target may be smaller, the QUERY
 * box never is.
 *
 * TWO KINDS OF TARGET, and the ORDER MATTERS. The storm's own position is
 * checked first, then its forecast points — so a tap near the storm selects
 * it by its position rather than by whichever track dot happened to be a
 * pixel closer. Tapping anywhere along a track selects that track's storm,
 * which is the behaviour that replaced tapping the spiral.
 *
 * A forecast-point layer that does not exist yet is skipped rather than
 * throwing: MapLibre rejects the whole query if any named layer is missing,
 * which would take storm selection down entirely on the first paint.
 */
export function stormAtPoint(map, point) {
  const half = parseInt(SIZE.touchTarget, 10) / 2;
  const box = [
    [point.x - half, point.y - half],
    [point.x + half, point.y + half],
  ];

  const layers = [LAYER_DOT, ...FPOINT_LAYERS].filter((id) => map.getLayer(id));
  if (!layers.length) return null;

  const hits = map.queryRenderedFeatures(box, { layers });
  for (const h of hits) {
    /* `id` on the storm source; `_stormId` stamped on forecast points by the
     * data layer. Neither is guessed — a point that carries no attribution
     * selects nothing rather than selecting a neighbour. */
    const id = h.properties?.id ?? h.properties?._stormId;
    if (id) return id;
  }
  return null;
}
