/**
 * flood.js — NWS flood alerts, painted on the globe FOR ONE STORM. SPEC §56.5.
 *
 * ==> THIS IS THE FIRST DRAWN THING IN §48, AND IT REOPENS A CLOSED QUESTION
 * ON NEW EVIDENCE. <== §48.1 says flatly that rainfall has no map layer and
 * that this is a decision rather than a gap, because **NHC publishes no
 * rainfall geometry** — checked against their own GIS index, where every other
 * hazard has a product and rainfall has none. That is still true and nothing
 * here contradicts it. What changed is that a flood warning is a DIFFERENT
 * PRODUCT from a DIFFERENT AGENCY: NWS issues it for a polygon a forecaster
 * drew, and that polygon travels in the alert.
 *
 * ==> THE NATIONAL DRAW IS GONE, AND THIS IS WHAT REPLACED IT. <== Until Phase
 * 5 this layer painted every flood alert in the country from a toggle sitting
 * in the `Storm detail` group — a layer contradicting its own manifest entry,
 * which is the first of the three faults §56.1 opened this rebuild over. It
 * now draws the alerts inside the SELECTED storm's corridor and nothing else,
 * which is the question the group it lives in actually asks.
 *
 * ==> AND THAT IS THE ONE RISK THIS PLAN COULD NOT WORD AWAY. <== Green shapes
 * drawn only inside one storm's corridor say *this storm did this*, in
 * pictures, where there is no sentence to hedge with — and an NWS flood alert
 * names no storm (§48.21, §50.3). The mitigation is that the layer draws only
 * while that storm is SELECTED, so the drawer's careful wording is on screen
 * at the same moment as the shapes. **Aaron made this call knowingly on
 * 2026-08-22.** It is written down so a later session finds the decision
 * rather than the smell.
 *
 * ==> WITH NO STORM SELECTED THE LAYER DRAWS NOTHING AND THE STATUS ROW SAYS
 * WHY. <== A toggle that appears to do nothing is its own bug. `clear()` here
 * empties both sources; `app/layer-status.js` prints the sentence. Neither
 * half is optional — an empty globe under a switch the reader just turned on
 * is §5's silence.
 *
 * ==> TWO SOURCES, AND MAPLIBRE'S CLUSTERING IS WHY. <== It clusters `Point`
 * geometry only, so the icons cannot ride the polygon source. Both are built
 * by ONE function over ONE list (`lib/flood-features.js`), because a shape
 * source and a point source fed from two places is the split that drifts.
 *
 * ==> CLUSTERING REPLACES COLLISION, AND §56.2 IS WHY IT HAD TO. <== Measured
 * in chromium on a 390x700 phone with `icon-allow-overlap: false`, MapLibre's
 * own collision drew 7 icons for 25 alerts at z3 — and 11 for the 14 on screen
 * sitting right on top of the cluster at z7. It does not resolve by zooming
 * in. Three warnings with no icon and nothing saying so is §5's silence with a
 * map over it. A cluster never drops anything: two alerts that cannot both be
 * drawn become one chip reading "2".
 *
 * ==> THE POLYGONS ARE ZOOM-GATED AND THE CHIPS ARE NOT. <== §56.2's pixel
 * table: the median polygon is 6.1 px at z5 and 12.3 at z6. Below `FLOOD
 * .polygonMinZoom` a county warning is a speck that reads as dirt on the
 * screen, so the chips carry the layer at distance and the shapes arrive as
 * the reader comes down. Each does the job the other cannot.
 *
 * ==> ONLY WHAT IS IN FORCE PAINTS. <== `inForce()` filters by each row's own
 * expiry at RENDER, not only at fetch. The captured Hilo warning ran 52
 * minutes; a payload held even three minutes can contain one that has run out,
 * and an expired warning drawn on a map tells somebody they are in danger when
 * they are not. Same reason nothing here or in the relay keeps a last-good
 * copy.
 *
 * ==> GREEN, BECAUSE EVERY OTHER HUE ON THIS GLOBE IS SPOKEN FOR. <== Saffir-
 * Simpson owns the dots and NHC's watch/warning palette owns the coast, and
 * both are fixed and unthemeable (§4.7). NWS draws flood warnings green on its
 * own maps, so this agrees with the agency rather than minting a third
 * vocabulary. See `FLOOD_COLOR` in config/tokens.js.
 *
 * Imports: config/, lib/, and map/ siblings. No DOM beyond the map and the one
 * canvas the chip is drawn on.
 */

