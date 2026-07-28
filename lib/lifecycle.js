/**
 * lifecycle.js — "this storm has ended" (SPEC §5).
 *
 * ===========================================================================
 * THE FIFTH STATE, AND WHY THE APP NEEDED IT
 * ===========================================================================
 *
 * Beside `unavailable` / `none_matched` / `clear` / `silent` there is now
 * `ended`. Until this landed, a storm's death was a DELETION: GDACS flips
 * `iscurrent` to "false" and data/gdacs.js drops the event at parse; NHC
 * retires a storm and it is simply absent from CurrentStorms.json. Either way
 * the dot, the track, the badge and the row vanished between one poll and the
 * next, with nothing anywhere saying what happened. A user watching a landfall
 * saw the storm they were following disappear and had no way to tell that from
 * the app breaking.
 *
 * ===========================================================================
 * THIS FILE ASKS NOTHING. IT ONLY SAYS WHAT FOLLOWS.
 * ===========================================================================
 *
 * The DETECTION lives in data/lifecycle.js, because deciding a storm has ended
 * takes state across polls and a persisted registry, and none of that can be a
 * pure function. What lives here is everything downstream of the answer: the
 * predicate over a storm that already carries an `ended` record, the precedence
 * against silence, and every string the reader sees.
 *
 * The split matters for one reason: this file is what the UI imports, and the
 * UI must not be able to accidentally re-decide whether a storm is dead.
 *
 * ===========================================================================
 * THE WORDING RULE, AND IT IS THE WHOLE POINT OF THE FILE
 * ===========================================================================
 *
 * ==> NEVER SAY THE STORM DISSIPATED. <==
 *
 * We do not know that, and on the NHC side it is frequently FALSE. A final
 * public advisory is most often issued on a system that became POST-TROPICAL or
 * EXTRATROPICAL — Post-Tropical Cyclone Imelda's final advisory (AL092025 #24,
 * read live 2026-07-28) described "a large and powerful system" carrying 75 mph
 * winds across the central Atlantic. NHC stopped writing about her because she
 * stopped being their desk's problem, not because she stopped existing.
 * "Imelda has dissipated" would have been a confident false statement about
 * weather, in a safety-adjacent app, on the strength of a bulletin that said
 * nothing of the kind. That is §5's failure with a friendlier face — the same
 * mistake as an "All Clear" during an outage.
 *
 * SO EVERY STRING BELOW REPORTS AN AGENCY ACTION, NOT A METEOROLOGICAL FACT.
 * "The National Hurricane Center issued its final advisory on this system" is
 * something we read in words and can stand behind. Where NHC's own last
 * classification tells us what the system BECAME, we pass that along — "became
 * post-tropical" is accurate, attributable, and is the honest version of what
 * "dissipated" was reaching for.
 *
 * The one place the d-word is allowed is where JTWC uses it itself.
 *
 * ===========================================================================
 * ATTRIBUTION IS TO WHOEVER SPOKE, NOT TO WHOSE STORM IT IS
 * ===========================================================================
 *
 * A GDACS storm's ending is usually DECLARED BY JTWC, because GDACS publishes
 * no bulletin of any kind and JTWC's final warning is the only statement in
 * existence for those basins. So the record carries `by` separately from the
 * storm's own `source`, and the copy names `by`. Crediting GDACS for a sentence
 * JTWC wrote would be wrong in the one way this app cannot afford: a reader who
 * went looking for it at the named agency would not find it.
 *
 * Pure functions. No DOM, ever. Imports: config/, lib/time.js.
 */

import { ENDED } from '../config/constants.js';
import { palette } from '../config/theme.js';
import { categoryColor } from './category.js';
import { isSilent } from './silence.js';
import { ageMs, formatClockDay } from './time.js';

/* ---------------------------------------------------------------------------
 * THE PREDICATE
 * ------------------------------------------------------------------------- */

/**
 * Has this storm ended?
 *
 * A PLAIN LOOKUP, NOT A TEST. The `ended` record is written once, by
 * data/lifecycle.js, at the moment the evidence arrived — and from then on it
 * is a fact about the storm rather than a question to re-ask. That is the
 * opposite of `isSilent`, which recomputes from a timestamp on every call
 * because silence is a condition a storm can walk back out of.
 *
 * An ended storm CANNOT walk back out of it here. If a source starts
 * publishing a storm again, data/lifecycle.js removes the record (it does, and
 * deliberately — see `revive` there); it does not get argued with downstream.
 */
export function isEnded(storm) {
  return !!storm?.ended;
}

