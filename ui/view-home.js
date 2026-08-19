/**
 * view-home.js — the home dashboard (SPEC-UI §8).
 *
 * ==> HOME USED TO BE A SETUP SCREEN. IT IS A PLACE NOW. <==
 *
 * Opening the home FAB used to land on search / locate / drop-a-pin, and the
 * only thing the app ever SAID about home — distance, closest approach — was
 * buried in the storm detail panel behind a storm selection. So the one screen
 * named after the reader told them nothing about themselves. That setup flow
 * still exists, in ui/view-home-setup.js, reached from "Edit home" in the
 * corner and shown outright only when there is no home yet.
 *
 * THIS VIEW ANSWERS ONE QUESTION: is this storm going to affect me, how badly,
 * and when? One storm — the one bearing down, picked by closing-then-nearest
 * (data/home-dashboard.js) — never a list. The storm list is the map of the
 * world's weather; this is about a house.
 *
 * ==> IT COMPUTES NOTHING. <== Every figure arrives from buildHomeDashboard().
 * That is not tidiness: the moment a view works out "peak minus arrival"
 * inline, the threshold deciding whether to say "weakening" stops being a
 * constant anyone can find and the sentence stops being testable.
 * tools/test-home.mjs drives all of it with no browser.
 *
 * FIVE RENDER PATHS, AND §5 SAYS THEY MUST READ DIFFERENTLY:
 *   no home          — the invitation, and the setup flow inline
 *   a threat storm   — the dashboard
 *   nothing near     — a calm all-clear, with the nearest storm as a way out
 *   sources down     — explicitly NOT an all-clear, with the last good answer
 *   still loading    — loading, never an empty dashboard that looks quiet
 *
 * THE FOURTH ONE IS THE WHOLE POINT. Showing "all clear at home" while NHC is
 * unreachable is a safety-adjacent bug, and it is the easiest one in the app
 * to write by accident.
 *
 * Imports: config/, lib/, data/ and its own chart. Never map/ — main.js wires
 * the camera in through callbacks (§12).
 */

import { HOME_DASH } from '../config/constants.js';
import { formatDistance, formatWind, formatPressure, formatBearing, formatSpeed } from '../lib/units.js';
import { formatAge, formatUntil, formatClockDay, formatTimeDay } from '../lib/time.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { isEnded, stormSwatch } from '../lib/lifecycle.js';
import { motionHeading } from '../lib/heading.js';
import { headingArrow } from './heading-arrow.js';
import { createStormStepper } from './storm-stepper.js';
import { BASIN_LABEL } from '../lib/basin.js';
import { getHome } from '../data/home.js';
import { placeText } from '../lib/place-label.js';
import { pickThreatStorm, buildHomeDashboard, APPROACH } from '../data/home-dashboard.js';
import { homeChart } from './chart-home.js';
import { dotted } from './loading-dots.js';
import { createRainHome } from './rain-home.js';
import { createSurgeHome } from './surge-home.js';
import { WIND_LABEL, windColor, windDurationClause, windDurationPhrase } from '../lib/wind.js';
import { countdownHtml, headingOf, motionDetail } from './countdown-home.js';

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * @param {object}   o
 * @param {() => string} o.units           current unit system
 * @param {() => void}   o.onEditHome      push the setup view
 * @param {(storm) => void} o.onOpenStorm  select a storm (camera + detail)
 * @param {(storm) => void} [o.onFocusStorm]  point the camera and the globe at
 *        a storm WITHOUT leaving this drawer. What the chevrons call.
 * @param {(storm) => Promise} o.warmGeometry  cache-first geometry, no camera
 * @param {({storm}) => void} [o.onFrameHome]  called once per OPEN with the
 *        storm this drawer is about, so the camera can frame it together with
 *        the house. NOT called by the chevrons — stepping is a deliberate
 *        "show me that one" and already flies via `onFocusStorm`.
 * @param {() => number} [o.now]  the clock, injectable.
 *
 * ==> THE CLOCK IS A PARAMETER AND THAT IS NOT CEREMONY. <== Every sentence on
 * this screen is relative to now — "in 25 hours", "comes inside 100 miles at
 * 6 AM", whether the closest pass is still ahead at all. A view that reads
 * `Date.now()` directly can only be tested against a storm that is happening
 * right now, which means it can only be tested during a hurricane. The one
 * complete advisory this project has is from July; without this seam, none of
 * the render paths below could be driven at all.
 */
