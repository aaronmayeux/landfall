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
import { formatAge, formatUntil, formatClockDay } from '../lib/time.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { isEnded, stormSwatch } from '../lib/lifecycle.js';
import { motionHeading } from '../lib/heading.js';
import { headingArrow } from './heading-arrow.js';
import { createStormStepper } from './storm-stepper.js';
import { BASIN_LABEL } from '../lib/basin.js';
import { getHome } from '../data/home.js';
import { pickThreatStorm, buildHomeDashboard, APPROACH } from '../data/home-dashboard.js';
import { homeChart } from './chart-home.js';
import { WIND_LABEL, windColor, windDurationClause, windDurationPhrase } from '../lib/wind.js';

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
  units, onEditHome, onOpenStorm, onFocusStorm, warmGeometry, now = () => Date.now(),
}) {
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

    const dash = buildHomeDashboard({
      storm: threat.storm,
      forecast,
      radii,
      home,
      now: now(),
    });

    lastDash = dash;
    el.innerHTML = dashboardHtml(dash, threat, home);
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
    const label = home.label || `${home.lat.toFixed(3)}, ${home.lon.toFixed(3)}`;
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
    return `<div class="home-sect"><p class="detail-soft">${esc(msg)}</p></div>`;
  }

  function noHomeHtml() {
    return `
      <div class="home-sect">
        <p class="home-lede">Set a home and this becomes a page about you.</p>
        <p class="detail-soft">How far it is, how close it gets, how strong it is when
          it reaches you, and how long you have before it does. Your coordinates never
          leave this device.</p>
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
   * that are — so the colour and the word can never disagree. */
  const STAGE_CHIP = Object.freeze({
    'wind-here':     ['On you now', false],
    overhead:        ['Passing you now', false],
    imminent:        ['Hours away', false],
    'bearing-down':  ['Bearing down', false],
    closing:         ['Closing in', false],
    'just-passed':   ['Just passed you', true],
    past:            ['Moving away', true],
    'far-off':       ['Not near you', true],
    'track-unknown': ['Track unknown', true],
    /* Geometry has not arrived yet. Saying nothing confident is the point —
     * the alternative is a word that has to be taken back a second later. */
    pending:         ['Checking…', true],
  });

  function chipHtml(dash, threat) {
    const [word, calm] =
      STAGE_CHIP[dash?.stage] ||
      (threat?.why === 'closing' ? STAGE_CHIP['bearing-down'] : STAGE_CHIP.pending);
    return `<span class="home-chip"${calm ? ' data-tone="calm"' : ''}>${esc(word)}</span>`;
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
      figuresHtml(dash),
      dash.far ? '' : countdownHtml(dash),
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
        }${esc(motionDetail(dash))}</p>
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
   *  so a heading and its icon can never drift apart in colour. */
  const ICON_PATH = Object.freeze({
    /* Where it is — a map pin. */
    pin: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    /* How strong — the wind glyph, three trailing streams. */
    wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h14a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    /* Timeline — a clock, because every row on it is a time. */
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    /* Vitals — a gauge needle. */
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 17l4-5"/>',
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
      const why =
        dash.unavailable === 'source-publishes-no-track'
          ? 'This source doesn’t publish a forecast track, so nobody can tell you where it goes next. The distance above is real and current.'
          : geo.state === 'error'
            ? 'The forecast track didn’t load. The distance above is still yours and still current.'
            : 'Working out where it goes next…';
      return `
        <div class="home-headline">
          <div class="home-big">${d ? esc(formatDistance(d.nm, sys())) : '—'}
            <small>${d ? esc(formatBearing(d.bearing)) + ' of home' : ''}</small></div>
          <p class="detail-soft">${esc(why)}</p>
        </div>`;
    }

    const a = dash.approach;
    /* The kicker changes tense with the stage. It used to branch on `trend`
     * alone, so it kept saying "Closest pass" in the present tense for hours
     * after the storm had gone by. */
    /* Three, not four: the "it is happening now" case is already carried by
     * the date line underneath ("Mon 10:00 AM · now") and by the chip, and a
     * kicker that repeated it put the same three words twice on one screen. */
    const dirWord =
      dash.stage === 'just-passed' || dash.stage === 'past' ? 'Closest it came'
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
        ${windNoteHtml(dash)}
      </div>`;
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
    if (co?.ok && co.worst && dash.stage !== 'wind-here') return '';
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
    if (!co?.ok) {
      /* Absent radii is normal for a weak or distant storm and is NOT a
       * failure — it must not read like one. */
      return co?.unavailable === 'no-radii'
        ? `<p class="detail-soft" style="margin-top:var(--space-snug)">
             This advisory doesn’t say how big the wind field is, so nobody can
             tell you whether it reaches you.</p>`
        : '';
    }

    const kt = co.worst;
    if (!kt) {
      return `<p class="home-band">On this forecast <b>no tropical-storm wind reaches
        you</b>. The nearest edge stays ${esc(
          formatDistance(co.forecast[34]?.closestGapNm ?? 0, sys())
        )} off.</p>`;
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
    const onYou = dash.stage === 'wind-here';
    return `<p class="home-band">
      ${onYou
        ? /* ==> THE PHRASE, NOT THE CLAUSE. <== The clause carries its own
           * preposition, and the zero-length case carries a whole sentence
           * instead of a duration — splicing either into "lasting …" produced
           * "lasting and the forecast stops before saying for how long from
           * 10:00 PM". When there is no length to give, the sentence ends and
           * a second one says why. */
          `<b>${esc(WIND_LABEL[kt] || kt + ' kt')} wind is on your house now</b>${
            windDurationPhrase(hrs, c.openEnded)
              ? `, and the forecast has it lasting ${esc(
                  windDurationPhrase(hrs, c.openEnded)
                )} from when it arrived at ${esc(formatClockDay(start))}.`
              : `. It arrived at ${esc(formatClockDay(start))}, and the forecast
                 stops before saying how long it lasts.`
          }`
        : `<b>${esc(WIND_LABEL[kt] || kt + ' kt')} wind reaches you</b>
           ${esc(windDurationClause(hrs, c.openEnded))},
           starting ${esc(formatClockDay(start))}.`}
      ${earlyGap >= 2 && !onYou
        ? `If the track runs toward you it could start as early as
           <b class="home-band-hit">${esc(formatClockDay(early))}</b>.`
        : ''}
    </p>`;
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
    if (dash.atClosest?.windKt != null && !dash.far) {
      const past = dash.stage === 'past' || dash.stage === 'just-passed';
      cells.push({
        k: past ? 'When it was closest' : 'When it’s closest',
        v: formatWind(dash.atClosest.windKt, sys()),
        s: categoryShortLabel(dash.atClosest.category, nature),
        color: categoryColor(dash.atClosest.category, nature),
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
      cells.push({
        k: 'Strongest',
        v: formatWind(dash.peak.windKt, sys()),
        /* `peakWhen` can be 'at' (the peak lands on the pass) or null (nobody
         * published a time for one of them), and both used to fall through to
         * "before the pass" — wrong about the first, an invention about the
         * second. */
        s:
          dash.peakWhen === 'after' ? 'after it passes'
          : dash.peakWhen === 'at' ? 'right as it passes'
            : dash.peakWhen === 'before' ? 'before it reaches you'
              : 'time not given',
      });
    }

    /* ==> "IT WEAKENS ON THE WAY IN" IS ABOUT A JOURNEY THAT IS NOT HAPPENING.
     * <== The comparison behind it is the current wind against the wind at the
     * closest pass, which for a far storm means "over the next four days,
     * while travelling in the opposite direction, it gets weaker". True, and
     * about somebody else's house. */
    const trendLine = dash.far
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
        <div class="home-figs" style="--figs-n:${cells.length}">
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

  /**
   * WHICH WAY IT IS GOING, RELATIVE TO THIS HOUSE — and the honest sentence
   * when we cannot put it that way.
   *
   * ==> THE OLD FALLBACK ASSERTED IGNORANCE THE APP DID NOT HAVE. <== One
   * caller printed "nobody publishes which way it's headed" whenever
   * `motionTrend` came back null. That helper goes null for FIVE different
   * reasons and only one of them is a missing heading: no heading, zero speed,
   * farther out than APPROACH.relevanceNm, movement inside the
   * APPROACH.minGainNm deadband, or a missing position. Caught on glass
   * 2026-08-11 on PEILOU-26 — the timeline swore nobody published a heading
   * while the vitals block two inches below read "Moving ENE at 17 mph".
   *
   * So the reasons are separated here and each gets its own words. The
   * distance and stationary cases are cheap to re-derive from the same fields
   * `motionTrend` reads; the deadband case is not, and falls through to a
   * sentence that is true whichever of the two it is.
   */
  /** The storm's direction of travel for this screen, published or derived,
   *  in ONE place because the sentence below and the arrow beside it both ask
   *  and must never disagree. `dash.curve` is the forecast track the chart is
   *  already drawing, so this costs nothing extra. */
  function headingOf(dash) {
    return motionHeading(dash.storm, dash.curve);
  }

  function motionDetail(dash) {
    const s = dash.storm;
    const head = headingOf(dash);

    /* THE PUBLISHED SENTENCE IS UNCHANGED and still quotes the advisory. */
    const moving =
      Number.isFinite(s.headingDeg) && Number.isFinite(s.speedKt) && s.speedKt > 0
        ? `Moving ${formatBearing(s.headingDeg)} at ${formatSpeed(s.speedKt, sys())}`
        /* ==> THE DERIVED ONE IS A DIFFERENT CLAIM AND GETS DIFFERENT WORDS.
         * <== "Moving NW" would read as a quote from a bulletin nobody wrote:
         * GDACS publishes no motion, and this bearing comes from the shape of
         * the forecast track. Naming the track is what keeps the two apart —
         * and there is no speed, because dividing a chord by its forecast
         * hours would put an invented number on a safety screen. */
        : head?.derived
          ? `Its forecast track runs ${formatBearing(head.deg)}`
          : null;

    /* ==> THE ADVISORY'S MOTION AND ITS MEANING FOR THIS HOUSE, IN ONE LINE.
     * <== These were two facts in two blocks: "Moving ENE at 17 mph" sat in a
     * vitals list at the bottom of the screen, and "getting closer" sat under
     * the distance at the top. A reader had to hold one in their head to make
     * sense of the other, and the vitals block existed largely to carry it.
     * Joined, they are one sentence that answers the question either half was
     * only gesturing at. The vitals section went with the merge (glass,
     * 2026-08-11). */
    const meaning = (() => {
      if (dash.trend === 'closing') return 'getting closer';
      if (dash.trend === 'receding') return 'moving away';

      if (!moving) {
        /* NO SENTENCE ABOUT MOTION AT ALL REACHES HERE ANY MORE UNLESS THERE
         * GENUINELY IS NONE. `head` is null only when the agency published no
         * heading AND the forecast track has not landed or is too short to
         * define one — so this really is the app knowing nothing, which is
         * what the words claim. Before the track fallback existed, this fired
         * for every GDACS storm whose panel was drawing a forecast two inches
         * below the sentence denying one. */
        return Number.isFinite(s.headingDeg) && Number.isFinite(s.speedKt)
          ? 'barely moving'
          : 'nobody publishes which way it’s headed';
      }

      /* ==> A DERIVED HEADING CANNOT SUPPORT THE BROADSIDE SENTENCE. <== The
       * two cases below are conclusions from `motionTrend`, which is dead
       * reckoning off a PUBLISHED heading and speed and returns null without
       * both. On a storm whose direction came from the track shape there is no
       * speed to reckon with, so "neither closer nor farther" would be a
       * finding nothing computed. The track's own answer is on this screen
       * already — the closest-pass block — and this line stops at the
       * direction rather than inventing a verdict to sit beside it. */
      if (head?.derived) return 'from the forecast so far';

      if (dash.distance && dash.distance.nm > APPROACH.relevanceNm) {
        return 'far too distant for that to point at you';
      }
      return 'near enough broadside that it is getting neither closer nor farther';
    })();

    return moving ? `${moving}, ${meaning}` : meaning;
  }

  /**
   * The countdown. ALSO THE ACCESSIBLE FORM OF THE CHART — a screen reader
   * cannot explore an SVG, and a keyboard user cannot hover a ribbon, so
   * everything the picture shows is stated here in words. That is a
   * requirement of the plan, not a courtesy, and it is why this section is
   * never collapsed by default.
   */
  function countdownHtml(dash) {
    const rows = [];
    /* THE DASHBOARD'S OWN CLOCK, not the wall clock. Every lead time here is
     * relative to the instant the figures were computed for, and reading
     * Date.now() instead would let the two disagree by however long the
     * render took — invisible in production and the reason this whole screen
     * could not be tested against the one complete advisory we have. */
    const clock = dash.now;

    if (dash.distance) {
      rows.push({
        at: clock,
        key: 'now',
        lead: 'now',
        ev: `${dash.storm.name} is ${formatDistance(dash.distance.nm, sys())} ${formatBearing(dash.distance.bearing)} of you`,
        /* SAME SENTENCE AS THE STRIP, from the same helper. This row used to
         * carry its own inline fallback and it was the one that shipped the
         * false "nobody publishes which way it's headed". */
        det: motionDetail(dash),
      });
    }

    /* ==> THE WIND ROWS SUPERSEDE THE RING ROWS WHEN THEY EXIST. <== The
     * 100-mile ring was always a stand-in for "when do I feel it", built
     * because the app could answer it from a track alone. The corridor
     * answers the real question, so showing both would be the proxy arguing
     * with the measurement in the same list. */
    const co = dash.corridor;
    const worst = co?.ok ? co.worst : null;
    if (worst) {
      const c = co.forecast[worst];
      const early = co.earliest?.[worst]?.windows?.[0]?.[0];
      const start = c.windows[0]?.[0];
      const gap = early && start ? (Date.parse(start) - Date.parse(early)) / 3_600_000 : 0;
      if (gap >= 2) {
        rows.push({
          at: Date.parse(early),
          tone: windColor(worst),
          key: 'early',
          lead: formatUntil(early, clock) || '',
          ev: 'Wind could start this early',
          det: `${formatClockDay(early)} · if the track runs toward you`,
        });
      }
      rows.push({
        at: Date.parse(start),
        tone: windColor(worst),
        key: 'true',
        lead: formatUntil(start, clock) || '',
        ev: `${WIND_LABEL[worst] || worst + ' kt'} wind reaches you`,
        det: formatClockDay(start) || '',
      });
      const end = c.windows[c.windows.length - 1]?.[1];
      /* ==> A WINDOW WITH NO LENGTH GETS NO ENDING ROW. <== When a storm
       * publishes radii at one hour only and the house is already inside them,
       * the window opens and closes at the same instant. Left alone the rail
       * printed "winds reach you" and "winds last at least this long" as two
       * rows at the same minute, the second of them stating no duration at
       * all. The arrival is the fact; the ending is not known. */
      if (end && Date.parse(end) > Date.parse(start)) {
        rows.push({
          at: Date.parse(end),
          tone: windColor(worst),
          key: '',
          lead: formatUntil(end, clock) || '',
          /* See windLineHtml: an open-ended window's end time is the last
           * hour NHC published this field for, not the hour it stops. */
          /* "Winds last at least this long" was a caption for a diagram, on
            * the row about the most dangerous stretch of the day. */
          ev: c.openEnded ? 'The forecast stops here, with wind still on you' : 'The wind eases',
          det: `${formatClockDay(end)} · ${
            windDurationPhrase(c.totalHours, c.openEnded) || 'how long, the forecast doesn’t say'
          } in all`,
        });
      }
    }

    const ring = dash.nearRing;
    if (!worst && ring?.everInside && ring.enter) {
      rows.push({
        at: Date.parse(ring.enter),
        key: '',
        lead: formatUntil(ring.enter, clock) || '',
        ev: `Comes within ${formatDistance(ring.ringNm, sys())} of you`,
        det: formatClockDay(ring.enter) || '',
      });
    } else if (!worst && ring && !ring.everInside) {
      rows.push({
        at: null,
        key: '',
        lead: '—',
        ev: `Never comes within ${formatDistance(ring.ringNm, sys())} of you`,
        det: 'on the current forecast',
      });
    }

    if (dash.approach?.relevant && dash.approach.time) {
      const kt = dash.atClosest?.windKt;
      rows.push({
        /* ==> THE PASS TAKES THE STORM'S OWN COLOUR AT THAT MOMENT. <== Not
         * the wind threshold — this row is about the centre, not about what
         * reaches the house, and a Cat 4 arriving is a different fact from
         * hurricane-force wind arriving. `categoryColor` returns the generic
         * hue for a storm with no earned category, so a post-tropical low
         * cannot borrow a Saffir-Simpson colour it never had (§6). */
        at: Date.parse(dash.approach.time),
        tone: categoryColor(dash.atClosest?.category, dash.storm.nature),
        key: 'true',
        lead: formatUntil(dash.approach.time, clock) || '',
        ev: `Closest pass — ${formatDistance(dash.approach.nm, sys())} ${formatBearing(dash.approach.bearing)} of you`,
        det: [
          formatClockDay(dash.approach.time),
          /* NOT lower-cased. `categoryShortLabel` returns "TS" and "Cat 3" —
           * acronyms, not sentence fragments — and "50 mph, ts" reads as a
           * typo rather than as a classification. */
          kt != null
            ? `${formatWind(kt, sys())} · ${categoryShortLabel(dash.atClosest.category, dash.storm.nature)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }

    if (!worst && ring?.exit) {
      rows.push({
        at: Date.parse(ring.exit),
        key: '',
        lead: formatUntil(ring.exit, clock) || '',
        ev: `Back beyond ${formatDistance(ring.ringNm, sys())}`,
        det: formatClockDay(ring.exit) || '',
      });
    }

    /* ==> PHASE B IS SHOWN AS A GAP, NOT HIDDEN. <== Winds-at-home needs the
     * per-forecast-hour wind radii walked against the house, and that is held
     * until a storm is near enough to tell a right answer from a plausible
     * one. Naming the gap is honest; silently omitting the two rows a reader
     * most wants would let the countdown imply the wind arrives at the pass,
     * which it does not — it arrives hours earlier. */
    /* ==> WHAT IS STILL HELD, AND IT IS NO LONGER THE WIND TIMING. <== The
     * corridor answers arrival and duration now. What it cannot answer is
     * whether this specific address sits inside a warned zone: NHC names the
     * zones and publishes their outlines only as live geometry (layer 8),
     * which no archived storm can supply. Named rather than omitted, because
     * a list that shows a warning and says nothing about the address invites
     * the reader to assume it was checked. */
    if (dash.storm.can?.watchWarning) {
      rows.push({
        at: null,
        key: 'held',
        lead: '—',
        ev: 'Whether your address is inside the warned zone',
        det: 'not built yet — NHC names the zones, not their outlines',
      });
    }

    if (rows.length <= 1) return '';

    /* ==> A COUNTDOWN THAT GOES BACKWARDS IS NOT A COUNTDOWN. <== The rows are
     * pushed in the order the sections above are written, and that order is
     * only ever chronological by luck. On Ida it read 12 hrs, 16 hrs, 21 hrs,
     * 18 hrs — the wind outlasts the closest pass, so "winds last at least
     * this long" landed above "closest pass". Bertha did the same thing and
     * nobody caught it, because nobody read the list against a clock.
     *
     * THIS IS THE SURFACE A SCREEN READER HAS INSTEAD OF THE CHART, so a
     * scrambled order is not cosmetic here — it is the whole sequence of
     * events arriving in the wrong sequence.
     *
     * Rows with no time are the two Phase-B gaps and the "never comes inside"
     * line. They are not events, so they sink to the bottom rather than being
     * sorted among things that happen. The sort is stable, so rows sharing a
     * moment keep the order they were written in. */
    rows.sort((a, b) => {
      if (a.at == null && b.at == null) return 0;
      if (a.at == null) return 1;
      if (b.at == null) return -1;
      return a.at - b.at;
    });

    return `
      <div class="home-sect">
        ${sectHead('clock', 'Timeline')}
        <ul class="home-rail">
          ${rows
            .map(
              (r) => `<li data-key="${esc(r.key || 'false')}"${
                r.tone ? ` style="--rail-dot:${esc(r.tone)}"` : ''
              }>
                <div class="home-rail-lead">${esc(r.lead)}</div>
                <div class="home-rail-ev">${esc(r.ev)}</div>
                <div class="home-rail-det">${esc(r.det)}</div>
              </li>`
            )
            .join('')}
        </ul>
      </div>`;
  }

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

    onEnter() {
      visible = true;
      render();
    },

    onLeave() {
      visible = false;
    },

    /** The Edit-home control is the first stop. It is the only thing on this
     *  screen that DOES something, and a keyboard user landing on a wall of
     *  read-only figures has nowhere to go.
     *
     *  UNLESS A CHEVRON WAS JUST PRESSED. Stepping does not re-enter this view
     *  the way it re-enters the detail panel, so this is belt and braces — but
     *  the two panels share the stepper, and a focus contract that holds on one
     *  surface and not the other is exactly the divergence extracting the
     *  component was meant to end. */
    focus() {
      return stepper?.takeFocus() || host?.querySelector('[data-act="edit-home"]') || null;
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
