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
  units, onEditHome, onOpenStorm, warmGeometry, now = () => Date.now(),
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

  const sys = () => units();

  /* ---------------------------------------------------------------------- */

  function mount(hostEl) {
    host = hostEl;
    host.innerHTML = '<div class="drawer-body home-dash"></div>';
    host.addEventListener('click', onClick);
    render();
  }

  function onClick(e) {
    const act = e.target.closest?.('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'edit-home') onEditHome?.();
    if (act.dataset.act === 'open-storm') {
      const id = act.dataset.stormId;
      const s = lastState?.storms?.find((x) => x.id === id);
      if (s) onOpenStorm?.(s);
    }
    /* THE SWITCHER STAYS IN THIS DRAWER. Tapping a chip re-aims the dashboard
     * at that storm; it deliberately does NOT open the storm's own detail
     * panel, which is what the name at the top does. Two controls, two
     * destinations — "show me this one against my house" and "tell me about
     * this one" are different questions. */
    if (act.dataset.act === 'pick-storm') {
      pickedId = act.dataset.stormId || null;
      render();
    }
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
    if (!home) return void (el.innerHTML = noHomeHtml());
    if (!lastState) return void (el.innerHTML = loadingHtml('Checking the oceans…'));

    const threat = currentThreat();

    if (!threat) {
      el.innerHTML = quietHtml(lastState, home);
      return;
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

    el.innerHTML = dashboardHtml(dash, threat, home);
  }

  /* ---------------------------------------------------------------------- */

  /**
   * The address, and the way to change it.
   *
   * ==> IT LEADS THE SCREEN NOW; IT USED TO END IT. <== This is the only
   * control on the dashboard that DOES anything, and it sat below the chart,
   * the figures, the countdown and the vitals — so the answer to "how do I fix
   * my home location" was a scroll past everything the location was used for.
   * Aaron's call on glass 2026-08-11. First row of the body, directly under
   * the drawer's own title.
   *
   * NOT IN THE TITLE BAR. That bar is shared by every drawer and the storm
   * detail view already uses it for identity; putting a per-view control in it
   * means touching all of them to serve one. First row of the body reads as
   * "this screen is about here" without any of that.
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
      return homeRowHtml(home) + loadingHtml('Checking the oceans for anything headed your way…');
    }

    if (down.length) {
      const who = down.join(' and ');
      const other = down.length === 1 ? (down[0] === 'NHC' ? 'GDACS' : 'NHC') : null;
      return `
        ${homeRowHtml(home)}
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
        </div>`;
    }

    /* Genuinely quiet. Ended storms are excluded from the threat pick, so a
     * grey dot on the globe can still be the only thing out there — say so
     * rather than an all-clear that the globe visibly contradicts. */
    const live = (state.storms || []).filter((s) => !isEnded(s));
    return `
      ${homeRowHtml(home)}
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
      </div>`;
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
    const s = dash.storm;
    const sw = stormSwatch(s);
    const chip = chipHtml(dash, threat);

    const head = `<div class="home-sect">
         <div class="home-threat">
           <span class="home-swatch" style="--sw: ${esc(sw)}"></span>
           <button class="home-threat-name home-threat-link" type="button"
                   data-act="open-storm" data-storm-id="${esc(s.id)}">${esc(s.name)}</button>
           ${chip}
         </div>
         ${dash.far ? farLedeHtml(dash) : headlineHtml(dash)}
       </div>`;

    return [
      homeRowHtml(home),
      switcherHtml(dash, threat),
      head,
      dash.far ? '' : chartSectHtml(dash),
      figuresHtml(dash),
      dash.far ? '' : countdownHtml(dash),
      vitalsHtml(dash),
    ].join('');
  }

  /**
   * The far storm's whole story, in two sentences.
   *
   * ==> IT DOES NOT REASSURE, BECAUSE THERE IS NOTHING TO REASSURE ABOUT. <==
   * The near layout's equivalent said "On this forecast it never comes near
   * you", which is phrased as the outcome of a considered question — and about
   * a cyclone 6,363 miles away, being told it will not reach you reads as the
   * app having seriously weighed the possibility. The countdown made it worse
   * with "Never comes within 100 mi of you", measuring a Philippine Sea storm
   * against a ring drawn round a house in Louisiana.
   *
   * So this states the geography and stops. The basin is named because that is
   * the fact that actually explains the distance — "6,363 mi WNW" is a number,
   * "the Northwest Pacific" is a place — and a reader who knows where that is
   * needs no further sentence about whether it can reach them.
   */
  function farLedeHtml(dash) {
    const d = dash.distance;
    const where = BASIN_LABEL[dash.storm.basin] || null;
    return `
      <div class="home-headline">
        <div class="home-big">${d ? esc(formatDistance(d.nm, sys())) : '—'}
          <small>${d ? esc(formatBearing(d.bearing)) + ' of home' : ''}</small></div>
        <p class="detail-soft">${
          where
            ? `It is in the ${esc(where)}, far outside anything that could reach you.`
            : 'It is far outside anything that could reach you.'
        } Nothing on its track brings it near.</p>
      </div>`;
  }

  /**
   * The storm switcher: every storm in the ranking, as a row of chips.
   *
   * ==> IT EXISTS BECAUSE THE DRAWER ONLY EVER SHOWED ONE STORM. <== The pick
   * is automatic and usually right, but "what about that other one" had no
   * answer short of opening the storm list, tapping a storm, and losing every
   * figure that was about your house. Aaron's ask, 2026-08-11.
   *
   * ORDERED BY THE SAME RANKING THAT MADE THE PICK, so the leftmost chip is
   * always the storm the drawer opens on and a reader who taps around can get
   * back to it without guessing which one it was.
   *
   * ONE CHIP IS NO CHOICE. With a single storm in the running the row is a
   * control that cannot do anything, so it is not drawn.
   *
   * KEYBOARD COMES FREE and that is why these are buttons in a plain scroller
   * rather than a custom control: Tab reaches every chip, Enter picks it,
   * `aria-pressed` says which one is current. A gesture-only switcher would be
   * a feature that does not exist for keyboard users (§16).
   */
  function switcherHtml(dash, threat) {
    const all = threat?.ranked || [];
    if (all.length < 2) return '';
    const currentId = dash.storm.id;

    return `
      <div class="home-sect home-switch-wrap">
        <div class="home-switch" role="group" aria-label="Which storm to show against your home">
          ${all
            .map((s) => {
              const on = s.id === currentId;
              return `<button class="home-switch-chip" type="button"
                        data-act="pick-storm" data-storm-id="${esc(s.id)}"
                        aria-pressed="${on ? 'true' : 'false'}"
                        style="--sw: ${esc(stormSwatch(s))}">
                  <span class="home-switch-dot" aria-hidden="true"></span>${esc(s.name)}
                </button>`;
            })
            .join('')}
        </div>
      </div>`;
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

    const band = dash.band
      ? `<p class="home-band">Two out of three past NHC forecasts were within
           <b>${esc(formatDistance(dash.band.nm, sys()))}</b> of where they said.${
             dash.band.reachesHome
               ? ' <b class="home-band-hit">That circle covers your house.</b>'
               : ` That circle stops ${esc(
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
        <div class="home-kicker">${dirWord}</div>
        <div class="home-big">${esc(formatDistance(a.nm, sys()))}
          <small>${esc(formatBearing(a.bearing))} of home</small></div>
        ${when ? `<div class="home-when">${when}</div>` : ''}
        ${band}
        ${windLineHtml(dash)}
      </div>`;
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

    /* WHERE IT IS — its own line, full width, with a label that says what it
     * is. A distance does not belong in a row of winds, and this is the only
     * number on the screen a reader can put against the map. */
    const whereRow = dash.distance
      ? `<div class="home-where">
           <div class="home-figs-k">Where it is</div>
           <div class="home-where-v">${esc(
             formatDistance(dash.distance.nm, sys())
           )} <span class="home-where-dir">${esc(
             formatBearing(dash.distance.bearing)
           )} of you</span></div>
           <div class="home-figs-s">${esc(motionDetail(dash))}</div>
         </div>`
      : '';

    if (!cells.length && !whereRow) return '';

    /* THE AGE RIDES ON THE HEADING. Every figure below came from one advisory
     * and its age changes what all of them mean (§8). The only stamp on this
     * screen used to sit at the bottom of vitals, two sections down and past
     * a chart — so the most-read numbers on the page carried no clock at all
     * until the reader had scrolled past them.
     *
     * ==> IT CANNOT RIDE ON A HEADING THAT DID NOT RENDER. <== With no wind
     * published there are no strength cells and therefore no "How strong"
     * line to hang it on, and the whole screen would then carry no clock —
     * which is the §8 failure, not a tidy edge case. It falls back to its own
     * line under the where row. */
    const age = formatAge(dash.observedAt, now());
    const stamp = age ? `Advisory ${age}` : 'Advisory time unknown';

    return `
      <div class="home-sect">
        ${cells.length
          ? `<div class="home-kicker">How strong${
              age ? ` <span class="home-kicker-age">· advisory ${esc(age)}</span>` : ''
            }</div>
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
             </div>`
          : ''}
        ${peakNote ? `<p class="detail-soft home-trendline">${esc(peakNote)}</p>` : ''}
        ${trendLine ? `<p class="detail-soft home-trendline">${esc(trendLine)}</p>` : ''}
        ${whereRow}
        ${cells.length ? '' : `<p class="home-stamp">${esc(stamp)}</p>`}
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
  function motionDetail(dash) {
    const s = dash.storm;
    if (dash.trend === 'closing') return 'getting closer';
    if (dash.trend === 'receding') return 'moving away';

    if (!Number.isFinite(s.headingDeg) || !Number.isFinite(s.speedKt)) {
      return 'nobody publishes which way it’s headed';
    }
    if (s.speedKt <= 0) return 'barely moving';

    const dir = formatBearing(s.headingDeg);
    if (dash.distance && dash.distance.nm > APPROACH.relevanceNm) {
      return `heading ${dir} — far too distant for that to point at you`;
    }
    return `heading ${dir} — near enough broadside that it is getting neither closer nor farther`;
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
        <div class="home-kicker">How it unfolds</div>
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

  /**
   * The rest of the advisory's readings.
   *
   * ==> `Winds` IS NOT HERE ANY MORE, AND ITS ABSENCE IS THE POINT. <== The
   * current wind is the anchor cell of the strength strip above, and printing
   * it again under a heading that also says "right now" put one number on one
   * screen twice — seen on glass 2026-08-11, "At its worst 35 mph · that's
   * now" over "Winds 35 mph". The strip could not give it up (without a now to
   * measure against, the other two intensities compare to nothing), so this
   * block did. What is left is exactly what the strip does not carry.
   */
  function vitalsHtml(dash) {
    const s = dash.storm;
    const rows = [];
    if (Number.isFinite(s.pressureMb)) rows.push(['Pressure', formatPressure(s.pressureMb)]);
    if (Number.isFinite(s.headingDeg) && Number.isFinite(s.speedKt)) {
      rows.push(['Moving', `${formatBearing(s.headingDeg)} at ${formatSpeed(s.speedKt, sys())}`]);
    }

    /* ==> NOTHING LEFT TO SAY MEANS SAY NOTHING. <== With the wind gone this
     * block can be genuinely empty — a storm published with a wind and no
     * pressure or motion is ordinary — and an empty section captioned "right
     * now" over the words "no current vitals published" would read as a
     * failure directly beneath a strip full of live figures. The strip carries
     * the stamp for the whole screen now, so nothing is lost by dropping the
     * section entirely. */
    if (!rows.length) return '';

    /* THE STAMP MOVED UP, to the strength strip, and is not repeated here.
     * Every figure on this screen comes from one advisory, so the screen needs
     * one clock, and it belongs on the first block of numbers a reader meets
     * rather than on the last. */
    return `
      <div class="home-sect">
        <div class="home-kicker">${esc(s.name)} right now</div>
        <dl class="detail-vitals home-vitals">${rows
          .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
          .join('')}</dl>
      </div>`;
  }

  /* --- the drawer view contract ------------------------------------------- */

  return {
    id: 'home',
    title: 'Home',

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
     *  read-only figures has nowhere to go. */
    focus() {
      return host?.querySelector('[data-act="edit-home"]') || null;
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
