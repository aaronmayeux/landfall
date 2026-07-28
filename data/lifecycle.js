/**
 * data/lifecycle.js — deciding that a storm has ENDED, and remembering it
 * (SPEC §5).
 *
 * ===========================================================================
 * WHAT THIS FIXES
 * ===========================================================================
 *
 * Before this, a storm's death was a DELETION. GDACS flips `iscurrent` to
 * "false" and data/gdacs.js drops the event during parse; NHC retires a storm
 * and it is simply gone from CurrentStorms.json. Either way the dot, the track,
 * the row and the badge vanished between one poll and the next with nothing
 * anywhere explaining it. Someone watching a landfall saw the storm they were
 * following disappear, and had no way to tell that from the app breaking.
 *
 * ===========================================================================
 * TWO WAYS TO DIE. NEITHER OF THEM IS A TIMER.
 * ===========================================================================
 *
 *   DECLARED  the agency published its final bulletin and SAID SO IN WORDS.
 *             NHC's last public advisory carries "...THIS IS THE FINAL NHC
 *             ADVISORY..."; JTWC's carries "THIS IS THE FINAL WARNING ON THIS
 *             SYSTEM". Both confirmed verbatim off live products 2026-07-28 —
 *             see lib/advisory.js, which owns the matching. This needs no
 *             waiting and no inference: it is a fact the source states, so the
 *             app states it too, on the very poll it is read.
 *
 *   ABSENT    nobody said anything, and the storm is simply gone from a feed
 *             that is otherwise answering normally. Counted in CLEAN
 *             CONFIRMATIONS, never in elapsed time.
 *
 * ==> WHY COUNTED AND NOT TIMED, since a timer is what everyone reaches for
 * first: A CLOCK CANNOT TELL A DEAD STORM FROM A DEAD NETWORK. Leave one
 * running and a road tunnel, a captive-portal wifi, a relay deploy or one
 * truncated upstream list all read as a storm ending. A confirmation is a poll
 * that came back CLEAN and did not contain the storm — that is evidence, where
 * elapsed time is merely the absence of evidence. A failed poll produces no
 * confirmation rather than a negative one, so an hour with no signal moves the
 * counter by exactly zero. Any reappearance resets it.
 *
 * ===========================================================================
 * THE FAILURE MODE THIS IS ACTUALLY VULNERABLE TO
 * ===========================================================================
 *
 * A TRUNCATED LIST IS A CLEAN FETCH THAT IS MISSING STORMS, and it looks
 * exactly like the end of the world for whatever fell off the bottom. Not
 * hypothetical: on 2026-07-26 a wildfire season crowded a live typhoon off
 * GDACS's 100-feature cap (functions/api/gdacs/events.js).
 *
 * So a poll only votes if its list is CREDIBLE — non-empty, and not a sudden
 * collapse against the previous one. `ENDED.minCredibleFraction` sets the bar.
 *
 * THE GUARD IS DELIBERATELY ALLOWED TO BE WRONG ONCE, AND THAT IS NOT
 * SLOPPINESS. A guard that simply refuses forever would DEADLOCK: a season
 * genuinely winding down from eight storms to three would fail the fraction
 * test on every subsequent poll, measured against a baseline that never moves,
 * and no storm would ever end again. So a non-credible poll casts no votes AND
 * adopts the new size as the baseline — a real collapse costs one extra poll, a
 * one-off truncation costs nothing at all, and neither can jam the mechanism
 * shut. Both directions of that trade are cheap here, which is the reason it is
 * allowed to be loose: ending a storm greys one dot for 36 hours and REVIVES
 * ITSELF the moment either feed publishes the storm again (`revive` below).
 * That is not the old behaviour's cost. The old behaviour deleted it.
 *
 * ===========================================================================
 * WHY THIS PERSISTS, AND WHY IT IS THE ONLY DATA STORE THAT DOES
 * ===========================================================================
 *
 * Every other localStorage key in this app holds a PREFERENCE and could be
 * thrown away and rebuilt. This one holds storm data because an ended storm is
 * OUT OF BOTH FEEDS: nothing can rebuild it. A refetch returns nothing, the
 * in-memory geometry cache is gone on reload, and the storm exists nowhere else
 * on the device. Without persistence, closing the tab is indistinguishable from
 * the storm never having happened — which is the exact abrupt disappearance
 * this file was written to remove, just relocated to page load.
 *
 * That is also why the PAST TRACK is persisted alongside the record, in a
 * compact form, and why it is captured on every poll while the storm is still
 * alive rather than at the moment it dies. At the moment it dies the storm is
 * already absent from the feed, and on a cold start there is no geometry cache
 * to read it out of. Capture has to happen before it is needed.
 *
 * Imports: config/, lib/, data/ siblings. Nothing imports this except
 * data/store.js and its test.
 */

