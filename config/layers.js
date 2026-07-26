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
 * ==> [APPROVE] THIS WORDING IS DRAFTED, NOT SIGNED OFF <==
 * All UI wording needs Aaron's explicit approval before it ships. These
 * strings are the ones outstanding as of 2026-07-26.
 *
 * THE SECOND SENTENCE ON THE GLOBAL GROUP IS THE LOAD-BEARING ONE. ECMWF is
 * generally the strongest track model in the world and it is NOT in TCGP's
 * decks — confirmed by reading one. Without saying so, a Pacific typhoon
 * showing three tight lines reads as a better-understood storm than an
 * Atlantic hurricane showing four spread ones, when the real difference is
 * that we are looking at a thinner SOURCE. That is a §5 confident-wrong
 * impression produced entirely by what we chose to draw.
 *
 * NO ACCURACY CLAIM ANYWHERE HERE, for the reason recorded in
 * MODEL_TRACKS.techs: no verification ranking was found for these three, and
 * reputation is not evidence.
 */
const MODEL_FAMILY_COPY = Object.freeze({
  [MODEL_FAMILY.NHC]: Object.freeze({
    label: 'Atlantic & East Pacific',
    note: '',
  }),
  [MODEL_FAMILY.GLOBAL]: Object.freeze({
    label: 'West Pacific & Indian Ocean',
    note: 'Each line averages one forecast centre’s runs. '
      + 'The European model isn’t published for these basins.',
  }),
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
    note: MODEL_FAMILY_COPY[family]?.note || '',
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
    /* THE NOTE NAMES THE MISSING HALF, NOT THE WHOLE ROW.
     *
     * Aaron asked for a flat "Coming soon…" here on 2026-07-26, believing the
     * row was unbuilt — and from his seat it was, because the control drove
     * NOTHING: map/layers/watch-warning.js registered as a baseline layer with
     * no `pairId`, so `engine.setPair('coastal', …)` matched no definition and
     * the stripe drew regardless of which segment was lit. That is fixed in the
     * same pass, so Off and Watch/warning both work now.
     *
     * Which makes "Coming soon…" the wrong words: it would tell the user that
     * the live half — the official watch and warning paint, the most
     * safety-relevant thing on the coastline — is not built. §7's note
     * precedence exists precisely to stop a row claiming a working layer is
     * broken. Surge is the part that is missing, so Surge is what the note
     * names. */
    note: 'Surge coming soon.',
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
    label: 'Cities',
    /* Ships ON, but arrives late in the zoom (ADMIN.cityIn) — the decluttering
     * is done by zoom first and this toggle second. */
    default: true,
    phase: 1,
    fetches: false,
  }),
  /* LAST IN THE GROUP, deliberately. Home marker, state names and cities are
   * things you look FOR; the grid is the thing you look THROUGH. It is also
   * the only row here that ships off, so putting it at the bottom means the
   * three switches that are on read as a block rather than being interrupted
   * by one that is not. */
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
