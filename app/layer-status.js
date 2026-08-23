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
 * THE ENVIRONMENT RIBBON — the decisions (§47.6, §47.9)
 * ------------------------------------------------------------------------- */

/* ==> TWO MORE ABSENCES, AND NEITHER OF THEM IS A FACT ABOUT SHIPS. <== §47.9.
 * Everything below this comment answers "what did the FETCH find". These two
 * answer "what happened when we tried to PAINT it", and the run can be
 * perfect for both of them:
 *
 *   no_ribs           — the cone rebuild declined for this advisory
 *                       (lib/cone-smooth.js), so the map is drawing NOAA's
 *                       published outline, which has no stations to slice.
 *                       Decided fresh per advisory, so it comes and goes.
 *   nothing_drawable  — the run's forecast hours do not reach any part of the
 *                       cone, so every slice was trimmed away.
 *
 * They were silent until 2026-08-18: the row is computed from the fetch, the
 * fetch was fine, so the row said nothing while the ribbon vanished. That is
 * the §5 failure exactly — an empty result that does not name which kind of
 * empty it is — and it is the one the reader is most likely to hit, because
 * it flips between advisories on a storm whose data never had a problem.
 *
 * NEITHER IS RETRYABLE. Both are answers about this advisory's geometry; the
 * next advisory is the recovery, and a Retry button would be one that cannot
 * work. `state: 'empty'`, like the basin and no-run sentences.
 */
const RIBBON_ABSENCE_ONE = Object.freeze({
  no_ribs: 'This cone could not be measured, so there is nothing to color',
  nothing_drawable: 'This run does not reach any part of this cone',
});

const RIBBON_ABSENCE_ALL = Object.freeze({
  no_ribs: 'These cones could not be measured, so there is nothing to color',
  nothing_drawable: 'These runs do not reach any part of their cones',
});

/** Did this storm's ribbon positively refuse for a reason we can name?
 *
 *  ==> POSITIVELY, AND THAT IS THE WHOLE GUARD. <== A storm that has never
 *  been decorated has no record, and one decorated while the layer was off
 *  carries `off`. Treating either as a refusal would put a confident sentence
 *  under the switch describing something that never happened. Only the two
 *  names above count. */
const refused = (reason) => !!RIBBON_ABSENCE_ONE[reason];

/**
 * One storm's SHIPS result → a row state, or null when there is nothing to
 * say beyond the row's standing note.
 *
 * ==> THE SIX ABSENCES ARE SIX DIFFERENT SENTENCES AND THEY MUST STAY THAT
 * WAY. <== They look identical on the map — an uncolored cone, every time —
 * and §5's whole rule is that an empty result has to name which kind of empty
 * it is. "SHIPS is not published for this ocean" is permanent and true;
 * "no run yet" is a wait measured in hours; "the file publishes no forecast
 * position" is a healthy file with nothing to paint, and it is 6% of the
 * season rather than an oddity; "the cone could not be measured" and "the run
 * does not reach the cone" are facts about the GEOMETRY on a run that is
 * fine; and only the fetch failure is a fault worth a retry.
 *
 * `undefined` is LOADING, not empty — a run that has not been asked for yet
 * and one that came back with nothing are different facts, and only one of
 * them is worth a spinner. Same rule the deck row above follows.
 *
 * @param {object|undefined} result  from data/ships.js
 * @param {string|null|undefined} [reason]  the ribbon slot's `reason` for this
 *        same storm, from `pipeline.ribbonReasonFor`. Optional: the fetch
 *        answers stand on their own, and the two geometry answers only ever
 *        ADD a sentence where there would otherwise be none.
 */
export function rowForOneShips(result, reason) {
  if (!result) return { state: 'loading' };

  if (result.status === 'unavailable') {
    return { state: 'error', message: 'Environment data unavailable — tap to retry' };
  }

  /* NOT an error and NOT a retry. SHIPS covers the Atlantic and the East and
   * Central Pacific; a typhoon has no run and never will, and offering a retry
   * would be a button that cannot work. */
  if (result.status === 'basin') {
    return { state: 'empty', message: 'Not published for storms in this basin' };
  }

  /* ==> "THE INTENSITY MODEL", NOT "SHIPS" (2026-08-22). <== §47.8 is explicit
   * that no replacement sentence says SHIPS at the reader — the name is real
   * provenance and belongs on the credit line, which is where the drawer puts
   * it. This row said SHIPS while the drawer said "the intensity model" about
   * the identical condition, so one storm produced two names for one thing on
   * two surfaces a tap apart. */
  if (result.status === 'no_run') {
    return { state: 'empty', message: 'No intensity model run published for this storm yet' };
  }

  /* A RUN EXISTS AND PUBLISHES NOTHING DRAWABLE, which the season proved is
   * not rare: twenty-three files in 2026 carried a full contribution table and
   * forecast winds with no forecast POSITION past hour 0, and a further 86
   * lost their positions short of +120 h. The file is perfectly healthy; there
   * is simply nowhere to put the color. A ribbon that ends mid-cone with no
   * explanation is the silence §5 forbids, so this is said even though nothing
   * has broken. */
  if (result.status === 'ok' && !result.run?.drawableHours) {
    return { state: 'empty', message: 'This run publishes no forecast track to color' };
  }

  /* LAST, because it is the weakest claim of the five above it. Every check
   * before this one is a fact about the run itself and outranks a fact about
   * what we managed to do with it — a storm outside the basin has no ribbon
   * for a reason that has nothing to do with its cone, and saying the cone
   * could not be measured would be true and useless. */
  if (refused(reason)) {
    return { state: 'empty', message: RIBBON_ABSENCE_ONE[reason] };
  }

  return null;
}

