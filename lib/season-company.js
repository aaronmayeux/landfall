/**
 * season-company.js — how many other storms were running at the same time.
 * SPEC-SEASONS-BUILD.md §57.50, §57.42 Tier 1 item 10.
 *
 * ==> IT TAKES THE SEASON RATHER THAN LIVING ON `stormFacts`, FOR THE REASON
 * `rankInSeason` GIVES ONE SCREEN UP. <== Katrina's peak wind is hers forever;
 * how many storms were running beside her is a fact about 2005. `stormFacts`
 * describes a storm from its own rows and nothing else, and folding a
 * comparison in would make a stable fact depend on what else happened to be
 * loaded.
 *
 * ==> AND THAT IS ALSO WHY IT IS NOT IN `RANK_STATS`. <== §57.42 grouped this
 * with the reach item and called both candidates for an archive-wide rank.
 * That is half wrong and it is recorded here rather than left to be
 * rediscovered: `rankStorm` is handed `facts` and nothing else, so a figure
 * that cannot be read off one storm's own rows cannot be ranked without
 * changing that signature.
 *
 * ==> IT LIVES IN ITS OWN FILE BECAUSE `lib/season-facts.js` WAS 42 LINES
 * UNDER §12's CEILING. <== The same call `lib/storm-shape.js` records making,
 * and the ceiling exists precisely so the answer is a new file rather than a
 * bigger one. Nothing here imports `season-facts.js`; it reads the objects
 * that file produces.
 *
 * Imports nothing. No DOM, no network, no clock, no map.
 */

const DAY = 86400000;

/** The UTC day a moment falls in, as a whole number of days since 1970. */
const dayOf = (ms) => Math.floor(ms / DAY);

/** First and last day of a storm's record, or null when it has no clock. */
function windowOf(f) {
  if (!Number.isFinite(f?.firstTime) || !Number.isFinite(f?.lastTime)) return null;
  return { a: dayOf(f.firstTime), b: dayOf(f.lastTime) };
}

/**
 * The most other storms that were running on any one day of this storm's life.
 *
 * ==> THE WINDOW IS THE WHOLE RECORD, NOT THE CYCLONE FIXES, AND THE PANEL IS
 * WHY. <== `lifeHtml` prints `First seen` and `Last seen` off exactly these
 * two stamps, unfiltered. A count taken over a narrower window would be a
 * sentence disagreeing with two rows on the same screen, and the reader would
 * have no way to tell which half was wrong. Measured 2026-08-29: filtering to
 * cyclone fixes silences 1,439 storms rather than 1,267, so the choice moves
 * 172 storms. That is a real difference, not a rounding one.
 *
 * ==> DAYS RATHER THAN INSTANTS, BECAUSE THE CLAIM IS ABOUT A DAY. <== Two
 * storms whose records overlap by two hours were running on the same day, and
 * saying so is the honest reading of the sentence this feeds. Measured over
 * the whole archive the two rules differ by 63 storms out of 3,266, so this is
 * a wording decision rather than a numerical one — but the number printed has
 * to be the one the words describe.
 *
 * ==> THE COUNT IS THE PEAK ON ONE DAY, NOT HOW MANY STORMS THE LIFE TOUCHED
 * IN ALL, AND 482 STORMS SIT IN THE GAP. <== Measured 2026-08-29 by counting
 * them: 482 storms, 15% of the archive, met more storms across their life than
 * were ever on the ocean at once. For those this reports the smaller, truer
 * number. The alternative is two figures in one sentence, and §57.44 already
 * paid for what a second figure costs on the panel with the least room.
 *
 * ==> THAT FIGURE WAS FIRST PUT AT 170 BY SUBTRACTING TWO DISTRIBUTIONS, AND
 * IT WAS WRONG BY A FACTOR OF THREE. <== `CLAUDE.md`'s rule, earning itself
 * again: the two distributions were both correct and the arithmetic between
 * them answered a different question. `tools/test-season-company.mjs` counts
 * it storm by storm and asserts it.
 *
 * ==> THE SWEEP ONLY TESTS DAYS A STORM *STARTS*, WHICH IS COMPLETE RATHER
 * THAN A SAMPLE. <== The number of storms running is a step function: it can
 * only rise on a day something begins. So a maximum is always reached on some
 * start day, or on this storm's own first day if everything else was already
 * under way. Testing every day of a six-month life would give the identical
 * answer for more work.
 *
 * ==> TIES GO TO THE EARLIER DAY. <== The same rule `stormFacts` applies to a
 * peak wind held for eighteen hours: when the busiest day happens twice, the
 * one reported is when it first happened.
 *
 * ==> A COUNT OF ZERO IS A MEASUREMENT AND COMES BACK AS ZERO. <== §5. A
 * storm genuinely alone in a busy season and a season nobody could compare are
 * different answers, and collapsing them into one `null` is the distinction
 * `crossingsDeclined` already exists to protect. `null` here means the
 * comparison could not be made at all — a season holding one storm, of which
 * the archive has 24, or a storm with no usable clock.
 *
 * @param {object|null} facts   the storm, from `stormFacts`
 * @param {Array<object>} all   every storm in that season, from `stormFacts`
 * @returns {{peak:number, dayMs:number|null, of:number} | null}
 */
export function seasonCompany(facts, all) {
  if (!facts?.id) return null;
  const mine = windowOf(facts);
  if (!mine) return null;

  const list = (all || []).filter((f) => f && f.id);
  if (list.length < 2) return null;
  if (!list.some((f) => f.id === facts.id)) return null;

  const others = [];
  for (const f of list) {
    if (f.id === facts.id) continue;
    const w = windowOf(f);
    if (!w) continue;
    if (w.a <= mine.b && w.b >= mine.a) others.push(w);
  }
  if (!others.length) return { peak: 0, dayMs: null, of: list.length };

  const days = new Set([mine.a]);
  for (const w of others) {
    if (w.a >= mine.a && w.a <= mine.b) days.add(w.a);
  }

  let peak = 0;
  let peakDay = null;
  for (const d of [...days].sort((x, y) => x - y)) {
    let n = 0;
    for (const w of others) if (w.a <= d && w.b >= d) n++;
    if (n > peak) { peak = n; peakDay = d; }
  }

  return { peak, dayMs: peakDay === null ? null : peakDay * DAY, of: list.length };
}
