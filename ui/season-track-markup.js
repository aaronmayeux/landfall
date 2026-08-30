/**
 * season-track-markup.js — where the storm went. SPEC-SEASONS-BUILD.md §57.43,
 * §57.45, §57.54f, §57.57.
 *
 * ==> `movementHtml` AND `windFieldHtml` ARE ONE SUBJECT AND §57.54f ALREADY
 * SAID SO. <== That section's step 7 table merges `How it moved` and
 * `Wind footprint` into a single `Where it went`. The cut is taken here, at
 * step 3, because `ui/season-detail-markup.js` was 711 lines against §12's
 * ~700 ceiling and §57.54k required the cut to be the FIRST commit of this
 * step rather than something promised inside it. `NOW.md` records
 * `ui/view-seasons-board.js` crossing the same ceiling on five consecutive
 * passes with the cut promised each time and taken later at a bigger size.
 *
 * ==> THE SEAM IS THE SUBJECT, NOT THE LINE COUNT. <== Everything left in
 * `ui/season-detail-markup.js` is about how STRONG a storm was and what it
 * did — its peak, its life, its landfalls, how it changed, what NOAA wrote.
 * These two are about the GROUND it covered: how far, how fast, and how much
 * of it ever felt tropical-storm wind. Neither reads a wind speed and neither
 * knows a category exists.
 *
 * ==> NO BEHAVIOUR CHANGED IN THE MOVE, DELIBERATELY, SO A BREAK CAN ONLY BE
 * THE MOVE. <== The two functions are byte-identical to what they were in the
 * file they came from, `tools/test-season-detail.mjs` drives both through the
 * same handle it always did, and it was green before and after.
 *
 * Every function here is PURE — told what to draw, reading no module state, no
 * clock and no DOM. Imports config/, lib/ and the shared markup bits.
 */

/* ==> `formatDistance` AND `formatSpeed` RATHER THAN ARITHMETIC HERE. <==
 * §57.45. They are the two functions in the app that turn a stored nautical
 * mile or knot into the miles or kilometres the reader chose in Settings, and
 * the choice arrives as the `system` argument every renderer on this panel
 * already takes. A conversion written here would be a second opinion about the
 * reader's preference, and `auto` — which follows the device — is exactly the
 * value it would get wrong. */
import { formatDistance, formatSpeed } from '../lib/units.js';
import { absenceHtml, rowsHtml, utcDay } from './season-markup-bits.js';

/**
 * How far the storm went and how fast it was travelling. §57.43, §57.45.
 *
 * ==> FOUR ROWS AT MOST AND EACH HALF STANDS ALONE. <== Distance travelled,
 * the same distance as a cyclone when those differ, then the fastest and
 * slowest six hours. The distance half and the speed half are computed by
 * different walks over the same fixes and either can be absent without the
 * other, which is why nothing here reads one to decide the other.
 *
 * ==> THE FIGURES ARE ALL IN THE READER'S OWN UNITS AND NOT ONE OF THEM IS
 * CONVERTED HERE. <== `formatDistance` and `formatSpeed` both take `system`,
 * which `ui/view-season-detail.js` resolves per render from the Settings
 * preference — so `auto` goes on following the device and a reader who
 * changes miles to kilometres sees this section change with everything else
 * on the panel rather than a beat later.
 *
 * ==> THE SLOW END IS THE HALF WORTH HAVING, WHICH IS THE OPPOSITE OF WHAT THE
 * SECTION LOOKS LIKE. <== A storm that sprints is a wind story and the peak
 * figure above already tells it. A storm that crawls ashore is a flood story,
 * and nothing else on this panel says so — Harvey's reputation is entirely
 * about a forward speed, not a wind speed.
 *
 * ==> THE NOTE UNDER IT IS NOT BOILERPLATE. <== The figures are averages over
 * a six-hour leg, so "fastest" is the quickest six hours and not a top speed,
 * and a reader comparing against an advisory's instantaneous "moving NW at 12
 * mph" is entitled to know which of those they are looking at.
 */
