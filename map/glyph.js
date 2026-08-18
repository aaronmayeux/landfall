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
 * HALF RIGHT. <== That note was about the full-color BITMAP: it cannot be
 * tinted per category, and at 12-24 px its detail turns to mush. The first
 * objection dies with the vector — these are flat silhouettes drawn white and
 * tinted by the mesh, exactly as the old spiral was. The second one is real and
 * is answered by `SIZE.glyphArmWeight` below.
 *
 * ==> THE ARMS ARE FATTENED ON PURPOSE. <== Measured at phone sizes: unmodified,
 * the four arms are thin enough that at 12-16 px they break up and the mark
 * reads as a blob with a hole. Outlining each shape in its own fill color
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

import { palette, isLight } from '../config/theme.js';
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
  /* THE §6 HALO. Severity colors are fixed, so on a pale daytime ocean a
   * Cat 1 yellow has almost no luminance contrast against the water — this
   * dark ink is what makes the mark findable, and the fill then says which
   * severity it is. Dark in BOTH themes: in the dark theme it deepens the
   * glyph against lit land, in the light theme it is the only thing holding
   * the glyph off the sea. tools/contrast-check.mjs gates the color.
   *
   * ==> THE INK IS THE SAME IN BOTH THEMES. ITS SHAPE IS NOT. <==
   *
   *   dark   a soft blurred drop shadow. It sits under a bright mark on a
   *          near-black globe and reads as depth.
   *   light  a crisp keyline, no blur at all. The same soft shadow on a pale
   *          grey globe reads as a smudge under the mark instead of as part
   *          of it (Aaron on glass, light mode).
   *
   * Deleting it outright in light was the ask and is not survivable: measured
   * against the light ocean the fills run 1.03-1.87:1 where the floor is 3,
   * and `contrast-check.mjs` would keep passing because it reads the token and
   * not the render. See `SIZE.glyphKeylineWeight` for the full numbers.
   *
   * SET BEFORE THE SCALE, deliberately. Canvas shadows are not transformed by
   * the matrix, so the blur radius stays in the caller's units and a glyph
   * drawn at any size gets the same proportional halo it always had. */
  const P = palette();
  const light = isLight();
  ctx.save();
  if (!light) {
    ctx.shadowColor = P.geo.glyphHalo;
    ctx.shadowBlur = R * 0.35;
  }

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
  const arm = SIZE.glyphArmWeight * ART_RADIUS;

  /* ==> THE KEYLINE GOES FIRST AND IS THE WIDEST STROKE. <== A canvas stroke
   * is centred on the outline, so a wider one in the dark ink lays down a band
   * that the narrower colored stroke then covers all but the outer edge of.
   * What is left showing is a rim of exactly `glyphKeylineWeight` on each
   * side. Drawing it after would put the dark ink OVER the color and turn the
   * mark into a dark outline of itself.
   *
   * It is a separate pass rather than the shadow with `shadowBlur = 0` because
   * a zero-blur shadow is offset-only — it would stamp a hard dark copy beside
   * the mark, not around it. */
  if (light) {
    ctx.strokeStyle = P.geo.glyphHalo;
    ctx.lineWidth = arm + SIZE.glyphKeylineWeight * ART_RADIUS * 2;
    ctx.stroke(path);
    ctx.strokeStyle = color;
  }

  /* TWO PASSES, AND THE ORDER IS THE WHOLE TRICK.
   *
   * The stroke goes first, WITH the shadow: it is the fattened silhouette, so
   * the halo it casts is the outline of the shape a reader actually sees.
   * Stroking after the fill would cast a second shadow over the first and
   * double the halo into mud.
   *
   * The fill goes second with the shadow OFF. Stroke and fill are the same
   * color, so the two together are one solid fattened mark with no seam — the
   * stroke covers a band centred on the outline, the fill covers everything
   * inside it. */
  ctx.lineWidth = arm;
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
 * THE WATCHED-AREA MARK — a caution triangle, on a square canvas (§45.4).
 *
 * ==> THREE VARIANTS, ONE PER RISK, AND THEY DIFFER STRUCTURALLY RATHER THAN
 *     BY A NUMBER. <==
 *
 *   LOW     hollow. An outlined triangle and nothing else.
 *   MEDIUM  filled. Solid, still nothing inside it.
 *   HIGH    filled, with the exclamation knocked out of it.
 *
 * That is a real ladder rather than a scale: empty, full, full-and-marked.
 * At 30 px on a phone, three steps of a count or a stroke weight are a guess;
 * present / absent / doubled is legible at a glance and survives a bad screen,
 * which is the same argument the hatch-plus-lightness pairing makes on the
 * patch. Aaron's call, 2026-08-09.
 *
 * ==> THE STANDING OBJECTION, RECORDED BECAUSE IT DOES NOT GO AWAY. <== A
 * triangle-and-bang is the universal HAZARD mark, and a watched area is not a
 * hazard — it is the absence of one, which is the whole reason §45 exists and
 * the whole reason this mark is off the Saffir-Simpson ramp. There is a real
 * risk that five of these on a quiet globe read as five warnings rather than
 * five maybes, and that the app's most alarming symbol ends up attached to its
 * least certain object.
 *
 * The ladder above is already the answer to half of it: the exclamation now
 * appears ONLY on the top rung, so a Low or Medium area is a plain triangle
 * and cannot be read as a warning at all. Color has done the rest — the ramp
 * moved off gold onto the mesh/coastline family for exactly this reason,
 * because gold is what caution means everywhere a person has ever seen it.
 *
 * The remaining dials if HIGH still reads too loud: thin the strokes, or drop
 * the exclamation entirely and let fill alone carry the top rung.
 *
 * IT REPLACED A HATCHED LOZENGE — the patch in miniature, which had a perfect
 * visual through-line to the polygon it becomes and, on glass, not enough
 * character to be found. Legibility beat elegance. If the triangle is ever
 * retired, the lozenge is in `git log` and was not wrong, only quiet.
 *
 * NOT A SPIRAL AND NOT A FILLED DOT: the spiral is the app's own mark and
 * means a cyclone, and a filled dot means a storm of a known strength on the
 * Saffir-Simpson ramp (§6).
 *
 * `color` defaults to white for the Three.js caller, whose Points material
 * tints a white sprite through its vertex color so one texture serves every
 * risk. The texture is still theme-dependent — `haloColor` is the ink the
 * exclamation is knocked out of on a filled triangle — so the caller still
 * re-makes it on a theme change.
 *
 * @param {number} sizePx
 * @param {'LOW'|'MEDIUM'|'HIGH'} risk
 * @param {string} haloColor  the theme's glyph halo — the KNOCK-OUT ink only.
 *                            There is no drop shadow on this mark; see below.
 * @param {string} [color]
 */
