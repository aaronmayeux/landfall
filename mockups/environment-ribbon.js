/**
 * environment-ribbon.js — mockup only. SPEC-NEXT.md §47.
 *
 * NOT APP CODE. Nothing here is imported by anything that ships. It exists so
 * the ribbon can be judged on glass before a line of real code is written.
 *
 * External file rather than inline because the live CSP is `script-src 'self'`
 * with one pinned hash and no 'unsafe-inline'. An inline script here is blocked
 * and the page renders as an empty shell.
 */

/* =========================================================================
 * 1. REAL DATA — transcribed from the SHIPS files, nothing invented.
 * ====================================================================== */
const STORMS = {
  hernan: {
    label: 'Hernan', id: 'EP082026', basin: 'pacific', issued: '15 Aug 06 UTC',
    hrs:   [0, 6, 12, 18, 24, 36, 48, 60],
    v:     [30, 29, 28, 28, 28, 26, 25, 22],
    shear: [13, 16, 16, 17, 20, 21, 22, 22],
    sst:   [27.5, 27.7, 27.7, 28.0, 27.9, 27.4, 27.4, 27.3],
    ohc:   [13, 17, 17, 19, 15, 8, 9, 8],
    rh:    [53, 51, 48, 47, 49, 48, 50, 50],
    lat:   [16.3, 16.3, 16.4, 16.5, 16.5, 16.6, 16.7, 16.8],
    lonW:  [133.2, 134.4, 135.5, 136.5, 137.5, 139.6, 141.7, 143.1],
    tail:  'SHIPS stops at +60 h for this storm — the rest of the file is N/A.',
  },
  lala: {
    label: 'Lala', id: 'CP012026', basin: 'pacific', issued: '15 Aug 06 UTC',
    hrs:   [0, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    v:     [55, 56, 57, 55, 55, 54, 55, 57, 60, 63, 63, 70, 72],
    shear: [9, 12, 11, 12, 16, 14, 7, 13, 12, 14, 16, 16, 16],
    sst:   [27.6, 27.4, 27.3, 27.2, 27.6, 27.7, 27.4, 27.8, 28.1, 27.8, 28.4, 28.0, 28.2],
    ohc:   [16, 9, 9, 8, 11, 19, 10, 24, 26, 19, 28, 23, 26],
    rh:    [46, 50, 52, 48, 46, 42, 43, 44, 46, 48, 48, 51, 52],
    lat:   [17.6, 17.9, 18.1, 18.7, 19.3, 20.3, 20.7, 20.8, 20.9, 21.1, 21.6, 22.3, 23.0],
    lonW:  [153.0, 153.8, 154.5, 155.7, 156.8, 159.9, 162.3, 164.8, 166.9, 168.8, 170.7, 172.3, 173.8],
    tail:  'The file runs to +168 h but stops publishing positions after +120 h.',
  },
  al94: {
    label: 'Invest 94L', id: 'AL942026', basin: 'atlantic', issued: '15 Aug 06 UTC',
    hrs:   [0, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    v:     [25, 26, 27, 28, 29, 33, 38, 43, 47, 52, 55, 58, 60],
    shear: [10, 7, 4, 4, 3, 9, 12, 10, 14, 10, 16, 14, 17],
    sst:   [27.9, 27.8, 27.9, 28.1, 28.1, 28.4, 27.9, 28.1, 28.5, 28.5, 28.8, 28.9, 29.0],
    ohc:   [16, 17, 20, 22, 22, 33, 25, 33, 38, 44, 49, 48, 55],
    rh:    [65, 62, 59, 58, 59, 55, 58, 54, 56, 53, 53, 46, 44],
    lat:   [11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 13.1, 14.3, 15.1, 15.9, 16.3, 17.0, 17.8],
    lonW:  [39.6, 41.2, 42.8, 44.3, 45.8, 48.7, 51.3, 53.6, 55.7, 57.5, 59.5, 61.7, 64.0],
    tail:  'SHIPS publishes for invests. The app has no track to hang this on yet.',
  },
};

/** CONE_CIRCLE_NM_2026, verbatim from config/constants.js. Nautical miles. */
const CONE_NM = {
  atlantic: [[12, 25], [24, 39], [36, 49], [48, 62], [60, 77], [72, 95], [96, 134], [120, 200]],
  pacific:  [[12, 25], [24, 37], [36, 48], [48, 56], [60, 66], [72, 78], [96, 106], [120, 138]],
};
/** Below the first published circle the real cone tapers toward the fix. The
 *  app does this in lib/cone-error.js; approximated here so the near end
 *  pinches rather than starting at a blunt 25 nm wall. */
const CONE_NM_AT_ZERO = 8;

function coneNm(basin, hr) {
  const t = CONE_NM[basin];
  if (hr <= t[0][0]) return CONE_NM_AT_ZERO + (t[0][1] - CONE_NM_AT_ZERO) * (hr / t[0][0]);
  for (let i = 0; i < t.length - 1; i++) {
    if (hr <= t[i + 1][0]) {
      const [h0, r0] = t[i], [h1, r1] = t[i + 1];
      return r0 + (r1 - r0) * ((hr - h0) / (h1 - h0));
    }
  }
  return t[t.length - 1][1];
}

/* =========================================================================
 * 2. THE SCORE — these are the numbers that would live in config/constants.js.
 * ====================================================================== */
const ENV = {
  weight:   { shear: 0.40, sst: 0.20, ohc: 0.25, rh: 0.15 },
  shearKt:  { good: 5,    bad: 30   },
  sstC:     { good: 29.5, bad: 26.0 },
  ohcKjCm2: { good: 60,   bad: 0    },
  rhPct:    { good: 70,   bad: 35   },
  /* A factor is only NAMED as the culprit once it crosses one of these.
     Without this the words say "a thin warm layer" on every East Pacific
     storm, because East Pacific ocean heat is always low and that is normal
     there rather than a problem. */
  callout:  { shearKt: 20, sstC: 26.5, ohcKjCm2: 10, rhPct: 45 },
  /* Raw scores on real storms land between about 0.30 and 0.72. Painted on a
     0-1 ramp that is all midtone and nothing reads. This window gets
     stretched across the full ramp. */
  window:   { lo: 0.25, hi: 0.80 },
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const to01 = (v, bad, good) => clamp01((v - bad) / (good - bad));

function subScores(d, i) {
  return {
    shear: to01(d.shear[i], ENV.shearKt.bad,  ENV.shearKt.good),
    sst:   to01(d.sst[i],   ENV.sstC.bad,     ENV.sstC.good),
    ohc:   to01(d.ohc[i],   ENV.ohcKjCm2.bad, ENV.ohcKjCm2.good),
    rh:    to01(d.rh[i],    ENV.rhPct.bad,    ENV.rhPct.good),
  };
}
function scoreAt(d, i) {
  const s = subScores(d, i), w = ENV.weight;
  return w.shear * s.shear + w.sst * s.sst + w.ohc * s.ohc + w.rh * s.rh;
}
/** The one thing standing in the storm's way, in words — or null. */
function bindingAt(d, i) {
  const c = ENV.callout, hits = [];
  if (d.shear[i] >= c.shearKt)  hits.push(['shear', d.shear[i] / c.shearKt, 'wind shear']);
  if (d.sst[i]   <= c.sstC)     hits.push(['sst',   c.sstC / d.sst[i],      'cool water']);
  if (d.ohc[i]   <= c.ohcKjCm2) hits.push(['ohc',   c.ohcKjCm2 / (d.ohc[i] || 1), 'a thin warm layer']);
  if (d.rh[i]    <= c.rhPct)    hits.push(['rh',    c.rhPct / d.rh[i],      'dry air']);
  if (!hits.length) return null;
  hits.sort((a, b) => (ENV.weight[b[0]] * b[1]) - (ENV.weight[a[0]] * a[1]));
  return hits[0][2];
}

/* =========================================================================
 * 3. CANDIDATE RAMPS — the thing being judged on glass.
 * ====================================================================== */
const RAMPS = {
  fade: {
    label: 'Fade', bad: '#3A4756', good: '#DCEAF5',
    why: 'No new hue anywhere. The cone brightens where there is fuel and falls back toward the ocean where there is not. Cannot be confused with a category, a watch, a warning or a wind band.',
  },
  violet: {
    label: 'Violet', bad: '#38405C', good: '#A992FF',
    why: 'A hue nothing else on the globe uses, so it reads as its own thing — but it sits nearer Cat 5 magenta than is comfortable.',
  },
  ember: {
    label: 'Ember', bad: '#46515F', good: '#FFBE5E',
    why: 'Warm where there is fuel. Shown so the collision is visible: this amber sits between Cat 1 yellow and Cat 2 orange.',
  },
};
const ALPHAS = { subtle: 0.16, medium: 0.28, bold: 0.42 };

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function mix(a, b, t, alpha) {
  const A = hex2rgb(a), B = hex2rgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return alpha == null ? `rgb(${c.join(',')})` : `rgba(${c.join(',')},${alpha})`;
}

/* =========================================================================
 * 4. STATE
 * ====================================================================== */
const state = {
  storm: 'lala', ramp: 'fade', alpha: 'medium', scale: 'stretched',
  env: true, cone: true,
};
const shape = (raw) => state.scale === 'raw'
  ? clamp01(raw)
  : clamp01((raw - ENV.window.lo) / (ENV.window.hi - ENV.window.lo));

/* =========================================================================
 * 5. GEOMETRY
 * ====================================================================== */
const NS = 'http://www.w3.org/2000/svg';
const W = 430, H = 330, PAD = 40;
const SUB = 10;          // sub-steps per forecast leg
const NM_PER_DEG = 60;

const el = (name, attrs) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/** Resample the forecast into many closely spaced points, each carrying its
 *  own hour, score and cone radius. This is deliberately how the real layer
 *  would do it: one feature per short slice, colour driven by a property. */
function densify(d) {
  const out = [];
  for (let i = 0; i < d.hrs.length - 1; i++) {
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB;
      out.push({
        lat:  d.lat[i]  + (d.lat[i + 1]  - d.lat[i])  * t,
        lonW: d.lonW[i] + (d.lonW[i + 1] - d.lonW[i]) * t,
        hr:   d.hrs[i]  + (d.hrs[i + 1]  - d.hrs[i])  * t,
        raw:  scoreAt(d, i) + (scoreAt(d, i + 1) - scoreAt(d, i)) * t,
      });
    }
  }
  const last = d.hrs.length - 1;
  out.push({ lat: d.lat[last], lonW: d.lonW[last], hr: d.hrs[last], raw: scoreAt(d, last) });
  return out;
}

/** Equirectangular, longitudes squeezed by cos(mean latitude) so the cone
 *  circles come out round rather than stretched. */
function projector(d) {
  const latMean = d.lat.reduce((a, b) => a + b, 0) / d.lat.length;
  const cos = Math.cos(latMean * Math.PI / 180);
  const xs = d.lonW.map((v) => -v * cos), ys = d.lat;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  // the cone bulges past the track ends, so leave room for the widest circle
  const maxDeg = coneNm(d.basin, d.hrs[d.hrs.length - 1]) / NM_PER_DEG;
  const sx = (x1 - x0) + maxDeg * 2, sy = (y1 - y0) + maxDeg * 2;
  const k = Math.min((W - PAD * 2) / (sx || 1), (H - PAD * 2) / (sy || 1));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const fn = (lonW, lat) => [W / 2 + (-lonW * cos - cx) * k, H / 2 - (lat - cy) * k];
  fn.pxPerDeg = k;
  return fn;
}

/* =========================================================================
 * 6. DRAW
 * ====================================================================== */
function draw() {
  const d = STORMS[state.storm];
  const scene = document.getElementById('scene');
  scene.innerHTML = '';
  const p = projector(d);
  const pts = densify(d);
  const alpha = ALPHAS[state.alpha];
  const ramp = RAMPS[state.ramp];

  // pixel positions, radii, and left/right offsets
  for (const q of pts) {
    const [x, y] = p(q.lonW, q.lat);
    q.x = x; q.y = y;
    q.r = (coneNm(d.basin, q.hr) / NM_PER_DEG) * p.pxPerDeg;
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    pts[i].lx = pts[i].x - dy * pts[i].r;  pts[i].ly = pts[i].y + dx * pts[i].r;
    pts[i].rx = pts[i].x + dy * pts[i].r;  pts[i].ry = pts[i].y - dx * pts[i].r;
  }

  /* --- the cone fill: one quad per slice, each its own colour ----------- */
  if (state.cone) {
    const fillOf = (raw) => state.env
      ? mix(ramp.bad, ramp.good, shape(raw), alpha)
      : `rgba(255,255,255,0.08)`;   // today: a flat 8% white veil

    // round off the far end with the last circle
    const end = pts[pts.length - 1];
    scene.appendChild(el('circle', {
      cx: end.x, cy: end.y, r: end.r, fill: fillOf(end.raw), stroke: 'none',
    }));

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const raw = (a.raw + b.raw) / 2;
      const c = fillOf(raw);
      scene.appendChild(el('polygon', {
        points: `${a.lx},${a.ly} ${b.lx},${b.ly} ${b.rx},${b.ry} ${a.rx},${a.ry}`,
        fill: c, stroke: c, 'stroke-width': 0.7,   // seals the seam between slices
      }));
    }

    /* --- the cone edge, unaffected by the environment --------------------
     * WIDTH AND EDGE CARRY "how sure we are WHERE". FILL CARRIES "why".
     * The edge deliberately keeps its own neutral colour so the shape still
     * reads at a glance even where the fill has fallen to nearly nothing. */
    let dPath = `M ${pts[0].lx} ${pts[0].ly}`;
    for (let i = 1; i < pts.length; i++) dPath += ` L ${pts[i].lx} ${pts[i].ly}`;
    dPath += ` A ${end.r} ${end.r} 0 0 1 ${end.rx} ${end.ry}`;
    for (let i = pts.length - 2; i >= 0; i--) dPath += ` L ${pts[i].rx} ${pts[i].ry}`;
    dPath += ' Z';
    scene.appendChild(el('path', {
      d: dPath, fill: 'none', stroke: 'var(--cone-edge)',
      'stroke-width': 1, 'stroke-opacity': 0.45, 'stroke-linejoin': 'round',
    }));
  }

  /* --- past track, dotted, for context ---------------------------------- */
  const [hx, hy] = p(d.lonW[0], d.lat[0]);
  scene.appendChild(el('path', {
    d: `M ${hx + 58} ${hy + 16} L ${hx + 29} ${hy + 7} L ${hx} ${hy}`,
    stroke: 'var(--track-past)', 'stroke-width': 1.6,
    'stroke-dasharray': '2 4', 'stroke-linecap': 'round', fill: 'none',
  }));

  /* --- the bright core: the forecast track itself ------------------------
   * Kept at full strength so a filled cone still has a line running down it.
   * When the environment is on it takes the ramp; when off it is today's
   * flat white. */
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const raw = (a.raw + b.raw) / 2;
    scene.appendChild(el('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: state.env ? mix(ramp.bad, ramp.good, shape(raw)) : 'var(--track-fc)',
      'stroke-width': state.env ? 2.6 : 1.75, 'stroke-linecap': 'round',
    }));
  }

  /* --- forecast points, category-coloured, exactly as the app draws ----- */
  const code = (kt) => (kt >= 64 ? 'H' : kt >= 34 ? 'S' : 'D');
  for (let i = 0; i < d.hrs.length; i++) {
    const [x, y] = p(d.lonW[i], d.lat[i]);
    const kt = d.v[i];
    scene.appendChild(el('circle', {
      cx: x, cy: y, r: i === 0 ? 8.5 : 6,
      fill: (d.id.startsWith('AL94') && i === 0) ? 'var(--pregenesis)'
        : kt >= 34 ? 'var(--cat-ts)' : 'var(--cat-td)',
      stroke: '#0B1420', 'stroke-width': 1.4,
    }));
    const t = el('text', {
      x, y: y + (i === 0 ? 4 : 3.2), 'text-anchor': 'middle',
      'font-size': i === 0 ? 11 : 8.5, 'font-weight': 700, fill: '#0B1420',
    });
    t.textContent = code(kt);
    scene.appendChild(t);
  }

  /* --- name label, below, as the app places it -------------------------- */
  const nm = el('text', {
    x: hx, y: hy + 26, 'text-anchor': 'middle', 'font-size': 12,
    'font-weight': 600, fill: 'var(--text-2)', stroke: '#070D18',
    'stroke-width': 3, 'paint-order': 'stroke',
  });
  nm.textContent = d.label.toUpperCase();
  scene.appendChild(nm);

  document.getElementById('stamp').textContent = `${d.id} · ${d.issued}`;
  drawDrawer(d);
  drawLegend();
}

