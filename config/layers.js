/**
 * layers.js — THE LAYER MANIFEST (SPEC §7).
 *
 * The layer system takes an arbitrary number of layers; there is no cap.
 * Every layer the app can draw is declared HERE, once, and three things read
 * this list: the Layers view (what rows to draw), data/layer-prefs.js (what
 * state to persist and which toggles are mutually exclusive), and main.js
 * (what to hand the render engine). Adding a layer later means adding an
 * entry — never editing the panel, the prefs store, or the engine.
 *
 * WHY A MANIFEST RATHER THAN LAYER FILES DECLARING THEMSELVES:
 * map/layers/*.js already self-register with the RENDER engine, and that
 * stays true. But the panel must show rows for layers that are not built yet
 * — §7's "rows dim, they never disappear": a missing toggle looks like a bug,
 * a dimmed one with a reason is information. A row for an unbuilt layer has
 * no file to register it, so the inventory cannot live in the render layer.
 *
 * THREE TYPES (§7):
 *   'baseline'  — always drawn, no toggle. Listed here for completeness only;
 *                 the panel does not render rows for these.
 *   'pair'      — mutually exclusive siblings fighting for the same map space.
 *                 Rendered as a SEGMENTED CONTROL, never two switches: two
 *                 switches imply both-on is possible.
 *   'additive'  — an independent on/off.
 *
 * `phase` is honesty, not scheduling. A layer whose phase has not shipped
 * renders dimmed with `note` as its reason, and cannot be toggled.
 *
 * Imports: config/constants.js only — for the model shortlist, which is
 * behavioural data (§12's "constants hold sources") rather than manifest.
 */

import { MODEL_FAMILY, MODEL_TRACKS } from './constants.js';

/** Panel groups, in render order (§7's three-group sketch). */
/* TWO GROUPS NOW, NOT THREE. The Imagery group held exactly one control —
 * the satellite/radar segmented pair — under a heading that repeated the
 * control's own label directly above it ("IMAGERY" / "Imagery"). A group of
 * one is not a group; it is a divider with a redundant name attached, and it
 * pushed the pair away from Coastal, which is the row it belongs beside. Both
 * are things drawn over the storm, both are segmented pairs, both answer
 * "what else do I want on top of this". The pair moved into Storm detail
 * directly after Coastal and the heading retired (2026-07-25). */
export const LAYER_GROUP = Object.freeze({
  STORM: 'storm',
  REFERENCE: 'reference',
});

export const GROUP_LABEL = Object.freeze({
  [LAYER_GROUP.STORM]: 'Storm detail',
  [LAYER_GROUP.REFERENCE]: 'Reference',
});

/** Which phases have actually shipped. A layer at or below this is live;
 *  above it renders dimmed with its note. ONE place to bump when a step
 *  lands, so no row can claim to work before its data source exists. */
export const SHIPPED_THROUGH = 4;

/**
 * Layers that shipped AHEAD of their phase completing.
 *
 * A phase is not one delivery. Phase 6 is six separate layers arriving over
 * as many passes, so a single `SHIPPED_THROUGH` number cannot describe it:
 * bumping it to 6 the day the wind field lands would also un-dim surge,
 * model tracks, and advisory text, every one of which would then present a
 * working control that draws nothing — the exact §5 failure the dimming
 * exists to prevent.
 *
 * So: the number covers whole finished phases, this set covers early
 * arrivals within an unfinished one. A key here is live regardless of phase.
 *
 * WHEN PHASE 6 IS DONE, bump SHIPPED_THROUGH to 6 and empty this set. It is
 * a bridge, not a permanent second mechanism.
 */
