/**
 * storm-mesh.js — storms (+ their geometry bundles) → the weighted points the
 * cage lifts over.
 *
 * ONE JOB: turn "here are the live storms and the track data already in the
 * cache" into the list map/heightfield.js `setStormPoints()` takes. It decides
 * WHICH positions the cage should know about and how much each one matters. It
 * does not draw, does not fetch, and does not touch the DOM.
 *
 * WHY IT IS ITS OWN FILE. This logic lived inline in main.js as four lines
 * building one point per storm. Following the whole track makes it windowing,
 * thinning, and per-point intensity resolution — a hundred lines of
 * real decisions, none of which are orchestration (§12: no god files; code
 * goes in the file that owns its concern).
 *
 * ---------------------------------------------------------------------------
 * THE TWO SOURCES ARE NOT EQUALLY HONEST HERE, AND THAT IS RECORDED, NOT HIDDEN
 * ---------------------------------------------------------------------------
 *
 * NHC publishes a MEASURED wind in knots at every past position (`intensity`)
 * and every forecast position (`maxwind`), plus its own Saffir-Simpson index
 * (`ss` / `ssnum`) — all live-confirmed 2026-07-24 (SPEC §4). An NHC ridge is
 * therefore measured, bead by bead: each one stands at the strength that storm
 * actually was, or is actually forecast to be, at that hour.
 *
 * GDACS publishes NO wind number anywhere on its track. Its positions carry an
 * intensity CODE only — TD / TS / HU (data/gdacs-points.js). Three tiers, and
 * the strongest of them spans a Saffir-Simpson 1 through a 5.
 *
 * A GDACS bead therefore resolves in three steps, best first:
 *
 *   1. A MEASURED JTWC WIND, where a warning's forecast hour lines up with the
 *      dot (`_windKt`, stamped in data/gdacs-points.js). Height and colour both
 *      come from that one number and §9 holds exactly as it does for NHC. This
 *      is the case the 2026-07-28 join exists to produce.
 *   2. CAPPED CLASS MIDPOINT on a forecast bead nobody published a wind for —
 *      `forecastKt()` below. Colour is the source's forecast class, height is
 *      no more than the storm's wind right now. A word meaning "Cat 1 through
 *      Cat 5" must not raise a mountain three days out.
 *   3. PLAIN CLASS MIDPOINT on a past bead. History is a record, not a claim,
 *      and capping it to the present would erase a storm's peak.
 *
 * None of this violates §5. `representativeKt` is never DISPLAYED; it feeds a
 * visual ramp, exactly as `lib/category.js` requires. The detail panel still
 * omits wind for a GDACS storm rather than printing a midpoint as fact.
 *
 * PAST BEADS ARE THE REMAINING GAP. A JTWC warning holds the current analysis
 * and the forecast ladder and no history at all, so step 3 is still every
 * GDACS past bead. GDACS's own timestepped 60/90/120 km/h footprints cannot
 * close it either — they begin at the current analysis time. The open
 * candidate is the TCGP a-deck's `CARQ` rows: measured on the live deck
 * 2026-07-28, negative forecast hours carrying real `VMAX`, on an endpoint
 * this app already relays. Not built.
 *
 * `THREE` is a CDN global (via lib/geo.js). Imports: config, lib, and
 * map/heightfield.js for the shared severity ramp. One direction, no cycle.
 */

import { MESH_TRACK } from '../config/constants.js';
import { lonLatToVec3 } from '../lib/geo.js';
import { categoryColor, representativeKt } from '../lib/category.js';
import { trackPointReading, windKtOf, timeMsOf } from '../lib/track-point.js';
import { sevFromKt } from './heightfield.js';

const HOUR_MS = 3600 * 1000;

/* ---------------------------------------------------------------------------
 * THINNING
 * ------------------------------------------------------------------------- */