import { ENDED, STORAGE_KEY } from '../config/constants.js';
import { isNhcFinalAdvisory } from '../lib/advisory.js';
import { becameWhat, endedExpired } from '../lib/lifecycle.js';
import { timeMsOf, windKtOf, categoryIndexOf } from '../lib/track-point.js';
import { fetchAdvisory } from './advisory.js';
import { getGeometry } from './cache.js';

/** Schema version. A bump throws the stored blob away rather than migrating —
 *  the cost of losing it is at most 36 hours of grey dots, and a migration path
 *  for a store this young is more code than the data is worth. */
const VERSION = 1;

/* ---------------------------------------------------------------------------
 * IN-MEMORY STATE
 *
 * `ended` is the answer. `seen` is the working set behind it: the last-known
 * record for every storm either feed has shown us recently, plus that storm's
 * absence tally. `seen` is what makes an absent storm recoverable at all — by
 * the time absence is confirmed, the only copy of the storm left anywhere is
 * the one in here.
 * ------------------------------------------------------------------------- */

/** id → { storm, track, at } — storms confirmed over. */
let ended = new Map();

/** id → { storm, track, absent, source, at } — last-known, still believed live. */
let seen = new Map();

/** source → size of the last credible list, for the truncation guard. */
let baseline = { nhc: 0, gdacs: 0 };

const listeners = new Set();

/** Subscribe to registry changes. data/store.js is the only caller: a storm
 *  ending has to reach the UI on the poll it happens, and the declared path is
 *  asynchronous (it reads advisory text), so it can land after the store has
 *  already emitted for that poll. */
export function onLifecycleChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function changed() {
  save();
  for (const cb of listeners) cb();
}

/* ---------------------------------------------------------------------------
 * PERSISTENCE
 *
 * The guarded read/write shape every other store in this project uses
 * (data/home.js, data/layer-prefs.js): localStorage throws in Safari private
 * mode and when quota is gone, and a storm registry is never worth taking the
 * app down for. A failed write degrades to session-only, silently and on
 * purpose — the alternative is an error toast about a grey dot.
 * ------------------------------------------------------------------------- */

function load() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY.ended));
  } catch {
    return; // unreadable or absent: start clean
  }
  if (!raw || raw.v !== VERSION) return;

  const now = Date.now();
  for (const rec of Array.isArray(raw.ended) ? raw.ended : []) {
    if (!rec?.storm?.id || !rec.storm.ended) continue;
    /* SWEPT ON THE WAY IN. A device that was closed for three days must not
     * repopulate the globe with storms whose grace period expired while it was
     * off — the sweep is the same call the poll path makes, so there is one
     * expiry rule rather than a load-time copy of it. */
    if (endedExpired(rec.storm, now)) continue;
    ended.set(rec.storm.id, rec);
  }
  for (const [id, rec] of Object.entries(raw.seen || {})) {
    if (rec?.storm?.id) seen.set(id, rec);
  }
  if (raw.baseline) baseline = { ...baseline, ...raw.baseline };
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY.ended,
      JSON.stringify({
        v: VERSION,
        ended: [...ended.values()],
        seen: Object.fromEntries(seen),
        baseline,
      })
    );
  } catch {
    /* Session-only from here. Nothing to say to the user about it. */
  }
}

/** Cap both maps, newest first. A long season must not grow localStorage
 *  without bound, and `seen` needs the cap as much as `ended` does: a storm
 *  whose source has been erroring for a week never gets confirmed absent and
 *  would otherwise sit in the working set forever. */
function trim() {
  const byNewest = (a, b) => (b[1].at || 0) - (a[1].at || 0);
  for (const map of [ended, seen]) {
    if (map.size <= ENDED.maxRegistry) continue;
    const keep = [...map.entries()].sort(byNewest).slice(0, ENDED.maxRegistry);
    map.clear();
    for (const [k, v] of keep) map.set(k, v);
  }
}

