/**
 * flood-features.js — one alert list in, two map sources out. SPEC §56.5.
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
 * geometry so degenerate that `interiorPoint` refuses it, and if that ever
 * happens the alert is on the map as a polygon with nothing clusterable over
 * it — findable by eye at z7 and invisible at z4. A number nobody can read is
 * how that ships silently.
 *
 * Pure. Imports `lib/` siblings only — no config, no DOM, no data.
 */

import { inForce } from './flood.js';
import { interiorPoint } from './interior-point.js';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

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
 * Build the polygon source and the point source from one alert list.
 *
 * @param {Array<object>} alerts alerts as `data/flood.js` holds them — already
 *   zone-joined (§56.4), so a watch arrives with a real boundary or with none.
 * @param {number} nowMs
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
export function floodSources(alerts, nowMs) {
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
    const p = interiorPoint(a.geometry);
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
