/**
 * cap-coast.js — foreign agencies' cyclone warnings, painted onto the coast.
 * SPEC §50.9, §50.11.
 *
 * ==> THE WHOLE POINT IS THAT THIS LOOKS IDENTICAL TO `watch-warning.js`.
 * <== Aaron's call, 2026-08-19: a warning is a warning, and a reader in Manila
 * should see the same stripe a reader in Galveston sees. That is achieved by
 * running through the SAME selector and the SAME width curves rather than by
 * two files being kept in step by hand — `lineLayers` below is imported from
 * the NHC layer, not copied, so a change to the coastline's stroke cannot
 * drift between them.
 *
 * ==> WHAT IS GENUINELY DIFFERENT, AND IT IS THE INPUT, NOT THE OUTPUT. <==
 * NHC publishes breakpoint LINES, which `corridor()` fattens into a shape. A
 * CAP alert publishes an AREA already. `areaSelect()` (map/coast-band.js)
 * skips the fattening and asks the polygon directly, dilated by
 * `COAST_BAND.areaPadKm` so a coarsely-traced national outline does not
 * exclude the very shoreline it is about.
 *
 * ==> AND THE SCALE IS DIFFERENT IN A WAY GLASS HAS NOT JUDGED. <== An NHC
 * warning covers a stretch of one coast. A CAP area covers a COUNTRY: the
 * Philippines is 7,600 islands, and a Costa Rican alert takes in both the
 * Pacific and the Caribbean shore. Everything here is correct and the result
 * may still read as too much. §50.11 records that as the open question.
 *
 * ==> IT DOES NOT USE `map/coast-band-cache.js`, AND THAT IS DELIBERATE. <==
 * That cache is keyed per storm and stamped by ADVISORY NUMBER, because NHC
 * geometry is replaced advisory by advisory. A CAP alert has no advisory
 * number; what it has is an expiry and a row id, and it is not owned by a
 * storm at all — one alert can belong to two storms hitting one country.
 * Bolting an alert set onto a storm-keyed, advisory-stamped cache would mean
 * inventing both halves of its key. The select is memoized here instead, on
 * the two things that genuinely invalidate it: the alert set and the
 * coastline generation.
 *
 * ==> ONLY ALERTS IN FORCE PAINT. <== §50.8. A cancellation and a drill both
 * reach `data/cap.js` — the first because "the wave has passed" is worth
 * reading — and neither may reach the coast. `isInForce()` is the gate, and it
 * is applied HERE rather than upstream so the panel can still show them as
 * text.
 *
 * Imports: config/, lib/, data/, map/ siblings. No DOM beyond the map.
 */

import { CATEGORY_COLOR } from '../../config/tokens.js';
import { COAST_BAND } from '../../config/constants.js';
import { wwColor, wwSortKey } from '../../lib/watchwarning.js';
import { isInForce, severityRung, alertsForStorm } from '../../lib/cap.js';
import { areaSelect } from '../coast-band.js';
import { coastRings, coastGeneration } from '../coast-source.js';
import { loadAlerts } from '../../data/cap.js';
import { loadShapes } from '../../data/cap-shapes.js';
import { lineLayers } from './watch-warning.js';
import { registerLayer } from './registry.js';

const SOURCE = 'sel-cap';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The alerts currently painted, so `moveend` can re-select them against
 *  coastline that has since loaded. Held rather than re-derived: the storm and
 *  its alert list are not reachable from an event handler. */
let held = null; // { alerts, shapes }

/** Off unless the reader has the coastal pair on watch/warning — this stripe
 *  IS a watch/warning stripe and must obey the same switch. Defaulted to the
 *  manifest's value so geometry arriving before the first pref sync paints. */
let segment = 'watchWarning';
const drawingOff = () => segment !== 'watchWarning';

/* ---------------------------------------------------------------------------
 * THE SELECT MEMO
 *
 * A national outline against a delta coastline is the most expensive select in
 * the app, and `moveend` fires it. Two things and only two things change the
 * answer: WHICH alerts are painted, and WHICH coastline vertices are loaded.
 * `coastGeneration()` is the map's own counter for the second — bumped by
 * `sourcedata` and `styledata` — so this is an exact invalidation signal
 * rather than a staleness tradeoff. Between two bumps the select would return
 * the identical features.
 * ------------------------------------------------------------------------ */
let memo = null; // { sig, generation, fc }

/** What the painted set is, as a string. Row id AND expiry: an agency
 *  reissuing the same alert with a later expiry is a different statement, and
 *  the id alone would hold the old one. */
const signature = (alerts) =>
  alerts.map((a) => `${a.objectId}:${a.expires ?? ''}:${a.severity ?? ''}`).sort().join('|');

/**
 * Alerts + their areas -> painted coast runs.
 *
 * ==> AN ALERT WITH NO RUNG IS NOT PAINTED, AND IT IS NOT AN ERROR EITHER.
 * <== §50.9. A severity the agency declined to state gives no colour, and the
 * generic hue is not available to us here the way it is for an NHC feature
 * with an unreadable code: there, the FACT of a warning is certain and only
 * its class is unknown, so generic paint is honest. Here an unstated severity
 * on a whole-country area could be anything, and painting a country in a
 * neutral colour would still assert "this coast is under warning" at a
 * confidence the row does not carry.
 */
