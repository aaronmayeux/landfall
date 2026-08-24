/**
 * flooding-home.js (ui) — the Flooding section of the home dashboard.
 * SPEC §56.7; the arithmetic is `lib/rainfall.js` and `lib/surge-locations.js`,
 * the fetches are `data/rainfall.js` and `data/gdacs-surge.js`.
 *
 * ==> IT IS THE SAME SECTION AS `ui/flooding-storm.js` ASKING THE HOUSE'S
 * VERSION OF THE QUESTION. <== Same heading, same glyph, same shape — rows on
 * top with their own ink, our modelled figure as prose below — and the same
 * §5 trap: one section, two sources, two coverage gaps, each of which reads as
 * an all-clear if it is silent. The sentences that stop that live in
 * `ui/flood-words.js` so the two screens cannot drift apart on them.
 *
 * WHAT DIFFERS, AND WHY IT IS TWO FILES RATHER THAN ONE:
 *
 *   the rows      the storm panel matches national alerts to a TRACK (§56.3).
 *                 This asks the reader's own address, through the point
 *                 forecast the Rain section already fetched. Different
 *                 question, different source, different failure modes.
 *   the figure    the storm panel takes `surgeOnStorm` — deepest anywhere on
 *                 this storm, no house in it (§56.9). This takes
 *                 `surgeAtHome` — the nearest reporting point to the house.
 *   the gap       the storm panel cannot tell whether NWS covers a storm, so
 *                 it says so on every empty result. THIS SCREEN CAN: the
 *                 provider on the rainfall payload names it exactly, so the
 *                 coverage sentence here is precise and the generic one is
 *                 not used.
 *
 * `ui/rain-home.js` and `ui/rain-storm.js` are two files for the same section
 * on two screens for exactly this reason, and this follows them.
 *
 * ==> THE ROWS CAME OUT OF THE RAIN SECTION AND THAT IS THE WHOLE MOVE. <==
 * §48.6 put a flood warning above the rainfall total because a warning is what
 * IS happening and a total is what MIGHT. That ranking was right and this does
 * not undo it — the warning still renders above any forecast the reader
 * scrolls to. What changed is that it now has a heading of its own, so it is
 * not a footnote on a section about something else, and it sits beside the
 * other kind of water instead of two headings away from it.
 *
 * ==> IT READS ONE RAINFALL RECORD, NOT A SECOND FETCH. <== `data/rainfall.js`
 * holds exactly one answer keyed by the rounded home coordinates, and this,
 * `ui/rain-home.js` and the storm drawer's house block all read it. Fetching
 * independently would cost nothing in bytes and everything in trust: two calls
 * can land either side of a grid update, and an app showing one set of
 * warnings in Rain and another in Flooding is an app the reader stops
 * believing.
 *
 * A SELF-CONTAINED CONTROLLER for the same reason `ui/rain-home.js` is one:
 * `ui/view-home.js` is the largest file in the app and over §12's ceiling, so
 * it gets one seam — a section, an ensure, a wire, a repaint — and nothing
 * else.
 *
 * Imports: lib/ and ui/ siblings. Never data/ — the fetches are injected (§12).
 */

import { rainSummary, pastSummary } from '../lib/rainfall.js';
import { surgeAtHome, gdacsEventIdOf } from '../lib/surge-locations.js';
import { DOTS } from './loading-dots.js';
import { floodAlertRows, wireFloodAlertRows } from './rain-alerts.js';
import { spreadWords } from './flooding-storm.js';
import {
  MODEL_NOT_THIS_BASIN, GDACS_PROVENANCE,
  PAST_RAIN_PROVENANCE, pastWindowWords,
} from './flood-words.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FLOOD_HOME_SECTION = 'flooding';

/**
 * @param {{ rain: { loadRainfall:Function, retryRainfall:Function },
 *           surge: { loadSurge:Function, retrySurge:Function },
 *           units: ()=>string|null,
 *           now?: ()=>number }} deps
 */
