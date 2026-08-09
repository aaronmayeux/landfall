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
 *   - NO HOME: strongest-first within canonical basin order, no distance.
 *   - HOME SET: nearest-first within basin order, distance on every row.
 *   - Basin headers are real <h2>s, only when more than one basin is present.
 *   - Three empty states, never conflated: loading / clear / unavailable.
 *   - NO RE-SORT WHILE VISIBLE: presence changes rebuild; a poll that only
 *     changed numbers patches rows in place (SPEC §16, §13).
 *
 * ==> TWO LINES PER ROW, AND THE SCOPE FILTER IS GONE (2026-07-25) <==
 *
 * The row used to be one line — swatch, name, then all the metadata pushed
 * right. On a 340px rail with a home set, "Cat 2 · 85 kt · closing · 9,901 mi"
 * is most of the width, so the NAME took whatever was left and ellipsised.
 * Storm names are the one thing on this surface that must never be truncated:
 * the name is how you refer to the thing, how you find it in a forecast, and
 * how a stranger arriving by shared link knows what they are looking at. The
 * name now owns its own line and the metadata sits under it, quieter.
 *
 * The scope filter (All / My basin / Near me) was removed with it. Three
 * buttons pinned above a list that has never held more than nine rows is a
 * filter that saves no work, and it cost a row of chrome at the top of the one
 * surface that is also the app's whole accessibility layer. Home still sorts
 * nearest-first and still puts a distance on every row — that was the part
 * carrying its weight. `SCOPE`, `SCOPE_RADIUS_NM`, `filterByScope`, and
 * `availableScopes` were deleted rather than left behind as dead exports.
 *
 * Row activation (tap/Enter) calls the injected onSelect(storm), which pushes
 * the detail view onto the drawer's stack and flies the camera.
 *
 * Imports: config/, lib/. Never map/ or data/ — main.js wires the store in.
 */

import { BASIN_LABEL, basinRank } from '../lib/basin.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, ageMs } from '../lib/time.js';
import { formatDistance, formatWind } from '../lib/units.js';
import { FRESHNESS } from '../config/constants.js';
import { isSilent, SILENT_SHORT } from '../lib/silence.js';
import { isEnded, stormSwatch, ENDED_SHORT, ENDED_ROW } from '../lib/lifecycle.js';
import { GENESIS } from '../config/constants.js';
import { genesisColor, formatPercent } from '../lib/genesis.js';

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
 *        Shape: { get, distanceTo, motionTrend }
 * @param {() => string|null} opts.units  the resolved unit system, injected
 *        from the settings store by main.js.
 */
