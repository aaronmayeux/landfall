/**
 * glyph.js — the storm glyph, drawn once, used by the 3D node mesh.
 *
 * ===========================================================================
 * THE GLYPH IS THE APP'S OWN LOGO, AND IT IS VECTOR
 * ===========================================================================
 *
 * This drew a hand-built two-arm spiral until 2026-07-29. It is now the
 * Landfall mark itself — the four-arm spiral with an open eye — taken from
 * `assets/icons/maskable-512.svg`, which is the same artwork the home-screen
 * icons are cut from. One mark on the icon and on the globe, and the storm on
 * the planet is recognisably the app.
 *
 * ==> IT IS PATH DATA, NOT THE FILE. <== The five shape outlines are inlined
 * below as `Path2D` strings rather than loaded from `assets/`. Fetching the SVG
 * would make texture creation asynchronous — the mesh would have to draw
 * something else, or nothing, for one frame while a network request completed,
 * on the surface a user is looking at during a hurricane. It also puts a
 * fetchable file in the render path for a drawing that never changes.
 *
 * ==> SPEC-OPS SAID THE ARTWORK WOULD NOT SURVIVE AT GLYPH SIZE, AND IT WAS
 * HALF RIGHT. <== That note was about the full-colour BITMAP: it cannot be
 * tinted per category, and at 12-24 px its detail turns to mush. The first
 * objection dies with the vector — these are flat silhouettes drawn white and
 * tinted by the mesh, exactly as the old spiral was. The second one is real and
 * is answered by `SIZE.glyphArmWeight` below.
 *
 * ==> THE ARMS ARE FATTENED ON PURPOSE. <== Measured at phone sizes: unmodified,
 * the four arms are thin enough that at 12-16 px they break up and the mark
 * reads as a blob with a hole. Outlining each shape in its own fill colour
 * thickens the arms without changing their shape, and the eye stays open down
 * to ~16 px. Too much weight and the arms fuse into a pinwheel, which loses the
 * spiral entirely — hence a constant, tuned on glass, not a literal.
 *
 * ==> THE ARTWORK IS DRAWN NORTHERN-HEMISPHERE. <== Measured off the paths, not
 * assumed: an arm runs from the eye at ~305 deg outward to its tip at ~35 deg,
 * so radius grows as the angle increases, which is counterclockwise on screen.
 * That is the northern spiral, so `dir: +1` draws it as-is and `dir: -1`
 * mirrors it. Same hemisphere contract the hand-drawn spiral had (SPEC §9).
 *
 * MapLibre no longer stamps this — the mesh is the only engine that draws the
 * glyph (SPEC-MAP §9.13). The shape of `spiralCanvas` is kept because
 * map/globe3d.js is its only caller and rebuilds the texture on every retheme.
 *
 * Imports: config/ only.
 */

import { palette } from '../config/theme.js';
import { SIZE } from '../config/tokens.js';

/* ---------------------------------------------------------------------------
 * THE ARTWORK
 *
 * Five closed outlines — four arms and the eye — in the source SVG's own 512
 * coordinate space. The ink is centred on (256, 256) with a half-extent of
 * 159.5, both MEASURED off a render of the paths rather than read off the
 * viewBox: the viewBox is the icon's canvas and carries padding the mark does
 * not fill, so scaling by it would draw the glyph small and off-centre.
 *
 * The remaining groups in the source file are a background plate and a
 * sub-pixel tracing artefact. Neither is part of the mark.
 * ------------------------------------------------------------------------- */

const ART_CENTER = 256;
const ART_RADIUS = 159.5;

