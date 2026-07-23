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

import { ZOOM } from '../config/constants.js';
import { DARK, SIZE, CATEGORY_COLOR } from '../config/tokens.js';
import { categoryColor } from '../lib/category.js';
import { byZoom } from './style-dark.js';
import { drawSpiral } from './glyph.js';

const SOURCE_ID = 'storms';
const LAYER_DOT = 'storm-dot-planet';
const LAYER_GLYPH = 'storm-glyph';
const LAYER_NAME = 'storm-name';

/** The grey-dot → colored-spiral crossfade straddles the basin floor, derived
 *  from the band edge, not hand-set (SPEC §12). */
const FADE_START = ZOOM.basin - 0.6;
const FADE_END = ZOOM.basin + 0.4;

/* ---------------------------------------------------------------------------
 * Glyph rendering — canvas-drawn once at boot, registered as map images.
 * ------------------------------------------------------------------------- */

/* The two-arm spiral itself lives in map/glyph.js — shared with the 3D
 * engine's planet-band sprites. */

function drawDot(ctx, R, color) {
  const cx = 0; // makeImage translates the context to the canvas center
  const cy = 0;
  ctx.shadowColor = DARK.ocean;
  ctx.shadowBlur = R * 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function makeImage(sizePx, dpr, draw) {
  const canvas = document.createElement('canvas');
  // 1.5x head-room: round line caps and the halo overflow the nominal box.
  canvas.width = canvas.height = Math.ceil(sizePx * 1.5 * dpr);
  const ctx = canvas.getContext('2d');
  /* Scale for DPR, then put (0,0) at the canvas CENTER — draw functions work
   * in CSS pixels around the origin, so one code path serves every DPR. */
  ctx.scale(dpr, dpr);
  ctx.translate((sizePx * 1.5) / 2, (sizePx * 1.5) / 2);
  draw(ctx, sizePx / 2);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Registers every glyph variant: 7 categories x 2 hemispheres + the generic
 *  non-tropical dot. Registered up front — a missing image at render time
 *  draws nothing, silently, which is exactly the failure §5 forbids. */
function registerGlyphs(map) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let cat = 0; cat <= 6; cat++) {
    const color = categoryColor(cat, 'tropical');
    const px = SIZE.glyphBase * SIZE.glyphScale[cat];
    for (const [hemi, dir] of [['n', 1], ['s', -1]]) {
      const name = `storm-c${cat}-${hemi}`;
      if (map.hasImage(name)) continue;
      map.addImage(
        name,
        makeImage(px, dpr, (ctx, R) => drawSpiral(ctx, R, color, dir)),
        { pixelRatio: dpr }
      );
    }
  }
  const genericPx = SIZE.glyphBase * SIZE.glyphScale[1];
  if (!map.hasImage('storm-generic')) {
    map.addImage(
      'storm-generic',
      makeImage(genericPx, dpr, (ctx, R) => drawDot(ctx, R, CATEGORY_COLOR.GENERIC)),
      { pixelRatio: dpr }
    );
  }
}

/** Storm → registered image name. */
function iconFor(storm) {
  const spiral = storm.nature === 'tropical' || storm.nature === 'subtropical';
  if (!spiral || storm.category == null) return 'storm-generic';
  return `storm-c${storm.category}-${storm.lat < 0 ? 's' : 'n'}`;
}

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
        icon: iconFor(s),
        category: s.category,
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
  registerGlyphs(map);

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: toFeatureCollection([]),
  });

  /* Planet band: uniform grey position dots. Fades out across the basin floor
   * as the spiral fades in. Radius rides the category scale so "bigger storm"
   * survives even in grey. */
  map.addLayer({
    id: LAYER_DOT,
    type: 'circle',
    source: SOURCE_ID,
    maxzoom: FADE_END,
    paint: {
      'circle-color': DARK.stormPlanetDot,
      'circle-radius': [
        'interpolate', ['linear'], ['coalesce', ['get', 'category'], 1],
        0, (SIZE.glyphBase / 2) * SIZE.glyphScale[0] * 0.55,
        6, (SIZE.glyphBase / 2) * SIZE.glyphScale[6] * 0.55,
      ],
      'circle-opacity': byZoom([
        [FADE_START, 0.9],
        [FADE_END, 0],
      ]),
      'circle-pitch-alignment': 'map',
    },
  });

  /* Basin band and closer: the category-colored spiral. Always drawn —
   * overlap between two storms is information, not clutter, and a hidden
   * hurricane is a §5 violation. */
  map.addLayer({
    id: LAYER_GLYPH,
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      /* Glyphs grow modestly with zoom — NOT map-locked (a Cat 1 would swallow
       * a metro area at z8), just enough that committing to a region makes the
       * storm feel closer. Endpoints in tokens (SIZE.glyphZoom*). */
      'icon-size': byZoom([
        [ZOOM.basin, SIZE.glyphZoomMin],
        [ZOOM.max, SIZE.glyphZoomMax],
      ]),
    },
    paint: {
      'icon-opacity': byZoom([
        [FADE_START, 0],
        [FADE_END, 1],
      ]),
    },
  });

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
 * Which storm (if any) sits under a screen point, honoring the 44 px hit rule:
 * the visible glyph may be 16 px; the QUERY box is never under 44 (SPEC §9).
 * Returns the storm id or null. Selection semantics live with the caller.
 */
export function stormAtPoint(map, point) {
  const half = parseInt(SIZE.touchTarget, 10) / 2;
  const box = [
    [point.x - half, point.y - half],
    [point.x + half, point.y + half],
  ];
  const hits = map.queryRenderedFeatures(box, {
    layers: [LAYER_GLYPH, LAYER_DOT],
  });
  return hits.length ? hits[0].properties.id : null;
}
