/**
 * countdown-home.js — the Timeline rail on the home dashboard (SPEC-UI §8).
 *
 * WHY THIS IS ITS OWN FILE. `countdownHtml` reached 168 lines of code — the
 * longest function in the app by more than double — inside a 1,713-line
 * `ui/view-home.js`. §12's rule is that a long FUNCTION is worse than a long
 * file, and this was both. The cut is the one the spec's own inventory named
 * and had never taken.
 *
 * ==> NO BEHAVIOUR CHANGED IN THE MOVE. <== Every line below is the line that
 * was in `view-home.js`, de-indented, with the two things it used to close over
 * — the unit system and the section-heading helper — handed in as arguments
 * instead. That is deliberate: a break after this pass can only be the move,
 * and `tools/test-home.mjs` drives all of it with no browser.
 *
 * WHAT THE RAIL IS. Every timed event in one storm's story, in the order it
 * happens: when the wind arrives, when it eases, the closest pass, and the
 * moments the storm itself changes class. ==> IT IS ALSO THE ACCESSIBLE FORM
 * OF THE CHART. <== A screen reader cannot explore an SVG and a keyboard user
 * cannot hover a ribbon, so everything the picture shows is stated here in
 * words. That is a requirement, not a courtesy, and it is why this section is
 * never collapsed by default.
 *
 * IT COMPUTES NOTHING, exactly like the view it came from. Every figure arrives
 * on `dash` from `buildHomeDashboard()`. The moment this file works out a
 * threshold inline, the number stops being a constant anyone can find and the
 * sentence stops being testable.
 *
 * Imports config/ and lib/ only. Never map/ (§12).
 */

import { formatDistance, formatWind, formatBearing, formatSpeed } from '../lib/units.js';
import { formatUntil, formatClockDay } from '../lib/time.js';
import { categoryColor, categoryShortLabel } from '../lib/category.js';
import { motionHeading } from '../lib/heading.js';
import { APPROACH } from '../data/home-dashboard.js';
import { WIND_LABEL, windColor, windDurationPhrase } from '../lib/wind.js';

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * WHICH WAY IT IS GOING, RELATIVE TO THIS HOUSE — and the honest sentence
 * when we cannot put it that way.
 *
 * ==> THE OLD FALLBACK ASSERTED IGNORANCE THE APP DID NOT HAVE. <== One
 * caller printed "nobody publishes which way it's headed" whenever
 * `motionTrend` came back null. That helper goes null for FIVE different
 * reasons and only one of them is a missing heading: no heading, zero speed,
 * farther out than APPROACH.relevanceNm, movement inside the
 * APPROACH.minGainNm deadband, or a missing position. Caught on glass
 * 2026-08-11 on PEILOU-26 — the timeline swore nobody published a heading
 * while the vitals block two inches below read "Moving ENE at 17 mph".
 *
 * So the reasons are separated here and each gets its own words. The
 * distance and stationary cases are cheap to re-derive from the same fields
 * `motionTrend` reads; the deadband case is not, and falls through to a
 * sentence that is true whichever of the two it is.
 */
/** The storm's direction of travel for this screen, published or derived,
 *  in ONE place because the sentence below and the arrow beside it both ask
 *  and must never disagree. `dash.curve` is the forecast track the chart is
 *  already drawing, so this costs nothing extra. */
export function headingOf(dash) {
  return motionHeading(dash.storm, dash.curve);
}