export const SHIPPED_EARLY = Object.freeze(
  new Set([
    /* Phase 6 step 2 — BOTH SOURCES, confirmed on a phone 2026-07-24. §14's
     * both-sources rule is satisfied for this layer: NHC draws a swept
     * envelope, GDACS draws its own published corridor, and the control
     * means the same thing on either. */
    'windCurrent',
    'windSwath',
    /* Phase 6 step 3 — peak storm surge. NHC only, and US Gulf/Atlantic coasts,
     * Puerto Rico and the USVI only at that. §14's both-sources rule is not
     * satisfied — but note that it is not satisfied by the OTHER segment of
     * this pair either: GDACS publishes no watch/warning product
     * (`data/gdacs.js`), so the whole Coastal row is NHC-only and its note
     * says so about the row rather than about surge alone.
     *
     * Drawn against Hurricane Milton's published archive rather than a live
     * storm: the Peak Storm Surge service only answers while a US surge watch
     * is in effect. `/?surge=milton` is the fixture on the real layer. */
    'surge',
    /* Phase 6 step 5 — model guidance tracks. NHC only, and that is the
     * standing exception rather than a gap: GDACS publishes no model output
     * at all (§14). The row draws for GDACS storms with its reason stated. */
    'modelTracks',
    /* Phase 7 — satellite and radar discs, BOTH SOURCES and every basin.
     * Four satellites across two vendors cover the whole tropical belt, and
     * they render through one palette so an Indian Ocean cyclone and an
     * Atlantic hurricane read identically (§4). Radar is US-only by nature
     * and says so on the row rather than drawing a blank raster. */
    'satellite',
    'radar',
    /* §45 — genesis areas. Its own step, past every numbered phase, so it has
     * no whole phase for SHIPPED_THROUGH to cover. Listed here rather than
     * bumping that number, which would also un-dim every unbuilt phase-5/6/7
     * row and present controls that draw nothing — the exact §5 failure the
     * dimming exists to prevent. BOTH SOURCES: NHC publishes the polygons,
     * JTWC covers everywhere else, and the row means the same thing on
     * either. */
    'genesis',
    /* §47 — the environment ribbon. Its own step, past every numbered phase,
     * so it has no whole phase for SHIPPED_THROUGH to cover. Listed here
     * rather than bumping that number, which would also un-dim every unbuilt
     * phase-5/6/7 row.
     *
     * NHC BASINS ONLY, and that is a fact about the world rather than a gap in
     * our plumbing: SHIPS is published for the Atlantic and the East and
     * Central Pacific and nowhere else (§47.6). §14's both-sources rule is not
     * satisfied and cannot be. The row says so per storm — a typhoon gets
     * "Not published for storms in this basin" rather than a flat cone that
     * looks like a calm environment, which is the one outcome §5 forbids. */
    'environment',
    /* §48.21 — NWS flood alerts. Its own step, past every numbered phase, so it
     * has no whole phase for SHIPPED_THROUGH to cover.
     *
     * ==> IT SHIPPED WITHOUT THIS LINE AND THE ROW WAS INVISIBLE. <== The
     * manifest entry, the engine key, the layer file and the toggle were all
     * correct and complete; `isLive` reads THIS SET, saw `phase: 9` against a
     * `SHIPPED_THROUGH` of 4, and presented the control as not-built-yet. The
     * feature was live, the switch was not, and nothing failed — which is the
     * dimming mechanism doing exactly its job against a layer that forgot to
     * declare itself. Adding a row here is two edits, and this is the second.
     *
     * US ONLY, and §14's both-sources rule is not satisfied and cannot be: NWS
     * publishes flood products for the United States and no global equivalent
     * of /alerts/active has been found. The switch's own note says so rather
     * than a reader discovering it over a typhoon. */
    'floodAlerts',
  ])
);

/* --- per-model selection ----------------------------------------------------
 * Which models draw is a SUB-CHOICE of the model-tracks layer, so it is
 * persisted inside the layer record under this one key rather than in a
 * preference store of its own — see the note in data/layer-prefs.js.
 * ------------------------------------------------------------------------ */

export const MODEL_PREF_KEY = 'models';

/**
 * Every model ON by default.
 *
 * The layer's whole point is the SPREAD — how much the models disagree — and
 * a spread shown with half the models missing is not a smaller version of
 * that answer, it is a different and more confident-looking one. The
 * selector exists so the user can narrow to a comparison they care about
 * ("where does GFS depart from the consensus"), which is a deliberate act,
 * not the starting state.
 */
export function defaultModelState() {
  const out = {};
  for (const m of MODEL_TRACKS.techs) out[m.pref] = true;
  return out;
}

/** The selector's rows: one per PREF (not per tech — TVCN and HCCA share a
 *  slot), grouped, in manifest order. The view renders whatever this
 *  returns and holds no list of its own. */
/**
 * Header copy for each model-source family.
 *
 * ==> [APPROVE] LABELS ONLY. THE COVERAGE SENTENCE WAS CUT (Aaron,
 * 2026-07-26). <==
 * A note explaining which models are absent was drafted and rejected. Do not
 * re-add it. The headers say which storms a group applies to and nothing more,
 * which is the job they were added for.
 */
const MODEL_FAMILY_COPY = Object.freeze({
  [MODEL_FAMILY.NHC]: Object.freeze({ label: 'Atlantic & East Pacific' }),
  [MODEL_FAMILY.GLOBAL]: Object.freeze({ label: 'West Pacific & Indian Ocean' }),
});

/**
 * The per-model selector, grouped for rendering.
 *
 * ==> TWO LEVELS NOW, BECAUSE THERE ARE TWO SOURCES <==
 * Model guidance comes from NOAA for the Atlantic and East/Central Pacific and
 * from UCAR's TCGP everywhere else, and the two share NO model codes at all
 * (measured on a live West Pacific deck, 2026-07-26). The layer draws on every
 * storm worldwide at once, so with a hurricane and a typhoon both up, one
 * control has to carry both sets.
 *
 * HEADERS APPEAR ONLY WHEN BOTH FAMILIES ARE ON SCREEN — the same rule the
 * storm list already uses for basin headings, and for the same reason: a
 * heading over the only group present is a word that tells you nothing. With
 * one family up this renders exactly as it did before.
 *
 * @param {Set<string>|null} present Which families have storms right now. Null
 *        or empty means "show everything" — an honest default for a caller
 *        that does not know yet, since hiding a group we cannot rule out would
 *        be a coverage claim we have not earned.
 */
