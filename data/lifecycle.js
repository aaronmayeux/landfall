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
 *   ABSENT    nobody said anything, and the storm is simply gone from a list
 *             that is otherwise answering normally. Counted in CLEAN
 *             CONFIRMATIONS, never in elapsed time.
 *
 *             TWO LISTS COUNT, NOT ONE. A storm's own source is the obvious
 *             one. JTWC'S ACTIVE ROSTER IS THE SECOND, and it is what makes
 *             this state reachable at all for a GDACS storm: GDACS does not
 *             reliably retire anything (`iscurrent: "true"` sat on Bertha for
 *             ~58 hours, and NOUL-26 stayed listed for days after her last
 *             analysis), so such a storm never goes absent from its own feed
 *             AND never gets a declaration either, because JTWC drops it from
 *             the active list shortly after the final warning. Both routes
 *             structurally could not fire, and the storm was immortal. Step 4
 *             of `observeSource` is the fix; its guards are documented there.
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
 * allowed to be loose: ending a storm greys one dot for 24 hours and REVIVES
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
import { scopedKey } from '../lib/replay-mode.js';
import { isSilent, silenceAge } from '../lib/silence.js';
import { timeMsOf, windKtOf, categoryIndexOf, normalizePastPoints } from '../lib/track-point.js';
import { fetchAdvisory } from './advisory.js';
import { getGeometry } from './cache.js';

/** Schema version. A bump throws the stored blob away rather than migrating —
 *  the cost of losing it is at most 24 hours of grey dots, and a migration path
 *  for a store this young is more code than the data is worth.
 *
 *  2 (2026-08-10) — the discard IS the fix, not a side effect of one. Devices
 *  that had run `?replay=ida` were carrying Hurricane Ida in `seen`, and the
 *  two changes below stop that happening again but cannot reach a record
 *  already written. There is no way to clear a phone's localStorage remotely;
 *  a version bump is the lever this store was given for exactly this. */
const VERSION = 2;

/** Where this store lives — moved aside on a replay page (lib/replay-mode.js).
 *
 *  ==> A REPLAY MUST NOT WRITE 2021 INTO THE REAL DEVICE'S STORM STORE. <==
 *  The replay is the real app on real archived bytes, so it saves storms
 *  exactly as designed; the store had no way to know they were five years old.
 *  Resolved ONCE at module load rather than per call, because that is when the
 *  load below runs and a key that changed underneath the save would strand the
 *  blob it had just read. */
const KEY = scopedKey(STORAGE_KEY.ended);

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
    raw = JSON.parse(localStorage.getItem(KEY));
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
    if (!rec?.storm?.id) continue;
    /* SWEPT ON THE WAY IN TOO, and this half was missing until 2026-08-10.
     * A last-known record older than `seenMaxAge` is not evidence of a live
     * storm; it is evidence of a device that was closed. Loaded intact it
     * fails the next few polls, gets confirmed absent, and is stamped as
     * having ended TODAY — the app reporting a week-old death as fresh news.
     * Dropped instead: a storm that is genuinely still out there is put back
     * by the next poll with current data. See `ENDED.seenMaxAge`. */
    if (!rec.at || now - rec.at > ENDED.seenMaxAge) continue;
    seen.set(id, rec);
  }
  if (raw.baseline) baseline = { ...baseline, ...raw.baseline };
}