export function motionDetail(dash, sys) {
  const s = dash.storm;
  const head = headingOf(dash);

  /* THE PUBLISHED SENTENCE IS UNCHANGED and still quotes the advisory. */
  const moving =
    Number.isFinite(s.headingDeg) && Number.isFinite(s.speedKt) && s.speedKt > 0
      ? `Moving ${formatBearing(s.headingDeg)} at ${formatSpeed(s.speedKt, sys())}`
      /* ==> THE DERIVED ONE IS A DIFFERENT CLAIM AND GETS DIFFERENT WORDS.
       * <== "Moving NW" would read as a quote from a bulletin nobody wrote:
       * GDACS publishes no motion, and this bearing comes from the shape of
       * the forecast track. Naming the track is what keeps the two apart —
       * and there is no speed, because dividing a chord by its forecast
       * hours would put an invented number on a safety screen. */
      : head?.derived
        ? `Its forecast track runs ${formatBearing(head.deg)}`
        : null;

  /* ==> THE ADVISORY'S MOTION AND ITS MEANING FOR THIS HOUSE, IN ONE LINE.
   * <== These were two facts in two blocks: "Moving ENE at 17 mph" sat in a
   * vitals list at the bottom of the screen, and "getting closer" sat under
   * the distance at the top. A reader had to hold one in their head to make
   * sense of the other, and the vitals block existed largely to carry it.
   * Joined, they are one sentence that answers the question either half was
   * only gesturing at. The vitals section went with the merge (glass,
   * 2026-08-11). */
  const meaning = (() => {
    if (dash.trend === 'closing') return 'getting closer';
    if (dash.trend === 'receding') return 'moving away';

    if (!moving) {
      /* NO SENTENCE ABOUT MOTION AT ALL REACHES HERE ANY MORE UNLESS THERE
       * GENUINELY IS NONE. `head` is null only when the agency published no
       * heading AND the forecast track has not landed or is too short to
       * define one — so this really is the app knowing nothing, which is
       * what the words claim. Before the track fallback existed, this fired
       * for every GDACS storm whose panel was drawing a forecast two inches
       * below the sentence denying one. */
      return Number.isFinite(s.headingDeg) && Number.isFinite(s.speedKt)
        ? 'barely moving'
        : 'nobody publishes which way it’s headed';
    }

    /* ==> A DERIVED HEADING CANNOT SUPPORT THE BROADSIDE SENTENCE. <== The
     * two cases below are conclusions from `motionTrend`, which is dead
     * reckoning off a PUBLISHED heading and speed and returns null without
     * both. On a storm whose direction came from the track shape there is no
     * speed to reckon with, so "neither closer nor farther" would be a
     * finding nothing computed. The track's own answer is on this screen
     * already — the closest-pass block — and this line stops at the
     * direction rather than inventing a verdict to sit beside it. */
    if (head?.derived) return 'from the forecast so far';

    if (dash.distance && dash.distance.nm > APPROACH.relevanceNm) {
      return 'far too distant for that to point at you';
    }
    return 'near enough broadside that it is getting neither closer nor farther';
  })();

  return moving ? `${moving}, ${meaning}` : meaning;
}

/**
 * The countdown. ALSO THE ACCESSIBLE FORM OF THE CHART — a screen reader
 * cannot explore an SVG, and a keyboard user cannot hover a ribbon, so
 * everything the picture shows is stated here in words. That is a
 * requirement of the plan, not a courtesy, and it is why this section is
 * never collapsed by default.
 */
