/**
 * view-storms.js — the storm list, as a DRAWER VIEW (SPEC §16).
 *
 * THE LIST IS THE ACCESSIBILITY SURFACE. The WebGL canvas is aria-hidden;
 * this one visible list is simultaneously the click target, the Tab order,
 * and the screen-reader view of the globe. Not a hidden duplicate — those rot.
 *
 * WAS A PANEL, IS NOW A VIEW. It no longer owns an <aside>, a header, or its
 * own open/close state — ui/drawer.js owns all three, and this file owns only
 * its contents. The collapsed PILL survives as its own element outside the
 * drawer, because it is the narrow-width entry point rather than part of the
 * panel it opens.
 *
 * Shape:
 *   - Narrow: collapsed pill ("6 active storms") above the thumb zone; tap
 *     opens the drawer on this view.
 *   - Wide: the drawer opens on this view at boot. CSS docks the SAME drawer
 *     as a rail — docking adapts to width, never to device (SPEC §16).
 *   - NO HOME: strongest-first within canonical basin order, position instead
 *     of distance.
 *   - HOME SET: nearest-first, and BASIN GROUPS ARE ORDERED BY THEIR NEAREST
 *     STORM, so the closest storm on the planet is always the top row of the
 *     top group.
 *   - ENDED STORMS SIT IN THEIR OWN GROUP AT THE BOTTOM, outside basin
 *     grouping entirely.
 *   - Basin headers are real <h2>s, only when more than one group is present.
 *   - Three empty states, never conflated: loading / clear / unavailable.
 *   - NO RE-SORT WHILE VISIBLE: presence changes rebuild; a poll that only
 *     changed numbers patches rows in place (SPEC §16, §13).
 *
 * ==> EVERY ROW SAYS THE SAME THINGS ABOUT EVERY STORM ON EARTH. <==
 *
 * That is the rule this file is built around, and it is Aaron's: a column that
 * can only be filled for some storms does not belong on this surface. It goes
 * to the detail panel or the home drawer, where one storm has room to explain
 * itself.
 *
 * WHAT THAT COST, AND WHY IT WAS WORTH IT. Measured against the live feed on
 * 2026-08-10 — NHC empty, four GDACS storms up, JTWC warning on three of them:
 *
 *   Peilou / Chan-hom / Fifteen  →  JTWC matched. Wind, gusts, pressure,
 *                                   heading, speed, a real Saffir-Simpson
 *                                   category. The full NHC field set.
 *   Dolphin                      →  no JTWC warning. NONE of the above, a
 *                                   35-hour-old fix, and the strongest system
 *                                   on the globe.
 *
 * So the fault line is not NHC-versus-GDACS. `applyJtwcWind` writes the whole
 * field set back onto a matched storm, which means it is MATCHED versus
 * UNMATCHED — and that moves storm to storm and poll to poll as JTWC picks
 * systems up and drops them. A row cannot be designed around "GDACS shows
 * less"; it has to be designed around "any storm may show less at any moment".
 *
 * TWO FIELDS LEFT THE ROW BECAUSE OF IT:
 *
 *   WIND. `windText` printed the current wind for a matched storm and the
 *   FORECAST PEAK for an unmatched one — two different quantities in one
 *   column, and the peak is the larger, so Dolphin's row claimed a number
 *   three times its neighbours' while meaning something else entirely. Wind
 *   and category are the same fact at two resolutions and only one of them
 *   survives on every row, so the category label stays and the number goes to
 *   the detail panel, where it can be attributed ("JTWC · 3 hrs ago" against
 *   "GDACS forecast peak"). Blanking it instead was considered and rejected:
 *   a dash beside the strongest storm in the list reads as "nothing here".
 *
 *   THE TREND WORD. `motionTrend` is dead reckoning off `headingDeg` and
 *   `speedKt`, which GDACS does not publish, so it was blank on every
 *   unmatched storm. It is replaced by the track's OWN minimum — see
 *   `approachText` — which both sources answer identically and which is
 *   strictly more informative than the word it replaces.
 *
 * ==> THREE LINES PER ROW, AND ONLY THE FIRST TWO ARE THE CONTRACT. <==
 *
 *   1.  swatch · NAME ....................................... CATEGORY
 *   2.  distance and bearing ........................ freshness / silence
 *   3.  ↘ closest 120 mi in 9 hrs          (only once geometry has landed)
 *
 * Lines 1 and 2 are built from position and timestamp alone, so they are
 * present on every storm, always, in every state. Line 3 is enrichment: it
 * appears when the warm cache has this storm's forecast and says nothing at
 * all otherwise. Absence there breaks no alignment, because the two lines
 * above it are already complete on their own.
 *
 * THE NAME IS NEVER TRUNCATED. It is how you refer to the thing, how you match
 * it to a forecast you heard elsewhere, and how a stranger arriving by shared
 * link knows what they are looking at. It wraps rather than clipping.
 *
 * The scope filter (All / My basin / Near me) was removed on 2026-07-25. Three
 * buttons pinned above a list that has never held more than nine rows is a
 * filter that saves no work, and it cost a row of chrome at the top of the one
 * surface that is also the app's whole accessibility layer. `SCOPE`,
 * `SCOPE_RADIUS_NM`, `filterByScope`, and `availableScopes` were deleted
 * rather than left behind as dead exports.
 *
 * Row activation (tap/Enter) calls the injected onSelect(storm), which pushes
 * the detail view onto the drawer's stack and flies the camera.
 *
 * Imports: config/, lib/. Never map/ or data/ — main.js wires the store in.
 */

import { BASIN_LABEL, basinRank } from '../lib/basin.js';
import { categoryShortLabel, representativeKt } from '../lib/category.js';
import { formatAge, ageMs, formatUntil } from '../lib/time.js';
import { formatDistance, formatBearing } from '../lib/units.js';
import { FRESHNESS } from '../config/constants.js';
import { isSilent, SILENT_SHORT } from '../lib/silence.js';
import { isEnded, stormSwatch, endedRowStamp, ENDED_SHORT } from '../lib/lifecycle.js';
import { GENESIS } from '../config/constants.js';
import { genesisColor, formatPercent } from '../lib/genesis.js';
import { headingArrow, headingSpoken } from './heading-arrow.js';
/* ==> THE SECTION IS PART OF THE `genesis` LAYER, NOT A LIST THAT HAPPENS TO
 * SIT NEAR IT. <== Turning the layer off cleared the patches from the globe and
 * left the rows in the drawer, which is the toggle doing half its job. A
 * control that removes a thing from one surface and not the other reads as
 * broken, and worse, it makes the drawer say the app is watching areas the map
 * has been told not to show. */
import { toggleOn, subscribeLayers } from '../data/layer-prefs.js';
import { dotted, dotsEl } from './loading-dots.js';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.pill      #storm-pill (narrow-width collapsed form)
 * @param {(storm: object) => void} opts.onSelect
 * @param {(area: object) => void} opts.onSelectArea  a watched area was picked
 *        (§45). Separate from `onSelect` on purpose: an area is not a storm,
 *        has no advisory, no cone and no detail bundle, and routing it through
 *        the storm path would ask the geometry pipeline for a bin that does
 *        not exist.
 * @param {() => void} opts.onRetry    manual retry for the total-failure state
 * @param {object} opts.home           the home module's read API, injected so
 *        this file never imports data/ directly (one-directional imports).
 *        Shape: { get, distanceTo, motionTrend, approachTo }.
 *        `approachTo` reads the WARM CACHE and never fetches — see the note on
 *        it in app/views.js.
 * @param {object} opts.motion         which way each storm is travelling,
 *        injected for the same reason `home` is — ui/ must not import data/.
 *        Shape: { headingOf }. Reads the SAME warm geometry cache
 *        `approachTo` does and never fetches; returns null freely, and a null
 *        renders no arrow rather than a guessed one.
 * @param {() => string|null} opts.units  the resolved unit system, injected
 *        from the settings store by main.js.
 */