export function modelSelectorGroups(present = null) {
  const seen = new Set();
  /** family → group id → rows */
  const families = new Map();

  for (const m of MODEL_TRACKS.techs) {
    if (seen.has(m.pref)) continue;
    seen.add(m.pref);
    if (!families.has(m.family)) families.set(m.family, new Map());
    const groups = families.get(m.family);
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push({ pref: m.pref, label: m.label, tech: m.tech, sub: m.sub });
  }

  const wanted = present && present.size
    ? [...families.keys()].filter((f) => present.has(f))
    : [...families.keys()];

  /* Nothing matched — a storm in a basin neither source covers, or no storms
   * at all. Show everything rather than an empty control: a selector that
   * vanishes reads as a broken panel, and §5's rule is that absence must never
   * be silent. */
  const keys = wanted.length ? wanted : [...families.keys()];

  return keys.map((family) => ({
    family,
    label: MODEL_FAMILY_COPY[family]?.label || '',
    /* Headers are the CALLER's decision to render, but the count that decides
     * it belongs here beside the data. */
    showHeader: keys.length > 1,
    groups: [...families.get(family)].map(([id, rows]) => ({ id, rows })),
  }));
}

/* --- exclusive pairs (§7) ---------------------------------------------------
 * Each pair is a segmented control.
 *
 * EVERY PAIR HAS AN OFF SEGMENT (2026-07-26, Aaron's ask). It used to be
 * imagery's alone, on the reasoning that one sibling of the other two is always
 * drawn — which describes the DEFAULT, not a rule. Wind bands and the coastal
 * stripe are both translucent area over the map, and with several storms active
 * the thing you want is frequently neither of the two. "Pick which of these two
 * you cannot switch off" is not a choice a decluttering control should force.
 *
 * A `neither: true|false` flag used to sit on each entry describing exactly
 * this. NOTHING EVER READ IT — grepped 2026-07-26, zero consumers. The Off
 * segment has always come from an `off` entry in `options`, which is where the
 * view and the prefs store both look, so the flag was a second declaration of
 * the same fact that could disagree with the first (and did: all three said
 * something different from what shipped). Retired rather than wired up — one
 * source for one idea, and `options` is already it.
 *
 * AN OFF SEGMENT IS ALWAYS `phase: 1` WITH A NULL KEY. Drawing nothing has
 * shipped since the first commit; there is no source that can fail to deliver
 * it. Giving it a real phase would let `pairLiveOptions` dim a segment whose
 * whole job is to be available.
 * ------------------------------------------------------------------------ */

/** The Off segment, identical in all three pairs. Built by a helper rather
 *  than typed three times: the second copy of a pattern is where it starts
 *  drifting (§12), and a pair whose Off carried a different phase or a
 *  non-null key would dim or mis-dispatch for reasons nobody could see. */
const offOption = () => Object.freeze({ value: 'off', label: 'Off', key: null, phase: 1 });

