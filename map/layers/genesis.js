/**
 * genesis.js — the areas being watched, on the globe. ADDITIVE, default ON.
 * SPEC §45.4.
 *
 * ==> THE ONE RULE THIS FILE EXISTS TO KEEP: A GENESIS AREA IS SEPARATED FROM
 *     A STORM BY SHAPE, NOT BY COLOUR. <==
 *
 * The entire legibility of this globe rests on one equation the user learns in
 * the first five seconds — a coloured blob is a real cyclone. §45.7 names the
 * risk plainly: this layer puts a NEW CLASS OF OBJECT on that globe, and the
 * failure mode is not that the hue is wrong, it is that a hatched patch reads
 * as a storm-shaped thing and undoes the clearest signal the app has.
 *
 * So: a genesis area is an AREA with a soft dashed edge and NOTHING THAT LIVES
 * AT A POINT. No centroid dot. No glyph. No cage at the planet band
 * (`GENESIS.planetBandCage` is `false` and says so out loud rather than being
 * an omission somebody later "fixes"). The percentage rides as haloed TEXT,
 * which can never be mistaken for a blob. If a future pass adds a marker here,
 * it has removed the layer's one safety property.
 *
 * DRAW ORDER: `order: 0`, below the cone's 10 and below everything else. A
 * watched area never occludes a real storm and never competes with one. main.js
 * must hit-test the storm layers BEFORE `GENESIS_LAYER_IDS` for the same
 * reason — a patch under a cone must not steal the tap.
 *
 * ==> WHY THE COLOURS ARE BAKED INTO THE FEATURES INSTEAD OF READ FROM GLOBAL
 *     STATE. <==
 * This is not a style choice, it is rule 1b in map/theme-state.js: MapLibre
 * evaluates any paint property containing a feature read (`['get', …]`) in the
 * WORKER, and the worker is never sent the global state. A property holding
 * both a `global-state` ref and a `['get']` does not throw — it resolves to
 * BLACK, in both themes, forever. Genesis is inherently per-feature (three risk
 * levels on one source), so every colour here is resolved by `genesisColor()`
 * at PUSH time and travels on the feature, exactly as the model tracks do. It
 * rethemes by re-pushing, which is free because the areas are already in
 * memory. `tools/test-theme-state.mjs` fails the build on the other approach.
 *
 * THAT MAKES THREE EXCEPTIONS IN app/theme-switch.js, WHICH IS THE CEILING IT
 * SET FOR ITSELF ("if it ever grows past three, the mechanism is wrong"). This
 * is the third and it is the same mechanism as the second, not a new one — a
 * per-feature colour, re-pushed. A FOURTH should not be added; it should be the
 * trigger for building the real repaint path that file keeps deferring.
 *
 * Imports config/ and lib/. Never data/, never ui/.
 */

import { GENESIS } from '../../config/constants.js';
/* The two colour TABLES come in alongside the geometry, not the resolver.
 * `ensureHatchImages` builds BOTH themes' tiles in one pass, and
 * `genesisColor()` deliberately resolves only the live theme — so this is the
 * one file that reads the tables directly. */
import {
  GENESIS_GEO,
  GENESIS_COLOR as DARK_HATCH,
  GENESIS_COLOR_LIGHT as LIGHT_HATCH,
} from '../../config/tokens.js';
import { palette, isLight } from '../../config/theme.js';
import { genesisColor, formatPercent, normalizeRisk } from '../../lib/genesis.js';
import { registerLayer } from './registry.js';

const AREA_SOURCE = 'genesis-areas';
const LABEL_SOURCE = 'genesis-labels';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** Every layer id this definition owns, listed once so `setVisible` cannot
 *  miss one and leave an outline drawn over a hidden fill.
 *
 *  ALSO THE HIT-TEST LIST. main.js queries these for tap and click, AFTER the
 *  storm layers. Exported rather than retyped there — two copies of a layer-id
 *  list is how a layer silently stops being clickable. */
export const GENESIS_LAYER_IDS = Object.freeze([
  'genesis-fill',
  'genesis-hatch',
  'genesis-line',
  'genesis-label',
]);

/** The one layer a pointer may pick. The hatch and the outline sit on top of
 *  the fill and would each return the same feature. */
export const GENESIS_HIT_LAYER = 'genesis-fill';

/* Seeded TRUE because this layer ships on. A false seed would blank the
 * patches for the frames between style load and the first `applyLayerState` —
 * and on a day with no storms that is the whole screen going empty and then
 * un-empty, which reads as a bug. Same reasoning as cone.js. */
