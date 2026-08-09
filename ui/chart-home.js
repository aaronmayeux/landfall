/**
 * chart-home.js — the home dashboard's hero: strength over distance, one clock.
 *
 * ==> WHAT IT SHOWS, AND WHY IT IS TWO LANES AND NOT ONE PICTURE. <==
 *
 * Three shapes were mocked against Bertha's real advisory before this was
 * written (`mockups/home.html`): a radial "approach" with home at the centre,
 * these linked lanes, and a plain countdown. The radial is the prettier
 * object and it lost on the geometry — a storm passing east to west draws a
 * nearly flat line skimming under the centre, which wastes the whole circle
 * and only comes alive on a recurving track. These lanes work on every track
 * shape, and they can show the one thing the radial could only imply.
 *
 * ==> THE RIBBON IS THE POINT OF THE CHART. <==
 *
 * The lower lane's shaded band is NHC's own two-thirds track error at each
 * forecast hour (lib/cone-error.js). Where it touches the home line at the
 * bottom, "directly overhead" is inside the forecast. On Bertha, measured
 * from a New Orleans home, the pass is 31.6 nm and the band at that hour is
 * 40.25 nm — so the ribbon crosses the baseline, and the picture says what a
 * bare "closest pass 36 miles south" cannot.
 *
 * A CHART IS NOT AN ACCESSIBLE ANSWER. Everything here is also stated in the
 * countdown list and the figures beside it, which is what a screen reader
 * reads and what a keyboard user tabs. The `<title>`/`aria-label` below is a
 * summary, not a substitute — an SVG cannot be explored, and the plan's
 * "countdown as its accessible twin" is a requirement, not a nicety.
 *
 * PURE STRING BUILDING. No DOM, no state, no listeners — hand it a dashboard
 * and it returns markup. That is what lets it be diffed and re-rendered on a
 * poll without touching focus.
 *
 * Imports: config/, lib/. Never data/ — the figures arrive already computed.
 */

import { greatCircleNm, densifyTrack } from '../lib/geo.js';
import { coneErrorNm } from '../lib/cone-error.js';
import { categoryColor } from '../lib/category.js';
import { formatDistance } from '../lib/units.js';

/* ---------------------------------------------------------------------------
 * GEOMETRY OF THE FRAME
 *
 * A 320-wide box because that is what a phone's bottom sheet gives us at the
 * narrowest supported width, minus the drawer's padding. It scales with the
 * viewBox on anything larger, so the rail layout gets the same shape bigger
 * rather than a different chart.
 * ------------------------------------------------------------------------- */
const W = 320;
const H = 226;
const PAD_L = 30;   // room for the axis labels
const PAD_R = 8;

const LANE_A = { top: 16, bottom: 78 };   // strength
const LANE_B = { top: 106, bottom: 190 }; // distance from home

const AXIS_Y = H - 4;

const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const MS_PER_HOUR = 3_600_000;

/** Nice round tick values that stay round after unit conversion is applied to
 *  the LABEL only — the axis itself is always in the stored unit (nm), so a
 *  metric and an imperial reader see the same curve with different numbers. */
function distanceTicks(maxNm) {
  const candidates = [50, 100, 200, 300, 500, 750, 1000];
  return candidates.filter((c) => c < maxNm * 0.92).slice(-2);
}

/**
 * Build the hero chart.
 *
 * @param {object}  dash    a buildHomeDashboard() result
 * @param {string}  system  unit system, for the axis labels only
 * @returns {string} SVG markup, or '' when there is nothing honest to draw
 */
