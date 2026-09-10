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

import { ZOOM, CATEGORY_THRESHOLD_KT } from '../config/constants.js';
import { WIND_KT } from '../lib/wind.js';
import { noCurrentReading } from '../lib/lifecycle.js';
import { SIZE, STORM_GEO } from '../config/tokens.js';
import { gs } from './theme-state.js';
import { byZoom } from './style.js';
import { categoryColor, categoryDotCode } from '../lib/category.js';
import { onNamePlacement, namePlacementFor } from './layers/points-forecast.js';
import { onForecastPointsDrawn, hasForecastPoints } from './layers/drawn-points.js';

const SOURCE_ID = 'storms';
const LAYER_DOT = 'storm-dot-planet';
const LAYER_POSITION = 'storm-dot-position';
const LAYER_POSITION_CODE = 'storm-dot-position-code';
const LAYER_LAST_KNOWN = 'storm-dot-last-known';
const LAYER_LAST_KNOWN_MARK = 'storm-dot-last-known-mark';
const LAYER_NAME = 'storm-name';

/** Forecast point layers, tappable alongside the storm's own position so the
 *  whole track selects its storm. Named here rather than imported to keep the
 *  one-directional rule — map/layers/* must not depend on markers.js. */
const FPOINT_LAYERS = ['sel-fpoints', 'amb-fpoints'];

/** Half the §9 touch minimum: the smallest a hit circle's RADIUS may be. */
const HIT_MIN_PX = parseInt(SIZE.touchTarget, 10) / 2;

/* SIZE RANK FOR A STORM WITH NO CATEGORY INDEX.
 *
 * The dot scales on the category index (0 = TD, 1 = TS, 2..6 = Cat 1..5). A
 * GDACS hurricane legitimately has `category: null` and `categoryCode: 'HU'`
 * — the source's strongest wind band is the Cat 1 floor, so it cannot say
 * WHICH hurricane it is (§4). That null used to fall through to 1, drawing
 * every unclassified typhoon at TROPICAL STORM size: the least severe read
 * available, on the surface the user aims a thumb at.
 *
 * A hurricane draws at the Cat 1 floor instead — the strongest thing GDACS
 * actually asserts, and the same floor rule the wind-band work uses. It is a
 * FLOOR, not a guess at the real strength: an unclassified Cat 4 draws small,
 * which understates it, but every alternative overstates something the source
 * never said (§5). Anything else with no index stays at TS size.
 *
 * DERIVED, not typed: the index comes out of the threshold table by matching
 * the hurricane-force knot value, so editing the table moves this with it. */
const HURRICANE_RANK =
  CATEGORY_THRESHOLD_KT.find((t) => t.min === WIND_KT.KT64)?.category ?? 2;
const NO_CATEGORY_RANK = 1; // TS — the floor for anything not stated a hurricane

/* ---------------------------------------------------------------------------
 * Glyph rendering — RETIRED 2026-07-24.
 *
 * The canvas image machinery (registerGlyphs / makeImage / drawDot / iconFor)
 * lived here solely to feed the MapLibre symbol layer's `icon-image`. That
 * layer is gone — the 3D node mesh owns the spiral now — so the images had no
 * consumer and are deleted rather than left registered and unused.
 *
 * `map/glyph.js` itself STAYS. It is shared, and map/globe3d.js still stamps
 * the same spiral as a Points sprite. Only this engine's copy is retired.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Layers
 * ------------------------------------------------------------------------- */