const hrLabel = (h) => (h === 0 ? 'now' : `+${h} h`);

function drawDrawer(d) {
  const n = d.hrs.length;
  const raws = d.hrs.map((_, i) => scoreAt(d, i));
  let worst = 0, best = 0;
  for (let i = 1; i < n; i++) {
    if (raws[i] < raws[worst]) worst = i;
    if (raws[i] > raws[best]) best = i;
  }
  const up = raws[n - 1] > raws[0] + 0.03;
  const down = raws[n - 1] < raws[0] - 0.03;
  const bindNow = bindingAt(d, 0), bindWorst = bindingAt(d, worst);

  let verdict;
  if (down) {
    verdict = `Running out of road by <b>${hrLabel(d.hrs[worst])}</b>`
      + (bindWorst ? ` — ${bindWorst}.` : '.');
  } else if (up) {
    verdict = `Conditions open up around <b>${hrLabel(d.hrs[best])}</b>`
      + (bindNow ? ` once ${bindNow} eases.` : '.');
  } else {
    verdict = bindNow
      ? `Held back by <b>${bindNow}</b> the whole way.`
      : 'Nothing much standing in its way.';
  }
  document.getElementById('verdict').innerHTML = verdict;

  const i = down ? worst : best;
  document.getElementById('figs').innerHTML = `
    <div class="fig"><span class="k">Shear</span><span class="v">${d.shear[i]} kt</span></div>
    <div class="fig"><span class="k">Water</span><span class="v">${d.sst[i].toFixed(1)}&deg;</span></div>
    <div class="fig"><span class="k">Heat</span><span class="v">${d.ohc[i]}</span></div>
    <div class="fig"><span class="k">Humid</span><span class="v">${d.rh[i]}%</span></div>`;
  document.getElementById('note').textContent =
    `Figures at ${hrLabel(d.hrs[i])}. ${d.tail}`;
}

