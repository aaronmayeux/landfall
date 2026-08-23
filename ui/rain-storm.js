/**
 * rain-storm.js (ui) — the Rainfall section of the storm detail drawer.
 * SPEC §48.2, §48.9.
 *
 * ONE BLOCK, ONE SOURCE, ONE QUESTION: what NHC says this storm will drop.
 * The advisory's rainfall paragraph, rewrapped, in NHC's own words. A range
 * across an AREA, for the storm the reader is looking at.
 *
 * ==> THE READER'S HOUSE LEFT THIS FILE ON 2026-08-22 (§56.9). <== It used to
 * carry a second block — a gridded point forecast at the reader's address,
 * with its own fetch, its own state machine, its own retry and a two-tier
 * scope gate deciding how much of it a given storm earned. All of it is gone,
 * and none of it was deleted for being broken.
 *
 * It went because **a storm panel is about the storm.** The house figure is
 * true for every cyclone on the globe — it is a forecast about a PLACE — so
 * printing it under one storm's name puts a true number in a position that
 * claims a connection nobody made. The spec spent a whole section carving out
 * which parts of it survived which distance, and two rings of different sizes
 * for one house was a distinction no reader was ever going to hold. The
 * house's rain lives on the screen with the house on it.
 *
 * ==> WHICH ALSO RETIRES §48.10's ONE-SCREEN FIX, AND IT IS NO LOSS. <== That
 * section's worry was real: NHC's range says 8 to 12 inches across eastern
 * Maui, the grid at Kahului says 2.91, both are right, and a reader meeting
 * them on two screens concludes the app is broken. The fix was to put them
 * adjacent with a line between them explaining the difference. There is no
 * disagreement to explain now, because there is only one number here.
 *
 * A SELF-CONTAINED CONTROLLER, because `ui/view-storm-detail.js` is past §12's
 * file ceiling and only takes seams now — a section row, an ensure, a wire and
 * a repaint. Same shape as `ui/env-health.js`, deliberately.
 *
 * ==> IT SHOWS THE PARAGRAPH AND IT NEVER REWRITES IT. <== §48.2. NHC's range
 * IS the forecast; a summary of it would be a second opinion nobody asked for,
 * and a number extracted from it is a number that can disagree with NHC. This
 * file extracts nothing. That is also why there is no arithmetic in it and no
 * test of arithmetic behind it — `lib/advisory.js` finds the block, and finding
 * it is the whole job.
 *
 * ==> IT COSTS THE ADVISORY FETCH, AND THAT IS A REAL CHANGE. <== §48.2 says
 * "no new network", which is true of the SOURCE — this is the same product the
 * Advisory section already downloads. It is not true of the TIMING. The
 * Advisory section is collapsed by default and fetches on expand, so a reader
 * who never opens it never paid; an open-by-default Rainfall section means one
 * advisory page per storm opened. Measured: 30,712 bytes for Lala. It is
 * cached per advisory key and shared with the Advisory section, so opening
 * that afterwards is free.
 *
 * ==> FLOOD ALERTS LEFT THIS SECTION ON 2026-08-22 (§56.7). <== They shipped
 * here on 2026-08-21 as a third block, and the reason they went is not that
 * they did not fit: it is that burying an agency's live order inside a section
 * about a rainfall forecast makes the urgent thing look like a footnote on the
 * other thing. They are `Flooding` now — `ui/flooding-storm.js`, directly
 * below this. What is left here is a FORECAST, and only a forecast.
 *
 * ==> BOUND TO THE STORM IT BELONGS TO. <== `forId`/`forKey`, exactly the
 * advisory record's fix for a real on-glass bug: a record that infers "did the
 * storm change?" from call ordering shows the previous storm's words under the
 * next storm's name.
 *
 * Imports: lib/ and ui/ siblings, never data/ — the fetch arrives injected (§12).
 */

import { advisoryRainfall } from '../lib/advisory.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const RAIN_SECTION = 'rainfall';

/**
 * @param {object} deps injected by ui/view-storm-detail.js (§12 — ui/ never
 *   imports data/).
 * @param {(storm:object, opts?:object)=>Promise<object>} deps.loadAdvisory
 *   the SAME facade the Advisory section uses, so both read one cached record
 *   and can never show two different advisories for one storm.
 *
 * ==> ONE DEPENDENCY, AND IT USED TO BE FIVE. <== `rain`, `house`, `units` and
 * `now` were all the house block's (§56.9). They are gone with it, and the
 * fetch they carried is gone too: this panel no longer asks for a point
 * forecast at the reader's address at all. A reader who never opens the home
 * dashboard now pays nothing for it.
 */