export const LAYER_PAIRS = Object.freeze([
  Object.freeze({
    id: 'windField',
    group: LAYER_GROUP.STORM,
    label: 'Wind field',
    /* BACK TO CURRENT, same day it was changed to swath (2026-07-25). The
     * argument for the swath — it shows what has been hit and what is in line
     * to be — is sound in the abstract and wrong on a globe with several
     * storms on it: a full-track envelope for every active system is a lot of
     * translucent area, and it competes with the cone, which is the shape that
     * actually answers "where is this going". Current bands stay tied to a
     * point, so they read as the storm rather than as weather in general.
     * The swath is one tap away for the storm you are studying. */
    /* STILL 'current', not 'off'. The default answers "what should a stranger
     * arriving by shared link during a hurricane see" (§1), and how far the
     * dangerous wind reaches is part of that answer. Off is a control for
     * someone who has looked and wants the map back. */
    default: 'current',
    options: Object.freeze([
      offOption(),
      Object.freeze({ value: 'current', label: 'Current', key: 'windCurrent', phase: 6 }),
      Object.freeze({ value: 'swath', label: 'Full track', key: 'windSwath', phase: 6 }),
    ]),
    /* NO NOTE, deliberately. This used to read "Wind bands are NHC-only for
     * now" and that stopped being true on 2026-07-24, when GDACS bands were
     * confirmed on a phone across all three thresholds. A standing caveat
     * that has been overtaken is worse than none: it tells the user a
     * working layer is broken. Restore a note here only if a source
     * genuinely stops drawing. */
  }),
  Object.freeze({
    id: 'coastal',
    group: LAYER_GROUP.STORM,
    label: 'Coastal',
    default: 'watchWarning',
    options: Object.freeze([
      offOption(),
      Object.freeze({ value: 'watchWarning', label: 'Watch/warning', key: 'watchWarning', phase: 4 }),
      Object.freeze({ value: 'surge', label: 'Surge', key: 'surge', phase: 6 }),
    ]),
    /* ==> THE NOTE CHANGED SUBJECT RATHER THAN DISAPPEARING. <==
     *
     * It read "Surge coming soon." until surge shipped. Deleting it outright
     * was the first instinct and it was wrong twice over: the segment was
     * still DIMMED at the time (it was not in `SHIPPED_EARLY`), so for one
     * deploy this row offered an unreachable control with no explanation of
     * why — which is worse than the stale note it replaced, because a dimmed
     * row that says nothing reads as broken rather than as unbuilt.
     *
     * Now that it draws, the honest note is about COVERAGE, not readiness —
     * and the FIRST VERSION OF THAT NOTE WAS WRONG. It read "Surge is
     * published for US coasts only. Watch/warning covers every storm," which
     * is false in its second half: `data/gdacs.js` sets
     * `can.watchWarning: false` — GDACS publishes no watch/warning product
     * either — and NHC only carries them when the feed's
     * `windWatchesWarnings` is populated. Aaron caught it.
     *
     * THE ROW WAS NHC-ONLY AND THE WATCH/WARNING HALF NO LONGER IS (§50.11).
     * Foreign agencies' cyclone warnings now paint the same coastal stripe,
     * through the same selector, from the CAP feed — so a Philippine or a
     * Caribbean storm can draw one where it never could before.
     *
     * ==> IT IS STILL NOT "EVERY STORM", AND THE NOTE MUST NOT SAY SO. <==
     * The first version of the old note claimed that and Aaron caught it. CAP
     * matching runs through GDACS's affected countries (§50.3), so a storm
     * out at sea has no country to look up and an agency that publishes no
     * CAP feed contributes nothing. An empty coast still has to be readable
     * as "nobody has warned here", never as an all-clear (§5).
     *
     * SURGE REMAINS NARROWER AND UNCHANGED: the US Gulf and Atlantic coasts,
     * Puerto Rico and the USVI. */
    note: 'Watch/warning covers US storms plus any country publishing an alert. Surge is US only.',
  }),
  Object.freeze({
    id: 'imagery',
    /* Sits in Storm detail, immediately after Coastal — pairs render in
     * manifest order within their group, so this entry's POSITION in this
     * array is what puts it there. Moving it up or down this list moves the
     * row on screen; there is no second ordering to keep in step. */
    group: LAYER_GROUP.STORM,
    label: 'Imagery',
    default: 'off',
    options: Object.freeze([
      offOption(),
      Object.freeze({ value: 'satellite', label: 'Satellite', key: 'satellite', phase: 7 }),
      Object.freeze({ value: 'radar', label: 'Radar', key: 'radar', phase: 7 }),
    ]),
    /* A STANDING CAVEAT, not a not-built-yet message: true whenever this
     * control is on, rather than something a later phase removes. The per-row
     * status says it per storm; this says it up front so nobody switches to
     * Radar over the mid-Atlantic and reads the empty result as a fault.
     *
     * IT USED TO CLAIM "the US and its territories" AND THAT IS MORE THAN CAN
     * BE BACKED. Probing the relay on 2026-07-26 returned 2.2-3.7% echo across
     * CONUS and 0.58% at Anchorage, but only 0.06-0.08% at Honolulu and San
     * Juan — indistinguishable from empty. One frame cannot tell "not in this
     * mosaic" from "clear skies there today", so the note no longer names
     * territories it cannot vouch for.
     *
     * What IS certain is the shape of the limit, and it is RANGE, not
     * nationality: ground radar sees a couple of hundred miles from each site,
     * so a hurricane far offshore has nothing looking at it even in the middle
     * of the Gulf. That is the sentence a user actually needs. */
    note: 'Radar only reaches storms near land. Satellite is worldwide.',
  }),
]);

/* --- additive toggles ---------------------------------------------------- */

