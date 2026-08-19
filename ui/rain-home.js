/**
 * rain-home.js (ui) — the Rain section of the home drawer. SPEC §48.5, §48.6,
 * §48.8; the arithmetic is `lib/rainfall.js` and the fetch is `data/rainfall.js`.
 *
 * A SELF-CONTAINED CONTROLLER for the same reason `ui/env-health.js` is one:
 * `ui/view-home.js` is the largest file in the app and over §12's ceiling, so
 * it gets one seam — a section, an ensure, a repaint — and nothing else.
 *
 * ==> IT ANSWERS A DIFFERENT QUESTION FROM THE STORM DRAWER'S RAINFALL
 * SECTION, AND THE TWO WILL DISAGREE. <== §48.10, which is the one real design
 * risk in §48. Lala's advisory says 8 to 12 inches across eastern Maui; the
 * grid at Kahului says 2.91. BOTH ARE RIGHT — the advisory quotes the heaviest
 * band across an area and Kahului sits off that axis — and a reader who sees
 * both will conclude the app is broken unless the difference is visible.
 * Two things here exist for that and nothing else: the section is titled about
 * the HOUSE, and the note under it NAMES THE POINT the forecast is for
 * ("nearest point: Kahului, HI"). Whether that is enough is a glass question
 * and it needs a storm near a home to ask.
 *
 * ==> A WARNING IN FORCE OUTRANKS ANY FORECAST AND RENDERS ABOVE IT. <== §48.6.
 * A total is what might happen; a Flash Flood Warning is what IS happening.
 * Only the flood family reaches this section — hurricane and tropical storm
 * warnings already have a home in the storm drawer's `In effect` section, and
 * saying them twice makes the app look like it has lost track of what it has
 * already told you.
 *
 * Imports: config/, lib/, ui/ siblings. Never data/ — the fetch is injected (§12).
 */

import { rainSummary } from '../lib/rainfall.js';
import { formatClockDay } from '../lib/time.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const RAIN_HOME_SECTION = 'rain';

/**
 * @param {{ loadRainfall: (home:object)=>Promise<object>,
 *           retryRainfall: (home:object)=>Promise<object>,
 *           units: ()=>string|null,
 *           now?: ()=>number }} deps
 */