/**
 * Is there any published wind for this storm RIGHT NOW?
 *
 * ==> THE ONE QUESTION THE GLOBE ASKS. <== `ended` and `silent` are different
 * facts with different words and different badges, and every text surface keeps
 * them apart. The cage and the map dot do not care about the difference: both
 * are asking "does anybody currently publish a wind for this storm", and for
 * both states the answer is no. An ended storm's agency has issued its final
 * bulletin; a silent storm's agency has published nothing for over a day.
 *
 * WHY IT IS ONE FUNCTION AND NOT TWO CHECKS AT EACH CALL SITE. Three surfaces
 * ask it — the cage head, the last-known-position dot, and the swatch. Written
 * out three times, one of them drifts, and the result is a storm drawn grey on
 * the globe and Cat 4 red in the list: two answers to "how bad is this" on one
 * screen, which is the §9 failure the fixed colours exist to prevent.
 *
 * `isSilent` recomputes from a timestamp and `isEnded` is a stored fact, so
 * this takes a clock and passes it down. Callers that are ordering things must
 * inject one — a predicate reading the clock per comparison can place the same
 * storm on both sides of the line inside a single sort.
 */
export function noCurrentReading(storm, now = Date.now()) {
  return isEnded(storm) || isSilent(storm, now);
}

/**
 * Is this ended storm past its grace period and due to be dropped?
 *
 * ONLY data/lifecycle.js SHOULD ACT ON THIS. It is exported because the
 * registry's sweep and its tests are the callers; no UI surface should be
 * making its own decision about whether a storm is still on screen, because
 * two surfaces disagreeing produces a storm that is in the list and not on the
 * globe, which reads as a rendering bug.
 */
export function endedExpired(storm, now = Date.now()) {
  if (!isEnded(storm)) return false;
  const age = ageMs(storm.ended.at, now);
  /* An UNREADABLE stamp expires immediately rather than living forever. This is
   * the safe direction here and it is worth stating why, since everywhere else
   * in this project an unparseable timestamp means "make no claim": the claim
   * being made by keeping it is that a dead storm is still worth screen space,
   * and the cost of getting that wrong is a grey dot that never leaves. A
   * corrupt localStorage record must not become permanent furniture. */
  return age == null || age > ENDED.holdFor;
}

/**
 * Precedence over silence, stated once so no surface has to work it out.
 *
 * A storm that went quiet and was THEN confirmed gone is both silent and
 * ended, and every surface would otherwise pick its own winner. `ended` wins
 * everywhere: "no updates in over 24 hours, this storm may no longer be
 * active" is a hedge, and once the agency has said it is finished — or three
 * clean polls have agreed it is gone — hedging is the less honest answer.
 *
 * The reverse order would be actively bad. It would leave the app saying "may
 * no longer be active" about a storm whose final advisory we have read.
 */
export function endedWins(storm) {
  return isEnded(storm);
}

/**
 * The colour that stands for this storm — its category colour, or the ended
 * grey.
 *
 * ==> EXTRACTED BECAUSE FOUR SURFACES ASK IT. <== The list row swatch, the same
 * swatch again on the in-place patch path, the detail panel's identity block,
 * and the cage's head bead. Written out four times, one of them drifts, and the
 * result is a storm that is grey on the globe and Cat 4 red in the list — two
 * answers to "how bad is this" on one screen, which is the §9 failure the fixed
 * colours exist to prevent, arriving through the back door.
 *
 * THIS DOES NOT WEAKEN §6. The Saffir-Simpson colours stay fixed and
 * unthemeable for every storm that has a category to show. A storm with no
 * current reading has none — nobody is publishing a wind for it — so this
 * returns the absence of a severity claim rather than a different one.
 *
 * THE TOKEN IS `stormEnded` AND IT COVERS BOTH STATES. Silent and ended are
 * told apart in words — the badge, the row qualifier, the section notes — and
 * never by hue. A second grey would be a second severity vocabulary for a
 * distinction the colour channel is not carrying.
 */
export function stormSwatch(storm, now = Date.now()) {
  return noCurrentReading(storm, now)
    ? palette().stormEnded
    : categoryColor(storm?.category, storm?.nature, storm?.categoryCode);
}

/* ---------------------------------------------------------------------------
 * THE WORDS
 * ------------------------------------------------------------------------- */

/** The agency, as the SUBJECT of a sentence about something it did.
 *
 *  Distinct from lib/silence.js `sourceName`, which builds the same idea for a
 *  sentence about something that DIDN'T happen ("No updates from GDACS"), and
 *  from view-storm-detail's `sourceLabel`, which builds "the GDACS feed" to sit
 *  mid-sentence. Three shapes because the grammar differs; one would need a
 *  case flag at every call site.
 *
 *  `jtwc` is on this list and is NOT a storm source anywhere else in the app —
 *  it is the agency that declares the end for GDACS-basin storms. */
export function agencyName(by) {
  if (by === 'nhc') return 'The National Hurricane Center';
  if (by === 'jtwc') return 'The Joint Typhoon Warning Center';
  if (by === 'gdacs') return 'GDACS';
  return 'The issuing agency';
}

