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
 * screen, which is the §9 failure the fixed colors exist to prevent.
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

  /* ==> MEASURED FROM WHEN WE CONFIRMED IT, NOT FROM THE LAST PUBLISHED FIX.
   * REVERSED 2026-08-08, AND THE PREVIOUS REASONING IS PRESERVED BELOW BECAUSE
   * HALF OF IT IS STILL RIGHT. <==
   *
   * It used to read `observedAt` — the newest analysis anybody published — on
   * the argument that this is the clock a reader keeps ("NHC's last word was
   * 10 AM Wednesday, so it should be gone by 10 AM Thursday"), and that a
   * storm confirmed dead a week late must not get a FULL FRESH WINDOW starting
   * from the day we worked it out. That second half stands: an unbounded fresh
   * window is what kept a system on the globe three and a half days after its
   * last transmission.
   *
   * ==> WHAT IT MISSED: ANCHORING ON `observedAt` DOES NOT SHORTEN THE GREY
   * PERIOD, IT DELETES IT. <== `holdFor` is 24 h and every ending that is not
   * read promptly arrives LATER than that:
   *
   *   - the JTWC roster route is gated on `isSilent`, so the storm is already
   *     past 24 h by construction. Expired on the poll that confirmed it.
   *   - `lapsed` fires at 48 h. Expired by a full day before it exists.
   *   - any absence confirmed overnight — storm dies, app is shut, three clean
   *     polls land 30 h after the last advisory. Gone before it is ever seen.
   *
   * Only a PROMPT declared ending — NHC posts a final advisory and the app is
   * open to read it — ever got the window it was supposed to have. The rule
   * did not deliver "24 h of grey", it delivered "24 h from the last fix, minus
   * however late we were", which is usually nothing. A storm the reader was
   * watching blinked out with no ending shown, which is the disappearing-storm
   * failure this whole file was written to fix, reintroduced by its own hold.
   *
   * So: `ended.at`, and every storm gets a real day of grey however it died.
   * The old unboundedness worry is answered by the `lapsed` route rather than
   * by the anchor — a silent storm can no longer drift for a week before
   * somebody notices, because 48 h of silence ends it automatically. What is
   * left is a bounded catch-up case: away for a week, come back, and a storm
   * that died while you were gone shows grey for a day with the date in words.
   * That is worth seeing, not worth hiding.
   *
   * ==> IT READS `confirmedAt`, NOT `at`, AND THE TWO ARE NOT THE SAME. <==
   * `at` is WHEN THE ENDING HAPPENED in the agency's own clock — NHC's
   * issuance time on a declared ending, and `observedAt` on the two routes
   * where nobody issued anything. The badge needs that one, or a reader
   * checking NHC's archive finds two different times for one event. Expiry
   * needs the OTHER moment: when this app worked it out. Anchoring expiry on
   * `at` would have changed nothing at all for `absent` and `lapsed`, whose
   * `at` IS `observedAt` — the fix would have shipped looking correct and
   * doing nothing on the two routes that needed it most.
   *
   * FALLS BACK THROUGH ALL THREE. `ageMs` returns null for a missing or
   * unparseable stamp, so a record persisted before `confirmedAt` existed is
   * judged on `at`, then on `observedAt`, rather than being thrown away for a
   * missing field. Old localStorage entries therefore keep the old behaviour
   * and age out on their own instead of vanishing at once on upgrade.
   *
   * An UNREADABLE stamp on BOTH expires immediately rather than living forever.
   * This is the safe direction here and it is worth stating why, since
   * everywhere else in this project an unparseable timestamp means "make no
   * claim": the claim being made by keeping it is that a dead storm is still
   * worth screen space, and the cost of getting that wrong is a grey dot that
   * never leaves. A corrupt localStorage record must not become permanent
   * furniture. */
  const age =
    ageMs(storm.ended.confirmedAt, now) ??
    ageMs(storm.ended.at, now) ??
    ageMs(storm.observedAt, now);

  /* ==> `lapsed` GETS A SHORTER WINDOW, and the reason is in ENDED.holdForLapsed.
   * <== In short: the other two routes are news on the poll they land, and this
   * one is the third day of a story the reader has been watching since the
   * silence badge appeared 24 hours ago. */
  const hold = storm.ended.reason === 'lapsed' ? ENDED.holdForLapsed : ENDED.holdFor;
  return age == null || age > hold;
}

/**
 * Precedence over silence, stated once so no surface has to work it out.
 *
 * A storm that went quiet and was THEN confirmed gone is both silent and
 * ended, and every surface would otherwise pick its own winner. `ended` wins
 * everywhere: "no updates in over 24 hours, this storm may no longer be
 * active" is a hedge, and once the agency has said it is finished — or three
 * clean polls have agreed it is gone from a list that still carries everyone
 * else — hedging is the less honest answer.
 *
 * The reverse order would be actively bad. It would leave the app saying "may
 * no longer be active" about a storm whose final advisory we have read.
 */
export function endedWins(storm) {
  return isEnded(storm);
}

/**
 * The color that stands for this storm — its category color, or the ended
 * grey.
 *
 * ==> EXTRACTED BECAUSE FOUR SURFACES ASK IT. <== The list row swatch, the same
 * swatch again on the in-place patch path, the detail panel's identity block,
 * and the cage's head bead. Written out four times, one of them drifts, and the
 * result is a storm that is grey on the globe and Cat 4 red in the list — two
 * answers to "how bad is this" on one screen, which is the §9 failure the fixed
 * colors exist to prevent, arriving through the back door.
 *
 * THIS DOES NOT WEAKEN §6. The Saffir-Simpson colors stay fixed and
 * unthemeable for every storm that has a category to show. A storm with no
 * current reading has none — nobody is publishing a wind for it — so this
 * returns the absence of a severity claim rather than a different one.
 *
 * THE TOKEN IS `stormEnded` AND IT COVERS BOTH STATES. Silent and ended are
 * told apart in words — the badge, the row qualifier, the section notes — and
 * never by hue. A second grey would be a second severity vocabulary for a
 * distinction the color channel is not carrying.
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
/** Whole hours in the lapsed threshold, for copy. DERIVED, never typed — the
 *  same rule lib/silence.js `silenceHours` follows, and for the same reason:
 *  moving the constant must never leave a sentence behind quoting the old
 *  one. */
