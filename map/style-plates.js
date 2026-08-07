/**
 * style-plates.js — THE PLATE-BOUNDARY LAYERS, LIFTED OUT OF `map/style.js`.
 *
 * ===========================================================================
 * THIS IS A MOVE, NOT A REWRITE. NOTHING BELOW CHANGED BEHAVIOUR.
 * ===========================================================================
 *
 * Both functions arrived here verbatim out of `map/style.js`, banners and all.
 *
 * ===========================================================================
 * WHY THEY LEFT, AND WHY `NOW.md` DESCRIBED THIS WRONG.
 * ===========================================================================
 *
 * The claim was "empty layer definitions shipping to every user." That was not
 * true and it is worth writing down so nobody goes looking for a bug that never
 * existed: both functions have always opened with `if (!plates) return []`, and
 * Sky passes `plates: null` (`config/worlds/sky.js`), so **no plate layer has
 * ever reached the shipped map.** The style JSON was already correct.
 *
 * What DID ship to every visitor was the code itself — roughly 370 lines of
 * layer builders plus the `PLATE_LINE` import, which drags 223 lines and 13 KB
 * of constants behind it. `map/style.js` is on the cyclone critical path, there
 * is no build step to shake out an unused import (SPEC.md §2), so a function
 * that can never run was still downloaded and parsed before the globe drew.
 *
 * ===========================================================================
 * THE CONTRACT: A WORLD THAT WANTS PLATES BRINGS ITS OWN BUILDERS.
 * ===========================================================================
 *
 * `buildStyle()` now takes `plateLayers` and `plateLabelLayers` as options and
 * defaults both to null. Sky passes neither and never loads this file. The Deep
 * prototype (`proto/shell.js`) imports them and passes them in.
 *
 * ==> THE IMPORT RUNS proto/ -> map/, AND NEVER config/ -> map/. <== The
 * obvious-looking home for these was `config/worlds/deep.js`, next to the plate
 * COLOURS. That would have made a config file import from `map/`, which is
 * backwards and is the first step toward a cycle (SPEC.md §12). The consumer
 * supplies them instead.
 *
 * `tools/module-graph.mjs` is the check: if this filename appears in its output,
 * something on the cyclone path grew a plate import by accident.
 */

import { SIZE, OPACITY } from '../config/tokens.js';
import { ZOOM } from '../config/constants.js';
import { PLATE_LINE } from '../config/plate-line.js';
import { byZoom, PLATE_LABEL_SOURCE } from './style.js';

/* ---------------------------------------------------------------------------
 * PLATE BOUNDARIES (SPEC-GLOBES.md §43.2) — MAGMA. Three passes, and the third
 * one is what turns an orange line into molten rock.
 *
 * ==> THIS EXISTS BECAUSE THE THREE GLOBE'S SEAMS CANNOT REACH THE GROUND. <==
 * They faded out on `DIVE.fade.cage` and nothing down here replaced them, so
 * plate boundaries were visible from the space floor to about z3.9 and then
 * simply gone for the rest of the zoom range. The fix is the one the coastline
 * has always used: the SAME feature exists in BOTH renderers, pixel-locked by
 * `map/globe-follow.js`, and the crossfade hands one to the other. Three's
 * copy now leaves on `DIVE.fade.land` alongside the coastline it is paired
 * with, exactly where these come up to full.
 *
 * ---------------------------------------------------------------------------
 * WHY THREE LAYERS AND NOT A BLOOM PASS. This is the whole technique.
 *
 * Hot things do not glow evenly. A magma seam is a near-white core inside a
 * bright orange body inside a wide dim red spread, and stacking three passes
 * from widest-and-dimmest to thinnest-and-brightest is how you draw that. It
 * shipped with only the outer two, which is an orange line with a hint of
 * warmth behind it — the near-white core is the layer that says "this is hotter
 * than anything else on the map".
 *
 * A POST-PROCESS BLOOM WAS THE OTHER OPTION AND IT IS DISQUALIFIED ON MOBILE.
 * Arm measure their own bloom pipeline at ~3 ms a frame at full resolution —
 * roughly a fifth of the entire 16.6 ms budget — because a blur has to read
 * pixels from outside its own tile, which breaks the tile-local memory
 * behaviour that makes phone GPUs efficient at all. Their published
 * alternatives are baking the glow into a texture and using camera-facing glow
 * geometry, and a widened blurred line layer IS the second one. The cheap way
 * and the vendor-recommended way are the same way here, which is rare enough
 * to be worth saying out loud.
 *
 * NOTHING ANIMATES. A shimmer would sell this hard and it stays out of MapLibre
 * on purpose: animating a paint property means calling `setPaintProperty` every
 * frame, and every one of those frames makes MapLibre redraw the whole map. The
 * app is idle-cheap today precisely because that does not happen. Deep DOES
 * shimmer its seams — in the Three shader, from space, where the renderer is
 * already drawing every frame and the effect is nearly free (see
 * `proto/world-deep.js` SEAM_FRAG). Decided 2026-07-30.
 *
 * ---------------------------------------------------------------------------
 * BENEATH THE COASTLINE, for the reason the borders and the graticule are:
 * a reference line crossing OVER a glowing coastline reads as an error. No
 * world currently draws both these and the graticule, so their relative order
 * is undecided rather than wrong — decide it when one does.
 *
 * TOLD APART FROM THE COAST BY THREE THINGS, NOT ONE. Hue is the loud one, but
 * width and opacity carry it for anyone who cannot use the hue. See the note on
 * `SIZE.plateWidthScale`.
 *
 * ==> AND THE HOT CORE IS THE ONE THING HERE THAT COULD COLLIDE WITH A FIXED
 * HAZARD RAMP. <== This globe's own hazard is earthquakes, and USGS MMI runs
 * `#ffaa00` → `#fd0000`. The core is deliberately a near-WHITE rather than a
 * brighter orange, so it sits off the end of that ramp instead of on top of it.
 * The rule that actually protects this, from `config/worlds/deep.js`: quake
 * severity on Deep is size and ripple strength, never hue.
 * ------------------------------------------------------------------------- */

