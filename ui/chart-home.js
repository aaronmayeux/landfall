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
import { WIND_LABEL } from '../lib/wind.js';

const W = 320;
const H = 226;
const PAD_L = 30;
const PAD_R = 8;

/** Headroom above the home line. A storm at the house compresses every band
 *  into the top of the frame; without this they pile onto the edge. */
const HOME_Y = 34;
const BOT = 182;
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
  const stripes = [];
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

    /* ==> THE PAYOFF. <== Where the field is ON the house, the home line
     * itself wears that threshold's colour. Clamping the band at zero hides
     * how far past the house it reached, so the line has to carry it. */
    for (const [a, b] of c.windows) {
      const x0 = X((Date.parse(a) - co.now) / 3_600_000);
      const x1 = X(b ? (Date.parse(b) - co.now) / 3_600_000 : hMax);
      if (!(x1 > x0)) continue;
      stripes.push(
        `<line x1="${x0.toFixed(1)}" y1="${HOME_Y}" x2="${x1.toFixed(1)}" y2="${HOME_Y}" ` +
          `stroke="${BAND_COLOR[kt]}" stroke-width="5" stroke-linecap="round"/>`
      );
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

  /* --- time axis: three labels. Exact times live in the countdown. -------- */
  const axis = [hMin, (hMin + hMax) / 2, hMax]
    .map((h, i) => {
      const d = new Date(co.now + h * 3_600_000);
      const label =
        i === 0 && h <= 0
          ? 'now'
          : new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric' }).format(d);
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
    /* The home line last, so nothing draws over the reader's own house. */
    `<line x1="${PAD_L}" y1="${HOME_Y}" x2="${W - PAD_R}" y2="${HOME_Y}" ` +
    `stroke="var(--coast-glow)" stroke-width="1.6"/>` +
    stripes.join('') +
    `<text x="2" y="${HOME_Y + 3}" font-size="8" fill="var(--coast-glow)">home</text>` +
    axis +
    `<text x="${PAD_L}" y="${CAP_Y}" font-size="7.5" class="hc-lab">` +
    `distance from home · bands are wind reach</text>` +
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
      `${name} passes closest at about ${formatDistance(dash.approach.nm, system)} from your home`
    );
  } else {
    parts.push(`${name}'s distance from your home over time`);
  }
  const kt = co?.worst;
  if (kt) {
    const c = co.forecast[kt];
    const hrs = c.totalHours;
    parts.push(
      `${WIND_LABEL[kt] || kt + ' knot'} winds reach your home for about ${
        hrs >= 1 ? Math.round(hrs) + ' hours' : 'under an hour'
      }`
    );
  } else if (co?.published?.length) {
    parts.push('no forecast wind field reaches your home');
  }
  return parts.join('; ') + '.';
}