export function movementHtml(facts, system, {
  floorKt, maxLegHours, distanceFloorNm, cycloneShareMax,
}) {
  const s = facts?.forwardSpeed;
  const d = facts?.trackDistance;
  const hasSpeed = !!s && Number.isFinite(s.fastestKt);
  const hasDistance = !!d && Number.isFinite(d.totalNm);

  if (!hasSpeed && !hasDistance) {
    /* No pair of consecutive fixes at all, which is 32 storms in the archive —
     * one observation and then nothing. §57.25 rule 2: name the reason rather
     * than leaving the section blank.
     *
     * ==> THE TWO HALVES ARE CHECKED SEPARATELY EVEN THOUGH TODAY THEY ALWAYS
     * AGREE. <== Counted 2026-08-29, every one of the 3,234 storms with a
     * distance also has a speed and the same 32 have neither, because
     * HURDAT2's clock is regular. That is a fact about this file, not a
     * property of the pair, and step 13's basins come from other agencies. */
    return absenceHtml('This storm was never seen twice, '
      + 'so there is no distance between two fixes to measure.');
  }

  const rows = [];

  /* ==> DISTANCE LEADS, BECAUSE IT IS THE FIGURE THE LINE ON THE GLOBE IS
   * ALREADY SHOWING. <== §57.45. A reader looking at a track wants its length
   * before its pace, and this is the number that makes the two speed rows
   * below mean something — 19 mph is a different fact on a 300-mile track
   * than on a 5,000-mile one. */
  let belowDistanceFloor = false;
  /* ==> ONE BOOLEAN DECIDES BOTH THE ROW AND THE SENTENCE THAT EXPLAINS IT.
   * <== Written twice they can drift, and the failure is silent and
   * asymmetric: a sentence explaining a gap between two figures, printed on a
   * panel showing one. */
  let showsCycloneRow = false;
  if (hasDistance) {
    /* Same shape and same reason as `barely moving` below: under one 0.1°
     * step the record cannot tell a short track from no track, and three
     * storms in the archive would otherwise print `0 mi`. §57.25. */
    belowDistanceFloor = d.totalNm < distanceFloorNm;
    rows.push(['Distance travelled', belowDistanceFloor
      ? 'no movement recorded'
      : formatDistance(d.totalNm, system)]);

    /* ==> THE SECOND ROW IS THE STORM ALONE, AND IT APPEARS ONLY WHEN THE TWO
     * FIGURES TELL DIFFERENT STORIES. <== Mitch 1998 ran 6,449 nm and was a
     * cyclone for 2,262 of them; Andrew 1992 was a cyclone for every mile of
     * its 4,014. Showing both on Andrew would be a qualifier that fires
     * everywhere and therefore qualifies nothing, which is the `Tied` lesson
     * §57.44 already paid for. */
    showsCycloneRow = !belowDistanceFloor && Number.isFinite(d.cycloneNm)
      && d.cycloneNm < d.totalNm * cycloneShareMax;
    if (showsCycloneRow) {
      rows.push(['As a tropical cyclone', formatDistance(d.cycloneNm, system)]);
    }
  }

  /* ==> WHEN EVEN THE FASTEST LEG IS UNDER THE FLOOR THERE IS NO RANGE TO
   * SHOW, AND THIS WAS A LIVE FAULT ON `main` UNTIL §57.45. <== §57.43 put
   * the floor on the slowest row alone, so the three storms the record never
   * moves — AL051851, AL031857, AL041864, measured 2026-08-29 — have been
   * printing `Fastest 0 mph` beside `Slowest barely moving`. The zero is the
   * dashed shrug §57.25 forbids wearing a number, and it only became obvious
   * once the distance row above it started saying `no movement recorded`.
   *
   * Both rows go rather than both reading `barely moving`: two rows exist to
   * show a range between two ends, and printing one phrase twice under two
   * different dates invites the reader to hunt for a difference that is not
   * there. The sentence below says it once, plainly. */
  const neverMoved = hasSpeed && s.fastestKt < floorKt;

  if (hasSpeed && !neverMoved) {
    /* ==> BELOW THE FLOOR IT IS WORDS, NOT A NUMBER, AND THE FLOOR IS THE
     * RECORD'S OWN PRECISION RATHER THAN A JUDGEMENT. <== Positions are
     * written to a tenth of a degree, which over six hours is a knot, so
     * anything under that is indistinguishable from stationary. 100 storms in
     * the archive would otherwise print `Slowest 0 mph`. */
    const slow = s.slowestKt < floorKt ? 'barely moving' : formatSpeed(s.slowestKt, system);

    /* The leg's START day. A leg spans two stamps and naming both would be
     * three quarters of a row spent on punctuation; the day it set off is the
     * one a reader can find on the track. */
    rows.push(['Fastest', `${formatSpeed(s.fastestKt, system)} on ${utcDay(s.fastestFromTime)}`]);
    rows.push(['Slowest', `${slow} on ${utcDay(s.slowestFromTime)}`]);
  }

  /* ==> EVERY FIGURE IN THESE SENTENCES INTERPOLATES THE CONSTANT THAT
   * PRODUCED IT. <== A typed "six hours" beside a `trackSpeedMaxLegHours`
   * somebody later moves is a sentence that reads perfectly and describes a
   * different measurement from the one above it. `CLAUDE.md`'s rule, and
   * §57.41 already paid for breaking it once. */
  const parts = [];

  if (showsCycloneRow) {
    parts.push('The first figure is the whole track drawn on the globe. The gap between '
      + 'the two is ground it covered before it became a tropical cyclone or after it '
      + 'stopped being one, as a wave, a low or an extratropical storm.');
  }

  /* ==> THE TWO FLOORS TRIP TOGETHER AND MUST NOT BOTH SPEAK. <== A storm
   * whose whole track is under one 0.1° step is also a storm with no
   * measurable leg, so both branches fire on exactly the same three storms
   * today. The precision sentence below is the stronger and more useful claim
   * and it already accounts for the missing speed rows, so this one stands
   * down rather than saying the same thing in front of it. */
  if (neverMoved && !belowDistanceFloor) {
    parts.push('The record never shows it moving between two observations, at either end '
      + 'of its life, so there is no fastest or slowest to give.');
  } else if (hasSpeed && !neverMoved) {
    parts.push(`The speeds are measured between the ${maxLegHours}-hourly observations, `
      + `so each is an average over ${maxLegHours} hours rather than a top speed.`);
  }

  /* ==> ONE PRECISION SENTENCE, NEVER TWO, AND THE DISTANCE WORDING WINS. <==
   * A storm whose whole track is under one 0.1° step is also a storm whose
   * slowest leg is zero, so both floors trip together on exactly those three
   * storms. Printing both would say the same thing twice in adjacent
   * sentences; the distance version is the stronger claim and it subsumes the
   * other. */
  if (belowDistanceFloor) {
    parts.push('Every position in the record is written to a tenth of a degree, about '
      + `${distanceFloorNm} nautical miles, and this storm\u2019s whole track adds up to less `
      + 'than one of those steps. The record cannot show whether it moved at all, so '
      + 'there is no speed to give either.');
  } else if (hasSpeed && s.slowestKt < floorKt) {
    parts.push('Every position in the record is rounded to a tenth of a degree, which over '
      + `${maxLegHours} hours is about ${floorKt} knot, so a storm slower than that `
      + 'cannot be told apart from one sitting still.');
  }

  return rowsHtml(rows) + absenceHtml(parts.join(' '));
}

/**
 * The wind field, and what it cannot say. §57.25 rule 2, §57.26a.
 *
 * Shares its wording rule with the roster's footprint note so the two can
 * never disagree — a reader who saw one sentence on the board and a different
 * one here would reasonably conclude the app does not know.
 */
export function windFieldHtml(facts, { firstSeason }) {
  if (!facts?.missing?.windField) {
    return absenceHtml(
      'The footprint on the globe is the ground that ever saw 34, 50 or 64 knot '
      + 'winds over this storm\u2019s whole life. Tap the storm\u2019s track to see it.'
    );
  }
  const era = Number.isFinite(facts.year) && facts.year < firstSeason;
  return absenceHtml(era
    ? `Wind field size wasn\u2019t recorded before ${firstSeason}, so there is no `
      + 'footprint to draw for this storm.'
    : 'No wind field was recorded for this storm, so there is no footprint to draw.');
}