/* ==> THE NAME'S DEFAULT SPOT: DIRECTLY BELOW THE DOT. <==
 *
 * `text-anchor: 'top'` means the TOP of the text sits on the anchor point, so
 * the text hangs downward. Until 2026-08-13 this was the only spot the name
 * could ever occupy, and on a north-south storm it landed on the forecast
 * line — HERNAN, moving SSW, with the track running through the word. It is
 * now the DEFAULT rather than the rule: `map/layers/name-placement.js` picks
 * a clear side off the drawn geometry and this is what a storm gets before
 * that has run, or when it has no forecast points to be placed against.
 *
 * ==> COMPUTED FROM THE DOT, NOT TYPED. <== `text-offset` is in EMs of this
 * label's own size and is measured from the anchor point, which is the
 * storm's CENTRE — so a literal here silently carries the forecast dot's
 * radius inside it and goes wrong the moment either the dot or the text
 * changes size. The clearance we care about is from the dot's outer EDGE, so
 * it is written as exactly that: radius, plus the stroke that rings it, plus
 * the gap, all divided into ems. name-placement.js computes its own spots
 * from the identical three tokens, so the default and the chosen spots keep
 * the same distance from the dot in every direction.
 *
 * `STORM_GEO.pointRadius` because at this zoom a live storm's position IS its
 * tau-0 forecast point — the same reasoning that made the ended storm's mark
 * read its size off the same token rather than copy it. */
const NAME_ANCHOR_DEFAULT = 'top';
const NAME_OFFSET_DEFAULT = Object.freeze([
  0,
  (STORM_GEO.pointRadius + STORM_GEO.pointStrokeWidth + SIZE.stormLabelGapPx)
    / SIZE.stormLabelPx,
]);

/* ==> THE NAME'S POSITION ARRIVES FROM THE FORECAST LAYER, NOT FROM HERE.
 * <== Which side of its dot a name sits on depends on which way the track is
 * DRAWN on screen, and only the module that projects the forecast points
 * knows that. It publishes; this subscribes. The dependency runs
 * markers -> layers and never back, which is the rule (§12).
 *
 * ==> SUBSCRIBED ONCE, AT MODULE SCOPE, AND THAT IS NOT A STYLE CHOICE. <==
 * `addStormMarkers` runs again on every restyle — a theme change tears the
 * style down and rebuilds every source and layer (main.js `installOnStyle`).
 * Subscribing inside it would leave the previous pass's listener alive with
 * no way to reach it, so a handful of theme switches would end up firing a
 * `setData` on the storm source several times for one camera move. One
 * subscription for the life of the page, pointed at whichever redraw the
 * current pass installed, has no such tail. It is the same reason main.js
 * keeps its own map listeners outside that function.
 *
 * It fires only when a name actually moved, so a pan that changes nothing
 * costs nothing here. */
let redrawStorms = null;
onNamePlacement(() => redrawStorms?.());

/* The second publisher, subscribed here for the same reasons and with the
 * same shape: forecast dots arriving or leaving decides whether a storm needs
 * the stand-in position dot below, and only the module that draws them knows.
 * It fires when the SET changes, not when the camera moves. */
onForecastPointsDrawn(() => redrawStorms?.());

/**
 * The four properties that decide what mark a storm's own position gets.
 *
 * PURE, AND EXPORTED FOR THAT REASON — `hasPoints` is passed in rather than
 * read from the layer module, so the rule can be tested without a map and so
 * this file keeps one answer instead of two.
 *
 * ==> THREE STATES, AND EXACTLY ONE MARK EVER DRAWS. <==
 *
 *   - `lastKnown` — ended, or gone quiet. The grey X. Its own layers below,
 *     and it WINS: a finished storm has no forecast points either, so without
 *     the precedence both marks would stack on the same pixel.
 *   - `noShapes` — live, and nothing was drawn for it. The stand-in dot: a
 *     forecast point with no forecast in it, in the storm's own category
 *     colour, carrying its own code. NHC publishes the advisory before the
 *     shapefiles, so this is the normal state of a brand-new storm for its
 *     first minutes to hours, and it is also where a dead geometry fetch
 *     leaves a storm permanently.
 *   - neither — the tau-0 forecast dot is on screen and IS the position
 *     mark. Nothing extra draws, and the stand-in is written to match that
 *     dot in every channel so the swap is invisible when NHC catches up.
 *
 * ==> THE COLOUR AND CODE ARE COMPUTED FOR EVERY STORM, NOT ONLY THE ONES
 * THAT NEED THEM. <== A conditional would put `null` in a paint property on
 * every other storm, and MapLibre's expression evaluator answers a null
 * colour with a console error and a dropped feature rather than a fallback.
 * `categoryColor` always returns a real colour, including for a system NHC
 * declines to grade, so there is nothing to guard.
 */
