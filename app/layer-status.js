/**
 * layer-status.js — what each row in the Layers panel says about itself.
 *
 * §7 gives every layer row its own state: loading, empty with a reason, or an
 * error with a retry. This file decides which one, for the two layers that
 * actually have something to report — model guidance and imagery.
 *
 * ==> WHY THIS IS ITS OWN FILE <==
 * It lived inside boot()'s closure, where it could not be tested, and it has
 * already produced TWO of the §5 silences this project exists to prevent:
 *
 *   1. `statusForAll` filtered to NHC storms, on the reasoning that the row's
 *      standing "NHC storms only" caveat covered everything else. When TCGP
 *      brought guidance to the GDACS basins, that filter turned from a true
 *      description into a silence — with only a typhoon on screen the row
 *      returned null and said NOTHING AT ALL, in any condition.
 *   2. It returned null the moment ANY deck was ok — "something is drawing, so
 *      there is nothing to say" — which swallowed exactly the partial outage
 *      that is the NORMAL shape of a failure across two independent feeds.
 *
 * Both were reasoning errors in a pure function that nothing could exercise.
 * Out here `tools/test-layer-status.mjs` covers them.
 *
 * THE DECISIONS ARE PURE AND THE STORE IS THIN. Everything below the fold is
 * plain data in, a row state out. `createLayerStatus` holds the object the
 * view reads and nothing else.
 *
 * Imports: lib/ only. No DOM, no network, no map.
 */

import { isEnded } from '../lib/lifecycle.js';
import { isSilent, silenceHours } from '../lib/silence.js';

/* ---------------------------------------------------------------------------
 * MODEL GUIDANCE — the decisions
 * ------------------------------------------------------------------------- */

/**
 * One storm's deck result → a row state, or null when there is nothing to say.
 *
 * `undefined` is LOADING, not empty. A deck that has not been asked for yet
 * and a deck that came back with nothing are different facts, and only one of
 * them is worth a spinner.
 */
export function rowForOneDeck(result) {
  if (!result) return { state: 'loading' };

  if (result.status === 'unavailable') {
    return { state: 'error', message: 'Model guidance unavailable — tap to retry' };
  }

  /* NOT an error and NOT a retry — but ALSO not "no models forecast this
   * storm", which is what this used to say. The models cover the whole
   * planet; what varies is whether anyone FILES a deck we can read. NOAA
   * covers al/ep/cp and UCAR's TCGP covers wp/io/sh, so this now fires only
   * for the handful of basins neither files — South Atlantic, Mediterranean.
   * The wording names the coverage gap rather than inventing a data gap. */
  if (result.status === 'unsupported') {
    return { state: 'empty', message: "Guidance isn't published for this basin" };
  }

  if (result.status === 'none') {
    return { state: 'empty', message: 'No guidance published for this storm yet' };
  }

  return null;
}

/**
 * The storms a deck could exist for.
 *
 * ENDED STORMS ARE NOT CANDIDATES. They have no deck and never will, so one
 * ended storm in the list would hold the row on `loading` permanently — and
 * once the last live storm ends, the row would report a source problem for a
 * basin that simply has nothing in it.
 *
 * A storm from neither feed is left out because there is genuinely nothing to
 * report about it.
 */
export function deckCandidates(storms) {
  return (storms || []).filter(
    (s) => (s?.source === 'nhc' || s?.source === 'gdacs') && !isEnded(s)
  );
}

/**
 * The whole map's guidance state, from every candidate storm's deck result.
 *
 * ===> A HEALTHY STORM DOES NOT EXCUSE A BROKEN ONE. <=======================
 * This used to return null the moment ANY deck was ok. That is the §5 silence
 * rule broken from the inside: two working NHC decks hid a GDACS storm failing
 * outright, and the row stayed quiet with a storm on screen carrying no
 * guidance and no explanation for its absence.
 *
 * The two feeds fail independently and for unrelated reasons, so "some ok,
 * some broken" is the NORMAL shape of a partial outage here, not an edge case
 * — and it is the one shape the old check was guaranteed to swallow. A row
 * that only speaks when everything is broken cannot report the failures that
 * actually happen.
 *
 * A partial failure keeps the RETRY, unlike the coverage cases: some decks
 * already loaded, so the network is demonstrably fine and the ones that failed
 * have a real chance of succeeding.
 */
