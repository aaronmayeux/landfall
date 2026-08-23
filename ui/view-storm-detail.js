/**
 * view-storm-detail.js — the storm detail view (SPEC §16).
 *
 * A VIEW INSIDE THE ONE DRAWER, pushed onto the stack by the storm list. The
 * drawer owns the header, the back button, and the close button; this file
 * owns the storm. Back returns to wherever you came from — the list normally,
 * and Layers if you took the side trip to turn something on.
 *
 * IDENTITY LIVES IN THE DRAWER HEADER. The storm's name is the view's title,
 * supplied through titleFor(), so the pinned identity is the drawer's own
 * chrome rather than a second header stacked under it. The category swatch
 * rides with it — category color is the SWATCH, never the text color (§6).
 *
 * Structure rules it implements:
 *  - The timestamp PINS below the header; the body scrolls under it. You must
 *    never lose track of which storm and how old while reading.
 *  - The timestamp is the load-bearing element: three freshness bands
 *    (fresh / aging / stale, thresholds in FRESHNESS), and a SEPARATE
 *    geometry line that exists only when the MapServer lags the feed by more
 *    than one advisory cycle — silence means synchronized.
 *  - Nulls are omitted, not zeroed. A missing pressure row is honest;
 *    "0 mb" is a lie.
 *  - Native unit first, converted in parentheses (knots is what NHC says).
 *  - Sections collapse per user, persisted (STORAGE_KEY.sections).
 *  - Watch/warning wording: "None in effect" vs "Watches and warnings
 *    unavailable" are two different strings, by design. Never "advisory".
 *  - Storm leaves the feed while open → the reduced ghost form in place:
 *    identity, last-known vitals, the notice. No home block, no layer link.
 *
 * THERE IS NO LAYERS SECTION HERE ANY MORE (2026-07-25). §16 sketched inline
 * toggles; that became a shortcut row into the Layers view; that is now gone
 * too. Layers are reached from the floating Layers button, which is on screen
 * the entire time this panel is open — a second door saved no navigation and
 * cost a summary line that had to be kept in step with the layer store. What
 * survives from that section is the map-geometry failure notice, promoted to
 * a bare uncollapsible block at the top of the body; see mapProblemHtml.
 *
 * UNITS ARE THE USER'S FIRST, THE SOURCE'S SECOND. "98 mph (85 kt)", not the
 * other way round. Knots and nautical miles stay in the parenthetical because
 * the advisory text a few rows down quotes them and a reader cross-checking
 * one against the other should not have to convert in their head — but they
 * are the footnote, not the headline.
 *
 * ==> THE DISCLAIMER FOOTER, AND WHY IT IS ON THIS PANEL SPECIFICALLY <==
 * §17 A1 shipped the disclaimer on two surfaces — a first-run acknowledgement
 * and the Settings/About view — and named this panel as the placement worth
 * more than either, left unbuilt. It is built now. This is the one screen in
 * the app where somebody reads a forecast and DECIDES SOMETHING: whether the
 * thing is coming for them, whether to leave. A provenance statement is worth
 * the most at the moment of the decision, not at the moment of arrival, which
 * is where the other two sit.
 *
 * It is a FOOTER, not a pinned banner. The stamp above is pinned and the body
 * scrolls beneath it; adding two lines to the pinned region costs reading
 * height on the phone that has the least of it, and colors the disclaimer
 * with the freshness band (fresh/aging/stale) it has nothing to do with. The
 * panel is short — vitals, home, in effect, wind field, advisory collapsed —
 * so a footer is read.
 *
 * The NHC link is not decoration. "Always follow the National Hurricane
 * Centre" with no way to get there is advice without a door.
 *
 * Imports: config/, lib/ only, PLUS ui/disclaimer.js for the wording — one
 * source for that text, never retyped at a call site (§17 A1). Home, geometry,
 * and layer state arrive through injected facades from main.js — ui/ never
 * imports data/ (SPEC §12).
 */

import { FRESHNESS } from '../config/constants.js';
import { readSections, writeSections } from '../lib/section-state.js';
import { DISCLAIMER } from './disclaimer.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { formatAge, formatUntil, formatClockDay, ageMs } from '../lib/time.js';
import {
  formatWind, formatWindRange, formatSpeed, formatDistance, formatPressure, formatBearing,
} from '../lib/units.js';
import { windBracketFromBands } from '../lib/wind-bracket.js';
import { isSilent, silenceNote, silenceSectionNote } from '../lib/silence.js';
import {
  isEnded, endedNote, endedSectionNote, stormSwatch, noCurrentReading,
} from '../lib/lifecycle.js';
import { wwLegend } from '../lib/watchwarning.js';
import { motionHeading } from '../lib/heading.js';
import { headingArrow } from './heading-arrow.js';
import { createStormStepper } from './storm-stepper.js';
import { windThresholdFromProps, windColor, WIND_LABEL } from '../lib/wind.js';
import { loadTowns, townsOrNull, populationState } from '../data/population.js';
/* The same shapes Home draws beside its headings, for the same ideas — Wind
 * field takes Home's wind glyph, Rainfall takes its rain cloud. See
 * ui/section-icon.js for why the set is a file rather than a private helper. */
import { iconSvg } from './section-icon.js';
import { DOTS } from './loading-dots.js';
import { createEnvHealth, ENV_SECTION } from './env-health.js';
import { createPeopleInPath, PEOPLE_SECTION } from './people-in-path.js';
import { createRainStorm, RAIN_SECTION } from './rain-storm.js';
import { createFloodingStorm, FLOOD_SECTION } from './flooding-storm.js';
import { FLOOD_POINTER } from './flood-words.js';
import { createCapStorm } from './cap-storm.js';

/* --- small helpers --------------------------------------------------------- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "Hurricane · Category 2" — the second identity line. Trusts NHC's own
 *  label for what kind of thing it is (§4); derives only the number. */
/**
 * The classification line under the storm's name.
 *
 * ==> AN ENDED STORM GETS "LAST REPORTED", AND THE PREFIX IS NOT DECORATION.
 * Everything this function returns is a NOUN PHRASE in the present tense —
 * "Hurricane · Category 4" — set in the largest supporting text on the panel,
 * directly under the name. On a storm whose agency has issued its final
 * advisory that is a severity claim about right now, sourced from a bulletin
 * superseded by its own author. The grey swatch beside the name and the badge
 * below both qualify it, but neither is IN the sentence, and the sentence is
 * what a reader takes away. Two words fix it; nothing else on this panel had to
 * move.
 */
/**
 * The line under the storm's name.
 *
 * ==> IT IS QUALIFIED WHENEVER THERE IS NO CURRENT READING BEHIND IT. <==
 * Bare, this is the most present-tense claim on the panel: "Tropical
 * Depression", stated flat, reads as what the storm IS. On a system nobody has
 * analysed since Thursday that is a two-day-old classification wearing the
 * present tense, and it sat directly above a badge explaining that we have no
 * idea what the storm is doing — two answers to the same question, one screen.
 *
 * `noCurrentReading` rather than `isEnded` alone, and rather than a second
 * branch for silence. It is the one predicate for "nothing published lately"
 * and it already backs the cage head, the last-known dot and the swatch; a
 * fourth surface asking the same question with its own test is how one of them
 * ends up answering differently.
 *
 * ==> "LAST REPORTED", NOT "LAST KNOWN", AND THE REASON IS TWO INCHES BELOW IT.
 * <== It was written as "Last known" and tools/ended-check.mjs printed the
 * rendered panel back with the vitals header directly under it, which is
 * relabelled "Last known" for a storm in this state. Two identical phrases
 * stacked down one panel read as a templating bug. `reported` is also true of
 * both states: somebody reported this classification, and then stopped.
 */
function natureLine(storm) {
  if (noCurrentReading(storm)) return `Last reported: ${natureWords(storm)}`;
  return natureWords(storm);
}

function natureWords(storm) {
  const n = storm.nature;
  if (n === 'post-tropical') return 'Post-Tropical Cyclone';
  if (n === 'potential') return 'Potential Tropical Cyclone';
  if (n === 'remnant') return 'Remnant Low';
  const sub = n === 'subtropical';
  /* Hurricane strength with no category behind it — GDACS's ceiling, not a
   * gap in our parse. Named plainly rather than shown as a bare cyclone. */
  if (storm.category == null && storm.categoryCode === 'HU') return 'Hurricane / Typhoon';
  if (storm.category == null) return sub ? 'Subtropical Cyclone' : 'Tropical Cyclone';
  if (storm.category === 0) return sub ? 'Subtropical Depression' : 'Tropical Depression';
  if (storm.category === 1) return sub ? 'Subtropical Storm' : 'Tropical Storm';
  return `Hurricane · Category ${storm.category - 1}`;
}

function positionText(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const la = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}

/** Advisory string out of the advisoryKey ("nhc:al052026:12A" → "12A"). */
function advFromKey(key) {
  const parts = String(key || '').split(':');
  return parts.length >= 3 ? parts[2] : null;
}

/** The storm's own source, in the words the user should see.
 *
 *  The ghost note used to say "the NHC feed" for every storm regardless of
 *  where it came from, and `ghost` is set for BOTH sources. Bertha is the
 *  live case — she left NHC while GDACS still carried her, so the reverse
 *  will happen too and the note would have credited the wrong agency for a
 *  storm's disappearance. An unknown source degrades to the generic wording
 *  rather than guessing (§5). */
function sourceLabel(source) {
  if (source === 'nhc') return 'the NHC feed';
  if (source === 'gdacs') return 'the GDACS feed';
  return 'the feed it came from';
}

/** The footer that says this app is not an official source.
 *
 *  `role="note"` and not `aria-live`: it is standing context, not something
 *  that just happened. A screen reader meets it in reading order like anyone
 *  else meets it at the end of the panel.
 *
 *  Rendered on the ghost form too. A storm that has left the feed is the case
 *  where a reader is MOST likely to be looking at something out of date, so
 *  dropping the provenance line there would be exactly backwards.
 *
 *  ==> THE LINK TAKES THE STORM'S SOURCE AND IS NOT ALWAYS THE NHC. <== It was
 *  hardcoded, so a Philippine typhoon's footer offered a US agency that
 *  publishes nothing about it. `DISCLAIMER.sourceLink` owns the table and the
 *  reasoning; this only has to hand it the source and cope with a null, which
 *  is what an unrecognised source returns rather than a guess. */
function disclaimerHtml(source) {
  const src = DISCLAIMER.sourceLink(source);
  return `
    <div class="detail-disclaimer" role="note">
      ${esc(DISCLAIMER.short)}${
        src
          ? `
      <a class="detail-disclaimer-link" href="${src.url}"
         target="_blank" rel="noopener noreferrer">${esc(src.label)}</a>`
          : ''
      }
    </div>`;
}

/* --- section collapse persistence ------------------------------------------
 * MOVED TO lib/section-state.js (2026-08-09). It was two inline helpers here
 * until §45's "Being watched" section needed the same record, and a second
 * copy of a localStorage read is where two callers quietly start disagreeing
 * about what an unparseable value means. Same key, same shape, one owner. */

