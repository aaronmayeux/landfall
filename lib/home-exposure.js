/**
 * home-exposure.js — what one storm means for one address (SPEC §8).
 *
 * THE WHOLE FILE IS ONE IDEA: turn three published shapes into sentences that
 * are true about a specific house. It computes nothing about the weather. It
 * asks where home sits relative to geometry NHC already published, and picks
 * which true sentence fits.
 *
 * THREE PRODUCTS, THREE DIFFERENT SHAPES, AND THE SHAPE DECIDES THE SENTENCE:
 *
 *   Watch / warning   COASTAL BREAKPOINT LINES. Not the warned area — NHC
 *                     issues by county and marine zone and publishes a line
 *                     along the shore. So the app names the product and states
 *                     the distance to the warned coast. It NEVER says "you are
 *                     under a warning", because the geometry cannot support it.
 *   Peak surge        POLYGONS, nested by depth. Here "inside" is a real
 *                     answer, so the sentence is "your address is inside the
 *                     Up to 6 ft band" — the one place the app can be that
 *                     direct, because the shape is an area and home is in it.
 *   Wind arrival      ISOCHRONE LINES. Home sits BETWEEN two of them. The
 *                     nearest line's time, labelled as the nearest line's time.
 *                     No interpolation: §4 says arrival is fetched, never
 *                     computed, and averaging two contours is computing it.
 *
 * EVERY SLOT HAS FIVE STATES AND THERE IS NO SILENT PATH (§5). `idle` (nothing
 * asked for yet), `loading`, `unavailable` (the fetch died — say so, offer a
 * retry), `none` (the source published nothing for this storm — a real answer,
 * and a different one), and a result. "No watches in effect" and "we could not
 * reach NHC" look identical on a screen that only knows how to draw nothing,
 * and one of them is a lie.
 *
 * NOTHING HERE FETCHES, STORES OR RENDERS. Pure functions over slots the
 * caller has already filled, which is what makes the whole feature testable on
 * plain node against archived bytes. Imports config/ and lib/ only.
 */

import { HOME_THREAT } from '../config/constants.js';
import { WW_LABEL, wwCodeFromProps, wwColor, wwSortKey } from './watchwarning.js';
import { severestSurge, readSurgeFeature } from './surge.js';
import { nearestFeature, featureContaining, nmToGeometry } from './hittest.js';
import { bearingDeg } from './geo.js';

/** Slot status as it arrives from a fetch layer, normalised. A slot the caller
 *  has not filled at all is `idle` — distinct from `loading`, because one means
 *  "nobody has asked" and the other means "asked, still waiting", and only the
 *  second one earns a spinner. */
function slotState(slot) {
  if (!slot) return 'idle';
  if (slot.status === 'loading') return 'loading';
  if (slot.status === 'unavailable') return 'unavailable';
  if (slot.status === 'none') return 'none';
  if (slot.status === 'ok') return 'ok';
  return 'idle';
}

const features = (slot) => (slot && slot.fc && Array.isArray(slot.fc.features) ? slot.fc.features : []);

/* ---------------------------------------------------------------------------
 * WATCHES AND WARNINGS
 * ------------------------------------------------------------------------- */

/**
 * Which products are near home, severest first.
 *
 * ONE PRODUCT CAN BE SEVERAL FEATURES. A single Hurricane Warning is published
 * as multiple line segments; measuring each and listing them all would print
 * "Hurricane Warning" five times at five distances. Products are collapsed BY
 * CODE, keeping the NEAREST distance for each — the same dedupe-by-type rule
 * the map legend follows (§7.7), for the same reason.
 *
 * @returns {{state:string, code, label, color, nm, bearing, atHome, others}}
 */