export function createStormsView({ pill, onSelect, onSelectArea, onRetry, home, motion, units }) {
  /** Asked fresh on every render — the user can change units while this list
   *  is on screen. */
  const sys = () => units?.() ?? null;
  let host = null;      // the drawer-supplied view host
  let visible = false;  // is this the drawer's current view?
  let lastState = null;
  let renderedIds = ''; // presence fingerprint — decides rebuild vs patch

  /* --- view skeleton ------------------------------------------------------
   * No header and no close button: the drawer owns its chrome. This view
   * renders the list and nothing else — the scope filter that used to sit
   * above it is gone (see the header note).
   * ---------------------------------------------------------------------- */
  let body = null;
  let watchEl = null;

  function buildSkeleton(el) {
    host = el;
    /* TWO SIBLINGS INSIDE ONE SCROLLER, NOT ONE ELEMENT. The storm list is
     * rebuilt with `innerHTML =`, which would take the watch section with it
     * on every presence change — so the two own separate elements and the
     * `.drawer-body` scroller owns both. One scroll, two lists. */
    host.innerHTML = `
      <div class="drawer-body">
        <div id="storm-list" role="list" aria-label="Active storms"></div>
        <section id="watch-list" class="watch-section" data-hidden="true"></section>
      </div>
    `;
    body = host.querySelector('#storm-list');
    watchEl = host.querySelector('#watch-list');
  }

  /* Escape is NOT handled here. It is a global contract owned by attachEscape()
   * in map/globe.js (SPEC §10) — a panel-scoped listener only fired when focus
   * was already inside the panel. The drawer restores focus on close, so the
   * global handler gets the same behavior from anywhere. */

  /* --- pill text ---------------------------------------------------------- */
  /** Write a label into the pill, honouring `\n` as a real line break.
   *
   *  ==> THE BREAK IS IN THE MARKUP, NOT IN A WHITE-SPACE RULE. <== `pre-line`
   *  renders the break correctly but Chrome does not count it when working out
   *  how wide the pill wants to be: it sized the button from the wrapped text
   *  rather than from the longest forced line, parked at 210 px against the 222
   *  needed, and the mark hung over the right edge. Two block children give the
   *  browser an ordinary intrinsic width to measure and the guesswork stops.
   *
   *  Built with `createElement`, not innerHTML — these strings are ours today,
   *  and a storm name reaching this function tomorrow should not be one
   *  refactor away from being markup. */
  function setLabel(node, text) {
    node.replaceChildren();
    for (const line of String(text).split('\n')) {
      const el = document.createElement('span');
      el.className = 'pill-line';
      /* A LINE ENDING IN `…` IS A WAITING LINE, and its dots move. The pill's
       * turning mark already says "busy"; without this the words beside it
       * said "finished sentence". Only the LAST line of a multi-line label can
       * carry it, which is why this is per-line rather than per-label. */
      if (line.endsWith('…')) {
        el.append(document.createTextNode(line.slice(0, -1)), dotsEl());
      } else {
        el.textContent = line;
      }
      node.appendChild(el);
    }
  }

  function renderPill(state) {
    /* ==> NO STATE YET IS A REAL CALL, NOT A BUG TO THROW ON. <==
     *
     * `subscribeLayers` fires IMMEDIATELY at registration (data/layer-prefs.js
     * says so in as many words), and that registration happens before the store
     * has emitted anything — so this runs once, at boot, with `lastState` still
     * null. It threw `Cannot read properties of null (reading 'storms')` every
     * single load, which `subscribeLayers` caught and logged, taking the watch
     * section's redraw down with it.
     *
     * Returning is right rather than merely quiet: the pill's job is to describe
     * a state, and there is no state. The skeleton's own markup holds until the
     * store's first emit, which arrives moments later and paints properly. This
     * is not a silent failure (§5) — nothing has failed and nothing is being
     * hidden; the answer simply has not been asked for yet. */
    if (!state) return;
    const n = state.storms.length;
    const status = overall(state);
    /* Either source struggling is enough. One feed limping while the other is
     * still on its first attempt is still "nothing on screen and it is not
     * going well", which is the only thing this rung claims. */
    const slow = state.sources.nhc.slow || state.sources.gdacs.slow;

    /* A SILENT STORM IS NOT AN ACTIVE STORM, and the pill is the one surface
     * that makes a bare count into a claim. "3 active storms" over a set where
     * one has not been updated since yesterday is the §5 lie at its cheapest:
     * nobody opens the drawer, nobody sees the badge, and the number is what
     * they carry away.
     *
     * SPLIT RATHER THAN SUBTRACTED. Dropping the silent one from the count
     * would make a storm vanish from the only surface a narrow phone shows by
     * default — the disappearance problem in a different costume. Both numbers
     * are said, so the reader can see there is something there and that we
     * have stopped hearing about it. */
    /* THREE COUNTS NOW, AND ENDED IS CHECKED FIRST. A storm can be both silent
     * and ended (it went quiet, then the feed dropped it) and counting it twice
     * would make the pill add up to more storms than exist. `isEnded` wins for
     * the same reason it wins everywhere — lib/lifecycle.js `endedWins`. */
    /* Areas being watched — read only when there are no storms (see the pill
     * ladder below). `?.` throughout: the pill renders on the very first emit,
     * before the genesis branch has resolved. */
    /* ==> AND IT STAYS SILENT ABOUT AREAS THE READER HAS HIDDEN. <== Without
     * this the pill read "3 areas being watched" while the section it refers
     * to was gone and the globe was bare — pointing at nothing.
     *
     * DELIBERATELY NOT APPLIED TO `overall()` BELOW. Whether anything is out
     * there is a fact about the ocean, not about a switch, so hiding the layer
     * must never promote the app to `clear`. It falls to "No active storms",
     * which is true and is not an all-clear the reader did not earn. */
    const watched = toggleOn('genesis') ? (state.genesis?.areas?.length ?? 0) : 0;

    const dead = state.storms.filter((s) => isEnded(s)).length;
    const quiet = state.storms.filter((s) => !isEnded(s) && isSilent(s)).length;
    const live = n - quiet - dead;

    /* Built as CLAUSES rather than as a sentence per combination: four states
     * across three counts is eight sentences to keep in agreement, and the one
     * that would rot is the rare double state nobody looks at. */
    const tail = [
      quiet > 0 ? `${quiet} ${SILENT_SHORT}` : null,
      dead > 0 ? `${dead} ${ENDED_SHORT}` : null,
    ].filter(Boolean);

    const activeText =
      tail.length === 0
        ? `${n} active storm${n === 1 ? '' : 's'}`
        : [
            /* EVERY storm we hold is quiet or finished. "1 storm · ended" was
             * the first attempt and it reads as one storm with a note attached;
             * reusing the app's own empty-state words makes the first clause the
             * answer to "is anything happening" and the rest say we are still
             * holding something worth looking at. */
            live === 0 ? 'No active storms' : `${live} active`,
            ...tail,
          ].join(' · ');

    /* THREE RUNGS, NOT TWO. "Checking the oceans…" used to hold the screen for
     * the full 68 seconds of the retry ladder, so a dead network and a healthy
     * slow one looked identical right up until one of them gave up. The middle
     * rung says what is actually known at two seconds — still trying, not going
     * well — which is honest for both causes and, unlike silence, tells the
     * reader the app is alive. SPEC-UI §16. */
    /* THE TEXT GOES IN THE SPAN, NOT ON THE BUTTON. `pill.textContent = ...`
     * would delete the spinner alongside the old words — the mark is a child of
     * the button now (index.html). */
    const label = pill.querySelector('.pill-text') || pill;
    setLabel(label,
      status === 'loading' && slow ? 'Still trying to reach\nstorm feeds'
      : status === 'loading' ? 'Checking the\noceans…'
      : status === 'unavailable' && n === 0 ? 'Storm data unavailable'
      /* ==> NO STORMS BUT SOMETHING IS BEING WATCHED (§45). <==
       *
       * This is the case the whole feature exists for, and the pill is where
       * the old answer was most obviously wrong: measured 2026-08-09, the app
       * would have said "No active storms" while NHC published five watched
       * areas, one at 80% over seven days.
       *
       * THE PILL READS THE COUNT, NOT `overallStatus`. That function returns
       * `ok` here — the same word it uses for six live hurricanes — because
       * reusing the existing rule was worth more than a fourth status word
       * (see data/store.js). Nothing ambiguous reaches the screen as a result,
       * because this line never renders that word.
       *
       * AREAS NEVER TAKE THE PILL WHEN A STORM EXISTS. A storm is the more
       * urgent fact and the pill has one line. The section in the drawer
       * carries the count in that case. */
      : n === 0 && watched > 0
        ? `${watched} area${watched === 1 ? '' : 's'}\nbeing watched`
      /* THE ALL-CLEAR, FINALLY EARNED. Both storm feeds clean, zero storms,
       * and both watch sources answered with nothing. Before §45 this said
       * "No active storms", which was true and was not the question. */
      /* `answered` AND NOT JUST `none_matched` — see data/genesis.js. A partial
       * watch-list outage reports `none_matched` on purpose, and this line was
       * reading it as a clean sky. */
      : n === 0 && state.genesis?.status === 'none_matched' && state.genesis?.answered
        ? 'All clear'
      : n === 0 ? 'No active storms'
      : activeText);
    pill.dataset.tone = status === 'unavailable' && n === 0 ? 'error' : 'normal';
    /* The mark spins on both loading rungs. It is the one thing on screen
     * saying "still working" while the words say "not going well". */
    pill.dataset.busy = status === 'loading' ? 'true' : 'false';
  }

  /** Local restatement of the store's overall logic is a cycle risk — so the
   *  store's status is not imported; it is DERIVED the same way from the state
   *  object we're handed. Keep in lockstep with data/store.js overallStatus. */
  function overall(state) {
    const st = [state.sources.nhc.status, state.sources.gdacs.status];
    if (state.storms.length > 0) return 'ok';
    /* A WATCHED AREA OUTRANKS AN ALL-CLEAR, exactly as an ended storm does
     * (§45.5). Without this line the branch below would return `clear` on a
     * day with five watched areas and print the all-clear sentence directly
     * above a section listing all five. */
    if ((state.genesis?.areas?.length ?? 0) > 0) return 'ok';
    /* ANY source still loading is loading. See data/store.js overallStatus for
     * why — one fast feed and one slow one used to read as an outage here. */
    if (st.some((x) => x === 'loading')) return 'loading';
    if (state.genesis?.status === 'loading') return 'loading';
    /* `clear` needs the watch list to have ANSWERED, not merely not-failed.
     * `none_matched` is that answer; an outage falls through to unavailable,
     * because we cannot see the whole question. */
    if (st.every((x) => x === 'ok')
      && state.genesis?.status === 'none_matched'
      && state.genesis?.answered) return 'clear';
    return 'unavailable';
  }

  /* --- rows --------------------------------------------------------------- */
  /** Latitude/longitude in the same form the detail panel uses.
   *
   *  ==> THE ROW'S SECOND LINE IS NEVER EMPTY, AND WITH NO HOME THIS IS WHY.
   *  <== Position is the one fact every storm on earth carries and the only
   *  one that needs no reference point, so it holds the slot that distance
   *  takes over the moment a home exists. The alternative was leaving line 2
   *  blank until setup, which would have made the row's shape depend on the
   *  reader's configuration — the same inconsistency this whole pass exists
   *  to remove, arriving from the other direction. */
  function positionText(s) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return null;
    const la = `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`;
    const lo = `${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`;
    return `${la} ${lo}`;
  }

  /** Line 2, left: where the storm is. Distance and bearing once a home
   *  exists, the raw position before that. Never null for a storm that has a
   *  position at all — and a storm without one never reaches the store. */
  function whereText(s) {
    const d = home?.distanceTo(s);
    if (d) return `${formatDistance(d.nm, sys())} ${formatBearing(d.bearing)}`;
    return positionText(s) || '';
  }

  /**
   * Line 3: where the storm is GOING, relative to home.
   *
   * Returns `{ glyph, text, tone }` or null. Null means the row simply has no
   * third line — which is the honest rendering of four different silences
   * (`pending`, `none`, `unavailable`, `unsupported`). None of them is a
   * failure the reader can act on from a list, and all four are explained in
   * full on the detail panel one tap away.
   *
   * ==> THE GLYPH IS THE TREND AND IT CARRIES REAL MEANING. <== Down-right is
   * closing, up-right is moving away. It replaces the word the old row spent
   * seven characters on, which is most of what funds the figures beside it.
   * The word itself is spliced back into the accessible name by `rowLabel` —
   * a qualifier that exists only for sighted users does not exist, and this
   * list is the app's entire accessibility surface.
   *
   * THREE SENTENCES FROM TWO ORTHOGONAL FLAGS, the same three the detail
   * panel and the home dashboard make, for the same reason: a typhoon closing
   * from 7,315 nm to 7,085 nm over the top of the planet is genuinely closing
   * and is not approaching anybody.
   */
  function trackFacts(s) {
    const a = home?.approachTo?.(s);
    if (!a || a.state !== 'ok') return null;

    /* ==> THE ARROW IS NOW A COMPASS AND CARRIES NONE OF THE MEANING BELOW.
     * <== It used to be ↗ for "moving away" and ↘ for "closing", which is a
     * relationship between two points wearing a direction's clothes. The
     * closing-versus-receding fact is entirely in `tone` (the colour) and in
     * `text` (the words), both of which were already saying it — so nothing
     * was lost by handing the mark back its literal job. Null is a real answer
     * and renders no arrow (lib/heading.js). */
    const headingDeg = motion?.headingOf?.(s)?.deg ?? null;

    if (a.trend === 'receding') {
      return { headingDeg, word: 'moving away', text: 'moving away', tone: 'far' };
    }
    if (!a.relevant) {
      return { headingDeg, word: 'never comes near', text: 'never comes near', tone: 'far' };
    }

    /* CLOSING AND NEAR — the only case with figures, and the only one the
     * reader can do anything with. The lead time is omitted rather than
     * guessed when the track carries no clock: "closest 120 mi" is true on
     * its own, "closest 120 mi in 0 hrs" is not. */
    /* `formatUntil` CARRIES ITS OWN PREPOSITION — it returns "in 9 hrs", not
     * "9 hrs" — so this template must not add a second one. Writing
     * `in ${until}` here produced "closest 120 mi in in 9 hrs". */
    const until = a.time ? formatUntil(a.time) : null;
    const dist = formatDistance(a.nm, sys());
    return {
      headingDeg,
      word: 'closing',
      text: until ? `closest ${dist} ${until}` : `closest ${dist}`,
      tone: 'near',
    };
  }

  /**
   * THE ROW, ON TWO AXES.
   *
   *   ●  Chan-hom                              CAT 1
   *      980 mi SE                          5 hrs ago
   *      ↘ closest 120 mi in 9 hrs
   *
   * LEFT EDGE: identity and where it is. RIGHT EDGE: classification and how
   * current the row is. Two clean vertical columns down the whole list, so
   * the eye compares by position instead of parsing a sentence per row. The
   * old row was one dot-separated string assembled with `.filter(Boolean)`,
   * which meant a missing fact slid every later fact left — the reader could
   * never learn where to look, because the answer moved per row.
   *
   * ==> COLOUR AND TEXT DO NOT DOUBLE UP. <== The swatch carries severity as
   * a hue, exactly as the globe does (§6, "the list is its own legend"); the
   * badge carries it as a WORD, in neutral ink. Tinting the badge as well
   * would say the same thing twice and would put a Cat 1's #FFE14D on a
   * white background in light theme, where it cannot meet AA at any size the
   * badge could reasonably be.
   *
   * The figures keep the monospace face because they are compared down a
   * column; the name does not, because it is read.
   */
  function rowHtml(s) {
    const swatch = stormSwatch(s);
    const badge = categoryShortLabel(s.category, s.nature, s.categoryCode);
    const where = whereText(s);
    const stamp = ageSuffix(s);
    const track = trackFacts(s);
    return `
      <button class="storm-row" type="button" role="listitem" data-id="${s.id}"
              aria-label="${esc(rowLabel(s))}">
        <span class="row-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
        <span class="row-text">
          <span class="row-head">
            <span class="row-name">${esc(s.name)}</span>
            <span class="row-badge">${esc(badge)}</span>
          </span>
          <span class="row-where">
            <span class="row-dist">${esc(where)}</span>
            ${stamp}
          </span>
          ${trackHtml(track)}
        </span>
      </button>
    `;
  }

  /** Line 3, or nothing at all. `aria-hidden` on the glyph because `rowLabel`
   *  already says the word it stands for; a screen reader announcing "north
   *  east arrow" before every trajectory is noise on the one surface that
   *  cannot afford it. */
  function trackHtml(track) {
    if (!track) return '';
    /* THE LEAD SLOT IS ALWAYS WRITTEN, THE ARROW INSIDE IT IS NOT. A storm
     * with no published motion and no forecast track yet has no heading, and
     * `headingArrow` returns an empty string for it — the span holds the
     * column open so line 3 starts in the same place on every row. */
    return `<span class="row-track" data-tone="${track.tone}">
        <span class="row-track-lead">${headingArrow(track.headingDeg)}</span>${esc(track.text)}
      </span>`;
  }

  /** Within a basin: NEAREST-first once home exists, strongest-first without
   *  it (SPEC §14 Phase 3). Distance is the more useful ordering the moment
   *  there is a reference point — the strongest storm in the basin is not
   *  necessarily the one that matters to you.
   *
   *  Ties and missing values fall back to intensity so the order is always
   *  total and stable; an unstable comparator makes rows jump between polls. */
  function sortWithinBasin(a, b) {
    /* SILENT STORMS SINK, in every ordering, ahead of every other rule.
     * Nearest-first is the useful order precisely because the top of the list
     * is what deserves attention, and a storm nobody has published a fix for
     * since yesterday does not \u2014 even when it is the closest one on screen.
     * It stays in the list (that is the whole point of not dropping it) but it
     * stops outranking storms we actually know something about. */
    const ea = isEnded(a) ? 1 : 0;
    const eb = isEnded(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    const qa = isSilent(a) ? 1 : 0;
    const qb = isSilent(b) ? 1 : 0;
    if (qa !== qb) return qa - qb;

    if (home?.get()) {
      const da = home.distanceTo(a);
      const db = home.distanceTo(b);
      if (da && db && da.nm !== db.nm) return da.nm - db.nm;
    }
    return rankKt(b) - rankKt(a);
  }

  /**
   * The number a storm is RANKED by when there is no distance to rank on.
   *
   * ==> IT USED TO FALL BACK TO `peakWindKt` AND THAT IS THE WRONG QUANTITY.
   * <== GDACS's only number is the maximum expected over the storm's whole
   * life, so an unmatched storm was ranked on its future against every NHC
   * storm's present. Measured on the live feed 2026-08-10: Dolphin publishes
   * a 269 km/h peak — about 145 kt — while sitting silent for 35 hours, which
   * would have put it above a measured Cat 4 in an intensity-ordered list.
   *
   * `representativeKt` is the tool already built for exactly this, and its own
   * header says so: the middle of the class the source actually stated, "a
   * stand-in for ranking and for visual ramps", never displayed as a
   * measurement. It also answers for GDACS's bare "HU", which has no category
   * index at all and would otherwise sort below a tropical storm.
   *
   * A MEASURED WIND ALWAYS WINS. The stand-in is only reached when there is
   * none — the same precedence the cage's elevation uses.
   */
  function rankKt(s) {
    if (Number.isFinite(s.windKt)) return s.windKt;
    return representativeKt(s.category, s.nature, s.categoryCode) ?? -1;
  }

  /**
   * The list's groups, in the order they are drawn.
   *
   * ==> TWO RULES SPEC-UI §16 HAS ALWAYS STATED AND THIS FILE HAS NEVER DONE.
   * <== Both are the same mistake wearing different clothes: basin membership
   * was outranking relevance.
   *
   * 1. BASINS ARE ORDERED BY THEIR NEAREST STORM, not by `basinRank`. The
   *    fixed order runs Atlantic first, always, which is invisible from
   *    Louisiana and wrong everywhere else — from Guam it put an Atlantic
   *    storm 8,000 miles away above the typhoon 200 miles from the reader's
   *    house. The spec's own words: "the single closest storm on the planet is
   *    always at the top of the list, inside its basin's group." Without a
   *    home there is no nearest, so `basinRank` remains the right answer and
   *    is what this falls back to.
   *
   * 2. ENDED STORMS ARE THEIR OWN GROUP AT THE BOTTOM, outside basin grouping
   *    entirely. They used to sink only WITHIN their basin, so a finished
   *    Atlantic storm still outranked every live storm in the Pacific — and a
   *    dead storm could be the sole reason a basin header existed at all.
   *
   * Silent storms deliberately do NOT get this treatment. A silent storm may
   * still be out there; that is the whole reason it is not dropped. It sinks
   * within its basin and keeps its place in the world.
   */
  function groupsFor(visible) {
    const live = visible.filter((s) => !isEnded(s));
    const dead = visible.filter((s) => isEnded(s));

    const hasHome = !!home?.get();
    const nearestNm = (basin) => {
      let best = Infinity;
      for (const s of live) {
        if (s.basin !== basin) continue;
        const d = home?.distanceTo(s);
        if (d && d.nm < best) best = d.nm;
      }
      return best;
    };

    const basins = [...new Set(live.map((s) => s.basin))].sort((a, b) => {
      if (hasHome) {
        const na = nearestNm(a);
        const nb = nearestNm(b);
        /* A basin whose storms all failed to produce a distance falls through
         * to the canonical order rather than being flung to the end — an
         * un-measurable basin is not a far one. */
        if (na !== nb && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      }
      return basinRank(a) - basinRank(b);
    });

    const groups = basins.map((basin) => ({
      label: BASIN_LABEL[basin] || basin,
      storms: live.filter((s) => s.basin === basin).sort(sortWithinBasin),
      ended: false,
    }));

    if (dead.length) {
      groups.push({
        /* Named for what these storms ARE, not for where they were. The whole
         * point of pulling them out of basin grouping is that the basin has
         * stopped being the useful fact about them. */
        label: 'Finished',
        storms: dead.sort(sortWithinBasin),
        ended: true,
      });
    }
    return groups;
  }

  const isStale = (s) => {
    const a = ageMs(s.observedAt);
    return a != null && a > FRESHNESS.freshUntil;
  };

  /** The row's age suffix, in ONE place because two callers render it — the
   *  row builder and the in-place patcher — and a row that changes its story
   *  when a poll patches it is the bug that shape exists to prevent.
   *
   *  SILENCE OUTRANKS STALENESS and replaces the text rather than joining it.
   *  "26 hrs ago" is a true string that reads as a late update; the row has
   *  space for one qualifier and it should be the one that says the updates
   *  stopped. The exact hour is on the detail panel, one tap away. */
  /** The accessible name. The visible row shows "not updating" as a coloured
   *  suffix; colour and position carry nothing to a screen reader, so the
   *  words are spliced into the label itself. THE LIST IS THE ACCESSIBILITY
   *  SURFACE for a canvas that is aria-hidden \u2014 a qualifier that exists only
   *  for sighted users is a qualifier that does not exist. */
  function rowLabel(s) {
    /* The same precedence as `ageSuffix`, and STALENESS IS SPOKEN TOO. It was
     * once the one qualifier a screen reader never heard: the visible row said
     * "5 hrs ago" and the accessible name stopped at the distance, so the
     * reader with the least context got the least honest row. */
    /* The visible row now carries a clock beside the word, so the accessible
     * name has to as well — a fact that exists only for sighted users is a fact
     * that does not exist (§16). */
    const q = isEnded(s)
      ? (({ word, when }) => [word, when].filter(Boolean).join(' '))(endedRowStamp(s))
      : isSilent(s)
        ? SILENT_SHORT
        : isStale(s)
          ? formatAge(s.observedAt)
          : null;

    /* ==> EVERY VISUAL CHANNEL BECOMES A CLAUSE HERE, INCLUDING THE TWO THAT
     * ARE NOT TEXT. <== The badge is read out because a right-aligned column
     * is a sighted affordance; the trajectory glyph is read out as its WORD,
     * because "↘" is a picture of the fact rather than the fact. A row that
     * says less to a screen reader than it shows on glass is a row this
     * surface is not allowed to have. */
    const track = trackFacts(s);
    return [
      s.name,
      categoryShortLabel(s.category, s.nature, s.categoryCode),
      whereText(s),
      /* ==> THE ARROW'S ROTATION IS SPOKEN, BECAUSE NOTHING ELSE CARRIES IT.
       * <== It used to be enough to splice in the word the glyph stood for,
       * since ↗ and ↘ only ever meant "moving away" or "closing" and the words
       * were already here. A compass heading is a new fact that exists on this
       * row in a `transform` and nowhere else, and a fact that exists only for
       * sighted users does not exist (§16). */
      track ? headingSpoken(track.headingDeg) : null,
      /* The trend word is spoken only when it is not already the text.
       * "moving away" needs no second copy of itself; "closest 120 mi in
       * 9 hrs" does, because it never says which way the storm is going. */
      track ? (track.word === track.text ? track.text : `${track.word}, ${track.text}`) : null,
      q,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /**
   * The right-hand end of line 2: how current this row is.
   *
   * ==> THE SEPARATOR DOT IS GONE, AND SO IS THE REASON IT EXISTED. <== This
   * was appended to a dot-separated string, so it needed its own `·` in its
   * own uncoloured span to avoid reading as part of the distance ("6,502 mi 5
   * hrs ago" — caught on glass 2026-08-09). The qualifier is now a column of
   * its own, pinned to the right edge of the row and separated by whitespace
   * rather than punctuation. Position does the work the dot was doing.
   *
   * ENDED OUTRANKS SILENCE OUTRANKS STALENESS, and each REPLACES the one below
   * rather than joining it. There is one slot and it must carry the strongest
   * claim available: "26 hrs ago" on an ended storm reads as a late update on
   * something still running.
   *
   * ONE SLOT, THREE STATES, NEVER MOVING — which is the point. A reader
   * scanning the right edge of the list is asking one question ("how much of
   * this can I trust"), and the answer is always in the same place.
   */
  function ageSuffix(s) {
    /* THE ONE STATE THAT GETS A SECOND WORD, and only because it has stopped
     * moving. The other two tones are a single qualifier that keeps changing —
     * re-rendering "5 hrs ago" is the whole job of the slot. This one never
     * changes again, so it can afford to say when, and a fixed clock beside a
     * fixed state is cheaper to read than "ended" plus a tap to find out when.
     * The time is muted a step below the word: the word is the state, the time
     * is a footnote to it. */
    if (isEnded(s)) {
      /* THE WORD IS NOT ALWAYS "ended" — see `endedRowStamp`. A storm the app
       * gave up on because nobody analysed it for two days had nothing happen
       * to it at the time this clock shows, and saying "ended" beside that
       * clock asserted an event that never occurred. */
      const { word, when } = endedRowStamp(s);
      return `<span class="row-stamp" data-tone="ended">${esc(word)}${
        when ? `<span class="row-stamp-when">${esc(when)}</span>` : ''
      }</span>`;
    }
    if (isSilent(s)) return `<span class="row-stamp" data-tone="silent">${SILENT_SHORT}</span>`;
    if (isStale(s)) return `<span class="row-stamp" data-tone="stale">${formatAge(s.observedAt)}</span>`;

    /* ==> A CURRENT STORM SAYS HOW CURRENT IT IS, TOO. <== This used to return
     * nothing, so the slot was EMPTY on every healthy row and filled only when
     * something was wrong. That inverts what the column is for. A reader
     * scanning the right edge is asking "how much of this can I trust", and a
     * blank is not an answer to that — it is the absence of one, and it is
     * indistinguishable from a row that failed to render its stamp. Worse, it
     * made the amber and red the only marks in the column, which turns a
     * routine two-hour-old advisory into a warning by contrast.
     *
     * MUTED, WHICH IS THE WHOLE POINT. Same words, same place, same format as
     * the stale one — the only thing that changes when a storm goes overdue is
     * the COLOUR. That is the §6 rule applied to freshness: the state is read
     * off the colour, not off whether text exists.
     *
     * A storm with no timestamp at all still gets nothing. There is no age to
     * report and inventing "just now" for a reading of unknown age is the
     * fabrication §5 forbids — a wrong answer is worse than an honest gap. */
    const age = formatAge(s.observedAt);
    return age ? `<span class="row-stamp" data-tone="fresh">${esc(age)}</span>` : '';
  }

  const esc = (t) =>
    String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  /* --- list states ---------------------------------------------------------
   * Every path guards on `body`: the view mounts lazily, so a store emit can
   * land before this view has ever been shown. The pill still updates — it
   * lives outside the drawer and is the narrow-width entry point.
   * ---------------------------------------------------------------------- */
  function renderList(state, { force = false } = {}) {
    if (!state || !body) return;
    const status = overall(state);

    if (status === 'loading') {
      renderedIds = '';
      /* Same ladder as the pill, same reason. The open drawer must not be the
       * one surface still saying everything is fine. */
      /* NO FORCED BREAK HERE. The pill's line breaks are shaped for a narrow
       * button; this is a paragraph in an open drawer with room to flow, and a
       * hard break in the middle of it would look like a mistake. Same words,
       * left to wrap on their own. */
      const note = (state.sources.nhc.slow || state.sources.gdacs.slow)
        ? 'Still trying to reach storm feeds'
        : 'Checking the oceans…';
      body.innerHTML = `<p class="list-note">${dotted(esc(note))}</p>`;
      return;
    }

    if (status === 'clear') {
      renderedIds = '';
      /* ==> THE ONLY TRUE ALL-CLEAR, AND §45 ADDED THE SECOND HALF OF IT. <==
       * Every storm source clean, zero storms, AND both watch sources answered
       * with nothing. `overallStatus` will not return `clear` unless all three
       * hold, so this sentence can finally be said plainly. */
      body.innerHTML = `<p class="list-note">No active storms, and nothing being watched. All feeds reporting clean.</p>`;
      return;
    }

    /* NO STORMS, BUT SOMETHING IS BEING WATCHED. The list itself is empty and
     * has to say why without implying a quiet ocean — the answer is directly
     * underneath in the watch section, so this line points at it rather than
     * repeating the count and risking the two disagreeing. */
    if (state.storms.length === 0 && (state.genesis?.areas?.length ?? 0) > 0) {
      renderedIds = '';
      body.innerHTML = `<p class="list-note">No active storms yet — see what is being watched below.</p>`;
      return;
    }

    if (status === 'unavailable' && state.storms.length === 0) {
      renderedIds = '';
      body.innerHTML = `
        <p class="list-note list-error">Storm feeds are not responding. This does not mean the ocean is clear.</p>
        <button class="retry" type="button">Retry</button>
      `;
      body.querySelector('.retry').addEventListener('click', onRetry);
      return;
    }

    /* Every storm, always. There is no longer a filter that can empty this
     * list while storms exist, so the old `none_matched` branch went with the
     * scope control — the three honest states above are the only ones left. */
    const visible = state.storms;

    /* Storms present. Rebuild only when PRESENCE changed or on (re)open —
     * otherwise patch text in place so rows never move under a thumb. */
    const ids = visible.map((s) => s.id).join('|');
    if (!force && ids === renderedIds) {
      patchRows({ ...state, storms: visible });
      renderPartialNote(state);
      return;
    }
    renderedIds = ids;

    const groups = groupsFor(visible);
    const showHeaders = groups.length > 1; // a lone header over two rows is noise

    body.innerHTML = groups
      .map(({ label, storms, ended }) => {
        const rows = storms.map(rowHtml).join('');
        if (!showHeaders) return rows;
        return `<section class="basin-group"${ended ? ' data-ended="true"' : ''}>
            <h2 class="basin-head">${esc(label)}</h2>${rows}</section>`;
      })
      .join('');

    renderPartialNote(state);

    body.querySelectorAll('.storm-row').forEach((el) => {
      el.addEventListener('click', () => {
        const storm = lastState?.storms.find((s) => s.id === el.dataset.id);
        if (storm) onSelect(storm);
      });
    });
  }

  /**
   * A poll landed and presence did not change: update text in place so no row
   * moves under a thumb (§16).
   *
   * ==> ALL THREE LINES, NOT JUST THE MIDDLE ONE. <== The third line APPEARS
   * and DISAPPEARS between polls — it is the one part of the row driven by the
   * warm cache rather than by the feed, so on the very first poll after a
   * storm shows up it goes from absent to present. A patcher that only rewrote
   * the metadata would leave the trajectory permanently missing on every row
   * that was drawn before its geometry landed, which is every row.
   */
  function patchRows(state) {
    if (!body) return;
    for (const s of state.storms) {
      const el = body.querySelector(`.storm-row[data-id="${CSS.escape(s.id)}"]`);
      if (!el) continue;

      const badgeEl = el.querySelector('.row-badge');
      if (badgeEl) {
        badgeEl.textContent = categoryShortLabel(s.category, s.nature, s.categoryCode);
      }

      const whereEl = el.querySelector('.row-where');
      if (whereEl) {
        whereEl.innerHTML =
          `<span class="row-dist">${esc(whereText(s))}</span>${ageSuffix(s)}`;
      }

      /* Rebuilt rather than mutated: the line may need to appear, vanish, or
       * change tone, and three separate mutations is three chances for one of
       * them to be forgotten. */
      const trackEl = el.querySelector('.row-track');
      const html = trackHtml(trackFacts(s));
      if (trackEl) trackEl.outerHTML = html;
      else if (html) el.querySelector('.row-text').insertAdjacentHTML('beforeend', html);

      /* The accessible name carries the same facts, so a screen reader is
       * never told a category the visible row stopped showing two polls ago. */
      el.setAttribute('aria-label', rowLabel(s));
      el.querySelector('.row-swatch').style.setProperty('--swatch', stormSwatch(s));
    }
  }


  /* --- BEING WATCHED (SPEC §45.8) -----------------------------------------
   *
   * A second section under the storm list, and deliberately the SAME row
   * grammar: swatch, name on its own line, figures underneath. This is the
   * app's whole accessibility surface (see the file header) and a second row
   * shape on it is how that surface rots.
   *
   * THE SWATCH IS A HATCHED SQUARE, NEVER A ROUND DOT. Same contract as the
   * globe: a filled circle means a storm of a known strength. A watched area
   * is the absence of one, so it is a different SHAPE and a colour that is
   * deliberately off the Saffir-Simpson ramp — the list and the map teach the
   * same lesson or neither does.
   *
   * IT IS ALWAYS OPEN. See the note on the header below for why the collapse
   * was removed rather than merely defaulted open.
   * ---------------------------------------------------------------------- */

  /* ==> THIS SECTION DOES NOT COLLAPSE, AND HAS NO CONTROL THAT WOULD LET IT.
   *     <== (Aaron, 2026-08-09.)
   *
   * It shipped collapsed-by-default whenever storms were present, on the
   * reasoning that five areas under six storms is a long scroll on a phone.
   * That reasoning was about SPACE and this section is about SAFETY. The whole
   * argument for §45 is that an app showing storms is not thereby showing
   * everything — so hiding the watch list precisely when storms exist folds
   * the answer away at exactly the moment the app looks busiest and most
   * complete, which is when someone is least likely to go looking for a
   * disclosure triangle.
   *
   * A count behind a chevron is not the same as a list. Removed rather than
   * defaulted open: an affordance that exists gets used, and a user who
   * collapses this once has silently turned the feature off forever.
   */

  /**
   * One area's figures.
   *
   * NHC gets its PERCENTAGE and not its risk word — the number is finer and
   * the word would only restate it. JTWC gets its WORD and no number, because
   * it published no number and inventing one is what §45.3 forbids in as many
   * terms. Each row names its own source and its own horizon, so two scales in
   * one list can never be mistaken for one scale.
   */
  function watchMeta(a) {
    if (a.source === 'JTWC') {
      const word = String(a.risk || '').charAt(0) + String(a.risk || '').slice(1).toLowerCase();
      return [word, a.horizon, 'JTWC'].filter(Boolean).join(' · ');
    }
    return [formatPercent(a.prob7day), GENESIS.HORIZON.sevenDay, 'NHC']
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * The two-day line, or null.
   *
   * ==> THIS IS WHERE THE TWO-DAY NUMBER LIVES, AND THE ONLY PLACE IT DOES.
   * <== The polygon on the globe is the SEVEN-day area, so only the seven-day
   * figure may sit on it (§45.6). Here there is room to label the horizon, so
   * the more urgent number is present and honest rather than discarded.
   *
   * SHOWN ONLY WHEN IT IS ABOVE ZERO, AND THAT IS A FEATURE. Most watched
   * areas sit at "0% in 2 days" for days — a line of zeros on every row is
   * noise, and worse, it trains the eye to skip the line that matters. The
   * moment this line APPEARS, something has become imminent. Nothing is
   * hidden: the detail view carries the two-day figure always, including a
   * genuine zero and a genuine "not stated", which are different facts.
   */
  function watchTwoDay(a) {
    if (a.source !== 'NHC') return null;
    if (a.prob2day == null || a.prob2day <= 0) return null;
    return `${formatPercent(a.prob2day)} ${GENESIS.HORIZON.twoDay}`;
  }

  function watchRowHtml(a) {
    const swatch = genesisColor(a.source === 'JTWC' ? a.risk : a.globeRisk);
    const meta = watchMeta(a);
    const two = watchTwoDay(a);
    const label = `${a.title}, ${meta}${two ? `, ${two}` : ''}`;
    return `
      <button class="watch-row" type="button" role="listitem" data-id="${esc(a.id)}"
              aria-label="${esc(label)}">
        <span class="row-swatch watch-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
        <span class="row-text">
          <span class="row-name">${esc(a.title)}</span>
          <span class="row-meta">${esc(meta)}</span>
          ${two ? `<span class="row-meta watch-soon">${esc(two)}</span>` : ''}
        </span>
      </button>
    `;
  }

  /**
   * The section's own three states, separate from the storm list's (§45.5).
   *
   * `unavailable` NEVER FALLS THROUGH TO "nothing is being watched". That
   * sentence is the reason this whole feature exists, and printing it while a
   * source is down would be the §5 failure aimed straight at the surface built
   * to prevent it.
   */
  function renderWatch(state) {
    if (!watchEl) return;
    const g = state?.genesis;
    if (!g) {
      watchEl.dataset.hidden = 'true';
      return;
    }

    /* ==> THE LAYER IS OFF, SO THE SECTION IS OFF. <== Checked BEFORE the
     * loading and status branches below, because "the user asked not to see
     * this" outranks every reason the section might otherwise have for
     * speaking — including an outage. §5 says never ship silence on failure,
     * and this is not silence: it is a surface the reader closed, and the
     * Layers view is where they reopen it. */
    if (!toggleOn('genesis')) {
      watchEl.dataset.hidden = 'true';
      watchEl.innerHTML = '';
      return;
    }

    /* NOTHING AT ALL WHILE THE FIRST FETCH IS IN FLIGHT. An empty "Being
     * watched — 0" flashing up before the answer arrives is a claim we have
     * not earned yet; the storm list's own loading note already says the app
     * is working. */
    if (g.status === 'loading') {
      watchEl.dataset.hidden = 'true';
      return;
    }

    watchEl.dataset.hidden = 'false';
    const areas = g.areas || [];

    /* ==> WHAT THE FORECASTER SAYS, IN ONE CLAUSE, AND ONLY WHEN IT IS
     * EVIDENCE. <== The text outlook cannot draw — there is no geometry in a
     * paragraph — so it never adds a row. What it can do is turn "the layer
     * went quiet" into "the layer went quiet AND here is what NHC is actually
     * writing", which is the difference between a shrug and an answer.
     *
     * Built from the ARBITER's own count rather than from the bulletins,
     * because that count already knows the rules: it refuses a stale bulletin,
     * and it will not total two basins when it could only read one. A sentence
     * derived here from the raw prose would be a second implementation of the
     * judgement `lib/outlook.js` owns. */
    const arb = g.sources?.nhc?.arbiter;
    const proseSays =
      arb && arb.verdict === 'layer-broken' && arb.textCount > 0
        ? `NHC’s forecasters are describing ${arb.textCount} area${
            arb.textCount === 1 ? '' : 's'
          }.`
        : null;

    const partial = [];
    if (g.sources?.nhc?.status === 'unavailable') {
      /* THE OUTAGE SENTENCE NAMES ITS CAUSE WHEN IT KNOWS IT. "Not responding"
       * is wrong for the 2026-08-11 failure — the layer responded, promptly,
       * with 200 and nothing in it. Saying so is the difference between the
       * reader thinking NHC is down and knowing NHC is publishing. */
      partial.push({
        /* ==> AMBER, NOT RED, WHEN WE KNOW WHAT IS OUT THERE. <== `.list-error`
         * is the colour for "something broke and you should look at this". A
         * layer that answered promptly with nothing, while its own forecaster
         * is describing five areas, is a stopped clock — and we can say what
         * the clock should read. That is the same fact the held note carries
         * and it gets the same amber. A source that simply did not answer, and
         * leaves us unable to say anything, stays red. */
        tone: proseSays ? 'held' : 'error',
        text: proseSays
          ? `NHC’s outlook layer answered with nothing while its forecast text lists areas, so it is not being believed. ${proseSays}`
          : 'The NHC outlook is not responding. This does not mean nothing is forming in the Atlantic or East Pacific.',
      });
    }
    if (g.sources?.jtwc?.status === 'unavailable') {
      partial.push({
        tone: 'error',
        text: 'JTWC is not responding. Areas in the Northwest Pacific and Indian Ocean may be missing.',
      });
    }

    /* ==> THE AREAS BELOW ARE REAL AND ARE NOT CURRENT, AND THAT HAS TO BE ON
     * SCREEN. <== NHC's outlook layer can answer 200 with an empty
     * FeatureCollection while NHC's own text product and public graphic still
     * list areas — seen 2026-08-11, three Atlantic areas including a red one,
     * against a layer reporting zero. The relay holds its last real answer
     * through that (HELD_SECONDS), which keeps the patches on the globe; this
     * line is the other half of the bargain. Showing held areas without
     * saying they are held would trade a false all-clear for a false present
     * tense, which is a smaller lie and still a lie.
     *
     * A NOTE, NOT AN ERROR. `.list-error` is red and this is not a failure the
     * reader can act on — the data is good, its clock has stopped. */
    const heldAge = g.sources?.nhc?.held ? formatAge(g.sources.nhc.fetchedAt) : null;
    const heldNote = g.sources?.nhc?.held
      ? `NHC’s outlook layer has stopped publishing${
          heldAge ? `. These are the areas it last gave us, ${heldAge}` : ''
        }.${proseSays ? ` ${proseSays}` : ''}`
      : null;

    /* ==> THE COUNT AND THE SENTENCE UNDER IT MUST NOT CONTRADICT EACH OTHER.
     * <== Seen on glass 2026-08-11: the header read "BEING WATCHED 1" directly
     * above "NHC's forecasters are describing 5 areas". Both numbers were
     * true — one counts what can be DRAWN, the other what is being WATCHED —
     * and side by side they read as a bug.
     *
     * The header answers the question its own words ask, so it counts
     * everything known to be out there, drawable or not. An em dash marks the
     * gap rather than hiding it: five watched, one of them with a shape. */
    const watchCount =
      proseSays && arb.textCount > 0 ? arb.textCount + areas.length : areas.length;

    const bodyHtml = areas.length
      ? areas.map(watchRowHtml).join('')
      : partial.length
        ? ''
        : '<p class="list-note">Nothing being watched right now.</p>';

    /* A PLAIN HEADING AND NOTHING FOCUSABLE, exactly like `.basin-head` above
     * it. Screen-reader users jump by heading; Tab hits rows only (§16).
     *
     * ==> THE NOTES SIT UNDER THE ROWS, NOT OVER THEM. <== They are a CAPTION
     * on the areas — "these are held", "this source is out" — and a caption
     * above its subject pushes the subject off the fold on a phone. Seen on
     * glass 2026-08-11: a three-line amber paragraph directly under the count
     * meant the first watched area needed a scroll to reach, so the section
     * read as a wall of text rather than a list with a footnote. The rows are
     * what the reader came for; the notes qualify them and belong after them.
     * When there are no rows at all the notes are the only content and the
     * order is moot, so nothing is lost in the outage case. */
    watchEl.innerHTML = `
      <h2 class="watch-head">
        <span class="watch-title">Being watched</span>
        <span class="watch-count">${watchCount}</span>
      </h2>
      <div class="watch-rows" role="list" aria-label="Areas being watched">
        ${bodyHtml}
        ${partial.map((n) => `<p class="list-note list-${n.tone}">${esc(n.text)}</p>`).join('')}
        ${heldNote ? `<p class="list-note list-held">${esc(heldNote)}</p>` : ''}
      </div>
    `;

    watchEl.querySelectorAll('.watch-row').forEach((el) => {
      el.addEventListener('click', () => {
        const area = lastState?.genesis?.areas?.find((a) => a.id === el.dataset.id);
        if (area) onSelectArea?.(area);
      });
    });
  }

  /** Partial outage: show what we have PLUS name what may be missing (§16).
   *  Feed-level detail lives in the status strip; this is the list's own
   *  honesty note, because a filtered-looking list must explain itself. */
  function renderPartialNote(state) {
    if (!body) return;
    body.querySelector('.list-partial')?.remove();
    const notes = [];
    if (state.sources.nhc.status === 'unavailable') {
      notes.push('NHC is not responding — Atlantic and East Pacific storms may be missing or stale.');
    }
    if (state.sources.gdacs.status === 'unavailable') {
      notes.push('GDACS is not responding — Northwest Pacific and Indian Ocean storms may be missing or stale.');
    }
    if (notes.length) {
      const p = document.createElement('p');
      p.className = 'list-note list-error list-partial';
      p.textContent = notes.join(' ');
      body.appendChild(p);
    }
  }

  /* --- the drawer view contract -------------------------------------------
   * mount() runs once, lazily. onEnter() runs every time this becomes the
   * drawer's visible view — that is where the SORT-ON-OPEN rule lives (§16:
   * sort on open, on scope change, and on reopen; never on poll).
   * ---------------------------------------------------------------------- */

  /* ==> A TOGGLE FLIP IS NOT A STATE UPDATE, AND NOTHING WOULD HAVE REDRAWN
   * THIS. <== `update()` is driven by the data store, and turning a layer off
   * changes no data — so without this subscription the section would keep its
   * rows until the next poll happened to arrive, up to thirty minutes later.
   * A toggle that takes half an hour to take effect is a toggle that does not
   * work, which is how this looked on glass.
   *
   * The pill is redrawn too: its all-clear wording counts watched areas, and a
   * hidden section must not still be feeding the headline. */
  subscribeLayers(() => {
    renderWatch(lastState);
    renderPill(lastState);
  });

  return {
    id: 'storms',
    title: 'Storms',

    mount(el) {
      buildSkeleton(el);
      renderList(lastState, { force: true });
      renderWatch(lastState);
    },

    onEnter() {
      visible = true;
      pill.dataset.hidden = 'true';
      /* force: re-sort on open. Storms move slowly enough that nobody will
       * notice the order settling, and it is the one moment re-sorting is
       * safe — no thumb is mid-tap on a row that has not been drawn yet. */
      renderList(lastState, { force: true });
      renderWatch(lastState);
    },

    onLeave() {
      visible = false;
      /* The pill is the narrow-width entry point, so it returns whenever the
       * list is not on screen. It is hidden by CSS at wide widths. */
      pill.dataset.hidden = 'false';
    },

    /** First stop is the first storm, not the drawer chrome — a keyboard user
     *  opening the list wants a storm.
     *
     *  WITH NO STORMS, IT IS THE FIRST WATCHED AREA. Otherwise the one day
     *  this section is the entire content of the drawer is the one day
     *  keyboard focus lands on nothing and Tab starts from the chrome — which
     *  is precisely the §45 case, since a quiet ocean is when the watch list
     *  matters most. */
    focus() {
      return (
        body?.querySelector('.storm-row') ||
        watchEl?.querySelector('.watch-row') ||
        null
      );
    },

    /* --- driven by main.js ------------------------------------------------ */

    update(state) {
      lastState = state;
      renderPill(state);
      renderWatch(state);
      /* The pill updates whether or not this view is on screen; the list only
       * matters once mounted, and renderList guards on that itself. */
      renderList(state);
    },

    /**
     * EVERY STORM, IN THE ORDER THIS LIST DRAWS THEM, flattened across basin
     * groups (SPEC-UI §16.5).
     *
     * ==> IT EXISTS SO "3 OF 7" MEANS THE SAME THING ON TWO SURFACES. <== The
     * detail panel's stepper walks storms, and the only order that can possibly
     * be right there is the one the reader just scrolled past to get in. A
     * second ordering computed in the detail view would put the same storm at a
     * different position depending on which door you came through, which is the
     * kind of disagreement nobody reports and everybody distrusts.
     *
     * COMPUTED FROM STATE, NOT READ OFF THE DOM. The detail panel can be
     * reached by tapping a dot on the globe, which is a route where this list
     * has never been mounted and there are no rows to read.
     */
    orderedStorms() {
      const all = lastState?.storms || [];
      if (!all.length) return [];
      return groupsFor(all).flatMap((g) => g.storms);
    },

    /** Units changed in Settings — every wind and every distance on screen is
     *  stale, so this is a full rebuild for the same reason homeChanged is. */
    unitsChanged() {
      renderList(lastState, { force: true });
    },

    /** Home was set, moved, or cleared. That changes the sort order and every
     *  distance on screen, so this is always a full rebuild — patching would
     *  leave stale distances in place. */
    homeChanged() {
      renderList(lastState, { force: true });
    },

    isVisible: () => visible,
  };
}
