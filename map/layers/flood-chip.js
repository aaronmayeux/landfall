/**
 * flood-chip.js — the mark that stands for a flood alert on the globe, and the
 * four expressions that decide which one a feature gets. SPEC-FLOOD-PLAN.md
 * §56.5, SPEC-UI.md §56.10.
 *
 * ==> IT WAS LIFTED OUT OF `map/layers/flood.js` AND NOTHING ABOUT IT CHANGED.
 * <== That file crossed §12's 700-line ceiling on Slice B and SPEC.md's
 * inventory named this cut twice while the file grew both times. Slice C does
 * it FIRST and on its own, because folding a behaviour-neutral move into the
 * same commit as new behaviour is what made the first attempt at this phase
 * impossible to bisect (§56.15).
 *
 * ==> EVERYTHING HERE IS PURE, WHICH IS WHY IT LIFTED CLEANLY. <== One lazily
 * built `Path2D` is the only module state, and it is a cache of a constant. No
 * alert list, no visibility flag, no map handle held between calls — the map is
 * an argument to the one function that needs it. Nothing had to be threaded
 * back the other way.
 *
 * ==> AND IT TOOK `map/`'s ONLY EDGE INTO `ui/` WITH IT, WHICH IS THE TIDIER
 * PLACE FOR IT. <== The chip strokes the same path data as the `Flooding`
 * section heading, so the import has to exist somewhere; it belongs in the file
 * that draws the mark rather than in the file that registers a layer.
 *
 * ---------------------------------------------------------------------------
 * THE CHIP
 *
 * ==> IT IS A ROUNDED SQUARE AND IT MUST NEVER BECOME A CIRCLE. <== The rule is
 * `GENESIS_GEO`'s, stated there and inherited here: a storm in this app IS a
 * filled dot with a spiral and a halo, and that equation is the whole
 * legibility of the globe. Genesis obeys it by having no point marker at all. A
 * flood alert cannot do that — a mark at a point is the only thing that
 * survives §56.2's pixel table at planet distance, where the polygon is under
 * twelve pixels — so it obeys the rule the other way, by not being round. A
 * reader who has learnt "round means a storm" is never asked to unlearn it, and
 * the distinction still holds for somebody who cannot tell the green from the
 * orange.
 *
 * ==> AND IT CARRIES THE THREE-WAVE FLOOD GLYPH, WHICH SLICE B FORGOT. <==
 * `SPEC-UI.md` §56.10 committed to this in Phase 2, before the map phase was
 * written: the globe strokes **the same path data** as the `Flooding` section
 * heading, not a redrawn shape, so tapping a wave opens a panel headed with the
 * same wave. Slice B drew a blank square instead — the silhouette argument
 * above is about NOT BEING ROUND and was never an argument for featureless.
 * **Caught by Aaron on a phone on 2026-08-23, not by any gate here**, which is
 * why `tools/test-flooding.mjs` asserts this file imports the shape rather than
 * carrying a copy of it.
 *
 * ==> THE WAVES ARE THE SAME PROPORTIONS AS THE HEADING, DRAWN LARGER. <== The
 * whole 24-box is mapped into the chip's clear area exactly as `.sect-ico`
 * maps it into 16 px, so nothing is re-authored and nothing is stretched. At
 * `FLOOD_GEO.chipSizePx` 24 that clear area is 19 px — bigger than the heading,
 * which is the margin this needs: the heading sits still beside a word, and
 * this sits on a moving map over a basemap.
 *
 * EIGHT IMAGES: waves and count, times warning and watch, times two themes,
 * pre-added under stable names. Pre-adding every theme means a theme flip is a
 * layout-property write and never an `addImage` — a texture upload on the frame
 * the reader is looking at is the thing `map/layers/genesis.js` learnt to avoid.
 *
 * ==> A CLUSTER GETS THE COUNT AND NO WAVES, AND THAT IS A TRADE RATHER THAN A
 * FREE CHOICE. <== Both cannot share a 24 px chip: three waves under a numeral
 * is two marks fighting, and the numeral is the one that stops being readable.
 * So a single alert says WHAT it is and a pile says HOW MANY. The colour and
 * the silhouette still say "flood, not a storm" in both cases, which is what
 * carries at planet distance. **Unseen on glass** — if a numbered chip reads as
 * belonging to a different layer, the fallback is a smaller numeral beside
 * smaller waves rather than dropping the count.
 *
 * Imports config/ and one `ui/` sibling. No map/ siblings, no lib/, no state.
 */