/**
 * Reduce a list to at most `max` entries by dropping every other one,
 * repeatedly, rather than truncating.
 *
 * TRUNCATING WOULD BE WRONG in a way that looks fine on a normal day: it would
 * silently shorten the ridge to a fraction of its window, so a source that
 * started publishing hourly would produce a ridge covering six hours while the
 * setting still said seventy-two. Dropping alternates keeps the full span and
 * only coarsens it, which is the honest degradation.
 *
 * The FIRST and LAST entries always survive, so the ridge still reaches the
 * ends of its window.
 */
function thin(list, max) {
  if (!Array.isArray(list) || list.length <= max || max < 2) {
    return list.length > max ? list.slice(0, max) : list;
  }
  let out = list;
  while (out.length > max) {
    const next = out.filter((_, i) => i % 2 === 0);
    /* Keep the true last entry: dropping odd indices loses it whenever the
     * length is even, which would clip the far end of the window off. */
    if (next[next.length - 1] !== out[out.length - 1]) next.push(out[out.length - 1]);
    if (next.length >= out.length) break; // cannot reduce further; stop rather than spin
    out = next;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * ONE STORM
 * ------------------------------------------------------------------------- */

/**
 * Height for a bead nobody published a wind for.
 *
 * ===========================================================================
 * A FORECAST CLASS IS NOT A FORECAST WIND, AND IT MUST NOT LIFT LIKE ONE
 * ===========================================================================
 *
 * GDACS labels each track leg with one of three words. Its strongest, `HU`,
 * spans a Saffir-Simpson 1 through a 5 — so `representativeKt()` answers the
 * middle of that whole range, ~109 kt, for every hurricane leg on every storm.
 * On the live ramp that is 0.879 lift, ABOVE a measured NHC Cat 3 at 0.832.
 *
 * Used on the current position that was already wrong, and it is the bug the
 * JTWC join was built to remove. Used along a FORECAST track it is worse: the
 * app raises a mountain days into the future off a word that means "somewhere
 * between a Cat 1 and a Cat 5", and a tropical storm ends up out-topping a
 * measured Cat 4 on the strength of a classification nobody can pin down.
 *
 * AARON'S RULE, 2026-07-28: colour the forecast whatever the source says it
 * will be, but do not lift it past what the storm actually is right now. A
 * forecast we cannot quantify gets today's height. That undersells a storm
 * that really is about to explode, and overselling is the failure that
 * matters — this is the cage, not the cone, and height is the channel a
 * reader triages on before they read a single word.
 *
 * ===========================================================================
 * WHY min() AND NOT SIMPLY `currentKt`
 * ===========================================================================
 *
 * A flat "always use the current wind" would also RAISE the beads on a storm
 * the source says is weakening — a Cat 4 forecast down to a tropical storm
 * would draw its whole decay at Cat 4 height, which is the same oversell
 * pointing the other way. GDACS's three words do carry an ordering, and it is
 * the one thing they carry reliably, so a leg labelled TD or TS still reads
 * lower. The cap only ever pulls a bead DOWN, never up.
 *
 * ===========================================================================
 * PAST BEADS ARE NOT CAPPED, DELIBERATELY
 * ===========================================================================
 *
 * A storm that was a hurricane yesterday and is a tropical storm today HAS a
 * hurricane in its history, and flattening that to the present would erase the
 * peak — rewriting what happened to match what is true now. History is a
 * record; only the future is a claim. The cap applies to forecast beads alone.
 *
 * ===========================================================================
 * THIS IS A BOUNDED EXCEPTION TO §9, STATED RATHER THAN HIDDEN
 * ===========================================================================
 *
 * §9 says elevation and colour are one signal from one number, and for a
 * capped bead they are not: the colour is the source's forecast class, the
 * height is today's measured wind. That is the point. The two channels are
 * answering two questions we have two different confidences about — "what does
 * the agency say this becomes" and "how much wind do we actually know about" —
 * and the alternative is picking one of them to lie with. Everywhere a real
 * number exists, on either feed, §9 holds untouched.
 *
 * @param {{index: number|null, code: string}} reading this position's class
 * @param {boolean} isForecast                 is this bead in the future?
 * @param {number|null} currentKt              the storm's wind right now
 */
function forecastKt(reading, isForecast, currentKt) {
  const derived = representativeKt(reading.index, 'tropical', reading.code);
  if (!isForecast || derived == null || currentKt == null) return derived;
  return Math.min(derived, currentKt);
}

/** Features out of one bundle slot, or [] for every non-ok state. */
function featuresOf(slot) {
  if (slot?.status !== 'ok') return [];
  const f = slot.fc?.features;
  return Array.isArray(f) ? f : [];
}

/** The live fix: one point, always present, whatever the mode or the bundle.
 *  THE ONLY POINT THAT DRAWS A GLYPH — see `head` below. */
function headPoint(s) {
  return {
    dir: lonLatToVec3(s.lon, s.lat, 1).normalize(),
    /* CURRENT strength, never the forecast peak. `windKt` is null by design
     * for GDACS (the source publishes no current wind), so it falls through to
     * the middle of the stated class rather than to `peakWindKt`, which
     * describes a moment that has not happened (SPEC §4). */
    sev: sevFromKt(s.windKt ?? representativeKt(s.category, s.nature, s.categoryCode)),
    /* The SAME color MapLibre stamps on this storm's glyph (map/markers.js).
     * One severity color per storm across both engines. */
    color: categoryColor(s.category, s.nature, s.categoryCode),
    /* THE HEAD IS THE ONLY POINT THAT DRAWS A STORM GLYPH. Every other bead
     * lifts and tints the cage and nothing else. Without this flag the ridge
     * would stamp a spiral at all twenty-odd positions and a single storm
     * would read as twenty storms — which is not a cosmetic problem, it is a
     * false count of live systems (§5). */
    head: true,
  };
}

/**
 * Track beads for one storm, from its cached geometry bundle.
 *
 * Returns [] for every honest reason: no bundle yet (geometry is warmed
 * asynchronously and may not have landed), a source with no track, a bundle
 * whose slots errored. The head is added by the caller regardless, so a storm
 * whose track never arrives keeps exactly the peak it has today rather than
 * disappearing — degrade, never blank (§5).
 */
function trackPoints(s, bundle, nowMs) {
  /* A bundle slot is `{status, fc, error, unfiltered}` — NOT a bare array
   * (data/nhc-mapserver.js, data/gdacs-geometry.js). Only `ok` slots carry
   * features; `none` means the source genuinely publishes nothing here and
   * `unavailable` means it errored. Both give us zero beads, and both are
   * handled the same way: the head still stands, so the storm degrades to its
   * current-position peak instead of vanishing (§5). */
  const feats = [
    ...featuresOf(bundle?.layers?.pastPoints),
    ...featuresOf(bundle?.layers?.forecastPoints),
  ];
  if (!feats.length) return [];

  /* ==> THE CEILING ON AN UNMEASURED FORECAST BEAD <==
   *
   * What this storm's wind actually is RIGHT NOW: JTWC's measured fix where we
   * have one, otherwise the midpoint of its current stated class. This is the
   * same number the head bead stands at, and it is the highest a forecast bead
   * is allowed to reach when nobody has published a wind for that hour. See
   * `forecastKt` below for why.
   *
   * Null for a storm with no readable intensity at all, which switches the cap
   * off rather than flattening the ridge to nothing. */
  const currentKt = s.windKt ?? representativeKt(s.category, s.nature, s.categoryCode);

  const out = [];
  for (const f of feats) {
    if (f?.geometry?.type !== 'Point') continue;
    const coords = f.geometry.coordinates;
    const lon = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    /* GEOMETRY, never the `lat`/`lon` ATTRIBUTES — those are rounded to whole
     * degrees on both +7 and +2 (SPEC §4, measured on both). A ridge built off
     * the attributes would sit up to fifty miles from the track it claims to
     * follow. */
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const p = f.properties || {};
    const t = timeMsOf(p);
    /* No readable time means no place in the storm's life: it cannot be
     * windowed at all. Dropped, not guessed — a bead at the wrong moment
     * is worse than a bead that is not there. */
    if (t == null) continue;

    const deltaHours = (t - nowMs) / HOUR_MS;
    if (deltaHours < -MESH_TRACK.pastHours) continue;
    if (deltaHours > MESH_TRACK.forecastHours) continue;

    const reading = trackPointReading(p);
    /* Measured knots when the source published them — NHC at every position,
     * and GDACS wherever a JTWC forecast hour lines up (data/gdacs-points.js).
     * A measurement always wins and is never capped. */
    const kt =
      windKtOf(p) ??
      forecastKt(reading, deltaHours > 0 || p.tau > 0, currentKt);

    out.push({
      dir: lonLatToVec3(lon, lat, 1).normalize(),
      /* HEIGHT IS INTENSITY, NOTHING ELSE (MESH_TRACK in config/constants.js).
       * No age or lead-time weighting: the tallest point on a storm's ridge is
       * its STRONGEST point, wherever in the window that falls. An earlier
       * pass tapered this and it broke §9's "elevation and color are one
       * signal from one number" — colour was each position's true category
       * while height had become a blend of intensity and recency. */
      sev: sevFromKt(kt),
      color: reading.color,
      head: false,
      /* Ordering key. Stripped below so the objects handed to the heightfield
       * carry only the four fields its contract names. */
      d: deltaHours,
    });
  }

  /* Chronological BEFORE thinning: dropping alternates from an unsorted list
   * would coarsen the ridge unevenly, leaving gaps in one stretch and clumps
   * in another. */
  out.sort((a, b) => a.d - b.d);
  /* Budget counts the head, which the caller adds — hence the minus one. */
  return thin(out, Math.max(1, MESH_TRACK.maxPointsPerStorm - 1))
    .map(({ dir, sev, color, head }) => ({ dir, sev, color, head }));
}

/* ---------------------------------------------------------------------------
 * PUBLIC
 * ------------------------------------------------------------------------- */

/**
 * Build the full weighted point list for the cage.
 *
 * @param {object}   o
 * @param {Array}    o.storms     live storms from data/store.js
 * @param {string}   o.mode       MESH_HEIGHT.CURRENT | MESH_HEIGHT.TRACK
 * @param {Function} o.bundleFor  (storm) => cached geometry bundle | null
 * @param {number}   [o.nowMs]    injectable for tests
 * @returns {Array<{dir, sev, color, head}>}
 *
 * In CURRENT mode this returns exactly what it always did — one point per
 * storm — so the default path is unchanged and the ridge is opt-in.
 */
export function buildMeshPoints({ storms, mode, bundleFor, nowMs = Date.now() }) {
  const list = Array.isArray(storms) ? storms : [];
  const pts = [];

  for (const s of list) {
    if (!Number.isFinite(s?.lon) || !Number.isFinite(s?.lat)) continue;
    const head = headPoint(s);

    if (mode !== 'track') {
      pts.push(head);
      continue;
    }

    let beads = [];
    try {
      beads = trackPoints(s, bundleFor?.(s) || null, nowMs);
    } catch (e) {
      /* One malformed bundle must not cost the whole globe its storms. The
       * head still goes in below, so this storm degrades to the CURRENT-mode
       * peak rather than vanishing (§5). */
      console.warn(`[landfall] mesh track failed for ${s?.id || 'unknown storm'}:`, e);
      beads = [];
    }

    /* HEAD FIRST, and this ordering is load-bearing. A forecast point at
     * tau 0 sits at (or within a mile of) the live position with an identical
     * intensity, so the two can tie exactly. `influenceAt` keeps a contributor
     * only when it is STRICTLY stronger than the incumbent, so on a tie the
     * FIRST one entered wins — and the winner owns the node's color. Entering
     * the head first makes the live fix the winner, which is the point that
     * agrees with the storm list, the marker, and the detail panel. */
    pts.push(head);
    for (const b of beads) pts.push(b);
  }

  return pts;
}
