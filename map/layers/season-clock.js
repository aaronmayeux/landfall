/**
 * season-clock.js — where each storm IS, at the moment the clock is showing.
 * §57.23, §57.30 step 10.
 *
 * ==> IT DRAWS ONE THING: THE MOVING HEADS. THE TRAILS ARE
 * `season-tracks.js`'S. <== §57.35 fault 3 asks for the accumulated trail and
 * the moving dots to be SEPARATE sources, so that nudging a dot along never
 * rewrites a season's worth of line geometry. That is exactly this split, and
 * this is the small half: at most one circle per ticked storm, pushed on every
 * step, against a trail source that is pushed only when a storm actually
 * crosses a vertex.
 *
 * ==> AND THE TRAIL IS THE EXISTING TRACK LAYER RATHER THAN A SECOND ONE. <==
 * The obvious build is a whole parallel set of clock layers. It is the wrong
 * one: the tracks already carry the name along the line, the focus dimming,
 * the peak-category ink and the 44 px tap target, and a second line layer means
 * every one of those either gets duplicated or silently stops working the
 * moment somebody presses play. `setSeasonTracks` takes a cut instead, so
 * during playback the reader is looking at the SAME line they were looking at
 * before, just shorter.
 *
 * ==> THE HEAD IS COLOURED BY THE STORM'S STRENGTH AT THAT MOMENT, AND THE
 * TRACK BEHIND IT BY ITS PEAK. <== Deliberate, and the one place on this globe
 * where the two disagree. A finished track's hue answers "how bad did this get"
 * — the question the archive exists for. A moving head answers "how bad is it
 * right now", which is the only question worth asking while a clock is running,
 * and watching a dot climb from blue to red as it crosses the Gulf IS the
 * feature. Both are §6's fixed ramp, so neither is inventing a colour meaning.
 *
 * ==> THE COLOUR IS BAKED INTO EVERY FEATURE, NEVER LEFT TO A FALLBACK. <==
 * Same guarantee `season-tracks.js` gives and for the same open bug (NOW.md
 * `0d`): `headColor` below has no path that returns null or undefined. A storm
 * with no wind reading at the moment being shown — real, and ordinary before
 * 1886 — gets the ungraded hue rather than a missing property.
 *
 * Imports config/ and lib/. Owns its own source and layer, and keeps no state:
 * unlike the tracks, there is nothing here a style rebuild could get wrong,
 * because the next step repaints it a tenth of a second later.
 */

import { ARCHIVE_GEO } from '../../config/tokens.js';
import { palette } from '../../config/theme.js';
import { categoryColor, categoryFromKt } from '../../lib/category.js';

const SOURCE = 'season-clock-heads';
const LAYER = 'season-clock-heads';
const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * The hue for a storm at one moment: its category at the last recorded fix on
 * or before the clock, never an interpolation between two.
 *
 * ==> STRENGTH IS NOT INTERPOLATED AND POSITION IS, AND THAT IS NOT AN
 * INCONSISTENCY. <== A position between two fixes is a claim the record
 * supports — the storm was somewhere on that leg. A wind speed between two
 * fixes is a number NOAA never wrote, and rendering it as a colour would put
 * an invented Cat 4 on screen for a storm that went 3 to 5 between
 * observations. The dot holds its last known category until the next real
 * reading, which is what the record actually says.
 */
function headColor(windKt) {
  const cat = categoryFromKt(typeof windKt === 'number' && Number.isFinite(windKt) ? windKt : null);
  return categoryColor(cat, 'tropical', null);
}

/**
 * The last recorded wind on or before this moment.
 *
 * Linear rather than a binary search, unlike `cutTimeline`'s: this walks a
 * storm's RECORDED fixes — a few dozen — rather than its several hundred curve
 * vertices, and it runs once per running storm per step. Measured against 2005
 * ticked whole it is not where the time goes.
 */
