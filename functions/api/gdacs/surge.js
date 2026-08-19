/**
 * /api/gdacs/surge?eventid=1001303 — modelled storm surge at named towns,
 * anywhere on Earth. §51.1, §51.2.
 *
 * ==> THE PRODUCT NAMED "SURGE" IN THE GDACS API IS NOT THIS ONE, AND READING
 *     THE WRONG ONE COSTS A SESSION. <== Measured off the archive branch
 * 2026-08-19, three live storms. The event record carries a `cyclonesurge`
 * index: three models, one row per bulletin, each row flagged `last` and
 * `overall`. Every one of those rows resolves to a `getdetails` card that
 * arrives with `geometry: null`, `bbox: null`, one headline `maxheight`, and
 * links. There are no places in it and no shapes in it.
 *
 * The product with the answer in it hangs off `impacts` on the same record:
 * `getlocations`, one export per storm, model-agnostic and already aggregated
 * across every bulletin ("Simulation based on Bulletins 1-29", read verbatim
 * out of Lala's header). That is what this route fetches, and it is why the
 * first hop is `geteventdata` rather than anything with "surge" in its name.
 *
 * ==> THE TWO PRODUCTS DISAGREE AND ONLY ONE MAY REACH A SCREEN. <== Lala's
 * `getlocations` header states 0.17 m at Hookena as the worst POPULATED place;
 * its ECMWF card states `maxheight: 0.330424815416`. Both are true of
 * different questions. This route serves the towns and never the card's
 * number, so the app cannot show two surge heights for one storm.
 *
 * ==> IT WORKS ON BOTH SOURCES, WHICH IS THE POINT. <== Lala is NOAA-sourced
 * and returned 47 towns; Saudel is JTWC-sourced and returned two. The export
 * is byte-identical in structure across the two — same twelve property keys,
 * same header feature, same description grammar — so there is one parser and
 * not two, and this reaches storms no American product ever will.
 *
 * ==> `-1` AND AN EMPTY LIST ARE TWO DIFFERENT ANSWERS AND NEITHER IS AN
 *     ERROR. <== Hernán, mid-Pacific, returned its header feature and no towns
 * at all, with a card `maxheight` of `-1`. That is `none_matched`: the model
 * ran and found nobody. A fetch that fails is `unavailable`. Collapsing those
 * two would put "no surge expected" under a house during an outage, which is
 * the §5 failure this whole app is built against.
 *
 * ==> THIS IS A PROJECTION, NOT LOGIC (§4.3). <== It picks fields and drops
 * fields. It does not convert units, sort by distance, decide what is near a
 * house, or write a sentence — `lib/surge-locations.js` does the first three
 * and `ui/surge-home.js` the last, both testable with no browser.
 *
 * Pages Functions have no access to this project's config (§4.13), so the
 * numbers below mirror `GDACS_SURGE` and `ENDPOINT.gdacsEventData` by hand and
 * say so.
 */

import { CACHE_PATH, CACHE_PATH_HEADER } from '../_cache-path.js';

const EVENT_DATA = 'https://www.gdacs.org/gdacsapi/api/events/geteventdata';

/** Mirrors `GDACS_SURGE.maxPlaces`. Lala's export is 47 towns and 27 KB, which
 *  is fine on the wire and impossible on a screen. The DEEPEST are kept,
 *  because the deepest answer every question anybody asks of this product. */
const MAX_PLACES = 60;

/** Mirrors `GDACS_SURGE.noHeightSentinel`. A negative water height is an
 *  absence wearing a number. */
const NO_HEIGHT = -1;

/* --------------------------------------------------------------------------
 * CACHE
 *
 * ==> AN HOUR, AND IT IS SET BY HOW OFTEN THE MODEL RUNS. <== A JRC surge
 * simulation is redone per bulletin at best — measured, Lala's ECMWF index sat
 * at bulletin 15 while its GFS index sat at 29 at the same instant, so the
 * slower model was half a day behind its own storm. Nothing in this payload
 * expires, unlike the flood warnings that set the rainfall route's fifteen
 * minutes, so an hour cannot go far wrong.
 *
 * LAST-GOOD 12 H. Twice the rainfall route's window, for the same reason the
 * fresh window is four times as long: a surge simulation twelve hours old is
 * still the most recent one there is on many storms, and a blank section is
 * the one thing §5 forbids.
 * ----------------------------------------------------------------------- */
const FRESH_SECONDS = 60 * 60;
const STALE_SECONDS = 12 * 60 * 60;

/** Two hops share this, so it is per-hop. */
const UPSTREAM_TIMEOUT_MS = 10_000;

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...extra,
});

const json = (obj, status, extra) =>
  new Response(JSON.stringify(obj), { status, headers: jsonHeaders(extra) });

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The event record → the `getlocations` URL, or null.
 *
 * ==> ONLY A GDACS URL IS EVER FOLLOWED. <== This route takes an event id from
 * the open internet and then fetches a URL found inside somebody else's JSON.
 * Without this test that is a request forwarder pointed at any host a
 * compromised or mistaken upstream cares to name. The host check is the guard.
 */
export function locationsUrl(record) {
  const impacts = record?.properties?.impacts;
  if (!Array.isArray(impacts)) return null;
  for (const im of impacts) {
    const url = im?.resource?.locations;
    if (typeof url === 'string' && url.startsWith('https://www.gdacs.org/')) return url;
  }
  return null;
}