export function plateLayers(plates) {
  if (!plates) return [];
  /** One pass's width at one zoom step. Every plate width in the file goes
   *  through here, so the three passes share a base and a floor and the
   *  stair-step between them is exactly `SIZE.plateStack`.
   *
   *  FLOORED, AND IT STAYS FLOORED EVEN THOUGH NOTHING IS NEAR IT TODAY.
   *  `plateWidthScale` is a multiplier someone retunes on glass, and at 0.7 the
   *  core's planet-band stop came out at 0.63 px — a line MapLibre draws
   *  perfectly and nobody can see. The guard costs nothing at 2.8 and is the
   *  whole difference at the next value someone tries. Depth fade therefore
   *  lives in the opacity ramps as well as the widths. */
  const plateW = (mult, zoomStep) =>
    Math.max(SIZE.hairlineFloor, SIZE.coastWidthCore * SIZE.plateWidthScale * mult * zoomStep);
  return [
    /** THE OUTER HEAT — wide, heavily blurred, low opacity. Not a line: the
     *  light a hot line throws onto the rock around it. This is the layer that
     *  makes the seam read as a source of light rather than a stroke. */
    {
      id: 'plate-glow',
      type: 'line',
      source: 'plates',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': plates.glow,
        /* ==> WIDTH COMES FROM `SIZE.plateStack`, NOT FROM THE COAST GLOW. <==
         * It used to derive from `coastWidthGlow`, which put it at almost exactly
         * the same width as the body pass below — three layers at two widths,
         * which reads as one line. The stack ratios are stated in one place now
         * so the steps cannot drift back together. */
        'line-width': byZoom([
          [ZOOM.planet, plateW(SIZE.plateStack.heat, 0.6)],
          [ZOOM.basin, plateW(SIZE.plateStack.heat, 1)],
          [ZOOM.local, plateW(SIZE.plateStack.heat, 1.6)],
        ]),
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.plateGlow * 0.7],
          [ZOOM.regional, OPACITY.plateGlow],
          [ZOOM.max, OPACITY.plateGlow * 0.8],
        ]),
        /* MORE BLUR THAN THE COAST GETS, AND MORE THAN THIS USED TO HAVE. A
         * boundary is a diffuse deformation zone; the softness is the honest
         * part of the picture, not the decoration. */
        'line-blur': byZoom([
          [ZOOM.planet, 3],
          [ZOOM.local, 9],
        ]),
      },
    },

    /** THE MAGMA BODY — the layer that was called the core until there was a
     *  real core above it. Bright orange, lightly blurred so it bleeds into the
     *  outer heat instead of ending on an edge. */
    {
      id: 'plate-core',
      type: 'line',
      source: 'plates',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': plates.core,
        'line-width': byZoom([
          [ZOOM.planet, plateW(SIZE.plateStack.body, 0.6)],
          [ZOOM.basin, plateW(SIZE.plateStack.body, 1)],
          [ZOOM.local, plateW(SIZE.plateStack.body, 1.6)],
        ]),
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.plateCore * 0.44],
          [ZOOM.basin, OPACITY.plateCore * 0.76],
          [ZOOM.regional, OPACITY.plateCore],
        ]),
        'line-blur': byZoom([
          [ZOOM.planet, 1],
          [ZOOM.local, 4],
        ]),
      },
    },

    /** THE SUPERHEATED CORE — thin, unblurred, full strength, near-white.
     *
     *  NO BLUR AT ALL, deliberately: a blurred core is just a second body layer,
     *  and the whole reason this reads as heat is the hard bright line inside
     *  the soft one. Kept NARROWER than the body at every zoom by construction
     *  — the widths derive from the same coast width so they cannot cross — and
     *  floored like the body, since a sub-pixel white line is anti-aliased down
     *  to nothing and this is the layer whose absence is most obvious.
     *
     *  IT ARRIVES LAST. At the planet band a 1 px white line on a 12 px orange
     *  band would be the brightest thing on a globe you are still orienting on,
     *  and the seam network would out-shout the coastline. The opacity ramp
     *  holds it back until the basin band, where you have committed to looking
     *  at plates. */
    {
      id: 'plate-hot',
      type: 'line',
      source: 'plates',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': plates.hot,
        'line-width': byZoom([
          [ZOOM.planet, plateW(SIZE.plateStack.hot, 0.75)],
          [ZOOM.basin, plateW(SIZE.plateStack.hot, 1)],
          [ZOOM.local, plateW(SIZE.plateStack.hot, 1.5)],
        ]),
        'line-opacity': byZoom([
          [ZOOM.planet, OPACITY.plateHot * 0.25],
          [ZOOM.basin, OPACITY.plateHot * 0.8],
          [ZOOM.regional, OPACITY.plateHot],
        ]),
      },
    },
  ];
}