import {
  DARK,
  FLOOD_COLOR,
  FLOOD_COLOR_LIGHT,
  FLOOD_GEO,
  LIGHT,
} from '../../config/tokens.js';
import { isLight } from '../../config/theme.js';
/* ==> THE ONE EDGE FROM `map/` INTO `ui/`, AND SPEC-UI.md §56.10 ASKED FOR IT
 * BY NAME. <== The chip strokes the SAME path data as the `Flooding` section
 * heading, so the mark on the globe and the mark on the panel cannot drift.
 * Nothing in `ui/` imports from `map/`, so this is a direction rather than a
 * cycle (§12), and `ui/section-icon.js` is already on the boot path — this adds
 * no module and no request. */
import { iconPathData } from '../../ui/section-icon.js';

const chipName = (watch, light, counted) =>
  `flood-chip-${counted ? 'count' : 'waves'}` +
  `-${watch ? 'watch' : 'warning'}-${light ? 'light' : 'dark'}`;

/** The `Flooding` heading's three waves, as `Path2D`, built once on first draw.
 *
 *  ==> LAZY, AND THAT IS NOT A MICRO-OPTIMISATION. <== `Path2D` is a browser
 *  global. Constructing it at module scope throws the moment anything outside a
 *  browser imports this file — a syntax check, a node suite, a tool. Deferring
 *  it means the file imports cleanly everywhere and only needs a canvas where it
 *  is actually drawing on one. Same trap and same answer as `map/glyph.js`. */
let wavePath = null;
function waves() {
  if (!wavePath) {
    wavePath = new Path2D();
    for (const d of iconPathData('flood')) wavePath.addPath(new Path2D(d));
  }
  return wavePath;
}

/**
 * One chip, drawn at 2x.
 *
 * ==> NO DOM, NO CHIP, AND THAT IS A DEGRADE RATHER THAN A FAILURE. <== The
 * headless suites drive the layer engine with a stub map and no `document` at
 * all. `map/layers/genesis.js` records what happens when a layer throws in
 * `ensure`: the WHOLE engine goes down, every storm layer with it. Returning
 * null costs the chips and nothing else — the polygons are ordinary paint and
 * still draw, so an alert is still a green shape on the map. That is the right
 * trade for a texture upload that cannot happen.
 *
 * @param {string} fill    the chip's green
 * @param {string} stroke  the chip's border ink
 * @param {string|null} glyphInk  the waves' ink, or null for a counted chip
 */
function chipImage(fill, stroke, glyphInk) {
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

  if (glyphInk) drawWaves(ctx, size, glyphInk, scale);

  return { data: ctx.getImageData(0, 0, size, size), pixelRatio: scale };
}

/**
 * Stroke the heading's 24-box into the chip's clear area.
 *
 * ==> THE WHOLE BOX IS MAPPED, NOT THE INK'S BOUNDING BOX. <== `.sect-ico`
 * renders `viewBox="0 0 24 24"` into a 16 px square, so mapping 0-24 here
 * reproduces the heading's proportions exactly. Fitting the ink instead would
 * silently change the weight-to-amplitude ratio and give the same mark two
 * different looks in two places, which is the drift §56.10 exists to stop.
 *
 * The stroke is set BEFORE the scale, in 24-box units, so it scales with the
 * drawing — again exactly as the SVG's `stroke-width` does.
 */
function drawWaves(ctx, size, ink, scale) {
  const clear = size - 2 * (FLOOD_GEO.chipStrokeWidth + FLOOD_GEO.glyphInsetPx) * scale;
  const k = clear / 24;
  const origin = (size - clear) / 2;

  ctx.save();
  ctx.translate(origin, origin);
  ctx.scale(k, k);
  ctx.strokeStyle = ink;
  ctx.lineWidth = FLOOD_GEO.glyphStrokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(waves());
  ctx.restore();
}

/** Add all eight chips if they are not already there. Idempotent: `ensure` may
 *  run more than once and `hasImage` is the cheap guard. */
export function ensureChipImages(map) {
  for (const light of [false, true]) {
    const colors = light ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
    /* THE OUTLINE INK IS THE THEME'S LABEL HALO, WHICH IS THE INK THIS APP
     * ALREADY USES FOR "SEPARATE THIS MARK FROM THE MAP UNDER IT" — dark in the
     * dark theme, near-white in the light one. Borrowing it rather than minting
     * a fifth hex means the chip tracks any future change to how marks are
     * separated from the basemap.
     *
     * ==> BOTH PALETTES ARE READ BY NAME, NOT THROUGH `palette()`. <== That
     * function answers for the ACTIVE theme only, and this loop is building the
     * images for BOTH so a theme flip never has to upload a texture. */
    const stroke = (light ? LIGHT : DARK).geo.labelHalo;
    for (const watch of [false, true]) {
      const fill = watch ? colors.WATCH : colors.WARNING;
      /* ==> THE WAVES TAKE THE SAME INK THE COUNT WOULD. <== One rule for
       * "what is legible on this particular green", measured once in
       * `countInk()` and recomputed by `tools/test-flood-features.mjs`. WCAG
       * asks 3.0 of a non-text graphic and 4.5 of text this size, so reusing
       * the text ink holds the waves to the stricter of the two — which is the
       * safe direction and costs nothing, because the same four greens are
       * underneath either way. */
      const ink = countInk(watch, light);
      for (const counted of [false, true]) {
        const name = chipName(watch, light, counted);
        if (map.hasImage?.(name)) continue;
        const img = chipImage(fill, stroke, counted ? null : ink);
        if (img) map.addImage(name, img.data, { pixelRatio: img.pixelRatio });
      }
    }
  }
}