export function createFloodingHome({
  rain = null,
  surge = null,
  units,
  now = () => Date.now(),
  /** Open one alert's detail panel (§56.6). Absent, the rows still render and
   *  still say everything they said before — they simply do not open. A
   *  section that threw because a caller had not been updated would take the
   *  whole dashboard down for a feature that is an enhancement. */
  openAlert = null,
}) {
  /** The alerts this section last DREW, for `wireFloodAlertRows` to resolve a
   *  pressed row against. Never read for rendering — the render owns its own
   *  array — so the two cannot get out of step in the direction that matters. */
  let lastRows = [];

  /** The point forecast's own record and sequence. Keyed by the HOUSE. */
  let rainState = { phase: 'idle', result: null, forKey: null };
  let rainSeq = 0;

  /** The model's own record and sequence. Keyed by the STORM AND THE HOUSE
   *  together — either moving invalidates the answer: a new storm is a new
   *  model run, and a new house is a new nearest town in the same run. Two
   *  fields that can disagree is how a dashboard ends up showing one storm's
   *  water at another's address. */
  let surgeState = { phase: 'idle', result: null, forKey: null };
  let surgeSeq = 0;

  /** Rain already on the ground (§56.14). Keyed by the HOUSE alone — it is a
   *  fact about a place and a clock, with no storm in it, and it renders on a
   *  calm day for the same reason the rows do. */
  let pastState = { phase: 'idle', result: null, forKey: null };
  let pastSeq = 0;

  /** Home identity: the coordinates, not the label — a reader can rename a pin
   *  without moving it, and move it without renaming it. */
  const homeKey = (home) =>
    home && Number.isFinite(home.lat) ? `${home.lat},${home.lon}` : null;

  const surgeKey = (storm, home) => {
    const eventId = gdacsEventIdOf(storm);
    return eventId && homeKey(home) ? `${eventId}@${homeKey(home)}` : null;
  };

  const rainCurrent = (home) => !!homeKey(home) && rainState.forKey === homeKey(home);
  const pastCurrent = (home) => !!homeKey(home) && pastState.forKey === homeKey(home);
  const surgeCurrent = (storm, home) =>
    !!surgeKey(storm, home) && surgeState.forKey === surgeKey(storm, home);

  /** Can this storm be asked about coastal flooding at all? False for every
   *  storm in an NHC basin, deliberately (§51.5). */
  const modelApplies = (storm, home) =>
    !!(gdacsEventIdOf(storm) && home && surge?.loadSurge);

  /* -------------------------------------------------------------------------
   * THE ROWS — what is in force at this address
   * ---------------------------------------------------------------------- */

  function rowsHtml(home) {
    if (!home || !rain?.loadRainfall) return '';

    if (!rainCurrent(home) || rainState.phase === 'idle' || rainState.phase === 'loading') {
      return `<p class="detail-soft">Checking flood alerts${DOTS}</p>`;
    }

    const res = rainState.result || { status: 'unavailable' };

    if (res.status === 'not_covered') {
      /* ==> A FACT ABOUT THE PLACE, SO NO RETRY. <== Both sources declined to
       * produce anything for this point, which will not change on a second
       * press, and a button that cannot work is worse than none. It is still
       * stated: a section that silently is not there cannot be told apart from
       * one that failed to load (§48.5). */
      return `<p class="detail-soft">No flood alerts are published for this
        location.</p>`;
    }

    if (res.status !== 'ok') {
      /* NEVER an all-clear. The forecast not loading and nothing being in
       * force are opposite facts that look identical on screen (§5).
       *
       * THE BUTTON IS ITS OWN ELEMENT rather than a word inside the sentence:
       * a 44px control (§10) set inline in a paragraph pushes its line apart
       * and reads as a bad wrap. */
      return `<p class="detail-soft">Flood alerts couldn’t be checked.</p>
        <button class="home-flood-retry" type="button" data-retry="flood">Retry</button>`;
    }

    const out = rainSummary(res.payload, { system: units?.() ?? null, now: now() });

    /* ==> `alerts: null` MEANS TWO OPPOSITE THINGS AND GETS TWO OPPOSITE
     * SENTENCES (§48.16). <== From NWS it means the alerts hop failed while
     * the grid succeeded — what is in force is UNKNOWN, which is not "nothing
     * in force" and must not render as silence. From the global model it means
     * there is no flood-alert source for this place at all, which is durable;
     * "could not be checked just now" there invites a reader to wait for an
     * answer that is never coming.
     *
     * ==> AND THE SECOND ONE IS THIS SCREEN'S COVERAGE GAP, ANSWERED EXACTLY.
     * <== `ui/flooding-storm.js` has to say the generic "NWS is US only"
     * sentence on every empty result because it cannot tell whether a storm is
     * somewhere NWS forecasts. Here the provider names it, so the sentence is
     * about this house rather than about a source's map. */
    if (res.payload?.alerts == null) {
      return out.provider?.name === 'open-meteo'
        ? `<p class="flood-note">Flood alerts aren’t published for this location —
            the forecast here comes from a global model that issues none.</p>`
        : `<p class="flood-note">Flood alerts could not be checked just now.</p>`;
    }

    /* ==> WHAT WAS DRAWN IS HELD, BECAUSE THE ROWS ARE BUTTONS NOW (§56.6).
     * <== `wireFloodAlertRows` resolves a pressed row against this array, and
     * it reads it through a getter rather than capturing it — this section
     * repaints on every poll, and a captured array would open the panel on
     * whatever was in force one poll ago. */
    lastRows = out.alerts;
    const rows = floodAlertRows(out.alerts);
    if (rows) return rows;

    /* ==> THE REAL ALL-CLEAR, AND IT ONLY BECAME SAYABLE WHEN THIS GOT ITS OWN
     * HEADING. <== Inside the Rain section an empty list was correctly silent:
     * the total below it was the section's answer and announcing the absence
     * of a hazard nobody asked about is noise. A section headed *Flooding*
     * with nothing under it is the opposite problem — a reader cannot tell it
     * from one that failed. The source answered and nothing is in force, which
     * is a real and useful fact, so it is stated. */
    return `<p class="flood-line">No flood alerts are in force for your
      address.</p>`;
  }

  /* -------------------------------------------------------------------------
   * WHAT HAS ALREADY FALLEN — §56.14
   *
   * ==> THE ONLY THING IN THIS SECTION THAT WORKS EVERYWHERE ON EARTH. <== The
   * rows stop at the American border and the modelled figure declines NHC's
   * basins, so on a Japan typhoon both halves are empty by coverage and this
   * is the section's one real, local, present-tense fact.
   *
   * ==> IT SITS ABOVE THE MODELLED FIGURE AND BELOW THE ROWS, AND THAT ORDER
   * IS §48.6's. <== A warning in force is what IS happening; this is what HAS
   * happened; the modelled figure is what MIGHT. A flood warning with "about
   * three inches fell here in the last two days" under it is a warning that
   * explains itself.
   * ---------------------------------------------------------------------- */

  function pastHtml(home) {
    if (!home || !rain?.loadPastRainfall) return '';

    if (!pastCurrent(home) || pastState.phase === 'idle' || pastState.phase === 'loading') {
      return `<p class="detail-soft">Checking rain already fallen${DOTS}</p>`;
    }

    const res = pastState.result || { status: 'unavailable' };

    /* ==> A FAILED FETCH AND A DRY TWO DAYS MUST NOT RENDER THE SAME, AND THIS
     * IS THE LINE THAT GUARANTEES IT (§56.14's second rule, §5). <== Nothing
     * having fallen is safe to state plainly and is stated below. Not knowing
     * is a different fact with a button on it. The two are separated HERE,
     * before any arithmetic runs, because `pastSummary` is only ever handed a
     * payload a source actually produced. */
    if (res.status === 'unavailable') {
      return `<p class="detail-soft">Rain already fallen couldn’t be checked.</p>
        <button class="home-flood-retry" type="button" data-retry="flood-past">Retry</button>`;
    }

    /* `not_covered` cannot happen on the global model by construction (§48.16)
     * and there is no second source to try, so it is read the same way an
     * unreadable body is: we have no figure, and no button will change it. */
    if (res.status !== 'ok') {
      return `<p class="flood-note">No estimate of rain already fallen is
        available for this location.</p>`;
    }

    const out = pastSummary(res.payload, { system: units?.() ?? null, now: now() });

    /* ==> `unsupported` IS A FACT ABOUT THE SOURCE AND SHOULD BE UNREACHABLE
     * HERE. <== `loadPastRainfall` always asks the global route, so a payload
     * arriving from anywhere else means the facade changed under this file.
     * Said rather than dropped: a silently missing sentence is exactly what §5
     * forbids, and it would be indistinguishable from a dry week. */
    if (out.state === 'unsupported' || out.state === 'lapsed') {
      return `<p class="flood-note">No estimate of rain already fallen is
        available for this location.</p>`;
    }

    if (out.state !== 'ok' && out.state !== 'dry') {
      return `<p class="detail-soft">The estimate of rain already fallen came back
        in a form this app could not read.</p>`;
    }

    /* THE HOURS ACTUALLY COVERED, never the window asked for (§48.11). */
    const when = pastWindowWords(out.coveredHours ?? out.hours) || 'recent hours';

    /* ==> NEGLIGIBLE IS WORDS, NOT A FIGURE. <== The identical judgement
     * `RAIN.negligibleMm` already records for the forecast total: a modelled
     * 0.2 mm printed as "0.01 in" under somebody's house reads as a
     * malfunction, and said plainly it reads as a fact. */
    const line = out.state === 'dry'
      ? `<p class="flood-line">Little or no rain has fallen at your address in
          ${esc(when)}.</p>`
      : `<p class="flood-line"><strong>About ${esc(out.totalText)}</strong> of rain
          is estimated to have fallen at your address in ${esc(when)}.</p>`;

    return `${line}<p class="flood-note">${esc(PAST_RAIN_PROVENANCE)}</p>`;
  }

  /* -------------------------------------------------------------------------
   * THE FIGURE — our reading of a model, as prose, underneath
   * ---------------------------------------------------------------------- */

  function modelHtml(storm, home) {
    if (!home || !surge?.loadSurge) return '';

    /* ==> NO STORM ON SCREEN MEANS NO QUESTION, WHICH IS NOT §5's SILENCE.
     * <== §5 governs a SOURCE that failed. On a calm day nobody has asked this
     * model anything: it reports per storm and there is no storm. A heading
     * over an explanation of that is noise on the screen a reader opens during
     * a hurricane. The rows above still render, which is the screen's job. */
    if (!storm) return '';

    /* ==> AN NHC STORM GETS A SENTENCE, NOT NOTHING (§56.7). <== A US storm
     * shows rows and no modelled figure, and that must not read as "no coastal
     * flooding expected" — it means this model does not cover this basin. */
    if (!modelApplies(storm, home)) {
      return `<p class="flood-note">${esc(MODEL_NOT_THIS_BASIN)}</p>`;
    }

    if (!surgeCurrent(storm, home) || surgeState.phase === 'idle' || surgeState.phase === 'loading') {
      return `<p class="detail-soft">Checking modelled coastal flooding${DOTS}</p>`;
    }

    const res = surgeState.result || { status: 'unavailable' };

    if (res.status === 'unavailable') {
      return `<p class="detail-soft">The modelled coastal flooding didn’t load.</p>
        <button class="home-flood-retry" type="button" data-retry="flood-model">Retry</button>`;
    }

    const out = surgeAtHome(res.payload, home, { system: units?.() ?? null });

    if (out.state === 'none_matched') {
      /* ==> THE ONLY ALL-CLEAR IN THIS HALF, AND IT IS ABOUT THE STORM. <==
       * The model ran across the whole storm and found no populated place in
       * reach of any water — Hernán, sitting mid-Pacific. A fact about where
       * the storm is, and safe to state plainly. */
      return `<p class="flood-line">No coastal flooding is modelled for this storm
          — it isn’t near enough to any populated coast.</p>
        <p class="flood-note">${esc(GDACS_PROVENANCE)}</p>`;
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
      return `<p class="flood-line">No coastal flooding has been modelled near your
          house for this storm.${deepest}</p>
        <p class="flood-note">This model only reports at populated coastal places,
          so this is a gap in what we know rather than an all-clear.</p>
        <p class="flood-note">${esc(GDACS_PROVENANCE)}</p>`;
    }

    if (out.state !== 'ok') {
      return `<p class="detail-soft">The modelled coastal flooding came back in a
        form this app could not read.</p>`;
    }

    const here = out.here;
    const where = `${esc(here.city)}${here.country ? `, ${esc(here.country)}` : ''}`;

    /* ==> NEGLIGIBLE IS WORDS, NOT A FIGURE (§51.1). <== The identical
     * judgement `RAIN.negligibleMm` records: a modelled 0.04 m printed as
     * "0.1 ft" under somebody's house reads as a malfunction, and said plainly
     * it reads as a forecast. */
    const headline = here.negligible || !here.heightText
      ? `<p class="flood-line">Only a trace of coastal flooding is modelled near
          you, at ${where}.</p>`
      : `<p class="flood-line"><strong>About ${esc(here.heightText)}</strong> of
          coastal flooding is modelled at ${where}, the nearest reporting point to
          your house.${spreadWords(here.arrivalHours, here.peakHours)}</p>`;

    /* Named only when it is somewhere else and meaningfully deeper — the
     * arithmetic for that lives in `surgeAtHome`, not here. */
    const worst = out.worst && !out.worst.negligible && out.worst.heightText
      ? `<p class="flood-worst">The deepest modelled anywhere on this storm is
          about ${esc(out.worst.heightText)} at ${esc(out.worst.city)}.</p>`
      : '';

    return `${headline}${worst}<p class="flood-note">${esc(GDACS_PROVENANCE)}</p>`;
  }

  /* -------------------------------------------------------------------------
   * THE SECTION
   * ---------------------------------------------------------------------- */

  /** True when `inner()` would produce something. The view asks before it
   *  writes the wrapper, so a `.home-sect` never renders around nothing.
   *
   *  ==> THE HOUSE IS THE WHOLE GATE. <== Both halves are questions about an
   *  address; with no pin set there is no question to put, and §5 does not
   *  require announcing that. */
  const applies = (storm, home) =>
    !!(home && (rain?.loadRainfall || rain?.loadPastRainfall || surge?.loadSurge));

  /** The INSIDE of the section — its heading and its contents.
   *
   *  ==> THE WRAPPER BELONGS TO THE VIEW AND THE CONTENTS BELONG HERE. <== The
   *  dashboard writes `.home-sect` for every one of its blocks, and repainting
   *  just this section after a fetch lands means replacing exactly what this
   *  function produced — which is only true if the element itself is not part
   *  of it. */
  function inner(storm, home, sectionHead) {
    if (!applies(storm, home)) return '';
    const rows = rowsHtml(home);
    /* WHAT IS HAPPENING, then WHAT HAS HAPPENED, then WHAT MIGHT — §48.6's
     * ranking extended by one (§56.14). */
    const past = pastHtml(home);
    const model = modelHtml(storm, home);
    /* THE HAIRLINE ONLY WHEN BOTH HALVES ARE THERE — see the storm panel's
     * copy of this line. Drawn under nothing it is a rule across an empty
     * section. The past block counts as rows for this purpose: it is the same
     * kind of content, about this address, above the modelled figure. */
    const above = rows || past;
    const seam = above && model ? ' flood-model--after-rows' : '';
    return `${sectionHead}${rows}${past}${model ? `<div class="flood-model${seam}">${model}</div>` : ''}`;
  }

  /* -------------------------------------------------------------------------
   * FETCH AND WIRE
   * ---------------------------------------------------------------------- */

  /** Dispatch both fetches if what we hold is not this house-and-storm's.
   *  Both are idempotent and cheap: `data/rainfall.js` holds one answer for
   *  `RAIN.clientTtlMs` and `data/gdacs-surge.js` holds one per storm for an
   *  hour, and every other surface reads the same two memos. */
  async function ensure(storm, home, repaint) {
    ensureRain(home, repaint);
    ensurePast(home, repaint);
    ensureSurge(storm, home, repaint);
  }

  async function ensurePast(home, repaint) {
    if (!home || !rain?.loadPastRainfall) return;
    if (pastCurrent(home) && pastState.phase !== 'idle') return;
    const mySeq = ++pastSeq;
    pastState = { phase: 'loading', result: null, forKey: homeKey(home) };
    const result = await rain.loadPastRainfall(home);
    if (mySeq !== pastSeq) return; // the home moved mid-flight
    pastState = { phase: 'done', result, forKey: homeKey(home) };
    repaint?.();
  }

  async function ensureRain(home, repaint) {
    if (!home || !rain?.loadRainfall) return;
    if (rainCurrent(home) && rainState.phase !== 'idle') return;
    const mySeq = ++rainSeq;
    rainState = { phase: 'loading', result: null, forKey: homeKey(home) };
    const result = await rain.loadRainfall(home);
    if (mySeq !== rainSeq) return; // the home moved mid-flight
    rainState = { phase: 'done', result, forKey: homeKey(home) };
    repaint?.();
  }

  async function ensureSurge(storm, home, repaint) {
    if (!modelApplies(storm, home)) return;
    if (surgeCurrent(storm, home) && surgeState.phase !== 'idle') return;
    const mySeq = ++surgeSeq;
    surgeState = { phase: 'loading', result: null, forKey: surgeKey(storm, home) };
    const result = await surge.loadSurge(storm);
    if (mySeq !== surgeSeq) return; // the storm or the house moved mid-flight
    surgeState = { phase: 'done', result, forKey: surgeKey(storm, home) };
    repaint?.();
  }

  /** Bind both retries inside an already-rendered section. Each EVICTS before
   *  refetching — the facades do — so a cached failure can never be the answer
   *  to a press. Without that the button would look like it worked and change
   *  nothing, which is the worst of both. */
  function wire(scope, storm, home, repaint) {
    /* The rows, as a keyboard- and pointer-reachable path into the same panel
     * a chip on the globe opens (§56.6). One delegated listener whatever the
     * list length — see `wireFloodAlertRows`. */
    if (openAlert) wireFloodAlertRows(scope, () => lastRows, openAlert);

    const rainBtn = scope?.querySelector?.('[data-retry="flood"]');
    if (rainBtn && rain?.retryRainfall) {
      rainBtn.addEventListener('click', async () => {
        if (!home) return;
        const mySeq = ++rainSeq;
        rainState = { phase: 'loading', result: null, forKey: homeKey(home) };
        repaint?.();
        const result = await rain.retryRainfall(home);
        if (mySeq !== rainSeq) return;
        rainState = { phase: 'done', result, forKey: homeKey(home) };
        repaint?.();
      });
    }

    const pastBtn = scope?.querySelector?.('[data-retry="flood-past"]');
    if (pastBtn && rain?.retryPastRainfall) {
      pastBtn.addEventListener('click', async () => {
        if (!home) return;
        const mySeq = ++pastSeq;
        pastState = { phase: 'loading', result: null, forKey: homeKey(home) };
        repaint?.();
        const result = await rain.retryPastRainfall(home);
        if (mySeq !== pastSeq) return;
        pastState = { phase: 'done', result, forKey: homeKey(home) };
        repaint?.();
      });
    }

    const surgeBtn = scope?.querySelector?.('[data-retry="flood-model"]');
    if (surgeBtn && surge?.retrySurge) {
      surgeBtn.addEventListener('click', async () => {
        if (!modelApplies(storm, home)) return;
        const mySeq = ++surgeSeq;
        surgeState = { phase: 'loading', result: null, forKey: surgeKey(storm, home) };
        repaint?.();
        const result = await surge.retrySurge(storm);
        if (mySeq !== surgeSeq) return;
        surgeState = { phase: 'done', result, forKey: surgeKey(storm, home) };
        repaint?.();
      });
    }
  }

  return { inner, applies, ensure, wire };
}