export function watchWarningAtHome(home, slot) {
  const state = slotState(slot);
  if (state !== 'ok') return { state, code: null, label: null, color: null, nm: null, bearing: null, atHome: false, others: [] };

  /** code -> nearest hit */
  const byCode = new Map();

  for (const f of features(slot)) {
    const code = wwCodeFromProps(f && f.properties);
    if (!code) continue;
    const hit = nmToGeometry(home.lon, home.lat, f && f.geometry);
    if (!hit) continue;
    const prev = byCode.get(code);
    if (!prev || hit.nm < prev.nm) byCode.set(code, { code, nm: hit.nm, lon: hit.lon, lat: hit.lat });
  }

  /* Nothing within the "this is somebody else's warning" radius reads as
   * CLEAR, not as missing. The layer answered; the answer is that no product
   * near home is in effect, and that sentence is worth saying out loud. */
  const near = [...byCode.values()]
    .filter((h) => h.nm <= HOME_THREAT.wwNearbyNm)
    .map((h) => ({
      ...h,
      label: WW_LABEL[h.code],
      color: wwColor(h.code),
      bearing: bearingDeg(home.lon, home.lat, h.lon, h.lat),
      atHome: h.nm <= HOME_THREAT.wwAtHomeNm,
    }))
    /* SEVEREST FIRST, DISTANCE SECOND, AND THAT ORDER IS THE SAFETY RULE. A
     * Hurricane Warning 20 nm away outranks a Tropical Storm Watch 2 nm away,
     * because the headline has to be the worst thing being said about this
     * address — not the closest. wwSortKey is the same rank the map paints
     * with, so the panel and the coast can never disagree about which product
     * wins (§6). */
    .sort((a, b) => (wwSortKey(b.code) - wwSortKey(a.code)) || (a.nm - b.nm));

  if (!near.length) {
    return { state: 'clear', code: null, label: null, color: null, nm: null, bearing: null, atHome: false, others: [] };
  }

  const [lead, ...others] = near;
  return { state: lead.atHome ? 'at-home' : 'nearby', ...lead, others };
}

/* ---------------------------------------------------------------------------
 * SURGE
 * ------------------------------------------------------------------------- */

/**
 * Is home standing in a peak-surge band, and if not, how close is one?
 *
 * INSIDE IS ASKED OF EVERY BAND, NOT THE FIRST ONE THAT HITS. The bands nest:
 * a home in "Above 12 ft" is inside the four shallower polygons too. Taking
 * the first containing feature would report 3 ft to somebody facing 12, which
 * is the one direction this is not allowed to be wrong in.
 *
 * NOT IN A BAND IS A GOOD ANSWER AND IT IS SAID PLAINLY. Surge polygons stop
 * at the inundation limit; most homes in a warned county are genuinely outside
 * them. "Your address is not inside a published surge band" is information, and
 * it comes with the distance to the nearest one so it cannot be read as an
 * all-clear for the street.
 */
export function surgeAtHome(home, slot) {
  const state = slotState(slot);
  if (state !== 'ok') return { state, band: null, nm: null, bearing: null, nearest: null };

  const feats = features(slot);

  const inside = feats.filter((f) => featureContaining(home.lon, home.lat, [f]));
  if (inside.length) {
    const band = severestSurge(inside);
    /* A polygon we are standing in with no readable colour word is the one
     * case that must not fall through to "outside": home IS in a published
     * band and only the depth is unknown. Said as exactly that. */
    return { state: band ? 'in-band' : 'in-band-unclassified', band, nm: 0, bearing: null, nearest: null };
  }

  const hit = nearestFeature(home.lon, home.lat, feats);
  if (!hit) return { state: 'none', band: null, nm: null, bearing: null, nearest: null };

  const nearest = readSurgeFeature(hit.feature);
  if (hit.nm <= HOME_THREAT.surgeNearbyNm) {
    return {
      state: 'near',
      band: null,
      nm: hit.nm,
      bearing: bearingDeg(home.lon, home.lat, hit.lon, hit.lat),
      nearest,
    };
  }
  return { state: 'outside', band: null, nm: hit.nm, bearing: null, nearest };
}

/* ---------------------------------------------------------------------------
 * WIND ARRIVAL
 * ------------------------------------------------------------------------- */