/* `STORM_GEO` and not `Z`: the outline's WIDTH is drawn geometry, which is what
 * that table holds — `Z` is the stacking order. Reading `Z.floodLineWidth`
 * resolved to `undefined`, MapLibre rejected the whole layer at addLayer time
 * with `number expected, undefined found`, and the polygons never drew. Caught
 * by `tools/boot-smoke.mjs`, which is the only gate in this repo that watches
 * the map's own error channel. */
import { FLOOD } from '../../config/constants.js';
import {
  DARK,
  FLOOD_COLOR,
  FLOOD_COLOR_LIGHT,
  FLOOD_GEO,
  LIGHT,
  OPACITY,
  STORM_GEO,
} from '../../config/tokens.js';
import { isLight } from '../../config/theme.js';
import { alertsNearTrack, trackChains, trackSamples } from '../../lib/flood.js';
import { floodSources } from '../../lib/flood-features.js';
import { chipName, ensureChipImages } from './flood-chip.js';
import { registerLayer } from './registry.js';

const SHAPE_SOURCE = 'flood-alerts';
const POINT_SOURCE = 'flood-alert-points';

const FILL = 'flood-alert-fill';
const LINE = 'flood-alert-line';
const CHIP = 'flood-alert-chip';

export const FLOOD_LAYER_IDS = Object.freeze([FILL, LINE, CHIP]);

/** What a tap is tested against. The chip is on top and is the thing a finger
 *  is aiming at, so it is FIRST — the same "what is drawn on top is tested
 *  first" rule `main.js`'s click dispatcher follows between storms and genesis
 *  areas. The fill is second so a tap on a big polygon at z8, nowhere near its
 *  chip, still opens the alert. */
export const FLOOD_HIT_LAYERS = Object.freeze([CHIP, FILL]);

/** What the CURSOR is bound to, and it is deliberately not the same list.
 *
 *  ==> MAPLIBRE RUNS A DELEGATED HOVER LISTENER ON EVERY MOUSEMOVE, ONCE PER
 *  BOUND LAYER. <== The fill is county-sized shapes — on a real flood day some
 *  of them resolved forecast zones of two thousand vertices — and querying
 *  that on every mousemove taxes every drag of the globe to change a cursor.
 *  The chip is what a pointer is aiming at; the fill stays in the CLICK test
 *  above, which runs once per tap. */
export const FLOOD_HOVER_LAYERS = Object.freeze([CHIP]);

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

/** Held so a theme change, a visibility flip, a new selection or a fresh alert
 *  list can re-derive the features without asking the relay again. The alert
 *  list is small and already in memory. */
let lastAlerts = [];
let lastNow = 0;
/** The selected storm's geometry bundle, held raw. The track samples are
 *  derived from it on demand — see `update`. */
let lastBundle = null;
let lastSamples = null;
let visible = false;

/* ---------------------------------------------------------------------------
 * PAINT
 * ------------------------------------------------------------------------- */

/**
 * The two-colour paint expression for the current theme.
 *
 * ==> THE COLOUR IS A PAINT EXPRESSION HERE, NOT BAKED INTO THE FEATURES, AND
 * THAT DEPARTS FROM `genesis` ON PURPOSE. <== That layer bakes its hues in and
 * re-pushes its whole feature set on a theme change. `main.js` lists three such
 * re-pushes and says in as many words that three is the ceiling and **a fourth
 * is the signal to build the real repaint path rather than to add a line
 * there.** This layer is that fourth, so it takes the other road: it has
 * exactly TWO colours, so a theme change is `setPaintProperty` twice rather
 * than a rebuild of every polygon.
 *
 * ==> IT IS SAFE FROM THE RULE-1b TRAP, AND THE REASON IS THAT THERE IS NO
 * `global-state` IN IT. <== `map/theme-state.js` records that a paint property
 * holding BOTH a `global-state` reference and a feature read resolves to black
 * rather than throwing. This expression reads one feature property and
 * substitutes two literal hex strings resolved in JavaScript before the
 * expression is built — no state reference anywhere in it.
 */
