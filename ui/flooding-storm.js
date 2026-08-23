/**
 * flooding-storm.js (ui) — the Flooding section of the storm detail drawer.
 * SPEC §56.7, §56.8; the corridor match is `lib/flood.js` and the modelled
 * figure is `lib/surge-locations.js`.
 *
 * ==> RAIN AND FLOODING ARE SEPARATE SECTIONS; COASTAL FLOODING IS NOT. <==
 * §56.7. Rainfall is our arithmetic on a forecast. A flood alert is an
 * agency's statement about right now with an expiry on it. Burying the second
 * inside the first makes the urgent thing look like a footnote on the other
 * thing, which is what §48.21 shipped — so Flood left Rain.
 *
 * ==> BUT COASTAL FLOODING MERGED INTO IT RATHER THAN STANDING BESIDE IT. <==
 * Somebody deciding whether to move a car does not care whether the water came
 * off the sky or off the sea. Two headings for *water is going to be where you
 * are* is a distinction that matters to the plumbing and not to the reader.
 * And the two barely ever co-occur, which settles it: NWS flood alerts are US
 * only, and the GDACS model explicitly declines NHC's basins (§51.5). Two
 * sections where one is always empty is worse than one section that fills from
 * whichever source has something.
 *
 * ==> THREE SOURCES, ONE SECTION, AND THE ORDER IS THE ARGUMENT. <==
 *
 *   NWS flood alerts     bordered rows, their own ink. Somebody else's order,
 *                        with an expiry on it.
 *   CAP storm surge      the same rows, from national agencies (§56.8).
 *   the GDACS model      plain prose underneath. OUR reading of a simulation.
 *
 * They are different KINDS of statement and must not be styled the same. An
 * alert is somebody else's order; a modelled height is our reading of a model.
 * Given one look, the model borrows the authority of the order. So the section
 * takes the shape Rain already uses: rows on top, our figure as prose below.
 *
 * ==> NOTHING ABOUT THE READER'S HOUSE APPEARS HERE. <== §56.9. A storm panel
 * is about the storm, so the modelled half is `surgeOnStorm` — the deepest
 * coast this storm is modelled to flood, anywhere — and never `surgeAtHome`.
 * The house-anchored figure is the home dashboard's, on the screen that has a
 * house on it.
 *
 * ==> AND THE TWO COVERAGE GAPS ARE THE THING MOST LIKELY TO BE GOT WRONG.
 * <== Each empty half reads as an all-clear if it is silent, and the
 * sentences that stop that are in `ui/flood-words.js` so both screens say the
 * same one. See that file for why they are said as often as they are.
 *
 * ==> KEYBOARD IS NOT OPTIONAL AND THE MAP ALONE DOES NOT PROVIDE IT (§10,
 * §56.6). <== Slice C makes the globe's flood chips tappable. A chip reachable
 * only by tapping a sphere does not exist for a keyboard user, so THESE ROWS ARE
 * THE KEYBOARD PATH and they land first on purpose.
 *
 * ==> THIS SECTION IS PER-STORM AND THE MAP LAYER IS NOT, AND BOTH ARE RIGHT.
 * <== As of 2026-08-23 the globe paints every flood alert in force in the United
 * States, with no selection involved. This section counts only what comes within
 * `RAIN.floodCorridorNm` of THIS storm's track, so the globe shows more shapes
 * than this section counts. Two different questions — *where is flooding* and
 * *what is near this storm* — and no sentence here claims the globe is showing
 * its set. Do not "reconcile" them by filtering the map.
 *
 * A SELF-CONTAINED CONTROLLER, same shape as `ui/rain-storm.js` and
 * `ui/env-health.js`, because `ui/view-storm-detail.js` is past §12's file
 * ceiling and takes only seams now.
 *
 * Imports: config/, lib/ and ui/ siblings, never data/ — the fetches arrive
 * injected (§12).
 */

