/**
 * place-resolver.js — turn a point into a name, once, safely (SPEC-UI §8).
 *
 * ==> TWO INDEPENDENT QUESTIONS, ASKED TOGETHER. <== "What is this called"
 * goes to the geocoder over the network (`reverseGeocode`); "is this water"
 * goes to the basemap already drawn on the screen (`map/water-at.js`, injected
 * as a callback so this file never imports map/). Neither can answer the
 * other's question: Mapbox has no marine data and returns nothing for the open
 * Atlantic exactly as it does for the Sahara, and the tiles know nothing about
 * names. `lib/place-label.js` combines the pair.
 *
 * ==> IT LIVES HERE AND NOT IN THE VIEW BECAUSE THE VIEW HAD ENOUGH TO DO. <==
 * `ui/view-home-setup.js` already owns a search flow, a permission flow, a
 * confirm step and a keyboard dance. Racing, aborting and debouncing a lookup
 * is a fourth concern with its own failure modes, and bolting it on was what
 * pushed that file past the §12 ceiling.
 *
 * THREE RULES IT ENFORCES, all of which are one-line bugs if left to a caller:
 *
 * 1. ONE ANSWER AT A TIME. Dragging a pin across a coastline asks about a
 *    dozen points. Without a sequence number the answers race and the caption
 *    ends up describing a place the pin has already left.
 * 2. ASK AFTER THE PIN STOPS, not while it moves. Every lookup is billed;
 *    `soon()` collapses one deliberate drag into one request.
 * 3. A FAILURE IS NOT AN ERROR STATE. The pin is right, the home will work,
 *    and only the caption is missing — so everything degrades to a `place`
 *    kind and nothing ever throws at the caller.
 *
 * Imports: config/, lib/, data/geocode. No UI, no map.
 */

import { GEOCODE } from '../config/constants.js';
import { reverseGeocode } from './geocode.js';
import { placeKindFrom } from '../lib/place-label.js';

/**
 * @param {object} opts
 * @param {(lonlat:{lon,lat}) => Promise<'water'|'land'|'unknown'>} [opts.probeWater]
 * @param {(at:{lon,lat}, resolved:{label:string|null, place:string}) => void} opts.onResolved
 *        Called once per settled lookup, with the point it describes. The
 *        POINT IS PASSED BACK deliberately: by the time an answer lands the
 *        caller may be showing something else entirely, and handing back only
 *        the answer would leave it no way to tell.
 */
export function createPlaceResolver({ probeWater, onResolved }) {
  let seq = 0;
  let abort = null;
  let timer = null;

  function cancel() {
    clearTimeout(timer);
    timer = null;
    seq++;
    if (abort) abort.abort();
    abort = null;
  }

  async function resolve(at) {
    cancel();
    const mine = ++seq;
    const controller = new AbortController();
    abort = controller;

    const [named, wet] = await Promise.all([
      reverseGeocode(at.lon, at.lat, { signal: controller.signal }).catch((e) => {
        if (e?.name === 'AbortError') return null;
        return { status: 'unavailable' };
      }),
      /* A probe that throws is not an outage worth reporting — it is one
       * missing adjective, and `unknown` is already a handled answer. */
      Promise.resolve().then(() => probeWater?.(at)).catch(() => 'unknown'),
    ]);

    if (mine !== seq) return; // a newer point was asked about
    if (named === null) return; // aborted

    const label = named.status === 'ok' ? named.label : null;
    const water = wet === 'water' || wet === 'land' ? wet : 'unknown';

    onResolved?.(at, {
      label: label || null,
      place: placeKindFrom({
        label,
        water,
        lookupFailed: named.status === 'unavailable',
      }),
    });
  }

  return {
    /** Ask now. For a point the user just chose. */
    resolve,

    /** Ask once the pin has been still for `GEOCODE.reverseDebounceMs`. */
    soon(at) {
      cancel();
      timer = setTimeout(() => resolve(at), GEOCODE.reverseDebounceMs);
    },

    cancel,
  };
}