export function countdownHtml(dash, sys, sectHead) {
  const rows = [];
  /* THE DASHBOARD'S OWN CLOCK, not the wall clock. Every lead time here is
   * relative to the instant the figures were computed for, and reading
   * Date.now() instead would let the two disagree by however long the
   * render took — invisible in production and the reason this whole screen
   * could not be tested against the one complete advisory we have. */
  const clock = dash.now;

  if (dash.distance) {
    rows.push({
      at: clock,
      key: 'now',
      lead: 'now',
      ev: `${dash.storm.name} is ${formatDistance(dash.distance.nm, sys())} ${formatBearing(dash.distance.bearing)} of you`,
      /* SAME SENTENCE AS THE STRIP, from the same helper. This row used to
       * carry its own inline fallback and it was the one that shipped the
       * false "nobody publishes which way it's headed". */
      det: motionDetail(dash, sys),
    });
  }

  /* ==> THE WIND ROWS SUPERSEDE THE RING ROWS WHEN THEY EXIST. <== The
   * 100-mile ring was always a stand-in for "when do I feel it", built
   * because the app could answer it from a track alone. The corridor
   * answers the real question, so showing both would be the proxy arguing
   * with the measurement in the same list. */
  const co = dash.corridor;
  const worst = co?.ok ? co.worst : null;

  /* ==> EVERY THRESHOLD THAT REACHES THE HOUSE, NOT JUST THE WORST. <==
   *
   * This block described `worst` and nothing else, and on a storm where two
   * fields reach the house that is a rail with the wrong story on it. Seen
   * on glass 2026-08-13, Lala against a Big Island home: tropical-storm-force
   * wind arrives 9:36 AM and is on the house for fifteen hours; damaging wind
   * arrives 3:12 PM and is on it for four. The rail named only the damaging
   * pair — so it said the first wind arrives at 3:12 PM, six hours late, and
   * then said "The wind eases" at 6:45 PM while the house had another six
   * hours of tropical-storm-force wind to go.
   *
   * The second half is the dangerous one. "The wind eases" is read as *it is
   * over*, and printing it at the moment the SECOND-worst field lifts is a
   * confident wrong answer about when it is safe to go outside. The chart
   * beside it had both bands the whole time; only the words were short.
   *
   * ARRIVALS ASCEND, ENDINGS DESCEND. That is the shape the weather actually
   * has — it builds through the thresholds and comes back down through them —
   * and it makes the rail readable top to bottom as one escalation and one
   * recovery, with the closest pass sorting into the middle where it belongs.
   *
   * THE WEAKEST FIELD IS THE FIRST WIND AND THE LAST WIND, so it owns both
   * the earliest-arrival hedge and the all-clear. Hanging the hedge on
   * `worst` (which is what it did) put "wind could start this early, 10:08
   * AM" BELOW "tropical-storm-force wind reaches you, 9:36 AM" once the
   * weaker rows existed — a hedge that is later than the thing it hedges. */
  const reaching = co?.ok
    ? Object.keys(co.forecast)
        .map(Number)
        .filter((kt) => Number.isFinite(kt) && co.forecast[kt]?.everInside)
        .sort((a, b) => a - b)
    : [];

  if (reaching.length) {
    const firstKt = reaching[0];
    const windowsOf = (kt) => co.forecast[kt]?.windows || [];

    /* The hedge: OUR figure, not NHC's, and the only one on this screen
     * neither agency publishes. Suppressed under two hours because a hedge
     * that lands in the same breath as the forecast is noise. */
    const early = co.earliest?.[firstKt]?.windows?.[0]?.[0];
    const firstStart = windowsOf(firstKt)[0]?.[0];
    const gap =
      early && firstStart
        ? (Date.parse(firstStart) - Date.parse(early)) / 3_600_000
        : 0;
    if (gap >= 2) {
      rows.push({
        at: Date.parse(early),
        tone: windColor(firstKt),
        key: 'early',
        lead: formatUntil(early, clock) || '',
        ev: 'Wind could start this early',
        det: `${formatClockDay(early)} · if the track runs toward you`,
      });
    }

    /* ---- arrivals, weakest first ---- */
    for (const kt of reaching) {
      const start = windowsOf(kt)[0]?.[0];
      if (!start) continue;
      /* ==> A WIND ROW BEHIND THE CLOCK IS IN THE PAST TENSE (§49.1). <== The
       * milestone rows learned this in pass 4 and the wind rows did not, so a
       * field that arrived three hours ago printed *3 hrs ago —
       * Tropical-storm-force wind reaches you*: a real past lead time beside a
       * future-tense verb, which is the exact shape §49.1 names. The corridor
       * is walked from the storm's current position and its first window can
       * easily be open already, so this is the ordinary case rather than an
       * edge one. Seen on glass 2026-08-16 on Lala.
       *
       * THE TENSE COMES OFF THE ROW'S OWN TIMESTAMP, not off the stage: this
       * row IS the arrival, so the moment it names is the only thing that can
       * decide whether it has happened. */
      const arrived = Date.parse(start) <= clock;
      rows.push({
        at: Date.parse(start),
        tone: windColor(kt),
        /* Bold and a filled node for the WORST arrival only. Every band
         * shouting is every band whispering. */
        key: kt === worst ? 'true' : '',
        lead: formatUntil(start, clock) || '',
        ev: `${WIND_LABEL[kt] || kt + ' kt'} wind ${arrived ? 'reached' : 'reaches'} you`,
        det: formatClockDay(start) || '',
      });
    }

    /* ---- endings, strongest first ----
     * ==> THE SORT BELOW IS WHAT ORDERS THESE, NOT THIS LOOP. <== A stronger
     * field always lifts before a weaker one that contains it, so sorting by
     * time already produces the recovery order and reversing here changes
     * nothing on any ordinary storm — verified by mutation: removing the
     * reverse leaves the suite green. It is kept for the one case the clock
     * cannot settle, two fields whose windows close at the same instant,
     * where the sort is stable and therefore hands the order back to this
     * loop. There "The wind is past you" must not print above a stronger
     * field still easing. */
    for (const kt of [...reaching].reverse()) {
      const w = windowsOf(kt);
      const c = co.forecast[kt];
      const start = w[0]?.[0];
      const end = w[w.length - 1]?.[1];
      /* ==> A WINDOW WITH NO LENGTH GETS NO ENDING ROW. <== When a storm
       * publishes radii at one hour only and the house is already inside
       * them, the window opens and closes at the same instant. Left alone
       * the rail printed the arrival and the ending as two rows at the same
       * minute, the second stating no duration at all. The arrival is the
       * fact; the ending is not known. */
      if (!end || !start || Date.parse(end) <= Date.parse(start)) continue;

      const duration =
        windDurationPhrase(c.totalHours, c.openEnded) ||
        'how long, the forecast doesn’t say';

      /* ==> THE LAST FIELD TO LIFT IS THE ALL-CLEAR, AND IT SAYS SO. <== A
       * rail that ends on "Tropical-storm-force wind eases" has technically
       * answered the question and has not actually answered it: the reader
       * wants to know when it is DONE, and the difference between a band
       * lifting and the storm being past you is exactly the thing the old
       * single-threshold version got wrong.
       *
       * NOT THE WORDS "ALL CLEAR". That phrase is the home chip's word for a
       * status — nothing bearing down on the house, both sources answered —
       * and spending it on a forecast moment inside one storm's rail would
       * make it mean two things. This says what happens instead. */
      const last = kt === firstKt;
      rows.push({
        at: Date.parse(end),
        tone: windColor(kt),
        key: '',
        lead: formatUntil(end, clock) || '',
        /* An open-ended window is one NHC stopped publishing radii for while
         * the house was still inside it, so its end is a FLOOR and no row
         * built on it may claim the wind stopped. */
        /* Past tense once the moment is behind the clock, same rule as the
         * arrival above. "The wind is past you" is already tenseless and
         * stays; the easing of one band is an event and takes a tense. */
        ev: c.openEnded
          ? 'The forecast stops here, with wind still on you'
          : last
            ? 'The wind is past you'
            : `${WIND_LABEL[kt] || kt + ' kt'} wind ${
                Date.parse(end) <= clock ? 'eased' : 'eases'}`,
        det: `${formatClockDay(end)} · ${duration} in all`,
      });
    }
  }

  const ring = dash.nearRing;
  if (!worst && ring?.everInside && ring.enter) {
    rows.push({
      at: Date.parse(ring.enter),
      key: '',
      lead: formatUntil(ring.enter, clock) || '',
      ev: `Comes within ${formatDistance(ring.ringNm, sys())} of you`,
      det: formatClockDay(ring.enter) || '',
    });
  }
  /* ==> AND THERE IS NO ROW FOR "NEVER COMES WITHIN 100 MILES". <== It was
   * pushed with `at: null` and an em dash where every other row prints a
   * lead time, which read as a countdown whose clock had failed rather than
   * as a fact with no clock in it. That was the symptom. The cause is that
   * it is not an event, and this rail is a sequence of events.
   *
   * It is also the WEAKER of two answers to the same question. The headline
   * above measures the wind field itself — "no tropical-storm wind reaches
   * you, the nearest edge stays 331 mi off" — while this row measured the
   * CENTRE against a ring whose radius nothing meteorological chose. Same
   * rule as the block above: the proxy does not get to argue with the
   * measurement in the same drawer. */

  /* ==> A FORECAST PASS THAT IS NOT AHEAD OF THE CLOCK IS NOT A FORECAST.
   * <== `closestApproach` walks from the CURRENT POSITION forward, so for a
   * storm that is leaving, the nearest point on what remains of the track is
   * where the storm is standing — and this row printed "Closest pass — 163 mi
   * NNE of you, now" two rows under "Closest it came — 13 mi ENE of you,
   * 17 hrs ago". Both numbers are correct and together they are the exact
   * confusion §49.2 forbids: one fact in the other's words.
   *
   * So the forecast row is drawn when the pass is genuinely still to come AND
   * is genuinely closer than the one that already happened. When it is not,
   * the observed row above is the true answer to the question this row was
   * asking, and it is already on the list.
   *
   * ==> THE TEST IS `dash.approachSuperseded` AND IT IS NOT COMPUTED HERE.
   * <== This rule lived in three files — this rail, the chart's dot, and the
   * chart's aria sentence — as three copies of one comparison, and it has now
   * been tightened twice. Three copies of a rule is how a picture and its
   * description come to disagree about the same storm. It is one field on the
   * dashboard; see data/home-dashboard.js for why both halves are asked. */
  if (dash.approach?.relevant && dash.approach.time && !dash.approachSuperseded) {
    const kt = dash.atClosest?.windKt;
    rows.push({
      /* ==> THE PASS TAKES THE STORM'S OWN COLOR AT THAT MOMENT. <== Not
       * the wind threshold — this row is about the centre, not about what
       * reaches the house, and a Cat 4 arriving is a different fact from
       * hurricane-force wind arriving. `categoryColor` returns the generic
       * hue for a storm with no earned category, so a post-tropical low
       * cannot borrow a Saffir-Simpson color it never had (§6). */
      at: Date.parse(dash.approach.time),
      tone: categoryColor(dash.atClosest?.category, dash.storm.nature),
      key: 'true',
      lead: formatUntil(dash.approach.time, clock) || '',
      ev: `Closest pass — ${formatDistance(dash.approach.nm, sys())} ${formatBearing(dash.approach.bearing)} of you`,
      det: [
        formatClockDay(dash.approach.time),
        /* NOT lower-cased. `categoryShortLabel` returns "TS" and "Cat 3" —
         * acronyms, not sentence fragments — and "50 mph, ts" reads as a
         * typo rather than as a classification. */
        kt != null
          ? `${formatWind(kt, sys())} · ${categoryShortLabel(dash.atClosest.category, dash.storm.nature)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  /* ==> AND THE PASS THAT ALREADY HAPPENED (§49.5, §49.7). <== Its own row,
   * never a widened version of the one above, for §49.2's reason: the forecast
   * pass and the observed pass are two facts, and a storm mid-pass has both
   * and must show both. They sort either side of the divider by themselves,
   * because one is behind the clock and one is ahead of it by definition.
   *
   * NO `key: 'true'`. The filled node and the bold line mark the one event a
   * reader is planning AROUND, and nobody plans around something that has
   * finished — this row is the record, not the warning.
   *
   * ==> AND IT IS NOT A RECORD UNTIL THE STORM HAS ACTUALLY BEEN CLOSEST.
   * <== `closestPassed` walks the OBSERVED track, so on a storm still coming
   * in, the closest it has been so far is simply where it is standing. The
   * rail printed *Closest it came — 107 mi ESE of you, 1 hr ago* two rows
   * above *Closest pass — 44 mi S of you, in 6 hrs*, with that same 107 mi
   * showing under `Where it is`. Seen on glass 2026-08-16 on Lala. Same test
   * as the row above and the opposite inequality, read off the one field on
   * the dashboard so the pair cannot drift apart. */
  if (dash.passed?.time && !dash.passedSuperseded) {
    const kt = dash.atPassed?.windKt;
    rows.push({
      at: Date.parse(dash.passed.time),
      tone: categoryColor(dash.atPassed?.category, dash.storm.nature),
      key: '',
      lead: formatUntil(dash.passed.time, clock) || '',
      ev: `Closest it came — ${formatDistance(dash.passed.nm, sys())} ${formatBearing(dash.passed.bearing)} of you`,
      det: [
        formatClockDay(dash.passed.time),
        kt != null
          ? `${formatWind(kt, sys())} · ${categoryShortLabel(dash.atPassed.category, dash.storm.nature)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  if (!worst && ring?.exit) {
    rows.push({
      at: Date.parse(ring.exit),
      key: '',
      lead: formatUntil(ring.exit, clock) || '',
      ev: `Back beyond ${formatDistance(ring.ringNm, sys())}`,
      det: formatClockDay(ring.exit) || '',
    });
  }

  /* ==> THIS RAIL CARRIES EVENTS ONLY, AND NOT-BUILT-YET IS NOT AN EVENT.
   * <== A dashed row once sat at the bottom saying the app could not tell
   * whether the house was inside a warned zone. It was written when that
   * looked like a gap the countdown had a duty to name; it is not one. The
   * watch/warning in force is already on the storm's own panel and painted
   * on the coast, so the rail was not covering a silence — it was adding a
   * caveat to a question nothing on this screen had asked, permanently, on
   * every storm NHC issues a product for.
   *
   * The countdown answers WHEN. Anything that has no time on it does not
   * belong here unless a reader would otherwise assume it had been checked. */

  /* ==> WHAT THE STORM DOES, INTERLEAVED WITH WHAT IT DOES TO YOU. <== Every
   * other row on this rail is house-relative — "reaches you", "of you" — and
   * these two are not. That is the point rather than an inconsistency: "it
   * becomes a hurricane at 11 AM" and "damaging wind reaches you at 3 PM"
   * are one story, and the rail is where the app tells a story in order.
   *
   * Computed in buildHomeDashboard, sorted and deduped there. This loop
   * chooses words and nothing else. */
  for (const m of dash.milestones || []) {
    const windPart = Number.isFinite(m.windKt) ? formatWind(m.windKt, sys()) : null;
    /* ==> THE TENSE COMES OFF THE ROW, NOT OFF A CLOCK COMPARISON (§49.7).
     * <== `when` is stamped where the crossing was found, so the words and the
     * filter that produced the row cannot disagree — the failure mode §49.1
     * describes, where a real past lead time sat beside a future-tense verb:
     * "5 hrs ago — Tropical-storm-force wind reaches you". */
    const was = m.when === 'past';
    let ev;
    if (m.kind === 'peak') {
      ev = was ? `It was at its strongest — ${windPart}` : `At its strongest — ${windPart}`;
    } else if (m.direction === 'up') {
      /* Named for the class being ENTERED. These are the three phrases
       * evacuation orders and bulletins are written in, so they are used
       * verbatim rather than paraphrased into something friendlier. */
      ev =
        m.level >= 4 ? `Bec${was ? 'ame' : 'omes'} a major hurricane`
        : m.level >= 2 ? `Bec${was ? 'ame' : 'omes'} a hurricane`
        : `Bec${was ? 'ame' : 'omes'} a tropical storm`;
    } else {
      /* Named for where it ENDS UP, not for the step it lost. "Drops below
       * major hurricane" tells a reader what it is no longer; "weakens to a
       * tropical storm" tells them what it now is, which is the thing they
       * are trying to find out. Read off the point's own category so a storm
       * falling two steps at once is described by where it landed. */
      ev = `Weaken${was ? 'ed' : 's'} to ${
        categoryShortLabel(m.category, dash.storm.nature) === 'TD'
          ? 'a depression'
          : m.category >= 2
            ? `a ${categoryShortLabel(m.category, dash.storm.nature)} hurricane`
            : 'a tropical storm'
      }`;
    }
    rows.push({
      at: m.at,
      tone: categoryColor(m.category, dash.storm.nature),
      key: '',
      lead: formatUntil(m.at, clock) || '',
      ev,
      det: [
        formatClockDay(new Date(m.at).toISOString()),
        m.kind === 'peak'
          ? categoryShortLabel(m.category, dash.storm.nature)
          : windPart,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  /* ==> THE SECTION IS GATED ON EVENTS, NOT ON ROW COUNT (§49.7). <== It read
   * `rows.length <= 1`, which was the same test while the only row that could
   * exist without an event was the `now` row. It is not the same test now: a
   * storm entirely in the past has real rows and no future ones, and the old
   * count would have kept working by accident rather than by rule. Stated
   * properly, the rule is that a divider with nothing on either side of it is
   * not a timeline. */
  const events = rows.filter((r) => r.key !== 'now');
  if (!events.length) return '';

  /* ==> ONE ROW AT THE CURRENT MOMENT, AND IT IS THE ROW THAT WAS ALREADY
   * THERE. <== §49.7 asks for a divider at `now`: a thin rule and a hollow
   * node, no category colour, sorted in by time like everything else. The row
   * carrying the live distance is already exactly that — it sits at `clock`,
   * its lead already reads `now`, and it has no tone. So it becomes the
   * divider rather than gaining a bare one beside it, which would have put two
   * rows at the same minute on a list whose whole job is order.
   *
   * A dashboard with no distance at all still gets the divider, empty, because
   * past rows above future rows with nothing between them is a list that does
   * not say where the reader is standing. */
  if (!rows.some((r) => r.key === 'now')) {
    rows.push({ at: clock, key: 'now', lead: 'now', ev: '', det: '' });
  }

  /* ==> A COUNTDOWN THAT GOES BACKWARDS IS NOT A COUNTDOWN. <== The rows are
   * pushed in the order the sections above are written, and that order is
   * only ever chronological by luck. On Ida it read 12 hrs, 16 hrs, 21 hrs,
   * 18 hrs — the wind outlasts the closest pass, so "winds last at least
   * this long" landed above "closest pass". Bertha did the same thing and
   * nobody caught it, because nobody read the list against a clock.
   *
   * THIS IS THE SURFACE A SCREEN READER HAS INSTEAD OF THE CHART, so a
   * scrambled order is not cosmetic here — it is the whole sequence of
   * events arriving in the wrong sequence.
   *
   * EVERY ROW NOW CARRIES A REAL MOMENT, so what the guard below protects
   * against is no longer a deliberate `null` — it is `Date.parse` handing
   * back NaN on a time string the source published badly. NaN loses every
   * comparison, which does not sort it anywhere in particular: it corrupts
   * the ORDER OF THE OTHER ROWS around it, silently. A row whose moment
   * cannot be read sinks to the bottom instead. The sort is stable, so rows
   * sharing a moment keep the order they were written in. */
  const at = (r) => (Number.isFinite(r.at) ? r.at : Infinity);
  rows.sort((a, b) => at(a) - at(b));

  return `
    <div class="home-sect">
      ${sectHead('clock', 'Timeline')}
      <ul class="home-rail">
        ${rows
          .map(
            /* ==> PAST IS AN ATTRIBUTE, NOT A CLASS, AND NOT A SECOND LIST.
             * <== The rail is one ordered sequence and stays one: rows above
             * the divider are dimmed and rows below it are not, which is a
             * style question the stylesheet answers off `data-when`. Splitting
             * the list in two would give a screen reader two lists and the
             * reader two headings for what is one story in one order. */
            (r) => `<li data-key="${esc(r.key || 'false')}"${
              r.at < clock ? ' data-when="past"' : ''
            }${
              r.tone ? ` style="--rail-dot:${esc(r.tone)}"` : ''
            }>
              <div class="home-rail-lead">${esc(r.lead)}</div>
              <div class="home-rail-ev">${esc(r.ev)}</div>
              <div class="home-rail-det">${esc(r.det)}</div>
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
}