export function positionMarkProps(storm, hasPoints) {
  const lastKnown = noCurrentReading(storm);
  return {
    lastKnown,
    noShapes: !lastKnown && !hasPoints,
    _posColor: categoryColor(storm?.category, storm?.nature, storm?.categoryCode),
    /* Empty string, never null: `text-field` takes a string, and a storm with
     * no earned Saffir-Simpson reading draws a bare coloured dot rather than a
     * guessed code (§6, the same rule the forecast dots follow). */
    _posCode: categoryDotCode(storm?.category, storm?.nature),
  };
}

function toFeatureCollection(storms) {
  return {
    type: 'FeatureCollection',
    features: storms.map((s) => {
      /* Where the placement pass decided this storm's name should go, if it
       * has run for this storm yet. It keys on the storm id both data sources
       * stamp on their forecast points, so there is no name matching and no
       * second notion of storm identity to drift. */
      const np = namePlacementFor(s.id);
      return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        /* Data-driven layout, both of them. A storm with no placement yet
         * carries the default, so the name is never missing and never waits
         * on the camera — the worst case is that it sits below the dot for
         * one debounce interval, which is where it used to sit permanently. */
        _nameAnchor: np?.anchor ?? NAME_ANCHOR_DEFAULT,
        _nameOffset: np?.offsetEm ?? NAME_OFFSET_DEFAULT,
        category: s.category,
        /* Resolved HERE, in JS, rather than with a coalesce in the paint
         * expression: the null case needs to know `categoryCode`, and a
         * two-field decision is clearer in one place than nested in a style
         * expression. `category` above stays honest — null means unknown. */
        sizeRank: s.category
          ?? (s.categoryCode === 'HU' ? HURRICANE_RANK : NO_CATEGORY_RANK),
        /* `lastKnown`, `noShapes` and the colour/code the second of them
         * draws with — all four decided in one place, above, because they are
         * one decision. BOOLEANS rather than the lifecycle record: a style
         * expression can filter on a boolean, and the reasoning behind the
         * record belongs to lib/lifecycle.js rather than to a paint property.
         *
         * ==> `lastKnown` IS ENDED **OR** SILENT. <== Both states delete their
         * forecast points (lib/future-slots.js). Filtering on `ended` alone
         * left a silent storm as a past track running into empty ocean with
         * nothing at the end of it — found on glass by Aaron. The two states
         * differ in words, never in whether the storm has a position worth
         * marking. */
        ...positionMarkProps(s, hasForecastPoints(s.id)),
      },
      };
    }),
  };
}

/**
 * Adds the storm source + its layers. Call once, after style load.
 * Layers go on top of the stack — draw order (SPEC §13) puts the storm dot
 * above every shape layer, and labels above the dot.
 *
 * @returns {{ update: (storms: object[]) => void }}
 */