/** What NHC's last classification says the system BECAME, in plain words, or
 *  null when it says nothing useful.
 *
 *  This is the ONLY place the app describes a physical transition, and it can,
 *  because NHC's own `classification` field is the one making the claim. A
 *  storm still classified TD/TS/HU at its final advisory gets null — NHC
 *  stopped writing, and nothing published says what became of it. Silence
 *  beats a guess (§5). */
export function becameWhat(nature) {
  if (nature === 'post-tropical') return 'became post-tropical';
  if (nature === 'remnant') return 'weakened to a remnant low';
  if (nature === 'subtropical') return 'became subtropical';
  return null;
}

/**
 * The badge, as two strings, or null when the storm has not ended.
 *
 * `headline` NAMES THE AGENCY AND WHAT IT DID, and hands over the time in the
 * same breath — absolute, not relative, for the same reason the silence badge
 * uses absolute time: this state only ever gets older, and "38 hrs ago" is
 * less useful than "Thu 11:00 AM" the moment it stops being today.
 *
 * `detail` ACCOUNTS FOR WHAT WAS REMOVED. The cone, the forecast track, the
 * forecast points and any watch/warning stripe are gone from the map by the
 * time a reader sees this, and a missing cone with nothing explaining it reads
 * as a broken app rather than an honest one — the same trap the silence badge
 * documents. It also states plainly that the position is the last published
 * one, because a dot on a globe looks current no matter how old it is.
 *
 * THE TWO REASONS GET DIFFERENT SENTENCES ON PURPOSE, and the difference is
 * how much we know:
 *
 *   declared  we read the words. We can name the agency, name the product, and
 *             say the ending is intentional and official.
 *   absent    nobody said anything. All we can honestly report is that the
 *             storm is no longer in a feed that is otherwise working — which is
 *             weaker, and is written weaker.
 *
 * Collapsing the two into one sentence would mean either overclaiming on
 * `absent` (asserting a final bulletin we never saw) or underclaiming on
 * `declared` (hedging about a storm whose final advisory we have in hand).
 */
export function endedNote(storm) {
  if (!isEnded(storm)) return null;
  const { reason, by, at, became } = storm.ended;
  const who = agencyName(by);
  const clock = formatClockDay(at);

  if (reason === 'declared') {
    const what = by === 'jtwc' ? 'final warning' : 'final advisory';
    return {
      /* THE COMMA IS LOAD-BEARING, which is a silly sentence about punctuation
       * until you read the version without it: "issued its final advisory on
       * this system Mon 6:58 PM" runs the time into the noun and reads as a
       * garbled clause. Caught by tools/ended-check.mjs printing the rendered
       * badge rather than asserting on a substring — the assertion passed while
       * the sentence was wrong. */
      headline: clock
        ? `${who} issued its ${what} on this system, ${clock}`
        : `${who} issued its ${what} on this system`,
      detail:
        (became ? `The system ${became}. ` : '') +
        'Position and track shown are the last published. There is no ' +
        'forecast to show — no further advisories will be issued.',
    };
  }

  /* `absent`. Note what this deliberately does NOT say: it does not say the
   * storm ended, because nobody told us that. It says the feed stopped
   * carrying it, which is the whole of what three clean polls prove. */
  return {
    headline: clock
      ? `${who} stopped listing this system, ${clock}`
      : `${who} stopped listing this system`,
    detail:
      'It is no longer in a feed that is otherwise reporting normally, so ' +
      'the app has stopped forecasting for it. Position and track shown are ' +
      'the last published.',
  };
}

/**
 * The one-line form, for a panel section whose content was hidden.
 *
 * THIS EXISTS BECAUSE THE EMPTY SLOTS LIE, and that lesson was learned the
 * hard way on the silence pass — read lib/silence.js `silenceSectionNote`. Every
 * section on the detail panel writes its sentence from its slot's status, and
 * those sentences were written for a slot that came back empty ON ITS OWN:
 * "None in effect." for watches and warnings, "No wind field published for this
 * advisory." for the wind field. Emptying a slot here without also changing
 * what the section says would turn a hidden warning into a published
 * all-clear.
 *
 * Wording differs from the silence version in the way that matters: silence
 * says "hidden, no update in over 24 hours", which implies one may still
 * arrive. This says there will not be one.
 */
export function endedSectionNote(storm) {
  if (!isEnded(storm)) return null;
  return storm.ended.reason === 'declared'
    ? 'Not shown — no further advisories will be issued for this system.'
    : 'Not shown — this system is no longer in the feed.';
}

/** The count word for the storm pill and list rows, where there is no room for
 *  a sentence.
 *
 *  "ended" and not "dissipated", for the reason this whole file exists. Lower
 *  case: it appears mid-phrase ("2 active · 1 ended") and as a row suffix. */
export const ENDED_SHORT = 'ended';

/** The row's own qualifier. Same word — the row and the pill must agree, and a
 *  reader scanning a list should not have to reconcile two vocabularies for one
 *  state. Named separately anyway so the pill can be shortened under pressure
 *  without silently changing what the rows say. */
export const ENDED_ROW = ENDED_SHORT;