export const LAYER_TOGGLES = Object.freeze([
  /**
   * GENESIS — the areas being watched (§45).
   *
   * FIRST IN THE GROUP, ABOVE EVERY PER-STORM ROW, AND THAT POSITION IS THE
   * ARGUMENT. Every other row in Storm detail decorates a storm that already
   * exists; this one is the only layer that draws when there is nothing else
   * on the globe at all. Pairs and toggles render in manifest order within
   * their group, so this array position is what puts it there — there is no
   * second ordering to keep in step.
   *
   * SHIPS ON. The question §1 asks — what should a stranger arriving by shared
   * link during a hurricane see — has a second half nobody had written down:
   * what should they see when there is no hurricane yet. Measured on
   * 2026-08-09, `CurrentStorms.json` returned `{"activeStorms":[]}` while the
   * outlook published five watched areas, one at 80% over seven days. A
   * default of OFF would ship an app that is completely empty and completely
   * wrong at the same time, and would put the honest answer behind a switch
   * nobody knows to look for.
   *
   * `fetches: true` — two upstreams, so this row CAN go amber, and it must be
   * able to. §45.5 splits the failure states three ways: `unavailable` (the
   * outlook errored), `none_matched` (it answered and published nothing), and
   * `clear` (no storms and no areas). Only the third is an all-clear, and a
   * row that cannot show a source outage would let the first quietly render as
   * the third.
   */
  Object.freeze({
    key: 'genesis',
    group: LAYER_GROUP.STORM,
    label: 'Areas being watched',
    default: true,
    phase: 8,
    fetches: true,
    /* The engine key this drives (map/layers/genesis.js). Identical to the
     * pref key and STILL stated, for the reason `modelTracks` learned the hard
     * way: main.js only pushes toggles that name one, so omitting it means the
     * switch flips, the data loads, the features build — and the map layer
     * stays `visibility: none`. Identical names are exactly when an assumed
     * mapping looks safest and fails silently. */
    engineKey: 'genesis',
  }),
  Object.freeze({
    key: 'forecastTimes',
    group: LAYER_GROUP.STORM,
    label: 'Forecast times',
    /* DEFAULT ON (§7): "when does it get here" is the second question after
     * "how bad is it", and a cone without times is just a shape. The toggle
     * exists for decluttering, not because times are optional. */
    default: true,
    phase: 4,
    /* Pure RENDER toggle — the times ride along in the forecast points
     * GeoJSON already being fetched, so this row can never go amber. */
    fetches: false,
    /* The engine key this drives (map/layers/points-forecast.js). Differs
     * from the pref key, so the mapping is explicit rather than assumed. */
    engineKey: 'forecastPoints',
  }),
  /**
   * THE CONE WAS A BASELINE LAYER UNTIL 2026-07-25 — drawn always, no switch.
   *
   * The reasoning was that the cone IS the forecast: it is the single most
   * load-bearing shape on the map, the thing NHC leads every advisory with,
   * and a storm without one is a dot with no future. That is all still true,
   * which is why it defaults ON and why this is not a decluttering control in
   * the way the graticule is.
   *
   * What changed is the count. With several storms active and every one of
   * them drawing an ambient cone, the translucent veils overlap and the map
   * goes milky — and the moment you want to read a single storm's track
   * against the coastline, the neighbouring cones are the thing in the way.
   * A layer that is right 95% of the time and genuinely obstructive the other
   * 5% is a layer that needs a switch, not a layer that needs removing.
   *
   * Placed between Forecast times and Model tracks because those three are the
   * forecast-confidence group: when it gets here, how wide the official
   * uncertainty is, and how much the models disagree.
   */
  Object.freeze({
    key: 'cone',
    group: LAYER_GROUP.STORM,
    label: 'Cone of uncertainty',
    /* DEFAULT ON. It is the official forecast envelope; hiding it by default
     * would be hiding the answer. */
    default: true,
    phase: 4,
    /* Pure render toggle — the cone rides the geometry bundle that is fetched
     * for every storm regardless, so this row can never go amber. */
    fetches: false,
    engineKey: 'cone',
  }),
  /**
   * THE ENVIRONMENT RIBBON (§47) — the cone colored by whether the
   * environment is helping the storm or hurting it.
   *
   * DIRECTLY UNDER THE CONE, AND THAT POSITION IS THE ARGUMENT. It does not
   * add a shape; it changes one. Grouping it with the thing it modifies is
   * what makes the pair read as "the cone, and how the cone is painted"
   * rather than as two unrelated overlays. Toggles render in manifest order
   * within their group, so this array position is what puts it there.
   *
   * SHIPS OFF, and it is the second fetching layer to do so. The question a
   * stranger arriving by shared link during a hurricane is asking is "where is
   * it going" (§1), and the cone already answers that. This is the follow-up —
   * why the forecast says what it says — and it is an expert read in the same
   * way model guidance is. The off default also gates the WARMING: a run is
   * fetched per storm once this is on, so leaving it off costs a first-time
   * visitor nothing.
   *
   * `fetches: true` — one upstream, so this row CAN go amber and it must be
   * able to. §47.6 splits the absences three ways and only one of them is a
   * fault: a basin SHIPS does not cover, a storm with no run published yet,
   * and the relay failing. A row that could not show the third would let it
   * render as one of the first two, which is the §5 silence exactly.
   *
   * THE NOTE IS NOT DECORATION. "Environment" alone does not say what the
   * color means, and this is the only layer in the app whose color encodes a
   * SIGNED QUANTITY rather than a category — every other colored thing on the
   * globe is a class of storm, a watch, or a wind band. The per-storm absences
   * replace this line rather than appending to it (app/layer-status.js), so a
   * storm with no data never shows a row promising something the map is not
   * drawing.
   */
  Object.freeze({
    key: 'environment',
    group: LAYER_GROUP.STORM,
    label: 'Environment',
    default: false,
    phase: 9,
    fetches: true,
    /* ==> THE WORDING IS THE MODEL'S, NOT OURS (Aaron, 2026-08-16). <== It read
     *  "whether the environment is helping or hurting the storm", which is
     *  plain and is also the one register this layer must not use: helping and
     *  hurting are OUR verbs for a number SHIPS published, and a row that
     *  sounds like a judgement invites the reader to treat the color as our
     *  opinion. Naming the model says out loud that we are reporting rather
     *  than scoring — §47's founding rule.
     *
     *  ==> IT THEN SAID "net contribution to intensity" AND THAT WAS WRONG
     *  TWICE (2026-08-22). <== First, the file's own table is called
     *  INDIVIDUAL CONTRIBUTIONS TO INTENSITY **CHANGE**, and dropping the last
     *  word turns a change in wind speed into a share of the wind speed.
     *  Second and worse, it over-claimed: "the environment's" invites the
     *  reader to include the ocean, and the coloured sum is the ten
     *  ATMOSPHERIC rows — `SST POTENTIAL` is excluded on purpose (§47.4) and
     *  the sea's own ceiling is not in the table at all. Measured on the 2026
     *  corpus, 34 runs end in the ramp's brightest violet over water whose
     *  ceiling has collapsed 20 kt or more, so a reader taking "environment"
     *  to mean air AND sea is being misled on one storm in ten.
     *
     *  "What the air around the storm adds to or takes off its strength" is
     *  the same claim in words a person uses, it is literally what a
     *  contribution in knots IS rather than a judgement about it, and it
     *  survives both signs read aloud. The layer keeps the NAME Environment
     *  (§47.4's one-thing-one-name rule); this is the line that defines it,
     *  and the water is carried in words by §47.8's paragraph instead. */
    note: "Colors the cone by what the air around the storm adds to or takes off its strength, from NHC's SHIPS model.",
    engineKey: 'environment',
    /** ==> THE ROW CARRIES THE KEY TO ITS OWN COLOR (§47.11). <== The note
     *  above says the color means "helping or hurting"; it cannot say WHICH
     *  END IS WHICH, and this is the only layer in the app where that question
     *  exists — every other colored thing on the globe is a category with a
     *  fixed, named color the storm list has already taught the reader.
     *
     *  Expands in place while the row is ON, the same mechanism model tracks
     *  uses for its per-model swatches, and for the same reason: the control
     *  and the legend are one object and cannot drift apart. Declared here as
     *  a NAME rather than a boolean so `ui/view-layers.js` stays a generic
     *  renderer — a second layer with a scale adds a line to this file and
     *  nothing to that one. */
    legend: 'environment',
  }),
  Object.freeze({
    key: 'modelTracks',
    group: LAYER_GROUP.STORM,
    label: 'Model tracks',
    /* SHIPS OFF, and it is the only fetching layer that does.
     *
     * Model guidance is an EXPERT read — five lines of disagreement is the
     * right answer to "how confident is this forecast" and the wrong answer
     * to "where is the storm going", which is what a stranger arriving by
     * shared link during a hurricane is asking (§1). Defaulting it on would
     * put a hairball over the cone for the majority who did not ask for one.
     *
     * The off default also gates the WARMING: decks are fetched for every
     * storm once this is on, so leaving it off costs a first-time visitor
     * nothing on their connection. */
    default: false,
    phase: 6,
    fetches: true,
    /* ==> [APPROVE] THE NOTE IS GONE, AND ITS ABSENCE IS THE CHANGE <==
     *
     * It read 'Atlantic and Pacific storms only.' That was true when NOAA's
     * public a-deck directory was the only source: `ftp.nhc.noaa.gov/atcf/
     * aid_public/` holds `al`/`ep`/`cp` and nothing else.
     *
     * It is now FALSE. UCAR's TCGP publishes a-decks for the West Pacific,
     * North Indian and Southern Hemisphere, and as of 2026-07-26 the app
     * reads them (§15). Coverage is effectively global.
     *
     * IT WAS ALSO FALSE ONCE BEFORE, IN THE OTHER DIRECTION, and that is why
     * this comment is long. The row previously claimed "other sources publish
     * no model guidance" — corrected 2026-07-25 when Aaron read the copy.
     * Both mistakes are the same shape: a limit of OUR PLUMBING stated as a
     * fact about the world. The first said no guidance existed; the second
     * said it existed only where we happened to be fetching it.
     *
     * NOTHING REPLACES IT. A standing caveat has to be true on every storm
     * the row can draw, and there is no longer a sentence that is. The basins
     * genuinely left out — South Atlantic, Mediterranean — are so rare that a
     * permanent line about them would be noise on every real storm. The
     * per-storm states already tell the truth when it applies: `none` says no
     * guidance is published for THIS storm, `unsupported` says the basin is
     * not covered, and both say it about the storm in front of the user
     * rather than as a blanket claim. That is the more specific answer and it
     * is the one §5 asks for.
     *
     * If a note ever comes back here, the test is: is it true of EVERY storm
     * this row draws on? Neither of the last two was. */
    /* The engine key this drives (map/layers/model-tracks.js). It happens to
     * match the pref key here, and it is STILL stated: main.js only pushes
     * toggles that name one, so leaving it out meant the switch flipped, the
     * data loaded, the features were built — and the map layer stayed
     * `visibility: none`. A toggle that does nothing, with no error anywhere
     * (caught headless 2026-07-25, before glass). Identical names are exactly
     * when an assumed mapping looks safest and fails silently. */
    engineKey: 'modelTracks',
    /* Expands IN PLACE to a per-model selector (§7) — never a second panel,
     * because §16 allows one view at a time and there is no stack to push. */
    expands: true,
  }),
  /**
   * FLOOD ALERTS (§48.21) — NWS flood warnings, painted where they apply.
   *
   * ==> IT REOPENS §48.1 ON EVIDENCE RATHER THAN CONTRADICTING IT. <== That
   * section says rainfall has no map layer and that this is a decision, not a
   * gap, because NHC publishes no rainfall geometry — checked against their own
   * GIS index, where every other hazard has a product and rainfall has none.
   * Still true. A flood warning is a different product from a different agency,
   * issued for a polygon a forecaster drew, and that polygon travels in the
   * alert. §48.1's finding was about NHC's rainfall FORECAST; this is NWS's
   * statement about water already on the ground.
   *
   * SHIPS OFF, and for the reason model tracks and Environment do: the question
   * a stranger arriving by shared link during a hurricane is asking is "where
   * is it going" (§1), and green boxes over inland counties are not that
   * answer. The off default also gates the FETCH — nothing asks the relay for
   * this list until the switch goes on or a storm drawer needs its count — so a
   * first-time visitor pays nothing on their connection.
   *
   * `fetches: true` — its own upstream, so this row CAN go amber and it must be
   * able to. §5's three states all exist here and only one of them is an
   * all-clear: `unavailable` (the list errored), `none_matched` (it answered and
   * nothing is in force), and a genuinely quiet country. A row that could not
   * show a source outage would let the first render as the last, over a
   * flooding county.
   *
   * ==> THE NOTE NAMES THE LIMIT THAT WILL OTHERWISE READ AS A FAULT. <== It is
   * UNITED STATES ONLY, because NWS is, and no global equivalent of
   * /alerts/active has been found — the same shape of limit radar and surge
   * carry, and it is stated up front rather than discovered over a typhoon. It
   * also names the residue: a watch is issued by forecast zone rather than for a
   * drawn box, its boundaries are fetched separately (§56.4), and any that do
   * not come back are listed in words and never handed an invented shape.
   *
   * ==> IT SITS IN `Storm detail` AND IT IS NOT PER-STORM, AND THAT IS NOT A
   * MISMATCH. <== §56.1 once called it one, and Slice A made the layer
   * per-storm to resolve it. **That reading was wrong**: `genesis` — *Areas
   * being watched* — is in this same group and draws every watched area on
   * Earth with nothing selected. A map-wide layer in this group is already what
   * ships. The layer draws the whole country again as of 2026-08-23, Aaron's
   * call on glass, and the group stays put. Do not move it back on the old
   * argument.
   */
  Object.freeze({
    key: 'floodAlerts',
    group: LAYER_GROUP.STORM,
    label: 'Flood alerts',
    default: false,
    phase: 9,
    fetches: true,
    note: 'US only. A watch is issued by forecast zone, and its boundary is fetched separately — any that could not be resolved are listed and not drawn.',
    /* The engine key this drives (map/layers/flood.js). Identical to the pref
     * key and STILL stated, for the reason `modelTracks` learned the hard way:
     * main.js only pushes toggles that name one, so omitting it means the
     * switch flips, the data loads, the features build — and the map layer
     * stays `visibility: none`. */
    engineKey: 'floodAlerts',
  }),
  /* ADVISORY TEXT USED TO BE A ROW HERE. It is not a layer and never was.
   *
   * Removed 2026-07-25, Phase 6 step 6. A layer in this app is something
   * DRAWN ON THE GLOBE; advisory text is prose and draws nothing, so a row
   * here made this panel mean two different things at once — "what is on the
   * map" and "what is in the reading pane." It is also inherently per-storm:
   * there is no advisory without a selection, while every other row here is
   * map-wide.
   *
   * SPEC §16 item 7 had ALWAYS placed it in the storm drawer, collapsed. This
   * manifest entry was the half of the spec that disagreed with the other
   * half, and nobody noticed until Aaron asked where it should live. The
   * drawer won; the inventory in §7 is corrected to fifteen layers, four
   * additive.
   *
   * The one thing a toggle would have bought is a don't-fetch gate — and the
   * collapsed section is a better one, because it gates per storm and on
   * demand rather than globally. (Contrast model tracks, which WARMS every
   * storm and therefore genuinely needs a switch.)
   */
  Object.freeze({
    key: 'homeMarker',
    group: LAYER_GROUP.REFERENCE,
    label: 'Home marker',
    default: true,
    phase: 3,
    fetches: false,
  }),
  Object.freeze({
    key: 'stateNames',
    group: LAYER_GROUP.REFERENCE,
    label: 'State names',
    /* Ships ON: "which state is this heading for" is a real question at the
     * basin and regional bands. */
    default: true,
    /* Phase 1 — basemap furniture, same bucket as the graticule. `phase` here
     * answers "is this live", and these are style layers on the basemap that
     * has existed since phase 1, not a roadmap step of their own. */
    phase: 1,
    /* Zero network. The names come out of tiles the basemap already
     * downloads, so this row can never go amber. */
    fetches: false,
    /* NAMES ONLY. The state LINES are baseline and have no toggle — see
     * LAYER_BASELINE. Text is what clutters a map; a hairline division is
     * not, and removing it would delete information while buying back
     * almost no pixels. */
  }),
  Object.freeze({
    key: 'cities',
    group: LAYER_GROUP.REFERENCE,
    label: 'City names',
    /* Ships ON, but arrives late in the zoom (ADMIN.cityIn) — the decluttering
     * is done by zoom first and this toggle second. */
    default: true,
    phase: 1,
    fetches: false,
  }),
  /* AFTER THE THINGS YOU LOOK FOR, deliberately. Home marker, state names and
   * cities are marks you hunt for on the map; the grid is the thing you look
   * THROUGH. Putting it below them keeps the three switches that ship ON as an
   * unbroken block rather than interrupting them with one that ships OFF. */
  Object.freeze({
    key: 'graticule',
    group: LAYER_GROUP.REFERENCE,
    /* THE LABEL HAS CHANGED TWICE IN ONE DAY, AND THE PREF KEY NEVER HAS.
     * "Graticule" is the cartographer's word and almost nobody else's; it
     * became "Lat/long lines"; the layer then stopped being lat/long lines at
     * all and became the equator and the two tropics, so it is named for what
     * it now draws. The key stays `graticule` throughout because it is stored
     * on every device already and renaming it would silently reset the toggle
     * for anyone who had turned it on. */
    label: 'Tropics & equator',
    /* Ships OFF (§7): the 3D cage is the planet-band look, so the grid is
     * reference rather than decoration. */
    default: false,
    phase: 1,
    fetches: false,
  }),
  /**
   * POPULATION HEAT — where people are, as a field.
   *
   * City names labels the places; this shows how many people are in them, including
   * the ones too small for the basemap to ever label. During a landfall the
   * pair reads as "that is Tampa" and "that is a lot of people".
   *
   * LAST IN THE GROUP (moved below the grid 2026-08-07). Every other Reference
   * row is free — a style switch on tiles already downloaded. This one is the
   * only row that costs a download, so it belongs at the bottom of the list
   * rather than sitting in the middle of the free ones. It is also the row most
   * likely to be left alone, and the panel should lead with the switches people
   * actually touch.
   *
   * ==> THE ONLY ROW IN THIS GROUP THAT FETCHES, AND THEREFORE THE ONLY ONE
   * THAT CAN GO AMBER. <== Every other Reference row is basemap furniture or
   * a style toggle costing zero network. This one pulls 670 KB gzipped, once
   * per device, and `fetches: true` is what lets the panel say so honestly
   * instead of presenting a switch that appears dead on a bad connection.
   *
   * SHIPS OFF, for the same reason model tracks do (§1): the question a
   * stranger arriving by shared link during a hurricane is asking is "where is
   * it going", and the answer to that is the cone. This is the second
   * question, and it costs a megabyte to ask.
   *
   * Phase 1 — it draws from a file in the repo, with no source that can fail
   * upstream and no phase of its own to wait on.
   */
  Object.freeze({
    key: 'population',
    group: LAYER_GROUP.REFERENCE,
    label: 'Population',
    default: false,
    phase: 1,
    fetches: true,
    /* No `engineKey`. This is not an engine layer — map/population.js is
     * basemap furniture in the graticule's bucket, pushed by main.js on the
     * same one-call path. Naming a key here would have the geometry engine
     * hunting for a definition that does not exist, which is a silent no-op
     * and exactly the failure `engineKey` was added to prevent in the other
     * direction. */
  }),
]);