/**
 * The `getlocations` export → the body this route serves.
 *
 * ==> THE FIRST FEATURE IS NOT A TOWN AND MUST BE DROPPED. <== Every export in
 * the archive opens with a header feature sitting at the storm's own position,
 * carrying `city: null` and a `description` blob of simulation metadata. Kept,
 * it would render as an unnamed place in the middle of the ocean with no
 * height, which is exactly the shape of a bug. The `city` test is what
 * separates them, and it is the source's own distinction rather than an
 * ordering assumption — Hernán's export is the header ALONE, and reading "the
 * first one is metadata, the rest are towns" would have been right there by
 * accident and wrong the moment an export arrives ordered differently.
 *
 * ==> `timearrival` AND `timemaxh` ARE OFFSETS, NOT CLOCK TIMES. <== They read
 * `"87:00"` and `"93:00"` — hours and minutes from the storm's FIRST bulletin,
 * whose publication time the header names. They are carried through as the
 * hours they are and turned into a real instant nowhere in this route, because
 * the base is on the header feature and resolving it is arithmetic (§4.3).
 *
 * Pure: no fetch, no cache, no clock.
 */
export function projectLocations(fc) {
  const feats = Array.isArray(fc?.features) ? fc.features : [];
  const places = [];

  for (const f of feats) {
    const p = f?.properties || {};
    if (!p.city) continue;

    const height = Number(p.maxheight);
    /* A town whose height did not parse, or came back at the sentinel, is not
     * a town with a small surge — it is a row we cannot state. Dropped rather
     * than shown at zero. */
    if (!Number.isFinite(height) || height <= NO_HEIGHT) continue;

    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    places.push({
      city: String(p.city),
      country: p.country ? String(p.country) : null,
      heightM: height,
      lat,
      lon,
      arrivalHours: hoursFrom(p.timearrival),
      peakHours: hoursFrom(p.timemaxh),
    });
  }

  places.sort((a, b) => b.heightM - a.heightM);

  return {
    status: 'ok',
    /* The count BEFORE the cap, so a reader of this payload can tell a storm
     * with sixty towns from a storm with six hundred. */
    placeCount: places.length,
    places: places.slice(0, MAX_PLACES),
  };
}

/** `"87:00"` → `87`. Minutes are carried by the source and discarded here:
 *  every value in the archive is on the hour, and a surge arrival stated to
 *  the minute four days out claims a precision no model has. */
export function hoursFrom(text) {
  const m = /^(\d+):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const eventId = String(url.searchParams.get('eventid') || '');

  /* Digits only. This value is concatenated into an upstream URL. */
  if (!/^\d{1,12}$/.test(eventId)) {
    return json({ error: 'bad_event', detail: 'eventid must be a number' }, 400);
  }

  const cache = caches.default;
  const key = `https://landfall-relay.internal/gdacs/surge/${eventId}`;
  const freshKey = new Request(`${key}/fresh`);
  const lastGoodKey = new Request(`${key}/last-good`);

  const hit = await cache.match(freshKey);
  if (hit) {
    return json(await hit.json(), 200, {
      'X-Landfall-Fetched-At': hit.headers.get('X-Landfall-Fetched-At') || '',
      [CACHE_PATH_HEADER]: CACHE_PATH.FRESH,
    });
  }

  let upstreamError;
  try {
    const record = await getJson(`${EVENT_DATA}?eventtype=TC&eventid=${eventId}`);
    const locations = locationsUrl(record);

    /* ==> NO EXPORT IS `none_matched`, NOT A FAILURE. <== Hernán's card
     * carried no `locations` key at all while the storm sat mid-ocean. The
     * model has nothing to say about populated places because there are none;
     * that is an answer about the world, and putting a Retry button under it
     * would offer a reader a button that can never work (§48.5's rule, same
     * shape). */
    const body = locations
      ? projectLocations(await getJson(locations))
      : { status: 'none_matched', placeCount: 0, places: [] };

    const fetchedAt = new Date().toISOString();
    const text = JSON.stringify(body);
    const headers = {
      'X-Landfall-Fetched-At': fetchedAt,
      [CACHE_PATH_HEADER]: CACHE_PATH.UPSTREAM,
    };

    context.waitUntil(Promise.all([
      cache.put(freshKey, new Response(text, {
        headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${FRESH_SECONDS}` },
      })),
      cache.put(lastGoodKey, new Response(text, {
        headers: { ...jsonHeaders(headers), 'Cache-Control': `s-maxage=${STALE_SECONDS}` },
      })),
    ]));

    return json(body, 200, headers);
  } catch (e) {
    upstreamError = e;
  }

  const stale = await cache.match(lastGoodKey);
  if (stale) {
    return json(await stale.json(), 200, {
      'X-Landfall-Fetched-At': stale.headers.get('X-Landfall-Fetched-At') || '',
      'X-Landfall-Stale': 'true',
      [CACHE_PATH_HEADER]: CACHE_PATH.LAST_GOOD,
    });
  }

  return json(
    { error: 'surge_unreachable', detail: String(upstreamError?.message || upstreamError) },
    502
  );
}
