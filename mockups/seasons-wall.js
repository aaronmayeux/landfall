/* seasons-wall.js — the Wall of Years mockup's behaviour. §57.29, §57.30 step 14.
 *
 * ==> IT IS AN EXTERNAL FILE ON PURPOSE AND THE FIRST ATTEMPT SHIPPED IT
 *     INLINE. <== `_headers` sends `script-src 'self'` with ONE pinned hash
 *     and no 'unsafe-inline', so an inline <script> in the html is BLOCKED by
 *     the live CSP. The page then renders as an empty shell with the CSS
 *     intact — the frames draw, the controls draw, and nothing inside them
 *     does — which looks exactly like missing data and is not.
 *
 *     `mockups/environment-ribbon.html` had already written this warning into
 *     its own header after hitting it once. A rule that lives inside one
 *     mockup cannot be found by the next one, so it is in SPEC-OPS.md §17.9
 *     now as well. Same-origin .js needs no policy change.
 *
 * Nothing here is app code and nothing here ships.
 */
import { WALL } from './seasons-wall-data.js';

/* Saffir-Simpson index -> the fixed colour. Index 0 is TD. A null category is
 * a storm the record never graded, and it gets GENERIC — never a colour it did
 * not earn (SPEC §6). */
const CAT = ['var(--cat0)','var(--cat1)','var(--cat2)','var(--cat3)','var(--cat4)','var(--cat5)','var(--cat6)'];
const catColor = (c) => (c == null ? 'var(--catNone)' : CAT[c] || 'var(--catNone)');
const SATELLITE_ERA_FROM = 1966;   /* SEASONS.satelliteEraFrom */
const CAT_LABEL = ['tropical depression','tropical storm','Category 1','Category 2','Category 3','Category 4','Category 5'];

/* Each storm arrives as [name, cat, windKt, landfall, firstDay, lastDay] —
 * see the header of seasons-wall-data.js. Named here once so nothing below
 * indexes a raw array and quietly reads the wrong column. */
const NAME = 0, CAT_I = 1, WIND = 2, LF = 3, T0 = 4, T1 = 5;
const DAY_MS = 86400000;

const state = { basin: 'atlantic', screen: 'wall', year: null };

/* -------------------------------------------------------------------------
 * ONE DOT SIZE ACROSS THE WHOLE WALL.
 *
 * If a violent year did not LOOK bigger than a quiet one the screen would have
 * no point, so the scale cannot be per-row. The dot is sized so the widest
 * season in the basin fits the strip, and every other year is drawn at that
 * same size with empty space after it.
 * ----------------------------------------------------------------------- */
function dotSizeFor(basin, stripPx) {
  const years = WALL.basins[basin].years;
  let widest = 0;
  for (const list of Object.values(years)) if (list.length > widest) widest = list.length;
  const gap = 2;
  const size = Math.floor((stripPx - gap * (widest - 1)) / widest);
  return { size: Math.max(3, Math.min(12, size)), gap, widest };
}

/* ==> THE STRENGTH QUESTION, AND IT IS THE ONE WORTH ARGUING ABOUT. <==
 * `even` is what §57.29 describes: one storm, one dot, one size, so the LENGTH
 * of a strip is the season's count and colour carries strength. It reads count
 * loudly and strength quietly — a long weak year out-shouts a short violent
 * one, and 1935 is exactly that shape.
 * `graded` scales the radius with the category, so a Cat 5 draws at full size
 * and a depression at just over half. The season's weight becomes visible; the
 * count becomes slightly harder to read off, because the strip is no longer a
 * uniform ruler. */
function radiusFor(size, cat, weight) {
  const r = size / 2;
  if (weight !== 'graded') return r;
  const c = cat == null ? 1 : cat;      /* ungraded sits with a TS, not at zero */
  return r * (0.55 + 0.45 * (c / 6));
}