/**
 * The storms a SHIPS run could exist for.
 *
 * ENDED STORMS ARE NOT CANDIDATES, for the reason `deckCandidates` states: no
 * run is warmed for one, so a single ended storm in the list would hold the
 * row on `loading` permanently.
 */
export function shipsCandidates(storms) {
  return (storms || []).filter(
    (s) => (s?.source === 'nhc' || s?.source === 'gdacs') && !isEnded(s)
  );
}

/**
 * The whole map's environment state.
 *
 * ==> A HEALTHY STORM DOES NOT EXCUSE A BROKEN ONE, and a covered storm does
 * not excuse an uncovered one. <== The same rule `rowForAllDecks` learned
 * twice, applied from the start here. But the shape of the common case is
 * different and worth stating: this layer is NHC-only by nature, so with an
 * Atlantic hurricane and a typhoon both up, "some drawing, some not published
 * for their basin" is the NORMAL state rather than a partial outage — and
 * saying so on every mixed screen would be noise on a row that is working.
 *
 * So a real fault still speaks over a working storm, and pure coverage does
 * not. When NOTHING is drawing, the row says why in the words of whichever
 * absence covers every storm on screen, and falls back to a plain count when
 * they disagree.
 *
 * ==> "DRAWING" NOW MEANS THE RIBBON ACTUALLY BUILT, NOT JUST THAT THE FETCH
 * SUCCEEDED. <== §47.9. It used to mean the second, so one storm with a
 * healthy run silenced this row for the whole screen even when every cone on
 * it had refused to take the color — which is how the layer came to vanish
 * with nothing said anywhere (2026-08-18).
 *
 * @param {Array} results  one SHIPS result per candidate storm
 * @param {Array<string|null|undefined>} [reasons]  the SAME storms' ribbon
 *        reasons, IN THE SAME ORDER. Both arrays are built by one `map` over
 *        one candidate list in `environmentRow`, which is what makes the index
 *        join safe; `tools/test-layer-status.mjs` asserts the alignment rather
 *        than trusting it.
 */
export function rowForAllShips(results, reasons = []) {
  if (!results || !results.length) return null;

  const anyOk = results.some(
    (r, i) => r?.status === 'ok' && r.run?.drawableHours && !refused(reasons[i])
  );
  if (anyOk) {
    if (results.some((r) => r?.status === 'unavailable')) {
      return {
        state: 'error',
        message: 'Environment data unavailable for some storms — tap to retry',
      };
    }
    return null;
  }

  if (results.some((r) => !r)) return { state: 'loading' };

  /* ==> ANY FAULT, NOT EVERY FAULT. <== The deck row above asks whether they
   * are ALL unavailable, and that is right for a layer whose absences are all
   * the same kind. Here they are not: this layer is NHC-only, so a broken
   * Atlantic fetch sitting beside three typhoons that were never covered would
   * pass an every-test and come out as a coverage statement — a source outage
   * rendered as "not published for these basins", which is the §5 failure
   * exactly and the one this layer's shape makes easy to reach.
   *
   * A retryable fault therefore speaks over any number of permanent absences,
   * and the message says "for some storms" rather than claiming all of them. */
  const broken = results.filter((r) => r.status === 'unavailable').length;
  if (broken) {
    return {
      state: 'error',
      message: broken === results.length
        ? 'Environment data unavailable — tap to retry'
        : 'Environment data unavailable for some storms — tap to retry',
    };
  }

  if (results.every((r) => r.status === 'basin')) {
    return { state: 'empty', message: 'Not published for storms in these basins' };
  }

  if (results.every((r) => r.status === 'no_run')) {
    return { state: 'empty', message: 'No intensity model run published for these storms yet' };
  }

  /* THE GEOMETRY ABSENCES, and only when every storm on screen shares ONE of
   * them. A mixed screen — one cone that could not be measured beside one run
   * that does not reach its cone — falls through to the plain count below,
   * which is the same rule the basin and no-run sentences already follow: say
   * the specific thing when it is true of everything, say the general thing
   * when it is not. Never a sentence that is right about half the map. */
  for (const name of Object.keys(RIBBON_ABSENCE_ALL)) {
    if (results.every((r, i) => r.status === 'ok' && reasons[i] === name)) {
      return { state: 'empty', message: RIBBON_ABSENCE_ALL[name] };
    }
  }

  return { state: 'empty', message: 'No environment data for the current storms' };
}