/**
 * @param {object} opts
 * @param {object}      opts.home  injected: {get, distanceTo, closestApproach}.
 *        ==> NOTHING ABOUT THE READER'S HOUSE IS RENDERED BY THE RAINFALL
 *        SECTION ANY MORE (§56.9). <== `windReach` was its gate and is gone
 *        with it. What is left here is read by the Home block and the closest
 *        -approach lines, which are about where the storm passes rather than
 *        about the weather at an address.
 * @param {() => string|null} opts.units  the resolved unit system, injected
 *        from the settings store by main.js. ui/ never imports data/ (§12),
 *        and every formatter on this panel is handed the SAME answer so two
 *        figures in one drawer can never disagree about what system they are
 *        in.
 * @param {{value:Function, summarize:Function, retry:Function}} [opts.flood] the
 *   national flood alert facade (§48.21). Optional: without it the Rainfall
 *   section's flood block is simply absent, which is what the older suites that
 *   build this view get.
 * @param {() => number} [opts.now] the clock, injectable — the same convention
 *   `ui/view-home.js` follows, and for the same reason: a flood warning's
 *   expiry can otherwise only be tested during a flood warning.
 * @param {(storm) => void}      opts.onRetryGeometry
 * @param {(storm, opts?) => Promise<object>} opts.loadAdvisory  injected
 *   facade over data/advisory.js — ui/ never imports data/ (§12).
 * @param {(storm) => Promise<number|null>} [opts.loadGustKt]  the gust for an
 *   NHC storm, in knots. Optional: without it the Gusts row is simply absent
 *   on NHC storms, which is what every suite predating it gets — and which is
 *   also exactly how the panel behaved before this shipped, so an older
 *   caller degrades to the old behaviour rather than to a broken one.
 * @param {() => Array} [opts.siblings]  every storm, in the order the storm
 *   list draws them. The stepper's whole content. Injected rather than
 *   imported for the usual §12 reason, and injected as a FUNCTION because the
 *   list re-sorts on every poll — a captured array would step through storms
 *   in an order that stopped being true minutes ago.
 * @param {(storm) => void} [opts.onStep]  select another storm: same call the
 *   list row makes, so the camera flies and the geometry loads exactly as if
 *   the reader had gone back and tapped it.
 */