/* ---------------------------------------------------------------------------
 * THE PAST TRACK, COMPACTED
 *
 * Only what the cage's ridge and the map's past line actually read, and stored
 * under the SAME private field names the parsers stamp (`_time`, `_windKt`,
 * `_catStamped` / `_catIndex`) so `lib/track-point.js` reads a rehydrated point
 * with no idea it was ever in localStorage. Inventing a second shape here would
 * mean a second set of readers, and two readers of one thing is how the ridge
 * and the dots end up disagreeing about the same position.
 * ------------------------------------------------------------------------- */

/** Features → compact tuples: [lon, lat, timeMs, windKt|null, catIndex|null]. */
function compactTrack(bundle) {
  const feats = bundle?.layers?.pastPoints;
  const list = feats?.status === 'ok' && Array.isArray(feats.fc?.features)
    ? feats.fc.features
    : [];
  const out = [];
  for (const f of list) {
    if (f?.geometry?.type !== 'Point') continue;
    const lon = Number(f.geometry.coordinates?.[0]);
    const lat = Number(f.geometry.coordinates?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    const t = timeMsOf(p);
    if (t == null) continue; // a point with no time has no place on the ridge
    out.push([
      /* Rounded to ~10 m. A track is drawn at globe zoom and the full float
       * doubles the stored size for precision nothing can see. */
      Math.round(lon * 1e4) / 1e4,
      Math.round(lat * 1e4) / 1e4,
      t,
      windKtOf(p),
      categoryIndexOf(p),
    ]);
  }
  /* Newest kept when over budget: the recent end of the track is the part
   * anyone is looking at, and the cage windows off `MESH_TRACK.pastHours`
   * anyway. */
  out.sort((a, b) => a[2] - b[2]);
  return out.slice(-ENDED.maxTrackPoints);
}

/** Compact tuples → the past-track LINE.
 *
 *  REBUILT SEPARATELY FROM THE POINTS BECAUSE TWO DIFFERENT SURFACES READ THEM.
 *  The cage's ridge lifts off `pastPoints`; the map draws its trail from
 *  `pastTrack`, which is a line layer. Persisting only the points would have
 *  restored the ridge and lost the trail — the storm's whole path gone from the
 *  map on reload, which is most of what an ended storm is worth looking at.
 *
 *  One LineString, not the source's original run structure. The multi-run form
 *  exists because NHC and GDACS publish tracks in segments and lib/trackline.js
 *  has to stitch them; by the time a point reaches this registry it has already
 *  been through that, so re-splitting it would be inventing seams. Fewer than
 *  two points is not a line and yields an honest `none`. */
function rehydrateLine(track) {
  const coords = (Array.isArray(track) ? track : []).map(([lon, lat]) => [lon, lat]);
  if (coords.length < 2) return { status: 'none', fc: null, error: null };
  return {
    status: 'ok',
    fc: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
      ],
    },
    error: null,
  };
}

/** Compact tuples → the bundle shape every consumer already reads. */
export function rehydrateTrack(track) {
  const features = (Array.isArray(track) ? track : []).map(
    ([lon, lat, t, windKt, catIndex]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        _time: t,
        ...(windKt == null ? {} : { _windKt: windKt }),
        /* STAMPED EVEN WHEN NULL, and the flag is why. `categoryIndexOf`
         * checks `_catStamped` rather than the value, because a stamped null is
         * a real reading ("hurricane, no category available") and must not fall
         * through to the NHC field names — which are not here and never will
         * be, since this record has already been through that parser once. */
        _catStamped: true,
        _catIndex: catIndex,
      },
    })
  );
  return { status: 'ok', fc: { type: 'FeatureCollection', features }, error: null };
}

/**
 * The geometry bundle for an ended storm, rebuilt from what was persisted.
 *
 * PAST TRACK ONLY, and everything else honestly empty. This is the whole point
 * of §5's keep-history-drop-the-future rule arriving at its logical end: there
 * is no cone to show, no forecast, no watch or warning, and no current wind
 * field — not because they are hidden, but because they no longer exist. The
 * wind swath is not persisted either, which is a real reduction and is stated
 * rather than hidden: it is an order of magnitude more geometry than the track,
 * for a storm nobody is deciding anything about any more.
 */