let visible = true;

/** Last pushed areas and selection, held so a theme change can re-derive the
 *  features without asking main.js to refetch anything. */
let lastAreas = [];
let lastSelectedId = null;

/* ---------------------------------------------------------------------------
 * THE HATCH
 *
 * Six tiny images: three risk levels times two themes, pre-added under stable
 * names, and each feature names the one it wants in `_hatch`. Pre-adding both
 * themes means a theme flip is a data re-push and never an image swap — an
 * `addImage` during a repaint is a texture upload on the frame the user is
 * looking at.
 *
 * DENSITY IS THE SECOND CHANNEL THE RISK RAMP RIDES ON. Tighter means more
 * likely (`GENESIS_GEO.hatchGap`). The colour ramp alone is three steps of one
 * low-chroma hue, which is a hard read on a phone in daylight; density alone is
 * the dimension the eye is worst at. Together the ramp survives a bad screen
 * and colour-blindness. Do not "simplify" this by dropping one.
 *
 * A PATTERN, NOT A SOLID FILL, BECAUSE THE BOUNDARY IS GENUINELY FUZZY. NHC
 * publishes a region of potential development, not an edge. A hard fill claims
 * a precision the product does not have — the same argument the dashed outline
 * makes at the border.
 * ------------------------------------------------------------------------- */

const RISKS = ['LOW', 'MEDIUM', 'HIGH'];
const hatchName = (risk, light) => `genesis-hatch-${risk}-${light ? 'light' : 'dark'}`;

/**
 * A seamless 45° hatch tile.
 *
 * Rendered at 2x and handed over with `pixelRatio: 2` so the line is a crisp
 * hairline on a phone rather than a soft grey smear — a 1px line drawn at 1x
 * and stretched is the most common way a hatch ends up looking like haze.
 *
 * THREE STROKES, NOT ONE. A single corner-to-corner diagonal leaves the two
 * opposite corners bare, and the seam shows as a visible grid of dots once the
 * tile repeats across an ocean-sized polygon. The two short corner segments are
 * the wrap.
 */
function hatchImage(gap, color, width, opacity) {
  /* ==> NO DOM, NO HATCH, AND THAT IS A DEGRADE RATHER THAN A FAILURE. <==
   *
   * The headless suites drive the layer engine with a stub map and no
   * `document` at all (`tools/test-app-layer-state.mjs` attaches it directly),
   * and this threw on the first `ensure`, taking the WHOLE layer engine down
   * with it — every storm layer, not just this one. Caught 2026-08-09 before
   * glass.
   *
   * Returning null here costs the hatch and nothing else: the flat fill and
   * the dashed outline are ordinary paint properties and still draw, so a
   * watched area is still a soft patch with a soft edge. The risk ramp loses
   * its second channel and keeps its first. That is the right trade for a
   * texture upload that cannot happen — an area that vanishes because a canvas
   * was unavailable would be the §5 failure this layer exists to prevent. */
  if (typeof document === 'undefined' || !document.createElement) return null;

  const scale = 2;
  const n = Math.max(2, Math.round(gap * scale));
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, n, n);
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = width * scale;
  ctx.lineCap = 'square';

  ctx.beginPath();
  ctx.moveTo(0, n);
  ctx.lineTo(n, 0);
  ctx.moveTo(-1, 1);
  ctx.lineTo(1, -1);
  ctx.moveTo(n - 1, n + 1);
  ctx.lineTo(n + 1, n - 1);
  ctx.stroke();

  return { data: ctx.getImageData(0, 0, n, n), pixelRatio: scale };
}

/** Add all six tiles if they are not already there. Idempotent: `ensure` may
 *  run more than once and `hasImage` is the cheap guard. */
function ensureHatchImages(map) {
  for (const light of [false, true]) {
    for (const risk of RISKS) {
      const name = hatchName(risk, light);
      if (map.hasImage?.(name)) continue;
      const color = light ? LIGHT_HATCH[risk] : DARK_HATCH[risk];
      const img = hatchImage(
        GENESIS_GEO.hatchGap[risk],
        color,
        GENESIS_GEO.hatchWidth,
        GENESIS_GEO.hatchOpacity
      );
      if (img) map.addImage(name, img.data, { pixelRatio: img.pixelRatio });
    }
  }
}

/* ---------------------------------------------------------------------------
 * FEATURES
 * ------------------------------------------------------------------------- */

