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
 * intensity CODE only — TD / TS / HU (data/gdacs-points.js). So a GDACS bead's
 * COLOR is the source's own reading, but its HEIGHT comes from
 * `representativeKt()`, the middle of the stated class's range — real
 * information (a depression stretch reads lower than a hurricane stretch) with
 * a derived rather than measured number underneath.
 *
 * THE HEAD IS THE EXCEPTION, AND IT IS MEASURED. GDACS's timestepped
 * 60/90/120 km/h footprints begin at the CURRENT analysis time, so band
 * containment brackets the live fix's intensity into a real range
 * (lib/windrange.js) — its floor is what the head bead stands at. There are no
 * PAST footprints, so history keeps the midpoint; forecast steps could be
 * measured the same way and are not yet.
 *
 * This does not violate §5. `representativeKt` is never DISPLAYED; it feeds a
 * visual ramp, exactly as `lib/category.js` requires. The measured RANGE is
 * displayed, as a range with its provenance stated — a different claim from a
 * fabricated point value.
 *
 * `THREE` is a CDN global (via lib/geo.js). Imports: config, lib, and
 * map/heightfield.js for the shared severity ramp. One direction, no cycle.
 */

import { MESH_TRACK } from '../config/constants.js';
import { lonLatToVec3 } from '../lib/geo.js';
import { categoryColor, representativeKt } from '../lib/category.js';
import { rampKtFromRange } from '../lib/windrange.js';
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

/** Features out of one bundle slot, or [] for every non-ok state. */
function featuresOf(slot) {
  if (slot?.status !== 'ok') return [];
  const f = slot.fc?.features;
  return Array.isArray(f) ? f : [];
}

/** The live fix: one point, always present, whatever the mode or the bundle.
 *  THE ONLY POINT THAT DRAWS A GLYPH — see `head` below. */
function headPoint(s, bundle) {
  return {
    dir: lonLatToVec3(s.lon, s.lat, 1).normalize(),
    /* CURRENT strength, never the forecast peak — three sources, best first:
     *
     *   1. `windKt`, a MEASURED number. NHC publishes one; GDACS never does.
     *   2. The floor of the range measured from GDACS's own current wind
     *      footprints (lib/windrange.js). Also a measurement: the storm's
     *      centre sits inside a published band for that speed, so it is at
     *      least that strong. This is what stops every GDACS hurricane
     *      standing at the same height.
     *   3. The middle of the stated class — a guess, and the last resort. It
     *      applies when the bundle has not landed yet, or when the payload
     *      has no readable current bands.
     *
     * Never `peakWindKt`, at any step: it describes a moment that has not
     * happened (SPEC §4). */
    sev: sevFromKt(
      s.windKt ??
        rampKtFromRange(bundle?.windRange) ??
        representativeKt(s.category, s.nature, s.categoryCode)
    ),
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
    /* Measured knots when the source published them (NHC, both tiers); the
     * class midpoint when it did not (GDACS, every position). Null when there
     * is nothing to stand for at all — `sevFromKt` then returns the minimum
     * lift, because a storm with no readable intensity still exists. */
    const kt = windKtOf(p) ?? representativeKt(reading.index, 'tropical', reading.code);

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

    /* Looked up ONCE per storm and used by both the head and the beads. The
     * head needs it now too — it carries the measured GDACS wind range — so
     * this lookup happens in `current` mode as well, where it previously did
     * not. It is a cache read, not a fetch; a miss is normal and the head
     * falls back to the class midpoint until the bundle lands. */
    const bundle = bundleFor?.(s) || null;
    const head = headPoint(s, bundle);

    if (mode !== 'track') {
      pts.push(head);
      continue;
    }

    let beads = [];
    try {
      beads = trackPoints(s, bundle, nowMs);
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
