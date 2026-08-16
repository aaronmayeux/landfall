/**
 * chart-home.js — the home dashboard's hero: what reaches you, and when.
 *
 * ==> HOME IS THE LINE AT THE TOP. THE STORM RISES TOWARD IT. <==
 *
 * The axis is inverted on purpose and it is the most important decision in
 * this file, so here is the reasoning rather than the convention.
 *
 * With zero at the bottom, the closest approach — the single most important
 * moment on the chart — is the BOTTOM OF A V. On every chart anyone has ever
 * read, a low point is the good moment. Flipped, the same instant is a
 * summit: peak, climax, worst. That lands without a caption, and it is worth
 * more than the convention that magnitudes grow upward.
 *
 * Two things follow, both improvements:
 *   - UNCERTAINTY PUSHES THE RIGHT WAY. The earliest-arrival shadow extends
 *     UPWARD, toward the house. Risk looks like something rising at you
 *     instead of like slack opening below.
 *   - THE BANDS CLOSE A GAP. Each wind field grows up from the storm toward
 *     the home line, and touching it is exactly what it means.
 *
 * ==> THE HOME LINE IS NEVER PAINTED OVER. <== It used to wear each
 * threshold's color for the hours that wind was on the house, and it was
 * cut on glass: overstriking the reader's own house in the wind's color
 * reads as damage to the reference rather than as information, and the line
 * everything else is measured against has to stay one thing. THE COST IS
 * REAL AND IS NOT PRETENDED AWAY: the bands are clamped at zero, so once a
 * field passes over the house the chart cannot show how far past it reached.
 * That depth now lives only in the countdown, which states the duration in
 * words and is the accessible surface anyway.
 *
 * THE COST, STATED: this is a genuinely inverted axis and some readers
 * misread those at a glance. What carries it is that home is not an axis tick
 * — it is a bold line in the coastline's own cyan with the word on it, and
 * the storm visibly climbs to meet it. The gridlines are deliberately few and
 * faint, and the axis label sits at the BOTTOM so the crowded ceiling (where
 * a close storm compresses every band into a strip) has nothing to collide
 * with.
 *
 * ==> WHAT IT REPLACED, AND WHY THAT WAS RIGHT. <== The first version was two
 * lanes: the storm's own wind above, distance-to-centre below. The strength
 * lane had to go — the storm's wind is not what you feel, and a home screen
 * that shows it instead of what reaches the house is answering somebody
 * else's question. The distance lane's cone ribbon also went, folded into
 * this chart as the earliest-arrival shadow: one composed figure beats two
 * layers competing for the same pixels.
 *
 * A CHART IS NOT AN ACCESSIBLE ANSWER. Everything here is also stated in the
 * countdown list below it. The aria-label is a summary, not a substitute.
 *
 * Pure string building — no DOM, no state, no listeners.
 *
 * Imports: config/, lib/. Never data/ — the figures arrive computed.
 */

import { HOME_DASH } from '../config/constants.js';
import { formatClockDay } from '../lib/time.js';
import { formatDistance, formatWind, nmPerDisplayUnit } from '../lib/units.js';
import { WIND_LABEL, windDurationClause } from '../lib/wind.js';

const W = 320;
/* ==> WIDER GUTTER, BECAUSE THE LABELS IN IT GOT LONGER. <== It held "64kt"
 * and a bare distance; it now holds "74 mph" and a formatted distance in the
 * reader's own units, and at 30px those clipped. */
const PAD_L = 46;
const PAD_R = 10;

/** ==> THE WIND RAIL, ABOVE THE HOME LINE. <== One row per threshold that
 *  reaches the house: a bar from arrival to departure, the clock time it
 *  starts, and how long it lasts. It sits ABOVE home because that is the only
 *  empty part of the frame — every band is clamped at zero, so nothing can
 *  ever be drawn up here — and because "what is on my house, and when" is a
 *  different question from "how far away is the centre" and deserves its own
 *  band of the picture rather than being overstruck on the reference line.
 *
 *  ==> ORDERED BY SEVERITY, WEAKEST NEAREST THE HOUSE. <== 34 kt sits on the
 *  home line, 50 above it, 64 at the top. Aaron's call on glass, and the
 *  reason it is right is that it agrees with everything else on the screen:
 *  the wind that arrives FIRST and lasts LONGEST is the one closest to the
 *  reference, and severity climbs away from it, the same direction the storm
 *  itself climbs to meet the line. The first cut had it the other way round —
 *  mirroring the bands, where 34 kt is the outermost ring — and that reads as
 *  a nesting diagram rather than as a sequence of things that happen to you. */
const RAIL_H = 4;
const RAIL_PITCH = 14;

