/**
 * season-clock-words.js — what the clock's readout says. §57.23.
 *
 * ==> ONE FUNCTION, ITS OWN FILE, AND THE REASON IS THE SAME ONE `bar.js`
 * GIVES FOR `barDetail`. <== Words a reader sees should be drivable by a suite
 * without a DOM. `ui/seasons-clock-bar.js` builds elements; this decides what
 * goes in them, so the sentence can be asserted directly.
 *
 * ==> IT IS UTC, LIKE EVERY OTHER DATE IN THE ARCHIVE. <== HURDAT2 is stamped
 * in UTC and `ui/season-detail-markup.js` already made this call for the detail
 * panel: rendering an 1893 Louisiana landfall in the reader's local clock puts
 * a Gulf hurricane ashore at a time nobody in Louisiana experienced, and the
 * offset would depend on where the reader is sitting. The live app shows local
 * time because a live storm is about the reader's next few hours. History is
 * not. A clock readout that disagreed with the panel underneath it would be
 * worse than either choice.
 *
 * Imports nothing.
 */

/**
 * ==> NO YEAR, AND THAT IS DELIBERATE. <== The bar one line above already says
 * `2005 · Atlantic`, and a season does not cross a year boundary often enough
 * to justify repeating four digits ten times a second in a readout whose width
 * has to stay fixed. The cost is a late-December storm running into January
 * with nothing on this line saying so — accepted, because the scrub bar's
 * position says it and the roster's dates say it.
 *
 * ==> AND THE HOUR IS 24-CLOCK WITHOUT `hour12`. <== `6 PM` and `12 PM` are
 * two and three characters wider than `18:00`, so an am/pm readout changes
 * width as the day turns, which drags the scrub bar under the reader's thumb.
 * Six-hourly data only ever lands on 00, 06, 12 and 18, so the minutes are
 * always `00` and the whole thing is a constant nine characters.
 */
const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * `Sep 28, 18:00` — where the clock is right now.
 *
 * Returns an empty string rather than a placeholder for a moment that is not a
 * moment. The readout is hidden alongside the rest of the controls whenever
 * there is no span, so there is nothing here for a dash to explain — and a
 * literal `—` sitting where a date belongs reads as a failed lookup rather
 * than as an absence.
 *
 * @param {number|null} ms
 * @returns {string}
 */
export function formatArchiveMoment(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  /* Intl writes `Sep 28, 18:00` on some ICU builds and `Sep 28, 18:00` with a
   * narrow no-break space on others. Normalised, because the width argument
   * above is the whole reason this format was chosen and an invisible
   * character that measures differently would quietly undo it. */
  return CLOCK.format(new Date(ms)).replace(/\u202f|\u00a0/g, ' ');
}