function save() {
  try {
    localStorage.setItem(
      KEY,
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

/** Features → compact tuples:
 *  `[lon, lat, timeMs, windKt|null, catIndex|null, catCode|null]`.
 *
 *  ==> `catCode` IS THE SIXTH ELEMENT BECAUSE LEAVING IT OUT FLATTENED EVERY
 *  GDACS RIDGE, AND THE BUG LOOKED LIKE A RENDERING FAULT. <==
 *
 *  A GDACS hurricane legitimately has `_catIndex: null` — its strongest
 *  published band IS the Cat 1 floor, so the source cannot say WHICH hurricane
 *  it is — and carries its severity entirely in `_catCode: 'HU'`
 *  (data/gdacs-points.js). Persisting the index alone therefore threw away the
 *  ONLY severity signal those points have.
 *
 *  MEASURED, one point through the round trip:
 *    live       index null · code "HU" · #FF4FA3 · 109.5 kt  → real lift
 *    rehydrated index null · code ""   · #B5474D · null      → sevFromKt(null)
 *
 *  `sevFromKt(null)` is the cage's NOISE FLOOR, so every bead on every ended
 *  GDACS storm sat at exactly the height of the flattened head — a completely
 *  level ridge in the wrong color, which reads as "the mesh is broken" rather
 *  than as lost data. Aaron caught it on glass within the hour.
 *
 *  THAT SYMPTOM IS NO LONGER REACHABLE — an ended storm contributes no beads to
 *  the cage at all now (map/storm-mesh.js). `_catCode` is still carried, and
 *  must be: the restored MAP TRAIL colors from the same points, and a storm
 *  that revives gets its ridge back off this record.
 *
 *  The lesson is the same one the slot-emptying pass learned: an NHC point and a
 *  GDACS point are not the same shape, and anything that round-trips a point has
 *  to carry what the WEAKER source uses, not what the richer one happens to fill
 *  in.
 *
 *  A five-element tuple from before this fix leaves `_catCode` undefined and
 *  behaves as it did. No migration: records expire inside
 *  `ENDED.holdFor`, so the old shape cannot outlive a day and a half. */
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
      /* The source's own intensity letter. Null for an NHC point, which carries
       * a real index and needs none; load-bearing for a GDACS one, which has no
       * index at all. */
      p._catCode == null ? null : String(p._catCode),
      /* WHERE THE INDEX ABOVE CAME FROM (§49.3). Without it a rehydrated point
       * has a category and no provenance, and the past figures on the home
       * dashboard cannot say whether a finished storm's strength is the
       * agency's grading or our arithmetic on its wind. An NHC point has no
       * stamp and is 'reported' by construction; a GDACS one carries whichever
       * data/gdacs-points.js resolved. A SIX-element tuple written before this
       * existed leaves it undefined and reads back as unknown, which is true —
       * and records expire inside `ENDED.holdFor` anyway, so the old shape
       * cannot outlive a day and a half. */
      p._catStamped ? (p._catSource ?? null) : 'reported',
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
    ([lon, lat, t, windKt, catIndex, catCode, catSource]) => ({
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
        /* Restored under the parser's own field name, so `trackPointReading`
         * finds a GDACS hurricane's severity exactly where it looks for it on a
         * live point. Omitted rather than nulled when absent: the reading falls
         * through on a falsy code either way, and an explicit null in the
         * property bag suggests the source said something when it did not. */
        ...(catCode ? { _catCode: catCode } : {}),
        /* Stamped only when it was persisted. Absent means "we do not know",
         * which is the honest reading of a tuple written before §49.3 — and
         * `normalizePastPoints` treats a stamped point with no source as
         * exactly that rather than defaulting it to 'reported'. */
        ...(catSource ? { _catSource: catSource } : {}),
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
  const pastPoints = rehydrateTrack(rec.track);
  return {
    layers: {
      pastPoints,
      pastTrack: rehydrateLine(rec.track),
    },
    forecast: [],
    /* ==> THE ONE THING A FINISHED STORM STILL HAS (§49.3). <== `forecast` is
     * empty above because there is nothing left to forecast; the observed
     * track is the whole of what this bundle is for, and normalizing it here
     * means the home dashboard's past figures survive the storm leaving the
     * feed. Same function, same shape, from the same features the map draws. */
    past: normalizePastPoints(pastPoints.fc?.features || []),
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
 * up to a poll interval, which does not matter for expiry — that is measured
 * from `confirmedAt` (lib/lifecycle.js `endedExpired`), not from here — and does
 * matter for the badge: "issued its final advisory Thu 11:00 AM" has to be the
 * agency's clock, not ours, or a reader comparing it against NHC's own archive
 * finds two different times for one event.
 */
function promote(id, { reason, by, at, became, key }) {
  const prev = seen.get(id);
  const held = ended.get(id);
  const base = prev?.storm || held?.storm;
  if (!base) return false;

  /* ==> A STORM ALREADY IN THE REGISTRY IS NOT RE-ENDED. ONE ENDING PER STORM.
   * <==
   *
   * Nothing checked this, on the unexamined assumption that a promotion is a
   * one-off — which holds for `declared` and `absent`, because both need the
   * storm to be GONE from something, and a successful promotion deletes it
   * from `seen` so neither route can see it again.
   *
   * `lapsed` breaks the assumption completely: it fires on a storm that is
   * STILL IN ITS SOURCE'S LIST, which is the entire reason the route exists.
   * `endedExpired` measures the display window from `confirmedAt`, so a second
   * promotion silently restarts the countdown. MEASURED on DOLPHIN-26's real
   * timings: 48 h of simulated polling, and `confirmedAt` was the current poll
   * every single time. The storm could not expire on any device, ever. Aaron
   * on glass 2026-08-12, two days after the 12-hour window landed and did
   * nothing.
   *
   * ==> THE PATH THAT ACTUALLY REACHES THIS LINE IS THE UPGRADE, NOT THE
   * STEADY STATE. <== `observeSource` step 1 now keeps an ended storm out of
   * `seen` entirely, so steps 3, 4 and 5 cannot see one, and
   * `observeDeclarations` skips registry members at the top of its loop. What
   * is left is a device whose PERSISTED state has the storm in both maps —
   * every phone that ran the previous build — where a stale working-set entry
   * collects absence votes for a storm the parse cutoff has already dropped.
   * tools/test-abandoned.mjs holds that scenario.
   *
   * NO UPGRADE PATH, AND THAT IS THE EXISTING BEHAVIOUR RATHER THAN A NEW
   * RULE. A lapse is never rewritten into a declaration, because
   * `observeDeclarations` has always refused to look at a storm already in the
   * registry. Wanting that later means changing two places deliberately, which
   * is the right price for a rule about overwriting a fact already shown. */
  if (held) return false;

  const stampedAt = at || base.observedAt || new Date().toISOString();
  const storm = {
    ...base,
    ended: Object.freeze({
      reason,   // 'declared' | 'absent' | 'lapsed'
      by,       // 'nhc' | 'jtwc' | 'gdacs' — who SPOKE; null when nobody did
      at: stampedAt,
      /* WHEN WE WORKED IT OUT, which is a different moment from `at` and is
       * the one the display window is measured against (lib/lifecycle.js
       * `endedExpired`). Two fields because the badge and the expiry want
       * opposite ends of the same event: the badge must quote the agency's
       * clock so a reader can find the bulletin, and the expiry must not,
       * because on `absent` and `lapsed` the agency's clock IS `observedAt`
       * and a window anchored there is already spent before it opens.
       *
       * WRITTEN EXACTLY ONCE PER STORM, which is what makes anchoring on it
       * safe at all — see the guard at the top of this function. */
      confirmedAt: new Date().toISOString(),
      became: became || null,
      /* What we were looking at when we decided. Not shown to anyone; it is
       * how `shouldRevive` recognises that a NEWER bulletin has arrived. */
      key: key || null,
    }),
  };

  ended.set(id, { storm, track: prev?.track || held?.track || [], at: Date.now() });
  seen.delete(id);
  trim();
  return true;
}

/* ---------------------------------------------------------------------------
 * THE MISSING-TRACK REPAIR
 *
 * The two seams data/ended-track.js needs, and nothing more. The DECISION to go
 * and fetch, which fetcher to use, and how often to give up all live in that
 * file; this half only knows what the registry holds and how to write to it.
 * ------------------------------------------------------------------------- */

/**
 * Does this ended storm have a past track worth drawing, and could it get one?
 *
 * ==> `lapsed` AND ONLY `lapsed`. <== The other two endings mean the storm has
 * left its source's list — NHC flushes the bin, GDACS archives the event — so
 * there is no address left to ask and a fetch would spend a round trip to learn
 * nothing, which is the rule `load` in app/bundle-pipeline.js states. A lapse is
 * the opposite case by definition: the source is STILL LISTING the storm and has
 * merely stopped analysing it, so the geometry is still there. Measured
 * 2026-08-12 on DOLPHIN-26, two days after its last analysis: GDACS was still
 * serving 54 past-track segments for it.
 *
 * FEWER THAN TWO POINTS IS THE TEST, not zero. One point is not a line and
 * cannot draw a trail, so a record holding one is as blank on glass as a record
 * holding none.
 */
export function endedNeedsTrack(id) {
  const rec = ended.get(id);
  if (!rec) return false;
  if (rec.storm?.ended?.reason !== 'lapsed') return false;
  return (rec.track?.length || 0) < 2;
}

/**
 * Write a freshly-fetched geometry bundle's past track into an ended record.
 *
 * THE SAME `compactTrack` THE LIVE PATH USES, deliberately — a backfilled track
 * and one captured while the storm was alive have to be byte-identical in shape,
 * or the map and the ridge would read the same storm two different ways
 * depending on when the device happened to arrive.
 *
 * LONGER WINS, AND NOTHING ELSE DOES. The same rule `observeSource` follows for
 * a live storm: a track only ever improves, and a short or empty answer never
 * replaces a good one. That is what makes this safe to call on every poll
 * without a second guard against a half-published payload.
 *
 * Returns true when the record actually changed, so the caller can tell a real
 * repair from a no-op — and `changed()` fires only then, because a save and a
 * store-wide re-emit for a write that changed nothing is a redraw of the whole
 * globe for no reason.
 */
export function fillEndedTrack(id, bundle) {
  const rec = ended.get(id);
  if (!rec) return false;
  const fresh = compactTrack(bundle);
  if (fresh.length < 2 || fresh.length <= (rec.track?.length || 0)) return false;
  ended.set(id, { ...rec, track: fresh });
  changed();
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
function shouldRevive(rec, storm, { finalNow, jtwcListed = null }) {
  if (!rec || !storm) return false;
  if (rec.storm.ended.reason === 'absent') {
    /* ==> WHOSE LIST WENT QUIET IS WHOSE LIST HAS TO SPEAK UP. <==
     *
     * An absence confirmed against the storm's OWN source is contradicted the
     * moment the storm is back in that source's list, and this function is only
     * reached for a storm that IS in the list — so `true` is the whole test.
     *
     * An absence confirmed against JTWC's ROSTER is a different claim. That
     * storm never left GDACS; being in the GDACS list is not new information
     * and contradicts nothing. Returning `true` here would promote and revive
     * the same storm on alternating polls forever, logging an ending every
     * cycle — the exact deadlock the truncation guard's header warns about,
     * arriving from the other direction. Only JTWC listing it again is
     * evidence, and `null` (nobody could ask) is not that. */
    if (rec.storm.ended.by === 'jtwc') return jtwcListed === true;
    return true;
  }

  /* ==> `lapsed` HAS ITS OWN TEST AND MUST NOT FALL THROUGH TO THE ONE BELOW.
   * <== The declared test compares bulletin numbers, and a GDACS storm with no
   * JTWC warning has no bulletin key at all — `bulletinKey` returns null, the
   * test short-circuits false, and a lapsed storm would NEVER revive. That is
   * the worst failure in this file: a grey "no longer tracked" dot sitting on a
   * system GDACS has started analysing again, which is an all-clear over a live
   * storm.
   *
   * The evidence that contradicts a lapse is a NEWER ANALYSIS, so that is what
   * is compared: the `observedAt` we lapsed on, against the one in hand. Not
   * "is it in the list" — it never left the list, which is the whole reason
   * this route exists. Not `datemodified`, which moves without a fix behind it
   * (lib/silence.js documents that decoy).
   *
   * A record with no stored stamp revives. It cannot defend the decision that
   * was made, and the safe direction is the live storm. */
  if (rec.storm.ended.reason === 'lapsed') {
    const lapsedOn = rec.storm.ended.key;
    if (!lapsedOn) return true;
    return !!storm.observedAt && storm.observedAt !== lapsedOn;
  }

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
    const prev = seen.get(s.id);
    const held = ended.get(s.id);
    /* READ BEFORE THE REVIVE BELOW CAN DELETE IT. A revived storm's track has
     * to survive the revival — it is the same storm and the same history, and
     * on the poll it comes back the geometry cache may not have refilled yet. */
    const prevTrack = prev?.track || held?.track || [];

    /* JTWC's verdict on this storm, as three states and never two.
     * `true` it is on the active list, `false` it is not, `null` we could not
     * credibly ask (lib/jtwc-wind.js only attaches the field on a clean index,
     * and NHC storms never carry it at all). */
    const listed = s.jtwcRoster ? s.jtwcRoster.listed === true : null;

    /* ==> THE ENDED QUESTION IS SETTLED FIRST, AND AN ENDED STORM DOES NOT GO
     * BACK INTO THE WORKING SET. <==
     *
     * This used to write `seen` unconditionally and then ask about reviving,
     * which put a storm in BOTH maps at once for the one case that matters:
     * a `lapsed` GDACS storm, which is still in its source's list by
     * definition. `promote` now refuses to re-end it — but refusing returns
     * before the `seen.delete` that a successful promotion does, so the stale
     * working-set entry survived, went on accruing absence votes, and lapsed
     * the storm all over again the moment its grey window expired. The zombie
     * came back twelve hours later wearing a fresh timestamp.
     *
     * `seen` means "believed still alive". A storm in the registry is not, so
     * it belongs in exactly one of the two maps and this is where that is
     * enforced. The `delete` covers a device carrying a record written before
     * this rule existed. */
    if (held) {
      if (shouldRevive(held, s, { finalNow: !!s.jtwcFinal, jtwcListed: listed })) {
        dirty = revive(s.id) || dirty;
      } else {
        seen.delete(s.id);
        continue;
      }
    }

    /* The geometry may not have landed yet — it is warmed asynchronously and a
     * storm's first poll always precedes it. Keeping the previous capture is
     * what makes that harmless: the track only ever improves, and an empty
     * fetch never overwrites a good one (the same rule data/cache.js states). */
    const fresh = compactTrack(getGeometry(s.id));

    seen.set(s.id, {
      storm: s,
      track: fresh.length >= prevTrack.length ? fresh : prevTrack,
      absent: 0,
      /* HAS JTWC EVER CARRIED THIS STORM? Sticky, and it is the entire guard on
       * the roster route below. GDACS covers systems JTWC does not warn on at
       * all, and for those the roster is not silence — it is a list that was
       * never going to mention them. Only a storm JTWC has actually listed can
       * be killed by falling off that list. */
      jtwcSeen: listed === true || !!prev?.jtwcSeen,
      absentJtwc: nextJtwcAbsence(prev, listed),
      source,
      at: now,
    });
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
   * specific to this state: being wrong greys one dot for 24 hours and REVIVES
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

  /* --- 4. JTWC's roster, the SECOND authority over a GDACS storm ---------
   *
   * ==> WHY THIS EXISTS: GDACS DOES NOT RELIABLY RETIRE STORMS. <== Step 3
   * assumes a dead storm eventually falls out of its own source's list. NHC
   * honours that. GDACS does not — it left `iscurrent: "true"` on Bertha for
   * ~58 hours (see the SILENCE note in config/constants.js) and it kept NOUL-26
   * listed for days after her last analysis. A storm in that condition can
   * never be confirmed absent, because it never goes absent; and it can never
   * be confirmed declared either, because the ONLY bulletin that exists for
   * those basins is JTWC's and JTWC drops a storm from its active list shortly
   * after the final warning. Miss that window — one afternoon with the app
   * closed — and the storm is immortal. That is what a grey dot sitting on the
   * globe three and a half days after its last transmission actually was: not a
   * grace period that was too long, but two death routes that both structurally
   * could not fire.
   *
   * SO THE ROSTER ITSELF IS THE EVIDENCE. JTWC is the agency writing bulletins
   * for these basins, and its active list is a feed that answers cleanly and
   * removes storms it has finished with. A storm falling off it is exactly the
   * same shape of evidence step 3 acts on — a list that is otherwise working
   * and no longer contains the storm — so it gets the same treatment, the same
   * confirmation count, and the same words. It is NOT a timer, which is the
   * thing this file refuses to add: a JTWC outage produces no `jtwcRoster` at
   * all and moves the tally by zero.
   *
   * THREE GUARDS, AND ALL THREE ARE LOAD-BEARING:
   *   - `jtwcSeen`. Only a storm JTWC has actually listed can be killed by
   *     falling off the list. A South Atlantic system JTWC never warns on would
   *     otherwise be absent from the roster from birth.
   *   - The credibility check above. A poll that did not earn a vote in step 3
   *     does not get to cast one here either; the early return covers both.
   *   - SILENCE. The storm must also have stopped being analysed. JTWC walking
   *     away from a system GDACS is still publishing fixes on is not evidence
   *     that the storm is over — see the note at the check itself.
   *
   * `by: 'jtwc'` because the roster is JTWC's, and §5's attribution rule is
   * that the copy names WHOEVER SPOKE rather than whose storm it is. The
   * reader gets "The Joint Typhoon Warning Center stopped listing this system"
   * — which is precisely and only what happened. No new wording. */
  if (source === 'gdacs') {
    for (const [id, rec] of seen) {
      if (rec.source !== 'gdacs') continue;
      if ((rec.absentJtwc || 0) < ENDED.absentConfirmations) continue;
      /* ==> THE THIRD GUARD: THE STORM MUST ALREADY BE SILENT. <==
       *
       * JTWC leaving is not the same as the storm being over. It stops warning
       * when a system leaves its area of responsibility or drops below its
       * warning criteria, and GDACS can keep publishing real analyses on that
       * system afterwards. Killing a storm whose fixes are still arriving,
       * because a DIFFERENT agency stopped writing about it, would be a §5 lie
       * of the worst kind — a grey "no longer tracked" dot over a live storm.
       *
       * `isSilent` is the check that nobody is publishing anything: over
       * `SILENCE.after` since the newest analysis, read off `observedAt` and no
       * other timestamp (lib/silence.js documents why the others lie). A storm
       * that is both silent AND off JTWC's roster has two independent agencies
       * having stopped, which is as much agreement as these basins can offer.
       *
       * IT IS NOT A TIMER SNEAKING IN. The clock alone still cannot end
       * anything — a storm silent for a month with JTWC still warning on it
       * stays live. The roster is the evidence; this only refuses to act on
       * that evidence while the storm is visibly still being analysed. */
      if (!isSilent(rec.storm, now)) continue;
      if (promote(id, { reason: 'absent', by: 'jtwc', at: null, key: bulletinKey(rec.storm) })) {
        dirty = true;
      }
    }
  }

  /* --- 5. lapsed: the source is still listing it and has stopped analysing it
   *
   * ==> THE ROUTE OF LAST RESORT, AND THE ONLY ONE NOBODY HAS TO ACT FOR. <==
   * Steps 3 and 4 both need a list to drop the storm. GDACS does not drop
   * storms — `iscurrent` means "not archived yet", it held for ~58 h on Bertha
   * and it is still `"true"` on KUJIRA-26 two days after the last analysis. A
   * storm nobody warns on and nobody retires is unreachable by every other
   * route in this file and would sit on the globe until the season ended.
   *
   * ==> IT IS A TIMER, WHICH THIS FILE OTHERWISE REFUSES, AND HERE IS THE
   * DIFFERENCE. <== Step 4's header says a JTWC outage must move the tally by
   * zero, because there the clock would be standing in for evidence we failed
   * to fetch. Here the clock IS the evidence. The claim is not "this storm is
   * over" — `endedNote` for `lapsed` says so in as many words. The claim is
   * "nobody has published a position for two days", and the only thing that
   * can establish that is elapsed time against a stamp we hold.
   *
   * SILENCE IS IMPLIED, NOT ASSUMED. `lapsedAfter` is twice `SILENCE.after`,
   * so anything past it is necessarily silent — but `isSilent` is still the
   * gate rather than a bare subtraction, so that the two thresholds can never
   * be edited into disagreement, and so an unparseable `observedAt` (which
   * `isSilent` treats as "we know nothing either way") cannot end a storm.
   *
   * `by: null` — nobody spoke. `key` carries the stamp we lapsed ON, which is
   * what `shouldRevive` compares against to notice a fresh analysis. */
  for (const [id, rec] of seen) {
    if (rec.source !== source) continue;
    if (!isSilent(rec.storm, now)) continue;
    if ((silenceAge(rec.storm, now) ?? 0) <= ENDED.lapsedAfter) continue;
    if (promote(id, {
      reason: 'lapsed', by: null, at: null, key: rec.storm.observedAt || null,
    })) {
      dirty = true;
    }
  }

  trim();
  if (dirty) changed();
  else save();
}

/**
 * The next JTWC-roster absence tally for a storm, given the last one and this
 * poll's verdict.
 *
 * FOUR CASES, WRITTEN OUT, because three of them are easy to collapse into a
 * plain reset and each collapse is a different bug:
 *
 *   listed        0.  JTWC is carrying the storm. Contradicted; start over.
 *   not listed,
 *     ever seen   +1. The evidence this route runs on.
 *   not listed,
 *     never seen  0.  JTWC does not warn on this system and never did. Its
 *                     list is silent about the storm, not about its fate.
 *   no verdict    HOLD. The index was unavailable or partial, so we could not
 *                     ask. Resetting here would mean a JTWC outage quietly
 *                     protects a dead storm; counting would mean it kills a
 *                     live one. Neither is evidence, so neither happens.
 */
function nextJtwcAbsence(prev, listed) {
  const held = prev?.absentJtwc || 0;
  if (listed === null) return held;
  if (listed === true) return 0;
  return prev?.jtwcSeen ? held + 1 : 0;
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
 * nothing happens at 24 hours except that the storm stops being worth screen
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

/** Test seam. Clears every scrap of state, in memory and on disk, so a suite
 *  can run scenarios in sequence without one bleeding into the next. */
export function resetLifecycle() {
  ended = new Map();
  seen = new Map();
  baseline = { nhc: 0, gdacs: 0 };
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
}

/* Load once at module init, like every other persisted store in the project.
 * Guarded because the test harness and the Pages Functions runtime have no
 * localStorage, and a store that cannot persist must still work. */
if (typeof localStorage !== 'undefined') load();