export function createRainStorm({ loadAdvisory }) {
  let state = { phase: 'idle', rec: null, forId: null, forKey: null };
  let seq = 0;

  const isCurrent = (storm) =>
    !!storm && state.forId === storm.id && state.forKey === storm.advisoryKey;

  /** The section body's inner HTML for the current state. Pure of the DOM. */
  function html(storm) {
    return storm ? advisoryBlock(storm) : '';
  }

  /** What NHC says — a range across an area, in NHC's words. */
  function advisoryBlock(storm) {
    /* ==> A GDACS STORM IS ANSWERED WITHOUT A FETCH. <== NHC publishes the
     * rainfall paragraph; JTWC's warnings carry no equivalent labelled block.
     * The sentence is WORD FOR WORD §47.6's, so a reader who meets both
     * Environment and Rainfall outside NHC's basins learns one sentence rather
     * than two.
     *
     * ==> AND IT IS THE WHOLE SECTION AGAIN SINCE §56.9. <== For a month a
     * house block sat below this and answered for every basin, so
     * this line read as one source declining rather than as the app having
     * nothing. The house went back to the home screen, so on a GDACS storm
     * this section is once again a single sentence — and the reader's own
     * rainfall figure is one screen away rather than on this one. */
    if (storm.source !== 'nhc') {
      return `<div class="detail-soft">Not published for storms in this basin.</div>`;
    }

    if (!isCurrent(storm) || state.phase === 'idle' || state.phase === 'loading') {
      return `<div class="detail-soft">Checking the advisory${DOTS}</div>`;
    }

    const rec = state.rec || { state: 'unavailable' };

    if (rec.state !== 'ok' || !rec.text) {
      /* The advisory itself did not arrive. That is a real failure with a real
       * recovery, and it is worded as OUR problem rather than as a fact about
       * the storm's rain. */
      if (rec.state === 'unsupported') {
        return `<div class="detail-soft">Not published for storms in this basin.</div>`;
      }
      return `<div class="detail-soft">The advisory didn’t load, so there is no
        rainfall forecast to show.
        <button class="detail-retry" type="button" data-retry="rainfall">Retry</button></div>`;
    }

    const out = advisoryRainfall(rec.text);

    if (out.state === 'no_hazards') {
      /* ==> `None.` IS A REAL ANSWER (§48.2). <== A storm with no land threat
       * is not a storm whose rainfall failed to load, and the two must not
       * render the same. */
      return `<div class="detail-soft">NHC lists no land hazards for this storm.</div>`;
    }
    if (out.state !== 'ok') {
      /* The advisory arrived and carries no rainfall section. Rare, and stated
       * as a fact about this advisory rather than as an error — the reader can
       * open the Advisory section below and see for themselves. */
      return `<div class="detail-soft">This advisory has no rainfall section.</div>`;
    }

    /* NHC's own paragraphs, one element each. Rewrapped, because a teletype
     * product is hard-wrapped at ~68 columns and rendering those newlines gives
     * a ragged column on a phone (§48.2). */
    return out.paragraphs
      .map((p) => `<p class="detail-rain-para">${esc(p)}</p>`)
      .join('') +
      `<p class="detail-rain-note">In the National Hurricane Center’s own words,
        from the current public advisory.</p>`;
  }

  /**
   * Dispatch the advisory fetch if what we hold is not this storm's.
   *
   * Cheap to call on every render — the guard makes it idempotent, and
   * data/advisory.js's own cache makes a re-dispatch after stepping back to a
   * seen storm instant.
   */
  async function ensure(storm, repaint) {
    if (!storm || storm.source !== 'nhc' || !storm.advisoryKey) return;
    if (isCurrent(storm) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', rec: null, forId: storm.id, forKey: storm.advisoryKey };
    const rec = await loadAdvisory(storm);
    if (mySeq !== seq) return; // a newer storm took over mid-flight
    state = { phase: 'done', rec, forId: storm.id, forKey: storm.advisoryKey };
    repaint?.();
  }

  /** Bind the retry inside an already-rendered body. `data-retry` scopes the
   *  button so the geometry retry binding in the host view never collects it. */
  function wire(bodyEl, storm, repaint) {
    const btn = bodyEl?.querySelector?.('[data-retry="rainfall"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!storm) return;
      const mySeq = ++seq;
      state = { phase: 'loading', rec: null, forId: storm.id, forKey: storm.advisoryKey };
      repaint?.();
      const rec = await loadAdvisory(storm, { retry: true });
      if (mySeq !== seq) return;
      state = { phase: 'done', rec, forId: storm.id, forKey: storm.advisoryKey };
      repaint?.();
    });
  }

  return { html, ensure, wire };
}
