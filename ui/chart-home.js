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
 * threshold's colour for the hours that wind was on the house, and it was
 * cut on glass: overstriking the reader's own house in the wind's colour
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
import { formatDistance } from '../lib/units.js';
import { WIND_LABEL, windDurationClause } from '../lib/wind.js';

const W = 320;
const H = 250;
const PAD_L = 30;
const PAD_R = 8;

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
const RAIL_Y = Object.freeze({ 34: 44, 50: 30, 64: 16 });
const RAIL_H = 4;

/** Headroom above the home line, which the rail now occupies. */
const HOME_Y = 58;
const BOT = 206;
const AXIS_Y = H - 22;
const CAP_Y = H - 6;

/** How far out the chart bothers to plot, as a multiple of the near ring.
 *  BEYOND THIS THE DETAIL THAT MATTERS IS CRUSHED: a five-day track running
 *  to 400 nm squashes a 30 nm closest pass into two pixels of the frame. The
 *  countdown carries the full horizon; this carries the approach. */
const WINDOW_RINGS = 3;

const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const BAND_COLOR = { 34: 'var(--kt34)', 50: 'var(--kt50)', 64: 'var(--kt64)' };

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
  const limit = HOME_DASH.nearRingNm * WINDOW_RINGS;
  let end = 0;
  for (let i = 0; i < co.samples.length; i++) if (co.samples[i].nm <= limit) end = i;
  const cpaH = dash.approach?.time
    ? (Date.parse(dash.approach.time) - co.now) / 3_600_000
    : 0;
  while (end + 1 < co.samples.length && co.samples[end].h < cpaH + 6) end++;
  const S = co.samples.slice(0, Math.max(end + 1, 2));

  const hMin = Math.min(0, S[0].h);
  const hMax = S[S.length - 1].h;
  if (!(hMax > hMin)) return '';

  let nmMax = 0;
  for (const s of S) nmMax = Math.max(nmMax, s.nm);
  nmMax = Math.max(nmMax, 1);

  const X = (h) => PAD_L + ((W - PAD_L - PAD_R) * (h - hMin)) / (hMax - hMin);
  /* ZERO AT THE TOP. The one line in this file that inverts the axis. */
  const Y = (nm) => HOME_Y + ((BOT - HOME_Y) * Math.min(Math.max(nm, 0), nmMax)) / nmMax;

  /* --- the wind bands, widest threshold first so 64 draws over 34 --------- */
  const bands = [];
  const rail = [];
  for (const kt of [34, 50, 64]) {
    if (!co.published.includes(kt)) continue;
    const c = co.forecast[kt];
    if (!c) continue;
    /* A band for a field that never comes near is noise on a phone. */
    if (!c.everInside && c.closestGapNm > HOME_DASH.nearRingNm) continue;

    const lit = S.filter((s) => s.gap[kt] != null);
    if (lit.length < 2) continue;

    /* Top edge = the field's leading edge, clamped AT the house. It cannot
     * cross to the far side: a negative distance is not a place. */
    const top = lit.map((s) => `${X(s.h).toFixed(1)},${Y(Math.max(0, s.gap[kt])).toFixed(1)}`);
    const bottom = lit.slice().reverse().map((s) => `${X(s.h).toFixed(1)},${Y(s.nm).toFixed(1)}`);
    bands.push(
      `<path d="M${top.join(' L')} L${bottom.join(' L')} Z" ` +
        `fill="color-mix(in srgb, ${BAND_COLOR[kt]} 24%, transparent)" ` +
        `stroke="${BAND_COLOR[kt]}" stroke-width="1.4" stroke-linejoin="round"/>`
    );

    /* The rail row for this threshold, one bar per window it is on the house.
     * Drawn only for a field that actually arrives — a threshold that comes
     * near without reaching gets a band and no bar, which is the true
     * distinction between "close" and "here". */
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
      rail.push({
        kt,
        x0,
        x1: Math.max(x1, x0 + 1.5),
        y: RAIL_Y[kt],
        startsBefore: X(ha) < PAD_L - 0.01,
        runsPast: X(hb) > W - PAD_R + 0.01,
        at: a,
        hours: (Date.parse(b || a) - Date.parse(a)) / 3_600_000,
        openEnded: c.openEnded && b === c.windows[c.windows.length - 1][1],
      });
    }
  }

  /* --- the earliest-arrival shadow ----------------------------------------
   * OURS, NOT NHC'S — their track error applied to their wind radii. Drawn as
   * a dashed LINE and never a filled band: a second translucent fill over
   * three of them turns the whole frame to mud, and this figure has not
   * earned equal weight with the published ones. */
  let shadow = '';
  const early = co.earliest?.[34];
  if (early && co.published.includes(34)) {
    const lit = S.filter((s) => s.gapEarly?.[34] != null);
    if (lit.length > 1) {
      const d = lit
        .map((s, i) => `${i ? 'L' : 'M'}${X(s.h).toFixed(1)},${Y(Math.max(0, s.gapEarly[34])).toFixed(1)}`)
        .join(' ');
      shadow =
        `<path d="${d}" fill="none" stroke="var(--home-band-edge)" stroke-width="1.2" ` +
        `stroke-dasharray="4 3" stroke-linejoin="round"/>`;
    }
  }

  /* --- the centre track ---------------------------------------------------- */
  const eye = S.map((s, i) => `${i ? 'L' : 'M'}${X(s.h).toFixed(1)},${Y(s.nm).toFixed(1)}`).join(' ');

  /* --- gridlines: two, faint. The home line carries the reference. -------- */
  const ticks = [];
  for (const frac of [0.45, 0.9]) {
    const nm = nmMax * frac;
    ticks.push(
      `<line x1="${PAD_L}" y1="${Y(nm).toFixed(1)}" x2="${W - PAD_R}" y2="${Y(nm).toFixed(1)}" ` +
        `stroke="var(--glass-border)" stroke-width="1"/>` +
        `<text x="2" y="${(Y(nm) + 3).toFixed(1)}" font-size="8">${esc(
          formatDistance(nm, system).replace(' ', '')
        )}</text>`
    );
  }

  /* --- the closest pass, as a summit marker ------------------------------- */
  let cpa = '';
  if (dash.approach?.relevant && dash.approach.time) {
    const x = X(cpaH).toFixed(1);
    const y = Y(dash.approach.nm).toFixed(1);
    cpa =
      `<line x1="${x}" y1="${HOME_Y}" x2="${x}" y2="${y}" stroke="var(--text-primary)" ` +
      `stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>` +
      `<circle cx="${x}" cy="${y}" r="4" fill="var(--text-primary)"/>`;
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
    /* The threshold itself, in the gutter, so a colour nobody has learned yet
     * still says which wind it is. */
    railSvg.push(
      `<text x="2" y="${(mid + 2.5).toFixed(1)}" font-size="7.5" fill="${c}">${r.kt}kt</text>`
    );
  }

  /* --- NOW ----------------------------------------------------------------
   * ==> THE CHART DOES NOT START AT "NOW" AND USED TO CLAIM IT DID. <== The
   * first sample is the storm's position as of the ADVISORY, which on a live
   * feed is up to three hours old, and the leftmost axis label said "now"
   * regardless. The vertical marks the actual present; the axis label under it
   * now says what time the chart really begins. */
  const nowX = X(0);
  const nowLine =
    nowX >= PAD_L - 0.01 && nowX <= W - PAD_R + 0.01
      ? `<line x1="${nowX.toFixed(1)}" y1="6" x2="${nowX.toFixed(1)}" y2="${BOT}" ` +
        `stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2 3"/>` +
        `<text x="${(nowX + 3).toFixed(1)}" y="12" font-size="7.5" fill="var(--text-muted)">now</text>`
      : '';

  /* --- time axis: three labels. Exact times live in the countdown. -------- */
  const axis = [hMin, (hMin + hMax) / 2, hMax]
    .map((h, i) => {
      const d = new Date(co.now + h * 3_600_000);
      const label = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        hour: 'numeric',
      }).format(d);
      return (
        `<text x="${X(h).toFixed(1)}" y="${AXIS_Y}" font-size="8" ` +
        `text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${esc(label)}</text>`
      );
    })
    .join('');

  return (
    `<svg class="home-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary(dash, system))}">` +
    ticks.join('') +
    bands.join('') +
    shadow +
    `<path d="${eye}" fill="none" stroke="var(--text-primary)" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>` +
    cpa +
    nowLine +
    railSvg.join('') +
    /* The home line last, so nothing draws over the reader's own house. */
    `<line x1="${PAD_L}" y1="${HOME_Y}" x2="${W - PAD_R}" y2="${HOME_Y}" ` +
    `stroke="var(--coast-glow)" stroke-width="1.6"/>` +
    `<text x="2" y="${HOME_Y + 3}" font-size="8" fill="var(--coast-glow)">home</text>` +
    axis +
    /* ==> A LINE NOBODY CAN NAME IS A LINE NOBODY CAN TRUST. <== The dashed
     * amber is the only figure on this screen neither NHC nor GDACS
     * publishes, and the caption used to stop before mentioning it — the
     * first person to look at the chart on a real storm asked what it was.
     * Named only when it is actually drawn, so the caption does not describe
     * something that is not there. */
    `<text x="${PAD_L}" y="${CAP_Y}" font-size="7.5" class="hc-lab">` +
    `distance from you · bands are how far the wind reaches` +
    (shadow ? ` · dashed = earliest it could start` : '') +
    `</text>` +
    `</svg>`
  );
}

/** One sentence for a screen reader. States the corridor, because that is the
 *  part a sighted reader gets from the picture. */
function summary(dash, system) {
  const name = dash.storm?.name || 'The storm';
  const co = dash.corridor;
  const parts = [];
  if (dash.approach?.relevant) {
    parts.push(
      `${name} passes closest at about ${formatDistance(dash.approach.nm, system)} from you`
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