function windAt(storm, cutMs) {
  let wind = null;
  for (const p of storm?.points || []) {
    if (typeof p?.time !== 'number' || p.time > cutMs) break;
    if (typeof p?.windKt === 'number' && Number.isFinite(p.windKt)) wind = p.windKt;
  }
  return wind;
}

/**
 * Attach the layer. Idempotent, like every other archive layer — the archive
 * is entered and left many times in one session and the source outlives it.
 *
 * @param {object} map
 * @param {string} [beforeId]  drawn beneath this, so the live globe's markers
 *                             and the archive's own names stay on top
 */
export function ensureSeasonClock(map, beforeId) {
  if (!map || map.getSource(SOURCE)) return;

  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer(
    {
      id: LAYER,
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-radius': ARCHIVE_GEO.clockHeadRadius,
        'circle-color': ['get', 'color'],
        /* ==> NO FOCUS EXPRESSION, AND THAT IS A DECISION RATHER THAN AN
         * OMISSION. <== Everything else on this globe dims when one storm is
         * open. These do not: the head dots exist only while the clock runs,
         * and dimming five of six of them would leave a reader who happened to
         * have a storm open watching one dot move across an otherwise still
         * globe — which is the accumulation §57.23 is built to show, deleted
         * by a rule borrowed from a different question.
         *
         * ==> THE STROKE IS CARRIED ON THE FEATURE, NOT NAMED WITH `gs()`. <==
         * `map/theme-state.js` rule 1b: a paint property holding both a
         * `global-state` reference and a `['get', ...]` is evaluated in the
         * worker, which never receives the global state, and resolves the
         * colour to BLACK without throwing. This block already reads
         * `['get','color']`, so it may not name a state key — and a plain
         * `['get','stroke']` is not a state reference at all, so the two sit
         * together safely. Every push happens inside the archive, where sepia
         * is already forced, so the baked value is the right one. */
        'circle-stroke-width': ARCHIVE_GEO.clockHeadStrokeWidth,
        'circle-stroke-color': ['get', 'stroke'],
      },
    },
    beforeId
  );
}

/**
 * Put a dot on every storm that is happening at this moment.
 *
 * ==> A WHOLE-SET PUSH, LIKE EVERY OTHER ARCHIVE LAYER, AND HERE IT IS ALSO
 * THE CHEAP PATH. <== The set is at most one feature per ticked storm and
 * usually far fewer, because most storms in a season are either unborn or over
 * at any given moment. Ticking all twenty-eight storms of 2005 and playing it
 * peaks at six or seven dots.
 *
 * An empty push is CORRECT and unambiguous here — between two storms a season
 * genuinely has nothing happening in it — so this is not the §5 empty-push trap
 * `liveGlobe.hide()` documents. There is no third state hiding behind it: the
 * clock cannot fail to load, because the data it reads is already in memory.
 *
 * @param {object} map
 * @param {Array<{storm:object, cut:{state:string, head:Array|null}}>} running
 * @param {number} cutMs
 */
export function setSeasonClockHeads(map, running = [], cutMs = 0) {
  const src = map?.getSource?.(SOURCE);
  if (!src) return;

  const features = [];
  /* Read ONCE per push rather than per feature: `palette()` is a lookup, the
   * answer is the same for every dot in one frame, and this runs ten times a
   * second. */
  const stroke = palette().geo.pointStroke;
  for (const item of running) {
    const head = item?.cut?.head;
    if (item?.cut?.state !== 'running' || !Array.isArray(head)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: head },
      properties: {
        id: item?.storm?.id || null,
        color: headColor(windAt(item.storm, cutMs)),
        stroke,
      },
    });
  }

  src.setData({ type: 'FeatureCollection', features });
}

/** Take the dots off. Pausing does NOT call this — a paused clock still shows
 *  where every storm had got to, which is the whole point of being able to
 *  pause. This is stopping the clock and leaving the archive. */
export function clearSeasonClock(map) {
  map?.getSource?.(SOURCE)?.setData(EMPTY);
}

export const __internals = { headColor, windAt };
