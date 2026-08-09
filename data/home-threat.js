/**
 * home-threat.js — the at-home exposure state, for the panel and the marker.
 *
 * ONE PLACE ANSWERS "WHAT IS BEING SAID ABOUT MY ADDRESS", and both surfaces
 * read it. The home view needs the sentences; the floating house on the globe
 * needs one level and one colour. Computing that twice would be two answers to
 * one question, free to drift — and drift here means the globe saying a
 * Hurricane Warning while the panel says a watch (§6 is a safety contract).
 *
 * WHAT IT ORCHESTRATES, AND WHY EACH PIECE COMES FROM WHERE IT DOES:
 *   watch/warning  ALREADY FETCHED. It is layer 8 of the selection bundle the
 *                  map draws the coastal paint from, so this reads the bundle
 *                  rather than asking NHC a second time for bytes already in
 *                  memory. The panel and the painted coast are then literally
 *                  the same features.
 *   surge          fetched by PLACE (`data/surge.js`) — the service has no
 *                  storm id, so it cannot ride in a per-storm bundle.
 *   wind arrival   fetched per storm on demand (`fetchWindArrival`), NOT in
 *                  the selection bundle: two more queries on every tap, for
 *                  geometry that draws nothing and that a reader with no home
 *                  set can never see, is a cost paid by everybody for a few.
 *
 * ==> ONLY STORMS THAT COULD POSSIBLY BE ABOUT HOME ARE FETCHED FOR. <== A
 * typhoon off Guam has a watch/warning layer and a wind-arrival product, and
 * neither is a fact about a house in Louisiana. Storms are filtered to
 * `APPROACH.relevanceNm` of home and then capped at the three nearest, so the
 * work is bounded by geography and by a number rather than by how busy the
 * season is. A ten-storm day costs the same as a three-storm one.
 *
 * ==> IT IS NEVER SILENT ABOUT ITS OWN FAILURE (§5). <== Every slot carries
 * `loading` / `ok` / `none` / `unavailable` separately, all the way to the
 * panel. A surge fetch that died and a coast with no surge product published
 * are different sentences, and the difference is exactly the one this app
 * exists not to blur.
 *
 * No DOM, no map. Imports config/, lib/, data/.
 */

import { APPROACH } from '../config/constants.js';
import { homeExposure, worstExposure } from '../lib/home-exposure.js';
import { getHome, subscribeHome, greatCircleNm } from './home.js';
import { fetchSurge, forgetSurge } from './surge.js';
import { fetchWindArrival } from './nhc-mapserver.js';

/** How many storms may be evaluated at once. Three is not a performance
 *  guess — it is how many storms can plausibly be making a claim about ONE
 *  address at the same time. A fourth is a storm in another ocean. */
const MAX_STORMS = 3;

/* --- state ---------------------------------------------------------------- */

let state = { status: 'no-home', exposures: [], worst: null, home: null };
const listeners = new Set();

/** Per-storm arrival slots, keyed by storm id + advisory. Arrival isochrones
 *  are republished each advisory, so the advisory key is part of the identity —
 *  holding them by storm id alone would show yesterday's arrival time under
 *  today's advisory stamp, which is the §8 rule about figures carrying their
 *  own age broken at the source. */
const arrivalHeld = new Map();

function publish() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      console.warn('[landfall] home-threat listener threw', e);
    }
  }
}

function setState(next) {
  state = next;
  publish();
}

/** Fires immediately with the current state, same contract as
 *  `subscribeHome` — a surface that mounts late must not wait for a change. */
export function subscribeHomeThreat(fn) {
  listeners.add(fn);
  try {
    fn(state);
  } catch (e) {
    console.warn('[landfall] home-threat listener threw', e);
  }
  return () => listeners.delete(fn);
}

export function getHomeThreat() {
  return state;
}

/* --- the arrival slot ----------------------------------------------------- */