export function addStormMarkers(map) {
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: toFeatureCollection([]),
  });

  /* Planet band: uniform grey position dots. Fades out across the basin floor
   * as the spiral fades in. Radius rides the category scale so "bigger storm"
   * survives even in grey. */
  /* THE HIT TARGET. Draws nothing; exists so a storm is always selectable.
   *
   * Was a visible grey position dot that stopped at z3.4. It is now
   * transparent and carries NO maxzoom, because it is the one thing
   * guaranteeing selection works:
   *  - in GLOBE view, where the mesh draws the spiral and MapLibre draws no
   *    symbol at all — this circle is what makes that mesh glyph tappable;
   *  - on a COLD LOAD, where the feed has landed but geometry has not, so a
   *    storm has no forecast points to tap yet;
   *  - after a FAILED geometry fetch, where it never will.
   *
   * Selection must never depend on a network round trip completing.
   *
   * Radius still rides the category scale so a bigger storm keeps a bigger
   * target, and it is floored at the §9 44 px touch minimum — the query box
   * in stormAtPoint enforces that too, but a target smaller than the finger
   * pressing it should not exist in the first place.
   *
   * ZERO OPACITY IS THE ONE THING TO CONFIRM ON GLASS. MapLibre returns
   * fully-transparent layers from queryRenderedFeatures (unlike
   * `visibility: none`, which it excludes), so this should behave. If taps
   * stop selecting, that assumption is why — raise the opacity a hair rather
   * than restoring the glyph. */
  map.addLayer({
    id: LAYER_DOT,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-color': gs('stormPlanetDot'),
      'circle-radius': [
        'interpolate', ['linear'], ['coalesce', ['get', 'sizeRank'], NO_CATEGORY_RANK],
        0, Math.max((SIZE.glyphBase / 2) * SIZE.glyphScale[0] * 0.55, HIT_MIN_PX),
        6, Math.max((SIZE.glyphBase / 2) * SIZE.glyphScale[6] * 0.55, HIT_MIN_PX),
      ],
      'circle-opacity': 0,
      /* ALSO `viewport` BY DEFAULT, AND HERE IT IS A TOUCH-TARGET RULE RATHER
       * THAN A LOOK. This circle's radius is floored at the §9 44 px minimum,
       * and `'map'` alignment quietly broke that floor: glued flat to the
       * planet, the target foreshortens with pitch and with distance from the
       * centre of the globe, so a storm near the limb had a target a few pixels
       * tall no matter what the floor said. 44 px has to mean 44 px of screen,
       * which is what `viewport` measures. */
    },
  });

  /* ==> THE POSITION OF A LIVE STORM NOBODY HAS DRAWN A TRACK FOR. <==
   *
   * Sibling to the ended-storm mark below, and built on the identical idea:
   * a forecast point with no forecast in it. Same radius, same stroke, same
   * centred character. The difference is which fact it is standing in for —
   * that one says "the last place anyone put it", this one says "here it is,
   * we just have no shapes yet" — so this one keeps the storm's real
   * category colour and its real code, because those ARE known. The advisory
   * arrived; only the shapefiles are late.
   *
   * ==> IT MUST MATCH THE TAU-0 DOT EXACTLY, AND THAT IS MEASURED RATHER
   * THAN AESTHETIC. <== On live NHC bytes (2026-09-10) a storm's reported
   * position and its tau-0 forecast point agree to nine decimal places,
   * because both are the same analysis. So when the shapefiles land, the real
   * dot appears on the same pixel at the same size in the same colour and
   * this one stops drawing — the reader sees a track grow out of a dot that
   * did not move, rather than a dot appearing.
   *
   * NO ZOOM FLOOR, for the reason the ended mark has none: it arrives when a
   * forecast dot would, which is when the MapLibre canvas fades in behind the
   * cage. Zoomed further out the 3D mesh is already drawing this storm's head
   * off the storm list, so there was never a hole there — the hole was here,
   * at map zoom, where the geometry IS the storm and there was no geometry.
   *
   * `viewport` pitch alignment by omission, same as every other circle in
   * this file: the disc faces the reader instead of foreshortening to a
   * sliver out at the limb. */
  map.addLayer({
    id: LAYER_POSITION,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'noShapes'], true],
    paint: {
      'circle-color': ['get', '_posColor'],
      /* READ OFF THE FORECAST POINT'S OWN TOKENS, never copied as numbers —
       * the whole point is that the two are indistinguishable, and a
       * duplicated literal is how that stops being true. */
      'circle-radius': STORM_GEO.pointRadius,
      'circle-stroke-width': STORM_GEO.pointStrokeWidth,
      'circle-stroke-color': gs('geoPointStroke'),
    },
  });

  /* The code inside it. Its own layer because MapLibre draws text and circles
   * in different layer types, and `text-allow-overlap` / `text-ignore-placement`
   * for the reason the forecast code carries them: it belongs to its dot and
   * must never be moved or dropped by collision, or the dot shows up empty and
   * reads as a rendering fault.
   *
   * `geoPointCodeColor` — the forecast dots' ink, not the ended mark's. This
   * dot wears a §6 category colour that does not move between themes, which is
   * exactly the condition that ink was chosen for. */
  map.addLayer({
    id: LAYER_POSITION_CODE,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['get', 'noShapes'], true],
    layout: {
      'text-field': ['get', '_posCode'],
      'text-font': ['Noto Sans Regular'],
      'text-size': STORM_GEO.pointCodeSize,
      'text-anchor': 'center',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': gs('geoPointCodeColor') },
  });

  /* Basin band and closer: the category-colored spiral. Always drawn —
   * overlap between two storms is information, not clutter, and a hidden
   * hurricane is a §5 violation. */
  /* THE SPIRAL GLYPH LAYER IS GONE, DELIBERATELY (2026-07-24).
   *
   * BOTH ENGINES DREW THE SAME SPIRAL. `map/glyph.js` is shared: the 3D node
   * mesh stamps it as a sprite, MapLibre stamped it as a symbol here. The
   * zoom bands guaranteed they overlapped — this layer reached full opacity
   * at z3.4 while the mesh does not finish handing off until z5.0, so for
   * 1.6 zoom levels two copies of one glyph were drawn at slightly different
   * projected positions and sizes. That is the smeared look during zoom, and
   * it was structural rather than tunable.
   *
   * ONE ENGINE OWNS THE SPIRAL AND IT IS THE MESH. `glyph.js` stays; only
   * this stamping of it is retired. At map zooms the storm is carried by its
   * geometry — track, cone, wind field, and the forecast points, whose first
   * dot sits on the current position with the category color and code.
   *
   * SELECTION DID NOT GO WITH IT. It never lived on this layer alone
   * (`stormAtPoint` always queried the dot too), and the dot above is now a
   * transparent hit target at every zoom — which is what keeps the MESH
   * glyph tappable in globe view, where no MapLibre symbol was ever drawn. */

  /* ==> THE LAST KNOWN POSITION OF A STORM NOBODY IS PUBLISHING. <==
   *
   * ENDED **AND** SILENT, which is one condition wearing two names — see
   * `noCurrentReading` in lib/lifecycle.js.
   *
   * THIS EXISTS BECAUSE A LIVE STORM'S POSITION DOT AT MAP ZOOM IS ITS TAU-0
   * FORECAST POINT, and neither state has forecast points — they are one of
   * the slots lib/future-slots.js empties, correctly, because there is nothing
   * left to forecast. The consequence was easy to miss and is the thing Aaron
   * actually asked for: the cage draws a grey head in GLOBE view, so on a phone
   * held at the planet band the storm is right there — and then you zoom
   * in to look at it and the storm has no centre at all, just a track ending in
   * empty ocean.
   *
   * So the position gets its own mark, and it is a MARK RATHER THAN A GLYPH.
   * A spiral would say "cyclone here"; this says "the last place anyone put
   * it". The stroke is what makes it readable in both themes over land or
   * water, the same job the glyph's baked halo does (map/glyph.js).
   *
   * ==> IT IS A FORECAST DOT WITH NO FORECAST IN IT, AND THAT IS THE WHOLE
   * IDEA. <== Same radius, same stroke, same centred character — everything a
   * forecast point is, except the fill is the ended grey instead of a severity
   * color and the character is an X instead of a category code. A reader who
   * has learned to read the dots along a track reads this one for free: it sits
   * exactly where the next dot would have, at exactly the size the others are,
   * and the X says there is nothing in it.
   *
   * THIS USED TO BE HALF THE SIZE, on the reasoning that a finished storm must
   * not compete with a live one in a basin holding both. That was solved in the
   * wrong channel. SIZE was carrying "this matters less", which put it in
   * competition with §6's rule that the severity read comes off color — and it
   * cost the mark its legibility at the zoom it exists to serve. The grey is
   * what says the storm is over; it is doing that job already, and it does not
   * need size helping. Aaron's call, 2026-07-29.
   *
   * NO ZOOM FLOOR, AND THAT IS THE POINT — it arrives exactly when a forecast
   * dot does, which is when the MapLibre canvas fades in behind the cage
   * (`DIVE.fade.mapIn`). This mark stood on `ZOOM.ambientGeometry` until it was
   * caught on glass: the floor was removed from ambient lines and dots when the
   * crossfade became the real gate (map/layers/registry.js), and this layer was
   * written to the older rule and missed. The result was two zoom levels where a
   * live storm had its dots and an ended one had nothing but a track ending in
   * open water — the exact hole this mark exists to fill, reopened by the
   * gating. Text and stripes still keep the floor; dots do not. */
  map.addLayer({
    id: LAYER_LAST_KNOWN,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'lastKnown'], true],
    paint: {
      'circle-color': gs('stormEnded'),
      /* READ OFF THE FORECAST POINT'S OWN TOKENS, never copied as numbers. The
       * two marks have to stay the same size, and a duplicated literal is how
       * that stops being true six months from now. */
      'circle-radius': STORM_GEO.pointRadius,
      'circle-stroke-width': STORM_GEO.pointStrokeWidth,
      'circle-stroke-color': gs('geoPointStroke'),
      /* NO `circle-pitch-alignment`, WHICH MEANS MapLibre's DEFAULT OF
       * `viewport` — the disc faces the reader and stays a circle at every
       * pitch and everywhere on the globe.
       *
       * It used to say `'map'`, which glues the disc flat to the planet's
       * surface. Tangent to a sphere, that foreshortens: tilt the view or push
       * the storm out toward the limb and the mark squashes to an ellipse and
       * finally to a sliver, while every forecast dot beside it stays round.
       * Aaron caught it on glass, 2026-08-08.
       *
       * This is the same rule the paint above follows: the mark is a forecast
       * dot with no forecast in it, so it matches the forecast dot in EVERY
       * channel. `map/layers/points-forecast.js` sets no pitch alignment at
       * all, so `viewport` is what the whole track already does — and every
       * other circle layer in the app with it. The X on top was already
       * viewport-aligned (a point symbol's text defaults there), which is why
       * the two disagreed and the disc alone looked wrong. */
    },
  });

  /* The X inside it. Its own layer for the same reason the forecast code has
   * one — MapLibre draws text and circles in different layer types — and it
   * carries `text-allow-overlap` / `text-ignore-placement` for the reason the
   * forecast code does: it belongs to its dot and must never be moved or
   * dropped by collision, or a grey dot shows up empty and reads as a rendering
   * bug rather than an ended storm.
   *
   * A PLAIN CAPITAL X, not the multiplication sign it visually wants to be. The
   * glyph pack this style serves is only guaranteed across the basic Latin
   * range, and a codepoint the pack does not carry draws NOTHING — a silent
   * failure, which §5 does not allow anywhere and least of all on the mark whose
   * entire job is to say a storm is over. */
  map.addLayer({
    id: LAYER_LAST_KNOWN_MARK,
    type: 'symbol',
    source: SOURCE_ID,
    /* No floor, for the reason the circle has none — and it must be the SAME
     * answer as the circle's or the mark shows up as a bare grey dot for two
     * zoom levels before its X arrives. */
    filter: ['==', ['get', 'lastKnown'], true],
    layout: {
      'text-field': 'X',
      'text-font': ['Noto Sans Regular'],
      'text-size': STORM_GEO.pointCodeSize,
      'text-anchor': 'center',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    /* No halo. The dot is the backdrop, same as the forecast code — but NOT
     * the same ink. `geoPointCodeColor` is near-black in both themes because
     * the dots it sits on are §6 category colors and never move; this dot is
     * `stormEnded`, which is bone in the dark theme and a dark neutral in the
     * light one, so its X has to flip with it. See DARK.geo.endedMark. */
    paint: { 'text-color': gs('geoEndedMark') },
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
      /* ==> BOTH OF THESE ARE DATA-DRIVEN NOW, AND THAT IS THE WHOLE FIX. <==
       * They were the literals that pinned every storm's name below its dot
       * (the reasoning behind the numbers now lives on NAME_OFFSET_DEFAULT
       * above). The name has to be able to move to the side of a north-south
       * storm, and the only module that knows which way the track is DRAWN is
       * the one that projects it — `map/layers/points-forecast.js`, which
       * stamps `_nameAnchor` and `_nameOffset` per storm.
       *
       * `text-anchor` and `text-offset` are both genuinely data-driven in
       * MapLibre 5.6 — the forecast time labels have used `['get']` on both
       * since 2026-07-26. `text-variable-anchor` must stay ABSENT: setting it
       * makes MapLibre pick the anchor itself and ignore ours. */
      'text-offset': ['get', '_nameOffset'],
      'text-anchor': ['get', '_nameAnchor'],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
    },
    paint: {
      /* PRIMARY, not secondary. A storm's name is the answer to the question
       * the map is asking; it was set in the ink this app uses for supporting
       * detail, which made it recede behind basemap furniture that is
       * genuinely less important than it is. */
      'text-color': gs('geoStormLabelColor'),
      /* The halo is what makes a name legible where it crosses a coastline —
       * the terrain under it changes pixel to pixel, so the halo, not the
       * terrain, is what the name is read against. Its own token because in
       * the dark theme it happens to equal the ocean and in the light theme
       * it emphatically does not. */
      'text-halo-color': gs('geoStormLabelHalo'),
      'text-halo-width': SIZE.stormLabelHaloPx,
      'text-opacity': byZoom([
        [ZOOM.basin, 0],
        [ZOOM.basin + 0.6, 0.95],
      ]),
    },
  });

  /* The last list handed in, kept so a name moving can be re-stamped without
   * waiting for the next poll. Placement runs on a settled camera, which is
   * far more often than data arrives. */
  let lastStorms = [];

  const draw = () => {
    map.getSource(SOURCE_ID)?.setData(toFeatureCollection(lastStorms));
  };

  /* Hand this pass's redraw to the two long-lived subscriptions above. */
  redrawStorms = draw;

  return {
    update(storms) {
      /* Patch in place: setData swaps the source's content without touching
       * layers — the 30-min poll never makes the map blink (SPEC §13). */
      lastStorms = storms || [];
      draw();
    },
  };
}