export function endedBundle(id) {
  const rec = ended.get(id);
  if (!rec) return null;
  /* An in-memory bundle is better than a rebuilt one whenever it survives —
   * same session, storm ended minutes ago. The cache's own rule is that a
   * storm's geometry only ever gets better, and this is the same idea one level
   * up: prefer the full record, fall back to the persisted skeleton. */
  const live = getGeometry(id);
  if (live && !live.error && live.layers?.pastPoints?.status === 'ok') return live;
  return {
    layers: {
      pastPoints: rehydrateTrack(rec.track),
      pastTrack: rehydrateLine(rec.track),
    },
    forecast: [],
    stamp: rec.storm?.advisoryKey ? { advisnum: null, filedate: rec.storm.observedAt } : null,
    /** Marks a bundle that came out of localStorage rather than off a feed. The
     *  panel's geometry-lag line reads `stamp` and would otherwise report a
     *  rebuilt skeleton as a lagging fetch — blaming NOAA for a shape we
     *  restored ourselves, which is the same mistake the silence pass caught in
     *  `mapProblemHtml`. */
    rebuilt: true,
  };
}

/* ---------------------------------------------------------------------------
 * PROMOTION AND REVIVAL
 * ------------------------------------------------------------------------- */

/**
 * Write the `ended` record onto a storm and move it into the registry.
 *
 * `at` is WHEN THE ENDING HAPPENED where the bulletin tells us (JTWC's own fix
 * time, NHC's advisory issuance) and when we LEARNED otherwise. Those differ by
 * up to a poll interval, which does not matter for a 36-hour window and does
 * matter for the badge: "issued its final advisory Thu 11:00 AM" has to be the
 * agency's clock, not ours, or a reader comparing it against NHC's own archive
 * finds two different times for one event.
 */
function promote(id, { reason, by, at, became, key }) {
  const prev = seen.get(id);
  const base = prev?.storm || ended.get(id)?.storm;
  if (!base) return false;

  const stampedAt = at || base.observedAt || new Date().toISOString();
  const storm = {
    ...base,
    ended: Object.freeze({
      reason,   // 'declared' | 'absent'
      by,       // 'nhc' | 'jtwc' | 'gdacs' — who SPOKE, not whose storm it is
      at: stampedAt,
      became: became || null,
      /* What we were looking at when we decided. Not shown to anyone; it is
       * how `shouldRevive` recognises that a NEWER bulletin has arrived. */
      key: key || null,
    }),
  };

  ended.set(id, { storm, track: prev?.track || ended.get(id)?.track || [], at: Date.now() });
  seen.delete(id);
  trim();
  return true;
}

/**
 * Has a storm we called finished started publishing again?
 *
 * STORMS DO REGENERATE, and an app that cannot notice is worse than one that
 * never ended them: a grey "final advisory issued" dot sitting on a system NHC
 * has resumed warning on is the §5 lie in its most dangerous form — an
 * all-clear over a live storm.
 *
 * The test is not "is it back in the list", because a DECLARED storm is
 * normally still in the list for hours after its final advisory. The test is
 * whether a NEWER bulletin exists that does not declare an ending:
 *
 *   absent    the storm is in a feed again at all. Nothing else is needed —
 *             absence was the entire evidence, and it has been contradicted.
 *   declared  a different advisory or a higher warning number, whose text does
 *             not say final. The stored `key` is what makes that comparable.
 */
function shouldRevive(rec, storm, { finalNow }) {
  if (!rec || !storm) return false;
  if (rec.storm.ended.reason === 'absent') return true;
  if (finalNow) return false;
  const key = bulletinKey(storm);
  return key != null && rec.storm.ended.key != null && key !== rec.storm.ended.key;
}

/** The identity of the bulletin an ending was read from. NHC's advisory key
 *  changes with every advisory; JTWC's warning number changes with every
 *  warning. Either one moving is what proves a newer bulletin exists. */
function bulletinKey(storm) {
  if (storm?.source === 'nhc') return storm.advisoryKey || null;
  const n = storm?.jtwc?.warningNumber ?? storm?.jtwcFinal?.warningNumber;
  return n == null ? null : `jtwc:${n}`;
}

function revive(id) {
  const rec = ended.get(id);
  if (!rec) return false;
  ended.delete(id);
  console.warn(
    `[landfall] ${rec.storm.name} is publishing again — ended state cleared (SPEC §5)`
  );
  return true;
}

/* ---------------------------------------------------------------------------
 * THE POLL HOOKS — what data/store.js calls
 * ------------------------------------------------------------------------- */

