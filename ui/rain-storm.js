/**
 * rain-storm.js (ui) — the Rainfall section of the storm detail drawer.
 * SPEC §48.2, §48.9. The words are NHC's; this file finds them and lays them out.
 *
 * A SELF-CONTAINED CONTROLLER, because `ui/view-storm-detail.js` is past §12's
 * file ceiling and only takes seams now — a section row, an ensure, a wire and
 * a repaint. Everything with weight is here: the fetch state machine, the four
 * states, the retry, the HTML. Same shape as `ui/env-health.js`, deliberately,
 * because the next section to land should have an obvious thing to copy.
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
 * that afterwards is free — but the first storm drawer of a session now costs
 * 30 KB it did not cost before. That is the price of §48.1's complaint, which
 * is that rainfall currently sits where nobody opens it.
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
 * @param {{ loadAdvisory: (storm:object, opts?:object)=>Promise<object> }} deps
 *   injected by ui/view-storm-detail.js, which already holds this facade for
 *   the Advisory section. ONE facade, so both sections share one cached record
 *   and can never show two different advisories for one storm.
 */
export function createRainStorm({ loadAdvisory }) {
  let state = { phase: 'idle', rec: null, forId: null, forKey: null };
  let seq = 0;

  const isCurrent = (storm) =>
    !!storm && state.forId === storm.id && state.forKey === storm.advisoryKey;

  /** The section body's inner HTML for the current state. Pure of the DOM. */
  function html(storm) {
    if (!storm) return '';

    /* ==> A GDACS STORM IS ANSWERED WITHOUT A FETCH. <== NHC publishes the
     * rainfall paragraph; JTWC's warnings carry no equivalent labelled block.
     * The sentence is WORD FOR WORD §47.6's, so a reader who meets both
     * Environment and Rainfall outside NHC's basins learns one sentence rather
     * than two. */
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
