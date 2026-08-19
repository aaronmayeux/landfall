/**
 * surge-home.js — the Surge section of the home drawer. SPEC §51.3;
 * the arithmetic is `lib/surge-locations.js` and the fetch is
 * `data/gdacs-surge.js`.
 *
 * A SELF-CONTAINED CONTROLLER for the same reason `ui/rain-home.js` is one:
 * `ui/view-home.js` is the largest file in the app and over §12's ceiling, so
 * it gets one seam — a section, an ensure, a repaint — and nothing else.
 *
 * ==> IT ANSWERS A DIFFERENT QUESTION FROM THE COASTAL LAYER, AND THEY READ
 * THE SAME FETCH. <== §51.4. The layer paints every modelled town's height
 * onto the shoreline around it; this names the one town near this house. They
 * cannot disagree, because `data/gdacs-surge.js` memoizes one answer per storm
 * and both surfaces read it — which is the fix for the shape of problem
 * §48.10 spends a whole section on for rainfall.
 *
 * ==> THE NUMBERS ARE SMALL AND THE SECTION MUST NOT PRETEND OTHERWISE. <==
 * §51.1. Every modelled height in the archive is under half a metre. This is
 * not NHC's product and the section says so in the provenance line, because a
 * reader who has seen "8-12 ft" on an American storm and then sees "7 inches"
 * on a Pacific one will otherwise conclude the app is broken rather than that
 * the two are different forecasts by different bodies at different scales.
 *
 * ==> FOUR STATES, FOUR SENTENCES, AND ONLY ONE OF THEM IS AN ALL-CLEAR (§5).
 * <== `unavailable` is a fetch that failed and carries a Retry.
 * `out_of_range` is towns existing but none near this house — which is NOT
 * safety, it is nobody having looked here, and it must never be worded as
 * "no surge expected". `none_matched` is the model running and finding no
 * populated place at all, which is the one honest all-clear. `ok` is a number.
 *
 * Imports: config/, lib/, ui/ siblings. Never data/ — the fetch is injected
 * (§12).
 */

import { surgeAtHome, gdacsEventIdOf } from '../lib/surge-locations.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SURGE_HOME_SECTION = 'surge';

/** A duration in whole hours → words a reader can act on.
 *
 *  ==> IT IS AN OFFSET FROM THE STORM'S FIRST BULLETIN, NOT A COUNTDOWN FROM
 *  NOW, AND THE WORDING HAS TO SURVIVE THAT. <== §51.1. GDACS publishes
 *  `"87:00"` meaning 87 hours after bulletin 1, whose publication time is on
 *  the export's header feature and is not carried by this route. Without that
 *  instant the honest sentence is about the SPREAD between arrival and peak —
 *  "the water keeps rising for about six hours after it arrives" — and never
 *  a clock time, because a clock time from a guessed base is a confident wrong
 *  answer about when somebody's street floods. */
function spreadWords(arrivalHours, peakHours) {
  if (!Number.isFinite(arrivalHours) || !Number.isFinite(peakHours)) return '';
  const gap = Math.round(peakHours - arrivalHours);
  if (gap <= 0) return '';
  if (gap === 1) return ' It keeps rising for about an hour after it first arrives.';
  if (gap >= 24) return ' It keeps rising for about a day after it first arrives.';
  return ` It keeps rising for about ${gap} hours after it first arrives.`;
}

/**
 * @param {{ loadSurge: (storm:object)=>Promise<object>,
 *           retrySurge: (storm:object)=>Promise<object>,
 *           units: ()=>string|null }} deps
 */
