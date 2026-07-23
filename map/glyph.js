/**
 * glyph.js — the storm glyph, drawn once, used by both engines.
 *
 * The SPEC §9 contract: a simplified two-arm spiral, rotated by hemisphere —
 * counterclockwise north (dir +1), clockwise south (dir -1). MapLibre stamps
 * it as a symbol image (map/markers.js); the 3D clear globe stamps it as a
 * Points sprite texture (map/globe3d.js). One drawing, two engines — extracted
 * the moment the second engine needed it (SPEC §12).
 *
 * Imports: config/ only.
 */

import { DARK } from '../config/tokens.js';

/**
 * Draws the spiral centered on the context's ORIGIN — callers translate to
 * wherever the center belongs before calling.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} R      glyph radius in current ctx units
 * @param {string} color
 * @param {1|-1} dir      +1 counterclockwise (N hemisphere), -1 clockwise (S)
 */
export function drawSpiral(ctx, R, color, dir) {
  /* A whisper of dark halo so the glyph separates from lit land as well as
   * dark ocean — severity color must survive both (SPEC §6 audit note). */
  ctx.shadowColor = DARK.ocean;
  ctx.shadowBlur = R * 0.35;

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = R * 0.3;

  // Core disc.
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.36, 0, Math.PI * 2);
  ctx.fill();

  // Two arms, π apart: radius grows as the angle sweeps ~150°.
  const SWEEP = (Math.PI * 5) / 6;
  const STEPS = 16;
  for (const armOffset of [0, Math.PI]) {
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const a = armOffset + dir * t * SWEEP;
      const r = R * (0.3 + 0.62 * t);
      const x = r * Math.cos(a);
      const y = -dir * r * Math.sin(a); // canvas y is down; flip per dir
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * A standalone square canvas carrying one spiral — the 3D engine turns this
 * into a THREE.CanvasTexture for its Points sprites.
 */
export function spiralCanvas(sizePx, color, dir) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = sizePx;
  const ctx = cv.getContext('2d');
  ctx.translate(sizePx / 2, sizePx / 2);
  drawSpiral(ctx, (sizePx / 2) * 0.78, color, dir); // headroom for caps + halo
  return cv;
}