/* --- baseline layers (no toggles; inventory completeness only) ------------ */

export const LAYER_BASELINE = Object.freeze([
  Object.freeze({ key: 'stormMarkers', label: 'Storm markers', phase: 2 }),
  /* THE CONE MOVED OUT OF HERE (2026-07-25) — it is an additive toggle now,
   * default on. See the entry in LAYER_TOGGLES for why. */
  Object.freeze({ key: 'pastTrack', label: 'Past track', phase: 4 }),
  Object.freeze({ key: 'forecastTrack', label: 'Forecast track', phase: 4 }),
  Object.freeze({ key: 'forecastPoints', label: 'Forecast points', phase: 4 }),
  /* BORDER LINES HAVE NO TOGGLE, AND THAT IS THE DESIGN. Borders are
   * structural — hairlines that cost almost nothing visually and answer
   * "which state is this" simply by existing. Switching off the divisions
   * would delete real information and buy back barely any pixels. */
  Object.freeze({ key: 'countryBorders', label: 'Country borders', phase: 1 }),
  Object.freeze({ key: 'stateBorders', label: 'State & province lines', phase: 1 }),
  /* COUNTRY NAMES have no toggle either — the one exception to "text is what
   * toggles". They are a RUNG on the name ladder (ADMIN.nameLadder), not
   * decoration: for about a zoom level they are the only label on the map,
   * and switching them off would leave a bare unnamed globe in exactly the
   * band the ladder exists to fill. A control whose off state breaks the
   * design's own invariant should not exist. */
  Object.freeze({ key: 'countryNames', label: 'Country names', phase: 1 }),
]);

