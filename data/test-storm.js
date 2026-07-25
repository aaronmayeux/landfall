/**
 * test-storm.js — a synthetic storm injected from the URL (DEV ONLY).
 *
 * ==> THIS IS TEMPORARY. HOW TO RIP IT OUT, IN FULL <==
 *
 *   1. delete this file
 *   2. in data/store.js delete the `import { testStorms }` line
 *   3. in data/store.js change the one line in emit() back to:
 *        state.storms = mergeStorms(lastGood.nhc, lastGood.gdacs);
 *
 * That is the entire footprint. Nothing else in the app was touched, and
 * nothing else imports this file. Grep `testStorms` to prove it.
 *
 * ==> WHAT IT IS FOR <==
 *
 * The satellite imagery knockout (SPEC §4) has two thresholds set by eye, and
 * they can only be tuned against a REAL frame over a REAL place. Waiting for a
 * hurricane to park itself somewhere convenient is not a plan. This drops a
 * fake storm at any coordinate so the imagery pipeline addresses a real
 * satellite, pulls a real frame, and paints it on the globe exactly as it would
 * for a live storm.
 *
 * ==> WHY A URL PARAM AND NOT A CONSTANT <==
 *
 * It is off for everyone by default, it needs no deploy to move the storm, and
 * the link is bookmarkable on a phone — which is where this has to be checked.
 * A constant would mean a push-and-wait per coordinate.
 *
 * ==> WHY source:'test' AND NOT source:'nhc' <==
 *
 * The app already treats an unknown source as "nothing to ask for, not a
 * breakage" in both the geometry path (main.js) and the advisory path
 * (data/advisory.js), and data/warm.js only warms nhc/gdacs. So a test storm
 * draws its marker and its imagery disc and asks NO endpoint for a track, a
 * cone, or advisory text — which is correct, because there aren't any. Tapping
 * it shows a detail panel with empty geometry. That is the honest result, not
 * a bug.
 *
 * No DOM beyond reading location.search. Imports: lib/ only.
 */

import { categoryFromKt } from '../lib/category.js';

/** The query parameter. Repeat it for more than one storm. */
const PARAM = 'teststorm';

/** Named shortcuts, so a phone doesn't have to type coordinates. */
const PRESETS = Object.freeze({
  lavaca: { lat: 28.6150, lon: -96.6261, name: 'Port Lavaca' },
  houston: { lat: 29.7604, lon: -95.3698, name: 'Houston' },
  miami: { lat: 25.7617, lon: -80.1918, name: 'Miami' },
});

/** Knots. 85 kt derives to category index 3, which is Category 2 — strong
 *  enough to get a loud marker, which is the point of looking at it. */
const TEST_WIND_KT = 85;

/** One spec string -> one storm, or null. Accepts:
 *    ?teststorm=lavaca
 *    ?teststorm=28.615,-96.626
 *    ?teststorm=28.615,-96.626,Some Name
 */
function parseOne(spec, index) {
  const raw = String(spec || '').trim();
  if (!raw) return null;

  let lat;
  let lon;
  let name;

  const preset = PRESETS[raw.toLowerCase()];
  if (preset) {
    ({ lat, lon, name } = preset);
  } else {
    const parts = raw.split(',');
    lat = Number(parts[0]);
    lon = Number(parts[1]);
    name = (parts.slice(2).join(',') || '').trim() || 'Test';
  }

  /* A bad coordinate produces NOTHING, never a storm at 0,0 in the Gulf of
   * Guinea that looks real. */
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    id: `test:${index}`,
    source: 'test',
    sourceId: `test-${index}`,
    /* NAMED SO IT CAN NEVER BE MISTAKEN FOR REAL. It sorts and renders beside
     * live storms; the label is the only thing stopping a screenshot of this
     * from reading as an actual hurricane over Texas. */
    name: `TEST — ${name}`,
    basin: 'atlantic',

    lat,
    lon,

    windKt: TEST_WIND_KT,
    pressureMb: null,
    headingDeg: null,
    speedKt: null,

    nature: 'tropical',
    category: categoryFromKt(TEST_WIND_KT),
    categorySource: 'derived',

    observedAt: null,
    /* Stable across polls on purpose: a key that changed every 30 minutes
     * would churn every cache keyed on it. */
    advisoryKey: `test:${index}:static`,

    /* Nothing is real except the position, so nothing is offered. Every layer
     * toggle stays honest (§7) and no endpoint is asked for a storm that does
     * not exist. */
    can: {
      cone: false, forecastTrack: false, forecastPoints: false,
      pastTrack: false, watchWarning: false,
      windRadii: false, surge: false, models: false, windBands: false,
    },

    raw: { test: true },
  };
}

/**
 * Synthetic storms for this page load. Empty array when the parameter is
 * absent, which is every normal visit.
 */
export function testStorms() {
  if (typeof location === 'undefined') return [];
  const specs = new URLSearchParams(location.search).getAll(PARAM);
  return specs.map(parseOne).filter(Boolean);
}