export function createHomeDashboardView({
  units, onEditHome, onOpenStorm, onFocusStorm, onFrameHome,
  warmGeometry, rain, surge, now = () => Date.now(),
}) {
  /* Rain (§48.8) is a self-contained controller in ui/rain-home.js — this file
   * is the largest in the app and over §12's ceiling, so it gets one seam and
   * nothing else: a section string, an ensure, a wire. */
  const rainH = createRainHome({ ...rain, units, now });
  /* Surge (§51.3) gets the same one seam for the same reason. It is passed the
   * STORM as well as the house, which Rain is not: rainfall is about a point
   * on the ground and is the same answer whichever storm is on screen, while a
   * surge simulation belongs to one storm's bulletins. */
  const surgeH = createSurgeHome({ ...surge, units });
  let host = null;
  let visible = false;
  let lastState = null;

  /** Geometry for the storm currently on screen, and the storm it belongs to.
   *  Held together deliberately: two fields that can disagree is how a
   *  dashboard ends up showing one storm's name over another's track. */
  let geo = { stormId: null, state: 'idle', bundle: null, error: null };

  /** Stale-response guard. A warm for storm A must never paint over storm B
   *  after the poll moved the threat pick — the same rule the geometry
   *  pipeline enforces with its own sequence. */
  let seq = 0;

  /**
   * Which storm the reader has chosen to look at, or null for "whatever the
   * ranking picks".
   *
   * ==> A MANUAL PICK OUTRANKS THE POLL, AND THAT IS THE WHOLE POINT. <== This
   * drawer re-picks its storm on every poll. Without somewhere to record a
   * choice, tapping a second storm to see it against your house would last
   * until the next refresh and then silently jump back — which reads as the
   * app fighting you rather than as a control.
   *
   * IT IS AN ID, NOT A STORM OBJECT. The store replaces its storms wholesale
   * on every poll, so holding the object would pin a stale copy whose figures
   * quietly stopped updating. Holding the id re-resolves against the current
   * list each render, and falls back to the ranking on its own when that storm
   * leaves the feed or ends.
   */
  let pickedId = null;

  /** The dashboard figures behind the storm currently on screen, or null.
   *  Held ONLY so the header's chip can be built outside `render()` — the
   *  drawer asks for a title before it enters the view, which is before any
   *  render has run. Everything else on this screen reads its dash from the
   *  render that built it. */
  let lastDash = null;

  /** The drawer's header re-render, handed in at mount. The title is a STORM
   *  now, and a poll can change which storm or what its chip says, so the
   *  header goes stale on exactly the ticks the body does. */
  let requestChrome = null;

  const sys = () => units();

  /* ---------------------------------------------------------------------- */

  /**
   * THE STEPPER (SPEC-UI §16.5), the same component the storm detail panel
   * pins. This file owns only what a press MEANS here: re-aim the dashboard,
   * then move the camera — and deliberately NOT open the storm's own detail
   * panel, which is what the name in the header does. Two controls, two
   * destinations: "show me this one against my house" and "tell me about this
   * one" are different questions.
   */
  /**
   * ==> BUILT AT MOUNT, NOT AT CONSTRUCTION. <== It creates a DOM node, and
   * this view is constructed in `app/views.js` alongside four others long
   * before any of them is opened — and constructed with no DOM at all by the
   * two headless suites that drive its render paths (tools/test-home.mjs,
   * tools/test-home-ida.mjs). Building it eagerly threw `document is not
   * defined` and took both suites out. Lazy is also the drawer's own rule: a
   * view nobody opens costs nothing but its registration.
   */
  let stepper = null;

  const buildStepper = () => createStormStepper({
    siblings: () => currentThreat()?.ranked || [],
    current: () => currentThreat()?.storm || null,
    onStep: (storm) => {
      pickedId = storm.id;
      /* ==> RENDER FIRST, FLY SECOND, AND THAT ORDER IS LOAD-BEARING. <== The
       * flight's offset is measured from the drawer's real height so the storm
       * lands in the visible strip above the sheet rather than behind it — and
       * this drawer's height changes with its content, because the far layout
       * drops the chart and the countdown. Fly first and the camera is aimed
       * using the height of the layout you just left. */
      render();
      onFocusStorm?.(storm);
    },
  });

  function mount(hostEl) {
    host = hostEl;
    /* ==> THE STEPPER PINS; THE DASHBOARD SCROLLS UNDER IT. <== It used to sit
     * at the top of the scrolling body, which meant the control that walks the
     * storms disappeared the moment you read past the first section — and it
     * put this drawer's stepper somewhere the detail panel's is not. One
     * control has to be in one place on both surfaces or the thumb learns
     * nothing. `.home-dash` IS `.drawer-body`, one element, which is what
     * tools/drawer-scroll-check.mjs asserts; the stepper is its sibling, so
     * `render()` rewriting the body cannot clobber it. */
    host.innerHTML = '<div class="drawer-body home-dash"></div>';
    stepper = buildStepper();
    host.prepend(stepper.el);
    host.addEventListener('click', onClick);
    render();
  }

  /**
   * ==> `open-storm` IS DELEGATED HERE **AND** BOUND DIRECTLY ON THE HEADER
   * TITLE. <== The identity block lives in the DRAWER'S header, which is
   * outside this view's host, so a listener on the host cannot see it. The
   * quiet path's "show me the nearest storm" link is inside the body and is
   * still delegated. One action, two places it can be fired from, one handler.
   */
  function openStormById(id) {
    const s = lastState?.storms?.find((x) => x.id === id);
    if (s) onOpenStorm?.(s);
  }

  function onClick(e) {
    const act = e.target.closest?.('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'edit-home') onEditHome?.();
    if (act.dataset.act === 'open-storm') openStormById(act.dataset.stormId);
  }

  const body = () => host?.querySelector('.home-dash');

  /* --- the threat pick, and warming its geometry -------------------------- */

  /**
   * Which storm this screen is about, and every storm it could be about.
   *
   * ==> THE MANUAL PICK IS RESOLVED HERE, NOT STORED HERE. <== `pickedId` is
   * the reader's choice; this decides whether that choice is still available.
   * A picked storm that has left the feed, or that has ended since it was
   * picked, silently falls back to the ranking rather than leaving the drawer
   * on a storm that no longer exists — and the id is cleared so the fallback
   * is permanent rather than re-checked on every render.
   */
  function currentThreat() {
    const home = getHome();
    if (!home || !lastState) return null;
    const pick = pickThreatStorm(lastState.storms, home);
    if (!pick) return null;

    if (pickedId) {
      const chosen = pick.ranked.find((s) => s.id === pickedId);
      if (chosen) {
        return { ...pick, storm: chosen, why: 'chosen' };
      }
      pickedId = null;
    }
    return pick;
  }

  /** Ask for the threat storm's forecast without selecting it. Re-entrant and
   *  guarded: only the newest request may write `geo`. */
  function warm(storm) {
    if (!storm || !warmGeometry) return;
    if (geo.stormId === storm.id && (geo.state === 'ok' || geo.state === 'loading')) return;

    const mine = ++seq;
    geo = { stormId: storm.id, state: 'loading', bundle: null, error: null };
    render();

    warmGeometry(storm).then((r) => {
      if (mine !== seq) return; // the pick moved on while we waited
      geo = {
        stormId: storm.id,
        state: r.state,
        bundle: r.bundle,
        error: r.error,
      };
      render();
    });
  }

  /* --- render ------------------------------------------------------------- */

  function render() {
    const el = body();
    if (!el) return;

    const home = getHome();
    if (!home) {
      lastDash = null;
      el.innerHTML = noHomeHtml();
      return void afterRender();
    }
    if (!lastState) {
      lastDash = null;
      el.innerHTML = loadingHtml('Checking the oceans…');
      return void afterRender();
    }

    const threat = currentThreat();

    if (!threat) {
      lastDash = null;
      el.innerHTML = quietHtml(lastState, home);
      return void afterRender();
    }

    if (geo.stormId !== threat.storm.id) warm(threat.storm);

    const ready = geo.stormId === threat.storm.id && geo.state === 'ok';
    const forecast = ready ? geo.bundle?.forecast || [] : [];
    /* The published quadrant radii, straight off the bundle. They ride
     * alongside the drawn swath rather than being recovered from it — see
     * normalizeForecastRadii in data/nhc-mapserver.js. */
    const radii = ready ? geo.bundle?.forecastRadii || [] : [];
    /* The storm's OBSERVED track (§49.3). Both sources put it on the bundle
     * under one name and in one shape, and an ended storm's rebuilt skeleton
     * carries it too — so this line needs no source test and no ended test. */
    const past = ready ? geo.bundle?.past || [] : [];
    /* The PAST wind field, keyed on the hour it was analysed at (§49.9). NHC
     * only; `data/gdacs-geometry.js` publishes none and the sentence says so
     * rather than falling silent. */
    const pastRadii = ready ? geo.bundle?.pastRadii || [] : [];

    const dash = buildHomeDashboard({
      storm: threat.storm,
      forecast,
      past,
      radii,
      pastRadii,
      home,
      now: now(),
      /* ==> THE VIEW IS THE ONLY THING THAT KNOWS. <== `forecast` above is []
       * whether the fetch is running, failed, or came back empty, so without
       * this the dashboard cannot tell a live download from a finished one and
       * every one of them came out as "Checking…". `idle` is pre-dispatch —
       * a frame, not a state anybody sits in — so it reads as loading. */
      trackState:
        geo.stormId !== threat.storm.id ? 'loading'
        : geo.state === 'error' ? 'error'
        : geo.state === 'ok' ? 'ok'
        : 'loading',
    });

    lastDash = dash;
    el.innerHTML = dashboardHtml(dash, threat, home);
    /* ==> THE SECTION IS ITS OWN GATE (§48.8). <== Rain is fetched here, on the
     * dashboard path, and nowhere else: the quiet, loading, error and no-home
     * states do not draw the section, so asking for a forecast on any of them
     * would be a request for something nobody can see. */
    rainH.ensure(home, renderRainBody);
    rainH.wire(el, home, renderRainBody);
    surgeH.ensure(threat?.storm, home, renderSurgeBody);
    surgeH.wire(el, threat?.storm, home, renderSurgeBody);
    afterRender();
  }

  /**
   * The two things that live OUTSIDE the scrolling body and therefore outside
   * every `el.innerHTML = ...` above: the pinned stepper and the drawer's
   * header.
   *
   * ==> EVERY RETURN PATH IN `render()` HAS TO REACH THIS. <== There are five,
   * and four of them are the quiet, loading, error and no-home states — the
   * states where there is no storm and the stepper must therefore hide itself
   * and the header must fall back to the word Home. A version that only
   * updated these on the happy path would leave a stepper for a storm that is
   * no longer being shown, pinned above an all-clear.
   */
  function afterRender() {
    stepper?.render();
    requestChrome?.();
  }

  /* ---------------------------------------------------------------------- */

  /**
   * The address, and the way to change it. LAST SECTION, always.
   *
   * ==> IT WAS MOVED TO THE TOP AND MOVED BACK, IN ONE SESSION. <== The
   * argument for the top was real: this is the only control on the dashboard
   * that DOES anything, and burying it under the chart, the figures, the
   * countdown and the vitals made "how do I fix my home location" a scroll
   * past everything the location was used for.
   *
   * It lost to a better one, on glass. Setting home is a once-a-year action;
   * reading the storm is why the drawer is open. Putting the once-a-year
   * control first put a line of grey address text between the reader and the
   * storm's name every single time. A footer is the right shape for a setting:
   * it is where a reader looks for one, and it is out of the way of the thing
   * they came for. Aaron's call, 2026-08-11.
   *
   * NOT IN THE TITLE BAR either. That bar is shared by every drawer and the
   * storm detail view already uses it for identity; a per-view control there
   * means touching all of them to serve one.
   */
  function homeRowHtml(home) {
    /* ==> THE SAME WORDS THE SETUP PANEL USED. <== This line used to build its
     * own fallback — label, or else a decimal pair — which meant a pin-set home
     * read as `29.301, -94.798` here forever and there was no way to tell that
     * apart from a home in open water or one whose lookup had failed.
     * `placeText` is the single formatter all four surfaces share. */
    const label = placeText(home);
    return `
      <div class="home-sect home-editrow">
        <button class="home-edit" type="button" data-act="edit-home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 11 12 4l8 7"/><path d="M6.5 9.6V20h11V9.6"/></svg>
          <span class="home-edit-addr" title="${esc(label)}">${esc(label)}</span>
          <span class="home-edit-go" aria-hidden="true">Edit ›</span>
          <span class="visually-hidden">Edit home</span>
        </button>
      </div>`;
  }

  function loadingHtml(msg) {
    /* `dotted` after `esc`, always — escaping never emits a `…`, so the swap
     * can only ever hit the one this file put there. */
    return `<div class="home-sect"><p class="detail-soft">${dotted(esc(msg))}</p></div>`;
  }

  function noHomeHtml() {
    /* ==> THE LAST SENTENCE USED TO SAY "YOUR COORDINATES NEVER LEAVE THIS
     * DEVICE", AND IT STOPPED BEING TRUE. <== It was already strained by the
     * reverse lookup that turns a dropped pin into a place name, and §48's
     * rainfall forecast settles it: asking how much rain falls on a house
     * means sending the house. What IS true is what it says now — the home is
     * stored here and nowhere else, no account holds it, and the two lookups
     * that need a point send a rounded one (`RAIN.wireDecimals`, and three
     * decimals for `/api/reverse`). A promise a feature quietly breaks is
     * worse than a smaller promise kept. */
    return `
      <div class="home-sect">
        <p class="home-lede">Set a home and this becomes a page about you.</p>
        <p class="detail-soft">How far it is, how close it gets, how strong it is when
          it reaches you, and how long you have before it does. Your home is stored
          on this device only — no account, and nothing that names you.</p>
      </div>
      <div class="home-sect">
        <button class="home-cta" type="button" data-act="edit-home">Set your home ›</button>
      </div>`;
  }

  /* ==> THE STATE THAT MUST NEVER LIE. <==
   *
   * Three different silences, three different sentences (§5):
   *   loading      — still asking
   *   unavailable  — a source did not answer, and this is NOT an all-clear
   *   clear        — everyone answered and there is genuinely nothing
   *
   * The middle one is the safety-adjacent case. It says which source failed,
   * refuses the word "clear", and offers the nearest thing anyone DID manage
   * to see rather than an empty screen. */
  function quietHtml(state, home) {
    const nhc = state.sources?.nhc?.status;
    const gdacs = state.sources?.gdacs?.status;
    const loading = nhc === 'loading' || gdacs === 'loading';
    const down = [nhc === 'unavailable' && 'NHC', gdacs === 'unavailable' && 'GDACS'].filter(Boolean);

    if (loading && !state.storms?.length) {
      return loadingHtml('Checking the oceans for anything headed your way…') + homeRowHtml(home);
    }

    if (down.length) {
      const who = down.join(' and ');
      const other = down.length === 1 ? (down[0] === 'NHC' ? 'GDACS' : 'NHC') : null;
      return `
        <div class="home-sect">
          <div class="home-threat">
            <span class="home-swatch" style="--sw: var(--error)"></span>
            <span class="home-threat-name">Can’t say right now</span>
          </div>
          <p class="home-lede home-lede--tight">${esc(who)} didn’t answer.
            This is <em>not</em> an all&#8209;clear.</p>
          ${other
            ? `<p class="detail-soft">${esc(other)} answered and has nothing near you —
                 but it doesn’t watch every ocean in the same detail, so it cannot
                 speak for the one that went quiet.</p>`
            : '<p class="detail-soft">Neither source answered, so nobody is watching for you right now.</p>'}
        </div>
        ${homeRowHtml(home)}`;
    }

    /* Genuinely quiet. Ended storms are excluded from the threat pick, so a
     * grey dot on the globe can still be the only thing out there — say so
     * rather than an all-clear that the globe visibly contradicts. */
    const live = (state.storms || []).filter((s) => !isEnded(s));
    return `
      <div class="home-sect">
        <div class="home-threat">
          <span class="home-swatch" style="--sw: var(--text-muted)"></span>
          <span class="home-threat-name">Nothing bearing down</span>
          <span class="home-chip" data-tone="calm">All clear</span>
        </div>
        <p class="home-lede home-lede--tight">Nothing is closing on you.</p>
        <p class="detail-soft">${
          live.length
            ? `${live.length === 1 ? 'One cyclone is' : live.length + ' cyclones are'} active
               somewhere in the world. None of them is coming for you.`
            : 'There are no tropical cyclones anywhere in the world right now.'
        }</p>
        <p class="detail-soft">Both sources answered, so this is a real all-clear —
          it is what they said, not what we could not reach.</p>
      </div>
      ${homeRowHtml(home)}`;
  }

  /* ==> THE CHIP IS A LADDER NOW, NOT A COIN FLIP. <== It used to be two words
   * off the storm list's pick, and `Nearest` was a shrug covering four
   * unrelated situations — including EVERY GDACS storm, because GDACS
   * publishes no heading and the app could not tell "not closing" from "cannot
   * say". A cyclone bearing straight down on the house wore the same word as
   * one parked half an ocean away.
   *
   * The rungs are computed in `buildHomeDashboard` as `dash.stage`, because
   * only the dashboard has walked the track and the wind fields. This chooses
   * words for them and nothing else.
   *
   * `data-tone="calm"` is on the rungs that are not a warning and off the ones
   * that are — so the color and the word can never disagree. */
  const STAGE_CHIP = Object.freeze({
    'wind-here':     ['On you now', false],
    overhead:        ['Passing you now', false],
    imminent:        ['Hours away', false],
    'bearing-down':  ['Bearing down', false],
    closing:         ['Closing in', false],
    'just-passed':   ['Just passed you', true],
    /* ==> `past` USED TO CARRY TWO DIFFERENT FACTS AND ONE WORD. <== It was
     * both "this storm came close to you and that is behind you now" and
     * "this storm is simply heading away", and "Moving away" is only true of
     * the second. Worse, the first was judged on the FORECAST pass, which for
     * a departed storm is just its current distance — so a storm that went 12
     * miles past the house three days ago read as `far-off`: "Not near you".
     *
     * Two facts, two rungs, two chips. `gone-by` is a statement about
     * something that happened to THIS house; `past` is a statement about which
     * way the storm is pointed. Both stay `calm` — neither is a warning. */
    'gone-by':       ['Has passed', true],
    past:            ['Moving away', true],
    'far-off':       ['Not near you', true],
    'track-unknown': ['Track unknown', true],
    /* ==> THE THREE RUNGS BELOW WERE ONE WORD, AND TWO OF THEM NEVER MOVED
     * OFF IT. <== `pending` covered every reason the curve was missing, so a
     * storm whose forecast had ALREADY come back — failed, or answered with
     * nothing — wore "Checking…" for as long as the drawer stayed open. Seen
     * on glass 2026-08-13: Hernan's advisory 002 published a position and no
     * track, his own detail panel said so plainly, and the home drawer beside
     * it claimed to still be working.
     *
     * All three are `calm`, and that is the point — none of them is a warning
     * about the storm. They are statements about what is KNOWN. */
    'no-track': ['No forecast yet', true],
    'track-failed': ['Track unavailable', true],
    /* Geometry has not arrived yet, and ONLY that. The dots move on this one
     * (ui/loading-dots.js), so it is the single chip on this ladder allowed to
     * imply something is still happening. */
    pending:         ['Checking…', true],
  });

  function chipHtml(dash, threat) {
    const [word, calm] =
      STAGE_CHIP[dash?.stage] ||
      (threat?.why === 'closing' ? STAGE_CHIP['bearing-down'] : STAGE_CHIP.pending);
    return `<span class="home-chip"${calm ? ' data-tone="calm"' : ''}>${dotted(esc(word))}</span>`;
  }

  /* --- the dashboard proper ----------------------------------------------- */

  /**
   * ==> TWO LAYOUTS, ONE FORK. <==
   *
   * NEAR is everything this screen has always been: closest pass, the error
   * band, strength at three moments, the chart, the wind countdown.
   *
   * FAR is short on purpose. Every one of those blocks is approach machinery,
   * and a storm that never comes near has no approach to run it on — the
   * results are each arithmetically true and collectively absurd. So the far
   * layout drops the chart, the countdown, the closest-pass headline and the
   * arrival trend, and keeps the four facts that remain honest: where it is,
   * which ocean, how strong, which way it is going.
   *
   * THE FORK IS `dash.far` AND NOTHING ELSE. It is a single field computed
   * where the track is walked, so no part of this file re-derives "is it
   * close" from a distance and comes to a different answer than the chip
   * sitting next to it.
   */
  function dashboardHtml(dash, threat, home) {
    return [
      dash.far ? '' : headlineSectHtml(dash),
      dash.far ? '' : chartSectHtml(dash),
      whereSectHtml(dash),
      /* ==> DIRECTLY UNDER `Where it is`, AND ABOVE THE FIGURES. <== §48.8
       * places it after that section and before the address block, which is a
       * range rather than a slot; this is the top of that range and it is
       * chosen for one reason. A Flash Flood Warning in force is the most
       * actionable thing on this screen, it renders at the head of this
       * section (§48.6), and a warning at the bottom of a scroll is a warning
       * nobody read. */
      rainSectHtml(),
      /* ==> DIRECTLY UNDER RAIN, AND THE PAIRING IS THE POINT (§51.3). <==
       * These are the two sections on this screen about WATER AT THE HOUSE
       * rather than about the storm's own numbers, and a reader deciding
       * whether to move a car wants them together. Rain is first because it
       * reaches every house on Earth and surge only reaches coastal ones —
       * putting the rarer section above the universal one would leave a gap
       * on most screens where a heading used to be. */
      surgeSectHtml(threat),
      figuresHtml(dash),
      dash.far ? '' : countdownHtml(dash, sys, sectHead),
      homeRowHtml(home),
    ].join('');
  }

  /**
   * ==> THE STORM'S NAME IS THE DRAWER'S TITLE NOW, NOT A ROW IN ITS BODY. <==
   *
   * The history is worth keeping because this is the third shape. It was a
   * scrolling row of name chips, which made the drawer read as a menu you had
   * to get past before the content started. It became chevrons flanking the
   * name, the biggest type on the screen — right for this drawer in isolation,
   * and wrong beside the storm detail panel, which puts its name in the header
   * and its chevrons in a thin row underneath. Two steppers in two shapes for
   * one job.
   *
   * So the name and its chip go into the drawer header, in the SAME identity
   * block the detail panel supplies (`.drawer-identity`), and the chevrons go
   * into the SAME pinned stepper. The two drawers are now one design. Aaron's
   * call on glass 2026-08-12.
   *
   * WHAT IT COST: the name is smaller than it was. Header type is smaller than
   * 1.35rem, and sizing it back up would grow the pinned header on the panel
   * with the least room to spare. Worth it — the name is not the answer to "is
   * this coming for me". The distance below it is, and that is still the
   * biggest figure on the screen.
   *
   * IT IS STILL A BUTTON. Tapping it is the only route from this dashboard
   * into the storm's own detail panel, and losing that would strand the route
   * behind nothing. A tappable header title is unusual and will mostly be
   * found by trying it; that is accepted, and it is why the underline and the
   * focus ring in panels.css are not decoration.
   */
  function identityNode() {
    const threat = currentThreat();
    /* NO STORM, NO IDENTITY. The quiet, loading, error and no-home paths have
     * nothing to name, so the drawer falls back to its plain title and the
     * header says "Home" in the middle exactly as it always did. Returning the
     * string here rather than a node is what makes that happen without this
     * file knowing anything about the header's markup. */
    if (!threat?.storm) return 'Home';

    const s = threat.storm;
    const dash = lastDash;

    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'drawer-identity';
    wrap.dataset.act = 'open-storm';
    wrap.dataset.stormId = s.id;
    wrap.addEventListener('click', () => openStormById(s.id));
    wrap.innerHTML = `
      <div class="drawer-identity-line">
        <span class="drawer-identity-dot" style="--dot-ink: ${esc(stormSwatch(s))}" aria-hidden="true"></span>
        <h1 class="drawer-title">${esc(s.name)}</h1>
      </div>
      <div class="drawer-identity-sub">${chipHtml(dash, threat)}</div>
    `;
    return wrap;
  }

  /** The closest-pass headline, in its own section. Near storms only — a far
   *  storm has no approach for it to be about. */
  function headlineSectHtml(dash) {
    return `<div class="home-sect">${headlineHtml(dash)}</div>`;
  }

  /**
   * WHERE IT IS — its own section now, and the one the far layout leads with.
   *
   * ==> IT USED TO SAY THE SAME THING TWICE ON A FAR STORM. <== The far lede
   * printed "6,363 mi WNW of home" as its headline figure and the strength
   * strip's where row printed "6,363 mi WNW of you" four lines below it. Both
   * were correct, neither was wrong to want, and together they were the
   * clearest example of the wall of text this pass exists to break up. One
   * block, one distance.
   */
  function whereSectHtml(dash) {
    const d = dash.distance;
    if (!d) return '';
    const where = BASIN_LABEL[dash.storm.basin] || null;

    return `
      <div class="home-sect">
        ${sectHead('pin', 'Where it is')}
        <div class="home-big">${esc(formatDistance(d.nm, sys()))}
          <small>${esc(formatBearing(d.bearing))} of you</small></div>
        <p class="home-where-motion">${
          /* THE ARROW IS ON THE VISIBLE LINE ONLY, NOT IN THE COUNTDOWN. That
           * list is the chart's accessible twin and has to be readable as
           * words alone; a mark whose whole meaning is a rotation belongs on
           * the surface a reader is looking at, and the direction is spelled
           * out in the sentence beside it either way. */
          headingArrow(headingOf(dash)?.deg)
        }${esc(motionDetail(dash, sys))}</p>
        ${Number.isFinite(dash.storm.windKt)
          ? '' /* the strength heading has the clock */
          : `<p class="home-stamp">${esc(
              formatAge(dash.observedAt, now())
                ? `Advisory ${formatAge(dash.observedAt, now())}`
                : 'Advisory time unknown'
            )}</p>`}
        ${dash.far
          ? `<p class="detail-soft">${
              where
                ? `It is in the ${esc(where)}, far outside anything that could reach you.`
                : 'It is far outside anything that could reach you.'
            } Nothing on its track brings it near.</p>`
          : ''}
      </div>`;
  }

  /** RAIN — how much is coming to the house (§48.8).
   *
   *  ==> IT IS ABOUT THE HOUSE, NOT ABOUT THE STORM, AND THE HEADING HAS TO
   *  SAY SO. <== §48.10: this number and the storm drawer's rainfall paragraph
   *  answer different questions and will disagree — the advisory quotes the
   *  heaviest band across an area, this is one grid cell. The controller's
   *  note names the point NWS is forecasting for, which is the only thing on
   *  either surface that explains the difference. */
  function rainSectHtml() {
    const home = getHome();
    if (!home) return '';
    return `<div class="home-sect home-rain">${rainH.inner(home, sectHead('rain', 'Rain'))}</div>`;
  }

  /** SURGE — how much water reaches the coast near the house (§51.3).
   *
   *  ==> IT RENDERS FOR SOME STORMS AND NOT OTHERS, AND THAT IS NOT A BUG.
   *  <== Only a storm carrying a GDACS event id can be asked, which excludes
   *  every storm in an NHC basin (§51.5). The controller decides; this asks it
   *  rather than re-deriving the rule, so the wrapper can never render around
   *  an empty section. */
  function surgeSectHtml(threat) {
    const home = getHome();
    const storm = threat?.storm;
    if (!surgeH.applies(storm, home)) return '';
    return `<div class="home-sect home-surge">${surgeH.inner(storm, home, sectHead('surge', 'Coastal flooding'))}</div>`;
  }

  /** Repaint ONLY the Surge section when its fetch lands, for the reason
   *  `renderRainBody` gives: a full render() throws away the reader's scroll
   *  position. */
  function renderSurgeBody() {
    const el = body()?.querySelector('.home-surge');
    const home = getHome();
    const storm = lastDash ? currentThreat()?.storm : null;
    if (!el || !surgeH.applies(storm, home)) return;
    el.innerHTML = surgeH.inner(storm, home, sectHead('surge', 'Coastal flooding'));
    surgeH.wire(el, storm, home, renderSurgeBody);
  }

  /** Repaint ONLY the Rain section when its fetch lands. A full render()
   *  rebuilds the whole dashboard and throws away the reader's scroll
   *  position — the same reasoning the storm panel's per-section repaints
   *  use. */
  function renderRainBody() {
    const el = body()?.querySelector('.home-rain');
    const home = getHome();
    if (!el || !home) return;
    el.innerHTML = rainH.inner(home, sectHead('rain', 'Rain'));
    rainH.wire(el, home, renderRainBody);
  }

  /**
   * A section heading: an icon and its words.
   *
   * ==> THE ICON IS BESIDE THE LABEL, NOT INSTEAD OF IT. <== A pin, a gauge
   * and a wind arrow are not a shared vocabulary — the reader has to learn
   * this app's meaning for each one, and a heading nobody can read is a
   * section nobody can skip past. What the icons buy is SCANNING: on a screen
   * of five stacked blocks of text, a shape at the left edge of each heading
   * is what the eye uses to find its place, and that works whether or not the
   * reader ever decodes the shape.
   *
   * `aria-hidden` on every one of them, because the words beside them are
   * already the accessible name and "image, pin, Where it is" is noise on the
   * one surface that cannot afford it.
   */
  function sectHead(icon, label) {
    return `<div class="home-kicker home-kicker--icon">
        ${iconSvg(icon)}<span>${esc(label)}</span>
      </div>`;
  }

  /** The icon set, in one place. Stroke-only, 24-box, inheriting `currentColor`
   *  so a heading and its icon can never drift apart in color. */
  const ICON_PATH = Object.freeze({
    /* Where it is — a map pin. */
    pin: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    /* How strong — the wind glyph, three trailing streams. */
    wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h14a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    /* Rain — a cloud with fall lines under it. */
    rain: '<path d="M7 15.5a4 4 0 0 1 .5-7.97 5 5 0 0 1 9.4 1.02A3.5 3.5 0 0 1 17 15.5Z"/>' +
      '<path d="M9 18.5 8 21M13 18.5 12 21M17 18.5 16 21"/>',
    /* Timeline — a clock, because every row on it is a time. */
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    /* Vitals — a gauge needle. */
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 17l4-5"/>',
    /* Coastal flooding — a wave crest over a level line. Deliberately NOT the
     * rain cloud with more drops: these two sections sit adjacent and their
     * icons are the only thing distinguishing them at a glance while
     * scrolling. */
    surge: '<path d="M3 16c2 0 2-1.5 4-1.5S9 16 11 16s2-1.5 4-1.5S17 16 19 16"/>' +
      '<path d="M3 20h18"/><path d="M6 11c0-3 3-4 6-7 3 3 6 4 6 7"/>',
    /* The closest pass — a crosshair over the house. */
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>' +
      '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  });

  function iconSvg(name) {
    const d = ICON_PATH[name];
    if (!d) return '';
    return `<svg class="home-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  /** The headline: the closest pass, and — always beside it — the band.
   *
   *  THE TWO ARE ONE SENTENCE AND MUST NOT BE SEPARABLE. "Closest pass 36
   *  miles south" is arithmetically true and can leave somebody unprepared,
   *  because NHC's own two-thirds circle at that lead time may reach the
   *  house. That is why the band renders in the same block rather than in a
   *  details section somebody can collapse. */
  function headlineHtml(dash) {
    if (!dash.approach) {
      const d = dash.distance;
      /* ==> FOUR REASONS, FOUR SENTENCES (§5). <== This used to branch on
       * `geo.state` for the failure and fall through to "Working out where it
       * goes next…" for everything else — so a storm whose forecast had come
       * back EMPTY read as one still downloading, permanently. `dash.unavailable`
       * is now decided in one place (data/home-dashboard.js) and this reads it
       * rather than re-deriving anything of its own. */
      const why =
        dash.unavailable === 'source-publishes-no-track'
          ? 'This source doesn’t publish a forecast track, so nobody can tell you where it goes next. The distance above is real and current.'
          : dash.unavailable === 'track-fetch-failed'
            ? 'The forecast track didn’t load. The distance above is still yours and still current.'
            : dash.unavailable === 'no-track-published'
              /* ANSWERED, WITH NOTHING. Not a hole in our data and not a
               * failure — the advisory itself carries no track, which is
               * normal for a system this new or this weak, and saying so is
               * more use than a permanent shrug. */
              ? 'This advisory doesn’t include a forecast track yet — just a position. The next one usually does.'
              : 'Working out where it goes next…';
      return `
        <div class="home-headline">
          <div class="home-big">${d ? esc(formatDistance(d.nm, sys())) : '—'}
            <small>${d ? esc(formatBearing(d.bearing)) + ' of home' : ''}</small></div>
          <p class="detail-soft">${dotted(esc(why))}</p>
        </div>`;
    }

    /* ==> WHEN THE PASS IS BEHIND THE CLOCK, THE HEADLINE IS A DIFFERENT
     * OBJECT, NOT A DIFFERENT ADJECTIVE. <== This block used to print
     * `dash.approach` under the words "Closest it came", and `approach` for a
     * departed storm is pinned to the current position — so the screen said
     * the closest the storm ever came was exactly where it was standing.
     * Measured on Lala 2026-08-16: 138 mi WNW, which was her live distance.
     * `dash.passed` is the real figure, walked over the observed track
     * (§49.5), and it is rendered by its own function so no edit can
     * accidentally feed forecast numbers into past-tense words. */
    if (isPastStage(dash) && dash.passed) return passedHeadlineHtml(dash);

    const a = dash.approach;
    /* The kicker changes tense with the stage. It used to branch on `trend`
     * alone, so it kept saying "Closest pass" in the present tense for hours
     * after the storm had gone by. */
    /* Three, not four: the "it is happening now" case is already carried by
     * the date line underneath ("Mon 10:00 AM · now") and by the chip, and a
     * kicker that repeated it put the same three words twice on one screen. */
    const dirWord =
      isPastStage(dash) ? 'Closest it came'
      : a.trend === 'receding' ? 'Closest it gets'
      : 'Closest pass';

    /* A STORM THAT NEVER COMES NEAR GETS A DIFFERENT SENTENCE, not a quieter
     * version of the same one. `relevant` and `trend` are orthogonal and the
     * pair produces three true statements — the detail panel makes the same
     * three, for the same reason. */
    if (!a.relevant) {
      return `
        <div class="home-headline">
          <div class="home-big">${esc(formatDistance(dash.distance.nm, sys()))}
            <small>${esc(formatBearing(dash.distance.bearing))} of home</small></div>
          <p class="detail-soft">On this forecast it never comes near you.</p>
        </div>`;
    }

    const when = a.time
      ? `${esc(formatClockDay(a.time))}${formatUntil(a.time, now()) ? ` · ${esc(formatUntil(a.time, now()))}` : ''}`
      : '';

    /* ==> COMPRESSED TO ONE LINE, NOT DELETED. <== The two-sentence version
     * ("Two out of three past NHC forecasts were within 40 mi of where they
     * said. That circle covers your house.") was the largest block of prose on
     * the screen and it was carrying one number and one boolean. The number
     * and the boolean stay, because neither is anywhere else: the chart draws
     * the earliest-ARRIVAL shadow, which is a different figure, and nothing
     * else on this screen says the forecast could put the centre on the house.
     * "±" is doing the work the first sentence used to. */
    const band = dash.band
      ? `<p class="home-band">${
          dash.band.reachesHome
            ? `<b class="home-band-hit">±${esc(
                formatDistance(dash.band.nm, sys())
              )} forecast error — that reaches your house.</b>`
            : `±${esc(formatDistance(dash.band.nm, sys()))} forecast error — stops ${esc(
                formatDistance(Math.max(0, dash.band.loNm), sys())
              )} short of you.`
        }</p>`
      : dash.bandUnavailable === 'pass-is-now'
        ? `<p class="home-band detail-soft">That’s where it <em>is</em>, not where it is
             forecast to go — so there is no forecast error left to allow for.</p>`
      : dash.bandUnavailable === 'no-published-error-table'
        ? `<p class="detail-soft">Nobody publishes forecast-error figures for this
             ocean, so there is no margin to put around that number.</p>`
        : '';

    return `
      <div class="home-headline">
        ${sectHead('target', dirWord)}
        <div class="home-big">${esc(formatDistance(a.nm, sys()))}
          <small>${esc(formatBearing(a.bearing))} of home</small></div>
        ${when ? `<div class="home-when">${when}</div>` : ''}
        ${band}
        ${alreadyCloserHtml(dash)}
        ${windNoteHtml(dash)}
      </div>`;
  }

  /** Is the pass this screen is about behind the clock?
   *
   *  ONE TEST, READ FROM THE RUNG LADDER, so the kicker, the figures strip and
   *  the headline's choice of object can never disagree about which tense the
   *  screen is in. `gone-by` is the rung added with §49's pass 3 — see
   *  STAGE_CHIP — and it exists because "it came close and that is behind you"
   *  and "it is heading away" were sharing one word. */
  function isPastStage(dash) {
    return dash?.stage === 'just-passed' || dash?.stage === 'gone-by';
  }

  /** The closest pass that ACTUALLY HAPPENED (§49.5).
   *
   *  ==> NO ERROR BAND, AND THAT IS THE POINT RATHER THAN AN OMISSION. <== The
   *  ± figure beside a forecast pass is NHC's published two-thirds circle, and
   *  a circle drawn around a place the storm was MEASURED at is a fabricated
   *  uncertainty. `dash.passed` carries no band field for that reason; the one
   *  line here says why in words a reader can act on, because silently
   *  dropping the most prominent caveat on the screen would read as the app
   *  having lost it.
   *
   *  THE DISTANCE AND THE BEARING ARE BOTH THE PAST'S. An earlier draft kept
   *  the live bearing under a past distance and the pair contradicted each
   *  other — the storm came ashore south-west of the house and was north-east
   *  of it by then. */
  function passedHeadlineHtml(dash) {
    const p = dash.passed;
    const when = p.time
      ? `${esc(formatClockDay(p.time))}${formatUntil(p.time, now()) ? ` · ${esc(formatUntil(p.time, now()))}` : ''}`
      : '';

    /* THE FUTURE IS NOT DROPPED WHEN IT STILL SAYS SOMETHING. A storm on the
     * way out can still have a forecast that brings it back inside where it
     * is now — rare, and exactly the case a reader must not miss because the
     * screen decided it was a history lesson. One line, not a second headline;
     * §49.12 asks whether two stacked verticals read, and this is the cheap
     * answer to look at first. */
    const stillAhead =
      dash.approach?.relevant && dash.approach.trend === 'closing' && dash.approach.time
        ? `<p class="detail-soft">It comes back inside that — ${esc(
            formatDistance(dash.approach.nm, sys())
          )}, ${esc(formatUntil(dash.approach.time, now()) || 'shortly')}.</p>`
        : '';

    return `
      <div class="home-headline">
        ${sectHead('target', 'Closest it came')}
        <div class="home-big">${esc(formatDistance(p.nm, sys()))}
          <small>${esc(formatBearing(p.bearing))} of home</small></div>
        ${when ? `<div class="home-when">${when}</div>` : ''}
        ${stillAhead}
        ${windNoteHtml(dash)}
      </div>`;
  }

  /** ==> THE MID-PASS CASE: BOTH FACTS ARE TRUE AT ONCE. <== A storm overhead,
   *  or one still closing that has already been near once, has a real past
   *  pass AND a real forecast pass, and §49.2 forbids letting either wear the
   *  other's words. It does not require two identical headlines, which at
   *  phone width is two big numbers stacked with nothing to tell them apart.
   *
   *  So the forecast keeps the headline and the past gets one line under it,
   *  and only when it actually changes the picture — closer than the forecast
   *  pass by more than APPROACH.minGainNm, the same deadband that decides
   *  whether the track is closing at all. Below that they are the same event
   *  described twice. */
  function alreadyCloserHtml(dash) {
    const p = dash.passed;
    if (!p || isPastStage(dash)) return '';
    if (!(dash.approach && dash.approach.nm - p.nm >= APPROACH.minGainNm)) return '';
    const ago = p.time ? formatUntil(p.time, now()) : '';
    return `<p class="detail-soft">It came closer earlier — ${esc(
      formatDistance(p.nm, sys())
    )}${ago ? `, ${esc(ago)}` : ''}.</p>`;
  }

  /**
   * ==> WHAT THE CHART ALREADY DRAWS, THIS NO LONGER SAYS. <==
   *
   * `windLineHtml` used to run unconditionally and produced the longest
   * sentence on the screen — "Hurricane-force wind reaches you for at least 5
   * hours, starting Sun 8:25 PM. If the track runs toward you it could start
   * as early as Sun 4:29 PM." Every clause of that is in the picture directly
   * beneath it (the rail bar, its arrival label, its ≥5h duration, the dashed
   * shadow) and in the countdown directly beneath THAT, as three separate
   * rows. Three tellings of one fact. Cut on glass 2026-08-11.
   *
   * ==> BUT ONLY WHEN THE PICTURE ACTUALLY EXISTS. <== `homeChart` returns an
   * empty string when the corridor failed or has under two samples, and the
   * countdown's wind rows are gated on the same `corridor.worst`. So in every
   * case where there is no wind answer to draw, cutting this sentence would
   * cut the ONLY statement about wind on the screen — silence on failure,
   * which is the one thing §5 forbids outright. It survives for exactly those
   * cases: no corridor, or a corridor that says nothing reaches you.
   */
  function windNoteHtml(dash) {
    const co = dash.corridor;
    /* ==> ONE EXCEPTION, AND IT IS THE MOST IMPORTANT SENTENCE ON THE SCREEN.
     * <== When the wind is ON THE HOUSE RIGHT NOW, the picture and the
     * countdown both technically carry it — a rail bar spanning the present,
     * and a row reading "Hurricane-force wind reaches you · now". Measured on
     * Ida's Advisory 16, and that row is the future tense with a lead time of
     * "now" bolted on, which is a weaker thing to read at the moment it
     * matters most than "hurricane-force wind is on your house now". The
     * general rule stands — every FORECAST clause is cut as redundant — and
     * this one state keeps its sentence. */
    if (co?.ok && co.worst && dash.stage !== 'wind-here') {
      /* ==> AND ONE MORE, ADDED WITH THE PAST ARM. <== The argument for
       * cutting is that every clause is already in the picture below. That is
       * true of the FORECAST clauses and false of the past one: the chart
       * draws forecast bands and the countdown lists forecast arrivals, and
       * neither has ever said that wind already crossed this house. Cutting
       * here would delete the only statement of it on the screen, which is the
       * §5 failure §49.9 exists to remove — reintroduced by an optimisation. */
      return windPastClause(dash) ? windLineHtml(dash) : '';
    }
    return windLineHtml(dash);
  }

  /**
   * What the wind actually does at the house — the sentence the corridor
   * exists to produce, and the only one on this screen a reader can act on.
   *
   * ==> THE EARLIEST FIGURE IS OURS AND IS WORDED AS A RANGE, NEVER A TIME.
   * <== It composes NHC's track error with NHC's wind radii; both halves are
   * theirs, the composition is not. "Could start as early as 9 AM" is a
   * hedge a reader can weigh. "Winds start 9 AM" would be us putting an
   * agency's authority behind arithmetic they never published (§5).
   */
  function windLineHtml(dash) {
    const co = dash.corridor;

    /* ==> THE PAST HALF IS BUILT FIRST, AND THAT ORDER IS THE SAFETY RULE
     * (§49.9). <== Everything below used to be forward-only, so a storm whose
     * wind field had already been over the roof got a sentence written in the
     * future tense about the hours it had left — and when nothing reached the
     * house on what REMAINED of the forecast, it got the words *no
     * tropical-storm wind reaches you*. That is an all-clear published over a
     * measurement saying the opposite. The past clause is composed before any
     * forward clause exists, so no arrangement of the code below can print an
     * all-clear without it. */
    const before = windPastClause(dash);

    if (!co?.ok) {
      /* Absent radii is normal for a weak or distant storm and is NOT a
       * failure — it must not read like one.
       *
       * ==> IT IS NO LONGER WHERE EVERY GDACS STORM LANDS (§49.16). <== It
       * was, and that was the largest silence in the app: GDACS reached this
       * function with no radii at all, so this branch was the only sentence
       * half the world's cyclones ever got. Their wind field is published as
       * polygons and `data/gdacs-geometry.js` now hands it over as numbers, so
       * a GDACS storm goes down the same path an NHC one does.
       *
       * What still lands here from either source is a storm whose advisory
       * genuinely published no forecast wind field — weak, distant, or late in
       * its life. The sentence stays worded for that. */
      if (co?.unavailable !== 'no-radii') return '';
      return `<p class="detail-soft" style="margin-top:var(--space-snug)">
          ${before ? `${before} ` : ''}This advisory doesn’t say how big the
          wind field is, so nobody can tell you whether it reaches you.</p>`;
    }

    const kt = co.worst;

    /* ==> A CORRIDOR WITH NO FORWARD HALF IS NOT AN ALL-CLEAR. <== NHC stops
     * issuing wind radii late in a storm's life, so `forwardOk` false means
     * "nobody published a forecast wind field", not "nothing is coming". The
     * past clause is the whole answer, and the missing half is named rather
     * than left as silence. */
    if (!co.forwardOk) {
      return `<p class="home-band">${before ||
        `<b>No wind measurement placed this storm’s wind field over your
          house.</b>`} This advisory doesn’t forecast a wind field, so there
        is nothing to say about the hours ahead.</p>`;
    }

    if (!kt) {
      /* ==> NEVER-AND-NOT-COMING IS TWO STATEMENTS, AND ONLY ONE OF THEM USED
       * TO BE HERE. <== "No tropical-storm wind reaches you" is a claim about
       * the future wearing no tense. Where the past was also measured it says
       * both halves; where it was not, it says only the half it can stand
       * behind — and `windPastClause` supplies the horizon when the
       * measurement does not reach all the way back. */

      /* ==> BUT ONCE THE WIND HAS BEEN AND GONE, THE FORWARD HALF IS NOISE.
       * <== On Lala the sentence read *Damaging wind reached your house at
       * 6:20 PM Sat and lifted at 1:17 AM Sun. No tropical-storm wind is
       * forecast to reach you either. The nearest edge stays 160 mi off.* The
       * second and third sentences are true and nobody needs them: the reader
       * has just been told the wind came and went, and a storm 224 mi away and
       * leaving is not a question they are still asking. Cut on glass
       * 2026-08-16. The all-clear survives in full for a storm whose wind has
       * NOT reached the house, which is the case it was written for. */
      if (co.past?.worst) return `<p class="home-band">${before}</p>`;

      const edge = esc(formatDistance(co.forecast[34]?.closestGapNm ?? 0, sys()));
      return `<p class="home-band">${before ? `${before} ` : ''}<b>No
        tropical-storm wind ${before ? 'is forecast to reach you either' :
        'reaches you on this forecast'}</b>. The nearest edge stays ${edge}
        off.</p>`;
    }

    const c = co.forecast[kt];
    const start = c.windows[0]?.[0];
    const hrs = c.totalHours;

    const early = co.earliest?.[kt]?.windows?.[0]?.[0];
    /* Only worth saying when the error moves the answer by a real margin —
     * "could start at 4:32 instead of 4:37" is noise wearing a hedge. */
    const earlyGap = early && start ? (Date.parse(start) - Date.parse(early)) / 3_600_000 : 0;

    /* AN OPEN-ENDED WINDOW IS A FLOOR, NOT A DURATION. It closed because the
     * forecast ran out of published radii for this threshold, not because the
     * field left — so "for 3 hours" would be understating how long dangerous
     * wind lasts, which is the unsafe direction to be wrong in. The hedge and
     * the number are built together in lib/wind.js, because when they were
     * built apart this sentence shipped reading "for at least about an hour". */

    /* ==> PRESENT TENSE WHEN IT IS ALREADY ON YOU. <== "reaches you, starting
     * 11 PM" stayed in the future for the whole stretch the wind was actually
     * blowing on the house — which is the stretch this screen exists for. The
     * stage knows; the sentence follows it. */
    const onYou = !!co.here;
    /* ==> THE SENTENCE IS ABOUT THE WIND THAT IS ACTUALLY ON THE HOUSE. <==
     * It was about `worst` in both arms, so on a storm whose 34 kt field
     * arrived hours ago and whose 64 kt core is five hours out, the present
     * tense would have promised a hurricane that had not arrived. `here` names
     * the strongest field containing this minute; `worst` still names the
     * strongest the storm will bring, and when they differ the second half of
     * the sentence says the stronger one is still coming. */
    const nowKt = co.here || kt;
    const nowC = co.forecast[nowKt];
    const nowStart = nowC?.windows?.find(
      ([a, b]) => Date.parse(a) <= dash.now && (!b || Date.parse(b) >= dash.now)
    )?.[0] || nowC?.windows?.[0]?.[0];
    const stillComing = onYou && kt > nowKt ? kt : null;

    /* ==> "AGAIN" NEEDS A FIRST TIME, AND IT WAS ASKING THE WRONG QUESTION.
     * <== It read `before && !onYou` — true whenever the past clause said
     * ANYTHING, including *No tropical-storm wind has reached you so far*. So
     * a storm that had never touched the house read *No tropical-storm wind
     * has reached you so far. Damaging wind reaches you again…* Seen on glass
     * 2026-08-16 on Lala. The question is whether wind actually reached, which
     * is `co.past.worst` — a measurement — or a forecast window that has
     * already opened and closed. */
    const reachedBefore = !!co.past?.worst;
    const both = before && !onYou;
    return `<p class="home-band">
      ${both ? `${before} ` : ''}
      ${onYou
        ? /* ==> THE PHRASE, NOT THE CLAUSE. <== The clause carries its own
           * preposition, and the zero-length case carries a whole sentence
           * instead of a duration — splicing either into "lasting …" produced
           * "lasting and the forecast stops before saying for how long from
           * 10:00 PM". When there is no length to give, the sentence ends and
           * a second one says why. */
          `<b>${esc(WIND_LABEL[nowKt] || nowKt + ' kt')} wind is on your house now</b>${
            windDurationPhrase(nowC.totalHours, nowC.openEnded)
              ? `, and the forecast has it lasting ${esc(
                  windDurationPhrase(nowC.totalHours, nowC.openEnded)
                )} from when it arrived at ${esc(formatTimeDay(nowStart))}.`
              : `. It arrived at ${esc(formatTimeDay(nowStart))}, and the forecast
                 stops before saying how long it lasts.`
          }${stillComing
            ? ` <b>${esc(WIND_LABEL[stillComing] || stillComing + ' kt')} wind
                reaches you</b> ${esc(formatTimeDay(c.windows[0]?.[0]))}.`
            : ''}`
        : `<b>${esc(WIND_LABEL[kt] || kt + ' kt')} wind
           ${reachedBefore ? 'reaches you again' : 'reaches you'}</b>
           ${esc(windDurationClause(hrs, c.openEnded))},
           starting ${esc(formatTimeDay(start))}.`}
      ${earlyGap >= 2 && !onYou
        ? `If the track runs toward you it could start as early as
           <b class="home-band-hit">${esc(formatTimeDay(early))}</b>.`
        : ''}
    </p>`;
  }

  /**
   * What the wind ALREADY did at the house (§49.9), as a clause the sentence
   * above splices in — or '' when there is nothing measured to say.
   *
   * ==> THIS IS THE SAFETY-ADJACENT HALF OF THE SCREEN. <== Everything the
   * corridor said was forward-only, so on a storm that had already gone by,
   * *no tropical-storm wind reaches you* was printed over a house the wind had
   * measurably crossed. The clause is built from NHC's own analysed wind field
   * — layer 13, joined to the analysed positions on the synoptic hour — so
   * every figure in it is a measurement rather than a forecast, and it carries
   * no error band for that reason (§49.2).
   *
   * ==> GDACS PUBLISHES NO PAST WIND FIELD AND SAYS SO OUT LOUD. <== Not a gap
   * in our parsing — `data/gdacs-geometry.js` sets `windPast: NONE()` because
   * the source has no such product. Left silent, a GDACS storm would inherit
   * the forward-only sentence and the whole failure this function exists to
   * remove would survive on half the world's storms. So the absence is
   * NAMED. Per §5 that is the difference between "nothing reached you" and
   * "nobody measured".
   */
  function windPastClause(dash) {
    const co = dash.corridor;
    const p = co?.past;

    if (!p) {
      /* Only worth saying on a storm that has a history to have measured. A
       * storm that formed an hour ago has no past for anyone to publish, and
       * a note about a missing measurement would read as a fault. */
      return dash.pastCurve?.length
        ? `<b>No past wind field is published for this storm</b>, so nothing
           here can say whether its wind already reached you.`
        : '';
    }

    const kt = p.worst;

    if (!kt) {
      /* MEASURED AND IT MISSED — which is a stronger statement than the
       * forward all-clear and is worth making separately. The horizon rides
       * along when the measurement does not reach back as far as the track:
       * "nothing reached you" is only true over the hours somebody measured. */

      /* ==> AND IT MUST NOT CONTRADICT THE RAIL TWO INCHES BELOW IT. <== The
       * measured field is NHC's ANALYSIS and it lags — the most recent one can
       * be six hours behind the clock — while the forecast corridor is walked
       * from the storm's current position and its first window is often
       * already open. So on a storm mid-arrival both were true at once and the
       * screen said *No tropical-storm wind has reached you so far* directly
       * above *28 min ago — Tropical-storm-force wind reached you*. Seen on
       * glass 2026-08-16 on Lala.
       *
       * A denial is the one thing this clause cannot afford to be wrong
       * about, so where the forecast says wind has already begun the denial is
       * dropped entirely and the forward half carries the story. Silence here
       * is not a §5 failure: the sentence beside it, the rail and the chart
       * are all saying the wind arrived. */
      if (co?.begun) return '';

      return p.partial && p.coveredFrom
        ? `<b>No tropical-storm wind has reached you</b> over the hours the
           wind field is published for — measurements start
           ${esc(formatTimeDay(p.coveredFrom))}.`
        : `<b>No tropical-storm wind has reached you so far.</b>`;
    }

    const c = p.cross[kt];
    const win = c.windows[c.windows.length - 1];
    const label = esc(WIND_LABEL[kt] || kt + ' kt');

    /* ==> STILL INSIDE AT THE LAST MEASURED HOUR IS NOT "IT LIFTED". <== The
     * measured series ends at the storm's most recent analysed fix, which is
     * up to a synoptic interval BEHIND the clock. A window still open there
     * closed because the measurements ran out, not because the wind left, and
     * `crossings` flags exactly that. Saying "it lifted at 7 AM" would hand a
     * reader an all-clear the source never issued. */
    if (c.openEnded) {
      return `<b>${label} wind reached your house</b> at
        ${esc(formatTimeDay(win?.[0]))}, and the last measurement still had it
        over you.`;
    }

    return `<b>${label} wind reached your house</b> at
      ${esc(formatTimeDay(win?.[0]))} and lifted at
      ${esc(formatTimeDay(win?.[1]))}.`;
  }

  function chartSectHtml(dash) {
    const svg = homeChart(dash, sys());
    if (!svg) return '';
    return `<div class="home-sect home-chart-wrap">${svg}</div>`;
  }

  /**
   * ==> HOW STRONG, AND THEN WHERE. TWO QUESTIONS, NOT THREE COLUMNS. <==
   *
   * This strip used to be `At the pass` / `Right now` / `At its worst`, three
   * equal-looking cells of which TWO WERE WINDS AND ONE WAS A DISTANCE. Read
   * down the row and the eye is invited to compare 23 mph, 6,363 mi and 35 mph
   * as if they were the same kind of fact. They are not, and the mismatch was
   * most of why the block did not read (caught on glass 2026-08-11).
   *
   * WHY STRENGTH IS THE STRIP'S JOB AND NOT THE CHART'S. chart-home.js holds
   * no wind SPEED anywhere and that is deliberate — read its header: the
   * strength lane was cut because "the storm's wind is not what you feel".
   * What the chart owns is geometry and timing: distance over time, the
   * closest-pass dot, when each wind field arrives, how long it stays. So the
   * clean division of the screen is
   *
   *     chart   where and when
   *     strip   how strong          <- here
   *     vitals  the rest of the advisory's readings
   *
   * and this function is the only place on the screen that puts the three
   * intensities side by side. NOW ANCHORS IT. Without the current wind in the
   * row, "75 mph when it's closest" has nothing to be measured against, which
   * is the entire point of showing it.
   *
   * ==> `Winds` CAME OUT OF vitalsHtml FOR THIS. <== The old strip's `At its
   * worst · that's now` and vitals' `Winds` printed the same number twice on
   * one screen whenever the storm had already peaked, which is most of a
   * storm's life. One of them had to go and it could not be this one.
   *
   * "At the pass" is gone as a phrase. It means the closest approach and it
   * reads as sailor's language to everyone who is not one.
   */
  function figuresHtml(dash) {
    const cells = [];
    const nature = dash.storm.nature;

    /* NOW — the anchor. */
    if (Number.isFinite(dash.storm.windKt)) {
      cells.push({
        k: 'Now',
        v: formatWind(dash.storm.windKt, sys()),
        s: categoryShortLabel(dash.storm.category, nature),
        color: categoryColor(dash.storm.category, nature),
      });
    }

    /* WHEN IT IS CLOSEST — past tense once it is by, because a storm that has
     * gone gets a different sentence rather than a quieter version of the same
     * one. Absent for every GDACS storm: GDACS publishes timestamped centre
     * positions and no per-point wind, so there is no intensity to sample at
     * the pass and inventing one is the fabrication §5 forbids.
     *
     * ==> AND ABSENT FOR A FAR STORM, WHICH IS NOT THE SAME ABSENCE. <== The
     * figure exists and is honest arithmetic; it is simply about a moment
     * thousands of miles away that has nothing to do with this house. Printed
     * on PEILOU-26 it read "At the pass 23 mph" about a closest approach of
     * 6,001 miles. A cell whose heading implies relevance must not be filled
     * with a number that has none. */
    /* ==> AND PAST TENSE MEANS A PAST NUMBER, NOT A PAST VERB ON TODAY'S
     * NUMBER. <== This cell used to print `dash.atClosest` — a sample of the
     * FORECAST curve — under the heading "When it was closest", and for a
     * departed storm the forecast pass is pinned to the current position. So
     * the cell printed the live wind, identical to the `Now` cell two inches
     * to its left. On Lala that was 69 mph twice, which reads as a rendering
     * fault even though both numbers were individually correct.
     *
     * `dash.atPassed` is NHC's ANALYSIS of what the storm was doing at the
     * moment it actually went by (§49.6) — a measurement, and better data than
     * a forecast for the same hour. Absent for most GDACS history, which
     * publishes positions and times and no wind: the cell then does not render
     * at all, which is the honest shape of that answer rather than a borrowed
     * figure. */
    const past = isPastStage(dash);
    const at = past ? dash.atPassed : dash.atClosest;
    if (at?.windKt != null && !dash.far) {
      cells.push({
        k: past ? 'When it was closest' : 'When it’s closest',
        v: formatWind(at.windKt, sys()),
        s: categoryShortLabel(at.category, nature),
        color: categoryColor(at.category, nature),
      });
    }

    /* STRONGEST — and it COLLAPSES TO A SENTENCE WHEN THE PEAK IS NOW, which
     * is the whole reason the old block stuttered. `peak.when === 'now'` means
     * exactly that the current wind was never beaten by any point on the
     * forecast curve, so a third cell here would repeat the first cell's
     * number verbatim, two inches to its right. */
    let peakNote = '';
    if (dash.peak?.when === 'now') {
      peakNote = 'It’s at its strongest right now.';
    } else if (dash.peak) {
      /* ==> THE PEAK CAN BE BEHIND THE CLOCK NOW (§49.6). <== `dash.peak` used
       * to span the forecast plus the present wind only, so a storm that
       * peaked on its way in reported a peak it had already had as though it
       * were still coming — "Strongest 81 mph · before it reaches you", under
       * a storm that went by yesterday. It now spans the observed track too,
       * and `when === 'past'` is the field that says so.
       *
       * ONE ROW, TWO TENSES, CHOSEN FROM THE SAME TIMESTAMP EVERYTHING ELSE
       * USES. `peakWhenPassed` is the past pass's answer and `peakWhen` is the
       * forecast pass's; they are separate fields rather than one widened one,
       * because "before it reaches you" and "before it reached you" are
       * different claims about different events (§49.2). */
      const peakPast = dash.peak.when === 'past';
      const rel = (peakPast || past) ? (dash.peakWhenPassed ?? dash.peakWhen) : dash.peakWhen;
      cells.push({
        k: peakPast ? 'Was strongest' : 'Strongest',
        v: formatWind(dash.peak.windKt, sys()),
        /* `peakWhen` can be 'at' (the peak lands on the pass) or null (nobody
         * published a time for one of them), and both used to fall through to
         * "before the pass" — wrong about the first, an invention about the
         * second.
         *
         * ==> A PEAK THAT HAS NOT HAPPENED CANNOT WEAR A PAST TENSE, WHATEVER
         * THE STORM HAS DONE. <== The tense here followed `past` — a fact
         * about the STORM — so Lala, who went by fifteen hours ago and peaks
         * in five days, read *Strongest 86 mph · after it passed*. Every word
         * of that is defensible (the peak does fall after the moment she
         * passed) and it lands as a report of something finished. Seen on
         * glass 2026-08-16.
         *
         * The relation to a pass that is already behind the clock is not what
         * a reader wants from a peak that is still ahead of it — what they
         * want is that it has not happened. So a forecast peak on a departed
         * storm says exactly that, and the three-way relation is kept for the
         * cases where both events sit on the same side of now. */
        s: peakPast
          ? (rel === 'after' ? 'after it passed'
            : rel === 'at' ? 'right as it passed'
              : rel === 'before' ? 'before it reached you'
                : 'time not given')
          : past
            ? 'still to come'
            : rel === 'after' ? 'after it passes'
              : rel === 'at' ? 'right as it passes'
                : rel === 'before' ? 'before it reaches you'
                  : 'time not given',
        /* ==> THE THIRD FIGURE IS COLORED LIKE THE OTHER TWO. <== It was the
         * only cell in the strip with no `color`, so it fell through to plain
         * white next to a colored `Now` and a colored `When it's closest`.
         * On glass that reads as the strongest wind being singled out, which
         * is the opposite of the intent — every band shouting is every band
         * whispering, and here the loudest treatment had landed on the cell by
         * accident. Same call, same source, same rule as its neighbours. */
        color: categoryColor(dash.peak.category, nature),
      });
    }

    /* ==> "IT WEAKENS ON THE WAY IN" IS ABOUT A JOURNEY THAT IS NOT HAPPENING.
     * <== The comparison behind it is the current wind against the wind at the
     * closest pass, which for a far storm means "over the next four days,
     * while travelling in the opposite direction, it gets weaker". True, and
     * about somebody else's house. */
    /* ==> AND IT IS ALSO ABOUT A JOURNEY THAT IS ALREADY OVER. <== Every one
     * of these three sentences is the future tense — "on the way in", "when it
     * gets to you" — and all three are computed from the FORECAST wind at the
     * FORECAST pass, which for a departed storm is the current position. So
     * under a storm that went by yesterday the strip offered "It holds its
     * strength all the way in" about a trip that finished. There is a real
     * past-tense version of this sentence and it belongs to §49's later work;
     * printing a wrong one meanwhile is the §5 failure, and printing nothing
     * costs a reader nothing they cannot see in the two cells above. */
    const trendLine = dash.far || past
      ? ''
      : dash.arrivalTrend === 'weakening'
        ? 'It weakens on the way in.'
        : dash.arrivalTrend === 'strengthening'
          ? 'It’s still strengthening when it gets to you.'
          : dash.arrivalTrend === 'steady'
            ? 'It holds its strength all the way in.'
            : '';

    /* ==> THE WHERE ROW MOVED OUT OF THIS BLOCK ENTIRELY. <== It lived here
     * as a full-width line under the winds, which was already an admission
     * that it did not belong in a strip of intensities — and on a far storm it
     * printed the same distance the lede four lines above had just printed.
     * It is `whereSectHtml` now, with its own heading and its own icon. One
     * question per section is the whole point of this pass.
     * ------------------------------------------------------------------- */

    if (!cells.length) return '';

    /* THE AGE RIDES ON THE HEADING. Every figure below came from one advisory
     * and its age changes what all of them mean (§8). The only stamp on this
     * screen used to sit at the bottom of vitals, two sections down and past
     * a chart — so the most-read numbers on the page carried no clock at all
     * until the reader had scrolled past them.
     *
     * ==> IT CANNOT RIDE ON A HEADING THAT DID NOT RENDER. <== With no wind
     * published there is no strength section at all, and the whole screen
     * would then carry no clock — which is the §8 failure, not a tidy edge
     * case. `whereSectHtml` picks it up in that case; the two never both show
     * it, because they check the same condition. */
    const age = formatAge(dash.observedAt, now());

    return `
      <div class="home-sect">
        <div class="home-kicker home-kicker--icon">
          ${iconSvg('wind')}<span>How strong</span>${
            age ? `<span class="home-kicker-age">· advisory ${esc(age)}</span>` : ''
          }
        </div>
        <div class="home-figs">
               ${cells
                 .map(
                   (c) => `<div>
                     <div class="home-figs-k">${esc(c.k)}</div>
                     <div class="home-figs-v"${c.color ? ` style="color:${esc(c.color)}"` : ''}>${esc(c.v)}</div>
                     <div class="home-figs-s">${esc(c.s)}</div>
                   </div>`
                 )
                 .join('')}
        </div>
        ${peakNote ? `<p class="detail-soft home-trendline">${esc(peakNote)}</p>` : ''}
        ${trendLine ? `<p class="detail-soft home-trendline">${esc(trendLine)}</p>` : ''}
        ${Number.isFinite(dash.storm.pressureMb)
          ? `<p class="home-pressure">Central pressure ${esc(
              formatPressure(dash.storm.pressureMb)
            )}</p>`
          : ''}
      </div>`;
  }

  /* ==> THE TIMELINE RAIL, THE DIRECTION SENTENCE AND THE HEADING LIVE IN
   * ui/countdown-home.js NOW. <== `countdownHtml` was 168 lines of code, the
   * longest function in the app, in the longest file in the app. It moved out
   * whole, with no behaviour change; the two things it used to close over —
   * the unit system and `sectHead` — are handed in. `headingOf` and
   * `motionDetail` went with it because the rail is their other caller and a
   * direction sentence that disagreed with the arrow beside it would be the
   * bug they were written to prevent. */

  /* ==> THE "<NAME> RIGHT NOW" SECTION IS GONE. <== It carried two rows by the
   * end, and neither of them belonged in a section of their own:
   *
   *   Moving    joined the where-it-is line, where it finally reads as one
   *             sentence — "Moving ENE at 17 mph, getting closer" — instead of
   *             a bare bearing at the bottom of the screen that the reader had
   *             to carry back up to the distance to make sense of.
   *   Pressure  moved into the strength strip, which is where an intensity
   *             measure belongs. Millibars ARE how strong the storm is; they
   *             were only ever in a separate block because that block existed.
   *
   * A section whose entire contents belong somewhere else is not a section,
   * and keeping it was a third of the wall of text this pass was cutting
   * (glass, 2026-08-11).
   * ---------------------------------------------------------------------- */

  /* --- the drawer view contract ------------------------------------------- */

  return {
    id: 'home',
    title: 'Home',

    /**
     * ==> THIS DRAWER IS TITLED WITH THE STORM, THE SAME AS THE DETAIL PANEL.
     * <== One identity block, one header shape, so the two panels read as one
     * design rather than two screens about the same thing. With no storm to
     * name — quiet, loading, sources down, no home yet — it returns the plain
     * string and the header says Home in the middle exactly as before.
     *
     * The argument is ignored: this view is always entered as a root with no
     * arg, and its subject comes from the threat pick, not from the caller.
     */
    titleFor: () => identityNode(),

    /**
     * ==> AND THE WORD "HOME" MOVES TO THE LEAD SLOT WHEN THE STORM TAKES THE
     * MIDDLE. <== A drawer whose header names a storm and says nothing else
     * reads as the detail panel. Returning null when there is no storm is what
     * stops the header saying Home twice in one bar.
     */
    eyebrow: () => (currentThreat()?.storm ? 'Home' : null),

    mount,

    /**
     * ==> THE CAMERA MOVE IS REPORTED, NOT PERFORMED. <== This file owns what
     * the dashboard SAYS; app/views.js owns where the globe points, and every
     * other camera move in the app already goes through it. What this hands
     * over is the fact only this file knows — which storm the ranking picked,
     * and how far it is — and the answer to "where does the camera go" is
     * computed from that in map/home-frame.js.
     *
     * AFTER `render()`, so the pick is the same one now on screen. `render()`
     * is what resolves a manual pick against the current storm list, and the
     * camera must never frame a storm the panel is not showing.
     */
    onEnter(_arg, { fresh = false } = {}) {
      visible = true;
      /**
       * ==> PRESSING HOME IS A FRESH ASK, AND IT STARTS AT THE TOP OF THE
       * RANKING. <== `pickedId` survives for the life of this view, which is
       * the life of the app — so stepping to a third storm to see it against
       * your house, closing the drawer, and pressing Home an hour later
       * re-opened on that same storm, and framed the camera on it. The reader
       * asked "what is coming for my house"; the answer was "whatever you were
       * curious about last time", which is a different question and looks like
       * the app being stuck.
       *
       * ONLY ON A FRESH ENTRY, NOT ON A RETURN. `go` clears the drawer's
       * history; `back` does not. Tapping the storm's name opens its detail
       * panel ON TOP of this one, and Back from there is the same visit
       * continuing — resetting the pick there would drop the reader somewhere
       * they did not navigate to, which is the opposite fault.
       */
      if (fresh) pickedId = null;
      render();

      /**
       * ==> `lastDash.storm`, NOT `currentThreat().storm`. <== They are usually
       * the same object and `lastDash` is the one that cannot disagree with the
       * screen: it is built from whatever `render()` just resolved, including a
       * manual pick. Framing the pair against a storm the panel is not showing
       * would put the camera between the house and the wrong cyclone.
       *
       * THE POSITION IS WHAT MATTERS NOW, not the distance. The camera frames
       * two points; miles are the wrong currency for a question about how far
       * apart two things are ON SCREEN. See map/home-frame.js.
       */
      onFrameHome?.({ storm: lastDash?.storm || null });
    },

    onLeave() {
      visible = false;
    },

    /**
     * The chevron just pressed, or nothing — the same contract the detail
     * panel keeps. `takeFocus` is one-shot, so arriving any other way starts
     * at the drawer's Back button, which is right for those.
     *
     * ==> IT USED TO FALL BACK TO THE EDIT-HOME BUTTON, AND THAT IS WHAT MADE
     * THIS DRAWER OPEN HALFWAY DOWN. <== Focusing an element scrolls it into
     * view, and Edit-home is the LAST section of the dashboard (see
     * `homeRowHtml`, which was deliberately moved back to the footer). So
     * `enter()` reset the body to the top and the focus call on the next line
     * dragged it straight back to the bottom. Every other drawer opened at its
     * top because every other drawer focuses a button in the fixed header.
     *
     * The original reasoning was sound when it was written — this was the only
     * control on a short screen. It stopped being true when the dashboard grew
     * a chart, a countdown, the vitals and the rail, and the control moved to
     * the footer. `ui/drawer.js` now also focuses with `preventScroll`, so no
     * future view can bring this back; this change is the one that puts the
     * reader somewhere sensible rather than merely somewhere harmless.
     */
    focus() {
      return stepper?.takeFocus() || null;
    },

    /** The drawer hands this in at mount so the view can ask for a header
     *  re-render when its title data changes — which for this view is every
     *  poll, because the title is a storm. */
    setChromeRefresh(fn) {
      requestChrome = fn;
    },

    /** A poll landed. Re-picks the threat storm — which may have changed —
     *  and re-renders. Cheap: the whole body is one innerHTML write and it
     *  holds no focusable state between renders except the two buttons. */
    update(state) {
      lastState = state;
      if (visible) render();
    },

    /** Home was set, moved or cleared. Every distance is stale and the threat
     *  pick itself may change, so the geometry hold is dropped too — it was
     *  warmed for a storm chosen against the OLD house. */
    homeChanged() {
      seq++;
      geo = { stormId: null, state: 'idle', bundle: null, error: null };
      /* ==> AND THE MANUAL PICK GOES WITH IT. <== It was a choice made against
       * the OLD house — "show me this one instead of the one bearing down on
       * me" — and a different house has a different one bearing down on it.
       * Keeping the pick would leave the reader who just moved their home
       * looking at a storm chosen for an address they no longer have. */
      pickedId = null;
      if (visible) render();
    },

    /** Units changed in Settings: every number on screen is in the wrong one. */
    unitsChanged() {
      if (visible) render();
    },

    isVisible: () => visible,

    destroy() {
      host?.removeEventListener('click', onClick);
      host = null;
    },
  };
}