const colorExpr = () => {
  const P = isLight() ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
  /* A warning is a thing happening; a watch is a thing that might. Severity
   * cannot separate them — both are `Severe` — so the shade does, exactly as
   * §48.6 makes urgency do it in the list. */
  return ['case', ['get', '_watch'], P.WATCH, P.WARNING];
};

/**
 * The zoom ramp both polygon layers fade in on.
 *
 * ==> A RAMP AND NOT A SWITCH. <== `minzoom` alone pops the whole set on
 * between one frame and the next mid-pinch, which reads as a rendering fault
 * rather than as detail arriving. One zoom level of interpolation is the
 * shortest fade that reads as intentional; §56.2's table is where both ends
 * come from.
 */
const zoomFade = (full) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  FLOOD.polygonMinZoom,
  0,
  FLOOD.polygonSolidZoom,
  full,
];

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

/** Which chip image a feature wants, for the active theme. */
const chipExpr = () => {
  const light = isLight();
  return ['case', isWarningExpr(), chipName(false, light), chipName(true, light)];
};

/**
 * The cluster count's ink, and it is NOT one colour.
 *
 * ==> ONE INK FOR ALL FOUR CHIPS FAILS WCAG AA ON EXACTLY ONE OF THEM, AND
 * THAT ONE IS REACHABLE. <== Computed rather than eyeballed — contrast ratios
 * for the theme's dark ink (#0B1420) and light ink (#F6F6F4) against each of
 * the four chip fills:
 *
 *   dark theme  / warning #3FBF6F   dark 7.83   light 2.18
 *   dark theme  / watch   #2A7A4A   dark 3.51   light 4.87
 *   light theme / warning #1E7A45   dark 3.46   light 4.94
 *   light theme / watch   #14532E   dark 2.03   light 8.41
 *
 * The first draft used the theme's label halo everywhere, which is the dark
 * ink on the dark theme — 3.51 on a watch cluster, under AA's 4.5 for text
 * this size, and a watch-only cluster is an ordinary thing to have on screen.
 * Picking per chip clears 4.5 on all four. §10.
 */
const countInkExpr = () => {
  const light = isLight();
  /* Only the dark theme's BRIGHT warning green wants the dark ink; the other
   * three greens are dark enough that the light ink wins. */
  const onWarning = light ? LIGHT.geo.labelHalo : DARK.geo.labelHalo;
  const onWatch = LIGHT.geo.labelHalo;
  return ['case', isWarningExpr(), onWarning, onWatch];
};

/** The count's halo is the chip it is sitting on, so the glyph edge stays
 *  clean where it crosses the chip's own border. */
const countHaloExpr = () => {
  const C = isLight() ? FLOOD_COLOR_LIGHT : FLOOD_COLOR;
  return ['case', isWarningExpr(), C.WARNING, C.WATCH];
};

/* ---------------------------------------------------------------------------
 * FEATURES
 * ------------------------------------------------------------------------- */

/**
 * The alerts inside the held storm's corridor, as both sources.
 *
 * ==> WITH NO SAMPLES THIS IS EMPTY, AND THAT IS THE NO-SELECTION STATE. <==
 * Not an error and not an all-clear: `clear()` drops the samples when the
 * selection closes, and the status row is what says so in words.
 *
 * ==> THE MATCH IS `lib/flood.js`'s AND NOT A SECOND COPY. <== The drawer
 * words its sentence off `corridorSummary`, which calls the same
 * `alertsNearTrack` this does with the same default radius. Two matchers would
 * be a panel counting four alerts over a globe drawing three, which is the
 * kind of disagreement that costs a reader their trust in both.
 */