/** The `arrival_time` string NHC stamps on each isochrone. Confirmed as a
 *  FIELD on layer 19 (`Most Likely Arrival Time`) 2026-08-09, off the service's
 *  own field list. Its FORMAT is unread — no storm was active — so it is
 *  carried through as the string NHC published and rendered as text, never
 *  parsed into a Date. A time we cannot parse is still a time NHC wrote; a
 *  time we parse wrongly is a lie with a clock face on it. */
function arrivalText(props) {
  for (const field of ['arrival_time', 'popupinfo', 'snippet', 'name']) {
    const v = props && props[field];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * The nearest arrival contour and what it says.
 *
 * NOT INTERPOLATED, EVER (§4: fetched, never computed). Home lies between two
 * isochrones and the true statement available is the nearest line's own time,
 * labelled with its distance so the reader can see how much it is speaking for
 * them. Past `arrivalNearNm` the app says nothing rather than something
 * invented — a contour 200 nm away is a fact about a different coastline.
 */
export function arrivalAtHome(home, slot) {
  const state = slotState(slot);
  if (state !== 'ok') return { state, text: null, nm: null, bearing: null };

  const hit = nearestFeature(home.lon, home.lat, features(slot));
  if (!hit) return { state: 'none', text: null, nm: null, bearing: null };

  if (hit.nm > HOME_THREAT.arrivalNearNm) {
    return { state: 'far', text: null, nm: hit.nm, bearing: null };
  }

  const text = arrivalText(hit.feature && hit.feature.properties);
  if (!text) return { state: 'none', text: null, nm: hit.nm, bearing: null };

  return {
    state: 'ok',
    text,
    nm: hit.nm,
    bearing: bearingDeg(home.lon, home.lat, hit.lon, hit.lat),
  };
}

/* ---------------------------------------------------------------------------
 * THE ONE NUMBER THE GLOBE WEARS
 * ------------------------------------------------------------------------- */

/**
 * Severity level 0–4 for the home marker, and the colour that goes with it.
 *
 * ==> THE COLOUR IS ALWAYS A §6 FIXED COLOUR, NEVER A THEME COLOUR. <== The
 * house wears the colour of the exact product being reported about it — the
 * NWS product colour for a watch or warning, the NHC surge ramp colour for a
 * band. Someone who saw a Hurricane Warning on television and then opens this
 * app must see the same red. That is the whole point of §6.1 and it is why
 * this function returns a colour rather than a level for the CSS to interpret.
 *
 * SURGE OUTRANKS WIND AT THE TOP AND ONLY AT THE TOP. A wind product is about
 * a threshold being crossed somewhere on the coast; a surge band is water in
 * a specific place, and the specific place is this house. So a home standing
 * in a 9 ft band leads over a Hurricane Warning whose nearest breakpoint is
 * 20 nm up the shore. Below that, wind leads, because a warning covering
 * home's area is a stronger claim than a surge band two streets over.
 */
export function exposureLevel({ ww, surge }) {
  const wwLevel = (() => {
    if (!ww || (ww.state !== 'at-home' && ww.state !== 'nearby')) return 0;
    const base = { HWR: 4, HWA: 3, TWR: 3, TWA: 2 }[ww.code] || 0;
    /* A product NEAR home rather than covering it drops a step. It is real and
     * it is worth a mark on the globe; it is not the same claim. */
    return ww.state === 'at-home' ? base : Math.max(1, base - 1);
  })();

  const surgeLevel = (() => {
    if (!surge) return 0;
    if (surge.state === 'in-band') return surge.band && surge.band.index >= 2 ? 4 : 3;
    if (surge.state === 'in-band-unclassified') return 3;
    if (surge.state === 'near') return 2;
    return 0;
  })();

  const level = Math.max(wwLevel, surgeLevel);
  if (!level) return { level: 0, color: null, source: null };

  const surgeWins = surgeLevel > wwLevel || (surgeLevel === wwLevel && surgeLevel === 4 && surge.state === 'in-band');

  if (surgeWins && surge.band) return { level, color: surge.band.color, source: 'surge' };
  if (ww && ww.color) return { level, color: ww.color, source: 'watch-warning' };
  return { level, color: null, source: surgeWins ? 'surge' : 'watch-warning' };
}

/**
 * Everything the home panel and the home marker need for ONE storm.
 *
 * @param {{lon:number, lat:number}} home
 * @param {object} slots  {watchWarning, surge, arrivalLikely, arrivalEarliest}
 * @param {object} [meta] {observedAt, advisoryKey, stormId, stormName}
 *
 * THE STAMP RIDES ALONG, AS ONE OBJECT (§8). There is no way to read a figure
 * out of this without its advisory age attached, because they are the same
 * return value — the same structural enforcement `distanceTo` and
 * `closestApproach` already carry. A surge band from a six-hour-old advisory
 * is a six-hour-old surge band and the panel has to be able to say so.
 */
export function homeExposure(home, slots = {}, meta = {}) {
  if (!home || !Number.isFinite(home.lon) || !Number.isFinite(home.lat)) return null;

  const ww = watchWarningAtHome(home, slots.watchWarning);
  const surge = surgeAtHome(home, slots.surge);
  const likely = arrivalAtHome(home, slots.arrivalLikely);
  const earliest = arrivalAtHome(home, slots.arrivalEarliest);
  const { level, color, source } = exposureLevel({ ww, surge });

  return {
    stormId: meta.stormId || null,
    stormName: meta.stormName || null,
    ww,
    surge,
    arrival: { likely, earliest },
    level,
    color,
    source,
    observedAt: meta.observedAt || null,
    advisoryKey: meta.advisoryKey || null,
  };
}

/**
 * The severest exposure across every storm on the board — what the marker on
 * the globe wears.
 *
 * TIES BREAK ON THE NEARER PRODUCT. Two storms both putting home under a
 * Hurricane Watch is not a case that needs an opinion about which storm
 * matters; the one whose warned coast is closer is the one the mark is about.
 */
export function worstExposure(list) {
  let best = null;
  for (const e of list || []) {
    if (!e || !e.level) continue;
    if (!best || e.level > best.level) { best = e; continue; }
    if (e.level === best.level) {
      const a = Number.isFinite(e.ww && e.ww.nm) ? e.ww.nm : Infinity;
      const b = Number.isFinite(best.ww && best.ww.nm) ? best.ww.nm : Infinity;
      if (a < b) best = e;
    }
  }
  return best;
}

/**
 * The one short sentence the home marker's screen-reader label carries.
 *
 * ==> COLOUR IS NEVER THE ONLY CARRIER (§6, WCAG). <== The ring on the globe
 * says something is in effect; this says WHAT, in words, on the button itself.
 * Somebody who cannot tell Hurricane Watch pink from Hurricane Warning red — or
 * who is listening rather than looking — gets the product name from the control
 * they are focused on rather than from a colour they cannot read.
 *
 * IT NAMES THE PRODUCT, NEVER THE SEVERITY LEVEL. "Level 4" is our number and
 * means nothing to anyone; "Hurricane Warning" is NHC's and means exactly one
 * thing. Returns null when there is nothing in effect, and the caller puts the
 * plain label back.
 */
export function exposureLabel(exposure) {
  if (!exposure || !exposure.level) return null;

  if (exposure.source === 'surge' && exposure.surge) {
    if (exposure.surge.state === 'in-band' && exposure.surge.band) {
      return `storm surge ${exposure.surge.band.label}`;
    }
    if (exposure.surge.state === 'in-band-unclassified') return 'inside a storm surge band';
    if (exposure.surge.state === 'near') return 'near a storm surge band';
  }

  const ww = exposure.ww;
  if (ww && ww.label) {
    return ww.state === 'at-home' ? ww.label : `${ww.label} nearby`;
  }
  return null;
}