/* ---------------------------------------------------------------------------
 * PLATE NAMES — one on each side of every seam, bending along it.
 *
 * ==> THE SIDE IS CARRIED BY THE GEOMETRY, NOT BY `text-offset`. <== The full
 * reasoning is in `lib/plate-lines.js`, and the short version is that MapLibre
 * flips a line label end-for-end when it would otherwise read upside down, and
 * the flip takes `text-offset` with it — so a pixel-constant offset puts the
 * Pacific plate over California as soon as you turn the globe. `plate-labels`
 * therefore holds lines that are ALREADY displaced to one side or the other,
 * each carrying only its own plate's name, and these layers add no offset at
 * all. Measured against real MapLibre 5.6.0 before it was built this way.
 *
 * TWO LAYERS, ONE PER DISPLACEMENT BAND. A geographic displacement is not
 * pixel-constant, so the source carries a `far` copy and a `near` copy and
 * these crossfade between them around `PLATE_LINE.labelBand`. Both layers are
 * otherwise identical, which is why they are built by one function.
 *
 * THE TIER LADDER IS WHAT MAKES THIS LEGIBLE. Fifty-two plates all labelling at
 * the planet band is fifty-two labels the collision pass throws away, and which
 * ones survive is an accident of placement order. `tier` ranks each plate by how
 * much boundary it owns, `symbol-sort-key` makes the big ones win every
 * collision, and the per-tier opacity ramp keeps fragments off the screen until
 * there is room. Aaron's requirement was a name visible at any zoom AND any
 * rotation; the repeat spacing is the other half of that — several candidates
 * per seam means turning the globe swaps which copy you see rather than losing
 * the name.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * TWO ZOOM RAMPS, ONE EXPRESSION — AND MAPLIBRE INSISTS.
 *
 * A plate label's opacity is the product of two zoom curves: its TIER's arrival
 * ramp, and its displacement BAND's crossfade. The obvious way to write that is
 * `['*', bandRamp, tierRamp]`, and MapLibre rejects it outright:
 *
 *   layers[11].paint.text-opacity: Only one zoom-based "step" or "interpolate"
 *   subexpression may be used in an expression.
 *
 * ==> AND THE FAILURE IS NOT LOCAL. <== An invalid paint property does not
 * disable one layer, it rejects the whole STYLE — `style.load` never fires,
 * `getStyle()` stays undefined, and the map draws absolutely nothing. Caught in
 * a headless run rather than on a phone, which is the entire reason that harness
 * exists; on glass it would have presented as "the prototype is blank".
 *
 * SO THE PRODUCT IS COMPUTED HERE, IN JAVASCRIPT, and handed over as a single
 * zoom ramp whose stop VALUES vary by tier. One `interpolate` over zoom, with a
 * `case` on the feature's own tier at each stop — which is MapLibre's supported
 * zoom-and-property composite form, and the only shape that expresses this.
 *
 * SAMPLED AT EVERY BREAKPOINT OF BOTH CURVES, so the result is exact wherever
 * either curve turns. Between two breakpoints the true product is quadratic
 * (both ramps moving at once) and this draws it straight; the error peaks at a
 * few percent of an opacity nobody is measuring.
 * ------------------------------------------------------------------------- */