function stripSvg(list, size, gap, weight) {
  const w = list.length * size + Math.max(0, list.length - 1) * gap;
  const h = size + 2;
  const parts = list.map((s, i) => {
    const x = i * (size + gap);
    const r = size / 2;
    const rr = radiusFor(size, s[CAT_I], weight);
    const dot = `<circle cx="${x + r}" cy="${r}" r="${rr}" fill="${catColor(s[CAT_I])}"/>`;
    const lf = s[LF] ? `<rect class="lf" x="${x}" y="${size + 0.5}" width="${size}" height="1.5" fill="var(--text-primary)" opacity="0.7"/>` : '';
    return dot + lf;
  }).join('');
  return `<svg class="yr-strip" viewBox="0 0 ${Math.max(w, 1)} ${h}" width="${w}" height="${h}"
    preserveAspectRatio="xMinYMid meet" aria-hidden="true">${parts}</svg>`;
}

/* A row's accessible name. The dots are decoration; this sentence is what a
 * screen reader gets, and it has to carry the same information. */
function rowLabel(year, list) {
  if (!list.length) return `${year} — no storms recorded`;
  let peak = null;
  for (const s of list) if (s[CAT_I] != null && (peak == null || s[CAT_I] > peak)) peak = s[CAT_I];
  const strongest = peak == null ? 'none graded' : `strongest ${CAT_LABEL[peak]}`;
  const under = year < SATELLITE_ERA_FROM ? ', before satellites — likely an undercount' : '';
  return `${year} — ${list.length} storm${list.length === 1 ? '' : 's'}, ${strongest}${under}`;
}

function wallHtml(basin, stripPx, decades, weight) {
  const b = WALL.basins[basin];
  const years = Object.keys(b.years).map(Number).sort((a, z) => z - a);
  const { size, gap, widest } = dotSizeFor(basin, stripPx);
  const first = years[years.length - 1];

  let html = `<div class="wall" style="--dot:${size}px;--dot-gap:${gap}px">`;
  html += `<p class="wall-note">${b.label} &middot; ${years.length} seasons, ${first}&ndash;${years[0]}.
    One dot per storm, coloured by the strongest it ever got. Busiest year: ${widest} storms.</p>`;

  let lastDecade = null;
  let eraDrawn = false;
  for (const y of years) {
    if (!eraDrawn && y < SATELLITE_ERA_FROM) {
      html += `<p class="era-mark">Below this line nobody was watching from orbit. A storm that
        stayed at sea was simply never recorded, so these rows are an undercount &mdash; a short
        strip here is not evidence of a quiet year.</p>`;
      eraDrawn = true;
    }
    const dec = Math.floor(y / 10) * 10;
    if (decades && dec !== lastDecade) {
      html += `<p class="decade">${dec}s</p>`;
      lastDecade = dec;
    }
    const list = b.years[y];
    const pre = y < SATELLITE_ERA_FROM ? ' data-pre="1"' : '';
    html += `<button class="yr" type="button" data-year="${y}"${pre} aria-label="${rowLabel(y, list)}">
      <span class="yr-num">${y}</span>
      <span>${stripSvg(list, size, gap, weight)}</span>
      <span class="yr-count">${list.length}</span>
    </button>`;
  }
  return html + '</div>';
}

/* -------------------------------------------------------------------------
 * THE SECOND SCREEN. Today's board with the year dropdown removed and the
 * year moved into the header, where the back chevron is.
 * ----------------------------------------------------------------------- */
function boardHtml(basin, year) {
  const b = WALL.basins[basin];
  const list = b.years[year] || [];
  const named = list.filter((s) => s[NAME]).length;
  const hur = list.filter((s) => s[CAT_I] != null && s[CAT_I] >= 2).length;
  const maj = list.filter((s) => s[CAT_I] != null && s[CAT_I] >= 4).length;
  const lf = list.filter((s) => s[LF]).length;
  const fmt = (d) => (d == null ? '' : new Date(d * DAY_MS).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));

  let html = `<div class="score">
      <div><b>${list.length}</b><span>storms</span></div>
      <div><b>${hur}</b><span>hurricanes</span></div>
      <div><b>${maj}</b><span>major</span></div>
      <div><b>${lf}</b><span>landfalls</span></div>
    </div>
    <div class="filters">
      <button type="button" aria-pressed="true">All</button>
      <button type="button" aria-pressed="false">Hurricanes</button>
      <button type="button" aria-pressed="false">Majors</button>
      <button type="button" aria-pressed="false">Landfalling</button>
      <button type="button" aria-pressed="false">Near home</button>
    </div>
    <ul class="roster">`;
  for (const s of list) {
    const name = s[NAME] || 'Unnamed';
    const badge = s[WIND] == null ? '—' : `${s[WIND]} kt`;
    html += `<li class="st">
      <span class="st-dot" style="background:${catColor(s[CAT_I])}"></span>
      <span class="st-name">${name}<small>${fmt(s[T0])} – ${fmt(s[T1])}${s[LF] ? ' · landfall' : ''}</small></span>
      <span class="st-badge">${badge}</span>
    </li>`;
  }
  html += '</ul>';
  if (!list.length) html = `<p class="wall-note">The record holds no storms for ${year}.</p>`;
  if (named === 0 && list.length) {
    html += `<p class="wall-note">No storm this year was named — naming began in 1950.</p>`;
  }
  return html;
}