/* --- helpers -------------------------------------------------------------- */

/**
 * Has this layer shipped? The one place the question is asked.
 *
 * Takes the LAYER ENTRY, not a bare phase number, because the answer now
 * depends on the key as well: a layer named in SHIPPED_EARLY is live even
 * though its phase has not finished. Passing the whole entry also removes a
 * footgun — a bare `phase` and a whole entry would both have "worked" if
 * this took either, and one of them would silently be wrong.
 */
export const isLive = (entry) => {
  if (!entry) return false;
  if (entry.key && SHIPPED_EARLY.has(entry.key)) return true;
  return (entry.phase ?? 99) <= SHIPPED_THROUGH;
};

/** A pair is interactive only if MORE THAN ONE of its options is live —
 *  a segmented control with one usable segment is not a choice (the same
 *  reasoning that hides the scope filter with fewer than two scopes, §16). */
export function pairLiveOptions(pair) {
  return pair.options.filter((o) => isLive(o));
}

/** Groups in panel order, each with its pairs and toggles resolved. The view
 *  renders whatever this returns — it holds no inventory of its own. */
export function layerGroups() {
  return [LAYER_GROUP.STORM, LAYER_GROUP.REFERENCE].map(
    (id) => ({
      id,
      label: GROUP_LABEL[id],
      pairs: LAYER_PAIRS.filter((p) => p.group === id),
      toggles: LAYER_TOGGLES.filter((t) => t.group === id),
    })
  );
}

/** Default state for everything, used at first run and by Reset to defaults. */
export function defaultLayerState() {
  const out = {};
  for (const p of LAYER_PAIRS) out[p.id] = p.default;
  for (const t of LAYER_TOGGLES) out[t.key] = t.default;
  return out;
}
