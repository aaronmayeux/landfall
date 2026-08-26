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

/* ==> SETTINGS AARON PICKED ON GLASS, 2026-08-26. FROZEN, NOT TOGGLES. <==
 * 44px rows, even dots, count on the right, pre-1966 shaded with a line at the
 * boundary, landfalls NOT marked per-dot, AND NO DECADE HEADINGS — the heading
 * was the first thing to go, it chopped the scroll into chunks and the wall
 * reads better as one unbroken run. §57.36. */
const ROW_PX = 44, WEIGHT = 'even', SHOW_COUNT = true;

/* Filter state. `cats` is the seven category chips; all start checked, and
 * there is deliberately NO "majors" shortcut — it is three chips, and a
 * shortcut duplicating a control is a second thing to keep in sync. §57.36. */
const state = {
  basin: 'atlantic', screen: 'wall', year: null,
  cats: new Set([0, 1, 2, 3, 4, 5, 6]),
  landfallOnly: false,
  sortKey: 'year', sortDir: 'desc', showEmptyTail: false,
};

/* =========================================================================
 * ==> FILTER FIRST, THEN SORT WHAT SURVIVES. THIS IS THE WHOLE DESIGN. <==
 *
 * Every sort key is computed over the FILTERED storms, never over the whole
 * season, and getting that backwards makes the feature useless without ever
 * looking broken.
 *
 * Aaron's own example is the test. Filter to Category 5, sort by count, high
 * to low. If `count` meant the season's total, 2005 would rank above 1932 for
 * having had 31 storms — the exact fact the filter was asked to ignore.
 * Counting only survivors gives the real answer: 2005 four, 2025 three, then
 * a band of twos reaching back to 1932.
 *
 * ==> SO THERE IS NO "SORT BY NUMBER OF CAT 5s" KEY AND THERE MUST NEVER BE
 * ONE. <== It falls out of two general controls, and so does every question
 * of that shape — most landfalling storms, most majors, most ACE from storms
 * that came ashore. One key per question is the explosion this avoids.
 * ======================================================================= */
function keep(storm) {
  if (!state.cats.has(storm[CAT_I] == null ? 0 : storm[CAT_I])) return false;
  if (state.landfallOnly && !storm[LF]) return false;
  return true;
}
const isFiltered = () => state.cats.size < 7 || state.landfallOnly;

/* Rows carry BOTH counts. Under a Cat 5 filter 2005 shows 4 and 1932 shows 2,
 * and bare that reads as though the seasons were comparable — 2005 had 31
 * storms, 1932 had 15. The row loses the only context its own number has.
 * Shown count large, season total small beside it. §57.36. */
function rowsFor(basin) {
  const years = WALL.basins[basin].years;
  const out = [];
  for (const [y, list] of Object.entries(years)) {
    const shown = list.filter(keep);
    let strongest = -1, landfalls = 0;
    for (const s of shown) {
      if ((s[CAT_I] ?? -1) > strongest) strongest = s[CAT_I] ?? -1;
      if (s[LF]) landfalls++;
    }
    out.push({ year: +y, shown, total: list.length, strongest, landfalls });
  }
  return out;
}

/* Ties break by year, newest first. */
function sortRows(rows) {
  const k = state.sortKey;
  const val = (r) => (k === 'year' ? r.year
    : k === 'count' ? r.shown.length
    : k === 'strongest' ? r.strongest
    : r.landfalls);
  const sign = state.sortDir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => sign * (val(a) - val(b)) || b.year - a.year);
}

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

const CHIPS = ['TD', 'TS', '1', '2', '3', '4', '5'];

/* The seven chips are coloured EXACTLY as the dots are, so the control
 * documents itself in one row instead of seven labelled checkboxes. §57.36. */
function chipsHtml() {
  let h = '<div class="chips" role="group" aria-label="Filter by peak category">';
  for (let c = 0; c <= 6; c++) {
    const on = state.cats.has(c);
    h += `<button class="chip" type="button" data-cat="${c}" aria-pressed="${on}"
      style="--chip:${catColor(c)}" aria-label="${CAT_LABEL[c]}">${CHIPS[c]}</button>`;
  }
  return h + '</div>';
}

const SORTS = [['year', 'Year'], ['count', 'Count'], ['strongest', 'Strongest'], ['landfalls', 'Landfalls']];

function sortHtml() {
  let h = '<div class="sorts" role="group" aria-label="Sort the years">';
  for (const [k, label] of SORTS) {
    const on = state.sortKey === k;
    const arrow = on ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '';
    h += `<button class="sortbtn" type="button" data-sort="${k}" aria-pressed="${on}"
      >${label}${arrow}</button>`;
  }
  return h + `</div>`;
}

