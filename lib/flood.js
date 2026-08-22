/**
 * flood.js — NWS flood alerts, read. SPEC §48.21.
 *
 * Pure. No DOM, no network, no clock of its own — every function that needs
 * "now" is handed it, for the same reason `lib/rainfall.js` is: an expiry check
 * against `Date.now()` can only be tested during an actual flood warning, and
 * the one captured set of live alerts this project has is from August.
 *
 * ==> THE HARD PROBLEM HERE IS NOT PARSING, IT IS ATTRIBUTION. <== An NWS flood
 * warning does not name a storm. It says *Flash Flood Warning, Hawaii in
 * Hawaii, HI* and nothing else — the hurricane sitting on top of it is not
 * mentioned anywhere in the product. So any row this app puts under a storm's
 * name is this app asserting a connection the source never made, which is
 * exactly what §50.3 forbids for the CAP list: **a geographic match is not a
 * causal claim.**
 *
 * What is claimed here is therefore the weakest true thing: **this alert's area
 * overlaps this storm's forecast cone.** That is a statement about two shapes,
 * verifiable from the shapes, and it makes no assertion about cause. The UI is
 * required to word it that way (§48.21) — "inside the forecast cone", never
 * "caused by" and never "this storm's flooding".
 *
 * ==> AND A STORM CAN BE INNOCENT. <== A stalled front can flood a county while
 * the hurricane on screen goes out to sea, and both can be inside one cone. The
 * wording is the only defence and it has to hold on its own.
 *
 * Imports: config/ and lib/ only.
 */

import { RAIN } from '../config/constants.js';
import { remainingWords } from './rainfall.js';

/* ---------------------------------------------------------------------------
 * WHAT IS IN FORCE
 * ------------------------------------------------------------------------- */

/**
 * Alerts still in force at `nowMs`, immediate ones first.
 *
 * ==> THE EXPIRY FILTER IS APPLIED AT RENDER AND NOT ONLY AT FETCH. <== §48.6.
 * A flash flood warning is routinely shorter-lived than one poll interval —
 * Hilo's ran 52 minutes — so a payload held for even three minutes can contain
 * a warning that has run out. On a list that is a wrong sentence; on a map it
 * is a shape telling somebody they are in danger when they are not.
 *
 * `ends` outranks `expires` when both are present and disagree: one is when the
 * message goes stale, the other is when the weather does.
 *
 * ==> NO EVENT FILTER HERE, UNLIKE `floodAlerts()` IN `lib/rainfall.js`. <==
 * That function reads a payload containing every hazard in force at a point and
 * has to pick the flood family out of hurricane warnings and surf advisories.
 * This one reads a route that asked the upstream for three named products by
 * name, so everything in it is already the flood family. Filtering again would
 * be a second copy of a rule that would then have to be kept in step.
 */
export function inForce(alerts, nowMs) {
  const out = [];
  for (const a of alerts || []) {
    const until = Date.parse(a?.ends || a?.expires || '');
    if (Number.isFinite(until) && until <= nowMs) continue;

    const onset = Date.parse(a?.onset || '');
    out.push({
      ...a,
      /* ==> RENAMED TO WHAT THE ROW BUILDER READS, AND THIS WAS A REAL BUG.
       * <== `ui/rain-alerts.js` is shared with the house block (§48.20) and
       * reads `area` and `remaining`. The relay projects NWS's own field name,
       * `areaDesc`, and carries no duration at all — so the first render of
       * this block printed the event and the expiry and silently dropped BOTH
       * the affected area and the time left. Nothing threw and the row looked
       * finished. Caught by rendering it, not by a unit test of the parser.
       *
       * Mapped here rather than in the relay: the relay's job is to pass NWS's
       * fields through under NWS's names (§4.3), and the shape a UI component
       * wants is a client concern. */
      area: a?.areaDesc || null,
      untilMs: Number.isFinite(until) ? until : null,
      onsetMs: Number.isFinite(onset) ? onset : null,
      remaining: remainingWords(until, nowMs),
      /* ==> THE TENSE COMES FROM THE CLOCK, NEVER FROM `urgency` (§48.20).
       * <== The captured Flood Watch reads `urgency: Future` with an `onset`
       * four hours in the PAST, because the urgency is about when the HAZARD
       * is expected and the onset is about when the MESSAGE took effect. */
      begun: !Number.isFinite(onset) || onset <= nowMs,
      immediate: a?.urgency === 'Immediate',
    });
  }
  /* Immediate first, then soonest to end — a warning with twenty minutes left
   * is more use above one with eighteen hours. */
  out.sort((a, b) =>
    Number(b.immediate) - Number(a.immediate) ||
    (a.untilMs ?? Infinity) - (b.untilMs ?? Infinity));
  return out;
}