export function createSurgeHome({ loadSurge, retrySurge, units }) {
  let state = { phase: 'idle', result: null, forKey: null };
  let seq = 0;

  /** Held per STORM AND HOUSE together. Either moving invalidates the answer:
   *  a new storm is a new model run, and a new house is a new nearest town in
   *  the same run. Two fields that can disagree is how a dashboard ends up
   *  showing one storm's water at another's address. */
  const keyOf = (storm, home) => {
    const eventId = gdacsEventIdOf(storm);
    return eventId && home && Number.isFinite(home.lat)
      ? `${eventId}@${home.lat},${home.lon}`
      : null;
  };

  const isCurrent = (storm, home) => !!keyOf(storm, home) && state.forKey === keyOf(storm, home);

  function body(storm, home) {
    if (!isCurrent(storm, home) || state.phase === 'idle' || state.phase === 'loading') {
      return `<p class="detail-soft">Checking modelled storm surge${DOTS}</p>`;
    }

    const res = state.result || { status: 'unavailable' };

    if (res.status === 'unavailable') {
      /* THE BUTTON IS ITS OWN ELEMENT, not a word inside the sentence — a
       * 44px control (§10) set inline in a paragraph pushes its line apart and
       * reads as a bad wrap. Same construction as the Rain retry. */
      return `<p class="detail-soft">The surge forecast didn’t load.</p>
        <button class="home-surge-retry" type="button" data-retry="surge">Retry</button>`;
    }

    const out = surgeAtHome(res.payload, home, { system: units?.() ?? null });

    if (out.state === 'none_matched') {
      /* ==> THE ONLY ALL-CLEAR IN THIS SECTION, AND IT IS ABOUT THE STORM.
       * <== The model ran across the whole storm and found no populated place
       * in reach of any water — Hernán, sitting mid-Pacific. That is a fact
       * about where the storm is, and it is safe to state plainly. */
      return `<p class="home-surge-line">No coastal flooding is modelled for
          this storm — it isn’t near enough to any populated coast.</p>
        ${provenance()}`;
    }

    if (out.state === 'out_of_range') {
      /* ==> THIS IS NOT AN ALL-CLEAR AND MUST NEVER READ AS ONE (§5). <== The
       * model produced towns; none of them is near this house. That means
       * nobody modelled the water here, which is a gap in what we know rather
       * than a statement that the house is dry. Naming the deepest town
       * elsewhere is what turns an absence into information. */
      const worst = out.worst;
      const deepest = worst && !worst.negligible && worst.heightText
        ? ` The deepest modelled anywhere on this storm is about
            ${esc(worst.heightText)} at ${esc(worst.city)}${worst.country ? `, ${esc(worst.country)}` : ''}.`
        : '';
      return `<p class="home-surge-line">No coastal flooding has been modelled
          near your house for this storm.${deepest}</p>
        <p class="home-surge-note">This model only reports at populated coastal
          places, so this is a gap in what we know rather than an all-clear.</p>
        ${provenance()}`;
    }

    if (out.state !== 'ok') {
      return `<p class="detail-soft">The surge forecast came back in a form this
        app could not read.</p>`;
    }

    const here = out.here;
    const where = `${esc(here.city)}${here.country ? `, ${esc(here.country)}` : ''}`;

    /* ==> NEGLIGIBLE IS WORDS, NOT A FIGURE (§51.1). <== The identical
     * judgement `RAIN.negligibleMm` records: a modelled 0.04 m printed as
     * "0.1 ft" under somebody's house reads as a malfunction, and said plainly
     * it reads as a forecast. */
    const headline = here.negligible || !here.heightText
      ? `<p class="home-surge-line">Only a trace of coastal flooding is modelled
          near you, at ${where}.</p>`
      : `<p class="home-surge-line"><strong>About ${esc(here.heightText)}</strong>
          of coastal flooding is modelled at ${where}, the nearest reporting
          point to your house.${spreadWords(here.arrivalHours, here.peakHours)}</p>`;

    /* Named only when it is somewhere else and meaningfully deeper — the
     * arithmetic for that lives in `surgeAtHome`, not here. */
    const worst = out.worst && !out.worst.negligible && out.worst.heightText
      ? `<p class="home-surge-worst">The deepest modelled anywhere on this storm
          is about ${esc(out.worst.heightText)} at ${esc(out.worst.city)}.</p>`
      : '';

    return `${headline}${worst}${provenance()}`;
  }

  /** ==> IT NAMES THE MODELLER AND IT SAYS "MODELLED". <== §51.1, and both
   *  halves are load-bearing. The modeller, because this is not NHC and a
   *  reader comparing an American storm's feet against this storm's
   *  centimetres has to be able to see they are two products. The word
   *  MODELLED, because that is what this is — a simulation output, not a
   *  forecaster's warning — and stating water depth at somebody's address in
   *  the same voice as an official surge warning would overclaim. */
  const provenance = () =>
    `<p class="home-surge-note">Modelled by the JRC for GDACS. This is a global
      model, not an official surge warning.</p>`;

  /** The INSIDE of the section — its heading and its contents — or '' when
   *  there is nothing to ask about.
   *
   *  ==> NO GDACS EVENT ID MEANS NO SECTION, AND THAT IS NOT §5's SILENCE.
   *  <== §5 governs a source that FAILED. This is a storm this source is not
   *  ASKED about, deliberately: in an NHC basin NHC is the only surge source
   *  (§51.5, settled), and `mergeStorms` drops the GDACS twin before any view
   *  sees a storm. There is no question to put, so there is no section. A
   *  heading over an explanation of why a global model has not heard of a
   *  storm is noise on the screen a reader opens during a hurricane. */
  function inner(storm, home, sectionHead) {
    if (!applies(storm, home)) return '';
    return `${sectionHead}${body(storm, home)}`;
  }

  /** True when `inner()` would produce something. The view asks before it
   *  writes the wrapper, so a `.home-sect` never renders around nothing. */
  const applies = (storm, home) => !!(gdacsEventIdOf(storm) && home && loadSurge);

  /** Dispatch the fetch if what we hold is not this storm-and-house's.
   *  Idempotent and cheap — data/gdacs-surge.js holds the answer for an hour
   *  and both this and the map layer read that one memo. */
  async function ensure(storm, home, repaint) {
    if (!applies(storm, home)) return;
    if (isCurrent(storm, home) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', result: null, forKey: keyOf(storm, home) };
    const result = await loadSurge(storm);
    if (mySeq !== seq) return; // the storm or the house moved mid-flight
    state = { phase: 'done', result, forKey: keyOf(storm, home) };
    repaint?.();
  }

  /** Bind the retry inside an already-rendered body. It evicts before
   *  refetching, so a cached failure cannot answer the retry. */
  function wire(scope, storm, home, repaint) {
    const btn = scope?.querySelector?.('[data-retry="surge"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!applies(storm, home)) return;
      const mySeq = ++seq;
      state = { phase: 'loading', result: null, forKey: keyOf(storm, home) };
      repaint?.();
      const result = await retrySurge(storm);
      if (mySeq !== seq) return;
      state = { phase: 'done', result, forKey: keyOf(storm, home) };
      repaint?.();
    });
  }

  return { inner, applies, ensure, wire };
}