/** Linear 0 to 1 from `a` to `b`, clamped — the shape every ramp in this file
 *  has, evaluated in JS rather than by MapLibre. */
const ramp = (z, a, b) => Math.max(0, Math.min(1, (z - a) / (b - a)));

/* ---------------------------------------------------------------------------
 * PLATE NAMES — the two plates of a seam, PAIRED at one point on it.
 *
 * ==> `line-center`, NOT `line`. THIS IS THE WHOLE PLACEMENT DECISION. <== With
 * `symbol-placement: 'line'` MapLibre repeats a label every `symbol-spacing`
 * pixels along its line and each side is placed independently. On glass that gave
 * five copies of AFRICA down the Mid-Atlantic Ridge with no relationship between
 * the two sides, so reading a boundary meant hunting for its other name.
 *
 * `line-center` places exactly ONE label per feature, at the centre of that
 * feature's line. So `lib/plate-lines.js` hands over short windows of the curve —
 * one per side, both centred on the same anchor point — and the two names land
 * opposite each other across the seam and read as a pair in one glance. Density
 * is then a property of how many anchors exist (`PLATE_LINE.labelBands`), which
 * is a number in the constants file rather than an emergent property of a pixel
 * spacing.
 *
 * THREE LAYERS, ONE PER DISPLACEMENT BAND. A geographic displacement is not
 * pixel-constant (see `lib/plate-lines.js` for why the pixel-constant mechanism
 * cannot be used at all), so each band carries its own offset, window length and
 * anchor spacing, and they crossfade. All three layers are otherwise identical,
 * which is why one function builds them.
 *
 * THE TIER LADDER IS WHAT MAKES THIS LEGIBLE. Fifty-two plates all labelling at
 * the planet band is fifty-two labels the collision pass throws away, and which
 * ones survive is an accident of placement order. `tier` ranks each plate by how
 * much boundary it owns, `symbol-sort-key` makes the big ones win every
 * collision, and the per-tier opacity ramp keeps fragments off the screen until
 * there is room.
 * ------------------------------------------------------------------------- */