export function createStormsView({ pill, onSelect, onSelectArea, onRetry, home, units }) {
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
      el.textContent = line;
      node.appendChild(el);
    }
  }

  function renderPill(state) {
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
    const watched = state.genesis?.areas?.length ?? 0;

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
      : n === 0 && state.genesis?.status === 'none_matched' ? 'All clear'
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
    if (st.every((x) => x === 'ok') && state.genesis?.status === 'none_matched') return 'clear';
    return 'unavailable';
  }

  /* --- rows --------------------------------------------------------------- */
  /** Distance text for a row, or null when there is no home. Returns the
   *  formatted string only — the timestamp that came with it is used by the
   *  detail panel (Phase 4); the list row is a glance surface. */
  function rowDistance(s) {
    const d = home?.distanceTo(s);
    return d ? formatDistance(d.nm, sys()) : null;
  }

  /* The one word a row has space for. Wording lives here so it can be changed
   * in one place; the VALUES it maps come from data/home.js and are not
   * cosmetic. A storm with no published motion, a stationary one, or one too
   * far away for the question to matter returns null and gets no word — three
   * different silences that all honestly mean "not stated" (SPEC §5). */
  const TREND_WORD = Object.freeze({ closing: 'closing', receding: 'receding' });

  /** Trend text for a row, or null. Placed BEFORE the distance in the meta
   *  line: after it, "340 mi receding" reads as a measurement rather than a
   *  direction of travel. */
  function rowTrend(s) {
    const t = home?.motionTrend?.(s);
    return t ? TREND_WORD[t] || null : null;
  }

  /** Wind for a row. A source with no CURRENT wind number shows its PEAK,
   *  labelled — GDACS publishes only the forecast maximum, and printing that
   *  bare would read as the storm's wind right now.
   *
   *  IN THE USER'S UNITS, WITH NO KNOTS ANYWHERE. This printed raw knots until
   *  2026-07-25, which is the source unit and nobody's reading unit — an
   *  American looking at "50 kt" has to convert before the number means
   *  anything, and this is the glance surface where conversion is exactly what
   *  there is no time for. The detail panel still shows knots, in the
   *  parenthetical, where someone cross-checking an advisory can find them. */
  function windText(s) {
    if (s.windKt != null) return formatWind(s.windKt, sys());
    if (s.peakWindKt != null) return `peak ${formatWind(s.peakWindKt, sys())}`;
    return null;
  }

  /** The metadata line, assembled once so the row builder and the in-place
   *  patcher below can never produce different text from the same storm. */
  function metaText(s) {
    const label = categoryShortLabel(s.category, s.nature, s.categoryCode);
    return [label, windText(s), rowTrend(s), rowDistance(s)]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * TWO LINES: the name, then everything else beneath it.
   *
   * The name is never truncated and never competes for width — see the header
   * note. The metadata keeps the monospace treatment because it is figures
   * being compared down a column, and it drops to secondary colour so the
   * eye lands on the names first when scanning the list.
   */
  function rowHtml(s) {
    const swatch = stormSwatch(s);
    const meta = metaText(s);
    const stale = ageSuffix(s);
    return `
      <button class="storm-row" type="button" role="listitem" data-id="${s.id}"
              aria-label="${esc(rowLabel(s, meta))}">
        <span class="row-swatch" style="--swatch:${swatch}" aria-hidden="true"></span>
        <span class="row-text">
          <span class="row-name">${esc(s.name)}</span>
          <span class="row-meta">${esc(meta)}${stale}</span>
        </span>
      </button>
    `;
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
    return (b.windKt ?? b.peakWindKt ?? -1) - (a.windKt ?? a.peakWindKt ?? -1);
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
  function rowLabel(s, meta) {
    /* The same precedence as `ageSuffix`, and STALENESS IS NOW SPOKEN TOO. It
     * was the one qualifier a screen reader never heard: the visible row said
     * "5 hrs ago" and the accessible name stopped at the distance, so the
     * reader with the least context got the least honest row. */
    const q = isEnded(s)
      ? ENDED_ROW
      : isSilent(s)
        ? SILENT_SHORT
        : isStale(s)
          ? formatAge(s.observedAt)
          : null;
    return q ? `${s.name}, ${meta}, ${q}` : `${s.name}, ${meta}`;
  }

  /** The separator every other pair of facts on the meta line already uses.
   *
   *  ==> IT IS ITS OWN SPAN, NOT PART OF THE QUALIFIER'S TEXT. <== The
   *  qualifier is coloured — amber for a stale stamp, red for a silent storm —
   *  and a dot inside that span would inherit the colour, so the one
   *  separator on the line that is trying hardest to be neutral would be the
   *  only alarming one. `aria-hidden` because a screen reader already gets the
   *  qualifier as a clause in `rowLabel`; a spoken "middle dot" is noise. */
  const SEP = '<span class="row-sep" aria-hidden="true">·</span>';

  function ageSuffix(s) {
    /* ENDED OUTRANKS SILENCE OUTRANKS STALENESS, and each REPLACES the one
     * below rather than joining it. The row has space for exactly one
     * qualifier, and it must be the strongest claim available: "26 hrs ago"
     * under an ended storm reads as a late update on something still running.
     *
     * EACH IS PRECEDED BY THE SAME DOT THE REST OF THE LINE USES. It used to
     * be spaced with a bare margin, so a row read "TS · 52 mph · 6,502 mi 5
     * hrs ago" — every fact separated by a dot except the last one, which
     * looked like part of the distance. Aaron caught it on glass 2026-08-09. */
    if (isEnded(s)) return `${SEP}<span class="row-ended">${ENDED_ROW}</span>`;
    if (isSilent(s)) return `${SEP}<span class="row-silent">${SILENT_SHORT}</span>`;
    if (isStale(s)) return `${SEP}<span class="row-stale">${formatAge(s.observedAt)}</span>`;
    return '';
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
      body.innerHTML = `<p class="list-note">${note}</p>`;
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

    const basins = [...new Set(visible.map((s) => s.basin))].sort(
      (a, b) => basinRank(a) - basinRank(b)
    );
    const showHeaders = basins.length > 1; // a lone header over two rows is noise

    body.innerHTML = basins
      .map((basin) => {
        const rows = visible
          .filter((s) => s.basin === basin)
          .sort(sortWithinBasin)
          .map(rowHtml)
          .join('');
        return showHeaders
          ? `<section class="basin-group"><h2 class="basin-head">${esc(BASIN_LABEL[basin] || basin)}</h2>${rows}</section>`
          : rows;
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

  function patchRows(state) {
    if (!body) return;
    for (const s of state.storms) {
      const el = body.querySelector(`.storm-row[data-id="${CSS.escape(s.id)}"]`);
      if (!el) continue;
      const meta = metaText(s);
      const stale = ageSuffix(s);
      el.querySelector('.row-meta').innerHTML = `${esc(meta)}${stale}`;
      /* The accessible name carries the same text, so a screen reader is never
       * told a category the visible row stopped showing two polls ago. */
      el.setAttribute('aria-label', rowLabel(s, meta));
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

    const partial = [];
    if (g.sources?.nhc?.status === 'unavailable') {
      partial.push('The NHC outlook is not responding. This does not mean nothing is forming in the Atlantic or East Pacific.');
    }
    if (g.sources?.jtwc?.status === 'unavailable') {
      partial.push('JTWC is not responding. Areas in the Northwest Pacific and Indian Ocean may be missing.');
    }

    const bodyHtml = areas.length
      ? areas.map(watchRowHtml).join('')
      : partial.length
        ? ''
        : '<p class="list-note">Nothing being watched right now.</p>';

    /* A PLAIN HEADING AND NOTHING FOCUSABLE, exactly like `.basin-head` above
     * it. Screen-reader users jump by heading; Tab hits rows only (§16). */
    watchEl.innerHTML = `
      <h2 class="watch-head">
        <span class="watch-title">Being watched</span>
        <span class="watch-count">${areas.length}</span>
      </h2>
      <div class="watch-rows" role="list" aria-label="Areas being watched">
        ${partial.map((t) => `<p class="list-note list-error">${esc(t)}</p>`).join('')}
        ${bodyHtml}
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