export function rowForAllDecks(results) {
  if (!results || !results.length) return null;

  const anyOk = results.some((r) => r?.status === 'ok');
  if (anyOk) {
    if (results.some((r) => r?.status === 'unavailable')) {
      return {
        state: 'error',
        message: 'Model guidance unavailable for some storms — tap to retry',
      };
    }
    /* Everything else that is not ok is a coverage statement, not a fault — a
     * basin nobody files a deck for, or a deck still in flight. Neither is
     * worth interrupting a row that is drawing real guidance. */
    return null;
  }

  if (results.some((r) => !r)) return { state: 'loading' };

  if (results.every((r) => r.status === 'unavailable')) {
    return { state: 'error', message: 'Model guidance unavailable — tap to retry' };
  }

  /* Every storm up is in a basin no source files a deck for — a coverage
   * statement, and one that offers no retry because none would help. */
  if (results.every((r) => r.status === 'unsupported')) {
    return { state: 'empty', message: "Guidance isn't published for these basins" };
  }

  return { state: 'empty', message: 'No guidance published for the current storms' };
}

/**
 * The model-tracks row, whether or not a storm is selected.
 *
 * WHEN A STORM IS SELECTED the row describes THAT storm — it is the one the
 * user is looking at, and "guidance for Fausto has not been published yet" is
 * a far more useful sentence than any count.
 *
 * WITH NOTHING SELECTED it describes the whole set, because that is what the
 * layer is drawing.
 *
 * ==> AN ENDED SELECTION HAS NO GUIDANCE, AND SAYING SO IS NOT OPTIONAL. <==
 * Without the ended branch the row sits on "loading" forever: nothing warms a
 * deck for an ended storm, so the lookup returns undefined and
 * `rowForOneDeck(undefined)` is a spinner on a row that will never resolve,
 * blaming the network for a storm that is over. `empty` and not `error` —
 * guidance is a FORECAST product, this storm has no future to forecast,
 * nothing has failed, and a retry would fetch a deck that no longer exists.
 *
 * @param {object|null} selected  the selected storm, or null
 * @param {Array} storms  every storm currently held
 * @param {(key: string) => object|null} deckFor  the warmed deck lookup
 */
export function modelTracksRow(selected, storms, deckFor) {
  if (selected) {
    if (isEnded(selected)) {
      return { state: 'empty', message: 'No guidance — this system has ended' };
    }
    /* ==> SILENT COUNTS TOO, AND LEAVING IT OUT WAS THE ROW LYING. <==
     * `withoutFuture` empties the `modelTracks` slot for a SILENT storm exactly
     * as it does for an ended one — guidance is a forward-looking claim and
     * nobody is publishing for this system. But only the ended case was
     * answered here, so a silent storm fell through to the deck's own status,
     * which is very often a healthy `ok`: the map drew no guidance while this
     * row reported that guidance was fine. Two answers to one question on one
     * screen, and the wrong one was the reassuring one.
     *
     * The ended case is checked FIRST and stays first — §5's precedence rule,
     * stated once in lib/lifecycle.js: a storm that went quiet and was THEN
     * confirmed over is both, and "may resume" is the weaker, less honest of
     * the two sentences to show about it. */
    if (isSilent(selected)) {
      return {
        state: 'empty',
        message: `No guidance — no update in over ${silenceHours()} hours`,
      };
    }
    return rowForOneDeck(deckFor(selected.advisoryKey));
  }
  const candidates = deckCandidates(storms);
  if (!candidates.length) return null;
  return rowForAllDecks(candidates.map((s) => deckFor(s.advisoryKey)));
}

/* ---------------------------------------------------------------------------
 * THE STORE
 * ------------------------------------------------------------------------- */

/**
 * The per-layer status object the Layers view reads, plus the two setters that
 * change it.
 *
 * KEYED BY PREF KEY, not engine key, because that is what a row is.
 *
 * REPLACED, NEVER MUTATED. The view compares what it was handed against what
 * it has; writing into the held object would make those two the same object
 * and the comparison always true.
 *
 * @param {() => void} onChange  called after any change — the view's refresh
 */
export function createLayerStatus(onChange) {
  let status = {};

  const commit = (next) => {
    status = next;
    onChange?.();
  };

  return {
    /** What the Layers view renders from. */
    value: () => status,

    /**
     * Recompute the model-guidance row. Takes the whole world it needs as
     * arguments rather than holding references to the store — this file has
     * no business knowing where storms come from.
     */
    refreshModelTracks({ on, selected, storms, deckFor }) {
      const next = { ...status };
      delete next.modelTracks;
      if (on) {
        const row = modelTracksRow(selected, storms, deckFor);
        if (row) next.modelTracks = row;
      }
      commit(next);
    },

    /**
     * The imagery row, pushed up from map/imagery.js.
     *
     * Same shape as the model-tracks row and for the same reason: it reports
     * the WHOLE SET and only goes amber when the failure is total. One storm
     * outside radar coverage while three others draw is the normal state of a
     * basin, not a fault.
     */
    setImagery(row) {
      const next = { ...status };
      if (row) next.imagery = row;
      else delete next.imagery;
      commit(next);
    },
  };
}
