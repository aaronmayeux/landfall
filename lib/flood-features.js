/**
 * flood-features.js — one alert list in, two map sources out. SPEC §56.5.
 * Slice B.
 *
 * ==> ONE LIST, TWO SOURCES, BUILT IN ONE PLACE, AND THE "ONE PLACE" IS THE
 * WHOLE REASON THIS FILE EXISTS. <== The globe needs the shapes in a plain
 * GeoJSON source and the icons in a CLUSTERED source, and MapLibre clusters
 * `Point` geometry only — so they cannot be the same source. Two sources fed
 * from two places is the split that drifts: a shape drawn with no icon over
 * it, or an icon over a county with nothing painted, and neither surface
 * knowing it disagrees with the other. `floodSources` walks the list once and
 * emits both, so there is never a second list to keep in step.
 *
 * ==> IT LIVES IN `lib/` AND NOT IN THE LAYER, BECAUSE THE GUARANTEE HAS TO BE
 * TESTABLE WITHOUT A BROWSER. <== §56.5's acceptance case is that every
 * computed point falls inside its own polygon across the whole archived set.
 * That is a plain node assertion over real bytes if this is a pure function,
 * and a chromium run if it is buried in a `map.addSource` call.
 *
 * ==> AND IT COUNTS WHAT IT COULD NOT DRAW. <== §5. Three numbers come back
 * with the features: how many alerts were in force, how many got a shape, and
 * how many got a shape but no icon. The last one can only be non-zero for a
 * geometry so degenerate that `interiorPoint` refuses it. Such an alert keeps
 * its polygon and its row in the drawer's `Flooding` section — it loses the
 * marker that makes it findable at planet distance, which is a degrade rather
 * than a silence, and the count is what stops it being an unnoticed one.
 *
 * ------------------------------------------------------------------------
 * THE CACHE, AND IT IS THE POINT OF THIS FILE'S SECOND DRAFT
 * ------------------------------------------------------------------------
 *
 * ==> THE INTERIOR-POINT SEARCH IS THE MOST EXPENSIVE THING THIS FEATURE DOES,
 * AND THE FIRST ATTEMPT RAN ALL OF IT ON EVERY PUSH. <== Measured in this
 * sandbox on the real archived bytes: the thirty-three national warning
 * polygons cost about 16 ms together, and ONE resolved Hawaii forecast zone —
 * 1,970 vertices — costs about 8 ms on its own. A storm with a dozen resolved
 * watch zones is therefore something like a tenth of a second of pure
 * arithmetic per push, and a push happens on every selection, every poll and
 * every theme change.
 *
 * ==> THAT NUMBER IS A FLOOR AND NOT A MEASUREMENT OF THE APP. <== `CLAUDE.md`:
 * a millisecond figure out of `node` in this sandbox is evidence about this
 * sandbox. A phone is several times slower than it, never faster, which is the
 * only direction the comparison is safe in.
 *
 * ==> SO THE POINT IS COMPUTED ONCE PER ALERT AND NEVER AGAIN. <== The cache is
 * keyed on the alert's `id`, which is an NWS CAP URN carrying a content hash
 * (`urn:oid:2.49.0.1.840.0.<sha>.001.1`) — a corrected or extended alert is
 * issued under a NEW id rather than mutating an old one, so an id is a
 * permanent handle on one shape. Keying on the geometry OBJECT instead would
 * miss on every poll, because a fresh fetch parses fresh objects out of
 * identical bytes: that is the same trap §56.15 names for the corridor memo.
 *
 * ==> A REFUSAL IS CACHED TOO. <== `interiorPoint` returning null is an answer
 * about that shape and it will not change. Storing it stops a degenerate ring
 * being re-searched on every push forever, which is the one case where the
 * expensive path would otherwise run every time by construction.
 *
 * ==> THE CACHE IS PASSED IN RATHER THAN HELD HERE, SO THE WORK CAN BE
 * COUNTED. <== §12's rule is that a test agreeing with the bug is worse than no
 * test, and the obvious assertion about a cache — that two calls give the same
 * answer — passes whether or not the cache exists. `cache.runs` counts searches
 * actually performed, so deleting the lookup turns the suite red.
 *
 * Pure. Imports `lib/` siblings only — no config, no DOM, no data. The cache's
 * SIZE POLICY is the caller's, because the cap is a tuning constant and this
 * file does not read config.
 */

import { inForce } from './flood.js';
import { interiorPoint } from './interior-point.js';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