export function watchGlyphCanvas(sizePx, risk, haloColor, color = '#FFFFFF') {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = sizePx;
  const ctx = cv.getContext?.('2d');
  if (!ctx) return null;

  const c = sizePx / 2;
  const filled = risk === 'MEDIUM' || risk === 'HIGH';
  const bang = risk === 'HIGH';
  const sw = Math.max(1.4, sizePx * 0.062);
  const r = c * 0.80;

  /** An equilateral triangle pointing up, centred on its own CENTROID rather
   *  than on its bounding box. The three vertices average to the origin by
   *  construction, which is what lets the exclamation below be positioned
   *  against a known centre instead of by eye. */
  const tri = (radius) => {
    ctx.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const a2 = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      const x = radius * Math.cos(a2);
      const y = radius * Math.sin(a2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  ctx.translate(c, c);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* ==> NO DROP SHADOW, IN EITHER THEME. <== This carried a baked blur, like
   * the storm spiral does, and on glass it read as a dirty smudge around the
   * triangle rather than as separation.
   *
   * The spiral NEEDS its halo and this does not, and the reason is §6: a
   * category color is fixed, so a Cat 1 yellow sits at 1.32:1 against the
   * daylight ocean and is only findable because something dark is drawn behind
   * it. This mark's color is THEMED — `GENESIS_COLOR_LIGHT` exists precisely
   * so it clears its own background without help — so a halo here buys nothing
   * and costs the clean edge. */
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = sw;

  tri(r);
  if (filled) ctx.fill();
  ctx.stroke();

  /* ==> THE EXCLAMATION IS A HOLE, NOT AN INK. <==
   *
   * `destination-out` erases what has already been drawn, so the mark is
   * TRANSPARENT — whatever is behind the glyph shows through it. It was
   * painted in the halo color before, which on a night globe looked like a
   * hole and in light mode was a black bar sitting in a teal triangle. A
   * knock-out is right in both themes for the same reason a real warning sign
   * is: the symbol is the absence of the plate, not a second color on it.
   *
   * ONLY ON THE TOP RUNG. The ladder is now hollow -> filled -> filled with
   * the exclamation, so the bang is what marks the highest chance rather than
   * being decoration every mark carries. It also means the two quieter rungs
   * cannot be mistaken for warnings at all, which is the standing objection
   * this whole mark carries (see the header).
   *
   * IT IS CENTRED ON THE TRIANGLE'S CENTROID, WHICH IT WAS NOT. The dot sat at
   * 0.60r and the triangle's base is at 0.50r, so the dot hung out of the
   * bottom of the sign — visible on glass immediately. Half-width at a height
   * y is 0.866r * (y + r) / 1.5r, so at the bar's top (-0.22r) there is 0.45r
   * of room and at the dot (0.32r) there is 0.76r: both clear the edges with
   * room to spare, and the whole symbol now spans -0.22r to +0.40r about a
   * centroid at 0. */
  if (bang) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000'; // any opaque color — only the alpha is used

    const barW = Math.max(1.4, r * 0.16);
    const barTop = -r * 0.22;
    const barBot = r * 0.14;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-barW / 2, barTop, barW, barBot - barTop, barW / 2);
    } else {
      ctx.rect(-barW / 2, barTop, barW, barBot - barTop);
    }
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, r * 0.32, barW * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return cv;
}