async function arrivalSlots(storm, advisoryKey) {
  /* GDACS storms have no bin and no MapServer geometry at all, so there is no
   * arrival product to fetch. `idle` rather than `unavailable`: nothing failed,
   * the source simply does not publish this, and the panel says so in words
   * that do not accuse NHC of being down. */
  if (!storm || storm.source !== 'nhc') {
    return { arrivalLikely: { status: 'idle' }, arrivalEarliest: { status: 'idle' } };
  }

  const key = `${storm.id}@${advisoryKey || ''}`;
  const held = arrivalHeld.get(key);
  if (held) return held;

  try {
    const { layers } = await fetchWindArrival(storm);
    arrivalHeld.set(key, layers);
    /* One storm's worth of history is all that is useful; the map holds twelve
     * bundles but nothing ever reads an arrival slot for a storm that is not
     * currently near home. Bounded here rather than by an LRU nobody tunes. */
    if (arrivalHeld.size > MAX_STORMS * 2) {
      const oldest = arrivalHeld.keys().next().value;
      arrivalHeld.delete(oldest);
    }
    return layers;
  } catch (e) {
    return {
      arrivalLikely: { status: 'unavailable', error: e?.message || 'failed' },
      arrivalEarliest: { status: 'unavailable', error: e?.message || 'failed' },
    };
  }
}

/* --- the pass ------------------------------------------------------------- */

let pass = 0;

/**
 * Recompute the whole at-home picture.
 *
 * @param {Array} storms       the merged storm list
 * @param {(id:string)=>object|null} bundleFor  the held geometry bundle
 *
 * ==> A STALE PASS MAY NOT PUBLISH. <== Two fetches are in flight per storm and
 * a new storm list can land while they are out. Every pass takes a sequence
 * number and drops its own result if a later one started — otherwise a slow
 * surge fetch from the previous advisory overwrites the current one, and the
 * only visible symptom is a figure that is quietly one cycle old.
 */
export async function updateHomeThreat(storms, bundleFor) {
  const home = getHome();
  if (!home) {
    arrivalHeld.clear();
    setState({ status: 'no-home', exposures: [], worst: null, home: null });
    return;
  }

  const seq = ++pass;

  const near = (storms || [])
    .filter((s) => s && Number.isFinite(s.lon) && Number.isFinite(s.lat))
    .map((s) => ({ s, nm: greatCircleNm(home.lon, home.lat, s.lon, s.lat) }))
    .filter((r) => r.nm <= APPROACH.relevanceNm)
    .sort((a, b) => a.nm - b.nm)
    .slice(0, MAX_STORMS);

  if (!near.length) {
    setState({ status: 'ready', exposures: [], worst: null, home });
    return;
  }

  setState({ ...state, status: 'loading', home });

  const exposures = await Promise.all(
    near.map(async ({ s }) => {
      const bundle = (bundleFor && bundleFor(s.id)) || null;
      const layers = (bundle && bundle.layers) || {};

      /* The bundle has not landed yet — the map is still fetching it. That is
       * `loading`, not `none`: the panel shows a waiting row rather than
       * announcing that no watches are in effect for a storm nobody has
       * finished asking about. */
      const watchWarning = layers.watchWarning || { status: bundle ? 'idle' : 'loading' };

      const [surge, arrival] = await Promise.all([
        fetchSurge(s.lon, s.lat),
        arrivalSlots(s, s.advisoryKey),
      ]);

      return homeExposure(
        home,
        {
          watchWarning,
          surge,
          arrivalLikely: arrival.arrivalLikely,
          arrivalEarliest: arrival.arrivalEarliest,
        },
        {
          stormId: s.id,
          stormName: s.name || null,
          observedAt: s.observedAt || null,
          advisoryKey: s.advisoryKey || null,
        }
      );
    })
  );

  if (seq !== pass) return; // a newer pass started while we were out

  const list = exposures.filter(Boolean);
  setState({ status: 'ready', exposures: list, worst: worstExposure(list), home });
}

/** Throw away everything held and recompute. The retry button behind an
 *  `unavailable` row, and the path a changed home takes. */
export function retryHomeThreat(storms, bundleFor) {
  forgetSurge();
  arrivalHeld.clear();
  return updateHomeThreat(storms, bundleFor);
}

/* A CHANGED HOME INVALIDATES EVERY ANSWER IN THIS MODULE, and it is wired here
 * rather than in main.js so it cannot be forgotten by a future caller. The
 * recompute itself needs the storm list, which this module does not hold — so
 * the subscription clears held state and marks the picture stale, and the next
 * `updateHomeThreat` from the app's own storm subscription does the work. */
subscribeHome((h) => {
  forgetSurge();
  arrivalHeld.clear();
  if (!h) setState({ status: 'no-home', exposures: [], worst: null, home: null });
});