/* ---------------------------------------------------------------------------
 * WHERE IT IS
 * ------------------------------------------------------------------------- */

/**
 * A shape's extent: a latitude band plus one or TWO longitude spans.
 *
 * ==> TWO SPANS, BECAUSE A CONE CAN CROSS THE ANTIMERIDIAN AND THE FIRST CUT
 * OF THIS FUNCTION SAID THE WHOLE PLANET. <== Measured on Lala's real cone off
 * the archive (`nhc-Lala-CP2-cone.geojson`, a Central Pacific storm at 30N
 * 172W): a plain min/max bounding box came out as **-180 to 180**, because her
 * ring has vertices on both sides of the seam. A box that wide overlaps every
 * flood alert in the United States, so every storm in the Central Pacific would
 * have claimed every flood warning in the country — a confident wrong answer,
 * with no exception thrown and nothing on screen looking odd. The app already
 * carries `lib/seam-stitch.js` for the drawing side of this same seam; this is
 * the measuring side.
 *
 * A span wider than 180 degrees is taken as a crossing rather than as a genuine
 * hemisphere-wide shape. No cone or county warning is ever that wide, and the
 * failure directions are not symmetric: reading a crossing as a global box
 * matches everything, while reading a genuinely wide box as a crossing matches
 * slightly less. Neither is common; only one is catastrophic.
 *
 * ==> AND IT IS A BOX RATHER THAN THE POLYGON ITSELF, WHICH IS A CHOICE ABOUT
 * WHICH WAY TO BE WRONG. <== A true polygon intersection answers a question
 * nobody is asking: the cone is an uncertainty envelope that is already
 * approximate, and the alert is a box a forecaster drew by hand around a
 * county. Matching extents overstates the overlap slightly and in ONE
 * direction — toward including an alert just outside the cone, never toward
 * dropping one just inside. On a hazard surface that is the direction to be
 * wrong in, and it is the same reasoning §48.19 uses to keep a partly-elapsed
 * rainfall block rather than prorate it.
 *
 * @returns {{south:number, north:number, lon:Array<[number,number]>}|null}
 */
export function extent(geometry) {
  const rings = [];
  if (geometry?.type === 'Polygon') rings.push(...(geometry.coordinates || []));
  else if (geometry?.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) rings.push(...(poly || []));
  } else return null;

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  /* The same points measured in 0..360, so a crossing shape has a NARROW span
   * in one of the two frames. Whichever frame is narrower is the real one. */
  let w360 = Infinity, e360 = -Infinity;

  for (const ring of rings) {
    for (const pt of ring || []) {
      const [lon, lat] = pt || [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      const shifted = lon < 0 ? lon + 360 : lon;
      if (shifted < w360) w360 = shifted;
      if (shifted > e360) e360 = shifted;
    }
  }
  if (!Number.isFinite(w) || !Number.isFinite(s)) return null;

  /* Not a crossing: the plain box is the answer. */
  if (e - w <= 180) return { south: s, north: n, lon: [[w, e]] };

  /* A crossing. Express it as two spans either side of the seam, taken from
   * the 0..360 frame where the shape is contiguous. */
  const west = w360 > 180 ? w360 - 360 : w360;
  const east = e360 > 180 ? e360 - 360 : e360;
  return { south: s, north: n, lon: [[west, 180], [-180, east]] };
}

