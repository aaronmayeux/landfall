/**
 * silence.js — "this source stopped publishing" (SPEC §5).
 *
 * ONE QUESTION, ASKED IN ONE PLACE: is the newest analysis we have for this
 * storm older than SILENCE.after? Everything else here is what follows from a
 * yes — which map geometry stops being drawable, and what the surfaces are
 * allowed to say instead.
 *
 * WHY THIS IS NOT `stale`. The app already had a staleness idea and it is a
 * different one: FRESHNESS bands the timestamp element amber at ~4 h and red
 * at ~9 h, on the assumption that an update is LATE and coming. Silence is the
 * assumption failing — the publisher has stopped, and the forecast on screen
 * is no longer a forecast, it is a leftover. The two must never be folded
 * together: banding a colour is cosmetic, and hiding a cone is not.
 *
 * WHAT IT DOES NOT CLAIM. Not that the storm dissipated, not that it is safe,
 * not that anything is over. GDACS froze on Noul at landfall; the storm was
 * very much still happening. All this knows is that nobody has said anything
 * new, and every string below is written to say only that.
 *
 * KEEP HISTORY, DROP THE FUTURE. `pastTrack` and `windSwath` are records of
 * where the storm has been — a day-old record of the past is still true. The
 * cone, forecast track, forecast points, model guidance, the current wind
 * field and any watch/warning stripe are all claims about now or next, and a
 * day of silence is not enough to keep making them.
 *
 * Pure functions. No DOM, ever. Imports: config/, lib/time.js.
 */

import { SILENCE } from '../config/constants.js';
import { ageMs, formatClockDay } from './time.js';

const HOUR = 60 * 60 * 1000;

/** Age of the newest ANALYSIS we hold for this storm, in ms, or null.
 *
 *  `observedAt` and nothing else. Both feeds publish a second timestamp that
 *  moves without a new fix behind it — GDACS `datemodified` is the one that
 *  caught us — and reading either would make this test permanently pass. See
 *  the SILENCE note in config/constants.js. */
export function silenceAge(storm, now = Date.now()) {
  return ageMs(storm?.observedAt, now);
}

/** True when the source has published nothing new for longer than the
 *  threshold. An UNKNOWN age is NOT silent: a storm whose stamp we could not
 *  parse is a storm we know nothing about either way, and hiding its forecast
 *  on a parse failure would be inventing a fact out of our own bug. */
export function isSilent(storm, now = Date.now()) {
  const age = silenceAge(storm, now);
  return age != null && age > SILENCE.after;
}

/** The agency, in the words a reader should see. Distinct from
 *  view-storm-detail's `sourceLabel`, which builds "the GDACS feed" to sit
 *  mid-sentence in the ghost note; these are the names as a subject. An
 *  unknown source degrades to wording that credits nobody rather than
 *  guessing. */
export function sourceName(source) {
  if (source === 'nhc') return 'the National Hurricane Center';
  if (source === 'gdacs') return 'GDACS';
  return 'this storm’s source';
}

/** Whole hours in the threshold, for copy. DERIVED, never typed: the badge
 *  says "24 hours" because the constant says 24 hours, so moving the constant
 *  can never leave the sentence behind claiming the old one. */
export function silenceHours() {
  return Math.round(SILENCE.after / HOUR);
}

/** Bundle slots that make a claim about NOW or NEXT, and therefore stop being
 *  drawable once the source goes quiet.
 *
 *  `windCurrent` is on this list and `windSwath` is not, which is the whole
 *  rule in one pair: the current wind field says "these are the winds out
 *  there", and after a day of silence nobody knows that. The swath says
 *  "these are the winds this storm has already laid down", which stays true no
 *  matter how long the silence runs.
 *
 *  `watchWarning` is here for a sharper reason than tidiness. Those are live
 *  government orders, and a day-old evacuation stripe painted as current is
 *  the most dangerous thing this app could draw. */
export const SILENCED_SLOTS = Object.freeze([
  'cone',
  'forecastTrack',
  'forecastPoints',
  'watchWarning',
  'modelTracks',
  'windCurrent',
]);

/** An emptied slot. `none` rather than `unavailable`: nothing failed, and a
 *  layer row reporting a fault it did not have would send someone hunting a
 *  dead endpoint. */
const EMPTY_SLOT = Object.freeze({ status: 'none', fc: null, error: null });

/**
 * A bundle with every forward-looking slot emptied, plus `forecast` cleared so
 * the closest-approach maths has nothing to run on.
 *
 * A SHALLOW COPY, never a mutation — the same rule main.js follows for model
 * tracks, and for the same reason: the bundle is a cached object shared with
 * the ambient collections and the cage's ridge builder, so writing into it
 * would silence a storm everywhere it is held, permanently, including after a
 * fresh advisory arrives and un-silences it.
 *
 * `stamp` is deliberately preserved. The panel still needs to say which
 * advisory the surviving past track came from.
 */
export function silenceBundle(bundle) {
  if (!bundle || !bundle.layers) return bundle;
  const layers = { ...bundle.layers };
  for (const key of SILENCED_SLOTS) {
    if (key in layers) layers[key] = EMPTY_SLOT;
  }
  return { ...bundle, layers, forecast: [] };
}

/**
 * The badge, as two strings, or null when the storm is not silent.
 *
 * `headline` names the agency because with two feeds in the app "no updates"
 * leaves the reader unable to tell which half of the world just went quiet.
 * It leads with the fact and hands over the timestamp in the same breath —
 * an absolute time, because a relative one gets less useful the older it gets
 * and this state only ever gets older.
 *
 * `detail` exists to ACCOUNT FOR WHAT WAS REMOVED. Under this change the cone
 * and forecast points vanish from the map, and a missing cone with nothing
 * explaining it reads as a broken app, not as an honest one. It closes on
 * "may no longer be active" and stops there: we know the publisher stopped, we
 * do not know the storm did.
 */
export function silenceNote(storm, now = Date.now()) {
  if (!isSilent(storm, now)) return null;
  const who = sourceName(storm.source);
  const clock = formatClockDay(storm.observedAt);
  return {
    headline: clock
      ? `No updates from ${who} since ${clock}`
      : `No updates from ${who}`,
    detail:
      `Forecast hidden after ${silenceHours()} hours without an update. ` +
      'Position shown is last known. This storm may no longer be active.',
  };
}

/**
 * The one-line form, for a panel section whose content was hidden.
 *
 * THIS EXISTS BECAUSE THE EMPTY SLOTS LIE. Every section on the detail panel
 * reads its slot's status and writes a sentence from it, and those sentences
 * were written for a slot that came back empty ON ITS OWN: "None in effect."
 * for watches and warnings, "No wind field published for this advisory." for
 * the wind field. Emptying the slot here without also changing what the
 * section says would turn a hidden warning into a published all-clear — §5's
 * exact failure, manufactured by the fix for §5's exact failure.
 *
 * So every section that reads a silenced slot branches on silence FIRST and
 * says this instead.
 */
export function silenceSectionNote(storm, now = Date.now()) {
  if (!isSilent(storm, now)) return null;
  return `Hidden — no update from ${sourceName(storm.source)} in over ${silenceHours()} hours.`;
}

/** The count word for the storm pill and list rows, where there is no room
 *  for a sentence. Lower case: it appears mid-phrase ("2 active · 1 not
 *  updating") and as a row suffix. */
export const SILENT_SHORT = 'not updating';