/**
 * The last answer, kept against the exact inputs that produced it.
 *
 * ==> A POLL RE-PUSHES AN UNCHANGED BUNDLE AND THAT USED TO REDO EVERYTHING.
 * <== `pipeline.repushSelected()` runs on every poll that touches the selected
 * storm, on a theme change, and on a restyle — and each one called `update`,
 * which re-densified the same track and re-measured the same alerts against
 * it. Measured on real bytes: a watch carrying a resolved zone boundary costs
 * **7.1 ms** in `nearestNm` alone (HIZ023 is 1,970 vertices against 471 track
 * samples), and the 23 zones §56.4 found in force came to **108 ms**. Paying
 * that again for an answer that cannot have changed is the whole of this memo.
 *
 * ==> KEYED ON THE BUNDLE, NOT ON THE SAMPLES DERIVED FROM IT. <== The first
 * cut keyed on `lastSamples` and never hit once: densifying produces a NEW
 * array every call, so the identity test failed against the copy it had just
 * made and a re-push still cost the full 102 ms. The bundle and the alert list
 * are the things this module is HANDED — a new poll or a new fetch produces
 * new objects and an unchanged one does not — so they are the honest key, and
 * `===` on them is exactly right where a deep compare would cost more than the
 * work it saves.
 *
 * `lastNow` is in the key too, because expiry is filtered at render and an
 * answer is only good for the moment it was asked for.
 */
let memo = null;

function buildSources() {
  if (memo && memo.bundle === lastBundle && memo.alerts === lastAlerts && memo.now === lastNow) {
    return memo.value;
  }
  const value = computeSources();
  memo = { bundle: lastBundle, alerts: lastAlerts, now: lastNow, value };
  return value;
}

function computeSources() {
  /* Derived here rather than in `update`, and cached on the bundle so a second
   * push for the same storm does not densify the same track twice. */
  if (!lastSamples && lastBundle) lastSamples = samplesFor(lastBundle);

  if (!lastSamples?.length) {
    return { shapes: EMPTY, points: EMPTY, report: { selected: false } };
  }

  const hit = alertsNearTrack(lastAlerts, lastSamples);
  if (hit.state !== 'ok') {
    return {
      shapes: EMPTY,
      points: EMPTY,
      report: { selected: true, state: hit.state, unplaceable: hit.unplaceable || 0 },
    };
  }

  const built = floodSources(hit.alerts, lastNow);
  return {
    shapes: built.shapes,
    points: built.points,
    report: {
      selected: true,
      state: 'ok',
      matched: built.live,
      drawn: built.drawn,
      iconless: built.iconless,
      unplaceable: hit.unplaceable || 0,
    },
  };
}

/**
 * Where the layer status row gets its facts.
 *
 * ==> THE ROW DESCRIBES THE LAYER, SO THE LAYER IS WHAT TELLS IT. <== The same
 * shape `map/imagery.js` uses for the imagery row, and for the same reason: a
 * row composed anywhere else is a second answer to "what is on the globe",
 * derived from the same inputs by different code and free to disagree with the
 * paint. Before Phase 5 the row was built from the NATIONAL slot, which was
 * honest while the layer drew the nation; a per-storm layer makes that a
 * sentence about a different set than the one on screen.
 *
 * Set once by main.js. Anything else clears it.
 */
let reporter = null;

export function setFloodReporter(fn) {
  reporter = typeof fn === 'function' ? fn : null;
}

/**
 * Push both sources, and tell the row what went on them. ONE function, so a
 * path that repaints without reporting cannot exist.
 *
 * ==> IT DOES NOTHING AT ALL WHEN THE LAYER IS INVISIBLE, AND THAT IS THE
 * WHOLE OF THE FIX. <== This layer is **off by default**. Until 2026-08-23 the
 * engine still called `update` on it for every definition on every
 * `setBundle`, so a reader who had never turned the switch on was paying the
 * full corridor match — densify the track, measure every national alert
 * against it, compute an interior point for each match — on every storm
 * switch and every poll, for a layer that draws nothing. Aaron felt it as the
 * drawers going slow between storms.
 *
 * ==> WHICH MEANS `setVisible` HAS TO PUSH, AND FORGETTING THAT IS THE OBVIOUS
 * WAY TO BREAK THIS. <== Turning the switch on has to pay the cost that was
 * skipped, or the layer comes up empty and stays empty until the next poll.
 */
