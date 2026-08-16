/**
 * env-health.js (ui) — the Environment section of the storm detail drawer.
 * SPEC §47.8, rendered; the sentences themselves come from lib/env-health.js.
 *
 * A SELF-CONTAINED CONTROLLER, because ui/view-storm-detail.js is past §12's
 * file ceiling and §47.8 says nothing new goes into it. The view file keeps
 * only the seams — one section row, one ensure call, one wire call — and
 * everything with any weight lives here: the fetch state machine, the
 * staleness binding, the retry, the HTML.
 *
 * ==> THE SECTION IS ITS OWN GATE, AND FETCHES EVEN WITH THE MAP LAYER OFF.
 * <== The Environment LAYER warms a run per storm only while switched on,
 * because coloring every cone is a per-poll spend (§47.9). The PARAGRAPH is
 * one small JSON for the one storm the reader is already looking at, fetched
 * when the drawer opens — the same "the reading surface is the gate" pattern
 * the advisory section uses, sharing data/ships.js's cache so a reader with
 * the layer on pays nothing twice.
 *
 * ==> BOUND TO THE STORM IT BELONGS TO. <== `forId`/`forKey`, exactly the
 * advisory record's fix for a real on-glass bug (2026-07-25): a record that
 * infers "did the storm change?" from call ordering shows the previous
 * storm's words under the next storm's name. Anything not carrying the
 * current storm's id and advisory key is stale by definition.
 *
 * Imports: config/, lib/, never data/ — the fetch arrives injected (§12).
 */

import { envHealth } from '../lib/env-health.js';
import { DOTS } from './loading-dots.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ENV_SECTION = 'environment';

/**
 * @param {{ loadShips: (storm:object)=>Promise<object>,
 *           retryShips: (storm:object)=>Promise<object>,
 *           units: ()=>string|null }} deps  injected by app/views.js
 */
export function createEnvHealth({ loadShips, retryShips, units }) {
  let state = { phase: 'idle', result: null, forId: null, forKey: null };
  let seq = 0;

  const isCurrent = (storm) =>
    !!storm && state.forId === storm.id && state.forKey === storm.advisoryKey;

  /** The section body's inner HTML for the current state. Pure of the DOM. */
  function html(storm) {
    if (!storm) return '';
    if (!isCurrent(storm) || state.phase === 'idle' || state.phase === 'loading') {
      return `<div class="detail-soft">Checking the environment${DOTS}</div>`;
    }

    const out = envHealth(state.result, {
      system: units?.() ?? null,
      stormName: storm.name,
    });

    if (out.kind === 'replaced') {
      /* §5: the absence is stated, and only the one absence a retry can fix
       * gets a Retry. data-retry scopes the button so the geometry retry
       * binding in the host view never collects it. */
      const retry = out.retryable
        ? ` <button class="detail-retry" type="button" data-retry="environment">Retry</button>`
        : '';
      return `<div class="detail-soft">${esc(out.text)}${retry}</div>`;
    }

    /* ==> THE GRID IS PART OF THE ANSWER, NOT A DECORATION ON IT. <== §47.8's
     * sentences stopped reciting their own arithmetic when this existed to
     * carry it, so a build that renders the prose and drops the grid publishes
     * a paragraph with its figures missing. The two ship together or neither
     * does. `figures.cells` always closes on `figures.total`. */
    const cells = out.figures.cells.map((f) => `
      <div class="detail-env-fig">
        <span class="detail-env-fig-k">${esc(f.label)}</span>
        <span class="detail-env-fig-v">${esc(f.value)}</span>
      </div>`).join('');

    const notes = out.notes.length
      ? `<p class="detail-env-note">${out.notes.map(esc).join(' ')}</p>`
      : '';

    return `<p class="detail-env-paragraph">${out.sentences.map(esc).join(' ')}</p>
      <div class="detail-env-figs-head">${esc(out.figures.when)} — ${esc(out.figures.total)} in total</div>
      <div class="detail-env-figs">${cells}</div>
      ${notes}`;
  }

  /**
   * Dispatch the fetch if this storm's run is not what we hold. Cheap to call
   * on every render — the guard makes it idempotent, and data/ships.js's own
   * cache makes a re-dispatch after stepping back to a seen storm instant.
   */
  async function ensure(storm, repaint) {
    if (!storm || !storm.advisoryKey) return;
    if (isCurrent(storm) && state.phase !== 'idle') return;
    const mySeq = ++seq;
    state = { phase: 'loading', result: null, forId: storm.id, forKey: storm.advisoryKey };
    const result = await loadShips(storm);
    if (mySeq !== seq) return; // a newer storm took over mid-flight
    state = { phase: 'done', result, forId: storm.id, forKey: storm.advisoryKey };
    repaint?.();
  }

  /** Bind the retry inside an already-rendered body. The toggle IS the
   *  recovery everywhere else in the app; here the button is, and it evicts
   *  before refetching so a cached failure cannot answer the retry. */
  function wire(bodyEl, storm, repaint) {
    const btn = bodyEl?.querySelector?.('[data-retry="environment"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!storm) return;
      const mySeq = ++seq;
      state = { phase: 'loading', result: null, forId: storm.id, forKey: storm.advisoryKey };
      repaint?.();
      const result = await retryShips(storm);
      if (mySeq !== seq) return;
      state = { phase: 'done', result, forId: storm.id, forKey: storm.advisoryKey };
      repaint?.();
    });
  }

  return { html, ensure, wire };
}
