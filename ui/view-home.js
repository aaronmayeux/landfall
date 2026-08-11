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
import { getHome } from '../data/home.js';
import { pickThreatStorm, buildHomeDashboard } from '../data/home-dashboard.js';
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
  }

  const body = () => host?.querySelector('.home-dash');

  /* --- the threat pick, and warming its geometry -------------------------- */

  function currentThreat() {
    const home = getHome();
    if (!home || !lastState) return null;
    return pickThreatStorm(lastState.storms, home);
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
   * ==> A STORM THAT NEVER COMES NEAR GETS THE SHORT SCREEN. <==
   *
   * Measured on glass 2026-08-10, FIFTEEN-26 at 6,272 miles: the dashboard told
   * the reader it was not a threat FIVE separate times on one phone screen —
   * the "Not near you" chip, "On this forecast it never comes near you", an
   * "At the pass" column reporting a pass the same screen had just said never
   * happens, "It holds its strength all the way in" about something that never
   * comes in, and a countdown row reading "Never comes within 100 mi of you".
   * The distance was printed three times and the wind three times.
   *
   * None of that was a bug in any one section. Every section was running its
   * landfall template because nothing above them asked whether there was a
   * landfall. `approach.relevant === false` is the app already knowing the
   * answer — `closestApproach` computes it and `stage` is already 'far-off' —
   * so the three sections that only make sense about an approach are simply not
   * built.
   *
   * WHAT SURVIVES, AND WHY IT IS ENOUGH: the chip, the distance, one sentence,
   * the storm's own vitals, and the advisory stamp inside them. That is the
   * whole honest content — where it is, that it is not coming, what it is doing,
   * and how old that is. Nothing is hidden behind a control: everything cut was
   * a restatement of a fact still on screen, which is the ONLY thing §5 permits
   * cutting. The moment the storm crosses back inside APPROACH.relevanceNm the
   * full dashboard returns on the next poll, with no state to remember.
   *
   * `chartSectHtml` would have returned '' here anyway (ui/chart-home.js draws
   * nothing without a relevant approach). It is listed in the cut rather than
   * left to that, because a screen whose shape depends on another file quietly
   * agreeing is a screen that changes when that file is retuned.
   */
  function dashboardHtml(dash, threat, home) {
    const s = dash.storm;
    const sw = stormSwatch(s);
    const chip = chipHtml(dash, threat);
    const farOff = dash.approach?.relevant === false;

    return [
      `<div class="home-sect">
         <div class="home-threat">
           <span class="home-swatch" style="--sw: ${esc(sw)}"></span>
           <button class="home-threat-name home-threat-link" type="button"
                   data-act="open-storm" data-storm-id="${esc(s.id)}">${esc(s.name)}</button>
           ${chip}
         </div>
         ${headlineHtml(dash)}
       </div>`,
      farOff ? '' : chartSectHtml(dash),
      farOff ? '' : figuresHtml(dash),
      farOff ? '' : countdownHtml(dash),
      vitalsHtml(dash),
      homeRowHtml(home),
    ].join('');
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

  function figuresHtml(dash) {
    const cells = [];

    if (dash.atClosest?.windKt != null) {
      const kt = dash.atClosest.windKt;
      cells.push({
        k: 'At the pass',
        v: formatWind(kt, sys()),
        s: categoryShortLabel(dash.atClosest.category, dash.storm.nature),
        color: categoryColor(dash.atClosest.category, dash.storm.nature),
      });
    }

    if (dash.distance) {
      cells.push({
        k: 'Right now',
        v: formatDistance(dash.distance.nm, sys()),
        s: `${formatBearing(dash.distance.bearing)}${dash.trend ? ` · ${dash.trend}` : ''}`,
      });
    }

    if (dash.peak) {
      cells.push({
        k: 'At its worst',
        v: formatWind(dash.peak.windKt, sys()),
        /* ==> FIVE FACTS, NOT THREE. <== `peakWhen` can be 'at' (the peak
         * lands on the pass) or null (nobody published a time for one of
         * them), and both used to fall through to "before the pass" — which
         * is wrong about the first and an invention about the second. */
        s:
          dash.peak.when === 'now' ? 'that’s now'
          : dash.peakWhen === 'after' ? 'after it passes'
            : dash.peakWhen === 'at' ? 'right at the pass'
              : dash.peakWhen === 'before' ? 'before it reaches you'
                : 'time not given',
      });
    }

    if (!cells.length) return '';

    const trendLine =
      dash.arrivalTrend === 'weakening'
        ? 'It weakens on the way in.'
        : dash.arrivalTrend === 'strengthening'
          ? 'It’s still strengthening when it gets to you.'
          : dash.arrivalTrend === 'steady'
            ? 'It holds its strength all the way in.'
            : '';

    return `
      <div class="home-sect">
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
        ${trendLine ? `<p class="detail-soft home-trendline">${esc(trendLine)}</p>` : ''}
      </div>`;
  }

  /**
   * ONE SENTENCE PER REASON THERE IS NO TREND WORD (`data/home.js`).
   *
   * ==> THIS TABLE EXISTS BECAUSE THE SCREEN CALLED NHC A LIAR. <== Every one
   * of these used to be "nobody publishes which way it's headed". On a storm
   * 6,272 miles out — where the real reason is `too-far`, the question simply
   * not meaning anything at that range — the countdown said no heading was
   * published while the vitals block four inches below printed "Moving W at
   * 5 mph" off the same advisory. Two true-looking lines from one object,
   * contradicting each other on screen, which is §5's failure wearing a
   * sentence instead of a blank.
   *
   * `too-far` and `no-home` map to the EMPTY STRING, not to a sentence. There
   * is nothing to explain: the rail's own row already gives the distance, and a
   * gloss saying "it's very far away" under "6,300 mi WNW of you" is the
   * repetition this whole pass is cutting. A missing detail line is not a
   * silence in §5's sense — the fact above it is complete.
   */
  const TREND_GAP = Object.freeze({
    'no-home': '',
    'no-position': 'its position this hour is not published',
    'no-motion': 'nobody publishes which way it’s headed',
    stationary: 'and it is not moving',
    'too-far': '',
    broadside: 'and neither closing nor pulling away',
  });

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
        det: dash.trend ? `and ${dash.trend}` : TREND_GAP[dash.trendUnavailable] || '',
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

  function vitalsHtml(dash) {
    const s = dash.storm;
    const rows = [];
    if (Number.isFinite(s.windKt)) rows.push(['Winds', formatWind(s.windKt, sys())]);
    if (Number.isFinite(s.pressureMb)) rows.push(['Pressure', formatPressure(s.pressureMb)]);
    if (Number.isFinite(s.headingDeg) && Number.isFinite(s.speedKt)) {
      rows.push(['Moving', `${formatBearing(s.headingDeg)} at ${formatSpeed(s.speedKt, sys())}`]);
    }

    /* THE STAMP IS NOT OPTIONAL AND NOT A FOOTNOTE. Every figure above was
     * derived from one advisory, and its age changes what all of them mean. */
    const age = formatAge(dash.observedAt, now());
    const stamp = age ? `Advisory ${age}` : 'Advisory time unknown';

    return `
      <div class="home-sect">
        <div class="home-kicker">${esc(s.name)} right now</div>
        ${
          rows.length
            ? `<dl class="detail-vitals home-vitals">${rows
                .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
                .join('')}</dl>`
            : '<p class="detail-soft">No current vitals published.</p>'
        }
        <p class="home-stamp">${esc(stamp)}</p>
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
