/**
 * season-swath.js — the archive globe's wind footprint. §57.26, §57.27,
 * §57.30 step 6b.
 *
 * The ground that ever saw 34, 50 or 64 knot wind over the storm's whole life,
 * as one merged outline per threshold. `lib/season-windswath.js` builds the
 * shapes; this file draws them.
 *
 * ==> IT DRAWS THE FOCUSED STORM AND NOTHING ELSE. THAT IS THE DESIGN, NOT A
 * LIMITATION. <== Aaron's call, 2026-08-24. Three nested corridors per storm
 * across four ticked storms is twelve translucent shapes piling on each other,
 * and compounding translucent fills is the look he rejected outright when the
 * live swath was built — it is the first thing `lib/windswath.js`'s header
 * says. So the footprint is a "tell me about this one" fact rather than an
 * at-a-glance one, and it rides the interaction §57.21 already calls the most
 * important in the feature.
 *
 * **The cost is real and is not hidden:** with nothing focused, nothing draws,
 * so a reader who never taps a track never sees a footprint. What makes that
 * acceptable is that the same tap is what the roster's sentence is about —
 * `ui/view-seasons-board.js` says why a storm has no footprint at the moment
 * it is focused, so the absence and the presence are discovered by one action.
 * **If it turns out to be undiscoverable on glass, the fix is the roster
 * saying so, not drawing all of them.**
 *
 * ==> AND IT IS THE ONE SEASON LAYER THAT REBUILDS ON FOCUS RATHER THAN
 * REPAINTING. <== `season-tracks.js` and `season-points.js` push every ticked
 * storm once and then swap a paint property, precisely because focus moves on
 * every tap and a `setData` re-tiles the source in the worker. This file
 * cannot do that: it holds at most one storm's shapes at a time, so a focus
 * change IS new data. Measured 2026-08-24 on the real season files — Katrina
 * is 12 ms and 1,363 vertices, Ida 13 ms and 1,645. Building the whole 2005
 * season instead would be 297 ms and 34,575 vertices, which is the second
 * reason this draws one storm rather than all of them.
 *
 * ==> AND IT TAKES THE CLOCK'S CUT, WHICH IT DID NOT WHEN THE CUT WAS BUILT.
 * <== §57.67 slice B closed with this named as a KNOWN GAP rather than an
 * oversight: the cut's scope was the tracks and the dots, and widening it would
 * have put a third layer in the same commit. Slice C is the first slice that
 * lets a reader focus a storm while the clock is somewhere in the middle of it,
 * so this is where the gap gets paid — without it, opening a storm mid-scrub
 * shows its COMPLETE lifetime footprint under a track that is half drawn, which
 * reads as the geometry being broken rather than as time passing.
 *
 * ==> THE CUT IS TAKEN ON THE FIXES, NOT ON THE BANDS. <== `timelineFor` drops
 * every record with no radii group (the landfall rows — see
 * `lib/season-windswath.js`), so the timeline is a FOURTH fix list beside the
 * clock's, the track's and the dot's, and `drawnFixes` is not a position in it.
 * Truncating the storm's own `points` first and letting the builder filter what
 * is left keeps everything in the one coordinate system §57.67e measured the
 * other three agreeing in.
 *
 * ==> AND IT REBUILDS ONLY WHEN A WHOLE FIX PASSES, WHICH IS WHAT MAKES IT
 * AFFORDABLE AT ALL. <== The footprint is swept BETWEEN recorded points, so its
 * shape depends on the whole fix count and on nothing else — `legFraction` is
 * not an input. A memo keyed on the storm and that count is therefore exact
 * rather than an approximation, and it turns "rebuild on every drag frame" into
 * "rebuild at most once per six-hourly fix". **Measured in node on 2026-08-31
 * over the sample storms: a rebuild averages 2.7-3.9 ms, and dragging the
 * scrubber across the whole of Harvey 2017 — 74 fixes, so 74 rebuilds — is
 * 249 ms of work spread over the entire drag.** Without the memo a 60 Hz
 * pointermove would ask for that same work several hundred times instead.
 *
 * The price, stated rather than hidden: the footprint stops at the last
 * completed fix, so it trails the head by up to one leg. That is honest — the
 * sweep is between published points and there is no half-leg to sweep.
 *
 * ==> NO THRESHOLD FALLBACK COLOUR. <== A band whose threshold cannot be read
 * is DROPPED rather than drawn in a default hue, the same rule
 * `map/layers/wind-field.js` follows: these are §6's fixed safety colours, and
 * a missing ring is visible where a wrong colour is a plausible lie. In
 * practice nothing is dropped — the builder writes `properties.radii` from
 * `WIND_KT` itself — and the guard stays because the alternative failure is
 * silent.
 *
 * Imports config/, lib/ and nothing from the layer engine — same reasoning as
 * `season-tracks.js`: a fixed set of finished shapes has no bundles, no feed
 * and no `forget` hook for the engine to manage.
 */