function decorated(map, alerts, shapes) {
  const rings = coastRings(map);
  const features = [];

  for (const alert of alerts) {
    const rung = severityRung(alert);
    if (!rung) continue;
    const area = shapes.get(alert.objectId);
    if (!area) continue;

    const { runs } = areaSelect(area, rings, COAST_BAND.areaPadKm);
    if (!runs.length) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: runs },
      properties: {
        /* `_banded` is the filter `lineLayers` draws on (map/coast-fallback.js
         * IS_BANDED). It is true unconditionally here because — unlike the NHC
         * path — there is no fallback geometry to draw: NHC hands us a chord we
         * can show unsnapped, while a CAP area is a country outline that would
         * be a lie drawn as a coastline. No coast selected means no feature,
         * which the layer reports rather than approximates. */
        _banded: true,
        _color: wwColor(rung) || CATEGORY_COLOR.GENERIC,
        _sev: wwSortKey(rung),
        _capAgency: alert.agency || null,
        _capEvent: alert.event || null,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** The memoized select. */
function paintFor(map, alerts, shapes) {
  const sig = signature(alerts);
  const generation = coastGeneration(map);
  if (memo && memo.sig === sig && memo.generation === generation) return memo.fc;
  const fc = decorated(map, alerts, shapes);
  memo = { sig, generation, fc };
  return fc;
}

const repaint = (map) => {
  map.getSource(SOURCE)?.setData(
    held && !drawingOff() ? paintFor(map, held.alerts, held.shapes) : EMPTY
  );
};

registerLayer({
  /* ==> IT JOINS THE `coastal` PAIR RATHER THAN GETTING ITS OWN SWITCH. <==
   * §50.11. This is a watch/warning stripe; a reader who turns watch/warning
   * off means all of them, and a second toggle reading "foreign warnings"
   * would be asking them to know which agency covers their coast before they
   * can turn on the thing that tells them. */
  key: 'capCoast',
  type: 'pair',
  pairId: 'coastal',
  /* 41 — immediately ABOVE watch-warning's 40. They never overlap in practice
   * (§50.3 matches CAP by country and NHC storms carry none), but where they
   * ever did, NHC's is the more precise statement about that coast and this
   * one must not bury it. Sorting within each source is by severity as usual.
   */
  order: 41,

  ensure(map, beforeId) {
    if (map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
    for (const layer of lineLayers('sel-cap', SOURCE, null)) {
      map.addLayer(layer, beforeId);
    }

    /* Coast vertices arrive as tiles load, so a settled camera can paint coast
     * the previous select could not see. Debounced on the same constant the
     * NHC stripe uses — one pinch fires several moveends and they must
     * collapse into one select, which here is the expensive one. */
    let timer = null;
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        /* THE SEGMENT IS CHECKED WHEN THIS RUNS, not when it was scheduled. A
         * tap on Off easily lands inside the debounce, and a re-select does
         * not consult the source it overwrites. */
        if (drawingOff()) return;
        repaint(map);
      }, COAST_BAND.reselectDebounceMs);
    });
  },

  /**
   * ==> ASYNC, WHICH NO OTHER LAYER IN HERE IS, AND IT FETCHES ITS OWN DATA.
   * <== Neither is how layers usually work and both are forced by what CAP is.
   *
   * The alert feed is NOT in the bundle. `data/bundle` is per-storm geometry
   * fetched from that storm's own source; the CAP list is one global 8 KB
   * answer shared by every storm and every reader, which is why `data/cap.js`
   * memoizes it session-wide. Threading it through the bundle would mean
   * refetching a global list per storm, or inventing a storm-shaped slot for
   * something that is not the storm's. `loadAlerts()` returns the memo, so the
   * call below is free after the panel has already made it.
   *
   * The SHAPES are then fetched per alert set (§50.10) because they are the
   * only part of this feature with weight.
   *
   * The engine does not await this, so every path has to be safe against the
   * reader having moved on — which is what the `wanted` guards are for.
   */
  update(map, storm) {
    const wanted = storm.id;

    loadAlerts().then(async (feed) => {
      if (wanted !== storm.id) return;
      /* NOT AN OUTAGE HERE. `data/cap.js` already distinguished unavailable
       * from empty and the PANEL is where that distinction is worded (§50.6).
       * A layer's only honest response to "we do not know" is to paint
       * nothing, which is what the empty source already does. */
      const mine = feed?.state === 'ok' ? alertsForStorm(feed.alerts, storm) : [];
      const inForce = mine.filter((a) => isInForce(a, Date.now()) && a.objectId != null);

      if (!inForce.length) {
        held = null;
        memo = null;
        map.getSource(SOURCE)?.setData(EMPTY);
        return;
      }

      const slot = await loadShapes(inForce.map((a) => a.objectId));
      /* The reader moved on while the shapes were in flight. Painting now
       * would put one storm's warnings on another storm's screen. */
      if (wanted !== storm.id) return;

      if (slot.state !== 'ok' || !slot.shapes.size) {
        held = null;
        memo = null;
        map.getSource(SOURCE)?.setData(EMPTY);
        return;
      }
      held = { alerts: inForce, shapes: slot.shapes };
      memo = null;
      repaint(map);
    });
  },

  clear(map) {
    held = null;
    memo = null;
    map.getSource(SOURCE)?.setData(EMPTY);
  },

  /* No ambient half. §50.3 matches alerts to a storm through GDACS's affected
   * countries, and the ambient collection is every storm at once — merging
   * their alert sets would paint every warned coast on earth behind whichever
   * storm the reader opened, with no way to tell which belonged to what. The
   * NHC stripe can be ambient because its geometry IS the storm's own. */

  setPair(map, value) {
    if (value === segment) return false;
    segment = value;
    repaint(map);
    /* FALSE: this layer has no ambient collection for the engine to re-merge,
     * and the one source it owns is written above from data already in hand. */
    return false;
  },
});