export function createStormDetailView({
  home, onRetryGeometry, loadAdvisory, loadGustKt, loadAlerts, envShips, units,
  flood: floodFacade = null, surge = null, siblings, onStep, now = () => Date.now(),
}) {
  /* The Environment section (§47.8) is a self-contained controller in
   * ui/env-health.js — this file is past §12's ceiling and holds only the
   * seams: the section row, one ensure, one wire, one repaint. */
  const envH = createEnvHealth({ ...envShips, units });

  /* Rainfall (§48.9) takes the same shape and for the same reason. It is handed
   * the SAME advisory facade the Advisory section uses, so both read one cached
   * record and can never show two different advisories for one storm. */
  /* ==> ONE DEPENDENCY, AND IT TOOK FIVE UNTIL 2026-08-22 (§56.9). <== `rain`,
   * `house`, `flood`, `units` and `now` were the house block's, and the block
   * is gone: a storm panel is about the storm, and a point forecast at the
   * reader's address is true whichever storm they happened to tap. The
   * `Flooding` section below owns the storm's flood facts now, and the home
   * screen owns the house's. */
  const rainH = createRainStorm({ loadAdvisory });

  /* Local agency alerts (§50.5), same shape again. It reads a GLOBAL list
   * rather than anything about this storm, which is why its facade takes no
   * storm argument — the filtering to this storm's countries happens in
   * lib/cap.js, inside the controller. */
  const capH = createCapStorm({ loadAlerts });

  /* Flooding (§56.7) — one section for both kinds of water, and the third
   * controller on this panel to take this shape.
   *
   * ==> IT IS HANDED `capH` RATHER THAN A SECOND CAP FETCH. <== §56.8 moves
   * the storm-surge rows out of `Watches and warnings` and into here, and the
   * two sections must never disagree about what an agency has out. One
   * controller owns that fetch; this reads the other half of the same
   * partition, so a row lands in exactly one section.
   *
   * ==> AND `surge` IS THE SAME FACADE THE HOME DASHBOARD TAKES. <==
   * `data/gdacs-surge.js` memoizes one answer per storm, which the coast layer
   * also reads — so the figure in this drawer, the figure on the dashboard and
   * the paint on the shoreline are one number. */
  const floodH = createFloodingStorm({
    flood: floodFacade
      ? { summaryFor: (s2) => floodSummary(s2), retry: () => floodFacade.retry() }
      : null,
    /* ==> THE CAP RETRY REPAINTS BOTH SECTIONS, NOT JUST THIS ONE. <== One
     * fetch feeds `Watches and warnings` and the storm-surge rows here, so a
     * press in Flooding that redrew only Flooding would leave the section
     * above it sitting on a failure that had just been fixed. `renderCapBody`
     * is the function that redraws both; the controller's own repaint would
     * redraw one. */
    cap: {
      waterFor: (s2) => capH.waterHtml(s2, now()),
      retry: async () => { await capH.retry(storm); renderCapBody(); },
    },
    surge,
    units,
  });

  /** The resolved unit system, asked fresh on every render. NEVER cached: the
   *  user can change it in Settings while this panel is open, and a captured
   *  value would leave half the app in one system. */
  const sys = () => units?.() ?? null;
  let host = null;
  let visible = false;
  let storm = null;        // last-known storm object (survives feed exit → ghost)
  let ghost = false;
  let geo = { state: 'idle' }; // 'idle'|'loading'|'ok'|'error', bundle?, error?
  /* Advisory text is fetched ON EXPAND, not on selection — the collapsed
   * section IS the gate (§7's "fetching layers fetch only while switched on",
   * applied to a reading surface instead of a layer). `phase` is ours;
   * `rec.state` is the data layer's four-way answer. */
  /**
   * THE ADVISORY RECORD IS BOUND TO THE STORM IT BELONGS TO, and that binding
   * is the fix for a real bug (Aaron, on glass, 2026-07-25): open a storm's
   * advisory, then select another storm, and the FIRST storm's advisory stayed
   * on screen. A reload cleared it; navigating never did.
   *
   * THE CAUSE, and it is worth keeping because the shape of it will recur.
   * `onEnter` reset this state behind `if (s.id !== storm?.id)` — a comparison
   * that can never be true, because the drawer calls `titleFor(arg)` from
   * `renderChrome()` BEFORE it calls `onEnter(arg)` (ui/drawer.js `enter()`),
   * and `titleFor` assigns `storm = s` on its way past. By the time onEnter
   * ran, `storm` already WAS the new storm and the ids always matched.
   * Geometry survived only because main.js drives it externally with an
   * explicit `setGeometry({state:'loading'})`; the advisory had no such
   * driver and was the one piece of state relying on that dead branch.
   *
   * So this no longer INFERS whether the storm changed. `forId` and `forKey`
   * say which storm and which advisory the record is for, and anything else
   * is stale by definition — immune to call ordering, and immune to the next
   * method that decides to assign `storm` on its way past.
   */
  let adv = { phase: 'idle', rec: null, forId: null, forKey: null };
  let advSeq = 0;

  /**
   * The gust, in knots, and WHICH storm/advisory it belongs to.
   *
   * ==> BOUND TO forId/forKey FOR THE SAME REASON THE ADVISORY IS. <== This is
   * a second async read landing into a panel the reader can step away from
   * mid-flight, and an unbound number here would put one hurricane's gust
   * under another hurricane's name — the exact bug the block above describes,
   * with a worse payload, because a wrong wind figure looks perfectly
   * plausible where a wrong paragraph is obviously wrong.
   *
   * NO `phase`. The advisory needs one because it renders loading, empty and
   * error states in a section of its own; this is a single row inside a
   * section that has already painted from a different source. It is absent,
   * then it is there. `kt: null` and "not fetched yet" render identically and
   * are allowed to.
   */
  let gust = { kt: null, forId: null, forKey: null };
  let gustSeq = 0;

  /** Only onEnter writes this, so no other method can clobber the comparison
   *  the way titleFor clobbered the last one. */
  let enteredId = null;

  const advisoryIsForCurrentStorm = () =>
    !!storm && adv.forId === storm.id && adv.forKey === storm.advisoryKey;

  const gustIsForCurrentStorm = () =>
    !!storm && gust.forId === storm.id && gust.forKey === storm.advisoryKey;
  let collapsed = readSections();
  /* The drawer re-renders its header when a view asks it to — a poll can
   * change a storm's category, and the title carries the swatch. */
  let requestChrome = null;

  let stampEl = null;
  let bodyEl = null;

  /**
   * THE STEPPER (SPEC-UI §16.5), built by ui/storm-stepper.js and shared with
   * the home dashboard. This file owns only what a press MEANS here: stepping
   * is selecting, so the camera flies and the geometry loads exactly as if the
   * reader had gone back to the list and tapped the row.
   */
  /** BUILT AT MOUNT, NOT AT CONSTRUCTION — it creates a DOM node, and this
   *  view is constructed in app/views.js long before anything opens it, and by
   *  headless suites with no DOM at all. Lazy is the drawer's own rule too. */
  let stepper = null;

  const buildStepper = () => createStormStepper({
    siblings: () => siblings?.() || [],
    current: () => storm,
    onStep: (next) => onStep?.(next),
  });

  function buildSkeleton(el) {
    host = el;
    /* No header and no back button: the drawer owns both. The stepper and the
     * stamp pin directly under the drawer's header; the body scrolls beneath
     * them.
     *
     * ==> STEPPER ABOVE STAMP, AND THE ORDER IS THE READING ORDER. <== Name
     * (drawer header) → which one of how many → how old. The stamp is the
     * load-bearing freshness element (§16) and it stays the last thing before
     * the body, where the eye is already trained to find it. */
    host.innerHTML = `
      <div class="detail-stamp" id="detail-stamp"></div>
      <div class="drawer-body detail-body" id="detail-body"></div>
    `;
    stepper = buildStepper();
    host.prepend(stepper.el);
    stampEl = host.querySelector('#detail-stamp');
    bodyEl = host.querySelector('#detail-body');
  }

  /* --- render pieces ------------------------------------------------------- */

  /** The drawer header's title for this view: swatch + name + nature. Built
   *  as a Node rather than a string because the drawer accepts either, and
   *  this one carries a colored swatch that must not be escaped away.
   *
   *  ==> THE NATURE LINE IS A CHIP, THE SAME ONE THE DASHBOARD USES. <== It
   *  was bare text in a slot where the home dashboard put a bordered chip, so
   *  the two drawers shared a header shape and disagreed about what went in it.
   *  Settled on glass 2026-08-20: `.drawer-chip` on both (ui/panels.css). The
   *  WORDS are untouched — `natureLine` still decides them, including the
   *  "Last reported:" qualifier it adds when nothing current stands behind the
   *  classification. */
  function titleNode() {
    const wrap = document.createElement('div');
    wrap.className = 'drawer-identity';
    if (!storm) {
      wrap.textContent = 'Storm';
      return wrap;
    }
    wrap.innerHTML = `
      <div class="drawer-identity-line">
        <span class="drawer-identity-dot" style="--dot-ink:${stormSwatch(storm)}" aria-hidden="true"></span>
        <h1 class="drawer-title">${esc(storm.name)}</h1>
      </div>
      <div class="drawer-identity-sub">
        <span class="drawer-chip">${esc(natureLine(storm))}</span>
      </div>
    `;
    return wrap;
  }

  /**
   * The note a section shows when its content was DELIBERATELY withheld, or
   * null when nothing was.
   *
   * ==> ONE HELPER, SO PRECEDENCE CANNOT DIVERGE PER SECTION. <==
   * A storm can be both silent and ended — it went quiet, and then its feed
   * dropped it — and there are four sections that each ask this question. Four
   * copies of `endedSectionNote(storm) || silenceSectionNote(storm)` is three
   * chances for one of them to end up the other way round, which would leave the
   * panel saying "no update in over 24 hours, this storm may no longer be
   * active" in one place and "no further advisories will be issued" in another,
   * about the same storm, on the same screen.
   *
   * ENDED FIRST, always — lib/lifecycle.js `endedWins` states why: silence is a
   * hedge, and once the agency has said it is finished the hedge is the less
   * honest sentence.
   */
  function withheldNote() {
    return endedSectionNote(storm) || silenceSectionNote(storm);
  }

  function renderStamp() {
    if (!stampEl || !storm) return;

    /* ENDED IS THE FIFTH BAND, AND IT TAKES THE LINE THE SAME WAY SILENCE DOES
     * — for a stronger version of the same reason. The freshness bands qualify a
     * timestamp that is still arriving; silence says the next one has not come;
     * this says there will not be one. Leading with an advisory number here
     * would read as an update that is merely overdue. The advisory identity
     * moves to the second line, where it is provenance for the position on the
     * map rather than a claim about how current anything is. */
    const endNote = endedNote(storm);
    if (endNote) {
      /* THE ADVISORY NUMBER AND NOTHING ELSE. The headline above already carries
       * the clock, and on the declared path the two timestamps are THE SAME
       * INSTANT — the ending is stamped with the agency's own issuance time — so
       * repeating it printed "Mon 6:58 PM" twice, three lines apart, which reads
       * as two different facts that happen to agree. This line's only remaining
       * job is provenance for the position on the map: which advisory drew it. */
      const advE = advFromKey(storm.advisoryKey);
      const lastE = advE ? `Last advisory ${esc(advE)}` : '';
      stampEl.dataset.band = 'ended';
      stampEl.innerHTML =
        `<div>${esc(endNote.headline)}</div>` +
        (lastE ? `<div class="detail-stamp-geo">${lastE}</div>` : '') +
        `<div class="detail-stamp-detail">${esc(endNote.detail)}</div>`;
      return;
    }

    /* SILENCE IS THE FOURTH BAND AND IT REPLACES THE LINE RATHER THAN TINTING
     * IT. The other three qualify a timestamp that is still arriving — "this
     * is advisory 13, it is a few hours old". Once the publisher has stopped
     * there is no next advisory to be a few hours short of, and leading with
     * an advisory number under a red tint reads as a late update rather than
     * an absent one. The advisory identity moves down to the second line,
     * where it belongs: it is now provenance for the position on the map, not
     * a claim about how current anything is. */
    const note = silenceNote(storm);
    if (note) {
      /* NO CLOCK ON THIS LINE. The headline above it already states the
       * absolute time ("since Thu 7:00 AM"), and repeating it two lines later
       * with the same words spent the reader's attention on nothing. What is
       * NOT up there is how long ago that was, so the age stays and the clock
       * goes. The classification moved to the identity line, where it is now
       * qualified as last known \u2014 it does not need saying twice either. */
      const adv0 = advFromKey(storm.advisoryKey);
      const age0 = formatAge(storm.observedAt);
      const last = [
        adv0 ? `Last advisory ${esc(adv0)}` : null,
        age0 ? esc(age0) : null,
      ].filter(Boolean).join(' \u00b7 ');
      stampEl.dataset.band = 'silent';
      /* ==> NO WARNING GLYPH. <== It said "fault" a second time, on top of a
       * color that was already saying it, about a state in which nothing
       * failed. See the band's note in ui/panels.css. */
      stampEl.innerHTML =
        `<div>${esc(note.headline)}</div>` +
        (last ? `<div class="detail-stamp-geo">${last}</div>` : '') +
        `<div class="detail-stamp-detail">${esc(note.detail)}</div>`;
      return;
    }

    const a = ageMs(storm.observedAt);
    const band =
      a == null ? 'stale'
      : a <= FRESHNESS.freshUntil ? 'fresh'
      : a <= FRESHNESS.agingUntil ? 'aging'
      : 'stale';
    const adv = advFromKey(storm.advisoryKey);
    const clock = formatClockDay(storm.observedAt);
    const age = formatAge(storm.observedAt);
    const line = [
      adv ? `Advisory ${esc(adv)}` : null,
      clock ? `${esc(clock)}${age ? ` (${esc(age)})` : ''}` : null,
    ].filter(Boolean).join(' · ');

    /* Geometry line exists ONLY when lagged OR when we are showing geometry
     * the source could not replace (`held`). Silence still means synchronized.
     * A held bundle inside the normal lag window would otherwise say nothing
     * at all, which is the case that blanked Fausto's map: the shape on screen
     * was right, it just wasn't this advisory's, and nothing said so. */
    let geoLine = '';
    if (geo.state === 'ok' && (geo.lagged || geo.held) && geo.bundle?.stamp) {
      const gAdv = geo.bundle.stamp.advisnum;
      const gAge = formatAge(geo.bundle.stamp.filedate);
      geoLine = `<div class="detail-stamp-geo">Cone and tracks from ${
        gAdv ? `advisory ${esc(gAdv)}` : 'an earlier advisory'
      }${gAge ? ` · ${esc(gAge)}` : ''}</div>`;
    }
    stampEl.dataset.band = band;
    stampEl.innerHTML = `<div>${band === 'stale' ? '⚠ ' : ''}${line || 'No timestamp'}</div>${geoLine}`;
  }

  /* `defaultCollapsed` exists for exactly one section. Everything on this
   * panel is a few lines and opens by default; the advisory is a full
   * teletype product and would push every one of them off screen (§16 item 7
   * — "never auto-expanded"). The user's own choice, once made, is persisted
   * and wins over the default from then on. */
  /* ==> THE ICON IS AN ARGUMENT, NOT A LOOKUP KEYED ON `id`. <== A map from
   * section id to icon would have to live somewhere, and wherever it lived it
   * would be a second list of this panel's sections that a new section could
   * be added to only half of — the failure being that the new section silently
   * gets no icon and looks like a rendering bug. Passed in at the call site,
   * an icon is impossible to forget: it sits in the same line as the heading
   * it belongs to. */
  function section(id, title, icon, innerHtml, { defaultCollapsed = false } = {}) {
    const isCollapsed =
      collapsed[id] === undefined ? defaultCollapsed : !!collapsed[id];
    return `
      <section class="detail-section" data-section="${id}" data-collapsed="${isCollapsed}">
        <button class="detail-section-head" type="button" aria-expanded="${!isCollapsed}">
          <h2>${iconSvg(icon)}<span>${esc(title)}</span></h2>
          <span class="detail-chevron" aria-hidden="true"></span>
        </button>
        <div class="detail-section-body">${innerHtml}</div>
      </section>`;
  }

  /** Nulls are omitted, not zeroed — rows only exist when there is a value. */
  function vitalsHtml() {
    const rows = [];
    if (Number.isFinite(storm.windKt)) {
      /* ATTRIBUTED WHEN IT IS NOT THIS STORM'S OWN AGENCY SPEAKING.
       *
       * A GDACS storm has no wind of its own — GDACS publishes none — so any
       * number in this row came from JTWC's active warning (lib/jtwc-wind.js).
       * Naming the source is not decoration: the whole reason the row can be
       * shown at all is that it is a real measurement rather than the derived
       * class midpoint the cage falls back to, and a reader has no other way
       * to tell those apart. NHC storms get no suffix — the panel already says
       * whose storm it is. */
      const from = storm.windSource === 'jtwc' ? ' · JTWC' : '';
      rows.push([
        'Winds',
        `${formatWind(storm.windKt, sys())} (${Math.round(storm.windKt)} kt)${from}`,
      ]);
      /* ==> GUSTS, FROM WHICHEVER PRODUCT ACTUALLY STATES ONE. <==
       *
       * This used to read "Gusts only ever arrive with a JTWC fix; NHC's storm
       * list does not publish them", and it was half right in a way that read
       * as a settled fact. NHC's storm list really does carry no gust field at
       * any depth, and the PUBLIC advisory really does say only "with higher
       * gusts" — a phrase, not a number. But NHC's coded FORECAST advisory
       * states it outright, and nothing was reading that page. So a GDACS
       * typhoon showed a Gusts row and an American hurricane did not, and the
       * cause was a product nobody had asked for rather than data that does
       * not exist.
       *
       * `storm.gustKt` IS STILL THE JTWC FIX and is preferred when present:
       * it rides in on the same warning the wind above it came from, so the
       * two numbers are one agency's one observation. `gust.kt` is the NHC
       * read, and it only ever fills in where the fix is silent.
       *
       * OMITTED, NEVER ZEROED, when neither has one — same rule as every
       * other null on this panel. A dissipating storm's last advisory can drop
       * the clause, and "Gusts 0 mph" under a live hurricane would be a lie
       * dressed as precision. */
      const gustKt = Number.isFinite(storm.gustKt)
        ? storm.gustKt
        : (gustIsForCurrentStorm() ? gust.kt : null);
      if (Number.isFinite(gustKt)) {
        rows.push([
          'Gusts',
          `${formatWind(gustKt, sys())} (${Math.round(gustKt)} kt)`,
        ]);
      }
    } else {
      /* ==> NO MEASURED WIND, SO THE STORM'S OWN GEOMETRY SPEAKS. <==
       *
       * A GDACS storm JTWC has no warning on lands here with nothing to say
       * about its winds RIGHT NOW. But GDACS's current-timestep wind bands
       * are already in the geometry bundle, and which of them contain the
       * storm's own centre brackets the intensity — inside 60 km/h and
       * outside 90 is 32–49 kt at the core. Validated four-for-four against
       * NHC ground truth (spec-parameter §28.2). SHOWN AS A RANGE, NEVER A
       * NUMBER: the range is the whole honesty of the method, and its
       * provenance is stated in the row because a reader has no other way to
       * tell a derived bracket from an agency's measurement.
       *
       * Requires the bundle to be loaded and its windCurrent slot ok —
       * before that, the row simply isn't there, same as every other
       * geometry-fed row on this panel. No loading state for one <dd>. */
      const slot = geo.state === 'ok' ? geo.bundle?.layers?.windCurrent : null;
      const bracket =
        storm.source === 'gdacs' && slot?.status === 'ok'
          ? windBracketFromBands(slot.fc?.features, storm.lon, storm.lat)
          : null;
      if (bracket) {
        rows.push([
          'Winds',
          `${formatWindRange(bracket.minKt, bracket.maxKt, sys())} · estimated from wind field`,
        ]);
      }
      if (Number.isFinite(storm.peakWindKt)) {
        /* NAMED AS A FORECAST, because it is one. GDACS publishes no current
         * wind — only the maximum expected over the storm's life. Labelling
         * this "Winds" is what put a Cat 2 on a tropical storm. */
        rows.push([
          'Forecast peak',
          `${formatWind(storm.peakWindKt, sys())} (${Math.round(storm.peakWindKt)} kt)`,
        ]);
      }
    }
    if (Number.isFinite(storm.pressureMb)) rows.push(['Pressure', formatPressure(storm.pressureMb)]);

    /* ==> THE ARROW AND THE COMPASS POINT SAY THE SAME THING ON PURPOSE. <==
     * "NW at 12 mph" is what NHC quotes and has to stay, word for word, or a
     * reader checking the advisory finds two vocabularies for one fact. The
     * arrow is the glanceable copy of it, and a picture beside the words costs
     * nothing to a reader who is reading them. */
    const published = motionHeading(storm);
    if (published && !published.derived && Number.isFinite(storm.speedKt)) {
      rows.push([
        'Moving',
        `${formatBearing(storm.headingDeg)} at ${formatSpeed(storm.speedKt, sys())} (${Math.round(storm.speedKt)} kt)`,
        headingArrow(published.deg),
      ]);
    } else {
      /* ==> THE ONE ROW ON THIS PANEL THAT EXISTS BECAUSE THE AGENCY SAID
       * NOTHING. <== GDACS publishes no motion at all, so a GDACS storm JTWC
       * has no warning on has never had a Moving row — the panel this comment
       * block sits below already calls that case "desperately thin". The
       * forecast track it DOES publish answers the same question, and the row
       * says so out loud rather than passing a derivation off as a quote.
       *
       * NO SPEED HERE, DELIBERATELY. The bearing across the first few forecast
       * hours is a direction we can stand behind; dividing that chord by its
       * published hours would be a forward speed nobody stated, and this panel
       * would then carry an invented number beside a real one with nothing to
       * tell them apart. */
      const derived = motionHeading(storm, geo.state === 'ok' ? geo.bundle?.forecast : null);
      if (derived) {
        rows.push([
          'Track heading',
          `${formatBearing(derived.deg)} · from the forecast track`,
          headingArrow(derived.deg),
        ]);
      }
    }
    const pos = positionText(storm.lat, storm.lon);
    if (pos) rows.push(['Position', pos]);

    /* ==> GDACS'S AFFECTED-COUNTRY LIST, WHICH WAS PARSED AND THROWN AWAY.
     * <== This panel is thin for a GDACS storm and desperately thin for one
     * JTWC has no warning on — no wind, no gusts, no pressure, no motion, and
     * a classification with no Saffir-Simpson number behind it. This is real
     * published data the app already holds and has never once shown.
     *
     * THE STRUCTURED LIST, NOT THE DISPLAY STRING, AND THEY DISAGREE. Read off
     * the live feed 2026-08-10: DOLPHIN's `country` reads "Marshall Islands,
     * Japan, China" while `affectedcountries` carries only Japan and China. The
     * display string appears to accumulate over the storm's life; the array
     * looks current. Two lists that disagree is one list we cannot explain, so
     * this shows the one whose shape says what it is and leaves the other in
     * `raw` (data/gdacs.js already keeps both).
     *
     * AN EMPTY LIST IS OMITTED LIKE EVERY OTHER NULL ABOVE. FIFTEEN-26 is in
     * open ocean and GDACS names nobody, which is a true answer and not one
     * worth a row of its own on a panel this long.
     *
     * ==> `severityText` WAS THE OTHER CANDIDATE AND IT IS DELIBERATELY NOT
     * HERE. <== GDACS publishes it as "Hurricane/Typhoon > 74 mph (maximum wind
     * speed of 269 km/h)" — two unit systems in one sentence, on a screen that
     * converts everything into the reader's own. It also restates the forecast
     * peak two rows up and the classification in the panel's own subtitle. It
     * is GDACS's words, but it is not new information and it is worse-formed
     * than what we already print. */
    const countries = Array.isArray(storm.raw?.countries) ? storm.raw.countries : [];
    const named = countries.map((c) => c?.countryname).filter(Boolean);
    if (named.length) {
      rows.push([named.length === 1 ? 'Country' : 'Countries', named.join(', ')]);
    }

    /* ==> THE AGENCY WHOSE ANALYSIS THIS ACTUALLY IS. <== GDACS is an
     * aggregator, and its list names the originating office per storm
     * (`raw.agency` — JTWC for a Northwest Pacific typhoon, NOAA for the
     * storms it mirrors from NHC's basins). A panel that said only "GDACS"
     * credited the messenger for the forecast office's work. "via GDACS"
     * stays, because that IS the pipe the bytes came through and the status
     * strip talks about GDACS by name — a reader must be able to connect the
     * two. NHC storms carry no row: the panel's disclaimer already names NHC
     * and a row restating it would be furniture. Absent value, absent row,
     * like every null above (§5 wants stated absences only where a claim was
     * expected — nobody expects an aggregator to name its source). */
    if (storm.source === 'gdacs' && storm.raw?.agency) {
      rows.push(['Forecast by', `${storm.raw.agency} · via GDACS`]);
    }

    /* ==> AND NHC STORMS GET ONE TOO, BECAUSE "NHC" IS NOT ALWAYS THE ANSWER.
     * <==
     *
     * This row was skipped for NHC storms on the grounds that "the panel's
     * disclaimer already names NHC". IT DOES NOT. The footer says Landfall is
     * not an official source; the only place NHC gets named is inside the
     * Advisory section, which is collapsed by default and which most readers
     * never open. So the panel named the forecaster for a typhoon and left an
     * American hurricane unattributed — the reverse of what the reasoning
     * claimed.
     *
     * AND ON A CENTRAL PACIFIC STORM IT WAS ACTIVELY WRONG BY OMISSION.
     * Hurricane Lala (CP1, 2026-08-20) is forecast by CPHC in Honolulu, not by
     * Miami. The app already knows this — `functions/api/nhc/advisory.js`
     * builds `HFO…` rather than `MIA…` for a CP bin, a distinction that cost
     * the whole Central Pacific its advisory text once. Saying nothing here
     * let a reader assume Miami; this says which desk.
     *
     * THE BIN, NOT THE BASIN, for exactly that reason: the bin is what NHC
     * itself keys the product on, and it is the same field the relay routes
     * by. No `via` clause — unlike GDACS there is no aggregator in the middle,
     * and adding one would invent a hop. Absent bin, absent row, like every
     * null above. */
    if (storm.source === 'nhc') {
      const office = String(storm.raw?.binNumber || '').startsWith('CP')
        ? 'Central Pacific Hurricane Center'
        : 'National Hurricane Center';
      if (storm.raw?.binNumber) rows.push(['Forecast by', office]);
    }

    if (!rows.length) return '<div class="detail-empty">No current vitals.</div>';
    /* THE THIRD SLOT IS MARKUP AND THE SECOND IS TEXT, which is why only one
     * of them goes through `esc`. Every value in this list is a string we
     * built; the mark is an inline SVG that cannot be. Keeping them in
     * separate positions rather than letting a row hand over raw HTML is what
     * stops a storm name reaching this function one refactor from now and
     * being treated as markup. */
    return `<dl class="detail-vitals">${rows
      .map(([k, v, mark]) => `<dt>${k}</dt><dd>${mark || ''}${esc(v)}</dd>`)
      .join('')}</dl>`;
  }

  /**
   * The flood answer for this storm, or null when the section should not draw.
   *
   * ==> IT REFUSES ON A SILENCED OR ENDED STORM, LIKE EVERY OTHER SECTION.
   * <== `withheldNote` already replaces the whole Rainfall body in that case,
   * but this is asked from inside the controller too, and a block that measured
   * a dead storm's track against live warnings would be pairing today's hazard
   * with a forecast nobody is publishing any more.
   */
  function floodSummary(target) {
    const s = target || storm;
    if (!s || withheldNote()) return null;

    const slot = floodFacade.value();
    if (!slot || slot.state === 'loading') return { state: 'loading' };
    if (slot.state !== 'ok') return { state: 'unavailable' };

    /* ==> THE TRACK, PAST AND FORECAST, AS THE MAP HAS IT. <== §56.3, which
     * replaced the cone here on 2026-08-22. These are the same
     * FeatureCollections `map/layers/track-past.js` and its forecast sibling
     * draw, so the shapes the reader can see are the shapes being measured.
     *
     * BOTH HALVES, AND A STORM WITH ONLY ONE STILL GETS AN ANSWER. A newly
     * named system has no past track worth the name; an ended one has no
     * forecast. `lib/flood.js` returns `no_track` only when NEITHER carries a
     * line, which is the case where there is genuinely nothing to measure. */
    const layers = geo.state === 'ok' ? geo.bundle?.layers : null;
    return floodFacade.summarize(
      layers?.pastTrack?.fc || null,
      layers?.forecastTrack?.fc || null,
      slot.alerts,
      now(),
    );
  }

  function homeHtml() {
    const d = home.distanceTo(storm);
    if (!d) return null;
    let html = `
      <div class="detail-kicker">Distance</div>
      <div class="detail-figure">${formatDistance(d.nm, sys())} (${Math.round(d.nm).toLocaleString()} nm) ${esc(formatBearing(d.bearing))} of home</div>`;

    /* closestApproach reads storm.forecast — decorate a copy with the
     * geometry bundle's normalized points; the store's objects stay pure.
     *
     * THREE SENTENCES, FROM TWO ORTHOGONAL FLAGS. Each is checked against
     * what it actually claims, because the failure this block exists to
     * prevent is a true number under a false heading:
     *
     *   closing + near   → an approach. Give it a number and a time.
     *   receding         → the track never beats where it is now. Say that.
     *   closing + far    → it does get closer, so "never closer than current
     *                      position" would be measurably WRONG (NOUL-26 gains
     *                      230 nm of 7,315, over the pole). Claim only what
     *                      holds: it never comes near home. */
    /* NO CLOSEST APPROACH OFF A DEAD FORECAST. Noul's panel was reporting
     * "Nearest point 8,124 nm \u00b7 Moving away \u2014 never comes near home" from a
     * track computed before she made landfall. The distance above survives
     * because it is measured from the storm's own last position and is
     * qualified by the badge at the top; the approach figure does not,
     * because it is a claim about a future nobody is still publishing.
     *
     * The silenced bundle already empties `forecast`, so this branch would
     * fall through on its own — into the "No forecast track in this advisory"
     * arm, which is the wrong sentence for the right silence. Stated here
     * instead, so what the reader gets is the reason. */
    const silencedHome = withheldNote();
    if (silencedHome) {
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">${esc(silencedHome)}</div>`;
      return html;
    }

    /* ==> "FORECAST" IS PART OF THE HEADING, NOT A SPAN INSIDE IT. <== These
     * three labels used to read `Closest approach <span class="detail-soft">
     * forecast</span>`, which put BODY text inside a SUB-LABEL: the qualifier
     * rendered larger than the heading containing it and in a different color.
     * Aaron on glass 2026-08-20. One phrase, one treatment — and the word has
     * to stay, because an approach figure is a claim about a future and a
     * heading that hides that is the §5 problem in two words. */
    if (geo.state === 'ok' && geo.bundle?.forecast?.length) {
      const ca = home.closestApproach({ ...storm, forecast: geo.bundle.forecast });
      if (ca && ca.trend === 'closing' && ca.relevant) {
        const when = ca.time
          ? ` · ${esc(formatClockDay(ca.time))}${formatUntil(ca.time) ? ` (${esc(formatUntil(ca.time))})` : ''}`
          : '';
        html += `
          <div class="detail-kicker">Closest forecasted approach</div>
          <div class="detail-figure">${esc(formatDistance(ca.nm, sys()))} (${Math.round(ca.nm).toLocaleString()} nm)${when}</div>`;
      } else if (ca && ca.trend === 'receding') {
        html += `
          <div class="detail-kicker">Nearest forecasted point</div>
          <div class="detail-figure">${esc(formatDistance(ca.nm, sys()))} (${Math.round(ca.nm).toLocaleString()} nm)</div>
          <div class="detail-soft">Moving away, never closer than current position.</div>`;
      } else if (ca) {
        html += `
          <div class="detail-kicker">Nearest forecasted point</div>
          <div class="detail-figure">${esc(formatDistance(ca.nm, sys()))} (${Math.round(ca.nm).toLocaleString()} nm)</div>
          <div class="detail-soft">Moving away — never comes near home.</div>`;
      }
    } else if (
      (geo.state === 'loading' || geo.state === 'idle') &&
      storm.can?.forecastPoints
    ) {
      /* `idle` is the moment before the fetch is dispatched — it is pre-load,
       * not a third outcome, so it says the same thing. Naming it explicitly
       * is what keeps the chain below from having a silent fall-through. */
      html += `<div class="detail-kicker">Closest approach</div><div class="detail-soft">Loading forecast track${DOTS}</div>`;
    } else if (!storm.can?.forecastPoints) {
      /* UNSUPPORTED, not broken. Same three-way distinction the watch/warning
       * and wind-field blocks make (§4): a source that never publishes a
       * forecast track has not failed at anything. */
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">This source doesn’t publish a forecast track.</div>`;
    } else if (geo.state === 'error') {
      /* BROKEN, and it says so with a way out. Distance above is still true —
       * it comes from the storm's own position, not the geometry — so this
       * names only what is actually missing. */
      html += `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-geo-error detail-geo-block">
          The forecast track didn’t load, so there’s no approach figure.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    } else if (geo.state === 'ok') {
      /* Bundle arrived, no usable track in it — and the two reasons for that
       * are DIFFERENT FACTS, so they get different sentences. The slot's own
       * status is what knows: `unavailable` means that one layer's fetch died
       * while the rest of the bundle survived; anything else means the source
       * genuinely published no points this advisory. Printing "none
       * published" over a failed fetch would be the §5 lie in miniature. */
      const slot = geo.bundle?.layers?.forecastPoints;
      html +=
        slot?.status === 'unavailable'
          ? `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-geo-error detail-geo-block">
          The forecast track didn’t load, so there’s no approach figure.
          <button class="detail-retry" type="button">Retry</button>
        </div>`
          : `
        <div class="detail-kicker">Closest approach</div>
        <div class="detail-soft">No forecast track in this advisory.</div>`;
    }
    return html;
  }

  /**
   * The Watches and warnings section — WHO HAS OFFICIALLY WARNED WHOM about
   * this storm, whichever centre is tracking it.
   *
   * ==> ONE SECTION, TWO HALVES, AND THEY ARE MUTUALLY EXCLUSIVE BY SOURCE.
   * <== An NHC storm carries a basin and no country, so CAP has nothing to
   * join on (§50.3) and NHC's own watch/warning layer is the answer. A GDACS
   * storm has the reverse. Neither half ever needs to mention the other, which
   * is what let both pointer sentences be deleted when these merged.
   *
   * THE SILENCE GATE RUNS FIRST, FOR BOTH. It used to be applied twice, once
   * inside each of the two section bodies, which was the same rule written
   * down in two places and free to drift. This section's empty states are
   * "None in effect." and "No national weather agency ... has a tropical
   * cyclone alert in force" — both all-clears on live government orders. A
   * silenced or ended storm hands over an empty slot, so without this gate the
   * fix for a frozen feed would publish exactly the false all-clear §5 forbids.
   * Of every section on this panel, this is the one that must not guess.
   */
  function wwHtml() {
    const silenced = withheldNote();
    /* ==> NO POINTER ON A WITHHELD STORM. <== The whole section is replaced by
     * one sentence saying why nothing here can be trusted; a signpost to
     * another section under it would be furniture on a notice. */
    if (silenced) return `<div class="detail-soft">${esc(silenced)}</div>`;
    /* ==> THE POINTER IS APPENDED HERE AND NOT INSIDE EITHER HALF (§56.8).
     * <== This section has two bodies — NHC's own legend below and
     * `ui/cap-storm.js` for everything else — and a line written into one of
     * them would be missing from the other half of its own section. Wording
     * and reasoning: `ui/flood-words.js`. */
    return `${wwBody()}${FLOOD_POINTER}`;
  }

  /** Whichever half of `Watches and warnings` this storm's source calls for. */
  function wwBody() {
    /* THE GDACS HALF IS A WHOLE CONTROLLER, not a branch — `ui/cap-storm.js`
     * has its own fetch, its own retry and its own three empty states, and it
     * owns every word it prints (§50.6). Routed to, never reimplemented. */
    if (storm.source !== 'nhc') return capH.html(storm);

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.watchWarning : null;
    if (geo.state === 'loading') return `<div class="detail-soft">Checking${DOTS}</div>`;
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      /* The failure is named here because this IS the layer's surface; the
       * map simply lacks the stripe. Two strings by design (§16). */
      return '<div class="detail-soft">Watches and warnings unavailable.</div>';
    }
    if (!slot || slot.status === 'none') return '<div class="detail-soft">None in effect.</div>';
    const legend = wwLegend(slot.fc.features);
    if (!legend.length) return '<div class="detail-soft">None in effect.</div>';
    /* ==> A PRODUCT WITH NO OUTLINE IS SAID OUT LOUD HERE, BECAUSE THE MAP
     * CANNOT SAY IT. <== NHC can publish a watch as attributes with no shape
     * (lib/watchwarning.js carries the measurement). The order is real and
     * this list is right to name it; what would be wrong is letting the
     * unmarked coast beside it read as "no watch here". The map has no way to
     * draw an absence, so the sentence lives on the one surface that can. */
    const missing = legend.filter((e) => !e.drawn).length;
    /* ==> ONE SENTENCE, NOT A SENTENCE AND A TAG. <== The rows carried a
     * trailing "not on the map" as well, which said the same thing twice and
     * put a qualifier inside a list whose job is to name government orders
     * plainly. The note below is quieter than the labels for the same reason
     * the tag was: what is missing is our ability to DRAW the order, never the
     * order itself. */
    const note = missing
      ? `<div class="detail-ww-note">NHC published ${
          missing === 1 ? 'no outline for it' : 'no outlines for those'
        } with this advisory, so the coast is unmarked. The order still stands.</div>`
      : '';
    return `<ul class="detail-ww">${legend
      .map(
        (e) => `<li><span class="row-swatch" style="--swatch:${e.color}"></span>${esc(e.label)}</li>`
      )
      .join('')}</ul>${note}`;
  }

  /**
   * Wind field — the size readout, and the ONE place a GDACS storm is told
   * why it has no bands (§14 both-sources rule).
   *
   * This section exists mostly for that sentence. On the map, a GDACS storm
   * with the wind layer on simply shows nothing — and nothing is exactly what
   * a storm with no dangerous wind would show. Identical pixels, opposite
   * meanings, which is the §5 failure. The map cannot say "not available" in
   * empty ocean; this panel can, so it does.
   */
  function windHtml() {
    if (storm.source !== 'nhc' && storm.source !== 'gdacs') {
      return '<div class="detail-soft">Not available for this source.</div>';
    }
    /* Same trap as the watch/warning block: the empty state here reads "No
     * wind field published for this advisory", which would be a flat untruth
     * about an advisory that published one and has simply gone quiet since. */
    const silencedWind = withheldNote();
    if (silencedWind) return `<div class="detail-soft">${esc(silencedWind)}</div>`;

    if (geo.state === 'loading') return `<div class="detail-soft">Checking${DOTS}</div>`;

    const slot = geo.state === 'ok' ? geo.bundle?.layers?.windCurrent : null;
    if (geo.state === 'error' || slot?.status === 'unavailable') {
      return '<div class="detail-soft">Wind field unavailable.</div>';
    }
    if (!slot || slot.status === 'none') {
      return '<div class="detail-soft">No wind field published for this advisory.</div>';
    }

    /* Which thresholds this storm actually has. A weak system publishes only
     * a 34 kt band; listing the two it lacks would read as missing data. */
    const present = new Map();
    for (const f of slot.fc?.features || []) {
      const kt = windThresholdFromProps(f.properties);
      if (!kt) continue;
      /* GDACS bands are drawn in the same three severity colors as NHC's,
       * but they are NOT the same numbers: GDACS publishes round metric
       * thresholds (60/90/120 km/h ≈ 32/49/65 kt), confirmed live
       * 2026-07-24. `_gdacsKmh` carries what the source actually said, and
       * it is what gets shown — relabelling those bands "34 kt" would be
       * putting NHC's words in GDACS's mouth. Same colors, honest numbers. */
      if (!present.has(kt)) present.set(kt, f.properties?._gdacsKmh ?? null);
    }
    if (!present.size) return '<div class="detail-soft">No wind field published for this advisory.</div>';

    const rows = [...present.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([kt, kmh]) => {
        const label = kmh != null ? `${WIND_LABEL[kt]} (${Math.round(kmh)} km/h)` : WIND_LABEL[kt];
        return `<li><span class="row-swatch" style="--swatch:${windColor(kt)}"></span>${esc(label)}</li>`;
      })
      .join('');

    /* No source-limitation note for GDACS any more. The spec inherited a
     * claim that GDACS publishes ONE radius and therefore draws circles;
     * the live payload disproved it on glass (2026-07-24) — its bands are
     * quadrant-shaped, same as NHC's. Saying otherwise in the panel would
     * be an apology for a limitation that does not exist. */
    const note = '';

    return `<ul class="detail-ww">${rows}</ul>${note}`;
  }

  /** Which map layers this storm SHOULD have but doesn't, in human words.
   *  §16: storm in feed, geometry failed → the failure is named on the
   *  layer. The Layers panel proper is Phase 6; until then this section is
   *  the layer surface, so the naming lives here. */
  const LAYER_LABEL = {
    cone: 'cone', forecastTrack: 'forecast track', forecastPoints: 'forecast points',
    pastTrack: 'past track',
    windCurrent: 'wind field', windSwath: 'wind swath',
  };
  function failedLayerNames() {
    if (geo.state !== 'ok' || !geo.bundle?.layers) return [];
    return Object.entries(LAYER_LABEL)
      .filter(([k]) => geo.bundle.layers[k]?.status === 'unavailable')
      .map(([, label]) => label);
  }

  /** Did ANY slot come back with something to draw? `ok` is the only status
   *  that means features exist — `none` and `unavailable` are both empty, for
   *  different reasons. Mirrors data/cache.js's `bundleHasFeatures`, and is
   *  duplicated rather than imported because ui/ does not import data/ (§12). */
  function hasAnyFeatures() {
    const layers = geo.bundle?.layers;
    if (!layers) return false;
    return Object.values(layers).some((l) => l?.status === 'ok');
  }

  /**
   * THE MAP-GEOMETRY PROBLEM NOTICE.
   *
   * ==> THIS USED TO BE THE "LAYERS" SECTION AND IT NO LONGER IS. <==
   *
   * That section was a shortcut into the Layers view with a summary line of
   * what was drawn. It is gone (2026-07-25, Aaron's call): layers are reached
   * from the floating Layers button, one place, and a second door with its own
   * summary text was a second thing to keep in step for no navigation saved —
   * the button is on screen the whole time.
   *
   * WHAT COULD NOT GO WITH IT is the failure surface that had been living
   * inside it. When a storm's geometry fetch dies, this notice and its Retry
   * are the ONLY way to see that the cone and tracks are missing rather than
   * merely absent, and the only way to ask again (§5: never ship silence on
   * failure; every async surface gets an error state with a recovery action).
   * Deleting the section wholesale would have taken the recovery with it and
   * left a storm quietly drawing nothing.
   *
   * So it is now a BARE BLOCK PINNED ABOVE THE SECTIONS rather than a section
   * of its own — an error must not sit behind a collapsed header that the user
   * may have collapsed weeks ago. It renders to an empty string when there is
   * nothing wrong, which is most of the time.
   */
  function mapProblemHtml() {
    /* A SILENCED STORM HAS NO MAP PROBLEM. Its slots are empty because we
     * emptied them, and `hasAnyFeatures()` below can legitimately come up
     * false for a storm whose only geometry was forecast shapes. That path
     * renders "NHC hasn't published this advisory's cone and tracks yet" with
     * a Retry button \u2014 blaming the source for our own deliberate removal, and
     * inviting the reader to refetch something that would be discarded again
     * the moment it arrived. The stamp badge is already carrying this. */
    /* AN ENDED STORM HAS NO MAP PROBLEM EITHER, and it is the more important of
     * the two: its slots are empty because the storm is over, and this block
     * would offer a Retry button that refetches a flushed NHC bin forever. */
    if (isSilent(storm) || isEnded(storm)) return '';

    if (geo.state === 'error') {
      /* The detail line is our own short human-written message (never a
       * stack trace) — on a phone, this panel IS the console. */
      return `
        <div class="detail-geo-error detail-geo-block">
          Storm geometry unavailable — the map is missing this storm's cone and tracks.
          ${geo.error ? `<div class="detail-geo-detail">${esc(geo.error)}</div>` : ''}
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }
    const failed = failedLayerNames();
    if (failed.length) {
      return `
        <div class="detail-geo-error detail-geo-block">
          Unavailable on the map: ${esc(failed.join(', '))}.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }

    /* NOTHING FAILED AND THERE IS STILL NOTHING TO DRAW. Every slot came back
     * empty — no cone, no track, no wind field — and the fetch reported no
     * error at all. This used to render as SILENCE, and silence is what the
     * user saw when Fausto changed basins: a storm in the list, a dot on the
     * globe, and no explanation for the missing shapes (§5, never ship
     * silence on failure). It is a real state with a real cause — NOAA has
     * not published this advisory's geometry yet — so it says that, and it
     * offers the retry. */
    if (geo.state === 'ok' && geo.bundle?.layers && !hasAnyFeatures()) {
      return `
        <div class="detail-geo-error detail-geo-block">
          NHC hasn’t published this advisory’s cone and tracks yet — the map has
          this storm’s position but not its shapes.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }

    /* SHOWING GEOMETRY FROM AN EARLIER ADVISORY, on purpose. The cache kept
     * what it had because the newer fetch had nothing better (data/cache.js).
     * This is the GOOD outcome of the case above — the shapes are real, they
     * are just not the newest — so it reads as information, not as an error,
     * and the timestamp is already on the stamp line above. Retry is still
     * offered: the user may know NOAA has caught up. */
    if (geo.state === 'ok' && geo.held) {
      const gAdv = geo.bundle?.stamp?.advisnum;
      return `
        <div class="detail-geo-note detail-geo-block">
          Cone and tracks are from ${gAdv ? `advisory ${esc(gAdv)}` : 'an earlier advisory'} —
          NHC hasn’t published newer shapes yet.
          <button class="detail-retry" type="button">Retry</button>
        </div>`;
    }

    return '';
  }

  /* --- advisory text (§16 item 7) ------------------------------------------
   *
   * THE RAW PRODUCT, WHOLE. Aaron's call, 2026-07-25, over a parsed version
   * that would have dropped the header block as a duplicate of Vitals three
   * inches up the same panel. The argument that won: a parser that hides a
   * section is a parser that can hide the WRONG section, and during a
   * hurricane the cost of showing a reader four redundant lines is nothing
   * against the cost of silently swallowing one they needed. Teletype is ugly
   * and complete. Complete wins.
   *
   * It soft-wraps rather than scrolling sideways. The products are fixed at
   * 69 columns, which does not fit a phone, and a horizontal scrollbar inside
   * a vertically scrolling drawer is a gesture fight nobody wins. `pre-wrap`
   * keeps every newline and every space the forecaster wrote and only breaks
   * lines that are too long for the glass.
   * ---------------------------------------------------------------------- */

  const ADVISORY_SECTION = 'advisory';

  function advisoryOpen() {
    return collapsed[ADVISORY_SECTION] === undefined
      ? false
      : !collapsed[ADVISORY_SECTION];
  }

  /** Fetch on expand, once per storm per advisory.
   *
   *  TWO guards, and they catch different things. `advSeq` stops a slow
   *  response for storm A painting over storm B — a race. The forId/forKey
   *  check stops a record that was never refreshed being shown under the
   *  wrong storm at all — a staleness bug, which is what actually shipped.
   *  A sequence number alone would not have caught it: nothing raced. */
  async function ensureAdvisory({ retry = false } = {}) {
    if (!storm || ghost || !loadAdvisory) return;
    if (!retry && adv.phase !== 'idle' && advisoryIsForCurrentStorm()) return;

    const seq = ++advSeq;
    const forId = storm.id;
    const forKey = storm.advisoryKey;
    adv = { phase: 'loading', rec: null, forId, forKey };
    renderAdvisoryBody();
    let rec;
    try {
      rec = await loadAdvisory(storm, { retry });
    } catch (e) {
      /* The data layer promises never to throw. If it does anyway, that is
       * still an error the reader must see NAMED rather than a section stuck
       * on "Loading…" forever with the reason in a console they do not have. */
      rec = { state: 'unavailable', detail: e?.message || 'failed' };
    }
    if (seq !== advSeq) return;
    adv = { phase: 'done', rec, forId, forKey };
    renderAdvisoryBody();
  }

  /** Which agency's words these are, said plainly. A reader in the Philippines
   *  looking at a US Navy bulletin should know that is what they are reading. */
  function advisoryAttribution(rec) {
    const bits = [];
    if (rec.agency === 'nhc') {
      bits.push('National Hurricane Center');
      if (rec.advisoryNumber) bits.push(`advisory ${esc(rec.advisoryNumber)}`);
    } else if (rec.agency === 'jtwc') {
      bits.push('Joint Typhoon Warning Center');
      if (rec.designation) bits.push(esc(rec.designation));
      if (rec.advisoryNumber) bits.push(`warning ${esc(rec.advisoryNumber)}`);
    }
    if (rec.relayStale) bits.push('served from cache');
    return bits.join(' · ');
  }

  function advisoryHtml() {
    /* A record belonging to a DIFFERENT storm is not content, it is the bug.
     * Rendered as pre-fetch rather than as itself; renderBody dispatches the
     * real fetch on the same pass. This is the last line of defence — if
     * something ever forgets to reset the state again, the worst outcome is
     * a redundant fetch, not another storm's advisory on screen. */
    if (adv.phase === 'idle' || !advisoryIsForCurrentStorm()) {
      /* Only reachable when the section is open and the fetch has not been
       * dispatched yet — a frame, not a state a reader sits in. */
      return `<div class="detail-soft">Loading advisory${DOTS}</div>`;
    }
    if (adv.phase === 'loading') {
      return `<div class="detail-soft">Loading advisory${DOTS}</div>`;
    }

    const rec = adv.rec || { state: 'unavailable' };

    if (rec.state === 'ok') {
      const attribution = advisoryAttribution(rec);
      return `
        ${attribution ? `<div class="detail-advisory-from">${attribution}</div>` : ''}
        <pre class="detail-advisory" tabindex="0" role="region"
             aria-label="Advisory text">${esc(rec.text)}</pre>`;
    }

    if (rec.state === 'none_matched') {
      /* NOT a failure, and worded so it cannot be read as one. Naming the
       * agency matters: "no advisory" sounds like the storm is over. */
      return `<div class="detail-soft">The Joint Typhoon Warning Center has no
        current warning under this storm's name.</div>`;
    }

    if (rec.state === 'unsupported') {
      return `<div class="detail-soft">No agency publishes advisory text for
        this storm.</div>`;
    }

    return `
      <div class="detail-geo-error detail-geo-block">
        The advisory text didn’t load.
        ${rec.detail ? `<div class="detail-geo-detail">${esc(rec.detail)}</div>` : ''}
        <button class="detail-retry" data-retry="advisory" type="button">Retry</button>
      </div>`;
  }

  /* People in the path (§54) is a self-contained controller in
   * ui/people-in-path.js, for the reason Environment and Rainfall are: this
   * file is past §12's ceiling and the table entry says the next detail pass of
   * any size does the split first. §54 was that pass. Only the seams live here.
   *
   * The town list is injected rather than imported by the controller, so ui/
   * still never reaches into data/ (§12). */
  const peopleH = createPeopleInPath({ loadTowns, townsOrNull, populationState });

  /** The Environment section's body — the controller's HTML behind the same
   *  withheld-note gate every other section uses, so a silent or ended storm
   *  never gets a paragraph claiming a current environment. */
  function envHtml() {
    const silenced = withheldNote();
    if (silenced) return `<div class="detail-soft">${esc(silenced)}</div>`;
    return envH.html(storm);
  }

  /** The Rainfall section's body (§48.9) — the controller's HTML behind the
   *  same withheld-note gate every other section uses, so a silent or ended
   *  storm never gets a paragraph read as a current forecast. */
  function rainHtml() {
    const silenced = withheldNote();
    if (silenced) return `<div class="detail-soft">${esc(silenced)}</div>`;
    return rainH.html(storm);
  }

  /** The Flooding section's body (§56.7) — the controller's HTML behind the
   *  same withheld-note gate every other section uses, so a silenced or ended
   *  storm never gets alert rows read as a current match against a track
   *  nobody is publishing any more. */
  function floodHtml() {
    const silenced = withheldNote();
    if (silenced) return `<div class="detail-soft">${esc(silenced)}</div>`;
    return floodH.html(storm);
  }

  /** Repaint ONLY the Flooding section — same scroll-position reasoning as
   *  every other section repaint here. */
  function renderFloodBody() {
    const el = bodyEl?.querySelector(
      `.detail-section[data-section="${FLOOD_SECTION}"] .detail-section-body`
    );
    if (!el || !storm) return;
    el.innerHTML = floodHtml();
    floodH.wire(bodyEl, storm, renderFloodBody);
  }

  /** Repaint ONLY the Watches and warnings section when the CAP fetch lands —
   *  same scroll-position reasoning as every other section repaint here.
   *
   *  ==> IT TARGETS `ww` BECAUSE THAT IS WHERE THE ALERTS NOW LIVE. <== There
   *  is no `local-alerts` section any more, and a selector naming one would
   *  find nothing and fail silently: the fetch would land, this would return
   *  early, and the section would sit on "Checking national agencies…"
   *  forever. `tools/selector-contract-check.mjs` is the guard that every
   *  selector in the app still names something real. */
  function renderCapBody() {
    const el = bodyEl?.querySelector('.detail-section[data-section="ww"] .detail-section-body');
    if (!el || !storm) return;
    el.innerHTML = wwHtml();
    capH.wire(bodyEl, storm, renderCapBody);
    /* ==> ONE FETCH, TWO SECTIONS, SO ONE LANDING REPAINTS BOTH (§56.8). <==
     * The CAP list feeds `Watches and warnings` AND the storm-surge rows in
     * `Flooding`. Repainting only this one would leave the other sitting on
     * "Checking national agencies…" after the answer had already arrived —
     * nothing would throw and nothing on screen would say so. It also matters
     * for the language disclosures: `ui/cap-storm.js` registers their ids
     * during a render, and both halves have to be rendered from one landing
     * for both sets to exist. */
    renderFloodBody();
  }

  /** Repaint ONLY the Rainfall section — same scroll-position reasoning as the
   *  Environment, advisory and people repaints. */
  function renderRainBody() {
    const el = bodyEl?.querySelector(
      `.detail-section[data-section="${RAIN_SECTION}"] .detail-section-body`
    );
    if (!el || !storm) return;
    el.innerHTML = rainHtml();
    rainH.wire(bodyEl, storm, renderRainBody);
  }

  /** Repaint ONLY the Environment section — same scroll-position reasoning as
   *  the advisory and people repaints below. */
  function renderEnvBody() {
    const el = bodyEl?.querySelector(
      `.detail-section[data-section="${ENV_SECTION}"] .detail-section-body`
    );
    if (!el || !storm) return;
    el.innerHTML = envHtml();
    envH.wire(bodyEl, storm, renderEnvBody);
  }

  /** Repaint ONLY this section, for the same reason the advisory does: a full
   *  renderBody() throws away the reader's scroll position. */
  function renderPeopleBody() {
    const host2 = bodyEl?.querySelector(
      `.detail-section[data-section="${PEOPLE_SECTION}"] .detail-section-body`
    );
    if (!host2) return;
    host2.innerHTML = peopleH.html(storm, { ghost, withheld: withheldNote() });
    peopleH.wire(host2, storm, ghost, geo, renderPeopleBody);
  }

  /** Repaint ONLY the advisory section. A full renderBody() would rebuild
   *  every section, which throws away the scroll position the reader is
   *  holding halfway down a teletype product. */
  function renderAdvisoryBody() {
    const host2 = bodyEl?.querySelector(
      `.detail-section[data-section="${ADVISORY_SECTION}"] .detail-section-body`
    );
    if (!host2) return;
    host2.innerHTML = advisoryHtml();
    wireAdvisoryRetry(host2);
  }

  function wireAdvisoryRetry(scope) {
    for (const btn of scope.querySelectorAll('[data-retry="advisory"]')) {
      btn.addEventListener('click', () => ensureAdvisory({ retry: true }));
    }
  }

  /** Repaint ONLY the Vitals section, for the same reason `renderAdvisoryBody`
   *  exists: the gust lands after first paint, and a full `renderBody()` would
   *  throw away the reader's scroll position and collapse-state animations
   *  over one `<dd>`. */
  function renderVitalsBody() {
    const host2 = bodyEl?.querySelector(
      '.detail-section[data-section="vitals"] .detail-section-body'
    );
    if (!host2) return;
    host2.innerHTML = vitalsHtml();
  }

  /**
   * Fetch the gust once per storm per advisory, on panel open.
   *
   * ==> NOT GATED ON A SECTION EXPANDING, UNLIKE THE ADVISORY. <== Vitals is
   * always open, so there is no gate to hang this on; the panel opening IS the
   * gate, and it is a good one — a reader who never taps a storm never pays.
   *
   * SILENT ON FAILURE, AND THAT IS NOT A §5 VIOLATION. §5 forbids silence
   * where a claim was expected. Nothing on this panel promises a gust, the
   * Winds row above it is already correct and complete on its own, and there
   * is no action a reader could take with "we could not read NHC's coded
   * advisory". A Retry button for one row inside a section fed by a different
   * source would be noise pretending to be honesty.
   *
   * SKIPPED ENTIRELY WHEN THE FIX ALREADY HAS ONE. A GDACS storm with a JTWC
   * warning carries `gustKt` in the storm object, so asking NHC for a second
   * opinion would be a round trip to render a row that is already right.
   */
  async function ensureGust() {
    if (!storm || ghost || !loadGustKt) return;
    if (storm.source !== 'nhc' || Number.isFinite(storm.gustKt)) return;
    if (gustIsForCurrentStorm()) return;

    const seq = ++gustSeq;
    const forId = storm.id;
    const forKey = storm.advisoryKey;
    let kt = null;
    try {
      kt = await loadGustKt(storm);
    } catch {
      kt = null;
    }
    /* THE RACE GUARD AND THE STALENESS GUARD, both, exactly as `ensureAdvisory`
     * carries both — a sequence number alone would not stop a landed-but-never-
     * refreshed value being shown under the next storm. */
    if (seq !== gustSeq) return;
    gust = { kt, forId, forKey };
    if (!Number.isFinite(kt)) return; // nothing changed on screen
    if (gustIsForCurrentStorm()) renderVitalsBody();
  }

  function renderBody() {
    if (!bodyEl || !storm) return;
    if (ghost) {
      /* Reduced ghost form: no home block (distance to a storm that is not
       * there is meaningless) and no layer link. */
      bodyEl.innerHTML = `
        <div class="detail-ghost-note">This storm is no longer in ${sourceLabel(storm.source)}.
        Last known information is shown below.</div>
        ${section('vitals', 'Last known', 'gauge', vitalsHtml())}
        ${disclaimerHtml(storm.source)}`;
      wireSections();
      return;
    }
    const homeBlock = homeHtml();
    bodyEl.innerHTML = [
      /* Failures first and never collapsible — see mapProblemHtml. */
      mapProblemHtml(),
      /* "Last known" ONCE THE STORM HAS ENDED, the same relabel the ghost form
       * uses and for the same reason: every number under this header is a
       * measurement of a moment that has passed, and "Vitals" reads as present
       * tense. One word, and it stops the panel from asserting a current wind
       * for a storm nobody is measuring. */
      section('vitals', isEnded(storm) ? 'Last known' : 'Vitals', 'gauge', vitalsHtml()),
      /* `target`, NOT A HOUSE. This section is the distance to home and the
       * closest approach — the same two figures Home's own closest-pass
       * section carries, under the same crosshair. A house here would name the
       * place; both sections are about the RANGE to it. */
      homeBlock ? section('home', 'Home', 'target', homeBlock) : '',
      /* ==> ONE SECTION, BOTH SOURCES. <== This was TWO — "In effect" and
       * "Local agency alerts" — and exactly one of them ever held content,
       * because they are selected by source and the sources are exclusive. An
       * NHC storm got a legend and a sentence pointing down at nothing; a
       * GDACS storm got a sentence pointing up at nothing and a list. Two
       * headings, one of which was always a redirect. Aaron's call on glass,
       * 2026-08-20: it reads as the app apologising for its own filing system.
       *
       * ==> AND BOTH POINTERS DELETED THEMSELVES. <== That is the whole win.
       * The redirects existed only because there was somewhere else to be; one
       * section has nowhere to point, so a Philippine typhoon no longer has to
       * mention the National Hurricane Center to explain itself.
       *
       * THE ID STAYS `ww`. It is the persisted collapse key
       * (lib/section-state.js) — renaming it would silently reopen a section
       * every existing reader had closed, to buy a tidier string nobody sees.
       *
       * "WATCHES AND WARNINGS" AND NOT "IN EFFECT", AND THE REASON IS §5. The
       * old heading is NHC's phrase and it asserts CURRENCY. The CAP half
       * deliberately carries cancellations — §50.1 measured two rows out of
       * five announcing weather ENDING, and "the wave has passed" is worth
       * reading — so a cancellation under a heading reading IN EFFECT is the
       * heading contradicting the row beneath it. The new one is true of both
       * halves without claiming anything about any single row. */
      section('ww', 'Watches and warnings', 'alert', wwHtml()),
      /* Home's "How strong" glyph. Same idea, same shape, both drawers. */
      section('wind', 'Wind field', 'wind', windHtml()),
      section(RAIN_SECTION, 'Rainfall', 'rain', rainHtml()),
      /* ==> DIRECTLY UNDER RAINFALL, AND THE ORDER IS FIXED ON BOTH SCREENS
       * (§56.7). <== Rain is our arithmetic on a forecast; Flooding is
       * somebody else's statement about water already on the ground, with an
       * expiry on it. They are adjacent because a reader deciding whether to
       * move a car wants both, and Rain is first because it answers for every
       * storm on Earth while Flooding fills from whichever of its two sources
       * covers this one.
       *
       * ==> AND IT IS THE KEYBOARD PATH TO AN ALERT (§10, §56.6). <== Phase 5
       * puts these alerts on the globe. An icon reachable only by tapping a
       * sphere does not exist for a keyboard user, which is why this section
       * lands BEFORE the map work rather than after it. */
      section(FLOOD_SECTION, 'Flooding', 'flood', floodHtml()),
      section(ENV_SECTION, 'Environment', 'thermo', envHtml()),
      section(PEOPLE_SECTION, peopleH.title(), 'people', peopleH.html(storm, { ghost, withheld: withheldNote() })),
      section(ADVISORY_SECTION, 'Advisory', 'doc', advisoryHtml(), { defaultCollapsed: true }),
      /* Last, always. Everything above is what the sources say; this is who
       * is saying it. */
      disclaimerHtml(storm.source),
    ].join('');
    wireSections();
    wireAdvisoryRetry(bodyEl);
    peopleH.wire(bodyEl, storm, ghost, geo, renderPeopleBody);
    peopleH.ensure(storm, ghost, geo, renderPeopleBody);
    if (!withheldNote()) {
      envH.ensure(storm, renderEnvBody);
      envH.wire(bodyEl, storm, renderEnvBody);
      rainH.ensure(storm, renderRainBody);
      rainH.wire(bodyEl, storm, renderRainBody);
      capH.ensure(storm, renderCapBody);
      capH.wire(bodyEl, storm, renderCapBody);
      floodH.ensure(storm, renderFloodBody);
      floodH.wire(bodyEl, storm, renderFloodBody);
    }
    /* A reader who left this section open last time gets it open — and open
     * means fetched. Without this the persisted preference renders an
     * expanded section that sits on "Loading advisory…" forever, because
     * nothing ever dispatched the fetch. */
    if (advisoryOpen()) ensureAdvisory();

    /* Unconditional, because Vitals has no collapse gate to wait on. `ensureGust`
     * is the thing that decides whether there is anything to fetch. */
    ensureGust();

    /* ALL of them, by class. There is more than one Retry on this panel now
     * — the Home block grew its own when the forecast track fails — and
     * querySelector by id bound only whichever came first in the document,
     * silently leaving the other dead.
     *
     * EXCEPT ANY THAT NAMES ITS OWN SECTION. `data-retry` means a section has
     * already bound this button to its own recovery; without the exclusion it
     * collects BOTH handlers, and one tap also refetches the map geometry —
     * a different source, a different failure, and a payload the reader did
     * not ask for. Retry means retry THIS, always.
     *
     * ==> IT USED TO EXCLUDE `data-retry="advisory"` BY NAME, AND THAT WAS
     * ALREADY WRONG BY TWO. <== `people` and `environment` had both grown
     * their own scoped buttons since, and both were quietly firing a geometry
     * refetch alongside their own. Excluding the ATTRIBUTE rather than one of
     * its values is what makes the next scoped section correct on the day it
     * lands instead of on the day somebody notices. */
    for (const btn of bodyEl.querySelectorAll('.detail-retry:not([data-retry])')) {
      btn.addEventListener('click', () => {
        if (storm) onRetryGeometry(storm);
      });
    }
  }

  function wireSections() {
    if (!bodyEl) return;
    for (const head of bodyEl.querySelectorAll('.detail-section-head')) {
      head.addEventListener('click', () => {
        const sec = head.closest('.detail-section');
        const id = sec.dataset.section;
        const next = sec.dataset.collapsed !== 'true';
        sec.dataset.collapsed = String(next);
        head.setAttribute('aria-expanded', String(!next));
        collapsed[id] = next;
        writeSections(collapsed);
        /* Expanding the advisory is what pays for it. Collapsing it does
         * nothing — the record stays cached, so re-opening is instant. */
        if (id === ADVISORY_SECTION && !next) ensureAdvisory();
      });
    }
  }

  /* ==> ONE FULL RENDER PER TURN, NOT ONE PER CALLER. <==
   *
   * Opening this panel calls `renderAll` twice in the same task: once from
   * `onEnter` when the drawer pushes the view, and again a few lines later
   * from `setGeometry({state:'loading'})` when main.js starts the geometry
   * fetch. Both rebuild the entire body — every section, every vitals row,
   * every formatted figure — and the first result is thrown away without ever
   * reaching the screen, because nothing paints between them.
   *
   * The renders are COALESCED onto a microtask rather than deferred to a
   * frame. Deferring would not help the number this is here to fix: INP runs
   * until the next paint, so work moved into a rAF callback is still counted.
   * What helps is doing it once. The microtask still runs before paint, so
   * the panel is complete in the same frame it always was — nothing on screen
   * arrives later than before.
   *
   * `storm` is re-checked inside the callback: `onLeave` or a new selection
   * can land between the schedule and the run.
   */
  let renderQueued = false;

  function renderAll() {
    if (!storm || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      if (!storm) return;
      stepper?.render();
      renderStamp();
      renderBody();
      /* The header carries the identity, so a category change has to reach the
       * drawer's chrome — not just this view's body. */
      requestChrome?.();
    });
  }

  /* --- the drawer view contract -------------------------------------------- */

  return {
    id: 'detail',
    title: 'Storm',

    /** The drawer titles this view from its argument, so the storm's name is
     *  the header rather than the word "Detail".
     *
     *  IT ASSIGNS `storm`, AND THE DRAWER CALLS IT BEFORE onEnter — that
     *  ordering is what broke the advisory (see the note on `adv` above).
     *  The assignment stays, because the header has to be able to title
     *  itself from its own argument. What changed is that nothing downstream
     *  now infers "the storm changed" by comparing against `storm`. */
    titleFor: (s) => {
      if (s && s !== storm) storm = s;
      return titleNode();
    },

    /**
     * ==> THE NAME FOR A BACK BUTTON POINTING AT THIS PANEL. <== `titleFor`
     * returns a NODE, and there is no string in a node to put on a button, so
     * the drawer fell through to the plain title and rendered `‹ Storm`. That
     * was invisible while nothing could sit on top of this view. Layers and
     * Settings push onto it now, and the promise of that side trip is that the
     * storm survives it — which `‹ Storm` does not say. `‹ Hurricane Erin`
     * does.
     *
     * ==> IT READS THE ARGUMENT, NOT `storm`. <== The drawer asks the PREVIOUS
     * entry for its label while a different view is on screen, and `storm` is
     * this closure's idea of what it is currently showing. Those are the same
     * value today and would silently stop being the same the first time
     * anything re-enters this view without going through the header. The
     * argument is the stack's own record of what this step was for.
     *
     * No side effects, unlike `titleFor` — labelling a button must not reach
     * into a view's state.
     */
    backLabelFor: (s) => (s || storm)?.name || null,

    mount(el) {
      buildSkeleton(el);
      renderAll();
    },

    /** Entered with a storm — a fresh selection, or a return from Layers. */
    onEnter(s) {
      visible = true;
      /* AGAINST `enteredId`, NOT AGAINST `storm`. titleFor has already
       * assigned `storm` by the time this runs, so the old comparison was
       * dead code that looked like a guard — geo and ghost were being
       * carried across storms too, and only escaped notice because main.js
       * sets the geometry state explicitly on every selection. */
      if (s && s.id !== enteredId) {
        storm = s;
        enteredId = s.id;
        ghost = false;
        geo = { state: 'loading' };
        /* A different storm's words are not this storm's words. Dropped, and
         * the sequence bumped so a request still in flight for the previous
         * storm cannot land here. */
        adv = { phase: 'idle', rec: null, forId: null, forKey: null };
        advSeq++;
        /* The same drop for the same reason — another storm's gust under this
         * storm's name is a plausible-looking wrong number, which is the worst
         * kind. `renderBody` re-dispatches. */
        gust = { kt: null, forId: null, forKey: null };
        gustSeq++;
      } else if (s) {
        storm = s;
      }
      /* SYNCHRONOUSLY, AHEAD OF THE COALESCED RENDER. `renderAll` runs on a
       * microtask, but the drawer calls `focus()` on the very next line after
       * this returns — so the count and the two aria-labels have to be true
       * NOW, or a keyboard user is handed a button announcing the storm they
       * just left. It is three text writes; the coalescing this sidesteps
       * exists to protect the body rebuild, not this. */
      stepper?.render();
      renderAll();
    },

    onLeave() {
      visible = false;
    },

    focus() {
      /* ==> STEPPING WITH THE KEYBOARD HAS TO LEAVE YOU ON THE CHEVRON. <==
       * Pressing next re-enters this view, and `enter()` moves focus straight
       * afterwards. Without this, every press dumped focus on the drawer's
       * Back button — so walking a list of seven storms by keyboard meant
       * seven trips through the tab order, and the wrong press would throw the
       * reader out of the panel entirely. `takeFocus` is one-shot, so arriving
       * any other way still starts at Back, which is right for those. */
      return stepper?.takeFocus() || null;
    },

    /** The drawer hands this in at mount so the view can ask for a header
     *  re-render when its title data changes. */
    setChromeRefresh(fn) {
      requestChrome = fn;
    },

    /* --- driven by main.js ------------------------------------------------ */

    /** Poll tick / home change: refresh in place. If the selected storm has
     *  left a CLEAN feed it becomes the ghost form here — never a blank, no
     *  forced navigation (§16). A source ERROR holds the view as stale
     *  instead; the stamp bands already say so. */
    update(state) {
      if (!storm) return;
      const live = state?.storms?.find((s) => s.id === storm.id);
      if (live) {
        /* A NEW ADVISORY MAKES THE TEXT ON SCREEN WRONG, and nothing else on
         * this panel would say so — the vitals and the stamp above it repaint
         * from the new object while the product underneath keeps the old
         * forecaster's words under the new number.
         *
         * The forKey binding would catch this on its own now. The explicit
         * bump stays because it also cancels an in-flight request for the
         * superseded advisory, which the binding cannot do. */
        if (live.advisoryKey !== storm.advisoryKey) {
          adv = { phase: 'idle', rec: null, forId: null, forKey: null };
          advSeq++;
          /* A NEW ADVISORY MEANS A NEW GUST. The forKey binding already stops
           * the old one rendering; the bump cancels a read still in flight for
           * the advisory that has just been superseded. */
          gust = { kt: null, forId: null, forKey: null };
          gustSeq++;
        }
        storm = live;
        ghost = false;
      } else if (state && storm.source && state.sources?.[storm.source]?.status === 'ok') {
        ghost = true;
      }
      if (visible) renderAll();
    },

    /** Geometry fetch lifecycle from main.js:
     *  {state:'loading'} | {state:'ok', bundle, lagged, held} | {state:'error', error}
     *
     *  `lagged` and `held` are DIFFERENT FACTS and both are needed. `lagged`
     *  means the geometry trails the feed by more than one advisory cadence —
     *  routine, expected, and normally silent. `held` means we asked for this
     *  advisory's geometry, the source had nothing, and the cache kept what it
     *  already had (data/cache.js). A basin change produces `held` without
     *  necessarily producing `lagged`, which is precisely why one flag could
     *  not cover both. */
    setGeometry(next) {
      geo = next;
      /* The headcount is DERIVED FROM the geometry, so new geometry always
       * invalidates it — including the loading→ok transition, which is the
       * common case and the one where a stale "Counting…" would otherwise
       * stick forever. Reset before renderAll so the rebuilt section starts
       * from idle and the controller's ensure() actually re-runs rather than
       * early-out on a matching forId. */
      peopleH.reset();
      if (visible && storm) renderAll();
    },

    /** Layer state changed elsewhere. The Layers shortcut this used to keep in
     *  step is gone (2026-07-25), but the WIND FIELD section still describes
     *  whichever half of that pair is drawn, so the body is still stale after
     *  a layer change and still has to be rebuilt. */
    layersChanged() {
      if (visible && storm) renderBody();
    },

    /** Units changed in Settings. Every figure on this panel is formatted
     *  through the injected resolver, so the whole body is stale. */
    unitsChanged() {
      if (visible && storm) renderBody();
    },

    isVisible: () => visible,
    current: () => storm,
  };
}