function areaFeatures(areas, selectedId) {
  const light = isLight();
  return areas.map((a) => {
    const risk = normalizeRisk(a.globeRisk);
    const selected = a.id === selectedId;
    return {
      type: 'Feature',
      geometry: a.geometry,
      properties: {
        _id: a.id,
        _risk: risk,
        _color: genesisColor(risk),
        _hatch: hatchName(risk, light),
        _fillOpacity: selected
          ? GENESIS_GEO.fillOpacity[risk] * GENESIS_GEO.selectedFillMultiplier
          : GENESIS_GEO.fillOpacity[risk],
        _lineWidth: selected ? GENESIS_GEO.selectedLineWidth : GENESIS_GEO.lineWidth,
        _lineOpacity: selected ? GENESIS_GEO.selectedLineOpacity : GENESIS_GEO.lineOpacity,
      },
    };
  });
}

/**
 * The label points.
 *
 * DRAWN AT OUR OWN CENTROID, NOT AT NHC'S PUBLISHED LABEL ANCHOR. That was
 * the plan until real bytes showed layer 2 carries a point for only SOME areas
 * and cannot be reliably matched to the polygons — see `normalizeNhcAreas` in
 * lib/genesis.js. The number now comes off the same feature as the shape it
 * sits on, which is the property that actually matters.
 *
 * ==> THE SEVEN-DAY NUMBER, AND ONLY THE SEVEN-DAY NUMBER. <== The polygon IS
 * the seven-day area; the two-day probability has no geometry of its own. A
 * two-day figure printed on a shape drawn for the seven-day is a lie of the
 * exact class §5 forbids, and printing both gives "0% / 40%" floating over an
 * ocean — unreadable at a glance and still half wrong. Aaron's call,
 * 2026-08-09. The two-day number is not discarded; it gets a labelled line in
 * the drawer, where there is room to say which horizon it belongs to.
 *
 * AN AREA WITH NO PUBLISHED PROBABILITY GETS NO LABEL, not a "0%" and not a
 * dash. Null is "the source did not say" and is a different fact from zero.
 */