const ART_PATHS = [
  // Arm, upper right.
  'M 395.00 157.00 C 358.49 106.76 291.00 83.48 232.08 103.08 C 173.15 122.67 140.44 186.77 151.07 245.93 C 161.71 305.08 239.19 347.58 287.00 300.00 C 242.51 329.93 180.82 287.78 180.00 238.00 C 179.18 188.22 209.25 143.56 255.33 124.33 C 301.40 105.09 361.48 120.25 395.00 157.00 Z',
  // Arm, upper left.
  'M 157.00 115.00 C 103.73 148.57 83.49 221.02 107.23 277.77 C 130.96 334.52 191.47 371.40 252.33 360.33 C 313.18 349.26 348.57 264.57 297.00 222.00 C 331.39 264.65 290.63 331.56 240.00 332.00 C 189.37 332.44 147.55 299.83 127.32 254.68 C 107.09 209.52 118.53 148.71 157.00 115.00 Z',
  // Arm, lower right.
  'M 344.00 398.00 C 396.81 366.04 425.11 300.46 408.78 240.22 C 392.44 179.99 330.96 143.31 270.01 150.01 C 209.06 156.71 164.15 233.30 208.00 284.00 C 179.25 235.38 228.46 174.75 278.93 179.07 C 329.39 183.39 368.80 214.31 385.22 261.78 C 401.65 309.24 382.31 365.31 344.00 398.00 Z',
  // Arm, lower left.
  'M 214.00 395.00 C 211.18 395.27 207.76 395.27 205.00 395.00 C 164.85 394.54 129.59 369.66 106.00 338.00 C 133.87 394.91 203.29 427.29 263.93 409.93 C 324.56 392.57 368.61 333.23 361.99 270.01 C 355.38 206.79 271.91 161.71 223.00 211.00 C 257.19 189.89 299.27 204.39 320.23 237.77 C 341.19 271.15 330.31 315.51 306.30 344.30 C 282.29 373.09 252.06 395.00 214.00 395.00 Z',
  // The eye.
  'M 250.00 282.00 C 253.13 282.28 256.87 282.32 260.00 282.00 C 290.59 275.22 287.48 228.27 255.00 228.00 C 222.52 227.73 218.63 275.50 250.00 282.00 Z',
];

/** The five outlines as ONE `Path2D`, built once on first draw.
 *
 *  BUILT LAZILY, and that is not a micro-optimisation. `Path2D` is a browser
 *  global; constructing it at module scope would throw the moment anything
 *  outside a browser imported this file — a syntax check, a node test, a tool.
 *  Deferring it means the file imports cleanly everywhere and only needs a
 *  canvas at the point where it is actually drawing on one. */
let artPath = null;
function art() {
  if (!artPath) {
    artPath = new Path2D();
    for (const d of ART_PATHS) artPath.addPath(new Path2D(d));
  }
  return artPath;
}

/**
 * Draws the mark centered on the context's ORIGIN — callers translate to
 * wherever the center belongs before calling.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} R      glyph radius in current ctx units
 * @param {string} color
 * @param {1|-1} dir      +1 counterclockwise (N hemisphere), -1 clockwise (S)
 */
export function drawSpiral(ctx, R, color, dir) {
  /* THE §6 HALO. Severity colours are fixed, so on a pale daytime ocean a
   * Cat 1 yellow has almost no luminance contrast against the water — this
   * dark halo is what makes the mark findable, and the fill then says which
   * severity it is. Dark in BOTH themes: in the dark theme it deepens the
   * glyph against lit land, in the light theme it is the only thing holding
   * the glyph off the sea. tools/contrast-check.mjs gates the colour.
   *
   * SET BEFORE THE SCALE, deliberately. Canvas shadows are not transformed by
   * the matrix, so the blur radius stays in the caller's units and a glyph
   * drawn at any size gets the same proportional halo it always had. */
  ctx.save();
  ctx.shadowColor = palette().geo.glyphHalo;
  ctx.shadowBlur = R * 0.35;

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* Artwork space -> caller space. The mirror for the southern hemisphere is a
   * negative X scale: reflecting a spiral is what reverses its handedness, and
   * it costs nothing next to re-deriving the paths. */
  const k = R / ART_RADIUS;
  ctx.scale(dir === -1 ? -k : k, k);
  ctx.translate(-ART_CENTER, -ART_CENTER);

  const path = art();

  /* TWO PASSES, AND THE ORDER IS THE WHOLE TRICK.
   *
   * The stroke goes first, WITH the shadow: it is the fattened silhouette, so
   * the halo it casts is the outline of the shape a reader actually sees.
   * Stroking after the fill would cast a second shadow over the first and
   * double the halo into mud.
   *
   * The fill goes second with the shadow OFF. Stroke and fill are the same
   * colour, so the two together are one solid fattened mark with no seam — the
   * stroke covers a band centred on the outline, the fill covers everything
   * inside it. */
  ctx.lineWidth = SIZE.glyphArmWeight * ART_RADIUS;
  ctx.stroke(path);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.fill(path);

  ctx.restore();
}