/**
 * Is this feature a WARNING rather than a watch? One expression, read by the
 * chip image, the count's ink and the count's halo, so the three can never
 * disagree about which thing is on screen.
 *
 * ==> A CLUSTER IS A WARNING IF IT HOLDS EVEN ONE. <== The more urgent member
 * is what the reader has to know is in there; a cluster that looked like a
 * watch while hiding a warning would be this layer understating a hazard.
 */
const isWarningExpr = () => [
  'case',
  ['has', 'point_count'],
  ['>', ['get', 'warnings'], 0],
  ['!', ['get', '_watch']],
];

/**
 * Which chip image a feature wants: waves for a single alert, the count's blank
 * face for a cluster, in the right shade for the active theme.
 *
 * ==> FOUR BRANCHES AND NOT TWO, BECAUSE THE MARK ITSELF CHANGES. <== See the
 * chip block above for why a cluster cannot carry both the waves and a numeral.
 */
export const chipExpr = () => {
  const light = isLight();
  const counted = ['has', 'point_count'];
  return [
    'case',
    ['all', counted, isWarningExpr()], chipName(false, light, true),
    counted, chipName(true, light, true),
    isWarningExpr(), chipName(false, light, false),
    chipName(true, light, false),
  ];
};

/**
 * The ink that is legible on one chip's green, in JavaScript.
 *
 * ==> ONE INK FOR ALL FOUR CHIPS FAILS WCAG AA ON EXACTLY ONE OF THEM, AND THAT
 * ONE IS REACHABLE. <== Computed rather than eyeballed — contrast ratios for
 * the theme's dark ink (#0B1420) and light ink (#F6F6F4) against each of the
 * four chip fills:
 *
 *   dark theme  / warning #3FBF6F   dark 7.83   light 2.18
 *   dark theme  / watch   #2A7A4A   dark 3.51   light 4.87
 *   light theme / warning #1E7A45   dark 3.46   light 4.94
 *   light theme / watch   #14532E   dark 2.03   light 8.41
 *
 * The first draft used the theme's label halo everywhere, which is the dark ink
 * on the dark theme — 3.51 on a watch cluster, under AA's 4.5 for text this
 * size, and a watch-only cluster is an ordinary thing to have on screen.
 * Picking per chip clears 4.5 on all four. §10, and
 * `tools/test-flood-features.mjs` recomputes the whole table so a hue change
 * cannot quietly drop one under the line.
 *
 * ==> IT IS A FUNCTION AND NOT ONLY AN EXPRESSION, BECAUSE THE WAVES NEED IT
 * TOO. <== The count is drawn by MapLibre and wants a paint expression; the
 * waves are drawn by us onto a canvas and want a plain string. One rule, read
 * two ways, rather than the same four hex choices written out twice.
 *
 * Only the dark theme's BRIGHT warning green wants the dark ink; the other
 * three greens are dark enough that the light ink wins.
 */
/* ==> A DECLARATION AND NOT A `const` ARROW, AND THAT IS LOAD-BEARING. <==
 * `ensureChipImages` sits ABOVE this in reading order — the chip block reads as
 * one story and splitting it to satisfy a hoisting rule would be the tail
 * wagging the dog — so a `const` here would sit in its temporal dead zone for
 * any caller that ran during module evaluation. Nothing does today, which is
 * exactly the kind of "works until somebody moves a call" this project has been
 * bitten by. A declaration is hoisted and cannot be. */
function countInk(watch, light) {
  return !watch && !light ? DARK.geo.labelHalo : LIGHT.geo.labelHalo;
}

/** The count's ink as a paint expression. Same rule as `countInk`. */
export const countInkExpr = () => {
  const light = isLight();
  return ['case', isWarningExpr(), countInk(false, light), countInk(true, light)];
};

/** The count's halo is the chip it is sitting on, so the glyph edge stays clean
 *  where it crosses the chip's own border. */
export const countHaloExpr = () => {
  const C = isLight() ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
  return ['case', isWarningExpr(), C.WARNING, C.WATCH];
};