import { ARCHIVE_GEO } from '../../config/tokens.js';
import { buildSeasonSwath } from '../../lib/season-windswath.js';
import { windThresholdFromProps, windColor, windSortKey } from '../../lib/wind.js';
import { cutStateFor, cutHidesStorm, cutDrawnFixes } from './season-cut.js';

const SOURCE = 'season-swath';
const LAYER_FILL = 'season-swath-fill';
const LAYER_LINE = 'season-swath-line';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The storms currently ticked, keyed by id, so a focus change can build
 *  without the board handing the whole set back. Replaced wholesale by
 *  `setSeasonSwathSet`, exactly as the sibling layers' sources are. */
let byId = new Map();

/** Which storm's footprint is on screen, or null. Held for the same reason the
 *  sibling layers hold their focus id: `ensure` runs again after a style
 *  install and must come back showing the CURRENT truth. */
let focusId = null;

/** The clock's answer for every ticked storm, or null when the clock is not
 *  engaged. Held rather than passed in on the focus call, because focus moves
 *  on every tap and the moment moves on every scrub step — either one alone has
 *  to be able to redraw, and a redraw needs both. Same shape and same reason as
 *  `lastCut` in `season-points.js`. */
let lastCut = null;

/** The last footprint built, and the storm-and-fix-count it was built for.
 *
 *  ==> THE KEY IS A WHOLE FIX COUNT, WHICH IS WHY THIS IS EXACT AND NOT A
 *  GUESS. <== See the header: the sweep runs between recorded points, so two
 *  moments inside one six-hourly leg produce the identical shape. Keying on the
 *  count therefore skips a rebuild that would have returned the same answer,
 *  rather than skipping one that would have returned a different one. */
let memoKey = null;
let memoData = EMPTY;

/**
 * Tag each band with its §6 colour and its draw order.
 *
 * `fill-sort-key` puts the widest band underneath so the 64 kt core is not
 * buried by the 34 kt wash sitting on top of it — the nesting is the whole
 * point of drawing three, and it only reads if they stack in severity order.
 */
