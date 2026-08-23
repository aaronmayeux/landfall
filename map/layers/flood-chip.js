/**
 * flood-chip.js — the marker a flood alert wears on the globe. SPEC §56.5.
 *
 * ==> IT IS A ROUNDED SQUARE AND IT MUST NEVER BECOME A CIRCLE. <== The rule is
 * `GENESIS_GEO`'s, stated there and inherited here: a storm in this app IS a
 * filled dot with a spiral and a halo, and that equation is the whole
 * legibility of the globe. Genesis obeys it by having no point marker at all.
 * A flood alert cannot do that — a chip at a point is the only thing that
 * survives §56.2's pixel table at planet distance — so it obeys the rule the
 * other way, by not being round. A reader who has learnt "round means a storm"
 * is never asked to unlearn it, and the distinction still holds for somebody
 * who cannot tell the green from the orange.
 *
 * ==> ITS OWN FILE BECAUSE THE GATE SAID SO, AND THE GATE WAS RIGHT. <==
 * `map/layers/flood.js` crossed §12's 700-line ceiling when the perf fixes
 * landed and `doc-check` refused the push. Texture generation and layer wiring
 * are genuinely different jobs — this one touches a canvas and knows nothing
 * about sources, selection or the corridor — so the cut was already there
 * waiting to be made rather than invented to satisfy a number.
 *
 * FOUR IMAGES: warning and watch, times two themes, pre-added under stable
 * names. Pre-adding both themes means a theme flip is a layout-property write
 * and never an `addImage` — a texture upload on the frame the reader is
 * looking at is the thing `map/layers/genesis.js` learnt to avoid.
 *
 * Imports config/ only. No map state, no data, no siblings.
 */

import { DARK, FLOOD_COLOR, FLOOD_COLOR_LIGHT, FLOOD_GEO, LIGHT } from '../../config/tokens.js';

/* ---------------------------------------------------------------------------
 * THE CHIP
 *
 * ==> IT IS A ROUNDED SQUARE AND IT MUST NEVER BECOME A CIRCLE. <== The rule
 * is `GENESIS_GEO`'s, stated there and inherited here: a storm in this app IS
 * a filled dot with a spiral and a halo, and that equation is the whole
 * legibility of the globe. Genesis obeys it by having no point marker at all.
 * A flood alert cannot do that — a chip at a point is the only thing that
 * survives §56.2's pixel table at planet distance — so it obeys the rule the
 * other way, by not being round. A reader who has learnt "round means a storm"
 * is never asked to unlearn it, and the distinction still holds for somebody
 * who cannot tell the green from the orange.
 *
 * FOUR IMAGES: warning and watch, times two themes, pre-added under stable
 * names. Pre-adding both themes means a theme flip is a layout-property write
 * and never an `addImage` — a texture upload on the frame the reader is
 * looking at is the thing `map/layers/genesis.js` learnt to avoid.
 * ------------------------------------------------------------------------- */

export const chipName = (watch, light) => `flood-chip-${watch ? 'watch' : 'warning'}-${light ? 'light' : 'dark'}`;

/**
 * One chip, drawn at 2x.
 *
 * ==> NO DOM, NO CHIP, AND THAT IS A DEGRADE RATHER THAN A FAILURE. <== The
 * headless suites drive the layer engine with a stub map and no `document` at
 * all. `map/layers/genesis.js` records what happens when a layer throws in
 * `ensure`: the WHOLE engine goes down, every storm layer with it. Returning
 * null costs the chips and nothing else — the polygons are ordinary paint and
 * still draw, so an alert is still a green shape on the map. That is the right
 * trade for a texture upload that cannot happen, and it is invisible in
 * practice because the only place without a `document` is a suite where
 * nobody is looking at the globe.
 */
function chipImage(fill, stroke) {
  if (typeof document === 'undefined' || !document.createElement) return null;

  const scale = 2;
  const size = FLOOD_GEO.chipSizePx * scale;
  const r = FLOOD_GEO.chipRadiusPx * scale;
  const w = FLOOD_GEO.chipStrokeWidth * scale;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  /* Inset by half the stroke so the border is drawn INSIDE the tile. A stroke
   * centred on the path spills half its width past the edge and the canvas
   * clips it, which shows up as a chip with two crisp sides and two soft ones. */
  const a = w / 2;
  const b = size - w / 2;

  ctx.beginPath();
  ctx.moveTo(a + r, a);
  ctx.lineTo(b - r, a);
  ctx.quadraticCurveTo(b, a, b, a + r);
  ctx.lineTo(b, b - r);
  ctx.quadraticCurveTo(b, b, b - r, b);
  ctx.lineTo(a + r, b);
  ctx.quadraticCurveTo(a, b, a, b - r);
  ctx.lineTo(a, a + r);
  ctx.quadraticCurveTo(a, a, a + r, a);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = w;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  return { data: ctx.getImageData(0, 0, size, size), pixelRatio: scale };
}

/** Add all four chips if they are not already there. Idempotent: `ensure` may
 *  run more than once and `hasImage` is the cheap guard. */
export function ensureChipImages(map) {
  for (const light of [false, true]) {
    const colors = light ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
    /* THE OUTLINE INK IS THE THEME'S LABEL HALO, WHICH IS THE INK THIS APP
     * ALREADY USES FOR "SEPARATE THIS MARK FROM THE MAP UNDER IT" — dark in
     * the dark theme, near-white in the light one. Borrowing it rather than
     * minting a fifth hex means the chip tracks any future change to how marks
     * are separated from the basemap.
     *
     * ==> BOTH PALETTES ARE READ BY NAME, NOT THROUGH `palette()`. <== That
     * function answers for the ACTIVE theme only, and this loop is building
     * the images for BOTH so a theme flip never has to upload a texture. */
    const stroke = (light ? LIGHT : DARK).geo.labelHalo;
    for (const watch of [false, true]) {
      const name = chipName(watch, light);
      if (map.hasImage?.(name)) continue;
      const img = chipImage(watch ? colors.WATCH : colors.WARNING, stroke);
      if (img) map.addImage(name, img.data, { pixelRatio: img.pixelRatio });
    }
  }
}