/**
 * The environment row, whether or not a storm is selected. Same contract as
 * `modelTracksRow`, including its two precedence rules: a selected storm's own
 * state beats any count, and ENDED is checked before SILENT because a storm
 * that went quiet and was then confirmed over is both, and "may resume" is the
 * weaker of the two sentences to show about it.
 *
 * ==> A SILENT OR ENDED STORM HAS NO RIBBON EVEN IF ITS RUN IS PERFECT. <==
 * `withoutFuture` empties the forward-looking slots for both, so the cone this
 * layer paints inside is gone before the ribbon is ever built. Falling through
 * to the run's own status here would report a healthy environment layer while
 * the map drew nothing — the exact two-answers-to-one-question bug the deck
 * row shipped once and was corrected for.
 */
export function environmentRow(selected, storms, shipsFor, ribbonFor) {
  /* Optional so every existing caller and every existing assertion keeps its
   * meaning: with no lookup, nothing is known about any ribbon and the row
   * says exactly what it said before. */
  const reasonOf = (s) => (ribbonFor ? ribbonFor(s?.id) : undefined);

  if (selected) {
    if (isEnded(selected)) {
      return { state: 'empty', message: 'No environment — this system has ended' };
    }
    if (isSilent(selected)) {
      return {
        state: 'empty',
        message: `No environment — no update in over ${silenceHours()} hours`,
      };
    }
    return rowForOneShips(shipsFor(selected.advisoryKey), reasonOf(selected));
  }
  const candidates = shipsCandidates(storms);
  if (!candidates.length) return null;
  /* ONE list, TWO maps over it. The index join in `rowForAllShips` is only
   * safe because both arrays are built here, from this array, in this order. */
  return rowForAllShips(
    candidates.map((s) => shipsFor(s.advisoryKey)),
    candidates.map(reasonOf)
  );
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

    /** The environment row. Same contract as the model-tracks one above:
     *  everything it needs arrives as an argument, and the key is deleted
     *  outright when the layer is off so a stale sentence cannot survive the
     *  switch being flipped. */
    refreshEnvironment({ on, selected, storms, shipsFor, ribbonFor }) {
      const next = { ...status };
      delete next.environment;
      if (on) {
        const row = environmentRow(selected, storms, shipsFor, ribbonFor);
        if (row) next.environment = row;
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

    /**
     * The flood alerts row (§48.21), pushed up from main.js.
     *
     * ==> THREE OUTCOMES AND ONLY ONE OF THEM IS AN ALL-CLEAR. <== §5. A feed
     * that errored, a feed that answered with nothing in force, and a feed
     * whose alerts all turned out to be watches with no shape are three
     * different facts that produce the SAME empty globe. A row that could not
     * tell them apart would let an outage read as a quiet afternoon over a
     * flooding county — which is the exact failure this app is written against,
     * and it is worse here than anywhere because the layer's whole subject is
     * water already on the ground.
     *
     * ==> THE MIDDLE ONE CHANGED MEANING IN PHASE 4 AND STILL IS NOT AN ERROR.
     * <== §56.4. It used to say a watch is issued by zone and therefore cannot
     * be drawn, which was a fact about NWS's products. Zone boundaries are
     * resolved now, so what reaches this state is narrower and is about a
     * fetch: the alerts in force are ones whose boundaries did not come back.
     *
     * **It still carries no Retry**, and the reason is now weaker than it was —
     * asking again used to return the same shapeless rows by definition, where
     * a failed boundary lookup might succeed on a second try. It is left alone
     * because the boundaries are re-asked for on the next flood poll anyway,
     * and a Retry that fires a second fetch of a thirty-day-cached shape is a
     * button that mostly lies about what it did. Same rule
     * `data/radar-coverage.js` follows for a storm outside radar range.
     *
     * The key is deleted outright when the layer is off, so a sentence from a
     * previous fetch cannot survive the switch being flipped.
     */
    setFloodAlerts({ on, slot }) {
      const next = { ...status };
      delete next.floodAlerts;
      if (on && slot) {
        next.floodAlerts =
          slot.state !== 'ok'
            ? { state: 'error', message: 'Flood alerts could not be checked \u2014 tap to retry' }
            : slot.drawable
              ? { state: 'ok' }
              : {
                state: 'empty',
                message: slot.total
                  ? 'Flood alerts are in force, but their boundaries could not be fetched'
                  : 'No flood alerts are in force anywhere in the US',
              };
      }
      commit(next);
    },
  };
}