/** ==> THE HEADROOM IS BUILT, NOT RESERVED. <== It used to be a flat 58px
 *  holding three rail rows whether or not there were three, so a storm with no
 *  wind reaching the house — the common case, and the one a reader checks most
 *  often — got a third of the picture as blank sky. The frame is composed now:
 *  one header row, plus exactly one rail row per threshold that actually
 *  arrives, and the plot and everything under it move up behind it. A chart
 *  with nothing on the rail is 42px shorter than one with three rows, and the
 *  card it sits in shrinks with it (`.home-chart` is `height: auto`).
 *
 *  THE PLOT ITSELF NEVER CHANGES SIZE — only where it starts. Shrinking the
 *  headroom must not silently restretch the distance axis, or two screenshots
 *  of the same storm an hour apart would not be comparable. */
const HEADER_H = 16; // the "now" tick and the closest-pass stamp
const HEADER_ROW_H = 12; // a second header row, only when those two collide
const PLOT_H = 148; // home line to the bottom of the plot, fixed
/* The angled labels hang BELOW their anchor, so the anchor sits high and the
 * caption clears the tallest of them. And the chart is TALLER THAN THE PLOT to
 * pay for them: five timestamps will not fit horizontally at this width set
 * flat — they collide at about three — and a rotated label needs vertical room
 * its flat version did not. */
const AXIS_GAP = 12; // plot bottom to the axis labels' anchor
const CAP_GAP = 62; // plot bottom to the first caption row
const FOOT_H = 78; // plot bottom to the bottom of the SVG

/* THE THREE NUMBERS THAT DECIDE THIS FRAME'S SHAPE — how far out it plots, how
 * far back, and how much room a past pass gets — are `HOME_DASH.chartWindowRings`,
 * `chartPastHours` and `chartPastPassMarginHours`. The first used to live here
 * as a local `WINDOW_RINGS`; §49.8 put all three in `config/constants.js`,
 * where §12 says a behavioural number belongs and where the other two would
 * otherwise have had to be read in a different file from the first. */

const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const BAND_COLOR = { 34: 'var(--kt34)', 50: 'var(--kt50)', 64: 'var(--kt64)' };

/**
 * A human gridline interval for a distance axis running 0..max.
 *
 * Aiming for roughly four lines and then snapping UP to the nearest round
 * number in the 1-2-5 family. Snapping up rather than to-nearest guarantees at
 * most four gridlines and never five crowded ones; the cost is sometimes only
 * three, which is the right direction to be wrong on a phone.
 *
 * Everything here is in nautical miles, the app's storage unit, and the
 * FORMATTING is left to the caller — so a grid at 100 nm reads as "115 mi" to
 * an imperial reader. That is deliberate: the alternative is choosing round
 * numbers in the display unit, which would make the grid move when Settings
 * changed and the picture no longer match a screenshot of itself.
 */
function niceStep(max) {
  /* ==> CHOSEN BY LINE COUNT, NOT BY DIVIDING AND ROUNDING. <== The obvious
   * version — max/4, snapped up to the nearest nice number — was measured on
   * Ida and produced TWO gridlines on a 250 nm plot: 62.5 snaps to 100, and
   * 100 fits twice. Snapping up is a cliff, and half the time it lands on the
   * wrong side of it.
   *
   * So the candidates are walked from fine to coarse and the FIRST one that
   * keeps the grid under six lines wins. That yields four on Ida (50 nm) and
   * degrades gracefully at any scale: a 40 nm plot gets 10s, a 3,000 nm plot
   * gets 500s. */
  const MAX_LINES = 5;
  for (let mag = 1; mag <= 1e5; mag *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * mag;
      if (max / step <= MAX_LINES + 1) return step;
    }
  }
  return max / 4;
}

/**
 * @param {object} dash      a buildHomeDashboard() result (carries `corridor`)
 * @param {string} system    unit system, labels only
 * @returns {string} SVG markup, or '' when there is nothing honest to draw
 */
