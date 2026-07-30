/**
 * volcano-field.js — WHICH volcanoes are drawn, WHERE they are, and HOW LOUDLY
 * each one should read. Portable on purpose.
 *
 * PROTOTYPE CODE. Not wired into the app.
 *
 * Same split `ripple-field.js` makes and for the same reason: this file owns
 * the data and knows nothing about globes, THREE, or drawing. Any world can
 * consume it, and when Phase F swaps the flat marks for instanced edifices
 * NOTHING IN HERE CHANGES — only `volcano-marks.js` does.
 *
 * ==> TWO FETCHES THAT FAIL INDEPENDENTLY, AND THAT IS THE WHOLE DESIGN. <==
 * The catalog is a static file in the repo; the live union is a Cloudflare
 * Function. Either can be down without the other, and the two failures mean
 * completely different things on screen:
 *
 *   catalog down   nothing can be drawn at all. Hard failure.
 *   live down      the quiet tier still draws, and the app MUST SAY that what
 *                  is erupting right now is unknown. A globe showing 128 calm
 *                  volcanoes during a relay outage is SPEC.md §5's exact
 *                  failure — the app reporting calm about places it cannot see.
 *
 * So the return carries per-channel state and the caller is expected to word
 * both. There is no single `ok`.
 *
 * ==> AND THE ERUPTING SET IS A UNION, NEVER AN INTERSECTION. <== A volcano
 * erupting today is drawn whether or not it made the activity tier. Measured
 * against the live weekly report 2026-07-30: 6 of the 22 currently-erupting
 * volcanoes fall OUTSIDE the tier. Filtering the live set by history hides all
 * six. See `VOLCANO.marks` and SPEC-GLOBES §42.1.1.
 *
 * Imports: config/constants.js and lib/volcano-severity.js. No DOM, no THREE.
 */

import { VOLCANO } from '../config/constants.js';
import { severityScore } from '../lib/volcano-severity.js';
import { volcanoFamily } from '../lib/volcano-shape.js';

const M = VOLCANO.marks;
const S = VOLCANO.state;

/**
 * Is this volcano erupting right now, according to any of the three feeds?
 *
 * ==> THE JUDGEMENT IS THREE OR-ED TESTS AND EACH ONE EXISTS BECAUSE THE OTHER
 * TWO ARE BLIND TO SOMETHING. <== The reasoning is written out beside
 * `VOLCANO.marks.alertColoursErupting`; the short version is that an effusive
 * eruption emits no ash and appears in no VAAC traffic, while the weekly feed
 * cannot see an ash cloud that started this morning.
 *
 * `report.erupting` is NOT re-derived here. The relay decides it (`_union.js`)
 * because `New Unrest` is not an eruption and a regex at this end got that
 * right only by coincidence.
 *
 * @param {object} live the `live` bag from one entry of the relay's `volcanoes`
 */
function isErupting(live) {
  if (!live) return false;
  if (live.report && live.report.erupting) return true;
  /* An advisory that reached us has already survived the relay's 24-hour
   * staleness cut, so its presence means ash aloft NOW rather than ash aloft
   * at some point. The cut lives there, not here — one home. */
  if (live.ash) return true;
  if (live.alert && live.alert.colour) {
    return M.alertColoursErupting.includes(String(live.alert.colour).toUpperCase());
  }
  return false;
}

/**
 * Fetch and merge. Resolves even when things fail — a rejected promise here
 * would leave the caller with nothing to word, and §5 says every async surface
 * states loading, empty and error explicitly.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl] injectable, so this is testable
 * @returns {Promise<object>} see the shape at the bottom of this function
 */