export function createRainHome({ loadRainfall, retryRainfall, units, now = () => Date.now() }) {
  let state = { phase: 'idle', result: null, forKey: null };
  let seq = 0;

  /** Home identity for staleness. The coordinates, not the label — a reader
   *  can rename a pin without moving it, and can move it without renaming. */
  const keyOf = (home) =>
    home && Number.isFinite(home.lat) ? `${home.lat},${home.lon}` : null;

  const isCurrent = (home) => !!home && state.forKey === keyOf(home);

  /** One alert row: what it is, and when it runs out. The expiry is in the
   *  reader's own local clock — never UTC, the same rule the environment
   *  paragraph follows, and it matters more here because these expire in
   *  minutes rather than days. */
  function alertRow(a) {
    const until = a.untilMs ? `until ${formatClockDay(a.untilMs)}` : 'no end time given';
    return `<li class="home-rain-alert" data-urgency="${a.immediate ? 'now' : 'later'}">
      <span class="home-rain-alert-name">${esc(a.event)}</span>
      <span class="home-rain-alert-until">${esc(until)}</span>
    </li>`;
  }

  function body(home) {
    if (!home) return '';
    if (!isCurrent(home) || state.phase === 'idle' || state.phase === 'loading') {
      return `<p class="detail-soft">Checking the rainfall forecast${DOTS}</p>`;
    }

    const res = state.result || { status: 'unavailable' };

    if (res.status === 'not_covered') {
      /* ==> THE SECTION STAYS AND SAYS SO (§48.5). <== A section that silently
       * is not there cannot be told apart from one that failed to load. And it
       * names WHO does not forecast here, so the absence reads as a fact about
       * coverage rather than as our failure. NO RETRY: a house outside NWS's
       * area will never get a different answer, and a button that cannot work
       * is worse than none. */
      /* ==> THIS SENTENCE CHANGED WHEN THE SECOND SOURCE LANDED (§48.14), AND
       * THE OLD ONE WOULD NOW BE A LIE. <== It used to explain NWS's coverage
       * area, because NWS not forecasting here WAS the whole answer. It is not
       * any more: the global model covers the planet, so reaching this state
       * means BOTH sources declined to produce a series for this point. That
       * is rare and it is still an answer about the place rather than a
       * failure of ours, so it still carries no Retry. */
      return `<p class="detail-soft">No rainfall forecast for this location.</p>
        <p class="home-rain-note">Neither the National Weather Service nor the
          global model has a forecast for this point.</p>`;
    }

    if (res.status !== 'ok') {
      /* THE BUTTON IS ITS OWN ELEMENT, not a word inside the sentence. It is
       * a 44px bordered control (§10), and a control that size set inline in a
       * paragraph pushes the line it sits in apart and reads as a bad wrap. */
      return `<p class="detail-soft">The rainfall forecast didn’t load.</p>
        <button class="home-rain-retry" type="button" data-retry="rain">Retry</button>`;
    }

    const out = rainSummary(res.payload, { system: units?.() ?? null, now: now() });

    if (out.state === 'not_covered') {
      return `<p class="detail-soft">No rainfall forecast for this location.</p>`;
    }
    if (out.state !== 'ok') {
      /* The payload arrived and could not be read — an unrecognised unit, or a
       * series with nothing readable in it. Stated as ours and NOT retryable,
       * because asking again returns the same bytes (§48.4). */
      return `<p class="detail-soft">The rainfall forecast came back in a form
        this app could not read.</p>`;
    }

    /* WARNINGS FIRST, ALWAYS. */
    const alerts = out.alerts.length
      ? `<ul class="home-rain-alerts">${out.alerts.map(alertRow).join('')}</ul>`
      : '';

    /* ==> `alerts: null` MEANS TWO DIFFERENT THINGS AND THEY GET TWO DIFFERENT
     * SENTENCES (§48.16). <== From NWS it means the alerts hop failed while
     * the grid succeeded — what is in force is UNKNOWN, which is not "nothing
     * in force" and must not be shown as silence (§5). From the global model
     * it means there is no flood-warning source for this place at all, which
     * is a durable fact rather than a hiccup. Saying "could not be checked
     * just now" about the second reads as a temporary fault and invites a
     * reader to wait for an answer that is never coming. */
    const alertsUnknown = res.payload?.alerts != null
      ? ''
      : out.provider?.name === 'open-meteo'
        ? `<p class="home-rain-note">Flood warnings aren’t published for this
            location — this is a rainfall forecast only.</p>`
        : `<p class="home-rain-note">Flood warnings could not be checked just now.</p>`;

    const through = out.throughWords ? ` through ${esc(out.throughWords)}` : '';

    /* ==> NEGLIGIBLE RAIN IS WORDS, NOT A NUMBER (§48.8). <== Galveston's
     * thirty blocks total a quarter of a millimetre. Printed as `0.01 in` that
     * reads as a malfunction; said plainly it reads as a forecast. */
    const headline = out.negligible
      ? `<p class="home-rain-line">No meaningful rain expected${through}.</p>`
      : `<p class="home-rain-line"><strong>About ${esc(out.totalText)}</strong>
          expected${through}.</p>`;

    /* The heaviest block, only when one dominates. "Most of it in six hours" is
     * the sentence that distinguishes a flood from a wet week. */
    const peak = out.peak
      ? `<p class="home-rain-peak">The heaviest ${esc(out.peak.lengthWords)} bring about
          ${esc(out.peak.text)}, from ${esc(formatClockDay(out.peak.startMs))}.</p>`
      : '';

    /* ==> THE PROVENANCE LINE NAMES THE SOURCE **AND** THE POINT, ON BOTH
     * PATHS, AND §48.10 IS WHY. <== The risk that section records is a reader
     * on Maui seeing "8 to 12 inches across eastern Maui" in the storm drawer
     * and 2.91 here, and concluding the app is broken. The defence is that
     * this line says WHOSE forecast this is and WHERE FOR. NWS supplies a town
     * name; the global model supplies only the grid point it snapped to, which
     * is a poorer answer to the same question and not nothing.
     *
     * ==> AND THE SECOND SOURCE'S LICENCE IS DISCHARGED HERE. <== Open-Meteo
     * is CC BY 4.0, which requires visible attribution. Naming it in the
     * provenance line is that attribution — a credit in a code comment is not
     * one, and a separate footer would put it somewhere nobody reading the
     * number ever looks. */
    const where = out.provider?.name === 'open-meteo'
      ? (Number.isFinite(out.provider.gridLat)
        ? `At your house — Open-Meteo, nearest model point
           ${out.provider.gridLat.toFixed(2)}, ${out.provider.gridLon.toFixed(2)}.`
        : 'At your house, from Open-Meteo.')
      : out.place
        ? `At your house — National Weather Service, nearest point ${esc(out.place)}.`
        : 'At your house, from the National Weather Service.';

    return `${alerts}${alertsUnknown}${headline}${peak}
      <p class="home-rain-note">${where}</p>`;
  }

  /** The INSIDE of the section — its heading and its contents — or '' when
   *  there is no home to ask about.
   *
   *  ==> THE WRAPPER BELONGS TO THE VIEW AND THE CONTENTS BELONG HERE. <== The
   *  dashboard writes `.home-sect` for every one of its blocks and this must
   *  not be the one that writes its own; and repainting just this section
   *  after the fetch lands means replacing exactly what this function
   *  produced, which is only true if the element itself is not part of it. */
  function inner(home, sectionHead) {
    if (!home || !loadRainfall) return '';
    return `${sectionHead}${body(home)}`;
  }

  /** Dispatch the fetch if what we hold is not this home's. Idempotent, and
   *  cheap — data/rainfall.js holds the answer for `RAIN.clientTtlMs`. */
  async function ensure(home, repaint) {
    /* ==> NO FACADE MEANS NO SECTION, AND THAT IS NOT THE §5 SILENCE. <== §5
     * governs a source that failed; this is the feature not being WIRED, which
     * happens in exactly one place — the older home suites construct this view
     * with the deps they needed at the time. An unwired section that throws
     * takes the whole dashboard down with it during a hurricane, and a section
     * that is purely additive can be absent without any other figure on the
     * screen becoming wrong. So it is absent, and `inner()` agrees with this
     * so a heading never renders above nothing. */
    if (!home || !loadRainfall) return;
    if (isCurrent(home) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', result: null, forKey: keyOf(home) };
    const result = await loadRainfall(home);
    if (mySeq !== seq) return; // home moved mid-flight
    state = { phase: 'done', result, forKey: keyOf(home) };
    repaint?.();
  }

  /** Bind the retry inside an already-rendered body. It evicts before
   *  refetching, so a cached failure cannot answer the retry. */
  function wire(scope, home, repaint) {
    const btn = scope?.querySelector?.('[data-retry="rain"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!home) return;
      const mySeq = ++seq;
      state = { phase: 'loading', result: null, forKey: keyOf(home) };
      repaint?.();
      const result = await retryRainfall(home);
      if (mySeq !== seq) return;
      state = { phase: 'done', result, forKey: keyOf(home) };
      repaint?.();
    });
  }

  return { inner, ensure, wire };
}