export function plateLabelLayers(plates) {
  if (!plates) return [];

  const half = PLATE_LINE.bandOverlap / 2;
  const bands = PLATE_LINE.labelBands;

  /** A band's own fade, driven by the SHARED handover zooms.
   *
   *  ==> BOTH SIDES OF A HANDOVER READ THE SAME NUMBER, AND THAT IS THE FIX. <==
   *  Each band used to carry its own `from` and `to`, so the outgoing band faded
   *  out around ITS edge while the incoming one faded in around a different one
   *  0.2 away — at z3.75 the two summed to 1.12 and every plate name was drawn
   *  one and a bit times over. Reading `bands[i-1].until` for the rise and
   *  `bands[i].until` for the fall makes the two ramps exact complements by
   *  construction rather than by two constants agreeing.
   *
   *  The first band never fades in and the last never fades out, so the bottom
   *  and top of the zoom range are covered rather than dark. */
  const bandAt = (z, i) => {
    const inRamp = i === 0 ? 1 : ramp(z, bands[i - 1].until - half, bands[i - 1].until + half);
    const outRamp =
      i === bands.length - 1 ? 1 : 1 - ramp(z, bands[i].until - half, bands[i].until + half);
    return Math.min(inRamp, outRamp);
  };

  /** A tier's own arrival: nothing before `tierIn`, full `tierFade` later. */
  const tierAt = (tier, z) =>
    ramp(z, PLATE_LINE.tierIn[tier], PLATE_LINE.tierIn[tier] + PLATE_LINE.tierFade);

  /** Every zoom at which any curve changes direction, plus the ends of the
   *  range. Deduped and sorted, so moving a constant moves the sample points
   *  with it and nothing here restates a zoom. */
  const breakpoints = [
    ZOOM.min,
    ...[1, 2, 3].flatMap((t) => [PLATE_LINE.tierIn[t], PLATE_LINE.tierIn[t] + PLATE_LINE.tierFade]),
    ...bands.filter((b) => b.until !== undefined).flatMap((b) => [b.until - half, b.until + half]),
    ZOOM.max,
  ]
    .filter((z) => z >= ZOOM.min && z <= ZOOM.max)
    .filter((z, i, a) => a.indexOf(z) === i)
    .sort((a, b) => a - b);

  return bands.map((band, i) => ({
    id: `plate-name-${band.id}`,
    type: 'symbol',
    source: PLATE_LABEL_SOURCE,
    filter: ['==', ['get', 'band'], band.id],
    /* ==> EACH BAND IS CONFINED TO ITS OWN ZOOM WINDOW, AND THAT IS A COLLISION
     * FIX, NOT AN OPTIMISATION. <== All three layers first shared one `minzoom`
     * of `tierIn[1]`, on the reasoning that the opacity ramps decide what is
     * visible. They do — and MapLibre still PLACES a symbol whose opacity is
     * zero. Measured at z4.4: nine invisible `near`-band Africa labels were laid
     * out and, because `near` is the topmost of the three layers and placement
     * runs top-down, they won every collision against the `mid` labels that were
     * actually on screen. The visible band was being crowded out by two bands
     * nobody could see.
     *
     * `maxzoom` is left OFF the last band so it survives to `ZOOM.max` — a
     * `maxzoom` equal to the top of the range would hide the layer exactly at the
     * top zoom, which is a subtle way to lose every plate name at full zoom. */
    minzoom: i === 0 ? ZOOM.min : Math.max(ZOOM.min, bands[i - 1].until - half),
    ...(i === bands.length - 1 ? {} : { maxzoom: Math.min(ZOOM.max, band.until + half) }),
    layout: {
      'text-field': ['get', 'plate'],
      'text-font': ['Noto Sans Regular'],
      'text-size': SIZE.plateLabelPx,
      /* THE SAME VOICE THE COUNTRY NAMES USE — uppercase and letterspaced —
       * because a plate is an area, and an area label should read as a region
       * rather than as a point. One notch wider than the country tracking, so
       * the two kinds of region label are distinguishable without a second
       * colour doing all the work. */
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.2,
      /* ONE LABEL, AT THE MIDDLE OF ITS WINDOW. See the note above — this single
       * word is what pairs the two names and what stops them repeating. */
      'symbol-placement': 'line-center',
      'text-max-angle': PLATE_LINE.labelMaxAngle,
      /* A plate name never wraps. On a line, a second line of text would sit
       * across the seam the first line is supposed to sit beside. */
      'text-max-width': 30,
      /* Lower sorts first and therefore wins collisions: tier 1 beats tier 3. */
      'symbol-sort-key': ['to-number', ['coalesce', ['get', 'tier'], 9]],
      /* ==> NO COLLISION PADDING, BECAUSE THE PAIR HAS TO SIT CLOSE. <== The two
       * names of a seam are deliberately only tens of pixels apart — that
       * closeness is the whole point, it is what lets you read both in one
       * glance. MapLibre's default 2 px of padding on each box is enough, at that
       * separation, to make the pair collide with ITSELF and drop one half. A
       * half-labelled boundary is worse than an unlabelled one: it reads as a
       * statement about the plate that got the name. */
      'text-padding': 0,
    },
    paint: {
      'text-color': plates.text,
      /* HALOED IN THE OCEAN COLOUR, not in the land colour the place labels
       * use. A seam runs through both, and it spends most of its length at sea. */
      'text-halo-color': plates.textHalo,
      'text-halo-width': SIZE.plateLabelHaloPx,
      'text-opacity': byZoom(
        breakpoints.map((z) => [
          z,
          [
            'case',
            ['==', ['get', 'tier'], 1],
            tierAt(1, z) * bandAt(z, i),
            ['==', ['get', 'tier'], 2],
            tierAt(2, z) * bandAt(z, i),
            tierAt(3, z) * bandAt(z, i),
          ],
        ])
      ),
    },
  }));
}