/**
 * A place to keep interior points between pushes.
 *
 * `points` maps an alert id to `{lon, lat}` or to `null` for a shape the
 * search refused. `runs` counts how many searches actually happened — the
 * work, not its result.
 */
export function createPointCache() {
  return { points: new Map(), runs: 0 };
}

/**
 * Keep the cache bounded.
 *
 * ==> IT CLEARS WHOLESALE RATHER THAN EVICTING THE OLDEST. <== An LRU needs an
 * access order to maintain on every hit, which is work on the exact path this
 * cache exists to keep free. A wholesale clear costs one full recompute on the
 * push after it fires and nothing on any other push, and the ceiling is set far
 * above a realistic national day — the frozen capture is 36 alerts and a busy
 * one is low hundreds.
 *
 * @param {{points:Map}} cache
 * @param {number} max
 */
export function trimPointCache(cache, max) {
  if (cache?.points && Number.isFinite(max) && cache.points.size > max) {
    cache.points.clear();
  }
}

/**
 * The properties both a shape and its icon carry.
 *
 * ==> THE SAME OBJECT ON BOTH, DELIBERATELY. <== A tap can land on either, and
 * the handler must not have to know which one it hit to answer "which alert is
 * this". `_id` is what the drawer's detail is looked up by, so it is the one
 * field neither source may omit.
 *
 * `_watch` rides along because the paint expression reads it (a watch is a
 * darker green than a warning, §48.6's urgency split carried onto the globe).
 * It is computed from the event TEXT rather than from `severity`, because
 * measured on real bytes both a Flood Watch and a Flash Flood Warning report
 * `severity: "Severe"` and the field cannot separate them.
 */
const propsOf = (a) => ({
  _id: a.id || null,
  _event: a.event || null,
  _watch: /watch/i.test(a.event || ''),
});

/**
 * The interior point for one alert, from the cache when it is there.
 *
 * ==> AN ALERT WITH NO `id` IS NOT CACHED, AND IT IS NOT REFUSED EITHER. <==
 * Every row the relay projects carries one, so this is a guard rather than a
 * case. Skipping the cache costs that alert a search per push; skipping the
 * CHIP would cost the reader a marker for a hazard that is genuinely in force.
 */
function pointFor(alert, cache) {
  const key = alert.id;
  if (cache && key && cache.points.has(key)) return cache.points.get(key);

  if (cache) cache.runs++;
  const p = interiorPoint(alert.geometry);

  if (cache && key) cache.points.set(key, p);
  return p;
}

/**
 * Build the polygon source and the point source from one alert list.
 *
 * @param {Array<object>} alerts alerts as `data/flood.js` holds them — already
 *   zone-joined (§56.4), so a watch arrives with a real boundary or with none.
 * @param {number} nowMs
 * @param {{points:Map, runs:number}|null} [cache] from `createPointCache()`.
 *   Omitted, every interior point is recomputed — correct, and the cost shape
 *   the first attempt at this phase shipped with.
 * @returns {{shapes:object, points:object, live:number, drawn:number, iconless:number}}
 *   `shapes` and `points` are FeatureCollections. `live` is how many alerts
 *   were in force, `drawn` how many carried a shape, `iconless` how many
 *   carried a shape that produced no interior point.
 *
 * ==> EXPIRY IS FILTERED HERE AND NOT ONLY AT FETCH. <== `inForce` runs at
 * RENDER because the captured Hilo warning ran fifty-two minutes: a payload
 * held even three minutes can contain one that has run out, and an expired
 * warning painted on a map tells somebody they are in danger when they are
 * not.
 */
export function floodSources(alerts, nowMs, cache = null) {
  const shapes = EMPTY_FC();
  const points = EMPTY_FC();
  let live = 0;
  let drawn = 0;
  let iconless = 0;

  for (const a of inForce(alerts, nowMs)) {
    live++;
    if (!a.geometry) continue;
    drawn++;

    const props = propsOf(a);
    shapes.features.push({ type: 'Feature', geometry: a.geometry, properties: props });

    /* ==> NO FALLBACK POINT, EVER. <== `interiorPoint` returns null rather
     * than guessing, and the guess it is refusing — the bounding-box centre —
     * is measured to sit outside its own polygon six times in thirty-five
     * (§56.5). Putting one here to keep the counts tidy would be this app
     * placing a hazard icon in a county NWS did not name. */
    const p = pointFor(a, cache);
    if (!p) {
      iconless++;
      continue;
    }

    points.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: props,
    });
  }

  return { shapes, points, live, drawn, iconless };
}
