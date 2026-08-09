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
import { WIND_LABEL } from '../lib/wind.js';

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
        <p class="detail-soft">Distance, closest pass, how strong it is when it gets
          there, and how long you have. Your coordinates never leave this device.</p>
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
      return loadingHtml('Checking the oceans…') + homeRowHtml(home);
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
                 but it does not cover every ocean in the same detail.</p>`
            : '<p class="detail-soft">Both sources are unreachable.</p>'}
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
        <p class="home-lede home-lede--tight">No storm is closing on your home.</p>
        <p class="detail-soft">${
          live.length
            ? `${live.length} ${live.length === 1 ? 'cyclone is' : 'cyclones are'} active worldwide,
               none of them near you.`
            : 'No tropical cyclones are active anywhere right now.'
        }</p>
      </div>
      ${homeRowHtml(home)}`;
  }

  /* --- the dashboard proper ----------------------------------------------- */

  function dashboardHtml(dash, threat, home) {
    const s = dash.storm;
    const sw = stormSwatch(s);
    const chip =
      threat.why === 'closing'
        ? '<span class="home-chip">Bearing down</span>'
        : '<span class="home-chip" data-tone="calm">Nearest</span>';

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
      chartSectHtml(dash),
      figuresHtml(dash),
      countdownHtml(dash),
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
          ? 'This source doesn’t publish a forecast track, so there is no closest pass to give you.'
          : geo.state === 'error'
            ? 'The forecast track didn’t load. The distance above is still current.'
            : 'Loading the forecast track…';
      return `
        <div class="home-headline">
          <div class="home-big">${d ? esc(formatDistance(d.nm, sys())) : '—'}
            <small>${d ? esc(formatBearing(d.bearing)) + ' of home' : ''}</small></div>
          <p class="detail-soft">${esc(why)}</p>
        </div>`;
    }

    const a = dash.approach;
    const dirWord = a.trend === 'receding' ? 'Nearest point' : 'Closest pass';

    /* A STORM THAT NEVER COMES NEAR GETS A DIFFERENT SENTENCE, not a quieter
     * version of the same one. `relevant` and `trend` are orthogonal and the
     * pair produces three true statements — the detail panel makes the same
     * three, for the same reason. */
    if (!a.relevant) {
      return `
        <div class="home-headline">
          <div class="home-big">${esc(formatDistance(dash.distance.nm, sys()))}
            <small>${esc(formatBearing(dash.distance.bearing))} of home</small></div>
          <p class="detail-soft">Never comes near your home.</p>
        </div>`;
    }

    const when = a.time
      ? `${esc(formatClockDay(a.time))}${formatUntil(a.time, now()) ? ` · ${esc(formatUntil(a.time, now()))}` : ''}`
      : '';

    const band = dash.band
      ? `<p class="home-band">Two-thirds of past NHC forecasts landed within
           <b>${esc(formatDistance(dash.band.nm, sys()))}</b> of that.${
             dash.band.reachesHome
               ? ' <b class="home-band-hit">Your home is inside that band.</b>'
               : ''
           }</p>`
      : dash.bandUnavailable === 'no-published-error-table'
        ? `<p class="detail-soft">No forecast-error figures are published for this ocean,
             so there is no confidence band to show.</p>`
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
             This advisory publishes no wind-field sizes, so there is no way to say
             whether its winds reach you.</p>`
        : '';
    }

    const kt = co.worst;
    if (!kt) {
      return `<p class="home-band">On this forecast <b>no tropical-storm winds reach your
        home</b> — the nearest edge stays ${esc(
          formatDistance(co.forecast[34]?.closestGapNm ?? 0, sys())
        )} away.</p>`;
    }

    const c = co.forecast[kt];
    const start = c.windows[0]?.[0];
    const hrs = c.totalHours;
    const dur = hrs >= 1.5 ? `${Math.round(hrs)} hours` : hrs >= 0.5 ? 'about an hour' : 'under an hour';

    const early = co.earliest?.[kt]?.windows?.[0]?.[0];
    /* Only worth saying when the error moves the answer by a real margin —
     * "could start at 4:32 instead of 4:37" is noise wearing a hedge. */
    const earlyGap = early && start ? (Date.parse(start) - Date.parse(early)) / 3_600_000 : 0;

    /* AN OPEN-ENDED WINDOW IS A FLOOR, NOT A DURATION. It closed because the
     * forecast ran out of published radii for this threshold, not because
     * the field left — so "for 3 hours" would be understating how long
     * dangerous wind lasts, which is the unsafe direction to be wrong in. */
    const lead = c.openEnded ? 'at least' : 'about';

    return `<p class="home-band">
      <b>${esc(WIND_LABEL[kt] || kt + ' kt')} winds reach your home</b> for ${esc(lead)} ${esc(dur)},
      from ${esc(formatClockDay(start))}.
      ${earlyGap >= 2
        ? `Allowing for forecast error they could start as early as
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
        k: 'When closest',
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
        k: 'Peak',
        v: formatWind(dash.peak.windKt, sys()),
        s: dash.peak.when === 'now' ? 'already past' : dash.peakWhen === 'after' ? 'after the pass' : 'before the pass',
      });
    }

    if (!cells.length) return '';

    const trendLine =
      dash.arrivalTrend === 'weakening'
        ? 'Weakening as it approaches.'
        : dash.arrivalTrend === 'strengthening'
          ? 'Still strengthening when it reaches you.'
          : dash.arrivalTrend === 'steady'
            ? 'Holding its strength as it approaches.'
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
        key: 'now',
        lead: 'now',
        ev: `${dash.storm.name} is ${formatDistance(dash.distance.nm, sys())} ${formatBearing(dash.distance.bearing)}`,
        det: dash.trend ? `and ${dash.trend}` : 'heading not published',
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
          key: 'early',
          lead: formatUntil(early, clock) || '',
          ev: 'Winds could start as early as this',
          det: `${formatClockDay(early)} · allowing for forecast error`,
        });
      }
      rows.push({
        key: 'true',
        lead: formatUntil(start, clock) || '',
        ev: `${WIND_LABEL[worst] || worst + ' kt'} winds reach you`,
        det: formatClockDay(start) || '',
      });
      const end = c.windows[c.windows.length - 1]?.[1];
      if (end) {
        const total = c.totalHours >= 1.5 ? Math.round(c.totalHours) + ' hours' : 'an hour';
        rows.push({
          key: '',
          lead: formatUntil(end, clock) || '',
          /* See windLineHtml: an open-ended window's end time is the last
           * hour NHC published this field for, not the hour it stops. */
          ev: c.openEnded ? 'Winds last at least this long' : 'Winds ease',
          det: `${formatClockDay(end)} · ${c.openEnded ? 'at least' : 'about'} ${total} in all`,
        });
      }
    }

    const ring = dash.nearRing;
    if (!worst && ring?.everInside && ring.enter) {
      rows.push({
        key: '',
        lead: formatUntil(ring.enter, clock) || '',
        ev: `Comes inside ${formatDistance(ring.ringNm, sys())}`,
        det: formatClockDay(ring.enter) || '',
      });
    } else if (!worst && ring && !ring.everInside) {
      rows.push({
        key: '',
        lead: '—',
        ev: `Never comes inside ${formatDistance(ring.ringNm, sys())}`,
        det: 'on the current forecast',
      });
    }

    if (dash.approach?.relevant && dash.approach.time) {
      const kt = dash.atClosest?.windKt;
      rows.push({
        key: 'true',
        lead: formatUntil(dash.approach.time, clock) || '',
        ev: `Closest pass — ${formatDistance(dash.approach.nm, sys())} ${formatBearing(dash.approach.bearing)}`,
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
        key: 'held',
        lead: '—',
        ev: 'Whether your address is inside the warned zone',
        det: 'NHC names the zones, not their outlines',
      });
    }

    if (rows.length <= 1) return '';

    return `
      <div class="home-sect">
        <div class="home-kicker">What happens when</div>
        <ul class="home-rail">
          ${rows
            .map(
              (r) => `<li data-key="${esc(r.key || 'false')}">
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