export function homeChart(dash, system) {
  if (!dash?.ok) return '';
  const co = dash.corridor;
  if (!co?.ok || co.samples.length < 2) return '';

  /* --- the window ---------------------------------------------------------
   * Cut at the last sample inside WINDOW_RINGS, but never shorter than the
   * closest approach plus a little, or the chart would stop before the point
   * of the whole screen. */
  const limit = HOME_DASH.nearRingNm * HOME_DASH.chartWindowRings;
  let end = 0;
  for (let i = 0; i < co.samples.length; i++) if (co.samples[i].nm <= limit) end = i;
  const cpaH = dash.approach?.time
    ? (Date.parse(dash.approach.time) - co.now) / 3_600_000
    : 0;
  while (end + 1 < co.samples.length && co.samples[end].h < cpaH + 6) end++;
  const S = co.samples.slice(0, Math.max(end + 1, 2));

  /* --- and the window BEHIND the present (§49.8) ---------------------------
   * The `now` line was pinned to the left edge only because there was no data
   * behind it. The observed track reaches this file now, plots in the same
   * hours-from-now the forecast does, and lands to the left with no new
   * machinery — so the existing marker becomes meaningful for free.
   *
   * ==> TWO CUTS, AND BOTH ARE NEEDED. <== The first is time: back to
   * `chartPastHours`, or to a past closest pass plus `chartPastPassMarginHours`
   * if that is older, so the one moment the screen is about is never off the
   * left edge. The second is DISTANCE, the same `limit` the forecast side is
   * cut at, and without it the chart rescales itself: a storm that was 800 nm
   * away yesterday sets `nmMax` to 800 and flattens today's approach into the
   * bottom two pixels of the frame. Walking back only while the storm was
   * inside the plot's own distance window keeps the vertical axis meaning what
   * it meant before, which is what makes two screenshots an hour apart
   * comparable. */
  let backH = HOME_DASH.chartPastHours;
  const passedH = dash.passed?.time
    ? (Date.parse(dash.passed.time) - co.now) / 3_600_000
    : null;
  if (Number.isFinite(passedH) && passedH < 0) {
    backH = Math.max(backH, -passedH + HOME_DASH.chartPastPassMarginHours);
  }
  const P = [];
  for (const p of dash.pastSamples || []) {
    if (!Number.isFinite(p.h) || !Number.isFinite(p.nm)) continue;
    if (p.h < -backH || p.h > 0) continue;
    if (p.nm > limit) { P.length = 0; continue; }
    P.push(p);
  }

  const hMin = Math.min(0, S[0].h, P.length ? P[0].h : 0);
  const hMax = S[S.length - 1].h;
  if (!(hMax > hMin)) return '';

  let nmMax = 0;
  for (const s of S) nmMax = Math.max(nmMax, s.nm);
  for (const p of P) nmMax = Math.max(nmMax, p.nm);
  nmMax = Math.max(nmMax, 1);

  const X = (h) => PAD_L + ((W - PAD_L - PAD_R) * (h - hMin)) / (hMax - hMin);

  /* --- WHICH FIELDS ARE DRAWN, DECIDED BEFORE ANYTHING IS POSITIONED ------
   * The rail's row count sets the headroom, the headroom sets where the home
   * line lands, and the home line is the top of the distance axis — so the
   * fields have to be chosen before `Y` can exist at all. Nothing here needs a
   * vertical coordinate: a window is a pair of times and two x positions. */
  const drawn = [];
  for (const kt of [34, 50, 64]) {
    if (!co.published.includes(kt)) continue;
    const c = co.forecast[kt];
    if (!c) continue;
    /* A band for a field that never comes near is noise on a phone. */
    if (!c.everInside && c.closestGapNm > HOME_DASH.nearRingNm) continue;

    const lit = S.filter((s) => s.gap[kt] != null);
    if (lit.length < 2) continue;

    /* One bar per window this field is on the house. Built only for a field
     * that actually arrives — a threshold that comes near without reaching
     * gets a band and no bar, which is the true distinction between "close"
     * and "here", and is why the row count is not just the band count. */
    const wins = [];
    for (const [a, b] of c.windows) {
      const ha = (Date.parse(a) - co.now) / 3_600_000;
      const hb = b ? (Date.parse(b) - co.now) / 3_600_000 : hMax;
      /* CLAMPED TO THE PLOT, and the clamp is recorded. The chart window is
       * cut to the approach; a 34 kt field can easily outlive it, and a bar
       * running off the axis would read as a drawing error rather than as
       * "still going". */
      const x0 = Math.max(PAD_L, Math.min(W - PAD_R, X(ha)));
      const x1 = Math.max(PAD_L, Math.min(W - PAD_R, X(hb)));
      if (!(x1 > x0) && !(hb > ha)) continue;
      wins.push({
        kt,
        x0,
        x1: Math.max(x1, x0 + 1.5),
        startsBefore: X(ha) < PAD_L - 0.01,
        runsPast: X(hb) > W - PAD_R + 0.01,
        at: a,
        hours: (Date.parse(b || a) - Date.parse(a)) / 3_600_000,
        openEnded: c.openEnded && b === c.windows[c.windows.length - 1][1],
      });
    }
    drawn.push({ kt, lit, wins });
  }
  /* Ascending, and it is the ORDER that positions the rows — 34 nearest the
   * house, then whatever is next. A storm whose 34 kt field misses while its
   * 50 kt core lands does not get an empty row where 34 would have been. */
  const railKts = drawn.filter((d) => d.wins.length).map((d) => d.kt);

  /* --- the closest-pass stamp, and how much header it needs ---------------
   * ==> THE ONE MOMENT THE WHOLE SCREEN IS ABOUT, NAMED ON THE PICTURE. <==
   * The white dotted vertical marks the closest pass and used to be the only
   * unlabelled line on the chart: a reader could see WHERE it happened on the
   * time axis but had to look away, at the panel above, to find out WHEN. The
   * stamp is the same string the panel shows — `formatClockDay` — deliberately,
   * because one screen cannot hold two answers to one question.
   *
   * ==> WHICH PASS IT MARKS FOLLOWS §49.2, AND ON A DEPARTED STORM THAT IS THE
   * OBSERVED ONE. <== `closestApproach` walks forward from the current
   * position, so once a storm is leaving its "closest approach" is wherever it
   * is standing — and the chart was planting the marker there, at 165 mi, on a
   * screen whose headline read *Closest it came 36 mi · 14 hrs ago*. Seen on
   * glass 2026-08-16 on Lala. The rail had the same fault and the same fix.
   *
   * ONE MARKER, NEVER TWO, and that is a choice rather than an oversight: a
   * storm mid-pass has both facts and the rail states both, but two white dots
   * and two timestamps on a 320-px frame is a collision problem the picture
   * does not need. The marked one is the pass still to come, because that is
   * the one anybody is planning around. */
  /* THE TEST IS `dash.approachSuperseded`, COMPUTED ONCE ON THE DASHBOARD.
   * It asks two things, not one: is the forecast pass ahead of the clock, and
   * is it actually closer than the pass that already happened. Lala's forecast
   * pass sat two minutes ahead of the clock at six times the distance of her
   * real one, which the clock test alone waved through. */
  const mark =
    dash.approach?.relevant && dash.approach.time && !dash.approachSuperseded
      ? { nm: dash.approach.nm, time: dash.approach.time, h: cpaH }
      : dash.passed?.time && Number.isFinite(passedH) && passedH >= hMin
        ? { nm: dash.passed.nm, time: dash.passed.time, h: passedH }
        : null;

  const cpaShown = Boolean(mark);
  const cpaX = cpaShown ? X(mark.h) : null;
  const cpaLabel = cpaShown ? formatClockDay(mark.time) || '' : '';

  const nowX = X(0);
  const nowShown = nowX >= PAD_L - 0.01 && nowX <= W - PAD_R + 0.01;

  /* ==> PLACED AS A SPAN, NOT AS A POINT. <== An `end`-anchored label occupies
   * the space to the LEFT of its x, so comparing x positions alone is how a
   * collision test passes a collision. ~5.0 px per character at font-size 8.5
   * in the numeric face, scaled from the 4.4 at 7.5 the rail labels use. */
  const CPA_CH = 5.0;
  let cpaAnchor = 'start';
  let cpaTextX = 0;
  let headerRows = 1;
  if (cpaLabel) {
    const w = cpaLabel.length * CPA_CH;
    const right = { anchor: 'start', x: cpaX + 5, lo: cpaX + 5, hi: cpaX + 5 + w };
    const left = { anchor: 'end', x: cpaX - 5, lo: cpaX - 5 - w, hi: cpaX - 5 };
    const inFrame = (p) => p.lo >= 2 && p.hi <= W - 2;
    /* "now" sits at nowX + 3, anchored start, three characters at 7.5. */
    const clearOfNow = (p) =>
      !nowShown || p.hi <= nowX + 1 || p.lo >= nowX + 3 + 3 * 4.4;
    const fits = [right, left].filter(inFrame);
    const clear = fits.find(clearOfNow);
    const use = clear || fits[0] || right;
    /* ==> A SECOND HEADER ROW, ONLY WHEN NEITHER SIDE IS FREE. <== That means
     * the closest pass is happening about now, so the two dotted verticals are
     * on top of each other. Dropping one of the labels there would be cheaper
     * and would delete information at the exact moment it matters most; twelve
     * extra pixels, on the one storm in a hundred that needs them, is the
     * right trade. */
    headerRows = clear ? 1 : 2;
    cpaAnchor = use.anchor;
    cpaTextX = use.x;
  }

  const headerH = HEADER_H + (headerRows - 1) * HEADER_ROW_H;
  const HOME_Y = headerH + railKts.length * RAIL_PITCH;
  const BOT = HOME_Y + PLOT_H;
  const AXIS_Y = BOT + AXIS_GAP;
  const CAP_Y = BOT + CAP_GAP;
  const H = BOT + FOOT_H;
  /* The stamp sits on the lower header row when there are two, so the "now"
   * tick keeps the position it has always had. */
  const cpaTextY = headerRows === 2 ? headerH - 4 : 12;

  /* ZERO AT THE TOP. The one line in this file that inverts the axis. */
  const Y = (nm) => HOME_Y + ((BOT - HOME_Y) * Math.min(Math.max(nm, 0), nmMax)) / nmMax;

  /* --- the wind bands, widest threshold first so 64 draws over 34 --------- */
  const bands = [];
  const rail = [];
  for (const d of drawn) {
    /* Top edge = the field's leading edge, clamped AT the house. It cannot
     * cross to the far side: a negative distance is not a place. */
    const top = d.lit.map((s) => `${X(s.h).toFixed(1)},${Y(Math.max(0, s.gap[d.kt])).toFixed(1)}`);
    const bottom = d.lit.slice().reverse().map((s) => `${X(s.h).toFixed(1)},${Y(s.nm).toFixed(1)}`);
    bands.push(
      `<path d="M${top.join(' L')} L${bottom.join(' L')} Z" ` +
        `fill="color-mix(in srgb, ${BAND_COLOR[d.kt]} 24%, transparent)" ` +
        `stroke="${BAND_COLOR[d.kt]}" stroke-width="1.4" stroke-linejoin="round"/>`
    );
    const rowY = HOME_Y - RAIL_PITCH * (railKts.indexOf(d.kt) + 1);
    for (const win of d.wins) rail.push({ ...win, y: rowY });
  }

  /* --- the earliest-arrival shadow ----------------------------------------
   * OURS, NOT NHC'S — their track error applied to their wind radii. Drawn as
   * a dashed LINE and never a filled band: a second translucent fill over
   * three of them turns the whole frame to mud, and this figure has not
   * earned equal weight with the published ones. */
  let shadow = '';
  const early = co.earliest?.[34];
  if (early && co.published.includes(34)) {
    /* ==> AND NEVER LEFT OF `now` (§49.2). <== This dashed line is NHC's track
     * error applied to their wind radii — a statement about what a forecast
     * might be wrong by. Left of the present there is no forecast to be wrong,
     * only positions the storm was measured at, and a hedge drawn over a
     * measurement is a fabricated uncertainty. The same rule that keeps the ±
     * band off `passed`, applied to the picture. */
    const lit = S.filter((s) => s.h >= 0 && s.gapEarly?.[34] != null);
    if (lit.length > 1) {
      const d = lit
        .map((s, i) => `${i ? 'L' : 'M'}${X(s.h).toFixed(1)},${Y(Math.max(0, s.gapEarly[34])).toFixed(1)}`)
        .join(' ');
      shadow =
        `<path d="${d}" fill="none" stroke="var(--home-band-edge)" stroke-width="1.2" ` +
        `stroke-dasharray="4 3" stroke-linejoin="round"/>`;
    }
  }

  /* --- the centre track ----------------------------------------------------
   * ==> SOLID FOR WHAT HAPPENED, DOTTED FOR WHAT IS FORECAST (§49.8). <== The
   * same grammar §46.2 uses for observed-versus-forecast intensity, so the app
   * has ONE visual vocabulary for that distinction rather than two. It changes
   * every chart, not only a departed storm's: a track that is entirely ahead
   * of the clock is entirely a forecast and was being drawn as though it were
   * a measurement.
   *
   * THE SEAM IS THE CORRIDOR'S FIRST SAMPLE, NOT THE STROKE OF MIDNIGHT, and
   * that is up to three hours behind `now` — the advisory position is what the
   * corridor is walked from, and this file already says so at the `now` line
   * below. So a short dotted sliver can sit just left of `now`. Splitting the
   * polyline at exactly h=0 would mean interpolating a position nobody
   * published, to move a line style by three hours. */
  const eye = S.map((s, i) => `${i ? 'L' : 'M'}${X(s.h).toFixed(1)},${Y(s.nm).toFixed(1)}`).join(' ');
  /* Joined to the forecast's first sample so the two read as one track with a
   * change of certainty, not as two lines with a gap at the present. */
  const observed = P.length
    ? P.map((p, i) => `${i ? 'L' : 'M'}${X(p.h).toFixed(1)},${Y(p.nm).toFixed(1)}`).join(' ') +
      ` L${X(S[0].h).toFixed(1)},${Y(S[0].nm).toFixed(1)}`
    : '';

  /* --- the distance grid --------------------------------------------------
   *
   * ==> FOUR LINES, EACH LABELLED, AND THAT IS THE POINT OF THE CHART. <== It
   * had two, which is enough to imply a scale and not enough to READ one: with
   * the home line at zero and two unlabelled-in-between ticks, the only
   * distances a reader could actually name were the top of the frame and the
   * house itself. Every band edge and every point on the track sat between two
   * numbers that were 45% of the plot apart. Asked for on glass 2026-08-11.
   *
   * ROUND NUMBERS, NOT EVEN FRACTIONS. Slicing nmMax into quarters produces
   * labels like "137 mi" — arithmetically correct and useless to compare
   * against. `niceStep` picks a human interval (25, 50, 100 …) so the grid
   * reads 100 / 200 / 300, and the grid then stops wherever the data does
   * rather than being stretched to meet the frame.
   *
   * ZERO IS NOT DRAWN. It is the home line, which already has its own rule and
   * its own word, and a second line labelled "0 mi" on top of it would be the
   * reference competing with itself. */
  const ticks = [];
  /* THE INTERVAL IS PICKED IN THE READER'S UNITS AND CONVERTED BACK, so the
   * axis reads 50 / 100 / 150 mi rather than the 58 / 115 / 173 that a round
   * nautical-mile interval converts to. The grid therefore moves when Settings
   * changes, which is correct: it is a reading aid, not a property of the
   * storm. */
  const perUnit = nmPerDisplayUnit(system);
  const step = niceStep(nmMax / perUnit) * perUnit;
  for (let nm = step; nm < nmMax * 0.99; nm += step) {
    const y = Y(nm);
    ticks.push(
      `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" ` +
        `stroke="var(--glass-border)" stroke-width="1"/>` +
        `<text x="${PAD_L - 4}" y="${(y + 3).toFixed(1)}" font-size="8" text-anchor="end">${esc(
          formatDistance(nm, system)
        )}</text>`
    );
  }

  /* --- the closest pass, as a summit marker, and its stamp -----------------
   * ==> THE LINE RUNS ALL THE WAY TO ITS OWN LABEL. <== It used to stop at the
   * home line, which was fine while nothing was written above it — but a
   * timestamp floating at the top of the frame with a gap between it and the
   * line it belongs to is a label the reader has to guess at, and the rail
   * band it would have to jump is up to 42px of colored bars. Carried through
   * the band it costs one hairline of ink and reads as one object, and it says
   * something true besides: whether the closest pass falls inside a window the
   * wind is on the house. */
  let cpa = '';
  if (cpaShown) {
    const x = cpaX.toFixed(1);
    const y = Y(mark.nm).toFixed(1);
    cpa =
      `<line x1="${x}" y1="${cpaTextY - 6}" x2="${x}" y2="${y}" stroke="var(--text-primary)" ` +
      `stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>` +
      `<circle cx="${x}" cy="${y}" r="4" fill="var(--text-primary)"/>` +
      (cpaLabel
        ? `<text x="${cpaTextX.toFixed(1)}" y="${cpaTextY}" font-size="8.5" ` +
          `font-weight="600" text-anchor="${cpaAnchor}" fill="var(--text-primary)">` +
          `${esc(cpaLabel)}</text>`
        : '');
  }

  /* --- the wind rail's bars and their two labels -------------------------
   * ARRIVAL ON THE LEFT, DURATION ON THE RIGHT, and both are placed against
   * the bar rather than at fixed positions, because the bars move: a 34 kt
   * field can span the whole frame while a 64 kt core is eight pixels wide.
   * Each label flips to the other side of its end when there is no room, so
   * neither ever runs off the plot or sits on top of the bar. */
  const railSvg = [];
  for (const r of rail) {
    const w = r.x1 - r.x0;
    const c = BAND_COLOR[r.kt];
    const mid = r.y + RAIL_H / 2;

    railSvg.push(
      `<rect x="${r.x0.toFixed(1)}" y="${r.y}" width="${w.toFixed(1)}" height="${RAIL_H}" ` +
        `rx="${RAIL_H / 2}" fill="${c}"/>`
    );
    /* A bar that leaves the frame gets a chevron rather than a flat end, so
     * "the picture stops here" cannot be misread as "the wind stops here". */
    if (r.runsPast) {
      railSvg.push(
        `<path d="M${(W - PAD_R - 3).toFixed(1)},${r.y - 1.5} L${(W - PAD_R + 1).toFixed(1)},${mid.toFixed(1)} ` +
          `L${(W - PAD_R - 3).toFixed(1)},${(r.y + RAIL_H + 1.5).toFixed(1)} Z" fill="${c}"/>`
      );
    }

    /* WHEN IT ARRIVES, and HOW LONG IT STAYS.
     *
     * ==> TWO LABELS WHERE THERE IS ROOM FOR TWO, ONE WHERE THERE IS NOT. <==
     * The first cut put the arrival at the bar's left end and the duration at
     * its right end unconditionally, with each flipping sides when it ran out
     * of room — and when the bar started at the left edge of the plot BOTH
     * flipped to the right and landed on top of each other, one pixel apart.
     * Measured on Ida's Advisory 14 and 16.
     *
     * The room needed is known rather than guessed: a clock time is about
     * eight characters at 7.5 px, so ~36 px, and a duration is three or four,
     * so ~20 px. Below either, the two merge into one chip and stay legible.
     *
     * `≥` marks a duration that is a FLOOR — the field is still on the house
     * when NHC stops publishing that threshold. One character, and it keeps
     * the rail from overstating a number the forecast does not pin.
     *
     * The arrival is suppressed for a window already open at the left edge:
     * "arrives at" is the wrong word for wind that is already blowing. */
    const hrs = r.hours;
    const dur =
      `${r.openEnded ? '≥' : ''}` +
      (hrs >= 1 ? `${Math.round(hrs)}h` : `${Math.max(5, Math.round((hrs * 60) / 5) * 5)}m`);
    const at = r.startsBefore
      ? null
      : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
          .format(new Date(r.at));

    const leftRoom = r.x0 - PAD_L;
    const rightRoom = W - PAD_R - r.x1;
    const text = (x, anchor, weight, str) =>
      `<text x="${x.toFixed(1)}" y="${(mid + 2.5).toFixed(1)}" font-size="7.5" ` +
      `text-anchor="${anchor}"${weight ? ' font-weight="600"' : ''} fill="${c}">${esc(str)}</text>`;

    if (at && leftRoom > 37 && rightRoom > 22) {
      railSvg.push(text(r.x0 - 3, 'end', false, at));
      railSvg.push(text(r.x1 + 4, 'start', true, dur));
    } else {
      const merged = at ? `${at} · ${dur}` : dur;
      if (rightRoom > 58) railSvg.push(text(r.x1 + 4, 'start', true, merged));
      else if (leftRoom > 58) railSvg.push(text(r.x0 - 3, 'end', true, merged));
      /* Nowhere beside it: the bar spans the frame. Sit the chip just above
       * its left end, in the gap the row spacing already leaves. */
      else railSvg.push(
        `<text x="${(r.x0 + 2).toFixed(1)}" y="${(r.y - 2).toFixed(1)}" font-size="7.5" ` +
        `font-weight="600" fill="${c}">${esc(merged)}</text>`
      );
    }
    /* The threshold itself, in the gutter, so a color nobody has learned yet
     * still says which wind it is. */
    /* ==> IN THE READER'S OWN UNITS, NOT KNOTS. <== This was the last figure
     * in the app still printed as "64kt". Knots are what NHC publishes and
     * what the app stores, and they are not what anybody set in Settings —
     * a chart captioned in a unit the reader did not choose is a chart they
     * have to convert before they can compare it to the mph two inches above
     * it. Caught on glass 2026-08-11. */
    railSvg.push(
      `<text x="${PAD_L - 4}" y="${(mid + 2.5).toFixed(1)}" font-size="7.5" ` +
        `text-anchor="end" fill="${c}">${esc(formatWind(r.kt, system))}</text>`
    );
  }

  /* --- NOW ----------------------------------------------------------------
   * ==> THE CHART DOES NOT START AT "NOW" AND USED TO CLAIM IT DID. <== The
   * first sample is the storm's position as of the ADVISORY, which on a live
   * feed is up to three hours old, and the leftmost axis label said "now"
   * regardless. The vertical marks the actual present; the axis label under it
   * now says what time the chart really begins. */
  const nowLine =
    nowShown
      ? `<line x1="${nowX.toFixed(1)}" y1="6" x2="${nowX.toFixed(1)}" y2="${BOT}" ` +
        `stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2 3"/>` +
        `<text x="${(nowX + 3).toFixed(1)}" y="12" font-size="7.5" fill="var(--text-muted)">now</text>`
      : '';

  /* --- the time axis ------------------------------------------------------
   *
   * ==> FIVE LABELS, ANGLED, EACH WITH ITS OWN FAINT VERTICAL. <== Three flat
   * labels — start, middle, end — meant the middle of the plot was a place
   * with no time on it, so "the wind arrives here" could not be read off the
   * picture at all without counting pixels. The verticals are what make a
   * label usable: a timestamp under the axis with nothing rising from it names
   * a moment the eye cannot find again further up the frame.
   *
   * ANGLED BECAUSE FIVE WILL NOT FIT FLAT. "Sun 10 PM" is about eight
   * characters and the plot is 264px wide; set horizontally the outer pairs
   * overlap at four labels and are unreadable at five. -38° is the shallowest
   * rotation that clears them at this width, and shallower is better — a
   * steeply rotated label is slower to read than a flat one.
   *
   * ANCHORED AT THE END so the text hangs back and LEFT from its own tick.
   * Rotated text pivots about its anchor; anchoring at the start swings the
   * label out to the right of the line it belongs to, and the last one then
   * runs off the frame. */
  const nTicks = 5;
  const axis = [];
  for (let i = 0; i < nTicks; i++) {
    const h = hMin + ((hMax - hMin) * i) / (nTicks - 1);
    const x = X(h);
    const label = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', hour: 'numeric',
    }).format(new Date(co.now + h * 3_600_000));
    /* The outer two verticals would land on the frame edge, where they read as
     * a border rather than as a gridline. */
    if (i > 0 && i < nTicks - 1) {
      axis.push(
        `<line x1="${x.toFixed(1)}" y1="${HOME_Y}" x2="${x.toFixed(1)}" y2="${BOT}" ` +
          `stroke="var(--glass-border)" stroke-width="1"/>`
      );
    }
    axis.push(
      `<text transform="translate(${x.toFixed(1)},${AXIS_Y}) rotate(-38)" font-size="8" ` +
        `text-anchor="end">${esc(label)}</text>`
    );
  }

  return (
    `<svg class="home-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary(dash, system))}">` +
    ticks.join('') +
    bands.join('') +
    shadow +
    (observed
      ? `<path d="${observed}" fill="none" stroke="var(--text-primary)" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>`
      : '') +
    `<path d="${eye}" fill="none" stroke="var(--text-primary)" stroke-width="2" ` +
    `stroke-dasharray="5 3" stroke-linejoin="round" stroke-linecap="round"/>` +
    cpa +
    nowLine +
    railSvg.join('') +
    /* The home line last, so nothing draws over the reader's own house. */
    `<line x1="${PAD_L}" y1="${HOME_Y}" x2="${W - PAD_R}" y2="${HOME_Y}" ` +
    `stroke="var(--coast-glow)" stroke-width="1.6"/>` +
    `<text x="${PAD_L - 4}" y="${HOME_Y + 3}" font-size="8" text-anchor="end" ` +
    `fill="var(--coast-glow)">home</text>` +
    axis.join('') +
    /* ==> A LINE NOBODY CAN NAME IS A LINE NOBODY CAN TRUST. <== The dashed
     * amber is the only figure on this screen neither NHC nor GDACS
     * publishes, and the caption used to stop before mentioning it — the
     * first person to look at the chart on a real storm asked what it was.
     * Named only when it is actually drawn, so the caption does not describe
     * something that is not there. */
    /* ==> TWO LINES, AND FROM THE LEFT EDGE. <== One line ran off the right of
     * the frame and was cut mid-word — measured on Ida, "dashed = earlie".
     * It had been marginal at the old 30px gutter and the wider one for the
     * distance labels pushed it over. Starting at the frame edge rather than
     * at the plot's left edge buys back most of the difference; splitting the
     * dashed line's explanation onto its own row buys the rest, and it reads
     * better besides — it is a different KIND of statement from the other two,
     * being the only figure here that nobody published. */
    `<text x="2" y="${CAP_Y}" font-size="7.5" class="hc-lab">` +
    `distance from you · bands are how far the wind reaches</text>` +
    (shadow
      ? `<text x="2" y="${CAP_Y + 10}" font-size="7.5" class="hc-lab">` +
        `dashed = earliest it could start</text>`
      : '') +
    `</svg>`
  );
}

