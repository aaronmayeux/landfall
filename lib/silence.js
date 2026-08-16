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
 * together: banding a color is cosmetic, and hiding a cone is not.
 *
 * WHAT IT DOES NOT CLAIM. Not that the storm dissipated, not that it is safe,
 * not that anything is over. GDACS froze on Noul at landfall; the storm was
 * very much still happening. All this knows is that nobody has said anything
 * new, and every string below is written to say only that.
 *
 * KEEP HISTORY, DROP THE FUTURE — the rule a silent storm's geometry follows,
 * now shared with §5's ended state and therefore living in
 * lib/future-slots.js. Read that file for which slots go and why.
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

/* THE SLOT LIST AND THE EMPTYING ARE NOT HERE ANY MORE — they live in
 * lib/future-slots.js as `FUTURE_SLOTS` and `withoutFuture`, and callers import
 * them from there.
 *
 * They moved when §5's ended state became the second caller: a storm whose
 * agency has issued its final bulletin has the identical problem this file
 * describes. There is deliberately NO alias left behind under the old
 * silence-flavoured names. Two names for one rule is the drift this extraction
 * exists to prevent, and an alias is how the copy comes back. */

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
      (jtwcQuiet(storm)
        ? 'The Joint Typhoon Warning Center has no warning under this name either. '
        : '') +
      'Position shown is last known and the forecast is hidden. ' +
      'This storm may no longer be active.',
  };
}

/**
 * Is JTWC's active list ALSO free of this storm?
 *
 * ==> WHY THE HEADLINE DOES NOT SAY "NOBODY IS PUBLISHING". <==
 * Two agencies quiet is a materially stronger signal than one, and it was
 * drafted as the headline: "Nothing published on this system since Thursday."
 * It does not survive its own guard. `jtwcRoster.listed` is the result of a
 * NAME lookup (lib/advisory.js `matchStormByName`), and JTWC carries systems
 * it has not named yet as bare designations — `13W`, which keys to nothing.
 * So `listed: false` means "no warning under this NAME", which is not the same
 * claim as "no warning", and a system JTWC is actively warning on as `13W`
 * would get a badge announcing that nobody is publishing on it. That is a §5
 * false statement of exactly the kind this file exists to prevent.
 *
 * So the corroboration goes in the DETAIL, in the words that are actually
 * true — the same framing the Advisory section already uses, where there is
 * room to say "under this name" and have it read as the qualifier it is.
 *
 * `undefined` roster (an NHC storm, or a JTWC index we could not read) is not
 * a quiet JTWC. It is no information, and it adds no sentence.
 */
function jtwcQuiet(storm) {
  return storm?.jtwcRoster ? storm.jtwcRoster.listed === false : false;
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