export async function loadVolcanoField({ fetchImpl = fetch } = {}) {
  const catalog = { state: S.unavailable, error: null, count: 0 };
  const live = {
    state: S.unavailable,
    error: null,
    /** Live volcanoes that could not be placed — see the block below. */
    unplaceable: [],
    /** The relay's own per-source states, passed straight through. NOTHING
     *  here may collapse three feeds into one badge: three ages means one
     *  badge lies in whichever direction it rounds. */
    sources: null,
    fetchedAt: null,
  };

  /* ---- the two fetches, in parallel, neither able to sink the other ----- */
  const [catRes, liveRes] = await Promise.all([
    fetchImpl(VOLCANO.catalogUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .catch((e) => ({ __error: e })),
    fetchImpl(VOLCANO.liveUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .catch((e) => ({ __error: e })),
  ]);

  /* ---- the catalog: without it nothing can be drawn ---------------------- */
  if (catRes.__error) {
    catalog.error = catRes.__error.message;
    return { marks: [], counts: empty(), catalog, live };
  }
  const features = (catRes && catRes.features) || [];
  catalog.count = features.length;
  catalog.state = features.length ? S.ok : S.clear;

  /** Everything the catalog knows, keyed on the GVP number — the join key the
   *  relay publishes against (`VOLCANO.dedupeKey`). */
  const byNumber = new Map();
  for (const f of features) {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || null;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    byNumber.set(p.n, { props: p, lon: c[0], lat: c[1] });
  }

  /* ---- the live union ---------------------------------------------------- */
  /** GVP numbers erupting right now. */
  const eruptingNow = new Set();
  if (liveRes.__error) {
    live.error = liveRes.__error.message;
  } else {
    live.sources = liveRes.sources || null;
    live.fetchedAt = liveRes.fetchedAt || null;
    const entries = liveRes.volcanoes || [];
    for (const v of entries) {
      if (!isErupting(v.live)) continue;
      if (byNumber.has(v.n)) {
        eruptingNow.add(v.n);
      } else {
        /* ==> AN ERUPTING VOLCANO WE CANNOT PLACE IS COUNTED, NEVER DROPPED
         * IN SILENCE. <== Measured live 2026-07-30: Anchorage publishes
         * `PAVLOF 1102-03`, a region-style number GVP retired in 2013, which
         * joins nothing. Aaron has ruled out building a crosswalk, so the
         * honest answer is that the count is VISIBLE rather than fixed. A
         * screen that says "128 volcanoes, 22 erupting" while quietly binning
         * a 23rd is the §5 failure at one-volcano scale. */
        live.unplaceable.push({ n: v.n, name: nameOf(v) });
      }
    }
    /* THE RELAY'S OWN WORST CHANNEL WINS, and it is not this file's job to
     * out-rank it. `unavailable` or `degraded` on any one feed means the
     * erupting set on screen is incomplete, and the caller has to say so —
     * `clear` from all three is a genuinely quiet planet and reads differently
     * from a relay that could not see the Pacific. */
    live.state = worstState(live.sources);
  }

  /* ---- the draw set: the union, and the tier is the smaller half --------- */
  const marks = [];
  let quiet = 0;
  let erupting = 0;
  let submarine = 0;

  for (const [n, entry] of byNumber) {
    const isLive = eruptingNow.has(n);
    const tierValue = Number(entry.props[M.tierField] || 0);
    const inTier = tierValue >= M.tierMin;
    /* THE UNION. `isLive` first and on its own line because it is the rule:
     * live state outranks history everywhere the two disagree, and no severity
     * score may ever decide whether a live eruption appears. */
    if (!isLive && !inTier) continue;

    const sub = Number(entry.props.elev) < 0;
    marks.push({
      n,
      name: entry.props.name || String(n),
      lon: entry.lon,
      lat: entry.lat,
      /** 0–1, and it ranks the QUIET only. An erupting mark draws at a fixed
       *  size regardless of this number — see `VOLCANO.marks.eruptingPx`. */
      sev: severityScore(entry.props),
      erupting: isLive,
      submarine: sub,
      /** ==> WHICH OF §42.1.2's SIX SILHOUETTES THIS IS. <== Added in Phase F,
       *  and it belongs here rather than in the renderer for the same reason
       *  `sev` does: "what kind of thing is this" is decided by reading catalog
       *  fields, so it is testable without a GPU and it is decided once.
       *  `lib/volcano-shape.js` is the only implementation. */
      family: volcanoFamily(entry.props),
      /** Summit elevation in metres, above SEA rather than above the volcano's
       *  own base — see §42.1.2. Negative underwater, which is what `submarine`
       *  above is derived from. The renderer's exaggeration curve reads this. */
      elev: Number(entry.props.elev),
    });
    if (isLive) erupting++;
    else quiet++;
    if (sub) submarine++;
  }

  /* Erupting last so they draw ON TOP of the quiet tier where they overlap.
   * At 429 px across, 1 px is about 30 km and the Kamchatka cluster is tighter
   * than that — without this a live eruption can end up underneath a dormant
   * neighbour, which is the one stacking order this layer must not have. */
  marks.sort((a, b) => Number(a.erupting) - Number(b.erupting));

  return {
    marks,
    counts: { total: marks.length, quiet, erupting, submarine, catalog: features.length },
    catalog,
    live,
  };
}

function empty() {
  return { total: 0, quiet: 0, erupting: 0, submarine: 0, catalog: 0 };
}

/** The relay names a volcano three different ways depending on which feed saw
 *  it. Any of them beats printing a bare number at someone. */
function nameOf(v) {
  const l = v.live || {};
  return (
    (l.report && l.report.weeklyName) ||
    (l.alert && l.alert.hansName) ||
    (l.ash && l.ash.eruptionDetails) ||
    String(v.n)
  );
}

/** The worst of the three channel states, because a partial view of the world
 *  is not a quiet world. Order is the same one `_union.js` uses. */
function worstState(sources) {
  if (!sources) return S.unavailable;
  const rank = [S.unavailable, S.degraded, S.stale, S.clear, S.ok];
  let worst = S.ok;
  for (const key of ['ash', 'weekly', 'alerts']) {
    const st = sources[key] && sources[key].state;
    if (!st) return S.unavailable;
    if (rank.indexOf(st) < rank.indexOf(worst)) worst = st;
  }
  return worst;
}