/** Do two extents touch? Inclusive on every edge — an alert whose corner sits
 *  exactly on the cone's edge is inside it, for the reason `extent` gives. */
export function extentsOverlap(a, b) {
  if (!a || !b) return false;
  if (a.south > b.north || b.south > a.north) return false;
  for (const [aw, ae] of a.lon) {
    for (const [bw, be] of b.lon) {
      if (aw <= be && bw <= ae) return true;
    }
  }
  return false;
}

/**
 * The alerts whose area overlaps this cone. §48.21.
 *
 * @returns {{state:'ok', alerts:Array, total:number} |
 *           {state:'no_cone'} | {state:'none_matched'}}
 *
 * ==> `no_cone` IS NOT `none_matched` AND THE PANEL SAYS SO. <== A storm with
 * no published cone — a GDACS system, a storm whose geometry has not landed, an
 * ended storm rebuilt from a skeleton — has nothing to test alerts against. The
 * honest answer is that we cannot say, and it must never render as the honest
 * answer for a storm whose cone WAS tested and contained nothing. That is §5's
 * `unavailable` versus `none_matched` distinction in a new place, and it is the
 * one this feature is most likely to get wrong, because both produce an empty
 * list.
 *
 * ==> AN UNDRAWABLE ALERT STILL MATCHES. <== A Flood Watch carries no polygon
 * (§48.21), so there is no box to test and it cannot be located this way. It is
 * kept rather than dropped: it is a real product in force somewhere in the
 * country, and dropping it from a storm's list because NWS issues watches by
 * zone would be hiding a hazard behind our own plumbing. The caller separates
 * them — the list carries both, the globe draws only what has a shape.
 */
export function alertsInCone(alerts, coneGeometry) {
  const cone = extent(coneGeometry);
  if (!cone) return { state: 'no_cone' };

  const matched = [];
  for (const a of alerts || []) {
    /* THE BELT TO THE ROUTE'S BRACES. `/api/nws/flood` asks the upstream for
     * three products by name, so nothing else should arrive — but "should" is
     * doing the work in that sentence. NWS renames products, and a Coastal
     * Flood Advisory reaching here would put a second, contradictory answer
     * beside §51's surge section. */
    if (!isFloodFamily(a?.event)) continue;
    /* No shape to place. Held back rather than matched — see below. */
    if (!a?.geometry) continue;
    if (extentsOverlap(extent(a.geometry), cone)) matched.push(a);
  }

  if (!matched.length) return { state: 'none_matched' };
  return { state: 'ok', alerts: matched, total: matched.length };
}

/**
 * The sentence's two numbers: how many are in force inside the cone, and how
 * many of those are warnings rather than watches.
 *
 * ==> A COUNT OF ALERTS IS NOT A COUNT OF SHAPES, AND THE DRAWER MUST BE ABLE
 * TO SAY SO. <== The layer draws what carries a polygon. If nineteen are in
 * force and eleven can be drawn, a sentence claiming nineteen are on the globe
 * is wrong and a globe silently showing eleven is worse. Both travel.
 */
export function coneSummary(alerts, coneGeometry, nowMs) {
  const live = inForce(alerts, nowMs);
  const hit = alertsInCone(live, coneGeometry);
  if (hit.state !== 'ok') return { ...hit, live };

  const drawable = hit.alerts.filter((a) => a.drawable).length;
  const immediate = hit.alerts.filter((a) => a.immediate).length;
  return { state: 'ok', alerts: hit.alerts, total: hit.total, drawable, immediate, live };
}

/**
 * Is this alert one the flood family owns? A belt to the relay's braces.
 *
 * The route asks the upstream for three products by name, so nothing else
 * should ever arrive. This exists because "should" is doing the work in that
 * sentence: NWS renames products, and a Coastal Flood Advisory reaching this
 * layer would put a second, contradictory answer next to §51's surge section.
 */
export const isFloodFamily = (event) =>
  String(event || '').toLowerCase().includes(RAIN.alertEventMatch);