function push(map) {
  if (!visible) return;
  const built = buildSources();
  map.getSource?.(SHAPE_SOURCE)?.setData(built.shapes);
  map.getSource?.(POINT_SOURCE)?.setData(built.points);
  reporter?.(built.report);
}

/** The track samples for a storm's bundle, or null when it has no line at all.
 *
 *  BOTH HALVES, AND A STORM WITH ONLY ONE STILL GETS AN ANSWER — a newly named
 *  system has no past track worth the name and an ended one has no forecast.
 *  These are the same FeatureCollections `map/layers/track-past.js` and its
 *  forecast sibling draw, so the shapes the reader can SEE are the shapes the
 *  alerts are measured against. */
function samplesFor(bundle) {
  const layers = bundle?.layers;
  if (!layers) return null;
  const chains = trackChains(layers.pastTrack?.fc || null, layers.forecastTrack?.fc || null);
  const s = trackSamples(chains);
  return s?.length ? s : null;
}

registerLayer({
  key: 'floodAlerts',
  type: 'additive',
  /* ==> ABOVE GENESIS, BELOW THE SELECTION STACK. <== A flood warning is a
   * thing that IS happening, so it outranks a watched area that might become a
   * storm. It sits under the cone and the track because those are the storm
   * itself and this is ground truth beneath it — and because a translucent
   * green wash over a track would make the track harder to read, which is the
   * one line on this globe that must stay legible. */
  order: 5,

  ensure(map, beforeId) {
    if (map.getSource(SHAPE_SOURCE)) return;

    ensureChipImages(map);

    map.addSource(SHAPE_SOURCE, { type: 'geojson', data: EMPTY });

    /* ==> CLUSTERING IS A SOURCE OPTION, WHICH IS WHY THIS CANNOT SHARE THE
     * ONE ABOVE. <== And `clusterProperties` is how a cluster knows what is
     * inside it: MapLibre drops every feature property on merge unless it is
     * told to accumulate one. `warnings` counts the non-watches, so the chip
     * expression can ask whether the pile holds anything happening now. */
    map.addSource(POINT_SOURCE, {
      type: 'geojson',
      data: EMPTY,
      cluster: true,
      clusterRadius: FLOOD.clusterRadiusPx,
      clusterMaxZoom: FLOOD.clusterMaxZoom,
      clusterProperties: {
        warnings: ['+', ['case', ['get', '_watch'], 0, 1]],
      },
    });

    map.addLayer(
      {
        id: FILL,
        type: 'fill',
        source: SHAPE_SOURCE,
        minzoom: FLOOD.polygonMinZoom,
        paint: {
          'fill-color': colorExpr(),
          /* WEAK ON PURPOSE. These polygons sit over land, and land is where
           * the coastline, the place labels and the storm's own track all live.
           * A flood warning has to be visible without making the geography
           * under it unreadable — the reader still needs to know WHICH county. */
          'fill-opacity': zoomFade(OPACITY.floodFill),
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: LINE,
        type: 'line',
        source: SHAPE_SOURCE,
        minzoom: FLOOD.polygonMinZoom,
        paint: {
          'line-color': colorExpr(),
          'line-width': STORM_GEO.floodLineWidth,
          'line-opacity': zoomFade(OPACITY.floodLine),
        },
      },
      beforeId
    );

    map.addLayer(
      {
        id: CHIP,
        type: 'symbol',
        source: POINT_SOURCE,
        layout: {
          'icon-image': chipExpr(),
          /* ==> OVERLAP ALLOWED, AND THIS IS THE LINE §56.2 BOUGHT. <== With
           * collision on, MapLibre silently drops the icons it cannot place —
           * measured at 11 of 14 with the reader sitting right on top of the
           * cluster. Clustering has already merged everything that is genuinely
           * too close to tap apart, so anything still on screen is a distinct
           * place and must draw. */
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': [
            'case',
            ['has', 'point_count'],
            ['get', 'point_count_abbreviated'],
            '',
          ],
          'text-font': ['Noto Sans Bold'],
          'text-size': FLOOD_GEO.countSize,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          /* Per-chip, and `countInkExpr` has the measured reason. */
          'text-color': countInkExpr(),
          'text-halo-color': countHaloExpr(),
          'text-halo-width': FLOOD_GEO.countHaloWidth,
        },
      },
      beforeId
    );

    /* The switch may already be on when the style reloads — a theme change
     * tears every layer down and rebuilds it, and a layer that came back
     * visible-by-default would flash on for a reader who had turned it off. */
    for (const id of FLOOD_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }

    /* A restyle rebuilds the sources empty. Anything already held — the alert
     * list AND the selected storm's samples — has to go back on immediately,
     * or the layer is blank until the next poll for a reader who never touched
     * anything. */
    push(map);
  },

  /**
   * A storm was selected, or its geometry arrived. THIS IS WHAT MAKES THE
   * LAYER PER-STORM.
   *
   * ==> IT USED TO BE A DELIBERATE NO-OP AND THE COMMENT SAYING SO WAS RIGHT
   * AT THE TIME. <== While the layer drew the whole country, a flood warning
   * was not owned by a storm and there was nothing for a selection to change.
   * §56.5 made the selection the layer's whole subject, so both hooks are real
   * now and `clear` is the no-selection state rather than an empty stub.
   */
  update(map, storm, bundle) {
    /* ==> THE SAMPLES ARE DERIVED LAZILY, NOT HERE. <== `samplesFor` densifies
     * the whole past-and-forecast track, and this hook fires for every
     * definition on every `setBundle` whether or not this layer is on. Holding
     * the BUNDLE and letting `push` decide costs nothing for the reader who
     * never turns the switch on, which is the default. */
    /* ==> ONLY DROP THE SAMPLES WHEN THE BUNDLE ACTUALLY MOVED. <== A poll
     * that re-pushes the same object must reuse the densified track, or the
     * memo below is keyed on something this line just invalidated. */
    if (bundle !== lastBundle) {
      lastBundle = bundle;
      lastSamples = null;
    }
    push(map);
  },

  /** Selection closed: draw nothing. The status row says why (§56.5) — an
   *  empty globe under a switch the reader turned on is §5's silence, and the
   *  words are the half of this that cannot live in a layer. */
  clear(map) {
    lastBundle = null;
    lastSamples = null;
    push(map);
  },

  /* NO `updateAmbient`, AND IT IS LOAD-BEARING. The engine's ambient merge
   * collects features from every warmed storm BUNDLE under this key. No bundle
   * has a `floodAlerts` slot, so implementing it would hand this layer an empty
   * array every time any storm's geometry arrived and blank the map. Data comes
   * in through `setFloodAlerts` and `update` instead.
   *
   * ==> AND AMBIENT WOULD BE WRONG EVEN IF IT WORKED. <== §56.5 draws for the
   * SELECTED storm only, precisely so the drawer's wording about attribution is
   * on screen beside the shapes. Painting warmed storms' corridors too would
   * put unattributed green over half the map with no panel open. */

  setVisible(map, on) {
    const was = visible;
    visible = !!on;
    for (const id of FLOOD_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
    /* ==> TURNING IT ON PAYS THE COST `push` HAS BEEN SKIPPING. <== Without
     * this the layer comes up empty and stays empty until the next poll
     * happens to re-push a bundle, which reads as a switch that does nothing. */
    if (visible && !was) push(map);
  },
});

/**
 * Push the current national alert list. The layer filters it to the selected
 * storm's corridor itself.
 *
 * ==> AN EMPTY ARRAY DRAWS NOTHING, AND THAT IS HONEST FOR EXACTLY ONE OF THE
 * THREE STATES. <== `ok` with nothing in force is an empty globe and true —
 * most hours no weather office in the country has a flood product out.
 * `unavailable` is ALSO an empty globe and is NOT honest on its own: there is
 * no such thing as drawing an outage. Never call this with `[]` to stand for a
 * failure without the words going up in the layer status row too.
 */
export function setFloodAlerts(map, alerts, { now = Date.now() } = {}) {
  lastAlerts = Array.isArray(alerts) ? alerts : [];
  lastNow = now;
  push(map);
}

/**
 * What the reader tapped, or null.
 *
 * @returns {{cluster:true, clusterId:number, lon:number, lat:number} |
 *           {cluster:false, id:string} | null}
 *
 * ==> A 44 px BOX, NOT A POINT, AND IT IS THE SAME BOX `stormAtPoint` BUILDS.
 * <== §10. A fingertip is not a pixel, and a chip drawn at 20 px that can only
 * be hit dead centre is a control that works with a mouse and fails with a
 * thumb.
 */
export function floodAlertAtPoint(map, point) {
  const r = FLOOD.tapBoxPx / 2;
  const box = [
    [point.x - r, point.y - r],
    [point.x + r, point.y + r],
  ];
  const layers = FLOOD_HIT_LAYERS.filter((id) => map.getLayer?.(id));
  if (!layers.length) return null;

  const hits = map.queryRenderedFeatures(box, { layers }) || [];
  for (const h of hits) {
    const p = h.properties || {};
    /* A cluster answers with its own id and its position, because splitting it
     * needs both: `getClusterExpansionZoom` takes the id and the camera has to
     * be told where to go. */
    if (p.cluster) {
      return {
        cluster: true,
        clusterId: p.cluster_id,
        lon: h.geometry?.coordinates?.[0],
        lat: h.geometry?.coordinates?.[1],
      };
    }
    if (p._id) return { cluster: false, id: p._id };
  }
  return null;
}

/**
 * Recolour after a theme change. PAINT AND LAYOUT WRITES, NOT A FEATURE
 * REBUILD.
 *
 * See `colorExpr` for why this layer does not join `main.js`'s re-push list —
 * that list is explicitly capped at three, and this is what the cap was telling
 * the next layer to do instead. The chip swaps by NAME: all four images are
 * already uploaded, so this is a layout write and never a texture upload on the
 * frame the reader is looking at.
 */
export function rethemeFlood(map) {
  const expr = colorExpr();
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-color', expr);
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-color', expr);
  if (map.getLayer(CHIP)) {
    map.setLayoutProperty(CHIP, 'icon-image', chipExpr());
    map.setPaintProperty(CHIP, 'text-color', countInkExpr());
    map.setPaintProperty(CHIP, 'text-halo-color', countHaloExpr());
  }
}

/**
 * Zoom in until a tapped cluster comes apart. §56.6.
 *
 * ==> MAPLIBRE'S OWN EXPANSION ZOOM, NOT A GUESS AT ONE. <== The source knows
 * the exact zoom at which this particular pile splits, because it built the
 * pile. Adding a fixed number of zoom levels instead would overshoot a sparse
 * cluster and undershoot the Wabash valley — where §56.2 measured fifteen of
 * twenty-five alerts sitting in one line.
 *
 * ==> IT RESOLVES A PROMISE, AND THAT IS NOT A DETAIL. <== In MapLibre 5 the
 * answer comes back from the source's WORKER, so this is async. A synchronous
 * read here returns a Promise object, `easeTo` is handed `[object Promise]`
 * for a zoom, and the camera does nothing at all — silently.
 *
 * The camera moves to the cluster's own position rather than to the tap, so
 * two taps in a row walk down into the same pile instead of drifting.
 */
export function splitFloodCluster(map, hit) {
  const src = map.getSource?.(POINT_SOURCE);
  if (!src?.getClusterExpansionZoom || !hit || !Number.isFinite(hit.lon)) return;

  Promise.resolve(src.getClusterExpansionZoom(hit.clusterId))
    .then((zoom) => {
      if (!Number.isFinite(zoom)) return;
      map.easeTo({ center: [hit.lon, hit.lat], zoom });
    })
    /* ==> A FAILED SPLIT COSTS THE ZOOM AND NOTHING ELSE. <== The worker can
     * answer late, or not at all if a restyle replaced the source between the
     * tap and the reply. Swallowing it leaves the reader where they were,
     * which is recoverable by tapping again; letting it reject would put an
     * unhandled rejection in the console of a hazard app for a camera move. */
    .catch(() => {});
}