import { surgeOnStorm, gdacsEventIdOf } from '../lib/surge-locations.js';
import { formatDistance } from '../lib/units.js';
import { DOTS } from './loading-dots.js';
import { floodAlertRows } from './rain-alerts.js';
import {
  NWS_US_ONLY, MODEL_NOT_THIS_BASIN, GDACS_PROVENANCE, NWS_NOT_ATTRIBUTED,
} from './flood-words.js';

export const FLOOD_SECTION = 'flooding';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A duration in whole hours → words a reader can act on.
 *
 *  ==> IT IS AN OFFSET FROM THE STORM'S FIRST BULLETIN, NOT A COUNTDOWN FROM
 *  NOW, AND THE WORDING HAS TO SURVIVE THAT. <== §51.1. GDACS publishes
 *  `"87:00"` meaning 87 hours after bulletin 1, whose publication time is on
 *  the export's header feature and is not carried by this route. Without that
 *  instant the honest sentence is about the SPREAD between arrival and peak
 *  and never a clock time, because a clock time from a guessed base is a
 *  confident wrong answer about when somebody's street floods. */
export function spreadWords(arrivalHours, peakHours) {
  if (!Number.isFinite(arrivalHours) || !Number.isFinite(peakHours)) return '';
  const gap = Math.round(peakHours - arrivalHours);
  if (gap <= 0) return '';
  if (gap === 1) return ' It keeps rising for about an hour after it first arrives.';
  if (gap >= 24) return ' It keeps rising for about a day after it first arrives.';
  return ` It keeps rising for about ${gap} hours after it first arrives.`;
}

/**
 * @param {object} deps injected by ui/view-storm-detail.js.
 * @param {{ summaryFor:(storm:object)=>object|null }} [deps.flood] the
 *   corridor answer, measured against this storm's own track FeatureCollections.
 *   ==> IT USED TO SAY THIS GUARANTEED AGREEMENT WITH THE GLOBE, AND THAT IS NO
 *   LONGER WHAT IS TRUE. <== The map layer went national on 2026-08-23 and does
 *   not measure a track at all, so there is no shared rule left to agree about.
 *   What this dependency guarantees is that the sentence and the ROWS below it
 *   come from one measurement.
 * @param {{ waterFor:(storm:object)=>object|null, retry:()=>Promise<any> }}
 *   [deps.cap] the storm-surge half of the CAP list (§56.8). The SAME
 *   controller `Watches and warnings` reads, so one fetch feeds both sections
 *   and a row can never appear under both headings.
 * @param {{ loadSurge:Function, retrySurge:Function }} [deps.surge] the GDACS
 *   model. The SAME facade the home dashboard is handed, so the two screens
 *   read one memoized answer per storm.
 * @param {()=>string|null} [deps.units] the resolved unit system.
 */