/**
 * One source's clean poll.
 *
 * ==> ONLY EVER CALLED FOR A SUCCESSFUL FETCH. <== A failed poll must not reach
 * this function at all, which is why there is no `status` parameter to get
 * wrong: the absence of a call IS the "no votes" case, and a boolean would let
 * a future caller pass the wrong one and silently start killing storms on
 * network errors. data/store.js calls this from its success branch and nowhere
 * else.
 *
 * @param {'nhc'|'gdacs'} source
 * @param {object[]} storms that source's freshly parsed list
 */
export function observeSource(source, storms) {
  const list = Array.isArray(storms) ? storms : [];
  const now = Date.now();
  const present = new Set(list.map((s) => s.id));
  let dirty = false;

  /* --- 1. refresh what we know, and revive anything that came back -------- */
  for (const s of list) {
    const prevTrack = seen.get(s.id)?.track || ended.get(s.id)?.track || [];
    /* The geometry may not have landed yet — it is warmed asynchronously and a
     * storm's first poll always precedes it. Keeping the previous capture is
     * what makes that harmless: the track only ever improves, and an empty
     * fetch never overwrites a good one (the same rule data/cache.js states). */
    const fresh = compactTrack(getGeometry(s.id));
    seen.set(s.id, {
      storm: s,
      track: fresh.length >= prevTrack.length ? fresh : prevTrack,
      absent: 0,
      source,
      at: now,
    });
    if (ended.has(s.id)) {
      const rec = ended.get(s.id);
      if (shouldRevive(rec, s, { finalNow: !!s.jtwcFinal })) dirty = revive(s.id) || dirty;
    }
  }

  /* --- 2. the truncation guard -------------------------------------------
   *
   * ==> AN EMPTY LIST IS NOT SPECIAL-CASED, AND THAT WAS A DELIBERATE REVERSAL.
   *
   * The first version of this refused to let an empty list vote at all, on the
   * grounds that a clean 200 with zero storms looks like a total upstream
   * failure. Two problems, and the second is the one that settled it:
   *
   *   1. IT DEADLOCKED. Once the baseline reached zero, `0 >= 0` passed the
   *      fraction test while the extra empty-list clause kept failing, so the
   *      guard fired forever and no storm could ever be confirmed absent again.
   *      Caught by tools/test-lifecycle.mjs, not by reading it.
   *   2. IT CONTRADICTED THE REST OF THE APP. `overallStatus` in data/store.js
   *      already treats zero storms from clean sources as `clear` — "the only
   *      true all-clear". Refusing to believe the same feed here would have the
   *      app calling the ocean empty on one surface while insisting a storm is
   *      still out there on another.
   *
   * Going 1 → 0 is also the single most common way a season's last storm ends,
   * and under the old rule that storm could never end — it would sit in the list
   * forever, eventually degrading to `silent` and reading "may no longer be
   * active" for the rest of the year.
   *
   * So the fraction test is the whole guard. 8 → 0 fails it and costs one
   * non-voting poll, exactly like any other collapse; 1 → 0 costs the same one
   * poll. What is left exposed is a source that answers 200-with-nothing for
   * four consecutive polls, and that is an acceptable trade here for a reason
   * specific to this state: being wrong greys one dot for 36 hours and REVIVES
   * ITSELF the moment the storm is published again. The behaviour it replaced
   * deleted the storm on the first poll with no recovery at all. */
  const prevSize = baseline[source] || 0;
  const credible = list.length >= prevSize * ENDED.minCredibleFraction;
  baseline[source] = list.length; // adopted either way — see the header on deadlock
  if (!credible) {
    console.warn(
      `[landfall] ${source} list went ${prevSize} → ${list.length} in one poll —` +
        ' no absence confirmations counted this cycle (SPEC §5)'
    );
    trim();
    if (dirty) changed();
    else save();
    return;
  }

  /* --- 3. count absences, and confirm the ones that have run out --------- */
  for (const [id, rec] of seen) {
    if (rec.source !== source || present.has(id)) continue;
    rec.absent = (rec.absent || 0) + 1;
    if (rec.absent < ENDED.absentConfirmations) continue;
    if (promote(id, { reason: 'absent', by: source, at: null, key: bulletinKey(rec.storm) })) {
      dirty = true;
    }
  }

  trim();
  if (dirty) changed();
  else save();
}