/** One sentence for a screen reader. States the corridor, because that is the
 *  part a sighted reader gets from the picture. */
function summary(dash, system) {
  const name = dash.storm?.name || 'The storm';
  const co = dash.corridor;
  const parts = [];
  /* ==> THE SAME §49.2 RULE THE PICTURE FOLLOWS, AND THIS IS THE SURFACE IT
   * MATTERS MOST ON. <== A screen reader gets this string INSTEAD of the
   * chart, so "passes closest at about 165 mi" — the forward walk pinned to a
   * leaving storm's current position — would be the only thing that reader is
   * told about a storm that actually came 36 mi from the house. Past tense,
   * measured distance, whenever the forecast pass is superseded — either
   * because it is behind the clock or because it is farther out than the pass
   * that already happened. One field, `dash.approachSuperseded`, so this
   * sentence cannot describe a different dot from the one drawn above it. */
  if (dash.approach?.relevant && !dash.approachSuperseded) {
    parts.push(
      `${name} passes closest at about ${formatDistance(dash.approach.nm, system)} from you`
    );
  } else if (dash.passed?.time) {
    parts.push(
      `${name} came closest at about ${formatDistance(dash.passed.nm, system)} from you`
    );
  } else {
    parts.push(`How far ${name} is from you, over time`);
  }
  const kt = co?.worst;
  if (kt) {
    const c = co.forecast[kt];
    const hrs = c.totalHours;
    /* ==> THE ACCESSIBLE TWIN MUST NOT BE THE UNDERSTATING ONE. <== This
     * sentence used to read "for about 5 hours" beside a countdown saying
     * "at least 5 hours" about the same window — and on a window under an
     * hour it produced the words "for about under an hour".
     *
     * An open-ended window closed because NHC stopped publishing that
     * threshold, not because the wind left, so its length is a FLOOR.
     * Understating how long dangerous wind lasts is the unsafe direction, and
     * a screen reader gets nothing but this string. Same wording as
     * view-home.js, deliberately — one screen cannot hold two answers.
     *
     * Found on Ida: every one of her 50 and 64 kt windows is open-ended,
     * because the field is still over the house at the last hour NHC
     * published radii for it. Bertha could not produce the case. */
    parts.push(
      `${WIND_LABEL[kt] || kt + ' knot'} wind reaches you ${
        windDurationClause(hrs, c.openEnded)
      }`
    );
  } else if (co?.published?.length) {
    parts.push('no forecast wind field reaches you');
  }
  return parts.join('; ') + '.';
}