export function homeChart(dash, system) {
  if (!dash?.ok) return '';
  const { storm, home, curve, approach, now } = dash;
  if (!Array.isArray(curve) || curve.length === 0 || !home) return '';

  /* The present position is the chart's origin: a curve that starts at the
   * first forecast hour leaves a gap between "now" and the storm, and the
   * reader fills that gap in with an assumption. */
  const points = [
    { lon: storm.lon, lat: storm.lat, time: storm.observedAt, windKt: storm.windKt },
    ...curve,
  ].filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && p.time);
  if (points.length < 2) return '';

  const samples = densifyTrack(points)
    .map((p) => {
      const ms = Date.parse(p.time);
      if (!Number.isFinite(ms)) return null;
      return {
        h: (ms - now) / MS_PER_HOUR,
        nm: greatCircleNm(home.lon, home.lat, p.lon, p.lat),
        kt: Number.isFinite(p.windKt) ? p.windKt : null,
      };
    })
    .filter(Boolean);
  if (samples.length < 2) return '';

  const hMax = samples[samples.length - 1].h;
  const hMin = Math.min(0, samples[0].h);
  if (!(hMax > hMin)) return '';

  /* ==> THE DISTANCE AXIS IS SCALED TO THE BAND, NOT THE TRACK. <== If the
   * ribbon's upper edge runs off the top of the lane it gets clipped, and a
   * clipped uncertainty band reads as a smaller uncertainty. */
  let nmMax = 0;
  for (const s of samples) {
    const e = coneErrorNm(Math.max(0, s.h), storm.basin) ?? 0;
    nmMax = Math.max(nmMax, s.nm + e);
  }
  nmMax = Math.max(nmMax, 1);

  const X = (h) => PAD_L + ((W - PAD_L - PAD_R) * (h - hMin)) / (hMax - hMin);
  const YB = (nm) =>
    LANE_B.bottom - ((LANE_B.bottom - LANE_B.top) * Math.min(nm, nmMax)) / nmMax;

  /* --- lane A: strength ---------------------------------------------------
   * OMITTED ENTIRELY when the source publishes no per-point wind. A GDACS
   * storm gets one lane, not an empty box with an axis on it: a blank frame
   * reads as "zero", and §5 wants "not published" to look like nothing rather
   * than like a measurement of nothing. */
  const winds = samples.filter((s) => s.kt != null).map((s) => s.kt);
  const hasWind = winds.length >= 2;

  let laneA = '';
  if (hasWind) {
    const ktLo = Math.max(0, Math.min(...winds) - 8);
    const ktHi = Math.max(...winds) + 8;
    const YA = (kt) =>
      LANE_A.bottom - ((LANE_A.bottom - LANE_A.top) * (kt - ktLo)) / (ktHi - ktLo || 1);

    /* ONE SEGMENT PER STEP, COLOURED BY CATEGORY, and that is deliberate
     * rather than decorative: §6 fixes the category ramp so a Cat 3 reads the
     * same everywhere, and this is the one place in the app you can watch a
     * storm CROSS a boundary. A single-colour line would throw that away. */
    const segs = [];
    const lit = samples.filter((s) => s.kt != null);
    for (let i = 1; i < lit.length; i++) {
      const a = lit[i - 1];
      const b = lit[i];
      const mid = (a.kt + b.kt) / 2;
      segs.push(
        `<line x1="${X(a.h).toFixed(1)}" y1="${YA(a.kt).toFixed(1)}" ` +
          `x2="${X(b.h).toFixed(1)}" y2="${YA(b.kt).toFixed(1)}" ` +
          `stroke="${categoryColor(catIndex(mid), storm.nature)}" ` +
          `stroke-width="2.4" stroke-linecap="round"/>`
      );
    }

    const ktTicks = [Math.round(ktHi / 5) * 5 - 5, Math.round(ktLo / 5) * 5 + 5]
      .filter((k) => k > ktLo && k < ktHi);
    const grid = ktTicks
      .map(
        (k) =>
          `<line x1="${PAD_L}" y1="${YA(k).toFixed(1)}" x2="${W - PAD_R}" y2="${YA(k).toFixed(1)}" ` +
          `stroke="var(--glass-border)" stroke-width="1"/>` +
          `<text x="2" y="${(YA(k) + 3).toFixed(1)}" font-size="8">${k}kt</text>`
      )
      .join('');

    const cpaDot =
      approach?.time && Number.isFinite(dash.atClosest?.windKt)
        ? `<circle cx="${X(hoursOf(approach.time, now)).toFixed(1)}" ` +
          `cy="${YA(dash.atClosest.windKt).toFixed(1)}" r="4" ` +
          `fill="${categoryColor(catIndex(dash.atClosest.windKt), storm.nature)}" ` +
          `stroke="var(--space)" stroke-width="1.4"/>`
        : '';

    laneA =
      grid +
      `<text x="${PAD_L}" y="9" font-size="8" class="hc-lab">STRENGTH</text>` +
      segs.join('') +
      cpaDot;
  }

  /* --- lane B: distance, with the band ------------------------------------ */
  const distPath = samples
    .map((s, i) => `${i ? 'L' : 'M'}${X(s.h).toFixed(1)},${YB(s.nm).toFixed(1)}`)
    .join(' ');

  /* THE RIBBON IS CLAMPED AT ZERO ON ITS LOWER EDGE, and that clamp is the
   * honest one: a distance cannot be negative, so an error circle wider than
   * the pass means the band reaches the house and stops there. Letting it go
   * below the baseline would draw the storm on the wrong side of home. */
  let band = '';
  const anyBand = coneErrorNm(1, storm.basin) != null;
  if (anyBand) {
    const upper = [];
    const lower = [];
    for (const s of samples) {
      if (s.h < 0) continue;
      const e = coneErrorNm(s.h, storm.basin);
      if (e == null) continue;
      upper.push(`${X(s.h).toFixed(1)},${YB(Math.max(0, s.nm - e)).toFixed(1)}`);
      lower.push(`${X(s.h).toFixed(1)},${YB(s.nm + e).toFixed(1)}`);
    }
    if (upper.length > 1) {
      band =
        `<path d="M${upper.join(' L')} L${lower.reverse().join(' L')} Z" ` +
        `fill="var(--home-band-fill)" stroke="var(--home-band-edge)" ` +
        `stroke-width="0.8" stroke-dasharray="3 3"/>`;
    }
  }

  const ticks = distanceTicks(nmMax)
    .map(
      (nm) =>
        `<line x1="${PAD_L}" y1="${YB(nm).toFixed(1)}" x2="${W - PAD_R}" y2="${YB(nm).toFixed(1)}" ` +
        `stroke="var(--glass-border)" stroke-width="1"/>` +
        `<text x="2" y="${(YB(nm) + 3).toFixed(1)}" font-size="8">${esc(
          formatDistance(nm, system).replace(' ', '')
        )}</text>`
    )
    .join('');

  /* The home baseline is drawn in the coastline's own cyan, the same ink the
   * house wears on the globe, so the line the ribbon reaches for is visibly
   * the reader's house and not just an axis. */
  const baseline =
    `<line x1="${PAD_L}" y1="${YB(0).toFixed(1)}" x2="${W - PAD_R}" y2="${YB(0).toFixed(1)}" ` +
    `stroke="var(--coast-glow)" stroke-width="1.4"/>` +
    `<text x="2" y="${(YB(0) + 3).toFixed(1)}" font-size="8" fill="var(--coast-glow)">home</text>`;

  /* --- the one marker crossing both lanes --------------------------------- */
  let marker = '';
  if (approach?.time) {
    const hx = X(hoursOf(approach.time, now)).toFixed(1);
    marker =
      `<line x1="${hx}" y1="${LANE_A.top - 6}" x2="${hx}" y2="${LANE_B.bottom}" ` +
      `stroke="var(--text-primary)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>` +
      `<circle cx="${hx}" cy="${YB(approach.nm).toFixed(1)}" r="4" fill="var(--text-primary)"/>`;
  }

  /* --- time axis ----------------------------------------------------------
   * THREE LABELS AT MOST. A five-day track with a tick every twelve hours is
   * ten overlapping strings at phone width; the countdown list beside this is
   * where exact times live. */
  const axis = [hMin, (hMin + hMax) / 2, hMax]
    .map((h, i) => {
      const d = new Date(now + h * MS_PER_HOUR);
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

  const label = summary(dash, system);

  return (
    `<svg class="home-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">` +
    laneA +
    ticks +
    `<text x="${PAD_L}" y="${LANE_B.top - 4}" font-size="8" class="hc-lab">DISTANCE FROM HOME</text>` +
    band +
    baseline +
    `<path d="${distPath}" fill="none" stroke="var(--text-primary)" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>` +
    marker +
    axis +
    `</svg>`
  );
}

function hoursOf(t, now) {
  return (Date.parse(t) - now) / MS_PER_HOUR;
}

/** Local wind→index, matching lib/category.js's thresholds through its own
 *  public function would mean importing two things to colour one line; this
 *  is the same ramp expressed once, for a MIDPOINT of two forecast winds
 *  which is a drawing value and never a stated category. */
function catIndex(kt) {
  if (kt >= 137) return 6;
  if (kt >= 113) return 5;
  if (kt >= 96) return 4;
  if (kt >= 83) return 3;
  if (kt >= 64) return 2;
  if (kt >= 34) return 1;
  return 0;
}

/** One sentence for a screen reader. Deliberately states the band, because
 *  the band is the part a sighted reader gets from the picture and everyone
 *  else would otherwise never hear. */
function summary(dash, system) {
  const name = dash.storm?.name || 'The storm';
  if (!dash.approach) return `${name}'s forecast distance from your home over time.`;
  const d = formatDistance(dash.approach.nm, system);
  const parts = [`${name} passes closest at about ${d} from your home`];
  if (dash.atClosest?.windKt != null) {
    parts.push(`at ${Math.round(dash.atClosest.windKt)} knots`);
  }
  if (dash.band) {
    parts.push(
      dash.band.reachesHome
        ? `two thirds of past forecasts fell within ${formatDistance(dash.band.nm, system)} of that, which reaches your home`
        : `two thirds of past forecasts fell within ${formatDistance(dash.band.nm, system)} of that`
    );
  }
  return `${parts.join('; ')}.`;
}