/**
 * The DECLARED path — read the bulletins and believe what they say.
 *
 * Asynchronous, and therefore deliberately NOT awaited by the store: storms
 * must draw on the poll they arrive, and this can take a round trip per NHC
 * storm. It emits through `onLifecycleChange` when it finds something, which is
 * the only reason that callback exists.
 *
 * COST. GDACS storms are free — the flag rides in on the JTWC index the wind
 * join already fetches (lib/jtwc-wind.js `matchJtwcFinal`). NHC storms cost one
 * advisory-text read each, and `fetchAdvisory` is cached per advisory key, so
 * the real cost is one relay read per storm per new advisory — six hours apart,
 * against a route the cron already warms. It also pre-warms the advisory
 * section for the storm the user is about to tap.
 */
export async function observeDeclarations(storms) {
  const list = Array.isArray(storms) ? storms : [];
  let dirty = false;

  for (const s of list) {
    if (!s?.id || ended.has(s.id)) continue;

    if (s.source === 'gdacs') {
      if (!s.jtwcFinal) continue;
      dirty = promote(s.id, {
        reason: 'declared',
        by: 'jtwc',
        at: s.jtwcFinal.at,
        /* No `became` for JTWC. Its final warning describes what the system did
         * in prose we do not parse, and inventing a transition from its wind
         * numbers would be exactly the derived-claim-stated-as-fact this whole
         * state exists to avoid. */
        became: null,
        key: `jtwc:${s.jtwcFinal.warningNumber ?? '?'}`,
      }) || dirty;
      continue;
    }

    if (s.source !== 'nhc') continue;

    let rec;
    try {
      rec = await fetchAdvisory(s);
    } catch {
      continue; // unreadable text is not evidence of anything
    }
    /* ==> A FAILED READ IS NOT A NON-FINAL ADVISORY. <== `state` is checked
     * before the text is looked at, because `isNhcFinalAdvisory('')` returns
     * false perfectly honestly and that false would be indistinguishable from
     * a real "this advisory does not end the storm". Only `ok` carries words. */
    if (rec?.state !== 'ok' || !isNhcFinalAdvisory(rec.text)) continue;

    dirty = promote(s.id, {
      reason: 'declared',
      by: 'nhc',
      /* NHC's own issuance, so the badge's clock matches NHC's archive. */
      at: s.observedAt,
      /* The ONE place this app describes a physical transition, and only
       * because NHC's own classification field is what makes the claim
       * (lib/lifecycle.js `becameWhat`). A storm still classified TD/TS/HU at
       * its final advisory gets null: NHC stopped writing and nothing
       * published says what became of it. */
      became: becameWhat(s.nature),
      key: s.advisoryKey || null,
    }) || dirty;
  }

  if (dirty) changed();
}

/* ---------------------------------------------------------------------------
 * READING THE ANSWER
 * ------------------------------------------------------------------------- */

/**
 * Ended storms still inside their grace period, ready to be merged into the
 * list.
 *
 * SWEEPS AS IT READS. Expiry is a display rule with no event behind it —
 * nothing happens at 36 hours except that the storm stops being worth screen
 * space — so there is no timer, and the sweep rides the read that would have
 * shown the stale record. A `setInterval` here would exist purely to delete
 * something nobody was looking at.
 */
export function endedStorms(now = Date.now()) {
  const out = [];
  let dropped = false;
  for (const [id, rec] of ended) {
    if (endedExpired(rec.storm, now)) {
      ended.delete(id);
      dropped = true;
      continue;
    }
    out.push(rec.storm);
  }
  if (dropped) save();
  return out;
}

/** True when this id is in the registry — data/store.js uses it to keep an
 *  ended storm from being listed twice if a feed briefly re-lists it before the
 *  revive path has run. */
export function isRegisteredEnded(id) {
  return ended.has(id);
}

/** Test seam. Clears every scrap of state, in memory and on disk, so a suite
 *  can run scenarios in sequence without one bleeding into the next. */
export function resetLifecycle() {
  ended = new Map();
  seen = new Map();
  baseline = { nhc: 0, gdacs: 0 };
  try { localStorage.removeItem(STORAGE_KEY.ended); } catch { /* fine */ }
}

/* Load once at module init, like every other persisted store in the project.
 * Guarded because the test harness and the Pages Functions runtime have no
 * localStorage, and a store that cannot persist must still work. */
if (typeof localStorage !== 'undefined') load();