function drawLegend() {
  const r = RAMPS[state.ramp];
  const stops = [];
  for (let i = 0; i <= 10; i++) stops.push(mix(r.bad, r.good, i / 10));
  document.getElementById('legend-bar').style.background =
    `linear-gradient(90deg, ${stops.join(',')})`;
  document.getElementById('legend-note').textContent = r.why;
}

/* =========================================================================
 * 7. CONTROLS — tap, click and keyboard all reach everything.
 * ====================================================================== */
function buildSegs(hostId, items, key) {
  const host = document.getElementById(hostId);
  host.innerHTML = items.map(([v, label]) => `
    <button class="seg" type="button" role="radio" data-v="${v}"
            aria-checked="${state[key] === v}">${label}</button>`).join('');
  host.addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    state[key] = b.dataset.v;
    for (const c of host.children) {
      c.setAttribute('aria-checked', String(c.dataset.v === state[key]));
    }
    draw();
  });
}
buildSegs('pick-storm', [['hernan', 'Hernan'], ['lala', 'Lala'], ['al94', '94L']], 'storm');
buildSegs('pick-ramp', Object.entries(RAMPS).map(([k, v]) => [k, v.label]), 'ramp');
buildSegs('pick-alpha', [['subtle', 'Subtle'], ['medium', 'Medium'], ['bold', 'Bold']], 'alpha');
buildSegs('pick-scale', [['stretched', 'Stretched'], ['raw', 'Raw 0–1']], 'scale');

function bindRow(id, key, onText, offText) {
  const row = document.getElementById(id);
  const note = row.querySelector('small');
  row.addEventListener('click', () => {
    state[key] = !state[key];
    row.setAttribute('aria-checked', String(state[key]));
    if (note) note.textContent = state[key] ? onText : offText;
    draw();
  });
}
bindRow('row-env', 'env', 'Why it strengthens or falls apart', 'Off — plain white cone');
bindRow('row-cone', 'cone', 'Where it might go', 'Off — track only');

draw();