export function lapsedHours() {
  return Math.round(ENDED.lapsedAfter / (60 * 60 * 1000));
}

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

  /* `lapsed`. THE WEAKEST OF THE THREE, AND IT NAMES NOBODY.
   *
   * Nothing was declared and nothing went absent — the storm is still sitting
   * in its source's list with `iscurrent` true, and the source has simply not
   * said anything about it for two days. `by` is null for that reason, and
   * `agencyName(null)` is deliberately not called: crediting "the issuing
   * agency" with an ending nobody issued would be the attribution rule (§5)
   * broken by its own helper.
   *
   * So this is the one badge in the app whose subject is US. The other two
   * report an agency's action; this reports our decision, in the open, with
   * the evidence attached — the source is named, the date is given, and the
   * reader can go and check. */
  if (reason === 'lapsed') {
    const src = agencyName(storm.source);
    return {
      headline: clock
        ? `No fix published for this system since ${clock}`
        : 'No fix published for this system',
      detail:
        `${src} still lists it, but has not analysed it in over ` +
        `${lapsedHours()} hours, so the app has stopped tracking it. Position ` +
        'and track shown are the last published. This does not mean the storm ' +
        'ended — only that nobody is saying where it is.',
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
  const { reason } = storm.ended;
  if (reason === 'declared') {
    return 'Not shown — no further advisories will be issued for this system.';
  }
  /* `lapsed` says the feed is still there and just is not saying anything,
   * which is a different sentence from `absent`'s "it is gone from the feed".
   * Getting these two the same way round matters: a reader who goes looking
   * for the storm at GDACS will still find it, and a note claiming it had left
   * the feed would read as our bug rather than their stale flag. */
  if (reason === 'lapsed') {
    return 'Not shown — nothing has been published for this system in over ' +
      `${lapsedHours()} hours.`;
  }
  return 'Not shown — this system is no longer in the feed.';
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

/**
 * WHEN it ended, for the list row, as an absolute clock — or null.
 *
 * The row's right-hand slot carries the strongest claim it can. For a live
 * storm that claim is relative ("5 hrs ago"), because the reader is asking how
 * current the row is and a running clock answers that. For an ended storm the
 * question changes: nothing more is coming, so "how current" is settled, and
 * what is left worth knowing is WHEN IT STOPPED. That only ever gets older, and
 * a relative form of it decays into noise — "3 days ago" tells a reader nothing
 * they can check against NHC's archive.
 *
 * READS `ended.at`, NOT `confirmedAt`, and the two are not the same. `at` is
 * the agency's own clock — the issuance time on a declared ending. That is the
 * one a reader can look up. `confirmedAt` is when THIS APP worked it out, which
 * is our bookkeeping and can be days later; putting it on glass would print a
 * time no source agrees with. Same choice `endedNote` makes, for the same
 * reason, and the badge on the detail panel and this row must not disagree.
 *
 * NULL WHEN THE STAMP IS MISSING OR UNREADABLE, and the caller then shows the
 * bare word. An ended storm with no usable time still reads as ended; it does
 * not get a fabricated one, and it does not lose its qualifier.
 */
export function endedWhen(storm) {
  if (!isEnded(storm)) return null;
  return formatClockDay(storm.ended.at);
}

/**
 * The row's right-hand stamp, as a WORD and a CLOCK the caller renders apart.
 *
 * ==> "ended Sun 7:00 AM" WAS A FALSE SENTENCE ON A `lapsed` STORM, and this
 * function exists to stop it being said. <== Two true facts were being joined
 * into one untrue one: the word came from the ending, the clock came from the
 * last published fix, and glued together they asserted that something happened
 * on Sunday. Nothing did. Sunday is when GDACS last analysed the storm; the
 * app gave up on it two days later, and GDACS still lists it as current right
 * now. Caught on glass on DOLPHIN-26, 2026-08-11 — the row read as a corpse
 * that had been sitting in the list since the weekend.
 *
 * So the word follows the REASON, and only `lapsed` changes:
 *
 *   declared  "ended" — the agency said so, at the time shown.
 *   absent    "ended" — the storm left a working feed, at the time shown.
 *   lapsed    "quiet since" — nobody ended anything. The clock is the last
 *             fix, which is exactly what "quiet since" claims it is.
 *
 * Same vocabulary as the detail panel's headline for each route (`endedNote`),
 * shortened to fit a column. The group heading stays "Finished", which is
 * still true of all three from this app's point of view — it has stopped
 * tracking them.
 *
 * @returns {{word: string, when: string|null}|null}
 */
export function endedRowStamp(storm) {
  if (!isEnded(storm)) return null;
  const when = endedWhen(storm);

  /* NO CLOCK, NO PREPOSITION. "quiet since" dangling on its own is a sentence
   * fragment waiting for a word that is not coming; the bare adjective is the
   * honest short form. The other two routes read fine either way. */
  if (storm.ended.reason === 'lapsed') return { word: when ? 'quiet since' : 'quiet', when };
  return { word: ENDED_ROW, when };
}