function labelFeatures(areas) {
  const P = palette();
  const out = [];
  for (const a of areas) {
    if (a.globeProb == null) continue;
    const at = a.centroid;
    if (!at) continue;
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [at.lon, at.lat] },
      properties: {
        _label: formatPercent(a.globeProb),
        _color: genesisColor(a.globeRisk),
        _halo: P.ocean,
      },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

/* ---------------------------------------------------------------------------
 * THE LAYER
 * ------------------------------------------------------------------------- */

registerLayer({
  key: 'genesis',
  type: 'additive',
  /* BELOW EVERYTHING. The cone is 10 and is described as "bottom of the
   * selection stack"; this is below the selection stack entirely, because a
   * maybe must never draw over a certainty. */
  order: 0,

  ensure(map, beforeId) {
    if (map.getSource(AREA_SOURCE)) return;
    ensureHatchImages(map);

    map.addSource(AREA_SOURCE, { type: 'geojson', data: EMPTY });
    map.addSource(LABEL_SOURCE, { type: 'geojson', data: EMPTY });

    /* The flat wash under the hatch. Weak on purpose at the low end — a Low
     * area is a maybe and must not hold the eye against a real storm
     * anywhere else on the same globe. */
    map.addLayer(
      {
        id: 'genesis-fill',
        type: 'fill',
        source: AREA_SOURCE,
        paint: {
          'fill-color': ['get', '_color'],
          'fill-opacity': ['get', '_fillOpacity'],
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: 'genesis-hatch',
        type: 'fill',
        source: AREA_SOURCE,
        paint: { 'fill-pattern': ['get', '_hatch'] },
      },
      beforeId
    );

    map.addLayer(
      {
        id: 'genesis-line',
        type: 'line',
        source: AREA_SOURCE,
        paint: {
          'line-color': ['get', '_color'],
          'line-opacity': ['get', '_lineOpacity'],
          'line-width': ['get', '_lineWidth'],
          /* DASHED, ALWAYS. The boundary of a development region is genuinely
           * fuzzy; a solid outline would claim a precision NHC never
           * published. The selected dash is longer rather than solid for the
           * same reason — selection must not read as certainty. */
          'line-dasharray': GENESIS_GEO.lineDash,
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: 'genesis-label',
        type: 'symbol',
        source: LABEL_SOURCE,
        /* Below this zoom the patch alone carries the layer. At planet
         * distance a scatter of percentages over the oceans is noise, and the
         * areas are large enough to read as shapes without them. */
        minzoom: GENESIS.labelMinZoom,
        layout: {
          'text-field': ['get', '_label'],
          'text-size': GENESIS_GEO.labelSize,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': ['get', '_color'],
          'text-halo-color': ['get', '_halo'],
          'text-halo-width': GENESIS_GEO.labelHaloWidth,
        },
      },
      beforeId
    );

    for (const id of GENESIS_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },

  /* NO-OPS, AND DELIBERATELY PRESENT. The engine calls `update` on every
   * definition when a storm is selected and `clear` on every definition when
   * the selection closes. Genesis has no per-storm geometry — an area is not
   * owned by any storm, which is the whole point of it — so both are empty
   * with a reason rather than absent and throwing. */
  update() {},
  clear() {},

  /* NO `updateAmbient` EITHER, AND THAT IS LOAD-BEARING. The engine's ambient
   * merge collects features from every warmed STORM BUNDLE under this
   * definition's key. No bundle has a `genesis` slot, so implementing it would
   * hand this layer an empty array on every recompute and blank the patches
   * every time any storm's geometry arrived. Data comes in through
   * `setGenesisAreas` instead. */

  setVisible(map, on) {
    visible = !!on;
    for (const id of GENESIS_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  },
});

/* ---------------------------------------------------------------------------
 * THE WAY IN
 * ------------------------------------------------------------------------- */

/**
 * Which watched area is under a pointer, or null.
 *
 * RETURNS AN ID, NOT AN OBJECT, mirroring `stormAtPoint` — the caller already
 * holds the authoritative list and looking the id up there means the tap can
 * never act on a stale copy that happened to be baked into a feature.
 *
 * A SMALL BOX RATHER THAN A BARE POINT. The patches are hundreds of miles
 * across so a point query almost always works, but a tap on the very edge of
 * one is a real gesture and a bare point misses it by a pixel. Deliberately
 * NOT the full 44 px target the storm dots use: at that size two adjacent
 * areas would both answer and the nearer edge would win arbitrarily.
 *
 * ONLY THE FILL IS QUERIED. The hatch and the outline sit on the same source
 * and would each return the same feature, which turns one tap into three hits
 * to deduplicate for no gain.
 */
export function genesisAtPoint(map, point) {
  if (!map.getLayer(GENESIS_HIT_LAYER)) return null;
  const pad = 4;
  const box = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];
  const hits = map.queryRenderedFeatures(box, { layers: [GENESIS_HIT_LAYER] });
  for (const h of hits) {
    const id = h.properties?._id;
    if (id) return id;
  }
  return null;
}

/**
 * Push the current watch list onto the globe.
 *
 * Called by main.js from the store subscription — genesis is map-wide state,
 * not per-storm, so it does not travel on a geometry bundle.
 *
 * PASSING AN EMPTY ARRAY DRAWS NOTHING, AND THAT IS CORRECT FOR EXACTLY ONE
 * OF THE THREE §45.5 STATES. `none_matched` — the source answered and
 * published no areas — is an empty globe and an honest one. `unavailable` is
 * ALSO an empty globe and is NOT honest on its own, which is why the drawer
 * and the status strip carry that state in words: there is no such thing as
 * drawing an outage. Never call this with `[]` to represent a failure without
 * the words going up somewhere too.
 */
export function setGenesisAreas(map, areas, { selectedId = null } = {}) {
  lastAreas = Array.isArray(areas) ? areas : [];
  lastSelectedId = selectedId;
  map.getSource(AREA_SOURCE)?.setData({
    type: 'FeatureCollection',
    features: areaFeatures(lastAreas, lastSelectedId),
  });
  map.getSource(LABEL_SOURCE)?.setData(labelFeatures(lastAreas));
}

/** Which area is picked. Selection changes fill and edge weight only — never
 *  the hue, so risk can never be inferred from selection state. */
export function setGenesisSelection(map, selectedId) {
  setGenesisAreas(map, lastAreas, { selectedId });
}

/**
 * Re-push after a theme change. Free — the areas are already in memory.
 *
 * See the header for why a paint property cannot do this. Called from
 * app/theme-switch.js alongside `rethemePopulation` and the guidance re-push.
 */
export function rethemeGenesis(map) {
  setGenesisAreas(map, lastAreas, { selectedId: lastSelectedId });
}