/**
 * Which storm (if any) sits under a screen point.
 *
 * Honors the 44 px hit rule (§9): the drawn target may be smaller, the QUERY
 * box never is.
 *
 * TWO KINDS OF TARGET, and the ORDER MATTERS. The storm's own position is
 * checked first, then its forecast points — so a tap near the storm selects
 * it by its position rather than by whichever track dot happened to be a
 * pixel closer. Tapping anywhere along a track selects that track's storm,
 * which is the behaviour that replaced tapping the spiral.
 *
 * A forecast-point layer that does not exist yet is skipped rather than
 * throwing: MapLibre rejects the whole query if any named layer is missing,
 * which would take storm selection down entirely on the first paint.
 */
export function stormAtPoint(map, point) {
  const half = parseInt(SIZE.touchTarget, 10) / 2;
  const box = [
    [point.x - half, point.y - half],
    [point.x + half, point.y + half],
  ];

  const layers = [LAYER_DOT, ...FPOINT_LAYERS].filter((id) => map.getLayer(id));
  if (!layers.length) return null;

  const hits = map.queryRenderedFeatures(box, { layers });
  for (const h of hits) {
    /* `id` on the storm source; `_stormId` stamped on forecast points by the
     * data layer. Neither is guessed — a point that carries no attribution
     * selects nothing rather than selecting a neighbour. */
    const id = h.properties?.id ?? h.properties?._stormId;
    if (id) return id;
  }
  return null;
}