/**
 * A standalone square canvas carrying one mark — the 3D engine turns this
 * into a THREE.CanvasTexture for its Points sprites.
 */
export function spiralCanvas(sizePx, color, dir) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = sizePx;
  const ctx = cv.getContext('2d');
  ctx.translate(sizePx / 2, sizePx / 2);
  drawSpiral(ctx, (sizePx / 2) * 0.78, color, dir); // headroom for the halo
  return cv;
}

/**
 * THE WATCHED-AREA MARK — a hatched lozenge, on a square canvas (SPEC §45.4).
 *
 * ==> IT IS THE PATCH, IN MINIATURE, AND THAT IS THE WHOLE IDEA. <== The same
 * irregular blob, the same dashed edge, the same diagonal hatch that the real
 * area carries at close zoom — just small enough to be a mark. Diving in is
 * then a DISSOLVE rather than a swap: the glyph does not hand over to some
 * other symbol, it simply becomes itself at full size. The list swatch, this
 * mark and the polygon on the map are one object drawn at three scales.
 *
 * It replaced a plain dashed ring, which was honest and, in Aaron's words on
 * glass, bland — nothing about a bare circle says weather, and it read as a
 * selection halo or a map annotation. The lozenge says "an area" before it
 * says anything else.
 *
 * LIVES BESIDE THE SPIRAL BECAUSE IT IS THE SAME KIND OF THING: a mark
 * rasterised once and handed to whichever engine needs it. `map/watch-marks.js`
 * makes a Three.js sprite of it for the planet band. Two copies of this artwork
 * would be two chances for the mark to change meaning halfway through a zoom.
 *
 * NOT A SPIRAL AND NOT A FILLED DOT. The spiral is the app's own mark and means
 * a cyclone; a filled dot means a storm of a known strength on the
 * Saffir-Simpson ramp (§6). This is the absence of a storm, so it is hatched
 * rather than filled and its edge is broken rather than solid — a fuzzy
 * boundary drawn as a fuzzy boundary.
 *
 * `hatchLines` is how many strokes cross the blob, and it is the mark's half of
 * the risk ramp's second channel — the same message `GENESIS_GEO.hatchGap`
 * carries on the real patch, at the other end of the zoom. RISK NEVER RIDES THE
 * SIZE: a shape on a map means extent, and the real NHC polygons drawn beside
 * these already use size to mean exactly that.
 *
 * The halo is BAKED, like the spiral's, so the texture is theme-dependent and
 * the caller re-makes it on a theme change.
 *
 * `color` defaults to white for the Three.js caller, whose Points material
 * tints a white sprite through its vertex colour so one texture serves every
 * risk.
 */
export function watchGlyphCanvas(sizePx, hatchLines, haloColor, color = '#FFFFFF') {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = sizePx;
  const ctx = cv.getContext?.('2d');
  if (!ctx) return null;

  const c = sizePx / 2;
  /* Wider than tall and tilted, because the real areas are: measured across
   * the live outlook, mean 17.7 deg of longitude by 8.9 of latitude. A circle
   * would be the one shape none of them is. */
  const rx = c * 0.82;
  const ry = c * 0.56;
  const tilt = -0.25;
  const edge = Math.max(1.1, sizePx * 0.045);

  ctx.translate(c, c);
  ctx.strokeStyle = color;

  /* THE HATCH, CLIPPED TO THE BLOB. Drawn first so the dashed edge lands on
   * top of it and stays the crispest thing in the mark — at 30 px the outline
   * is what carries the shape, and hatch strokes crossing it would fray it. */
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tilt, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineWidth = Math.max(0.9, sizePx * 0.035);
  for (let i = -hatchLines; i <= hatchLines; i += 1) {
    const o = (i / hatchLines) * rx * 1.5;
    ctx.beginPath();
    ctx.moveTo(o - rx, ry * 1.6);
    ctx.lineTo(o + rx, -ry * 1.6);
    ctx.stroke();
  }
  ctx.restore();

  /* THE DASHED EDGE, with the halo baked under it. Twice: the first pass lays
   * the shadow, the second puts clean ink on top so the blur does not wash the
   * stroke out. Same trick as the spiral. */
  ctx.lineWidth = edge;
  ctx.setLineDash([sizePx * 0.10, sizePx * 0.075]);
  ctx.shadowColor = haloColor;
  ctx.shadowBlur = edge * 2.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tilt, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.stroke();

  return cv;
}