/* ------------------------------------------------------------------------- */
function render() {
  for (const frame of document.querySelectorAll('.frame')) {
    const isRail = frame.dataset.frame === 'rail';
    const width = isRail ? 340 : 390;
    /* strip width = frame - sheet padding (16 each side) - year column (3.4em
     * at 0.78rem ≈ 42px) - two 8px gaps - the count column when shown */
    const countCol = document.body.dataset.count === 'on' ? 30 : 0;
    const stripPx = width - 32 - 42 - 16 - countCol;

    const b = WALL.basins[state.basin];
    const decades = document.getElementById('dec').checked;

    const head = state.screen === 'wall'
      ? `<div class="sheet-head">
           <span class="icon-btn" hidden></span>
           <span class="sheet-title">Past storms<small>${b.label} &middot; every season on record</small></span>
           <button class="icon-btn" type="button" title="Close">&#10005;</button>
         </div>
         <div class="basin">
           <button type="button" data-basin="atlantic" aria-pressed="${state.basin === 'atlantic'}">Atlantic</button>
           <button type="button" data-basin="epacific" aria-pressed="${state.basin === 'epacific'}">East Pacific</button>
         </div>`
      : `<div class="sheet-head">
           <button class="icon-btn" type="button" data-back title="Back to every year">&#8249;</button>
           <span class="sheet-title">${state.year}<small>${b.label} &middot; ${(b.years[state.year] || []).length} storms</small></span>
           <button class="icon-btn" type="button" title="Close">&#10005;</button>
         </div>`;

    const body = state.screen === 'wall'
      ? wallHtml(state.basin, stripPx, decades, document.body.dataset.weight || 'even')
      : boardHtml(state.basin, state.year);

    const bar = state.screen === 'wall'
      ? `<div class="bar"><span>Past storms &middot; ${b.label}</span><span>pick a year</span></div>`
      : `<div class="bar"><span>Past storms &middot; ${state.year} &middot; ${b.label}</span><span>0 drawn</span></div>`;

    frame.innerHTML = `<div class="sheet">${head}<div class="sheet-body">${body}</div></div>${bar}`;
  }
}

document.addEventListener('click', (e) => {
  const yr = e.target.closest('.yr');
  if (yr) { state.year = Number(yr.dataset.year); state.screen = 'board'; render(); return; }
  if (e.target.closest('[data-back]')) { state.screen = 'wall'; render(); return; }
  const bs = e.target.closest('[data-basin]');
  if (bs) { state.basin = bs.dataset.basin; state.screen = 'wall'; render(); }
});

const set = (k, v) => { document.body.dataset[k] = v; render(); };
document.getElementById('density').onchange = (e) => {
  document.documentElement.style.setProperty('--row-h', `${e.target.value}px`);
  set('density', e.target.value);
};
document.getElementById('pre').onchange   = (e) => set('pre', e.target.value);
document.getElementById('count').onchange = (e) => set('count', e.target.checked ? 'on' : 'off');
document.getElementById('lf').onchange    = (e) => set('lf', e.target.checked ? 'on' : 'off');
document.getElementById('dec').onchange   = () => render();
document.getElementById('weight').onchange = (e) => set('weight', e.target.value);

render();