export function createFloodingStorm({ flood = null, cap = null, surge = null, units = null }) {
  /** The GDACS fetch's own state, keyed by STORM ALONE — there is no house in
   *  this question, which is the difference from the home dashboard's copy. */
  let state = { phase: 'idle', result: null, forKey: null };
  let seq = 0;

  const keyOf = (storm) => gdacsEventIdOf(storm) || null;
  const isCurrent = (storm) => !!keyOf(storm) && state.forKey === keyOf(storm);

  /** Can this storm be asked about coastal flooding at all? False for every
   *  storm in an NHC basin, deliberately (§51.5) — and that is not silence,
   *  it is `MODEL_NOT_THIS_BASIN` below. */
  const modelApplies = (storm) => !!(gdacsEventIdOf(storm) && surge?.loadSurge);

  /* -------------------------------------------------------------------------
   * THE ROWS — somebody else's orders, on top
   * ---------------------------------------------------------------------- */

  /**
   * NWS flood alerts whose shape comes within the corridor of this storm's
   * track. §56.3.
   *
   * ==> `no_track` AND `none_matched` BOTH PRODUCE AN EMPTY LIST AND MUST NOT
   * READ THE SAME. <== §5. A storm with no published track has nothing to
   * measure against; a storm whose track WAS measured and came near nothing is
   * a real all-clear. This is the distinction this feature is most likely to
   * lose, because both look identical on screen.
   */
  function corridorHtml(storm) {
    if (!flood?.summaryFor || !storm) return '';
    const out = flood.summaryFor(storm);
    if (!out) return '';

    if (out.state === 'loading') {
      return `<p class="detail-soft">Checking flood alerts${DOTS}</p>`;
    }

    if (out.state === 'unavailable') {
      /* NEVER an all-clear. The list not loading and nothing being in force
       * are opposite facts that look identical on screen. */
      return `<p class="detail-soft">Flood alerts couldn’t be checked.
        <button class="detail-retry" type="button" data-retry="flood">Retry</button></p>`;
    }

    if (out.state === 'no_track') {
      /* ==> IT SAYS WHY, AND IT DOES NOT SAY “NONE”. <== No track means
       * nothing to measure alerts against. "No flood alerts nearby" here would
       * be an all-clear derived from our own missing geometry. */
      return `<p class="detail-soft">This storm has no published track, so flood
        alerts can’t be matched to it.</p>`;
    }

    if (out.state === 'none_matched') {
      /* A REAL ANSWER — the track was measured and nothing came near it — and
       * the coverage sentence beside it, because "nothing within 345 mi" is
       * only an answer for a place NWS forecasts at all.
       *
       * ==> UNLESS SOMETHING COULD NOT BE PLACED, IN WHICH CASE IT IS NOT AN
       * ANSWER AT ALL. <== §56.4. An alert whose zone boundaries did not
       * resolve never reaches the distance test, so "none within 345 mi" would
       * be an all-clear built out of our own missing geometry — the same
       * mistake `no_track` above exists to avoid, arriving by a different
       * road. It is the worst sentence this feature can print, so the
       * qualification goes FIRST and the all-clear is withheld. */
      if (out.unplaceable > 0) {
        const one = out.unplaceable === 1;
        return `<p class="flood-line">${one ? 'One flood alert' : `${out.unplaceable} flood alerts`}
            in force could not be placed on the map, so
            ${one ? 'it' : 'they'} can’t be measured against this storm’s track.
            Nothing else is in force within
            ${formatDistance(out.radiusNm, units?.() ?? null)} of it.</p>
          <p class="flood-note">${esc(NWS_US_ONLY)}</p>`;
      }
      return `<p class="flood-line">No flood alerts are in force within
          ${formatDistance(out.radiusNm, units?.() ?? null)} of this storm’s track.</p>
        <p class="flood-note">${esc(NWS_US_ONLY)}</p>`;
    }

    /* ==> THE CLAUSE THAT USED TO SAY "ISSUED BY ZONE" IS GONE, BECAUSE PHASE 4
     * MADE IT UNTRUE AND IT HAD NEVER BEEN REACHABLE ANYWAY. <== §56.4. It
     * counted `total - drawable`, and nothing shapeless ever reaches this
     * branch — the distance test cannot match what it cannot measure — so the
     * difference was always zero and the sentence never printed. Its job was
     * real, though: an alert the map is not showing must be accounted for.
     *
     * That job now belongs to `unplaceable`, which counts the alerts held back
     * from the match entirely — a watch whose zone boundaries did not come
     * back. Those ARE invisible on the globe and in the list, and this is the
     * only sentence that admits they exist. */
    const n = out.total;
    const noun = n === 1 ? 'flood alert is' : 'flood alerts are';
    const unplaced = out.unplaceable || 0;
    const drawNote = unplaced > 0
      ? ` ${unplaced === 1 ? 'One more is' : `${unplaced} more are`} in force but
          could not be placed on the map, so ${unplaced === 1 ? 'it is' : 'they are'}
          not counted here.`
      : '';

    /* ==> THE SENTENCE NAMES THE DISTANCE, AND THAT IS NOT DECORATION. <==
     * §56.3. "Inside the forecast cone" at least sounded like somebody else's
     * shape. A corridor is entirely ours, so the copy hands the reader the
     * radius and lets them judge it — an unnamed proximity is a claim wearing
     * a measurement's clothes. */
    return `<p class="flood-line"><strong>${n} ${noun}</strong> in force within
        ${formatDistance(out.radiusNm, units?.() ?? null)} of this storm’s track.${drawNote}</p>
      ${floodAlertRows(out.alerts)}
      <p class="flood-note">${esc(NWS_NOT_ATTRIBUTED)}</p>`;
  }

  /**
   * The national agencies' own storm-surge warnings. §56.8.
   *
   * ==> THEY MOVED HERE FROM `Watches and warnings` AND THAT SECTION KEPT
   * EVERYTHING ELSE. <== The line that holds is that `Watches and warnings`
   * carries products that name this storm and Flooding carries products that
   * do not. A CAP row is matched by COUNTRY (§50.3), which is weaker than
   * NHC's by-name products already in that section — and every other kind of
   * water in this app now lives here, so leaving surge behind would split
   * water across two sections according to which feed happened to carry it.
   *
   * ==> IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY, AND THAT IS NOT §5's
   * SILENCE. <== An NHC storm is never asked (the CAP list is GDACS-matched),
   * and a GDACS storm with no country attributed yet has already been told so
   * under `Watches and warnings`. Repeating either here would be this section
   * explaining somebody else's filing system. What it does NOT stay silent
   * about is a fetch that FAILED, which is below.
   */
  function capHtml(storm) {
    if (!cap?.waterFor || !storm) return '';
    const out = cap.waterFor(storm);
    if (!out) return '';

    if (out.state === 'loading') {
      return `<p class="detail-soft">Checking national agencies${DOTS}</p>`;
    }

    if (out.state === 'unavailable') {
      /* OUR PROBLEM, WORDED AS OURS, AND WITH ITS OWN BUTTON. The reader must
       * not read a failed fetch as "no agency has a surge warning out" (§5).
       *
       * ==> ITS OWN `data-retry` TOKEN, NOT `local-alerts`. <== The host view
       * binds every `.detail-retry` on the panel, and two buttons answering to
       * one selector is how one of them silently stops working. Both tokens
       * drive the same refetch and both sections repaint from it, so a press
       * in either place fixes both. */
      return `<p class="detail-soft">Storm surge warnings from national agencies
        couldn’t be checked.
        <button class="detail-retry" type="button" data-retry="flood-cap">Retry</button></p>`;
    }

    if (out.state !== 'ok' || !out.alerts?.length) return '';
    return out.rowsHtml || '';
  }

  /* -------------------------------------------------------------------------
   * THE FIGURE — our reading of a model, as prose, underneath
   * ---------------------------------------------------------------------- */

  function modelHtml(storm) {
    if (!storm) return '';

    /* ==> AN NHC STORM GETS A SENTENCE, NOT NOTHING. <== §56.7. A US storm
     * shows rows and no modelled figure, and that must not read as "no coastal
     * flooding expected" — it means this model does not cover this basin. */
    if (!modelApplies(storm)) {
      return `<p class="flood-note">${esc(MODEL_NOT_THIS_BASIN)}</p>`;
    }

    if (!isCurrent(storm) || state.phase === 'idle' || state.phase === 'loading') {
      return `<p class="detail-soft">Checking modelled coastal flooding${DOTS}</p>`;
    }

    const res = state.result || { status: 'unavailable' };

    if (res.status === 'unavailable') {
      return `<p class="detail-soft">The modelled coastal flooding didn’t load.
        <button class="detail-retry" type="button" data-retry="flood-model">Retry</button></p>`;
    }

    const out = surgeOnStorm(res.payload, { system: units?.() ?? null });

    if (out.state === 'none_matched') {
      /* ==> THE ONLY ALL-CLEAR IN THIS HALF, AND IT IS ABOUT THE STORM. <==
       * The model ran across the whole storm and found no populated place in
       * reach of any water — Hernán, sitting mid-Pacific. A fact about where
       * the storm is, and safe to state plainly. */
      return `<p class="flood-line">No coastal flooding is modelled for this storm
          — it isn’t near enough to any populated coast.</p>
        <p class="flood-note">${esc(GDACS_PROVENANCE)}</p>`;
    }

    if (out.state !== 'ok') {
      return `<p class="detail-soft">The modelled coastal flooding came back in a
        form this app could not read.</p>`;
    }

    const w = out.worst;
    const where = `${esc(w.city)}${w.country ? `, ${esc(w.country)}` : ''}`;

    /* ==> NEGLIGIBLE IS WORDS, NOT A FIGURE (§51.1). <== The identical
     * judgement `RAIN.negligibleMm` records: a modelled 0.04 m printed as
     * "0.1 ft" reads as a malfunction, and said plainly it reads as a
     * forecast. */
    const line = w.negligible || !w.heightText
      ? `<p class="flood-line">Only a trace of coastal flooding is modelled
          anywhere on this storm, the deepest at ${where}.</p>`
      : `<p class="flood-line"><strong>About ${esc(w.heightText)}</strong> of coastal
          flooding is modelled at ${where}, the deepest anywhere on this
          storm.${spreadWords(w.arrivalHours, w.peakHours)}</p>`;

    return `${line}<p class="flood-note">${esc(GDACS_PROVENANCE)}</p>`;
  }

  /* -------------------------------------------------------------------------
   * THE SECTION
   * ---------------------------------------------------------------------- */

  /** The section body's inner HTML for the current state. Pure of the DOM.
   *
   *  ORDER IS THE ARGUMENT, not a layout preference: orders first, our reading
   *  of a model last. See the header. */
  function html(storm) {
    if (!storm) return '';
    const rows = `${corridorHtml(storm)}${capHtml(storm)}`;
    const model = modelHtml(storm);
    /* THE HAIRLINE ONLY WHEN BOTH HALVES ARE THERE. It exists so a reader can
     * SEE that an agency's order and our model reading are two answers rather
     * than one continuing. Drawn under nothing it is a line across an empty
     * section. */
    const seam = rows && model ? ' flood-model--after-rows' : '';
    return `${rows}${model ? `<div class="flood-model${seam}">${model}</div>` : ''}`;
  }

  /* -------------------------------------------------------------------------
   * FETCH AND WIRE
   * ---------------------------------------------------------------------- */

  /** Dispatch the GDACS fetch if what we hold is not this storm's.
   *
   *  Idempotent and cheap — `data/gdacs-surge.js` holds one answer per storm
   *  for an hour, and the coast layer and the home dashboard read that same
   *  memo. The corridor half needs no ensure: the flood list is fetched by the
   *  layer toggle or by the view, and `summaryFor` reports what is held. */
  async function ensure(storm, repaint) {
    if (!modelApplies(storm)) return;
    if (isCurrent(storm) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', result: null, forKey: keyOf(storm) };
    const result = await surge.loadSurge(storm);
    if (mySeq !== seq) return; // a newer storm took over mid-flight
    state = { phase: 'done', result, forKey: keyOf(storm) };
    repaint?.();
  }

  /** Bind all three retries inside an already-rendered panel body.
   *
   *  ==> THREE BUTTONS, THREE TOKENS, THREE SOURCES. <== `flood` is the
   *  national NWS list, `flood-cap` is the CAP feed, `flood-model` is the
   *  GDACS run. They fail independently and each button asks again for the one
   *  thing that failed — a Retry that refetches a source the reader did not
   *  ask about is a Retry that lies about what it did. */
  function wire(bodyEl, storm, repaint) {
    const on = (token, fn) => {
      const btn = bodyEl?.querySelector?.(`[data-retry="${token}"]`);
      if (btn) btn.addEventListener('click', fn);
    };

    if (flood?.retry) on('flood', async () => { await flood.retry(); repaint?.(); });
    if (cap?.retry) on('flood-cap', async () => { await cap.retry(); repaint?.(); });

    if (surge?.retrySurge) {
      on('flood-model', async () => {
        if (!modelApplies(storm)) return;
        const mySeq = ++seq;
        state = { phase: 'loading', result: null, forKey: keyOf(storm) };
        repaint?.();
        const result = await surge.retrySurge(storm);
        if (mySeq !== seq) return;
        state = { phase: 'done', result, forKey: keyOf(storm) };
        repaint?.();
      });
    }
  }

  return { html, ensure, wire };
}