function wallHtml(basin, stripPx) {
  const b = WALL.basins[basin];
  const { size, gap, widest } = dotSizeFor(basin, stripPx);
  const rows = sortRows(rowsFor(basin));
  const filtered = isFiltered();
  const live = rows.filter((r) => r.shown.length > 0);
  const empty = rows.filter((r) => r.shown.length === 0);

  /* Sorted by year, empty rows STAY IN PLACE as hairlines — the gaps are the
   * information, and a run of quiet years is what a quiet stretch looks like.
   * Sorted by anything else the timeline is already gone, so 142 hairlines are
   * dead scroll and they collapse to one expandable line. §57.36. */
  const inPlace = state.sortKey === 'year';

  let html = `<div class="wall" style="--dot:${size}px;--dot-gap:${gap}px">`;
  html += `<div class="ctl">${chipsHtml()}
    <label class="lf"><input type="checkbox" id="lfOnly"${state.landfallOnly ? ' checked' : ''}> landfalling only</label>
    ${sortHtml()}</div>`;

  /* ==> ALWAYS VISIBLE. An over-filtered wall and a broken wall are the same
   * screen without it. <== */
  html += `<p class="tally">${live.length} season${live.length === 1 ? '' : 's'} shown`
    + (empty.length ? ` &middot; ${empty.length} with none` : '') + `</p>`;

  /* ==> THE UNDERCOUNT STOPS BEING A FOOTNOTE THE MOMENT THESE TWO STACK. <==
   * A band and a line work in year order because the shading is contiguous.
   * Sort by anything else and the old years scatter, the line cannot be drawn,
   * and an unmarked Cat 5 leaderboard silently claims Cat 5s are modern — a
   * climate claim this data cannot support. Measured, not asserted. */
  if (filtered || !inPlace) {
    /* Two lines, not five. The warning has to be unmissable AND small enough
     * that the data is still above the fold on a phone — the first draft ate a
     * third of the screen and buried the thing it was warning about. */
    html += `<p class="warn"><b>*</b> Pre-1966 rows are an undercount, and it is
      large: <b>0.11</b> Cat 5s a year before satellites, <b>0.53</b> after.
      Almost none of that gap is weather.</p>`;
  }

  let eraDrawn = false;
  const draw = (r) => {
    const pre = r.year < SATELLITE_ERA_FROM;
    const count = filtered
      ? `${r.shown.length}<small> of ${r.total}</small>`
      : `${r.total}`;
    return `<button class="yr" type="button" data-year="${r.year}"${pre ? ' data-pre="1"' : ''}
      aria-label="${rowLabel(r.year, r.shown)}">
      <span class="yr-num">${r.year}${pre && !inPlace ? '<i class="premark" aria-hidden="true">*</i>' : ''}</span>
      <span>${stripSvg(r.shown, size, gap, WEIGHT)}</span>
      <span class="yr-count">${count}</span>
    </button>`;
  };

  for (const r of (inPlace ? rows : live)) {
    if (inPlace && !eraDrawn && r.year < SATELLITE_ERA_FROM) {
      html += `<p class="era-mark">Below this line nobody was watching from orbit. A storm that
        stayed at sea was simply never recorded, so these rows are an undercount &mdash; a short
        strip here is not evidence of a quiet year.</p>`;
      eraDrawn = true;
    }
    if (inPlace && r.shown.length === 0) {
      html += `<div class="hair" data-year="${r.year}"><span>${r.year}</span></div>`;
      continue;
    }
    html += draw(r);
  }

  if (!inPlace && empty.length) {
    html += `<button class="tail" type="button" id="tailBtn" aria-expanded="${state.showEmptyTail}">
      ${empty.length} seasons had none ${state.showEmptyTail ? '▾' : '▸'}</button>`;
    if (state.showEmptyTail) {
      for (const r of empty) html += `<div class="hair"><span>${r.year}</span></div>`;
    }
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
    const countCol = 46;
    const stripPx = width - 32 - 42 - 16 - countCol;

    const b = WALL.basins[state.basin];

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
      ? wallHtml(state.basin, stripPx)
      : boardHtml(state.basin, state.year);

    const bar = state.screen === 'wall'
      ? `<div class="bar"><span>Past storms &middot; ${b.label}</span><span>pick a year</span></div>`
      : `<div class="bar"><span>Past storms &middot; ${state.year} &middot; ${b.label}</span><span>0 drawn</span></div>`;

    frame.innerHTML = `<div class="sheet">${head}<div class="sheet-body">${body}</div></div>${bar}`;
  }
}

/* One delegated listener per frame set. Chips, sort buttons and the tail all
 * live inside the re-rendered html, so binding has to be delegated or it
 * evaporates on the first repaint. */
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) {
    const c = Number(chip.dataset.cat);
    if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
    return render();
  }
  const sortBtn = e.target.closest('.sortbtn');
  if (sortBtn) {
    const k = sortBtn.dataset.sort;
    /* Tapping the active key REVERSES it — high to low and back. Aaron asked
     * for both directions and a separate direction control is a second thing
     * to reach for. */
    if (state.sortKey === k) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    else { state.sortKey = k; state.sortDir = 'desc'; }
    return render();
  }
  if (e.target.closest('#tailBtn')) { state.showEmptyTail = !state.showEmptyTail; return render(); }
  const yr = e.target.closest('.yr');
  if (yr) { state.year = Number(yr.dataset.year); state.screen = 'board'; return render(); }
  if (e.target.closest('[data-back]')) { state.screen = 'wall'; return render(); }
  const bs = e.target.closest('[data-basin]');
  if (bs) { state.basin = bs.dataset.basin; state.screen = 'wall'; return render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'lfOnly') { state.landfallOnly = e.target.checked; render(); }
});
render();