function decorated(features) {
  const out = [];
  for (const f of features || []) {
    const kt = windThresholdFromProps(f.properties);
    const color = windColor(kt);
    if (!color) continue;
    out.push({
      ...f,
      properties: { ...f.properties, _wkt: kt, _wcolor: color, _wsev: windSortKey(kt) },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * Attach the layers. Idempotent — the archive is entered and left many times
 * in one session and the source outlives all of it.
 *
 * @param {object} map
 * @param {string} [beforeId] draw beneath this layer, so the tracks and the
 *   landfall marks stay on top of the wash that is about them
 */
export function ensureSeasonSwath(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });

  map.addLayer(
    {
      id: LAYER_FILL,
      type: 'fill',
      source: SOURCE,
      layout: { 'fill-sort-key': ['get', '_wsev'] },
      paint: {
        'fill-color': ['get', '_wcolor'],
        'fill-opacity': ARCHIVE_GEO.swathFillOpacity,
      },
    },
    beforeId
  );

  map.addLayer(
    {
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', '_wsev'],
      },
      paint: {
        'line-color': ['get', '_wcolor'],
        'line-width': ARCHIVE_GEO.swathLineWidth,
        'line-opacity': ARCHIVE_GEO.swathLineOpacity,
      },
    },
    beforeId
  );
}

/**
 * Remember which storms are ticked. Draws nothing on its own.
 *
 * ==> THE SET AND THE FOCUS ARRIVE SEPARATELY BECAUSE THEY CHANGE AT DIFFERENT
 * RATES. <== Ticking happens a few times a session; focus moves on every tap
 * on a track. Folding them into one call would mean rebuilding a footprint
 * every time the roster changed for any reason.
 *
 * A storm that leaves the set while focused takes its footprint with it —
 * unticking is how a reader says "not this one", and leaving the shapes up
 * would be the globe disagreeing with the roster.
 *
 * ==> THE CUT RIDES THIS CALL AND NOT ONE OF ITS OWN, WHICH IS THE THIRD LAYER
 * TO SAY SO. <== `season-tracks.js` and `season-points.js` both carry the same
 * note: a moment that can be pushed separately from the storms is a moment that
 * can be forgotten, and the globe would then show a footprint from one time
 * under a line from another. `main.js`'s archive facade hands the same cut to
 * all three in one call.
 *
 * @param {object} map
 * @param {Array<{storm:object}>} selected
 * @param {Map<string, object>|null} [cut] storm id → the clock's state for it.
 *   Omitted, a focused storm's whole lifetime footprint draws, which is what
 *   the archive did before the clock existed.
 */
export function setSeasonSwathSet(map, selected = [], cut = null) {
  byId = new Map();
  for (const entry of selected) {
    const s = entry?.storm;
    if (s?.id) byId.set(s.id, s);
  }
  if (focusId && !byId.has(focusId)) focusId = null;
  lastCut = cut || null;
  drawFocused(map);
}

/**
 * Show this storm's footprint, or clear it.
 *
 * @param {object} map
 * @param {string|null} id
 */
export function setSeasonSwathFocus(map, id = null) {
  focusId = id && byId.has(id) ? id : null;
  drawFocused(map);
}

function drawFocused(map) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  const storm = focusId ? byId.get(focusId) : null;
  if (!storm) {
    src.setData(EMPTY);
    return;
  }

  /* ==> A STORM THE CLOCK HAS NOT REACHED HAS NO FOOTPRINT, THE SAME WAY IT HAS
   * NO TRACK AND NO DOTS. <== §57.67c rule 1. A wind field standing on empty
   * ocean before its storm exists is the reverted build's sepia sphere with
   * marks on it, in one layer instead of three.
   *
   * ==> AND IT IS EQUIVALENT RATHER THAN LOAD BEARING, WHICH IS ONLY
   * DEFENSIBLE BECAUSE IT SAYS SO. <== The same shape as slice A's
   * zero-length-leg guard and slice B's `running` guard, found the same way —
   * by mutation, on 2026-08-31. An unborn or absent storm's `drawnFixes` is
   * zero, so without this line the slice below is `points.slice(0, 0)`, the
   * timeline is empty and `buildSeasonSwath` returns no features anyway.
   * **Deleting it leaves `tools/test-season-swath.mjs` green**, and no test in
   * this repo covers it.
   *
   * It stays for two reasons that are worth more than the line costs: it is
   * the sentence this function is trying to say, and it is the early return
   * that stops an unborn storm taking a memo slot and a pointless build on
   * every step of a drag. */
  const state = cutStateFor(lastCut, focusId);
  if (cutHidesStorm(state)) {
    src.setData(EMPTY);
    return;
  }

  /* `total` is the raw fix list the BUILDER will read, and `drawnFixes` is
   * counted over the clock's own filter. §57.67e measured those two lists
   * agreeing across the whole archive — 6,532 storms, 175,262 fixes, zero
   * disagreements — so the clamp inside `cutDrawnFixes` does nothing today and
   * is one comparison against step 13's second source filling those columns
   * differently. With no cut it answers `total` and the storm is passed through
   * untouched, which is what makes the no-clock output structurally identical
   * rather than promised to be. */
  const total = storm.points?.length || 0;
  const drawn = cutDrawnFixes(state, total);

  const key = `${focusId}|${drawn}`;
  if (key === memoKey) {
    src.setData(memoData);
    return;
  }

  /* ==> A THROW IN HERE MUST NOT TAKE THE FOCUS TAP WITH IT. <== The sweep is
   * a lot of geometry and this is the archive's most frequent interaction; a
   * storm whose corridor will not build has to leave the track focused and the
   * roster correct, with no footprint, rather than leaving the reader unable
   * to select anything. The console names it because a footprint that silently
   * never appears is indistinguishable from one this storm never had — which
   * is the exact distinction §57.25 spends words on. */
  let features = [];
  try {
    /* The shallow copy is the whole of the cut. `buildSeasonSwath` reads
     * `points` and `id` and nothing else, and handing it a shorter list is the
     * same question asked of a shorter storm. Identity — not a copy — when
     * nothing is cut, so the uncut path cannot drift from what shipped. */
    features = buildSeasonSwath(drawn >= total ? storm : { ...storm, points: storm.points.slice(0, drawn) });
  } catch (err) {
    console.warn('[landfall] season swath could not be built', storm.id, err);
    features = [];
  }

  memoKey = key;
  memoData = decorated(features);
  src.setData(memoData);
}

/** Leaving the archive. Drops the shapes, the set and the focus together. */
export function clearSeasonSwath(map) {
  byId = new Map();
  focusId = null;
  /* The cut and the memo go with them, for the reason `season-points.js` gives:
   * a reader who leaves mid-scrub and comes back to 1935 must not find that
   * season frozen at whatever moment 2005 had reached — and a memo keyed on a
   * storm id would hand back 2005's shapes if that id were ever reused. */
  lastCut = null;
  memoKey = null;
  memoData = EMPTY;
  map?.getSource?.(SOURCE)?.setData(EMPTY);
}

export const __internals = {
  decorated,
  focus: () => focusId,
  size: () => byId.size,
  cut: () => lastCut,
  memoKey: () => memoKey,
};
